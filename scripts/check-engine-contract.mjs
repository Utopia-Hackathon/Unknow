#!/usr/bin/env node
/**
 * 引擎接口契约验收夹具（Issue #36 / A-04）
 *
 * 作用：把 docs/CONTRACTS.md §三 与 docs/METRICS_DEF.md §6 里「写在文档上的接口」变成
 *       「跑一下就红/绿」的断言，让 D 交代码前能自查、A 判 A04–A07 时有客观依据。
 *
 * 用法：
 *   node scripts/check-engine-contract.mjs                    # 检查 src/engine/index.js
 *   node scripts/check-engine-contract.mjs --entry <path>     # 检查任意实现（C 的 createMockWorld 同样适用）
 *   node scripts/check-engine-contract.mjs --factory createMockWorld   # 工厂函数名不是 createWorld 时指定
 *   node scripts/check-engine-contract.mjs --require          # 引擎未交付即判失败（A 验收时用）
 *   node scripts/check-engine-contract.mjs --json             # 输出机器可读结果
 *
 * 判定分级：
 *   PASS  契约要求满足
 *   FAIL  明确违反 §三 / §6，必须改
 *   WARN  文档没写死、但会影响集成的点（不判失败，只提示）
 *   SKIP  当前无法判定（例如引擎未交付、n<30 小样本无法构造）——SKIP 不等于通过
 *
 * 退出码：0 = 无 FAIL；1 = 有 FAIL；2 = 引擎未交付且带 --require
 */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const argv = process.argv.slice(2);
const opt = {
  entry: 'src/engine/index.js',
  factory: 'createWorld',
  require: argv.includes('--require'),
  json: argv.includes('--json'),
};
const entryIdx = argv.indexOf('--entry');
if (entryIdx !== -1 && argv[entryIdx + 1]) opt.entry = argv[entryIdx + 1];
const factoryIdx = argv.indexOf('--factory');
if (factoryIdx !== -1 && argv[factoryIdx + 1]) opt.factory = argv[factoryIdx + 1];

const results = [];
const add = (level, code, msg) => results.push({ level, code, msg });
const pass = (code, msg) => add('PASS', code, msg);
const fail = (code, msg) => add('FAIL', code, msg);
const warn = (code, msg) => add('WARN', code, msg);
const skip = (code, msg) => add('SKIP', code, msg);

const ENTRY_ABS = path.isAbsolute(opt.entry) ? opt.entry : path.resolve(ROOT, opt.entry);
const relFromRoot = path.relative(ROOT, ENTRY_ABS);
const REL = relFromRoot.startsWith('..') ? ENTRY_ABS.replace(/\\/g, '/') : relFromRoot.replace(/\\/g, '/') || opt.entry;

// —— 契约常量（改动前先改文档，再改这里） ——
const EVENT_TYPES = ['queued', 'called', 'seated', 'skipped', 'reflowed', 'lost'];
const WORLD_METHODS = ['releaseTable', 'tick', 'getMetrics', 'applyScenario'];
const METRIC_SCALARS = ['lossRate', 'sampleSize', 'censored', 'reason'];
const AUX_KEYS = ['skipOutRate', 'avgWait', 'idleTableRatio', 'reflowSuccess'];
const WINDOW_KEYS = ['start', 'minutes'];
const DETAIL_KEYS = ['queued', 'called', 'seated', 'lost', 'skipped', 'reflowed', 'dedupRemoved'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// —— 0. 交付存在性 ——
if (!existsSync(ENTRY_ABS)) {
  skip('ENTRY_MISSING', `${REL} 不存在——引擎尚未交付（CONTRACTS §三 约定的实现文件）`);
  if (opt.require) {
    fail('ENTRY_REQUIRED', '带了 --require：引擎未交付即判定未通过');
  }
  finish();
}

// —— 1. 纯逻辑：不 import three.js（§三 明文要求） ——
const source = readFileSync(ENTRY_ABS, 'utf8');
const threeImport = /(?:from\s*['"]three|require\(\s*['"]three|from\s*['"]three\/)/.exec(source);
if (threeImport) {
  fail('PURE_LOGIC_THREE', `源码 import 了 three.js（${threeImport[0]}）——§三 要求纯逻辑，否则 Node 里跑不了单测`);
} else {
  pass('PURE_LOGIC_THREE', '纯逻辑：未 import three.js');
}

// —— 2. 模块导出工厂函数（默认 createWorld，可用 --factory 指定） ——
let mod;
try {
  mod = await import(pathToFileURL(ENTRY_ABS).href);
} catch (err) {
  fail('IMPORT_FAILED', `import 失败：${err.message}`);
  finish();
}
const factory = mod[opt.factory];
if (typeof factory !== 'function') {
  fail(
    'CREATE_WORLD_MISSING',
    `未导出 ${opt.factory}(config)（实际导出：${Object.keys(mod).join(', ') || '无'}）；若工厂函数名字不同，用 --factory <名字> 指定`
  );
  finish();
}
pass('CREATE_WORLD', `导出 ${opt.factory}(config)`);

// —— 3. 构造 world ——
let world = null;
const stores = loadStores();
if (stores) pass('STORES_SOURCE', `config.stores 取自 data/stores.json（${stores.length} 条）`);
else warn('STORES_SOURCE', 'data/stores.json 不存在，config.stores 用 2 条合成点位；D 接入真实数据后请重跑');

const contractConfig = {
  floors: [6, 7, 8],
  stores: stores ?? [
    { id: 's1', name: '测试点位A', floor: 6, category: '正餐' },
    { id: 's2', name: '测试点位B', floor: 8, category: '火锅' },
  ],
  tables: [
    { id: 't1', seats: 2, floor: 6 },
    { id: 't2', seats: 4, floor: 7 },
    { id: 't3', seats: 6, floor: 8 },
  ],
  seed: 20261127,
};

try {
  world = factory(contractConfig);
  pass('CREATE_WORLD_CALL', `${opt.factory}(config) 按契约 config 形状调用成功`);
} catch (err) {
  try {
    world = factory({});
    warn('CONFIG_SHAPE', `${opt.factory} 不接受契约 config 形状（floors/stores/tables/seed）：${err.message}；空 config 可用，请把真实所需形状补进 CONTRACTS §三`);
  } catch (err2) {
    fail('CREATE_WORLD_THROWS', `${opt.factory} 抛错：${err.message}；空 config 也抛错：${err2.message}`);
    finish();
  }
}

// —— 4. world 四个方法（§三） ——
const missing = WORLD_METHODS.filter((m) => typeof world?.[m] !== 'function');
if (missing.length) fail('WORLD_METHODS', `world 缺方法：${missing.join(', ')}`);
else pass('WORLD_METHODS', 'world 具备 releaseTable / tick / getMetrics / applyScenario');

// —— 5. tick() 返回事件数组，事件形状合规（§三 事件形状不可改） ——
let events = [];
// 先释放一张桌子，让引擎真的跑起来，否则 tick 只会返回空数组
if (typeof world?.releaseTable === 'function') {
  try {
    world.releaseTable(contractConfig.tables[0].id);
  } catch (err) {
    warn('RELEASE_TABLE_THROWS', `releaseTable('${contractConfig.tables[0].id}') 抛错：${err.message}`);
  }
}
if (typeof world?.tick === 'function') {
  let raw;
  try {
    raw = world.tick(30);
  } catch (err) {
    fail('TICK_THROWS', `tick(30) 抛错：${err.message}`);
  }
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      fail('TICK_RETURNS_ARRAY', `tick(minutes) 应返回事件数组，实际是 ${raw === null ? 'null' : typeof raw}`);
    } else {
      events = raw;
      pass('TICK_RETURNS_ARRAY', `tick(30) 返回数组（${events.length} 条事件）`);
      checkEvents(events);
    }
  }
}

// —— 6. getMetrics() 形状（METRICS_DEF §6） ——
let metrics = null;
if (typeof world?.getMetrics === 'function') {
  let m1, m2;
  try {
    m1 = world.getMetrics();
    m2 = world.getMetrics();
  } catch (err) {
    fail('GET_METRICS_THROWS', `getMetrics() 抛错：${err.message}`);
  }
  if (m1 !== undefined) {
    metrics = m1;
    checkMetrics(m1);
    // 纯函数式：同状态同结果（§6 实现要点 3）
    if (JSON.stringify(m1) === JSON.stringify(m2)) pass('DETERMINISM', '同状态连续两次 getMetrics 结果一致');
    else fail('DETERMINISM', '同状态连续两次 getMetrics 结果不同——§6 要求纯函数式');
  }
}

// —— 7. applyScenario：before/after 同走 getMetrics（§6 实现要点 4） ——
if (typeof world?.applyScenario === 'function') {
  let res;
  try {
    res = world.applyScenario({ addTables: 2, dropArrivalRate: 0.1, extendPatience: 10 });
  } catch (err) {
    fail('APPLY_SCENARIO_THROWS', `applyScenario(...) 抛错：${err.message}`);
  }
  if (res !== undefined) {
    if (!res || typeof res !== 'object') {
      fail('APPLY_SCENARIO_SHAPE', `applyScenario 应返回 { before, after }，实际是 ${res === null ? 'null' : typeof res}`);
    } else {
      const okBefore = res.before && typeof res.before === 'object';
      const okAfter = res.after && typeof res.after === 'object';
      if (!okBefore || !okAfter) {
        fail('APPLY_SCENARIO_SHAPE', 'applyScenario 返回缺 before 或 after');
      } else {
        const badSide = ['before', 'after'].filter((k) => !('lossRate' in res[k]) || !('sampleSize' in res[k]));
        if (badSide.length) fail('APPLY_SCENARIO_FIELDS', `${badSide.join('/')} 缺 lossRate 或 sampleSize`);
        else pass('APPLY_SCENARIO_SHAPE', 'applyScenario 返回 { before, after }，两侧均含 lossRate / sampleSize');

        if (metrics && isNum(metrics.lossRate)) {
          if (!isNum(res.before.lossRate)) {
            fail('APPLY_SCENARIO_BEFORE', `before.lossRate 不是数值（${res.before.lossRate}），无法与当前指标对照`);
          } else if (!near(res.before.lossRate, metrics.lossRate)) {
            fail(
              'APPLY_SCENARIO_BEFORE',
              `before.lossRate=${res.before.lossRate} 与 getMetrics().lossRate=${metrics.lossRate} 不一致——` +
                '推演的 before 必须走同一套 getMetrics，不许另写一份逻辑（§6 实现要点 4）'
            );
          } else {
            pass('APPLY_SCENARIO_BEFORE', `before.lossRate 与当前 getMetrics 一致（${metrics.lossRate}）`);
          }
        }
      }
      // 推演是否污染真实世界状态：文档未写死，只提示
      if (metrics && typeof world.getMetrics === 'function') {
        try {
          const after = world.getMetrics();
          if (JSON.stringify(after) !== JSON.stringify(metrics)) {
            warn('SCENARIO_SIDE_EFFECT', 'applyScenario 之后 getMetrics 变了——假设推演通常不应改动真实世界状态，请确认这是有意的');
          }
        } catch {
          /* 已被前面的检查覆盖 */
        }
      }
    }
  }
}

finish();

// ======================= 工具函数 =======================

function checkEvents(list) {
  if (list.length === 0) {
    warn('EVENTS_EMPTY', 'tick(30) 没有产生任何事件；若这是刻意的（无人到达）可忽略，否则说明模拟没跑起来');
    return;
  }
  const badType = [];
  const badShape = [];
  const noReason = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') {
      badShape.push(String(e));
      continue;
    }
    if (!isNum(e.t)) badShape.push(`t=${JSON.stringify(e.t)}`);
    if (!EVENT_TYPES.includes(e.type)) badType.push(String(e.type));
    if (typeof e.personId !== 'string' || !e.personId) badShape.push(`personId=${JSON.stringify(e.personId)}`);
    if (e.type === 'skipped' && (typeof e.reason !== 'string' || !e.reason.trim())) {
      noReason.push(e.personId ?? '(无 personId)');
    }
  }
  const uniqBadType = [...new Set(badType)];
  if (uniqBadType.length) fail('EVENT_TYPE', `出现契约外的事件 type：${uniqBadType.join(', ')}（合法：${EVENT_TYPES.join('/')}）`);
  else pass('EVENT_TYPE', `事件 type 均在契约内（${[...new Set(list.map((e) => e?.type))].join('/')}）`);

  if (badShape.length) fail('EVENT_SHAPE', `事件字段不合规（需 t/personId/tableId）：${badShape.slice(0, 5).join('; ')}`);
  else pass('EVENT_SHAPE', '事件含 t 与 personId');

  if (noReason.length) {
    fail('EVENT_SKIP_REASON', `${noReason.length} 条 skipped 事件缺 reason——F02-01 要求界面能解释跳号原因，无此字段只能编`);
  } else if (list.some((e) => e?.type === 'skipped')) {
    pass('EVENT_SKIP_REASON', 'skipped 事件均带 reason');
  } else {
    skip('EVENT_SKIP_REASON', '本次 tick 未产生 skipped 事件，reason 规则未被覆盖');
  }
}

function checkMetrics(m) {
  if (!m || typeof m !== 'object') {
    fail('METRICS_SHAPE', `getMetrics() 应返回对象，实际是 ${m === null ? 'null' : typeof m}`);
    return;
  }
  const missingScalars = METRIC_SCALARS.filter((k) => !(k in m));
  if (missingScalars.length) {
    // 针对最常见的误解给出定位提示
    const flatHints = [];
    if (!('sampleSize' in m) && isNum(m.n)) flatHints.push('用了 n 而不是 sampleSize');
    fail('METRICS_FIELDS', `getMetrics() 缺字段：${missingScalars.join(', ')}${flatHints.length ? `（${flatHints.join('；')}）` : ''}`);
  } else {
    pass('METRICS_FIELDS', 'getMetrics() 含 lossRate / sampleSize / censored / reason');
  }

  if ('lossRate' in m && !(m.lossRate === null || isNum(m.lossRate))) fail('METRICS_LOSSRATE_TYPE', `lossRate 应为 number|null，实际 ${JSON.stringify(m.lossRate)}`);
  if ('sampleSize' in m && !isNum(m.sampleSize)) fail('METRICS_SAMPLESIZE_TYPE', `sampleSize 应为数值，实际 ${JSON.stringify(m.sampleSize)}`);
  if ('censored' in m && !isNum(m.censored)) fail('METRICS_CENSORED_TYPE', `censored 应为数值，实际 ${JSON.stringify(m.censored)}`);
  if ('reason' in m && !(m.reason === null || typeof m.reason === 'string')) fail('METRICS_REASON_TYPE', `reason 应为 string|null，实际 ${JSON.stringify(m.reason)}`);

  // aux 必须嵌套（这是 C 的看板 mock 与 §6 的实际分歧点）
  if (!m.aux || typeof m.aux !== 'object') {
    const flatAux = AUX_KEYS.filter((k) => k in m);
    fail(
      'METRICS_AUX_NESTED',
      `缺 aux 对象（§6 要求 aux.{${AUX_KEYS.join(', ')}}）` +
        (flatAux.length ? `；检测到扁平字段 ${flatAux.join(', ')}，应收进 aux` : '')
    );
  } else {
    const missAux = AUX_KEYS.filter((k) => !(k in m.aux));
    if (missAux.length) fail('METRICS_AUX_KEYS', `aux 缺：${missAux.join(', ')}`);
    else pass('METRICS_AUX_KEYS', `aux 含 ${AUX_KEYS.join(' / ')}`);
  }

  if (!m.window || typeof m.window !== 'object') {
    fail('METRICS_WINDOW', `缺 window 对象（§6 要求 window.{${WINDOW_KEYS.join(', ')}}，指标页须写出统计窗口）`);
  } else {
    const missWin = WINDOW_KEYS.filter((k) => !(k in m.window));
    if (missWin.length) fail('METRICS_WINDOW_KEYS', `window 缺：${missWin.join(', ')}`);
    else pass('METRICS_WINDOW_KEYS', 'window 含 start / minutes');
  }

  if (!m.detail || typeof m.detail !== 'object') {
    fail('METRICS_DETAIL', `缺 detail 对象（§6 要求保留原始计数 ${DETAIL_KEYS.join(', ')}）`);
  } else {
    const missDetail = DETAIL_KEYS.filter((k) => !(k in m.detail));
    if (missDetail.length) fail('METRICS_DETAIL_KEYS', `detail 缺：${missDetail.join(', ')}`);
    else pass('METRICS_DETAIL_KEYS', 'detail 保留 7 项原始计数');
  }

  // 口径自洽：sampleSize = seated + lost
  if (m.detail && isNum(m.detail.seated) && isNum(m.detail.lost) && isNum(m.sampleSize)) {
    const expect = m.detail.seated + m.detail.lost;
    if (expect !== m.sampleSize) {
      fail('METRICS_CONSERVATION', `sampleSize=${m.sampleSize} ≠ seated(${m.detail.seated}) + lost(${m.detail.lost})=${expect}——分母口径不一致（METRICS_DEF §1）`);
    } else {
      pass('METRICS_CONSERVATION', `sampleSize = seated + lost = ${m.sampleSize}`);
    }
  }

  // 样本量门槛（§3：n<30 返回 null + reason，禁止返回 0 冒充）
  if (isNum(m.sampleSize)) {
    if (m.sampleSize >= 30) {
      if (isNum(m.detail?.lost)) {
        const expect = m.detail.lost / m.sampleSize;
        if (m.lossRate === null) {
          fail('METRICS_LOSSRATE_RULE', `n=${m.sampleSize} ≥ 30 却返回 lossRate=null`);
        } else if (isNum(m.lossRate) && !near(m.lossRate, expect)) {
          fail('METRICS_LOSSRATE_RULE', `lossRate=${m.lossRate} 与 lost/sampleSize=${expect.toFixed(6)} 不符`);
        } else {
          pass('METRICS_LOSSRATE_RULE', `n=${m.sampleSize} ≥ 30，lossRate=${m.lossRate} 与 lost/n 一致`);
        }
      }
    } else if (m.lossRate === null) {
      if (typeof m.reason === 'string' && m.reason.trim()) pass('METRICS_SMALL_SAMPLE', `n=${m.sampleSize} < 30 → lossRate=null 且给出 reason`);
      else fail('METRICS_SMALL_SAMPLE', `n=${m.sampleSize} < 30 返回 null，但 reason 为空——§3 要求说明原因`);
    } else if (m.lossRate === 0) {
      fail('METRICS_SMALL_SAMPLE', `n=${m.sampleSize} < 30 返回 lossRate=0——§3 明令禁止用 0 冒充结果`);
    } else {
      fail('METRICS_SMALL_SAMPLE', `n=${m.sampleSize} < 30 却返回 lossRate=${m.lossRate}——§3 要求返回 null + reason`);
    }
  }
}

function loadStores() {
  const p = path.resolve(ROOT, 'data/stores.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    const arr = Array.isArray(raw) ? raw : raw.stores;
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch {
    return null;
  }
}

function finish() {
  const count = (lv) => results.filter((r) => r.level === lv).length;
  const summary = {
    entry: REL,
    factory: opt.factory,
    pass: count('PASS'),
    fail: count('FAIL'),
    warn: count('WARN'),
    skip: count('SKIP'),
    results,
  };

  if (opt.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const SYM = { PASS: '✓', FAIL: '✗', WARN: '!', SKIP: '-' };
    console.log(`\n引擎契约验收夹具  entry=${REL}  factory=${opt.factory}()`);
    console.log('依据：docs/CONTRACTS.md §三 · docs/METRICS_DEF.md §6\n');
    for (const r of results) {
      console.log(`  ${SYM[r.level]} [${r.level}] ${r.code}  ${r.msg}`);
    }
    console.log(
      `\n合计：PASS ${summary.pass} / FAIL ${summary.fail} / WARN ${summary.warn} / SKIP ${summary.skip}`
    );
    if (summary.skip > 0) console.log('注意：SKIP 不等于通过，只是当前无法判定。');
    if (summary.fail === 0 && summary.pass > 0) console.log('结论：契约硬项全过（FAIL=0）。');
  }

  process.exit(summary.fail > 0 ? (opt.require && summary.pass === 0 ? 2 : 1) : 0);
}
