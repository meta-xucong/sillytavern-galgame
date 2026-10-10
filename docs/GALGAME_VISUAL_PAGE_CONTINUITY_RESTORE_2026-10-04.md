# Galgame 可见页场景连续性与视觉恢复阶段

> 状态：开发合同；2026-10-04
> 目标：修复当前 `/game/` 中舞台背景不能随有效场景变化、视觉语义匹配链断开的根因，并验证图标/头像层仍按自身证据呈现。
> 权威边界：`AGENTS.md` 与 `GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`；仅使用自有上层目录。
> 用户明确要求恢复失效的视觉模块。本阶段仅对“当前已显示页的场景呈现投影”启用限域语义 producer；一般 speaker/identity/roster 注释继续遵守现行 shadow 与整剧本 gate，不随本阶段一并启用。

## 1. 冻结任务合同

### 目标

1. 对页面当前显示的确切可见文本，生成可校验的场景关系与有限场景视觉标签。
2. 由共享确定性代码将有效证据转换为既有 `galgame.scene-continuity.v1`，交给原有 8798 资产服务选择资源。
3. 修复普通文本段因使用整条回复“最后地点”而产生的错误场景实体；删除该剧本专属正则路径。
4. 在真实 `/game/`、已发布 catalog 和已运行服务中验证背景实际切换、人物/旁白通道、装备/道具/技能图标与失败降级。

### 非目标

- 不改 SillyTavern 原版代码、角色卡、世界书、聊天正文、存档、上游模型参数或剧情走向。
- 不启用一般对白 speaker/身份合并/队伍 roster 的 shadow 标注。
- 不让分析器挑选 `assetId`；不将分析结果写回 chat、save、manifest、binding 或玩法状态。
- 不承诺任意语言/题材都一定识别成功；无证据始终 unknown-safe。
- 不在测试中推进玩家剧情、不删除或重置历史数据。

### 风险与级别

- D1：已由独立 Think 复核。既有文档要求一般身份分析保持 shadow；本阶段按用户对“恢复视觉模块”的明确要求，只为场景展示新增窄范围例外，不复用历史 proof/binding issuer。
- I2：当前场景生产者缺失，页面投影、视觉请求和 renderer gate 形成跨模块断链；还需严格处理分页、Unicode offset、scope 和异步过期结果。
- A1：跨服务协议、资源选择与浏览器实际呈现；必须独立只读审计及真实运行态证据。

## 2. 根因与目标链路

当前 8801 已能分析可见文本，但其 v1 schema 没有地点关系；播放器只消费外部 `sceneContinuityProjection`，生产代码从未产生它；8798 的 scene decision 又只在 `changed` 时允许渲染。旧 `NATURAL_SCENE_HINT_PATTERNS` 以整条回复最后一次地点匹配充当当前位置，无法分辨到达、回忆、计划或远处提及，必须移除而非扩充。

```text
当前 display page（精确未格式化字符串）
  + 最多两个更早的可见页面（只作上下文）
  + 同 scope 最近一次经过验证的场景 label/key
        ↓ 8801 版本化只读 scene-continuity 分析
  exact-span 关系：当前地点 / 被提及地点 / 转场动作 / 闭集视觉标签
        ↓ shared deterministic contract + hash/span/scope validation
  galgame.scene-continuity.v1（只用当前页证据；模型不能给 asset ID）
        ↓ changed 才构建 scene entity
  8798 依据已发布 catalog 唯一选择 scene asset
        ↓ 浏览器校验 catalog/version/URL 并加载
  changed 且无唯一资源/加载失败 → 当前 release 默认背景
  continued/unknown/分析失败 → 保留当前已验证背景
```

## 3. 版本化分析合同

### 3.1 请求 `galgame.scene-continuity-analysis-request.v1`

精确字段：

```json
{
  "schemaVersion": "galgame.scene-continuity-analysis-request.v1",
  "requestId": "UUID",
  "scope": {
    "chatId": "opaque chat key",
    "releaseId": "published release",
    "arcId": "arc or null",
    "catalogId": "published catalog",
    "catalogRevision": 1,
    "catalogHash": "sha256:…"
  },
  "sourceRole": "character",
  "segment": {
    "messageId": "visible original message index",
    "pageIndex": 0,
    "pageText": "exact current displayed page",
    "pageTextSha256": "sha256:…"
  },
  "contextPages": [{ "pageText": "earlier visible page" }],
  "previousScene": null
}
```

- `pageText` 必须逐字匹配当前舞台当前页，在 markdown/HTML/UI 装饰前读取；只用于场景展示分析。最长 4,000 Unicode code points。`pageTextSha256` 是该 JS 字符串按 UTF-8 编码、不 trim/换行转换/Unicode normalization 后的 SHA-256。
- `sourceRole` 仅允许 `character|player|system`，从原版消息标志归一：`is_system===true` → `system`；否则 `is_user===true` → `player`；仅原版 assistant/character 消息 → `character`。身份不能从 speaker 名称猜测；无法确认来源的消息不创建请求。只有 `character` 可请求场景分析；播放器对 player/system 跳过调用，服务端也必须 fail closed。角色字段不得转发给 provider。
- `contextPages` 精确为 `{pageText:string}` 数组，最多 2 条，每条最多 1,200 code points；仅提供较早可见页作消歧，模型不得从这些页返回 evidence span。
- `previousScene` 只能由同 scope 的已消费投影提供 `{sceneKey, displayLabel}`；不得由模型或未校验缓存重建。
- 请求最大 UTF-8 48 KiB。不得带 prompt、世界书、角色卡、隐藏思考、模型设置、密钥或完整聊天对象。

### 3.3 HTTP transport、provider 配置与错误合同

- 独立服务 `127.0.0.1:8801` 新增 `POST /v1/presentation/scene-continuity`；同路径支持 `OPTIONS` 预检。必须携带 `content-type: application/json` 与 `x-galgame-scene-continuity-version: 1`。预检成功必须返回 `Access-Control-Allow-Methods: POST, OPTIONS`、`Access-Control-Allow-Headers: content-type, x-galgame-scene-continuity-version`，且 `Access-Control-Allow-Origin` 只能回显 allowlist 中的请求 Origin。成功状态为 HTTP 200，响应体就是 §3.2 定义的 `galgame.scene-continuity-analysis.v1` 对象，不额外包 `success/data`。既有 `POST /v1/presentation/annotations` 及 `x-galgame-presentation-version` 合同保持原样。
- 以上 8801 是内部分析服务合同；**玩家浏览器不得直接请求 8801**。浏览器端改用 8798 的固定 `GET /v1/presentation/health`、`POST /v1/presentation/annotations`、`POST /v1/presentation/scene-continuity`。场景连续性 POST 用 CORS-safelisted `text/plain` 承载 JSON，保留固定 endpoint 与请求体 `schemaVersion`；8798 验证 exact player Origin、方法、媒体类型及场景请求 schema 后，规范化为内部 `application/json` 加版本头，再代理到同机 loopback 8801。旧版 JSON+版本头 transport 仍兼容。代理不接收转发 URL/Host/凭据，不转发 Cookie，限制请求/响应大小并传递取消和超时。legacy/PNA preflight 只对 player Origin 和精确方法/头放行；PNA 许可仅随通过 allowlist 校验的 loopback 请求返回。视觉状态检查须同时核验 8798 catalog 和代理后的 8801 analyzer readiness。
- 错误响应统一为 `{ "schemaVersion": "galgame.presentation-error.v1", "code": "…", "requestId": "UUID" }`，分别用 HTTP 状态表达：`400 INVALID_REQUEST`、`403 ORIGIN_DENIED`、`413 BODY_TOO_LARGE`、`429 RATE_LIMITED`、`502 INVALID_MODEL_OUTPUT`、`503 ANALYZER_NOT_CONFIGURED|ANALYZER_UNAVAILABLE`、`504 ANALYZER_TIMEOUT`。任何失败不得返回部分 scene 结果。
- 服务端复用当前 provider 加载合同：`GALGAME_PRESENTATION_ANALYZER_PROVIDER`、`GALGAME_PRESENTATION_ANALYZER_BASE_URL`、`GALGAME_PRESENTATION_ANALYZER_API_KEY`、`GALGAME_PRESENTATION_ANALYZER_MODEL`、`GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS`。场景连续性与文本呈现分析由 8801 使用活动的 SillyTavern Claude 配置：固定启动器只读取 `data/default-user/OpenAI Settings/Default.json` 中活动 Claude provider 的 `reverse_proxy`、`proxy_password` 与 `claude_model`，密钥仅注入 8801 服务进程，不得传给浏览器或写入日志。Claude 请求仅分析已展示的剧情文本，不生成剧情、不写聊天。8798 图像理解继续使用独立的视觉凭证；当前受控视觉模型为 OpenAI-compatible `doubao-seed-2.0-pro`。这两类密钥均只进入对应服务端进程，不传给浏览器。Health 的 `analyzerConfigured` 反映共享 provider 配置；`analyzerScope` 必须包含活动模型与 annotation prompt 版本，prompt/解析行为改变时升版以隔离派生缓存；`sceneAnalyzerScope` 至少含模型、`SCENE_PROMPT_VERSION` 与 scene response schema 版本，不得仅以模型名判断场景分析缓存范围。
- 请求 Origin 继续通过 `GALGAME_PRESENTATION_PLAYER_ORIGINS` 精确 allowlist（默认 `http://127.0.0.1:8001,http://localhost:8001`）；provider 仍要求 HTTPS、无 URL credentials/query/hash、hostname 必须匹配 `GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS`。拒绝 redirect；不把 provider 错误正文、key、完整请求或响应写入日志。
- `invokeProvider` 发送给外部模型前必须构造最小输入，只包含当前 `pageText`、较早 context 页的 `pageText` 和 `previousScene.displayLabel`；不得把 chat/release/arc/catalog IDs、requestId、哈希、API key、端点或本地路径发送给上游。模型只返回分析字段；服务端依据原请求绑定并校验 `requestId`、scope 与 `pageTextSha256`。
- scene endpoint 使用独立常量 `SCENE_PROMPT_VERSION` 与服务端 system prompt/schema，限制为场景连续性分析；不得复用或改写 annotation v1 prompt/schema。场景分析模型内部输出 v3 使用逐字复制的 evidence quote（地点、转场、标签各自引用原始 pageText），不要求模型计算字符偏移；服务端只接受在当前页中唯一出现的原文子串，并确定性换算成响应 v1 的 Unicode code point spans，再运行原有 hash/span/schema 校验。currentLocation/transition 核心 quote 未找到或重复时必须触发有界重试，重试仍失败则返回 `INVALID_MODEL_OUTPUT`；引用地点和视觉标签属于可选细化，其 quote 若无法唯一绑定则丢弃该可选项，不得因此丢弃已验证的核心 span。不得猜测、裁切越界 span 或将低置信度结果当作场景。外部浏览器响应仍保持 §3.2 的 `galgame.scene-continuity-analysis.v1`，模型内部提示词版本为 `scene-continuity-analyzer.v5` 并纳入 health scope/cache key。provider 请求复用 Anthropic/OpenAI-compatible adapter 的 endpoint、安全校验、redirect 拒绝和脱敏错误处理，但调用函数必须接收 route 专属 system prompt；annotation v1 继续使用原 prompt，不改变旧路线行为。复用现有 provider 60 秒 deadline 和最多一次 transient retry、最多两次格式/证据重生成；HTTP `requestTimeout=15s` 仅约束请求体接收，不得误当作上游推理超时。浏览器适配 timeout 不得短于 provider deadline 加本地回传余量。
- 请求体上限 48 KiB、最多 2 个 inflight 与每 IP 每分钟 30 次限制沿用现有服务值。Provider 原始响应上限 64 KiB。独立 scene route 也必须服从这些限制，并在模型输出验证前不把任何部分结果发送给浏览器。

### 3.2 响应 `galgame.scene-continuity-analysis.v1`

闭合对象字段：`schemaVersion, requestId, pageTextSha256, confidenceBand, currentLocation, transitionAction, referencedLocations, visualTags`。

- span 使用当前页的 Unicode code point 半开区间；转换成既有 continuity envelope 时，必须转换为 UTF-16 code-unit offset，并再次禁止切开 surrogate pair。
- `currentLocation` 和 `transitionAction` 为 `{start,end}` 或 null；`referencedLocations` 是最多 12 个 span；`visualTags` 是最多 8 个 `{code,start,end}`。
- `confidenceBand` 的完整枚举为 `low|medium|high`。非 character 请求返回与当前请求绑定的固定 unknown-safe 成功响应：`confidenceBand:"low"`、`currentLocation:null`、`transitionAction:null`、`referencedLocations:[]`、`visualTags:[]`；服务端填充 response schema version、requestId 和请求 page hash，且不得调用 provider。播放器正常应跳过这类请求；该固定响应是服务端防御性合同。
- `visualTags.code` 仅允许与 8798 场景词典一致的 `scene.interior|scene.exterior|scene.ruins|scene.forest|scene.city|scene.dungeon|scene.night|scene.day`。每个标签须有当前页中可验证的 evidence span，且 span 必须完全位于 `currentLocation` span 内；若 `currentLocation=null`，`visualTags` 必须为空。被提及、回忆、计划或远望地点的标签不得用于当前背景。system prompt 应将能描述当前地点的环境修饰词（例如夜间）纳入 `currentLocation` 原文跨度，不得把转场前地点或旁提地点的标签绑定到目标地点。分析器不能返回资产 ID、URL、自由类别或稳定 entity key。
- 必须回显 requestId 和 pageTextSha256；每个 span 必须落在当前页，并通过 Unicode 边界检查。响应额外字段一律拒绝。
- 只有 `confidenceBand=high`、一个有效当前地点 span，以及与之同页的明确转场动作 span，才可产生 `changed`。模型置信度不能替代 exact-span/schema/scope 检查。
- 只有当前地点派生出的稳定 scene key 与 previousScene key 不同、且当前页具有相符的 current-location 和 transition-action exact spans，才能投影 `changed`。地点派生 key 与 previousScene 相同时投影 `continued`，最终 continuity envelope 不携带 transition-action span；模型输出的动作即使有效也不能令同一场景重复切换。没有可信 previousScene 且当前页缺少明确转场时，不得把首次 mention 升级为 changed。地点与既有地点无法确定同一性时、证据仅在 contextPages、置信度不足或响应不合法时一律 `unknown` 并保留当前背景。
- 对“位置提及/回忆/计划”只可产生 referenced-location；不得单独产生 changed。切场语义由分析器判断，shared contract 只接受 high + currentLocation + transitionAction 的共同证据。
- 玩家输入属于行动意图，不证明场景转移已经发生；仅原版角色可见回复能够确认当前页转场。请求由 player/system 发起时不调用分析器，不消费或接受其投影。

## 4. 投影与运行行为

1. shared builder 从精确页面 span 提取地点原文并生成 chat/release/arc/catalog 隔离的 scene key；模型不得给 key。`current-location`、`transition-action`、`referenced-location` 依既有 v1 结构组装。
2. 不新增剧情实体、事件或场景状态。运行时当前态仍是展示层 `verifiedSceneContinuity={scope, sceneKey, displayLabel}`。为在刷新和读回当前聊天后恢复它，浏览器可另存可丢弃的 scene-continuity 派生账本 v2：每个 scope 最多 512 条，只含 scope、消息/页面索引、消息 ID、原消息/页面/时间线前缀 SHA-256、原版消息与地点证据的 Unicode source span、`sceneKey`、短 `displayLabel` 与 lineage fingerprint。恢复时必须从原版当前消息按地点 span 重建 label，并用 scope+原文重新导出 sceneKey；localStorage 中的 label、key、视觉 hint 都不是可信来源。v1 缓存不能迁移为 v2 锚点，刷新后会由冷启动恢复路径重建。不得保存聊天正文、prompt、模型响应、密钥、资源正文或存档/玩法状态。storage key 使用 scope hash；账本不作为剧情事实或新状态源。
   - hydrate 时必须使用当前 SillyTavern canonical chat snapshot，逐条重算原消息哈希、页面 span/hash、完整消息前缀 hash 与祖先 lineage；不匹配的记录及其依赖后继记录都拒绝并清除。
   - 达到 512 条后只保留最近条目；若裁剪导致 lineage 链缺少祖先，断链记录 fail closed，不尝试把最新记录提升为可信 checkpoint。
   - localStorage 不可用、配额耗尽或数据结构无效只会失去视觉恢复缓存，不得阻塞当前故事或影响 SillyTavern 数据。
   - chat/release/arc/catalog 任一变化时立即清除内存中的旧 scope 与场景身份，并恢复新 release 默认背景；其他 scope 的持久缓存只能在匹配其准确 source snapshot 时使用。
   - 冷启动若当前 scope 没有可验证的 earlier ledger，播放器先正常处理当前可见页，再在后台检查当前 cursor 之前最近 128 个角色可见历史候选；历史扫描不得阻塞当前剧情或当前页首次视觉决策。完整早期消息在 4000 code point 分析上限内时作为一个候选整体分析，以减少同一轮回复的逐页请求；超过上限时才按原版显示页逐页检查。当前消息只检查可见 cursor 之前的页，绝不读取该回复后续页面。候选仍使用现有 v1 request/response、scope/hash/Unicode span 和 timeline 门；最多附带两个更早角色页作为消歧上下文，context 本身不能提供 evidence。扫描每次 provider 请求至少间隔 2.1 秒，每批最多 12 个候选；不设置会早于完整候选窗口所需时间的整轮硬超时，并支持页面/聊天切换取消。候选完成后可保存仅包含 scope/cursor/candidate/analyzer 摘要哈希和扫描偏移的可丢弃检查点，不含 chat ID、正文或模型响应；恢复前重新计算并逐项校验摘要。失败候选在下次冷启动从最近失败位置重试。只接受最近一条含 high-confidence current-location 与同一原版显示页内 transition-action exact spans 的 `changed` 作为恢复锚点；找到后仅持久化该锚点的派生账本记录，并在首次视觉请求结束后重新投影仍处于原 cursor 的页面。单个历史候选超时、无效或 provider 错误只跳过该候选并继续；扫描取消、超出时间/候选窗口或无有效锚点时保持作品默认背景。历史分析会把候选消息/页正文及最多两个更早角色页正文发送到 8801 的 Claude 文本分析 provider（凭据取自活动 SillyTavern Claude 配置）；不发送 API key、chat id 或本地路径，也不保存聊天正文、provider 响应或资产 URL。该路径不调用原版 `Generate()`，不写聊天正文/存档；恢复后仍由 8798 基于当前 catalog 重新决策与加载背景。
3. 新分析产生的 scene hint 仅在 `consumeSceneContinuityProjection` 对当前页返回 `changed` 时加入 `/v1/core/visual-decisions` 请求；hint 标签只能来自本页高置信度闭集输出。冷恢复可另用来源/lineage 校验通过的 exact-current 缓存或最近 earlier verified ledger，仅用于重新解析最后已验证背景，不得伪装为当前页的新投影、写入当前页 completed ledger 或取代 8798 的资产解析职责。
4. fresh、内存缓存、持久 ledger 与 supplied projection 必须共享相同的当前 source/timeline/scope/span/lineage 验证门；不能以结果 cursor 与自身比较。页面 DOM 应用前重新读取当前聊天 cursor 并检查当前 token。任何页序变化、聊天/分支变化、分析请求被 abort、scope/hash 不一致或迟到响应均不允许覆盖当前舞台。分析缓存键绑定完整 scope、页面 hash、上下文摘要、previous scene key、analyzer scope 和 prompt/schema 版本。
   - 持久 ledger 只可收录通过上述来源验证、且投影状态为 `changed` 或 `continued` 的页面。`unknown` 即使保留了上一已验证场景 key，也不能登记为当前页已完成记录。
5. 分析 timeout/不可用/unknown 不阻止聊天显示；同 scope 保留已验证背景。有效 changed 但资源唯一匹配失败、响应不可信或加载失败时清除旧 scene identity 并恢复当前 release 默认背景。
6. 旧 `NATURAL_SCENE_HINT_PATTERNS` / `extractNaturalSceneHint` 生产路径删除。显式场景标签也不能绕开 scene-continuity gate；角色、旁白、装备、道具、技能通道不受该删除影响。
7. 侧栏装备、道具、技能候选只从玩家当前实际显示的 `collectVisibleHudRecords(snapshot, messageIndex, profile)` 记录生成，且沿用其 canonical visible-branch `evidenceSource`。只允许直接映射 `equipment → equipment`、`inventory → item`、`abilities → skill`；背包条目不得被改成已装备状态。匹配属性仅使用记录中的非空可见标签（保留的原始技能名可作为同一能力的来源别名），不从通用类别、猜测特征或新增关键词规则造候选。缺少证据或标签时不生成视觉实体，保留中性占位。
   - 为约束长消息成本，每个 HUD 模块最多投影 12 个唯一名称（技能的 `originalName` 也计入）；opaque `entityKeySeed` 使用实际可见消息文本哈希做派生输入，正文和哈希都不进入属性或持久记录。

## 5. 本阶段文件边界

| 文件 | 责任 |
| --- | --- |
| `frontend/shared/src/scene-continuity-analysis.js`（新增） | request/response schema、hash/span 校验、Unicode offset 转换、v1 projection builder |
| `frontend/shared/src/presentation-analysis-adapter.js` | 独立 scene endpoint 的浏览器适配、timeout/abort/cache-safe request；保留现有 annotation adapter 合同 |
| `external-modules/presentation-analysis-service/server.mjs`、新增 scene contract 模块、`test.mjs` | 限域 endpoint、独立服务端 prompt、request/response closed validation、复用 provider 请求；annotation route/schema 不变，密钥仍仅服务端加载 |
| `external-modules/presentation-analysis-service/StartGalgamePresentationAnalysisService.ps1`、`README.md` | 从活动 SillyTavern Claude 设置读取 base URL、服务端密钥与模型供 8801 文本分析；明确与 8798 独立视觉凭证/模型隔离，且不读取 Alchemy `SEMANTIC_PLANNER_*` |
| `frontend/player/src/main.js` | 当前 page/context 收集、调用、异步 token/scope 校验、将 validated changed evidence 交给 8798 |
| `frontend/shared/src/sillytavern-adapter.js` | 删除自然语言地点正则自动推断，保留显式非场景标签解析 |
| 对应 `frontend/shared/tests/**`、`frontend/player/tests/**` | 合同、负例、渲染链与失败路径测试 |
| `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`GALGAME_DESIGN_SPEC.md`、`GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`、视觉恢复/匹配/身份规范与本阶段文档 | 同步范围、唯一背景 gate、独立 endpoint 和例外验收 |
| `public/game/**` | 安全 staging 构建后只选择性同步本阶段必要 app/shared 文件；不得全量清空覆盖 dirty 目录 |

冻结范围外不得改动。特别禁止原版 SillyTavern、process reset/recovery、catalog manifest/store/active pointer、视觉素材、聊天/存档和密钥值。仅可调整视觉模型标识；8801 与 8798 都只读取视觉专用凭证，不得把 key 值复制进代码、文档、静态文件或日志。

## 6. 必须通过的验收

### 合同测试

- 请求/响应 exact schema、UUID/hash echo、wrong scope、错误 page hash、extra field、越界/空 span、代理对拆分、低置信度均拒绝或 unknown；player/system 来源不会调用 provider，也不能消费投影。
- “当前在城堡，计划去港口”“回忆港口”“远处看到城堡”不 changed；明确“抵达/走进/穿过”结合本页当前地点才 changed；跨页同地点继续保留；前页有转场、当前页无转场不得误切。
- emoji 前后 span 从 code point 转成 UTF-16 正确；上一地点精确相同为 continued；异名但无转场 unknown；changed destination key 必须不同于当前 verified key。
- service timeout、provider invalid JSON、请求被 abort、scope/page 已换、请求竞态，均不能切背景或改原文。
- 用真正 cold-reload fixture 清空内存 ledger、`verifiedSceneContinuity`、已验证背景状态和背景 DOM，再从 localStorage + 当前 canonical chat 恢复：当前页存在完全匹配的已验证缓存记录且 analyzer unavailable/unknown 时，必须重建最小 scene hint 并交由 8798 重新决策；不得直接信任/保存旧 asset URL。
- 若当前页没有自己的缓存记录、analysis 为 unknown，而当前 scope 存在有效 earlier verified scene，cold reload 后舞台没有已验证图时须重新匹配并显示最后验证场景；同一过程在页面已显示正确场景图时不得重复清除或抖动。source/chat/scope/lineage 不匹配仍必须拒绝缓存图。
- 负例：先存在有效 earlier verified scene，再给当前页一份 schema/hash 均有效但投影状态为 `unknown` 的结果；该页不得写入 completed ledger。随后 cold reset/reload 时，exact-current 查询不得把该页恢复成已验证场景，只能依据 earlier record 重新匹配最后已验证场景。
- tag 只能为闭集代码并附当前页 span，且服务端响应中的 tag 必须完全包含于 `currentLocation`；无 `currentLocation` 时 tag 列表必须为空。8801 先对 provider 原始 tag 数组执行 `maxItems` 校验；超限输出必须被拒绝，不能通过删除标签绕过上限。未超限时，结构完整但跨度位于 `currentLocation` 外（或没有地点 span）的可选 tag 会在 8801 边界被丢弃，不扩写证据跨度；地点/转场和其他非法字段仍严格拒绝。覆盖夜晚修饰语位于地点名之外的回归样例，确认有效地点/转场保留、标签省略。任意资产 id/URL/场景自由文本不能进入 analyzer output。

### 运行态测试

- 确认 8801/8798/8001 版本与活动 catalog 指针；不输出/记录密钥。
- 在**现有已读页面**做当前页真实分析：本回合“马车穿过凌晨两点的贵族区”应给高置信度当前地点+转场证据，视觉标签与页面明确证据相符；回忆/计划/其它地点不成为目标。
- 8798 决策必须引用当前活动 catalog hash，并选择唯一符合当前地点/环境标签的已发布 scene asset；实际 image request 成功且 DOM 的 `data-visual-asset-identity` 与活动 catalog 资产一致，背景像素可见变化。
- 连续切换页面、回看此前页面、刷新后读同一 chat、切换 Arc/chat/release/catalog 时验证 continuity/cache 失效策略；未知或 timeout 不清空有效背景。缓存测试必须覆盖更早消息编辑/删除、swipe 分支替换、scope 变更、512 条截断断链、storage 不可用和迟到结果。
- 多页同屏回复快速翻页时，当前可见页不得等待旧页的 provider round trip。非相同 cursor 的旧请求必须中止，服务端须向上游传递取消；同 cursor 的重复请求可以去重。验证旧请求即使迟到也不能应用到当前页，较新的分析不会因 23 页回复形成串行队列。
- cold-reload 验收必须显式重置浏览器运行态与背景 DOM，不能只清空 ledger Map 或沿用前一轮已经加载的舞台图。
- 检查 speaker channel 当前段：旁白只展示 neutral narrator asset；确有已识别并通过原身份 gate 的角色才显示 character asset。不能把此阶段的场景投影冒充身份/对白识别完成。
- 用与装备/道具/技能面板完全相同的 canonical HUD records 检查侧栏视觉请求：模块类型映射正确，source chat/message index 有效，背包条目不成为已装备实体；未知或无标签记录不会生成候选，无法唯一匹配时仍显示中性占位。
- 检查装备/道具/技能每个面板的视觉决策与详情；无唯一、无证据时保留文本和中性占位，不拿目录首项冒充命中。详情按钮必须能打开。
- 桌面与移动 viewport 检查 background、portrait、icon 的遮挡和缩放；不触发生成，不改写聊天正文或存档。

## 7. 当前已知限度与停止规则

- 该 change 只证明具备当前可见页 evidence 的场景自动匹配；不证明任意新题材、未见地点、所有语言都能正确判断。
- 不能从当前页精确定位当前场景时，正确结果是保持现有图/default，不能靠关键词兜底。
- 若真实分析不能可靠区分位置提及与转场，则先保留 unknown-safe；报告具体漏判样本，不得降置信度门槛或扩充正则以求显示图片。
- 若 8798 catalog 没有适配的唯一 scene/icon candidate，说明资源池缺项；本阶段不准擅自发布/替换素材或改 catalog pointer。
- 仅在针对性合同与真实页面验证、independent audit PASS 后才可报告本阶段完成。服务在线、端口健康或自动化测试单独通过都不算真实验收。

## 8. 2026-10-05 刷新恢复接线审计补充

- 冷启动历史候选必须携带与当前 cursor 相同 scope 的 `{ messageIndex, pageIndex }` cursor；候选构造统一走 `createSceneContinuityHistoryCandidate()`，避免只有单测 fixture 有 cursor、生产调用被严格早于过滤器全部排除。
- 新的同消息/同页视觉 bundle 不取消正在进行的历史回放；聊天、scope 或可见页变化仍中止旧回放。回放完成后按当前最新 bundle token 对经过 cursor/hash/timeline 校验的可见页重新投影。
- 开启 `galgameVisualDebug=1` 时记录历史候选数、provider 失败数和取消原因，不记录聊天正文、密钥或 provider 返回正文。
- 冷刷新真实验收必须继续使用同一个已有聊天，不发送玩家输入或生成新剧情；验收背景必须观察到非默认舞台资源身份，而不只看服务健康或头像占位。
## 9. 2026-10-05：分析代理不得阻塞视觉读取

现有聊天冷刷新会从历史页面恢复场景连续性。实测发现 8798 将两个只负责转发到 8801 的分析 POST 标成独占 `WRITE`，每个慢分析会阻塞同一服务的视觉上下文读取与素材读取；前端 5 秒健康探测随即报断开，冷恢复无法稳定取回 catalog/profile。修复将这两个无本地 store 副作用的代理路由改为共享 `READ`，不改变请求协议、Origin 检查、限额、取消或 analyzer 超时。

验收要求：在 scene-continuity 代理请求仍等待上游期间，`GET /v1/core/visual-context`、`GET /v1/presentation/health` 与已验证素材读取仍可完成；刷新现有存档后不调用 SillyTavern `Generate()`，恢复历史中最近一个可信场景背景与当前说话人头像。连接状态应反映实际 catalog/analyzer 可用性，不因分析 POST 排队而误报断开。

## 10. 2026-10-05：历史回放续跑与实际输出诊断

- 冷启动候选从当前 visible cursor 向前收集，至多检查 2,048 条原版消息，并在收集到最近 128 个有效角色候选后立即停止；候选再恢复为时间正序，以维持上下文页语义。不得先将全聊天展开成分页数组再截断。
- 回放检查点只用于跳过已完成的候选偏移，必须绑定当前 scope hash、目标 cursor hash、候选列表 hash 和 `sceneAnalyzerScope`。目标 message ID、原消息 hash、当前页 hash、时间线前缀 hash 或 source span 有任一变化，运行即取消且检查点不能授权任何场景。
- 实际现有存档的首轮冷刷新已确认：旁白中性头像加载成功；背景仍显示该作品 `default_stage` 绑定的 classroom 图，不是冰封遗迹匹配图；装备、道具、技能目前仍是占位图。视觉服务和 scene analyzer readiness 随后恢复为 connected。
- 当前历史分析器日志的脱敏事件主要报告 `MODEL_JSON_INVALID` 与 `SCENE_QUOTE_NOT_UNIQUE_OR_NOT_FOUND`。核心地点/转场仍保持 exact quote 和 unique span 门；仅移除非必要的引用地点/视觉标签歧义对整个响应的连带失败，并把核心 quote 错误分字段记录。仅 HTTP 200 或服务健康不能作为图像恢复验收。
