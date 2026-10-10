# v62 parser/cache evidence ranker TaskSpec（继承 v61 逐引语策略）

**状态：实现、全套定向测试、全历史只读 replay、静态构建和架构审计完成；独立 A1 审计待执行。** 本文定义 parser/cache/replay v62，继承 v61 逐引语策略。准确率仍为 `INSUFFICIENT_EVIDENCE`。

## 目标

把目前分散的结构解析结果统一成逐引语证据排序。目标是让 title projection 使用可追溯的完整原消息证据，同时遇到冲突时拒判；这不是句法分析器，也不追求全覆盖。

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
- `frontend/player/src/main.js` 仅允许 `STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION` 从 v60 升到 v62，废弃旧 memo/cache namespace。
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`
- `frontend/player/tests/runtime-regressions.test.mjs` 仅在需要适配版本断言时
- 本 TaskSpec、Native-first/Design/Frontend 三份基线及 `GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`
- 仅在实现、测试全通过后，必要时同步 `public/game/**` 和 `public/game-admin/**` build outputs。

其余代码路径一律不写。工作区既有 dirty changes 均保留；不可 reset、clean 或回滚无关内容。

## 验收用例

- 同一 quote 中，显式紧邻 speech cue 优先于弱动作主体。
- 同一 rank 上两个不同 source speaker 产生 conflict/unresolved；page-local matcher 不得绕过这一冲突。
- character-expression 和 actor-vocalization 只生成带精确 source span 的同 rank resolver 候选；孤立音效仍不产生 speaker anchor。
- 已知姓名后的否定/状态助词不得并入姓名 span。
- 已知角色持有报告/账本时，载体内容仍不得归属角色；被动、状态、领属、SFX、标题和 record cases 拒判。
- Nested child quote 默认不生成独立 anchor；parent speaker 仍保留。明确相邻的后置 speech cue可回绑；纯动作不能回绑。
- 未闭合 quote 可分析但不吸收下一条独立引语；匿名首次发声仍不建立 identity。
- production segment 深比较：page count/order/type/text/sourceText/sourceSpan/index 完全不变。仅 sidecar 可以包含 quote/page 相交 span。
- 版本运行测试断言 main/cache/replay 一致使用 v62。

## 验证

需执行 shared adapter、speaker structure replay、player runtime regression 定向测试；全量历史只读 replay；静态架构审计；`git diff --check`。历史回放禁止调用 provider、写回聊天或修改 source；核对 source digest 和聊天目录状态。记录 candidate buckets 和覆盖变化，不能把 fallback 减少称为准确率；没有代表性完整金标时准确率保持 `INSUFFICIENT_EVIDENCE`。浏览器/移动端若未手工验收，明确列为未验收。独立 A1 审计 PASS 后才可交付。

## 实施记录

代码改动限于冻结清单。adapter 将 prefix/suffix cue、unique action、pronoun/post-pronoun/entity-pronoun、spirit-return、recent-action、named-reaction、quoted-character-reaction、dragon self-identification/nearby dragon、laughter continuation、character-expression 和 actor-vocalization 等 source-backed 结果统一转成候选；所有 `speaker` 赋值仅在 resolver 选中候选后发生，同等级异人拒判。character-expression 仅覆盖唯一角色的显式表情/心声框架；actor-vocalization 仅覆盖命名主体连接拟声/发声动作并由冒号引出语言引语。isolated SFX 和 external written carrier negative 保留。解析缓存版本为 v62。

验证结果：shared adapter 1/1；speaker replay 60/60；runtime regressions 57/57；全历史 replay、player/admin 静态构建、static DOM smoke、静态架构审计和 `git diff --check` 均通过。只读全历史回放命令：`node frontend/player/tools/speaker-structure-replay.mjs`。v62 全历史回放为 158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates：3,998 attributed、213 anonymous first appearances、1,883 narrator fallback、0 unresolved。digest 为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；全部 158 chats / 18,562 pages 的 published roster scope unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。先前临时 v61 汇总 6,100/4,022/213/1,865 与当前 v62 是同一 source digest 的类别覆盖差异；缺少 v61 旧逐页 prediction，不能构造 migration matrix 或据此判断准确率。Production segmenter slice 任务起点与结束同为 3,453 bytes / `sha256:a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；SillyTavern 冻结路径无改动。无代表性完整 gold，accuracy 仍为 `INSUFFICIENT_EVIDENCE`；真实浏览器/移动端 UI 未验收。

静态构建由 `node frontend/build-static.mjs` 复现。产物 SHA-256：`public/game/app.js` `781F66C9F734C2E6722A15BC086EB8E02FAF66B368CC300EC2857BCD8383DAFA`；`public/game/index.html` `C91D5FD2C3A7F6880036214F4B97099F570942C54BB061D5FF7F73B4CA6834B8`；player/admin `shared/sillytavern-adapter.js` 均为 `E0B2A3617793C8073B26019B7B8A155F79B7FCE063BF23B513DD6E6EED8AB5F8`；`public/game-admin/app.js` `A9794F1FF2019000AAE54BD84AB9A3813025027D61F33D31FDC24F24416DEB0B`；`public/game-admin/index.html` `1C0F2DE495913E15812A26BB4E43E3083F0FA37DAD06A5914ACEA473426C458B`。
