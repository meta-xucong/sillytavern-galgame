# V79 TaskSpec：逐聊天资源候选名的离线回放

## 目标与边界

用户目标：继续处理 v78 固定历史 cohort 中仍处于 `no-unique-speaker-evidence` 的 1,309 页，评估明确角色资源名能否补足结构化 speaker 候选。

本阶段仅增加**离线回放诊断**，不改变玩家运行标题、语义 annotation、正文分页、source span、聊天内容、角色状态、头像、队伍状态或 SillyTavern 原版。解析器生产版本仍为 `full-message-speaker-index.v78`。不得把资源候选名称为已发布 roster；不得因页面包含某个候选名字就单独判给该人物。候选名只允许作为现有局部结构规则识别角色主体的词面候选，发声/句法证据仍由 v78 原规则决定。

## 冻结基线

- v78 fixed cohort：1,309 页；基线源摘要必须仍为 `sha256:3cd35138de9729080525259936cb95376ee662b59691f917d4903a7bd47bd6bd`。
- 全历史源：158 个 chat、955 条 assistant message、18,696 张既有页。
- 固定 cohort 只按 `(chatFingerprint, sourceMessageIndex, sourceMessageHash, pageIndex, sourceSpan)` 对齐；不得重建 cohort 或分页。
- 已审计资源分布：19 个带 `Galgame_Imported_Dungeon_Master_DnD_Base` 的历史 chat 贡献候选名；最大单 chat 对 cohort 有 657 页。另一个最大 chat 为 501 页，缺少 `world_info`，本阶段不得为其补名册。
- 其余聊天只有精确 `world_info` 名称与相应 worldbook 文件能一一匹配时，才允许尝试来源抽取；无精确绑定或无明确角色条目时无候选名。

## 改造方案

### 1. 独立候选来源协议

在离线回放工具中定义 `galgame.speaker-candidate-scopes.v1`，每项包含：

```json
{
  "chatFingerprint": "sha256:…",
  "resourceName": "exact world_info name",
  "resourceFingerprint": "sha256:…",
  "extractionRuleVersion": "explicit-character-heading.v1",
  "candidateSpeakerNames": ["Pippa", "Durik"]
}
```

这与既有 `galgame.speaker-scopes.v1` 分离。候选协议不包含 `releaseVersion` 或 `publishedSpeakerNames`，避免把本地 lorebook 派生值冒充发布名册。拒绝重复 fingerprint、空/重复候选、未验证摘要、schema 多余字段和过长字段。

加载 sidecar 时不得只按 fingerprint 信任其资源声明：replay 必须自行读取对应聊天首行，确认 `chat_metadata.world_info === resourceName`；再在允许的 worldbook 根目录中按该名称解析唯一 JSON 文件、重算其原始字节 SHA-256 并比较 `resourceFingerprint`。聊天路径必须在指定根目录内且拒绝路径组件 symlink；读取首行前后须确认文件对象和版本未变化。缺 header、绑定不符、资源缺失/摘要过期、scope 指向本次 chat 列表之外或同一 chat fingerprint 出现重复 scope 都必须报错并停止该候选回放，不能静默降级或把候选转给其他聊天。同一本 worldbook 可以被多个各自精确绑定它的 chat 独立引用。

### 2. 窄范围可审计抽取

- 只读取聊天首行中的精确 `chat_metadata.world_info`，并在 `data/default-user/worlds` 中匹配同名 JSON 文件；禁止模糊文件名回退、目录名回退或跨 chat 复用全局候选。
- 只从明确的人物标题抽取：`Companion - <name>` 形式的角色条目；以及“方括号实体 ID + 显示名 + em/en dash 分隔的人物章节”形式。第二种只接受 ID 最后一个 `_` 分段与显示名按不区分大小写比较后一致的条目（如 `..._Anna] Anna — ...`）；其他 ID/显示名关系一律忽略。忽略 key 列表、正文、叙述、装备/地点/规则/剧情标题中的普通名字。
- 每个 scope 保存 worldbook 原始字节 SHA-256 和规则版本。空提取结果不产生 scope。
- 不自动抽取别名；只有标题本身明示的规范名进入候选列表。

### 3. 与 replay 的隔离

- CLI 新增可选候选 scope 输入，仅离线诊断使用。
- 候选名只并入 `createStructuralMessageSpeakerIndex` 的名字候选集合；不得传给 `createVisualNovelDisplaySegments`、运行时 cache、UI、场景配置或 `publishedSpeakerNames` 协议。
- evidence/fingerprint 必须包含候选 scope 的资源摘要和规则版本，确保基线与候选回放可区分、可重现。
- 同一次执行先跑无候选的 v78 baseline，再跑候选 scope replay；baseline 的 `verifiedSourceSetDigest` 必须等于冻结摘要。只把 baseline 中 `diagnosticReasonId=no-unique-speaker-evidence` 的 1,309 页作为固定 cohort，并按 `(chatFingerprint, sourceMessageIndex, sourceMessageHash, pageIndex, sourceSpan)` 对齐候选输出。任一 key 缺失/新增或 source span 改变都使 cohort 比较失败；禁止从候选 replay 重新选择“仍未归属”的行以缩小分母。
- 报告各 chat scope 覆盖数、候选名字数、固定 cohort 的迁移矩阵、按规则 ID 的计数及源不变性。报告明确标注 `coverage-only; accuracy=INSUFFICIENT_EVIDENCE`。

## 验收标准

1. 正常与负例测试覆盖 exact worldbook 绑定、sidecar 错挂到另一个 chat、`world_info` 不匹配、缺 worldbook、资源摘要过期、无明确人物标题、重复/空字段、标题 ID 与显示名冲突、重复 chat fingerprint scope、以及同一名字不串用到其他 chat；同一本 worldbook 分别被多个正确绑定的 chat 引用应通过。
2. 候选名不进入 page segmenter、UI、持久化 store 或生产 `publishedSpeakerNames`；无候选时输出与 v78 baseline 完全一致。
3. 基线和候选 replay 使用相同完整消息集合和源摘要；冻结 v78 cohort 的 1,309 行全部精确匹配，比较 key 数没有增删，旧分页 span 不变；两次 replay 均为 `sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。
4. 迁移计数仅作为离线覆盖结果；没有完整逐页人工 gold 时，不声称准确率或将规则提升到生产。
5. 独立 A1 只读审计通过；原版 SillyTavern 冻结路径无改动。

## 风险与停止条件

- 明确标题也可能表示同伴模板而非当前故事已出场成员；候选名不等价于动态队伍或当前场景 roster。
- worldbook 文本和聊天内容均不可信；抽取器不得执行内容或调用模型。
- 如果固定 cohort 的迁移主要来自词面碰撞、没有 source-bound attribution evidence，或只能通过放宽现有证据门槛获得覆盖，则停止该方案，不把它推广为生产规则。
- 缺失世界书或结构不明确的 chat 保持 `scope-unavailable`；不得以用户全局姓名列表填补。

## D/I/A 与文件边界

- D0：仅评估确切绑定资源中显式角色标题产生的离线候选；不改变玩家或产品语义。
- I1：有限新增离线 scope schema、抽取器、replay 参数和对应测试。
- A1：需要审计 source span/pagination 不变、候选名与发布 roster 隔离、无聊天写回，以及多聊天 scope 不串用。
- 允许改动仅限 `frontend/player/tools/speaker-structure-replay.mjs`、`frontend/player/tools/speaker-candidate-scopes.mjs`、`frontend/player/tests/speaker-structure-replay.test.mjs`、`frontend/player/tests/speaker-candidate-scopes.test.mjs` 和本 TaskSpec。
- 禁止改动 `frontend/player/src/**`、`frontend/shared/src/**` 的分页/分段实现、`public/game/**`、`data/default-user/chats/**`、所有 SillyTavern 原版冻结路径及服务运行配置。
