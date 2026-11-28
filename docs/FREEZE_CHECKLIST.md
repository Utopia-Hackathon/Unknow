# 12-03 功能冻结终检清单（A-05）

版本：v1.1（11-28 A 预核附录；原 ☐ 状态不变，供 12-03 当天直接勾）
适用：2026-12-03 冻结当天逐项打勾
规则：**任何一项 `☐` 就不许说"可以交了"**。未勾项必须在该行写明原因与影响，并 @ 队长。

> 每一项都能指到**文件或命令**。"看着没问题""应该OK"不是核验。
> 本清单的第五节（红线自查）是最后一道防线：#52 那个「空桌率 100%」如果被抓住在冻结前，就不会带进演示。

---

## 一、代码

- [ ] **build 通过**
  核验：`npm run build` 退出码 0，`dist/` 产出非空。
  未通过影响：提交版本无法运行——阻塞级。

- [ ] **引擎契约脚本 PASS（真实引擎，不是 mockWorld）**
  核验：`node scripts/check-engine-contract.mjs --entry src/engine/index.js` 退出码 **0**，输出无 `SKIP`。
  未通过影响：F02/F03 无真值，A04–A07 只能算界面链路——阻塞级。

- [ ] **资产校验 PASS**
  核验：`node scripts/check-assets.mjs` 退出码 0，8 张 `field-1129/*.webp` 全部可读。
  未通过影响：门头降级为文字牌（D013 允许留空，但须在此行写明是哪几家）。

- [ ] **浏览器验收探针无 FAIL、无 WARN**
  核验：GPU 机 `node scripts/check-acceptance-cdp.mjs --port 9222 --json`，8 项判据全部 PASS。
  未通过影响：WARN = 判据未判定，不是通过。逐项写明未判定的判据与原因。

- [ ] **无 `console.error`**
  核验：探针输出的 `pageerror` 为 0；浏览器控制台无红色报错（缺图 `console.warn` 不算）。
  未通过影响：演示时弹错——阻塞级。

- [ ] **无残留阻塞级 TODO**
  核验：`grep -rn "TODO\|FIXME\|待补\|占位" src/ data/ | grep -v "合法留空"` 逐条判定。
  未通过影响：把每条登记到本清单该行，写明"不影响判据"或"阻塞"。

## 二、数据

- [ ] **`data/stores.json` 在 main**
  核验：`gh api repos/Utopia-Hackathon/Unknow/contents/data/stores.json --jq .sha` 返回 40 位 sha；`node scripts/check-stores.mjs` 退出码 0 **且输出无 `[SKIP]`**。

- [ ] **10 点位齐全，字段合规**
  核验：`check-stores.mjs` 对 10 条逐条校验 `id/floor/x/z/entrance/verified/source`；楼层分布 6F×1 / 7F×3 / 8F×6（D012）。
  未通过影响：缺 `entrance` 则点击跳转失效（A09 未验）。

- [ ] **坐标口径正确（注意：不是与 `STORES_CANDIDATES` 比数值）**
  核验：`docs/STORES_CANDIDATES.md` §一顶部的**坐标口径警告**仍在；落库坐标以 `data/stores.json`（现场实测）为准，不用该表 28×20 楼板时期的旧示意值。
  **判据说明**：该表自己写明旧值与当前环形楼板（中庭中心 `(6,-4)`、半轴 `8.6×6.2`）不一致，s01/s02/s10 照抄会落进中庭。所以"与候选表一致"是错误判据；此处判的是"未拿旧示意值冒充实测"。

- [ ] **`verified` 字段处理方式写明**
  核验：`CONTRACTS.md §二` 三级定义（observed / public / unverified）在代码中有对应 UI；`public` 显示中文「位置示意（未现场核）」而非英文词；`unverified` 显示「示意位置，待现场核实」（RISK-005）。
  未通过影响：把推断说成事实——红线级。

- [ ] **`source` 无空、不虚构**
  核验：每条 `source` 为合规 E 编号或「现场 2026-11-29」；填不出的点位不得入库（`CONTRACTS §二` 硬规则）。

## 三、文档

- [ ] **`STATUS.md` 与代码同步**
  核验：主表 F01/F02/F03、点位数据、工程初始化四行与 main 实际状态逐行比对；无"#31 待合"这类已合入却写待合的表述。
  未通过影响：文档与代码不同步本身就是缺陷。

- [ ] **`ACCEPTANCE.md` 无「待补」空格**
  核验：`grep -n "待判\|待补\|待验\|TBD" docs/ACCEPTANCE.md` 逐条判定；A01–A12 每行证据列指向可核命令或截图。
  未通过影响：未判定的行写成通过 = 假验收。A10 的 `unverified` 分支、A12-5 目前是重点。

- [ ] **`DECISIONS.md` 无悬空决议**
  核验：D001–D013 每条有结论与影响范围；RISK-004（A11 字面判据与 D013 剖切冲突）已回写到 A11 判据行。
  未通过影响：评委会按字面判据扣分而我们无解释。

- [ ] **`SCHEDULE.md` 未解除卡点已逐条写明原因**
  核验：主倒排中每个未解除卡点有 `#36` 对应留言与升级记录。

## 四、材料

- [ ] **五份源稿在 main**
  核验：`gh api repos/Utopia-Hackathon/Unknow/contents/docs/AUTHENTICITY.md --jq .sha`（另四份 `AI_USAGE.md` / `WORK_DESC.md` / `VIDEO_SCRIPT.md` / `RESEARCH_LOG.md` 同法）均返回 sha；**本地存在不算数**。

- [ ] **队伍信息填完**
  核验：`AI_USAGE.md` 付费来源、`AUTHENTICITY.md` 队名 / 作品名 / 队长电话 / 指导教师 / 所在单位 / 填表日期全部非空（Issue #8 列项）。
  未通过影响：提交材料形式不合格——阻塞级。

- [ ] **四人手签扫描件在库**
  核验：AUTHENTICITY 与 AI_USAGE 各四处签名可见；不能用电子拼写代替手签。

- [ ] **3 分钟视频成片存在**
  核验：成片 3 分钟 ±10s，无水印；录屏前按 RISK-003 设非零推演参数（否则 delta 0.0pp 会被误读为推演失效）。

## 五、红线自查（最后一道防线）

> 这一节任何一个勾不上，**不许提交**。前面的分数可以丢，这里的诚信不能丢。

- [ ] **`AI_USAGE` 与产品实际一致：有没有真的调用大模型？**
  核验：`grep -rn "fetch\|openai\|anthropic\|https://api" src/ | grep -iv "texture\|asset"` 为空；`src/advisor.js` 是纯函数规则引擎，无网络请求。
  判定：若产品未调用大模型，`AI_USAGE.md` 必须如实写「未调用大模型做运行时决策」，并把 15 分的论述落在"说明文档与痛点的对应关系"上（规程口径），**不得暗示产品跑了 AI 模型**。

- [ ] **AI 建议的每条 `basis` 都是真实数字**
  核验：`node --test src/advisor.test.mjs` 退出码 0，含三条缺 `aux` 键用例；探针 `A12-advisor` PASS。
  反例（曾在 #52 出现，禁止重现）：`aux` 缺键时输出「空桌率 100%，引流动线有问题」，100% 来自 `1 - (aux.seatUtilization ?? 0)` —— 假值。

- [ ] **真实性声明与仓库事实一致：素材没有编造**
  核验：`RESEARCH_LOG.md` 已订正「246 张无实拍」的错误说法（实际有 C 的 PR #22 实拍导览牌 8 张）；门头 8 张来自 `field-1129/` 本队实拍，s07 商家效果图有 D008 §2 依据，s10 留空按 D013 说明理由。
  未通过影响：声明与仓库事实相反 = 诚信问题。

- [ ] **指标口径一致**
  核验：`METRICS_DEF.md §6` 的 `lossRate = lost/(seated+lost)`、`n<30` 返回 null 与代码一致；界面显示样本量；没有出现用别的口径冒充主指标。

- [ ] **没有把「代码合了」写成「验收过了」**
  核验：`ACCEPTANCE.md` 每行证据列为命令或截图；本清单第一节的探针无 WARN；#19 若未复测则保持 open 且材料注明机器局限。
  未通过影响：这是本轮反复出问题的地方，冻结前最后一次核对。

---

## 六、11-28 预核附录（A 侧，供 12-03 当天勾选用）

> 本附录**不改上方任何 ☐**：12-03 当天仍须按真实环境逐项重跑、亲手勾。
> 预核基准：main `a33ee35f`；A 在隔离目录用 REST 拉源码跑，本机 SwiftShader 软渲染、无 GPU。

| 项 | 11-28 预核 | 证据 / 缺口与责任人 |
| --- | --- | --- |
| build 通过 | 部分（11-28 已验） | A 11-28 在 main `afeb105` 跑 `npm run build` 退出 0（Vite 8.3.8 / 25 modules / 4 chunks）；**12-03 须在最终 tree 重跑**，A 负责 |
| 引擎契约 PASS | ✅ 可勾 | 11-28 隔离目录实拉 `a33ee35f` 的脚本跑 `check-engine-contract.mjs --require` → PASS 17 / FAIL 0 / WARN 0 / SKIP 0，exit 0。12-03 重跑确认即可 |
| 资产校验 PASS | 待 11-29 | 8 张 `field-1129/*.webp` 尚未采集（B #10/#64），C #84 已让缺图走文字牌不发 404；12-03 按实际到货数勾，B/C 负责 |
| 浏览器探针无 WARN | ❌ 未达 | 本机软渲染下 A01/A02/A07/A12 等 `evaluate` 超时判 WARN（判据未判定）；C 已领 #85 处理；**GPU 机 12-01 复跑**，A/C 负责 |
| 无 console.error | 部分 | C #84（main `a33ee35f`）已修缺图 404；GPU 机复核待 12-01，A 负责 |
| 无残留阻塞 TODO | ⚠️ 须逐条判 | `grep` 命中多为合法留空/数据待补提示；12-03 逐条登记，A 负责 |
| stores.json 在 main | ✅ 可勾 | blob `8d88b0c4321b869afd56423fa8766a1dd7ee09d6`，`check-stores.mjs` 10 点位全过、exit 0、无 `[SKIP]` |
| 10 点位齐全 | ✅ 结构可勾 | 6F×1 / 7F×3 / 8F×6（D012）；**verified 全 public、坐标示意值**——坐标口径真实性与 B #65 现场定版待 11-29，B 负责 |
| 坐标口径正确 | ⚠️ 待现场 | B #10/#65 未交；12-03 判「未拿旧示意值冒充实测」，B 负责 |
| verified 处理方式 | ⚠️ 部分 | RISK-005 中文映射已由 PR #44 修；10 点位全 public 使 unverified 分支无真实数据触发，待 B 现场数据，B/A 负责 |
| source 无空 | ✅ 可勾 | check-stores.mjs 逐条校验 source 合规 |
| STATUS 与代码同步 | ✅ 可勾 | STATUS v0.3（`77201d7664e4`）已同步引擎/#79/#81/#84；无「#31 待合」残留 |
| ACCEPTANCE 无待判空格 | ⚠️ 逐条判 | 唯一实质待补：§3「数据与素材备份恢复」本轮已补 `docs/BACKUP_RESTORE.md`（v1.0），待回填 §3 状态；A09/A10 缺真实数据分支、#19 帧率仍非「通过」，须如实保留 |
| DECISIONS 无悬空 | ✅ 可勾 | RISK-004 已按 D013 回写 A11 判据并关闭；D013 已定稿 |
| SCHEDULE 卡点写明 | ✅ 可勾 | 主倒排卡点有 #36 留言链 |
| 五份源稿在 main | ✅ 可勾 | AUTHENTICITY/AI_USAGE/WORK_DESC/VIDEO_SCRIPT/RESEARCH_LOG 均返回 sha |
| 队伍信息填完 | ❌ 未完成 | Issue #8 队名/作品名/队长电话/指导教师/所在单位/填表日期仍待填，A 负责，**阻塞级** |
| 四人手签扫描件 | ❌ 未完成 | AUTHENTICITY 与 AI_USAGE 各四处手签未齐，A 负责，**阻塞级** |
| 3 分钟视频成片 | 草稿 | VIDEO_SCRIPT 已入库；成片未做，A/队长负责 |
| AI_USAGE 与实际一致 | ✅ 可勾 | advisor.js 纯规则引擎无网络请求，AI_USAGE 须写「未调用大模型做运行时决策」（已核） |
| AI 建议 basis 真实 | ✅ 可勾 | advisor 单测 11/11（含 A12-5-a~d），DEF-DASH 清零；浏览器层待 #85/GPU 机 |
| 真实性声明一致 | ✅ 可勾 | 「246 张无实拍」已订正；门头来源见 SOURCES/D008 |
| 指标口径一致 | ✅ 可勾 | lossRate=lost/(seated+lost)、n<30→null 与代码一致，契约 17 PASS 含此项 |
| 没把「代码合了」写成「验收过了」 | ⚠️ 持续自查 | 本附录即证据；#19 保持 open，帧率未判不写成通过，A 负责 |

**阻塞级未勾汇总（12-03 前必须清）**：队伍信息填写、四人手签扫描件、3 分钟成片（A/队长）；GPU 机浏览器复核与帧率（A/C，12-01）；B 现场采集定版（11-29）。盖章报名表+承诺书待院校盖章，责任人 A，最迟 12-01。

---

## 签署

| 项 | 结果 |
|---|---|
| 全绿日期 | ____-__-__ |
| 未勾项数 | ____（每项原因见对应行） |
| A 复核 | ____________ |
| 队长判定 | ____________ |
