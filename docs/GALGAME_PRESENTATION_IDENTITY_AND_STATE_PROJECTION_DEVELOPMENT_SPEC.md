# Galgame 叙事说话人、角色身份与状态投影开发规范

> 状态：v1 组件已接线；当前 `zh-CN` 为用户指定、尚无 gold 报告的 assisted 试运行；跨剧本准确率和玩家端验收未完成
> 范围：只读呈现层；不改变 SillyTavern 聊天内容、Generate 语义或运行时状态
> 权威依据：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
> 配套视觉契约：`docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md`
> 可执行文件清单、闭合 DTO、命令、staging/回滚和验收 gate：`docs/GALGAME_PRESENTATION_PROJECTION_IMPLEMENTATION_PLAYBOOK.md`

> 当前实施边界（2026-10-06）：代码允许 `zh-CN` 走 assisted 呈现，`PRESENTATION_GATE_REPORTS` 仍为空，属于用户指定的未验证试运行，不等同于金标准 gate 或跨剧本准确率验收。完整有效注释与身份/roster 投影仍按本规范的 source/hash/scope/timeline 校验执行；标题 Demo 的窄范围快速提示只补缺失/unknown 标题，不建立 identity、头像绑定或 roster 状态，见 `GALGAME_SPEAKER_LABEL_HYBRID_DEMO_DEVELOPMENT_SPEC_2026-10-06.md`。

## 2026-10-06 说话人标题 Demo 与身份投影隔离

标题 Demo 只增加原文可定位的 display-only 说话人提示。已有完整有效投影为当前页提供的标题仍优先；不能仅凭完整段数组的存在认定该页已有有效标题。显式结构提示或 page-window Annotation 只能填补当前页缺失/unknown 的标题，包括附加到当前页 identityRef=unknown 的投影段；这仅对标题覆盖旧文“page-window 只补 source-only unknown base page”的范围限制，不改变段正文、分页、source span、identityRef、角色视觉候选、头像唯一绑定、roster、Annotation v1 或聊天/存档。page-window 结果须以相同 message index/full hash，且 `coreSpan` 与一个当前实际显示页 `sourceSpan` 完全相等且只匹配一个页面，才可附加；不完全对齐时保留原标题/unknown。跨页引语续接只允许使用前一相邻页已有的来源/hash/page-span 均有效的单一说话人标题证据；续接页的 classification span 必须在当前 core 的引语内容内，姓名 span 可在 lookbehind 内。该窄例外只修正标题显示优先级，不改变本规范的 identity/roster 完整性门槛。具体输入模式、处理顺序、文件清单及验收用例见 `docs/GALGAME_SPEAKER_LABEL_HYBRID_DEMO_DEVELOPMENT_SPEC_2026-10-06.md`。

2026-10-07 标题证据来源补充：上述“相邻页”限制只描述旧路径，已被 `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md` 的完整消息证据索引条款取代。标题可以使用同一原版消息中的直接署名锚点投影跨页的同一对白，但仍须满足精确 source/hash/span 校验及 unknown-safe；不改变 identity、avatar 或 roster 投影，也不将结构证据送入语义上下文。

2026-10-06 修正：未被语义结果认作对白的无引号普通正文可以暂时显示旁白标题。该推断严格停留在 display-only title；segment 仍可为 `unknown`，identity 仍 unknown，不得因此使用 narrator 视觉资源、绑定角色或写入 roster。长消息即便先显示粗旁白标题，当前页的 page-window Annotation 仍须执行；有效语义结果标为 dialogue/unattributed-dialogue 时覆盖粗标题。身份投影仍遵循下文更严格的 fail-closed 与 gold-set gate。

## 1. 目标

建立适用于多语言、多题材、多剧本的通用呈现分析层，解决下列相互关联的问题：

- 一条 SillyTavern assistant 消息包含旁白和多个角色对白，但玩家端把角色对白显示为旁白；
- 已绑定角色有头像，新出现的角色虽然在正文中说话，却没有可解析的角色身份或图片；
- 新队友、人物状态、物品、技能、任务等展示只读取最新一条回复，前文已明确的信息无法稳定地继续显示；
- 仅用固定字符串规则识别时，对未知文本误判为人物，对自然变体又漏判。

本提案只对已读回并交给玩家显示的原版聊天文本作标注。原文始终是唯一叙事内容，所有人物、场景和状态结果均为可重算的展示投影，不是第二套剧情或玩法状态。实现首期 v1 仅覆盖文本片段/说话人/实体与队伍 roster；HP、装备、物品、技能、任务和线索状态暂不进入 DTO 或实现，需另行补足字段更新/清除/冲突语义并升级协议版本。

## 2. 审计依据与复现

审计时对本地最新可访问的一条活动聊天做了只读复现。原版记录的消息级 `name` 指向一个生成角色；正文则混有已发布 cast、未绑定新角色、叙述、状态和选项。原始记录没有逐段 speaker 字段或角色数组。本开发规范不保存聊天文件路径或完整剧情文本。

使用该故事实际发布的人物绑定作为 known-speaker 输入运行当前切段器，最新回复被切成 45 段，其中 37 段为旁白、8 段为对白。若干清楚带角色主语和引语的发言仍被归为旁白；带叙述含义的普通词语又被误识为人物名。此证据说明问题不是简单缺一个角色名称或一条正则，而是分类模型同时缺少未知 speaker 类别、说话证据对齐和身份连续性。

同一回复的状态正文包含多个角色的队伍/生命值信息；当前状态提取只识别出部分队伍成员，其余角色状态落入通用分组。面板每次只解析当前 assistant 回复，也不会从先前可见消息重建成员关系。

## 3. 不可违反的边界

1. SillyTavern 仍是角色卡、聊天、上下文和生成语义的唯一权威；不修改冻结后端。
2. 只分析已向玩家展示的原版消息文本及有限的已展示历史，不读取隐藏思考、prompt、角色卡正文、世界书正文或未展示上下文。可见聊天文本也属于不可信数据；分析器必须把其中的命令、提示注入或要求泄露信息的句子当作待分类文本，不能执行、遵从或覆盖系统标注指令。
3. 分析器不生成或改写剧情，不创作对白、选择、结局，不执行招募、战斗、背包等玩法逻辑，也不写回原版聊天。
4. 展示注释必须能从原始聊天重新计算；不得把临时推断保存成独立的剧情事实。
5. 未知说话人不得自动归为旁白；无法确定的对白使用“未知说话人”/中性占位，不借用其他角色头像。
6. 精确发布绑定优先。动态匹配必须有可追溯的可见证据、唯一性检查和保守回退。
7. 分析失败或超时不得阻塞聊天显示、输入、存档和原版生成。

## 4. 目标架构

```text
原版 SillyTavern chat snapshot
  └─ visible-message normalization (preserve original text/hash/index)
       └─ presentation annotation (speaker spans + entity mentions + evidence)
            ├─ chat-local identity projection (aliases/continuity, derived only)
            ├─ visual resolver (published exact binding → evidence-based candidate)
            └─ status projection (chronological replay of snapshots/events)
                 └─ Galgame UI: dialogue, neutral unknown, portrait, roster/status
```

每个阶段有独立版本化合同、失败状态和测试。分段标注、人物身份聚类、视觉资产选择、队伍摘要不能合并成一个布尔 `character/narrator` 判断。服务离线或注释无效时，玩家端显示未切分的原文和 neutral/unknown 身份，绝不调用已知会把新对白归为旁白的旧启发式切分器。新合同和服务默认 shadow：没有相应语言/剧本留出集报告时不改变当前 label、头像或 roster。

### 4.1 显示消息标准化

保留原版消息索引、聊天 ID、内容哈希、消息级 `name`、角色/玩家来源和最终展示文本。消息级 `name` 只标识原版消息作者/生成通道，不能直接充当其中每句内嵌对白的角色。

格式清理必须先于标注且保持可逆映射：分析文本中的字符位置要能回映到实际显示文本。分析器不能删字、重排、润色或合并原文。

### 4.2 说话人和段落标注

定义三个相邻但独立的闭合 DTO。provider 只返回内部 `galgame.presentation-analyzer-candidate.v1`，其中包含 segment 起点两侧相邻的 exact `beforeText/afterText` 锚点、证据 quotes、实体提及、候选关联和状态 claim，不包含完整 segment 正文、数值 offsets、源消息索引、源消息哈希、segment 文本哈希或传输元数据。分析服务要求第一个锚点精确绑定到原文开头，后续锚点在原文中唯一且严格递增；服务据此形成连续完整覆盖。其他证据 quote 必须能在允许范围内唯一定位，实体用唯一 context quote 锚定 surface mention。不能唯一定位时有界重试后拒绝，不猜字符位置。服务把候选与原请求按序配对，从本地原文确定性生成 spans/hashes，再运行严格校验并返回稳定的 `galgame.presentation-annotation.v1` 浏览器合同；外部请求/响应协议保持 v1 不变。之后 `galgame.identity-projection.v1` 由本地 resolver 消费 annotation 和会话历史，产生稳定的 chat-local entity ID 及最终 speaker reference。三份合同分开版本化、分开校验：

- annotation v1 的 `sourceMessageIndex`、`sourceMessageHash`、`annotationVersion` 由服务端从当前请求绑定，不由 provider 复制；
- 按原文顺序覆盖最终实际展示正文的 `segments`；
- provider candidate 的每段含精确 `startAnchor:{beforeText,afterText}`、`kind`、本消息 `speakerMentionRef` 或 null、`confidenceBand` 和精确 `evidenceQuotes`；服务端将锚点绑定为连续 code-point `start/end`，并计算 annotation v1 的 `textHash`；
- 消息内实体提及 `entities`：由 `surfaceText` 与能唯一锚定该提及的精确 `contextText` 派生原文跨度，并附明确可见属性 quote；稳定 `chat-local entity ID` 不属于模型输出，由身份解析层生成。

身份 projection DTO 另含 `resolvedSpeakerRef`，取值为 `{type: published, id: <manifest cast ref>}`、`{type: chat-local, id: <resolver-issued ID>}`、`{type: unknown}` 或 `null`。只有 `kind=narration` 时必须为 null；`kind=dialogue` 的 null 非法，未知说话人用显式 unknown；`kind=unattributed-dialogue` 必须为 unknown；无归属 `stage-direction/status/choice/other-visible` 默认 null，只有确有说话行为时才可带 ref。validator 校验 kind/ref 配对及 ref 来源，模型 DTO 不允许携带 `resolvedSpeakerRef`。

`sourceMessageHash` 和 `textHash` 使用 SHA-256 对 UTF-8 字节计算；source hash 输入为前端安全显示清理完成后的确切 UTF-8 文本，保留可见文本中的空白和换行，不作 Unicode NFC/NFKC 正规化。两种 hash 均由服务端对请求原文/模型给出的已校验 code-point span 确定性计算；禁止要求 provider 生成、复制或猜测哈希和 source index。区间基于同一份解码文本的 Unicode code point 计数；JavaScript 应将其转换为 UTF-16 索引后再切片，并校验切片重新编码后的 SHA-256 等于 `textHash`。格式清理若有可见字符删改，必须提供原始文本到显示文本的偏移映射；不能映射时只允许标注已显示版本，禁止回写或覆盖原文。`evidenceSpans` 使用同一消息文本坐标、引用实际原文子串，不接受模型摘要作为证据。`purpose=speaker` 的 segment evidence 可落在 dialogue segment 边界之外，例如对白前的“米拉说”子句，但必须处于同一 source message 边界内、覆盖对应 person mention 并直接支持该人物说对应 dialogue；其余 segment evidence 仍限定在所属 segment。不得为满足校验而把署名叙述并入对白。

`kind` 至少区分 `narration`、`dialogue`、`unattributed-dialogue`、`stage-direction`、`status`、`choice`、`other-visible`。annotation DTO 只使用本消息 `speakerMentionRef`；speaker identity 的最终归属只由 identity-projection DTO 的 `resolvedSpeakerRef` 表示。旁白和无归属对白必须是不同类别。

采用语义标注而非不断添加语言/题材专属正则：由服务端受限分析器（LLM 可作为实现之一）对可见文本给出闭合语义候选和精确原文 quote；模型不得返回任意图片 ID、链接、稳定身份 ID、文本改写或无证据状态事实。聊天正文按不可信数据隔离，分析器只执行固定标注任务。确定性检查负责验证合同、quote 绑定、Unicode code-point spans、文本哈希、实体引用、顺序和完整覆盖；它不承担自然语言语义分类。模型给出的 confidence 仅作排序信号，不可直接作为自动绑定门槛。生产阈值必须基于整部剧本和整种语言留出的人工金标准集校准，并分别对说话人、身份关联、可见属性和状态事件校准；达不到门槛时只 shadow-run 或退回 unknown。

对关键证据做 fail-closed 校验：区间须在文本边界内且不得切开代理对；对白证据必须引用同一消息中实际存在的文本；段落区间不可重叠、乱序或覆盖不到原文；实体/属性必须附原文证据。校验失败时该部分退回未知/旁白保守呈现，不接受模型补写。

语义标注器区分“明确旁白”与“明确对白但说话人不明”。只有模型对叙述类型有足够把握时，Annotation segment 才标为 narration；直接引语无法归属时标为未知说话人。玩家标题另外存在一个 demo 级 plain-prose fallback：符合条件的未标记普通正文可暂时显示“旁白”，但 segment 与 identity 仍保持 unknown，且不触发 narrator 视觉 channel；见本规范顶部的 2026-10-06 补充。不能因陌生名或未发布角色而创建人物身份，也不能把粗标题当成语义标注结果。

#### 跨分页引语连续性兜底

显示分页可能把同一条长引语切成相邻页面，后续页面没有重复署名或开引号。为避免前一页正确的角色在下一页被回退为旁白，播放器可以在**同一原版消息**的有序显示段之间追踪已归属 dialogue 的引号状态：只有前一段已经有非 unknown 的角色 identity、且该段结束仍存在未配对的方向性/CJK/ASCII 双引号，下一段才可临时沿用该 identity；扫描到对应闭合符后立即清除连续性。引号是否打开不能自行认领角色；它只是延续证据。当前段若有更强的明确署名/有效注释，当前说话人覆盖继承值，并重新计算后续引号状态。继承标记只用于显示与视觉绑定，不改 annotation DTO、聊天原文、身份聚类、 roster 或持久存档。消息结束、消息 hash 改变、swipe、切聊天/新局时状态归零。引号类型不匹配、状态歧义、旁白段或 unknown 身份不继承，退回已有安全呈现。
### 4.3 Chat-local 身份连续性

角色身份投影的稳定范围是进行中的原版 chat/存档游玩会话和绑定的 scenario release；Arc 是分析上下文和缓存失效因子，但同一存档切换 Arc 不自动销毁已解析身份或头像绑定。开始新局/新 chat 才创建全新身份空间。输入是有序的可见消息注释和发布 cast aliases。发布角色精确命中优先于新实体聚类。首期 v1 只允许 published alias 精确命中及无同消息重名/可见属性冲突的唯一规范化人名复用；同名出现歧义时整组重放拆成 occurrence-local identity。模型的 alias/coreference candidate 仅诊断，不得自动合并。代词、语义相似、性别/种族/职业都不能单独用于合并。跨名 alias/coreference 自动合并属于未来版本，须单独具备按剧本隔离的 calibration/holdout 报告与校准器审计后才可定义。通用名词（守卫、商人、队伍）默认不是永久唯一人物；不能仅凭“守卫”把两次出现合并。

身份投影必须可从聊天重放。实现可以对 `messageHash + annotationVersion` 缓存分析结果，但缓存不能成为事实源。渲染任何 assisted projection 前，必须将完整 assistant 时间线逐条与当前 snapshot 对照：raw index、确切展示文本、作者标签、注释哈希和聊天作用域必须一致。前序消息编辑、swipe、删除、分支或作者变化时，旧身份/roster projection 立即失效；重新分析完成前使用原文与 unknown-safe 呈现，不得在异步分析窗口沿用旧结果。不得跨 chat、新局或不兼容的 scenario release 继承临时 ID；Arc 变更需重算依赖 Arc 语境的注释，但同一 chat 的稳定 identity key 和已验证绑定可延续。

**当前消息标签与完整身份投影是两个验收门槛。** 当前活动 assistant 消息只以一个 target message 单独请求 Annotation v1；结果完整有效，且 exact source text/hash、chat/scenario/version/release/arc、消息索引、活动 cursor 及完整时间线前缀、analyzer scope、context digest、发布 known-entities fingerprint 与 singleton provenance 都匹配，才可从 `speakerMentionRef → person entity.surfaceSpan` 显示原文 speaker 标题。该证据不足以产生稳定的 `published`/`chat-local` identityRef：若完整时间线 projection 不完整，segment 必须维持 unknown identity，不得触发角色视觉候选、头像唯一绑定或 roster 删除/完整化。更早的消息不做后台批量回填；玩家回看并使其成为活动 target 时才单独分析，没访问过的历史行可以继续 unknown。前缀编辑、swipe、替换、切 chat、cursor 变化、scope/context 变化均使 memo 失效。没有当前有效证据时保留 unknown-safe；不得使用文本正则推断 identityRef、角色身份、头像或 roster。唯一窄例外是 2026-10-06 Demo 规范明示的 display-only 标题快路：它只可按明确格式补当前页标题，不构成语义身份推断，也不得用于任何 identity/visual/roster 决策。

### 4.4 头像和视觉资产分配

仅对当前正在显示的角色片段选择头像：

1. 对已识别发布角色执行角色名/别名的精确 manifest binding；
2. 新角色使用 chat-local identity 和从当前及历史已显示消息收集的可见外观证据，交给现有视觉候选机制评分；
3. 只有候选分数达到阈值且与次优候选有足够区分度时才绑定；
4. 绑定按 chat-local identity 稳定复用，并保证不同身份不共享同一动态头像；遇到已占用资产或同一身份收到不一致资产时 fail closed 为中性占位；
5. 证据不足、候选冲突、资源池耗尽、服务失败时显示中性未知角色占位，不显示旁白图、不随机借用旧角色图。

玩家与旁白是独立 presentation channel，不是普通角色身份：只有当前 role=`character` 才创建或接受 `entityType=character` 的动态人物决策，纳入 chat/release 一对一头像 ledger。player/narrator 只允许使用 manifest 精确声明的专用资源，且视觉上下文必须由当前已发布 catalog 提供 hash 绑定的 channel 映射；播放器在应用本地精确绑定前核对 asset ID/version 与当前 role 的 `character|player|narrator` channel 一致。普通 character 决策不得覆盖 player/narrator，也不得占用/释放角色头像 ledger。视觉候选服务必须执行同一用途隔离：已发布 catalog v2 为每个 character asset ref 提供由 `catalogHash` 覆盖的 `characterChannels` 声明（`character|player|narrator|system`），两条动态候选路径只允许 `character`；未分类的旧 catalog v1 character ref 不得自动参与角色候选或本地精确头像绑定。catalog v2 缺失、重复或越界声明时整个候选请求 fail closed。Manifest validator 同时校验 base 与 Arc override，拒绝任何 player/narrator/system 专用 asset 与普通角色绑定或 `characterPool` 的交集；runtime resolver 即使收到未通过校验的旧 manifest，也必须从 exact pool、未知角色 fallback 和缓存 assignment 中 fail closed 排除专用 asset。player 不得回退到 generic `characterAssetId`。没有专用资源时分别显示玩家占位与中性旁白符号。头像 ledger 必须成功读取、校验并持久化后才可接受新绑定；存储被禁、格式损坏、写入失败或 quota 已满时拒绝新绑定并显示中性占位，不能用页面内存 reservation 冒充跨刷新唯一性。

身份识别与视觉识别是两个结果：认出“Durik 在说话”不等于已经有足够视觉证据认出图片；反过来，人物外观描述也不能证明该段对白是谁说的。属性必须绑定到对应实体证据，不得把整条 DM 消息的所有人物属性合并给 DM 或当前说话人。

#### 多角色呈现页与头像轮播

播放器的基础数据单元是单个显示段；不得假定一个 segment 天然携带多个身份。播放器可从同一原版消息的已验证展示段构造 player-local `PresentationPage`：按原文顺序，仅聚合相邻且各自为 `dialogue`、带有效非 unknown identityRef、来源消息索引/hash/投影版本相同、Unicode code point source span 连续且不重叠的段。shadow/legacy 解析段不带稳定 identityRef 时，只允许用当前 release 的精确人物 binding 将已发布角色精确映射到 `{type:'published', id: characterKey}`；不依据显示名、正则推断或未发布 NPC 名称创建 identityRef。无法映射的 legacy 段不能成为引语继承起点或轮播候选，继续按既有 unknown-safe 方式显示。

任何旁白、unattributed、unknown、player、system、stage/action、`speakerContinuation`、span 缺口/冲突、projection/hash 不一致或消息边界都会关闭聚合。每页最多 3 个 distinct identity、目标长度 900 个 Unicode code point；900 是软上限，分页只在完整 segment 边界发生。若单个 segment 自身超过 900，必须独立完整显示且不启用轮播，不能为凑上限做未经标注器验证的字符切割。缺少可验证 span/identityRef 的 shadow 结果不能聚合。多人页正文按 segment 原序显示原始片段；标题固定为“多人对话”，头像轮播不得把该页误标为某一个角色。只有一个 distinct identity 的页保持原说话人页，不启用轮播。

轮播 interval 为 3,000ms；页索引、chat、swipe、release、Arc、projection source/hash 或 stage reset 改变时立即清除 timer 并使迟到视觉请求失效。每个轮播项优先使用当前 manifest/release 的精确人物 binding；其它可用项必须按该身份自己的已验证属性/证据查询现有视觉服务，不能把组合页或整条混合消息的全部属性共用于每位候选。视觉调用必须沿用 `main.js` 当前的 `/v1/core/visual-decisions` request builder/response validator、当前 visual context/catalog hash、catalog v2 `character` channel 和 chat/release avatar ledger；逐项请求的可见证据限定于该候选自己的 segment source span，或投影中 source span 覆盖该 identity 的已验证 visual profile。每项独立校验决定来源、图片 URL、score/confidence 与唯一账本；禁止借用当前发言人的图、复用他人占用图或使用旁白/玩家素材。只有至少两位角色各自有通过验证的角色头像时才启动轮播；否则多人页保持“多人对话”标题并显示中性群像占位，不显示唯一成功绑定的单人头像。缺图/失败身份继续按自身中性 unknown 占位记录，不作为轮播图项且不借用他人图。最多预取当前页的 3 位角色。

### 4.5 队伍与其他面板状态

队伍、HP、装备、物品、技能、任务和线索面板若实现，都是原版可见聊天的派生摘要。每个显示值必须保留源消息索引、源消息哈希、证据区间、时间顺序和注释版本。本开发首期只启用队伍 roster；其他状态不由 v1 标注器输出，亦不改动现有逻辑。队伍投影由有序的 `snapshot/event` 注释重放：

- 明确 roster 快照必须声明 `complete` 或 `partial`：complete 可将未列出者置为 not-member；partial 只更新列出者，未提及成员保持不变；
- 明确“加入/同行/离队”等事件更新成员关系；普通提及不能自动加入队伍；
- HP、装备等字段按角色实体分别存放，最新明确事实覆盖旧值；没有新值不代表归零或离队；
- 新回复、读档、继续游戏、聊天读回和恢复时从原版消息序列重建或验证增量；编辑、重生成、swipe 后从变更点重放。

若模型输出无法证明是快照还是事件，保留最后一个无冲突且可验证的派生值并标记时间/来源；矛盾值不能按模型置信度静默覆盖，应显示冲突/未知并保留双方证据。roster renderer 必须把明确冲突的身份以“状态待确认”呈现，不能静默过滤。一个 claim 有多个独立证据 span 时，每位成员优先保留覆盖其自身姓名提及的 span。不得推断未说出的成员或状态。首版应集中解决角色身份和 roster，不借机建设战斗引擎或完整 RPG 状态机。

## 5. 隐私、缓存与失败处理

- 分析输入仅包括玩家已经看到的消息、有限最近可见上下文和必要的发布 cast alias/资产标签；不包含隐藏思考、ST prompt/配置、资源正文或 API 密钥。
- provider token 只存在外接服务端；浏览器只调用闭合版本化的展示标注 API。
- 请求/缓存键至少绑定 `chatId`、scenarioId/version、release/Arc、消息哈希、完整可见时间线前缀哈希、当前发布 known-entities 的规范化 fingerprint、annotation version、prompt/model scope，防止旧角色身份或旧分支结果复用。历史 memo 还必须逐项匹配当前 scenarioId/version 与 known-entities fingerprint；上述任一不一致时该行 annotation 视为缺失，identity projection 与 roster 保持 incomplete。完整时间线前缀哈希已覆盖该行之前的可见消息，因而可用来证明窗口外历史上下文仍一致，无需逐条重算每条旧消息的最近四条 context digest。
- 每次读取持久缓存后，都将单条缓存结果包装为 Annotation v1 响应，并以当前精确 source message 与该请求的 known entities 再跑完整 validator。验证失败即删除该缓存项并按 cache miss 处理；不能把未验证缓存写入内存 memo、身份投影或 roster。只有 `current-message-singleton.v1` provenance 可写入新 cache namespace；此前可能由 multi-message batch 生成的旧 namespace 缓存不会被清空，也永不读作 singleton。内存 memo 也必须带同一 provenance；批量结果不能晋升投影、覆盖 singleton memo 或让 roster 完整。
- 分析异步执行；聊天原文即时展示。旧注释不能覆盖新消息/新 segment；通过 request generation token 和 source hash 防止晚到响应应用到另一段。
- 服务不可用：保留原文；有已验证精确绑定则照常显示；未识别对白用未知占位；状态面板显示最后一次可验证投影或未知，不伪造“实时”状态。

## 6. 迁移计划

### P0：数据集和指标

以多语言、多题材剧本建立人工标注黄金集，测试集按整部剧本留出，不允许同一剧本相邻片段同时进入调参集和验收集。至少覆盖 3 种文本风格/题材和所有计划支持的语言；逐项覆盖已绑定角色、多角色单消息、新角色首次登场、无人称叙事、无归属引语、标题/列表/检定、同名/别名、提示注入文本、队伍招募/离队、状态快照、冲突事实以及编辑/swipe。审计所用的当前回复只是一个样本，不得将其措辞写成通用规则。

提议的首个自动显示门槛（逐语言与整体分别计算，shadow-run 先验证）：明确角色说话归属 precision ≥ 97%，对金标准中明确可归属角色对白的正确解析 recall ≥ 90%（包括已发布角色与独立新角色临时身份）；旁白误判为角色 ≤ 1%；确为对白却误判旁白 ≤ 2%；未知/未归属比例单独报告，但不得用它抵消明确说话人子集的 recall 门槛；原文覆盖率与偏移完整性必须 100%；跨消息身份错误合并 ≤ 0.5%，身份错误拆分 ≤ 3%；一局内人物头像重复绑定必须为 0；明确招募/离队事件投影正确率 ≥ 98%；无证据状态错误更新必须为 0。每个启用语言至少需要 500 个明确 speaker 段落、200 个 narration/无归属对照段，来自不少于 5 部整剧本留出作品和 20 个独立聊天；质量阈值按剧本分层 bootstrap 的 95% 置信区间下界验收，误判率用上界验收。样本量或区间不足时该语言不得启用自动身份合并/动态头像，只能 shadow-run 并显示未知。模型自报置信度不替代这些验收指标。

### P1：只读标注契约和影子比较

实现闭合标注响应、偏移/哈希验证、缓存及诊断。shadow-run 的分析结果和对比结果不参与玩家界面、不应用新头像；同时，独立于 shadow 结果的安全展示 fallback 必须遵循上位产品规范：未通过对应语言 gate、缺少有效注释或注释失效时，保留 assistant/character 可见正文并保持 neutral/unknown identity。标题是否显示 demo 级“旁白”按本规范顶部的窄规则处理，不代表应用 shadow 标注，也不改变 identity 或 avatar。审计误识、漏识、属性串人、跨消息身份漂移和分析延迟；不写聊天。

### P2：片段身份与头像

先启用有明确证据的 speaker segment；低置信度保持未知。接入精确绑定及有阈值/区分度的一对一视觉分配。用真实现有 chat 的只读回放确认：旧人物绑定不退化，新人物会从先前可见描述获得稳定且不冲突的候选头像。

### P3：可重放队伍/状态投影

先实现 roster snapshot 与 join/leave 事件；再逐类接入 HP/装备/技能/任务。每类字段定义更新、清除、未知和分支回滚语义，并由原版消息读回构建，不接受 UI 本地点击来改变状态。

### P4：真实验收

在不调用新的剧情生成、不改原聊天/存档的前提下，回放多个真实 chat；验证段落说话人、旧/新头像、队伍状态、读档/刷新、编辑/swipe、手机/桌面布局和服务失败降级。端到端验收必须检查最后实际渲染的角色 label 与 image asset identity，而不是只看模型 JSON 或接口 200。

## 7. 验收门槛

- 原版 chat 消息、正文及顺序逐字节不变；标注区间覆盖显示文本且没有遗漏/重复。
- 已发布 exact binding 对既有角色继续稳定命中；新角色至少可被表示为独立临时身份，即使头像暂时未知也不能变旁白。
- 直接引语归属不确定时，未知对白不伪装为旁白；正文标题不能生成 speaker；不同人物描述不得跨实体污染。
- 同一 chat 中相同身份头像稳定，两个不同人物不共享头像；低置信度/近似候选不随机选取。
- 已明确加入的成员在继续生成、刷新和读档后仍在队伍投影中；明确离队可以移除；普通提及不会招募。
- 修改/重生成/swipe 当前或历史消息后，缓存和派生状态按原版聊天新内容重算；不从旧分支继承。
- 新功能在 P0 定义的整剧本留出黄金集上逐语言通过相同的 precision、speaker recall、误判率、身份错误、资产唯一性及状态错误门槛；至少覆盖 3 种不同题材/文本风格，不得通过为单个案例增补措辞规则验收。不能达到最小样本或置信区间要求的语言保持 shadow/unknown。
- 服务超时、模型错误、资源缺失不阻塞原版聊天，不启动固定剧情，不回写平行游戏状态。

## 8. 审计结论与待决策项

当前源码的主要不合理点是：speaker 解析、实体识别、头像绑定、面板状态提取分散为若干基于固定标签/正则的独立判断；低置信度统一折叠为旁白或空占位；跨消息信息没有可重算的身份/状态投影；一个消息内多角色属性存在归属污染风险。上述结构无法靠增加规则覆盖新剧本。

本方案确定采用“独立 presentation-analysis-service + 受限语义标注 + 确定性完整性校验 + 可重放身份/状态投影 + 有置信度的资源 resolver”。不扩展 visual-asset-service 现有 `visual-runtime-hints.v1`，以免混淆视觉候选决策与文本语义注释合同。端口、启动/复位监控、标注 API、状态回放、缓存、测试矩阵、回滚和放行步骤详见 `docs/GALGAME_PRESENTATION_PROJECTION_IMPLEMENTATION_PLAYBOOK.md`。实现必须先通过独立开发前审计，随后逐阶段执行并做独立代码审计。无论部署形态如何，都不得成为 narrative gateway 或自定义剧情运行时。

## 2026-10-04 scene presentation projection 范围隔离

`presentation-annotation.v1` 的说话人、人物 identity 与 roster gate 不因视觉恢复而改变。页面场景连续性使用独立 `scene-continuity-analysis.v1` contract，只用于可见舞台背景；它不创建人物 identity，不合并角色，不更新 roster，也不替代原版剧情状态。用户要求恢复视觉后，scene producer 可按 `GALGAME_VISUAL_PAGE_CONTINUITY_RESTORE_2026-10-04.md` 的高置信度、当前页证据门槛运行；该例外不得被误读为允许打开整条 annotation v1 speaker/identity/roster 流程。

## 2026-10-05 用户指定的 annotation v1 试运行覆盖

用户随后明确要求启用语义识别，并对历史文本回测。当前唯一发布语言 `zh-CN` 临时走 `assisted` renderer；这覆盖本规范“未达金标准时保持 shadow”的默认 rollout 决策，但不改变 gold 指标、人工复核和整剧本留出要求，也不制造 gate report。只允许消费通过既有闭合 schema、source span、哈希、scope、timeline 与 identity resolver 校验的结果；无效/未归属内容继续 unknown-safe。该运行状态是未验证试运行，不表示说话人准确率、身份连续性或 roster 事件达到第 6 节门槛。回测报告须分别列出准确率（仅在有人审 gold 时）、有效注释覆盖、超时和延迟；若回测表现不足，renderer 仍保持未知兜底并将限制明确交付。

为控制回测已观察到的高延迟且确保 provenance 可重放，试运行只单独分析当前活动 cursor 的一条非空 assistant 消息，不调用历史多目标批量回填。更早且未访问的正文继续 unknown-safe；玩家回看使某条历史消息成为活动 target 后，才为该消息发起 singleton 分析。整段身份/roster projection 只能由逐条 singleton provenance 的有效注释完成；旧 IndexedDB batch cache 保留但因 cache key namespace 变化而不再命中，刷新后只会重新分析当前目标，不会把历史正文写入本地缓存。
