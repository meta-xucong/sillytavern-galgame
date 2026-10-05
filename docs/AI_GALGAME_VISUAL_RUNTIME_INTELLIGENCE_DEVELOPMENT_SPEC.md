# 运行时视觉智能匹配开发规格

> 文档版本：v1.1
> 文档状态：RUNTIME-2 partial/blocked；`VISUAL-RUNTIME-2M` reviewer-passed/done（仅 FileVisualAssetStore 迁移子阶段）；RUNTIME-1 reviewer-passed；`VISUAL-RUNTIME-3` reviewer-passed/done（仅 player 自然对白接线与统一 placeholder）；当前 `RUNTIME-4` Anthropic runtime adapter reviewer-passed/done，受控 live acceptance launcher implementation verifying（仅受控启动与双 Anthropic Messages 配置准备），未宣称生产 provider 或真实 ST 完成；详见 `AI_GALGAME_VISUAL_RUNTIME_4_LIVE_ACCEPTANCE.md`
> 生效日期：2026-09-05
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
> 关联基线：`docs/GALGAME_DESIGN_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`、`docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`

## 1. 用户目标与当前根因

Anthropic Messages vision 的响应 envelope、content block 与闭合输出使用独立的
固定错误类别：`ANALYZER_ENVELOPE_INVALID`、`ANALYZER_CONTENT_INVALID`、
`ANALYZER_OUTPUT_INVALID`。OpenAI-compatible `choices` envelope、多 content block、
非 text block、重复或未知输出字段均 fail-closed，不得变成 ready analysis。
闭合输出内部进一步使用 `ANALYZER_OUTPUT_UNKNOWN_FIELD`、
`ANALYZER_OUTPUT_MISSING_FIELD`、`ANALYZER_OUTPUT_VALUE_INVALID`、
`ANALYZER_OUTPUT_CODE_INVALID` 区分字段、值和字典代码失败，仍不放宽 ready 条件。
值失败还细分为 `ANALYZER_OUTPUT_DESCRIPTION_INVALID`、
`ANALYZER_OUTPUT_CODES_INVALID`、`ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID`、
`ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID`、
`ANALYZER_OUTPUT_VERSION_INVALID`、`ANALYZER_OUTPUT_DUPLICATE_CODES`，且不回显无效值。
固定识图任务要求 `confidence` 是严格满足 `0 < confidence <= 1` 的 JSON number；百分数、
字符串、零、`NaN`、`Infinity` 不重标度、不接受。
Anthropic vision 请求固定 `temperature: 0`，并要求完整返回五字段 JSON；缺字段不补默认值，
仍由 closed validator 拒绝。
provider envelope 或嵌入 text JSON 的重复 key 使用独立的
`ANALYZER_OUTPUT_DUPLICATE_FIELD`，始终拒绝且不采用最后一个值。

本阶段只解决一个问题：上传到视觉素材库的图片，能否根据游戏中已经显示给玩家的自然对白，自动理解当前场景并展示合适的图片。

用户目标原文：

- “用 llm 和识图模型辅助理解，自动展示匹配的图片。”
- “做个评分机制，评估匹配度，如果匹配度超过 60 分（满分 100 分），就展示图。低于 60 分就暂时空着，用一张通用的占位图展示。”

当前已有代码只完成了：

1. 上传图片时由独立服务端图像分析器生成图片标签；
2. 服务端根据已经存在的显式实体标签做 deterministic matching；
3. 玩家端收到具体 decision 后展示背景、立绘和图标。

当前缺失的链路是：自然对白 -> 运行时 LLM 提取视觉意图 -> 标签匹配 -> 图片展示。玩家适配层目前只识别“场景：森林”一类显式标签；没有显式标签时会生成 `unknown`，并在请求视觉服务前短路。因此当前底层测试通过不等于玩家实际对白能够自动匹配。

本文件把该缺口作为新的独立阶段 `VISUAL-RUNTIME-1`，不修改历史阶段的完成结论，也不恢复历史 VS-LLM/projection/binding 链。服务端只能处理已经展示给玩家的可见对白。

## 2. 整体完成定义

以下条件是整个 `VISUAL-RUNTIME` 路线（RUNTIME-1 至 RUNTIME-4）的最终完成条件，不是当前 RUNTIME-2 implementation 阶段的单阶段门槛：

- 自有 visual-asset-service 在服务端调用独立 LLM，理解玩家已经看到的对白；
- 图片上传时的图像分析标签与运行时 LLM 输出使用同一套有限标签字典；
- 服务端对每类候选计算 0-100 分，并由服务端固定执行 `score >= 60` 展示门槛；
- 分数低于 60、模型输出无效、候选冲突、图片分析不可用或服务失败时，玩家显示统一通用占位图，不显示错误图片；
- 对白、输入、Generate、聊天历史和 save/load 不被视觉请求阻塞；
- 浏览器不持有 provider token、ST key 或任何隐藏资源；
- 真实浏览器从自然对白到真实图片的端到端证据通过；
- 未修改 SillyTavern 后端、原版前端、root dependencies、ST 配置或启动行为；
- 2B/3C binding、Projection、old-save、rollback、receipt、玩家运行时剧情 LLM 和生图能力没有被恢复或混入。

“素材已上传”“图片分析成功”“显式标签单测通过”都不能单独证明本阶段完成。

## 3. 目标运行链路

```text
ST 原版 Generate
    ↓
原版聊天读回的、已经展示给玩家的可见消息
    ↓ 仅发送可见文本、说话人和有限最近上下文
玩家端调用自有 visual-asset-service core decision surface
    ↓
visual-asset-service 服务端调用运行时 LLM
    ↓
闭合 VisualRuntimeHintV1：scene/character/equipment/item/skill 标签
    ↓
服务端 deterministic scorer 对比已发布图片的 AI analysis tags
    ↓
score >= 60 的候选返回具体图片；否则返回 placeholder decision
    ↓
玩家端异步切换背景、立绘或图标
```

运行时 LLM 只理解视觉展示意图，不生成对白、不决定剧情、不生成选择、不修改 ST chat、不写 save，不返回任意 `assetId`。

## 4. 模型职责

### 4.1 上传期图像分析模型

职责是把图片转换为有限标签，例如：

```json
{
  "assetType": "scene",
  "tagCodes": ["scene.forest", "scene.ruins"],
  "attributeCodes": ["feature.dark", "feature.abandoned"],
  "confidence": 0.91
}
```

结果写入现有闭合 analysis cache、asset metadata hash 和 catalog hash。未配置或失败时保留图片，但该图片不得作为高置信度候选。

当前 `RUNTIME-2` 已迁移到分析记录 successor `galgame.visual-asset-analysis.v2`。其 root exact keys 为 `schemaVersion`、`status`、`description`、`tagCodes`、`attributeCodes`、`confidence`、`analyzerVersion`、`errorCode`、`dictionaryVersion`、`dictionaryHash`；前八项沿用现有 v1 类型/长度限制，后两项必须分别等于当前服务字典版本和 `sha256:<64 lowercase hex>`。RUNTIME-1 只建立运行时 hint/server adapter 合同；RUNTIME-2 禁止 v1 分析记录混入 v2 active catalog，已发布资产必须先全部生成并校验 v2 记录，任一资产迁移失败时保持旧 catalog active 但把 runtime compatibility 标为 blocked，运行时只返回 placeholder，不做部分 publish。`VISUAL-RUNTIME-2M` 已 reviewer-passed/done，仅表示 FileVisualAssetStore 自有临时批次、完整 v2 回读、active pointer、失败清理、五类迁移和重启 recovery 子阶段通过；该协议仍是可恢复的进程级失败语义，不宣称跨平台 crash-level cross-file atomicity。RUNTIME-2 整体仍保持 partial/blocked。

RUNTIME-2M 的 FileVisualAssetStore service-owned migration entry 不需要调用方
提供 catalog/assets；它从当前 active pointer 读取旧 catalog，收集全部 published
asset/ref，并在迁移前验证内容、metadata、hash 与 scope。重启时无 root commit
pointer 的完整 final batch 会在验证后清理，坏 batch 或临时 batch 仍 fail-closed。

### 4.2 运行时对白理解 LLM

职责是把自然对白转换为有限视觉标签，不负责选图。RUNTIME-2 使用 dictionary revision 2；下方 v2 词典与 analysis successor 是当前实现验证目标：

```json
{
  "schemaVersion": "galgame.visual-runtime-hints.v1",
  "status": "ready",
  "dictionaryVersion": 2,
  "dictionaryHash": "sha256:<64 lowercase hex>",
  "entities": [
    {
      "entityType": "scene",
      "codes": ["scene.forest", "scene.ruins"],
      "confidence": 0.86,
      "confidenceBand": "probable"
    }
  ]
}
```

LLM 输出必须是 closed JSON：

- 只允许五类 entity type；
- `codes` 必须来自当前服务端字典；
- 不允许 `assetId`、URL、路径、提示词、剧情状态、装备获得、战斗结果、选择、关系或任意新字段；
- 重复 key、未知 key、非法 code、超长文本、NaN/Infinity、超限数组和错误版本全部 fail-closed；
- 置信度不足或上下文含义不明确时输出 `ambiguous/unknown`，不能强行猜图。

### 4.3 `VisualRuntimeHintV1` closed contract

Root exact keys are `schemaVersion`, `status`, `dictionaryVersion`, `dictionaryHash` and `entities`.

- `schemaVersion` must equal `galgame.visual-runtime-hints.v1`;
- `dictionaryVersion` is the positive integer runtime dictionary revision and must equal the service source constant;
- `dictionaryHash` must match the service source hash in the form `sha256:<64 lowercase hex>`;
- `status` is one of `ready`, `unavailable`, `ambiguous`;
- `entities` is an array of at most five entries, with at most one entry for each type;
- each entry has exact keys `entityType`, `codes`, `confidence`, `confidenceBand`;
- `entityType` is one of `scene`, `character`, `equipment`, `item`, `skill`;
- `codes` contains 1-8 unique dictionary codes, each at most 64 Unicode code points;
- `confidence` is a finite number in `[0, 1]`; `confidenceBand` is one of `explicit`, `probable`, `ambiguous`, `unknown`;
- a ready response with no usable entity, unknown keys, duplicate JSON keys, BOM, oversized JSON, invalid numbers or dictionary mismatch is rejected and normalized to unavailable/ambiguous placeholder behavior;
- the service stores only this normalized object and its hash, never the raw provider response or prompt.

### 4.4 Runtime decision response

The v2 response keeps the existing core decision surface but uses the closed schema version `galgame.visual-core-visual-decisions-response.v2`. Root exact keys are `schemaVersion`, `ok`, `requestId`, `projectionId`, `projectionHash`, `sourceMessageIndex`, `sourceMessageHash`, `catalogId`, `catalogRevision`, `catalogHash`, `matcherVersion`, `scorerVersion`, `usesLlm`, `understandingStatus`, `errorCode` and `decisions`. `schemaVersion` must equal that literal; `usesLlm` is a server-produced boolean and is never accepted from the browser. `understandingStatus` is one of `ready`, `ambiguous`, `unavailable` or `failed`; the complete response `errorCode` enum is `null`, `RUNTIME_NOT_CONFIGURED`, `RUNTIME_TIMEOUT`, `RUNTIME_NETWORK_ERROR`, `RUNTIME_HTTP_ERROR`, `RUNTIME_INVALID_JSON`, `RUNTIME_SCHEMA_INVALID`, `RUNTIME_DICTIONARY_MISMATCH`, `RUNTIME_CONTEXT_INVALID`, `RUNTIME_CATALOG_INCOMPATIBLE`, `VISUAL_CONTEXT_INVALID`, `VISUAL_PROJECTION_HASH_MISMATCH`, `VISUAL_SOURCE_HASH_MISMATCH` or `VISUAL_CATALOG_INVALID`. A valid v2 request with runtime failure still returns `ok:true`, `decisions` containing placeholder decisions and the bounded status/error; `ok:false` is reserved for integrity/catalog rejection and also returns an empty `decisions` array. A malformed request that cannot produce this identity-bearing result uses the separate closed error schema `galgame.visual-core-visual-decisions-error.v1` with exact keys `schemaVersion`, `ok`, `requestId` and `errorCode`; its complete `errorCode` enum is `VISUAL_REQUEST_INVALID`, `VISUAL_CONTEXT_INVALID`, `VISUAL_PROJECTION_HASH_MISMATCH`, `VISUAL_SOURCE_HASH_MISMATCH`, `VISUAL_PROFILE_INVALID`, `VISUAL_CATALOG_INVALID` and `VISUAL_INTERNAL_ERROR`. `requestId` is the validated request id when available and JSON `null` when absent or invalid; no raw validation/provider detail is returned.

Each decision reuses the current validated `VisualCandidateDecisionV1` field contract, including `entityKey`, `entityType`, `assetId`, `assetVersion`, hashes, `score`, `scoreBand` and `reasonCodes`. A score below 60 may use the existing type-specific unknown decision internally for provenance, but the player must map it to the one common placeholder and must not render that unknown asset as a concrete match. The frontend cannot raise a score or convert a placeholder into a concrete image.

## 5. 请求与服务边界

### 5.1 请求入口

复用现有玩家 core decision surface：`POST /v1/core/visual-decisions`，增加版本化 v2 请求合同。请求 `schemaVersion` 必须等于 `galgame.visual-core-visual-decisions-request.v2`；不新增旧 Projection、proof、ticket 或 binding route。

v2 请求只允许包含：

- 现有 v1 的 `requestId`、`projection`、`visualProfile`、`expectedProjectionHash`、`expectedSourceMessageHash`、`createdAt` 和 `schemaVersion`；
- 新增 `visibleContext`，包含当前已经展示消息和最多 3 条最近已经展示消息；
- `projection` 必须原样遵守现有 `assertCoreProjection` 合同：`projectionId`、`projectionHash`、`sourceMessageIndex`、`sourceMessageHash`、`releaseId`、`scenarioId`、`scenarioVersion`、`arcId`、`chatId`、`entities`；
- `entities` 中每项必须原样遵守现有 `assertCoreProjectedEntity` 合同，显式实体只作为快速路径/补充输入，不能包含 assetId；
- v2 root exact keys 为 `schemaVersion`、`requestId`、`projection`、`visibleContext`、`visualProfile`、`expectedProjectionHash`、`expectedSourceMessageHash`、`createdAt`。

请求不得包含：

- ST key、provider key、角色卡、世界书、隐藏 prompt、完整 context、raw resource body；
- 浏览器传入的 assetId、score、catalog mutation、bindingId、save 或玩法状态；
- 任意未显示给玩家的原版聊天内容。

服务端先使用显式实体快速路径；显式信息不足时才调用运行时 LLM。LLM 只在 visual-asset-service 服务端环境中运行，浏览器不直接请求 provider。

`visibleContext` 是“展示层数据来源”而不是授权凭证：玩家适配层只在把消息渲染到自定义界面后，按闭合 DTO 复制当前文本和有限最近文本；visual-asset-service 将其视为不可信输入，不声称能从浏览器证明“确实已经显示”。这条轻量边界足够用于只读画面选择，因为该 DTO 不能授权、改写或读取任何 ST/剧情/save 资源；即使玩家伪造文本，影响也只能是自己的图片候选。服务端必须拒绝 DTO 外的字段，且静态/网络测试必须证明没有隐藏聊天、prompt、角色卡、世界书、resource body 或 ST 配置被发送。不得为证明展示状态恢复历史 Projection/proof/ticket/binding 链。

Exact v2 request keys are `schemaVersion`, `requestId`, `projection`, `visibleContext`, `visualProfile`, `expectedProjectionHash`, `expectedSourceMessageHash` and `createdAt`. `visibleContext` has exact keys `current` and `recent`; `current` has `index`, `role`, `speaker`, `text`; `recent` is an array of the same message shape. The request body is limited to 16 KiB, current text to 4,000 Unicode code points, speaker to 160, and recent messages to at most 3 entries/1,200 code points each. The service rejects unknown keys, duplicate keys, BOM, prototype-shaped objects, NaN/Infinity and missing or mismatched projection/source hashes.

The integrity binding is exact but deliberately not an authorization proof. Both player and service use the same shared helper: normalize each message to `{index,role,speaker,text}` with NFC text and no trimming, serialize with `canonical-json.v1`, then calculate `messageHash = sha256(utf8(canonical-json.v1(message)))` and `recentHash = sha256(utf8(canonical-json.v1(recent)))`. The service requires `projection.sourceMessageIndex === visibleContext.current.index`, `projection.sourceMessageHash === messageHash`, `expectedSourceMessageHash === messageHash`, `expectedProjectionHash === projection.projectionHash`, and `projection.sourceMessageHash === expectedSourceMessageHash`. `recentHash` is used only in the runtime cache key and is never treated as proof that the browser displayed those messages. Any mismatch returns `VISUAL_CONTEXT_INVALID`/placeholder without invoking the provider. This is a consistency check for a display-only request, not a restored Projection/proof/ticket/binding chain.

The runtime LLM call has a bounded 3-second timeout and at most one retry for a transport failure. The visual request never waits for a second retry before the player renders dialogue. A cache key is derived from current/recent visible-message hashes, dictionary version, active catalog hash and runtime analyzer scope; it never contains a token or raw provider response.

### 5.2 服务端配置

运行时 LLM 只允许使用视觉服务自己的服务端环境变量：

- `GALGAME_VISUAL_RUNTIME_BASE_URL`
- `GALGAME_VISUAL_RUNTIME_TOKEN`
- `GALGAME_VISUAL_RUNTIME_MODEL`
- `GALGAME_VISUAL_RUNTIME_REQUEST_STYLE`
- `GALGAME_VISUAL_RUNTIME_CACHE_SCOPE`

这些值不得写入 `frontend/**`、`public/**`、scenario package、localStorage、日志或 evidence。不得读取或复用 ST key/config 作为隐式来源。未配置时，服务必须返回 placeholder 状态，不得伪造 LLM 标签。

The runtime analyzer must send only the bounded visible-context DTO and a fixed server-owned extraction instruction. It must not forward the player's original prompt, hidden context, system prompt, character card, world book, raw ST chat object or provider configuration. Logs may record only request digest, status, bounded error code, duration and retry count.

Provider transport is closed: request method is POST; redirects are disabled; the current adapter accepts a direct `application/json` closed hint response, while RUNTIME-2 consumes the validated v2 analysis/catalog data. RUNTIME-4 adds only the server-side `anthropic_messages_text` style, which normalizes a configured Anthropic-compatible host, `/v1`, or `/v1/messages` URL to `/v1/messages` and extracts one text block through the existing Anthropic parser before the same `VisualRuntimeHintV1` validator. It sends `model`, `max_tokens`, `anthropic-version: 2023-06-01`, `x-api-key` and only the fixed instruction plus bounded visible context; upload-time `anthropic_messages_vision` now uses the Anthropic `x-api-key` header (never Bearer), while the closed-json analyzer style retains its Bearer contract. Response headers are limited to 16 KiB and the response body to 32 KiB; non-2xx upload status maps to fixed non-sensitive categories (`ANALYZER_AUTH_ERROR`, `ANALYZER_REQUEST_INVALID`, `ANALYZER_RATE_LIMITED`, `ANALYZER_UPSTREAM_ERROR` or generic `ANALYZER_HTTP_ERROR`); malformed/BOM/duplicate-key JSON is rejected before parsing; raw response and request content are never logged.

For this MVP, runtime hint cache is memory-only: maximum 256 entries, TTL 300 seconds, in-flight requests deduplicated by the exact key `sha256(canonical-json.v1({currentHash,recentHash,dictionaryVersion,dictionaryHash,catalogHash,runtimeScope}))`. Restart clears the cache. Cache values contain only normalized `VisualRuntimeHintV1`; no raw visible text, prompt, token or provider response is persisted.

The current runtime dictionary is a versioned successor of the upload-only dictionary: the implementation must increment `dictionaryVersion`, recompute `dictionaryHash`, and republish/reanalyze affected assets in the same controlled batch. It must retain all currently accepted codes and add only the approved concrete codes required for runtime matching, including `skill.fireball`, `skill.fire`, `skill.shadow`, `skill.protective-ward` and `skill.ward`. The exact final dictionary array and hash must be captured from source in the implementation evidence; runtime output using a code not present in that exact source dictionary is rejected.

The closed v2 target tag arrays are:

```text
scene:      scene.interior, scene.exterior, scene.ruins, scene.forest, scene.city, scene.dungeon, scene.night, scene.day
character:  character.humanoid, character.elf, character.dwarf, character.human, character.rogue, character.mage, character.armored
equipment:  equipment.weapon, equipment.armor, equipment.melee, equipment.ranged, equipment.magical, equipment.common
item:       item.consumable, item.quest, item.key, item.treasure, item.tool, item.misc
skill:      skill.magic, skill.stealth, skill.social, skill.combat, skill.crafting, skill.survival,
            skill.fire, skill.fireball, skill.shadow, skill.protective-ward, skill.ward
```

The existing feature arrays remain unchanged for v2. No other tag or feature code is accepted until a later dictionary revision gate.

The migration is closed: dictionary revision `1` is not runtime-compatible with revision `2`; revision `2` retains every revision-1 tag/feature code and adds exactly the five skill codes listed above. `dictionaryHash` is computed as `sha256(canonical-json.v1({version:2,tags:<exact target tag arrays>,features:<unchanged source feature arrays>}))`, represented with the `sha256:` prefix. Upload analysis records, published catalog refs and runtime hints must all carry the same revision/hash. A revision-1 asset or hint is rejected until that asset is reanalyzed and republished in the same controlled migration; no silent hash or code remap is allowed. The implementation gate must capture the source arrays, the computed hash, the old-to-new migration report and a five-type reanalysis/publish result.

## 6. 评分合同

每个 entity type 独立计算 0-100 分。分数只能由服务端生成，浏览器不能覆盖。

### 6.1 基础评分

| 项目 | 分值 |
| --- | ---: |
| 核心概念 code 精确重合 | 0-40 |
| 类型、身份或主体匹配 | 0-25 |
| 外观、状态、动作或环境属性 | 0-20 |
| 最近可见上下文连续性 | 0-10 |
| LLM 与图片分析置信度 | 0-5 |
| 明确冲突惩罚 | 0 至 -20 |

分数最终限制在 0-100。父级泛标签不能单独产生高分：例如 `skill.magic` 只能贡献低权重，`skill.fireball`、`skill.stealth` 等具体 code 才能进入高分匹配。

The scorer is deterministic. For one runtime entity define `R` as its unique runtime `codes`, `A` as the union of the candidate's `analysisTagCodes` and `analysisAttributeCodes`, `V` as the unique `code` values from that entity's trusted `projection.entities[].visibleAttributes` (never free-form text), and `N` as the candidate's trusted service-internal `negativeTagCodes`. Define `D = R ∩ A`, `G = D ∩ GENERIC_PARENT_CODES`, `X = D - GENERIC_PARENT_CODES`, and `C = R ∩ N`. The implementation must use these exact integer terms:

- `core = round(40 * min(1, |X| / max(1, |R - GENERIC_PARENT_CODES|))) + min(10, 10 * |G|)`;
- `typeIdentity = 25` when the candidate asset type equals the entity type, otherwise `0` (a mismatched candidate is ineligible);
- `attributeState = round(20 * min(1, |(V ∪ R) ∩ analysisAttributeCodes| / max(1, |V ∪ R|)))`;
- `recentContinuity = 10` exactly when `visibleContext.recent.length > 0` and `|D| > 0`, otherwise `0`;
- `confidence = round(5 * min(runtimeEntity.confidence, candidate.analysisConfidence))` for a ready analysis, otherwise `0`; `candidate.analysisConfidence` is copied from the validated asset analysis `confidence` field and is not browser-controlled;
- `conflictPenalty = min(20, 10 * |C|)`.

`rawScore = core + typeIdentity + attributeState + recentContinuity + confidence - conflictPenalty`; the base score is `Math.max(0, Math.min(100, rawScore))`. `GENERIC_PARENT_CODES` is the closed set `{scene.interior, scene.exterior, character.humanoid, equipment.common, item.misc, skill.magic}`. For the character safety rule, `CHARACTER_IDENTITY_CODES` is exactly `{character-explicit-name}` and `CHARACTER_APPEARANCE_CODES` is exactly `{character-explicit-appearance, character-explicit-clothing, character-explicit-species, character-explicit-gender-presentation}`; `hasIdentity`/`hasAppearance` are set-membership checks against `V`. Apply hard safety caps after the base score: if `runtimeEntity.confidence < 0.60`, `confidenceBand` is `ambiguous` or `unknown`, `|X| = 0` (generic-only), the asset analysis is not `ready`, or a character lacks identity **or** appearance evidence, set `finalScore = min(baseScore, 59)`. A semantic conflict is exactly `|C| > 0`; `N` is the trusted service-internal `negativeTagCodes` array copied from the catalog candidate record (current migrated assets use `[]`, and provider output cannot write it). A conflicting candidate is ineligible and returns placeholder even when its base score is 60 or higher. Score bands are `unknown` for 0-59, `medium` for 60-79 and `high` for 80-100. Candidates are sorted by higher `finalScore`, fewer conflicts, higher candidate analysis confidence, lower integer `assetVersion` and lexicographic `assetId`; only after all keys are applied, an unresolved exact tie returns placeholder rather than selecting by upload order. The implementation evidence must include 59/60/61 fixtures, generic-only and low-confidence caps, character missing-identity and missing-appearance caps, conflict rejection, and the intermediate terms for each fixture.

### 6.2 安全上限

- LLM 置信度低于 0.60：候选最高 59 分；
- 只有泛化类别、没有具体概念：最高 59 分；
- character 没有身份或可信外观证据：最高 59 分；
- 候选类型不一致、图片分析不可用、内容 hash/MIME/catalog 不一致：0 分；
- 候选存在未解决冲突或最高候选不唯一：返回 placeholder；
- 任何 provider/schema/字典错误：不产生候选分数。

### 6.3 展示门槛

```text
score >= 60       -> matched，展示具体图片
score < 60        -> placeholder，展示统一通用占位图
无效/超时/未配置 -> 统一 placeholder，不阻塞对白
```

统一占位资源固定为 player 自有 `./assets/visual-placeholder.svg`，由 public/game
构建复制到同一路径；scene 背景、character 立绘和三个图标槽位回退时都使用它，
不能使用 manifest 默认背景、标题立绘或 `?` 空框。请求开始时不清除上一张已验证图；
普通对白若服务返回 `ambiguous` 且没有新候选，保留当前展示。识别到新的视觉意图但
没有达到 60 分、服务失败、图片失败或完整性失败时，切换为统一占位图。玩家界面不
显示分数、标签、模型名、hash 或技术错误。

## 7. 前端展示规则

- 对白先显示，视觉请求异步执行；视觉请求不能阻塞 ST 回复、玩家输入、历史和存档。
- `matched` 结果通过现有安全 content route 预加载，成功后再切换，避免半加载画面。
- `placeholder` 统一使用一张中性占位图；服务内部仍保留 entity type，不能把低分结果静默映射成另一种类型。
- 服务失败、网络超时、LLM 未配置、图片不存在或 hash 不符时，保留当前已验证画面或显示占位图。
- 新消息到达后用 request token 取消旧显示任务，防止旧对白的图片覆盖新对白。
- 玩家端不得显示“LLM”“provider”“ST”“token”“catalog”“score”等内部概念。

### 8.1 分阶段完成门槛

- `RUNTIME-1` 只在服务端 visible-context v2 合同、哈希一致性、closed runtime hint、服务端 analyzer adapter、超时/重试/失败降级/缓存和 fake analyzer 测试通过后完成；不要求玩家端调用、不要求 scorer 消费 hint，也不修改上传期 analysis/catalog。
- `RUNTIME-2` 当前 partial/blocked：已落 dictionary v2/analysis v2 迁移计划、确定性 0-100 scorer、`59/60/61` 和冲突/低置信度/占位图规则；FileVisualAssetStore 生产迁移激活的临时批次、跨文件提交和重启读回由 `VISUAL-RUNTIME-2M` 独立 gate 管理，当前不得声称 RUNTIME-2 migration 或运行时智能选图整体完成。
- `RUNTIME-2M` reviewer-passed/done：已在 visual-asset-service server/test/README 与 docs/.codex-longrun 范围内通过 FileVisualAssetStore 自有临时批次、完整 v2 校验、active pointer 激活、失败清理、五类 v1→v2 迁移和重启 recovery；这只完成迁移子阶段，RUNTIME-2 整体仍 partial/blocked。
- `RUNTIME-3` reviewer-passed/done，gate 文档为 `AI_GALGAME_VISUAL_RUNTIME_3_PLAYER_DIALOGUE_IMPLEMENTATION_GATE.md`；仅完成 player 自然对白 v2 请求接线、已渲染 current/recent visibleContext、中性五类槽位、异步展示、统一 placeholder 和普通无意图保留规则。
- `RUNTIME-4` 已 reviewer-passed/done，仅限 Anthropic runtime adapter 与 local contract，材料为 `AI_GALGAME_VISUAL_RUNTIME_4_READINESS_ADMISSION.md`；真实 AISelf 调用、浏览器/ST acceptance、manifest/profile auto-binding 仍未执行；未配置独立 provider 时只能返回 placeholder，不能宣称生产 AI 已接通。不得自动进入历史重型链路。

## 8. 允许修改范围

本阶段唯一允许修改：

- `external-modules/visual-asset-service/server.mjs`
- `external-modules/visual-asset-service/test.mjs`
- `external-modules/visual-asset-service/README.md`
- `frontend/player/src/main.js`
- 必要的 `frontend/shared/src/**` 纯视觉 schema/helper
- 由源码构建产生的 `public/game/**`
- 必要的 `frontend/player/tests/**`、`frontend/tools/**` 测试夹具
- 受控自有视觉服务启动入口中与 runtime analyzer 配置有关的非秘密配置
- 本规格、总控视觉文档、backlog、pre-materials、`.codex-longrun/**`

每个文件必须能映射到本阶段的请求、理解、评分、展示或验收要求。不得顺手重构无关 UI、聊天、存档或后台。

## 9. 明确禁止

- 本阶段不恢复历史 Projection、proof、binding、old-save、rollback 链路；这些能力继续留在历史/后置文档中。
- 修改 `src/**`、`server.js`、`plugins.js`、ST backend、原版 `public/index.html/script.js/style.css`；
- 读取、转发或保存 ST key、原版 provider 配置、角色卡、世界书、隐藏 prompt/context；
- 浏览器直连 LLM/provider；
- 将 LLM 结果写入剧情状态、聊天、save、manifest、binding、old-save 或玩法数据；
- 恢复 Projection issuer/proof/stub、visual-match 历史 heavy route、binding writer、receipt、rollback/retention；
- 让 LLM 直接返回或决定 assetId；
- 生成本地对白、固定剧情、选择、结局或 scripted fallback；
- 扩展 WebP/JPEG、生图、视频、player/admin 技术设置；
- 把 test-double、显式标签、手工 JSON 或旧 direct matcher 结果冒充真实自然对白端到端通过。

## 10. 开发阶段与唯一写入责任

| 阶段 | 唯一写入负责人 | 产出 | 放行条件 |
| --- | --- | --- | --- |
| RUNTIME-DOCS | 主控 | 本规格与 active docs 同步 | 独立文档审计 PASS |
| RUNTIME-1 | 主线开发线程 | runtime hint closed contract、服务端 LLM adapter、fake analyzer tests | schema、超时、错误、无密钥边界通过 |
| RUNTIME-2 | 主线开发线程 | 60 分 scorer、泛标签/冲突/边界处理 | 59/60/61 和错误降级通过 |
| RUNTIME-3 | 主线开发线程 | player 自然对白接线、异步图片/占位图展示 | 不阻塞对白，真实 bundle 通过 |
| RUNTIME-4 | 主线开发线程 | 真实服务与真实浏览器端到端验收 | 自然对白 -> 具体图片/占位图证据通过 |
| RUNTIME-AUDIT | 独立审查 | 范围、源码、测试、浏览器和证据审查 | 所有必需项符合或明确 blocker |

主线不得跳过 RUNTIME-DOCS 直接落码；RUNTIME-1/2/3 可在同一 implementation gate 内串行实现，但每阶段必须先跑窄测试再推进。

## 11. 测试矩阵

### 11.1 单元与服务测试

- v2 request literal/closed keys：`galgame.visual-core-visual-decisions-request.v2`、expected projection/source hash、current/recent message hash binding、unknown key/duplicate/BOM/prototype/NaN/Infinity rejection；malformed requests use only the closed error schema;
- v2 success/failure response：exact root keys, `understandingStatus`/`errorCode` enums, runtime failure returns `ok:true` placeholder decisions, integrity/catalog failure returns `ok:false`, no raw provider/validation detail;
- closed runtime hint：未知 key、重复 key、BOM、NaN/Infinity、非法 code、超长输出全部拒绝；
- analysis v2：exact dictionary version/hash fields, revision-1 mixed-catalog rejection and migration planning are covered; temporary-batch validation, FileVisualAssetStore atomic publish, failed-batch cleanup and restart read of only a complete v2 batch remain a separately gated production migration requirement；
- provider 未配置、超时、错误 JSON、错误 schema、未知标签时图片不删除，返回 placeholder；
- provider 请求只含可见文本和固定任务，不含 ST key、隐藏资源、prompt/context；
- 同一 message hash + catalog hash + runtime scope 在单进程内幂等，命中 TTL/256 条目/in-flight dedupe；重启清空内存缓存，重启后的首个请求必须重新分析，不能声称缓存读回；
- 缓存超过 300 秒、字典/hash/catalog/runtime scope 任一变化、服务重启或坏记录时必须 miss；并发相同 key 只发一个 provider 请求，缓存不保存原文、prompt、token 或原始响应；
- score 59 返回 placeholder，score 60 和 61 返回 matched；
- 泛标签、角色歧义、类型冲突、分析不可用和 hash/MIME 错误不展示具体图；
- 具体标签如森林、遗迹、火球、潜行、钥匙和对应素材能稳定选中；
- 同分或冲突候选使用稳定 tie-break 或 placeholder，不按上传顺序随机选择。

### 11.2 真实浏览器验收

至少覆盖：

1. “众人走进雾气笼罩的废弃森林” -> 森林/遗迹背景达到 60 分并显示；
2. “敌人施放火球术” -> 火球技能图达到 60 分并显示；
3. 只有模糊的“他使用了魔法” -> 低于 60，显示通用占位图；
4. 不相关或没有视觉意图的对白 -> 不误切换；
5. LLM 服务关闭或超时 -> 对白仍正常显示，视觉回退；
6. 桌面和移动端均无横向溢出，玩家看不到技术字段；
7. 浏览器 Network 中没有 provider URL、Authorization token 或 ST key。

真实测试必须使用当前 `/game/`、已发布素材和真实 visual-asset-service。测试替身只能证明 schema 和失败行为，不能标记 RUNTIME-4 通过。

## 12. 证据与停机规则

- 证据必须绑定最终源码版本，UTF-8、无 BOM、非空、JSON 可读、`ok=true`；
- 失败证据保留并标记 superseded，不覆盖历史失败；
- 发现范围越界、契约漂移、重复修补或同一问题反复失败时，停止后续阶段，先做根因审计；
- 生产 runtime token 缺失时，只能验证 unavailable/placeholder，不得伪造真实 AI PASS；
- 真实 provider 不可用时，RUNTIME-1/2/3 可以完成本地合同与 fake analyzer 验证，但 RUNTIME-4 必须保持 blocker；
- 不得以“旧 VS-LLM 文档允许”或“旧 deterministic 测试通过”代替本阶段自然对白端到端证据。

## 13. 最终交付口径

完成后只能宣称：`VISUAL-RUNTIME-1` 运行时视觉智能匹配通过，且在 60 分门槛下实现对白到图片的异步展示。

不得宣称：完整 Galgame 完成、ST 后端被改造、玩家运行时剧情 LLM 完成、历史 VS/Projection/binding/old-save 链完成，或所有对白都必然有具体图片。

## 2026-10-04 后续窄阶段：页面场景 continuity

历史 “不恢复 Projection issuer/proof/binding” 仍禁止恢复旧的剧情授权/持久绑定 heavy route。本条不恢复旧链路：用户明确要求恢复舞台背景后，新增的允许项是独立 presentation-analysis-service 的 current-visible-page scene-continuity producer，细则见 `GALGAME_VISUAL_PAGE_CONTINUITY_RESTORE_2026-10-04.md`。它只通过精确原文 evidence 构造既有 `scene-continuity.v1`，无 chat/save/manifest/binding 写入，无 assetId 由模型选取，不调用/复刻原版生成。

该新 producer 是 RUNTIME-4 之后的独立窄阶段（RUNTIME-5），不能记作 RUNTIME-4 的原验收已通过，也不能启用 speaker/identity/roster 自动解析。页面分析响应只有在服务、shared 投影、8798 唯一匹配与实际 `/game/` 图片加载全部验证后才算通过；端口健康或 provider 配置存在不算通过。
