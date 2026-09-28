# VISUAL-RUNTIME-4 完成记录（2026-09-27）

## 1. 交付结论

RUNTIME-4 的 Doubao 受控真实验收已通过。当前视觉运行时能够在真实浏览器中：

1. 从玩家已经看到的对白构造可见上下文；
2. 通过服务端 Doubao OpenAI 兼容适配器提取视觉意图；
3. 对五类实体执行确定性匹配与 60 分门槛；
4. 达标时读取已发布图片并显示，未达标或不可用时显示统一占位图；
5. 保持原版 SillyTavern 生成、聊天、世界书和桥接授权为权威。

本次验收没有使用测试替身，也没有把 provider 密钥发送到浏览器或 ST 后端。

## 2. 运行与数据基线

- 分支：`verya-main`
- 视觉服务：`http://127.0.0.1:8798`
- 核心接口：`/v1/core/visual-context`、`/v1/core/visual-decisions`
- provider：Doubao，模型 `doubao-seed-2-0-lite-260428`
- 适配器：`openai_chat_completions_vision_and_text`
- provider 配置：由 `StartGalgameVisualAnalyzerTest.ps1` 从本地 dotenv 注入子进程
- 运行时超时：受控验收为 15000 ms；schema/JSON/dictionary 失败最多重试一次
- 发布目录：`catalog_simple_dcb8fd761ee6` revision 1
- catalog hash：`sha256:e929e7fb065e3a7d8434b63068ae0dba49cf2001ee1797281033bcc63550dbd8`
- 资产：18 个，18/18 ready，18/18 published
- 字典：version 2

## 3. 真实浏览器证据

证据文件：

`.codex-longrun/evidence/visual-runtime-4-real-browser-20260927.json`

关键观测：

- `visual-context` HTTP 200；
- `visual-decisions` HTTP 200；
- `understandingStatus=ready`；
- `usesLlm=true`；
- 五类实体决策均返回；
- 场景图片 content 请求 HTTP 200；
- 页面 stage 类名为 `stage-backdrop is-visual-active`；
- 图片地址来自视觉服务的 catalog content 路径；
- 占位图回退路径仍保留。

## 4. 原版 ST 真实剧本验收

使用已存在的 Dungeon Master 剧本执行两回合真实浏览器 smoke：

- scenario：`galgame-imported-dungeon-master-entry`
- version：`0.1.0`
- arc：`dungeon-master-fighter-campaign`
- chat seed：`galgame-imported-dungeon-master-fighter-seed`
- 原版 ST 生成：成功，生成文本存在；
- bridge authorization：`allowed`；
- worldbook：`Galgame_Imported_Dungeon_Master_DnD_Base`；
- Lucifer worldbook：未观察到；
- 两回合状态推进和中文回复：成功；
- 进程退出码：0；
- failures：空数组。

## 5. 最终测试门禁

已通过：

- `node external-modules/visual-asset-service/test.mjs`
- 玩家四项 node test：chat history、CORE-5、presentation matrix、visual presentation
- Dungeon Master player-only browser smoke
- Dungeon Master live original-runtime two-turn smoke
- server/player/public 三个目标文件 `node --check`
- `git diff --check`
- 核心接口 Origin 检查：HTTP 200、`galgame.visual-core-context.v1`
- 状态 JSON 与实时证据 JSON 解析校验

视觉服务测试中的三个 symlink regression 在 Windows 环境因 EPERM 跳过；其余断言通过。

## 6. 兼容性边界与后续操作

旧的 `visual-real-st-final-acceptance-smoke.mjs` 仍等待历史接口 `/v1/player/visual-bundle`，而当前实现使用 `/v1/core/visual-decisions`。该旧 harness 已 fail-closed 并记录为过时门禁，不代表当前产品路径失败。

后续每次更换 provider、模型或发布 catalog 后，必须：

1. 使用受控 launcher 启动视觉服务；
2. 运行服务套件和玩家套件；
3. 运行两回合 Dungeon Master 真实浏览器 smoke；
4. 核对实时证据中的 `testDouble=false`、`usesLlm=true`、content 200 和 `is-visual-active`；
5. 保留旧 catalog 与迁移备份，不得 reset、clean 或覆盖工作区。

长期状态已同步到 `.codex-longrun/state.json`，阶段为 passed。