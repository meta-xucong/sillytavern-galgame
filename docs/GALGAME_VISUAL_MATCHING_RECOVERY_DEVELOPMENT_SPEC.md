# Galgame 头像与背景匹配恢复开发规范

> 状态：实现基线 v1，2026-10-02
> 任务：修复当前视觉 catalog 角色通道迁移缺失、生产素材池污染和旧背景粘滞；保留原聊天、存档、原始素材与可回滚目录。
> 权威：`AGENTS.md`、`docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`。
> 运行状态：本文件第 2 节与第 3 节记录的是迁移前审计快照；2026-10-04 运行状态和验收边界见第 9 节。

## 1. 目标与边界

玩家端应从当前已显示的 SillyTavern 文本和当前发布的视觉 catalog 中，呈现与当前角色/地点相符的资源。角色头像必须遵守 character、player、narrator、system 的独立通道；背景只在场景证据足够时切换。缺证据时用中性/默认资源，不能猜图，也不能把旧场景图无限期当成新场景。

本次只修视觉素材选择、catalog 发布/迁移及背景层状态。标注服务仍遵循既有 shadow/gate 规范；本次不擅自启用未通过整语言/整剧本验收的 annotation，也不以新增关键词/正则列表替代语义分析。

硬约束：

1. 不修改聊天正文、聊天目录、角色卡、世界书、存档或 SillyTavern 冻结后端。
2. 不删除旧 catalog、原始图片、asset metadata 或聊天。新目录以 copy-on-write 方式建立，切换失败时旧活动指针保持不变；新目录验收失败可原子回滚旧指针。
3. 不把 API token、完整聊天文本或外部 provider 错误写入日志、前端或 catalog。
4. 玩家/旁白/系统/普通角色只能用各自 channel；未知资产/证据不足时使用 type-specific unknown 或剧本默认背景。
5. 正式素材清单采用明确的 assetId、version、content hash、metadata hash、type 与 channel/批准状态；人物用途枚举固定为 `character|player|narrator|system`，每个人物引用必须唯一归属一个通道。本次未使用的专用通道可以零引用。不从文件名、角色名字或“所有 published”推断生产资格。

## 2. 审计基线

运行态 8798 返回 active catalog `catalog_simple_ce914e3ceb54:1`，其持久记录是 `galgame.visual-asset-catalog.v1`，含 234 个引用（character 69、scene 101），且没有 `characterChannels`。当前 matcher 仅将显式 channel=`character` 的资源纳入普通角色候选；因此这个旧 schema 会令全部动态头像候选被拒绝。代码证据：`external-modules/visual-asset-service/server.mjs` 的 `catalogChannelFor`、`isCatalogCandidateEligible`、`createCoreVisualCandidateDecisionPlan`。

目录中混有旧上传、重复版本、探测/诊断场景和专用旁白/玩家资源。部分失败分析的敌方图仍包含已保存的闭集 `tagCodes/featureCodes`；matcher 对这些经 catalog hash 绑定的显式 taxonomy 有独立处理，因此不能仅按 `analysisStatus` 把它们全部判为不可用，也不能把失败分析状态伪装为 ready。

背景层仅在当前 segment 有新场景 hint 且存在有效匹配时更新。无场景 hint 时延续上次已验证背景；已识别到新场景但没有合格图片时，也可能继续展示旧地点背景。默认背景来自 scenario presentation 资源，并不证明运行时匹配成功。

## 3. 资产与 channel 规则

### 3.1 角色资源

- 普通候选只含清单显式批准的 `character` channel。
- 旁白 emblem 固定为 `narrator`；玩家 compass 固定为 `player`；系统素材固定为 `system`；三者不得进入 ordinary character candidate pool。
- 新敌方资源只有当引用的 content hash 与本地 metadata 一致、其闭集 taxonomy 存在、资源满足 >=320×320 且候选 evidence 通过现有匹配器的唯一性/冲突/阈值检查时，才保留在 `character` channel。`analysisStatus=failed` 不得改写为 ready；taxonomy 只读取已存且校验通过的元数据。
- 旧 `asset_character_*` 上传资源不得仅因仍是 published 就进入新生产目录。若它与批准的 curated asset 内容 hash 相同，只在新目录保留显式选定的 canonical 引用；原 asset 与旧目录继续保留以供回滚。
- 同一内容只能分配到一个角色 channel。重复内容先按 exact content hash 去重，再由清单选择 canonical ref；不能依赖目录顺序或词典序挑图。
- 迁移前的 2026-10-02 候选清单曾暂排除 `asset_character_cbbc0f8c6899`（已知为作者绘制的方形泛人形肖像，缺少 analysis，存在误绑定 NPC 风险）和 `asset_side_skill_shield_strike`（当时预览显示 metadata hash 与 metadata 不一致，但 content hash 一致，尚待真实 store 复核）。该句是迁移前审计记录；是否进入当前活动目录须以第 9 节指针和已发布 catalog 为准。排除/复核不修改、不删除旧资产或旧目录。

### 3.2 场景资源

- 活动场景必须由清单逐项批准，并通过图片内容校验和现有舞台尺寸策略（宽、高、横向比例） 。
- probe/debug/connection-test/diagnostic、失败分析且无可用显式 taxonomy 的图不进入生产目录；清单不得通过字符串黑名单来替代人工批准。
- 同一场景图像的多个版本只保留一条批准 ref。重复资源在源存储和旧目录中保留。
- 候选必须有地点/环境/时间/氛围等足够的可见 evidence overlap；低分、冲突或并列不唯一均返回 `unknown_scene`，不取第一个候选。

## 4. Catalog 迁移合同

迁移工具按 `preview -> validate -> publish -> activate` 分阶段，并协调 catalog、asset-store active-catalog 索引、`visual-control.json` 和常驻服务内存这四个状态面。8798 启动时必须对规范化 data root 获取 OS 可见的独占 lease（Windows 使用同目录 `wx` lease 文件，含 serviceInstanceId、PID、启动时间、监听地址和规范化 dataRoot）；已有存活持有者时第二实例必须以 `VISUAL_DATA_ROOT_IN_USE` 拒绝启动，不能另开端口共用 data root。退出时仅由 lease 所有者删除 lease；疑似陈旧但无法确认进程/实例身份时 fail closed，不自动抢锁。迁移命令验证管理 API 返回的 serviceInstanceId/PID/port/dataRoot 与当前玩家访问的 8798 实例一致，禁止启动第二个 store writer 或直接编辑服务正在使用的文件。启动时须在开始监听前完成 journal recovery。storage facade 是唯一持久化访问入口，固定纳入 fence 的 adapter 为 `FileVisualAssetStore`（asset/catalog/active index）、`FileVisualControlStore`、`FileContentStore`、`FileVisualAnalysisCacheStore`、`FileVisualBindingStore`、`FileVisualRestoreReplayStore`、`MemoryProofReplayStore` 及新增 `FileVisualCatalogMigrationJournalStore`；所有 HTTP handler 只能调用 facade 暴露的最小接口，不持有 raw store/file handle。HTTP route 以 `VISUAL_HTTP_ROUTE_ACCESS_MANIFEST` 明确登记 method/path pattern/READ|WRITE；未登记 route 在注册和请求时均 fail closed。所有写入，包括 upload/metadata、draft、lifecycle、simple publish、activation、import、replay/proof、migration，统一走 service-wide 写 fence；所有读取与 health 统一走读 fence，迁移持写锁从 CAS 到 commit/rollback，全程读请求等待或返回 `503 VISUAL_CATALOG_MIGRATION_IN_PROGRESS`。静态测试比较 router 注册表与 access manifest，并验证全部 adapters 经过 facade、无 handler 引用 raw store 或直接读写对应 dataRoot；source CAS 同时比较 asset-store active index、control pointer 的完整 catalogId/revision/hash 及源 catalog hash。

1. `preview` 只读读取当前 pointer、catalog、asset metadata 与批准清单，验证预期 source catalog hash、每条 ref 的 content/metadata hash、channel 全覆盖、通道隔离、内容去重、unknown refs 和尺寸。不打印图片字节、聊天或密钥。
2. 任一 ref 缺失、hash 不符、角色 channel 缺项/重叠、special channel 冲突或未知兼容性检查不通过，整个 preview fail-closed，不写入任何 store。
3. `execute` 经过运行服务拥有的事务/API 更新，禁止在服务运行时绕过实例直接写 JSON。事务先 CAS 校验 source pointer/hash，再创建新 v2 catalog，读回并校验后才激活；串行化维护窗口只暂停视觉服务写操作，不停止/重启 SillyTavern、不影响聊天或剧情生成。旧 catalog、asset record 和原始图均不覆盖、不删除。
4. 双指针切换须有持久 journal，schema 固定为 `galgame.visual-catalog-migration-journal.v1`：`action` 仅 `activate|rollback`，`state` 仅 `PREPARED|COMMITTED`；记录 operationId、source asset-store pointer、source control pointer、target pointer、old/new 完整 control snapshot（含 `schemaVersion`、`enabled`、`activeCatalog`、`updatedAt`）、source/target catalog hash、createdAt、updatedAt 和 recordHash，不含素材字节、聊天和凭证。`recordHash=sha256:` + SHA-256(JCS canonical JSON of all journal fields except `recordHash`)；pointer/control 按服务现有 schema 验证。更新顺序：写入并读回不可变 catalog；持久写 `PREPARED` journal；依次更新 asset-store active index、control pointer、服务内存并逐项读回；最后原子提交 `COMMITTED` journal，作为唯一 commit point。每个 JSON 先写同卷唯一临时文件、flush file handle 后原子 replace，再重新打开读回校验；所有步骤带 operationId 可重放。崩溃恢复规则固定：有效 `PREPARED` 必须把两指针、完整 control snapshot 和内存恢复到 old state（保留新 catalog）；有效 `COMMITTED` 必须 roll-forward 到 new state。启动恢复完成前不开放 API/不报健康；journal 缺失但两指针不一致、journal 校验失败、CAS 不符或恢复失败时 fail-closed 并报非敏感 `VISUAL_CATALOG_RECOVERY_REQUIRED`，不得自行猜选 pointer。rollback 使用同一状态机，以当前新指针为 old、请求恢复的精确旧指针/控制状态为 new。
5. 命令输出包括旧/新 pointer、catalog hash、按 type/channel 计数、去重数、被排除数和原因码；不输出原始聊天或 provider 信息。
6. `rollback` 要求精确旧 catalog ID/revision/hash，并确认该 catalog 仍 published；通过同一 CAS/journal 事务恢复两处持久指针与服务内存，不删除新 catalog。重复执行 execute/rollback 必须安全、可解释。
7. 现有 side-art importer 必须在任何资产上传/metadata 写入之前验证完整 v1 channel 映射，避免失败迁移遗留半成品 drafts。
8. 简易发布错误优先级固定：先验证两 pointer 一致性（不一致=`VISUAL_CATALOG_RECOVERY_REQUIRED`）；若 active catalog 是 v1 且含 character ref，返回 `CHANNELS_UNRESOLVED`（无论是否存在 asset/catalog draft）；之后只要存在任意 asset draft 或 catalog draft，返回 `EXPLICIT_CATALOG_REQUIRED`，不提升 asset 状态、不创建/激活 catalog；无 active catalog 且无 draft 返回 `NO_ACTIVE_CATALOG`；active v1 不含 character 且无 draft 返回 `LEGACY_CATALOG_REQUIRES_MIGRATION`；仅 active v2 且无任何 draft才幂等只读成功。draft 检测必须覆盖 asset 与 catalog store。完整素材变更统一通过 v2 draft/catalog 流程，显式提交全量 refs、批准清单和 characterChannels；simple publish 永不推断新人物通道，已有 v2 映射不得被隐式改写。

## 5. 背景层状态转换

场景处理顺序固定：先从可信运行态取得 current scope 并与已存 ledger 比较；chat/release/arc/catalog scope 任一变化时，无条件立即清除旧 scene identity/背景并恢复新 scope 的 `defaultBackgroundAsset`，不等待或信任旧 projection。只有 scope 相同后才校验 `galgame.scene-continuity.v1`；此时 hash/span/schema 错误按 `unknown` 处理并保留当前已验证背景。场景匹配必须消费通过原文哈希/跨度校验的该协议，而不能只用 `decisions` 是否含 scene 推断是否发生切场。精确字段固定为：`scope={chatId,releaseId,arcId|null,catalogId,catalogRevision,catalogHash}`；`segment={messageId,pageIndex,pageTextSha256}`；`state=changed|continued|unknown`；`sceneEntityKeys:string[]`；`currentSceneKey:string|null`；`evidenceSpans:Array<{start,end,relation,sceneEntityKey,destinationSceneKey}>`。`pageText` 是分页后的确切可见字符串，在 HTML/markdown 装饰前取值；按原始 UTF-8 bytes 计算 SHA-256，不 trim、不换行转换、不做 Unicode normalization。`pageTextSha256` 必须与 `pageText` 相等时方可消费。span 的 `start/end` 是整数 JS UTF-16 code-unit 偏移，半开区间 `[start,end)`，满足 `0≤start<end≤pageText.length` 且不得切开 surrogate pair。`currentSceneKey` 标识当前地点；`sceneEntityKeys` 是本页有证据的实体标识，可含被提及地点，不等同于当前地点。`sceneEntityKey` 指 span 所属实体；仅 `transition-action` 必须有 `destinationSceneKey`，其他 relation 的该字段必须为 null。previous verified scene key 是调用方提供的、同一 scope 内的可信状态，不由 projection 伪造。`referenced-location`（回忆、计划、远处提及等）永远不能单独生成 changed；current-location 尚不能确认是否已抵达时标 `unknown`。连续分页沿用上一 sceneKey 标 `continued`。没有 transition 证据的未识别表达保持 `unknown`；annotation shadow 不能声称任意自然语言均能分类。沿用现有 scene entity/schema，不新增题材专属词表：

| 当前 segment | 决策 | 舞台背景 |
|---|---|---|
| continuity=`continued`（没有 scene entity；当前城堡中仅计划/回忆/远望港口；或当前 sceneKey 等于 verified scene） | 无场景变化事件 | 保持最近一次已验证场景 |
| continuity=`changed` 且得到合格唯一新匹配 | scene matched | 切换到新 catalog asset，并更新 verified identity |
| continuity=`changed`，但决策为 `unknown_scene`、低分、冲突、不唯一或加载失败 | scene changed/unmatched | 清掉旧 verified identity，恢复当前发布版本的 `defaultBackgroundAsset` |
| continuity=`unknown` 或 evidence text hash/scope/span 校验失败 | 不确定，不得当作 changed | 保留已验证场景；记录非敏感诊断，不显示错误地点图 |
| chat/release/arc/catalog scope 改变 | scope invalidated | 立即清除旧 scene state 与旧背景 identity，恢复新 scope 的 `defaultBackgroundAsset`，再由新 scope 重新匹配 |

场景连续性不使用任意回合数 TTL。没有证据时保持当前地点；一旦当前段已有明确的新地点证据，即使图片缺失也不能继续展示旧地点。语义标注仍处于 shadow 时，不能声称未知表达都能被识别；必须将该限制列为 gate，而不是用无限叠加正则掩盖。

协议 golden fixture（测试应直接使用这些字符串与区间，不重新“猜”偏移；`previousVerifiedSceneKey` 是 matcher 调用输入，不是 projection 可自行声明的字段）：

| `pageText` | evidence | verified scene | expected |
|---|---|---|---|
| `此刻仍在城堡，明天计划去港口。` | `城堡` `[4,6)`=`current-location/castle`；`港口` `[12,14)`=`referenced-location/harbor` | `castle` | `continued`，`currentSceneKey=castle`，保留城堡图 |
| `众人终于抵达港口。` | `抵达` `[4,6)`=`transition-action` 且 destination=`harbor`；`港口` `[6,8)`=`current-location/harbor` | `castle` | `changed`，`currentSceneKey=harbor`，匹配失败回默认背景 |
| `港口😀，远处仍是城堡。` | `港口` `[0,2)`=`referenced-location/harbor`；`城堡` `[9,11)`=`current-location/castle` | `castle` | `continued`；emoji 占两个 UTF-16 code units，span 验证正确，不得 changed |

三条 `pageTextSha256` 固定为 `sha256:9863a1c0de69f6b0d035d30b98937141f9f37454cc07cc576648c4eefe2ee620`、`sha256:4c1657e0f44bb1d1911aa94ede956583e23539aead1f4b283f33955e6ef95a29`、`sha256:ad746554a7e1b30ef478ecce99dd1bf7d8b89668a0a75bd1c1ee2d6d72e34ac2`。共享同一 scope 的分页 continuation 以同一 sceneKey 延续；message/page 变化但 chat/release/arc/catalog 未变不自动改变场景。测试另构造同 scope 下 text hash 错误、span 越界/切代理对、destination key 缺失和 unknown state，结果 fail closed 为 `unknown` 并保留已验证背景；scope 变化则优先无条件清旧 state/identity 并恢复新 scope 默认背景，不能被 projection 错误降级为 unknown。

可复用完整输入 fixture（测试直接解析 `pageText + previousVerifiedSceneKey + projection`，hash 与偏移可直接验算）：

```json
{
  "pageText":"此刻仍在城堡，明天计划去港口。",
  "previousVerifiedSceneKey":"scene:castle",
  "projection":{
    "schemaVersion":"galgame.scene-continuity.v1",
    "scope":{"chatId":"fixture-chat","releaseId":"fixture-release","arcId":null,"catalogId":"fixture-catalog","catalogRevision":1,"catalogHash":"sha256:7fc58396c2dcf1684849862201f847ad76a2efe04111a3224a2be7aa02d23e42"},
    "segment":{"messageId":"fixture-message-1","pageIndex":0,"pageTextSha256":"sha256:9863a1c0de69f6b0d035d30b98937141f9f37454cc07cc576648c4eefe2ee620"},
    "state":"continued",
    "sceneEntityKeys":["scene:castle","scene:harbor"],
    "currentSceneKey":"scene:castle",
    "evidenceSpans":[
      {"start":4,"end":6,"relation":"current-location","sceneEntityKey":"scene:castle","destinationSceneKey":null},
      {"start":12,"end":14,"relation":"referenced-location","sceneEntityKey":"scene:harbor","destinationSceneKey":null}
    ]
  }
}
```

```json
{
  "pageText":"众人终于抵达港口。",
  "previousVerifiedSceneKey":"scene:castle",
  "projection":{
    "schemaVersion":"galgame.scene-continuity.v1",
    "scope":{"chatId":"fixture-chat","releaseId":"fixture-release","arcId":null,"catalogId":"fixture-catalog","catalogRevision":1,"catalogHash":"sha256:7fc58396c2dcf1684849862201f847ad76a2efe04111a3224a2be7aa02d23e42"},
    "segment":{"messageId":"fixture-message-2","pageIndex":0,"pageTextSha256":"sha256:4c1657e0f44bb1d1911aa94ede956583e23539aead1f4b283f33955e6ef95a29"},
    "state":"changed",
    "sceneEntityKeys":["scene:harbor"],
    "currentSceneKey":"scene:harbor",
    "evidenceSpans":[
      {"start":4,"end":6,"relation":"transition-action","sceneEntityKey":null,"destinationSceneKey":"scene:harbor"},
      {"start":6,"end":8,"relation":"current-location","sceneEntityKey":"scene:harbor","destinationSceneKey":null}
    ]
  }
}
```

```json
{
  "pageText":"港口😀，远处仍是城堡。",
  "previousVerifiedSceneKey":"scene:castle",
  "projection":{
    "schemaVersion":"galgame.scene-continuity.v1",
    "scope":{"chatId":"fixture-chat","releaseId":"fixture-release","arcId":null,"catalogId":"fixture-catalog","catalogRevision":1,"catalogHash":"sha256:7fc58396c2dcf1684849862201f847ad76a2efe04111a3224a2be7aa02d23e42"},
    "segment":{"messageId":"fixture-message-3","pageIndex":0,"pageTextSha256":"sha256:ad746554a7e1b30ef478ecce99dd1bf7d8b89668a0a75bd1c1ee2d6d72e34ac2"},
    "state":"continued",
    "sceneEntityKeys":["scene:castle","scene:harbor"],
    "currentSceneKey":"scene:castle",
    "evidenceSpans":[
      {"start":0,"end":2,"relation":"referenced-location","sceneEntityKey":"scene:harbor","destinationSceneKey":null},
      {"start":9,"end":11,"relation":"current-location","sceneEntityKey":"scene:castle","destinationSceneKey":null}
    ]
  }
}
```

三条 fixture 的 catalog context 指针使用测试构造的 opaque catalog hash；生产校验必须将其与当前已验证 context 精确比较，不能把测试值或未知值当作活动指针。

## 6. 实施清单与所有权

实现时一次只允许一个 writer；下表文件边界不得扩展。

| 路径 | 职责 | 验收 |
|---|---|---|
| `external-modules/visual-asset-service/player-catalog-manifest.json`（新增） | 明确批准普通角色、narrator、player、scene refs；manifest schema 接受 `system` channel，但本次 `system` ref 数必须为 0 且不启用 system catalog asset 渲染；绑定 content hash、metadata hash、type/channel、可审计原因 | schema/完整性/duplicate/channel/hash fixture |
| `external-modules/visual-asset-service/rebuild-player-catalog.mjs`（新增） | preview/execute/rollback；copy-on-write 新 catalog 与 pointer 更新 | 持久 store fixture、失败原子性、重放与 rollback |
| `external-modules/visual-asset-service/import-side-art-assets.mjs` | 迁移映射完整性必须先于任何写入 | 缺映射时 store byte-for-byte 不变 |
| `external-modules/visual-asset-service/server.mjs`、`test.mjs` | legacy v1 简易发布 fail-closed；simple publish 只读或拒绝 draft，任何新素材仅由显式 v2 manifest/catalog 流程激活；事务/API journal 原子维护两处指针；保留 channel-aware scorer | v1 no-draft；v2 四种通道；双指针各阶段故障/重启恢复；failed-analysis curated tags |
| `frontend/player/src/main.js`、`frontend/shared/src/presentation-projection.js`、相关测试 | 消费经哈希/跨度校验的 `scene-continuity.v1`；changed+失败才回 scenario default 并清除旧 asset identity；同 scope continued/unknown 保留 verified background；scope change 优先清旧身份并恢复新默认；`system` 使用中性 built-in placeholder，不读取 catalog system 通道 | 城堡中仅提及/计划/回忆/远望港口=continued；明确抵达港口=changed；同 scope 无效 hash=unknown/保留；scope change=清旧并恢复默认 |
| `docs/GALGAME_NATIVE_FIRST_DEVELOPMENT_SPEC.md`、`docs/GALGAME_DESIGN_SPEC.md`、`docs/GALGAME_FRONTEND_DEVELOPMENT_SPEC.md` | 同步产品规则、channel、unknown fallback 与 scene transitions | 文档规则一致；仅启用本阶段明示的当前页 `scene-continuity.v1` changed gate，speaker/identity/roster 等一般语义标注仍不启用 |
| `public/game/**` | 仅由静态构建生成 | source/bundle 一致、无缺模块 |

禁止编辑 `src/**`、`server.js`、原版 `public/index.html/script.js/style.css`、聊天/存档目录、API keys、任何由 ST 原生后端托管的角色卡/世界书正文。

## 7. 测试与验收

### 自动化

1. v1 catalog 无角色候选；scene 候选仍遵循尺寸与分数规则。
2. v2 schema 接受 character/narrator/player/system 并对所有已引用素材唯一分配；旁白/玩家不泄露进 character 候选；本次 system channel 恰为零引用，system UI 使用 neutral built-in placeholder。
3. 10 个敌方 asset 的分析状态保持 failed，但保存的闭集 taxonomy 可以在显式证据重合、唯一最优时参与匹配；无属性/冲突/并列返回 unknown。
4. 源素材重复内容只在新 catalog 产生一个 canonical ref，旧资产和旧 catalog 不变。
5. probe/debug/diagnostic 与尺寸不合格 scene 被拒绝；批准背景仍能按 visible evidence 选中。
6. importer channel 映射缺失时，metadata/catalog/control/content store 均无写入；simple publish 矩阵覆盖 v1/v2/no-active × asset/catalog drafts，有任何 draft 均 fail closed，所有 asset type 都不得发生状态、catalog 或 pointer 写入；v1+character 的 `CHANNELS_UNRESOLVED` 优先于 draft 错误。
7. preview 不写 store；execute 对写 catalog、PREPARED journal、asset-store pointer、control pointer、内存提交、COMMITTED journal 逐点注入故障，验证 PREPARED 必回旧、COMMITTED 必回新，恢复期间 API/health 不开放；测试两指针漂移与 journal 损坏均 fail-closed。rollback 同样验证双指针。静态测试将 handler 注册表、`VISUAL_HTTP_ROUTE_ACCESS_MANIFEST`、storage facade adapter 集合逐项作集合相等比较，任何遗漏 route、未登记 adapter 或 raw store 引用均失败。
8. 背景状态转换表所有分支通过：当前城堡中计划/回忆/远望港口作为 `referenced-location` 必须 continued 并保留旧 identity；明确抵达港口并带有效 `transition-action` 才 changed；changed+unknown/no image/load failure 时不残留旧 identity；unknown/hash无效时不当作 changed。协议 golden fixture 必须可直接复制，精确固定原文、scope、pageText hash、entity keys、每个 span 的 start/end/relation/entity/destination、previousVerifiedSceneKey 和 expected state。例：`此刻仍在城堡，明天计划去港口。` 的 span `[12,14)` 为 `referenced-location`、destination=null，state=continued，currentSceneKey=castle；`众人终于抵达港口。` 的 `[4,9)` 为 `transition-action`、destinationSceneKey=harbor，且 `[6,8)` 为该地点的 `current-location`，state=changed。另覆盖 astral emoji 前后 UTF-16 offset、跨页 continuation、无效 hash、chat/release/arc/catalog 任一 scope 改变。两条固定字符串 SHA-256 分别是 `sha256:9863a1c0de69f6b0d035d30b98937141f9f37454cc07cc576648c4eefe2ee620` 和 `sha256:4c1657e0f44bb1d1911a94ede956583e23539aead1f4b283f33955e6ef95a29`。
9. 静态 route/storage 架构测试枚举全部注册 handler 和所有 asset/catalog/control/content store 方法，证明读写全经共享 facade/fence；任何新 route 或直接 store/file adapter 绕过均失败。

### 运行态验收

- 记录执行前 active pointer/hash 与源 catalog ref counts；迁移后通过 8798 player-safe API 验证新 v2 catalog、channels、asset types、dimensions/hash 和 content HTTP 读取。
- 不提交玩家输入、不触发模型剧情生成、不推进原版会话；使用独立 QA harness 验证头像资源 identity，并在现有只读 `/game/` 页面验证本阶段 scene producer 的背景连续性链路。该真实场景验收只证明当前可见页，不代表全语言/全剧本泛化能力。
- 桌面和移动尺寸均检查实际舞台资源及默认回退。本阶段可验收独立 scene producer 对当前可见页的高置信度、有跨度证据的 `changed`；不得据此宣称全语言/全剧本泛化分类已通过。speaker/identity/roster annotation 仍 shadow/gated。
- 任何 UI/运行态问题必须留在当前 stage，并允许回滚 catalog；聊天和存档在执行前后指针/文件清单保持一致。

## 8. 完成门槛与已知限制

只有在开发规范实现、独立审计 PASS、针对性测试通过、catalog 迁移运行态验证与 QA harness 图像 identity 验收通过后，才可报告“头像/背景匹配修复完成”。

`presentation-annotation.v1` 的 speaker/identity/roster 语义仍保持 shadow/gated。本阶段仅为当前可见页背景开启独立 `scene-continuity` producer；成功验收只证明已测页面和证据链有效，不证明全语言/全剧本泛化。若它无法识别新地点或证据不足，应按 unknown-safe 保留同 scope 已验证背景；只有可信 changed 已成立但找不到唯一资源时才回默认背景。不得以通用语义模型成功为由打开人物身份或队伍状态自动注释。

## 9. 2026-10-04 运行恢复记录

本节覆盖当前运行状态；第 2 节保留迁移前基线，作为历史审计记录，不再表示活动目录。

### 已执行并验证

- 迁移前活动指针：`catalog_simple_ce914e3ceb54@1`，catalog hash `sha256:73645ec49c73848f251158c39ff713ad3f243c3ec417e348559efdb7bbbd3153`。
- 当前活动指针：`galgame_player_catalog_20261002@1`，catalog hash `sha256:414fcc265e275661355bf485d4d1ed0a3682095a9e3e6d9a8796c665e1275a75`；事务 journal 状态为 `COMMITTED`。
- 新 catalog 共 29 个已发布引用：character 17、scene 6、equipment 2、item 2、skill 2。播放器视觉上下文中人物通道共 17 项：character 15、narrator 1、player 1；system 为零引用。
- 8798 health 返回 200，catalog 与 visual-control 持久存储已启用；通过 8001 来源的 player-safe API 读到目标目录。迁移执行输出记录 29/29 素材内容路由返回非空 `image/*`；这是迁移执行时的证据，撤销管理认证后未再从管理 API 独立复读每个 body。
- 迁移执行记录报告 journal `COMMITTED`。执行记录中的定向测试命令为 `node --test external-modules/visual-asset-service/test.mjs` 和 `node --test frontend/player/tests/visual-presentation.test.mjs frontend/player/tests/core-final-acceptance.test.mjs`，记录结果分别为 1 项通过、2 项通过；本次只读复核未重跑它们。两类结果只覆盖服务/投影合同，不替代真实剧情舞台验收。
- 8001 `/game/` 返回 200；2026-10-04 浏览器无操作观察停留在标题页，状态树显示“视觉已连接、LLM 未检测”。目录迁移 API 只更新 catalog/control/journal，本次没有调用聊天/存档写接口；未采集聊天/存档迁移前后文件哈希，因此这不是字节级完整性审计。迁移未修改 SillyTavern 冻结源码。
- 管理认证当前 `adminAuth.configured=false`；执行记录称迁移使用的一次性权限已撤销。工作区检查确认临时脚本 `external-modules/visual-asset-service/.codex-restore-player-catalog-once.mjs` 当前不存在，但不能据此证明仓库外或 ignored 路径。以后执行管理/rollback 操作前须重新配置受控的临时管理授权；local health 与 player-safe 目录读取可在当前状态工作。

### 尚未通过的验收

- 浏览器目前停留在标题页，未进入剧情舞台；未记录角色头像/背景层的实际 asset identity、浏览器资源加载状态或桌面/移动渲染。因此当前结论是“V2 catalog 与素材读取已恢复”，不能报告“玩家剧情内视觉匹配已完全验收”。代码路径支持显式角色绑定；其真实舞台渲染仍未测。
- 8798 health 不暴露 `GALGAME_VISUAL_RUNTIME_*` provider 配置。本次没有读取或使用 analyzer 凭据，也没有执行动态视觉分析。显式角色绑定和可读取图片可工作；需要语义推断的模糊匹配能力尚未证明。
- 背景仅在同一 scope 下出现经过校验的 `scene-continuity.v1=changed` 时应用场景决策；无有效切场证据时保留已验证背景或 scenario default 属于既定合同。背景匹配测试必须使用有明确场景变化投影的片段。
- 真实剧情推进也未验收。当前浏览器标题页显示 LLM 未检测；上游凭据需要用户在本机轮换后才能做真实生成。不得把 key 发到对话或日志，也不得通过继续游戏触发未知自动生成。

### 后续实测步骤

1. 用户在本机轮换上游凭据，并确认新值只由受信任的本机配置加载；之后先做一次不修改现有聊天的真实生成检查。
2. 使用一个不会在载入时自动生成的现有剧情舞台或隔离 QA 场景，确认角色头像的 asset identity、资源请求成功及实际绘制；再用带有效 `changed` continuity projection 的场景确认背景切换。
3. 保存脱敏的 catalog hash、决定状态、asset ID/version 和资源加载结果；不保存聊天全文、provider secret 或凭据值。
4. 只有以上舞台检查及桌面/移动布局均通过，且未改变聊天/存档时，才将本规范第 8 节的“完成门槛”标记为通过。

## 10. 2026-10-04 场景 continuity producer 修复（本节优先于本文件先前 shadow-only 实施限制）

此前审计发现生产代码没有 `scene-continuity.v1` producer；仅让 8798 在线不能切场。本次用户已明确要求恢复视觉模块，因此按新的窄阶段 `GALGAME_VISUAL_PAGE_CONTINUITY_RESTORE_2026-10-04.md` 启用 current-visible-page scene producer。该例外仅限场景 presentation，不表示 speaker/identity/roster annotation gate 已通过。

8801 接收当前精确可见页和最多两个更早可见页上下文，闭合响应给出 current-location、transition-action、referenced-location、high-confidence 与闭集 scene tags 的 exact spans。Shared validator 将合规证据组装为已有 `scene-continuity.v1`。只有 `changed` 进入 8798 决策；未达高置信度或无转场证据时保留当前背景，changed 无唯一资源时回作品默认背景。旧 `NATURAL_SCENE_HINT_PATTERNS` / “最后出现地点”不得作为生产 scene identity。

只允许分析原版角色可见回复。按原版消息 `is_system===true`→system、否则 `is_user===true`→player、原版 assistant/character→character 归一；来源不明时不创建请求。player/system 来源由播放器跳过，并由 8801 非 character fail-closed；防御性响应固定 low confidence、地点/转场 null、引用/标签空，requestId/hash 由服务端回填且不调用 provider。每个闭集视觉标签 span 必须完整落在 `currentLocation` span 内，无当前地点时标签数组为空。这样可防止同页其他地点提及污染当前背景标签。

本节规则不提升完整自然语言泛化能力、不宣称全语言/全题材验证通过。验收必须覆盖真实当前页面的分析响应、8798 决策和浏览器舞台 asset identity/resource success；端口在线、配置健康和 fixture 通过都不足以证明恢复完成。

## 11. 2026-10-04 本机显式素材迁移入口

8798 当前 `adminAuth.configured=false` 时，正式 `/v1/admin/**` 管理 API 仍保持关闭。为本机维护而增加的入口只在 `localAdminEnabled` 下可用，沿用 `/game-admin/` 建立的 HttpOnly、SameSite=Strict 会话、随机 CSRF、Origin 校验和 remote+Host 双 loopback 检查；写操作均要求 CSRF，且任何 bearer/proof header、query transport 或非 loopback Host 都拒绝。新增入口不得用于 LAN、反向代理或共享部署。

新增路由只委托已有 asset/catalog/migration 函数，不增加另一套存储或发布语义：

- `GET /v1/local-admin/visual/catalog-migration/runtime` 返回脱敏运行指针、hash 与事务 journal，不返回 PID 或 data-root 路径。
- `POST /v1/local-admin/visual/catalogs/draft` 建立明确的 catalog 草稿；`POST /catalogs/{id}/{revision}/validate|publish` 复用现有生命周期。
- `POST /v1/local-admin/visual/catalog-migration/preview|activate|rollback` 分别复用 v2 manifest 预览、copy-on-write 激活与精确 journal 回滚。

因 manifest 只接收 `published` 素材，新上传 draft 可先放入仅含该素材的独立暂存 catalog，经 `validate → publish` 后供迁移清单引用。暂存 catalog ID 必须与玩家 source/target ID 不同；服务端在 draft 创建和 publish 时拒绝与当前 `visual-control.activeCatalog` 或已有活动 catalog index 冲突的 ID，而不是只依赖操作者约定。发布只更新该暂存 catalog 自身的 asset-store index，必须验证原玩家 source index 和 `visual-control.activeCatalog` 仍逐字段不变。禁止直接修改 store/control 文件，禁止将暂存目录当成玩家活动目录，禁止使用普通 catalog rollback 替代玩家 migration rollback。完整玩家 manifest 必须从 live source catalog 的全部 refs 和 `characterChannels` 构造，不沿用 source pointer 过期的静态清单。

代码验收已覆盖 session 缺失、坏 CSRF、错误 Origin/Host、bearer transport、query transport、简单发布 fail-closed、暂存发布不切换玩家 source、纯读 preview、精确 activate/readback、内容 hash 读取及保留素材的 journal rollback。该结果仅是服务测试；本节补充的 live 目录激活和浏览器舞台显示仍须分开实测，不得据此报告视觉恢复完成。
