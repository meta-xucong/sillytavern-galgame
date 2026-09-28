# VISUAL-RUNTIME-4 真实运行时验收准入准备

> 文档版本：v1.0
> 文档状态：Anthropic runtime adapter reviewer-passed/done（仅 adapter/local contract）；受控 live acceptance launcher implementation verifying；未授权真实 provider 激活
> 生效日期：2026-09-05
> 前置阶段：`VISUAL-RUNTIME-3` reviewer-passed/done（仅玩家自然对白接线与统一占位展示）

## 1. 目的与当前状态

RUNTIME-4 已完成并通过独立复核的范围仅是服务端 Anthropic Messages runtime adapter 与 local contract；当前新增的受控启动入口只负责把同一份独立 token 安全注入上传期 vision 与运行时 text 两套服务端环境，真实独立 analyzer、真实视觉服务和真实 SillyTavern 协作验收仍是后续外部准入边界。实现与安全检查见 `AI_GALGAME_VISUAL_RUNTIME_4_LIVE_ACCEPTANCE.md`。
RUNTIME-3 已通过独立复核，完成范围仅包括：已渲染自然对白的 v2 请求、最多三条 recent、
五类 neutral slot、异步具体图展示、统一本地 placeholder，以及普通无新视觉意图对白保留
已验证展示。RUNTIME-2 整体仍 partial/blocked；本文件不把生产 AI 或完整视觉系统标为完成。

## 2. 外部前置条件

- 独立 analyzer 必须由自有 visual-asset-service 服务端配置和调用；只允许该服务自己的
  `GALGAME_VISUAL_ANALYZER_BASE_URL`、`GALGAME_VISUAL_ANALYZER_TOKEN`、
  `GALGAME_VISUAL_ANALYZER_MODEL` 等环境变量。不得读取、复制或推断 ST key/config。
- 浏览器不得请求 analyzer/provider，不得看到 Authorization、token、模型名或原始响应。
- visual-asset-service 必须有可读的 published catalog、合法 profile/catalog context 和真实
  content route；当前 manifest/profile auto-binding 缺口必须先由单独准入解决，不在本文件绕过。
- ST、existing bridge、真实 target chat、Generate/readback 和恢复路径必须由真实部署提供；
  ST 不可用时只能显示恢复态，不得使用本地剧情或 test-double 冒充。

当前事实 blocker：生产 analyzer 未配置；workspace ST story/Generate 尚不可用；上传发布不会
自动修改当前 manifest/Arc `visualPresentation`。这些 blocker 未被本阶段 adapter 实现清除。

## 3. 未来准入后的验收命令

适配器实现完成且真实前置可用后，才可运行既有 harness；本阶段不真实调用 AISelf：

```text
node frontend/tools/visual-real-st-final-acceptance-smoke.mjs --st-base-url <real-st> --game-base-url <real-game> --game-config-base-url <real-config> --visual-asset-base-url <real-visual> --target-chat-id <real-chat> --evidence <path>
```

如需创建临时目标消息，必须显式使用 `--write-target-message true`，并证明只清理 harness
新建 chat；不得删除用户提供的 target chat。`--self-test true` 只证明本地合同，不能代替真实 ST。

准入前可重复的本地检查包括：

```text
node external-modules/visual-asset-service/test.mjs
node frontend/player/tests/visual-presentation.test.mjs
node frontend/player/tests/core-final-acceptance.test.mjs
node frontend/tools/static-dom-smoke.mjs
node frontend/tools/static-architecture-audit.mjs
python C:/Users/T14S/.codex/skills/long-running-task/scripts/validate_state.py --project .
```

## 4. RUNTIME-4 必须证明的内容

1. 真实 analyzer 对自然对白返回 closed runtime hint，visible normalized codes 与图片分析
   tags exact overlap 后，五类具体图按 `score >= 60` 展示；低分、无证据、坏分析、超时、
   服务失败统一回退 placeholder。
2. 重启、缓存、幂等、content hash、无 provider、无 ST key、无浏览器 provider 请求均有证据。
3. 真实 ST chat seed/Generate/readback 仍由 ST 原版语义和既有 bridge 承担；玩家只展示自定义
   UI，失败时保留上下文并提供恢复，不生成本地故事。
4. 桌面/移动无横向溢出，聊天、输入、Generate、save/load 不被视觉请求阻塞。

## 5. 禁止与停止条件

- 当前阶段只允许修改 `external-modules/visual-asset-service/server.mjs`、`test.mjs`、`README.md` 与
  `docs/.codex-longrun`；不得激活真实 provider，不索要 ST key，不修改 ST/backend、original public、
  root deps/startup、admin、player、shared 行为或 manifest/profile。
- 不恢复 Projection/proof/stub/ticket/binding/old-save/rollback、VS/2B/3C/VS-LLM 或玩家运行时 LLM。
- 真实 analyzer、真实 ST story/Generate、manifest/profile context 任一缺失时停止并记录 blocker；
  不得把 fake analyzer、本地 fixture 或 `--self-test` 写成 RUNTIME-4 PASS。
- RUNTIME-4 的 Anthropic 适配器实现已通过测试和独立复核并收口为窄阶段；真实验收即使未来通过，也不代表完整 Galgame 或整个
  SillyTavern 完成。
