# Galgame 实施状态

> 最近更新：2026-07-26  
> 当前原则：以 `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md` 与 `AGENTS.md` 为准；原版 SillyTavern 负责资源、聊天、上下文和 Generate 语义，自定义 `/game/` 负责玩家可见 UI 与展示增强。

## 当前结论

当前 native-first 范围已经具备可玩的自定义前端体验：

- `/game/` 保持自定义日式游戏前端，不跳转原版 SillyTavern UI。
- 玩家读到的剧情、状态、行动选项和后续回复来自原版 SillyTavern 聊天与批准的 original-runtime bridge。
- Dungeon Master RPG 基准入口已经绑定到原版角色、世界书、chat seed，并通过真实浏览器两轮 original Generate 验收。
- Lucifer 四幕曾通过独立 chat seed、逐幕 worldbook exact-set、目标聊天读回、保存/恢复等验收；当前默认入口已切换为 Dungeon Master。
- 自适应展示框架 AP0-AP5 已完成：RPG/恋爱/推理/经营/沙盒等面板按需显示，模块值只来自原版可见聊天文本。

## 已实现

- 玩家端：标题页、舞台、逐字显示、旁白/对白/动作区分、自由输入、可选行动快捷按钮、历史、保存/读取、错误恢复。
- 玩家展示：`状态`、`背包`、`技能`、`判定`、`关系`、`好感`、`线索`、`资源`等面板按需出现；无结构化文本时保持纯对白。
- 管理端：发布、回滚、Arc 选择、原版资源引用检查、展示模板配置、媒体接口配置、系统状态。
- 共享协议：Arc release、player save、adaptive presentation、config-service release、runtime bridge proof。
- 外接服务：`game-config-service` 与批准的 `original-runtime-bridge`。
- 测试工具：静态架构审计、浏览器 smoke、admin publish/rollback smoke、fixture adaptive smoke、ST 资源诊断和 runtime smoke。

## 关键证据

- `.codex-longrun/evidence/code-architecture-audit.json`：`prohibitedActive=0`、`needsReview=0`、`failedChecks=[]`。
- `.codex-longrun/evidence/adaptive-presentation-ap3-admin-browser-smoke.json`：管理端展示模板页读取已发布 `dungeon-master-rpg` profile。
- `.codex-longrun/evidence/adaptive-presentation-ap4-save-restore-smoke.json`：保存/读取后自适应面板由原版聊天文本重新计算，存档不含模块状态。
- `.codex-longrun/evidence/adaptive-presentation-ap5-fixture-*.json`：RPG、恋爱、推理、经营、模糊文本矩阵通过。
- `.codex-longrun/evidence/adaptive-presentation-ap5-runtime-browser-smoke.json`：真实浏览器 original Generate 仍通过。

## 不变边界

- 不修改 `src/**`、`server.js`、`plugins.js`、`config.yaml`。
- 不修改原版 `public/index.html`、`public/script.js`、`public/style.css`。
- 不复制角色卡正文、世界书正文、prompt/context 组装。
- 不调用底层 `/api/backends/*/generate` 或 `/api/novelai/generate`。
- 不恢复 narrative-gateway、NarrativeRuntime、SceneResult、continueSession 或本地 scripted fallback。
- 玩家端不显示模型/API/提示词/角色卡/世界书/预设/权重/生成控制等酒馆术语，也不显示管理员入口。

## 仍不声明

- `preset/instruct/system/context` runtimeApplied 仍是 deferred/unbridged。
- regenerate、undo、swipe、group、native Quick Reply 仍是 deferred/unbridged，保持 no-button/no-claim。
- 展示 profile 不能提供 HP、好感、背包、任务、线索、资源等模块值；只能配置模板、启用模块、pattern、阈值和视觉优先级。
- AI 开放式剧本不会天然有确定大结局；结局能力取决于原版角色卡/世界书/聊天种子设计，不由前端伪造。
- 根目录启动脚本的 `NODE_TLS_REJECT_UNAUTHORIZED=0` 差异仍是 out-of-scope 风险，不纳入本 Galgame 交付证据。

## 下一步

下一阶段转入管理端小白化改造准入，依据 `docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md`。

目标不是增加更多工程设置，而是把 `/game-admin/` 默认入口改成“工作台 + 上架故事向导 + 作品库 + 演出增强 + 高级检查”：

- 默认管理路径隐藏 raw JSON、schema、接口、proof、runtime 等工程细节。
- 原版 SillyTavern 能力只通过引用、检查、发布、回滚套壳呈现，不重复开发角色卡、世界书、预设、聊天或生成管理器。
- 自研能力统一放在“演出增强”卡片区，例如展示模板、图片/视频接口、素材表现。
- 高级检查保留原版资源诊断和技术证据，但不作为小白日常主路径。
- 进入代码前必须先通过文档审查；代码阶段必须补 `admin-beginner-smoke` 专门验证默认后台无工程化泄漏。
