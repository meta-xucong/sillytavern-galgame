# 酒馆 Galgame 项目交接与现状审计

**审计日期：** 2026-10-03（Asia/Shanghai） <br>
**用途：** 交给下一位开发者继续处理；本文件是工作区状态报告，不代表代码已提交或正式验收。 <br>
**审计范围：** 当前 dirty working tree、最近提交、Workbuddy 三份分析文档、相关运行桥/可视化/进程监督代码与现有验收记录。

## 1. 接手前先读的边界

1. 首先阅读 `AGENTS.md` 和 `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`；该规范优先于旧设计文档。SillyTavern 原版后端是角色卡、世界书、上下文、聊天和 Generate 语义的权威；自定义层只做呈现和薄桥接。
2. 冻结后端边界：未经用户对具体后端变更的明确授权，不改 `src/**`、`server.js`、`plugins.js`、原版后端路由/中间件/存储，也不改原版 `public/index.html`、`public/script.js`、`public/style.css`。
3. 不删除、重置、迁移或覆盖任何聊天、存档、角色卡、世界书或素材。不要因为工作区很脏而运行清理、checkout、reset、批量重建或部署命令。
4. `frontend/**` 是自定义前端源；`public/game/**` 与 `public/game-admin/**` 是构建产物。不要盲目重建或复制覆盖 public 输出，先确认源/产物逐文件差异和可恢复备份。
5. 真实模型、视觉生成和媒体生成均未由本次交接审计触发。运行状态证据仅是上一轮会话观察值，不等于现在仍在线，也不等于新鲜的 Claude 端到端验收。

## 2. 最近一次工作：隐藏启动窗与一键关闭

上一轮“继续”聚焦于用户要求的隐藏 CMD 窗口和主页一键关闭：

- 收紧关闭流程的 allowlist：只匹配严格形态的 CMD `/c` 启动、允许的 `.bat`、包装器 sentinel 与项目根工作目录；路径文本提及、附加参数、其他 checkout 等负例应拒绝。
- 修复监听端口误判“已关闭”的风险：固定端口只用于发现需要识别的服务，不把端口 PID 直接作为终止目标。进程所有者未知、查询失败或权限不足时返回 `failed/ambiguous`，按 fail-closed 处理；只有通过严格匹配并持有身份句柄的进程才允许进入终止路径。
- 更新 `external-modules/process-supervisor/README.md`，说明端口用途和关闭限制。
- 定向验证记录：`node external-modules/process-supervisor/test.mjs` 通过；PowerShell 解析和 `git diff --check` 通过；独立审计对上述边界给出 PASS。此前一次只读预览遇到服务 PID 的 `Win32_Process` 字段为空和 `OpenProcess/PEB` `ERROR_ACCESS_DENIED`，因此正确结果是拒绝关闭，而不是声称已停。
- 通过现有进程监督器执行过恢复检查；上一轮观察到 8790 健康端点正常，核心服务恢复响应为 running，8801 presentation 服务 ready/configured。浏览器停留在主页，按钮可见；UI 曾显示“关闭未获确认，页面保持开启”。这只证明关闭未获确认，**没有证明一键关闭成功**。
- 没有终止真实服务、关闭浏览器、改写聊天/存档或触发模型/媒体生成。

**仍未闭环：** 管理器与服务进程权限不一致时无法识别所有者，不能安全终止。不要简单以管理员身份运行一个无鉴权的 loopback supervisor：Origin 检查是 CSRF 防护，不是身份认证。优先统一当前用户权限并验证；若必须提升权限，另行设计有认证/窄权限的 broker，并单独审计威胁模型。

## 3. 近期工作区改动总览

最近提交记录到 2026-10-01 的 `36f459666 fix: recover player content on connection reset`。当前 `git status --short --untracked-files=all` 为 **116 个变更路径**；其中 tracked diff 约 59 个文件、约 +6,999 / -824 行，另有大量新文件。具体计数会因交接报告加入工作区再增加一项。全部仍是未提交工作；不要把“工作区有代码”当成“发布或已验收”。

| 改动组 | 主要位置 | 当前判断 |
|---|---|---|
| 连接恢复与关闭 | `external-modules/process-supervisor/**`、启动 `.cmd/.bat/.ps1`、`frontend/shared/src/process-supervisor-adapter.js`、player UI | 已加入主页复位/关闭入口、监督服务、恢复与受限关闭契约。关闭有 fail-closed 路径；真实一键关闭尚未成功验证。 |
| 原版运行桥与 Claude | `external-modules/original-runtime-bridge/server.mjs` 及测试/README | 桥接仍委托原版 SillyTavern 运行时；当前代码从 `data/default-user/OpenAI Settings/Default.json` 读取 provider，Claude 时应用 Claude 模型/代理设定。需核实该 JSON 与 UI 实际设置一致；不能仅凭配置推断下一次请求已到 Claude。 |
| 说话人、身份与队伍投影 | `frontend/shared/src/presentation-*`、`frontend/player/src/presentation-renderer.js`、`external-modules/presentation-analysis-service/**`、两份 presentation 规范/手册 | 增加带原文证据的 annotation、身份/roster projection、缓存和渲染合同，但生产仍处于 shadow，gate allowlist 为空；新版不能被描述成已经接管生产分类。 |
| 头像/背景资源目录 | `external-modules/visual-asset-service/**`、catalog manifest、导入/迁移脚本及视觉测试 | 加入分类、hash 校验、发布/回滚以及语义候选路径；活动目录覆盖并不等于所有 refs 都有 ready 语义分析。任何目录迁移都需先只读预览和审核。 |
| 前端/协议/构建产物 | `frontend/player/**`、`frontend/shared/**`、`frontend/admin/**`、`public/game/**`、`public/game-admin/**` | player/admin 共享协议和连接恢复逻辑有改动；public 是产物，需与源文件对应审计，不能只看其中一份。 |
| 文档和外部分析 | `docs/**`、根目录 Workbuddy 分析文档 | 有新规范、实施手册、历史计划/分析；优先服从最新版 native-first 规范，旧文档可能描述已废弃架构。Workbuddy 原始材料不应直接转发（密钥风险见下文）。 |

工作区还存在多项旧计划、验收手册、视觉 runtime 记录及多个外部服务。新接手者应先以 `git status`、`git diff --name-status`、关键模块调用链和文档版本建立冻结清单，不要一次性“整理脏文件”或重写架构。

## 4. Workbuddy 分析逐项审计

结论标签：**正确** = 当前代码/运行证据支持；**部分成立** = 方向有依据但表述过度或缺少证明；**错误/过时** = 与当前实现冲突；**未证实** = 不能据此执行修复。

| Workbuddy 主张 | 审计结论 | 精炼后的可信结论 / 后续动作 |
|---|---|---|
| D1：启动会被 `Read-Host` 卡住 | 部分成立 | `StartGalgameVisualAnalyzerTest.ps1` 在专用 analyzer 测试启动路径中会交互式读密钥；普通全栈启动绕过该脚本并可用 legacy 模式，不是所有启动都会卡。可改为显式 `-Interactive`；非交互缺配置时明确失败。 |
| D2：没有进程监督器 | 过时 | `process-supervisor` 已存在，且上一轮任务调度器启动/健康检查有记录。仍需在目标机器确认任务是否持久启用、重启后生命周期和服务异常恢复；不要再按“缺监督器”重建一套。 |
| D3：硬编码其他项目路径 | 正确，已在后续迭代处理 | 启动路径改为默认读取仓库根目录的私有 `.env.local`，并支持显式环境变量覆盖；不得把本地 provider 凭据提交到 Git。 |
| D4：provider 名称映射不一致 | 正确 | 启动脚本将 `aiself-openai-compatible` 映射为 `openai-compatible`，分析服务按另一个名字 allowlist。当前是适配 workaround，未证明它导致生成故障。建立单一 provider alias/normalization 合同并测试各启动入口。 |
| D5：bridge proof secret 缺失时继续启动 | 正确 | `Start_Galgame_All.ps1` 读取 `.codex-longrun/galgame-bridge-proof-secret.txt`，当前代码缺失时只告警并继续、传空值。应 fail fast 或明确将依赖 proof 的功能标为不可用；检查本机 ACL，不输出 secret。 |
| LLM 报告声称已经确认唯一根因为凭证/分组，且已由真实上游请求修复 | 未证实 | 现有报告文本不能替代本次可复现证据；本轮没有访问 token、没有发上游请求、没有做新的真实 Claude 剧情生成。不能把该说法写成已解决根因。 |
| `ORIGINAL_EMPTY_REPLY` 就是上游 4xx | 未证实，且实现有竞态风险 | bridge 监测到新空 assistant 后会立即判 empty 并清尾部空消息；如果原版运行时先创建空占位、随后才流式写入，轮询可能误判。也可能是真正空回复或上游失败，现有状态分类不能证明是 4xx。应围绕原版生成完成/失败信号判定终态，保留脱敏错误分类，并增加“占位后填充、最终空回复、上游失败”测试。不要因此杀进程或盲改 ST `settings.json`。 |
| D6：runtime analyzer 未配置导致视觉一律 unknown | 部分成立、影响被夸大 | 常规启动显式清空某些 analyzer token，但 player 仍带 visible context 请求，系统有 manifest/显式绑定等确定性回退；不能断言所有都 unknown。缺少健康状态对 analyzer 是否配置/最近失败的安全诊断。补 boolean 状态与受限 fallback 测试。 |
| D7：精确 code overlap 造成无法匹配 | 部分成立、P2 | 有精确交集评分，但还叠加 taxonomy、显式绑定和上下文 fallback；不是唯一路径，也未证明它是当前头像缺失根因。若改进，优先版本化同义词/父类映射和跨剧本 golden 数据集，不加题材专属正则或任意模糊选图。 |
| D8：目录统计 285 项，只有 119 ready | 统计口径混了历史/非活动 refs | 按本次审计读取到的活动 catalog 快照：234 refs（场景101、人物69、装备21、道具21、技能22），状态 119 ready、80 unavailable、35 failed；115 个活动 ref 没有 ready 分析。该数字不是当前实时服务状态，也不等于素材不能显示，但会降低语义召回。优先重新采样并诊断 35 个 failed，再提高场景/人物覆盖率；先不批量生成素材。 |
| D9：catalog migration 没执行、导致运行不正常 | 前半句不能从指针证明，因果未证实 | 观察到活动指针仍是 `catalog_simple_ce914e3ceb54@1`，而不是迁移目标 `galgame_player_catalog_20261002@1`。这只证明当前指针，不证明迁移历史或服务故障。先检查目标完整性、迁移 gate 和回滚，再只读 preview；不可盲目切换。 |
| D10：缺少 analyzer observability 和 fallback | 部分成立 | visual health 没完整报告 runtime analyzer readiness；match 响应已有 `usesLlm/understandingStatus/errorCode`，且显式绑定/投影回退存在。应补安全的配置/最近状态诊断和“无唯一候选”原因，不要按顺序随机挑图。 |
| R1：各服务 health 路径不一致 | 正确但低优先级 | 当前确有 `/health` 与 `/v1/health` 差异；调用方知道各自路径，未证明造成异常。统一 probe registry/文档即可，不需要改 SillyTavern 后端路由。 |
| R2：启动没有依赖顺序 | 部分成立 | PowerShell 总启动器有固定启动顺序，但主要依赖固定延时后轮询；cmd 启动路径 readiness gate 弱。可加每个依赖的就绪探针和超时/错误归因，presentation 分析服务保持 optional。 |
| R3：8000 端口双绑定必然冲突 | 当前证据不支持 | 曾观察到 Node 绑定 `127.0.0.1:8000`、Docker 服务 `:::8000`，本机 `/` 和 `/game/` 都返回 200；不能将其报告为当前异常根因。若复现，按地址族/监听 PID/实际请求路径抓现场。 |

## 5. 当前仍存在的高优先级风险与建议

### P0：交接与密钥卫生

- `GALGAME_LLM_DISCONNECT_FIX_20261003.md` 原始 Workbuddy 材料包含凭证样式的明文 secret。不要把该文件原样发给同事、贴到工单或提交 Git；它应视作已暴露。若凭证仍有效，凭证所有者应立即轮换，并审计其可访问范围/使用记录。报告不复述 secret。
- 根目录还有两份 Workbuddy 原始分析文档。转交时使用本报告中审计后的摘要；交接包不得包含带凭证文件。
- dirty tree 没有提交基线，不要通过 reset/clean 来“弄干净”。先做本地备份/冻结清单，按功能拆分后逐块 review。

### P1：原版 Generate 桥接诊断

- 复现一条隔离测试回合，确认聊天 ID 在生成前、生成中、生成后都一致；只接受原版 Generate 实际写回目标聊天的非空回复。
- 记录非敏感字段：request id、provider/model（只从本次运行时读值取证）、耗时、终态、HTTP 状态/错误类别、是否出现空占位及填充时间。不要记录 token、完整 prompt 或不必要正文。
- 修复 empty placeholder 与流式更新的竞态；只有原版生成终态已确认后才能判 `ORIGINAL_EMPTY_REPLY`。分别测试成功、超时、上游拒绝、空终态、切换 chat 和中途取消。
- 生成相关的 timeout、视觉服务的 readiness、LLM health 是不同诊断，不要把“端口健康”或“上次 succeeded”当成本轮 Claude 已通。

### P1：说话人、人物和队伍状态投影

- 当前通用 annotation/projection 新链路是 shadow，`PRESENTATION_GATE_REPORTS` 为空；生产仍不能宣称使用它替代旧分类。短期继续保留原文，不把陌生/证据不足的对白强行归成旁白。
- 按最新版规范建立按语言、整剧本留出的 gold set，覆盖新角色、嵌入式对白、跨屏续句、无引号对白、旁白、同名角色、编辑/swipe/分支变化。由独立审计确认 source evidence、hash/cache invalidation 和 unknown-safe 行为后，逐语言放行。
- 新的 roster projection 首期只做 roster；HP、装备、背包等状态仍必须来自原版聊天/明确绑定，不要把部分快照误当完整列表，partial 不能删除成员。

### P1：视觉 catalog 与背景/头像

- 当前活动 refs 中 35 个分析失败，另 80 个不可用/无 ready 元数据；对定位缺图先分别检查 catalog 用途频道、asset 内容/尺寸/hash、显式绑定、匹配证据和浏览器实际加载，不要先加更多图片或随机 fallback。
- 分析服务 health 需给出不含 secret 的配置布尔值和最近错误类别。建立以同一个 active catalog hash 为边界的状态/匹配诊断。
- 当前活动 catalog 指针不是计划迁移目标。核验目标 catalog 的用途映射、hash、内容和 rollback，preview 通过后才由获授权管理员决定是否发布；现有素材、旧 catalog 与用户数据均保留。
- 背景应只在经过文本证据/hash 校验的 `scene-continuity.v1=changed` 时切换；`continued` 保留，`unknown` 不猜测，changed 且无唯一资源回默认背景。

### P1：关闭功能权限边界

- 严格 allowlist 与 PID 查询拒绝路径方向正确，但当前用户级监督服务可能无权识别另一权限级的进程，导致不能关闭并保持页面开启。真实关闭成功未验收。
- 优先保证所有启动进程同用户/同权限；如果仍需提升，先设计最小操作集合、身份认证、重放防护、操作审计及故障恢复，再单独实施。仅靠 loopback 和 Origin 不构成授权。
- 不要把固定端口 PID 作为 `taskkill` 目标，不要在任务运行或生成 pending 时关闭桥。

### P2：启动配置一致性

- 收敛 `aiself-openai-compatible` / `openai-compatible` 等 alias；provider 规范化应集中、有契约测试，并诊断“配置读取值”和“本次 Generate 实际生效值”是否一致。
- 启动脚本通过私有 `.env.local` 或显式环境变量读取 provider 配置，并对 proof secret 缺失 fail fast/降级可见化。
- 启动服务由固定 sleep 改成逐项 ready probe；超时指出具体依赖，避免主页只给笼统“部分异常”。

## 6. 推荐接手顺序与验收

1. **冻结现场**：保存 `git status --short --untracked-files=all`、`git diff --name-status`、当前 HEAD、服务健康和活动 catalog 指针；为 dirty tree 做可恢复副本，排除含 secret 的 Workbuddy 文件。
2. **确认设备/运行状态**：核对远程设备在线、主页、8790/8791/8795/8798/8801 状态；每项标注采集时间。若设备 offline 就停止运行修改，不宣称 live fix。
3. **先审桥接根因**：静态审计 Claude 设置读取、目标 chat 锁定、原版 Generate 结束信号与空 assistant 删除时机；本地 mock/契约测试覆盖竞态。之后在明确授权且有单独测试聊天的条件下做一次真实 Claude 生成，保留聊天数据。
4. **再审投影生产门禁**：检查 shadow mode/gate，不因某个截图直接启用；准备语言/整剧本 gold set 和独立审计。
5. **再查视觉匹配链**：固定 active catalog hash，先查失败分析/绑定，再做只读 migration preview；需要 UI 验收时检查背景与人物头像实际 DOM/src，不以 API 200 代替可视呈现。
6. **最后验证进程生命周期**：先同权限重启/复位验证；关闭用 dry-run/preview 证明目标集合，再在非生成状态验证用户点击后的确认流程。实际关闭前确保页面能给出确认且不丢数据。
7. 所有改动按小主题独立审计、运行对应测试、复核后端冻结路径；只有接受的新变更都通过且证据与同一工作树版本绑定，才可交付或另行提交。提交、推送、部署需要用户另行指示。

## 7. 证据与未验证事项

- 本轮工作区检查采样（2026-10-03，写报告前）：116 dirty paths；最近提交截至 `36f459666`（2026-10-01）；`git diff --check` 曾通过但输出包含仓库 CRLF 转换提示。该数是当时快照；加入本报告后路径数增加，接手时需重新采样。
- 上一轮定向过程监督测试、PowerShell parse 和独立审计有 PASS 记录；该 PASS 只覆盖 shutdown allowlist/监督器相关快照，不是 116 个文件的总体验收。
- presentation 实施手册记录前端/shared、分析服务、监督器和视觉资源测试通过，以及最终静态审计通过；同一手册也明确：生产 annotation 仍 shadow、allowlist 为空、真实 provider 未配置/未验、整语言/整剧本 gate 未通过。因此“测试通过”不能扩大成生产分类已解决。
- 未在本交接回合发起新的 LLM、Claude、图像或视频请求；未执行 catalog migration；未成功确认一键关闭；未清理或提交 dirty tree。
- 上一轮观察的健康端点与桥最近一次成功状态是历史快照，不能替代本报告交付时重新采样。
- 另一只读审计 agent 对本报告给出 PASS，未发现必须修改的错误句子或规范冲突；当前界面未提供其实际模型/effort 的独立运行时元数据，因此该复审不作为 profile-qualified formal acceptance，也不能替代接手后的代码与现场复核。

## 8. 建议给下一位同事的首句任务

“从当前 dirty working tree 开始，禁止 reset/clean 和任何数据迁移。先核对本报告第 1 节边界、冻结当前工作树并检查 secret 文件；然后按第 6 节顺序审计 Claude Generate 终态/空回复竞态。只做可回滚的最小修复和测试，保留聊天、存档、目录与用户素材。生产说话人 annotation 保持 shadow，除非完整语言 gate 独立通过。”

## 9. 2026-10-04 后续复核与状态更正

本节是 10 月 4 日的后续状态；前文“未执行 catalog migration”等句子准确描述 10 月 3 日取证时的状态，不应覆盖成当时已经迁移。

### 文本稳定性（只改设置和聊天正文，未改源代码）

- 活动聊天正文已清理：移除重复短语污染、英文重复注入的合成 user turn 和孤立 thought-only assistant turn；保留真实玩家动作和后续剧情。对其余 assistant 正文剥离了旧的 thought 标记内容。
- 当前聊天 JSONL 有 470 条有效消息（471 行含元数据），结构校验通过；没有遗留 `[thinking]`、`[/thinking]`、`<thinking>`、`<ant_thinking>` 或 `[analysis]` 标记。两份完整 472 消息快照分别是初轮清理前的 [active-chat-original.jsonl](../data/default-user/backups/text-stability-20261004-033733/active-chat-original.jsonl) 和最终定点修复前的 [active-chat-before-final-text-repair.jsonl](../data/default-user/backups/text-stability-20261004-033733/active-chat-before-final-text-repair.jsonl)。
- 当前用户设置和 Default 预设均为 Temperature 0.8、回复上限 4096、`oai_settings.openai_max_context=1,000,000`。顶层 `settings.json.max_context=8192` 是另一字段，不覆盖 Claude Chat Completions 使用的 `openai_max_context`。完整用户设置快照保存了旧 `.9/1600/1M`；`settings-target-fields-rollback.json` 也保存了用户设置和 Default 预设这些目标字段的旧值。整份 Default 预设改前没有精确文件副本；现存 `.7/8192/1M` 备份属于更早状态，不能当作本次改前文件。大上下文不等于更强记忆，也无法保证不会重复。
- 真实 API 生成尚未复验：因上游密钥曾在工具输出暴露，应由用户在本机轮换，不能在聊天中重新粘贴。当前 UI 显示 `main_api=openai`、兼容源 `claude`、模型 `claude-sonnet-4-6`，但标题页显示 LLM 未检测；这些是本地选择状态，不构成上游可用证据。未满足真实生成证据前，不能宣布文本模型链路已通过。
- 社区经验通常建议先移除历史中的第一段重复污染，并优先检查上下文、提示词/卡片与 logit bias；采样惩罚的收益会因模型和服务端而异，不应盲目叠加。参考 [SillyTavern Common Settings](https://docs.sillytavern.app/usage/common-settings/) 与 [社区重复段落案例](https://www.reddit.com/r/SillyTavernAI/comments/1usi3a0/glm51_repeating_the_same_paragraphsphrases/)；后者属于用户经验而非官方保证。

### 视觉 catalog 恢复（不等于剧情舞台已验收）

- 10 月 3 日审计记录了当时旧活动指针。10 月 4 日已通过视觉服务事务切换至 `galgame_player_catalog_20261002@1`，hash `sha256:414fcc265e275661355bf485d4d1ed0a3682095a9e3e6d9a8796c665e1275a75`；迁移前为 `catalog_simple_ce914e3ceb54@1`，hash `sha256:73645ec49c73848f251158c39ff713ad3f243c3ec417e348559efdb7bbbd3153`。
- 新目录共 29 个引用：character 17、scene 6、equipment 2、item 2、skill 2；player-safe channel 计数是 character 15、narrator 1、player 1。迁移执行输出记录 29/29 图片内容路由非空；执行记录还报告了下列测试通过：`node --test external-modules/visual-asset-service/test.mjs` 和 `node --test frontend/player/tests/visual-presentation.test.mjs frontend/player/tests/core-final-acceptance.test.mjs`。撤销管理认证后本次未独立复读 29 个 body 或重跑测试，二者均不是本次舞台渲染证据。
- 8001 首页返回 200；2026-10-04 浏览器无操作观察仍在标题页，显示“视觉已连接、LLM 未检测”，没有实际角色/背景舞台渲染证据；动态 analyzer 配置也未读、未测。状态应记为“目录与素材读取恢复，舞台实测待完成”，不能扩写成头像/背景全功能通过。
- 管理认证 `adminAuth.configured=false`；执行记录报告一次性迁移权限已撤销。执行操作之前应重新配置临时管理授权。迁移 API 只调用视觉 catalog/control/journal 写接口；未记录聊天/存档前后 hash，故不能据此声称文件级未变化。不要把 token 或 provider 值写入文档。详细执行证据和剩余验收见 [视觉恢复运行记录](GALGAME_VISUAL_MATCHING_RECOVERY_DEVELOPMENT_SPEC.md#9-2026-10-04-运行恢复记录)。
