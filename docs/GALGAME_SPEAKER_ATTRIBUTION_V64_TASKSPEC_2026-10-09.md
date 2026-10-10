# v64 parser/cache evidence ranker TaskSpec（继承 v61 逐引语策略）

**状态：实现、定向测试、只读全历史回放、静态构建和 DOM smoke 完成；独立 A1 静态审计对 v64 说话人链路未发现明确缺陷，但分页冻结基线无法独立核验，整体审计结论为 `INSUFFICIENT_EVIDENCE`。** v64 静态架构审计按任务边界未执行。本文定义 parser/cache/replay v64，继承 v61 逐引语策略。分类准确率仍为 `INSUFFICIENT_EVIDENCE`。

## 目标

把目前分散的结构解析结果统一成逐引语证据排序。目标是让 title projection 使用可追溯的完整原消息证据，同时遇到冲突时拒判；这不是句法分析器，也不追求全覆盖。

v63 修正 title projection 的证据优先级：当前页 quoteEvidence 已有唯一 attributed decision 时，任何 heading/pronoun/page-continuation bridge 都不得抢先返回或覆盖它；当前 quote 为同级冲突时，bridge 也必须 abstain。一般无归属 quote 只有在原有唯一、有界连续关系成立时，仍可使用既有 bridge 兜底。

v64 增补两个闭环：page-local 显式 `姓名 + speech cue + 引语` 必须作为带 source-bound speaker/evidence span 和 rank 的候选，与已存的 quote top-decision 摘要共同进入同一 resolver；same-rank 异人 abstain，不得在 projector 伪造 explicit anchor。quote evidence 只缓存唯一 top decision 摘要或冲突 rank，不保留/持久化落败候选列表。既有生产 segmenter 的四字段 probable hint 仍是独立 display-only `姓名（推测）` 证据；仅当对应同一 source quote 没有 attributed 或 same-rank conflict，且 name/action/quote span 验证成功时才展示。它不确认 speaker，不改身份或头像绑定。页面局部 cue 仅接受姓名后直接 speech predicate 或受限短语气词；复杂动作叙述不得误切姓名。

## 冻结策略

1. 每个 quoteId 保存配对/未闭合/恢复/嵌套信息、source quote span、前一句至前一边界、紧邻后句，以及映射到既有 production page core 的相交范围。相交只记录 sidecar，不能创建或更改 page。
2. 候选证据以准确 source speaker span、evidence span、source region、syntax role 和 rule id 表示。排序：明确署名/紧邻 speech cue；quote-introducing clause 中唯一主动主语；具有明确连续关系的前后句主体；独占页前两页中的唯一、仍连续 source 线索。普通姓名提及本身不授予发言人资格。
3. 语法角色顺序是发声主体优先于宾语、领属人、被提及者和 carrier。候选需姓名原文精确匹配，谓词/助词边界合法。外部文字载体/状态记录（如账本、信件、地图、屏幕、属性表格）、被动/静态介绍、标题/场景和孤立 SFX 均为阻断证据。角色明确的表情/心声框架（如姓名主体 + “露出一种…‘…’的表情”）是较低等级的 character-expression 候选，不属于外部 carrier；具名主体 + 拟声词 + “咆哮/怒吼/笑声” + 冒号 + 语言引语是 actor-vocalization/action 候选，孤立拟声仍为旁白。相同 rank 上出现不同人物必须 abstain，不能用距离或出现顺序拆平局。
4. Nested child quote 默认不是一次新发言。闭合引语后的归属只接受紧邻明确 `X说道/回答/答道`；纯动作不向前倒推。
5. quoteId 可以标记原始 quote 与多个已有页的交集；只有同一 quote 唯一、source-bound opener anchor 能支持跨页标题。quoteId 自身不创建 speaker。只有当前页独占引语时才回看最多前两张现有页的 raw source span，不使用渲染标题。不得跨 assistant 消息或场景延续。
6. 保留 scanner 当前两处句末恢复上限和已有独立 quote 保护。匿名首次语言发声标题为“？？？”；闭合但无法唯一归属时沿用中性旁白 display fallback；真实未闭合且无归属时为“未识别”。三者均不得创建 identity。

## 绝对边界

- 不得编辑、注入或改配置 SillyTavern 原版代码。
- 不得修改剧情正文、semantic annotation/DTO/service、身份/头像/roster/游戏状态。
- 不得改 `formatVisualNovelDisplayText`、`createVisualNovelDisplaySegments`、任何 body formatter、分页器、production page builder 或 page fields。
- title evidence 必须绑定当前 source message hash/index、完整可见消息字符偏移和精确现有 page core；证据不合法即拒绝。
- 生产 segmenter 区段必须保持开始函数 `createVisualNovelDisplaySegments` 到 `applyQuotedDialogueSpeakerContinuity` 之前的字节不变。任务开始 hash：3,453 UTF-8 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。

## 允许改动

- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `frontend/player/src/main.js` 仅允许 `STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION` 从 v63 升到 v64，废弃旧 memo/cache namespace；并把同一 structural message index 传给 probable title verifier。
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`
- `frontend/player/tests/runtime-regressions.test.mjs` 仅在需要适配版本断言时
- 本 TaskSpec、Native-first/Design/Frontend 三份基线及 `GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`
- 仅在实现、测试全通过后，必要时同步 `public/game/**` 和 `public/game-admin/**` build outputs。

其余代码路径一律不写。工作区既有 dirty changes 均保留；不可 reset、clean 或回滚无关内容。

## 验收用例

- 同一 quote 中，显式紧邻 speech cue 优先于弱动作主体。
- 同一 rank 上两个不同 source speaker 产生 conflict/unresolved；page-local matcher 不得绕过这一冲突。
- 生产 segmenter 生成原文 `Pippa说道：“好。”\n\n她抬起手：\n\n第十二阶段\n\n“你来了。”Sam答道。` 的独立 quote page 时，显示标题必须为当前 source quote 的 Sam，而非从前页/标题桥接来的 Pippa。
- 当前 quote evidence 已唯一归属时优先该 decision；冲突 unresolved 时不允许旧 heading/pronoun bridge 填入 speaker。无冲突、无当前 attributed decision 的普通未归属 quote，保留唯一连续关系回归。
- character-expression 和 actor-vocalization 只生成带精确 source span 的同 rank resolver 候选；孤立音效仍不产生 speaker anchor。
- 已知姓名后的否定/状态助词不得并入姓名 span。
- 已知角色持有报告/账本时，载体内容仍不得归属角色；被动、状态、领属、SFX、标题和 record cases 拒判。
- Nested child quote 默认不生成独立 anchor；parent speaker 仍保留。明确相邻的后置 speech cue可回绑；纯动作不能回绑。
- 未闭合 quote 可分析但不吸收下一条独立引语；匿名首次发声仍不建立 identity。
- production segment 深比较：page count/order/type/text/sourceText/sourceSpan/index 完全不变。仅 sidecar 可以包含 quote/page 相交 span。
- page-local cue candidate 与当前 quote top decision 用相同 resolver；同 rank 对抗 cue 输出中性旁白，不产生 anchor。
- probable hint 对应 quote 已 attributed 给他人或处于 same-rank conflict 时拒绝；无确认/冲突且生产四字段有效时保留 `（推测）` 标题。
- quoteEvidence 仅保存最终 winner summary 或 conflict rank；不得保存候选输家列表。
- 版本运行测试断言 main/cache/replay 一致使用 v64。

## 验证

需执行 shared adapter、speaker structure replay、player runtime regression 定向测试；全量历史只读 replay；静态构建和 DOM smoke；`git diff --check`。本轮已通过 adapter 1/1、speaker replay 60/60、runtime regressions 58/58、player/admin build、DOM smoke 和 `git diff --check`。v64 静态架构审计未执行：该任务的明确限制要求避免审计写入 ignored JSON。历史回放禁止调用 provider、写回聊天或修改 source；核对 source digest 和聊天目录状态。记录 candidate buckets 和覆盖变化，不能把 fallback 减少称为准确率；没有代表性完整金标时准确率保持 `INSUFFICIENT_EVIDENCE`。浏览器/移动端未验收。独立 A1 对话者逻辑未发现明确缺陷，但不能独立证明生产分页函数相对任务开始状态未变；因此整体为 `INSUFFICIENT_EVIDENCE`，不能报告为完整 A1 通过。

## 实施记录

代码改动限于冻结清单。adapter 将 prefix/suffix cue、unique action、pronoun/post-pronoun/entity-pronoun、spirit-return、recent-action、named-reaction、quoted-character-reaction、dragon self-identification/nearby dragon、laughter continuation、character-expression 和 actor-vocalization 等 source-backed 结果统一转成候选；所有 `speaker` 赋值仅在 resolver 选中候选后发生，同等级异人拒判。v63 在页投影前检查当前 core 相交 quote 的决议状态：唯一 attributed 与 conflict 阻止旧页桥接；普通 `unattributed-quoted-speech` 仍由旧规则做唯一连续关系兜底。v64 仅在页局部明确 speech cue 可精确定位、且 cue 文本边界可信时将其作为 rank-0 候选重入同一 resolver；top decision 与局部 cue 同级异人时 abstain。probable sidecar 消费同一 quote 决议摘要，阻断已归属/冲突 quote，保留无冲突有效 segmenter hint。quoteEvidence 不保存败选候选。孤立 SFX、external written carrier negative 和原始页字段保持不变。解析缓存版本为 v64。

验证结果：shared adapter 1/1；speaker replay 60/60；runtime regressions 58/58；全历史只读 replay、player/admin 静态构建、static DOM smoke、`git diff --check` 均通过。v64 static architecture audit 未执行（按本任务明确限制，避免写入 ignored JSON）。只读全历史回放命令：`node frontend/player/tools/speaker-structure-replay.mjs`。v64 回放：158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates：3,937 attributed、223 anonymous first appearances、1,932 narrator fallback、2 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；158 chats / 18,562 pages 的 published roster scope unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。生产四字段 probable hints 748/748 源跨度有效；539 条因对应 quote 已归属或冲突被决议门拦截，209 条未被此门阻断；这些是 hint/span 与展示门统计，不是准确率，replay 的互斥 bucket 仍由结构结果优先。2 条 unresolved candidate 没有可投影 quote span；accuracy 仍为 `INSUFFICIENT_EVIDENCE`。v63/v64 同源分桶属于覆盖类别变化，不能据此推断逐页迁移矩阵或准确率。Production segmenter slice 记录为 3,453 bytes / SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；实现者记录本轮前后相同，但独立审计无法核实任务起点快照，也无法从现有混合 dirty diff 区分更早改动，故不能声称已独立证明分页逻辑本轮未变。SillyTavern 冻结路径无 dirty 状态。独立 A1 对 v64 resolver/projection/probable 门控未发现明确缺陷；但因分页基线未能独立核验，整体审计结论为 `INSUFFICIENT_EVIDENCE`。真实浏览器/移动端 UI 未验收。

静态构建由 `node frontend/build-static.mjs` 复现，static DOM smoke 由 `node frontend/tools/static-dom-smoke.mjs` 复现。产物 SHA-256：`public/game/app.js` `FAA3F37A8A643B68C86C7A59699084AA167F5956EAF4128C3C6FECD4225C9E5F`；`public/game/index.html` `9E18050463DC7C84DF06EC6967B7759A262E21343D474CE8A3F98E49F0B6C95F`；player/admin `shared/sillytavern-adapter.js` 均为 `A688BAE5F30AF745A15E85AC411051E5772DEDFE406EF04143377169F02F274B`；`public/game-admin/app.js` `FD2CEEBD93B27EA1A100B00AB16C4CFACBB5F5C13ECD1C2FAA2C13F8E32198D4`；`public/game-admin/index.html` `EC5A9389685884530C2390A67AACA135A1EF5B046257A153AA3D11B2EE0FAE9F`。segmenter slice 按同一 `export function` 至下一个 `export function` 范围计算，避免边界 token 差异。
