# 运行说明

版本：v0.2
更新日期：2026-11-28
适用基准：AGENTS.md v0.1、提交手册 v0.1
上一版：v0.1（2026-11-24）。v0.2 含两批改动：① Issue #87 收口（工具链取值填实 / 迁移段与备份恢复指向 `BACKUP_RESTORE.md` / 部署段补 preview 实测与「公网未执行」边界）；② 22:40 独立复跑后订正单测数 57→66。

本文维护**真实存在、跑得通**的命令与环境边界。
本文不维护：规划中的命令、目标描述、产品范围（见 `PROJECT_PLAN.md`）。

> [!WARNING]
> 工程初始化前不要在这里写命令。一条不存在的 `pnpm test` 会被编码助手反复尝试，
> 比没有命令更浪费时间。命令跑通后再补，并注明实际结果与环境。
> `AGENTS.md` 不维护第二份命令表，只写「以实际脚本为准」并指向本文件。

## 工具链与配置

| 项 | 版本 / 取值 | 依据 |
| --- | --- | --- |
| 运行时 | Node.js 22.x（11-28 复核用 22.22.2）；运行端为支持 WebGL2 的现代浏览器 | `package.json` 未声明 `engines`；11-28 A 侧在本机 22.22.2 跑通 `build` |
| 包管理器 / 构建工具 | npm + `package-lock.json`；Vite 8.3.8、three 0.187.0 | 锁文件与实际构建日志 |
| 数据库 | 无。数据为静态 `data/stores.json`（10 点位），推演在内存完成 | 仓库无 DB 依赖与连接配置 |
| 系统依赖 | 无原生依赖（纯前端静态构建，无 `.node` 二进制） | `npm install` 只装 JS 依赖 |

**本项目不读取任何环境变量**（`src/` 内只有 Vite 内置的 `import.meta.env.BASE_URL`），因此不需要 `.env` 配置；`.env.example` 是规程模板占位（`DATABASE_URL` 等本仓库用不到）。
真实凭据、用户素材不进入 Git、日志或截图。

## 启动

```sh
npm install          # 首次拉仓库后
npm run dev          # 本地开发（Vite，默认 http://localhost:5173）
npm run build        # 生产构建，产物在 dist/
npm run preview      # 预览构建产物
```

以 `package.json` 的 `scripts` 为准（2026-11-27 核对：`dev` / `build` / `preview` 三个脚本）。

## 检查

| 命令 | 说明 | 实际结果 |
| --- | --- | --- |
| `npm run build` | 生产构建（Vite 8 + three 0.187） | CI `build` job 每次 PR 执行；E-02 分包合入后本机实测 4 chunks、无体积告警 |
| `node scripts/check-assets.mjs` | 贴图格式与体积门禁（魔数校验，不只看后缀） | CI `assets` job 每次 PR 执行 |
| `node scripts/check-stores.mjs` | `data/stores.json` 字段与坐标契约校验 | CI `data` job 每次 PR 执行 |
| `node --test src/engine/__tests__/*.test.mjs` | 决策引擎单测 | CI `engine` job 使用 Node 22 执行 |
| `node scripts/check-engine-contract.mjs --require` | 引擎接口契约（CONTRACTS §三 + METRICS_DEF §6） | CI `engine` job 使用验收模式，入口缺失也会使 job 失败 |
| `node --test src/*.test.mjs src/engine/__tests__/*.test.mjs` | 单测全套（8 个文件：`advisor` 11 / `floorPlan` 11 / `mockWorld` 6 / `perf` 11 / `textureManifest` 8 / `scenario` 5 / `world` 9 / `acceptance-criteria` 5） | 2026-11-28 22:40 在 main `a33ee35` 快照实测 **66/66 全过、0 fail、0 skipped**。**订正**：此前记「57/57」是 #78 合入前（7 个文件）的旧数；本次按 8 个文件逐个跑并加总核对（11+11+6+11+8+5+9+5=66）。**逻辑单测不等于 GPU 帧率判据**（#19 仍待 GPU 机） |
| `node scripts/check-acceptance-cdp.mjs --port 9222` | 浏览器验收探针（A01/A02/A04/A06/A07/A12，需先起 Chrome 调试端口） | 2026-11-28 新增（#53）；本机软渲染下全量有 5 项超时 WARN，看板子集 PASS 3 / FAIL 0 / SKIP 1 |
| `node scripts/check-dashboard-engine.mjs` | 真引擎集成复核（A04–A07，Node 无头 DOM stub） | 2026-11-28 新增（#74）；当前报 DEF-DASH-01/02 两缺陷（派 C #73），引擎真值 50.0%/n=40；`--strict` 缺陷未修尽时 exit 1 |
| **一键复跑索引** | `docs/EVIDENCE_INDEX.md` | 评委照表敲命令即可复现各判据；命令通过 ≠ 验收通过，判定仍以 `ACCEPTANCE.md` 为准 |

CI 以 `.github/workflows/check.yml` 为准。推送到 `main` 或发起针对 `main` 的 PR 时，会运行 `build`、`assets`、`data`、`engine` 四个 job。全仓单测、浏览器探针和看板集成复核可按上表本地运行。
命令存在但没跑过时写「未执行」，不写「通过」；引擎夹具的 `SKIP` 同样不算通过。

### 引擎契约验收夹具

`scripts/check-engine-contract.mjs` 把接口文档变成可执行断言，避免「文档写一套、实现另一套」到集成时才发现。

```sh
node scripts/check-engine-contract.mjs                  # 检查 src/engine/index.js
node scripts/check-engine-contract.mjs --entry <路径>   # 检查任意实现（C 的 createMockWorld 同样适用）
node scripts/check-engine-contract.mjs --require        # 验收模式：引擎未交付即判失败
node scripts/check-engine-contract.mjs --json           # 机器可读输出
```

退出码：`0` 无 FAIL / `1` 有 FAIL / `2` 验收模式下引擎未交付。

判定分四级：`PASS` 满足契约；`FAIL` 明确违反 §三/§6；`WARN` 文档没写死但影响集成；`SKIP` 当前无法判定。
**`SKIP` 不参与「通过」的结论**，只能说明「还没法判」。D 交代码前自跑一遍，红项按提示改完再提 PR。

### 浏览器验收探针

`scripts/check-acceptance-cdp.mjs` 把 `ACCEPTANCE.md` 的 A 编号变成一条可复跑的命令。零依赖：只用 Node 22 内置的 `fetch` + `WebSocket`，**不要装 Playwright**（本机 `npm install` 常被中断，且会破坏 `node_modules` 的 junction）。

三步：

```sh
# 1) 起应用（任选）
npm run preview -- --port 4173

# 2) 起一个独立 profile 的 Chrome（Chrome ≥136 禁止默认 profile 开调试端口）
chrome --remote-debugging-port=9222 --remote-allow-origins='*' \
       --user-data-dir=/tmp/cdp-profile --no-first-run --no-default-browser-check \
       http://localhost:4173/

# 3) 跑探针
node scripts/check-acceptance-cdp.mjs --port 9222
node scripts/check-acceptance-cdp.mjs --port 9222 --json        # 机器可读
node scripts/check-acceptance-cdp.mjs --port 9222 --only boot,A06-dashboard,A12-advisor
```

退出码：`0` 全 PASS / `1` 有 FAIL / `2` 无 FAIL 但有 WARN 或 SKIP。

判定分四级：`PASS` 实测通过；`FAIL` 明确违反判据；`WARN` 探针本身没跑完（`evaluate` 超时，常见于软渲染重绘阻塞）——**判据未判定，不等于通过也不等于失败**；`SKIP` 当前环境无法判定（如 A12-5 只能在纯函数单测里覆盖）。

三个实现约束（改脚本前必读，否则会静默超时）：

1. Chrome ≥136 必须独立 `--user-data-dir`；
2. 必须依次 `Page.enable` → `Runtime.enable` → `Page.bringToFront` → `Emulation.setFocusEmulationEnabled`，否则 `evaluate` 永不返回；
3. 点击走 DOM 的 `el.click()`，不用 `Input.dispatchMouseEvent`（软渲染 + 无焦点时容易卡住）。

> **本机边界**：2026-11-28 在本机（Chrome 158 / Intel UHD 核显；当天的部分批次是带 `--use-gl=swiftshader` 起的，属软渲染，不是本机的默认状态）上全量 8 项里 5 项超时判 WARN；看板子集稳定 PASS。帧率判据**不进这个脚本**，见下节「帧率采集与判定（#19）」。视觉审美（像不像商场）也不由脚本判。

### 帧率采集与判定（#19）

`#19` 的判据是「1440×900 下 ≥ 30fps」。`scripts/check-fps.mjs` **只负责取数**，判定由 owner 对着下面的表做。工具不去"判通过"，因为一个核显读数不可能替代评委机读数——工具越界下结论，等于用一个不可迁移的数字冒充判据。

```sh
# 1) 起应用：dist 必须是冻结版（dev 版读数不作数）
npm run build && npm run preview -- --port 4173

# 2) 起 Chrome：独立 --user-data-dir 是硬要求（Chrome ≥136 禁止默认 profile 开调试端口）。
#    端口用 94xx，别用 9222（本机常被 Edge / 旧 Chrome 占用）。
#    ⚠ 不要加 --use-gl=swiftshader —— 软渲染数字按下面的边界第 2 条不得入判据。
chrome --remote-debugging-port=9444 --remote-allow-origins='*' \
       --user-data-dir=/tmp/cdp-fps --no-first-run --no-default-browser-check \
       --no-restore http://127.0.0.1:4173/

# 3) 采集（视口由脚本用 setDeviceMetricsOverride 显式设定，不需要手调窗口大小）
node scripts/check-fps.mjs --port 9444 --width 1440 --height 900
node scripts/check-fps.mjs --port 9444 --width 1440 --height 900 --out D:/tmp/fps-gpu.json
node scripts/check-fps.mjs --port 9444 --json        # 只出 JSON，便于管道
```

退出码：`0` 采样成功（默认只报告，不做任何判定）／`1` 加了 `--assert` 且本次中位 < 30／`2` 采样失败（连不上 CDP、页面没有 `__perf`、样本低于 30 帧）。

**为什么必须预热（默认 `--warmup 8`）**：判据要的是「稳态渲染能力」，不是「首屏加载有多慢」。首屏要编译着色器、解码贴图，这几帧天然是几百毫秒——不预热就采样，P95 会被这些帧吃掉。11-28 核显实测：同一份 dist，无预热 P95 = 1016ms，预热后 P95 = 16.9ms，**差 60 倍**。预热只是「导航后空等」，不调 `__perf.reset()`——reset 会把画质档位拉回 L0，那样"这次到底有没有降档"就测不出来了，而判定表第一行要的正是这个。

**读数必须凑齐的四项**（缺一项就不能上报告）：

| 字段 | 为什么必须看 |
| --- | --- |
| `glRenderer` | 显卡字符串。不知道是核显还是独显，就没法说这个数字对谁有效 |
| `actualViewport` | 真实视口。若与 1440×900 不等（窗口装饰会吃掉像素：本机默认是 1427×788），读数就不在判据工况上 |
| `stats.level` + `levelChanges` | 当前档位，以及降档/回升各几次。降过节画质的数字不是 L0 基准表现 |
| `sampling.shortfall` | 没攒满 120 帧时为 `true`，读数是短窗口中位数，不能和满窗读数横比 |

**判定表（写死，现场不得临时解释）**

| 结论 | 条件 |
| --- | --- |
| **通过** | 1440×900 下 `fpsMedian ≥ 30` **且** `frameMsP95 ≤ 50ms`，**且**全程未降档（`levelChanges.dropCount = 0`） |
| **有条件通过** | `fpsMedian ≥ 30`，但 `frameMsP95 > 50ms` **或**降档 1 次 → 允许，但报告里必须写明降档原因与实际档位 |
| **不通过** | `fpsMedian < 30` |

> **表外空隙的处置（A 侧补写，请 #19 owner 确认）**：降档 **≥ 2 次**按**不通过**处理。此时读数是"反复掉档后的表现"，已不代表判据要求的画质工况。
>
> **回升不算降档**：`perf.js` 自 #91（`4218ee9`）起允许回升一次，`levelChanges` 同时记 `drops` 与 `ups`。判定只数 `drops`；但报告里要把 `ups` 也写出来，因为跨档位的中位数不代表单一工况。

**三条不可越的边界**

1. **核显数字不能替代判据通过。** 同一台机器、同一份 dist、连续两次采样，读数可以差几十倍（11-28 实测：预热前 P95 1016ms，预热后 16.9ms）——差别不在显卡，在**采样时机与降档状态**。任何一次读数都只是"这次会话的采样"。
2. **软渲染数字只作参考。** Chrome 带 `--use-gl=swiftshader`，或 `chrome://gpu` 显示 Swiftshader 时，数字不得入判据，只能用来判断"渲染循环有没有卡死"。脚本检测到疑似软渲染会在 `warnings` 里点名。
3. **只贴一个 `fpsMedian` 的读数不可采信。** 必须四项齐（见上表）。

**实测记录（11-28 / 本机 Intel UHD 核显 / Chrome 158 / 1440×900@DPR1）——只用于说明"采样条件比显卡更影响读数"，不作判据**

| 条件 | fpsMedian | P95 | max | 最终档位 | 降/升 |
| --- | --- | --- | --- | --- | --- |
| 无预热（冷启动），旧 `perf.js` | 20.0 | 350ms | 983ms | L2 | 降 2 |
| 无预热（冷启动），#91 修复后 | 59.9 | 1016.5ms | 1033ms | L1 | 降 1 / 升 1 |
| **预热 8s，#91 修复后，第 1 次** | **59.9** | **16.9ms** | **33.4ms** | **L0** | **0 / 0** |
| **预热 8s，#91 修复后，第 2 次** | **59.9** | **16.8ms** | **33.7ms** | **L0** | **0 / 0** |

两点读法：

- 前两行说明**冷启动读数不可用**：旧代码那次 20fps 并不是"这台机器只能跑 20fps"，而是加载期长帧把窗口中位数拉下去了；修复后同样是冷启动，中位回到 59.9，但 P95 仍被加载帧顶到 1016ms。
- 后两行才是可比的稳态数：两次 P95 差 0.1ms。但**这仍不构成 #19 通过**——核显、单次会话、未覆盖长时稳定性（见 #92）。#19 保持 open，判定权在 owner。

## 迁移 / 数据

- 本项目**无数据库迁移**：数据即 `data/stores.json` 与 `public/assets/**`，改动走 git 提交，不靠迁移脚本。
- 破坏性变化先准备可验证的备份与恢复方式，并取得覆盖该操作的授权。
- **备份与恢复四要素（前置快照 git 对象、回滚命令、触发条件、责任人）逐条写在 `docs/BACKUP_RESTORE.md`**（v1.0，11-28）。该文件同时给出「哪些是不可重建资产、哪些可从 main 重新生成」的边界。

## 部署

- 生产构建、原生依赖、持久化目录、重启后数据可读 — 构建与本地静态预览已验（见下），**公网部署未执行**。
- 部署验证以实际运行为准；构建通过不等于已上线。
- **本地预览（11-28 A 侧实测）**：`npm run preview` → `vite preview` 静态服务 `dist/`。在 main 快照上 `npm run build` 退出 0（25 modules），`vite preview --port 4173` 起服务后 `/`、5 个入口资源、`/data/stores.json`、抽样素材全部 HTTP 200。**这是本机静态预览，不是公网入口**；公网托管方式与入口仍未定。
