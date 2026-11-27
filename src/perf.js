// 帧率采样与自动降级（Issue #19 / E-03）。
//
// 为什么单独一个文件：验收要求「帧率」这条判据可判定，而不是靠目测。
// 采样点必须在渲染循环里，但采样逻辑不该和交互、场景代码缠在一起。
//
// 三档降级（只降画质，不降交互）：
//   L0 基准 —— pixelRatio ≤ 2
//   L1      —— pixelRatio → 1
//   L2      —— pixelRatio 1 + 关额外细节（由 scene 侧回调决定能关什么）
//
// 触发规则：窗内中位 fps < 24 → 降一档；单帧低到 < 15 fps 的瞬间 → 直接落 L2。
// 只降不升：阈值附近来回抖比一直低更难受，也更容易在答辩时被看出画面在闪。

export const QUALITY_LEVELS = ['L0', 'L1', 'L2'];

const DEFAULTS = {
  sampleWindow: 120,      // 帧数窗口，约 2s @60fps
  evalIntervalMs: 2000,   // 评估间隔：不够 2s 不下结论
  minSamples: 30,         // 样本不足不判（首屏加载那几帧不能算）
  warmupFrames: 90,       // 前 90 帧不判瞬时崩帧：首屏编译着色器必然有几帧几百 ms
  dropBelowFps: 24,       // 硬下限，低于即降档
  panicBelowFps: 15,      // 瞬时崩溃线，直接落底
  hudIntervalMs: 500,     // HUD 刷新节流（每帧重排会自己拖慢自己）
  startLevel: 0,
  onLevelChange: null,    // (level: 0|1|2, info) => void
  debug: false,           // ?debug=1 时显示角落 HUD
};

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

export function createPerfMonitor(options = {}) {
  const cfg = { ...DEFAULTS, ...options };

  const frameTimes = [];      // 环形窗口，存每帧耗时 ms
  const levelHistory = [];    // 降档历史，验收要能复查「什么时候降的」
  let level = cfg.startLevel;
  let lastFrameTs = null;
  let lastEvalTs = 0;
  let framesSinceEval = 0;
  let totalFrames = 0;
  let peakFrameMs = 0;
  let hudEl = null;
  let lastHudTs = 0;

  function currentFps() {
    const m = median(frameTimes);
    return m > 0 ? 1000 / m : 0;
  }

  function stats() {
    const times = frameTimes.slice();
    const medFrame = median(times);
    return {
      level: QUALITY_LEVELS[level],
      levelIndex: level,
      samples: times.length,
      fpsMedian: medFrame > 0 ? +(1000 / medFrame).toFixed(1) : 0,
      fpsMin: times.length ? +(1000 / Math.max(...times)).toFixed(1) : 0,
      frameMsMedian: +medFrame.toFixed(2),
      frameMsP95: +percentile(times, 95).toFixed(2),
      frameMsMax: +Math.max(0, ...times).toFixed(2),
      droppedAt: levelHistory.slice(),
      pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      viewport: typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight}`
        : '',
      capturedAt: new Date().toISOString(),
    };
  }

  function setLevel(next, reason) {
    const target = Math.min(next, QUALITY_LEVELS.length - 1);
    if (target <= level) return; // 只降不升；已在目标档也不重复记历史
    const from = level;
    level = target;
    levelHistory.push({ from: QUALITY_LEVELS[from], to: QUALITY_LEVELS[level], reason, fps: +currentFps().toFixed(1) });
    if (cfg.onLevelChange) cfg.onLevelChange(level, stats());
    renderHud();
  }

  // 瞬时崩帧（如某一帧卡 100ms）改的是「最近一帧」，不是窗口中位——
  // 一帧坏帧拉不动中位数，但用户能看见一次明显的顿。所以这条每帧判，不等 2s 窗口。
  // 前 warmupFrames 帧不判：首屏编译着色器、上传纹理本来就有几百 ms 的长帧，
  // 那不是「弱机」，照着降档会一进页面就掉到最低画质。
  function checkPanic() {
    if (totalFrames <= cfg.warmupFrames) return;
    const lastMs = frameTimes.length ? frameTimes[frameTimes.length - 1] : 0;
    if (!lastMs) return;
    const instantFps = 1000 / lastMs;
    if (instantFps < cfg.panicBelowFps) {
      setLevel(QUALITY_LEVELS.length - 1, `瞬时单帧 ${instantFps.toFixed(1)} fps < ${cfg.panicBelowFps}`);
    }
  }

  function evaluate(nowTs) {
    if (frameTimes.length < cfg.minSamples) return;
    if (nowTs - lastEvalTs < cfg.evalIntervalMs) return;
    lastEvalTs = nowTs;
    framesSinceEval = 0;

    const fps = currentFps();
    if (fps < cfg.dropBelowFps) {
      setLevel(level + 1, `${cfg.evalIntervalMs / 1000}s 中位 ${fps.toFixed(1)} fps < ${cfg.dropBelowFps}`);
    }
  }

  // 每帧调用一次。ts 用 requestAnimationFrame 给的时间戳，别自己取时间（两者会打架）。
  function frame(ts) {
    if (typeof ts !== 'number') ts = performance.now();
    if (lastFrameTs != null) {
      const dt = ts - lastFrameTs;
      if (dt > 0 && dt < 2000) { // 切标签页回来会有一个巨大间隔，丢掉
        frameTimes.push(dt);
        if (frameTimes.length > cfg.sampleWindow) frameTimes.shift();
        if (dt > peakFrameMs) peakFrameMs = dt;
      }
    }
    lastFrameTs = ts;
    framesSinceEval += 1;
    totalFrames += 1;
    checkPanic();
    evaluate(ts);
    if (hudEl && ts - lastHudTs > cfg.hudIntervalMs) {
      lastHudTs = ts;
      updateHud();
    }
  }

  function renderHud() {
    if (!cfg.debug || typeof document === 'undefined') return;
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.id = 'perf-hud';
      hudEl.style.cssText = [
        'position:fixed', 'right:12px', 'bottom:12px', 'z-index:9999',
        'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'color:#e2e8f0', 'background:rgba(15,23,42,.86)', 'padding:7px 10px',
        'border-radius:6px', 'pointer-events:none', 'white-space:pre',
        'letter-spacing:.02em',
      ].join(';');
      document.body.appendChild(hudEl);
    }
    const s = stats();
    hudEl.textContent = `${s.level}  ${s.fpsMedian.toFixed(0)} fps\nP95 ${s.frameMsP95.toFixed(1)}ms  max ${s.frameMsMax.toFixed(0)}ms\nn=${s.samples}`;
  }

  function updateHud() { renderHud(); }

  // 导出 JSON：验收证据要能落盘，不能只打在 console 里。
  function dump() {
    const payload = stats();
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `perf-${payload.capturedAt.replace(/[:.]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch {
      // 下载失败不影响采样，返回值仍可取用
    }
    return payload;
  }

  function reset() {
    frameTimes.length = 0;
    levelHistory.length = 0;
    lastFrameTs = null;
    lastEvalTs = 0;
    totalFrames = 0;
    framesSinceEval = 0;
    peakFrameMs = 0;
    level = cfg.startLevel;
  }

  if (cfg.debug && typeof window !== 'undefined') {
    // 控制台留两个口子：看数字、拿文件。答辩前记得不用 ?debug=1 打开页面。
    window.__perf = { stats, dump, reset };
  }

  return { frame, stats, dump, reset, getLevel: () => level, renderHud };
}

// pixelRatio 按档位取值。0 → ≤2，1 → 1，2 → 1（细节另由场景侧关）。
export function pixelRatioFor(levelIndex) {
  const base = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return levelIndex >= 1 ? 1 : Math.min(base, 2);
}
