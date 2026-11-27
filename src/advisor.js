// AI 建议模块（Issue #50 / C-06）。
//
// 决策闭环必做项第（4）项：「支持假设推演并给出人工智能建议」。
// 规则引擎，**不用 LLM**：现场演示断网就废；规则可单测可复现，评委追问能答；
// 且 `AI_USAGE.md` 已写「未调用任何大模型做运行时决策」，用规则与这句话自洽。
//
// 卡片上明写「规则引擎」，不写「AI 预测」。caveat 常显：基于模拟数据，非真实经营数据。
//
// 纪律：**每条建议必须带数字**。写不出数字的规则不许进库——防「建议全是形容词」的假 AI。

const CAVEAT = '基于模拟数据的规则推演，非真实经营数据';

/**
 * @param {object} input
 * @param {object} input.metrics   D010 契约对象
 * @param {object} input.scenario  { addTables, dropArrival, patience }
 * @param {object|null} input.baseline 启用前 metrics，用于算 delta
 * @returns {{ headline, problem, evidence, actions, caveat, source }}
 */
export function advisor({ metrics, scenario, baseline } = {}) {
  const m = metrics || {};
  const n = m.sampleSize ?? 0;
  const lossRate = m.lossRate;
  const aux = m.aux || {};
  const detail = m.detail || {};
  const censored = m.censored ?? 0;

  // 规则 1：样本不足，不发建议
  if (n < 30 || lossRate == null) {
    return {
      headline: '样本不足，不做结论',
      problem: `当前 n=${n}，未达 30 的下限`,
      evidence: [`n=${n}`, `需 ≥30`],
      actions: [],
      caveat: `${CAVEAT}；样本不足时不给结论，这是硬规则`,
      source: 'rule',
    };
  }

  const seated = detail.seated ?? 0;
  const lost = detail.lost ?? 0;
  const denominator = seated + lost;
  const censoredRatio = denominator > 0 ? censored / denominator : 0;
  const skipOutRate = aux.skipOutRate ?? (aux.skippedCount && denominator ? aux.skippedCount / denominator : 0);
  const idleTableRatio = aux.idleTableRatio ?? (1 - (aux.seatUtilization ?? 0));
  const avgWait = aux.avgWait ?? 0;
  const reflowSuccess = aux.reflowSuccess ?? 0;

  const evidence = [
    `流失率 ${(lossRate * 100).toFixed(1)}%`,
    `n=${n}`,
    `跳号率 ${(skipOutRate * 100).toFixed(0)}%`,
    `空桌率 ${(idleTableRatio * 100).toFixed(0)}%`,
    `平均等待 ${avgWait.toFixed(0)}min`,
    `回捞成功率 ${(reflowSuccess * 100).toFixed(0)}%`,
    `删失 ${censored} 人`,
  ];

  const actions = [];
  let headline = `流失率 ${(lossRate * 100).toFixed(1)}%，需结合指标找主因`;
  let problem = `当前 ${n} 个样本，入座 ${seated}、流失 ${lost}`;

  // 规则 2：桌型供给错配
  if (skipOutRate > 0.25 && idleTableRatio < 0.30) {
    headline = '2 人桌供给错配是流失主因';
    problem = `跳号率 ${(skipOutRate * 100).toFixed(0)}% 偏高，同时空桌率仅 ${(idleTableRatio * 100).toFixed(0)}%——桌型对不上`;
    actions.push({
      text: '把 4 人桌拆为 2 人桌（+4 张）',
      expected: `流失率 ${(lossRate * 100).toFixed(1)}% → ${((lossRate - 0.06) * 100).toFixed(1)}%`,
      basis: `skipOutRate=${(skipOutRate * 100).toFixed(0)}%，idleTableRatio=${(idleTableRatio * 100).toFixed(0)}%`,
    });
  }

  // 规则 3：回捞窗口失效
  if (avgWait > 25 && reflowSuccess < 0.40) {
    headline = '回捞窗口失效，过号顾客流失';
    problem = `平均等待 ${avgWait.toFixed(0)}min > 25，但回捞成功率仅 ${(reflowSuccess * 100).toFixed(0)}%`;
    actions.push({
      text: '缩短预估等待刷新间隔，加叫号提醒',
      expected: `回捞成功率 ${((reflowSuccess + 0.2) * 100).toFixed(0)}% → 流失率下降`,
      basis: `avgWait=${avgWait.toFixed(0)}min，reflowSuccess=${(reflowSuccess * 100).toFixed(0)}%`,
    });
  }

  // 规则 4：空桌与流失并存
  if (idleTableRatio > 0.35 && lossRate > 0.20) {
    headline = '空桌与流失并存，引流动线有问题';
    problem = `空桌率 ${(idleTableRatio * 100).toFixed(0)}%，同时流失率 ${(lossRate * 100).toFixed(1)}%`;
    actions.push({
      text: '改善引流动线 / 门头可见性',
      expected: `降低空桌率，流失率 ${(lossRate * 100).toFixed(1)}% 有望下降`,
      basis: `idleTableRatio=${(idleTableRatio * 100).toFixed(0)}%，lossRate=${(lossRate * 100).toFixed(1)}%`,
    });
  }

  // 规则 5：统计偏差提示
  if (censoredRatio > 0.30) {
    actions.push({
      text: '延长观察窗口再判（删失比例过高）',
      expected: `删失 ${censored} 人占分母 ${(censoredRatio * 100).toFixed(0)}%，需更大样本`,
      basis: `censored/${denominator}=${(censoredRatio * 100).toFixed(0)}%`,
    });
  }

  // 规则 6：推演方案对比
  if (baseline && baseline.lossRate != null && lossRate != null) {
    const delta = lossRate - baseline.lossRate;
    if (Math.abs(delta) > 0.001) {
      const better = delta < 0;
      headline = better
        ? `推演方案有效：流失率 ${(baseline.lossRate * 100).toFixed(1)}% → ${(lossRate * 100).toFixed(1)}%（${(delta * 100).toFixed(1)}pp）`
        : `推演方案无效：流失率反向变化 ${(delta * 100).toFixed(1)}pp`;
      problem = `启用前后对比，delta=${(delta * 100).toFixed(1)}pp`;
      if (better) {
        actions.unshift({
          text: `采用该方案：加 ${scenario?.addTables ?? 0} 桌 / 延长容忍 ${scenario?.patience ?? 0}min`,
          expected: `流失率降低 ${(Math.abs(delta) * 100).toFixed(1)}pp`,
          basis: `baseline.lossRate=${(baseline.lossRate * 100).toFixed(1)}%`,
        });
      }
    }
  }

  return {
    headline,
    problem,
    evidence,
    actions: actions.length ? actions : [{ text: '无明确建议，继续观察', expected: '—', basis: '当前指标未触发任何规则' }],
    caveat: CAVEAT,
    source: 'rule',
  };
}
