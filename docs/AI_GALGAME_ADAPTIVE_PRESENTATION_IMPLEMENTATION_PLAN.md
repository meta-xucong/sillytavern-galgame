# AI Galgame 自适应展示框架开发计划

> 文档状态：pre-code implementation plan v1.0  
> 生效日期：2026-07-26  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 方案规范：`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`  
> 约束：本文是开发计划，不表示已经允许进入业务 UI 代码。每批次必须先通过审查和静态架构 gate。
> 实施状态：AP0-AP5 已完成，AP6 正在收口。完成证据见 `.codex-longrun/progress.md`、`.codex-longrun/test-log.md` 和 `.codex-longrun/evidence/adaptive-presentation-ap*.json`。完成范围仍是展示层，不包含前端剧情规则、模块数值权威或 deferred/unbridged 原版高级操作。

## 1. 目标

把当前固定视觉小说式 `/game/` 前端升级为“自适应展示框架”：

- 默认只显示基础对白壳。
- 剧本输出 RPG 状态时显示 RPG 面板。
- 剧本输出恋爱关系时显示关系/好感面板。
- 剧本输出推理线索时显示线索面板。
- 剧本输出经营资源时显示资源面板。
- 没有稳定结构时不显示额外模块。

该计划只开发展示、快捷输入、管理员展示配置和测试证据。它不开发任何原版 SillyTavern 已有玩法系统，也不把前端变成剧情权威。

## 2. 硬边界

允许改动：

- `frontend/shared/**`
- `frontend/player/**`
- `frontend/admin/**`
- `frontend/tools/**`
- `public/game/**` 和 `public/game-admin/**`，仅作为从源码重建的产物
- `docs/**`
- `.codex-longrun/**`

禁止改动：

- `src/**`
- `server.js`
- `plugins.js`
- `config.yaml`
- 原版 `public/index.html`
- 原版 `public/script.js`
- 原版 `public/style.css`
- root `package.json`
- root `package-lock.json`

禁止恢复或新增：

- narrative gateway。
- NarrativeRuntime。
- SceneResult。
- continueSession。
- 直接调用 `/api/backends/*/generate` 或 `/api/novelai/generate`。
- 本地 scripted fallback。
- 前端剧情节点、路线、结局、好感、背包、战斗、任务权威状态。
- 角色卡/世界书/prompt/context 正文复制。

## 3. 批次 AP0：文档准入与审查

目标：当前批次只完成文档、审计包和开发准入。

文件：

- `docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`
- `docs/AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md`
- `docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md`
- `docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`
- `docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`
- `.codex-longrun/progress.md`
- `.codex-longrun/test-log.md`
- `.codex-longrun/state.json`

验收：

- 文档明确 versioned contract、模板、模块、置信度、回退、存档边界。
- 文档明确不做剧情权威、不复制资源正文、不本地生成剧情。
- Backlog 有代码批次、文件范围、测试、风险。
- docs-only 检查通过。
- 静态架构审计保持通过。
- 冻结边界输出为空。
- 独立审查员复审通过后才进入 AP1。

命令：

```powershell
rg -n "galgame.adaptive-presentation.v1|rpg-adventure|romance-social|mystery-investigation|management-sim|sandbox-roleplay|confidence|displayOnly|no-button/no-claim|剧情权威|资源正文" docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md docs/AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
git diff --check -- docs .codex-longrun
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json
python "%USERPROFILE%\.codex\skills\long-running-task\scripts\validate_state.py" --project .
```

## 4. 批次 AP1：共享提取协议与测试骨架

目标：实现纯函数展示提取，不接 UI、不调 ST、不改运行时。

预计文件：

- `frontend/shared/src/adaptive-presentation.js`
- `frontend/shared/src/adaptive-presentation-schema.js`
- `frontend/shared/tests/adaptive-presentation.test.mjs`
- `frontend/shared/tests/fixtures/adaptive-presentation/*.json`

功能：

- 定义 `AdaptivePresentationProfileV1` normalize/validate。
- 定义 `PresentationExtractionResultV1`。
- 实现内置 pattern registry。
- 实现置信度评分。
- 实现低置信度回退。
- 实现 forbidden-key guard，拒绝剧情权威字段进入持久化对象。

测试 fixture：

- `plain-visual-novel.txt`：只应输出 actions 或空模块。
- `dungeon-master-rpg.txt`：提取 HP、AC、XP、Inventory、Abilities、Status、Actions。
- `romance-affection.txt`：提取关系/好感/礼物。
- `mystery-clues.txt`：提取线索/地点/目标。
- `management-resources.txt`：提取资源/日期/目标。
- `ambiguous-natural-language.txt`：低置信度不显示模块。
- `forbidden-parallel-state.json`：拒绝 node/route/ending/variables，以及会把 relationship/affection 写成前端权威状态的字段。注意：这不禁止从原版可见聊天文本 display-only 展示关系/好感信息。

验收：

```powershell
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/shared/tests/sillytavern-adapter.test.mjs
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json
```

通过标准：

- 纯文本输入即可测试。
- 不访问 SillyTavern API。
- 不把模块值写入 save/state 权威。
- 审计无 prohibited-active / needs-review。

## 5. 批次 AP2：玩家端模块渲染壳

目标：把 AP1 提取结果渲染成按需面板，但不改变生成链路。

预计文件：

- `frontend/player/src/adaptive-panels.js`
- `frontend/player/src/render-adaptive-panels.js`
- `frontend/player/src/main.js`
- `frontend/player/src/styles.css`
- `frontend/player/src/index.html`
- `public/game/**`，从源码重建

功能：

- 基础对白模式默认不显示面板。
- 有 RPG 结果时显示状态/背包/技能面板。
- 有恋爱结果时显示关系/好感/礼物面板。
- 有推理结果时显示线索/目标面板。
- 有经营结果时显示资源面板。
- 移动端面板进入抽屉或折叠区域。
- 模块值显示来源消息标记，但玩家不可见技术术语。
- 面板不参与提交给原版 Generate。

玩家文案：

- `状态`
- `背包`
- `技能`
- `关系`
- `线索`
- `目标`
- `资源`
- `上次记录`

禁止文案：

- `解析器`
- `profile`
- `confidence`
- `SillyTavern`
- `世界书`
- `提示词`
- `API`

验收：

```powershell
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001 --player-only true
node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001 --player-only true --runtime-reply-smoke true
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
```

额外截图证据：

- `.codex-longrun/screenshots/adaptive-vn-plain.png`
- `.codex-longrun/screenshots/adaptive-rpg-status.png`
- `.codex-longrun/screenshots/adaptive-romance-relationships.png`
- `.codex-longrun/screenshots/adaptive-mobile-collapsed.png`

通过标准：

- Dungeon Master 状态块不再只堆在对白框里；RPG 面板能按需出现。
- 普通无结构文本不出现空面板。
- 行动按钮仍只是快捷输入。
- 两轮真实 Generate 仍通过。

## 6. 批次 AP3：管理员展示配置页

目标：管理员可以给剧本选择推荐模板和模块偏好，但不编辑剧情正文或资源正文。

预计文件：

- `frontend/admin/src/adaptive-profile-page.js`
- `frontend/admin/src/main.js`
- `frontend/admin/src/styles.css`
- `frontend/shared/src/protocol.js`
- `frontend/shared/tests/protocol.test.mjs`
- `public/game-admin/**`，从源码重建

功能：

- 为 story entry / Arc 保存 `AdaptivePresentationProfileV1`。
- 模板选择：视觉小说、RPG 冒险、恋爱社交、推理调查、经营模拟、沙盒角色扮演。
- 模块多选：状态、背包、技能、关系、好感、礼物、线索、目标、资源等。
- 低置信度策略。
- 管理员自定义 pattern，来源限定 `visible-chat-text`。
- 发布前校验 profile schema。

禁止：

- 输入角色卡正文。
- 输入世界书正文。
- 输入 prompt 或 system 文本。
- 输入固定剧情或固定选项。
- 配置 HP/好感度初始值。

验收：

```powershell
node frontend/shared/tests/protocol.test.mjs
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
```

通过标准：

- 管理员配置只保存 profile 引用和展示规则。
- 玩家端不出现管理员入口。
- 缺失或非法 profile 会被管理员发布阻止。

## 7. 批次 AP4：存档与恢复适配

目标：让模块折叠状态可恢复，但模块值必须从原版聊天重新提取。

预计文件：

- `frontend/shared/src/player-save.js`
- `frontend/shared/tests/player-save.test.mjs`
- `frontend/player/src/adaptive-panels.js`

允许保存：

- `collapsedModuleIds`
- `lastPanelTab`
- `lastMessageIndex`
- `pageIndex`
- `visualState`

禁止保存：

- `hp`
- `affection`
- `inventory`
- `quest`
- `clues`
- `resources`
- `node`
- `route`
- `ending`
- `variables`

验收：

```powershell
node frontend/shared/tests/player-save.test.mjs
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001 --player-only true --save-restore-smoke true
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
```

通过标准：

- 读档后重新从 chatId 读原版聊天。
- 面板值来自重新提取，不来自 save 权威。
- save validator 拒绝剧情状态字段。

## 8. 批次 AP5：真实剧本回归矩阵

目标：用已有真实剧本验证自适应能力。

剧本：

- Dungeon Master：RPG 状态、背包、技能、行动按钮。
- Lucifer：视觉小说/沙盒剧情，不能强行显示 RPG 面板。
- Apartment 5C：视觉小说/悬疑倾向，按输出决定是否显示线索。
- 人工 fixture：恋爱好感、经营资源、推理线索。

验收命令：

```powershell
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/dungeon-master-rpg.txt --expect rpg-status,inventory,abilities,actions
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/romance-affection.txt --expect relationships,affection,gifts
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/mystery-clues.txt --expect clues,objectives
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/ambiguous-natural-language.txt --expect none
node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001 --player-only true --runtime-reply-smoke true
```

通过标准：

- 模块按需出现。
- 低置信度不误判。
- 玩家自由输入和原版 Generate 不受影响。
- 不出现玩家可见技术词。

## 9. 批次 AP6：文档和审计收口

目标：完成开发后的最终一致性。

更新：

- `docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`
- `docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`
- `docs/GALGAME_IMPLEMENTATION_STATUS.md`
- `.codex-longrun/progress.md`
- `.codex-longrun/test-log.md`
- `.codex-longrun/blockers.md`
- `.codex-longrun/state.json`

验收：

```powershell
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json
node frontend/tools/static-dom-smoke.mjs
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/shared/tests/player-save.test.mjs
node frontend/shared/tests/protocol.test.mjs
git diff --check -- docs .codex-longrun frontend public/game public/game-admin external-modules
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json
python "%USERPROFILE%\.codex\skills\long-running-task\scripts\validate_state.py" --project .
```

通过标准：

- 审计绿。
- docs/test-log/state 一致。
- 冻结边界为空。
- 旧失败证据保留为 superseded，不改写为 passed。
- deferred/unbridged 能力仍 no-button/no-claim。

## 10. 风险与应对

| 风险 | 根因 | 应对 |
| --- | --- | --- |
| 前端把 HP/好感度变成真实状态 | 为了游戏感过度开发 | 所有模块值只从原版聊天提取，save 不保存数值权威 |
| 低置信度误判 | 文本格式自由 | 阈值保守，无法识别则纯对白 |
| 管理员 pattern 变成 prompt | 配置边界不清 | pattern source 限定 visible-chat-text，禁止正文/prompt |
| 面板挤压阅读体验 | 模块过多 | 移动端折叠，桌面优先级，基础对白永远优先 |
| 行动按钮被当分支 | UI 类似选择 | 点击只提交文本，不保存 choice/node |
| 特定剧本定制污染通用框架 | 为 Dungeon Master 写死 | 内置 fixture 覆盖多类型，代码不能引用具体剧本 id 决定模块 |
| 误报 runtimeApplied | reference 和 runtime 混淆 | 本计划只做展示；运行配置应用证据仍按原有 bridge/evidence 单独验收 |

## 11. 进入代码开发的放行条件

必须同时满足：

- `docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md` 通过审查。
- `docs/AI_GALGAME_ADAPTIVE_PRESENTATION_IMPLEMENTATION_PLAN.md` 通过审查。
- `docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` 和 `docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md` 已引用该计划。
- 静态架构审计当前为 `ok=true`。
- 冻结边界输出为空。
- 长任务状态为 implementing/advancing，且 next_actions 指向 AP1。
- 审查员没有提出 unresolved blocker。

通过后，第一批只能做 AP1 共享纯函数提取协议和测试骨架，不直接改玩家 UI。
