# VISUAL-RUNTIME-4 文档包索引

> 文档包状态：development handoff + local verification；本轮只新增当前 v2 test-only harness，未改变 Provider、SillyTavern 后端或现有运行时数据。
>
> 适用分支：verya-main
> 当前基线：b3b7bfa5a2eda9aee0294afb80cc85ca7ebf39a3
> 当前阶段：VISUAL-RUNTIME-4 AISelf live closed-schema compatibility diagnosis
> 当前状态：verifying

## 1. 使用顺序

按下面顺序阅读和执行：

1. 本索引，确认范围、权威文件和停止条件。
2. [开发运行手册](AI_GALGAME_VISUAL_RUNTIME_4_DEVELOPMENT_RUNBOOK.md)，按门禁顺序推进。
3. [Provider 输出合同交接文档](AI_GALGAME_VISUAL_RUNTIME_4_PROVIDER_CONTRACT_HANDOFF.md)，向 Provider 方取得明确合同。
4. [验收脚本兼容性门](AI_GALGAME_VISUAL_RUNTIME_4_HARNESS_COMPATIBILITY_GATE.md)，确认实测脚本没有把历史 VS-CODE-3C 路径当成当前 RUNTIME-4。
5. [测试矩阵](AI_GALGAME_VISUAL_RUNTIME_4_TEST_MATRIX.md)，逐项执行本地、迁移、实时和浏览器检查。
6. [证据与审计清单](AI_GALGAME_VISUAL_RUNTIME_4_EVIDENCE_AUDIT_CHECKLIST.md)，生成、回读和审计最终证据。

## 2. 现行权威文件

| 文件 | 用途 |
| --- | --- |
| AGENTS.md | 仓库范围、后端冻结、允许目录、桥接和安全规则 |
| docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md | SillyTavern 原版能力与自定义玩家前端的边界 |
| docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md | RUNTIME-1 至 RUNTIME-4 的正式协议与完成定义 |
| docs/AI_GALGAME_VISUAL_RUNTIME_4_LIVE_ACCEPTANCE.md | RUNTIME-4 受控启动和外部前置 |
| docs/AI_GALGAME_VISUAL_RUNTIME_4_READINESS_ADMISSION.md | RUNTIME-4 readiness 与准入边界 |
| .codex-longrun/state.json | 当前阶段、阻塞、证据清单和停机动作 |
| .codex-longrun/blockers.md | 当前及历史阻塞，顶部记录优先 |
| .codex-longrun/progress.md | 实测和根因修复过程记录 |

## 3. 本次新增配套文件

| 文件 | 直接产出 |
| --- | --- |
| AI_GALGAME_VISUAL_RUNTIME_4_DEVELOPMENT_RUNBOOK.md | 从合同确认到最终审计的逐步执行手册 |
| AI_GALGAME_VISUAL_RUNTIME_4_PROVIDER_CONTRACT_HANDOFF.md | Provider 方必须确认的请求、响应和字段合同 |
| AI_GALGAME_VISUAL_RUNTIME_4_HARNESS_COMPATIBILITY_GATE.md | 旧验收脚本、当前 v2 路由和真实 RUNTIME-4 证据的隔离门 |
| AI_GALGAME_VISUAL_RUNTIME_4_TEST_MATRIX.md | 测试用例、输入、期望、命令和证据编号 |
| AI_GALGAME_VISUAL_RUNTIME_4_EVIDENCE_AUDIT_CHECKLIST.md | 证据格式、敏感信息审计、范围审计和 reviewer 签字清单 |
| AI_GALGAME_VISUAL_RUNTIME_4_PROVIDER_CONTRACT_RECORD_TEMPLATE.json | 可直接填写的 Provider 合同机器可读记录 |

## 4. 当前已确认的基线

- 设备和仓库目录可访问；工作区有大量未提交修改和新增文件。
- 不执行 reset、清理、覆盖、旧目录迁移或自动 v1→v2 迁移。
- 最近一次 v10 受控 AISelf 调用：本地上传 200、Provider 传输 2xx、分析失败 ANALYZER_SCHEMA_INVALID。
- Provider 原文、失败字段、token 和 ST key 均未读取、未保存。
- 发布另外失败于 VISUAL_CONTROL_ACTIVE_CATALOG_INVALID，说明现有活动目录仍需受控 v1→v2 准备。
- 当前最前置动作是取得明确的 Provider 输出合同或获批准的 Provider 侧修正。
- 在合同明确前，禁止继续猜字段或重复实时调用。

## 5. 门禁顺序

~~~~text
D0 基线与工作区保护
  -> D1 Provider 合同签署
  -> D2 验收脚本兼容性门
  -> D3 本地适配器与闭合 schema 回归
  -> D4 v1->v2 目录迁移 dry-run
  -> D5 获批准的 v1->v2 execute
  -> D6 真实 ST/bridge/manifest 前置核对
  -> D7 一次受控真实验收
  -> D8 浏览器矩阵与安全审计
  -> D9 证据收口和独立复核
~~~~

任一门失败都保留现场、记录固定错误类别并停止后续门。测试替身、历史 VS-CODE-3C 证据和旧目录状态不能替代当前 RUNTIME-4 证据。

## 6. 文档变更规则

- Provider 合同变更先修改合同交接文档，再修改代码或测试。
- 代码变更只能落在 RUNTIME-4 规格允许的目录。
- 每个实时结果都要绑定实际启动进程版本和证据文件。
- 任何 token、ST key、原始 Provider response、固定任务文本和隐藏上下文都不得进入仓库、日志、浏览器或 evidence。
- 本文档包只建立执行依据，不把当前阶段改写为完成。

## 7. 审计记录

文档包自审证据由：

.codex-longrun/evidence/visual-runtime-4-doc-pack-audit-v1.json

本轮逐章开发、测试和门禁审计证据由：

.codex-longrun/evidence/visual-runtime-4-development-audit-v1.json
.codex-longrun/evidence/visual-runtime-4-harness-compatibility-v1.json
.codex-longrun/evidence/visual-runtime-4-browser-smoke-v1.json

审计通过只表示文档、代码边界、本地合同和 test-only 浏览器链路符合当前规则；它不表示 Provider、真实 ST 或 RUNTIME-4 已完成。