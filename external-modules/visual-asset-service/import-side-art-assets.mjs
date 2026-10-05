import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  CATALOG_DRAFT_SCHEMA_VERSION,
  CATALOG_V2_SCHEMA_VERSION,
  DICTIONARY_HASH,
  DICTIONARY_VERSION,
  FileContentStore,
  FileVisualAssetStore,
  FileVisualControlStore,
  acquireVisualServiceDataRootLease,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  UPLOAD_SCHEMA_VERSION,
  computeAssetMetadataHash,
  computeCatalogHash,
  createVisualAssetService,
} from './server.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(moduleDir, 'data');
const DEFAULT_ASSETS_DIR = path.join(moduleDir, 'side-art-assets');
const DEFAULT_MANIFEST_PATH = path.join(DEFAULT_ASSETS_DIR, 'manifest.json');
const DEFAULT_SERVICE_HOST = process.env.GALGAME_VISUAL_ASSET_HOST || '127.0.0.1';
const DEFAULT_SERVICE_PORT = Number(process.env.GALGAME_VISUAL_ASSET_PORT || 8798);
const roleByType = Object.freeze({
  scene: 'background',
  character: 'transparent-sprite',
  equipment: 'icon',
  item: 'icon',
  skill: 'icon',
});
const CHARACTER_CHANNELS = new Set(['character', 'player', 'narrator', 'system']);
const APPROVED_SIDE_ART_FILES = Object.freeze({
  'narrator-ink-emblem.png': { assetId: 'asset_curated_character-narrator-ink-emblem', sha256: '45d6262cf3cd8e1992052d4c9d5dba53ad2f776af22791fa03420aca1e0f33d2' },
  'player-neutral-compass.png': { assetId: 'asset_curated_player-neutral-compass', sha256: 'cc904b3d8f2e121171f526aa97ed46dc7a88318fd0f6e6e53eafd12dc84407b3' },
  'equipment-arcane-sword.png': { assetId: 'asset_side_equipment_arcane_sword', sha256: 'ef5820b6df5979e77b2ee6afe48b98e00ad2a43b3969e2369534156f3fa46d32' },
  'equipment-teal-armor.png': { assetId: 'asset_side_equipment_teal_armor', sha256: '6cb41c6d6fb57d52de7d47cbcc6ea9f58cf13e29af0bee7f055b6abee3b6debb' },
  'item-healing-potion.png': { assetId: 'asset_side_item_healing_potion', sha256: '916b468b01f7ccd37d7d75a6187eee607758112a475de5c97bcc75e0d469e172' },
  'item-treasure-map.png': { assetId: 'asset_side_item_treasure_map', sha256: '4461b5f6ffda05bcd2e88d6dcf465e320ab13bc0252dfee69059b9da98c00527' },
  'skill-arcane-grimoire.png': { assetId: 'asset_side_skill_arcane_grimoire', sha256: '3a294e3a9d700110913beff560f3afa6fff084c13884664093407602f19054c6' },
  'skill-shadow-knife.png': { assetId: 'asset_side_skill_shadow_knife', sha256: 'f52b1eb832b3041a28e48b08240f5b568630628ed751477afcd8c15313b91ded' },
  'skill-shield-strike.png': { assetId: 'asset_side_skill_shield_strike', sha256: 'bb88b2927f51facaff121209d46040ba6b78c17f76f7ee8924974f10a60aa7fa' },
});

export function buildCharacterChannelsForMergedCatalog(assetRefs, {
  existingCatalog = null,
  manifestAssets = [],
  legacyCharacterChannels = [],
} = {}) {
  const existingChannels = new Map((existingCatalog?.schemaVersion === CATALOG_V2_SCHEMA_VERSION
    ? existingCatalog.characterChannels
    : []).map((entry) => [`${entry.assetId}:${entry.assetVersion}`, entry.channel]));
  const manifestChannels = new Map();
  for (const entry of manifestAssets) {
    if (entry.assetType !== 'character') continue;
    const assetVersion = entry.assetVersion ?? 1;
    if (typeof entry.assetId !== 'string' || !entry.assetId
        || !Number.isSafeInteger(assetVersion) || assetVersion < 1) {
      throw new Error('manifest character channel reference is invalid');
    }
    if (assetVersion !== 1) throw new Error(`side-art importer only supports character asset version 1 for ${entry.assetId}`);
    const channel = entry.channel;
    if (typeof channel !== 'string') throw new Error(`explicit channel is required for ${entry.assetId}`);
    if (!CHARACTER_CHANNELS.has(channel)) throw new Error(`invalid character channel for ${entry.assetId}`);
    const key = `${entry.assetId}:${assetVersion}`;
    if (manifestChannels.has(key)) throw new Error(`manifest character channel reference ${key} is duplicated`);
    manifestChannels.set(key, channel);
  }
  if (!Array.isArray(legacyCharacterChannels)) throw new Error('legacy character channel migration list must be an array');
  const legacyChannels = new Map();
  const legacyRefs = new Map((existingCatalog?.schemaVersion === 'galgame.visual-asset-catalog.v1'
    ? existingCatalog.assetRefs
    : []).filter((ref) => ref.assetType === 'character' && !ref.assetId.startsWith('unknown_'))
    .map((ref) => [`${ref.assetId}:${ref.assetVersion}`, ref]));
  for (const [index, entry] of legacyCharacterChannels.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).sort().join(',') !== 'assetId,assetVersion,channel'
        || typeof entry.assetId !== 'string' || !entry.assetId
        || !Number.isSafeInteger(entry.assetVersion) || entry.assetVersion < 1
        || !CHARACTER_CHANNELS.has(entry.channel)) {
      throw new Error(`legacy character channel migration entry ${index} is invalid`);
    }
    const key = `${entry.assetId}:${entry.assetVersion}`;
    if (legacyChannels.has(key)) throw new Error(`legacy character channel migration entry ${key} is duplicated`);
    if (!legacyRefs.has(key)) throw new Error(`legacy character channel migration entry ${key} is not in the v1 source catalog`);
    legacyChannels.set(key, entry.channel);
  }

  return assetRefs
    .filter((ref) => ref.assetType === 'character' && !ref.assetId.startsWith('unknown_'))
    .map((ref) => {
      const key = `${ref.assetId}:${ref.assetVersion}`;
      const manifestChannel = manifestChannels.get(key);
      const existingChannel = existingChannels.get(key);
      const legacyChannel = legacyChannels.get(key);
      if (manifestChannel && legacyChannel) {
        throw new Error(`legacy migration entry overlaps side-art manifest channel for ${key}`);
      }
      if (existingCatalog?.schemaVersion === CATALOG_V2_SCHEMA_VERSION
          && existingChannel && manifestChannel && existingChannel !== manifestChannel) {
        throw new Error(`manifest channel conflicts with existing v2 channel for ${key}`);
      }
      if (existingCatalog?.schemaVersion === 'galgame.visual-asset-catalog.v1'
          && legacyRefs.has(key) && !manifestChannel && !legacyChannel) {
        throw new Error(`legacy character channel migration is required for ${key}`);
      }
      if (existingCatalog?.schemaVersion === CATALOG_V2_SCHEMA_VERSION && !manifestChannel && !existingChannel) {
        throw new Error(`existing v2 character channel is missing for ${key}`);
      }
      const channel = existingChannel || manifestChannel || legacyChannel;
      if (!channel) throw new Error(`explicit channel is required for ${key}`);
      return {
      assetId: ref.assetId,
      assetVersion: ref.assetVersion,
      channel,
      };
    });
}

function assertManifestShape(manifest) {
  if (manifest.schemaVersion !== 'galgame.side-art-manifest.v1' || !Array.isArray(manifest.assets)
      || manifest.assets.length < 1 || manifest.assets.length > 128
      || (manifest.legacyCharacterChannels !== undefined && !Array.isArray(manifest.legacyCharacterChannels))) {
    throw new Error('side-art manifest is invalid');
  }
  const assetIds = new Set();
  const fileNames = new Set();
  for (const [index, entry] of manifest.assets.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || typeof entry.assetId !== 'string' || !/^[a-z][a-z0-9_-]{2,79}$/u.test(entry.assetId)
        || typeof entry.fileName !== 'string' || path.basename(entry.fileName) !== entry.fileName
        || !Object.hasOwn(roleByType, entry.assetType)
        || typeof entry.title !== 'string' || !entry.title.trim()
        || !Array.isArray(entry.tagCodes) || !Array.isArray(entry.featureCodes)
        || [...entry.tagCodes, ...entry.featureCodes].some((code) => typeof code !== 'string' || !code)) {
      throw new Error(`side-art manifest asset ${index} is invalid`);
    }
    if (assetIds.has(entry.assetId) || fileNames.has(entry.fileName)) throw new Error(`side-art manifest duplicate asset/file at ${index}`);
    assetIds.add(entry.assetId);
    fileNames.add(entry.fileName);
    if (entry.assetType === 'character' && !CHARACTER_CHANNELS.has(entry.channel)) {
      throw new Error(`explicit character channel is required for ${entry.assetId}`);
    }
    if (entry.assetType !== 'character' && Object.hasOwn(entry, 'channel')) {
      throw new Error(`non-character channel is not allowed for ${entry.assetId}`);
    }
    const approved = APPROVED_SIDE_ART_FILES[entry.fileName];
    if (!approved || approved.assetId !== entry.assetId) throw new Error(`unapproved side-art file mapping for ${entry.assetId}`);
  }
  const channelCounts = Object.fromEntries([...CHARACTER_CHANNELS].map((channel) => [channel, 0]));
  for (const entry of manifest.assets) if (entry.assetType === 'character') channelCounts[entry.channel] += 1;
  if (!channelCounts.narrator || !channelCounts.player || channelCounts.system !== 0) {
    throw new Error('side-art manifest requires narrator and player assets and must not assign system assets');
  }
  if (manifest.legacyCharacterChannels !== undefined && !Array.isArray(manifest.legacyCharacterChannels)) {
    throw new Error('legacy character channel migration list must be an array');
  }
}

async function preflightSideArtImport({ manifest, assetsDir, dataDir }) {
  assertManifestShape(manifest);
  const absoluteAssetsDir = path.resolve(assetsDir);
  for (const entry of manifest.assets) {
    const approved = APPROVED_SIDE_ART_FILES[entry.fileName];
    const filePath = path.resolve(absoluteAssetsDir, entry.fileName);
    if (path.dirname(filePath) !== absoluteAssetsDir) throw new Error(`side-art file escaped its source directory: ${entry.fileName}`);
    const info = await stat(filePath);
    if (!info.isFile() || info.size < 1 || info.size > 15 * 1024 * 1024) throw new Error(`side-art file is invalid: ${entry.fileName}`);
    const bytes = await readFile(filePath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== approved.sha256) throw new Error(`side-art file hash mismatch: ${entry.fileName}`);
  }
  // Validate channel coverage against the currently published catalog using
  // read-only record reads, before constructing file stores or initializing the
  // service (initialize writes canonical unknown assets/content).
  const controlPath = path.join(dataDir, 'control', 'visual-control.json');
  if (!existsSync(controlPath)) {
    buildCharacterChannelsForMergedCatalog(manifest.assets
      .filter((entry) => entry.assetType === 'character')
      .map((entry) => ({ assetId: entry.assetId, assetVersion: 1, assetType: 'character' })), {
      manifestAssets: manifest.assets,
      legacyCharacterChannels: manifest.legacyCharacterChannels || [],
    });
    return;
  }
  const control = JSON.parse(await readFile(controlPath, 'utf8'));
  if (!control || control.schemaVersion !== 'galgame.visual-control.v1'
      || !control.activeCatalog || typeof control.activeCatalog.catalogId !== 'string'
      || !Number.isSafeInteger(control.activeCatalog.catalogRevision)
      || typeof control.activeCatalog.catalogHash !== 'string') throw new Error('active visual control is invalid');
  const pointer = control.activeCatalog;
  const catalogPath = path.join(dataDir, 'metadata', 'catalogs', `${pointer.catalogId}-${pointer.catalogRevision}.json`);
  const activePointerPath = path.join(dataDir, 'metadata', 'active-catalogs', `${pointer.catalogId}.json`);
  const [catalogRecord, activePointer] = await Promise.all([
    readFile(catalogPath, 'utf8').then(JSON.parse),
    readFile(activePointerPath, 'utf8').then(JSON.parse),
  ]);
  const sourceCatalog = catalogRecord?.catalog;
  if (!sourceCatalog || sourceCatalog.status !== 'published' || sourceCatalog.catalogHash !== pointer.catalogHash
      || JSON.stringify(activePointer) !== JSON.stringify(pointer)) throw new Error('active catalog pointers are inconsistent');
  buildCharacterChannelsForMergedCatalog(sourceCatalog.assetRefs, {
    existingCatalog: sourceCatalog,
    manifestAssets: manifest.assets,
    legacyCharacterChannels: manifest.legacyCharacterChannels || [],
  });
}

export async function importSideArtAssets({
  dataDir = DEFAULT_DATA_DIR,
  assetsDir = DEFAULT_ASSETS_DIR,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const lease = await acquireVisualServiceDataRootLease(dataDir, {
    host: DEFAULT_SERVICE_HOST,
    port: DEFAULT_SERVICE_PORT,
  });
  try {
    return await importSideArtAssetsWithLease({ dataDir, assetsDir, manifestPath });
  } finally {
    await lease.release();
  }
}

async function importSideArtAssetsWithLease({ dataDir, assetsDir, manifestPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await preflightSideArtImport({ manifest, assetsDir, dataDir });

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
      const uploaded = await service.uploadAsset({
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

      // The bundled manifest supplies reviewed, closed dictionary tags. Only
      // newly imported records receive this metadata update; existing asset
      // versions stay byte-for-byte and hash-for-hash unchanged.
      const finalized = {
        ...uploaded,
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
        updatedAt: new Date().toISOString(),
      };
      finalized.assetMetadataHash = computeAssetMetadataHash(finalized);
      asset = await assetStore.replaceAsset(finalized, uploaded.assetMetadataHash);
    }
    imported.push(asset);
  }

  const control = await visualControlStore.getControl();
  const active = control.activeCatalog
    ? await assetStore.getCatalog(control.activeCatalog.catalogId, control.activeCatalog.catalogRevision)
    : null;
  if (active && active.catalogHash !== control.activeCatalog.catalogHash) {
    throw new Error('active catalog pointer does not match stored catalog');
  }
  const importedDraftRefs = imported
    .filter((asset) => asset.status === 'draft')
    .map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion }));

  const catalogBase = `galgame_side_art_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  let catalogId = catalogBase;
  for (let suffix = 2; await assetStore.getCatalog(catalogId, 1); suffix += 1) {
    catalogId = `${catalogBase}_r${suffix}`;
  }
  const draft = await service.createCatalogDraft({
    schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
    catalogId,
    catalogRevision: 1,
    assetRefs: importedDraftRefs,
    characterChannels: buildCharacterChannelsForMergedCatalog(importedDraftRefs.map((ref) => ({
      ...ref,
      assetType: imported.find((asset) => asset.assetId === ref.assetId && asset.assetVersion === ref.assetVersion)?.assetType,
    })), { manifestAssets: manifest.assets }),
  });

  if (active?.assetRefs?.length) {
    const merged = {
      ...draft,
      assetRefs: [...active.assetRefs, ...draft.assetRefs],
      characterChannels: buildCharacterChannelsForMergedCatalog([...active.assetRefs, ...draft.assetRefs], {
        existingCatalog: active,
        manifestAssets: manifest.assets,
        legacyCharacterChannels: manifest.legacyCharacterChannels || [],
      }),
      schemaVersion: CATALOG_V2_SCHEMA_VERSION,
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

  return {
    ok: true,
    imported: imported.map((asset) => ({ assetId: asset.assetId, assetType: asset.assetType, status: asset.status, analysisStatus: asset.analysisStatus })),
    catalog: {
      catalogId: published.catalogId,
      catalogRevision: published.catalogRevision,
      catalogHash: published.catalogHash,
      schemaVersion: published.schemaVersion,
      assetCount: published.assetRefs.length,
      characterChannels: published.characterChannels,
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  importSideArtAssets().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  });
}
