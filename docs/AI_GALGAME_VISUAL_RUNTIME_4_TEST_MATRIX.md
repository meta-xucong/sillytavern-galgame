# VISUAL-RUNTIME-4 测试矩阵

> 本矩阵把开发、迁移、真实 Provider、真实 ST、浏览器和证据审计拆成可执行用例。
>
> test fixture 只能证明本地合同。只有 REAL 类用例能进入生产验收证据。

## 1. 测试等级

| 等级 | 标记 | 数据来源 | 能证明什么 |
| --- | --- | --- | --- |
| 静态 | STATIC | 源码、文档、diff | 范围、字段、边界、无泄漏 |
| 本地合同 | LOCAL | test-only fixture | parser、validator、scorer、fallback |
| 迁移 | MIGRATION | FileVisualAssetStore 数据 | v1→v2 dry-run/execute/restart |
| 受控实时 | REAL-PROVIDER | 独立 Provider | 真正传输和真实输出合同 |
| 真实 ST | REAL-ST | 当前 ST、bridge、manifest、target chat | 可见对白和真实资源链 |
| 浏览器 | BROWSER | 当前 /game/ 页面 | 展示、异步、移动端、Network |
| 审计 | AUDIT | evidence、进程和 Git | 版本、证据和边界闭合 |

## 2. 统一记录字段

每个用例至少记录：

- caseId
- level
- startedAt、finishedAt
- sourceCommit
- processCommit
- command 或受控入口
- inputDigest
- result
- errorCode
- evidencePath
- reviewer
- notes

不记录：

- token
- ST key
- Authorization 或 x-api-key 值
- 原始 Provider response
- 原始任务文本
- 角色卡、世界书、隐藏 prompt
- 完整 chat object
- 浏览器凭据或 localStorage

## 3. STATIC：范围和入口

| 编号 | 操作 | 期望 |
| --- | --- | --- |
| S-01 | 读取 AGENTS.md 和 native-first spec | 后端冻结和自定义前端边界与本矩阵一致 |
| S-02 | 读取 runtime spec、live acceptance、state、blockers | 当前阶段仍为 verifying，v10 schema blocker 可追溯 |
| S-03 | git status、branch、HEAD | 工作区改动被保留，branch/commit 被记录 |
| S-04 | frozen boundary diff | src、server.js、plugins.js、config.yaml、原版 public entry 无新差异 |
| S-05 | 允许目录扫描 | 代码修改只落在允许目录 |
| S-06 | 文档 cross-link scan | 本文档包中的相对路径全部存在 |
| S-07 | secret scan | 无 token、ST key、JWT、Authorization 值或 Provider response |
| S-08 | line ending、BOM 和 whitespace 检查 | 文档和 evidence UTF-8、无 BOM、git diff --check 通过 |

推荐命令：

~~~~cmd
cd /d D:\AI\SillyTavern
git status --short --branch
git diff --name-only -- src server.js plugins.js config.yaml package.json package-lock.json public/index.html public/script.js public/style.css
git diff --check -- docs external-modules frontend public/game public/game-admin .codex-longrun
~~~~

## 4. LOCAL：上传 vision parser

| 编号 | 输入 | 期望 error/result |
| --- | --- | --- |
| L-V01 | 合法 Anthropic envelope + 单一 text block + 五字段 JSON | ready analysis |
| L-V02 | envelope 非 object | ANALYZER_ENVELOPE_INVALID |
| L-V03 | content 缺失或长度不是 1 | ANALYZER_CONTENT_INVALID |
| L-V04 | content block 多字段 | ANALYZER_CONTENT_INVALID |
| L-V05 | content block type 非 text | ANALYZER_CONTENT_INVALID |
| L-V06 | text 非 JSON | ANALYZER_INVALID_JSON |
| L-V07 | text 有错误 json fence | ANALYZER_INVALID_JSON |
| L-V08 | text 以 BOM 开头 | BOM rejection |
| L-V09 | envelope 重复 key | ANALYZER_OUTPUT_DUPLICATE_FIELD |
| L-V10 | 内部 JSON 重复 key | ANALYZER_OUTPUT_DUPLICATE_FIELD |
| L-V11 | 内部 JSON 有未知字段 | ANALYZER_OUTPUT_UNKNOWN_FIELD |
| L-V12 | 内部 JSON 缺五字段任一项 | ANALYZER_OUTPUT_MISSING_FIELD |
| L-V13 | description 含 URL、markup 或超长文本 | ANALYZER_OUTPUT_DESCRIPTION_INVALID |
| L-V14 | tagCodes 或 attributeCodes 非数组 | ANALYZER_OUTPUT_CODES_INVALID |
| L-V15 | code 不在当前 assetType 字典 | ANALYZER_OUTPUT_CODE_INVALID |
| L-V16 | 数组内或两个数组之间 code 重复 | ANALYZER_OUTPUT_DUPLICATE_CODES |
| L-V17 | confidence 为字符串、百分数、NaN、Infinity | ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID |
| L-V18 | confidence 为 0 或大于 1 | ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID |
| L-V19 | analyzerVersion 非安全字符串 | ANALYZER_OUTPUT_VERSION_INVALID |
| L-V20 | 合法五字段但外加 schemaVersion | UNKNOWN_FIELD，不能由 provider 伪造内部字段 |
| L-V21 | HTTP 401/403 | ANALYZER_AUTH_ERROR |
| L-V22 | HTTP 400/404/422 | ANALYZER_REQUEST_INVALID |
| L-V23 | HTTP 429 | ANALYZER_RATE_LIMITED |
| L-V24 | HTTP 5xx | ANALYZER_UPSTREAM_ERROR |
| L-V25 | 超时或网络错误 | ANALYZER_TIMEOUT 或 ANALYZER_NETWORK_ERROR |
| L-V26 | response 超过 64 KiB | ANALYZER_RESPONSE_TOO_LARGE |
| L-V27 | 失败后再次请求 | PNG/draft 保留，失败结果不写 ready cache |

命令：

~~~~cmd
node --check external-modules/visual-asset-service/server.mjs
node --check external-modules/visual-asset-service/test.mjs
node external-modules/visual-asset-service/test.mjs
~~~~

## 5. LOCAL：运行 text hint parser

| 编号 | 输入 | 期望 |
| --- | --- | --- |
| L-R01 | 合法五 root key，ready，一个 scene 实体 | ready，进入 scorer |
| L-R02 | root 多字段 | RUNTIME_SCHEMA_INVALID |
| L-R03 | root 缺字段 | RUNTIME_SCHEMA_INVALID |
| L-R04 | schemaVersion 错误 | RUNTIME_SCHEMA_INVALID |
| L-R05 | dictionaryVersion 错误 | RUNTIME_DICTIONARY_MISMATCH |
| L-R06 | dictionaryHash 错误 | RUNTIME_DICTIONARY_MISMATCH |
| L-R07 | entityType 重复 | RUNTIME_SCHEMA_INVALID |
| L-R08 | codes 为空、重复、超 8 个 | RUNTIME_SCHEMA_INVALID |
| L-R09 | code 与 entityType 不匹配 | RUNTIME_SCHEMA_INVALID |
| L-R10 | confidence 非有限数或超范围 | RUNTIME_SCHEMA_INVALID |
| L-R11 | confidenceBand 非法 | RUNTIME_SCHEMA_INVALID |
| L-R12 | ready 且 entities 为空 | RUNTIME_SCHEMA_INVALID |
| L-R13 | ambiguous/unavailable 但带 entities | RUNTIME_SCHEMA_INVALID |
| L-R14 | 输出 assetId、URL、剧情字段 | RUNTIME_SCHEMA_INVALID |
| L-R15 | provider 2xx 但 JSON 错误 | placeholder + RUNTIME_INVALID_JSON |
| L-R16 | runtime 未配置 | placeholder + RUNTIME_NOT_CONFIGURED |
| L-R17 | 相同 visibleContext 并发请求 | 一个 provider 调用，其他请求复用 in-flight |
| L-R18 | 失败结果再次请求 | 不缓存失败 wrapper |
| L-R19 | 300 秒后请求 | cache miss |
| L-R20 | dictionary/hash/catalog/scope 变化 | cache miss |

## 6. LOCAL：scorer 和展示

| 编号 | 输入 | 期望 |
| --- | --- | --- |
| L-S01 | 真实具体 code，raw score 59 | final score 59，placeholder |
| L-S02 | 真实具体 code，raw score 60 | matched |
| L-S03 | 真实具体 code，raw score 61 | matched |
| L-S04 | 只有 generic parent code | 最高 59，placeholder |
| L-S05 | runtime confidence < 0.60 | 最高 59，placeholder |
| L-S06 | character 缺 identity | 最高 59，placeholder |
| L-S07 | character 缺 appearance | 最高 59，placeholder |
| L-S08 | analysis 非 ready | 0，placeholder |
| L-S09 | candidate type 不匹配 | 不可入选 |
| L-S10 | negative conflict | 不可入选 |
| L-S11 | 两个候选同分同 tie-break | placeholder |
| L-S12 | score >= 60 | 先预加载，成功后切换具体图 |
| L-S13 | score < 60 | 使用统一 visual-placeholder.svg |
| L-S14 | ordinary ambiguous 且已有 verified image | 保留当前展示 |
| L-S15 | 新视觉意图但低分/失败 | 切换统一 placeholder |
| L-S16 | 新消息到达 | 旧 request token 不能覆盖新展示 |

## 7. MIGRATION：FileVisualAssetStore

| 编号 | 操作 | 期望 |
| --- | --- | --- |
| M-01 | 无参数读取 active legacy source | 读取当前 catalog 和全部 published refs |
| M-02 | 缺失 active source | fail-closed |
| M-03 | stale pointer 或 ref mismatch | fail-closed |
| M-04 | legacy 五类素材完整 fixture | 规划所有 scene/character/equipment/item/skill |
| M-05 | 缺任一素材 ready analysis | dry-run/execute 拒绝 |
| M-06 | dry-run | 不写 batch、pointer、control |
| M-07 | batch write failure | legacy active source 保持不变 |
| M-08 | pointer write failure | batch 清理，legacy pointer 保持 |
| M-09 | restart readback | 只接受完整 batch 和合法 pointer |
| M-10 | orphan final batch 无 root pointer | 启动时清理 |
| M-11 | malformed/partial/temp batch | fail-closed |
| M-12 | symlink/path traversal | fail-closed |
| M-13 | repeated execute | idempotent no-op |
| M-14 | execute 成功 | control 指向 v2 active catalog |
| M-15 | 旧记录 | 保留，不能静默删除 |

命令：

~~~~cmd
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --dry-run
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --execute
~~~~

execute 只有在操作者明确批准且 M-01 至 M-06 通过时运行。

## 8. REAL-PROVIDER：上传期真实合同

| 编号 | 条件 | 期望 |
| --- | --- | --- |
| P-01 | 独立 token 通过隐藏输入 | token 不出现在 PTY、命令行、日志或 evidence |
| P-02 | vision request | x-api-key、anthropic-version，禁止 Bearer |
| P-03 | provider 2xx + 合法五字段 | analysisStatus=ready |
| P-04 | provider 2xx + 未知字段 | failed，固定 schema error |
| P-05 | provider 2xx + 缺字段 | failed，固定 schema error |
| P-06 | provider 2xx + confidence 错误 | failed，固定 confidence error |
| P-07 | provider 非 2xx | 固定 HTTP 类别，不保存 response body |
| P-08 | 真实 PNG 上传后重启 | analysis cache 只保存规范化 analysis |
| P-09 | ready analysis + v2 migration dry-run | 全部 published refs 可规划 |
| P-10 | provider contract 与实际不符 | 停止，保持 D1/D3 blocker |

## 9. REAL-ST：真实可见对白链路

前置：M-14、当前 ST、bridge、manifest/Arc、target chat 和当前 v2 harness 全部通过。

| 编号 | 操作 | 期望 |
| --- | --- | --- |
| T-01 | 读取 active release | release、scenario、version、Arc 可回读 |
| T-02 | 读取 manifest | bindings 和 visualPresentation 有效 |
| T-03 | 读取 target chat | 真实消息和角色归属可证明 |
| T-04 | 当前 visibleContext | current/recent 只含已显示文本 |
| T-05 | 发送 v2 request | exact root keys，通过 hash 校验 |
| T-06 | runtime provider 2xx | 返回合法 runtime hint |
| T-07 | runtime schema invalid | failed + placeholder，不伪造 tags |
| T-08 | visual service timeout | ST 对白继续，视觉降级 |
| T-09 | provider request count | 只记录受控次数，无无限重试 |
| T-10 | request identity | current hash、projection hash、source hash 一致 |

## 10. BROWSER：真实页面

| 编号 | 场景 | 期望 |
| --- | --- | --- |
| B-01 | 雾气废弃森林对白 | scene/forest 或 ruins 达到 60，展示背景 |
| B-02 | 火球术对白 | skill/fireball 达到 60，展示技能图 |
| B-03 | 使用魔法 | generic/低置信度，统一 placeholder |
| B-04 | 无视觉意图 | 不误切换，保留当前画面 |
| B-05 | provider 关闭 | 对白正常，placeholder 或保留 |
| B-06 | 旧请求晚到 | 不覆盖新对白画面 |
| B-07 | desktop 1366x768 | 无横向溢出，技术字段不可见 |
| B-08 | mobile 390x844 | 无横向溢出，技术字段不可见 |
| B-09 | 页面刷新 | 当前服务状态和失败行为可恢复 |
| B-10 | Network recorder | 无 Provider origin、Authorization、ST key |

当前 test-only v2 浏览器 smoke 命令：

~~~~cmd
node frontend/tools/visual-runtime-4-browser-smoke.mjs
~~~~

该命令覆盖当前 v2 route、五类 score、core content read、desktop/mobile viewport 和浏览器凭据隔离，输出必须标记 `testDouble=true`。真实脚本的 route 必须先通过 harness compatibility gate；旧 visual-bundle evidence 不计入 B-01 至 B-10。

## 11. AUDIT：证据和边界

| 编号 | 检查 | 期望 |
| --- | --- | --- |
| A-01 | evidence JSON 可解析 | UTF-8、无 BOM、ok 字段真实 |
| A-02 | source/process commit | 与实际运行版本一致 |
| A-03 | provider body | bodyCaptured=false |
| A-04 | token/ST key | 未记录 |
| A-05 | response detail | 只记录固定 errorCode 和摘要 |
| A-06 | old gate | 标记 historical 或 legacy-only |
| A-07 | frozen diff | 无后端和原版前端修改 |
| A-08 | architecture audit | prohibitedActive=0、needsReview=0 |
| A-09 | state | D9 前保持 verifying |
| A-10 | reviewer | 独立复核签字存在 |

## 12. 推荐执行顺序

~~~~text
S-01..S-08
  -> L-V01..L-V27
  -> L-R01..L-R20
  -> L-S01..L-S16
  -> H0..H6 harness compatibility
  -> P-01..P-10
  -> M-01..M-15
  -> T-01..T-10
  -> B-01..B-10
  -> A-01..A-10
~~~~

任何一步失败都记录 caseId 和固定 errorCode，不跳过、不重命名、不删除失败证据。

## 13. 通过口径

- LOCAL 全部通过：只说明本地合同正确。
- MIGRATION 全部通过：只说明 v2 catalog 可恢复迁移正确。
- REAL-PROVIDER 全部通过：说明 Provider 与合同相容。
- REAL-ST 和 BROWSER 全部通过：才有资格讨论真实 RUNTIME-4。
- AUDIT 全部通过：才允许提交验收。

任一等级不能替代其他等级。

## 14. Doubao OpenAI-compatible adapter cases

| 编号 | 输入/检查 | 期望 |
| --- | --- | --- |
| L-OAI-V01 | `openai_chat_completions_vision` 请求 | POST `/v1/chat/completions`，Bearer 只在服务端，json_object，vision image_url |
| L-OAI-V02 | OpenAI choices 单项 + assistant content 五字段 | ready analysis，v2 wrapper 由本地生成 |
| L-OAI-V03 | choices/message 未知字段、重复 key、非字符串 content | 固定 envelope/content/duplicate error，不能 ready |
| L-OAI-R01 | `openai_chat_completions_text` 请求 | POST `/v1/chat/completions`，Bearer 只在服务端，固定 runtime system prompt |
| L-OAI-R02 | provider 返回 runtime exact root/entity schema | `understandingStatus=ready`，进入 deterministic scorer |
| L-OAI-R03 | runtime entityType 重复或 code 非字典 | `RUNTIME_SCHEMA_INVALID`，placeholder/fallback |
| REAL-OAI-01 | `.env.local` Doubao 受控上传 | 真实 PNG 返回脱敏 ready/固定失败类别；无 key、原文或 body 进入 evidence |
| REAL-OAI-02 | `.env.local` Doubao runtime 探针 | 真实 2xx、exact five root keys、每类最多一个实体；仍不替代真实 ST |

本节用例已经纳入 `external-modules/visual-asset-service/test.mjs` 的全量服务 suite；REAL-OAI 证据只保留状态、计数、digest 和固定错误类别。
