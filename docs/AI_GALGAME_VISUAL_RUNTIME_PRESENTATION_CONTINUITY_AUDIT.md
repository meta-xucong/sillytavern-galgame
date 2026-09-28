# 视觉运行时表现层连续性审计

日期：2026-09-27
范围：VISUAL-RUNTIME-4 真实 Dungeon Master 剧情探测、player CORE 视觉刷新、Doubao 运行时提示词。

## 1. 用户可见问题

1. 已匹配的技能图标在下一条对白刷新后被占位图覆盖。
2. 自然叙述中的森林/道路没有转成背景意图。
3. 当前开场没有角色立绘。

## 2. 根因

- player 每次响应都从当前响应重建 scene、character、equipment、item、skill 五层；缺少某一层时直接写占位图，丢失上一轮已验证结果。
- provider 固定提示只要求闭合字典，没有要求从自然叙述识别地点，也没有要求在普通续写中沿用最近可见消息建立的场景/角色意图。
- 角色匹配采用 fail-closed 安全门禁。说话人姓名只能形成 identity，必须同时有可见外观、种族、服装或等价证据；不能把 Dungeon Master、speaker 或隐藏角色卡直接猜成某张立绘。

## 3. 修复合同

- 每个视觉层保存最近一次通过完整性校验的 decision。
- 新响应先尝试当前层 decision；当前层没有合格结果时，只有在 profile、catalog、asset version、metadata hash、content hash 与当前请求一致时，才复用上一层。
- 复用不跨新聊天、变更 catalog 或变更 visual profile；加载新聊天时清空层状态。
- 复用仍需重新预加载内容 URL；加载失败仍显示通用占位图。
- provider 只读当前及最近可见对白。普通续写可继承最近可见的 scene/character 代码，但不能使用隐藏上下文或编造剧情。
- 展示阈值仍为 score >= 60 且 scoreBand 为 medium/high；未知决策、低分、schema 错误和服务故障全部占位。

## 4. 已修改文件

- `frontend/player/src/main.js`
- `public/game/app.js`
- `external-modules/visual-asset-service/server.mjs`
- `frontend/player/tests/visual-presentation.test.mjs`

## 5. 审计证据

- controlled launcher 重启成功，服务 8798 健康。
- 真实浏览器调用 `GET /v1/core/visual-context` 返回 200。
- 真实浏览器调用 `POST /v1/core/visual-decisions` 返回 200、`usesLlm=true`、`understandingStatus=ready`。
- 当前 Dungeon Master 开场被识别为 `asset_scene_eb3b253e5066`，score 70；浏览器 stage 为 `is-visual-active`，背景 URL 来自 8798 core catalog。
- 同一响应中的 character 为 `unknown_character`、score 40、`ambiguous-appearance-capped`；这是安全门禁的预期结果，不是素材加载失败。
- item 识别为已发布素材；equipment 与 skill 因当前对白没有足够可见证据而使用占位图。
- player 回归测试新增“当前响应只返回 scene 时，上一轮 character/equipment/item/skill 保持”的断言。

## 6. 后续剧情的可验收条件

角色立绘只有在玩家实际看到的当前或最近对白中出现支持的角色身份与外观/种族/服装证据后才会显示。若剧情只说“Dungeon Master”或只列出武器、HP、技能，不应把任意精灵、盗贼或矮人素材冒充角色。若需要 Dungeon Master 专属立绘，应先把该头像作为 character asset 经过 Doubao 分析、发布并绑定到同一 active catalog，再用含有可见身份和外观证据的对白验收。
