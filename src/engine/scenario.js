import { DEFAULT_WINDOW_MINUTES } from './metrics.js';
import { createSimulation } from './simulation.js';

const SCENARIO_KEYS = ['addTables', 'dropArrivalRate', 'extendPatience'];

function compare(before, after) {
  const lossRate = before.lossRate === null || after.lossRate === null ? null : after.lossRate - before.lossRate;
  const avgWait = before.aux.avgWait === null || after.aux.avgWait === null
    ? null : after.aux.avgWait - before.aux.avgWait;
  return {
    before,
    after,
    delta: { lossRate, avgWait },
    relDelta: lossRate === null || before.lossRate === 0 ? null : lossRate / before.lossRate,
  };
}

function run(inputs, policy, minutes, releases = []) {
  const simulation = createSimulation(inputs, policy);
  for (const { t, tableId } of releases) {
    if (t > minutes || t >= DEFAULT_WINDOW_MINUTES) break;
    simulation.advanceTo(t);
    simulation.releaseTable(tableId);
  }
  simulation.advanceTo(minutes);
  return simulation.getMetrics(DEFAULT_WINDOW_MINUTES);
}

function parseTables(input) {
  // 看板传增加的 2 人桌张数，契约也允许按桌型指定张数。
  const entries = typeof input === 'number' ? [['2人桌', input]] : Object.entries(input);
  return entries.map(([type, count]) => {
    const match = /^([1-9]\d*)(?:人桌)?$/.exec(type);
    const seats = Number(match?.[1]);
    if (!Number.isSafeInteger(seats) || !Number.isSafeInteger(count) || count < 0) {
      throw new RangeError('加桌参数需要有效的桌型与非负整数张数');
    }
    return { seats, count };
  }).filter(({ count }) => count > 0);
}

function withChanges(inputs, { addTables = [], dropArrivalRate = 0, extendPatience = 0 }) {
  const tables = [...inputs.tables];
  const ids = new Set(tables.map(({ id }) => id));
  const storeId = tables.length ? tables[0].storeId : inputs.arrivals[0]?.storeId;
  let serial = 0;
  for (const { seats, count } of addTables) {
    for (let added = 0; added < count; added += 1) {
      let id;
      do {
        id = `scenario-table-${++serial}`;
      } while (ids.has(id));
      tables.push({ id, seats, storeId, availableAt: 0 });
    }
  }

  const arrivals = inputs.arrivals
    .filter(({ arrivalRoll }) => arrivalRoll >= dropArrivalRate)
    .map((person) => ({ ...person, patience: person.patience + extendPatience }));
  return { ...inputs, tables, arrivals };
}

export function applyScenario(inputs, live, releases, options) {
  if (!SCENARIO_KEYS.some((key) => Object.hasOwn(options, key))) {
    // D010 策略对照：独立跑完整窗口，共用客流、桌位、耐心和用餐时长。
    const before = run(inputs, 'fifo', DEFAULT_WINDOW_MINUTES);
    const after = run(inputs, 'matching', DEFAULT_WINDOW_MINUTES);
    return compare(before, after);
  }

  const addTables = parseTables(options.addTables ?? 0);
  const dropArrivalRate = options.dropArrivalRate ?? 0;
  const extendPatience = options.extendPatience ?? 0;
  if (!Number.isFinite(dropArrivalRate) || dropArrivalRate < 0 || dropArrivalRate > 1
    || !Number.isFinite(extendPatience) || extendPatience < 0) {
    throw new RangeError('到达率降幅需在 0 到 1 之间，延长的耐心分钟数需为有限非负数');
  }

  const before = live.getMetrics(DEFAULT_WINDOW_MINUTES);
  const changes = {};
  if (addTables.length) changes.addTables = addTables;
  if (dropArrivalRate) changes.dropArrivalRate = dropArrivalRate;
  if (extendPatience) changes.extendPatience = extendPatience;
  const active = Object.keys(changes);
  if (!active.length) return compare(before, before);

  // 参数推演以当前观察窗口为基线，重放相同的人工释放操作。
  const measure = (change) => run(withChanges(inputs, change), 'matching', before.window.minutes, releases);
  const result = compare(before, measure(changes));
  if (active.length > 1) {
    result.comparisons = Object.fromEntries(active.map((key) => [key, compare(before, measure({ [key]: changes[key] }))]));
  }
  return result;
}
