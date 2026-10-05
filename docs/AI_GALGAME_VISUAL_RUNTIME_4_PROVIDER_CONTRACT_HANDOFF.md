# VISUAL-RUNTIME-4 Provider 输出合同交接文档

> 用途：向 Provider 负责人索取可执行的输出合同，并决定本地适配器是否需要修改。
>
> 当前状态：Doubao OpenAI-compatible 合同已从 reference-analysis 实现和脱敏实时响应确认；本地适配器已完成。真实 ST/bridge/catalog 仍需单独验收。
>
> 本文保留原交接模板，同时在第 9 节记录已确认的 Doubao 合同和脱敏实测证据；第 9 节优先于模板中的待确认描述。

## 1. 合同交接原则

Provider 返回 2xx 只证明 HTTP 传输完成。RUNTIME-4 还要求响应经过本地闭合 validator，并得到 ready analysis 或合法 runtime hint。

以下信息必须由 Provider 方明确提供：

- 实际 endpoint 和 URL 归一化方式。
- model 名称和对应版本。
- 请求认证头和版本头。
- 上传 vision 的完整脱敏响应样例。
- 运行 text 的完整脱敏响应样例。
- 每个字段的精确类型、必填性、允许范围和未知字段规则。
- Provider 侧修正的版本、发布时间和回滚方式。
- Provider 侧是否保证单一 text block。
- Provider 侧是否可能返回 markdown fence、重复 key、BOM、空字符串或额外字段。
- 该合同是否与当前 visual-asset-service parser 完全兼容。

不能接受以下表述作为合同：

- “OpenAI compatible”。
- “接口返回 200”。
- “模型一般会返回 JSON”。
- “客户端可以自行补字段”。
- “confidence 可以按百分比换算”。
- “多余字段可以忽略”。
- “不确定时继续重试”。

## 2. 当前本地目标合同

### 2.1 上传 vision 请求

本地服务设置：

- 请求方法：POST。
- endpoint：配置 base URL 归一化为 /v1/messages。
- 请求头：content-type、accept、anthropic-version: 2023-06-01、x-api-key。
- 不发送 Bearer。
- body 只含 model、max_tokens 和一条用户消息。
- 用户消息包含固定识图任务和规范化 PNG。
- 不发送 ST key、角色卡、世界书、隐藏 prompt、完整聊天或 Provider 配置。
- 响应体上限 64 KiB。
- 请求超时、HTTP 错误和非 JSON 不进入 ready analysis。

Provider 应确认这些头和 body 字段不会被网关删除、重命名或改写。

### 2.2 上传 vision 响应 envelope

当前本地 parser 的可接受形态：

允许的 envelope key 是：

- 必填：content。
- 可选：id、type、role、model、stop_reason、stop_sequence、usage、container、context_management、service_tier。
- 出现 type 时必须为 message；出现 role 时必须为 assistant。
- 其他 envelope key 一律视为未知字段并拒绝。

~~~~json
{
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "{\"description\":\"...\",\"tagCodes\":[\"...\"],\"attributeCodes\":[\"...\"],\"confidence\":0.90,\"analyzerVersion\":\"...\"}"
    }
  ]
}
~~~~

说明：

- envelope 必须是 JSON object。
- content 必须是长度为 1 的 array。
- content[0] 必须只有 type 和 text。
- type 必须为 text。
- text 必须是 JSON object；允许当前 parser 明确支持的完整 json fenced text。
- JSON text 不允许 BOM、重复 key、未知 key、缺失 key、NaN、Infinity 或任意额外字段。
- envelope 中的可选元字段必须以当前 parser 的 allowlist 为准，Provider 不能自行增加字段后要求本地忽略。

### 2.3 上传 vision 内部 JSON

内部 JSON 的 root exact keys：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| description | string | 1 至 240 字符；不得含 URL、markup、脚本 |
| tagCodes | array | 当前 assetType 字典中的 0 至 16 个唯一 code |
| attributeCodes | array | 当前 assetType 字典中的 0 至 16 个唯一 code |
| confidence | number | JSON number；严格 0 < confidence <= 1 |
| analyzerVersion | string | 1 至 80 字符；安全字符集 |

Provider 输出不应包含 schemaVersion、status、errorCode、dictionaryVersion 或 dictionaryHash。那些值由本地服务从通过验证的结果生成。

### 2.4 运行 text 请求

本地服务设置：

- 请求方法：POST。
- endpoint：配置 base URL、/v1 或 /v1/messages 归一化为 /v1/messages。
- 请求头：content-type、accept、anthropic-version: 2023-06-01、x-api-key。
- 不发送 Bearer。
- body 只含 model、max_tokens 和一条用户消息。
- 用户消息只含固定视觉意图指令和 visibleContext.current/recent。
- visibleContext 当前文本上限 4000 Unicode code points。
- recent 最多 3 条，每条上限 1200 Unicode code points。
- 请求超时 3 秒，网络/超时最多一次受控重试。
- 不发送玩家原始 prompt、隐藏上下文、角色卡、世界书、完整 ST chat object 或 save。

### 2.5 运行 text 响应

root exact keys：

~~~~json
{
  "schemaVersion": "galgame.visual-runtime-hints.v1",
  "status": "ready",
  "dictionaryVersion": 2,
  "dictionaryHash": "sha256:<当前服务源码中的实际 hash>",
  "entities": [
    {
      "entityType": "scene",
      "codes": ["scene.forest"],
      "confidence": 0.86,
      "confidenceBand": "probable"
    }
  ]
}
~~~~

实体 exact keys：

- entityType：scene、character、equipment、item、skill 之一。
- codes：1 至 8 个唯一字典 code。
- confidence：0 至 1 的有限 JSON number。
- confidenceBand：unknown、weak、probable、explicit 之一。

Provider 必须保证：

- 每个 entityType 最多一个实体。
- codes 属于当前服务字典，并且与 entityType 或 feature 前缀匹配。
- ready 必须包含至少一个实体。
- unavailable/ambiguous 必须返回空 entities。
- 不输出 assetId、URL、路径、分数、选择、剧情、关系、状态写入或其他字段。
- dictionaryVersion 和 dictionaryHash 与本地服务当前源码完全一致。

## 3. 错误分类合同

Provider 方不需要看到本地内部错误全文，但必须知道下列类别代表合同失败：

| 本地类别 | 触发条件 | 处理 |
| --- | --- | --- |
| ANALYZER_ENVELOPE_INVALID | envelope 不是允许对象或元字段非法 | failed analysis |
| ANALYZER_CONTENT_INVALID | content 非单一 text block | failed analysis |
| ANALYZER_INVALID_JSON | text 不是合法 JSON | failed analysis |
| ANALYZER_OUTPUT_DUPLICATE_FIELD | JSON 出现重复 key | failed analysis |
| ANALYZER_OUTPUT_UNKNOWN_FIELD | 内部 JSON 有额外字段 | failed analysis |
| ANALYZER_OUTPUT_MISSING_FIELD | 五字段缺失 | failed analysis |
| ANALYZER_OUTPUT_DESCRIPTION_INVALID | description 不合规 | failed analysis |
| ANALYZER_OUTPUT_CODES_INVALID | 数组类型、长度或 code 形态不合规 | failed analysis |
| ANALYZER_OUTPUT_CODE_INVALID | code 不在字典 | failed analysis |
| ANALYZER_OUTPUT_DUPLICATE_CODES | 数组内或两数组之间 code 重复 | failed analysis |
| ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID | confidence 不是有限 JSON number | failed analysis |
| ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID | confidence 不在允许范围 | failed analysis |
| ANALYZER_OUTPUT_VERSION_INVALID | analyzerVersion 不合规 | failed analysis |
| RUNTIME_SCHEMA_INVALID | runtime hint root/entity 合同失败 | placeholder |
| RUNTIME_DICTIONARY_MISMATCH | runtime 字典版本/hash 不一致 | placeholder |

Provider 侧不得要求本地把上述错误降级为 ready、补默认字段或重标度值。

## 4. 脱敏合同样例要求

Provider 方应提交两个样例。样例必须：

- 保留真实 key 名、数组结构、类型和字段顺序。
- 替换图片、文本、token、id、URL query 和内部资源名。
- 不包含 token、ST key、角色卡、世界书、隐藏 prompt 或真实 Provider response body 之外的凭据。
- 说明样例对应的 Provider 版本和模型。

### 4.1 vision 样例记录

- 样例编号：
- Provider 版本：
- model：
- endpoint 形态：
- HTTP status：
- response content-type：
- envelope key 列表：
- content 数量：
- content block key 列表：
- text 是否为纯 JSON：
- text 是否使用 json fence：
- 内部五字段：
- dictionary code 来源：
- confidence 类型和范围：
- 是否可能有额外字段：
- 是否可能重复 key：
- 是否可能 BOM：
- 失败时的固定错误类别：

### 4.2 runtime 样例记录

- 样例编号：
- Provider 版本：
- model：
- endpoint 形态：
- HTTP status：
- response content-type：
- root key 列表：
- status 取值：
- dictionaryVersion：
- dictionaryHash：
- entity key 列表：
- entity 数量限制：
- codes 生成规则：
- confidence 规则：
- confidenceBand 规则：
- 空实体行为：
- 失败时的固定错误类别：

## 5. Provider 侧修正确认单

Provider 方完成修正后必须填写：

- [ ] 修正不改变 endpoint 认证语义。
- [ ] vision 响应只包含一个 text block。
- [ ] vision 内部 JSON 只包含五个字段。
- [ ] runtime 响应只包含五个 root key。
- [ ] 没有重复 key、BOM、未知字段或缺失字段。
- [ ] confidence 类型和范围已通过真实响应确认。
- [ ] dictionaryVersion/hash 与本地源码已核对。
- [ ] 已提供新的版本标识和发布时间。
- [ ] 已提供一次脱敏响应 digest。
- [ ] 已说明失败响应不会泄漏原文。
- [ ] 已说明回滚或重新发布方式。

本确认单未完成时，保持 D1 blocker。

## 6. 本地接收后的决策树

~~~~text
合同完整且与 parser 一致
  -> 不改 parser
  -> 先跑 fixture 和本地服务回归
  -> 进入 D2

合同完整但字段/包装与 parser 不一致
  -> Provider 侧优先修正
  -> 若必须本地适配，先写变更记录和反例 fixture
  -> reviewer 通过后进入 D2

合同不完整、响应仍被脱敏、字段仍未知
  -> 停止实时 replay
  -> 不猜字段、不补字段、不放宽 validator
  -> 保持 blocker

HTTP 2xx 但 schema 失败
  -> 记录固定 errorCode
  -> 不把 transport success 当 analysis success
  -> 返回 Provider 合同缺口
~~~~

## 7. 交接结论模板

Provider 方完成交接后，主线只写以下一种结论：

- ACCEPTED：合同完整，字段和本地 parser 一致，允许进入 D2。
- PROVIDER_FIX_REQUIRED：合同明确但 Provider 仍不符合，等待 Provider 版本修正。
- LOCAL_ADAPTER_CHANGE_REQUIRED：合同明确，需在允许目录内修改适配器并补 fixture。
- BLOCKED_CONTRACT_UNKNOWN：合同仍不完整，停止实时调用。

禁止写“应该兼容”“看起来兼容”或“2xx 所以可用”。

## 8. 安全声明

本文档只记录字段合同和脱敏摘要。以下内容禁止写入：

- Provider token
- ST key
- Authorization 值
- x-api-key 值
- 原始 Provider response body
- 原始任务文本
- 角色卡、世界书、隐藏 prompt
- 完整聊天对象
- 浏览器 localStorage 或 query 中的凭据

## 9. 已确认的 Doubao 合同（2026-09-26）

本节是当前实现的权威合同记录，覆盖前文的 Anthropic 模板。Provider 是本地私有配置中
reference-analysis 使用的 OpenAI-compatible endpoint；视觉服务只
读取配置元数据并在 child process 内传递密钥。

### 9.1 配置来源

- 默认文件：仓库根目录的私有 `.env.local`；可通过 `GALGAME_VISUAL_PROVIDER_ENV_FILE` 覆盖。
- 可用环境覆盖：`GALGAME_VISUAL_PROVIDER_ENV_FILE`。
- 读取字段：`REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_MODEL`、`REFERENCE_VISION_API_KEY`。
- 当前脱敏确认值：host=`aiself.vip`，model=`doubao-seed-2-0-lite-260428`，base path=`/v1`。
- 同名字段采用最后一个非空值；空值、缺值、非 HTTPS、query、fragment 或 userinfo 会触发隐藏输入回退。
- key 不写 PTY、日志、evidence、浏览器或 cache；服务进程退出后 wrapper 清理副本。

### 9.2 上传 vision 请求（正式生效）

- 本地 request style：`openai_chat_completions_vision`。
- endpoint：`POST https://aiself.vip/v1/chat/completions`。
- headers：`Content-Type: application/json`、`Authorization: Bearer <child-only key>`。
- body：`model`、`temperature: 0`、`max_tokens: 4096`、`response_format: {type: "json_object"}`，以及 system/user messages。
- user content 是固定任务文本和 `data:image/png;base64,...` 的 `image_url`；不发送 ST key、角色卡、世界书、隐藏 prompt 或完整聊天。
- response envelope 只接受 OpenAI Chat Completions 的 `choices` 单项和 assistant `message.content` 字符串；未知 envelope/message 字段 fail-closed。

### 9.3 上传 vision 输出

message content 必须解析为以下五个 key，顺序不影响验证：

```json
{"description":"short visible description","tagCodes":["character.human"],"attributeCodes":["feature.full-body"],"confidence":0.95,"analyzerVersion":"1.0"}
```

本地服务补齐 v2 `schemaVersion/status/errorCode/dictionaryVersion/dictionaryHash`，并按 assetType
字典校验 code、description、confidence 和 analyzerVersion。空标签的纯色/空白图片会得到
固定 failed 结果，不会被本地补成 ready；这是视觉门槛的一部分。
### 9.4 运行 text 请求（正式生效）

- 本地 request style：`openai_chat_completions_text`，与上传共用 base URL、model 和 child-only key。
- endpoint：`POST https://aiself.vip/v1/chat/completions`；认证为 `Authorization: Bearer`。
- body：`model`、`temperature: 0`、`max_tokens: 512`、`response_format: {type: "json_object"}`。
- system message 是服务端固定闭合合同，明确 root/entity exact keys、真实 dictionary version/hash、每类最多一个 entity 和 lowercase dictionary codes。
- user message 只含 `galgame.visual-runtime-hints-request.v1` 的 current/recent visibleContext；不发送剧情生成请求、资源正文、asset id、URL、ST key 或隐藏上下文。

运行时响应必须是：

```json
{"schemaVersion":"galgame.visual-runtime-hints.v1","status":"ready","dictionaryVersion":2,"dictionaryHash":"sha256:<current>","entities":[{"entityType":"scene","codes":["scene.forest"],"confidence":0.90,"confidenceBand":"explicit"}]}
```

本地 parser 只接受 exact root/entity keys、唯一 entityType、1 至 8 个合法 code 和有限 confidence。
status 为 ready 时至少一个实体；unavailable/ambiguous 时实体必须为空。分数和图片选择仍由
服务端 deterministic scorer 执行，provider 不生成剧情或选择。

### 9.5 脱敏实时证据

- 受控上传 `default_Seraphina.png`（400×600）返回 HTTP 200、analysis `ready`、description 长度 63、1 个 tag、1 个 attribute、analyzerVersion `1.0`。
- 受控上传 16×16 纯色 PNG 返回 HTTP 200、analysis `failed`、固定 `ANALYZER_OUTPUT_VALUE_INVALID`；诊断原因为 ready 输出没有可用闭合标签，未放宽 validator。
- 直接运行同一 Doubao endpoint 的 runtime 合同探针返回 HTTP 200、exact 五 root keys、`ready`、3 个唯一 entity type 和显式置信区间；强合同提示要求合并同类实体后与本地 schema 对齐。
- 以上记录只保留状态、计数和固定错误类别；没有保存 key、Authorization、原始 response、任务正文或聊天内容。

### 9.6 当前结论

结论：`LOCAL_ADAPTER_CHANGE_REQUIRED` 已完成并通过脱敏实时 provider 检查；不再等待未知字段猜测。
剩余验收只覆盖真实 SillyTavern target chat、original-runtime-bridge、manifest/Arc visualPresentation、
published catalog/content、浏览器展示顺序和回退行为。provider 合同通过不等于 RUNTIME-4 全链路通过。
