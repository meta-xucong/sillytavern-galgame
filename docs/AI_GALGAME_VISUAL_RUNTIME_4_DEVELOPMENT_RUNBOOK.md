# VISUAL-RUNTIME-4 详细开发运行手册

> 版本：v1.0
> 文档类型：开发执行手册
> 当前性质：local implementation and controlled verification；生产验收仍受外部条件阻塞
> 当前阶段：VISUAL-RUNTIME-4 AISelf live closed-schema compatibility diagnosis
> 当前状态：verifying
> 本手册不授权自动迁移、实时重试、Provider 侧修改或业务代码越界。

## 1. 目标和完成定义

本阶段只完成一条可审计链路：

~~~~text
玩家已经看到的自然对白
  -> player 复制 visibleContext
  -> visual-asset-service 服务端接收
  -> 服务端调用独立视觉 Provider
  -> 闭合 VisualRuntimeHintV1
  -> deterministic scorer
  -> score >= 60 返回具体已发布图片
  -> score < 60 或错误返回统一占位图
~~~~

完成时必须同时满足：

- 上传期图片分析得到合法、可持久化的 v2 analysis。
- 运行时对白只来自已经展示给玩家的 current/recent visibleContext。
- Provider 只由 visual-asset-service 服务端调用。
- 浏览器不接触 Provider URL、token、ST key、隐藏上下文或原始资源正文。
- 评分门槛由服务端固定执行，浏览器不能升分。
- 低分、歧义、超时、未配置、schema 错误和素材完整性错误都不阻塞对白。
- 真实 ST、现有 bridge、当前 manifest/Arc visualPresentation 和有效 published catalog 均被真实核对。
- 证据绑定实际启动进程和最终源码版本。
- 不修改 SillyTavern 后端、原版前端和历史重型视觉链路。

本阶段不宣称完整 Galgame、玩家剧情 LLM、Provider 生态、旧 VS-CODE-3C gate 或历史 Projection/proof/binding/old-save 链完成。

## 2. 当前基线

只读接手检查已经确认：

- 仓库：本机克隆的项目仓库根目录（具体路径由使用者决定）
- 分支：verya-main，跟踪 origin/main
- HEAD：b3b7bfa5a2eda9aee0294afb80cc85ca7ebf39a3
- 工作区有大量已跟踪修改和未跟踪文件，必须原样保留。
- frozen boundary 的跟踪差异为空：src、server.js、plugins.js、config.yaml、root dependencies 和原版 public entry。
- state.json 的 phase_status 为 verifying。
- 最近 v10 受控调用的 local upload 为 200，Provider transport 为 2xx，analysis 为 failed。
- v10 失败类别为 ANALYZER_SCHEMA_INVALID。
- v10 没有读取或持久化 Provider response body，也没有记录 token 或 ST key。
- publish 另有 VISUAL_CONTROL_ACTIVE_CATALOG_INVALID，原因是活动目录仍是 legacy dictionary-v1。
- state.json 最后验证时间为 2026-09-06 04:09:16 +08:00；本次接手不把它扩展解释为后续生产成功。

## 3. 角色和唯一责任

| 角色 | 责任 | 可执行范围 |
| --- | --- | --- |
| 主线开发线程 | 本地适配器、测试、文档和证据 | 只改 RUNTIME-4 允许目录 |
| Provider 负责人 | 输出合同、模型路由和 Provider 侧修正 | 提供正式字段合同或修正版响应 |
| 本地操作者 | 隐藏输入、进程启动、dry-run/execute 和真实验收 | 不把凭据输入 PTY，不回显原文 |
| 独立审查者 | 源码、测试、边界、浏览器和证据审查 | 不替代真实 Provider 证据 |
| 验收人 | 依据最终 evidence 判断是否接受 | 不以旧 gate 或夹具代替 RUNTIME-4 |

没有 Provider 合同和外部前置时，主线只能完成文档、合同审计和本地 fixture 回归。

## 4. 修改边界

### 4.1 允许修改

- external-modules/visual-asset-service/server.mjs
- external-modules/visual-asset-service/test.mjs
- external-modules/visual-asset-service/README.md
- frontend/player/src/main.js
- 必要的 frontend/shared/src/** 视觉 schema/helper
- 由源码构建产生的 public/game/**
- 必要的 frontend/player/tests/** 和 frontend/tools/**
- 受控自有视觉服务启动入口
- docs/** 和 .codex-longrun/**

每次修改都要写入变更记录，说明它对应哪个门、哪个合同字段和哪个测试编号。

### 4.2 禁止修改

- src/**
- server.js
- plugins.js
- config.yaml
- root package.json/package-lock.json 的 SillyTavern 运行行为
- public/index.html、public/script.js、public/style.css
- Provider、Grok、Sub2API、Media Runtime
- 旧 Projection、proof、ticket、binding、receipt、rollback、old-save 链
- player 侧剧情、聊天、save 或平行玩法状态
- 浏览器端 Provider 调用和任何 token 注入
- 固定对白、脚本剧情、deterministic story fallback
- 用旧 VS-CODE-3C 证据替代当前 RUNTIME-4

## 5. 总门禁

~~~~text
D0 基线保护
D1 Provider 合同确认
D2 验收脚本兼容性确认
D3 本地实现与回归
D4 迁移 dry-run
D5 迁移 execute
D6 真实外部前置
D7 一次受控实时验收
D8 浏览器矩阵
D9 证据审计与独立复核
~~~~

门禁规则：

- 只能按顺序前进。
- 任一门失败，保留现场并停止后续门。
- 一个失败请求的响应未知时，不重复猜测。
- Provider 合同变更后，重新从 D2 开始。
- 只有 D9 通过才允许改变阶段状态或写 production-ready 结论。

## 6. D0：基线和工作区保护

### 操作

1. 记录 branch、HEAD、tracking 和工作区状态。
2. 记录 frozen boundary diff。
3. 记录 .codex-longrun/state.json 的 phase、blockers、evidence_inventory 和 last_verified_at。
4. 记录实际运行进程加载的 commit；磁盘 HEAD 不等于进程版本。
5. 复制文档和证据路径清单，不复制凭据、缓存原文或 Provider response。
6. 确认没有待执行的 legacy migration 进程。

### 检查命令

~~~~cmd
:: Run these commands from the repository root
git status --short --branch
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git diff --name-only -- src server.js plugins.js config.yaml package.json package-lock.json public/index.html public/script.js public/style.css
~~~~

### 放行条件

- 工作区清单已保存。
- frozen boundary 无新差异。
- 没有 reset、clean、checkout、旧目录迁移或覆盖操作。
- 当前 state 仍为 verifying。

## 7. D1：Provider 输出合同确认

D1 是当前实际阻塞。未获得正式合同时，不运行新的实时 Provider 请求。

### 7.1 上传期 vision 合同

当前本地 validator 要求 Provider 的 Anthropic Messages 响应满足：

1. HTTP POST 到归一化后的 /v1/messages。
2. 请求使用服务端 x-api-key 和 anthropic-version: 2023-06-01。
3. 请求只发送 model、max_tokens、固定识图任务和 PNG 内容。
4. 响应 envelope 是对象，允许当前 parser 明确列出的可选元字段。
5. content 必须是长度为 1 的数组。
6. content[0] 必须只有 type 和 text 两个字段。
7. type 必须是 text，text 必须是 JSON 或合法的 json fenced text。
8. text JSON 必须严格包含五个字段：
   description、tagCodes、attributeCodes、confidence、analyzerVersion。
9. 不允许未知字段、缺失字段、重复 key、BOM、URL、markup、NaN 或 Infinity。
10. confidence 必须是 JSON number，满足 0 < confidence <= 1。
11. tagCodes 和 attributeCodes 必须来自当前 assetType 的 dictionary。
12. 两个数组之间不得有重复 code。
13. analyzerVersion 必须是受限安全字符串。
14. 本地服务随后生成 schemaVersion、status、errorCode、dictionaryVersion 和 dictionaryHash；Provider 不自行伪造这些内部字段。

Provider 方必须书面确认真实返回是否满足以上合同。只给出“兼容 OpenAI”或“返回 2xx”不构成确认。

### 7.2 运行期 text 合同

运行期输出必须是以下五个 root key，且严格闭合：

~~~~json
{
  "schemaVersion": "galgame.visual-runtime-hints.v1",
  "status": "ready",
  "dictionaryVersion": 2,
  "dictionaryHash": "sha256:<从当前服务源码读取>",
  "entities": [
    {
      "entityType": "scene",
      "codes": ["scene.forest"],
      "confidence": 0.86,
      "confidenceBand": "probable"
    }
  ]
}
~~~~

运行期规则：

- root 只允许 schemaVersion、status、dictionaryVersion、dictionaryHash、entities。
- 每类 entityType 最多一个实体。
- codes 为 1 至 8 个唯一字典 code。
- confidence 是 0 至 1 的有限 JSON number。
- confidenceBand 只能是 unknown、weak、probable、explicit。
- status 为 ready 时必须有可用 entities。
- status 为 unavailable 或 ambiguous 时 entities 必须为空。
- 不得返回 assetId、URL、路径、剧情、选择、关系、装备获得或新字段。
- dictionaryVersion 和 dictionaryHash 必须与当前服务源码完全一致。

### 7.3 合同签署记录

Provider 交接人必须填写：

- endpoint 实际 URL 形态和归一化规则
- model 名称
- 请求认证头
- 上传 vision 响应完整脱敏样例
- 运行 text 响应完整脱敏样例
- 每个字段的类型、必填性和取值范围
- 失败字段的修正方案
- Provider 侧发布时间和版本标识
- 是否需要本地适配器变更
- 变更后重新验证的 request/response digest

记录模板见 Provider 合同交接文档；机器可读模板为 docs/AI_GALGAME_VISUAL_RUNTIME_4_PROVIDER_CONTRACT_RECORD_TEMPLATE.json。

## 8. D2：验收脚本兼容性门

现有 `frontend/tools/visual-real-st-final-acceptance-smoke.mjs` 仍包含 VS-CODE-3C、visual-bundle 和历史 visual asset ticket/binding 语义，只能作为历史/预检工具。当前 v2 本地浏览器合同使用 `frontend/tools/visual-runtime-4-browser-smoke.mjs`；它只使用 test-only service fixture，不能代替真实 ST/Provider。

### 审计步骤

1. 确认脚本访问的 route 是当前 RUNTIME-4 v2 core decision surface。
2. 确认脚本不构造历史 bundle、ticket、binding、projection proof 或 old-save DTO。
3. 确认脚本只读当前 /game/、visual-asset-service 和当前 manifest/Arc context。
4. 确认脚本使用真实 target chat readback，不写固定本地剧情。
5. 确认脚本证据字段能记录当前 v2 schema、understandingStatus、errorCode、decision、placeholder 和网络泄漏结果。
6. 若任一项仍指向 VS-CODE-3C 旧合同，脚本只能作为历史/预检工具，不得作为 RUNTIME-4 通过证据。
7. 需要修改脚本时，先新增 RUNTIME-4 compatibility gate 和测试，再修改代码；不得为了通过验收删除旧断言或降低门槛。
8. 本地 v2 浏览器合同验证命令为 `node frontend/tools/visual-runtime-4-browser-smoke.mjs`，其 evidence 必须标记 `testDouble=true`；真实 ST 验收仍需独立的真实 target chat、manifest/Arc 和 Provider 前置。

放行条件是：脚本 route、输入、输出、证据字段和当前规格逐项对应，并且能在失败时保留现场。

## 9. D3：本地适配器和回归

### 9.1 代码审计

只检查以下链路：

~~~~text
OpenAI Chat Completions response（legacy Anthropic parser remains compatibility）
  -> duplicate/BOM/size parser
  -> envelope/content parser
  -> closed JSON parser
  -> field validator
  -> normalized analysis
  -> v2 catalog/migration input
~~~~

逐项确认：

- 解析顺序先做大小、BOM、重复 key 和 JSON 合法性检查。
- provider 原文不进入日志、响应、cache 或 evidence。
- 未知字段、缺字段和值错误有固定 errorCode。
- 不自动补字段、不重标度 confidence、不猜 code。
- 上传失败保留 PNG 和 draft，不创建 ready analysis。
- 运行期失败生成合法 placeholder understanding，不生成伪造实体。
- 失败结果不进入成功 cache。
- token 只存在 child process environment。

### 9.2 本地命令

~~~~cmd
:: Run these commands from the repository root
node --check external-modules/visual-asset-service/server.mjs
node --check external-modules/visual-asset-service/test.mjs
node external-modules/visual-asset-service/test.mjs
node frontend/shared/tests/visual-system-schema.test.mjs
node frontend/shared/tests/sillytavern-visible-chat.test.mjs
node frontend/player/tests/visual-presentation.test.mjs
node frontend/player/tests/core-final-acceptance.test.mjs
node frontend/tools/static-architecture-audit.test.mjs
node frontend/tools/visual-runtime-4-browser-smoke.mjs
git diff --check -- docs frontend public/game public/game-admin external-modules .codex-longrun
~~~~

### 9.3 D3 放行条件

- 所有命令 exit 0。
- 覆盖合法五字段 response、缺字段、未知字段、重复字段、BOM、非法 code、confidence 类型/范围、HTTP 状态和超时。
- 现有 RUNTIME-1/2/3 回归保持通过。
- architecture audit 的 prohibitedActive、needsReview 和 failedChecks 均为 0。
- 没有改动 frozen boundary。

## 10. D4：v1→v2 migration dry-run

### 前置

- D1 Provider 合同已确认。
- D3 本地 fixture 和真实配置解析通过。
- 当前 legacy active catalog 的 pointer、control 和 published refs 已备份为可读摘要。
- 所有 published asset 都能被 FileVisualAssetStore 读取。
- 操作者确认 dry-run 不写 active catalog、active pointer、control 或 migration batch。

### 命令

~~~~cmd
:: Run these commands from the repository root
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --dry-run
~~~~

### dry-run 必须检查

- 五类素材全部纳入计划。
- 每个素材生成 ready v2 analysis，dictionaryVersion 与 dictionaryHash 一致。
- content hash、metadata hash、catalog refs 和 asset key 一致。
- 不创建新 active-migration.json。
- 不改变 legacy active catalog、legacy pointer、visual-control。
- 输出只有 ok、mode、脱敏 pointer identity、asset count、readiness 和固定 errorCode。
- 输出不含 token、Provider response、任务文本和原始异常。

dry-run 失败时保留 legacy active catalog，记录固定 errorCode，停止 D5。

## 11. D5：v1→v2 migration execute

D5 必须由操作者单独批准。普通服务启动不会自动执行迁移。

### 命令

~~~~cmd
:: Run these commands from the repository root
node external-modules/visual-asset-service/server.mjs --migrate-runtime-v2 --execute
~~~~

### execute 过程

1. 服务从当前 active FileVisualAssetStore 读取 catalog 和所有 published refs。
2. 生成 service-owned temporary batch。
3. 写入完整 v2 asset records、catalog 和 commit marker。
4. 读回并校验 batch。
5. 同步文件后完成 rename。
6. 写入 root active-migration.json pointer。
7. 更新 visual-control 指向新 catalog。
8. 重新初始化 FileVisualAssetStore，验证 restart readback。

### 失败语义

- 任一素材分析不可用，拒绝 execute。
- 任一 hash/ref/catalog/control/pointer 校验失败，拒绝 execute。
- 失败删除未提交 batch。
- legacy catalog、legacy pointer、enabled 状态和 control 文件保持不变。
- 不删除 legacy records。
- 不把部分 batch 标记为 active。
- 重启只接受完整 batch 和合法 pointer。
- 进程级 pointer-commit 语义通过后，仍不宣称全平台 crash-level atomicity。

## 12. D6：真实外部前置

真实 RUNTIME-4 之前必须逐项确认：

- 独立 Provider token 由操作者通过隐藏输入提供。
- real ST 服务可用。
- original-runtime-bridge 可用并指向相同 ST。
- 当前 active release 可读。
- 当前 manifest 包含有效 SillyTavern bindings。
- 当前 Arc 的 visualPresentation/profile scope 已准备。
- active catalog 为 v2 且 content 可读。
- visual-asset-service health 为 200。
- 真实 target chat 可读，且可证明 visible text 已写入 target chat。
- 当前启动进程加载的源码 commit 与 evidence 中记录一致。
- 桌面和移动静态资源来自当前源码构建。

缺少任何一项，只记录 blocker，不进入 D7。

## 13. D7：一次受控实时验收

### 启动

使用仓库根目录：

~~~~text
external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd
~~~~

规则：

- 只在隐藏输入中输入一次独立视觉服务密钥。
- 不把 token 输入 cmd、PowerShell PTY、URL、参数、文件、浏览器表单或日志。
- wrapper 清理父进程同名环境变量。
- child 仅拥有 analyzer/runtime 两个服务端 token 环境变量。
- 进程退出后清理临时引用。
- 浏览器请求不得带 Authorization 或 provider URL。

### 实时调用顺序

1. 记录服务健康和进程 commit。
2. 读取 active release、manifest、Arc 和 published catalog。
3. 上传一张已确认的真实 PNG，等待分析结果。
4. 只在 analysisStatus=ready 且 v2 字典/hash 正确时继续。
5. 从 real ST target chat 读取已经显示的对白。
6. 发送 visibleContext 到当前 v2 core decision surface。
7. 记录脱敏的 understandingStatus、errorCode、decision scoreBand 和 asset identity。
8. 对白先显示，视觉请求异步完成。
9. 不重复发送同一不明结果，不追加无限重试。
10. 保留失败页面、日志摘要和 evidence。

实时证据不得保存 Provider response body、固定任务文本、ST key、token、角色卡、世界书或隐藏 prompt。

## 14. D8：真实浏览器矩阵

必须使用当前 /game/、真实 visual-asset-service、真实发布素材和当前 manifest/Arc。

| 用例 | 可见对白 | 期望 |
| --- | --- | --- |
| R4-B01 | 众人走进雾气笼罩的废弃森林 | 森林/遗迹候选达到 60，显示具体背景 |
| R4-B02 | 敌人施放火球术 | 火球技能候选达到 60，显示具体技能图 |
| R4-B03 | 他使用了魔法 | 泛化、低置信度或无具体 code，显示统一占位图 |
| R4-B04 | 与视觉素材无关的普通对白 | 保留当前已验证画面，不误切换 |
| R4-B05 | Provider 关闭或超时 | 对白正常显示，视觉使用占位图或保留规则 |
| R4-B06 | 新对白快速到达 | 旧请求不能覆盖新对白的画面 |
| R4-B07 | 移动端 390x844 | 无横向溢出，技术字段不可见 |
| R4-B08 | Network 检查 | 无 Provider URL、Authorization、ST key、隐藏上下文 |

每个用例都记录 current message hash、recent hash、requestId、understandingStatus、errorCode、scoreBand、assetId 是否为空、最终展示类型和 evidence path。

## 15. D9：证据和独立审计

### 必须回读

- 当前 source commit 和实际启动进程 commit。
- state.json、progress.md、blockers.md。
- 本轮所有 evidence JSON。
- service、shared、player、architecture 和 browser 命令结果。
- frozen boundary diff 和 git diff --check。
- 浏览器网络摘要和页面展示摘要。

### 必须审计

- JSON UTF-8、无 BOM、可解析、ok 字段语义正确。
- evidence 不含 token、ST key、Provider body、任务文本或隐藏上下文。
- 失败证据保留，不覆盖历史失败。
- 当前阶段仍为 verifying，除非 D1-D9 全部通过。
- 旧 VS-CODE-3C、历史 Projection/proof/ticket/binding/old-save 证据未被计入当前 RUNTIME-4。
- 没有通过降低阈值、删除断言、增加无限重试、自动迁移或绕过 bridge 来获得通过。

## 16. 停机和恢复规则

遇到以下任一情况立即停机：

- Provider 合同不完整或前后不一致。
- provider 2xx 但 schema 仍失败且失败字段未知。
- 需要猜字段、补字段、重标度 confidence 或放宽 validator。
- active catalog、control 或 pointer 不一致。
- 实际进程 commit 无法确认。
- real ST target chat、manifest、Arc 或 bridge 无法证明。
- 浏览器出现 Provider URL、token、ST key 或隐藏资源。
- 视觉错误阻塞对白。
- 需要修改 frozen boundary。
- 旧历史 gate 被用来替代当前 v2 证据。

恢复时：

1. 保存当前进程和日志摘要。
2. 保留 active legacy/v2 数据，不删除现场。
3. 写入 blockers.md 固定类别和时间。
4. 只修根因，不做临时旁路。
5. 修复后从对应门重新开始，不跳门。

## 17. 最终交付口径

只有在 D9 完成且独立审查通过后，才能写：

> VISUAL-RUNTIME-4 在当前源码、当前 Provider 合同、当前 manifest/Arc 和当前 published v2 catalog 上完成真实受控验收。

在此之前只能写：

> VISUAL-RUNTIME-4 已完成文档、合同审计和本地验证；真实 Provider、真实 ST 和生产图片展示仍处于 verifying 或 blocker。

严禁写：

- 完整 Galgame 已完成。
- 所有对白都必然有图片。
- ST 后端已被改造。
- 旧 VS-CODE-3C gate 等于当前 RUNTIME-4。
- 测试替身等于生产 AI。

## 18. Doubao provider adapter implementation record

### 18.1 实际配置

受控入口 `external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.ps1` 默认从仓库根目录的私有 `.env.local` 读取（也可通过 `GALGAME_VISUAL_PROVIDER_ENV_FILE` 指定其他本地文件）
`REFERENCE_VISION_BASE_URL`、`REFERENCE_VISION_MODEL` 和 `REFERENCE_VISION_API_KEY`。配置校验
只允许 HTTPS origin；重复 key 采用最后一个非空值；key 只存在 child process。

### 18.2 上传期 adapter

`openai_chat_completions_vision` 将 `/v1` 归一化为 `/v1/chat/completions`，发送 Bearer、
json_object、PNG data URL 和闭合五字段任务。parser 严格检查 choices/message allowlist、
JSON 重复 key、嵌入 JSON 五字段、assetType 字典 code、description、confidence 和版本。

### 18.3 运行期 adapter

`openai_chat_completions_text` 发送固定 system 合同和 current/recent visibleContext。system
合同携带当前 dictionary version/hash、全部有限 code、lowercase 枚举和每类单实体规则，
避免依赖未确认的 provider 字段猜测。返回仍必须通过 `assertRuntimeHint`，分数和资源选择
继续由 deterministic scorer 执行。

### 18.4 已完成证据

- service suite 新增 OpenAI vision/text fixture，包含 payload、Bearer 隔离和闭合解析断言。
- 真实 Doubao 上传 `default_Seraphina.png` 已得到脱敏 ready analysis；空白图片按固定错误拒绝。
- 真实 runtime 合同探针已得到 exact root schema；真实 ST target-chat E2E 仍待单独门禁。
- 临时 provider probe、debug log 和凭据均未保留在仓库。
