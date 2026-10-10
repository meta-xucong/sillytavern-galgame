# Galgame 说话人归属 v66 跨页引语与匿名主体规则 TaskSpec

状态：代码、验证、独立 A1 审计均完成。该版本落实用户对兜底旁白样例的人工判定；不改变剧情正文、分页、SillyTavern 原版代码或聊天数据。全历史识别准确率仍缺少完整金标，不能据此验收为完美准确。

## 用户目标与判定

用户人工确认的样例：

1. 独立引语“……你来了啊。”属于 Anna。
2. 当前页无署名时，可以继续向前查看一页（总窗口最多前两页）；若仍无唯一人物证据，正常显示旁白并退出“未识别”，不保留 unresolved 标记。
3. `姓名 + 说话动作 + 引语` 归给该姓名：Lila、塞莎；“银面具贵客”是首次出现的匿名人物，显示 `？？？`。
4. `他尖叫：“……”` 要回看最近前文；若唯一先行主体是“倒霉小官”这类匿名描述，显示 `？？？`，不把“他”当角色名。
5. 若当前页属于尚未闭合的同一段引语，沿用引语开端已确立的说话者（例如 Pippa），直到引语闭合；期间不得被对白内容里提到的其他名字抢占。

## 固化的通用规则

优先级：

1. **同一 source 引语的明确署名**：识别姓名/角色描述、说话动作和引号之间的局部句法关系。姓名候选允许常见长中文称谓，不得把“小声、冷冷、突然”等修饰词并入姓名。明确现存角色沿用角色名；首次出现的匿名身份描述显示 `？？？`，不创建身份或头像。
2. **开放引语续页**：一个 source 引语跨越现有页面时，基于同一 quote span 将已确定的 speaker 投影到所有相交页，直至 source quote 关闭。引语正文中提到其他角色不产生换人；只有嵌套引语自身的明确署名可开启子 speaker。
3. **有限回溯**：当前页缺少本地署名/引语台账 winner 时，只看同一 assistant message 的前两张既有生产页。选择最近且唯一的明确说话人或与引语直接连接的唯一动作主体；不得从任意名词、远处 title 或跨场景人物名推断。
4. **代词回指匿名主体**：`他/她/它 + 发声动作 + 引语` 可回指前两页最近唯一的匿名人物描述；该身份首次出现时显示 `？？？`，之后在本条 message 的相同连续引语中保持匿名显示。
5. **无唯一证据的终止状态**：窗口内没有唯一说话人、证据冲突或纯叙事/记录载体时，回退 `旁白`；不得停留为 `未识别`。书信、日志、系统状态、拟声、标题和冲突线索保持旁白/既有类型。

## D/I/A 与硬边界

- D0：本任务人工规则明确，不新增模型调用或新公共协议。
- I2：同 source quote 决议、匿名首次出现、page projection 和两页有限回溯需要共同保持一致。
- A1：独立只读审计检查负例、回溯窗口、分页冻结和源码冻结。
- 仅允许改 `frontend/shared/src/sillytavern-adapter.js` 与对应测试、`frontend/player/tools/speaker-structure-replay.mjs` 与对应测试、`frontend/player/src/main.js` 的 parser/cache namespace、必要静态构建输出以及本 TaskSpec / 历史回放计划 / Native-first / Design / Frontend 基线文档。
- 禁止改动聊天 JSONL、SillyTavern 原版源码、原始剧情正文、production page segmentation、页数/顺序/文本/sourceSpan、语义分析、角色状态或头像绑定。
- 聊天回放只读；禁止聊天写回与上游 provider 调用。

## 分页器基线

本轮写代码前，`createVisualNovelDisplaySegments` 起始到 `applyQuotedDialogueSpeakerContinuity` 之前的源码、player static、admin static slice 均为 3,453 UTF-8 bytes，SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`。实现后重新计算三份，要求完全一致。该基线只证明本轮起止不变，不追溯解决 v64 更早的独立基线缺口。

## 必须验证

- 固定 user calibration fixtures：Anna 独立引语；前两页唯一锚点与无锚点 fallback；Lila / 塞莎显式署名；Silver Mask Guest 首次匿名署名；匿名“倒霉小官”经“他尖叫”回指；Pippa 跨页未闭合引语续接。
- 负例：书面载体不是现场说话；正文提及其他姓名不打断同一开放引语；同 rank 不同说话人继续冲突拒判；两个回溯候选歧义时旁白；标题/状态记录不继承人物。
- 对所有既有回归运行 adapter、speaker replay、runtime regressions；全历史只读回放记录互斥分桶、源 digest、`chatWriteback=false`、`externalProviderCalls=0`。覆盖迁移不是准确率；总体准确率只有具备完整代表性 gold 后才能评估。
- 构建 player/admin 静态产物并执行 DOM smoke、`git diff --check`；独立 A1 审计 PASS。

## 初始工作树

任务开始时 v65 相关源文件和文档均已处于 dirty/untracked 状态；它们是本对话前序修改。实施者必须保留这些变更并仅在上述授权范围增量编辑，禁止 reset、clean 或回滚既有改动。

## 实施与验证记录（2026-10-09）

- 实施：direct cue 解析允许“冷冷/又压低声音/认真地”等动作修饰语与说话谓词组合；长中文角色称谓作为匿名主体而不截成姓名；“随后有人 + 发声 cue”进入匿名首次出现；完整 source quote 的决议投影到所有相交的现有页；对 v66 无唯一归属的开放引语输出旁白并记录 `open-quote-without-unique-speaker`，不再输出“未识别”。
- parser/cache/replay namespace 统一为 `full-message-speaker-index.v66`。静态 shared adapter 由 build 同步至 player/admin。
- 测试：`node --test frontend/shared/tests/sillytavern-adapter.test.mjs` PASS；`node --test frontend/player/tests/speaker-structure-replay.test.mjs` PASS，62/62；`node --test frontend/player/tests/runtime-regressions.test.mjs` PASS，58/58；`node frontend/build-static.mjs` PASS；`node frontend/tools/static-dom-smoke.mjs` PASS；`git diff --check` PASS（仅仓库 CRLF 提示）。
- 分页冻结区段（`export function createVisualNovelDisplaySegments` 至 `export function applyQuotedDialogueSpeakerContinuity` 之前）在 shared source、player static、admin static 均为 3,453 UTF-8 bytes、SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`，与实现前 TaskSpec 的已记录值完全一致。
- 全历史只读回放：158 个聊天文件、950 条 assistant 消息、18,562 个既有页面、6,094 个对话候选；分类为 3,977 confirmed attributed、331 anonymous introduction、1,786 narrator fallback、0 unresolved candidates。相对 v65 已记录分桶（3,947 / 223 / 1,924 / 0），coverage 变化为 +30 / +108 / -138 / 0；覆盖迁移不能证明准确率。页面侧另有 1,297 条 `structuralEvidenceKinds.unknown`，主要在对话候选分母之外；不能把候选 unresolved 为 0 表述成所有页面都有角色判断。`speakerAccuracy=INSUFFICIENT_EVIDENCE`。
- source digest `sha256:5b77a344284bcdccfa8c3df54e2fbfb0bf9fb289e5fc915b3031915022626a20`；`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；所有 158 个聊天的 roster scope unavailable；结构证据校验 17,803/17,803，page parse p95 1.03 ms。
- 独立 A1 审计：PASS。审计者复核了两页回溯上限、未闭合引语旁白兜底、匿名首次出场、Sesha 嵌套引语、Pippa 三页续引、载体/同等级冲突负例、parser/cache v66 和 SillyTavern 源冻结路径；独立复算分页器 hash 与上列一致。该 PASS 是实现和边界审计，不代表语料准确率，也不代表浏览器/移动端验收。
- DOM smoke 通过；未做浏览器实玩/移动端验收。
