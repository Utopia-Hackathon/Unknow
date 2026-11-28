#!/usr/bin/env node
/**
 * A 侧独立复核（Issue #36 第 8 步）：dashboard.bindWorld(realEngine) 端到端链路。
 *
 * 目的：D 的 #67 只测引擎 API（引擎本身无错），C 的 #68 只测 advisor 逻辑，
 * 但没人把「真引擎」塞进「看板」验证过——本协议补的就是这个集成层。
 *
 * 为什么用 DOM stub 而不是真浏览器：
 *   dashboard.js 强依赖 document；复核机无 GPU/SwiftShader 起不来 WebGL，
 *   且 A04–A07 的判据都是「事件流内容 + 指标卡文本 + 按钮交互」，
 *   与真实像素渲染无关。故用最小 DOM stub 即可确定性复核，且可落盘证据。
 *
 * 用法：
 *   node scripts/check-dashboard-engine.mjs            # 诊断模式：打印报告，exit 0
 *   node scripts/check-dashboard-engine.mjs --strict   # 门禁模式：缺陷未修尽时 exit 1
 *
 * 缺陷修复后（C 改 src/dashboard.js），希望：
 *   - DEF-DASH-01 消失：bindWorld 后事件流 == world.getEvents()（全量真引擎事件）
 *   - DEF-DASH-02 消失：看板事件流 lost 数 == 指标 detail.lost（同源一致）
 */
import assert from 'node:assert/strict';

// ---- 最小 DOM stub：只实现 dashboard.js 用到的 API ----
class StubNode {
  constructor(tag) {
    this.tag = tag; this.className = ''; this._html = ''; this.children = [];
    this._listeners = {}; this.textContent = ''; this.value = undefined;
    this._classes = new Set(); this._byId = {}; this.type = '';
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._classes.add(x)),
      remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (c) => self._classes.has(c),
    };
  }
  set innerHTML(v) {
    this._html = String(v); this.children = []; this._byId = {};
    const re = /<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g;
    let m;
    while ((m = re.exec(this._html))) {
      const child = new StubNode(m[1]);
      const vr = /\bvalue="([^"]*)"/.exec(m[0]);
      if (vr) child.value = vr[1];
      this.children.push(child); this._byId[m[2]] = child;
    }
  }
  get innerHTML() { return this._html; }
  appendChild(n) { this.children.push(n); return n; }
  addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }
  querySelector(sel) { return sel.startsWith('#') ? (this._byId[sel.slice(1)] || null) : null; }
  click() { (this._listeners.click || []).forEach((f) => f()); }
  input() { (this._listeners.input || []).forEach((f) => f()); }
}
globalThis.document = { createElement: (tag) => new StubNode(tag) };

function collectHTML(node) {
  let s = node._html || '';
  for (const c of node.children) s += collectHTML(c);
  return s;
}
function countType(events, type) {
  return events.filter((e) => e.type === type).length;
}
function walkButtons(node, label, action) {
  if (node.tag === 'button' && node._html === label) action(node);
  for (const c of node.children) walkButtons(c, label, action);
}

const { createDashboard } = await import('../src/dashboard.js');
const { createWorld } = await import('../src/engine/index.js');

const report = { generatedAt: new Date().toISOString(), baseline: {}, scenarios: {}, defects: [] };

// ---- 基线：真引擎 API 自身正确性（证明引擎无错，与 D #67 呼应但独立跑） ----
{
  const w = createWorld();
  w.tick(120);
  const m = w.getMetrics();
  const ev = w.getEvents();
  assert.ok(m.sampleSize >= 30, '引擎 120min 后样本应 ≥30');
  assert.ok(Number.isFinite(m.lossRate), '引擎应给出 lossRate 数值');
  assert.equal(m.sampleSize, m.detail.seated + m.detail.lost, '分母 = 入座 + 流失');
  report.baseline = {
    engineOK: true,
    lossRate: m.lossRate, sampleSize: m.sampleSize, censored: m.censored,
    detail: m.detail, events: ev.length,
  };
}

// ---- 场景 1：直接 bindWorld（不预推进） ----
{
  const w = createWorld();
  const root = new StubNode('div');
  const dash = createDashboard({ root, stores: [] });
  const mockEventsBefore = dash.getState().events.length;
  dash.bindWorld(w);
  const st = dash.getState();
  report.scenarios.directBind = {
    mockEventsBefore,
    realEventsAtBind: w.getEvents().length,
    dashEventsAfter: st.events.length,
    metricsSampleSize: st.metrics.sampleSize,
    metricsReason: st.metrics.reason,
    eventStreamMatchesEngine: st.events.length === w.getEvents().length,
  };
  // A04：释放空桌 → called + skipped(带 reason)
  const before = st.events.length;
  walkButtons(root, '释放空桌', (b) => b.click());
  const after = dash.getState().events;
  report.scenarios.directBind.a04 = {
    newCalled: countType(after.slice(before), 'called'),
    newSkipped: countType(after.slice(before), 'skipped'),
    newSkippedWithReason: after.slice(before).filter((e) => e.type === 'skipped' && e.reason).length,
  };
}

// ---- 场景 2：先 tick(120) 再 bindWorld（最自然的集成方式） ----
{
  const w = createWorld();
  w.tick(120);
  const realMetrics = w.getMetrics();
  const realEvents = w.getEvents();
  const root = new StubNode('div');
  const dash = createDashboard({ root, stores: [] });
  dash.bindWorld(w);
  const st = dash.getState();
  const dashLost = countType(st.events, 'lost');
  report.scenarios.tickThenBind = {
    realEvents: realEvents.length,
    realLost: realMetrics.detail.lost,
    dashEvents: st.events.length,
    dashLost,
    metricsFromEngine: st.metrics.sampleSize === realMetrics.sampleSize && st.metrics.lossRate === realMetrics.lossRate,
    eventsFromEngine: st.events.length === realEvents.length,
    mainValueText: (collectHTML(root).match(/dash-value[^>]*>([^<]+)/) || [])[1],
  };
}

// ---- 缺陷判定 ----
const s1 = report.scenarios.directBind;
const s2 = report.scenarios.tickThenBind;
if (!s1.eventStreamMatchesEngine || !s2.eventsFromEngine) {
  report.defects.push({
    id: 'DEF-DASH-01', severity: 'high',
    title: 'bindWorld 未把事件流切换为真引擎事件',
    evidence: `直接 bind: 看板 ${s1.dashEventsAfter} 条 / 引擎 ${s1.realEventsAtBind} 条；` +
      `tick 后 bind: 看板 ${s2.dashEvents} 条 / 引擎 ${s2.realEvents} 条`,
    rootCause: 'createDashboard 初始化 events = mockWorld.getEvents()；bindWorld 里只 pushEvents(world.tick(0))，未重置 events = world.getEvents()。',
    fixHint: 'bindWorld 中改为 events = world.getEvents ? world.getEvents() : events; 然后 renderEvents()。',
  });
}
if (s2.metricsFromEngine && !s2.eventsFromEngine && s2.dashLost !== s2.realLost) {
  report.defects.push({
    id: 'DEF-DASH-02', severity: 'critical',
    title: '指标来自真引擎、事件流来自 mock —— A06 判据自相矛盾',
    evidence: `指标 detail.lost=${s2.realLost}（真引擎），看板事件流 lost=${s2.dashLost}（mock 残留）；` +
      `同一屏上「流失 20 人」与「3 条流失事件」并存`,
    rootCause: '同 DEF-DASH-01；且 bindWorld 用 tick(0) 推进，若集成方已先 tick 消费事件则 tick(0) 返回空。',
    fixHint: '切换世界时以 world.getEvents() 为唯一事件源，移除对 tick(0) 的依赖。',
  });
}

// ---- 输出 ----
console.log(JSON.stringify(report, null, 2));
console.log(`\n[复核结论] 缺陷 ${report.defects.length} 项：` +
  (report.defects.length ? report.defects.map((d) => `${d.id}(${d.severity})`).join(', ') : '无'));

if (process.argv.includes('--strict') && report.defects.length) {
  console.error('[FAIL] 集成缺陷未修尽，--strict 模式退出 1');
  process.exit(1);
}
