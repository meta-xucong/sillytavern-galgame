# 说话人标题混合识别 Demo 开发规范

> 状态：Demo 已实现；2026-10-06 真实浏览器检查发现“普通叙述仍为未识别”。本修订加入粗略旁白标题 fallback；完成定向测试、构建、独立代码审计及当前存档页验收后再更新状态
> 日期：2026-10-06
> 范围：玩家当前可见页的说话人标题
> 权威边界：AGENTS.md 与 GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md
> 独立审查记录：GALGAME_SPEAKER_LABEL_HYBRID_DEMO_AUDIT_2026-10-06.md

## 1. 目标和范围

尽快交付一个可见、可验证的说话人标题 Demo：

- 明确格式由本地结构规则识别，不调用模型；完成本地消息 hash 校验后更新名字。
- 明确对白规则无法判断时，用现有 LLM 语义注释补充当前页；模型不可用时，未标记的普通正文临时显示“旁白”。
- 识别过程异步，不等待模型后才显示正文或允许翻页。
- 未确认身份的新人物可以显示原文名字，但不因此创建身份、绑定头像或改变队伍。

本阶段只做标题显示，不追求泛化准确率认证，不改语义分析服务、模型、Prompt、provider、公开 Annotation v1 DTO 或 SillyTavern 原版文件。2026-10-06 后续诊断子阶段另见文末修订：仅给现有语义分析服务增加脱敏的超时阶段计数，不改变本规范标题行为或分析预算。

## 2. 当前代码依据

### 2.1 不恢复旧规则解析器

早期 parser 以角色名冒号、短横线和引号分类，并将未命中内容归为旁白。后续为识别新角色增加了姓名形态、动作词、边界和连接词规则。相关历史提交为 c7e7ea99f、e3a9ebf8a、caba7512e。

旧 parser 位于 frontend/shared/src/sillytavern-adapter.js 的 createVisualNovelDisplaySegments。它保留给隔离测试和兼容逻辑，不得恢复为生产语义 fallback，也不得继续扩充动作词或题材规则。

### 2.2 当前标题覆盖缺陷

frontend/player/src/main.js 的 createPresentationPagesForMessage 用 projectedSegments 是否为空决定是否能附加页级标题。有效单消息注释可以返回段数组，但当前页说话人仍未知；数组存在会错误阻止页级标题补充。修复必须区分“有段数组”和“当前页已有有效标题”。若完整消息投影已经为当前页给出有效标题，它仍是权威；空标题、unknown 标题或其他页的段不能阻止当前页只读补充。

长回复分析先请求当前页窗口，再串行请求完整消息注释。后者可用于身份投影，但不能用一个未知或不完整的段数组抹掉当前页已有证据的标题。修复应检查“当前页是否已有有效标题”，不得按段数组是否存在判断。

### 2.3 可复用能力

- 固定原文分页：createStablePresentationBasePages。
- 当前页和同消息 lookbehind：createPresentationPageWindow、analyzeCurrentPresentationPageWindow。
- 页级语义标签：createPresentationPageTitleEvidence。
- 当前页失效与异步响应校验：现有 controller、timeline snapshot、消息/页 hash 和 abort 流程。

Demo 复用这些能力，不新增服务、API route、模型配置、聊天格式或存储迁移。

## 3. 用户可见行为

1. 正文、字符顺序、稳定分页和原版消息来源保持不变。
2. 正文立即显示且不等待标题分析；明确格式命中后，标题在本地消息 hash 校验完成时更新，不等待模型响应。
3. 未匹配时使用现有语义标注；LLM 结果只在消息、页面和原文仍一致时显示。
4. 无引号、非行首对白格式、无疑似人物冒号前缀的普通 character 正文，可先显示“旁白”。这只是粗略标题，不改 segment 类型或身份；未加引号对白可能短暂误显示为旁白。带引号、显式/疑似对白格式、歧义或语义已标成 dialogue/unattributed-dialogue 时仍为“未识别”或已有语义标题。
5. 新人物 fast label 只影响标题；identity 仍为 unknown，头像和 roster 仍由原有身份投影决定。
6. 完整消息投影只有在为当前显示页提供有效标题时才决定标题；仅有段数组或身份信息不覆盖当前页标题。
7. 短回复继续以现有 singleton Annotation 作为语义 fallback。

## 4. 最小结构快路

增加一个独立纯展示 helper，不复用 createVisualNovelDisplaySegments。helper 只产生标题提示，不切割或改写正文。

首版只支持四类：

1. 已发布人物的明确署名：角色名后紧跟冒号/全角冒号，或行首短横线署名；名字必须精确匹配已发布角色。
2. 明确署名的新人物：未知姓名后紧跟冒号和引号对白，或紧跟少量直接发言词（说、问、答、喊等）与引号对白。只显示原文名字，不创建身份。
3. 同一条原版消息中，已确认说话人的引号未闭合并连续跨页时，延续该名字到闭合引号。起点只允许前一相邻页已有通过消息索引、source hash、view/core span 验证的单一 speaker title evidence，来源限于本规范的明确署名快路或有效 Annotation 标题；unknown、原版消息作者名、一般段标题都不能作为起点。消息、原文 hash、相邻页关系或跨度连续性变化即停止。
4. 普通正文 fallback：当当前实际 page segment 仍是 source-only `unknown`，且文本没有任何引号、没有行首短横线对白格式、没有疑似姓名冒号前缀时，将该页标题标为“旁白”。该规则不扫描词典、不判断身份、不切分正文；调用者可在已有 semantic dialogue/unattributed-dialogue segment 时关闭它。后续有效语义投影若判为对白，该粗标题立即失效。

以下情况交由现有 LLM fallback 或保持 unknown：

- 疑似未发布人物的冒号署名（包括 `Celestia：我们走。`）以及行首短横线对白。
- 单独引号、只有动作描写、只有人名提及。
- 开放引号之前没有已确认的说话人。
- 候选名字或原文跨度不唯一。

不新增语言/题材词典、大型动作词表或别名推断。仅限上述纯普通正文的规则是本 Demo 对“未命中即旁白”的窄例外，不代表语义 segment/identity 已确认为 narrator。首版结构模式只服务当前 zh-CN 发布体验，不声称跨语言泛化。

## 5. 内部提示与最低校验

结构 helper 产出仅供 player renderer 使用的当前 `pageTitleEvidence` 形态，不新增协议或 DTO。普通正文 fallback 使用 `kind=classification`、`classification=narration`、固定 `text=旁白` 和当前页正文范围作为 classification evidence；不得添加 speaker mention：

- `sourceMessageIndex`、`sourceMessageHash`、当前 `coreSpan` 与必要的同消息相邻页 `viewSpan`。
- `kind/text/speakers` 与现有 `pageTitleEvidence` 一致；名字文本和跨度必须从可见原文精确截取。
- `classificationEvidenceSpans` 指向页 core 内的署名/直接归属原文；跨页续接时，classification span 必须指向当前 core 内实际可见的未闭合引语文本，speaker span 可位于紧邻上一页的同消息 view 内。
- 可加仅供诊断的固定 `ruleId`：`known-prefix`、`quoted-attribution`、`open-quote-continuation`。用于 speaker 显示的 `mentionRef` 是不透明 display-only token，不映射到 annotation entity、identity 或 roster。

复用 `presentation-renderer.js` 已有的 `pageTitleEvidence` 校验和标签路径；只有现有字段不能表达这三类快路时才提出最小兼容改动，不新增 AI 故事响应协议或外部 API。任何 hint 都只驻留派生页面状态，不写入聊天、存档、scenario manifest、身份缓存或原版运行时。

如果现有 singleton annotation 产生了当前页 `identityRef=unknown` 的段，fast evidence 可以附加到该段供标题读取；对 `unknown` 段复用 `pageTitleEvidence`，对 `dialogue`/`unattributed-dialogue` 段复用 `speakerLabelEvidence` 或做最小 renderer 兼容，使有效 display-only 标题可以显示。不得把段改成 dialogue/narration，不改正文或身份。标题显示使用当前实际呈现页的 segment 与 `getPresentationSpeakerLabel()` 结果判断，不以投影数组是否存在作判断。

只做避免串消息/串页的最低检查：消息索引匹配、source hash 匹配、页范围匹配、名字跨度能从当前原文精确取回。头像、属性、状态和身份链接的可选校验不进入标题快路。

## 6. 合并和优先级

标题显示/补充顺序固定：

1. 当前完整消息投影已为当前页给出有效标题：保留它。
2. 当前页 `getPresentationSpeakerLabel()` 为“未识别”且有明确结构署名/有效同页续接：本地消息 hash 校验完成后更新 fast label；该标题仍是 display-only。
3. 标题仍缺失、segment 为 source-only unknown 且符合普通正文条件：显示粗略“旁白”。若当前有效语义 projection 已将 segment 标为 dialogue/unattributed-dialogue，则不得保留或重放该粗旁白标题。
4. 标题仍缺失或 unknown 时继续运行对应语义路径；长回复用现有 page-window Annotation v1 补充，短回复沿用现有 singleton Annotation v1。长回复即使已显示粗略“旁白”也不能跳过 page-window 请求；有效的页级 dialogue/unattributed-dialogue/narration 分类可覆盖或确认粗标题。
5. 无有效证据或疑似对白：显示“未识别”。

长页的完整 singleton projection 可以更新既有身份/头像/roster 通道；但只有它对当前页产生有效标题时才决定该页标题。单纯存在完整段数组不能压掉 page-window 或 fast label。迟到的完整投影如为当前页提供有效标题，可以替换暂存的 fast label；无标题、unknown 或过期结果不得清空已显示的有效 fast label。规则和语义来源冲突时，已验证的完整投影标题优先；无完整标题时，明确结构匹配优先于语义 fallback；两个语义来源冲突时保持 unknown，并记录固定诊断类别。

页范围映射必须按 source span，不按页数组下标猜测。fast helper 直接接收当前玩家实际正在显示的 page/segment `sourceSpan`。page-window Annotation 仍基于 source-only base pages；应用结果前，须以相同 `sourceMessageIndex`、完整消息 hash 和完全相等的 `coreSpan/sourceSpan` 唯一映射到一个实际显示页。找不到或映射到多个页面时不贴标签，保留原标题或 unknown；不得改变任何一侧的分页、页码、正文或 span 来强行对齐。

多名明确说话人出现在同一页时，标题显示“多人对话”；结构快路不创建或绑定头像。

## 7. 异步、缓存和失败行为

- 原文和稳定分页立即渲染，结构标题 hash 校验与模型分析后台执行，不阻塞正文或翻页。
- 明确署名/引语归属等 speaker 结构规则已覆盖当前页标题时，可跳过冗余 page-window 标题请求；`plain-prose-narration` 只是粗标题，不能抑制当前页 page-window Annotation。已有语义标题仍由准确的页范围与缓存 provenance 校验，粗标题则允许有效页级语义证据替换。
- 快路使用当前实际显示页的 `sourceSpan`。page-window 分析按完整 source hash 与精确 core/source span 映射；不精确唯一对应时丢弃该标题结果。
- 快速翻页时旧结果不得更新当前页；复用现有 abort、page cursor、hash 和 timeline 校验。
- 回看相同页面时先按当前原文、消息 hash 和页范围验证结构标题 memo；没有有效 memo 时从当前原文重新计算。page-window fallback 继续使用现有缓存。
- 超时、无效输出和说话人降级不阻塞阅读，不触发剧情生成。普通无标记正文按 §4 显示粗略旁白；疑似/明确对白仍保持未知，不以该 fallback 冒充身份。
- 不新增后台历史回填、定时重试循环或跨聊天缓存。

## 8. 文件改动清单

预期改动：

1. 本规范与独立文档审计记录。
2. GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md、GALGAME_FRONTEND_DEVELOPMENT_SPEC.md、GALGAME_DESIGN_SPEC.md、GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md：加入窄范围规则和权威关系。
3. frontend/shared/src/sillytavern-adapter.js：新增纯结构 fast-label helper；保留旧 parser，不扩展、不接入生产。
4. frontend/shared/tests/sillytavern-adapter.test.mjs：测试明确署名、新人物显示名、普通标题冒号和引号续接。
5. frontend/player/src/main.js：把 fast evidence 映射到当前实际显示页的 sourceSpan；按有效标题而非 projectedSegments 真值决定补充；将 page-window core span 精确映射到实际页；分离长页标题与身份投影。
6. frontend/player/src/presentation-renderer.js：优先复用现有 pageTitleEvidence 标签/跨度校验；只有必须时才做最小兼容改动，保持 unknown identity 与头像通道隔离。
7. frontend/player/tests/presentation-renderer.test.mjs、frontend/player/tests/runtime-regressions.test.mjs：覆盖标题优先级、迟到响应和不完整投影不再压掉页标题。
8. 使用官方构建流程同步生成 public/game/**，禁止手改生成文件。为使共享模块静态构建审计通过，另同步 `public/game-admin/shared/sillytavern-adapter.js`；没有改管理员入口或 UI。

本阶段不改 external-modules/**、API adapter、模型服务、provider key、原版 src/**、public/index.html、原版扩展或根依赖。

## 9. 最小验收矩阵

以下固定输入应直接成为纯 helper 和 renderer 的最小回归夹具；示例角色名按测试 manifest 中的已发布 cast 配置准备：

| 原文 / 场景 | 标题预期 | 其他预期 |
| --- | --- | --- |
| `Lady Veyra：我来。`（Lady Veyra 已发布） | 本地消息 hash 校验完成后显示 `Lady Veyra` | identity 与头像仍由原投影决定 |
| `Celestia说：“我们走。”`（Celestia 未发布） | 本地消息 hash 校验完成后显示 `Celestia` | identity=unknown，不请求角色图、不改 roster |
| `所以战术很简单：优先攻击克罗恩。` | `旁白` | 粗略标题，不创建 narrator identity，不改正文 |
| `你带着核心队伍……前往总部。` | `旁白` | 无引号普通叙述不依赖语义服务才能显示基本分类 |
| `“门开了。”` | `未识别` | 不从引号推断上一位 speaker |
| `Celestia：我们走。`（未发布） | `未识别` | 疑似人物冒号格式不落入普通叙述 fallback |
| 同一原文 `Lila说：“先等` / `我听见脚步声了。”` 分成两页 | 两页均为 `Lila` | 第二页仅在 source hash 与连续页范围匹配时续接 |
| 第二页只有未闭合引语，但前页没有有效单一 speaker title evidence | `未识别` | 不从普通上一页标题、消息作者或未知段继承 |
| `Nira说：“在这。”Venn答：“来了。”` | `多人对话` | 提取两个精确原文跨度，不绑定头像 |
| 当前页结构提示为 `Nira`，但完整有效投影在该页提供 `Venn` | `Venn` | 完整有效当前页标题优先 |
| page-window base core 与实际显示页 sourceSpan 不完全相等 | 不贴 page-window 标题 | 保留原标题/unknown，不移动分页或正文 |
| 上一页请求返回时当前页/hash 已变化 | 不应用旧标签 | 仍显示当前页已有结果或 `未识别` |
| page-window/完整注释明确标为 dialogue 或 unattributed-dialogue | 已有有效角色标题或“未识别”，不保留粗“旁白” | 粗标题不覆盖语义对白类别 |

| 样例 | 预期 |
| --- | --- |
| 已知角色署名并带台词 | 本地消息 hash 校验完成后显示该角色名 |
| 未登记角色明确署名并带引号 | 本地消息 hash 校验完成后显示原文名字；identity=unknown；不触发头像绑定 |
| “战术很简单：优先攻击……” | 不显示为人物 |
| 无署名引号段 | 不继承上一说话人；由语义 fallback 判断，否则 unknown |
| 同消息未闭合引语跨页 | 延续已确认名字；闭合后停止 |
| 段数组存在但当前页没有有效标题，且 sourceSpan 精确唯一对应 | 仍可显示有效 page-window 标题 |
| 翻页后旧模型响应返回 | 不覆盖当前页标题或头像 |
| LLM 超时/无效输出 | 阅读与翻页正常；普通无标记正文标题为“旁白”，疑似对白保持 unknown |

实施时建议执行：

- node --test frontend/shared/tests/sillytavern-adapter.test.mjs
- node --test frontend/player/tests/presentation-renderer.test.mjs
- node --test frontend/player/tests/runtime-regressions.test.mjs
- node frontend/tools/static-architecture-audit.mjs
- node frontend/build-static.mjs

构建前只读检查 build 脚本的清理与输出目标。当前工作区有多文件未提交修改；不得 clean/reset 或覆盖现存 public/game 改动。构建后核对源码与 public/game 的 helper、资源版本和行为一致。

## 10. 开发放行条件

- 定向测试、静态架构检查通过，构建产物已同步。
- 明确署名通过本地消息 hash 校验后显示；常见标题不误认人物。
- 长页 singleton 段数组不再屏蔽有效当前页标题。
- 分析异步；不改原文、页码、聊天或存档。
- 新人物 fast label 不直接绑定头像或改变 roster。
- 独立代码审计确认实现符合本规范。

本 Demo 不证明跨剧本准确率，不代表 LLM 总能成功，也不验收新人物身份、头像和队伍状态。当前自动化、构建和静态审计记录见同日审计文档；真实浏览器表现仍需在玩家端确认。

## 11. 2026-10-06 超时诊断子阶段（覆盖本节对服务文件的冻结）

真实浏览器检查出现一条分析超时日志，耗时为共享截止时间 120 秒，但日志没有保留 provider attempt 轨迹。只读调用链审查确认：短文本通常是一 tile/一次基础 provider 调用，但 mixed 分类可递归细分；整个请求共享 120 秒，且最长单个 attempt 可以耗尽全部预算。旧日志无法区分 semaphore 排队、provider 请求、细分累积或响应校验阶段，因此本子阶段仅为失败日志补足固定类别的阶段、tile/provider-call/refinement 计数和最近三次安全 attempt 结果。

本子阶段允许改动 external-modules/presentation-analysis-service/server.mjs、该服务的 test.mjs 与 README.md；仅限失败诊断及内部测试 seam。保持 120 秒共享 deadline、24 次 provider-call ceiling、semaphore 容量、重试规则、提示词、模型、公开 Annotation v1 schema/DTO 和 fail-closed 校验不变。禁止把原文、prompt、模型输出、实体名称、凭据或任意 provider 字符串写入日志。独立回归须用可控 mock provider 覆盖 request-wide timeout、semaphore queued timeout及脱敏日志；不做历史回放或真实上游批量调用。此修订不代表已确定 120 秒应调短，需先根据新遥测证据判断超时来源。
