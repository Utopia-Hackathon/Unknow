import { DEFAULT_WINDOW_MINUTES } from './metrics.js';
import { applyScenario } from './scenario.js';
import { createSimulation } from './simulation.js';

// 假设桌位和剩余用餐时间，供未传入桌位配置时演示。ID 与现有看板一致。
const DEFAULT_TABLES = [
  { id: 't1', seats: 2, availableAt: 10 },
  { id: 't2', seats: 2, availableAt: 16 },
  { id: 't3', seats: 4, availableAt: 13 },
  { id: 't4', seats: 6, availableAt: 19 },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function generateArrivals(random, storeIds) {
  // 两个开场取号便于演示释放小桌时的跳号；其余为固定种子的合成客流。
  const arrivals = [
    { t: 0, partySize: 4, storeId: storeIds[0] },
    { t: 0, partySize: 2, storeId: storeIds[0] },
  ];
  for (let t = 2; t < DEFAULT_WINDOW_MINUTES; t += 1.5 + random() * 2) {
    arrivals.push({
      t,
      storeId: storeIds[arrivals.length % storeIds.length],
      partySize: 1 + Math.floor(random() * 6),
      patience: 12 + Math.floor(random() * 17),
      dineMinutes: 16 + Math.floor(random() * 15),
      noShow: random() < 0.15,
    });
  }
  return arrivals;
}

function prepareInputs(config) {
  const random = seededRandom(config.seed ?? 20261127);
  const defaultStoreId = config.stores?.length === 1 ? config.stores[0].id : undefined;
  const tableIds = new Set();
  const tables = (config.tables ?? DEFAULT_TABLES).map((table) => {
    const { id, seats, storeId = defaultStoreId, floor } = table;
    const availableAt = table.availableAt ?? (table.occupied ? 10 : 0);
    if (typeof id !== 'string' || !id.length || tableIds.has(id)
      || !Number.isSafeInteger(seats) || seats < 1
      || !Number.isFinite(availableAt) || availableAt < 0) {
      throw new RangeError('桌位需要唯一的字符串 id、正整数 seats 和非负的 availableAt');
    }
    tableIds.add(id);
    return { id, seats, storeId, floor, availableAt };
  });
  const storeIds = tables.length ? [...new Set(tables.map((table) => table.storeId))] : [defaultStoreId];
  const rolls = new Map();
  const arrivals = (config.arrivals ?? generateArrivals(random, storeIds)).map((arrival, index) => {
    const {
      personId = `p${index + 1}`, t, partySize, storeId = storeIds[0],
      patience = 18, dineMinutes = 22, noShow = false,
    } = arrival;
    if (typeof personId !== 'string' || !personId.length
      || !Number.isFinite(t) || t < 0 || !Number.isSafeInteger(partySize) || partySize < 1
      || !Number.isFinite(patience) || patience <= 0
      || !Number.isFinite(dineMinutes) || dineMinutes <= 0) {
      throw new RangeError('取号记录需要有效的 personId、时间、人数、耐心和用餐时长');
    }
    // 降低到达率时对同一顾客使用同一次抽样，保留者的时刻和其他属性不变。
    if (!rolls.has(personId)) rolls.set(personId, random());
    return { personId, t, partySize, storeId, patience, dineMinutes, noShow, arrivalRoll: rolls.get(personId) };
  }).sort((left, right) => left.t - right.t);
  const recallDelay = config.recallDelay ?? 4;
  if (!Number.isFinite(recallDelay) || recallDelay <= 0) {
    throw new RangeError('回捞宽限时间需要为正数');
  }
  return { tables, arrivals, recallDelay };
}

/**
 * 构造合成排队模拟。所有时间均为从开始起算的分钟。
 * tables 可传 { id, seats, storeId?, floor?, availableAt? }。
 * arrivals 可传 { personId?, t, partySize, storeId?, patience?, dineMinutes?, noShow? }。
 * 门店数据只用于归属，模拟客流和桌位假设可从配置传入。
 */
export function createWorld(config = {}) {
  const inputs = prepareInputs(config);
  const simulation = createSimulation(inputs);
  const releases = [];
  let delivered = 0;

  return {
    get tables() {
      return simulation.tables.map(({ id, seats, storeId, floor, busy }) => ({
        id, seats, storeId, floor, occupied: busy !== null,
      }));
    },
    getEvents: () => simulation.events.slice(),
    releaseTable(tableId) {
      if (!simulation.releaseTable(tableId)) return false;
      releases.push({ tableId, t: simulation.time });
      return true;
    },
    tick(minutes = 0) {
      const target = simulation.time + minutes;
      if (!Number.isFinite(minutes) || minutes < 0 || !Number.isFinite(target)) {
        throw new RangeError('推进分钟数需要为有限非负数');
      }
      simulation.advanceTo(target);
      const events = simulation.events.slice(delivered);
      delivered = simulation.events.length;
      return events;
    },
    getMetrics(windowMinutes = DEFAULT_WINDOW_MINUTES) {
      return simulation.getMetrics(windowMinutes);
    },
    applyScenario(options = {}) {
      return applyScenario(inputs, simulation, releases, options);
    },
  };
}
