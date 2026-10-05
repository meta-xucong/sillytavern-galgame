# VISUAL-RUNTIME-4 Live Acceptance and Controlled Startup

> 文档版本：v1.0
> 文档状态：受控启动入口 implementation verifying；真实 provider/ST 仍未验收
> 生效日期：2026-09-06
> 上位规范：`docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md`

## 1. 当前目标

本文件只收束 RUNTIME-4 的真实实测准备。目标是让自有
`visual-asset-service` 在服务端复用本机已配置的 Doubao OpenAI-compatible provider，分别完成：

1. 上传期 `openai_chat_completions_vision` 图片识别与闭合标签保存；
2. 运行时 `openai_chat_completions_text` 可见对白视觉意图提取。

provider 合同已由 `docs/AI_GALGAME_VISUAL_RUNTIME_4_PROVIDER_CONTRACT_HANDOFF.md` 第 9 节确认；
真实 ST/bridge/catalog 验收仍是独立门禁。

两条调用都只能由视觉服务发起。浏览器、玩家页、public 构建物和
SillyTavern 不接触该 token；运行时模型只返回视觉 hint，不生成剧情、不改聊天、不写存档。

## 2. 受控启动入口

Windows 操作者使用仓库根目录的：

```text
external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd
```

入口优先读取本机已配置的 `.env.local`，不再重复索取密钥；只在 provider 配置缺失时使用隐藏输入回退，并在 child process environment 设置：

```text
GALGAME_VISUAL_PROVIDER_ENV_FILE=<optional private config path; defaults to repository .env.local>
GALGAME_VISUAL_ANALYZER_BASE_URL=https://aiself.vip/v1
GALGAME_VISUAL_ANALYZER_MODEL=doubao-seed-2-0-lite-260428
GALGAME_VISUAL_ANALYZER_REQUEST_STYLE=openai_chat_completions_vision
GALGAME_VISUAL_ANALYZER_TOKEN=<dotenv child-only value>
GALGAME_VISUAL_RUNTIME_BASE_URL=https://aiself.vip/v1
GALGAME_VISUAL_RUNTIME_MODEL=doubao-seed-2-0-lite-260428
GALGAME_VISUAL_RUNTIME_REQUEST_STYLE=openai_chat_completions_text
GALGAME_VISUAL_RUNTIME_TOKEN=<same child-only value>
GALGAME_VISUAL_ANALYZER_CACHE_SCOPE=controlled-analyzer-test-doubao-v1
GALGAME_VISUAL_RUNTIME_CACHE_SCOPE=controlled-runtime-live-v1
```

普通 `external-modules/process-supervisor/launchers/StartGalgameVisualAssetService.cmd` 不携带 token，只能启动未配置 analyzer 的
本地服务；此时上传仍可保存图片，但 analysis/runtime 状态为 unavailable，不能声称
生产 AI 已启用。

受控入口的硬性安全条件：不继承父进程同名 token，不回显、不写日志、不写文件、不写
localStorage、不注入 HTML/JS；child 结束后清理 wrapper 内存和环境变量。服务只绑定
loopback，admin 页面仍使用本地 session/CSRF facade，浏览器请求不得有 `Authorization`
或 provider 请求。Doubao 适配器只在服务端向 OpenAI-compatible endpoint 发送 Bearer，
浏览器和 player UI 永远看不到 provider origin、Authorization、key 或 response body。

## 3. 验收边界

真实验收必须使用已有服务和通过 `docs/AI_GALGAME_VISUAL_RUNTIME_4_HARNESS_COMPATIBILITY_GATE.md` D2 审计的当前 v2 harness。`frontend/tools/visual-real-st-final-acceptance-smoke.mjs` 仍命中 VS-CODE-3C、visual-bundle、binding 或 ticket 旧合同，只能作为历史/预检工具，不能生成当前 RUNTIME-4 通过证据；`frontend/tools/visual-runtime-4-browser-smoke.mjs` 是当前 v2 的 test-only 浏览器合同 smoke，不能替代真实 ST/Provider 验收。当前验收必须证明 v2 core decision route、visibleContext、understandingStatus、placeholder 和浏览器无凭据泄漏。
不得手造 bundle、聊天、manifest、profile 或本地故事，也不得使用 ST key、ST prompt/context/
resource body、Projection/proof/ticket/binding/old-save、运行时剧情 LLM 或历史重型路由。

在 real ST、existing bridge、有效 published catalog/content 和当前 manifest/Arc
`visualPresentation` context 均可用前，不运行或宣称完整 E2E。缺任一前置时记录 blocker，
保留玩家恢复态。

## 4. 生产与 test-only 口径

- 受控入口会复用 `.env.local` 中的 Doubao key，但只在 child process 内存和环境中存在；日志/evidence 不记录值。
- 本地 service suite 使用 test-only fixture 验证 closed vision/text adapter、缓存、失败恢复和无泄漏；另有受控 Doubao probe 证明真实 provider 合同，这两者都不等于真实 ST 全链路证据。
- 若操作者自行提供独立 analyzer token，真实调用结果必须脱敏记录 digest/status/timing，
  不保存 token、原始 provider response、固定任务文本或 ST 数据。
- 上传分析的 provider 非 2xx 只按 HTTP status 映射为固定错误类别：认证、请求/路径/模型、
  限流或上游错误；不记录 provider response body。
- Anthropic Messages 的 envelope、content block 和闭合输出也分别使用固定的
  `ANALYZER_ENVELOPE_INVALID`、`ANALYZER_CONTENT_INVALID`、
  `ANALYZER_OUTPUT_INVALID`；OpenAI `choices` envelope、多 content block、非 text
  block、重复/未知输出字段均 fail-closed，不降级成可用标签。
- 闭合输出内部再按 unknown field、missing field、value 和 dictionary code 分为
  `ANALYZER_OUTPUT_UNKNOWN_FIELD`、`ANALYZER_OUTPUT_MISSING_FIELD`、
  `ANALYZER_OUTPUT_VALUE_INVALID`、`ANALYZER_OUTPUT_CODE_INVALID`；这些只是脱敏
  分类，不代表接受了 provider 输出。
- value 类失败继续细分为 description、codes、confidence、analyzerVersion 和
  duplicate-codes 固定类别；只记录类别，不回显字段值或 provider 正文。
- 固定识图任务明确要求 `confidence` 为 `0 < confidence <= 1` 的 JSON number；百分数、
  字符串、零、`NaN`、`Infinity` 不做静默换算，直接 fail-closed。
- 为兼容已持久化的旧失败记录，readback 仍允许旧 `ANALYZER_OUTPUT_CONFIDENCE_INVALID`；
  新响应只使用 type/range 固定分类，不重写旧记录或放宽校验。
- Anthropic vision 请求固定 `temperature: 0`，并在任务中给出包含五个字段的完整 JSON 模板；
  缺字段仍直接拒绝，不补默认值。
- provider envelope 或嵌入 JSON 的重复 key 单独归类为
  `ANALYZER_OUTPUT_DUPLICATE_FIELD`，禁止采用重复字段的任一值。
- 当前只读诊断显示 `aiself.vip` DNS/TLS 可达，但无凭据 `GET /v1/models` 返回 401。
  此前 Ark/Sub2API 的 200 属于不同的 OpenAI-compatible 路由/认证合同，不能推断 AISelf
  的 `/v1/messages` 已可用；本阶段只记录脱敏状态类别。
- `ST story/Generate/readback` 与当前 manifest/profile scope 是外部前置，不由此入口绕过。

## 5. 停止条件

启动脚本、服务 suite、静态安全检查、state/diff/protected/stale/inventory 通过后，阶段仍
保持 `verifying`。只有在操作者明确提供独立 token、真实 ST/bridge/target chat 和有效
manifest/profile context 后，才可运行一次 real acceptance；否则停止，不扩展 provider
生态，不修改玩家/shared/ST 或历史链路。

## 5. Doubao provider adapter audit addendum

- `external-modules/process-supervisor/launchers/StartGalgameVisualAnalyzerTest.cmd` now discovers the configured provider automatically; a normal launch logs only source=dotenv, host, model and request styles.
- Analyzer uses `openai_chat_completions_vision`; runtime uses `openai_chat_completions_text`; both normalize `/v1` to `/v1/chat/completions` and validate URL origin.
- Analyzer parser accepts only one OpenAI `choices` item with assistant string content, then validates the exact five-field closed output.
- Runtime prompt carries the current dictionary version/hash, lower-case enum contract, one entity per type rule and full allowed code set so Doubao output can pass the local validator without guessed fields.
- A real default_Seraphina PNG produced ready analysis through Doubao; a blank 16×16 PNG produced the expected fixed value failure because it had no usable tags.
- Provider compatibility is now verified; remaining acceptance gates are real ST target-chat visibility, bridge delegation, published catalog/content and browser presentation.
