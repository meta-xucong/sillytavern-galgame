# Galgame 说话人归属 v71 TaskSpec

## 目标

修复 v70 低命中率暴露出的通用句式漏识别。只优化现有的结构化展示标题解析：对白引语没有被既有高优先级规则归属时，利用同一原始消息中的局部主语结构恢复说话人。历史聊天没有完整 roster，因此该末级规则不能把 roster 存在作为前提。

## 冻结基线与范围

- 当前解析器基线：`full-message-speaker-index.v70`。
- 历史只读基线：158 chats、954 assistant messages、18,667 production pages、6,141 dialogue candidates；4,061 attributed、329 anonymous introductions、1,751 narrator fallback、0 unresolved；source digest `sha256:9b97dc97c83840a662413f7bb2d71d8f6a3500f2fd476d33aa30995cedf578c1`。158/158 chat roster scope unavailable；观察到的姓名仅来自 2 个聊天。
- v70 的 3 次命中是 v70 自己的分支计数，不能代表全部结构化解析效果。旁白兜底也不是错误金标；回放覆盖数不得表述为准确率。
- 允许修改：`frontend/shared/src/sillytavern-adapter.js`、相应 shared/player speaker tests、player parser/cache 与只读 replay 版本、三份基线文档、历史 replay plan、本 TaskSpec 和按现有流程生成的 `public/game/**`、`public/game-admin/**`。
- 单一写入者；实现后由独立只读 A1 审计。

## 规则与优先级

既有结构化 quote resolver 的候选、rank 和 tie-abstain 行为不变。v71 只在目标 quote 没有既有候选时运行，位于旧规则之后、展示层旁白 fallback 之前；只投影标题证据，不改语义分类、身份、roster、头像绑定或源消息。

v71 支持三种同消息、局部、结构优先的证据：

1. **动作句引出冒号引语**：引语前以冒号直接收束，前置句以唯一具名人物为语法主体，并具有可解析的动作链时，将引语归属给该主体。支持连续动作构式（如“一边……一边……”）。冒号后的文字载体、状态/记录、场景标题、玩家代词、匿名描述和多人竞争不适用。
2. **逗号分句省略同一主语**：明确发声 cue 位于后续逗号分句时，可回看当前句前面的动作分句；只有唯一具名主语贯穿、无新人物主体或书面载体，才归属给该角色。常见语气副词/程度副词不得把“姓名 + cue”切断。
3. **引语相邻句的姓名 + 发声 cue**：保留 v70 的邻句范围与边界，但姓名可以是当前句中由局部语法解析出的 roster 外姓名；必须处于该 cue 的主体位置，不能仅因附近提及姓名而触发。

若同级线索不能唯一确定主体，继续 abstain/fallback。v71 不跨消息推断，不用历史 display title 建立说话人，不以引语内部第一人称推断玩家，不把群体/文书/游戏信息当成角色。

## 硬边界

- 不改原版 SillyTavern 代码，不写聊天数据，不访问任何 provider。
- 不改 `createVisualNovelDisplaySegments`、source spans、分页器、页面数量或顺序；分页哈希只需证明 v71 diff 前后未变化，并单独保留工作树已有的分页基线差异说明。
- 不用场景专名、角色专名列表扩充规则；新增逻辑只依赖局部句法角色、显式 cue、引语/冒号边界和既有主体解析器。

## 验收

- 增加针对 `Lila则只问：“入口几个？”`、`Lila扫着四周，低声说：“……”`、`Pippa一边……一边……：“……”`、`赫斯克尖声大喊：“……”`、`Pippa掏出地图，翻开第一页：“……”` 的正例；测试必须在没有 roster 时运行。
- 负例覆盖：附近只是提名、第二个明确主体接管、地图/信件/铭文承载文字、匿名外貌描述、独立相邻引语、场景边界、玩家/泛称主语、同级歧义。
- 必须提供 v70/v71 同一聊天快照的全量只读回放 transition 数：总候选、attributed、anonymous、fallback、未决、ruleId 命中、source digest、`sourceUnchanged`、`chatWriteback=false`、`externalProviderCalls=0`。覆盖迁移不是 accuracy；没有新增独立人工 gold 时，准确率仍为 `INSUFFICIENT_EVIDENCE`。
- 通过 shared adapter、speaker replay、player runtime 回归、静态构建、静态架构审计、DOM smoke、cache coherence、分页器切片哈希前后比较和 `git diff --check`。
- 对冻结版本执行独立只读 A1 审计；若 A1 不是 PASS，不交付为验收完成。

## 已知基线限制

工作树在本轮开始前已有大量未提交修改。不得清理、还原或重写这些文件。本任务只对上述允许范围作增量变更。生产分页器切片与早期历史文档的冻结 SHA 不同是继承状态，本轮不能据此声称恢复了历史版本；验收只要求本轮分页切片内容前后完全一致。
