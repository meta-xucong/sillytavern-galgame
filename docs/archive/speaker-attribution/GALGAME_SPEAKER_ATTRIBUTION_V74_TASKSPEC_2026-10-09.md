# Galgame 说话人归属 v74 TaskSpec

## 目标

在不接入新模型、不改分页、不改变身份/头像或原版聊天的前提下，修复当前结构解析中两个可复现的缺陷：

1. 角色已在当前发布名单中，且是引语前局部冒号子句的唯一句法主语时，解析器仍要求一组动作词命中，造成 `Celestia翻了个白眼，将法杖推开：“……”` 一类自然表达漏归属。
2. 回放器只给 `unresolvedCandidates` 记录生成引语性质诊断；已落入旁白兜底的 `no-unique-speaker-evidence` 记录没有性质数据，使 1,663 条主要兜底无法分型。
3. 有名册时，generic Han 解析会把末尾动作短语误切成说话人（如“尼布……指着头顶尖叫”）；多子句前缀也可能错误沿用前一个角色，或把“尼布随后”吞成一个名字。

## 约束与非目标

- 仅影响 display-title evidence 和离线只读回放诊断；不改 `createVisualNovelDisplaySegments`、正文格式、现有 page count/order/text/sourceSpan、semantic annotation、角色身份、roster、头像/背景绑定、剧情状态、保存数据或聊天 JSONL。
- 不改 SillyTavern 原版代码/配置/扩展；不添加剧情生成协议、LLM 请求、provider 调用或新依赖。
- 不使用无关邻句姓名、引号内提及、固定角色/剧情词表来猜测 speaker。
- roster 外新人物不由此规则猜名；只有既有明确 cue/匿名首次出场规则可处理。证据不唯一、信息载体、记录/标题、并列主体继续 abstain。
- 当前全历史回放缺少逐页 gold 及完整 per-chat roster。覆盖分桶变化不等同准确率提升；验收结论须如实标为 `INSUFFICIENT_EVIDENCE`。

## 实施

- 对同消息 source quote 的冒号前缀，优先使用精确 published/chat-local roster name 的句首主体；要求有正文谓词尾部、无句界/嵌套引用、无信息载体/心理转述框架、无并列角色主体，且 source span/hash 仍由原页投影器验证。只放宽对谓词内容的依赖，不引入任意附近姓名兜底。
- 升级 structural message-index/parser memo namespace 至 v74。
- 让历史 replay 对 narrator fallback 同样计算已有的 quote ledger、span intersection、closed/open、cue、local shape、anchor 和 page type 诊断；原有互斥结果分类及“旁白”显示兜底不变。
- 独立审计后补充 v74 rostered cue arbitration：先按精确名册边界处理逗号分隔的动作/发声子句，再落入宽松 CJK 解析；末子句的显式发声人优先，后续守卫等通用群体/职业主体阻断先前人物继承。无名册仍保持现有保守/旧路径，不虚构新名字。
- 在回放样例中增加命中/阻断和旁白/记录/并列主体负例。

## 允许文件

- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `frontend/player/src/main.js`（parser/cache namespace literal only）
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`
- 本 TaskSpec、三份产品基线及 `docs/GALGAME_SPEAKER_ATTRIBUTION_HISTORICAL_REPLAY_PLAN_2026-10-05.md`
- 如需同步运行静态产物，仅更新构建产物中与已审核源依赖图直接对应的 player 输出；不得覆盖其他脏产物。

## 验收

- 新结构正例含中文/Latin roster 主体和多个不同动作短语；页面 source spans 与 v73 完全一致。
- 负例覆盖报道/信件/记录、并列人物、旁白标题、角色只在宾语/引号中被提及、没有本地冒号关联的邻句姓名。
- shared adapter 与 speaker replay (63/63)、runtime regressions (58/58) 通过。v73/v74 同快照回放：158 chats、955 assistant messages、18,696 pages；v73=4,150 attributed / 1,686 narrator fallback / 2,009 unattributed dialogue candidates，v74=4,156 / 1,679 / 2,002。7 个旁白兜底及 7 个 unattributed candidate 转成结构归属；覆盖迁移不能代替准确率。
- 当前 v74 fallback nature diagnostics 中 no-unique narrator fallback 为 1,656；其中 quote span intersection 1,644，前两页 speaker seed 49，匹配 quote seed 24，全部无重叠 anchor。158 chats 均无 per-chat roster，gold 不足，准确率 `INSUFFICIENT_EVIDENCE`；source digest `sha256:d6a160a55aba6d884d1c44954371b25a6f2cb17feb08c2466357e4dd64a831b2`，`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。
- core final acceptance 仍有头像占位图断言失败（实际 narrator placeholder，预期 unknown speaker placeholder）；它不在本次代码路径，本轮未更改。
- 独立只读 A1 最终审计 `PASS`：四项边界 probe 均通过（两种尼布动作句归尼布；守卫发声阻止继承 Celestia；后续 rostered 尼布 cue 优先且不吞“随后”）；v73 控制保持旧分支，v54 历史金标及正文页 span 检查通过；SillyTavern frozen paths 无差异。审计不能消除 core final acceptance 的独立占位图失败。
- 未改动分页器函数或正文 source spans；适配器回放断言及 18,696 页计数通过。任务开始前 segmenter 已有脏改动，缺少干净起点 hash，故不宣称相对 HEAD 的完整分页冻结证据。
- 构建输出只生成在隔离 staging 路径；由于 `public/game/**` 已有脏差异，未覆盖正式静态产物。当前浏览器尚无 v74 已加载证据。
- `git diff --check` 无错误（Git 仅报告现有 CRLF 转换提示）。独立只读 A1 对最后一版通过后才能称 v74 代码审计闭环；历史结果不能据无 gold 数据宣称识别准确率已达标。
