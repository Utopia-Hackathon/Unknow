// 帧率监控降级逻辑单测（Issue #19 / E-03）。
//
// 边界：本文件只测「降级逻辑正确性」——采样窗口、阈值触发、只降不升、
// warmup 豁免、切标签页间隔丢弃、JSON 导出。
// **不测 1440×900 ≥30fps 的绝对帧率**：那是 GPU 机上的判据，本机 SwiftShader
// 无 GPU 判不了（见 ACCEPTANCE.md 注 1 / Issue #19），不得用本单测顶替。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerfMonitor, pixelRatioFor, QUALITY_LEVELS } from './perf.js';

// 注入递增时间戳喂帧，避免依赖真实 rAF 与墙上时钟。
function feed(monitor, frameMs, count, startTs = 0) {
  let t = startTs;
  for (let i = 0; i < count; i++) {
    t += frameMs;
    monitor.frame(t);
  }
  return t;
}

test('QUALITY_LEVELS 三档与 pixelRatio 取值', () => {
  assert.deepEqual(QUALITY_LEVELS, ['L0', 'L1', 'L2']);
  // L0 基准 ≤2，L1/L2 降到 1（只降画质不降交互）。
  assert.equal(pixelRatioFor(0) <= 2, true);
  assert.equal(pixelRatioFor(1), 1);
  assert.equal(pixelRatioFor(2), 1);
});

test('60fps 稳定运行在 L0，不误降档', () => {
  const p = createPerfMonitor({ debug: false });
  feed(p, 16.7, 200);
  const s = p.stats();
  assert.equal(s.level, 'L0');
  assert.equal(s.levelIndex, 0);
  assert.equal(s.droppedAt.length, 0);
  assert.ok(s.fpsMedian >= 55, `中位 fps 应接近 60，实际 ${s.fpsMedian}`);
});

test('滑动窗口上限 120 帧：采样数封顶不无限增长', () => {
  const p = createPerfMonitor({ debug: false, sampleWindow: 120 });
  feed(p, 16.7, 500);
  assert.equal(p.stats().samples, 120);
});

test('中位 fps < 24 持续 → 逐档降（2s 评估窗口）', () => {
  const p = createPerfMonitor({
    debug: false, evalIntervalMs: 2000, minSamples: 30,
    warmupFrames: 90, dropBelowFps: 24, panicBelowFps: 15,
  });
  feed(p, 16.7, 100);           // 先暖机 60fps 过 warmup
  assert.equal(p.stats().levelIndex, 0);
  feed(p, 50, 120, 1670);       // 20fps（>15 不触发 panic），持续跨多个 2s 窗口
  const s = p.stats();
  assert.ok(s.levelIndex >= 1, `应至少降一档，实际 ${s.level}`);
  assert.ok(s.droppedAt.length >= 1);
  assert.ok(s.droppedAt.some((d) => /中位/.test(d.reason)), '应记录中位 fps 触发的降档');
});

// #91 修订：单帧长帧不再直落 L2（首屏纹理上传/GC 都会偶发），必须连续 N 帧。
test('单帧 < 15fps 不 panic（#91：单帧可被首屏长帧误伤）', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 0, warmupMs: 0,
    panicStreakFrames: 3, panicBelowFps: 15,
    evalIntervalMs: 999999, minSamples: 999999,
  });
  feed(p, 16.7, 100);
  assert.equal(p.stats().levelIndex, 0);
  feed(p, 100, 1, 1670);        // 单独一帧 10fps
  assert.equal(p.stats().levelIndex, 0, '单帧不得触发 panic');
  assert.equal(p.stats().panicStreak, 1, '连续计数应记为 1');
});

test('连续 3 帧 < 15fps → 直落 L2（panic 分支）', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 0, warmupMs: 0,
    panicStreakFrames: 3, panicBelowFps: 15,
    evalIntervalMs: 999999, minSamples: 999999,
  });
  feed(p, 16.7, 100);           // 暖机
  assert.equal(p.stats().levelIndex, 0);
  feed(p, 100, 3, 1670);        // 连续 3 帧 10fps
  const s = p.stats();
  assert.equal(s.levelIndex, 2, '连续崩帧应直落 L2');
  assert.ok(s.droppedAt.some((d) => /连续 3 帧/.test(d.reason)), '应记录连续帧原因');
});

test('warmupMs 时间维度：帧数够了但时间没到也不判 panic', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 0, warmupMs: 3000,
    panicStreakFrames: 3, panicBelowFps: 15,
    evalIntervalMs: 999999, minSamples: 999999,
  });
  feed(p, 100, 5);              // 只过了 500ms < 3000ms
  assert.equal(p.stats().levelIndex, 0, 'warmupMs 内不判 panic');
  feed(p, 100, 10, 500);        // 累计 1500ms，仍不足
  assert.equal(p.stats().levelIndex, 0);
});

test('warmup 期内慢帧不触发 panic（首屏编译豁免）', () => {
  const p = createPerfMonitor({ debug: false, warmupFrames: 90, warmupMs: 0, panicBelowFps: 15 });
  feed(p, 100, 50);             // 前 50 帧全 10fps，但都在 warmup 内
  const s = p.stats();
  assert.equal(s.droppedAt.some((d) => /连续 .* 帧/.test(d.reason)), false,
    'warmup 内不应触发 panic 降档');
});

// #91 修订：允许回升一档，但有次数上限，避免阈值附近来回抖。
test('稳定高分可回升一档，但最多 1 次（#91）', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 0, warmupMs: 0,
    panicStreakFrames: 3, panicBelowFps: 15,
    evalIntervalMs: 1000, minSamples: 10,
    recoverAboveFps: 45, recoverStableMs: 3000, maxRecoveries: 1,
  });
  feed(p, 16.7, 20);
  feed(p, 100, 3, 334);         // 连续崩帧 → L2
  assert.equal(p.stats().levelIndex, 2);
  feed(p, 16.7, 300, 634);      // 恢复 60fps 约 5s，跨过 3s 稳定窗口
  const s = p.stats();
  assert.equal(s.levelIndex, 1, '应回升一档到 L1');
  assert.equal(s.recoveries, 1);
  assert.ok(s.droppedAt.some((d) => d.direction === 'up'), '历史里应有 up 记录');
  feed(p, 16.7, 400, 5634);     // 再稳定很久
  assert.equal(p.stats().levelIndex, 1, '回升上限 1 次，不得继续回 L0');
  assert.equal(p.stats().recoveries, 1);
});

test('未稳定足够久不回升', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 0, warmupMs: 0,
    panicStreakFrames: 3, panicBelowFps: 15,
    evalIntervalMs: 1000, minSamples: 10,
    recoverAboveFps: 45, recoverStableMs: 10000, maxRecoveries: 1,
  });
  feed(p, 16.7, 20);
  feed(p, 100, 3, 334);         // → L2
  feed(p, 16.7, 200, 634);      // 恢复高分约 3.3s，< 10s 稳定窗口
  assert.equal(p.stats().levelIndex, 2, '稳定时长不足不回升');
});

test('切标签页回来的巨大间隔被丢弃，不污染采样', () => {
  const p = createPerfMonitor({ debug: false });
  let s = feed(p, 16.7, 40);
  const before = p.stats().samples;
  p.frame(s + 5000);            // 5s 间隔（切标签页）应被丢弃
  p.frame(s + 5016.7);
  p.frame(s + 5033.4);
  assert.equal(p.stats().samples, before + 2, '仅后两帧计入，5s 间隔丢弃');
  assert.ok(p.stats().frameMsMax < 100, `最大帧耗不应被 5000ms 污染，实际 ${p.stats().frameMsMax}`);
});

test('样本不足不判：minSamples 之前不降档', () => {
  const p = createPerfMonitor({ debug: false, minSamples: 30, warmupFrames: 90 });
  feed(p, 100, 10);             // 10 帧 < 30 样本下限
  assert.equal(p.stats().levelIndex, 0);
  assert.equal(p.stats().droppedAt.length, 0);
});

test('dump() 返回可落盘的 JSON 结构（含验收所需字段）', () => {
  const p = createPerfMonitor({ debug: false });
  feed(p, 16.7, 60);
  const d = p.dump();
  for (const key of ['level', 'levelIndex', 'samples', 'fpsMedian', 'frameMsP95',
    'frameMsMax', 'droppedAt', 'viewport', 'capturedAt']) {
    assert.ok(key in d, `dump 应含 ${key}`);
  }
  assert.equal(typeof JSON.stringify(d), 'string', '必须可 JSON 序列化');
});

test('reset() 清空采样与降档历史，回到 L0', () => {
  const p = createPerfMonitor({ debug: false, warmupFrames: 90, panicBelowFps: 15 });
  feed(p, 16.7, 100);
  feed(p, 100, 30, 1670);
  assert.equal(p.stats().levelIndex, 2);
  p.reset();
  const s = p.stats();
  assert.equal(s.level, 'L0');
  assert.equal(s.samples, 0);
  assert.equal(s.droppedAt.length, 0);
});
