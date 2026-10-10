# Galgame 说话人归属与历史回放实施计划（2026-10-05）

## 2026-10-09 v74 roster 主体—冒号引语与 fallback 诊断

v74 增加两项有界处理：同一原消息中，已发布/当前聊天 roster 的唯一角色名位于冒号引语前子句句首时，可直接归属紧随引语，不再要求动作词白名单；若引语前包含多个逗号子句，则优先选择最后一个明确出现且紧邻发声 cue 的 roster 人物，之前的动作句不能盖过新的说话人。后续主体是“守卫/士兵”等群体或职业主体、存在并列主体、信息载体/转述框架或复合名边界不清时，拒绝归属。上述只在 parser v74 生效，不从引号内提及猜人。另将已有性质诊断扩展到 `no-unique-speaker-evidence` 旁白兜底，输出只读分布，不改变实际标题/分类。

在相同源集上分别按 v73 与 v74 只读回放，digest 均为 `sha256:d6a160a55aba6d884d1c44954371b25a6f2cb17feb08c2466357e4dd64a831b2`：158 chats、955 assistant messages、18,696 个原生产页。v73 为 4,150 attributed、1,686 narrator fallback、2,009 unattributed-dialogue candidates；最终 v74 为 4,156、1,679、2,002。逐页投影中有 6 个额外 attributed page；7 个旁白兜底和 7 个 unattributed candidate 被结构证据接管。此增量是覆盖变化，不是准确率。v74 的 1,656 条 no-unique fallback 中 1,644 条与 quote span 相交、12 条无 quote span；生产页型为 541 `unattributed-dialogue`、1,007 `narration`、108 `dialogue`。49 条在前两页可见 speaker seed，24 条可与前页 quote seed 对应；这些只是检索线索，不能自动当作正确归属。

回放期间 158/158 聊天没有可用的 per-chat speaker roster，故全历史回放无法衡量该 roster 规则在角色名单完整时的潜在覆盖；当前无完整逐页 gold，accuracy 仍 `INSUFFICIENT_EVIDENCE`。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。shared adapter 与完整 speaker replay 63/63、runtime regressions 58/58 通过。core final acceptance 仍有一条头像占位图断言失败（期望 unknown，实际 narrator），不属于本轮归属代码路径，本次未修改。独立 A1 最终复审 PASS：加 roster 的尼布动作/续句样例均正确归尼布；守卫主体阻断旧人物继承；“Celestia抬手，尼布随后骂了一声”正确选尼布且不吞入“随后”。复审也确认 v73 保留旧行为、该修复只在 v74 生效，历史 v54 gold/sourceSpan 通过，SillyTavern 冻结路径无改动。源码构建只写入隔离 stage；原有脏 `public/game/**` 未覆盖，因此当前浏览器仍未证明加载 v74。未更改 production pagination 函数或正文来源区间，但任务起点存在既有 segmenter dirty hunk，故不能宣称相对干净 HEAD 的分页冻结哈希已证明。详见 `GALGAME_SPEAKER_ATTRIBUTION_V74_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v70 邻句姓名+发声 cue 末级兜底回放

v70 只在所有现有规则都没有候选、闭合引语未被载体/场景边界拦截时，扫描目标句和紧邻前后句；要求已知姓名与明确发声 cue 落在同一个句界范围内，姓名到 cue 间没有另一人物主体，候选唯一才归属。既有规则优先，歧义继续进入旁白显示兜底。

在同一 source snapshot 上做 v69/v70 只读对照，digest 均为 `sha256:9b97dc97c83840a662413f7bb2d71d8f6a3500f2fd476d33aa30995cedf578c1`：158 chats、954 assistant messages、18,667 个原生产页、6,141 个对话候选页。v69 为 4,057 attributed、330 anonymous introduction、1,754 narrator fallback、0 unresolved；v70 为 4,061 attributed、329 anonymous introduction、1,751 narrator fallback、0 unresolved。v70 规则本身在 3 个 page/quote evidence 上命中；净变化为 attributed +4、anonymous -1、fallback -3。它是 coverage 迁移，不是 accuracy 证据；历史聊天缺 roster，整体 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。两次 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；v70 structural evidence 17,907/17,907 有效，scope unavailable 158/158 chats。

定向 shared adapter 与历史 replay suite 63/63、player runtime regressions 58/58、player/admin static build、DOM smoke、`git diff --check` 均通过。v70 diff 没有编辑生产分页函数；不过本任务开始前工作树已经有 `connectorParagraphPattern` 合并条件差异，当前 segmenter 与此前记录的冻结 hash `a8875278…` 不一致，因此不能把整个工作树描述为分页冻结审计通过。shared/player/admin 当前三份副本保持一致（函数切片 3,464 bytes，SHA-256 `1958454b818de091610fb18382afde9ea5df82e3c88799cadc1106c0e35ebad6`）。独立只读 A1 对 v70 本轮规则 PASS，原版 SillyTavern 冻结路径未改；分页 baseline 差异仅留下既有基线证据边界，需另行核对。详情见 `GALGAME_SPEAKER_ATTRIBUTION_V70_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v68 同句主体动作与引语闭合

v68 回放须验证物品传递、工具使用、人物状态和动作承接结构，并保留书面载体、多主体与独立前页描述的反例。全历史结果用于衡量结构覆盖迁移，不代表准确率；需保留源 digest、读写状态和 parser namespace。实现验收细节见 `GALGAME_SPEAKER_ATTRIBUTION_V68_TASKSPEC_2026-10-09.md`。

最终验证记录：完整 speaker replay suite 63/63、shared adapter tests、runtime regressions 58/58、player/admin static build、static DOM smoke 与 `git diff --check` 均通过。全历史只读回放为 158 chats、951 assistant messages、18,592 production pages、6,108 dialogue candidates；4,023 attributed、333 anonymous introduction、1,752 narrator fallback、0 unresolved。Source-set digest 为 `sha256:aa54e48416e83a1130bfe18c734ee599a0b6f73cbf2cb2a7d86313fb363c2fc5`，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。归档聊天缺少可用 speaker scope，故整体准确率仍 `INSUFFICIENT_EVIDENCE`；旧 v67 快照与本轮不同，不能从净变化推导准确率。独立只读 A1 对冻结 v68 版本给出 PASS；浏览器/移动端人工验收未执行。分页器 shared/player/admin 冻结 slice 均为 3,453 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；本轮不改分页逻辑、聊天正文或 SillyTavern 冻结路径。生成前端已重新构建。

## 2026-10-09 v67 闭合引语与代词承接

v67 在现有 display-title evidence 链上补充两种有界关系：上一句显式 speaker anchor → 最近前页 pronoun-action frame → 当前完整独立引语；以及具名动作主体 → 当前引语 → 同一代词的后置叙述。书面/状态载体、场景边界和歧义继续兜底。完整 Anna 样本及历史 Apartment 5C 的 Priya/Nadia 结构加入回归；标题变化不触碰 production page spans。

当前 v67 全历史只读回放：158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates；3,981 attributed、330 anonymous、1,783 narrator fallback、0 unresolved。对照 v66 的 3,977 / 331 / 1,786 / 0，变化为 +4 / -1 / -3 / 0。新增规则计数分别为 `prior-page-pronoun-linked-quote-continuation=1`、`prior-page-pronoun-speaker-resumption=3`。source digest 仍为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。准确率 `INSUFFICIENT_EVIDENCE`；coverage 不是准确率。parser/cache/replay namespace 为 v67。适配器、speaker replay 62/62、runtime regressions 58/58、静态构建、DOM smoke、最终分页哈希及 frozen-path 检查均已通过。独立 A1 首轮发现文档状态不一致，已修正并等待复核；详见 v67 TaskSpec。当前新增的具名主体—引语—代词回溯子规则只扫描 ASCII 拉丁姓名，中文名不在该子规则覆盖内；覆盖边界已记入 TaskSpec。

# 2026-10-09 v69 前后句明确署名扩展回放

v69 在既有同句/局部归属无法确定时，最多查看目标 quote 前后两句，并只接受明确发声署名。当前直接署名优先；相邻明确署名按最近句选择，普通姓名提及、动作主体不升格；中间出现别的 quote、场景或文书/记录载体时停止继承，同级冲突仍留空。独立 A1 发现“旧署名—书面载体—目标引语”桥接误归属，已补逐句载体阻断和信件/报告回归，复核 PASS。

全量只读回放：158 chats、953 assistant messages、18,637 既有 production pages、6,130 dialogue candidates；4,049 attributed、330 anonymous introductions、1,751 narrator fallback、0 unresolved candidate rows。v69 `expanded-explicit-signature` 命中 1 次。此次 source digest 为 `sha256:4b812e8170122e23b5df0468253a9895ee0f31836f53d130f55f5a006aa341c8`，与先前 v68 回放摘要的 source 集不同，不做跨版本计数比较。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；17,878/17,878 structural evidence spans 有效。speaker roster unavailable，accuracy `INSUFFICIENT_EVIDENCE`，分桶只说明覆盖。

shared adapter、speaker replay、runtime regressions 58/58 与 player/admin static build 均通过，源码及静态 player/admin/replay 版本一致为 `full-message-speaker-index.v69`。production segmenter 三份切片 3,453 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；SillyTavern 原版冻结路径无改动。无聊天写回、无 provider 调用；未进行浏览器/移动端目视验收。详细设计、复现及边界见 `GALGAME_SPEAKER_ATTRIBUTION_V69_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v66 动作引语、匿名指代、跨页续引

v66 将“角色/角色描述 + 发声动作 + 引语”作为组合结构解析，修复动作修饰语误并入姓名；长角色描述（如“银面具贵客”“倒霉小官”）在首次明确发声时只显示“？？？”，`随后有人 + 大喊`同样识别为匿名首次人物。`他 + 发声 cue`只在最近两张既有页面有唯一匿名主体时回指；没有唯一来源时，v66 将未闭合引语设为旁白兜底并保留 `open-quote-without-unique-speaker` 诊断。一个 source quote 横跨多页时沿用最初 speaker，quote 正文提到的角色名不会抢走归属；嵌套引语不会打断外层对话。

验证：adapter suite PASS；speaker replay 62/62；runtime regressions 58/58；player/admin build、static DOM smoke、`git diff --check` PASS。全历史只读 replay 为 158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates：3,977 confirmed attributed、331 anonymous introduction、1,786 narrator fallback、0 unresolved candidates。对照 v65 的 3,947 / 223 / 1,924 / 0，变化是 +30 / +108 / -138 / 0。另有 1,297 个页面侧 structural evidence `unknown`，不计入对话候选 unresolved 桶；不能据此宣称所有页面标题均准确。无代表性完整金标，因此 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。

source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；158 chats 均无 roster scope。分页器冻结区段三份一致：3,453 UTF-8 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。独立 A1 审计 PASS，未发现 v66 范围内缺陷；准确率仍是 `INSUFFICIENT_EVIDENCE`，浏览器/移动端验收未做。详情见 `GALGAME_SPEAKER_ATTRIBUTION_V66_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v65 同 cue 姓名边界和跨页 evidence 修复

回放中两条 unresolved 候选均有同一 source quote 的 rank-0 `瑞恩` winner。page-local 汉字姓名贪婪边界将声音修饰词“小声”并入姓名，造成假冲突；跨页冲突 fallback 还曾把完整 quote span 作为单页 evidence。v65 要求同 cue span/同起点的前缀 tokenization 变体沿用完整 quote winner，source cue 不同则保持 v64 tie-abstain；所有 page evidence 裁在当前 core 内，replay invalid evidence 不再投影 title。

定向验证：adapter 1/1、speaker replay 61/61、runtime regressions 58/58、player/admin static build、DOM smoke、`git diff --check` 通过。全历史只读回放为 158 chats、950 assistant messages、18,562 pages、6,094 candidates：3,947 attributed、223 anonymous、1,924 narrator fallback、0 unresolved。source digest 未变：`sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、无聊天写回、无 provider 调用。v64 的 2 个 unresolved 候选消失，overall source accuracy 仍是 `INSUFFICIENT_EVIDENCE`，因为没有代表性的完整人工 gold；coverage 不是准确率。分页 slice 本轮前后源码/player/admin 均为 3,453 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。静态架构审计未运行（避免 ignored JSON 副作用），浏览器/移动端未验收；独立 A1 待审。完整复现与构建 hash 见 `GALGAME_SPEAKER_ATTRIBUTION_V65_TASKSPEC_2026-10-09.md`。v64 的旧分页起点独立审计缺口没有通过 v65 的本轮 hash 补测而自动关闭。

## 2026-10-09 v64 同 quote resolver 与 probable-title 门控

v64 将 page-local 明确 `姓名 + speech cue + quote` 作为精确 source/evidence span 候选送入现有同 quote resolver；rank 冲突拒判，quote sidecar 不保存落败候选。原生产 segmenter 的四字段 probable hint 仍为 display-only `（推测）` 信号，并消费同一 quote decision：已归属他人或同级冲突时拒绝。不得改源文本、分页、生产 segment 对象、身份/roster/头像或 SillyTavern 原版。

验证：shared adapter 1/1、speaker replay 60/60、runtime regressions 58/58；`node frontend/build-static.mjs` 与 `node frontend/tools/static-dom-smoke.mjs` 通过，`git diff --check` 通过。v64 静态架构审计未执行（任务明确要求避免产生 ignored JSON）。独立 A1 对 resolver/projection/probable 门控未发现明确缺陷，但无法独立核验分页函数相对任务开始状态未变，因此整体审计为 `INSUFFICIENT_EVIDENCE`。全历史只读 replay 为 158 chats、950 assistant messages、18,562 pages、6,094 candidates：3,937 attributed、223 anonymous、1,932 narrator fallback、2 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；158 chats / 18,562 pages 的 roster scope unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。748 个 probable hints 均通过 source span 验证；539 个被同 quote 决议门挡住、209 个未被此门阻断，这些属于 hint 决议门统计，不表示准确率或 replay 中最终显示数。准确率继续 `INSUFFICIENT_EVIDENCE`。Production segmenter frozen slice hash 为 3,453 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`，任务起止相同为实现者记录，独立审计无法核实任务起点快照；不能宣称分页逻辑通过独立审计证明未变。SillyTavern 冻结源码与聊天均未改。真实浏览器/移动端未验收。产物 hashes 和复现记录见 `GALGAME_SPEAKER_ATTRIBUTION_V64_TASKSPEC_2026-10-09.md`。

## 2026-10-09 v63 当前 quote attribution 优先级修正

根因样例 `Pippa说道：“好。”\n\n她抬起手：\n\n第十二阶段\n\n“你来了。”Sam答道。` 的现有 production segmenter 生成独立 quote page；full-message index 已将 quote 归属 Sam，但 heading/pronoun bridge 先返回了前页 Pippa。v63 先判断当前 page core 相交 quote 的 source decision：唯一 attribution 或 conflict 会阻断历史 bridge；普通未归属 quote 只有在旧的唯一、有界连续规则成立时才可沿用。该变更仅改变 display-title evidence，不改 source page、正文、聊天或身份状态。

验证：adapter 1/1、speaker replay 60/60、runtime regressions 57/57；完整只读 replay、player/admin build、static DOM smoke、architecture audit 与 `git diff --check` 通过。v63 全量 replay 为 158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates：3,998 attributed、213 anonymous first appearances、1,883 narrator fallback、0 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`，scope 对全部 158 chats / 18,562 pages unavailable；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。分类数据是 coverage，不是准确率；准确率仍为 `INSUFFICIENT_EVIDENCE`。Production segmenter frozen slice 任务起点/结束均为 3,453 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；SillyTavern 冻结路径未改。真实浏览器/移动端未验收，独立 A1 复审待执行。

v63 static build 命令 `node frontend/build-static.mjs`。player app/index/shared adapter SHA-256：`A7AEF9E1F2C23D2D3FF8A8BB9578CC11098512F930C463B38D85F321D69EBD69` / `8216F83DABFF9EB30B313B00515ADDCD0E3A29DAE4F7F22BBF8A00E4E436FD25` / `3C4EA09E05CF4BF35A0490F3ABEC059B55B7AAC54BCA026D3AB28031213AC63E`；admin app/index SHA-256：`1045A549033948C22B889B488997B64398D01F5004B33FFCD515F8121857CD81` / `35F12C72AB18231363EA6A43075EA83CA1FE3CB033B48C298BDE55D718A2CB91`；两端 adapter hash 相同。详见 `docs/GALGAME_SPEAKER_ATTRIBUTION_V63_TASKSPEC_2026-10-09.md`。

## 2026-10-08 v61 逐引语策略 / v62 parser-cache evidence ranker

本阶段把 v60 的逐 quote 上下文提升为显式 source-bound candidate ranker：每个候选有 source speaker span、evidence span、source region、syntax role 与证据 rank；优先直接署名/发声 cue，其次唯一动作主语，再到有明确连续关系的相邻/既有页来源。同级不同姓名拒判。统一候选还包括带唯一主体的表情/心声框架和命名主体的具名发声动作；前者不是外部文字载体，后者不能推广到孤立拟声。书信、账本、地图、屏幕、属性表等外部文字 carrier 仍阻断归属。嵌套 child 默认不作为新发言；仅明确紧邻的 `X说道/回答/答道` 可做后置回绑，纯动作不倒推。所有结果仅为 display title evidence，不改剧情正文、annotation、身份、roster、avatar 或 SillyTavern source。

生产 cache/parser/replay 版本为 v62；shared adapter 1/1、speaker replay 60/60、runtime regressions 57/57 通过。全历史只读 replay 命令为 `node frontend/player/tools/speaker-structure-replay.mjs`；player/admin 静态构建、DOM smoke 与架构审计已完成。该轮全量 replay：158 chats、950 assistant messages、18,562 production pages、6,094 dialogue candidates；3,998 attributed、213 anonymous first appearances、1,883 narrator fallback、0 unresolved。source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；158 个聊天 / 18,562 pages 的 published-speaker scope 不可用；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。此前临时 v61 摘要报告 6,100/4,022/213/1,865；没有保存其逐页 prediction，故只能记录同源 parser 的覆盖类别变化，不能得出逐页迁移矩阵或准确率。Production segmenter frozen slice 前后都是 3,453 UTF-8 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。旧 SillyTavern 源未改，聊天无写回、无 provider 调用。accuracy 继续为 `INSUFFICIENT_EVIDENCE`；真实浏览器/移动端 UI 未验收。独立 A1 审计待执行，细节见 v62 parser/cache TaskSpec。

本轮 `node frontend/build-static.mjs` 输出关键 SHA-256：`public/game/app.js` `781F66C9F734C2E6722A15BC086EB8E02FAF66B368CC300EC2857BCD8383DAFA`、`public/game/index.html` `C91D5FD2C3A7F6880036214F4B97099F570942C54BB061D5FF7F73B4CA6834B8`、共享 adapter `E0B2A3617793C8073B26019B7B8A155F79B7FCE063BF23B513DD6E6EED8AB5F8`、`public/game-admin/app.js` `A9794F1FF2019000AAE54BD84AB9A3813025027D61F33D31FDC24F24416DEB0B`、`public/game-admin/index.html` `1C0F2DE495913E15812A26BB4E43E3083F0FA37DAD06A5914ACEA473426C458B`；admin/player 共享 adapter hash 相同。

## 2026-10-08 v60 逐引语上下文与前两页动作主体

v60 对原消息的每条引语保留完整 quote span、嵌套父子关系、闭合状态和前后上下文；标题归属仍写入 display-only evidence。单独人名不再足以从上一句直接归属：必须解析到局部动作/发声主体；静态描述、职位介绍和穿着描写是拒判负例。独占对白页会检查原消息前一/前两张既有页：先找唯一显式对白锚点；缺少对白锚点时，才尝试最近页中句法明确的唯一动作主体。闭合旧对白、引号/书面载体、场景切换或同级竞争会阻止继承。开放引语仍逐条记录和分析，但不吞并后续独立引语。

本轮独立审计最初发现“上一句以唯一 roster 姓名开头”会把“漂亮/职位/穿着”静态描述误归给该角色；v60 实施已删除姓名单独兜底，并新增三项负例。新增来源绑定真实历史样本：固定消息哈希及原始页 span 的“Mika 窗边动作 → 下一页独占对白”回放归 Mika；同时保留 v54–v59 历史金标、已闭合引语隔离、竞争人物和载体负例。

全历史只读回放（158 chats、950 assistant messages、18,562 原始 production pages；source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`）：v59 基线为 6,116 dialogue candidates / 4,090 attributed / 201 anonymous introduction / 1,825 narrator fallback；v60 最终 TaskSpec 和末尾全量记录为 6,116 / 4,110 / 204 / 1,802。早先汇总曾出现 4,140 / 201 / 1,775，但没有独立 source snapshot、时间戳或逐页结果支持将其认定为可比较的早期快照，因此不再作为 v60 实施结果使用。本轮确认的最终迁移相对 v59 为 +20 attributed、+3 anonymous、−23 fallback；其中新增的 `prior-page-action-subject-continuation` 为 19 页。变化是覆盖迁移，不代表准确率；没有代表性完整人工金标，overall `speakerAccuracy=INSUFFICIENT_EVIDENCE`。

运行证明：`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；结构化 span 17,804/17,804 有效，unaddressable 0。全量页面仍使用原有 production segmenter 的原 span。本阶段没有修改聊天数据或 SillyTavern 原版代码。完整测试和独立 A1 复审结论在 v60 TaskSpec 验收记录中补记。

## 2026-10-08 parser v57 局部动作主体与同源引语续接

v57 增加 display-only 规则：闭合对白前紧邻同一消息中唯一具名动作主体时，标题归该主体；同一闭合引语跨现有显示页时，续接只由同一个 source quote span 决定。动作关联不得穿越书面 carrier、仅物件转移、场景边界、多个候选主体、未锚定代词或新 speaker。SFX/拟声片段不独立建立 speaker；仅允许紧随显式动作谓词，或精确窄范围的声音框架（如“的金属声：”“声音：”“嗓音：”）续接唯一局部主体。逗号/分句以及新名词/实体事件都会切断旧 actor 连续性，不论是否有标点。

精确生产页回放：msg20/page4 `[175,202)` → 尼布；msg34/page11 `[603,665)` → Pippa；msg248/page15 `[837,874)` quote `[805,875)` → 独眼乔；msg248/page16 `[875,885)` → 尼布。全部消息 hash 固定；独眼乔的前置声音片段没有 speaker anchor，后继尼布没有反向归属长引语。source-bound 4 gold、7 negatives 与单独直接动作正例通过。专项测试 53/53；runtime regressions 57/57、renderer 1/1、shared adapter 1/1。

v57 全历史只读 replay：158 chats、950 messages、18,562 production pages、6,112 dialogue candidates；4,046 attributed、148 anonymous introductions、1,918 narrator fallback、0 unresolved。Candidate fallback reason 合计 1,918：no-unique 1,895、narrative-quote 2、ambiguous-local 4、dialogue-shape 17、其他 0。结构证据 17,804/17,804 有效、0 unaddressable；source-set digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`、`speakerAccuracy=INSUFFICIENT_EVIDENCE`。v56 存档计数与本次不同；旧报告未保留完整逐页预测基线与全部 scope 参数，不能将分桶差额解读成准确率或改善幅度。

player/admin staged outputs 已同步；33 个 player 与 22 个 admin 文件全部与 stage hash 一致。静态架构审计（707 files，0 prohibited active / needs review / failed）、DOM smoke 与 `git diff --check` 均通过。独立 A6 最终复审 PASS：source/player/admin 三个 adapter 对 SFX 后新名词主体边界、直接动作续接和独眼乔真实历史锚点均一致。冻结分页 slice UTF-16 `[49566,52931)`、3,447 UTF-8 bytes、SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb` 未改变。细节见 v57 TaskSpec。

## 2026-10-08 parser v56 匿名实体首次发声标题

v56 仅在同一条 assistant 原消息能支持“匿名实体被引入 → 有语言性的发声 cue → 紧邻闭合语言引语”时，将该页标题投影为 `？？？`；不抽取自述中的名字，也不创建人物身份。文书/公告引用和无语言对白的声响/描述仍是负例；原文、annotation、视觉 identity、聊天数据和生产分页保持冻结。

真实生产页目标经 source hash/page/span 和 production title 路径回放：hash `sha256:655c7df055d87f6dfe5cb1fcc338254a4eac09f7f3c59b874fdfa573e351e9ea`，msg 0/page 4/span `[586,878)`，原预测 `narrative-framed-quote / 旁白`，v56 为 `anonymous-first-appearance / ？？？`、无 speaker identity。两类负例测试通过。逐页 v55→v56 对照找到 22 个 fallback→anonymous 迁移页；所有 22 页的 NFKC/空白归一化 292-codepoint 内容 SHA-256 均为 `2bf3825458690d7f2b41e362578041388763cff20f2247a9399a124bf85e8584`，是同一段 Gribble 内容的重复历史归档。源消息哈希分布：19×`655c7df0…`、2×`240d75ce…`、1×`46c0c811…`。所以这是同一 gold 的 22 个副本，不是 22 个独立样本；唯一规范 fixture 和精确路径范围见 v56 TaskSpec。

最终 v56 全历史只读 replay：158 chats、950 assistant messages、18,562 existing pages、6,240 dialogue candidates；4,524 attributed、140 anonymous introductions、1,576 narrator display fallbacks、0 probable、0 unresolved。Candidate fallback reasons 合计 1,576（no-unique 1,562、narrative quote 2、ambiguous local 2、dialogue shape 10、其余为 0）。相较 v55 为 anonymous +22 / fallback −22，页数、候选分母和源集不变。结构 evidence 17,806/17,806 有效、0 unaddressable；source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。这些是覆盖分布，不是准确率；`speakerAccuracy=INSUFFICIENT_EVIDENCE`。

验证退出码均为 0：v56 gold/negative 2/2、runtime regressions 57/57、renderer 1/1、shared adapter 1/1、speaker replay 51/51、player/admin staged build、architecture audit、DOM smoke、cache/version coherence、segmenter hash、`git diff --check`。build version `auto-2d9e1fab2d65`；同步 SHA-256：player app `756a38ee87665c53793f6220591b9dfdf98f32cf4827002dc244ff6bd47edaa7`，player/admin adapter 均 `d7b844e21d16b57f2afe14372e6b5e9c215e2194d2711d04bef6d502423fac92`。静态审计 707 files、1,515 findings、0 prohibited active/needs-review/failed。冻结分页 slice `[49566,52931)`/3,447 UTF-8 bytes SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb` 与 v55 相同。独立 A5 audit pending，当前是交审冻结版本。

> 状态：v7 历史 smoke 基线曾为 1/12 有效；2026-10-05 用户指定的当前聊天快照回测，最近 12 条为 0 条有效注释、10 条 `ANALYZER_TIMEOUT`、2 条 `INVALID_REQUEST`，平均/p95 延迟约 50,014/60,021 ms，快照未变化且无聊天写回。没有人工 gold，分类准确率仍为 `INSUFFICIENT_EVIDENCE`。用户随后明确要求启用当前 `zh-CN` 发布的 `assisted` 试运行；gate 表仍为空，其他语言仍受 gate 控制。为避免对 302 条 assistant 历史发起无限回填，单次活动 cursor 只分析之前最近 12 条非空 assistant 消息；窗口外继续 unknown-safe。播放器静态产物已重建，相关测试与静态架构审计通过。
> 范围：提升可见剧情文本的段落类型与说话人归属，并用本机历史聊天进行只读回放。
> 权威：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`docs/GALGAME_DESIGN_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`。
> 继承：`docs/GALGAME_PRESENTATION_IDENTITY_AND_STATE_PROJECTION_DEVELOPMENT_SPEC.md` 与 `docs/GALGAME_PRESENTATION_PROJECTION_IMPLEMENTATION_PLAYBOOK.md`。本文件只补足说话人标注输入、旧呈现回退和历史评估，不重定义其 DTO、身份 resolver、视觉 catalog、状态投影或生产 gate。

## 1. 目标与不做事项

让一条 SillyTavern assistant 消息里的旁白、一个或多个角色对白、未知说话人对白、标题/状态/选项被语义正确分段；每段可以回指原始可见文本的精确范围。重点解决“明明有角色发言却被显示成旁白”，并为后续精准头像绑定提供经过校验的 speaker reference。

本阶段不改写或迁移聊天，不改 SillyTavern 生成语义，不读取隐藏 prompt、思考内容、角色卡/世界书正文，不更换故事生成模型，不生成剧情，不更新玩家状态或 roster，不扩大/改变全局 production gate，不编辑任何 SillyTavern 原版文件。

历史数据只读。任何原文样本都不得进入仓库、公开 PR、自动化测试 fixture、提交信息或普通日志。实际回放的唯一输出为本地临时评估数据和不含原文/聊天文件名/聊天 ID/密钥的汇总指标。

## 2. 已确认根因与当前边界

1. SillyTavern 的一条 assistant 消息只有消息级作者标签。Dungeon Master 等标签表示生成该消息的角色/通道，不代表正文里每句话的说话人；把它直接当逐句 speaker 会抹掉角色轮换。
2. 玩家 UI 当前的旧切段器以确定性启发式扫描可见文本。新说话人、动作夹对白、混合叙述和无署名引语没有可靠规则时会落入 `narration`，于是头像和标题一起错误。
3. 已有语义 annotation、证据 span、身份 resolver、缓存与 gated renderer，但 `PRESENTATION_ANNOTATION_MODE='shadow'` 且 `PRESENTATION_GATE_REPORTS` 为空；所以模型结果目前不驱动玩家标签。仅看到 analyzer 健康或 API 返回 200，不能称 UI 分类已修复。
4. 当前调用会从 active manifest 构造最多 32 个闭合 `knownEntities`；本阶段已先修正过去空 cast 输入。名称上下文只能帮助候选定位，不可单独证明谁在说话，也不能将未发布人物升级为发布角色。
5. 已复现的根因是标注合同表达能力不足：原 validator 要求每个 segment 的 speaker evidence 完全落在该 segment 内；但自然句“米拉说：‘你好。’”中，人物提及和署名动词位于 narration segment，spoken words 位于另一个 dialogue segment。若合并两个段以满足 validator，会把叙述误标为对白；若如实分段，validator 会拒绝整条结果。分析服务对该类无效输出重试，最终耗尽 60 秒请求期限，shadow UI 继续使用旧切段器，陌生对白因此落成 narration。
6. 复现证据（不含正文）：早期 analyzer scope 为 `doubao-seed-2.0-lite:presentation-annotator.v1`；最近 12 条请求全部 `ANALYZER_TIMEOUT`，provider latency mean/p95 约 60015/60021ms，`sourceUnchanged=true`、`chatWriteback=false`。本地 v2 合成署名请求复现 speaker span 被错误要求局限在 dialogue segment；允许同一原消息内的署名证据跨 segment 后，v3 合成请求仍因段落 offset/coverage 输出被拒绝。旧 provider DTO 还要求模型复制源消息索引、消息哈希和 segment 哈希，这些字段应由服务端确定性生成，不能成为语义模型的任务。安全日志只记录 request UUID、错误类别、固定验证类别和计数，不记录正文、原始校验路径、token 或异常原文。
7. 已有语义合同要求未知对白与旁白分开，并要求 segment 覆盖原文 100%。所以“改成更多正则”不是可接受修复；本阶段修正可表达性缺陷并保留确定性校验与 unknown-safe 解析。
8. 本轮健康接口实际显示 analyzer scope 为 `doubao-seed-2.0-lite:presentation-annotator.v7`，即独立视觉/呈现分析配置，不是 SillyTavern 的 Claude 剧情生成模型。换故事生成模型不会自动切换此分析器。稳定 12 条历史 smoke 仅 1 条得到有效结构化注释，10 条超时、1 条不可用；这里衡量的是 analyzer 可用/结构接受覆盖，不是归属准确率。
9. 终审还发现实际 `public/game` 一度落后于 player source：旧静态入口将明文聊天文件名作 `chatKey`，把消息级 speaker 写进 `authorLabel`，且未传已发布角色实体。现已用项目构建器从 canonical `frontend/player/src` 和 `frontend/shared/src` 重建 `public/game`；source 与静态请求路径对齐，并通过静态审计。此修正只保证 analyzer 收到合约要求的输入，不代表 shadow 结果已用于玩家画面。

本机 `GET /v1/health` 曾报告 presentation analyzer 已配置，scope 为模型标识 `doubao-seed-2.0-lite` 加提示版本；该凭据和酒馆剧情生成凭据是不同服务配置。本阶段只通过本机 presentation-analysis-service 调用这个已配置分析器，不读取、复制或打印其密钥。每次回放开始前仍须重新检查健康状态和 analyzer scope；scope 变化要作为新的评估运行，不与旧结果合并。

当前历史的只读基线：对活动聊天最近 12 条非空 assistant 消息调用现行 legacy parser，得到 367 个显示段：335 个标为 narration（91.3%）、32 个标为 dialogue、0 个 `unattributed-dialogue`。这是旧 parser 的**输出分布**，没有 gold 标签，不能解释为 91.3% 错误率或成功率；实际分类准确度须按 §4 人工 gold 重测。

## 3. 冻结方案

### 3.1 语义分析输入

- `knownEntities` 由当前已发布 manifest 的 `resourceBindings.characters` 构造，与 `buildPresentationProjectionState()` 使用同一权威 cast：`resolverEntityRef` 为 `published:<id>`；`visibleNames` 只包含 `displayName || name || id` 与明确发布的 aliases；`attributes` 初期为空；`evidenceDigest` 是上述公开绑定字段的稳定摘要。不能从视觉 asset 的文件名或 `visualBindings` 另造角色身份。
- 对模型请求中的 `authorLabel` 固定传空串：它是消息级生成通道，不是正文 speaker，当前任务不需要它。`scope.chatKey` 必须是同一 chat/replay 生命周期内稳定的不透明值：player 侧以 `chat_` 加 namespaced 本地 chat 指针的 SHA-256 派生，回放 CLI 每次运行创建一次 UUID；不得每条消息/每次请求重建，也不得把本地文件名/路径发给 analyzer。每个 HTTP annotation 请求的 `requestId` 单独随机生成。annotation service 在调用外部 analyzer 前从 provider payload 中完全移除 `requestId` 和 `scope`，仍在本地用原始 request 校验 response。原始 chat 文件名只留在本地缓存和时间线校验中。
- 严禁把角色卡正文、世界书、私密聊天元数据、asset URL、图片 ID、密钥或管理员配置放进 analyzer 请求。不得用临时出现的名字扩充“发布角色”清单。
- 只有当前 release / arc 的 binding 可进入该请求；角色 binding 超过协议容量时以确定性排序取前 32 项并记录 `known-entity-cap`，不得随机截断或改变 speaker label。
- player 必须先通过 shared adapter 构建最终请求批次，再使用该批实际裁剪后的 `contextDigest` 和 `analyzerScope` 查写注释缓存；对未命中消息只从已校验请求中替换 message 列表，adapter 接受并复验该 exact prepared request，不能重新筛选 cast 或 context 后沿用旧 digest。
- prompt 明确规定：即使将来存在非空 `authorLabel`，它也不能自动成为任何内嵌台词的说话人。

### 3.2 通用标注指令

在现有固定 system prompt 上做一次版本化升级，说明这是只读文本分类，不是故事续写。对输入正文按当前协议输出精确、连续、无重叠的 source spans，并按证据区分：

- 有直接话语/明确话语行为及可指认 speaker：`dialogue`，speaker 必须由同一原消息中的可见证据支持；署名/话语行为子句可以位于 dialogue segment 之外，并通过 `purpose=speaker` span 精确引用，且该 span 必须覆盖人物提及。不能为满足校验把 narration 合并进对白。未发布的新人物可成为本消息 person mention，但不得由模型分配稳定 ID。
- 确有角色发言但正文无法确定是谁：`unattributed-dialogue`，不可以因为名字不在已知名单里而判成旁白。
- 叙述者描述、动作、场景描写：`narration`；引号不是独立充分证据，引用文本、内心转述、标题不得机械判成角色对白。
- 章节标题、战术标题、状态面板、选项、系统说明按现有 schema 使用 `other-visible`、`status`、`choice` 或 `stage-direction`，不得把标题/小标题当人物名或状态事实。
- 一段正文中说话人改变时拆成多个 source segment；延续同一未闭合引语由既有 same-message quote-continuity 兜底处理，跨消息不得只靠引号状态继承身份。
- 对任何无法从可见原文支持的角色、性别、种族、状态或因果关系输出 unknown/unresolved；不给模型自报 confidence 作为显示或资产自动绑定的独立门槛。

保留浏览器 annotation v1 请求/响应、span hash 校验、实体引用校验、受限重试、超时和日志脱敏机制。provider 内部使用闭合的 `galgame.presentation-analyzer-candidate.v1`：逐字返回每个 segment 起点两侧相邻的短原文锚点、evidence quotes 与语义实体；不复制整段正文，不生成数值 offsets、source index 或 hash。首边界绑定原文开头；其余锚点可在文本中分别重复，但完整锚点序列必须存在且只存在一个严格递增的放置方案。服务端据该唯一序列派生连续覆盖；若存在零个或多个方案即 fail closed。锚点匹配使用线性算法和候选上限，避免高重复文本造成高 CPU；模型须在全序列仍歧义时加长锚点。证据和实体引用仍须精确落在原文，speaker evidence 必须覆盖实体 mention。服务端据证据确定性生成 Unicode code-point offsets、源消息索引/哈希和 segment 文本哈希，最后运行现有 annotation v1 validator。该 internal candidate 不是剧情生成协议，不改变前端 DTO、玩家行为或 SillyTavern 运行语义。当前 prompt scope 为 `presentation-annotator.v7`，使旧缓存失效。提示要求用最少的最大连续片段：同一功能的叙述、同一说话人的连续对白不因句号或标点拆分。OpenAI-compatible provider 使用 strict `response_format.json_schema` 时，从 system prompt 中去掉同一输出 schema，避免重复输入；若上游拒绝 strict schema，JSON-mode fallback 只在 system prompt 中附加一次 schema。若上游接受 strict mode 但返回值未通过本地 candidate validator，最多在同一总 deadline 内切换一次 JSON-object mode，并在 system prompt 中附加单份 schema 后重试；本地严格 validator 始终是最终权威，重复失败即 fail closed。provider 失败日志只记固定验证类别、耗时和白名单错误类型/状态码，不记录模型控制的引用值、请求正文或异常原文。此项只改变 analyzer 内部 provider 请求与缓存 scope，不改变浏览器 DTO、剧情生成协议、玩家行为或 SillyTavern 运行语义。若需要改变浏览器请求/响应 DTO、schema version 或 player-visible behavior，本计划即失效；先修改基线规范并重新审计。

### 3.3 呈现与失效回退

- shadow 继续用于收集/对比分析结果，不能宣称已经改善真实 UI。
- 本阶段不改 `PRESENTATION_ANNOTATION_MODE`，不增加 language allowlist，也不改变跨剧本生产门槛。
- 若未来在独立 gate 通过后使用 assisted，分析服务不可用、模型输出校验失败、时间线/hash 不匹配时，只能显示完整未篡改原文和中性未知身份；不得把失败结果交回已知会将漏识对白归为旁白的旧切段器。
- 当前可见 UI 行为与 production gate 的任何调整，须先更新本计划引用的两份产品基线及本身份规范，再进行独立审计。

## 4. 历史回放和成功率定义

### 4.1 数据保护与样本选取

新增只读 replay 工具只能从显式指定的本地 SillyTavern JSONL 聊天快照读取消息；realpath 必须仍在 `data/default-user/chats` 根目录之下，并拒绝从文件系统根到 chat root 和目标文件之间的任一 symlink/junction/path escape。必须用合成临时目录测试普通越界路径、父目录穿越、聊天 root 自身 symlink、root 内目标 symlink 和 dangling symlink；所有情况均须在读取文件内容前拒绝。只读 `mes` 可见正文与必要的消息索引/role；忽略首行 metadata、备注、swipe 未选版本、隐藏字段和空 assistant 消息；正文以现有 `formatVisualNovelDisplayText` 规则形成玩家实际可见的文本。工具不得调用生成接口、写回聊天/存档、重命名/复制原聊天、遍历非目标目录或输出原文。

回放默认取最近最多 12 条非空 assistant 消息做 smoke；若指定本地私有 gold sidecar，则必须按 sidecar 的 exact source index/hash 选取样本（包括最近 12 条窗口之前的历史消息），任何缺失 index 或 hash mismatch 都在外部分析前 fail closed；绝不悄悄取交集缩小评分分母。评估集先按消息分层抽样，涵盖自然对话、动作夹对白、多说话人段落、新角色首次出现、无署名引语、纯旁白、标题/状态/选择、拒绝/模糊样本。不得让同一聊天的相邻重复 swipe/备份作为独立样本。

将原文发送给已配置 analyzer 属于外部模型处理。回放工具必须要求明确的 `--confirm-external-analysis` 选项，默认 dry-run；UI 和测试不会自动回放整部历史。运行说明显示目标消息数和 analyzer scope，但不显示正文、密钥、URL query 或聊天名。

### 4.2 Gold 与指标

模型输出分布不是“成功率”。准确率只针对人工复核的 gold segment 计算；gold sidecar 含消息 hash、code-point span、类别、speaker ref/unknown，绝不内嵌正文。由一名 reviewer 初标，另一个独立 reviewer 复核不一致项；本轮无法双标时明确标注为单人 adjudication，不能伪称双标。

评分采用 Unicode code-point 级对齐。对每条 source message，预测与 gold 必须引用相同 message hash 和相同的格式化可见文本。先计算 `sourceCodePoints = Array.from(sourceText)`；此后所有 `start/end` 都是 code-point 数组下标，完整覆盖范围为 `[0, sourceCodePoints.length)`，严禁用 JavaScript `String.length` 或 UTF-16 substring 计算偏移。对每段按 `sourceCodePoints.slice(start, end).join('')` 重建文本并校验 `textHash`，段落按 start 升序且无空洞/重叠，拼接后必须逐 code point 等于 source text。任一条件失败则该条 source message 标为无效；它不能从成功率分母中删除，归属类指标按其全部非空白 code points 计为错误，span 覆盖率记为 0。

每个非空白 code point 映射为 `narration`、`dialogue:<canonicalGoldEntityKey>`、`unattributed-dialogue` 或具体的 `other-visible/status/choice/stage-direction` 类型。speaker 引用按以下闭合规则标准化：已发布的 `resolverEntityRef` 只可通过本轮冻结的发布 manifest ID → gold entity key 映射；临时/新人物 speaker 只可通过 gold sidecar 预先标注的显式 mention span 和 annotation 输出中经 validator 接受的 identity link 映射。没有唯一显式映射、未知 speaker、冲突 link 一律视为 speaker 不匹配；禁止用名字相似、别名模糊匹配或模型 confidence 推导正确身份。不同 segment 边界可以对齐，因为计分单位是同一 source text 的 code point，不使用 IoU 阈值。

对齐后，记 `C` 为预测与 gold 类别一致且 canonical speaker key 也一致的已归属 dialogue code points；`P` 为预测为已归属 dialogue 的 code points；`G` 为 gold 已归属 dialogue code points；`D` 为 gold dialogue 或 unattributed-dialogue code points；`N` 为 gold narration code points。计数公式如下：

- `speakerPrecision = C / P`；预测 dialogue 对应的 gold narration、other、unattributed 或错误 speaker 全计入 P 的错误项；
- `speakerRecall = C / G`；漏成 narration、other、unattributed 或错误 speaker 都不计入 C；
- `dialogueFalseNarrationRate` = gold dialogue/unattributed-dialogue 中被预测为 narration 的非空白 code points ÷ `D`；
- `narrationFalseSpeakerRate` = gold narration 中被预测为已归属 dialogue 的非空白 code points ÷ `N`；
- `unattributedDialogueRecall` = gold unattributed-dialogue 中仍预测为 unattributed-dialogue 的非空白 code points ÷ gold unattributed-dialogue 的非空白 code points；
- `predictedUnattributedDialogueRate` = 预测为 `unattributed-dialogue` 的非空白 code points ÷ 预测为 `dialogue` 或 `unattributed-dialogue` 的非空白 code points；这是模型 abstention 的预测侧比例，不能替代或抵消 `speakerRecall`；
- 每个其他 visible kind 的 per-kind recall = 该 gold kind 中预测 kind 完全相同的非空白 code points ÷ 该 gold kind 的非空白 code points。

任一分母为 0 时该指标报告 `null`，不得报告成 100%。每个 source message 的全部归属错误（包括无效预测、服务/模型失败、错误 schema 和缺失结果）都保留在相关 gold 分母中；无效预测的全部非空白 code points 按未命中处理。报告给 point estimate；本地 pilot 如有至少两个不同 script cluster，也给 script-cluster 95% percentile bootstrap CI。对每个指标单独取分母大于 0 的 script cluster，按 `scriptId` 的 Unicode code-point 字典序排序；令 `K` 为该列表长度。若 `K < 2`，CI 为 `null`。随机数状态在全部迭代开始前仅初始化一次为 `state = seed >>> 0`，并在 2000 次迭代及其全部抽取间连续推进；每次抽取执行 `state = (1664525 * state + 1013904223) >>> 0`，将 `state / 2^32` 乘以 `K` 后向下取整作为该次抽取的 cluster 下标；每次迭代抽取 `K` 次、有放回。合并被抽中 cluster 的分子/分母后计算比例。默认 seed 为 `20261002`，固定运行 `2000` 次；将有效比例升序排列后，下界取 `floor((n-1)*0.025)`、上界取 `floor((n-1)*0.975)` 对应值。因分母大于 0 的 cluster 才进入各指标抽样框，每次比例均有定义；报告每个 CI 的 eligible cluster 数。该本地 pilot 算法只用于探索，不声称等价于 production gate 的证据算法。本地 code-point 指标不能替代正式 gate；正式 production gate 的指标、报告和 bootstrap 必须完整复用现有 `frontend/shared/tests/presentation-golden-runner.mjs`，不得另造与其不兼容的 gate 计算。

至少报告：

- `spanCoverage`、span hash、原文重组一致性、schema validity；四项必须全量为 100%。

旧 parser 与 candidate analyzer 用同一 gold sample 对比 confusion matrix，至少呈现 `dialogue→narration`、`narration→speaker`、`known cast→unknown`、`new speaker→unknown` 四类变化。报告还应分别统计候选 analyzer 返回有效注释的覆盖率、服务/模型失败数、provider latency 及预测侧 `predictedUnattributedDialogueRate`；不能把失败样本从分母删除，也不能用高 unknown 比例掩盖 recall 不达标。

本地单剧本回放只用于修复当前案例和发现泛化问题，不能用于开放 production gate。最终 production gate 继续沿用身份规范：至少 5 部完整留出剧本、20 个独立聊天以及规定的分层样本数和置信区间；不满足就保留 shadow/unknown。

### 4.3 本轮迭代目标

1. 对同一个冻结的人工复核 gold sample，先回放当前旧 parser 和现有 candidate annotation，记录基线。
2. 只按错误类型修改通用 prompt、knownEntities/context 输入和必要的 schema validator；不得根据一个词/角色/某段剧情加 regex。
3. 每次改动 bump prompt/scope version、使旧 cache 失效，然后在完全相同 gold sample 回放；比较混淆矩阵和 latency。
4. 本地验收门槛：gold 样本中 speaker precision ≥97%，明确 speaker recall ≥90%，对白错判 narration ≤2%，narration 错判 speaker ≤1%；source spans/hash/覆盖率 100%；未知/新人物不会被错误映射到发布角色。未达到则继续迭代或明确阻断，不以“模型回答 HTTP 200”收口。
5. 达到本地门槛也不改变 production shadow 状态。最终结果要标明 gold 数、来源剧本数、review 方式和置信区间；单剧本指标只代表该样本。

## 5. 文件和所有权清单

| 文件/路径 | 任务 | 允许边界 |
|---|---|---|
| `frontend/shared/src/presentation-annotation.js` | 发布 cast → closed knownEntities 的纯函数与证据摘要 | 不加模型持久身份映射 |
| `frontend/shared/src/presentation-analysis-adapter.js` | 从最多 32 个已发布实体中优先选择当前消息/上下文命中的实体，每批最多 16 个；body 超限时按既有确定性降级规则缩减 | 遵循 playbook；不改 DTO、偏移或响应校验 |
| `frontend/player/src/main.js` | 构造当前 release 的已发布角色上下文并传给现有 analyzer | 不读 hidden ST data；不改生产 mode |
| `external-modules/presentation-analysis-service/server.mjs` | 更新通用分类 prompt/version；provider 用语义候选 DTO，服务端本地 materialize 索引/哈希并校验 annotation v1，保证 cache scope 正确失效 | 保持 loopback/provider adapter/日志边界；不要求模型计算哈希或源索引 |
| `frontend/shared/tests/presentation-annotation.test.mjs` | known entity 构造、alias、容量、私密字段排除测试 | 合成 fixture only |
| `frontend/shared/tests/presentation-analysis-adapter.test.mjs` | 验证第 17–32 项中被当前消息/上下文提及的角色可进入 16 项窗口，body 超限时仍会确定性降级 | mock transport only |
| `external-modules/presentation-analysis-service/test.mjs` | prompt 的 speaker/narration/unknown/标题规则合同测试 | mock provider，不联网 |
| `frontend/shared/tools/presentation-history-replay.mjs` | 只读历史回放 CLI，仅输出本地汇总或私有 sidecar 指定的指标 | 放在 AGENTS.md 允许的 `frontend/shared/**`；不调用故事生成 API；默认不发外部请求；不写聊天 |
| `frontend/shared/tests/presentation-history-replay.test.mjs` | 临时目录合成 JSONL、隐私字段剔除、gold metric、路径穿越/symlink escape 与损坏输入测试 | 不含真实剧情 |
| `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md` | 本阶段计划、迭代和真实回放证据记录 | 只记录汇总，不记录原文、文件名或密钥 |
| `public/game/**`、`public/game-admin/**` | 源实现通过 build script 产生的 player/admin app build | 不手改生成文件；不覆盖其他未提交用户 build，构建前后需比较清单/hash |

禁止编辑 `src/**`、`server.js`、`plugins.js`、`public/index.html`、`public/script.js`、`public/style.css`、原版 extensions、`config.yaml`、root manifests、启动脚本、chat/save 数据、private provider config、任何 key。

## 6. 执行清单与验证

### 文档审计（写代码前）

- [ ] 独立审计员只读对照三份权威产品文档、身份规范、本计划和 `AGENTS.md`。
- [ ] 确认本阶段没有重定义 DTO、生产 gate、原版资源权威或 player UI 行为；发现冲突先改文档并重新审计。
- [ ] 冻结允许文件、初始 dirty baseline、gold 标签策略与外部 analyzer 使用范围。

### 实现与单元验证

- [ ] 按 §5 顺序实现，先纯函数 + 合同测试，再 player/service 接线，再只读 runner。
- [ ] 测试 known cast、alias 去重、未知新 speaker 不污染 published cast、同名冲突、上限截取确定性、关闭 analyzer、错误 schema、提示注入正文、跨分页引语、中文/英文/日文和标题/状态对照。
- [ ] replay runner 路径测试明确包含根目录内读取成功、普通越界拒绝、`..` 穿越拒绝、指向聊天根外目录的 symlink 拒绝、根目录内目标文件 symlink 拒绝、dangling symlink 拒绝；失败必须发生在读取/解析目标聊天内容前。
- [ ] 运行：

```powershell
node --test frontend/shared/tests/presentation-annotation.test.mjs frontend/shared/tests/presentation-analysis-adapter.test.mjs frontend/shared/tests/presentation-cache.test.mjs frontend/player/tests/presentation-renderer.test.mjs frontend/player/tests/chat-history-recovery.test.mjs
node --test external-modules/presentation-analysis-service/test.mjs frontend/shared/tests/presentation-history-replay.test.mjs
node frontend/build-static.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs --scope frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules
git diff --check
```

- [ ] 在隔离的临时 chat 副本/合成数据上先验证 replay tool 不写原始 JSONL、不会序列化 header metadata，不联网；再由操作者明确允许时用真实本地消息和本机 analyzer 做少量回放。
- [ ] 对真实 history 只读提取最新 12 个非空 assistant 消息做模型 smoke；再用人工复核 gold sample 逐层迭代，运行前后都核对当前 chat SHA-256 未变、原聊天/存档写入计数为 0。
- [ ] 重新 build 后实际 `public/game` 必须与源代码一致；不自动 merge、覆盖或删除 workspace 中已有未提交文件。

### 最终独立审计

- [ ] 固定精确 diff/hash 后由不同审计员检查 source freeze、输入边界、无私密上下文泄露、失败/超时 unknown-safe、回放无写入、gold 指标和报告诚实性。
- [ ] 独立审计必须 `PASS`；任何真实模型指标须包含实际 analyzerScope、sample count 和 gold review 方式。`ROUTE_UNVERIFIED` 作为单独提示；不得声称 provider 使用了剧情生成 key。
- [ ] 若样本太少或人审未完成，代码测试可通过但分类成功率判定为 `INSUFFICIENT_EVIDENCE`，production mode 继续 shadow；不得把任务写成完全修复。

## 7. 当前执行状态（v24 已运行；结构回测完成，语义准确率未验证）

- 运行模式：player source/build 使用 `assisted`；显式试运行 allowlist 仅放行 `zh-CN`，`PRESENTATION_GATE_REPORTS` 为空，其他语言继续 gated。Annotation v1 内含分类、speaker/entity、identity-link 与 state-claim 字段；只有文本有直接证据时才会输出身份/状态声明。场景连续性使用独立 analyzer contract。
- 当前代码与本机分析器 health 均为 `presentation-annotator.v24`，且 8798 代理和 8801 服务均报告已配置。v24 对普通分类行新增受限 ID/evidence 对齐恢复：只有当前请求的分类 evidence cells 唯一归属到一个 source unit、无已知 ID 冲突且所有单元一一覆盖时，才恢复行序或未知 unit ID；mixed 行没有分类证据，必须有有效 request-local unit ID。最终仍执行完整 Annotation v1 校验。对上游 HTTP 400 且结构化 `type=server_error` 的响应增加最多一次重试，继续计入原有 deadline/semaphore/24-call budget。provider 错误日志只含固定 envelope/type/code/param allowlist。公开 DTO 未改变，SillyTavern 原版源文件未修改。
- v23 历史回放：目标 index 657 为 14/14 evidence-backed segments、3 段明确 speaker、24.249 秒。最近 12 条有 11 条有效注释、1 条因 `unit-id-invalid` + `unit-coverage` 被拒绝；177 个已接受片段全部有分类证据，均值/P95 38.445/59.035 秒。该精确失败目标随后单独重放通过（23/23 有证据、4 段 speaker、50.683 秒）。批次结束 `sourceFileUnchanged=true`、`chatWriteback=false`、`sourceTextPrinted=false`。
- v24 真实目标 index 661 曾单条通过一次（21 段均带分类证据、6 段 speaker、41.789 秒），但在最近 12 条批次里也出现过 `INVALID_MODEL_OUTPUT`；index 659 的单条复跑通过（20 段带证据、2 段 speaker、55.709 秒）。这说明单条结果可恢复，但不是稳定语义准确率证明。
- v24 首轮最近 12 条最终批次：6/12 结构接受，6/12 fail closed；接受的 95 段全部带分类证据，12 段明确 speaker，81 个 entity，1 个 state claim，0 个 identity link；均值/P95 34.485/97.378 秒。拒绝项为 4 个上游 `ANALYZER_UNAVAILABLE` 和 2 个 `INVALID_MODEL_OUTPUT`。安全日志确认 4 个上游响应均为 HTTP 400、结构化 `type=server_error`，没有已知 `code` 或 `param`，且都执行了受限重试；另 2 个在最终合并的 Annotation v1 校验处 fail closed，日志类别为 `merge-final-v1-validation` 加其他/`outside-segments`。因此重试没有消除本轮的上游故障，最终合并校验拒绝仍是需后续调查的代码路径；不可把这些样本标成旁白或伪造有效结果。
- 本轮批次在 340 条 assistant 快照上启动；执行期间聊天新增到 341 条（索引 681），用户确认这是其推进产生的。回放 helper 只将开跑时读取的内容保存在进程内存并调用分析端点，没有聊天写回；所以 `chatWriteback=false`、`sourceTextPrinted=false`，而 `sourceFileUnchanged=false` 是该并发新增造成的。索引 681 不在已回放的 12 条内。
- v24 本轮代码验证：presentation-analysis-service 测试通过；annotation、adapter、renderer、visual-presentation 测试通过；静态架构审计 705 文件、prohibited active 0、needs-review 0、failed checks 0；source-freeze 状态为空。独立静态审计 PASS：ID/evidence 对齐保持 fail closed；日志仅输出固定 allowlist；一次 `server_error` 重试在 deadline、semaphore 和每请求 24-call budget 内计数。README 四层/六层细分文案已统一为六层。
- Gold/准确率：没有人工标注 gold sidecar。上述结果仅是结构有效率、覆盖率和延迟，不是语义准确率；不得用有效 Annotation 数代替 speaker precision/recall。

## 2026-10-05 最新回测边界

- 历史回放只读读取本机聊天快照，不写回 SillyTavern 聊天或存档，不打印剧情正文或 provider secret。
- `zh-CN` 试运行只让通过原文 span/hash/evidence 校验的分析结果驱动画面；失败路径保留正文并走 unknown fallback。
- 分类语义是否准确仍需用人工核验的 gold sidecar、既定 confusion matrix 与分剧本置信区间判断；本机模型成功响应不能代替人工标签。

## v24 根因诊断补测（2026-10-05）

- 为定位合并校验拒绝，在 `external-modules/presentation-analysis-service/server.mjs` 增加仅用于诊断的固定结局：`recovery-not-applicable`、`recovery-revalidation-failed`、`recovered`，并单独记录脱敏后的初验/复验类别。结局不塞入 validator errors；恢复不适用和复验失败仍 fail closed。测试覆盖恢复不适用、二次校验仍失败、成功恢复及日志不含正文/凭据/provider body。Annotation v1 DTO 和接受标准不变。
- 只重启了独立语义分析服务；健康检查返回 `serviceReady=true`、`analyzerConfigured=true`、scope `presentation-annotator.v24`。没有重启 SillyTavern，也没有更改聊天或存档。
- 补充真实最近 12 条只读回放开始时的 assistant 快照为 342 条，目标索引 661–683。结果：3/12 结构有效，9/12 `ANALYZER_UNAVAILABLE`；9 个失败日志全部是 HTTP 400、结构化 `type=server_error`，`code` / `param` 均为空，每条有 2 次 provider attempt（含一次受限重试）。本批没有触发 Annotation v1 合并失败，所以新 recovery outcome 埋点尚未被真实失败命中；它目前由合成测试验证。
- 接受的 3 条共有 42 段，42/42 有分类 evidence，7 段 speaker，35 entities，2 state claims，0 identity links；kind 汇总 narration 16、dialogue 7、unattributed-dialogue 14、status 5；均值/P95 21.335/87.678 秒。9 条上游错误未降级成旁白。没有人工 gold labels，不能据此宣称语义准确率。
- 回放报告 `chatWriteback=false`、`sourceTextPrinted=false`、`sourceFileUnchanged=false`。运行中玩家继续推进，开始时 342 条 assistant 消息，回放后快照计数为 344；索引 685、687 不在本批快照中。没有覆盖或恢复任何聊天数据。
- 本次结论：本机分析服务进程和配置正常；当前阻断 9/12 回放的是上游 analyzer 对 9 个请求均返回 `server_error`，本地一次重试未恢复。错误响应不含可区分的 `code` / `param`，因此不能进一步断定是上游模型故障还是代理内部映射。合并 validator 原先缺少恢复阶段证据的问题已补足，但仍需在一次真实 Annotation v1 合并失败样本中读取新字段，才能确认那两条历史失败是否由 lookaround entity/evidence 边界造成。

## v24 第二轮复测与字段归因（2026-10-06）

- 为把此前的 validator `other` 收窄到安全字段类型，日志类别增加固定枚举 `outside-segment`、`range-or-coverage`、span 边界字段及 entity/segment/link/state record-shape 类型；映射不含原始路径或记录索引，不改变验证、恢复和接受规则。相关 service 测试 PASS，独立代码审计 PASS。
- 上游短暂恢复后，单条 index 685 重放通过：13/13 段有 classification evidence，0 个明确 speaker，8 entities、1 state claim，25.109 秒。该结果只证明结构接受，不足以评价语义准确度。
- 新近 12 条批次开始时快照为 344 条 assistant 消息，目标索引 665–687：2/12 结构接受、10/12 fail closed；2 条 `INVALID_MODEL_OUTPUT`，8 条 `ANALYZER_UNAVAILABLE`。接受的 38 段全部有 classification evidence、3 段明确 speaker、27 entities、0 state claims、0 identity links；kind 为 narration 19、dialogue 3、unattributed-dialogue 9、status 7；均值/P95 22.238/62.182 秒。批次 `sourceFileUnchanged=true`、`chatWriteback=false`、`sourceTextPrinted=false`。
- 该批的两条输出失败分别为一个 `MODEL_JSON_INVALID`，以及一个 merged Annotation v1 validation failure。后者初验诊断记录 `recovery-not-applicable`，类别当时仍是 `other`，因此可确认不是“恢复后仍失败”，但不能确认不适用的具体 validator field。随后扩充分类映射后，对 index 671 的两次定向重放均在生成前置调用阶段被 HTTP 400 `server_error` 中断；每次两次 attempt，未复现 merged validation 错误，新字段因此还没有拿到该失败路径的真实类别。
- 本轮两次最近 12 条回放的 400 `server_error` 具有间歇性：第一批 9/12 analyzer unavailable 后，index 685 曾通过；第二批 8/12 analyzer unavailable；随后 index 671 定向重放仍两次 analyzer unavailable。每个记录到的 server_error 请求均只做一次受限重试，响应无 `code`/`param`。证据指向上游波动，但不能断定供应商/代理内部具体故障原因，也不支持宣称“本地语义逻辑已全部修好”。
- 当前运行结论：服务健康、配置正常，`zh-CN` 仍为 assisted 试运行；Annotation v1/unknown-safe 仍正确 fail closed。稳定性受到外部 analyzer 间歇故障影响；最终合并失败的具体字段尚待下一次重现后从新增安全类别确认。当前没有人工 gold sidecar，speaker 语义准确率仍 `INSUFFICIENT_EVIDENCE`。

## 2026-10-07 probable 引语跨页续接回放（v9）

- 新增仅供标题的保守续接：早前 source page 有经过现有生产 segmenter 与 anchored exact-span 校验的 probable name/action/quote seed；后页必须落在同一 assistant message hash、同一 `unattributed-quoted-speech` 全消息跨度，且当前页所有相关 quote span 都只解析到同一 seed speaker，才显示 `姓名（推测）`。
- 不把 derived page 当作新 seed，不跨消息、不从相邻关系、message author 或普通标题继承。speaker 身份、头像/角色视觉 channel、正文分页、segmenter、source page 的 text/span/type/index/order 都不因 sidecar 变化。未归属对白视觉上下文保持 unknown。
- 同 digest 全量回放：158 chats、939 assistant messages、18,169 pages；6,172 dialogue candidates 分桶为 462 `confirmedAttributed`、803 `probableDisplayTitle`、4,907 `unresolvedCandidates`。其中新 continuation 命中 160 pages/160 quote-span links。728 个 production probable hints 均通过 page-local source evidence/span validation；total structural evidence 15,495/15,495 有效，5 pages unaddressable 留 unknown。digest `sha256:2e920555d97cff42c2067c53055c2d46e1922c7e2ca21083ef41ba59d0126900`，source unchanged，zero writeback，zero provider calls，约 3.4 秒。
- 这表示覆盖提升，不证明正确率提升。没有人工 gold，`speakerAccuracy=INSUFFICIENT_EVIDENCE`；聊天级发布角色 scope 也 unavailable。后续若要声称准确率，需要抽取 continuation 页建立 holdout。
- 开/闭引号两句强制截断未实现：历史扫描未发现未配对的中文开引号，且 2,331 个配对跨度里有 341 个出现超过两处句末标点；按两句硬切有误拆正常长对白的风险。没有真实 malformed-output 样本前保持 unknown-safe，不靠标点制造 speaker attribution。

## 2026-10-06 可用性定向修复（无历史回放）

- 继续固定 `claude-sonnet-4-6` 语义分析 scope：`presentation-annotator.v26` 与 scene continuity v6。重启后 8801 analyzer 和 8798 代理 health 均为 ready/configured；没有读取或写回聊天数据。
- 定向代码修复：短文本和长文本的自然边界均必须落在 grapheme 边界，避免把 CRLF 分开。Claude 适配器为兼容上游对中文弯双引号的 JSON 输出，将 provider-only 源文本副本里的 `“` / `”` 转为 ASCII；新补的证据协调只恢复在原文归一后唯一定位的 source-derived 字段，歧义证据触发现有可选声明恢复并降级为未归属对白。原始文本、hash、span 和 Annotation v1 校验仍保持不变，不降低验收门槛。
- 验证：presentation-analysis-service 定向测试 PASS，覆盖唯一证据恢复、混合 ASCII/弯引号歧义时安全降级、短/长 CRLF 字素边界；`node --check` 与 scoped `git diff --check` PASS；独立 A1 审计 PASS。
- 单条合成 smoke（非历史聊天）：首次遇到本地服务 `429 RATE_LIMITED`，等待后请求成功；改动前成功响应虽为 HTTP 200，但 speaker 因归一化引用与原文引号不一致而被安全降级。修复并重启后的单条请求返回 HTTP 200、Annotation v1、1 个 `dialogue` segment、1 个 speaker/entity，source hash 与原文一致。只用于链路可用性确认，不代表复杂对白准确率，也未做大规模历史回测。

## 2026-10-08 v39 近期人工校准回放（结构化 only）

- 当前活跃聊天 `Dungeon_Master-20260726092140.jsonl` 的七个用户样例按原文页复核：msg 832/page 27 `永冻守护者`（近处冰霜巨人介绍；蓝龙艾萨克斯是旧盟友提及）；msg 834/page 3 `永冻守护者`；msg 840/page 3 `Kael + Mira`；msg 846/page 16 `？？？`；msg 848/page 24 `泽诺斯`；msg 848/page 36 `旁白`；msg 848/page 41 `泽诺斯`。
- v39 对相邻命名实体引入、最近失败/命中目标短反应和孤立喊声补充了结构化规则。无唯一局部名字时，针对实体代词/短反应使用旁白兜底；匿名首次出场仍为“？？？”。规则不全局覆盖任意无法归属的对白。
- 同聊天只读回放：435 assistant messages，11,840 pages，4,606 dialogue candidates；3,949 attributed，657 未确认为角色归属。其中 31 条是匿名首次出场，73 条有 probable display title，剩余 553 条仍 unresolved。与本次回放前的内容摘要哈希一致：`642ceb98b8b77b91afa3914751e60d83b085d292be8a0dddcbe6e4d4e28f7e9c`。`chatWriteback=false`、`externalProviderCalls=0`。
- 这七条符合当前新增结构规则，不等于全聊天识别准确率。全聊天准确率仍缺逐页金标；当前覆盖数不能替代人工准确性评估。源正文及现有分页范围保持不变。

## 2026-10-08 v40 user labels and active-chat replay

- The user excluded the English goblin sample as a fault and labeled the six target pages, in order: `短弓手`, `尼布`, `尼布`, `瘦竹竿男`, `Pippa`, `Celestia`.
- v40 uses local explicit speaker evidence even when narration/unresolved speech overlaps the page; resolves overlapping anchors in favor of the more local direct attribution over a loose roster-prefix or turn-header cue; supports a subject action followed by a direct speech cue, a quoted character-reaction frame, and a leading page-local name/speech predicate for a quote that spills over the existing page edge. Generic pronoun/anonymous subjects remain ineligible.
- The active-chat source replay is read-only. At the latest run it scanned 435 assistant messages and 11,840 existing pages (4,635 dialogue candidates): 4,034 confirmed attributed. The remaining 601 candidates comprise 24 anonymous first appearances, 67 probable display titles, and 510 unresolved candidates. All six selected historical page spans matched the user's labels. The chat digest remained unchanged; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`.
- Focused adapter and replay tests pass. This establishes agreement on the six reviewed samples, not whole-chat accuracy; no full page-level gold set exists. The parser changes do not edit the production segmenter/paginator or source text.
- Full-history v40 read-only replay after version propagation: 158 chat files, 950 assistant messages, 18,562 existing pages, and 6,064 dialogue-candidate pages; 4,072 attributed, 138 anonymous introductions, 78 probable titles, and 1,776 unresolved. Evidence-validity was 17,812/17,812; source-set digest stayed `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. This is coverage only: no complete page-level gold set or published per-chat roster was available, so it does not establish corpus accuracy.

## 2026-10-08 v41 direct verbal predicate

- Added `骂了一声`/`骂了一句` as a bounded direct speech predicate for a locally named subject followed by a quote, including a short same-subject comma-separated action clause. This covers the observed shape `尼布在侧翼探出头，骂了一声：“……”`; it does not infer a speaker from action-only text.
- This is a title-evidence change only. It does not modify source chat text or the existing page segmentation/pagination functions. Rerun targeted adapter/replay tests and the active full-history coverage replay, and retain the accuracy limitation because the corpus has no complete per-page gold set.

## 2026-10-08 v42 connective pronoun speech across a split

- The user’s mixed narration/dialogue rule also applies when a paragraph has a narration clause followed by `紧接着他/她……喊/说：“……”`, while the unique explicit speaker anchor is on the immediately preceding existing page. The active example is Nibu’s quote split between the reaction page and two quote pages.
- Added a bounded 48-character connective-lead path. It uses the previous explicit speaker anchor only when unique, blocks a published character name in the lead, and keeps multi-speaker competition unresolved. It also blocks the generic Han-name fallback from inventing a character called `紧接着他`.
- A title on the first quote page also carries through the existing open-quote span to its continuation page. Production page generation and source text are untouched.
- Regression includes the exact Nibu split and a competing Pippa/Nibu case. Full-history replay after v42: 158 chats, 950 assistant messages, 18,562 existing pages, 6,065 dialogue candidates; 4,080 attributed, 138 anonymous introductions, 77 probable, and 1,770 unresolved; evidence spans 17,812/17,812; source digest unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`, with no writeback or provider call. This is coverage evidence only, not measured accuracy.

### Speaker title structural rules v43 (2026-10-08)

Apply the latest seven user-calibrated labels through title evidence projected onto the existing SillyTavern display spans: player action followed by first-person quoted declaration → `你`; a newly introduced unnamed voice → `？？？`; a spirit's first-person farewell may inherit the uniquely named spirit from the immediately preceding spirit-action clause; a named action subject before a colon quote retains its full compound name (including `·`); a nearby explicit speaker may carry through `它 + creature-specific object/action + quote` when unique; and a quoted laugh followed by that same named actor's laugh/speech remains attributed to the actor. Keep generic narration distinct from a first-appearance unknown speaker. Competing action subjects, source/system-information frames, non-unique nearby anchors, or missing explicit evidence remain unassigned/narration-safe. This changes display title evidence only; do not change message text, page spans, pagination, persistent identity, or original SillyTavern source.

### 2026-10-08 v43 seven-label replay and corpus coverage

- The user's seven labels were replayed against the actual pages in `Dungeon_Master-20260726092140.jsonl`: player line → `你`; the first void mage's unnamed shout → `？？？`; the spirit's “吾回来了” farewell → `霜石`; the explicit Froststone action quote → `霜石`; compound name → `霜咬·银翼`; the dragon-scale pronoun continuation → `霜咬`; Durik's laughter plus quoted speech → `Durik`. All seven agree with the user's labels. The user note on item 2 means an unnamed first appearance is displayed as `？？？`, not the generic unknown title.
- v43 full-history replay (read-only): 158 chats, 950 assistant messages, 18,562 existing pages, 6,071 dialogue candidates; 4,099 attributed, 138 anonymous introductions, 73 probable titles, and 1,761 unresolved candidates. Evidence spans valid 17,812/17,812; source-set digest unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; no chat writeback/provider call; zero unaddressable pages.
- Versus the recorded v42 coverage snapshot: +19 attributed pages, -9 unresolved candidates, +6 candidate pages, -4 probable titles. This is structural coverage, not corpus accuracy; no complete human gold exists. The targeted seven are user-confirmed agreement, and all original production page spans were reused exactly.
- Validation: adapter tests 1/1 and replay tests 33/33 passed. The parser and replay version is `full-message-speaker-index.v43`. No page segmenter/paginator logic or original SillyTavern-owned source was changed in this delta.

### 2026-10-08 v44 dragon-scene labels and replay

- Applied the seven latest user labels: an already observed nearby dragon is titled with its compound name, a new/unseen dragon speaker stays `？？？`; explicit player declaration is `你`; named dragon quote/action pages retain `霜咬·银翼` or the directly named short form `霜咬`. The bounded lookback rejects distant or competing dragon names, and stops at Markdown headings, horizontal separators, or explicit scene/location markers; generic dragon labels are not character names.
- Regression: replay fixture covers all seven positive labels and four negative cases (no prior dragon name, name outside the bounded window, competing dragon names, and a Markdown scene heading). Adapter tests pass 1/1 and replay tests pass 34/34.
- Full-history replay v44 (read-only): 158 chats, 950 assistant messages, 18,562 existing pages, 6,074 dialogue candidates; 4,111 attributed, 141 anonymous introductions, 73 probable titles, and 1,749 unresolved candidates. Evidence spans remain valid 17,812/17,812; source-set digest unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; no chat writeback/provider calls; zero unaddressable pages. Compared with v43, +12 attributed and -12 unresolved candidates. These are coverage counts, not a corpus accuracy claim.
- The active dragon encounter’s source pages show `？？？` for the first unnamed voice only when no local dragon name is established; later named dialogue resolves to the full/short names specified by the user.
- No display segmenter, source span, or pagination function was edited. Only the structural speaker evidence, its replay fixture, version/cache outputs, and documentation were updated.

### Speaker title structural rules v45 (2026-10-08)

The user-confirmed labels establish these reusable shapes: local role + welcoming action + quote (`镇长`); named role + pronoun/action continuation + quote (`首相`); creature/person descriptor + speech-linked hesitation or reaction (`章鱼`, `光头`); explicit player action followed by a standalone quote (`你`); and named NPC + speech verb (`莫里斯`). Anonymous first-appearance descriptions remain `？？？`. Voice descriptors such as `冷声` are not character names even when followed by `说道`. Regression also covers `一个陌生身影……冷声说道：“…”` as anonymous. Full-history v45 replay is read-only: 158 chats, 950 messages, 18,562 existing pages, 6,074 dialogue candidates; 4,120 attributed, 140 anonymous, 73 probable, and 1,741 unresolved. Evidence spans validate 17,812/17,812; source-set digest remains unchanged; no chat writeback or provider calls; zero unaddressable pages. Relative to v44 coverage, +9 attributed and -8 unresolved. This measures structural coverage only, not accuracy. Parser version is `full-message-speaker-index.v45`; source text and production page spans were not modified.

补充线索：结构化说话谓词增加“开口”；引号前的中文/英文逗号可作为说话 cue 的分隔符，例如 `Mira终于开口：“…”`、`Ren低声说，“…”`。为 `终于` 限定为说话人名后的动作修饰语，不据此单独推断角色。两条真实历史例子已进入针对性回放；匿名“冷声说道”反例仍保持未知。加入这两类线索后全历史为 4,120/6,074 个 dialogue candidates attributed，1,741 unresolved（覆盖数，不代表准确率）。

### 2026-10-08 v46 two-sentence quote cap and latest user labels

- User calibration: samples 1 and 7 are old/stale messages and are excluded from gold and rule inference. For samples 2 and 5, look upstream within the bounded same-message/source context for a person name; if no unique name is supported, use narrator fallback. Sample 3 is `Priya`, sample 4 is narrator, and sample 6 is `Kael`.
- Title evidence from a quoted span is capped at the second sentence stop even if the source later contains a matching closer. The suffix is rescanned independently. This changes display-title evidence only; source text, production page array, pagination, and page source spans are unchanged. If a nested quote opened before the cap closes afterward, its old closer is masked during suffix rescanning so it cannot poison later independent speaker evidence.
- Fixed two evidence-boundary defects found by independent review: crossing nested quote closers no longer make later anchors ambiguous, and repeated identical scene text now derives its actor span from the latest scene suffix rather than the first matching text occurrence. Regressions assert the exact final actor span and verify a later independent `Pippa` anchor survives a capped nested quote.
- v46 full-history replay (read-only): 158 chats, 950 assistant messages, 18,562 existing production pages; 5,679 dialogue-candidate pages: 3,718 attributed, 141 anonymous first appearances, 84 probable display titles, and 1,736 unresolved. There are 2,011 unique unresolved dialogue spans / 2,033 page links, including 22 multi-page spans. Structural evidence validates 17,798/17,798; 0 pages unaddressable. Source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`.
- Compared with v45, the dialogue-candidate denominator is lower by 395 pages because later portions beyond the two-sentence evidence cap no longer inherit the earlier quote span. Therefore the v45/v46 attributed and unresolved counts are not a like-for-like accuracy comparison. This is coverage-only; all 158 chat scopes are unavailable and no complete page-level gold set exists, so `speakerAccuracy=INSUFFICIENT_EVIDENCE`.
- Validation after the independent-review fixes: adapter tests pass 1/1; structural replay tests pass 37/37; `git diff --check` passes. Targeted evidence verifies that the long Joe quote's third-sentence page is narrator, that the nested-quote suffix preserves a later independent speaker, and that repeated scene text binds to the actor occurrence in the latest scene. Original SillyTavern-owned paths remain frozen.

### 2026-10-08 v47 破折号署名说话 cue 回归

v47 为 `—姓名 + 明确说话谓词 + 句末。 + 紧邻引语` 增加局部归属；用户校准的四条 Andrei 与一条 God 均在定向 parser/replay fixtures 中命中。普通 dash 动作句、无 dash 的 cue、物件动作引语保持未归属。验证：shared adapter 测试 1/1 通过；speaker replay 测试 38/38 通过；合成回放 `chatWriteback=false`、`externalProviderCalls=0`、`sourceUnchanged=true`。这是规则回归覆盖，不代表全量历史准确率提升；没有改分页、正文、source spans、聊天或原版代码。

### 2026-10-08 v47 全量只读回放

在同一历史源集合 digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20` 上运行最终 v47：158 个聊天、950 条 assistant 消息、18,562 个生产页、5,679 个对白候选页；其中 4,109 页显示已归属 speaker/group，118 页为匿名首次出现，84 页为 probable，1,368 页 unresolved。共有 1,620 个唯一 unresolved 对白跨度 / 1,642 个页链接；结构 evidence 17,798/17,798 有效，0 个不可寻址页。相较上一份同 digest v46 报告，显示分桶变化为 +391 已归属、-23 匿名首次出现、-368 unresolved 候选页；这是覆盖分布变化，不代表准确率，也不构成新增人工 gold。所有 158 个聊天 scope 仍不可用，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。本次 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

### 2026-10-08 v48 破折号姓名优先回归与全量只读回放

用户确认破折号后紧接姓名时，紧邻的后续引语归该姓名；动作描述、话语内容中的其他角色或语义推测不能推翻这一署名。v48 因此取消 v47 的显式说话谓词门槛，并将此前 `—Pippa翻开账本。 “这里有线索。”` 负例更新为正例。测试同时验证无破折号、姓名句与引语之间插入另一完整句时不归属。

在同一源集合 digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20` 上运行 v48：158 个聊天、950 条 assistant 消息、18,562 个生产页、5,679 个对白候选页；4,237 页 attributed dialogue、105 页 anonymous introduction、84 页 probable display title、1,253 页 unresolved candidates。唯一 unresolved span 1,492 个、页链接 1,514 个；结构证据 17,798/17,798 有效，0 个不可寻址页。相较同 digest v47，归属页 +128，anonymous -13，unresolved -115。这仅为分类覆盖变化，不能作为准确率提升结论。所有 158 个聊天 scope 仍不可用，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。

### 2026-10-08 v49 用户标签与引号边界修正

本批 8 个用户标签落为回归：#1、#4 为玩家“你”；#2 为霜石的“它”动作续接；#3“成功！”为旁白；#5 玩家礼貌收束语“合作愉快”；#6 群体传闻/欢呼归“人群”；#7“咔”为旁白拟声；#8“毒牙咬牙”归毒牙。

回看原文发现比单个标签更关键的问题：扫描器在引号内遇到第二个句末符号时会提前强制结束，即便之后存在真实闭合引号。它把完整的多句对白切成未闭合片段，造成玩家对白未归属、续句错分。v49 改为配对闭合符优先；“两句后截断”只适用于未找到闭合符的异常引号。该行为与用户此前的边界要求一致。

定向回归覆盖玩家第一人称动作、自述、唯一显式 speaker 的“它”回指、攻击结果记录旁白、明确上下文的群众引语、单字“咔”、动作谓词“咬牙”和握手式社交收束。仅当消息段里至少有多条引语、传闻/消息 cue 及本段或紧邻短段的人群欢呼 cue 时才投影群体标题；归属证据不跨入下一位具名说话者的台词，单一短语不作人群猜测。

验证：shared adapter 测试 1/1、speaker replay 测试 39/39 通过；回放只读，不触发上游 API，不写聊天，也不修改分页或原版 SillyTavern。

同源集合全量只读 v49 回放：158 个聊天、950 条 assistant 消息、18,562 个既有生产页、6,254 个对白候选页；4,868 页有归属标题，另含 98 页匿名首次出现、73 页 probable display title、1,215 页 unresolved。聚合 `unattributed-dialogue` page kind 为 1,386 页（包含上述匿名/推测/未决子类）。唯一未决对白跨度 1,407 个、页链接 1,468 个，其中 54 个跨多页；结构 evidence 17,816/17,816 有效，0 个不可寻址页。source digest 仍为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。相较 v48，候选页增加 575、归属标题增加 631、未决子类增加 133；配对引语跨度恢复完整后，候选分母变化，因此这些是覆盖分布，不是准确率比较。所有历史 roster scope 不可用，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。

八个本批人工标签在历史页级回放中全部命中：848/2 `你`、834/13 `霜石`、826/21 `旁白`、822/3 `你`、810/17 `你`、810/2 `人群`、802/31 `旁白`、802/26 `毒牙`。历史“第二句一律截断”的 v46 说明仅保留为历史记录，现行边界按 v49：配对闭合符优先，未配对才在第二个句末兜底。

### 2026-10-08 v50 新增人工校准与回放

新增 8 条金标，针对全员跪地、玩家行动引语、接待员与格雷森的动作引语、新闻式多条转述、Pippa/Durik 协同行动后的无唯一说话 cue 引语、引语后置“艾瑞克介绍”、以及标题后的“行动！”命令页。新增规则仍只生成 display-title evidence：全员/人群等本身已表示群体的标签不再附加重复的“（群体）”；并列主体共同动作后没有唯一说话 cue 时采用用户允许的旁白兜底；后置署名限于紧邻短句；新闻转述依据完整消息识别框架，再映射回被既有生产分页覆盖的引语 span。

定向历史页回放：8/8 用户可接受标签匹配，分别为 768/8 `全员`、772/2 `你`、776/6 `接待员`、776/18 `格雷森`、776/24 `旁白`、778/2 `旁白`（多人共同执行管理任务，原文没有唯一发言 cue；按用户允许的保守兜底）、778/7 `艾瑞克`、800/1 `旁白`。版本 `full-message-speaker-index.v50`；目标聊天 source unchanged，`chatWriteback=false`、`externalProviderCalls=0`。回放验证来源消息正文不变；这些行是对既有页面 span 的分类检查，不构成全历史准确率。

同源集合全历史只读 v50 回放：158 个聊天、950 条 assistant 消息、18,562 个既有生产页、6,253 个对白候选页；4,873 页归属对白/群体标题，1,380 页未归属候选，1,401 个唯一未决对白跨度、1,462 个页链接；结构 evidence 17,815/17,815 有效，0 个不可寻址页。与 v49 的覆盖分布相比，候选页 -1、归属页 +5、未决候选 -6、唯一未决跨度 -6；这些变化仅表示结构覆盖迁移，不等于准确率提升。`sourceUnchanged=true`，`chatWriteback=false`，`externalProviderCalls=0`；verified source digest 与 v49 相同：`sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`。全历史角色 roster scope 不可用，准确率仍为 `INSUFFICIENT_EVIDENCE`。

v50 当前 8 条用户金标定向回放的预期可见标题为：`全员`、`你`、`接待员`、`格雷森`、`旁白`、`旁白`、`艾瑞克`、`旁白`。其中第 6 条“Pippa 和 Durik 共同留守/管理后接第一人称引语”缺乏能唯一指向 Pippa 的原文署名或说话 cue；用户允许难辨时旁白兜底，因此不猜 Pippa，显示“旁白”。回归断言检查的是 `titleText` 可见结果，而不只检查内部 speaker 列表；“全员”不得显示成“全员（群体）”。本次修复只改变说话人标题投影，原消息与既有生产分页保持不变。

### 2026-10-08 v51 孤立行尾引号修复与全历史只读回放

全历史回放发现一个肉眼可判为旁白、但仍显示“未识别”的残留：`galgame_imported_dungeon_master\galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl`，message 496 / page 40，code-point span `[2318, 2377)`，正文为“六个战力，十五个护卫加一个前圣骑士，三个战术方案，明晚十点行动。光明会全队首次集结任务，虐待狂贵族巴尔萨泽的末日将至。” 根因是 message 内一条未引用的 bullet 总结行末有孤立 ASCII `"`（position 1521）；scanner 在没有活动 opener 时把它误作开引号，令后续有效对白的引号配对错位，并最终把后续真实闭合标记误记为未闭合。v51 仅在“当前无活动 opener 且 ASCII `"` 是行内最后一个非空白字符”时忽略该孤立标记；有效的说话 cue 后引号 opener 不变。未闭合引语仍保留“未识别”，不转为旁白。

回归覆盖该结构简化样例及明确正反例；未闭合引语测试继续显示“未识别”。目标历史页修复后使用普通未标记正文规则显示“旁白”，不创建 speaker/identity/avatar。分页 segmenter 与现有 source span 未变。

同源集合 v51 全历史只读回放：158 chats、950 assistant messages、18,562 production pages、6,379 dialogue-candidate pages；4,908 `confirmedAttributed`、105 `anonymousIntroduction`、0 `probableDisplayTitle`、1,366 `narratorFallback`、0 `unresolvedCandidates`。fallback reason counts：1,353 `no-unique-speaker-evidence`、130 `narrative-shape-with-unattributed-quote`、4 `ambiguous-local-reference`、7 `dialogue-shape-without-speaker`。有效 structural evidence 17,816/17,816，0 unaddressable pages；扫描后的 visible `未识别` 页面为 0。源集合 digest 与 v50 相同：`sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。全量 roster/gold 不完整，`speakerAccuracy=INSUFFICIENT_EVIDENCE`；这些数仅为覆盖分布，不是准确率。

v50 到 v51 的 dialogue-candidate 分母从 6,253 变为 6,379（+126），production page 总数与 digest 未变。该变化来自孤立引号修复后，结构 quote overlap 能正确识别更多既有页为对白候选；它是候选覆盖迁移，不是新增分页或准确率提升。与修复前临时 v51 replay 相比，确认归属 +36、匿名首次出现 +8、旁白 fallback +82；fallback 仍单独统计，不能并入 speaker 准确率。

v50 的 8 条历史可见标题在 v51 重新回放 8/8 命中（768/8、772/2、776/6、776/18、776/24、778/2、778/7、800/1）。另有测试确认真实仍未闭合且无唯一说话人的引语继续为“未识别”。结构 parser/cache 为 `full-message-speaker-index.v51`；只同步 player entry 和两份共享 adapter 构建输出，`public/game/index.html` 只更新对应 `app.js?v=...` cache-buster。没有修改聊天、正文、分页或 SillyTavern 源码。

## 2026-10-08 v52 bounded same-message attribution replay

v52 searches direct pre-/post-quote cues and named actor/action anchors across the full original assistant message, then projects only source-verified evidence to the unchanged existing production page spans. Carry-forward requires the same still-open paired quotation, a unique nearest same-scene anchor, and no stronger or conflicting speaker cue. Closed turns do not inherit merely by adjacency; references never cross source messages or chats. Explicit unquoted player speech may display `你`; first person inside an NPC quote is excluded. Written-carrier text remains narrator; a group title such as `人群` requires a reliable same-message collective source plus a contiguous anonymous quote run. An explicit rumor/spread phrase without reliable crowd evidence remains narrator fallback. This affects title evidence only; it does not create chat/roster state or change source text, production segmentation, page order/count/spans, or SillyTavern source.

The exact ten current user-calibrated cases score 10/10 visible-title matches in the focused gold test. A separate regression covers `“你刚才敲的位置……” Ren低声说，“不是窗。”`: the immediately following named speech cue attributes the first utterance to Ren even without a published roster; the second quote is independently attributed. A pronoun-plus-manner phrase such as `她平静地说` cannot be parsed as a character name.

Final full-history read-only replay: parser `full-message-speaker-index.v52`; 158 chat files, 950 assistant messages, 18,562 existing production pages, 6,402 dialogue candidates. Buckets: 4,971 confirmed structural attribution, 103 anonymous first appearances (`？？？`), 0 probable display titles, 1,328 closed-speech narrator display fallbacks, 0 unresolved display rows. Compared with the recorded v51 summary (6,379 candidates: 4,908 attributed, 105 anonymous, 1,366 fallback), v52 is +23 candidate pages, +63 attributed, −2 anonymous, and −38 fallback. This is a net category-coverage change; no saved per-page v51→v52 transition artifact exists to allocate the +23 by rule. The replay counted 206 utterances containing the newly supported direct-cue set, which is a separate measure and must not be equated with the +23.

Candidate-only narrator fallback reasons (fixed schema including zero-valued buckets) sum exactly to 1,328: `no-unique-speaker-evidence` 1,317; `narrative-shape-with-unattributed-quote` 2; `ambiguous-local-reference` 4; `dialogue-shape-without-speaker` 5; `conflicting-speaker-evidence`, `ambiguous-quote-structure`, and `open-quote-without-unique-speaker` 0. All-page narrator diagnostics are separate and total 1,447, including 119 non-candidate narrative pages. Remaining candidate shapes include closed quotes without a unique message-local anchor, ambiguous local references, narrative/report frames and dialogue-shaped text without a direct cue; narrator display fallback is not proof of semantic narration or whole-corpus correctness.

Evidence spans validated 17,818/17,818; zero unaddressable pages; source-set digest is unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. Published speaker scopes are unavailable for all 158 chats and no complete page-level human holdout exists, so `speakerAccuracy=INSUFFICIENT_EVIDENCE`. The ten-case exact gold is focused calibration, not a full-history accuracy claim.

## 2026-10-08 v53 exact-history corrections and read-only replay

Six real user-confirmed historical page titles were bound to the original chat path, source-message hash, production page index and exact code-point span. The production replay title matched all six: `msg592/p6` 格雷戈, `msg328/p5` 暗影祭司, `msg70/p4` 维斯坎特, Evelyn `msg36/p16` 你, `msg472/p5` 加里克爵士, and `msg476/p18` 马库斯. The source-backed test is `frontend/player/tests/speaker-structure-replay.test.mjs`; it checks the real page projection rather than a helper-only result. The written-carrier and transfer negatives remain in the shared adapter regression. Display alias evidence preserves the raw source surface separately as `speaker.sourceText`; exact player/honorific mappings are validated by the main adapter and renderer.

Final full-history read-only v53 replay: 158 chat files, 950 assistant messages, 18,562 existing production pages, and 6,404 dialogue candidates. Buckets: 4,985 confirmed structural attribution, 103 anonymous first appearances (`？？？`), 0 probable display titles, 1,316 closed-speech narrator display fallbacks, 0 unresolved display rows. Candidate-only fallback reasons total exactly 1,316: `no-unique-speaker-evidence` 1,308; `narrative-shape-with-unattributed-quote` 2; `ambiguous-local-reference` 2; `dialogue-shape-without-speaker` 4; `conflicting-speaker-evidence`, `ambiguous-quote-structure`, and `open-quote-without-unique-speaker` 0. All-page narrator diagnostics are separate and total 1,435, including 119 non-candidate narrative pages.

Against the recorded v52 summary (6,402 candidates: 4,971 attributed, 103 anonymous, 1,328 fallback), v53 has +2 candidates, +14 attributed, unchanged anonymous, and −12 fallback. No per-page v52→v53 transition artifact was produced, so the net two-page candidate increase cannot be assigned to a single rule. This is a coverage distribution change, not an accuracy claim. The six gold rows provide only a six-row labeled sample; overall `speakerAccuracy=INSUFFICIENT_EVIDENCE` because full-history speaker scopes and a representative page-level gold set are unavailable.

Structural evidence was valid for 17,818/17,818 evidence pages; there were 0 unaddressable pages. The verified source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. Existing production page count/order/spans and frozen segmenter source were unchanged. The candidate replay validator compares speaker spans to raw `sourceText` when a display alias exists, and to `speaker.text` otherwise.

### v53 A2 bounded-scope closure (2026-10-08; supersedes the provisional v53 counts above)

After fixing the observed-name scope and transfer-frame boundary, the final parser remains `full-message-speaker-index.v53`. The lexicon now uses at most the preceding eight caller-supplied positions and clears at a recognized opening scene/title. Empty/player positions consume a slot in the live snapshot but add no names. This is a lexical candidate set only: it never carries speaker ownership or pronouns, and every target still needs a local structural cue. For `马库斯把报告递给你，说：“…”`, the exact displayed subject is `马库斯` with source span `[0,3)`; the truncated `马库斯把` is rejected. Written document frames and transfer actions without a direct speech cue remain narrator fallback.

Final read-only replay: 158 chat files, 950 assistant messages, 18,562 existing production pages, and 6,242 dialogue-candidate pages; buckets are 4,500 attributed, 118 anonymous first appearances, 1,624 narrator display fallbacks, 0 probable titles, 0 unresolved display rows. Candidate-only fallback reasons sum exactly to 1,624: `no-unique-speaker-evidence` 1,610; `narrative-shape-with-unattributed-quote` 2; `ambiguous-local-reference` 2; `dialogue-shape-without-speaker` 10; the other fixed buckets are zero. Unresolved quote diagnostics total 1,659 unique spans / 1,834 page links / 151 multi-page spans. Structural evidence validates 17,806/17,806 pages; 0 are unaddressable. Source-set digest is unchanged at `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`.

Compared with frozen v52, candidates changed by −160, attributed pages by −471, anonymous introductions by +15, and narrator fallbacks by +296. This conservative migration follows the narrowed name scope; no per-page transition artifact exists and these counts are not an accuracy measure. The largest remaining bucket (1,610) needs read-only stratified example review, starting with quote, line-colon, dash-led, and multi-quote shapes, each pinned to source chat/message hash/page/span. Only recurring evidence patterns confirmed by the user should become bounded parser rules, each paired with a source/document/scene-conflict negative. Whole-corpus accuracy remains `INSUFFICIENT_EVIDENCE`.

Post-correction checks exited 0: runtime regressions 57/57, presentation renderer 1/1, shared adapter 1/1, speaker replay 46/46, six real historical golds 6/6, DOM smoke, full architecture audit, isolated static build/cache SHA coherence, frozen segmenter SHA check, and `git diff --check`. Build version is `auto-fbaeb8e6e97c`; only player app, renderer, player/admin shared adapters (admin copy required by the shared-build invariant), and player app cache-buster were synchronized. CSS cache key is unchanged. Exact hashes and limitations are in the TaskSpec. The independent A2 review is pending.

## 2026-10-08 v54 same-message source-structure closure

v54 adds only general structural evidence demonstrated by six real, hash/span-pinned source pages: a named subject's possessive voice plus speech act; named subject + local action + immediately introduced quote; particle-safe actor spans; continuation over the existing pages of the same still-open source quote; and a nearest unique same-scene pronoun speech cue. The historical subjects are Pippa (voice and ledger-check actions), 尼布 (`则` remains outside the name span), 胖商人 (kneeling action), Lila (open quote across pages) and Priya (nearby Latin action anchor followed by `她平静地说`). All six production display pages matched their exact expected titles and spans (6/6). The immediately following written ledger text, map transfer without a speech predicate, passive mention, competing/new speaker, scene-boundary, completed-quote and NPC-internal first-person negatives remain non-speaker/narrator as applicable.

The first complete v54 suite exposed one false positive: `只用尖细的声音说` was treated as a Han speaker name. The voice construction now accepts a Han subject only when that exact name is present in the bounded chat-local name set; Latin proper names remain recognizable on first appearance. The focused negative and exact historical gold pass after this restriction. This is conservative; it intentionally leaves ambiguous unrostered Han voice descriptions unresolved/fallback rather than guessing.

Final v54 full-history replay: 158 chat files, 950 assistant messages, 18,562 existing production pages and 6,242 dialogue candidates; 4,519 attributed, 118 anonymous first appearances, 0 probable display titles, 1,605 narrator display fallbacks and 0 unresolved display rows. Candidate-only fallback reasons sum exactly to 1,605: `no-unique-speaker-evidence` 1,591; `narrative-shape-with-unattributed-quote` 2; `ambiguous-local-reference` 2; `dialogue-shape-without-speaker` 10; all other fixed buckets 0. Relative to v53, 19 candidate pages move from narrator fallback to attributed; this is a coverage shift, not an accuracy improvement. Overall `speakerAccuracy=INSUFFICIENT_EVIDENCE` remains.


v54 checks: runtime regressions 57/57, renderer 1/1, shared adapter 1/1, speaker replay 47/47; full replay exit 0. Player and admin staging builds exited 0. Only `public/game/app.js`, `public/game/index.html` app cache-buster, and both `shared/sillytavern-adapter.js` static outputs were synchronized. Build version `auto-8e544ea11df0`; player `app.js` SHA-256 `60a9143950754752d06dc00ec030739b097cb9be544e617abfa5f0ad0411cad9`, index SHA-256 `513fe87af4406d20344d3df817130e64af3f7c7d0229b08562358856317c81a5`, and both adapter copies SHA-256 `72ee3167ae974063858647cbf492ecd3b1a918f89b0de17094b168851be25d2f`. Player app import queries and index app cache-buster agree; stylesheet cache key remains `auto-8fd622b9f5f5`. Architecture audit exited 0 (707 files, 1,515 findings, 0 prohibited active, 0 needs-review, 0 failed checks); static DOM smoke exited 0 (`ok=true`); cache-coherence check exited 0; frozen segmenter raw source slice offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`, equal to v53; `git diff --check` exited 0 (Git printed non-fatal LF/CRLF notices). Source digest stayed `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; evidence 17,806/17,806 valid, 0 unaddressable, `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`. The source body, existing page builder/segmenter, chat data and SillyTavern-owned code remain outside scope. Independent A3 review is pending; this is frozen for review, not yet accepted.

## 2026-10-08 v55 same-message title evidence

v55 extends the production display-title parser only for the hash-pinned source cases in `docs/GALGAME_SPEAKER_ATTRIBUTION_V55_TASKSPEC_2026-10-08.md`: Pippa's action-introduced open quote across pages 8–9, and two Seraphina messages where a unique same-message named action precedes an anonymous self-introduction and a later pronoun-led speech turn. The self-introduction pages remain `？？？`. Paired negative cases cover a whistle without language-bearing dialogue, a new scene/title, a competing explicit speaker, and written report text. These are source-bound production-page tests; no page/helper-only substitute is counted.

The rule only changes display-title evidence. Semantic classification remains unchanged, unresolved identity stays unresolved, and the fallback does not make a narration claim. No original chat/source body, production segmenter/page spans/order/count, persistent identity, roster, avatar binding, SillyTavern-owned source, or provider state is changed. Final v55 full-history replay: 158 chats, 950 assistant messages, 18,562 existing production pages and 6,240 dialogue-candidate pages; 4,524 attributed, 118 anonymous first appearances, 1,598 narrator display fallbacks, 0 probable titles and 0 unresolved display rows. The fixed candidate-only fallback buckets sum to exactly 1,598: `no-unique-speaker-evidence` 1,584, `narrative-shape-with-unattributed-quote` 2, `ambiguous-local-reference` 2, `dialogue-shape-without-speaker` 10, and all remaining buckets 0. All-page narrator diagnostics sum to 1,736, including 138 non-candidate narrator rows. Structural evidence validates 17,806/17,806 pages; 0 are unaddressable. Source-set digest remains `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`; `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`; overall `speakerAccuracy=INSUFFICIENT_EVIDENCE`. Candidate/fallback movement is coverage accounting, not a correctness estimate.
v55 category movement against the recorded v54 baseline is candidate pages −2, attributed +5, anonymous 0, narrator display fallback −7. No v54→v55 per-page transition artifact exists, so the movement cannot be assigned page-by-page or treated as accuracy improvement. Focused real source-bound gold passes 4/4, preserves anonymous introductions 2/2, and passes bounded negatives; this sample does not establish corpus accuracy.

v55 checks exited 0: runtime regressions 57/57; presentation renderer 1/1; shared adapter 1/1; speaker replay 49/49; full-history replay; both staged static builds; architecture audit (707 files, 1,515 findings, zero prohibited active/needs-review/failed checks); DOM smoke (`ok=true`); cache/runtime coherence; and `git diff --check`. Build/cache version `auto-c90f3fcf76b9`. Synchronized paths: `public/game/app.js` SHA-256 `928b11db6405cd9603f18c24841e9634a13c7159a87f3fb81a6b058c6c67935f`; `public/game/index.html` only app cache query SHA-256 `03d1335121404bce4b8c5ae8c6dac930218207617a4ab63759a3abb82fccf560`; and both player/admin `shared/sillytavern-adapter.js` SHA-256 `6cf0385d8b525e9235b28d353888cbc6cc04b5ccd15b4431eb63209989431e22`. All generated files byte-match their isolated staging outputs. App import queries match the index app query; stylesheet query is unchanged at `auto-8fd622b9f5f5`. Frozen segmenter slice remains offsets `[49566,52931)`, 3,447 UTF-8 bytes, SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`. The chat/source bodies, SillyTavern-owned files, and pagination implementation remain untouched. Independent A4 review is pending; v55 is frozen for review, not accepted yet.
## 2026-10-08 v58 人工标注结构归并任务

本轮将 v37–v57 人工标注按署名、唯一主体动作、同消息代词回指、同 source quote span 续页、匿名首次发声、旁白/标题/carrier 边界归并。规则提炼不按人物或剧情堆专名；通用 cue 词汇只有与主体、引语和局部唯一性一起成立才可产生 speaker title。以最近十条 v57 narrator-fallback 页面做结构探针时，推断输出与人工金标严格分列；它们不能证明总体准确率。通过条件、硬边界和回放基线见 `GALGAME_SPEAKER_ATTRIBUTION_V58_TASKSPEC_2026-10-08.md`。

## 2026-10-08 v59 两页内代词说话人续接

v59 只为同一原版 assistant 消息中的极窄结构补 title evidence：当前页必须是代词主体动作/状态框架后接闭合引语；同消息前两张原有 display page source spans 中，最近显式 speaker anchor 必须唯一。绝不从前页 title 字符串续接。真实正例固定 Dungeon_Master `msg572`，目标 page 14 `[692,725)`，source hash `sha256:b68fc04ee1421d93f5bb7854610361ba148a99d243d92f5b5a52355e20786c8f`，前两页 spans `[578,629)`、`[631,690)`，标题为“冰霜巨人”。完整 replay 的 parser version 为 `full-message-speaker-index.v59`。

完整只读回放为 158 chats、950 messages、18,562 原有页、6,116 dialogue candidates：4,090 attributed、201 anonymous first appearances、1,825 narrator fallback、0 unresolved。v59 规则 44 页；相较 v58 报告的 1,834 fallbacks 净少 9 页，不能视作准确率提升。真实负例暴露“她把账本递来，上面歪歪扭扭写着……”会错误继承 Pippa；加入书面载体阻断后，原 v54 source-bound regression 恢复通过。Source digest 不变（`sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`），18,562 页未变，结构证据 17,804/17,804 有效，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。已将 player 与 replay parser/cache version 提升至 v59。准确率仍是 `INSUFFICIENT_EVIDENCE`。

验收记录：speaker replay 57/57、shared adapter 1/1、runtime regressions 57/57；静态架构审计通过（707 files、0 prohibited active、0 needs-review、0 failed checks），DOM smoke `ok=true`。player/admin staging 与 public 文件逐项 SHA-256 比对无差异（33/33、22/22）。发布 cache key 为 `auto-1a06e527cabc`。分页器冻结函数 SHA-256 `09fb722d2bf6d38d3295edb04674424fdd40b6cc0ff763a9d59e26b652d28ecb`，source/player/admin 三处一致。原版 SillyTavern 冻结路径无本轮改动；`git diff --check` 通过（仅有既存 LF/CRLF 提醒）。独立只读 A1 审计 PASS。以上只验收窄规则和边界，不代表总体分类准确率。

## 2026-10-08 v60 逐引语前后文与前两页动作主体

本轮规则采用结构证据排序：显式署名/发声 cue 优先；再用引号前完整句中的唯一主动动作主体；之后检查已有前一、最多前两页的显式说话锚或唯一动作主体。提及名词只作为候选，不能仅凭名字或距离直接定说话人。quote 索引为每个完整/未闭合引语保留 span、相邻上下文、父子引语关系和决定证据；引语的关闭状态不会成为提前停止分析的条件。前页动作路径增加被动、状态/领属和书面载体阻断，避免将 `尼布感到`、`尼布的` 等截断片段当作姓名。

v60 全量只读回放：158 chats、950 assistant messages、18,562 production pages、6,116 dialogue candidates；4,110 attributed、204 anonymous first appearances、1,802 narrator fallback、0 unresolved。对照 v59，+20 attributed、+3 anonymous、−23 fallback；前页动作主体规则命中 19 页。候选 fallback 中 1,782/1,802 是 `no-unique-speaker-evidence`；unknown-shape 计数为 dash-led 571、line-colon 454、quote-only 244、multi-quote 199。结果是覆盖迁移统计，不是准确率。所有归档 chat 的 published speaker scope 不可用，故 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。

人工确认/负例和真实 Mika 来源页均通过；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`，source-set digest 仍为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`。Shared adapter 1/1、speaker replay 58/58、runtime regressions 57/57，构建、DOM smoke、架构审计及 `git diff --check` 通过。

独立 A1 复核关闭了被动/状态/领属/账本载体误归属，但整体验收仍被分页冻结差异阻断：当前工作树 `createVisualNovelDisplaySegments` hash `a8875278…eae3d` 与 v59 记录的 `09fb722d…52d28ecb` 不同，连接词段落合并逻辑涉及正文分页。恢复记录旧逻辑会破坏现存的“原始空行保持分段”回归；该分页变化尚需单独确认来源与处理方式。说话人归属正确性仍是 `INSUFFICIENT_EVIDENCE`，不能由 23 页 fallback 减少推出。
