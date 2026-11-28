# A12-5 修复规格：缺键不得编数字

版本：v0.1（2026-11-28，A 侧实测提案）
基准：PR #52 head `fa68f54` 的 `src/advisor.js`（132 行）与 `src/advisor.test.mjs`（71 行）
判据：`docs/ACCEPTANCE.md` §2.1 A12-5——`aux` 缺 `idleTableRatio`/`reflowSuccess` 时不得输出 100%/0%，依赖它的规则不得触发。

> 本文件是**改法规格**，不是替 C 改代码。实施者：C，在 PR #52 的 head 分支上改。A 不代判穿模/配色，不关任何单。

---

## 一、根因（不止评论里那两处）

缺键被当成「最坏值」共有四处：

| 位置 | 原代码 | 缺键后果 |
| --- | --- | --- |
| L45 | `aux.idleTableRatio ?? (1 - (aux.seatUtilization ?? 0))` | `1 - 0` = **100%**，直接触发规则 4 |
| L47 | `aux.reflowSuccess ?? 0` | **0%**，与 `avgWait>25` 组合触发规则 3 |
| L44 | `aux.skipOutRate ?? (... : 0)` | **0%**，看起来正常，最难发现 |
| L26/L43 | `m.censored ?? 0`、`denominator > 0 ? ... : 0` | 缺 `detail` 时输出「入座 0、流失 0」 |

原则：**缺键 = 未知（null），不是 0 / 1**。未知量不进 evidence 的百分数，依赖它的规则不触发；有真实来源的量（如 `seatUtilization`、`skippedCount`）仍可推导。

---

## 二、精确改动清单（按原文件行号）

**改动 1 — L26**

```diff
- const censored = m.censored ?? 0;
+ const censored = m.censored ?? null;
```

**改动 2 — L40–47，整块替换**

```js
  const seated = detail.seated ?? null;
  const lost = detail.lost ?? null;
  const denominator = seated != null && lost != null ? seated + lost : 0;
  const censoredRatio = censored != null && denominator > 0 ? censored / denominator : null;

  // 只有真实存在的值（含可由真实值推导的量）才参与判定；无任何来源时留 null
  const skipOutRate = aux.skipOutRate != null
    ? aux.skipOutRate
    : (aux.skippedCount != null && denominator > 0 ? aux.skippedCount / denominator : null);
  const idleTableRatio = aux.idleTableRatio != null
    ? aux.idleTableRatio
    : (aux.seatUtilization != null ? 1 - aux.seatUtilization : null);
  const avgWait = aux.avgWait ?? null;
  const reflowSuccess = aux.reflowSuccess ?? null;
```

**改动 3 — L11 后加一个 helper，L49–57 整块替换**

```js
const pct = (v, label) => (v == null ? `${label} 未提供` : `${label} ${(v * 100).toFixed(0)}%`);
```

```js
  const evidence = [
    `流失率 ${(lossRate * 100).toFixed(1)}%`,
    `n=${n}`,
    pct(skipOutRate, '跳号率'),
    pct(idleTableRatio, '空桌率'),
    avgWait == null ? '平均等待 未提供' : `平均等待 ${avgWait.toFixed(0)}min`,
    pct(reflowSuccess, '回捞成功率'),
    censored == null ? '删失 未提供' : `删失 ${censored} 人`,
  ];
```

**改动 4 — L61**

```diff
- let problem = `当前 ${n} 个样本，入座 ${seated}、流失 ${lost}`;
+ let problem = seated != null && lost != null
+   ? `当前 ${n} 个样本，入座 ${seated}、流失 ${lost}`
+   : `当前 ${n} 个样本，入座/流失明细未提供`;
```

**改动 5–8 — 四条规则加非空守卫**

```diff
- if (skipOutRate > 0.25 && idleTableRatio < 0.30) {
+ if (skipOutRate != null && idleTableRatio != null && skipOutRate > 0.25 && idleTableRatio < 0.30) {
- if (avgWait > 25 && reflowSuccess < 0.40) {
+ if (avgWait != null && reflowSuccess != null && avgWait > 25 && reflowSuccess < 0.40) {
- if (idleTableRatio > 0.35 && lossRate > 0.20) {
+ if (idleTableRatio != null && idleTableRatio > 0.35 && lossRate > 0.20) {
- if (censoredRatio > 0.30) {
+ if (censoredRatio != null && censoredRatio > 0.30) {
```

规则 1/6 与 `actions[]` 结构不动。这样 A12-3 仍成立：某条规则触发时，它依赖的数字必定已在 `evidence` 中以百分数出现。

---

## 三、新增四条单测（追加到 `src/advisor.test.mjs`）

```js
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
```

---

## 四、怎么验

```bash
node --test src/advisor.test.mjs          # 期望：11 条全过（原 7 条回归 + 新 4 条）

node -e "import('./src/advisor.js').then(({advisor}) => {
  const r = advisor({ metrics: { lossRate: 0.25, sampleSize: 40, censored: 3, detail: { seated: 30, lost: 10 } }, scenario: {}, baseline: null });
  console.log(r.headline); console.log(JSON.stringify(r.evidence)); console.log(JSON.stringify(r.actions));
})"
```

第二条的**期望输出**（A 已在临时副本实测）：

```
流失率 25.0%，需结合指标找主因
["流失率 25.0%","n=40","跳号率 未提供","空桌率 未提供","平均等待 未提供","回捞成功率 未提供","删失 3 人"]
[{"text":"无明确建议，继续观察","expected":"—","basis":"当前指标未触发任何规则"}]
```

DOM 侧另跑 `node scripts/check-acceptance-cdp.mjs --only A12-advisor`（A12-1～A12-4 回归，A12-5 由单测覆盖）。

---

## 五、分母、回滚与未检查项

- **分母与切法**：11 条单测 = 原 7 条逐条回归 + 新 4 条；复现输入 1 例（`metrics` 无 `aux`、有 `detail`、`n=40`），取自评论 `7227188857`。未跑全量浏览器验收。
- **回滚路径**：本规格文档回退用 `git revert <合入 commit>`；C 实施后若回归失败，按 §二反向还原 8 处改动，或 `git checkout fa68f54 -- src/advisor.js src/advisor.test.mjs` 恢复 PR head 原文件。触发条件：任一原 7 条单测转 FAIL。责任人：C。
- **未检查项**：未跑 PR #52 的全量 build/CI（改动只限 advisor 与其单测，其余文件 C 此前已三绿）；未做 DOM 侧复测（A12-1～A12-4 此前在 #52 实测通过）；穿模与配色视觉未代判；未修改 C 的分支，未关任何 Issue。

> 改完请在同一 PR 回复里贴单测输出与复现命令的实际读数；A 只核数字，不代判视觉。
