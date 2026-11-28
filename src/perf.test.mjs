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

test('瞬时单帧 < 15fps → 直接落 L2（panic 分支）', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 90, dropBelowFps: 24, panicBelowFps: 15,
  });
  feed(p, 16.7, 100);           // 暖机
  assert.equal(p.stats().levelIndex, 0);
  feed(p, 100, 30, 1670);       // 10fps 单帧 < 15 → panic
  const s = p.stats();
  assert.equal(s.levelIndex, 2, '瞬时崩帧应直落 L2');
  assert.ok(s.droppedAt.some((d) => /瞬时单帧/.test(d.reason)), '应记录 panic 原因');
});

test('warmup 期内慢帧不触发 panic（首屏编译豁免）', () => {
  const p = createPerfMonitor({ debug: false, warmupFrames: 90, panicBelowFps: 15 });
  feed(p, 100, 50);             // 前 50 帧全 10fps，但都在 warmup 内
  const s = p.stats();
  assert.equal(s.droppedAt.some((d) => /瞬时单帧/.test(d.reason)), false,
    'warmup 内不应触发 panic 降档');
});

test('只降不升：恢复 60fps 后档位不回升', () => {
  const p = createPerfMonitor({
    debug: false, warmupFrames: 90, dropBelowFps: 24, panicBelowFps: 15,
  });
  feed(p, 16.7, 100);
  feed(p, 100, 30, 1670);       // 触发 panic → L2
  const dropped = p.stats().levelIndex;
  assert.equal(dropped, 2);
  feed(p, 16.7, 300, 4670);     // 恢复高速
  assert.equal(p.stats().levelIndex, 2, '档位不得回升');
  assert.equal(p.stats().droppedAt.length, 1, '不得重复记升档');
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
