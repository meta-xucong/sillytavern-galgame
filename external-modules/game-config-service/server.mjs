import http from 'node:http';
import {
    createHash,
    createHmac,
    randomBytes,
    timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL,
} from 'node:url';
import {
    createActiveRelease,
    createPlayableStoryRelease,
    findArcBinding,
    getActiveSillyTavernBindings,
    getDefaultArcId,
    listPlayableStoryEntries,
    listStoredStorySummaries,
    stableHash,
    validateActiveReleaseManifestBinding,
    validateReleaseArcSelection,
    validateScenarioManifest,
} from '../../frontend/shared/src/protocol.js';
import {
    createVisualProjectionEntityHints,
    normalizeOriginalVisibleChatMessages,
    SillyTavernOriginalChatBridge,
    VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION,
} from '../../frontend/shared/src/sillytavern-adapter.js';
import {
    VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION,
    VISUAL_PROJECTION_STUB_PROTOCOL_VERSION,
    VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION,
    validateVisualBinding,
    validateVisualMatchResult,
    validateVisualProjectionProofShape,
    validateVisualProjectionStub,
    validateVisualVisibleProjection,
} from '../../frontend/shared/src/visual-system-schema.js';
import { createSignedBridgeProof } from '../original-runtime-bridge/server.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = path.join(moduleDir, 'data', 'store.json');
const VISUAL_RESTORE_PROOF_ISSUE_RESPONSE_VERSION = 'galgame.visual-restore-proof-issue-response.v1';
const VISUAL_OLD_SAVE_PROOF_ISSUE_REQUEST_VERSION = 'galgame.visual-old-save-proof-issue-request.v1';
const VISUAL_ROLLBACK_PROOF_ISSUE_REQUEST_VERSION = 'galgame.visual-rollback-proof-issue-request.v1';
const VISUAL_OLD_SAVE_RESTORE_PROOF_VERSION = 'galgame.visual-old-save-restore-proof.v1';
const VISUAL_ROLLBACK_RESTORE_PROOF_VERSION = 'galgame.visual-rollback-restore-proof.v1';
const VISUAL_RESTORE_PROOF_ISSUER_ID = 'game-config-service';
const VISUAL_RESTORE_PROOF_AUDIENCE = 'visual-asset-service';
const OLD_SAVE_RESTORE_PURPOSE = 'old-save-visual-binding-restore';
const ROLLBACK_RESTORE_PURPOSE = 'rollback-visual-binding-restore';
const VISUAL_RESTORE_MAX_TTL_MS = 120 * 1000;
const PLAYER_VISUAL_BUNDLE_REQUEST_VERSION = 'galgame.player-visual-bundle.request.v1';
const PLAYER_VISUAL_BUNDLE_VERSION = 'galgame.player-visual-bundle.v1';
const PLAYER_VISUAL_ASSET_TICKET_REF_VERSION = 'galgame.player-visual-asset-ticket-ref.v1';
const PLAYER_VISUAL_ASSET_TICKET_RECORD_VERSION = 'galgame.player-visual-asset-ticket-record.v1';
const PLAYER_VISUAL_BUNDLE_MAX_TTL_MS = 120 * 1000;
const PLAYER_VISUAL_REQUEST_MAX_BYTES = 16 * 1024;
const PLAYER_VISUAL_BUNDLE_MAX_BYTES = 64 * 1024;
const PLAYER_VISUAL_SESSION_HEADER = 'x-galgame-player-session';
const PLAYER_VISUAL_CSRF_HEADER = 'x-galgame-player-csrf';
const PLAYER_VISUAL_CSRF_COOKIE = 'galgame_player_csrf';
const VISUAL_MATCH_INTERNAL_TIMEOUT_MS = 5000;
const VISUAL_MATCH_INTERNAL_MAX_BYTES = 64 * 1024;
const VISUAL_ASSET_INTERNAL_TIMEOUT_MS = 5000;
const VISUAL_ASSET_INTERNAL_MAX_JSON_BYTES = 32 * 1024;
const VISUAL_ASSET_INTERNAL_MAX_CONTENT_BYTES = 15 * 1024 * 1024;
const VISUAL_ASSET_INTERNAL_CONTENT_HASH_HEADER = 'x-galgame-asset-content-sha256';

export function createConfigService({
    store = new FileConfigStore(process.env.GALGAME_CONFIG_STORE || DEFAULT_STORE_PATH),
    corsOrigin = process.env.GALGAME_CORS_ORIGIN || '',
    adminToken = process.env.GALGAME_ADMIN_TOKEN || '',
    runtimeProofToken = process.env.GALGAME_RUNTIME_PROOF_TOKEN || '',
    proofSecret = process.env.GALGAME_BRIDGE_PROOF_SECRET || '',
    proofTtlMs = Number(process.env.GALGAME_BRIDGE_PROOF_TTL_MS || 5 * 60 * 1000),
    visualProjectionSecret = process.env.GALGAME_VISUAL_PROJECTION_SECRET || '',
    visualProjectionServiceToken = process.env.GALGAME_VISUAL_PROJECTION_SERVICE_TOKEN || '',
    visualProjectionStubServiceToken = process.env.GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN || '',
    visualProjectionTtlMs = Number(process.env.GALGAME_VISUAL_PROJECTION_TTL_MS || 5 * 60 * 1000),
    visualProjectionStore = new MemoryVisualProjectionStore(),
    visualProjectionNonceFactory = defaultVisualProjectionNonce,
    visualRestoreIssuerServiceToken = process.env.GALGAME_VISUAL_RESTORE_ISSUER_SERVICE_TOKEN || '',
    visualRestoreProofSecret = process.env.GALGAME_VISUAL_RESTORE_PROOF_SECRET || '',
    visualRestoreProofKeyId = process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_ID || '',
    visualRestoreProofTtlMs = Number(process.env.GALGAME_VISUAL_RESTORE_PROOF_TTL_MS || VISUAL_RESTORE_MAX_TTL_MS),
    visualRestoreIssuerStore = new MemoryVisualRestoreIssuerStore(),
    visualRestoreNonceFactory = defaultVisualRestoreNonce,
    visualSaveBindingReader = null,
    visualRollbackEventReader = null,
    playerVisualGatewayOrigins = process.env.GALGAME_PLAYER_VISUAL_GATEWAY_ORIGINS || '',
    playerVisualGatewayTrustedProxyMode = process.env.GALGAME_PLAYER_VISUAL_GATEWAY_TRUSTED_PROXY_MODE || '',
    playerVisualGatewaySessionHeader = process.env.GALGAME_PLAYER_VISUAL_GATEWAY_SESSION_HEADER || 'X-Galgame-Player-Session',
    playerVisualGatewayCsrfHeader = process.env.GALGAME_PLAYER_VISUAL_GATEWAY_CSRF_HEADER || 'X-Galgame-Player-CSRF',
    playerVisualGatewayCsrfCookie = process.env.GALGAME_PLAYER_VISUAL_GATEWAY_CSRF_COOKIE || PLAYER_VISUAL_CSRF_COOKIE,
    playerVisualSessionReader = null,
    playerVisualAssetTicketStore = new MemoryPlayerVisualAssetTicketStore(),
    visualMatchInternalBaseUrl = process.env.GALGAME_VISUAL_MATCH_INTERNAL_BASE_URL || '',
    visualMatchServiceToken = process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN || '',
    visualMatchInternalTimeoutMs = Number(process.env.GALGAME_VISUAL_MATCH_INTERNAL_TIMEOUT_MS || VISUAL_MATCH_INTERNAL_TIMEOUT_MS),
    visualAssetServiceBaseUrl = process.env.GALGAME_VISUAL_ASSET_SERVICE_BASE_URL || '',
    visualAssetInternalReadToken = process.env.GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN || '',
    visualAssetInternalTimeoutMs = Number(process.env.GALGAME_VISUAL_ASSET_INTERNAL_TIMEOUT_MS || VISUAL_ASSET_INTERNAL_TIMEOUT_MS),
    sillyTavernBaseUrl = process.env.GALGAME_SILLYTAVERN_BASE_URL || process.env.SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8000',
    originalChatBridge = new SillyTavernOriginalChatBridge({
        baseUrl: sillyTavernBaseUrl,
        fetchImpl: createCookieFetch(globalThis.fetch),
    }),
} = {}) {
    return http.createServer(async (request, response) => {
        try {
            await handleRequest(request, response, {
                store,
                corsOrigin,
                adminToken,
                runtimeProofToken,
                proofSecret,
                proofTtlMs,
                visualProjectionSecret,
                visualProjectionServiceToken,
                visualProjectionStubServiceToken,
                visualProjectionTtlMs,
                visualProjectionStore,
                visualProjectionNonceFactory,
                visualRestoreIssuerServiceToken,
                visualRestoreProofSecret,
                visualRestoreProofKeyId,
                visualRestoreProofTtlMs,
                visualRestoreIssuerStore,
                visualRestoreNonceFactory,
                visualSaveBindingReader,
                visualRollbackEventReader,
                playerVisualGatewayOrigins,
                playerVisualGatewayTrustedProxyMode,
                playerVisualGatewaySessionHeader,
                playerVisualGatewayCsrfHeader,
                playerVisualGatewayCsrfCookie,
                playerVisualSessionReader,
                playerVisualAssetTicketStore,
                visualMatchInternalBaseUrl,
                visualMatchServiceToken,
                visualMatchInternalTimeoutMs,
                visualAssetServiceBaseUrl,
                visualAssetInternalReadToken,
                visualAssetInternalTimeoutMs,
                originalChatBridge,
            });
        } catch (error) {
            sendJson(response, 500, {
                error: error.message || 'CONFIG_SERVICE_ERROR',
            }, { corsOrigin });
        }
    });
}

export async function handleRequest(request, response, {
    store,
    corsOrigin = '',
    adminToken = '',
    runtimeProofToken = '',
    proofSecret = '',
    proofTtlMs = 5 * 60 * 1000,
    visualProjectionSecret = '',
    visualProjectionServiceToken = '',
    visualProjectionStubServiceToken = '',
    visualProjectionTtlMs = 5 * 60 * 1000,
    visualProjectionStore = new MemoryVisualProjectionStore(),
    visualProjectionNonceFactory = defaultVisualProjectionNonce,
    visualRestoreIssuerServiceToken = '',
    visualRestoreProofSecret = '',
    visualRestoreProofKeyId = '',
    visualRestoreProofTtlMs = VISUAL_RESTORE_MAX_TTL_MS,
    visualRestoreIssuerStore = new MemoryVisualRestoreIssuerStore(),
    visualRestoreNonceFactory = defaultVisualRestoreNonce,
    visualSaveBindingReader = null,
    visualRollbackEventReader = null,
    playerVisualGatewayOrigins = '',
    playerVisualGatewayTrustedProxyMode = '',
    playerVisualGatewaySessionHeader = 'X-Galgame-Player-Session',
    playerVisualGatewayCsrfHeader = 'X-Galgame-Player-CSRF',
    playerVisualGatewayCsrfCookie = PLAYER_VISUAL_CSRF_COOKIE,
    playerVisualSessionReader = null,
    playerVisualAssetTicketStore = new MemoryPlayerVisualAssetTicketStore(),
    visualMatchInternalBaseUrl = '',
    visualMatchServiceToken = '',
    visualMatchInternalTimeoutMs = VISUAL_MATCH_INTERNAL_TIMEOUT_MS,
    visualAssetServiceBaseUrl = '',
    visualAssetInternalReadToken = '',
    visualAssetInternalTimeoutMs = VISUAL_ASSET_INTERNAL_TIMEOUT_MS,
    originalChatBridge,
}) {
    corsOrigin = resolveCorsOrigin(request, corsOrigin);
    const url = new URL(request.url, 'http://localhost');
    const method = request.method || 'GET';
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
        if (pathname === '/v1/player/visual-bundle') {
            return handlePlayerVisualBundleOptions(request, response, {
                playerVisualGatewayOrigins,
            });
        }
        if (isPlayerVisualAssetContentPath(pathname)) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_PLAYER_ASSET_BROWSER_PREFLIGHT_FORBIDDEN' });
            return;
        }
        if (pathname === '/v1/visual/projections' || isVisualProjectionStubPath(pathname) || isVisualRestoreProofIssuePath(pathname)) {
            sendJson(response, 403, { ok: false, error: isVisualRestoreProofIssuePath(pathname) ? 'VISUAL_RESTORE_ISSUER_BROWSER_FORBIDDEN' : 'VISUAL_PROJECTION_BROWSER_DIRECT_FORBIDDEN' });
            return;
        }
        sendOptions(response, corsOrigin);
        return;
    }

    if (pathname.startsWith('/v1/admin/') && !isAuthorizedAdminRequest(request, adminToken)) {
        sendJson(response, 401, { error: 'ADMIN_AUTH_REQUIRED' }, {
            corsOrigin,
            extraHeaders: {
                'WWW-Authenticate': 'Bearer realm="galgame-config-service"',
            },
        });
        return;
    }

    if (method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, {
            ok: true,
            service: 'game-config-service',
            active: Boolean(await store.getActiveRelease()),
            playableStories: (await store.listPlayableScenarios()).length,
            runtimeProof: {
                configured: Boolean(proofSecret),
            },
        }, { corsOrigin });
        return;
    }

    if (method === 'GET' && pathname === '/v1/admin/health') {
        sendJson(response, 200, {
            ok: true,
            service: 'game-config-service',
            adminAuth: adminToken ? 'required' : 'disabled',
            active: Boolean(await store.getActiveRelease()),
            runtimeProof: {
                configured: Boolean(proofSecret),
            },
        }, { corsOrigin });
        return;
    }

    if (method === 'GET' && pathname === '/v1/releases/active') {
        const active = await store.getActiveRelease();
        if (!active) {
            sendJson(response, 404, { error: 'ACTIVE_RELEASE_UNAVAILABLE' }, { corsOrigin });
            return;
        }
        sendJson(response, 200, active, { corsOrigin });
        return;
    }

    if (method === 'GET' && pathname === '/v1/scenarios') {
        sendJson(response, 200, {
            protocolVersion: 'galgame.playable-story-list.v1',
            entries: await store.listPlayableScenarios(),
        }, { corsOrigin });
        return;
    }

    const manifestMatch = /^\/v1\/scenarios\/([^/]+)\/versions\/([^/]+)\/manifest$/.exec(pathname);
    if (method === 'GET' && manifestMatch) {
        const manifest = await store.getManifest(decodeURIComponent(manifestMatch[1]), decodeURIComponent(manifestMatch[2]));
        if (!manifest) {
            sendJson(response, 404, { error: 'SCENARIO_MANIFEST_NOT_FOUND' }, { corsOrigin });
            return;
        }
        sendJson(response, 200, manifest, { corsOrigin });
        return;
    }

    if (method === 'POST' && pathname === '/v1/runtime-bridge/proofs') {
        if (runtimeProofToken && !isAuthorizedRuntimeProofRequest(request, runtimeProofToken)) {
            sendJson(response, 401, { error: 'RUNTIME_PROOF_AUTH_REQUIRED' }, {
                corsOrigin,
                extraHeaders: {
                    'WWW-Authenticate': 'Bearer realm="galgame-runtime-proof"',
                },
            });
            return;
        }
        if (!proofSecret) {
            sendJson(response, 503, { ok: false, error: 'BRIDGE_PROOF_ISSUER_UNCONFIGURED' }, { corsOrigin });
            return;
        }
        const body = await readJson(request);
        const result = await issueRuntimeBridgeProof({
            body,
            store,
            proofSecret,
            proofTtlMs,
            originalChatBridge,
        });
        sendJson(response, result.status, result.body, { corsOrigin });
        return;
    }

    if (method === 'POST' && pathname === '/v1/player/visual-bundle') {
        const result = await createPlayerVisualBundle({
            request,
            url,
            store,
            visualProjectionSecret,
            visualProjectionTtlMs,
            visualProjectionStore,
            visualProjectionNonceFactory,
            originalChatBridge,
            playerVisualGatewayOrigins,
            playerVisualGatewayTrustedProxyMode,
            playerVisualGatewaySessionHeader,
            playerVisualGatewayCsrfHeader,
            playerVisualGatewayCsrfCookie,
            playerVisualSessionReader,
            playerVisualAssetTicketStore,
            visualMatchInternalBaseUrl,
            visualMatchServiceToken,
            visualMatchInternalTimeoutMs,
            visualAssetServiceBaseUrl,
            visualAssetInternalReadToken,
            visualAssetInternalTimeoutMs,
        });
        sendJson(response, result.status, result.body, result.corsOrigin ? { corsOrigin: result.corsOrigin } : {});
        return;
    }

    const playerAssetContentMatch = /^\/v1\/player\/visual-assets\/(vat_[a-z0-9_-]{24,80})\/content$/.exec(pathname);
    if (method === 'GET' && playerAssetContentMatch) {
        const result = await handlePlayerVisualAssetContent({
            request,
            url,
            ticketId: playerAssetContentMatch[1],
            playerVisualGatewayOrigins,
            playerVisualGatewayTrustedProxyMode,
            playerVisualGatewaySessionHeader,
            playerVisualSessionReader,
            playerVisualAssetTicketStore,
            visualAssetServiceBaseUrl,
            visualAssetInternalReadToken,
            visualAssetInternalTimeoutMs,
        });
        if (result.bytes) {
            if (result.corsOrigin) {
                response.setHeader('Access-Control-Allow-Origin', result.corsOrigin);
                response.setHeader('Vary', 'Origin');
            }
            response.setHeader('Content-Type', result.contentType);
            response.setHeader('Content-Length', String(result.bytes.length));
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.setHeader('Cache-Control', 'no-store');
            response.statusCode = result.status;
            response.end(result.bytes);
            return;
        }
        sendJson(response, result.status, result.body, result.corsOrigin ? { corsOrigin: result.corsOrigin } : {});
        return;
    }

    if (method === 'POST' && pathname === '/v1/visual/projections') {
        if (request.headers.origin) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_PROJECTION_BROWSER_DIRECT_FORBIDDEN' });
            return;
        }
        if (url.search || request.headers.cookie || request.headers['x-galgame-visual-projection-proof']) {
            sendJson(response, 400, { ok: false, error: 'VISUAL_PROJECTION_FORBIDDEN_TRANSPORT' });
            return;
        }
        if (!visualProjectionServiceToken) {
            sendJson(response, 503, { ok: false, error: 'VISUAL_PROJECTION_AUTH_UNCONFIGURED' });
            return;
        }
        if (!isAuthorizedBearerRequest(request, visualProjectionServiceToken)) {
            sendJson(response, 401, { ok: false, error: 'VISUAL_PROJECTION_AUTH_REQUIRED' }, {
                extraHeaders: {
                    'WWW-Authenticate': 'Bearer realm="galgame-visual-projection"',
                },
            });
            return;
        }
        let body;
        try {
            body = await readJsonLimited(request, 16 * 1024);
        } catch (error) {
            sendJson(response, error.status || 400, { ok: false, error: error.code || 'VISUAL_PROJECTION_BAD_REQUEST' });
            return;
        }
        const result = await issueVisualProjection({
            body,
            store,
            projectionSecret: visualProjectionSecret,
            projectionTtlMs: visualProjectionTtlMs,
            originalChatBridge,
            projectionStore: visualProjectionStore,
            nonceFactory: visualProjectionNonceFactory,
        });
        sendJson(response, result.status, result.body);
        return;
    }

    const visualStubMatch = /^\/v1\/visual\/projection-stubs\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && visualStubMatch) {
        if (request.headers.origin || isBrowserLikeRequest(request)) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_PROJECTION_STUB_BROWSER_FORBIDDEN' });
            return;
        }
        if (url.search) {
            sendJson(response, 400, { ok: false, error: 'VISUAL_PROJECTION_STUB_FORBIDDEN_TRANSPORT' });
            return;
        }
        if (!visualProjectionStubServiceToken) {
            sendJson(response, 503, { ok: false, error: 'VISUAL_PROJECTION_STUB_AUTH_UNCONFIGURED' });
            return;
        }
        if (!isAuthorizedBearerRequest(request, visualProjectionStubServiceToken)) {
            sendJson(response, 401, { ok: false, error: 'VISUAL_PROJECTION_STUB_AUTH_REQUIRED' }, {
                extraHeaders: {
                    'WWW-Authenticate': 'Bearer realm="galgame-visual-projection-stub"',
                },
            });
            return;
        }
        const projectionId = decodeURIComponent(visualStubMatch[1]);
        if (!isVisualProjectionId(projectionId)) {
            sendJson(response, 400, { ok: false, error: 'VISUAL_PROJECTION_STUB_INVALID_ID' });
            return;
        }
        const stub = visualProjectionStore.readStub(projectionId, Date.now());
        if (!stub) {
            sendJson(response, 404, { ok: false, error: 'VISUAL_PROJECTION_STUB_MISSING' });
            return;
        }
        const validation = validateVisualProjectionStub(stub);
        if (!validation.valid) {
            sendJson(response, 409, { ok: false, error: 'VISUAL_PROJECTION_STUB_INVALID' });
            return;
        }
        sendJson(response, 200, stub);
        return;
    }

    if (method === 'POST' && (pathname === '/v1/visual/restore-proofs/old-save' || pathname === '/v1/visual/restore-proofs/rollback')) {
        const routeKind = pathname.endsWith('/old-save') ? 'old-save' : 'rollback';
        const authResult = validateVisualRestoreIssuerHttpRequest({
            request,
            url,
            serviceToken: visualRestoreIssuerServiceToken,
        });
        if (!authResult.ok) {
            sendJson(response, authResult.status, { ok: false, error: authResult.error }, authResult.headers ? { extraHeaders: authResult.headers } : {});
            return;
        }
        if (!visualRestoreProofSecret) {
            sendJson(response, 503, { ok: false, error: 'VISUAL_RESTORE_ISSUER_SECRET_MISSING' });
            return;
        }
        if (!isVisualRestoreKeyId(visualRestoreProofKeyId)) {
            sendJson(response, 503, { ok: false, error: 'VISUAL_RESTORE_ISSUER_KEY_INVALID' });
            return;
        }
        let body;
        try {
            body = await readJsonLimited(request, 16 * 1024);
        } catch (error) {
            sendJson(response, mapVisualRestoreReadStatus(error), { ok: false, error: mapVisualRestoreReadError(error) });
            return;
        }
        const result = routeKind === 'old-save'
            ? await issueVisualOldSaveRestoreProof({
                body,
                saveBindingReader: visualSaveBindingReader,
                restoreProofSecret: visualRestoreProofSecret,
                restoreProofKeyId: visualRestoreProofKeyId,
                restoreProofTtlMs: visualRestoreProofTtlMs,
                issuerStore: visualRestoreIssuerStore,
                nonceFactory: visualRestoreNonceFactory,
            })
            : await issueVisualRollbackRestoreProof({
                body,
                store,
                rollbackEventReader: visualRollbackEventReader,
                restoreProofSecret: visualRestoreProofSecret,
                restoreProofKeyId: visualRestoreProofKeyId,
                restoreProofTtlMs: visualRestoreProofTtlMs,
                issuerStore: visualRestoreIssuerStore,
                nonceFactory: visualRestoreNonceFactory,
            });
        sendJson(response, result.status, result.body);
        return;
    }

    if (method === 'POST' && pathname === '/v1/admin/scenarios/import') {
        const body = await readJson(request);
        const manifest = body.manifest || body;
        const validation = validateScenarioManifest(manifest);
        if (!validation.valid) {
            sendJson(response, 400, { ok: false, validation }, { corsOrigin });
            return;
        }
        await store.saveManifest(manifest);
        sendJson(response, 200, { ok: true, validation }, { corsOrigin });
        return;
    }

    const validateMatch = /^\/v1\/admin\/scenarios\/([^/]+)\/versions\/([^/]+)\/validate$/.exec(pathname);
    if (method === 'POST' && validateMatch) {
        const body = await readJson(request);
        const manifest = body.manifest || await store.getManifest(decodeURIComponent(validateMatch[1]), decodeURIComponent(validateMatch[2]));
        const validation = validateScenarioManifest(manifest);
        sendJson(response, validation.valid ? 200 : 400, validation, { corsOrigin });
        return;
    }

    if (method === 'GET' && pathname === '/v1/admin/releases') {
        sendJson(response, 200, { releases: await store.listReleases() }, { corsOrigin });
        return;
    }

    if (method === 'GET' && pathname === '/v1/admin/scenarios') {
        sendJson(response, 200, { stories: await store.listStoredScenarios() }, { corsOrigin });
        return;
    }

    if (method === 'POST' && pathname === '/v1/admin/releases') {
        const body = await readJson(request);
        const release = await store.publish(body.scenarioId, body.scenarioVersion, {
            activeArcId: body.activeArcId || body.arcId || '',
        });
        if (release?.ok === false) {
            sendJson(response, release.status || 400, {
                ok: false,
                error: release.error || 'RELEASE_PUBLISH_FAILED',
                validation: release.validation,
            }, { corsOrigin });
            return;
        }
        if (!release) {
            sendJson(response, 404, { error: 'SCENARIO_MANIFEST_NOT_FOUND' }, { corsOrigin });
            return;
        }
        sendJson(response, 200, { ok: true, release }, { corsOrigin });
        return;
    }

    const rollbackMatch = /^\/v1\/admin\/releases\/([^/]+)\/rollback$/.exec(pathname);
    if (method === 'POST' && rollbackMatch) {
        const release = await store.rollback(decodeURIComponent(rollbackMatch[1]));
        if (!release) {
            sendJson(response, 404, { error: 'RELEASE_NOT_FOUND' }, { corsOrigin });
            return;
        }
        sendJson(response, 200, { ok: true, release }, { corsOrigin });
        return;
    }

    sendJson(response, 404, { error: 'NOT_FOUND' }, { corsOrigin });
}

export class MemoryVisualProjectionStore {
    constructor({ maxEntries = 200, rateLimit = 20, rateWindowMs = 60 * 1000 } = {}) {
        this.maxEntries = maxEntries;
        this.rateLimit = rateLimit;
        this.rateWindowMs = rateWindowMs;
        this.byProjectionId = new Map();
        this.byIdempotencyKey = new Map();
        this.nonces = new Map();
        this.rateEvents = new Map();
    }

    getByIdempotencyKey(idempotencyKey, bodyHash, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        const entry = this.byIdempotencyKey.get(idempotencyKey);
        if (!entry) {
            return null;
        }
        if (entry.bodyHash !== bodyHash) {
            return { conflict: true };
        }
        return entry;
    }

    hasNonce(nonce, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        return this.nonces.has(nonce);
    }

    save(entry, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        this.byProjectionId.set(entry.projection.projectionId, entry);
        this.byIdempotencyKey.set(entry.idempotencyKey, entry);
        this.nonces.set(entry.proof.nonce, entry.expiresAtMs);
        this.enforceLimit();
        return entry;
    }

    readStub(projectionId, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        const entry = this.byProjectionId.get(projectionId);
        return entry?.stub || null;
    }

    recordRate(scopeKey, nowMs = Date.now()) {
        if (!this.rateLimit || this.rateLimit < 1) {
            return { ok: true };
        }
        const windowStart = nowMs - this.rateWindowMs;
        const events = (this.rateEvents.get(scopeKey) || []).filter((timestamp) => timestamp >= windowStart);
        if (events.length >= this.rateLimit) {
            this.rateEvents.set(scopeKey, events);
            return { ok: false };
        }
        events.push(nowMs);
        this.rateEvents.set(scopeKey, events);
        return { ok: true };
    }

    pruneExpired(nowMs = Date.now()) {
        for (const [projectionId, entry] of this.byProjectionId.entries()) {
            if (entry.expiresAtMs <= nowMs) {
                this.byProjectionId.delete(projectionId);
                if (this.byIdempotencyKey.get(entry.idempotencyKey) === entry) {
                    this.byIdempotencyKey.delete(entry.idempotencyKey);
                }
            }
        }
        for (const [nonce, expiresAtMs] of this.nonces.entries()) {
            if (expiresAtMs <= nowMs) {
                this.nonces.delete(nonce);
            }
        }
        for (const [scopeKey, events] of this.rateEvents.entries()) {
            const kept = events.filter((timestamp) => timestamp >= nowMs - this.rateWindowMs);
            if (kept.length) {
                this.rateEvents.set(scopeKey, kept);
            } else {
                this.rateEvents.delete(scopeKey);
            }
        }
    }

    enforceLimit() {
        while (this.byProjectionId.size > this.maxEntries) {
            const oldestKey = this.byProjectionId.keys().next().value;
            const oldest = this.byProjectionId.get(oldestKey);
            this.byProjectionId.delete(oldestKey);
            if (oldest && this.byIdempotencyKey.get(oldest.idempotencyKey) === oldest) {
                this.byIdempotencyKey.delete(oldest.idempotencyKey);
            }
        }
    }
}

export class MemoryPlayerVisualAssetTicketStore {
    constructor({ maxEntries = 500 } = {}) {
        this.maxEntries = maxEntries;
        this.records = new Map();
    }

    put(record, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        this.records.set(record.ticketId, record);
        while (this.records.size > this.maxEntries) {
            this.records.delete(this.records.keys().next().value);
        }
        return record;
    }

    get(ticketId, session, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        const record = this.records.get(ticketId);
        if (!record) return null;
        if (Date.parse(record.expiresAt) <= nowMs) {
            this.records.delete(ticketId);
            return null;
        }
        if (record.playerSessionHash !== sha256Digest(session.sessionId)) return null;
        return record;
    }

    pruneExpired(nowMs = Date.now()) {
        for (const [ticketId, record] of this.records.entries()) {
            if (Date.parse(record.expiresAt) <= nowMs) {
                this.records.delete(ticketId);
            }
        }
    }
}

export class MemoryVisualRestoreIssuerStore {
    constructor({ maxEntries = 200 } = {}) {
        this.maxEntries = maxEntries;
        this.byIdempotencyKey = new Map();
        this.nonces = new Map();
    }

    getByIdempotencyKey(route, idempotencyKey, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        return this.byIdempotencyKey.get(`${route}|${idempotencyKey}`) || null;
    }

    hasNonce(nonce, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        return this.nonces.has(nonce);
    }

    save(entry, nowMs = Date.now()) {
        this.pruneExpired(nowMs);
        this.byIdempotencyKey.set(`${entry.route}|${entry.idempotencyKey}`, entry);
        this.nonces.set(entry.payload.nonce, entry.expiresAtMs);
        this.enforceLimit();
        return entry;
    }

    pruneExpired(nowMs = Date.now()) {
        for (const [key, entry] of this.byIdempotencyKey.entries()) {
            if (entry.expiresAtMs <= nowMs) {
                this.byIdempotencyKey.delete(key);
            }
        }
        for (const [nonce, expiresAtMs] of this.nonces.entries()) {
            if (expiresAtMs <= nowMs) {
                this.nonces.delete(nonce);
            }
        }
    }

    enforceLimit() {
        while (this.byIdempotencyKey.size > this.maxEntries) {
            const oldestKey = this.byIdempotencyKey.keys().next().value;
            this.byIdempotencyKey.delete(oldestKey);
        }
    }
}

export class MemoryConfigStore {
    constructor(snapshot = {}) {
        this.manifests = new Map();
        this.releases = [];
        this.activeRelease = snapshot.activeRelease || null;
        for (const manifest of snapshot.manifests || []) {
            if (manifest?.id && manifest?.version) {
                this.manifests.set(manifestKey(manifest.id, manifest.version), manifest);
            }
        }
        this.releases = Array.isArray(snapshot.releases) ? snapshot.releases : [];
    }

    async getActiveRelease() {
        if (!this.activeRelease) {
            return null;
        }
        const manifest = await this.getManifest(this.activeRelease.scenarioId, this.activeRelease.scenarioVersion);
        const validation = validateActiveReleaseManifestBinding(this.activeRelease, manifest, { requirePresentationProfileHash: true });
        return validation.valid ? this.activeRelease : null;
    }

    async getManifest(scenarioId, scenarioVersion) {
        return this.manifests.get(manifestKey(scenarioId, scenarioVersion)) || null;
    }

    async saveManifest(manifest) {
        this.manifests.set(manifestKey(manifest.id, manifest.version), manifest);
        return manifest;
    }

    async listManifests() {
        return [...this.manifests.values()];
    }

    async listPlayableScenarios() {
        return listPlayableStoryEntries(await this.listManifests(), {
            activeRelease: this.activeRelease,
            releases: this.releases,
            manifestUrlFactory: (manifest) => `/v1/scenarios/${encodeURIComponent(manifest.id)}/versions/${encodeURIComponent(manifest.version)}/manifest`,
        });
    }

    async listStoredScenarios() {
        return listStoredStorySummaries(await this.listManifests());
    }

    async publish(scenarioId, scenarioVersion, { activeArcId = '' } = {}) {
        const manifest = await this.getManifest(scenarioId, scenarioVersion);
        if (!manifest) {
            return null;
        }
        const arcValidation = validateReleaseArcSelection(manifest, activeArcId, { requirePresentationProfileHash: true });
        if (!arcValidation.valid) {
            const arcNotFound = arcValidation.errors.some((error) => /does not exist/i.test(error));
            return {
                ok: false,
                status: 400,
                error: arcNotFound ? 'ACTIVE_ARC_NOT_FOUND' : 'ACTIVE_ARC_NOT_READY',
                validation: arcValidation,
            };
        }
        const release = createServiceRelease(manifest, { activeArcId });
        this.activeRelease = release;
        this.releases = [
            release,
            ...this.releases.filter((item) => item.releaseId !== release.releaseId),
        ].slice(0, 50);
        return release;
    }

    async listReleases() {
        return this.releases;
    }

    async rollback(releaseId) {
        const release = this.releases.find((item) => item.releaseId === releaseId);
        if (!release) {
            return null;
        }
        const manifest = await this.getManifest(release.scenarioId, release.scenarioVersion);
        const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
        if (!validation.valid) {
            return null;
        }
        this.activeRelease = release;
        return release;
    }

    snapshot() {
        return {
            activeRelease: this.activeRelease,
            releases: this.releases,
            manifests: [...this.manifests.values()],
        };
    }
}

export class FileConfigStore {
    constructor(filePath = DEFAULT_STORE_PATH) {
        this.filePath = filePath;
        this.memory = new MemoryConfigStore();
        this.loaded = false;
    }

    async getActiveRelease() {
        await this.load();
        return this.memory.getActiveRelease();
    }

    async getManifest(scenarioId, scenarioVersion) {
        await this.load();
        return this.memory.getManifest(scenarioId, scenarioVersion);
    }

    async saveManifest(manifest) {
        await this.load();
        const result = await this.memory.saveManifest(manifest);
        await this.persist();
        return result;
    }

    async listManifests() {
        await this.load();
        return this.memory.listManifests();
    }

    async listPlayableScenarios() {
        await this.load();
        return this.memory.listPlayableScenarios();
    }

    async listStoredScenarios() {
        await this.load();
        return this.memory.listStoredScenarios();
    }

    async publish(scenarioId, scenarioVersion, options = {}) {
        await this.load();
        const release = await this.memory.publish(scenarioId, scenarioVersion, options);
        await this.persist();
        return release;
    }

    async listReleases() {
        await this.load();
        return this.memory.listReleases();
    }

    async rollback(releaseId) {
        await this.load();
        const release = await this.memory.rollback(releaseId);
        await this.persist();
        return release;
    }

    async load() {
        if (this.loaded) {
            return;
        }
        try {
            const snapshot = JSON.parse(await readFile(this.filePath, 'utf8'));
            this.memory = new MemoryConfigStore(snapshot);
        } catch {
            this.memory = new MemoryConfigStore();
        }
        this.loaded = true;
    }

    async persist() {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(this.memory.snapshot(), null, 2), 'utf8');
    }
}

export async function issueVisualProjection({
    body,
    store,
    projectionSecret,
    projectionTtlMs = 5 * 60 * 1000,
    originalChatBridge,
    projectionStore = new MemoryVisualProjectionStore(),
    nonceFactory = defaultVisualProjectionNonce,
    now = () => new Date(),
    includeInternalStubEntities = false,
} = {}) {
    const requestedAt = now();
    const nowMs = requestedAt.getTime();
    const requestValidation = validateVisualProjectionRequest(body);
    if (!requestValidation.valid) {
        return visualProjectionDenied(400, 'VISUAL_PROJECTION_REQUEST_INVALID', { validation: requestValidation });
    }
    if (!projectionSecret) {
        return visualProjectionDenied(503, 'VISUAL_PROJECTION_SECRET_UNCONFIGURED');
    }
    if (body.requestMode === 'old-save' || body.oldSaveHint) {
        return visualProjectionDenied(403, 'VISUAL_PROJECTION_OLD_SAVE_UNSUPPORTED');
    }

    const bodyHash = sha256Digest(canonicalJson(body));
    const existing = projectionStore.getByIdempotencyKey(body.idempotencyKey, bodyHash, nowMs);
    if (existing?.conflict) {
        return visualProjectionDenied(409, 'VISUAL_PROJECTION_IDEMPOTENCY_CONFLICT');
    }
    if (existing) {
        return {
            status: 200,
            body: createVisualProjectionResponse(existing),
        };
    }

    const releaseResult = await resolveVisualProjectionRelease(store, body);
    if (!releaseResult.ok) {
        return visualProjectionDenied(releaseResult.status, releaseResult.error, releaseResult.extra || {});
    }
    const { release, manifest, arcId } = releaseResult;
    const visualScope = resolveVisualScopeBinding(manifest, arcId);
    if (!visualScope.ok) {
        return visualProjectionDenied(409, visualScope.error);
    }
    const scopeMismatch = validateRequestedVisualScope(body, visualScope.binding);
    if (!scopeMismatch.valid) {
        return visualProjectionDenied(403, 'VISUAL_PROJECTION_SCOPE_MISMATCH', { validation: scopeMismatch });
    }

    const rateScope = [
        release.releaseId,
        arcId,
        normalizeChatId(body.scopeHint?.chatId),
        visualScope.binding.profileId,
        visualScope.binding.catalogId,
        visualScope.binding.catalogRevision,
    ].join('|');
    if (!projectionStore.recordRate(rateScope, nowMs).ok) {
        return visualProjectionDenied(429, 'VISUAL_PROJECTION_RATE_LIMITED');
    }

    const target = getPrimaryRuntimeTarget(manifest, arcId);
    if (!target.avatar) {
        return visualProjectionDenied(409, 'VISUAL_PROJECTION_TARGET_UNAVAILABLE');
    }
    const chatReadback = await readVisualProjectionChat({
        originalChatBridge,
        avatar: target.avatar,
        chatId: body.scopeHint?.chatId,
        chatSeedId: getActiveSillyTavernBindings(manifest, arcId)?.chatSeedId,
        sourceMessageIndex: body.sourceMessageIndex,
    });
    if (!chatReadback.ok) {
        return visualProjectionDenied(chatReadback.status, chatReadback.error, chatReadback.extra || {});
    }
    if (body.expectedSourceMessageHash && body.expectedSourceMessageHash !== chatReadback.sourceMessageHash) {
        return visualProjectionDenied(409, 'VISUAL_PROJECTION_SOURCE_MESSAGE_HASH_MISMATCH');
    }

    const issuedAt = requestedAt.toISOString();
    const ttlMs = normalizeProjectionTtlMs(projectionTtlMs);
    const expiresAtMs = nowMs + ttlMs;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const projection = createVisualVisibleProjection({
        release,
        manifest,
        arcId,
        chatId: normalizeChatId(body.scopeHint?.chatId),
        idempotencyKey: body.idempotencyKey,
        target,
        chatReadback,
        visualScope: visualScope.binding,
        createdAt: issuedAt,
    });
    const projectionValidation = validateVisualVisibleProjection(projection);
    if (!projectionValidation.valid) {
        return visualProjectionDenied(500, 'VISUAL_PROJECTION_GENERATED_INVALID', { validation: projectionValidation });
    }
    const stub = createVisualProjectionStub({
        projection,
        visualScope: visualScope.binding,
        expiresAt,
    });
    const stubValidation = validateVisualProjectionStub(stub);
    if (!stubValidation.valid) {
        return visualProjectionDenied(500, 'VISUAL_PROJECTION_STUB_INVALID', { validation: stubValidation });
    }
    const proofResult = createVisualProjectionProof({
        projection,
        visualScope: visualScope.binding,
        projectionSecret,
        issuedAt,
        expiresAt,
        nonceFactory,
        projectionStore,
        nowMs,
    });
    if (!proofResult.ok) {
        return visualProjectionDenied(500, proofResult.error);
    }
    const proofValidation = validateVisualProjectionProofShape(proofResult.proof);
    if (!proofValidation.valid) {
        return visualProjectionDenied(500, 'VISUAL_PROJECTION_PROOF_INVALID', { validation: proofValidation });
    }

    const entry = projectionStore.save({
        idempotencyKey: body.idempotencyKey,
        bodyHash,
        projection,
        stub,
        proof: proofResult.proof,
        evidence: createVisualProjectionEvidence({
            release,
            projection,
            visualScope: visualScope.binding,
        }),
        expiresAtMs,
    }, nowMs);

    return {
        status: 200,
        body: createVisualProjectionResponse(entry, { includeInternalStubEntities }),
    };
}

function validateVisualProjectionRequest(body) {
    const errors = [];
    const allowedKeys = new Set([
        'schemaVersion',
        'requestPurpose',
        'expectedSourceMessageHash',
        'idempotencyKey',
        'requestMode',
        'sourceMessageIndex',
        'scopeHint',
        'entityHints',
        'oldSaveHint',
    ]);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, errors: ['VisualProjectionIssuanceRequestV1 must be an object.'], warnings: [] };
    }
    rejectUnknownRequestKeys(body, allowedKeys, 'request', errors);
    if (body.schemaVersion !== 'galgame.visual-projection-issuance-request.v1') {
        errors.push('request.schemaVersion must be galgame.visual-projection-issuance-request.v1.');
    }
    if (body.requestPurpose !== 'visual-projection') {
        errors.push('request.requestPurpose must be visual-projection.');
    }
    if (!['active-release', 'old-save'].includes(body.requestMode)) {
        errors.push('request.requestMode must be active-release or old-save.');
    }
    validatePatternRequestId(body.idempotencyKey, /^idem_[A-Za-z0-9._:-]{16,120}$/, 'request.idempotencyKey', errors);
    if (!Number.isSafeInteger(body.sourceMessageIndex) || body.sourceMessageIndex < 0) {
        errors.push('request.sourceMessageIndex must be a non-negative safe integer.');
    }
    if (body.expectedSourceMessageHash !== undefined) {
        validateSha256Digest(body.expectedSourceMessageHash, 'request.expectedSourceMessageHash', errors);
    }
    validateVisualProjectionScopeHint(body.scopeHint, errors);
    validateVisualProjectionEntityHints(body.entityHints, errors);
    validateVisualProjectionOldSaveHint(body.oldSaveHint, errors);
    if (body.requestMode === 'active-release' && !body.scopeHint?.chatId) {
        errors.push('request.scopeHint.chatId is required for active-release projection issuance.');
    }
    if (JSON.stringify(body).length > 16 * 1024) {
        errors.push('request body exceeds 16 KiB.');
    }
    return { valid: errors.length === 0, errors, warnings: [] };
}

function validateVisualProjectionScopeHint(scopeHint, errors) {
    const allowedScopeKeys = new Set([
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'chatId',
        'profileId',
        'catalogId',
        'catalogRevision',
        'dictionaryVersion',
    ]);
    if (scopeHint === undefined) {
        return;
    }
    if (!scopeHint || typeof scopeHint !== 'object' || Array.isArray(scopeHint)) {
        errors.push('request.scopeHint must be an object when provided.');
        return;
    }
    rejectUnknownRequestKeys(scopeHint, allowedScopeKeys, 'request.scopeHint', errors);
    for (const key of ['releaseId', 'scenarioId', 'scenarioVersion', 'arcId', 'chatId', 'dictionaryVersion']) {
        if (scopeHint[key] !== undefined) {
            validateGenericRequestId(scopeHint[key], `request.scopeHint.${key}`, errors);
        }
    }
    if (scopeHint.profileId !== undefined) {
        validatePatternRequestId(scopeHint.profileId, /^vprof_[a-z0-9_-]{8,80}$/, 'request.scopeHint.profileId', errors);
    }
    if (scopeHint.catalogId !== undefined) {
        validatePatternRequestId(scopeHint.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'request.scopeHint.catalogId', errors);
    }
    if (scopeHint.catalogRevision !== undefined && (!Number.isSafeInteger(scopeHint.catalogRevision) || scopeHint.catalogRevision < 1)) {
        errors.push('request.scopeHint.catalogRevision must be a positive safe integer when provided.');
    }
}

function validateVisualProjectionEntityHints(entityHints, errors) {
    const allowedEntityKeys = new Set(['entityKey', 'entityType', 'displayLabel']);
    const allowedEntityTypes = new Set(['scene', 'character', 'equipment', 'item', 'skill']);
    if (entityHints === undefined) {
        return;
    }
    if (!Array.isArray(entityHints)) {
        errors.push('request.entityHints must be an array when provided.');
        return;
    }
    if (entityHints.length > 32) {
        errors.push('request.entityHints must contain at most 32 entries.');
    }
    for (const [index, hint] of entityHints.entries()) {
        const label = `request.entityHints[${index}]`;
        if (!hint || typeof hint !== 'object' || Array.isArray(hint)) {
            errors.push(`${label} must be an object.`);
            continue;
        }
        rejectUnknownRequestKeys(hint, allowedEntityKeys, label, errors);
        if (hint.entityKey !== undefined) {
            validatePatternRequestId(hint.entityKey, /^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$/, `${label}.entityKey`, errors);
        }
        if (hint.entityType !== undefined && !allowedEntityTypes.has(hint.entityType)) {
            errors.push(`${label}.entityType is invalid.`);
        }
        if (hint.displayLabel !== undefined && (typeof hint.displayLabel !== 'string' || hint.displayLabel.length > 80 || /[\u0000-\u001F\u007F]/.test(hint.displayLabel))) {
            errors.push(`${label}.displayLabel is invalid.`);
        }
    }
}

function validateVisualProjectionOldSaveHint(oldSaveHint, errors) {
    const allowedOldSaveKeys = new Set(['saveId', 'releaseId', 'profileId', 'catalogId']);
    if (oldSaveHint === undefined) {
        return;
    }
    if (!oldSaveHint || typeof oldSaveHint !== 'object' || Array.isArray(oldSaveHint)) {
        errors.push('request.oldSaveHint must be an object when provided.');
        return;
    }
    rejectUnknownRequestKeys(oldSaveHint, allowedOldSaveKeys, 'request.oldSaveHint', errors);
    for (const key of ['saveId', 'releaseId']) {
        if (oldSaveHint[key] !== undefined) {
            validateGenericRequestId(oldSaveHint[key], `request.oldSaveHint.${key}`, errors);
        }
    }
    if (oldSaveHint.profileId !== undefined) {
        validatePatternRequestId(oldSaveHint.profileId, /^vprof_[a-z0-9_-]{8,80}$/, 'request.oldSaveHint.profileId', errors);
    }
    if (oldSaveHint.catalogId !== undefined) {
        validatePatternRequestId(oldSaveHint.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'request.oldSaveHint.catalogId', errors);
    }
}

async function resolveVisualProjectionRelease(store, body) {
    const scopeHint = body.scopeHint || {};
    const activeRelease = await store.getActiveRelease();
    if (!activeRelease) {
        return { ok: false, status: 404, error: 'ACTIVE_RELEASE_UNAVAILABLE' };
    }
    const requestedReleaseId = normalizeReference(scopeHint.releaseId || activeRelease.releaseId);
    if (requestedReleaseId !== normalizeReference(activeRelease.releaseId)) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_RELEASE_NOT_ACTIVE' };
    }
    if (
        (scopeHint.scenarioId && normalizeReference(scopeHint.scenarioId) !== normalizeReference(activeRelease.scenarioId))
        || (scopeHint.scenarioVersion && normalizeReference(scopeHint.scenarioVersion) !== normalizeReference(activeRelease.scenarioVersion))
    ) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_RELEASE_MISMATCH' };
    }
    const manifest = await store.getManifest(activeRelease.scenarioId, activeRelease.scenarioVersion);
    if (!manifest) {
        return { ok: false, status: 404, error: 'SCENARIO_MANIFEST_NOT_FOUND' };
    }
    const bindingValidation = validateActiveReleaseManifestBinding(activeRelease, manifest, { requirePresentationProfileHash: true });
    if (!bindingValidation.valid) {
        return {
            ok: false,
            status: 403,
            error: 'VISUAL_PROJECTION_RELEASE_PROFILE_INVALID',
            extra: { validation: bindingValidation },
        };
    }
    const arcId = resolveArcId({ release: activeRelease, manifest, requestArcId: scopeHint.arcId });
    if (scopeHint.arcId && normalizeReference(scopeHint.arcId) !== arcId) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_ARC_MISMATCH' };
    }
    if (!findArcBinding(manifest, arcId)) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_ARC_NOT_ALLOWED' };
    }
    return { ok: true, release: activeRelease, manifest, arcId };
}

function resolveVisualScopeBinding(manifest, arcId) {
    const arc = findArcBinding(manifest, arcId);
    const candidates = [
        arc?.visualPresentation,
        arc?.visualSystem,
        manifest?.visualPresentation,
        manifest?.visualSystem,
    ].filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const raw = candidates[0];
    if (!raw) {
        return { ok: false, error: 'VISUAL_PROJECTION_SCOPE_UNAVAILABLE' };
    }
    const binding = {
        profileId: normalizeReference(raw.profileId || raw.visualProfileId),
        profileHash: normalizeReference(raw.profileHash || raw.visualProfileHash),
        catalogId: normalizeReference(raw.catalogId),
        catalogRevision: Number(raw.catalogRevision),
        catalogHash: normalizeReference(raw.catalogHash),
        dictionaryVersion: normalizeReference(raw.dictionaryVersion),
        dictionaryHash: normalizeReference(raw.dictionaryHash),
    };
    const validation = validateVisualScopeShape(binding);
    if (!validation.valid) {
        return { ok: false, error: 'VISUAL_PROJECTION_SCOPE_INVALID', validation };
    }
    return { ok: true, binding };
}

function validateRequestedVisualScope(body, binding) {
    const errors = [];
    const scopeHint = body.scopeHint || {};
    for (const key of ['profileId', 'catalogId', 'catalogRevision', 'dictionaryVersion']) {
        if (scopeHint[key] !== undefined && scopeHint[key] !== binding[key]) {
            errors.push(`request.scopeHint.${key} does not match published visual scope.`);
        }
    }
    return { valid: errors.length === 0, errors, warnings: [] };
}

function validateVisualScopeShape(binding) {
    const errors = [];
    validatePatternRequestId(binding.profileId, /^vprof_[a-z0-9_-]{8,80}$/, 'visualScope.profileId', errors);
    validateSha256Digest(binding.profileHash, 'visualScope.profileHash', errors);
    validatePatternRequestId(binding.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'visualScope.catalogId', errors);
    if (!Number.isInteger(binding.catalogRevision) || binding.catalogRevision < 1) {
        errors.push('visualScope.catalogRevision must be a positive integer.');
    }
    validateSha256Digest(binding.catalogHash, 'visualScope.catalogHash', errors);
    validateGenericRequestId(binding.dictionaryVersion, 'visualScope.dictionaryVersion', errors);
    validateSha256Digest(binding.dictionaryHash, 'visualScope.dictionaryHash', errors);
    return { valid: errors.length === 0, errors, warnings: [] };
}

async function readVisualProjectionChat({
    originalChatBridge,
    avatar,
    chatId,
    chatSeedId,
    sourceMessageIndex,
}) {
    if (!originalChatBridge) {
        return { ok: false, status: 503, error: 'ORIGINAL_CHAT_BRIDGE_UNAVAILABLE' };
    }
    const normalizedChatId = normalizeChatId(chatId);
    const normalizedSeedId = normalizeChatId(chatSeedId);
    let targetChat;
    let seedChat = null;
    try {
        const chats = await originalChatBridge.listCharacterChats({ avatar });
        if (!chatListContains(chats, normalizedChatId)) {
            return { ok: false, status: 403, error: 'VISUAL_PROJECTION_CHAT_NOT_ALLOWED' };
        }
        targetChat = await originalChatBridge.getCharacterChat({ avatar, fileName: normalizedChatId });
        if (normalizedSeedId) {
            if (!chatListContains(chats, normalizedSeedId)) {
                return { ok: false, status: 403, error: 'VISUAL_PROJECTION_SEED_CHAT_NOT_ALLOWED' };
            }
            seedChat = await originalChatBridge.getCharacterChat({ avatar, fileName: normalizedSeedId });
        }
    } catch {
        return { ok: false, status: 503, error: 'ORIGINAL_CHAT_READBACK_UNAVAILABLE' };
    }
    if (!Array.isArray(targetChat) || !targetChat.length) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_CHAT_NOT_ALLOWED' };
    }
    if (seedChat && normalizedChatId !== normalizedSeedId && !isChatDerivedFromSeed(seedChat, targetChat)) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_CHAT_NOT_SEED_DERIVED' };
    }
    const visibleMessages = normalizeOriginalVisibleChatMessages(targetChat);
    const selected = selectVisibleChatMessage(visibleMessages, sourceMessageIndex);
    if (!selected.ok) {
        return selected;
    }
    const canonical = {
        index: selected.message.index,
        isUser: Boolean(selected.message.isUser),
        role: selected.message.role,
        speaker: normalizeReference(selected.message.speaker),
        text: selected.message.text,
    };
    return {
        ok: true,
        chat: targetChat,
        sourceMessageIndex: selected.message.index,
        sourceMessageHash: sha256Digest(canonicalJson(canonical)),
        visibleTextDigest: sha256Digest(canonical.text),
        canonicalMessage: canonical,
    };
}

function selectVisibleChatMessage(visibleMessages, sourceMessageIndex) {
    if (sourceMessageIndex !== undefined) {
        const message = visibleMessages.find((candidate) => candidate.index === sourceMessageIndex);
        if (!message) {
            return { ok: false, status: 400, error: 'VISUAL_PROJECTION_SOURCE_MESSAGE_UNAVAILABLE' };
        }
        return { ok: true, message };
    }
    const message = visibleMessages[visibleMessages.length - 1];
    if (message) {
        return { ok: true, message };
    }
    return { ok: false, status: 409, error: 'VISUAL_PROJECTION_VISIBLE_MESSAGE_UNAVAILABLE' };
}

function createVisualVisibleProjection({
    release,
    manifest,
    arcId,
    chatId,
    idempotencyKey,
    target,
    chatReadback,
    visualScope,
    createdAt,
}) {
    const base = {
        schemaVersion: VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION,
        projectionId: 'vvp_pendingprojection',
        projectionHash: sha256Digest('pending'),
        source: 'target-chat-readback',
        releaseId: normalizeReference(release.releaseId),
        scenarioId: normalizeReference(release.scenarioId),
        scenarioVersion: normalizeReference(release.scenarioVersion),
        arcId,
        chatId,
        characterRef: {
            mode: target.groupId ? 'group' : 'single-character',
            refHash: sha256Digest(target.groupId || target.characterId || target.avatar),
        },
        sourceMessageIndex: chatReadback.sourceMessageIndex,
        sourceMessageHash: chatReadback.sourceMessageHash,
        visibleTextDigest: chatReadback.visibleTextDigest,
        locale: detectProjectionLocale(chatReadback.canonicalMessage.text, manifest.locale),
        entities: createVisualProjectionEntities(chatReadback.canonicalMessage),
        extractorVersion: VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION,
        dictionaryVersion: visualScope.dictionaryVersion,
        dictionaryHash: visualScope.dictionaryHash,
        createdAt,
    };
    const projectionId = createPrefixedId('vvp', [
        base.releaseId,
        base.arcId,
        base.chatId,
        base.sourceMessageIndex,
        base.sourceMessageHash,
        base.dictionaryVersion,
        idempotencyKey,
    ]);
    const projectionHash = sha256Digest(canonicalJson({
        ...base,
        projectionId,
        projectionHash: '',
    }));
    return { ...base, projectionId, projectionHash };
}

function createVisualProjectionEntities(message) {
    return createVisualProjectionEntityHints(message).map((entity) => ({
        entityKey: createEntityKey(entity.entityType, entity.entityKeySeed),
        entityType: entity.entityType,
        displayLabel: entity.displayLabel,
        visibleAttributes: entity.visibleAttributes,
        confidenceBand: entity.confidenceBand,
    }));
}

function createVisualProjectionStub({ projection, visualScope, expiresAt }) {
    return {
        schemaVersion: VISUAL_PROJECTION_STUB_PROTOCOL_VERSION,
        projectionId: projection.projectionId,
        projectionHash: projection.projectionHash,
        sourceMessageHash: projection.sourceMessageHash,
        releaseId: projection.releaseId,
        scenarioId: projection.scenarioId,
        scenarioVersion: projection.scenarioVersion,
        arcId: projection.arcId,
        chatId: projection.chatId,
        profileId: visualScope.profileId,
        profileHash: visualScope.profileHash,
        catalogId: visualScope.catalogId,
        catalogRevision: visualScope.catalogRevision,
        catalogHash: visualScope.catalogHash,
        sourceMessageIndex: projection.sourceMessageIndex,
        entities: projection.entities,
        extractorVersion: projection.extractorVersion,
        dictionaryVersion: projection.dictionaryVersion,
        dictionaryHash: projection.dictionaryHash,
        expiresAt,
    };
}

function createVisualProjectionProof({
    projection,
    visualScope,
    projectionSecret,
    issuedAt,
    expiresAt,
    nonceFactory,
    projectionStore,
    nowMs,
}) {
    let nonce = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        nonce = nonceFactory();
        if (!projectionStore.hasNonce(nonce, nowMs)) {
            break;
        }
        nonce = '';
    }
    if (!nonce) {
        return { ok: false, error: 'VISUAL_PROJECTION_NONCE_CONFLICT' };
    }
    const unsigned = {
        schemaVersion: VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION,
        audience: 'visual-asset-service',
        purpose: 'visual-match',
        projectionId: projection.projectionId,
        projectionHash: projection.projectionHash,
        sourceMessageHash: projection.sourceMessageHash,
        releaseId: projection.releaseId,
        scenarioId: projection.scenarioId,
        scenarioVersion: projection.scenarioVersion,
        arcId: projection.arcId,
        chatId: projection.chatId,
        profileId: visualScope.profileId,
        profileHash: visualScope.profileHash,
        catalogId: visualScope.catalogId,
        catalogRevision: visualScope.catalogRevision,
        catalogHash: visualScope.catalogHash,
        sourceMessageIndex: projection.sourceMessageIndex,
        extractorVersion: projection.extractorVersion,
        dictionaryVersion: projection.dictionaryVersion,
        dictionaryHash: projection.dictionaryHash,
        nonce,
        issuedAt,
        expiresAt,
        signature: '',
    };
    return {
        ok: true,
        proof: {
            ...unsigned,
            signature: createHmac('sha256', projectionSecret)
                .update(canonicalJson(unsigned))
                .digest('base64url'),
        },
    };
}

function createVisualProjectionEvidence({ release, projection, visualScope }) {
    return {
        releaseId: projection.releaseId,
        scenarioId: projection.scenarioId,
        scenarioVersion: projection.scenarioVersion,
        arcId: projection.arcId,
        chatIdHash: sha256Digest(projection.chatId).slice(0, 23),
        sourceMessageIndex: projection.sourceMessageIndex,
        sourceMessageHash: projection.sourceMessageHash,
        profileId: visualScope.profileId,
        profileHash: visualScope.profileHash,
        catalogId: visualScope.catalogId,
        catalogRevision: visualScope.catalogRevision,
        catalogHash: visualScope.catalogHash,
        dictionaryVersion: visualScope.dictionaryVersion,
        dictionaryHash: visualScope.dictionaryHash,
        entityCount: projection.entities.length,
        source: 'config-service-target-chat-readback',
        releaseContentHash: normalizeReference(release.contentHash || '').slice(0, 80),
    };
}

function createVisualProjectionResponse(entry, { includeInternalStubEntities = false } = {}) {
    return {
        ok: true,
        protocolVersion: 'galgame.visual-projection-response.v1',
        projection: entry.projection,
        stub: {
            projectionId: entry.stub.projectionId,
            projectionHash: entry.stub.projectionHash,
            expiresAt: entry.stub.expiresAt,
            ...(includeInternalStubEntities ? { entities: entry.stub.entities } : {}),
        },
        proof: entry.proof,
        evidence: entry.evidence,
    };
}

function visualProjectionDenied(status, error, extra = {}) {
    return {
        status,
        body: {
            ok: false,
            error,
            ...extra,
        },
    };
}

async function createPlayerVisualBundle({
    request,
    url,
    store,
    visualProjectionSecret,
    visualProjectionTtlMs,
    visualProjectionStore,
    visualProjectionNonceFactory,
    originalChatBridge,
    playerVisualGatewayOrigins,
    playerVisualGatewayTrustedProxyMode,
    playerVisualGatewaySessionHeader,
    playerVisualGatewayCsrfHeader,
    playerVisualGatewayCsrfCookie,
    playerVisualSessionReader,
    playerVisualAssetTicketStore,
    visualMatchInternalBaseUrl,
    visualMatchServiceToken,
    visualMatchInternalTimeoutMs,
    visualAssetServiceBaseUrl,
    visualAssetInternalReadToken,
    visualAssetInternalTimeoutMs,
}) {
    const auth = await authorizePlayerVisualBundleRequest({
        request,
        url,
        playerVisualGatewayOrigins,
        playerVisualGatewayTrustedProxyMode,
        playerVisualGatewaySessionHeader,
        playerVisualGatewayCsrfHeader,
        playerVisualGatewayCsrfCookie,
        playerVisualSessionReader,
    });
    if (!auth.ok) {
        return playerVisualDenied(auth.status, auth.error, auth.corsOrigin);
    }

    let body;
    try {
        body = await readJsonLimited(request, PLAYER_VISUAL_REQUEST_MAX_BYTES);
    } catch {
        return playerVisualDenied(400, 'VISUAL_PLAYER_REQUEST_INVALID', auth.corsOrigin);
    }
    const requestValidation = validatePlayerVisualBundleRequest(body);
    if (!requestValidation.valid) {
        return playerVisualDenied(400, 'VISUAL_PLAYER_REQUEST_INVALID', auth.corsOrigin, { validation: requestValidation });
    }

    const projectionResult = await issueVisualProjection({
        body: createProjectionRequestFromPlayerBundle({
            body,
            session: auth.session,
        }),
        store,
        projectionSecret: visualProjectionSecret,
        projectionTtlMs: visualProjectionTtlMs,
        originalChatBridge,
        projectionStore: visualProjectionStore,
        nonceFactory: visualProjectionNonceFactory,
        includeInternalStubEntities: true,
    });
    if (projectionResult.status !== 200 || projectionResult.body?.ok !== true) {
        return createRecoveryBundleResponse({
            status: 200,
            code: mapProjectionErrorToPlayerRecovery(projectionResult.body?.error),
            request: body,
            createdAt: new Date().toISOString(),
            corsOrigin: auth.corsOrigin,
        });
    }

    const { projection, proof } = projectionResult.body;
    const selectedEntities = resolveRequestedProjectionEntities(projectionResult.body.stub, projection, body.requestedEntityKeys);
    if (!selectedEntities.ok) {
        return createRecoveryBundleResponse({
            status: selectedEntities.status,
            code: selectedEntities.error,
            request: body,
            projection,
            proof,
            selectedEntityKeys: selectedEntities.selectedEntityKeys || [],
            createdAt: new Date().toISOString(),
            corsOrigin: auth.corsOrigin,
        });
    }
    const selectedEntityKeys = selectedEntities.selectedEntityKeys;

    const bindings = [];
    const matchResults = [];
    const ticketRefs = [];
    for (const entity of selectedEntities.entities) {
        const internalIdempotencyKey = createPrefixedId('idem', [body.idempotencyKey, projection.projectionId, entity.entityKey]);
        const matchResult = await callInternalVisualMatch({
            baseUrl: visualMatchInternalBaseUrl,
            serviceToken: visualMatchServiceToken,
            timeoutMs: visualMatchInternalTimeoutMs,
            proof,
            requestBody: {
                schemaVersion: 'galgame.visual-match-request.v1',
                requestId: createPrefixedId('req', [body.requestId, projection.projectionId, entity.entityKey]),
                projectionId: projection.projectionId,
                entityKey: entity.entityKey,
                entityType: entity.entityType,
                idempotencyKey: internalIdempotencyKey,
            },
        });
        if (!matchResult.ok) {
            return createRecoveryBundleResponse({
                status: 200,
                code: matchResult.recoveryCode || 'VISUAL_PLAYER_MATCH_UNAVAILABLE',
                request: body,
                projection,
                proof,
                selectedEntityKeys,
                createdAt: new Date().toISOString(),
                corsOrigin: auth.corsOrigin,
            });
        }
        const context = createMatchScopeContext(proof);
        const resultValidation = validateVisualMatchResult(matchResult.result, context);
        if (!resultValidation.valid) {
            return createRecoveryBundleResponse({
                status: 200,
                code: 'VISUAL_PLAYER_BUNDLE_PARTIAL',
                request: body,
                projection,
                proof,
                selectedEntityKeys,
                createdAt: new Date().toISOString(),
                corsOrigin: auth.corsOrigin,
            });
        }
        const publicBinding = createResponseOnlyVisualBindingFromResult({
            result: matchResult.result,
            proof,
            idempotencyKey: internalIdempotencyKey,
        });
        const bindingValidation = validateVisualBinding(publicBinding, context);
        if (!bindingValidation.valid) {
            return createRecoveryBundleResponse({
                status: 200,
                code: 'VISUAL_PLAYER_BUNDLE_PARTIAL',
                request: body,
                projection,
                proof,
                selectedEntityKeys,
                createdAt: new Date().toISOString(),
                corsOrigin: auth.corsOrigin,
            });
        }
        bindings.push(publicBinding);
        matchResults.push(matchResult.result);
        const ticket = await createPlayerVisualAssetTicketForResult({
            store: playerVisualAssetTicketStore,
            session: auth.session,
            request: body,
            proof,
            projection,
            result: matchResult.result,
            binding: publicBinding,
            baseUrl: visualAssetServiceBaseUrl,
            serviceToken: visualAssetInternalReadToken,
            timeoutMs: visualAssetInternalTimeoutMs,
        });
        if (ticket.ok) {
            ticketRefs.push(ticket.ref);
        }
    }

    return {
        status: 200,
        corsOrigin: auth.corsOrigin,
        body: createPlayerVisualBundleBody({
            request: body,
            projection,
            proof,
            selectedEntityKeys,
            bindings,
            matchResults,
            assetReadTickets: ticketRefs,
            mode: 'current-release',
        }),
    };
}

function validatePlayerVisualBundleRequest(body) {
    const errors = [];
    const allowedKeys = new Set([
        'schemaVersion',
        'requestId',
        'idempotencyKey',
        'sourceMessageIndex',
        'expectedSourceMessageHash',
        'requestedEntityKeys',
    ]);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, errors: ['PlayerVisualBundleRequestV1 must be an object.'], warnings: [] };
    }
    rejectUnknownRequestKeys(body, allowedKeys, 'request', errors);
    if (body.schemaVersion !== PLAYER_VISUAL_BUNDLE_REQUEST_VERSION) {
        errors.push(`request.schemaVersion must be ${PLAYER_VISUAL_BUNDLE_REQUEST_VERSION}.`);
    }
    validatePatternRequestId(body.requestId, /^pvbr_[a-z0-9_-]{16,80}$/, 'request.requestId', errors);
    validatePatternRequestId(body.idempotencyKey, /^idem_[A-Za-z0-9._:-]{16,120}$/, 'request.idempotencyKey', errors);
    if (!Number.isSafeInteger(body.sourceMessageIndex) || body.sourceMessageIndex < 0 || body.sourceMessageIndex > 100000) {
        errors.push('request.sourceMessageIndex must be an integer between 0 and 100000.');
    }
    if (!Object.hasOwn(body, 'expectedSourceMessageHash')) {
        errors.push('request.expectedSourceMessageHash must be present as null or a sha256 digest.');
    } else if (body.expectedSourceMessageHash !== null) {
        validateSha256Digest(body.expectedSourceMessageHash, 'request.expectedSourceMessageHash', errors);
    }
    if (Object.hasOwn(body, 'requestedEntityKeys') && (!Array.isArray(body.requestedEntityKeys) || body.requestedEntityKeys.length > 32)) {
        errors.push('request.requestedEntityKeys must be an array with 0..32 entries when present.');
    } else if (Array.isArray(body.requestedEntityKeys) && body.requestedEntityKeys.length > 0) {
        const seen = new Set();
        for (const [index, entityKey] of body.requestedEntityKeys.entries()) {
            validatePatternRequestId(entityKey, /^entity_(scene|character|equipment|item|skill)_[a-z0-9._:-]{8,72}$/, `request.requestedEntityKeys[${index}]`, errors);
            if (seen.has(entityKey)) {
                errors.push('request.requestedEntityKeys must be unique.');
            }
            seen.add(entityKey);
        }
    }
    if (JSON.stringify(body).length > PLAYER_VISUAL_REQUEST_MAX_BYTES) {
        errors.push('request body exceeds 16 KiB.');
    }
    return { valid: errors.length === 0, errors, warnings: [] };
}

async function authorizePlayerVisualBundleRequest({
    request,
    url,
    playerVisualGatewayOrigins,
    playerVisualGatewayTrustedProxyMode,
    playerVisualGatewaySessionHeader,
    playerVisualGatewayCsrfHeader,
    playerVisualGatewayCsrfCookie,
    playerVisualSessionReader,
}) {
    const origin = request.headers.origin;
    const originSet = parseOriginSet(playerVisualGatewayOrigins);
    if (!origin || !originSet.has(origin)) {
        return { ok: false, status: 403, error: 'VISUAL_PLAYER_ORIGIN_REJECTED' };
    }
    if (url.search || request.headers.authorization || request.headers['x-galgame-visual-projection-proof'] || request.headers['x-galgame-visual-restore-proof'] || request.headers['x-galgame-visual-asset-proof']) {
        return { ok: false, status: 400, error: 'VISUAL_PLAYER_FORBIDDEN_TRANSPORT', corsOrigin: origin };
    }
    if (playerVisualGatewayTrustedProxyMode !== 'required') {
        return { ok: false, status: 503, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin };
    }
    if (
        String(playerVisualGatewaySessionHeader || '') !== 'X-Galgame-Player-Session'
        || String(playerVisualGatewayCsrfHeader || '') !== 'X-Galgame-Player-CSRF'
        || String(playerVisualGatewayCsrfCookie || '') !== PLAYER_VISUAL_CSRF_COOKIE
    ) {
        return { ok: false, status: 503, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin };
    }
    if (!playerVisualSessionReader) {
        return { ok: false, status: 503, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin };
    }
    const sessionId = getSingleHeaderValue(request, PLAYER_VISUAL_SESSION_HEADER);
    if (!isSafeAsciiToken(sessionId, 8, 256)) {
        return { ok: false, status: 401, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin };
    }
    const csrfHeader = getSingleHeaderValue(request, PLAYER_VISUAL_CSRF_HEADER);
    const csrfCookie = parseCookieHeader(request.headers.cookie || '')[PLAYER_VISUAL_CSRF_COOKIE];
    if (!isSafeAsciiToken(csrfHeader, 16, 256) || csrfHeader !== csrfCookie) {
        return { ok: false, status: 403, error: 'VISUAL_PLAYER_CSRF_INVALID', corsOrigin: origin };
    }
    const session = await readPlayerVisualSession(playerVisualSessionReader, sessionId);
    if (!session.ok) {
        return { ok: false, status: session.status, error: session.error, corsOrigin: origin };
    }
    if (session.session.csrfToken !== csrfHeader) {
        return { ok: false, status: 403, error: 'VISUAL_PLAYER_CSRF_INVALID', corsOrigin: origin };
    }
    return { ok: true, session: session.session, corsOrigin: origin };
}

async function readPlayerVisualSession(reader, sessionId) {
    try {
        const value = typeof reader === 'function'
            ? await reader(sessionId)
            : await reader.readPlayerVisualSession(sessionId);
        const session = normalizePlayerVisualSession(value, sessionId);
        return { ok: true, session };
    } catch (error) {
        return {
            ok: false,
            status: error.status || 401,
            error: error.code || 'VISUAL_PLAYER_AUTH_REQUIRED',
        };
    }
}

function normalizePlayerVisualSession(value, sessionId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw httpInputError(401, 'VISUAL_PLAYER_AUTH_REQUIRED');
    }
    const normalized = {
        sessionId,
        csrfToken: normalizeReference(value.csrfToken),
        chatId: normalizeChatId(value.chatId),
    };
    if (!isSafeAsciiToken(normalized.csrfToken, 16, 256) || !normalized.chatId) {
        throw httpInputError(401, 'VISUAL_PLAYER_AUTH_REQUIRED');
    }
    return normalized;
}

function createProjectionRequestFromPlayerBundle({ body, session }) {
    return {
        schemaVersion: 'galgame.visual-projection-issuance-request.v1',
        requestPurpose: 'visual-projection',
        expectedSourceMessageHash: body.expectedSourceMessageHash || undefined,
        idempotencyKey: createPrefixedId('idem', ['player-visual-bundle', body.idempotencyKey, session.sessionId, session.chatId, body.sourceMessageIndex]),
        requestMode: 'active-release',
        sourceMessageIndex: body.sourceMessageIndex,
        scopeHint: {
            chatId: session.chatId,
        },
    };
}

function resolveRequestedProjectionEntities(stubSummary, projection, requestedEntityKeys) {
    const entities = projection?.entities || [];
    if (stubSummary?.projectionId && stubSummary.projectionId !== projection.projectionId) {
        return { ok: false, status: 409, error: 'VISUAL_PLAYER_SCOPE_INVALID', selectedEntityKeys: [] };
    }
    if (!Array.isArray(stubSummary?.entities)) {
        return { ok: false, status: 409, error: 'VISUAL_PLAYER_SCOPE_INVALID', selectedEntityKeys: [] };
    }
    const stubEntities = stubSummary.entities;
    const seenStubKeys = new Set();
    for (const entity of stubEntities) {
        if (!entity?.entityKey || seenStubKeys.has(entity.entityKey)) {
            return { ok: false, status: 409, error: 'VISUAL_PLAYER_SCOPE_INVALID', selectedEntityKeys: [] };
        }
        seenStubKeys.add(entity.entityKey);
    }
    const explicitSelection = Array.isArray(requestedEntityKeys) && requestedEntityKeys.length > 0;
    const selectedEntityKeys = explicitSelection
        ? requestedEntityKeys
        : stubEntities
            .filter((entity) => ['scene', 'character', 'equipment', 'item', 'skill'].includes(entity?.entityType))
            .map((entity) => entity.entityKey);
    if (selectedEntityKeys.length < 1) {
        return { ok: false, status: 200, error: 'VISUAL_PLAYER_NO_BINDABLE_ENTITIES', selectedEntityKeys: [] };
    }
    if (selectedEntityKeys.length > 32) {
        return { ok: false, status: 200, error: 'VISUAL_PLAYER_TOO_MANY_ENTITIES', selectedEntityKeys: [] };
    }
    const results = [];
    const seenSelectedKeys = new Set();
    for (const entityKey of selectedEntityKeys) {
        if (seenSelectedKeys.has(entityKey)) {
            return { ok: false, status: 409, error: 'VISUAL_PLAYER_SCOPE_INVALID', selectedEntityKeys: [] };
        }
        seenSelectedKeys.add(entityKey);
        const stubEntity = stubEntities.find((item) => item.entityKey === entityKey);
        const entity = entities.find((item) => item.entityKey === entityKey);
        if (!stubEntity || !entity || entity.entityType === 'unknown' || stubEntity.entityType !== entity.entityType) {
            return { ok: false, status: 409, error: 'VISUAL_PLAYER_SCOPE_INVALID', selectedEntityKeys: [] };
        }
        results.push(entity);
    }
    return { ok: true, entities: results, selectedEntityKeys };
}

async function callInternalVisualMatch({
    baseUrl,
    serviceToken,
    timeoutMs,
    proof,
    requestBody,
}) {
    if (!baseUrl || !serviceToken || !isSafeAsciiToken(serviceToken, 32, 256)) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    let endpoint;
    try {
        const base = new URL(baseUrl);
        endpoint = new URL('/v1/internal/visual-match', base.origin);
        if (endpoint.origin !== base.origin) {
            return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
        }
    } catch {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(Number(timeoutMs) || VISUAL_MATCH_INTERNAL_TIMEOUT_MS, VISUAL_MATCH_INTERNAL_TIMEOUT_MS)));
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json',
                'x-galgame-visual-projection-proof': Buffer.from(canonicalJson(proof), 'utf8').toString('base64url'),
                accept: 'application/json',
            },
            body: canonicalJson(requestBody),
            redirect: 'manual',
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timeout);
        return { ok: false, recoveryCode: error?.name === 'AbortError' ? 'VISUAL_PLAYER_TIMEOUT' : 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    clearTimeout(timeout);
    if (response.status >= 300 && response.status < 400) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > VISUAL_MATCH_INTERNAL_MAX_BYTES) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_BUNDLE_PARTIAL' };
    }
    let data;
    try {
        const text = bytes.toString('utf8');
        assertNoDuplicateJsonKeys(text);
        data = JSON.parse(text);
    } catch {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    if (!response.ok || data?.ok !== true || !data.result) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_MATCH_UNAVAILABLE' };
    }
    return { ok: true, result: data.result };
}

async function createPlayerVisualAssetTicketForResult({
    store,
    session,
    request,
    proof,
    projection,
    result,
    binding,
    baseUrl,
    serviceToken,
    timeoutMs,
}) {
    if (!store || !baseUrl || !serviceToken || !isSafeAsciiToken(serviceToken, 32, 256)) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    }
    const metadata = await callInternalVisualAssetMetadataResolve({
        baseUrl,
        serviceToken,
        timeoutMs,
        requestBody: createInternalAssetMetadataResolveRequest({ request, proof, result, binding }),
    });
    if (!metadata.ok) return metadata;
    if (!validateInternalAssetMetadataForBundle({ metadata: metadata.body, proof, result, binding })) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    }
    const issuedAt = new Date().toISOString();
    const expiresAt = minIsoTimestamp(result.expiresAt, proof.expiresAt, new Date(Date.parse(issuedAt) + PLAYER_VISUAL_BUNDLE_MAX_TTL_MS).toISOString());
    const ticketId = createPrefixedId('vat', [request.requestId, projection.projectionId, result.bindingId, result.assetId, expiresAt]);
    const record = {
        schemaVersion: PLAYER_VISUAL_ASSET_TICKET_RECORD_VERSION,
        ticketId,
        playerSessionHash: sha256Digest(session.sessionId),
        requestId: request.requestId,
        bundleIdSeed: projection.projectionId,
        bindingId: binding.bindingId,
        entityKey: binding.entityKey,
        assetType: binding.bindingType,
        assetId: binding.assetId,
        assetVersion: binding.assetVersion,
        assetContentSha256: toPrefixedSha256(binding.assetContentSha256),
        assetMetadataHash: metadata.body.assetMetadataHash,
        catalogRefHash: metadata.body.catalogRefHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        canonicalMime: metadata.body.canonicalMime,
        createdAt: issuedAt,
        expiresAt,
    };
    store.put(record);
    return {
        ok: true,
        ref: {
            schemaVersion: PLAYER_VISUAL_ASSET_TICKET_REF_VERSION,
            ticketId,
            proxyPath: `/v1/player/visual-assets/${ticketId}/content`,
            bindingId: binding.bindingId,
            entityKey: binding.entityKey,
            assetId: binding.assetId,
            assetVersion: binding.assetVersion,
            expiresAt,
        },
    };
}

function createInternalAssetMetadataResolveRequest({ request, proof, result, binding }) {
    return {
        schemaVersion: 'galgame.visual-asset-internal-metadata-resolve-request.v1',
        requestId: createPrefixedId('req', ['asset-metadata', request.requestId, binding.assetId, binding.assetVersion]),
        assetType: binding.bindingType,
        assetId: binding.assetId,
        assetVersion: binding.assetVersion,
        assetContentSha256: toPrefixedSha256(binding.assetContentSha256),
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        canonicalMime: 'image/png',
    };
}

function createInternalAssetContentReadRequest({ ticket }) {
    return {
        schemaVersion: 'galgame.visual-asset-internal-content-read-request.v1',
        requestId: createPrefixedId('req', ['asset-content', ticket.ticketId, ticket.bindingId]),
        ticketId: ticket.ticketId,
        bindingId: ticket.bindingId,
        entityKey: ticket.entityKey,
        assetType: ticket.assetType,
        assetId: ticket.assetId,
        assetVersion: ticket.assetVersion,
        assetContentSha256: ticket.assetContentSha256,
        assetMetadataHash: ticket.assetMetadataHash,
        catalogRefHash: ticket.catalogRefHash,
        catalogId: ticket.catalogId,
        catalogRevision: ticket.catalogRevision,
        catalogHash: ticket.catalogHash,
        canonicalMime: ticket.canonicalMime,
    };
}

async function callInternalVisualAssetMetadataResolve({ baseUrl, serviceToken, timeoutMs, requestBody }) {
    const response = await callInternalVisualAssetJson({
        baseUrl,
        serviceToken,
        timeoutMs,
        pathName: '/v1/internal/assets/metadata-resolve',
        requestBody,
    });
    if (!response.ok || response.body?.ok !== true) return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    return { ok: true, body: response.body };
}

async function callInternalVisualAssetJson({ baseUrl, serviceToken, timeoutMs, pathName, requestBody }) {
    const endpoint = createFixedInternalEndpoint(baseUrl, pathName);
    if (!endpoint) return { ok: false };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(Number(timeoutMs) || VISUAL_ASSET_INTERNAL_TIMEOUT_MS, VISUAL_ASSET_INTERNAL_TIMEOUT_MS)));
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json',
                accept: 'application/json',
            },
            body: canonicalJson(requestBody),
            redirect: 'manual',
            signal: controller.signal,
        });
    } catch {
        clearTimeout(timeout);
        return { ok: false };
    }
    clearTimeout(timeout);
    if (response.status >= 300 && response.status < 400) return { ok: false };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > VISUAL_ASSET_INTERNAL_MAX_JSON_BYTES) return { ok: false };
    try {
        const text = bytes.toString('utf8');
        assertNoDuplicateJsonKeys(text);
        return { ok: response.ok, body: JSON.parse(text) };
    } catch {
        return { ok: false };
    }
}

async function callInternalVisualAssetContentRead({ baseUrl, serviceToken, timeoutMs, requestBody }) {
    const endpoint = createFixedInternalEndpoint(baseUrl, '/v1/internal/assets/content-read');
    if (!endpoint || !serviceToken || !isSafeAsciiToken(serviceToken, 32, 256)) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1, Math.min(Number(timeoutMs) || VISUAL_ASSET_INTERNAL_TIMEOUT_MS, VISUAL_ASSET_INTERNAL_TIMEOUT_MS)));
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${serviceToken}`,
                'content-type': 'application/json',
                accept: 'image/png,application/json',
            },
            body: canonicalJson(requestBody),
            redirect: 'manual',
            signal: controller.signal,
        });
    } catch {
        clearTimeout(timeout);
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    }
    clearTimeout(timeout);
    if (response.status >= 300 && response.status < 400) return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    if (bytes.length <= 0 || bytes.length > VISUAL_ASSET_INTERNAL_MAX_CONTENT_BYTES) return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const contentHash = String(response.headers.get(VISUAL_ASSET_INTERNAL_CONTENT_HASH_HEADER) || '');
    if (contentType !== 'image/png' || contentHash !== sha256BytesHex(bytes)) {
        return { ok: false, recoveryCode: 'VISUAL_PLAYER_ASSET_UNAVAILABLE' };
    }
    return { ok: true, bytes, contentType };
}

function createFixedInternalEndpoint(baseUrl, pathName) {
    try {
        const base = new URL(baseUrl);
        const endpoint = new URL(pathName, base.origin);
        if (endpoint.origin !== base.origin || endpoint.pathname !== pathName) return null;
        return endpoint;
    } catch {
        return null;
    }
}

function validateInternalAssetMetadataForBundle({ metadata, proof, result, binding }) {
    if (!metadata || metadata.ok !== true) return false;
    const required = [
        'ok',
        'schemaVersion',
        'requestId',
        'assetType',
        'assetId',
        'assetVersion',
        'assetContentSha256',
        'assetMetadataHash',
        'catalogRefHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'canonicalMime',
    ];
    if (Object.keys(metadata).sort().join('\u0000') !== required.sort().join('\u0000')) return false;
    return metadata.schemaVersion === 'galgame.visual-asset-internal-metadata-resolve-response.v1'
        && metadata.assetType === binding.bindingType
        && metadata.assetId === binding.assetId
        && metadata.assetVersion === binding.assetVersion
        && metadata.assetContentSha256 === toPrefixedSha256(binding.assetContentSha256)
        && /^sha256:[a-f0-9]{64}$/.test(metadata.assetMetadataHash)
        && /^sha256:[a-f0-9]{64}$/.test(metadata.catalogRefHash)
        && metadata.catalogId === proof.catalogId
        && metadata.catalogRevision === proof.catalogRevision
        && metadata.catalogHash === proof.catalogHash
        && metadata.canonicalMime === 'image/png'
        && result.bindingId === binding.bindingId;
}

async function handlePlayerVisualAssetContent({
    request,
    url,
    ticketId,
    playerVisualGatewayOrigins,
    playerVisualGatewayTrustedProxyMode,
    playerVisualGatewaySessionHeader,
    playerVisualSessionReader,
    playerVisualAssetTicketStore,
    visualAssetServiceBaseUrl,
    visualAssetInternalReadToken,
    visualAssetInternalTimeoutMs,
}) {
    const auth = await authorizePlayerVisualAssetContentRequest({
        request,
        url,
        playerVisualGatewayOrigins,
        playerVisualGatewayTrustedProxyMode,
        playerVisualGatewaySessionHeader,
        playerVisualSessionReader,
    });
    if (!auth.ok) return playerVisualDenied(auth.status, auth.error, auth.corsOrigin);
    const ticket = playerVisualAssetTicketStore?.get(ticketId, auth.session);
    if (!ticket) return playerVisualDenied(404, 'VISUAL_PLAYER_ASSET_UNAVAILABLE', auth.corsOrigin);
    const content = await callInternalVisualAssetContentRead({
        baseUrl: visualAssetServiceBaseUrl,
        serviceToken: visualAssetInternalReadToken,
        timeoutMs: visualAssetInternalTimeoutMs,
        requestBody: createInternalAssetContentReadRequest({ ticket }),
    });
    if (!content.ok) return playerVisualDenied(502, content.recoveryCode || 'VISUAL_PLAYER_ASSET_UNAVAILABLE', auth.corsOrigin);
    return {
        status: 200,
        corsOrigin: auth.corsOrigin,
        bytes: content.bytes,
        contentType: content.contentType,
    };
}

async function authorizePlayerVisualAssetContentRequest({
    request,
    url,
    playerVisualGatewayOrigins,
    playerVisualGatewayTrustedProxyMode,
    playerVisualGatewaySessionHeader,
    playerVisualSessionReader,
}) {
    const origin = request.headers.origin;
    const originSet = parseOriginSet(playerVisualGatewayOrigins);
    if (origin && !originSet.has(origin)) {
        return { ok: false, status: 403, error: 'VISUAL_PLAYER_ORIGIN_REJECTED' };
    }
    if (url.search || request.headers.authorization || request.headers.cookie || request.headers['x-galgame-visual-projection-proof'] || request.headers['x-galgame-visual-restore-proof'] || request.headers['x-galgame-visual-asset-proof']) {
        return { ok: false, status: 400, error: 'VISUAL_PLAYER_FORBIDDEN_TRANSPORT', corsOrigin: origin || '' };
    }
    if (playerVisualGatewayTrustedProxyMode !== 'required' || String(playerVisualGatewaySessionHeader || '') !== 'X-Galgame-Player-Session' || !playerVisualSessionReader) {
        return { ok: false, status: 503, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin || '' };
    }
    const sessionId = getSingleHeaderValue(request, PLAYER_VISUAL_SESSION_HEADER);
    if (!isSafeAsciiToken(sessionId, 8, 256)) {
        return { ok: false, status: 401, error: 'VISUAL_PLAYER_AUTH_REQUIRED', corsOrigin: origin || '' };
    }
    const session = await readPlayerVisualSessionForAsset(playerVisualSessionReader, sessionId);
    if (!session.ok) return { ...session, corsOrigin: origin || '' };
    return { ok: true, session: session.session, corsOrigin: origin || '' };
}

async function readPlayerVisualSessionForAsset(reader, sessionId) {
    try {
        const value = typeof reader === 'function'
            ? await reader(sessionId)
            : await reader.readPlayerVisualSession(sessionId);
        return { ok: true, session: normalizePlayerVisualSessionForAsset(value, sessionId) };
    } catch (error) {
        return {
            ok: false,
            status: error.status || 401,
            error: error.code || 'VISUAL_PLAYER_AUTH_REQUIRED',
        };
    }
}

function normalizePlayerVisualSessionForAsset(value, sessionId) {
    const session = normalizePlayerVisualSession({
        csrfToken: value?.csrfToken || 'asset-proxy-csrf-token-0000',
        chatId: value?.chatId,
    }, sessionId);
    return session;
}

function toPrefixedSha256(value) {
    if (typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value)) return value;
    if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return `sha256:${value}`;
    return '';
}

function minIsoTimestamp(...values) {
    const valid = values
        .filter((value) => typeof value === 'string')
        .map((value) => ({ value, time: Date.parse(value) }))
        .filter((item) => Number.isFinite(item.time));
    valid.sort((a, b) => a.time - b.time);
    return valid[0]?.value || new Date(Date.now() + PLAYER_VISUAL_BUNDLE_MAX_TTL_MS).toISOString();
}

function createResponseOnlyVisualBindingFromResult({ result, proof, idempotencyKey }) {
    const policy = bindingPolicyForVisualType(result.type);
    return {
        schemaVersion: 'galgame.visual-binding.v1',
        bindingId: result.bindingId,
        bindingType: result.type,
        entityKey: result.entityKey,
        releaseId: proof.releaseId,
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatId: proof.chatId,
        sourceMessageIndex: result.sourceMessageIndex,
        sourceMessageHash: result.sourceMessageHash,
        evidenceDigest: result.evidenceDigest,
        projectionId: result.projectionId,
        visualProfileId: result.visualProfileId,
        profileHash: result.profileHash,
        catalogId: result.catalogId,
        catalogRevision: result.catalogRevision,
        catalogHash: result.catalogHash,
        assetId: result.assetId,
        assetVersion: result.assetVersion,
        assetContentSha256: result.assetContentSha256,
        matcherVersion: result.matcherVersion,
        scorerVersion: result.scorerVersion,
        dictionaryVersion: result.dictionaryVersion,
        dictionaryHash: result.dictionaryHash,
        score: result.score,
        scoreBand: result.scoreBand,
        reasonCodes: result.reasonCodes,
        bindingPolicy: policy,
        idempotencyKey,
        createdAt: result.createdAt,
        updatedAt: result.createdAt,
        expiresAt: result.expiresAt || null,
    };
}

function createMatchScopeContext(proof) {
    return {
        releaseId: proof.releaseId,
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatId: proof.chatId,
        projectionId: proof.projectionId,
        sourceMessageIndex: proof.sourceMessageIndex,
        sourceMessageHash: proof.sourceMessageHash,
        evidenceDigest: proof.projectionHash,
        visualProfileId: proof.profileId,
        profileHash: proof.profileHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
    };
}

function bindingPolicyForVisualType(type) {
    if (type === 'scene') return 'scene-ttl';
    if (type === 'character') return 'session-fixed';
    if (['equipment', 'item', 'skill'].includes(type)) return 'entity-first-seen-fixed';
    return 'unknown';
}

function createPlayerVisualBundleBody({ request, projection = null, proof = null, selectedEntityKeys = [], bindings = [], matchResults = [], assetReadTickets = [], mode = 'recovery', recovery = null }) {
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(createdAt) + PLAYER_VISUAL_BUNDLE_MAX_TTL_MS).toISOString();
    const releaseScope = proof ? {
        releaseId: proof.releaseId,
        releaseScopeHash: sha256Digest(canonicalJson({
            releaseId: proof.releaseId,
            scenarioId: proof.scenarioId,
            scenarioVersion: proof.scenarioVersion,
            arcId: proof.arcId,
            chatId: proof.chatId,
            profileId: proof.profileId,
            catalogId: proof.catalogId,
            catalogRevision: proof.catalogRevision,
        })),
        scenarioId: proof.scenarioId,
        scenarioVersion: proof.scenarioVersion,
        arcId: proof.arcId,
        chatIdHash: sha256Digest(proof.chatId),
        profileId: proof.profileId,
        profileHash: proof.profileHash,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
    } : null;
    const source = projection && proof ? {
        sourceMessageIndex: proof.sourceMessageIndex,
        sourceMessageHash: proof.sourceMessageHash,
        projectionId: proof.projectionId,
        projectionHash: proof.projectionHash,
        entityKeys: selectedEntityKeys.filter((entityKey) => projection.entities.some((entity) => entity.entityKey === entityKey)),
    } : null;
    const bundle = {
        schemaVersion: PLAYER_VISUAL_BUNDLE_VERSION,
        bundleId: createPrefixedId('pvb', [request.requestId, projection?.projectionId || '', matchResults.map((item) => item.matchId)]),
        mode,
        releaseScope,
        source,
        bindings,
        matchResults,
        assetReadTickets,
        recovery,
        createdAt,
        expiresAt,
    };
    if (canonicalJson(bundle).length > PLAYER_VISUAL_BUNDLE_MAX_BYTES) {
        return {
            ...bundle,
            mode: 'recovery',
            bindings: [],
            matchResults: [],
            assetReadTickets: [],
            recovery: createPlayerVisualRecovery('VISUAL_PLAYER_BUNDLE_PARTIAL'),
        };
    }
    return bundle;
}

function createRecoveryBundleResponse({ status, code, request, projection = null, proof = null, selectedEntityKeys = [], createdAt, corsOrigin }) {
    const safeRequest = request && typeof request === 'object' ? request : {
        requestId: 'pvbr_recoveryplaceholder000',
        requestedEntityKeys: [],
    };
    return {
        status,
        corsOrigin,
        body: {
            ...createPlayerVisualBundleBody({
                request: safeRequest,
                projection,
                proof,
                selectedEntityKeys,
                mode: 'recovery',
                recovery: createPlayerVisualRecovery(code),
            }),
            createdAt,
        },
    };
}

function createPlayerVisualRecovery(code) {
    const unknownTypes = ['scene', 'character', 'equipment', 'item', 'skill'];
    return {
        code,
        recoverable: true,
        messageKey: code.toLowerCase(),
        unknownTypes,
        retryAfterMs: code === 'VISUAL_PLAYER_TIMEOUT' ? 3000 : 0,
    };
}

function playerVisualDenied(status, error, corsOrigin, extra = {}) {
    return {
        status,
        corsOrigin,
        body: {
            ok: false,
            error,
            ...extra,
        },
    };
}

function mapProjectionErrorToPlayerRecovery(error) {
    if (error === 'VISUAL_PROJECTION_SOURCE_MESSAGE_HASH_MISMATCH' || error === 'VISUAL_PROJECTION_SCOPE_MISMATCH') {
        return 'VISUAL_PLAYER_SCOPE_INVALID';
    }
    if (error === 'ORIGINAL_CHAT_READBACK_UNAVAILABLE') {
        return 'VISUAL_PLAYER_PROJECTION_UNAVAILABLE';
    }
    return 'VISUAL_PLAYER_PROJECTION_UNAVAILABLE';
}

function handlePlayerVisualBundleOptions(request, response, { playerVisualGatewayOrigins }) {
    const origin = request.headers.origin;
    const method = String(request.headers['access-control-request-method'] || '').toUpperCase();
    const requestedHeaders = String(request.headers['access-control-request-headers'] || '')
        .toLowerCase()
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .sort();
    const allowedHeaders = ['content-type', 'x-galgame-player-csrf'].sort();
    if (!origin || !parseOriginSet(playerVisualGatewayOrigins).has(origin) || method !== 'POST' || requestedHeaders.join(',') !== allowedHeaders.join(',')) {
        sendJson(response, 403, { ok: false, error: 'VISUAL_PLAYER_ORIGIN_REJECTED' });
        return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Galgame-Player-CSRF',
        'Access-Control-Max-Age': '300',
    });
    response.end();
}

function isPlayerVisualAssetContentPath(pathname) {
    return /^\/v1\/player\/visual-assets\/vat_[a-z0-9_-]{24,80}\/content$/.test(pathname);
}

export async function issueVisualOldSaveRestoreProof({
    body,
    saveBindingReader,
    restoreProofSecret,
    restoreProofKeyId,
    restoreProofTtlMs = VISUAL_RESTORE_MAX_TTL_MS,
    issuerStore = new MemoryVisualRestoreIssuerStore(),
    nonceFactory = defaultVisualRestoreNonce,
    now = () => new Date(),
} = {}) {
    const validation = validateVisualOldSaveProofIssueRequest(body);
    if (!validation.valid) {
        return visualRestoreDenied(400, 'VISUAL_RESTORE_ISSUE_REQUEST_INVALID', { validation });
    }
    if (!restoreProofSecret) {
        return visualRestoreDenied(503, 'VISUAL_RESTORE_ISSUER_SECRET_MISSING');
    }
    if (!isVisualRestoreKeyId(restoreProofKeyId)) {
        return visualRestoreDenied(503, 'VISUAL_RESTORE_ISSUER_KEY_INVALID');
    }
    if (!saveBindingReader) {
        return visualRestoreDenied(503, 'VISUAL_RESTORE_SAVE_READER_UNCONFIGURED');
    }

    const snapshotResult = await readTrustedSaveBindingSnapshot(saveBindingReader, body.saveId);
    if (!snapshotResult.ok) {
        return visualRestoreDenied(snapshotResult.status, snapshotResult.error);
    }
    const snapshotCheck = validateTrustedSaveBindingSnapshot(snapshotResult.snapshot, body);
    if (!snapshotCheck.ok) {
        return visualRestoreDenied(snapshotCheck.status, snapshotCheck.error, snapshotCheck.extra || {});
    }

    const route = '/v1/visual/restore-proofs/old-save';
    const nowDate = now();
    const nowMs = nowDate.getTime();
    const issuedAt = nowDate.toISOString();
    const expiresAtMs = nowMs + normalizeVisualRestoreTtlMs(restoreProofTtlMs);
    const expiresAt = new Date(expiresAtMs).toISOString();
    const bodyHash = sha256Digest(canonicalJson(body));
    const authoritySnapshotHash = sha256Digest(canonicalJson(snapshotCheck.normalizedSnapshot));
    const existing = issuerStore.getByIdempotencyKey(route, body.idempotencyKey, nowMs);
    const idempotencyCheck = compareRestoreIssuerIdempotency(existing, { bodyHash, authoritySnapshotHash, keyId: restoreProofKeyId });
    if (idempotencyCheck.conflict) {
        return visualRestoreDenied(409, 'VISUAL_RESTORE_ISSUE_IDEMPOTENCY_CONFLICT');
    }
    if (idempotencyCheck.entry) {
        return {
            status: 200,
            body: createVisualRestoreIssueResponse(idempotencyCheck.entry),
        };
    }

    const nonceResult = createUniqueVisualRestoreNonce(issuerStore, nonceFactory, nowMs);
    if (!nonceResult.ok) {
        return visualRestoreDenied(500, 'VISUAL_RESTORE_PROOF_SIGNING_FAILED');
    }
    const payload = createOldSaveRestoreProofPayload({
        body,
        snapshot: snapshotCheck.normalizedSnapshot,
        keyId: restoreProofKeyId,
        nonce: nonceResult.nonce,
        issuedAt,
        expiresAt,
    });
    const proof = signVisualRestoreProofToken({
        prefix: 'gvosrp1',
        payload,
        secret: restoreProofSecret,
    });
    if (!proof) {
        return visualRestoreDenied(500, 'VISUAL_RESTORE_PROOF_SIGNING_FAILED');
    }
    const entry = issuerStore.save({
        route,
        proofType: 'old-save',
        idempotencyKey: body.idempotencyKey,
        bodyHash,
        authoritySnapshotHash,
        keyId: restoreProofKeyId,
        payload,
        proof,
        expiresAtMs,
        evidence: createOldSaveRestoreProofEvidence(payload),
    }, nowMs);
    return {
        status: 200,
        body: createVisualRestoreIssueResponse(entry),
    };
}

export async function issueVisualRollbackRestoreProof({
    body,
    store,
    rollbackEventReader,
    restoreProofSecret,
    restoreProofKeyId,
    restoreProofTtlMs = VISUAL_RESTORE_MAX_TTL_MS,
    issuerStore = new MemoryVisualRestoreIssuerStore(),
    nonceFactory = defaultVisualRestoreNonce,
    now = () => new Date(),
} = {}) {
    const validation = validateVisualRollbackProofIssueRequest(body);
    if (!validation.valid) {
        return visualRestoreDenied(400, 'VISUAL_RESTORE_ISSUE_REQUEST_INVALID', { validation });
    }
    if (!restoreProofSecret) {
        return visualRestoreDenied(503, 'VISUAL_RESTORE_ISSUER_SECRET_MISSING');
    }
    if (!isVisualRestoreKeyId(restoreProofKeyId)) {
        return visualRestoreDenied(503, 'VISUAL_RESTORE_ISSUER_KEY_INVALID');
    }
    if (!rollbackEventReader) {
        return visualRestoreDenied(403, 'VISUAL_RESTORE_ROLLBACK_EVENT_REQUIRED');
    }

    const eventResult = await readTrustedRollbackEvent(rollbackEventReader, body.expectedRollbackRequestId);
    if (!eventResult.ok) {
        return visualRestoreDenied(eventResult.status, eventResult.error);
    }
    const releaseResult = await resolveRollbackRestoreRelease(store, body);
    if (!releaseResult.ok) {
        return visualRestoreDenied(releaseResult.status, releaseResult.error, releaseResult.extra || {});
    }
    const eventCheck = validateTrustedRollbackEventSnapshot(eventResult.event, body, releaseResult);
    if (!eventCheck.ok) {
        return visualRestoreDenied(eventCheck.status, eventCheck.error, eventCheck.extra || {});
    }

    const route = '/v1/visual/restore-proofs/rollback';
    const nowDate = now();
    const nowMs = nowDate.getTime();
    const issuedAt = nowDate.toISOString();
    const expiresAtMs = nowMs + normalizeVisualRestoreTtlMs(restoreProofTtlMs);
    const expiresAt = new Date(expiresAtMs).toISOString();
    const bodyHash = sha256Digest(canonicalJson(body));
    const authoritySnapshotHash = sha256Digest(canonicalJson(eventCheck.normalizedEvent));
    const existing = issuerStore.getByIdempotencyKey(route, body.idempotencyKey, nowMs);
    const idempotencyCheck = compareRestoreIssuerIdempotency(existing, { bodyHash, authoritySnapshotHash, keyId: restoreProofKeyId });
    if (idempotencyCheck.conflict) {
        return visualRestoreDenied(409, 'VISUAL_RESTORE_ISSUE_IDEMPOTENCY_CONFLICT');
    }
    if (idempotencyCheck.entry) {
        return {
            status: 200,
            body: createVisualRestoreIssueResponse(idempotencyCheck.entry),
        };
    }

    const nonceResult = createUniqueVisualRestoreNonce(issuerStore, nonceFactory, nowMs);
    if (!nonceResult.ok) {
        return visualRestoreDenied(500, 'VISUAL_RESTORE_PROOF_SIGNING_FAILED');
    }
    const payload = createRollbackRestoreProofPayload({
        body,
        event: eventCheck.normalizedEvent,
        keyId: restoreProofKeyId,
        nonce: nonceResult.nonce,
        issuedAt,
        expiresAt,
    });
    const proof = signVisualRestoreProofToken({
        prefix: 'gvrrp1',
        payload,
        secret: restoreProofSecret,
    });
    if (!proof) {
        return visualRestoreDenied(500, 'VISUAL_RESTORE_PROOF_SIGNING_FAILED');
    }
    const entry = issuerStore.save({
        route,
        proofType: 'rollback',
        idempotencyKey: body.idempotencyKey,
        bodyHash,
        authoritySnapshotHash,
        keyId: restoreProofKeyId,
        payload,
        proof,
        expiresAtMs,
        evidence: createRollbackRestoreProofEvidence(payload),
    }, nowMs);
    return {
        status: 200,
        body: createVisualRestoreIssueResponse(entry),
    };
}

function validateVisualOldSaveProofIssueRequest(body) {
    const errors = [];
    const allowedKeys = new Set([
        'bindingIds',
        'chatIdHash',
        'expectedCatalogHash',
        'expectedCatalogId',
        'expectedCatalogRevision',
        'expectedDictionaryHash',
        'expectedDictionaryVersion',
        'expectedReleaseId',
        'expectedReleaseScopeHash',
        'expectedSaveBindingHash',
        'expectedSaveOwnerHash',
        'expectedScenarioId',
        'expectedScenarioVersion',
        'expectedVisualProfileHash',
        'expectedVisualProfileId',
        'idempotencyKey',
        'requestId',
        'saveId',
        'schemaVersion',
    ]);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, errors: ['VisualOldSaveProofIssueRequestV1 must be an object.'], warnings: [] };
    }
    rejectUnknownRequestKeys(body, allowedKeys, 'request', errors);
    if (body.schemaVersion !== VISUAL_OLD_SAVE_PROOF_ISSUE_REQUEST_VERSION) {
        errors.push(`request.schemaVersion must be ${VISUAL_OLD_SAVE_PROOF_ISSUE_REQUEST_VERSION}.`);
    }
    validatePatternRequestId(body.requestId, /^req_[A-Za-z0-9._:-]{16,120}$/, 'request.requestId', errors);
    validatePatternRequestId(body.idempotencyKey, /^idem_[A-Za-z0-9._:-]{16,120}$/, 'request.idempotencyKey', errors);
    validatePatternRequestId(body.saveId, /^save_[A-Za-z0-9._:-]{8,120}$/, 'request.saveId', errors);
    validateBindingIds(body.bindingIds, 'request.bindingIds', errors, 1, 64);
    validatePatternRequestId(body.expectedCatalogId, /^vc_[a-z0-9_-]{8,80}$/, 'request.expectedCatalogId', errors);
    validatePositiveIntRange(body.expectedCatalogRevision, 'request.expectedCatalogRevision', errors, 1, 2147483647);
    validatePatternRequestId(body.expectedVisualProfileId, /^vprof_[a-z0-9_-]{8,80}$/, 'request.expectedVisualProfileId', errors);
    validateGenericRequestId(body.expectedDictionaryVersion, 'request.expectedDictionaryVersion', errors);
    for (const key of ['expectedReleaseId', 'expectedScenarioId', 'expectedScenarioVersion']) {
        validateAsciiBoundedString(body[key], `request.${key}`, errors, 1, 120);
    }
    for (const key of [
        'chatIdHash',
        'expectedCatalogHash',
        'expectedDictionaryHash',
        'expectedReleaseScopeHash',
        'expectedSaveBindingHash',
        'expectedSaveOwnerHash',
        'expectedVisualProfileHash',
    ]) {
        validateSha256Digest(body[key], `request.${key}`, errors);
    }
    validateSerializedJsonLimit(body, 'request', errors, 16 * 1024);
    return { valid: errors.length === 0, errors, warnings: [] };
}

function validateVisualRollbackProofIssueRequest(body) {
    const errors = [];
    const allowedKeys = new Set([
        'expectedCatalogHash',
        'expectedCatalogId',
        'expectedCatalogRevision',
        'expectedDictionaryHash',
        'expectedDictionaryVersion',
        'expectedPublishedAt',
        'expectedRollbackEventHash',
        'expectedRollbackRequestId',
        'expectedRolledBackAt',
        'expectedReleaseScopeHash',
        'expectedScenarioId',
        'expectedScenarioVersion',
        'expectedTargetReleaseHash',
        'expectedVisualProfileHash',
        'expectedVisualProfileId',
        'idempotencyKey',
        'requestId',
        'schemaVersion',
        'targetArcId',
        'targetReleaseId',
    ]);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, errors: ['VisualRollbackProofIssueRequestV1 must be an object.'], warnings: [] };
    }
    rejectUnknownRequestKeys(body, allowedKeys, 'request', errors);
    if (body.schemaVersion !== VISUAL_ROLLBACK_PROOF_ISSUE_REQUEST_VERSION) {
        errors.push(`request.schemaVersion must be ${VISUAL_ROLLBACK_PROOF_ISSUE_REQUEST_VERSION}.`);
    }
    validatePatternRequestId(body.requestId, /^req_[A-Za-z0-9._:-]{16,120}$/, 'request.requestId', errors);
    validatePatternRequestId(body.idempotencyKey, /^idem_[A-Za-z0-9._:-]{16,120}$/, 'request.idempotencyKey', errors);
    validatePatternRequestId(body.expectedRollbackRequestId, /^rollback_[A-Za-z0-9._:-]{8,120}$/, 'request.expectedRollbackRequestId', errors);
    validateAsciiBoundedString(body.targetReleaseId, 'request.targetReleaseId', errors, 1, 120);
    validateAsciiBoundedString(body.targetArcId, 'request.targetArcId', errors, 1, 120);
    validateAsciiBoundedString(body.expectedScenarioId, 'request.expectedScenarioId', errors, 1, 120);
    validateAsciiBoundedString(body.expectedScenarioVersion, 'request.expectedScenarioVersion', errors, 1, 120);
    validatePatternRequestId(body.expectedCatalogId, /^vc_[a-z0-9_-]{8,80}$/, 'request.expectedCatalogId', errors);
    validatePositiveIntRange(body.expectedCatalogRevision, 'request.expectedCatalogRevision', errors, 1, 2147483647);
    validatePatternRequestId(body.expectedVisualProfileId, /^vprof_[a-z0-9_-]{8,80}$/, 'request.expectedVisualProfileId', errors);
    validateGenericRequestId(body.expectedDictionaryVersion, 'request.expectedDictionaryVersion', errors);
    validateIsoUtcString(body.expectedPublishedAt, 'request.expectedPublishedAt', errors);
    validateIsoUtcString(body.expectedRolledBackAt, 'request.expectedRolledBackAt', errors);
    for (const key of [
        'expectedCatalogHash',
        'expectedDictionaryHash',
        'expectedReleaseScopeHash',
        'expectedRollbackEventHash',
        'expectedTargetReleaseHash',
        'expectedVisualProfileHash',
    ]) {
        validateSha256Digest(body[key], `request.${key}`, errors);
    }
    validateSerializedJsonLimit(body, 'request', errors, 16 * 1024);
    return { valid: errors.length === 0, errors, warnings: [] };
}

async function readTrustedSaveBindingSnapshot(reader, saveId) {
    try {
        const snapshot = typeof reader === 'function'
            ? await reader(saveId)
            : await reader.readSaveBinding(saveId);
        if (!snapshot) {
            return { ok: false, status: 404, error: 'VISUAL_RESTORE_SAVE_NOT_FOUND' };
        }
        return { ok: true, snapshot };
    } catch {
        return { ok: false, status: 404, error: 'VISUAL_RESTORE_SAVE_NOT_FOUND' };
    }
}

async function readTrustedRollbackEvent(reader, rollbackRequestId) {
    try {
        const event = typeof reader === 'function'
            ? await reader(rollbackRequestId)
            : await reader.readRollbackEvent(rollbackRequestId);
        if (!event) {
            return { ok: false, status: 404, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_NOT_FOUND' };
        }
        return { ok: true, event };
    } catch {
        return { ok: false, status: 404, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_NOT_FOUND' };
    }
}

function validateTrustedSaveBindingSnapshot(snapshot, body) {
    const normalized = normalizeTrustedSaveBindingSnapshot(snapshot);
    if (!normalized.ok) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_SAVE_SCOPE_MISMATCH' };
    }
    const value = normalized.snapshot;
    if (value.deleted || value.expired || value.status === 'draft' || value.status === 'partial' || value.status === 'corrupt') {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_SAVE_SCOPE_MISMATCH' };
    }
    if (value.saveId !== body.saveId) {
        return { ok: false, status: 404, error: 'VISUAL_RESTORE_SAVE_NOT_FOUND' };
    }
    if (value.saveOwnerHash !== body.expectedSaveOwnerHash) {
        return { ok: false, status: 403, error: 'VISUAL_RESTORE_SAVE_OWNER_MISMATCH' };
    }
    if (value.saveBindingHash !== body.expectedSaveBindingHash) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_SAVE_BINDING_HASH_MISMATCH' };
    }
    const scopeComparisons = [
        ['releaseId', 'expectedReleaseId'],
        ['releaseScopeHash', 'expectedReleaseScopeHash'],
        ['scenarioId', 'expectedScenarioId'],
        ['scenarioVersion', 'expectedScenarioVersion'],
        ['visualProfileId', 'expectedVisualProfileId'],
        ['visualProfileHash', 'expectedVisualProfileHash'],
        ['catalogId', 'expectedCatalogId'],
        ['catalogRevision', 'expectedCatalogRevision'],
        ['catalogHash', 'expectedCatalogHash'],
        ['dictionaryVersion', 'expectedDictionaryVersion'],
        ['dictionaryHash', 'expectedDictionaryHash'],
        ['chatIdHash', 'chatIdHash'],
    ];
    if (scopeComparisons.some(([left, right]) => value[left] !== body[right])) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_SAVE_SCOPE_MISMATCH' };
    }
    const snapshotBindings = new Set(value.bindingIds);
    for (const bindingId of body.bindingIds) {
        if (!snapshotBindings.has(bindingId)) {
            return { ok: false, status: 409, error: 'VISUAL_RESTORE_SAVE_BINDING_MISSING' };
        }
    }
    return { ok: true, normalizedSnapshot: value };
}

function normalizeTrustedSaveBindingSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        return { ok: false };
    }
    const normalized = {
        saveId: normalizeReference(snapshot.saveId),
        saveOwnerHash: normalizeReference(snapshot.saveOwnerHash),
        saveBindingHash: normalizeReference(snapshot.saveBindingHash),
        releaseId: normalizeReference(snapshot.releaseId),
        releaseScopeHash: normalizeReference(snapshot.releaseScopeHash),
        scenarioId: normalizeReference(snapshot.scenarioId),
        scenarioVersion: normalizeReference(snapshot.scenarioVersion),
        arcId: normalizeReference(snapshot.arcId),
        visualProfileId: normalizeReference(snapshot.visualProfileId),
        visualProfileHash: normalizeReference(snapshot.visualProfileHash),
        catalogId: normalizeReference(snapshot.catalogId),
        catalogRevision: Number(snapshot.catalogRevision),
        catalogHash: normalizeReference(snapshot.catalogHash),
        dictionaryVersion: normalizeReference(snapshot.dictionaryVersion),
        dictionaryHash: normalizeReference(snapshot.dictionaryHash),
        chatIdHash: normalizeReference(snapshot.chatIdHash),
        bindingIds: Array.isArray(snapshot.bindingIds) ? snapshot.bindingIds.map(normalizeReference) : [],
        status: normalizeReference(snapshot.status || 'active'),
        deleted: Boolean(snapshot.deleted),
        expired: Boolean(snapshot.expired),
    };
    const errors = [];
    validatePatternRequestId(normalized.saveId, /^save_[A-Za-z0-9._:-]{8,120}$/, 'snapshot.saveId', errors);
    validateSha256Digest(normalized.saveOwnerHash, 'snapshot.saveOwnerHash', errors);
    validateSha256Digest(normalized.saveBindingHash, 'snapshot.saveBindingHash', errors);
    validateAsciiBoundedString(normalized.releaseId, 'snapshot.releaseId', errors, 1, 120);
    validateSha256Digest(normalized.releaseScopeHash, 'snapshot.releaseScopeHash', errors);
    validateAsciiBoundedString(normalized.scenarioId, 'snapshot.scenarioId', errors, 1, 120);
    validateAsciiBoundedString(normalized.scenarioVersion, 'snapshot.scenarioVersion', errors, 1, 120);
    validateAsciiBoundedString(normalized.arcId, 'snapshot.arcId', errors, 1, 120);
    validatePatternRequestId(normalized.visualProfileId, /^vprof_[a-z0-9_-]{8,80}$/, 'snapshot.visualProfileId', errors);
    validateSha256Digest(normalized.visualProfileHash, 'snapshot.visualProfileHash', errors);
    validatePatternRequestId(normalized.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'snapshot.catalogId', errors);
    validatePositiveIntRange(normalized.catalogRevision, 'snapshot.catalogRevision', errors, 1, 2147483647);
    validateSha256Digest(normalized.catalogHash, 'snapshot.catalogHash', errors);
    validateGenericRequestId(normalized.dictionaryVersion, 'snapshot.dictionaryVersion', errors);
    validateSha256Digest(normalized.dictionaryHash, 'snapshot.dictionaryHash', errors);
    validateSha256Digest(normalized.chatIdHash, 'snapshot.chatIdHash', errors);
    validateBindingIds(normalized.bindingIds, 'snapshot.bindingIds', errors, 1, 500);
    return errors.length ? { ok: false, errors } : { ok: true, snapshot: normalized };
}

async function resolveRollbackRestoreRelease(store, body) {
    const releases = await store.listReleases().catch(() => []);
    const release = releases.find((item) => normalizeReference(item.releaseId) === body.targetReleaseId);
    if (!release) {
        return { ok: false, status: 404, error: 'VISUAL_RESTORE_ROLLBACK_RELEASE_NOT_FOUND' };
    }
    if (normalizeReference(release.scenarioId) !== body.expectedScenarioId || normalizeReference(release.scenarioVersion) !== body.expectedScenarioVersion) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH' };
    }
    const manifest = await store.getManifest(release.scenarioId, release.scenarioVersion);
    if (!manifest) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_RELEASE_INVALID' };
    }
    const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
    if (!validation.valid) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_RELEASE_INVALID', extra: { validation } };
    }
    const arcId = resolveArcId({ release, manifest, requestArcId: body.targetArcId });
    if (arcId !== body.targetArcId || !findArcBinding(manifest, arcId)) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH' };
    }
    const releaseHash = createVisualRestoreTargetReleaseHash(release);
    if (releaseHash !== body.expectedTargetReleaseHash) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH' };
    }
    const visualScope = resolveVisualScopeBinding(manifest, arcId);
    if (!visualScope.ok) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_PROFILE_CATALOG_MISMATCH' };
    }
    const expectedVisual = {
        profileId: body.expectedVisualProfileId,
        profileHash: body.expectedVisualProfileHash,
        catalogId: body.expectedCatalogId,
        catalogRevision: body.expectedCatalogRevision,
        catalogHash: body.expectedCatalogHash,
        dictionaryVersion: body.expectedDictionaryVersion,
        dictionaryHash: body.expectedDictionaryHash,
    };
    if (!objectsEqual(visualScope.binding, expectedVisual)) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_PROFILE_CATALOG_MISMATCH' };
    }
    return {
        ok: true,
        release,
        manifest,
        arcId,
        releaseHash,
        visualScope: visualScope.binding,
    };
}

function validateTrustedRollbackEventSnapshot(event, body, releaseResult) {
    const normalized = normalizeTrustedRollbackEvent(event);
    if (!normalized.ok) {
        return { ok: false, status: 403, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_REQUIRED' };
    }
    const value = normalized.event;
    if (value.status !== 'committed') {
        return { ok: false, status: 403, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_REQUIRED' };
    }
    const computedEventHash = createVisualRollbackEventHash(value);
    if (computedEventHash !== body.expectedRollbackEventHash || value.rollbackEventHash !== computedEventHash) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_HASH_MISMATCH' };
    }
    if (value.rolledBackAt !== body.expectedRolledBackAt || value.publishedAt !== body.expectedPublishedAt) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_TIME_MISMATCH' };
    }
    const eventTargetMatches = (
        value.rollbackRequestId === body.expectedRollbackRequestId
        && value.targetReleaseId === body.targetReleaseId
        && value.targetArcId === body.targetArcId
        && value.targetReleaseHash === body.expectedTargetReleaseHash
    );
    if (!eventTargetMatches) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_EVENT_TARGET_MISMATCH' };
    }
    const scopeMatches = (
        value.targetReleaseId === normalizeReference(releaseResult.release.releaseId)
        && value.targetArcId === releaseResult.arcId
        && value.targetReleaseHash === releaseResult.releaseHash
        && value.releaseScopeHash === body.expectedReleaseScopeHash
        && value.scenarioId === body.expectedScenarioId
        && value.scenarioVersion === body.expectedScenarioVersion
        && value.visualProfileId === body.expectedVisualProfileId
        && value.visualProfileHash === body.expectedVisualProfileHash
        && value.catalogId === body.expectedCatalogId
        && value.catalogRevision === body.expectedCatalogRevision
        && value.catalogHash === body.expectedCatalogHash
        && value.dictionaryVersion === body.expectedDictionaryVersion
        && value.dictionaryHash === body.expectedDictionaryHash
    );
    if (!scopeMatches) {
        return { ok: false, status: 409, error: 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH' };
    }
    return { ok: true, normalizedEvent: value };
}

function normalizeTrustedRollbackEvent(event) {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        return { ok: false };
    }
    const normalized = {
        rollbackRequestId: normalizeReference(event.rollbackRequestId),
        rollbackEventHash: normalizeReference(event.rollbackEventHash || event.eventHash),
        status: normalizeReference(event.status),
        targetReleaseId: normalizeReference(event.targetReleaseId),
        targetArcId: normalizeReference(event.targetArcId),
        targetReleaseHash: normalizeReference(event.targetReleaseHash),
        releaseScopeHash: normalizeReference(event.releaseScopeHash),
        scenarioId: normalizeReference(event.scenarioId),
        scenarioVersion: normalizeReference(event.scenarioVersion),
        visualProfileId: normalizeReference(event.visualProfileId),
        visualProfileHash: normalizeReference(event.visualProfileHash),
        catalogId: normalizeReference(event.catalogId),
        catalogRevision: Number(event.catalogRevision),
        catalogHash: normalizeReference(event.catalogHash),
        dictionaryVersion: normalizeReference(event.dictionaryVersion),
        dictionaryHash: normalizeReference(event.dictionaryHash),
        publishedAt: normalizeReference(event.publishedAt),
        rolledBackAt: normalizeReference(event.rolledBackAt),
    };
    const errors = [];
    validatePatternRequestId(normalized.rollbackRequestId, /^rollback_[A-Za-z0-9._:-]{8,120}$/, 'event.rollbackRequestId', errors);
    validateSha256Digest(normalized.rollbackEventHash, 'event.rollbackEventHash', errors);
    if (normalized.status !== 'committed') {
        errors.push('event.status must be committed.');
    }
    validateAsciiBoundedString(normalized.targetReleaseId, 'event.targetReleaseId', errors, 1, 120);
    validateAsciiBoundedString(normalized.targetArcId, 'event.targetArcId', errors, 1, 120);
    validateSha256Digest(normalized.targetReleaseHash, 'event.targetReleaseHash', errors);
    validateSha256Digest(normalized.releaseScopeHash, 'event.releaseScopeHash', errors);
    validateAsciiBoundedString(normalized.scenarioId, 'event.scenarioId', errors, 1, 120);
    validateAsciiBoundedString(normalized.scenarioVersion, 'event.scenarioVersion', errors, 1, 120);
    validatePatternRequestId(normalized.visualProfileId, /^vprof_[a-z0-9_-]{8,80}$/, 'event.visualProfileId', errors);
    validateSha256Digest(normalized.visualProfileHash, 'event.visualProfileHash', errors);
    validatePatternRequestId(normalized.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'event.catalogId', errors);
    validatePositiveIntRange(normalized.catalogRevision, 'event.catalogRevision', errors, 1, 2147483647);
    validateSha256Digest(normalized.catalogHash, 'event.catalogHash', errors);
    validateGenericRequestId(normalized.dictionaryVersion, 'event.dictionaryVersion', errors);
    validateSha256Digest(normalized.dictionaryHash, 'event.dictionaryHash', errors);
    validateIsoUtcString(normalized.publishedAt, 'event.publishedAt', errors);
    validateIsoUtcString(normalized.rolledBackAt, 'event.rolledBackAt', errors);
    return errors.length ? { ok: false, errors } : { ok: true, event: normalized };
}

function createOldSaveRestoreProofPayload({ body, snapshot, keyId, nonce, issuedAt, expiresAt }) {
    return {
        schemaVersion: VISUAL_OLD_SAVE_RESTORE_PROOF_VERSION,
        purpose: OLD_SAVE_RESTORE_PURPOSE,
        audience: VISUAL_RESTORE_PROOF_AUDIENCE,
        issuer: VISUAL_RESTORE_PROOF_ISSUER_ID,
        keyId,
        nonce,
        issuedAt,
        expiresAt,
        saveId: body.saveId,
        saveBindingHash: body.expectedSaveBindingHash,
        saveOwnerHash: body.expectedSaveOwnerHash,
        releaseId: body.expectedReleaseId,
        releaseScopeHash: body.expectedReleaseScopeHash,
        scenarioId: body.expectedScenarioId,
        scenarioVersion: body.expectedScenarioVersion,
        arcId: snapshot.arcId,
        visualProfileId: body.expectedVisualProfileId,
        visualProfileHash: body.expectedVisualProfileHash,
        catalogId: body.expectedCatalogId,
        catalogRevision: body.expectedCatalogRevision,
        catalogHash: body.expectedCatalogHash,
        dictionaryVersion: body.expectedDictionaryVersion,
        dictionaryHash: body.expectedDictionaryHash,
        bindingIds: [...body.bindingIds],
        chatIdHash: body.chatIdHash,
    };
}

function createRollbackRestoreProofPayload({ body, event, keyId, nonce, issuedAt, expiresAt }) {
    return {
        schemaVersion: VISUAL_ROLLBACK_RESTORE_PROOF_VERSION,
        purpose: ROLLBACK_RESTORE_PURPOSE,
        audience: VISUAL_RESTORE_PROOF_AUDIENCE,
        issuer: VISUAL_RESTORE_PROOF_ISSUER_ID,
        keyId,
        nonce,
        issuedAt,
        expiresAt,
        rollbackRequestId: body.expectedRollbackRequestId,
        targetReleaseId: body.targetReleaseId,
        targetReleaseHash: body.expectedTargetReleaseHash,
        releaseScopeHash: body.expectedReleaseScopeHash,
        scenarioId: body.expectedScenarioId,
        scenarioVersion: body.expectedScenarioVersion,
        arcId: body.targetArcId,
        visualProfileId: body.expectedVisualProfileId,
        visualProfileHash: body.expectedVisualProfileHash,
        catalogId: body.expectedCatalogId,
        catalogRevision: body.expectedCatalogRevision,
        catalogHash: body.expectedCatalogHash,
        dictionaryVersion: body.expectedDictionaryVersion,
        dictionaryHash: body.expectedDictionaryHash,
        publishedAt: body.expectedPublishedAt,
        rolledBackAt: event.rolledBackAt,
    };
}

function createOldSaveRestoreProofEvidence(payload) {
    return {
        proofType: 'old-save',
        releaseId: payload.releaseId,
        scenarioId: payload.scenarioId,
        scenarioVersion: payload.scenarioVersion,
        arcId: payload.arcId,
        releaseScopeHash: payload.releaseScopeHash,
        visualProfileId: payload.visualProfileId,
        catalogId: payload.catalogId,
        catalogRevision: payload.catalogRevision,
        dictionaryVersion: payload.dictionaryVersion,
        bindingCount: payload.bindingIds.length,
        chatIdHash: payload.chatIdHash,
        expiresAt: payload.expiresAt,
    };
}

function createRollbackRestoreProofEvidence(payload) {
    return {
        proofType: 'rollback',
        rollbackRequestId: payload.rollbackRequestId,
        targetReleaseId: payload.targetReleaseId,
        scenarioId: payload.scenarioId,
        scenarioVersion: payload.scenarioVersion,
        arcId: payload.arcId,
        releaseScopeHash: payload.releaseScopeHash,
        visualProfileId: payload.visualProfileId,
        catalogId: payload.catalogId,
        catalogRevision: payload.catalogRevision,
        dictionaryVersion: payload.dictionaryVersion,
        rolledBackAt: payload.rolledBackAt,
        expiresAt: payload.expiresAt,
    };
}

function createVisualRestoreIssueResponse(entry) {
    return {
        ok: true,
        protocolVersion: VISUAL_RESTORE_PROOF_ISSUE_RESPONSE_VERSION,
        proofType: entry.proofType,
        proof: entry.proof,
        keyId: entry.keyId,
        expiresAt: entry.payload.expiresAt,
        evidence: entry.evidence,
    };
}

function compareRestoreIssuerIdempotency(existing, current) {
    if (!existing) {
        return { entry: null, conflict: false };
    }
    if (
        existing.bodyHash !== current.bodyHash
        || existing.authoritySnapshotHash !== current.authoritySnapshotHash
        || existing.keyId !== current.keyId
    ) {
        return { entry: null, conflict: true };
    }
    return { entry: existing, conflict: false };
}

function createUniqueVisualRestoreNonce(issuerStore, nonceFactory, nowMs) {
    let nonce = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
        nonce = nonceFactory();
        if (isVisualRestoreNonce(nonce) && !issuerStore.hasNonce(nonce, nowMs)) {
            return { ok: true, nonce };
        }
        nonce = '';
    }
    return { ok: false };
}

function signVisualRestoreProofToken({ prefix, payload, secret }) {
    try {
        const payloadBytes = Buffer.from(canonicalJson(payload), 'utf8');
        const payloadEncoded = payloadBytes.toString('base64url');
        const signingInput = `${prefix}.${payloadEncoded}`;
        const signature = createHmac('sha256', secret)
            .update(signingInput, 'ascii')
            .digest('base64url');
        return `${signingInput}.${signature}`;
    } catch {
        return '';
    }
}

function normalizeVisualRestoreTtlMs(value) {
    const ttl = Number(value);
    if (!Number.isFinite(ttl) || ttl <= 0) {
        return VISUAL_RESTORE_MAX_TTL_MS;
    }
    return Math.min(Math.floor(ttl), VISUAL_RESTORE_MAX_TTL_MS);
}

function defaultVisualRestoreNonce() {
    return `nonce_${randomBytes(18).toString('base64url')}`;
}

function createVisualRestoreTargetReleaseHash(release) {
    return sha256Digest(canonicalJson({
        releaseId: normalizeReference(release?.releaseId),
        scenarioId: normalizeReference(release?.scenarioId),
        scenarioVersion: normalizeReference(release?.scenarioVersion),
        activeArcId: normalizeReference(release?.activeArcId || release?.arcId),
        arcId: normalizeReference(release?.arcId || release?.activeArcId),
        contentHash: normalizeReference(release?.contentHash),
        presentationProfileId: normalizeReference(release?.presentationProfileId),
        presentationProfileHash: normalizeReference(release?.presentationProfileHash),
        manifestUrl: normalizeReference(release?.manifestUrl),
    }));
}

function createVisualRollbackEventHash(event) {
    const copy = { ...event };
    delete copy.rollbackEventHash;
    return sha256Digest(canonicalJson(copy));
}

function visualRestoreDenied(status, error, extra = {}) {
    return {
        status,
        body: {
            ok: false,
            error,
            ...extra,
        },
    };
}

async function issueRuntimeBridgeProof({
    body,
    store,
    proofSecret,
    proofTtlMs,
    originalChatBridge,
}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return runtimeProofDenied(400, 'INVALID_PROOF_REQUEST');
    }
    if (body.protocolVersion && body.protocolVersion !== 'galgame.runtime-bridge-proof-request.v1') {
        return runtimeProofDenied(400, 'RUNTIME_PROOF_REQUEST_VERSION_UNSUPPORTED');
    }

    const chatId = normalizeChatId(body.chatId);
    if (!chatId) {
        return runtimeProofDenied(400, 'CHAT_ID_REQUIRED');
    }

    const releaseResult = await resolveProofRelease(store, body);
    if (!releaseResult.ok) {
        return runtimeProofDenied(releaseResult.status, releaseResult.error);
    }

    const { release, manifest } = releaseResult;
    const validation = validateScenarioManifest(manifest);
    if (!validation.valid) {
        return runtimeProofDenied(409, 'SCENARIO_MANIFEST_INVALID', { validation });
    }

    const arcId = resolveArcId({ release, manifest, requestArcId: body.arcId });
    if (!findArcBinding(manifest, arcId)) {
        return runtimeProofDenied(403, 'RUNTIME_PROOF_ARC_NOT_ALLOWED');
    }
    if (body.arcId && normalizeReference(body.arcId) !== arcId) {
        return runtimeProofDenied(403, 'RUNTIME_PROOF_RELEASE_MISMATCH');
    }

    const target = getPrimaryRuntimeTarget(manifest, arcId);
    if (!target.avatar) {
        return runtimeProofDenied(409, 'RELEASE_TARGET_UNAVAILABLE');
    }
    const requestedCharacter = body.character || {};
    if (requestedCharacter.avatar && !avatarsMatch(requestedCharacter.avatar, target.avatar)) {
        return runtimeProofDenied(403, 'RUNTIME_PROOF_TARGET_MISMATCH');
    }
    if (
        requestedCharacter.id
        && target.characterId
        && normalizeReference(requestedCharacter.id).toLowerCase() !== normalizeReference(target.characterId).toLowerCase()
    ) {
        return runtimeProofDenied(403, 'RUNTIME_PROOF_TARGET_MISMATCH');
    }

    const activeBindings = getActiveSillyTavernBindings(manifest, arcId);
    const activeArc = findArcBinding(manifest, arcId);
    const runtimeWorldBookRefs = normalizeWorldBookRefs(activeBindings?.worldBooks);
    const chatSeedId = normalizeChatId(activeBindings?.chatSeedId);
    if (!chatSeedId) {
        return runtimeProofDenied(409, 'RELEASE_CHAT_SEED_UNAVAILABLE');
    }
    if (chatId === chatSeedId) {
        return runtimeProofDenied(403, 'RUNTIME_PROOF_TARGET_CHAT_MUST_BE_PLAY_CHAT');
    }

    const chatCheck = await verifyTargetChatForProof({
        originalChatBridge,
        avatar: target.avatar,
        chatId,
        chatSeedId,
        runtimeWorldBookRefs,
    });
    if (!chatCheck.ok) {
        return runtimeProofDenied(chatCheck.status, chatCheck.error, chatCheck.evidence ? { evidence: chatCheck.evidence } : {});
    }

    const binding = {
        release: {
            releaseId: normalizeReference(release.releaseId),
            scenarioId: normalizeReference(release.scenarioId),
            scenarioVersion: normalizeReference(release.scenarioVersion),
            arcId,
            arcVersion: normalizeReference(activeArc?.arcVersion || manifest.arcVersion || ''),
        },
        target,
        chat: {
            chatId,
            chatSeedId,
            allowedChatIds: [chatId, chatSeedId],
        },
        resources: {
            worldBookRefs: runtimeWorldBookRefs,
            worldBookApplication: runtimeWorldBookRefs.length ? 'sillytavern-chat-metadata-world_info' : 'none',
        },
    };

    const proof = createSignedBridgeProof({
        secret: proofSecret,
        binding,
        ttlMs: Number.isFinite(proofTtlMs) && proofTtlMs > 0 ? proofTtlMs : 5 * 60 * 1000,
    });

    return {
        status: 200,
        body: {
            ok: true,
            protocolVersion: 'galgame.runtime-bridge-proof-response.v1',
            proof,
            evidence: {
                releaseId: binding.release.releaseId,
                scenarioId: binding.release.scenarioId,
                scenarioVersion: binding.release.scenarioVersion,
                arcId: binding.release.arcId,
                chatIdHash: stableHash(chatId).slice(0, 16),
                chatSeedIdHash: stableHash(chatSeedId).slice(0, 16),
                worldBookRefs: runtimeWorldBookRefs,
                runtimeWorldInfo: chatCheck.evidence?.worldInfoRef || '',
                source: 'config-service-active-release-and-original-chat-readback',
            },
        },
    };
}

async function resolveProofRelease(store, body) {
    const activeRelease = await store.getActiveRelease();
    if (!activeRelease) {
        return { ok: false, status: 404, error: 'ACTIVE_RELEASE_UNAVAILABLE' };
    }

    const requestedReleaseId = normalizeReference(body.releaseId);
    const requestedScenarioId = normalizeReference(body.scenarioId);
    const requestedScenarioVersion = normalizeReference(body.scenarioVersion);
    const releases = await store.listReleases().catch(() => []);
    const candidates = [activeRelease, ...releases].filter(Boolean);
    let release = requestedReleaseId
        ? candidates.find((item) => normalizeReference(item.releaseId) === requestedReleaseId)
        : activeRelease;
    let manifest = null;
    if (!release && requestedScenarioId && requestedScenarioVersion) {
        manifest = await store.getManifest(requestedScenarioId, requestedScenarioVersion);
        const requestedArcId = normalizeReference(body.arcId);
        const playableRelease = manifest
            ? createPlayableStoryRelease(manifest, {
                activeArcId: requestedArcId || getDefaultArcId(manifest),
                manifestUrl: `/v1/scenarios/${encodeURIComponent(manifest.id)}/versions/${encodeURIComponent(manifest.version)}/manifest`,
            })
            : null;
        if (
            playableRelease
            && (!requestedReleaseId || requestedReleaseId === normalizeReference(playableRelease.releaseId))
        ) {
            release = playableRelease;
        }
    }
    if (!release) {
        return { ok: false, status: 403, error: 'RUNTIME_PROOF_RELEASE_NOT_ALLOWED' };
    }
    if (
        (requestedScenarioId && requestedScenarioId !== normalizeReference(release.scenarioId))
        || (requestedScenarioVersion && requestedScenarioVersion !== normalizeReference(release.scenarioVersion))
    ) {
        return { ok: false, status: 403, error: 'RUNTIME_PROOF_RELEASE_MISMATCH' };
    }

    manifest ||= await store.getManifest(release.scenarioId, release.scenarioVersion);
    if (!manifest) {
        return { ok: false, status: 404, error: 'SCENARIO_MANIFEST_NOT_FOUND' };
    }
    const bindingValidation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
    if (!bindingValidation.valid) {
        return {
            ok: false,
            status: 403,
            error: 'RUNTIME_PROOF_RELEASE_PROFILE_INVALID',
            validation: bindingValidation,
        };
    }
    return { ok: true, release, manifest };
}

async function verifyTargetChatForProof({
    originalChatBridge,
    avatar,
    chatId,
    chatSeedId,
    runtimeWorldBookRefs = [],
}) {
    if (!originalChatBridge) {
        return { ok: false, status: 503, error: 'ORIGINAL_CHAT_BRIDGE_UNAVAILABLE' };
    }

    let targetChat;
    let seedChat;
    try {
        const chats = await originalChatBridge.listCharacterChats({ avatar });
        if (!chatListContains(chats, chatId) || !chatListContains(chats, chatSeedId)) {
            return { ok: false, status: 403, error: 'RUNTIME_PROOF_CHAT_NOT_ALLOWED' };
        }
        [targetChat, seedChat] = await Promise.all([
            originalChatBridge.getCharacterChat({ avatar, fileName: chatId }),
            originalChatBridge.getCharacterChat({ avatar, fileName: chatSeedId }),
        ]);
    } catch {
        return { ok: false, status: 503, error: 'ORIGINAL_CHAT_READBACK_UNAVAILABLE' };
    }

    if (!Array.isArray(targetChat) || !targetChat.length || !Array.isArray(seedChat) || !seedChat.length) {
        return { ok: false, status: 403, error: 'RUNTIME_PROOF_CHAT_NOT_ALLOWED' };
    }
    if (!isChatDerivedFromSeed(seedChat, targetChat)) {
        return { ok: false, status: 403, error: 'RUNTIME_PROOF_CHAT_NOT_SEED_DERIVED' };
    }
    const expectedWorldInfo = runtimeWorldBookRefs[0] || '';
    if (expectedWorldInfo) {
        const seedWorldInfo = getChatWorldInfo(seedChat);
        const targetWorldInfo = getChatWorldInfo(targetChat);
        if (seedWorldInfo !== expectedWorldInfo || targetWorldInfo !== expectedWorldInfo) {
            return {
                ok: false,
                status: 409,
                error: 'RUNTIME_PROOF_WORLD_INFO_NOT_APPLIED',
                evidence: {
                    expectedWorldInfo,
                    seedWorldInfo,
                    targetWorldInfo,
                },
            };
        }
    }
    const latest = latestVisibleChatMessage(targetChat);
    if (!latest?.is_user) {
        return { ok: false, status: 409, error: 'RUNTIME_PROOF_TARGET_CHAT_NOT_AWAITING_REPLY' };
    }
    return {
        ok: true,
        evidence: {
            worldInfoRef: expectedWorldInfo,
        },
    };
}

function runtimeProofDenied(status, error, extra = {}) {
    return {
        status,
        body: {
            ok: false,
            error,
            ...extra,
        },
    };
}

function getPrimaryRuntimeTarget(manifest, arcId = '') {
    const bindings = getActiveSillyTavernBindings(manifest, arcId);
    const character = bindings?.characters?.[0] || {};
    return {
        type: 'character',
        characterId: normalizeReference(character.id),
        avatar: normalizeReference(character.avatar),
        groupId: normalizeReference(bindings?.groupId || ''),
    };
}

function resolveArcId({ release, manifest, requestArcId }) {
    return normalizeReference(
        release?.activeArcId
        || release?.arcId
        || requestArcId
        || manifest?.arcId
        || manifest?.defaultArcId
        || getDefaultArcId(manifest)
        || 'default',
    );
}

function chatListContains(chats, chatId) {
    const expected = normalizeChatId(chatId);
    return Array.isArray(chats) && chats.some((chat) => {
        const aliases = [
            chat?.fileId,
            chat?.fileName,
            chat?.file_name,
            chat?.chatId,
            chat?.id,
        ].map(normalizeChatId).filter(Boolean);
        return aliases.includes(expected);
    });
}

function isChatDerivedFromSeed(seedChat, targetChat) {
    const seedMessages = normalizeOriginalVisibleChatMessages(seedChat);
    const targetMessages = normalizeOriginalVisibleChatMessages(targetChat);
    if (!seedMessages.length || targetMessages.length <= seedMessages.length) {
        return false;
    }
    return seedMessages.every((message, index) => (
        canonicalVisibleMessageKey(message) === canonicalVisibleMessageKey(targetMessages[index])
    ));
}

function canonicalVisibleMessageKey(message) {
    return canonicalJson({
        index: message.index,
        isUser: Boolean(message.isUser),
        role: message.role,
        name: normalizeReference(message.speaker),
        text: message.text,
    });
}

function getChatWorldInfo(chat) {
    const metadata = Array.isArray(chat) && chat[0]?.chat_metadata && typeof chat[0].chat_metadata === 'object'
        ? chat[0].chat_metadata
        : {};
    return normalizeReference(metadata.world_info || '');
}

function normalizeWorldBookRefs(worldBooks) {
    return (Array.isArray(worldBooks) ? worldBooks : [])
        .map((worldBook) => normalizeReference(worldBook?.name || worldBook))
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);
}

function latestVisibleChatMessage(chat) {
    return (Array.isArray(chat) ? chat : [])
        .slice(1)
        .reverse()
        .find((message) => message && typeof message === 'object' && !message.is_system && typeof message.mes === 'string' && message.mes.trim());
}

function normalizeChatId(value) {
    return normalizeReference(value).replace(/\.json$/i, '');
}

function normalizeReference(value) {
    return String(value || '').trim().slice(0, 240);
}

function normalizeAvatar(value) {
    return normalizeReference(value).replace(/^.*[\\/]/, '').toLowerCase();
}

function avatarsMatch(left, right) {
    return normalizeAvatar(left) === normalizeAvatar(right);
}

function createServiceRelease(manifest, { activeArcId = '' } = {}) {
    const release = createActiveRelease(manifest, { activeArcId });
    return {
        ...release,
        releaseId: `rel_${manifest.id}_${manifest.version}_${release.activeArcId || release.arcId}_${Date.now().toString(36)}`,
        manifestUrl: `/v1/scenarios/${encodeURIComponent(manifest.id)}/versions/${encodeURIComponent(manifest.version)}/manifest`,
        contentHash: stableHash(manifest),
    };
}

function manifestKey(scenarioId, scenarioVersion) {
    return `${scenarioId}@${scenarioVersion}`;
}

async function readJsonLimited(request, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of request) {
        total += chunk.length;
        if (total > maxBytes) {
            throw httpInputError(413, 'VISUAL_PROJECTION_REQUEST_TOO_LARGE');
        }
        chunks.push(chunk);
    }
    if (!chunks.length) {
        return {};
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
        const parsed = JSON.parse(text);
        assertNoDuplicateJsonKeys(text);
        return parsed;
    } catch (error) {
        if (error?.code) {
            throw error;
        }
        throw httpInputError(400, 'VISUAL_PROJECTION_INVALID_JSON');
    }
}

function assertNoDuplicateJsonKeys(text) {
    let index = 0;

    function skipWhitespace() {
        while (/\s/.test(text[index] || '')) {
            index += 1;
        }
    }

    function parseString() {
        const start = index;
        index += 1;
        while (index < text.length) {
            const char = text[index];
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (char === '"') {
                index += 1;
                return JSON.parse(text.slice(start, index));
            }
            index += 1;
        }
        throw new Error('unterminated-string');
    }

    function parseObject() {
        index += 1;
        const keys = new Set();
        skipWhitespace();
        if (text[index] === '}') {
            index += 1;
            return;
        }
        while (index < text.length) {
            skipWhitespace();
            if (text[index] !== '"') {
                throw new Error('object-key-expected');
            }
            const key = parseString();
            if (keys.has(key)) {
                throw httpInputError(400, 'VISUAL_PROJECTION_DUPLICATE_KEY');
            }
            keys.add(key);
            skipWhitespace();
            if (text[index] !== ':') {
                throw new Error('object-colon-expected');
            }
            index += 1;
            parseValue();
            skipWhitespace();
            if (text[index] === ',') {
                index += 1;
                continue;
            }
            if (text[index] === '}') {
                index += 1;
                return;
            }
            throw new Error('object-end-expected');
        }
        throw new Error('object-end-expected');
    }

    function parseArray() {
        index += 1;
        skipWhitespace();
        if (text[index] === ']') {
            index += 1;
            return;
        }
        while (index < text.length) {
            parseValue();
            skipWhitespace();
            if (text[index] === ',') {
                index += 1;
                continue;
            }
            if (text[index] === ']') {
                index += 1;
                return;
            }
            throw new Error('array-end-expected');
        }
        throw new Error('array-end-expected');
    }

    function parseValue() {
        skipWhitespace();
        const char = text[index];
        if (char === '{') {
            parseObject();
            return;
        }
        if (char === '[') {
            parseArray();
            return;
        }
        if (char === '"') {
            parseString();
            return;
        }
        const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(index));
        if (!match) {
            throw new Error('value-expected');
        }
        index += match[0].length;
    }

    parseValue();
    skipWhitespace();
    if (index !== text.length) {
        throw new Error('trailing-json');
    }
}

function httpInputError(status, code) {
    const error = new Error(code);
    error.status = status;
    error.code = code;
    return error;
}

async function readJson(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(chunk);
    }
    if (!chunks.length) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new Error('INVALID_JSON');
    }
}

function sendOptions(response, corsOrigin) {
    applyCors(response, corsOrigin);
    response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Galgame-Admin-Token, X-Galgame-Runtime-Token',
    });
    response.end();
}

function sendJson(response, status, data, { corsOrigin = '', extraHeaders = {} } = {}) {
    applyCors(response, corsOrigin);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    response.end(JSON.stringify(data));
}

function applyCors(response, corsOrigin) {
    if (!corsOrigin) {
        return;
    }
    response.setHeader('Access-Control-Allow-Origin', corsOrigin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
}

function resolveCorsOrigin(request, corsOrigin) {
    const configured = String(corsOrigin || '').trim();
    if (!configured) {
        return '';
    }
    const requestOrigin = String(request.headers.origin || '').trim();
    if (!configured.includes(',')) {
        return configured;
    }
    const allowed = configured.split(',').map((origin) => origin.trim()).filter(Boolean);
    return allowed.includes(requestOrigin) ? requestOrigin : allowed[0] || '';
}

function isAuthorizedAdminRequest(request, adminToken) {
    if (!adminToken) {
        return true;
    }

    const provided = getAdminTokenFromRequest(request);
    return safeTokenEqual(provided, adminToken);
}

function isAuthorizedRuntimeProofRequest(request, runtimeProofToken) {
    if (!runtimeProofToken) {
        return true;
    }

    const provided = getRuntimeProofTokenFromRequest(request);
    return safeTokenEqual(provided, runtimeProofToken);
}

function isAuthorizedBearerRequest(request, expectedToken) {
    if (!expectedToken) {
        return false;
    }
    const authorization = request.headers.authorization || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    return safeTokenEqual(bearer?.[1]?.trim() || '', expectedToken);
}

function parseOriginSet(value) {
    return new Set(String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean));
}

function getSingleHeaderValue(request, lowerCaseName) {
    const raw = Array.isArray(request.rawHeaders) ? request.rawHeaders : [];
    let count = 0;
    for (let index = 0; index < raw.length; index += 2) {
        if (String(raw[index] || '').toLowerCase() === lowerCaseName) {
            count += 1;
        }
    }
    if (count > 1) {
        return '';
    }
    const value = request.headers[lowerCaseName];
    return typeof value === 'string' ? value : '';
}

function parseCookieHeader(value) {
    const result = {};
    for (const part of String(value || '').split(';')) {
        const [rawKey, ...rawValue] = part.trim().split('=');
        if (!rawKey) {
            continue;
        }
        try {
            result[rawKey] = decodeURIComponent(rawValue.join('=') || '');
        } catch {
            result[rawKey] = '';
        }
    }
    return result;
}

function isSafeAsciiToken(value, minLength, maxLength) {
    return typeof value === 'string'
        && value.length >= minLength
        && value.length <= maxLength
        && /^[\x20-\x7E]+$/.test(value);
}

function validateVisualRestoreIssuerHttpRequest({ request, url, serviceToken }) {
    if (request.headers.origin || isBrowserLikeRequest(request)) {
        return { ok: false, status: 403, error: 'VISUAL_RESTORE_ISSUER_BROWSER_FORBIDDEN' };
    }
    if (
        url.search
        || request.headers.cookie
        || request.headers['x-galgame-visual-restore-proof']
        || request.headers['x-galgame-visual-projection-proof']
    ) {
        return { ok: false, status: 400, error: 'VISUAL_RESTORE_ISSUER_FORBIDDEN_TRANSPORT' };
    }
    if (!serviceToken) {
        return { ok: false, status: 503, error: 'VISUAL_RESTORE_ISSUER_AUTH_MISSING' };
    }
    if (!isAuthorizedBearerRequest(request, serviceToken)) {
        return {
            ok: false,
            status: 401,
            error: 'VISUAL_RESTORE_ISSUER_AUTH_INVALID',
            headers: {
                'WWW-Authenticate': 'Bearer realm="galgame-visual-restore-issuer"',
            },
        };
    }
    return { ok: true };
}

function isVisualProjectionStubPath(pathname) {
    return /^\/v1\/visual\/projection-stubs\/[^/]+$/.test(pathname);
}

function isVisualRestoreProofIssuePath(pathname) {
    return pathname === '/v1/visual/restore-proofs/old-save' || pathname === '/v1/visual/restore-proofs/rollback';
}

function isVisualProjectionId(value) {
    return typeof value === 'string' && /^vvp_[a-z0-9_-]{12,80}$/.test(value);
}

function isVisualRestoreKeyId(value) {
    return typeof value === 'string' && /^vis_restore_key_[a-z0-9_-]{8,40}$/.test(value);
}

function isVisualRestoreNonce(value) {
    return typeof value === 'string' && /^nonce_[A-Za-z0-9._:-]{16,120}$/.test(value);
}

function isBrowserLikeRequest(request) {
    return Boolean(request.headers.origin || request.headers['sec-fetch-site'] || request.headers['sec-fetch-dest']);
}

function getAdminTokenFromRequest(request) {
    const authorization = request.headers.authorization || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    if (bearer) {
        return bearer[1].trim();
    }

    const headerToken = request.headers['x-galgame-admin-token'];
    if (headerToken) {
        return String(Array.isArray(headerToken) ? headerToken[0] : headerToken).trim();
    }

    const cookies = parseCookies(request.headers.cookie || '');
    return cookies.galgame_admin_token || '';
}

function getRuntimeProofTokenFromRequest(request) {
    const authorization = request.headers.authorization || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
    if (bearer) {
        return bearer[1].trim();
    }

    const headerToken = request.headers['x-galgame-runtime-token'];
    if (headerToken) {
        return String(Array.isArray(headerToken) ? headerToken[0] : headerToken).trim();
    }

    const cookies = parseCookies(request.headers.cookie || '');
    return cookies.galgame_runtime_token || '';
}

function safeTokenEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(cookieHeader) {
    return String(cookieHeader || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .reduce((cookies, item) => {
            const separator = item.indexOf('=');
            if (separator < 0) {
                return cookies;
            }
            const key = decodeURIComponent(item.slice(0, separator).trim());
            const value = decodeURIComponent(item.slice(separator + 1).trim());
            return {
                ...cookies,
                [key]: value,
            };
        }, {});
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    return async function cookieFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        rememberSetCookies(cookies, response.headers);
        return response;
    };
}

function rememberSetCookies(cookies, headers) {
    const setCookieValues = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean);

    for (const value of setCookieValues) {
        for (const cookieText of splitSetCookieHeader(value)) {
            const firstPart = cookieText.split(';')[0];
            const separator = firstPart.indexOf('=');
            if (separator <= 0) {
                continue;
            }
            cookies.set(firstPart.slice(0, separator).trim(), firstPart.slice(separator + 1).trim());
        }
    }
}

function splitSetCookieHeader(value) {
    const text = String(value || '');
    if (!text.includes(',')) {
        return [text];
    }
    return text.split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function rejectUnknownRequestKeys(value, allowedKeys, label, errors) {
    for (const key of Object.keys(value || {})) {
        if (!allowedKeys.has(key)) {
            errors.push(`${label}.${key} is not allowed.`);
        }
    }
}

function validateGenericRequestId(value, label, errors) {
    validatePatternRequestId(value, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/, label, errors);
}

function validatePatternRequestId(value, pattern, label, errors) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        errors.push(`${label} is invalid.`);
    }
}

function validateSha256Digest(value, label, errors) {
    if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
        errors.push(`${label} must be a sha256 digest.`);
    }
}

function validatePositiveIntRange(value, label, errors, min = 1, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        errors.push(`${label} must be an integer between ${min} and ${max}.`);
    }
}

function validateAsciiBoundedString(value, label, errors, min = 1, max = 120) {
    if (
        typeof value !== 'string'
        || value.length < min
        || value.length > max
        || /[\u0000-\u001F\u007F]/.test(value)
        || /[^\u0020-\u007E]/.test(value)
    ) {
        errors.push(`${label} is invalid.`);
    }
}

function validateIsoUtcString(value, label, errors) {
    if (
        typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value
    ) {
        errors.push(`${label} must be an ISO-8601 UTC timestamp.`);
    }
}

function validateBindingIds(value, label, errors, min = 1, max = 64) {
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (value.length < min || value.length > max) {
        errors.push(`${label} must contain ${min}..${max} entries.`);
    }
    const seen = new Set();
    for (const [index, bindingId] of value.entries()) {
        if (typeof bindingId !== 'string' || !/^vb_[a-z0-9_-]{12,80}$/.test(bindingId)) {
            errors.push(`${label}[${index}] must be a valid VisualBindingV1 bindingId.`);
            continue;
        }
        if (seen.has(bindingId)) {
            errors.push(`${label}[${index}] is duplicated.`);
        }
        seen.add(bindingId);
    }
}

function validateSerializedJsonLimit(value, label, errors, maxBytes) {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > maxBytes) {
        errors.push(`${label} exceeds ${maxBytes} bytes.`);
    }
}

function objectsEqual(left, right) {
    return canonicalJson(left) === canonicalJson(right);
}

function mapVisualRestoreReadStatus(error) {
    return error?.status === 413 ? 413 : 400;
}

function mapVisualRestoreReadError(error) {
    if (error?.code === 'VISUAL_PROJECTION_REQUEST_TOO_LARGE') {
        return 'VISUAL_RESTORE_ISSUE_REQUEST_OVERSIZE';
    }
    if (error?.code === 'VISUAL_PROJECTION_DUPLICATE_KEY') {
        return 'VISUAL_RESTORE_ISSUE_DUPLICATE_KEY';
    }
    return 'VISUAL_RESTORE_ISSUE_REQUEST_INVALID';
}

function normalizeProjectionTtlMs(value) {
    const ttl = Number(value);
    if (!Number.isFinite(ttl) || ttl <= 0) {
        return 5 * 60 * 1000;
    }
    return Math.min(Math.floor(ttl), 5 * 60 * 1000);
}

function defaultVisualProjectionNonce() {
    return `nonce_${randomBytes(18).toString('base64url')}`;
}

function createPrefixedId(prefix, parts) {
    const digest = createHash('sha256')
        .update(canonicalJson(parts))
        .digest('hex')
        .slice(0, 32);
    return `${prefix}_${digest}`;
}

function createEntityKey(type, value) {
    const digest = createHash('sha256')
        .update(String(value || type))
        .digest('hex')
        .slice(0, 24);
    return `entity_${type}_${digest}`;
}

function sha256Digest(value) {
    return `sha256:${createHash('sha256').update(String(value ?? '')).digest('hex')}`;
}

function sha256BytesHex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value) {
    return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value) {
    if (Array.isArray(value)) {
        return value.map(sortCanonical);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => ({
                ...result,
                [key]: sortCanonical(value[key]),
            }), {});
    }
    return value;
}

function detectProjectionLocale(text, fallbackLocale = '') {
    const value = String(text || '');
    const hasCjk = /[\u3400-\u9FFF]/.test(value);
    const hasLatin = /[A-Za-z]/.test(value);
    if (hasCjk && hasLatin) {
        return 'mixed';
    }
    if (hasCjk) {
        return 'zh-CN';
    }
    if (hasLatin) {
        return 'en';
    }
    if (String(fallbackLocale || '').toLowerCase().startsWith('zh')) {
        return 'zh-CN';
    }
    if (String(fallbackLocale || '').toLowerCase().startsWith('en')) {
        return 'en';
    }
    return 'unknown';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || 8791);
    const server = createConfigService();
    server.listen(port, host, () => {
        console.log(`Game config service listening at http://${host}:${port}`);
    });
}
