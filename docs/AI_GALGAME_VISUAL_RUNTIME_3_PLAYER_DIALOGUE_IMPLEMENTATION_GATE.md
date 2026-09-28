# VISUAL-RUNTIME-3 玩家自然对白视觉接线实现准入

> 文档版本：v1.0
> 文档状态：reviewer-passed/done；仅代表本 gate 精确 player 实现已通过独立复核
> 生效日期：2026-09-05
> 上位规格：`docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md`
> 前置阶段：`VISUAL-RUNTIME-2M` reviewer-passed/done（仅 FileVisualAssetStore 迁移子阶段）

## 1. Gate 目的

本 gate 只申请玩家端把已经展示给玩家的自然对白接入现有视觉服务
`POST /v1/core/visual-decisions`。目标是：对白仍由 SillyTavern 原版运行时产生，
视觉服务异步理解当前/最近可见文本，服务端 deterministic scorer 按现有分析标签
返回具体图片或统一占位结果。

本 gate 不代表 RUNTIME-2 整体、生产 analyzer、真实 ST full E2E 或完整视觉系统
完成。RUNTIME-2 仍保持 `partial/blocked`；生产 runtime analyzer 未配置时，真实
运行只能得到 unavailable/placeholder，不能用 fake analyzer 证明生产 AI。

## 2. 允许范围

未来实现只允许修改：

- `frontend/player/**`；
- 必要的 `frontend/shared/**` 纯可见消息/请求适配 helper；若发现必须扩展 shared
  schema 或任何后端合同，立即停止并另提 gate；
- 必要的 player tests；
- 从上述源码重建的 `public/game/**`；
- `docs/**` 与 `.codex-longrun/**` 的规格、状态、日志和证据。

禁止修改：

- `external-modules/visual-asset-service/**`、`game-config-service`、
  `original-runtime-bridge/**`、`frontend/admin/**`、Start 脚本；
- ST backend、`src/**`、原版 `public/**`、`config.yaml`、root dependencies、
  root startup/config；
- manifest/profile auto-binding、Projection/proof/stub、visual-match、ticket、
  binding、receipt、old-save/restore、rollback、VS/VS-CODE/2B/3C、VS-LLM；
- runtime provider 生态、玩家端 LLM、剧情生成、选择、节点、背包、战斗或本地
  scripted story。

## 3. 请求数据边界

1. 玩家端只在一条消息已经渲染到自定义 `/game/` 界面后，复制当前消息的
   `index/role/speaker/text`，并可附带最多 3 条最近已经展示的消息。缺少某类
   显式实体时，可以补一个固定类型名称的中性槽位，槽位不得含自由标签、assetId
   或 score；显式实体优先且同类去重，服务端仍负责最终评分和 placeholder。
2. 文本必须经过现有 shared visible-message helper 的 NFC/长度/字段闭合校验；
   请求使用现有 v2 `visibleContext` 和 projection/source hash 合同，不新增 route。
3. 不得读取或发送完整聊天、未展示消息、角色卡、世界书、隐藏 prompt、context、
   resource body、ST key、provider key、cookie secret 或模型设置。浏览器不得直连
   analyzer/provider。
4. 视觉服务地址只能来自现有受控 player 配置/profile 读取结果；不得让玩家填写
   URL、token、model 或任意技术字段。
5. client 不得传入 assetId、score、catalog mutation、binding、save 或玩法状态，
   也不得把 provider 返回值重新解释为剧情。

## 4. 玩家生命周期与非阻塞语义

- 当前对白先正常显示；视觉请求在渲染后异步发出，不能阻塞原版聊天、输入、
  Generate、历史、save/load 或 stage 保留。
- 请求开始时不清除上一张已验证的视觉图；若服务返回 `ambiguous` 且没有任何
  可接受候选，视为普通对白没有新的视觉意图并保留当前展示。若返回低分/无候选
  的 `ready`、`unavailable`、`failed` 或完整性/content 失败，则切换到统一占位图。
- 同一可见消息/视觉上下文的失败可以使用既有 availability cache 避免重复请求；
  服务地址、release/scenario/version/Arc/profile/catalog 上下文变化时必须允许
  新请求。不得实现无限重试或复杂后台队列。
- 请求进行中不得覆盖已显示的对白。成功只更新 presentation layer：scene 背景、
  character 透明立绘、equipment/item/skill 图标。
- 服务返回 unavailable/ambiguous/failed、无 profile/catalog、低分、无候选、
  content 失败或网络异常时，立即保留对白并显示统一 placeholder/default；不得
  猜图、补剧情、复制资源或把 unknown 当具体素材。
- 视觉失败可恢复，后续有效上下文可重新请求；恢复动作不得重读隐藏聊天或改写
  ST chat/save。

## 5. 决策与展示门槛

- 复用现有 `galgame.visual-core-visual-decisions-request.v2` 与 response 合同。
- 服务端负责运行时 LLM hint 和 deterministic scorer；玩家端只消费已校验 decision。
- 仅当服务端 decision `score >= 60` 且 provenance/content/hash/schema 全部有效时，
  才显示具体图。`score < 60`、冲突、分析不可用、低置信度或任一完整性失败均
  显示统一 placeholder。
- 统一占位资源固定为 player 自有 `./assets/visual-placeholder.svg`；scene 背景、
  character 立绘以及 equipment/item/skill 五类展示在回退时都消费同一资源，不能
  使用 manifest 默认背景、标题立绘或 `?` 空框替代。
- 玩家端不能提高分数、绕过 unknown、选择任意 assetId 或将失败结果变成具体图。
- 原版对白文本与视觉标签是展示输入，不是剧情状态；视觉结果不写入 save、chat、
  manifest、profile、binding 或任何 ST 资源。

## 6. 验收矩阵

实现 gate 通过前必须提供可复现证据，且分别标注 test-only 与 production reality：

| 类别 | 必须证明 |
| --- | --- |
| 当前/最近文本 | 只有已渲染 current/recent visible messages 进入请求；隐藏聊天、prompt、resource body 和 ST key 不出现在请求 |
| 非阻塞 | 视觉服务慢、超时或失败时对白、输入、Generate、聊天和 save/load 仍可用 |
| 具体展示 | 五类 decision 在 `score >= 60` 且 provenance/hash/content 合法时分别更新正确 presentation slot |
| 低分/无证据 | `<60`、ready 无候选、source/profile/catalog mismatch 均为统一 placeholder；无新候选的 `ambiguous` 普通对白保留已验证展示 |
| 服务失败 | unavailable/timeout/network/content failure 保留对白并缓存当前不可用状态；上下文改变后可恢复请求 |
| provider 边界 | 浏览器无 provider 请求、Authorization/token/key；运行时 provider 仅由视觉服务 server-side 配置读取 |
| 页面回归 | 桌面/移动无横向溢出，玩家无技术字段；原版聊天/输入/Generate/save/load 不受视觉请求影响 |
| 真实条件 | 无 analyzer 时明确记录 unavailable；fake/injected analyzer 只能作为 test-only exact-overlap 证据，不能宣称生产 AI |

若当前 manifest/profile/catalog 尚未提供有效视觉上下文，必须记录为 external
blocker 或返回默认层；不得修改 game-config-service、manifest writer 或恢复旧的
profile auto-binding 解决它。

## 7. 安全与冻结边界

- 不读取 ST key、原版配置密钥、角色卡、世界书、隐藏聊天或完整 context。
- 不调用玩家运行时 LLM；视觉服务的独立 analyzer/runtime provider 只处理受限可见
  文本或已安全解码的图片，浏览器不直连 provider。
- 不使用 test-double、local scripted story、手工 bundle 或 DOM 名称猜测冒充真实
  visual decision。
- 不恢复 VS/Projection/proof/stub/visual-match/ticket/binding/receipt/old-save/
  restore/rollback/VS-LLM，也不新增任何后端 route 或 shared schema，除非另行获得
  implementation gate。
- 任意失败应 fail-closed 到 placeholder/default，并保留原版运行上下文和恢复入口。

## 8. 停止条件

1. 发现需要 visual service、game-config、ST/backend、manifest/profile writer 或
   shared 新协议：立即停在 blocker，不在本 gate 越界修改。
2. 生产 analyzer 未配置：可以运行 no-analyzer fallback，但不得把 test-only
   analyzer 结果标作生产通过。
3. 真实 ST story/Generate 不可用：记录真实 blocker，不用本地剧情、fixture chat
   或 test-double 替代。
4. 同一问题两次失败后先做根因审计；运行条件无变化时不得重复生成同类证据。
5. 本 gate 已获独立 reviewer PASS 并标记 done；不代表 RUNTIME-2、生产 analyzer、
   真实 ST full E2E 或整个视觉模块完成。RUNTIME-4 仅进入独立的 docs-only readiness/admission
   preparation，未经新准入不得实现或激活 provider。

## 9. 当前状态

`VISUAL-RUNTIME-2M` 已 reviewer-passed/done，仅表示 FileVisualAssetStore v1→v2
迁移子阶段完成。RUNTIME-2 仍 `partial/blocked`，生产 analyzer 未配置；本 gate
已通过独立复核并进入 `implementation verifying`。当前只允许按上述精确 allowlist
完成 player 自然对白接线、neutral slot 和 focused verification；完成后仍须独立审计，
不能进入 RUNTIME-4，也不能标记 RUNTIME-2 或整个视觉模块完成。
