import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../index.js';

test('释放 2 人桌时跳过不合桌型的队首，并叫号、安排后面的顾客', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2, availableAt: 20 }],
    arrivals: [
      { personId: 'large', t: 0, partySize: 4 },
      { personId: 'small', t: 0, partySize: 2 },
    ],
  });

  assert.equal(world.releaseTable('t1'), true);
  const events = world.tick(0);
  assert.deepEqual(events.map(({ type, personId }) => [type, personId]), [
    ['queued', 'large'], ['queued', 'small'], ['skipped', 'large'], ['called', 'small'], ['seated', 'small'],
  ]);
  assert.equal(events[2].tableId, 't1');
  assert.match(events[2].reason, /4 人，空桌仅 2 座/);
  assert.ok(events.every(({ reason }) => reason.trim()));
  assert.deepEqual(world.tick(0), []);
  assert.equal(world.tables[0].occupied, true);
  assert.equal(world.getMetrics().censored, 1);
  assert.deepEqual(world.tick(4).map(({ type, personId }) => [type, personId]), [['reflowed', 'large']]);
});

test('叫号时不在场的顾客在宽限期后回捞、重新叫号并入座', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: [{ personId: 'late', t: 0, partySize: 2, noShow: true, patience: 10 }],
    recallDelay: 4,
  });

  const firstCall = world.tick(0);
  assert.deepEqual(firstCall.map(({ type }) => type), ['queued', 'called', 'skipped']);
  assert.match(firstCall.at(-1).reason, /不在场/);
  assert.equal(world.tables[0].occupied, false);
  assert.deepEqual(world.tick(3), []);

  const secondCall = world.tick(1);
  assert.deepEqual(secondCall.map(({ type }) => type), ['reflowed', 'called', 'seated']);
  assert.ok(secondCall.every(({ personId, t }) => personId === 'late' && t === 4));
  assert.equal(world.getMetrics().aux.avgWait, 4);
  assert.equal(world.getMetrics().aux.reflowSuccess, 1);
});

test('到达容忍时限的顾客只流失一次，后续不再回捞', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: [{ personId: 'absent', t: 0, partySize: 2, noShow: true, patience: 3 }],
    recallDelay: 4,
  });

  world.tick(0);
  const events = world.tick(20);
  assert.deepEqual(events.map(({ type, t }) => [type, t]), [['lost', 3]]);
  assert.match(events[0].reason, /容忍时长/);
  const metrics = world.getMetrics();
  assert.equal(metrics.detail.lost, 1);
  assert.equal(metrics.sampleSize, 1);
  assert.equal(metrics.censored, 0);
  assert.equal(metrics.lossRate, null);
});

test('空队列释放桌位安全，未知桌位不会产生事件', () => {
  const world = createWorld({ tables: [{ id: 't1', seats: 2, availableAt: 20 }], arrivals: [] });
  assert.equal(world.releaseTable('unknown'), false);
  assert.equal(world.releaseTable('t1'), true);
  assert.equal(world.tables[0].occupied, false);
  assert.deepEqual(world.tick(5), []);
  assert.throws(() => world.tick(-1), RangeError);
  assert.equal(world.getMetrics().window.minutes, 5);
});

test('同一 seed 的事件和指标可复现，分段推进与一次推进相同', () => {
  const whole = createWorld({ seed: 7 });
  const split = createWorld({ seed: 7 });
  const events = whole.tick(120);
  const batches = Array.from({ length: 24 }, () => split.tick(5)).flat();
  assert.deepEqual(batches, events);
  assert.deepEqual(split.getMetrics(), whole.getMetrics());
  assert.notDeepEqual(createWorld({ seed: 8 }).tick(120), events);
});

test('桌位按门店归属匹配，其他店的顾客继续等位', () => {
  const world = createWorld({
    stores: [{ id: 'a' }, { id: 'b' }],
    tables: [{ id: 't1', seats: 2, storeId: 'a' }],
    arrivals: [
      { personId: 'b1', t: 0, partySize: 2, storeId: 'b' },
      { personId: 'a1', t: 0, partySize: 2, storeId: 'a' },
    ],
  });
  const seated = world.tick(0).filter(({ type }) => type === 'seated');
  assert.deepEqual(seated.map(({ personId, storeId }) => [personId, storeId]), [['a1', 'a']]);
  assert.equal(world.getMetrics().censored, 1);
});

test('流失率复现 19 / 60，按 personId 去重并剔除窗口尾部删失', () => {
  const arrivals = [
    ...Array.from({ length: 41 }, (_, t) => ({ personId: `seated-${t}`, t, partySize: 2, dineMinutes: 0.5 })),
    { personId: 'seated-0', t: 0.75, partySize: 2 },
    ...Array.from({ length: 19 }, (_, index) => ({ t: 42 + index, partySize: 4, patience: 2 })),
    ...Array.from({ length: 6 }, () => ({ t: 119, partySize: 4, patience: 3 })),
    { t: 120, partySize: 2 },
  ];
  const world = createWorld({ tables: [{ id: 't1', seats: 2 }], arrivals });
  world.tick(120);
  const metrics = world.getMetrics();
  assert.equal(metrics.lossRate, 19 / 60);
  assert.equal(metrics.sampleSize, 60);
  assert.equal(metrics.censored, 6);
  assert.equal(metrics.detail.queued, 66);
  assert.equal(metrics.detail.seated, 41);
  assert.equal(metrics.detail.dedupRemoved, 1);
  assert.equal(metrics.reason, null);
  assert.deepEqual(metrics.window, { start: 0, minutes: 120 });
  world.tick(20);
  assert.deepEqual(world.getMetrics(), metrics);
});

test('样本门槛恰为 30，无数据的辅助指标为空', () => {
  const world = createWorld({
    tables: [],
    arrivals: Array.from({ length: 30 }, (_, t) => ({ t, partySize: 2, patience: 1 })),
  });
  world.tick(29);
  const partial = world.getMetrics();
  assert.equal(partial.sampleSize, 29);
  assert.equal(partial.lossRate, null);
  assert.match(partial.reason, /样本不足/);
  assert.deepEqual(partial.aux, { skipOutRate: null, avgWait: null, idleTableRatio: null, reflowSuccess: null });
  world.tick(1);
  assert.equal(world.getMetrics().sampleSize, 30);
  assert.equal(world.getMetrics().lossRate, 1);
});

test('空置占比按窗口内实际桌分钟计算，提前释放会截断原占用', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2, availableAt: 20 }],
    arrivals: [{ t: 0, partySize: 2, dineMinutes: 3 }],
  });
  world.tick(5);
  world.releaseTable('t1');
  world.tick(5);
  assert.equal(world.getMetrics(10).aux.idleTableRatio, 2 / 10);
  assert.equal(world.getMetrics(10).aux.avgWait, 5);
});
