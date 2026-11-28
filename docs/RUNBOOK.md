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

> **本机边界**：2026-11-28 在 Chrome 158 + SwiftShader 上全量 8 项里 5 项超时判 WARN；看板子集稳定 PASS。帧率判据**不进这个脚本**，仍由 #19 在 GPU 机单独判。视觉审美（像不像商场）也不由脚本判。

## 迁移 / 数据

- 本项目**无数据库迁移**：数据即 `data/stores.json` 与 `public/assets/**`，改动走 git 提交，不靠迁移脚本。
- 破坏性变化先准备可验证的备份与恢复方式，并取得覆盖该操作的授权。
- **备份与恢复四要素（前置快照 git 对象、回滚命令、触发条件、责任人）逐条写在 `docs/BACKUP_RESTORE.md`**（v1.0，11-28）。该文件同时给出「哪些是不可重建资产、哪些可从 main 重新生成」的边界。

## 部署

- 生产构建、原生依赖、持久化目录、重启后数据可读 — 构建与本地静态预览已验（见下），**公网部署未执行**。
- 部署验证以实际运行为准；构建通过不等于已上线。
- **本地预览（11-28 A 侧实测）**：`npm run preview` → `vite preview` 静态服务 `dist/`。在 main 快照上 `npm run build` 退出 0（25 modules），`vite preview --port 4173` 起服务后 `/`、5 个入口资源、`/data/stores.json`、抽样素材全部 HTTP 200。**这是本机静态预览，不是公网入口**；公网托管方式与入口仍未定。
