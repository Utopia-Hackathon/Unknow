import test from 'node:test';
import assert from 'node:assert/strict';
import { advisor } from './advisor.js';

// Issue #50 验收：6 条规则 + n<30 分支，每条建议带数字

test('n<30 不发建议', () => {
  const r = advisor({ metrics: { lossRate: 0.3, sampleSize: 10, censored: 2 }, scenario: {}, baseline: null });
  assert.equal(r.headline, '样本不足，不做结论');
  assert.equal(r.actions.length, 0);
  assert.ok(r.caveat.includes('样本不足'));
});

test('规则 2：桌型错配', () => {
  const r = advisor({
    metrics: { lossRate: 0.317, sampleSize: 60, censored: 6, aux: { skipOutRate: 0.38, idleTableRatio: 0.22, avgWait: 18, reflowSuccess: 0.5 }, detail: { seated: 41, lost: 19 } },
    scenario: { addTables: 4 }, baseline: null,
  });
  assert.ok(r.headline.includes('错配'));
  assert.ok(r.actions.length > 0);
  assert.ok(r.actions[0].basis.includes('skipOutRate'));
});

test('规则 3：回捞失效', () => {
  const r = advisor({
    metrics: { lossRate: 0.3, sampleSize: 50, censored: 5, aux: { skipOutRate: 0.1, idleTableRatio: 0.2, avgWait: 30, reflowSuccess: 0.2 }, detail: { seated: 35, lost: 15 } },
    scenario: {}, baseline: null,
  });
  assert.ok(r.headline.includes('回捞'));
  assert.ok(r.actions.some((a) => a.basis.includes('avgWait')));
});

test('规则 4：空桌与流失并存', () => {
  const r = advisor({
    metrics: { lossRate: 0.25, sampleSize: 40, censored: 3, aux: { skipOutRate: 0.1, idleTableRatio: 0.4, avgWait: 15, reflowSuccess: 0.5 }, detail: { seated: 30, lost: 10 } },
    scenario: {}, baseline: null,
  });
  assert.ok(r.headline.includes('空桌'));
  assert.ok(r.actions.some((a) => a.basis.includes('idleTableRatio')));
});

test('规则 5：删失比例过高', () => {
  const r = advisor({
    metrics: { lossRate: 0.3, sampleSize: 35, censored: 20, aux: { skipOutRate: 0.1, idleTableRatio: 0.2, avgWait: 15, reflowSuccess: 0.5 }, detail: { seated: 20, lost: 15 } },
    scenario: {}, baseline: null,
  });
  assert.ok(r.actions.some((a) => a.text.includes('延长观察窗口')));
});

test('规则 6：推演对比', () => {
  const r = advisor({
    metrics: { lossRate: 0.255, sampleSize: 60, censored: 6, aux: { skipOutRate: 0.2, idleTableRatio: 0.25, avgWait: 18, reflowSuccess: 0.5 }, detail: { seated: 41, lost: 19 } },
    scenario: { addTables: 4 }, baseline: { lossRate: 0.317 },
  });
  assert.ok(r.headline.includes('31.7'));
  assert.ok(r.headline.includes('25.5'));
  assert.ok(r.actions[0].basis.includes('baseline'));
});

test('所有建议都带数字', () => {
  const r = advisor({
    metrics: { lossRate: 0.317, sampleSize: 60, censored: 6, aux: { skipOutRate: 0.38, idleTableRatio: 0.22, avgWait: 18, reflowSuccess: 0.5 }, detail: { seated: 41, lost: 19 } },
    scenario: {}, baseline: null,
  });
  for (const a of r.actions) {
    assert.ok(/\d/.test(a.expected) || a.expected === '—', `建议缺数字: ${a.text}`);
    assert.ok(a.basis && a.basis.length > 0);
  }
  assert.ok(r.caveat.includes('模拟数据'));
  assert.equal(r.source, 'rule');
});

// A12-5：缺键 = 未知，不得编造数字（docs/A12-5-FIX-SPEC.md §三）

test('A12-5-a: aux 全缺不产出假百分数、不触发规则', () => {
  const r = advisor({ metrics: { lossRate: 0.25, sampleSize: 40, censored: 3, detail: { seated: 30, lost: 10 } }, scenario: {}, baseline: null });
  assert.ok(!r.headline.includes('空桌'), r.headline);
  assert.ok(r.evidence.some((e) => e.includes('空桌率 未提供')), r.evidence.join('|'));
  assert.ok(r.evidence.some((e) => e.includes('回捞成功率 未提供')), r.evidence.join('|'));
  assert.ok(!r.evidence.some((e) => /跳号率 \d+%|空桌率 \d+%|回捞成功率 \d+%/.test(e)), r.evidence.join('|'));
  assert.deepEqual(r.actions, [{ text: '无明确建议，继续观察', expected: '—', basis: '当前指标未触发任何规则' }]);
});

test('A12-5-b: aux 部分缺键不触发回捞规则', () => {
  const r = advisor({ metrics: { lossRate: 0.3, sampleSize: 50, censored: 5, aux: { avgWait: 30 }, detail: { seated: 35, lost: 15 } }, scenario: {}, baseline: null });
  assert.ok(!r.headline.includes('回捞'), r.headline);
  assert.ok(r.evidence.includes('回捞成功率 未提供'), r.evidence.join('|'));
  assert.ok(!r.actions.some((a) => a.basis.includes('reflowSuccess')));
});

test('A12-5-c: 有真实来源时推导仍生效', () => {
  const r = advisor({ metrics: { lossRate: 0.317, sampleSize: 60, censored: 6, aux: { seatUtilization: 0.78, skippedCount: 18, avgWait: 18, reflowSuccess: 0.5 }, detail: { seated: 41, lost: 19 } }, scenario: {}, baseline: null });
  assert.ok(r.evidence.includes('空桌率 22%'), r.evidence.join('|'));
  assert.ok(r.evidence.includes('跳号率 30%'), r.evidence.join('|'));
});

test('A12-5-d: detail 缺键不输出「入座 0、流失 0」', () => {
  const r = advisor({ metrics: { lossRate: 0.25, sampleSize: 40, censored: 3 }, scenario: {}, baseline: null });
  assert.ok(r.problem.includes('明细未提供'), r.problem);
  assert.ok(!r.problem.includes('入座 0'), r.problem);
});
