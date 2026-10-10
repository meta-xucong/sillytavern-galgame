# v59 两页内代词说话人续接 TaskSpec

## 目标

只针对 v58 回放中“前两页出现一个高置信 speaker，但当前页仍落旁白”的一小类，增加保守、可回指原文的 display-title 续接。历史只读诊断有 371 页出现单一前序标题，但前序标题含误识，不能按标题文本直接继承。

## 范围及边界

- D0 / I2 / A1。当前只处理同一条 SillyTavern assistant 原消息内的现有分页，不跨消息、不跨场景延续。
- 仅当当前页本身含“代词主语 + 动作/状态短语 + 冒号 + 配对引语”，且前两张显示页中最近的显式 source speaker anchor 唯一时，允许用该 anchor 给当前引语加显示标题。
- 前两页必须保留原有 page spans；任何 heading/structured record 边界、竞争 anchor、当前页具名主体/直接 speaker、书面载体、SFX、非对白内容都阻止续接。
- 只读 speaker index 的原文 speaker/utterance spans，不可把已经显示的标题文字作为继承依据。
- 只添加标题证据；禁止改原文、formatter、`createVisualNovelDisplaySegments`、`createPresentationPagesForMessage`、语义 annotation、identity/roster/visual 绑定、聊天文件或原版 SillyTavern 代码。

## 允许改动

- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/player/src/main.js`（只向标题 parser 传入既有前页 source spans）
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs` 和与之直接相关的 runtime regression
- 本文、三份基线文档、说话人历史回放计划、`public/game/**`、`public/game-admin/**` 构建产物

## 回归与验收

1. 真实历史目标需固定 source hash、page span、前两页 spans，并用前述冰霜巨人“它……：引语”续句作正例；不得以 narrator fallback 数下降作为正确率证明。
2. 必须拒绝前页只有“价值”等非 speaker 伪标题、前页存在不同发言人竞争、记录/标题/场景边界、书面载体、SFX、无代词主体或无配对引语的样例。
3. 对全部 v37–v58 人工金标和既有负例无回归；再次只读回放 1,834 个 fallback，报告变化及逐页迁移数；人工准确率仍需独立金标，不得伪称已验证。
4. 冻结 source segmenter/page spans 哈希、source digest、无 chat writeback、无 provider calls、无 SillyTavern 原版路径改动。
5. player/admin staged build hash、架构审计、DOM smoke、runtime/shared/speaker 测试、`git diff --check` 通过；同版本独立 A1 审计 PASS 后方可交付。

## v58 回溯基线

1,834 个旁白兜底页里，前两张既有显示页无 speaker title 1,379 页、一个不同 title 371 页、多个 title 84 页。标题是 replay 当前输出，可能误识，分桶只用于候选选择。所有 158 个聊天的发布 roster 均不可用。回溯见 `GALGAME_SPEAKER_ATTRIBUTION_V58_TASKSPEC_2026-10-08.md`。

## 停止条件

若必须改分页、依赖旧页标题而非 source anchor、跨场景/跨消息沿用说话人、需要新增角色专名词表才能命中，停止该实现并记录证据。剩余缺少唯一来源的对白继续按既有 narrator fallback 展示。

## 实施与回放结果

- 实施范围仍只有 display-title evidence：共享 adapter 接收同一消息内前两张**现有**显示页 source span；player/replay 传入 page span；正文分页器、页数组、正文、聊天记录、语义 annotation 和身份/视觉数据未改。
- 真实正例固定为 Dungeon_Master 聊天 `sourceMessageIndex=572`、`sourceMessageHash=sha256:b68fc04ee1421d93f5bb7854610361ba148a99d243d92f5b5a52355e20786c8f`：前两张回溯页为 `[578,629)` 与 `[631,690)`，目标页 `[692,725)`；“它重新坐回王座……：……”被归到 source anchor 的显示名“冰霜巨人”。测试同时固定原文与 source spans。
- 真实负例曾发现“她把账本递来，上面歪歪扭扭写着：……”错误继承 Pippa。新增书面载体阻断后，v54 历史负例恢复旁白；synthetic written-carrier 和 SFX 负例也通过。
- 完整只读回放：158 chats、950 messages、18,562 原有页、6,116 dialogue candidates；4,090 attributed、201 anonymous first appearances、1,825 narrator fallback、0 unresolved candidates。新规则触发 44 页；相较 v58 已记录 fallback 1,834 页，净减少 9 页。这个净变动不代表正确率，整体准确率仍为 `INSUFFICIENT_EVIDENCE`，所有 158 chats 缺 published roster，缺全量人工 gold。
- 来源 digest 保持 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；18,562 页完整保留，结构证据 17,804/17,804 有效。Parser/cache version 提升到 `full-message-speaker-index.v59`，避免继续读取 v58 标题缓存。
- 最终测试、构建产物同步、架构审计与独立 A1 审计结果追加在历史回放计划末尾。若独立审计未 PASS，不得标记验收完成。
