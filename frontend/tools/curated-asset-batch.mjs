#!/usr/bin/env node

/**
 * Deterministic, provider-neutral curated visual batch importer.
 *
 * The command deliberately generates small procedural illustrations rather than
 * pretending that a remote image provider was called.  It exercises the same
 * production sanitizer, content hashing, analysis, catalog lifecycle and
 * activation code used by the visual asset service.  A real image provider can
 * replace `renderAsset` later; the manifest identity/seed and upload contract
 * stay unchanged.
 *
 * Safe default: all state is written below a temporary directory and removed
 * when the run completes.  Writing a runtime catalog requires both
 * `--data-dir <dir>` and `--activate --allow-runtime-data`.
 */

import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import {
  createVisualAssetService,
  FileVisualAssetStore,
  FileContentStore,
  FileVisualControlStore,
  UPLOAD_SCHEMA_VERSION,
  CATALOG_DRAFT_SCHEMA_VERSION,
  encodePng,
} from '../../external-modules/visual-asset-service/server.mjs';

const DEFAULT_MANIFEST = new URL('../../external-modules/visual-asset-service/curated-asset-seeds.json', import.meta.url);
const RGB = 2;
const RGBA = 6;

const SCENE_PALETTE = {
  tavern: [154, 92, 51], forest: [61, 124, 77], ruins: [112, 109, 127], city: [92, 118, 156],
  dungeon: [58, 65, 87], coast: [70, 145, 178], manor: [136, 102, 154], battlefield: [132, 87, 76],
};
const TIME_TINT = { day: [36, 32, 18], dusk: [70, 33, 62], night: [12, 18, 46], rain: [22, 48, 72] };
const CHARACTER_PALETTE = {
  human: [215, 161, 124], elf: [166, 207, 174], dwarf: [185, 145, 102], rogue: [113, 132, 176],
  mage: [142, 112, 204], knight: [150, 165, 183], beastkin: [194, 136, 101], undead: [125, 145, 150],
  cleric: [224, 210, 157], merchant: [192, 145, 107], noble: [204, 146, 183], scholar: [147, 182, 204],
};
const ICON_PALETTE = {
  equipment: [155, 174, 209], item: [214, 164, 86], skill: [179, 117, 215],
};

function hash32(text) {
  let h = 2166136261;
  for (const byte of Buffer.from(String(text), 'utf8')) h = Math.imul(h ^ byte, 16777619);
  return h >>> 0;
}

function clamp(value) { return Math.max(0, Math.min(255, Math.round(value))); }

function pixelNoise(x, y, salt = 0) {
  // Low amplitude deterministic grain keeps canonical PNG compression within
  // the production decoder's ratio budget while remaining visually invisible.
  let n = (Math.imul((x + salt) | 0, 374761393) + Math.imul((y + 17) | 0, 668265263) + Math.imul(salt + 1, 2246822519)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n ^ (n >>> 16)) & 7;
}

function pixelNoiseByte(x, y, salt = 0) {
  let n = (Math.imul((x + salt) | 0, 374761393) + Math.imul((y + 17) | 0, 668265263) + Math.imul(salt + 1, 2246822519)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n ^ (n >>> 16)) & 255;
}

function pixelBuffer(width, height, channels, fn) {
  const scanlines = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * channels + 1);
    scanlines[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const rgba = fn(x, y, width, height);
      const offset = row + 1 + x * channels;
      scanlines[offset] = clamp(rgba[0]);
      scanlines[offset + 1] = clamp(rgba[1]);
      scanlines[offset + 2] = clamp(rgba[2]);
      if (channels === 4) scanlines[offset + 3] = clamp(rgba[3] ?? 255);
    }
  }
  return scanlines;
}

function renderScene(seed, key) {
  const [_, place = 'forest', time = 'day'] = key.split('-');
  const base = SCENE_PALETTE[place] || [92, 118, 156];
  const tint = TIME_TINT[time] || [28, 28, 28];
  const jitter = hash32(seed) % 19;
  return encodePng({ width: 1536, height: 1024, bitDepth: 8, colorType: RGB, compression: 0, filter: 0, interlace: 0 }, pixelBuffer(1536, 1024, 3, (x, y, w, h) => {
    const horizon = Math.floor(h * 0.62);
    const sky = y < horizon;
    const stripe = Math.sin((x + jitter) / 42) * 5 + Math.sin(y / 31) * 3 + pixelNoise(x, y, jitter) - 3;
    if (sky) {
      const p = y / horizon;
      return [base[0] + tint[0] * p + stripe, base[1] + tint[1] * p + stripe, base[2] + tint[2] * p + stripe];
    }
    const p = (y - horizon) / (h - horizon);
    const foreground = place === 'forest' ? [32, 74, 42] : place === 'coast' ? [48, 93, 105] : [42, 41, 48];
    const path = Math.abs(x - w / 2) < (70 + p * 360);
    return path ? [foreground[0] + 25 * (1 - p), foreground[1] + 22 * (1 - p), foreground[2] + 15 * (1 - p)] : [foreground[0] * (1 - p * 0.2), foreground[1] * (1 - p * 0.2), foreground[2] * (1 - p * 0.2)];
  }));
}

function renderCharacter(seed, key) {
  const parts = key.split('-');
  const gender = parts[1] || 'woman';
  const archetype = parts.slice(2).join('-') || 'human';
  const base = CHARACTER_PALETTE[archetype] || CHARACTER_PALETTE.human;
  const hair = gender === 'man' ? [55, 66, 87] : [105, 58, 105];
  const wobble = hash32(seed) % 37;
  const width = 1024; const height = 1536;
  return encodePng({ width, height, bitDepth: 8, colorType: RGBA, compression: 0, filter: 0, interlace: 0 }, pixelBuffer(width, height, 4, (x, y, w, h) => {
    const nx = (x - w / 2) / (w * 0.25);
    const headY = h * 0.22 + wobble;
    const bodyY = h * 0.48;
    const head = ((x - w / 2) ** 2) / (w * 0.13) ** 2 + ((y - headY) ** 2) / (h * 0.075) ** 2 < 1;
    const hairShape = ((x - w / 2) ** 2) / (w * 0.145) ** 2 + ((y - headY + 18) ** 2) / (h * 0.09) ** 2 < 1;
    const torso = Math.abs(nx) < 0.44 && y > bodyY && y < h * 0.78;
    const legs = Math.abs(nx) < 0.3 && y >= h * 0.78 && y < h * 0.98;
    const grain = pixelNoise(x, y, wobble) - 3;
    if (hairShape) return [hair[0] + grain, hair[1] + grain, hair[2] + grain, 255];
    if (head) return [base[0] + grain, base[1] + grain, base[2] + grain, 255];
    if (torso) return [base[0] * 0.55 + grain, base[1] * 0.55 + grain, base[2] * 0.7 + grain, 255];
    if (legs) return [base[0] * 0.35 + grain, base[1] * 0.35 + grain, base[2] * 0.45 + grain, 255];
    return [grain, grain, grain, 0];
  }));
}

function renderIcon(seed, key, type) {
  const base = ICON_PALETTE[type] || [160, 160, 180];
  const n = Number(key.match(/(\d+)$/)?.[1] || 1);
  const width = 1254; const height = 1254; const shift = hash32(seed) % 20;
  return encodePng({ width, height, bitDepth: 8, colorType: RGBA, compression: 0, filter: 0, interlace: 0 }, pixelBuffer(width, height, 4, (x, y) => {
    const center = width / 2;
    const dx = x - center; const dy = y - center;
    const circle = dx * dx + dy * dy < 360 * 360;
    const ring = dx * dx + dy * dy < 295 * 295;
    const stripe = ((x + y + shift) % (18 + n)) < 8;
    const grain = pixelNoise(x, y, shift) - 3;
    if (!circle) return [grain, grain, grain, (pixelNoiseByte(x, y, shift) & 1) ? 1 : 0];
    if (!ring) return [base[0] * 0.35, base[1] * 0.35, base[2] * 0.35, 255];
    return stripe ? [base[0], base[1], base[2], 255] : [base[0] * 0.7, base[1] * 0.7, base[2] * 0.7, 255];
  }));
}

export function renderAsset(seed, asset) {
  if (asset.assetType === 'scene') return renderScene(seed, asset.assetKey);
  if (asset.assetType === 'character') return renderCharacter(seed, asset.assetKey);
  return renderIcon(seed, asset.assetKey, asset.assetType);
}

function metadataFor(asset) {
  const parts = asset.assetKey.split('-');
  const tags = [];
  const features = [];
  if (asset.assetType === 'scene') {
    const place = parts[1];
    const placeCode = { tavern: 'scene.interior', forest: 'scene.forest', ruins: 'scene.ruins', city: 'scene.city', dungeon: 'scene.dungeon', coast: 'scene.exterior', manor: 'scene.interior', battlefield: 'scene.exterior' }[place];
    const timeCode = { day: 'scene.day', night: 'scene.night' }[parts[2]];
    if (placeCode) tags.push(placeCode);
    if (timeCode) tags.push(timeCode);
  } else if (asset.assetType === 'character') {
    const gender = parts[1];
    const species = parts.at(-1);
    const genderCode = { woman: 'character.feminine', man: 'character.masculine', androgynous: 'character.androgynous' }[gender];
    const speciesCode = {
      human: 'character.human', elf: 'character.elf', dwarf: 'character.dwarf', beastkin: 'character.beastkin',
      undead: 'character.undead', rogue: 'character.rogue', mage: 'character.mage', cleric: 'character.cleric',
      merchant: 'character.merchant', noble: 'character.noble', knight: 'character.armored', scholar: 'character.humanoid',
    }[species];
    if (genderCode) tags.push(genderCode);
    if (speciesCode) tags.push(speciesCode);
    if (!tags.some((tag) => tag.startsWith('character.'))) tags.push('character.humanoid');
    features.push('feature.transparent', 'feature.full-body', 'feature.neutral-pose');
  } else if (asset.assetType === 'equipment') {
    tags.push('equipment.common', 'equipment.weapon'); features.push('feature.icon');
  } else if (asset.assetType === 'item') {
    tags.push('item.misc'); features.push('feature.icon');
  } else {
    tags.push('skill.magic'); features.push('feature.icon', 'feature.active');
  }
  return {
    assetId: `asset_curated_${asset.assetKey}`,
    assetVersion: 1,
    assetType: asset.assetType,
    role: asset.assetType === 'scene' ? 'background' : asset.assetType === 'character' ? 'transparent-sprite' : 'icon',
    title: asset.assetKey,
    tagCodes: [...new Set(tags)],
    featureCodes: [...new Set(features)],
    licenseCode: 'user-owned',
    sourceLabel: `curated procedural batch ${asset.seed}`,
  };
}

export async function runCuratedBatch({ manifestPath = DEFAULT_MANIFEST, dataDir, inputDir = null, outputDir = null, activate = true, keepTemp = false } = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 'galgame.visual-curated-asset-seeds.v1') throw new Error('unsupported curated seed manifest');
  const ownedTemp = !dataDir;
  const root = dataDir || await mkdtemp(path.join(os.tmpdir(), 'galgame-curated-visual-batch-'));
  const stores = {
    assetStore: new FileVisualAssetStore(path.join(root, 'metadata')),
    contentStore: new FileContentStore(path.join(root, 'content')),
    visualControlStore: new FileVisualControlStore(path.join(root, 'control')),
  };
  const service = createVisualAssetService({ ...stores, adminToken: 'local-curated-batch-test-token', adminOrigins: [] });
  await service.initialize();
  const previousControl = await stores.visualControlStore.getControl();
  const previousCatalogs = await stores.assetStore.listCatalogs();
  if (outputDir) await mkdir(outputDir, { recursive: true });
  const uploaded = [];
  for (const asset of manifest.assets) {
    const suppliedPath = inputDir ? path.join(inputDir, `${asset.assetKey}.png`) : null;
    const bytes = suppliedPath && existsSync(suppliedPath) ? await readFile(suppliedPath) : renderAsset(asset.seed, asset);
    const uploadedAsset = await service.uploadAsset({ schemaVersion: UPLOAD_SCHEMA_VERSION, metadata: metadataFor(asset), imageBase64: bytes.toString('base64') });
    if (outputDir) {
      const canonical = await service.stores.contentStore.get(uploadedAsset.assetContentSha256);
      if (!canonical) throw new Error(`sanitized content missing for ${asset.assetKey}`);
      await writeFile(path.join(outputDir, `${asset.assetKey}.png`), canonical.bytes);
    }
    uploaded.push(uploadedAsset);
  }
  const catalogId = `galgame_curated_batch_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  const draft = await service.createCatalogDraft({ schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION, catalogId, catalogRevision: 1, assetRefs: uploaded.map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion })) });
  const validated = await service.updateCatalogLifecycle(catalogId, 1, 'validate');
  const published = await service.updateCatalogLifecycle(catalogId, 1, 'publish');
  const control = await stores.visualControlStore.getControl();
  if (activate) await stores.visualControlStore.setControl({ ...control, enabled: true, activeCatalog: { catalogId, catalogRevision: 1, catalogHash: published.catalogHash }, updatedAt: new Date().toISOString() });
  const result = { ok: true, catalogId, catalogRevision: 1, assetCount: uploaded.length, contentHashes: uploaded.map((asset) => asset.assetContentSha256), statuses: { draft: draft.status, validated: validated.status, published: published.status }, activated: Boolean(activate), previousActiveCatalog: previousControl.activeCatalog || null, preservedCatalogs: previousCatalogs.map((catalog) => ({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash, status: catalog.status })), dataDir: root, outputDir };
  if (ownedTemp && !keepTemp) await rm(root, { recursive: true, force: true });
  return result;
}

function parseArgs(argv) {
  const args = [...argv];
  const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : null; };
  const activate = args.includes('--activate');
  const dataDir = value('--data-dir');
  if (activate && (!dataDir || !args.includes('--allow-runtime-data'))) throw new Error('--activate requires --data-dir and --allow-runtime-data');
  return { manifestPath: value('--manifest') || DEFAULT_MANIFEST, dataDir, inputDir: value('--input-dir'), outputDir: value('--output-dir'), activate, keepTemp: args.includes('--keep-temp') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runCuratedBatch(parseArgs(process.argv.slice(2))).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(JSON.stringify({ ok: false, error: error.message })); process.exitCode = 1; });
}
