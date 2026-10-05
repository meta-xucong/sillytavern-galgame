# Galgame 说话人归属与历史回放实施计划（2026-10-05）

> 状态：v7 本轮历史 smoke 已完成（2026-10-05）；最近 12 条稳定历史回放为 1 条有效注释、10 条 provider timeout、1 条 provider unavailable，平均/p95 延迟约 55,032/60,021 ms。v4 最近 12 条为 1 条有效、10 条超时、1 条结构无效；v5 去除重复 schema 后 12 条全部超时；v6 加入 strict schema 到 JSON mode 的有界恢复。v7 加入最少最大连续片段提示、重复锚点全序列唯一解、失败轨迹脱敏增强，以及首条请求体超限的确定性降级。定向回归通过；短句真实模型探针通过。播放器静态产物已由官方构建器从源码重建并检查入口语法。没有人工 gold，分类准确率仍为 `INSUFFICIENT_EVIDENCE`，production mode 保持 shadow。
> 范围：提升可见剧情文本的段落类型与说话人归属，并用本机历史聊天进行只读回放。
> 权威：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`docs/GALGAME_DESIGN_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`。
> 继承：`docs/GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md` 与 `docs/GALGAME_PRESENTATION_PROJECTION_IMPLEMENTATION_PLAYBOOK.md`。本文件只补足说话人标注输入、旧呈现回退和历史评估，不重定义其 DTO、身份 resolver、视觉 catalog、状态投影或生产 gate。

## 1. 目标与不做事项

让一条 SillyTavern assistant 消息里的旁白、一个或多个角色对白、未知说话人对白、标题/状态/选项被语义正确分段；每段可以回指原始可见文本的精确范围。重点解决“明明有角色发言却被显示成旁白”，并为后续精准头像绑定提供经过校验的 speaker reference。

本阶段不改写或迁移聊天，不改 SillyTavern 生成语义，不读取隐藏 prompt、思考内容、角色卡/世界书正文，不更换故事生成模型，不生成剧情，不更新玩家状态或 roster，不扩大/改变全局 production gate，不编辑任何 SillyTavern 原版文件。

历史数据只读。任何原文样本都不得进入仓库、公开 PR、自动化测试 fixture、提交信息或普通日志。实际回放的唯一输出为本地临时评估数据和不含原文/聊天文件名/聊天 ID/密钥的汇总指标。

## 2. 已确认根因与当前边界

1. SillyTavern 的一条 assistant 消息只有消息级作者标签。Dungeon Master 等标签表示生成该消息的角色/通道，不代表正文里每句话的说话人；把它直接当逐句 speaker 会抹掉角色轮换。
2. 玩家 UI 当前的旧切段器以确定性启发式扫描可见文本。新说话人、动作夹对白、混合叙述和无署名引语没有可靠规则时会落入 `narration`，于是头像和标题一起错误。
3. 已有语义 annotation、证据 span、身份 resolver、缓存与 gated renderer，但 `PRESENTATION_ANNOTATION_MODE='shadow'` 且 `PRESENTATION_GATE_REPORTS` 为空；所以模型结果目前不驱动玩家标签。仅看到 analyzer 健康或 API 返回 200，不能称 UI 分类已修复。
4. 当前调用会从 active manifest 构造最多 32 个闭合 `knownEntities`；本阶段已先修正过去空 cast 输入。名称上下文只能帮助候选定位，不可单独证明谁在说话，也不能将未发布人物升级为发布角色。
5. 已复现的根因是标注合同表达能力不足：原 validator 要求每个 segment 的 speaker evidence 完全落在该 segment 内；但自然句“米拉说：‘你好。’”中，人物提及和署名动词位于 narration segment，spoken words 位于另一个 dialogue segment。若合并两个段以满足 validator，会把叙述误标为对白；若如实分段，validator 会拒绝整条结果。分析服务对该类无效输出重试，最终耗尽 60 秒请求期限，shadow UI 继续使用旧切段器，陌生对白因此落成 narration。
6. 复现证据（不含正文）：早期 analyzer scope 为 `doubao-seed-2.0-lite:presentation-annotator.v1`；最近 12 条请求全部 `ANALYZER_TIMEOUT`，provider latency mean/p95 约 60015/60021ms，`sourceUnchanged=true`、`chatWriteback=false`。本地 v2 合成署名请求复现 speaker span 被错误要求局限在 dialogue segment；允许同一原消息内的署名证据跨 segment 后，v3 合成请求仍因段落 offset/coverage 输出被拒绝。旧 provider DTO 还要求模型复制源消息索引、消息哈希和 segment 哈希，这些字段应由服务端确定性生成，不能成为语义模型的任务。安全日志只记录 request UUID、错误类别、固定验证类别和计数，不记录正文、原始校验路径、token 或异常原文。
7. 已有语义合同要求未知对白与旁白分开，并要求 segment 覆盖原文 100%。所以“改成更多正则”不是可接受修复；本阶段修正可表达性缺陷并保留确定性校验与 unknown-safe 解析。
8. 本轮健康接口实际显示 analyzer scope 为 `doubao-seed-2.0-lite:presentation-annotator.v7`，即独立视觉/呈现分析配置，不是 SillyTavern 的 Claude 剧情生成模型。换故事生成模型不会自动切换此分析器。稳定 12 条历史 smoke 仅 1 条得到有效结构化注释，10 条超时、1 条不可用；这里衡量的是 analyzer 可用/结构接受覆盖，不是归属准确率。
9. 终审还发现实际 `public/game` 一度落后于 player source：旧静态入口将明文聊天文件名作 `chatKey`，把消息级 speaker 写进 `authorLabel`，且未传已发布角色实体。现已用项目构建器从 canonical `frontend/player/src` 和 `frontend/shared/src` 重建 `public/game`；source 与静态请求路径对齐，并通过静态审计。此修正只保证 analyzer 收到合约要求的输入，不代表 shadow 结果已用于玩家画面。

本机 `GET /v1/health` 曾报告 presentation analyzer 已配置，scope 为模型标识 `doubao-seed-2.0-lite` 加提示版本；该凭据和酒馆剧情生成凭据是不同服务配置。本阶段只通过本机 presentation-analysis-service 调用这个已配置分析器，不读取、复制或打印其密钥。每次回放开始前仍须重新检查健康状态和 analyzer scope；scope 变化要作为新的评估运行，不与旧结果合并。

当前历史的只读基线：对活动聊天最近 12 条非空 assistant 消息调用现行 legacy parser，得到 367 个显示段：335 个标为 narration（91.3%）、32 个标为 dialogue、0 个 `unattributed-dialogue`。这是旧 parser 的**输出分布**，没有 gold 标签，不能解释为 91.3% 错误率或成功率；实际分类准确度须按 §4 人工 gold 重测。

## 3. 冻结方案

### 3.1 语义分析输入

- `knownEntities` 由当前已发布 manifest 的 `resourceBindings.characters` 构造，与 `buildPresentationProjectionState()` 使用同一权威 cast：`resolverEntityRef` 为 `published:<id>`；`visibleNames` 只包含 `displayName || name || id` 与明确发布的 aliases；`attributes` 初期为空；`evidenceDigest` 是上述公开绑定字段的稳定摘要。不能从视觉 asset 的文件名或 `visualBindings` 另造角色身份。
- 对模型请求中的 `authorLabel` 固定传空串：它是消息级生成通道，不是正文 speaker，当前任务不需要它。`scope.chatKey` 必须是同一 chat/replay 生命周期内稳定的不透明值：player 侧以 `chat_` 加 namespaced 本地 chat 指针的 SHA-256 派生，回放 CLI 每次运行创建一次 UUID；不得每条消息/每次请求重建，也不得把本地文件名/路径发给 analyzer。每个 HTTP annotation 请求的 `requestId` 单独随机生成。annotation service 在调用外部 analyzer 前从 provider payload 中完全移除 `requestId` 和 `scope`，仍在本地用原始 request 校验 response。原始 chat 文件名只留在本地缓存和时间线校验中。
- 严禁把角色卡正文、世界书、私密聊天元数据、asset URL、图片 ID、密钥或管理员配置放进 analyzer 请求。不得用临时出现的名字扩充“发布角色”清单。
- 只有当前 release / arc 的 binding 可进入该请求；角色 binding 超过协议容量时以确定性排序取前 32 项并记录 `known-entity-cap`，不得随机截断或改变 speaker label。
- player 必须先通过 shared adapter 构建最终请求批次，再使用该批实际裁剪后的 `contextDigest` 和 `analyzerScope` 查写注释缓存；对未命中消息只从已校验请求中替换 message 列表，adapter 接受并复验该 exact prepared request，不能重新筛选 cast 或 context 后沿用旧 digest。
- prompt 明确规定：即使将来存在非空 `authorLabel`，它也不能自动成为任何内嵌台词的说话人。

### 3.2 通用标注指令

在现有固定 system prompt 上做一次版本化升级，说明这是只读文本分类，不是故事续写。对输入正文按当前协议输出精确、连续、无重叠的 source spans，并按证据区分：

- 有直接话语/明确话语行为及可指认 speaker：`dialogue`，speaker 必须由同一原消息中的可见证据支持；署名/话语行为子句可以位于 dialogue segment 之外，并通过 `purpose=speaker` span 精确引用，且该 span 必须覆盖人物提及。不能为满足校验把 narration 合并进对白。未发布的新人物可成为本消息 person mention，但不得由模型分配稳定 ID。
- 确有角色发言但正文无法确定是谁：`unattributed-dialogue`，不可以因为名字不在已知名单里而判成旁白。
- 叙述者描述、动作、场景描写：`narration`；引号不是独立充分证据，引用文本、内心转述、标题不得机械判成角色对白。
- 章节标题、战术标题、状态面板、选项、系统说明按现有 schema 使用 `other-visible`、`status`、`choice` 或 `stage-direction`，不得把标题/小标题当人物名或状态事实。
- 一段正文中说话人改变时拆成多个 source segment；延续同一未闭合引语由既有 same-message quote-continuity 兜底处理，跨消息不得只靠引号状态继承身份。
- 对任何无法从可见原文支持的角色、性别、种族、状态或因果关系输出 unknown/unresolved；不给模型自报 confidence 作为显示或资产自动绑定的独立门槛。

保留浏览器 annotation v1 请求/响应、span hash 校验、实体引用校验、受限重试、超时和日志脱敏机制。provider 内部使用闭合的 `galgame.presentation-analyzer-candidate.v1`：逐字返回每个 segment 起点两侧相邻的短原文锚点、evidence quotes 与语义实体；不复制整段正文，不生成数值 offsets、source index 或 hash。首边界绑定原文开头；其余锚点可在文本中分别重复，但完整锚点序列必须存在且只存在一个严格递增的放置方案。服务端据该唯一序列派生连续覆盖；若存在零个或多个方案即 fail closed。锚点匹配使用线性算法和候选上限，避免高重复文本造成高 CPU；模型须在全序列仍歧义时加长锚点。证据和实体引用仍须精确落在原文，speaker evidence 必须覆盖实体 mention。服务端据证据确定性生成 Unicode code-point offsets、源消息索引/哈希和 segment 文本哈希，最后运行现有 annotation v1 validator。该 internal candidate 不是剧情生成协议，不改变前端 DTO、玩家行为或 SillyTavern 运行语义。当前 prompt scope 为 `presentation-annotator.v7`，使旧缓存失效。提示要求用最少的最大连续片段：同一功能的叙述、同一说话人的连续对白不因句号或标点拆分。OpenAI-compatible provider 使用 strict `response_format.json_schema` 时，从 system prompt 中去掉同一输出 schema，避免重复输入；若上游拒绝 strict schema，JSON-mode fallback 只在 system prompt 中附加一次 schema。若上游接受 strict mode 但返回值未通过本地 candidate validator，最多在同一总 deadline 内切换一次 JSON-object mode，并在 system prompt 中附加单份 schema 后重试；本地严格 validator 始终是最终权威，重复失败即 fail closed。provider 失败日志只记固定验证类别、耗时和白名单错误类型/状态码，不记录模型控制的引用值、请求正文或异常原文。此项只改变 analyzer 内部 provider 请求与缓存 scope，不改变浏览器 DTO、剧情生成协议、玩家行为或 SillyTavern 运行语义。若需要改变浏览器请求/响应 DTO、schema version 或 player-visible behavior，本计划即失效；先修改基线规范并重新审计。

### 3.3 呈现与失效回退

- shadow 继续用于收集/对比分析结果，不能宣称已经改善真实 UI。
- 本阶段不改 `PRESENTATION_ANNOTATION_MODE`，不增加 language allowlist，也不改变跨剧本生产门槛。
- 若未来在独立 gate 通过后使用 assisted，分析服务不可用、模型输出校验失败、时间线/hash 不匹配时，只能显示完整未篡改原文和中性未知身份；不得把失败结果交回已知会将漏识对白归为旁白的旧切段器。
- 当前可见 UI 行为与 production gate 的任何调整，须先更新本计划引用的两份产品基线及本身份规范，再进行独立审计。

## 4. 历史回放和成功率定义

### 4.1 数据保护与样本选取

新增只读 replay 工具只能从显式指定的本地 SillyTavern JSONL 聊天快照读取消息；realpath 必须仍在 `data/default-user/chats` 根目录之下，并拒绝从文件系统根到 chat root 和目标文件之间的任一 symlink/junction/path escape。必须用合成临时目录测试普通越界路径、父目录穿越、聊天 root 自身 symlink、root 内目标 symlink 和 dangling symlink；所有情况均须在读取文件内容前拒绝。只读 `mes` 可见正文与必要的消息索引/role；忽略首行 metadata、备注、swipe 未选版本、隐藏字段和空 assistant 消息；正文以现有 `formatVisualNovelDisplayText` 规则形成玩家实际可见的文本。工具不得调用生成接口、写回聊天/存档、重命名/复制原聊天、遍历非目标目录或输出原文。

回放默认取最近最多 12 条非空 assistant 消息做 smoke；若指定本地私有 gold sidecar，则必须按 sidecar 的 exact source index/hash 选取样本（包括最近 12 条窗口之前的历史消息），任何缺失 index 或 hash mismatch 都在外部分析前 fail closed；绝不悄悄取交集缩小评分分母。评估集先按消息分层抽样，涵盖自然对话、动作夹对白、多说话人段落、新角色首次出现、无署名引语、纯旁白、标题/状态/选择、拒绝/模糊样本。不得让同一聊天的相邻重复 swipe/备份作为独立样本。

将原文发送给已配置 analyzer 属于外部模型处理。回放工具必须要求明确的 `--confirm-external-analysis` 选项，默认 dry-run；UI 和测试不会自动回放整部历史。运行说明显示目标消息数和 analyzer scope，但不显示正文、密钥、URL query 或聊天名。

### 4.2 Gold 与指标

模型输出分布不是“成功率”。准确率只针对人工复核的 gold segment 计算；gold sidecar 含消息 hash、code-point span、类别、speaker ref/unknown，绝不内嵌正文。由一名 reviewer 初标，另一个独立 reviewer 复核不一致项；本轮无法双标时明确标注为单人 adjudication，不能伪称双标。

评分采用 Unicode code-point 级对齐。对每条 source message，预测与 gold 必须引用相同 message hash 和相同的格式化可见文本。先计算 `sourceCodePoints = Array.from(sourceText)`；此后所有 `start/end` 都是 code-point 数组下标，完整覆盖范围为 `[0, sourceCodePoints.length)`，严禁用 JavaScript `String.length` 或 UTF-16 substring 计算偏移。对每段按 `sourceCodePoints.slice(start, end).join('')` 重建文本并校验 `textHash`，段落按 start 升序且无空洞/重叠，拼接后必须逐 code point 等于 source text。任一条件失败则该条 source message 标为无效；它不能从成功率分母中删除，归属类指标按其全部非空白 code points 计为错误，span 覆盖率记为 0。

每个非空白 code point 映射为 `narration`、`dialogue:<canonicalGoldEntityKey>`、`unattributed-dialogue` 或具体的 `other-visible/status/choice/stage-direction` 类型。speaker 引用按以下闭合规则标准化：已发布的 `resolverEntityRef` 只可通过本轮冻结的发布 manifest ID → gold entity key 映射；临时/新人物 speaker 只可通过 gold sidecar 预先标注的显式 mention span 和 annotation 输出中经 validator 接受的 identity link 映射。没有唯一显式映射、未知 speaker、冲突 link 一律视为 speaker 不匹配；禁止用名字相似、别名模糊匹配或模型 confidence 推导正确身份。不同 segment 边界可以对齐，因为计分单位是同一 source text 的 code point，不使用 IoU 阈值。

对齐后，记 `C` 为预测与 gold 类别一致且 canonical speaker key 也一致的已归属 dialogue code points；`P` 为预测为已归属 dialogue 的 code points；`G` 为 gold 已归属 dialogue code points；`D` 为 gold dialogue 或 unattributed-dialogue code points；`N` 为 gold narration code points。计数公式如下：

- `speakerPrecision = C / P`；预测 dialogue 对应的 gold narration、other、unattributed 或错误 speaker 全计入 P 的错误项；
- `speakerRecall = C / G`；漏成 narration、other、unattributed 或错误 speaker 都不计入 C；
- `dialogueFalseNarrationRate` = gold dialogue/unattributed-dialogue 中被预测为 narration 的非空白 code points ÷ `D`；
- `narrationFalseSpeakerRate` = gold narration 中被预测为已归属 dialogue 的非空白 code points ÷ `N`；
- `unattributedDialogueRecall` = gold unattributed-dialogue 中仍预测为 unattributed-dialogue 的非空白 code points ÷ gold unattributed-dialogue 的非空白 code points；
- `predictedUnattributedDialogueRate` = 预测为 `unattributed-dialogue` 的非空白 code points ÷ 预测为 `dialogue` 或 `unattributed-dialogue` 的非空白 code points；这是模型 abstention 的预测侧比例，不能替代或抵消 `speakerRecall`；
- 每个其他 visible kind 的 per-kind recall = 该 gold kind 中预测 kind 完全相同的非空白 code points ÷ 该 gold kind 的非空白 code points。

任一分母为 0 时该指标报告 `null`，不得报告成 100%。每个 source message 的全部归属错误（包括无效预测、服务/模型失败、错误 schema 和缺失结果）都保留在相关 gold 分母中；无效预测的全部非空白 code points 按未命中处理。报告给 point estimate；本地 pilot 如有至少两个不同 script cluster，也给 script-cluster 95% percentile bootstrap CI。对每个指标单独取分母大于 0 的 script cluster，按 `scriptId` 的 Unicode code-point 字典序排序；令 `K` 为该列表长度。若 `K < 2`，CI 为 `null`。随机数状态在全部迭代开始前仅初始化一次为 `state = seed >>> 0`，并在 2000 次迭代及其全部抽取间连续推进；每次抽取执行 `state = (1664525 * state + 1013904223) >>> 0`，将 `state / 2^32` 乘以 `K` 后向下取整作为该次抽取的 cluster 下标；每次迭代抽取 `K` 次、有放回。合并被抽中 cluster 的分子/分母后计算比例。默认 seed 为 `20261002`，固定运行 `2000` 次；将有效比例升序排列后，下界取 `floor((n-1)*0.025)`、上界取 `floor((n-1)*0.975)` 对应值。因分母大于 0 的 cluster 才进入各指标抽样框，每次比例均有定义；报告每个 CI 的 eligible cluster 数。该本地 pilot 算法只用于探索，不声称等价于 production gate 的证据算法。本地 code-point 指标不能替代正式 gate；正式 production gate 的指标、报告和 bootstrap 必须完整复用现有 `frontend/shared/tests/presentation-golden-runner.mjs`，不得另造与其不兼容的 gate 计算。

至少报告：

- `spanCoverage`、span hash、原文重组一致性、schema validity；四项必须全量为 100%。

旧 parser 与 candidate analyzer 用同一 gold sample 对比 confusion matrix，至少呈现 `dialogue→narration`、`narration→speaker`、`known cast→unknown`、`new speaker→unknown` 四类变化。报告还应分别统计候选 analyzer 返回有效注释的覆盖率、服务/模型失败数、provider latency 及预测侧 `predictedUnattributedDialogueRate`；不能把失败样本从分母删除，也不能用高 unknown 比例掩盖 recall 不达标。

本地单剧本回放只用于修复当前案例和发现泛化问题，不能用于开放 production gate。最终 production gate 继续沿用身份规范：至少 5 部完整留出剧本、20 个独立聊天以及规定的分层样本数和置信区间；不满足就保留 shadow/unknown。

### 4.3 本轮迭代目标

1. 对同一个冻结的人工复核 gold sample，先回放当前旧 parser 和现有 candidate annotation，记录基线。
2. 只按错误类型修改通用 prompt、knownEntities/context 输入和必要的 schema validator；不得根据一个词/角色/某段剧情加 regex。
3. 每次改动 bump prompt/scope version、使旧 cache 失效，然后在完全相同 gold sample 回放；比较混淆矩阵和 latency。
4. 本地验收门槛：gold 样本中 speaker precision ≥97%，明确 speaker recall ≥90%，对白错判 narration ≤2%，narration 错判 speaker ≤1%；source spans/hash/覆盖率 100%；未知/新人物不会被错误映射到发布角色。未达到则继续迭代或明确阻断，不以“模型回答 HTTP 200”收口。
5. 达到本地门槛也不改变 production shadow 状态。最终结果要标明 gold 数、来源剧本数、review 方式和置信区间；单剧本指标只代表该样本。

## 5. 文件和所有权清单

| 文件/路径 | 任务 | 允许边界 |
|---|---|---|
| `frontend/shared/src/presentation-annotation.js` | 发布 cast → closed knownEntities 的纯函数与证据摘要 | 不加模型持久身份映射 |
| `frontend/shared/src/presentation-analysis-adapter.js` | 从最多 32 个已发布实体中优先选择当前消息/上下文命中的实体，每批最多 16 个；body 超限时按既有确定性降级规则缩减 | 遵循 playbook；不改 DTO、偏移或响应校验 |
| `frontend/player/src/main.js` | 构造当前 release 的已发布角色上下文并传给现有 analyzer | 不读 hidden ST data；不改生产 mode |
| `external-modules/presentation-analysis-service/server.mjs` | 更新通用分类 prompt/version；provider 用语义候选 DTO，服务端本地 materialize 索引/哈希并校验 annotation v1，保证 cache scope 正确失效 | 保持 loopback/provider adapter/日志边界；不要求模型计算哈希或源索引 |
| `frontend/shared/tests/presentation-annotation.test.mjs` | known entity 构造、alias、容量、私密字段排除测试 | 合成 fixture only |
| `frontend/shared/tests/presentation-analysis-adapter.test.mjs` | 验证第 17–32 项中被当前消息/上下文提及的角色可进入 16 项窗口，body 超限时仍会确定性降级 | mock transport only |
| `external-modules/presentation-analysis-service/test.mjs` | prompt 的 speaker/narration/unknown/标题规则合同测试 | mock provider，不联网 |
| `frontend/shared/tools/presentation-history-replay.mjs` | 只读历史回放 CLI，仅输出本地汇总或私有 sidecar 指定的指标 | 放在 AGENTS.md 允许的 `frontend/shared/**`；不调用故事生成 API；默认不发外部请求；不写聊天 |
| `frontend/shared/tests/presentation-history-replay.test.mjs` | 临时目录合成 JSONL、隐私字段剔除、gold metric、路径穿越/symlink escape 与损坏输入测试 | 不含真实剧情 |
| `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md` | 本阶段计划、迭代和真实回放证据记录 | 只记录汇总，不记录原文、文件名或密钥 |
| `public/game/**`、`public/game-admin/**` | 源实现通过 build script 产生的 player/admin app build | 不手改生成文件；不覆盖其他未提交用户 build，构建前后需比较清单/hash |

禁止编辑 `src/**`、`server.js`、`plugins.js`、`public/index.html`、`public/script.js`、`public/style.css`、原版 extensions、`config.yaml`、root manifests、启动脚本、chat/save 数据、private provider config、任何 key。

## 6. 执行清单与验证

### 文档审计（写代码前）

- [ ] 独立审计员只读对照三份权威产品文档、身份规范、本计划和 `AGENTS.md`。
- [ ] 确认本阶段没有重定义 DTO、生产 gate、原版资源权威或 player UI 行为；发现冲突先改文档并重新审计。
- [ ] 冻结允许文件、初始 dirty baseline、gold 标签策略与外部 analyzer 使用范围。

### 实现与单元验证

- [ ] 按 §5 顺序实现，先纯函数 + 合同测试，再 player/service 接线，再只读 runner。
- [ ] 测试 known cast、alias 去重、未知新 speaker 不污染 published cast、同名冲突、上限截取确定性、关闭 analyzer、错误 schema、提示注入正文、跨分页引语、中文/英文/日文和标题/状态对照。
- [ ] replay runner 路径测试明确包含根目录内读取成功、普通越界拒绝、`..` 穿越拒绝、指向聊天根外目录的 symlink 拒绝、根目录内目标文件 symlink 拒绝、dangling symlink 拒绝；失败必须发生在读取/解析目标聊天内容前。
- [ ] 运行：

```powershell
node --test frontend/shared/tests/presentation-annotation.test.mjs frontend/shared/tests/presentation-analysis-adapter.test.mjs frontend/shared/tests/presentation-cache.test.mjs frontend/player/tests/presentation-renderer.test.mjs frontend/player/tests/chat-history-recovery.test.mjs
node --test external-modules/presentation-analysis-service/test.mjs frontend/shared/tests/presentation-history-replay.test.mjs
node frontend/build-static.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules
git diff --check
```

- [ ] 在隔离的临时 chat 副本/合成数据上先验证 replay tool 不写原始 JSONL、不会序列化 header metadata，不联网；再由操作者明确允许时用真实本地消息和本机 analyzer 做少量回放。
- [ ] 对真实 history 只读提取最新 12 个非空 assistant 消息做模型 smoke；再用人工复核 gold sample 逐层迭代，运行前后都核对当前 chat SHA-256 未变、原聊天/存档写入计数为 0。
- [ ] 重新 build 后实际 `public/game` 必须与源代码一致；不自动 merge、覆盖或删除 workspace 中已有未提交文件。

### 最终独立审计

- [ ] 固定精确 diff/hash 后由不同审计员检查 source freeze、输入边界、无私密上下文泄露、失败/超时 unknown-safe、回放无写入、gold 指标和报告诚实性。
- [ ] 独立审计必须 `PASS`；任何真实模型指标须包含实际 analyzerScope、sample count 和 gold review 方式。`ROUTE_UNVERIFIED` 作为单独提示；不得声称 provider 使用了剧情生成 key。
- [ ] 若样本太少或人审未完成，代码测试可通过但分类成功率判定为 `INSUFFICIENT_EVIDENCE`，production mode 继续 shadow；不得把任务写成完全修复。

## 7. 当前执行状态

- 文档：provider quote-anchor candidate 与浏览器 annotation v1 的边界已写入本计划及产品基线。v7 连续片段和唯一有序锚点规则没有改变对外契约。
- 代码：speaker evidence validator、quote-based candidate materialization、服务端 metadata derivation、exact-request cache、gold exact-target、replay file-handle identity check、受限并发 replay、structured-output schema 去重/fallback、唯一有序锚点解算、请求体超限缩减与脱敏诊断已实现。独立实现审计及最终静态审计均为 `PASS`。审计发现的 player 入口 `sha256Hex` 重复绑定已改为复用 shared helper；源码和静态入口均通过语法检查。官方构建器仅重建 `public/game`；静态入口在规范化构建路径/版本查询后与源码 6,479 行一致，speaker 请求仍传匿名 chat key、空 authorLabel 和已发布实体，annotation mode/schema 保持 `shadow` / v1。
- 数据：旧 v1 最近 12 条回放全部超时；v3 的合成回放曾出现 offset/coverage 拒绝；v4 最近 12 条真实历史回放仅 1 条有效、10 条超时、1 条结构无效，provider latency mean/p95 约 56,966/60,011 ms；v5 最近 12 条真实历史回放全部超时；v6 最近 12 条回放 0 条有效、11 条超时、1 条结构无效，provider latency mean/p95 约 59,972/60,022 ms。v7 对同一最近 12 条稳定历史窗口回放得到 1 条有效注释、10 条 `ANALYZER_TIMEOUT`、1 条 `ANALYZER_UNAVAILABLE`，provider latency mean/p95 约 55,032/60,021 ms。真实聊天文件回放前后摘要一致且无写回；一次针对当时仍在变化的活动聊天回放因源摘要变化而安全中止。没有人工 gold sidecar，因此所有这些都不是分类准确率。
- 效率诊断：最近 12 条可见 assistant 文本总计 27,471 code points，中位数 2,242、p95 2,798、最大 3,140；仅 1 条超过 3,000，均未超过 5,000。v5 schema 去重后仍为 12/12 超时；v6 的 1,732 code point、无上下文历史单条探针耗时约 60 秒并超时。短 synthetic 有真实服务有效响应（39 code points、12,360 ms、两类片段且一段有 speaker），但这是链路/合同 smoke，不是历史准确率。v6 观察到一次 strict schema 无效输出耗时约 38 秒后切 JSON-mode，第二次仅剩约 21 秒并超时；故 v7 补充最少最大连续片段及有序锚点指令。现有样本不支持“单纯因为全部历史上下文过长”的解释，不能用它推断分类正确率。
- Gold：当前没有可用的人审 gold sidecar。即使 v7 返回有效结构化结果，也只能验收 provider 可用性、结构完整性、覆盖率和延迟；本轮有效注释覆盖只有 1/12，分类准确率仍标记 `INSUFFICIENT_EVIDENCE`。不得用模型自评、类别分布或未标注的 12 条历史冒充成功率。
- Production：当前仍为 `shadow`，gate 表为空；不可称玩家 UI 已接入新分类器或分类问题已完全修复。播放器静态包恢复了源码一致性，但本阶段 shadow 只观测标注器输出，不会修正当前玩家看到的归属显示。
