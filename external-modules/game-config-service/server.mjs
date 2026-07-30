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
    validateVisualProjectionProofShape,
    validateVisualProjectionStub,
    validateVisualVisibleProjection,
} from '../../frontend/shared/src/visual-system-schema.js';
import { createSignedBridgeProof } from '../original-runtime-bridge/server.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORE_PATH = path.join(moduleDir, 'data', 'store.json');

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
    originalChatBridge,
}) {
    corsOrigin = resolveCorsOrigin(request, corsOrigin);
    const url = new URL(request.url, 'http://localhost');
    const method = request.method || 'GET';
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') {
        if (pathname === '/v1/visual/projections' || isVisualProjectionStubPath(pathname)) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_PROJECTION_BROWSER_DIRECT_FORBIDDEN' });
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

    if (method === 'POST' && pathname === '/v1/visual/projections') {
        if (request.headers.origin) {
            sendJson(response, 403, { ok: false, error: 'VISUAL_PROJECTION_BROWSER_DIRECT_FORBIDDEN' });
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
            body = await readJsonLimited(request, 8192);
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
    if (body.oldSave) {
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
        normalizeChatId(body.chatId),
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
        chatId: body.chatId,
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
        chatId: normalizeChatId(body.chatId),
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
        body: createVisualProjectionResponse(entry),
    };
}

function validateVisualProjectionRequest(body) {
    const errors = [];
    const allowedKeys = new Set([
        'protocolVersion',
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'chatId',
        'sourceMessageIndex',
        'profileId',
        'profileHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'dictionaryVersion',
        'dictionaryHash',
        'expectedSourceMessageHash',
        'oldSave',
        'idempotencyKey',
    ]);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, errors: ['VisualProjectionRequestV1 must be an object.'], warnings: [] };
    }
    rejectUnknownRequestKeys(body, allowedKeys, 'request', errors);
    if (body.protocolVersion !== 'galgame.visual-projection-request.v1') {
        errors.push('request.protocolVersion must be galgame.visual-projection-request.v1.');
    }
    validateGenericRequestId(body.releaseId, 'request.releaseId', errors);
    validateGenericRequestId(body.scenarioId, 'request.scenarioId', errors);
    validateGenericRequestId(body.scenarioVersion, 'request.scenarioVersion', errors);
    validateGenericRequestId(body.arcId, 'request.arcId', errors);
    validateGenericRequestId(body.chatId, 'request.chatId', errors);
    if (body.sourceMessageIndex !== undefined && (!Number.isInteger(body.sourceMessageIndex) || body.sourceMessageIndex < 0)) {
        errors.push('request.sourceMessageIndex must be a non-negative integer when provided.');
    }
    validatePatternRequestId(body.profileId, /^vprof_[a-z0-9_-]{8,80}$/, 'request.profileId', errors);
    validateSha256Digest(body.profileHash, 'request.profileHash', errors);
    validatePatternRequestId(body.catalogId, /^vc_[a-z0-9_-]{8,80}$/, 'request.catalogId', errors);
    if (!Number.isInteger(body.catalogRevision) || body.catalogRevision < 1) {
        errors.push('request.catalogRevision must be a positive integer.');
    }
    validateSha256Digest(body.catalogHash, 'request.catalogHash', errors);
    validateGenericRequestId(body.dictionaryVersion, 'request.dictionaryVersion', errors);
    validateSha256Digest(body.dictionaryHash, 'request.dictionaryHash', errors);
    if (body.expectedSourceMessageHash !== undefined) {
        validateSha256Digest(body.expectedSourceMessageHash, 'request.expectedSourceMessageHash', errors);
    }
    validatePatternRequestId(body.idempotencyKey, /^idem_[A-Za-z0-9._:-]{16,120}$/, 'request.idempotencyKey', errors);
    if (body.oldSave !== undefined) {
        const oldSaveKeys = new Set(['saveId', 'saveBindingHash']);
        if (!body.oldSave || typeof body.oldSave !== 'object' || Array.isArray(body.oldSave)) {
            errors.push('request.oldSave must be an object when provided.');
        } else {
            rejectUnknownRequestKeys(body.oldSave, oldSaveKeys, 'request.oldSave', errors);
            validateGenericRequestId(body.oldSave.saveId, 'request.oldSave.saveId', errors);
            validateSha256Digest(body.oldSave.saveBindingHash, 'request.oldSave.saveBindingHash', errors);
        }
    }
    if (JSON.stringify(body).length > 8192) {
        errors.push('request body exceeds 8KB.');
    }
    return { valid: errors.length === 0, errors, warnings: [] };
}

async function resolveVisualProjectionRelease(store, body) {
    const activeRelease = await store.getActiveRelease();
    if (!activeRelease) {
        return { ok: false, status: 404, error: 'ACTIVE_RELEASE_UNAVAILABLE' };
    }
    const requestedReleaseId = normalizeReference(body.releaseId);
    if (requestedReleaseId !== normalizeReference(activeRelease.releaseId)) {
        return { ok: false, status: 403, error: 'VISUAL_PROJECTION_RELEASE_NOT_ACTIVE' };
    }
    if (
        normalizeReference(body.scenarioId) !== normalizeReference(activeRelease.scenarioId)
        || normalizeReference(body.scenarioVersion) !== normalizeReference(activeRelease.scenarioVersion)
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
    const arcId = resolveArcId({ release: activeRelease, manifest, requestArcId: body.arcId });
    if (normalizeReference(body.arcId) !== arcId) {
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
    for (const key of ['profileId', 'profileHash', 'catalogId', 'catalogRevision', 'catalogHash', 'dictionaryVersion', 'dictionaryHash']) {
        if (body[key] !== binding[key]) {
            errors.push(`request.${key} does not match published visual scope.`);
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

function createVisualProjectionResponse(entry) {
    return {
        ok: true,
        protocolVersion: 'galgame.visual-projection-response.v1',
        projection: entry.projection,
        stub: {
            projectionId: entry.stub.projectionId,
            projectionHash: entry.stub.projectionHash,
            expiresAt: entry.stub.expiresAt,
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
        .find((message) => message && typeof message === 'object' && !message.is_system && typeof message.mes === 'string');
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
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw httpInputError(400, 'VISUAL_PROJECTION_INVALID_JSON');
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

function isVisualProjectionStubPath(pathname) {
    return /^\/v1\/visual\/projection-stubs\/[^/]+$/.test(pathname);
}

function isVisualProjectionId(value) {
    return typeof value === 'string' && /^vvp_[a-z0-9_-]{12,80}$/.test(value);
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
