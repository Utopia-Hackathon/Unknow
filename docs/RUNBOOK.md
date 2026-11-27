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
| `node scripts/check-engine-contract.mjs` | 引擎接口契约验收夹具（CONTRACTS §三 + METRICS_DEF §6） | 2026-11-27 新增；当前 `src/engine/` 未交付 → `SKIP`（**SKIP 不等于通过**） |

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

## 迁移 / 数据

- 迁移连续编号，已应用迁移不随意重写；清库不作为正常迁移方式。
- 破坏性变化先准备可验证的备份与恢复方式，并取得覆盖该操作的授权。
- [待确认：实际迁移命令与备份恢复步骤]

## 部署

- 生产构建、原生依赖、持久化目录、重启后数据可读 — [未执行]
- 部署验证以实际运行为准；构建通过不等于已上线。
- [待确认：部署入口与限制]
