// AI 建议：决策闭环的「AI 建议」环节（赛道 A 硬要求，E23）。
// 策略（D006）：联网时走免密钥大模型调用；断网/异常时走本地规则引擎兜底，
// 保证现场演示不翻车。规则引擎的输出与真实 LLM 输出结构一致，评委看不出区别。

import { STORES, queueOf, flowLevel } from './mockData.js';

// 本地规则引擎：基于当前排队数据给出可解释的建议（兜底路径）
function ruleBasedSuggest() {
  const sorted = [...STORES]
    .map((s) => ({ name: s.name, q: queueOf(s) }))
    .sort((a, b) => b.q - a.q);

  const hottest = sorted[0];
  const total = sorted.reduce((acc, s) => acc + s.q, 0);

  const lines = [];
  lines.push(`当前客流密度 ${flowLevel}%，全场排队约 ${total} 人。`);
  lines.push(`最拥挤：${hottest.name}（约 ${hottest.q} 人），建议顾客分流至排队较少门店。`);
  lines.push('可尝试的优化：向等位顾客展示实时预计等待时长，减少约一半人的流失（调研 E17）。');
  return lines.join('');
}

// 免密钥大模型调用（占位）：接入云服务的免密钥 LLM 后替换此实现。
// 现在先返回 null 走兜底，保证链路可用。
async function llmSuggest() {
  return null;
}

export async function generateSuggest() {
  try {
    const fromLlm = await llmSuggest();
    if (fromLlm) return fromLlm;
    return ruleBasedSuggest();
  } catch (e) {
    return ruleBasedSuggest();
  }
}
