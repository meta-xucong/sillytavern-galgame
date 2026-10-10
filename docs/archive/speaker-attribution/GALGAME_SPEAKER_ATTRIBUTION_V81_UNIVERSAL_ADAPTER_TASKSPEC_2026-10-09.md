# V81 TaskSpec：跨剧本候选来源统一适配

## 目标

将 V80 的“世界书候选适配”提升为**来源无关的候选名输入框架**。新剧本的候选资源格式可以用受限声明式映射接入；已有标题归属算法、正文和运行行为不变。这里的“适配所有剧本”指任何能明确声明资源来源和字段含义的剧本都可走同一协议，不承诺从任意自由文本或未知二进制资源中零配置推断角色名。

## 基线与调查结论

- 当前实现仅读取聊天头精确绑定的 `chat_metadata.world_info`，支持严格标题 adapter 和 JSON typed-entry adapter；因此它只覆盖世界书这一类来源。
- 本机 158 个历史聊天中 156 个首记录包含 `character_name`、`user_name`、`chat_metadata`，但聊天头并不提供完整 NPC/队伍名册。
- SillyTavern 角色卡 PNG 可为 Card V2/V3，规范化后的主体名位于顶层 `name` / `data.name`。角色卡未定义跨剧本通用的 NPC 别名或角色 roster 字段。
- 本机当前 96 个不同聊天目录都能由目录 key 找到对应角色卡文件；将卡片 identity 与聊天头 `character_name` 精确比较时，158 个聊天中 116 个匹配、42 个不匹配。后者按 fail-closed 不提供卡片候选；不能声称覆盖全部既有聊天。
- 角色卡与世界书里的名字只能提供“可识别词汇”。它们不是该人物已经登场、当前在场、正在发言的证据。
- V80 固定 unresolved 对照 cohort 是 1,309 页；V80 全历史回放是 158 chats、955 messages、18,696 pages。两者分别报告，不得混称。固定源摘要 `sha256:3cd35138de9729080525259936cb95376ee662b59691f917d4903a7bd47bd6bd`，固定 cohort 成员及页跨度摘要 `sha256:87da8450dada84378ea5dc405834fd4b1144d27152ae5df360a4b0f02c754d00`。新适配层回放需保持全量 replay 的页键和 source spans 不变，并校验这两个固定摘要后，单独比较 1,309 页固定 cohort。

## 范围和不变量

- 仅离线 candidate-scope/replay 工具、测试和本 TaskSpec；不改生产 parser/cache、标题投影、语义分析、正文、分页/sourceSpan、UI、视觉链或存档。
- SillyTavern 原版源冻结；只读检查可用原生数据契约，不得导入/复制原版代码到自定义运行路径。
- 不调用 LLM/provider，不写回聊天数据，不将候选写入 production speaker roster、identity、角色队伍状态或头像绑定。
- 现有 v1/v2 sidecar 保持严格兼容；无 V81 配置时 V79/V80 回放结果不得改变。
- 名字候选不能单独生成归属。Speaker decision 仍完全使用冻结的 V78 结构归属器和原有证据门；无唯一证据继续原 fallback。
- 原始正文分页必须完全独立。任何测试若发现 page keys、page count、source spans 或分页器冻结 slice 变化，直接失败。

## 统一模型

把“资源怎么读取”和“字段怎么提取”拆成两个阶段：

1. **Source binding adapter**：将某个资源精确绑定到一个 chat fingerprint。第一批只实现两个稳定绑定：
   - `chat_metadata.world_info` 精确资源名 → SillyTavern worldbook；
   - 当前 chat 的精确角色卡：聊天相对路径必须恰为 `<cardKey>/<chatFile>.jsonl` 两段；`cardKey` 与 `chatFile` 必须各为单个安全 basename。只从固定 `charactersRoot/<cardKey>.png` 读取，不扫描其它目录；拒绝 `.`/`..`、路径分隔符、嵌套/绝对路径、符号链接、非 regular file 和越界 realpath。读取后要求 card identity 与聊天头 `character_name` 精确一致；缺失、不一致或互相冲突的重复元数据 fail closed。内容完全相同的重复元数据 chunk 允许读取并只处理一次。Group chat/非两段路径/无一对一卡片绑定时不猜成员名单。当前精确 identity 校验只为 116/158 个历史聊天提供角色卡候选，其余 42 个记为 unavailable。
2. **Payload decoder**：将资源解成 JSON 对象。初期支持 worldbook JSON、SillyTavern Card V2/V3 PNG text chunk。PNG decoder 只读取明确允许的 `chara`/`ccv3` 元数据，不读取图像/描述文本作为候选；依赖现有 PNG parsing dependency，不改 package manifest。每 chunk 校验剩余长度后才处理，见“PNG 解码安全合同”。
3. **Candidate extractor registry**：对解出的 JSON 用版本化 adapter 提取词面候选：
   - 现有 `worldbook.explicit-headings.v1`；
   - 现有 `json.typed-entry-fields.v1`；
   - 新增 `character-card.canonical-name.v1`，只在 Card V2/V3 identity 校验成功时提取标准主体名；
   - 新增通用 `json.declared-name-fields.v1`，通过受限 JSON Pointer 指定确切字段，可支持单值及显式 string-array alias 字段；是否按角色候选读取还须由配置中的类型 allowlist 或 `sourceKind=character-roster` 明示。不得从任意 description/text/comment/key 字段扫描姓名。
4. **Evidence envelope**：每份候选记录带 chat fingerprint、source kind/id、source content hash、adapter id/config hash、候选原文与来源字段路径。候选按精确 Unicode 字符串去重；别名不自动合并到 canonical identity。

### PNG 解码安全合同

- PNG 文件上限 32 MiB，单 chunk 上限 16 MiB；解析 chunk 前先用整数溢出安全方式验证 declared length 不大于剩余文件长度、chunk framing 正确，并验证每个 chunk CRC；必须存在且仅有一个有效 IEND，IEND 后不得有尾随字节。不得使用未先校验 chunk length 的预分配解析路径。
- 只支持 PNG 标准 `tEXt` chunk；只处理 keyword 精确为 `chara` 或 `ccv3` 的记录。识别到的元数据总解码结果上限 8 MiB；其它 chunk 跳过但仍验证长度边界。
- base64 必须符合严格 alphabet/padding，解码后重新编码与输入等价；JSON 必须是 object。每个 keyword 多次出现时 payload 必须相同，否则报 `CARD_METADATA_DUPLICATE_CONFLICT`。
- 同时存在 `chara` 与 `ccv3` 时允许双份。两份 identity 必须精确一致，否则报 `CARD_METADATA_IDENTITY_CONFLICT`；一致时 V81 固定优先选用 `ccv3`，这是本 adapter 的确定性规则，不声称来自酒馆读取优先级。只接受以下 `(spec, spec_version)`：`(chara_card_v2, 2.0)`、`(chara_card_v3, 3.0)`；V2 `chara` payload 若历史格式缺少 spec 字段，仅在 `data.name` 存在且根没有 `spec_version` 时视为 V2 legacy。V3 `ccv3` 必须为 V3 组合。identity 只接受顶层 `name` 与 `data.name` 中的非空字符串；两者都存在时必须精确一致。缺少 identity 或规范版本非法则拒绝。

PNG fixture 必须覆盖截断 length、声明长度超过剩余 bytes、超限文件/chunk、错误 CRC、缺失/重复 IEND、非法 base64/JSON、同 keyword 相同 payload 重复（接受并去重）、同 keyword 不同 payload 重复（拒绝）、V2/V3 identity 冲突，以及合法双 chunk 同 identity。

## 声明式配置要求

新增输入配置 `galgame.speaker-candidate-adapters.v2` 和独立输出侧车 `galgame.speaker-candidate-scopes.v3`。V80 adapters.v1 只能构建/绑定 scopes.v2；V81 adapters.v2 只能构建/绑定 scopes.v3；禁止自动升级、降级或混搭。V79 scopes.v1、V80 scopes.v2 的 validator 和行为保持冻结。

V3 输出的严格顶层形状：

```json
{
  "schemaVersion": "galgame.speaker-candidate-scopes.v3",
  "entries": [{
    "chatFingerprint": "sha256:…",
    "sources": [{
      "sourceId": "current-character-card",
      "sourceType": "sillytavern.character-card-png.v1",
      "binding": { "kind": "chat-character-card", "resourceName": "cardKey.png" },
      "resourceFingerprint": "sha256:…",
      "sourceConfigFingerprint": "sha256:…",
      "adapters": [{
        "adapterId": "character-card.canonical-name.v1",
        "config": {},
        "configFingerprint": "sha256:…",
        "candidates": [{ "name": "…", "fieldPointer": "/data/name" }]
      }]
    }],
    "unavailableSources": [{
      "sourceId": "current-character-card",
      "sourceConfigFingerprint": "sha256:…",
      "reasonCode": "CARD_IDENTITY_MISMATCH"
    }]
  }]
}
```

V3 validator enforces source/config exact keys, per-chat unique `sourceId` and resource binding, valid hashes/pointers, bounded candidate counts, and each candidate's source field path. `unavailableSources` is a bounded array of `{sourceId,sourceConfigFingerprint,reasonCode}`; reason codes are restricted to `SOURCE_BINDING_UNAVAILABLE`, `SOURCE_RESOURCE_UNAVAILABLE`, `SOURCE_RESOURCE_INVALID`, `CARD_IDENTITY_MISMATCH`, and `CARD_PATH_UNSUPPORTED`. Replay separately receives adapters.v2, recomputes normalized config fingerprints, re-reads resources and re-extracts candidates; a sidecar cannot self-authorize its config or result. Missing/unknown source is reported as unavailable, not an invented empty roster.

配置必须明确每个资源的 source type、精确绑定规则、名字字段映射及必要的类型 allowlist。每个 chat 独立解析，禁止全局候选词表跨剧本或跨聊天共享。未知 source type/字段结构须报告 `adapter-unavailable` 并继续原始回放，不猜。

示意结构：

```json
{
  "schemaVersion": "galgame.speaker-candidate-adapters.v2",
  "resources": [{
    "sourceId": "campaign-world-roster",
    "sourceType": "sillytavern.worldbook-json.v1",
    "binding": { "kind": "chat-header-pointer", "pointer": "/chat_metadata/world_info" },
    "resourceRoot": "worlds",
    "resourceNames": ["Campaign Worldbook"],
    "adapters": [{ "adapterId": "json.typed-entry-fields.v1", "entriesPointer": "/entries", "namePointers": ["/name"], "typePointers": ["/type"], "acceptedTypes": ["npc", "character"] }]
  }, {
    "sourceId": "current-character-card",
    "sourceType": "sillytavern.character-card-png.v1",
    "binding": { "kind": "chat-character-card" },
    "resourceRoot": "characters",
    "adapters": [{ "adapterId": "character-card.canonical-name.v1" }]
  }]
}
```

`resourceRoot` 不是配置中的任意路径。CLI 只允许将 `sillytavern.worldbook-json.v1` 固定映射到 `--worldbook-root`，将 `sillytavern.character-card-png.v1` 固定映射到 `--character-root`；配置中的 `resourceRoot` 只能是对应枚举值 `worldbooks` 或 `characters`，不接受绝对路径、相对路径或用户路径拼接。覆盖 root 参数仅供本地离线测试指定 sandbox fixture。

真实协议须拒绝未知字段、危险路径、路径越界、符号链接、重复资源绑定、角色卡名不一致、错误 source hash/config hash 和错误 chat fingerprint。V1/V2 adapter 配置不得被各自输出侧车自证；回放必须单独提供对应版本的原始配置，再重抽取并逐字段比较。V79 scopes.v1 无 adapter config；V80 scopes.v2 继续单独要求 adapters.v1 config；V81 scopes.v3 只要求 adapters.v2。没有 V81 配置不能改变任一旧版本行为。

## 跨剧本适配约定

- **已有统一字段**：管理员/离线操作者提供一次 JSON Pointer 映射，即可复用通用 extractor；之后同一 schema 的所有剧本无需新增识别器规则。
- **不同字段布局**：每个新 schema 提供一份数据配置，不新增解析代码。worldbook config 的精确 `resourceNames` allowlist 可让多个脚本各自绑定不同字段布局；当前 chat 指向不在 allowlist 的资源时，该 adapter 不参与此 chat，也不会把一套字段规则误套到另一剧本。
- **不同文件/二进制编码**：只需增加一个受限 source decoder，candidate extractor 和 speaker attribution 算法不变；未知格式不可通过宽泛文本扫描代替 decoder。
- **完全自由文本世界书**：若无稳定字段/标题语义，不能保证安全自动提名；必须人工指定可作为 roster 的字段/heading，或该资源保持不可用。
- **首次出场角色**：不要求候选名册提前覆盖。沿用标题归属器对局部署名/引语/动作线索的处理；新姓名是否能进入标题与候选 source coverage 是两回事。adapter 不能把新角色的身份写入持久 roster。
- **玩家与当前卡片角色**：`user_name` 和 `character_name` 保持两个独立来源，不得互相改名/合并。玩家名是否可作展示 speaker 候选沿用现有用户标注规则，不借 character-card adapter 推断。

## 实施文件白名单

- `docs/archive/speaker-attribution/GALGAME_SPEAKER_ATTRIBUTION_V81_UNIVERSAL_ADAPTER_TASKSPEC_2026-10-09.md`
- `frontend/player/tools/speaker-candidate-scopes.mjs`
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-candidate-scopes.test.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`

不得修改其他已有脏文件。若需要新增文件，先更新本白名单并重新独立审计 TaskSpec。

## 验收

1. 独立只读 A1 audit 对冻结 TaskSpec/实现 PASS；分页冻结和原版 source freeze 均无违反。
2. V79/V80 scopes.v1/v2 无新参数路径的旧 fixtures 和回放完全一致；V3 只由 adapters.v2 构建，并拒绝版本混搭。
3. V81 可用合成 fixture 验证：Card V2/V3 PNG name、worldbook 两种布局、JSON object/array roster、单值/别名数组、同名/重名资源、资源缺失、card identity 不一致、config/source/chat hash 变化及安全路径拒绝。
4. 至少两个结构明显不同的合成剧本仅通过配置映射得到候选；不得在实现中硬编码剧本名或角色名。
5. candidates 只喂给 offline V78 lexical candidate input；不得改变 speaker evidence rank/decision、production code、标题、文本、分页或身份状态。
6. 同时报告全量 replay 158 chats / 955 messages / 18,696 pages 和固定 unresolved cohort 1,309 pages。固定 cohort 必须匹配成员及页跨度摘要 `sha256:87da8450dada84378ea5dc405834fd4b1144d27152ae5df360a4b0f02c754d00`，不能只靠数量相等。`sourceUnchanged=true`、`chatWriteback=false`、`externalProviderCalls=0`。报告适配覆盖和分桶变化，`accuracy=INSUFFICIENT_EVIDENCE`，除非有独立逐页 gold。
7. `git diff --check` 和既有 candidate-scope/replay 测试通过。平台不支持的 symlink 场景可显式 skip，其他安全用例必须执行。

## 风险与边界

- “所有剧本”无法由一个正则或任意文本扫描保证。统一能力是固定的 source-binding/decoder/extractor 协议；新数据 schema 的字段映射需要一次声明。未知编码仍需新增受限 decoder。
- SillyTavern 原生角色卡不提供通用 NPC roster；它只补当前聊天角色卡主体候选。大部分 NPC 候选覆盖取决于聊天实际绑定的世界书/明确 roster 数据。
- 候选覆盖变高不等于 speaker accuracy 提高。每轮报告必须分别列 source coverage、candidate count、attributed/fallback migration、gold accuracy。
- 任何回放增量都必须与同一固定输入摘要比较，不得拿不同时间增长的聊天集合做准确率对比。

## 冻结路由与风险分类

- D0：目标是复用候选来源适配协议，而不是承诺零配置识别；原版数据格式和用户边界明确。
- I2：需要跨 source binding、PNG decoder、JSON adapters 与 sidecar compatibility 保持一致；失败分支必须 fail closed。
- A1：核对多来源精确绑定、内容/配置指纹、旧 sidecar 兼容、候选与身份分层、分页不变及原版源冻结。
