#!/usr/bin/env node
// 帧率采集工具（Issue #93 / A-10；#19 的执行侧）
//
// 目的：把「1440×900 ≥ 30fps」这条判据的**取数**变成一条命令，
// 而不是人肉开 devtools、敲 __perf.stats()、再手抄进报告。
//
// 用法：
//   # 1) 起应用（dist 必须是冻结版）
//   npm run preview -- --port 4173
//   # 2) 起一个带调试端口的 Chrome —— 必须独立 user-data-dir（Chrome ≥136 限制），
//   #    端口别用 9222（本机常被 Edge/旧 Chrome 占用），别加 --use-gl=swiftshader
//   chrome --remote-debugging-port=9444 --remote-allow-origins=* \
//          --user-data-dir=<独立目录> --no-first-run --no-default-browser-check \
//          --no-restore http://127.0.0.1:4173/
//   # 3) 采集
//   node scripts/check-fps.mjs --port 9444
//   node scripts/check-fps.mjs --port 9444 --width 1440 --height 900 --out D:/tmp/fps-gpu.json
//   node scripts/check-fps.mjs --port 9444 --json      # 只输出 JSON，便于管道
//
// 零依赖：只用 Node 22 内置 fetch + WebSocket，不装 Playwright
// （本机 npm install 常被 SIGTERM 打断，且会破坏 node_modules 的 junction）。
//
// ── 这个脚本**只报告，不判定** ────────────────────────────────
// 判定权在 #19 的 owner：`docs/RUNBOOK.md` 那张表由人对着读数勾。
// 理由：本机是核显，核显达标不能证明评委机/独显机达标；
// 工具越界去"判通过"，等于用一个不可迁移的读数替代判据。
// `--assert` 是显式自选的开关，且它打印的是"本次会话的中位数"，不是"判据通过"。
//
// ── 三个 CDP 硬坑（改本文件前必读，和 check-acceptance-cdp.mjs 同源）──
// 1. Chrome ≥136 禁止在默认 profile 上开 --remote-debugging-port，必须独立 --user-data-dir。
// 2. 必须 Page.bringToFront + Emulation.setFocusEmulationEnabled，否则 Runtime.evaluate
//    会静默不返回（表现为超时，不报错）。
// 3. 视口必须显式 setDeviceMetricsOverride：本机实测窗口视口是 1427×788（被窗口装饰吃掉像素），
//    不设就等于在"不是判据要求工况"的尺寸上取数。
//
// 退出码：
//   0  采样成功（默认恒 0：只报告）
//   1  --assert 指定时，本次中位 < 30
//   2  采样失败（连不上 CDP / 找不到页面 / 样本不足 / 页面里没有 __perf）
//   不要用退出码代替判定：#93 明确「不代判 #19」。

const DEFAULTS = {
  port: 9444,
  url: 'http://127.0.0.1:4173/?debug=1',
  width: 1440,
  height: 900,
  dpr: 1,
  minSamples: 120,   // perf.js 的 sampleWindow 就是 120：环形窗口滚动到这里，加载期长帧已挤出
  seconds: 30,       // 等样本的上限，不是采样时长；中途够了就提前返回。
                     // 30 而不是 15：低性能机上 L0 可能只有 ~9fps，攒 120 帧要 13s+，
                     // 15s 会卡在"样本永远不够 → perf 不评估降档 → 一直慢"的死锁里。
  warmup: 8,         // 导航后先空等这么多秒再开始采样。
                     // 为什么必须预热：判据要的是「稳态渲染能力」，不是「首屏加载有多慢」。
                     // 实测（11-28 核显）冷启动第一次 P95=1016ms、第二次 P95=16.9ms，
                     // 差别全在首屏着色器编译 + 贴图解码的那几帧长帧上。
                     // 8s 也让 #91 的回升机制（稳定 5s 且中位 ≥45 → 回升一档）有机会生效。
  pollMs: 400,
  out: null,
  json: false,
  assert: false,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`参数 ${name} 需要一个正数，收到：${v}`);
      process.exit(2);
    }
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = num(argv[++i], '--port');
    else if (a === '--url') o.url = argv[++i];
    else if (a === '--width') o.width = num(argv[++i], '--width');
    else if (a === '--height') o.height = num(argv[++i], '--height');
    else if (a === '--dpr') o.dpr = num(argv[++i], '--dpr');
    else if (a === '--min-samples') o.minSamples = num(argv[++i], '--min-samples');
    else if (a === '--seconds') o.seconds = num(argv[++i], '--seconds');
    else if (a === '--warmup') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n < 0) {
        console.error(`--warmup 需要 0 或正数，收到：${argv[i]}`);
        process.exit(2);
      }
      o.warmup = n;
    }
    else if (a === '--poll') o.pollMs = num(argv[++i], '--poll');
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--assert') o.assert = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        [
          '用法: node scripts/check-fps.mjs [选项]',
          '',
          '  --port <n>         CDP 端口，默认 9444（不要用 9222，本机常被占用）',
          '  --url <url>        目标页，默认 http://127.0.0.1:4173/?debug=1（?debug=1 才会挂 window.__perf）',
          '  --width/--height   视口，默认 1440×900（判据工况，务必别省）',
          '  --dpr <n>          设备像素比，默认 1',
          '  --min-samples <n>  样本下限，默认 120',
          '  --seconds <n>      等样本上限秒数，默认 30（不是采样时长；攒够即返回）',
          '  --warmup <n>       导航后空等 n 秒再采样，默认 8（0 = 不预热，读数会含首屏加载长帧）',
          '  --out <file.json>  把完整结果写文件',
          '  --json             只打印 JSON（便于管道）',
          '  --assert           显式断言本次中位 ≥ 30fps（默认不做任何判定）',
          '',
          '退出码: 0 采样成功 / 1 --assert 未达 30fps / 2 采样失败',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      console.error(`未知参数：${a}（--help 看用法）`);
      process.exit(2);
    }
  }
  return o;
}

async function pickTarget(port, url) {
  let list;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!res.ok) throw new Error(`/json/list 返回 ${res.status}`);
    list = await res.json();
  } catch (e) {
    throw new Error(
      `连不上 CDP 端口 ${port}：${e.message}\n` +
        `先确认 Chrome 是带 --remote-debugging-port=${port} --user-data-dir=<独立目录> 起的。`,
    );
  }
  const pages = list.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'));
  if (!pages.length) throw new Error('没有可用的 page target：Chrome 可能只开了空白页');
  // 优先挑已经在目标 host:port 上的页；找不到也没关系，后面会 navigate 过去。
  let hostPort = '';
  try {
    const u = new URL(url);
    hostPort = `${u.hostname}:${u.port || (u.protocol === 'https:' ? 443 : 80)}`;
  } catch {
    /* url 非法时跳过匹配，交给 navigate 报错 */
  }
  if (hostPort) {
    const hit = pages.find((t) => String(t.url).includes(hostPort));
    if (hit) return hit;
  }
  return pages.find((t) => !String(t.url).startsWith('chrome://')) || pages[0];
}

async function connect(port, url) {
  const target = await pickTarget(port, url);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;

  ws.addEventListener('message', (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket 连接超时（15s）')), 15000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('WebSocket 连接失败')); }, { once: true });
  });

  // 超时返回 {__timeout} 而不是 throw：调用方要能区分「CDP 慢」和「页面真错」。
  const send = (method, params = {}, timeoutMs = 20000) =>
    new Promise((resolve) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); resolve({ __timeout: method }); }, timeoutMs);
      pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      ws.send(JSON.stringify({ id, method, params }));
    });

  // 顺序不可调换（坑 2）
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.__timeout) throw new Error(`Runtime.evaluate 超时：${expression.slice(0, 50)}`);
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(`页面内异常：${ex.exception?.description || ex.text}`);
    return r.result?.result?.value;
  };

  return { ws, send, evaluate, target };
}

// 视口必须显式设（坑 3）。实测要点：navigate 会重建渲染树，
// 在 navigate 之前设的 override 有时到不了新文档（读数仍是窗口实际尺寸 1427×788），
// 所以这里做成可重复调用的函数，navigate 后再补一次。
async function applyViewport(send, opt) {
  const r = await send('Emulation.setDeviceMetricsOverride', {
    width: opt.width,
    height: opt.height,
    deviceScaleFactor: opt.dpr,
    mobile: false,
  });
  return !(r.__timeout || r.error);
}

// 一次性取页面里所有要落盘的东西：perf 统计 + 显卡字符串 + 实际视口。
// 返回值里的 glUnmasked 是真显卡名（ANGLE Intel(R) UHD Graphics …），
// 没有 WEBGL_debug_renderer_info 时退回 'n/a'，别硬编。
const SNAPSHOT_EXPR = `(() => {
  const p = window.__perf;
  const canvas = document.querySelector('canvas');
  let gl = null, glRenderer = 'n/a', glVendor = 'n/a';
  if (canvas) {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'n/a';
        glVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || 'n/a';
      } else {
        glRenderer = gl.getParameter(gl.RENDERER) || 'n/a';
        glVendor = gl.getParameter(gl.VENDOR) || 'n/a';
      }
    }
  }
  return JSON.stringify({
    hasPerf: !!p,
    stats: p ? p.stats() : null,
    glRenderer,
    glVendor,
    viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight,
                dpr: window.devicePixelRatio, outerWidth: window.outerWidth,
                outerHeight: window.outerHeight },
    ua: navigator.userAgent,
    hidden: document.hidden,
    visibilityState: document.visibilityState,
  });
})()`;

// perf.js 的档位顺序。用来兼容没有 direction 字段的旧版 levelHistory。
const LEVEL_ORDER = ['L0', 'L1', 'L2'];

// #91（commit 4218ee9）之后 levelHistory 同时记降档与回升，条目带 direction。
// 判定表只认「降档」，所以这里必须按 direction 分开数；旧版没有该字段时按档位序号推断。
function splitLevelChanges(history) {
  const drops = [];
  const ups = [];
  for (const h of history || []) {
    let dir = h.direction;
    if (dir !== 'down' && dir !== 'up') {
      dir = LEVEL_ORDER.indexOf(h.to) > LEVEL_ORDER.indexOf(h.from) ? 'down' : 'up';
    }
    (dir === 'down' ? drops : ups).push(h);
  }
  return { drops, ups };
}

async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const warnings = [];

  const conn = await connect(opt.port, opt.url);
  const { ws, send, evaluate } = conn;

  // 坑 3：显式设视口。deviceScaleFactor 也跟着设，否则 DPR 1.25 下 canvas 分辨率对不上判据。
  if (!(await applyViewport(send, opt))) {
    warnings.push('setDeviceMetricsOverride 未生效（timeout/error）：读数视口可能不是判据工况');
  }

  await send('Page.navigate', { url: opt.url });

  // navigate 后重设一次视口（见 applyViewport 上方说明）
  await sleep(600);
  await applyViewport(send, opt);

  // 预热：让首屏加载与着色器编译的长帧跑完，再开始计数。
  // 这里刻意不调 __perf.reset()：reset 会把 level 拉回 L0，
  // 那样"这次运行到底有没有降档"就测不出来了，而判定表第一行要的正是这个。
  // 靠 120 帧滚动窗口自然把冷启动帧挤出去，同时给 #91 的回升机制留时间。
  if (opt.warmup > 0) await sleep(opt.warmup * 1000);

  // 等样本：轮询而不是死等，够了就提前返回（弱机上 120 帧可能要 13s+）。
  const sampleStartAt = Date.now();
  const deadline = sampleStartAt + opt.seconds * 1000;
  let snap = null;
  let pollCount = 0;
  let hiddenSeen = false;
  let lastSamples = 0;
  let viewportRetried = false;

  while (Date.now() < deadline) {
    await sleep(opt.pollMs);
    pollCount += 1;
    let raw;
    try {
      raw = await evaluate(SNAPSHOT_EXPR);
    } catch (e) {
      // 加载期页面还没稳，evaluate 偶发失败不算错，继续等
      warnings.push(`第 ${pollCount} 次轮询失败：${e.message}`);
      continue;
    }
    if (!raw) continue;
    snap = JSON.parse(raw);
    if (snap.hidden) hiddenSeen = true;
    if (!snap.hasPerf) continue; // 页面还没挂上 __perf（?debug=1 缺失或仍在加载）

    // 视口被导航打回去时补设一次；只补一次，避免每轮都在抖
    if (!viewportRetried && snap.viewport.innerWidth !== opt.width) {
      viewportRetried = true;
      warnings.push(
        `检测到视口漂回 ${snap.viewport.innerWidth}×${snap.viewport.innerHeight}，已重设 ${opt.width}×${opt.height}`,
      );
      await applyViewport(send, opt);
      continue;
    }

    lastSamples = snap.stats?.samples ?? 0;
    if (lastSamples >= opt.minSamples) break;
  }

  ws.close();
  const elapsedMs = Date.now() - sampleStartAt;

  if (!snap) {
    throw new Error(`在 ${opt.seconds}s 内没拿到任何页面快照（CDP 通但 evaluate 无返回）`);
  }
  if (!snap.hasPerf) {
    throw new Error(
      `页面里没有 window.__perf —— 目标 URL 必须带 ?debug=1（当前：${opt.url}）。` +
        `perf.js 只在 debug:true 时挂这个口子。`,
    );
  }

  // 样本不足但已过 perf 自身的最小判定线（30 帧）：降级输出，不直接报错。
  // 慢机器上 L0 可能只有 ~9fps，攒 120 帧要 13s+；直接退出等于逼人重跑再等一遍，
  // 而"只采到 N 帧"本身就是有意义的读数（说明这台机器很慢）。
  const HARD_FLOOR = 30;
  let shortfall = false;
  if (lastSamples < opt.minSamples) {
    if (lastSamples >= HARD_FLOOR) {
      shortfall = true;
      warnings.push(
        `样本只采到 ${lastSamples}/${opt.minSamples}（${opt.seconds}s 上限）：读数是 ${lastSamples} 帧窗口的中位数，` +
          `不是完整 120 帧窗口，判定时须知道这一点，不能直接与"满窗读数"横比。`,
      );
    } else {
      throw new Error(
        `样本不足：${opt.seconds}s 内只采到 ${lastSamples} 帧（低于 perf 自身判定线 ${HARD_FLOOR}）。` +
          `常见原因——标签页在后台（rAF 被节流，document.hidden=${hiddenSeen}）、窗口被遮挡、` +
          `或页面报错导致渲染循环停了（用 scripts/check-acceptance-cdp.mjs 看 console）。`,
      );
    }
  }

  const s = snap.stats;
  if (snap.viewport.innerWidth !== opt.width || snap.viewport.innerHeight !== opt.height) {
    warnings.push(
      `实际视口 ${snap.viewport.innerWidth}×${snap.viewport.innerHeight} ≠ 请求的 ${opt.width}×${opt.height}；` +
        `读数不在判据工况上`,
    );
  }
  if (Math.abs(snap.viewport.dpr - opt.dpr) > 0.01) {
    warnings.push(`实际 DPR ${snap.viewport.dpr} ≠ 请求的 ${opt.dpr}`);
  }
  if (hiddenSeen) {
    warnings.push('采样期间页面曾处于 document.hidden=true，rAF 可能被节流过，读数偏低');
  }
  if (s.levelIndex > 0) {
    warnings.push(
      `采到读数时已降档到 ${s.level}：这组数字是「当前档位」下的表现，不是 L0 基准画质下的表现。` +
        `判定表的"通过"一档要求全程未降档。`,
    );
  }
  // #91 之后 levelHistory 也会记「回升」，必须按 direction 分开数，
  // 否则会把一次回升也算成一次降档，判定表就判错了。
  const { drops, ups } = splitLevelChanges(s.droppedAt);
  if (ups.length) {
    warnings.push(
      `采样期间发生 ${ups.length} 次画质回升（${ups.map((u) => `${u.from}→${u.to}`).join('、')}）：` +
        `这组读数跨了多个档位，中位数不代表单一工况。`,
    );
  }

  // 显卡是否「独显未知」——脚本不猜。核显/软渲染/独显都可能是这个字符串。
  const glLower = String(snap.glRenderer).toLowerCase();
  const looksSoftware = /swiftshader|llvmpipe|software|basic render/.test(glLower);
  if (looksSoftware) {
    warnings.push(
      `glRenderer 疑似软件渲染（${snap.glRenderer}）：按 RUNBOOK 判定表，软件渲染数字只作参考、不得入判据`,
    );
  }

  const result = {
    // ── 身份 ──
    tool: 'scripts/check-fps.mjs',
    toolVersion: '1.0.0',
    issue: '#93 (A-10) / 判据见 #19',
    capturedAt: new Date().toISOString(),
    url: opt.url,
    // ── 工况：这几项决定读数能不能对上判据 ──
    requestedViewport: { width: opt.width, height: opt.height, dpr: opt.dpr },
    actualViewport: snap.viewport,
    // ── 硬件：只记录，不代表判定 ──
    glRenderer: snap.glRenderer,
    glVendor: snap.glVendor,
    discreteGpu: 'unknown', // 脚本无法可靠判断独显/核显，留给 owner 在报告里注明
    softwareRenderingSuspected: looksSoftware,
    ua: snap.ua,
    // ── 读数 ──
    stats: s,
    // 档位变化：判定表只数 drops（降档）。ups 是 #91 新增的回升能力，不算降档。
    levelChanges: {
      current: s.level,
      dropCount: drops.length,
      upCount: ups.length,
      drops,
      ups,
    },
    droppedAt: s.droppedAt, // 原样保留 perf.js 的字段与命名，便于和页面原始输出对照
    // #91 新增的采样内部量；旧版 perf.js 没有这两个字段，会是 undefined
    panicStreak: s.panicStreak,
    recoveries: s.recoveries,
    // ── 采样过程 ──
    sampling: {
      minSamples: opt.minSamples,
      warmupMs: opt.warmup * 1000,
      samplesReached: lastSamples,
      shortfall,          // true = 没攒满 minSamples，读数是短窗口
      pollCount,
      elapsedMs,
      hiddenSeen,
    },
    warnings,
    disclaimer:
      '本文件是一次会话的采样结果，不是判据结论。判定按 docs/RUNBOOK.md「帧率采集与判定（#19）」的判定表由 owner 做出；' +
      '核显或软件渲染的读数不能替代判据通过。',
  };

  const jsonText = JSON.stringify(result, null, 2);

  if (opt.out) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(path.resolve(opt.out)), { recursive: true });
    await fs.writeFile(opt.out, jsonText + '\n', 'utf8');
  }

  if (opt.json) {
    console.log(jsonText);
  } else {
    const lines = [
      `帧率采集（#93 / #19）— ${result.capturedAt}`,
      `  视口     ${snap.viewport.innerWidth}×${snap.viewport.innerHeight} @DPR ${snap.viewport.dpr}（请求 ${opt.width}×${opt.height}@${opt.dpr}）`,
      `  显卡     ${snap.glRenderer}`,
      `  样本     ${s.samples} 帧，采集 ${result.sampling.elapsedMs}ms（预热 ${opt.warmup}s 后开始计数）`,
      `  中位     ${s.fpsMedian} fps（帧时 ${s.frameMsMedian}ms）`,
      `  P95      ${s.frameMsP95}ms    最差帧 ${s.frameMsMax}ms`,
      `  档位     ${s.level}（降档 ${drops.length} 次 / 回升 ${ups.length} 次）`,
    ];
    for (const d of drops) lines.push(`           降 ${d.from}→${d.to}  ${d.reason}`);
    for (const u of ups) lines.push(`           升 ${u.from}→${u.to}  ${u.reason}`);
    if (warnings.length) {
      lines.push('', '  注意：');
      for (const w of warnings) lines.push(`  - ${w}`);
    }
    lines.push(
      '',
      '  这只报告，不判定。核显/软件渲染的读数不能当判据通过；',
      '  判定按 docs/RUNBOOK.md「帧率采集与判定（#19）」的判定表由 #19 的 owner 做。',
    );
    if (opt.out) lines.push(`  完整 JSON 已写入 ${opt.out}`);
    if (opt.assert) {
      const pass = s.fpsMedian >= 30;
      lines.push(
        '',
        `  [--assert] 本次会话中位 ${s.fpsMedian} fps ${pass ? '≥' : '<'} 30 → ${pass ? '达线' : '未达线'}`,
        `  [--assert] 显卡 ${snap.glRenderer}；是否独显：未知（脚本无法判定，需人工确认）`,
        '  [--assert] 注意：这只说明「本次会话在这台机器上达线」，不等于 #19 判据通过。',
      );
      if (!pass) {
        console.log(lines.join('\n'));
        process.exit(1);
      }
    }
    console.log(lines.join('\n'));
  }

  if (opt.assert && s.fpsMedian < 30) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(`采样失败：${e.message}`);
  process.exit(2);
});
