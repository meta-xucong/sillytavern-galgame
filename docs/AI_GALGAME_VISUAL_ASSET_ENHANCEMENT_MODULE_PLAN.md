# 视觉资产增强模块独立开发文档

> 文档状态：独立视觉增强模块完整开发目标 v1.2；VS-DOCS-1..5 已闭环
> 生效日期：2026-07-30  
> 当前目标：只完成视觉资产增强模块，不推进完整 Galgame 系统其他路线
> 当前阶段：VS-CODE-1 代码准入准备；尚未授权恢复历史视觉原型代码
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 详细协议附录：`docs/AI_GALGAME_VISUAL_SYSTEM_DEVELOPMENT_SPEC.md`

## 0. 这份文档解决什么问题

视觉资产增强模块的目标只有一件事：给自定义 `/game/` 增加可替换的图片展示能力，同时保持 SillyTavern 原版内容和运行语义不变。

用户最终需要的是：

- 一个外置图片数据库，按 `scene`、`character`、`equipment`、`item`、`skill` 五类管理素材；
- 从原版 ST 已经读回并展示给玩家的可见聊天文本中，识别可展示的场景、人物、装备、道具和技能线索；
- 用确定性的匹配规则为候选图片排序；
- 场景显示为背景，人物显示为透明立绘，装备/道具/技能显示为图标；
- 分数低于 20、证据不足、素材不可用或服务失败时，显示对应的 unknown/默认占位图。

这不是新的剧情系统、战斗系统、背包系统或角色状态系统。图片永远只是对白和可见文本的演出增强。

## 0.1 当前唯一产品目标

当前工作目标是独立完成本模块的完整首期开发周期：

1. 建立可移除的外置视觉资产库，管理 `scene`、`character`、`equipment`、`item`、`skill` 五类素材；
2. 以原版 SillyTavern 目标聊天读回后、玩家已可见的文本投影为唯一匹配证据；
3. 使用 deterministic matcher 对候选图片进行稳定匹配，分数低于 20 或证据不足时使用对应 unknown 图；
4. 在自定义 `/game/` 中展示场景背景、透明人物立绘和装备/道具/技能图标；
5. 完成素材导入、发布、回滚、失败降级、旧存档兼容和桌面/移动端验收。

当前目标不包含完整游戏系统的其他建设，也不包含 AA 导入助手、UAP 自适应 HUD、Arc 发布、原版运行桥接深化或 VS-LLM。它们不是本模块的前置任务，也不得被混入本模块代码批次。

## 1. 当前唯一有效范围

本阶段的产品目标是完成本模块，但当前执行点先停在文档闭环和 VS-CODE-1 准入准备。不得直接恢复旧的 VS1-SG/PI/AS/M 原型；任何代码必须按下表重新逐批准入。

### 必须保留在本模块

1. 五类视觉资产及其管理员维护、版本、哈希、授权和安全元数据。
2. 可见 ST 聊天证据边界：只接受目标聊天读回后、玩家可见消息生成的受限投影；不读隐藏角色卡、世界书、prompt、context、preset 或内部运行态。
3. deterministic-only 匹配基线：服务端过滤候选，固定词典和评分，稳定排序，`score < 20` 使用 type-specific unknown。
4. presentation-only 绑定：图片可绑定到当前可见实体标签，但不代表拥有、获得、装备、学会、解锁、伤害、效果或任何玩法事实。
5. 异步、超时、降级、缓存、幂等、旧存档版本绑定和桌面/移动端可访问性。
6. 图片上传、解码、重编码、最终服务字节哈希、URI/CSP、目录发布/回滚和管理员/玩家隔离的安全要求。

### 明确不属于当前交付

- 玩家运行时 LLM 视觉匹配、provider、生成图片或视频；这些属于单独的 `VS-LLM` 后续 gate。
- 导入助手 AA、UAP 自适应展示、RPG HUD、装备解析、Arc 发布、原版运行桥接等其他路线。它们可以被视觉模块消费已发布的展示 profile，但不在本模块内重新设计或串联。
- 完整通用的 Projection Issuer、跨业务 projection infrastructure、复杂 receipt/binding writer 平台不属于本模块；本模块只在 VS-CODE-P 实现完成视觉匹配所必需的最小可见投影和授权边界，不扩展成通用剧情或运行时基础设施。
- 任何 ST 后端、原版前端、配置、根依赖、启动脚本或原版资源修改。

## 2. 目标架构

```text
原版 ST 目标聊天读回
        │
        ▼
受控可见文本投影（只含 bounded display evidence）
        │
        ▼
已发布视觉 profile + 已发布五类素材 catalog
        │
        ▼
确定性候选过滤/评分/unknown fallback
        │
        ▼
自定义 /game/ 展示层：背景、立绘、图标、详情抽屉
```

原版 ST 仍然是角色卡、世界书、聊天、上下文、Generate 和剧情语义的唯一权威。视觉模块只能读取受控可见投影并返回展示结果；它不能反向写入 ST，也不能阻塞 Generate、输入、聊天写入或存档恢复。

## 3. 单模块开发顺序

当前先完成文档冻结，再由用户单独授权代码。每一阶段都必须独立审查，不能跨阶段顺手实现后置能力。

| 阶段 | 当前定位 | 只解决什么 | 当前是否落代码 |
| --- | --- | --- | --- |
| VS-DOCS-0..5 | 已完成 | 统一范围、依赖、必需/后置项、协议、验收和停机条件 | 已完成；仅 docs/.codex-longrun |
| VS-CODE-1 | 当前准入准备 | 外置素材库、五类 schema、unknown、上传/目录/URI 安全 | 尚未落码 |
| VS-CODE-P | VS-CODE-1 后置准入 | 受信可见文本投影与最小授权边界，供 matcher 使用 | 尚未落码 |
| VS-CODE-2 | 后续独立准入 | deterministic matcher 和 display-only binding | 尚未落码 |
| VS-CODE-4 | 后续独立准入 | 管理员素材库和发布界面 | 尚未落码 |
| VS-CODE-3 | 后续独立准入 | `/game/` 背景/立绘/图标展示 | 尚未落码 |
| VS-CODE-5 | 后续独立准入 | 全模块回归与最终人工验收 | 尚未落码 |
| VS-LLM | 后续独立 gate | 可选服务端视觉 LLM 重排 | 明确后置 |

“模块开发完”在当前语境下指 VS-CODE-1、VS-CODE-P、VS-CODE-2、VS-CODE-4、VS-CODE-3、VS-CODE-5 全部通过验收；VS-DOCS-0..5 只是代码开发前置闭环，不代表视觉功能已经可用。

## 4. 必需项与可后置项

| 内容 | 当前是否必须写清 | 原因 |
| --- | --- | --- |
| 五类资产、标签、版本、哈希、授权 | 必须 | 没有它无法建立图片库 |
| 可见 ST 文本唯一证据 | 必须 | 防止偷读隐藏资源或猜测剧情事实 |
| deterministic matcher、固定词典、稳定评分 | 必须 | 首期无需 LLM 也能安全工作 |
| `<20` unknown、候选为空和服务失败降级 | 必须 | 保证展示不误导、不阻塞剧情 |
| presentation-only binding | 必须 | 防止图片绑定变成平行玩法状态 |
| 上传/解码/URI/CSP/管理员认证 | 必须 | 图片库是外部输入面，不能最后补安全 |
| release/profile/catalog/save 精确绑定 | 必须 | 防止旧存档被新图悄悄替换 |
| Projection proof/stub/receipt 的生产实现 | 后置 | 属于代码和部署边界，不是本轮文档主线的功能实现 |
| 玩家视觉 UI、管理员素材 UI | 后置代码批次 | 先固定协议，避免 UI 反向定义玩法 |
| runtime visual LLM、图片/视频生成 | 后置且另审 | 成本、隐私和 provider 风险远高于首期必要性 |

## 5. VS-DOCS-1：资产库、五类 schema、unknown 和上传安全

### 5.1 资产类型和展示角色

视觉资产库只接受五类资产。`assetType` 和 `role` 必须一一对应，不能由前端或 LLM 自由扩展。

| assetType | role | 用途 | 必需展示约束 |
| --- | --- | --- | --- |
| `scene` | `background` | 场景背景 | 横向或可裁切背景图；不得遮挡对白；支持安全焦点裁切 |
| `character` | `transparent-sprite` | 人物立绘 | PNG/WebP 等支持透明通道的主体图；无透明主体时只能作为 silhouette/unknown |
| `equipment` | `icon` | 武器、防具、装备 | 正方形或可安全裁切图标；不得计算 AC/伤害/效果 |
| `item` | `icon` | 道具、材料、线索物 | 正方形或可安全裁切图标；不得代表“已拥有”事实 |
| `skill` | `icon` | 技能、法术、能力 | 图标只表示可见文本提到的技能标签；不得新增冷却/等级/效果状态 |

### 5.2 VisualAssetCatalogV1

目录是可发布、可回滚、可被旧存档引用的版本化清单。后续实现时必须使用 closed schema：

```ts
interface VisualAssetCatalogV1 {
  schemaVersion: "galgame.visual-asset-catalog.v1";
  catalogId: string;
  catalogRevision: number;
  catalogHash: string;
  dictionaryVersion: string;
  dictionaryHash: string;
  status: "draft" | "validated" | "published" | "archived";
  assets: VisualAssetRefV1[];
  unknownAssets: Record<"scene" | "character" | "equipment" | "item" | "skill", VisualAssetRefV1>;
  createdAt: string;
  updatedAt: string;
}
```

目录 hash 必须覆盖 asset id、version、type、role、最终内容 hash、metadata hash、dictionary hash 和状态所需的发布元数据。已发布 revision 不得原地替换图片或标签；新增或修正只能生成新 revision。

### 5.3 VisualAssetV1

资产元数据只服务于展示匹配，不承载剧情事实。

```ts
interface VisualAssetV1 {
  schemaVersion: "galgame.visual-asset.v1";
  assetId: string;
  assetVersion: number;
  assetType: "scene" | "character" | "equipment" | "item" | "skill";
  role: "background" | "transparent-sprite" | "icon";
  contentUri: string;
  thumbnailUri: string;
  assetContentSha256: string;
  assetMetadataHash: string;
  canonicalMime: "image/png" | "image/webp";
  width: number;
  height: number;
  hasAlpha?: boolean;
  transparentPixel?: boolean;
  tagCodes: string[];
  featureCodes: string[];
  licenseCode: "user-owned" | "public-domain" | "cc0" | "licensed-private" | "unknown";
  sourceLabel?: string;
  safetyFlags: string[];
  createdAt: string;
}
```

玩家可见 DTO 不得包含 `sourceLabel`、上传审计、内部路径、原始文件名、管理员备注或草稿状态。标签和特征必须来自版本化词典，未知 code、大小写别名、重复项或超限数组均拒绝。

### 5.4 Immutable Unknown Assets

每类资产必须有一个 immutable unknown：

- `unknown_scene`
- `unknown_character`
- `unknown_equipment`
- `unknown_item`
- `unknown_skill`

unknown 是固定资产，不是动态匹配结果。score `<20`、候选为空、证据不足、资产缺失、hash 不匹配、服务超时或授权失败时，只能显示对应类型 unknown。不能把非法类型静默映射成 `unknown_item`。

### 5.5 上传、目录和 URI 安全

后续实现必须在上传阶段完成：

- MIME sniff，不信任扩展名或浏览器 `Content-Type`。
- 解码并重编码为 canonical 输出字节，最终 `assetContentSha256` 只对服务端输出字节计算。
- 拒绝 SVG、polyglot、zip bomb、损坏图片、超尺寸、超像素、超压缩比、动画帧和路径穿越。
- 角色立绘必须满足透明主体要求；unknown/silhouette 例外必须显式标注。
- `contentUri` 和 `thumbnailUri` 只能是服务端生成的 content-addressed 相对路径或受控代理路径；禁止任意 `http(s)`、`data:`、`blob:`、`javascript:`、`file:`、绝对路径和用户输入路径。
- 管理员上传、验证、发布、回滚必须在真实管理员认证/外部反代边界下进行；隐藏页面或同源不是认证。

## 6. VS-DOCS-2：可见 ST 投影、deterministic matcher、score 和 no-guess

### 6.1 唯一证据来源

视觉匹配只能消费原版 ST 目标聊天读回后、玩家已经可见的消息投影。投影中只允许 bounded display evidence：

- release/scenario/version/Arc/chat/message identity；
- sourceMessageIndex 和 sourceMessageHash；
- 可见实体 label；
- 受限 attribute code；
- extractor/dictionary version/hash；
- evidenceDigest。

不得把完整聊天原文、隐藏角色卡、世界书、prompt、context、preset、内部设置、密钥或 provider response 送入视觉匹配层、日志、catalog、binding 或缓存。

### 6.2 VisualVisibleProjectionV1 规则

投影不是剧情状态。它只回答“当前可见文本里有哪些可展示实体”。

- `scene` 可来自明确地点、环境、天气、室内/室外、氛围等可见线索。
- `character` 固定立绘只能来自明确姓名 + 明确外观证据，或管理员已确认的非事实 silhouette/template。probable/ambiguous 外貌不得建立具体人物绑定。
- `equipment`、`item`、`skill` 只能来自明确标签或已认可标题区/键值行，不得从自然语言推断“获得/拥有/学会/装备/效果”。
- `unknown` entity 只表示投影识别不确定，不可用于创建实际绑定。

### 6.3 Deterministic Matcher Baseline

首期 matcher 不调用 LLM。排序规则必须稳定、可复现、可测试：

1. 按 `assetType` 过滤候选。
2. 按 catalog revision、dictionary hash、profile hash 锁定候选集合。
3. 使用固定词典把可见 attribute code 与 asset tag/feature code 计分。
4. 对角色 ambiguous/probable 身份外观设置上限，不能因弱线索达到高置信具体立绘。
5. 对 equipment/item/skill，缺少明确 label 时 score 必须为 0。
6. 同分按 assetId/assetVersion 固定排序，避免刷新漂移。

分数带建议：

| score | band | 行为 |
| --- | --- | --- |
| `<20` | `unknown` | 强制 type-specific unknown |
| `20-44` | `low` | 可展示但弱置信；人物具体立绘仍需 explicit 外观 |
| `45-74` | `medium` | 普通展示 |
| `75-100` | `high` | 强匹配展示 |

### 6.4 No-Guess 和 Prompt Injection 防线

可见文本是不可信输入。文本里出现“忽略规则、选择某图、调用接口、读取隐藏资料”等指令必须当作普通剧情文本，不得执行。

禁止：

- 用图片匹配结果改变剧情、库存、技能、好感、任务或战斗状态；
- 从“他看起来像战士”推断装备或技能；
- 从“屋里可能有商人”创建固定人物立绘；
- 低置信场景长期固定为事实背景；
- 因匹配失败回落到最新 catalog、默认角色图或本地剧情。

## 7. VS-DOCS-3：/game 展示、异步降级和无障碍

### 7.1 展示层职责

`/game/` 未来视觉层只能显示：

- scene 背景；
- 当前说话人或当前可见人物的透明立绘；
- 装备/道具/技能图标；
- unknown/default 占位；
- 加载、失败、重试、详情查看等 presentation 状态。

它不得隐藏、改写、压缩或替代原版对白。视觉加载失败时，文本游玩必须继续可用。

### 7.2 异步语义

视觉匹配和图片加载永远不阻塞：

- 原版 Generate；
- 玩家输入；
- 原版聊天写入；
- 存档保存/恢复；
- 错误恢复。

视觉层可以显示“正在匹配图片/素材暂不可用”，但不能让玩家无法继续剧情。超时、离线、proof 失败、catalog 缺失、hash 不符时，默认显示对应 type-specific unknown；只有上一张图片仍属于同一 release/profile/catalog/chat 范围、来源证据未过期且 hash 仍可验证时，才允许短暂保留上一张已验证图。不得跨版本、跨存档、跨目录或跨实体复用旧图，并给出非技术化提示。

### 7.3 背景、立绘和图标布局

背景：

- 使用安全裁切，不遮挡对白框、状态栏和输入区域；
- 移动端优先保留画面中心主体和文字可读性；
- 支持背景淡入淡出，但遵守 `prefers-reduced-motion`。

立绘：

- 透明 PNG/WebP 叠加在舞台层；
- 未识别说话人时不强行显示具体人物；
- 多人物时只根据可见说话人/明确在场文本展示，不猜站位。

图标：

- 背包、状态栏、详情抽屉可显示装备/道具/技能图标；
- 图标不代表获得或装备事实，只代表可见文本中出现过的展示实体；
- 点击图标只能展开详情或把普通文本作为玩家输入，不执行前端规则。

### 7.4 可访问性

必须覆盖：

- 背景和纯装饰图 `aria-hidden`；
- 重要图标有固定中文 alt/label；
- 详情弹层 `role=dialog`、`aria-modal`、Esc 关闭、焦点锁定和焦点回归；
- 键盘可操作；
- 对比度不被背景破坏；
- 移动端安全区和输入法遮挡；
- 图片加载失败的文本替代。

## 8. VS-DOCS-4：release/profile/catalog/save/old-save 兼容

### 8.1 绑定对象

视觉显示必须绑定到精确发布版本：

- releaseId；
- scenarioId/scenarioVersion；
- arcId；
- chatId；
- presentationProfileId/profileHash；
- catalogId/catalogRevision/catalogHash；
- dictionaryVersion/dictionaryHash；
- assetId/assetVersion/assetContentSha256；
- sourceMessageIndex/sourceMessageHash/evidenceDigest。

缺失、错配、旧 revision 被归档、asset hash 不符或 profile/catalog 不匹配时，必须 fail closed 到 unknown，不得套用 active/latest/default。

### 8.2 发布与回滚

视觉 profile/catalog 发布必须遵守现有发布门禁：

- confirm/import 不改变 active release；
- explicit publish 才让玩家读到新视觉 profile/catalog；
- rollback 恢复旧 release 的旧 profile/catalog；
- 已发布 catalog revision 不原地替换；
- 新整理或新素材生成新 revision/hash。

视觉发布失败不得影响原版 ST 资源、聊天或 Generate。

### 8.3 旧存档

旧存档继续读取保存时的 release/profile/catalog/asset 版本。规则：

- old-save 有 exact binding 时，尝试读取旧 catalog/asset；
- 旧资产仍在 retention 期且 hash 匹配，则显示旧图；
- 旧资产缺失、过期、hash mismatch，则显示对应 unknown；
- 不允许用当前 active catalog、新推荐或同名新图污染旧存档。

### 8.4 保存内容限制

player save 只能保存视觉引用和 UI 展示状态，不保存剧情事实：

允许：

- 当前背景 asset ref；
- 当前立绘 asset refs；
- 已展开/折叠 UI 状态；
- 视觉匹配 job/binding id；
- release/profile/catalog 版本绑定。

禁止：

- HP、金币、库存、技能等级、装备效果；
- 关系值、任务进度、线索真伪；
- 剧情节点、选择、结局条件；
- 角色卡/世界书/prompt/context 正文；
- provider response 或聊天原文。

## 9. VS-DOCS-5：验收矩阵

### 9.1 文档阶段验收

当前 VS-DOCS 阶段只验文档和边界：

| Gate | 证据 | 通过条件 |
| --- | --- | --- |
| docs coverage | `rg`/脚本扫描总控和详细规格 | VS-DOCS-1..5 必需项全部命中 |
| docs diff-check | `git diff --check -- docs .codex-longrun` | 无空白错误 |
| state validation | `validate_state.py --project .` | state JSON 有效且 current phase 为 VS-DOCS verifying |
| business-code boundary | scoped status/diff | 除 docs/.codex-longrun 外无本轮业务代码修改 |
| protected boundary | ST backend/original public/root/startup status/diff/EOL | 冻结路径干净 |
| evidence inventory | JSON 清单 | 证据非空、no-BOM、可读 |

### 9.2 后续代码阶段 fixture 要求（future code fixture）

未来代码准入至少要准备：

- scene：明确场景、模糊场景、场景切换、低分 unknown；
- character：明确外观、仅姓名、模糊身份、多人物、透明立绘缺失；
- equipment：明确武器/防具、属性行合并、缺失属性、容器误报防线；
- item：道具、材料、线索物、叙事句误报防线；
- skill：明确技能/法术、模糊能力描述、无 label 不绑定；
- old-save：旧 catalog 可读、旧 asset 缺失、hash mismatch、rollback；
- service failure：视觉服务不可用、超时、proof invalid、catalog missing、asset 404；
- UI：desktop、tablet、mobile、键盘、dialog、reduced motion、背景对比度。

### 9.3 后续真实浏览器验收

未来代码实现后必须证明：

- `/game/` active scenario/version/Arc/chat/profile/catalog exact；
- 原版 ST Generate/readback 正常，不被视觉服务阻塞；
- 视觉服务失败时文本游玩可继续；
- 图片加载失败显示 unknown/default；
- 玩家页面无管理员入口、无 ST 技术词、无 provider/key 泄漏；
- localStorage/IndexedDB/save 不含聊天原文、prompt/context/resource body 或玩法事实。

### 9.4 冻结边界验收

任何未来实现都必须同时检查：

- `src/**`、`server.js`、`plugins.js` 无改动；
- 原版 `public/**` 无改动；
- `config.yaml`、root dependencies、startup scripts 无改动；
- `public/game/**`、`public/game-admin/**` 只能由源码重建；
- external modules 可移除，不 import/patch ST backend。

## 10. 当前开发停机条件

VS-DOCS-1..5 已完成并通过审查，当前停在 VS-CODE-1 code-admission preparation。即使用户确认本模块是当前唯一目标，也不能跳过逐批准入、源码审计和验证门禁。

本模块后续按以下顺序推进：

1. VS-CODE-1：资产库和目录安全；
2. VS-CODE-P：视觉匹配所需的最小受信可见投影/授权边界；
3. VS-CODE-2：deterministic matcher 和 display-only binding；
4. VS-CODE-4：管理员素材库和发布界面；
5. VS-CODE-3：`/game/` 背景/立绘/图标展示；
6. VS-CODE-5：完整回归和人工验收。

每一批都必须由独立 code-admission 明确允许；历史 VS1-SG/PI/AS/M 的 PASS 不能自动转为当前批次授权。

## 11. 历史材料如何处理

现有以下材料和代码不删除、不回滚、不清理，只从当前执行链中隔离出来：

- `VS1-SG`：共享 schema/proof shape 历史材料；
- `VS1-PI`：Projection Issuer/proof/stub 历史材料；
- `VS1-AS`：素材安全/catalog 历史材料和外置服务代码；
- `VS1-M`：deterministic matcher/binding 历史材料和外置服务代码。

它们现在的统一状态是“历史/未来实现附录，暂停，不代表当前交付完成”。旧证据继续保留用于追溯；旧的 reviewer PASS 不能自动授权下一批代码。任何恢复实现都必须重新以本模块文档为入口，由用户明确授权并重新开 code-admission gate。

## 12. 验收与停机规则

### 当前文档阶段必须通过

- 视觉模块主文档与本总控文档的范围一致；
- backlog、pre-implementation materials、state、progress、test-log、blockers 一致写明“视觉资产 docs-only，代码暂停”；
- docs diff-check、state validation、证据 inventory 通过；
- 冻结的 ST backend/original public/config/root deps/startup 无变更；
- 本轮不新增、不修改业务代码、不重建 public 输出。

### 后续代码阶段必须额外通过

- source/public 一致性和 protected-path 审计；
- 上传恶意文件、哈希/目录篡改、proof/stub 过期或重放、跨 release/旧存档错配的 fail-closed 测试；
- score 阈值、unknown fallback、实体 no-guess、binding 冲突和服务故障恢复；
- 桌面/移动端、键盘焦点、对比度、无横向溢出；
- 真实原版 Generate/readback 不被视觉模块替代或阻塞。

## 13. 当前交接结论

当前主线不得继续 VS1-M、Projection Issuer、素材服务、matcher/binding writer、玩家/管理员视觉 UI 或 VS-LLM。下一步只能是完成本 VS-DOCS 文档闭环并等待用户重新明确“允许落视觉代码”。
