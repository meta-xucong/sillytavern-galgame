# AI Galgame 可见装备解析增强开发文档 v1.0

## 1. 背景

当前 `/game/` 已有单列 RPG HUD、背包详情抽屉和 D&D 风格展示，但用户实测发现：角色拥有多件武器时，只有一件武器显示了详细属性。

只读检索后的根因是两层：

- 当前原版 ST 可见回复里，明确写出详细属性的武器可能只有一件，例如 `Weapons/shield: Greatsword (2d6 slashing)`。
- 前端 `inventory` 提取主要收 `Inventory`、`Items`、`背包`、`物品`、`道具` 等段落，对原版可见文本中的 `Weapons/shield`、`Equipment`、`Attacks`、`装备`、`武器`、`攻击` 行支持不完整。

本阶段目标是修第二点：把已经出现在原版 ST 可见聊天文本里的装备/攻击信息，更完整、更准确地归入前端“武器/装备详情”展示。

## 2. Native-first 边界

本阶段只做 presentation layer，不改变玩法权威：

- 只从原版 SillyTavern 已读回的可见聊天文本提取展示信息。
- 不读取、复制或解析隐藏角色卡正文、世界书正文、prompt、context、preset 或原版内部运行态来补全装备。
- 不根据 D&D 规则、职业、武器名、世界书知识或前端常识推断伤害、射程、属性、稀有度或效果。
- 不新增前端 HP、装备、背包、技能、战斗、负重、条件、任务、分支或结局计算引擎。
- 不把提取出的装备信息写入 manifest、save、bridge 请求、ST 资源或任何剧情权威状态。
- 失败或格式无法识别时保留原文/显示“未明确”，不得本地编造属性。

允许做的事：

- 从可见文本中的标题、键值行、列表项保守拆分武器/装备/攻击信息。
- 将已出现的伤害骰、伤害类型、射程、轻型/双手/灵巧/投掷、品质等短属性绑定到相邻明确武器。
- 将容器、补给、关键物品、材料、未知记录继续分组显示。
- 在详情抽屉中完整展示所有条目，不使用 `另有 N 项` 替代完整内容。

## 3. 可见来源范围

WE1 允许新增以下可见标题/键名作为 inventory/equipment 展示来源：

- 英文：`Inventory`、`Items`、`Equipment`、`Weapons`、`Weapons/shield`、`Weapon`、`Attacks`、`Attack`
- 中文：`背包`、`物品`、`道具`、`装备`、`武器`、`攻击`

来源必须来自已经读回的聊天文本，且必须满足以下二选一条件：

1. 位于受认可装备标题下的列表项。标题包括 `Inventory`、`Items`、`Equipment`、`Weapons`、`Weapons/shield`、`Attacks`、`背包`、`物品`、`道具`、`装备`、`武器`、`攻击`。
2. 明确的装备键值行。键名本身必须是上述认可标签，例如 `Weapons/shield: ...`、`Equipment: ...`、`攻击：...`。

禁止在普通自然语言叙事段落中仅凭 `sword`、`bow`、`dagger`、`1d4`、`穿刺`、`挥砍` 等关键词创建装备。未处于认可装备区的武器词只保留为普通聊天原文，不进入 HUD 装备详情。

标题区遇到任何已知 section heading 时必须停止收集。例如 `Equipment:` 后遇到 `Status:`、`Skills:`、`状态`、`技能`、`Quest:` 等已知标题时，不得继续把后续行当装备。

示例：

```text
Weapons/shield: Greatsword (2d6 slashing)
Equipment:
- Longbow: 1d8 piercing damage (range 150/600)
- Dagger
Attacks:
- Rusty shortsword: 1d4 piercing
  light
  thrown 20/60
Inventory: Explorer's pack, Backpack, 50 gold pieces
```

允许输出：

- `Greatsword` 归入武器，属性 `2d6 slashing`。
- `Longbow` 归入武器，属性 `1d8 piercing damage`、`range 150/600`。
- `Dagger` 归入武器，但属性缺失时只显示“属性未明确”或保留原文。
- `Rusty shortsword` 归入武器，后续短属性行绑定为 trait。
- `Explorer's pack`、`Backpack` 归入容器，不作为武器。

禁止输出：

- 看到 `Dagger` 就从规则常识补 `1d4 piercing`。
- 从世界书武器列表里查 Longbow、Dagger 的属性并填入详情。
- 将 `Attacks` 变成前端战斗系统或可点击伤害结算。
- 从“他拔出一把 dagger，雨水顺着刀锋滴落”这样的叙事句里创建 `Dagger` 装备。

## 4. 解析规则

### 4.1 行内键值

以下格式可以作为装备来源：

```text
Weapons/shield: Greatsword (2d6 slashing)
Equipment: Longbow with 20 arrows; Greatsword; Explorer's pack
攻击：寒鸦弯刀：1d6 挥砍，灵巧
```

处理要求：

- 键名只决定展示来源，不代表玩法系统。
- 值可按 `;`、`；`、`、`、`,` 拆分，但括号内部不得被错误拆碎。
- `Name: value` 形式中，前半可作为装备名，后半作为属性。
- `with 20 arrows`、`20 arrows` 可归入物品/补给或武器 trait，但不得生成弹药规则。

### 4.2 标题列表

以下标题下的短列表可作为装备来源：

```text
Equipment:
Greatsword
Scale mail armor (14 AC)
Explorer's pack

Attacks:
Greatsword: 2d6 slashing damage
Longbow: 1d8 piercing damage (range 150/600)
```

处理要求：

- `Equipment` 下若只有名字，没有伤害/属性，则只能显示名称和“属性未明确”。
- `Attacks` 下明确给出的伤害/射程可作为武器 trait。
- 同名武器在 `Equipment` 和 `Attacks` 同时出现时，允许在同一次可见文本内合并展示，保留两个 raw 来源。
- 合并只限同一次可见读回文本，不跨聊天历史推断。

### 4.2.1 raw 来源合并契约

现有展示模型已有 `raw` 字段。WE1 可以采用以下两种方案之一，但必须在测试里固定：

- 保守方案：`raw` 仍为字符串，把同名合并来源用 `\n` 拼接，例如 `Greatsword\nGreatsword: 2d6 slashing damage`。UI 继续读取 `item.raw`，无需新增 schema 字段。
- 扩展方案：新增 display-only `rawSources: string[]`，同时保留 `raw` 字符串摘要。若采用该方案，必须同步更新 schema/测试/UI 渲染和 static architecture 允许范围。

默认推荐保守方案，避免为本次展示增强扩大协议面。无论哪种方案，都不得把 raw 来源写入 save、manifest、bridge 请求或 ST 资源。

### 4.3 属性绑定

短属性行可以绑定到上一件武器：

- 中文：`轻型`、`重型`、`双手`、`双持`、`灵巧`、`投掷 20/60`、`射程 150/600`、`品质低劣`
- 英文：`light`、`heavy`、`two-handed`、`finesse`、`thrown 20/60`、`range 150/600`、`poor quality`
- 伤害：`1d4 piercing`、`2d6 slashing`、`1d8 穿刺`

如果属性行前面没有明确武器，进入 `未分类记录`，不得凭空创建武器。

### 4.4 未知与缺失

- 不能可靠分类的条目进入 `杂物` 或 `未分类记录`。
- 缺失伤害/射程/效果时，详情显示“属性未明确”或原文，不补默认值。
- 未知格式必须保留原文，便于后续新增 fixture。

### 4.5 护甲与非武器装备

当前 inventory 分组契约只有：

- `weapons`
- `keyItems`
- `supplies`
- `materials`
- `containers`
- `miscellaneous`
- `uncategorized`

WE1 若遇到 `Scale mail armor (14 AC)`、`Shield`、`Traveler's Clothes` 等非武器装备，允许两种处理：

- 最小方案：归入 `miscellaneous`，在 label/traits/raw 中保留原文。
- display-only 扩展方案：新增 `equipment` 或 `armor` 分组，仅用于展示，不计算 AC/防御/负重。若新增分组，必须同步更新测试和 UI 分组渲染。

本阶段禁止从 `Scale mail armor (14 AC)` 计算或覆盖角色 `AC` 字段；AC 仍只能来自原版可见文本中明确的 `AC:`/`护甲:` 状态字段。

## 5. UI 要求

- 首页状态带仍保持单列，不因多武器导致高度失控。
- 武器摘要优先显示数量和 1-2 个最明确的名字，例如 `武器 3`、`Greatsword · Longbow`。
- 点击详情后完整显示所有武器、护甲、容器、关键物品、补给、材料和未知记录。
- 武器详情行建议结构：

```text
武器
Greatsword
2d6 slashing

Longbow
1d8 piercing damage · range 150/600

Dagger
属性未明确
```

- 不使用 `另有 N 项` 隐藏完整列表。
- 详情抽屉继续支持滚动、Esc 关闭、焦点回归、移动端安全区。

## 6. 开发批次

### WE0 文档准入

允许修改：

- `docs/AI_GALGAME_VISIBLE_EQUIPMENT_EXTRACTION_SPEC.md`
- `docs/AI_GALGAME_RPG_STATUS_PANEL_POLISH_SPEC.md`
- `docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`
- `.codex-longrun/**`

禁止修改业务代码，直到审查员 PASS。

### WE1 共享解析增强

允许修改：

- `frontend/shared/src/adaptive-presentation.js`
- `frontend/shared/tests/adaptive-presentation.test.mjs`
- `frontend/shared/tests/fixtures/adaptive-presentation/dnd-visible-equipment-attacks.txt`
- `frontend/tools/adaptive-presentation-fixture-smoke.mjs`，仅在需要更精确 evidence 输出时修改
- `public/game/**`，仅从源码重建
- `public/game-admin/**`，仅当 shared 产物一致性要求必须同步时重建并单独记录
- `.codex-longrun/evidence/**`

禁止修改：

- `src/**`
- `server.js`
- `plugins.js`
- `config.yaml`
- 原版 `public/index.html`、`public/script.js`、`public/style.css`
- `external-modules/**`
- root `package.json`、`package-lock.json`
- 启动脚本

### WE2 玩家展示验收

- 用 fixture 验证多武器、属性绑定、装备/攻击合并、未知原文保留。
- 用静态 DOM 和真实浏览器检查详情抽屉仍完整可读。
- 不要求真实模型输出固定三把武器；真实剧本输出不可控，fixture 负责覆盖格式能力。

## 7. 验收命令

WE1/WE2 必须至少运行：

```powershell
node --check frontend\shared\src\adaptive-presentation.js
node frontend\shared\tests\adaptive-presentation.test.mjs
node frontend\tools\adaptive-presentation-fixture-smoke.mjs --fixture frontend\shared\tests\fixtures\adaptive-presentation\dnd-visible-equipment-attacks.txt --expect inventory
$env:GALGAME_BUILD_TARGET='player'; node frontend\build-static.mjs
node frontend\tools\static-dom-smoke.mjs
node frontend\tools\static-architecture-audit.mjs --evidence .codex-longrun\evidence\visible-equipment-architecture.json
node frontend\tools\static-architecture-audit.mjs --evidence .codex-longrun\evidence\visible-equipment-source-public.json
git diff --check -- frontend\shared frontend\player public\game docs .codex-longrun
git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json Start.bat UpdateAndStart.bat UpdateForkAndStart.bat
python "$env:USERPROFILE\.codex\skills\long-running-task\scripts\validate_state.py" --project .
```

通过标准：

- `frontend/shared/tests/adaptive-presentation.test.mjs` 必须新增或更新明确断言，不能只依赖 fixture smoke 的 `moduleIds`。
- `dnd-visible-equipment-attacks.txt` 至少识别 3 件独立武器。
- 至少 2 件武器带有来自可见文本的 trait。
- `Equipment` 与 `Attacks` 同名项在同一次消息中合并，且两个 raw 来源通过 `raw` 换行拼接或 `rawSources` 保留。
- `Explorer's pack`、`Backpack` 归入容器而不是武器。
- `light/轻型`、`thrown/投掷` 等短属性在有上一件武器时绑定到该武器；无上一件武器时进入 `uncategorized` 或保留原文，不独立成为武器。
- 缺失属性的武器保留并标记为未明确或保留原文，不补默认值。
- 普通叙事句里的武器词或伤害骰不会创建 inventory 模块或装备项。
- 架构审计 `prohibitedActive=0`、`needsReview=0`、`failedChecks=[]`。
- source/public 一致，无 `source-public-mismatch`。
- 受保护路径 diff 为空。

WE2 证据必须明确记录：

- 共享源码变更后已重建 `public/game`。
- 如果同步了 `public/game-admin/shared/**`，必须在 test-log 中说明原因是 shared build output consistency，而不是管理端业务 UI 修改。
- static architecture/source-public evidence 非空，并且不能只写“inventory 模块存在”；必须引用单测断言结果或 fixture 输出摘要。

## 8. 审查口径

审查员应重点检查：

- 是否仍只从可见聊天文本提取。
- 是否没有读取世界书/角色卡正文来补武器属性。
- 是否没有引入前端装备状态、战斗规则或本地剧情逻辑。
- 是否保留未知原文，且缺失属性不猜测。
- 是否从源码重建 public/game 并验证 source/public 一致。
