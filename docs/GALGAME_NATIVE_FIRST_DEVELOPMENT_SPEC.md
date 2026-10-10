# Galgame 原版后端优先开发规范

## 当前：2026-10-10 旁白页结构说话人标题投影修复

当源分页结果或语义覆盖把当前页标成旁白，但该页含有可由完整 shared 结构解析器验证的明确说话人引语时，允许精确证据仅覆盖显示标题。parser 已选定的 rank 0–2 唯一说话人/群体证据通过同一规则契约进入标题校验；不允许 player/renderer 另维护会漂移的规则白名单，rank 3/default 证据仍不用于该旁路。该旁路要求当前页证据、消息哈希、source span、view span 和规则均通过现有校验；不会改语义分类、正文、分页、source span、身份/头像、聊天数据或 SillyTavern 原版。无归属引语、结构化记录、标题页和无引语正文继续保持旁白/原显示。实现和验收见 `GALGAME_NARRATION_SPEAKER_TITLE_PROJECTION_FIX_TASKSPEC_2026-10-10.md`。

## 当前：2026-10-10 LLM-aware reset recovery

玩家复位会通过运行桥检查实际 LLM 连通性，并且只在 LLM 传输级故障时尝试替换运行桥。替换前必须取得运行桥关闭闸门，以阻止新生成并确认当前无生成；无法取得闸门就不终止进程。provider HTTP 错误只显示诊断，不触发重启循环。现有仅恢复当前绑定聊天展示的行为保持不变。详见 `GALGAME_RESET_LLM_AWARE_RECOVERY_TASKSPEC_2026-10-10.md`。

## 当前：2026-10-09 V87 本地强证据标题快路径（parser v86）

语义层给出“未识别”时，如果现有生产分段器已发现具体 runtime-text 说话候选，player 先用完整 shared parser 验证当前引语；仅 rank 0 明确发言主体证据可在等待世界书候选读取前投影为标题。其余情况继续原候选和结构分析路径。只改 display title，不改变语义分类、正文、页序、sourceSpan、身份、聊天或 SillyTavern 原版。详见 `GALGAME_SPEAKER_ATTRIBUTION_V87_LOCAL_EVIDENCE_FAST_PATH_TASKSPEC_2026-10-09.md`。

## 历史：2026-10-09 V86 复合职务称谓引语归属（parser v86）

所有剧本共用 V86 shared parser，在闭合冒号引语前识别受限复合职务称谓；前缀必须由聊天候选、通用角色称谓或同条消息的重复主体证据支持。来源/心理/并列主体和无证据任意名词仍拒绝归属。仅投影显示标题，不改变正文、分页、sourceSpan、身份或 SillyTavern 原版。范围和验收见 `GALGAME_SPEAKER_ATTRIBUTION_V86_COMPOUND_ROLE_QUOTE_TASKSPEC_2026-10-09.md`。

## 历史：2026-10-09 V85 局部人物主体引语归属（parser v84）

所有剧本共用 V84 shared parser，在冒号直接引语中恢复唯一的局部人物主体，并保留来源/心理/并列主体的拒绝边界。仅投影显示标题，不改变正文、分页、sourceSpan、身份或 SillyTavern 原版。范围和验收见 `GALGAME_SPEAKER_ATTRIBUTION_V85_LOCAL_ACTOR_QUOTE_RECOVERY_TASKSPEC_2026-10-09.md`。

## 历史：2026-10-09 V84 跨剧本结构规则（当时 parser v83；已由顶部 V86/parser v86 继承）

V84 阶段的 parser/cache 为 `full-message-speaker-index.v83`。所有已发布剧本共用同一套结构规则，角色名从当前剧本/聊天动态提供并隔离；生产 parser 与离线 replay 版本一致。累积版本门槛保证 v78 及之前规则在当前版本继续启用。题材专用线索只作条件辅助；不承诺任意语言、剧本格式都具备相同识别率。只投影既有页面标题，剧情正文、分页、sourceSpan、身份、roster、头像、聊天和原版 SillyTavern 不变。历史覆盖变化不是准确率，缺少逐页 gold 时保持 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。详情见 `GALGAME_SPEAKER_ATTRIBUTION_V84_CROSS_SCENARIO_RULE_ACTIVATION_TASKSPEC_2026-10-09.md`。

## 历史记录：2026-10-09 v77 标题规则

v77 的历史行为包括闭合引语后的声音/语气报告、句首局部动作主体引出冒号引语，以及多个逗号子句中最近的明确动作主体。当前行为以本页顶部 V86 条目为准。所有规则仅改变展示标题证据，不改变正文、分页、sourceSpan、身份、roster、头像、聊天或原版 SillyTavern。全历史覆盖变化不等于准确率；无完整逐页 gold 时报告 `INSUFFICIENT_EVIDENCE`。实现边界和回放结果见 `GALGAME_SPEAKER_ATTRIBUTION_V77_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v76 历史版本：句首具名动作引语与短代词承接

v76 历史 parser/cache 版本为 `full-message-speaker-index.v76`；当前行为以文档顶部 V86 契约及 parser v86 实现为准。实现和旧版回放见 `GALGAME_SPEAKER_ATTRIBUTION_V76_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v75 名册 cue 连接词边界

v75 为历史版本，当前版本已升级为 parser v86；跨剧本行为见文档顶部 V86 条目。

`full-message-speaker-index.v75` 延续 v74 的 display-title evidence 约束，并修正 cue 子句句首连接词导致的角色名吞并：识别名册角色时先剥离受限的句首篇章连接词，再验证该名字与明确发声/动作 cue 的同子句关系。若页级独立切词与完整消息对同一 rank-0 引语得到不同姓名边界，只在同一 cue 的源 span 对齐时采用完整消息的精确角色名。候选来源原有的保护性短路和证据 rank 保持不变；同等级冲突继续不猜。普通邻句提名、引号内人名、roster 外姓名不会因此被提升。历史回放也为 `no-unique-speaker-evidence` 旁白兜底输出 quote/span、anchor、闭合状态和分页形态诊断。仅影响展示标题及离线诊断，不改语义、正文、分页、sourceSpan、身份、roster、头像、聊天或 SillyTavern 原版。全历史无逐页 gold，准确率仍须按 `INSUFFICIENT_EVIDENCE` 报告。详见 `GALGAME_SPEAKER_ATTRIBUTION_V75_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v73 历史版本：代词发声回指；v72 宽松姓名兜底已退役

v73 是 v74 的前一版本。它在既有强规则均无候选时，根据引语前“他/她/它 + 明确发声 cue”回指最近且唯一的显式说话人锚点或唯一动作主体。相关结果与准确率限制见 `GALGAME_SPEAKER_ATTRIBUTION_V73_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v72 邻句姓名兜底与有限聊天内姓名记忆

历史版本记录；v72 邻句姓名兜底已被 v73 退役，不是当前规则。

高优先级结构规则都未归属、目标引语闭合且不是文书/思考/场景边界时，标题解析可从当前句和紧邻前后句的引号外文本中查找已知姓名；同一最优句距内有多个姓名时取文本中最先出现者。明确的泛称人物主体、代词主体、并列动作主体、引语载体和书面姓名会阻断该兜底。姓名可来自当前聊天此前至少两条不同消息中的高置信显式署名，并仅在最近 8 条消息内复用；新场景标题会清空，不读取未来消息。单条锚点回放曾产生错误姓名扩散，因此不降低双消息确认门槛。仅用于 display-title evidence，不更改正文、分页、身份、roster 或头像绑定；准确率仍须依独立 gold 验证。详见 `GALGAME_SPEAKER_ATTRIBUTION_V72_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v70 邻句已知姓名+发声线索末级兜底

既有结构化说话人规则全部没有候选、且目标引语已闭合时，标题解析器才检查目标句及紧邻前/后一句；只有同一受限句内出现已知角色名和明确发声 cue、二者之间没有句界/引号/竞争人物主体，且最优候选唯一时，才把引语标题归给该角色。单纯提及人名、多个同级姓名、书面载体、场景边界或角色 roster 外的新姓名均不触发；歧义继续进入既有旁白兜底。此规则排在所有既有归属规则之后、显示层旁白兜底之前，只影响 display-title evidence，不影响正文、分页、消息、身份或头像。详见 `GALGAME_SPEAKER_ATTRIBUTION_V70_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v69 前后句明确署名扩展

目标引语无法在现有局部窗口确定时，最多扩展到前后各两句找明确发声署名。直接绑定当前 quote 的署名优先于相邻句候选；按句距解同侧候选，跨越另一段引语/场景/书面载体时不传播；同级不同署名仍拒绝猜测。普通人名提及不是署名。只改变 display-title evidence，不改正文或原版分页。实现边界与回放以 `GALGAME_SPEAKER_ATTRIBUTION_V69_TASKSPEC_2026-10-09.md` 为准。

## 2026-10-09 v68 同句主体动作与引语闭合

display-title parser 在同一消息的冒号引语上下文中补充唯一主体动作、物品传递、工具使用与身体/表情状态结构；独立前页的外貌/情绪描述不建立说话人。书面载体、多人竞争和歧义继续兜底。仅改变展示标题 evidence，不改变正文、sourceSpan、页序、页数、roster、身份/头像或原版 SillyTavern。实现和回放结果以 `GALGAME_SPEAKER_ATTRIBUTION_V68_TASKSPEC_2026-10-09.md` 为准。

## 2026-10-09 v67 闭合引语后的代词承接

展示标题补充两种有界结构证据：唯一显式说话人经最近既有页中的“她/他 + 动作或发声”句承接到下一完整引语；以及唯一具名动作主体与引语后的同一代词相互印证。只改 display-title projection，不改聊天、身份/roster、生成语义或原版 SillyTavern。存在书面载体、场景边界、竞争说话人或歧义时继续旁白兜底。v67 全历史回放比 v66 少 3 条旁白兜底，但无完整 gold，不能据覆盖变化声称准确率提升。分页逻辑保持独立冻结；细节见 `GALGAME_SPEAKER_ATTRIBUTION_V67_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v65 同源 cue 边界与跨页诊断（实现回放完成，独立 A1 待审）

v64 回放中的两条剩余 unresolved 记录实际都有完整 source quote decision，均署名“瑞恩”。原因是页级 Han 姓名贪婪提取把“瑞恩小声说”误读成“瑞恩小声”，与同一 source cue 的已选姓名制造假冲突。v65 将同 quote、同 evidence span、同 speaker 起点的姓名前缀边界差异视为重复解析，不覆盖 quote resolver 已选结果；不同起点或证据 span 仍按 rank 冲突拒绝。跨页分类 evidence 必须裁到当前 production page core，回放诊断检查 page 相交 quoteEvidence。历史回放现有 6,094 个候选页，0 unresolved；speaker accuracy 仍 `INSUFFICIENT_EVIDENCE`。本轮前后分页 slice hash 均未变。只改变标题投影/诊断，不改变正文、分页、语义、身份状态或原版代码。独立 A1 待审。细节见 `GALGAME_SPEAKER_ATTRIBUTION_V65_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v64 同 quote resolver 与 probable 标题安全门（实现完成，整体独立 A1 证据不足）

当前页 `姓名 + 明确发声 cue + 引语` 可作为带精确姓名跨度、证据跨度和 rank 的 page-local 候选，和 quote 唯一 top-decision 摘要再次进入同一 resolver；同级异人拒绝归属。quote sidecar 只保留 winner summary 或冲突 rank，不存落败候选。生产 segmenter 的既有四字段推测 speaker 信号仍单独显示为 `姓名（推测）`，但对同一个 source quote 已确认说话人或同级冲突时不会显示；它不创建身份、roster 或头像关联。不得改原文或分页。详见 `GALGAME_SPEAKER_ATTRIBUTION_V64_TASKSPEC_2026-10-09.md`。

v64 全历史只读 replay：158 chats、950 assistant messages、18,562 pages、6,094 candidates；3,937 attributed、223 anonymous、1,932 narrator fallback、2 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；roster scope 158 chats / 18,562 pages unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。748 个 production probable hints 的原文跨度均有效，其中539个被同 quote 决议门阻断，209个未被此门阻断；这些计数是证据/可展示门诊断，replay互斥分桶仍按结构结果优先，accuracy `INSUFFICIENT_EVIDENCE`。adapter 1/1、speaker replay 60/60、runtime regressions 58/58、player/admin build 和 DOM smoke 通过；v64 architecture audit 未执行（任务边界要求避免写 ignored JSON）。独立 A1 对 resolver/projector 未发现明确缺陷，但无法独立核实 v64 分页函数任务起点快照，整体结论 `INSUFFICIENT_EVIDENCE`。segmenter slice 3,453 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。静态产物 hash 和复现步骤见 v64 TaskSpec。真实浏览器/移动端未验收。

## 2026-10-09 v63 当前引语证据优先于旧标题桥接（回放完成，独立 A1 待复审）

说话人标题按每个完整 source quote 建独立证据账本。所有来源先转成带精确人物跨度、证据跨度、来源区域和语法角色的候选，再由统一 rank/tie-abstain resolver 选择。v63 修复优先级：当前页引语已有唯一 attribution 时先用当前 quote 决议，不允许此前标题/代词桥接抢先返回；同级冲突也阻止桥接。普通无归属引语仅在既有唯一、有界连续关系成立时保留桥接兜底。明确发声署名高于唯一动作主体，后者高于相邻连续、角色表情/心声和有限前页线索。外部文字载体、状态表、场景标题和孤立 SFX 阻断归属；角色表情/心声与命名角色动作性发声仍按 v61 策略参与证据排序。只生成展示标题，不更改生产分页、正文、annotation、身份/roster/视觉资源或原版 SillyTavern。

v63 全历史只读回放：158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates；3,998 attributed、213 anonymous first appearances、1,883 narrator fallback、0 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；scope 对 158 chats / 18,562 pages unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。与 v62 复核分桶相同，不构成准确率或迁移质量证明；无代表性完整 gold，accuracy 仍为 `INSUFFICIENT_EVIDENCE`。shared adapter 1/1、speaker replay 60/60、runtime regressions 57/57、player/admin static build、DOM smoke、static architecture audit 与 `git diff --check` 通过。分页器冻结 slice 前后同为 3,453 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；SillyTavern 原版冻结路径无改动。真实浏览器/移动端 UI 未验收；独立 A1 复审待执行。实施边界见 `GALGAME_SPEAKER_ATTRIBUTION_V63_TASKSPEC_2026-10-09.md`。

静态构建复现命令为 `node frontend/build-static.mjs`。v63 关键输出 SHA-256：player `public/game/app.js` `A7AEF9E1F2C23D2D3FF8A8BB9578CC11098512F930C463B38D85F321D69EBD69`、`public/game/index.html` `8216F83DABFF9EB30B313B00515ADDCD0E3A29DAE4F7F22BBF8A00E4E436FD25`、共享 adapter `3C4EA09E05CF4BF35A0490F3ABEC059B55B7AAC54BCA026D3AB28031213AC63E`；admin `public/game-admin/app.js` `1045A549033948C22B889B488997B64398D01F5004B33FFCD515F8121857CD81`、`public/game-admin/index.html` `35F12C72AB18231363EA6A43075EA83CA1FE3CB033B48C298BDE55D718A2CB91`，共享 adapter 与 player 相同。

## 2026-10-08 v60 逐引语来源证据排序（当前说话人标题规则）

每段引语必须独立追踪完整 quote source span，结合引语前最近完整句、引语后紧邻句，以及同消息前两张既有页的 source evidence。排序优先明确署名/发声谓词和同句唯一动作主体；多人同现时按句法角色（主体优先于宾语、领属人和被提及者）而不是最近词面选择。引语独占一页时，可从前一至最多前两页找唯一原文 speaker/action anchor；若无对白 anchor，可用句法明确的唯一人物动作主体作为候选，但静态介绍、普通名词、旧显示标题或 roster 本身不能建立归属。未闭合 quote 仍分析现存前后线索并标记未闭合，不因不完整放弃；不得将其后独立引语并入同一人。书面载体、音效、场景边界和同级冲突先阻断；不唯一时沿用兜底。

该机制只产出 display-title evidence，不更改剧情正文、source spans、页数/顺序、原版 segmenter/page builder、语义 annotation、身份/队伍/视觉绑定或 SillyTavern 原版代码。实现与回测门槛见 `GALGAME_SPEAKER_ATTRIBUTION_V60_TASKSPEC_2026-10-08.md`。

## 2026-10-08 v59 两页内代词续接边界

说话人标题可在极窄场景使用同一原消息前两张显示页中最近唯一的显式 source speaker anchor：当前页必须以代词主体引出动作/状态短语、冒号和配对引语；前页记录/标题、竞争 speaker、场景边界、具名新主体、SFX、书面载体都阻断继承。不得只看前页已渲染标题文字。该能力仅改 display-title evidence，不改文本、分页、语义、identity/roster/头像或原版 SillyTavern；缺少可验证 source anchor 时保留旁白兜底。开发、负例及回放标准见 v59 TaskSpec。

## 2026-10-08 v57 相邻动作与跨页引语归属

新增两种窄的标题证据：同一消息中唯一具名动作主体紧邻一个闭合的自然语言引语时，可将引语标题归给该主体；同一闭合原始引语跨 SillyTavern 已有显示页时，只能沿同一 quote source span 续用其原有唯一归属。动作主体必须局部唯一，文书/记录载体、仅传递物件、代词无唯一锚、场景边界和新说话人均阻断推断。声音拟声片段不能独自建立 speaker；拟声与后续引语之间出现逗号/分句边界时停止旧人物继承，避免把新事件或新主体的发言倒灌给之前角色。

v57 只改 display-title evidence：不改消息正文、语义 annotation、身份/队伍/头像、原版 API、分页器、页数/顺序/source span 或 SillyTavern 原版代码。历史精确 gold 为 4/4，边界 negative 7/7，另有一个直接动作续接正例。SFX 只可通过紧邻显式动作谓词或窄范围声音框架续接唯一局部主体；新名词事件（有无标点）都切断关联。全历史只读回放（158 chats、950 assistant messages、18,562 existing pages）发现 6,112 dialogue candidates：4,046 attributed、148 anonymous introduction、1,918 narrator display fallback、0 unresolved；17,804/17,804 evidence spans 有效，0 unaddressable，source digest unchanged、无 chat writeback、无 provider calls。v56 存档分布与此明显不同且没有保存完整逐页预测基线，因此类别变化不是准确率结论；`speakerAccuracy=INSUFFICIENT_EVIDENCE`。

验证：speaker replay 53/53、runtime regressions 57/57、renderer 1/1、shared adapter 1/1；player/admin staging build、architecture audit、DOM smoke、segmenter hash 与 diff-check 通过。完整证据和外部审计结论见 v57 TaskSpec 与历史 replay 计划。

## 2026-10-08 v56 匿名实体首次发声标题

v56 窄化补充匿名首次发声：同一条原版 assistant 消息中，先出现匿名实体引入和语言对白，随后由该实体的代词加明确发声谓词承接，再出现闭合的语言引语时，显示标题可为“？？？”。历史目标页的名字只出现在它自己的引语里，因此不得从引语中提取姓名。文书/公告载体引用不适用；纯声响或描述而没有语言引语也不适用。已有明确说话人仍优先，场景边界或证据冲突拒绝匿名归属。

这是显示标题证据例外：标题 evidence 可标记为匿名未归属对白，但语义 segment/type、原文、身份、roster、头像/媒体绑定、聊天数据和原版分页均不变；`speakers` 必须为空。它只覆盖经 v56 精确历史页确认的局部结构，不放宽一般闭合未知引语仍显示旁白的规则。精确 source hash/span、回放指标和验证证据见 v56 TaskSpec 与历史回放计划。

v56 验证：目标生产页及两类负例均通过，speaker replay 51/51；全历史只读回放为 6,240 个候选页，其中 4,524 attributed、140 anonymous introduction、1,576 narrator fallback、0 unresolved。相较 v55 的 +22 anonymous / −22 fallback 是覆盖桶迁移，不是准确率。逐页对照发现这 22 页是同一匿名 Gribble 发声页在不同历史归档中的重复：归一化页内容 SHA-256 完全相同，只有三种源消息偏移/哈希版本；不是 22 个独立 gold。准确率仍 `INSUFFICIENT_EVIDENCE`。

## 2026-10-08 v54 标题结构归属补充

v54 只扩展现有标题证据解析：支持具名主体的发声框架、明确动作后引出的对白、语法粒子后的完整姓名、同一未闭合引语在既有页之间延续，以及最近唯一同场景角色的简短代词说话 cue。动作名词线索须由正文中的主体关系和紧邻引语支持；报告/账本载体文字、仅递交物件、匿名描述“只用尖细的声音说”、无唯一锚或场景冲突不得推断 speaker。无法唯一归属时遵循既有 display-only“旁白”fallback；不创建身份、roster 或人物头像绑定。

真实历史六条页面 gold（Pippa 发声、尼布“则”、Pippa 查账本、胖商人动作、Lila 跨页未闭合对白、Priya 近邻代词）均按原 chat hash、生产页 index/span 和可见标题回放为 6/6。全历史只读 replay 为 158 chats、950 assistant messages、18,562 页、6,242 dialogue candidates：4,519 attributed、118 anonymous introductions、1,605 narrator display fallbacks、0 unresolved；fallback reason 合计 1,605（no-unique 1,591、narrative quote 2、ambiguous local 2、dialogue shape 10）。相对 v53 的类别净变化为 attributed +19 / fallback −19；这是覆盖分类移动，不是准确率提升。speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。

聚焦验证：runtime 57/57、renderer 1/1、shared adapter 1/1、speaker replay 47/47。历史源 digest 与 v53 相同，evidence 17,806/17,806 有效、0 unaddressable、`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。正文、语义 annotation、身份、头像、页数/顺序/span、分页与原版 SillyTavern 代码均未改变。v54 TaskSpec 和历史回放计划记录剩余限制及构建/静态审计证据。

> 文档状态：最新强约束 v3.0
> 生效日期：2026-07-24
> 优先级：高于 `docs/GALGAME_DESIGN_SPEC.md` 与 `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` 中所有冲突内容

## 2026-10-08 v53 A2 标题范围与说话 span 修正（最新补充）

v53 的六条真实历史标题、source body、原有 segmenter、分页和角色身份边界继续有效。本补充只修复标题证据侧车的两处缺陷：同聊天 observed-name 词表只统计调用方提供的最近八个消息位置，并在识别到首屏 Markdown/中文场景标题时先清空；实时快照中的玩家/空消息会消耗一个位置但不提供姓名证据。因此旧场景角色名不会作为词表流入新场景。该词表只帮助解析当前原消息里的局部明确结构 cue，不继承前一说话人或代词归属，当前消息仍须有自己的说话/动作锚及精确 source span。

对于“姓名 + 把/摊开/展开报告等载体动作 + 直接`说`cue”的结构，只能把完整姓名截在动作边界之前；禁止把`把`或物件文字并入姓名。无安全完整姓名，或引语来自`报告上写着`等文书载体时，保持 display-only 旁白 fallback。该修正规则不改变语义分类或原文。

最新回归：runtime regressions 57/57、presentation renderer 1/1、shared adapter 1/1、speaker replay 46/46；六条真实历史 gold 仍为 6/6。最终全历史结果为 158 chats、950 assistant messages、18,562 existing pages、6,242 dialogue candidates（4,500 attributed、118 anonymous、1,624 closed-speech narrator display fallback、0 unresolved display rows）；candidate fallback reasons 精确合计 1,624，最大项为 no-unique-speaker-evidence 1,610。source-set digest 未变，17,806/17,806 evidence pages 有效、0 unaddressable、`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。与冻结 v52 分布相比，候选 −160、attributed −471、anonymous +15、fallback +296；这是限制 observed-name 借用范围后的保守分类迁移，不是准确率改善，也不能推出所有 fallback 都是真旁白。全语料准确率仍 `INSUFFICIENT_EVIDENCE`。精确命令、静态构建/哈希和样例抽样建议见 v53 A2 TaskSpec 与历史 replay 报告。

## 2026-10-08 v52 同消息说话证据与回放分母（由 v53 补充）

v52 只扩展标题侧车对**同一条原版 assistant 消息**中已有说话证据的查找：可从闭合对白前后的直接署名/说话 cue、具名动作锚和同场景最近唯一角色锚建立标题；只有仍未闭合的同一配对引语可跨现有显示页续接。唯一代词回指必须落在同一消息、最近唯一锚且没有场景边界或更强冲突说话者。消息正文、分页结果和 source spans 是冻结输入；不跨聊天/消息借名，不创建持久角色状态。明确文书载体内容归“旁白”；“人群”要求同消息中明确群体来源加连续匿名引语，单有多条引语或“消息传开”不足以猜群体。玩家“你”只由引号外明确的玩家发话线索建立；NPC 引号内第一人称不算玩家证据。

同消息回溯范围取代旧章节对“只能看当前页/紧邻前两页”的**标题证据搜索范围**限制；它不取代同场景、唯一锚、引语开闭状态和冲突拒绝条件，也不改变现有分页页数组。标题无法唯一归属的闭合对白继续按 v51 显示旁白 fallback；匿名首次出现仍为“？？？”，真正未闭合引语仍为“未识别”。

v52 全历史只读回放（同一 source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`）：158 chats、950 assistant messages、18,562 existing pages、6,402 dialogue candidates；4,971 attributed、103 anonymous introductions、1,328 narrator display fallbacks、0 probable、0 unresolved display rows。与记录的 v51 分桶相比，候选净增 23，attributed +63、anonymous −2、fallback −38；这是覆盖分类变化，不是准确率提升，也没有保留逐页 v51→v52 transition set 来按单条规则分摊这 23 页。候选 fallback reason 总数严格为 1,328：无唯一说话证据 1,317、叙述框架中未归属引语 2、局部回指歧义 4、对白形态无说话 cue 5；全页旁白诊断另计 1,447，其中包含 119 条非候选叙述页。结构证据 17,818/17,818 span 有效；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。由于聊天缺完整逐聊天发布角色范围，且没有完整逐页人工 holdout，speaker accuracy 仍是 `INSUFFICIENT_EVIDENCE`。

本节只改变 display-title evidence 和诊断统计，语义 segment/type 不变；fallback 仍不创建身份、roster、人物头像绑定。v51 renderer/narrator channel 合同仍然有效，见下节。

## 2026-10-08 v51 闭合对白旁白显示兜底（由 v52 补充）

对于**已闭合/完整、但没有唯一说话人证据的对白**，播放器标题与视觉上下文按用户确认的 display-only 策略显示为“旁白”：renderer 可使用 `role=narrator`，并且只走已有中性 `CORE_NARRATOR_PLACEHOLDER_URL`/`narrator` channel。该标签不表示内容已被语义分类为 narration；语义 segment/type 不变，说话人 identity 仍 unresolved。旁白兜底不得创建人物身份、roster 成员、角色头像绑定，也不得读取角色 catalog 头像。

明确 speaker/group evidence 始终优先；匿名首次登场仍显示“？？？”；真正未闭合的引语仍显示“未识别”，不适用旁白兜底。本节是展示标题策略的最新窄例外，**取代旧版“缺少说话人证据必须 unknown/未识别，不能降为旁白”的显示标题要求**；它不改变 semantic annotation、source body、既有 segment/page、分页顺序/数量/span、聊天数据或 SillyTavern 原版代码。Frontend renderer 细则见 `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` 的 StageMessagePresenter 合同；产品规则同步见 `docs/GALGAME_DESIGN_SPEC.md` 与 TaskSpec。

## 2026-10-07 结构化标题人工校准（parser v16）

按经用户确认的粗粒度规则生成标题：玩家明确发言使用“你”；有数量/群体主体且同一结构引出对白时显示角色类别加“（群体）”，例如“守卫（群体）”；铭文、书信、记录等被引用文字属于“旁白”；检定、数值与状态类游戏信息不再使用独立标题，标题统一显示“旁白”。明确编号选项仍显示“选项”，场景首屏标题仍显示“标题”。

若角色名/称谓在冒号前承担该动作并直接引出引语，按动作前主体归属；例如“艾瑞克大法师私下找到你：‘……’”。该模式必须能从当前消息精确定位主体和引语，不跨消息猜测。

这些结果是分页完成后的标题投影。结构化记录和群体标题不据此创建角色身份、队伍成员或单人头像；玩家标题“你”继续走 player channel。对白归属证据不足时按上方最新例外处理：闭合对白显示“旁白”，未闭合引语仍为“未识别”，匿名首次登场仍为“？？？”。规则不得改写原文或正文分页；详见 `docs/GALGAME_FULL_MESSAGE_SPEAKER_EVIDENCE_PROJECTION_DEVELOPMENT_SPEC_2026-10-07.md`。

### parser v17 复合谓语边界

`补充道/提醒道/回应道/插话道/解释道/嘀咕道/嘟囔道` 按完整说话谓语识别，防止长角色名被截断；代词或泛指短语仍不得冒充角色名。属于分页后的标题投影规则，不影响 SillyTavern 原文、分页或身份。

### parser v18 标题位置与情境归属

“标题”仅用于剧情推进开头：首屏标题形态或显式 Markdown 场景标记可显示标题，其他看起来像标题的正文归旁白。独立短拟声词引语归旁白，普通短句引语仍保留归属检查。角色名称紧邻动作/反应并由冒号引出对白时归该角色；数字与经验汇总归旁白，明确署名优先。只影响标题，不改变原文、分页、身份或游戏状态。

### parser v24 复审补充

姓名后的连接词不属于姓名；只有动作确实延续到下一句时才允许跨拟声词归属，新的代词主体必须阻断旧说话人继承。具名说话人直接负责的拟声对白仍按署名归属。原文段落边界和 source span 必须保留；任何 display-side 合并只能撤销格式化器插入且原文不存在的换行，不得吞并原文空行或改变原文页序、内容和来源跨度。历史回放的人工上下文校准与程序自动识别统计分开记录；当前历史覆盖不是准确率。

### parser v20 标题位置硬规则

用户确认“标题”只出现在每次推进剧情的开头。仅当前 assistant 消息的第一个可见生产页可标为“标题”；所有后续页的标题样式正文（包括显式 Markdown `#` 标记、括号/书名号标题和冒号标题）均归“旁白”。确切角色署名和直接对白归属仍按 speaker evidence 处理，不被标题形态规则覆盖。该规则只追加展示标签，不改变正文、分页、source span、speaker identity 或聊天数据；细则与同快照回放数据见 `docs/GALGAME_FULL_MESSAGE_SPEAKER_EVIDENCE_PROJECTION_DEVELOPMENT_SPEC_2026-10-07.md`。

### parser v21 中文标题符号补充

后续标题样式还包括中文全角括号 `（…）` 和书名号 `《…》`。它们在推进开头按“标题”处理，在后续页面按“旁白”处理；底层 page type 为对白候选也不能令其掉回“未识别”。具名 speaker 的明确引语归属优先，不受标题外观误判。其余约束沿用 v20。

### parser v22 动作引语与拟声词续接

明确的 `角色主体 + 动作/反应 + 冒号 + 引语` 归动作主体；通用动作 cue 覆盖常见的欢呼、低吼、撕开/取出、移动等，不要求额外的“说”字。短拟声词从对白候选中排除，即使位于较长消息的中间；同句动作结构中若拟声词夹在主体与后续冒号引语之间，可跨过该拟声词找回同一主体。普通短对白仍为未归属候选；规则只产生标题 evidence，不改正文、分页、sourceSpan、角色身份或聊天。全量历史数据与边界见说话人证据开发规范 v22。

## 2026-10-06 说话人标题 Demo 窄范围补充

玩家端标题允许按 `docs/GALGAME_SPEAKER_LABEL_HYBRID_DEMO_DEVELOPMENT_SPEC_2026-10-06.md` 使用少量明确、可定位原文跨度的结构模式，即已发布角色的明确署名、带直接归属标记的引号对白，以及同一原版消息内已确认说话人的跨页未闭合引语。这是仅供标题显示的快速提示，不是通用语言分类器；不得增加题材词典、大型动作词表或别名猜测。跨页续接只允许从前一相邻页通过来源/hash/span 验证的单一 speaker title evidence 继承；原版消息作者名或 unknown 标题不能作为起点。只有当前页标题缺失或 unknown 时才可补充；已经通过现有校验且对当前页有效的完整投影标题仍有优先权。段数组存在本身不等于当前页已有有效标题，也不得因此阻断页级补充。仅就标题补充而言，本条也允许把现有 page-window 语义标题附加到当前页 unknown segment；它不再受旧文“只补 source-only base page”的限制，但只在 source message hash 与当前显示页 sourceSpan 精确唯一对齐时应用。所有提示只影响标题，不改正文、分页、Annotation v1、identity、头像、roster、聊天或存档；明确/疑似对白不确定时仍显示“未识别”，普通无标记正文按下方粗分类补充处理。

### 2026-10-06 标题粗分类修正

当前可见 character 正文若没有结构化说话人署名、引号对白形态或语义对白证据，玩家标题允许以“普通未标记正文”作为粗略旁白 fallback。该 fallback 仅改变标题文案，不把 annotation segment、speaker identity、视觉 channel、头像或 roster 改成 narrator；带引号、行首对话格式或姓名冒号前缀的疑似对白仍为“未识别”，语义标注一旦明确为 dialogue/unattributed-dialogue，即撤掉粗旁白标题。无模型响应时阅读不阻塞；未加引号的对白存在被粗略显示为“旁白”的可能，这是 Demo 取舍，不能据此绑定旁白头像或人物身份。

## 2026-10-07 标题结构证据优先级补充（parser v11）

结构标题只在既有生产 page core 上建立 display-only evidence。优先级为：当前页强说话证据/已验证 speaker anchor → 明确编号选项、字段/清单记录或首屏短标题 → 完整消息引语范围的弱相交 → 原 production page type 回退。已发布角色名 + 同句短动作描述 + 紧邻冒号 + 引语可归属给冒号前角色；该规则要求精确 roster 命中。无 roster 时保持未识别。首屏冒号标题只能作为窄候选：首个可见 source page、标题头 4–8 字且无叙述开头/谓词尾、副标题至少 10 字、当前 production page type 不是对白；无显式 scene marker 时不把任意冒号行都当标题。不符合者保留普通正文/ambiguous。无法判断的长配对引语跨页内容保持对白候选或 ambiguous，不仅凭页面相交推断说话人或改成旁白。

历史 v46 曾对所有引号在第二个句末截断；该规则已由 v49 修正并 supersede。当前行为是：配对闭引号优先，持续扫描到实际闭合符；只有确实未闭合的引号才在第二个句末边界强制结束并重扫后缀。该逻辑只裁剪说话人/对白证据，不修改原消息、production page 正文、页数、页序、sourceSpan、Annotation 或聊天。

## 1. 纠偏结论

此前 v2.0 将“不要重做 SillyTavern 原版能力”错误收缩成了“玩家点击后进入原版 SillyTavern UI”。这是错误方向。

本项目的正确原则是：

**SillyTavern 原版负责后端能力、资源和运行语义；Galgame 定制层负责玩家可见的日式游戏前端。**

玩家不应该学习或使用原版 SillyTavern 复杂 UI。玩家应停留在 `/game/` 的自定义 Galgame 界面中游玩；角色卡、世界书、预设、上下文、聊天历史和生成语义必须来自 SillyTavern 原版能力。

## 2. 不允许重做的原版能力

以下能力必须由 SillyTavern 原版数据、接口或运行机制提供，不允许在定制层重新实现一套不兼容系统：

- 角色卡管理、角色卡正文和角色卡格式
- 世界书管理、激活规则、权重、位置和上下文预算
- 预设、指令预设、系统提示和上下文预设
- 模型/API 配置和生成参数
- 聊天历史、消息编辑、重生成、滑动等原版语义
- 群组、角色书、扩展和原版上下文构造逻辑
- 实际文本生成、续写和失败恢复语义

如果某项能力暂时无法通过自定义前端等价调用原版机制，应把它标为未桥接能力，而不是改成前端自建玩法，也不是把玩家赶回原版 UI 作为产品完成状态。项目只做上层开发：任何 SillyTavern 原版代码均为只读，包括后端、原版前端、插件/扩展及其启动/构建代码；外接桥只能调用原版既有接口或运行时，不能修改、注入、覆盖或复制后改造原版代码。需要原版新增能力时必须停止该路径并报告，不得在本仓库中补丁式实现。

## 3. 必须保留的自定义前端

玩家端 `/game/` 必须是自定义 Galgame UI，目标包括：

- 标题画面、舞台、背景、角色层、对话框和输入区
- 用普通游戏语言展示开始、继续、读取、历史、设置等操作
- 可在标题页选择管理员已上架的多个作品，但只显示作品级信息，不显示后台剧本结构或原版资源绑定
- 隐藏模型、API、Token、提示词、预设、角色卡、世界书等酒馆术语
- 以 Galgame/JRPG 方式呈现 SillyTavern 返回的聊天内容
- 按剧本需要展示 HP、装备、背包、技能、任务提示等信息槽位
- 后续接入图片/视频/语音等媒体展示

玩家端不得把“跳转到原版 SillyTavern UI”作为正常游玩路径。原版 UI 可作为管理员、调试或维护入口，但不是玩家主体验。

### 3.1 自定义前端不是自定义玩法

自定义 `/game/` 可以持续优化视觉和交互，例如标题画面、舞台、对话框、逐字显示、历史、存档、移动端布局，以及 HP、装备、背包、技能等信息槽位。但这些都只能是 presentation layer。

视觉呈现只读取原版聊天的可见内容。不得依赖单个题材的敌人名、角色词表或动作句式来定义通用实体/说话人语义；需由带证据的版本化呈现标注识别角色实体，再独立解析身份与视觉资产。对应立绘由已发布视觉 catalog 提供，按经验证身份确定性绑定，资源耗尽或证据不足时保留未知占位并允许恢复。不得猜测性别、改写原版消息或创建独立剧情状态。语义标注未通过语言 gate、仍在 shadow、缺失、失败、过期或与当前消息时间线不符时，assistant/character 的可见文本仍须完整显示，semantic classification/identity 保持 unknown；不得调用旧启发式把它语义降为 narration 或猜成角色。semantic unknown identity 使用独立中性占位。仅已闭合/完整且无唯一 speaker 的对白可按 v51 在 display title/context 使用 role=narrator 和 CORE_NARRATOR_PLACEHOLDER_URL/既有 narrator channel；不得读取 character catalog、创建身份/roster/avatar binding。只有有效语义标注可将文本语义分类为 narration 或已归属对白；玩家消息继续使用独立 player channel，原版隐藏 system 消息由 adapter 排除。

视觉匹配只能使用活动 catalog 中通过内容校验的资源：舞台背景至少为 640×360 且横向比例不低于 1.2，动态人物图至少为 320×320；头像的管理员显式绑定继续按其已校验引用精确呈现。可见投影给出具体地点或人物外观/种族/性别证据时，匹配器可使用发布 catalog 的闭集语义标签作为分析器失败时的有限回退；人物候选若缺少足够语义标签或最优候选不唯一，仍使用未知占位，绝不按 catalog 顺序随机选图。该逻辑只选择 presentation asset，不写入原版聊天或剧情状态。

视觉 catalog 的活动版本必须使用带内容哈希校验的显式角色用途映射（`character|player|narrator|system`）；本次 `system` 通道保持零引用并使用中性内置占位。旧 v1 catalog 可继续读取场景/图标资源，但未分类人物资源必须 fail closed，不参与头像候选；新增素材不能通过无用途的简易发布接口改变活动 catalog，必须走显式 v2 清单流程。升级活动 catalog 必须先只读预览并完整校验，再由带并发校验和崩溃恢复的事务 copy-on-write 发布，协调 catalog 与控制配置的活动指针后才对读取开放；旧 catalog、资产、聊天和存档均保留，失败时恢复精确旧指针并可回滚。场景背景只在经过原文哈希/跨度校验的 `scene-continuity.v1` 标注为 `changed` 时尝试切换；`continued` 时保留当前背景，`changed` 但没有唯一合格资源或资源加载失败则清除旧场景身份并回到当前发布版本的默认背景，`unknown` 或证据校验失败时不猜测切场。语义 annotation 未通过整语言/整剧本 gate 前，不得宣称未知地点均可识别，也不得用剧本专属正则补足。

玩法和剧情权威仍属于原版 SillyTavern：角色卡、世界书、预设、权重、上下文、聊天历史、`Generate()`、角色回复和原版玩法语义必须由 ST 提供。前端只能读取原版聊天或原版输出中明确给出的结构化/半结构化信息并展示；不得创建第二套剧情状态、节点、分支、结局、关系/库存/HP 计算引擎或自定义生成协议。

HP、装备、背包、技能、好感度、任务状态等展示槽位只有在原版角色回复、原版聊天文本或管理员明确绑定的展示配置提供相应信息时才显示或更新。没有明确数据时应隐藏或显示未知；不得凭空推断、硬编码、用前端状态替代原版聊天权威。行动按钮只能作为普通玩家输入提交回原版 ST，不得在前端执行分支逻辑或判定结果。

跨剧本的说话人、人物身份、头像和队伍/状态呈现必须是可从已展示的原版聊天重算的 presentation projection。消息级 `name/speaker` 只说明原版消息作者，不能推定正文内每句对白的说话人；无法确认的对白在语义与 identity 层仍须与 narration 分开；仅对已闭合/完整、但无唯一 speaker 的对白，显示标题按 v51 最新例外显示“旁白”fallback。该 display label 不改 semantic type，不创建 speaker identity、roster 或角色头像绑定；不得仅因未命中角色表或句式规则就推断人物。语义标注可以使用受限分析器，但结果必须绑定原文证据并经确定性合同校验，不生成或改写剧情，不写回聊天，也不成为平行玩法状态。speaker 证据必须引用同一条可见消息的原文并覆盖对应人物提及；当署名子句位于引号对白段外时，speaker evidence 可跨 segment 边界，但不能越出消息或把署名叙述并入对白，其他 segment evidence 仍遵守各自范围校验。人物身份、资产绑定和状态摘要分别解析；跨消息缓存必须可失效并可从原版可见聊天回放。使用缓存投影前必须将聊天 ID、完整 assistant 时间线、原文哈希/文本和作者标签与当前快照对照；编辑、swipe、删除或分支变化立即令旧投影失效，异步重算期间保持 unknown-safe。冲突 roster 状态须可见为待确认；独立头像账本仅保存派生 identity/asset 标识并按 chat/release/arc 隔离。通用设计和验收见 `docs/GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md`；该提案完成前，不得将旧文档中的剧本专属词表/句式启发式视为通用分类契约。

展示分析 provider 使用内部、版本化的 semantic-candidate DTO。普通与密集长消息统一使用服务端生成的 request-local source-unit ID 与 evidence-cell ID；这些 ID 只映射原文位置，不编码字符偏移。服务按 Unicode 句子/换行/词/字素边界无损划分约 120–160 code point 的 source unit，并将其切成不超过约 24 code point 的 evidence cell。provider 只返回 unit 类型、说话人引用和 evidence-cell ID，不输出数值偏移、相邻原文锚点、逐字符 marker 或复制的边界 quote。服务负责将 ID 映射为精确原文 span、重算 hash；若 provider 返回行序或 unit ID 偏差，只有在每个普通分类行的 request-local classification evidence cell 全部属于同一个 source unit、已知 unit ID 与该 owner 不冲突、所有 source unit 恰好一一覆盖时，才可按 ID/evidence owner 确定性校准行序或未知 ID；mixed 行必须携带有效的 request-local unit ID。证据归属不唯一、已知 ID 与 owner 冲突、重复覆盖、mixed ID 无效或仍不能完整覆盖时，拒绝整个 annotation。若 unit 混合多种语义，服务最多按字素边界细分六层；仍无法明确分类时整条分析失败并走 unknown-safe，不强制归为旁白。相邻 unit 只在类型和说话人一致时合并。每个最终 segment 仍须有段内 `classification` evidence；tile core 裁切后以及最终响应边界都会再次检查。provider 不承担字符计数、偏移、哈希、源消息索引或传输元数据的计算。对浏览器的 Annotation v1 合同保持不变。实体、属性、身份链接和状态声明继续通过原文 quote/evidence 校验；只允许现有固定 allowlist 内的可选声明按规则局部丢弃。若内部候选把无说话人引用且无 speaker evidence 的对白标为 `dialogue`，服务只将类别规范化为 `unattributed-dialogue`，保留原分类证据；不支持的具名归属只可清除 speaker 归属和 purpose=`speaker` 的 evidence。说话人引用为空但仍带 speaker evidence 属于矛盾核心输出，继续 fail closed。任何非 speaker segment evidence 错误仍整条 fail closed。恢复后仍须通过完整 Annotation v1 validator。未知校验路径、损坏 JSON、未能按证据唯一校准的 unit ID/coverage 问题以及 span/hash 问题一律整条 fail closed，不猜位置。该恢复不改变原文、原版聊天或剧情状态，也不构成剧情生成协议、不改变原版 `Generate()`。

该方案的首期 annotation v1 只实现可见文本分段/说话人/实体和 party roster；其他人物状态不由新协议承担。新分析服务/新投影默认 shadow，除非具备按语言与整剧本留出的验收报告，不得启用自动身份合并、动态头像锁定或 roster 覆盖。服务故障或无效标注时原文仍完整显示，speaker identity 以中性 unknown 呈现；不得退回启发式把陌生对白语义分类为 narration。仅已闭合/完整且无唯一 speaker 的对白可按 v51 在 display layer 使用中性旁白 fallback，不改变 semantic segment 或 identity，也不创建旁白身份/头像绑定。2026-10-06 的普通无标记正文标题例外只允许临时显示“旁白”字样，不把 semantic segment 分类成 narration，也不创建旁白身份/头像；长消息的页级语义分析仍须运行，若有效结果标记为 dialogue/unattributed-dialogue，必须覆盖这个粗标题。Roster snapshot 必须标注 complete 或 partial：仅 complete 可以移除未列成员，partial 只更新明确列出的成员。

## 4. 允许的桥接层

允许添加很薄的桥接层，前提是它只委托原版能力，不建立平行玩法；桥接代码只能位于本项目上层允许目录，不能触碰任何 SillyTavern 原版代码：

- 调用现有 SillyTavern API 获取角色、世界书、设置和聊天；只有存在明确原版运行时入口时，才允许获取由原版完整上下文机制产生的生成结果
- 读取或绑定原版资源引用，但不把资源正文复制进前端 manifest
- 所有已发布剧本默认可尝试聊天绑定世界书标题候选读取：隔离的只读 `SillyTavernSpeakerCandidateAdapter` 以当前玩家聊天快照 `chat_metadata.world_info` 的精确名称读取，不再要求逐剧本配置 Arc 世界书绑定；仍要求当前 release/manifest 的 scenario ID/version 相符和当前聊天目标有效。该头字段不代表角色卡、全局、persona worldbook 来源的完整活动清单。无明确聊天引用时不猜测、空候选继续显示。提取只接受显式角色标题，结果只影响展示标题，不进入身份、头像、队伍、剧情或原版上下文语义。聊天/剧本切换后，迟到响应必须丢弃；原始 JSON 只能在 adapter 方法内处理且不得持久化。完整边界见 `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` 的 `galgame.speaker-candidate-worldbook.v2` 和 V83 TaskSpec。
- V84 跨剧本规则契约：所有已发布剧本默认使用同一 shared structural speaker parser；规则不得按 scenario ID/名称开关。角色名随当前 release/chat/worldbook 候选动态解析并严格隔离，不得把历史剧情人物硬编码为全局名单。生产 parser `full-message-speaker-index.v83` 累积启用至 v78 的全部结构规则，离线 replay 使用相同 parser 版本；题材专用线索只作为条件式辅助，不替代各剧本共同运行的语法规则，也不承诺所有语言/创作者 schema 的识别率。证据优先级及 abstain 不变，标题投影不得改写分页、原文、identity、状态或 SillyTavern 原版。详见 `docs/GALGAME_SPEAKER_ATTRIBUTION_V84_CROSS_SCENARIO_RULE_ACTIVATION_TASKSPEC_2026-10-09.md`。
- 把原版聊天消息转换为 Galgame 可显示的段落、说话人和舞台提示
- 展示层可以过滤原版回复中误露的思考、推理、隐藏注释或代码围栏标记，但不得改写剧情事实、补造对白或把过滤结果写回原版聊天权威
- 把原版角色回复中已经清晰写出的可选行动按钮化；按钮只能作为快捷玩家输入提交回原版聊天，不得成为前端分支、结局或剧情状态
- 把玩家输入提交给原版聊天读写流程；生成流程必须等价委托原版运行机制，不能直调底层模型出口
- 保存必要的前端显示状态，但聊天历史权威仍归原版
- 读档时必须按存档绑定的 scenarioVersion 和 Arc 恢复对应入口；管理员切换默认作品或新增作品不得导致旧存档只能读取当前默认入口。若旧存档中的本地或历史 releaseId 已不再被配置服务识别，玩家端必须按同一 scenarioId、scenarioVersion 和 Arc 换算为当前可验证的稳定游玩 release，且不得改变原聊天、剧本版本或 Arc
- 作为外接模块运行时，不修改、不注入、不覆盖 SillyTavern 后端

桥接层不得：

- 直接调用底层模型接口并自行拼接角色卡、世界书或提示词
- 自建 narrative gateway 来替代 SillyTavern 上下文构造
- 自建 `SceneResult` 剧情协议来决定对白、选项、分支或结局
- 存储角色卡正文、世界书正文、提示词正文、API key 或模型凭据
- 用前端变量、好感度、物品、节点跳转等机制建立平行剧情状态
- 在失败时播放本地固定剧情、固定选项或固定兜底台词

### 4.1 当前桥接审计结论

本轮审计确认，SillyTavern 原版前端的 `Generate()` 负责完整上下文组装、世界书注入、预设应用、扩展事件和失败处理。底层 `/api/backends/*/generate` 接口只接收已经组装好的生成载荷，不是可供 Galgame 前端直接调用的等价运行入口。

在不修改冻结后端、不依赖原版前端全局状态、不复制 `Generate()` 逻辑的当前边界下，允许落地的最小真实路径是：

- 通过 `/api/characters/chats` 读取绑定角色的原版聊天列表。
- 通过 `/api/chats/get` 读取原版聊天消息，并转换成 Galgame 可显示的说话人与文本。
- 通过 `/api/chats/save` 把玩家输入写回原版聊天文件。

若故事入口声明 `chatSeedId`，玩家点击“开始游戏”时必须优先读取该原版聊天种子作为开场内容。种子缺失或为空时，管理员发布/校验应阻止通过；玩家端只能显示恢复状态，不能播放本地固定开场。玩家首次输入时可以把聊天种子复制为新的原版聊天会话后追加输入，不得直接改写种子本体。

该路径只证明“原版聊天读写与自定义舞台展示”可用。2026-07-24 经用户明确批准后，允许新增一个正式外接运行桥：`external-modules/original-runtime-bridge/**`。该桥接服务独立于 SillyTavern 后端运行，通过隔离浏览器进程进入原版 SillyTavern 前端运行时，选择绑定的原版角色与聊天，并调用原版运行时自己的生成函数完成续写。玩家页不得 iframe 或嵌入原版 UI，只能通过桥接 HTTP 契约提交原版角色头像与聊天 ID，并展示桥接服务返回的原版聊天结果。

桥接服务必须证明原版运行时实际绑定到了玩家提交的目标聊天：生成前读取目标聊天并确认最后一条是玩家输入，打开原版聊天后等待角色、聊天 ID 和最后一条消息稳定匹配；生成期间保持目标聊天绑定；生成后重新读取目标聊天文件，只有目标文件新增原版角色回复时才算成功。玩家端通过 `/api/chats/save` 从原版运行页面之外写入玩家输入后，即使隐藏的原版运行页面已经停留在同一个聊天 ID，桥接服务也必须重新加载或同步该目标聊天，直到原版运行时内存里的消息数量和最后一条玩家输入与目标聊天文件一致，之后才允许调用 `Generate()`。原版模型上游返回 429/500/502/503/504 或网络瞬时错误时，桥接层可以在同一个已授权请求内做有限次数自动重试；重试成功仍必须以同一目标聊天文件新增角色回复为准。若回复落到其他聊天、当前聊天 ID 漂移、原版运行时仍停在旧聊天内存、授权/绑定失败或目标读回不确定，桥接必须失败并让玩家端显示重试/恢复状态，不得把返回字段改名伪装成成功。

该批准不恢复旧的 narrative gateway，也不允许自定义层复刻 `Generate()`、直调底层模型出口、自拼角色卡/世界书/预设/提示词、解析剧情协议、注入固定台词、创建固定选项或维护平行剧情状态。桥接服务只是一个显式的原版运行时委托面；若它不可用，玩家端必须保留当前舞台和输入，显示重试/恢复状态。

本地共享部署中，玩家端可以在没有显式配置运行桥地址时自动探测同机 loopback 上的已批准 `original-runtime-bridge` 健康实例。该自动探测只用于找到桥服务地址，不构成授权；每次续写仍必须从配置服务取得短期 `galgame.original-runtime-bridge-proof.v1`，并由运行桥校验 release、Arc、目标角色和目标聊天绑定。配置服务和运行桥必须使用同一份本地证明密钥，且都指向同一个 SillyTavern 原版地址，否则玩家端只能显示重试/恢复状态。

玩家端处于“再试一次”或准备请求运行桥前，必须先重新读取当前绑定的原版聊天文件。若原版聊天已经新增角色回复，玩家端应直接同步并显示该回复，更新自动进度，不得继续拿旧的玩家末尾快照重复请求运行桥。

配置服务签发运行桥证明时，允许玩家端对原版聊天读回短暂不同步、配置服务瞬时失败或网络抖动做同一操作内的有限短重试。重试仍必须使用同一目标聊天文件和正式证明校验；不得变成持续重连循环，不得在失败时播放本地剧情。

### 4.2 运行链路连接状态

玩家端必须持续知道运行链路是否可用，不能只在点击生成时做一次端口探测。共享层使用版本化的 `galgame.connection-health.v1` 状态快照：每 10 秒探测 SillyTavern、配置服务、原生运行桥和视觉服务，单次探测超时为 5 秒；浏览器 `online/offline` 变化和生成结束后立即补探测。快照记录每项服务的状态、延迟、连续成功/失败次数、最近错误码和数据是否过期，并单独记录最近一次生成的 `pending/up/down` 结果。

原生运行桥 `/health` 的 `ready` 与 `connectionState` 是生成前的判定依据。桥接进程可达不等于可生成：`generating`、`stale`、`stopping` 或 `ready:false` 必须阻止新的生成请求，并保留当前舞台与输入。桥接对长时间未结束的 pending 任务标记为 stale；停止后的桥接进程必须重启后才能恢复。健康状态只返回非敏感诊断字段，不得包含 token、聊天正文或模型凭据。

桥接执行期间若 CDP 页面评估超时，桥必须结束本次失败请求并终止自己的隔离 Chrome 子进程；只有确认子进程退出且当前请求已清理后，才可恢复为 idle 以便玩家显式重试。未确认退出时必须保持 `stopping` 并拒绝新生成。超时结果不能被改写成成功，也不能自动再次调用 `Generate()`；重试前仍须重新读取精确目标聊天，若原版回复已经写入则直接同步该回复。

玩家界面以非技术化文字显示整体连接、各服务和当前生成状态；连接异常只提供重试/恢复，不得播放本地固定剧情。配置服务玩家探测使用公开 `/v1/health`，管理员健康接口只用于管理端。

玩家端必须提供一个“复位”操作。当连接状态异常或上一次生成失败标记残留时，玩家可点击该操作；前端应中止过期的健康探测、使过期视觉请求失效、清除瞬时健康快照并立即重新探测 SillyTavern、配置服务、原生运行桥和视觉服务。若 SillyTavern 与配置服务恢复可用，复位还应重新读取当前已绑定的聊天或其原版本存档内容；此读取仅恢复展示，不自动发起新的模型生成。复位不得删除聊天、覆盖存档、切换正在游玩的故事或伪造生成成功；若运行桥仍在生成、停止或不可达，复位后必须继续显示可恢复异常。

本机 Windows 部署可由独立 loopback 进程管理器补充复位能力：它检查 SillyTavern、配置服务、原生运行桥和视觉服务的固定端口；只有端口未监听时才启动对应的白名单启动入口，并等待服务健康状态回升。若端口仍有进程但健康接口异常，不得盲目终止进程，以免打断生成或损伤原版运行态；应保留该进程并呈现未恢复状态。唯一窄例外是运行桥健康状态明确同时报告 `pending + stale` 且不在 `stopping`：这代表已超时挂起的请求，符合运行桥重启策略，可通过现有固定启动器重启；普通 `pending` 生成绝不能重启。该管理器只能绑定 loopback、接受当前本地玩家来源的固定协议，不接受浏览器提供的任意命令、PID 或路径；它是独立可移除模块，不能改写 SillyTavern 后端或启动行为。Windows 登录启动任务应由独立脚本可重复安装和卸载，使用当前用户受限交互权限，并允许电池供电运行。若管理器不可达，复位仍执行既有健康探测和只读聊天恢复。

玩家首页在“一键复位”旁提供“一键关闭”，文案说明它关闭游戏服务和当前网页，本机恢复控制器继续后台待命。它只向 loopback process-supervisor 提交固定版本协议，不传入 PID、路径、命令或端口；服务端仅通过当前仓库下预先登记的精确启动入口路径识别并关闭 SillyTavern、配置、运行桥、视觉、分析服务，以及带专用 original-runtime-bridge Chrome `user-data-dir` 的浏览器进程。process-supervisor（8790）必须保留运行，供之后的一键复位重新拉起服务。SillyTavern 若以相对 `server.js` 启动，仅接受参数严格为 `server.js`（可带与进程 ExecutablePath 完全相同的 Node 可执行路径），且直接父进程已退出的孤儿进程；服务端须以只读 Windows 进程查询读取目标进程真实 CurrentDirectory，只有规范化结果与仓库根目录完全一致才可列入关闭白名单。父进程仍存活且不是精确登记的项目启动器、CWD 查询/权限/架构校验失败或路径无法规范化时，必须报告 `failed/ambiguous`，绝不能当作“已停止”或终止该进程。不得按端口占用或模糊命令行扩大匹配范围。关闭前运行桥健康状态必须可确认且同时满足 `pending=false`、`stale=false`、`stopping=false`；随后通过运行桥 shutdown lease 阻止新生成和竞争性停止操作。监督器执行期间每 15 秒使用同一 owner `gateId` 续租 60 秒 gate；只有当前有效 owner 可以续租。续租失败时须中止并等待关闭执行器退出、保留单飞状态并 fail closed，不得继续非协调关闭或释放已无法确认所有权的 gate。若检查不可达或状态含糊，返回冲突并保留所有进程。服务端先回送关闭已受理及逐服务待关闭状态，再异步执行白名单回收；客户端必须轮询最终 receipt，只有确认完整的七项服务状态均有效且所有游戏服务停止，才请求关闭当前窗口。receipt 保留进行中的操作，并将已完成的最近 32 条保留 5 分钟；运行桥 gate 在 60 秒后惰性过期，避免监督器异常退出导致生成永久阻塞。查询失败、未知状态、超时或部分失败时页面保留并提示失败。不承诺可撤销。若浏览器阻止关闭，当前标签替换为简洁“已关闭”页面，不尝试关闭其他标签或浏览器。所有本项目启动器（包括根 `Start.bat`）均须在启动后隐藏控制台并尽快退出；保留其原有环境变量、npm 参数、启动参数和日志重定向。不得使用持续存在的 `start /min cmd /c` 控制台。

## 5. 管理员端边界

管理员端 `/game-admin/` 负责：

- 保存多个 Galgame 入口，选择默认推荐入口，并上架可供玩家选择的作品
- 记录入口绑定的原版角色、世界书、预设和上下文配置引用
- 调用原版接口检查引用是否存在
- 缺失引用时阻止发布并展示缺失项
- 提供媒体接口配置和健康检查

管理员端可以帮助运营者管理 Galgame 入口，但不得复制或替代 SillyTavern 原版资源管理器。

## 6. 外接模块原则

外接模块只允许解决原版之外的边缘需求：

- 共享发布索引
- 静态入口配置
- 未来媒体任务排队、回调和缓存
- 访问控制或反向代理
- 必要时的原版运行时桥接

外接模块必须独立运行，不修改 SillyTavern 后端，不替代原版上下文/生成语义。

## 7. 当前纠偏要求

本次纠偏必须完成：

- 撤销“玩家只能跳原版 UI”的错误规则。
- 玩家端开始/继续/读取不再默认直接跳转原版 UI。
- 恢复 `/game/` 作为自定义 Galgame 玩家主界面的原则。
- 保留测试角色卡 `Galgame_Test_Aoi` 和世界书 `Galgame_Test_RainTown` 的原版资源绑定。
- 保留管理员只读资源校验。
- 不恢复旧的自建剧情网关、固定剧情、`NarrativeRuntime` 或 `SceneResult`。
- 不修改 `src/**`、`server.js`、`plugins.js`、`config.yaml`、根依赖或原版 `public/index.html`、`public/script.js`、`public/style.css`。

## 8. 后续开发方向

后续开发重点应放在：

- 自定义 Galgame 玩家 UI 的舞台、对话框、输入、历史和媒体展示
- 一个薄的 SillyTavern 运行时桥接层，尽量复用原版聊天和生成机制
- 管理员端原版资源引用校验和入口发布
- 生图/视频接口，但只作为媒体模块，不作为剧情模块

验收标准不是“能跳到原版酒馆”，而是“玩家在自定义 Galgame UI 中游玩，同时底层语义仍由原版 SillyTavern 提供”。


## 2026-10-03 稳定性与 HUD 明细补充
按 `GALGAME_STABILITY_AND_HUD_DEVELOPMENT_2026-10-03.md` 执行，仍遵守 native-first。
装备、道具、技能展示复用现有明确字段解析器；装备与背包字段分别解析，不把盔甲重复列为消耗品。
普通对白没有新字段时，可显示当前可见聊天分支中最近一条明确记录，必须标为“最近记录”并在详情注明来源消息与“非实时状态”。
这不是库存快照合并、消耗计算或持续状态引擎；每次从当前快照重算，不读取未来消息，不跨聊天继承，不持久化物品权威。
已识别字段值精确为“无”“空”“none”“empty”或“[]”时，显示明确空记录并替换旧记录；未完成的字段标题不等于清空。自然叙述不由新增规则推断库存变化。
图片只增强显示：无图仍显示原文物品明细，明确空记录不能被图片匹配重新填充。非法 URL 决策仍须拒绝，独立有效的显式人物绑定按现有规则保留。
编辑、swipe、删除、分支和读档后重新计算派生记录；所有原版文本、存档、模型与 catalog 配置保持不变。
测试必须等待本次视觉渲染 Promise 完成，不能以历史请求存在或固定 sleep 认定成功。独立审计与真实端到端验收单独记载。


### 携带武器的保真补充
装备字段与背包字段已分开提取，因此不再隐藏背包记录中的 weapons 分组。背包明确列出的剑、弓等仍按原分组展示，不能当作消耗品，也不能据此推断已经装备。历史来源和明确空状态规则不变。

## 2026-10-04 场景视觉恢复的窄范围例外

用户明确要求恢复 `/game/` 中失效的视觉匹配。本条仅为展示层 scene-continuity producer 建立例外，详细合同见 `docs/GALGAME_VISUAL_PAGE_CONTINUITY_RESTORE_2026-10-04.md`。播放器只通过视觉资源服务 8798 的固定 `/v1/presentation/*` 浏览器代理访问可见页分析；8798 仅把闭集路由转发到 loopback 分析服务 8801。正常前台分析只使用当前可见页和最多两个先前可见页作为消歧上下文；仅当该页同时带 high-confidence `current-location` 与 `transition-action` exact spans，且哈希、scope、Unicode spans 全部通过，才产生现有 `scene-continuity.v1=changed` 并允许 8798 选择背景。冷启动若本聊天没有可验证账本，播放器先处理当前页，再在后台只读扫描同 scope 时间线中最多 128 个较早角色可见历史候选；不超过 4000 code point 的较早完整消息可作为一个候选整体分析，超限时按原版显示页扫描；当前回复只扫描当前 cursor 之前的页。每批最多 12 个候选，请求至少间隔 2.1 秒，不使用会早于候选窗口所需时间的整轮硬超时。每条候选完成后可写只含 scope/cursor/candidate/analyzer 摘要哈希与扫描偏移的可丢弃检查点；每次恢复都必须重新校验摘要与同一可见聊天/cursor，失败候选在后续冷启动从最近失败位置重试，聊天或可见页变化立即取消运行。找到最近有效 `changed` 锚点后，在确认当前可见 cursor 未变化时重新投影该页。历史分析会将候选消息/页正文及最多两个更早角色页正文发送到已配置的Claude 文本分析 provider（凭据来自独立的本地语义分析配置，且与剧情生成密钥和视觉密钥分离）；不得发送 API key、chat id 或本地路径。player/system、当前页之后的消息以及窗口外消息都不作为候选。它不调用剧情 `Generate()`，不修改聊天/存档，只写可丢弃且来源 hash 校验的连续性账本及无正文检查点；没有找到有效锚点时仍显示作品默认背景。8801 不直接暴露给浏览器；8798 的“视觉”健康状态必须同时确认活动 catalog 与分析器健康，避免仅有资产服务在线时误报整条视觉链路正常。
场景分析任务绑定完整的当前页 cursor。玩家翻页、回看或切换聊天时，新的可见页立即取得分析优先级；非完全相同 cursor 的未完成请求被取消，不能让当前页排队等待较早页面。浏览器取消会经 8798 代理传递到 8801 上游请求以释放并发槽位；迟到结果仍须通过当前 scope、timeline 和 request-token 校验后才可应用。完全相同的当前页请求可以复用同一个在途任务。

场景分析仅允许处理原版角色可见回复；按原版消息标志 `is_system===true`→system、否则 `is_user===true`→player、仅原版 assistant/character→character 归一，无法确认来源时不创建请求。player/system 消息必须在播放器跳过，并由 8801 对非 character 来源 fail closed，不得调用 provider 或消费投影；防御性响应固定为 low confidence、空地点/转场/引用/标签，并由服务端回填请求 ID 与页面哈希。闭集 `visualTags` 的 exact spans 必须完全位于 `currentLocation` span 内，无当前地点时标签列表必须为空，避免把当前页旁提地点当作背景标签。8801 在 provider 边界会先按原始数组校验 `visualTags` 的 `maxItems`，超限结果必须 fail closed；只有原始数组不超限时，才丢弃结构完整但证据不在当前地点跨度内的可选标签，不挪动或扩写其跨度。地点、转场、hash、scope 和剩余标签仍按原严格 schema 校验，未知标签或畸形字段仍 fail closed。这样可避免一个无法绑定的可选环境词令整条有效地点/转场结果失败。玩家行动意图不作为转场已经发生的证据。

这是按用户要求对 scene presentation 做的限域生产启用，不是一般 annotation v1 的语言/整剧本 gate 通过证明；不能宣称任意地点、语言或题材都能识别。一般 speaker/身份合并、动态头像锁定和 roster 仍默认 shadow，遵循原整剧本 gate。场景分析器不返回 assetId，不写回 SillyTavern chat/save/manifest/binding，不决定剧情。地点提及、计划、回忆、分析失败、低置信度、证据缺失及响应竞态一律 unknown-safe：同 scope 保留已验证背景；scope 改变按规则立即回到新 release 默认背景。

该例外禁止扩大为添加题材专属地点/动作 regex。原自然语言地点正则不得充当生产场景 producer；闭集可视标签仅用于现有 scene candidate matcher，最终资源仍由已发布 catalog 唯一决定。此补充不改变 SillyTavern source freeze、identity/roster gate、原版运行语义或已有视觉 asset/catalog 指针。

## 2026-10-04 浏览器视觉分析代理补充

玩家页不直接请求 `127.0.0.1:8801`。视觉资产服务 8798 提供固定的 `GET /v1/presentation/health`、`POST /v1/presentation/annotations` 和 `POST /v1/presentation/scene-continuity` 代理；只接受已登记玩家 Origin 与各自固定版本头，只能转发至 loopback 8801 的对应固定路径。请求取消、尺寸限制、超时、无密钥转发和 closed response 由代理强制执行，不能接收客户端 URL、host、路径、认证头或 Cookie。8801 仍是独立分析实现和视觉凭证持有方，不对浏览器开放。

连接状态中的单一“视觉”项目表示完整链路可用：8798 的 catalog 必须 `enabled=true`，包含完整活动 catalog 与 visualProfile，且二者的 catalogId/revision/hash 一致；固定分析代理还必须确认 8801 已启动，并返回 presentation 与 scene-continuity 两个分析范围。HTTP 200、空 catalog 或已关闭 catalog 不代表可用；任一部分未就绪都必须呈现为异常。该呈现健康检查不调用外部模型，不读取对话正文，也不暴露凭证。视觉只读健康 GET 遇到网络 TypeError 或 502/503/504 时最多做一次短重试，并有界超时；一次瞬时抖动不得立刻把可恢复链路判成持续故障。视觉状态从断开恢复后，播放器只重算当前可见页的视觉投影，不生成剧情、不改变聊天。LLM 未按需探测时显示“待按需检测”，不计入总连接异常。

8798 的 `POST /v1/presentation/annotations` 与 `POST /v1/presentation/scene-continuity` 是固定上游代理调用，本身不写入 8798 的 catalog/control store，必须走共享只读调度通道。上游分析可能较慢；不得让它占用 8798 的独占写队列并阻塞 `/v1/core/visual-context`、健康探测或已验证素材读取。只有真正修改本地持久状态的路由才使用独占写通道。

## 2026-10-05 玩家输入页的已验证背景恢复

player/system 页仍禁止调用场景分析器、读取该页场景声明或把玩家行动意图当成转场证据。若刷新或复位时当前页是 player/system，播放器可以先校验连续性账本；账本缺失时，可在后台按上段的有界冷启动流程，从同 scope 更早的角色可见页恢复最近一条经同一严格合同验证的场景锚点。该扫描不得阻塞当前页显示，单页失败继续回看，并在找到锚点后仅当原可见 cursor 仍匹配时重新投影。当前 player/system 正文不参与场景分析。缓存缺失、窗口/时间预算耗尽或校验失败时使用当前作品默认背景。该恢复不得修改 SillyTavern chat、存档或场景语义；被扫描的历史角色正文会发送到已配置的Claude 文本分析 provider（凭据来自独立的本地语义分析配置，且与剧情生成密钥和视觉密钥分离）。

## 2026-10-05 用户指定的中文语义呈现试运行

按用户明确要求，当前发布语言 `zh-CN` 启用 annotation v1 的 `assisted` 呈现路径，使通过现有 source span、哈希、身份引用与时间线校验的语义结果可以驱动角色/旁白/动作/状态/选项等玩家显示及其只读身份投影。该启用是无人工 gold 的试运行，不代表既定整剧本 gate 已通过；`PRESENTATION_GATE_REPORTS` 继续为空，其他语言仍由已验证 gate 控制。缺失、超时、无效、过期或无法归属的注释必须在语义/身份层降级为 unknown；已闭合/完整且无唯一 speaker 的对白仅按 v51 在显示标题/context 使用中性旁白 fallback，不冒充 narration annotation、已知角色、人物头像绑定或剧情状态。该试运行不写 SillyTavern 聊天/存档，也不改变原版剧情语义；分类准确率仍须由历史金标准回测报告单独证明。

普通与切片候选的每个段均须提供段内 `classification` evidence；切片被裁到 core 并合并后，最终 Annotation v1 每个段仍须保留至少一条完全位于该段内的分类证据。lookaround 中被裁掉的证据不能支持最终显示标签；任何缺失都使整条分析失败并降级为“未识别”，不得回退为 narration。

当前展示分析器 prompt scope 为 `presentation-annotator.v26`；普通与分块请求统一使用不透明 source-unit/evidence-cell ID。服务按 Unicode code point 记录 ID 的精确范围；分块 core 与 tile 边界均对齐 source unit，并只接受 core-owned unit 的分类结果。单条目标消息必须映射到恰好一个结果项，该项覆盖所有 owned units；服务仅在普通分类行的 evidence-cell IDs 唯一映射到各自 request-local source unit、已知 unit ID 与证据 owner 不冲突且全部单元一一覆盖时，才按 ID/evidence owner 确定性恢复行序或未知 ID。mixed 单元没有分类证据格，只接受有效 unit ID。模型不直接提供数值偏移、文本锚点或逐字符 marker；服务端校验连续覆盖、证据归属、哈希和完整 Annotation v1。混合单位最多作六层 grapheme-safe 二分；超限、超时、预算耗尽或仍无法分类时整条 fail closed。混合单位只作为细分控制值，其临时证据/说话人声明在细分前丢弃；最终子单位仍须各自满足完整证据和覆盖校验。说话人缺失时按 v1 合同将对白规范化为未归属对白；矛盾说话人证据仍拒绝。该内部候选协议不改变公开 Annotation v1 DTO，也不修改 SillyTavern。

2026-10-05 analyzer 的受限恢复只接受结构完整、request-local ID 到 source span/hash 映射无误、覆盖无缺口，且错误路径命中服务端固定 allowlist 的候选。恢复只移除无效可选属性/身份/状态项；无 speaker 引用且无 speaker evidence 的 `dialogue` 只规范化为 `unattributed-dialogue`，保留分类证据；具名归属错误可以清除说话人归属并删除 purpose=`speaker` 的 evidence。speaker 引用缺失但仍给出 speaker evidence 属于矛盾输出，继续 fail closed。classification 或其他非 speaker evidence 错误仍整条 fail closed。它不推断、补写或把未知对白标为旁白。所有恢复候选都要重新通过 Annotation v1 完整校验；结构错误、未知错误路径或恢复后仍无效时，整条仍按 unknown-safe 处理。此逻辑只作用于内部分析候选，不改变公开 Annotation v1 schema。

为控制用量与避免不可复现的同批 peer 上下文，语义试运行每次只对当前活动显示 cursor 的一条非空 assistant 消息发起 singleton 分析，不做历史批量回填，也不读取 cursor 之后的消息。当前 Annotation v1 完整校验通过，且精确绑定当前 chat/scenarioId/version/release/arc、消息索引、原文与哈希、cursor/prefix、analyzer scope、context digest、发布 known-entities fingerprint 与 singleton provenance 时，可以立即显示注释 speaker mention 对应的原文标签，即使全局身份 projection 不完整。该标签只表达当前消息证据：身份保持 `unknown`，不得触发头像匹配或唯一头像绑定；roster/projection 继续标记 incomplete。历史行仅在玩家回看并使其成为活动 target 后才单独分析，未访问的历史行可以继续 unknown；多目标 batch 注释不提升 projection、不覆盖 singleton memo。缓存命中必须针对当前单条原文和 known entities 重新通过 Annotation v1 validator；旧 batch cache 使用旧 namespace，保留但不会作为 singleton 命中。当前注释缺失、scope/known-entities fingerprint、源内容/cursor/prefix 不匹配或证据跨度无效时仍保留 unknown-safe。所有时序及缓存变化都只发生于上层派生内存/缓存，不写原版聊天。

长回复分页时，页面范围必须严格复用播放器在无可用完整注释时生成的 source-only base pages，语义分析不得改变页数、正文、顺序或 sourceSpan。仅当整条可见消息超过 6000 Unicode code points 或 base pages 多于 8 页时，当前活动页才使用现有 Annotation v1 endpoint 做单页窗口分析：viewText 由当前页 core 与同一消息紧邻的上一 base page lookbehind 组成，不携带其他聊天正文，也不预取未访问页；窗口超过单条请求上限则保持“未识别”。响应须针对准确 viewText 完整通过 Annotation v1 校验。页标题归纳检查所有与 core 相交的分类段，每段都必须有完全落在 core 内的分类证据；若唯一明确人物 speaker 的对话段均有经验证的 speaker ref/evidence，标题显示该人物原文名；若有多个明确人物则显示“多人对话”；同类纯旁白、动作、状态、选项或正文段可使用现有分类标签。混合段分类证据不足、speaker 证据不完整、span 映射失败或其他不确定情形的 semantic type/identity 仍为 unknown；已闭合/完整且无唯一 speaker 的对白仅在 display title 按 v51 使用中性旁白 fallback，未闭合引语仍显示“未识别”。lookbehind 仅可为当前页对话提供同一消息内的人物 mention 证据，不能只凭引号或前页标题继承。此 label-only overlay 可补 source-only unknown base page，或补当前 sourceSpan 完全相等且 identityRef=unknown 的投影页标题；即使完整段数组存在，只要当前页标题缺失/unknown 或仅有 plain-prose-narration 粗标题，也允许当前页语义证据补充/覆盖。已有完整且对当前页有效的语义标题、明确结构说话人标题仍保持权威。任何情况下都不改变正文、页数、span、segment type、identityRef、头像、身份/roster projection 或完成状态。缓存使用独立 page-window v1 namespace 并绑定完整消息、core/view spans 与哈希、timeline prefix、scope、context digest、known-entities 指纹和 analyzer scope；命中后按准确 view request 重新校验。翻页、编辑、swipe、换聊天或时间线变化会取消请求或拒绝迟到结果；历史页仅在成为当前页后分析。页窗口分析与 singleton projection 共用当前消息分析 run 和页光标，不由 render/翻页启动并行 page-only controller；短消息仍保留最多四条前序 character context。

## 2026-10-06 结构化说话人标题与历史回测补充（最新）

规则边界补充：当前显示页中，唯一开放至页尾的引语可由同页直接署名标出当前页标题；这只初始化该页的说话人。后续页必须通过同消息的相邻 source span、完整原文 hash 和引号状态检查，不能只继承标题。

按 `docs/GALGAME_STRUCTURAL_SPEAKER_TITLE_BACKTEST_DEVELOPMENT_SPEC_2026-10-06.md` 扩展结构标题路径。该规则只解析当前显示页中有明确原文归属证据的角色标题；直接署名、引号归属、同页多人和经校验的跨页未闭合引号都可作为结构形式。它不把固定句式提升为通用语义分类，不分类/改写原文段落，也不创建 speaker identity、头像、roster 或剧情状态。无法区分标题、状态文字和对白时仍显示“未识别”。本补充取代同日早期 Demo 对结构模式数量的限制；Native-first 其余 source freeze、Annotation v1 校验、unknown-safe 和分页契约继续生效。历史结构回放必须零 provider 调用、聊天只读，并将规则覆盖统计与人工 gold 准确率分开；没有 gold 时不得宣称准确率通过。

## 2026-10-06 正文分页恢复与语义隔离

正文播放恢复到 GitHub 语义接入前的旧路径（`34277b809506a9b4dc24901f5a40b56bb4405dc1`）：`createVisualNovelDisplaySegments()` 返回的可见 segment 数组直接作为逐页播放数组，不再经过按身份合并页面的 `createPresentationPages()`。正文 formatter、可见 segmenter 与其边界是正文排版的唯一来源；不得因语义结果是否就绪、分类类型、speaker identity 或头像身份改变正文段数、顺序、文字、类型或 source span。语义与结构标题只允许在正文页数组形成后作为 display-only 附加元数据，为精确匹配的现有 source span 提供标题/视觉投影；不得写回正文页字段或触发重新分页。本条优先于本规范中将 `createPresentationPagesForMessage()` 泛称为“source-only base pages”的旧表述。

## 2026-10-06 结构标题规则 v7 补充

结构标题继续是分页之后的独立展示 metadata。唯一已发布人物在同一引语归属子句中且该子句以直接说话 cue 收束时，可显示该人物原文名；多个候选人物保持 unknown。普通叙述 fallback 排除有明确引号的内容、成对单引号对白、独立标题和多行键值状态块；英文所有格撇号本身不算对白引号。此处不得更改 source segmenter、formatter、page array、正文文本、页序或 source span，也不得把结构标题写回 semantic segment、identityRef、roster 或剧情状态。详细规则和回测边界见 `docs/GALGAME_STRUCTURAL_SPEAKER_TITLE_BACKTEST_DEVELOPMENT_SPEC_2026-10-06.md`；当前历史准确率仍未通过 gold/holdout gate。

## 2026-10-07 完整消息结构证据投影补充

按 `docs/GALGAME_FULL_MESSAGE_SPEAKER_EVIDENCE_PROJECTION_DEVELOPMENT_SPEC_2026-10-07.md`，播放器上层结构标题扫描器可以读取**同一条原版角色可见消息的完整规范化原文**，以定位直接署名以及它实际管辖的对白范围。完整消息只扩大证据搜索范围，不扩大标题归属范围：每页必须按原分页器已有的精确 `sourceSpan` 单独投影；页面证据须绑定同一消息 index/full hash，speaker 名称 span 必须切出完全相同的原文，分类 span 必须落在当前页 core 内。

当明确署名的同一对白跨过已有页面边界时，后续页面只有在完整消息解析器证明当前 core 与该已署名对白范围相交、且没有未归属/冲突对白介入时才可以显示该说话人。页面相邻、前页标题、同名提及、消息作者和语气相似均不能单独构成归属。结构 evidence 的 provenance `viewSpan` 是包含当前 core 与姓名锚点的展示来源包络，可能向前或向后延伸；它不等于语义分析的请求窗口，禁止传入 prompt、扩大 Annotation view window 或复用为跨消息/跨 chat 上下文。语义分页窗口仍严格使用现有相邻前页 lookbehind 与当前 core。

若同页任一可检测对白无法归属、署名冲突或范围不可精确解析，该页继续“未识别”；多个有直接归属的说话人显示“多人对话”。未检测到对白时只沿用既有 plain-prose fallback。结构标题仍为同步、本地、零 provider 的 display-only metadata：不改变正文 formatter、segmenter、页数/顺序/text/type/sourceSpan，不修改聊天/存档，不建立或更改 identity、头像绑定、roster、状态或剧情。2026-10-06 条款中“当前页局部解析/仅依赖相邻页续接”自本补充起仅作旧实现背景；生产标题必须使用本节定义的同消息全量扫描与精确页跨度投影。

本节明确取代本规范开头的 2026-10-06 标题补充、2026-10-06 v7 中把归属范围限制为当前页/单一引语子句的旧限制，以及本文其他仅允许页内扫描或相邻页续接的历史文字。直接署名必须由姓名与说话 cue 直接构成；单纯提及角色名、姓名后接动作/地点/关系叙述再出现对白，均不足以归属。前后署名冲突仍显示“未识别”；语义 `unattributed-dialogue` 保持 unknown semantic type/identity，但其显示标题遵循下方 2026-10-07 覆盖面补充。该标题规则不得影响正文分页、语义协议、identity、头像、roster 或剧情状态。

### 2026-10-07 结构识别覆盖面与语义标题补充

实现回放发现两处过度拒绝：所有引号短语都被当成对白，使行内书名/物品名引号否决同页已归属对白；姓名与直接说话 cue 之间依赖固定语气词清单，使常见的“姓名 + 短语气/括号语境 + 说/问”变体漏识别。解析器 v2 只把有直接说话 cue、明确 speaker label，或独立成行的引号视为对白证据；嵌在普通叙述句中的引用短语不单独构成未归属对白。姓名和 cue 之间允许有限、语法形态可识别的短修饰（短汉语“地/着”结构、英语 `-ly` 副词或单层括号语境），不建立词汇表；完整叙述子句仍不通过。该边界是语法约束，不以剧情主题或动作词表推断。

对于未发布的 Latin 人名，行首 `Name: “quoted speech”` 可作为明确 speaker label；无引号的未知 colon heading 不升级为角色。已发布角色名仍可匹配既有 `Name: dialogue` 形式。此限制降低 `Strategy: ...` 一类正文标题被误判为人的风险。

语义 `unattributed-dialogue` 仍是当前页语义类型，仍令 identity/visual context 保持 unknown；但它不能单独否决同一消息解析器给出的完整、无冲突、覆盖全部可检测对白范围的结构 speaker/group 标题。此时只补标题文案，语义类型、正文、身份、头像和队伍保持原样。若结构投影存在署名冲突、证据不完整或缓存无法通过当前原文/hash/span 校验，标题继续“未识别”。同页的旁白或另一条未归属引语不会抹掉页面中明确署名的角色对白；未归属引语自身仍不归给该角色，也不产生身份/视觉证据。出现两个明确冲突说话人时仍不强行选一个。本补充取代“语义 unattributed 一律阻止结构标题”和“同页存在未归属对白时一律不以已知姓名覆盖整页”的旧句。

### 2026-10-07 页面形态与说话人归属分离

按 `docs/GALGAME_SPEAKER_CANDIDATE_SHAPE_AND_REPLAY_DEVELOPMENT_SPEC_2026-10-07.md`，标题层先分出对白、未归属对白、结构化记录、独立标题、普通叙述与歧义页，再尝试解析 speaker。结构化字段/数值/列表行或独立标题不得仅因冒号左边碰到发布角色名，或旧 segmenter 给出 `dialogue` type，而生成 speaker evidence；明确原文中的对白引语/直接说话 cue 优先于版式判断。结构记录与标题只允许附加经过当前原文/hash/span 校验的 display-only classification title，不创建身份/头像/roster，不改变语义 annotation 或底层 segment type。

无发布角色 roster 时，`Name: “quote”` 与 `Status: “Healthy”` 这类同形冒号引语不得凭表面格式确认人物；只有直接说话 cue、已发布 roster 精确姓名或独立署名结构才能产生人物标题。此取舍可能暂时把采用 `Name: “...”` 单一格式的新人物留在“未识别”，不可用任意名字/词表补猜。回放候选分母固定只包含可寻址 `dialogue-candidate` 页（已归属与未归属均计入）；普通叙述、结构记录、独立标题、模糊形态、source 不可寻址和 scope 不可用须分列，不得记作 speaker miss。

历史回放须把 page kind 与 title evidence 分开报告；统计、标题、旁白及 source 不可寻址页不计作 speaker miss。无逐 chat speaker scope 或 gold holdout 时，只能报告候选覆盖和规则命中，准确率保持 `INSUFFICIENT_EVIDENCE`。完整消息索引仍是续接唯一依据；跨页/跨消息相邻关系不能单独继承 speaker。

当 full-message index 的已定位对白 span 与既有页面 core 相交时，即使 core 自身没有重复的引号/说话 cue，该页仍是对白候选；候选由原文完整消息跨度提供，而不是相邻关系推断。

以上均发生在原版生产 formatter/segmenter 已生成页面之后。本条不授权更改 `formatVisualNovelDisplayText()`、`createVisualNovelDisplaySegments()`、页面数量/顺序/内容/span，亦不授权修改 SillyTavern 源码、聊天、语义服务或剧情状态。

标题结构识别继续保守：未发布的 2–4 字汉字候选名不能只靠单字 `说/问/答/喊/骂/道` 建立归属；精确匹配已发布角色名时这些 cue 可用，未发布汉字名需要更明确的多字 cue 或独立署名。Latin 词内 U+2019 作为撇号；其他文字系统按闭合符保守解析；真正的 `‘…’` 引号必须按成对状态闭合，即使闭合后紧接中文叙述。以上仅是标题 evidence 规则，不得更改正文格式或分页。

### 2026-10-07 既有 segmenter probable 说话人提示（v6 窄增量）

下一阶段只允许把原版可见消息经现有生产 segmenter 已产生的局部提示用于一个**展示层推测标题**：当前生产页必须同时满足 `type=dialogue`、`speakerConfidence=inferred`、`confidenceBand=probable`、`speakerOrigin=runtime-text`；该提示必须来自既有 `parseNarrativeDialogueParagraph` 的 name + action + quote 识别。不得扩大或改写该识别器，不得用额外规则另找候选。标题需明确追加“（推测）”，不能看起来像已确认说话人。

推测标题必须从当前 page core 的精确 `sourceText` 和同一个 anchored parse 直接导出 name、action、quote 的 Unicode code-point spans，包括 connector、引号、trim 规范化后的 offset 映射；用 production `sourceSpan` 转为完整消息 offsets 后，验证每个 `chars.slice(start,end)` 与原文片段相等、span 有序且全在该 core 内，并绑定完整消息 hash、source message index 与 core。其他消息页出现相同 literal 不造成歧义，不得依赖完整消息 `indexOf` 后取第一个匹配。若 anchored parse 无法证明 local offset、offset 与原文不符、消息 hash/core 不匹配或 evidence span 越界，拒绝推测标题并保留现有安全标题。当前有效语义标题、现有 explicit structural evidence 及结构记录/独立标题结果优先。

它仅可作为分页后独立 display-only title sidecar；不得写入/修改原 production segment，也不得改变 semantic label、identityRef、头像查找、avatar reservation、roster、状态或剧情。不得跨 assistant 消息、跨页传播该推测；唯一例外是既有 v5 同消息开放引语续接合同，且该合同自身继续适用。不得利用 cue-witness 扫描邻近消息、原版 `message.name`、最近说话人、重复标签频次、裸 `Name: “quote”` 或其他猜测替代四字段准入；既有 explicit title 只有在自身证据独立有效时才保留优先级，v6 不从裸冒号引语新建或升级该证据。详细实现边界、回放分桶和验收见 `docs/GALGAME_SPEAKER_CANDIDATE_SHAPE_AND_REPLAY_DEVELOPMENT_SPEC_2026-10-07.md` 的 v6 增补。

v6.1 已完成实施并通过独立代码审计。只读全量回放双跑一致，digest `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`，158 chats、939 assistant messages、18,169 pages；candidate denominator 6,171 = 297 `confirmedAttributed` + 664 `probableDisplayTitle` + 5,210 `unresolvedCandidates`。728 个 production four-field hints 均通过 page-local span 验证（728 validated、0 rejected）。该 728-hint 子集互斥分为 664 `probableDisplayTitle` 和 64 `confirmedAttributed`；64 条全是 `pageKind=attributed-dialogue`、`kind=speaker`、`ruleId=quoted-attribution`，是 297 confirmed pages 的子集，不是 span rejection 或额外 candidate 桶。该分项由同 digest replay predictions 与 production segmenter 页按 chat fingerprint/message index/page index 在内存关联得到。旧 v6 原型曾用全文 literal 全局唯一规则得到 92 accepted/636 rejected；这是已被 v6.1 修正的过严原型历史结果，不是最终覆盖或准确率。回放 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；本次分项分析未改代码或聊天。测试 74/74、player-only build、静态架构审计及 `git diff --check` 均通过，原版源、聊天和分页正文保持不变。无 gold 与充分 per-chat scope，accuracy 仍为 `INSUFFICIENT_EVIDENCE`；浏览器和移动端真实 UI 未验收。

### 2026-10-07 同一引语跨度的推测标题续接（parser v10）

若前页已有通过生产 segmenter 与精确原文跨度校验的四字段 probable 证据，后页只有在同一原版 assistant 消息、同一完整消息 hash、同一精确未归属引语跨度上，且该页所有未归属引语跨度都唯一指向同一个早先 seed speaker 时，才可显示 `姓名（推测）`。必须至少有一个 earlier seed page；不能从 continuation 自身滚动创建新 seed，也不能跨消息、从相邻但不同的引语、消息作者名或前页普通标题继承。结构/记录页、显式归属、引语冲突或多 speaker 冲突都阻止该规则。该 sidecar 只改显示标题，绝不升级 segment type、identity、头像、roster 或剧情状态；含语义 `unattributed-dialogue` 的 source narration 页在视觉上下文中保持 unknown，不回退到 narrator 头像。source formatter、segmenter、页数组和正文文字/跨度保持不变。

历史记录：parser v11 仅对 unmatched quote 使用两句兜底；v46 一度将 cap 扩大到所有引号。v49 已恢复配对优先：真实闭合符存在时不触发 cap，只有 unmatched quote 才在第二个句末结束并重扫后缀。生产分页依然使用原消息和原 page spans。不得将旧 v7/v10/v11/v46 评估当作当前规则。

### Speaker title structural rules v46 (2026-10-08)

两个句末后仍未闭合的引语 evidence 强制结束，即使原文更后面最终出现配对闭引号；后缀从 cap 边界独立扫描。该 cap 只用于标题归属，不切断或改写任何页面正文。其余校准：唯一具名角色动作后紧接无署名引语可在同消息内回溯；相邻“她/他说”只可继承前面唯一已明确归属的同一说话人；代词句前存在多个角色锚点时保持未识别；行首破折号后的明确姓名署名照常归属。玩家标记的旧消息不加入规则或金标。

### 2026-10-07 直接说话谓词覆盖补充

后续历史回放发现，少量带有明确发言谓词、但谓词未列入现有 cue 集合的对白会被保守地留为“未识别”。可将 `补充`、`嘀咕`、`提醒`、`回应`、`插话`、`解释`、`低声道`、`轻声道`、`尖叫`、`怒吼`、`咆哮`、`嘶声`、`低语`、`喃喃道`、`嘟囔` 加入现有直接说话 cue 集合；姓名仍须按现有 roster / 未发布姓名准入规则与该 cue 直接相邻，并继续绑定精确原文跨度。此补充只覆盖直接发言行为，不扩展姓名与 cue 之间的动作修饰语规则。

以下形态仍不得据此确认 speaker：姓名 + 手势/动作/地点/关系子句 + 冒号 + 引语；名字只在附近提及；跨消息/跨 chat 继承；仅从页面相邻或说话频次推断。历史回放的 page 数不得当成独立对话数；应同时报告唯一未归属对白跨度及其映射到的生产页数。详细改动及验收见 `docs/GALGAME_STRUCTURAL_SPEECH_CUE_COVERAGE_2026-10-07.md`。

### 2026-10-07 未归属引语回溯窗口和候选性质报告

未归属引语的 probable display title 仅可回看同一原版 assistant 消息内紧邻的前一或前两张**生产显示页**（page index `p-1` / `p-2`）；不得跳页或跨消息。当前页每个相交的 `unattributed-quoted-speech` span 都必须和窗口内经 exact source/hash/span 验证的原始 probable seed quote span 相交，且所有跨度只指向唯一同一 speaker。有效的本地明确/推测标题与语义标题继续优先。derived continuation 不能成为新 seed，因此不得沿更长引语滚动累积；超过窗口保持 unknown-safe。闭合引语之后的新引语不匹配同一 quote span，不能继承前一说话人。此规则仅影响 title sidecar；不得改正文、分页、source segment、annotation、identity/avatar/roster、chat 或存档。

只读历史 replay 应为 unresolved candidates 输出匿名性质计数，包括：未归属 quote span 是否相交、前两页是否有已验证 seed及是否命中相同 quote、引语 closed/cross-page-open/unknown 状态、本地 quote marks/line-colon/dash/speech-cue、base production page type，以及由现有 span/shape/page type 得出的 candidate evidence source。计数用于判断还有哪些结构线索缺口，不代表正确率，不是旁白分类器；absence of speaker evidence 不等于 narration evidence。不得把歧义/对白候选语义分类为 narration；闭合对白的 narratorFallback 是单独的 display-title 计数，不代表 narration 或 speaker attribution。


## 2026-10-07 代词回溯与未知首次自介标题（parser v12）

首次自我介绍在没有外部署名时显示“？？？”，但仍保持 unattributed-dialogue 和 unknown visual role，不从引语自报名称创建 speaker、identity、头像或 roster。姓名式检测要求中文姓名式自介后接标点，或英文 My name is 加姓名；普通“我是不会让步的”“I am ready”不触发。已发布角色 Celestia 的明确同句说话 cue 可显示姓名。她/他代词引语只允许在同一原版 assistant 消息最多两句内回溯唯一已发布角色句首/主语；若无新主体，才可延续唯一近邻直接署名 anchor。新句首主体优先于更早闭合的发言；竞争候选、缺 roster、空行段落、已识别场景标题或跨消息时保持未识别。显示证据必须绑定原文真实姓名跨度。规则只附加 title sidecar，不修改正文、formatter、segmenter、分页、identity/avatar/roster、聊天、存档或 SillyTavern 原版源码；详细反例见说话候选开发规范 §13.7。

## 2026-10-07 v13 叙述包裹对白与首页标题校准

按说话候选开发规范 §13.9：带代词主语的动作子句接冒号引语、但没有明确说话谓词时，不能仅因前文提到某个 roster 人名就回指该人物；该形态可用 display-only 旁白标题。泛指/描述主体带说话谓词却没有唯一可验证姓名 anchor 时，也按当前用户金标显示旁白，不创建角色身份。具名角色的直接 roster anchor 优先保持 speaker；独立无署名引语及普通“她低声说”没有唯一回指时仍为未识别。首页受限标题形态优先于弱词尾 cue；`治疗与审问：格雷戈的情报` 显示“标题”。标题维持 `other-visible` 展示类别，视觉角色 unknown；这些增量只作用于既有 source page 上的 title sidecar，不更改原文、正文分页、segment/identity 或 SillyTavern 源码。结构缓存版本为 v13，定向用户金标回放结果不是全历史准确率。

### 2026-10-07 同聊天重复显式角色名（parser v15）

当该聊天没有可用的完整 cast roster 时，播放器可使用短期、只读的 observed-name 集合：候选姓名必须由现有明确结构规则锚定，且在至少两条不同消息中分别出现。v53 将范围限制在目标消息之前最近八个调用方提供的位置，并在首屏 Markdown/中文场景标题前清空；实时快照中的玩家/空消息会消耗一个位置，但不提供姓名证据。只用于同一聊天当前原消息的局部结构 cue；不保存说话人所有权、不跨消息/场景传递代词。当前目标和未来消息均不能建立自身的前置范围。不能跨聊天、不能用角色卡作者名代替演员表，也不能从单条消息重复、人物提及、动作标题或推测证据学习姓名。

observed-name 仅属于 display-title sidecar。它不写入 scenario/cast manifest、提示词、身份投影、头像绑定、队伍状态、聊天或存档；也不传给 `createVisualNovelDisplaySegments`、formatter、production paginator 或 semantic annotation。缓存键包含目标消息游标、此前 observed-name 集合指纹与 `full-message-speaker-index.v15` 版本。若证据和原文 hash/span 校验不通过，维持现有 unknown-safe 标题。未归属语义对白上的粗略 narrator fallback 不得挡住同页完整结构证据或同一完整引语 span 的精确推测续接；这只改变 display title 优先级，visual identity 仍 unknown。

历史评估只能把重复锚定产生的新增标题计为覆盖变化；它不是人工金标，不能报告为准确率。source page 数组及每页 type/text/sourceText/sourceSpan 必须与不启用 observed-name 集合时深相等；回放必须保证聊天只读、零 provider 调用，且不得触及任何冻结的 SillyTavern 路径。

### 2026-10-07 结构说话人覆盖补充（parser v28）

v28 只增加标题侧车中的三类有界结构证据：动作子句后接明确说话 cue；引语后的显式角色名或“你”说话 cue；角色/群体称谓带明确集体发言 cue。后置标题/头衔只用于匹配已有 roster 姓名，证据 span 仍指向原文姓名。心声、无锚点开引号、墙面/系统信息、身份描述但无实际说话 cue、没有唯一近邻先行项的代词均不强行归属。多人并列主体和信息来源框架继续优先保持安全归属。

历史回放只读，source digest 未变化，未写聊天且未调用外部模型。活动聊天（435 条消息、11,840 页）v27→v28：候选页 4,242→4,266，明确归属页 2,991→3,033；当前有 187 probable display-title 页、1,046 unresolved 候选页、1,097 个唯一未解决引语跨度。全历史（158 个聊天、950 条消息、18,562 页）v27→v28：候选页 5,671→5,695，明确归属页 3,012→3,056，probable 标题 202→202，未解决候选页 2,457→2,437，唯一未解决跨度 2,572→2,553。digest 分别为 `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb` 与 `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`。这些是结构覆盖统计，不是准确率；无逐页金标时准确率仍为 `INSUFFICIENT_EVIDENCE`。正文、分页、source spans、身份/队伍状态及 SillyTavern 原版源码不属于此规则的输入输出改动范围。

### 2026-10-07 英文系统元数据行补充（parser v29）

行首 `System:`/`SYSTEM:` 被作为游戏信息字段时归入结构化旁白，不计作角色对白候选。若同一 label 精确出现在当前聊天已发布 roster 且形成有效 speaker anchor，则明确角色 evidence 优先于通用元数据形状。此为展示标题 sidecar 的分类补充；源正文和分页不变，结构缓存版本提升到 v29。回放与测试只读，不写聊天或调用模型。

### 2026-10-08 结构标题 v30

v30 为唯一、明确的无 roster 人物主体 + 说话谓词 + 引语补充本地句法识别；信息来源/系统/状态文本与心声继续优先过滤，多人主体与无声动作继续保守。玩家引语只有配对引号后的明确发声 cue 才归“你”。唯一同消息具名锚点的代词回指仍受两句窗口约束。标题 evidence 缓存升级至 v30，不能改动正文段落、formatter、segmenter、分页、聊天或 SillyTavern 原版。

v30 同 digest 只读历史 replay：活动聊天候选 4,266→4,277、明确归属 3,033→3,171、probable 187→154、未解决 1,046→952；全历史候选 5,695→5,706、明确归属 3,056→3,196、probable 202→168、未解决 2,437→2,342。两个 source digest 未变化，无聊天写回或外部模型调用。数字表示结构覆盖类别变化，不是准确率；无逐页金标时准确率为 `INSUFFICIENT_EVIDENCE`。详见 speaker candidate/replay 开发规范 §18。

### 2026-10-08 结构标题 v31

v31 仅增加两种有界结构：可抽取唯一姓名的“角色第一句话”转述框架，以及唯一具名主体连续执行有限动作并以冒号引出对白。来源文本、心理活动、标题、代词-only、并列主体与裸引语继续 fail closed；speaker span 必须精确对应原文并投影至现有有效 production page。parser/cache 更新至 v31，不改正文或分页。相同 active/full digest 回放计数与 v30 完全相同，说明新增句式未出现在当前两份历史样本中；覆盖变化不能冒充准确率。v31 测试和范围见 speaker candidate/replay 开发规范 §19。

### 2026-10-08 结构标题 v32：完整原文优先与标注噪声隔离

人工复核摘录中的“上一页”“当前页”是上下文标签，不是聊天正文或说话人证据。判读只针对标注目标的当前页正文；若需要回溯，必须从同一条原版消息按原文跨度重新读取，不得把摘录标签/说明拼入正文，也不得据其本身继承说话人。不得在 canonical message、formatter 或全局显示文本中删除字面“上一页”，以免改写真实剧情内容。

v32 仅在标题 sidecar 增加少量基于完整消息结构的归属：单一角色的局部动作/反应可引出同主体引语；首次出现的具名描述性单位只有在同消息内唯一先行词与代词动作线索闭合时，才可作为该页显示标题，不创建持久身份、头像绑定或 roster 项；紧随的动作说明可在后续明确署名的对白锚点成立时回归到前一句短引语。身体、物件或其他表面明确“浮现/显示文字”的引文归旁白；角色以动作直接引出自身引语时，游戏数值内容不因格式像状态块而覆盖角色归属；独立的简短 campaign/game 元数据归旁白。无唯一局部主体或引用来源不明时继续 unknown-safe。

此增量不得改变原文、source span、segment/page 数、顺序、正文分页、身份投影或任何 SillyTavern 原版文件。parser/cache/replay 使用 `full-message-speaker-index.v32`。人工摘录标签与审阅注释放在正文以外；历史回放只读、无 provider 调用。测试覆盖边界样本不等于全历史准确率，未有完整逐页 gold 时准确率保持 `INSUFFICIENT_EVIDENCE`。详见 `docs/GALGAME_FULL_MESSAGE_SPEAKER_EVIDENCE_PROJECTION_DEVELOPMENT_SPEC_2026-10-07.md` §20。

### 2026-10-08 结构标题 v33：文字载体与动作引语

v33 将明确的物品/界面文字载体（如徽记刻字、羊皮纸、地图标注及被选出的记录条目）归为旁白；允许短描述夹在载体与“刻着/标着/写着”等动词之间，但仍要求具体载体和文字结构。生产分段已判作叙述、没有对白范围的句中引号或拟声词也显示旁白。唯一角色以“趴在/蹲在”等姿态、“把物品塞给/递给”等动作或“哼了一声”直接引出引号对白时，可将引语归给该角色；前文唯一姓名 + 紧随代词动作/引语可在同段落边界内回指。首次自我介绍即使前置短呼救仍标题为“？？？”，不创建身份。多人主体和竞争角色继续未知安全。parser/cache/replay 更新到 `full-message-speaker-index.v33`。只改 display-only 标题侧车与回放分类，不改正文、segment/page/span、顺序、身份或原版 SillyTavern 路径。

### 2026-10-08 结构标题 v34：代词动作回指与单位说话 cue

新增两类只影响对话标题的结构证据：

- 单一角色/单位紧邻引语前出现“骂了一句/骂了一声”等明确言语动作，并由冒号直接引出引语时，归属该角色/单位。
- “他/她 + 动作 + 冒号 + 引语”可在同一消息内回溯最多两句；前文须以句首主体形式唯一引入可识别姓名或单位类型，且回溯窗口没有竞争主体或场景分隔。代词本身不作为身份来源；多个候选、匿名主体或跨场景时继续未归属。

回指证据先于普通旁白形状兜底；已有完整消息锚点优先于弱旁白分类。规则仍只生成展示标题证据，不回写正文、角色身份、聊天状态或页切分。本轮没有编辑分页函数。

### Speaker title structural rules v37 (2026-10-08)

加入用户确认的“工会长格雷森…他…行礼 + 引语”“昵称 + 姓名 + 出场动作 + 引语”“公会所属描述 + 姓名 + 惊叹/大喊 + 引语”、有唯一亚龙锚点时的同消息 `它` 连续对白，以及问句后紧跟“你一愣/一怔”的玩家反应句式。无锚点的“它”、非问句后的玩家反应和竞争主体仍未识别。六条金标已覆盖在 v37 测试；历史统计为 3,972 attributed、1,975 unresolved，准确率仍因缺少逐页金标而无法证明。仅生成标题证据，不改正文、身份、原版酒馆源码或分页。

### Speaker title structural rules v38 (2026-10-08)

补充角色名 + 可观察动作 + 引语归属，覆盖“Durik 扛起战斧”“格雷森递过地图”“艾莉娅治疗队友”；支持 ASCII 引号中的外号与姓名连写。`它` 可回指同一场景最近出现的明确生物主体，回指时忽略引语内部提及的其他生物。最近八条助手消息回放 129/129 对话候选页均获得标题；全历史回放覆盖 6,050 个候选页，其中 3,979 attributed、1,970 unresolved，证据跨度 17,810/17,810 有效。该结果表示覆盖率，不代表准确率已证实；逐页金标和完整角色 roster 不足。聊天原文只读，未写回；原文、身份状态、分页及 SillyTavern 源码均未改。

回放与测试按 `full-message-speaker-index.v34` 运行；真实历史聊天没有逐页金标，结果只能报告结构覆盖，不能宣称准确率。

### Speaker title structural rules v35 (2026-10-08)

The display-only speaker index now applies three bounded rules: (1) an anonymous first-appearance voice or shout is titled `？？？`; this is a neutral title only and does not create a roster entry or visual identity; (2) a standalone quote immediately following one unique character's observable action may inherit that actor when no competing actor, information source, or scene boundary intervenes; (3) an explicit action-to-laughter construction such as a role subject followed by a direct quoted line is attributed to that subject, after ignoring a preceding turn header. Pronoun continuation can reuse the local actor anchor.

These rules only change the title projection. They do not rewrite chat text, infer persistent identity, or alter the existing display segment/page spans. Parser version is `full-message-speaker-index.v35`. The current replay remains structural coverage evidence, not measured accuracy: historical speaker rosters and per-page human gold are incomplete.

v35 audit refinement: recent-action backreference now requires the named character to head an action clause, rather than merely being mentioned before an action word. Passive/possessive forms and later competing subjects such as `有人` or `守卫` keep the quote unresolved. Regression examples cover both false-attribution patterns found in independent review.

### Speaker title structural rules v36 (2026-10-08)

Apply clear quote attribution independently per quoted span: an unresolved quote must remain locally unknown and must not erase explicit anchors for other utterances in the same assistant message. A page containing an explicitly attributed character utterance may use that speaker as its title even when narration or a separate unresolved quote is also present; the unresolved quote itself remains unknown. Conflicting explicit speakers remain unresolved. A local action can support attribution only when the named actor is directly tied to the quoted utterance; action alone without a quote/speech relation is not speaker evidence. Anonymous pronouns, discourse words, source objects, and competing subjects do not qualify. This remains display-only and must not alter original SillyTavern text, page spans, or pagination.

### Speaker title structural rules v39 (2026-10-08)

For an entity-pronoun quote, use the latest nearby explicit named-unit introduction in the same scene as the anchor; an older nearby ally/creature mention does not compete once a newer unit has been introduced. For short surprise/denial reactions, use the unique actor in the nearest explicit local failure/hit event (for example, a failed teleport or a named target hit by dragon breath). If these local entity/reaction cases have no unique name, use `旁白`; preserve `？？？` for an anonymous first appearance, and classify an isolated cry such as `啊——！` as `旁白`. A two-person report frame (`Kael和Mira向你汇报`) displays both names as a group. Do not borrow a distant roster/status mention. These rules only affect display titles and full-message evidence; chat text, identity, source page spans, pagination, and SillyTavern-owned code remain unchanged.

### Speaker title structural rules v40 (2026-10-08)

When a displayed page includes a clear character utterance, attribute the title to that speaker even if the same page also contains narration or another unresolved quote. Prefer the closer explicit quote/action attribution over a broad roster-prefix or turn-header cue; equal-strength conflicting speakers remain unresolved. Support a bounded local named speech cue after a comma, quoted character-reaction framing, and an explicit name plus speech predicate at the start of a page when the quote continues beyond that page. Anonymous/pronoun subjects remain excluded. The English goblin item marked by the user as a fault is excluded from calibration. These are display-only structural rules: do not change source text, page spans, pagination, persistent identity, or SillyTavern-owned code.

### Speaker title structural rules v41 (2026-10-08)

Treat a verbal predicate such as `骂了一声`/`骂了一句` as direct speech evidence when a locally named subject and its quoted utterance form one bounded attribution clause (for example `尼布在侧翼探出头，骂了一声：“……”`). The speech predicate may follow a comma-separated action by the same subject; unrelated subjects, source objects, and narrative-only actions still do not establish a speaker. This extends display-title evidence only and leaves unresolved spans, message text, identity, visuals, page spans, and pagination untouched.

### Speaker title structural rules v42 (2026-10-08)

Allow a short narration clause followed by an explicit connective and a pronoun-led speech predicate (for example `声响清脆……，紧接着他捏着嗓子喊：“……”`) to refer to one nearby explicit speaker anchor across the existing display split. The connective lead is bounded to 48 characters, contains no published character name, and still requires a unique nearby explicit anchor; competing anchors remain unresolved. Never treat the connective-plus-pronoun phrase itself (such as `紧接着他`) as an unrostered character name. A resolved open quotation can carry the same title onto its existing continuation page. This changes title evidence only; original text, page segmentation, pagination, and SillyTavern source remain unchanged.

### Speaker title structural rules v43 (2026-10-08)

Apply the latest seven user-calibrated labels through title evidence projected onto the existing SillyTavern display spans: player action followed by first-person quoted declaration → `你`; a newly introduced unnamed voice → `？？？`; a spirit's first-person farewell may inherit the uniquely named spirit from the immediately preceding spirit-action clause; a named action subject before a colon quote retains its full compound name (including `·`); a nearby explicit speaker may carry through `它 + creature-specific object/action + quote` when unique; and a quoted laugh followed by that same named actor's laugh/speech remains attributed to the actor. Keep generic narration distinct from a first-appearance unknown speaker. Competing action subjects, source/system-information frames, non-unique nearby anchors, or missing explicit evidence remain unassigned/narration-safe. This changes display title evidence only; do not change message text, page spans, pagination, persistent identity, or original SillyTavern source.

### Speaker title structural rules v44 (2026-10-08)

用户确认的龙类归属采用有界、同场景规则：只有附近唯一出现过的复合龙名，且引语和局部正文具有龙类语境，才把对白归到该龙；Markdown 标题、分隔线和明确场景/地点标记会截断回溯；未具名龙类称谓不是角色名。名字未出现、超出局部窗口或附近存在多个候选时保留“？？？”。首次自我介绍允许用完整复合名覆盖泛称“巨龙/龙”。明确的玩家自述仍归“你”；明确短名动作对白使用动作前角色名。仅影响标题证据，不改变聊天正文、页序、既有 source spans、分页逻辑、持久角色身份或 SillyTavern 原版代码。
### Speaker title structural rules v45 (2026-10-08)

Treat locally introduced role labels and creature/person descriptors as speakers when directly tied to a speech act (`镇长迎接…：“…”`, `章鱼犹豫…：“…”`, `光头颤抖：“…”`). A pronoun-led action before a quote may resolve to the uniquely explicit player action `你`, including when a short clause intervenes. For a genuinely anonymous first appearance, keep the title `？？？`; never turn indefinite descriptions or voice/manner words such as `陌生身影` and `冷声` into character names. These rules alter title evidence only; message text, original display spans, pagination, and SillyTavern-owned files remain unchanged.
补充：引号前的终止逗号可与明确说话 cue 配合识别，且“终于开口”作为明确发言动作可绑定紧随其后的引语；泛称和声线词仍不作为角色名。

### Speaker title structural rules v47 (2026-10-08)

当引语前一短句以破折号署名开始、以明确说话谓词结束，并紧接该引语时，按署名归属；例如 `—Andrei低声说。 “……”`、`—God缓声说。 “……”`。姓名无需预先出现在角色 roster，但必须是原文中清晰的人名形态，且 speaker span 精确绑定到署名字符。该规则限于同一条原版消息里紧邻引语的短句，不跨段落、消息或场景，也不从普通动作、被动提及或无破折号的说话提示句推断。`—Pippa翻开账本。 “……”` 仍不归 Pippa。该规则只产生展示标题证据，不创建持久身份/头像/roster，不修改正文、分页、source spans、聊天或原版代码。

### Speaker title structural rules v48 (2026-10-08)

用户确认破折号姓名优先：同一消息中，紧邻引语前的独立短句以 `—`、`–` 或 `-` 开始且后接清晰人物姓名时，该引语归给该姓名，不再要求出现“说/道”等说话谓词；短句可以是动作或场景描述。该规则覆盖此前拒绝 `—Pippa翻开账本。 “……”` 的 v47 限制，也优先于短句后半段或引语内容带来的语义猜测。候选短句和姓名 span 仍须局部、可定位；无破折号、姓名不清晰、引语不紧邻或中间出现另一完整句时不套用。只影响展示标题，不改变正文、分页、source spans、持久身份、roster、聊天或 SillyTavern 原版代码。

### Speaker title structural rules v49 (2026-10-08)

修正引号证据扫描：只要引号有实际配对闭合符，就持续扫描到对应闭合符，不因引号内出现两个句末标点而提前截断；只有确实找不到配对闭合符时，才在第二个句末边界强制截断并重新扫描后续内容。此项仅改变说话人标题证据，不改变原文分页、source span 或聊天。

新增几类粗粒度局部 cue：明确的第一人称自述/宣言紧接以“你”为主体的取物、展示、接受或挺身动作时归“你”；“它”引出动作并冒号接引语时，只能回溯到同消息近期唯一的显式说话者；短促“成功/失败”紧跟攻击、伤害、检定等记录归旁白；同一引语段里的多条消息引语，只有在本段或紧邻的短段明确描述人群欢呼时才可归“人群”，证据范围不得延伸到下一位具名说话者的台词；孤立“咔”按场景拟声归旁白；“咬牙”等动作谓词补入姓名动作 cue；简短合作/礼貌收束语紧跟玩家握手动作可归“你”。单人或群体归属不够明确时按既有旁白兜底，不能据此创建角色身份、队伍成员或头像绑定。

上述规则只产生 display-title evidence，必须映射到原始 span；不修改正文、分页器、source spans、SillyTavern 原版代码或持久游戏状态。

### 2026-10-08 结构标题校准（parser v50）

追加八条当前聊天人工金标：群体“全员 + 单膝跪地”引语显示“全员”；“你 + 可观察动作 + 冒号引语”显示“你”；“接待员/格雷森 + 局部反应或阅读动作 + 引语”归动作主体；并列协同行动者共同引出的引语，单凭第一人称语气词不能确定说话人，按用户允许的旁白兜底；引语闭合后紧邻的短署名（如“艾瑞克介绍”）回归为说话者；消息/传闻引出的多条转述引语，即使被既有生产分页拆开，仍按同一消息的局部报告框架归旁白；开场标题后的独立“行动！”等短命令归旁白。确实难判且无有效 speaker 证据时继续旁白兜底，但匿名首次登场仍保留“？？？”，不闭合的引号仍不走旁白兜底。

规则仅在完整原消息索引与既有生产页 source span 上产生展示标题，不重分配段落、不跨消息借名、不写入 roster/身份/聊天，也不调用模型。parser/cache 版本升至 `full-message-speaker-index.v50`；详见历史回放计划 v50 条目。

### 2026-10-08 行尾孤立引号恢复（parser v51）

无活动引号时，行尾孤立 ASCII 双引号不再被当作新开引号，以免把后续对话的开闭配对整体错位。后续有效的 `角色说："正文"` 仍按原样解析；真正未闭合且无唯一说话人证据的引语仍显示“未识别”。修复只用于结构归属和标题 sidecar，不改原文、既有 segmenter、页面数/顺序/span、身份或 SillyTavern 源码。历史回放计划记录了精确残留行、v51 分桶和边界。

### 2026-10-08 真实历史标题校准（parser v53）

六条真实历史消息的展示标题以精确 chat/message hash、既有生产页索引和 source span 为 gold。通用证据仅包含：具名主体紧邻可观察动作/反应再接冒号引语；同消息唯一具名受击目标后紧接代词动作反应；引号外明确第一人称动作前缀（如“我压低声音：”）归显示标题“你”；同消息显式说话锚、代词动作及同一结构小节标题形成的连续发言；以及人物爵位称谓仅在可见标题中去除、保留源姓名证据。第一人称映射只由 `player-first-person-action` 规则接受：`speaker.sourceText=我` 且 source span 精确命中该字，`speaker.text/displayText/title=你`，并再次验证消息 hash、页 span 和规则 ID；不得将引号内 NPC 的“我”映射为玩家。该规则不创建身份或头像。

爵位/称谓的可见标题别名只由 `honorific-display-title` 规则接受：`speaker.sourceText` 与 source span 保留完整原文称谓（如“马库斯伯爵”），`speaker.text/displayText/title` 才显示去掉已识别称谓后的名字（“马库斯”）。解析器须同时证明当前原文人物动作直接引出引语；主验证器和 renderer 均按精确 rule ID、别名、source message hash、speaker span 与当前页 span 限定，不将文书标题或普通提及剥离称谓。

聊天 observed-name 词表只保留最近八个调用方提供的位置，并在首屏 Markdown/中文场景标题前清空；实时快照中的玩家/空消息消耗位置但不提供姓名证据。它仅能参与解析当前消息自己的完整局部说话/动作 cue，不携带 speaker owner 或 pronoun；标题、roster 和任意姓名提及不能单独建立新归属。传递报告/物件时，显式`说`cue只可选择动作边界前完整人名；不得接纳包含`把`的截断 span，文书载体内容归旁白。匿名首次登场仍显示“？？？”，真正未闭合的引语仍显示“未识别”；闭合且无唯一归属仍按 v51 的 display-only `旁白` fallback。全部证据只用于既有页面标题，不改变正文、分页函数、页面序号/span、角色身份/头像/队伍状态、聊天或 SillyTavern 原版代码。精确 gold、负例和回放指标以 v53 TaskSpec 与历史回放计划为准；覆盖计数不等于准确率。

### 2026-10-08 同消息连续对白校准（parser v55）

v55 仅补充经真实历史页验证的局部结构：同一仍未闭合的 Pippa 引语沿用同一 source quote 锚点投影到现有后续页；同一消息内，匿名自我介绍后若前置段有唯一具名动作主体，后续单一“她/他 + 动作或声线 cue + 引语”可归该主体，且不改变匿名自我介绍页的“？？？”。具名角色动作直接引出带语言内容的引语时可作为说话证据；纯口哨/拟声不构成说话。该规则只改变 display title evidence，不改变 semantic segment/type、source text、segmenter/page spans/order/count、身份、roster、头像或聊天；不跨原消息，不越过场景/标题、竞争角色或文书载体。准确边界和回放数据见 v55 TaskSpec 与历史回放计划；覆盖变化不等于准确率。
## 2026-10-08 v58 人工标注归并规则

speaker title 的历史校准按结构类型处理：明确署名、同消息唯一角色的代词回指、同一未闭合引语跨现有分页、匿名首次发声与旁白/标题/书面载体分别建模。说话/动作词表仅用于识别 cue 类别，必须与主体、引语边界和载体共同构成证据；任何单个关键词不得独自确定说话人。人名保持原文拼写；匿名说话人不得成为持久身份。详见 v58 TaskSpec。该功能只改 display-title sidecar，严格不改原文和分页。

### 2026-10-09 结构化说话归属校准（parser v66）

v66 把“姓名/匿名角色描述 + 说话动作 + 引语”作为组合证据，支持动作前后的声线修饰词、较长中文角色称谓，以及代词回指到最近两页内唯一匿名人物；首次出现的匿名人物显示“？？？”，不创建持久身份。若同一原始配对引语跨越现有分页，所有相交页沿用引语开端的 speaker；引语正文中提及其他姓名不触发换人。对没有唯一归属的未闭合引语，当前页和有限回溯均无证据时归旁白并保留诊断原因，退出“未识别”分桶。规则只影响标题证据，不改正文、已有分页、source span、聊天、角色状态或 SillyTavern 原版代码；细节见 v66 TaskSpec 和历史回放计划。
