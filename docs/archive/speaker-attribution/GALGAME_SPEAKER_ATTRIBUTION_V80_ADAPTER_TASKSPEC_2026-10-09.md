# V80 TaskSpec：跨剧本候选角色来源适配器

## 用户目标

将 V79 的资源候选名实验改成可按剧本资源结构配置的离线适配层，使新剧本无需修改解析器便可提供候选角色名；适配层不得把候选名误当成已出场人物、已发布名册或说话人结论。

## 范围与硬边界

- 本阶段只扩展离线回放工具和适配配置协议；生产 parser 继续为 `full-message-speaker-index.v78`。
- 不修改玩家运行标题、语义分析、正文、分页/sourceSpan、角色身份、队伍状态、头像背景、聊天数据或 SillyTavern 原版。
- 不调用 LLM/provider。adapter scope 构建/绑定只读聊天首行元数据，不读或输出聊天正文；为了完成既有固定 cohort 离线回放，原 replay 可按现有只读流程读取聊天消息正文，但不得输出正文、写回聊天或改变历史页。
- 候选名字只作为离线结构索引的词面候选输入；唯一归属仍要求现有的句法/发声证据。不得由名字命中直接赋 speaker。因既有索引参数名为 `publishedSpeakerNames`，允许 replay 内部调用传入候选名；这不代表将它们写入已发布 speaker scope、生产 runtime、identity 或视觉绑定。
- 未配置/未支持的资源格式显式显示 `adapter-unavailable`，不得猜测、模糊匹配、扫描叙述正文或跨 chat 共享名字。
- 不改已存在的其他脏文件。SillyTavern 原版冻结边界优先。

## 数据审计依据

- 当前本地有 114 个 worldbook JSON，全部为 `entries` object；874 个条目有 `comment` 和 `key` 字段，没有通用的 `name/title/displayName/type` 顶层字段。
- V79 当前两种显式 heading 仅覆盖 98 个本地 entry（14 个 `Companion - <name>` 与 84 个 ID 后缀等于显示名的角色章节）。这说明任意新剧本不能假设沿用当前标题格式。
- 其余 worldbook comment 前缀混有 BEAT/NPC/Location/Items/摘要/规则等资源类型。禁止把 `comment` 中任意名称都解释成人物。
- 该审计只描述本地资源语料，不声称这些本地格式代表所有玩家剧本。

## 目标协议

输入适配配置使用 `galgame.speaker-candidate-adapters.v1`：

```json
{
  "schemaVersion": "galgame.speaker-candidate-adapters.v1",
  "resources": [{
    "resourceName": "exact chat_metadata.world_info",
    "adapters": [{
      "adapterId": "worldbook.explicit-headings.v1"
    }, {
      "adapterId": "json.typed-entry-fields.v1",
      "entriesPointer": "/entries",
      "namePointers": ["/displayName", "/name"],
      "typePointers": ["/type", "/kind"],
      "acceptedTypes": ["character", "npc", "companion"]
    }]
  }]
}
```

每个构建结果使用 `galgame.speaker-candidate-scopes.v2`，每个 chat scope 保存精确 source binding，以及完整的 adapter 配置、adapter 配置 SHA-256、该 adapter 抽出的名字和去重后的聚合候选名：

```json
{
  "schemaVersion": "galgame.speaker-candidate-scopes.v2",
  "entries": [{
    "chatFingerprint": "sha256:…",
    "resourceName": "exact chat_metadata.world_info",
    "resourceFingerprint": "sha256:…",
    "adapters": [{
      "adapterId": "json.typed-entry-fields.v1",
      "config": {"entriesPointer":"/entries","namePointers":["/displayName","/name"],"typePointers":["/type","/kind"],"acceptedTypes":["character","npc","companion"]},
      "configFingerprint": "sha256:…",
      "candidateSpeakerNames": ["Pippa", "Durik"]
    }],
    "candidateSpeakerNames": ["Pippa", "Durik"]
  }]
}
```

- `resourceName` 精确绑定 SillyTavern chat 首行中的 `chat_metadata.world_info`。每个 replay chat 都有独立 fingerprint scope；同一 worldbook 可分别绑定多个 chat。
- `worldbook.explicit-headings.v1` 兼容 V79 已审计的两个严格 heading 形态，并保持 `comment` 之外不抽取普通正文、key 或条目内容。V79 scope v1 保持独立读取兼容，不重解释其原有 rule version；V80 构建使用新 scope v2。
- `json.typed-entry-fields.v1` 使用 JSON Pointer 读取容器、条目类型和名称；只接受显式类型字段的 allowlist 命中，拒绝只有姓名字段但没有角色类型证据的条目。每个 name pointer 必须指向单个字符串字段，不能指向别名数组或任意文本集合。
- 字段选择器只允许受限 JSON Pointer：长度/深度有上限，只支持 RFC 6901 的字段和数组下标转义，不执行代码、不支持任意表达式、正则、脚本或 prototype 访问。
- 多个 adapter 结果按配置顺序及资源条目顺序做原文精确去重；跨 adapter 名称冲突不合并别名，只保留显示名原文。
- sidecar 记录每个 adapter ID、完整配置、配置摘要、资源原始字节摘要和候选名。V80 回放必须另行提供原始 adapter config 文件；binder 对每个精确资源绑定逐项比较配置指纹，再重读资源、重新抽取并比对。不能只信任 sidecar 自带的 config/hash。聚合名必须与各 adapter 结果的精确去重并集相等。sidecar、独立配置或 source 不匹配时 fail closed。
- 缺少配置或结构不匹配时 scope 不可用；不得静默套用其它剧本的配置。

## 实现方式

1. 在离线候选 scope 模块中新增 adapter config schema 校验、受限 JSON Pointer 读取器、adapter registry 和绑定/抽取证据。
2. 保留 V79 协议读取兼容：V79 sidecar 仍按冻结的显式 heading 规则验证；V80 新输出使用新 schema，不能用 V80 配置改释旧 V79 sidecar。
3. CLI 可接收 `--candidate-adapters-file` 构建 V80 sidecar；重放 V80 sidecar 时也必须独立提供同一配置文件。无该参数时继续按 V79 显式 heading 基线运行；有参数时仅对精确配置的 worldbook 启用对应 adapter 组合。回放 binder 按 sidecar 的 schema version 选择严格对应 validator，不得把 v1 转成 v2 或相反。
4. fixed-cohort comparator 始终锁定 V78 的 1,309 页，完整 replay page keys/source spans 必须不变；报告适配器覆盖、迁移和 rule counts，不得把迁移描述为准确率。
5. 新增合成资源测试，至少覆盖数组与对象容器、不同 JSON Pointer 字段名、类型 allowlist 命中/不命中、缺失路径、无类型字段拒绝、重复名字去重、配置错绑、配置/资源摘要变化、恶意 prototype pointer 拒绝、候选名隔离和分页 span 不变。

## 允许改动文件

- `docs/archive/speaker-attribution/GALGAME_SPEAKER_ATTRIBUTION_V80_ADAPTER_TASKSPEC_2026-10-09.md`
- `frontend/player/tools/speaker-candidate-scopes.mjs`
- `frontend/player/tools/speaker-structure-replay.mjs`
- `frontend/player/tests/speaker-candidate-scopes.test.mjs`
- `frontend/player/tests/speaker-structure-replay.test.mjs`

禁止编辑 `frontend/player/src/**`、`frontend/shared/src/**`、`public/**`、`data/default-user/chats/**`、运行服务配置、所有 SillyTavern 原版源文件，以及任何未列出的工作区脏文件。

## 验收标准

1. Independent A1 audit confirms protocol/data safety, scope isolation and no production-flow changes.
2. Existing V79 replay result remains reproducible when no V80 adapter file is supplied.
3. Generic typed-entry adapter supports different resource schemas using only data configuration, with no scenario-specific character names in code.
4. Candidate names only enter the offline structural index's lexical-name input (which currently uses the parameter name `publishedSpeakerNames`); they never enter the published speaker-scope protocol, segmenter, runtime, UI, storage, identity or visual binding.
5. V78 full-history digest/cohort/page keys remain unchanged; replay reports `sourceUnchanged=true`, `chatWriteback=false`, `externalProviderCalls=0`, and `accuracy=INSUFFICIENT_EVIDENCE`.
6. SillyTavern frozen source and all files outside the allowlist remain untouched by this task.

## D/I/A 与开放限制

- D0：用户已确认沿当前离线适配方向继续泛化；不涉及生产行为。
- I1：新增小型声明式 adapter registry / selector，复用既有 per-chat resource binding 与 replay comparator。
- A1：需审查跨资源绑定、候选/身份分层、source fingerprint、分页不可变和错误配置 fail-closed。
- 当前本地语料不足以证明所有剧本都会提供结构化角色类型字段。无类型字段的任意资源必须显式配置安全 heading adapter 或被拒绝；不得用大范围关键词/正则去兜底。
- 这是可扩展适配框架，不是“所有未知剧本自动识别”的保证。新资源结构仍需一次人工映射到通用协议。
