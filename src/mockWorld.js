// D 引擎缺席时的降级数据链（Issue #41 / C-04）。
//
// 这不是「替 D 写引擎」——它只提供与 docs/CONTRACTS.md §三**同形**的四个方法，
// 让 F03 看板在 12-01 之前就能走「world → 事件 → 指标 → 推演」这条真链路。
// D 交了 src/engine/ 之后，bindWorld(realWorld) 一换，界面一行不改。
//
// 所有数字都是**模拟数据**，页面必须保留「模拟数据」标识（真实性声明第三条）。
// 算例取自 docs/METRICS_DEF.md §6：取号 60，入座 41、流失 19 → n=60、lossRate≈31.7%，
// 窗口末另有 6 人仍在排队 → censored=6，但**不进分母**。

const TABLES = [
  { id: 't1', label: '2人桌 A', seats: 2, occupied: false },
  { id: 't2', label: '2人桌 B', seats: 2, occupied: false },
  { id: 't3', label: '4人桌 A', seats: 4, occupied: false },
  { id: 't4', label: '6人桌 A', seats: 6, occupied: false },
];

const REASONS = [
  '桌型不匹配（需 2 人桌，空出 6 人桌）',
  '需拼桌，前面那位独自用餐不愿拼',
  '超人数上限（6 人桌坐不下 8 人）',
];

function makeInitialEvents(seed = 0) {
  const events = [];
  let t = 0;
  let skipCount = 0; // 跳号原因轮流取，别三条撞成同一个（演示时像复制粘贴）
  for (let i = 0; i < 18; i++) {
    t += 2 + (i % 3);
    events.push({
      t, type: 'queued', personId: `p${i + 1}`,
      partySize: (i % 4) + 1, reason: '到店取号',
    });
    if (i === 3 || i === 9 || i === 14) {
      events.push({
        t: t + 1, type: 'skipped', personId: `p${i + 1}`, tableId: 't4',
        reason: REASONS[skipCount++ % REASONS.length],
      });
    }
    if (i === 6 || i === 12) {
      events.push({
        t: t + 3, type: 'reflowed', personId: `p${i + 1}`, tableId: 't2',
        reason: '过号后重新匹配到合适桌位',
      });
    }
    if (i === 4 || i === 11 || i === 16) {
      events.push({
        t: t + 9, type: 'lost', personId: `p${i + 1}`,
        reason: '等待超过容忍时长后离开',
      });
    } else {
      events.push({
        t: t + 5, type: 'seated', personId: `p${i + 1}`, tableId: 't3',
        reason: '桌型匹配成功',
      });
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

// 与 METRICS_DEF.md §6 的返回结构逐字段对齐：
// lossRate / sampleSize / censored / reason / aux / window / detail
function makeMetrics(overrides = {}) {
  const seated = 41;
  const lost = 19;
  const censored = 6;
  const n = seated + lost;
  return {
    lossRate: n >= 30 ? lost / n : null,
    sampleSize: n,
    censored,
    reason: null,
    aux: {
      avgWait: 18.4,
      skippedCount: 3,
      reflowedCount: 2,
      seatUtilization: 0.72,
    },
    window: 120,
    detail: { seated, lost, queued: 60, called: 18, skipped: 3, reflowed: 2 },
    simulated: true,
    ...overrides,
  };
}

/**
 * 造一个与 D 契约同形的 mock world。
 * @param {object} config 可传 seed / tables；字段形状参考 createWorld(config)
 */
export function createMockWorld(config = {}) {
  const seed = Number.isFinite(config.seed) ? config.seed : 20261127; // 保留给未来校准
  const tables = (config.tables || TABLES).map((t) => ({ ...t }));
  let allEvents = makeInitialEvents(seed % 7);
  let pending = [];
  let clock = 0;
  let releaseSeq = 0;

  // world.releaseTable(tableId) —— 触发匹配，产出 called + 带 reason 的 skipped
  function releaseTable(tableId) {
    if (!tables.some((t) => t.id === tableId)) return false;
    releaseSeq += 1;
    clock += 0.5;
    pending.push({
      t: clock,
      type: 'called',
      personId: `r${releaseSeq}`,
      tableId,
      reason: '桌位释放，按桌型匹配到队首可坐顾客',
    });
    pending.push({
      t: clock + 0.1,
      type: 'skipped',
      personId: `p${40 + releaseSeq}`,
      tableId,
      reason: '桌型不匹配（前面 4 人顾客等 2 人桌，当前空出 6 人桌）',
    });
    return true;
  }

  // world.tick(minutes) —— 返回本次事件数组（契约形状）
  function tick(minutes = 0) {
    clock += Number.isFinite(minutes) ? minutes : 0;
    const out = pending;
    pending = [];
    allEvents = [...allEvents, ...out];
    return out;
  }

  // world.getMetrics() —— 字段与 METRICS_DEF §6 对齐
  function getMetrics() {
    return makeMetrics();
  }

  // world.applyScenario(scenario) —— 返回 { before, after, delta }
  // delta 必须等于 after − before，方向不能反（加桌/降到达/延长容忍都应降流失率）
  function applyScenario(scenario = {}) {
    const before = makeMetrics();
    const addTables = typeof scenario.addTables === 'number'
      ? scenario.addTables
      : (scenario.addTables?.['2人桌'] || 0);
    const dropArrivalRate = scenario.dropArrivalRate || 0;
    const extendPatience = scenario.extendPatience || 0;

    const gain = addTables * 0.012 + dropArrivalRate * 0.35 + extendPatience * 0.003;
    const nextRate = Math.max(0, before.lossRate - gain);
    const after = makeMetrics({ lossRate: nextRate });
    return {
      before,
      after,
      delta: {
        lossRate: after.lossRate - before.lossRate,
        avgWait: -extendPatience * 0.35,
      },
    };
  }

  return {
    releaseTable,
    tick,
    getMetrics,
    applyScenario,
    // 以下是 mock 自带的取数口，真引擎不必提供；看板不依赖它们
    getEvents: () => [...allEvents],
    tables,
    getClock: () => clock,
  };
}
