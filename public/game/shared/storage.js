import {
    bindAdaptivePresentationProfileHashes,
    createActiveRelease,
    createPlayableStoryRelease,
    listPlayableStoryEntries,
    listStoredStorySummaries,
    materializeManifestForArc,
    nowIso,
    safeJsonParse,
    STORAGE_KEYS,
    validateActiveReleaseManifestBinding,
    validateReleaseArcSelection,
    validateScenarioManifest,
} from './protocol.js?v=auto-fdcc7c7c5302';

const DB_NAME = 'galgame-local-v1';
const STORE_NAME = 'records';
const SUPERSEDED_BUILT_IN_ENTRY_IDS = new Set([
    'galgame-test-aoi-entry',
    'galgame-imported-apartment5c-entry',
    'galgame-imported-lucifer-arc1-entry',
]);

export class LocalReleaseStore {
    constructor(defaultManifest, backend = createStorageBackend()) {
        this.defaultManifest = defaultManifest ? bindAdaptivePresentationProfileHashes(defaultManifest) : defaultManifest;
        this.backend = backend;
    }

    async getActiveRelease() {
        const active = await this.backend.get(STORAGE_KEYS.activeRelease);
        if (active) {
            await this.ensureManifest(active);
            return active;
        }

        const legacyActive = readLegacyJson(STORAGE_KEYS.activeRelease);
        if (legacyActive) {
            await this.migrateLegacyReleaseData(legacyActive);
            return legacyActive;
        }

        const release = createActiveRelease(this.defaultManifest);
        await this.backend.set(manifestKey(this.defaultManifest.id, this.defaultManifest.version), this.defaultManifest);
        await this.backend.set(STORAGE_KEYS.activeRelease, release);
        await this.backend.set(STORAGE_KEYS.releaseHistory, [release]);
        return release;
    }

    async getActiveManifest() {
        const active = await this.getActiveRelease();
        const manifest = await this.backend.get(manifestKey(active.scenarioId, active.scenarioVersion));
        return manifest || this.defaultManifest;
    }

    async getManifestByVersion(scenarioId, scenarioVersion) {
        const manifest = await this.backend.get(manifestKey(scenarioId, scenarioVersion));
        if (manifest) {
            return manifest;
        }
        if (scenarioId === this.defaultManifest.id && scenarioVersion === this.defaultManifest.version) {
            return this.defaultManifest;
        }
        return null;
    }

    async getActiveBundle() {
        const release = await this.getActiveRelease();
        const manifest = await this.getActiveManifest();
        if (shouldRecoverSupersededBuiltInManifest(manifest, this.defaultManifest)) {
            return this.recoverDefaultBundle('superseded-built-in-entry');
        }
        const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
        if (!validation.valid) {
            throw new Error(`ACTIVE_RELEASE_PROFILE_INVALID: ${validation.errors.join('; ')}`);
        }
        return {
            release,
            manifest: materializeManifestForArc(manifest, release.activeArcId || release.arcId),
            mode: 'local-browser-store',
        };
    }

    async listManifests() {
        const entries = await this.backend.entries(STORAGE_KEYS.manifestPrefix);
        return entries
            .map((entry) => entry.value)
            .filter(Boolean)
            .sort((left, right) => `${left.id}@${left.version}`.localeCompare(`${right.id}@${right.version}`));
    }

    async listPlayableScenarios() {
        const manifests = await this.listManifests();
        if (
            this.defaultManifest
            && !manifests.some((manifest) => (
                manifest.id === this.defaultManifest.id
                && manifest.version === this.defaultManifest.version
            ))
        ) {
            manifests.push(this.defaultManifest);
        }
        const activeRelease = await this.getActiveRelease().catch(() => null);
        const releases = await this.listReleases().catch(() => []);
        return listPlayableStoryEntries(manifests, { activeRelease, releases });
    }

    async listStoredScenarios() {
        const manifests = await this.listManifests();
        if (
            this.defaultManifest
            && !manifests.some((manifest) => (
                manifest.id === this.defaultManifest.id
                && manifest.version === this.defaultManifest.version
            ))
        ) {
            manifests.push(this.defaultManifest);
        }
        return listStoredStorySummaries(manifests);
    }

    async getBundleForPlayableScenario({ scenarioId, scenarioVersion, arcId, release: providedRelease = null } = {}) {
        const manifest = await this.getManifestByVersion(scenarioId, scenarioVersion);
        if (!manifest) {
            throw new Error('PLAYABLE_SCENARIO_NOT_FOUND');
        }
        const playable = listPlayableStoryEntries([manifest], {
            activeRelease: await this.getActiveRelease().catch(() => null),
            releases: await this.listReleases().catch(() => []),
        }).find((entry) => entry.arcId === arcId);
        if (!playable) {
            throw new Error('PLAYABLE_SCENARIO_NOT_READY');
        }
        const release = providedRelease || createPlayableStoryRelease(manifest, { activeArcId: arcId });
        await this.cacheManifestOnly(manifest);
        return {
            release,
            manifest: materializeManifestForArc(manifest, arcId),
            mode: 'local-browser-store',
        };
    }

    async publishManifest(manifest, { activeArcId = '' } = {}) {
        const validation = validateScenarioManifest(manifest);
        if (!validation.valid) {
            return { ok: false, validation };
        }
        const arcValidation = validateReleaseArcSelection(manifest, activeArcId, { requirePresentationProfileHash: true });
        if (!arcValidation.valid) {
            return { ok: false, validation: arcValidation };
        }

        const release = createActiveRelease(manifest, { activeArcId });
        await this.cachePublishedRelease(release, manifest);
        return { ok: true, release, validation };
    }

    async cachePublishedRelease(release, manifest) {
        const validation = validateScenarioManifest(manifest);
        if (!validation.valid) {
            return { ok: false, validation };
        }
        const arcValidation = validateReleaseArcSelection(manifest, release?.activeArcId || release?.arcId || '', { requirePresentationProfileHash: true });
        if (!arcValidation.valid) {
            return { ok: false, validation: arcValidation };
        }
        const releaseValidation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
        if (!releaseValidation.valid) {
            return { ok: false, validation: releaseValidation };
        }

        const history = await this.listReleases();
        await this.backend.set(manifestKey(manifest.id, manifest.version), manifest);
        await this.backend.set(STORAGE_KEYS.activeRelease, release);
        await this.backend.set(
            STORAGE_KEYS.releaseHistory,
            [release, ...history.filter((item) => item.releaseId !== release.releaseId)].slice(0, 20),
        );
        return { ok: true, release, validation };
    }

    async cacheManifestOnly(manifest) {
        const validation = validateScenarioManifest(manifest);
        if (!validation.valid) {
            return { ok: false, validation };
        }
        await this.backend.set(manifestKey(manifest.id, manifest.version), manifest);
        return { ok: true, validation };
    }

    async listReleases() {
        return (await this.backend.get(STORAGE_KEYS.releaseHistory)) || [];
    }

    async rollback(releaseId) {
        const release = (await this.listReleases()).find((item) => item.releaseId === releaseId);
        if (!release) {
            return false;
        }
        const manifest = await this.getManifestByVersion(release.scenarioId, release.scenarioVersion);
        const validation = validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash: true });
        if (!validation.valid) {
            return false;
        }
        await this.backend.set(STORAGE_KEYS.activeRelease, release);
        return true;
    }

    async recoverDefaultBundle(reason = 'default-recovery') {
        const release = createActiveRelease(this.defaultManifest);
        await this.cachePublishedRelease(release, this.defaultManifest);
        return {
            release,
            manifest: materializeManifestForArc(this.defaultManifest, release.activeArcId || release.arcId),
            mode: 'local-recovered-default',
            recovered: true,
            reason,
        };
    }

    async migrateLegacyReleaseData(active) {
        const history = readLegacyJson(STORAGE_KEYS.releaseHistory) || [active];
        const manifests = legacyManifestEntries();
        await this.backend.set(STORAGE_KEYS.activeRelease, active);
        await this.backend.set(STORAGE_KEYS.releaseHistory, history);
        for (const [key, value] of manifests) {
            await this.backend.set(key, value);
        }
        await this.ensureManifest(active);
    }

    async ensureManifest(active) {
        const key = manifestKey(active.scenarioId, active.scenarioVersion);
        const manifest = await this.backend.get(key);
        if (!manifest && active.scenarioId === this.defaultManifest.id && active.scenarioVersion === this.defaultManifest.version) {
            await this.backend.set(key, this.defaultManifest);
        }
    }
}

export async function getMediaConfig(backend = createStorageBackend()) {
    return {
        enabled: false,
        endpoint: '',
        ...((await backend.get(STORAGE_KEYS.mediaConfig)) || readLegacyJson(STORAGE_KEYS.mediaConfig) || {}),
    };
}

export async function saveMediaConfig(config, backend = createStorageBackend()) {
    await backend.set(STORAGE_KEYS.mediaConfig, {
        enabled: Boolean(config.enabled),
        endpoint: String(config.endpoint || '').trim(),
    });
}

export function createStorageBackend() {
    if (typeof indexedDB !== 'undefined') {
        return new IndexedDbBackend();
    }

    if (typeof localStorage !== 'undefined') {
        return new LocalStorageBackend();
    }

    return new MemoryStorageBackend();
}

export class IndexedDbBackend {
    constructor() {
        this.ready = openDatabase();
    }

    async get(key) {
        const database = await this.ready;
        return runTransaction(database, 'readonly', (store, resolve, reject) => {
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result?.value ?? null);
            request.onerror = () => reject(request.error);
        });
    }

    async set(key, value) {
        const database = await this.ready;
        await runTransaction(database, 'readwrite', (store, resolve, reject) => {
            const request = store.put({ key, value, updatedAt: nowIso() });
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async entries(prefix = '') {
        const database = await this.ready;
        return runTransaction(database, 'readonly', (store, resolve, reject) => {
            const entries = [];
            const request = store.openCursor();
            request.onsuccess = () => {
                const cursor = request.result;
                if (!cursor) {
                    resolve(entries);
                    return;
                }
                if (!prefix || cursor.key.startsWith(prefix)) {
                    entries.push(cursor.value);
                }
                cursor.continue();
            };
            request.onerror = () => reject(request.error);
        });
    }
}

export class LocalStorageBackend {
    async get(key) {
        return readLegacyJson(key);
    }

    async set(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    async entries(prefix = '') {
        const entries = [];
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(prefix)) {
                entries.push({
                    key,
                    value: readLegacyJson(key),
                    updatedAt: '',
                });
            }
        }
        return entries;
    }
}

export class MemoryStorageBackend {
    constructor() {
        this.records = new Map();
    }

    async get(key) {
        return this.records.get(key) ?? null;
    }

    async set(key, value) {
        this.records.set(key, value);
    }

    async entries(prefix = '') {
        return [...this.records.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, value]) => ({
                key,
                value,
                updatedAt: '',
            }));
    }
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function runTransaction(database, mode, executor) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        executor(store, resolve, reject);
        transaction.onerror = () => reject(transaction.error);
    });
}

function manifestKey(id, version) {
    return `${STORAGE_KEYS.manifestPrefix}${id}@${version}`;
}

function shouldRecoverSupersededBuiltInManifest(manifest, defaultManifest) {
    return Boolean(
        manifest
        && defaultManifest
        && manifest.id !== defaultManifest.id
        && SUPERSEDED_BUILT_IN_ENTRY_IDS.has(manifest.id),
    );
}

function readLegacyJson(key) {
    if (typeof localStorage === 'undefined') {
        return null;
    }
    return safeJsonParse(localStorage.getItem(key));
}

function legacyManifestEntries() {
    if (typeof localStorage === 'undefined') {
        return [];
    }

    const entries = [];
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(STORAGE_KEYS.manifestPrefix)) {
            entries.push([key, readLegacyJson(key)]);
        }
    }
    return entries;
}
