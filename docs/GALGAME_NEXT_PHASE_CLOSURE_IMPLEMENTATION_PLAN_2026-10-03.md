# Galgame 下一阶段闭环开发计划

> 文档状态：下一阶段实施指导；代码尚未按本文执行。
> 编写日期：2026-10-03（Asia/Shanghai）
> 目标：让下一位开发者从当前未提交工作区开始，按明确顺序修复数据绑定、原版运行桥、身份投影与视觉资产闭环，并以可复现证据验收。
> 权威边界：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`。本文只细化实施顺序，不取代产品规范，也不授权发布、迁移活动 catalog、真实模型生成、进程关闭或 SillyTavern 后端修改。

## 1. 开发前先读与文档关系

必须先读：

1. `AGENTS.md`
2. `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
3. `docs/GALGAME_DESIGN_SPEC.md`
4. `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`
5. `docs/GALGAME_STABILITY_AND_HUD_DEVELOPMENT_2026-10-03.md`
6. `docs/GALGAME_STABILITY_ACCEPTANCE_2026-10-03.md`
7. `docs/GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md`
8. `docs/GALGAME_PRESENTATION_PROJECTION_IMPLEMENTATION_PLAYBOOK.md`
9. `docs/GALGAME_VISUAL_MATCHING_RECOVERY_DEVELOPMENT_SPEC.md`
10. `docs/GALGAME_HANDOFF_AUDIT_2026-10-03.md`

### 1.1 冲突裁决

| 主题 | 执行依据 | 本文裁决 |
|---|---|---|
| SillyTavern 数据、上下文与生成 | Native-first 规范 | ST 原生角色卡、世界书、预设、聊天与 `Generate()` 是唯一权威；自定义前端只呈现，桥接只委托原版运行时。 |
| 后端变更 | `AGENTS.md` Backend Freeze | 不改 `src/**`、`server.js`、`plugins.js`、原版路由/存储/认证/启动和原版前端。发现必须修改时停止该子项，提交具体阻塞说明。 |
| 身份/旁白/队伍 | Native-first + Identity Projection spec | annotation/projection 仍是 shadow；不能凭本文开启生产 gate。身份结果必须有原文证据、范围/hash 校验和未知安全行为。 |
| 剧情状态与 HUD | Native-first + Stability/HUD spec | 不创建平行剧情状态。HUD 只显示可见聊天中明确出现的最近记录，标明其非实时性质；不得推断消耗、增减或隐藏数据。 |
| 头像/背景资源 | Native-first + Visual Matching Recovery spec | 只用活动、校验通过的 catalog；旧 v1 缺少 character channel 时 fail closed。目标 catalog 先只读预览与校验，本文不批准激活或迁移。 |
| 自动复位与连接状态 | Stability spec + 当前实现审计 | 服务 health、Claude 探针、原版 `Generate()` 是三个不同层级。HTTP 200、上次成功、synthetic LLM probe 均不能单独证明真实剧情生成正常。 |
| 旧设计文档中的定制剧情循环 | Native-first 规范 | 如有冲突全部视为被取代；不得恢复 narrative gateway、`SceneResult` 游戏循环或本地固定剧情兜底。 |

如果实现发现本文与上表权威文档产生新冲突，先修订文档或按更高优先级规则执行；不得用代码悄悄绕过。

## 2. 当前继承状态（审计快照，不是永久事实）

以下状态来自 2026-10-03 对当前工作区、源码和本机只读端点的审计。后续开发开始前必须重新检查 git 状态、关键文件哈希和服务状态；不要把快照当成当前运行保证。

### 2.1 工作区与数据保护

- HEAD：`36f459666`（2026-10-01）。
- 最近检查：`git status --short --untracked-files=all` 为 **132 条变更路径**；大量未提交代码、测试、构建产物和新文档同时存在。
- 不得执行 `git reset`、`git clean`、批量覆盖、全量重建 public 输出或清理聊天/存档/素材目录。先生成变更清单，按任务建立文件所有权和基线哈希。
- 根目录存在 Workbuddy 原始材料；其中至少一份含凭证样式明文。不得复制、提交、粘贴或在日志中回显。后续如需处理，单独执行凭证轮换和受限清理流程，不属于本计划。
- 聊天、存档、角色卡、世界书、活动/草稿 catalog 与素材均为保留数据。本文任何阶段都不授权重置、迁移、删除或覆盖这些数据。

### 2.2 当前实现/验证的可信边界

- 最近一轮检查时，玩家页及 8790、8791、8795、8798、8801 端点均返回 HTTP 200；8795 当时报告 ready，上一条生成状态为 succeeded。该快照只表示探测瞬间；不能推导本轮 Claude、实际 SillyTavern `Generate()` 或图片显示已通过。
- 34 个 `*test.mjs` 测试文件中，已观察 90 个测试通过、0 个失败；部分 Windows symlink 检查因 `EPERM` 未执行。自动化测试不等于真实浏览器、真实模型或实际 catalog 资产验收。
- `normalizeVisualRuntimeMessage()` 已被直接探测出带 `characterIdentity` 的消息被拒绝；当前相关测试没有覆盖该字段穿过生产链。
- Bridge 产生的 `characterIdentity` 在下游会被适配器/规范化路径丢弃；player visual context 也存在丢字段节点。原始 SillyTavern chat 不应为此改写。
- 当前 `PRESENTATION_ANNOTATION_MODE='shadow'`，production gate 报告为空。它保持关闭是正确的安全状态，不能把“服务可用”视作语言/整剧本验收通过。
- 活动 catalog 快照为 v1（234 refs：scene 101、character 69、equipment 21、item 21、skill 22），没有 `characterChannels`。v1 下动态人物候选及部分明确头像绑定按当前校验逻辑 fail closed，显示中性占位属于预期安全降级，不等于匹配闭环。
- 背景生产链缺少已证实的 production `scene-continuity.v1` 投影生产者；没有证据时不能猜测切场。目标 catalog 与活动指针不同，不得直接切指针。
- 当前身份链还混淆/丢失消息作者与正文内角色说话人边界；`characterId` 使用数组下标的做法不适合作为稳定跨消息身份键。
- 继续游戏选择聊天的匹配条件只看 Arc，缺少 scenario 约束；当不同作品共享 Arc 标识时有串聊风险。
- 进程恢复存在 stale bridge 可能再启动占用同端口实例、并发恢复竞态、启动脚本只看 HTTP 200 等风险；须先保证恢复不会制造第二实例。
- HUD 提取当前可能使用完整 assistant 消息而非当前分页文本；保存的 `visualState` 目前有默认值/未消费路径；存储读取错误可能被折叠为“没有存档”。这些都应在独立代码阶段修复，不应顺手扩成剧情状态系统。

## 3. 目标和非目标

### 3.1 阶段目标

按优先级闭合以下生产链：

1. 恢复/继续只读写回确切 scenario、Arc 与 chat；不因连接问题选错聊天。
2. Reset 对 stale/并发进程恢复保持 single-flight、进程身份可验证、readiness 可信；无法确认时失败关闭并保留用户现场。
3. 修复原版消息到 UI 的身份字段链路，分清 ST 消息作者、正文 segment speaker 和角色实体；未验收前继续 shadow。
4. 确保活动 catalog 与视觉匹配能力声明一致；补齐安全 preview、channel gate、scene continuity 生产证据，拒绝随机头像/背景。
5. 将 HUD 与保存恢复限定在原版可见聊天和已允许的显示状态，不建立第二套玩法状态。
6. 通过源码审计、定向协议测试、构建产物一致性检查和真实 UI 验收分别证明各层，不用单个绿色 health 替代端到端验收。

### 3.2 明确不做

- 不改任何冻结的 SillyTavern 后端/原版前端文件。
- 不自动激活、发布或回滚 catalog；不运行素材导入/重建脚本。
- 不触发真实 Claude 剧情生成、真实媒体生成或改动玩家当前聊天；需要端到端验收时使用隔离测试 chat 并另行确认具体范围。
- 不把 annotation gate 从 shadow 改成 live，也不将新 roster 用作移除队员的权威来源，除非其独立 gate 已通过。
- 不加入特定剧本角色词表、标题正则、性别推断、固定动作映射或顺序选图兜底。
- 不清理工作区、提交代码、关闭服务/浏览器、改启动权限或轮换凭证。

## 4. 实施顺序与文件清单

每波必须先建立小范围基线（文件列表、关键状态/哈希、现有测试结果），完成后独立审查再进入下一波。开发者可因实测依赖调整细节，但必须记录理由和回归影响。

### Wave 0：冻结当前状态与秘密边界

**目的：** 让后续改动可追踪，并保护现存用户数据。

**主要位置：** `git status`、`git diff --name-status`、已有 handoff/audit 文档；不改用户数据。

**动作：**

1. 保存本轮开始的 132-path status 和关键源码/public 对应文件的 SHA-256；若数量变化，记录差异，不追求恢复到旧数量。
2. 将拟编辑文件分成 Wave 1–5 清单；未经所有权明确不得改写旁人的未提交变更。
3. 对凭证风险材料只记录“存在/隔离”，不得 cat、复制或在命令输出中显示 secret；不在此阶段删除文件。
4. 只读记录 active catalog id/revision/hash、control pointer、当前 chatId/scenarioId/arcId（敏感正文不记录）。

**退出门：** 数据位置、当前活动指针、可编辑文件范围已经写入阶段日志；没有执行清理、重置、发布或真实生成。

### Wave 1：聊天选择与恢复边界（P0）

**主要文件：**

- `frontend/shared/src/sillytavern-adapter.js`（重点核对 `pickLatestArcChat()`、`loadLatestBoundChat()`、`hasLatestBoundChat()` 及其调用）
- `frontend/shared/src/player-save.js`
- `frontend/player/src/main.js`（继续游戏、恢复、读档入口）
- 对应 `frontend/shared/tests/sillytavern-adapter.test.mjs`、`frontend/player/tests/chat-history-recovery.test.mjs`、`frontend/player/tests/runtime-regressions.test.mjs`

**实施要求：**

1. 自动恢复候选须以可验证的 `scenarioId + arcId` 过滤，并尽可能验证 character/seed/chat metadata；缺任何关键 scope 时不可把仅按 Arc 命中的聊天当成匹配。
2. 多个候选并列或 metadata 不足时返回显式 `ambiguous/unavailable`，保留手动精确 `chatId` 的读取；不自动改写错误自动槽。
3. 手动存档严格按 `chatId` 精确读取。当前发布默认值变化不改变已有保存的 scenario/version/Arc 绑定。
4. 区分“确实无保存数据”和 IndexedDB/adapter 读取失败；UI 保留恢复提示与现场，不把故障显示为空列表。
5. 给自动槽的替换规定单向条件：只有读回身份完整、scope 相符且内容更完整时才可更新；不因为请求失败清除既有指针。

**必测：** 同 Arc 不同 scenario；同 scenario 不同 Arc；Arc `default` 与空/缺失字段；重复候选；手动 chat 精确读回；读存储抛错；自动槽落后于完整原 chat；分支/swipe/delete 后投影失效。

**通过门：** 每个选择结果都能解释“为什么是这个 chat”；歧义绝不静默选择；回归证明旧保存仍绑定原 scenario/version/Arc。

### Wave 2：恢复监督与原版生成终态（P0）

**主要文件：**

- `external-modules/process-supervisor/server.mjs`、`shutdown-contract.mjs`、相关 `test.mjs`
- `external-modules/original-runtime-bridge/server.mjs`、`generation-lifecycle.mjs`、对应测试
- `Start_Galgame_All.ps1`、`Start_Galgame_All.bat`、相关启动脚本（只编辑自定义启动器）
- `frontend/shared/src/connection-health.js`、`process-supervisor-adapter.js`

**实施要求：**

1. 复位请求 single-flight；并发点击/多个页面不能重复 spawn 同一服务。保留 caller-visible request 状态且超时明确结束。
2. stale bridge 恢复须识别准确进程所有者、启动参数和项目根。只有确认可安全终止/替换时才执行；身份不可读、权限不足或所有者歧义时 fail closed，不以端口 PID 为终止授权。
3. 服务启动成功须读结构化 readiness；特别是 8795 不能把 HTTP 200 等同 `ready=true`，还须检查 `pending/stale/stopping`。presentation analyzer 的 8801 为 optional，不能阻止主游戏恢复，也不能冒充视觉验收。
4. 生成状态只在原版 `Generate()` 的完成/失败信号及准确目标 chat 的 readback 后定终态。新建空 assistant 占位及流式更新期间不可过早记作空回复；保留超时、取消、空终态、上游失败的脱敏分类。
5. 生成开始/结束前后校验 chat ID；生成中若活动 chat 发生歧义，停止对 UI 返回“成功”，不重标到另一个聊天。
6. 健康级别分开命名：服务可达、bridge ready、Claude API synthetic probe、原版真实生成。记录在诊断里，但不要记录 token、完整 prompt 或不必要正文。

**必测：** stale PID 可验证替换；PID/命令行/权限不可验证时不杀进程；两个并发 reset 只有一次启动；HTTP 200+`ready=false` 应判未就绪；可选 analyzer 离线仍恢复主游戏；placeholder 后填充、最终空回复、上游拒绝、超时、取消、切换 chat 等终态。

**通过门：** supervisor 与启动器 readiness 语义一致；真实 bridge restart 不发生 EADDRINUSE 重复 spawn；所有拒绝/歧义可解释且不破坏当前服务或聊天。

### Wave 3A：身份数据来源与传输合同（P1，单独于视觉识别）

**独立根因审计：** `docs/GALGAME_IDENTITY_DATAFLOW_AUDIT_2026-10-03.md`。

先处理桥接 identity 来源可靠性、bridge envelope 到 shared/player DTO 的传递、schema optional 字段校验。原版 raw chat 不必包含本项目新增的 `characterIdentity`；不得将缺少自定义字段误判成原版缺陷，也不得用当前角色索引给全部历史消息赋身份。

**主要文件：**

- `external-modules/original-runtime-bridge/server.mjs`
- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/src/visual-system-schema.js`
- 测试：`frontend/shared/tests/sillytavern-adapter.test.mjs`、`sillytavern-visible-chat.test.mjs`、`visual-system-schema.test.mjs`、`external-modules/original-runtime-bridge/test.mjs`

**通过门：** `messageAuthor`、`segmentSpeaker` 和稳定角色 identity 来源区分清楚；bridge envelope 准确对齐原文 chat/message；每个 DTO 显式保留或拒绝字段并有理由；原版 rawChat 不变。此门通过只代表身份数据传输正确，不代表角色识别/视觉匹配通过。

### Wave 3B：语义身份投影与分页呈现（P1，生产仍 shadow）

**主要文件：**

- `frontend/shared/src/visual-system-schema.js`
- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/src/presentation-annotation.js`、`presentation-projection.js`、`presentation-cache.js`、`presentation-gate.js`
- `frontend/player/src/main.js`、`presentation-renderer.js`
- `external-modules/original-runtime-bridge/server.mjs`（仅桥接输出，不改 ST 原始数据）
- 测试：`frontend/shared/tests/visual-system-schema.test.mjs`、`sillytavern-visible-chat.test.mjs`、`presentation-*.test.mjs`、`frontend/player/tests/presentation-renderer.test.mjs`

**实施要求：**

1. Wave 3A 的身份传输合同通过后，再建立带版本的窄呈现 DTO；明确区分 `messageAuthor`（ST 消息作者）与 `segmentSpeaker`（正文内对白说话者）、`characterIdentity`（经验证的稳定实体标识）。不可用数组下标作为持久角色 ID；未经源数据证实不得伪造 stable ID。
2. schema 只接收明确列出的字段并对 identity 做类型/长度/来源/版本校验；合法 optional identity 不得被过滤成整条消息 `null`。未知/冲突身份必须可表达为 unknown，而非旁白。
3. identity 必须从桥接归一化、shared adapter、分页/visible-chat normalizer、player context 到 renderer 全链路保留，并证明与正确原文 segment 对齐；绝不把投影写回原始 chat。
4. cache key 必须绑定 chat、scenario/release、Arc、message/page 与原文 hash、作者标记和 catalog scope。编辑、swipe、删除、分支或 scope 变化立刻失效；重算期间先 unknown-safe。
5. 跨页延续遵循证据：如果分页截断时仍在同一角色的对话块中，只能以合格 annotation/可校验相邻 span 延续；完整引号结束只可作为辅助证据，不得升为通用硬规则。多角色一屏可轮播头像的实现必须限定在被确认 speaker 集合内；下一页若延续前一角色则单头像稳定显示，不再轮播。
6. 玩家“你”与旁白、未知角色分别建模；旁白/system 用中性符号占位，不把玩家 avatar 或任意女性角色当旁白。新角色缺资源时呈现未知占位，不借用已占用头像。
7. annotation 保持 shadow。增加跨语言、整剧本留出 gold set 和报告；在产品 gate 有独立审查之前禁止生产切换。

**必测：** identity 穿过生产正常化所有边界；identity 缺失/畸形；ST 作者与正文 speaker 不同；新角色、玩家、旁白、无引号对白、跨页引号/无引号续句、多说话人、长段落分页、缓存失效、roster partial/complete 语义、conflict/unknown。必须含未参与规则开发的整剧本留出集，避免只测训练案例。

**通过门：** DTO / adapter / renderer 的真实调用链证据完整，gold report 达到单独定义的语言及剧本阈值；本文阶段完成前，production gate 仍为 shadow。要启用生产行为须另有明确授权与验收记录。

### Wave 4：视觉 catalog 与场景连续性闭环（P1）

**主要文件：**

- `external-modules/visual-asset-service/server.mjs`
- `external-modules/visual-asset-service/player-catalog-manifest.json`
- `external-modules/visual-asset-service/rebuild-player-catalog.mjs`
- `frontend/shared/src/visual-system-schema.js`
- `frontend/player/src/main.js`
- `frontend/tools/curated-asset-batch.mjs`
- 对应 visual asset/catalog/scene continuity 测试

**实施要求：**

1. 先只读验证活动指针、catalog schema、每个 ref 的文件 hash/尺寸/channel、default assets 和 rollback 指针；确认 manifest 不会静默混入未批准资源。
2. 目标 v2 清单必须明列完整 refs 与 `characterChannels`，用 hash 绑定用途 `character|player|narrator|system`。Narrator/system 仍为中性内置图标；动态 character 候选仅来自 `character` channel；player 只能使用明确 player 资源。
3. v1 catalog 缺少角色用途映射时继续 fail closed。修复显式头像绑定的校验路径时不得放宽成任意 catalog ref；旧引用需有明确兼容策略和内容校验。
4. 不随机、不按目录顺序、不借用已绑定角色头像。候选不唯一、语义不足、分析器失败时使用未知占位并给非敏感原因码。
5. 背景消费通过 hash/span/scope 校验的 `scene-continuity.v1`：`changed` + 唯一合格资源才能换；changed 无匹配则回到当前 scope 默认背景；`continued` 保留；`unknown`/校验失败保留已验证背景。chat/release/arc/catalog scope 变化先清旧 scene identity 并回到新 scope 默认图。
6. annotation service 是否 ready 与 annotation 是否被生产使用分别诊断。无真正 production provider/证据时保持 shadow，不把 service health 作为背景已能智能切换的证明。
7. 目录 migration/rebuild/publish 与代码修复分开。只有 read-only preview 通过、数据备份/事务和 rollback 验证、另行获得发布授权后才能改活动指针；本计划不执行该步骤。

**必测：** v1 fail closed；显式 asset hash/尺寸/用途 mismatch；唯一/并列/零候选；角色唯一绑定与不可复用；scope 切换；changed/continued/unknown；文本 hash 错误；UTF-16 span 错误；transition 无唯一背景时回默认；图片 load error；catalog pointer race/rollback contract（仅隔离 fixture，不操作活动数据）。

**通过门：** 先证明源目录和活动 catalog 决策正确，再证明前端收到并实际渲染决策；真实浏览器只读检查当前活动版本。本文不把 target catalog 发布作为通过条件，也不声称未发布资源已生效。

### Wave 5：HUD、保存显示状态和布局回归（P2）

**主要文件：**

- `frontend/player/src/visible-hud-records.js`
- `frontend/player/src/main.js`
- `frontend/shared/src/player-save.js`
- `frontend/player/src/styles.css`
- `frontend/player/tests/visible-hud-records.test.mjs`、`chat-history-recovery.test.mjs`、`runtime-regressions.test.mjs`

**实施要求：**

1. 若 UI 按页播放，HUD 只消费本页/当前可见 span 之前已出现的原文；不能因整条 assistant message 已下载就提前显示后续页物品/状态。
2. HUD 记录显示“最近聊天记录”/等义非实时标签；区分 equipment、inventory、skill；只有明确文本提供的值才能呈现。显式空集合只清除同 scope 的旧显示记录，不产生消耗/装备变化的推断。
3. save 中只存可恢复的展示偏好/绑定状态。对 `visualState` 明确选定策略：从当前聊天重算，或保存经过 schema/scope 验证的最小 presentation snapshot；不得保存或恢复第二套剧情、背包、关系、队伍权威状态。
4. 读取失败与确实无记录分开；重开/重置/切场景时显示待恢复或未知，不用默认状态覆盖源聊天。
5. 修复移动端 icon/media 覆盖规则，分别检查桌面和窄屏的头像尺寸、滚动、HUD 抽屉、按钮可达性及页面缩放。

**必测：** 当前页与后续页 HUD 截断；explicit empty；partial/complete roster 不影响 HUD 规则；save roundtrip；旧 save 无 visualState；无效 scope；存储 unavailable 与 empty；桌面 1280px 以上、移动 390px 与 760px 边界。

**通过门：** 重载、继续、读手动存档后显示状态与同一原版聊天一致；存储故障可辨识；无额外剧情状态产生；桌面/移动回归通过。

## 5. 构建产物与变更纪律

1. `frontend/**` 是源码权威；`public/game/**` 与 `public/game-admin/**` 是构建输出。先审计 build 脚本输入/输出清单及当前 public 差异，不得全量无差别覆盖。
2. 每波只构建与改动相关的目标；build 后比较 source、public 对应文件 hash/导入路径，并运行 architecture audit。确认构建不会写入原版 SillyTavern UI 或无关 public 文件。
3. 把 generated changes 和手工改动分开记录；不删除现有 output 作为“清理”。如果覆盖输出产生不能解释的差异，停止并恢复本波之前可验证备份。
4. 代码测试由实施任务明确执行；本计划文档本身不宣称测试通过，也不要求为文档重复跑整个套件。
5. 一次只收口一个 wave；每波记录：改动路径、根因、协议影响、测试输入/结果、静态构建 hash、未通过点及是否需要授权。

## 6. 总验收矩阵与放行条件

| 层级 | 放行证据 | 不足以放行的证据 |
|---|---|---|
| 源码/边界 | 冻结文件无改动；调用链与版本 DTO 可追踪；cache/scope 失效正确 | 仅文档声明、仅静态 grep、HTTP 200 |
| 单元/契约 | 每波指定正反例全部通过，关键失败关闭路径覆盖 | 只通过旧测试或手工 happy path |
| 构建/产物 | player/admin 构建成功；预期输出清单和源码一致；原版 UI 未被修改 | “构建成功”但 public 文件未核对 |
| 数据安全 | 当前 chatId、scenario/version/Arc 和 catalog pointer 未变；无 delete/reset/migration | 页面可打开、端口在线 |
| 真实 UI | 桌面与移动端视觉检查；现有聊天只读呈现；图片与说话人绑定可解释 | 测试 harness、模拟 provider、占位图被误判成功 |
| 真实 Generate | 需另选隔离 chat；生成前/中/后同一 chatId；原版 Generate 完成信号；非空 assistant 读回；实际 provider/model 的非敏感运行证据 | `/health`、synthetic Claude probe、lastGeneration 上次成功、HTTP 200 |
| 视觉生产验收 | 当前活动 catalog 的唯一有效身份/场景资产实际加载；切 scope 和无候选符合 fallback | target manifest 有资源、analyzerConfigured、单条 fixture pass |
| 泛化 gate | 未参与规则构建的整剧本+语言留出数据报告，独立 reviewer 给出明确阈值结论 | 同一案例反复调参后的 golden test |

P0 与真实 UI/Generate 相关 gate 通过，只能称为“核心连接与原版生成链闭环”。本文覆盖的代码与界面功能闭环还须满足 Wave 1–5 中适用的验收项和视觉生产验收；annotation 切换到 live、catalog 发布/迁移仍是独立 gate，不得因核心链通过而自动放行。

## 7. 推荐下一位开发者的直接执行清单

1. 阅读第 1 节列出的十份文件，确认没有更新版本；重新记下 worktree status、HEAD、关键哈希和活动指针。
2. 保持活动 chat、存档、角色卡和 catalog 不动；不要运行清理/重建/导入/启动或真实生成操作。
3. 先做 Wave 1：修复跨 scenario/Arc 聊天选择与数据读取错误语义；完成定向测试和独立审查。
4. 再做 Wave 2：实现可验证的 stale bridge recovery、single-flight reset、结构化 readiness 和原版生成终态判定。
5. 再做 Wave 3：修复身份 DTO 全链路与分页边界，但继续保持 annotation shadow；不能将 identity 变化部署到当前玩家页面，直到 source-to-public 对照、gate 和 UI 验收独立通过。
6. 做 Wave 4 read-only catalog/continuity 修复和测试；活动 catalog 指针保持不变。若必须发布，先停止并单独列出需要用户授权的具体动作及回滚方案。
7. 做 Wave 5 HUD/save/layout，然后逐 wave 跑测试、build 和桌面/移动 UI 检查。
8. 最后单独请求隔离测试回合用于真实 Claude + SillyTavern Generate；没有用户明确提供安全测试 chat/回合时，先完成其余只读与自动化阶段，不操作当前剧情。
9. 独立审计通过后交付：变更清单、每层证据、仍关闭的 gate、活动指针/用户数据未改声明、后续明确授权项。

## 8. 本文审核记录

本文是实施顺序与当前已知风险的汇总，不重复定义已有详细协议。独立只读审阅须核对：

- 是否与 `AGENTS.md` 和三份基线规范冲突；
- 是否错误地把 shadow、target catalog 或测试通过写成 production ready；
- 是否遗失 handoff 中的数据风险与真实运行边界；
- 各 wave 是否具备确定的文件范围、正反测试和停止条件；
- 是否对真实生成、活动 catalog 发布、后端修改或清理赋予了不当授权。

审阅结论和修订应追加于本节，记录审阅者、结论（PASS/FAIL/INSUFFICIENT EVIDENCE）、日期、具体问题与处理，不得只写“已审计”。

<!-- Independent review result will be appended here after the document-only audit. -->

### 独立审阅记录（2026-10-03）

- **审阅范围：** 与 `AGENTS.md`、三份基线规范、稳定性/HUD 文档、身份投影文档、视觉恢复文档及交接审计的冲突与授权边界。
- **首轮结论：** FAIL。发现“核心生成链通过即可称完整产品闭环”与视觉验收仍独立未过的口径冲突。
- **修订：** 已将放行措辞拆分为“核心连接与原版生成链闭环”及“整体 Galgame 功能闭环”，并明确 annotation live 与 catalog 发布/迁移仍需独立放行。
- **边界复核：** 后端冻结、shadow gate、未知安全回退、活动 catalog 不自动切换、用户聊天/存档不清理、真实生成不在本文授权范围等条款符合权威规范。
- **终版复核：** 独立审阅者确认 PASS；修订后不再存在把核心运行通过等同于整体功能完成的放行口径冲突。
- **审阅范围限制：** 该结论是文档一致性审计，不代表代码实施、真实 UI、真实 Generate 或 catalog 发布验收通过。
