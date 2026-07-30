# AI 剧情游戏前端交互与 UI 落地规范

> 文档状态：前端落地设计 v1.0  
> 生效日期：2026-07-25  
> 配套文档：`docs/AI_GALGAME_NATIVE_ST_CUSTOM_FRONTEND_DEVELOPMENT_PLAN.md`  
> 落代码前材料：`docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md`  
> 代码开发清单：`docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`  
> 自适应展示材料：`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`  
> 上位边界：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`

## 1. 设计定位

本项目的前端不是传统 GalGame 的简单复刻，也不是 SillyTavern 原版 UI 的换皮。

前端应设计成一个“AI 剧情游戏控制台”：

- 玩家看到的是游戏：标题、舞台、人物、对白、行动、历史、存档、媒体。
- 底层运行的是 SillyTavern：角色卡、世界书、预设、聊天历史、生成、上下文。
- 交互既有 GalGame 的低门槛，也保留 AI 玩法的自由输入。
- 玩家可以一路点击建议行动，也可以随时输入自己的台词或行动。

若剧本输出 RPG 状态、恋爱关系、推理线索、经营资源等结构化可见文本，前端可依据 `galgame.adaptive-presentation.v1` 按需显示对应面板。面板只负责展示和阅读辅助，不计算数值、不决定剧情、不保存剧情权威；无法可靠识别时回退到基础对白模式。

最终体验应接近：

> 一款能自由行动的 AI 视觉小说，而不是一套需要学习的 AI 聊天工具。

## 2. 当前前端问题

当前 `/game/` 已经跑通基本链路，但还只是 MVP 壳：

- 标题页较简单，缺少作品信息、内容提示、继续状态。
- 游戏主界面只有背景、单立绘、对话框、选项按钮和输入框。
- 历史、保存、读取、设置还没有真正的游戏化页面。
- 重生成、撤回、继续等待、回复超时等原版聊天能力尚未完整映射。
- 长文本没有分页和阅读节奏控制。
- 多角色说话人、立绘、表情和站位没有系统化。
- Lucifer 这类多幕剧本还缺 Arc/章节表达。
- 媒体生成接口没有玩家可见的占位、完成、查看和恢复体验。

因此下一版前端应从“能跑”升级成“可完整体验”。

## 3. 总体信息架构

玩家端只保留 5 个主要界面：

| 界面 | 作用 | 是否常驻 |
| --- | --- | --- |
| 标题页 | 开始、继续、读取、设置、内容提示 | 进入游戏前 |
| 游戏舞台 | 阅读、行动、输入、等待回复 | 核心常驻 |
| 历史抽屉 | 回看原版聊天消息 | 临时打开 |
| 存读取抽屉 | 保存当前 chatId 与显示状态，读取历史存档 | 临时打开 |
| 设置抽屉 | 字体、速度、音量、动效 | 临时打开 |

管理员端的下一轮默认形态以 `docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` 为准：小白模式只保留“工作台、上架故事、作品库、演出增强、高级检查”五个可理解区块。下表 7 个界面能力仍保留，但应收纳进小白区块或高级检查，不再作为默认工程页签直接暴露。

管理员端底层能力包括：

| 界面 | 作用 |
| --- | --- |
| 当前发布 | 当前玩家入口、版本、状态、回滚 |
| 剧本入口 | 作品、标题、内容等级、默认展示资源 |
| 分幕配置 | Arc/章节与资源组合 |
| 原版资源 | 角色、世界书、预设、聊天种子引用校验 |
| 运行检查 | 原版连接、桥接、目标聊天、生成链路 |
| 媒体接口 | 生图/视频服务状态、测试任务 |
| 系统状态 | 配置服务、桥接服务、最近错误 |

## 4. 玩家端视觉方向

### 4.1 推荐风格

推荐使用“现代日式视觉小说 + 轻量 RPG 指令层”的混合风格。

关键词：

- 清爽
- 沉浸
- 少控件
- 文本优先
- 操作弱化
- 夜色、玻璃、纸张、胶片感
- 有舞台感，但不做复杂 3D

不建议：

- 大量卡片堆叠
- 仪表盘式布局
- 复杂工具栏
- 明显聊天软件气质
- 原版 SillyTavern 的多面板操作感

### 4.2 颜色与质感

默认主题建议：

| 角色 | 颜色 |
| --- | --- |
| 背景暗部 | `#101218` |
| 文本面板 | 半透明黑 `rgba(10, 12, 18, 0.78)` |
| 主文字 | `#f4efe8` |
| 次级文字 | `#b9b1a7` |
| 强调色 | 暖金 `#d7aa5f` |
| 危险/失败 | 柔红 `#c76868` |
| 可操作按钮 | 低饱和蓝灰 `#48576b` |

避免整页变成单一紫色、单一深蓝或单一米色。每个剧本可配置主题色，但按钮层和文本层必须保持可读。

### 4.3 字体与排版

中文优先：

- 正文：系统无衬线或思源黑体一类清晰字体
- 标题：允许使用更有风格的衬线或日系标题字体
- 正文行高：1.75 到 1.9
- 对话框每行宽度控制在 28 到 42 个中文字符的舒适范围
- 移动端避免小于 15px 的正文

不要用视口宽度直接缩放字号。不同屏幕通过布局改变，而不是文字乱缩放。

## 5. 玩家端页面设计

### 5.0 展示提取协议

前端可以从原版 SillyTavern 聊天文本中做保守展示提取，但该能力必须是版本化的 presentation extraction contract，不得演变成自定义 AI 故事响应协议。

协议名称：`galgame.presentation-extraction.v1`

输入：

```ts
interface PresentationExtractionInputV1 {
  protocolVersion: "galgame.presentation-extraction.v1";
  source: "sillytavern-visible-chat-message";
  messageId: string;
  role: "character" | "player";
  speaker: string;
  text: string;
}
```

输出：

```ts
interface PresentationExtractionResultV1 {
  protocolVersion: "galgame.presentation-extraction.v1";
  sourceMessageId: string;
  displayText: string;
  suggestedActions: Array<{
    label: string;
    value: string;
    source: "visible-text";
  }>;
  speakerHints: Array<{
    name: string;
    confidence: "explicit" | "weak";
    source: "visible-text";
  }>;
  extractionWarnings: string[];
}
```

硬边界：

- 只能读取当前原版聊天消息的可见文本。
- 不读取角色卡正文、世界书正文、提示词正文或隐藏上下文。
- 不要求模型输出 JSON、YAML、XML 或任何自定义故事协议。
- `suggestedActions` 只能作为快捷输入，点击后等价于玩家手动输入同一文字。
- `speakerHints` 只能影响姓名栏、立绘和显示，不影响剧情。
- 无法可靠识别时，返回原文、空行动列表、空说话人提示，并保留自由输入。
- 提取失败不得阻断剧情推进，不得补造选项、台词、分支或结局。

允许识别的行动格式：

- `可选行动：`、`行动建议：`、`下一步：` 后接 2 到 4 条编号或项目符号。
- 文本末尾连续 2 到 4 条明显编号行动。

允许识别的说话人格式：

- `Anna：...`
- `Anna: ...`
- `—Anna ...`
- `*—Anna ...*`

禁止识别：

- 根据关键词猜测隐藏剧情状态。
- 根据角色关系推断未出现的说话人。
- 根据世界书条目推导行动按钮。
- 把前端提取结果写回 prompt 或作为剧情控制数据。

### 5.1 标题页

目标：打开就知道当前作品是什么，可以直接开始。

布局：

```text
┌────────────────────────────────────┐
│                                    │
│       全屏标题背景 / 关键视觉        │
│                                    │
│  作品名                             │
│  一句短副标题                       │
│                                    │
│  [开始游戏]                         │
│  [继续游戏]                         │
│  [读取]  [设置]                     │
│                                    │
│  内容提示 / 版本号                  │
└────────────────────────────────────┘
```

交互规则：

- `开始游戏`：读取当前入口绑定的原版 `chatSeedId`。
- `继续游戏`：读取最近有效存档或最新原版聊天。
- `读取`：打开存档抽屉。
- `设置`：打开设置抽屉。
- 如果当前剧本内容等级为 mature，应展示简短内容提示。
- 不展示剧本选择、不展示管理员入口。

当前文件改造：

- `frontend/player/src/index.html`：标题页增加内容提示、设置按钮。
- `frontend/player/src/styles.css`：重做标题页视觉层级。
- `frontend/player/src/main.js`：补齐继续状态检测和读取抽屉打开逻辑。

### 5.2 游戏舞台

目标：主界面只服务剧情，不像聊天工具。

推荐桌面布局：

```text
┌──────────────────────────────────────────────┐
│ 顶部轻 HUD：作品名 / Arc / 历史 保存 读取 设置 │
├──────────────────────────────────────────────┤
│                                              │
│       背景图 / CG / 视频层                    │
│                                              │
│   左角色        中角色        右角色           │
│                                              │
├──────────────────────────────────────────────┤
│  说话人                                          │
│  对白文本，支持分页和点击推进                    │
│                                                  │
│  [行动建议 1] [行动建议 2] [行动建议 3]           │
│  输入你的行动或台词...                    [发送] │
└──────────────────────────────────────────────┘
```

推荐移动端布局：

```text
┌────────────────────┐
│ 小 HUD              │
├────────────────────┤
│ 背景/人物/CG         │
│                    │
├────────────────────┤
│ 说话人              │
│ 对白文本            │
│                    │
│ 行动建议纵向按钮     │
│ 输入框 + 发送        │
└────────────────────┘
```

舞台层级：

1. 背景层
2. CG/视频层
3. 角色立绘层
4. 特效层
5. HUD 层
6. 对话层
7. 抽屉/弹窗层

当前文件改造：

- `index.html`：拆分 `stage-backdrop`、`media-layer`、`character-layer`、`hud-bar`、`dialogue-box`。
- `styles.css`：用 CSS grid/flex 建立桌面和移动端响应式布局。
- `main.js`：将 `renderChatSnapshot` 拆成 `renderStageMessage`、`renderActions`、`renderHud`。

### 5.3 对话框

对话框是核心，不要像普通聊天气泡。

组件：

- 说话人名牌
- 正文区域
- 分页提示
- 状态文字
- 行动按钮区
- 输入区

规则：

- AI 回复过长时自动分页。
- 每页约 220 到 360 个中文字符。
- 点击正文区域显示下一页。
- 到最后一页才显示行动按钮和输入框。
- 如果没有行动按钮，仍显示自由输入。
- 说话人为玩家时显示“你”，角色回复显示原版消息里的说话人。
- 原版输出中的 `可选行动：` 标题只有在符合 `galgame.presentation-extraction.v1` 时才从正文里隐藏并转成按钮；不符合时保留原文显示。

状态：

| 状态 | 对话框表现 |
| --- | --- |
| 读取中 | 显示“正在准备故事。” |
| 可输入 | 输入框启用，行动按钮启用 |
| 已提交 | 显示玩家输入，输入禁用 |
| 思考中 | 显示“思考中...”，按钮和输入禁用 |
| 回复完成 | 显示角色回复，输入启用 |
| 等待恢复 | 显示“这一段暂时没接上”，提供重试 |

### 5.4 行动建议

行动按钮是低学习成本的关键。

视觉：

- 桌面端横向 2 到 4 个按钮。
- 移动端纵向按钮。
- 按钮文案来自原版输出，不改写含义。
- 按钮不能太花，避免抢戏。

交互：

- 点击按钮后，按钮文字直接提交为玩家输入。
- 点击后立即进入“思考中”。
- 禁止重复点击。
- 如果桥接失败，保留已提交动作并提供“再试一次”。

合法来源：

- 当前已实现：原版回复文本中的清晰行动列表。
- 后续可扩展：SillyTavern Quick Reply 扩展桥接。

禁止：

- 前端自己补造按钮。
- 前端根据按钮决定分支。
- 按钮保存为前端路线状态。
- 按钮、`suggestedActions` 或提取结果参与 prompt、世界书、Arc 切换或结局判定。

### 5.5 自由输入

自由输入是 AI 版体验的灵魂，必须保留。

设计：

- 输入框默认一行。
- 输入较长时扩展到最多 4 行。
- 占位文案：“输入你的行动或台词”。
- 发送按钮使用图标或短文字。
- 支持 Enter 发送，Shift+Enter 换行。
- 移动端点击输入时，对话框高度自适应键盘。

输入限制：

- 空文本不可发送。
- 发送中不可重复提交。
- 本地只做长度和安全处理，不改写玩家含义。

### 5.6 历史抽屉

目标：回看剧情，不做原版聊天编辑器。

布局：

```text
右侧抽屉 / 移动端全屏

历史
────────────────
The Underworld & The Heavens
雨已经连续下了三天...

你
让 Black 先开口...

Anna
...
```

功能：

- 按时间顺序显示当前原版聊天的可见消息。
- 支持滚动。
- 支持跳回最新。
- 可复制单条文本。
- 不提供角色卡、世界书、prompt 信息。

后续可选：

- 从历史中创建媒体生成参考。
- 标记某条为 CG 候选。

### 5.7 保存与读取

目标：给玩家传统游戏安全感，但不接管剧情权威。

存档卡片显示：

- 缩略图或背景
- 作品名
- Arc/章节名
- 最近一句文本摘要
- 保存时间
- 当前 chatId 简短别名，不给普通玩家看技术 id

存档数据：

```ts
interface PlayerSaveSlot {
  saveId: string;
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
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

注意：

- `chatId` 指向原版聊天。
- `lastMessageIndex` 和 `pageIndex` 只用于恢复玩家看到哪条消息、哪一页文本，不代表剧情节点。
- `visualState` 只保存背景、立绘、BGM、媒体缓存等显示恢复信息，不代表世界事实。
- `mediaJobIds` 只用于恢复已请求或已缓存的媒体任务，不决定剧情是否发生。
- 前端不保存剧情变量、关系、物品、路线、结局、节点或 AI 场景结果。
- 读取时必须重新读取原版聊天文件。
- 如果原版聊天缺失，显示恢复提示，不播放本地剧情。

首期建议：

- 1 个自动存档。
- 6 个手动存档。
- 读取界面先可用，再追求漂亮缩略图。

### 5.8 重生成与撤回

这是完整体验的重要能力，应从原版聊天语义桥接。

在落代码前，必须先为每个操作定义 bridge contract。没有正式等价原版入口或未完成目标聊天读回验收的能力，必须标为 `deferred/unbridged`，不能在玩家 UI 中假装可用。

建议 UI：

- 工具栏图标：重生成上一段
- 工具栏图标：撤回我的上一句
- 二次确认只在会丢失内容时出现

重试当前回复 contract：

- 状态：`implemented-partial`，仅限最后一条仍为玩家消息、原版运行时桥接可用的情况。
- 输入：`releaseId`、`scenarioId`、`chatId`、目标角色头像、最后一条玩家消息摘要哈希。
- 锁定：生成前读回目标聊天，确认最后一条仍是同一玩家消息。
- 执行：调用原版运行时桥接继续同一目标聊天。
- 验收：同一目标聊天新增角色回复，非目标聊天不变。
- 失败：保留玩家输入和当前舞台，显示再试一次。
- 幂等：同一请求不可并发执行；重复点击返回同一 pending 状态或被 UI 禁用。

重生成上一段 contract：

- 状态：`deferred/unbridged`，待确认可等价桥接原版 regenerate/swipe 语义。
- 不允许仅在前端删除文本后自行请求生成。
- 不允许直接调用底层模型生成接口。
- 若临时使用“删除最后角色回复后再委托原版 Generate()”方案，必须先由审查确认其与原版语义等价或明确标为降级能力。

候选回复切换 swipe contract：

- 状态：`deferred/unbridged`。
- 只有找到原版 swipe 数据结构、当前候选索引、保存接口和读回验收方式后才可实现。
- 未桥接前，UI 不显示候选切换按钮。

撤回上一回合 contract：

- 状态：`deferred/unbridged`。
- 需要确认原版撤回/删除消息语义、保存接口、并发锁和读回验收。
- 验收必须确认目标聊天已移除对应玩家回合及其后续角色回复，且非目标聊天不变。

读取指定 chat contract：

- 状态：`ready-for-design`。
- 输入：目标 `releaseId`、`scenarioVersion`、角色头像、`chatId`。
- 验收：通过原版聊天读取接口读回该聊天，并确认角色引用与入口绑定一致。
- 失败：显示存档不可用，不播放本地缓存剧情。

重生成参考流程，只有 contract 转为 `bridged` 后才允许实现：

1. 确认当前最后一条是角色回复。
2. 委托桥接层按原版语义删除或重生成最后角色回复。
3. 调用原版 `Generate()`。
4. 读回同一目标聊天。
5. 更新舞台。

撤回流程：

1. 找到最近一条玩家消息。
2. 同步移除该玩家消息之后的角色回复。
3. 保存回原版聊天。
4. 回到可输入状态。

禁止：

- 前端自己改写剧情。
- 只改 UI 不改原版聊天。
- 把失败重生成伪装成成功。
- 在没有 contract 验收前提前开放按钮。

### 5.9 回复候选切换

如果能桥接 SillyTavern 原版 swipe 语义，可以做成“上一条/下一条候选回复”。当前状态为 `deferred/unbridged`。

UI：

- 对话框右下角小型左右按钮。
- 显示 `1/3` 这类候选位置。

首期可以不做。优先级低于重生成和撤回。

## 6. 多角色与演出设计

### 6.1 角色视觉映射

管理员为每个作品配置：

```ts
interface CharacterPresentation {
  originalName: string;
  displayName: string;
  aliases: string[];
  defaultPosition: "left" | "center" | "right";
  sprites: {
    neutral: string;
    tense?: string;
    sad?: string;
    angry?: string;
    soft?: string;
  };
}
```

规则：

- `originalName` 对应原版聊天里的说话人或角色名。
- `aliases` 用于识别 `—Anna`、`Anna:` 等输出格式。
- 识别成功则切换姓名栏和立绘。
- 识别失败按旁白显示。
- 不修改原文含义。

### 6.2 WorldDirector 模式

Lucifer 当前最适合使用 WorldDirector 模式。

表现规则：

- WorldDirector 的大段叙述显示为旁白或导演。
- 明确出现 `—Anna`、`—Black` 等格式时，可以把说话人显示为对应角色。
- 若单条回复中含多角色对白，首期不拆分原文，只在姓名栏显示 WorldDirector。
- 后续可做安全拆分，但必须保留原文顺序和内容。

### 6.3 背景切换

背景切换来源：

- 管理员配置的默认背景。
- 原版回复中的地点关键词。
- 未来媒体标记或扩展事件。

首期建议：

- 每个作品配置 3 到 8 张背景。
- 关键词匹配只做视觉提示，不参与剧情逻辑。
- 识别不到时保持当前背景。

Lucifer 建议背景：

- 顶层公寓
- 电梯间
- 雨夜洛杉矶
- 街口
- 昏暗卧室
- 天台或高层窗前

### 6.4 CG 与媒体层

媒体层状态：

| 状态 | 表现 |
| --- | --- |
| 无媒体 | 使用背景和立绘 |
| 请求中 | 不打断文本，可显示微弱加载提示 |
| 完成 | 在句末或翻页时淡入 |
| 失败 | 静默保留旧背景，历史里可记录 |
| 查看 | 点击 CG 进入全屏查看 |

媒体不能阻断普通剧情推进。

## 7. 管理员端具体设计

### 7.1 当前发布页

显示：

- 当前作品名
- 当前版本
- 当前 Arc
- 当前主角色/群组
- 当前世界书组合
- 最近发布时间
- 验证状态
- 发布、回滚按钮

推荐布局：

```text
当前发布
────────────────────────
Lucifer：第一幕测试入口
版本 0.1.0
状态：资源完整 / 桥接在线 / 最近生成通过

[预览玩家入口] [发布新版本] [回滚]

最近发布记录
...
```

### 7.2 剧本入口页

表单字段：

- 作品标题
- 短副标题
- 内容等级
- 默认语言
- 默认标题图
- 默认背景
- 默认角色视觉
- 媒体策略

不要在这里编辑角色卡正文或世界书正文。

### 7.3 分幕配置页

为 Lucifer 这类剧本设计：

```text
分幕配置
────────────────
Arc 1  The Descent & The Meeting   [引用存在] [待发布验证]
Arc 2  ...                         [引用存在] [待发布验证]
Arc 3  ...                         [引用存在] [待发布验证]
Arc 4  ...                         [引用存在] [待发布验证]
Group Mode                         [未桥接]   [不显示给玩家]
```

每个 Arc 配置：

- Arc 标题
- 主角色或群组
- worldbook bundle
- preset
- opening chat seed
- 默认背景
- 内容提示
- 是否可发布

### 7.4 原版资源页

必须分成两个层级：

1. 引用存在性：资源在原版 SillyTavern 中是否存在。
2. 运行时应用状态：当前桥接生成前是否能把资源应用到原版运行时。

表格：

| 类型 | 引用 | 存在 | 运行时已应用 | 备注 |
| --- | --- | --- | --- | --- |
| 角色 | The Underworld & The Heavens | 是 | 已验证目标绑定 | 主角色 |
| 世界书 | Galgame_Imported_Lucifer_Arc1_Bundle | 是 | 待验证 | Arc1 |
| 预设 | Galgame_Imported_Lucifer_Preset | 是 | 待桥接 | 当前已知缺口 |
| 聊天种子 | galgame-imported-lucifer-seed；galgame-imported-lucifer-arc2-seed；galgame-imported-lucifer-arc3-seed；galgame-imported-lucifer-arc4-seed | 是 | 已验证目标读回 / 管理员发布回滚；玩家多幕 live smoke 需逐幕补证 | Arc1-Arc4 开场 |

运行配置证据分级：

| 类型 | 引用存在证据 | 运行时已应用证据 | 未满足时处理 |
| --- | --- | --- | --- |
| generation preset | `/api/settings/get` 名称存在 | 原版运行时当前 preset 名称可读且匹配，或原版提供等价确认接口 | 标为 `unbridged`，不得宣称已应用 |
| instruct preset | `/api/settings/get` 名称存在 | 原版运行时当前 instruct preset 可读且匹配 | 标为 `unbridged` |
| system prompt | `/api/settings/get` 名称存在 | 原版运行时当前 system prompt 引用可读且匹配 | 标为 `unbridged` |
| context preset | `/api/settings/get` 名称存在 | 原版运行时当前 context preset 可读且匹配 | 标为 `unbridged` |
| worldbook | `/api/worldinfo/list` 名称存在 | 原版运行时当前角色/聊天的世界书激活绑定可读且匹配 | 阻止发布或标为未应用 |
| group | 原版群组列表存在对应引用 | 原版运行时当前会话进入目标群组并读回目标聊天 | 标为 `deferred/unbridged` |

允许接口：

- 原版已有只读列表接口用于“引用存在”。
- 已批准的原版运行时桥接可以在隔离浏览器里读取原版当前运行时状态。
- 不允许为了确认已应用而复制原版配置正文到自定义前端。
- 不允许通过底层模型接口 payload 推断已应用。

当前已知状态：

- 角色、世界书、preset、chat seed 的“引用存在”已可校验。
- 角色和目标聊天的“运行时已绑定”已可由原版运行时桥接验证。
- preset/instruct/system/context/worldbook 的“运行时已应用”需要新增正式桥接证据，未完成前不得作为通过项。

### 7.5 运行检查页

检查项：

- SillyTavern 服务在线
- 原版运行时桥接在线
- 当前角色存在
- 当前聊天种子存在
- 目标聊天读写可用
- 原版 Generate 通过目标聊天桥接可调用
- 回复写入目标聊天
- 非目标聊天未被误写
- 输出语言符合入口设置
- 行动按钮可从原版可见文本保守提取

测试结果必须分级：

- 静态通过
- 只读资源诊断通过
- 真实浏览器打开通过
- 真实原版生成通过
- 多轮推进通过

### 7.6 Arc 发布与存档兼容

Arc 是管理员发布层的资源组合，不是玩家前端剧情节点。

`ArcBindingV1` 是 `galgame.arc-release.v1` 的正式 versioned schema。它与 `StoryEntryManifest`、`ActiveRelease` 的关系必须在落代码前固定，不能在实现时临时扩展成剧情节点或路线系统。

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

关系与兼容：

- `StoryEntryManifest` 持有 `arcs: ArcBindingV1[]`、`defaultArcId` 和展示配置；旧单入口 manifest 只可迁移为一个默认 Arc。
- `ActiveRelease` 指向不可变 `releaseId`、`manifestId`、`manifestVersion` 和 `activeArcId`；开始新局读取当前 release，继续旧存档读取旧 release。
- `sillyTavernBindings.target` 是单角色、多角色和 group 的统一表达；旧 `characterRef: string` 只能作为迁移输入，不能继续作为正式字段。
- `arcId`、`arcBindingId` 在同一个 manifest 内必须唯一；`arcBindingId` 发布后不可变。
- 发布后不可变字段包括 `schemaVersion`、`arcBindingId`、`scenarioId`、`scenarioVersion`、`arcId`、`arcVersion`、`sillyTavernBindings`、`presentationProfileId` 和 `mediaPolicyId`。
- 修改不可变字段必须生成新的 `arcVersion` 和新的 release；回滚只恢复旧 release 指针，不改写原版聊天。

发布规则：

- 发布必须原子化：所有资源、聊天种子和配置引用校验通过后，才替换当前 active release。
- 回滚只切回旧 release/manifest，不改写原版聊天历史。
- 已开始的存档继续绑定创建时的 `releaseId`、`scenarioId`、`scenarioVersion`、`arcId` 和 `chatId`。
- 玩家继续旧存档时，读取旧 release 对应的 manifest；如果旧 manifest 不可用，显示恢复提示。
- 管理员可以发布新 Arc，但不得悄悄改变玩家已有 chatId 的世界书解释。
- 版本迁移只允许迁移 UI 展示字段；不得迁移或重写剧情事实。
- Arc1-Arc4 的资源导入、bundle 生成或界面展示不等于发布已验证；必须有管理员发布/回滚脚本证据后，才能把对应 Arc 标为可发布。

职责边界：

- 管理员决定发布哪个 Arc 和资源组合。
- 玩家只看到作品内章节/记录语义，不看到世界书、preset 或绑定面板。
- 前端不根据剧情文本自动切 Arc；如需自动推荐切换，必须先有原版聊天或管理员标记作为依据，并经单独审查。

### 7.7 媒体协议

媒体是演出增强，不是剧情权威。

协议名称：`galgame.media-job.v1`

媒体触发允许来源：

- 原版可见聊天文本中的保守展示标记。
- 管理员为某个 release/chat/message 配置的媒体标记。
- 已批准的 SillyTavern 原版扩展事件桥接。
- 玩家手动查看或管理员测试。

禁止来源：

- 前端自建剧情状态。
- 隐式 prompt 推导。
- 世界书正文复制。
- 未经审查的模型结构化输出协议。

正式 schema：

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

运行规则：

- 同一 `idempotencyKey` 在同一 `releaseId/chatId/messageIndex/mediaKind/sourceProof hash/styleId` 作用域内必须返回同一任务或同一结果。
- 默认非阻塞；失败不阻断文本剧情。
- 超时后停止前台等待，但保留任务 id 供恢复。
- 可重试错误最多自动重试一次。
- 输出进入媒体缓存，读档时优先复用。
- 密钥只存在于媒体网关或后续生图软件，不进入玩家端或 manifest。
- `sceneSummary` 最大 600 个 Unicode 字符，只能来自原版可见聊天文本摘要、管理员标记摘要、已批准扩展事件摘要或管理员测试输入。
- `sceneSummary` 和 `characterVisualRefs` 都是不可信输入；网关必须做 HTML、URL、路径和命令注入防护。
- `characterVisualRefs` 最多 12 个，只能引用管理员发布的视觉映射 id 或原版角色引用摘要，不得携带角色卡正文。
- 返回媒体 URL 只允许同源相对路径、受控媒体网关 URL 或短期签名 `https` URL；禁止 `file:`、`data:`、`javascript:`。
- 缓存读取必须校验 MIME、文件大小、路径归属和可选 `sha256`，禁止路径穿越。
- 取消、失败、过期只影响媒体显示，不影响原版聊天和剧情推进。
- 不支持的主版本必须拒绝；同一主版本中的未知可选字段可以忽略并记录。

### 7.8 安全与部署

外接模块必须可独立启动、停止、健康检查和替换。

`original-runtime-bridge`：

- 独立进程运行，不修改 SillyTavern 后端。
- 默认只监听 loopback：`127.0.0.1`、`::1` 或本机等价通道。
- 如需非本机访问，必须先有明确认证；CORS 不是认证，只是浏览器来源限制。
- `allowed-origin` 必须只允许当前玩家页和管理员页来源。
- 请求可以携带 `releaseId`、`scenarioId`、`scenarioVersion`、`arcId`、`chatId` 作为索引，但普通客户端 JSON 不能作为授权。
- 请求必须携带由 config-service 或运维工具在浏览器外签发的短期 `galgame.original-runtime-bridge-proof.v1`；proof 必须覆盖 audience、expiry、nonce、release、Arc、目标角色/group 和允许 chat 列表。
- 桥接服务只能接受 signed proof 中允许的当前已发布入口或旧存档 release 角色/chat/group 绑定；不能因为收到任意 `avatar + chatId`、自造 allowlist JSON、过期 proof、伪造 proof 或重放 proof 就生成任意原版聊天。
- 授权失败、release 不匹配、chat 不属于该 release、角色/group 与 Arc 绑定不一致时，必须拒绝并返回可恢复错误。
- 每个持久实例使用明确的浏览器 profile 目录。
- 临时测试实例使用独立 profile，避免并发污染。
- 同一目标聊天同一时间只允许一个生成任务。
- 生成前后必须读回目标聊天，确认非目标聊天不变。
- 日志不得记录 API key、完整 prompt、角色卡正文或世界书正文。
- 健康检查至少返回桥接进程、浏览器、原版页面连接状态。
- 停止桥接时如有生成任务，必须记录 `stopping`，请求原版停止，等待安全完成或超时强制失败；强制路径必须返回 `forced` / `stopMode` / `pendingTaskFailed` 诊断，在途生成请求只能失败，不能返回伪成功；重启后不能残留 pending 锁，也不能重复提交玩家输入。
- 证据日志只保留 requestId、releaseId、arcId、chatId hash、target binding hash、proof 判定、状态和安全判定；不得记录 proof 签名、签名密钥或 Bearer token。

`game-config-service`：

- 只保存 release、manifest、资源引用和展示配置。
- 管理员接口需要独立鉴权或反向代理保护。
- 玩家只读接口允许公开读取当前发布，但不得包含密钥。
- 发布写入必须原子化，并保留回滚记录。

`media-gateway`：

- 只处理媒体任务、缓存和 provider 适配。
- CORS 来源白名单必须明确。
- provider 密钥只在网关环境变量或安全配置中。
- 任务日志默认脱敏，禁止记录完整对话。

手动运维条件：

- SillyTavern 主服务端口。
- original-runtime-bridge 端口和 profile 路径。
- config-service 地址和管理员凭据。
- media-gateway 地址和 provider 健康。
- 任何一项不可用时，玩家端应显示恢复状态，管理员端显示明确缺口。

### 7.9 验收矩阵

| 类别 | 命令或脚本名 | 输入 fixture | 输出证据 | 通过标准 |
| --- | --- | --- | --- |
| 文档结构 | `rg -n "galgame\\.arc-release\\.v1|galgame\\.media-job\\.v1|original-runtime-bridge" docs` | 当前 docs | `.codex-longrun/evidence/docs-structure.txt` | 必要协议和边界章节存在 |
| docs-only 边界 | `powershell -File .codex-longrun/tools/docs-only-audit.ps1` 或等价命令 | 本阶段允许路径清单 | `.codex-longrun/evidence/docs-only-audit.json` | 只允许 `docs/**`、`.codex-longrun/evidence/**`、`.codex-longrun/state.json`、`.codex-longrun/progress.md` 和 `.codex-longrun/test-log.md` 变更；代码目录无本阶段新改动 |
| 冻结边界 | `git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json` | 冻结路径清单 | `.codex-longrun/evidence/frozen-boundary.txt` | 输出为空 |
| 状态文件 | `python "%USERPROFILE%\\.codex\\skills\\long-running-task\\scripts\\validate_state.py" --project .` | `.codex-longrun/state.json` | `.codex-longrun/evidence/state-validation.txt` | JSON 有效且 phase_status 符合阶段 |
| 代码静态架构审计 | `node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json` | 源码、构建产物、冻结路径、允许/禁止调用清单 | `.codex-longrun/evidence/code-architecture-audit.json` | 调用链、状态流转、路由隔离、构建一致性和冻结边界均符合 native-first；命中必须带上下文分类 |
| 协议契约 | `node frontend/shared/tests/protocol-contracts.test.mjs` | `frontend/shared/tests/fixtures/protocol/*.json` | `.codex-longrun/evidence/protocol-contracts.json` | presentation/save/Arc/media 契约不产生剧情权威 |
| 资源诊断 | `node frontend/tools/sillytavern-live-check.mjs --strict-bindings --strict --evidence .codex-longrun/evidence/st-resources.json` | 当前 active release | `.codex-longrun/evidence/st-resources.json` | 引用存在和缺失项准确；runtimeApplied 不足时标 deferred/unbridged |
| 目标聊天读回 | `node external-modules/original-runtime-bridge/tests/target-chat-readback.mjs --fixture fixtures/bridge/target-chat.json` | 目标角色/chat fixture | `.codex-longrun/evidence/target-chat-readback.json` | 同一目标聊天新增角色回复；返回 chatId 与读回一致 |
| 非目标聊天 | `node external-modules/original-runtime-bridge/tests/non-target-unchanged.mjs --fixture fixtures/bridge/two-chats.json` | 目标与非目标 chat fixture | `.codex-longrun/evidence/non-target-unchanged.json` | 非目标聊天 hash 不变 |
| 单轮推进 | `node frontend/tools/browser-smoke-narrow.mjs --player-only true --runtime-reply-smoke true --evidence .codex-longrun/evidence/browser-one-turn.json` | 已发布 test release | `.codex-longrun/evidence/browser-one-turn.json` | 开始、输入、思考、目标回复、无本地兜底 |
| 多轮推进 | `node frontend/tools/browser-five-turn-smoke.mjs --fixture fixtures/browser/lucifer-arc1-five-turn.json --evidence .codex-longrun/evidence/browser-five-turn.json` | 5 轮输入 fixture | `.codex-longrun/evidence/browser-five-turn.json` | 5 轮都写入同一目标聊天；不丢输入、不串会话 |
| 并发串会话 | `node external-modules/original-runtime-bridge/tests/concurrency-lock.mjs --fixture fixtures/bridge/concurrent-two-chats.json` | 两个 chatId 并发 fixture | `.codex-longrun/evidence/concurrency-lock.json` | 同 chat 拒绝/复用 pending；不同 chat 排队或隔离且不串 |
| 空回复/超时/停止 | `node external-modules/original-runtime-bridge/tests/failure-recovery.mjs --fixture fixtures/bridge/failure-cases.json` | empty/timeout/stop fixtures | `.codex-longrun/evidence/failure-recovery.json` | 保留舞台和输入；返回 retryable；不写本地剧情 |
| 媒体协议与缓存 | `node frontend/shared/tests/media-job-contract.test.mjs --fixture fixtures/media/media-job-v1.json` | media request/status/cache fixtures | `.codex-longrun/evidence/media-job-contract.json` | 幂等、取消、过期、URL 安全、缓存键通过 |
| 桌面/移动端 | `node frontend/tools/browser-layout-smoke.mjs --viewports desktop,mobile --evidence .codex-longrun/evidence/layout.json` | 已发布 test release | `.codex-longrun/evidence/layout.json` | 无遮挡、无横滚、按钮可点 |
| 管理员发布/回滚 | `node frontend/tools/admin-release-rollback-smoke.mjs --fixture fixtures/admin/arc-release-v1.json --evidence .codex-longrun/evidence/admin-release-rollback.json` | 完整/缺失 Arc fixture | `.codex-longrun/evidence/admin-release-rollback.json` | 完整引用可发布；缺失引用阻止；回滚不改原版聊天 |

未桥接能力必须执行 no-button/no-claim：

- 重生成、撤回、swipe、group、Quick Reply 扩展桥接未通过材料审查前，玩家 UI 不显示对应按钮，也不在验收报告中宣称支持。
- preset/worldbook/context/system/instruct 的 `runtimeApplied` 未有证据前，管理员 UI 只能显示“引用存在，运行时应用未桥接”。
- Arc1-Arc4 未有管理员发布/回滚证据前，只能称“资源已导入/待发布验证”，不能称“完整发布可用”。
- `static-architecture-audit.mjs` 尚不存在时，该项必须标为 `deferred/unimplemented-audit-entry`；文档风险词扫描不能替代源码调用链、状态流转、路由隔离和构建一致性审计。

## 8. 具体文件级开发任务

### 8.1 玩家端

`frontend/player/src/index.html`

- 增加 HUD 工具栏。
- 增加历史抽屉容器。
- 增加存读取抽屉容器。
- 增加设置抽屉容器。
- 增加媒体展示层。
- 增加确认弹窗容器。

`frontend/player/src/styles.css`

- 重做整体布局为舞台式 UI。
- 增加桌面和移动端断点。
- 增加抽屉、按钮、输入框、状态、分页样式。
- 增加角色层和媒体层样式。
- 检查所有按钮文字在移动端不溢出。

`frontend/player/src/main.js`

建议拆分为模块：

```text
frontend/player/src/
  main.js
  app-state.js
  render-stage.js
  render-actions.js
  render-history.js
  render-save-load.js
  render-settings.js
  text-pagination.js
  player-commands.js
  visual-mapper.js
```

首批必须实现：

- 文本分页
- 历史抽屉
- 存档/读取
- 重试状态
- 行动按钮点击提交
- 输入框多行

第二批实现：

- 重生成，仅在 `galgame.original-chat-ops.v1` 对应 contract 审查通过后实现
- 撤回，仅在 `galgame.original-chat-ops.v1` 对应 contract 审查通过后实现
- 多角色视觉映射
- 媒体占位与查看

### 8.2 共享层

`frontend/shared/src/sillytavern-adapter.js`

拟新增或扩展；只有对应 bridge contract 通过材料审查后才能落代码：

- `regenerateLastReply`
- `undoLastPlayerTurn`
- `listBoundChats`
- `loadChatById`
- `saveChatSnapshot`
- `extractSpeakerHints`

约束：

- 所有方法仍然读写原版聊天。
- 不读取角色卡正文和世界书正文。
- 不调用底层模型生成接口。
- `extractSpeakerHints` 必须实现 `galgame.presentation-extraction.v1`，只从可见聊天文本保守提取展示线索。

`frontend/shared/src/protocol.js`

新增展示协议：

```ts
interface PresentationProfile {
  themeId: string;
  characters: CharacterPresentation[];
  backgrounds: BackgroundPresentation[];
  mediaPolicy: MediaPolicy;
}
```

该协议只影响显示，不影响剧情逻辑。

### 8.3 管理员端

`frontend/admin/src/index.html`

- 增加分幕配置页。
- 增加运行时应用状态列。
- 增加 Lucifer 样板入口视图。

`frontend/admin/src/main.js`

建议拆分：

```text
frontend/admin/src/
  main.js
  release-page.js
  entry-editor.js
  arc-config-page.js
  original-resource-page.js
  runtime-check-page.js
  media-page.js
```

首批必须实现：

- Arc1-Arc4 配置列表，仅展示资源引用、发布诊断状态和 no-claim 边界。
- 发布当前 Arc，前提是 `galgame.arc-release.v1` 发布/回滚验收脚本通过。
- 校验每个 Arc 的资源引用。
- 显示 preset “引用存在”和“运行时应用未桥接/已验证”两个层级。

## 9. 实施顺序

### 第 1 批：玩家端完整基础体验

优先级最高。

任务：

- 重做游戏舞台布局。
- 加历史抽屉。
- 加保存/读取抽屉。
- 加文本分页。
- 优化行动按钮和自由输入。
- 统一思考中、失败、重试状态。

验收：

- Lucifer Arc1 在目标聊天桥接证据下可用按钮或自由输入连续推进 5 轮；证据文件必须包含每轮目标 chatId 读回。
- 移动端无文本遮挡。
- 失败时不播放本地剧情。

### 第 2 批：原版聊天操作桥接

任务：

- 重生成上一段，仅当对应 bridge contract 从 `deferred/unbridged` 转为已审查桥接能力后才落代码。
- 撤回上一回合，仅当对应 bridge contract 从 `deferred/unbridged` 转为已审查桥接能力后才落代码。
- 读取指定 chatId。
- 自动存档当前 chatId。

验收：

- 每个操作都能读回原版聊天确认。
- 操作失败时恢复到安全状态。
- 未桥接的重生成、撤回、swipe、group 和 Quick Reply 扩展能力必须 no-button/no-claim。

### 第 3 批：管理员分幕能力

任务：

- Arc1-Arc4 管理。
- 每个 Arc 独立资源绑定和开场种子。
- 发布当前 Arc。
- 缺失资源阻止发布。

验收：

- 只有 `admin-release-rollback-smoke` 产生发布/回滚证据后，才能宣称能从管理员端切换 Lucifer Arc。
- 玩家刷新后进入当前发布 Arc。
- 旧存档继续绑定旧发布版本。

### 第 4 批：运行配置应用

任务：

- 自动套用 preset，当前为 `deferred/unbridged`。
- 自动套用 context/system/instruct，当前为 `deferred/unbridged`。
- 确认世界书启用状态，当前为 `deferred/unbridged`。
- 显示应用状态。

验收：

- 管理员能看到“引用存在”和“运行时应用未桥接/已验证”的分级状态。
- 只有 `runtimeApplied` 证据存在时，才能宣称玩家生成前运行配置稳定。

### 第 5 批：视觉与媒体

任务：

- 多角色立绘映射。
- 背景关键词切换。
- CG 生图接口占位。
- 媒体查看器。

验收：

- 媒体失败不影响剧情。
- 角色识别失败不阻塞文本。

## 10. Lucifer 样板体验目标

Lucifer 应作为第一套高级体验样板。

玩家第一幕目标体验：

1. 打开标题页，看到 Lucifer 标题和成熟内容提示。
2. 点击开始，进入雨夜顶层公寓开场。
3. 看到 Anna、Black、Andrei 等角色以游戏方式出现。
4. 可以点击行动按钮推进。
5. 可以自由输入行动或台词。
6. 每次提交后出现思考中。
7. 回复能推进事件，例如 Jack 到达、Anna 状态变化、Black 行动升级。
8. 可以回看历史。
9. 可以保存和读取。
10. 出错时可以重试，不丢当前输入。

管理员完整目标：

1. 能看到 Lucifer Arc1-Arc4。
2. 能验证每个 Arc 的世界书和聊天种子。
3. 能在发布/回滚脚本通过后发布 Arc1-Arc4。
4. 能在缺 seed / 缺资源 fixture 中阻止发布。
5. 能检查 Lucifer preset 是否存在；是否已应用必须等待 `runtimeApplied` 桥接证据。
6. 能测试一次真实原版运行时生成。

## 11. 验收清单

玩家端验收：

- `/game/` 不显示 SillyTavern 术语。
- 开始、继续、读取都留在自定义 UI。
- 行动按钮来自原版输出。
- 自由输入写入原版聊天。
- 思考中状态清晰。
- 回复来自目标原版聊天读回。
- 历史显示当前原版聊天。
- 存档保存 chatId 和显示状态。
- 读取缺失聊天时只显示恢复状态。
- 移动端布局不遮挡。

管理员端验收：

- 可以发布入口。
- 缺失角色阻止发布。
- 缺失世界书阻止发布。
- 缺失 preset 阻止发布或标为未应用。
- 缺失 chat seed 阻止发布。
- Arc 配置不复制世界书正文。
- 发布后玩家刷新进入正确入口。

边界验收：

- 不修改 `src/**`。
- 不修改 `server.js`。
- 不修改 `plugins.js`。
- 不修改原版 `public/index.html`、`public/script.js`、`public/style.css`。
- 不恢复 narrative gateway。
- 不恢复 `SceneResult`。
- 不直调底层模型生成接口。
- 不在前端保存角色卡或世界书正文。

## 12. 最终判断

最好的下一版前端不应该追求“像传统 GalGame 一样固定路线”，而应该追求：

**让玩家用最简单、最游戏化的方式，完整使用 SillyTavern 的 AI 剧情能力。**

具体表现为：

- 想轻松玩的人，一路点行动按钮。
- 想自由发挥的人，随时输入行动和台词。
- 想回看和管理进度的人，用历史、保存、读取。
- 想体验高级剧本的人，由管理员把角色卡、世界书、预设和 Arc 配好。
- 想要视觉演出的人，通过立绘、背景、CG 和视频增强。

这条路线可以最大化利用原版 SillyTavern，同时把研发精力集中在前端审美、交互体验和媒体表现上。
