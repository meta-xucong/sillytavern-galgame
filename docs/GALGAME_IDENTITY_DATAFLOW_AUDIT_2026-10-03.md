# Galgame 身份信息数据链审计

> 日期：2026-10-03 <br>
> 类型：源码静态审计与责任归属；**未修改实现代码、未运行生成或改写聊天**。 <br>
> 结论：目前有证据的问题位于 Galgame 上层运行桥、适配器和 schema；没有证据表明这是 SillyTavern 原版缺陷。此问题必须作为独立的身份数据传输/解析工作流处理，不能并入“头像匹配不准”一项。

## 1. 先区分三种不同身份

1. **原版消息作者（message author）**：SillyTavern 聊天消息原生提供的作者/角色标签，例如 `name`、`is_user`。它能说明是谁以该消息作者身份发了这条消息。
2. **正文片段说话人（segment speaker）**：一条消息正文里一段对白实际是谁说的。普通聊天记录不必然包含这类结构化标注；`name` 不能证明正文中每句对白都由同一角色说出。
3. **Galgame 稳定角色身份（character identity）**：上层将作者/片段关联到场景角色及其资源所需的 ID。它必须来自可验证的原版角色引用或带原文证据的上层投影；不能凭当前选中角色、数组下标或名字猜测。

原版负责保存与处理原版聊天、角色资源和生成语义。它不承诺替 Galgame 为正文中的所有台词推断 segment speaker，也不承诺在每条历史消息内附带本项目自创的稳定 `characterIdentity` 字段。因此，原始聊天没有该自定义字段本身不构成 SillyTavern 故障。

## 2. 当前调用链及确认的上层缺陷

### 2.1 运行桥造出临时身份，却按当前选择角色标记历史消息

`external-modules/original-runtime-bridge/server.mjs` 中 `resolveCharacterIdentity()` 从当前 `SillyTavern.getContext()` 读取 `characterId`，优先用 `characters[characterId]` 作为消息身份；只有没有 active character 时才按消息 `name` 查找。随后 `snapshot()` 把这个结果加到桥接响应的 `messages[]`，但保留 `rawChat` 不变。

这有两个结论：

- `characterIdentity` 是我们上层临时派生的桥接元数据，不是原版聊天字段；不把它写回 `rawChat` 是正确的，能保护原版聊天权威。
- 当前身份解析对历史消息不安全：若 active character 存在，历史中每条非玩家消息都可能被标成当前角色，哪怕原始 `message.name` 不同。活动角色下标也不是可持久、跨目录稳定的身份 ID。身份源头因此可能已错，不能只修后续传参。

### 2.2 共享适配器丢弃桥接已归一化的 messages

`frontend/shared/src/sillytavern-adapter.js` 的 `generateReply()` 收到 `data.rawChat` 后执行 `normalizeOriginalChatMessages(rawChat)`，没有消费桥接响应中的 `data.messages`。因为 `rawChat` 没有被写入临时 `characterIdentity`，桥接阶段已经生成的身份信息就在这里丢失。

这属于上层协议/适配器集成问题，不是原版 API 漏传原生字段：自定义桥接响应已经尝试附加字段，但调用方没有沿该协议读取它。

### 2.3 可见消息归一化只会从 rawChat 读取这个自定义字段

`normalizeOriginalVisibleChatMessages()` 会复制 `message.characterIdentity`，但输入是原版 `rawChat` 时通常没有该属性；因此它不能恢复上一步丢掉的桥接 envelope 身份。

之后 `normalizeOriginalChatMessages()` 又显式组装新对象，只选取 `id/speaker/role/text/displayText/suggestedActions/sentAt`，没有复制 `characterIdentity`。即使前一层收到了身份字段，这个返回 DTO 也会再次丢字段。

### 2.4 schema 对 optional 字段的新增实现仍拒绝该字段

`frontend/shared/src/visual-system-schema.js` 当前把 `characterIdentity` 加进允许字段并试图输出它，但仍保留：

```js
keys.join('\u0000') !== ['index', 'role', 'speaker', 'text'].sort().join('\u0000')
```

这要求字段集合恰好等于原先四个字段；加入 `characterIdentity` 后条件为真，整条消息返回 `null`。这是明确的上层 schema 逻辑矛盾。即使适配器传输修好，该检查仍会阻断身份消息。

## 3. 责任判定

| 现象 | 责任层 | 判定 |
|---|---|---|
| SillyTavern 原始消息只有作者标签，没有每段对白的角色实体 ID | 原版数据模型的正常边界 | 不是已证实的原版 bug。上层不能把未提供的数据假装成原版稳定身份。 |
| 桥接临时生成 `characterIdentity` | 自定义 runtime bridge | 上层扩展；当前解析方法可能把 active character 错套到所有历史消息。 |
| 桥接响应有身份但 shared adapter 改读 `rawChat` | 自定义协议/适配器 | 明确的上层传参不全/响应字段被丢弃。 |
| visible normalizer 有复制，另一 normalizer 又漏复制 | 自定义 DTO 映射 | 明确的上层字段遗漏。 |
| schema 允许字段但用精确四键条件拒绝扩展字段 | 自定义 schema | 明确的上层校验 bug。 |
| “标题人物头像显示错/人物头像没接上” | 下游呈现与资产选择 | 是身份数据问题的一种表现，但根因不能仅归为视觉 matcher；先验证身份源头和逐层传递，再审查角色/asset 匹配。 |

因此，对当前“身份信息丢失”的明确回答是：**不是发现 SillyTavern 原版把身份字段漏掉；目前确认的是我们上层新增的身份元数据在生成、传递和 schema 校验链中存在缺陷，且桥接端的身份推导也可能错误。**

## 4. 单独处理建议：身份协议先于视觉匹配

下一阶段应将身份链分成两个独立任务，顺序不可颠倒：

### A. 身份来源与传输合同（非视觉任务，先做）

1. 版本化定义 `messageAuthor`、`segmentSpeaker`、`characterIdentity` 三类字段及各自来源。旧原版消息作者元数据保留原值；正文 speaker 可以 unknown；不得把 message author 自动提升为正文内每句台词的 speaker。
2. 对身份的关联必须证明消息范围。不得把当前选中的角色 ID 赋给整段历史；不得使用角色数组 index 作为持久 ID。没有可靠的原版角色引用/名称对应证据时返回 unknown。
3. 桥接侧的临时投影和 `rawChat` 分开传输。适配器需消费版本化 bridge envelope，并通过 chat ID、原始消息 index/作者、原文 hash 等锚定到同一条消息；无法一一对齐则丢弃投影身份，不丢弃原文消息。
4. 逐个审计每次对象重建：`snapshot.messages` → bridge response → `generateReply()` → `normalizeOriginalVisibleChatMessages()` → `normalizeOriginalChatMessages()` → player snapshot/context → presentation projection。任何映射须显式保留经验证的字段或明确剥离理由。
5. schema 对 optional 字段采用“必需字段完整 + 未知字段拒绝 + optional 字段按类型严格验证”，不得用固定键集合的精确相等误拒 optional 字段，也不得无验证地透传任意对象。
6. identity envelope 只作为上层只读派生数据，不写回原版聊天。针对不同角色聊天、群聊、当前角色切换、历史消息、缺失作者、同名角色、编辑/swipe/分支变更做契约测试。

### B. 说话人语义与视觉资产匹配（后做，继续 shadow）

身份传输正确不代表正文 speaker 识别正确，也不代表图片一定有唯一候选。只有 A 通过后，才评估带原文 span/hash 的 segment annotation、跨页延续和实体映射；生产 gate 仍需语言/整剧本留出集通过。视觉 matcher 再消费可信实体选择活动 catalog 中已校验的资源。三层必须分别报告准确率与失败原因，不得把字段传输错误归因于模型识别，更不得为掩盖丢字段而堆叠剧情专属正则。

## 5. 修复验收标准

- 原版 raw chat 在测试前后字节/结构不因身份投影而变；不写入 `characterIdentity`。
- 对指定桥接消息能证明 envelope 与确切 chat/message 对应；跨 chat、同名、切换当前角色等情形不会错绑。
- 字段从桥接返回到玩家消费 DTO 全程可跟踪；每个 schema 对合法 optional identity 接受、畸形 identity 拒绝，并保留原文显示。
- `messageAuthor`、`segmentSpeaker`、`characterIdentity` 各自可为空/unknown，不互相覆盖；unknown 不等于旁白。
- 先通过 identity transport contract，再单独评估 annotation 和 visual matching。只通过头像渲染 happy path 不算身份链验收。

**当前状态：** 上述是审计定位和修复合同。本文不代表代码已修复、测试已运行或生产身份 gate 已开放。
