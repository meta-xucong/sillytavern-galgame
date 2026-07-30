import http from 'node:http';
import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import {
    mkdirSync,
    readFileSync,
    readdirSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import {
    mkdir,
    readdir,
    readFile,
    rename,
    unlink,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL,
} from 'node:url';
import {
    deflateSync,
    inflateSync,
} from 'node:zlib';
import {
    IMMUTABLE_UNKNOWN_VISUAL_ASSETS,
    VISUAL_BINDING_PROTOCOL_VERSION,
    VISUAL_MATCH_RESULT_PROTOCOL_VERSION,
    applyVisualScorePolicy,
    validateVisualBinding,
    validateVisualMatchResult,
    validateVisualProjectionProofShape,
    validateVisualProjectionStub,
} from '../../frontend/shared/src/visual-system-schema.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = Number(process.env.GALGAME_VISUAL_ASSET_PORT || 8798);
const DEFAULT_STORE_DIR = path.join(moduleDir, 'data');
const METADATA_RECORD_VERSION = 'galgame.visual-asset-metadata-store-record.v1';
const CONTENT_RECORD_VERSION = 'galgame.visual-asset-content-store-record.v1';
const RETENTION_RECORD_VERSION = 'galgame.visual-asset-retention-store-record.v1';
const NONCE_RECORD_VERSION = 'galgame.visual-asset-nonce-store-record.v1';
const BINDING_RECORD_VERSION = 'galgame.visual-binding-store-record.v1';
const PROJECTION_RECEIPT_RECORD_VERSION = 'galgame.visual-projection-receipt.v1';
const MAX_UPLOAD_JSON_BYTES = 24 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_VISUAL_MATCH_JSON_BYTES = 4096;
const MAX_VISUAL_MATCH_PROOF_BYTES = 4096;
const MAX_DECODED_PIXELS = 24_000_000;
const MAX_SCENE_IMAGE_DIMENSION = 8192;
const MAX_SPRITE_ICON_IMAGE_DIMENSION = 4096;
const MAX_COMPRESSION_RATIO = 80;
const MAX_PROOF_TOKEN_BYTES = 4096;
const MAX_PROOF_PAYLOAD_BYTES = 3072;
const READ_PROOF_PROTOCOL_VERSION = 'galgame.visual-asset-read-proof.v1';
const UPLOAD_REQUEST_PROTOCOL_VERSION = 'galgame.visual-asset-upload-request.v1';
const UPLOAD_METADATA_PROTOCOL_VERSION = 'galgame.visual-asset-upload-metadata.v1';
const CATALOG_DRAFT_REQUEST_PROTOCOL_VERSION = 'galgame.visual-catalog-draft-request.v1';
const HEALTH_SCHEMA_VERSION = 'galgame.visual-asset-health.v1';
const ADMIN_ASSET_RESPONSE_VERSION = 'galgame.visual-admin-asset-response.v1';
const PLAYER_ASSET_RESPONSE_VERSION = 'galgame.visual-player-published-asset-response.v1';
const VISUAL_MATCH_REQUEST_PROTOCOL_VERSION = 'galgame.visual-match-request.v1';
const DICTIONARY_VERSION = 'galgame.visual-dictionary.v1';
const CANONICAL_JSON_VERSION = 'galgame.canonical-json.v1';
const SAFE_IMAGE_DECODER_PROTOCOL_VERSION = 'galgame.safe-image-decoder.v1';
const VISUAL_MATCHER_VERSION = 'galgame.visual-deterministic-matcher.v1';
const VISUAL_SCORER_VERSION = 'galgame.visual-deterministic-scorer.v1';

const ASSET_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
const ASSET_TYPE_SET = new Set(ASSET_TYPES);
const PROJECTION_ID_PATTERN = /^vvp_[a-z0-9_-]{12,80}$/;
const ENTITY_KEY_PATTERN = /^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$/;
const IDEMPOTENCY_KEY_PATTERN = /^idem_[A-Za-z0-9._:-]{16,120}$/;
const ROLE_BY_TYPE = Object.freeze({
    scene: 'background',
    character: 'transparent-sprite',
    equipment: 'icon',
    item: 'icon',
    skill: 'icon',
});
const LICENSE_CODES = new Set([
    'user-owned',
    'public-domain',
    'cc0',
    'licensed-private',
    'unknown-restricted',
]);
const CANONICAL_MIME_BY_MAGIC = Object.freeze({
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
});
const ALLOWED_OUTPUT_MIME = new Set(Object.values(CANONICAL_MIME_BY_MAGIC));
const DEFAULT_DICTIONARY_CODES = Object.freeze([
    'scene-urban',
    'scene-wilderness',
    'scene-interior',
    'scene-ruined',
    'scene-night',
    'character-human',
    'character-elf',
    'character-dwarf',
    'character-adult',
    'character-silhouette',
    'equipment-weapon',
    'equipment-armor',
    'item-key',
    'item-consumable',
    'item-treasure',
    'skill-magic',
    'skill-combat',
    'skill-stealth',
    'mood-dark',
    'mood-warm',
    'quality-low',
    'quality-high',
    'unknown-generic',
]);
const DEFAULT_DICTIONARY = Object.freeze({
    dictionaryVersion: DICTIONARY_VERSION,
    codes: DEFAULT_DICTIONARY_CODES,
});
const DEFAULT_DICTIONARY_HASH = sha256Hex(canonicalJson({
    schemaVersion: DICTIONARY_VERSION,
    codes: DEFAULT_DICTIONARY_CODES,
}));
const TRANSPARENT_PNG_BYTES = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l62uYQAAAABJRU5ErkJggg==',
    'base64',
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'iCCP', 'eXIf', 'tIME', 'pHYs', 'gAMA', 'cHRM', 'sRGB']);
const PNG_APNG_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);

export function createVisualAssetService({
    store = new MemoryVisualAssetStore(),
    contentStore = new MemoryContentStore(),
    quarantineStore = new MemoryQuarantineStore(),
    safeImageDecoder = createBuiltInSafePngDecoder(),
    adminToken = process.env.GALGAME_VISUAL_ASSET_ADMIN_TOKEN || '',
    adminOrigins = process.env.GALGAME_VISUAL_ASSET_ADMIN_ORIGINS || '',
    playerOrigins = process.env.GALGAME_VISUAL_ASSET_PLAYER_ORIGINS || '',
    proofSecrets = createProofKeyRingFromEnv(),
    projectionSecret = process.env.GALGAME_VISUAL_PROJECTION_SECRET || '',
    projectionStubBaseUrl = process.env.GALGAME_VISUAL_PROJECTION_STUB_BASE_URL || '',
    projectionStubServiceToken = process.env.GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN || '',
    projectionStubReader = null,
    projectionStubFetch = globalThis.fetch,
    bindingStore = new MemoryVisualBindingStore(),
    allowTestImageDecoder = false,
    now = () => Date.now(),
    nonceStore = new FileNonceStore(path.join(DEFAULT_STORE_DIR, 'nonces'), now),
    retentionStore = new MemoryVisualAssetRetentionStore(now),
    dictionary = DEFAULT_DICTIONARY,
    dictionaryHash = DEFAULT_DICTIONARY_HASH,
    maxUploadBytes = MAX_UPLOAD_BYTES,
    maxDecodedPixels = MAX_DECODED_PIXELS,
    maxSceneImageDimension = MAX_SCENE_IMAGE_DIMENSION,
    maxSpriteIconImageDimension = MAX_SPRITE_ICON_IMAGE_DIMENSION,
    maxCompressionRatio = MAX_COMPRESSION_RATIO,
} = {}) {
    const service = {
        store,
        contentStore,
        quarantineStore,
        safeImageDecoder,
        adminToken: String(adminToken || ''),
        adminOrigins: parseOriginList(adminOrigins),
        playerOrigins: parseOriginList(playerOrigins),
        proofSecrets,
        projectionSecret: String(projectionSecret || ''),
        projectionStubBaseUrl: normalizeBaseUrl(projectionStubBaseUrl),
        projectionStubServiceToken: String(projectionStubServiceToken || ''),
        projectionStubReader,
        projectionStubFetch,
        bindingStore,
        allowTestImageDecoder,
        now,
        nonceStore,
        retentionStore,
        dictionary: freezeDictionary(dictionary, dictionaryHash),
        maxUploadBytes,
        maxDecodedPixels,
        maxSceneImageDimension,
        maxSpriteIconImageDimension,
        maxCompressionRatio,
        initialized: false,
    };
    const server = http.createServer(async (request, response) => {
        try {
            await ensureServiceInitialized(service);
            await handleRequest(request, response, service);
        } catch (error) {
            sendJson(response, 500, {
                ok: false,
                error: sanitizeErrorCode(error?.code || error?.message || 'VISUAL_STORAGE_UNAVAILABLE'),
            });
        }
    });
    server.visualAssetService = service;
    return server;
}

export function createBuiltInSafePngDecoder() {
    return Object.freeze({
        schemaVersion: SAFE_IMAGE_DECODER_PROTOCOL_VERSION,
        decoderId: 'builtin-png-safe-stripper',
        decoderVersion: '1',
        async decodeAndReencode({ bytes, mime, metadata, limits }) {
            return decodeAndSanitizePng(Buffer.from(bytes), mime, { metadata, limits });
        },
    });
}

function isBuiltInSafeImageDecoder(decoder) {
    return decoder?.schemaVersion === SAFE_IMAGE_DECODER_PROTOCOL_VERSION
        && decoder.decoderId === 'builtin-png-safe-stripper'
        && decoder.decoderVersion === '1';
}

export async function handleRequest(request, response, service) {
    const url = new URL(request.url || '/', 'http://localhost');
    const method = request.method || 'GET';
    const pathname = url.pathname;

    if (method === 'OPTIONS') {
        if (pathname === '/v1/visual-match') {
            handleVisualMatchPreflight(request, response, service);
            return;
        }
        if (isPlayerAssetContentPath(pathname)) {
            handlePlayerPreflight(request, response, service);
            return;
        }
        sendJson(response, 403, {
            ok: false,
            error: 'VISUAL_ASSET_PLAYER_PREFLIGHT_REJECTED',
        });
        return;
    }

    if (method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, {
            ok: true,
            service: 'visual-asset-service',
            schema: HEALTH_SCHEMA_VERSION,
            adminAuth: service.adminToken ? 'required' : 'unconfigured',
            catalogStore: service.store?.kind || 'memory',
        });
        return;
    }

    if (method === 'POST' && pathname === '/v1/visual-match') {
        await handleVisualMatch(request, response, service, { hasQuery: Boolean(url.search) });
        return;
    }

    if (pathname.startsWith('/v1/admin/')) {
        const originCheck = requireAdminOrigin(request, service.adminOrigins);
        if (!originCheck.ok) {
            sendJson(response, originCheck.status, { ok: false, error: originCheck.error });
            return;
        }
        const authCheck = authorizeAdminRequest(request, service.adminToken);
        if (!authCheck.ok) {
            sendJson(response, authCheck.status, { ok: false, error: authCheck.error }, authCheck.headers);
            return;
        }
    }

    if (method === 'POST' && pathname === '/v1/admin/assets/upload') {
        const body = await readJsonBody(request, MAX_UPLOAD_JSON_BYTES);
        const result = await uploadAsset(body, service);
        sendJson(response, result.status, result.body);
        return;
    }

    const adminAssetMatch = /^\/v1\/admin\/assets\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && adminAssetMatch) {
        const asset = service.store.getAsset(decodeURIComponent(adminAssetMatch[1]), parsePositiveInt(adminAssetMatch[2]));
        if (!asset) {
            sendJson(response, 404, { ok: false, error: 'VISUAL_ASSET_NOT_FOUND' });
            return;
        }
        sendJson(response, 200, { ok: true, asset: serializeAdminAsset(asset) });
        return;
    }

    const adminContentMatch = /^\/v1\/admin\/assets\/([^/]+)\/([^/]+)\/content$/.exec(pathname);
    if (method === 'GET' && adminContentMatch) {
        const asset = service.store.getAsset(decodeURIComponent(adminContentMatch[1]), parsePositiveInt(adminContentMatch[2]));
        if (!asset) {
            sendJson(response, 404, { ok: false, error: 'VISUAL_ASSET_NOT_FOUND' });
            return;
        }
        await sendAssetBytes(response, asset, service, { admin: true });
        return;
    }

    if (method === 'POST' && pathname === '/v1/admin/catalogs/draft') {
        const body = await readJsonBody(request, 128 * 1024);
        const result = await createCatalogDraft(body, service);
        sendJson(response, result.status, result.body);
        return;
    }

    const adminCatalogMatch = /^\/v1\/admin\/catalogs\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && adminCatalogMatch) {
        const catalog = service.store.getCatalog(decodeURIComponent(adminCatalogMatch[1]), parsePositiveInt(adminCatalogMatch[2]));
        if (!catalog) {
            sendJson(response, 404, { ok: false, error: 'VISUAL_CATALOG_INVALID' });
            return;
        }
        sendJson(response, 200, { ok: true, catalog: serializeCatalog(catalog) });
        return;
    }

    const catalogActionMatch = /^\/v1\/admin\/catalogs\/([^/]+)\/([^/]+)\/(validate|publish|archive)$/.exec(pathname);
    if (method === 'POST' && catalogActionMatch) {
        const catalogId = decodeURIComponent(catalogActionMatch[1]);
        const revision = parsePositiveInt(catalogActionMatch[2]);
        const action = catalogActionMatch[3];
        const result = await updateCatalogLifecycle(catalogId, revision, action, service);
        sendJson(response, result.status, result.body);
        return;
    }

    const playerContentMatch = /^\/v1\/assets\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/content$/.exec(pathname);
    if (method === 'GET' && playerContentMatch) {
        await handlePlayerContentRead(request, response, {
            catalogId: decodeURIComponent(playerContentMatch[1]),
            catalogRevision: parsePositiveInt(playerContentMatch[2]),
            assetId: decodeURIComponent(playerContentMatch[3]),
            assetVersion: parsePositiveInt(playerContentMatch[4]),
            hasQuery: Boolean(url.search),
        }, service);
        return;
    }

    sendJson(response, 404, { ok: false, error: 'NOT_FOUND' });
}

export async function uploadAsset(body, service) {
    const validation = validateUploadRequest(body, service.dictionary);
    if (!validation.ok) {
        return errorResult(400, validation.error);
    }
    if (!service.safeImageDecoder || service.safeImageDecoder.schemaVersion !== SAFE_IMAGE_DECODER_PROTOCOL_VERSION || typeof service.safeImageDecoder.decodeAndReencode !== 'function') {
        return errorResult(503, 'VISUAL_ASSET_REENCODE_FAILED');
    }
    if (!isBuiltInSafeImageDecoder(service.safeImageDecoder) && service.allowTestImageDecoder !== true) {
        return errorResult(503, 'VISUAL_ASSET_REENCODE_FAILED');
    }

    const { request } = validation;
    const uploadBytes = Buffer.from(request.file.bytesBase64, 'base64');
    if (uploadBytes.length <= 0 || uploadBytes.length > service.maxUploadBytes) {
        return errorResult(400, 'VISUAL_ASSET_SIZE_LIMIT');
    }
    const sniffedMime = sniffImageMime(uploadBytes);
    if (!sniffedMime || (request.file.mime && request.file.mime !== sniffedMime)) {
        return errorResult(400, 'VISUAL_ASSET_UNSUPPORTED_MIME');
    }

    const quarantineId = await service.quarantineStore.write(uploadBytes);
    try {
        const decoded = await service.safeImageDecoder.decodeAndReencode({
            bytes: uploadBytes,
            mime: sniffedMime,
            metadata: request.metadata,
            limits: {
                maxUploadBytes: service.maxUploadBytes,
                maxDecodedPixels: service.maxDecodedPixels,
                maxSceneImageDimension: service.maxSceneImageDimension,
                maxSpriteIconImageDimension: service.maxSpriteIconImageDimension,
                maxCompressionRatio: service.maxCompressionRatio,
            },
        });
        const safe = validateDecodedImage(decoded, request.metadata, service, {
            uploadBytesLength: uploadBytes.length,
            inputSha256: sha256Buffer(uploadBytes),
        });
        if (!safe.ok) {
            return errorResult(400, safe.error);
        }
        const finalBytes = Buffer.from(decoded.bytes);
        const assetContentSha256 = sha256Buffer(finalBytes);
        const rawUploadSha256 = sha256Buffer(uploadBytes);
        const nowIso = new Date(service.now()).toISOString();
        const baseMetadata = {
            assetId: request.assetId,
            assetVersion: request.assetVersion,
            assetType: request.metadata.assetType,
            role: request.metadata.role,
            title: request.metadata.title,
            tagCodes: request.metadata.tagCodes,
            featureCodes: request.metadata.featureCodes,
            dictionaryVersion: service.dictionary.dictionaryVersion,
            dictionaryHash: service.dictionary.dictionaryHash,
            licenseCode: request.metadata.licenseCode,
            sourceLabel: request.metadata.sourceLabel || undefined,
            sourceDigest: request.metadata.sourceDigest || undefined,
            assetContentSha256,
            canonicalMime: decoded.mime,
            width: decoded.width,
            height: decoded.height,
        };
        const assetMetadataHash = sha256Hex(canonicalJson(withoutUndefined(baseMetadata)));
        const existing = service.store.getAsset(request.assetId, request.assetVersion);
        if (existing) {
            if (existing.assetContentSha256 === assetContentSha256 && existing.assetMetadataHash === assetMetadataHash) {
                return {
                    status: 200,
                    body: {
                        ok: true,
                        reused: true,
                        asset: serializeAdminAsset(existing),
                    },
                };
            }
            return errorResult(409, 'VISUAL_ASSET_HASH_CONFLICT');
        }
        await service.contentStore.put(assetContentSha256, finalBytes, decoded.mime);
        const asset = {
            ...baseMetadata,
            rawUploadSha256,
            assetMetadataHash,
            status: 'draft',
            createdAt: nowIso,
            updatedAt: nowIso,
            serviceOwned: false,
        };
        await service.store.putAsset(asset);
        return {
            status: 200,
            body: {
                ok: true,
                reused: false,
                asset: serializeAdminAsset(asset),
            },
        };
    } catch (error) {
        return errorResult(error.status || 400, sanitizeErrorCode(error.code || error.message || 'VISUAL_ASSET_DECODE_FAILED'));
    } finally {
        await service.quarantineStore.discard(quarantineId);
    }
}

export async function createCatalogDraft(body, service) {
    const validation = validateCatalogDraftRequest(body);
    if (!validation.ok) {
        return errorResult(400, validation.error);
    }
    const request = validation.request;
    const existing = service.store.getCatalog(request.catalogId, request.revision);
    if (existing && existing.status !== 'draft') {
        return errorResult(409, 'VISUAL_CATALOG_CONFLICT');
    }
    const refs = uniqueAssetRefs([
        ...request.assetRefs,
        ...ASSET_TYPES.map((type) => getUnknownAssetRef(type)),
    ]);
    for (const ref of refs) {
        const asset = service.store.getAsset(ref.assetId, ref.assetVersion);
        if (!asset) {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        if (asset.assetType !== ref.assetType || asset.assetContentSha256 !== ref.assetContentSha256 || asset.assetMetadataHash !== ref.assetMetadataHash) {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
    }
    const nowIso = new Date(service.now()).toISOString();
    const catalog = {
        schemaVersion: 'galgame.visual-asset-catalog.v1',
        catalogId: request.catalogId,
        revision: request.revision,
        status: 'draft',
        dictionaryVersion: service.dictionary.dictionaryVersion,
        dictionaryHash: service.dictionary.dictionaryHash,
        assetRefs: refs,
        catalogHash: '',
        createdAt: existing?.createdAt || nowIso,
        updatedAt: nowIso,
        archivedAt: null,
    };
    await service.store.putCatalog(catalog);
    return {
        status: 200,
        body: {
            ok: true,
            catalog: serializeCatalog(catalog),
        },
    };
}

export async function updateCatalogLifecycle(catalogId, revision, action, service) {
    if (!isSafeId(catalogId) || !Number.isInteger(revision) || revision <= 0) {
        return errorResult(400, 'VISUAL_CATALOG_INVALID');
    }
    const catalog = service.store.getCatalog(catalogId, revision);
    if (!catalog) {
        return errorResult(404, 'VISUAL_CATALOG_INVALID');
    }
    if (action === 'validate') {
        if (catalog.status === 'published' || catalog.status === 'archived') {
            return errorResult(409, 'VISUAL_CATALOG_IMMUTABLE');
        }
        const validation = await validateCatalogIntegrity(catalog, service);
        if (!validation.ok) {
            return errorResult(400, validation.error);
        }
        const expectedHash = computeCatalogHash(catalog, service.dictionary);
        if (catalog.catalogHash && catalog.catalogHash !== expectedHash) {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        const updated = {
            ...catalog,
            status: 'validated',
            catalogHash: expectedHash,
            updatedAt: new Date(service.now()).toISOString(),
        };
        await service.store.putCatalog(updated);
        return { status: 200, body: { ok: true, catalog: serializeCatalog(updated) } };
    }
    if (action === 'publish') {
        if (catalog.status === 'published') {
            return { status: 200, body: { ok: true, catalog: serializeCatalog(catalog), reused: true } };
        }
        if (catalog.status !== 'validated') {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        const validation = await validateCatalogIntegrity(catalog, service);
        if (!validation.ok) {
            return errorResult(400, validation.error);
        }
        const expectedHash = computeCatalogHash(catalog, service.dictionary);
        if (catalog.catalogHash && catalog.catalogHash !== expectedHash) {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        const updated = {
            ...catalog,
            status: 'published',
            catalogHash: expectedHash,
            updatedAt: new Date(service.now()).toISOString(),
        };
        for (const ref of updated.assetRefs) {
            const asset = service.store.getAsset(ref.assetId, ref.assetVersion);
            if (asset && asset.status !== 'published') {
                await service.store.putAsset({
                    ...asset,
                    status: 'published',
                    updatedAt: updated.updatedAt,
                });
            }
        }
        await service.store.putCatalog(updated);
        return { status: 200, body: { ok: true, catalog: serializeCatalog(updated) } };
    }
    if (action === 'archive') {
        if (catalog.status === 'archived') {
            return { status: 200, body: { ok: true, catalog: serializeCatalog(catalog), reused: true } };
        }
        if (catalog.status !== 'published') {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        const validation = await validateCatalogIntegrity(catalog, service);
        if (!validation.ok) {
            return errorResult(400, validation.error);
        }
        const expectedHash = computeCatalogHash(catalog, service.dictionary);
        if (catalog.catalogHash !== expectedHash) {
            return errorResult(400, 'VISUAL_CATALOG_INVALID');
        }
        const updated = {
            ...catalog,
            status: 'archived',
            archivedAt: catalog.archivedAt || new Date(service.now()).toISOString(),
            updatedAt: new Date(service.now()).toISOString(),
        };
        await service.store.putCatalog(updated);
        return { status: 200, body: { ok: true, catalog: serializeCatalog(updated) } };
    }
    return errorResult(404, 'NOT_FOUND');
}

export async function handlePlayerContentRead(request, response, route, service) {
    const originCheck = requirePlayerOrigin(request, service.playerOrigins);
    if (!originCheck.ok) {
        sendJson(response, originCheck.status, { ok: false, error: originCheck.error });
        return;
    }
    if (route.hasQuery || hasForbiddenProofTransport(request)) {
        sendJson(response, 400, { ok: false, error: 'VISUAL_ASSET_READ_PROOF_FORBIDDEN_TRANSPORT' });
        return;
    }
    const token = String(request.headers['x-galgame-visual-asset-proof'] || '').trim();
    const verification = verifyVisualAssetReadProof(token, {
        proofSecrets: service.proofSecrets,
        now: service.now,
        nonceStore: service.nonceStore,
    });
    if (!verification.ok) {
        sendJson(response, verification.status || 401, { ok: false, error: verification.error });
        return;
    }
    const proof = verification.payload;
    if (
        proof.catalog.catalogId !== route.catalogId ||
        proof.catalog.catalogRevision !== route.catalogRevision ||
        proof.asset.assetId !== route.assetId ||
        proof.asset.assetVersion !== route.assetVersion
    ) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_ASSET_READ_PROOF_SCOPE_MISMATCH' });
        return;
    }
    const catalog = service.store.getCatalog(route.catalogId, route.catalogRevision);
    if (!catalog || (catalog.status !== 'published' && catalog.status !== 'archived')) {
        sendJson(response, 404, { ok: false, error: 'VISUAL_CATALOG_NOT_PUBLISHED' });
        return;
    }
    if (catalog.status === 'archived') {
        if (!proof.oldSave) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_ASSET_OLD_SAVE_PROOF_REQUIRED' });
            return;
        }
        const retention = service.retentionStore.verifyOldSaveRead({
            release: proof.release,
            profile: proof.profile,
            oldSave: proof.oldSave,
            catalog: proof.catalog,
            asset: proof.asset,
            nowMs: service.now(),
        });
        if (!retention.ok) {
            sendJson(response, 403, { ok: false, error: retention.error });
            return;
        }
    } else if (proof.oldSave) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_ASSET_READ_PROOF_SCOPE_MISMATCH' });
        return;
    }
    if (catalog.catalogHash !== proof.catalog.catalogHash) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_ASSET_READ_PROOF_SCOPE_MISMATCH' });
        return;
    }
    const ref = catalog.assetRefs.find((item) => item.assetId === route.assetId && item.assetVersion === route.assetVersion);
    if (!ref || ref.assetContentSha256 !== proof.asset.assetContentSha256) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_ASSET_READ_PROOF_SCOPE_MISMATCH' });
        return;
    }
    const asset = service.store.getAsset(route.assetId, route.assetVersion);
    if (!asset || asset.assetContentSha256 !== proof.asset.assetContentSha256) {
        sendJson(response, 409, { ok: false, error: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
        return;
    }
    if (ref.assetMetadataHash !== asset.assetMetadataHash) {
        sendJson(response, 409, { ok: false, error: 'VISUAL_CATALOG_INVALID' });
        return;
    }
    await sendAssetBytes(response, asset, service, { admin: false });
}

export async function handleVisualMatch(request, response, service, { hasQuery = false } = {}) {
    const originCheck = requirePlayerOrigin(request, service.playerOrigins);
    if (!originCheck.ok) {
        sendJson(response, originCheck.status, { ok: false, error: originCheck.error });
        return;
    }
    if (hasQuery || hasForbiddenVisualMatchProofTransport(request)) {
        sendJson(response, 400, { ok: false, error: 'VISUAL_MATCH_PROOF_FORBIDDEN_TRANSPORT' });
        return;
    }
    let body;
    try {
        body = await readStrictJsonBody(request, MAX_VISUAL_MATCH_JSON_BYTES, 'VISUAL_MATCH_REQUEST_TOO_LARGE');
    } catch (error) {
        sendJson(response, error.status || 400, { ok: false, error: error.code || 'VISUAL_MATCH_BAD_REQUEST' });
        return;
    }
    const requestValidation = validateVisualMatchRequest(body);
    if (!requestValidation.ok) {
        sendJson(response, 400, { ok: false, error: requestValidation.error });
        return;
    }
    const projectionProofToken = String(request.headers['x-galgame-visual-projection-proof'] || '').trim();
    const proofVerification = verifyVisualProjectionProofToken(projectionProofToken, {
        projectionSecret: service.projectionSecret,
        now: service.now,
    });
    if (!proofVerification.ok) {
        sendJson(response, proofVerification.status || 401, { ok: false, error: proofVerification.error });
        return;
    }
    const matchRequest = requestValidation.request;
    const proof = proofVerification.proof;
    if (matchRequest.projectionId !== proof.projectionId) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_MATCH_SCOPE_MISMATCH' });
        return;
    }
    const stubResult = await readVerifiedProjectionStub(matchRequest.projectionId, service);
    if (!stubResult.ok) {
        sendJson(response, stubResult.status || 503, { ok: false, error: stubResult.error });
        return;
    }
    const stubCheck = verifyProjectionStubScope({
        stub: stubResult.stub,
        proof,
        matchRequest,
        nowMs: service.now(),
    });
    if (!stubCheck.ok) {
        sendJson(response, stubCheck.status || 403, { ok: false, error: stubCheck.error });
        return;
    }
    const catalogResult = resolvePublishedCatalogForMatch({ proof, stub: stubResult.stub, service });
    if (!catalogResult.ok) {
        sendJson(response, catalogResult.status || 409, { ok: false, error: catalogResult.error });
        return;
    }
    const compatibility = verifySharedUnknownCompatibilityForCatalog(catalogResult.catalog);
    if (!compatibility.ok) {
        sendJson(response, 409, {
            ok: false,
            error: 'VISUAL_MATCH_UNKNOWN_COMPATIBILITY_FAILED',
            blockedTypes: compatibility.blockedTypes,
        });
        return;
    }

    const existing = service.bindingStore.getByIdempotencyKey?.(matchRequest.idempotencyKey);
    if (existing?.record) {
        if (!storedBindingMatchesCurrentScope(existing.record, { proof, stub: stubResult.stub, matchRequest })) {
            sendJson(response, 409, { ok: false, error: 'VISUAL_MATCH_IDEMPOTENCY_CONFLICT' });
            return;
        }
        sendJson(response, 200, { ok: true, reused: true, match: createMatchResultFromBinding(existing.record.binding) });
        return;
    }

    const match = createDeterministicVisualMatch({
        matchRequest,
        proof,
        stub: stubResult.stub,
        entity: stubCheck.entity,
        catalog: catalogResult.catalog,
        service,
    });
    if (!match.ok) {
        sendJson(response, match.status || 409, { ok: false, error: match.error });
        return;
    }
    const record = createVisualBindingStoreRecord({
        binding: match.binding,
        projectionReceipt: createVisualProjectionReceipt({
            proof,
            stub: stubResult.stub,
            entity: stubCheck.entity,
            nowMs: service.now(),
        }),
        assetMetadataHash: match.asset.assetMetadataHash,
        retentionScopes: [createActiveReleaseRetentionScope(match.binding)],
        nowMs: service.now(),
    });
    const saved = await service.bindingStore.save(record);
    if (!saved.ok) {
        sendJson(response, saved.status || 409, { ok: false, error: saved.error });
        return;
    }
    sendJson(response, 200, {
        ok: true,
        reused: saved.reused === true,
        match: createMatchResultFromBinding(saved.record.binding),
    });
}

async function sendAssetBytes(response, asset, service, { admin = false } = {}) {
    let record;
    try {
        record = await service.contentStore.get(asset.assetContentSha256);
    } catch {
        sendJson(response, 409, { ok: false, error: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
        return;
    }
    if (!record || sha256Buffer(record.bytes) !== asset.assetContentSha256) {
        sendJson(response, 409, { ok: false, error: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
        return;
    }
    if (record.mime !== asset.canonicalMime || sniffImageMime(record.bytes) !== asset.canonicalMime) {
        sendJson(response, 409, { ok: false, error: 'VISUAL_ASSET_FINAL_MIME_MISMATCH' });
        return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', asset.canonicalMime);
    response.setHeader('Content-Length', String(record.bytes.length));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!admin) {
        response.setHeader('Cache-Control', 'private, max-age=60');
    }
    response.end(record.bytes);
}

async function ensureServiceInitialized(service) {
    if (service.initialized) {
        return;
    }
    if (typeof service.store.load === 'function') {
        await service.store.load();
    }
    if (typeof service.contentStore.load === 'function') {
        await service.contentStore.load();
    }
    if (typeof service.retentionStore.load === 'function') {
        await service.retentionStore.load();
    }
    if (typeof service.nonceStore.load === 'function') {
        await service.nonceStore.load();
    }
    if (typeof service.bindingStore?.load === 'function') {
        await service.bindingStore.load();
    }
    for (const type of ASSET_TYPES) {
        const unknown = createUnknownAsset(type, service.now());
        await service.contentStore.put(unknown.assetContentSha256, TRANSPARENT_PNG_BYTES, unknown.canonicalMime);
        const existing = service.store.getAsset(unknown.assetId, unknown.assetVersion);
        if (existing && !isImmutableUnknownAssetCoherent(existing, type)) {
            throw Object.assign(new Error('VISUAL_ASSET_UNKNOWN_IMMUTABLE'), { code: 'VISUAL_ASSET_UNKNOWN_IMMUTABLE' });
        }
        await service.store.putAsset(existing || unknown);
    }
    await validateBindingRecordsAgainstAssets(service);
    service.initialized = true;
}

function validateUploadRequest(body, dictionary) {
    const keys = ['schemaVersion', 'assetId', 'assetVersion', 'metadata', 'file'];
    const exact = requireExactObject(body, keys);
    if (!exact.ok) return exact;
    if (body.schemaVersion !== UPLOAD_REQUEST_PROTOCOL_VERSION) {
        return fail('VISUAL_ASSET_INVALID_SCHEMA');
    }
    if (!isSafeId(body.assetId) || body.assetId.startsWith('unknown_')) {
        return fail('VISUAL_ASSET_INVALID_SCHEMA');
    }
    if (!isPositiveInteger(body.assetVersion)) {
        return fail('VISUAL_ASSET_INVALID_SCHEMA');
    }
    const metadata = validateUploadMetadata(body.metadata, dictionary);
    if (!metadata.ok) {
        return metadata;
    }
    const fileExact = requireExactObject(body.file, ['bytesBase64', 'mime']);
    if (!fileExact.ok) return fileExact;
    if (!isBase64(body.file.bytesBase64) || body.file.bytesBase64.length > Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 64) {
        return fail('VISUAL_ASSET_SIZE_LIMIT');
    }
    const mime = String(body.file.mime || '').trim().toLowerCase();
    if (mime && !ALLOWED_OUTPUT_MIME.has(mime)) {
        return fail('VISUAL_ASSET_UNSUPPORTED_MIME');
    }
    return {
        ok: true,
        request: {
            schemaVersion: body.schemaVersion,
            assetId: body.assetId,
            assetVersion: body.assetVersion,
            metadata: metadata.metadata,
            file: {
                bytesBase64: body.file.bytesBase64,
                mime,
            },
        },
    };
}

function validateUploadMetadata(metadata, dictionary) {
    const keys = ['schemaVersion', 'assetType', 'role', 'title', 'tagCodes', 'featureCodes', 'licenseCode', 'sourceLabel', 'sourceDigest'];
    const exact = requireExactObject(metadata, keys, { optional: ['sourceLabel', 'sourceDigest'] });
    if (!exact.ok) return exact;
    if (metadata.schemaVersion !== UPLOAD_METADATA_PROTOCOL_VERSION) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    if (!ASSET_TYPE_SET.has(metadata.assetType)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    if (metadata.role !== ROLE_BY_TYPE[metadata.assetType]) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    const title = safeDisplayString(metadata.title, 1, 80);
    if (!title) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    if (!LICENSE_CODES.has(metadata.licenseCode)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    const tagCodes = validateDictionaryCodes(metadata.tagCodes, dictionary);
    if (!tagCodes.ok) return tagCodes;
    const featureCodes = validateDictionaryCodes(metadata.featureCodes, dictionary);
    if (!featureCodes.ok) return featureCodes;
    const sourceLabel = metadata.sourceLabel === undefined ? undefined : safeDisplayString(metadata.sourceLabel, 0, 120);
    if (metadata.sourceLabel !== undefined && sourceLabel === null) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    const sourceDigest = metadata.sourceDigest === undefined ? undefined : String(metadata.sourceDigest);
    if (sourceDigest !== undefined && !isSha256Ref(sourceDigest)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    return {
        ok: true,
        metadata: withoutUndefined({
            schemaVersion: metadata.schemaVersion,
            assetType: metadata.assetType,
            role: metadata.role,
            title,
            tagCodes: tagCodes.codes,
            featureCodes: featureCodes.codes,
            licenseCode: metadata.licenseCode,
            sourceLabel,
            sourceDigest,
        }),
    };
}

function validateDictionaryCodes(value, dictionary) {
    if (!Array.isArray(value) || value.length > 24) return fail('VISUAL_ASSET_DICTIONARY_MISMATCH');
    const set = new Set();
    const allowed = new Set(dictionary.codes);
    const codes = [];
    for (const item of value) {
        if (typeof item !== 'string' || item.length < 1 || item.length > 80 || !/^[a-z0-9][a-z0-9-]*$/.test(item)) {
            return fail('VISUAL_ASSET_DICTIONARY_MISMATCH');
        }
        if (!allowed.has(item) || set.has(item)) {
            return fail('VISUAL_ASSET_DICTIONARY_MISMATCH');
        }
        set.add(item);
        codes.push(item);
    }
    return { ok: true, codes };
}

function validateDecodedImage(decoded, metadata, service, { uploadBytesLength = 0, inputSha256 = '' } = {}) {
    let finalBytes;
    try {
        finalBytes = Buffer.from(decoded?.bytes || []);
    } catch {
        return fail('VISUAL_ASSET_DECODE_FAILED');
    }
    if (decoded?.schemaVersion !== SAFE_IMAGE_DECODER_PROTOCOL_VERSION) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (!safeDisplayString(decoded?.decoderId, 1, 80) || !safeDisplayString(decoded?.decoderVersion, 1, 40)) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (decoded.inputSha256 !== inputSha256 || decoded.outputSha256 !== sha256Buffer(finalBytes)) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (!decoded || finalBytes.length <= 0) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (finalBytes.length > service.maxUploadBytes) return fail('VISUAL_ASSET_SIZE_LIMIT');
    if (!ALLOWED_OUTPUT_MIME.has(decoded.mime)) return fail('VISUAL_ASSET_UNSUPPORTED_MIME');
    if (sniffImageMime(finalBytes) !== decoded.mime) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (!isPositiveInteger(decoded.width) || !isPositiveInteger(decoded.height)) return fail('VISUAL_ASSET_PIXEL_LIMIT');
    const maxDimension = metadata.assetType === 'scene' ? service.maxSceneImageDimension : service.maxSpriteIconImageDimension;
    if (decoded.width > maxDimension || decoded.height > maxDimension) return fail('VISUAL_ASSET_PIXEL_LIMIT');
    if (decoded.width * decoded.height > service.maxDecodedPixels) return fail('VISUAL_ASSET_PIXEL_LIMIT');
    if (Number(decoded.frames || 1) !== 1) return fail('VISUAL_ASSET_UNSUPPORTED_MIME');
    if (decoded.metadataStripped !== true || decoded.hasUnsafeMetadata === true) return fail('VISUAL_ASSET_REENCODE_FAILED');
    if (typeof decoded.compressionRatio !== 'number' || !Number.isFinite(decoded.compressionRatio) || decoded.compressionRatio <= 0 || decoded.compressionRatio > service.maxCompressionRatio) {
        return fail('VISUAL_ASSET_SIZE_LIMIT');
    }
    if (uploadBytesLength > 0) {
        const expansionRatio = finalBytes.length / uploadBytesLength;
        if (!Number.isFinite(expansionRatio) || expansionRatio <= 0 || expansionRatio > service.maxCompressionRatio) return fail('VISUAL_ASSET_SIZE_LIMIT');
    }
    if (metadata.assetType === 'character' && (decoded.hasAlpha !== true || decoded.hasTransparentPixel !== true)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    if (metadata.assetType === 'scene') {
        if (decoded.width < 320 || decoded.height < 180) return fail('VISUAL_ASSET_PIXEL_LIMIT');
        if (decoded.width / decoded.height < 1 || decoded.width / decoded.height > 4) return fail('VISUAL_ASSET_PIXEL_LIMIT');
    }
    if (metadata.role === 'icon') {
        const ratio = decoded.width / decoded.height;
        if (decoded.width < 32 || decoded.height < 32 || ratio < 0.5 || ratio > 2) return fail('VISUAL_ASSET_PIXEL_LIMIT');
    }
    return { ok: true };
}

function decodeAndSanitizePng(inputBytes, mime, { metadata = {}, limits = {} } = {}) {
    if (mime !== 'image/png' || !inputBytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw Object.assign(new Error('VISUAL_ASSET_UNSUPPORTED_MIME'), { code: 'VISUAL_ASSET_UNSUPPORTED_MIME' });
    }
    let offset = PNG_SIGNATURE.length;
    let ihdr = null;
    let sawIdat = false;
    let sawIend = false;
    let idatEnded = false;
    let layout = null;
    const idatChunks = [];
    while (offset < inputBytes.length) {
        if (offset + 12 > inputBytes.length) {
            throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
        }
        const length = inputBytes.readUInt32BE(offset);
        const type = inputBytes.subarray(offset + 4, offset + 8).toString('ascii');
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const crcEnd = dataEnd + 4;
        if (!/^[A-Za-z]{4}$/.test(type) || dataEnd > inputBytes.length || crcEnd > inputBytes.length) {
            throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
        }
        const expectedCrc = inputBytes.readUInt32BE(dataEnd);
        const actualCrc = crc32(inputBytes.subarray(offset + 4, dataEnd));
        if (expectedCrc !== actualCrc) {
            throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
        }
        const data = inputBytes.subarray(dataStart, dataEnd);
        if (PNG_APNG_CHUNKS.has(type)) {
            throw Object.assign(new Error('VISUAL_ASSET_UNSUPPORTED_MIME'), { code: 'VISUAL_ASSET_UNSUPPORTED_MIME' });
        }
        if (type === 'IHDR') {
            if (ihdr || length !== 13) {
                throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
            }
            ihdr = parsePngIhdr(data);
            layout = validatePngDecodeBudget(ihdr, metadata, limits);
        } else if (type === 'IDAT') {
            if (!ihdr || sawIend || idatEnded) throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
            sawIdat = true;
            idatChunks.push(Buffer.from(data));
        } else if (type === 'IEND') {
            if (!ihdr || !sawIdat || sawIend || length !== 0) {
                throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
            }
            sawIend = true;
            offset = crcEnd;
            break;
        } else if (PNG_METADATA_CHUNKS.has(type)) {
            if (sawIdat) idatEnded = true;
        } else if (isPngCriticalChunk(type) || isPngAncillaryChunk(type)) {
            throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
        }
        offset = crcEnd;
    }
    if (!ihdr || !sawIdat || !sawIend || offset !== inputBytes.length) {
        throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
    }
    const decoded = decodePngPixels(ihdr, Buffer.concat(idatChunks), layout);
    const outputBytes = encodeCanonicalPng(ihdr, decoded.pixels);
    const decodedBytes = estimatePngDecodedBytes(ihdr);
    return {
        schemaVersion: SAFE_IMAGE_DECODER_PROTOCOL_VERSION,
        decoderId: 'builtin-png-safe-stripper',
        decoderVersion: '1',
        inputSha256: sha256Buffer(inputBytes),
        outputSha256: sha256Buffer(outputBytes),
        bytes: outputBytes,
        mime: 'image/png',
        width: ihdr.width,
        height: ihdr.height,
        hasAlpha: ihdr.colorType === 6,
        hasTransparentPixel: decoded.hasTransparentPixel,
        frames: 1,
        metadataStripped: true,
        hasUnsafeMetadata: false,
        compressionRatio: Math.max(decodedBytes / Math.max(outputBytes.length, 1), 0.000001),
    };
}

function parsePngIhdr(data) {
    const width = data.readUInt32BE(0);
    const height = data.readUInt32BE(4);
    const bitDepth = data[8];
    const colorType = data[9];
    const compression = data[10];
    const filter = data[11];
    const interlace = data[12];
    if (!isPositiveInteger(width) || !isPositiveInteger(height) || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
    }
    if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
    }
    return { width, height, bitDepth, colorType };
}

function estimatePngDecodedBytes({ width, height, bitDepth, colorType }) {
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType] || 4;
    const bytesPerSample = bitDepth <= 8 ? 1 : 2;
    return width * height * channels * bytesPerSample;
}

function validatePngDecodeBudget(ihdr, metadata, limits) {
    const maxDecodedPixels = readPositiveLimit(limits.maxDecodedPixels, MAX_DECODED_PIXELS);
    const maxSceneImageDimension = readPositiveLimit(limits.maxSceneImageDimension, MAX_SCENE_IMAGE_DIMENSION);
    const maxSpriteIconImageDimension = readPositiveLimit(limits.maxSpriteIconImageDimension, MAX_SPRITE_ICON_IMAGE_DIMENSION);
    const maxDimension = metadata?.assetType === 'scene' ? maxSceneImageDimension : maxSpriteIconImageDimension;
    if (ihdr.width > maxDimension || ihdr.height > maxDimension) {
        throw Object.assign(new Error('VISUAL_ASSET_PIXEL_LIMIT'), { code: 'VISUAL_ASSET_PIXEL_LIMIT' });
    }
    const pixelCount = safeMultiplyPositiveIntegers(ihdr.width, ihdr.height);
    if (!pixelCount || pixelCount > maxDecodedPixels) {
        throw Object.assign(new Error('VISUAL_ASSET_PIXEL_LIMIT'), { code: 'VISUAL_ASSET_PIXEL_LIMIT' });
    }
    const bytesPerPixel = ihdr.colorType === 6 ? 4 : 3;
    const rowBytes = safeMultiplyPositiveIntegers(ihdr.width, bytesPerPixel);
    const rowWithFilterBytes = rowBytes ? safeAddPositiveIntegers(rowBytes, 1) : null;
    const expectedInflatedLength = rowWithFilterBytes ? safeMultiplyPositiveIntegers(ihdr.height, rowWithFilterBytes) : null;
    const maxDecodedBytes = safeMultiplyPositiveIntegers(maxDecodedPixels, 4);
    const maxInflatedBytes = maxDecodedBytes ? safeAddPositiveIntegers(maxDecodedBytes, maxSceneImageDimension) : null;
    if (!rowBytes || !rowWithFilterBytes || !expectedInflatedLength || !maxInflatedBytes || expectedInflatedLength > maxInflatedBytes) {
        throw Object.assign(new Error('VISUAL_ASSET_SIZE_LIMIT'), { code: 'VISUAL_ASSET_SIZE_LIMIT' });
    }
    return {
        bytesPerPixel,
        rowBytes,
        expectedInflatedLength,
        decodedBytes: pixelCount * bytesPerPixel,
    };
}

function readPositiveLimit(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function safeMultiplyPositiveIntegers(left, right) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left <= 0 || right <= 0) return null;
    const value = left * right;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function safeAddPositiveIntegers(left, right) {
    if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left <= 0 || right <= 0) return null;
    const value = left + right;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function isPngCriticalChunk(type) {
    return type[0] >= 'A' && type[0] <= 'Z';
}

function isPngAncillaryChunk(type) {
    return type[0] >= 'a' && type[0] <= 'z';
}

function decodePngPixels(ihdr, compressedBytes, layout) {
    let inflated;
    try {
        inflated = inflateSync(compressedBytes, { maxOutputLength: layout.expectedInflatedLength });
    } catch {
        throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
    }
    const { bytesPerPixel, rowBytes, expectedInflatedLength } = layout;
    if (inflated.length !== expectedInflatedLength) {
        throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
    }
    const pixels = Buffer.alloc(ihdr.height * rowBytes);
    let hasTransparentPixel = false;
    let sourceOffset = 0;
    for (let rowIndex = 0; rowIndex < ihdr.height; rowIndex += 1) {
        const filterType = inflated[sourceOffset];
        sourceOffset += 1;
        if (filterType < 0 || filterType > 4) {
            throw Object.assign(new Error('VISUAL_ASSET_DECODE_FAILED'), { code: 'VISUAL_ASSET_DECODE_FAILED' });
        }
        const rowStart = rowIndex * rowBytes;
        const previousRowStart = rowIndex > 0 ? rowStart - rowBytes : -1;
        for (let byteIndex = 0; byteIndex < rowBytes; byteIndex += 1) {
            const raw = inflated[sourceOffset + byteIndex];
            const left = byteIndex >= bytesPerPixel ? pixels[rowStart + byteIndex - bytesPerPixel] : 0;
            const up = previousRowStart >= 0 ? pixels[previousRowStart + byteIndex] : 0;
            const upLeft = previousRowStart >= 0 && byteIndex >= bytesPerPixel ? pixels[previousRowStart + byteIndex - bytesPerPixel] : 0;
            pixels[rowStart + byteIndex] = unfilterPngByte(filterType, raw, left, up, upLeft);
        }
        if (ihdr.colorType === 6) {
            for (let byteIndex = 3; byteIndex < rowBytes; byteIndex += 4) {
                if (pixels[rowStart + byteIndex] < 255) {
                    hasTransparentPixel = true;
                    break;
                }
            }
        }
        sourceOffset += rowBytes;
    }
    return { pixels, hasTransparentPixel };
}

function unfilterPngByte(filterType, raw, left, up, upLeft) {
    if (filterType === 0) return raw;
    if (filterType === 1) return (raw + left) & 0xff;
    if (filterType === 2) return (raw + up) & 0xff;
    if (filterType === 3) return (raw + Math.floor((left + up) / 2)) & 0xff;
    return (raw + paethPredictor(left, up, upLeft)) & 0xff;
}

function paethPredictor(left, up, upLeft) {
    const p = left + up - upLeft;
    const pa = Math.abs(p - left);
    const pb = Math.abs(p - up);
    const pc = Math.abs(p - upLeft);
    if (pa <= pb && pa <= pc) return left;
    if (pb <= pc) return up;
    return upLeft;
}

function encodeCanonicalPng(ihdr, pixels) {
    const bytesPerPixel = ihdr.colorType === 6 ? 4 : 3;
    const rowBytes = ihdr.width * bytesPerPixel;
    const scanlines = Buffer.alloc(ihdr.height * (rowBytes + 1));
    for (let rowIndex = 0; rowIndex < ihdr.height; rowIndex += 1) {
        const sourceStart = rowIndex * rowBytes;
        const targetStart = rowIndex * (rowBytes + 1);
        scanlines[targetStart] = 0;
        pixels.copy(scanlines, targetStart + 1, sourceStart, sourceStart + rowBytes);
    }
    const ihdrBytes = Buffer.alloc(13);
    ihdrBytes.writeUInt32BE(ihdr.width, 0);
    ihdrBytes.writeUInt32BE(ihdr.height, 4);
    ihdrBytes[8] = 8;
    ihdrBytes[9] = ihdr.colorType;
    ihdrBytes[10] = 0;
    ihdrBytes[11] = 0;
    ihdrBytes[12] = 0;
    return Buffer.concat([
        PNG_SIGNATURE,
        createPngChunk('IHDR', ihdrBytes),
        createPngChunk('IDAT', deflateSync(scanlines)),
        createPngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function createPngChunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const body = Buffer.from(data || []);
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    typeBytes.copy(out, 4);
    body.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length);
    return out;
}

function validateCatalogDraftRequest(body) {
    const exact = requireExactObject(body, ['schemaVersion', 'catalogId', 'revision', 'assetRefs']);
    if (!exact.ok) return exact;
    if (body.schemaVersion !== CATALOG_DRAFT_REQUEST_PROTOCOL_VERSION) return fail('VISUAL_CATALOG_INVALID');
    if (!isSafeId(body.catalogId) || !isPositiveInteger(body.revision)) return fail('VISUAL_CATALOG_INVALID');
    if (!Array.isArray(body.assetRefs) || body.assetRefs.length > 256) return fail('VISUAL_CATALOG_INVALID');
    const refs = [];
    for (const item of body.assetRefs) {
        const ref = validateAssetRef(item);
        if (!ref.ok) return ref;
        refs.push(ref.ref);
    }
    return {
        ok: true,
        request: {
            catalogId: body.catalogId,
            revision: body.revision,
            assetRefs: refs,
        },
    };
}

function validateAssetRef(item) {
    const exact = requireExactObject(item, ['assetId', 'assetVersion', 'assetType', 'assetContentSha256', 'assetMetadataHash']);
    if (!exact.ok) return exact;
    if (!isSafeId(item.assetId) || !isPositiveInteger(item.assetVersion) || !ASSET_TYPE_SET.has(item.assetType) || !isSha256Ref(item.assetContentSha256) || !isSha256Ref(item.assetMetadataHash)) {
        return fail('VISUAL_CATALOG_INVALID');
    }
    return {
        ok: true,
        ref: {
            assetId: item.assetId,
            assetVersion: item.assetVersion,
            assetType: item.assetType,
            assetContentSha256: item.assetContentSha256,
            assetMetadataHash: item.assetMetadataHash,
        },
    };
}

async function validateCatalogIntegrity(catalog, service) {
    const unknownTypes = new Set();
    for (const ref of catalog.assetRefs) {
        const asset = service.store.getAsset(ref.assetId, ref.assetVersion);
        if (!asset) return fail('VISUAL_CATALOG_INVALID');
        if (asset.assetType !== ref.assetType || asset.assetContentSha256 !== ref.assetContentSha256 || asset.assetMetadataHash !== ref.assetMetadataHash) return fail('VISUAL_CATALOG_INVALID');
        let record;
        try {
            record = await service.contentStore.get(asset.assetContentSha256);
        } catch {
            return fail('VISUAL_ASSET_FINAL_HASH_MISMATCH');
        }
        if (!record || sha256Buffer(record.bytes) !== asset.assetContentSha256) return fail('VISUAL_ASSET_FINAL_HASH_MISMATCH');
        if (record.mime !== asset.canonicalMime || sniffImageMime(record.bytes) !== asset.canonicalMime) return fail('VISUAL_ASSET_FINAL_MIME_MISMATCH');
        if (asset.assetId.startsWith('unknown_')) {
            if (!isImmutableUnknownAssetCoherent(asset, asset.assetType)) return fail('VISUAL_ASSET_UNKNOWN_IMMUTABLE');
            unknownTypes.add(asset.assetType);
        }
    }
    for (const type of ASSET_TYPES) {
        if (!unknownTypes.has(type)) return fail('VISUAL_ASSET_UNKNOWN_IMMUTABLE');
    }
    return { ok: true };
}

export function verifyVisualAssetReadProof(token, {
    proofSecrets = {},
    now = () => Date.now(),
    nonceStore = new MemoryNonceStore(now),
} = {}) {
    if (!token) return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_REQUIRED' };
    if (typeof token !== 'string' || Buffer.byteLength(token, 'ascii') > MAX_PROOF_TOKEN_BYTES) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'gvarp1') {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    const [prefix, payloadSegment, signatureSegment] = parts;
    if (!isBase64UrlNoPadding(payloadSegment) || !isBase64UrlNoPadding(signatureSegment) || signatureSegment.length !== 43) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    let payloadBytes;
    try {
        payloadBytes = base64UrlDecode(payloadSegment);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    if (payloadBytes.length <= 0 || payloadBytes.length > MAX_PROOF_PAYLOAD_BYTES) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    const payloadJson = payloadBytes.toString('utf8');
    if (Buffer.from(payloadJson, 'utf8').compare(payloadBytes) !== 0) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    try {
        assertNoDuplicateJsonKeys(payloadJson);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_NON_CANONICAL' };
    }
    let payload;
    try {
        payload = JSON.parse(payloadJson);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    const validation = validateReadProofPayload(payload, { now });
    if (!validation.ok) {
        return { ok: false, status: validation.status || 400, error: validation.error };
    }
    const canonical = canonicalJson(payload);
    if (canonical !== payloadJson) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_NON_CANONICAL' };
    }
    const secret = proofSecrets[payload.keyId];
    if (!secret) {
        return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_UNKNOWN_KEY' };
    }
    const expected = base64UrlEncode(createHmac('sha256', secret).update(`${prefix}.${payloadSegment}`).digest());
    if (!safeEqual(signatureSegment, expected)) {
        return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_INVALID_SIGNATURE' };
    }
    const nonceResult = nonceStore.consume(`${payload.keyId}:${payload.nonce}:${payload.audience}:${payload.purpose}`, Date.parse(payload.expiresAt));
    if (!nonceResult.ok) {
        return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_REPLAYED' };
    }
    return { ok: true, payload };
}

function validateReadProofPayload(payload, { now = () => Date.now() } = {}) {
    const exact = requireExactObject(payload, ['schemaVersion', 'audience', 'purpose', 'issuer', 'keyId', 'algorithm', 'issuedAt', 'expiresAt', 'nonce', 'release', 'profile', 'catalog', 'asset', 'oldSave'], { optional: ['oldSave'] });
    if (!exact.ok) return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    if (payload.schemaVersion !== READ_PROOF_PROTOCOL_VERSION) return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    if (payload.audience !== 'visual-asset-service') return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_WRONG_AUDIENCE' };
    if (payload.purpose !== 'asset-read') return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_WRONG_PURPOSE' };
    if (payload.issuer !== 'game-config-service' && payload.issuer !== 'approved-visual-proof-issuer') return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_UNKNOWN_KEY' };
    if (payload.algorithm !== 'HMAC-SHA256') return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_UNKNOWN_KEY' };
    if (!isSafeTokenId(payload.keyId, 64) || !/^[A-Za-z0-9_-]{16,96}$/.test(payload.nonce)) return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    if (!isIsoTimestamp(payload.issuedAt) || !isIsoTimestamp(payload.expiresAt)) return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    const issuedAtMs = Date.parse(payload.issuedAt);
    const expiresAtMs = Date.parse(payload.expiresAt);
    const nowMs = now();
    if (expiresAtMs <= issuedAtMs || expiresAtMs - issuedAtMs > 300000 || issuedAtMs - nowMs > 60000) {
        return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_EXPIRED' };
    }
    if (expiresAtMs <= nowMs) return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_EXPIRED' };
    const release = validateReleaseScope(payload.release);
    if (!release.ok) return release;
    const profile = validateProfileScope(payload.profile);
    if (!profile.ok) return profile;
    const catalog = validateCatalogScope(payload.catalog);
    if (!catalog.ok) return catalog;
    const asset = validateProofAssetScope(payload.asset);
    if (!asset.ok) return asset;
    if (payload.oldSave !== undefined) {
        const oldSave = requireExactObject(payload.oldSave, ['saveIdHash', 'saveBindingHash']);
        if (!oldSave.ok || !isSha256Ref(payload.oldSave.saveIdHash) || !isSha256Ref(payload.oldSave.saveBindingHash)) {
            return { ok: false, status: 401, error: 'VISUAL_ASSET_READ_PROOF_OLD_SAVE_UNAUTHORIZED' };
        }
    }
    return { ok: true };
}

function validateReleaseScope(value) {
    const exact = requireExactObject(value, ['releaseId', 'scenarioId', 'scenarioVersion', 'arcId']);
    if (!exact.ok) return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    if (![value.releaseId, value.scenarioId, value.scenarioVersion, value.arcId].every((item) => isSafeId(item))) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    return { ok: true };
}

function validateProfileScope(value) {
    const exact = requireExactObject(value, ['visualProfileId', 'profileHash']);
    if (!exact.ok || !isSafeId(value.visualProfileId) || !isSha256Ref(value.profileHash)) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    return { ok: true };
}

function validateCatalogScope(value) {
    const exact = requireExactObject(value, ['catalogId', 'catalogRevision', 'catalogHash']);
    if (!exact.ok || !isSafeId(value.catalogId) || !isPositiveInteger(value.catalogRevision) || !isSha256Ref(value.catalogHash)) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    return { ok: true };
}

function validateProofAssetScope(value) {
    const exact = requireExactObject(value, ['assetId', 'assetVersion', 'assetContentSha256']);
    if (!exact.ok || !isSafeId(value.assetId) || !isPositiveInteger(value.assetVersion) || !isSha256Ref(value.assetContentSha256)) {
        return { ok: false, status: 400, error: 'VISUAL_ASSET_READ_PROOF_MALFORMED' };
    }
    return { ok: true };
}

function validateVisualMatchRequest(body) {
    const exact = requireExactObject(body, ['schemaVersion', 'projectionId', 'entityKey', 'entityType', 'idempotencyKey']);
    if (!exact.ok) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    if (body.schemaVersion !== VISUAL_MATCH_REQUEST_PROTOCOL_VERSION) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    if (!PROJECTION_ID_PATTERN.test(String(body.projectionId || ''))) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    if (!ENTITY_KEY_PATTERN.test(String(body.entityKey || ''))) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    if (!ASSET_TYPE_SET.has(body.entityType)) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    if (!IDEMPOTENCY_KEY_PATTERN.test(String(body.idempotencyKey || ''))) return fail('VISUAL_MATCH_INVALID_SCHEMA');
    return {
        ok: true,
        request: {
            schemaVersion: body.schemaVersion,
            projectionId: body.projectionId,
            entityKey: body.entityKey,
            entityType: body.entityType,
            idempotencyKey: body.idempotencyKey,
        },
    };
}

export function verifyVisualProjectionProofToken(token, {
    projectionSecret = '',
    now = () => Date.now(),
} = {}) {
    if (!token) return { ok: false, status: 401, error: 'VISUAL_MATCH_PROJECTION_PROOF_REQUIRED' };
    if (!projectionSecret) return { ok: false, status: 503, error: 'VISUAL_MATCH_PROOF_VERIFIER_UNCONFIGURED' };
    if (typeof token !== 'string' || Buffer.byteLength(token, 'ascii') > MAX_VISUAL_MATCH_PROOF_BYTES || !isBase64UrlNoPadding(token)) {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    }
    let proofBytes;
    try {
        proofBytes = base64UrlDecode(token);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    }
    if (proofBytes.length <= 0 || proofBytes.length > MAX_VISUAL_MATCH_PROOF_BYTES) {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    }
    const proofJson = proofBytes.toString('utf8');
    if (Buffer.from(proofJson, 'utf8').compare(proofBytes) !== 0) {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    }
    try {
        assertNoDuplicateJsonKeys(proofJson);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_NON_CANONICAL' };
    }
    let proof;
    try {
        proof = JSON.parse(proofJson);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    }
    const shape = validateVisualProjectionProofShape(proof);
    if (!shape.valid) return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_MALFORMED' };
    let canonical;
    try {
        canonical = canonicalJson(proof);
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_NON_CANONICAL' };
    }
    if (canonical !== proofJson) {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_NON_CANONICAL' };
    }
    if (proof.audience !== 'visual-asset-service') return { ok: false, status: 401, error: 'VISUAL_MATCH_PROJECTION_PROOF_WRONG_AUDIENCE' };
    if (proof.purpose !== 'visual-match') return { ok: false, status: 401, error: 'VISUAL_MATCH_PROJECTION_PROOF_WRONG_PURPOSE' };
    const nowMs = now();
    const issuedAtMs = Date.parse(proof.issuedAt);
    const expiresAtMs = Date.parse(proof.expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs || issuedAtMs - nowMs > 60000 || expiresAtMs - issuedAtMs > 300000) {
        return { ok: false, status: 401, error: 'VISUAL_MATCH_PROJECTION_PROOF_EXPIRED' };
    }
    const unsigned = { ...proof, signature: '' };
    let expected;
    try {
        expected = createHmac('sha256', projectionSecret).update(canonicalJson(unsigned)).digest('base64url');
    } catch {
        return { ok: false, status: 400, error: 'VISUAL_MATCH_PROJECTION_PROOF_NON_CANONICAL' };
    }
    if (!safeEqual(proof.signature, expected)) {
        return { ok: false, status: 401, error: 'VISUAL_MATCH_PROJECTION_PROOF_INVALID_SIGNATURE' };
    }
    return { ok: true, proof };
}

async function readVerifiedProjectionStub(projectionId, service) {
    let stub = null;
    if (typeof service.projectionStubReader === 'function') {
        const result = await service.projectionStubReader({ projectionId });
        if (result && result.ok === false) {
            return { ok: false, status: result.status || 503, error: result.error || 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
        }
        stub = result?.stub || result || null;
    } else if (service.projectionStubBaseUrl && service.projectionStubServiceToken) {
        const result = await fetchProjectionStubViaHttp(projectionId, service);
        if (!result.ok) return result;
        stub = result.stub;
    } else {
        return { ok: false, status: 503, error: 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
    }
    const validation = validateVisualProjectionStub(stub);
    if (!validation.valid) return { ok: false, status: 409, error: 'VISUAL_MATCH_PROJECTION_STUB_INVALID' };
    return { ok: true, stub };
}

async function fetchProjectionStubViaHttp(projectionId, service) {
    if (typeof service.projectionStubFetch !== 'function') {
        return { ok: false, status: 503, error: 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
    }
    let response;
    try {
        const endpoint = new URL(`/v1/visual/projection-stubs/${encodeURIComponent(projectionId)}`, service.projectionStubBaseUrl);
        response = await service.projectionStubFetch(endpoint, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${service.projectionStubServiceToken}`,
                Accept: 'application/json',
            },
        });
    } catch {
        return { ok: false, status: 503, error: 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
    }
    if (!response || response.status < 200 || response.status >= 300) {
        return { ok: false, status: 503, error: 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
    }
    let stub;
    try {
        stub = await response.json();
    } catch {
        return { ok: false, status: 503, error: 'VISUAL_MATCH_PROJECTION_STUB_READER_UNAVAILABLE' };
    }
    return { ok: true, stub };
}

function verifyProjectionStubScope({ stub, proof, matchRequest, nowMs }) {
    const fields = [
        'projectionId',
        'projectionHash',
        'sourceMessageHash',
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'chatId',
        'profileHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'sourceMessageIndex',
        'extractorVersion',
        'dictionaryVersion',
        'dictionaryHash',
        'expiresAt',
    ];
    for (const field of fields) {
        if (stub[field] !== proof[field]) {
            return failStatus(403, 'VISUAL_MATCH_SCOPE_MISMATCH');
        }
    }
    if (stub.profileId !== proof.profileId) return failStatus(403, 'VISUAL_MATCH_SCOPE_MISMATCH');
    if (matchRequest.projectionId !== stub.projectionId) return failStatus(403, 'VISUAL_MATCH_SCOPE_MISMATCH');
    if (Date.parse(stub.expiresAt) <= nowMs) return failStatus(401, 'VISUAL_MATCH_PROJECTION_STUB_EXPIRED');
    const seen = new Set();
    let entity = null;
    for (const item of stub.entities || []) {
        if (!ASSET_TYPE_SET.has(item.entityType)) return failStatus(409, 'VISUAL_MATCH_PROJECTION_STUB_INVALID');
        if (seen.has(item.entityKey)) return failStatus(409, 'VISUAL_MATCH_PROJECTION_STUB_INVALID');
        seen.add(item.entityKey);
        if (item.entityKey === matchRequest.entityKey && item.entityType === matchRequest.entityType) {
            entity = item;
        }
    }
    if (!entity) return failStatus(403, 'VISUAL_MATCH_ENTITY_NOT_IN_PROJECTION');
    return { ok: true, entity };
}

function resolvePublishedCatalogForMatch({ proof, stub, service }) {
    const catalog = service.store.getCatalog(proof.catalogId, proof.catalogRevision);
    if (!catalog || catalog.status !== 'published') return failStatus(404, 'VISUAL_MATCH_CATALOG_UNAVAILABLE');
    if (catalog.catalogHash !== proof.catalogHash || catalog.catalogHash !== stub.catalogHash) return failStatus(403, 'VISUAL_MATCH_SCOPE_MISMATCH');
    if (catalog.dictionaryVersion !== proof.dictionaryVersion || catalog.dictionaryHash !== proof.dictionaryHash) return failStatus(403, 'VISUAL_MATCH_SCOPE_MISMATCH');
    return { ok: true, catalog };
}

function verifySharedUnknownCompatibilityForCatalog(catalog) {
    const blockedTypes = [];
    for (const type of ASSET_TYPES) {
        const shared = IMMUTABLE_UNKNOWN_VISUAL_ASSETS[type];
        const ref = catalog.assetRefs.find((item) => item.assetId === `unknown_${type}` && item.assetType === type);
        if (!shared || !ref || ref.assetVersion !== shared.assetVersion || ref.assetContentSha256 !== toSha256Ref(shared.assetContentSha256)) {
            blockedTypes.push(type);
        }
    }
    return blockedTypes.length ? { ok: false, blockedTypes } : { ok: true, blockedTypes: [] };
}

function createDeterministicVisualMatch({ matchRequest, proof, stub, entity, catalog, service }) {
    const candidates = [];
    for (const ref of catalog.assetRefs) {
        if (ref.assetType !== matchRequest.entityType) continue;
        const asset = service.store.getAsset(ref.assetId, ref.assetVersion);
        if (!asset || asset.status !== 'published') continue;
        if (asset.assetType !== ref.assetType || asset.assetContentSha256 !== ref.assetContentSha256 || asset.assetMetadataHash !== ref.assetMetadataHash) continue;
        candidates.push({ ref, asset, score: scoreAssetForEntity(asset, entity) });
    }
    candidates.sort((left, right) => right.score - left.score || `${left.asset.assetId}:${left.asset.assetVersion}`.localeCompare(`${right.asset.assetId}:${right.asset.assetVersion}`));
    const best = candidates[0] || null;
    const policy = applyVisualScorePolicy({
        type: matchRequest.entityType,
        score: best ? best.score : 0,
        confidenceBand: entity.confidenceBand || 'unknown',
        candidateCount: candidates.length,
        hasExplicitVisibleLabel: Boolean(entity.displayLabel),
        hasExplicitAppearanceEvidence: Boolean((entity.visibleAttributes || []).some((attribute) => String(attribute?.code || '').startsWith('character-explicit-'))),
        reasonCodes: best ? ['type-match', ...(best.score > 45 ? ['tag-overlap'] : [])] : ['candidate-empty'],
    });
    if (!policy.ok) return failStatus(409, 'VISUAL_MATCH_SCORE_POLICY_INVALID');
    const selectedRef = policy.isUnknown ? policy.assetRef : {
        assetId: best.asset.assetId,
        assetVersion: best.asset.assetVersion,
        type: best.asset.assetType,
        assetContentSha256: toPlainSha256(best.asset.assetContentSha256),
    };
    const asset = policy.isUnknown ? service.store.getAsset(selectedRef.assetId, selectedRef.assetVersion) : best.asset;
    if (!asset) return failStatus(409, 'VISUAL_MATCH_ASSET_UNAVAILABLE');
    const nowIso = new Date(service.now()).toISOString();
    const binding = withoutUndefined({
        schemaVersion: VISUAL_BINDING_PROTOCOL_VERSION,
        bindingId: createStableId('vb', { matchRequest, projectionHash: stub.projectionHash, assetId: asset.assetId, assetVersion: asset.assetVersion }),
        bindingType: matchRequest.entityType,
        entityKey: matchRequest.entityKey,
        releaseId: proof.releaseId,
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatId: proof.chatId,
        sourceMessageIndex: proof.sourceMessageIndex,
        sourceMessageHash: proof.sourceMessageHash,
        evidenceDigest: stub.projectionHash,
        projectionId: proof.projectionId,
        visualProfileId: proof.profileId,
        profileHash: proof.profileHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        assetContentSha256: toPlainSha256(asset.assetContentSha256),
        matcherVersion: VISUAL_MATCHER_VERSION,
        scorerVersion: VISUAL_SCORER_VERSION,
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
        score: policy.score,
        scoreBand: scoreBandForScore(policy.score),
        reasonCodes: policy.reasonCodes.length ? policy.reasonCodes : ['unknown-fallback'],
        bindingPolicy: bindingPolicyForType(matchRequest.entityType, policy.isUnknown),
        idempotencyKey: matchRequest.idempotencyKey,
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt: matchRequest.entityType === 'scene' ? new Date(service.now() + 5 * 60 * 1000).toISOString() : undefined,
    });
    const validation = validateVisualBinding(binding);
    if (!validation.valid) return failStatus(409, 'VISUAL_MATCH_BINDING_INVALID');
    return { ok: true, binding, asset };
}

function scoreAssetForEntity(asset, entity) {
    let score = 25;
    const labelTokens = tokenizeVisualText(entity.displayLabel);
    const assetTokens = new Set([
        ...tokenizeVisualText(asset.title),
        ...(asset.tagCodes || []).flatMap(tokenizeVisualText),
        ...(asset.featureCodes || []).flatMap(tokenizeVisualText),
    ]);
    for (const token of labelTokens) {
        if (assetTokens.has(token)) score += 15;
    }
    for (const attribute of entity.visibleAttributes || []) {
        const code = attribute?.code;
        if ((asset.tagCodes || []).includes(code) || (asset.featureCodes || []).includes(code)) score += 20;
    }
    return Math.max(0, Math.min(100, score));
}

function tokenizeVisualText(value) {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9\u3400-\u9fff]+/u)
        .filter((token) => token.length >= 2 && token.length <= 32);
}

function createVisualProjectionReceipt({ proof, stub, entity, nowMs }) {
    return {
        schemaVersion: PROJECTION_RECEIPT_RECORD_VERSION,
        projectionId: proof.projectionId,
        projectionHash: proof.projectionHash,
        releaseId: proof.releaseId,
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatId: proof.chatId,
        visualProfileId: proof.profileId,
        profileHash: proof.profileHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
        extractorVersion: proof.extractorVersion,
        sourceMessageIndex: proof.sourceMessageIndex,
        sourceMessageHash: proof.sourceMessageHash,
        entityKey: entity.entityKey,
        entityType: entity.entityType,
        proofNonceHash: sha256Hex(proof.nonce),
        proofIssuedAt: proof.issuedAt,
        proofExpiresAt: proof.expiresAt,
        receiptCreatedAt: new Date(nowMs).toISOString(),
    };
}

function createVisualBindingStoreRecord({ binding, projectionReceipt, assetMetadataHash, retentionScopes, nowMs }) {
    const record = {
        schemaVersion: BINDING_RECORD_VERSION,
        binding,
        bindingHash: sha256Hex(canonicalJson(binding)),
        projectionReceipt,
        projectionReceiptHash: sha256Hex(canonicalJson(projectionReceipt)),
        assetMetadataHash,
        retentionScopes,
        storageCreatedAt: new Date(nowMs).toISOString(),
        storageUpdatedAt: new Date(nowMs).toISOString(),
    };
    const validation = validateVisualBindingStoreRecord(record);
    if (!validation.ok) {
        throw Object.assign(new Error(validation.error), { code: validation.error });
    }
    return validation.record;
}

export function validateVisualProjectionReceipt(record) {
    const exact = requireExactObject(record, [
        'schemaVersion',
        'projectionId',
        'projectionHash',
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'chatId',
        'visualProfileId',
        'profileHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'dictionaryVersion',
        'dictionaryHash',
        'extractorVersion',
        'sourceMessageIndex',
        'sourceMessageHash',
        'entityKey',
        'entityType',
        'proofNonceHash',
        'proofIssuedAt',
        'proofExpiresAt',
        'receiptCreatedAt',
    ]);
    if (!exact.ok) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (record.schemaVersion !== PROJECTION_RECEIPT_RECORD_VERSION) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!PROJECTION_ID_PATTERN.test(record.projectionId) || !isSha256Ref(record.projectionHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (![record.releaseId, record.scenarioId, record.scenarioVersion, record.arcId, record.chatId].every((value) => isSafeId(value))) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!/^vprof_[a-z0-9_-]{8,80}$/.test(record.visualProfileId) || !isSha256Ref(record.profileHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!/^vc_[a-z0-9_-]{8,80}$/.test(record.catalogId) || !isPositiveInteger(record.catalogRevision) || !isSha256Ref(record.catalogHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!isSafeId(record.dictionaryVersion) || !isSha256Ref(record.dictionaryHash) || !isSafeId(record.extractorVersion)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!Number.isInteger(record.sourceMessageIndex) || record.sourceMessageIndex < 0 || !isSha256Ref(record.sourceMessageHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!ENTITY_KEY_PATTERN.test(record.entityKey) || !ASSET_TYPE_SET.has(record.entityType) || !isSha256Ref(record.proofNonceHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (![record.proofIssuedAt, record.proofExpiresAt, record.receiptCreatedAt].every(isIsoTimestamp)) return fail('VISUAL_BINDING_RECORD_INVALID');
    return { ok: true, record };
}

export function validateVisualBindingStoreRecord(record) {
    const exact = requireExactObject(record, [
        'schemaVersion',
        'binding',
        'bindingHash',
        'projectionReceipt',
        'projectionReceiptHash',
        'assetMetadataHash',
        'retentionScopes',
        'storageCreatedAt',
        'storageUpdatedAt',
    ]);
    if (!exact.ok || record.schemaVersion !== BINDING_RECORD_VERSION) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!isSha256Ref(record.bindingHash) || !isSha256Ref(record.projectionReceiptHash) || !isSha256Ref(record.assetMetadataHash)) return fail('VISUAL_BINDING_RECORD_INVALID');
    const bindingValidation = validateVisualBinding(record.binding);
    if (!bindingValidation.valid) return fail('VISUAL_BINDING_RECORD_INVALID');
    const receiptValidation = validateVisualProjectionReceipt(record.projectionReceipt);
    if (!receiptValidation.ok) return receiptValidation;
    if (sha256Hex(canonicalJson(record.binding)) !== record.bindingHash) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (sha256Hex(canonicalJson(record.projectionReceipt)) !== record.projectionReceiptHash) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!retentionScopesValid(record.retentionScopes)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (![record.storageCreatedAt, record.storageUpdatedAt].every(isIsoTimestamp)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (!bindingReceiptScopesMatch(record.binding, record.projectionReceipt)) return fail('VISUAL_BINDING_RECORD_INVALID');
    if (Buffer.byteLength(canonicalJson(record), 'utf8') > 64 * 1024) return fail('VISUAL_BINDING_RECORD_INVALID');
    return { ok: true, record };
}

function retentionScopesValid(scopes) {
    if (!Array.isArray(scopes) || scopes.length < 1 || scopes.length > 32) return false;
    const seen = new Set();
    for (const scope of scopes) {
        const exact = requireExactObject(scope, ['kind', 'scopeId', 'scopeHash', 'expiresAt'], { optional: ['expiresAt'] });
        if (!exact.ok) return false;
        if (!['active-release', 'rollback-target', 'approved-old-save'].includes(scope.kind)) return false;
        if (!isSafeScopeId(scope.scopeId) || !isSha256Ref(scope.scopeHash)) return false;
        if (scope.expiresAt !== undefined && !isIsoTimestamp(scope.expiresAt)) return false;
        const key = `${scope.kind}:${scope.scopeId}:${scope.scopeHash}`;
        if (seen.has(key)) return false;
        seen.add(key);
    }
    return true;
}

function bindingReceiptScopesMatch(binding, receipt) {
    return binding.projectionId === receipt.projectionId
        && binding.releaseId === receipt.releaseId
        && binding.scenarioId === receipt.scenarioId
        && binding.scenarioVersion === receipt.scenarioVersion
        && binding.arcId === receipt.arcId
        && binding.chatId === receipt.chatId
        && binding.visualProfileId === receipt.visualProfileId
        && binding.profileHash === receipt.profileHash
        && binding.catalogId === receipt.catalogId
        && binding.catalogRevision === receipt.catalogRevision
        && binding.catalogHash === receipt.catalogHash
        && binding.dictionaryVersion === receipt.dictionaryVersion
        && binding.dictionaryHash === receipt.dictionaryHash
        && binding.sourceMessageIndex === receipt.sourceMessageIndex
        && binding.sourceMessageHash === receipt.sourceMessageHash
        && binding.entityKey === receipt.entityKey
        && binding.bindingType === receipt.entityType;
}

function storedBindingMatchesCurrentScope(record, { proof, stub, matchRequest }) {
    const binding = record?.binding;
    const receipt = record?.projectionReceipt;
    return Boolean(binding && receipt
        && binding.idempotencyKey === matchRequest.idempotencyKey
        && binding.entityKey === matchRequest.entityKey
        && binding.bindingType === matchRequest.entityType
        && receipt.entityKey === matchRequest.entityKey
        && receipt.entityType === matchRequest.entityType
        && receipt.projectionId === proof.projectionId
        && receipt.projectionHash === proof.projectionHash
        && receipt.sourceMessageHash === proof.sourceMessageHash
        && receipt.releaseId === proof.releaseId
        && receipt.scenarioId === proof.scenarioId
        && receipt.scenarioVersion === proof.scenarioVersion
        && receipt.arcId === proof.arcId
        && receipt.chatId === proof.chatId
        && receipt.visualProfileId === proof.profileId
        && receipt.profileHash === proof.profileHash
        && receipt.catalogId === proof.catalogId
        && receipt.catalogRevision === proof.catalogRevision
        && receipt.catalogHash === proof.catalogHash
        && receipt.dictionaryVersion === proof.dictionaryVersion
        && receipt.dictionaryHash === proof.dictionaryHash
        && receipt.sourceMessageIndex === proof.sourceMessageIndex
        && stub.projectionId === proof.projectionId
        && stub.projectionHash === proof.projectionHash);
}

function createMatchResultFromBinding(binding) {
    const result = {
        schemaVersion: VISUAL_MATCH_RESULT_PROTOCOL_VERSION,
        matchId: createStableId('vm', {
            bindingId: binding.bindingId,
            projectionId: binding.projectionId,
            assetId: binding.assetId,
            assetVersion: binding.assetVersion,
        }),
        bindingId: binding.bindingId,
        entityKey: binding.entityKey,
        type: binding.bindingType,
        catalogId: binding.catalogId,
        catalogRevision: binding.catalogRevision,
        catalogHash: binding.catalogHash,
        visualProfileId: binding.visualProfileId,
        profileHash: binding.profileHash,
        evidenceDigest: binding.evidenceDigest,
        projectionId: binding.projectionId,
        sourceMessageIndex: binding.sourceMessageIndex,
        sourceMessageHash: binding.sourceMessageHash,
        assetId: binding.assetId,
        assetVersion: binding.assetVersion,
        assetContentSha256: binding.assetContentSha256,
        matcherVersion: binding.matcherVersion,
        scorerVersion: binding.scorerVersion,
        dictionaryVersion: binding.dictionaryVersion,
        dictionaryHash: binding.dictionaryHash,
        score: binding.score,
        scoreBand: binding.scoreBand,
        reasonCodes: binding.reasonCodes,
        usesLlm: false,
        createdAt: binding.createdAt,
        expiresAt: binding.expiresAt,
    };
    const validation = validateVisualMatchResult(result);
    if (!validation.valid) {
        throw Object.assign(new Error('VISUAL_MATCH_RESULT_INVALID'), { code: 'VISUAL_MATCH_RESULT_INVALID' });
    }
    return result;
}

function createActiveReleaseRetentionScope(binding) {
    return {
        kind: 'active-release',
        scopeId: `${binding.releaseId}:${binding.arcId}:${binding.chatId}`,
        scopeHash: sha256Hex(canonicalJson({
            releaseId: binding.releaseId,
            scenarioId: binding.scenarioId,
            scenarioVersion: binding.scenarioVersion,
            arcId: binding.arcId,
            chatId: binding.chatId,
            projectionId: binding.projectionId,
            bindingId: binding.bindingId,
        })),
    };
}

function validateBindingRecordsAgainstAssets(service) {
    if (typeof service.bindingStore?.allRecords !== 'function') return Promise.resolve();
    for (const record of service.bindingStore.allRecords()) {
        const asset = service.store.getAsset(record.binding.assetId, record.binding.assetVersion);
        if (!asset || asset.assetMetadataHash !== record.assetMetadataHash || toPlainSha256(asset.assetContentSha256) !== record.binding.assetContentSha256) {
            throw Object.assign(new Error('VISUAL_BINDING_RECORD_INVALID'), { code: 'VISUAL_BINDING_RECORD_INVALID' });
        }
    }
    return Promise.resolve();
}

function createStableId(prefix, scope) {
    return `${prefix}_${createHash('sha256').update(canonicalJson(scope)).digest('hex').slice(0, 24)}`;
}

function scoreBandForScore(score) {
    if (score < 20) return 'unknown';
    if (score < 45) return 'low';
    if (score < 75) return 'medium';
    return 'high';
}

function bindingPolicyForType(type, isUnknown) {
    if (isUnknown) return 'unknown';
    if (type === 'scene') return 'scene-ttl';
    if (type === 'character') return 'session-fixed';
    return 'entity-first-seen-fixed';
}

function toPlainSha256(value) {
    if (isSha256Ref(value)) return value.slice('sha256:'.length);
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value;
    return '';
}

function toSha256Ref(value) {
    if (isSha256Ref(value)) return value;
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return `sha256:${value}`;
    return '';
}

function failStatus(status, error) {
    return { ok: false, status, error };
}

function requireAdminOrigin(request, allowedOrigins) {
    const origin = String(request.headers.origin || '').trim();
    if (!origin) return { ok: true };
    if (!allowedOrigins.length || !allowedOrigins.includes(origin)) {
        return { ok: false, status: 403, error: 'VISUAL_ASSET_ORIGIN_REJECTED' };
    }
    return { ok: true };
}

function requirePlayerOrigin(request, allowedOrigins) {
    const origin = String(request.headers.origin || '').trim();
    if (origin) {
        if (!allowedOrigins.length || !allowedOrigins.includes(origin)) {
            return { ok: false, status: 403, error: 'VISUAL_ASSET_PLAYER_ORIGIN_REJECTED' };
        }
        return { ok: true };
    }
    if (isBrowserLikeRequest(request)) {
        return { ok: false, status: 403, error: 'VISUAL_ASSET_PLAYER_ORIGIN_REJECTED' };
    }
    return { ok: true };
}

function handlePlayerPreflight(request, response, service) {
    const origin = String(request.headers.origin || '').trim();
    const requestedMethod = String(request.headers['access-control-request-method'] || '').trim().toUpperCase();
    const requestedHeaders = parseHeaderList(request.headers['access-control-request-headers']);
    const allowedHeaders = new Set(['x-galgame-visual-asset-proof', 'content-type', 'accept']);
    const headersOk = requestedHeaders.every((header) => allowedHeaders.has(header));
    const ok = origin && service.playerOrigins.includes(origin) && requestedMethod === 'GET' && headersOk;
    response.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    if (!ok) {
        sendJson(response, 403, {
            ok: false,
            error: 'VISUAL_ASSET_PLAYER_PREFLIGHT_REJECTED',
        });
        return;
    }
    response.statusCode = 204;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET');
    response.setHeader('Access-Control-Allow-Headers', 'X-Galgame-Visual-Asset-Proof, Content-Type, Accept');
    response.setHeader('Access-Control-Max-Age', '300');
    response.end();
}

function handleVisualMatchPreflight(request, response, service) {
    const origin = String(request.headers.origin || '').trim();
    const requestedMethod = String(request.headers['access-control-request-method'] || '').trim().toUpperCase();
    const requestedHeaders = parseHeaderList(request.headers['access-control-request-headers']);
    const allowedHeaders = new Set(['x-galgame-visual-projection-proof', 'content-type', 'accept']);
    const headersOk = requestedHeaders.every((header) => allowedHeaders.has(header));
    const ok = origin && service.playerOrigins.includes(origin) && requestedMethod === 'POST' && headersOk;
    response.setHeader('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
    if (!ok) {
        sendJson(response, 403, {
            ok: false,
            error: 'VISUAL_MATCH_PLAYER_PREFLIGHT_REJECTED',
        });
        return;
    }
    response.statusCode = 204;
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST');
    response.setHeader('Access-Control-Allow-Headers', 'X-Galgame-Visual-Projection-Proof, Content-Type, Accept');
    response.setHeader('Access-Control-Max-Age', '300');
    response.end();
}

function authorizeAdminRequest(request, adminToken) {
    if (!adminToken) {
        return { ok: false, status: 503, error: 'VISUAL_ASSET_AUTH_REQUIRED' };
    }
    const auth = String(request.headers.authorization || '');
    const prefix = 'Bearer ';
    if (!auth.startsWith(prefix) || !safeEqual(auth.slice(prefix.length), adminToken)) {
        return {
            ok: false,
            status: 401,
            error: 'VISUAL_ASSET_AUTH_REQUIRED',
            headers: { 'WWW-Authenticate': 'Bearer realm="visual-asset-service"' },
        };
    }
    return { ok: true };
}

function hasForbiddenProofTransport(request) {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.search) return true;
    if (request.headers.cookie || request.headers.referer) {
        const combined = `${request.headers.cookie || ''} ${request.headers.referer || ''}`;
        if (/gvarp1\.|visual.*proof/i.test(combined)) return true;
    }
    return false;
}

function hasForbiddenVisualMatchProofTransport(request) {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.search) return true;
    if (request.headers.cookie || request.headers.referer) {
        const combined = `${request.headers.cookie || ''} ${request.headers.referer || ''}`;
        if (/visual.*projection.*proof|projection.*proof|signature|nonce_/i.test(combined)) return true;
    }
    return false;
}

function isPlayerAssetContentPath(pathname) {
    return /^\/v1\/assets\/[^/]+\/[^/]+\/[^/]+\/[^/]+\/content$/.test(pathname);
}

function isBrowserLikeRequest(request) {
    return Boolean(request.headers['sec-fetch-mode'] || request.headers['sec-fetch-site'] || request.headers['sec-fetch-dest']);
}

function parseHeaderList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
}

function normalizeBaseUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return '';
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        url.pathname = url.pathname.replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function serializeAdminAsset(asset) {
    return withoutUndefined({
        schemaVersion: ADMIN_ASSET_RESPONSE_VERSION,
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
        rawUploadSha256: asset.rawUploadSha256,
        assetContentSha256: asset.assetContentSha256,
        assetMetadataHash: asset.assetMetadataHash,
        canonicalMime: asset.canonicalMime,
        width: asset.width,
        height: asset.height,
        status: asset.status,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt,
    });
}

function serializePlayerPublishedAsset(asset, catalog) {
    return {
        schemaVersion: PLAYER_ASSET_RESPONSE_VERSION,
        catalogId: catalog.catalogId,
        catalogRevision: catalog.revision,
        catalogHash: catalog.catalogHash,
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        assetType: asset.assetType,
        role: asset.role,
        title: asset.title,
        tagCodes: asset.tagCodes,
        featureCodes: asset.featureCodes,
        dictionaryVersion: asset.dictionaryVersion,
        dictionaryHash: asset.dictionaryHash,
        assetContentSha256: asset.assetContentSha256,
        canonicalMime: asset.canonicalMime,
        width: asset.width,
        height: asset.height,
        assetUri: `/v1/assets/${encodeURIComponent(catalog.catalogId)}/${catalog.revision}/${encodeURIComponent(asset.assetId)}/${asset.assetVersion}/content`,
    };
}

function serializeCatalog(catalog) {
    return {
        schemaVersion: catalog.schemaVersion,
        catalogId: catalog.catalogId,
        revision: catalog.revision,
        status: catalog.status,
        dictionaryVersion: catalog.dictionaryVersion,
        dictionaryHash: catalog.dictionaryHash,
        catalogHash: catalog.catalogHash,
        assetRefs: catalog.assetRefs,
        createdAt: catalog.createdAt,
        updatedAt: catalog.updatedAt,
        archivedAt: catalog.archivedAt,
    };
}

function createUnknownAsset(type, nowMs) {
    const hash = sha256Buffer(TRANSPARENT_PNG_BYTES);
    const nowIso = new Date(nowMs).toISOString();
    const base = {
        assetId: `unknown_${type}`,
        assetVersion: 1,
        assetType: type,
        role: ROLE_BY_TYPE[type],
        title: 'Unknown visual',
        tagCodes: ['unknown-generic'],
        featureCodes: [],
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DEFAULT_DICTIONARY_HASH,
        licenseCode: 'user-owned',
        assetContentSha256: hash,
        canonicalMime: 'image/png',
        width: 1,
        height: 1,
    };
    return {
        ...base,
        rawUploadSha256: undefined,
        assetMetadataHash: sha256Hex(canonicalJson(base)),
        status: 'published',
        createdAt: nowIso,
        updatedAt: nowIso,
        serviceOwned: true,
    };
}

function getUnknownAssetRef(type) {
    if (!ASSET_TYPE_SET.has(type)) {
        throw new Error('VISUAL_ASSET_INVALID_SCHEMA');
    }
    const unknown = createUnknownAsset(type, Date.parse('2026-01-01T00:00:00.000Z'));
    return {
        assetId: unknown.assetId,
        assetVersion: unknown.assetVersion,
        assetType: unknown.assetType,
        assetContentSha256: unknown.assetContentSha256,
        assetMetadataHash: unknown.assetMetadataHash,
    };
}

function isImmutableUnknownAssetCoherent(asset, type = asset?.assetType) {
    if (!ASSET_TYPE_SET.has(type)) return false;
    const expected = createUnknownAsset(type, Date.parse(asset?.createdAt || '2026-01-01T00:00:00.000Z'));
    return asset?.assetId === expected.assetId
        && asset.assetVersion === expected.assetVersion
        && asset.assetType === expected.assetType
        && asset.role === expected.role
        && asset.title === expected.title
        && JSON.stringify(asset.tagCodes) === JSON.stringify(expected.tagCodes)
        && JSON.stringify(asset.featureCodes) === JSON.stringify(expected.featureCodes)
        && asset.dictionaryVersion === expected.dictionaryVersion
        && asset.dictionaryHash === expected.dictionaryHash
        && asset.licenseCode === expected.licenseCode
        && asset.assetContentSha256 === expected.assetContentSha256
        && asset.assetMetadataHash === expected.assetMetadataHash
        && asset.canonicalMime === expected.canonicalMime
        && asset.width === expected.width
        && asset.height === expected.height
        && asset.status === 'published'
        && asset.serviceOwned === true
        && asset.rawUploadSha256 === undefined
        && asset.sourceLabel === undefined
        && asset.sourceDigest === undefined
        && isIsoTimestamp(asset.createdAt)
        && asset.updatedAt === asset.createdAt;
}

function uniqueAssetRefs(refs) {
    const seen = new Set();
    const result = [];
    for (const ref of refs) {
        const key = `${ref.assetId}:${ref.assetVersion}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(ref);
    }
    return result;
}

function computeCatalogHash(catalog, dictionary) {
    return sha256Hex(canonicalJson({
        schemaVersion: catalog.schemaVersion,
        catalogId: catalog.catalogId,
        revision: catalog.revision,
        dictionaryVersion: dictionary.dictionaryVersion,
        dictionaryHash: dictionary.dictionaryHash,
        assetRefs: catalog.assetRefs
            .map((ref) => ({
                assetId: ref.assetId,
                assetVersion: ref.assetVersion,
                assetType: ref.assetType,
                assetContentSha256: ref.assetContentSha256,
                assetMetadataHash: ref.assetMetadataHash,
            }))
            .sort((left, right) => `${left.assetId}:${left.assetVersion}`.localeCompare(`${right.assetId}:${right.assetVersion}`)),
    }));
}

function freezeDictionary(dictionary, dictionaryHash) {
    const codes = Array.isArray(dictionary?.codes) ? [...dictionary.codes] : DEFAULT_DICTIONARY_CODES;
    return Object.freeze({
        dictionaryVersion: dictionary?.dictionaryVersion || DICTIONARY_VERSION,
        dictionaryHash: dictionaryHash || sha256Hex(canonicalJson({ schemaVersion: dictionary?.dictionaryVersion || DICTIONARY_VERSION, codes })),
        codes,
    });
}

export class MemoryVisualAssetStore {
    constructor() {
        this.kind = 'memory';
        this.assets = new Map();
        this.catalogs = new Map();
    }

    getAsset(assetId, assetVersion) {
        return this.assets.get(assetKey(assetId, assetVersion)) || null;
    }

    putAsset(asset) {
        this.assets.set(assetKey(asset.assetId, asset.assetVersion), asset);
    }

    getCatalog(catalogId, revision) {
        return this.catalogs.get(catalogKey(catalogId, revision)) || null;
    }

    putCatalog(catalog) {
        this.catalogs.set(catalogKey(catalog.catalogId, catalog.revision), catalog);
    }
}

export class FileVisualAssetStore {
    constructor(rootDir = path.join(DEFAULT_STORE_DIR, 'catalog'), {
        dictionary = DEFAULT_DICTIONARY,
        dictionaryHash = DEFAULT_DICTIONARY_HASH,
    } = {}) {
        this.kind = 'file';
        this.rootDir = rootDir;
        this.assets = new Map();
        this.catalogs = new Map();
        this.loaded = false;
        this.dictionary = freezeDictionary(dictionary, dictionaryHash);
    }

    async load() {
        if (this.loaded) return;
        await mkdir(path.join(this.rootDir, 'assets'), { recursive: true });
        await mkdir(path.join(this.rootDir, 'catalogs'), { recursive: true });
        await loadJsonRecords(path.join(this.rootDir, 'assets'), (record) => {
            const validation = validateStoredAssetRecord(record, this.dictionary);
            if (!validation.ok) {
                throw Object.assign(new Error(validation.error), { code: validation.error });
            }
            if (this.assets.has(assetKey(validation.asset.assetId, validation.asset.assetVersion))) {
                throw Object.assign(new Error('VISUAL_ASSET_METADATA_INVALID'), { code: 'VISUAL_ASSET_METADATA_INVALID' });
            }
            this.assets.set(assetKey(validation.asset.assetId, validation.asset.assetVersion), validation.asset);
        });
        await loadJsonRecords(path.join(this.rootDir, 'catalogs'), (record) => {
            const validation = validateStoredCatalogRecord(record, this.dictionary);
            if (!validation.ok) {
                throw Object.assign(new Error(validation.error), { code: validation.error });
            }
            if (this.catalogs.has(catalogKey(validation.catalog.catalogId, validation.catalog.revision))) {
                throw Object.assign(new Error('VISUAL_ASSET_METADATA_INVALID'), { code: 'VISUAL_ASSET_METADATA_INVALID' });
            }
            this.catalogs.set(catalogKey(validation.catalog.catalogId, validation.catalog.revision), validation.catalog);
        });
        this.loaded = true;
    }

    getAsset(assetId, assetVersion) {
        return this.assets.get(assetKey(assetId, assetVersion)) || null;
    }

    async putAsset(asset) {
        const validation = validateStoredAssetRecord({
            schemaVersion: METADATA_RECORD_VERSION,
            kind: 'asset',
            asset,
        }, this.dictionary);
        if (!validation.ok) {
            throw Object.assign(new Error(validation.error), { code: validation.error });
        }
        const storedAsset = validation.asset;
        await atomicWriteJson(this.assetPath(storedAsset.assetId, storedAsset.assetVersion), {
            schemaVersion: METADATA_RECORD_VERSION,
            kind: 'asset',
            asset: storedAsset,
        });
        this.assets.set(assetKey(storedAsset.assetId, storedAsset.assetVersion), storedAsset);
    }

    getCatalog(catalogId, revision) {
        return this.catalogs.get(catalogKey(catalogId, revision)) || null;
    }

    async putCatalog(catalog) {
        const validation = validateStoredCatalogRecord({
            schemaVersion: METADATA_RECORD_VERSION,
            kind: 'catalog',
            catalog,
        }, this.dictionary);
        if (!validation.ok) {
            throw Object.assign(new Error(validation.error), { code: validation.error });
        }
        const storedCatalog = validation.catalog;
        await atomicWriteJson(this.catalogPath(storedCatalog.catalogId, storedCatalog.revision), {
            schemaVersion: METADATA_RECORD_VERSION,
            kind: 'catalog',
            catalog: storedCatalog,
        });
        this.catalogs.set(catalogKey(storedCatalog.catalogId, storedCatalog.revision), storedCatalog);
    }

    assetPath(assetId, assetVersion) {
        return path.join(this.rootDir, 'assets', `${assetId}--${assetVersion}.json`);
    }

    catalogPath(catalogId, revision) {
        return path.join(this.rootDir, 'catalogs', `${catalogId}--${revision}.json`);
    }
}

export class MemoryContentStore {
    constructor() {
        this.kind = 'memory';
        this.records = new Map();
    }

    async put(hash, bytes, mime) {
        const existing = this.records.get(hash);
        const body = Buffer.from(bytes);
        if (existing && !existing.bytes.equals(body)) {
            throw Object.assign(new Error('VISUAL_ASSET_HASH_CONFLICT'), { code: 'VISUAL_ASSET_HASH_CONFLICT' });
        }
        this.records.set(hash, { bytes: body, mime });
    }

    async get(hash) {
        const record = this.records.get(hash);
        return record ? { bytes: Buffer.from(record.bytes), mime: record.mime } : null;
    }

    peek(hash) {
        const record = this.records.get(hash);
        return record ? { bytes: Buffer.from(record.bytes), mime: record.mime } : null;
    }

    tamper(hash, bytes) {
        const record = this.records.get(hash);
        if (record) {
            this.records.set(hash, { ...record, bytes: Buffer.from(bytes) });
        }
    }

    tamperMime(hash, mime) {
        const record = this.records.get(hash);
        if (record) {
            this.records.set(hash, { ...record, mime });
        }
    }
}

export class FileContentStore {
    constructor(rootDir = path.join(DEFAULT_STORE_DIR, 'assets')) {
        this.kind = 'file';
        this.rootDir = rootDir;
    }

    async put(hash, bytes, mime) {
        assertSafeSha256(hash);
        const finalPath = this.pathForHash(hash);
        await mkdir(path.dirname(finalPath), { recursive: true });
        const body = Buffer.from(bytes);
        if (sha256Buffer(body) !== hash || sniffImageMime(body) !== mime || !ALLOWED_OUTPUT_MIME.has(mime)) {
            throw Object.assign(new Error('VISUAL_ASSET_FINAL_HASH_MISMATCH'), { code: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
        }
        const record = {
            schemaVersion: CONTENT_RECORD_VERSION,
            hash,
            mime,
            bytesBase64: body.toString('base64'),
        };
        try {
            const existing = await this.get(hash);
            if (!existing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
            if (!existing.bytes.equals(body) || existing.mime !== mime) {
                throw Object.assign(new Error('VISUAL_ASSET_HASH_CONFLICT'), { code: 'VISUAL_ASSET_HASH_CONFLICT' });
            }
            return;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await atomicWriteJson(finalPath, record);
    }

    async get(hash) {
        assertSafeSha256(hash);
        try {
            const parsed = JSON.parse(await readFile(this.pathForHash(hash), 'utf8'));
            const exact = requireExactObject(parsed, ['schemaVersion', 'hash', 'mime', 'bytesBase64']);
            if (!exact.ok || parsed.schemaVersion !== CONTENT_RECORD_VERSION || parsed.hash !== hash || !ALLOWED_OUTPUT_MIME.has(parsed.mime) || !isBase64(parsed.bytesBase64)) {
                throw Object.assign(new Error('VISUAL_ASSET_FINAL_HASH_MISMATCH'), { code: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
            }
            const bytes = Buffer.from(parsed.bytesBase64, 'base64');
            if (sha256Buffer(bytes) !== hash) {
                throw Object.assign(new Error('VISUAL_ASSET_FINAL_HASH_MISMATCH'), { code: 'VISUAL_ASSET_FINAL_HASH_MISMATCH' });
            }
            return { bytes, mime: parsed.mime };
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    pathForHash(hash) {
        const hex = hash.slice('sha256:'.length);
        return path.join(this.rootDir, hex.slice(0, 2), `${hex}.json`);
    }
}

export class MemoryVisualAssetRetentionStore {
    constructor(now = () => Date.now()) {
        this.kind = 'memory-retention';
        this.now = now;
        this.records = new Map();
    }

    grantOldSaveRead(record) {
        const validation = validateRetentionRecord(record);
        if (!validation.ok) {
            throw Object.assign(new Error(validation.error), { code: validation.error });
        }
        this.records.set(retentionKey(validation.record), validation.record);
    }

    verifyOldSaveRead({ release, profile, oldSave, catalog, asset, nowMs = this.now() }) {
        const record = this.records.get(retentionKey({ release, profile, oldSave, catalog, asset }));
        if (!record) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_REQUIRED');
        if (Date.parse(record.expiresAt) <= nowMs) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_EXPIRED');
        return { ok: true };
    }
}

export class FileVisualAssetRetentionStore {
    constructor(rootDir = path.join(DEFAULT_STORE_DIR, 'retention'), now = () => Date.now()) {
        this.kind = 'file-retention';
        this.rootDir = rootDir;
        this.now = now;
        this.records = new Map();
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;
        await mkdir(this.rootDir, { recursive: true });
        await loadJsonRecords(this.rootDir, async (record, fullPath) => {
            const validation = validateStoredRetentionRecord(record);
            if (!validation.ok) {
                throw Object.assign(new Error(validation.error), { code: validation.error });
            }
            if (Date.parse(validation.record.expiresAt) <= this.now()) {
                await unlink(fullPath).catch(() => {});
                return;
            }
            this.records.set(retentionKey(validation.record), validation.record);
        });
        this.loaded = true;
    }

    async grantOldSaveRead(record) {
        const validation = validateRetentionRecord(record);
        if (!validation.ok) {
            throw Object.assign(new Error(validation.error), { code: validation.error });
        }
        const storedRecord = validation.record;
        await atomicWriteJson(this.retentionPath(storedRecord), {
            schemaVersion: RETENTION_RECORD_VERSION,
            kind: 'retention',
            retention: storedRecord,
        });
        this.records.set(retentionKey(storedRecord), storedRecord);
    }

    verifyOldSaveRead({ release, profile, oldSave, catalog, asset, nowMs = this.now() }) {
        const record = this.records.get(retentionKey({ release, profile, oldSave, catalog, asset }));
        if (!record) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_REQUIRED');
        if (Date.parse(record.expiresAt) <= nowMs) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_EXPIRED');
        return { ok: true };
    }

    retentionPath(record) {
        const hex = sha256Hex(retentionKey(record)).slice('sha256:'.length);
        return path.join(this.rootDir, `${hex}.json`);
    }
}

async function loadJsonRecords(rootDir, onRecord) {
    let entries = [];
    try {
        entries = await readdir(rootDir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const fullPath = path.join(rootDir, entry.name);
        try {
            await onRecord(JSON.parse(await readFile(fullPath, 'utf8')), fullPath);
        } catch (error) {
            if (typeof error?.code === 'string' && error.code.startsWith('VISUAL_')) throw error;
            throw Object.assign(new Error('VISUAL_ASSET_METADATA_INVALID'), { code: 'VISUAL_ASSET_METADATA_INVALID' });
        }
    }
}

async function atomicWriteJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomNonce()}.tmp`;
    const json = `${JSON.stringify(value)}\n`;
    await writeFile(tempPath, json, { encoding: 'utf8' });
    await rename(tempPath, filePath);
}

function validateStoredAssetRecord(record, dictionary = DEFAULT_DICTIONARY) {
    const recordExact = requireExactObject(record, ['schemaVersion', 'kind', 'asset']);
    if (!recordExact.ok || record.schemaVersion !== METADATA_RECORD_VERSION || record.kind !== 'asset') return fail('VISUAL_ASSET_METADATA_INVALID');
    const optional = ['sourceLabel', 'sourceDigest', 'rawUploadSha256', 'serviceOwned'];
    const exact = requireExactObject(record.asset, [
        'assetId',
        'assetVersion',
        'assetType',
        'role',
        'title',
        'tagCodes',
        'featureCodes',
        'dictionaryVersion',
        'dictionaryHash',
        'licenseCode',
        'assetContentSha256',
        'assetMetadataHash',
        'canonicalMime',
        'width',
        'height',
        'status',
        'createdAt',
        'updatedAt',
        ...optional,
    ], { optional });
    if (!exact.ok) return fail('VISUAL_ASSET_METADATA_INVALID');
    const asset = record.asset;
    if (!isSafeId(asset.assetId) || !isPositiveInteger(asset.assetVersion) || !ASSET_TYPE_SET.has(asset.assetType)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.role !== ROLE_BY_TYPE[asset.assetType] || !safeDisplayString(asset.title, 1, 80)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!LICENSE_CODES.has(asset.licenseCode)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.sourceLabel !== undefined && safeDisplayString(asset.sourceLabel, 0, 120) === null) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.sourceDigest !== undefined && !isSha256Ref(asset.sourceDigest)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!Array.isArray(asset.tagCodes) || !Array.isArray(asset.featureCodes)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!isSha256Ref(asset.dictionaryHash) || !isSha256Ref(asset.assetContentSha256) || !isSha256Ref(asset.assetMetadataHash)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.rawUploadSha256 !== undefined && !isSha256Ref(asset.rawUploadSha256)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!ALLOWED_OUTPUT_MIME.has(asset.canonicalMime) || !isPositiveInteger(asset.width) || !isPositiveInteger(asset.height)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!['draft', 'published'].includes(asset.status)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!isIsoTimestamp(asset.createdAt) || !isIsoTimestamp(asset.updatedAt)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.serviceOwned !== undefined && typeof asset.serviceOwned !== 'boolean') return fail('VISUAL_ASSET_METADATA_INVALID');
    const normalizedDictionary = freezeDictionary(dictionary, dictionary.dictionaryHash || DEFAULT_DICTIONARY_HASH);
    const tagCodes = validateDictionaryCodes(asset.tagCodes, normalizedDictionary);
    const featureCodes = validateDictionaryCodes(asset.featureCodes, normalizedDictionary);
    if (!tagCodes.ok || !featureCodes.ok) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.dictionaryVersion !== normalizedDictionary.dictionaryVersion || asset.dictionaryHash !== normalizedDictionary.dictionaryHash) return fail('VISUAL_ASSET_METADATA_INVALID');
    const metadataBase = withoutUndefined({
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        assetType: asset.assetType,
        role: asset.role,
        title: asset.title,
        tagCodes: tagCodes.codes,
        featureCodes: featureCodes.codes,
        dictionaryVersion: asset.dictionaryVersion,
        dictionaryHash: asset.dictionaryHash,
        licenseCode: asset.licenseCode,
        sourceLabel: asset.sourceLabel,
        sourceDigest: asset.sourceDigest,
        assetContentSha256: asset.assetContentSha256,
        canonicalMime: asset.canonicalMime,
        width: asset.width,
        height: asset.height,
    });
    if (sha256Hex(canonicalJson(metadataBase)) !== asset.assetMetadataHash) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (asset.assetId.startsWith('unknown_') && !isImmutableUnknownAssetCoherent(asset, asset.assetType)) return fail('VISUAL_ASSET_UNKNOWN_IMMUTABLE');
    return { ok: true, asset: structuredCloneJson(asset) };
}

function validateStoredCatalogRecord(record, dictionary = DEFAULT_DICTIONARY) {
    const recordExact = requireExactObject(record, ['schemaVersion', 'kind', 'catalog']);
    if (!recordExact.ok || record.schemaVersion !== METADATA_RECORD_VERSION || record.kind !== 'catalog') return fail('VISUAL_ASSET_METADATA_INVALID');
    const exact = requireExactObject(record.catalog, ['schemaVersion', 'catalogId', 'revision', 'status', 'dictionaryVersion', 'dictionaryHash', 'assetRefs', 'catalogHash', 'createdAt', 'updatedAt', 'archivedAt']);
    if (!exact.ok) return fail('VISUAL_ASSET_METADATA_INVALID');
    const catalog = record.catalog;
    if (catalog.schemaVersion !== 'galgame.visual-asset-catalog.v1' || !isSafeId(catalog.catalogId) || !isPositiveInteger(catalog.revision)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!['draft', 'validated', 'published', 'archived'].includes(catalog.status)) return fail('VISUAL_ASSET_METADATA_INVALID');
    const normalizedDictionary = freezeDictionary(dictionary, dictionary.dictionaryHash || DEFAULT_DICTIONARY_HASH);
    if (catalog.dictionaryVersion !== normalizedDictionary.dictionaryVersion || catalog.dictionaryHash !== normalizedDictionary.dictionaryHash) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!isSha256Ref(catalog.dictionaryHash)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (catalog.catalogHash !== '' && !isSha256Ref(catalog.catalogHash)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!isIsoTimestamp(catalog.createdAt) || !isIsoTimestamp(catalog.updatedAt)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (catalog.archivedAt !== null && !isIsoTimestamp(catalog.archivedAt)) return fail('VISUAL_ASSET_METADATA_INVALID');
    if (!Array.isArray(catalog.assetRefs) || catalog.assetRefs.length > 512) return fail('VISUAL_ASSET_METADATA_INVALID');
    const refs = [];
    const seen = new Set();
    for (const item of catalog.assetRefs) {
        const ref = validateAssetRef(item);
        if (!ref.ok) return fail('VISUAL_ASSET_METADATA_INVALID');
        const key = `${ref.ref.assetId}:${ref.ref.assetVersion}`;
        if (seen.has(key)) return fail('VISUAL_ASSET_METADATA_INVALID');
        seen.add(key);
        refs.push(ref.ref);
    }
    if (catalog.status !== 'draft') {
        const expectedHash = computeCatalogHash({ ...catalog, assetRefs: refs }, {
            dictionaryVersion: normalizedDictionary.dictionaryVersion,
            dictionaryHash: normalizedDictionary.dictionaryHash,
        });
        if (catalog.catalogHash !== expectedHash) return fail('VISUAL_ASSET_METADATA_INVALID');
    }
    return { ok: true, catalog: { ...structuredCloneJson(catalog), assetRefs: refs } };
}

function validateRetentionRecord(record) {
    const exact = requireExactObject(record, ['release', 'profile', 'oldSave', 'catalog', 'asset', 'expiresAt']);
    if (!exact.ok || !isIsoTimestamp(record.expiresAt)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    const release = requireExactObject(record.release, ['releaseId', 'scenarioId', 'scenarioVersion', 'arcId']);
    const profile = requireExactObject(record.profile, ['visualProfileId', 'profileHash']);
    const oldSave = requireExactObject(record.oldSave, ['saveIdHash', 'saveBindingHash']);
    const catalog = requireExactObject(record.catalog, ['catalogId', 'catalogRevision', 'catalogHash']);
    const asset = requireExactObject(record.asset, ['assetId', 'assetVersion', 'assetContentSha256']);
    if (!release.ok || !profile.ok || !oldSave.ok || !catalog.ok || !asset.ok) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    if (!isSafeId(record.release.releaseId) || !isSafeId(record.release.scenarioId) || !isSafeId(record.release.scenarioVersion) || !isSafeId(record.release.arcId)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    if (!isSafeId(record.profile.visualProfileId) || !isSha256Ref(record.profile.profileHash)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    if (!isSha256Ref(record.oldSave.saveIdHash) || !isSha256Ref(record.oldSave.saveBindingHash)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    if (!isSafeId(record.catalog.catalogId) || !isPositiveInteger(record.catalog.catalogRevision) || !isSha256Ref(record.catalog.catalogHash)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    if (!isSafeId(record.asset.assetId) || !isPositiveInteger(record.asset.assetVersion) || !isSha256Ref(record.asset.assetContentSha256)) return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    return { ok: true, record: structuredCloneJson(record) };
}

function validateStoredRetentionRecord(record) {
    const exact = requireExactObject(record, ['schemaVersion', 'kind', 'retention']);
    if (!exact.ok || record.schemaVersion !== RETENTION_RECORD_VERSION || record.kind !== 'retention') return fail('VISUAL_ASSET_OLD_SAVE_RETENTION_INVALID');
    return validateRetentionRecord(record.retention);
}

function validateStoredNonceRecord(record) {
    const exact = requireExactObject(record, ['schemaVersion', 'kind', 'nonce']);
    if (!exact.ok || record.schemaVersion !== NONCE_RECORD_VERSION || record.kind !== 'nonce') return fail('VISUAL_ASSET_NONCE_STORE_INVALID');
    const nonceExact = requireExactObject(record.nonce, ['keyHash', 'expiresAt']);
    if (!nonceExact.ok || !isSha256Ref(record.nonce.keyHash) || !isIsoTimestamp(record.nonce.expiresAt)) return fail('VISUAL_ASSET_NONCE_STORE_INVALID');
    return { ok: true, record: structuredCloneJson(record.nonce) };
}

function validateStoredVisualBindingStoreRecord(record) {
    const exact = requireExactObject(record, ['schemaVersion', 'kind', 'record']);
    if (!exact.ok || record.schemaVersion !== BINDING_RECORD_VERSION || record.kind !== 'binding') return fail('VISUAL_BINDING_RECORD_INVALID');
    return validateVisualBindingStoreRecord(record.record);
}

function retentionKey({ release, profile, oldSave, catalog, asset }) {
    return [
        release?.releaseId,
        release?.scenarioId,
        release?.scenarioVersion,
        release?.arcId,
        profile?.visualProfileId,
        profile?.profileHash,
        oldSave?.saveIdHash,
        oldSave?.saveBindingHash,
        catalog?.catalogId,
        catalog?.catalogRevision,
        catalog?.catalogHash,
        asset?.assetId,
        asset?.assetVersion,
        asset?.assetContentSha256,
    ].join('|');
}

function structuredCloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export class MemoryQuarantineStore {
    constructor() {
        this.records = new Map();
    }

    async write(bytes) {
        const id = randomNonce();
        this.records.set(id, Buffer.from(bytes));
        return id;
    }

    async discard(id) {
        this.records.delete(id);
    }
}

export class MemoryNonceStore {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.used = new Map();
    }

    consume(key, expiresAtMs) {
        this.cleanup();
        if (this.used.has(key)) return { ok: false };
        this.used.set(key, expiresAtMs + 60000);
        return { ok: true };
    }

    cleanup() {
        const nowMs = this.now();
        for (const [key, expiresAtMs] of this.used.entries()) {
            if (expiresAtMs <= nowMs) this.used.delete(key);
        }
    }
}

export class FileNonceStore {
    constructor(rootDir = path.join(DEFAULT_STORE_DIR, 'nonces'), now = () => Date.now()) {
        this.kind = 'file-nonce';
        this.rootDir = rootDir;
        this.now = now;
        this.used = new Map();
        this.loaded = false;
    }

    async load() {
        this.loadSync();
    }

    loadSync() {
        if (this.loaded) return;
        mkdirSync(this.rootDir, { recursive: true });
        for (const entry of readdirSync(this.rootDir, { withFileTypes: true })) {
            if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
            const fullPath = path.join(this.rootDir, entry.name);
            let parsed;
            try {
                parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
            } catch {
                throw Object.assign(new Error('VISUAL_ASSET_NONCE_STORE_INVALID'), { code: 'VISUAL_ASSET_NONCE_STORE_INVALID' });
            }
            const validation = validateStoredNonceRecord(parsed);
            if (!validation.ok) {
                throw Object.assign(new Error(validation.error), { code: validation.error });
            }
            if (Date.parse(validation.record.expiresAt) <= this.now()) {
                unlinkSync(fullPath);
                continue;
            }
            if (this.used.has(validation.record.keyHash)) {
                throw Object.assign(new Error('VISUAL_ASSET_NONCE_STORE_INVALID'), { code: 'VISUAL_ASSET_NONCE_STORE_INVALID' });
            }
            this.used.set(validation.record.keyHash, {
                expiresAtMs: Date.parse(validation.record.expiresAt),
                path: fullPath,
            });
        }
        this.loaded = true;
    }

    consume(key, expiresAtMs) {
        this.loadSync();
        this.cleanup();
        const keyHash = sha256Hex(key);
        if (this.used.has(keyHash)) return { ok: false };
        const record = {
            schemaVersion: NONCE_RECORD_VERSION,
            kind: 'nonce',
            nonce: {
                keyHash,
                expiresAt: new Date(expiresAtMs + 60000).toISOString(),
            },
        };
        const filePath = this.noncePath(keyHash);
        mkdirSync(path.dirname(filePath), { recursive: true });
        try {
            writeFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' });
        } catch (error) {
            if (error.code === 'EEXIST') return { ok: false };
            throw error;
        }
        this.used.set(keyHash, {
            expiresAtMs: Date.parse(record.nonce.expiresAt),
            path: filePath,
        });
        return { ok: true };
    }

    cleanup() {
        const nowMs = this.now();
        for (const [keyHash, record] of this.used.entries()) {
            if (record.expiresAtMs <= nowMs) {
                this.used.delete(keyHash);
                try {
                    unlinkSync(record.path);
                } catch {}
            }
        }
    }

    noncePath(keyHash) {
        const hex = keyHash.slice('sha256:'.length);
        return path.join(this.rootDir, `${hex}.json`);
    }
}

export class MemoryVisualBindingStore {
    constructor() {
        this.kind = 'memory-binding';
        this.byBindingId = new Map();
        this.byIdempotencyKey = new Map();
    }

    getByIdempotencyKey(idempotencyKey) {
        const record = this.byIdempotencyKey.get(idempotencyKey);
        if (!record) return null;
        return { record };
    }

    async save(record) {
        const validation = validateVisualBindingStoreRecord(record);
        if (!validation.ok) return { ok: false, status: 409, error: validation.error };
        const storedRecord = validation.record;
        const existingByIdempotency = this.getByIdempotencyKey(storedRecord.binding.idempotencyKey);
        if (existingByIdempotency?.record) {
            if (
                existingByIdempotency.record.bindingHash !== storedRecord.bindingHash
                || existingByIdempotency.record.projectionReceiptHash !== storedRecord.projectionReceiptHash
                || existingByIdempotency.record.assetMetadataHash !== storedRecord.assetMetadataHash
            ) {
                return { ok: false, status: 409, error: 'VISUAL_MATCH_IDEMPOTENCY_CONFLICT' };
            }
            return { ok: true, reused: true, record: existingByIdempotency.record };
        }
        const existingByBindingId = this.byBindingId.get(storedRecord.binding.bindingId);
        if (existingByBindingId && existingByBindingId.bindingHash !== storedRecord.bindingHash) {
            return { ok: false, status: 409, error: 'VISUAL_BINDING_CONFLICT' };
        }
        this.byBindingId.set(storedRecord.binding.bindingId, storedRecord);
        this.byIdempotencyKey.set(storedRecord.binding.idempotencyKey, storedRecord);
        return { ok: true, reused: false, record: storedRecord };
    }

    allRecords() {
        return [...this.byBindingId.values()];
    }
}

export class FileVisualBindingStore {
    constructor(rootDir = path.join(DEFAULT_STORE_DIR, 'bindings'), now = () => Date.now()) {
        this.kind = 'file-binding';
        this.rootDir = rootDir;
        this.now = now;
        this.byBindingId = new Map();
        this.byIdempotencyKey = new Map();
        this.loaded = false;
    }

    async load() {
        if (this.loaded) return;
        await mkdir(this.rootDir, { recursive: true });
        await loadJsonRecords(this.rootDir, (record) => {
            const validation = validateStoredVisualBindingStoreRecord(record);
            if (!validation.ok) {
                throw Object.assign(new Error(validation.error), { code: validation.error });
            }
            const storedRecord = validation.record;
            if (this.byBindingId.has(storedRecord.binding.bindingId) || this.byIdempotencyKey.has(storedRecord.binding.idempotencyKey)) {
                throw Object.assign(new Error('VISUAL_BINDING_RECORD_INVALID'), { code: 'VISUAL_BINDING_RECORD_INVALID' });
            }
            this.byBindingId.set(storedRecord.binding.bindingId, storedRecord);
            this.byIdempotencyKey.set(storedRecord.binding.idempotencyKey, storedRecord);
        });
        this.loaded = true;
    }

    getByIdempotencyKey(idempotencyKey) {
        const record = this.byIdempotencyKey.get(idempotencyKey);
        if (!record) return null;
        return { record };
    }

    async save(record) {
        await this.load();
        const validation = validateVisualBindingStoreRecord(record);
        if (!validation.ok) return { ok: false, status: 409, error: validation.error };
        const storedRecord = validation.record;
        const existingByIdempotency = this.getByIdempotencyKey(storedRecord.binding.idempotencyKey);
        if (existingByIdempotency?.record) {
            if (
                existingByIdempotency.record.bindingHash !== storedRecord.bindingHash
                || existingByIdempotency.record.projectionReceiptHash !== storedRecord.projectionReceiptHash
                || existingByIdempotency.record.assetMetadataHash !== storedRecord.assetMetadataHash
            ) {
                return { ok: false, status: 409, error: 'VISUAL_MATCH_IDEMPOTENCY_CONFLICT' };
            }
            return { ok: true, reused: true, record: existingByIdempotency.record };
        }
        const existingByBindingId = this.byBindingId.get(storedRecord.binding.bindingId);
        if (existingByBindingId && existingByBindingId.bindingHash !== storedRecord.bindingHash) {
            return { ok: false, status: 409, error: 'VISUAL_BINDING_CONFLICT' };
        }
        await atomicWriteJson(this.bindingPath(storedRecord.binding.bindingId), {
            schemaVersion: BINDING_RECORD_VERSION,
            kind: 'binding',
            record: storedRecord,
        });
        this.byBindingId.set(storedRecord.binding.bindingId, storedRecord);
        this.byIdempotencyKey.set(storedRecord.binding.idempotencyKey, storedRecord);
        return { ok: true, reused: false, record: storedRecord };
    }

    allRecords() {
        return [...this.byBindingId.values()];
    }

    bindingPath(bindingId) {
        return path.join(this.rootDir, `${bindingId}.json`);
    }
}

function assetKey(assetId, assetVersion) {
    return `${assetId}:${assetVersion}`;
}

function catalogKey(catalogId, revision) {
    return `${catalogId}:${revision}`;
}

function sniffImageMime(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return CANONICAL_MIME_BY_MAGIC.png;
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return CANONICAL_MIME_BY_MAGIC.jpeg;
    }
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return CANONICAL_MIME_BY_MAGIC.webp;
    }
    return '';
}

function createProofKeyRingFromEnv() {
    const keyId = process.env.GALGAME_VISUAL_ASSET_READ_PROOF_KEY_ID || '';
    const secret = process.env.GALGAME_VISUAL_ASSET_READ_PROOF_SECRET || '';
    const previousKeyId = process.env.GALGAME_VISUAL_ASSET_READ_PROOF_PREVIOUS_KEY_ID || '';
    const previousSecret = process.env.GALGAME_VISUAL_ASSET_READ_PROOF_PREVIOUS_SECRET || '';
    const keys = {};
    if (keyId && secret) keys[keyId] = secret;
    if (previousKeyId && previousSecret) keys[previousKeyId] = previousSecret;
    return keys;
}

function requireExactObject(value, keys, { optional = [] } = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    const allowed = new Set(keys);
    const optionalSet = new Set(optional);
    const actual = Object.keys(value);
    for (const key of actual) {
        if (!allowed.has(key)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    }
    for (const key of keys) {
        if (!optionalSet.has(key) && !Object.prototype.hasOwnProperty.call(value, key)) return fail('VISUAL_ASSET_INVALID_SCHEMA');
    }
    return { ok: true };
}

function safeDisplayString(value, minLength, maxLength) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length < minLength || trimmed.length > maxLength) return null;
    if (/[<>]|javascript:|data:|https?:\/\//i.test(trimmed)) return null;
    return trimmed;
}

function isSafeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
}

function isSafeScopeId(value) {
    return typeof value === 'string'
        && value.length >= 1
        && value.length <= 128
        && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
        && !value.includes('://')
        && !value.includes('/')
        && !value.includes('\\');
}

function isSafeTokenId(value, maxLength) {
    return typeof value === 'string' && value.length >= 1 && value.length <= maxLength && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0 && Number.isSafeInteger(value);
}

function parsePositiveInt(value) {
    if (!/^[1-9][0-9]*$/.test(String(value))) return NaN;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : NaN;
}

function isSha256Ref(value) {
    return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function assertSafeSha256(value) {
    if (!isSha256Ref(value)) throw new Error('VISUAL_ASSET_INVALID_SCHEMA');
}

function isIsoTimestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const ms = Date.parse(value);
    return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

function isBase64(value) {
    return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function isBase64UrlNoPadding(value) {
    return typeof value === 'string' && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value) && !value.includes('=');
}

function base64UrlEncode(bytes) {
    return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
    if (!isBase64UrlNoPadding(value)) throw new Error('BAD_BASE64URL');
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    return Buffer.from(padded, 'base64');
}

function canonicalJson(value) {
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
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    throw new Error('UNSUPPORTED_CANONICAL_VALUE');
}

function assertNoDuplicateJsonKeys(text) {
    const stack = [];
    let i = 0;
    let expectingValueAtRoot = true;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        const ctx = stack[stack.length - 1];
        if (ch === '{') {
            markValueStart(stack, expectingValueAtRoot);
            stack.push({ type: 'object', keys: new Set(), state: 'keyOrEnd' });
            expectingValueAtRoot = false;
            i += 1;
            continue;
        }
        if (ch === '[') {
            markValueStart(stack, expectingValueAtRoot);
            stack.push({ type: 'array', state: 'valueOrEnd' });
            expectingValueAtRoot = false;
            i += 1;
            continue;
        }
        if (ch === '}') {
            if (!ctx || ctx.type !== 'object' || (ctx.state !== 'keyOrEnd' && ctx.state !== 'commaOrEnd')) throw new Error('BAD_JSON');
            stack.pop();
            markValueDone(stack);
            i += 1;
            continue;
        }
        if (ch === ']') {
            if (!ctx || ctx.type !== 'array' || (ctx.state !== 'valueOrEnd' && ctx.state !== 'commaOrEnd')) throw new Error('BAD_JSON');
            stack.pop();
            markValueDone(stack);
            i += 1;
            continue;
        }
        if (ch === ',') {
            if (!ctx || ctx.state !== 'commaOrEnd') throw new Error('BAD_JSON');
            ctx.state = ctx.type === 'object' ? 'keyOrEnd' : 'valueOrEnd';
            i += 1;
            continue;
        }
        if (ch === ':') {
            if (!ctx || ctx.type !== 'object' || ctx.state !== 'colon') throw new Error('BAD_JSON');
            ctx.state = 'value';
            i += 1;
            continue;
        }
        if (ch === '"') {
            const end = findJsonStringEnd(text, i);
            const value = JSON.parse(text.slice(i, end + 1));
            if (ctx && ctx.type === 'object' && ctx.state === 'keyOrEnd') {
                if (ctx.keys.has(value)) throw new Error('DUPLICATE_KEY');
                ctx.keys.add(value);
                ctx.state = 'colon';
            } else {
                markValueStart(stack, expectingValueAtRoot);
                markValueDone(stack);
                expectingValueAtRoot = false;
            }
            i = end + 1;
            continue;
        }
        if (/[-0-9tfn]/.test(ch)) {
            markValueStart(stack, expectingValueAtRoot);
            const end = findPrimitiveEnd(text, i);
            JSON.parse(text.slice(i, end));
            markValueDone(stack);
            expectingValueAtRoot = false;
            i = end;
            continue;
        }
        throw new Error('BAD_JSON');
    }
    if (stack.length) throw new Error('BAD_JSON');
}

function markValueStart(stack) {
    const ctx = stack[stack.length - 1];
    if (!ctx) return;
    if (ctx.type === 'object' && ctx.state !== 'value') throw new Error('BAD_JSON');
    if (ctx.type === 'array' && ctx.state !== 'valueOrEnd') throw new Error('BAD_JSON');
}

function markValueDone(stack) {
    const ctx = stack[stack.length - 1];
    if (!ctx) return;
    if (ctx.type === 'object' && ctx.state === 'value') ctx.state = 'commaOrEnd';
    else if (ctx.type === 'array' && ctx.state === 'valueOrEnd') ctx.state = 'commaOrEnd';
}

function findJsonStringEnd(text, start) {
    let escaped = false;
    for (let i = start + 1; i < text.length; i += 1) {
        const ch = text[i];
        if (escaped) {
            escaped = false;
        } else if (ch === '\\') {
            escaped = true;
        } else if (ch === '"') {
            return i;
        }
    }
    throw new Error('BAD_STRING');
}

function findPrimitiveEnd(text, start) {
    let i = start;
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1;
    return i;
}

function parseOriginList(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .filter((item) => item !== '*');
}

function randomNonce() {
    return base64UrlEncode(randomBytes(18));
}

function sha256Buffer(bytes) {
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Hex(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const CRC32_TABLE = (() => {
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

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    if (leftBuffer.length !== rightBuffer.length) return false;
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function errorResult(status, error) {
    return { status, body: { ok: false, error } };
}

function fail(error) {
    return { ok: false, error };
}

function sanitizeErrorCode(value) {
    return String(value || 'VISUAL_STORAGE_UNAVAILABLE')
        .replace(/[^A-Z0-9_]/g, '_')
        .toUpperCase()
        .slice(0, 120) || 'VISUAL_STORAGE_UNAVAILABLE';
}

function withoutUndefined(value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

async function readJsonBody(request, maxBytes) {
    let total = 0;
    const chunks = [];
    for await (const chunk of request) {
        total += chunk.length;
        if (total > maxBytes) {
            throw Object.assign(new Error('VISUAL_ASSET_SIZE_LIMIT'), { code: 'VISUAL_ASSET_SIZE_LIMIT', status: 413 });
        }
        chunks.push(chunk);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function readStrictJsonBody(request, maxBytes, sizeErrorCode) {
    let total = 0;
    const chunks = [];
    for await (const chunk of request) {
        total += chunk.length;
        if (total > maxBytes) {
            throw Object.assign(new Error(sizeErrorCode), { code: sizeErrorCode, status: 413 });
        }
        chunks.push(chunk);
    }
    if (!chunks.length) {
        throw Object.assign(new Error('VISUAL_MATCH_BAD_REQUEST'), { code: 'VISUAL_MATCH_BAD_REQUEST', status: 400 });
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
        assertNoDuplicateJsonKeys(text);
    } catch {
        throw Object.assign(new Error('VISUAL_MATCH_INVALID_SCHEMA'), { code: 'VISUAL_MATCH_INVALID_SCHEMA', status: 400 });
    }
    try {
        return JSON.parse(text);
    } catch {
        throw Object.assign(new Error('VISUAL_MATCH_BAD_REQUEST'), { code: 'VISUAL_MATCH_BAD_REQUEST', status: 400 });
    }
}

function sendJson(response, status, data, headers = {}) {
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    for (const [key, value] of Object.entries(headers || {})) {
        response.setHeader(key, value);
    }
    response.end(`${JSON.stringify(data)}\n`);
}

export function serializePlayerPublishedAssetResponseForTest(asset, catalog) {
    return serializePlayerPublishedAsset(asset, catalog);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const rootDir = process.env.GALGAME_VISUAL_ASSET_STORE_DIR || DEFAULT_STORE_DIR;
    const server = createVisualAssetService({
        store: new FileVisualAssetStore(path.join(rootDir, 'catalog')),
        contentStore: new FileContentStore(path.join(rootDir, 'assets')),
        retentionStore: new FileVisualAssetRetentionStore(path.join(rootDir, 'retention')),
        nonceStore: new FileNonceStore(path.join(rootDir, 'nonces')),
        bindingStore: new FileVisualBindingStore(path.join(rootDir, 'bindings')),
    });
    server.listen(DEFAULT_PORT, '127.0.0.1', () => {
        console.log(`visual-asset-service listening on http://127.0.0.1:${DEFAULT_PORT}`);
    });
}
