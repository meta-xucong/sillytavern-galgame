# AI Galgame RPG 状态栏精修开发文档

> 文档状态：落代码前审查稿 v1.0  
> 生效日期：2026-07-27  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 关联文档：`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`、`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`、`docs/AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md`  
> 后续单列 HUD 重构：`docs/AI_GALGAME_SINGLE_COLUMN_RPG_HUD_REDESIGN_SPEC.md`  
> 可见装备解析增强：`docs/AI_GALGAME_VISIBLE_EQUIPMENT_EXTRACTION_SPEC.md`

## 1. 目标

本阶段只优化玩家端 `/game/` 的 RPG/D&D 状态栏展示形式，让原版 SillyTavern 可见聊天文本中出现的状态、背包、技能和线索信息更像成熟 D&D 游戏的角色面板。

必须解决的体验问题：

- 背包把容器、物品和武器属性混成普通行，例如 `Explorer's pack`、`Backpack`、`轻型` 被独立显示。
- 背包超过 8 项后只显示 `另有 N 项`，玩家看不到完整信息。
- 长状态被塞进一个 chip，文字溢出或被截断。
- 技能英文未翻译，技能名、数值和状态混在一起，不易阅读。
- 当前状态栏只有“短 chip 列表”，缺少分类摘要、详情弹层和可滚动完整内容。
- 2026-07-28 追加：状态区不能只作为详情入口。RPG/D&D 剧本中明确出现的 HP、AC、等级、经验、金币、异常状态等关键参数，应优先直接显示在舞台 HUD；较长的背包、技能、判定和记录再进入详情抽屉。
- 2026-07-28 追加：原版可见文本若用 `Weapons/shield`、`Equipment`、`Attacks`、`装备`、`武器`、`攻击` 等格式列出装备，前端应能把这些可见行保守整理进武器详情；属性未出现在可见文本中时不得从隐藏资源或规则常识补全。

## 2. Native-First 边界

本功能是 presentation layer，不是玩法系统。

允许：

- 只从原版 SillyTavern 可见聊天文本、已读回的原版聊天消息和管理员发布的展示 profile 中提取展示信息。
- 把原版可见文本整理为摘要 chip、分类列表、详情抽屉、颜色和图标。
- 把原版可见文本中明确给出的 HP、AC、等级、经验、金币、状态摘要整理为只读 HUD。
- 对常见英文 D&D 名词做前端展示翻译，例如 `Stealth` 显示为 `潜行`。
- 将明显属于上一件物品的属性行挂回该物品展示，例如 `轻型`、`投掷 20/60`、`品质低劣`。
- 识别失败时保留原文，放入“未分类记录”。

禁止：

- 不读取、复制或展示角色卡正文、世界书正文、prompt、context、模型参数或密钥。
- 不计算 HP、伤害、负重、熟练加值、装备效果、关系值、任务分支或结局条件。
- 不把背包、状态、技能写成前端剧情权威或保存为平行游戏状态。
- 不根据猜测新增物品、状态、技能、队友或剧情事实。
- 不把按钮做成前端分支；如未来有按钮，只能作为普通玩家输入提交回原版 ST。
- 不修改 `src/**`、`server.js`、`plugins.js`、原版 `public/index.html/script.js/style.css`、`config.yaml`、根依赖或启动脚本。

## 3. 展示信息模型

### 3.1 输入来源

输入仍使用现有 `galgame.adaptive-presentation.v1` 展示提取链路：

- `frontend/shared/src/adaptive-presentation.js`
- `frontend/player/src/main.js`
- `frontend/player/src/styles.css`

本阶段不新增 AI 输出协议，不要求模型输出 JSON。所有整理都基于可见文本。

### 3.2 输出结构

在现有 extraction result 的 `values` 中增加可选的展示辅助字段。它们只影响 UI 显示，不改变协议权威。

```ts
interface DisplayPanelItemV1 {
  label: string;
  value?: string;
  raw: string;
  category?: string;
  kind?: string;
  tags?: string[];
  traits?: string[];
  emphasis?: boolean;
}

interface DisplayPanelGroupV1 {
  id: string;
  title: string;
  tone: "danger" | "warning" | "safe" | "magic" | "gold" | "neutral" | "ally" | "item" | "skill";
  items: DisplayPanelItemV1[];
}
```

字段规则：

- `raw` 必须保留原版可见文本来源。
- `category/kind/tags/traits` 只能来自保守解析或词典映射。
- 不允许出现 `node`、`choiceId`、`ending`、`variables`、`inventoryState`、`relationshipState` 等剧情权威字段。

## 4. 背包展示设计

### 4.1 状态栏摘要

背包卡片不再列出全部物品行，也不显示 `另有 N 项`。

默认摘要格式：

```text
背包
武器 1
关键物 2
补给 6
杂物 12
```

如果空间不足，摘要最多显示 4 个分类 chip；分类本身可点击打开完整详情。不得用 `另有 N 项` 作为唯一替代信息。

### 4.2 详情抽屉

点击背包卡片后打开详情抽屉或移动端半屏弹层：

```text
背包

武器
生锈短刀
伤害：1d4 穿刺
属性：轻型、投掷 20/60
品质：低劣

关键物品
铜制乌鸦徽记
说明：黑喙收账标记

材料
黑羽毛

容器
探险者背包

未分类记录
原文中无法可靠归类的条目
```

详情抽屉要求：

- 桌面端右侧抽屉，最大宽度约 420px，可滚动。
- 移动端底部半屏或全屏抽屉，支持触控滚动和安全区。
- 支持关闭按钮、`Esc` 关闭、焦点回到触发卡片。
- 不使用技术词，不显示原始 JSON。

### 4.3 保守解析规则

容器识别：

- `Explorer's pack`、`Backpack`、`Pack`、`Pouch`、`袋`、`包`、`背包` 归入 `容器`。
- 容器不作为高优先级物品刷屏。

武器与属性绑定：

- 包含伤害骰或武器关键词的行作为武器主项：`1d4`、`1d6`、`piercing`、`slashing`、`穿刺`、`挥砍`、`短刀`、`弯刀`、`bow`、`sword`。
- 紧随其后的短属性行挂到上一件武器：`轻型`、`投掷 20/60`、`finesse`、`light`、`thrown`、`two-handed`、`品质低劣`。
- 如果属性行前面没有可绑定物品，则进入 `未分类记录`，不得凭空创建装备。

关键物品：

- 含有徽记、钥匙、信件、铃、护符、地图、契约、证物、标记、crest、key、letter、map、token 等关键词时归入 `关键物品`。

补给：

- 火把、口粮、水袋、绳索、药水、工具、torch、rations、rope、potion、kit 等归入 `补给`。

材料/杂物：

- 羽毛、碎片、骨、布料、herb、feather、shard 等归入 `材料`。
- 不能归类但看起来是物品的放入 `杂物`。

## 5. 状态展示设计

### 5.1 状态栏摘要

状态不再合并为一个长句 chip。改为分组 chip：

```text
生命：重伤但可行动
队伍：Pippa、尼布
悬赏：黑喙帮 75 gold
线索：银铃、寒鸦弯刀
事件：夜行商队接近
```

颜色：

- `danger`：重伤、中毒、诅咒、濒死、被追捕。
- `ally`：队友、同行、加入队伍。
- `gold`：金币、悬赏、报酬、债务。
- `magic`：鉴定、魔法物品、诅咒物、未知效果。
- `neutral`：环境、时间、远处事件。

### 5.2 详情抽屉

点击状态卡片后打开“当前局势”：

```text
身体状态
重伤但可行动

队伍
Pippa 已加入队伍
尼布暂时同行

威胁
被黑喙帮悬赏 75 gold

已知线索
莫里克的银铃：部分效果已鉴定
寒鸦弯刀：部分效果已鉴定

环境变化
远处有夜行商队接近
```

规则：

- 用中文分号、英文分号、顿号、句号拆分长状态。
- 每条状态保留原文，不改写事实。
- 摘要最多显示关键 5 条；详情必须完整显示全部条目。
- 对无法分类的状态放入“其他记录”。

## 6. 技能展示设计

### 6.1 状态栏摘要

技能摘要只显示最重要或最近出现的 3-5 项：

```text
技能
潜行 +4
察觉 +3
游说 +2
```

### 6.2 详情抽屉

技能详情按用途分组：

```text
探索
潜行 +4
察觉 +3
调查 +1

社交
游说 +2
欺瞒 +1
威吓 +2

战斗
短刃熟练
轻甲熟练

魔法
银铃共鸣：未知
```

### 6.3 翻译词典

内置展示词典只做名称翻译，不改变规则：

| 英文 | 中文 | 分组 |
| --- | --- | --- |
| Acrobatics | 体操 | 探索 |
| Animal Handling | 驯兽 | 探索 |
| Arcana | 奥秘 | 魔法 |
| Athletics | 运动 | 探索 |
| Deception | 欺瞒 | 社交 |
| History | 历史 | 知识 |
| Insight | 洞悉 | 社交 |
| Intimidation | 威吓 | 社交 |
| Investigation | 调查 | 知识 |
| Medicine | 医药 | 知识 |
| Nature | 自然 | 知识 |
| Perception | 察觉 | 探索 |
| Performance | 表演 | 社交 |
| Persuasion | 游说 | 社交 |
| Religion | 宗教 | 知识 |
| Sleight of Hand | 巧手 | 探索 |
| Stealth | 潜行 | 探索 |
| Survival | 求生 | 探索 |

解析要求：

- 支持 `Stealth +4`、`Stealth: +4`、`潜行 +4`、`短刃熟练`。
- 技能名、数值、标签分开显示，颜色不同。
- 未知英文专有名词保留原文，并归入 `特殊`。
- 不根据角色职业推断缺失技能。

## 7. UI 组件规格

### 7.0 关键参数 HUD

当原版可见聊天文本提供 RPG 参数时，顶部状态区优先渲染较宽的“角色状态”HUD：

```text
角色状态
HP 12/12    AC 15    等级 1
经验 0      金币 75  状态 重伤但可行动
```

规则：

- 只展示原版可见文本明确给出的字段；缺失字段不猜测、不补默认值。
- HP/MP/经验可显示比例条，但比例只来自同一条可见文本中的 `current/max`。
- 状态长句在 HUD 中只显示安全截断摘要；完整文本进入详情抽屉。
- HUD 最多露出 6 个关键参数。背包、技能、判定等信息作为副卡显示摘要，详情抽屉展示完整内容。
- 桌面端状态 HUD 可占用两张普通卡宽度；移动端状态 HUD 独占一行。
- 这些字段不得保存为前端规则状态、用于计算伤害、触发剧情或判断失败/胜利。

### 7.1 面板卡片

现有 `.adaptive-panel` 改为可点击摘要卡片：

- 标题区：模块名 + 分类数量。
- 摘要区：最多 4-5 个 chip。
- 右上角：详情图标或 `查看`。
- 不再在摘要区显示 `另有 N 项`。

### 7.2 详情抽屉 DOM

新增玩家端 DOM：

```html
<aside id="adaptiveDetailDrawer" class="adaptive-detail-drawer" hidden>
  <div class="adaptive-detail-backdrop"></div>
  <section class="adaptive-detail-panel" role="dialog" aria-modal="true">
    <header class="adaptive-detail-header">
      <h2 id="adaptiveDetailTitle"></h2>
      <button type="button" id="adaptiveDetailClose" aria-label="关闭"></button>
    </header>
    <div id="adaptiveDetailBody" class="adaptive-detail-body"></div>
  </section>
</aside>
```

如果为降低改动量，也可用 JS 动态创建该节点，但必须保持同等可访问性。

### 7.3 视觉语言

- 背包：暖金/棕金，但避免整块咖啡色。
- 状态：按 danger/ally/gold/magic/neutral 分类上色。
- 技能：蓝绿系和金色数值，技能名与加值分离。
- 每个分类使用 1px 细边线和 6-8px 圆角，不使用大面积卡片嵌套卡片。

## 8. 实现计划

### 8.1 文件范围

允许修改：

- `frontend/shared/src/adaptive-presentation.js`
- `frontend/shared/tests/adaptive-presentation.test.mjs`
- `frontend/shared/tests/fixtures/adaptive-presentation/*.txt`
- `frontend/player/src/main.js`
- `frontend/player/src/styles.css`
- `frontend/player/src/index.html`（如选择静态 DOM 抽屉）
- `frontend/tools/static-dom-smoke.mjs`
- `frontend/tools/browser-smoke-narrow.mjs` 或新增窄 smoke
- `public/game/**`（从源码重建）
- `public/game-admin/**`（仅当共享源码变化导致构建一致性需要时，从源码重建共享产物；不得新增管理端业务功能）
- `.codex-longrun/**` 证据和状态

禁止修改：

- `src/**`
- `server.js`
- `plugins.js`
- 原版 `public/index.html`
- 原版 `public/script.js`
- 原版 `public/style.css`
- `config.yaml`
- 根依赖和启动脚本

### 8.2 批次

Batch SP0：文档准入

- 新增本文档。
- 审查 native-first 边界。
- 不改业务代码。

Batch SP1：共享提取增强

- 增强 inventory/status/abilities 的保守解析。
- 增加 `groups/items/tags/traits` 展示辅助字段。
- 保证未知字段和复杂文本不形成剧情状态。
- 增加 fixture 测试：背包属性归并、状态长句分组、技能翻译、未知保留。

Batch SP2：玩家 UI 展示

- 摘要卡片不再显示 `另有 N 项`。
- 增加详情抽屉和滚动完整展示。
- 桌面/移动端样式优化。
- 键盘、焦点、关闭、滚动可用。

Batch SP4：Product Design HUD 重构

- 将 `rpg-status` 从普通摘要卡升级为关键参数 HUD。
- 对 `rpg-status`、`dice`、`inventory`、`abilities` 等模块做优先级排序，舞台上最多展示 4 张高价值卡片，减少对白区上方拥挤。
- 副卡只展示分类摘要；完整物品、技能、状态和判定仍在详情抽屉中查看。
- 重做卡片层级、间距、颜色和桌面/移动响应式规则。

Batch SP3：验收与重建

- 从源码重建 `public/game`。
- 跑共享测试、静态 DOM、架构审计、冻结边界、浏览器 smoke。
- 真实或 fixture D&D 文本验证背包/状态/技能面板。

## 9. 测试与证据

必须运行：

```powershell
node frontend/shared/tests/adaptive-presentation.test.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs --evidence .codex-longrun/evidence/status-panel-polish-architecture.json
git diff --check -- frontend\player frontend\shared frontend\tools public\game docs .codex-longrun
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
```

建议新增或扩展 smoke：

```powershell
node frontend/tools/adaptive-presentation-fixture-smoke.mjs --fixture frontend/shared/tests/fixtures/adaptive-presentation/dungeon-master-rpg.txt --evidence .codex-longrun/evidence/status-panel-polish-fixture-smoke.json
```

验收标准：

- 背包详情中显示全部物品，不出现 `另有 N 项` 作为截断。
- `Explorer's pack`、`Backpack` 归入容器，不抢占摘要。
- `轻型`、`投掷 20/60`、`品质低劣` 挂回 `生锈短刀`。
- 长状态分组显示，摘要不溢出，详情完整。
- 常见 D&D 技能中文展示，技能名和数值视觉分离。
- 识别失败时原文仍可在详情中看到。
- 玩家端不出现模型、API、prompt、角色卡、世界书、预设、上下文等技术词。
- 不新增本地剧情、节点、选择、结局、背包规则引擎或 HP 计算。
- 冻结边界无内容 diff。

## 10. 审查门禁

落代码前，审查员需要确认：

- 本文档没有要求修改后台或原版 ST 文件。
- 本文档没有把背包/状态/技能变成前端玩法权威。
- 本文档没有允许从角色卡、世界书、prompt/context 或隐藏数据提取信息。
- 详情抽屉只是完整展示，不改变原版聊天和生成语义。
- 未桥接高级原版能力仍 no-button/no-claim。

审查通过后才能进入 SP1/SP2 代码实现。
