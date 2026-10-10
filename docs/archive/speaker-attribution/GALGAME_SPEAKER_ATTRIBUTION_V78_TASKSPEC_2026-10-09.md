# 说话人结构化归属 v78 开发说明

## 目标与冻结样本

v78 处理 v77 全历史只读回放中 `no-unique-speaker-evidence` 的固定 1,319 个页面。基线源摘要必须为 `sha256:3cd35138de9729080525259936cb95376ee662b59691f917d4903a7bd47bd6bd`；比较键为聊天指纹、源消息索引、源消息哈希、现有页索引与原始 source span。回测不改变聊天，不重建分页，也不调用模型或上游服务。

## 方案

先以完整闭合引语作为归属单位，再把证据投影回 SillyTavern 已经生成的页。v78 补充三类可复用结构：

1. **动作主体与代词连续链**：只看引语前最多两句、180 个字符，不跨场景、不跨引语、不处于书信/记录/系统载体。最后一句可以有唯一、精确的具名动作主体，也可以由“他/她/它”等代词承接前句唯一、已有动作证据的具名主体；单纯提及姓名不能作为归属证据。句首角色名后再出现另一人物的发言 cue 时，不把引语错归给句首人物。
2. **总结报告谓词**：“角色 + 总结/概括/归纳 + 冒号引语”属于发言报告结构；书面来源和心声优先阻断。
3. **阅读引文来源**：最近有限窗口内若有明确载体（信、地图、卷轴、记录等）和阅读动作，后续“内容/上面/信上/图上”等内容引入句将引语分类为旁白/信息。若有紧邻的人物发言谓词，则不应用来源框架。

所有姓名候选必须保留原文字符 span；这些规则只产生展示标题证据，不建立角色实体。

书面载体、玩法信息、拟声词仍按旁白/信息处理；首次出场且确有对白但无姓名证据时显示“？？？”。其他冲突或证据不足的内容保持保守旁白兜底。不得以附近任意人名或整页最近名字推断说话人。

## 改动边界

- 允许：`frontend/shared/src/sillytavern-adapter.js`、播放器标题解析版本号、只读回放工具与测试、三份基线规范及本说明。
- 禁止：SillyTavern 原版代码、前端剧情正文/格式化/分页/分段/source spans、聊天文件、人物身份与状态、头像/背景、LLM 提示词或调用、服务配置、`public/game/**` 构建输出。
- v77 历史 parser 行为保持可调用；v78 单独启用新规则。

## 回测定义

“解决”只按固定 1,319 行 cohort 的输出迁移报告，不能称为准确率：

1. `speaker/group`：获得具名或群体标题；
2. `anonymous`：归为首次出现的“？？？”；
3. `narration/other`：明确进入旁白或游戏信息分类；
4. `still-fallback`：仍是 `no-unique-speaker-evidence`；
5. `other-fallback/unknown`：因其他诊断或无效证据退出本规则。

必须证明数据摘要与基线 cohort 未变、每行原始 span 未变、聊天写回为 0、外部 provider 调用为 0。无逐页人工 gold 时仍报告 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。

## 验收

### 实测结果（2026-10-09）

全历史只读重放共 158 个聊天、955 条 assistant 消息、18,696 个现有分页。冻结 v77 cohort 1,319 页全部逐项匹配（0 unmatched；键包含聊天指纹、消息索引/哈希、页索引和原始 span）；v78 输出为：8 页 speaker/group、0 页匿名“？？？”，1 页明确旁白/信息分类、1 页其他兜底、1,309 页仍是 `no-unique-speaker-evidence`。9/1,319（0.68%）获得有效归属改善（8 页角色、1 页旁白）；另 1 页只从 `no-unique-speaker-evidence` 改为 `dialogue-shape-without-speaker`，仍然未识别。若只统计输出类别变化，则为 10 页（0.76%），不应表述为 10 页已解决。这不是准确率，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。源摘要相同、`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。实际增量较小，不能称 1,319 条问题已解决。

- v77 已支持的本句局部动作主体引出对白保持兼容；v78 新增两句动作链中由“他/她/它”承接的唯一具名主体归属。
- 总结报告谓词归属说话角色；读文书后引出其内容的引语归入旁白/信息。
- 句首提到一名角色、随后明确由另一人物发言时，拒绝把对白抢归给句首角色。
- 第二名角色在近邻窗口执行动作、多个候选主体、地点/群体/代词来源含混时拒绝猜测。
- 信件、地图、记录、状态块和场景边界不触发人物归属。
- 既有页数组、页索引、页 span、消息正文哈希保持不变。
- 跑 shared adapter、speaker replay、player runtime 回归；独立只读审计通过后才能称审计通过。

## 基线观察

冻结基线共 1,319 项：1,307 项跨越已闭合引语，12 项无引语跨度；主要形态为 487 条对白页无冒号/发言词、323 条旁白页有冒号与引语、266 条旁白页有引语但无局部 cue。结构信号描述的是形态，不是人工真值。回放有 9 项获得说话人或旁白分类改善；另有 1 项只转成其他 dialogue fallback；1,309 项仍保持 no-unique fallback。v78 覆盖面仍窄，不能宣称本阶段达标。

## 剩余 1,309 页的下一阶段审计

同一 source digest 上的只读分型显示：1,309 页全部与已闭合引语相交，1,297 页属于 unresolved quote span，12 页只有 quote evidence；原分页类型为 narration 757、unattributed-dialogue 537、dialogue 15。仅 7 页有前两页 speaker seed，其中 2 页的 seed 指向当前同一引语；1,302 页没有 prior seed、1,307 页没有 matching quote seed。1,266 页含引号标记，404 页符合行首冒号形态，217 页含宽泛 speech-cue 词项，1,092 页没有该词项，0 页以 dash 开头。统计维度之间存在交集，边际数不能相加；“冒号形态”不等于署名。

对剩余样本的有限抽样同时看到：姓名 + 动作 + 冒号引语、叙述中嵌入的直接对白、引语后才出现声音/动作提示、书面内容与真实 NPC 发言等不同形态。因此剩余集不是单一的“续接上一句”问题；开闭引号上限也不是主要阻断点。当前历史回放缺少可用的逐聊天 `publishedSpeakerNames` scope，不能把依赖精确 roster 的姓名动作结构计为已覆盖或据此测准确率。

下一阶段先建立 **页面类型 × 本页引号标记 × 引语是否跨页 × 行首冒号 × speech cue × 前两页 seed** 的交叉分桶，再从 `narration` 与 `unattributed-dialogue` 各抽至少 10 页，保留完整配对引语及前后句。当前历史回放没有可用的逐聊天 roster scope，因此先记录该维度为 `unavailable/unknown`；只有找回真实逐聊天名册后，才能比较 roster 可用与不可用的影响。优先判断提示词/引用来源是否为书面载体、以及对白是否被叙述包装。只有一组重复出现且负例边界稳定的句法结构才值得新增规则；否则保持 abstain。当前证据不足以支持扩大人名猜测窗口或直接新增低置信归属代码。

### 逐聊天 roster 来源审计（2026-10-09）

只读检查 `data/default-user/chats` 中 158 个 JSONL 文件首行（156 个 metadata 头、2 个普通消息记录）、当前本地已发布 scenario store 和其引用的 SillyTavern worldbook：

- 102 个聊天带 `galgame_script_import.kind=chat-seed`，包含导入草稿/源文件摘要和对应 `world_info`。这证明导入资源来源可追溯，但这些 seed 元数据本身没有 speaker roster。
- 另有 29 个非 seed 聊天带 `world_info`；其中 19 个标记同一 Dungeon Master source card/hash 并绑定 `Galgame_Imported_Dungeon_Master_DnD_Base`，10 个 Lucifer 测试聊天分别绑定 Arc 1–4 worldbook（Arc 1 为 4 个，其他各 2 个）。资源引用明确，但不等于发布的逐聊天 speaker roster。
- 27 个聊天没有 `world_info`；其中部分是旧聊天或测试记录，首行也没有 scenario/release/character roster 标识，无法无歧义地回连到某个发布版本。
- 158 个聊天文件的首行均未提供 `scenarioId`、`releaseId` 或 roster/speaker-scope；其中 156 个首行包含 `chat_metadata` 头，另 2 个首行是普通消息记录。现存 `character_name` 是 SillyTavern character/card 名，部分为空或为 `unused`，常见主持/导入卡名，但不是队伍名册。27 个无 `world_info` 的聊天也没有足够元数据无歧义地回连到某个发布版本。
- 本地 store 有 2 份 scenario manifest、4 条 release。两个 manifest 的 `sillyTavernBindings.characters` 都只列 1 个 `role=narrator` 的主持角色，未列实际 NPC/队伍 roster。引用的 Dungeon Master worldbook 有 68 个混合知识库条目，包含角色/同伴、物品、规则、剧情任务、地点等；没有显式角色类型字段，将全部 key/comment 作为角色名会把非角色污染进 roster。Lucifer worldbooks 同样是剧情资源包，不是有版本号的 speaker-roster 文件。

结论：已恢复一部分 **聊天→导入资源/worldbook** 绑定，但 158 个聊天中 **0 个拥有现成、权威、版本化的 `publishedSpeakerNames` scope**。不能将 scenario manifest 的主持人列表冒充 NPC roster，也不能把 worldbook 全部关键词当名册。当前 v78 回放的 roster 维度仍为 `unavailable/unknown`。若后续要利用这些资源，必须先定义一个只抽取明确角色条目/别名的可审计转换，并为每个聊天按其确切 `world_info` 生成独立 scope；在验证该转换前，不应用到 1,309 页 cohort 或声称会提高准确率。原聊天及原版代码未改，未调用 provider。
