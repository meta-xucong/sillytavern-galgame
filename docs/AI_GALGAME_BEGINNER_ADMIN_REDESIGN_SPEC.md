# AI Galgame 管理端小白化改造开发文档

> 文档状态：正式业务代码落地前准入材料 v1.0  
> 生效日期：2026-07-26  
> 上位规则：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`  
> 关联文档：`docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`、`docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`、`docs/AI_GALGAME_ADAPTIVE_PRESENTATION_SPEC.md`

## 1. 目标

把 `/game-admin/` 从工程配置台改造成非技术人员也能使用的故事上架工作台。

目标体验：

- 管理员打开后台后，先看到“现在玩家会玩到什么”“这个故事能不能上架”“下一步该点哪里”。
- 默认流程不出现 JSON 编辑器、接口路径、schema、runtime、proof、ArcBinding、worldbook 等工程概念。
- 原版 SillyTavern 的角色、世界设定、聊天、生成、上下文能力仍是权威；管理端只做引用、检查、发布和友好说明。
- 自研附加功能放在独立的“演出增强”卡片区，不和原版已有能力混在一起。
- 高级诊断保留，但收进“高级检查”，不作为日常主路径。

一句话原则：

**管理端默认像作品上架工具，底层仍套用原版 SillyTavern，不重复开发原版资源管理器。**

## 2. 当前问题

现有 `/game-admin/` 已经具备发布、回滚、Arc 选择、原版资源引用检查、展示模板和媒体接口配置，但界面语言和信息结构偏工程化：

- 导航项如“故事入口”“幕章发布”“原版资源”“系统状态”对非技术用户不够直观。
- “选择 JSON”“入口 JSON”“引用格式完整”“运行时应用未桥接”等文案会让小白误以为需要理解程序。
- 原版资源诊断、展示模板、媒体接口、发布回滚放在同一层级，主次不清。
- 资源引用、实时诊断、运行状态的细节过早暴露，增加学习成本。
- 自研展示功能和原版资源检查混在相邻页签里，容易误解成我们在重做 SillyTavern 原版能力。

因此本轮改造不是增加更多配置，而是：

- 默认路径减法。
- 文案游戏化和运营化。
- 原版能力只包装，不复制。
- 自研附加能力单独归类。

## 3. 硬边界

### 3.1 不能做

本改造不得：

- 修改 `src/**`、`server.js`、`plugins.js`、`config.yaml`。
- 修改原版 `public/index.html`、`public/script.js`、`public/style.css`。
- 在管理端编辑或保存角色卡正文、世界书正文、prompt 正文、context 正文、API key、模型密钥。
- 复制原版资源管理器、模型设置页、世界书编辑器、预设编辑器。
- 把 Arc、章节、展示模板做成前端剧情节点、路线、结局或变量系统。
- 恢复 narrative-gateway、NarrativeRuntime、SceneResult、continueSession、本地固定剧情或本地选项。
- 把未桥接功能放成可点击按钮，例如 regenerate、undo、swipe、group、native Quick Reply。

### 3.2 可以做

本改造可以：

- 用友好语言展示当前发布、故事是否可玩、缺什么、下一步怎么补。
- 通过既有共享适配层读取原版资源存在性和原版聊天种子状态。
- 发布或回滚已有 `ActiveRelease`，但不改原版聊天历史。
- 把原版资源引用包装为“角色资料”“世界设定”“开场记录”“运行风格”这类小白文案。
- 把自研展示模板、媒体接口、素材配置放在独立“演出增强”区。
- 保留高级检查页，让技术用户查看诊断和原始错误摘要。
- 保留隐藏的开发导入入口，但默认不展示大段 JSON 编辑器。

### 3.3 安全与路由隔离

小白化只改变管理端信息架构，不等于提供认证。

必须写入后续代码准入：

- `/game/` 与 `/game-admin/` 必须保持独立路由、独立导航和独立前端入口。
- 玩家端 `/game/` 不得出现后台入口、管理链接、导入入口、发布入口、回滚入口或高级检查入口。
- `/game-admin/` 中把高级导入、原始 JSON、发布、回滚或诊断入口折叠/隐藏，只是降低误触，不是访问控制。
- 真实管理员访问控制必须由外部服务、反向代理、独立 admin service、部署层会话或等价机制提供。
- 所有导入、发布、回滚、高级检查、媒体测试和原版资源诊断接口都必须遵守同一管理员访问控制边界。
- 前端代码、静态 `public/game-admin/**` 产物、manifest、localStorage、IndexedDB、截图证据和日志不得保存 API key、模型密钥、管理员 token、bridge proof secret、媒体 provider 密钥或任何长期凭据。
- 管理员 token 不得通过构建变量写入静态页面；如需管理员凭据，只能由外部 admin service、反向代理或运行时安全 cookie/header 处理。
- 开发导入入口即使放进“高级检查”，也必须被同等保护；不能因为入口默认不显示就允许未认证访问。
- CORS、隐藏按钮、前端路由守卫、CSS 隐藏、构建时不展示，都不是认证。

若当前部署没有真实管理员认证，本项目只能声明“小白化 UI 可用”，不得声明“管理后台已安全上线”。

## 4. 信息架构

默认管理端改为 4 个一级区块。

| 一级区块 | 给小白看的名称 | 目的 | 默认是否显示工程细节 |
| --- | --- | --- | --- |
| 工作台 | 今天上架什么 | 看当前玩家入口、健康状态和下一步操作 | 否 |
| 上架故事 | 选择故事并发布 | 通过向导完成导入、检查、发布 | 否 |
| 作品库 | 已准备的故事 | 查看故事卡、章节、最近发布记录 | 否 |
| 演出增强 | 画面与显示增强 | 管理自研媒体、展示模板、素材表现 | 否 |
| 高级检查 | 高级检查 | 技术诊断、原版引用、原始导入 | 是，折叠且非主路径 |

默认路由建议：

```text
/game-admin/
  工作台
  上架故事
  作品库
  演出增强
  高级检查
```

现有页签迁移：

| 现有页签 | 新位置 | 新默认文案 | 处理 |
| --- | --- | --- | --- |
| 当前发布 | 工作台 + 作品库 | 当前玩家入口 | 保留能力，换成卡片摘要 |
| 故事入口 | 上架故事的高级导入 | 导入故事文件 | JSON 编辑器默认隐藏 |
| 幕章发布 | 上架故事第 3 步 + 作品库详情 | 选择章节 | 简化为章节卡 |
| 展示模板 | 演出增强 | 游戏界面样式 | 自研能力单独卡片 |
| 原版资源 | 高级检查 | 原版资源检查 | 默认只显示小白检查结果 |
| 媒体接口 | 演出增强 | 图片/视频接口 | 自研能力单独卡片 |
| 系统状态 | 高级检查 | 服务检查 | 默认仅显示“可用/需处理” |

## 5. 默认工作台

工作台是打开管理端后第一个看到的页面。

### 5.1 页面结构

```text
┌─────────────────────────────────────────────┐
│ 当前玩家会进入                             │
│ Dungeon Master · Fighter Campaign          │
│ 状态：可以游玩                             │
│ [预览玩家页面] [上架新故事] [恢复上个版本]  │
└─────────────────────────────────────────────┘

┌──────────────┬──────────────┬──────────────┐
│ 故事检查     │ 运行通道     │ 演出增强     │
│ 全部就绪     │ 可生成回复   │ 图片未启用   │
│ [查看]       │ [查看]       │ [设置]       │
└──────────────┴──────────────┴──────────────┘

┌─────────────────────────────────────────────┐
│ 下一步建议                                  │
│ 1. 想换故事：点击“上架新故事”。             │
│ 2. 想调画面：进入“演出增强”。               │
│ 3. 出现红色问题：按提示去原版补齐后重试。   │
└─────────────────────────────────────────────┘
```

### 5.2 状态文案

| 状态 | 小白文案 | 管理动作 |
| --- | --- | --- |
| 全部通过 | 可以游玩 | 可预览或继续管理 |
| 缺角色引用 | 缺少角色资料 | 去原版补齐角色后重新检查 |
| 缺世界设定 | 缺少世界设定 | 去原版补齐世界设定后重新检查 |
| 缺开场记录 | 缺少开场记录 | 导入或创建原版开场聊天 |
| 桥接离线 | 回复通道未准备好 | 启动外接运行桥后重试 |
| 媒体未启用 | 图片/视频未启用 | 不阻止故事上架 |
| 未桥接高级项 | 高级运行项未自动切换 | 只提示，不宣称已应用 |

主工作台禁止显示：

- JSON
- API path
- token
- proof
- stack trace
- raw manifest
- 角色卡正文
- 世界书正文
- prompt/context 正文

## 6. 上架故事向导

上架故事改为一步一步的向导，而不是直接让用户编辑 JSON。

### 6.1 第一步：选择故事

默认显示：

- `选择已准备好的故事包`
- `载入内置示例`
- `从原版已存在资源创建入口`

高级入口折叠显示：

- `导入开发文件 JSON`
- `查看入口原始内容`

规则：

- 如果故事包里只有引用，管理端保存引用。
- 如果故事包需要导入角色卡/世界设定，必须走已有 SillyTavern API 或原版导入流程。
- 管理端不得把角色卡正文或世界书正文存进前端 manifest。
- JSON 编辑器只属于高级导入，不是默认操作。

### 6.2 第二步：自动检查

检查结果用清单展示：

```text
故事检查
[通过] 角色资料已找到
[通过] 世界设定已找到
[通过] 开场记录已找到
[提醒] 运行风格引用已找到，是否实际自动切换仍待桥接
[通过] 回复通道可用
```

检查分类：

| 检查项 | 友好名称 | 实际含义 |
| --- | --- | --- |
| character reference | 角色资料 | 原版角色存在 |
| worldbook reference | 世界设定 | 原版 world info 名称存在 |
| chat seed | 开场记录 | 原版聊天种子存在且可读 |
| bridge proof | 回复通道 | 已发布 release/chat 可签发 proof |
| runtimeApplied | 实际启用证明 | 仅有证据时显示已验证，否则显示待桥接 |
| media health | 图片/视频接口 | 自研媒体服务健康 |

发布阻断：

- 角色资料缺失。
- 世界设定缺失，且该故事声明必须使用。
- 开场记录缺失。
- 目标原版聊天读回失败。
- 当前 release/Arc/chat 不能签发合法 bridge proof。

不阻断但提示：

- 图片/视频接口未启用。
- preset/instruct/system/context runtimeApplied 未桥接。
- 展示模板未配置，使用默认样式。

### 6.3 第三步：选择章节和界面样式

默认使用章节卡：

```text
章节
[可发布] 第一幕  地下世界与相遇
[可发布] 第二幕  真实亲密
[可发布] 第三幕  搬入与家庭
[可发布] 第四幕  面对 Ingrid
```

用户可做：

- 选择当前要让玩家进入的章节。
- 选择界面样式：自动、视觉小说、RPG、恋爱、推理、经营、沙盒。
- 查看每个章节是否有开场记录。

用户不可做：

- 编辑剧情节点。
- 编写固定选项。
- 设置结局条件。
- 修改原版世界书权重细节。

### 6.4 第四步：发布

发布页只显示：

- 作品名。
- 将要发布的章节。
- 检查结果。
- 会影响谁：新玩家进入新版本，旧存档仍走旧记录。

按钮：

- `发布给玩家`
- `先预览`
- `返回修改`

发布成功文案：

```text
已上架。新玩家会进入这个故事；已有存档不会被改动。
```

发布失败文案：

```text
还不能上架。请先处理红色项目，再重新检查。
```

## 7. 作品库

作品库用卡片管理故事，不把 manifest 当主界面。

故事卡显示：

- 标题。
- 当前章节。
- 是否可玩。
- 最近上架时间。
- 最近检查结果。
- `查看详情`、`上架这个故事`、`恢复到这个版本`。

详情页显示：

- 章节列表。
- 每个章节的开场记录状态。
- 展示样式。
- 最近发布记录。
- 高级检查折叠入口。

禁止：

- 在作品卡里显示 raw releaseId、raw chatId、raw JSON。
- 把 `ArcBindingV1`、`SillyTavernBindingsV1` 作为小白文案展示。

## 8. 演出增强

所有自研附加功能统一放在这里，避免和原版功能重复。

### 8.1 卡片列表

| 卡片 | 能力来源 | 是否原版重复 | 默认文案 |
| --- | --- | --- | --- |
| 游戏界面样式 | 自研展示 profile | 否 | 选择玩家界面显示哪些信息栏 |
| 图片/视频接口 | 自研媒体 gateway | 否 | 接入外部生图或视频程序 |
| 背景和立绘 | 自研显示映射 | 否 | 只影响画面，不改剧情 |
| 内容提示 | 自研发布元数据 | 否 | 给玩家显示简单内容提示 |
| 服务检查 | 自研健康摘要 | 否 | 看当前后台是否准备好 |

这些卡片不能：

- 编辑角色卡正文。
- 编辑世界书正文。
- 编辑预设或模型参数。
- 直接生成剧情文本。
- 保存 HP、好感、背包、任务、线索等模块值。

### 8.2 游戏界面样式

小白文案：

- `自动识别`
- `文字冒险`
- `RPG 冒险`
- `恋爱互动`
- `推理调查`
- `经营模拟`

说明：

```text
这里只决定玩家页面怎样显示。具体数值和剧情仍来自原版聊天内容。
```

### 8.3 图片/视频接口

小白文案：

- `未启用`
- `已连接`
- `连接失败`
- `发送测试画面`

说明：

```text
图片和视频只增强画面。接口失败时，故事文字仍会继续。
```

密钥和 provider 配置不得进入静态管理端。需要密钥时，管理端只提示“请在外部媒体服务中配置”。

## 9. 高级检查

高级检查只给维护人员使用，默认折叠或放在最后。

包含：

- 原版资源引用详情。
- 运行桥接健康。
- 目标聊天读回。
- 发布历史详情。
- 原始 manifest 查看。
- 开发导入 JSON。

高级页允许出现技术词，但必须满足：

- 不展示角色卡正文、世界书正文、prompt/context 正文、密钥。
- 不允许编辑原版资源正文。
- 每一项都标清 `引用存在` 与 `实际启用证明` 的差异。
- 未桥接能力显示“未接入”，不显示“可用”。
- 高级检查入口必须遵守第 3.3 节安全边界；默认折叠不代表认证。

示例文案：

| 技术事实 | 高级页文案 |
| --- | --- |
| referenceExists passed | 引用存在 |
| runtimeApplied verified | 已验证本次运行使用 |
| runtimeApplied deferred | 尚未接入自动验证 |
| target chat readback passed | 目标记录读回正常 |
| bridge proof rejected | 当前发布授权不匹配 |

## 10. 友好文案字典

默认小白模式使用以下词汇。

| 工程词 | 小白词 |
| --- | --- |
| scenario / manifest | 故事 |
| release | 上架版本 |
| publish | 上架 |
| rollback | 恢复上个版本 |
| Arc | 章节 |
| character card | 角色资料 |
| worldbook / world info | 世界设定 |
| chat seed | 开场记录 |
| runtime bridge | 回复通道 |
| resource diagnostic | 故事检查 |
| adaptive presentation | 界面样式 |
| media gateway | 图片/视频接口 |
| referenceExists | 已找到 |
| runtimeApplied | 已在运行中验证 |
| deferred/unbridged | 暂未接入 |

默认小白模式禁止直接出现：

- JSON
- schema
- manifest
- ArcBinding
- SillyTavernBindings
- proof
- token
- endpoint
- stack
- runtimeApplied
- referenceExists
- worldbook
- prompt
- context
- preset

例外：

- 高级检查页可以出现受控技术词。
- 文档和测试可出现技术词。
- 管理端代码中的 id 和 data 属性不属于可见文案，但不能泄漏到默认 UI。

## 11. 数据与协议

### 11.1 不新增原版平行模型

本改造不新增角色、世界设定、预设、聊天、生成语义的数据模型。管理端只读取和发布已有 `StoryEntryManifest`、`ArcBindingV1`、`ActiveRelease`、`adaptivePresentationProfiles` 和媒体配置。

### 11.2 允许的 UI 状态

可以新增管理端本地 UI 状态，但只用于界面恢复：

```ts
interface BeginnerAdminUiStateV1 {
  protocolVersion: "galgame.beginner-admin-ui-state.v1";
  lastPage: "dashboard" | "publish-wizard" | "library" | "enhancements" | "advanced-check";
  wizardStep?: "choose-story" | "check" | "chapter-style" | "publish";
  selectedScenarioId?: string;
  selectedArcId?: string;
  expandedAdvancedSections?: string[];
  updatedAt: string;
}
```

禁止字段：

- 角色卡正文。
- 世界书正文。
- prompt/context 正文。
- API key/token。
- 剧情节点、路线、结局。
- HP、好感、背包、任务、线索、资源等模块值。

### 11.3 导入规则

故事导入只允许三种形态：

1. 引用式故事包：只包含原版资源引用和展示配置。
2. 原版资源导入工具：通过已有 SillyTavern API 写入原版资源，前端只记录引用。
3. 高级 JSON 导入：给开发者使用，默认隐藏。

任何故事包如果携带角色卡正文或世界书正文：

- 只能交给原版导入流程或已有 importer 工具。
- 不得把正文保存在 player/admin manifest 或静态 public 产物。

## 12. 代码落地批次

本阶段只写文档和审查，不开始业务 UI 代码。审查通过后按以下批次执行。

### BA0 文档准入与审查

范围：

- `docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md`
- `docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md`
- `docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md`
- `docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md`
- `.codex-longrun/**`

验收：

- 文档结构、风险词、冻结边界、状态校验通过。
- 独立审查员 PASS。
- 不改 `frontend/**`、`public/**`、`external-modules/**`。

### BA1 源码审计与信息架构骨架

范围：

- `frontend/admin/src/index.html`
- `frontend/admin/src/main.js`
- `frontend/admin/src/styles.css`
- `public/game-admin/**` 构建输出

目标：

- 新增小白模式路由和导航。
- 默认首页改为工作台。
- 高级检查保留旧能力但收纳。
- 不改变发布、回滚、诊断适配契约。

验收：

- 源码先跑 static architecture audit。
- 修改后重建 `public/game-admin`。
- 管理端默认 DOM 不出现禁止技术词和 raw JSON 编辑器。
- 高级检查页仍能进入原版资源诊断。

### BA2 上架故事向导

范围：

- 管理端 UI 与已有 releaseStore / protocol / adapter 调用。

目标：

- 用四步向导替代默认 JSON 编辑。
- 导入开发文件入口移动到高级区。
- 自动检查以友好清单显示。
- 缺资源阻止发布。

验收：

- 完整引用可发布。
- 缺角色、缺世界设定、缺开场记录被拒绝。
- JSON 编辑器不在默认页面。
- 发布失败不替换 active release。

### BA3 作品库与回滚小白化

目标：

- release history 改成作品卡/版本卡。
- 回滚文案改成“恢复到这个版本”。
- 旧存档绑定旧 release 的说明保留。

验收：

- admin publish/rollback smoke 仍通过。
- 旧存档绑定测试仍通过。
- 不改原版聊天。

### BA4 演出增强独立卡片

目标：

- 展示模板、图片/视频接口、背景立绘映射、内容提示统一放入“演出增强”。
- 每张卡明确“只影响显示，不改剧情”。

验收：

- adaptive profile 测试仍通过。
- media config 不保存密钥到静态前端。
- 玩家端展示不受影响。

### BA5 高级检查与证据

目标：

- 原版资源、桥接、系统状态整合为高级检查。
- `引用存在` 与 `运行中验证` 分级准确。
- 未桥接高级项保持“暂未接入”。

验收：

- runtimeApplied 只对有证据项显示已验证。
- preset/instruct/system/context 仍保持 deferred/unbridged。
- 静态架构审计、DOM smoke、浏览器 smoke、冻结边界通过。

## 13. 验收矩阵

| 验收项 | 命令/脚本 | 输出证据 | 通过标准 |
| --- | --- | --- | --- |
| 文档覆盖度 | `rg -n "小白|工作台|上架故事|作品库|演出增强|高级检查|原版能力|不重复开发|JSON|自研附加|no-button/no-claim|deferred/unbridged" docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md` | `.codex-longrun/evidence/beginner-admin-doc-coverage.txt` | 必备章节和边界命中 |
| 文档风险扫描 | `rg -n "复制角色卡|复制世界书|编辑角色卡正文|编辑世界书正文|固定剧情|剧情节点|结局条件|runtimeApplied|referenceExists|JSON|worldbook|prompt|preset" docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md` | `.codex-longrun/evidence/beginner-admin-risk-scan.txt` | 命中均为禁止、收纳、高级页或 deferred 语境 |
| 管理端安全覆盖度 | `rg -n "隐藏.*不是认证|反向代理|独立 admin service|管理员访问控制|API key|模型密钥|管理员 token|localStorage|玩家端.*后台入口|/game/.* /game-admin/" docs/AI_GALGAME_BEGINNER_ADMIN_REDESIGN_SPEC.md docs/AI_GALGAME_FRONTEND_UI_IMPLEMENTATION_SPEC.md docs/AI_GALGAME_IMPLEMENTATION_BACKLOG.md docs/AI_GALGAME_PRE_IMPLEMENTATION_MATERIALS.md` | `.codex-longrun/evidence/beginner-admin-security-coverage.txt` | 路由隔离、隐藏非认证、真实 auth、凭据边界、开发导入保护均有命中 |
| docs-only 边界 | `git diff --name-only -- frontend public/game public/game-admin external-modules` | `.codex-longrun/evidence/beginner-admin-custom-code-boundary.txt` | BA0 阶段输出为空 |
| 冻结边界 | `git diff --name-only -- src server.js plugins.js config.yaml public/index.html public/script.js public/style.css package.json package-lock.json` | `.codex-longrun/evidence/frozen-boundary.txt` | 输出为空 |
| 状态校验 | `python "%USERPROFILE%\\.codex\\skills\\long-running-task\\scripts\\validate_state.py" --project .` | `.codex-longrun/evidence/state-validation.txt` | state JSON 合法 |
| 静态架构审计 | `node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules --evidence .codex-longrun/evidence/code-architecture-audit.json` | `.codex-longrun/evidence/code-architecture-audit.json` | `prohibitedActive=0`、`needsReview=0`、`failedChecks=[]` |
| 管理端小白 DOM smoke | `node frontend/tools/admin-beginner-smoke.mjs --base-url http://127.0.0.1:8001 --evidence .codex-longrun/evidence/admin-beginner-smoke.json` | `.codex-longrun/evidence/admin-beginner-smoke.json` | 默认工作台无 raw JSON、无禁止技术词、主按钮可用 |
| 管理端发布回滚 | `node frontend/tools/admin-release-rollback-smoke.mjs --evidence .codex-longrun/evidence/admin-release-rollback.json` | `.codex-longrun/evidence/admin-release-rollback.json` | 完整引用可发布，缺失引用拒绝，回滚不改原版聊天 |
| 桌面/移动浏览器 | `node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001` | `.codex-longrun/evidence/beginner-admin-browser-smoke.json` | 管理端桌面/移动可读，无布局溢出 |

如果 `admin-beginner-smoke.mjs` 尚不存在，BA1 必须先实现该 smoke 入口；不能用普通浏览器 smoke 替代“小白默认路径无技术词”的专门验收。

## 14. 审查员准入问题

交给审查员时必须回答：

1. 文档是否严格保持 native-first，没有把管理端改造成原版资源管理器复制品？
2. 默认小白路径是否隐藏 raw JSON、schema、接口、proof、runtime 等工程细节？
3. 自研附加功能是否单独放在“演出增强”卡片区，且没有和原版角色/世界/预设管理重复？
4. 高级检查是否只是诊断和开发入口，不会误导小白日常使用？
5. 发布、回滚、缺失资源阻断和旧存档绑定是否仍基于已有原版引用与 release 机制？
6. 文档是否明确了 BA1 之前必须先跑静态架构审计和 docs-only/frozen-boundary 检查？
7. 未桥接能力是否继续 no-button/no-claim？
8. 文档是否明确隐藏管理入口不是认证，并要求外部服务、反向代理或独立 admin service 保护所有导入、发布、回滚和高级检查接口？
9. 文档是否禁止把 API key、模型密钥、管理员 token、bridge proof secret 或 provider 密钥写入前端、静态产物、manifest、localStorage 或日志？

审查员通过后，下一轮才能开始 BA1。审查员若发现边界冲突，应先修改文档，不得直接落业务代码。

## 15. 完成定义

本改造最终完成时，管理员应该可以：

1. 打开后台，立即知道当前玩家会玩到哪个故事。
2. 点“上架新故事”，按向导完成选择、检查、章节样式和发布。
3. 看到红色缺项时，知道去原版补齐哪类材料，而不是读技术错误。
4. 用“演出增强”管理图片/视频接口和显示风格，并理解这不改变剧情。
5. 需要时进入“高级检查”查看诊断，但日常不必理解原版工程细节。
6. 在有真实外部管理员访问控制的部署中使用后台；如果只隐藏入口，不能宣称后台已经安全。

同时必须保持：

- 原版 SillyTavern 继续负责角色、世界设定、预设、上下文、聊天和生成语义。
- 管理端只做入口发布、引用检查和展示增强。
- 玩家端体验不暴露管理入口。
- 后台访问控制依赖外部服务、反向代理或独立 admin service，而不是隐藏按钮或前端路由。
- 冻结后端和原版前端不变。
