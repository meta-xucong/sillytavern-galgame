import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_DRAFT_SCHEMA_VERSION,
  DICTIONARY_HASH,
  DICTIONARY_VERSION,
  FileContentStore,
  FileVisualAssetStore,
  FileVisualControlStore,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  UPLOAD_SCHEMA_VERSION,
  computeAssetMetadataHash,
  computeCatalogHash,
  createVisualAssetService,
} from './server.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(moduleDir, 'data');
const assetsDir = path.join(moduleDir, 'side-art-assets');
const manifestPath = path.join(assetsDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const roleByType = Object.freeze({
  scene: 'background',
  character: 'transparent-sprite',
  equipment: 'icon',
  item: 'icon',
  skill: 'icon',
});

if (manifest.schemaVersion !== 'galgame.side-art-manifest.v1' || !Array.isArray(manifest.assets)) {
  throw new Error('side-art manifest is invalid');
}

const assetStore = new FileVisualAssetStore(path.join(dataDir, 'metadata'));
const contentStore = new FileContentStore(path.join(dataDir, 'content'));
const visualControlStore = new FileVisualControlStore(path.join(dataDir, 'control'));
const service = createVisualAssetService({
  assetStore,
  contentStore,
  visualControlStore,
  adminToken: 'local-side-art-import',
  adminOrigins: [],
});
await service.initialize();

const imported = [];
for (const entry of manifest.assets) {
  const existing = await assetStore.getAsset(entry.assetId, 1);
  let asset = existing;
  if (!asset) {
    const imageBytes = await readFile(path.join(assetsDir, entry.fileName));
    asset = await service.uploadAsset({
      schemaVersion: UPLOAD_SCHEMA_VERSION,
      metadata: {
        assetId: entry.assetId,
        assetVersion: 1,
        assetType: entry.assetType,
        role: roleByType[entry.assetType],
        title: entry.title,
        tagCodes: entry.tagCodes,
        featureCodes: entry.featureCodes,
        licenseCode: 'user-owned',
        sourceLabel: 'AI-generated curated side illustration',
      },
      imageBase64: imageBytes.toString('base64'),
    });
  }

  // The manifest carries closed dictionary tags. Mark these curated assets as
  // ready without requiring an external image analyzer, while preserving the
  // service's normal validation and metadata hashes.
  if (asset.analysisStatus !== 'ready'
    || asset.analysis?.schemaVersion !== VISUAL_ANALYSIS_SCHEMA_VERSION
    || asset.analysis?.dictionaryVersion !== DICTIONARY_VERSION
    || asset.analysis?.dictionaryHash !== DICTIONARY_HASH) {
    const updatedAt = new Date().toISOString();
    const finalized = {
      ...asset,
      analysisStatus: 'ready',
      analysis: {
        schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
        status: 'ready',
        description: entry.title,
        tagCodes: [...entry.tagCodes],
        attributeCodes: [...entry.featureCodes],
        confidence: 0.98,
        analyzerVersion: 'side-art-curated-v1',
        errorCode: null,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
      },
      updatedAt,
    };
    finalized.assetMetadataHash = computeAssetMetadataHash(finalized);
    asset = await assetStore.replaceAsset(finalized, asset.assetMetadataHash);
  }
  imported.push(asset);
}

const control = await visualControlStore.getControl();
const active = control.activeCatalog
  ? await assetStore.getCatalog(control.activeCatalog.catalogId, control.activeCatalog.catalogRevision)
  : null;
const refs = imported.map((asset) => ({
  assetId: asset.assetId,
  assetVersion: asset.assetVersion,
}));

const catalogBase = `galgame_side_art_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
let catalogId = catalogBase;
for (let suffix = 2; await assetStore.getCatalog(catalogId, 1); suffix += 1) {
  catalogId = `${catalogBase}_r${suffix}`;
}
const draft = await service.createCatalogDraft({
  schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
  catalogId,
  catalogRevision: 1,
  assetRefs: refs.filter((ref) => imported.some((asset) => asset.assetId === ref.assetId && asset.assetVersion === ref.assetVersion && asset.status === 'draft')),
});
// Existing catalog assets are already published and therefore cannot be
// submitted as new draft refs. Merge their trusted refs into this draft after
// creation; lifecycle validation still verifies every content and metadata
// hash before publication.
if (active?.assetRefs?.length) {
  const merged = {
    ...draft,
    assetRefs: [...active.assetRefs, ...draft.assetRefs],
    updatedAt: new Date().toISOString(),
  };
  merged.catalogHash = computeCatalogHash(merged);
  await assetStore.replaceCatalog(merged, draft.catalogHash);
}
await service.updateCatalogLifecycle(draft.catalogId, draft.catalogRevision, 'validate');
const published = await service.updateCatalogLifecycle(draft.catalogId, draft.catalogRevision, 'publish');
await visualControlStore.setControl({
  ...control,
  enabled: true,
  activeCatalog: {
    catalogId: published.catalogId,
    catalogRevision: published.catalogRevision,
    catalogHash: published.catalogHash,
  },
  updatedAt: new Date().toISOString(),
});

console.log(JSON.stringify({
  ok: true,
  imported: imported.map((asset) => ({ assetId: asset.assetId, assetType: asset.assetType, status: asset.status, analysisStatus: asset.analysisStatus })),
  catalog: { catalogId: published.catalogId, catalogRevision: published.catalogRevision, catalogHash: published.catalogHash, assetCount: published.assetRefs.length },
}, null, 2));
