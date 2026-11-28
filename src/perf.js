// 帧率采样与自动降级（Issue #19 / E-03，判据修订见 Issue #91 / C-11）。
//
// 为什么单独一个文件：验收要求「帧率」这条判据可判定，而不是靠目测。
// 采样点必须在渲染循环里，但采样逻辑不该和交互、场景代码缠在一起。
//
// 三档降级（只降画质，不降交互）：
//   L0 基准 —— pixelRatio ≤ 2
//   L1      —— pixelRatio → 1
//   L2      —— pixelRatio 1 + 关额外细节（由 scene 侧回调决定能关什么）
//
// 触发规则（#91 修订后）：
//   1. 窗内中位 fps < 24 持续一个评估周期 → 降一档；
//   2. 连续 panicStreakFrames 帧都 < 15 fps 才直落 L2（**不再看单帧**：
//      首屏纹理上传/GC/着色器编译都可能偶发一帧长帧，单帧就落底会让整场永久最低画质）；
//   3. 稳定 recoverStableMs 且中位 ≥ 45 fps → 回升一档，最多 maxRecoveries 次
//      （有上限才不会在阈值附近来回抖，观感也不闪）。
//
// 预热同时看「帧数」与「时间」：弱机前 90 帧可能拖到 5 秒以上，
// 只按帧数会把首屏长帧算进判定，一进页面就掉档。

export const QUALITY_LEVELS = ['L0', 'L1', 'L2'];

const DEFAULTS = {
  sampleWindow: 120,        // 帧数窗口，约 2s @60fps
  evalIntervalMs: 2000,     // 评估间隔：不够 2s 不下结论
  minSamples: 30,           // 样本不足不判（首屏加载那几帧不能算）
  warmupFrames: 90,         // 前 90 帧不判：首屏编译着色器必然有几帧几百 ms
  warmupMs: 3000,           // 且至少过 3s（帧数与时间取较晚者）
  dropBelowFps: 24,         // 硬下限：中位低于即降一档
  panicBelowFps: 15,        // 崩溃线：连续 N 帧低于此值才直落 L2
  panicStreakFrames: 3,     // 连续多少帧才算真崩（#91：单帧不算）
  recoverAboveFps: 45,      // 回升所需的中位 fps
  recoverStableMs: 5000,    // 需稳定这么久才回升
  maxRecoveries: 1,         // 最多回升次数，防止来回抖
  hudIntervalMs: 500,       // HUD 刷新节流（每帧重排会自己拖慢自己）
  startLevel: 0,
  onLevelChange: null,      // (level: 0|1|2, info) => void
  debug: false,             // ?debug=1 时显示角落 HUD
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
  const levelHistory = [];    // 档位变化历史，验收要能复查「什么时候、为什么变的」
  let level = cfg.startLevel;
  let lastFrameTs = null;
  let firstFrameTs = null;
  let lastEvalTs = 0;
  let framesSinceEval = 0;
  let totalFrames = 0;
  let peakFrameMs = 0;
  let panicStreak = 0;        // 连续低于 panicBelowFps 的帧数
  let recoverCount = 0;       // 已回升次数
  let stableSinceTs = null;   // 中位达标从何时起算
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
      panicStreak,
      recoveries: recoverCount,
      pixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      viewport: typeof window !== 'undefined'
        ? `${window.innerWidth}x${window.innerHeight}`
        : '',
      capturedAt: new Date().toISOString(),
    };
  }

  // 档位变化（升降都记）：history 带 direction，验收能区分「降档」与「回升」。
  function setLevel(next, reason) {
    const target = Math.max(0, Math.min(next, QUALITY_LEVELS.length - 1));
    if (target === level) return;
    const from = level;
    level = target;
    levelHistory.push({
      from: QUALITY_LEVELS[from],
      to: QUALITY_LEVELS[level],
      direction: target > from ? 'down' : 'up',
      reason,
      fps: +currentFps().toFixed(1),
      atMs: lastFrameTs != null && firstFrameTs != null
        ? Math.round(lastFrameTs - firstFrameTs)
        : null,
    });
    if (cfg.onLevelChange) cfg.onLevelChange(level, stats());
    renderHud();
  }

  // 预热：帧数与时间都要过，取较晚者。
  function warmedUp(ts) {
    if (totalFrames <= cfg.warmupFrames) return false;
    if (firstFrameTs != null && ts - firstFrameTs < cfg.warmupMs) return false;
    return true;
  }

  // 连续崩帧才算 panic。单帧长帧改不了窗口中位，但连续长帧说明真的扛不住。
  function checkPanic(ts) {
    if (!warmedUp(ts)) return;
    const lastMs = frameTimes.length ? frameTimes[frameTimes.length - 1] : 0;
    if (!lastMs) return;
    const instantFps = 1000 / lastMs;
    if (instantFps < cfg.panicBelowFps) {
      panicStreak += 1;
      if (panicStreak >= cfg.panicStreakFrames) {
        setLevel(
          QUALITY_LEVELS.length - 1,
          `连续 ${panicStreak} 帧 < ${cfg.panicBelowFps} fps（窗口内中位 ${currentFps().toFixed(1)} fps）`
        );
        panicStreak = 0;
      }
    } else {
      panicStreak = 0;
    }
  }

  function evaluate(nowTs) {
    if (frameTimes.length < cfg.minSamples) return;
    if (nowTs - lastEvalTs < cfg.evalIntervalMs) return;
    lastEvalTs = nowTs;

    const fps = currentFps();

    // 降档：中位持续低于硬下限
    if (fps < cfg.dropBelowFps) {
      stableSinceTs = null;
      setLevel(level + 1, `${cfg.evalIntervalMs / 1000}s 中位 ${fps.toFixed(1)} fps < ${cfg.dropBelowFps}`);
      return;
    }

    // 回升：只回一档、有次数上限、必须稳定足够久
    if (level > 0 && recoverCount < cfg.maxRecoveries && fps >= cfg.recoverAboveFps) {
      if (stableSinceTs == null) stableSinceTs = nowTs;
      if (nowTs - stableSinceTs >= cfg.recoverStableMs) {
        setLevel(
          level - 1,
          `稳定 ${(cfg.recoverStableMs / 1000).toFixed(0)}s 中位 ${fps.toFixed(1)} fps ≥ ${cfg.recoverAboveFps}，回升一档`
        );
        recoverCount += 1;
        stableSinceTs = null;
      }
    } else {
      stableSinceTs = null;
    }
  }

  // 每帧调用一次。ts 用 requestAnimationFrame 给的时间戳，别自己取时间（两者会打架）。
  function frame(ts) {
    if (typeof ts !== 'number') ts = performance.now();
    if (firstFrameTs == null) firstFrameTs = ts;
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
    checkPanic(ts);
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
    firstFrameTs = null;
    lastEvalTs = 0;
    totalFrames = 0;
    framesSinceEval = 0;
    peakFrameMs = 0;
    panicStreak = 0;
    recoverCount = 0;
    stableSinceTs = null;
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
