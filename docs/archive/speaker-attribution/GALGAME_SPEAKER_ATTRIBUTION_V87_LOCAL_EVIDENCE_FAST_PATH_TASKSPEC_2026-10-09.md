# V87 本地强说话证据快路径 TaskSpec

## 目标与风险等级

- 目标：避免强而完整的本地说话证据先被语义标签显示成“未识别”，同时还要等待可选世界书候选读取。
- 非目标：新增姓名正则、扩充词表、改说话人归属算法、改语义分析结果、改剧情正文、重切分页或创建角色身份。
- D/I/A：D0 / I1 / A1。判定方法与验收明确；改动集中在 player 标题恢复的异步顺序；标题投影需同时审查语义覆盖、异步竞争和分页不变约束。
- 用户目标：修复当前对话 `Durik咆哮："老子挡住他们！Boss专心封印！"` 显示“未识别”的问题，并查清大量既有规则为何未在显示链路生效。

## 基线与根因

基线 HEAD 为 `c59b194f6f8ebb663f2cd24a5fdc257cc5ec93e9`。本任务开始时工作树已有大量未提交、未跟踪改动；它们是保留基线，不得重置、清理或覆盖。本 TaskSpec 仅授权下列本次目标文件中的最小增量。

只读回放当前聊天完整 assistant 消息后，共享 V86 parser 对该引语给出 rank 0 的 `explicit-speaker-cue` 决策 `Durik`；投影到原有第 20 页也返回 `Durik`。因此该样例不是缺少结构规则，也不是上下文噪声把主体解析错。失效发生在 player 标题执行顺序：`ensureStructuralPresentationPageTitle` 先等待世界书候选异步请求，再建立本地完整消息索引。玩家在候选结果回来前翻页时，过期目标会因当前页保护而被丢弃，页面就一直停留在语义层给出的“未识别”。

## 实施策略

1. 仅当原有生产分段器已经在当前页面给出 `runtime-text` 的具体人物候选，且页面含引语时，才提前运行现有 shared full-message parser；不增加另一套姓名/动作规则。
2. 只有完整消息 parser 给出与当前页引语重叠的 rank 0 `explicit-speaker-cue`，且投影证据通过现有 exact source/message/span 校验，才直接投影该可见标题并返回。
3. 不满足上述条件时，保留当前世界书候选读取、候选 fingerprint、旧结构分析、延迟响应作废等路径。
4. 语义分类、身份、sourceSpan、正文、分页和 SillyTavern 原版均保持不变。标题来源仍受完整消息哈希及精确页面范围校验。

## 允许修改

- `frontend/player/src/main.js`
- `frontend/player/tests/runtime-regressions.test.mjs`
- `public/game/app.js`（由静态构建产物更新）
- 本 TaskSpec 与三份基线规范顶部的当前行为摘要

禁止触碰聊天 JSONL、`src/**`、原版 SillyTavern 文件、语义分析服务、规则词表与 formatter/segmenter。

## 验收

- 新回归：`Durik咆哮："老子挡住他们！Boss专心封印！"` 在语义层预标 `unattributed-dialogue`、候选读取永不 resolve 的情况下仍立即显示 `Durik`。
- 同一测试证明语义分类仍为 `unattributed-dialogue`，正文和 sourceSpan 不变，且不触发世界书候选请求。
- 既有候选 scope、并发合并、延迟响应丢弃、正文分页与 renderer 回归均通过。
- 对实际最新聊天长回复做只读回放：完整消息 index 与原始 page cohort 固定，命中页标题为 `Durik`，聊天源文件哈希前后相同、没有写回。
- 静态构建与架构审计通过；原版冻结路径无差异，正文 formatter/segmenter 不变。
- 独立只读 Audit 为 PASS 后，才可称代码验收完成；历史覆盖数字不得作为准确率结论。

## 实施结果

已实现本地强证据快路径，并新增回归模拟世界书候选读取永不返回。调用当前最新聊天完整消息只读回放时，共 41 页；目标为第 20 页（zero-based pageIndex 19），生产分段器给出 runtime-text 候选 `Durik`，完整 V86 parser 返回 rank 0 `explicit-speaker-cue`，精确标题投影为 `Durik` / `quoted-attribution`。聊天 JSONL SHA-256 前后均为 `1ceef27906362e2dfb5f294ea683039fdd352288479d58b4073d9b1f33e9184b`。无聊天写回、无 LLM 或外部模型调用。

验证：player runtime regression 67/67 pass；shared adapter suite pass；静态架构审计 `ok=true`、`prohibitedActiveCount=0`、`needsReviewCount=0`、`failedChecks=[]`；8001 静态 player `index` 和 `app.js` 均 HTTP 200，app.js 中包含 V87 build version 和快路径代码；`git diff --check` exit 0。只读 UI 检查确认修复前目标页面确实显示“未识别”。

旁支 `frontend/player/tests/visual-presentation.test.mjs` 有一个不在本 TaskSpec 改动范围内的既有断言失败：第 302 行实际期望 narrator placeholder、测试期待 unknown-speaker placeholder；本任务未修改该视觉逻辑。独立只读代码审计：PASS；审计员确认强证据门槛、精确投影校验、source/body/semantic/identity 不变及 source/build 一致，且冻结路径无改动。审计员未独立重跑测试。现场浏览器路由无法由审计员验证（`ROUTE_UNVERIFIED`），所以现场验收仍需区分于代码验收；本任务验证了本地页面构建 HTTP 200 和修复前 UI 状态，不能声称已完成修复后同一页的浏览器截图验收。无新增逐页 gold，因此不报告识别准确率。
