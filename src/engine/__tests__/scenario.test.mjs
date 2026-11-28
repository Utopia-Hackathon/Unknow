import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../index.js';

test('策略对照固定 120 分钟、客流和桌位，比较 FIFO 与桌型匹配加回捞', () => {
  const world = createWorld();
  const policy = world.applyScenario();
  world.tick(120);

  assert.equal(policy.before.detail.queued, policy.after.detail.queued);
  assert.equal(policy.before.detail.reflowed, 0);
  assert.ok(policy.after.detail.reflowed > 0);
  assert.deepEqual(policy.before.window, { start: 0, minutes: 120 });
  assert.deepEqual(policy.after, world.getMetrics());
  assert.ok(policy.delta.lossRate < 0);
  assert.equal(policy.delta.lossRate, policy.after.lossRate - policy.before.lossRate);
  assert.equal(policy.relDelta, policy.delta.lossRate / policy.before.lossRate);
});

test('拥堵样例中加桌降低流失率，数值和桌型参数结果一致', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: Array.from({ length: 40 }, (_, index) => ({
      t: index * 2, partySize: 2, patience: 10, dineMinutes: 12,
    })),
  });
  world.tick(120);
  const before = world.getMetrics();
  const byType = world.applyScenario({ addTables: { '2人桌': 2 } });
  assert.deepEqual(byType, world.applyScenario({ addTables: 2 }));
  assert.deepEqual(byType.before, before);
  assert.ok(byType.after.detail.seated > before.detail.seated);
  assert.ok(byType.after.lossRate < before.lossRate);
  assert.deepEqual(world.getMetrics(), before);
  assert.equal(world.tables.length, 1);
});

test('联合方案保留各参数的单项结果，推演不改变事件、桌位与当前指标', () => {
  const world = createWorld({ seed: 20261127 });
  world.tick(10);
  world.releaseTable('t3');
  world.tick(110);
  const before = world.getMetrics();
  const events = world.getEvents();
  const tables = world.tables;
  const params = { addTables: 4, dropArrivalRate: 0.15, extendPatience: 10 };
  const combined = world.applyScenario(params);

  assert.deepEqual(combined.before, before);
  assert.deepEqual(Object.keys(combined.comparisons), Object.keys(params));
  for (const [key, value] of Object.entries(params)) {
    assert.deepEqual(combined.comparisons[key], world.applyScenario({ [key]: value }));
  }
  assert.ok(combined.comparisons.dropArrivalRate.after.detail.queued < before.detail.queued);
  assert.equal(combined.comparisons.extendPatience.after.detail.queued, before.detail.queued);
  assert.deepEqual(world.getMetrics(), before);
  assert.deepEqual(world.getEvents(), events);
  assert.deepEqual(world.tables, tables);
  assert.deepEqual(world.tick(0), []);
});

test('零改动保持基线一致，基线流失率为 0 时不计算相对变化', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: Array.from({ length: 30 }, (_, t) => ({ t, partySize: 2, dineMinutes: 0.5 })),
  });
  world.tick(45);

  const result = world.applyScenario({ addTables: 0 });
  assert.deepEqual(result.before, world.getMetrics());
  assert.deepEqual(result.after, result.before);
  assert.equal(result.delta.lossRate, 0);
  assert.equal(result.relDelta, null);
});

test('推演任意一侧样本不足时差值为空，非法参数不推进模拟', () => {
  const world = createWorld();
  world.tick(4);
  const before = world.getMetrics();
  const scenario = world.applyScenario({ dropArrivalRate: 0.5 });
  assert.equal(scenario.before.lossRate, null);
  assert.equal(scenario.after.lossRate, null);
  assert.equal(scenario.delta.lossRate, null);
  assert.equal(scenario.relDelta, null);
  assert.throws(() => world.applyScenario({ dropArrivalRate: 2 }), RangeError);
  assert.throws(() => world.applyScenario({ addTables: { '2人桌': -1 } }), RangeError);
  assert.deepEqual(world.getMetrics(), before);
});
