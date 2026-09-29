# Galgame 视觉素材扩充清单

`external-modules/visual-asset-service/curated-asset-seeds.json` 是管理员使用的、可复现的素材生成清单，不是运行时剧情数据，也不包含 API key 或图片二进制。清单按当前视觉服务的安全 PNG 合同记录尺寸、透明度、稳定 `assetKey`、`identityKey`、提示词模板和种子：

- 32 张场景图：酒馆、森林、遗迹、城市、地牢、海岸、庄园和战场各 4 个时段/天气变体，1536×1024，不透明背景。
- 24 个角色立绘：人类、精灵、矮人、盗贼、法师、骑士、兽人、亡灵、牧师、商人、贵族和学者的男女版本，1024×1536，透明全身立绘。
- 装备、道具、技能各 8 个透明图标，1254×1254。

清单中的 `contentHash` 在实际图片生成和上传前保持为空。管理员生成图片后必须逐张通过“上传 PNG → 清洗并计算 `assetContentSha256` → 独立分析器闭集标签 → 草稿 → 校验 → 发布 → 激活”流程；同一内容哈希只能保留一份，诊断图、探针图、provider 调试图和无授权素材不得进入发布目录。发布新目录前保留旧 catalog 版本，以便存档按原版本回滚。

角色的性别、种族、外观和服装是可见投影中的显式证据。当前闭集分析字典仍需管理员为新素材提供可审核的标签；清单里的自由文本 tags 只用于生成和人工筛选，不能被当作已经写入运行时 catalog 的分析代码。若要让 LLM 对性别/种族进行闭集语义评分，需要单独升级视觉字典和 catalog migration，不能通过前端猜测完成。

## 每批导入的验收证据

管理员完成一批生成后，应保存以下证据再激活 catalog：

1. 清单条目数与实际 PNG 数量一一对应，`assetKey → assetContentSha256` 无重复且尺寸/透明度符合类型合同。
2. 每个资产的分析回执包含一致的 `dictionaryVersion`、`dictionaryHash`、状态和闭集标签；诊断/探针资产被拒绝。
3. `draft → validate → publish → activate` 返回的 `catalogId`、revision、catalog hash 和 asset refs 可复核。
4. 激活前后保留旧 catalog 的 revision/hash，并验证一次回滚；现有存档继续指向原发布版本。

## 可复现本地批处理器

`frontend/tools/curated-asset-batch.mjs` 提供一个不依赖具体供应商的验收批处理器。它使用固定
`seed` 生成可替换的程序化 PNG，然后调用视觉服务的真实 sanitizer、内容哈希、分析、目录草稿、
校验和发布代码。默认使用临时目录，运行完成后清理，因此不会修改仓库的 `data/**` 或聊天记录：

```powershell
node frontend/tools/curated-asset-batch.mjs `
  --output-dir "$env:TEMP\galgame-curated-preview"
```

如果管理员已经从实际图像供应商生成了同名 PNG，可通过 `--input-dir` 导入这些文件；缺失条目
才会回退到确定性程序化图，用于发现尺寸、透明度、压缩率或标签错误：

```powershell
node frontend/tools/curated-asset-batch.mjs `
  --input-dir "D:\\generated\\galgame-curated" `
  --output-dir "$env:TEMP\galgame-curated-sanitized"
```

成功结果应报告 `assetCount: 80`、三阶段状态分别为 `draft`、`validated`、`published`，且
`contentHashes` 数量为 80 并全部唯一。程序化图仅用于验证导入和激活链路，不冒充外部图像供应商
的最终美术；管理员可把 `renderAsset` 替换为实际生成器，保持清单中的 `assetKey`、`seed`、
PNG 尺寸、透明度和上传合同不变。

向真实运行时目录写入必须显式同时提供 `--data-dir`、`--activate` 和
`--allow-runtime-data`；这会创建新的 catalog 并把它设为 active，旧 catalog 文件保持不动，
之后可通过原有 rollback API 恢复。没有这三个参数时批处理器不会触碰运行时目录。
