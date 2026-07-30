# AI Galgame 单列 RPG HUD 与对话区重构开发文档

> 文档状态：审查修订稿 v1.2  
> 生效日期：2026-07-28  
> 当前阶段：只做设计分析与开发方案，不落业务代码  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`docs/AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md`

## 1. 背景

当前 `/game/` 已能从原版 SillyTavern 可见聊天文本中提取 RPG/D&D 信息，并以状态、背包、技能等卡片展示。上一版 Product Design HUD 让 HP、AC、等级、经验、金币和状态摘要出现在首页，这是正确方向。

但当前视觉仍有明显不足：

- 状态区仍呈现多卡片横向网格，玩家视线需要在“角色状态 / 背包 / 技能”之间左右跳转。
- 角色状态卡片过宽但内部信息密度不均，HP/AC/等级等短值占用大块空间。
- 背包、技能副卡与角色状态卡视觉权重接近，削弱了 HP 等核心参数的第一优先级。
- 状态区与对白框宽度、轴线不完全一致，整体像两层独立 UI 拼在一起。
- 卡片区域容易遮挡角色立绘面部和背景焦点，画面剧场感不足。
- 对话框宽度仍可拉长，给文本阅读和输入区提供更完整、更稳定的版面。
- 当前详情入口藏在各卡片中，完整信息可看，但“主页一眼读懂战况”的效率还不够。

## 2. 目标

把对话框上方的状态展示重构为一个“单列状态带 + 拉长对白框”的统一剧场布局。

核心目标：

- 不再使用左右分栏或多列卡片网格作为主要状态区。
- 状态信息沿同一中心轴、单列排列，与对白框保持同宽或近似同宽。
- 首页完整展示关键生存/战斗参数：HP、AC、等级、经验、金币、当前状态。
- 背包、技能、判定、任务等信息继续保留，但降级为同一状态带中的折叠行/摘要行/详情入口。
- 对话框横向拉长，增强阅读稳定性，减少顶部卡片挤占。
- 继续保持 native-first：这些信息只来自原版 ST 可见聊天文本，不计算、不推断、不保存为玩法权威。

## 3. Native-First 边界

允许：

- 从原版 ST 已读回聊天消息中保守提取 HP、AC、等级、经验、金币、状态、背包、技能、判定等可见信息。
- 将这些信息重排为单列 HUD、摘要行、详情抽屉和视觉层级。
- 对短字段做安全格式化，例如 `HP 12/12`、`AC 15`、`等级 1`。
- 对状态长文本在首页展示摘要，详情抽屉展示完整原文。
- 对背包/技能/判定显示摘要行，并点击打开完整详情。

禁止：

- 不读取、复制或展示角色卡正文、世界书正文、prompt/context、模型参数、密钥。
- 不计算 HP、伤害、AC、负重、技能加值、装备效果、骰子结果或战斗结算。
- 不创建前端背包、技能、状态、任务、关系、节点、结局或剧情状态权威。
- 不根据职业、装备或世界书推断缺失参数。
- 不把行动按钮做成本地分支。任何按钮只可作为普通玩家输入提交回原版 ST。
- 不修改 `src/**`、`server.js`、`plugins.js`、原版 `public/index.html/script.js/style.css`、`config.yaml`、根依赖或启动脚本。

### 3.1 字段缺失与事实来源规则

所有首页状态字段都只能来自原版 SillyTavern 已读回的可见聊天文本。字段包括 HP、AC、等级、经验、金币、状态、背包、技能、判定和任务/目标。

显示规则：

- 原版可见文本明确给出字段和值时，才允许显示该字段。
- 原版可见文本缺失、互相矛盾或格式无法保守识别时，首页默认隐藏该字段。
- 如果布局需要保留稳定槽位，只能显示 `未知`，不能填默认值。
- 不得用职业、装备、世界书、角色卡、管理员备注或前端常识推断真实数值。
- 不得把缺失字段写入玩家保存、manifest、请求体、桥接协议或任何玩法状态。

管理员展示 profile 若未来存在，只能控制模块开关、视觉模板、保守解析规则和首页视觉优先级。它不能提供 HP、AC、等级、经验、金币、背包、技能、状态、任务等事实值。事实值仍只能来自原版已读回的可见聊天文本。

### 3.2 HP 仪表与比例约束

HP 条状仪表是可选的纯视觉呈现，不是新增规则系统。

- 只有原版已读回可见文本在同一处明确给出 `current/max` 时，才显示 HP 比例条。
- `max` 缺失、非数字、为 0 或存在歧义时，不显示比例条；如果 `current` 明确存在，可只显示文本 `HP current`。
- 比例条不能计算伤害、治疗、死亡、重伤、百分比状态或 D&D 规则结算。
- 比例值不得写入保存、请求、manifest、桥接协议或前端玩法状态。
- 颜色变化只能表达同一条已读回文本中的当前/最大值比例，不得被当作规则判定。

## 4. 当前布局问题分析

### 4.1 信息架构

当前卡片按模块平铺：

```text
[角色状态] [背包] [技能]
[对白框]
```

问题是模块分类抢走了关键数值的优先级。玩家真正需要第一眼看到的是：

```text
HP / AC / 等级 / 金币 / 当前危险 / 最近判定
```

而不是先理解“这是状态模块、那是背包模块、那是技能模块”。

### 4.2 视觉层级

当前主状态卡片虽然更宽，但 HP、AC、等级等字段仍像普通小卡片堆叠。角色状态卡有压缩空间：

- `HP 12/12` 可以做成小型条状仪表，不需要大方块。
- `AC 15`、`等级 1`、`金币 50` 都是短字段，可横向压缩。
- `状态` 可以使用一行摘要，不必占据完整卡片宽度。

### 4.3 画面空间

当前顶部 HUD 与对白框不是一个整体。更好的方向是：

- 对白框拉长到 `min(1120px, 100%)` 左右。
- 状态带与对白框同宽，形成一个中心舞台栏位。
- 角色立绘保留在后景，不被多个横向卡片切割。
- 状态带目标高度控制在 96-128px，避免侵占剧情画面；但这不是硬性裁切上限，内容明确存在时必须允许高度自适应。

### 4.4 可读性

首页必须完整显示关键参数，但不应完整铺开背包/技能长列表。否则状态区会变成表格，破坏游戏感。

正确优先级：

1. 生命/防御/等级/资源：首页完整显示。
2. 当前异常/威胁：首页摘要显示，详情完整。
3. 背包/技能/判定：首页显示分类和最近关键项，详情完整。
4. 长清单：只在抽屉中滚动显示。

## 5. 推荐方案：单列状态带

### 5.1 页面结构

改为：

```text
顶部工具栏

舞台画面 / 角色立绘

[单列状态带：与对白框同宽]
  第一行：HP 12/12 | AC 15 | 等级 1 | 经验 0 | 金币 50 | 状态 Healthy...
  第二行：背包 容器1 | 技能 战斗3 | 判定 最近 d20=16 | 任务/目标

[拉长对白框]
  说话人
  剧情文本
  输入区
```

状态带本质上是一个全宽 panel，不再是多张彼此竞争的卡片。

### 5.2 单列定义

本方案中的“单列”含义：

- 页面主阅读轴只有一列：状态带和对白框上下排列。
- 不再把状态/背包/技能以左右分栏卡片作为主要布局。
- 状态带内部允许横向排布短字段，但它们属于同一条状态带，不形成多个独立大卡。
- 移动端进一步压缩为纵向行：

```text
HP 12/12  AC 15  Lv 1
金币 50   状态 Healthy...
背包 / 技能 / 判定 / 详情
```

### 5.3 信息优先级

主参数行：

- HP：最高优先级，始终靠左。
- AC/防御：紧跟 HP。
- 等级：紧跟 AC。
- 经验：有值时展示，无值隐藏。
- 金币/资源：有值时展示。
- 状态摘要：有值时展示，最多一行省略，详情完整。

副信息行：

- 背包：显示最高价值分类，例如 `武器 1`、`关键物 2`、`容器 1`。
- 技能：显示分类数量或最近关键技能，例如 `战斗 3`、`探索 4`。
- 判定：显示最近 1 条判定摘要，例如 `察觉 16 成功`，完整判定进入详情。
- 任务/目标：若原版可见文本有目标，显示 1 条摘要。

### 5.4 通用模块保留

SH1 不能把现有 adaptive-presentation 退化成只支持 `inventory`、`abilities`、`dice`、`objectives` 的硬编码 HUD。

实施规则：

- 第一行/第二行只是首页优先级映射，不是新的展示协议。
- 现有 extractor 产出的所有原版可见模块都必须保留。
- 未进入首页优先级的模块应进入统一详情抽屉或 `更多` 入口，不能丢弃。
- 未知格式必须保留原文，不能因为无法分类就删除。
- 不扩大 shared extractor 协议，不新增玩法字段，不把模块名变成剧情/规则权威。
- 状态带只负责展示排序、摘要和入口；完整记录仍以原版聊天读回内容为来源。

## 6. 交互设计

### 6.1 首页状态带

状态带整体可点击打开“当前信息”详情。

同时，每个副信息 chip 可点击打开对应模块详情：

- 点击 `背包`：打开背包详情。
- 点击 `技能`：打开技能详情。
- 点击 `判定`：打开最近判定详情。
- 点击 `状态`：打开当前局势详情。

如果实现成本需要控制，第一版可只支持整条状态带打开统一详情，第二版再做模块级入口。

### 6.2 详情抽屉

详情抽屉保持现有原则：

- 桌面右侧抽屉或居中宽面板。
- 移动底部抽屉。
- 完整显示所有背包/技能/状态/判定。
- 不显示 `另有 N 项` 作为截断替代。
- 不显示技术词或原始 JSON。
- 保持 `role="dialog"` 与 `aria-modal="true"`。
- 必须有明确关闭按钮。
- 支持 Esc 关闭。
- 打开时焦点进入抽屉并被限制在抽屉内。
- 关闭后焦点回到触发按钮。

### 6.3 对话框

对白框拉长到与状态带统一：

- 桌面宽度：`min(100%, 1120px)` 或 `min(100%, 1160px)`。
- 文本区保持舒适行长，可通过内边距和最大文本宽度控制。
- 输入框与发送按钮保持同一行；窄屏时发送按钮下移。
- 对白框与状态带间距控制在 10-14px，形成一个整体。

### 6.4 键盘、触控与无障碍

- 状态带整体入口和副信息入口必须使用真实 `button`，或具备等价键盘焦点与 `Enter`/`Space` 触发能力；不能用不可聚焦 `span` 承担点击。
- 触控目标最小尺寸不小于 44px。
- 移动端必须考虑安全区，状态带、抽屉和输入框不得被底部手势区或键盘遮挡。
- 动画必须尊重 `prefers-reduced-motion`。
- 状态色不能只靠颜色表达含义，关键状态仍要有文本。
- 文本和背景对比度按现有 UI spec 的可读性标准验收。

## 7. 视觉设计方向

### 7.1 风格

整体方向：日式 RPG 的“战斗信息条 + 视觉小说对白框”。

不采用：

- 大量独立浮动卡片。
- 高饱和霓虹边框。
- 复杂表格式数据面板。
- 单色紫蓝/深蓝一把梭。

采用：

- 深色玻璃底 + 铜金细线 + 红色 HP 强调 + 青蓝技能辅助。
- 8px 以内圆角。
- 细边线、轻阴影、低透明背景。
- HUD 像游戏状态条，对话框像剧情阅读层。

### 7.2 色彩

- HP：暗红底、暖金进度线。
- AC/防御：青灰边线。
- 等级/金币：铜金。
- 状态异常：红/金警示。
- 背包：低饱和棕金。
- 技能：青蓝。
- 判定：金色或白色。

### 7.3 排版

- 参数 label 使用 11-12px，小写或短中文。
- 参数 value 使用 16-20px，粗体。
- 状态摘要使用 14px，最多一行。
- 对话正文保持 18-22px，行高 1.65-1.75。

## 8. 实现计划

### Batch SH0：文档审查

只改文档和状态记录，不改业务代码。

审查重点：

- 单列 HUD 是否仍是 presentation layer。
- 是否没有新增玩法状态和计算。
- 是否没有要求后端或原版 ST 修改。
- 是否保持原版 ST 可见聊天文本为唯一数据来源。
- 是否明确字段缺失、HP 仪表、通用模块保留、无障碍和 source/public 验收规则。

### Batch SH1：玩家 DOM 重构

允许修改：

- `frontend/player/src/main.js`
- `frontend/player/src/styles.css`
- 必要时 `frontend/player/src/index.html`
- `frontend/shared/tests/fixtures/adaptive-presentation/dnd-status-missing-fields.txt`，仅作为测试夹具，用来覆盖缺失字段行为；不得修改 extractor 协议、不得新增玩法字段、不得写入剧情正文到 player/manifest。
- `public/game/**` 从源码重建
- `.codex-longrun/**` 证据

不允许修改：

- `public/game-admin/**`，除非 shared 构建产物确有同步必要；若需要，必须单独说明原因并做 source/public 一致性证据。
- `frontend/admin/**`
- `external-modules/**`
- 冻结的 SillyTavern 后端、原版 public、根依赖和启动脚本。

改动：

- 将 `adaptivePanels` 渲染从多卡 grid 改为单列 `rpg-status-belt`。
- 将 `rpg-status` 主参数作为第一行。
- 将 inventory/abilities/dice/objectives 等高优先级模块作为第二行摘要；其他模块进入统一详情或更多入口。
- 保留现有 detail drawer 数据和打开逻辑。
- 对话框宽度增加，与状态带统一。

SH1 完成后必须立即：

- 从 `frontend/player` 源码重建 `public/game`。
- 做 source/public 一致性检查。
- 做 protected-path diff 检查。
- 做 static DOM 与 architecture 审计。
- 证据通过后才允许进入 SH2。

### Batch SH2：响应式与细节

桌面：

- 状态带和对白框同宽。
- 状态带目标高度为 96-128px；内容明确存在时可增高，禁止为满足高度而裁切。
- 不出现状态区内部滚动条。
- 完整字段 fixture 中，HP/AC/等级/经验/金币/状态摘要均可见且不重叠。
- 缺失字段 fixture 中，缺失项隐藏或显示 `未知`，不得出现默认值。

移动：

- 状态带保持单列。
- 主参数优先保持在 2 行以内；若原版明确状态文本过长，高度可自适应到 3 行，禁止裁切关键参数。
- 副信息 chip 自动换行或折叠为“详情”入口，不能造成页面横向滚动。
- 输入框不被安全区遮挡。
- 详情抽屉可以内部滚动；状态带本身不做内部滚动。

断点验收：

- 桌面：`>= 1024px`
- 窄屏/平板：`640px - 1023px`
- 手机：`< 640px`

每个断点都需要至少验证两套 fixture：

- 完整字段 fixture：HP/AC/等级/经验/金币/状态/背包/技能均存在。
- 缺失字段 fixture：缺失 HP max、缺失金币、缺失经验、未知状态格式。该 fixture 当前尚未存在，SH1 允许新增为测试-only 文件：`frontend/shared/tests/fixtures/adaptive-presentation/dnd-status-missing-fields.txt`。

### Batch SH3：验证

必须运行：

```powershell
node --check frontend/player/src/main.js
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/dnd-status-panel-polish.txt --expect rpg-status,inventory,abilities
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/dnd-status-missing-fields.txt --expect rpg-status
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs --evidence .codex-longrun/evidence/single-column-rpg-hud-architecture.json
git diff --check -- frontend/player frontend/shared frontend/tools public/game docs .codex-longrun
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
```

`git diff --name-only` 的 protected-path 输出必须为空；若命令返回任何受保护路径，SH3 失败并暂停。

`public/game` 必须由当前 `frontend/player` 源码重建，且 source/public 一致性证据必须落盘。不得用旧产物作为当前验收。

source/public 一致性验收复用 `static-architecture-audit.mjs` 的 `source-public-mismatch` 检查：

```powershell
node frontend/tools/static-architecture-audit.mjs --evidence .codex-longrun/evidence/single-column-rpg-hud-source-public.json
```

通过条件：

- `.codex-longrun/evidence/single-column-rpg-hud-source-public.json` 必须存在且非空。
- JSON 中 `failedChecks=[]`。
- JSON 中不得出现 `ruleId="source-public-mismatch"` 的失败项。
- 若 `frontend/player` 源码已改而 `public/game` 未重建，审计必须失败，不能用旧产物通过。

浏览器验收：

- 桌面截图：状态带无内部滚动，HP/AC/等级/金币/状态在首页可见，对话框更长。
- 移动或窄宽度检查：状态带不横向溢出，输入框可用。
- 点击状态带/副信息可打开详情，详情完整保留背包/技能/状态/判定。
- 详情抽屉具备 `role=dialog`、`aria-modal`、关闭按钮、Esc 关闭、焦点锁定和焦点返回。
- `prefers-reduced-motion` 下无强制逐帧动画。

## 9. 验收标准

- 首页状态区为单列主轴，不再呈现左右分栏卡片网格。
- HP、AC、等级、金币等短参数完整显示在首页。
- HP 比例条只有在原版可见文本明确给出 current/max 时显示；max 缺失时不显示比例条。
- 角色状态卡压缩为紧凑状态带，不占据过宽空白。
- 背包、技能、判定等信息完整可查，但不抢主参数视觉权重。
- 所有原版可见模块和未知格式仍可在详情中查看，不因首页优先级调整而丢弃。
- 对话框横向拉长，与状态带统一宽度。
- 状态区不遮挡角色关键面部区域。
- 状态带高度可以自适应内容，不能裁切关键参数或在状态区内部滚动。
- 状态带入口和副信息入口可键盘聚焦，详情抽屉满足 dialog 无障碍规则。
- 无玩家可见模型/API/prompt/角色卡/世界书/预设等技术词。
- 无本地剧情、节点、选择、结局、HP 计算、背包规则引擎或技能规则引擎。
- 原版 ST 冻结路径无内容 diff。
- `public/game` 与 `frontend/player` 源码一致；除非单独说明 shared 产物同步必要，否则不改 `public/game-admin`。

## 10. 审查员准入请求

请审查员确认后再允许落代码：

- 本文档只定义玩家端展示重构，不改变原版 ST 权威。
- 单列 HUD 只使用原版可见聊天文本，不读取隐藏资源。
- 参数显示不等于规则计算，状态带不成为 gameplay state。
- 实现范围限定在 `frontend/player/**`、`public/game/**`、docs 和证据；`public/game-admin/**` 默认不改。
- 执行顺序必须是 SH1 源码改动 -> 重建 `public/game` -> 中间静态/边界审计 -> SH2 响应式细节 -> SH3 浏览器验收。
- 审查通过后，由审查员下达 Batch SH1/SH2 实现与验证指令。
