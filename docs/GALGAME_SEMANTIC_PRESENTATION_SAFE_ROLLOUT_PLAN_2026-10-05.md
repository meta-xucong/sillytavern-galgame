# Galgame 语义呈现闭环改造计划（2026-10-05）

> 后续用户指令（2026-10-05）：将唯一活动语言 `zh-CN` 的语义呈现切为 `assisted` 试运行并回测。此决定覆盖本文原先“gold gate 前不得进入 assisted”的默认 rollout 决策，但不改变 gate 指标、不填充或伪造 gate report、不宣称准确率通过；其他语言仍受 gate 控制。只有经现有合同完整校验的 annotation 可进入 UI，失败仍 unknown-safe。试运行每个 cursor 最多分析其之前的 12 条非空 assistant 消息，不分析未来消息；窗口外页面按需回看。用户指令后的实际回测证据与结果应追加在第 8 节。

## 1. 任务合同

### 目标

纠正“语义结果未进入玩家画面、旧启发式把不确定内容降为旁白”的断链，建立可审计、按证据逐步启用的说话人/文本类型呈现路径。默认 rollout 在对应语言的真实金标准报告通过既定 gate 后才启用；本轮依用户明确要求，对当前 `zh-CN` 发布作未验证 assisted 试运行，并继续按 gold gate 独立衡量准确率。

### 非目标

- 不改写、迁移、清理或生成 SillyTavern 聊天/存档正文。
- 不修改 SillyTavern 原版代码、配置、路由、扩展或启动脚本。
- 不将故事生成模型、视觉资源匹配器和展示语义分析器合并成同一个 provider/凭据。
- 不添加剧本专属词表/正则分类、新剧情协议、前端权威 roster/状态或离线故事回退。
- 不修改 production gate 阈值，不伪造人工标注、模型运行报告或准确率。
- 不因本轮静态构建而中断/重启玩家当前会话。

### 硬约束

1. 按 `AGENTS.md` 与 `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`，只允许上层工作；原版 SillyTavern 源码绝对只读。
2. `PRESENTATION_GATE_REPORTS` 保持为空；仅 `zh-CN` 通过明确的用户试运行 allowlist 进入 `assisted`，不把该例外记作 gate 通过；其他语言没有有效 gate 时继续 `shadow`。
3. 新/未识别/无归属内容必须保留原文，不能因解析失败变成“旁白”、既有角色或新的稳定实体。
4. 只有有效、版本/hash/时间线匹配的 assisted 注释能为已归属角色段提供 `identityRef`；头像、Roster 和状态只是只读派生投影。
5. 文本展示、场景连续性、说话人/实体分析、身份解析和视觉资产选择保持分层；任何一层失败不得伪造另一层结果。

### 基线和边界

- 起始 HEAD：`c59b194f6f8ebb663f2cd24a5fdc257cc5ec93e9`（工作区干净）。
- 允许的写入路径：本文件；`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`；`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`；`docs/GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md`；`frontend/player/**`；必要的 `frontend/shared/**` 测试/合同；`public/game/**` 仅由项目构建器生成。
- 本轮经源码与运行日志定位，额外授权只改 `external-modules/presentation-analysis-service/server.mjs`、其 `test.mjs` 和 `README.md`：provider 同 key/model 的小请求可在约 1 秒级返回，而 dense visible-text 请求常达 60 秒 deadline；根因是高密度、多说话段候选单次生成和旧单条超长 context 预检，不是 story runtime/key。内部注释分析可采用有硬上限的 code-point core tiles；每片本地校验后只合并到既有完整 Annotation v1。公开 DTO/schema/version、scene-continuity、gate 与故事生成运行时均不变。provider 超时不能通过更换密钥或模型掩盖。
- 任务分类：D1→D0（Think解决了切片/证据合并是否安全的设计歧义）；I2（切片合并须保持 code-point evidence、mention refs 与完整覆盖不变量）；A2（增加外部模型调用会增加请求成本，需调用数与总时限硬上限及独立严格审计）。
- 路由证据：本任务使用的子代理调度不能提供可独立验证的模型/effort 运行元数据时，记录 `ROUTE_UNVERIFIED`；不得声称按指定 profile/model 执行。

## 2. 代码现状与根因

1. 原始基线（用户批准 `zh-CN` assisted 试运行之前）：`PRESENTATION_ANNOTATION_MODE` 为 `shadow`，`PRESENTATION_GATE_REPORTS` 为空。该历史状态只描述旧 parser 的生产行为；当前 `zh-CN` 设置以本文开头的用户覆盖和第 8 节回测记录为准。`shadow` 分析结果只作观测/缓存，不改变玩家 label；`assisted` 才会构建投影并重新渲染。
2. `createPresentationPagesForMessage` 在 `assisted` 以外仍调用 `createVisualNovelDisplaySegments`。该 parser 依赖格式、已知人物表和启发式分类；无法识别时返回 narration。因此新角色/混合叙述的错误不是“语义模型判断为旁白”，而是生产页面继续使用旧 parser 的默认分类。
3. `unattributed-dialogue` 与 `narration` 在版本化 annotation 合同里是不同类型；旧显示路径却不能在所有歧义情况下可靠区分它们。继续添加局部正则不构成通用修复。
4. 历史 v7 回放曾得到 12 条中的 1 条有效 annotation、10 条超时、1 条不可用；无人工 gold，无法报告分类准确率。即使把模式设成 assisted，也没有依据跳过既有 gate。
5. SillyTavern 提供消息级作者，不提供正文中每句说话人标注。其行为不是本改造可以通过修改原版代码解决的问题。

## 3. 目标行为

### 3.1 Gate 前（shadow/off/无有效注释）

本节适用于未列入用户指定试运行 allowlist 的语言，及任意语言的无效/缺失/超时注释。当前 `zh-CN` 有效注释按本文顶部的试运行覆盖处理。

- `player` 消息继续标为玩家。SillyTavern `is_system` 消息由既有 adapter 排除，不进入玩家显示或语义分析；视觉 catalog 的 `system` channel 不代表未知说话人。
- assistant/character 可见正文完整保留，说话人标题为中性“未识别”，身份为 `unknown`，不由 legacy parser 猜测 narrator、角色、新身份或对白边界。显示格式化器已有的完整段落边界可作为 display segment 边界；每段保留连续、无重叠、全覆盖的 source span。不得仅为凑 code point 长度切开单一段；单段超过软上限时完整显示。display segment 边界不是语义或身份边界。
- unknown/unattributed 使用独立内置中性几何问号占位，不读 `character|player|narrator|system` 人物资源 channel，不生成角色视觉候选或写头像账本；允许按现有独立证据合同继续运行 scene continuity 与非人物 HUD 决策，不得因此推导说话人/人物头像。该占位不能和旁白省略号或 system channel 共用。
- 不以未知文本触发角色实体属性、Roster 加入/离队或角色状态变更。
- 继续后台 shadow 分析，但其返回不得改变显示；这样代码与 gate 含义一致。

### 3.2 Gate 后（仅 gate 报告许可的语言）

- 仅使用严格校验并与当前完整时间线匹配的 annotation/projection 产生 narration、dialogue、unattributed、status、choice、stage-direction 等段。
- renderer 映射必须闭合：已归属 `dialogue` 显示对应身份/角色头像；unknown speaker 或 `unattributed-dialogue` 显示“未识别”和独立 unknown 占位；`narration` 显示“旁白”和旁白符号；`player` 显示“你”并使用玩家 channel；`stage-direction` 显示“动作”，`status` 显示“状态”，`choice` 显示“选项”，`other-visible` 显示“正文”，这些非说话段只用独立中性 unknown 标记，不获得角色身份/角色头像；原版 `is_system` 消息不进入 renderer。
- analyzer 不可用、响应非法、cache/hash/source timeline 失效时，回退到 3.1 的完整原文与 unknown，不回退到旧 heuristic parser。正文只有在有效 annotation 明确分类为 `narration` 时才显示旁白；旁白资源 binding 仅在正文已被分类为 narration 后决定使用哪一资源，不得用资源 binding 反推正文类别。
- 新人物可作为 chat-local identity；没有明确证据时仍是 unknown；任何头像匹配仍需要独立的视觉证据和一对一账本。
- 跨页引语只继承已经验证身份的同消息连续片段；引号闭合本身不创建身份。
- Roster 只从有效的可见聊天 projection 派生；完整性不足或有冲突时保留 unknown/待确认，不作静默移除或臆造加入。

### 3.3 场景背景

场景地点切换仍只由独立 `scene-continuity.v1` 证据产生。文本改成 unknown fallback 不代表地点变化，不应清除已验证背景或触发随机匹配。

## 4. 实施清单

| ID | 文件/模块 | 改造 | 验收证据 |
|---|---|---|---|
| I-1 | `frontend/player/src/presentation-renderer.js`、`frontend/shared/src/sillytavern-adapter.js` | 新增 renderer-neutral 安全 fallback segment 构造器；character 使用连续、全覆盖分页和 `unknown` identity；annotation quote continuity 复用现有引号扫描器，仅在已验证身份、引号未闭、同消息/同哈希/连续跨度条件成立时延续，不覆盖 narration 类型或闭引号后的非空后缀 | 单元测试覆盖角色/玩家、空文本、Unicode code point、跨度连续及原文无损；引号延续正例，以及 closed/no-quote/narration/suffix/hash/message/span-gap 负例 |
| I-2 | `frontend/player/src/main.js` | 非 assisted 的 character 显示改用安全 fallback；删除 character production path 对 `createVisualNovelDisplaySegments` 的依赖；闭合所有 annotation 类型到标题/视觉 channel 的映射；unknown 不生成角色视觉候选/头像请求，但保留独立 scene continuity 和有证据的非人物 HUD 请求 | 集成级纯函数/调用链测试；明确证明 shadow annotation 不进入 UI、unknown 不带 character entity |
| I-3 | `frontend/player/src/assets/unknown-speaker-placeholder.svg` + player tests | 增加与 narrator/system/player 分开的内置中性 unknown 符号；测试 unknown 不读取人物 channel 或创建角色候选，同时 scene/HUD 仍按原证据合同运行 | 构建产物存在；channel 路由测试通过 |
| I-4 | `frontend/shared/tests/sillytavern-visible-chat.test.mjs`、相关 player tests | 验证 SillyTavern `is_system` 消息由 adapter 排除；renderer 覆盖 player、unknown、narration、unattributed 及所有非说话可见段 | `node --test` 定向测试通过 |
| I-5 | `frontend/tools/static-architecture-audit.mjs`（仅当现有检查漏掉此不变量） | character renderer 不得调用 legacy semantic parser；保持 gate table 空，且只允许明确列出的 `zh-CN` 实验 allowlist 进入 assisted | architecture audit PASS；其他语言仍必须通过 gate |
| I-6 | `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`、本专题实施规范 | 写明 gate 前 unknown-safe 玩家行为、用户指定 `zh-CN` assisted 试运行、独立 unknown 占位、语义类型映射及指标限制 | 文档明确区分“试运行启用”和“gold gate 通过”；unknown 不冒充旁白 |
| I-7 | `public/game/**` | 用官方 build 从 canonical frontend 生成；不可直接手改产物 | build 成功、源码/构建产物版本一致 |

若实施中发现某条既有测试期望 production 使用 legacy 分类，该测试须分清“parser 自身的历史单测”与“玩家生产渲染行为”；不得为了通过测试移除 legacy parser 的合同单测，也不得让其重新进入生产路径。

## 5. 测试和证据计划

### 自动化

1. 语义合同/投影/gate：`frontend/shared/tests/presentation-annotation.test.mjs`、`presentation-projection.test.mjs`、`presentation-gate.test.mjs`。
2. 页面与安全 fallback：`frontend/player/tests/presentation-renderer.test.mjs`、新增的 player render-path regression test。
3. 原版消息 adapter 回归：`frontend/shared/tests/sillytavern-adapter.test.mjs` 和 `sillytavern-visible-chat.test.mjs`；确认 `is_system` 消息被排除。旧 parser 可保留隔离单测，但 character production UI 不得调用它。
4. 静态/构建：`node frontend/tools/static-architecture-audit.mjs`（按工具支持方式调用）与 `node frontend/build-static.mjs`。
5. 仅当失败诊断需要时增加最小相关测试，不做与本任务无关的全仓测试。

### 历史回放与真实验收

- 原历史文案 replay 必须只读；调用前后核对源聊天文件 identity/hash；任何活动文本变化立即中止；绝不保存 annotation 到聊天正文或 JSONL。
- 只有人工 gold 的样本才能评分；模型自己输出、类别分布和 parser 输出都不能作为 gold。
- 当前已知 12 条 replay 无 gold，不能满足生产 gate；本轮不得凭 synthetic smoke 提升 production mode。
- 真实页面检查只确认 build 被加载、未归属正文完整、错误 narrator/avatar 消失、页面/输入/背景连续性没有副作用。真实分析准确性仍必须由 gate corpus 和可信模型运行报告证明。

## 6. 验收与放行

### 可接受的代码质量结果

- 原文可见字符完整、顺序不变；SillyTavern chat/save 数据零写入。
- `zh-CN` 有效注释进入 assisted；无效、缺失或超时文本显示为完整 unknown channel，不由 heuristic 报成 narrator 或绑定错误角色头像。其他无 gate 语言继续 unknown-safe。
- `player` channel 不串入角色身份；unknown 不产生 chat-local stable entity、avatar reservation、state/roster claim；unknown、narrator、player 和 system 各走隔离的资源路径。
- assisted 的 `dialogue`、`narration`、`unattributed-dialogue`、`stage-direction`、`status`、`choice`、`other-visible` 均有确定标题和视觉策略，不能回退到消息作者名；`system` 消息在 adapter 层被排除。
- 未启用语言的 shadow 分析/注释结果没有 UI 侧效应；`zh-CN` 用户试运行消费有效 assisted 注释。所有 assisted 失败分支仍 unknown-safe。
- scene continuity、输入、历史、分页及 build 没有回归。
- 独立文档审计和实现审计为 PASS，定向测试、架构审计、官方静态构建均通过。

### 不能宣称的结果

除非存在该语言且匹配本次 model/prompt/resolver/schema 的已验证 gate report（要求 500 个明确 speaker 段、200 个 narration/unattributed 对照、至少 5 个完整留出剧本和 20 个独立 chat，以及规范规定的置信区间指标），不得声称语义模型已准确分类、玩家 UI 已达到自动 speaker attribution 的 production 标准或已完全修复。

如果代码测试通过而真实 gate 缺失，代码阶段可以 PASS，但用户要求的“语义分类达标”仍为 `INSUFFICIENT_EVIDENCE`，不得把阶段标记为完整交付；需要继续收集/人工审阅真实 gold corpus 与 analyzer 运行证据。

## 7. 独立审计检查表

- 文档行为与 `GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` 及身份投影规范一致；冲突时以上位规范为准。
- unknown fallback 不丢字符/不改剧情，不等于将全部 assistant 文本断言为对白或旁白。
- legacy parser 是否仍被任何生产 UI path 调用；仅保留隔离测试/历史兼容逻辑不算生产调用。
- player/system/narrator/character visual channels、头像唯一性和 scene continuity 的 negative paths。
- async response、切 chat、swipe、edit、timeline/cache/hash mismatch 不会复活旧身份 projection。
- gate 为空仍不得声称通过 production thresholds；`zh-CN` 试运行由用户指令单独授权，没有凭 synthetic 或模型自评制造 gate。
- source freeze、聊天数据只读、secret 不出现在 diff/log/evidence。
- 测试覆盖和未完成的 analyzer 延迟/准确率证据必须在结论中分别报告。

## 8. 本任务放行状态

按用户指令进入 `ZH_CN_EXPERIMENTAL_ASSISTED`。本次 12 条真实聊天快照回放得到 0 条有效注释、10 条超时、2 条请求无效，mean/p95 约 50,014/60,021 ms；活动聊天没有写回。代码测试（34/34 + template matrix 1/1）、静态构建和架构审计通过。历史样本没有人工 gold，准确率仍是 `INSUFFICIENT_EVIDENCE`；当前有效注释覆盖为 0%，因此只能验收开关已打开和 fail-closed 回退，不能称识别功能达标或 production gate 通过。试运行每次只回溯当前 cursor 前最近 12 条非空 assistant 消息，避免对 302 条聊天逐条排队分析。

### 2026-10-05 dense-message latency correction

- 初始源码与日志证据：低复杂度同配置探测成功；annotation provider trace 显示 dense 样本在旧单次请求路径反复到 60 秒 deadline。关闭 annotation 路径默认 reasoning 后，500 cp 低密度片段明显缩短，但高对白密度片段仍 timeout。adapter 另有超长 optional context 误挡，已由其 focused regression 覆盖。
- 首版 tiled 验证结果：12 条只读快照得到 0 条有效、12 条 `INVALID_MODEL_OUTPUT`，平均约 9,540 ms/p95 约 16,794 ms；活动聊天 `sourceUnchanged=true`、`chatWriteback=false`。脱敏日志显示边界/证据校验错误。后续对 batch8 的真实上游观测确认：一次 8-view 生成以 `finishReason=length`、`outputTokens=4096` 结束，耗时约 50 秒，随后达到共享 54 秒 deadline；完整 v1 validator 正确拒绝结果。另有历史单 tile 13–19 秒测值，说明每请求并发 3 时 17 个 tile 仍需约 78–114 秒，无法满足共享 deadline。以上为超时机制证据，不是分类准确率测量。
- 历史实现快照（v14 marker route，已由 v19 取代）：仅长且 quote/line-delimiter 密度超过成本阈值时切片。core 按 Unicode code point 无缝覆盖（最多 600 cp，密集区域也优先使用该上限，最小 120 cp），lookaround 每侧最多 48 cp 且不拥有输出字符；每个 view 最多 60 个 quote/line delimiter。每个 core tile 独立发起一条单消息请求，重新计算该 view 的内部 source hash。内部 candidate v6 以每个 tile 独立的短 ASCII nonce（优先 2 字符，冲突时 3 字符）+ 两位 base-36 code-point index marker map 表示 segment 起点，并用成对 marker 定位 entity surface、attribute、segment、identity、state evidence。每个 tile 生成的完整 marker token 均不出现在完整 provider-visible 输入（包括 system prompt、response schema、消息、上下文与 resolver refs），且同一分析请求的各 tile nonce 互不相同；所有 nonce 保留到请求结束；每一对须 start < end、落在 code-point 边界且满足字段长度上限；segment 起点无重复且严格递增。服务端从未插 marker 的原文中提取跨度，继续通过 speaker mention 覆盖、同 segment evidence、属性值包含、核心归属和最终完整 Annotation v1 校验；marker 只定位原文，不代表证据语义有效。每个 segment（包括 narration）必须有至少一条段内 classification evidence，普通 quote 路径和 tile marker 路径均由本地 materializer 强制，缺证据整段拒绝。marker 不进入 Annotation v1 或日志。每 tile 先经现有本地 materializer；segment ranges 按 non-overlap core 裁切并重算绝对跨度与哈希。完整 view 中 exact-source entity mentions 和 attribute evidence（包括 lookaround 区域的来源片段）按绝对 span 与 kind 合并去重；identity/state claims 仅在参与实体 mention 和全部支撑 evidence 均满足 core-ownership 检查时保留。最终合并结果仍运行原有完整 Annotation v1 validator。
- v14 当时的硬预算（后续版本继续复用仍有效的服务级安全上限）：tile 计划总数和每 HTTP 请求实际 provider call 总数（包括 retry）均不超过 24。所有 provider 请求共用进程级 FIFO semaphore，最多 3 个实际模型调用并行。真实上游对照显示 6 并行时部分 tile 快速收到 HTTP 400，而 3 并行下 6 条同类调用全部 200；并发 4 的小请求复测也出现 HTTP 400，因此上限取目前实测稳定值，不能将并发提升到 4；不是模型/密钥不可用。现有 `MAX_INFLIGHT=2` 只限制 HTTP 请求数，不能替代 provider semaphore；多个请求共同排队于 3 个 provider slot。tiled request 的单一 120 秒 deadline 从切片调用开始计时，并包含 semaphore 排队；切片内部 provider 尝试也允许使用这条共享 deadline（普通非切片调用仍为 60 秒），避免内层固定上限先行截断；失败会 abort 排队与在途同请求调用并等待收敛。base tile calls 先整体预留，动态 retry 只能使用剩余预算，因此 `base + retries <=24`。若 tile 失败、marker 映射错误、span无效、超过任一限制或最终 v1 校验失败，整条失败并 unknown-safe；不返回部分标注。tile 初次输出预算为 4096，遇到明确截断可提高到 8192，普通单次请求维持原预算。注释分析超时分层设为服务 120 秒、共享适配器 125 秒、8798 代理 130 秒；场景连续性仍保留原适配器/代理超时。低密度消息仍用既有 candidate v1 路径，scene-continuity 不进入 tile candidate v6 或改变其输入/输出合同；所有 provider 请求共享进程级 3 调用上限。
- 代码版本及本地证据：v14 marker 改造将 analyzer scope 设为 `presentation-annotator.v14`，tile candidate 为 v5。focused service tests 覆盖 emoji/code-point 坐标、marker 未知/重复/乱序/跨请求拒绝、marker pair start/end 及长度校验、entity/attribute/segment/identity/state span 映射、单 tile 和 sibling tile marker 不泄漏到 v1、无缝 core 合并、speaker/mention ref 稳定重映射、identity/state 安全约束、24-call ceiling、全局并发不超过 3、队列 deadline/abort、release 幂等和 fail-atomic。v14 内部 tile 同时提供原文 `visibleText` 与仅供定位的短 ASCII nonce `boundaryMarkedText`：语义分类必须基于干净原文，marker 只映射原文跨度，且每 tile 生成的完整 marker token 不得出现在完整 provider-visible 输入（system prompt、response schema 与请求正文）中；不同 tile 使用互不相同的 nonce，避免同偏移 token 跨 tile 重合。每个 marker token 为 6 或 7 个字符，以压低输入膨胀。provider rejection body 仅在 64 KiB 上限内读取用于安全分类；单个超限数据块会在复制/缓存前取消并丢弃。日志仅记录固定字段白名单（例如请求阶段、状态码、耗时、受限错误类别和输出诊断），不记录 provider 原始错误正文或密钥。服务测试通过不证明真实 provider 延迟或语义分类达标，仍需完成代表样本与只读历史回放。人工 gold 仍缺失，准确率仍 `INSUFFICIENT_EVIDENCE`。

### 2026-10-05 v11 语义回测触发 v12 调整

- v11 在一条 1,687 code point、含多处明显角色对白的真实历史消息上通过结构校验，但输出 4 个全为 `narration` 的片段、13 个实体提及、0 个身份链接。源文件回放前后 digest 一致，未写回聊天。这证明“协议校验成功”不等于“语义判断正确”，该结果不能作为成功分类。
- 根因假设：即使 marker 可校验，逐 code point 插入 marker 会让模型的主要输入视觉上高度嘈杂，挤占语义识别注意力。v12 因此将干净原文专供语义阅读，将带 marker 的对齐副本严格限定为跨度定位工具；模型不得从 marker 推断说话人或类别。该改动需要在相同历史样本上真实复测；若仍然把明显对白判为旁白，则继续追查提示/模型解析方式，不得通过扩大自动化测试数量宣称达标。
- 下一步验收必须同时记录：生效 analyzer scope、有效结果/请求错误、分段类型分布、明显对话样本中是否出现 attributed 或 unattributed dialogue、真实回放耗时、`sourceUnchanged` 与 `chatWriteback:false`。因目前无人工 gold，这些指标仅用于检测退化与故障率，不能当作准确率。
- 独立实现审计另发现：若 `knownEntities.resolverEntityRef` 与随机 marker 偶然相同，或另一 tile 的原文/字段引用同一 marker，可能将 marker 复制到 Annotation v1。当前修复在分配时排除整个原始请求的 provider-visible 内容，并在所有消息/tile 合并后的 public response 上扫描完整请求的 marker 集合；补充了单 tile resolver-ref 碰撞和 sibling-tile marker 集合回归。修复必须随 v13 服务重启后再执行真实回放，未重启版本的请求结果不能作为最终修复验收。

### 2026-10-05 v12 provider replay and v13 locator correction

- v12 在内存冻结的最新 12 条 assistant 历史快照上回放：0 条有效注释；4 条 `INVALID_MODEL_OUTPUT`、8 条 `ANALYZER_UNAVAILABLE`；平均耗时约 34 秒，p95 约 104 秒，整批约 214 秒。脱敏服务日志反复显示 `marker-unknown` 与输出 `count`，因此这不是单纯的语义分类偏差，而是模型无法稳定复制私用区 Unicode 标记/按内部候选数量返回结果，并触发有界重试与超时。该批次报告 `chatWriteback:false`；原活动聊天期间追加了消息，所以报告 `sourceUnchangedDuringReplay:false`，内容来自调用前捕获的只读内存快照，不代表整文件未被玩家同时更新。
- v13 将 locator marker 改为短 ASCII nonce + base-36 code-point index，先排除完整 provider-visible 请求中已存在的同形 marker token；仍保留 clean/marked 双视图、严格 request-local 映射与 v1 final validation。模型输出非法仍整条 fail closed。先跑 marker/merge focused tests，再针对相同历史快照执行真实回放。该版本是否改善上游稳定性和分类结果尚待验收，不得预先标为通过。
- v12 服务的只读历史回放期间，脚本曾有一次汇总字段误包含原文的输出错误；后续报告应仅输出类别计数、延迟、索引和哈希稳定性，不输出剧情正文。

### 2026-10-05 v13 real replay outcome

- v13 对调用时捕获的最近 12 条 assistant 快照真实回放：0 条有效；9 条 `ANALYZER_UNAVAILABLE`、1 条 `INVALID_MODEL_OUTPUT`、2 条 `ANALYZER_TIMEOUT`。有效尝试平均约 27.7 秒、p95 约 120 秒、总耗时约 208 秒。脱敏服务日志主要显示上游 HTTP 400 `request-rejected`，另有重复 JSON key 导致 `MODEL_JSON_INVALID` 和输出证据/顺序校验失败。活动聊天在回放期间发生变化，因此 `sourceUnchangedDuringReplay=false`；脚本只分析内存快照，`chatWriteback=false`。此结果未通过，不能报告语义能力可用。
- v14 将每 tile ASCII 标记从 8 字符压缩至 6/7 字符，并确保每 tile nonce 对完整输入安全且在 sibling tiles 间唯一。设计原因是减少 locator 噪声/输入体积，同时保留 tile 隔离。当前必须先完成 focused tests 与独立审计，再跑一个 dense-message 真实样本；样本有非空有效对白注释后才考虑扩大到 12 条快照回放。

### 2026-10-05 v15 bounded annotation recovery

- v14 真实回放中，marker 定位已成功，但整个响应仍因若干 Annotation v1 语义证据字段不合格而被整体丢弃；一个单 tile 样本存在可定位的对白片段，却因说话人证据跨度/属性值等局部问题失去全部结果，播放器于是整体回退 unknown-safe。该现象说明严格 fail-closed 保护了数据边界，却让一个可恢复的可选字段错误屏蔽同消息其他已通过完整性校验的分段。
- v15 的受限恢复在独立审计中被阻止发布：最初实现把任何 segment evidence 校验错误都删掉，可能留下不受证据支持的 narration。该问题已在下述 v16 修复；未启用 v15 服务做最终验收。

### 2026-10-05 v16 classification-evidence gate

- v16 进一步关闭 Annotation v1 validator 的相邻绕过：公开 contract 保持兼容，但服务内部普通 quote candidate 与 tile candidate schema、本地 materializer 共同要求每个 segment（包括 narration）至少有一条段内 `classification` evidence。缺失证据时经有界 provider 重试后仍拒绝整条，不把空 evidence 的 `narration` 交给 renderer。说话人证据与分类证据是不同用途，speaker evidence 单独不能满足这一要求。
- 局部恢复只接受固定的 optional entity/attribute/identity/state 路径和 speaker-specific attribution 错误；speaker 降级只移除 `purpose=speaker`，保留已验证 classification evidence。任何 classification/其他非 speaker evidence 错误继续整条失败。恢复后重新运行完整 Annotation v1 validator。错误 JSON、未知路径、marker/coverage/span/hash 错误仍 fail closed。
- focused service tests 当前通过，覆盖空 classification evidence 拒绝、错位 classification evidence fail closed、speaker downgrade 保留分类证据、普通/切片 schema 都声明 evidence 要求；adapter regression 与静态 architecture audit 通过。独立 A1 复审与 v16 real history replay 尚待完成。
- v16 live analyzer health and historical replay: 待补。回测仅输出结果类别、segment-kind counts、耗时、source hash/file stability 和 `chatWriteback:false`；无人工 gold 不能报告准确率。至少有一条真实回复拿到带分类 evidence 的有效对白/未归属对白，仅代表结构化覆盖恢复，不证明语义准确。

### 2026-10-05 v17 post-merge classification gate

- 独立合成端到端审计复现了 v16 的边界漏洞：tile 候选里的 `classification` span 可合法位于 segment 内，但只落在 lookaround；core 裁切会删除它，而公共 Annotation v1 validator 不要求该用途字段，导致 HTTP 200 返回没有分类证据的段。该响应不应进入玩家 renderer。
- v17 在 `mergePresentationTileResults` core clipping 后逐段要求至少一条仍落在最终 segment 内的 `classification` evidence，并在分析器最终响应边界对 tiled 与普通输出再次强制同一条件。失败整条 fail closed；公开 Annotation v1 schema/DTO 不变。
- synthetic seam/lookaround regression、dense multi-tile 正向测试、服务测试、adapter 测试、静态架构审计和独立 A1 复审全部通过；v17 服务重启/健康验证也通过。
- 历史回放按玩家当前显示格式提取最近 12 条 assistant 可见文本，只向已配置视觉分析服务发送历史文本；聊天源只读且不写回。报告只允许列出匿名行索引、段类别计数、延迟、错误类别、输入文件稳定性与 `chatWriteback:false`。没有人工 gold 时仅报告有效覆盖/拒绝率，不称“准确率”。

### 2026-10-05 v17 real replay and v18 locator revision

- v17 最近 12 条只读历史快照回放：0/12 有效注释，全部为 `INVALID_MODEL_OUTPUT`；平均约 40.3 秒，p95 约 65.0 秒，总时长约 483 秒。脱敏日志显示重复的 marker unknown/range/length、schema/count 和 malformed JSON。回测脚本首版漏传 source hash，先前 12 次在客户端请求校验阶段无效；修正脚本后才发起真实回放。回放过程中用户继续推进，源 JSONL 哈希变化；脚本自始至终只分析调用前内存快照，`chatWriteback:false`。
- 诊断结论：v17 修的是服务端 validator 绕过；零有效覆盖主因是逐码点 opaque marker 协议迫使模型精确复制大量 locator token，而 provider 的 JSON-object 输出不能保证嵌套候选 schema，导致 marker/JSON/shape 错误。增大 token/超时不能修复协议不匹配。
- v18 将活动分块候选切换为已有 exact source anchor + unique evidence quote 协议，不再在模型输入中插入逐码点 marker；tile 输入额外附上 private core 半开范围及精确原文。保留段内唯一定位、evidence 语义/用途检查、core ownership、hash/coverage 和完整 Annotation v1 fail-closed。公开 DTO/schema 与 SillyTavern 均不变。
- v18 synthetic seam negative test、dense multi-tile positive test、service test、adapter test、static architecture audit 与独立实现审计均通过。服务重启和真实回放尚待完成。回放应同样限最近 12 条并对每条顺序请求，输出匿名索引、segment-kind/assigned-speaker/claim 计数、延迟、错误类别、文件哈希变化及 `chatWriteback:false`；没有人工 gold 不得宣称语义准确率。

### 2026-10-05 v18 replay diagnosis and v19 source-unit locator (superseded)

- v18 对历史 assistant index 661 的只读目标回放仍失败：`INVALID_MODEL_OUTPUT`，耗时 101.6 秒、有效 segment 0、`chatWriteback:false`。脱敏诊断的三次 provider 尝试为 10.6/60/23.3 秒，校验类别是 `boundary` / `boundaries`。这表明模型无法在重复、密集文本中稳定输出逐字相邻 quote 并构造唯一有序边界路径；继续增加 token/timeout 或重复提示不能修复该协议错配。历史页面按内存快照分析，回放期间源聊天文件可能被用户继续更新。
- v19 用服务生成的 request-local opaque source-unit/evidence-cell IDs 统一替换普通与 tiled annotation 的模型锚点定位。服务将 ID 映射回原文 code-point spans；单位按 Unicode sentence/line/word/grapheme 分段，证据 cell 有界，模型不输出 offsets、anchors 或 per-character markers。混合单位最多做四层 grapheme-safe bisection；仍混合、ID 无效、预算超限或最终 v1 不通过均整条 fail closed，播放器保持 unknown-safe。可选实体/身份/状态 claim 继续走现有 exact-source quote validation/recovery；公开 Annotation v1 和 SillyTavern 运行语义不变。
- v19 合成测试、普通/密集路径和混合细分单测、独立 A1 审计通过。目标 index 661 首次真实回放发现：无效可选实体声明会阻断有效分类；修复为只丢弃固定白名单中的可选声明并安全降级失去实体支撑的说话人后，目标仍因单条请求的 `results` 外层结果项不符合合同而被拒绝（`unit-candidate-results`，35.2 秒，`chatWriteback:false`）。未降低分类、ID、证据或覆盖校验；此版被 v20 提示/Schema 合同取代。

### 2026-10-05 v20 results-wrapper contract (superseded by v21)

- 真实回放将第二个根因收敛到内部结果包装：普通与密集路径每次只发送一条目标消息，但 v19 提示没有足够明确“顶层恰好一个 result，里面按序列出所有 owned units”，实测 provider 多次返回不符合预期的 `results` 形状/数量。
- v20 将该规则写入提示和 JSON Schema（`results.minItems=maxItems=1`），运行时分开拒绝非数组形状与错误数量，并把它们映射为固定诊断类别。提示版本升为 `presentation-annotator.v20`，确保分析缓存按新 scope 区分。真实目标 index 661 此后确认 results wrapper 问题已越过，新的阻塞类别为 `mixed-refinement-depth-exhausted`（49.7 秒；完整消息仍 fail closed；`chatWriteback:false`）。
- 可选实体/属性/身份/状态声明仅在固定白名单路径错误时丢弃；依赖其失效的关联同步丢弃。被丢弃实体支撑的对白只降为 `unattributed-dialogue` 并保留分类证据。错误 source-unit/evidence-cell、缺分类证据、coverage、仍混合等核心分类错误继续 fail closed。
- v20 服务测试、适配器/呈现测试、静态架构审计、语法与 diff 检查通过；独立审计 PASS。当前中文发布 manifest 确认为 `zh-CN`，前端源码与构建产物均为用户批准的 `assisted` 试运行且 gate 仍为空。该版仍未通过真实目标回放；没有人工 gold 仍不得宣称准确率。

### 2026-10-05 v21 bounded mixed refinement

- 历史 index 661 的混合片段在四层 grapheme-safe 细分后仍未能独立分类。v21 将上限提高到六层（目标单位最多再缩至约 2 code points），仍执行全请求 120 秒期限、24 次 provider-call ceiling、严格 source/evidence ID 校验和 unresolved-mixed fail closed。
- 合成测试证明恰好六层能恢复并完整映射一个混合单位；持续混合的单位恰好六层后被拒绝，累计 7 次 provider 调用，低于 24 次上限。独立审计 PASS。随后完成真实 v21 回放：目标 index 661 因合并后的 `dialogue-speaker` 最终校验失败而拒绝；一次 provider HTTP 400 属短时上游拒绝，不作为语义输出证据。

### 2026-10-05 v22 speakerless-dialogue and merge recovery

- 根因一：内部 unit protocol 允许 `kind=dialogue`、`speakerMentionRef=null` 且无 speaker evidence；Annotation v1 只允许有证据归属的 `dialogue`，因此最终 merge 失败。v22 在内部候选边界将这类语音分类规范化为 `unattributed-dialogue`，保留原分类 evidence；空 speaker ref 却携带 speaker evidence 仍被拒绝。提示词同步写明该约束，公开 Annotation v1 DTO 不变。
- v22 首次真实回放修复 speaker 缺失后，index 661 暴露第二个独立问题：tile lookaround 提供的可选人物/关联证据可能跨最终语义 segment，触发 Annotation v1 `outside-segments`。merge 阶段现先执行完整 v1 验证；若错误仅命中既有固定 allowlist，则应用可选实体/属性/身份/状态与 speaker 降级恢复，再跑完整 v1 验证。只有第二次验证通过才接受；覆盖、哈希、分类证据或未知错误仍 fail closed。
- 新增 dense route 回归：模拟人名跨两个 source unit、两种最终分类，验证恢复只删除无效可选人物实体，未归属对白不改成旁白，所有 segment 仍连续覆盖、hash 精确且带段内 classification evidence；矛盾 speaker evidence 仍拒绝。
- v22 服务经 analyzer 与 8798 proxy health 确认为 `presentation-annotator.v22`。目标 index 661 真实只读回放通过：15/15 segment 有段内 classification evidence，类型为 narration 6、unattributed-dialogue 4、dialogue 1、status 4；明确归属 speaker 1，entities 7，identity links/state claims 均 0；46.6 秒；该单条回放 `sourceFileUnchanged:true`、`chatWriteback:false`。此为结构/覆盖结果，不代表语义准确率。
- v22 最近 12 条只读回放结果：2/12 accepted、10/12 rejected（9 `ANALYZER_UNAVAILABLE`、1 `INVALID_MODEL_OUTPUT`）；两个有效结果共 21 段，全部有段内 classification evidence；平均 18.2 秒、p95 59.7 秒、总计 218.2 秒。安全日志显示多次上游 HTTP 400，固定类别为 `request-rejected`，provider 没有返回足以细分的安全错误类别；其中唯一本地拒绝为 `mixed-claims-invalid`。本批 `sourceFileUnchanged:false`，但 `chatWriteback:false`；不能证明源文件批次期间未发生外部变化，也不能把变化归因给回放脚本。新读取的摘要仍为 339 条 assistant 和相同索引/长度。
- 已据 `mixed-claims-invalid` 增加 v23 处理：`mixed` 是不输出到 Annotation v1 的细分控制值，临时 speaker/evidence claims 在进入子单元分析前丢弃，并以固定诊断计数；最终子单元仍须提供有效 evidence。服务测试通过，包含 mixed 临时 claims 与矛盾 speaker evidence 用例；目标消息及最近历史的 v23 真实回放尚待完成。
- v22/v23 阶段的 annotation/adapter/renderer tests 与 static architecture audit 通过，独立审计 PASS；冻结 SillyTavern 源码路径未改。HTTP 400 的上游根因仍未可判定；没有人工 gold set 仍不得宣称分类准确率。

## 2026-10-06 Provider routing amendment

- 用户明确授权将本地 `presentation-analysis-service`（8801）的文本标注与场景连续性分析切换到活动剧情 API 配置。启动器只从 `data/default-user/OpenAI Settings/Default.json` 读取 `chat_completion_source=claude`、`reverse_proxy`、`proxy_password` 与 `claude_model`；密钥只进入 8801 服务进程环境，不写入前端、仓库配置、日志或分析响应。当前配置模型为 `claude-sonnet-4-6`，provider adapter 使用 Anthropic `/v1/messages`。分析输入限于既有可见正文/场景上下文，不生成剧情、不写聊天数据。
- 为降低抽样波动，Anthropic 分析请求固定 `temperature: 0`；annotation 与 scene prompt scope 分别升至 v25 与 v5，使派生缓存不会复用旧提示行为结果。它不更改 SillyTavern 原版剧情生成参数。
- 图片理解仍由 8798 使用独立视觉凭证。视觉凭证的 `/v1/models` 列表包含 `doubao-seed-2.0-pro`；对比 Lite/Pro 的受控合成左右色块图像请求，两者在 OpenAI-compatible `/v1/chat/completions`、图像输入与 JSON-object 输出下均返回 HTTP 200，Pro 正确识别左右主色。Aiself 未公开其别名到上游精确版本的映射，因此只记录已验证的兼容行为，不推断后端版本。
- 仓库忽略的 `.env.local` 中仅将 `REFERENCE_VISION_MODEL` 从 `doubao-seed-2.0-lite` 改为 `doubao-seed-2.0-pro`；原文件备份于忽略目录 `.codex-longrun/env.local.backup.20261006-doubao-pro`。受控视觉分析器缓存 scope 同步升版，避免复用 Lite 的模型结果。启动总控改为调用既有视觉服务启动入口，确保服务实际读入受控视觉配置。
- 完成重启后的运行状态：8801 health 为 ready/configured，实际 scope 是 `claude-sonnet-4-6:presentation-annotator.v25` 与 `claude-sonnet-4-6:scene-continuity-analyzer.v5:galgame.scene-continuity-analysis.v1`；8798 health 为 `ok=true`，受控启动日志显示当前为 `doubao-seed-2.0-pro`。Claude 合成场景请求经 8798→8801 返回 HTTP 200、高置信地点与转场；最小注释样本经完整 Annotation v1 校验通过。混合对白/叙述注释样本仍在 3 次模型响应后以 `MODEL_JSON_INVALID`/HTTP 502 被 fail closed，安全诊断为 `malformed-structure`，每次约 187 输出 tokens。故 Claude 路由和场景分析已经真实运行，但复杂注释输出格式仍不稳定，不能据此宣布说话人分类稳定或准确率改善。
- 本轮用独立视觉凭证重新读取 `/v1/models`：返回 12 个 model IDs，包含 `doubao-seed-2.0-pro` 与 `doubao-seed-2.0-lite`，也包含其他 Doubao、MiniMax、Kimi 与 Claude aliases。针对现用 Pro 通过 OpenAI-compatible `/v1/chat/completions` 发起 32×16 合成左右色块图请求，返回 HTTP 200，颜色识别为左 `#ff0000`、右 `#0000ff`，约 3.1 秒；这只证明该凭证/网关的兼容性与该受控任务，不推断别名映射到上游精确版本或覆盖全面视觉能力。
- 仅合成数据用于本轮实时验收，未生成剧情、调用原版 `Generate()` 或写入聊天。三个定向服务测试、PowerShell 解析和 `git diff --check` 通过。独立只读审计对 provider routing/model 与原版冻结边界通过；总体为有条件通过，因为混合注释样本的 JSON 仍不稳定。此前发现的恢复机制不能替换在线陈旧 analyzer/不能重拉在线异常视觉服务仍属范围外残余；本轮手动按受控入口重启并核实 scope。历史 gold 回测仍是评估语义准确率的必要证据，切换模型和合成探测均不构成准确率证明。

### 2026-10-06 Dedicated semantic credential and structured-output retest

- 本节 supersede 上一节中“从活动剧情 API 配置读取密钥”的语义分析配置说明。用户指定的当前 Claude 测试 key 已通过隐藏输入写入仓库忽略的 `.env.local` 中独立的 `GALGAME_PRESENTATION_ANALYZER_API_KEY`；同组配置固定为 `GALGAME_PRESENTATION_ANALYZER_BASE_URL=https://aiself.vip`、`GALGAME_PRESENTATION_ANALYZER_MODEL=claude-sonnet-4-6`。密钥只注入 8801 分析服务子进程；不读取或覆盖剧情 API 凭据，也不改变 8798 的视觉凭据。配置前已建立并校验无密钥回显的本地备份。
- `StartGalgamePresentationAnalysisService.ps1` 现在仅从这组专用配置启动分析器，强制 Anthropic provider、允许列表主机与固定模型；健康 scope 为 `claude-sonnet-4-6:presentation-annotator.v26` 及 `claude-sonnet-4-6:scene-continuity-analyzer.v6:galgame.scene-continuity-analysis.v1`。注释响应使用 Anthropic `/v1/messages` 的 `output_config.format` JSON Schema 约束，完整本地 Annotation v1 校验保持 fail closed。分析 scope 升至 v26，场景提示 scope 升至 v6。
- 当前环境真实健康检查确认 8791、8798、8801 均可达，8801 显示专用 Claude scopes。此前本轮一次合成简单旁白注释和一次场景连续性请求都经 8798→8801 返回 HTTP 200；后续重复探测触发上游 HTTP 429 `RATE_LIMITED`，因此停止追加上游请求。混合对白/叙述请求在前次 v26 实测曾返回 HTTP 502 `MODEL_JSON_INVALID`，fail closed；本轮受 429 限流影响，尚无新的混合样本结论。
- 服务单测及静态检查通过；当前聊天目录没有可供只读历史回放的 JSONL 文件，本轮没有做历史回放、读写或修改聊天记录。该轮验收只能证明新凭据注入、服务路由、简单注释与场景接口曾成功；不能证明复杂混合对白稳定，也不能宣称语义识别准确率达到验收标准。待上游限流解除后，应先用单个受控混合合成样本复测，再运行只读历史回放；任何回放结果仍须与人工 gold 对照后才可评价分类准确率。

### 2026-10-06 security-audit hardening follow-up

- 独立审计发现固定启动器之外的服务配置仍接受 `openai-compatible`、任意模型/host；启动进程也会继承调用 shell 的未使用环境值。已将 `loadConfig()` 服务级固定为 Anthropic、`https://aiself.vip` 与 `claude-sonnet-4-6`，其他 provider/model/origin 均返回未配置；生产启动器现在在自身进程中临时创建明确环境白名单后启动 Node，再恢复原调用环境。该实现不依赖 PowerShell 7 的 `Start-Process -Environment`，可由标准 PowerShell 5.1 启动器执行。
- 回归测试新增非固定模型/provider 拒绝断言，并改用固定服务 host 模拟 provider；presentation-analysis-service 与 process-supervisor 测试、Node 语法检查、Windows PowerShell 5.1 parser 和 5.1 `-File` 实际启动 health scope 验证通过。重新启动后的 8801 报告 analyzer configured，注释 v26、场景 v6；8791/8798/8801 均监听。
- README 已与解析器行为一致：结构化响应解码允许从一段 Markdown/说明文字中提取唯一完整 JSON 对象，但包装文字不会进入结果；重复 key、歧义/截断 JSON 及本地 schema/evidence 校验失败均拒绝。OpenAI-compatible 的调用分支仅保留在隔离传输单测中，服务配置无法选择该路径。
- 审计还发现总启动器原先根据 SillyTavern `Default.json` 里的剧情 provider/模型/密钥决定是否启动 8801。现在它改为核对专用 `.env.local` 中的语义 API host/model/key，失败时明确跳过 optional analyzer；不再依赖旧剧情 key。对应进程监管测试已同步更新，验证专用配置来源以及总启动器不读取 Default.json。
- 本轮实时 API 后续重复请求受到 HTTP 429 限流，未追加请求；之前简单旁白注释和场景请求曾成功，复杂混合注释仍需限流恢复后复测。静态/单测通过不改变“复杂混合输出尚未稳定、语义准确率无人工 gold 证明”的验收边界。没有可用历史 JSONL，未执行聊天历史回放；聊天数据未写入。
- 最新版本完成独立只读审计并通过：总启动与复位均使用专用语义配置入口；未见 Default.json/旧剧情凭据依赖；服务级 provider/origin/model 锁定、PowerShell 5.1 环境隔离和原版源码冻结边界均通过。最终进程监管测试通过，8791/8798/8801 健康，8801 scope 为 v26/v6。该 PASS 仅覆盖配置路由/隔离/启动契约；上游 429 后的真实模型可用性及混合文本语义质量仍待 API 限流解除后实测。

### 2026-10-06 Anthropic malformed-JSON bounded fallback

- Same-key direct smoke against `https://aiself.vip/v1/messages` with `claude-sonnet-4-6` and a minimal JSON Schema returned HTTP 200 and one valid JSON object. This confirms credential, route, and basic structured-output capability; it does not certify the larger annotation schema.
- One synthetic mixed narration/dialogue request through `8798 → 8801` returned HTTP 502 `INVALID_MODEL_OUTPUT`. Correlated redacted analyzer diagnostics show three bounded attempts all used `anthropic_json_schema`; every response ended normally (`end_turn`) but failed JSON structural parsing (`malformed-structure`). No rate-limit, authentication, or transport failure occurred.
- The internal retry now switches once from Anthropic structured output to prompt-constrained JSON only for empty, truncated, or malformed JSON. It avoids duplicating a schema already embedded in the production system prompt, and a second malformed prompt-only response fails immediately instead of spending a third same-mode call. Parser, materializer, evidence checks, and complete Annotation v1 validation remain unchanged. Parseable but semantically invalid candidates do not trigger this format fallback. The public request/response schema and v26 prompt scope do not change.
- The first live retest after adding the format fallback still returned HTTP 502 `INVALID_MODEL_OUTPUT`: redacted diagnostics show one `anthropic_json_schema` attempt followed by two `anthropic` prompt-only attempts, all ending at `end_turn` with malformed JSON. This exposed that the first fallback was not actually bounded to one request; a subsequent correction now stops after one malformed fallback attempt. It also removes duplicate schema text from production prompts. These observations do not identify the malformed response byte/field, and no gate was relaxed.
- Service unit tests pass with regressions for production-style schema prompts, one fallback attempt, local-validator invocation, and rejection of parseable validator-invalid output. The live mixed sample remains unresolved; no historical replay is appropriate until the synthetic path returns a valid annotation. Inventory found 721 nested JSONL files (the prior check only inspected the immediate directory and missed per-character subdirectories); none were read or modified in this step.
- Independent A1 read-only audit passes on the corrected code/tests/docs. After the final retry-bound correction, the pinned launcher restarted 8801 successfully; 8798 and 8801 health checks pass and the service still reports v26/v6 scopes. No additional provider request or history replay was sent after the mixed sample failed in both modes; a future live test must demonstrate at least one valid synthetic annotation before real history is submitted for analysis.

### 2026-10-06 Safe JSON parse-position diagnostics

- The strict provider JSON parser now attaches an internal source offset and fixed parser failure stage to parser errors. Sanitized attempt diagnostics expose only the UTF-16 offset relative to the exact parser input (trimmed response, fenced body, or extracted JSON candidate), a token class from an allowlist (`quote`, `comma`, `fullwidth-comma`, `unicode-punctuation`, `eof`, etc.), and a stage from an allowlist (`expected-colon`, `expected-comma`, `invalid-value`, etc.); unterminated containers point to end-of-input. The single bounded Anthropic prompt-only fallback uses the allowlisted stage to request ASCII JSON punctuation where needed. No raw character, model-controlled key/name, model output, prompt, or credential is retained or logged.
- The focused service test uses a synthetic malformed object with a unique sentinel property, checks the expected offset/token class, and asserts both the sentinel and the actual synthetic source text are absent from the returned attempt trace. `node --check` and `node external-modules/presentation-analysis-service/test.mjs` pass.
- The new live diagnostic sample is pending. Continue to use synthetic text only until the annotation route returns a valid result; do not send history text to a route that still fails structural parsing.

### 2026-10-06 Parser-stage-guided JSON retry

- The latest single synthetic mixed-text request through `8798 → 8801` returned HTTP 502 `INVALID_MODEL_OUTPUT`. Redacted diagnostics show exactly two requests: one `anthropic_json_schema` call and the bounded `anthropic` prompt-only fallback. Both ended normally (`end_turn`) but failed structural JSON parsing at UTF-16 offset 291, token class `other`; output sizes were 829/841 characters and 296/301 provider-reported tokens. This is a formatting failure, not evidence of a transport, authentication, or quota problem. No response text or credential was retained in the report.
- The diagnostic stage was not available for that request, so the exact syntax expectation remains unknown. The parser now maps only fixed internal failure messages to an allowlisted stage (`expected-colon`, `expected-comma`, `invalid-value`, etc.) and the one bounded Anthropic prompt-only retry adds a stage-specific syntax correction. Candidate parsing and all local schema/evidence validators remain authoritative; no validation gate is relaxed and no parser input is logged.
- The next live verification must use one synthetic request after the updated service has restarted. Do not replay historical chat text until that returns a valid, fully validated annotation. No SillyTavern chat data was read or written by this synthetic request.

### 2026-10-06 Anthropic structured-output schema compatibility

- Read Anthropic's current [Structured outputs documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). It documents `output_config.format` as `{ type: "json_schema", schema }`, lists Sonnet 4.6 as supported, and describes grammar-constrained decoding for valid JSON. Its supported schema subset excludes constraints such as `maxItems`, `minLength`, and `maxLength`; unsupported schema features are expected to be rejected by the API.
- The local Anthropic adapter had been sending an extra `format.name` field and passing the raw application schema, which contains unsupported length and array-size constraints. This is a confirmed request-shape mismatch. It may explain why the gateway returned HTTP 200 while the structured response still contained invalid JSON; the exact gateway behavior is not proven from the available response metadata.
- The adapter now sends the documented `{ type, schema }` envelope, transforms only the provider-facing schema by moving unsupported application bounds into descriptive guidance, and converts the current simple non-capturing reference pattern into the supported group form. The canonical application schema and all local bounds/evidence validators remain unchanged and authoritative.
- Tests inspect the transformed annotation, tile, unit, and scene-continuity schemas for unsupported grammar constraints; verify the original local schema retains its bounds; and exercise bounded malformed-output fallback. The full service test suite passes. The updated production service still needs one synthetic live annotation before any historical text replay is considered.

### 2026-10-06 Chinese quotation-mark availability fix

- Both the analyzer (`8801/v1/health`) and the visual proxy (`8798/v1/presentation/health`) were ready and reported the pinned `claude-sonnet-4-6` annotation/scene scopes.
- One low-volume synthetic mixed-text annotation through `8798 → 8801` returned HTTP 502 `INVALID_MODEL_OUTPUT`. Safe trace: the structured-schema attempt and its one prompt-only fallback both ended with `end_turn`; both failed parsing at expected-comma, offset 291, on a non-ASCII token. This is a provider output-format failure, not an HTTP/authentication/quota failure. No historical chat was read or written.
- Bounded direct differential probes using the same key, model, production unit schema, and production input-builder shape isolated a narrow trigger: a Chinese sample containing `“…”` / `”` failed JSON parsing, while Chinese text without those glyphs and the same text using ASCII double quotes both returned valid schema-shaped JSON. Minimal and full production schemas also passed their low-cost schema-only checks. The evidence points to the typographic double-quote characters in the provider-bound source payload interacting badly with this gateway/model output path; the probe does not establish a general Claude limitation.
- The Anthropic adapter now makes a provider-only copy and maps only source-text fields named `visibleText` and `text` from `“` / `”` to ASCII `"`. It does not mutate the request, hashes, source-unit/evidence maps, SillyTavern chat data, or published response. Character names/aliases and all other punctuation remain untouched. Local materialization and final Annotation v1 validation remain mandatory and unchanged.
- The single end-to-end synthetic attempt after restart ended in HTTP 504. The analysis service log records `ANALYZER_TIMEOUT`, stage `provider-invoke`, at exactly the shared 120,000 ms deadline. It was not an auth or route failure. Static tracing found the avoidable call expansion: text at or below 160 code points was always made one source unit even when `Intl.Segmenter` had clear sentence boundaries; mixed classification then fell into repeated grapheme bisection and serial provider calls.
- The source-unit planner now preserves existing Unicode sentence/line boundaries for short text. These are only ownership/chunk boundaries; the model still assigns every semantic kind and speaker, and source maps plus Annotation v1 evidence checks still validate against original text. This allows several short dialogue/narration spans to be classified in one bounded provider request and avoids spending the deadline discovering obvious sentence splits.
- Unit tests cover the three-part Chinese sample splitting at its exact sentence boundaries and the provider-only quote normalization; the full service test suite and `git diff --check` pass. Restart the analyzer once and make one short synthetic request containing a Chinese quoted utterance to verify the combined path. If that request times out or rejects, stop provider probing and report the remaining blocker. Do not run a broad historical replay or change any chat data per the user's instruction.
