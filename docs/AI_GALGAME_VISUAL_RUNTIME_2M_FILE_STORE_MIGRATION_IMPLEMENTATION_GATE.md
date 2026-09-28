# VISUAL-RUNTIME-2M FileVisualAssetStore 生产迁移实现准入

> 文档版本：v1.0
> 文档状态：reviewer-passed/done（仅 FileVisualAssetStore 迁移子阶段）
> 生效日期：2026-09-05
> 上位规格：`docs/AI_GALGAME_VISUAL_RUNTIME_INTELLIGENCE_DEVELOPMENT_SPEC.md`

## 1. Gate 目的

本 gate 只闭合 dictionary v1 到 v2 的生产文件迁移。当前 RUNTIME-2 已有
v2 schema、hash、deterministic scorer、migration planner 和可注入的进程内
rollback 测试，但不能把注入式 transaction 当成 FileVisualAssetStore 的
生产原子实现。通过本 gate 前，RUNTIME-2 保持 `partial/blocked`。

## 2. 允许范围

未来实现只允许修改：

- `external-modules/visual-asset-service/server.mjs`
- `external-modules/visual-asset-service/test.mjs`
- `external-modules/visual-asset-service/README.md`
- `docs/**` 与 `.codex-longrun/**` 的规格、状态、日志和证据

禁止修改 `frontend/player/**`、`frontend/admin/**`、`frontend/shared/**`、
`public/**`、`game-config-service`、`original-runtime-bridge`、Start 脚本、
ST backend/original public/root deps/config/startup、manifest/profile、save、
Projection/proof/stub/ticket/binding/old-save、provider/LLM 或任何 RUNTIME-3/4
链路。

## 3. 必须实现的服务内批次语义

实现必须由 FileVisualAssetStore 自己提供可测试的批次边界，不依赖外部注入
transaction 才能成立：

1. 在 service-owned data root 下创建带随机且不可预测名称的临时 migration
   batch directory；目录必须通过 realpath 校验，禁止 symlink、`..`、绝对路径
   注入和跨 root 写入。
2. FileVisualAssetStore 的 service-owned migration entry 从当前 active pointer
   读取旧 catalog，并收集其全部 published asset/content；调用方传入的
   catalog/assets 仅保留给纯 planner 测试入口。逐项校验 v1
   dictionary/hash、asset metadata/content hash、PNG MIME/served bytes 和
   catalog refs；缺失、partial、duplicate、unknown key、坏 JSON、坏 hash、
   symlink 或路径越界必须 fail-closed。
3. 对全量五类素材重新生成并校验
   `galgame.visual-asset-analysis.v2`，每条 analysis 必须有精确
   dictionaryVersion/hash；任何一条失败都不得生成可激活的部分目录。
4. 在临时目录写入完整 v2 asset records、catalog record、active pointer
   manifest 和批次 manifest。写完后重新从磁盘读取并逐项校验，再进入激活。
5. 激活必须保留旧 catalog、旧 asset records 和旧 active pointer，使用同一
   service-owned commit/recovery protocol 一次性切换 active pointer；切换前
   旧版本仍可读，切换后新版本必须完整可读。
6. 激活成功后清理临时批次；任何失败或进程恢复都必须清理未提交批次，并保持
   旧 active catalog 不变。旧目录不得被覆盖或删除作为“回滚”。
7. 重启时只接受完整 v2 batch/manifest；发现 orphan temp、partial record、
   duplicate active pointer、版本/hash 不一致或不完整 commit marker 必须拒绝
   启动或进入安全的旧版本读取态，不能猜测修复。无 root commit pointer 的
   完整 final batch 被视为未提交 orphan，完成校验后由启动流程删除；坏的
   orphan 不得删除后掩盖，而必须 fail-closed。

这里的“原子”只允许在实现有明确 commit marker、fsync/rename 顺序和 recovery
证据时使用；若平台只能提供可回滚进程内失败语义，文档必须继续写
`partial/blocked`，不得宣称 crash-level cross-file atomicity。

## 4. 必须覆盖的测试与证据

`test.mjs` 必须用真实 FileVisualAssetStore 临时目录覆盖：

- 五类 v1 catalog 全量迁移为 v2，并从新进程/新 store 实例重启读回；
- 分析失败、内容缺失、metadata/hash mismatch、catalog mismatch；
- temp batch partial、坏 JSON、unknown key、duplicate record、symlink、
  path traversal、非法 commit marker；
- asset/catalog/active-pointer 任一写入失败；
- 激活中断后 recovery，确认旧 catalog revision/hash、旧 active pointer 和
 旧素材可读性完全不变，且无可激活半成品；
- 成功迁移后重复执行幂等，不重复生成或覆盖已激活版本；
- analyzer scope/dictionary version 变化触发重新分析，旧 v1 记录不能静默通过；
- Windows 直接 CLI/service smoke、重启和清理行为，不能只测 health。

证据必须记录：旧/新 catalog revision/hash、批次目录状态、commit/recovery
marker、每类 asset metadata/content hash、失败 error code、重启读回结果、
临时目录清理结果和最终 active pointer。不得记录 token、原始 analyzer 响应、
聊天、ST key 或 prompt。

## 5. 停止条件

- 任何跨文件事务语义只能靠 test double 或外部注入证明：立即保持 blocked；
- 发现 ST/backend/player/admin/shared/public 或旧重型链路需要修改：停止并另提
  gate；
- 生产 analyzer 未配置不阻止迁移合同测试，但不得伪称真实 AI 已通过；
- 同一失败问题两次出现后先做根因审计，运行环境无变化不得重复生成 evidence；
- 本 gate 通过前不得进入 RUNTIME-3/4，不得标记 RUNTIME-2 或整个视觉模块完成。

## 6. 当前实现验证结论

本 gate 已获独立复核 PASS；当前已在精确文件白名单内实现并验证：
FileVisualAssetStore 自有临时批次、完整 v2 回读校验、active pointer 提交、
失败清理、旧目录保留、重启读回和幂等重复执行均有 focused service evidence。
本 gate 已 reviewer-passed/done，但仅代表 FileVisualAssetStore 迁移子阶段；RUNTIME-2
整体仍保持 partial/blocked，RUNTIME-3/4 和生产 analyzer/ST 验收不受本实现授权影响。
实现使用文件 sync、rename 与根级 commit pointer 提供可恢复的进程级失败语义，
不宣称跨平台 crash-level cross-file atomicity。不得由本子阶段状态自动进入
RUNTIME-3/4，也不得标记 RUNTIME-2 或整个视觉模块完成。

最新 focused service regression 已使用真实 FileVisualAssetStore 临时目录构造
包含 scene、character、equipment、item、skill 的五类 published v1 catalog：
character 使用透明 PNG，后三类使用 icon PNG。测试覆盖 service-owned 无参数源读取、
五类 v2 analysis/catalog ref/content hash、失败时旧 v1 active source 保持不变，以及
新 FileVisualAssetStore 实例重启后的五类 asset、analysis、catalog、active pointer
读回。迁移批次读取按 asset key 校验并按 catalog ref 顺序返回，不依赖磁盘文件名排序。
