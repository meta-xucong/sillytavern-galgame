import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../../../external-modules/visual-asset-service/curated-asset-seeds.json', import.meta.url), 'utf8'));
assert.equal(manifest.schemaVersion, 'galgame.visual-curated-asset-seeds.v1');
assert.deepEqual(manifest.targets, { scene: 32, character: 42, equipment: 8, item: 8, skill: 8 });
assert.equal(manifest.assets.length, 98);
assert.equal(manifest.generationPolicy.providerNeutral, true);
assert.equal(manifest.generationPolicy.dedupe, 'assetContentSha256');
assert.equal(manifest.generationPolicy.rejectDiagnostics, true);
assert.equal(manifest.generationPolicy.preserveRollback, true);
assert.equal(manifest.generationPolicy.uploadFlow.includes('sanitize and hash'), true);
assert.equal(manifest.generationPolicy.uploadFlow.includes('analyze with closed dictionary'), true);
assert.equal(manifest.generationPolicy.uploadFlow.includes('validate'), true);
assert.equal(manifest.generationPolicy.uploadFlow.includes('publish'), true);
assert.equal(new Set(manifest.assets.map((asset) => asset.assetKey)).size, manifest.assets.length);
assert.equal(new Set(manifest.assets.map((asset) => asset.identityKey)).size, manifest.assets.length);
assert.equal(new Set(manifest.assets.map((asset) => asset.seed)).size, manifest.assets.length);
for (const [type, count] of Object.entries(manifest.targets)) {
    const assets = manifest.assets.filter((asset) => asset.assetType === type);
    assert.equal(assets.length, count, `${type} seed count`);
    for (const asset of assets) {
        assert.equal(asset.curationStatus, 'planned');
        assert.equal(asset.contentHash, null);
    }
}
const enemyKeys = manifest.assets
    .filter((asset) => asset.assetType === 'character' && asset.tags.includes('enemy'))
    .map((asset) => asset.assetKey);
assert.equal(enemyKeys.length, 18);
assert.equal(enemyKeys.includes('character-androgynous-goblin'), true);
assert.equal(enemyKeys.includes('character-androgynous-skeleton'), true);
assert.equal(enemyKeys.includes('character-androgynous-bandit'), true);
console.log('curated visual asset seed tests passed');
