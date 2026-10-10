# V83 自动读取当前聊天世界书标题候选 TaskSpec

## 目标

任意已发布剧本在 Galgame 玩家端打开后，默认根据**当前实际加载的 SillyTavern 聊天头**自动尝试读取其绑定世界书中的显式角色标题候选；剧本不再必须逐一配置 manifest Arc 的 `sillyTavernBindings.worldBooks` 才能使用此标题辅助能力。

这只是候选来源自动发现。SillyTavern 世界书没有跨剧本统一的 NPC roster 格式，因此本任务不承诺任意世界书都能提取人物，也不扫描自由文本猜名字。

## 与 V82 的继承/取代关系

V83 只取代 V82 对“candidate worldbook 必须同时出现在当前发布版本的 active Arc 绑定中”的要求。V82 的显式角色标题提取规则、候选解析用途、结构标题证据/优先级、缓存指纹、fail-closed 边界、历史 cohort 与分页不变量继续继承。

新的来源绑定为：当前有效 release/manifest 的 scenario ID 和 version 精确一致；候选世界书仅取自本次玩家会话实际加载聊天的 `snapshot.rawChat[0].chat_metadata.world_info`；世界书请求必须用该字段的完整精确名称。不得查询候选列表后猜近似名称，不得从其他聊天、全局配置、默认 Arc、历史候选缓存或任意 manifest 资源回退。

## 证据与设计约束

- V82 当前受限路径要求 release、manifest active Arc、Arc 世界书引用和聊天头四方交叉相等。这能防串书，但使未在 Arc 列表中声明世界书的其它剧本无法自动获得候选。
- 原版聊天头已随选中的聊天从 `loadBoundChat` / `loadSpecificBoundChat` 读取；其 `chat_metadata.world_info` 是当前聊天直接携带的资源引用。以此作为唯一世界书来源，不需要枚举其它世界书。
- SillyTavern 运行时还可能合并角色卡、全局与 persona 来源的世界书；聊天头字段不表示这些来源的完整活动清单。本任务只覆盖聊天头明确绑定的 worldbook，不宣传为“读取所有运行时激活的世界书”。
- 候选提取器只接受 `worldbook.explicit-headings.v1` 的显式角色标题形态。自由描述、普通 entry comment、关键词/触发词、location/faction/item 均不自动变成角色名单。
- 历史回放覆盖变化不是准确率。缺少逐页 gold 时，`speakerAccuracy` 必须继续为 `INSUFFICIENT_EVIDENCE`。

## D/I/A 与边界

- D0：自动绑定依据已明确为当前聊天头精确 `world_info`；不改变结构归属规则。
- I2：跨玩家会话、release/manifest、聊天头、只读原版 API 与候选显示链路，需保持来源精确及失效隔离。
- A1：检查剧本通用性、跨聊天隔离、旧候选不泄漏、失败兜底和 SillyTavern 源冻结。

允许变更文件：

- `docs/GALGAME_SPEAKER_ATTRIBUTION_V83_AUTO_ACTIVE_WORLD_BOOK_TASKSPEC_2026-10-09.md`
- `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
- `docs/GALGAME_DESIGN_SPEC.md`
- `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`
- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `frontend/player/src/main.js` only to bind async candidate results to the captured release/scenario/version/arc/chat/worldbook scope and reject stale completion.
- `frontend/tools/static-architecture-audit.mjs`
- `frontend/player/tests/runtime-regressions.test.mjs`
- `public/game/app.js`, `public/game/index.html`, `public/game/shared/sillytavern-adapter.js` only as generated outputs from the changed shared source/build contract.
- `public/game-admin/shared/sillytavern-adapter.js` only as the generated mirror of the shared adapter; no admin behavior changes.

不得改其它已有脏文件；不得编辑 `src/**`、SillyTavern 原版前后端/API/配置；不得改生成正文、分页、source spans、存档、聊天内容、说话人归属优先级、角色身份、头像、队伍状态或剧情状态。

## 运行契约 `galgame.speaker-candidate-worldbook.v2`

1. 玩家端每次为当前已加载聊天解析结构标题时，candidate adapter 校验：
   - `release.releaseId` 非空；
   - `release.scenarioId` 与 `manifest.id` 完全相同；
   - `release.scenarioVersion` 与 `manifest.version` 完全相同；
   - `snapshot.fileName` 非空，且快照来自当前玩家聊天桥对该 manifest 加载/读取的目标聊天；
   - `snapshot.rawChat[0].chat_metadata.world_info` 是非空字符串。
2. `activeArcId`、Arc 的世界书引用、manifest 顶层世界书绑定不是自动读取的必要条件。世界书唯一来源是当前快照聊天头 `chat_metadata.world_info`，并以其完整字符串作为 `/api/worldinfo/get` 请求 `{name}`。
3. 空、缺失、非字符串或无法确认唯一名称时 fail closed：不调用接口，返回空候选。绝不回退 `/api/worldinfo/list`、全局设置、其他 Arc/聊天、近似名或上次成功结果。
4. 保留 V82 API route、POST method、CSRF、1.2 秒超时、8 MiB response 上限、20,000 entry 上限、2,000 candidate 上限、80 字符名称上限、流式读取 fail-closed、无原始 JSON 外泄和只做 in-flight 去重/不存已完成结果的要求。
5. Chat switch、release/scenario/version/arc switch 或当前聊天头 worldbook 改变必须改变 request scope；标题请求开始时捕获这些值，候选响应返回后再次比较当前 active snapshot 和全局 active release/manifest scope，不匹配就丢弃，不能写入新页面或污染另一聊天标题 memo。resource name 必须包含在当次 structural candidate fingerprint；聊天和 release scope 继续由现有 presentation projection scope 隔离。
6. 响应只可返回显式标题提取候选名与资源指纹，只用于当前页面的 `createStructuralMessageSpeakerIndex` 候选集合。它不能升级为 roster、identity、头像绑定、队伍成员、世界事实、上下文、prompt 或剧情状态。
7. entry 结构不符合显式标题格式时返回空候选并照常展示；不得把未知 schema 的条目正文、keys、触发词或 content 扫描为姓名。

## 文档与架构边界

- 更新前端、Native-first、设计规范中的 V82 三方 Arc 绑定例外，改为 V83 当前聊天头精确绑定例外。`SillyTavernOriginalChatBridge` 仍不得读取世界书正文；只有隔离的 `SillyTavernSpeakerCandidateAdapter` 可执行该只读读取。
- 静态架构审计不得把 `/api/worldinfo/get` 加入通用 allowlist；仅允许固定 shared candidate adapter 和其两个生成镜像内、位于 `SillyTavernSpeakerCandidateAdapter` 类体中的单一 endpoint 引用。其它 adapter/chat bridge 使用保持拒绝或 needs-review。
- 所有 SillyTavern API 路径细节留在 shared adapter。不得向原版源代码添加 route 或扩展。

## 测试与验收

- Adapter 正例：即使 manifest 无 Arc worldbook binding，只要当前已发布 scenario/release 一致且活动聊天头有 exact `world_info`，也调用 exact name 并提取显式角色标题。
- Adapter 负例：release/manifest scenario 或 version 不一致、release ID 缺失、chat filename 缺失、空/非字符串 `world_info`、切换到不同聊天 metadata；必须零 API 调用/空候选。不存在 Arc binding 不得再作为负例。未知 entry schema 即使其 `content`、keys、触发词含有人名，也必须空候选且不得泄漏该名称。
- 保留 V82 的资源超限/错误/无流响应 fail-closed、raw JSON不外泄、完成结果不缓存、顺序刷新可见 worldbook 更新、in-flight 同 scope 去重测试。
- Player 集成回归：active chat header candidate 进入标题解析；只影响标题；延迟候选请求在聊天、release/scenario/version/arc 或 chat worldbook 切换后完成时被丢弃；同一 chat 改绑为不同 worldbook、但候选名集合恰好相同时，structural candidate fingerprint/memo key 仍必须变化且旧 memo 不得复用；不同聊天/release 不共享 memo；源文本、页数、pageIndex、sourceSpan、角色身份不变。
- `node --test frontend/shared/tests/sillytavern-adapter.test.mjs frontend/player/tests/runtime-regressions.test.mjs frontend/player/tests/speaker-candidate-scopes.test.mjs frontend/player/tests/speaker-structure-replay.test.mjs` 通过。
- 历史只读回放确认 source spans / cohort 未漂移，报告 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。对照 V82 131 页候选迁移，数值相同或变化只解释来源覆盖，不称准确率。
- 隔离构建并同步 player 与 shared adapter 两个生成镜像；检查 SillyTavern 冻结路径无改动；静态架构审计通过；独立只读 A1 audit PASS 后交付。

## 非目标与限制

- 不保证未附带 `chat_metadata.world_info` 的聊天可自动找到全局启用的世界书；没有当前聊天的精确引用时不得猜。此场景可另行评估原版公开的活动资源来源，但不能通过扫描列表猜测。
- 不自动解析非显式标题格式的自由文本 worldbook，不声称适用于所有创作者自定义 schema。
- 不接入 LLM、不真实生成剧情、不改结构归属算法/正文分段/分页。

## 当前状态

实施前 TaskSpec。2026-10-09 变更基线包含大量预存修改，全部保留；本任务只修改上述白名单文件。
