# AI 剧本自动整理与一键上架开发规范

> 文档状态：实施基线 v1.0  
> 生效日期：2026-07-26  
> 适用范围：`/game-admin/` 小白导入流程、`external-modules/script-import-assistant/**`、共享前端客户端与验收工具
> 后续完善：`docs/AI_GALGAME_ULTIMATE_ADAPTIVE_COMPLETION_PLAN.md` 定义服务端 LLM 如何在导入期进一步输出展示模板推荐；该推荐仍只属于管理员草稿和展示配置，不进入玩家运行时剧情权威。

## 1. 目标

让非技术管理员只做三件事：

1. 上传剧本包或剧本文本。
2. 等待 AI 整理成可上架草稿。
3. 点击确认上架；如果不满意，点击重新整理。

管理员默认不再理解角色卡、世界书、开场聊天、章节绑定、运行配置或发布格式。系统把这些工作交给外接的“剧本整理助手”完成。

## 2. 硬边界

- 剧本整理助手只属于导入/上架阶段，不属于玩家游玩阶段。
- 玩家剧情运行仍由 SillyTavern 原版角色、世界书、聊天和原版 Generate 语义负责。
- 整理助手不得定义 `SceneResult`、剧情节点、固定分支、固定结局、本地 scripted fallback 或前端剧情状态。
- 未配置 LLM 时允许的 deterministic 路径只属于导入期摘要和导入计划，不属于玩家剧情 fallback，不得被 `/game/` 调用。
- 整理助手生成的玩家可见开场必须写入原版 SillyTavern chat seed；前端 manifest 只保存引用。
- 角色、世界设定和开场记录最终以原版 ST 资源为准；自定义前端只保存 `character/avatar/worldBook/chatSeedId` 等引用。
- LLM API key 只能在外接服务端或部署环境中使用。不得写入 `/game/`、`/game-admin/`、静态文件、manifest、localStorage、IndexedDB 或日志。
- 如果要“沿用 ST 使用的 LLM key”，部署方式是让外接整理服务读取同一份服务端密钥来源，例如同一环境变量、同一密钥管理器或受控本地配置；浏览器不得直接读取 ST 密钥。

## 3. 管理员体验

默认路径：

1. 进入 `上架故事`。
2. 点击“上传剧本包”，选择 `.txt/.md/.json` 等文本材料。
3. 点击“AI 整理”。
4. 页面显示普通摘要：
   - 故事名
   - 推荐玩法样式
   - 主要角色
   - 世界设定数量
   - 开场记录是否准备
   - 能否上架
5. 点击“确认并上架”。
6. 如果摘要明显不对，点击“重新整理”。

高级详情继续折叠，只供排错。普通路径不得展示 raw JSON、密钥、模型、API key、Token、prompt、角色卡正文、世界书正文或底层接口名。

## 4. 外接服务

服务目录：

```text
external-modules/script-import-assistant/
  server.mjs
  test.mjs
  README.md
```

服务必须独立运行，不修改 SillyTavern 后端，不注入中间件，不改变原版启动行为。

### 4.1 接口

健康检查：

```http
GET /v1/health
```

整理草稿：

```http
POST /v1/admin/script-import/drafts
```

请求体：

```json
{
  "protocolVersion": "galgame.script-import-assistant.request.v1",
  "files": [
    {
      "name": "story.md",
      "text": "剧本正文",
      "type": "text/markdown"
    }
  ],
  "options": {
    "locale": "zh-CN",
    "preferredTemplate": "auto"
  }
}
```

重新整理：

```http
POST /v1/admin/script-import/drafts/{draftId}/redeploy
```

确认导入到原版 ST：

```http
POST /v1/admin/script-import/drafts/{draftId}/confirm
```

确认成功返回只含引用的 manifest 草稿；管理员端随后走现有发布/回滚流程。确认成功只代表原版 SillyTavern 角色、世界书和开场 chat seed 已经通过现有 API 创建或核对完毕，返回的 `ArcBindingV1.status` 必须保持 `draft`，不得填充 `publishedAt`，不得改变当前 `ActiveRelease`，也不得改写旧存档绑定。

AA1 只实现接口形状和安全边界，`confirm` 返回 `SCRIPT_IMPORT_CONFIRM_DEFERRED_TO_AA3`，不得写入原版 ST 资源，也不得返回“已导入/已发布”。AA3 才允许 `confirm` 写入明确命名的 `Galgame_AIImport_*` / `galgame-aiimport-*` 原版角色、世界书和 chat seed，并返回 `ready-for-publish` 草稿；正式上架必须继续走现有管理员发布/回滚流程。

### 4.2 认证与访问控制

`/v1/admin/**` 必须 fail-closed。服务启动或请求处理时必须满足以下任一条件：

1. 配置有效的 `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN`，并要求所有 `/v1/admin/**` 请求携带 Bearer、`X-Galgame-Admin-Token` 或受控 cookie。
2. 由外部反向代理、独立 admin service、mTLS、受控本地会话或等价机制完成管理员认证，并且整理服务只能接收该受信边界后的请求。

如果既没有有效 token，也没有明确的外部认证边界，服务必须拒绝所有 `/v1/admin/**` 请求，或直接拒绝启动管理员接口。不得以开发模式、隐藏路由、CORS、同源页面、按钮隐藏或前端路由守卫作为认证。

细化规则：

- 如果配置了 `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_EXPIRES_AT` 但日期不可解析，必须 fail-closed，拒绝管理员请求或拒绝启动管理员接口。
- `GALGAME_SCRIPT_ASSISTANT_TRUST_EXTERNAL_AUTH=true` 只是声明服务位于受信边界后，不是认证本身。它只能在 loopback/受控本地通道中直接使用；非 loopback 暴露时必须有可验证的代理/mTLS/身份边界，例如由代理注入的 `GALGAME_SCRIPT_ASSISTANT_TRUSTED_PROXY_TOKEN` 对应请求证明。
- 浏览器请求带 `Origin` 时，`/v1/admin/**` 必须命中明确的 `GALGAME_SCRIPT_ASSISTANT_CORS_ORIGIN` 白名单；未配置白名单时跨来源管理员请求必须拒绝，即使 Bearer token 正确。只有明确白名单 origin 可以返回 `Access-Control-Allow-Credentials: true`，禁止 `*` 与 credentials 同时使用；浏览器端不得持有或发送 `X-Galgame-Trusted-Proxy-Token`，该证明只能由同源反代或受控 admin service 注入。

同一保护边界必须覆盖：

- 上传剧本包。
- 创建整理草稿。
- 重新整理。
- 确认导入。
- 任何原版 ST 资源写入、核对、发布和回滚动作。

健康检查可以不要求管理员认证，但只能返回服务版本、存活状态、是否已配置必要认证和是否已配置 LLM，不得返回 token、cookie、LLM key、ST key、prompt、资源正文、draft 全文、draft 数量、导入活动统计或上传内容。

### 4.3 LLM key 复用与 AA4 调用边界

整理服务支持 OpenAI-compatible 方式：

- `GALGAME_SCRIPT_ASSISTANT_LLM_BASE_URL`
- `GALGAME_SCRIPT_ASSISTANT_LLM_MODEL`
- `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY`
- `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY_ENV`
- `GALGAME_SCRIPT_ASSISTANT_LLM_TIMEOUT_MS`
- `GALGAME_SCRIPT_ASSISTANT_LLM_RETRY_COUNT`
- `GALGAME_SCRIPT_ASSISTANT_LLM_MAX_INPUT_CHARS`

推荐做法：把 `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY_ENV` 指向 ST 部署已经使用的服务端环境变量名，或把 `GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY` 配成同一份密钥。该密钥只在外接服务进程内使用。

AA1 只实现服务端 LLM 配置状态和密钥边界，不调用 LLM。AA4 才允许在受保护的外接服务端执行真实 LLM 规划调用。该调用仍只属于管理员导入期，不属于玩家运行时。

AA4 必须满足：

- `/game/`、`/game-admin/` 静态产物、manifest、localStorage、IndexedDB 和日志不得包含 LLM key、ST key、admin token、proxy proof、prompt 正文、上传原文、完整 provider response 或资源正文。
- `usesLlm` 不能相信 LLM 输出。只有服务端实际收到 provider 2xx、成功解析、schema 校验通过且输出被接受时，最终草稿才可标 `usesLlm=true`；未配置、超时、非 2xx、非法 JSON、schema 拒绝、超长或安全拒绝均必须标 `usesLlm=false`。
- LLM 输出不得声明 `writePolicy:"imported-aa3"`、`published`、`publishedAt` 或任何已导入/已发布状态。AA4 草稿必须强制 `writePolicy:"deferred-aa3"`；只有 AA3 的 `confirmDraftHandoff` 在真实原版 ST 写入/读回通过后，才可把 draft handoff 状态改为 `imported-aa3`。
- LLM 调用有超时、有限重试、退避和幂等边界。超时必须覆盖 provider fetch、响应 body 读取、JSON 解析和 schema 校验的完整窗口，不能只覆盖响应头返回前。服务端请求必须带稳定的 `Idempotency-Key` 或等价请求标识，由 `sourceDigest`、`draftId` 和 `revision` 派生；同一 draft/revision 的 provider 重试必须使用同一标识，redeploy 到新 revision 才能生成新标识。重试不得改变 `draftId` 与 `sourceDigest`，不得重复写入 ST 资源；AA4 只生成草稿，不执行原版资源写入。
- 重试只允许用于 timeout、网络失败、429 与 5xx。400/401/403/404/422 等永久错误不得重试，必须安全回退或拒绝，且最终草稿 `usesLlm=false`。
- LLM 输入必须先通过文件数量、文件类型、单文件长度、总长度和重复文件名校验；超限请求直接拒绝或退回确定性导入期整理，不得截断后假装完整理解。
- 日志只允许记录 request id、draft id、source digest、schema version、耗时、错误类别和是否使用 LLM；不得记录上传正文、provider prompt、provider response、密钥或 token。

若没有配置 LLM，服务可以使用“导入期确定性摘要/导入计划生成器”生成管理员草稿，并在摘要中标记“未使用 LLM”。该路径只允许基于文件名、标题、明显角色名、章节标题和开场片段生成保守摘要与导入计划，不得生成玩家对白、选项、节点、结局、`SceneResult` 或任何 runtime story。它只存在于管理员导入期，玩家 `/game/` 运行时不可调用。

### 4.4 AA4 LLM planner schema

LLM planner 输入版本：

```json
{
  "protocolVersion": "galgame.script-import-llm-input.v1",
  "sourceDigest": "sha256",
  "revision": 1,
  "locale": "zh-CN",
  "preferredTemplate": "auto",
  "files": [
    {
      "name": "story.md",
      "type": "text/markdown",
      "text": "服务端临时发送给 provider 的剧本片段"
    }
  ]
}
```

LLM planner 输出只允许：

```json
{
  "protocolVersion": "galgame.script-import-llm-plan.v1",
  "summary": {
    "title": "故事名",
    "recommendedTemplate": "visual-novel",
    "mainCharacters": ["角色"],
    "worldBookCount": 1,
    "openingReady": true
  },
  "importPlan": {
    "characterName": "Galgame_AIImport_xxx_Director",
    "characterAvatar": "galgame_aiimport_xxx_director.png",
    "worldBookName": "Galgame_AIImport_xxx_World",
    "chatSeedId": "galgame-aiimport-xxx-seed"
  },
  "presentationRecommendation": {
    "detectedGenre": "rpg-adventure",
    "confidence": 0.86,
    "recommendedProfile": {
      "template": "rpg-adventure",
      "preferredModules": ["rpg-status", "inventory", "abilities", "quests", "dice", "actions"],
      "disabledModules": [],
      "extractionPolicy": {
        "confidenceThreshold": 0.78,
        "maxRecentMessages": 5,
        "allowAdminPatterns": false,
        "allowBuiltinPatterns": true,
        "lowConfidenceBehavior": "plain-dialogue"
      },
      "visualPriority": {
        "primaryPanel": "rpg-status",
        "secondaryPanels": ["inventory", "abilities", "quests"],
        "collapseBelowWidth": 640
      }
    },
    "evidence": {
      "matchedSignals": ["signal-hp-ac-format", "signal-inventory-section"]
    },
    "safeWarnings": ["warning-admin-review-required", "warning-patterns-disabled"],
    "noClaim": ["no-runtime-llm-assistant", "no-hidden-resource-reading", "no-prompt-context-copy"]
  }
}
```

Schema 必须是白名单解析。出现未知字段、大小写/别名变体、嵌套 `dialogue`/`choices`/`nodes`/`endings`/`relationship`/`variables`/`inventory`/`SceneResult`/`story`/`runtimeStory`/`manifest`/`prompt`/`context`/`resourceBody`/`characterCard`/`worldBookEntries`/角色卡正文/世界书正文/开场对白等字段时，必须 fail-closed：拒绝该 LLM 输出并安全回退到 `usesLlm=false` 的导入期确定性草稿，或返回管理员可理解的拒绝提示。不得“删掉危险字段后继续相信剩余输出”。

`presentationRecommendation` 是导入期推荐候选：provider 只能给稳定 `matchedSignals` code、模板和展示配置。`recommendationId`、`sourceDigest`、`draftId`、`revision`、`evidenceDigest`、`exampleTemplateCodes` 和最终 `usesLlm` 必须由服务端派生/核对；provider 输出这些身份字段、未知 code、任意 `exampleTemplateCodes`、顶层 `safeWarnings` 文案、`redactedExamples`、`adminPatterns`、regex 正文或 `allowAdminPatterns:true` 时必须 fail-closed 并安全回退。

LLM 输出只决定管理员草稿摘要、引用命名建议和展示推荐候选。原版角色卡、世界书和 chat seed 正文仍只能在 AA3 confirm 阶段由导入器基于管理员上传材料写入原版 ST API；manifest 仍只保存引用，不保存 LLM 输出正文或 draft `presentationRecommendation` 全对象。

### 4.5 原版资源 hash 与旧元数据诊断

导入器的幂等依据必须是“原版 API 读回后的 canonical body hash + source digest”。`extensions.galgameScriptImport.resourceHash` 只能作为快速索引或诊断，不得单独授权跳过或覆盖。

AA4 已加固的 canonical 覆盖范围：

- 角色卡正文与原版运行字段：`description`、`personality`、`scenario`、`first_mes`、`mes_example`、`system_prompt`、`post_history_instructions`、`extensions.world`、`extensions.talkativeness`、`extensions.depth_prompt.prompt/depth/role`。
- 角色卡扩展运行字段：`extensions.regex_scripts`；未知疑似运行扩展必须进入 `unsupportedFindings` 并拒绝同名 skip。
- 角色卡嵌入世界书：`data.character_book` 缺失/出现/条目正文或运行字段变化必须纳入 canonical；不支持的 embedded lorebook 形状必须 fail-closed。
- 世界书条目正文与运行字段：`key`、`keysecondary`、`content`、`constant`、`selective`、`selectiveLogic`、`order`、`position`、`disable/enabled`、`ignoreBudget`、`excludeRecursion`、`preventRecursion`、`matchPersonaDescription`、`matchCharacterDescription`、`matchCharacterPersonality`、`matchCharacterDepthPrompt`、`matchScenario`、`matchCreatorNotes`、`delayUntilRecursion`、`probability/useProbability`、`depth`、`outletName`、`group/groupOverride/groupWeight`、`scanDepth`、`caseSensitive`、`matchWholeWords`、`useGroupScoring`、`automationId`、`role`、`sticky/cooldown/delay`、`triggers`。
- 世界书 `extensions.*` 中的同义运行字段必须一并 canonical；未知疑似运行字段不得使用截断预览参与相等判断，必须进入 `unsupportedFindings` 并拒绝同名 skip。

旧 AA3 证据中的 `legacyConflictDiagnostic` 仅表示旧资源的 metadata hash 与新 canonical hash 可能不同但 canonical expected/actual 已匹配；这不是放宽 hash。正式导入仍必须以新 canonical body hash 为准，metadata hash 不一致不能单独视为通过。

## 5. 输出草稿

整理结果使用：

```json
{
  "protocolVersion": "galgame.script-import-draft.v1",
  "draftId": "draft_xxx",
  "revision": 1,
  "status": "ready-for-confirmation",
  "summary": {
    "title": "故事名",
    "recommendedTemplate": "visual-novel",
    "mainCharacters": ["角色"],
    "worldBookCount": 1,
    "openingReady": true,
    "usesLlm": false
  },
  "importPlan": {
    "characterName": "Galgame_AIImport_xxx_Director",
    "characterAvatar": "galgame_aiimport_xxx_director.png",
    "worldBookName": "Galgame_AIImport_xxx_World",
    "chatSeedId": "galgame-aiimport-xxx-seed"
  },
  "presentationRecommendation": {
    "schemaVersion": "galgame.presentation-recommendation.v1",
    "recommendationId": "rec_xxx",
    "sourceDigest": "sha256:...",
    "draftId": "draft_xxx",
    "revision": 1,
    "detectedGenre": "rpg-adventure",
    "confidence": 0.86,
    "recommendedProfile": {
      "template": "rpg-adventure",
      "preferredModules": ["rpg-status", "inventory", "abilities", "quests", "dice", "actions"],
      "disabledModules": [],
      "extractionPolicy": {
        "confidenceThreshold": 0.78,
        "maxRecentMessages": 5,
        "allowAdminPatterns": false,
        "allowBuiltinPatterns": true,
        "lowConfidenceBehavior": "plain-dialogue"
      },
      "visualPriority": {
        "primaryPanel": "rpg-status",
        "secondaryPanels": ["inventory", "abilities", "quests"],
        "collapseBelowWidth": 640
      }
    },
    "evidence": {
      "evidenceDigest": "sha256:...",
      "sourceKind": "uploaded-admin-material",
      "matchedSignals": ["signal-hp-ac-format"],
      "exampleTemplateCodes": ["example-hp-current-max"]
    },
    "safeWarnings": ["warning-admin-review-required"],
    "noClaim": ["no-runtime-llm-assistant"],
    "usesLlm": false
  },
  "safeWarnings": []
}
```

确认后返回的 manifest 必须通过 `validateScenarioManifest`。manifest 不得包含剧本文本正文、角色卡正文、世界书条目正文、LLM 输入输出全文、prompt、key、token、前端剧情节点或 draft `presentationRecommendation` 全对象。后续 UAP3/UAP5 只有在管理员确认后才可把白名单展示 profile 写入发布流程。

## 6. 原版 ST 写入规则

确认导入时，整理服务可以通过现有 SillyTavern API 创建或核对：

- 一个导演/叙事角色卡
- 一个世界书
- 一个开场 chat seed

写入必须满足：

- 资源名带 `Galgame_AIImport_` 或 `galgame-aiimport-` 前缀。
- 同一 draft 内容 hash 相同则幂等跳过。
- 同名资源已存在但 hash/source 不一致时失败，不静默覆盖。
- chat seed 是原版聊天文件；开场文本只存入 chat seed，不写入玩家 manifest。
- manifest 只引用 `avatar/worldBookName/chatSeedId`。

## 7. 验收

必须通过：

- 文档覆盖：目标、边界、密钥复用、接口、确认导入、幂等和失败规则。
- 服务测试：健康检查、缺认证配置拒绝、错误凭据拒绝、过期凭据拒绝、跨来源凭据拒绝、整理草稿、重新整理、确认导入、无密钥泄漏、冲突不覆盖。
- 健康检查测试：响应必须符合字段白名单，且不得包含 token、cookie、LLM key、ST key、prompt、draft 数量、导入活动统计、上传正文或原版资源正文。
- 导入期确定性摘要/导入计划生成器测试：未配置 LLM 时只生成管理员草稿摘要和导入计划；不得写入玩家 manifest 正文、玩家剧情协议、固定对白、固定选项、固定节点、固定结局、本地剧情状态或 `SceneResult`。
- AA4 LLM planner schema 测试：真实 provider 成功时由服务端标记 `usesLlm=true`；伪造 `usesLlm=true`、伪造 `writePolicy:"imported-aa3"`、未知字段、危险字段、非法 JSON、非 2xx、超时、超长输入都不得进入玩家/manifest/资源正文，并且安全回退或拒绝时必须 `usesLlm=false`。
- AA4 hash 语义测试：服务测试和真实 ST smoke 必须覆盖角色 body、角色 depth prompt/talkativeness、角色 embedded lorebook、角色 regex scripts、未知角色运行扩展、世界书 body、世界书 top-level 运行字段、世界书 extensions 运行字段、未知世界书运行字段、chat seed body；所有篡改必须返回 409/no-write。
- 管理端 smoke：上传入口、AI 整理、重新整理、确认并上架默认路径存在；开发者 JSON 仍折叠。
- 架构审计：无 narrative gateway、NarrativeRuntime、SceneResult、continueSession、玩家运行时本地 scripted fallback、底层 generate、前端 key、冻结文件修改；审计器必须把导入期确定性摘要/导入计划生成器归类为 import-only，而不是玩家剧情 fallback。
- 冻结边界：不修改 `src/**`、`server.js`、`plugins.js`、原版 public、root 依赖。

## 8. 当前 MVP 范围

本轮落地：

- AA1：外接整理服务的最小 HTTP 契约、服务端 LLM 配置状态与密钥边界、导入期确定性摘要/导入计划生成器。
- AA2：管理端上传、整理、重新整理、确认入口。
- AA3：确认时通过原版 ST API 写入明确命名的角色卡、世界书和 chat seed，并只返回引用 manifest 草稿；正式上架仍走现有发布/回滚流程。
- AA4 已完成的前置根因修复：导入器 canonical hash 覆盖原版运行语义字段，且同名资源正文/运行语义/未知运行字段篡改必须 409/no-write。
- AA4 当前守门实现：planner 输出白名单校验、未知/禁止字段 fail-closed、伪造 `usesLlm` 不生效、伪造 `writePolicy:"imported-aa3"` 不生效、上传文件数量/类型/长度/重复名校验。
- AA4 当前 provider 实现：OpenAI-compatible `/chat/completions` 服务端调用、fetch/body/parse/validate 全窗口超时、有限重试、429/5xx retry、4xx no-retry、稳定 `Idempotency-Key`、非法 JSON/非 2xx/schema 拒绝/超长输入安全回退、`usesLlm` 服务端注入。
- AA4 尚待 reviewer PASS 后继续：管理员端展示真实 LLM/确定性路径差异、真实部署密钥配置验收，以及后续完整上传到游玩闭环。
- 文档、服务测试、架构审计和边界检查。

本轮不做：

- 浏览器端持有 LLM key。
- 玩家端新剧情协议。
- 自动判断复杂商业授权。
- 自动覆盖已有用户资源。
- 自动桥接 regenerate/undo/swipe/group/Quick Reply。
