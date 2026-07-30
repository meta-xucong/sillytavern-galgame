# AI Galgame 终极自适应完善方案

> 文档状态：UAP0 docs-only review draft v1.2  
> 生效日期：2026-07-28  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 关联文档：`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`、`docs/AI_GALGAME_SCRIPT_IMPORT_ASSISTANT_SPEC.md`、`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`、`docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`

## 1. 目标

本方案把当前系统补成“成熟 ST 剧本自适应外壳”的完整目标形态：

1. 玩家始终停留在自定义 `/game/` Galgame/RPG 风格前端。
2. 剧情、角色、世界书、聊天历史、上下文和 Generate 语义始终由原版 SillyTavern 负责。
3. 前端只做展示、阅读、输入、恢复和可见文本的保守整理。
4. 管理员只需上传成熟 ST 剧本包，由服务端 LLM 在导入期识别类型、整理原版资源导入计划，并推荐展示模板。
5. 剧本有 RPG 状态、背包、技能、线索、好感度、资源等可见输出时，前端按需显示；没有时保持极简对白模式。

终极完善不是开发第二套玩法系统，而是补齐三层能力之间的自动协作：

| 层级 | 当前定位 | 终极目标 |
| --- | --- | --- |
| 第一层：基础 Galgame 壳 | 玩家可在自定义 UI 中读原版 ST 聊天、输入并继续 Generate | 任何剧本都能低学习成本游玩，错误时 fail-closed 恢复 |
| 第二层：类型模板展示 | 已有 RPG/D&D 展示优化，自适应模块协议存在 | RPG、恋爱、推理、经营、沙盒等常见类型都有保守、好看的展示模板 |
| 第三层：导入期 LLM 自适应 | 已有服务端 LLM 整理助手和 ST 资源导入 handoff | LLM 自动推荐展示模板、模块开关和解析策略，管理员一键确认 |

## 2. 当前完成度与缺口

### 2.1 第一层：基础 Galgame 壳

已具备：

- 自定义 `/game/` 前端，不跳回原版 ST UI。
- 通过 approved original-runtime-bridge 委托原版 Generate。
- 目标 chat readback、worldbook exact-set、save/restore、recovery 已有历史证据。
- 失败不播放本地剧情，不恢复 DEMO fallback。
- 玩家端不展示模型、API、角色卡、世界书、prompt、preset 等 ST 术语。

缺口：

- 最终验收仍需要按当前 active release 做持续回归，防止 future build 又把本地 fallback、旧 demo 或过宽测试代理带回来。
- 不同剧本类型的首屏状态带和详情抽屉仍偏 RPG 优先。
- 错误恢复、读档恢复和详情抽屉需要覆盖更多模板 fixture，而不是只靠 Dungeon Master。

补法：

- 保持现有桥接，不新增 runtime。
- 把所有模板验收都接入同一套 player smoke：active release exact、ST seed readback、Generate/readback、save/restore、recovery、no-local-fallback。
- 所有新 UI 状态只保存折叠、分页、显示位置，不保存剧情事实。

### 2.2 第二层：类型模板展示

已具备：

- `galgame.adaptive-presentation.v1` 已定义模板、模块、profile 和禁止字段。
- RPG/D&D 的状态、背包、技能、装备/攻击可见文本展示已做过多轮优化。
- 行动按钮是 display-only 快捷输入，不是剧情分支。
- 装备解析已收窄到认可标题/键值行，不从自然语言里猜装备。

缺口：

- RPG 模板最成熟，恋爱、推理、经营、沙盒模板还停留在协议与基础模块层。
- 当前模板选择更多依赖管理员手动理解，缺少上传剧本后的自动推荐。
- 未形成“不同类型 fixture -> 模板 UI -> 浏览器验收”的完整矩阵。
- 模块详情页还缺类型化信息架构：恋爱角色关系、推理线索板、经营资源概览、沙盒地点/目标等。

补法：

- 保留同一个通用 `AdaptivePresentationProfileV1`，不为每类游戏新建玩法协议。
- 为每个类型只补展示模板和 fixture：
  - `visual-novel`：对白、行动、笔记。
  - `rpg-adventure`：状态、装备、技能、任务、骰子。
  - `romance-social`：关系、好感、礼物、日程、事件。
  - `mystery-investigation`：线索、嫌疑人、地点、目标、笔记。
  - `management-sim`：资源、阵营、目标、日历。
  - `sandbox-roleplay`：地点、关系、目标、笔记。
- 每个模块只读取原版可见聊天文本。缺失、歧义或低置信度时隐藏或显示“未知”，不得补默认值。
- 所有未知格式原文必须保留在详情抽屉或历史中。

### 2.3 第三层：导入期 LLM 自适应

已具备：

- `external-modules/script-import-assistant/**` 已实现独立服务端整理助手。
- 服务端 LLM provider 已接通 OpenAI-compatible 调用，具备 timeout、retry、idempotency、redaction 和 schema guard。
- 未配置 LLM 时有 deterministic import-only 基础整理，`usesLlm=false`。
- AA3 已能通过原版 ST API 幂等创建/核对角色卡、世界书、chat seed，并只返回引用 manifest 草稿。
- LLM key 只允许在外接服务端或部署密钥源，不进前端/static/manifest/localStorage/log。

缺口：

- LLM 目前主要输出管理员摘要和原版资源导入计划；还没有正式版本化的“展示模板推荐计划”。
- 管理端没有把“AI 判断这是 RPG/恋爱/推理，并建议打开哪些前端模块”做成小白确认流。
- 发布 manifest 与 Arc 绑定还缺推荐展示 profile 的 confirm/publish 生命周期规则。
- 没有把“LLM 推荐是否被采用、重新整理后是否变更、旧存档是否继续绑定旧 profile”纳入验收。

补法：

- 新增 `galgame.presentation-recommendation.v1`，作为导入期管理员草稿的一部分。
- LLM 只输出推荐模板、模块开关、视觉优先级、解析策略、证据摘要和风险提示。
- LLM 不得输出玩家对白、选项、节点、结局、关系逻辑、HP/物品真实值、prompt/context/resource body。
- 管理员确认后才把推荐转换成 `AdaptivePresentationProfileV1` 并写入 refs-only manifest。
- 玩家运行时只读取已发布 profile 的展示配置，不调用导入助手或 LLM。

## 3. 新增协议：`galgame.presentation-recommendation.v1`

该协议只用于管理员导入期草稿，不是玩家运行时协议。

```ts
interface PresentationRecommendationV1 {
  schemaVersion: "galgame.presentation-recommendation.v1";
  recommendationId: string;
  sourceDigest: string;
  draftId: string;
  revision: number;
  detectedGenre: PresentationTemplateIdV1 | "unknown";
  confidence: number;
  recommendedProfile: {
    template: PresentationTemplateIdV1;
    preferredModules: PresentationModuleIdV1[];
    disabledModules?: PresentationModuleIdV1[];
    visualPriority?: PresentationVisualPriorityV1;
    extractionPolicy?: {
      confidenceThreshold?: number;
      maxRecentMessages?: number;
      allowBuiltinPatterns?: boolean;
      allowAdminPatterns?: boolean;
      lowConfidenceBehavior?: "plain-dialogue" | "history-only";
    };
  };
  evidence: {
    evidenceDigest: string;
    sourceKind: "uploaded-admin-material";
    matchedSignals: PresentationMatchedSignalCodeV1[];
    exampleTemplateCodes?: PresentationExampleTemplateCodeV1[];
  };
  safeWarnings: PresentationSafeWarningCodeV1[];
  noClaim: PresentationNoClaimCodeV1[];
  usesLlm: boolean;
}
```

### 3.1 严格闭 schema

UAP1 必须把上面的 TypeScript 形状落成严格 validator。validator 只能接受以下精确 key，任何未知 key、大小写变体、别名、嵌套额外字段都必须拒绝整个 recommendation，不能删除危险字段后继续使用：

| 路径 | 必填 | 类型/枚举 | 限制 |
| --- | --- | --- | --- |
| `schemaVersion` | 是 | 固定 `"galgame.presentation-recommendation.v1"` | 仅允许该值 |
| `recommendationId` | 是 | string | 服务端派生；格式 `rec_[a-z0-9_-]{12,80}` |
| `sourceDigest` | 是 | string | 服务端派生/核对；格式 `sha256:[a-f0-9]{64}` |
| `draftId` | 是 | string | 服务端派生/核对；格式 `draft_[a-z0-9_-]{8,80}` |
| `revision` | 是 | integer | 服务端派生/核对；正整数，禁止 0、负数、NaN、Infinity、小数 |
| `detectedGenre` | 是 | enum | `visual-novel`、`rpg-adventure`、`romance-social`、`mystery-investigation`、`management-sim`、`sandbox-roleplay`、`unknown` |
| `confidence` | 是 | number | 0..1，禁止 NaN/Infinity |
| `recommendedProfile.template` | 是 | enum | 必须是 `PresentationTemplateIdV1` |
| `recommendedProfile.preferredModules` | 是 | array enum | 1..12 项；去重；每项必须是 `PresentationModuleIdV1` |
| `recommendedProfile.disabledModules` | 否 | array enum | 0..12 项；去重；不得与 `preferredModules` 重复 |
| `recommendedProfile.visualPriority.primaryPanel` | 否 | enum | 必须在允许模块内；不得引用禁用模块 |
| `recommendedProfile.visualPriority.secondaryPanels` | 否 | array enum | 0..8 项；去重；不得引用禁用模块 |
| `recommendedProfile.visualPriority.collapseBelowWidth` | 否 | integer | 320..1440 |
| `recommendedProfile.extractionPolicy.confidenceThreshold` | 否 | number | 0..1，禁止 NaN/Infinity |
| `recommendedProfile.extractionPolicy.maxRecentMessages` | 否 | integer | 1..20 |
| `recommendedProfile.extractionPolicy.allowBuiltinPatterns` | 否 | boolean | 默认 true |
| `recommendedProfile.extractionPolicy.allowAdminPatterns` | 否 | boolean | UAP1 强制 false；见 3.4 |
| `recommendedProfile.extractionPolicy.lowConfidenceBehavior` | 否 | enum | `plain-dialogue` 或 `history-only` |
| `evidence.evidenceDigest` | 是 | string | 服务端派生；格式 `sha256:[a-f0-9]{64}` |
| `evidence.sourceKind` | 是 | enum | 固定 `uploaded-admin-material` |
| `evidence.matchedSignals` | 是 | array enum | 0..12 项；去重；必须来自 3.6 `PresentationMatchedSignalCodeV1` |
| `evidence.exampleTemplateCodes` | 否 | array enum | 0..6 项；去重；必须来自 3.6 `PresentationExampleTemplateCodeV1`；替代已删除的 `redactedExamples` |
| `safeWarnings` | 是 | array enum | 0..8 项；去重；必须来自 3.6 `PresentationSafeWarningCodeV1` |
| `noClaim` | 是 | array enum | 0..12 项；去重；必须来自 3.6 `PresentationNoClaimCodeV1` |
| `usesLlm` | 是 | boolean | 服务端注入；不能信任 LLM 自报 |

所有字符串必须是 UTF-8 文本，去除控制字符；单个 recommendation JSON 序列化后最大 24 KB。数组禁止重复项。对象禁止 prototype/pollution key，如 `__proto__`、`constructor`、`prototype`。

### 3.6 稳定 code enum / allowlist

线协议不得接受 LLM 输出的任意 signal、warning、noClaim 文本。LLM 或 deterministic planner 只能输出以下稳定 code；管理员 UI 使用服务端固定映射把 code 渲染成中文文案。

```ts
type PresentationMatchedSignalCodeV1 =
  | "signal-vn-dialogue-format"
  | "signal-action-options-format"
  | "signal-hp-ac-format"
  | "signal-inventory-section"
  | "signal-equipment-section"
  | "signal-attack-section"
  | "signal-skill-list"
  | "signal-quest-objective"
  | "signal-dice-roll"
  | "signal-affection-score"
  | "signal-relationship-stage"
  | "signal-gift-event"
  | "signal-calendar-event"
  | "signal-clue-section"
  | "signal-suspect-section"
  | "signal-location-section"
  | "signal-resource-counter"
  | "signal-faction-status"
  | "signal-sandbox-notes"
  | "signal-unknown-structure";

type PresentationExampleTemplateCodeV1 =
  | "example-hp-current-max"
  | "example-inventory-visible-list"
  | "example-equipment-with-visible-traits"
  | "example-affection-score"
  | "example-clue-list"
  | "example-resource-counter"
  | "example-action-options";

type PresentationSafeWarningCodeV1 =
  | "warning-low-confidence"
  | "warning-ambiguous-template"
  | "warning-conflicting-signals"
  | "warning-no-stable-status-format"
  | "warning-no-opening-chat-detected"
  | "warning-missing-character-reference"
  | "warning-missing-worldbook-reference"
  | "warning-admin-review-required"
  | "warning-deterministic-fallback-used"
  | "warning-provider-output-rejected"
  | "warning-profile-not-published"
  | "warning-patterns-disabled";

type PresentationNoClaimCodeV1 =
  | "no-frontend-combat-calculation"
  | "no-frontend-inventory-authority"
  | "no-frontend-affection-calculation"
  | "no-frontend-resource-calculation"
  | "no-chapter-ending-judgment"
  | "no-runtime-llm-assistant"
  | "no-hidden-resource-reading"
  | "no-prompt-context-copy"
  | "no-regenerate-undo-swipe-group-quickreply"
  | "no-preset-instruct-context-switching";
```

Unknown signal/warning/noClaim/example code must fail-closed. UI text must be generated from an internal mapping table keyed by these codes, never from provider text.

### 3.2 服务端派生与防重放

以下字段必须由服务端从当前 draft/source/revision/provider 结果派生或核对，不能信任 LLM 返回：

- `recommendationId`
- `sourceDigest`
- `draftId`
- `revision`
- `evidence.evidenceDigest`
- `usesLlm`

校验规则：

- LLM 返回这些字段时，服务端必须忽略或拒绝；最终对象使用服务端值。
- 请求携带旧 revision、跨 draft 的 recommendation、sourceDigest 不匹配或 draftId 不匹配时必须拒绝。
- 重新整理必须创建新的 `revision`、新的 `recommendationId`、新的 `profileId` 和新的 `profileHash`。
- 同一 draft/revision 的幂等重试可以返回同一 recommendation；不同 revision 不得复用旧 recommendation 作为当前结果。

### 3.3 危险字段 fail-closed

任何层级出现以下 key 或大小写/别名/嵌套变体，必须拒绝整个 planner response，并安全回退 `usesLlm=false` 或返回管理员可理解的拒绝提示：

- `dialogue`、`message`、`choices`、`options`、`nodes`、`storyNodes`、`ending`、`endings`、`route`、`branch`
- `relationshipState`、`affectionValue`、`inventoryState`、`hp`、`mp`、`xp`、`gold`、`resourceState`
- `SceneResult`、`NarrativeRuntime`、`continueSession`、`runtimeStory`、`localState`
- `prompt`、`context`、`system`、`instruct`、`characterCard`、`worldBookEntries`、`resourceBody`、`manifestBody`

禁止把这些字段 strip 后继续使用剩余内容。拒绝原因只能记录稳定错误类别，不记录原文、prompt、provider response 或资源正文。

### 3.4 禁止 LLM 间接开启任意解析器

UAP1/UAP2 默认不允许 LLM 生成 `adminPatterns`、正则正文、provider 自定义 pattern，也不允许通过 `allowAdminPatterns=true` 开启未审核 pattern。converter 必须强制：

- `recommendedProfile.extractionPolicy.allowAdminPatterns = false`
- `adminPatterns` 不存在
- 只使用内置、已测试、visible-chat-only 的保守识别器

若未来确需管理员自定义 pattern，必须另走文档准入并满足：

- 管理员单独确认，不由 LLM 自动启用。
- pattern 最大长度、复杂度、回溯超时、匹配行数上限可测。
- 只允许匹配原版可见聊天文本。
- 单测覆盖灾难回溯、跨 section 误抓、自然语言误报和低置信度回退。

### 3.5 推荐对象与玩家隔离

`PresentationRecommendationV1` 是管理员导入期草稿对象，不得写入：

- published manifest。
- `public/game/**`。
- 玩家 API 响应。
- `galgame.player-save.v1`。
- browser `localStorage` / `IndexedDB`。
- 运行日志。
- bridge 请求。

允许进入 published manifest 的只有管理员确认后由白名单 converter 生成的 `AdaptivePresentationProfileV1`，且只包含模板、模块开关、阈值和视觉优先级。玩家 `/game/` 只读取已发布 profile，不接收或转换 recommendation，不调用 script-import-assistant。

## 4. 管理员小白流程

目标流程：

1. 上传剧本包。
2. 点击“开始整理”。
3. 服务端 LLM 或基础整理输出：
   - 故事名。
   - 推荐玩法界面。
   - 主要角色。
   - 需要写入的原版材料。
   - 缺失/冲突风险。
4. 页面用小白文案展示：
   - “建议用：地下城冒险界面”
   - “会显示：生命、装备、技能、任务”
   - “不会显示：好感度、经营资源”
   - “原因：剧本里多次出现 HP、AC、Inventory、Attack”
5. 管理员可：
   - “采用推荐”
   - “换一种界面”
   - “重新整理”
   - “确认导入原版”
6. 确认后只通过原版 ST API 写入角色卡、世界书、chat seed。
7. 正式上架继续走现有发布/回滚流程。

小白默认页不得展示：

- raw JSON。
- API key。
- token。
- prompt。
- 角色卡/世界书正文。
- endpoint。
- bridge proof。
- `runtimeApplied` 技术词。

高级详情可折叠显示：

- 引用是否存在。
- 是否已确认导入。
- 是否可发布。
- 哪些能力仍未桥接。

### 4.1 Confirm / Publish / Profile 生命周期

推荐与展示 profile 的生命周期必须和现有 AA3 原版资源写入、发布/回滚门禁一致。

| 阶段 | 状态 | 授权主体 | 允许动作 | 禁止动作 | 失败回滚 |
| --- | --- | --- | --- | --- | --- |
| 上传后 | `draft` | 管理员已认证会话 | 保存上传摘要、创建 draft/revision | 写入 ST、发布、让玩家读取 | 删除未确认 draft 或保留失败提示 |
| 整理后 | `ready-for-confirmation` | script-import-assistant 服务端 | 生成 refs-only import plan 和 presentation recommendation | 写 manifest active、写玩家 build、写 profile 到 active release | 保留旧 revision，不改变 active release |
| 管理员采用推荐 | `recommendation-accepted` | 管理员点击确认 | 白名单转换为 pending profile，生成 `profileId`/`profileHash` | 原地覆盖旧 profile、把 recommendation 原对象写入 manifest | 新 revision 失败时旧 revision 仍可查看 |
| 确认导入原版 | `confirmed/imported-draft` | AA3 confirm + 原版 ST API readback | 幂等写入/核对角色、世界书、chat seed，manifest draft 只保存引用与 pending profile | 改 ActiveRelease、填 `publishedAt`、复制资源正文 | 任一资源冲突/失败时整个 confirm 失败，不改变 active |
| 可发布 | `ready-for-publish` | 管理员发布流程 | 进入现有 publish/release 校验 | 绕过发布门禁 | 校验失败保持旧 active release |
| 显式发布 | `published` | 现有管理员 publish/release flow | 原子写入 active release；profile 与 manifest version/Arc/release 绑定 | 运行中静默替换旧存档 profile | 发布失败必须保持旧 active |
| 回滚 | `rolled-back` | 现有管理员 rollback flow | 恢复旧 release、旧 Arc、旧 profile | 用新推荐污染旧存档 | 回滚失败保持当前 active 不变 |

不可变绑定：

- `profileId` 格式：`profile_[a-z0-9_-]{12,80}`。
- `profileHash` 当前实现格式：`fnv1a:[a-f0-9]{1,8}`，由转换后的 `AdaptivePresentationProfileV1` canonical JSON 通过共享 `stableHash()` 派生。未来若升级哈希算法，必须以新版本字段迁移，不能静默复用旧 hash。
- `presentationProfileId`、`presentationProfileHash`、manifest `scenarioId`、manifest `version`、`arcId`、release id 必须形成绑定证据。
- 重新整理必须产生新 revision 和新 profile，不得原地覆盖已确认或已发布 profile。
- 缺失、非法或不匹配的 profile 必须 fail-closed，显示恢复/待管理员修复；不得默认套用最新推荐或内置 demo。

## 5. 玩家端自适应展示策略

玩家端只做三件事：

1. 显示原版可见聊天内容。
2. 根据已发布 profile 和内置保守规则提取展示片段。
3. 把玩家输入或行动按钮文字提交回原版 ST 聊天。

### 5.1 通用回退

- 没有 profile：使用 `visual-novel`。
- profile 缺失或非法：显示恢复状态，不加载本地 demo。
- 模块提取失败：隐藏该模块，保留对白原文。
- 模块低置信度：进入历史/详情，不上首页。
- 桥接失败：保留舞台和输入上下文，显示重试。

### 5.2 模块首页规则

首页只能显示最关键、最短、最高置信度的信息。

RPG 示例：

- 首页：HP、AC、等级、金币、最重要状态。
- 详情：完整背包、装备属性、技能、任务、骰子、未知原文。

恋爱示例：

- 首页：当前角色心情、关系阶段、今日事件。
- 详情：好感度记录、礼物、日程、共同回忆。

推理示例：

- 首页：当前目标、关键线索、当前地点。
- 详情：线索板、嫌疑人、时间线、未解问题。

经营示例：

- 首页：核心资源、当前目标、回合/日期。
- 详情：资源明细、阵营、建筑/队伍记录。

### 5.3 状态保存

允许保存：

- profileId。
- 模块折叠状态。
- 详情抽屉打开状态。
- pageIndex。
- lastMessageIndex。
- visualState。

禁止保存：

- HP/AC/金币/经验的权威值。
- 好感度/关系的权威值。
- 背包、技能、线索、任务、资源的权威列表。
- route/node/ending。
- 玩家选择历史作为剧情分支。

读档后必须重新读取原版聊天并重新提取展示。

## 6. 分阶段开发方案

### UAP0：文档准入与审查

范围：

- 新增本文件。
- 更新 backlog 与状态日志。
- 不改 `frontend/**`、`public/**`、`external-modules/**`、`src/**`、原版 public、启动脚本。

验收：

- 文档说明三层当前完成度、缺口、补法和开发顺序。
- 文档明确 LLM 只在管理员导入期使用。
- 文档明确 frontend 展示 slot 不形成玩法状态。
- 审查员 PASS 后才能进入 UAP1。

### UAP1：推荐协议与 schema guard

范围：

- `frontend/shared/src/adaptive-presentation-schema.js`
- 共享测试与 fixture。

实现：

- 新增 `PresentationRecommendationV1` 校验。
- 新增 recommendation -> `AdaptivePresentationProfileV1` 的白名单转换。
- 拒绝未知字段、危险字段、资源正文、剧情节点、模块事实值、类型越界、超限字符串/数组、重复项、NaN/Infinity。
- 强制服务端派生字段匹配当前 draft/source/revision/provider 结果；拒绝身份 mismatch、跨 draft 重放和旧 revision replay。
- converter 强制 `allowAdminPatterns=false`，不得从 LLM 输出创建 `adminPatterns` 或正则正文。
- 保留现有 `AdaptivePresentationProfileV1` 禁止规则。

验收：

- 合法推荐通过。
- LLM 伪造 HP/背包/好感/剧情节点/对白/choices/endings 被拒绝。
- LLM 伪造 `usesLlm`、`recommendationId`、`sourceDigest`、`draftId`、`revision`、`evidenceDigest` 不生效或被拒绝。
- 未知 key、大小写/别名、危险嵌套、旧 revision replay、跨 draft/source mismatch 被拒绝。
- recommendation 转 profile 后只剩模板、模块、阈值、视觉优先级。
- recommendation 全对象不得进入 manifest/player build/player save/localStorage。
- static architecture 0 prohibited / 0 needs-review。

### UAP2：服务端 LLM 推荐输出

范围：

- `external-modules/script-import-assistant/**`
- 服务测试。

实现：

- 在 draft 顶层加入 `presentationRecommendation`，不把该对象写入 manifest/player/save/runtime。
- provider 输出 schema 增加推荐字段，但仍只能是导入期草稿；provider 只能给 `matchedSignals` 稳定 code，`exampleTemplateCodes` 由服务端按固定映射派生。
- deterministic fallback 根据标题/明显栏目/文件名给保守推荐：
  - D&D/HP/AC/Inventory/Attack -> `rpg-adventure`
  - 好感/约会/礼物/日程 -> `romance-social`
  - 线索/嫌疑人/证据 -> `mystery-investigation`
  - 资源/回合/人口/粮食 -> `management-sim`
  - 无稳定结构 -> `visual-novel`
- 所有 provider 错误、非法 JSON、schema 拒绝、超时安全回退 `usesLlm=false`。
- provider 不得输出 raw regex/adminPatterns；服务端只接受内置信号类别并转换成安全 recommendation。
- `exampleTemplateCodes` 由服务端根据固定 signal code 生成；不接受 provider 直接提供 example code，也不接受上传正文提供任意样例文本。

验收：

- 真实 provider 成功才 `usesLlm=true`。
- 恶意 recommendation 字段 fail-closed，包括非法 template/detectedGenre、string/NaN/Infinity/out-of-range confidence、policy 类型/范围错误、模块/视觉字段类型错误、缺失必填项、provider example code/text、顶层 provider warning 文案。
- 日志不含上传正文、prompt、provider response、key、raw recommendation、raw examples、top-level safeWarnings 或任意 provider 文案。
- `/game/` 无法调用 assistant。

### UAP3：管理员一键推荐确认

范围：

- `frontend/admin/**`
- rebuilt `public/game-admin/**`

实现：

- 小白卡片显示“推荐玩法界面”。
- 支持“采用推荐”“换一种界面”“重新整理”。
- 冲突/缺失用自然语言提示。
- 高级 JSON 继续折叠。
- Confirm 仍走 AA3 原版资源写入与既有发布门禁。
- UI 不显示 raw recommendation/provider JSON；只显示服务端白名单摘要、推荐模板、模块名称和安全提示。

验收：

- 管理员默认路径不出现工程术语。
- 前端不存密钥、不存上传全文、不存 provider response。
- 玩家 `/game/` 没有管理员入口。
- confirm 后 manifest draft 只含引用与展示 profile，不发布。
- 未人工确认的 admin pattern 不启用；管理员仅采用模板/profile，不采用 LLM 正则。

### UAP4：模板 UI 完整矩阵

范围：

- `frontend/player/**`
- `public/game/**`
- test-only fixture。

实现：

- 补齐 6 个模板的首页摘要、详情抽屉、空态、移动端布局。
- RPG 模板沿用当前状态带与装备详情。
- 恋爱、推理、经营、沙盒补展示结构，但只在原版可见文本明确输出时显示。
- 未知模块原文保留。

验收：

- 每个模板至少一份完整字段 fixture 和一份缺失字段 fixture。
- 无横向溢出，移动端输入不被遮挡。
- 详情抽屉满足 dialog、Esc、焦点回归、键盘可操作。
- 不新增前端 HP/好感/资源计算。

### UAP5：发布与旧存档兼容

范围：

- 现有 admin publish/release flow。
- shared manifest/profile 引用。

实现：

- draft confirm 后 profile 为 `confirmed/imported-draft` 或 `ready-for-publish`，但 active release 不变。
- explicit publish 后 profile 与 manifest version、Arc、active release 绑定。
- rollback 恢复旧 release 的 profile。
- 旧存档继续使用旧 release/profile。
- 重新整理创建新 revision/profileId/profileHash，不覆盖已发布 profile。

验收：

- confirm 后玩家 active release 不变。
- publish 前管理员发布流程必须给当前 Arc 绑定 `presentationProfileHash`；缺失或与 profile canonical hash 不匹配时拒绝。
- publish 后 active release 和 active manifest 读回必须精确包含同一 `presentationProfileId/presentationProfileHash`。
- rollback 后玩家读取旧 profile。
- 旧存档保存创建时的 `presentationProfileId/presentationProfileHash`，继续读取旧 release/profile；hash 不匹配时 fail-closed 显示恢复，不套用最新推荐。
- 缺失/非法 profile fail-closed，不套用最新推荐或本地默认。

### UAP6：真实剧本回归与安全审计

范围：

- 工具、fixture、evidence。

验收矩阵：

- 上传成熟 ST 剧本包 -> LLM/基础整理 -> 推荐模板 -> 确认导入 -> 发布 -> `/game/` 读取 active release。
- 每个模板至少一个真实或 fixture 剧本。
- original ST resource readback 通过。
- player smoke 证明 no-local-fallback。
- protected paths clean。
- source/public 一致。
- static architecture 0 prohibited / 0 needs-review / failedChecks=[]。

### UAP7：最终人工验收

通过条件：

- 小白管理员能只靠上传、整理、确认、上架完成导入。
- 玩家能在自定义 `/game/` 外壳中游玩成熟 ST 剧本。
- 剧本类型变化时，前端展示能自动贴近剧本，而不是固定 RPG 卡片。
- 没有原版 ST 后端/原版 public/root deps/startup 越界。
- 没有本地剧情、节点、结局、规则计算或隐藏资源读取。

## 7. 测试与证据清单

UAP0 docs-only：

```powershell
git diff --check -- docs .codex-longrun
git diff --name-only -- frontend public external-modules src server.js plugins.js config.yaml package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
git status --short --untracked-files=no -- frontend public external-modules src server.js plugins.js config.yaml package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
git status --short --untracked-files=all -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
git ls-files --eol -- Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
python $env:USERPROFILE\.codex\skills\long-running-task\scripts\validate_state.py --project .
```

UAP1-UAP6 code gates：

```powershell
node external-modules/script-import-assistant/test.mjs
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs --evidence .codex-longrun/evidence/uap-code-architecture.json
node frontend/tools/static-architecture-audit.mjs --evidence .codex-longrun/evidence/uap-source-public.json
git diff --check
python $env:USERPROFILE\.codex\skills\long-running-task\scripts\validate_state.py --project .
```

新增或扩展的专项测试必须覆盖：

- `presentation-recommendation.v1` schema。
- recommendation -> profile 白名单转换。
- 恶意 LLM 输出拒绝。
- 未知 key、危险嵌套、类型越界、超限字符串/数组、重复项、NaN/Infinity 拒绝。
- 未知 `matchedSignals` / `safeWarnings` / `noClaim` / `exampleTemplateCodes` code 拒绝。
- `redactedExamples` 或任何 provider/upload 原文样例字段出现时拒绝。
- recommendation identity mismatch：`recommendationId`、`sourceDigest`、`draftId`、`revision`、`evidenceDigest` 与当前 draft/source/revision 不匹配必须拒绝。
- 旧 revision replay 与跨 draft/source replay 拒绝。
- 伪造 `usesLlm=true` 不生效；实际 provider 失败/回退时必须 `usesLlm=false`。
- recommendation 全对象、provider summary、上传原文、任意样例文本不得进入 manifest、player build、player save、localStorage/IndexedDB 或日志。
- `/game/` 不可调用 script-import-assistant，不能接收/转换 draft recommendation。
- LLM 输出 `adminPatterns`、regex 正文或 `allowAdminPatterns=true` 不得启用；未人工确认 pattern 时 converter 强制 `allowAdminPatterns=false`。
- deterministic fallback 推荐但 `usesLlm=false`。
- 管理员 UI 推荐卡片。
- 6 个模板 fixture。
- profile publish/rollback/old-save binding。
- 玩家 no-local-fallback。
- source/public/static architecture/frozen gate 扫描 recommendation/raw provider/upload leakage。
- protected boundary 同时检查 diff、tracked status、目标冻结路径未跟踪项和 startup EOL，不能只看 `git diff --name-only`。

## 8. 安全与部署边界

- 管理员 assistant 必须 fail-closed auth。
- CORS 不是认证。
- LLM key 只能在服务端环境或密钥管理器。
- 复用 ST 游玩 key 的正确方式是外接服务读取同一服务端密钥源；不得读取 ST 内部文件/内存，不得把 key 传给浏览器。
- 导入助手不得参与玩家 runtime。
- `/game/` 不得出现管理员入口。
- 原版 ST API 写入必须 hash/readback/冲突拒绝。
- 测试残留资源不得擅自删除，清理需用户授权。

### 8.1 推荐证据与 UI 映射

`matchedSignals`、`exampleTemplateCodes`、`safeWarnings` 和 `noClaim` 只服务于管理员理解“为什么推荐这个界面”，不是剧本文本存储。

服务端和 UI 规则：

- 线协议只接受 3.6 的稳定 code enum，不接受任意 LLM 文本。
- `matchedSignals` 不保存上传原句，只保存固定信号 code。
- `exampleTemplateCodes` 不保存原文片段，只保存固定样例模板 code。例如 UI 可把 `example-hp-current-max` 渲染为 `HP: <当前>/<上限>`，而不是保存 `HP: 12/20` 这类来自上传材料的文本。
- `safeWarnings` 与 `noClaim` 只保存固定 code。管理员 UI 使用服务端固定中文映射渲染，例如 `warning-patterns-disabled` -> “未启用自定义解析规则，只使用内置安全识别”。
- provider 返回任意 signal/warning/noClaim/example 文本、未知 code 或短剧情片段时，必须拒绝整个 planner response 或安全回退 `usesLlm=false`。
- 管理员 UI 默认只显示由 code 映射出的自然语言摘要，不显示 raw recommendation/provider JSON。
- 日志只记录 draftId、revision、sourceDigest、recommendationId、错误类别、耗时和 `usesLlm`；不得记录上传正文、样例文本、provider 文案、prompt、response、密钥或 token。

### 8.2 LLM 输入范围

LLM 只能处理本次管理员上传的剧本材料或服务端生成的受控摘要。它不得主动读取：

- SillyTavern 内部 settings、内存、密钥或 provider 配置。
- 已有角色卡正文、世界书正文、聊天全文，除非这些文件本身就是管理员本次上传材料的一部分。
- 原版 prompt/context/system/instruct。
- 玩家存档或玩家本地缓存。

复用 ST 游玩密钥只允许通过同一服务端密钥源配置给外接 assistant；不得读取 ST 内部文件来“借 key”。

## 9. Deferred / No-Claim

以下能力仍不属于本方案直接实现范围：

- 前端计算战斗、背包、资源、好感。
- 自动判断章节完成、结局、路线。
- 原版 regenerate / undo / swipe / group / native Quick Reply 完整桥接。
- preset/instruct/system/context 自动 runtime switching。
- 使用隐藏角色卡/世界书/prompt/context 作为展示值来源。
- 玩家运行时调用 LLM 导入助手。

这些能力没有单独 native bridge 合同和验收证据前，必须 no-button/no-claim。
