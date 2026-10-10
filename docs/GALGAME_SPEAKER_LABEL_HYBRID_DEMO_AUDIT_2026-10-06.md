# 说话人标题混合识别 Demo 开发前审计与实施记录

> 日期：2026-10-06
> 审计类型：开发前文档审计 + 首版实施审计 + 2026-10-06 当前存档页问题回归审计
> 范围：说话人标题 Demo；未修改聊天、存档、上游 provider、密钥或 SillyTavern 原版代码
> 主规范：`docs/GALGAME_SPEAKER_LABEL_HYBRID_DEMO_DEVELOPMENT_SPEC_2026-10-06.md`

## 2026-10-06 当前页复核与修订

此前独立 PASS 只证明实现符合当时的保守文档，并未证明普通叙述会显示“旁白”。真实浏览器查看存档第 2/32 页时，文本“你带着核心队伍……前往……”仍显示“未识别”。该段没有说话人署名或引号对白，结构快路按原规范刻意不判旁白；因此“未识别”是设计限制，不是结构 helper 未被调用。旧 parser 曾将未命中内容归为旁白，后续为避免把对白和新角色误标成旁白而禁用；收紧后没有给普通叙述保留低成本的展示分类。

语义服务代理 `127.0.0.1:8798` 本轮健康探测当时可快速返回 HTTP 200，但分析服务已有多次 `ANALYZER_TIMEOUT` 记录（60–120 秒）。健康探测仅证明代理能响应，不代表当前 annotation provider 请求可用。这使普通叙述在结构规则拒绝分类后，长期停留为 unknown。

本轮将 Demo 修订为窄范围粗分类：无引号、无行首短横线对白、无疑似姓名冒号前缀，且仍为 source-only `unknown` 的当前页，允许显示“旁白”。该标签不改 segment kind、identity、视觉角色 channel、头像、roster 或聊天；一旦有效语义投影标为 dialogue/unattributed-dialogue，就不使用或保留该粗标签。未加引号、也没有署名的真实台词可能暂时误显示“旁白”，这是为了恢复可用标题的明确 demo 取舍。

## 8. 修订后验证结果

- shared/player 说话标题定向回归：45 项通过、0 失败；新增覆盖普通叙述标题、语义对白屏蔽 fallback、旧粗标题 memo 失效。
- `node frontend/tools/static-architecture-audit.mjs`：`ok: true`，`prohibitedActiveCount=0`、`needsReviewCount=0`、`failedChecks=[]`。
- `git diff --check`：退出码 0；输出只有仓库现有 CRLF 转换提示。
- 官方 player/admin 隔离构建用于生成产物；比较阶段目录后只同步了 player `app.js`、cache-busting `index.html`，以及共同 adapter 的两个静态副本；其他静态输出经 build-version 归一后与既有产物内容一致，没有整目录覆盖。
- 真实浏览器：在 `http://127.0.0.1:8001/game/` 继续读取原有 Dungeon Master 存档，实际第 2/32 页“你带着核心队伍……前往 Grand Harbor……”显示标题“旁白”。剧情正文未发送、未写回，页码和原有状态未改变；运行状态显示酒馆、配置、运行桥和视觉已连接。
- 分析代理健康请求可返回 HTTP 200；分析服务日志仍有历史 `ANALYZER_TIMEOUT`（60–120 秒）记录。这次通过本地粗标题修复纯叙述的基本展示，没有声称修复上游 annotation provider 的超时，也没有做 LLM 回放或消耗额外模型用量。
- 新实现待独立代码审计最终确认；本次实测仅覆盖当前存档当前页，不能宣称所有剧本/所有混合对白的识别准确率已通过。

## 1. 当前根因依据

源码复核确认了一个可具体定位的页标题门控问题：`frontend/player/src/main.js` 的 `createPresentationPagesForMessage()` 在长回复分页路径中只在 `projectedSegments` 为空时附加页级标题（当前工作树约第 1651 行）。因此，段数组已存在但当前页没有有效标题时，page-window 标题仍会被跳过。实现修复时必须检查当前页的有效标题，而不能把段数组存在当成标题存在；完整有效投影确实为当前页提供标题时则仍保持其权威。

当前活动消息分析先调用 `analyzeCurrentPresentationPageWindow()`（约第 1911 行），随后进入既有 singleton Annotation 流程（约第 1951 行以后）。页窗口分析本身绑定消息/页 hash、scope、cursor 与 timeline，结果经 `createPresentationPageTitleEvidence()` 转为只读标题证据。该安全边界应复用，不能另建一个不校验异步时序的语义链路。

早期显示解析器有角色名冒号、短横线和引号规则，后续提交 `c7e7ea99f`、`e3a9ebf8a`、`caba7512e` 加入更多姓名/动作/边界规则。全面恢复旧 parser 或继续叠加词表会把误判旁白的问题重现。主规范因此只允许极少数显式署名模式，并将其定义为同步标题提示。

## 2. 设计与边界审计

- **边界符合 AGENTS.md：** 目标仅在 `frontend/shared/**`、`frontend/player/**`、对应隔离测试、`public/game/**` build output 与 `docs/**`；不触碰 SillyTavern 原版源文件。
- **没有自建剧情链：** helper 只从原版可见文本取标题提示；不改正文、请求剧情生成、增加响应 DTO、持久化或修改原版聊天/存档。
- **语义与身份隔离：** 新角色标题可以短暂显示原文姓名，但 identity 仍 unknown；不创建人物、不匹配头像、不占用一局唯一头像、不更新队伍。
- **降级安全：** 未匹配、歧义、超时、无效输出和过期响应均为 unknown-safe；绝不把未命中转成旁白。
- **标题权威关系：** 当前页已有完整有效投影标题时保留该标题；只在当前页标题缺失/unknown 时由明确快路或 page-window 语义补充。单纯 `projectedSegments` 非空不得阻断补充；迟到的 unknown/无效结果不得抹掉有效显示标题。
- **异步不阻塞：** 正文和稳定分页先显示，结构 fast path 同步计算，LLM fallback 后台执行并重用现有 abort/cursor/hash/timeline 防护。

## 3. 文件清单审计

主规范列明了基线文档、实现文件、隔离测试和静态 build output。它还明确要求在改代码前检查当前工作区 diff、build script 清理范围和源码/产物对应关系。当前工作区存在其他未提交修改；实施时必须按这份规范做窄范围修改，不得 reset、clean、覆盖或顺手整理既有变更。

实现顺序：shared 纯 helper 与单测 → player 标题优先级/异步合并及 renderer 单测 → 静态架构审计与回归测试 → 检查 build 输出范围 → 生成并核对 `public/game/**` → 独立代码审计 → 真实浏览器验收。不得把构建通过代替真实标题验收。

## 4. 独立审查结论

**最终状态：PASS，可进入开发。** 独立审查员 `/root/speaker_label_doc_audit` 对主规范和四份产品/身份基线做了两轮只读核对。

首轮结论为 PARTIAL，提出三类明确性问题：文本规则例外与 identity 推断禁令需区分；跨页引语的有效起点和当前页 evidence span 需定义；source-only base page 与实际投影页可能有不同边界，需规定安全映射。第二轮复审前已完成以下文档收敛：

1. 说话人结构快路被限定为 display-only 标题，不可创建 identity、头像、roster 或剧情状态。
2. 跨页续接仅从前一相邻页来源/hash/page span 均有效的单一 speaker title evidence 开始；续接页分类跨度来自当前 core 的引语，姓名跨度可以在同消息 lookbehind 内。
3. fast path 使用当前实际显示页的 sourceSpan；page-window 结果须以相同 message index/hash 与唯一实际显示页 sourceSpan 完全相等才应用，否则保留原标题/unknown。
4. `GALGAME_DESIGN_SPEC.md`、Native-First、Frontend 与身份投影规范均有对应窄范围补充，明确其仅覆盖说话人标题，不降低身份/roster gate。

独立复审确认：没有与 AGENTS.md/SillyTavern 原版冻结冲突；快路未扩展成通用动作词/题材词分类器；完整有效标题、fast label、page-window 与 unknown 优先级一致；测试、构建和浏览器验收清单足以指导实现；没有“已完成”或准确率已验证等虚假声明。审计员未编辑文件、未运行测试或操作聊天/浏览器。

## 5. 实施记录

本轮按照主规范实施在 `frontend/shared/**` 与 `frontend/player/**`：

- 纯结构 helper 识别少量明确署名形式和安全的同消息跨页引语续接，仅产出 display-only 标题证据。
- 标题合并顺序调整为完整有效 singleton 投影 → 结构快路 → page-window 语义 fallback。结构快路覆盖时跳过当前页补充请求，singleton 身份/视觉分析仍继续。
- 结构标题异步提交绑定当前 active chat 的消息正文、source hash、页游标和 source span；同一页并发工作合并。消息在哈希过程中被编辑时，旧证据不会写入当前页。
- renderer 只读取验证后的标题证据；unknown identity、头像、roster、正文和分页均未由快路改写。
- 跨页引语状态机补上 ASCII 双引号闭合处理。
- 修改了对应 shared/player 回归测试；按官方构建同步 `public/game/**`。静态审计发现共享模块在管理员静态产物也需保持一致，因此只从官方隔离构建同步了 `public/game-admin/shared/sillytavern-adapter.js`，未修改 admin 入口和 UI。

本地识别本身不请求模型；它需要一次异步本地 hash 校验后才更新标题。正文、分页和翻页不等待该校验或 LLM。

## 6. 实施验证

- 定向命令：`node --test frontend/shared/tests/sillytavern-adapter.test.mjs frontend/player/tests/presentation-renderer.test.mjs frontend/player/tests/runtime-regressions.test.mjs`，42 项通过、0 失败。
- 语法检查：player `main.js`、`presentation-renderer.js`、shared adapter 与 build 后 `public/game/app.js` 通过 `node --check`。
- 静态架构检查：`node frontend/tools/static-architecture-audit.mjs` 返回 `ok: true`，`prohibitedActiveCount: 0`、`needsReviewCount: 0`、`failedChecks: []`。
- 隔离 player 构建与 `public/game/**` 文件清单、内容 hash 一致（33 个文件）；官方 admin 隔离构建的共享 adapter 与 `public/game-admin/shared/sillytavern-adapter.js` 一致。
- SillyTavern 原版冻结路径无 diff。没有调用模型/API、生成剧情或写入聊天与存档。真实浏览器验收未完成：本轮 In-App Browser 打开 `http://127.0.0.1:8000/game/` 被客户端拦截（`ERR_BLOCKED_BY_CLIENT`），Chrome 桥接调用失败（`nodeRepl.fetch request failed`）；没有可用页面状态作为运行证据。
- 本文记录的是自动化和静态证据，不代表真实浏览器中用户当前剧情已经验收。

## 7. 独立代码审计

独立审计员 `/root/speaker_title_code_audit` 完成只读代码复审，最终结论 **PASS**。审计期间报告的两项代码问题均已修复并有回归覆盖：

1. hash 等待期间同聊天同页正文被编辑，旧结构证据可能回写；现使用当前 `activeChatSnapshot` 的消息文本、角色、页游标及 source span 做目标校验。
2. ASCII 对称双引号没有执行闭合状态切换；现改为开闭 toggle，并增加跨页 ASCII 引号回归用例。
3. 规范“同步显示”的用词与 WebCrypto hash 校验后的 DOM 更新不一致；§1/§3/§6/§7/§9/§10 已统一为“正文立即显示，标题在本地消息 hash 校验后更新”。

审计确认标题优先级、page-window 精确映射、跨页来源验证、身份/头像/正文隔离及 SillyTavern 原版冻结边界符合文档。审计员未运行测试、操作构建产物、浏览器、聊天或 API；浏览器运行验收仍未执行，因此不声称真实对话标题准确率已验收。

## 2026-10-06 本轮最终复核（以此节覆盖上方较早状态）

- 修复后重新运行定向回归：46 项通过、0 失败。静态架构审计 `ok=true`，冻结路径检查通过。独立审计复核 PASS：Native-first 与 Frontend 规范的 page-window 标题边界已一致；粗略 `plain-prose-narration` 不再阻断语义覆盖；`unattributed-dialogue` 标题映射与 `public/game` 产物一致。
- 按仓库启动器恢复 `presentation-analysis-service` 8801 和 `visual-asset-service` 8798。浏览器经 8798 固定代理探测得到 `serviceReady=true`、`analyzerConfigured=true`，scope 为 `claude-sonnet-4-6:presentation-annotator.v26`；没有读取或输出凭据。
- 在现有 Dungeon Master 存档中只浏览已生成回复的前三页，没有输入玩家行动、请求剧情生成或改写 SillyTavern 聊天正文。第一页的章节标题经语义分析由粗略“旁白”改为“正文”；第二页无标记叙述显示“旁白”；第三页原文 `Pippa和Durik留守Grand Harbor管理龙裔公会："Boss放心！老娘会把公会管理得妥妥的！"` 仍显示“未识别”。当前页面和播放器自动存档的阅读游标停在该现有回复第 3/26 页；历史消息仍为 779 条，没有写入新聊天内容。
- 这说明基础分类并非完全失效：普通叙述 fallback、语义正文标题均在真实页面生效。第三页是“先叙述多人行动、后接引语”的混合形式，现有明确结构规则不能可靠地从两个被提及的人中判定唯一说话者；不能把“旁白”硬贴给对白，也不能将两位参与者冒充为两位说话人。
- 本轮代理日志同时出现一次 annotation 上游 `ANALYZER_TIMEOUT`（120000 ms）与代理 HTTP 504，并有 `unsupported-speaker-downgraded` 恢复事件。健康检查成功只证明本地 8798→8801 通路已连通，不等于 Claude 每次分析都按时成功。日志没有请求正文，且代理不记录可用于逐页关联的 request ID，因此不把该 timeout 唯一归因到第三页；它证明当前语义链仍有间歇超时，不能作为稳定准确率通过。
- 最终结论：实现中的标题门控缺陷、旧规范冲突和静态产物不同步已修复；服务链已恢复。**混合叙述对白的标题识别仍未验收通过**，当前未知结果是安全降级，同时受格式歧义与上游超时影响。下一阶段应先解决单页语义请求的超时/降级可观测性，再用这类真实混合句式做少量回归；不要用“凡出现角色名字/引号即认定说话人”的规则替代语义归属。

## 2026-10-06 超时诊断子阶段（后续修订）

### 调用链结论

只读审查 annotation route 后确认，短消息一般映射为一个非 dense tile，普通情况下以一次 provider 请求分类全部 source units；若有 mixed 单元，服务最多递归细分六层。一次 HTTP annotation 请求上限为 24 次真实 provider attempt（包含重试/细分），provider semaphore 同时容量为 3。共享 deadline 为 120 秒，包含 semaphore 排队、provider 请求、重试、细分及合并；8798 代理 130 秒、player adapter 125 秒。server.requestTimeout=15s 只约束入站请求体，不是上游模型超时。

现有日志中最新样本为 annotation ANALYZER_TIMEOUT，elapsedMs=120000，providerAttempts 为空。这只能证明共享 deadline 到期。现有证据不能判断是某个 attempt 单独耗尽预算、排队、多个 refinement/retry 累积或其他请求阶段；没有足够证据调短 deadline 或增加重试。单页页级标题分析与原有完整消息 singleton 注释是两条独立用途的请求，部分页面可能先后触发两次 annotation；这解释额外等待的可能性，但没有 request ID 对应浏览器当前页，不能声称这就是该样本的直接根因。

### 本子阶段改动与边界

开发规范第 11 节修订了原先“不改语义分析服务”的冻结范围，仅授权失败诊断日志的行为中性增强。服务失败日志现在只额外包含 tile 数、已完成 tile 数、真实 provider-call 数、最大 refinement depth、最后 tile/attempt、最近阶段及该阶段耗时，并保留最近三次已 allowlist 的 attempt outcome。队列等待、模型调用、响应校验使用固定阶段名；所有数值都有上限，stage 名称通过 allowlist。没有加入正文、prompt、模型输出、角色名、scope、entity ID、凭据或自由格式 provider 文本。

120 秒共享截止时间、24 次 provider-call ceiling、provider 并发数、重试策略、输出 schema 和验证门槛均未改变；没有发起任何真实上游 API 请求、历史批量回放、聊天正文写入、剧情生成或 SillyTavern 原版文件变更。

### 测试证据

- server.mjs 语法检查通过。
- test.mjs 语法检查通过。
- 分析服务测试通过；新增 mock timeout 用例确认单次 provider timeout 会记录一条 timeout attempt、actualProviderCalls=1、lastProviderStage=provider-call 与计划 tile 数，并确认日志不含输入哨兵文本。排队 deadline 用例确认未接触 provider，且 stage 为 semaphore-queue。
- 以上仅验证本地诊断机制，不证明 Claude 上游时延已改善，也不等同真实游戏页重放。

### 审计状态

独立只读 A1 审计结论：**PASS**。审计确认 120 秒 deadline、24 次 provider-call 上限、并发数、重试、Prompt/schema 和校验保持不变；超时 attempt/progress 经固定字段与数值上限安全投影；没有发现正文、Prompt、模型输出、角色/实体标识、密钥或自由格式上游文本泄漏。provider timeout 测试及 semaphore queued-timeout 测试断言与各自路径一致。审计员指出 queue fixture 未额外断言序列化日志包含 queue attempt，属于窄测试缺口，不构成当前通过测试和生产回退路径的失败。

子阶段状态：**诊断改动通过独立审计；上游延迟根因仍未归因，也未声称被修复。** 当前证据不足以调短共享 deadline 或增加重试。新遥测加载后，需要最多一次当前页面的受控语义请求或等待下一次自然失败日志，再根据 stage、attempt 数、refinement depth 和累计调用数判断下一项性能修正；不做历史批量回放。
