# VISUAL-RUNTIME-4 证据与审计清单

> 目的：把测试结果变成可回读、可复核、可追溯的 evidence。
>
> 通过本清单只代表证据结构和边界正确；Provider、真实 ST 和 RUNTIME-4 是否完成仍由对应真实用例决定。

## 1. 证据总原则

每份 evidence 必须：

- 使用 UTF-8，无 BOM。
- 是可解析 JSON。
- 有唯一 schemaVersion。
- 有 generatedAt、sourceCommit 和 mode。
- 只记录脱敏状态、固定错误类别、摘要和计数。
- 明确 test-double、real-provider、real-ST 或 browser 来源。
- 保存失败记录，不覆盖旧证据。
- 记录实际启动进程加载的 commit。
- 记录必要的 command、入口和受控范围。
- 失败时 ok 必须为 false。
- blocker 存在时不得通过添加说明把 ok 改成 true。

禁止写入：

- Provider token、ST key、Authorization 值、x-api-key 值。
- 原始 Provider response、原始任务文本、完整 prompt。
- 角色卡、世界书、完整聊天对象、save 数据。
- 浏览器 localStorage、cookie 值、URL query 凭据。
- 未脱敏路径中的用户隐私或外部账号标识。

## 2. 证据命名约定

~~~~text
.codex-longrun/evidence/
  visual-runtime-4-doc-pack-audit-v1.json
  visual-runtime-4-harness-compatibility-v1.json
  visual-runtime-4-provider-contract-v1.json
  visual-runtime-4-local-regression-v1.json
  visual-runtime-4-runtime-v2-migration-dry-run-v1.json
  visual-runtime-4-runtime-v2-migration-execute-v1.json
  visual-runtime-4-real-provider-v1.json
  visual-runtime-4-real-st-v1.json
  visual-runtime-4-browser-matrix-v1.json
  visual-runtime-4-final-audit-v1.json
~~~~

新证据不得复用旧 VS-CODE-3C 文件名。旧证据只能作为历史引用或 superseded 输入。

## 3. 通用 evidence 骨架

~~~~json
{
  "schemaVersion": "galgame.visual-runtime-4-evidence.v1",
  "generatedAt": "实际时间",
  "ok": false,
  "mode": "local-contract|real-provider|real-st|browser|audit",
  "sourceCommit": "实际源码 commit 摘要",
  "processCommit": "实际运行进程 commit 摘要或 null",
  "testDouble": false,
  "command": "不含凭据的命令摘要",
  "preconditions": {},
  "checks": {},
  "status": {},
  "failures": [],
  "blockers": [],
  "security": {
    "providerBodyCaptured": false,
    "providerTokenRecorded": false,
    "stKeyRead": false,
    "browserCredentialSeen": false
  },
  "review": {
    "reviewer": "",
    "reviewedAt": "",
    "result": "pending"
  }
}
~~~~

mode、testDouble、security 字段必须真实填写。命令不得包含 token 或隐藏输入内容。

## 4. Provider 合同证据

文件：

~~~~text
visual-runtime-4-provider-contract-v1.json
~~~~

必须包含：

- contractStatus：ACCEPTED、PROVIDER_FIX_REQUIRED、LOCAL_ADAPTER_CHANGE_REQUIRED 或 BLOCKED_CONTRACT_UNKNOWN。
- visionRequestSummary。
- visionResponseShapeSummary。
- runtimeRequestSummary。
- runtimeResponseShapeSummary。
- providerVersion。
- modelName。
- endpointOrigin，不含 query、账号或凭据。
- responseDigest，只保留 hash 或短摘要。
- localParserCompatibility。
- requiredCodeChange。
- providerOwner 和 review 状态。

禁止包含：

- 完整 response body。
- token 或认证头值。
- 未确认字段的猜测值。
- 把 2xx 写成 schema accepted。

## 5. harness 兼容性证据

文件：

~~~~text
visual-runtime-4-harness-compatibility-v1.json
~~~~

必须包含：

- sourceFile。
- sourceCommit。
- staticHits。
- actualRoutes。
- requestKeys。
- responseKeys。
- legacyRouteUsed。
- directProviderCallFromBrowser。
- credentialLeak.
- conclusion：RUNTIME_4_READY、LEGACY_HARNESS_ONLY、INCOMPATIBLE_MIXED_HARNESS 或 PRECHECK_ONLY。
- reviewer result。

若命中 VS-CODE-3C、visual-bundle、binding、ticket 或旧 DTO，必须明确分类，不能从 evidence 中删除。

## 6. local regression evidence

文件：

~~~~text
visual-runtime-4-local-regression-v1.json
~~~~

必须包含：

- node check 结果。
- visual-asset-service 全量测试结果。
- shared/player/architecture 测试结果。
- parser case IDs。
- runtime hint case IDs。
- scorer 59/60/61 结果。
- failure fallback 结果。
- cache 和 restart 结果。
- frozen boundary result。
- git diff --check result。
- failed cases 和固定 errorCode。

LOCAL evidence 的 testDouble 必须为 true，不能被提交为 production AI evidence。

## 7. migration evidence

### 7.1 dry-run

文件：

~~~~text
visual-runtime-4-runtime-v2-migration-dry-run-v1.json
~~~~

必须包含：

- oldPointerDigest。
- sourceCatalogDigest。
- assetCount。
- fiveTypeCounts。
- allReady。
- dictionaryVersion。
- dictionaryHash 摘要。
- batchCreated=false。
- pointerChanged=false。
- controlChanged=false。
- legacyPreserved=true。
- errorCode。

### 7.2 execute

文件：

~~~~text
visual-runtime-4-runtime-v2-migration-execute-v1.json
~~~~

必须包含：

- operatorApprovalRecorded。
- dryRunEvidencePath。
- oldPointerDigest。
- newPointerDigest。
- newCatalogDigest。
- assetCount。
- batchValidated。
- pointerCommitted。
- controlCommitted。
- restartReadback。
- legacyPreserved。
- rollbackResult。
- errorCode。

execute 证据缺少 operatorApprovalRecorded 时不能为 ok=true。

## 8. real provider evidence

文件：

~~~~text
visual-runtime-4-real-provider-v1.json
~~~~

必须包含：

- providerVersion 和 model 的非敏感摘要。
- endpoint origin。
- requestStyle。
- localUploadStatus。
- providerTransportStatus。
- analysisStatus。
- analysisErrorCode。
- responseBodyCaptured=false。
- providerTokenRecorded=false。
- readyAnalysisFieldsPresent。
- dictionaryMatch。
- singleTextBlock。
- duplicateFieldRejected。
- confidenceContract.
- cacheWriteResult.
- noRawResponsePersistence.

analysisStatus=failed 或 analysisErrorCode 非 null 时，productionReady 必须为 false。

## 9. real ST evidence

文件：

~~~~text
visual-runtime-4-real-st-v1.json
~~~~

必须包含：

- stOrigin、bridgeOrigin、gameOrigin、visualAssetOrigin，只记录 origin。
- processCommit。
- activeRelease 摘要。
- manifest 摘要。
- activeArcId。
- targetChatReadback 摘要。
- currentMessageHash。
- recentMessageHash。
- requestSchemaVersion。
- responseSchemaVersion。
- understandingStatus。
- errorCode。
- dialogueRenderedBeforeVisual。
- providerCalledByServer。
- browserProviderOriginSeen=false。
- browserCredentialSeen=false。
- localFallbackDialogueUsed=false。
- oldRouteUsed=false。
- cleanupResult。

不得把目标聊天完整内容写入 evidence。

## 10. browser matrix evidence

文件：

~~~~text
visual-runtime-4-browser-matrix-v1.json
~~~~

每个 B case 必须有：

- viewport。
- visibleTextDigest。
- requestId。
- sourceMessageHash。
- understandingStatus。
- errorCode。
- scoreBand。
- score 是否仅作为服务端返回摘要。
- concreteAssetShown。
- placeholderShown。
- contentReadStatus。
- dialogueFirst.
- providerOriginSeen.
- credentialSeen.
- horizontalOverflow.
- technicalFieldVisible.
- failures。

## 11. final audit evidence

文件：

~~~~text
visual-runtime-4-final-audit-v1.json
~~~~

必须包含：

- docsPackAudit。
- harnessCompatibility.
- localRegression.
- migrationDryRun。
- migrationExecute。
- realProvider。
- realST。
- browserMatrix。
- frozenBoundary.
- processVersion.
- sourcePublicConsistency.
- secretScan.
- staleScan.
- architectureAudit。
- independentReview。
- finalClaimAllowed。
- blockersRemaining。

finalClaimAllowed=true 的必要条件：

- D1-D9 全部有 ok=true evidence。
- 没有未关闭 blocker。
- current source/process commit 一致。
- old gate 没有被用作 RUNTIME-4 证据。
- provider body、token 和 ST key 未被记录。
- frozen boundary clean。
- reviewer 结果为 PASS。

## 12. 证据校验命令

~~~~cmd
cd /d D:\AI\SillyTavern
node --check external-modules/visual-asset-service/server.mjs
node external-modules/visual-asset-service/test.mjs
node frontend/shared/tests/visual-system-schema.test.mjs
node frontend/shared/tests/sillytavern-visible-chat.test.mjs
node frontend/player/tests/visual-presentation.test.mjs
node frontend/player/tests/core-final-acceptance.test.mjs
node frontend/tools/static-architecture-audit.test.mjs
git diff --check -- docs external-modules frontend public/game public/game-admin .codex-longrun
~~~~

证据 JSON 应由仓库既有 state validation 或等价的无副作用脚本读取。解析失败、BOM、空文件或缺少 ok 字段都算 AUDIT fail。

## 13. 文档包审计记录

本次 docs-only 文档包使用：

~~~~text
.codex-longrun/evidence/visual-runtime-4-doc-pack-audit-v1.json
~~~~

该证据至少记录：

- 本索引、五个配套 Markdown 文档和一个 JSON 合同模板存在且非空。
- 标题、阶段、状态和基线一致。
- 所有相对链接可解析。
- runbook、合同、harness、测试矩阵和本清单相互引用。
- 未出现真实凭据或错误完成声明。
- runbook 明确 D1 blocker 和 v10 schema result。
- runbook 明确旧 VS-CODE-3C harness 兼容性门。
- runbook 明确后端冻结、Provider 不修改和 no fallback。
- 当前 state 仍为 verifying。
- 业务代码没有因为文档包发生变化。

## 14. reviewer 签字

| 角色 | 姓名/标识 | 时间 | 结果 |
| --- | --- | --- | --- |
| 文档审查 |  |  | pending |
| Provider 合同审查 |  |  | pending |
| 代码边界审查 |  |  | pending |
| 真实验收审查 |  |  | pending |
| 最终验收 |  |  | pending |

在 Provider 合同、真实 ST 和真实浏览器证据生成前，最终验收保持 pending。
