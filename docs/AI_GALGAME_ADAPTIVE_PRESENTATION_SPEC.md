# AI Galgame 自适应展示框架设计规范

> 文档状态：pre-code design gate v1.0  
> 生效日期：2026-07-26  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 关联文档：`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`、`docs/AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md`、`docs/AI_GALGAME_ULTIMATE_ADAPTIVE_COMPLETION_PLAN.md`、`docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`

## 1. 设计目标

本规范定义一个高适配性的自定义 `/game/` 前端展示框架。它要解决的问题是：

- 同一个前端既能玩纯视觉小说，也能玩 RPG、恋爱、推理、经营、沙盒角色扮演。
- 剧本没有结构化信息时，玩家仍可用最小对白模式完整游玩。
- 剧本输出 HP、背包、好感度、任务、线索、资源等信息时，前端能按需显示对应面板。
- 用户未来自行导入角色卡、世界书或聊天种子时，不要求开发者为每个剧本写死 UI。

核心原则：

**基础视觉小说壳始终存在，所有额外 UI 模块都按需出现。**

前端只能负责：

- 展示原版 SillyTavern 可见聊天内容。
- 从可见聊天文本中保守提取展示线索。
- 把行动按钮作为快捷输入提交回原版聊天。
- 保存 UI 恢复状态。

前端不得负责：

- 计算 HP、好感度、金币、经验、任务完成、物品增减。
- 决定剧情节点、分支、结局或路线。
- 自建世界事实、角色关系、背包、战斗或日程系统。
- 复制角色卡正文、世界书正文、prompt/context 正文。
- 用本地剧情或本地固定选择补偿原版运行失败。

## 2. 总体架构

自适应前端由四层组成：

| 层 | 名称 | 职责 | 权威性 |
| --- | --- | --- | --- |
| 1 | 基础视觉小说壳 | 标题、舞台、对白、逐字显示、自由输入、历史、存档 | UI 权威 |
| 2 | 展示提取层 | 从原版可见文本提取行动、状态、关系、任务、线索等可展示片段 | 非剧情权威 |
| 3 | 模块渲染层 | 按需显示 RPG、恋爱、推理、经营等模块 | 非剧情权威 |
| 4 | 管理员展示配置 | 声明推荐模板、模块偏好、解析规则、素材偏好 | 展示建议，不是剧情权威 |

运行顺序：

1. 玩家打开 `/game/`。
2. 前端读取当前 active release / arc / chat 绑定。
3. 前端通过原版聊天桥读取原版可见消息。
4. 基础对白壳先渲染原文或 display text。
5. 展示提取层对当前消息和最近若干消息做保守识别。
6. 模块渲染层根据展示 profile、识别结果和置信度，决定显示哪些 UI 模块。
7. 玩家点击行动按钮或自由输入，输入原样写回原版聊天并通过 approved bridge 调用原版 Generate。

任何提取失败都回退到基础对白壳，不阻塞游戏。

## 3. Versioned Contract

协议名称：`galgame.adaptive-presentation.v1`

该协议是展示协议，不是剧情响应协议。

```ts
interface AdaptivePresentationProfileV1 {
  schemaVersion: "galgame.adaptive-presentation.v1";
  profileId: string;
  template?: PresentationTemplateIdV1;
  preferredModules?: PresentationModuleIdV1[];
  disabledModules?: PresentationModuleIdV1[];
  extractionPolicy?: {
    confidenceThreshold?: number;
    maxRecentMessages?: number;
    allowAdminPatterns?: boolean;
    allowBuiltinPatterns?: boolean;
    lowConfidenceBehavior?: "plain-dialogue" | "history-only";
  };
  adminPatterns?: PresentationPatternV1[];
  visualPriority?: PresentationVisualPriorityV1;
}

type PresentationTemplateIdV1 =
  | "visual-novel"
  | "rpg-adventure"
  | "romance-social"
  | "mystery-investigation"
  | "management-sim"
  | "sandbox-roleplay";

type PresentationModuleIdV1 =
  | "actions"
  | "rpg-status"
  | "inventory"
  | "abilities"
  | "quests"
  | "relationships"
  | "affection"
  | "gifts"
  | "events"
  | "calendar"
  | "clues"
  | "suspects"
  | "locations"
  | "factions"
  | "resources"
  | "objectives"
  | "dice"
  | "notes";

interface PresentationPatternV1 {
  id: string;
  module: PresentationModuleIdV1;
  source: "visible-chat-text";
  patternKind: "regex" | "line-prefix" | "table-like" | "key-value-block";
  pattern: string;
  fields: string[];
  confidence?: number;
  locale?: "zh-CN" | "en" | "mixed";
}

interface PresentationVisualPriorityV1 {
  primaryPanel?: PresentationModuleIdV1;
  secondaryPanels?: PresentationModuleIdV1[];
  collapseBelowWidth?: number;
}
```

管理员可以在 manifest/release 中保存 `AdaptivePresentationProfileV1`，但它只能影响展示布局和提取策略。

禁止在 profile 中保存：

- 角色卡正文。
- 世界书正文。
- prompt、system、context、instruct 正文。
- 固定剧情文本。
- 固定选项。
- 节点跳转。
- 结局条件。
- HP/好感度/物品的真实数值状态。

## 4. 模板策略

模板不是玩法系统，只是默认布局和模块优先级。

### 4.1 `visual-novel`

默认模板，适合任何剧本。

默认模块：

- `actions`
- `notes`

界面：

- 舞台、角色名、对白框、逐字显示。
- 行动按钮若能识别则显示。
- 无额外信息时保持最简。

### 4.2 `rpg-adventure`

适合 D&D、地下城、JRPG、开放冒险。

默认模块：

- `rpg-status`
- `inventory`
- `abilities`
- `quests`
- `dice`
- `actions`

常见字段：

- HP、MP、SP、AC、防御、等级、经验。
- 装备、背包、金币。
- 技能、法术、状态。
- 当前任务、目标、地点。
- 掷骰、判定结果。

低置信度行为：

- 只显示原文，不生成状态面板。
- 不把“受伤”“关系紧张”等自然语言转成数字。

### 4.3 `romance-social`

适合恋爱、校园、社交、偶像、后宫、乙女。

默认模块：

- `relationships`
- `affection`
- `gifts`
- `calendar`
- `events`
- `actions`

常见字段：

- 好感度、亲密度、信任、嫉妒、心情。
- 礼物、纪念物、共同回忆。
- 日期、日程、地点、约会事件。
- 角色关系阶段。

关键边界：

- 前端不得自己加减好感。
- 如果输出只说“她似乎更信任你”，前端可以在历史里轻提示，但不得生成 `信任 +5`。
- 数字条只在原版可见文本明确给出数字时显示。

### 4.4 `mystery-investigation`

适合推理、悬疑、侦探、解谜。

默认模块：

- `clues`
- `locations`
- `suspects`
- `objectives`
- `notes`
- `actions`

常见字段：

- 线索、证据、嫌疑人。
- 地点、时间线。
- 当前推理、未解问题。

关键边界：

- 前端只把模型已说出的线索归档展示。
- 不自动判断真凶。
- 不自动合成推理结论。

### 4.5 `management-sim`

适合经营、城市、基地、王国、资源管理。

默认模块：

- `resources`
- `factions`
- `objectives`
- `calendar`
- `actions`

常见字段：

- 金钱、人口、粮食、能源、声望。
- 建筑、设施、队伍。
- 回合、日期、季节。

关键边界：

- 前端不计算收益。
- 前端不推进回合。
- 所有数值变化来自原版回复。

### 4.6 `sandbox-roleplay`

适合自由角色扮演、群像、生活模拟、长篇剧情。

默认模块：

- `locations`
- `relationships`
- `objectives`
- `notes`
- `actions`

特点：

- 展示松散，不强行结构化。
- 优先保留自由输入和历史回看。
- 只在信息稳定、格式清晰时浮现模块。

## 5. 模块定义

每个模块必须实现同一组行为：

| 行为 | 要求 |
| --- | --- |
| `detect` | 根据管理员 profile 的展示配置，从原版可见文本中识别候选信息 |
| `score` | 输出置信度与来源说明 |
| `render` | 只渲染展示，不写剧情状态 |
| `collapse` | 小屏或低优先级时收起 |
| `clear` | 当前消息不再出现该信息时，可隐藏或保留历史摘要 |

### 5.1 `actions`

来源：

- `可选行动：`
- `A. ...`
- `1. ...`
- `- ...`
- `你可以：...`
- 英文 `Options:`、`Choose:`、`Actions:`

规则：

- 至少 2 个可行动作才显示按钮。
- 每个动作必须是可自然提交的玩家输入。
- 点击按钮只提交按钮文字。
- 按钮不是剧情分支，不保存为“已选择”。

### 5.2 `rpg-status`

字段示例：

- `HP: 12/12`
- `MP: 8/10`
- `AC: 15`
- `Level: 3`
- `XP: 50/300`
- `Status: Injured`

显示：

- 生命/魔力条。
- 等级/经验。
- 状态标签。

禁止：

- 前端自行扣血。
- 前端自行判断死亡。
- 根据自然语言猜测数值。

### 5.3 `inventory`

字段示例：

- `Inventory: rope, torch, key`
- `背包：绳索、火把、铜钥匙`
- `Items: ...`

显示：

- 折叠列表。
- 最近变化高亮仅在原版输出明确显示时触发。

禁止：

- 前端移除或添加物品。
- 点击物品触发本地效果。

### 5.4 `abilities`

字段示例：

- `Abilities: Second Wind (available)`
- `技能：潜行、说服、急救`
- `Spells: Fire Bolt, Shield`

显示：

- 技能 chips。
- `available/used/cooldown` 只按原文展示。

禁止：

- 前端判断技能是否可用。
- 前端消耗技能次数。

### 5.5 `relationships` / `affection`

字段示例：

- `好感度：Anna 62/100`
- `信任：高`
- `Relationship: Anna - wary`
- `心情：紧张`

显示：

- 有数字时显示条。
- 无数字时显示标签。
- 多角色以列表或头像 chips 展示。

禁止：

- 自行生成角色列表。
- 根据语气自动打分。
- 自行加减好感。

### 5.6 `events`

字段示例：

- `事件：放学后的屋顶谈话`
- `Event: summer festival promise`
- `回忆：第一次一起回家`

显示：

- 事件或回忆列表。
- 事件来源消息索引。
- 明确日期存在时可与 `calendar` 联动展示。

禁止：

- 前端触发事件。
- 前端判定事件完成。
- 前端把事件当作路线节点。

### 5.7 `quests` / `objectives`

字段示例：

- `当前目标：找到失踪的孩子`
- `Quest: Recover the amulet`
- `Objective: Survive the ambush`

显示：

- 当前目标卡片。
- 已完成/失败仅在原文明确出现时展示。

禁止：

- 前端标记任务完成。
- 前端推进下一章。

### 5.8 `clues`

字段示例：

- `线索：窗台上的泥土`
- `Evidence: torn glove`

显示：

- 线索列表。
- 来源消息索引。

禁止：

- 前端合成推理。
- 前端判断真伪。

### 5.9 `suspects`

字段示例：

- `嫌疑人：园田，动机不明`
- `Suspect: Mr. Hale - no alibi`
- `相关人物：黑衣访客`

显示：

- 嫌疑人或相关人物列表。
- 明确写出的动机、时间线、证词标签。
- 来源消息索引。

禁止：

- 前端判断真凶。
- 前端自动改变嫌疑等级。
- 前端合成不存在的证据。

### 5.10 `resources`

字段示例：

- `Gold: 120`
- `粮食：32`
- `声望：中立`

显示：

- 小型资源条或数字列表。

禁止：

- 前端回合结算。
- 前端资源消耗。

## 6. 信息来源与优先级

展示配置来源和模块值证据必须分开处理。

配置来源按优先级从高到低：

1. 管理员发布的 `AdaptivePresentationProfileV1`。
2. 内置模板默认值。
3. 内置通用识别器默认策略。

模块值证据来源按优先级从高到低：

1. 当前原版聊天消息 `extra.display_text` 或可见 `mes`。
2. 最近 N 条原版可见消息的稳定重复模式。

管理员 profile 只能提供模板、启用/禁用模块、pattern、阈值和视觉优先级。它不能直接提供 HP、好感度、物品、任务、线索、资源等模块值。

不允许作为来源：

- 角色卡正文。
- 世界书正文。
- prompt/context 正文。
- 模型不可见思考。
- 原版内部未暴露状态。
- 前端 localStorage 中自行维护的剧情状态。

## 7. 置信度与回退

每个提取结果必须带：

```ts
interface PresentationExtractionResultV1 {
  schemaVersion: "galgame.presentation-extraction-result.v1";
  module: PresentationModuleIdV1;
  confidence: number;
  evidenceSource: {
    kind: "visible-chat-message";
    chatId?: string;
    messageIndex?: number;
  };
  configurationSource?: {
    kind: "admin-profile" | "builtin-template" | "builtin-pattern";
    profileId?: string;
    patternId?: string;
  };
  values: Record<string, unknown>;
  displayOnly: true;
}
```

建议阈值：

- `0.90+`：可显示主面板。
- `0.75-0.89`：可显示折叠/弱提示。
- `<0.75`：不显示模块，只保留原文。

低置信度策略：

- 不提示玩家“识别失败”。
- 不显示空面板。
- 不补默认数值。
- 不用旧值冒充当前值；如保留历史，必须视觉上标为“上次记录”。

## 8. 管理员配置体验

管理员端可以提供“展示模板”配置页：

| 配置项 | 作用 | 玩家可见 |
| --- | --- | --- |
| 推荐模板 | 决定默认模块优先级 | 不直接显示 |
| 启用模块 | 指定允许自动出现的模块 | 模块有数据时显示 |
| 禁用模块 | 强制隐藏某些模块 | 不显示 |
| 解析规则 | 针对剧本格式做展示提取 | 不直接显示 |
| 低置信度策略 | 决定不确定时回退方式 | 不直接显示 |

管理员端必须提示：

- 这些配置只影响展示。
- 真实剧情和状态仍来自原版 SillyTavern 聊天。
- 未有原版输出时，前端不会创造 HP、好感度、任务或线索。

## 9. 玩家体验原则

玩家侧永远保持简单：

- 默认看到对白和输入。
- 有明确行动建议时看到按钮。
- 有稳定状态信息时看到面板。
- 没有状态信息时面板消失。
- 模块变化不要打断阅读。

视觉策略：

- 主舞台始终优先。
- 模块默认折叠或半透明侧栏。
- 移动端模块进入抽屉，不挤压对白。
- 面板标题使用游戏化语言，如“状态”“背包”“关系”“线索”，不得显示“解析器”“模块”“profile”。

## 10. 与现有协议的关系

| 已有协议 | 关系 |
| --- | --- |
| `galgame.presentation-extraction.v1` | 本规范扩展模块化提取，但仍只读原版可见文本 |
| `galgame.player-save.v1` | 只保存模块折叠状态、最近显示位置，不保存模块数值权威 |
| `galgame.arc-release.v1` | 可保存 profile 引用；Arc 不是剧情节点 |
| `galgame.media-job.v1` | 媒体可参考当前展示模块摘要，但不能读取隐藏 prompt 或自建剧情状态 |
| `original-runtime-bridge.v1` | 仍只负责原版 Generate 委托，不接收模块状态作为剧情权威 |

## 11. 存档边界

允许保存：

- `enabledModuleIds`
- `collapsedModuleIds`
- `lastRenderedPanelId`
- `lastMessageIndex`
- `pageIndex`
- `visualState`
- `mediaJobIds`

禁止保存：

- HP/MP/XP/Gold 的权威数值。
- 好感度/关系的权威数值。
- 背包、技能、任务、线索的权威列表。
- 已完成选择。
- route/node/ending。
- 自定义剧情变量。

如需恢复模块显示，必须重新读取原版聊天并重新提取。

## 12. 验收标准

文档/代码实现必须证明：

- 无剧本结构时只显示基础对白模式。
- Dungeon Master 类 RPG 输出时按需显示状态、背包、技能、行动按钮。
- 恋爱类输出明确好感度时按需显示关系/好感模块。
- 推理类输出明确线索时按需显示线索模块。
- 低置信度文本不显示错误模块。
- 所有模块值都能追溯到原版可见聊天消息；管理员 profile 只能解释“为什么启用该模块/规则”，不能提供模块值。
- 模块点击不会触发本地剧情效果。
- 保存/读档不会保存模块数值权威。
- 静态架构审计无 narrative gateway、SceneResult、直接底层 generate、资源正文复制、平行剧情状态。

## 13. Deferred / No-Claim

以下能力未在本规范中声明可用：

- 让前端自动计算战斗。
- 让前端自动推进章节。
- 让前端自动判断结局。
- 让前端根据隐藏 prompt 生成媒体。
- 将模块状态提交给模型作为权威上下文。
- 原版 regenerate / undo / swipe / group / native Quick Reply 的完整桥接。

这些能力必须保持 no-button/no-claim，直到有单独桥接契约和验收证据。
