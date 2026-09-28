# VISUAL-RUNTIME-4 验收脚本兼容性门

> 目的：防止历史 VS-CODE-3C 验收脚本被误当成当前 RUNTIME-4 真实证据。
>
> 当前结论：现有 `frontend/tools/visual-real-st-final-acceptance-smoke.mjs` 仍出现 VS-CODE-3C、visual-bundle、binding 和 ticket 语义，只能作为历史或预检工具。当前 v2 浏览器链路使用 `frontend/tools/visual-runtime-4-browser-smoke.mjs`；该工具只验证 test-only service fixture，不替代真实 ST/Provider 验收。

## 1. 为什么必须单独设门

当前 RUNTIME-4 的目标链路是：

~~~~text
真实 ST 可见对白
  -> player visibleContext
  -> POST /v1/core/visual-decisions v2
  -> visual-asset-service server analyzer
  -> runtime hint
  -> deterministic scorer
  -> matched 或 common placeholder
~~~~

历史 VS-CODE-3C 链路使用 projection、proof、binding、ticket、visual-bundle 或旧 match route。两条链的协议、证据和完成定义不同。

旧脚本即使 exit 0，也不能证明：

- 当前 v2 request 已被发送。
- visibleContext 是当前对白来源。
- Provider 是由服务端调用。
- score >= 60 的 v2 decision 被展示。
- v2 placeholder/failure 行为正确。
- 当前 manifest/Arc visualPresentation 生效。
- 浏览器没有隐藏 Provider 或 ST 凭据。

## 2. 需要审计的现有脚本

历史脚本：

~~~~text
frontend/tools/visual-real-st-final-acceptance-smoke.mjs
~~~~

当前 v2 本地浏览器 smoke：

~~~~text
frontend/tools/visual-runtime-4-browser-smoke.mjs
~~~~

已观察到的旧痕迹：

- VS-CODE-3C real final acceptance 字样。
- visual-bundle route。
- matchResults、bindings、assetReadTickets 字段。
- bundle count、ticket count 和旧内容读取校验。
- visual type proof 和历史 target chat 证明逻辑。
- generate-used 保持 fail-closed 的旧门禁。

这些痕迹必须逐项判断是历史兼容代码、预检代码，还是当前 RUNTIME-4 必须替换的实现。

## 3. H0：源码静态审计

在不修改文件的情况下执行：

~~~~cmd
cd /d D:\AI\SillyTavern
findstr /N /I /C:"VS-CODE-3C" /C:"visual-bundle" /C:"matchResults" /C:"assetReadTickets" /C:"bindingId" /C:"projection" /C:"proof" /C:"ticket" /C:"old-save" frontend\tools\visual-real-st-final-acceptance-smoke.mjs
findstr /S /N /I /C:"visual-core-visual-decisions-request.v2" /C:"/v1/core/visual-decisions" /C:"visibleContext" /C:"understandingStatus" /C:"RUNTIME_SCHEMA_INVALID" /C:"placeholder" frontend\ external-modules\
~~~~

记录：

- 命中行号和命中内容类别。
- 每个命中是否属于当前 RUNTIME-4、历史兼容或测试替身。
- 当前脚本实际请求的 route。
- 当前脚本实际构造的 request keys。
- 当前脚本实际读取的 response keys。
- evidence JSON 的 schemaVersion 和 mode。

H0 的输出必须是审计报告，不得通过删除关键词来制造“无命中”。

## 4. H1：输入边界检查

当前 RUNTIME-4 harness 必须只读取：

- 当前 active release。
- 当前 manifest 和 Arc 的 visualPresentation/profile。
- 真实 target chat readback 的可见消息。
- current message 的 index、role、speaker、text。
- 最多三条 recent visible messages。
- 服务端提供的 catalog/profile identity。

禁止读取：

- ST key 或 Provider token。
- 角色卡正文、世界书正文、隐藏 prompt。
- 原始完整 chat object。
- 未显示给玩家的历史消息。
- 浏览器 localStorage 中的凭据。
- 旧 Projection/proof/ticket/binding/old-save DTO。

H1 放行条件：

- harness 的 visibleContext 可由 DOM 已渲染文本或 target chat readback 逐项解释。
- request body exact keys 与当前 v2 合同一致。
- request body 不含 assetId、score、catalog mutation 或玩法状态。

## 5. H2：请求路线检查

必须证明浏览器或玩家适配器实际进入当前 v2 surface：

~~~~text
POST /v1/core/visual-decisions
schemaVersion = galgame.visual-core-visual-decisions-request.v2
visibleContext.current
visibleContext.recent
~~~~

必须证明：

- visual-asset-service 服务端而非浏览器调用 Provider。
- 浏览器请求没有 Provider URL。
- 浏览器请求没有 Authorization、x-api-key 或 ST key。
- route response 使用当前 v2 decision response 或合法 v1 error response。
- response 中 usesLlm 是服务端生成字段。
- understandingStatus、errorCode 和 decisions 满足当前枚举。
- 失败 response 仍给 placeholder decision，不伪造 matched。

发现 visual-bundle、assetReadTickets、bindingId 或旧 ticket 作为当前主断言时，H2 fail。

## 6. H3：响应和展示检查

当前 harness 必须记录：

- response schemaVersion。
- requestId、projectionId 和 source message hash 的摘要。
- understandingStatus。
- errorCode。
- decision 数量。
- 每个 decision 的 entityType、scoreBand、score、assetId 是否为空。
- 最终展示是 concrete asset 还是 common placeholder。
- 图片 content read 的 route 和状态。
- 当前对白是否已经先于视觉请求显示。

当前 harness 不得要求：

- 历史 bundle 五类 binding 数量。
- 历史 ticket 数量。
- projection proof 或 restore proof。
- 旧 match result 结构。
- 旧 upload order 或 binding order。

## 7. H4：失败路径检查

至少覆盖：

| 场景 | 预期 |
| --- | --- |
| Provider 未配置 | 对白正常，understandingStatus=unavailable，placeholder |
| Provider 超时 | 对白正常，understandingStatus=failed，placeholder 或保留规则 |
| Provider 2xx schema invalid | ready 不成立，固定 errorCode，placeholder |
| dictionary mismatch | 不产生候选，placeholder |
| score 59 | placeholder |
| score 60 | matched |
| 新对白覆盖旧请求 | 旧请求不能覆盖新画面 |
| visual service 关闭 | ST 对白仍可游玩 |

每个失败场景都必须保留服务状态和页面状态，不能用本地固定对白代替。

## 8. H5：移动端和 Network 检查

视口至少包含：

~~~~text
390x844
1366x768
~~~~

必须验证：

- 无横向溢出。
- 技术字段不出现在玩家页面。
- 页面没有 Provider origin。
- 页面没有 Authorization、x-api-key、ST key 或 token。
- 页面只访问当前游戏、配置、bridge 和 visual-asset-service 的允许路径。
- 图片加载成功后再切换展示。
- placeholder 使用统一视觉资源。

## 9. 当前脚本的处置决策

~~~~text
脚本 route、输入、输出全部符合 v2
  -> 记录兼容证据
  -> 允许进入 D7

脚本仍包含旧 VS-CODE-3C route 或旧 DTO
  -> 标记 LEGACY_HARNESS_ONLY
  -> 不作为 RUNTIME-4 通过证据
  -> 单独设计/修改当前 v2 harness
  -> 修改后重新跑 H0-H5

脚本混合旧 route 和新 route
  -> 标记 INCOMPATIBLE_MIXED_HARNESS
  -> 停止实时验收
  -> 先完成代码和测试审计

脚本输出无法证明实际 Provider、真实 ST 和当前 manifest
  -> 标记 PRECHECK_ONLY
  -> 不改变阶段状态
~~~~

## 10. 当前 v2 harness 的最低输出

当前验收工具的 evidence JSON 至少包含：

~~~~json
{
  "schemaVersion": "galgame.visual-runtime-4-real-acceptance.v1",
  "ok": false,
  "mode": "real-runtime-v2",
  "sourceCommit": "<实际运行进程加载的 commit 摘要>",
  "preconditions": {},
  "request": {
    "schemaVersion": "galgame.visual-core-visual-decisions-request.v2",
    "currentMessageHash": "<digest>",
    "recentMessageHash": "<digest>"
  },
  "provider": {
    "attempted": false,
    "transportStatus": "not-run",
    "bodyCaptured": false
  },
  "decision": {
    "understandingStatus": "unavailable",
    "errorCode": "RUNTIME_NOT_CONFIGURED",
    "scoreBand": "unknown",
    "assetIdRecorded": false
  },
  "browser": {
    "dialogueRenderedBeforeVisual": false,
    "providerOriginSeen": false,
    "credentialSeen": false,
    "horizontalOverflow": false
  },
  "failures": []
}
~~~~

实际证据不得把上述 placeholder 值伪造为生产通过。字段必须由真实运行结果填充。

## 11. 当前 v2 test-only harness 的已验证范围

`frontend/tools/visual-runtime-4-browser-smoke.mjs` 已覆盖：

- 当前 `/v1/core/visual-context` 和 `/v1/core/visual-decisions` 路由；
- v2 request schema、visibleContext 和 ready understandingStatus；
- 五类实体 score=70 的 concrete decisions 与五次 core content read；
- 对白先于视觉展示、统一 route、桌面 1366x768 和移动 390x844；
- 无旧 visual-bundle/visual-match route、Provider origin、Authorization、x-api-key 或 ST key。

此工具的 evidence 必须标记 `testDouble=true`、`realSillyTavernE2E=false`，只能作为 LOCAL/BROWSER 合同证据。

## 12. H6：审计证据

H0-H5 结果写入：

~~~~text
.codex-longrun/evidence/visual-runtime-4-harness-compatibility-v1.json；本地 v2 smoke 结果为 `.codex-longrun/evidence/visual-runtime-4-browser-smoke-v1.json`。
~~~~

证据必须包含：

- source file hash 或 source commit。
- 静态命中摘要。
- 实际 route 摘要。
- request/response key 摘要。
- 旧 route 是否被使用。
- 结论：RUNTIME_4_READY、LEGACY_HARNESS_ONLY、INCOMPATIBLE_MIXED_HARNESS 或 PRECHECK_ONLY。
- reviewer 复核结果。

## 13. 停机条件

- 发现旧脚本被当作当前 RUNTIME-4 通过证据。
- 为让脚本通过而删除旧断言、放宽 v2 schema 或隐藏失败。
- harness 直接访问 Provider。
- harness 读取或打印凭据。
- harness 生成固定对白或本地剧情。
- harness 通过 test-double 伪造 real ST。
- harness 无法绑定真实 target chat 或当前 manifest/Arc。

出现任何条件都保持 verifying，并在 blockers.md 记录固定原因。
