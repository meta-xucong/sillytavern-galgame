# Galgame 说话人归属 v65 修复与回放诊断 TaskSpec

状态：实现、定向测试、历史只读回放、静态构建和 DOM smoke 已完成；独立 A1 审计待执行。继续 v64 的 display-title-only 说话人证据排序；不改变正文、分页、语义 annotation、身份/队伍状态、图片绑定或 SillyTavern 原版代码。

## D/I/A 与目标

- D0：从 v64 历史只读回放中复现了两个相同形态样例，问题证据已定位。
- I2：相同源引语在 quote resolver、page-local cue 投影、跨页 source span 和 replay validator 间有交互；需要维护统一裁决与分页冻结边界。
- A1：必须由独立只读审计核查源证据、冲突路径、跨页证据 span、分页不变性和冻结版构建。
- 目标：修复 `姓名 + 声音修饰词 + 说话谓词 + 引语` 被 page-local 贪婪姓名提取误判为不同说话人的情况；使跨页冲突诊断 evidence 始终落在当前 source page core 内；让回放报告正确描述与页面相交的 quote evidence。

## 复现证据

v64 全历史回放的两个 unresolved bucket 样例来自同一导入聊天，assistant message index 672、676。当前原文均有 `瑞恩小声说：“……`，完整 message quote ledger 均已 source-bound 归属给 `瑞恩`，evidence rank 为 0。对应 production page 首屏因 page-local 贪婪 `[\p{Script=Han}]{2,4}` 将 `瑞恩小声` 当姓名，与 quote 决策产生假冲突。后续同 quote page 已能继承为瑞恩。

额外问题：冲突 fallback 的 classification span 使用完整 quote span；引语跨越 production page 时该 span 超出当前 page core，被 replay validator 拒绝。回放只统计 `reasonId=unattributed-quoted-speech` 的 unresolved spans，因此把有 quote ledger 的页面报成 `noQuotedSpan`。无效 evidence 的 display text 也不应冒充有效预测。

## 设计规则

1. 如果 page-local cue 和现有 quote winner 指向同一 source quote、完整 evidence span 相同、speaker span 起点相同，且姓名片段是同一起点的前缀边界候选，则它们属于同一线索的 parser boundary variants；采用已由完整 quote candidate resolver 得出的 selected speaker，不生成同级异人冲突。
2. 如果 source evidence span 不同、speaker start 不同或不是同一 quote，则保留 v64 的 rank/tie-abstain；现有 `Pippa回应Sam说道：“好。”` 仍必须冲突并回退旁白。
3. 所有 page-level classification evidence spans 必须截取到当前既有 page core。quote ledger 可保留完整跨页 quote span；projection 不得把整段 quote span伪装成属于当前 page 的证据。
4. 历史 replay 的 unresolved 诊断必须检查与 page core 相交的 quoteEvidence，不得只检查 unresolvedDialogueSpans；如果投影 evidence 无效，不能使用其 `text`/`ruleId` 作为已预测标题。
5. 仅改标题证据解析与只读回放诊断。原始正文、SillyTavern segmenter、production page 数/顺序/type/text/sourceText/sourceSpan/index 全部逐项保持不变。

## 分页器冻结基线（本 TaskSpec 写入前采集）

`createVisualNovelDisplaySegments` 起始到 `applyQuotedDialogueSpeakerContinuity` 之前的原始 UTF-8 slice，在源码、player static adapter、admin static adapter 均为 3,453 bytes，SHA-256：`a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。实现后必须重算三份并保持完全一致。该基线用于本轮，不倒推解决 v64 的历史起点证据缺口。

## 允许改动

- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`
- `frontend/player/src/main.js` 仅 parser/cache namespace v64 → v65
- `frontend/player/tests/runtime-regressions.test.mjs` 仅适配 v65 版本断言
- 本 TaskSpec、Historical Replay Plan、Native-first、Design、Frontend 三份基线
- 完成源码和回归检查后必要的 player/admin static build outputs

一位 writer；其余工作区 dirty 文件属于既有工作，保持原样，不 reset、不 clean、不回滚。

## 必须测试

- `瑞恩小声说：“至高领袖……` 经生产 segmenter 得到的首个 quote page 标题为瑞恩，后续跨页仍为瑞恩。
- `Pippa回应Sam说道：“好。”` 仍因不同 speaker start/source candidates 产生冲突并旁白回退。
- 真正不同证据 span / 不同 speaker start 的 same-rank 冲突仍拒绝归属。
- 跨页 narrator/conflict fallback 的 evidence spans 均完整包含于对应 coreSpan。
- replay 把两个历史例子归入 attributed speaker，而不是 unknown/unresolved；invalid evidence 不投影 titleText。
- 所有 existing speaker、runtime regression、adapter、read-only history replay 及静态构建检查通过；source digest 稳定、chatWriteback false、provider calls 0。
- production segmenter 与三份原版 SillyTavern 冻结路径无改动。

## 实施与验证结果

- shared adapter 1/1；speaker replay 61/61；runtime regressions 58/58。
- 全历史只读 replay：158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates；3,947 attributed、223 anonymous、1,924 narrator fallback、0 unresolved。source digest 仍为 `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。比 v64 分桶减少 2 unresolved；candidate 归属覆盖净增 10 page records，不能据此宣称 accuracy 提升，准确率仍为 `INSUFFICIENT_EVIDENCE`。
- Player/admin static build、static DOM smoke、`git diff --check` 通过。
- 分页 slice 实施前、实施后源码/player/admin 三份均为 3,453 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。
- 构建产物 SHA-256：player app `D472A9EE3F0B2EB499ABAF179B9EF47BA14D7DAB150603393E47FCB55AD59756`，player index `1E48B3627507ED1A35815AB1E36B80DEB5F87130389683C392E82316D032E645`，player/admin shared adapter 同为 `54FB86B3EEB266717FFB230B4D733048955B9B6192720D0A88B74CD81B44447F`，admin app `31FF35DD8680FF9B942C12BCCFEE845F3F9DD11D95A3D2003A48A41A68B4F9BD`，admin index `7A37954DA47955B2E272F364994FAFD9D5DEF4EBF43EBFD0339C41526E831777`。
- 架构审计未运行，避免该脚本写入 ignored JSON；真实浏览器/移动端未验收。独立 A1 待审。v64 的历史分页基线审计缺口依旧存在；v65 的前后 slice 对比只覆盖本轮。

## v64 状态延续

v64 相关代码和测试通过，独立 A1 对其 resolver/projection/probable-title path 未发现明确缺陷；整体 A1 为 `INSUFFICIENT_EVIDENCE`，原因是独立审计无法核验 v64 任务起点分页快照。v65 只承诺对本轮记录的分页基线做前后对比，不宣称关闭 v64 的历史审计缺口。speaker accuracy 缺少代表性人工 gold，继续为 `INSUFFICIENT_EVIDENCE`；source coverage 变化不得表述为准确率提升。
