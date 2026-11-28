# 一键复跑证据索引（评委 / 队友用）

> **这份文档解决什么**：验收结论散落在 `ACCEPTANCE.md`（台账）、`RUNBOOK.md`（运行说明）和 5 个脚本里，评委想「照着敲一遍确认结论是真的」时，得翻好几个文件。本页把**所有可复现判据**收敛成一张表：敲命令 → 对预期输出 → 看对应验收项。
>
> **唯一结果记录仍是 `docs/ACCEPTANCE.md`**。本页只做「命令 → 证据」的索引，**不改、不覆盖任何验收状态**。命令通过 ≠ 验收通过，边界见文末。

## 怎么用（3 步）

1. `git clone` 仓库后 `npm install`（首次）。
2. 按下面「复跑矩阵」逐条敲命令，对照「期望输出」。
3. 想看某条判据的判定层级与证据原文，点「验收项」列跳到 `ACCEPTANCE.md` 对应行。

> 环境基准：Node ≥ 22 / npm ≥ 11；2026-11-28 在主干 `1867b944` 实测。CI 以 `.github/workflows/check.yml` 为准。

## 复跑矩阵

### A. 工程门禁（进 CI，每次 PR 自动跑）

| # | 命令 | 期望输出 | 对应验收项 / 作用 |
| --- | --- | --- | --- |
| A1 | `npm run build` | 退出 0；`✓ N modules transformed`、`built in` 数百 ms；4 chunks 无体积告警 | 交付项「可运行样例」；`dist/data/stores.json` 落位 |
| A2 | `node scripts/check-assets.mjs` | 退出 0；贴图魔数与后缀一致、体积达标 | 素材合规（D013 门头口径） |
| A3 | `node scripts/check-stores.mjs` | `校验 data/stores.json: 10 个点位` + `[OK] 字段/楼层/id/source 全部合规` | A09/A10 数据结构（**只查结构不查真实性**） |

### B. 单测与契约（补充检查，暂不进 CI）

| # | 命令 | 期望输出（2026-11-28 实测） | 对应验收项 / 作用 |
| --- | --- | --- | --- |
| B1 | `node --test src/*.test.mjs src/engine/__tests__/*.test.mjs` | `tests 57 / pass 57 / fail 0` | 全仓单测（advisor/mockWorld/perf/textureManifest/floorPlan + engine）；**逻辑单测 ≠ GPU 帧率判据** |
| B2 | `node scripts/check-engine-contract.mjs` | `PASS 17 / FAIL 0 / WARN 0 / SKIP 0` | 引擎接口契约（CONTRACTS §三 + METRICS_DEF §6） |
| B3 | `node scripts/check-engine-contract.mjs --require` | 同上 `PASS 17 / FAIL 0` | 引擎契约验收模式 |
| B4 | `node scripts/check-dashboard-engine.mjs` | 引擎真值 50.0% / n=40 / censored=7；当前 `[复核结论] 缺陷 2 项：DEF-DASH-01, DEF-DASH-02` | A04–A07 真引擎集成层（诊断模式，缺陷未修时仍 exit 0） |
| B5 | `node scripts/check-dashboard-engine.mjs --strict` | 缺陷修尽前 exit 1；修复后应 exit 0 | C #73 修复后的自检门禁 |

### C. 浏览器验收探针（需 GPU / Chrome 调试端口）

| # | 命令 | 期望输出 | 对应验收项 / 作用 |
| --- | --- | --- | --- |
| C1 | `node scripts/check-acceptance-cdp.mjs --port 9222` | 需先起带调试端口的 Chrome；软渲染下多项 WARN，不判通过 | A01/A02/A04/A06/A07/A12 浏览器层 |
| C2 | 1440×900 ≥30fps 实测 | 需在**有 GPU 的机器**上跑 | #19 帧率判据（本机无 GPU，未判） |

## 各测试文件覆盖什么

| 测试文件 | 条数 | 保障的判据 |
| --- | --- | --- |
| `src/engine/__tests__/world.test.mjs` | — | 引擎模拟 / 窗口冻结 / 守恒 |
| `src/engine/__tests__/scenario.test.mjs` | — | 推演 delta = after − before |
| `src/mockWorld.test.mjs` | — | 合成事件流六类齐全、reason 非空（A04–A06 界面链路） |
| `src/advisor.test.mjs` | — | A12 AI 建议规则引擎 |
| `src/textureManifest.test.mjs` | — | 贴图命名与 manifest 落点 |
| `src/perf.test.mjs` | 11 | F01-01 降级逻辑（中位/panic 降档、warmup、只降不升） |
| `src/floorPlan.test.mjs` | 11 | A08 防掉中庭/防穿墙、A09/A10 点位落位几何不变量 |

## 已知在途缺陷（复跑时会对上，别误判为环境坏）

| 缺陷 | 当前表现 | 归属 | 修好后 B4 应变成 |
| --- | --- | --- | --- |
| DEF-DASH-01 | bindWorld 未换事件流 | C #73 | 事件流 = 真引擎事件 |
| DEF-DASH-02 | 指标真、事件流假（A06 自相矛盾） | C #73 | 缺陷 0 项 |
| A12-5 advisor 缺键编造数字 | `advisor.test.mjs` 已锁定缺陷 | C #68 | A12 可转绿 |
| #19 帧率 | 本机无 GPU 未判 | 需 GPU 机 | 1440×900 ≥30fps |

## 边界声明（必须一起读）

1. **命令通过 ≠ 验收通过**。CI 三 job 绿只证明构建没坏；单测证明逻辑按设计工作；都不替代 A 侧浏览器独立复核。`ACCEPTANCE.md` 的五档状态才是唯一判定。
2. **本证据索引不改状态**。它只是「命令 → 证据」的导航；任何命令结果与台账冲突时，以台账判定层级为准，并开 Issue 登记。
3. **本机环境限制**：A 的复核工作树通过 API 拉取源码文本，**未包含 `public/` 二进制素材**，故 `check-assets.mjs` 在本机报「目录不存在」——这是材料缺失，不是仓库缺陷；CI 上素材齐时会正常校验。生产构建已验证 `dist/data/stores.json` 落位。
4. **软渲染 ≠ GPU 判定**：headless SwiftShader 下浏览器探针会超时 WARN，不得据此判 A01/A02/A07 通过或失败；帧率必须有 GPU 机复测。
5. **未判就写未判**：命令没跑过写「未执行」，SKIP 不算通过，不为凑绿改判据、关检查、放宽容差。

Refs #36
