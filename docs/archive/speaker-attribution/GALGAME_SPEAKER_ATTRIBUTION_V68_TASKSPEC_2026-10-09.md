# Galgame 说话人归属 v68：同句主体动作与引语闭合

状态：实现、完整只读历史回放与独立 A1 审计已完成。结构规则与来源边界验收通过；整体准确率仍为 `INSUFFICIENT_EVIDENCE`，不能由覆盖率变化推断。

## 根因

v67 已有完整消息引语索引，但 actor/action 解析只接受部分紧邻动作词，且姓名扩展会把语法边界吃进姓名。历史文本中常见的“人物把物品递/丢给玩家后接冒号引语”“人物动作/工具使用后接引语”“人物的眼神/表情状态后接引语”因此落入旁白兜底。另一方面，若把这些词条全局加入 prior-page action 词表，又会把独立前页的服饰或情绪描述误当成说话锚点。

## v68 规则

1. 保留现有显式发声 cue 优先级。仅当当前同一 source message 中，引语前冒号框架有唯一主体与动作/工具/物品传递关系时，才将标题投影到该主体。
2. 在同句框架内识别若干通用谓词形态：`把/将 + 物品 + 传递/抓取动作`、`用/以/借助 + 工具 + 鉴定/检查动作`、以及角色穿着/外观从句后紧接人物表情/身体状态的复合描写。身体/表情所有格结构（如“霜咬的眼神变得严肃”）只作为当前冒号引语的直接上下文证据。
3. 同句多主体被连接词连接且没有唯一发声主体时 abstain；书信、日志、报告等书面载体继续归旁白；无动作线索的外貌描述、前页孤立情绪状态不建立说话人。
4. 姓名边界不能吞并“把/将/在/对/向/用”等语法成分或“眼神/脸色”等身体状态名词。任何 span/source 校验失败继续 abstain。

## 边界与不变量

- 只改变 display-title structural evidence；不改 SillyTavern 原版、聊天正文、roster、身份、头像、状态或模型提示。
- production segmenter/page builder 是 sourceSpan、页序、页数与正文边界的唯一来源；本任务不编辑这些函数。
- 不调用 LLM/provider；历史回放只读，不写回聊天。
- 生产 parser/cache 与 replay namespace 递增为 `full-message-speaker-index.v68`。
- 仅允许修改：`frontend/shared/src/sillytavern-adapter.js`、对应 adapter/replay 测试、`frontend/player/src/main.js` parser/cache namespace、replay tool namespace、三份产品基线、历史回放计划、本 TaskSpec，以及构建生成的 `public/game/**` / `public/game-admin/**`。
- SillyTavern 冻结路径保持不变。分页函数 slice 应在回合结束时与记录的 3,453-byte SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d` 核对；历史工作区已有大量 unrelated dirty files，不能用 HEAD 整体 diff 声称其未变。

## 验收

- v68 源句 positives：把物品后引语、动作/状态后引语、工具鉴定后引语、角色所有格眼神/状态、动作后接独立引语。
- negatives：同句书面载体、两名角色共同动作、独立旁白引语、静态外貌/情绪在前页后接独立引语。
- shared adapter、speaker replay 与 runtime regression tests 通过。
- 全历史只读 replay 报告源 digest、parser 版本、互斥类别数与差异；仅表示覆盖变化，不代表 accuracy。
- player/admin static build、pagination slice byte/hash parity、SillyTavern frozen-path、`git diff --check` 通过。
- 独立 A1 审计针对冻结版本给出 PASS/FAIL/INSUFFICIENT_EVIDENCE。没有完整人工 gold 时，整体 speaker accuracy 必须保持 `INSUFFICIENT_EVIDENCE`。

## 当前实现回放（2026-10-09）

当前只读命令 `node frontend/player/tools/speaker-structure-replay.mjs`：158 chats、951 assistant messages、18,592 production pages、6,108 dialogue candidates；4,023 attributed、333 anonymous introduction、1,752 narrator fallback、0 unresolved。source-set digest `sha256:aa54e48416e83a1130bfe18c734ee599a0b6f73cbf2cb2a7d86313fb363c2fc5`；`speakerScopeStatus=scope-unavailable`（158 chats），`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；accuracy `INSUFFICIENT_EVIDENCE`。旧 v67 文档的快照为 950 messages / 18,562 pages，不能与本次直接构造逐页迁移或准确率比较。工作区此前一次未记录 digest 的 v67 诊断曾显示 3,996/331/1,784；该差值仅供观察，因 source-set hash 缺失不能作为同源基线。

已通过：`node --test frontend/shared/tests/sillytavern-adapter.test.mjs`；完整 `node --test frontend/player/tests/speaker-structure-replay.test.mjs`（63/63）；v44 dragon-scene boundary 与 v68 historical object-transfer source-bound replay；`node --test frontend/player/tests/runtime-regressions.test.mjs`（58/58）；player/admin static build、static DOM smoke、`git diff --check`。三份 segmenter slice（shared/player/admin）均为 3,453 UTF-8 bytes / SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。SillyTavern frozen paths无改动。独立只读 A1 审计结论：见下方审计记录。

## 独立审计与验收边界

独立 A1 对冻结 v68 版本完成只读检查，结论为 `PASS`：新增归属只读取同消息源文本中的主体/动作/引语关系；明确署名优先，载体文本、多主体和无关前页状态维持拒绝归属；生产分页函数、source spans、聊天存储和 SillyTavern 原版路径不在改动范围。A1 通过仅表示本 TaskSpec 的实现与边界证据足够，不代表历史整体说话人准确率，也未替代浏览器/移动端人工验收。

最终完整历史回放：158 chats、951 assistant messages、18,592 production pages、6,108 dialogue candidates；4,023 attributed、333 anonymous introduction、1,752 narrator fallback、0 unresolved。source-set digest `sha256:aa54e48416e83a1130bfe18c734ee599a0b6f73cbf2cb2a7d86313fb363c2fc5`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；scope unavailable for 158 chats，故 `speakerAccuracy=INSUFFICIENT_EVIDENCE`。v67 与 v68 快照不同，覆盖数字不用于准确率或精确迁移结论。
