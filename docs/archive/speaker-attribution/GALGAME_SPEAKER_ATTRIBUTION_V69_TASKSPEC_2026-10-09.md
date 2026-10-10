# Galgame 说话人归属 v69：前后句署名扩展

## 目标

按用户要求：当前窗口仍无法确定时，允许在目标引语前后各多看一句，寻找**明确署名**；若窗口内出现多个署名，按它们与目标引语的句法关系和距离决策。禁止把邻近出现的人名直接当说话人。

## 历史多署名/冲突检查

对 158 个归档聊天的 source quote 记录进行只读检查，发现 12 种唯一的 `conflicting-quoted-attribution` 引语（同一文本的重复归档已去重）。样例显示，冲突常发生在相邻对白交替或一个回复含多段对白时：当前引语前后各有明确的不同说话句，但不一定都是目标引语署名；另有“她/它 + 动作/反应 + 引语”以及书面载体文本。故规则必须先确认署名与目标 quote 的绑定关系，不能采用最近人名或一律取前/后侧。

## v69 决策规则

1. 保留现有同句明确 cue；若无结果，再将证据窗口扩到最多前两句、后两句，按完整句边界扫描。
2. 只有明确的“主体 + 发声谓词/署名标记”或等价的明确引语署名才进入候选。普通提名、代词、动作、外观、状态或物件所有者不因窗口扩大而升级为署名。
3. 优先级：与目标 quote 在同一引语框架内直接相连的署名（`角色说/问/答：引语`、`引语，角色说/问/答`）高于相邻句署名；相邻句候选按句距从近到远。候选之间若隔着另一段引语、场景标题/分隔、书面载体或另一个明确发声主体，禁止向目标 quote 传播。
4. 若最优优先级/句距内只剩一个 speaker，归给该 speaker；同级仍有不同署名，保持 unresolved/narrator display fallback，不猜测。不会以“靠后的人名”或“最后说话的人”破平局。
5. 后扩展句仅接受语法上回指目标引语的紧邻署名格式；目标引语后出现的新对白/独立叙述不能反向改写目标说话人。

## 不变量与范围

- 仅改变 display-title speaker evidence，不改正文、语义标注、source spans、原版生产分页、页数/顺序、roster/身份/头像、聊天文件或模型提示。
- 不调用 LLM/provider；历史回放只读，无聊天写回。
- SillyTavern 原版冻结路径绝不修改。
- parser/cache/replay 版本递增至 `full-message-speaker-index.v69`。
- 实施边界：adapter、对应测试、player/replay cache 版本、基线/回放文档与构建生成的 player/admin 静态输出。

## 验收

- 前一、前二句的唯一明确发声署名可归属目标引语；后一、后二句只在有明确语法回指时可作为目标署名。
- 同句/邻句出现多个不同名字时，直接目标引语署名胜过邻近名字；另一个引语或新发声 cue 构成隔离边界；同级冲突 abstain。
- 负例涵盖普通名字提及、物件/镜面/信件等书面载体、旁边另一人物发言、换场景与书写报告。
- adapter、speaker replay、runtime regressions 通过；历史全量只读回放报告互斥分桶和源 digest，不能用分布变化推断准确率。
- player/admin 构建、DOM smoke、分页器三份字节/hash 对照、冻结路径核对及 `git diff --check` 通过。
- 独立 A1 对冻结 v69 版本出具 PASS；总体准确率仍以完整人工 gold 为准。

## 实施与只读回放结果

- 规则已落在共享结构化 adapter：当前 quote 无直接署名时，向前后扩展最多两句；只接收明确发声谓词署名。显式署名优先于仅含角色名的动作句；同一侧多个显式署名按距离最近者处理；候选与目标 quote 之间如有另一段 quote、场景边界、书面载体或记录框架，则停止传播。
- 修正独立审计发现的桥接误归属：`Nadia低声说道。信上写着一行字。“走。”` 以及报告载体版本不再归给 Nadia。相邻 quote 仍按各自直接署名归属。回归覆盖前两句唯一署名、近处署名优先、后扩展签名、只提名字不归属、书面载体阻断。
- 验证通过：`node frontend/shared/tests/sillytavern-adapter.test.mjs`；`node frontend/player/tests/speaker-structure-replay.test.mjs`；`node frontend/player/tests/runtime-regressions.test.mjs`（58/58）；`node frontend/build-static.mjs`。player、replay 与 player/admin 静态 adapter 均为 `full-message-speaker-index.v69`。
- 当前归档集的全量只读回放：158 chat 文件、953 条 assistant 消息、18,637 个既有 production pages、6,130 dialogue candidates；4,049 attributed、330 anonymous introductions、1,751 narrator fallback、0 unresolved candidate rows。v69 新增的 `expanded-explicit-signature` 在此归档集命中 1 次。该计数只说明规则覆盖，不能据此推断准确率；由于本次 source digest `sha256:4b812e8170122e23b5df0468253a9895ee0f31836f53d130f55f5a006aa341c8` 与历史 v68 digest 不同，不做跨版本 fallback 数量比较。scope 对 158 个 chat 不可用，`speakerAccuracy=INSUFFICIENT_EVIDENCE`。
- 回放证明 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`；结构 evidence 17,878/17,878 可寻址。分页器切片 SHA-256 `a88752786dd13250fa269d75b9489b374931429c90164de6c18f41b41a1eae3d`（3,453 bytes）与基线一致。独立只读 A1 复核通过：书面载体桥接阻断、静态 v69 版本一致、分页与 SillyTavern 原版冻结边界均无问题。
- 尚未做真实浏览器/移动端目视验收；此项规则只改标题证据，不涉及分页或正文，历史回放和结构回归是本轮验收重点。
