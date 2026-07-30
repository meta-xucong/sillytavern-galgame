# AI Galgame 正式落代码前材料清单

> 文档状态：pre-implementation gate v1.0  
> 生效日期：2026-07-25  
> 目的：在继续修改 `frontend/**`、`public/game/**`、`public/game-admin/**`、`external-modules/**` 前，确保协议、状态机、部署、安全和测试材料已明确、版本化并通过审查。

## 1. 准入原则

正式落代码前必须满足：

- 所有新增能力都有明确边界：展示层、管理员编排、原版桥接、媒体外接或配置发布。
- 不新增自定义剧情协议、平行剧情状态、本地 scripted fallback。
- 不修改 SillyTavern 冻结后端或原版前端。
- 所有 “可用” 声明都能对应到证据：静态、只读诊断、真实浏览器、目标聊天读回或管理员发布测试。
- 未找到等价原版入口的能力标为 `deferred/unbridged`，不得进入功能按钮或验收通过项。

## 2. 必备协议材料

| 材料 | 版本 | 状态 | 位置 | 审查重点 |
| --- | --- | --- | --- | --- |
| 展示提取协议 | `galgame.presentation-extraction.v1` | 已定义，待复审 | `AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md` | 只从原版可见聊天文本提取，不是故事协议 |
| 自适应展示协议 | `galgame.adaptive-presentation.v1` | 已定义，待复审 | `AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`、`AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md` | 默认最小对白壳，RPG/恋爱/推理/经营/沙盒模块按需显示；模块只展示，不保存剧情权威 |
| 存档显示状态协议 | `galgame.player-save.v1` | 已定义，待复审 | 本文第 3 节与 UI 规范 | 只保存 release/chat/UI/media，不保存剧情状态 |
| 原版运行时生成桥接协议 | `original-runtime-bridge.v1` | 已有目标聊天读回验证，安全材料需复审 | `external-modules/original-runtime-bridge/README.md` 与本文第 4 节 | 目标聊天锁、读回、非目标不变、失败恢复、请求授权 |
| 原版聊天操作协议 | `galgame.original-chat-ops.v1` | 部分定义，重生成/撤回/swipe 未桥接 | 本文第 5 节 | 不假设原版入口存在 |
| 运行配置应用证据协议 | `galgame.runtime-application-evidence.v1` | 已定义，待复审 | 本文第 6 节 | 区分引用存在和运行时已应用 |
| Arc 发布协议 | `galgame.arc-release.v1` | 已定义，待复审 | 本文第 7 节 | Arc 是发布配置，不是剧情节点 |
| 媒体任务协议 | `galgame.media-job.v1` | 已定义，待复审 | UI 规范与本文第 8 节 | provider-neutral、幂等、缓存、降级 |
| UI 实施规格 | `galgame.frontend-ui-implementation.v1` | 已定义，待复审 | `AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` | 视觉 token、组件 DOM/状态/交互、响应式、微交互、玩家文案、可访问性、素材和截图验收，不新增剧情权威 |
| 管理端小白化规格 | `galgame.beginner-admin-redesign.v1` | 已定义，待复审 | `AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` | 默认工作台、上架向导、作品库、演出增强、高级检查；原版能力只套壳不复刻；隐藏入口不是认证 |
| AI 剧本导入助手规格 | `galgame.script-import-assistant.v1` / `galgame.script-import-draft.v1` | 已定义，待复审 | `AI_GALGAME_SCRIPT_IMPORT_ASSISTANT_SPEC.md` | 管理员上传 -> AI/导入期确定性整理 -> 确认上架；fail-closed 管理员认证；密钥只在服务端；导入期 deterministic summarizer 不得成为玩家剧情 fallback |
| 视觉资产增强模块 | `galgame.visual-system.v1` / `galgame.visual-visible-projection.v1` / `galgame.visual-binding.v1` | VS-DOCS-1..5 文档闭环完成，等待 reviewer；代码暂停，历史 VS1-SG/PI/AS/M 不计入当前交付 | `AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`; `AI_GALGAME_VISUAL_SYSTEM_DEVELOPMENT_SPEC.md`; VS1-* 文件为历史/未来附录 | 原版 ST 不动；五类素材库/schema、immutable unknown、上传/URI安全、可见聊天投影、deterministic baseline、score<20 unknown、no-guess、`/game` 背景/立绘/图标展示、异步降级、无障碍、release/profile/catalog/save/old-save 绑定和验收矩阵已写清；Projection/proof、素材服务、matcher/binding、player/admin UI 和 VS-LLM 只可作为后续独立准入，不得在本阶段实现 |
| 验收矩阵 | `galgame.acceptance-matrix.v1` | 已定义，待复审 | UI 规范第 7.9 节与本文第 10 节 | 每项有命令、证据和通过标准 |

## 3. 存档与显示状态

协议名称：`galgame.player-save.v1`

允许字段：

```ts
interface PlayerSaveSlotV1 {
  protocolVersion: "galgame.player-save.v1";
  saveId: string;
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId?: string;
  presentationProfileId?: string;
  presentationProfileHash?: string;
  chatId: string;
  lastMessageIndex: number;
  pageIndex: number;
  visualState: {
    backgroundId?: string;
    spriteIds?: string[];
    bgmId?: string;
    mediaJobIds?: string[];
  };
  savedAt: string;
}
```

字段含义：

- `releaseId/scenarioVersion/arcId`：绑定发布版本，避免新发布悄悄改变旧存档。
- `presentationProfileId/presentationProfileHash`：只绑定当时发布的展示配置；不得保存 HP、背包、好感、任务或任何玩法事实值。
- `chatId`：指向原版 SillyTavern 聊天文件。
- `lastMessageIndex/pageIndex`：只恢复阅读位置。
- `visualState`：只恢复背景、立绘、BGM 和媒体缓存。
- `mediaJobIds`：只恢复媒体显示或查询任务状态。

禁止字段：

- 剧情节点
- 已完成选择
- 好感度
- 物品
- 世界事实
- 结局条件
- AI 场景结果
- 结构化 story result
- 任何会替代 SillyTavern 聊天历史的剧情权威

## 4. 原版运行时生成桥接材料

当前已批准的桥接方式：

- 独立 `original-runtime-bridge` 进程。
- 隔离浏览器进入原版 SillyTavern 页面。
- 选择目标原版角色和目标原版聊天。
- 调用原版运行时自己的 `Generate()`。
- 读回同一个目标聊天。

访问边界：

- 默认只能监听 loopback 地址：`127.0.0.1`、`::1` 或本机 Unix/Windows 命名管道等本机通道。
- 如果必须暴露到非 loopback 网络，必须先设计明确认证：短期 bearer token、mTLS、反向代理会话或等价机制；CORS 不是认证。
- `allowed-origin` 只限制浏览器来源，不能替代请求授权。
- 桥接请求可以携带当前发布入口的 `releaseId`、`scenarioId`、`scenarioVersion`、`arcId`、`chatId` 作为索引，但这些普通字段不能作为授权。
- 桥接请求必须携带不可伪造的 `galgame.original-runtime-bridge-proof.v1`，由 config-service 或运维签发工具在浏览器外用桥接侧密钥签发。
- `galgame.original-runtime-bridge-proof.v1` 必须覆盖 `audience`、`issuedAt`、`expiresAt`、`nonce`、`release`、`Arc`、目标角色/group 和允许 chat 列表，桥接服务端验签、验过期、验 audience、验 nonce 防重放。
- 桥接服务只能接受 signed proof 中允许的 `ActiveRelease`/旧存档 release 角色、group 和 chat 绑定。收到任意 `avatar + chatId` 或未签名 allowlist JSON 不得直接生成。
- 授权校验失败、release 不匹配、chat 不属于该 release、角色/group 与 Arc 绑定不一致时，必须拒绝并记录脱敏诊断。

请求授权验收：

- 允许请求：已发布入口或进行中旧存档绑定的目标角色/chat，signed proof 验签、未过期、未重放且目标匹配。
- 拒绝请求：未发布 Arc、陌生 chatId、陌生 avatar、跨 release chat、group/single 模式不匹配、缺 proof、伪造 proof、过期 proof、重放 proof。
- 证据必须包含 requestId、releaseId、arcId、chatId hash、target binding hash、proof 判定和授权结果；不得包含完整聊天、prompt、角色卡、世界书正文、proof 签名、签名密钥或 Bearer token。

必须保留的证据：

- 生成前目标聊天最后一条是玩家消息。
- 打开原版聊天后当前角色、当前 chatId、最后消息稳定匹配。
- 生成期间目标聊天锁未丢失。
- 生成后同一目标聊天新增角色回复。
- 非目标聊天未新增回复。
- 如果串会话、空回复、超时、停止或状态不确定，桥接返回失败。

失败语义：

- 玩家端保留舞台、玩家输入和当前 chatId。
- 显示重试/恢复。
- 不播放本地剧情。
- 不把其他聊天返回结果改名为目标聊天。

并发语义：

- 同一目标 chatId 同时只能有一个生成任务。
- 不同 chatId 可以排队或隔离执行，但必须证明不会串会话。
- 重复点击应返回 pending、禁用按钮或幂等复用，不得重复提交玩家行动。

浏览器 profile 与停止恢复：

- 持久桥接实例必须使用固定且可登记的 profile 目录。
- 临时测试实例必须使用独立 profile，不能复用生产桥接 profile。
- profile 启动前要记录 profile path hash、进程 id 和桥接实例 id；日志不得输出本机敏感路径以外的完整用户隐私内容。
- 停止桥接时，如果原版页面正在生成，必须先记录 `stopping` 状态，等待安全完成或超时后标记任务失败。
- 停止后再次启动必须能证明没有遗留 pending 锁、没有把失败任务标成功、没有重复提交玩家最后输入。

## 5. 原版聊天操作材料

协议名称：`galgame.original-chat-ops.v1`

| 操作 | 状态 | 必备桥接契约 | 通过标准 |
| --- | --- | --- | --- |
| 读取指定 chat | ready-for-design | 角色头像 + chatId 读回 | 原版聊天存在且角色绑定一致 |
| 重试当前回复 | implemented-partial | 最后一条为玩家消息时调用原版运行时桥接 | 同一目标聊天新增角色回复 |
| 重生成上一段 | deferred/unbridged | 待确认原版 regenerate 或等价操作 | 未桥接前不得显示功能按钮 |
| 撤回上一回合 | deferred/unbridged | 待确认原版删除/编辑/保存语义 | 未桥接前不得显示功能按钮 |
| swipe 候选回复 | deferred/unbridged | 待确认原版 swipe 数据结构和保存方式 | 未桥接前不得显示功能按钮 |
| 群组继续 | deferred/unbridged | 待确认原版 group chat 选择和生成语义 | 未桥接前不得声明完整支持 |

每个操作落代码前必须补充：

- 输入参数
- 并发锁
- 幂等键
- 目标聊天读回
- 非目标聊天不变
- 失败恢复
- 桌面/移动 UI 表现

## 6. 运行配置应用材料

协议名称：`galgame.runtime-application-evidence.v1`

必须区分：

- `referenceExists`：原版资源/设置列表中存在引用。
- `runtimeApplied`：原版运行时当前实际使用该引用。

| 项 | referenceExists 证据 | runtimeApplied 证据 | 当前状态 |
| --- | --- | --- | --- |
| 角色 | 原版角色列表 | 当前角色 id/avatar 与目标一致 | 已可验证 |
| 聊天 | 原版聊天列表/读回 | 当前 chatId 和最后消息与目标一致 | 已可验证 |
| worldbook | 原版 worldinfo list | 当前角色/聊天世界书激活状态可读且匹配 | deferred/unbridged |
| generation preset | 原版 settings list | 当前运行时 preset 可读且匹配 | deferred/unbridged |
| instruct preset | 原版 settings list | 当前运行时 instruct 可读且匹配 | deferred/unbridged |
| system prompt | 原版 settings list | 当前运行时 system prompt 可读且匹配 | deferred/unbridged |
| context preset | 原版 settings list | 当前运行时 context preset 可读且匹配 | deferred/unbridged |
| group | 原版 group 列表 | 当前原版运行时进入目标 group chat | deferred/unbridged |

若 `runtimeApplied` 无法证明：

- 管理员页面显示“引用存在，运行时应用未桥接”。
- 玩家端不得把该项作为完整通过。
- 发布可按策略阻止或警告，但报告必须如实分级。

## 7. Arc 发布材料

协议名称：`galgame.arc-release.v1`

`ArcBindingV1` 是正式 versioned schema，不再是建议字段。它描述管理员发布的一个原版资源组合；它不是剧情节点、不是路线树，也不保存任何固定台词或分支条件。

```ts
interface OriginalCharacterRefV1 {
  name: string;
  avatar?: string;
}

type SillyTavernTargetRefV1 =
  | {
      mode: "single-character";
      characterRef: OriginalCharacterRefV1;
      chatSeedId: string;
    }
  | {
      mode: "multi-character";
      characterRefs: OriginalCharacterRefV1[];
      directorCharacterRef?: OriginalCharacterRefV1;
      chatSeedId: string;
    }
  | {
      mode: "group";
      groupRef: {
        groupId: string;
        name?: string;
      };
      chatSeedId: string;
      characterRefs?: OriginalCharacterRefV1[];
    };

interface SillyTavernBindingsV1 {
  target: SillyTavernTargetRefV1;
  worldBookRefs: string[];
  generationPresetRef?: string;
  instructPresetRef?: string;
  systemPromptRef?: string;
  contextPresetRef?: string;
}

interface ArcBindingV1 {
  schemaVersion: "galgame.arc-release.v1";
  arcBindingId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId: string;
  arcVersion: string;
  title: string;
  order: number;
  status: "draft" | "published" | "archived";
  sillyTavernBindings: SillyTavernBindingsV1;
  presentationProfileId: string;
  mediaPolicyId?: string;
  contentRating?: string;
  createdAt: string;
  publishedAt?: string;
}
```

与现有入口协议的关系：

- `StoryEntryManifest` 持有 `arcs: ArcBindingV1[]`、`defaultArcId` 和展示配置；旧的单入口 `sillyTavernBindings` 等价为一个 `defaultArcId` 的 Arc。
- `ActiveRelease` 指向一个不可变的 `manifestId`、`manifestVersion`、`releaseId` 和 `activeArcId`；玩家开始新局时读取当前 `ActiveRelease`，进行中存档继续绑定创建时的 release。
- `ArcBindingV1.sillyTavernBindings.target` 是唯一的角色/群组入口表达。不得再使用裸字符串 `characterRef` 同时表达单角色、多角色和 group。
- `SillyTavernBindingsV1` 只保存原版资源引用名称或 id，不保存角色卡正文、世界书正文、prompt 正文或聊天正文。

唯一性要求：

- 同一个 `StoryEntryManifest` 内 `arcId` 必须唯一。
- 同一个 `StoryEntryManifest` 内 `arcBindingId` 必须唯一。
- `arcBindingId` 必须由 `scenarioId/scenarioVersion/arcId/arcVersion` 的稳定组合生成或显式登记，不能在发布后重写。
- 一个 `ActiveRelease` 同一时间只能有一个 `activeArcId`。

不可变字段：

- 发布后不可变：`schemaVersion`、`arcBindingId`、`scenarioId`、`scenarioVersion`、`arcId`、`arcVersion`、`sillyTavernBindings`、`presentationProfileId`、`mediaPolicyId`。
- 如需修改上述字段，必须创建新的 `arcVersion` 和新的 release。
- 可变但需审计：`status` 从 `draft` 到 `published` 或 `archived`，以及管理员备注类元数据。

迁移与兼容：

- 从旧单入口 manifest 迁移时，只允许把旧 `sillyTavernBindings` 包装为一个 `ArcBindingV1`。
- 迁移不得补写剧情节点、选择历史、关系、物品、好感度或固定结局。
- 旧存档继续读取创建时的 `releaseId`、`scenarioVersion`、`arcId` 和 `chatId`；如果旧 manifest 不可用，玩家端显示恢复提示。
- 不支持无证据地把旧 `characterRef: string` 猜成 group；无法判定时迁移失败并交给管理员修正。

发布要求：

- 原子发布：校验失败不替换 active release。
- 回滚只切回 release/manifest。
- 不改写原版聊天历史。
- 旧存档绑定旧 release 和旧 chatId。
- Arc 切换不是前端剧情跳转。
- 自动 Arc 推荐必须来自原版可见聊天文本、管理员标记或审查通过的原版扩展事件。
- Arc1-Arc4 的存在和导入不等于“发布已完成”；只有管理员发布/回滚验收脚本产生 release 证据后，才能宣称对应 Arc 发布可用。

## 8. 媒体材料

协议名称：`galgame.media-job.v1`

必须具备完整 request/response/status/error/cache schema。媒体任务只增强演出，不决定剧情是否发生。

```ts
type MediaKindV1 = "image" | "video";

type MediaTriggerSourceV1 =
  | "visible-chat-text"
  | "admin-marker"
  | "sillytavern-extension"
  | "manual-test";

interface MediaSourceProofV1 {
  sourceType: MediaTriggerSourceV1;
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId?: string;
  chatId: string;
  messageIndex?: number;
  messageHash?: string;
  adminMarkerId?: string;
  extensionEventId?: string;
  reviewedBy?: string;
  createdAt: string;
}

interface MediaJobRequestV1 {
  protocolVersion: "galgame.media-job.v1";
  idempotencyKey: string;
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  arcId?: string;
  chatId: string;
  messageIndex?: number;
  mediaKind: MediaKindV1;
  triggerSource: MediaTriggerSourceV1;
  sourceProof: MediaSourceProofV1;
  sceneSummary: string;
  characterVisualRefs: string[];
  styleId: string;
  timeoutMs: number;
}

type MediaJobStatusNameV1 =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

interface MediaAssetV1 {
  mediaId: string;
  mediaKind: MediaKindV1;
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  sha256?: string;
  cacheKey: string;
  expiresAt?: string;
}

interface MediaJobErrorV1 {
  code:
    | "UNAUTHORIZED"
    | "INVALID_REQUEST"
    | "UNSUPPORTED_VERSION"
    | "SOURCE_PROOF_REQUIRED"
    | "PROVIDER_TIMEOUT"
    | "PROVIDER_FAILED"
    | "CANCELLED"
    | "EXPIRED";
  safeMessage: string;
  retryable: boolean;
  providerTraceId?: string;
}

interface MediaCacheEntryV1 {
  cacheKey: string;
  releaseId: string;
  chatId: string;
  messageIndex?: number;
  mediaKind: MediaKindV1;
  url: string;
  mimeType: string;
  sha256?: string;
  createdAt: string;
  expiresAt?: string;
  reusePolicy: "reuse" | "refresh-on-expiry" | "no-store";
}

interface MediaJobStatusV1 {
  protocolVersion: "galgame.media-job.v1";
  jobId: string;
  idempotencyKey: string;
  status: MediaJobStatusNameV1;
  createdAt: string;
  updatedAt: string;
  retryCount: number;
  result?: {
    assets: MediaAssetV1[];
    cache: MediaCacheEntryV1[];
  };
  error?: MediaJobErrorV1;
}

interface MediaJobResponseV1 {
  protocolVersion: "galgame.media-job.v1";
  requestId: string;
  job: MediaJobStatusV1;
  statusUrl: string;
  cancelUrl?: string;
  retryAfterMs?: number;
}
```

媒体触发来源必须是：

- 原版可见聊天文本
- 管理员标记
- 审查通过的 SillyTavern 扩展事件
- 管理员测试

来源证明规则：

- `sceneSummary` 必须来自原版可见聊天文本摘要、管理员标记摘要、已批准扩展事件摘要或管理员测试输入。
- `sceneSummary` 最大 600 个 Unicode 字符；超长必须截断并记录 `messageHash`，不得携带完整世界书、完整角色卡或完整 prompt。
- `sceneSummary` 是不可信输入；媒体网关必须做 HTML/URL/路径注入防护，禁止直接拼进 shell 命令或文件路径。
- `characterVisualRefs` 只能引用管理员发布的视觉映射 id 或原版角色引用摘要，最多 12 个；不得用自由文本冒充角色卡外观正文。
- 每个请求必须有 `sourceProof`。缺失来源证明时返回 `SOURCE_PROOF_REQUIRED`。

不得来自：

- 前端剧情变量
- 隐式 prompt
- 复制世界书
- 自定义 story response

URL、缓存和安全：

- 返回 `url` 只允许同源相对路径、受控媒体网关 URL 或短期签名 `https` URL；禁止 `file:`、`data:`、`javascript:` 和未审查内网地址。
- 网关必须校验 MIME、扩展名、文件大小和可选 `sha256`；缓存读取不得允许路径穿越。
- 缓存键必须绑定 `releaseId/chatId/messageIndex/mediaKind/sourceProof hash/styleId`，不能只按文本摘要复用。
- 同一 `idempotencyKey` 在同一作用域内必须返回同一个任务或同一个最终结果。
- 可重试错误最多自动重试一次；取消和过期不得触发剧情回滚。
- `cancelUrl` 只能把任务变为 `cancelled` 或 best-effort 停止 provider；如果 provider 已完成，仍按最终状态返回。
- `expired` 表示结果不再可复用，玩家端可显示降级资源或重新请求，但不得阻断文本剧情。
- 版本兼容：不支持的主版本必须拒绝；同一主版本的未知可选字段可忽略并记录。

## 9. 部署与安全材料

必须有启动/停止/健康检查记录：

| 服务 | 必备材料 |
| --- | --- |
| SillyTavern | 端口、健康检查、资源诊断命令 |
| original-runtime-bridge | loopback/认证方式、allowed-origin、请求授权、发布绑定 allowlist、端口、profile 路径、并发策略、健康检查、停止方式 |
| game-config-service | 管理员鉴权、玩家只读接口、发布回滚策略 |
| media-gateway | CORS 白名单、provider 密钥边界、任务缓存目录 |

安全要求：

- 玩家端不保存密钥。
- 管理员 token 不进入静态文件。
- `/game/` 与 `/game-admin/` 路由、导航和入口必须分离；玩家端不得出现管理员入口。
- 隐藏 `/game-admin/` 高级导入、发布、回滚或诊断入口不是认证。
- 真实管理员访问控制必须由外部服务、反向代理、独立 admin service、部署层会话或等价机制提供。
- 所有导入、发布、回滚、高级检查、媒体测试和原版资源诊断接口必须遵守管理员访问控制边界。
- AI 剧本导入助手的上传、草稿、重新整理、确认导入和原版资源写入接口属于管理员写入能力；未配置有效 token、外部反向代理、独立 admin service、mTLS、受控本地会话或等价认证边界时，必须拒绝 `/v1/admin/**` 请求或拒绝启动管理员接口。
- API key、模型密钥、管理员 token、bridge proof secret、媒体 provider 密钥不得写入前端代码、静态 `public/**` 产物、manifest、localStorage、IndexedDB、截图证据或日志。
- CORS 来源白名单明确，但 CORS 不是认证。
- 外接桥接服务默认只允许 loopback；非 loopback 必须有明确认证。
- original-runtime-bridge 只能处理 signed proof 中声明的当前已发布入口或旧存档 release 角色/chat/group 绑定。
- 任意 `avatar + chatId` 请求、客户端自造 release/Arc allowlist JSON、过期 proof、伪造 proof 或重放 proof 不得绕过服务端验签。
- 日志默认脱敏。
- 不记录完整 prompt、角色卡正文、世界书正文、API key。
- 未配置 LLM 时允许的导入期确定性摘要/导入计划生成器只能输出管理员草稿、资源引用计划和安全警告；不得输出玩家对白、固定选项、剧情节点、结局、`SceneResult`、runtime story、本地剧情状态或 manifest 正文，也不得被玩家 `/game/` 调用。
- 桥接浏览器 profile 路径可清理、可重建、不会与测试实例混用。
- 停止/重启后必须证明没有遗留 pending 锁、没有重复提交玩家输入、没有把失败任务标成成功；如果 pending generation 超时后被强制关闭，停止响应必须明确 `forced` / `stopMode` / `pendingTaskFailed` 诊断，在途生成请求必须失败而不能返回伪成功。

## 10. 验收材料

每个后续代码批次必须提供可执行命令、输入 fixture、输出证据文件和通过标准。脚本不存在或证据文件缺失时，不得把该项标为通过。

| 验收项 | 命令/脚本名 | 输入 fixture | 输出证据文件 | 通过标准 |
| --- | --- | --- | --- | --- |
| 文档结构 | `rg -n "galgame\\.arc-release\\.v1|galgame\\.media-job\\.v1|original-runtime-bridge" docs` | 当前 docs | `.codex-longrun/evidence/docs-structure.txt` | 必备协议和边界章节存在 |
| UI 实施规格覆盖度 | `rg -n "视觉设计 Token|标题页|Galgame 舞台|对话框|行动按钮|自由输入|历史抽屉|存档|设置抽屉|媒体层|错误与恢复|响应式|移动键盘|逐字显示|玩家可见中文文案表|可访问性|素材规格|截图验收标准|native-first|no-button/no-claim|deferred/unbridged" docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` | UI 实施规格 | `.codex-longrun/evidence/ui-implementation-spec-coverage.txt` | 所有 UI 施工必备章节、native-first 边界和 no-button/no-claim 规则均有命中 |
| 管理端小白化覆盖度 | `rg -n "小白|工作台|上架故事|作品库|演出增强|高级检查|原版能力|不重复开发|JSON|自研附加|no-button/no-claim|deferred/unbridged" docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` | 管理端小白化规格 | `.codex-longrun/evidence/beginner-admin-doc-coverage.txt` | 默认管理路径、原版套壳边界、自研附加功能隔离和未桥接 no-claim 均有命中 |
| 管理端安全覆盖度 | `rg -n "隐藏.*不是认证|反向代理|独立 admin service|管理员访问控制|API key|模型密钥|管理员 token|localStorage|玩家端.*后台入口|/game/.* /game-admin/" docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` | 管理端安全材料 | `.codex-longrun/evidence/beginner-admin-security-coverage.txt` | 路由隔离、隐藏非认证、外部 auth/proxy、开发导入保护、凭据禁止进入前端/static/localStorage 均有命中 |
| AI 剧本导入助手文档覆盖度 | `rg -n "fail-closed|默认拒绝|拒绝启动|导入期确定性摘要|导入计划生成器|玩家 /game/.*不得调用|SceneResult|runtime story|健康检查.*不得|密钥.*服务端|hash.*冲突|manifest.*只.*引用" docs/AI_GALGAME_SCRIPT_IMPORT_ASSISTANT_SPEC.md docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md docs/GALGAME_DESIGN_SPEC.md docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` | AI 剧本导入助手材料 | `.codex-longrun/evidence/script-import-assistant-doc-coverage.txt` | fail-closed 管理员认证、导入期 deterministic summarizer 边界、服务端密钥、健康检查不泄密、hash 冲突拒绝和 manifest 只引用均有命中 |
| AI 剧本导入助手服务契约 | `node external-modules/script-import-assistant/test.mjs --evidence .codex-longrun/evidence/script-import-assistant-service.json` | `external-modules/script-import-assistant/fixtures/*.json` | `.codex-longrun/evidence/script-import-assistant-service.json` | 缺认证配置拒绝、错误/过期/非法 expiry/跨来源凭据拒绝、external-auth 直接暴露拒绝、健康检查不泄密、AA1 真实 LLM 调用 deferred 且 key 只服务端、导入期 deterministic summarizer 不写玩家剧情、ST API 写入幂等且冲突拒绝；脚本不存在时必须标 `deferred/unimplemented-audit-entry` |
| docs-only 边界 | `powershell -File .codex-longrun/tools/docs-only-audit.ps1` 或等价命令 | 本阶段允许路径清单 | `.codex-longrun/evidence/docs-only-audit.json` | 仅 `docs/**`、`.codex-longrun/**` 有本阶段变更证据；`frontend/**`、`public/**`、`external-modules/**` 无新源码改动 |
| 冻结边界 | `git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json` | 冻结路径清单 | `.codex-longrun/evidence/frozen-boundary.txt` | 输出为空 |
| 代码静态架构审计 | `node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json` | 源码、构建产物、冻结路径、允许/禁止调用清单 | `.codex-longrun/evidence/code-architecture-audit.json` | 调用链、状态流转、路由隔离、构建一致性和冻结边界均符合 native-first；命中必须带上下文分类 |
| 协议契约 | `node frontend/shared/tests/protocol-contracts.test.mjs` | `frontend/shared/tests/fixtures/protocol/*.json` | `.codex-longrun/evidence/protocol-contracts.json` | presentation/save/Arc/media 契约不产生剧情权威 |
| 资源诊断 | `node frontend/tools/sillytavern-live-check.mjs --strict-bindings --strict --evidence .codex-longrun/evidence/st-resources.json` | 当前 active release | `.codex-longrun/evidence/st-resources.json` | 引用存在和缺失项准确；runtimeApplied 不足时标 deferred/unbridged |
| 目标聊天读回 | `node external-modules/original-runtime-bridge/tests/target-chat-readback.mjs --fixture fixtures/bridge/target-chat.json` | 目标角色/chat fixture | `.codex-longrun/evidence/target-chat-readback.json` | 同一目标聊天新增角色回复；返回 chatId 与读回一致 |
| 非目标聊天不变 | `node external-modules/original-runtime-bridge/tests/non-target-unchanged.mjs --fixture fixtures/bridge/two-chats.json` | 目标与非目标 chat fixture | `.codex-longrun/evidence/non-target-unchanged.json` | 非目标聊天 hash 不变 |
| 单轮真实浏览器 | `node frontend/tools/browser-smoke-narrow.mjs --player-only true --runtime-reply-smoke true --evidence .codex-longrun/evidence/browser-one-turn.json` | 已发布 test release | `.codex-longrun/evidence/browser-one-turn.json` | 开始、输入、思考、目标回复、无本地兜底 |
| 多轮真实浏览器 | `node frontend/tools/browser-five-turn-smoke.mjs --fixture fixtures/browser/lucifer-arc1-five-turn.json --evidence .codex-longrun/evidence/browser-five-turn.json` | 5 轮输入 fixture | `.codex-longrun/evidence/browser-five-turn.json` | 5 轮都写入同一目标聊天；不丢输入、不串会话 |
| 并发串会话 | `node external-modules/original-runtime-bridge/tests/concurrency-lock.mjs --fixture fixtures/bridge/concurrent-two-chats.json` | 两个 chatId 并发 fixture | `.codex-longrun/evidence/concurrency-lock.json` | 同 chat 拒绝/复用 pending；不同 chat 排队或隔离且不串 |
| 空回复/超时/停止 | `node external-modules/original-runtime-bridge/tests/failure-recovery.mjs --fixture fixtures/bridge/failure-cases.json` | empty/timeout/stop fixtures | `.codex-longrun/evidence/failure-recovery.json` | 保留舞台和输入；返回 retryable；不写本地剧情 |
| 媒体协议与缓存 | `node frontend/shared/tests/media-job-contract.test.mjs --fixture fixtures/media/media-job-v1.json` | media request/status/cache fixtures | `.codex-longrun/evidence/media-job-contract.json` | 幂等、取消、过期、URL 安全、缓存键通过 |
| 桌面/移动端 | `node frontend/tools/browser-layout-smoke.mjs --viewports desktop,mobile --evidence .codex-longrun/evidence/layout.json` | 已发布 test release | `.codex-longrun/evidence/layout.json` | 无遮挡、无横滚、按钮可点 |
| 管理员发布/回滚 | `node frontend/tools/admin-release-rollback-smoke.mjs --fixture fixtures/admin/arc-release-v1.json --evidence .codex-longrun/evidence/admin-release-rollback.json` | 完整/缺失 Arc fixture | `.codex-longrun/evidence/admin-release-rollback.json` | 完整引用可发布；缺失引用阻止；回滚不改原版聊天 |
| 管理端小白默认路径 | `node frontend/tools/admin-beginner-smoke.mjs --base-url http://127.0.0.1:8001 --evidence .codex-longrun/evidence/admin-beginner-smoke.json` | 当前 active release 与管理端默认页 | `.codex-longrun/evidence/admin-beginner-smoke.json` | 默认工作台无 raw JSON、无禁止工程词、主流程按钮可见；高级检查仍可进入诊断 |

代码静态架构审计要求：

- 若 `frontend/tools/static-architecture-audit.mjs` 尚不存在，该项必须标为 `deferred/unimplemented-audit-entry`，不得报通过。
- 审计不能只做风险词扫描；必须读取源码和构建产物，输出 import/fetch/function-call/state-key/route/build-artifact 的上下文分类。
- 审计必须输出 `stateWrites` 与 `statePersistence` 分类证据：玩家端和 `public/game` 只能保存 release/scenario/version/Arc/chat、阅读位置、显示状态、媒体缓存和 UI loading/typing/error/display 状态；route/relationship/inventory/ending/node/scene/plot 等剧情权威或未知持久化字段必须标为 `prohibited-active` 或 `needs-review`。
- 审计必须输出真实调用点分类证据：fetch/request wrapper/generate 命名调用必须能追溯到共享适配器、外接服务或已批准 original-runtime-bridge；玩家/管理员业务源码不得通过拼接 URL、动态 wrapper 或命名为 generate 的本地函数绕过底层生成禁令。
- 审计必须输出 `original-runtime-bridge` 安全准入证据：loopback 默认、非 loopback 认证、CORS 非认证、signed release/Arc/chat binding proof、过期/伪造/重放拒绝、profile 隔离、并发锁、目标聊天读回、停止恢复。缺失认证、signed proof 或停止恢复证据时必须标为 `needs-review`/`deferred`，不得把原版 `Generate()` 委托本身报告为完整安全通过。
- 必须覆盖禁止项：`narrative-gateway`、`NarrativeRuntime`、`SceneResult`、`continueSession`、自建剧情状态、本地 scripted fallback、固定剧情、固定选项、固定节点、固定结局。
- 必须覆盖玩家调用边界：玩家代码不得直接调用 `/api/backends/*/generate`、`/api/novelai/generate`，不得复制角色卡、世界书、prompt、context 组装逻辑。
- 必须覆盖架构边界：backend freeze、玩家/管理员路由隔离、原版 SillyTavern 优先、`public/game` 与 `frontend/player` 源码构建一致性、`public/game-admin` 与 `frontend/admin` 源码构建一致性。
- 每个命中必须分类为 `prohibited-active`、`allowed-adapter`、`allowed-documentation`、`deprecated-test-fixture`、`deferred/unbridged` 或 `needs-review`。存在 `prohibited-active` 时该审计失败。
- 输出证据必须包含审计时间、输入范围、命中列表、分类摘要、失败原因和建议下一步。

本轮文档准入阶段只生成 `.codex-longrun/evidence/docs-risk-scan.txt` 作为文档风险上下文证据；这不等价于代码静态架构审计，也不允许被记为代码审计通过。

`deferred/unbridged` 能力的验收规则：

- 重生成、撤回、swipe、group、Quick Reply 扩展桥接未通过材料审查前，玩家 UI 必须 no-button/no-claim。
- preset/worldbook/context/system/instruct 的 `runtimeApplied` 未有证据前，管理员 UI 只能显示“引用存在，运行时应用未桥接”。
- Arc1-Arc4 未有管理员发布/回滚证据前，只能称“资源已导入/待发布验证”，不能称“完整发布可用”。

### 10.1 文档阶段变更证据

本阶段允许变更路径：

- `docs/**`
- `.codex-longrun/evidence/**`
- `.codex-longrun/state.json`
- `.codex-longrun/progress.md`
- `.codex-longrun/test-log.md`

本阶段禁止变更路径：

- `frontend/**`
- `public/**`
- `external-modules/**`
- `src/**`
- `server.js`
- `plugins.js`
- `config.yaml`
- `public/index.html`
- `public/script.js`
- `public/style.css`
- `package.json`
- `package-lock.json`

docs-only 审计方法：

1. 记录本阶段实际改动文件清单：`git status --short -- docs .codex-longrun`，并保存为 `.codex-longrun/evidence/docs-phase-files.txt`。
2. 对本阶段允许变更文件生成哈希：`Get-FileHash docs\AI_GALGAME_*.md, docs\GALGAME_*.md, .codex-longrun\state.json, .codex-longrun\progress.md, .codex-longrun\test-log.md, .codex-longrun\evidence\*.txt, .codex-longrun\evidence\*.json`，并保存为 `.codex-longrun/evidence/docs-phase-hashes.txt`。
3. 对代码目录使用 diff 证据，而不是只看会包含历史 untracked 目录的 `git status`：`git diff --name-only -- frontend public/game public/game-admin external-modules`，输出必须为空或只包含本阶段明确批准的文件。
4. 对冻结边界单独检查：`git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json`，输出必须为空。
5. 如果需要追溯主线 fileChange 证据，应在长任务日志写明本阶段开始时的允许文件清单和结束时的哈希；不能把既有 untracked 自定义目录当作本阶段新改动。

报告必须分级：

- 静态通过
- 只读诊断通过
- 真实浏览器打开通过
- 真实原版生成通过
- 多轮推进通过
- 管理员发布/回滚通过
- 未桥接项
- 未验证项

## 11. 本阶段完成条件

正式进入代码开发前，审查员需要确认：

- 本文所有协议和状态机没有 native-first 冲突。
- `AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` 已作为正式 UI 施工级材料存在，并通过结构、链接和覆盖度检查。
- `AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md` 没有把展示提取写成故事协议。
- `AI_GALGAME_IMPLEMENTATION_BACKLOG.md` 没有把 `deferred/unbridged` 能力当作已可实现。
- 旧文档中的 superseded 表述已收窄或标注。
- 本阶段没有修改 `frontend/**`、`public/**`、`external-modules/**` 代码。
- 若下一轮目标是管理端小白化，`AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` 必须通过审查，且 `admin-beginner-smoke` 必须作为第一批代码验收入口补齐后才能宣称小白化完成。
- 管理端小白化材料必须明确隐藏路由不是认证；如果未定义外部 auth/proxy/admin service 边界和凭据禁止进入前端/static/localStorage 的规则，不得进入 BA1。
- 若下一轮目标是 AI 剧本导入助手，`AI_GALGAME_SCRIPT_IMPORT_ASSISTANT_SPEC.md` 必须先通过审查；未定义 fail-closed 管理员认证、服务端密钥边界、导入期 deterministic summarizer 与玩家 scripted fallback 的分类边界、ST API 写入幂等/冲突拒绝和 manifest 只引用规则时，不得进入 AA1 服务实现。
