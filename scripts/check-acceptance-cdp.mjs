#!/usr/bin/env node
// 验收复核探针（Issue #53 / A-04）
//
// 目的：把「A 复核通过」这句话变成一条别人也能跑出同样输出的命令。
//
// 用法：
//   # 1) 先起应用（任选其一）
//   npm run preview -- --port 4173
//   # 2) 再起一个带调试端口的 Chrome（必须独立 user-data-dir，Chrome ≥136 限制）
//   chrome --remote-debugging-port=9222 --remote-allow-origins=* \
//          --user-data-dir=<独立目录> --no-first-run --no-default-browser-check \
//          http://localhost:4173/
//   # 3) 跑探针
//   node scripts/check-acceptance-cdp.mjs --port 9222
//   node scripts/check-acceptance-cdp.mjs --port 9222 --json
//
// 零依赖：只用 Node 22 内置的 fetch + WebSocket，不装 Playwright。
// 原因：本机 `npm install` 常被 SIGTERM 打断，且会破坏 node_modules 的 junction。
//
// ── 三个硬坑（改动本文件前必读）─────────────────────────────────
// 1. Chrome ≥136 禁止在默认 profile 上开 --remote-debugging-port，必须独立 --user-data-dir。
// 2. 必须先 Page.bringToFront + Emulation.setFocusEmulationEnabled，
//    否则 Runtime.evaluate 会静默不返回（表现为超时，不报错）。
// 3. 点击一律走 DOM 的 el.click()，不用 Input.dispatchMouseEvent——
//    后者在软渲染 + 无焦点时容易卡住。要在真机上测键鼠才用 Input 域。
//
// 退出码：0 全通过 / 1 有 FAIL / 2 只有 WARN 与 SKIP（无 FAIL）

const DEFAULT_PORT = 9222;
const DEFAULT_URL_HINT = '';

function parseArgs(argv) {
  const o = { port: DEFAULT_PORT, json: false, urlHint: DEFAULT_URL_HINT, verbose: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--url') o.urlHint = argv[++i];
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--only') o.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') {
      console.log('用法: node scripts/check-acceptance-cdp.mjs [--port 9222] [--url <prefix>] [--json] [--verbose] [--only id1,id2]');
      process.exit(0);
    }
  }
  return o;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 超时不是应用失败：软渲染下 WebGL 重绘会阻塞主线程几十秒。
// 单独成类，主循环把它记成 WARN，避免把环境限制误判成判据 FAIL。
class EvalTimeout extends Error {
  constructor(expression) {
    super(`evaluate 超时（20s）：${expression.slice(0, 60)}`);
    this.name = 'EvalTimeout';
  }
}

async function pickTarget(port, urlHint) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`CDP /json/list 返回 ${res.status}`);
  const list = await res.json();
  const pages = list.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'));
  if (!pages.length) throw new Error('没有可用的 page target：Chrome 可能只开了空白页');
  if (urlHint) {
    const hit = pages.find((t) => String(t.url).includes(urlHint));
    if (hit) return hit;
  }
  // 优先非 chrome:// 的页面，其次任意
  return pages.find((t) => !String(t.url).startsWith('chrome://')) || pages[0];
}

async function connect(port, urlHint) {
  const target = await pickTarget(port, urlHint);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  const events = { exceptions: [], consoleErrors: [] };

  ws.addEventListener('message', (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params?.exceptionDetails;
      events.exceptions.push({
        text: d?.exception?.description || d?.text || 'unknown',
        url: d?.url || '', line: d?.lineNumber ?? -1,
      });
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params?.type === 'error') {
      events.consoleErrors.push((m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket 连接超时')), 15000);
    ws.addEventListener('open', () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener('error', () => { clearTimeout(t); reject(new Error('WebSocket 连接失败')); }, { once: true });
  });

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
    if (r.__timeout) throw new EvalTimeout(expression);
    const det = r.result?.exceptionDetails;
    if (det) throw new Error(det.exception?.description || det.text || 'evaluate 异常');
    return r.result?.result?.value;
  };

  return { ws, send, evaluate, target, events };
}

// ── 检查项 ────────────────────────────────────────────────────
// 每项返回 { level, detail }，level ∈ PASS | FAIL | WARN | SKIP
// SKIP 的语义是「这一项在本环境测不了」或「前置条件没满足」，必须写清原因，不许当 PASS。

function makeChecks(ctx) {
  const { evaluate } = ctx;

  const clickByText = (text) => evaluate(`(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().includes(${JSON.stringify(text)}));
    if (!el) return 'notfound';
    el.click();
    return 'clicked';
  })()`);

  // 看板可能默认就是开的（#dash-btn 是切换键，盲目 click 会把它关掉）
  const ensureDashboardOpen = async () => {
    if (await evaluate(`!!document.querySelector('.dash-formula')`)) return true;
    if (!(await evaluate(`!!document.querySelector('#dash-btn')`))) return false;
    await evaluate(`document.querySelector('#dash-btn').click()`);
    await sleep(1000);
    return await evaluate(`!!document.querySelector('.dash-formula')`);
  };

  return [
    {
      id: 'boot',
      name: '页面启动无未捕获异常',
      async run() {
        const errs = ctx.events.exceptions;
        if (errs.length === 0) return { level: 'PASS', detail: 'pageerror 0 条' };
        return {
          level: 'FAIL',
          detail: `${errs.length} 条 pageerror，首条：${errs[0].text.slice(0, 160)}`,
        };
      },
    },
    {
      id: 'A01-floor-switch',
      name: 'A01 楼层切换',
      async run() {
        const before = await evaluate(`(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.classList.contains('active'));
          return b ? b.textContent.trim() : null;
        })()`);
        const r = await clickByText('8F');
        if (r === 'notfound') return { level: 'SKIP', detail: '页面上找不到 8F 楼层按钮' };
        await sleep(1200);
        const after = await evaluate(`(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.classList.contains('active'));
          return b ? b.textContent.trim() : null;
        })()`);
        const canvasOk = await evaluate(`!!document.querySelector('canvas')`);
        if (!canvasOk) return { level: 'FAIL', detail: '切换后 canvas 消失' };
        if (before === after) return { level: 'FAIL', detail: `高亮层未变化（仍为「${after}」）` };
        return { level: 'PASS', detail: `「${before ?? '无'}」→「${after}」` };
      },
    },
    {
      id: 'A02-search',
      name: 'A02 搜索高亮',
      async run() {
        const has = await evaluate(`!!document.querySelector('#search-input')`);
        if (!has) return { level: 'SKIP', detail: '找不到 #search-input' };
        const r = await evaluate(`(() => {
          const i = document.querySelector('#search-input');
          i.value = '火锅';
          i.dispatchEvent(new Event('input', { bubbles: true }));
          const btn = document.querySelector('#search-btn');
          if (btn) btn.click();
          return 'done';
        })()`);
        if (r !== 'done') return { level: 'FAIL', detail: '搜索输入失败' };
        await sleep(1200);
        // 判据：页面出现与查询词相关的结果元素（开板/结果条目），且无异常
        const hits = await evaluate(`(() => {
          const all = [...document.querySelectorAll('*')].filter((e) => !e.children.length);
          return all.filter((e) => e.textContent.includes('火锅')).length;
        })()`);
        if (ctx.events.exceptions.length) return { level: 'FAIL', detail: '搜索过程中抛异常' };
        if (hits > 0) return { level: 'PASS', detail: `页面出现 ${hits} 处「火锅」相关文本` };
        return { level: 'WARN', detail: '搜索已执行，但页面上找不到「火锅」相关文本，可能该词未命中数据' };
      },
    },
    {
      id: 'A04-view-mode',
      name: 'A04 双视角切换',
      async run() {
        const has = await evaluate(`!!document.querySelector('#view-btn')`);
        if (!has) return { level: 'SKIP', detail: '找不到 #view-btn' };
        const before = await evaluate(`document.querySelector('#view-btn').textContent.trim()`);
        await evaluate(`document.querySelector('#view-btn').click()`);
        await sleep(1200);
        const after = await evaluate(`document.querySelector('#view-btn').textContent.trim()`);
        if (before === after) return { level: 'FAIL', detail: `按钮文案未变化（仍为「${after}」）` };
        return { level: 'PASS', detail: `「${before}」→「${after}」` };
      },
    },
    {
      id: 'A06-dashboard',
      name: 'A06 指标看板字段齐全',
      async run() {
        if (!(await ensureDashboardOpen())) return { level: 'SKIP', detail: '看板既未打开，也找不到 #dash-btn' };
        const info = await evaluate(`(() => ({
          formula: !!document.querySelector('.dash-formula'),
          n: (document.body.innerText.match(/n\\s*=\\s*\\d+/) || [])[0] || null,
          chips: document.querySelectorAll('.dash-chip').length,
          events: /事件流/.test(document.body.innerText),
        }))()`);
        if (!info.formula) return { level: 'FAIL', detail: '缺 .dash-formula（口径说明）' };
        if (!info.n) return { level: 'FAIL', detail: '缺 n=样本量显示' };
        if (info.chips < 3) return { level: 'FAIL', detail: `.dash-chip 只有 ${info.chips} 个，aux 指标可能没渲染` };
        return { level: 'PASS', detail: `${info.n}，chips=${info.chips}，事件流=${info.events}` };
      },
    },
    {
      id: 'A07-scenario',
      name: 'A07 假设推演响应',
      async run() {
        if (!(await ensureDashboardOpen())) return { level: 'SKIP', detail: '看板未打开' };
        const has = await evaluate(`!!document.querySelector('#dash-add')`);
        if (!has) return { level: 'SKIP', detail: '找不到 #dash-add 滑块（看板未打开？）' };
        const readDelta = () => evaluate(`(() => {
          const el = document.querySelector('.dash-delta');
          return el ? el.textContent.trim() : null;
        })()`);
        const before = await readDelta();
        const changed = await evaluate(`(() => {
          const i = document.querySelector('#dash-add');
          const max = Number(i.max || 10);
          i.value = String(Math.min(Number(i.value) + 4, max));
          i.dispatchEvent(new Event('input', { bubbles: true }));
          i.dispatchEvent(new Event('change', { bubbles: true }));
          const run = document.querySelector('.dash-run');
          if (run) run.click();
          return Number(i.value);
        })()`);
        await sleep(1500);
        const after = await readDelta();
        if (before === null && after === null) return { level: 'SKIP', detail: '页面上没有 .dash-delta，推演结果区可能未实现' };
        if (before === after) return { level: 'FAIL', detail: `滑块设为 ${changed} 后 .dash-delta 未变化（仍为「${after}」）` };
        return { level: 'PASS', detail: `滑块→${changed}，delta「${before}」→「${after}」` };
      },
    },
    {
      id: 'A12-advisor',
      name: 'A12 AI 建议卡片',
      async run() {
        if (!(await ensureDashboardOpen())) return { level: 'SKIP', detail: '看板未打开' };
        const info = await evaluate(`(() => ({
          tag: (document.querySelector('.dash-rule-tag') || {}).textContent?.trim() || null,
          headline: (document.querySelector('.dash-headline') || {}).textContent?.trim() || null,
          problem: (document.querySelector('.dash-problem') || {}).textContent?.trim() || null,
          chips: [...document.querySelectorAll('.dash-chip')].map((e) => e.textContent.trim()),
          actions: [...document.querySelectorAll('.dash-action-text')].map((e) => e.textContent.trim()),
        }))()`);
        if (!info.tag && !info.headline) {
          return { level: 'SKIP', detail: '页面无 .dash-rule-tag / .dash-headline，AI 建议模块可能未合入' };
        }
        // A12-1 明写「规则引擎」，不得伪装成 AI 预测
        const labelOk = !!info.tag && /规则引擎/.test(info.tag);
        // A12-2 caveat 常显（基于模拟数据）
        const caveatOk = /模拟数据/.test(info.tag || '') || (await evaluate(`/基于模拟数据/.test(document.body.innerText)`));
        // A12-3 建议带数字依据：headline 或 problem 里至少有一个百分号/数字
        const hasNumber = /\d/.test(`${info.headline || ''}${info.problem || ''}`);
        const problems = [];
        if (!labelOk) problems.push(`缺「规则引擎」标注（实际：${info.tag ?? '无'}）`);
        if (!caveatOk) problems.push('缺「基于模拟数据」caveat');
        if (!info.headline) problems.push('缺 headline');
        if (!hasNumber) {
          problems.push(`headline/problem 里没有数字（headline=${JSON.stringify(info.headline)} problem=${JSON.stringify(info.problem)} chips=${JSON.stringify(info.chips)}），建议可能是纯形容词`);
        }
        if (problems.length) return { level: 'FAIL', detail: problems.join('；') };
        return {
          level: 'PASS',
          detail: `${info.tag}｜headline「${(info.headline || '').slice(0, 30)}…」｜chips=${info.chips.length}｜actions=${info.actions.length}`,
        };
      },
    },
    {
      id: 'A12-5-no-fake-number',
      name: 'A12-5 缺指标时不产出假数字',
      async run() {
        // 纯函数层的判据，DOM 侧测不了：故意喂缺 aux 的 metrics，
        // 看 advisor 会不会把「未知」渲染成 0% / 100%。
        // 这里只能确认模块是否暴露了可测入口；真正的断言在 src/advisor.test.mjs。
        const has = await evaluate(`!!document.querySelector('.dash-rule-tag')`);
        if (!has) return { level: 'SKIP', detail: 'AI 建议模块未合入' };
        return {
          level: 'SKIP',
          detail: '需在 src/advisor.test.mjs 覆盖（缺 aux 时不得输出 0%/100%）；DOM 侧无法构造该输入',
        };
      },
    },
  ];
}

// ── 主流程 ────────────────────────────────────────────────────
const opts = parseArgs(process.argv.slice(2));

let ctx;
try {
  ctx = await connect(opts.port, opts.urlHint);
} catch (err) {
  console.error(`[FATAL] 连不上 CDP（端口 ${opts.port}）：${err.message}`);
  console.error('提示：Chrome 必须用独立 --user-data-dir 启动，并带上 --remote-debugging-port');
  process.exit(1);
}

// 给页面一点启动时间；不 sleep 可能在 Three.js 首帧前断言
await sleep(2500);

const results = [];
const allChecks = makeChecks(ctx).filter((c) => !opts.only || opts.only.includes(c.id));
if (!allChecks.length) {
  console.error(`[FATAL] --only 没有匹配到任何检查项：${opts.only.join(',')}`);
  ctx.ws.close();
  process.exit(1);
}
for (const check of allChecks) {
  let r;
  try {
    r = await check.run();
  } catch (err) {
    if (err instanceof EvalTimeout) {
      r = {
        level: 'WARN',
        detail: `${err.message}｜判据未判定：软渲染/WebGL 重绘可能阻塞主线程，请在 GPU 机复跑`,
      };
    } else {
      r = { level: 'FAIL', detail: `执行出错：${err.message}` };
    }
  }
  results.push({ id: check.id, name: check.name, ...r });
  if (opts.verbose) console.error(`  ${r.level.padEnd(4)} ${check.id} — ${r.detail}`);
}

const summary = results.reduce((acc, r) => { acc[r.level] = (acc[r.level] || 0) + 1; return acc; }, {});
const failed = results.filter((r) => r.level === 'FAIL');
const exitCode = failed.length ? 1 : (summary.WARN || summary.SKIP ? 2 : 0);

if (opts.json) {
  console.log(JSON.stringify({
    target: ctx.target.url,
    chrome: await (await fetch(`http://127.0.0.1:${opts.port}/json/version`)).json().then((v) => v.Browser).catch(() => null),
    summary, results,
    uncaught: ctx.events.exceptions.length,
    consoleErrors: ctx.events.consoleErrors.slice(0, 10),
  }, null, 2));
} else {
  console.log(`\n目标页：${ctx.target.url}`);
  console.log('─'.repeat(78));
  for (const r of results) {
    console.log(`${r.level.padEnd(5)} ${r.id.padEnd(24)} ${r.name}`);
    console.log(`      ${r.detail}`);
  }
  console.log('─'.repeat(78));
  console.log(`合计：PASS ${summary.PASS || 0} / FAIL ${summary.FAIL || 0} / WARN ${summary.WARN || 0} / SKIP ${summary.SKIP || 0}`);
  if (ctx.events.consoleErrors.length) {
    console.log(`\nconsole.error ${ctx.events.consoleErrors.length} 条（前 5）：`);
    for (const e of ctx.events.consoleErrors.slice(0, 5)) console.log(`  · ${String(e).slice(0, 160)}`);
  }
  console.log(exitCode === 0 ? '\n结论：全部通过' : exitCode === 1 ? '\n结论：有 FAIL，未通过' : '\n结论：无 FAIL，但有 WARN/SKIP 未判定');
}

ctx.ws.close();
process.exit(exitCode);
