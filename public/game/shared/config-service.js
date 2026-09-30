import {
    createActiveRelease,
    getActiveSillyTavernBindings,
    listPlayableStoryEntries,
    listStoredStorySummaries,
    materializeManifestForArc,
    validateActiveReleaseManifestBinding,
    validateScenarioManifest,
} from './protocol.js?v=auto-a91c272b35f1';
import { LocalReleaseStore } from './storage.js?v=auto-a91c272b35f1';

export const CONFIG_SERVICE_PROTOCOL_VERSION = '1.0';

export const CONFIG_SERVICE_ENDPOINTS = Object.freeze({
    activeRelease: '/v1/releases/active',
    health: '/v1/health',
    runtimeBridgeProofs: '/v1/runtime-bridge/proofs',
    adminHealth: '/v1/admin/health',
    playableScenarios: '/v1/scenarios',
    adminScenarios: '/v1/admin/scenarios',
    adminScenariosImport: '/v1/admin/scenarios/import',
    adminReleases: '/v1/admin/releases',
    adminRollbackPrefix: '/v1/admin/releases/',
});

const RUNTIME_BRIDGE_PROOF_RETRY_DELAYS_MS = [350, 900];

export function createReleaseStore(defaultManifest, options = {}) {
    return new ConfigReleaseStore(defaultManifest, options);
}

export function getConfigServiceRuntime({
    documentRef = globalThis.document,
    globalRef = globalThis,
} = {}) {
    const globalConfig = globalRef?.GALGAME_CONFIG_SERVICE || {};
    const globalEndpoint = typeof globalConfig === 'string'
        ? globalConfig
        : globalConfig.endpoint || globalRef?.GALGAME_CONFIG_SERVICE_URL || '';
    const metaEndpoint = documentRef
        ?.querySelector?.('meta[name="galgame-config-service"]')
        ?.getAttribute?.('content') || '';

    return {
        endpoint: normalizeEndpoint(globalEndpoint || metaEndpoint),
        timeoutMs: Number(globalConfig.timeoutMs || 8000),
    };
}

export class ConfigReleaseStore {
    constructor(defaultManifest, {
        client,
        localStore,
        fallbackToLocal = false,
    } = {}) {
        this.defaultManifest = defaultManifest;
        this.localStore = localStore || (defaultManifest ? new LocalReleaseStore(defaultManifest) : null);
        this.client = client || new GameConfigServiceClient(getConfigServiceRuntime());
        this.fallbackToLocal = fallbackToLocal;
        this.cachedBundle = null;
    }

    getMode() {
        if (this.client.isReady()) {
            return 'external-config-service';
        }
        return this.fallbackToLocal ? 'local-browser-store' : 'external-config-service-required';
    }

    async healthCheck(signal) {
        if (!this.client.isReady()) {
            return {
                ok: Boolean(this.fallbackToLocal && this.localStore),
                mode: this.fallbackToLocal ? 'local-browser-store' : 'external-config-service-required',
                errorCode: this.fallbackToLocal ? '' : 'CONFIG_SERVICE_REQUIRED',
            };
        }
        return this.client.healthCheck(signal);
    }

    // Player-safe connectivity probe. The admin health endpoint may require
    // credentials, while the public health endpoint reports transport and
    // service availability without exposing administrative state.
    async publicHealthCheck(signal) {
        if (!this.client.isReady()) {
            return {
                ok: false,
                mode: 'external-config-service',
                errorCode: 'CONFIG_SERVICE_DISABLED',
            };
        }
        return this.client.publicHealthCheck(signal);
    }

    async getActiveBundle(signal) {
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                throw new Error('CONFIG_SERVICE_REQUIRED');
            }
            return this.localStore.getActiveBundle();
        }

        try {
            const release = normalizeRelease(await this.client.getActiveRelease(signal));
            const manifest = await this.client.getManifest(release, signal);
            const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
            if (!validation.valid) {
                throw new Error('CONFIG_SERVICE_MANIFEST_INVALID');
            }
            if (this.localStore) {
                const cacheResult = await this.localStore.cachePublishedRelease(release, manifest);
                if (!cacheResult.ok) {
                    throw new Error('CONFIG_SERVICE_MANIFEST_INVALID');
                }
            }
            this.cachedBundle = {
                release,
                manifest: materializeManifestForArc(manifest, release.activeArcId || release.arcId),
                mode: 'external-config-service',
            };
            return this.cachedBundle;
        } catch (error) {
            if (!isConfigTransportFailure(error)) {
                throw error;
            }
            if (!this.fallbackToLocal || !this.localStore) {
                throw error;
            }
            const fallback = await this.localStore.getActiveBundle();
            return {
                ...fallback,
                mode: 'local-fallback',
                errorCode: 'CONFIG_SERVICE_UNAVAILABLE',
            };
        }
    }

    async getActiveRelease(signal) {
        return (await this.getActiveBundle(signal)).release;
    }

    async getActiveManifest(signal) {
        return (await this.getActiveBundle(signal)).manifest;
    }

    async getManifestByVersion(scenarioId, scenarioVersion) {
        const cached = await this.localStore?.getManifestByVersion(scenarioId, scenarioVersion);
        if (cached) {
            return cached;
        }
        if (this.client.isReady()) {
            const remote = await this.client.getManifest({ scenarioId, scenarioVersion }).catch(() => null);
            if (remote && validateScenarioManifest(remote).valid) {
                await this.localStore?.cacheManifestOnly?.(remote);
                return remote;
            }
        }
        const active = await this.getActiveBundle().catch(() => null);
        if (
            active?.manifest?.id === scenarioId
            && active.manifest.version === scenarioVersion
        ) {
            return active.manifest;
        }
        return null;
    }

    async issueRuntimeBridgeProof({ release, manifest, snapshot }, signal) {
        if (!this.client.isReady()) {
            return null;
        }
        let lastError = null;
        for (let attempt = 0; attempt <= RUNTIME_BRIDGE_PROOF_RETRY_DELAYS_MS.length; attempt += 1) {
            try {
                return await this.client.issueRuntimeBridgeProof({ release, manifest, snapshot }, signal);
            } catch (error) {
                lastError = error;
                if (!isRuntimeBridgeProofRetryable(error) || attempt >= RUNTIME_BRIDGE_PROOF_RETRY_DELAYS_MS.length) {
                    break;
                }
                await delay(RUNTIME_BRIDGE_PROOF_RETRY_DELAYS_MS[attempt], signal);
            }
        }
        if (lastError) {
            const diagnostic = {
                error: lastError.message || String(lastError),
                status: lastError.status || 0,
                code: lastError.code || '',
            };
            console.warn(`Galgame runtime bridge proof request failed. ${JSON.stringify(diagnostic)}`);
        }
        return null;
    }

    async listReleases(signal) {
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                return [];
            }
            return this.localStore.listReleases();
        }

        try {
            return await this.client.listReleases(signal);
        } catch {
            if (this.cachedBundle) {
                return [this.cachedBundle.release];
            }
            return this.localStore?.listReleases() || [];
        }
    }

    async listPlayableScenarios(signal) {
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                return [];
            }
            return this.localStore.listPlayableScenarios();
        }

        try {
            const entries = await this.client.listPlayableScenarios(signal);
            if (this.localStore && entries.length) {
                await Promise.all(entries.map(async (entry) => {
                    const manifest = await this.client.getManifest(entry.release || entry, signal).catch(() => null);
                    if (manifest) {
                        await this.localStore.cacheManifestOnly?.(manifest);
                    }
                }));
            }
            return entries;
        } catch {
            if (this.fallbackToLocal && this.localStore) {
                return this.localStore.listPlayableScenarios();
            }
            return this.cachedBundle
                ? listPlayableStoryEntries([this.cachedBundle.manifest], { activeRelease: this.cachedBundle.release })
                : [];
        }
    }

    async listStoredScenarios(signal) {
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                return [];
            }
            return this.localStore.listStoredScenarios();
        }

        try {
            return await this.client.listStoredScenarios(signal);
        } catch {
            if (this.fallbackToLocal && this.localStore) {
                return this.localStore.listStoredScenarios();
            }
            return this.cachedBundle
                ? listStoredStorySummaries([this.cachedBundle.manifest])
                : [];
        }
    }

    async getBundleForPlayableScenario(entry, signal) {
        if (!entry) {
            throw new Error('PLAYABLE_SCENARIO_REQUIRED');
        }
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                throw new Error('CONFIG_SERVICE_REQUIRED');
            }
            return this.localStore.getBundleForPlayableScenario(entry);
        }

        const release = normalizeRelease(entry.release || entry);
        const manifest = await this.client.getManifest(release, signal);
        const arcId = release.activeArcId || release.arcId || entry.arcId || '';
        const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
        if (!validation.valid) {
            throw new Error('PLAYABLE_SCENARIO_MANIFEST_INVALID');
        }
        if (this.localStore) {
            await this.localStore.cacheManifestOnly?.(manifest);
        }
        return {
            release,
            manifest: materializeManifestForArc(manifest, arcId),
            mode: 'external-config-service',
        };
    }

    async publishManifest(manifest, optionsOrSignal = {}, signal) {
        const { options, signal: requestSignal } = normalizePublishArgs(optionsOrSignal, signal);
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                return {
                    ok: false,
                    errorCode: 'CONFIG_SERVICE_REQUIRED',
                    validation: {
                        valid: false,
                        errors: ['CONFIG_SERVICE_REQUIRED'],
                        warnings: [],
                    },
                };
            }
            return this.localStore.publishManifest(manifest, options);
        }

        try {
            const result = await this.client.publishManifest(manifest, options, requestSignal);
            if (result.ok && result.release && this.localStore) {
                await this.localStore.cachePublishedRelease(result.release, manifest);
            }
            return result;
        } catch (error) {
            return {
                ok: false,
                errorCode: 'CONFIG_SERVICE_PUBLISH_FAILED',
                validation: {
                    valid: false,
                    errors: [error.message || 'CONFIG_SERVICE_PUBLISH_FAILED'],
                    warnings: [],
                },
            };
        }
    }

    async rollback(releaseId, signal) {
        if (!this.client.isReady()) {
            if (!this.fallbackToLocal || !this.localStore) {
                return false;
            }
            return this.localStore.rollback(releaseId);
        }

        try {
            return await this.client.rollback(releaseId, signal);
        } catch {
            return false;
        }
    }
}

function isConfigIntegrityError(error) {
    return /CONFIG_SERVICE_MANIFEST_INVALID|ACTIVE_RELEASE_PROFILE_INVALID/i.test(String(error?.message || error || ''));
}

function isConfigTransportFailure(error) {
    if (isConfigIntegrityError(error)) {
        return false;
    }
    const code = String(error?.code || '');
    const name = String(error?.name || '');
    const message = String(error?.message || error || '');
    if (/CONFIG_SERVICE_TIMEOUT|AbortError|TimeoutError/i.test(`${code} ${name} ${message}`)) {
        return true;
    }
    if (/Failed to fetch|NetworkError|Load failed|offline|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT/i.test(message)) {
        return true;
    }
    return false;
}

function isRuntimeBridgeProofRetryable(error) {
    if (isConfigTransportFailure(error)) {
        return true;
    }
    const message = String(error?.message || error || '');
    const status = Number(error?.status || 0);
    if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) {
        return /ORIGINAL_CHAT_READBACK_UNAVAILABLE|RUNTIME_PROOF_TARGET_CHAT_NOT_AWAITING_REPLY|CONFIG_SERVICE_REQUEST_FAILED|CONFIG_SERVICE_TIMEOUT|Failed to fetch|NetworkError|Load failed/i.test(message)
            || status >= 500
            || status === 408
            || status === 425
            || status === 429;
    }
    return false;
}

function delay(ms, signal) {
    if (signal?.aborted) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        }
    });
}

export class GameConfigServiceClient {
    constructor({
        endpoint = '',
        fetchImpl = defaultFetch,
        timeoutMs = 8000,
        credentials = 'include',
    } = {}) {
        this.endpoint = normalizeEndpoint(endpoint);
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
        this.credentials = credentials;
    }

    isReady() {
        return Boolean(this.endpoint && this.fetchImpl);
    }

    async healthCheck(signal) {
        if (!this.isReady()) {
            return {
                ok: false,
                mode: 'external-config-service',
                errorCode: 'CONFIG_SERVICE_DISABLED',
            };
        }

        try {
            // Player health must use the public endpoint. Keep the admin probe
            // as a compatibility fallback for older config-service builds.
            let body;
            try {
                body = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.health, { method: 'GET', signal });
            } catch {
                body = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.adminHealth, { method: 'GET', signal });
            }
            const proofConfigured = body?.runtimeProof?.configured !== false;
            return {
                ok: body?.ok !== false && proofConfigured,
                mode: 'external-config-service',
                active: Boolean(body?.active),
                runtimeProof: { configured: proofConfigured },
                errorCode: proofConfigured ? '' : 'RUNTIME_BRIDGE_PROOF_UNCONFIGURED',
            };
        } catch {
            return {
                ok: false,
                mode: 'external-config-service',
                errorCode: 'CONFIG_SERVICE_UNAVAILABLE',
            };
        }
    }

    async publicHealthCheck(signal) {
        if (!this.isReady()) {
            return {
                ok: false,
                mode: 'external-config-service',
                errorCode: 'CONFIG_SERVICE_DISABLED',
            };
        }
        try {
            const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.health, {
                method: 'GET',
                signal,
            });
            const proofConfigured = data?.runtimeProof?.configured !== false;
            return {
                ...data,
                ok: data?.ok === true && proofConfigured,
                mode: 'external-config-service',
                errorCode: proofConfigured ? '' : 'RUNTIME_BRIDGE_PROOF_UNCONFIGURED',
            };
        } catch {
            return {
                ok: false,
                mode: 'external-config-service',
                errorCode: 'CONFIG_SERVICE_UNAVAILABLE',
            };
        }
    }

    async getActiveRelease(signal) {
        return this.fetchJson(CONFIG_SERVICE_ENDPOINTS.activeRelease, {
            method: 'GET',
            signal,
        });
    }

    async listPlayableScenarios(signal) {
        const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.playableScenarios, {
            method: 'GET',
            signal,
        });
        return (Array.isArray(data) ? data : data.entries || [])
            .map((entry) => normalizePlayableScenarioEntry(entry))
            .filter(Boolean);
    }

    async listStoredScenarios(signal) {
        const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.adminScenarios, {
            method: 'GET',
            signal,
        });
        return (Array.isArray(data) ? data : data.stories || [])
            .map((story) => ({
                ...story,
                scenarioId: String(story.scenarioId || story.scenario_id || ''),
                scenarioVersion: String(story.scenarioVersion || story.scenario_version || ''),
                title: String(story.title || '未命名故事'),
                arcCount: Number(story.arcCount || story.arc_count || 0),
                playableArcCount: Number(story.playableArcCount || story.playable_arc_count || 0),
                ready: Boolean(story.ready),
            }));
    }

    async getManifest(release, signal) {
        const manifestPath = release.manifestUrl
            || `/v1/scenarios/${encodeURIComponent(release.scenarioId)}/versions/${encodeURIComponent(release.scenarioVersion)}/manifest`;
        return this.fetchJson(manifestPath, {
            method: 'GET',
            signal,
        });
    }

    async issueRuntimeBridgeProof({ release, manifest, snapshot }, signal) {
        const character = getPrimaryRuntimeCharacter(manifest, snapshot, release?.activeArcId || release?.arcId || '');
        const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.runtimeBridgeProofs, {
            method: 'POST',
            body: {
                protocolVersion: 'galgame.runtime-bridge-proof-request.v1',
                releaseId: release?.releaseId || '',
                scenarioId: release?.scenarioId || manifest?.id || '',
                scenarioVersion: release?.scenarioVersion || manifest?.version || '',
                arcId: release?.activeArcId || release?.arcId || manifest?.arcId || manifest?.defaultArcId || 'default',
                chatId: snapshot?.fileName || '',
                character,
            },
            signal,
        });
        return data?.proof || null;
    }

    async importScenario(manifest, signal) {
        return this.fetchJson(CONFIG_SERVICE_ENDPOINTS.adminScenariosImport, {
            method: 'POST',
            body: {
                protocolVersion: CONFIG_SERVICE_PROTOCOL_VERSION,
                manifest,
            },
            signal,
        });
    }

    async validateScenario(manifest, signal) {
        const path = `/v1/admin/scenarios/${encodeURIComponent(manifest.id)}/versions/${encodeURIComponent(manifest.version)}/validate`;
        return this.fetchJson(path, {
            method: 'POST',
            body: {
                protocolVersion: CONFIG_SERVICE_PROTOCOL_VERSION,
                manifest,
            },
            signal,
        });
    }

    async publishManifest(manifest, optionsOrSignal = {}, signal) {
        const { options, signal: requestSignal } = normalizePublishArgs(optionsOrSignal, signal);
        const localValidation = validateScenarioManifest(manifest);
        if (!localValidation.valid) {
            return {
                ok: false,
                validation: localValidation,
            };
        }

        await this.importScenario(manifest, requestSignal);
        const serviceValidation = normalizeValidation(await this.validateScenario(manifest, requestSignal));
        if (!serviceValidation.valid) {
            return {
                ok: false,
                validation: serviceValidation,
            };
        }

        const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.adminReleases, {
            method: 'POST',
            body: {
                protocolVersion: CONFIG_SERVICE_PROTOCOL_VERSION,
                scenarioId: manifest.id,
                scenarioVersion: manifest.version,
                activeArcId: options.activeArcId || '',
            },
            signal: requestSignal,
        });
        const release = normalizeRelease(data.release || data, manifest);
        return {
            ok: true,
            release,
            validation: serviceValidation,
        };
    }

    async listReleases(signal) {
        const data = await this.fetchJson(CONFIG_SERVICE_ENDPOINTS.adminReleases, {
            method: 'GET',
            signal,
        });
        return Array.isArray(data) ? data : data.releases || [];
    }

    async rollback(releaseId, signal) {
        const data = await this.fetchJson(`${CONFIG_SERVICE_ENDPOINTS.adminRollbackPrefix}${encodeURIComponent(releaseId)}/rollback`, {
            method: 'POST',
            body: {
                protocolVersion: CONFIG_SERVICE_PROTOCOL_VERSION,
            },
            signal,
        });
        return data?.ok !== false;
    }

    async fetchJson(pathOrUrl, {
        method = 'GET',
        body,
        signal,
    } = {}) {
        if (!this.isReady()) {
            throw new Error('CONFIG_SERVICE_DISABLED');
        }

        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timeout = controller && this.timeoutMs > 0
            ? setTimeout(() => controller.abort('CONFIG_SERVICE_TIMEOUT'), this.timeoutMs)
            : null;
        if (controller && signal) {
            if (signal.aborted) {
                controller.abort(signal.reason);
            } else {
                signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
            }
        }

        try {
            const response = await this.fetchImpl(resolveUrl(this.endpoint, pathOrUrl), {
                method,
                credentials: this.credentials,
                cache: 'no-cache',
                headers: body === undefined ? {} : {
                    'Content-Type': 'application/json',
                },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: controller?.signal || signal,
            });
            return readServiceResponse(response);
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }
}

function normalizeValidation(value) {
    if (value?.validation) {
        return normalizeValidation(value.validation);
    }
    return {
        valid: value?.valid !== false && value?.ok !== false,
        errors: value?.errors || [],
        warnings: value?.warnings || [],
    };
}

function normalizeRelease(value, manifest) {
    if (!value || typeof value !== 'object') {
        if (!manifest) {
            throw new Error('CONFIG_SERVICE_RELEASE_INVALID');
        }
        return createActiveRelease(manifest);
    }

    return {
        releaseId: String(value.releaseId || value.release_id || ''),
        scenarioId: String(value.scenarioId || value.scenario_id || manifest?.id || ''),
        scenarioVersion: String(value.scenarioVersion || value.scenario_version || manifest?.version || ''),
        publishedAt: String(value.publishedAt || value.published_at || new Date().toISOString()),
        manifestUrl: String(value.manifestUrl || value.manifest_url || ''),
        contentHash: String(value.contentHash || value.content_hash || ''),
        minimumPlayerVersion: String(value.minimumPlayerVersion || value.minimum_player_version || '1.0.0'),
        activeArcId: String(value.activeArcId || value.active_arc_id || value.arcId || value.arc_id || manifest?.arcId || manifest?.defaultArcId || ''),
        arcId: String(value.arcId || value.arc_id || value.activeArcId || value.active_arc_id || manifest?.arcId || manifest?.defaultArcId || ''),
        arcVersion: String(value.arcVersion || value.arc_version || manifest?.arcVersion || ''),
        presentationProfileId: String(value.presentationProfileId || value.presentation_profile_id || manifest?.presentationProfileId || ''),
        presentationProfileHash: String(value.presentationProfileHash || value.presentation_profile_hash || manifest?.presentationProfileHash || ''),
    };
}

function normalizePlayableScenarioEntry(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
    }
    const release = normalizeRelease(entry.release || entry);
    return {
        ...entry,
        entryId: String(entry.entryId || `${release.scenarioId}@${release.scenarioVersion}#${release.activeArcId || release.arcId}`),
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        arcId: release.activeArcId || release.arcId || String(entry.arcId || ''),
        title: String(entry.title || ''),
        arcTitle: String(entry.arcTitle || ''),
        coverAsset: String(entry.coverAsset || ''),
        coverUrl: String(entry.coverUrl || ''),
        defaultBackgroundAsset: String(entry.defaultBackgroundAsset || ''),
        defaultBackgroundUrl: String(entry.defaultBackgroundUrl || ''),
        spriteAsset: String(entry.spriteAsset || ''),
        spriteUrl: String(entry.spriteUrl || ''),
        characterName: String(entry.characterName || ''),
        isDefault: Boolean(entry.isDefault),
        release,
    };
}

async function readServiceResponse(response) {
    const contentType = response.headers?.get?.('content-type') || '';
    const data = response.status === 204
        ? null
        : contentType.includes('application/json')
            ? await response.json()
            : await response.text();

    if (!response.ok || data?.error) {
        const error = new Error(typeof data?.error === 'string' ? data.error : 'CONFIG_SERVICE_REQUEST_FAILED');
        error.code = 'CONFIG_SERVICE_RESPONSE_INVALID';
        error.status = response.status;
        error.responseBody = data;
        throw error;
    }

    return data;
}

function normalizeEndpoint(endpoint) {
    return String(endpoint || '').trim().replace(/\/+$/, '');
}

function getPrimaryRuntimeCharacter(manifest, snapshot, activeArcId = '') {
    const bound = getActiveSillyTavernBindings(manifest, activeArcId || manifest?.arcId || manifest?.activeArcId || manifest?.defaultArcId)?.characters?.[0] || {};
    return {
        id: String(bound.id || snapshot?.character?.id || ''),
        avatar: String(bound.avatar || snapshot?.character?.avatar || ''),
    };
}

function resolveUrl(endpoint, pathOrUrl) {
    const value = String(pathOrUrl || '');
    if (/^https?:\/\//i.test(value)) {
        return value;
    }
    if (!value.startsWith('/')) {
        return `${endpoint}/${value}`;
    }
    return `${endpoint}${value}`;
}

function defaultFetch(...args) {
    return globalThis.fetch(...args);
}

function normalizePublishArgs(optionsOrSignal = {}, signal) {
    if (
        optionsOrSignal
        && typeof optionsOrSignal === 'object'
        && !Array.isArray(optionsOrSignal)
        && (
            typeof optionsOrSignal.aborted === 'boolean'
            || typeof optionsOrSignal.addEventListener === 'function'
        )
    ) {
        return {
            options: {},
            signal: optionsOrSignal,
        };
    }

    return {
        options: optionsOrSignal && typeof optionsOrSignal === 'object' && !Array.isArray(optionsOrSignal)
            ? optionsOrSignal
            : {},
        signal,
    };
}
