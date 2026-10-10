# Galgame 说话人归属 v72 TaskSpec

## 目标

继续降低历史页中“旁白兜底”的误用，并让同聊天内已被明确署名的人名能参与后续近邻句匹配。覆盖数只用于回归比较，不代表准确率。

## 继承基线和范围

- 继承 v71 的 roster 外局部主体解析：动作/发声 cue 与闭合引语的同句结构；动作和语气片段不再作为猜测姓名。
- 新增 v72 低优先级姓名提及兜底：在其他 quote resolver 候选都为空时，检查当前句和紧邻前后句的引号外文本；有多个已知角色名时选最先出现者。
- chat-local observed-name scope 保留“两条不同消息重复署名”门槛；该姓名只在同一聊天最近 8 条消息内复用，当前消息不能使用自己的锚点，新场景标题清空 scope。
- 曾试验“一条高置信显式署名即可复用”，覆盖数增加，但出现 `发出一声` 一类错误姓名沿聊天传播；该门槛不进入 production。回放 API 保留 min=1 对照参数以复现风险。
- 仅可改上层 display-title evidence、player cache/parser namespace、只读历史 replay、对应 tests/docs 和静态构建输出；不得改 SillyTavern 原版源码。

## v72 边界

新规则位于所有既有 attribution 规则之后、显示层旁白兜底之前。它不改 segment type、正文、source spans、页数/页序、聊天、身份、roster 或头像绑定，也不访问 provider。

只有目标引语闭合时可运行。不得把引号内部提到的姓名作为 speaker；检测到 nearby 明确的泛称人物/代词主体、并列主体、书面载体、思考/来源转述或场景边界时停止。明确眼前有多个已知名字但没有竞争主体时按源文本顺序选第一个，这是用户确认的低优先级兜底；可能误归属的风险需要在验收中说明。

姓名 scope 只接受高置信规则产生的同聊天锚点（显式 line/prefix/quote attribution）；不从 v72 自身低优先级兜底的结果递归播种，以免一次误标连续传播。仅往后生效、不用未来消息回标历史页；过期窗口最多 8 条 assistant 消息，场景标题清空。

## 必须保留的负例

- 单纯提到 Nadia、但守卫或代词明确接管发声，不能标成 Nadia。
- 多人并列行动仍保持未归属。
- 角色名出现在信件署名、信件内容、思考文本或物品/账本载体时不归属。
- 对话以“她/他 + cue”开始且上一句有两个角色时不自行选取。
- 同一聊天的新场景标题会清空之前观察到的姓名。
- 重复 source message index 不制造额外 distinct-message 计数。

## 历史回放验收

对同一已缓存只读聊天快照分别运行 v70/minimumDistinctMessages=2、v70/minimumDistinctMessages=1、v72/minimumDistinctMessages=2，以分别报告 scope 门槛与 v72 规则的贡献。min=1 仅作风险对照，不能作为上线配置。至少输出 chat/message/page/candidate 数、attributed/anonymous/narrator fallback/unresolved、`nearby-known-name-mention-fallback` 和 v71 子规则命中数、source-set digest、`sourceUnchanged`、`chatWriteback=false`、`externalProviderCalls=0`。

归属准确率没有独立 gold 时必须保持 `INSUFFICIENT_EVIDENCE`。抽查低优先级 fallback 的真实样本，发现明确误归属须先加阻断或缩窄规则再接受。

## 验证与边界审计

- shared adapter、speaker replay、player runtime regressions 全通过。
- 静态 player/admin 构建输出与 source parser/cache namespace 一致。
- DOM smoke / cache coherence 和 `git diff --check` 通过。
- 用函数切片 hash 验证 `createVisualNovelDisplaySegments`、既有 source spans、正文内容和顺序本轮未改变；不得以重新格式化或恢复分页的名义修改它们。
- 检查 frozen SillyTavern-owned paths 无 diff。
- 冻结实现后执行独立只读 A1 审计；审计未 PASS 不得宣称验收。
