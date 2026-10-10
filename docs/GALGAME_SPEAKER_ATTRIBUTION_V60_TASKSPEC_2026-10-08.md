# v60 逐引语来源证据排序 TaskSpec

## 目标

把已有逐消息引号扫描与零散 cue 判断统一成逐引语的结构化证据排序，优先解决：

1. 引号前最近完整句中的唯一人名/人物名被漏用，或多人同现时选错人；
2. 独占一页的引语没有从原消息前一/前两张现有显示页找来源；
3. 引号不完整、跨页或带前后叙述时，解析器只看单个碎片而放弃完整上下文。

本版只生成展示标题证据，不判断剧情事实，不创建人物身份、队伍状态、头像绑定或语义 annotation。

## 固定输入与边界

- 每条原版 assistant 消息先扫描 quote spans；每个 span 独立作为 `quoteId`，保留原文 `[start,end)`、`closed`、所在消息 hash、父 span（如嵌套）及与既有 production page span 的交集。
- 每个 quote 保留原文跨度、前后上下文跨度、页关联、闭合状态和 parent/child；归属成功时保留获胜 speaker span、归属证据 span、证据 source region、句法角色和规则 ID，失败时保留 unresolved reason/span。候选比较在运行期完成，不持久化完整候选列表或落败候选排名。引语中被提及的人名不能单独证明其为说话人。
- 上下文限制在：当前 quote span、引号前最近完整句（向前到上一句号/问号/叹号/段落边界，受现有有界窗口保护）、引号后紧邻完整句、以及同消息已有 production pages 的前一页/前两页 source span。不可改变或重建页面。
- 嵌套引语保留 parent-child 关系。内层被引用的话不是新发言，除非有独立、引号外的发声署名。
- 未闭合引语仍继续分析其可用上下文，并保持 `closed=false`；扫描器既有“两处句末恢复后缀”的保护继续有效。恢复边界只用于分析，不写回源文，也不覆盖后续独立 quote。

## 候选优先级

按证据强度排序；不得以字符串距离作为唯一标准：

| Rank | 证据 | 归属要求 |
| --- | --- | --- |
| R0 | 同一 quote 的精确跨页延续；quote 邻接的明确引语外署名/发声谓词；格式化说话人标签 | 唯一、来源跨度有效，且不存在同等级冲突 |
| R1 | 引语前同一句中，唯一人物主体执行动作/发声行为并由冒号或直接引语引出 | 句法主语优先；动作宾语、领属人、被提及者、物件载体不是说话人 |
| R2 | 引语前上一完整句中的唯一人物动作主体；或引语后紧邻句明确回指该人 | 不以句首姓名或静态介绍单独归属；动作宾语、领属者、载体文字和场景/段落边界不能升级 |
| R3 | 当前页面是独占对白：前一、最多前两张已有 production page 中的唯一显式 speaker anchor，或句法明确的唯一人物动作主体 | 优先最近页；同页候选按动作主体而非单纯姓名提及判断，证据同级多人冲突时 abstain。不得用旧显示标题或泛名词直接继承 |
| R4 | 最近人名、名词、代词或人物名词 | 仅用于生成候选，不单独归属；多个候选无法区分时 abstain |

同一 Rank 的不同人物候选发生冲突则不猜，保留既有 fallback。更低级的近距离名字不得覆盖高级的语法主体或明确署名。静态姓名句（如“某角色是队长/很漂亮/穿着某服装”）只有姓名而没有动作或话语连续性，不得归属。

## 先行阻断条件

- 书面/展示载体（账本、地图、报告、屏幕、信件等）明确承载文字；
- 仅拟声/声音效果且没有说话行为；
- 场景标题、记录块、段落/场景切换；
- 新角色或多个竞争的动作主体；
- quote span 不合法、候选名字跨度不对应 source、source hash/parser version 不一致。

未闭合 quote 可继续抽取前后证据，但不得仅因相邻页相交就推断 ownership；只能沿已有唯一 opener anchor 的同一 source quote 精确延续。

## 允许改动

- `frontend/shared/src/sillytavern-adapter.js`：quote evidence index、候选排序、逐页 display-title projection；
- `frontend/player/src/main.js`：仅传已有前页 source spans；
- `frontend/player/tools/speaker-structure-replay.mjs` 与对应测试；
- 本 TaskSpec、三份基线文档及历史回放计划；
- player/admin static build output。

严禁修改原版 SillyTavern、聊天/剧情文本、可见正文 formatter、语义分类、production segmenter/page builder、现有页数/顺序/span、角色身份或视觉绑定。

## 验收与回测

1. 为人工确认过的 v37–v59 gold 与用户人工标注案例建立不含 source 文本的固定 hash/span 回归；新的多名优先级至少包含：唯一动作主体 + 宾语、主体 + 被提及人、并列动作主体、静态姓名负例、书面载体、后置归属、跨页同 quote、未闭合 quote、独占对白页前两页唯一锚、前两页竞争锚。
2. 重放全量历史，只读；记录 v59/v60 per-page 迁移矩阵、quote span 数/闭合状态、独占页检索命中类别及候选冲突数。历史回放不得写入聊天或调用 provider。
3. 历史 fallback 减少只叫 coverage shift，不是准确率。只有固定人工 gold 的 precision/recall/exact-title 可作为小样本指标；整体准确率若无代表性独立金标仍为 `INSUFFICIENT_EVIDENCE`。
4. 证明 source digest、聊天文件、segmenter/page spans、原版冻结路径不变；通过 speaker replay、shared/runtime regression、架构审计、DOM smoke、public player/admin 输出 hash parity、`git diff --check`。
5. 代码和文档冻结后通过独立只读 A1 审计，PASS 后才交付。

## v59 回放基线

158 chats、950 assistant messages、18,562 existing pages、6,116 dialogue candidates；4,090 attributed、201 anonymous first appearances、1,825 narrator fallback、0 unresolved。v59 规则 44 页；相较 v58 的 fallback 净变化 −9，不能解释为准确率提升。source digest 为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`。详见历史回放计划及 v59 TaskSpec。

## v60 实施与复核记录（2026-10-08）

实现了逐 quote decision evidence：保留 quote/prefix/suffix span、closed 状态、父子关系；最终归属保留 speaker/evidence span、`sourceRegion`、`syntaxRole` 和 `ruleId`，失败保留 reason。候选集合用于本轮排序，不持久化每个落败候选。候选优先级按显式说话 cue、同句唯一主动动作主体、前一句唯一动作主体、已有前一/前两页显式说话锚、前页唯一主动动作主体排列；名词提及只产生候选，不单独授予归属。对上文完整引号和紧邻下文继续读证据，未闭合引号仍记录并参加局部分析。

A1 反例补强：要求前页命中有明确动作谓词且主体跨度不截进语法助词；被动框架、状态/领属描写不作为发言人动作主体；前页分句中出现书面载体及写入/展示谓词时，不从该页向独占对白页继承角色。固定反例覆盖 `尼布感到震惊`、`尼布的神情变得严肃`、`账本上写着`、两个被动句，以及主动句 `尼布砸碎莫里克的面具`；前五种正确保持旁白，主动句正确归尼布。另有 hash/span 固定的真实 Mika 页回归通过。原 v58 样例中，`Pippa蹲在你旁边` 后的“别随便摇它”及“她说”按完整上下文改归 Pippa，用户提出的逐引语前后文规则优先于旧的保守旁白期望。

最终全量只读回放：158 chats、950 messages、18,562 production pages、6,116 dialogue candidates；4,110 attributed、204 anonymous first appearances、1,802 narrator fallback、0 unresolved。对照 v59，+20 attributed、+3 anonymous、−23 fallback。v60 prior-page action rule 命中 19 页。覆盖变化不是准确率；scope 对 158 个归档聊天仍不可用，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。fallback 中 1,782/1,802 为 `no-unique-speaker-evidence`；unknown-shape 主要为 dash-led 571、line-colon 454、quote-only 244、multi-quote 199。这些数字表明剩余难点在缺少唯一实体/延续证据，而不是引号扫描没有发现结构。

验证：shared adapter 1/1、speaker structure replay 58/58、runtime regressions 57/57、全量历史回放完成；player/admin 静态构建成功，DOM smoke 成功，静态架构审计 707 files / 0 prohibited active / 0 needs-review / 0 failed，`git diff --check` 退出 0。回放 digest 保持 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

**仍不可整体放行：** 独立 A1 复审确认说话人反例已关闭，但发现工作树当前 `createVisualNovelDisplaySegments` 字节 hash 为 `a8875278…eae3d`，与记录的 frozen baseline `09fb722d…52d28ecb` 不同，差异在连接词段落合并代码。恢复旧实现会让现有“原始空行保持分段”的分页回归失败；该冲突必须单独审计并明确恢复/豁免后，才能声称分页冻结验收通过。本轮没有继续修改该分页函数。原版 SillyTavern 冻结路径未发现改动。
