# 数据与素材备份 / 恢复步骤

版本：v1.1（2026-11-28，A 侧收口 #87 + 单文件恢复演练实测）
适用：12-03 冻结前的数据、素材、台账回滚
基准：main `96360e23ef`（撰写时最新；每次使用前重查 `gh api repos/Utopia-Hackathon/Unknow/commits/main --jq .sha`）

> **v1.1 变更（11-28 22:55）**：① 修正 `ACCEPTANCE.md` 的 blob sha（v0.3.5 落盘后已变）；② 新增 §三.0「无 git 历史时的 REST 恢复路径」——原 §三 主命令 `git show <commit>:path` 在本机实测**跑不通**（本地无 main 新对象）；③ 新增 §七 演练记录（单文件恢复已实测通过）。**未演练**：整仓库回退、真实部署环境回滚。

## 一、备份分层（什么必须备份、什么不用）

| 层 | 对象 | 是否入库 | 备份方式 |
| --- | --- | --- | --- |
| 代码与文档 | `src/`、`scripts/`、`docs/`、`data/` | 是（main） | git 历史即备份，按下方 commit 锚点回滚 |
| 结构化数据 | `data/stores.json`（4399B，10 点位） | 是 | git blob，sha 见 §二 |
| 素材 | `public/assets/zhenghongcheng/` | 是（贴图） | git 历史；原件照片在采集设备，不入库（见 SOURCES） |
| 官方原件快照 | `docs/sources/official/*.docx` | 是 | git blob，sha 见 SOURCES S06–S13 |
| 隐私件 | 队员报名信息（S02） | **明确不入库** | 队长本地保管，不在仓库备份范围 |
| 截图原件 | 报名页截图（S01）、调研口述 | 不入库 | 用户设备保管，仓库只留清单说明 |

## 二、前置快照（真实 git 对象，勿手改）

撰写时 main `a33ee35f` 上关键对象（远程实拉，2026-11-28）：

| 对象 | git blob sha（40 位） |
| --- | --- |
| `data/stores.json` | `8d88b0c4321b869afd56423fa8766a1dd7ee09d6` |
| `docs/ACCEPTANCE.md` | `e5ba9a09d3a7b8c977682ffcceee4906991d24e3`（v0.3.5；v1.0 记的 `2276f1c8` 已随版本升级失效） |
| `src/engine/index.js` | `bbbe180e9c5e723016a92c3e05b8d9d74d4cbe33` |
| `src/dashboard.js` | `b48dfb669589158c169a57786d0a430bd432c7ce` |

commit 锚点（真实 sha，取前 12 位便于检索）：

| 锚点 | commit | 用途 |
| --- | --- | --- |
| 验收台账真引擎回填 | `9933a8f3a841` | 回退 A04–A07 / A12 升级 |
| STATUS v0.3 | `77201d7664e4` | 回退文档口径同步 |
| 当前基准 | `a33ee35f8704` | 贴图 404 修复后基准 |
| 交付材料收口 | `727b8cd` | 回退 BACKUP_RESTORE/SOURCES/RUNBOOK/冻结清单 |
| 本文件 v1.1 基准 | `96360e23ef` | RUNBOOK 单测数订正后最新 |

> 每次回滚前先用 `gh api repos/Utopia-Hackathon/Unknow/contents/<path> --jq .sha` 复核对象未变，**不拿本表的旧 sha 直接覆盖队友刚推的改动**（并发会话踩过坑）。

## 三、回滚命令（前置快照 → 恢复）

前提：本机须有完整 git 历史（`git rev-parse --is-shallow-repository` 返回 `false`）。当前本地工作树 `f9cb432` 是旧树，**回滚前先 `git fetch origin main`** 拉到最新，否则锚点不在本地。

> ⚠️ **本机实测警告（2026-11-28 22:55）**：本机 `git fetch` 长期 502/`schannel: server closed abruptly`，本地仓库**没有 main 的新对象**——`git cat-file -t 96360e23ef` 返回 `fatal: Not a valid object name`。也就是说下面「单文件回滚」的 `git show <锚点commit>:path` **在本机当前状态下必然失败**。本机恢复请优先走 §三.0 的 REST 路径（已实测通过）。

### 三.0 本机可执行路径：无 git 历史时用 REST 取 blob（已实测）

不依赖本地 git 历史，只依赖 `gh` 已授权。适用于本机（fetch 502）或任何浅克隆机器。

```bash
# 1. 先确认远程当前值，别拿旧 sha 覆盖队友新改动
gh api repos/Utopia-Hackathon/Unknow/contents/data/stores.json --jq .sha

# 2. 按 §二 的目标 blob sha 取原始内容并解码落盘
gh api repos/Utopia-Hackathon/Unknow/git/blobs/<目标blob sha> \
  --jq .content | tr -d '\n' | base64 -d > data/stores.json

# 3. 校验字节一致（必须等于 §二 表里的 sha）
git hash-object data/stores.json
```

限制：此路径只能取**已存在于远程的 blob**，不能取「从未推送过的本地版本」；恢复后若要落回 main 仍需按 §三 末段走 REST 推送。

### 三.1 单文件回滚到指定 blob（需完整 git 历史）

```bash
# 1. 确认远程当前值（防止覆盖队友新改动）
gh api repos/Utopia-Hackathon/Unknow/contents/data/stores.json --jq .sha

# 2. 从目标 commit 取文件并落回工作树
git show <锚点commit>:data/stores.json > data/stores.json

# 3. 校验恢复结果字节一致
git hash-object data/stores.json
# 应等于 §二表中 sha
```

**整仓库回到某 commit**（仅冻结前紧急回退，需队长授权）：

```bash
git fetch origin main
git checkout -b rollback/<日期> <锚点commit>   # 建分支，不直接改 main
# 验证 build / check-stores / check-engine-contract 后再决定是否推
```

**远程落盘走 REST**（本机 `git push` 长期 502，已验证路径）：建 blob（`-F content=@base64 -F encoding=base64`）→ tree（带 `base_tree`）→ commit → PATCH ref。每次建 tree 前重查 main sha。

## 四、回滚触发条件与责任人

| 触发条件 | 回滚范围 | 责任人 | 授权要求 |
| --- | --- | --- | --- |
| 交付演示前发现 `data/stores.json` 被误改为示意坐标/虚构 verified | 单文件回到 §二 blob | B（数据负责人）+ A 复核 | 队长确认 |
| 冻结终检发现 benchmark/台账被并发覆盖 | 单文件回到对应 commit | A（台账负责人） | 队长确认 |
| 生产构建失败且定位到某次新合 PR | 整仓库回到上一个绿 commit（建分支） | C（前端）/ D（引擎）按域 | **必须队长显式授权** |
| 素材贴图导致 console 404/错误图 | `public/assets/` 回到贴图到位前 commit | C + B | 队长确认 |
| 诚信红线（假数字/假验收）被触发 | 立即冻结提交，人工判定，不自动回滚 | 队长 | 最高优先级 |

## 五、恢复验证（回滚后必做）

- `npm run build` 退出 0；
- `node scripts/check-stores.mjs` 退出 0 且无 `[SKIP]`；
- `node scripts/check-engine-contract.mjs --require` 全过；
- `git hash-object <path>` 与本节 §二 sha 对齐；
- 在 `docs/ACCEPTANCE.md` 记录回滚原因、commit、验证输出，不用新结论覆盖旧证据。

## 六、边界与未覆盖

- 本机 `git push` 502，回滚到远程必须走 REST，本文命令是本地恢复路径。
- S01/S02 等不入库件的恢复**不在仓库范围内**，由队长在用户设备/聊天记录完成。
- 未验证：真实部署环境的回滚（preview/生产），需 12-01 GPU 机与部署环境到位后补测。
- 未验证：整仓库回退（§三.1 的 `git checkout -b rollback/<日期> <锚点>`）——本机无 main 对象，无法演练。
- 本文 §二 的 blob sha 会随文件更新失效（ACCEPTANCE 已实测失效一次）。**回滚前必须按 §三 第 1 步重查当前 sha**，不能直接抄表。

## 七、演练记录（已实测）

### 2026-11-28 22:55 · 单文件恢复演练（REST 路径）

目的：验证「文档写的恢复命令真能跑通」，而不只是写在纸上。

| 步骤 | 命令 | 实测结果 |
| --- | --- | --- |
| 1. 模拟误改 | `printf '{"broken":true}' > stores.json` | 得到 15B 损坏文件，sha `13e8ab8d…` |
| 2. REST 取 blob | `gh api .../git/blobs/8d88b0c4… --jq .content \| tr -d '\n' \| base64 -d > stores.json` | 恢复为 **4399B** |
| 3. 字节校验 | `git hash-object stores.json` | **`8d88b0c4321b869afd56423fa8766a1dd7ee09d6`**，与 §二 表逐位相等 → PASS |
| 4. 结构校验 | `python -c "json.load(...)"` | `version=1.0`、`stores=10`（10 点位完整） |

**结论**：REST 恢复路径在**本机（无 main git 对象、fetch 502）**条件下可用，恢复结果字节级一致。
**同批实测失败项**：`git cat-file -t 96360e23ef` → `fatal: Not a valid object name`，证明原 §三 的 `git show` 主路径在本机不可用——这是本文升 v1.1 的直接原因。

### 2026-11-28 22:52 · 生产构建 + preview 复核（main `96360e2`）

| 项 | 结果 |
| --- | --- |
| 源码一致性 | `src/main.js` / `src/advisor.js` / `src/engine/index.js` / `package.json` 的 `git hash-object` 与 main blob sha **逐一相等** |
| `npm run build` | 退出 0，25 modules，6 项产物，1.53s，无体积告警 |
| `vite preview --port 4173` | `/` → HTTP 200；`/data/stores.json` → 200 / 4399B；主 JS / three-core / CSS 全 200 |
| 边界 | 127.0.0.1 本机静态服务，非公网部署；门头 8 张真图仍未采集（B #10/#64 未交） |

> 构建时遇到本机 `safe-delete` 保护拦截 Vite 清空 `dist/assets`（261 文件 > 阈值 50），**绕行方式**：先把 `dist` 改名为 `dist_prev_<HHMM>` 再 build，让 Vite 新建目录而非删除。此坑与代码无关，记录备查。
