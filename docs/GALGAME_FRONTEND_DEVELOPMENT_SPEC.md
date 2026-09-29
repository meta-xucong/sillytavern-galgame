# AI Galgame 前端开发与外接接口规范

> 最新冲突标记：自 2026-07-24 起，凡本文提到由定制层重做 SillyTavern 的角色卡、世界书、预设、上下文构造、聊天历史、生成语义、固定剧情、前端分支/结局或平行剧情状态的内容，均以 `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md` 为准并视为作废。最新原则是：原版 SillyTavern 提供后端能力和运行语义，玩家端必须是我们自定义的 Galgame UI。

> 文档状态：最终方向工程基线 v1.1
> 生效日期：2026-07-24
> 适用范围：玩家端、管理员端、SillyTavern 前端适配、剧本配置服务、媒体接口
> 产品依据：`docs/GALGAME_DESIGN_SPEC.md`

> 当前视觉阶段覆盖（2026-09-05）：玩家端可以把已经展示给玩家的当前对白和有限最近可见上下文发送给自有 visual-asset-service，由服务端 LLM 提取受限视觉标签，再接收服务端评分后的图片或通用占位图。玩家端不得直连 provider，不得携带 ST key、隐藏 prompt/context 或原版资源正文；视觉请求异步执行，不得阻塞 ST Generate、输入、聊天历史或存档。正式合同见 `docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md`。

## 1. 目标与硬性边界

本项目在不修改 SillyTavern 后端源代码、不改变 SillyTavern 原版功能语义的前提下，建设两个独立前端：

- 玩家端：面向普通玩家的极简 Galgame
- 管理员端：面向运营人员的故事入口、原版资源绑定、检查、发布和回滚工具

允许通过独立外接模块提供共享配置、存档或媒体生成能力，但外接模块必须与 SillyTavern 后端解耦，不能通过补丁、中间件注入或覆写路由改变 SillyTavern 行为。

最终版本的基本定位是“日式 JRPG/Galgame 前端皮肤 + SillyTavern 原版能力适配 + 极薄外接模块”。角色卡、世界书、预设、权重、上下文注入和生成能力必须以 SillyTavern 原版为准；定制层只改变展示和编排方式，不重写原版功能。

### 1.1 禁止修改

未经用户明确授权，禁止修改：

- `src/**`
- `server.js`
- `plugins.js`
- SillyTavern 现有后端路由、鉴权、CSRF、存储和启动逻辑
- `config.yaml` 中与后端行为相关的配置
- 根目录 `package.json`、`package-lock.json` 中会影响 SillyTavern 运行的依赖和脚本

### 1.2 允许范围

- 新增隔离的玩家端和管理员端源码
- 新增独立前端构建配置
- 使用 SillyTavern 已存在的 HTTP 接口
- 使用 SillyTavern 已存在的角色、世界设定、预设、聊天和生成能力
- 使用管理员适配层只读校验 SillyTavern 原版角色卡、世界书、预设和上下文配置引用
- 新增独立运行的配置服务或媒体网关
- 新增文档、测试和静态资源

### 1.3 兼容性原则

所有 SillyTavern 调用集中在适配层。页面组件不得直接散落调用 SillyTavern 接口，以便上游版本变化时只修改一个位置。

定制后台展示 SillyTavern 设置时必须保持原版功能等价。也就是说，后台可以换布局、换术语分组、提供发布校验和默认组合，但不能改变设置含义、权重含义、世界书激活逻辑或角色卡结构。无法做到等价封装的功能，应保留原版维护入口作为权威操作面。

玩家端“开始游戏”继续读取当前 Arc 的 chat seed；“继续游戏”在自动槽仍指向该 seed 时，先通过既有绑定聊天读取能力查找当前 Arc 的最新非 seed 聊天，命中后展示并更新自动槽，未命中再精确读取 seed。手动存档始终按其保存的 chatId 精确读取，不得被最新聊天匹配替换。

## 2. 总体架构

```mermaid
flowchart LR
    P["玩家端 /game<br/>日式标题入口"] --> ST["原版 SillyTavern<br/>角色卡/世界书/预设/权重/聊天/生成"]
    P --> C["当前入口配置<br/>标题/封面/跳转地址"]
    A["管理员端 /game-admin<br/>原版资源引用校验"] --> B["只读资源诊断适配器"]
    B --> ST
    C --> CS["外接配置服务<br/>故事选择/发布/回滚"]
    A --> CS
    A --> MG["外接媒体网关<br/>媒体接口检测"]
    MG --> IP["后续生图/视频软件"]
```

架构原则：

- SillyTavern 是内容与生成能力的权威源。
- 故事入口配置只保存原版资源绑定关系、舞台锚点、媒体策略和发布状态。
- 玩家端不直接接触角色卡、世界书、预设、权重和模型参数。
- 管理员端可以操作这些原版能力，但必须通过原版接口、原版数据结构或等价适配层完成。
- 外接模块只处理游戏进度、媒体生成、发布索引和安全隔离，不承载 SillyTavern 原版业务逻辑。

### 2.1 部署方式

推荐同源部署：

- 玩家端：`/game/`
- 管理员端：`/game-admin/`
- SillyTavern 原版页面：仅内部维护人员可访问

玩家端和管理员端可以构建为静态文件，由现有静态托管或独立静态站点提供。不得为了挂载页面而修改 SillyTavern 服务端路由。

### 2.2 发布与配置模式

**本地发布缓存**

- 默认故事入口、发布信息和存档状态存储在浏览器 IndexedDB
- 适合同一台设备上的设计、演示和调试
- 管理员发布只对当前浏览器生效
- 不提供本地剧情引擎；故事文本和走向仍必须来自 SillyTavern

**共享部署模式**

- 使用独立配置服务保存故事入口、默认推荐版本和可游玩作品清单
- 玩家端只读取已上架作品摘要和对应入口内容
- 管理员端经过独立鉴权后进行发布
- 配置服务是外接模块，不进入 SillyTavern 后端
- 故事入口引用 SillyTavern 原版资源；配置服务保存的是发布索引和绑定关系，不保存密钥或复制版世界书

共享部署必须使用配置服务；纯静态前端无法安全、可靠地让管理员向其他设备发布剧本。

前端通过 `frontend/shared/src/config-service.js` 接入配置服务。部署时可在玩家端和管理端 HTML 中设置 `meta[name="galgame-config-service"]`，或由静态托管层注入 `window.GALGAME_CONFIG_SERVICE_URL`。未配置时使用本地发布缓存。

玩家端从配置服务读取当前发布版本和剧本清单后，会把最近一次成功的 release 与 manifest 成对缓存到 IndexedDB。配置服务短暂不可用时，玩家端使用最近成功版本降级恢复，不进入管理端，也不暴露技术错误。

本地开发部署应使用统一启动脚本启动配置服务和原版运行桥，使两者共享同一份本地 proof secret，并统一指向当前 SillyTavern 地址。玩家端可通过共享适配层自动发现同机 loopback 运行桥，但续写授权仍以配置服务签发的短期 proof 为准；自动发现不得扩展为任意远程服务扫描，也不得绕过 proof 校验。

## 3. 建议目录

后续实现建议使用隔离目录，避免与上游页面形成耦合：

```text
frontend/
  player/
    src/
    tests/
    package.json
  admin/
    src/
    tests/
    package.json
  shared/
    domain/
    adapters/
    protocol/
    ui/
    tests/
public/
  game/                 # 玩家端构建产物
  game-admin/           # 管理员端构建产物
external-modules/
  game-config-service/  # 共享部署时可选，只保存入口发布索引
  media-gateway/        # 需要保护媒体服务密钥时使用，不参与剧情生成
docs/
```

要求：

- 前端使用自己的依赖清单，不修改根目录依赖。
- 构建产物与源码分离。
- 不直接修改 `public/index.html`、`public/script.js`、`public/style.css`。
- 不复制 SillyTavern 大段内部代码；通过适配器调用稳定能力。

### 3.1 物理隔离要求

本项目的定制代码必须形成清晰分层：

- `frontend/**` 是定制前端源码区。
- `public/game/**` 与 `public/game-admin/**` 是定制前端静态输出区。
- `external-modules/**` 是可独立运行、可替换、可删除的外接服务区。
- SillyTavern 原版源码、后端和原版前端保持独立，不承载定制业务逻辑。

玩家端、管理端和共享协议可以互相引用，但不得引用 `src/**` 后端源码，不得依赖原版 `public/index.html`、`public/script.js` 或 `public/style.css` 中的全局状态。

如果未来为了接入需要“开接口”，优先使用独立外接模块或反向代理。只有在用户明确批准某一个具体后端变更后，才允许触碰 SillyTavern 后端。

## 4. 前端应用划分

### 4.1 玩家端

主要模块：

- `Bootstrap`：读取默认推荐入口、可游玩作品清单和最小展示资源
- `TitleScreen`：作品选择、标题、封面、角色视觉锚点、开始、继续、读取
- `GameStage`：Galgame 舞台、背景、角色层、对话框和输入区
- `StageMessagePresenter`：只从原版聊天消息的可见 `displayText/text` 做展示提取，将文本切成旁白、对白、动作和玩家输入片段，负责逐字显示、点击补全文字、点击进入下一片段和本地分页恢复；可以隐藏误露的思考/推理标记、HTML 注释和 markdown 围栏，但不得改写剧情事实、补造对白，也不得把片段类型写回 prompt、世界书、Arc 切换、分支或结局。视觉实体提取必须使用同一份可见投影，不能从隐藏的 `[thinking]`、代码围栏或内部规划行读取场景、人物或属性。展示标签按原版可见文本归一化：`背景设定`、`当前地点`、`环境`、`战场` 和 `场景描述` 统一为场景属性；`艾莉丝的回合`、`伤害`、`体质豁免`、`死亡豁免记录`、`你的回合` 以及行动/状态/检定/豁免等系统行按旁白或系统片段展示，不创建角色实体。角色视觉实体只能来自明确说话人或明确角色/别名标签；旁白、主持人/Dungeon Master、玩家和系统片段不得用默认说话人伪造角色提示。对于已发布角色/别名，若原版可见段落采用“角色名+叙述动词+引号对白”的自然叙事写法，展示层可以把该段归一为对应角色对白；未知名词仍保持旁白，且不改变原文或写回原版上下文。
- `StageMessagePresenter` 对长回复还要做保守的完整性检查：没有足够可见正文、没有三选一、尾部停在未闭合句且没有终局标记时，只显示“可能未生成完”的恢复提示，保留原文并允许玩家显式输入“继续”走原版聊天追加流程；不得删除或覆盖原版截断消息，也不能把短的合法续写误判为失败。`行动顺序`、`先攻顺序`、`轮到 X 行动`只作为展示信息提取，无法解析时显示空状态，不创建剧情状态。

视觉绑定必须保持保守：角色名及其 `的回合`、`回合`、`的行动` 等展示后缀先归一到基础名，再执行精确角色/别名匹配。`性别`、`种族/物种`、`外观/特征`、`服装` 等可见属性会进入同一份 visual projection，不能从隐藏思考或角色卡正文补造。RUNTIME-3 闭集标签由服务端维护，角色性别最多匹配一个 masculine/feminine/androgynous 代码，无法确认时省略。未知角色不借用已绑定角色的 `characterPool` 资产；播放器会在池耗尽、跨角色冲突或服务失败时显示未知占位。旁白使用中性符号占位，玩家使用独立占位，切换消息前先清理上一角色的立绘。只有精确匹配成功时才允许锁定角色视觉资源。

同一局内必须保持角色与素材的一对一关系。校验器允许显式角色和池中的同角色别名镜像，但拒绝不同角色共享 `assetId`；运行时池分配会排除显式绑定资源并按 `manifest + Arc + chat/session` 记录已分配资源，已分配资源不会再分给另一个名字。默认角色图不能作为未知角色的隐式回退。该分配表是进程内展示缓存，重启后会清空；原版聊天和存档仍是剧情权威。

历史 manifest 中的 `defaults.narratorAssetId`、`defaults.playerAssetId` 可能仍指向旧角色 PNG；玩家端不会把这些 legacy default 渲染为旁白或玩家头像，而是使用内置中性 SVG 占位。新 catalog 应为旁白和玩家保留独立、中性且内容哈希不复用的资源；迁移旧 catalog 时必须保留原版本回滚。

视觉运行时不可用或返回未知匹配时，玩家端必须保留当前 manifest 的已发布默认背景，不得用通用视觉占位图覆盖场景；当前说话角色仍使用角色绑定头像或对应的中性占位，旁白和玩家继续使用各自符号占位。已发布且通过 manifest 校验的显式角色绑定可在运行时理解器不可用时直接作为可信头像映射，动态场景和未绑定角色仍必须经过匹配并在失败时保持默认背景/未知占位。已经加载的有效场景背景在下一条对白匹配失败时继续保留，直到新的有效场景替换或舞台重置；非法资源 URL 不得沿用旧图。为避免长原版回复让视觉请求整包失败，发送给 visual-asset-service 的可见消息 DTO 可保留头尾并限制在 4000 个 Unicode 字符以内；这只限制视觉理解输入，不截断聊天正文、存档或原版生成上下文。
- `SillyTavernOriginalChatBridge`：读取绑定角色的原版聊天、把玩家输入写回原版聊天，并把原版消息转换成 Galgame 可显示消息
- `PlayerErrorBoundary`：将入口加载错误转换为简短恢复提示

### 4.2 管理员端

主要模块：

- `ReleaseDashboard`：当前发布和回滚
- `StoryEntryLibrary`：导入、复制、归档和删除故事入口
- `SillyTavernResourceBinder`：绑定原版角色卡、群组、世界书、预设、权重和运行配置
- `SillyTavernParityPanel`：以后台方式展示原版功能，并保持与原版语义一致
- `SillyTavernResourceAvailabilityDiagnostic`：通过原版已有接口只读核对角色卡、世界书和预设引用是否存在，只提取名单字段，不展示、保存或复制资源正文
- `ScenarioValidator`：结构、资源、能力和兼容性校验
- `MediaHealthView`：接口检测和测试任务
- `SystemHealthView`：SillyTavern、配置服务和资源可用性

管理员端不得与玩家端共享路由入口。共享代码仅限领域模型、协议、适配器和基础 UI。

管理员端不是另一个独立剧情编辑器。它的职责是把 SillyTavern 原版能力组合成“故事入口”，并为玩家端提供发布后的只读游戏化入口。若某个原版功能尚未完成等价封装，管理员端应提示使用原版页面维护该项功能。

管理员端的“校验”和“发布”路径必须执行原版资源存在性诊断。当前实现通过适配层只读调用 `/api/characters/all`、`/api/worldinfo/list`、`/api/settings/get` 和 `/api/characters/chats`，核对角色卡、世界书、生成预设、指令预设、系统提示、上下文预设和聊天种子引用。适配层只提取名称字段用于比对，任何缺失项都必须阻止发布。

## 5. 核心领域模型

### 5.1 当前发布

```ts
interface ActiveRelease {
  releaseId: string;
  scenarioId: string;
  scenarioVersion: string;
  manifestId?: string;
  manifestVersion?: string;
  activeArcId?: string;
  publishedAt: string;
  manifestUrl: string;
  contentHash: string;
  minimumPlayerVersion: string;
}
```

玩家端每次启动时读取默认推荐 `ActiveRelease` 和可游玩作品清单。玩家可在标题页选择清单中的已上架作品；一局已开始的游戏继续绑定创建时的 release、manifest 和 Arc。管理员发布新版本不能悄悄改变进行中的存档。

继续或读取存档时，玩家端必须优先按存档中的 `scenarioId + scenarioVersion + arcId` 从配置服务或本地缓存取回对应 manifest，而不是只使用当前默认发布入口。若原版聊天已经在存档保存点之后新增角色回复，自动存档恢复时应同步到最新原版回复；若最新消息仍是玩家输入，则自动请求正式原版运行桥接续写，失败时只显示可恢复状态。

存档中的 `releaseId` 可能来自旧本地版本或后来被替换的发布记录，不能直接作为新的运行桥授权身份。读档时必须在保持 `scenarioId + scenarioVersion + arcId + chatId` 不变的前提下，从该版本 manifest 换算为配置服务认可的稳定可游玩 release，并在 proof 请求与运行桥请求中使用同一个换算结果。该换算只修复授权索引，不得把旧存档迁移到当前默认剧本或新版本。

玩家提交自由输入或点击原版回复中提取出的行动按钮后，前端必须先把玩家消息保存到同一原版聊天，再请求配置服务签发运行桥 proof。配置服务、运行桥和浏览器 CORS 必须让该 proof 请求从玩家路由一次性通过；请求进入运行桥后玩家端显示“思考中”直到成功或明确失败。失败时不得循环刷新状态，只能稳定保留当前玩家输入并提供手动“再试一次”。

“再试一次”和正式请求运行桥前都必须先重新读取当前绑定的原版聊天文件。若该文件已经包含角色新回复，前端应直接同步舞台和自动进度，不再重复请求运行桥；只有最新消息仍是玩家输入时，才允许继续请求原版运行桥。

配置服务为当前聊天签发运行桥证明时，可能遇到刚保存后的原版聊天读回短暂不同步或临时网络失败。玩家端可以在同一次玩家操作内做少量短间隔重试，并把失败原因记录到非玩家日志；不得进入持续自动重连循环，也不得向玩家暴露 proof、接口或配置服务等技术词。

### 5.2 故事入口清单

```ts
interface StoryEntryManifest {
  schemaVersion: "1.0";
  id: string;
  version: string;
  title: string;
  author?: string;
  locale: string;
  contentRating: string;
  saveCompatibility: string;
  resourceBindings: ResourceBindings;
  sillyTavernBindings: SillyTavernBindings;
  arcs?: ArcBindingV1[];
  defaultArcId?: string;
  presentation: PresentationConfig;
  story: NativeLauncherStory;
  media?: MediaPolicy;
}
```

`resourceBindings` 只保存游戏演出资源标识或别名，不保存凭据。`sillyTavernBindings` 只保存对原版资源的引用和绑定策略，不复制密钥，不复制一份与原版脱节的角色卡或世界书。

`arcs` 使用 `docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` 定义的 `galgame.arc-release.v1` / `ArcBindingV1` 正式 schema。旧的单入口 `sillyTavernBindings` 只能兼容迁移为一个 `defaultArcId`，不能继续扩展成平行剧情节点。`ActiveRelease.activeArcId` 指向当前新局入口；进行中存档继续绑定创建时的 release 和 Arc。

`interaction` 与 `runtimeRequirements` 是旧方案字段，当前入口不得用它们重建一套前端玩法或运行配置。玩家实际输入、重生成、上下文与模型运行配置必须委托 SillyTavern 原版机制；展示层由自定义 Galgame 前端负责。

```ts
interface SillyTavernBindings {
  characters: Array<{
    id: string;
    avatar?: string;
    role: "main" | "supporting" | "narrator";
  }>;
  groupId?: string;
  worldBooks: Array<{
    name: string;
    mode: "global" | "character" | "scene" | "manual";
    weight?: number;
  }>;
  presetId?: string;
  instructPresetId?: string;
  systemPromptId?: string;
  contextPresetId?: string;
  chatSeedId?: string;
}
```

后续 Arc schema 中的 `SillyTavernBindingsV1.target` 是单角色、多角色和 group 的统一表达。旧 `characters[] + groupId` 结构只作为兼容输入；如果无法无歧义迁移，管理员发布必须失败并提示修正，不能由前端猜测。

字段名可以随原版接口适配调整，但语义必须与 SillyTavern 原版资源保持一致。

```ts
interface NativeLauncherStory {
  mode: "sillytavern-live";
  startChapterId?: string;
  startNodeId?: string;
  nodes?: {
    [anchorId: string]: {
      chapterId?: string;
      sceneId?: string;
      backgroundId?: string;
      characters?: StageCharacterAnchor[];
      lines?: [];
      choices?: [];
      allowFreeInput?: never;
      freeInputPrompt?: never;
      choicePrompt?: never;
      fallbackChoices?: never;
      nextNodeId?: never;
      freeInputNextNodeId?: never;
      proposedStateChanges?: never;
    }
  };
}
```

`story` 在当前版本只是入口锚点，不能承载前端剧情。`lines` 与 `choices` 必须为空；`allowFreeInput`、`freeInputPrompt`、`choicePrompt`、`fallbackChoices`、`nextNodeId`、`freeInputNextNodeId`、`proposedStateChanges` 都属于旧自建剧情循环残留，发布校验应拒绝。

`StoryDefinition` 只提供运行锚点和默认舞台。校验器必须拒绝任何前端固定台词、固定选项、固定跳转、固定结局或前端状态变更清单。玩家看到的文本、可选分支和剧情推进必须来自 SillyTavern 的生成结果、聊天历史和原版资源语义。

`sillytavern-live` 故事入口不得包含 `initialVariables`、`initialRelationships` 或 `initialInventory`。这些字段会让前端状态成为平行剧情权威，必须在导入、校验、发布和运行时被拒绝或清空。

### 5.3 运行要求

```ts
interface RuntimeRequirements {
  minimumContextTokens: number;
  structuredOutput: "required" | "preferred";
  multiCharacter: boolean;
  latencyPreference: "fast" | "balanced" | "quality";
  contentTags: string[];
  preferredProfileId?: string;
  fallbackProfileId?: string;
}
```

### 5.4 入口状态

当前定制层不维护 `GameState`。浏览器本地只允许缓存：

- 当前发布入口 `ActiveRelease`
- 当前入口 manifest
- 发布历史索引
- 媒体接口配置

聊天历史、重生成、滑动、上下文和实际剧情进度的权威归 SillyTavern 原版负责。自定义前端可以保存必要的显示状态和 UI 偏好，但不得保存节点、变量、关系、物品或 AI 场景结果来形成平行剧情系统。

### 5.5 已废弃的 AI 场景结果

旧方案中的 `SceneResult`、自建输出结构、结构化解析、可读文本降级、前端选择和前端剧情状态均已废弃。当前定制层不得绕开 SillyTavern 原版机制去请求、解析、规范化或推进剧情文本。

实际对白、选择、聊天历史、重生成、滑动、上下文和失败恢复必须来自 SillyTavern 原版运行机制。自定义前端负责把这些内容以 Galgame UI 展示给玩家。

## 6. 玩家入口状态

```mermaid
stateDiagram-v2
    [*] --> Boot
    Boot --> Title: 当前入口有效
    Boot --> RecoverableError: 入口加载失败
    Title --> GalgameStage: 开始/继续/读取
    GalgameStage --> BridgePending: 原版运行桥接未就绪
    GalgameStage --> GalgameStage: 原版消息返回后刷新舞台
    RecoverableError --> Boot: 重试
```

玩家端负责加载当前管理员发布的入口元数据，并在自定义 Galgame UI 内启动或恢复游玩。开始、继续、读取不得默认把玩家送回原版 SillyTavern UI；如果运行桥接尚未完成，应展示明确的游戏内未就绪/恢复状态，而不是伪装成已完成。

## 7. SillyTavern 适配层

### 7.1 适配层职责

`SillyTavernAdapter` 只允许用于管理员存在性诊断：

- 检查原版服务是否可用。
- 读取原版角色列表。
- 读取原版世界书列表。
- 读取原版设置列表，用于确认预设、指令预设、系统提示和上下文预设引用是否存在。
- 将缺失引用转换为管理员可理解的校验结果。

`SillyTavernAdapter` 不得创建或恢复聊天会话，不得调用生成接口，不得读取角色卡正文、世界书正文、提示词正文或密钥，不得拼接模型消息，不得返回剧情结果。

### 7.2 管理员只读调用规则

- 只调用当前 SillyTavern 已存在的只读或诊断接口。
- 保留现有会话、鉴权和 CSRF 机制。
- 不绕过安全检查，不在前端伪造内部权限。
- 接口路径、请求体和响应转换只能出现在适配层。
- 上游升级后先运行适配器契约测试，再允许发布管理员端。
- 原版支持的角色卡、世界书、预设、权重和上下文设置不得被定制层转换成不兼容语义。
- 管理员资源诊断只能读取列表类接口并做引用存在性核对。
- 故事入口可以绑定当前本地 SillyTavern 中真实存在的原版资源以便验证，但这只是引用绑定，不代表复制或创建同名资源正文。

### 7.3 玩家端原版聊天桥接层

`SillyTavernOriginalChatBridge` 是玩家端的独立薄桥接器。当前可算已验证的范围仅限原版聊天读写、目标角色/目标聊天绑定和目标聊天读回；其余能力必须按本文分级标注。它与管理员只读适配器位于同一共享适配层，但职责不同：

- 通过 `/api/characters/chats` 读取绑定角色的原版聊天列表。
- 通过 `/api/chats/get` 读取某个原版聊天文件。
- 通过 `/api/chats/save` 把玩家输入追加保存到原版聊天文件。
- 只把原版聊天消息转换成说话人、角色类型、文本和时间，供 Galgame 舞台展示。
- 可以从原版角色回复的可见文本中识别清晰标记的可选行动，并作为 `suggestedActions` 返回给玩家 UI；该字段只能用于按钮化快捷输入，不得决定分支、节点、结局或前端剧情状态。
- “开始游戏”优先读取故事入口绑定的 `chatSeedId` 作为原版开场聊天种子。
- 玩家首次从聊天种子提交输入时，应保存到新的原版聊天会话文件，避免改写种子本体。
- “继续”和“读取”读取绑定角色的最新原版聊天历史。
- 玩家提交输入后，若最新原版聊天仍以玩家消息结尾，玩家端必须显示“行动已记录、下一段暂时未接上”的恢复状态，暂停继续输入，并提供重新读取原版聊天的轻量操作。

它不得：

- 调用 `/api/backends/*/generate`、`/api/novelai/generate` 或任何底层模型生成接口。
- 读取 `/api/characters/get`、`/api/worldinfo/get` 或其他角色卡/世界书正文接口。
- 拼接角色卡、世界书、预设、系统提示或模型消息。
- 调用、复制或模拟原版前端 `Generate()`。
- 生成本地 AI 台词、固定剧情、固定选项、分支或结局。
- 把 `suggestedActions` 保存为前端剧情权威，或在没有原版文本依据时补造选项。

可见文本展示提取必须遵循 `docs/AI_GALGAME_FRONTEND_INTERACTION_AND_UI_SPEC.md` 中的 `galgame.presentation-extraction.v1`。该契约只允许从原版可见聊天文本中保守提取 `displayText`、`suggestedActions` 和 `speakerHints`。它不是 AI 故事响应协议，不要求模型输出结构化 JSON，不得参与 prompt、世界书、Arc、结局或任何剧情状态决策。识别失败时保留原文和自由输入。

当前聊天桥接层证明“原版聊天读写与自定义舞台展示”可用。2026-07-24 用户已明确批准一个等价的正式原版运行时桥接面：`external-modules/original-runtime-bridge/**`。

该外接桥接服务：

- 独立于 SillyTavern 后端运行，不挂载或修改原版后端路由。
- 在隔离浏览器进程中进入原版 SillyTavern 前端运行时。
- 选择故事入口绑定的原版角色和原版聊天。
- 调用原版运行时自己的生成函数继续当前聊天。
- 返回更新后的原版聊天快照给玩家端展示。
- 生成前后都以原版目标聊天文件读回为准：生成前确认目标聊天最后一条是玩家输入，并确认隐藏的原版运行时内存已经重新加载到同一条最后消息；生成后确认同一目标聊天新增角色回复。如果原版运行时跳到其他聊天、仍停在旧内存、目标文件未更新或只返回了文本字段，桥接必须返回失败。

玩家端只允许调用该桥的 HTTP 契约，不得 iframe 原版 UI，不得 import 原版 `public/script.js`，不得复制 `Generate()`，不得直接调用 `/api/backends/*/generate` 或 `/api/novelai/generate`。桥接失败时只能保留当前舞台、玩家输入和聊天上下文，显示重试/恢复状态，不播放本地固定剧情。

该桥默认只能监听 loopback 或本机等价通道；如需非本机访问，必须先有明确认证。CORS 只用于限制浏览器来源，不是认证。桥接请求必须绑定当前已发布入口或进行中旧存档 release 中允许的角色、group 和 chat；收到任意 `avatar + chatId` 不得直接触发生成。授权失败、release 不匹配、chat 不属于该 release 或角色/group 与 Arc 绑定不一致时，必须拒绝并返回可恢复错误。

桥接服务可以对原版模型上游的瞬时失败做有限次数内部重试，例如 429、500、502、503、504 或网络抖动。该重试不得复用到授权失败、目标聊天绑定失败、世界书不匹配或串聊天风险上；重试后仍必须按目标原版聊天文件读回验收。

聊天种子缺失或为空时，玩家端必须显示可恢复未就绪状态，不能显示“故事已经准备好”一类假成功文案，也不能播放前端固定开场。

玩家输入保存成功后，若配置了正式原版运行桥接服务，前端应显示“思考中”并请求桥接服务触发原版运行时续写；原版回复写回后自动刷新舞台。若桥接服务不可用或超时，前端应保留玩家刚提交的文本，显示可恢复状态，并允许稍后重试；它不得在此时补写本地 AI 回复。

桥接验收不得只检查 HTTP 返回文本。测试必须读回目标原版聊天文件并确认最新消息为角色回复，同时确认非目标聊天没有被误写、误推进或被返回字段伪装为目标聊天。

### 7.4 运行配置

模型、API、预设、上下文、权重和生成参数全部通过 SillyTavern 原版能力维护。管理员入口只保存引用名称或标识，并检查这些引用是否存在；玩家端不展示 `profileId`、运行配置或模型参数。

运行配置校验必须区分两个层级：

- **引用存在**：通过原版列表/设置接口证明角色、世界书、preset、instruct、system、context、chat seed 的名称或标识存在。
- **运行时已应用**：通过已批准的原版运行时桥接或原版正式接口，在生成前证明当前原版运行时实际使用了目标角色、目标聊天、目标世界书和目标预设。

当前已经验证的是角色/聊天的目标绑定和资源引用存在性。preset、instruct、system、context、worldbook、group 的“运行时已应用”若缺少正式等价入口，必须标为 `deferred/unbridged` 或 blocker，不得只靠管理员 UI 状态宣称通过。

## 8. AI 输出与剧情约束

定制层可以展示 AI 输出，但不得成为 AI 输出的语义权威。所有 AI 文本、选择、失败恢复和聊天状态必须来自 SillyTavern 原版运行机制。

玩家端允许把原版角色回复中已经写出的行动候选显示成按钮。按钮点击必须等价于玩家在自由输入框中输入同一行动文字，并走现有原版聊天保存与原版运行桥接流程。该展示适配不得读取角色卡或世界书正文，不得补写隐藏提示词，不得把按钮点击解释成前端分支。

当前版本的约束是：

- 玩家端不得绕过 SillyTavern 直接调用底层模型生成接口。
- 玩家端不得把模型输出解析成自建分支、结局、节点跳转或平行状态。
- 玩家端不得保存剧情状态、变量、关系、物品、节点或 `SceneResult`。
- 运行失败时不得播放本地固定剧情或固定选择。
- 媒体接口只能根据未来明确的原版聊天、插件或人工标记事件接入，不得从自建剧情结果中派生剧情权威。

## 9. 故事入口配置与发布接口

配置服务为独立外接模块。建议最低接口如下：

前端适配层只依赖本节接口，不直接改写 SillyTavern 后端，也不把发布索引写入原版 SillyTavern 配置。共享部署下，`ConfigReleaseStore` 负责在外接服务和本地缓存之间切换；玩家页面只读取“默认推荐作品”和“可游玩作品清单”。

故事入口配置保存的是“哪个游戏入口使用哪些原版资源，以及怎样以游戏方式呈现”。它不得成为角色卡、世界书、预设或权重的替代存储。

### 9.1 玩家只读接口

```http
GET /v1/releases/active
GET /v1/scenarios
GET /v1/story-entries/{entryId}/versions/{version}/manifest
GET /v1/story-entries/{entryId}/versions/{version}/assets/{assetPath}
```

`GET /v1/releases/active` 返回：

```json
{
  "releaseId": "rel_20260723_001",
  "scenarioId": "summer-memory",
  "scenarioVersion": "1.2.0",
  "publishedAt": "2026-07-23T12:00:00Z",
  "manifestUrl": "/v1/scenarios/summer-memory/versions/1.2.0/manifest",
  "contentHash": "sha256:...",
  "minimumPlayerVersion": "1.0.0"
}
```

`GET /v1/scenarios` 返回玩家可选择的已上架作品摘要。摘要只包含标题、版本、入口、封面、角色显示名和对应 release 引用；不得返回角色卡正文、世界书正文、提示词、密钥、模型设置或原始资源内容。

### 9.2 管理员接口

```http
POST /v1/admin/story-entries/import
POST /v1/admin/story-entries/{entryId}/versions/{version}/validate
GET  /v1/admin/scenarios
GET  /v1/admin/releases
POST /v1/admin/releases
POST /v1/admin/releases/{releaseId}/rollback
GET  /v1/admin/health
```

发布必须是原子操作：新版本完成校验后才替换当前发布。服务端保留最近成功版本以支持回滚。

管理员鉴权由配置服务或反向代理负责。静态前端不能承担真正的权限保护。

配置服务掉线时，玩家端可使用本地最近成功缓存；管理员端不得在外接服务已配置但发布失败时悄悄改用本地发布，以免产生“管理员以为已经上线，玩家实际不可见”的误判。

管理员视觉上传入口必须把安全 PNG 合同说清楚：仅接受 8 位、非隔行 RGB/RGBA PNG；palette/indexed PNG 被服务拒绝时只显示可理解的转换提示，不显示内部错误码、路径、hash 或凭据。

最小 `game-config-service` 外接模块支持通过 `GALGAME_ADMIN_TOKEN` 保护 `/v1/admin/**`。该 Token 只能存在于外接服务环境、反向代理或受控运维工具中，不能写入玩家端、管理端静态文件、localStorage、故事入口配置或提交文件。

### 9.3 AI 剧本整理助手

`external-modules/script-import-assistant/**` 是允许的外接导入服务。它只用于管理员上架前整理剧本包，不参与玩家游玩时的剧情生成。

管理员端默认可调用：

```http
GET  /v1/health
POST /v1/admin/script-import/drafts
POST /v1/admin/script-import/drafts/{draftId}/redeploy
POST /v1/admin/script-import/drafts/{draftId}/confirm
```

整理助手输出 `galgame.script-import-draft.v1` 草稿。确认后，它可以通过 SillyTavern 已有 API 创建或核对明确命名的原版角色、世界书和开场 chat seed，然后返回只含引用的 manifest。该 manifest 继续走现有配置服务或本地发布流程。

`/v1/admin/**` 必须默认拒绝未认证请求。整理服务只能在配置了有效 `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN`，或位于受信外部反向代理、独立 admin service、mTLS、受控本地会话等真实认证边界之后时，开放上传、草稿、重新整理、确认导入和原版资源写入能力。未配置有效 token 或外部认证边界时，服务必须拒绝管理员请求或拒绝启动管理员接口。CORS、隐藏 `/game-admin/`、隐藏按钮和前端路由守卫都不是认证。

安全细节必须 fail-closed：非法 `GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_EXPIRES_AT` 不得被当作无过期继续放行；`TRUST_EXTERNAL_AUTH` 布尔开关不是认证本身，非 loopback 暴露必须有代理/mTLS/身份证明；带 `Origin` 的管理员请求必须命中明确白名单，未配置白名单时拒绝跨来源管理员请求。

整理助手不得：

- 把 LLM 作为玩家剧情运行时。
- 定义 `SceneResult`、剧情节点、固定分支、固定结局或玩家运行时本地 scripted fallback。
- 在前端、manifest、localStorage、IndexedDB 或日志中写入 LLM key、ST key、角色卡正文、世界书正文或提示词正文。
- 静默覆盖已有原版资源；同名资源内容不一致必须失败。

若需要沿用 SillyTavern 使用的 LLM key，只能由外接服务端读取同一服务端密钥来源。前端只知道整理服务地址，不知道 key。

AA1 只允许实现服务端 LLM 配置状态与密钥边界，不代表真实 LLM 整理已经实现。真实 LLM 调用必须另行增加服务端 prompt、超时、脱敏日志、错误恢复和不泄密测试；在此之前草稿应保持 `usesLlm=false`。

未配置 LLM 时，整理服务可以提供“导入期确定性摘要/导入计划生成器”用于形成管理员草稿。该路径只能输出普通摘要、资源引用计划、风险提示和是否可确认；不得输出玩家对白、行动选项、剧情节点、结局、`SceneResult` 或 runtime story，不得写入玩家 manifest 正文或本地剧情状态，玩家 `/game/` 也不得调用它。静态架构审计必须把这种 import-only 路径与禁止的玩家本地 scripted fallback 分开分类。

## 10. 外部媒体接口

### 10.1 设计目标

游戏只依赖统一任务协议，不依赖具体生图软件、模型或工作流。后续更换实现时只新增或替换 `MediaProvider`。

后续最小 `media-gateway` 外接模块应实现同一协议的 mock provider，用于前端联调、幂等验证和失败降级测试。它不得被视为真实生图实现；接入用户后续生图软件时，只替换网关内部 provider，不改变玩家端协议。

媒体请求需要角色外观、世界书和当前剧情语境时，应从原版 SillyTavern 聊天、插件事件、导出摘要或人工标记中取得授权后的媒体提示摘要。玩家前端不从自建剧情状态派生媒体语义，不携带密钥，也不直接暴露完整世界书或提示词。

```ts
interface MediaProvider {
  healthCheck(signal?: AbortSignal): Promise<MediaHealth>;
  createJob(
    request: CreateMediaJobRequest,
    signal?: AbortSignal,
  ): Promise<MediaJob>;
  getJob(jobId: string, signal?: AbortSignal): Promise<MediaJob>;
  cancelJob?(jobId: string, signal?: AbortSignal): Promise<void>;
}
```

### 10.2 创建任务

```http
POST /v1/media/jobs
Content-Type: application/json
Idempotency-Key: <releaseId>:<chatId>:<messageIndex>:<mediaKind>:<sourceProofHash>:<styleId>
```

```json
{
  "protocolVersion": "galgame.media-job.v1",
  "idempotencyKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default",
  "releaseId": "rel_20260723_001",
  "scenarioId": "sillytavern-live-entry",
  "scenarioVersion": "2026.07.25",
  "arcId": "lucifer-arc1",
  "chatId": "galgame-imported-lucifer-seed",
  "messageIndex": 12,
  "mediaKind": "image",
  "triggerSource": "visible-chat-text",
  "sourceProof": {
    "sourceType": "visible-chat-text",
    "releaseId": "rel_20260723_001",
    "scenarioId": "sillytavern-live-entry",
    "scenarioVersion": "2026.07.25",
    "arcId": "lucifer-arc1",
    "chatId": "galgame-imported-lucifer-seed",
    "messageIndex": 12,
    "messageHash": "sha256:...",
    "createdAt": "2026-07-25T12:01:00Z"
  },
  "sceneSummary": "来自原版可见聊天文本的短场景摘要，最长 600 字符",
  "characterVisualRefs": ["visual:lucifer:anna", "visual:lucifer:black"],
  "styleId": "scenario_default",
  "timeoutMs": 120000
}
```

成功受理返回：

```json
{
  "protocolVersion": "galgame.media-job.v1",
  "requestId": "req_01",
  "job": {
    "protocolVersion": "galgame.media-job.v1",
    "jobId": "job_01",
    "idempotencyKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default",
    "status": "queued",
    "createdAt": "2026-07-25T12:01:00Z",
    "updatedAt": "2026-07-25T12:01:00Z",
    "retryCount": 0
  },
  "statusUrl": "/v1/media/jobs/job_01",
  "cancelUrl": "/v1/media/jobs/job_01/cancel",
  "retryAfterMs": 2000
}
```

### 10.3 查询任务

```http
GET /v1/media/jobs/{jobId}
```

处理中：

```json
{
  "protocolVersion": "galgame.media-job.v1",
  "jobId": "job_01",
  "idempotencyKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default",
  "status": "running",
  "createdAt": "2026-07-25T12:01:00Z",
  "updatedAt": "2026-07-25T12:01:05Z",
  "retryCount": 0
}
```

完成：

```json
{
  "protocolVersion": "galgame.media-job.v1",
  "jobId": "job_01",
  "idempotencyKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default",
  "status": "succeeded",
  "createdAt": "2026-07-25T12:01:00Z",
  "updatedAt": "2026-07-25T12:01:20Z",
  "retryCount": 0,
  "result": {
    "assets": [
      {
        "mediaId": "media_01",
        "mediaKind": "image",
        "url": "https://media.example/game/job_01.webp",
        "mimeType": "image/webp",
        "width": 1536,
        "height": 864,
        "sha256": "...",
        "cacheKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default"
      }
    ],
    "cache": []
  }
}
```

失败：

```json
{
  "protocolVersion": "galgame.media-job.v1",
  "jobId": "job_01",
  "idempotencyKey": "rel_20260723_001:chat_01:12:image:hash_01:scenario_default",
  "status": "failed",
  "createdAt": "2026-07-25T12:01:00Z",
  "updatedAt": "2026-07-25T12:01:30Z",
  "retryCount": 1,
  "error": {
    "code": "PROVIDER_FAILED",
    "safeMessage": "媒体暂时没有完成",
    "retryable": true,
    "providerTraceId": "trace_01"
  }
}
```

### 10.4 状态与重试

允许状态：

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `expired`

规则：

- 同一幂等键必须返回同一任务或同一结果。
- 可重试错误最多自动重试一次。
- 前端使用逐步延长的轮询间隔，页面隐藏时降低频率。
- 非阻塞任务超时后停止前台轮询，保留任务标识供下次恢复。
- `sceneSummary` 和 `characterVisualRefs` 都是不可信输入，网关必须防 HTML、URL、路径和命令注入。
- 输出 URL 只允许同源相对路径、受控媒体网关 URL 或短期签名 `https` URL；禁止 `file:`、`data:`、`javascript:`。
- 缓存键必须绑定 release/chat/message/mediaKind/sourceProof/styleId，且读取时校验 MIME、文件大小、路径归属和可选 `sha256`。

### 10.5 视频兼容

视频使用同一接口：

- `mediaKind` 改为 `video`
- 输出资产增加时长、帧率、编码等字段
- `result` 返回视频 URL、封面和时长

图片版客户端遇到不支持的媒体类型时使用事件中的降级资源。

## 11. 进度边界

### 11.1 首期策略

- 定制层不保存玩家剧情进度。
- 定制层不保存 SillyTavern 会话句柄、聊天片段、最近 AI 场景结果、节点、变量、关系或物品。
- “开始游戏”“继续游戏”“读取”都进入自定义 Galgame 舞台；继续与读取语义最终必须由 SillyTavern 原版聊天历史承担，定制层只保存必要显示状态。
- IndexedDB 只保存当前入口发布索引、入口 manifest、发布历史和媒体接口配置。

### 11.2 版本兼容

入口发布记录绑定 `releaseId`、`scenarioVersion` 和 `saveCompatibility`，仅用于管理员发布与回滚说明。玩家实际进行中的聊天版本和历史仍以 SillyTavern 原版数据为准。

## 12. 玩家端错误模型

统一错误类型：

| 错误码 | 玩家提示 | 默认处理 |
| --- | --- | --- |
| `RELEASE_UNAVAILABLE` | 当前游戏暂时无法开始 | 重试并使用最近成功发布 |
| `RUNTIME_OFFLINE` | 这一段暂时没接上 | 保留画面并允许重试或返回标题 |
| `ORIGINAL_RUNTIME_TIMEOUT` | 这一段暂时没接上 | 保留本次输入和画面上下文并后台记录 |
| `ORIGINAL_EMPTY_REPLY` | 这一段暂时没接上 | 移除原版目标聊天中的空白回复，保留玩家输入并允许重试 |
| `ORIGINAL_MESSAGE_UNAVAILABLE` | 这一段暂时没接上 | 不播放本地剧情，提示稍后重试 |
| `MEDIA_FAILED` | 不弹窗打断 | 使用降级资源 |
| `SAVE_FAILED` | 暂时无法保存 | 保留内存状态并再次尝试 |

管理员端可以查看更具体的错误码、发生时间、关联版本和请求标识，但不得记录完整提示词、密钥或不必要的玩家输入。

## 13. 安全与隐私

- 玩家端和管理员端不包含 AI 或媒体服务密钥。
- 管理员页面必须由反向代理或独立服务鉴权保护，仅隐藏 URL 不构成安全措施。
- 所有外部接口使用 HTTPS。
- 跨域访问采用明确来源白名单。
- 剧本资源路径必须防止目录穿越。
- 所有用户输入或外部返回文本在展示前进行安全转义。
- AI 输出按不可信数据处理，禁止直接注入 HTML。
- 媒体 URL 必须限制允许协议和来源。
- 日志默认不保存完整对话；需要诊断时采用可关闭、可脱敏的方式。
- 商业发布前应单独评估 SillyTavern AGPL-3.0 许可义务和所使用模型、素材的授权。

## 14. 性能与体验指标

- 标题画面可交互时间：本地资源场景目标不超过 2 秒。
- 对话推进响应：点击后 100 毫秒内出现视觉反馈。
- 场景切换：不因未完成生图永久阻塞。
- 首屏资源按需加载，下一场景背景和立绘提前预取。
- 大图使用适合显示尺寸的 WebP/AVIF，并保留降级格式。
- 移动端与桌面端都不出现文本遮挡、按钮溢出或横向滚动。
- 页面恢复前后台后，不能重复提交玩家行动。

## 15. 测试策略

### 15.1 单元测试

- 故事入口清单校验
- 固定台词、固定选项、固定跳转和固定结局拒绝校验
- `sillytavern-live` 拒绝 `initialVariables`、`initialRelationships` 和 `initialInventory`
- `interaction`、`runtimeRequirements`、`allowFreeInput` 和 `freeInputPrompt` 等旧运行时字段拒绝校验
- 入口发布缓存和回滚索引
- SillyTavern 只读适配器不得暴露生成、会话或资源正文读取能力
- 媒体任务状态转换与幂等键

### 15.2 契约测试

- SillyTavern 管理员只读适配器对当前版本列表/设置接口的请求与响应
- SillyTavern 玩家聊天桥接器对原版聊天列表、读取和保存接口的请求与响应
- 原版角色卡、世界书、预设和上下文配置引用的存在性校验
- 缺失原版资源引用阻止管理员发布
- 配置服务发布和回滚
- 媒体任务创建、轮询、失败和超时
- 资源 URL 与内容哈希

### 15.3 端到端测试

至少覆盖：

1. 管理员导入并发布一个有效故事入口。
2. 缺失原版资源引用时管理员发布被阻止，并展示缺失项。
3. 缺失或为空的 `chatSeedId` 被管理员资源诊断拒绝。
4. 玩家首次打开 `/game/` 只看到标题入口，不看到模型、API、提示词、角色卡、世界书、预设等术语。
5. 玩家端没有故事/场景管理入口，也没有管理员入口。
6. 点击开始、继续或读取后进入自定义 Galgame 舞台，不离开玩家路由。
7. 点击开始后读取绑定的原版聊天种子并显示其文本；若读取失败，只显示恢复状态，不显示本地固定剧情。
8. 配置正式原版运行桥接后，玩家提交输入会显示“思考中”，随后自动显示由同一目标原版聊天文件读回的角色回复；若原版运行时串到其他聊天，玩家端显示重试状态而不是接受结果。
9. 媒体服务离线时不影响入口加载和自定义舞台进入。
10. 管理员回滚只影响后续入口元数据，不改写原版聊天历史。
11. SillyTavern 连接异常时玩家只看到入口级恢复提示，不暴露技术细节。
12. 冻结边界检查确认未修改 `src/**`、`server.js`、`plugins.js`、原版 `public/index.html`、`public/script.js` 和 `public/style.css`。

### 15.4 视觉验收

在桌面、平板和常见手机尺寸检查：

- 标题、封面、角色视觉锚点和版本提示不互相遮挡
- 开始、继续、读取按钮在移动端不溢出
- 玩家端没有管理员入口、故事管理入口或原版技术术语
- 点击开始、继续、读取后进入自定义 Galgame 舞台，不默认跳转原版 UI
- 背景和角色展示资源比例正确，不发生意外裁切

## 16. 实施阶段

### 阶段 1：静态体验壳

- 玩家端标题、封面、角色视觉锚点和开始/继续/读取入口
- 建设最小舞台、对话框和输入区外观，但不接管剧情语义
- 验证零学习成本、自定义舞台进入和不跳转原版 UI

### 阶段 2：管理员只读资源校验

- 完成只读适配器和契约测试
- 校验角色卡、世界书、预设、系统提示和上下文配置引用是否存在
- 缺失引用时阻止发布

### 阶段 3：配置索引与媒体接口

- 入口发布、回滚和本地/共享配置索引
- 媒体接口幂等、超时、失败和回调协议
- 媒体语义只从原版聊天、插件事件或人工标记接入

### 阶段 4：视觉打磨与边界验收

- 日式标题页视觉、美术资产和移动端适配
- 玩家术语隔离、路由隔离和管理员入口隔离
- 冻结 SillyTavern 后端和原版前端边界验证

### 阶段 5：媒体接口

- `MediaProvider`、任务协议、轮询、缓存和降级
- 使用模拟服务完成契约测试，等待后续生图软件接入

### 阶段 6：打磨与交付

- 响应式适配、性能、可访问性和端到端测试
- 固化一个标准故事入口样板
- 形成部署与运营检查清单

## 17. 完成定义

一个功能只有同时满足以下条件才算完成：

- 玩家体验符合产品文档，不暴露底层概念。
- 管理员功能不进入玩家路由和菜单。
- SillyTavern 调用只存在于适配层。
- 原版角色卡、世界书、预设、权重和上下文功能没有被定制层改写或降级。
- 没有修改 SillyTavern 后端文件。
- 对应单元或契约测试通过。
- 网络失败、解析失败和媒体失败有明确降级。
- 桌面与移动端完成视觉检查。
- 新增协议或产品行为已同步更新两份基线文档。

## 18. 开发变更流程

开发任务开始前：

1. 判断需求属于玩家端、管理员端、适配层还是外接模块。
2. 检查是否触碰后端禁区。
3. 确认是否改变玩家零学习成本原则。
4. 确认是否需要更新剧本或媒体协议版本。

若任务要求修改 SillyTavern 后端，必须停止实施并向用户说明原因，获得明确书面授权后才能继续。不得以“实现更方便”为理由自行修改。
