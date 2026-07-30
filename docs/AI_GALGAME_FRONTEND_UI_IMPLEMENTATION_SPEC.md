# AI Galgame 前端 UI 实施规格

> 文档状态：正式 UI 代码落地前必备材料 v1.0  
> 生效日期：2026-07-25  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 关联文档：`docs/AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`、`docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`、`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`、`docs/AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md`、`docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md`

## 1. 目的与边界

本文是玩家端与管理员端前端 UI 的施工级规格。它补足交互方案中尚未细化的视觉 token、组件结构、响应式、微交互、文案、素材与截图验收。

本规格只定义展示和操作方式，不定义剧情系统。所有剧情文本、行动建议、聊天历史、生成语义、角色卡、世界书、预设、上下文和运行配置仍以 SillyTavern 原版为权威。

硬约束：

- 玩家端停留在自定义 `/game/` Galgame UI，不跳原版复杂 UI。
- 玩家端不出现模型、API、Token、提示词、角色卡、世界书、预设、权重、上下文、生成控制、SillyTavern 等技术词。
- 玩家端不得新增 `SceneResult`、固定剧情、固定选择、剧情节点、好感度、物品、结局条件或本地 scripted fallback。
- 行动按钮只能来自原版可见聊天文本的保守展示提取，点击后等价于提交同一段玩家输入。
- RPG 状态、背包、技能、恋爱关系、好感度、礼物、推理线索、经营资源等扩展面板必须遵守 `galgame.adaptive-presentation.v1`：模块值只按需展示原版可见聊天文本；管理员展示 profile 只能提供模板、启用模块、解析规则和视觉优先级，不能保存为前端剧情权威。
- RPG/D&D 状态栏精修必须遵守 `docs/AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md`：背包、状态、技能只能做摘要、分类、详情抽屉和翻译展示，不得计算规则或保存前端物品/技能/状态权威。
- 所有 `deferred/unbridged` 能力保持 no-button/no-claim。

截至 2026-07-26，自适应展示 AP0-AP5 已落地：玩家端已有按需展示面板，管理员端已有展示模板配置页，保存/读取会重新从原版聊天文本计算面板，fixture 与真实浏览器回归均通过。该状态不授权新增前端剧情规则、profile-sourced 模块值或未桥接高级原版操作。
- 管理员端可以展示原版资源引用与诊断，但不得复制、展示或编辑角色卡正文、世界书正文、prompt 正文或密钥。

## 2. 视觉设计 Token

### 2.1 色彩

建议使用 CSS custom properties 固化色彩，不在组件中散落硬编码。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--color-ink` | `#20232c` | 主要文字 |
| `--color-muted` | `#6b7280` | 次级文字、说明 |
| `--color-paper` | `#f8f4ee` | 标题页和抽屉浅底 |
| `--color-stage-night` | `#171923` | 舞台暗部、遮罩 |
| `--color-dialogue` | `rgba(18, 20, 29, 0.86)` | 对话框背景 |
| `--color-dialogue-border` | `rgba(255, 255, 255, 0.22)` | 对话框边线 |
| `--color-accent` | `#b73e5d` | 主操作、焦点、当前项 |
| `--color-accent-soft` | `#f2d7df` | 主操作浅背景 |
| `--color-gold` | `#c59b4b` | 标题点缀、章节标识 |
| `--color-success` | `#2f8f6b` | 保存成功、检查通过 |
| `--color-warning` | `#b7791f` | 可恢复警告 |
| `--color-danger` | `#b83a4b` | 阻止发布、失败 |
| `--color-focus` | `#3b82f6` | 键盘焦点环 |

不得让界面变成单一紫蓝、深蓝、咖啡或米色主题。主色只用于操作与强调；舞台背景和角色美术承担主要气氛。

### 2.2 字体与字号

默认字体栈：

```css
font-family: system-ui, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
```

标题可使用更有日式游戏感的衬线字体，但必须提供系统字体 fallback。

| 场景 | 桌面字号 | 移动字号 | 行高 | 说明 |
| --- | ---: | ---: | ---: | --- |
| 作品标题 | 44px | 32px | 1.12 | 只用于标题页 |
| 章节/Arc 名 | 20px | 17px | 1.3 | HUD 或过场 |
| 角色名 | 18px | 16px | 1.25 | 对话框名牌 |
| 正文对白 | 22px | 18px | 1.65 | 主要阅读文本 |
| 行动按钮 | 16px | 15px | 1.35 | 最多两行 |
| 抽屉正文 | 15px | 14px | 1.55 | 历史、存档、设置 |
| 辅助信息 | 12px | 12px | 1.4 | 版本、时间、状态 |

禁止用 `vw` 直接缩放字号。屏幕变化通过布局、宽度和分页处理。

### 2.3 间距、圆角与阴影

| Token | 值 | 用途 |
| --- | ---: | --- |
| `--space-1` | 4px | 图标与文字间距 |
| `--space-2` | 8px | 小按钮内边距 |
| `--space-3` | 12px | 表单间距 |
| `--space-4` | 16px | 组件间距 |
| `--space-6` | 24px | 页面区块间距 |
| `--space-8` | 32px | 标题页主间距 |
| `--radius-sm` | 6px | 按钮、输入框 |
| `--radius-md` | 8px | 卡片、抽屉内项 |
| `--radius-lg` | 12px | 对话框、模态 |
| `--shadow-panel` | `0 18px 48px rgba(0,0,0,.28)` | 对话框和抽屉 |
| `--shadow-button` | `0 6px 16px rgba(0,0,0,.18)` | 主要按钮 |

卡片圆角默认不超过 8px；对话框允许 12px，但不能变成移动应用卡片感。

### 2.4 层级

| 层 | z-index | 内容 |
| --- | ---: | --- |
| 背景 | 0 | 背景图、场景色 |
| 媒体层 | 10 | CG、视频、过场图 |
| 角色层 | 20 | 立绘、角色阴影 |
| 舞台遮罩 | 30 | 暗角、阅读渐变 |
| HUD | 40 | 顶部轻工具 |
| 对话框 | 50 | 角色名、文本、输入 |
| 行动按钮 | 60 | 选项快捷输入 |
| 抽屉/模态 | 80 | 历史、存档、设置 |
| Toast | 90 | 非阻塞提示 |
| 全屏阻断 | 100 | 发布阻断、严重错误 |

## 3. 响应式与输入环境

### 3.1 断点

| 名称 | 范围 | 布局规则 |
| --- | --- | --- |
| mobile | `0-639px` | 单列，HUD 压缩为图标，底部输入占满宽度 |
| tablet | `640-1023px` | 单舞台，抽屉宽度 420px 或全屏 |
| desktop | `1024-1439px` | 舞台居中，HUD 完整显示 |
| wide | `1440px+` | 舞台最大宽度限制，背景全屏铺开 |

### 3.2 移动端安全区

- 根容器使用 `min-height: 100dvh`。
- 底部对话框和输入区必须加 `padding-bottom: max(16px, env(safe-area-inset-bottom))`。
- 顶部 HUD 加 `padding-top: max(12px, env(safe-area-inset-top))`。
- 页面禁止横向滚动。

### 3.3 竖屏与横屏

竖屏：

- 角色层高度不超过视口 56%。
- 对话框固定在底部，正文最多显示 5 行，超出分页。
- 行动按钮在对话框上方或内部底部，以 1 列或 2 列显示。

横屏：

- 角色层可占视口 70%。
- 对话框高度控制在 30%-38%。
- 行动按钮最多 2 列，按钮不得遮挡正文。

### 3.4 移动键盘

- 输入框聚焦时，对话框整体上移或改为紧凑模式。
- 不允许输入框被系统键盘遮住。
- 输入时保留当前角色名和最新对白摘要。
- 提交后键盘收起，舞台显示“思考中”。

## 4. 玩家端组件规格

### 4.1 AppShell

建议结构：

```html
<main id="appShell" class="game-shell">
  <section id="titleScreen"></section>
  <section id="gameScreen"></section>
  <aside id="historyDrawer"></aside>
  <aside id="saveLoadDrawer"></aside>
  <aside id="settingsDrawer"></aside>
  <div id="toast" role="status"></div>
</main>
```

状态：

- `booting`：读取当前发布入口。
- `title-ready`：标题页可操作。
- `stage-ready`：舞台可读。
- `submitting`：玩家输入已提交，等待原版回复。
- `recoverable-error`：保留舞台，显示恢复操作。

禁止：

- 在 AppShell 内放管理员入口。
- 在玩家端展示原版资源、模型或接口状态。

### 4.2 标题页

DOM：

```html
<section id="titleScreen" class="title-screen">
  <div class="title-visual"></div>
  <h1 id="gameTitle"></h1>
  <p id="gameSubtitle"></p>
  <nav class="title-menu"></nav>
  <p id="contentNotice"></p>
</section>
```

按钮：

- `开始游戏`：读取当前 release 的绑定开场聊天种子，进入舞台。
- `继续游戏`：有有效存档或最近聊天时显示，否则隐藏或禁用。
- `读取`：打开存档抽屉。
- `设置`：打开设置抽屉。

状态：

- `loading`：按钮禁用，显示“正在准备”。
- `ready`：按钮可用。
- `no-save`：继续游戏隐藏或禁用。
- `recoverable-error`：显示“暂时无法开始”，保留重试按钮。

标题页不得展示剧本选择、资源绑定、管理员链接或技术错误。

### 4.3 Galgame 舞台

DOM：

```html
<section id="gameScreen" class="game-stage">
  <div id="stageBackdrop" class="stage-backdrop"></div>
  <div id="mediaLayer" class="media-layer"></div>
  <div id="characterLayer" class="character-layer"></div>
  <header id="hudBar" class="hud-bar"></header>
  <section id="dialogueBox" class="dialogue-box"></section>
  <section id="suggestedActions" class="action-layer"></section>
  <form id="playerInputForm" class="player-input"></form>
  <section id="recoveryActions" class="recovery-actions"></section>
</section>
```

状态：

- `reading`：显示原版消息，可点击推进或分页。
- `typing`：逐字显示中。
- `page-end`：本条消息还有下一页。
- `choice-ready`：存在原版输出行动建议。
- `input-ready`：可自由输入。
- `thinking`：等待原版运行时桥接。
- `recovering`：桥接失败或超时，显示恢复操作。

舞台只展示原版聊天内容和显示锚点，不保存剧情事实。

### 4.4 HUD

内容：

- 作品名或 Arc 标题。
- 历史。
- 保存。
- 读取。
- 设置。
- 返回标题。

桌面：文字 + 图标。  
移动：优先图标，长按或 hover tooltip 解释。

禁止：

- 模型切换。
- 预设切换。
- 原版资源入口。
- 管理员入口。
- 生成参数按钮。

### 4.5 对话框

DOM：

```html
<section id="dialogueBox" class="dialogue-box" aria-live="polite">
  <div id="speakerName" class="speaker-name"></div>
  <div id="dialogueText" class="dialogue-text"></div>
  <div id="pageIndicator" class="page-indicator"></div>
</section>
```

规则：

- `dialogueText` 显示 `displayText`；如果展示提取失败，显示原版消息原文。
- 单页正文桌面不超过 6 行，移动不超过 5 行。
- 长文本分页只改变阅读节奏，不删改原文。
- `可选行动：` 标题若被成功识别，不能泄漏在正文；若识别失败，保留原文并隐藏按钮。

### 4.6 行动按钮

DOM：

```html
<section id="suggestedActions" class="action-layer" aria-label="可选行动"></section>
```

来源：

- 仅来自 `galgame.presentation-extraction.v1` 对原版可见聊天文本的保守提取。

交互：

- 点击按钮等价于把按钮文字填入自由输入并提交。
- 按钮点击后立即禁用，进入 `thinking`。
- 不得在前端决定分支、节点、结局或变量。
- 少于 2 个可靠行动时，不显示按钮。

样式：

- 桌面最多 2 列。
- 移动默认 1 列，宽屏手机可 2 列。
- 按钮文本最多两行，超出省略或换行，不撑破容器。

### 4.7 自由输入

DOM：

```html
<form id="playerInputForm" class="player-input">
  <textarea id="playerInput"></textarea>
  <button id="submitActionButton" type="submit">送出</button>
</form>
```

交互：

- `Enter` 发送。
- `Shift+Enter` 换行。
- 移动端发送按钮始终可见。
- 空输入禁用发送。
- 等待原版回复时输入框禁用。
- 失败恢复时保留刚才输入，可一键重试。

禁止：

- 自由输入不得附带隐藏 prompt。
- 不得把输入解析成本地指令、道具或剧情变量。

### 4.8 历史抽屉

DOM：

```html
<aside id="historyDrawer" class="drawer history-drawer"></aside>
```

内容：

- 当前原版聊天可见消息。
- 说话人、文本、时间。
- 当前显示位置标记。

交互：

- 只读回看。
- 可跳到某条消息附近的显示位置。
- 关闭后回到舞台。

禁止：

- 不提供编辑、删除、重生成、swipe。
- 不展示原始 JSON、prompt 或系统消息。

### 4.9 存档与读档抽屉

DOM：

```html
<aside id="saveLoadDrawer" class="drawer save-load-drawer"></aside>
```

存档卡片显示：

- 作品名。
- Arc 标题。
- 最后一条可见文本摘要。
- 保存时间。
- 背景缩略图或默认图。

保存字段仅限 `galgame.player-save.v1`：release、scenario、arc、chatId、lastMessageIndex、pageIndex、visualState、mediaJobIds。

交互：

- 自动存档 1 个。
- 手动存档建议 6 个。
- 读档必须重新读取原版 chatId；本地摘要不能冒充原版聊天。
- 旧 release 存档继续绑定旧 release。

禁止：

- 保存剧情节点、变量、关系、物品、结局条件或结构化场景结果。

### 4.10 设置抽屉

允许项：

- 文字速度：慢 / 标准 / 快 / 立即。
- 自动播放速度。
- 音量：BGM / 语音 / 音效，尚未接入时显示为未启用或隐藏。
- 字体大小：小 / 标准 / 大。
- 降低动态效果。
- 全屏。

禁止项：

- 模型。
- API。
- Token。
- 提示词。
- 预设。
- 角色卡。
- 世界书。
- 采样参数。

### 4.11 媒体层

状态：

| 状态 | UI |
| --- | --- |
| none | 显示背景和立绘 |
| queued/running | 轻量角标，不遮挡对白 |
| succeeded | 在句子边界淡入 CG/视频 |
| failed | 静默降级，可在历史中弱提示 |
| expired | 使用降级资源，可重新请求 |

媒体请求只使用 `galgame.media-job.v1`，来源必须是原版可见聊天、管理员标记、已审查扩展事件或管理员测试。

媒体失败不得阻断剧情推进。

### 4.12 错误与恢复

玩家可见提示必须短、游戏化、非技术化。

恢复 UI：

- `再试一次`：重新请求桥接或重新读取原版聊天。
- `回到标题`：回标题页。
- `稍后继续`：保存当前显示状态。

禁止：

- 播放本地剧情。
- 显示接口路径、堆栈、原始 JSON。
- 将其他聊天回复改名显示为当前聊天。

## 5. 管理员端 UI 规格

管理员端独立在 `/game-admin/`，不从玩家端链接进入。

截至 2026-07-26，管理员端下一轮改造以 `docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` 为准：默认入口必须是非技术人员可理解的工作台与上架向导；本节 5.1-5.5 中的工程型页面能力保留为底层能力或高级检查，不再作为默认小白主路径。默认小白路径不得展示 raw JSON、schema、proof、endpoint、runtime、worldbook、prompt、preset 等工程词；需要展示原版资源事实时使用“角色资料”“世界设定”“开场记录”“回复通道”等友好文案。自研展示模板、媒体接口、素材表现必须归入独立“演出增强”卡片区，不得和原版资源管理混写。

安全边界：

- `/game/` 与 `/game-admin/` 必须路由、导航和入口分离；玩家端绝不出现后台入口。
- `/game-admin/` 默认隐藏高级导入、原始 JSON、发布回滚和诊断细节只是降低学习成本，不是认证。
- 真实管理员认证必须由外部服务、反向代理、独立 admin service 或等价部署层提供；前端路由守卫、CSS 隐藏、CORS 和按钮隐藏不能当作认证。
- 所有导入、发布、回滚、高级检查、媒体测试和原版资源诊断接口都必须遵守管理员访问控制边界。
- API key、模型密钥、管理员 token、bridge proof secret、媒体 provider 密钥不得写入前端代码、静态产物、manifest、localStorage、IndexedDB 或日志。

### 5.1 当前发布页

必须显示：

- 当前 release。
- scenario/version/arc。
- 发布状态。
- 资源引用完整性。
- 回滚入口。

发布按钮规则：

- 缺失角色、世界书、preset、context、chat seed 时阻止。
- `runtimeApplied` 未桥接项不得显示“已应用”，只能显示“引用存在，运行时应用未桥接”。

### 5.2 故事入口页

只维护：

- 入口 manifest。
- Arc 绑定。
- 展示 profile。
- 媒体策略。
- 原版资源引用。

禁止：

- 剧情树编辑。
- 固定台词/固定选项编辑。
- 角色卡正文/世界书正文编辑。

### 5.3 原版资源页

必须显示：

- 角色引用。
- 世界书引用。
- 预设/context 引用。
- chat seed 引用。
- 存在性检查结果。

不得显示：

- 资源正文。
- prompt 正文。
- API key。
- 原版设置完整可编辑表单。

### 5.4 运行检查页

分级显示：

- `referenceExists: passed/failed`
- `runtimeApplied: verified/deferred/unbridged/failed`
- 桥接健康。
- 目标聊天读回结果。

不得把 `referenceExists` 当作 `runtimeApplied`。

### 5.5 媒体页

允许：

- 媒体服务地址状态。
- provider-neutral 测试任务。
- 最近任务安全摘要。

禁止：

- 保存密钥到静态前端。
- 暴露完整 prompt。
- 从剧情变量生成媒体任务。

## 6. 微交互

### 6.1 逐字显示

- 标准速度：每字符 28-36ms。
- 快速：每字符 12-18ms。
- 立即：直接显示整页。
- 标点停顿最多 180ms。
- 点击正在显示的文本：显示当前页全文。
- 再次点击：进入下一页或等待输入。
- 逐字显示只作用于当前原版聊天消息的展示片段；片段类型来自保守展示提取，不能成为剧情状态、分支条件或生成输入。
- 角色回复可按旁白、对白、舞台动作和玩家输入四类显示不同姓名牌、文字色和对话框背景；识别失败时按旁白显示原文。

### 6.2 分页

- 分页不修改原文。
- 分页符只存在 UI 状态。
- 读档恢复 `lastMessageIndex + pageIndex`。
- 行动按钮只在消息最后一页出现。

### 6.3 Loading

`thinking` 状态：

- 输入禁用。
- 行动按钮禁用。
- 对话框状态显示“思考中”。
- 保留玩家刚提交的文本或上一条角色回复，不清空舞台。

### 6.4 按钮状态

| 状态 | 要求 |
| --- | --- |
| default | 清晰可点击，触控目标不小于 44px |
| hover | 亮度或边线变化，不移动布局 |
| pressed | 轻微下沉或缩放，持续小于 120ms |
| focus | 明确焦点环 |
| disabled | 不可点击，透明度降低但文字可读 |
| loading | 显示细小进度，不改变按钮尺寸 |

### 6.5 动画

- 标题进入：200-360ms 淡入。
- 对话框出现：160-240ms。
- CG 淡入：300-600ms。
- 抽屉打开：180-260ms。
- 减少动态效果开启时，所有动画小于 80ms 或直接关闭。

## 7. 玩家可见中文文案表

| 场景 | 文案 |
| --- | --- |
| 启动加载 | 正在准备 |
| 开始按钮 | 开始游戏 |
| 继续按钮 | 继续游戏 |
| 读取按钮 | 读取 |
| 设置按钮 | 设置 |
| 历史按钮 | 历史 |
| 保存按钮 | 保存 |
| 输入占位 | 输入你的行动或台词 |
| 发送按钮 | 送出 |
| 等待回复 | 思考中 |
| 桥接超时 | 这一段暂时没接上 |
| 重试按钮 | 再试一次 |
| 返回标题 | 回到标题 |
| 保存成功 | 已保存 |
| 保存失败 | 暂时无法保存 |
| 读档失败 | 这个存档暂时无法读取 |
| 开场缺失 | 当前游戏暂时无法开始 |
| 媒体处理中 | 画面正在准备 |
| 媒体失败 | 画面稍后再试 |

禁止玩家可见词：

- SillyTavern
- 模型
- API
- Token
- 提示词
- 预设
- 角色卡
- 世界书
- 上下文
- 权重
- 生成控制
- 采样
- 原版资源
- 管理员

## 8. 可访问性

- 所有按钮可通过键盘聚焦。
- 焦点顺序：标题菜单 -> HUD -> 对话框操作 -> 行动按钮 -> 输入框 -> 抽屉内容。
- 对话框使用 `aria-live="polite"`，避免每个字符都读屏轰炸。
- 抽屉打开时焦点锁在抽屉内，关闭后回到触发按钮。
- 所有图标按钮有 `aria-label`。
- 文本与背景对比度至少 4.5:1。
- 行动按钮触控目标不小于 44px。
- 支持 `prefers-reduced-motion`。

## 9. 素材规格

| 类型 | 推荐尺寸 | 格式 | 裁切规则 | 降级 |
| --- | --- | --- | --- | --- |
| 标题图 | 1920x1080 | WebP/PNG | 保留中心主体，移动端允许上下裁切 | `title-scene.svg` |
| 背景 | 1920x1080 | WebP/PNG | `object-fit: cover` | 默认背景 |
| 立绘 | 高 1400-1800 | PNG/WebP 透明 | 桌面脚部可出屏，脸部不可裁 | 默认角色 |
| CG | 1536x864 或 1920x1080 | WebP/PNG | 不遮挡对话框核心区域 | 保留背景 |
| 视频 | 1280x720 起 | MP4/WebM | 自动静音预览，用户可打开 | 封面图 |
| 缩略图 | 320x180 | WebP/PNG | 16:9 | 默认缩略图 |

所有外部 URL 必须经过媒体安全规则；禁止 `file:`、`data:`、`javascript:`。

## 10. 截图验收标准

必须至少保留以下截图证据：

| 截图 | 视口 | 必须看到 | 不得出现 |
| --- | --- | --- | --- |
| player-title-desktop | 1366x768 | 标题、开始、读取、设置 | 技术词、管理入口 |
| player-title-mobile | 390x844 | 标题、开始按钮不溢出 | 横向滚动 |
| player-stage-desktop | 1366x768 | 背景、角色层、HUD、对白框、输入 | 文本遮挡、原版 UI |
| player-stage-mobile | 390x844 | 对话框、输入、行动按钮可点 | 键盘遮挡输入 |
| player-thinking | 1366x768 | 思考中、输入禁用、舞台保留 | 本地兜底台词 |
| player-recovery | 390x844 | 这一段暂时没接上、再试一次 | 接口错误、JSON |
| player-history | 1366x768 | 当前聊天历史只读 | 编辑/删除/重生成 |
| player-save-load | 1366x768 | 存档卡、时间、摘要 | 剧情变量/节点 |
| player-settings | 390x844 | 字体/速度/音量/动效 | 模型/API/preset |
| admin-resources | 1366x768 | 引用存在性诊断 | 资源正文/密钥 |
| admin-runtime-check | 1366x768 | referenceExists/runtimeApplied 分级 | “已应用”误报 |
| admin-media | 1366x768 | provider-neutral 健康检查 | 密钥输入到静态前端 |

截图验收不替代架构审计；它只证明 UI 可见层没有明显违背设计。

## 11. 文件级落地边界

允许未来 UI 代码涉及：

- `frontend/player/src/index.html`
- `frontend/player/src/styles.css`
- `frontend/player/src/main.js`
- `frontend/player/src/render-stage.js`
- `frontend/player/src/render-actions.js`
- `frontend/player/src/render-history.js`
- `frontend/player/src/render-save-load.js`
- `frontend/player/src/render-settings.js`
- `frontend/player/src/render-media.js`
- `frontend/player/src/text-pagination.js`
- `frontend/admin/src/index.html`
- `frontend/admin/src/styles.css`
- `frontend/admin/src/main.js`
- `frontend/admin/src/arc-config-page.js`
- `frontend/admin/src/runtime-check-page.js`
- `frontend/admin/src/media-page.js`

任何新增文件都必须继续满足：

- SillyTavern endpoint 细节只在共享适配层。
- 玩家端不直接调用底层生成接口。
- 管理员端不复制原版资源正文。
- 构建后 `public/game/**` 与 `frontend/player/**` 对应，`public/game-admin/**` 与 `frontend/admin/**` 对应。

## 12. UI 代码准入检查

落 UI 业务代码前必须先通过：

1. `node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json`
2. `rg -n "视觉设计 Token|标题页|Galgame 舞台|对话框|行动按钮|自由输入|历史抽屉|存档|设置抽屉|媒体层|错误与恢复|响应式|移动键盘|逐字显示|玩家可见中文文案表|可访问性|素材规格|截图验收标准|native-first|no-button/no-claim|deferred/unbridged" docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md > .codex-longrun/evidence/ui-implementation-spec-coverage.txt`
3. `Test-Path docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`
4. `git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json`

通过标准：

- UI 实施规格结构和覆盖度证据存在。
- 静态架构审计无 `prohibited-active`。
- 冻结边界输出为空。
- `deferred/unbridged` 能力没有进入玩家按钮或可用声明。
- 本轮未开始玩家/管理员业务 UI 代码。
