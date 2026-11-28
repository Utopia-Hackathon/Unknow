# 运行说明

版本：v0.1
更新日期：2026-11-24
适用基准：AGENTS.md v0.1、提交手册 v0.1

本文维护**真实存在、跑得通**的命令与环境边界。
本文不维护：规划中的命令、目标描述、产品范围（见 `PROJECT_PLAN.md`）。

> [!WARNING]
> 工程初始化前不要在这里写命令。一条不存在的 `pnpm test` 会被编码助手反复尝试，
> 比没有命令更浪费时间。命令跑通后再补，并注明实际结果与环境。
> `AGENTS.md` 不维护第二份命令表，只写「以实际脚本为准」并指向本文件。

## 工具链与配置

| 项 | 版本 / 取值 | 依据 |
| --- | --- | --- |
| 运行时 | [待确认；写入版本文件] | |
| 包管理器 / 构建工具 | [待确认；锁文件为准] | |
| 数据库 | [待确认] | |
| 系统依赖 | [待确认] | |

配置样例见 `.env.example`。开发与测试环境使用隔离数据库；测试账号不得拥有开发或生产库的写权限。
真实配置、凭据、数据库与用户素材不进入 Git、日志或截图。

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
| `node --test src/*.test.mjs src/engine/__tests__/*.test.mjs` | 单测全套（含 `perf.test.mjs` 帧率降级逻辑 11 条） | 2026-11-28 实测 46/46 全过；**逻辑单测不等于 GPU 帧率判据**（#19 仍待 GPU 机） |
| `node scripts/check-engine-contract.mjs` | 引擎接口契约验收夹具（CONTRACTS §三 + METRICS_DEF §6） | 2026-11-27 新增；当前 `src/engine/` 未交付 → `SKIP`（**SKIP 不等于通过**） |
| `node scripts/check-acceptance-cdp.mjs --port 9222` | 浏览器验收探针（A01/A02/A04/A06/A07/A12，需先起 Chrome 调试端口） | 2026-11-28 新增（#53）；本机软渲染下全量有 5 项超时 WARN，看板子集 PASS 3 / FAIL 0 / SKIP 1 |

以 CI 配置（`.github/workflows/check.yml`）为权威检查清单，不产生两套真相——上表四条命令与 CI 三个 job 一一对应。
命令存在但没跑过时写「未执行」，不写「通过」；引擎夹具的 `SKIP` 同样不算通过。

### 引擎契约验收夹具

`scripts/check-engine-contract.mjs` 把接口文档变成可执行断言，避免「文档写一套、实现另一套」到集成时才发现。

```sh
node scripts/check-engine-contract.mjs                  # 检查 src/engine/index.js
node scripts/check-engine-contract.mjs --entry <路径>   # 检查任意实现（C 的 createMockWorld 同样适用）
node scripts/check-engine-contract.mjs --require        # 验收模式：引擎未交付即判失败
node scripts/check-engine-contract.mjs --json           # 机器可读，便于后续接 CI
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

- 迁移连续编号，已应用迁移不随意重写；清库不作为正常迁移方式。
- 破坏性变化先准备可验证的备份与恢复方式，并取得覆盖该操作的授权。
- [待确认：实际迁移命令与备份恢复步骤]

## 部署

- 生产构建、原生依赖、持久化目录、重启后数据可读 — [未执行]
- 部署验证以实际运行为准；构建通过不等于已上线。
- [待确认：部署入口与限制]
