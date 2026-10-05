export const PRESENTATION_CACHE_DB = 'galgame-presentation-cache-v1';
export const PRESENTATION_CACHE_STORE = 'annotations';
export const PRESENTATION_CACHE_MAX_ENTRIES = 1_000;
export const PRESENTATION_CACHE_MAX_BYTES = 20 * 1024 * 1024;
export const PRESENTATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cache only validated annotation DTOs and source hashes; never cache source prose. */
export class PresentationAnnotationCache {
    constructor({ indexedDB = globalThis.indexedDB, now = Date.now } = {}) {
        this.indexedDB = indexedDB;
        this.now = now;
        this.memory = new Map();
        this.databasePromise = null;
    }

    async get(key) {
        const entry = await this.#read(key);
        if (!entry) return null;
        if (this.now() - entry.lastUsedAt > PRESENTATION_CACHE_TTL_MS) {
            await this.delete(key);
            return null;
        }
        entry.lastUsedAt = this.now();
        await this.#write(entry);
        return structuredClone(entry.annotation);
    }

    async put(key, annotation, metadata = {}) {
        const entry = {
            key,
            annotation: structuredClone(annotation),
            sourceMessageIndex: metadata.sourceMessageIndex,
            sourceMessageHash: metadata.sourceMessageHash,
            contextDigest: metadata.contextDigest,
            schemaVersion: metadata.schemaVersion,
            analyzerScope: metadata.analyzerScope,
            lastUsedAt: this.now(),
            byteLength: new TextEncoder().encode(JSON.stringify(annotation)).byteLength,
        };
        await this.#write(entry);
        await this.prune();
    }

    async delete(key) {
        const db = await this.#db();
        if (!db) return this.memory.delete(key);
        await transaction(db, 'readwrite', (store) => store.delete(key));
        return true;
    }

    async deleteFrom(scopeKey, fromMessageIndex) {
        const entries = await this.#all();
        const doomed = entries.filter((entry) => entry.key.startsWith(scopeKey) && entry.sourceMessageIndex >= fromMessageIndex);
        for (const entry of doomed) await this.delete(entry.key);
        return doomed.length;
    }

    async reconcileTimeline(scopeKey, sourceTimeline) {
        const cached = (await this.#all())
            .filter((entry) => entry.key.startsWith(scopeKey))
            .sort((a, b) => a.sourceMessageIndex - b.sourceMessageIndex);
        const cachedByIndex = new Map();
        for (const entry of cached) {
            const hashes = cachedByIndex.get(entry.sourceMessageIndex) || new Set();
            hashes.add(entry.sourceMessageHash);
            cachedByIndex.set(entry.sourceMessageIndex, hashes);
        }
        let dirtyIndex = null;
        for (const source of sourceTimeline) {
            const hashes = cachedByIndex.get(source.sourceMessageIndex);
            if (!hashes || !hashes.has(source.sourceMessageHash)) {
                if (cached.length) dirtyIndex = source.sourceMessageIndex;
                break;
            }
        }
        if (dirtyIndex === null) {
            const liveIndexes = new Set(sourceTimeline.map((item) => item.sourceMessageIndex));
            const removed = cached.find((entry) => !liveIndexes.has(entry.sourceMessageIndex));
            if (removed) dirtyIndex = removed.sourceMessageIndex;
        }
        return dirtyIndex === null ? 0 : this.deleteFrom(scopeKey, dirtyIndex);
    }

    async prune() {
        const entries = (await this.#all()).sort((a, b) => a.lastUsedAt - b.lastUsedAt);
        let total = entries.reduce((sum, entry) => sum + (entry.byteLength || 0), 0);
        while (entries.length > PRESENTATION_CACHE_MAX_ENTRIES || total > PRESENTATION_CACHE_MAX_BYTES
            || entries[0] && this.now() - entries[0].lastUsedAt > PRESENTATION_CACHE_TTL_MS) {
            const entry = entries.shift();
            if (!entry) break;
            total -= entry.byteLength || 0;
            await this.delete(entry.key);
        }
    }

    async #read(key) {
        const db = await this.#db();
        if (!db) return this.memory.get(key) || null;
        return transaction(db, 'readonly', (store) => store.get(key));
    }

    async #write(entry) {
        const db = await this.#db();
        if (!db) { this.memory.set(entry.key, entry); return; }
        await transaction(db, 'readwrite', (store) => store.put(entry));
    }

    async #all() {
        const db = await this.#db();
        if (!db) return [...this.memory.values()];
        return transaction(db, 'readonly', (store) => store.getAll());
    }

    async #db() {
        if (!this.indexedDB) return null;
        if (!this.databasePromise) {
            this.databasePromise = new Promise((resolve, reject) => {
                const request = this.indexedDB.open(PRESENTATION_CACHE_DB, 1);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    if (!db.objectStoreNames.contains(PRESENTATION_CACHE_STORE)) db.createObjectStore(PRESENTATION_CACHE_STORE, { keyPath: 'key' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            }).catch(() => null);
        }
        return this.databasePromise;
    }
}

function transaction(db, mode, operation) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(PRESENTATION_CACHE_STORE, mode);
        const request = operation(transaction.objectStore(PRESENTATION_CACHE_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error || new Error('cache transaction aborted'));
    });
}
