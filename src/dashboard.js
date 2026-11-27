// F02/F03 界面（C 侧）。
//
// D 的 src/engine/ 只给纯逻辑（Issue #14 原话「不做 UI——界面由 C 画，你只给数据结构」）。
// 本文件先把界面与交互跑通，用合成事件喂数据；等 D 的 world 一交，
// 调 bindWorld(world) 就切到真引擎，界面代码不用改。
//
// 验收对齐：
//   A04 释放空桌 → 叫号且解释跳号原因（skipped.reason 必须显示）
//   A05 过号 → 可回捞并记录事件
//   A06 流失 → 计入指标
//   A07 指标页同时有 公式 / n / 删失人数 / 模拟数据标识；n<30 显示「样本不足」

const EVENT_META = {
  queued:   { label: '取号', color: '#7dd3fc' },
  called:   { label: '叫号', color: '#c4b5fd' },
  seated:   { label: '落座', color: '#6ee7b7' },
  skipped:  { label: '跳号', color: '#fbbf24' },
  reflowed: { label: '回捞', color: '#67e8f9' },
  lost:     { label: '流失', color: '#fda4af' },
};

const TABLES = [
  { id: 't1', label: '2人桌 A', seats: 2 },
  { id: 't2', label: '2人桌 B', seats: 2 },
  { id: 't3', label: '4人桌 A', seats: 4 },
  { id: 't4', label: '6人桌 A', seats: 6 },
];

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function pct(value) {
  return value == null || !Number.isFinite(value) ? '样本不足' : `${(value * 100).toFixed(1)}%`;
}

function signedPct(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  const points = (value * 100).toFixed(1);
  return `${value > 0 ? '+' : ''}${points}pp`;
}

// —— 合成数据：只用于把界面跑通，全部标「模拟数据」 ——

function demoEvents(seedOffset = 0) {
  const events = [];
  const reasons = [
    '桌型不匹配（需 2 人桌，空出 6 人桌）',
    '需拼桌，前面那位独自用餐不愿拼',
    '超人数上限（6 人桌坐不下 8 人）',
  ];
  let t = 0;
  for (let i = 0; i < 18; i++) {
    t += 2 + (i % 3);
    events.push({ t, type: 'queued', personId: `p${i + 1}`, partySize: (i % 4) + 1, reason: '到店取号' });
    if (i === 3 || i === 9 || i === 14) {
      events.push({
        t: t + 1, type: 'skipped', personId: `p${i + 1}`, tableId: 't4',
        reason: reasons[(i + seedOffset) % reasons.length],
      });
    }
    if (i === 6 || i === 12) {
      events.push({ t: t + 3, type: 'reflowed', personId: `p${i + 1}`, tableId: 't2', reason: '过号后重新匹配到合适桌位' });
    }
    if (i === 4 || i === 11 || i === 16) {
      events.push({ t: t + 9, type: 'lost', personId: `p${i + 1}`, reason: '等待超过容忍时长后离开' });
    }
    if (i !== 4 && i !== 11 && i !== 16) {
      events.push({ t: t + 5, type: 'seated', personId: `p${i + 1}`, tableId: 't3', reason: '桌型匹配成功' });
    }
  }
  return events.sort((a, b) => a.t - b.t);
}

function demoMetrics() {
  // 用 METRICS_DEF §6 的算例：n=41+19=60、流失 19 → 31.7%，另有 6 人删失。
  // 这样默认界面落在「正常出数」态；n<30 的分支由 updateMetrics 覆盖验证。
  const seated = 41;
  const lost = 19;
  const censored = 6;
  const n = seated + lost;
  return {
    lossRate: n >= 30 ? lost / n : null,
    sampleSize: n,
    censored,
    avgWait: 18.4,
    skippedCount: 3,
    seated,
    lost,
    reason: n < 30 ? `样本不足（n=${n}，需 ≥30）` : null,
    simulated: true,
  };
}

// 假推演：delta 由「加桌 / 降到达率 / 延长容忍」线性估算，方向必须正确。
// 这是界面联调用的占位计算，真值必须由 D 的 applyScenario 覆盖。
function demoScenario(params) {
  const base = demoMetrics();
  const gain = params.addTables * 0.012 + params.dropArrivalRate * 0.35 + params.extendPatience * 0.003;
  const afterRate = Math.max(0, base.lossRate - gain);
  const after = { ...base, lossRate: afterRate };
  return {
    before: base,
    after,
    delta: { lossRate: afterRate - base.lossRate, avgWait: -params.extendPatience * 0.35 },
  };
}

export function createDashboard({ root, stores = [], onStoreFocus = null }) {
  if (!root) return null;

  let world = null;
  let events = demoEvents();
  let metrics = demoMetrics();
  let tableStates = new Map(TABLES.map((t) => [t.id, 'available']));

  root.innerHTML = '';
  root.classList.add('dash-root');

  // —— 标题栏 ——
  const head = el('div', 'dash-head');
  head.innerHTML = '<strong>经营决策看板</strong><span class="dash-sim">模拟数据 · 非真实经营</span>';
  const close = el('button', 'dash-close', '关闭');
  close.type = 'button';
  close.addEventListener('click', () => root.classList.remove('open'));
  head.appendChild(close);
  root.appendChild(head);

  // —— 桌位操作 ——
  const tableSec = el('section', 'dash-sec');
  tableSec.appendChild(el('h3', '', '桌位（点「释放」触发叫号 · F02-01）'));
  const tableRow = el('div', 'dash-tables');
  tableSec.appendChild(tableRow);
  root.appendChild(tableSec);

  function renderTables() {
    tableRow.innerHTML = '';
    for (const t of TABLES) {
      const card = el('div', 'dash-table');
      const state = tableStates.get(t.id);
      card.innerHTML = `<span class="dash-table-name">${t.label}</span><span class="dash-table-state ${state}">${state === 'available' ? '空桌' : '占用中'}</span>`;
      const btn = el('button', 'dash-mini', '释放空桌');
      btn.type = 'button';
      btn.addEventListener('click', () => releaseTable(t.id));
      card.appendChild(btn);
      tableRow.appendChild(card);
    }
  }

  function releaseTable(tableId) {
    if (world?.releaseTable) {
      world.releaseTable(tableId);
      const next = world.tick?.(5) || [];
      pushEvents(next);
      if (world.getMetrics) updateMetrics(world.getMetrics());
    } else {
      // 没有真引擎时，合成一条可解释的跳号事件——只为把 A04 的界面链路跑通
      const i = events.length;
      const next = [
        { t: i * 0.5, type: 'called', personId: `p${i + 1}`, tableId, reason: '桌位释放，按桌型匹配到队首可坐顾客' },
        {
          t: i * 0.5 + 0.1, type: 'skipped', personId: `p${i}`, tableId,
          reason: '桌型不匹配（前面 4 人顾客等 2 人桌，当前空出 6 人桌）',
        },
      ];
      pushEvents(next);
      tableStates.set(tableId, 'available');
    }
    renderTables();
  }

  // —— 事件流 ——
  const eventSec = el('section', 'dash-sec');
  eventSec.appendChild(el('h3', '', '事件流（跳号必须带原因 · F02-01/02/03）'));
  const eventList = el('div', 'dash-events');
  eventSec.appendChild(eventList);
  root.appendChild(eventSec);

  function renderEvents() {
    eventList.innerHTML = '';
    // 最近的在前，答辩时一眼看到刚发生的叫号与跳号
    for (const e of [...events].reverse().slice(0, 24)) {
      const meta = EVENT_META[e.type] || { label: e.type, color: '#cbd5e1' };
      const row = el('div', 'dash-event');
      const reason = e.reason
        ? `<span class="dash-reason">${e.reason}</span>`
        : `<span class="dash-reason bad">原因缺失（数据不合规）</span>`;
      row.innerHTML =
        `<span class="dash-tag" style="color:${meta.color}">${meta.label}</span>` +
        `<span class="dash-t">t=${Number(e.t).toFixed(1)}</span>` +
        `<span class="dash-person">${e.personId || '—'}</span>` + reason;
      eventList.appendChild(row);
    }
  }

  function pushEvents(next) {
    if (!Array.isArray(next)) return;
    events = [...events, ...next];
    renderEvents();
  }

  // —— 指标卡（A07 硬判据） ——
  const metricSec = el('section', 'dash-sec');
  metricSec.appendChild(el('h3', '', '主指标：顾客流失率（F03-01）'));
  const metricBox = el('div', 'dash-metrics');
  metricSec.appendChild(metricBox);
  root.appendChild(metricSec);

  function renderMetrics() {
    metricBox.innerHTML = '';
    // D 的 getMetrics 返回 lossRate（契约 §三），不是 value——
    // 早先这里写成 metrics.value，导致 n=60 也被判成「样本不足」。
    const rate = metrics.lossRate ?? metrics.value;
    const insufficient = rate == null || metrics.sampleSize < 30;
    const main = el('div', 'dash-main');
    main.innerHTML =
      `<div class="dash-value ${insufficient ? 'dim' : ''}">${insufficient ? '样本不足' : pct(rate)}</div>` +
      `<div class="dash-formula">流失率 = 流失人数 ÷ (入座人数 + 流失人数)</div>` +
      `<div class="dash-facts">` +
      `<span>统计窗口 120 分钟</span>` +
      `<span>n = ${metrics.sampleSize ?? 0}（入座 + 流失）</span>` +
      `<span>另有 ${metrics.censored ?? 0} 人仍在排队，未计入</span>` +
      `<span class="dash-sim">模拟数据 · 在这组模拟参数下</span>` +
      `</div>`;
    if (insufficient) {
      main.appendChild(el('div', 'dash-note', metrics.reason || `样本不足（n=${metrics.sampleSize ?? 0}，需 ≥30），不显示 0`));
    }
    metricBox.appendChild(main);
  }

  function updateMetrics(next) {
    if (!next) return;
    metrics = { ...metrics, ...next };
    renderMetrics();
  }

  // —— 推演对比（A07 前后对比） ——
  const scenarioSec = el('section', 'dash-sec');
  scenarioSec.appendChild(el('h3', '', '假设推演：如果……会怎样'));
  const controls = el('div', 'dash-controls');
  controls.innerHTML =
    '<label>增加 2 人桌 <input type="range" id="dash-add" min="0" max="8" value="0" /><span id="dash-add-v">0</span> 张</label>' +
    '<label>降低到达率 <input type="range" id="dash-drop" min="0" max="50" value="0" /><span id="dash-drop-v">0</span>%</label>' +
    '<label>延长容忍 <input type="range" id="dash-patience" min="0" max="30" value="0" /><span id="dash-patience-v">0</span> 分钟</label>';
  scenarioSec.appendChild(controls);
  const runBtn = el('button', 'dash-run', '启用该方案');
  runBtn.type = 'button';
  scenarioSec.appendChild(runBtn);
  const resultBox = el('div', 'dash-result');
  scenarioSec.appendChild(resultBox);
  root.appendChild(scenarioSec);

  const addInput = controls.querySelector('#dash-add');
  const dropInput = controls.querySelector('#dash-drop');
  const patienceInput = controls.querySelector('#dash-patience');
  const syncLabels = () => {
    controls.querySelector('#dash-add-v').textContent = addInput.value;
    controls.querySelector('#dash-drop-v').textContent = dropInput.value;
    controls.querySelector('#dash-patience-v').textContent = patienceInput.value;
  };
  [addInput, dropInput, patienceInput].forEach((i) => i.addEventListener('input', syncLabels));

  function runScenario() {
    const params = {
      addTables: { '2人桌': Number(addInput.value) },
      dropArrivalRate: Number(dropInput.value) / 100,
      extendPatience: Number(patienceInput.value),
    };
    let result;
    if (world?.applyScenario) {
      result = world.applyScenario(params);
    } else {
      result = demoScenario({
        addTables: params.addTables['2人桌'],
        dropArrivalRate: params.dropArrivalRate,
        extendPatience: params.extendPatience,
      });
    }
    const before = result.before || metrics;
    const after = result.after || {};
    const delta = result.delta || {};
    resultBox.innerHTML =
      `<div class="dash-compare">` +
      `<div><span>启用前</span><b>${pct(before.lossRate)}</b></div>` +
      `<div class="dash-arrow">→</div>` +
      `<div><span>启用后</span><b>${pct(after.lossRate)}</b></div>` +
      `<div class="dash-delta">流失率 ${signedPct(delta.lossRate)}</div>` +
      `</div>` +
      `<div class="dash-facts"><span>delta = after − before</span><span>模拟数据 · 非真实经营</span></div>`;
  }
  runBtn.addEventListener('click', runScenario);

  renderTables();
  renderEvents();
  renderMetrics();
  runScenario();

  return {
    open() { root.classList.add('open'); },
    close() { root.classList.remove('open'); },
    isOpen: () => root.classList.contains('open'),
    pushEvents,
    updateMetrics,
    setScenario(result) {
      if (!result) return;
      // 真引擎给出结果后刷新对比区
      const before = result.before || {};
      const after = result.after || {};
      const delta = result.delta || {};
      resultBox.innerHTML =
        `<div class="dash-compare"><div><span>启用前</span><b>${pct(before.lossRate)}</b></div>` +
        `<div class="dash-arrow">→</div><div><span>启用后</span><b>${pct(after.lossRate)}</b></div>` +
        `<div class="dash-delta">流失率 ${signedPct(delta.lossRate)}</div></div>`;
    },
    bindWorld(nextWorld) {
      world = nextWorld;
      tableStates = new Map(TABLES.map((t) => [t.id, world?.tables?.some?.((tb) => tb.id === t.id && tb.occupied) ? 'occupied' : 'available']));
      renderTables();
      if (world?.getMetrics) updateMetrics(world.getMetrics());
    },
    getState: () => ({ events, metrics, tableStates: [...tableStates.entries()], hasEngine: !!world }),
    destroy() { root.innerHTML = ''; root.classList.remove('open'); },
  };
}
