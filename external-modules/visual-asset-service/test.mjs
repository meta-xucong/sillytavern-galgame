import assert from 'node:assert/strict';
import {
    createHash,
    createHmac,
} from 'node:crypto';
import {
    createBuiltInSafePngDecoder,
    createVisualAssetService,
    MemoryContentStore,
    MemoryNonceStore,
    MemoryVisualAssetRetentionStore,
    MemoryVisualAssetStore,
    FileContentStore,
    FileVisualBindingStore,
    FileNonceStore,
    FileVisualAssetRetentionStore,
    FileVisualAssetStore,
    MemoryVisualBindingStore,
    serializePlayerPublishedAssetResponseForTest,
    validateVisualBindingStoreRecord,
    validateVisualProjectionReceipt,
    verifyVisualProjectionProofToken,
    verifyVisualAssetReadProof,
} from './server.mjs';
import {
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const adminToken = 'visual-admin-token';
const proofSecret = 'visual-proof-secret';
const proofKeyId = 'visual-key-v1';
const playerOrigin = 'http://127.0.0.1:8788';
const nowMs = Date.parse('2026-07-30T00:00:00.000Z');
const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('VISUAL_ASSET_TEST_PNG'),
]);
const CRC32_TABLE_FOR_TEST = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let crc = index;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
        table[index] = crc >>> 0;
    }
    return table;
})();
const validTransparentPngBytes = createPngForTest(1, 1);

const store = new MemoryVisualAssetStore();
const contentStore = new MemoryContentStore();
const retentionStore = new MemoryVisualAssetRetentionStore(() => nowMs);
const server = createVisualAssetService({
    store,
    contentStore,
    adminToken,
    adminOrigins: 'http://admin.example',
    playerOrigins: playerOrigin,
    proofSecrets: { [proofKeyId]: proofSecret },
    nonceStore: new MemoryNonceStore(() => nowMs),
    retentionStore,
    now: () => nowMs,
    allowTestImageDecoder: true,
    safeImageDecoder: createFakeDecoder(),
});
await listen(server);
const baseUrl = serverBaseUrl(server);

try {
    await testProductionModuleDoesNotExportSigner();
    await testNonBuiltinDecoderRequiresTestFlag();
    await testHealthWhitelist();
    await testAdminAuthAndOrigin();
    await testUploadAndConflict();
    await testUploadRejects();
    await testCatalogLifecycleAndPlayerRead();
    await testCatalogHashMismatchRejectsPublish();
    await testProofEnvelopeAndCanonicalFailures();
    await testFileNonceStoreRejectsIndependentSecondConsumer();
    await testCorsPreflight();
    await testPlayerDtoIsolation();
    await testFileStoresSurviveRestart();
    await testPersistentMetadataTamperFailures();
    await testBuiltInSafePngDecoderBoundary();
    await testDecoderUnavailableFailsClosed();
    await testVisualMatchProofStubAndUnknownGate();
    await testVisualBindingReceiptPersistence();
    console.log('visual-asset-service tests passed');
} finally {
    await close(server);
}

async function testHealthWhitelist() {
    const health = await fetchJson('/v1/health');
    assert.deepEqual(Object.keys(health).sort(), ['adminAuth', 'catalogStore', 'ok', 'schema', 'service'].sort());
    assert.equal(health.ok, true);
    assert.equal(health.service, 'visual-asset-service');
    assert.equal(health.adminAuth, 'required');
    assert.equal(health.catalogStore, 'memory');
    const healthJson = JSON.stringify(health);
    for (const forbidden of ['count', 'assets', 'uploads', 'filename', 'path', 'secret', 'token']) {
        assert.equal(healthJson.includes(forbidden), false);
    }
}

async function testProductionModuleDoesNotExportSigner() {
    const module = await import('./server.mjs');
    assert.equal(Object.prototype.hasOwnProperty.call(module, 'createVisualAssetReadProof'), false);
}

async function testNonBuiltinDecoderRequiresTestFlag() {
    const isolated = createVisualAssetService({
        adminToken,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new MemoryNonceStore(() => nowMs),
        now: () => nowMs,
        safeImageDecoder: createFakeDecoder(),
    });
    await listen(isolated);
    const isolatedBase = serverBaseUrl(isolated);
    try {
        const rejected = await rawUploadTo(isolatedBase, {
            assetId: 'fake_decoder_without_test_flag',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'Fake decoder rejected',
            tagCodes: ['item-key'],
            featureCodes: [],
        });
        assert.equal(rejected.status, 503);
        assert.equal(rejected.body.error, 'VISUAL_ASSET_REENCODE_FAILED');
    } finally {
        await close(isolated);
    }
}

async function testAdminAuthAndOrigin() {
    const missing = await rawFetch('/v1/admin/assets/test/1', { method: 'GET' });
    assert.equal(missing.status, 401);
    assert.equal(missing.body.error, 'VISUAL_ASSET_AUTH_REQUIRED');

    const wrong = await rawFetch('/v1/admin/assets/test/1', {
        method: 'GET',
        headers: { Authorization: 'Bearer wrong' },
    });
    assert.equal(wrong.status, 401);

    const forgedOrigin = await rawFetch('/v1/admin/assets/test/1', {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${adminToken}`,
            Origin: 'http://evil.example',
        },
    });
    assert.equal(forgedOrigin.status, 403);
    assert.equal(forgedOrigin.body.error, 'VISUAL_ASSET_ORIGIN_REJECTED');
}

async function testUploadAndConflict() {
    const scene = await uploadAsset({
        assetId: 'scene_ruined_house',
        assetVersion: 1,
        assetType: 'scene',
        role: 'background',
        title: 'Ruined house',
        tagCodes: ['scene-ruined', 'scene-interior'],
        featureCodes: ['mood-dark'],
    });
    assert.equal(scene.ok, true);
    assert.equal(scene.asset.assetContentSha256.startsWith('sha256:'), true);
    assert.equal(scene.asset.rawUploadSha256.startsWith('sha256:'), true);
    assert.equal(scene.asset.status, 'draft');

    const retry = await uploadAsset({
        assetId: 'scene_ruined_house',
        assetVersion: 1,
        assetType: 'scene',
        role: 'background',
        title: 'Ruined house',
        tagCodes: ['scene-ruined', 'scene-interior'],
        featureCodes: ['mood-dark'],
    });
    assert.equal(retry.reused, true);

    const conflict = await rawUpload({
        assetId: 'scene_ruined_house',
        assetVersion: 1,
        assetType: 'scene',
        role: 'background',
        title: 'Different title',
        tagCodes: ['scene-ruined'],
        featureCodes: ['mood-dark'],
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'VISUAL_ASSET_HASH_CONFLICT');

    const character = await uploadAsset({
        assetId: 'char_silhouette_alpha',
        assetVersion: 1,
        assetType: 'character',
        role: 'transparent-sprite',
        title: 'Silhouette',
        tagCodes: ['character-human'],
        featureCodes: ['character-silhouette'],
    });
    assert.equal(character.asset.role, 'transparent-sprite');
}

async function testUploadRejects() {
    const roleMismatch = await rawUpload({
        assetId: 'bad_role_scene',
        assetVersion: 1,
        assetType: 'scene',
        role: 'icon',
        title: 'Bad role',
        tagCodes: ['scene-urban'],
        featureCodes: [],
    });
    assert.equal(roleMismatch.status, 400);
    assert.equal(roleMismatch.body.error, 'VISUAL_ASSET_INVALID_SCHEMA');

    const unknownDictionary = await rawUpload({
        assetId: 'bad_dictionary',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Bad code',
        tagCodes: ['not-a-code'],
        featureCodes: [],
    });
    assert.equal(unknownDictionary.status, 400);
    assert.equal(unknownDictionary.body.error, 'VISUAL_ASSET_DICTIONARY_MISMATCH');

    const sourceUrl = await rawUpload({
        assetId: 'bad_url',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'http://bad.example',
        tagCodes: ['item-key'],
        featureCodes: [],
    });
    assert.equal(sourceUrl.status, 400);

    const noAlpha = await rawUpload({
        assetId: 'char_no_alpha',
        assetVersion: 1,
        assetType: 'character',
        role: 'transparent-sprite',
        title: 'No alpha',
        tagCodes: ['character-human'],
        featureCodes: ['quality-low'],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('NOALPHA')]) });
    assert.equal(noAlpha.status, 400);
    assert.equal(noAlpha.body.error, 'VISUAL_ASSET_INVALID_SCHEMA');

    const opaqueAlpha = await rawUpload({
        assetId: 'char_opaque_alpha',
        assetVersion: 1,
        assetType: 'character',
        role: 'transparent-sprite',
        title: 'Opaque alpha',
        tagCodes: ['character-human'],
        featureCodes: ['quality-low'],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('OPAQUE_ALPHA')]) });
    assert.equal(opaqueAlpha.status, 400);
    assert.equal(opaqueAlpha.body.error, 'VISUAL_ASSET_INVALID_SCHEMA');

    const stringVersion = await rawFetch('/v1/admin/assets/upload', {
        method: 'POST',
        admin: true,
        body: createUploadBody({
            assetId: 'string_version',
            assetVersion: '1',
            assetType: 'item',
            role: 'icon',
            title: 'String version',
            tagCodes: ['item-key'],
            featureCodes: [],
        }),
    });
    assert.equal(stringVersion.status, 400);

    const tooWide = await rawUpload({
        assetId: 'scene_too_wide',
        assetVersion: 1,
        assetType: 'scene',
        role: 'background',
        title: 'Too wide',
        tagCodes: ['scene-urban'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('TOO_WIDE')]) });
    assert.equal(tooWide.status, 400);
    assert.equal(tooWide.body.error, 'VISUAL_ASSET_PIXEL_LIMIT');

    const unsafeMetadata = await rawUpload({
        assetId: 'item_unsafe_metadata',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Unsafe metadata',
        tagCodes: ['item-key'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('UNSAFE_METADATA')]) });
    assert.equal(unsafeMetadata.status, 400);
    assert.equal(unsafeMetadata.body.error, 'VISUAL_ASSET_REENCODE_FAILED');

    const missingStripProof = await rawUpload({
        assetId: 'item_missing_strip',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Missing strip',
        tagCodes: ['item-key'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('NO_METADATA_STRIP')]) });
    assert.equal(missingStripProof.status, 400);
    assert.equal(missingStripProof.body.error, 'VISUAL_ASSET_REENCODE_FAILED');

    const compressionBomb = await rawUpload({
        assetId: 'item_compression_bomb',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Compression bomb',
        tagCodes: ['item-key'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('COMPRESSION_BOMB')]) });
    assert.equal(compressionBomb.status, 400);
    assert.equal(compressionBomb.body.error, 'VISUAL_ASSET_SIZE_LIMIT');

    const compressionNinety = await rawUpload({
        assetId: 'item_compression_ninety',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Compression ninety',
        tagCodes: ['item-key'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('COMPRESSION_90')]) });
    assert.equal(compressionNinety.status, 400);
    assert.equal(compressionNinety.body.error, 'VISUAL_ASSET_SIZE_LIMIT');

    const iconTooWide = await rawUpload({
        assetId: 'item_icon_too_wide',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Icon too wide',
        tagCodes: ['item-key'],
        featureCodes: [],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('ICON_TOO_WIDE')]) });
    assert.equal(iconTooWide.status, 400);
    assert.equal(iconTooWide.body.error, 'VISUAL_ASSET_PIXEL_LIMIT');

    const characterTooWide = await rawUpload({
        assetId: 'char_sprite_too_wide',
        assetVersion: 1,
        assetType: 'character',
        role: 'transparent-sprite',
        title: 'Sprite too wide',
        tagCodes: ['character-human'],
        featureCodes: ['character-silhouette'],
    }, { bytes: Buffer.concat([pngBytes, Buffer.from('CHAR_TOO_WIDE')]) });
    assert.equal(characterTooWide.status, 400);
    assert.equal(characterTooWide.body.error, 'VISUAL_ASSET_PIXEL_LIMIT');
}

async function testCatalogLifecycleAndPlayerRead() {
    const item = await uploadAsset({
        assetId: 'item_crow_badge',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Crow badge',
        tagCodes: ['item-key'],
        featureCodes: ['quality-low'],
    });
    const catalogDraft = await fetchJson('/v1/admin/catalogs/draft', {
        method: 'POST',
        admin: true,
        body: {
            schemaVersion: 'galgame.visual-catalog-draft-request.v1',
            catalogId: 'catalog_main',
            revision: 1,
            assetRefs: [{
                assetId: item.asset.assetId,
                assetVersion: item.asset.assetVersion,
                assetType: item.asset.assetType,
                assetContentSha256: item.asset.assetContentSha256,
                assetMetadataHash: item.asset.assetMetadataHash,
            }],
        },
    });
    assert.equal(catalogDraft.ok, true);
    assert.equal(catalogDraft.catalog.assetRefs.some((ref) => ref.assetId === 'unknown_scene'), true);

    const validated = await fetchJson('/v1/admin/catalogs/catalog_main/1/validate', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(validated.catalog.status, 'validated');
    assert.equal(validated.catalog.catalogHash.startsWith('sha256:'), true);

    const archiveValidated = await rawFetch('/v1/admin/catalogs/catalog_main/1/archive', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(archiveValidated.status, 400);
    assert.equal(archiveValidated.body.error, 'VISUAL_CATALOG_INVALID');

    const published = await fetchJson('/v1/admin/catalogs/catalog_main/1/publish', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(published.catalog.status, 'published');
    const publishedUpdatedAt = published.catalog.updatedAt;

    const repeatPublish = await fetchJson('/v1/admin/catalogs/catalog_main/1/publish', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(repeatPublish.reused, true);
    assert.equal(repeatPublish.catalog.updatedAt, publishedUpdatedAt);

    const validatePublished = await rawFetch('/v1/admin/catalogs/catalog_main/1/validate', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(validatePublished.status, 409);
    assert.equal(validatePublished.body.error, 'VISUAL_CATALOG_IMMUTABLE');

    const proof = makeProof({
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
    });
    const read = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': proof,
        },
        raw: true,
    });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get('content-type'), 'image/png');
    assert.equal(read.text.includes('safe:item:Crow badge'), true);

    const replay = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': proof,
        },
    });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error, 'VISUAL_ASSET_READ_PROOF_REPLAYED');

    const archived = await fetchJson('/v1/admin/catalogs/catalog_main/1/archive', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(archived.catalog.status, 'archived');
    const archivedUpdatedAt = archived.catalog.updatedAt;

    const repeatArchive = await fetchJson('/v1/admin/catalogs/catalog_main/1/archive', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(repeatArchive.reused, true);
    assert.equal(repeatArchive.catalog.updatedAt, archivedUpdatedAt);

    const validateArchived = await rawFetch('/v1/admin/catalogs/catalog_main/1/validate', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(validateArchived.status, 409);
    assert.equal(validateArchived.body.error, 'VISUAL_CATALOG_IMMUTABLE');

    const publishArchived = await rawFetch('/v1/admin/catalogs/catalog_main/1/publish', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(publishArchived.status, 400);
    const archivedNoOldSave = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': makeProof({
                catalog: {
                    catalogId: 'catalog_main',
                    catalogRevision: 1,
                    catalogHash: published.catalog.catalogHash,
                },
                asset: {
                    assetId: item.asset.assetId,
                    assetVersion: item.asset.assetVersion,
                    assetContentSha256: item.asset.assetContentSha256,
                },
            }),
        },
    });
    assert.equal(archivedNoOldSave.status, 403);
    assert.equal(archivedNoOldSave.body.error, 'VISUAL_ASSET_OLD_SAVE_PROOF_REQUIRED');

    const oldSaveProof = makeProof({
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
        oldSave: {
            saveIdHash: testSha('save'),
            saveBindingHash: testSha('binding'),
        },
    });
    const forgedOldSave = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': oldSaveProof,
        },
    });
    assert.equal(forgedOldSave.status, 403);
    assert.equal(forgedOldSave.body.error, 'VISUAL_ASSET_OLD_SAVE_RETENTION_REQUIRED');

    retentionStore.grantOldSaveRead({
        release: baseProofPayload().release,
        profile: baseProofPayload().profile,
        oldSave: {
            saveIdHash: testSha('save'),
            saveBindingHash: testSha('binding'),
        },
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
        expiresAt: new Date(nowMs + 300000).toISOString(),
    });
    const archivedRead = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': makeProof({
                catalog: {
                    catalogId: 'catalog_main',
                    catalogRevision: 1,
                    catalogHash: published.catalog.catalogHash,
                },
                asset: {
                    assetId: item.asset.assetId,
                    assetVersion: item.asset.assetVersion,
                    assetContentSha256: item.asset.assetContentSha256,
                },
                oldSave: {
                    saveIdHash: testSha('save'),
                    saveBindingHash: testSha('binding'),
                },
            }),
        },
        raw: true,
    });
    assert.equal(archivedRead.status, 200);

    retentionStore.grantOldSaveRead({
        release: baseProofPayload().release,
        profile: baseProofPayload().profile,
        oldSave: {
            saveIdHash: testSha('expired-save'),
            saveBindingHash: testSha('expired-binding'),
        },
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
        expiresAt: new Date(nowMs - 1000).toISOString(),
    });
    const expiredRetention = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': makeProof({
                catalog: {
                    catalogId: 'catalog_main',
                    catalogRevision: 1,
                    catalogHash: published.catalog.catalogHash,
                },
                asset: {
                    assetId: item.asset.assetId,
                    assetVersion: item.asset.assetVersion,
                    assetContentSha256: item.asset.assetContentSha256,
                },
                oldSave: {
                    saveIdHash: testSha('expired-save'),
                    saveBindingHash: testSha('expired-binding'),
                },
            }),
        },
    });
    assert.equal(expiredRetention.status, 403);
    assert.equal(expiredRetention.body.error, 'VISUAL_ASSET_OLD_SAVE_RETENTION_EXPIRED');

    contentStore.tamperMime(item.asset.assetContentSha256, 'image/jpeg');
    const tamperMimeProof = makeProof({
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
        oldSave: {
            saveIdHash: testSha('save'),
            saveBindingHash: testSha('binding'),
        },
    });
    const tamperedMime = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': tamperMimeProof,
        },
    });
    assert.equal(tamperedMime.status, 409);
    assert.equal(tamperedMime.body.error, 'VISUAL_ASSET_FINAL_MIME_MISMATCH');
    contentStore.tamperMime(item.asset.assetContentSha256, 'image/png');

    const tamperProof = makeProof({
        catalog: {
            catalogId: 'catalog_main',
            catalogRevision: 1,
            catalogHash: published.catalog.catalogHash,
        },
        asset: {
            assetId: item.asset.assetId,
            assetVersion: item.asset.assetVersion,
            assetContentSha256: item.asset.assetContentSha256,
        },
        oldSave: {
            saveIdHash: testSha('save'),
            saveBindingHash: testSha('binding'),
        },
    });
    contentStore.tamper(item.asset.assetContentSha256, Buffer.from('tampered'));
    const tampered = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            Origin: playerOrigin,
            'X-Galgame-Visual-Asset-Proof': tamperProof,
        },
    });
    assert.equal(tampered.status, 409);
    assert.equal(tampered.body.error, 'VISUAL_ASSET_FINAL_HASH_MISMATCH');
}

async function testCatalogHashMismatchRejectsPublish() {
    const item = await uploadAsset({
        assetId: 'item_catalog_hash_guard',
        assetVersion: 1,
        assetType: 'item',
        role: 'icon',
        title: 'Catalog hash guard',
        tagCodes: ['item-key'],
        featureCodes: ['quality-low'],
    });
    await fetchJson('/v1/admin/catalogs/draft', {
        method: 'POST',
        admin: true,
        body: {
            schemaVersion: 'galgame.visual-catalog-draft-request.v1',
            catalogId: 'catalog_hash_guard',
            revision: 1,
            assetRefs: [{
                assetId: item.asset.assetId,
                assetVersion: item.asset.assetVersion,
                assetType: item.asset.assetType,
                assetContentSha256: item.asset.assetContentSha256,
                assetMetadataHash: item.asset.assetMetadataHash,
            }],
        },
    });
    await fetchJson('/v1/admin/catalogs/catalog_hash_guard/1/validate', {
        method: 'POST',
        admin: true,
        body: {},
    });
    const catalog = store.getCatalog('catalog_hash_guard', 1);
    store.putCatalog({
        ...catalog,
        catalogHash: testSha('tampered-catalog-hash'),
    });
    const publishTampered = await rawFetch('/v1/admin/catalogs/catalog_hash_guard/1/publish', {
        method: 'POST',
        admin: true,
        body: {},
    });
    assert.equal(publishTampered.status, 400);
    assert.equal(publishTampered.body.error, 'VISUAL_CATALOG_INVALID');
}

async function testProofEnvelopeAndCanonicalFailures() {
    const validPayload = baseProofPayload();
    const token = makeProof(validPayload);
    const verifier = verifyVisualAssetReadProof(token, {
        proofSecrets: { [proofKeyId]: proofSecret },
        now: () => nowMs,
        nonceStore: new MemoryNonceStore(() => nowMs),
    });
    assert.equal(verifier.ok, true);

    const truncated = verifyVisualAssetReadProof(token.slice(0, -1), {
        proofSecrets: { [proofKeyId]: proofSecret },
        now: () => nowMs,
        nonceStore: new MemoryNonceStore(() => nowMs),
    });
    assert.equal(truncated.ok, false);
    assert.equal(truncated.error, 'VISUAL_ASSET_READ_PROOF_MALFORMED');

    const duplicatePayload = '{"algorithm":"HMAC-SHA256","algorithm":"HMAC-SHA256","asset":{"assetContentSha256":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","assetId":"asset","assetVersion":1},"audience":"visual-asset-service","catalog":{"catalogHash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","catalogId":"catalog","catalogRevision":1},"expiresAt":"2026-07-30T00:05:00.000Z","issuedAt":"2026-07-30T00:00:00.000Z","issuer":"game-config-service","keyId":"visual-key-v1","nonce":"abcdefghijklmnop","profile":{"profileHash":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","visualProfileId":"profile"},"purpose":"asset-read","release":{"arcId":"main","releaseId":"release","scenarioId":"scenario","scenarioVersion":"v1"},"schemaVersion":"galgame.visual-asset-read-proof.v1"}';
    const duplicateToken = signRawPayload(duplicatePayload);
    const duplicate = verifyVisualAssetReadProof(duplicateToken, {
        proofSecrets: { [proofKeyId]: proofSecret },
        now: () => nowMs,
        nonceStore: new MemoryNonceStore(() => nowMs),
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.error, 'VISUAL_ASSET_READ_PROOF_NON_CANONICAL');

    const stringNumberPayload = {
        ...validPayload,
        asset: { ...validPayload.asset, assetVersion: '1' },
        nonce: 'abcdefghijklmnopq',
    };
    const stringNumber = verifyVisualAssetReadProof(signRawPayload(JSON.stringify(stringNumberPayload)), {
        proofSecrets: { [proofKeyId]: proofSecret },
        now: () => nowMs,
        nonceStore: new MemoryNonceStore(() => nowMs),
    });
    assert.equal(stringNumber.ok, false);

    const unicodePayload = {
        ...validPayload,
        nonce: 'abcdefghijklmnopqr',
        release: { ...validPayload.release, scenarioId: '剧情' },
    };
    assert.throws(() => canonicalJsonForTest(unicodePayload));

    const wrongAudience = signRawPayload(JSON.stringify({
        ...validPayload,
        audience: 'other-service',
        nonce: 'abcdefghijklmnopqrs',
    }));
    const wrongAudienceResult = verifyVisualAssetReadProof(wrongAudience, {
        proofSecrets: { [proofKeyId]: proofSecret },
        now: () => nowMs,
        nonceStore: new MemoryNonceStore(() => nowMs),
    });
    assert.equal(wrongAudienceResult.error, 'VISUAL_ASSET_READ_PROOF_WRONG_AUDIENCE');
}

async function testFileNonceStoreRejectsIndependentSecondConsumer() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'visual-asset-nonce-'));
    try {
        const first = new FileNonceStore(root, () => nowMs);
        const second = new FileNonceStore(root, () => nowMs);
        const key = 'visual-key-v1:nonce_independent:visual-asset-service:asset-read';
        assert.equal(first.consume(key, nowMs + 300000).ok, true);
        assert.equal(second.consume(key, nowMs + 300000).ok, false);
        const raceRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-asset-nonce-race-'));
        try {
            const raceFirst = new FileNonceStore(raceRoot, () => nowMs);
            const raceSecond = new FileNonceStore(raceRoot, () => nowMs);
            raceFirst.loadSync();
            raceSecond.loadSync();
            const raceKey = 'visual-key-v1:nonce_preloaded_race:visual-asset-service:asset-read';
            const raceResults = [
                raceFirst.consume(raceKey, nowMs + 300000),
                raceSecond.consume(raceKey, nowMs + 300000),
            ];
            assert.equal(raceResults.filter((item) => item.ok).length, 1);
            assert.equal(raceResults.filter((item) => !item.ok).length, 1);
        } finally {
            await rm(raceRoot, { recursive: true, force: true });
        }
        const cleanup = new FileNonceStore(root, () => nowMs + 360000);
        await cleanup.load();
        const afterExpiry = new FileNonceStore(root, () => nowMs + 360000);
        assert.equal(afterExpiry.consume(key, nowMs + 660000).ok, true);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

async function testCorsPreflight() {
    const ok = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'OPTIONS',
        headers: {
            Origin: playerOrigin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'X-Galgame-Visual-Asset-Proof',
        },
    });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), playerOrigin);
    assert.equal(ok.headers.get('access-control-allow-methods'), 'GET');
    assert.match(ok.headers.get('access-control-allow-headers'), /X-Galgame-Visual-Asset-Proof/);
    assert.equal(ok.headers.has('access-control-allow-credentials'), false);

    const badMethod = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'OPTIONS',
        headers: {
            Origin: playerOrigin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'X-Galgame-Visual-Asset-Proof',
        },
    });
    assert.equal(badMethod.status, 403);

    const extraHeader = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'OPTIONS',
        headers: {
            Origin: playerOrigin,
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'X-Galgame-Visual-Asset-Proof, X-Extra-Secret',
        },
    });
    assert.equal(extraHeader.status, 403);

    const forgedOrigin = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://evil.example',
            'Access-Control-Request-Method': 'GET',
            'Access-Control-Request-Headers': 'X-Galgame-Visual-Asset-Proof',
        },
    });
    assert.equal(forgedOrigin.status, 403);

    const noOriginBrowser = await rawFetch('/v1/assets/catalog_main/1/item_crow_badge/1/content', {
        method: 'GET',
        headers: {
            'Sec-Fetch-Mode': 'cors',
            'X-Galgame-Visual-Asset-Proof': makeProof(),
        },
    });
    assert.equal(noOriginBrowser.status, 403);
    assert.equal(noOriginBrowser.body.error, 'VISUAL_ASSET_PLAYER_ORIGIN_REJECTED');
}

async function testPlayerDtoIsolation() {
    const catalog = store.getCatalog('catalog_main', 1);
    const asset = store.getAsset('item_crow_badge', 1);
    const dto = serializePlayerPublishedAssetResponseForTest(asset, catalog);
    const text = JSON.stringify(dto);
    assert.equal(dto.assetVersion, 1);
    assert.equal(dto.catalogRevision, 1);
    assert.equal(text.includes('sourceLabel'), false);
    assert.equal(text.includes('sourceDigest'), false);
    assert.equal(text.includes('rawUploadSha256'), false);
    assert.equal(text.includes('status'), false);
    assert.equal(text.includes('internal'), false);
}

async function testFileStoresSurviveRestart() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'visual-asset-service-'));
    const metadataDir = path.join(root, 'catalog');
    const contentDir = path.join(root, 'assets');
    const retentionDir = path.join(root, 'retention');
    const nonceDir = path.join(root, 'nonces');
    const firstStore = new FileVisualAssetStore(metadataDir);
    const firstRetentionStore = new FileVisualAssetRetentionStore(retentionDir, () => nowMs);
    const firstNonceStore = new FileNonceStore(nonceDir, () => nowMs);
    let persistedReplayProof = '';
    let first = createVisualAssetService({
        store: firstStore,
        contentStore: new FileContentStore(contentDir),
        retentionStore: firstRetentionStore,
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: firstNonceStore,
        now: () => nowMs,
        allowTestImageDecoder: true,
        safeImageDecoder: createFakeDecoder(),
    });
    await listen(first);
    const firstBase = serverBaseUrl(first);
    try {
        const created = await uploadAssetTo(firstBase, {
            assetId: 'item_persistent_badge',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'Persistent badge',
            tagCodes: ['item-key'],
            featureCodes: ['quality-high'],
        });
        const draft = await fetchJsonAt(firstBase, '/v1/admin/catalogs/draft', {
            method: 'POST',
            admin: true,
            body: {
                schemaVersion: 'galgame.visual-catalog-draft-request.v1',
                catalogId: 'catalog_persistent',
                revision: 1,
                assetRefs: [{
                    assetId: created.asset.assetId,
                    assetVersion: created.asset.assetVersion,
                    assetType: created.asset.assetType,
                    assetContentSha256: created.asset.assetContentSha256,
                    assetMetadataHash: created.asset.assetMetadataHash,
                }],
            },
        });
        assert.equal(draft.catalog.status, 'draft');
        await fetchJsonAt(firstBase, '/v1/admin/catalogs/catalog_persistent/1/validate', { method: 'POST', admin: true, body: {} });
        const published = await fetchJsonAt(firstBase, '/v1/admin/catalogs/catalog_persistent/1/publish', { method: 'POST', admin: true, body: {} });
        assert.equal(published.catalog.status, 'published');
        persistedReplayProof = makeProof({
            catalog: {
                catalogId: 'catalog_persistent',
                catalogRevision: 1,
                catalogHash: published.catalog.catalogHash,
            },
            asset: {
                assetId: created.asset.assetId,
                assetVersion: created.asset.assetVersion,
                assetContentSha256: created.asset.assetContentSha256,
            },
        });
        const firstRead = await rawFetchAt(firstBase, '/v1/assets/catalog_persistent/1/item_persistent_badge/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': persistedReplayProof,
            },
            raw: true,
        });
        assert.equal(firstRead.status, 200);
        const archived = await fetchJsonAt(firstBase, '/v1/admin/catalogs/catalog_persistent/1/archive', { method: 'POST', admin: true, body: {} });
        assert.equal(archived.catalog.status, 'archived');
        await firstRetentionStore.grantOldSaveRead({
            release: baseProofPayload().release,
            profile: baseProofPayload().profile,
            oldSave: {
                saveIdHash: testSha('persistent-save'),
                saveBindingHash: testSha('persistent-binding'),
            },
            catalog: {
                catalogId: 'catalog_persistent',
                catalogRevision: 1,
                catalogHash: published.catalog.catalogHash,
            },
            asset: {
                assetId: created.asset.assetId,
                assetVersion: created.asset.assetVersion,
                assetContentSha256: created.asset.assetContentSha256,
            },
            expiresAt: new Date(nowMs + 300000).toISOString(),
        });
    } finally {
        await close(first);
    }

    const secondContentStore = new FileContentStore(contentDir);
    const secondStore = new FileVisualAssetStore(metadataDir);
    let second = createVisualAssetService({
        store: secondStore,
        contentStore: secondContentStore,
        retentionStore: new FileVisualAssetRetentionStore(retentionDir, () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(nonceDir, () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(second);
    const secondBase = serverBaseUrl(second);
    try {
        const assetReadback = await fetchJsonAt(secondBase, '/v1/admin/assets/item_persistent_badge/1', {
            method: 'GET',
            admin: true,
        });
        assert.equal(assetReadback.asset.assetId, 'item_persistent_badge');
        assert.equal(assetReadback.asset.status, 'published');
        const catalogReadback = await fetchJsonAt(secondBase, '/v1/admin/catalogs/catalog_persistent/1', {
            method: 'GET',
            admin: true,
        });
        assert.equal(catalogReadback.catalog.status, 'archived');
        const replayAfterRestart = await rawFetchAt(secondBase, '/v1/assets/catalog_persistent/1/item_persistent_badge/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': persistedReplayProof,
            },
        });
        assert.equal(replayAfterRestart.status, 401);
        assert.equal(replayAfterRestart.body.error, 'VISUAL_ASSET_READ_PROOF_REPLAYED');
        const proof = makeProof({
            catalog: {
                catalogId: 'catalog_persistent',
                catalogRevision: 1,
                catalogHash: assetReadback.asset.assetContentSha256.replace(assetReadback.asset.assetContentSha256.slice('sha256:'.length), '0'.repeat(64)),
            },
            asset: {
                assetId: assetReadback.asset.assetId,
                assetVersion: assetReadback.asset.assetVersion,
                assetContentSha256: assetReadback.asset.assetContentSha256,
            },
        });
        const badProof = await rawFetchAt(secondBase, '/v1/assets/catalog_persistent/1/item_persistent_badge/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': proof,
            },
        });
        assert.equal(badProof.status, 403);
        assert.equal(badProof.body.error, 'VISUAL_ASSET_OLD_SAVE_PROOF_REQUIRED');

        const read = await rawFetchAt(secondBase, '/v1/assets/catalog_persistent/1/item_persistent_badge/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': makeProof({
                    catalog: {
                        catalogId: 'catalog_persistent',
                        catalogRevision: 1,
                        catalogHash: catalogReadback.catalog.catalogHash,
                    },
                    asset: {
                        assetId: assetReadback.asset.assetId,
                        assetVersion: assetReadback.asset.assetVersion,
                        assetContentSha256: assetReadback.asset.assetContentSha256,
                    },
                    oldSave: {
                        saveIdHash: testSha('persistent-save'),
                        saveBindingHash: testSha('persistent-binding'),
                    },
                }),
            },
            raw: true,
        });
        assert.equal(read.status, 200);
        assert.equal(read.text.includes('safe:item:Persistent badge'), true);

        const contentRecordPath = secondContentStore.pathForHash(assetReadback.asset.assetContentSha256);
        const contentRecord = JSON.parse(await readFile(contentRecordPath, 'utf8'));
        contentRecord.mime = 'image/jpeg';
        await writeFile(contentRecordPath, `${JSON.stringify(contentRecord)}\n`, 'utf8');
        const tamperedMime = await rawFetchAt(secondBase, '/v1/assets/catalog_persistent/1/item_persistent_badge/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': makeProof({
                    catalog: {
                        catalogId: 'catalog_persistent',
                        catalogRevision: 1,
                        catalogHash: catalogReadback.catalog.catalogHash,
                    },
                    asset: {
                        assetId: assetReadback.asset.assetId,
                        assetVersion: assetReadback.asset.assetVersion,
                        assetContentSha256: assetReadback.asset.assetContentSha256,
                    },
                    oldSave: {
                        saveIdHash: testSha('persistent-save'),
                        saveBindingHash: testSha('persistent-binding'),
                    },
                }),
            },
        });
        assert.equal(tamperedMime.status, 409);
        assert.equal(tamperedMime.body.error, 'VISUAL_ASSET_FINAL_MIME_MISMATCH');
    } finally {
        await close(second);
    }

    const assetPath = secondStore.assetPath('item_persistent_badge', 1);
    const assetRecord = JSON.parse(await readFile(assetPath, 'utf8'));
    assetRecord.asset.title = 'Tampered badge';
    await writeFile(assetPath, `${JSON.stringify(assetRecord)}\n`, 'utf8');
    const third = createVisualAssetService({
        store: new FileVisualAssetStore(metadataDir),
        contentStore: new FileContentStore(contentDir),
        retentionStore: new FileVisualAssetRetentionStore(retentionDir, () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(nonceDir, () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(third);
    const thirdBase = serverBaseUrl(third);
    try {
        const corrupt = await rawFetchAt(thirdBase, '/v1/health');
        assert.equal(corrupt.status, 500);
        assert.equal(corrupt.body.error, 'VISUAL_ASSET_METADATA_INVALID');
    } finally {
        await close(third);
        await rm(root, { recursive: true, force: true });
    }
}

async function testPersistentMetadataTamperFailures() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'visual-asset-tamper-'));
    const metadataDir = path.join(root, 'catalog');
    const contentDir = path.join(root, 'assets');
    const retentionDir = path.join(root, 'retention');
    const nonceDir = path.join(root, 'nonces');
    let firstStore = new FileVisualAssetStore(metadataDir);
    let first = createVisualAssetService({
        store: firstStore,
        contentStore: new FileContentStore(contentDir),
        retentionStore: new FileVisualAssetRetentionStore(retentionDir, () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(nonceDir, () => nowMs),
        now: () => nowMs,
        allowTestImageDecoder: true,
        safeImageDecoder: createFakeDecoder(),
    });
    await listen(first);
    const firstBase = serverBaseUrl(first);
    let publishedCatalogHash = '';
    let uploadedAsset = null;
    try {
        uploadedAsset = (await uploadAssetTo(firstBase, {
            assetId: 'item_metadata_mutated',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'Metadata guarded item',
            tagCodes: ['item-key'],
            featureCodes: ['quality-high'],
        })).asset;
        await fetchJsonAt(firstBase, '/v1/admin/catalogs/draft', {
            method: 'POST',
            admin: true,
            body: {
                schemaVersion: 'galgame.visual-catalog-draft-request.v1',
                catalogId: 'catalog_metadata_guard',
                revision: 1,
                assetRefs: [{
                    assetId: uploadedAsset.assetId,
                    assetVersion: uploadedAsset.assetVersion,
                    assetType: uploadedAsset.assetType,
                    assetContentSha256: uploadedAsset.assetContentSha256,
                    assetMetadataHash: uploadedAsset.assetMetadataHash,
                }],
            },
        });
        await fetchJsonAt(firstBase, '/v1/admin/catalogs/catalog_metadata_guard/1/validate', { method: 'POST', admin: true, body: {} });
        const published = await fetchJsonAt(firstBase, '/v1/admin/catalogs/catalog_metadata_guard/1/publish', { method: 'POST', admin: true, body: {} });
        publishedCatalogHash = published.catalog.catalogHash;
    } finally {
        await close(first);
    }

    const assetPath = firstStore.assetPath(uploadedAsset.assetId, uploadedAsset.assetVersion);
    const assetRecord = JSON.parse(await readFile(assetPath, 'utf8'));
    assetRecord.asset.title = 'Tampered metadata title';
    assetRecord.asset.assetMetadataHash = computeTestAssetMetadataHash(assetRecord.asset);
    await writeFile(assetPath, `${JSON.stringify(assetRecord)}\n`, 'utf8');

    const secondStore = new FileVisualAssetStore(metadataDir);
    let second = createVisualAssetService({
        store: secondStore,
        contentStore: new FileContentStore(contentDir),
        retentionStore: new FileVisualAssetRetentionStore(retentionDir, () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(nonceDir, () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(second);
    const secondBase = serverBaseUrl(second);
    try {
        const tamperedCatalogRead = await rawFetchAt(secondBase, '/v1/assets/catalog_metadata_guard/1/item_metadata_mutated/1/content', {
            method: 'GET',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Asset-Proof': makeProof({
                    catalog: {
                        catalogId: 'catalog_metadata_guard',
                        catalogRevision: 1,
                        catalogHash: publishedCatalogHash,
                    },
                    asset: {
                        assetId: uploadedAsset.assetId,
                        assetVersion: uploadedAsset.assetVersion,
                        assetContentSha256: uploadedAsset.assetContentSha256,
                    },
                }),
            },
        });
        assert.equal(tamperedCatalogRead.status, 409);
        assert.equal(tamperedCatalogRead.body.error, 'VISUAL_CATALOG_INVALID');
    } finally {
        await close(second);
    }

    const unknownPath = secondStore.assetPath('unknown_scene', 1);
    const unknownRecord = JSON.parse(await readFile(unknownPath, 'utf8'));
    unknownRecord.asset.title = 'Tampered unknown';
    unknownRecord.asset.assetMetadataHash = computeTestAssetMetadataHash(unknownRecord.asset);
    await writeFile(unknownPath, `${JSON.stringify(unknownRecord)}\n`, 'utf8');
    const third = createVisualAssetService({
        store: new FileVisualAssetStore(metadataDir),
        contentStore: new FileContentStore(contentDir),
        retentionStore: new FileVisualAssetRetentionStore(retentionDir, () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(nonceDir, () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(third);
    const thirdBase = serverBaseUrl(third);
    try {
        const unknownTampered = await rawFetchAt(thirdBase, '/v1/health');
        assert.equal(unknownTampered.status, 500);
        assert.equal(unknownTampered.body.error, 'VISUAL_ASSET_UNKNOWN_IMMUTABLE');
    } finally {
        await close(third);
        await rm(root, { recursive: true, force: true });
    }

    const duplicateRoot = await mkdtemp(path.join(os.tmpdir(), 'visual-asset-duplicate-'));
    const duplicateMetadataDir = path.join(duplicateRoot, 'catalog');
    const duplicate = createVisualAssetService({
        store: new FileVisualAssetStore(duplicateMetadataDir),
        contentStore: new FileContentStore(path.join(duplicateRoot, 'assets')),
        retentionStore: new FileVisualAssetRetentionStore(path.join(duplicateRoot, 'retention'), () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(path.join(duplicateRoot, 'nonces'), () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(duplicate);
    const duplicateBase = serverBaseUrl(duplicate);
    try {
        const health = await rawFetchAt(duplicateBase, '/v1/health');
        assert.equal(health.status, 200);
    } finally {
        await close(duplicate);
    }
    const duplicateSourcePath = path.join(duplicateMetadataDir, 'assets', 'unknown_item--1.json');
    const duplicateCopyPath = path.join(duplicateMetadataDir, 'assets', 'unknown_item--1-copy.json');
    await writeFile(duplicateCopyPath, await readFile(duplicateSourcePath, 'utf8'), 'utf8');
    const duplicateReload = createVisualAssetService({
        store: new FileVisualAssetStore(duplicateMetadataDir),
        contentStore: new FileContentStore(path.join(duplicateRoot, 'assets')),
        retentionStore: new FileVisualAssetRetentionStore(path.join(duplicateRoot, 'retention'), () => nowMs),
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new FileNonceStore(path.join(duplicateRoot, 'nonces'), () => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(duplicateReload);
    const duplicateReloadBase = serverBaseUrl(duplicateReload);
    try {
        const duplicateHealth = await rawFetchAt(duplicateReloadBase, '/v1/health');
        assert.equal(duplicateHealth.status, 500);
        assert.equal(duplicateHealth.body.error, 'VISUAL_ASSET_METADATA_INVALID');
    } finally {
        await close(duplicateReload);
        await rm(duplicateRoot, { recursive: true, force: true });
    }
}

async function testBuiltInSafePngDecoderBoundary() {
    const isolatedStore = new MemoryVisualAssetStore();
    const isolatedContent = new MemoryContentStore();
    const isolated = createVisualAssetService({
        store: isolatedStore,
        contentStore: isolatedContent,
        adminToken,
        playerOrigins: playerOrigin,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new MemoryNonceStore(() => nowMs),
        retentionStore: new MemoryVisualAssetRetentionStore(() => nowMs),
        now: () => nowMs,
        safeImageDecoder: createBuiltInSafePngDecoder(),
    });
    await listen(isolated);
    const isolatedBase = serverBaseUrl(isolated);
    try {
        const withMetadata = insertPngChunkBeforeIend(createPngForTest(1, 1, { filterType: 1 }), 'tEXt', Buffer.from('Comment\u0000secret-metadata', 'latin1'));
        const uploaded = await uploadAssetTo(isolatedBase, {
            assetId: 'char_real_png_sanitized',
            assetVersion: 1,
            assetType: 'character',
            role: 'transparent-sprite',
            title: 'Real png sanitized',
            tagCodes: ['character-human'],
            featureCodes: ['character-silhouette'],
        }, { bytes: withMetadata, mime: 'image/png' });
        assert.equal(uploaded.asset.canonicalMime, 'image/png');
        const contentRead = await rawFetchAt(isolatedBase, '/v1/admin/assets/char_real_png_sanitized/1/content', {
            method: 'GET',
            admin: true,
            raw: true,
        });
        assert.equal(contentRead.status, 200);
        assert.equal(contentRead.bytes.includes(Buffer.from('secret-metadata', 'latin1')), false);
        assert.equal(contentRead.bytes.subarray(0, 8).equals(validTransparentPngBytes.subarray(0, 8)), true);
        assert.equal(extractPngChunkDataForTest(contentRead.bytes, 'IDAT').equals(extractPngChunkDataForTest(withMetadata, 'IDAT')), false);

        const apng = insertPngChunkAfterIhdr(validTransparentPngBytes, 'acTL', Buffer.alloc(8));
        const apngRejected = await rawUploadTo(isolatedBase, {
            assetId: 'item_apng_rejected',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'APNG rejected',
            tagCodes: ['item-key'],
            featureCodes: [],
        }, { bytes: apng, mime: 'image/png' });
        assert.equal(apngRejected.status, 400);
        assert.equal(apngRejected.body.error, 'VISUAL_ASSET_UNSUPPORTED_MIME');

        const corruptedIdat = corruptPngIdatDataForTest(validTransparentPngBytes);
        const corruptedRejected = await rawUploadTo(isolatedBase, {
            assetId: 'item_corrupt_idat_rejected',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'Corrupt IDAT rejected',
            tagCodes: ['item-key'],
            featureCodes: [],
        }, { bytes: corruptedIdat, mime: 'image/png' });
        assert.equal(corruptedRejected.status, 400);
        assert.equal(corruptedRejected.body.error, 'VISUAL_ASSET_DECODE_FAILED');

        const unknownAncillary = insertPngChunkBeforeIend(validTransparentPngBytes, 'vpAg', Buffer.from('unknown-private'));
        const unknownChunkRejected = await rawUploadTo(isolatedBase, {
            assetId: 'item_unknown_chunk_rejected',
            assetVersion: 1,
            assetType: 'item',
            role: 'icon',
            title: 'Unknown chunk rejected',
            tagCodes: ['item-key'],
            featureCodes: [],
        }, { bytes: unknownAncillary, mime: 'image/png' });
        assert.equal(unknownChunkRejected.status, 400);
        assert.equal(unknownChunkRejected.body.error, 'VISUAL_ASSET_DECODE_FAILED');

        const opaqueCharacterRejected = await rawUploadTo(isolatedBase, {
            assetId: 'char_opaque_rgba_rejected',
            assetVersion: 1,
            assetType: 'character',
            role: 'transparent-sprite',
            title: 'Opaque RGBA rejected',
            tagCodes: ['character-human'],
            featureCodes: ['character-silhouette'],
        }, { bytes: createPngForTest(1, 1, { alphaByte: 255 }), mime: 'image/png' });
        assert.equal(opaqueCharacterRejected.status, 400);
        assert.equal(opaqueCharacterRejected.body.error, 'VISUAL_ASSET_INVALID_SCHEMA');

        const spritePreflight = await rawUploadTo(isolatedBase, {
            assetId: 'char_huge_ihdr_preflight',
            assetVersion: 1,
            assetType: 'character',
            role: 'transparent-sprite',
            title: 'Huge sprite preflight',
            tagCodes: ['character-human'],
            featureCodes: ['character-silhouette'],
        }, { bytes: createPngWithCustomIdatForTest(4097, 1, { alpha: true, idatData: Buffer.from([0x00]) }), mime: 'image/png' });
        assert.equal(spritePreflight.status, 400);
        assert.equal(spritePreflight.body.error, 'VISUAL_ASSET_PIXEL_LIMIT');

        const scenePixelPreflight = await rawUploadTo(isolatedBase, {
            assetId: 'scene_pixel_limit_preflight',
            assetVersion: 1,
            assetType: 'scene',
            role: 'background',
            title: 'Scene pixel preflight',
            tagCodes: ['scene-urban'],
            featureCodes: ['mood-dark'],
        }, { bytes: createPngWithCustomIdatForTest(8192, 8192, { alpha: false, idatData: Buffer.from([0x00]) }), mime: 'image/png' });
        assert.equal(scenePixelPreflight.status, 400);
        assert.equal(scenePixelPreflight.body.error, 'VISUAL_ASSET_PIXEL_LIMIT');
    } finally {
        await close(isolated);
    }
}

async function testDecoderUnavailableFailsClosed() {
    const isolated = createVisualAssetService({
        adminToken,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new MemoryNonceStore(() => nowMs),
        now: () => nowMs,
        safeImageDecoder: null,
    });
    await listen(isolated);
    const isolatedBase = serverBaseUrl(isolated);
    try {
        const response = await fetch(`${isolatedBase}/v1/admin/assets/upload`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(createUploadBody({
                assetId: 'decoder_unavailable',
                assetVersion: 1,
                assetType: 'item',
                role: 'icon',
                title: 'Decoder unavailable',
                tagCodes: ['item-key'],
                featureCodes: [],
            })),
        });
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.error, 'VISUAL_ASSET_REENCODE_FAILED');
    } finally {
        await close(isolated);
    }
}

async function testVisualMatchProofStubAndUnknownGate() {
    const projectionSecret = 'visual-projection-secret';
    const localStore = new MemoryVisualAssetStore();
    const localContentStore = new MemoryContentStore();
    const localBindingStore = new MemoryVisualBindingStore();
    const isolated = createVisualAssetService({
        store: localStore,
        contentStore: localContentStore,
        adminToken,
        adminOrigins: 'http://admin.example',
        playerOrigins: playerOrigin,
        projectionSecret,
        proofSecrets: { [proofKeyId]: proofSecret },
        nonceStore: new MemoryNonceStore(() => nowMs),
        retentionStore: new MemoryVisualAssetRetentionStore(() => nowMs),
        bindingStore: localBindingStore,
        now: () => nowMs,
        allowTestImageDecoder: true,
        safeImageDecoder: createFakeDecoder(),
    });
    await listen(isolated);
    const isolatedBase = serverBaseUrl(isolated);
    try {
        await fetchJsonAt(isolatedBase, '/v1/health');
        const draft = await fetchJsonAt(isolatedBase, '/v1/admin/catalogs/draft', {
            method: 'POST',
            admin: true,
            body: {
                schemaVersion: 'galgame.visual-catalog-draft-request.v1',
                catalogId: 'vc_matchcatalog01',
                revision: 1,
                assetRefs: [],
            },
        });
        assert.equal(draft.catalog.assetRefs.some((ref) => ref.assetId === 'unknown_scene'), true);
        await fetchJsonAt(isolatedBase, '/v1/admin/catalogs/vc_matchcatalog01/1/validate', { method: 'POST', admin: true });
        const published = await fetchJsonAt(isolatedBase, '/v1/admin/catalogs/vc_matchcatalog01/1/publish', { method: 'POST', admin: true });
        const proof = makeProjectionProof({
            catalogId: 'vc_matchcatalog01',
            catalogHash: published.catalog.catalogHash,
            dictionaryVersion: isolated.visualAssetService.dictionary.dictionaryVersion,
            dictionaryHash: isolated.visualAssetService.dictionary.dictionaryHash,
        }, projectionSecret);
        const stub = createProjectionStubForTest(proof);

        const preflight = await rawFetchAt(isolatedBase, '/v1/visual-match', {
            method: 'OPTIONS',
            headers: {
                Origin: playerOrigin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'X-Galgame-Visual-Projection-Proof, Content-Type',
            },
        });
        assert.equal(preflight.status, 204);
        assert.equal(preflight.headers.get('access-control-allow-origin'), playerOrigin);
        assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST');

        const missingProof = await rawFetchAt(isolatedBase, '/v1/visual-match', {
            method: 'POST',
            headers: { Origin: playerOrigin },
            body: visualMatchRequestBody(proof),
        });
        assert.equal(missingProof.status, 401);
        assert.equal(missingProof.body.error, 'VISUAL_MATCH_PROJECTION_PROOF_REQUIRED');

        const queryProof = await rawFetchAt(isolatedBase, '/v1/visual-match?proof=leak', {
            method: 'POST',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Projection-Proof': encodeProjectionProof(proof),
            },
            body: visualMatchRequestBody(proof),
        });
        assert.equal(queryProof.status, 400);
        assert.equal(queryProof.body.error, 'VISUAL_MATCH_PROOF_FORBIDDEN_TRANSPORT');

        const noReader = await rawFetchAt(isolatedBase, '/v1/visual-match', {
            method: 'POST',
            headers: {
                Origin: playerOrigin,
                'X-Galgame-Visual-Projection-Proof': encodeProjectionProof(proof),
            },
            body: visualMatchRequestBody(proof),
        });
        assert.equal(noReader.status, 503);
        assert.equal(noReader.body.error, 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE');

        const withReader = createVisualAssetService({
            store: localStore,
            contentStore: localContentStore,
            adminToken,
            adminOrigins: 'http://admin.example',
            playerOrigins: playerOrigin,
            projectionSecret,
            projectionStubReader: () => stub,
            proofSecrets: { [proofKeyId]: proofSecret },
            nonceStore: new MemoryNonceStore(() => nowMs),
            retentionStore: new MemoryVisualAssetRetentionStore(() => nowMs),
            bindingStore: localBindingStore,
            now: () => nowMs,
            allowTestImageDecoder: true,
            safeImageDecoder: createFakeDecoder(),
        });
        await listen(withReader);
        const readerBase = serverBaseUrl(withReader);
        try {
            const blocked = await rawFetchAt(readerBase, '/v1/visual-match', {
                method: 'POST',
                headers: {
                    Origin: playerOrigin,
                    'X-Galgame-Visual-Projection-Proof': encodeProjectionProof(proof),
                },
                body: visualMatchRequestBody(proof),
            });
            assert.equal(blocked.status, 409);
            assert.equal(blocked.body.error, 'VISUAL_MATCH_UNKNOWN_COMPATIBILITY_FAILED');
            assert.deepEqual(blocked.body.blockedTypes, ['scene', 'character', 'equipment', 'item', 'skill']);
            assert.equal(localBindingStore.allRecords().length, 0);
            const bodyText = JSON.stringify(blocked.body);
            assert.equal(bodyText.includes(projectionSecret), false);
            assert.equal(bodyText.includes(proof.signature), false);
        } finally {
            await close(withReader);
        }

        const wrongSignature = {
            ...proof,
            signature: 'x'.repeat(proof.signature.length),
        };
        const invalidProof = verifyVisualProjectionProofToken(encodeProjectionProof(wrongSignature), {
            projectionSecret,
            now: () => nowMs,
        });
        assert.equal(invalidProof.ok, false);
        assert.equal(invalidProof.error, 'VISUAL_MATCH_PROJECTION_PROOF_INVALID_SIGNATURE');
    } finally {
        await close(isolated);
    }
}

async function testVisualBindingReceiptPersistence() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'visual-binding-store-'));
    const bindingStore = new FileVisualBindingStore(path.join(root, 'bindings'), () => nowMs);
    const binding = createBindingForTest();
    const receipt = createProjectionReceiptForTest(binding);
    const record = {
        schemaVersion: 'galgame.visual-binding-store-record.v1',
        binding,
        bindingHash: testShaObject(binding),
        projectionReceipt: receipt,
        projectionReceiptHash: testShaObject(receipt),
        assetMetadataHash: testSha('asset-metadata'),
        retentionScopes: [{
            kind: 'active-release',
            scopeId: `${binding.releaseId}:${binding.arcId}:${binding.chatId}`,
            scopeHash: testSha('active-release-scope'),
        }],
        storageCreatedAt: new Date(nowMs).toISOString(),
        storageUpdatedAt: new Date(nowMs).toISOString(),
    };
    try {
        assert.equal(validateVisualProjectionReceipt(receipt).ok, true);
        assert.equal(validateVisualBindingStoreRecord(record).ok, true);
        const firstSave = await bindingStore.save(record);
        assert.equal(firstSave.ok, true);
        assert.equal(firstSave.reused, false);
        const replay = await bindingStore.save(structuredCloneForTest(record));
        assert.equal(replay.ok, true);
        assert.equal(replay.reused, true);
        const reloaded = new FileVisualBindingStore(path.join(root, 'bindings'), () => nowMs);
        await reloaded.load();
        const stored = reloaded.getByIdempotencyKey(binding.idempotencyKey);
        assert.equal(stored.record.bindingHash, record.bindingHash);
        assert.equal(stored.record.projectionReceiptHash, record.projectionReceiptHash);
        const conflicting = structuredCloneForTest(record);
        conflicting.binding = {
            ...conflicting.binding,
            assetId: 'asset_otherbadge01',
        };
        conflicting.bindingHash = testShaObject(conflicting.binding);
        const conflict = await reloaded.save(conflicting);
        assert.equal(conflict.ok, false);
        assert.equal(conflict.error, 'VISUAL_MATCH_IDEMPOTENCY_CONFLICT');
        const corruptedPath = path.join(root, 'bindings', `${binding.bindingId}.json`);
        const corrupted = structuredCloneForTest(record);
        corrupted.record = true;
        await writeFile(corruptedPath, `${JSON.stringify({
            schemaVersion: 'galgame.visual-binding-store-record.v1',
            kind: 'binding',
            record: {
                ...record,
                projectionReceiptHash: testSha('tampered-receipt'),
            },
        })}\n`, 'utf8');
        const corruptReload = new FileVisualBindingStore(path.join(root, 'bindings'), () => nowMs);
        await assert.rejects(() => corruptReload.load(), /VISUAL_BINDING_RECORD_INVALID/);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}

function createFakeDecoder() {
    return {
        schemaVersion: 'galgame.safe-image-decoder.v1',
        decoderId: 'trusted-test-decoder',
        decoderVersion: 'test-v1',
        async decodeAndReencode({ bytes, metadata }) {
            const body = Buffer.from(bytes).toString('latin1');
            if (body.includes('BROKEN')) {
                const error = new Error('VISUAL_ASSET_DECODE_FAILED');
                error.code = 'VISUAL_ASSET_DECODE_FAILED';
                throw error;
            }
            const width = body.includes('TOO_WIDE') ? 9000 : ((body.includes('ICON_TOO_WIDE') || body.includes('CHAR_TOO_WIDE')) ? 4097 : (metadata.role === 'background' ? 1280 : 128));
            const height = (body.includes('ICON_TOO_WIDE') || body.includes('CHAR_TOO_WIDE')) ? 4097 : (metadata.role === 'background' ? 720 : 128);
            const outputBytes = Buffer.concat([pngBytes, Buffer.from(body.includes('COMPRESSION_BOMB') ? `safe:${metadata.assetType}:${metadata.title}${'x'.repeat(4096)}` : `safe:${metadata.assetType}:${metadata.title}`)]);
            return {
                schemaVersion: 'galgame.safe-image-decoder.v1',
                decoderId: 'trusted-test-decoder',
                decoderVersion: 'test-v1',
                inputSha256: sha256BufferForTest(bytes),
                outputSha256: sha256BufferForTest(outputBytes),
                bytes: outputBytes,
                mime: 'image/png',
                width,
                height,
                hasAlpha: !body.includes('NOALPHA'),
                hasTransparentPixel: !body.includes('NOALPHA') && !body.includes('OPAQUE_ALPHA'),
                frames: 1,
                metadataStripped: !body.includes('NO_METADATA_STRIP'),
                hasUnsafeMetadata: body.includes('UNSAFE_METADATA'),
                compressionRatio: body.includes('COMPRESSION_BOMB') ? 101 : (body.includes('COMPRESSION_90') ? 90 : 1),
            };
        },
    };
}

async function uploadAsset(options, extra = {}) {
    const response = await rawUpload(options, extra);
    assert.equal(response.status, 200);
    return response.body;
}

async function uploadAssetTo(targetBaseUrl, options, extra = {}) {
    const response = await rawUploadTo(targetBaseUrl, options, extra);
    assert.equal(response.status, 200, `upload failed ${response.status}: ${JSON.stringify(response.body)}`);
    return response.body;
}

async function rawUpload(options, extra = {}) {
    return rawUploadTo(baseUrl, options, extra);
}

async function rawUploadTo(targetBaseUrl, options, extra = {}) {
    return rawFetch('/v1/admin/assets/upload', {
        base: targetBaseUrl,
        method: 'POST',
        admin: true,
        body: createUploadBody(options, extra),
    });
}

function createUploadBody(options, extra = {}) {
    return {
        schemaVersion: 'galgame.visual-asset-upload-request.v1',
        assetId: options.assetId,
        assetVersion: options.assetVersion,
        metadata: {
            schemaVersion: 'galgame.visual-asset-upload-metadata.v1',
            assetType: options.assetType,
            role: options.role,
            title: options.title,
            tagCodes: options.tagCodes,
            featureCodes: options.featureCodes,
            licenseCode: options.licenseCode || 'user-owned',
            ...(options.sourceLabel !== undefined ? { sourceLabel: options.sourceLabel } : {}),
            ...(options.sourceDigest !== undefined ? { sourceDigest: options.sourceDigest } : {}),
        },
        file: {
            bytesBase64: Buffer.from(extra.bytes || pngBytes).toString('base64'),
            mime: extra.mime || 'image/png',
        },
    };
}

function makeProof(overrides = {}) {
    const payload = {
        ...baseProofPayload(),
        ...overrides,
        release: {
            ...baseProofPayload().release,
            ...(overrides.release || {}),
        },
        profile: {
            ...baseProofPayload().profile,
            ...(overrides.profile || {}),
        },
        catalog: {
            ...baseProofPayload().catalog,
            ...(overrides.catalog || {}),
        },
        asset: {
            ...baseProofPayload().asset,
            ...(overrides.asset || {}),
        },
        oldSave: overrides.oldSave,
    };
    return signRawPayload(canonicalJsonForTest(payload));
}

function baseProofPayload() {
    return {
        schemaVersion: 'galgame.visual-asset-read-proof.v1',
        audience: 'visual-asset-service',
        purpose: 'asset-read',
        issuer: 'game-config-service',
        keyId: proofKeyId,
        algorithm: 'HMAC-SHA256',
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 300000).toISOString(),
        nonce: `nonce_${Math.random().toString(36).slice(2).padEnd(16, 'x')}`,
        release: {
            releaseId: 'release_main',
            scenarioId: 'scenario_main',
            scenarioVersion: 'v1',
            arcId: 'main',
        },
        profile: {
            visualProfileId: 'profile_main',
            profileHash: testSha('profile'),
        },
        catalog: {
            catalogId: 'catalog',
            catalogRevision: 1,
            catalogHash: testSha('catalog'),
        },
        asset: {
            assetId: 'asset',
            assetVersion: 1,
            assetContentSha256: testSha('asset'),
        },
    };
}

function signRawPayload(payloadJson) {
    const payload = Buffer.from(payloadJson, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    const signingInput = `gvarp1.${payload}`;
    const signature = createHmac('sha256', proofSecret).update(signingInput).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    return `${signingInput}.${signature}`;
}

function makeProjectionProof(overrides = {}, secret = 'visual-projection-secret') {
    const unsigned = {
        schemaVersion: 'galgame.visual-projection-proof.v1',
        audience: 'visual-asset-service',
        purpose: 'visual-match',
        projectionId: 'vvp_matchprojection01',
        projectionHash: testSha('projection'),
        sourceMessageHash: testSha('source-message'),
        releaseId: 'release_main',
        scenarioId: 'scenario_main',
        scenarioVersion: 'v1',
        arcId: 'main',
        chatId: 'chat_main',
        profileId: 'vprof_matchprofile01',
        profileHash: testSha('profile'),
        catalogId: 'vc_matchcatalog01',
        catalogRevision: 1,
        catalogHash: testSha('catalog'),
        sourceMessageIndex: 2,
        extractorVersion: 'galgame.extractor.v1',
        dictionaryVersion: 'galgame.visual-dictionary.v1',
        dictionaryHash: testSha('dictionary'),
        nonce: 'nonce_visualmatchproof0001',
        issuedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 300000).toISOString(),
        signature: '',
        ...overrides,
    };
    return {
        ...unsigned,
        signature: createHmac('sha256', secret).update(canonicalJsonForTest(unsigned)).digest('base64url'),
    };
}

function encodeProjectionProof(proof) {
    return Buffer.from(canonicalJsonForTest(proof), 'utf8').toString('base64url');
}

function createProjectionStubForTest(proof) {
    return {
        schemaVersion: 'galgame.visual-projection-stub.v1',
        projectionId: proof.projectionId,
        projectionHash: proof.projectionHash,
        sourceMessageHash: proof.sourceMessageHash,
        releaseId: proof.releaseId,
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatId: proof.chatId,
        profileId: proof.profileId,
        profileHash: proof.profileHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        sourceMessageIndex: proof.sourceMessageIndex,
        entities: [{
            entityKey: 'entity_scene_match-ruined-house',
            entityType: 'scene',
            displayLabel: 'ruined house',
            visibleAttributes: [
                { code: 'scene-location-kind', value: 'ruined house', confidenceBand: 'explicit' },
                { code: 'scene-atmosphere', value: 'ruined', confidenceBand: 'explicit' },
            ],
            confidenceBand: 'explicit',
        }],
        extractorVersion: proof.extractorVersion,
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
        expiresAt: proof.expiresAt,
    };
}

function visualMatchRequestBody(proof, overrides = {}) {
    return {
        schemaVersion: 'galgame.visual-match-request.v1',
        projectionId: proof.projectionId,
        entityKey: 'entity_scene_match-ruined-house',
        entityType: 'scene',
        idempotencyKey: 'idem_visual_match_0000001',
        ...overrides,
    };
}

function createBindingForTest() {
    const nowIso = new Date(nowMs).toISOString();
    return {
        schemaVersion: 'galgame.visual-binding.v1',
        bindingId: 'vb_visualbinding00000001',
        bindingType: 'item',
        entityKey: 'entity_item_match-badge0001',
        releaseId: 'release_main',
        scenarioId: 'scenario_main',
        scenarioVersion: 'v1',
        arcId: 'main',
        chatId: 'chat_main',
        sourceMessageIndex: 2,
        sourceMessageHash: testSha('source-message'),
        evidenceDigest: testSha('projection'),
        projectionId: 'vvp_matchprojection01',
        visualProfileId: 'vprof_matchprofile01',
        profileHash: testSha('profile'),
        catalogId: 'vc_matchcatalog01',
        catalogRevision: 1,
        catalogHash: testSha('catalog'),
        assetId: 'asset_matchbadge0001',
        assetVersion: 1,
        assetContentSha256: testSha('asset').slice('sha256:'.length),
        matcherVersion: 'galgame.visual-deterministic-matcher.v1',
        scorerVersion: 'galgame.visual-deterministic-scorer.v1',
        dictionaryVersion: 'galgame.visual-dictionary.v1',
        dictionaryHash: testSha('dictionary'),
        score: 80,
        scoreBand: 'high',
        reasonCodes: ['type-match', 'tag-overlap'],
        bindingPolicy: 'entity-first-seen-fixed',
        idempotencyKey: 'idem_visual_match_binding001',
        createdAt: nowIso,
        updatedAt: nowIso,
    };
}

function createProjectionReceiptForTest(binding) {
    return {
        schemaVersion: 'galgame.visual-projection-receipt.v1',
        projectionId: binding.projectionId,
        projectionHash: binding.evidenceDigest,
        releaseId: binding.releaseId,
        scenarioId: binding.scenarioId,
        scenarioVersion: binding.scenarioVersion,
        arcId: binding.arcId,
        chatId: binding.chatId,
        visualProfileId: binding.visualProfileId,
        profileHash: binding.profileHash,
        catalogId: binding.catalogId,
        catalogRevision: binding.catalogRevision,
        catalogHash: binding.catalogHash,
        dictionaryVersion: binding.dictionaryVersion,
        dictionaryHash: binding.dictionaryHash,
        extractorVersion: 'galgame.extractor.v1',
        sourceMessageIndex: binding.sourceMessageIndex,
        sourceMessageHash: binding.sourceMessageHash,
        entityKey: binding.entityKey,
        entityType: binding.bindingType,
        proofNonceHash: testSha('proof-nonce'),
        proofIssuedAt: new Date(nowMs).toISOString(),
        proofExpiresAt: new Date(nowMs + 300000).toISOString(),
        receiptCreatedAt: new Date(nowMs).toISOString(),
    };
}

function testShaObject(value) {
    return `sha256:${createHash('sha256').update(canonicalJsonForTest(value)).digest('hex')}`;
}

function structuredCloneForTest(value) {
    return JSON.parse(JSON.stringify(value));
}

function canonicalJsonForTest(value) {
    if (value === null) return 'null';
    if (typeof value === 'string') {
        if (!/^[\x20-\x7e]*$/.test(value)) throw new Error('NON_ASCII_STRING');
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error('NON_CANONICAL_NUMBER');
        return String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJsonForTest(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonForTest(value[key])}`).join(',')}}`;
    }
    throw new Error('UNSUPPORTED_CANONICAL_VALUE');
}

function testSha(label) {
    const hex = Buffer.from(label).toString('hex').padEnd(64, '0').slice(0, 64);
    return `sha256:${hex}`;
}

function sha256BufferForTest(bytes) {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function insertPngChunkBeforeIend(bytes, type, data) {
    const iendOffset = bytes.length - 12;
    const chunk = makePngChunkForTest(type, data);
    return Buffer.concat([bytes.subarray(0, iendOffset), chunk, bytes.subarray(iendOffset)]);
}

function insertPngChunkAfterIhdr(bytes, type, data) {
    const ihdrEnd = 8 + 25;
    const chunk = makePngChunkForTest(type, data);
    return Buffer.concat([bytes.subarray(0, ihdrEnd), chunk, bytes.subarray(ihdrEnd)]);
}

function makePngChunkForTest(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const body = Buffer.from(data || []);
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    typeBytes.copy(out, 4);
    body.copy(out, 8);
    out.writeUInt32BE(crc32ForTest(Buffer.concat([typeBytes, body])), 8 + body.length);
    return out;
}

function createPngForTest(width, height, { alpha = true, alphaByte = 0, filterType = 0 } = {}) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = alpha ? 6 : 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const bytesPerPixel = alpha ? 4 : 3;
    const rows = [];
    for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
        const row = Buffer.alloc(1 + width * bytesPerPixel);
        row[0] = filterType;
        if (alpha) {
            for (let byteIndex = 4; byteIndex < row.length; byteIndex += 4) {
                row[byteIndex] = alphaByte;
            }
        }
        rows.push(row);
    }
    return Buffer.concat([
        signature,
        makePngChunkForTest('IHDR', ihdr),
        makePngChunkForTest('IDAT', deflateSync(Buffer.concat(rows))),
        makePngChunkForTest('IEND', Buffer.alloc(0)),
    ]);
}

function createPngWithCustomIdatForTest(width, height, { alpha = true, idatData = Buffer.from([0]) } = {}) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = alpha ? 6 : 2;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([
        signature,
        makePngChunkForTest('IHDR', ihdr),
        makePngChunkForTest('IDAT', idatData),
        makePngChunkForTest('IEND', Buffer.alloc(0)),
    ]);
}

function extractPngChunkDataForTest(bytes, type) {
    let offset = 8;
    const chunks = [];
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const chunkType = bytes.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (chunkType === type) chunks.push(Buffer.from(bytes.subarray(dataStart, dataEnd)));
        offset = dataEnd + 4;
        if (chunkType === 'IEND') break;
    }
    return Buffer.concat(chunks);
}

function corruptPngIdatDataForTest(bytes) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
        const length = bytes.readUInt32BE(offset);
        const chunkType = bytes.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (chunkType === 'IDAT') {
            const corrupted = Buffer.from(bytes);
            corrupted[dataStart] = corrupted[dataStart] ^ 0xff;
            const typeBytes = Buffer.from('IDAT', 'ascii');
            corrupted.writeUInt32BE(crc32ForTest(Buffer.concat([typeBytes, corrupted.subarray(dataStart, dataEnd)])), dataEnd);
            return corrupted;
        }
        offset = dataEnd + 4;
    }
    throw new Error('IDAT_NOT_FOUND');
}

function crc32ForTest(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC32_TABLE_FOR_TEST[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function computeTestAssetMetadataHash(asset) {
    return `sha256:${createHash('sha256').update(canonicalJsonForTest(withoutUndefinedForTest({
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        assetType: asset.assetType,
        role: asset.role,
        title: asset.title,
        tagCodes: asset.tagCodes,
        featureCodes: asset.featureCodes,
        dictionaryVersion: asset.dictionaryVersion,
        dictionaryHash: asset.dictionaryHash,
        licenseCode: asset.licenseCode,
        sourceLabel: asset.sourceLabel,
        sourceDigest: asset.sourceDigest,
        assetContentSha256: asset.assetContentSha256,
        canonicalMime: asset.canonicalMime,
        width: asset.width,
        height: asset.height,
    }))).digest('hex')}`;
}

function withoutUndefinedForTest(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function fetchJson(path, options = {}) {
    const response = await rawFetch(path, options);
    assert.equal(response.status >= 200 && response.status < 300, true, `${path} failed with ${response.status}: ${JSON.stringify(response.body)}`);
    return response.body;
}

async function fetchJsonAt(targetBaseUrl, path, options = {}) {
    const response = await rawFetchAt(targetBaseUrl, path, options);
    assert.equal(response.status >= 200 && response.status < 300, true, `${path} failed with ${response.status}: ${JSON.stringify(response.body)}`);
    return response.body;
}

async function rawFetch(path, {
    base = baseUrl,
    method = 'GET',
    headers = {},
    body,
    admin = false,
    raw = false,
} = {}) {
    return rawFetchAt(base, path, { method, headers, body, admin, raw });
}

async function rawFetchAt(targetBaseUrl, path, {
    method = 'GET',
    headers = {},
    body,
    admin = false,
    raw = false,
} = {}) {
    const requestHeaders = { ...headers };
    if (admin) requestHeaders.Authorization = `Bearer ${adminToken}`;
    const init = { method, headers: requestHeaders };
    if (body !== undefined) {
        init.body = JSON.stringify(body);
        init.headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(`${targetBaseUrl}${path}`, init);
    if (raw) {
        const bytes = Buffer.from(await response.arrayBuffer());
        return {
            status: response.status,
            headers: response.headers,
            bytes,
            text: bytes.toString('utf8'),
        };
    }
    const text = await response.text();
    let parsed = null;
    try {
        parsed = text ? JSON.parse(text) : null;
    } catch {
        parsed = { raw: text };
    }
    return {
        status: response.status,
        headers: response.headers,
        body: parsed,
        text,
    };
}

function listen(server) {
    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}

function serverBaseUrl(server) {
    const address = server.address();
    return `http://${address.address}:${address.port}`;
}
