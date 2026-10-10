# V84 跨剧本结构规则统一激活 TaskSpec

## 用户目标

此前人工归纳并实现的结构化说话人/标题规则必须在任意已发布剧本中自动运行，不要求逐剧本开关、规则配置或复制规则。角色名属于当前剧本/聊天的动态数据，不能把某一部剧情中的人名写进全局匹配表。

## 审计结论与根因

- 结构索引由 shared `createStructuralMessageSpeakerIndex` 统一实现；它不按 scenario ID、剧本名称或角色名单开关整套规则。
- 名字候选应按当前 release/manifest、当前聊天前序明确出现的说话人、以及 V83 当前聊天头精确绑定的显式世界书标题候选动态提供，并受聊天/release 缓存隔离。候选名只是句法词面候选，不是身份或说话结论。
- 实施前观察到的旧状态是：production parser 为 v82，但 shared 中部分累积功能判断只认到 v78；离线 replay 固定 v78，无法代表 production。V84 已将生产与 replay 统一升到 v83，并改为按数字版本阈值继承已累积规则。
- shared parser 中也有少量题材/措辞专用辅助分支，例如龙类语义线索。它们并非某剧本 ID 的开关，也不代表全语言/全题材语义能力；保留为条件式辅助规则，不将它们冒充通用准确率保证。核心通用规则仍按引号、句法主语、发声谓词、相邻句/页有界承接、角色名候选和唯一证据执行。

## 设计契约 `galgame.structural-speaker-rules.v84`

1. 所有已发布剧本走同一份 shared structural parser；结构规则不得读取或判断 scenario ID/名称后选择规则集。scenario、release、arc 只用于验证资源和隔离标题/cache scope。
2. parser version 的累积功能按数字版本阈值判断。生产 v83 继承所有已发布的 v78 及之前规则；未来版本自动继承，除非某项有明确、经过测试的废弃/取代记录。历史 pinned-version fixture 仍可重放其旧行为。
3. 生产 player 和 historical replay 必须引用同一当前 parser version；不能一个用最新版、一个用旧版后将回放结论当作当前生产效果。
4. parser 源码不得包含既有剧本专属人物姓名的全局列表。新增姓名只来自当前剧本/聊天候选 scope；同一结构规则必须能处理新造姓名和不同文化书写形式。
5. 专题词汇分支只能作为附加 cue；缺少该题材 cue 时不得关闭或削弱通用语法规则。规则套件已对全部场景激活，不等于对所有语言、世界书 schema、写作风格承诺相同识别率。
6. 变更只影响结构标题证据/缓存版本；正文、切分、分页、source spans、原文、identity、头像、party 状态与 SillyTavern 原版不变。

## 范围与允许文件

- `docs/GALGAME_SPEAKER_ATTRIBUTION_V84_CROSS_SCENARIO_RULE_ACTIVATION_TASKSPEC_2026-10-09.md`
- `docs/GALGAME_DESIGN_SPEC.md`
- `docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md`
- `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`
- `frontend/shared/src/sillytavern-adapter.js`
- `frontend/shared/tests/sillytavern-adapter.test.mjs`
- `frontend/player/src/main.js`
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs` only if replay parser version contract requires an assertion update
- `frontend/tools/static-architecture-audit.mjs` only if parser version source equality needs static enforcement
- `public/game/app.js`, `public/game/index.html`, `public/game/shared/sillytavern-adapter.js`, `public/game-admin/shared/sillytavern-adapter.js` only as generated outputs

不得修改其它已有脏文件、原版 SillyTavern 源码、任何聊天/角色卡/世界书数据、正文分页/分段算法或运行服务配置。

## 验收

- Production parser version is advanced and all cumulative v78+ rules are active under it; a regression explicitly exercises the bounded action-chain rule and at least one other latest-only rule.
- The replay CLI reports and uses the same parser version as the player.
- Three fixtures from unrelated fictional scenarios with new Han/Latin names use the same parser without old-story names in the code.
- An ambiguous competing-speaker fixture still abstains; activating cumulative rules must not lower evidence thresholds.
- Existing adapter and runtime regression suites pass; replay remains read-only (`sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`).
- Frozen SillyTavern path remains unchanged; architecture audit and `git diff --check` pass; independent A1 read-only audit passes.

## D/I/A 与限制

- D0：目标为统一激活既有规则，不新增故事生成逻辑或精细化词表。
- I2：跨 parser version、运行时缓存、离线 replay 和标题展示需保持同一规则集合及旧版快照兼容。
- A1：验证跨剧本动态姓名、候选隔离、证据不变、分页不变与原版冻结。
- 未知语言、未支持世界书 schema、题材专用词汇和模糊句法仍可能保留 unknown/narration fallback；本协议保证规则自动应用，不保证完美覆盖或识别准确率。

## 实施结果

- `frontend/player/src/main.js` 与 `frontend/player/tools/speaker-structure-replay.mjs` 均使用 `full-message-speaker-index.v83`；shared parser 的累积门槛按数字版本工作，V83 继承 v78 及之前规则。
- 新增 fantasy、science-fiction、contemporary 三组新角色名 fixture；覆盖 v78 action-chain、summary reporter 正例和 written readout 负例。
- 定向套件：151 passed、0 failed、2 skipped（Windows symlink permission）；历史 replay 固定 cohort 1309 页，source digest/span 相同，候选迁移 131 页；accuracy 为 `INSUFFICIENT_EVIDENCE`，chat writeback=false、external provider calls=0。
- Static architecture audit：0 prohibited、0 needs-review；冻结原版源码路径无改动。独立 A1 audit：PASS。
- 2026-10-09 worktree 有大量预存脏改动，本任务保留未触碰内容。
