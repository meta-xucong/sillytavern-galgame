# 完整消息说话人证据扫描与分页投影开发规范

> 日期：2026-10-07
> 状态：已实施；定向源码回归 64/64、静态架构审计和独立终审均通过，player/admin 构建已同步。实时验收未通过：浏览器 smoke 没有覆盖带直接署名的当前对白页，且最终端口探测返回 connection refused。`visual-presentation` 与 `core-final-acceptance` 两个扩展套件仍失败于 narrator/unknown 占位图断言不一致，当前阶段不据此宣称全项目验收完成。
> 目标：在保持原文和 SillyTavern 分页完全不变的前提下，减少结构证据可恢复却显示“未识别”的页面，并谨慎处理跨页对白续接
> D/I/A：D0 / I2 / A1。设计选择已由用户确定；实现涉及共享解析、玩家页投影、回放一致性和分页冻结，故执行按跨模块约束处理，须独立审计
> 权威：服从 `AGENTS.md` 与 `GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`。本文件是下一阶段的实施细化，不单独授权生产代码偏离当前基线。

## 2026-10-07 用户标注泛化（parser v16）

人工确认的最小通用归属规则：

- `你 + 明确引语动作 + 冒号 + 引语` 归玩家标题“你”，并保留 player channel。
- 数量/群体主体（如“两个……守卫”）以动作/对白引出引语时，显示来源角色类别加“（群体）”，例如“守卫（群体）”；来源跨度仍只绑定原文中的“守卫”。该显示标签不创建单人角色、身份或单人头像。
- 引语前由一个可定位的人名/角色称谓承担动作，再以冒号引出对白时，按动作前主体归属；例如“艾瑞克大法师私下找到你：‘……’”归艾瑞克大法师。证据仅绑定原文主体片段和对应引语。
- `刻着/写着/记录着/标注着` 等文本承载动词引出的引文属于旁白标题，不按角色对白处理。
- 检定、数值和状态记录统一使用旁白标题；明确编号行动选项仍使用“选项”。“游戏信息”不再作为单独标题类别。
- 首屏结构证据明确为场景标题时，即使语义层给出 `unattributed-dialogue`，也允许只覆盖显示标题为“标题”；语义分类、unknown 身份和视觉上下文保持不变。
- 明确主语直接以“说/问/回答/宣布/喊”等谓语引出引语时，按该句前的动作主体归属；不跨句追认被提及的人物。

以上规则仅在原版正文页面和 spans 生成后附加 display-only 标题，不改变分页、原文、segment 类型或游戏状态。无明确结构证据的引语仍保留“未识别”；该类别清理不把未归属对白泛化成旁白。

## 2026-10-07 复合说话谓语边界（parser v17）

将“补充道、提醒道、回应道、插话道、解释道、嘀咕道、嘟囔道”等完整复合谓语作为一个结构线索识别，避免把“玛赫拉补充道”错误截成“玛赫”。适用于引语前及引语后的同消息署名；含泛指代词/连接短语的主体（如“我们都补充道”“她沉默地补充道”）不能被当作新角色名，仍显示“未识别”。此补充只影响 display-only 标题，不改正文、分页和身份。

同一只读快照（digest `sha256:f3c1845a5a8a6ec7413652ecc23c3e2c40a05d2a5d825faf4dabdc1fadb0e59b`）回放为 158 个聊天文件、944 条 assistant 消息、18,350 个 production pages。6,125 个对白候选页中，2,464 个有结构归属、392 个为推测标题、3,269 个仍未解决；另有 734 个 segmenter hints 全部通过本页 span 验证。v16 同快照的 unresolved candidate 数也是 3,269；因此 v17 修复了已复现的截名缺陷，但不能宣称全量未识别数已下降或准确率已提高。没有人工 gold 集，speaker accuracy 仍为 `INSUFFICIENT_EVIDENCE`。回放 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

## 2026-10-07 第二轮用户标注泛化（parser v18）

将第二轮人工确认扩展为以下粗粒度规则：

- 标题只在剧情推进开头出现。首屏的明确标题格式和显式 Markdown 场景标记可以显示“标题”；其余页面即使呈现括号、书名号等标题外观，也归“旁白”。
- 独立的短拟声词引语（如“轰”）归“旁白”；普通短对白（如“好！”）仍不能据此当成拟声词，无法归属时保持“未识别”。
- 可定位人名/角色称谓后紧接简短动作或反应，再由冒号引出引语时，归该角色；覆盖拿出、抱持、震惊、兴奋等动作/状态形态。人名候选按最贴近结构线索的完整名字选择，避免把“维克多”截成“维克”。代词仍不得作为角色。
- 经验、数值等汇总记录归“旁白”，即使句子被引号括起；若该页另有明确角色署名，则署名说话证据优先。

该规则只附加标题 evidence，不改正文分页、segment、聊天或身份。第二轮六条人工标注均已纳入定向回归。相同只读快照下，v18 对 6,102 个对白候选页识别 2,501 个明确归属、390 个推测标题、3,211 个仍未解决；较 v17 未解决数减少 58，明确归属数增加 37。另将 17 个非开头标题样式和 24 个独立拟声词页归入旁白。以上是结构覆盖数量，不是准确率；没有 gold corpus，仍为 `INSUFFICIENT_EVIDENCE`。source digest 仍为 `sha256:f3c1845a5a8a6ec7413652ecc23c3e2c40a05d2a5d825faf4dabdc1fadb0e59b`，回放只读且 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

## 2026-10-07 标题硬边界补强（parser v20）

用户进一步确认：“标题”只出现在每次推进剧情的开头；除此以外，所有疑似标题都归“旁白”。因此，显式 Markdown `#` 标记也不能在消息中段触发“标题”。只有当前 assistant 消息中第一个可见生产页，且该页符合既有标题形态，才能得到“标题”；书名号/括号标题、冒号标题和 Markdown 标题出现在后续页时都显示“旁白”。具名说话人证据仍按优先级正常生效，规则仅针对标题样式，不覆盖确切角色对白。

v20 在同一只读快照上回放：158 chats、944 assistant messages、18,350 production pages；6,094 dialogue candidates = 2,501 明确归属 + 390 推测标题 + 3,203 unresolved。相对 v19，candidate 与 speaker 桶不变；36 个中段 Markdown 标题样式从 heading 改为 narration：开头标题 198 页，非开头标题样式旁白 379 页。分类覆盖数不是正确率；没有 gold corpus，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。回放 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。定向测试要求开头 Markdown 标题为“标题”、消息中段 Markdown/冒号/括号式标题为“旁白”。

## 2026-10-07 标题符号覆盖补充（parser v21）

独立只读审计发现 `（…）` 和 `《…》` 这两种常见中文标题符号未进入 standalone heading detector；当底层页面类型是 unattributed dialogue 时，会错误落入“未识别”。v21 将全角括号和书名号纳入与既有括号/书名号形态相同的标题处理：剧情开头仍可为“标题”，后续页面一律为“旁白”；精确 speaker evidence 仍优先。定向测试明确使用 `pageType=unattributed-dialogue` 覆盖这两类符号。

同 digest 回放结果保持 candidate 分桶不变：6,094 candidates = 2,501 attributed + 390 probable + 3,203 unresolved；开头标题 198 页，中段标题外观旁白 382 页（较 v20 多归入 3 页）。18,350 pages、source digest `sha256:f3c1845a5a8a6ec7413652ecc23c3e2c40a05d2a5d825faf4dabdc1fadb0e59b`；`sourceUnchanged=true`、无聊天写回、无 provider 调用。准确率仍为 `INSUFFICIENT_EVIDENCE`。

## 2026-10-07 动作引语与对白内拟声词泛化（parser v22）

根据最近历史消息和用户已确认的标注模式，补了两条跨题材可复用规则：

- `角色主体 + 动作/反应 + 冒号 + 引语` 归属动作主体。动作模式包含取放/撕开、走近、欢呼、低吼等常见动作，不要求动作后再出现“说”；确切已发布角色仍优先，不能解析为可信主体时不猜。
- 短拟声词即使夹在普通叙述页中也不是对白候选；识别到的拟声词还可作为同句连续结构中的插入成分跳过，使 `Durik“轰”的砸碎…：“还有老大？”` 仍能回看动作主体 Durik。常见重复/拉长形式纳入；普通短回应（如“不！”）仍保留对白候选。

同一只读快照 v21→v22：6,090 dialogue candidates = 2,521 attributed + 384 probable + 3,185 unresolved；未解决候选页净减 18，其中明确归属增加 20 页、退出对白候选分母 4 页、推测标题桶减少 6 页。三类分桶净变化不同，不能将其误读成 20 条金标准正确。没有独立人工 gold，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。共有 3,083 个 unresolved quote spans / 3,603 个页链接，其中 416 个跨页；这些数字不能直接视作 3,083 种不同原因。source digest 与 v21 一致，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。测试样例覆盖 Pippa 欢呼、Elena 走近、艾萨克斯低吼、Celestia 撕卷轴、Nibu 清点补给、首相的声音引语、Durik 的动作中插入拟声词、全员齐声、叙事推进提示，以及普通短对白负例。

## 1. 决策摘要

下一阶段采用**完整消息扫描、既有页面投影**：

1. 对一条 assistant 可见原文做一次确定性结构扫描，记录有直接原文依据的说话人署名及其对白范围。
2. 继续使用 SillyTavern 当前显示链路产生的页面数组，按原页面的精确 `sourceSpan` 将完整消息级证据映射回页面。
3. 每个页面只增加 `pageTitleEvidence` 这类 display-only 元数据。页面文字、类型、数量、顺序、页码、source span 都来自原分页链路，不能被结构扫描重建或改写。
4. 只有当前页与某个唯一、明确归属的对白范围相交时才显示说话人。未归属对白、相互冲突的角色、不可精确映射的页面继续显示“未识别”。
5. 跨页续接优先由整条消息中可解析的同一引语/署名范围证明；“紧挨上一页”本身不构成归属证据。无引号续句只有在完整消息扫描能把它连入一个已有明确说话人的对白范围时才可继承。

此设计缩小“解析器只看当前页”造成的证据盲区，同时保留错误归属代价高于 unknown 的现有原则。它不会把所有 unknown 强行消掉。

## 2. 与现有规范、代码和数据的关系

### 2.1 继续有效的硬边界

- `AGENTS.md` 的 SillyTavern 原版源码冻结继续绝对生效。禁止改 `src/**`、`server.js`、原版前端、原版配置、扩展、根依赖或启动代码。
- `createVisualNovelDisplaySegments()`、`formatVisualNovelDisplayText()` 和当前页面数组是正文格式与分页的唯一事实来源。本阶段不修改这些函数，不再创建另一套 player page splitter。
- 不改变 Annotation v1、分析服务公开 DTO、模型提示词、语义请求数量、玩家聊天、存档、剧本正文、身份、头像、roster 或剧情状态。
- 结构解析仍是同步、本地、零 provider 的 display-only 路径。语义分析仍是独立的现有路径；两者只在“当前页标题是否有有效证据”处合并。
- 私有历史正文和 gold sidecar 不进入仓库，不写入日志，不写回聊天。

### 2.2 现状与下一阶段的明确差异

当前 `createStructuralPageTitleEvidence()` 虽然接收 `fullText`，实际先取 `coreText` 再调用 `findStructuralSpeakerAttributions()`；因此署名和引语结构主要在当前页 core 内解析。另一个续接路径 `findStructuralQuoteContinuation()` 依赖上一相邻页的 evidence、hash、连续 span 和引号状态。它很安全，但无法利用更早页面的署名来解释后续页面上仍属于同一明确对白范围的文本。

本方案把扫描范围扩为完整可见消息，但不改变**标题应用范围**：一个标题只能映射到当前页面精确的 `sourceSpan`。消息全局扫描是为了找证据源，不能将整条消息里提过的某个名字套到所有页面。

目前回测曾发现 541 个基线可见“未识别”页面中，有 227 页已存在可校验的结构标题 evidence，只是缺少 `identityRef` 的 dialogue 页未获准显示该 evidence。该标题门槛已作窄修复，离线估算约剩 314 页，其中 265 页因来源窗口不可寻址、约 49 页仍无足够归属 evidence。这个估算不含上游语义结果、不是浏览器验收，也不等于准确率。代码实施前必须对当前活动聊天重新取只读快照，不可把 2026-10-06 数字当作当前基线。

### 2.3 基线文档冲突处理

实施前已在 Native-first 与 Frontend 基线增加限定授权：**允许检查同一原版消息全文以发现直接归属；只允许投影到完全匹配的既有页；跨页显示只能依赖同一已归属对白范围；不得改分页或身份。** 两份授权现为本文件实施的上位依据。

代码开发前同步更新 `GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md` 与 `GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` 两份基线，保留现有分页恢复条款、角色身份隔离、Annotation 校验和 unknown-safe 约束；若 Design 文档对标题行为另有冲突，再同步修订 `GALGAME_DESIGN_SPEC.md`。所有文字必须引用 Native-first 为最终权威。不得通过改写本开发文档来默默覆盖基线。

## 3. 目标行为

| 当前页情况 | 目标标题 | 证据要求 |
| --- | --- | --- |
| 页内明确 `角色名：对白`、明确署名加引语或引语后明确署名 | 对应角色原文名 | 署名及对白均精确回指同一消息 |
| 当前页是前页已明确署名的同一段开放引语中间页 | 前页确认的同一角色名 | 全文引语扫描证明该页 core 落在同一引语范围内；无新署名/冲突 |
| 当前页含两个以上不同的明确说话人 | 多人对话 | 每个对白范围都有各自的直接归属证据 |
| 当前页有明确署名对白，同时还有旁白或另一条未归属引语 | 明确说话人标题 | 未归属部分仍保持未知，不能据此创建身份/头像；该标题门禁由 v40 取代旧规则 |
| 文本只提到角色名，但没有直接发言归属 cue | 旁白或未识别，按现有粗分类规则 | 名字提及不能成为 speaker evidence；角色名须是直接署名，不能从“提到角色后另一个人说话”的叙述句推断 |
| 页面 span 缺失、重复或来源/hash 不匹配 | 保留现有标题/未识别 | 不按 page index 猜映射 |
| 语义分析已有完整且对当前页有效的标题 | 保留现有有效语义标题 | 遵守当前语义优先级；结构提示只补缺失或 unknown 标题 |

“旁白”继续是粗略展示分类，不代表创建 narrator 身份。明确/疑似对白不能因结构解析失败而降格为旁白。

直接归属采用 fail-closed 的简单规则：角色名须独立构成署名，或与直接说话 cue 相邻；少量明确的短语气修饰词可夹在姓名与 cue 之间。姓名之后若还有动作、地点、关系或其他叙述子句，不能因为完整前缀里只出现一个 roster 人名就把引语归给该人。引语前后都出现署名时，两者归一化后不一致就标为未识别。经当前完整性校验的语义 `unattributed-dialogue` 优先于结构标题，不能被结构缓存改成人名。

## 4. 目标数据流和算法

### 4.1 输入

一次扫描只接收当前选中原版消息的：

- 已由现有 formatter 规范化的完整可见文本；
- `sourceMessageIndex` 和完整 `sourceMessageHash`；
- 当前已生成的原始显示 pages 及各 page `sourceSpan`；
- 此 chat/release 对应的已发布角色名清单及其 fingerprint；
- parser 版本。

历史回放不能把一个剧本的角色名清单套给所有聊天。为多聊天回放增加私有 `--speaker-scopes-file` sidecar，采用固定最小结构：

```json
{
  "schemaVersion": "galgame.speaker-scopes.v1",
  "entries": [
    {
      "chatFingerprint": "sha256:<hex>",
      "releaseVersion": "<published release version>",
      "publishedSpeakerNames": ["<name>"]
    }
  ]
}
```

`chatFingerprint` 复用 replay 工具现有的匿名 chat fingerprint；entry 不含聊天文件路径。一个 fingerprint 只能有一条 entry，角色名必须唯一、trimmed、非空；空 roster entry 可通过结构校验，但该 chat 的运行 scope 必须报告 `scope-unavailable`，不能报告为可用的 `scoped`。sidecar 位于仓库外/忽略目录，不写聊天正文。旧 `--speaker-names-file` 只允许用于单聊天回放；多聊天运行若只有全局名字列表，应标记 `scope-unavailable`，不能把它套给所有剧本。

### 4.2 消息级结构索引

在 `frontend/shared/src/sillytavern-adapter.js` 新增纯函数（建议名 `createStructuralMessageSpeakerIndex()`，实现者可按仓库命名微调）。建议返回仅供本次页面投影使用的内存结构：

```js
{
  sourceMessageIndex,
  sourceMessageHash,
  publishedSpeakerFingerprint,
  parserVersion,
  anchors: [{
    speakerText,
    speakerSpan: { start, end },
    utteranceSpans: [{ start, end }],
    attributionSpan: { start, end },
    ruleId,
    certainty: 'explicit'
  }],
  unresolvedDialogueSpans: [{ start, end, reasonId, quoteStart?, quoteEnd?, quoteClosed? }],
  scanStatus: 'complete' | 'ambiguous' | 'invalid-source'
}
```

For `unattributed-quoted-speech` and conflicting quoted attribution, optional quote fields bind the complete quote delimiter span and the quote scanner's closed/open result. They are used only by read-only replay diagnostics and the two-page title continuation guard; they do not affect text, page boundaries, Annotation labels, or identity.

这是内部计算结果，不是持久化 schema、Annotation v1 或新的 HTTP 协议。所有 offset 都使用 Unicode code point。索引不含人物属性、身份 id、资产 id、剧情状态或角色关系。

扫描器复用当前已存在的有限结构语法：

1. 行首的已发布角色精确署名加冒号/破折号格式；未发布名字仅在现有明确直接署名 cue 满足时临时用作原文标题。
2. `名字说/问/答/喊……：“对白”` 及现有已支持的英文等价结构。
3. 引号后的明确说话归属，例如 `“对白”，名字回答`。
4. 同一页/同一消息内多个有直接归属的对白段分别生成 anchor。
5. 已有引号扫描器在完整消息范围内维护成对/嵌套状态；不匹配引号只使受影响范围 ambiguous，不得给全文挑一个“最像”的说话人。

直接归属保持保守：一个未发布的 2–4 字汉字候选名，不能只靠单字 `说/问/答/喊/骂/道` 与引语相邻就建立 speaker anchor；精确命中已发布角色名单时仍可使用这些 cue，未发布名字需要更明确的多字 cue（例如 `问道/说道`）或独立署名格式。Latin 词内 U+2019（如 `That’s`、`don’t`）按撇号处理，不得当作弯单引号闭合符；其他文字系统按闭合符保守解析，真正成对的 `‘对白’` 仍按引语扫描。该规则只影响标题证据识别，不影响正文格式和分页。

禁止新增题材名词、动作词库、情绪词库、角色专名补丁、消息作者推断、名字出现频次投票，或将任意 `姓名:` 都解释成对白。列表、标题、状态键值、正文提及按现有安全规则处理。

`utteranceSpans` 必须描述直接署名所管辖的对白范围，而非从角色名开始到消息末尾的任意剩余文本。遇到明确新署名、引语闭合后另起的叙述/对白边界或相互冲突的 attribution，应结束前一范围或标记冲突。对不能确定范围边界的无引号文本，不延长 speaker anchor。

### 4.3 向现有页面投影

新增或重构一个纯投影函数（建议 `createStructuralPageTitleEvidenceFromMessageIndex()`）。对每个实际显示页只读取其现有 `sourceSpan`，按 overlap 将消息级 utterance spans 映射到该页。它不得拆分、合并、排序或重建页面。

判定顺序：

1. Page source span 无效、越界、缺失或不能一对一对应原始消息时，不产生 speaker title。
2. 收集与当前 core 相交的可检测 speech units。speech unit 是已识别引语片段或明确行首说话格式；人名普通提及不构成 speech unit。
3. 至少一个 speech unit 与 core 相交、所有与 core 相交的 speech units 都有唯一直接 attribution 且 speaker 去重后只有一个时，产生 `kind: speaker`。
4. 至少两个不同 speaker 的 speech units 与 core 相交，且这些 speech units 全部有唯一直接 attribution、没有未归属/冲突 speech unit 时，产生 `kind: group`。
5. 任一可检测 speech unit 未归属、冲突、范围重叠，或扫描状态不可靠时，当前页不产生角色标题。不能用页面另一处的一个已知人名概括整页。
6. 当前 core 没有可检测 speech unit 时，沿用既有 plain-prose narration fallback；本阶段不扩大或放宽该规则。

标题表示“这一页可确认由谁发言”，不是给整页每个字重新分成 narration/action/dialogue。与同一 speaker 明确对白处于同一页面的动作描写可以共存，不能单凭动作文字阻断角色标题；但页面出现第二段无法归属的引语/显式对白时必须保留 unknown。多段明确对白都属于同一个人时显示该人；多个已明确归属的人显示“多人对话”。

### 4.4 当前 `pageTitleEvidence` 的兼容映射

最终输出继续复用现有 `pageTitleEvidence`：

- `sourceMessageIndex`、`sourceMessageHash`：必须等于当前原版消息。
- `coreSpan`：必须与当前实际显示页的 `sourceSpan` 完全相等。
- `classificationEvidenceSpans`：只引用当前页 core 内非空的真实对白片段/当前页对白分类文本。
- `speakers[].text/start/end`：名字文本必须精确切自同一完整消息；其 span 可早于当前页，因为它是来源 anchor。
- `pageTitleEvidence.viewSpan` 与页面上的 `pageTitleEvidenceViewSpan`：两者继续完全一致，定义结构标题来源证据包络，扩至包含 speaker anchor 与当前 core。它**不是** `createPresentationPageWindow().viewSpan`，不是语义分析 prompt 的 view window，也不得传给 LLM 以扩大上下文。语义 view window 仍是现有相邻前页 lookbehind + 当前 core。
- `ruleId`：使用固定、封闭集合（例如现有 `known-prefix`、`quoted-attribution`、`post-quote-attribution`、`line-speaker`、`open-quote-continuation` 加本阶段新增的固定跨页 rule id）；不能写任意文本或正文。
- `mentionRef`：display-only 不透明引用，不是实体 id，不可映射到 avatar/roster。

renderer 的 `isCurrentPageTitleEvidence()` 需要最小扩展：允许通过同消息 hash/coreSpan 绑定的结构 speaker span 位于当前 core 之前；仍要求名字 span 位于结构 evidence 包络、页内分类 span 完全落在当前 core、规则 id 合法、speaker text 与 evidence text 一致。若 `identityRef` 已解析，或当前语义标题有效，已有 title 优先；结构扫描只给当前页缺失/unknown 标题补位。

`main.js` 的 message-index projection 直接为该结构 evidence 设置两处相同的 provenance 包络；page-window annotation 继续单独携带它自己的 `viewSpan`。生产 message-index 路径不把 global evidence 当作 `previousPage` 输入，不再调用旧的 page-local `findStructuralQuoteContinuation()`；该旧 helper 在移除前只能服务无 message index 的兼容测试/工具，不能混用两种 viewSpan 语义。

在 `main.js` 应用证据前，再用原始完整字符串验证：`Array.from(fullText).slice(speakerSpan.start, speakerSpan.end).join('') === speakerText`，并检查所有范围与 hash/index；不能只相信 renderer 收到的对象。任何校验失败都拒绝应用并保留现标题。

### 4.5 续接规则

续接以完整消息范围为准，而非“上一页是谁”：

- **可自动继承**：全文解析得出一个直接署名的引语 span，当前页 sourceSpan 与该引语的对白部分相交；期间引号栈未闭合，且没有出现新的独立署名/冲突 speaker。首尾页面都能通过完整消息 hash 与 source span 验证。
- **可自动继承的无引号情况**：只有扫描器已经从明确标签/对白格式建立有限 utterance span，且当前页完整落在同一 utterance 内、没有新边界时才可继承。普通语法上“看起来接着说”的文本不够。
- **必须停止继承**：引语已闭合后出现新的无归属对白；出现新 speaker anchor；遇到 narration/status/heading 边界后无法证明仍属原 utterance；hash、index、span 不匹配；缺少每 chat cast scope 导致候选归属不确定。
- **不允许继承**：跨原版消息、跨 chat、跨 swipe/编辑版本；从 SillyTavern message author、前页“旁白”或 unknown title 开始；仅因页面相邻、语气相同或提到相同角色名。

这使“上一页明确说话人、当前页仍是这句对白的后半段”可以正确延续；也避免把下一位新角色错标成上一位。

## 5. 缓存、时序与失败

- 消息扫描是纯同步本地工作，不等待 semantic provider，不新建网络请求。
- 优先在当前消息第一次需要标题时构建一次 `message speaker index`，后续页面复用；不为每页从头扫描整个消息。
- 内存缓存 key 至少绑定 `chat/session fingerprint + sourceMessageIndex + sourceMessageHash + publishedSpeakerFingerprint + parserVersion`。不写 localStorage、聊天或 scenario manifest；容量使用现有 bounded memo 风格并按 LRU/插入顺序淘汰。
- Page title cache 再绑定 `pageIndex + exact sourceSpan`。同一 message 不同 swipe/hash、不同 roster/release 或 parser 版本不能共享索引。
- 快速翻页、换 chat、消息编辑、swipe 变化时，旧结果不能覆盖当前页；应用前重读当前 hash、index、page span 和显示 cursor。
- 任何解析错误、超长文本超出既有安全长度、span 不可寻址、校验失败都返回 no evidence；正文渲染和翻页继续，不能回退到故事文本或重排页面。

## 6. 文件改动清单与责任边界

本轮实施前先更新权威基线；其余更改限制在以下自有上层路径：

| 文件/目录 | 计划修改 | 不得做 |
| --- | --- | --- |
| `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md` | 实施前加入 §2.3 所述完整消息扫描的窄授权；明确只投影当前精确 page span | 不放宽分页、身份或原版冻结边界 |
| `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`、必要时 `docs/GALGAME_DESIGN_SPEC.md` | 仅当需同步用户可见标题优先级时补充一段，引用 Native-first | 不重写产品/场景协议 |
| `frontend/shared/src/sillytavern-adapter.js` | 增加纯消息级索引和页 span 投影 helper；复用现有 scanner 与证据形式 | 不改 `formatVisualNovelDisplayText()`、`createVisualNovelDisplaySegments()`、正文过滤或任何分页函数 |
| `frontend/shared/tests/sillytavern-adapter.test.mjs` | 消息级 scanner、span 映射、冲突拒绝与 Unicode code point tests | 不用 mock splitter 替代 production splitter 作为分页证明 |
| `frontend/player/src/main.js` | 从当前消息原文/roster/hash 建索引；按现有实际 page spans attach display-only evidence；绑定缓存和 stale-result 防护 | 不写 `segment.text/type/sourceSpan/identityRef`，不重建 active pages |
| `frontend/player/src/presentation-renderer.js` | 最小扩展结构证据校验与标题优先级，允许可信 speaker source span 在当前页之前 | 不让 display label 变成 visual identity，不改变头像选择 |
| `frontend/player/tests/presentation-renderer.test.mjs` | evidence envelope、身份/语义标题优先级、无 identity 仍能显示结构标题 | 不把 unknown speaker context 伪造成 resolved character |
| `frontend/player/tests/runtime-regressions.test.mjs` | 当前 cursor、翻页、hash/cast 变化和迟到结果测试 | 不触发真实 provider |
| `frontend/player/tools/speaker-structure-replay.mjs` 与相邻测试 | 每消息只解析一次、按 production pages 回放、读取私有 per-chat speaker scope sidecar、报告 continuation/ambiguity/unaddressable | 不写聊天、不输出正文/姓名/绝对路径、不调用模型 |
| `public/game/**` | 只用项目 build 生成本功能必要输出 | 不手工编辑生成文件；不清理/覆盖无关静态文件 |

不能修改 `external-modules/**` 或 Annotation v1 DTO；如果实现需要跨服务协议改动，应停止并另立方案。

### 实施顺序

1. **Stage 0 — 先定规范**：以本文件 §2.3 更新 Native-first 与 Frontend 两份基线；核对 Design/identity projection 文件无冲突；保存实现前 `git status` 基线，不覆盖既有脏改动。
2. **Stage 1 — 建只读回放夹具**：选择当前活动聊天，以当前发布 cast scope 和真实 formatter/page segmenter 产生页；抽取可恢复、跨页、冲突、真正未知及不可寻址几类。先确认回放输出只包含匿名类别与数字。
3. **Stage 2 — 实现消息索引**：在 shared adapter 建立 full-message anchors；不接主界面，先跑纯 helper 测试和回放。若当前聊天存在明确的 unknown continuation 候选，用 span 证据解释至少一个；若没有候选或无法得到直接结构依据，记录实际数量并仅用合成夹具验证能力，不为了指标而宽松继承。
4. **Stage 3 — 映射到当前页**：从 main 使用当前 production page array 的精确 spans 投影；更新 renderer 最小 evidence allowlist；维持现有语义标题、identity 和头像通道优先关系。
5. **Stage 4 — 回放与回归**：同一个冻结聊天快照跑旧/新 parser 对照；只读核验源 hash，报告每类变化。跑相关 Node tests、静态架构审计与 build parity。
6. **Stage 5 — 独立审计**：冻结具体 diff 和证据，审计员只读检查项目边界、分页不可变、误归属、缓存 scope、历史数据只读和性能；有 FAIL/INSUFFICIENT_EVIDENCE 则先补证据或做最小改正，再复审。

## 7. 回归和历史回放清单

### 7.1 合成回归矩阵

| Fixture | 必须结果 |
| --- | --- |
| `Lila说：“先等` / 第二页 `下一页仍在说，再下一页结束。”`，同一 source message | 两页属于同一个 Lila 引语；第二页 speaker title 为 Lila；identity 是否绑定仍由现有 projection 决定 |
| 上述结构第二页跨到新原版消息 | 不继承；无新署名时为 unknown |
| 上页角色引语已闭合，当前页出现 `Nibu：“我来。”` | 当前页显示 Nibu，不沿用 Lila |
| 一页含 Nira、Venn 各自明确署名的对白 | “多人对话” |
| 一页既有 Nira 明确对白又有另一个未归属引号段 | “未识别” |
| 旁白句提到 Nira，附近没有 attribution cue | 不显示 Nira speaker title |
| `所以战术很简单：优先攻击克罗恩。` | 延续现有粗旁白 fallback，不把正文标题识别成角色 |
| `## 战斗`、状态键值块、列表和选项冒号 | 不当作角色署名 |
| 无署名独立引语 | unknown，不借用任意前页人物 |
| 消息 hash、索引、cast fingerprint、span 任意一个变化 | 缓存失效，不应用旧证据 |
| emoji/补充平面 Unicode 位于 speaker 前或对白中 | 所有 span 仍按 code point 精确映射 |
| 两个相同文本片段在一条消息中重复，page span 不能唯一定位 | 不按文字相等或 page index 猜；保留 unknown |
| structural evidence 与有效 semantic title 冲突 | 按现有有效语义标题优先级；不改 identity |
| renderer 收到 pageTitle evidence，但 identity 为 unknown | 标题可以显示；视觉角色仍为 unknown |

### 7.2 真实聊天只读回放

只读回放按下面口径输出：

- 输入快照：chat fingerprint、源 JSONL 版本/hash、active release/version、published speaker names fingerprint、formatter/page segmenter 版本、结构 parser 版本。
- 页面分母：直接使用 production `createVisualNovelDisplaySegments()` 的实际页数；禁止用 parser 自己重切文本。
- 按互斥结果分类：`explicit-single-speaker`、`explicit-group`、`cross-page-attributed-continuation`、`narration-fallback`、`unattributed-dialogue`、`ambiguous-conflict`、`unaddressable-page`、`scope-unavailable`。
- 报告旧/新规则每类数量变化、结构 evidence span 有效率、跨页续接 precision、speaker false-positive、解析 P50/P95/max 和总耗时。各项分母必须随报告打印；`unknown` coverage 与真实 UI label 分开。
- 对跨页候选抽取分层样本，由开发者按完整相邻文本和当前 release roster 形成仓库外 adjudicated sidecar；独立审计员只读核验抽样结论。用户无需逐条手工标注。报告必须将该侧车标明为 assistant-adjudicated evidence，不能称为独立人工 gold，也不能突破既有规范的 `INSUFFICIENT_EVIDENCE` 条件。
- 全量回放若缺少 per-chat release/cast scope，报告 scope unavailable，不能把不同 scope 的前后页数直接比较。不得从历史消息正文推断出已发布 cast 清单。
- 开始和结束对每个聊天源文件核对稳定 hash；任何源变化则该轮回放作废。明确输出 `chatWriteback=false`、`providerCalls=0`、`sourceUnchanged=true/false`。

回放只能证明覆盖、边界安全和本机结构匹配，不自动证明真实说话人准确率。原有开发规范中的 gold/holdout 阈值继续有效；样本不足时写 `INSUFFICIENT_EVIDENCE`。

#### 2026-10-07 当前样本结果

使用当前 active release 的已发布角色名称范围，对最近修改的单个聊天只读回放最近 12 条 assistant 消息：

- 12 条消息共生成 350 个原版显示页；scope 可用，0 个不可寻址页。
- 页级结构结果：speaker 4、group 0、narration 93、unknown 253。有效 evidence 为 324/324；这表示证据能通过 hash/span/source 校验，不代表其中 324 页的归类都正确。
- 227 页与未归属/歧义对白范围相交；全消息投影页为 0，因此这个样本没有实际验证“署名在前页、同一明确引语延续到后页”的收益。
- 消息扫描延迟 P50 0.92 ms、P95 7.49 ms、最大 7.49 ms；页投影延迟 P50 0.02 ms、P95 0.09 ms、最大 2.98 ms。
- `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。没有 gold sidecar，结果是 coverage-only，不可解释为准确率或精确率。

因此当前回放证明了只读、可寻址和延迟边界；它显示角色标题覆盖仍少，unknown/歧义页很多，不能据此宣布人物识别问题已解决。还需真实页面存在直接署名且分页跨越同一引语时的浏览器验证；若无此类当前样例，不得为了验收推进剧情或写入聊天。

## 8. 性能、验收和回滚

### 8.1 必须通过的行为 gate

1. **分页不变量 100%**：对同一冻结聊天快照，比对改造前后 formatter output、segment 个数/顺序/type/text/sourceSpan 逐项相同；涉及原版 `createVisualNovelDisplaySegments()` 的文件 diff 必须为空。结构 metadata 只能附加在分页数组形成之后。
2. **证据完整性 100%**：每一个实际应用的 title evidence 都匹配 chat/message index、完整 hash、当前 page core span；speaker name span 切出的原文必须与 label 完全相等，classification spans 全部位于当前 core。
3. **无身份副作用**：结构标题不能创建/修改 `identityRef`、角色池、portrait binding、roster 或保存数据；不改变 unknown 的视觉上下文。
4. **高精度优先**：现有 gold gate 不回退。跨页续接的人工/assistant-adjudicated 抽样若有错绑样例，先收窄规则，不以 unknown 数减少作为放宽理由。所有证据足够的 explicit fixtures 必须通过；歧义负例全部 fail closed。
5. **不影响交互**：结构扫描失败或索引缺失时继续渲染现有正文、翻页和语义流程；零网络请求；没有跨页旧结果覆盖当前页。
6. **时间成本可测**：每条消息最多一次完整扫描，时间复杂度目标为 `O(message code points + anchors + page spans)`；回放记录 P50/P95/max。若实测同步扫描导致页面卡顿，则先限于活动消息、按现有最大消息长度边界短路；不能因此改正文或启用模型回退。
7. **工程 gate**：定向 shared/player/replay tests、static architecture audit、构建源码/产物一致性检查及独立只读审计均通过；原版 SillyTavern 冻结路径无本阶段 diff。

### 8.2 回滚

回滚仅撤下新 full-message index / projection 调用，回退到已有 v7 page-local 结构 helper。不得清理 chat、旧 memo、历史正文、玩家存档或其他人的 uncommitted changes。分页输出应从始至终不变，所以回滚不需要迁移聊天数据。

## 9. 建议的执行命令

实现阶段先阅读 `frontend/build-static.mjs` 的写入/覆盖目标与当前工作区变更，再运行目标测试。建议的 focused checks：

```powershell
node --test frontend/shared/tests/sillytavern-adapter.test.mjs
node --test frontend/player/tests/presentation-renderer.test.mjs
node --test frontend/player/tests/runtime-regressions.test.mjs
node --test frontend/player/tests/speaker-structure-replay.test.mjs
node frontend/tools/static-architecture-audit.mjs
node frontend/build-static.mjs
git diff --check
```

构建后只检查本功能对应的 player artifacts；管理员输出只有在共享模块被构建器要求同步时才允许发生变化，并须证明该变化为必要输出。全量视觉/core 测试若失败，不可把失败改成 skip 或改宽断言；应先区分本阶段回归与已知基线问题并准确记录。

## 10. 最终给开发者的执行顺序

1. 只读确认 `AGENTS.md`、本开发规范、Native-first、Frontend、Design、identity projection 规范及当前 dirty status。
2. 更新 Native-first 与 Frontend 两份基线的窄范围授权；若发现身份、语义优先级或分页条款无法无冲突地表达本方案，停止代码修改，先修订规格。
3. 对单条完整可见消息生成一次结构索引，证明带 anchor 的 utterance spans 可跨现有 page spans，而不重切文本。
4. 让既有每页 helper 成为兼容包装，或新增 projection helper；避免保留两套各自不同的归属算法。
5. 在 main 用当前实页 `sourceSpan` 查 index，把有效 metadata 放入现有 label-only 路径；同步实现 per-chat scope/hash/cache/stale-result guard。
6. 跑合成矩阵、冻结聊天只读回放、分页不变量比较、source/public build parity 和架构审计。
7. 由未参与实现的审计员独立检查固定版本；任何 false speaker 或分页差异都阻止验收。
8. 只有标题变化的真实 player 浏览器验证通过、且全功能已知失败项单独处置后，才宣称这一阶段可交付。没有可靠 gold 时，标题 coverage 可以报告改善，整体 accuracy 仍写 `INSUFFICIENT_EVIDENCE`。

**关键判定：** 本方案要找回的是“完整消息里有明确归属、当前页正落在该对白范围中”的遗漏证据；它不追求把所有未识别页面涂成角色名。含糊时保留 unknown，标题纠正不能破坏正文、分页和原版 SillyTavern 数据语义。

## 11. 2026-10-07 覆盖面复核与 v2 增量实现

### 11.1 源码复核结论

对最新活动聊天的 8 条 assistant 消息、196 个现有页面执行只读结构回放后，119 页投影命中 `unattributed-dialogue`，71 页没有结构证据，只有 6 页产生 speaker 标题。索引发现 95 个未归属引号跨度；逐例检查后确认，解析器把普通正文中的标题/物品名引用也当成对白，因而即使该页所有真实对白都有署名，仍会被无关引号整体否决。另一组漏识别来自 `姓名 + 语气词 + 说/问` 只支持固定短语列表。播放器另有硬优先级：semantic `unattributed-dialogue` 会阻止结构标题计算、删除标题 memo 并强制显示“未识别”。这些是实现对证据语义的过度收缩，不是原版分页器造成的问题。

以上数字是 parser coverage 诊断，不是人工准确率；不代表每个未归属跨度都确实是台词。本增量不调用 LLM/provider，也不改聊天文件。

### 11.2 v2 实施边界

1. parser/cache/replay 版本升为 `full-message-speaker-index.v2`，避免复用 v1 结果。
2. 只有行内普通叙述中的引号短语不再自动登记为未归属对白；有说话 cue、冒号署名或独立成行的引号仍作为对白证据。独立无署名引号继续 unknown。
3. 用受限语法而非枚举词表识别直接修饰：已发布姓名或显式新角色名之后可接受短汉语 `地/着` 结构、英语 `-ly` 副词或单层括号语境；任意地点/动作/关系子句不通过。
4. 未发布 Latin 人名只有以 `Name: “quoted speech”` 明确行首署名时才允许 colon 语法；未知姓名的无引号 colon 行不升为人物标题，已发布名仍保留原有格式。
5. 若结构索引覆盖当前页的全部可检测对白，speaker/group 证据完整且没有未归属跨度或冲突，semantic `unattributed-dialogue` 可以保留原语义类型、unknown identity 和 unknown visual context，同时仅显示结构标题。它不被改写成 semantic `dialogue`。
6. 本 v2 阶段的旧行为是：同页任何确实未归属的对白、身份/署名冲突、无效 span/hash 或不可解析引号使该页显示“未识别”。后续 v40 只替换混合内容的标题门禁：若页内有明确署名角色对白，旁白或另一条未归属引语不得抹掉该角色标题；未归属引语本身仍未知。明确说话人冲突、无效 span/hash 或不可解析署名仍为“未识别”。多段不同 speaker 的完整归属显示“多人对话”。
7. 角色 alias 可用于直接署名识别并纳入 published-speaker fingerprint；输出仍显示原文 alias，不推断 alias 与 canonical identity 的绑定，也不触及头像/roster。
8. 结构页面数组和正文页序、内容、type、sourceSpan 是冻结输入；不改 formatter、segmenter 或分页代码。本轮执行结束后追加实际测试、回放计数、页数组哈希及独立审计结果，不将 coverage 数误述为准确率。

### 11.3 本轮实现与同快照回测

- 代码：parser 版本升到 v2；按结构 cue 区分行内引用与对白；支持有限语法修饰；新角色 Latin 冒号署名仅在后接成对引号时开放；speaker scope 纳入发布 alias；semantic unknown 的标题门禁仅在当前页完整结构 evidence 有效时允许覆盖标题。有效结果保持 semantic `unattributed-dialogue`、unknown identity/visual。
- 同一条最新聊天 JSONL 的同一快照，取最后 8 条 assistant 原文，旧 v1 构建产物与新 v2 source 使用完全相同的原版 segmenter 重放：两者均 216 页，source-page digest 均为 `sha256:6a730b1b56528e203e7ecdcdcd4dfc9ca4c1712a35235f7515f24aa36c230b4d`。这验证标题扫描没有改变正文分页页序、type、text 或 sourceSpan。
- v1 → v2 结构投影计数：speaker 6→10；group 0→0；`unattributed-dialogue` 119→95；narration 67→67；无结构证据 24→44；未归属引用跨度 116→82；显式 anchor 4→8。v2 当前 8 条消息整体解析 P50 约 0.8 ms、max 约 7.8 ms。coverage 变化不等于 gold accuracy；无人工标注不能给出真实性准确率。剩余未归属对白和无结构证据仍需后续谨慎处理。
- 回放只读且快照前后摘要一致：`chatWriteback=false`、`externalProviderCalls=0`。没有 LLM 调用，没有写回、重排或修改聊天。
- 剩余结构歧义：`Status: “Healthy”`、`Strategy: “Attack left.”` 与新角色 `Name: “quoted speech”` 在纯结构形式上不可区分；v2 将后者视为 speaker label，因此前两者可能出现错误显示标题。该规则只提供标题、不建立身份或头像。没有匹配 cue 的自然语言引语也可能不进入未归属跨度，故“保持 unknown”只适用于 parser 已检测到的对白，不能承诺对所有真实混合对白穷尽覆盖。需要后续 gold 回放评估是否收紧；本轮不以零 unknown 或 coverage 作为准确率结论。
- 通过：shared adapter test；player runtime regression 50/50；presentation-renderer test；speaker-structure replay 14/14；`git diff --check`；player/admin 构建产物同步后的 `static-architecture-audit` (`ok=true`, `prohibitedActiveCount=0`, `needsReviewCount=0`)。
- 未通过的两个扩展套件 `visual-presentation.test.mjs` 与 `core-final-acceptance.test.mjs` 均在既有 narrator/unknown placeholder 预期不一致断言失败（实际 `narrator-placeholder.svg`，期望 `unknown-speaker-placeholder.svg`）；与本轮标题 parser 不同链路，未为使其通过而放宽/改写视觉断言。故它们仍是项目验收已知项，本轮不能声明全项目测试全绿。
- 原版 SillyTavern 冻结目录没有本轮改动；正文源页 formatter/segmenter 函数没有改动。生产浏览器当前运行进程没有重启，本轮验证是静态构建、自动化和离线历史回放，不声称已完成实际浏览器验收。
- 独立只读审计结论：`AUDIT PASS`（限定于结构标题 v2 Demo）；审计员确认 parser/cache 与语义 unknown 边界、分页摘要、冻结目录及测试通过。审计记录的未知 Latin colon heading 歧义和未覆盖 cue 风险如上保留，不能宣称真实语义准确率或所有对白形式均已识别。

这组 v2 规则取代本文件中“语义 `unattributed-dialogue` 无条件优先阻止结构标题”一句，但不取代“当前页存在真实未归属对白时保持 unknown”的核心要求。

## 12. 2026-10-07 v24 复审、段落保护与用户校准

### 12.1 本轮修复

- parser/cache/replay 标识升级为 `full-message-speaker-index.v24`。
- 角色名后的“随后/接着/然后/这时/此时/立刻/马上”不得被汉字姓名扩展吞进姓名；拟声词与下一引语之间仅在短且以“的/地/得/着/并/又/继续”开头的同主体动作延续时回溯，遇到“她/他”等新主体保持未归属。
- 明确署名的拟声词仍是对白候选并与 speaker anchor 一致；无署名的拟声词与剧情选择提示仍按旁白处理。
- 连接词换行只能在确认由展示格式化器插入、且原文不存在该空行时合并。原文自带空行必须保留，段落各自保留有效 source span。该修复是 display-side paragraph guard，不能用于重新设计 SillyTavern 分页或扩大/压缩原文页面。

### 12.2 回放结果

同一历史快照 `sha256:f3c1845a5a8a6ec7413652ecc23c3e2c40a05d2a5d825faf4dabdc1fadb0e59b`：158 个聊天文件、944 条 assistant 消息、18,355 个页面。6099 个对白候选页中，2522 页明确归属、384 页仅有可显示推测标题、3193 页仍未解决。唯一未解决引语跨度为 3090 条，分布在 3613 个页面链接中，其中 419 条跨多页。v21 到 v24 的同快照净变化为：明确归属页 +21、未解决候选页 -10、推测标题 -6；v23 曾错误合并段落并将 5 页标为不可寻址，v24 恢复段落后页面总数比 v21 多 5。此覆盖变化不是准确率；由于缺少可用 speaker scope 和 gold，整体 `speakerAccuracy` 仍是 `INSUFFICIENT_EVIDENCE`。回放只读，未写聊天、未调用外部模型。

活动 Dungeon Master 聊天单独回放：429 条 assistant 消息、4665 个对白候选页，其中 2508 页明确归属、367 页为推测标题、1790 页仍未由 parser 自动决策。最新四条 assistant 消息（索引 850–856）有 73 个对白候选页，未解决为 0。最近需要复核的旧片段（索引 842–848）仍有 10 个未解决页面候选，但按用户既有规则可由本次上下文人工稳定判定：艾瑞克大法师跨页引语→“艾瑞克大法师”；“三天后出发”→“你”；地图上的峡谷介绍→“旁白”；炮击“轰轰轰”→“旁白”；单个虚空法师发现入侵者→“虚空法师”；召唤双龙、泽诺斯的“什么/啊/不可能”→分别为“你”和“泽诺斯”。这些是本轮 assistant 复核结论，不计为程序回放已识别，也不等同于用户金标；没有留下需要用户裁决的片段。

### 12.3 可复用的用户判断方式

后续逐步抽取这些优先次序，不再把“出现引号”直接等同于角色对白：

1. 先确认引号是否包住游戏信息、环境声音、地图/记录说明、选项或真正的人物发言；前几类依用户规则归旁白。
2. 明确署名或“角色/群体承担动作后引出引语”优先于通用类型；无名群体按角色类别加“（群体）”，单个敌方单位按可见角色类别标注。
3. 同一条未闭合引语跨页时沿用开启引语的唯一说话者；闭合后出现新动作主体，不得沿用旧角色。
4. 玩家角色在第一人称/行动上下文中发言显示“你”；具体行动选项或游戏状态条仍按其内容类型处理。
5. “标题”仅限每次推进剧情的首个可见页；其余标题外观归旁白。

这些规律作为后续规则设计与人工复核准则；除上述 v24 已实施用例外，不得假称所有人工复核结论都已自动化。

## 20. 2026-10-08 人工样本完整原文校准与 v32

### 20.1 样例输入与注释隔离

用户指出样例中多次出现的“上一页”标记不是希望参与归属的正文。回看样例生成记录，它是展示前页上下文时添加的样例标签，原聊天消息正文中不存在该标记。后续人工复核按以下格式处理：当前页正文是唯一标注目标；“上一页/当前页”、页码和括号说明都放在独立元数据字段，绝不拼入 `visibleText`、消息哈希、页 span 或 gold 文本。默认只展示目标页正文；若判断确实依赖前文，重新读取同一完整消息并把历史正文作为独立、只读上下文展示。评审者可忽略外围标签，但不能从原版聊天正文中全局删除字面“上一页”，也不能仅因前页标题而继承说话人。

### 20.2 完整原文复判结果

用户确认以下样本应按完整正文线索重新判读，因此前页标签不再影响结果：

| 样例 | 按完整原文的归属 | 原因/边界 |
|---|---|---|
| 尼布看得发直后接引语 | 尼布 | 唯一具名动作主体 + 结果反应 + 同句引语；识别姓名跨度，不依赖固定“说”字。 |
| 银面具贵客的引语 | 银面具贵客 | 首次出现的描述性角色称谓是前句唯一角色主体；同消息随后由“她”延续到动作及引语。仅作当前显示称谓，不创建持久身份/头像绑定/roster。 |
| 胸口浮现灰字 | 旁白 | 原文说明是身体表面显示的信息，不是该实体开口说话。 |
| 独立“等等”短引语后接 Pippa 动作与署名引语 | Pippa | 当前完整消息内，Pippa 的动作连接到紧随的明确引语；她的署名锚点可回指紧邻短引语。不可回溯到已闭合的 Durik 引语。 |
| Pippa 抓住玩家、压低声音后引语 | Pippa | 当前同句具名主体承担动作并引出引语。 |
| Lila 动作后“她低声说” | Lila | 同消息局部唯一先行角色与代词说话 cue 对应。 |
| 玩家展开地图并连续出现引语 | 人工复判为“你” | 当前摘录缺少可证明该口头发言的局部结构 cue；本轮记录用户的完整原文判读，但不把普通“你”动作泛化为说话证据，v32 尚未自动覆盖此类形态。 |
| 人鱼战士领队明确“说”引语 | 人鱼战士领队 | 可见单体单位称谓 + 明确说话谓词；不要求角色已在 roster 中。 |
| Durik 引语闭合后，尼布合上账本并开启收获汇报 | 尼布 | 新的具名动作主体和引语明确开启另一轮；汇报正文的数值/字段形状不能把说话人改回 Durik，也不能把已署名角色对白改成旁白。 |
| `(Fighter Campaign)` | 旁白 | 开场游戏元信息按用户选择与旁白合并；其内部证据可保留 metadata/heading 形状，但玩家标题统一显示旁白。 |

以上是当前十个样例的完整文本复判，不代表全历史金标准。只有具备相同完整证据结构的例子可泛化；尤其不得推广为“所有未署名引号都沿用上一页角色”。

### 20.3 v32 实施变化

- parser/cache/replay 升级为 `full-message-speaker-index.v32`。
- 结果补语反应（如“看得……发直”）以及受限地点前缀（如“在旁边”）可以作为唯一具名主体的局部动作线索；保持并列主体拒绝。
- 同消息最多两句窗口内，允许唯一句首描述性角色称谓（例如带“贵客/领队/首领”等单位类别尾词）作为代词回指锚点；证据 span 指向该称谓原文，只显示当前标题，不生成身份。
- 后一短引语只有在其前的唯一角色动作句直接引出后一条明确署名引语时，才可为前一短引语提供同一主体证据；闭合旧引语和页面邻接本身均不能继承。
- 增加“胸口/表面浮现或显示文字”来源框架；明确角色动作后引用结构化数值的说话仍显示该角色，明确“写着/标注”的对象来源则归旁白。
- 独立开场 `(… Campaign/Scenario/Session/Module/Game/Adventure)` 元信息显示为旁白；正常剧情场景标题规则不变。
- “上一页”噪声只在样例展示/人工评审层隔离；没有向运行时 source、formatter 或分页器添加全局替换。

### 20.4 针对性回归与未完成项

新增 shared adapter 回归覆盖：具名反应动作、首次描述性敌方称谓、浮现文字、Pippa 短引语后置动作、明确的“人鱼战士领队说”、尼布跨统计段新开引语、campaign 元信息归旁白，以及合法正文“请翻到上一页”保留原文。玩家地图回合的人工判断记为“你”，但自动归属仍未解决，避免把玩家动作当成发声证据。当前 focused test 已通过：`frontend/shared/tests/sillytavern-adapter.test.mjs` 1/1；`frontend/player/tests/speaker-structure-replay.test.mjs` 28/28。此次尚未执行全聊天历史回放，不能报告历史未识别数改善，也没有真实浏览器验收。结构标签覆盖计数不是准确率；无独立逐页 gold 时仍为 `INSUFFICIENT_EVIDENCE`。

没有改 `createVisualNovelDisplaySegments()`、formatter、原始正文、分页或 source span；没有写回聊天，也没有外部 provider 调用。SillyTavern 原版冻结路径保持只读。

### 12.4 验证边界

通过：adapter、runtime regressions（57/57）、speaker replay tests（25/25）、presentation-renderer、历史只读回放和独立只读审计。独立审计复现并确认 v23 三项 speaker 边界修复通过，也确认两条原文空行回归用例各自保持两段与有效 source span。另有 `core-final-acceptance.test.mjs` 在 narrator/unknown placeholder 期望不一致处失败；该失败在本轮修改前后均存在，未被本轮改动掩盖或放宽，不能据此声称全项目测试全绿。没有进行浏览器验收或重启服务。

## 21. Parser v33：载体文字与人物动作对白（2026-10-08）

### 21.1 回放定位

v32 活跃长聊天回放中有 674 个 unresolved dialogue candidate pages。样例复核显示两种长句结构漏检：物件文字前有较长描写（如“徽记……背面刻着一行歪斜通用语：……”、地图末尾“标着几个字：……”）；角色动作与引语之间夹有姿态或转交对象（如“尼布趴在……后，压低声音：……”及“Pippa把……塞进你手里：……”）。

### 21.2 实施边界

- 信息载体规则要求载体词与可见文字动词/显式记录条目框架；允许有界短描述位于二者之间，不因普通引语或仅出现物件名而判旁白。
- 单角色动作规则只扩展有限姿态/物品转移动词（含“哼了一声”），并要求同一局部前缀紧接冒号引语；多人主体、心理活动、来源转述继续不归角色。
- 已由生产分段器判为 narrative、且结构索引没有未归属对白跨度的页，可把行文内部的引用短语和拟声词归旁白；独立/冒号引语不走此放宽路径。
- 代词回指先定位当前引语前的最后说话子句，再向前检查有界句子；段落空行只作为回溯边界，不阻断同段落内刚出现的唯一人物名。自我介绍之前允许短呼救/感叹语，标题继续为“？？？”且不建 identity。
- parser/cache/replay 版本升至 `full-message-speaker-index.v33`。
- 变化仅影响 display-only 标题与 replay 分类；不改正文、source span、production segmenter、分页、身份或 SillyTavern 原版。

### 21.3 验证

adapter 回归覆盖两种实际物件文字长句、行文内引用/拟声词、尼布姿态对白、Pippa 塞药/代词对白、玛赫拉哼声对白及呼救后的自我介绍。v33 只读回放比较 unresolved candidates、旁白分类和独立引语跨度；该比较仅表示结构覆盖，未有完整逐页人工 gold 时不得称为识别准确率。

## 22. Parser v34：单位对白动作与代词动作回指（2026-10-08）

### 本轮回放发现

当前大聊天只读回放有 618 个未归属对白候选页，其中大多数由闭合引号构成。样本中重复出现两种可安全利用的语法证据：角色/单位以“骂了一句”等明确言语动作引出引语；已在前两句唯一出现的单位通过“他/她 + 动作 + 冒号”继续发言。此前的代词规则只接受显式“说道/低声说”等说话谓词，且弱旁白形状可能先行截断回指。

### 实施边界

1. 增加有限的言语动作 cue “骂了一句/骂了一声”；仅在本地结构直接引出引号时识别。
2. 扩展回指前件到显式单位角色（如弓手/弩手/打手），允许常见限定语（如“但那个”），仍要求唯一、同消息、至多两句、无场景边界。
3. 将安全的 full-message anchor 提升到弱旁白形状判断之前；不降低引文来源/信息块判定优先级。
4. 有多个前件、匿名说话者、仅有未署名引号时保持未归属，留待人工标记，不从剧情常识猜身份。
5. 不改聊天原文，不更改播放器既有 segment/page span；此任务提交中没有编辑 `createVisualNovelDisplaySegments`。

### 验证要求与限制

使用 parser v34 跑结构化只读历史回放；确认来源哈希在该次运行期间不变、没有聊天写回及外部 provider 调用。增加正例与竞争角色/场景断点负例。当前聊天缺少 roster 与逐页金标，因此 628 为未归属候选数量，不等于错误数，任何新归属还需用户标记样本验证。

### Speaker title structural rules v35 (2026-10-08)

The display-only speaker index now applies three bounded rules: (1) an anonymous first-appearance voice or shout is titled `？？？`; this is a neutral title only and does not create a roster entry or visual identity; (2) a standalone quote immediately following one unique character's observable action may inherit that actor when no competing actor, information source, or scene boundary intervenes; (3) an explicit action-to-laughter construction such as a role subject followed by a direct quoted line is attributed to that subject, after ignoring a preceding turn header. Pronoun continuation can reuse the local actor anchor.

These rules only change the title projection. They do not rewrite chat text, infer persistent identity, or alter the existing display segment/page spans. Parser version is `full-message-speaker-index.v35`. The current replay remains structural coverage evidence, not measured accuracy: historical speaker rosters and per-page human gold are incomplete.

v35 audit refinement: recent-action backreference now requires the named character to head an action clause, rather than merely being mentioned before an action word. Passive/possessive forms and later competing subjects such as `有人` or `守卫` keep the quote unresolved. Regression examples cover both false-attribution patterns found in independent review.

v35 full read-only replay (2026-10-08, after applying the latest six user labels and the pronoun-ambiguity guard): 158 chat files, 950 assistant messages, 18,562 existing display pages, 6,049 dialogue-candidate pages. Buckets: 3,962 attributed, 12 anonymous first appearances (`？？？`), 90 probable display titles, 1,985 unresolved. Structural evidence validity was 100% (17,810/17,810). Speaker accuracy remains `INSUFFICIENT_EVIDENCE`: all 158 chat scopes lacked published speaker rosters and there is no complete page-level human gold. Replay verified `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. These counts measure structural coverage only, not correctness.

### Structural attribution refinement v36 (2026-10-08; mixed-page title rule superseded by v40)

The six latest user labels are covered by regressions: unknown first appearances and remote shouts use neutral `？？？`; the explicitly accepted Nibu continuations resolve to Nibu; and a named role immediately preceding an observable laugh is attributed to that role. A narrow direct-action prefix recognizes patterns such as `Nibu指着远处：“…”` and `卡尔喘着粗气：“…”`, while pronouns, anonymous subjects, and ambiguous clauses remain unassigned. More importantly, a single unresolved quote no longer cancels other explicit speaker anchors in the same message; page projection still rejects a speaker title when the displayed page overlaps unresolved dialogue. No original body, identity, or pagination logic changes.

v36 full read-only replay: 158 chat files, 950 assistant messages, 18,562 existing display pages, and 6,049 dialogue-candidate pages. Buckets: 3,967 attributed, 12 anonymous first appearances (`？？？`), 90 probable display titles, and 1,980 unresolved. Compared with v35, attributed coverage increased by 5 pages and unresolved candidates decreased by 5. Evidence validity remained 100% (17,810/17,810). Accuracy remains `INSUFFICIENT_EVIDENCE` because all 158 replay scopes lacked published rosters and complete per-page gold labels. Replay reported `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`. At v36 mixed pages with unresolved quotes stayed unknown; v40 later supersedes that title behavior only where the page also contains a clearly attributed character utterance.

### Structural attribution refinement v37 (2026-10-08)

The next six user labels are encoded as display-only structural regressions: a role/title followed by a named subject and a nearby pronoun-led action can identify that subject (`格雷森`); a quoted nickname directly attached to a named person is preserved with the name (`“铁臂”卡尔`); an organization possessive followed by a named person and an immediate action cue identifies that person (`卡尔惊叹/大喊`); a named non-human subject can own its direct quote, and later `它` quotes can refer back only to one nearby explicit creature anchor in the same message, without a paragraph/scene break or competing speaker (`亚龙`); a short question immediately followed by `你一愣/一怔` may be titled `你`. An unanchored `它`, non-question quote followed by player reaction, ambiguous subject, or source/page boundary remains unresolved. None of these rules creates identity/roster data or changes original text, display segmentation, or pagination.

v37 regression verification: all six manually confirmed examples produce the requested message-level speaker anchors; four page-addressable labels also project at least one matching page title without a competing title. Two synthetic examples expose existing page-span limitations in the unchanged display segmenter (nickname/name split across the page edge; final creature page span extends beyond the synthetic source length); those are tested only at the message-index layer and are not repaired by changing pagination.

v37 full read-only replay: 158 chat files, 950 assistant messages, 18,562 existing display pages, and 6,049 dialogue-candidate pages. Buckets: 3,972 attributed, 12 anonymous first appearances (`？？？`), 90 probable display titles, and 1,975 unresolved. Compared with v36, attributed coverage increased by 5 pages and unresolved candidates decreased by 5. Evidence validity remained 100% (17,810/17,810). Accuracy remains `INSUFFICIENT_EVIDENCE` because all 158 replay scopes lacked published rosters and complete per-page gold labels. Replay reported `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`.

### Structural attribution refinement v38 (2026-10-08)

Extend the user-confirmed name/action/quote pattern to obvious observable actions (`扛起`, `递过`, `治疗`) and ASCII-quoted nickname apposition. For entity pronouns, use the nearest explicit creature noun in the same scene; ignore creature names inside quoted dialogue, reject non-creature compounds such as `龙裔/龙脊/龙巢/龙骨`, and let an explicit human turn between paragraphs coexist without stealing an explicit `它` subject. Keep anonymous actor phrases and source-object-first patterns excluded. This is title-only: no chat writeback, persistent identity, SillyTavern source, or page segmentation changes.

v38 focused replay of the latest eight assistant messages in the active chat: 129/129 dialogue-candidate pages received titles; the seven reviewed historical action/creature examples resolved to Durik, 格雷森, `"铁臂"卡尔`, 艾莉娅, and 亚龙. The full read-only corpus replay scanned 950 assistant messages, 18,562 display pages, and 6,050 dialogue-candidate pages: 3,979 attributed, 12 anonymous first appearances, 89 probable display titles, and 1,970 unresolved candidates. Relative to v37, attributed coverage increased by 7 and unresolved candidates decreased by 5. Evidence validity remained 17,810/17,810. These are coverage metrics, not accuracy: complete per-page human gold and published chat rosters remain unavailable. Chat snapshot remained unchanged; replay performed no writeback and made no provider calls.

### Structural attribution refinement v39 (2026-10-08)

- Entity-pronoun lookback now prefers the most recent named-unit apposition in the same local scene. When that unit is introduced after an earlier dialogue anchor, older nearby creature/ally anchors are excluded. This handles the frost giant scene: the current entity is `永冻守护者`; the earlier blue-dragon mention is unrelated.
- A short reaction (`什么？！`, a bounded denial) may inherit the unique target of the immediately preceding named failure or hit event. The latest action event wins over older targets in the same long message. Evidence still points to the target's literal name in source text.
- `Kael和Mira向你汇报` remains a group title with both members. An anonymous first-arrival shout remains `？？？`; a standalone cry such as `啊——！` is narration. Unresolved local entity references/short reactions with no unique nearby name fall back to narration, as requested; this is not a global conversion of every ambiguous quote.
- Active-chat replay (read-only): 435 assistant messages, 11,840 existing pages, 4,606 dialogue candidates; 3,949 attributed, 657 not confirmed attributed. Buckets: 31 anonymous introductions (`？？？`), 73 probable display titles, and 553 unresolved candidates. The seven user-reviewed targets display `永冻守护者`, `永冻守护者`, `Kael + Mira`, `？？？`, `泽诺斯`, `旁白`, `泽诺斯`. Source digest was unchanged; no chat writeback or provider call occurred. These results establish targeted agreement/coverage, not whole-chat accuracy; the larger history lacks a complete page-level gold set.
- Change boundary: display evidence/parser only. No original chat text, production segmenter, page range, persistent identity, or SillyTavern source was edited by this v39 delta.

### Speaker title structural rules v40 (2026-10-08)

When a displayed page includes a clear character utterance, attribute the title to that speaker even if the same page also contains narration or another unresolved quote. Prefer the closer explicit quote/action attribution over a broad roster-prefix or turn-header cue; equal-strength conflicting speakers remain unresolved. Support a bounded local named speech cue after a comma, quoted character-reaction framing, and an explicit name plus speech predicate at the start of a page when the quote continues beyond that page. Anonymous/pronoun subjects remain excluded. The English goblin item marked by the user as a fault is excluded from calibration. These are display-only structural rules: do not change source text, page spans, pagination, persistent identity, or SillyTavern-owned code.

The six current user-confirmed samples (excluding the explicitly faulty first sample) project to `短弓手`, `尼布`, `尼布`, `瘦竹竿男`, `Pippa`, and `Celestia`. Regression coverage and the active-chat read-only sample check agree with all six. The subsequent full-corpus v40 run is coverage-only: 158 chats, 950 assistant messages, 18,562 existing pages, 6,064 dialogue candidates; 4,072 attributed, 138 anonymous introductions, 78 probable titles, and 1,776 unresolved. Source digest stayed stable, evidence spans validated 17,812/17,812, and no writeback/provider call occurred. These figures do not measure accuracy without a complete per-page gold set.

### Speaker title structural rules v41 (2026-10-08)

Extend the bounded direct speech predicate parser to utterance-complement forms such as `骂了一声`/`骂了一句`, so a named local subject with a same-subject action clause and a following quote is recognized. This does not make action-only evidence sufficient and does not alter source text, existing display pages, or pagination.

### Speaker title structural rules v42 (2026-10-08)

Permit one short (at most 48 characters) narration lead clause plus an explicit temporal connective and pronoun-led speech cue to use a unique nearby explicit speaker anchor across current page splits. Reject the shortcut if the lead names another published character; reject attribution if multiple explicit anchors compete. Treat connective-plus-pronoun fragments such as `紧接着他` as pronouns, never as inferred Han-name characters. Keep the title on the resolved speaker for a continuation page of the same open quote. This is a display-title-only rule; no source text, segment/page spans, pagination, identity, or original SillyTavern code changes.

### Speaker title structural rules v43 (2026-10-08)

Apply the latest seven user-calibrated labels through title evidence projected onto the existing SillyTavern display spans: player action followed by first-person quoted declaration → `你`; a newly introduced unnamed voice → `？？？`; a spirit's first-person farewell may inherit the uniquely named spirit from the immediately preceding spirit-action clause; a named action subject before a colon quote retains its full compound name (including `·`); a nearby explicit speaker may carry through `它 + creature-specific object/action + quote` when unique; and a quoted laugh followed by that same named actor's laugh/speech remains attributed to the actor. Keep generic narration distinct from a first-appearance unknown speaker. Competing action subjects, source/system-information frames, non-unique nearby anchors, or missing explicit evidence remain unassigned/narration-safe. This changes display title evidence only; do not change message text, page spans, pagination, persistent identity, or original SillyTavern source.

### v43 calibration evidence (2026-10-08)

The seven latest user-labeled pages were confirmed against source text and projected through their existing display spans: `你`, `？？？` for an unnamed first appearance, `霜石` (two pages), `霜咬·银翼`, `霜咬`, and `Durik`. Full-history read-only coverage: 158 chats, 950 messages, 18,562 pages, 6,071 dialogue candidates; 4,099 attributed, 138 anonymous introductions, 73 probable titles, 1,761 unresolved; evidence 17,812/17,812. Source digest stayed `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; no writeback, provider calls, or unaddressable pages. Relative to the recorded v42 snapshot, coverage adds 19 attributed pages and removes 9 unresolved candidates. These aggregate counts do not establish overall accuracy; there is no complete page-level gold. Body text and pagination remain untouched.

### Speaker title structural rules v44 (2026-10-08)

The latest seven user labels establish a bounded dragon-name rule: attribute dragon-context dialogue to a unique nearby previously observed compound name; keep an unnamed first appearance as `？？？`, and do not borrow names from beyond the local 320-code-point/same-scene window, across Markdown headings/horizontal separators/explicit scene-location markers, or from competing nearby dragons. Generic dragon-kind labels are not character names. A creature’s explicit first-person self-identification may replace a generic “dragon” label with its full compound name. Explicit player self-introduction stays `你`; a short named action cue uses that named speaker. This affects title evidence only; source body, existing display spans, page order, pagination, identity, and original SillyTavern files remain unchanged.

### Speaker title structural rules v45 (2026-10-08)

Locally speech-bound role/creature descriptors may identify speakers, including an action attached to the same quote across a short paragraph boundary. A uniquely explicit player action can anchor a following standalone quoted line to `你`. Anonymous first appearances stay `？？？`; indefinite descriptions and voice/manner words are rejected as identities. This remains title projection only and must preserve original dialogue text and existing display/page spans.

Regression evidence: the seven user labels (`镇长`, `首相`, `章鱼`, `光头`, `你`, `你`, `莫里斯`) pass targeted replay; an anonymous stranger described as speaking `冷声` remains `anonymous-first-appearance`. Adapter tests pass 1/1 and replay tests pass 36/36. Full-history v45 coverage is 4,120 attributed, 140 anonymous, 73 probable, and 1,741 unresolved dialogue-candidate pages across 6,074 candidates (158 chats, 950 messages, 18,562 existing pages). Evidence validity is 17,812/17,812; digest is unchanged, with no writeback/provider calls and zero unaddressable pages. These counts are not an accuracy estimate; there is no complete page-level gold set.


V45 补测扩展两种通用 cue：`Mira终于开口：“…”` 与 `Ren低声说，“…”` 均可由本地名字+说话谓词归属；独立回归 36/36、adapter 1/1。修正后的只读全历史数据为 4,120 attributed、140 anonymous、73 probable、1,741 unresolved / 6,074 dialogue candidates。

## Parser v52 bounded same-message attribution (2026-10-08)

v52 searches direct pre-/post-quote cues and named action/speaker anchors across the full original assistant message, then projects only source-verified evidence to the unchanged existing production page spans. Carry-forward requires the same still-open paired quote, a unique nearest same-scene anchor, and no stronger or conflicting speaker cue. Closed turns do not inherit merely by adjacency; references never cross source messages or chats. Explicit unquoted player speech may display `你`; first person inside an NPC quote is excluded. Written-carrier text remains narrator; a group title such as `人群` requires a reliable same-message collective source plus a contiguous anonymous quote run. Display fallback remains separate from semantic annotation/identity: closed but uniquely unattributed speech may display `旁白` on the neutral narrator channel; anonymous first appearances remain `？？？`; genuinely open quotes without an owner remain `未识别`.

The latest ten user-calibrated historical forms score exact visible titles 10/10 in focused gold replay. The post-quote regression `“你刚才敲的位置……” Ren低声说，“不是窗。”` now assigns the first utterance to Ren using its immediately following direct reporting cue, even with no published roster; the subsequent Ren quote is independently attributed. A short pronoun+manner string such as `她平静地说` is rejected as a person-name.

Final v52 full read-only replay, same source snapshot: 158 chats, 950 assistant messages, 18,562 production pages, 6,402 candidate pages; 4,971 attributed, 103 anonymous introductions, 1,328 narrator fallbacks, zero probable titles, zero unresolved display rows. Relative to the recorded v51 count (6,379 candidates; 4,908 attributed; 105 anonymous; 1,366 fallback), candidate coverage is +23, attribution +63, anonymous −2, fallback −38. These are classification-bucket shifts, not accuracy. The replay does not contain a saved page-level v51/v52 diff, so the net +23 cannot be assigned to particular rules. The 206 added-direct-cue utterances are a different measure.

Candidate narrator-fallback reason counts include a fixed set of zero-valued reasons and sum exactly to the 1,328 candidate fallbacks: no unique speaker evidence 1,317; narrative-shaped unattributed quote 2; ambiguous local reference 4; dialogue-shaped page without a speaker 5; conflicting evidence/open quote/ambiguous quote structure 0. All-page narrator diagnostics are separate: total 1,447, including 119 noncandidate narrative pages. Evidence spans 17,818/17,818 valid; zero unaddressable pages; source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. Speaker accuracy remains `INSUFFICIENT_EVIDENCE`: published speaker scopes are unavailable for all 158 chats, and there is no complete page-level human holdout. The exact-ten gold is focused calibration, not corpus accuracy.

## Parser v53 real-history correction and current replay (2026-10-08)

Six real user-confirmed historical visible titles are pinned by source chat/message hash, existing production page index, and exact code-point span; the production replay fixture matched 6/6. v53 adds bounded same-message direct action/reaction evidence, a unique named HP/status target followed by an immediate pronoun reaction, an outside-quote player first-person action display alias, a same-message speaker/action bridge through one structural subsection heading, and honorific-only title display normalization. A display alias keeps its original raw speaker surface in `speaker.sourceText`; the replay evidence validator checks that raw surface against its source span. It does not assign from a name mention or roster alone. Written-carrier and explicit transfer-to-recipient negatives remain in regression.

Final v53 full-history read-only replay: 158 chat files, 950 assistant messages, 18,562 production pages, and 6,404 dialogue candidates. Buckets: 4,985 attributed, 103 anonymous first appearances, 1,316 narrator fallbacks, and zero unresolved display rows. Candidate fallback reasons sum exactly to 1,316: 1,308 no unique speaker evidence, 2 narrative-shaped unattributed quotes, 2 ambiguous local references, 4 dialogue-shaped pages without speaker evidence, and zero in the other three fixed buckets. All-page narrator diagnostics total 1,435, separately including 119 noncandidate narrative pages. Structural evidence validation was 17,818/17,818 with zero unaddressable pages.

Compared with the recorded v52 coverage summary, v53 has +2 dialogue candidates, +14 attributed pages, no anonymous-bucket change, and −12 narrator fallbacks. No per-page v52→v53 transition artifact was produced, so the net candidate increase cannot be assigned to an individual helper. These are coverage-distribution changes, not accuracy gains. The six gold rows are a focused calibration sample; full-corpus accuracy remains `INSUFFICIENT_EVIDENCE`. Source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. Frozen `createVisualNovelDisplaySegments` exact-slice SHA-256 remains `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`.

### v53 A2 bounded-scope closure (2026-10-08; supersedes the provisional v53 counts above)

Final bounded replay: 158 chats, 950 assistant messages, 18,562 existing pages, 6,242 dialogue candidates: 4,500 attributed, 118 anonymous, 1,624 narrator fallbacks, 0 probable, 0 unresolved. Candidate reasons total exactly 1,624 (`no-unique-speaker-evidence` 1,610; narrative quote 2; ambiguous local 2; dialogue-shaped without speaker 10). Relative to frozen v52, 160 fewer candidates, 471 fewer attributed, 15 more anonymous, and 296 more fallbacks; this is the conservative effect of resetting/bounding the observed-name lexicon, not an accuracy claim. Source digest and pages are unchanged; evidence validity 17,806/17,806, no unaddressable pages, chat writeback, or provider calls. Runtime, renderer, shared, replay tests, six historical golds, DOM smoke, architecture audit, staged/public output hashes, frozen segmenter hash, and diff check all passed; exact command results are recorded in the TaskSpec and historical replay plan. Remaining fallback review should use source-bound stratified examples from the no-unique bucket rather than broadening names without evidence.
