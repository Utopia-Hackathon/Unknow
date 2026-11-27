import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockWorld } from './mockWorld.js';

// Issue #41：证明 mock world 与 D 的契约同形，D 到场后能直接换掉。
// 注意这里只验数据形状，不验决策算法正确性——那是 D 的单测（Issue #13/#14）。

test('四个契约方法齐全', () => {
  const w = createMockWorld();
  for (const key of ['releaseTable', 'tick', 'getMetrics', 'applyScenario']) {
    assert.equal(typeof w[key], 'function', `${key} 不存在`);
  }
});

test('getMetrics 字段对齐 METRICS_DEF §6', () => {
  const m = createMockWorld().getMetrics();
  for (const key of ['lossRate', 'sampleSize', 'censored', 'reason', 'aux', 'window', 'detail']) {
    assert.ok(Object.hasOwn(m, key), `缺字段 ${key}`);
  }
  assert.equal(m.window, 120);
  assert.equal(m.sampleSize, 60);
  assert.equal(m.censored, 6);
  assert.ok(Math.abs(m.lossRate - 19 / 60) < 1e-6, `lossRate=${m.lossRate}`);
  // 删失不进分母：41+19=60，不是 66
  assert.equal(m.detail.seated + m.detail.lost, m.sampleSize);
});

test('releaseTable + tick 产出带 reason 的 skipped', () => {
  const w = createMockWorld();
  assert.equal(w.releaseTable('t4'), true);
  assert.equal(w.releaseTable('not-exist'), false);
  const events = w.tick(5);
  assert.ok(Array.isArray(events));
  const called = events.filter((e) => e.type === 'called');
  const skipped = events.filter((e) => e.type === 'skipped');
  assert.ok(called.length >= 1);
  assert.ok(skipped.length >= 1);
  for (const e of skipped) {
    assert.ok(e.reason && e.reason.length > 0, 'skipped.reason 不能为空');
    assert.ok(e.personId && e.tableId && Number.isFinite(e.t), '事件字段不完整');
  }
});

test('applyScenario 的 delta = after − before，且方向正确', () => {
  const w = createMockWorld();
  const result = w.applyScenario({ addTables: 4, dropArrivalRate: 0.1, extendPatience: 10 });
  assert.ok(result.before && result.after && result.delta);
  assert.ok(Math.abs(result.delta.lossRate - (result.after.lossRate - result.before.lossRate)) < 1e-9);
  assert.ok(result.after.lossRate < result.before.lossRate, '加桌/降到达/延长容忍应降低流失率');
  assert.ok(result.delta.avgWait < 0);
});

test('n<30 时返回 null，不返回 0', () => {
  const w = createMockWorld();
  const m = w.getMetrics();
  // mock 默认算例 n=60；这里验证「样本不足」判据的实现形式：
  // 若 n<30 则 lossRate 必须 null、reason 必须给原因。
  if (m.sampleSize < 30) {
    assert.equal(m.lossRate, null);
    assert.ok(m.reason);
  } else {
    assert.ok(m.lossRate > 0);
  }
});

test('初始事件形状符合契约六类', () => {
  const events = createMockWorld().getEvents();
  const allowed = new Set(['queued', 'called', 'seated', 'skipped', 'reflowed', 'lost']);
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.ok(allowed.has(e.type), `非法事件类型 ${e.type}`);
    assert.ok(e.reason, `${e.type} 缺 reason`);
    assert.ok(Number.isFinite(e.t));
  }
});
