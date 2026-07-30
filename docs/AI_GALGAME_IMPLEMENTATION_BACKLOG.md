# AI Galgame 代码开发 Backlog

> 文档状态：implementation backlog v1.1
> 生效日期：2026-07-25  
> 前置材料：`docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md`  
> UI 施工材料：`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`  
> 自适应展示材料：`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`、`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md`、`docs/AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md`  
> 管理端小白化材料：`docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md`  
> AI 剧本导入助手材料：`docs/AI_GALGAME_SCRIPT_IMPORT_ASSISTANT_SPEC.md`  
> 终极自适应完善材料：`docs/AI_GALGAME_ULTIMATE_ADAPTIVE_COMPLETION_PLAN.md`  
> 外置视觉系统总控：`docs/AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`；详细规格：`docs/AI_GALGAME_VISUAL_SYSTEM_DEVELOPMENT_SPEC.md`；历史/未来附录：`docs/AI_GALGAME_VISUAL_SYSTEM_VS1_PI_ADMISSION_PLAN.md`、`docs/AI_GALGAME_VISUAL_SYSTEM_VS1_AS_ADMISSION_PLAN.md`、`docs/AI_GALGAME_VISUAL_SYSTEM_VS1_M_ADMISSION_PLAN.md`、`docs/AI_GALGAME_VISUAL_SYSTEM_VS1_M_CODE_ADMISSION_REQUEST.md`  
> 当前目标：只推进独立视觉资产增强模块；AA/UAP/WE、Arc 发布和完整 Galgame 系统路线全部不属于当前目标。视觉代码必须从 VS-CODE-1 重新准入，不得恢复历史 VS1 原型。

## 1. 开发总原则

- 只开发自定义前端、管理员编排、共享适配层、独立外接模块和媒体接口。
- 不修改 `src/**`、`server.js`、`plugins.js`、`config.yaml`、原版 `public/index.html`、`public/script.js`、`public/style.css`。
- 不新增 narrative gateway、SceneResult、固定剧情、本地分支、前端剧情变量。
- 所有剧情文本、聊天历史、生成语义以 SillyTavern 原版为准。
- 未桥接能力必须在 UI 中隐藏或标注未就绪，不得假装可用。
- 本清单中的脚本名是后续批次必须提供的验收入口；脚本不存在、fixture 缺失或证据文件未生成时，不得把对应能力标为通过。
- 玩家端或管理员端 UI 业务代码开工前，必须先通过 `AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` 的结构/链接/覆盖度检查；该文档只定义展示施工规则，不授权新增剧情状态或原版功能复刻。
- 自适应 RPG/恋爱/推理/经营/沙盒模块开发前，必须先通过 `AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md` 和 `AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md` 审查；模块值只能来自原版可见聊天文本，管理员展示 profile 只能提供模板、模块开关、pattern、阈值和视觉优先级，不能成为前端剧情权威。
- RPG/D&D 状态栏精修开发前，必须先通过 `AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md` 审查。背包、状态、技能只能从原版可见文本保守整理为摘要、分类和详情抽屉；不得计算规则、不得保存前端物品/技能/状态权威、不得用 `另有 N 项` 替代完整展示。
- 管理端继续开发前，必须先通过 `AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` 审查。默认 `/game-admin/` 必须从工程配置台改成小白工作台和上架向导；原版能力只做套壳引用/检查/发布，不重复开发角色卡、世界书、预设、聊天或生成管理器；自研附加功能放入独立“演出增强”卡片区。
- 管理端小白化不得把“隐藏高级入口”当作认证。所有导入、发布、回滚、高级检查、媒体测试和原版资源诊断必须依赖外部服务、反向代理、独立 admin service 或等价部署层访问控制；前端/static/public/manifest/localStorage 不得保存 API key、模型密钥、管理员 token、bridge proof secret 或 provider 密钥。
- AI 剧本导入助手属于管理员导入期能力，不属于玩家运行时。它必须使用 fail-closed 管理员认证；未配置有效 token 或外部认证边界时，上传、草稿、重新整理、确认导入和原版资源写入必须拒绝或服务不启动。CORS、隐藏路由和按钮隐藏不是认证。
- 未配置 LLM 时允许的“导入期确定性摘要/导入计划生成器”只能生成管理员草稿摘要、资源引用计划和风险提示；不得生成玩家对白、选项、节点、结局、`SceneResult`、runtime story、本地剧情状态或 manifest 正文。静态审计必须把 import-only deterministic summarizer 与被禁止的玩家本地 scripted fallback 分开分类。

## 1.0 AA：AI 剧本导入助手路线

当前新增路线以 `AA` 标识，必须在任何服务或管理端卡片代码前完成文档准入并获得审查通过。

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| AA0 | done | 文档准入与安全纠偏 | `docs/**`、`.codex-longrun/**` | fail-closed 管理员认证、服务端密钥复用、import-only deterministic summarizer、ST API 写入幂等/冲突拒绝、manifest 只引用均写入材料；不改业务代码；reviewer PASS 已记录 |
| AA1 | done | 外接服务最小契约 | `external-modules/script-import-assistant/**`、测试 | 认证缺失拒绝、错误/过期/非法 expiry/跨来源凭据拒绝、external-auth 直接暴露拒绝、健康检查不泄密、LLM key 只服务端且真实 LLM 调用 deferred、确定性导入计划不写玩家剧情；reviewer PASS 已记录 |
| AA2 | done | 管理端极简上传卡片 | `frontend/admin/**`、`public/game-admin/**`、smoke | 上传、AI 整理、重新整理、确认入口；默认路径无工程术语；高级详情折叠；玩家端无入口；confirm 仍在 AA3 前保持 deferred；reviewer PASS 已记录 |
| AA3 | done | ST 原版资源写入与发布 handoff | `external-modules/script-import-assistant/**`、共享发布调用、测试 | 只通过原版 ST API 写入独立角色/世界书/chat seed；hash 冲突拒绝覆盖；manifest 只保存引用；confirm 后仍需现有发布/回滚流程；reviewer PASS 已记录 |
| AA4 | done | 服务端 LLM 剧本理解与导入计划 | `external-modules/script-import-assistant/**`、`docs/**`、测试 | importer canonical hash 根因加固已完成；服务端 OpenAI-compatible provider、超时/重试/幂等/脱敏/schema guard 已 reviewer PASS；输出仍仅限管理员草稿摘要/导入计划，不写玩家对白/选项/nodes/endings/SceneResult/prompt/context/resource body |
| AA5 | done | LLM 导入计划管理员端验收 | `frontend/admin/**`、`public/game-admin/**`、smoke | 管理员上传后可看到 LLM/确定性路径状态、风险提示和重新整理结果；无密钥/原文泄漏；玩家端无入口；confirm/publish 仍走 AA3/既有发布门禁 |
| AA6 | planned | 真实上传到完整游玩闭环 | `external-modules/**`、`frontend/**`、`public/game*`、smoke | 上传剧本包→服务端规划→AA3 原版资源写入→现有发布→玩家 `/game/` 真实 Generate/readback/save/recovery；所有证据区分 referenceExists、runtimeApplied、deferred/unbridged |

AA1 之前必须先通过文档准入复审。AA1-AA6 不得修改冻结后端、原版前端或根依赖，不得复制角色卡/世界书/prompt/context 正文到前端，不得恢复 narrative-gateway/NarrativeRuntime/SceneResult/continueSession。

## 1.0.1 UAP：终极自适应完善路线

当前新增路线以 `UAP` 标识，用于把“基础 Galgame 壳 + 类型模板展示 + 服务端 LLM 导入期自适应”补成一套完整闭环。UAP 不改变 native-first 边界：玩家运行时不调用导入助手，不读取隐藏资源，不计算玩法状态。

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| UAP0 | done | 终极方案文档准入与审查 | `docs/**`、`.codex-longrun/**` | `AI_GALGAME_ULTIMATE_ADAPTIVE_COMPLETION_PLAN.md` v1.2 明确三层完成度、缺口、补法、严格闭 schema、稳定 code enum、生命周期、泄漏边界、测试矩阵和 no-claim；不改业务代码；reviewer PASS 已记录 |
| UAP1 | done | 展示推荐协议与 schema guard | `frontend/shared/**`、测试、rebuilt `public/game*` shared output | `galgame.presentation-recommendation.v1` 严格闭 schema 已 reviewer PASS；未知 key、危险嵌套、类型越界、超限、重复、NaN/Infinity、身份 mismatch、旧 revision replay、伪造 `usesLlm`、未知 signal/warning/noClaim/example code、`redactedExamples` 均 fail-closed；recommendation -> profile 只保留展示配置且强制 `allowAdminPatterns=false` |
| UAP2 | done | 服务端 LLM 输出展示推荐 | `external-modules/script-import-assistant/**`、测试 | reviewer PASS 已记录；draft 中加入 `presentationRecommendation`；provider 成功且严格 candidate validation + UAP1 validator 通过才 `usesLlm=true`；非法类型/范围/枚举、缺失推荐、恶意字段或 provider 失败安全回退 deterministic recommendation `usesLlm=false`；`exampleTemplateCodes` 服务端派生；不输出 raw regex/adminPatterns/redactedExamples/top-level safeWarnings 文案；日志不含上传正文/prompt/provider response/key/raw recommendation/raw examples |
| UAP3 | done | 小白管理员推荐确认卡片 | `frontend/admin/**`、rebuilt `public/game-admin/**` | reviewer PASS 已记录；展示固定中文映射后的“推荐玩法界面/会显示什么/为什么/重新整理/采用推荐”；不显示 raw recommendation/provider JSON；无工程术语、无密钥、无上传正文泄漏；confirm 仍走 AA3 与发布门禁 |
| UAP4 | done | 六类模板玩家展示矩阵 | `frontend/player/**`、`public/game/**`、fixtures | reviewer PASS 已记录；visual-novel、rpg-adventure、romance-social、mystery-investigation、management-sim、sandbox-roleplay 均有完整/缺失 fixture、首页摘要和详情抽屉；值只来自原版可见聊天 |
| UAP5 | done | profile 发布/回滚/旧存档绑定 | shared/admin/player release paths、测试 | reviewer PASS 已记录；confirm 后 active release 不变；explicit publish 要求 `presentationProfileId/presentationProfileHash` 与 manifest version/Arc/release 精确绑定；rollback 恢复旧 profile；旧存档继续绑定旧 release/profile；缺失/非法/hash mismatch profile fail-closed；transport-only local fallback 与 active validation failure 已分离 |
| UAP6 | done | 真实剧本回归与安全审计 | `frontend/tools/**`、test-only fixtures/harness、evidence | 独立 reviewer PASS 已记录：六模板矩阵 v4 与最终 gates 通过；v1/v2/v3 和单独 VN 失败证据保留为 superseded；UAP6 done 不是全项目 done |
| UAP7 | done | 最终人工验收收口 | 文档、状态、证据 | 独立 reviewer PASS：v10 证明真实管理员 UI 上传/整理/确认/发布、真实自定义 `/game/` active exact 与原版 Generate/readback/recovery/save、worldbook exact-set、静态/冻结/泄漏门禁均通过；真实外部 LLM 网络未配置且不宣称；deferred 能力继续 no-button/no-claim |

UAP1 之前必须先获得 UAP0 reviewer PASS。UAP 任何批次不得把展示模板、HP/背包/好感/线索等 UI slot 变成前端玩法状态；不得让 LLM 参与玩家运行时；不得复用 ST 内部密钥文件或改冻结后端。UAP protected-boundary 证据必须同时检查 diff、tracked status、冻结路径未跟踪项和 startup EOL，不能只看 `git diff --name-only`。

## 1.0.2 VS：外置视觉资产增强模块（当前独立路线）

当前只维护视觉资产增强模块，不与 AA/UAP/WE、Arc 发布或原版运行桥接混合推进。模块的目标是五类素材库、可见 ST 文本匹配和 `/game/` 展示增强；原版 SillyTavern 仍是剧情、聊天、世界书、角色卡、上下文和 Generate 权威。

2026-07-30 用户范围纠偏：当前产品目标只保留视觉资产增强模块的完整开发周期。已有 VS1-SG / VS1-PI / VS1-AS / VS1-M 代码和证据保留作历史追溯，但全部暂停；代码必须从 VS-CODE-1 重新准入，旧 reviewer PASS 不构成新一轮代码授权。

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| VS-DOCS-0..5 | done | 视觉增强模块文档闭环 | `docs/**`、`.codex-longrun/**` | 五类资产、可见证据、deterministic matcher、unknown、展示、存档兼容和验收矩阵已完成；不计入功能完成 |
| VS1-SG/PI/AS/M | paused-historical | 历史 schema、Projection、素材服务、matcher/binding 代码及审查材料 | 既有内容保留 | 只作未来实现附录；不计入当前交付，不得依据旧 PASS 自动继续 |
| VS-CODE-1 | planning | 外置素材库、五类 schema、unknown、上传/目录/URI 安全 | `external-modules/**`、测试、docs/evidence | 当前下一批代码准入；不接 `/game/`，不接 matcher，不恢复历史代码 |
| VS-CODE-P | pending | 受信可见文本投影与最小授权边界 | 独立受控服务边界 | VS-CODE-2 的前置依赖；避免 matcher 依赖未落地的生产投影 |
| VS-CODE-2 | pending | deterministic matcher 和 display-only binding | `external-modules/**`、测试 | 只消费受信投影与已发布 catalog；不写玩法状态 |
| VS-CODE-4 | pending | 管理员素材库和发布界面 | `frontend/admin/**`、`public/game-admin/**` | 真实 admin auth；catalog/profile publish/rollback |
| VS-CODE-3 | pending | `/game/` 背景/立绘/图标展示 | `frontend/player/**`、`public/game/**` | scene/sprite/icon only；失败 unknown；不阻塞 ST Generate/input/save |
| VS-CODE-5 | pending | 全模块回归与最终人工验收 | tools/fixtures/evidence | 桌面/移动、旧存档、服务故障、冻结路径和真实原版 Generate/readback |
| VS-LLM | deferred | runtime visual LLM matcher strict-provider gate | future external service only after separate review | 服务端 provider-only、candidate assetId/score/reason code closed schema、no prompt/context/resource body、player no key/no provider call；当前禁止实现 |

当前视觉路线的完整顺序、必要项/后置项和停机规则见 `AI_GALGAME_VISUAL_ASSET_ENHANCEMENT_MODULE_PLAN.md`。VS-DOCS-0..5 已完成；当前进入 VS-CODE-1 准入准备，不得直接落码或恢复旧 VS1 原型。

VS current product target is the isolated visual asset enhancement module. Previous VS1-SG / VS1-PI / VS1-AS / VS1-M implementation and evidence remain historical and paused. VS-CODE-1 must be admitted as a fresh narrow batch; VS-CODE-P is required before VS-CODE-2; VS-LLM remains deferred and requires a separate strict-provider gate. No AA/UAP/WE/Arc or full-game system work belongs in this route.

## 1.1 自适应展示追加路线

当前新增路线以 `AP` 标识，必须插入到 UI 深化前：

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| AP0 | done | 文档准入与审查 | `docs/**`、`.codex-longrun/**` | 新自适应协议/开发计划通过审查；不改业务 UI |
| AP1 | done | 共享提取协议与测试骨架 | `frontend/shared/**`、`frontend/tools/**` | 纯函数提取；RPG/恋爱/推理/经营 fixtures；低置信度回退 |
| AP2 | done | 玩家端按需模块渲染 | `frontend/player/**`、`public/game/**` | 面板按需出现；无结构文本保持纯对白；真实 Generate 不受影响 |
| AP3 | done | 管理员展示配置 | `frontend/admin/**`、`frontend/shared/**`、`public/game-admin/**` | 只保存展示 profile，不保存剧情正文/状态 |
| AP4 | done | 存档恢复适配 | `frontend/shared/player-save`、玩家 UI | 只保存折叠/显示状态，模块值重新从原版聊天提取 |
| AP5 | done | 真实剧本回归矩阵 | `frontend/tools/**`、fixtures | Dungeon Master/恋爱/推理/经营/模糊文本 fixtures 覆盖 |

AP0-AP5 的完成不改变 deferred/unbridged 边界：regenerate、undo、swipe、group、native Quick Reply、preset/instruct/system/context runtime switching 仍不得显示为可用能力。

AP1 之前不得开始 AP2/AP3 UI 代码。AP2 之后仍不得恢复 regenerate、undo、swipe、group、native Quick Reply 等 deferred/unbridged 按钮。

## 1.1.1 状态栏精修追加路线

当前新增路线以 `SP` 标识，专门处理玩家端 RPG/D&D 状态栏制作感不足的问题。它是 AP 自适应展示的前端显示深化，不是新的玩法系统。

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| SP0 | done | 文档准入与审查 | `docs/**`、`.codex-longrun/**` | `AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md` 明确摘要/详情/分类/翻译/移动端/测试，且不改后台、不建平行状态；independent reviewer PASS 已记录 |
| SP1 | done | 共享提取增强 | `frontend/shared/src/adaptive-presentation.js`、fixtures/tests | 背包属性归并、容器降权、长状态分组、技能翻译与未知保留通过单测 |
| SP2 | done | 玩家 UI 详情抽屉 | `frontend/player/**`、`public/game/**` | 摘要卡片可点击；详情完整滚动；不再用 `另有 N 项` 截断；桌面/移动可用 |
| SP3 | done | 真实/fixture 验收 | `frontend/tools/**`、`.codex-longrun/evidence/**` | D&D fixture、static DOM、architecture、frozen boundary、source/public consistency checks 通过 |
| WE0 | done | 可见装备解析文档准入 | `docs/**`、`.codex-longrun/**` | `AI_GALGAME_VISIBLE_EQUIPMENT_EXTRACTION_SPEC.md` 已 reviewer PASS；明确只从可见 `Weapons/Equipment/Attacks/装备/武器/攻击` 文本提取，缺失属性不猜测 |
| WE1 | done | 共享装备/攻击提取增强 | `frontend/shared/src/adaptive-presentation.js`、fixtures/tests | 只认受认可装备标题区/明确键值行；三件独立武器、两件可见 trait、Equipment/Attacks 同名合并 raw、容器降权、无上一武器的 trait 进未分类、缺失属性不补、叙事句不误报均有单测断言 |
| WE2 | done | 玩家端构建与验收 | `public/game/**`、必要 `public/game-admin/shared/**`、`frontend/tools/**`、`.codex-longrun/evidence/**` | public/game 已重建；public/game-admin shared output consistency 已记录；static DOM、architecture、source/public、diff/protected boundary、state validation 和 reviewer PASS 均完成 |

SP 路线禁止修改 `src/**`、原版 public、root deps、启动脚本和外接生成链路。SP 不得新增剧情节点、选择、结局、HP 计算、背包规则、技能规则或本地 scripted fallback。

## 1.2 管理端小白化追加路线

当前新增路线以 `BA` 标识，必须在下一轮管理员业务 UI 代码前执行。

| 批次 | 状态 | 目标 | 代码范围 | 验收口径 |
| --- | --- | --- | --- | --- |
| BA0 | done | 文档准入与审查 | `docs/**`、`.codex-longrun/**` | 小白工作台、上架向导、作品库、演出增强、高级检查和管理员安全边界通过审查；不改业务代码 |
| BA1 | done | 信息架构骨架 | `frontend/admin/**`、`public/game-admin/**` | 默认入口为工作台；旧工程页收纳到高级检查；玩家端无后台入口；source/public 一致 |
| BA2 | done | 上架故事向导 | `frontend/admin/**`、共享发布调用 | 选择故事、自动检查、章节样式、发布四步可完成；缺资源拒绝；开发导入同样受管理员访问控制 |
| BA3 | done | 作品库与回滚小白化 | `frontend/admin/**` | 作品卡/版本卡、恢复上个版本；旧存档绑定不变 |
| BA4 | done | 演出增强独立卡片 | `frontend/admin/**` | 展示模板、媒体接口、素材表现独立，不混入原版资源管理 |
| BA5 | done | 高级检查与证据 | `frontend/admin/**`、`frontend/tools/**` | 技术诊断折叠；默认路径无 raw JSON/工程词；专门 admin-beginner smoke 通过 |

BA1 之前必须先运行现有 static architecture audit，并在 BA1 中新增或扩展 `admin-beginner-smoke`，用于证明默认管理路径小白化。若该 smoke 不存在，不得宣称管理端小白化完成。该 smoke 还必须断言玩家端没有后台入口，并检查默认管理页未把隐藏高级入口误标为安全认证。

## 2. 批次 A：协议与测试骨架

目标：先把展示提取、存档、Arc、媒体、运行配置证据写成可测试协议。

| 项 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- |
| 代码静态架构审计入口 | `frontend/tools/static-architecture-audit.mjs`、审计 fixture、`.codex-longrun/evidence/code-architecture-audit.json` | `AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` 第 10 节审查通过 | 脚本能输出调用链、状态流转、路由隔离、构建一致性和冻结边界分类；没有 `prohibited-active` | 用简单风险词扫描冒充架构审计 |
| UI 实施规格准入 | `docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`、`.codex-longrun/evidence/ui-implementation-spec-coverage.txt` | 审查员确认纳入当前准入阶段 | 视觉 token、组件 DOM/状态/交互、响应式、微交互、玩家文案、可访问性、素材与截图验收覆盖；native-first/no-button/no-claim 命中 | 边写 UI 边补规则导致视觉与边界返工 |
| 展示提取协议 | `frontend/shared/src/presentation-extraction.js`、测试文件 | `galgame.presentation-extraction.v1` 审查通过 | 只从可见文本提取按钮/说话人；失败保留原文 | 过度解析变成故事协议 |
| 存档协议 | `frontend/shared/src/player-save.js`、测试文件 | `galgame.player-save.v1` 审查通过 | 存档拒绝剧情变量、节点、关系、物品 | 存档字段偷偷承载剧情 |
| Arc manifest 校验 | `frontend/shared/src/protocol.js`、测试文件 | `galgame.arc-release.v1` 正式 schema 审查通过 | 校验 `schemaVersion`、唯一性、不可变字段、迁移、回滚和 `SillyTavernBindingsV1` | Arc 被误用成剧情节点 |
| 媒体 job 协议 | `frontend/shared/src/media-provider.js`、测试文件 | `galgame.media-job.v1` 完整 schema 审查通过 | request/response/status/error/cache、幂等、取消、过期、URL 安全可测 | 媒体请求泄露 prompt/资源正文 |
| 运行配置证据模型 | `frontend/shared/src/runtime-evidence.js`、测试文件 | `galgame.runtime-application-evidence.v1` 审查通过 | 区分引用存在和运行时已应用 | UI 误报已应用 |

不做：

- 不改玩家 UI。
- 不改管理员 UI。
- 不改桥接服务。

## 3. 批次 B：玩家端基础体验升级

目标：把当前 MVP 舞台升级成完整但仍薄的 AI 剧情游戏前端。

前置 gate：`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` 必须通过结构、链接和覆盖度证据；`frontend/tools/static-architecture-audit.mjs` 必须无 `prohibited-active`。未通过前不得修改玩家端或管理员端业务 UI。

| 项 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- |
| 舞台结构重构 | `frontend/player/src/index.html`、`styles.css` | 批次 A 展示协议 | 桌面/移动无遮挡；仍停留 `/game/` | UI 改动影响现有启动 |
| 文本分页 | `frontend/player/src/text-pagination.js`、`main.js` | 展示提取协议 | 长回复分页，不改原文 | 分页误删行动列表 |
| 行动按钮层 | `render-actions.js`、`main.js` | 展示提取协议 | 按钮只作为输入提交 | 按钮变成前端分支 |
| 自由输入多行 | `index.html`、`styles.css`、`main.js` | 无 | Enter/Shift+Enter 行为明确 | 移动键盘遮挡 |
| 历史抽屉 | `render-history.js`、`styles.css` | 原版聊天读取 | 显示当前原版聊天可见消息 | 变成聊天编辑器 |
| 存读取抽屉 | `render-save-load.js`、`player-save.js` | 存档协议 | 读取重新读原版 chatId | 本地缓存冒充原版聊天 |
| 设置抽屉 | `render-settings.js` | 无 | 只含字体、速度、音量、动效 | 暴露 AI 设置 |

验收命令：

- `node frontend/shared/tests/presentation-extraction.test.mjs`
- `node frontend/shared/tests/player-save.test.mjs`
- `node frontend/shared/tests/protocol-contracts.test.mjs --fixture frontend/shared/tests/fixtures/protocol/arc-release-v1.json`
- `node frontend/shared/tests/media-job-contract.test.mjs --fixture frontend/shared/tests/fixtures/media/media-job-v1.json`
- `rg -n "视觉设计 Token|标题页|Galgame 舞台|对话框|行动按钮|自由输入|历史抽屉|存档|设置抽屉|媒体层|错误与恢复|响应式|移动键盘|逐字显示|玩家可见中文文案表|可访问性|素材规格|截图验收标准|native-first|no-button/no-claim|deferred/unbridged" docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md > .codex-longrun/evidence/ui-implementation-spec-coverage.txt`
- `node frontend/tools/static-dom-smoke.mjs`
- 真实浏览器桌面 `/game/` smoke
- 真实浏览器移动 `/game/` smoke
- 冻结边界检查

## 4. 批次 C：原版聊天操作桥接

目标：补齐玩家常用操作，但只实现已有 contract 的能力。

| 项 | 状态 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 读取指定 chat | ready-for-design | `SillyTavernOriginalChatBridge`、玩家存档 UI | 原版聊天读取接口 | 读回指定 chatId，角色绑定一致 | 读取到错误角色聊天 |
| 重试当前回复 | implemented-partial | 玩家命令层、runtime bridge client | 目标聊天最后一条为玩家消息 | 同一目标聊天新增角色回复 | 重复点击并发生成 |
| 重生成上一段 | deferred/unbridged | 暂不落代码 | 原版等价入口未确认 | 审查前不得显示按钮 | 误删原版消息 |
| 撤回上一回合 | deferred/unbridged | 暂不落代码 | 原版等价入口未确认 | 审查前不得显示按钮 | 删除范围错误 |
| swipe 候选回复 | deferred/unbridged | 暂不落代码 | 原版数据结构未确认 | 审查前不得显示按钮 | 候选与聊天不同步 |
| 群组继续 | deferred/unbridged | 暂不落代码 | 原版 group 运行桥未确认 | 审查前不得声明支持 | 群组状态串会话 |

验收命令：

- `node external-modules/original-runtime-bridge/tests/target-chat-readback.mjs --fixture fixtures/bridge/target-chat.json`
- `node external-modules/original-runtime-bridge/tests/non-target-unchanged.mjs --fixture fixtures/bridge/two-chats.json`
- `node external-modules/original-runtime-bridge/tests/concurrency-lock.mjs --fixture fixtures/bridge/concurrent-two-chats.json`
- `node external-modules/original-runtime-bridge/tests/failure-recovery.mjs --fixture fixtures/bridge/failure-cases.json`

未桥接规则：

- 重生成、撤回、swipe、群组继续和 Quick Reply 扩展桥接在 contract 审查通过前必须 no-button/no-claim。

## 5. 批次 D：管理员 Arc 与发布

目标：让 Lucifer 这类高级包可以通过管理员端完整配置发布。

| 项 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- |
| Arc 配置页 | `frontend/admin/src/arc-config-page.js`、`index.html`、`styles.css` | Arc manifest 协议 | Arc1-Arc4 只保存资源引用 | Arc 被当成剧情节点 |
| 发布原子性 | `config-service` 或本地 release store | pre-implementation 发布规则 | 校验失败不替换 active release | 半发布导致玩家入口坏 |
| 回滚 | 管理员 release 页 | release history | 回滚不改原版聊天 | 旧 manifest 丢失 |
| 缺失资源阻止发布 | 管理员校验逻辑 | 原版资源诊断 | 缺失角色/世界书/preset/chatSeed 阻止 | 把演示可跑误报为资源完整 |
| 旧存档绑定旧 release | 玩家存档读取 | player-save 协议 | 新发布不改变旧 chatId | 旧版本资源缺失 |

验收命令：

- `node frontend/tools/admin-release-rollback-smoke.mjs --fixture fixtures/admin/arc-release-v1.json --evidence .codex-longrun/evidence/admin-release-rollback.json`
- `node frontend/tools/sillytavern-live-check.mjs --strict-bindings --strict --evidence .codex-longrun/evidence/st-resources.json`
- `node frontend/shared/tests/player-save.test.mjs --fixture frontend/shared/tests/fixtures/save/old-release-binding.json`

Arc1-Arc4 在该批次前只能称为“资源已导入/待发布验证”，不能称为完整发布可用。

## 6. 批次 E：运行配置应用证据

目标：从“引用存在”升级到可证明“运行时已应用”。

| 项 | 状态 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- | --- |
| 角色/聊天应用证据 | 已有基础 | `original-runtime-bridge` | 当前桥接 | 目标角色/chatId/最后消息稳定匹配 | 复用旧会话 |
| worldbook 应用证据 | deferred/unbridged | 待设计 | 原版运行时可读状态 | 能证明当前激活世界书 | 读取不到原版内部状态 |
| preset 应用证据 | deferred/unbridged | 待设计 | 原版运行时可读状态 | 能证明当前 preset 匹配 | 只改 UI 未改运行时 |
| instruct/system/context 应用证据 | deferred/unbridged | 待设计 | 原版运行时可读状态 | 能证明引用匹配 | 复制 prompt 正文 |
| group 应用证据 | deferred/unbridged | 待设计 | 原版群组桥接 | 能证明目标 group chat | 群组上下文漂移 |

进入代码前必须先做只读源码审计，确认可用的原版接口或运行时方法。

在上述项目转为 `bridged` 前，管理员界面只能显示 `referenceExists` 和 `runtimeApplied: deferred/unbridged`，不得显示“已应用”。

## 7. 批次 F：媒体网关与演出层

目标：把图片/视频作为非阻塞演出增强接入。

| 项 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- |
| 媒体客户端协议 | `frontend/shared/src/media-provider.js` | media-job v1 | 幂等、查询、失败、缓存 | provider 绑定死 |
| 玩家媒体层 | `frontend/player/src/render-media.js`、`styles.css` | 媒体协议 | 请求中/完成/失败/查看状态 | 媒体遮挡文本 |
| 管理员媒体页 | `frontend/admin/src/media-page.js` | media gateway | 健康检查和测试任务 | 暴露密钥 |
| 媒体触发标记 | 管理员配置 | 展示提取协议 | 只来自可见文本/管理员标记/原版扩展 | 从自建状态触发 |

验收命令：

- `node frontend/shared/tests/media-job-contract.test.mjs --fixture frontend/shared/tests/fixtures/media/media-job-v1.json`
- `node frontend/tools/browser-layout-smoke.mjs --viewports desktop,mobile --evidence .codex-longrun/evidence/layout.json`
- `.codex-longrun/evidence/media-job-contract.json` 必须证明幂等、取消、过期、URL 安全和缓存键绑定。

## 8. 批次 G：多角色视觉映射

目标：增强表现，不改变原文和剧情。

| 项 | 文件 | 依赖 | 验收 | 风险 |
| --- | --- | --- | --- | --- |
| 角色视觉配置 | `protocol.js`、管理员入口页 | presentation profile | 只保存视觉引用 | 保存角色正文 |
| 说话人提示提取 | `presentation-extraction.js` | extraction v1 | 只识别明确格式 | 猜错说话人 |
| 立绘站位 | `render-stage.js`、`styles.css` | 视觉配置 | 识别失败按旁白显示 | 改写多角色原文 |
| 背景关键词映射 | `visual-mapper.js` | 管理员标记 | 只影响显示 | 背景变成剧情状态 |

验收命令：

- speaker hint 单元测试
- 多角色文本 DOM smoke
- 移动端布局截图

## 9. 全局风险清单

| 风险 | 防线 |
| --- | --- |
| 前端重新发明剧情系统 | 协议审查，拒绝剧情变量/节点/分支 |
| 行动按钮成为剧情权威 | `presentation-extraction.v1` 限定为快捷输入 |
| 存档保存剧情事实 | `player-save.v1` 拒绝剧情字段 |
| preset/worldbook 误报已应用 | 运行配置证据分级 |
| 原版运行时串聊天 | 目标聊天锁、读回、非目标不变测试 |
| 旧存档被新发布污染 | release/chatId 绑定 |
| 媒体阻断剧情 | 媒体非阻塞、降级资源 |
| 密钥泄露 | 密钥只在外接服务，日志脱敏 |
| 修改冻结后端 | 冻结边界检查 |
| 管理端小白化误把隐藏当认证 | 文档准入、admin-beginner-smoke、部署说明和外部 auth/proxy gate |

## 10. 进入代码开发前的审查口径

审查员复审通过前，禁止开始批次 A-G 的代码修改。

复审需要确认：

- `AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` 已覆盖协议、状态机、部署、安全和测试材料。
- 本 backlog 没有把 `deferred/unbridged` 能力列为可直接实现。
- 所有 `deferred/unbridged` 能力在玩家 UI 中对应 no-button/no-claim，在管理员 UI 中不得显示“已应用/已完成”。
- 已补正式“代码静态架构审计”材料：命令、输入范围、证据文件和通过标准齐全；脚本尚不存在时必须标为 `deferred/unimplemented-audit-entry`，并作为后续代码批次最先实现的验收入口。
- 已补正式 UI 实施规格材料：`AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md` 覆盖视觉 token、组件、响应式、微交互、玩家文案、可访问性、素材、截图验收和 native-first 边界；覆盖度证据缺失时不得进入 UI 业务代码。
- 代码静态架构审计必须覆盖 `narrative-gateway`、`NarrativeRuntime`、`SceneResult`、`continueSession`、自建剧情状态、本地 scripted fallback、直接底层生成接口、角色卡/世界书/prompt/context 复制、backend freeze、玩家/管理员隔离、原版 ST 优先和 public/source 构建一致性。
- 代码静态架构审计还必须覆盖玩家端与 `public/game` 的 `stateWrites` / `statePersistence`、真实 fetch/request/generate 调用点，以及 `original-runtime-bridge` 的 loopback、认证、signed binding proof、profile、并发锁、目标聊天读回和停止恢复证据。
- 如果 `original-runtime-bridge` 缺少非 loopback 认证、signed release/Arc/chat proof 验签、过期/伪造/重放拒绝、任意 avatar+chat 拒绝、跨 release/chat 拒绝或停止恢复证据，审计必须保持 `needs-review`，后续玩家/管理员业务 UI 批次不得启动。
- 审计输出必须按上下文分类命中，不能用“风险词扫描通过”替代源码调用链和状态流转审计。
- 旧设计文档中的前端剧情状态、结构化故事结果、固定节点/选择表述已收窄或标注废弃。
- 本阶段只改 docs 和 `.codex-longrun`。
