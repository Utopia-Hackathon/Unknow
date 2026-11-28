import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorld } from '../index.js';

test('A04-called 释放空桌后叫到合适顾客，并记录跳号原因', () => {
  const world = createWorld({
    tables: [{ id: 'small-table', seats: 2, availableAt: 15 }],
    arrivals: [
      { personId: 'party-of-four', t: 0, partySize: 4 },
      { personId: 'party-of-two', t: 1, partySize: 2 },
    ],
  });
  assert.deepEqual(world.tick(2).map(({ type }) => type), ['queued', 'queued']);

  assert.equal(world.releaseTable('small-table'), true);
  const events = world.tick(0);
  const called = events.find(({ type }) => type === 'called');
  const skipped = events.find(({ type }) => type === 'skipped');
  assert.ok(called && skipped);
  assert.equal(called.personId, 'party-of-two');
  assert.equal(called.tableId, 'small-table');
  assert.equal(skipped.personId, 'party-of-four');
  assert.equal(skipped.tableId, 'small-table');
  assert.match(skipped.reason, /桌型不匹配/);
});

test('A05-reflow 叫号缺席后回捞的是同一位顾客', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: [{ personId: 'away', t: 0, partySize: 2, noShow: true, patience: 10 }],
    recallDelay: 4,
  });
  const missed = world.tick(0).find(({ type }) => type === 'skipped');
  assert.ok(missed);
  assert.equal(missed.personId, 'away');
  assert.match(missed.reason, /不在场/);

  const events = world.tick(4);
  const recovered = events.find(({ type }) => type === 'reflowed');
  assert.ok(recovered && recovered.reason.trim());
  assert.equal(recovered.personId, missed.personId);
  assert.ok(events.some(({ type, personId }) => type === 'seated' && personId === missed.personId));
});

test('A06-lost 重复取号只产生一次流失，流失人数和事件一致', () => {
  const world = createWorld({
    tables: [],
    arrivals: [
      { personId: 'p1', t: 0, partySize: 2, patience: 3 },
      { personId: 'p1', t: 1, partySize: 2, patience: 3 },
      { personId: 'p2', t: 2, partySize: 4, patience: 3 },
    ],
  });
  const lost = world.tick(10).filter(({ type }) => type === 'lost');
  assert.deepEqual(lost.map(({ personId }) => personId), ['p1', 'p2']);
  assert.ok(lost.every(({ reason }) => reason.trim()));

  const { detail, sampleSize, censored } = world.getMetrics();
  assert.equal(detail.lost, new Set(lost.map(({ personId }) => personId)).size);
  assert.equal(detail.dedupRemoved, 1);
  assert.equal(sampleSize, 2);
  assert.equal(censored, 0);
});

test('A07-lossRate 120 分钟窗口使用 19 / 60，单列 6 位删失顾客', () => {
  const world = createWorld({
    tables: [{ id: 't1', seats: 2 }],
    arrivals: [
      ...Array.from({ length: 41 }, (_, t) => ({ t, partySize: 2, dineMinutes: 0.5 })),
      ...Array.from({ length: 19 }, (_, i) => ({ t: 42 + i, partySize: 4, patience: 2 })),
      ...Array.from({ length: 6 }, () => ({ t: 119, partySize: 4, patience: 3 })),
      { t: 120, partySize: 2 },
    ],
  });
  world.tick(28);
  const partial = world.getMetrics();
  assert.equal(partial.sampleSize, 29);
  assert.equal(partial.lossRate, null);
  assert.match(partial.reason, /样本不足/);

  world.tick(92);
  const full = world.getMetrics();
  assert.equal(full.detail.seated, 41);
  assert.equal(full.detail.lost, 19);
  assert.equal(full.sampleSize, 60);
  assert.equal(full.censored, 6);
  assert.equal(full.lossRate, 19 / 60);
  assert.equal(full.reason, null);
  assert.deepEqual(full.window, { start: 0, minutes: 120 });
  world.tick(10);
  assert.deepEqual(world.getMetrics(), full);
});

test('A07-scenario 增加 4 张 2 人桌复现 50.0% → 27.9%，下降 22.1 个百分点', () => {
  const world = createWorld({ seed: 20261127 });
  world.tick(120);
  const { before, after, delta } = world.applyScenario({ addTables: 4 });

  assert.equal(before.sampleSize, 40);
  assert.equal(after.sampleSize, 43);
  assert.equal(before.lossRate, 20 / 40);
  assert.equal(after.lossRate, 12 / 43);
  assert.equal(delta.lossRate, after.lossRate - before.lossRate);
  assert.equal((delta.lossRate * 100).toFixed(1), '-22.1');
});
