# Galgame 说话人归属 v70 TaskSpec

## 目标

增加一个轻量末级规则，覆盖结构上较常见但此前未归属的句式：引语附近的已知角色名，与轻度隔开的明确发声 cue 同句出现，例如 `“快走。”。Nadia停顿片刻，随后低声说道。`。它仅补展示标题，不运行模型、不访问 provider、不写聊天。

## 精确优先级

1. 按现有顺序运行全部结构归属规则，包括引号署名、冒号署名、动作/反应、代词回指、扩大句窗的明确署名等。
2. 仅当目标引语闭合、不是书面载体，且既有规则没有生成任何候选时，运行 v70 邻句末级兜底。
3. v70 仍无唯一结果时进入既有展示层 fallback；不得把歧义包装为旁白语义或事实分类。

## v70 末级兜底判定

- 范围仅是目标引语所在句与紧邻的前一句、后一句，不继续扩大。
- 姓名必须来自当前既有 `knownNames` 集合；只在句中提及姓名不会触发。
- 同一个有界句中还必须有现有明确发声 cue。角色名到 cue 之间不允许跨句末标点或引语边界；可跨短动作/停顿描述和连接词。
- 姓名与 cue 之间若出现代词/泛称发声主体，或另一明确人物类别（如守卫/士兵/法师等）承担发声动作，则拒绝候选。
- 同级最近窗口包含多个不同已知姓名时拒绝猜测；不同等距候选冲突时拒绝猜测。直接邻接窗口的唯一候选优先于更远的前/后邻句；等距且同 speaker 的证据可合并为一个候选。
- 书面载体、独立引语、场景边界、标题形态和其他 quote 冲突继续由既有规则阻断。
- 首次出现、roster 外姓名不由此规则猜测，仍按原先 anonymous/旁白策略处理。

## 允许变更

- `frontend/shared/src/sillytavern-adapter.js`：v70 helper、末级调用与 parser 版本。
- `frontend/shared/tests/sillytavern-adapter.test.mjs`：正例、负例、既有高优先级规则保护。
- `frontend/player/src/main.js` 与 `frontend/player/tools/speaker-structure-replay.mjs`：cache/replay parser version。
- 对应 player replay version assertions、三份基线文档、历史回放计划和本 TaskSpec。
- 按仓库既有流程更新 `public/game/**` 与 `public/game-admin/**` 构建产物。

不得触及 SillyTavern 原版冻结路径、聊天文件、生成 prompt、production segmenter 或任何正文分页函数。

## 已继承的工作树限制

本任务开始时工作树已存在一段与 production segmenter 有关的未提交改动：`connectorParagraphPattern` 原本无条件合并匹配到的换段符，现在改为根据原始消息是否含空行来决定是否合并。该差异不属于 v70，本轮未编辑或恢复它；但当前函数切片与回放计划历史记录的冻结基线 hash 不一致，所以不能声称整个工作树已通过分页冻结基线审计。shared/player/admin 三处当前构建副本彼此一致。需要在独立后续工作中核对该既有差异来源，再决定是否接受或恢复；不得在本 TaskSpec 下直接修改分页。

## 验收

- 新的短间隔发声 cue 正例命中 `adjacent-name-speech-cue-fallback`。
- 仅有邻近姓名但无发声 cue 时不归属。
- 替代人物主体、其他引语、载体文本或场景边界不得被错误继承。
- 同一引语已有直接/更高优先级归属时，v70 不改写它。
- 历史回放为只读：记录 parser/cache 版本、消息/页数、归属与旁白兜底分类数、source digest、`sourceUnchanged`、`chatWriteback=false` 和 `externalProviderCalls=0`。覆盖变化不等于正确率；没有人工 gold 不宣称 accuracy。
- 证明本轮 v70 diff 未触及 production segmenter；记录并保留任务开始前已有的 segmenter 基线差异，不能以三份构建副本相同替代冻结基线一致性审计。
- shared adapter/replay、player 回归、静态 build、DOM smoke、架构审计、`git diff --check` 通过；独立只读 A1 对 v70 逻辑 PASS。历史 segmenter baseline hash 差异继承自任务开始前工作树，当前缺少任务开始时的独立快照可重算，因此作为证据边界单独保留，不归因于 v70。
