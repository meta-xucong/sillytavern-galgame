# Galgame 稳定性与 HUD 改造验收记录（2026-10-03）

## 结论
本轮源码改造、player 构建、自动化回归、静态架构审计及隔离浏览器验收完成。
整体产品验收仍为部分完成：独立审计没有终态意见，运行桥的新源码尚未确认加载到实际进程；不能标为全部验收通过。

## 交付范围
开发文档：`docs/GALGAME_STABILITY_AND_HUD_DEVELOPMENT_2026-10-03.md`。
基线 HEAD：`36f4596662a3bc91b691221cb55d18a51e0b426d`；原工作树全部保留，无提交/推送。
本轮基线、差异、日志、回执：`.codex-longrun/stabilize-20261003-r2/`。
最终源码与产物哈希：`final-r4-output-hashes.json`；差异：`final-r4.diff`。

## 已实现
1. 视觉测试等待本次渲染 Promise；修正 DOM 替身，不再用历史请求计数和固定 sleep 假定渲染完成，非法地址拒绝断言保留。
2. 装备、道具、技能从原版可见文本分别提取；图片匹配不能发明文字明细。
3. 普通对白保留最近明确记录并标注历史来源；明确空记录覆盖旧记录，缺图仍能查看名称与详情。
4. 编辑、删除、swipe、切分支、读档按当前快照重新计算，不创建持久化库存/剧情状态，不读取未来消息。
5. 背包中的武器保留原分组，不丢失、不冒充消耗品，也不推定已装备。
6. 已变化或明确清空的明细立即失效旧图标；独立合法人物绑定继续遵守原通道规则。
7. 桌面/手机卡片将物品名称与“最近记录”分行，详情显示原消息来源。
8. 静态审计改为识别实际原版生成终态与绑定读回委托，并增加 10 项正反例，不再只检查废弃函数名。

## 自动化结果
`full-suite-r4.receipt.json`：退出码 0，30 个测试文件，95 项通过、0 失败；运行期间源码哈希稳定。
其中 HUD 记录专项 19 项，运行桥生成生命周期专项 15 项，静态读回守卫专项 10 项。
视觉服务手写测试内部仍跳过 3 个 Windows EPERM 符号链接用例；Node 汇总 skipped=0 不包含这些手写跳过，不能把它们计为通过。
`architecture-audit-r4.receipt.json`：退出码 0，prohibitedActiveCount=0，needsReviewCount=0。
`player-build-r4.receipt.json`：仅构建 player 成功；未改原版 ST 前端或后端。

## 浏览器与真实链路
`browser-ui-r4.receipt.json` / `browser-receipt.json`：实际 Chrome 加载本机已构建 `/game/`，桌面 1440×900、手机 390×844 各回放 20 次消息；名称、历史标注、详情和明确清空正常，无横向溢出。
浏览器回放禁用 provider fetch；它不是 20 轮真实模型对话。截图为 `ui-desktop.png`、`ui-mobile.png`。
`live-receipt.json`：另行使用唯一隔离聊天，经配置服务 proof、原版运行桥及原版目标聊天读回完成 1 轮真实生成。
该轮约 32 秒，桥报告 provider=claude、model=claude-sonnet-4-6；sameTargetReadback=true、seedUnchanged=true。
隔离聊天：`audit-galgame-r2-1791004072049-4da46388`。测试没有使用玩家正在游玩的聊天作为输入目标。
实际桥进程的启动时间早于 generation-lifecycle 源码更新，因此这轮只能证明当前运行实例的文本链路，不能替代新桥源码的实际部署验收。

## 独立审计状态
已通过本机 Codex 启动独立只读审计，保存 thread、请求路由、实际 turn_context 的 model/effort 和源哈希；实际元数据为 gpt-6-luna/max。
三次执行未取得最终审计意见：先后发生请求超时/重连，以及连接拒绝（os error 10061）。回执为 `audit-receipt*.json`，过程为 `audit-events*.jsonl`。
不得把审计任务启动、实际模型设置、部分读取结果或静态审计 PASS 当成独立审计 PASS。
最终携带武器保真修正已做代码自审和完整 r4 回归，但没有新的独立终态意见；独立审计保持未完成。

## 运行桥更新与数据完整性限制
为加载已修复的桥源码，先申请既有 shutdown gate；忙时收到 409 后不进行中断。
随后一次获得 gate，但精确进程身份检查未取得唯一可信对象，停止阶段失败关闭；没有据端口/PID 猜测终止进程。既有启动器返回不代表新实例部署成功。
回执：`bridge-restart-receipt.json`、`bridge-restart-stop.log`、`bridge-runtime-age.json`；最后健康检查仍可用，新版桥加载未确认。
全库聊天指纹观察期间存在其他聊天活动：已有游玩聊天新增非本测试输入，另有非本测试文件曾新增。详见 `live-chat-integrity.json` / `concurrent-chat-metadata.json`。
因此没有把“全库非目标聊天零变动”标为通过；本轮自己的新目标读回和原开场不变已有独立校验。没有执行删除、覆盖现有聊天或恢复其他会话的操作。
后续只应在运行桥空闲且进程身份可验证时加载新桥，随后对该版本进行隔离生成、连续游玩及非目标聊天一致性验收；不能绕过上述保护。

## 最终一致性核验
`final-integrity-r4.json` 确认最终源码/产物冻结后未变化；本轮检查的 118 个 ST 冻结文件全部保持基线哈希；`git diff --check` 退出码 0。
最终 r4 的整套回归、构建、静态审计和浏览器测试回执均为 finished=true、exitCode=0、sourceStable=true。
最终报告明确保留 independentAuditAccepted=false、newBridgeRuntimeAccepted=false，不以部分成功覆盖未完成门槛。
