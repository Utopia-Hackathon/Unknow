# 数据与素材备份 / 恢复步骤

版本：v1.0（2026-11-28，A 侧收口 #87）
适用：12-03 冻结前的数据、素材、台账回滚
基准：main `a33ee35f`（撰写时最新；每次使用前重查 `gh api repos/Utopia-Hackathon/Unknow/commits/main --jq .sha`）

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
| `docs/ACCEPTANCE.md` | `2276f1c8222d915608edab13f783b569f565d8b4` |
| `src/engine/index.js` | `bbbe180e9c5e723016a92c3e05b8d9d74d4cbe33` |
| `src/dashboard.js` | `b48dfb669589158c169a57786d0a430bd432c7ce` |

commit 锚点（真实 sha，取前 12 位便于检索）：

| 锚点 | commit | 用途 |
| --- | --- | --- |
| 验收台账真引擎回填 | `9933a8f3a841` | 回退 A04–A07 / A12 升级 |
| STATUS v0.3 | `77201d7664e4` | 回退文档口径同步 |
| 当前基准 | `a33ee35f8704` | 贴图 404 修复后基准 |

> 每次回滚前先用 `gh api repos/Utopia-Hackathon/Unknow/contents/<path> --jq .sha` 复核对象未变，**不拿本表的旧 sha 直接覆盖队友刚推的改动**（并发会话踩过坑）。

## 三、回滚命令（前置快照 → 恢复）

前提：本机须有完整 git 历史（`git rev-parse --is-shallow-repository` 返回 `false`）。当前本地工作树 `f9cb432` 是旧树，**回滚前先 `git fetch origin main`** 拉到最新，否则锚点不在本地。

**单文件回滚到指定 blob**（最常用，影响最小）：

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
