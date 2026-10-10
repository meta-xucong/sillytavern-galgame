# Galgame 说话人归属 v67：代词承接闭合引语

状态：实现、回归、构建与全历史只读回放完成；独立 A1 审计 PASS（仅限 v67 文档范围）。分类准确率仍为证据不足，真实浏览器/移动端验收未执行。

## 目标与根因

减少“正文有可追溯说话人、标题却兜底旁白”的结构漏判。v66 的局部回归只用简化 Anna 文本，真实样本仍落旁白；全历史还发现闭合引语之后常有一页以“她/他 + 动作或发声”承接，再出现下一句独立引语。v66 的历史桥接主要保留未闭合原引语，闭合引语会被抛弃，导致这类后续同一角色的对白失去显式锚点。

## v67 结构规则

1. **前页人物—代词—引语**：当前页只有一个完整独立引语；最近两张既有页中，前一页含唯一最近的显式 speaker anchor，再后一页是单句、以“她/他/它”起始的动作或发声承接。无场景边界、书面载体、竞争 speaker、额外引语或标题/结构记录时，将当前引语显示归到最近唯一锚点。引语正文里的宾语姓名不抢说话人。
2. **前页具名主体—引语—同代词**：当前实现的具名动作主体回溯扫描仅识别 ASCII 拉丁字母姓名；前页存在唯一此类主体，当前完整引语后的紧邻原文以同一第三人称代词继续叙述时才回指。中文名等不在此窄规则覆盖内；由同页通用 cue 或其他既有规则处理，不能据此声称已覆盖所有中文剧情。
3. 任何条件不成立或证据冲突，继续使用旁白兜底；不造角色身份、roster、头像绑定或剧情状态。

## 边界与不变量

- 只生成 display-title evidence；不改 SillyTavern 原版代码、聊天正文、保存内容或既有分页、页序、页数、sourceSpan。
- 不调用 LLM/provider；历史回放只读，失败或歧义保持兜底。
- parser/cache/replay scope 版本为 `full-message-speaker-index.v67`。
- 仅改 `frontend/shared/src/sillytavern-adapter.js`、对应测试、`frontend/player/src/main.js`、speaker replay 工具/测试、静态 player/admin 构建产物，以及本任务文档、历史回放计划和三份基线文档。
- SillyTavern 冻结路径不变；分页器冻结段仍须跨 source/player/admin 校验：3,453 UTF-8 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。

## 验证计划与结果

- adapter 测试覆盖完整 Anna 原文、Priya 与 Nadia 的闭合引语后代词承接、引语对象名不抢说话人、无 prior anchor 和书面载体负例，并断言 production page snapshot 不变：PASS。
- `frontend/player/tests/speaker-structure-replay.test.mjs`：62/62 PASS。
- `frontend/player/tests/runtime-regressions.test.mjs`：58/58 PASS。
- 全历史只读回放（`full-message-speaker-index.v67`）：158 chats、950 assistant messages、18,562 pages、6,094 dialogue candidates；v66 为 3,977 attributed / 331 anonymous / 1,786 narrator fallback；v67 为 3,981 / 330 / 1,783。兜底净少 3 页，规则计数为 1 个 `prior-page-pronoun-linked-quote-continuation` 与 3 个 `prior-page-pronoun-speaker-resumption`。计数描述覆盖迁移，不代表准确率。
- source digest 未变：`sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。无完整 gold，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。
- `node frontend/build-static.mjs`、`node frontend/tools/static-dom-smoke.mjs` 与 `git diff --check`：PASS。
- 分页冻结段在 shared/player/admin 均为 3,453 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`；SillyTavern 冻结路径 `src/**`、`server.js`、`plugins.js`、原版 frontend 与配置/依赖文件无变更。
- 独立只读 A1 首轮指出文档状态冲突与规则姓名字符集边界；本次已把历史回放计划的“静态构建/DOM/hash/frozen-path 待完成”更正为已完成，并明确记录拉丁姓名扫描限制。独立复核 PASS；此 PASS 不代表语料准确率或真实浏览器/移动端体验已经验收。
