# 结构化说话人标题与大规模历史回测开发规范

> 日期：2026-10-06  
> 状态：本轮实现基线  
> 范围：玩家端当前可见页的 display-only 说话人标题；不改变对白正文、Annotation v1、身份、头像、roster 或原版聊天  
> 权威：本文件补充并取代同日早期 Demo 文档对“结构标题仅限少数模式”的规则范围；不取代 SillyTavern Native-first、Design、Frontend 总体产品规则及原版源码冻结。

## 1. 目标

用确定性结构解析覆盖常见、可验证的对白归属格式，减少当前页大量显示“未识别”的情况。规则依据文本边界和直接归属关系，不依赖剧情主题、动作词库、消息作者或角色被提及的次数。所有规则都必须能回指当前原版消息的精确原文跨度。

结构解析只决定当前页标题提示。它不是通用自然语言分类器，不修改 annotation segment、speaker identity、头像绑定、队伍状态、原版聊天、存档、分页或剧情。未能由明确结构支持的对白仍显示“未识别”；不能因解析器没命中而把对白降成“旁白”。

## 2. 根因与当前实现边界

当前 `createStructuralPageTitleEvidence` 已有快速标题路径，但覆盖格式少且证据粒度是页面级：已发布角色名加冒号的匹配范围偏宽；对白动词模式依赖少量固定句式；一页中已识别对白与未归属对白并存时缺少一致的冲突策略。另一方面，语义注释校验要求明确原文 evidence；上游没有给出足够 speaker evidence 时会安全降级为 unknown。结果是规则召回有限，语义路径也不能替结构猜测。

本改造保留现有 unknown-safe、原文 hash/span 和语义校验；仅将结构识别扩成一套小型、可回归的语法解析器，并补一个不调用模型的离线历史回放器。当前代码位置和调用路径继续复用，不恢复旧 `createVisualNovelDisplaySegments` 作为语义 fallback。

## 3. 规则语法与优先级

### 3.1 输入和输出

解析输入包括完整可见原文、当前页 `coreSpan`、当前请求 `viewSpan`、消息索引/hash、已发布角色名、以及同消息前一相邻页的已验证证据。所有 offset 使用 Unicode code point。

解析输出是现有 `pageTitleEvidence` 兼容形态，包含原文名字、speaker span、分类 evidence span、规则 ID、消息索引/hash 和页范围。解析器不得返回身份 ID、asset ID、性别、种族或状态声明。

### 3.2 结构扫描

以单次线性扫描识别常见成对引号：`“…”`、`「…」`、`『…』`、ASCII 双引号，以及同类嵌套。一般归属按闭合可靠的对白片段匹配；若当前页 core 内只有一个延伸到页尾的开放引号，且其前缀有唯一、直接的署名/说话结构，可以把说话人用于当前页标题，供长消息第一页先显示正确人物。此时不允许把当前页 title 自动带到下一页；后续页仍须通过同消息、相邻 span、原文 hash 与引号状态校验的 continuation 规则。开放引号结构冲突或候选不唯一时保持 unknown，不从消息作者或普通前页标题继承。

逐段尝试以下直接格式，优先使用范围最短、语法最明确的证据：

1. **行首署名**：段落/行首的人名标签后接冒号、破折号或直接对白。已发布名字精确匹配；新名字仅在紧邻引号或明确说话标记时作为临时原文标题。
2. **署名加引号对白**：`名字说/问/答/喊/道：“对白”`，英文常见 `Name said/asked/replied: “…”`。说话标记使用小型通用闭集，不扩成动作或题材词典。
3. **署名句加引号对白**：冒号直接引出引号时，在紧邻归属子句中只接受唯一、明确的人名候选；有多个候选、跨度冲突或只是在正文提及角色时不归属。未发布的英文候选名若以独立冠词 A、An、The 开头，视为更像标题/地点短语并拒绝；完全匹配已发布角色名时仍可识别。
4. **引号后的直接归属**：对白后紧跟 `名字说/答` 或等价的明确署名结构时，把该说话人归给对应引号片段。
5. **同页多段对白**：分别提取每段的归属。所有可确认对白只有一个说话人时标题为该原文名；有多个已确认说话人时为“多人对话”。若页面含有明确但未归属的对白，不能只凭页面中另一个已识别名字给全页定名，保持“未识别”。
6. **跨页未闭合引号**：沿用现有严格条件：同一原版消息、hash 相同、相邻 sourceSpan 连续、前页唯一明确说话人、当前页引号状态可可靠续接。新署名、嵌套/不匹配引号或非相邻页终止继承。前页最初的署名必须是该页内直接署名的开放引语，不因普通分类标题、作者名或旁白页被带入。

标题/状态/选项等普通文本不因冒号就被当成角色署名。行首 Markdown 标题、列表/引用符号和不符合人名形态的长短语不能作为人名。若标题语法与对白语法无法区分，保留“未识别”。

### 3.3 证据优先级

1. 对当前页有效、完整且经过既有校验的语义标题。
2. 可定位原文的明确结构 speaker evidence。
3. 现有语义 fallback 对未知标题的补充。
4. 无明确说话人证据时显示“未识别”。

普通未标记叙述可按现有产品规则显示粗略“旁白”，但该 label 不创建 narrator 身份；包含引号、署名格式或不确定对白时不得使用该 fallback。语义失败不会改变这个判定。

## 4. 解析器边界与错误处理

- 标题分析以实际显示页 `sourceSpan` 为准，保持既有稳定分页；不得为了贴合解析结果拆分、拼接或改写正文。
- 已发布角色匹配使用精确原文名称；未发布角色仅允许显示从原文提取的临时名字。没有规范身份映射时 `identityRef` 保持 unknown。
- 同一 span 有多个候选、重叠 attribution、引号不匹配、跨页状态不确定、多个候选 name 无法区分，统一返回 null/unknown，不挑一个“最像”的人。
- 结构 evidence 不能覆盖有效语义标题；语义注释不能降级明确且当前页有效的结构标题。
- 解析器失败不得阻塞正文、翻页、剧情推进或头像资源加载。
- 代码只能位于 `frontend/shared/**`、`frontend/player/**`、`docs/**` 和经隔离构建确认的 `public/game/**`；不改 SillyTavern 原版源码、原版配置、外接分析服务或公开 Annotation DTO。

## 5. 历史回放与调规则流程

### 5.1 两类回测必须分开报告

1. **规则覆盖回放**：对可读的全部历史 assistant 消息运行确定性 parser，统计消息数、页数、每条规则命中、未识别页、多人页、含未归属对白的拒绝数、错误/歧义拒绝数和耗时。不调用 provider。
2. **准确率回测**：只在人工核验的 gold sidecar 上计算。没有 gold 时不得把覆盖率、规则命中率、结构有效率或模型输出分布称为准确率。

### 5.2 Gold sidecar

采用版本化、无正文的私有 sidecar。每条样本以 source message index + message hash + script/chat cluster + Unicode code-point spans 绑定；span 标签为明确 speaker、未知/未归属、旁白或非对白标题。sidecar 不含可见正文、姓名映射以外的私人资料或 API 凭据。任何 source hash 不一致均拒绝评分，不缩小分母。

按剧本/聊天簇拆分开发集、验证集和 holdout，禁止相邻消息、swipe 备份或高度重复文本跨集合。抽样须覆盖：角色署名、对白动词、无归属引号、多段/多人对白、叙述夹对白、新人物、旁白、标题/状态/选项、跨页续句、嵌套和不完整引号。

目标指标为人物标题 precision、明确结构样本 recall、旁白/标题误报人物率、多人页准确率、跨页继承准确率、证据 span 有效率及 P50/P95 耗时。v1 replay 当前实际计算 gold 子集上的 exact title accuracy、speaker precision/recall、false-person rate、group accuracy，并单独检查结构 evidence span 有效率和 parser P50/P95；尚不计算跨页继承准确率、按剧本/holdout 分层的 bootstrap，也不创建人工 gold。上述未实现项仍属于后续准确率 gate 的准备要求，不能从 coverage replay 推导。错误归属代价高于 unknown，调参先守 precision，再逐步提高 recall。建议初始 gate：holdout speaker precision ≥95%，样本充分的每个剧本 ≥90%；明确结构样本 recall ≥80%；旁白/标题误报人物率 ≤1%；全部应用 evidence 与 source hash/span 对齐率为 100%。不满足样本数时报告 `INSUFFICIENT_EVIDENCE`。

### 5.3 迭代规程

每轮只加入一个通用结构家族，不加题材词、动作词或角色专名补丁。每个历史错例须先归因为：扫描遗漏、边界错误、归属歧义、页面聚合、跨页状态或 gold 标注错误；修复后增加固定合成回归样本，并同时跑开发集、验证集和未触碰的 holdout。任何 precision gate 回退立即撤销该规则家族。报告保留 parser version、规则版本、数据源 hash、gold 版本、分母和误判样本类别（不含正文）。

### 5.4 只读和隐私

回放器只以只读方式打开 SillyTavern JSONL；开始与结束校验源文件版本/hash，不写聊天、存档或派生缓存。默认输出只写计数、固定规则 ID、耗时和哈希，不打印正文、人物名、路径、密钥或模型响应。私有 gold 和样本导出必须位于仓库外/被忽略的位置，禁止提交真实剧情正文。工具在读取期间发现源文件变化时停止并报告，不把并发编辑造成的变化归因于回放。

## 6. 文件与实施清单

1. 更新 Native-first、Design、Frontend 三份基线规范，明确 display-only 结构标题的扩展规则与身份边界；确认 identity/state 开发规范不冲突。
2. 扩充 `frontend/shared/src/sillytavern-adapter.js` 的纯结构 helper；维持现有函数签名和 `pageTitleEvidence` 形状，必要时只扩展固定 rule ID allowlist。
3. 增加结构 parser 单元测试：常见格式、混合/冲突、标题冒号、Unicode code point span、嵌套/不匹配引号、未知新人物、跨页延续、unknown-safe。
4. 增加零 provider 调用的历史结构回放工具及 CLI 测试；可读取全量消息并可接受 gold sidecar，但默认绝不输出正文。
5. 运行定向 parser/player/replay 测试、架构审计及 player-only 隔离构建；仅将本功能必要生成文件同步到 `public/game`，不得清理或覆盖已有无关静态产物。
6. 独立只读审计复核固定 diff、source freeze、gold 指标诚实性、回放无写入及错误/竞态路径。

## 7. 验收与回滚

实现验收须满足：结构单元测试全过；静态架构审计及独立审计 PASS；原版 SillyTavern 冻结路径无本任务 diff；玩家代码与隔离构建产物对应；回放工具有无聊天数据、无 gold 和 source 改变三种测试；所有 unknown/歧义保持 unknown-safe。

历史准确率只在 gold 数据可用且 holdout gate 通过后报告。无本地历史聊天或无人工 gold 时，可交付 parser、工具和定向回归，但历史准确率为 `INSUFFICIENT_EVIDENCE`，不得伪称“大规模准确率已通过”。回滚只关闭/撤下新结构标题路径并保留日志、原版聊天和存档；不得重置聊天或清理不相关改动。

## 8. 回放工具用法与本轮执行记录

本地执行全量结构覆盖回放：

```powershell
node frontend/player/tools/speaker-structure-replay.mjs
```

工具默认只读扫描 `data/default-user/chats/**/*.jsonl`。可用 `--chat-root PATH` 指定另一份聊天目录，`--speaker-names-file PATH` 提供 JSON 字符串数组作为当前剧本的已发布说话人名，`--gold PATH` 提供上面的私有 gold sidecar，`--max-messages N` 用于有界抽样。默认只输出匿名汇总，不输出聊天正文、角色名或本地文件路径。Gold 必须绑定 `chatFingerprint + sourceMessageIndex + sourceMessageHash + pageIndex + exact sourceSpan`；任一不一致都停止评分。

2026-10-06 本轮执行了真实本机 JSONL 的全量只读结构回放：158 个聊天文件、910 条非空 assistant 消息、17,366 个稳定分页。结果为 speaker 1,315 页、group 23 页、粗标题 narration 8,332 页、unknown 7,696 页；规则命中包含 `quoted-attribution` 1,102 次、`open-quote-continuation` 236 次及 `plain-prose-narration` 8,332 次。Unknown 形态统计中，带引号 5,656 页、同时含引号与通用说话提示词 946 页、疑似引号后署名 43 页、行首冒号 2,721 页、行首破折号 911 页、多引号 4,527 页；这些维度可重叠，仅用于定位待核验格式，不等于误分类数。

该批没有绑定角色名清单，也没有人工 gold；因此结果只能说明覆盖分布和运行成本，准确率 `INSUFFICIENT_EVIDENCE`。本批 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`，耗时约 1.7 秒。后续调规则应先按上述形态分层抽样并人工核验 gold，再只扩展 holdout precision 不回退的通用语法；不得按命中数量直接扩大规则。

结构边界补充回归包括：当前页直接署名的未闭合引语可先显示当前页说话人；英语独立冠词开头的未知短语（如 “The Gate”）不会冒充新角色，若它是剧本显式发布角色名仍可精确匹配。复跑全量 JSONL 后覆盖计数不变；9670/9670 个结构证据页的 classification evidence span 均位于当前页并回指非空原文。跨页继承时，speaker name span 可位于前一页，但必须通过同消息 hash 与相邻范围校验并精确回指原文。parser-only latency P50/P95 为 0.02/0.04 ms，最大 2.63 ms，整轮 2.20 s。以上仍是证据跨度与成本检查，不是标题准确率；无人工 gold 时准确率仍为 `INSUFFICIENT_EVIDENCE`。

## 2026-10-06 正文分页恢复后的回放口径更正

前述 `17,366` 页及对应分类计数使用 `createStablePresentationBasePages()` 作为回放输入。该 helper 会扩展页间空白 span，和玩家现已恢复的 GitHub 旧播放路径（直接采用 `createVisualNovelDisplaySegments()` 输出）并不等价；因此那批分类覆盖数**不能代表当前玩家页上的规则覆盖**。只读差异核对同一批本地历史得到：158 个聊天文件、912 条 assistant 消息；旧 helper 得到 17,529 页，实际播放分段器得到 17,381 页；131 条消息的页数不同，901 条消息的页 span 或正文片段不同。旧计数保留为历史记录，但不得用来评估当前播放器。

结构回放器现已改用玩家播放所调用的同一可见分段器，传入可用的发布角色名；遇到实际运行时无法构造精确 source window 的页，保持 `unknown` 并计入 `unaddressablePages`，不再通过扩展空白跨过这一限制。回放器只作测试口径对齐，不改变玩家分段/分页实现。2026-10-06 对同一只读聊天树复跑结果：158 个聊天文件、912 条 assistant 消息、17,381 个实际分段页；speaker 1,118 页、group 11 页、粗标题 narration 8,366 页、unknown 7,886 页，其中 302 页因 source span/window 不可寻址而按 unknown 保留。9,495 页产生结构 evidence，9,495/9,495 个 evidence span 有效；parser latency P50/P95/max 为 0.01/0.03/1.32 ms，整轮约 1.88 秒。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

本次没有提供按每个历史剧本绑定的角色名清单，也没有人工或审定 gold sidecar。这组结果只是与真实玩家分段对齐后的**覆盖与运行成本**；speaker precision/recall 和整体准确率仍为 `INSUFFICIENT_EVIDENCE`，不能据此声称识别正确率已提升。接下来的结构规则回测必须继续使用这个 direct-segmenter 基线；正文页的格式、分段、顺序、文本、source span 不属于结构化任务的可修改范围。

随后按用户授权，用当前历史样本做了一个很小的助手审定 pilot：遇到“唯一已发布角色名在本地归属子句中，子句以直接说话动词结束，后接引号对白”的句式时，可将该唯一名字作为标题证据；出现两个以上已发布角色名则保留 unknown。只补充通用说话动词“骂/骂道”，覆盖历史中“尼布……低声骂：‘对白’”这一明确归属；不从纯名称提及、未署名引语、状态标题或列表推断说话人。后续迭代再修正英语所有格撇号、带引号内容、单独标题和多行键值状态块的旁白 fallback；当前回放/parser 版本为 `speaker-structure.v7`。这些都只影响标题 evidence，不改任何正文分段或分页。

v7 全量回放（沿用当前直接分段器，未提供跨剧本角色名清单）：158 个聊天文件、912 条 assistant 消息、17,381 个实际分段页；speaker 1,119、group 11、narration 7,986、unknown 8,265。source window 不可寻址的 302 页保留 unknown；其余 9,116 条结构 evidence 的原文 span 全部有效。解析 P50/P95/max 为 0.01/0.03/2.59 ms，总耗时约 1.8 秒。源快照未变化、无聊天写回、无 provider 请求。与此前 v3 对齐回放相比，英语普通叙述中所有格撇号不再导致误判 unknown；多行键值状态块与单独括号/方括号/Markdown 标题不再套用旁白 fallback。

助手按原文语境审定的一个私有 14 页 pilot（2 speaker、2 group、1 narration、9 unknown，覆盖标题、未署名引语、状态/骰点行、项目符号和明确归属对白）结果为 exact title accuracy 14/14、speaker precision/recall 1.0、false-person rate 0、group accuracy 1.0。它只来自一个聊天簇且样本由当前候选形态选择，属于定向回归，不是泛化准确率或 production gate；`INSUFFICIENT_EVIDENCE` 仍然成立。gold sidecar 存在操作系统临时目录，仓库不含剧情正文或 gold 数据。

### 最终收尾复跑（2026-10-06）

静态构建已同步到 `public/game` 与 `public/game-admin`，缓存版本号已更新；构建归一化差异仅包含本轮改动的共享适配器。定向回归 55/55 通过，静态架构审计 `ok=true`、`prohibitedActiveCount=0`、`needsReviewCount=0`，`git diff --check` 通过。直接使用 production `createVisualNovelDisplaySegments()` 的全量只读回放再次得到 158 个聊天文件、912 条非空 assistant 消息、17,381 个实际分段页；title kinds 为 speaker 1,119、group 11、narration 7,986、unknown 8,265；302 个不可精确寻址页仍按 unknown 保留。9,116/9,116 个结构 evidence spans 均通过消息索引/hash、view/core window、页内分类 span 和原文 speaker span 的回放校验；解析耗时 P50/P95/max 为 0.01/0.03/2.52 ms，整轮 1.909 秒。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。这些数据验证分页口径、证据边界和本地开销，不构成全语料正确率证明；目前仍只有一个同聊天簇 14 页定向 pilot，整体准确率为 `INSUFFICIENT_EVIDENCE`。

14 页 pilot 的评分运行带有该聊天簇的发布角色名清单；只读 coverage 运行没有逐聊天角色清单。生产分段器会接收已发布角色名，因此两种输入可能得到不同的分段数量（本次分别为 17,382 与 17,381），不能把不同角色名 scope 下的页数或覆盖计数直接比较。当前全语料运行仍无法恢复每个聊天对应的发布角色名清单，故它不是所有剧本配置下的逐页生产复刻；未来要做按剧本准确率验收，gold 与 replay 必须绑定同一 chat 的 published-speaker scope。

### 最新活动剧本的可见标题缺失根因与修复

全量 `coverage-only` 的 `unknown` 原本表示“结构解析器没有产生标题 evidence”，不是“玩家前端最终显示未识别”。播放器原有分页段可能已经是 `narration`、带有效身份的 `dialogue`，或有结构解析器暂时不理解的 `dialogue`；这些经过 `getPresentationSpeakerLabel()` 后分别可能显示“旁白”、角色名或“未识别”。为避免把解析器 coverage 误报成真实 UI unknown，回放摘要字段已从 `titleKinds` 改名为 `structuralEvidenceKinds`。

只读诊断当前活动 release 与最新聊天（397 条 assistant 消息、10,663 个直接分段页、8 个当前视觉说话人 binding/pool 项）发现：基础页面标题有 541 页显示“未识别”；其中 227 页（225 个单人说话标题、2 个多人标题）已经有 source/hash/span 校验通过的结构标题 evidence，但底层 segment type 为 `dialogue` 且没有 identityRef，`isCurrentPageTitleEvidence()` 过去拒绝读取这类 display-only evidence。修复后，渲染器允许无 identityRef 的 dialogue 页显示严格验证过的 speaker/group 标题；portrait context 仍为 unknown，也不创建角色身份或修改分页。相同只读页面管线估算未识别降到 314 页，其中 265 页 source window 不可寻址、49 页仍需语义或额外归属证据；该估算不含 provider annotation，也不是浏览器截图验收或整体准确率指标。

同一聊天中紧跟在明确人物页之后的 unknown 不能一律继承前一人：抽查到的页面里包含明显的相邻角色轮流发言，直接沿用上一页会把新角色错误标成旧角色。当前可被底层精确续引号逻辑标记的页也没有表现为这一轮剩余 unknown 的主要来源；本轮修复优先展示当前页已有的精确归属 evidence，剩余 continuation 需继续按同消息、相邻 span、当前文本结构和上一页 speaker evidence 进行定向回测，不凭邻接关系猜人。该诊断只读历史、未写回聊天，也未调用 provider。
