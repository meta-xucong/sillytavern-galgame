# 说话候选形态分流与结构回放口径开发规范

> 日期：2026-10-07
> 状态：parser v12 结构规则增量已实施；独立 A1 与静态架构审计通过，4 组定向测试 78/78 通过。v12 已在同一聊天快照上完成只读全量回放，但所有聊天缺少 speaker scope 且没有 gold，因此历史 speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`；浏览器与移动端真实 UI 尚未验收。
> 目标：把“页面属于哪类内容”和“是否有证据归属到某人”分成两步，降低状态/标题/统计行误挂人物，并让历史回放分母更接近真实对白候选。
> D/I/A：D0 / I2 / A1。设计取舍已在会话中确定；实现横跨 parser、renderer 证据、replay 和冻结分页边界。

## 1. 背景和当前证据

当前 structural replay 的 `unknown` 混合了未归属对白、统计/字段记录、独立标题、普通叙述、引语续句和不可寻址页。它只能表示“本次结构解析没有输出 speaker/group/narration evidence”，不能用作 speaker miss 数，也不能证明文本真无来由。

本轮修改前真实只读回放：158 个聊天文件、930 条 assistant 消息、17,902 个实际播放页；结构 evidence kinds 为 speaker 307、group 0、narration 8,027、unknown 9,568。所有输出只含匿名汇总，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。各聊天缺少逐 chat 发布角色名 scope，因此该基线不是准确率或完整生产复刻。

对生产分段器输出页的无正文形态计数显示：原类型 narration 16,017、unattributed-dialogue 1,177、dialogue 708；形态可重叠：无直接 cue 的引号 5,837、引号+说话 cue 1,505、多字段行 1,052、统计/数值记录形态 808、单一数值字段形态 708、多项目符号 462、独立标题 46，其余 8,669。此为定位线索，不是 gold 标签；具体实现不得将这些粗启发式计数直接宣称为真实类别或准确率。

## 2. 问题与决策

原路径同时尝试识别说话人和解释整页类型，导致两类相反问题：

1. `Pippa：-67 + 17 = -50 HP`、`Pippa: d20+2 = 15+2 = 17` 这类状态/掷骰记录，只因前缀碰到已发布角色名，可能触发 `known-prefix` speaker evidence。
2. 没有 speaker evidence 的页面全落入 `unknown`，使报告无法区分真实未归属对白与标题、统计、普通叙述及续句。

本阶段采用不可循环的两阶段：

1. **先判断页面形态。** 只使用当前原版可见文本、已有 base page type 和少量与主题无关的版式形态；这一步不读取/推断人物归属。
2. **再在对白候选页尝试 speaker attribution。** speaker 仍必须由同消息、可回指的直接署名/对白证据确定；candidate 不能代替 attribution。无法归属的明确对白保留 `unattributed-dialogue`。

增加的 page-kind 只服务于展示标题和只读回放，不能改变底层页的 `type`、身份或玩法状态。存在边界不清时选 `ambiguous`/unknown，不猜角色。

## 3. 两阶段判定表

Stage 1 页面形态 helper 返回固定枚举，使用原始完整消息上的 Unicode code point span，且只对当前已有 page `sourceSpan` 求交集。它不接受 speaker names，也不读取 Stage 2 归属结果：

跨页候选范围由独立的 roster-free `dialogueCandidateSpans` 预扫描从完整原文产生（对白引语、直接 cue 等原始结构），不从 speaker anchor、角色名单、identity 或 attribution result 反向派生。

- `dialogue-candidate`：同页有被 full-message quote scanner 成功定位、且与当前 core 相交的对白引语；或同页有现有 parser 支持的明确直接说话 cue/对白格式；或原 page type 为 `unattributed-dialogue`。core 即使没有重复的引号字符，只要与同消息已扫描的具名开放引语范围相交，也计作 candidate。候选本身不携带 speaker。原 page type `dialogue` 不是 Stage 1 的独立对白证据，因为它可能是旧的 roster-prefix parser 结果。
- `structured-record`：无明确对白证据，且页面呈现为多项字段/记录/数字公式/列表等结构化信息。
- `heading`：无明确对白证据，且符合现有明确独立标题外形。
- `narrative`：非对白普通叙述，遵循当前既有粗旁白展示限制。
- `ambiguous`：有可能对白但没有通过上述对白候选谓词，或有重叠且无法定优先级的形态证据。
- `unaddressable`：production page 缺少合法 source span；单列统计，不能进入 speaker-candidate denominator。

Stage 1 严格优先级：unaddressable → 与 page core 相交的明确全消息引语/直接说话 cue 或底层 `unattributed-dialogue` → structured-record → heading → 非记录/标题的底层 `dialogue` → narrative → ambiguous。已发布角色冒号前缀不能压过明显数值/多字段记录形态。Stage 1 的文本对白 cue 不看某个姓名是否在 roster 中；底层 `dialogue` 只作排除明显记录/标题后的兼容回退。在 Stage 2，先让完整消息索引解析 direct speaker evidence，再按下表落最终结果：

| Page shape | Stage 2 evidence | Final page kind | Speaker title |
| --- | --- | --- | --- |
| dialogue-candidate | 唯一且完整 speaker evidence | attributed-dialogue | 角色名 |
| dialogue-candidate | 多个互不冲突 speaker evidence | attributed-dialogue | 多人对话 |
| dialogue-candidate | 无 speaker / speaker 冲突 / quote ambiguity | unattributed-dialogue | 未识别 |
| structured-record | 任意非对白冒号前缀 | structured-record | 状态 |
| heading | 任意非对白冒号前缀 | heading | 正文 |
| narrative | 无 speaker evidence | narrative | 现有旁白 fallback |
| ambiguous / unaddressable | 任意 | ambiguous / unaddressable | 未识别/保留现状 |

若明确 direct quote/cue 同时与结构形态相交，Stage 1 先把它判为 dialogue-candidate；但底层 `dialogue` 类型与 `Name: numeric-value` 本身不构成 direct quote/cue，不能压制 numeric/key-value 形状。完整消息中已定位的引语范围跨过 page boundary 时，每个相交的 production core 都是候选，不要求当前页重复包含引号。

`structured-record` 只使用通用形状证据：至少两个同类字段/列表行；或单字段行的值明确以数值、算式/骰点式运算结果开头，且没有 Stage 1 dialogue-candidate 证据。分类不读取字段含义、角色名、题材词典或 HP/XP/AC 专用白名单。短 Markdown/括号标题只在整页本身就是标题时成立，句子中的“战术很简单：……”不得视为 speaker label。

对无发布 roster 的候选名前缀，`Name: “quote”` 与 `Status: “Healthy”` 结构上不可区分。因此，Latin 未发布名或任何任意名称仅有 `Name: quote` 格式时，允许形成 dialogue candidate，但不得确认 speaker；只有存在独立直接说话 cue、已发布 roster 精确姓名，或现有独立署名结构才可产生人物 speaker evidence。roster 外汉字短名也执行相同原则。此为精确率优先的边界：新人单靠 `Name: “...”` 可能暂时显示“未识别”，不会被臆断为已知人物；不得声称此规则能区分 Status/Strategy heading 和同形角色署名。

## 4. Speaker attribution 约束

1. Stage 2 保留现有精确已发布角色署名、直接对白 cue、引用对白和完整消息开放引语投影规则。
2. roster 外的 `Name: “quote”` 可是对白候选，但除非有独立直接说话 cue 或独立署名证据，不确认人物 speaker。这个显式边界同时覆盖 `Status: “Healthy”` 和 `Strategy: “Attack left.”`。
3. 无引号记录的值以一般数值/公式结构开头，且无明确说话 cue 时，禁止 `known-prefix` / `line-speaker` 为其建 speaker anchor；若值行达到结构记录谓词，则 Stage 1 先阻止 speaker parser。
4. 独立标题、键值块、项目符号、骰点/数值结果不能仅凭冒号左侧与发布角色同名而绑定人物。
5. 续接只允许同一消息完整 source/hash/span 索引证明当前页仍落在之前直接归属且未闭合的同一对白范围中。不能只凭页相邻、前句 speaker、同名提及或消息作者继承。闭合后无署名的新对白维持 unknown。
6. “未识别”保留给可能对白/归属不清的页面。清楚的结构记录/独立标题允许以 display-only 分类 evidence 显示“状态”/“正文”或现有安全标签；不设置 identity，不触发旁白/角色头像。

## 5. 生产和回放合同

### 5.1 生产

- 只允许在 `frontend/shared/src/sillytavern-adapter.js` 建立纯 page-shape 分类器，并在 `frontend/player/src/main.js`/`presentation-renderer.js` 以经过原文 span/hash/index 校验的 `pageTitleEvidence` 呈现固定 classification。
- `structured-record` 映射至现有 `status` 标题；`heading` 映射至现有 `other-visible`（“正文”）；任何 title evidence 只能覆盖缺失/unknown 的当前标题，语义有效标题优先，`dialogue`/`group` speaker evidence 优先。
- 新增固定 rule id（例如 `structural-record-shape`、`structural-heading-shape`），按 renderer 与 main 双边白名单校验。classification evidence 必须精确覆盖当前 page core 的非空部分，source message/hash/index 与 core span 必须匹配。
- 普通 narration fallback 不得把结构化记录/独立标题改成旁白。unknown/ambiguous 不产生 narrator identity/asset。
- 不改 segment type、不增删或合并 page、不动 text/sourceText/sourceSpan、顺序/数量、格式化、原文聊天或分页函数。

### 5.2 历史回放

回放器必须保留旧 `structuralEvidenceKinds`，另增加 mutually exclusive `pageKindCounts`、`pageKindByBaseType`、`dialogueCandidatePages`、`attributedDialoguePages`、`unattributedDialogueCandidates`、`unaddressablePages` 与 `scopeUnavailablePages`。speaker candidate denominator 固定为 `dialogueCandidatePages`，其中包含本身已有角色归属与未归属对白；每个可寻址页恰归入一类。Stage 1 candidate 只按 §3 明确谓词决定。`ambiguous`、`unaddressable`、`narrative`、`structured-record` 和 `heading` 不计入该分母。scope unavailable 单独报告并保留在页面计数中，但不能用来宣称对应剧本已验证 speaker coverage。

报告字段必须称 `coverage` / `candidate counts`，不能称准确率。没有 gold sidecar 时 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。若角色 scope 缺失，必须明确 `scope-unavailable`，不得拿未配置的 roster 统计规则效果。

所有历史扫描继续使用 production `createVisualNovelDisplaySegments()` 原样输出的页面；只读二次读取校验原聊天文件摘要。零 provider 请求，不输出正文/角色名/绝对路径，不写聊天或缓存。

## 6. 文件清单

- `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`：添加本阶段分类与页面/说话人隔离约束；分页冻结优先。
- `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`：同步标题呈现只读 metadata 的行为。
- 本文件：冻结具体算法、测试与回放口径。
- `frontend/shared/src/sillytavern-adapter.js`：新增纯 shape classifier；在说话人行标签建 anchor 之前应用强结构记录保护。
- `frontend/shared/tests/sillytavern-adapter.test.mjs`：正负样例及生产分页不变断言。
- `frontend/player/src/main.js`、`frontend/player/src/presentation-renderer.js`：严格校验新的固定 classification evidence / rule id；不改分页与视觉 identity。
- `frontend/player/tests/presentation-renderer.test.mjs`：状态/标题显示与语义/结构/identity 优先级。
- `frontend/player/tools/speaker-structure-replay.mjs`、`frontend/player/tests/speaker-structure-replay.test.mjs`：独立 page kind 指标与分母。
- `public/game/**`：同步必要 player build output；不得清理/覆盖无关产物。静态共享模块 parity check 若要求，允许仅同步 `public/game-admin/shared/sillytavern-adapter.js`，不重建其他 admin 输出。
- `public/game-admin/shared/sillytavern-adapter.js`：仅当统一静态架构审计要求 shared module 与 `frontend/shared/src/sillytavern-adapter.js` 一致时，同步该单个生成文件；不得触碰 `public/game-admin/app.js`、页面、其他 shared 文件或任何管理员产品逻辑。原因是 admin 静态包复用同一 shared module source，源文件变化后不同步会使 repository build parity gate 失败。

禁止改动 SillyTavern 源码、配置、启动脚本、聊天、语义分析服务/DTO、Scene state、视觉 identity/asset binding、`createVisualNovelDisplaySegments()`、`formatVisualNovelDisplayText()`、任何分页函数或正文内容。

## 7. 验收测试

### 正例

- 在该 chat 的已发布 roster 精确包含 Pippa 时，`Pippa： “我来处理。”` → speaker Pippa。
- `Lila说：“我还能走。”` 且引语跨 production page boundary → 每个相交页均显示 Lila。
- 明确署名的第二角色对白 → 新角色正确切换。
- 普通连续叙述 → narration fallback 与当前行为一致。

### 必须拒绝为 speaker

- `Pippa：-67 + 17 = -50 HP，仍然濒死！`
- `Pippa: d20+2 = 15+2 = 17，失败！`
- `Pippa: 12`、两行以上 `HP: 12 / AC: 16` 等值记录、骰点/统计行、列表、独立标题。
- `所以战术很简单：优先攻击……` 不得当作 speaker label。`Status: “Healthy”`、`Strategy: “Attack left.”` 这类无 roster/direct cue 的冒号引语不得产生人物归属，维持 unknown。
- 开放引号之外的新说话人缺少署名时不能继承旧人；同一页同时有不同人或有未归属对白，保留多人/未识别安全结果。

### 不变量

- 投影前后的 production page 数组字段 `index/type/speaker/text/sourceText/sourceSpan` 深度相等。
- formatter/segmenter 函数源码无本任务 diff；正文与页码/顺序不变。
- speaker identity、avatar/roster、语义 Annotation 不随 page kind 改变。
- replay 重放同一输入产生相同 page kind/规则统计；源聊天 hash 前后相等；聊天写回/provider 请求均为零。

## 8. 阶段门槛与限制

1. 本文件先由独立审计确认与 Native-first、历史回放口径和冻结分页条款无冲突，再修改代码。
2. 实施后跑共享适配器、renderer、replay 定向测试、`git diff --check`、静态架构审计及 player-only build。
3. 用当前聊天树做一次只读全量重放，对照基线同一 source digest；公布页类别变化和 speaker 候选覆盖，分开列出 scope-unavailable 与 unaddressable。
4. 只有 gold holdout 才能评准确率。当前没有跨剧本角色 scope 和 gold，因此交付不得称“大部分正确”或“准确率达标”；评估只能说明误报保护命中、候选分母是否更合理、结构记录有没有仍被挂到人物。
5. 独立代码审计为 PASS 才收口；发现 body pagination/source freeze 违规即拒收。历史聊天原文始终只读。

## 9. 实施前工作区基线

实施前 Git 工作区存在本任务之外的多项既有修改，包含服务、媒体和前端文件；它们均视为受保护 baseline，不清理、不归并、不回滚。当前 task writes limited to the file list above; baseline for file-level review is the exact content before this spec implementation, not `HEAD`.

## 10. 实施与回放证据（2026-10-07）

### 实现

- `frontend/shared/src/sillytavern-adapter.js` 新增 `classifyStructuralPageShape()`，返回 `dialogue-candidate`、`structured-record`、`heading`、`narrative`、`ambiguous`、`unaddressable`。分类只接收完整原文、已有 page type 与已有 core span，不接收角色名单，不修改 page。
- 同文件把数值/公式及多字段记录形态保护放在行标签 speaker anchor 生成之前；直接对白 cue/引语仍优先保留。Pippa 数值、骰点与单一数值字段的固定样例均不生成角色 anchor。
- 投影 evidence 无 speaker 时，按 Stage 1 形态给出固定 display-only `status`/`other-visible`/`unattributed-dialogue` 分类。主界面与 renderer 增加双边 rule id 白名单和字段校验；有效语义标题优先，状态/标题 sidecar 不产生 narrator/character visual identity。
- Stage 1 先检查文本内明确引语/直接 cue；然后再判断结构记录/标题；已有底层 `dialogue` type 仅作为最后兼容依据，避免 roster 驱动的旧 `Name: numeric` 类型压过结构记录。roster 外的裸 `Name: “quote”` 只形成未归属对白候选，不形成 speaker；已发布 roster 精确名与带 direct speech cue 的 roster 外名仍可识别。
- 解析、主界面索引和历史回放版本统一为 `full-message-speaker-index.v4`，旧缓存键因此失效。
- 本次没有改动 `formatVisualNovelDisplayText()`、`createVisualNovelDisplaySegments()` 或其他 source paginator 函数。分类器独立前后，生产页的 `index/type/speaker/text/sourceText/sourceSpan` 序列深度相等；运行时 sidecar 验收也断言正文与 unknown identity 保持不变。

### 测试与构建

- 通过：`node --test frontend/shared/tests/sillytavern-adapter.test.mjs frontend/player/tests/presentation-renderer.test.mjs frontend/player/tests/runtime-regressions.test.mjs frontend/player/tests/speaker-structure-replay.test.mjs`（69 tests, 69 pass）。覆盖 known-roster 数值记录即便底层 page type=`dialogue` 仍分流到 record；空 roster `Status:`/`Strategy:` quote 不得生成角色；已发布姓名与带 direct cue 的 roster 外发言仍能归属。
- 通过：player-only 静态构建 `GALGAME_BUILD_TARGET=player node frontend/build-static.mjs`，输出同步至 `public/game/**`。静态架构审计发现 shared module parity 同时要求 admin 的共享适配器副本；按最小范围只同步 `public/game-admin/shared/sillytavern-adapter.js`，没有重建其他 admin 输出。
- 通过：`git diff --check`；仅显示工作区现有 CRLF 转换提示，没有 whitespace error。
- 通过：`node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/shared,public/game,public/game-admin --evidence <temp-file>`（`ok=true`, `prohibitedActiveCount=0`, `needsReviewCount=0`, `failedChecks=[]`）。其中额外触及的 admin 生成文件只有 `public/game-admin/shared/sillytavern-adapter.js`，以保持同一 shared source 的构建 parity。

### 当前聊天树只读回放

同一快照连续回放两次，摘要和 `verifiedSourceSetDigest` 完全相同：`sha256:f3541c88ef2115f983d263dc184198630dfe374445163d526a6b1b871cfd20aa`。每轮扫描 158 个聊天文件、932 条 assistant 消息和 17,959 个 production pages；页类别互斥统计为：

| page kind | pages |
| --- | ---: |
| attributed-dialogue | 273 |
| unattributed-dialogue | 5,406 |
| structured-record | 1,910 |
| heading | 77 |
| narrative | 9,720 |
| ambiguous | 568 |
| unaddressable | 5 |

`dialogueCandidatePages=5,679`，其中 attributed 273、unattributed 5,406；`pageKindByBaseType` 分别保留了 source base type 分布。当前 158/158 聊天都没有可用的 per-chat published roster scope，`scopeUnavailablePages=17,959`。报告明确为 `speakerAccuracy=INSUFFICIENT_EVIDENCE`；这次结果只能说明候选分母和内容形态可分开统计，不能证明 273 条说话人归属正确。

记录误挂保护在合成验收中通过；历史回放的 record category 为 1,910 页，stage-2 结果不会为该类别投影 speaker anchor。source chat 在每个回放内部复读摘要一致，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。v4 的 `structuralEvidenceValidity=1` 仅代表 evidence provenance/schema/span 校验通过，不代表语义准确率。

### v5 续页候选修正与回放补充

代码审计前增加了一个有界修正：如果已生成的生产页 core 与完整消息中由 roster-independent quote/direct-cue scanner 确认的对白候选 span 相交，该页计入 candidate；因此跨页引语的续页即使本页无引号字符也会入分母。候选 span 在 Stage 2 speaker attribution 前建立，Stage 1 只读取 `dialogueCandidateSpans`，不读取 anchor、speaker、角色名单或 unresolved attribution。扫描不可靠的 ambiguous quote span 不会自动成为对白候选。数值/记录保护与裸名称 quote attribution 限制继续按 §3 执行。版本统一提升到 `full-message-speaker-index.v5`，使旧缓存失效。

测试新增生产分段器下的具名与未归属跨页引语；两者第二页均为无本地引号标记的原始 narration core，但分别正确记作 attributed / unattributed dialogue candidate。Stage 1 单独以 candidate span 输入即可分类，没有读取 Stage 2 anchors。分页器和正文 DTO 未修改。

v5 初次只读回放连续运行两次，source digest 和摘要完全一致：`sha256:dfd428e6be010536aa4a732c402115633ecb0b1c17d724f6f776d3f2ee88ef1b`。随后主控独立复验时，聊天源摘要已变化但条数不变，故以最新稳定快照为本报告最终数字：digest `sha256:d0e0b269190f2be28f23ade8efc9106ec6612bad07e01451da2ea31f3b13d108`，两次结果完全一致。每轮扫描 158 个聊天文件、935 条 assistant 消息、18,044 个 production pages；类别为 attributed dialogue 288、unattributed dialogue 5,823、structured record 1,841、heading 78、narrative 9,454、ambiguous 555、unaddressable 5。candidate denominator 为 6,111，其中 288 attributed、5,823 unattributed。主控两轮 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；没有 gold，因此 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。因聊天快照与 v4 replay 不同，v5 数字不用于声称只由本修正造成净变化。

v5 targeted suite 70/70 通过；player 构建成功；静态架构审计 `ok=true`、`prohibitedActiveCount=0`、`needsReviewCount=0`、`failedChecks=[]`；`git diff --check` 无 whitespace error（仅工作区 CRLF 提示）。生成输出只涉及 `public/game/**` 与共享适配器 parity 文件 `public/game-admin/shared/sillytavern-adapter.js`。

### 评估与余项

本阶段有效改善的是诊断口径和明确记录/标题行的说话人误绑保护：此前单一 `unknown` 桶拆分成 dialogue candidate、记录、标题、叙述、ambiguous 和不可寻址；候选分母缩小到能实际评价 speaker coverage 的对白候选。当前 v5 仍有 5,823 个对白候选未归属以及 555 个 ambiguous 页，且 roster 不可用，故不应宣称识别“已整体准确”或跨剧本达标。下一步先完成独立代码审计，并补齐当前剧本真实发布 roster scope；随后以小型人工 gold holdout 评估 coverage/precision，再决定是否扩展结构形态。

## 11. v6 窄增量：复用 segmenter probable speaker hint（v6.1 实施与独立审计通过）

### 11.1 当前依据与范围

本增量针对历史结构回放里仍未归属的对白页，仅利用 production segmenter 已输出的说话人提示，不再扩展全消息结构扫描规则。v6 冻结诊断快照为 v5 replay digest `sha256:35887334956e9ff046d7d72f517812f2e7b2545e752cf3040ddde6070c933a3b`，共 158 个 chats、936 条 assistant 消息、18,072 个 production pages；对白候选总分母为 6,130 页，其中 292 attributed、5,838 unresolved。659 个 probable hints 是 5,838 unresolved 的子集，只是待精确 span 验收的提示数，不能预先等同于成功显示数，也不能作为准确率结果。该统计仅表示该 digest 下的候选计数，不代表真实 speaker accuracy；聊天历史此后仍有变化。

随后一次 v6 只读诊断使用了不同的当前聊天快照，digest 为 `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`：158 chats、939 条 assistant 消息、18,169 pages；candidate denominator 6,171 = 297 confirmed + 5,874 unresolved。该快照中 production segmenter 的四字段 probable hints 为 728。初始 v6 原型用完整消息 literal 全局唯一性检查，仅接受 92、拒绝 636；这是已被 v6.1 修正的过严映射规则的历史诊断结果，不是准确率或最终覆盖结果。636 个拒绝都至少有一个 name/action/quote literal 在完整消息内重复；非互斥字段计数为重复 speaker 591 页、重复 action 167 页、重复 quote 1 页，其中 123 页重复多个字段类型。另有 7 页在当前 page core 内重复了 speaker/action literal（speaker 3、action 4），它们是上述 636 拒绝的子集，不是额外互斥类别。v6.1 改为从当前 page core 的同一次 anchored parse 导出局部 code-point offset，再用 production `sourceSpan` 映射并逐段验证；消息其他位置的重复 literal 不再构成拒绝理由。

实施与回放使用的当前快照为 `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`。任何后续回放若 source digest 不同，须单独报告，不得跨 snapshot 计算净变化并归因于代码效果。

另一次同 chat cue-witness 探索模拟在 2,997 个位置中只有 9 个匹配，且 4 个候选发生字段标签冲突。该模拟不是 production evidence 或准确率评估；它说明不得依赖跨消息/邻近消息 cue-witness 机制扩张 speaker 推断。本阶段禁止实现或继续优化该模拟。

### 11.2 唯一准入来源

probable display-title 候选必须直接复用当前原版可见消息经现有生产 segmenter 生成的当前 page segment，且以下四个字段同时精确成立：

```text
type = dialogue
speakerConfidence = inferred
confidenceBand = probable
speakerOrigin = runtime-text
```

这些元数据必须来自已有 `parseNarrativeDialogueParagraph` 的 name + action + quote 识别路径。v6 不修改或重跑一个替代版本的该识别器，不另加名称表、同义词、标点/句式规则、semantic model 请求或消息上下文猜测。以上字段仅授权尝试产生推测标题，不代表确认身份。

### 11.3 只读标题 evidence 与优先级

候选通过全部四项后，title-only sidecar 必须对同一条当前完整可见 assistant 消息及同一 production page `sourceSpan` 建立并验证精确 Unicode code-point spans：speaker name、action cue、quoted speech 三者都必须从当前 page core 的精确 `sourceText` 与同一个 anchored parse 直接导出，包括 connector、引号和 trim 规范化后的 offset 映射。production `sourceSpan` 将这些 page-local code-point offsets 唯一映射到完整消息；再将 offset 加上 core 起点，并核验 `chars.slice(start,end).join('') === 原文片段`、三个 span 有序且完全位于 core 内。evidence 同时绑定原始完整消息 hash、source message index 与 page core。消息其他页面出现相同 name/action/quote literal 不构成歧义，不得据此拒绝；不得用完整消息 `indexOf` 搜索后取第一个匹配。若 anchored parser 无法证明局部映射、offset 与原文不符、字段缺失、任一 span 越界/跨 core、原文重读 hash 不一致或当前 core 改变，直接拒绝推测标题，保留现有标题状态。page core 内的重复 literal 只有在 anchored parse offsets 仍无法唯一确定具体 occurrence 时才拒绝；解析位置明确时仍可接受。

仅当该页当前没有有效语义标题、没有现存且独立验证的 explicit structural speaker evidence，且不属于结构记录/独立标题优先类别时，才可附加 display-only 标题；显示格式必须明确为“`<原文姓名>（推测）`”。已确认的语义/explicit structural title 优先，record/heading 分类优先于 probable；已有旁白、状态、正文、未识别等 semantic 分类绝不可由该提示改写。v6 不把裸 `Name: “quote”` 当作候选或 explicit evidence，也不重解释任何既有、独立验证的 explicit 标题。原 `segment` 对象及其字段保持只读，标题附加到已校验 page-title sidecar。

该推测标题不得改变语义标签、identityRef、角色身份、头像搜索/唯一绑定、roster、装备/队伍/游戏状态、聊天、存档或剧情。不得在分页、semantic analyzer 输入或 prompt 中使用该 sidecar。不得跨 assistant 消息或 page core 传播候选；除现存且未更改的 v5 同消息开放引语合同外，不引入任何 continuation 规则。

### 11.4 明确禁止的推断与不变量

- 不使用跨消息 cue-witness、原版 `message.name`、最近 speaker、角色名出现频次/重复标签、无共同引语跨度的相邻页 speaker、其他角色/语义/roster 数据反推候选。唯一跨页例外按 v7 11.7 执行。
- 裸 `Name: “quote”` 不构成本阶段候选或 speaker 证据；不因冒号名称或 quote 形式生成“推测”标签。
- 不改原版 SillyTavern 代码/配置/extension，不改或写回 chat，不触碰正文内容、formatter、segmenter、production page type/text/sourceText/sourceSpan/index/order/count 或任何 paginator。
- 对页面数组增加 sidecar 前后，对 `index/type/speaker/text/sourceText/sourceSpan` 做深相等断言；格式化与分页代码不应出现在 v6 diff 中。语义 DTO/service、身份/头像/roster 和 visual resolver 均不得变化。

### 11.5 回放分桶与验收

历史只读回放保留已有非对白 page-kind 互斥统计，并将对白候选按 mutually exclusive outcomes 分桶：

1. `confirmedAttributed`：现有通过验证的 semantic/explicit speaker attribution；不得仅凭底层推测字段称为 confirmed。
2. `probableDisplayTitle`：四字段准入、当前完整消息 hash、name/action/quote exact spans 与 page core 全部验证通过，且实际可显示“（推测）” sidecar。
3. `unresolvedCandidates`：对白候选但前两类均不适用或 exact-span 校验失败。

回放必须同时给出总 candidate denominator 及三类互斥计数，并单独列出 `scope-unavailable`、record/heading、narrative、ambiguous 与 unaddressable。冻结基线绑定 v5 replay digest `sha256:35887334956e9ff046d7d72f517812f2e7b2545e752cf3040ddde6070c933a3b`：candidate denominator 6,130 = 292 attributed + 5,838 unresolved；659 probable signals 属于这 5,838 个 unresolved 候选内部。该数据是旧快照的历史基线。v6.1 当前快照结果见下文；不得跨不同 source digest 比较净变化并归因于代码效果。所有报告继续使用 coverage/counts；无 gold sidecar 时 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。

v6.1 最终验收：同一只读历史快照双跑摘要一致，digest `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`；每轮 158 chats、939 assistant messages、18,169 production pages。candidate denominator 6,171 = 297 `confirmedAttributed` + 664 `probableDisplayTitle` + 5,210 `unresolvedCandidates`；four-field hints 728，span validated 728、rejected 0。该 hint 子集互斥分桶为 728 = 664 `probableDisplayTitle` + 64 `confirmedAttributed`；这 64 条均是 `pageKind=attributed-dialogue`、`kind=speaker`、`ruleId=quoted-attribution`，属于 297 confirmed pages 的子集，不是 span rejection，也不是额外加到 candidate denominator 的第四桶。该细分由同一 digest 的 replay predictions 与 production segmenter 页按 chat fingerprint/message index/page index 在内存关联复核。回放为只读，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；本次分项分析未修改代码或聊天。这些是分类/覆盖计数，不是正确率；无 gold 且 per-chat scope 不足，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。

v6.1 定向测试 74/74 通过，player-only build 通过，静态架构审计通过（`prohibitedActiveCount=0`、`needsReviewCount=0`、`failedChecks=[]`），`git diff --check` 通过；独立代码审计 PASS。分页/正文 forbidden-path diff 为零，原版 SillyTavern 源未改，聊天未写入，无 provider 请求。浏览器端与移动端的真实 UI 验收尚未执行，不能据此声称前端实际显示已通过。代码阶段验收完成；后续 accuracy 评估需先建立按剧本 scope 的 gold holdout。

### 11.6 v6.1 实施文件与隔离边界

- `frontend/shared/src/sillytavern-adapter.js`：只消费已有 segmenter probable 字段，并从同一次 anchored current-page parse 推导 page-local name/action/quote offsets；按 exact core + sourceSpan 转成 full-message spans 后验证，不做全消息 first-hit 搜索；不得修改 `parseNarrativeDialogueParagraph` 的识别结果或 production segment。
- `frontend/player/src/main.js`、`frontend/player/src/presentation-renderer.js`：验证 sidecar provenance/span/hash，按优先级显示带“（推测）”的 label-only 标题。
- 对应 shared adapter、runtime regression、renderer 与 `frontend/player/tools/speaker-structure-replay.mjs` 测试：验证证据边界及互斥计数。构建输出只更新实际需要的 `public/game/**` 文件；只有静态 parity audit 要求时，才同步 `public/game-admin/shared/sillytavern-adapter.js`。
- 禁止触碰 SillyTavern 原版路径/config、语义分析 service/DTO、聊天/存档、source formatter/segmenter/paginator、身份/头像/roster 和 `public/game-admin` 其他输出。

### 11.7 v7 probable 同引语跨度续接

**目的：** 处理正文分屏后没有局部署名、但其实仍位于前页已识别 probable 对白同一条引语中的页面。它是标题覆盖规则，不是提升语义置信度的规则。

**允许流程：**

1. 当前页先走所有既有有效语义和 structural evidence；本地 production probable title 也优先。
2. 只有当前页仍无标题、语义允许显示 probable、当前页不是 record/heading 时，才检查早前 source pages。
3. seed 只能是另一页现成生产 segment，四字段为 `dialogue/inferred/probable/runtime-text`，且同一 anchored parser 已从该页 core 证明精确 name/action/quote source spans 和完整消息 hash。
4. 从同一个 `createStructuralMessageSpeakerIndex` 的 `unresolvedDialogueSpans` 中取与当前 core 相交的所有 `unattributed-quoted-speech` span。seed 只可取同一原版消息的紧邻 `pageIndex-1` 和 `pageIndex-2` 生产页；不允许跳过中间页、跨消息或跨超过两页。每个 span 都必须与窗口内至少一个原始 seed quote span 相交；全部 seed 归一化后必须恰好一个 speaker。
5. 输出 `probable-quote-span-continuation`，speaker title 附“（推测）”；speaker evidence 可引用窗口内 seed 的原文跨度，但 classification evidence 必须是当前页 core 内 quote 的精确交集。current/seed 都绑定相同 message index/hash 与各自 source page index。derived continuation 不得变成后续 seed；超过两页不滚动延伸。
6. 不将续接结果推入 seed collection；后续页仅重复引用最初仍可见的 earlier probable seed。有效显式归属优先；不匹配、冲突、空 quote、record/heading、跨消息、过期缓存均 fail closed。

**禁止扩大：** 不按“最近 speaker”继承；不把任意配对引号当归属证据；不因打开的引号标记从某个 speaker 来就把引号外旁白并入；不把 probable title 映射为身份、character visual context、头像占用、roster 或状态；不改 source message、正文、分页或 Annotation v1。

**历史决定（已 superseded）：** v7 当时因没有观察到 unmatched opener 样本，决定不启用两句 cap，以避免截断 2,331 个配对引语中 341 个长度超过两句的长对白。该决定只反对对配对引语一律截断，已由 parser v11 的 unmatched-single-opener 窄恢复取代；配对引语仍完整保留。当前规范见 §13.4。

**验收记录：** parser/version v9；当前 digest 的 6,172 候选中 462 confirmed structural、803 probable display、4,907 unresolved；其中旧的全前序候选回放统计到 160 continuation 页/160 quote-span links。该值尚不是两页窗口规则的回放结果。新回放必须重新测量 continuation 与 unresolved 性质；所有覆盖计数不是准确率。报告 unresolved candidates 时，分别统计 quote span 相交、前两页有效 speaker seed、同 quote 命中、闭合/跨页开放/无法判断、本地引号/线冒号/破折号/speech cue、原生产 page type 与候选证据来源。不得把缺少说话人证据改判旁白，也不得用这些计数宣称准确率。回放无 gold 时 accuracy 为 `INSUFFICIENT_EVIDENCE`，须 source unchanged / no writeback / no provider calls。正文分页与 source segment 对比恒等测试必须继续通过。

## 12. 两页回溯规则复测（2026-10-07）

实现已将生产与回放 seed 窗口统一限制为紧邻 `p-1`/`p-2` 两张生产页。当前原版聊天只读快照 digest `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`，158 chats、939 assistant messages、18,169 pages；candidate denominator 6,172 = 462 confirmed structural + 799 probable display + 4,911 unresolved。两页窗口覆盖 156 continuation pages/156 quote-span links。旧的 4,907 unresolved/160 continuation 和提问中的 4,283 no-seed 均是此前规则/统计口径，不能代表当前复测。

4,911 unresolved candidates 中，4,849 页与 `unattributed-quoted-speech` span 相交；引语状态为 4,833 closed、16 cross-page open。另 62 页无该 quote span，但依据当前已有本地 dialogue shape cue 进入候选。367 页在前两页内有经过 exact validation 的 probable seed；仅 10 页命中某个相同 quote，但这 10 页全部只覆盖当前多条 target span 的一部分，0 页通过全量覆盖条件。底层 production page type 是 3,734 narration 与 1,177 unattributed-dialogue；前者与完整消息引语 span 重叠时仍是对白候选，不能按底层类型直接改成旁白。4,544 页没有前两页 validated probable seed。

这些是形式与证据覆盖计数，不是 speaker accuracy。大部分页面确有引语形态，然而该页各引语无法被现有唯一 probable seed 证明为同一说话人；只能说当前结构证据不足以安全归属，不能断言先天无法归属。所有聊天 scope 均 unavailable，且没有人工 gold，因此不能证明 roster 已覆盖历史中出现的全部角色，也不能给出准确率。未确认对白和无 seed 页面继续保持“未识别”，不得据此改为旁白。

## 13. 人工校准样例与 parser v11 最小加固（2026-10-07）

本节是当前 parser v11 的有效规则；若与前文 v6.1/v7/v10 历史叙述中的 shape 优先级、action-before-quote 否定约束或 unmatched quote cap 评估冲突，以本节和两份 baseline 文档的 2026-10-07 补充为准。历史回放数字继续只代表各自版本与 digest。

### 13.1 当前收到的七条人工标签

| 样例 | 用户判断 | v11 采用的结构结论 |
| --- | --- | --- |
| 尼布翻开地图后紧接冒号引语 | 尼布发言 | 若“尼布”精确存在于当前已发布 roster，且角色名、同句短动作、冒号、引语连续出现，则归属尼布。无 roster 时不猜。 |
| 维克多男爵兴奋地说后接引语 | 维克多发言 | roster 命中“维克多”且出现直接说话 cue 时，允许名后有短称谓/方式修饰；仍须保留精确姓名跨度。 |
| “六个战力、十五个护卫……”一段 | 旁白 | 不能仅因全文某个 quote span 与当前页相交而判对白；普通未标记 prose 仍走原 narrator-title fallback。若配对引语跨页而本页语义不明确，则保留 ambiguous，不自动强判旁白。 |
| “南码头表面是鱼市和货仓……”一段 | Pippa 发言 | 用户核对原始完整消息后更正：这是 Pippa 已署名配对引语的无标记续页，应依据同一完整消息中的已归属引语精确归给 Pippa；不依赖当前续页自身的 quote marker。 |
| “选择一：继续守护……” | 游戏信息/选项 | 单行编号 `选择/选项` 加冒号纳入 structured-record 形态。当前 evidence 映射仍是现有 `status`/“状态”；不宣称 UI 已新增“游戏信息”或“选项”标签。 |
| 多行楼层/房间清单 | 游戏信息 | 两项以上列表继续归 structured-record；当前 `status` title evidence 显示为“状态”。 |
| “左侧通道：囚徒的哭泣与铁链的诅咒” | 新一幕首屏标题 | 仅当该 page core 从消息首个非空字符开始、符合受限短 `标题:副标题` 形态、且没有当前页强署名/说话 cue 时归 heading，映射到现有“正文”类。短人名/英文名冒号正文不得直接当标题；普通叙述冒号行例如“所以战术很简单：……”和“船队的情况：……”必须留作正文，不得误判为 heading。 |

前三/后几条是用户标注的第一批 calibration set，不是全量准确率。第 4 例的标签来源是用户核对原始完整消息后的更正：续页文本属于 Pippa 的配对引语，不是独立旁白；对应的 Pippa roster/paired-quote/marker-free continuation 真实上下文形态已加入 shared adapter 回归。样例 3 仍按其原有证据保留候选/ambiguous，不因缺少 speaker seed 自动改判旁白。每次人工判断会变成一个确定的回归用例；发生新旧标签冲突时，先向用户呈现两条结构相同的最小反例，不静默扩大规则。

### 13.2 优先级

生产页形态现在按以下顺序分类：

1. 已验证的当前页说话 anchor 或页面本地直接说话 cue；
2. 明确编号选项、字段/项目清单等结构记录；
3. 首个非空 source 页上受限的短 `标题:副标题` 场景标题候选：标题头 4–8 字、无“的/地/得”及常见叙述开头/谓词尾，副标题至少 10 字，且该 production page type 不是 dialogue/unattributed-dialogue。没有明确 scene marker 时，普通叙述冒号行不因“在首屏”自动成为标题；不匹配上述窄形态者保留原正文/ambiguous；
4. 与完整消息对白候选跨度相交的证据；
5. 既有 production page type 与普通正文 fallback。

未署名且仅在长 paired quote 里的续页，如果没有本地引号或精确前页 speaker seed，不能由“交叠”单一事实判定为角色台词；记录为 ambiguous/review。具有完整闭合状态的配对长 quote 不截断，跨页对白 candidate 合同仍有效。

### 13.3 用户确认的 rostered action-before-quote 规则

以下结构会把引语归属到动作前的角色：

```text
<exact published roster name><same-clause action phrase>：<quoted utterance>
```

硬条件：角色名必须与当前已发布 roster 的完整项精确匹配；同句动作短语为 2–18 个字符且无中断标点；冒号紧接在短语之后；后面存在当前引号扫描器定位的引语。没有 roster、只在引语正文里提及角色、动作后没有冒号，或冒号后没有引语时不适用。此规则来自用户对“尼布翻开地图：……”与旧同形 Pippa 样例的明确裁定。它只建立当前原始消息的 attribution/title evidence，不扩写成泛化动作词表，不更改 source body 或分页。structured-record当前仍使用 `status`/“状态”映射；本轮不新增 UI 标签，也不宣称已显示独立“游戏信息”或“选项”类别。若未来要求标题明确显示“选项”，必须单独审查 renderer 与 evidence validator 的公共枚举，不可从本形态判定中暗中扩协议。

### 13.4 两句 quote evidence 兜底（历史 v11，现由 v46 supersede）

- v11 仅对扫描结束时仍未闭合的上引号启用；该 unmatched-only 范围由 v46 扩展并 supersede。
- 扫描跨度最多到该未闭合开引号后的第二个 `。！？!?` 句末标点；第二句后剩余 source 作为独立 suffix 重新扫描。
- 少于两个句末标点时扫描到消息末尾；遇到结构冲突且在第二个句末之前无法确定边界时，仍保留 ambiguous。

## 13.8 Parser v46：具名动作回溯、代词续句与两句上限

- 用户本轮只确认第 2、3、4、5、6 条为活动校准；第 1、7 条标为旧消息，忽略且不得进入 gold。目标映射：第 2 条向上文寻找人物姓名，命中唯一主体则归该人；第 3 条归 Priya；第 4 条归旁白；第 5 条按第 2 条同规则；第 6 条归 Kael。
- 两句 cap 在第二个 `。！？!?` 句末后结束 attribution evidence；即使后面最终遇到闭引号，也将它忽略并从 cap 后扫描 suffix。只改变 title/quote evidence，不修改正文、formatter、生产 segmenter、page count/order/text/sourceSpan。
- `姓名 + 头也不抬地翻页/探出身体` 作为近期动作主体，可归属紧邻的独立 quote；动作姓名后的空格不影响匹配。已归属 quote 后紧邻的“她/他说 + speech cue”仅当窗口内明确 speaker 唯一时续接；存在多个 speaker anchor、另一个主语或场景分隔时保持未识别。`—Priya：` 形式按 line-speaker 标记。
- 样例回归覆盖用户的 Priya、Theo、Priya 行署名、Kael 四条活动 source shape，以及原始 Joe long quote 的第 3 句页面归旁白；没有把第 1、7 条旧消息作为证据。未知来源证据不足时保留既有 unknown 规则，不用全局“未识别对白→旁白”降级。
- cap 只缩短 attribution/candidate evidence span。生产 `sourceText/text/sourceSpan`、页数、顺序、segment 数组、formatter 和聊天正文必须深相等。

### 13.5 迭代校准闭环

1. 结构回放 CLI 默认只输出计数与证据类型，不输出聊天正文、聊天路径或 review queue。需要用户裁定时，由主控在独立只读步骤中从 unresolved/ambiguous 样本里人工挑选最多 5 条；给用户只展示匿名序号、消息/页号、当前分类、触发形态和不超过 80 字的脱敏截断摘录，不展示路径、chat hash 或其他身份信息。不要把合成回归用例称为历史 gold。
2. 用户裁定后将该样例固定到自动化 gold/fixture，并记录判定来自哪条结构证据；同一轮最多扩展有重复证据支撑的一条通用规则。原始样例未完整保留或只剩摘要时，只建立合成结构回归，不标记为历史 gold。
3. 写入正例同时写入最近的反例：无 roster、无冒号、引用正文仅提到角色、paired quote continuation、普通旁白和状态字段。
4. 先跑 parser 定向测试，再跑只读历史 replay；报告每个 gold 类别 precision/recall、unresolved/ambiguous 数量与 source digest。聊天快照变化时不做跨 digest 净增益归因。
5. 没有用户金标的数据继续显示“未识别”或保留原状态；不能为了减少 unknown 数而自动改判旁白。分页/正文快照深相等、chatWriteback=false、externalProviderCalls=0 是每轮硬门槛。

### 13.6 文件及安全边界

本增量限于 `frontend/shared/src/sillytavern-adapter.js`、`frontend/player/src/main.js` 的 parser version cache key、对应 shared/player replay tests、`public/game/**` 必需构建输出及本开发文档和 Native-first/Frontend baseline。不能修改 `src/**`、任何原版 SillyTavern 配置或 UI、语义服务接口、formatter、segmenter、production paginator、聊天/存档或身份/头像状态逻辑。v12 回归通过仍只证明有限人工样例和证据跨度，不等于全场景准确率。


### 13.7 parser v12：自我介绍与同消息代词回溯

用户金标1：无外部署名的首次自我介绍显示“？？？”，只改变 display title，classification 保持 `unattributed-dialogue`，`speakers=[]`，不创建 identity/avatar/roster；姓名检测窄化为中文姓名式自介加标点或英文 `My name is` 加姓名和标点。普通“我是不会让步的”“I am ready”为反例。用户金标2：`Celestia严肃地说：“……”` 归 Celestia，仅作现有 direct cue 的明确回归，不扩展 cue 字典。用户金标3：代词说话只在同一原版消息中向前最多两句（不得越过已识别场景标题 marker 或空行段落边界），且仅限代词引导的明确 speech cue/冒号引语；标题 marker 包括 Markdown 标题、独立“场景/新场景/Scene/地点/Location:”行及已识别的短标题形态。优先唯一 roster 姓名句首/主语，窗口没有新主体时才继承唯一临近显式 anchor；两条路径都检查标题边界。句内提及姓名不算主语。候选冲突、段落/标题边界、跨消息或无 roster 时保持未识别；speaker span 必须绑定原文中的已发布姓名字符。闭合的 Nibu 引语不得压过随后 Pippa 的新句首主体；多个叙述句首候选保持 unresolved。

`pronoun-backreference` 与 `unknown-self-introduction` 加入双方规则 allowlist/validator，parser 与 replay/cache key 升级为 v12。所有证据仅为展示层旁路，不改语义身份、视觉身份、正文和分页。78 项定向测试通过；回放数据与边界见 §13.8。

### 13.8 v12 只读历史回放

2026-10-07 在当前完整聊天快照上以 v12 规则只读扫描：158 个聊天文件、939 条 assistant 消息、18,169 个 production pages；source-set digest 为 `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`，与上一轮快照相同。结果：6,004 个对白候选页，其中 463 个结构确认归属、796 个只显示推测标题、4,745 个仍未解决；未解决引用跨度 4,688 页，57 页来自本地形态候选。页面形态另有 1,995 个结构记录、100 个标题、9,508 个普通叙述、557 个模糊页和 5 个不可寻址页。

v12 在本次回放中将 5 个姓名式首次自介标为 `unknown-self-introduction`；`pronoun-backreference` 命中为 0。原因边界：158 个聊天的 speaker roster/scope 全部不可用，且没有逐页 gold；所以结果不能证明归属准确率或大多数页面的判断正确。与之前同 digest 回放相比，候选分桶没有净变化：用户已确认的 Pippa 长引语仍会因回放 scope 缺失而留在 unresolved bucket。全程 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`，gold accuracy 为 `INSUFFICIENT_EVIDENCE`。

只读抽查最新聊天中的 unresolved 页面发现：

1. `你问玛赫拉旧丧钟井的具体位置和进入方式。玛赫拉把骨杖往地上一点……她从墙上的一张旧镇图……：“旧丧钟井在钟楼后街下面……”` 当前 pronoun rule 未命中；从上下文看很可能归玛赫拉，原因是引语前是动作+冒号而不是显式说话谓词，且动作引导片段超过当前短前缀形态。此类需要后续按用户金标确认，不应从单条样本宣称已覆盖。
2. `树影间，一个矮小身影……对方没有立刻攻击，只用尖细的声音说：“哎哟哟……”` 说话行为明确，但当页没有角色名或 roster anchor；结构规则只能保留未识别，不能把描述性称呼升级为人物身份。
3. `治疗与审问：格雷戈的情报` 是标题形态，却被“本地说话线索”宽泛子串扫描误收入 unresolved dialogue candidate。这里不是缺人物信息，而是候选分流误报（“审问”包含“问”）；应在后续窄化候选 cue，优先识别标题/冒号标题，不要向用户询问说话人。

上述样本从当前快照中脱敏摘录，未输出聊天路径或 hash。历史聊天只读、无 provider 调用、无写回。

### 13.9 v13 人工校准：叙述包裹对白与首页标题

用户新增三条金标：

| 样例 | 金标 | 结构处理 |
| --- | --- | --- |
| `你问玛赫拉……她从墙上的旧镇图指出位置：“……”` | 旁白 | 代词主语的动作/叙述子句接冒号引语，没有明确说话谓词；不回溯到先前提到的玛赫拉，不生成 speaker anchor，标题归旁白。 |
| `……对方没有立刻攻击，只用尖细的声音说：“……”` | 旁白 | 描述性/泛指主体配明确说话谓词但没有唯一 roster 人名时，整页仍是叙述框架；不得把“对方/身影”创建为人物身份。 |
| `治疗与审问：格雷戈的情报` | 首页标题 | `审问`中的末字“问”不能单独触发说话 cue。符合首屏标题形态时，优先分类为 heading，播放器显示“标题”。 |

v13 的归旁白规则限定在以上可见叙述包裹形态：代词主语 + 动作子句 + 冒号引语且无说话谓词；或泛指/描述主体 + 明确说话 cue + 引语，但没有 rostered/可验证姓名 anchor。它只生成精确当前页 span 绑定的 `narrative-framed-quote` display title evidence，`classification=narration,text=旁白,speakers=[]`；不改变正文、source page、segment kind、身份、头像占用、roster 或聊天。具名 roster speaker 的 `Pippa脸色认真了些：“……”` 继续归 Pippa；单独的 `“快走。”`、没有唯一先行人的 `她低声说：“……”` 继续 unknown，不把所有无名引语统统改旁白。

首页标题优先于弱的词尾 cue 候选；首屏短 `标题:副标题` 副标题门槛由 10 字放宽到 4 字，其余标题头长度与常见叙述谓语排除保留。renderer 对 `structural-heading-shape` 仅显示“标题”，保留 `other-visible` display classification，视觉角色保持 unknown，不派发 narrator/character identity。原版消息、正文格式化器和分页器不变。缓存/回放 parser key 升为 `full-message-speaker-index.v13`。

**校准测试**：两条旁白样例、首页标题样例、Pippa roster quote 正例、单独引语和代词直引反例进入 shared/projected-renderer fixtures 与离线 replay gold；gold 回放 3/3 命中。独立审计发现语义层已有 narration / other-visible overlay 时可能阻止首屏 heading sidecar 运行，且 narrator visual context 会先于 heading guard 生效；已修正主流程强制检查、标题 sidecar 缓存写入与 renderer unknown visual guard，并加入两类 semantic overlay 的集成测试。最终定向测试 80/80 通过、静态架构审计通过。该小样本不代表全历史准确率。其后追加的全量历史回放见 §13.10；回放未调用 provider、未写聊天。

### 13.10 v13 全量只读历史回放

应用 v13 后对默认本地聊天库连续跑两次，只输出汇总；两次 source-set digest 一致：`sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`。扫描 158 个聊天文件、939 条 assistant 消息、18,169 个生产页，耗时约 3.7–3.9 秒。分类结果：6,004 个对白候选页分成 463 `confirmedAttributed`、789 `probableDisplayTitle`、4,652 `unresolvedCandidates`；页形态为 5,904 dialogue candidate、1,978 structured record、248 heading、9,549 narrative、485 ambiguous、5 unaddressable。新增 `narrative-framed-quote` 命中 99 页；它表示规则覆盖，不是已验证正确率。

与 §13.8 同 digest 的 v12 回放相比：对白候选从 6,004 降至 5,904（-100），已确认归属保持 463，推测标题从 796 降至 789（-7），未解决候选从 4,745 降至 4,652（-93）；heading 从 100 增至 248、narrative 从 9,508 增至 9,549、structured record 从 1,995 降至 1,978、ambiguous 从 557 降至 485。总生产页始终为 18,169。变化是 v13 候选/页面形态重分流，不能解释为 100 条对白被正确归属。

未解决候选的结构侧画像：4,596 个候选页与完整消息中的未归属引语跨度相交，56 页只有本地形态 cue；849 页含说话 cue 词项、2,249 页有行首冒号形态、36 页破折号开头。按引语跨度去重后为 4,630 个 unique unresolved spans，共链接到 5,552 个生产页；其中 718 个跨度跨多个页，说明 page 数会重复计入续页，不能直接视为独立对白条数。前两页有 seed 的候选页为 340，但只有 10 页链接到同一精确 quote seed，且都是部分覆盖；剩余 4,586 页没有可用的前页 seed。本轮补入的直接说话 cue 规则在生产历史消息上恢复 128 个 utterance（`补充`72、`尖叫`24、`怒吼`8、`提醒`6、`咆哮`6、`回应`5、`插话`6、`低声道`1）。所有 158 个聊天均缺逐聊天 speaker scope，因此角色名无法可靠解析；speaker accuracy 仍是 `INSUFFICIENT_EVIDENCE`，不能由这些计数证明整体分类正确。三条例子 gold 3/3 只是窄校准集。

两轮均 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；聊天快照与 v12 digest 相同。本轮全量回放没有打印正文、chat path 或逐条预测。继续优化前应先对 99 个 `narrative-framed-quote` 命中做匿名抽样人工复核，并为未解决样本提供正确的 per-chat roster/scope；否则扩大归属规则只会增加未经证明的旁白/人物误判。

### 13.11 parser v15：同聊天重复显式角色名

#### 目标与边界

历史聊天缺逐 chat cast roster，导致后续页上的明确角色署名无法被原有名单匹配。允许复用同一聊天内部、此前多条消息里已出现的显式角色署名，作为标题解析的局部名字范围。此机制面向覆盖率，不宣称语义/身份确认，也不使用 LLM/API。

#### 算法合同

1. 为正在投影标题的目标消息建立结构索引时，只从当前 chat 中排在目标前面的 assistant visible messages 收集历史 anchor。只有现有结构规则的显式 speaker 证据可以成为候选，不采集 mention、旁白主体、标题、结构记录、概率推测或引语自报；当前及未来消息不能倒灌到此前标题。
2. 同一个精确姓名须至少出现在两个不同、更早的 `sourceMessageIndex`，才进入 observed-name 集合。重复同一条消息内的名字或同索引副本不增加计数。排除已发布名单中的同名项，排序后生成稳定 fingerprint。
3. 该集合只与当前发布角色名一起传给完整消息标题证据索引；每条输出仍受既有精确原文/hash/span 与规则 validator 约束。缓存键包含目标时间线游标、此前 observed-name fingerprint 与 `full-message-speaker-index.v15`。
4. 作用范围仅是可见标题。不得向 production formatter/segmenter/page construction、semantic analyzer、提示词、identity/avatar/roster projection、存档或聊天写回传递 observed names。播放器中的 collection 以 snapshot + 目标游标为 key，切 chat 或向历史页移动后不得复用未来前缀。
5. semantic `unattributed-dialogue` 页可能由旧 production base segment 给出“旁白”显示值；这不是 speaker authority。仅当没有有效 narration-framed title 时，允许 validated structural/probable title sidecar 替换它，语义 identity 仍 unknown。

#### 文件范围

- `frontend/shared/src/sillytavern-adapter.js`: chat-local repeated explicit-name collector and parser version.
- `frontend/player/src/main.js`: per-snapshot collection, cache fingerprint, title-only wiring and fallback-priority correction.
- `frontend/player/src/presentation-renderer.js`: allowlist for the existing explicit anchor rule used by collector.
- `frontend/player/tools/speaker-structure-replay.mjs`: read-only replay of same-chat observed names; source segmenter always uses published roster only.
- Corresponding shared/player tests, these docs, baseline docs, and only required `public/game/**` build output.
- Forbidden: all `src/**`, original SillyTavern UI/backend/config, game chat JSONL, formatter/production segmenter/paginator implementation, semantic service contract.

#### Acceptance evidence

- Two distinct explicit anchor messages enable a third message's exact name structure; one message, duplicated index, weak mention, action-only, or cross-chat anchor does not.
- Two explicit anchors occurring after a target message cannot resolve that earlier message; moving the cursor forward may resolve only messages after the second anchor.
- Source segmenter page count/order and each page's `type/text/sourceText/sourceSpan` are identical with and without observed names.
- Same quote-span continuation regression renders probable title while the semantic type and identity remain unchanged/unknown.
- Replay is read-only, has no provider call or chat writeback, runs twice with identical source digest and page count. Report newly covered spans/pages separately; accuracy remains `INSUFFICIENT_EVIDENCE` without gold.
- Independent read-only audit passes, target tests, static architecture audit, player build, and `git diff --check` pass. SillyTavern source freeze stays intact.

#### Known limitation

Two repeated explicit messages may still describe an NPC or refer to a speaker imperfectly if historical text itself is wrong. This fallback only allows exact structural matching against repeated explicit anchors; it does not make an incomplete or contradictory transcript authoritative. Ambiguous candidates remain unknown-safe.

#### First full-history replay after temporal-scope correction

Read-only replay digest `sha256:19f55f7d9079150dbf9ab29cc732e3caa9b8ec45ecafaf8ef15d7463191983cf`: 158 chats, 942 assistant messages, 18,293 source pages. Of 6,064 dialogue-candidate pages, 1,434 were structurally attributed, 542 received probable display titles, and 4,088 remained unresolved. One chat supplied 15 repeated explicit observed names. These are v15 coverage counts, not a measured increase over v13: the active chat changed during adjacent runs, so there is no same-digest v13 comparison. All 158 chats still lack complete per-chat roster scope, and no gold holdout exists; accuracy remains `INSUFFICIENT_EVIDENCE`. This run verified `sourceUnchanged=true`, `chatWriteback=false`, and `externalProviderCalls=0` for its own captured snapshot.

## 14. Parser v26 implementation and same-snapshot replay (2026-10-07)

### Generalized rules

- A unique rostered subject can own a colon-introduced quote after a bounded action/description clause, including an explicit connector plus speech predicate. The rule rejects a coordinated second person/role even when that second actor is absent from the roster; multiple actors are never collapsed to the sole rostered name.
- Compact speech-act cues cover direct/indirect turn-taking forms; a `Name 的回合：` header may anchor the dialogue turn. Player em-dash quotes are counted as dialogue candidates and attributed to `你` when the source span is valid.
- Map/chart, letter/ledger, inscription/document, system/status/check information frames outrank weak nearby action attribution and display as narration. Explicit direct speech remains stronger than a weak information-frame guess.
- Only display-title evidence changes. No identity, roster, avatar, source text, production page, formatter, segmenter, paragraph merge, pagination, chat, or original SillyTavern code is changed.

### Verification

Independent audit: PASS. Adapter tests passed; replay tests 25/25 passed; syntax, scoped `git diff --check`, static architecture audit, and static DOM smoke passed. Player public build was staged and verified before sync; 18 of 33 existing player output files were updated from the canonical build, with zero removed. Only the shared adapter was synchronized in `public/game-admin`; all other admin output stayed in place. Pre-sync backup: `.codex-build-stage-speaker-v26/backup-before-public-sync`.

Full-history replay, identical source digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`, v25→v26: 5,548→5,662 dialogue-candidate pages; 2,606→2,969 attributed pages; 255→211 probable-title pages; 2,687→2,482 unresolved candidate pages; 2,831→2,600 unique unresolved quote spans; 3,004→2,744 quote-span/page links. Active campaign same digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`: 4,121→4,233 candidate pages, 2,585→2,948 attributed, 1,536→1,285 unresolved.

A deterministic 24-page sample from the active campaign's v25 unresolved bucket had 14 likely structural misses, 6 likely continuation cases, 1 narration/information quote, and 3 genuinely ambiguous cases. This is a directional sample, not a gold set. The current 158-chat replay has no complete per-chat roster and no independent page-level labels; speaker accuracy remains `INSUFFICIENT_EVIDENCE`. Replay verified `sourceUnchanged=true`, `chatWriteback=false`, and `externalProviderCalls=0`.
## 15. Parser v27：主体动作引语误归属收敛（2026-10-07）

### 规则与审计修正

v27 针对 unresolved 抽样中占比最高的“明确主体 + 动作/状态/说话线索 + 冒号/引语”结构做有限泛化，利用现有 roster 约束，不加入角色专名规则。独立审计首轮发现“心想”内心独白及展示/递交地图后的引文会误归给角色；实现据此保留未知，不将思维内容或可能来自物件的文字认作口头发言。第二轮独立复审通过：`Pippa心想：“…”`、`Pippa展示地图：“…”`、`Pippa把地图递给你：“…”` 均无 speaker anchor；明确 `Pippa说/喊：“…”` 和已确认的 `Pippa翻开账本/地图：“…”`、`尼布翻开地图：“…”` 仍归属。

### 同一活动聊天快照回放

活动聊天 digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`，435 条消息、11,840 页。v25→v26→最终 v27：候选页 4,121→4,233→4,242；归属页 2,585→2,948→2,991；未解决页 1,536→1,285→1,251。完整历史库同 digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`：158 chats、950 assistant messages、18,562 pages；v25→v26→v27 候选页 5,548→5,662→5,671，归属页 2,606→2,969→3,012，probable 标题页 255→211→202，未解决候选页 2,687→2,482→2,457，唯一未决引语跨度 2,831→2,600→2,572。最终全量回放 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。这些是同快照覆盖变化，不是准确率；没有逐页金标准，speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。

适配器与 replay 定向套件通过（最终复审范围 26/26）；独立审计 PASS（限定上述句法及反例）。本轮没有修改正文 formatter/segmenter/paginator，也没有改动 SillyTavern 原版源文件。完整历史 replay 与 v26 使用相同 source digest，故可直接比较；仍不能把覆盖计数称为准确率。

## 16. Parser v28：后置 cue 与明确集体发言（2026-10-07）

### 实施范围

v28 在现有结构索引中补入少量、可验证的句法关系，而不按角色专名或台词内容加规则：

- “动作，随后/然后 + 明确说/喊/问等谓词 + 引语”可以归给唯一已发布主体；显式玩家主语同理归“你”。
- 配对引语后的明确 roster 姓名或“你”加说话 cue 可作为后置归属；常见头衔仅用于连接 roster 姓名，speaker/source span 不包含头衔。
- 角色群体称谓只有伴随明确发言 cue 才产生群体 speaker；纯动作群体、无谓词引语不归属。
- 未知代词、无说话谓词的身份描述、心声、墙面/系统来源、竞争主体以及无锚点开引号继续 unresolved。

这些 evidence 仅用于标题 sidecar；不改变 `createVisualNovelDisplaySegments`、正文 source span、段落、分页、身份或聊天。

### 固定快照回放

活动聊天 digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`：v27→v28 为 4,242→4,266 个候选页，2,991→3,033 个明确归属页；v28 当前统计含 187 个 probable display-title 页、1,046 个 unresolved 候选页、1,097 个唯一未解决引语跨度、1,217 个跨度到生产页链接及 110 个跨页 unresolved span。活动回放 435 条消息、11,840 页。

全历史 digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`：158 chats、950 messages、18,562 pages；v27→v28 候选页 5,671→5,695，明确归属页 3,012→3,056，probable 202→202，unresolved 2,457→2,437，唯一 unresolved span 2,572→2,553。v28 当前 unresolved span-page links 为 2,690，跨页 unresolved span 为 127。两个 digest 均 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。覆盖变化不等同于正确率；缺少逐页 gold labels，speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。

### 验证与边界

适配器测试、replay tests（25/25）、语法检查和 scoped diff check 通过。测试包括动作后明确说话、玩家动作/后置说话、带头衔但精确绑定 roster 名、明确集体发言；负例包括未知后置代词、匿名身份描述、没有发话谓词的群体动作、墙面铭文、系统提示及无锚点开引号。没有改动原版 SillyTavern 文件、聊天文件、provider 配置或正文分页/合并逻辑。准确率仍未验收，独立只读审计待完成。

## 17. Parser v29：行首英文 System 元数据（2026-10-07）

审计发现 `System: “Encounter begins.”` 与大小写变体 `SYSTEM: ...` 被计为 unresolved dialogue candidate。`isStructuralRecordShape` 现在将行首 `System:` 字段识别为结构化游戏信息，排除在对白候选分母外。分类器仍先检查经过校验的消息级 speaker anchor，因此当前 roster 精确包含 `System` 且有显式行首说话标记时，角色对白优先，不会被通用元数据过滤。测试分别覆盖未 roster 的两种 metadata 写法和 rostered `System: ...` 角色行。

由于候选形状与标题 memo 语义变化，结构解析缓存版本由 v28 更新为 v29。此变动只影响显示 evidence 与 replay 类别；不修改正文 source、segmenter、formatter、段落、分页、原版 SillyTavern 或 public build。

v29 验证：adapter 与 replay suites 27/27 通过；语法检查、scoped `git diff --check`、静态架构审计和静态 DOM smoke 通过。目标样例回放确认无 roster 的 `System:`、`SYSTEM:` 两页均归 structured-record、dialogue candidates 为 0；rostered `System: “The gate is open.”` 仍是明确角色对白。全历史 digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`（158 chats、950 messages、18,562 pages）计数与 v28 相同：candidate 5,695、attributed 3,056、probable 202、unresolved 2,437。活动聊天 digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`（1 chat、435 messages、11,840 pages）也与 v28 相同：candidate 4,266、attributed 3,033、probable 187、unresolved 1,046。两次历史 replay 均 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。stage-build 后 33 个 player 文件及 22 个 admin 文件逐项 SHA-256 与生成结果一致；构建前备份位于 `%TEMP%\SillyTavern-speaker-v29-public-backup-20261007`，未删除任何输出。覆盖统计不代表准确率；speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。

独立审计确认本轮新增的 v27–v29 说话人/信息分类逻辑没有新增分页或正文逻辑；但累计工作树相对 Git HEAD 仍有早先的 connector 合并条件及 `createPresentationPagesForMessage` 页面构建差异。这些变化不是本轮新增，历史回放证明本轮投影保留现有生产页和 source span；未据此声称累计工作树与 HEAD 或此前基线分页行为完全相同。

## 18. Parser v30：无 roster 的明确说话主体与玩家后置发声（2026-10-08）

### 结构规则

- 明确且唯一的角色样式主体，后接受限的地点/动作修饰并以说话谓词引出冒号引语时，可以在没有完整发布 roster 的情况下归属该引语。该规则从当前消息的本地句法提取姓名和原文 span，不加入角色名或台词特例。
- 已有 rostered speaker 和旧版 action-attribution 规则优先，避免改变既有规则来源；source/document/system/status frame 和心声判断优先于弱动作主体。多人并列、群体或身份描述没有经验证的单一说话 cue 时保持未归属。
- 引号后玩家动作只有带明确“怒吼/喊/说”等发声 cue 才归“你”；普通动作不能反向取得引语归属。唯一同消息具名锚点后的代词回指保留既有两句窗口；多个竞争主体不归属。
- 结构缓存/replay parser 版本提升至 v30。该版本只影响展示标题 evidence，不修改正文、source formatter、production segmenter、段落合并、分页、身份/队伍状态、聊天或原版 SillyTavern。

### 测试与固定 digest 回放

定向适配器和 replay 测试 28/28 通过（replay 子套件 27/27）；覆盖未 roster 的单主体明确发话、source-frame 优先、多人并列负例、玩家后置发声和非发声动作负例、引文墙文/昵称负例、唯一/竞争代词先行项。回放为只读：`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

同一活动聊天 digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`（435 messages、11,840 pages）对比 v29→v30：对白候选 4,266→4,277；明确归属 3,033→3,171；probable display title 187→154；未解决候选 1,046→952；唯一未解决引语跨度 1,097→980，span/page links 1,217→1,089。

完整历史 digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`（158 chats、950 messages、18,562 pages）v29→v30：候选 5,695→5,706；明确归属 3,056→3,196；probable 202→168；未解决候选 2,437→2,342；唯一未解决跨度 2,553→2,434，span/page links 2,690→2,560。v30 未解决集合仍混合引语跨度与本地形状项：2,296 页与已登记引语跨度相交，46 页只有本地形状线索；底层 page type 为 `unattributed-dialogue` 1,177、`narration` 1,165。此结构统计不是准确率；没有逐页金标准，speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。v30 独立架构审计与 DOM smoke 通过；public player/admin 输出已构建并同步，备份在 `C:\Users\T14S\AppData\Local\Temp\SillyTavern-speaker-v30-public-backup-20261008`，hash parity PASS（33 player、22 admin，无 current-only 文件被删除）。累计分页差异仍受早期未审计工作树改动影响，本节不声称相对 Git HEAD 的分页等价性。


## 19. Parser v31：首句转述框架与唯一动作主体（2026-10-08）

### 结构规则

- 对“角色的第一句话是/角色醒来后的第一句话是/醒来后角色说的第一句话是”这类明确报告句，只在可抽取唯一姓名、原文姓名 span 精确有效时归属被引述的首句。代词、标题标签、来源物、心理活动不当作姓名主体。
- 无 roster 的唯一具名主体在有限动作子句中持续为主语，并以冒号引出引语时可归属；并列主体、后续另一个姓名、人物代词或身份描述会阻止单人归属。只接受现有结构动作词族，不扩大到任意“姓名 + 一段正文”。
- 墙面/地图/账本/系统等信息来源、心声、开篇标题、无锚点引语仍为负例。结构证据必须映射到已有且 source span 有效的 production page；遇到不可寻址分页保持现状，不修正分页。
- parser/cache 版本提升为 v31。仅影响标题 evidence，不改正文、formatter、segmenter、paragraph merge、pagination、聊天、身份或原版 SillyTavern。

### 测试与固定 digest 回放

combined adapter/replay 命令 29/29 通过；v31 replay 用例确认两种首句转述形式及一个醒来后报告形式可映射到当前有效 page span；唯一动作主体可归属；多人动作、心声、记录来源、标题样式和裸引语均不生成 speaker anchor。回放子套件 28/28 通过。回放只读，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

v30→v31 在相同活动聊天 digest `sha256:d267e330cf5dcd81f8bcfe0874fbd7bb7e504fb60e454d31294ae0a0aeecabfb`（435 messages、11,840 pages）没有命中新增句式：候选 4,277、明确归属 3,171、probable 154、未解决 952、唯一未决跨度 980、span/page links 1,089，均不变。

完整历史 digest `sha256:741b9b8d5c3a41fc2e6fa3cde2ffa67379cf72916d1377aed34fedc63ad86640`（158 chats、950 messages、18,562 pages）同样未命中新增句式：候选 5,706、明确归属 3,196、probable 168、未解决 2,342、唯一未决跨度 2,434、links 2,560，均不变。v31 因而通过结构性合成回归，但没有改善当前历史库覆盖计数；不能将规则测试命中当作历史准确率。speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。独立审计通过后已同步 public build：33 个 player 与 22 个 admin 文件 SHA-256 一致，构建前备份 `%TEMP%\SillyTavern-speaker-v31-public-backup-20261008`；无 current-only 文件被删除。静态架构审计、DOM smoke 和构建态 syntax 检查通过。

独立审计指出首句报告规则对未登记的 2–4 字汉字主体存在有限误收风险；该线索只有原文明确说“某主体的第一句话”且姓名 span 可精确定位时才可用。无 gold holdout，不能宣称其精度；若运行中出现错误标题，应先增加相同结构的反例并重放。


## 13.9 Parser v47：破折号署名的独立说话提示句

用户将五个历史候选标为：前四条 Andrei、第五条 God。共同形态是引语前的独立短句 `—<姓名><有界叙述修饰><明确说话谓词>。`，如 `—Andrei低声说。`、`—God缓声说。`。v47 不枚举全部语气词，而是接受姓名后至多 64 个字符的句内描述，只要署名短句最终以明确发言动词结束；这样可覆盖 `哑声说`、`平稳地说`、`清楚地说` 等同类句式。若最后的说话谓词由另一位具名角色或明确代词主体引出，则拒绝把引语归给破折号后的首个姓名。v47 仅在以下条件同时成立时归属：

- 署名以 `—`、`–` 或 `-` 起始，后接 2–8 个汉字人名或首字母大写的拉丁姓名；
- 署名句以明确说话谓词（说/道/问/喊/回应/补充/解释/提醒/低语等）结束；姓名与谓词之间允许最多 64 个字符的有界叙述修饰；
- 该句是同一原版消息中引语前紧邻的完整短句，之后只允许极少空白；
- 如果署名句后半段明确切换到另一个具名 speaker（如 `—Anna看向张三，张三低声说。`），应归给最后这个发言主体；否则归给破折号署名的姓名。无论哪条路径，speaker span 都必须精确指向原文姓名，不能把动作/语气词并进姓名。

不从 `—Andrei站在阵眼边缘。` 之类动作句、没有破折号的 `Andrei低声说。`、账本/地图等物件动作或附近提及姓名推断。此规则只添加 display-title evidence；不创建持久身份、视觉身份、roster 或剧情状态。不得改动 formatter、segmenter、production page 数量/顺序/text/sourceText/sourceSpan、聊天数据或任何 SillyTavern 原版文件。

五条用户校准样例和 `Anna哑声说`、`Timmy…清楚地说`、`Black平稳地说`、`Bubbles闷声说` 等同形句进入定向自动化回归，另有动作句/无破折号/物件动作/代词换主语/第二姓名换主语反例。当前没有把合成 fixtures 冒充完整历史 gold；历史准确率仍须按同一快照只读回放并单独报告。

## 13.10 Parser v48：破折号姓名直接归属相邻引语

用户确认同系列的通用规则是“破折号后就是姓名”，因此 v48 将署名姓名本身视为归属 cue，删除“必须出现明确说话谓词”条件。`—姓名 + 动作/描述短句 + 句末标点 + 紧邻引语` 归给该姓名，包括 `—Michael 站在裂光中。 “审判进入执行。”`、`—Timmy 抓着 Bubbles 的外套。 “我没有松手。”` 和先前被 v47 排除的 `—Pippa翻开账本。 “这里有线索。”`。对于这类句式不再根据引语内容或句中其他人的提及改判。

范围仍有界：同一条消息、引语前最近一个句子、破折号起始、可识别姓名以及可精确映射的原文姓名 span；不跨另一完整句、消息或场景，不从无破折号的相同动作句触发。此为 display-title projection only，不改变 body、segmenter、分页、source span、身份、roster、聊天写回或原版 SillyTavern。

v48 回归包括用户给出的 Lucifer 样例、动作型署名、Pippa 账本反例转为正例、无破折号和非相邻引语负例，以及“引语内容看似另一角色发言仍按署名人归属”的硬规则。验证：adapter 测试 1/1 通过；speaker replay 测试 38/38 通过。完整只读回放同 v47 digest：18,562 页、5,679 对白候选页；归属页 4,237（较 v47 +128），首次匿名 105（-13），未归属候选 1,253（-115）。证据 17,798/17,798 有效，0 个不可寻址页。speaker roster scope 158 个聊天均不可用，故准确率仍为 `INSUFFICIENT_EVIDENCE`；计数变化表示覆盖分桶变化，不是准确率。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

## 13.11 Parser v49：配对引号优先与最近人工标签

回放中发现旧扫描器把引号里的第二个句末符当作强制终止，即使后文存在配对闭合符。这使长对白在结构证据层被截成未闭合片段。v49 先扫描实际配对闭合符；只有消息尾仍未闭合时，才把证据在第二个句末边界强制收束并独立扫描后文。该修正不动 production segmenter、页数组或正文 source spans。

此外，人工标签形成以下粗规则：第一人称自述/宣言紧接 `你` 的实际动作时归玩家；`它` 动作冒号引语只能回溯同消息内唯一最近显式说话者；攻击/伤害/检定记录后的短 `成功/失败` 归旁白；多条引语须处于消息/传闻语境，并由本段或紧邻短段的人群欢呼描述支持，证据范围不能延伸到下一位具名说话者的台词；单独 `咔` 是场景拟声旁白；`咬牙` 属于姓名动作 cue；短礼貌收束词后紧接玩家握手动作时归 `你`。遇到明确性不足的群体推断应退到旁白。

回归测试使用用户确认的八类标签，检查精确 speaker/narration 分类并验证 history replay 没有写聊天或调用 provider。此批并不提供完整 roster/gold 数据；扩展覆盖也不能替代准确率审计。
