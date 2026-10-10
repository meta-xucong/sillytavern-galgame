# V82 活跃世界书候选名接入与对白标题优化 TaskSpec

## 用户目标

按跨剧本通用方法，继续降低对白标题因缺少说话人候选而落入“旁白/未识别”的比例；不把一部剧本的人名或句式硬编码成通用规则。

## 与 V81 的继承/取代关系

V82 是 V81 候选来源方案的窄范围后继版本。V82 只取代 V81 中“候选仅供离线 replay、不得进入生产标题解析/cache”的限制，允许这些候选经本 TaskSpec 规定的隔离 adapter 在玩家端按当前 chat 做临时标题候选输入。V81 的 `explicit-character-heading.v1` 提取规则、candidate source 的 fail-closed 语义、离线 sidecar/replay schema 与历史 cohort 不变量仍继承；V82 不启用 V81 的角色卡读取路径、不迁移候选 sidecar、不改变 speaker evidence/decision，也不改任何身份、正文、分页或源冻结规则。发生冲突时，仅以上述在线候选交付范围以 V82 为准，其余仍以 V81 为准。

## 证据与根因

- V81 固定历史基线：158 chats、955 messages、18,696 source pages；固定 no-unique cohort 为 1,309 页，成员/跨度摘要 `sha256:87da8450dada84378ea5dc405834fd4b1144d27152ae5df360a4b0f02c754d00`。
- 其中 1,297 页覆盖已解析且闭合的引语，但没有唯一 speaker anchor。只有 7 页有前两页 speaker seed，2 页能与目标引语匹配。
- 对历史聊天已绑定的世界书采用现有 `worldbook.explicit-headings.v1` 只读提取，形成 29 个 chat-local scopes、286 个候选名；固定 cohort 中 131 页从 no-unique narrator fallback 转为 speaker。该结果是结构覆盖变化，不是准确率；没有逐页 gold。
- 默认 SillyTavern worldbook 不定义通用 NPC roster 字段。不得扫描 `content`、触发词或任意描述制造名单。只有显式的结构化角色标题可自动提名；其它 schema 保留 V81 声明式字段映射能力。

## D/I/A 与边界

- D0：只增加候选来源覆盖，沿用现有 full-message quote/anchor 解析和标题 evidence，不更改结构规则优先级。
- I2：当前聊天、场景 manifest、原版 API 世界书需要精确交叉绑定，并确保 API 故障、in-flight 请求和标题异步更新不影响游戏推进。
- A1：精确来源绑定、跨聊天隔离、页面 source spans 不变、原版代码冻结及历史对照均需独立审计。
- 允许变更的文件：
  - `docs/archive/speaker-attribution/GALGAME_SPEAKER_ATTRIBUTION_V82_ACTIVE_WORLD_BOOK_CANDIDATES_TASKSPEC_2026-10-09.md`
  - `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
  - `docs/GALGAME_DESIGN_SPEC.md`
  - `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`
  - `frontend/shared/src/sillytavern-adapter.js`
  - `frontend/shared/tests/sillytavern-adapter.test.mjs`
  - `frontend/tools/static-architecture-audit.mjs` only to recognize `/api/worldinfo/get` in the exact shared candidate-adapter source and its two generated mirrors, gated by the dedicated adapter constant and a single call located inside the candidate-adapter class body; all other adapter paths and the chat bridge remain denied/review-required.
  - `frontend/player/src/main.js`
  - `frontend/player/tests/runtime-regressions.test.mjs`
  - `frontend/player/tools/speaker-candidate-scopes.mjs`
  - `frontend/player/tools/speaker-structure-replay.mjs`
  - `frontend/player/tests/speaker-candidate-scopes.test.mjs`
  - `frontend/player/tests/speaker-structure-replay.test.mjs`
  - `public/game/app.js`, `public/game/index.html`, `public/game/shared/sillytavern-adapter.js` only as outputs generated from the changed player/shared source and required cache-version contract.
  - `public/game-admin/shared/sillytavern-adapter.js` only as the generated mirror of the changed shared adapter; no admin app code or behavior changes.
- 不得改其它已有脏文件；不得编辑 `src/**`、原版 SillyTavern 路由/前端/配置；不得改 `formatVisualNovelDisplayText`、`createVisualNovelDisplaySegments`、source span 计算、页序、保存、角色身份/队伍状态、原文或聊天数据。

## 明确的资源读取边界修订

现有前端规范禁止玩家聊天桥直接调用 `/api/worldinfo/get`，该限制继续对 `SillyTavernOriginalChatBridge` 完全生效。本任务只新增一个职责隔离的只读 `SillyTavernSpeakerCandidateAdapter`，为当前显示标题提取候选名；它不属于聊天桥、原版资源诊断器或剧情运行时。

- 只允许适配器内部调用原版既有 `POST /api/worldinfo/get`，请求体严格为 `{ name: exactBoundWorldBookName }`。API 路由和请求响应形状必须来自已核验的原版实现；不得新增或修改原版路由。
- 适配器内部读取完整 JSON，仅将 `worldbook.explicit-headings.v1` 提取出的候选名和该资源内容指纹返回给调用方；原始响应正文不得离开适配器方法、写入日志、local/session storage、缓存、manifest、存档、请求或分析服务。
- 仅在 `release.releaseId`、`scenarioId`、`scenarioVersion` 与当前加载的 manifest 精确相符，`release.activeArcId` 精确对应一个 manifest ArcBindingV1，且该 arc 的 `sillyTavernBindings.worldBooks[].name` 中恰好一个值与 `snapshot.rawChat[0].chat_metadata.world_info` 完全相等时读取。缺少、重复、空值、不匹配或版本/Arc 不明时返回空候选；不得回退到默认 arc、manifest 顶层资源绑定、资源列表相似名或旧缓存。
- 资源响应须限制为最多 8 MiB；条目扫描最多 20,000，提取候选最多 2,000，名称长度沿用 `explicit-character-heading.v1` 的 80 字符上限。超限、异常 JSON、API 错误、取消或超时均返回空候选，不阻塞剧情、翻页或生成。
- 不缓存已完成的候选结果。每次需要补算当前页标题时都重新读取当前精确绑定世界书；只允许对同时进行的同一 snapshot/release/scenario/version/activeArc/chat filename/worldbook name 请求做 in-flight promise 去重。请求完成后丢弃 promise；任何后续标题刷新都重新读取，因此同一聊天快照下世界书正文更新也不会复用旧候选。候选名和资源指纹只存在于当次解析内存，不写入持久化存储。
- 这项读取只作为玩家显示层结构标题解析的候选来源。它不改变 SillyTavern 的上下文注入、世界书激活、正文、分页、语义 Annotation、speaker identity、头像、队伍/角色状态或任何剧情事实。

## 实施要求

1. 将显式角色标题提取器置于可由 player 与离线 replay 共用的 shared adapter；保留现有 V81 匹配形态，不从自由文本扫姓名。
2. 仅当上述 release、Arc、聊天头三方精确绑定成立时，candidate-only adapter 才能读取唯一对应世界书；endpoint 仅能出现在该 adapter 中。其它世界书一律不可读、不可缓存、不可提供候选。原 `SillyTavernOriginalChatBridge` 的资源正文禁令维持不变。
   - 静态架构审计器不得把该 endpoint 加入通用 adapter allowlist。只可对 `frontend/shared/src/sillytavern-adapter.js` 与两个生成镜像中的专属常量放行，且必须验证唯一调用位于 `SillyTavernSpeakerCandidateAdapter` 类体内；其它路径与聊天桥一律保持拒绝/复核。endpoint 不得进入 player endpoint registry。合同和边界由 shared adapter tests 独立覆盖。
3. 提取结果限于显式角色标题；仅对同一 scope 的并行请求做 in-flight 去重，不缓存完成结果；设置候选/entry 上限。读取失败时空候选继续剧情，不阻塞页面/生成，也不得静默将旧 chat 的候选带入当前 chat。
4. 候选名只加入 `createStructuralMessageSpeakerIndex` 的候选集合，不能变成已确认 roster、持久 identity、头像或队伍成员。标题 memo 的写入、查找与当前页即时渲染必须使用同一候选 fingerprint；后续同步页面构造器在没有新候选时不可误读旧候选 memo，异步候选结果必须在本次解析内显式覆盖显示标题。是否归属仍由当前完整消息中的现有结构证据决定；多候选/无锚点继续 abstain。
5. 更新 title-index cache namespace，指纹包含候选名集合。把运行时 active-chat source 与离线 `worldbook.explicit-headings.v1` 保持一致。
6. 不新增对白切分或通用人名正则。本阶段优先关闭“有证据源却未提供给在线标题解析器”的根因；回放后按余下形态单独决定下一阶段，不在本任务追加未审计的猜测规则。
7. 历史回放必须报告全量页跨度、固定 1,309 cohort 摘要、命中来源、候选覆盖、label migration、`accuracy=INSUFFICIENT_EVIDENCE`、无聊天写回及无外部模型调用。固定 cohort 变化数不等于正确率。

## 测试与验收

- 代码开发前只读核实当前仓库冻结源中的既有 `/api/worldinfo/get` 路由、HTTP method、请求字段及 response shape，并用精确 fixture 固定合同；仅允许读取，不得修改。若合同与本 TaskSpec 不符，停止实现并先更新 TaskSpec/独立审计。
- shared adapter tests：exact binding 的正/负路径、manifest 未绑定、聊天引用其它世界书、不同 chat/snapshot 隔离、API 错误 fail-open for progress、8 MiB 边界/超限在 JSON parse 前拒绝、响应 shape，以及断言 raw worldbook body 未从 adapter 返回、未进入 storage/log/request；对相同 snapshot/name 的顺序两次读取返回不同世界书正文时，第二次必须返回更新候选；显式标题提取跨两种世界书容器。
- player tests：候选加载异步后 cache key 变化/重算；候选 fingerprint 下写入的标题 memo 能由同一 fingerprint 取回并实际显示，缺候选 fingerprint 时无法误读；结构标题只读既有页；page count、pageIndex、`sourceSpan`、sourceText 与 baseline 完全一致。
- history tests：完整回放同源只读；固定 cohort 不漂移；用 `worldbook.explicit-headings.v1` 复现候选输入影响。不能把 131 页覆盖变化写成“131 页正确”。
- `node --test frontend/shared/tests/sillytavern-adapter.test.mjs frontend/player/tests/runtime-regressions.test.mjs frontend/player/tests/speaker-candidate-scopes.test.mjs frontend/player/tests/speaker-structure-replay.test.mjs` 通过。
- 用隔离 build-stage 构建 player，再只同步可追溯到这些 source 的必要 `public/game/**` 输出；不得用会递归清理用户现有 `public/game` 的构建路径。
- 独立只读 A1 audit PASS 后才交付。

## 非目标与限制

- 任意 free-form worldbook 或未知剧本 schema 不会被猜读。新结构继续走 V81 声明式映射/受限 adapter；无可验证角色锚点时保留 abstain。
- 不修改 LLM/语义服务，也不真实生成剧情。验证只读 player title projection 与离线历史 replay。
- 当前 live resource adapter 仅涵盖现有显式角色标题格式。回放有覆盖提升不等于逐页识别准确率提升；人工 gold 缺失时不得宣称准确率达标。

## 终端证据

- Frozen baseline worktree contains extensive pre-existing modified/untracked files. Preserve them; only the files listed above may change.
- Route provenance: `ROUTE_VERIFIED_READ_ONLY` against frozen `src/endpoints/worldinfo.js` (`POST /get`, `{name}`, JSON object response); Hook: `HOOK_UNVERIFIED` unless fresh probes establish otherwise.
