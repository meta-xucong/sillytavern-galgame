/**
 * Small, provider-neutral connection monitor for the player shell.
 *
 * The monitor deliberately owns no transport details. Callers provide probes
 * for the original SillyTavern runtime, config service, runtime bridge and
 * visual service. This keeps status checks removable without changing either
 * SillyTavern or the external services.
 */

export const CONNECTION_HEALTH_PROTOCOL_VERSION = 'galgame.connection-health.v1';

const DEFAULT_SERVICE_NAMES = Object.freeze([
    'sillyTavern',
    'configService',
    'runtimeBridge',
    'visualService',
    'generation',
]);

export function createConnectionHealthMonitor({
    probes = {},
    intervalMs = 10_000,
    timeoutMs = 5_000,
    now = () => Date.now(),
} = {}) {
    return new ConnectionHealthMonitor({ probes, intervalMs, timeoutMs, now });
}

export class ConnectionHealthMonitor {
    constructor({ probes = {}, intervalMs = 10_000, timeoutMs = 5_000, now = () => Date.now() } = {}) {
        this.probes = { ...probes };
        this.intervalMs = Math.max(1_000, Number(intervalMs) || 10_000);
        this.timeoutMs = Math.max(250, Number(timeoutMs) || 5_000);
        this.now = now;
        this.listeners = new Set();
        this.timer = null;
        this.running = false;
        this.inFlight = null;
        this.sequence = 0;
        this.state = createInitialState(this.now());
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }

    getSnapshot() {
        const snapshot = clone(this.state);
        const now = this.now();
        for (const service of Object.values(snapshot.services)) {
            service.stale = !service.checkedAt || now - service.checkedAt > this.intervalMs * 2;
        }
        if (snapshot.overall === 'up' && Object.values(snapshot.services).some((service) => service.stale && service.checkedAt)) {
            snapshot.overall = 'degraded';
        }
        return snapshot;
    }

    setProbe(name, probe) {
        if (!DEFAULT_SERVICE_NAMES.includes(name)) {
            throw new Error(`CONNECTION_HEALTH_UNKNOWN_SERVICE:${name}`);
        }
        if (probe !== undefined && typeof probe !== 'function') {
            throw new TypeError(`CONNECTION_HEALTH_PROBE_REQUIRED:${name}`);
        }
        if (probe) this.probes[name] = probe;
        else delete this.probes[name];
    }

    start({ immediate = true } = {}) {
        if (this.running) return this;
        this.running = true;
        if (immediate) void this.probeNow({ reason: 'start' });
        this.timer = setInterval(() => {
            void this.probeNow({ reason: 'interval' });
        }, this.intervalMs);
        return this;
    }

    stop() {
        this.running = false;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return this;
    }

    async probeNow({ reason = 'manual', signal = null } = {}) {
        if (this.inFlight) return this.inFlight;
        const startedAt = this.now();
        const sequence = ++this.sequence;
        this.inFlight = Promise.all(DEFAULT_SERVICE_NAMES
            .filter((name) => name !== 'generation')
            .map((name) => this.#probeService(name, signal)))
            .then((results) => {
                const services = {
                    ...this.state.services,
                    ...Object.fromEntries(results.map(({ name, value }) => [name, value])),
                };
                this.state = {
                    ...this.state,
                    protocolVersion: CONNECTION_HEALTH_PROTOCOL_VERSION,
                    sequence,
                    checkedAt: this.now(),
                    durationMs: Math.max(0, this.now() - startedAt),
                    reason,
                    services,
                    overall: summarizeOverall(services),
                };
                this.#emit();
                return this.getSnapshot();
            })
            .finally(() => {
                this.inFlight = null;
            });
        return this.inFlight;
    }

    recordGenerationStart({ requestId = '' } = {}) {
        const attemptAt = this.now();
        this.state = {
            ...this.state,
            services: {
                ...this.state.services,
                generation: {
                    ...this.state.services.generation,
                    status: 'pending',
                    ok: null,
                    requestId: sanitize(requestId, 160),
                    attemptAt,
                    errorCode: '',
                },
            },
            overall: summarizeOverall(this.state.services, { generationPending: true }),
        };
        this.#emit();
        return this.getSnapshot();
    }

    recordGeneration({ ok, errorCode = '', requestId = '', latencyMs = 0 } = {}) {
        const checkedAt = this.now();
        const success = ok === true;
        const previous = this.state.services.generation;
        const next = {
            ...previous,
            status: success ? 'up' : 'down',
            ok: success,
            requestId: sanitize(requestId, 160),
            checkedAt,
            latencyMs: toFiniteNumber(latencyMs),
            errorCode: success ? '' : sanitize(errorCode || 'GENERATION_FAILED', 120),
            consecutiveFailures: success ? 0 : Number(previous.consecutiveFailures || 0) + 1,
            consecutiveSuccesses: success ? Number(previous.consecutiveSuccesses || 0) + 1 : 0,
            lastSuccessAt: success ? checkedAt : previous.lastSuccessAt,
            lastFailureAt: success ? previous.lastFailureAt : checkedAt,
        };
        this.state = {
            ...this.state,
            services: { ...this.state.services, generation: next },
            overall: summarizeOverall({ ...this.state.services, generation: next }),
        };
        this.#emit();
        return this.getSnapshot();
    }

    async #probeService(name, parentSignal) {
        const probe = this.probes[name];
        const previous = this.state.services[name] || createServiceState();
        if (typeof probe !== 'function') {
            return { name, value: { ...previous, status: 'unknown', ok: null, errorCode: 'PROBE_UNCONFIGURED' } };
        }
        const startedAt = this.now();
        const controller = new AbortController();
        let rejectAbort;
        const abortPromise = new Promise((_, reject) => { rejectAbort = reject; });
        const timeout = setTimeout(() => {
            controller.abort();
            rejectAbort(Object.assign(new Error('HEALTH_CHECK_TIMEOUT'), { code: 'HEALTH_CHECK_TIMEOUT' }));
        }, this.timeoutMs);
        const abortParent = () => {
            controller.abort();
            rejectAbort(Object.assign(new Error('HEALTH_CHECK_ABORTED'), { code: 'HEALTH_CHECK_ABORTED' }));
        };
        parentSignal?.addEventListener?.('abort', abortParent, { once: true });
        try {
            const result = await Promise.race([probe(controller.signal), abortPromise]);
            const ok = result?.ok === true;
            const status = result?.connectionState === 'generating' || result?.pending
                ? 'pending'
                : result?.connectionState === 'idle'
                    ? 'idle'
                : ok ? 'up' : 'down';
            const checkedAt = this.now();
            return {
                name,
                value: {
                    ...previous,
                    status,
                    ok: status === 'pending' ? null : ok,
                    checkedAt,
                    latencyMs: Math.max(0, checkedAt - startedAt),
                    errorCode: status === 'pending'
                        ? 'GENERATION_IN_PROGRESS'
                        : ok ? '' : sanitize(result?.errorCode || 'SERVICE_UNAVAILABLE', 120),
                    details: sanitizeDetails(result),
                    consecutiveFailures: status === 'pending' ? previous.consecutiveFailures : ok ? 0 : Number(previous.consecutiveFailures || 0) + 1,
                    consecutiveSuccesses: status === 'pending' ? previous.consecutiveSuccesses : ok ? Number(previous.consecutiveSuccesses || 0) + 1 : 0,
                    lastSuccessAt: ok ? checkedAt : previous.lastSuccessAt,
                    lastFailureAt: ok || status === 'pending' ? previous.lastFailureAt : checkedAt,
                },
            };
        } catch (error) {
            const checkedAt = this.now();
            const timeoutFailure = controller.signal.aborted;
            return {
                name,
                value: {
                    ...previous,
                    status: 'down',
                    ok: false,
                    checkedAt,
                    latencyMs: Math.max(0, checkedAt - startedAt),
                    errorCode: timeoutFailure ? 'HEALTH_CHECK_TIMEOUT' : sanitize(error?.code || error?.message || 'SERVICE_UNAVAILABLE', 120),
                    consecutiveFailures: Number(previous.consecutiveFailures || 0) + 1,
                    consecutiveSuccesses: 0,
                    lastFailureAt: checkedAt,
                },
            };
        } finally {
            clearTimeout(timeout);
            parentSignal?.removeEventListener?.('abort', abortParent);
        }
    }

    #emit() {
        const snapshot = this.getSnapshot();
        for (const listener of this.listeners) {
            try { listener(snapshot); } catch { /* observer failures never stop health checks */ }
        }
    }
}

function createInitialState(now) {
    return {
        protocolVersion: CONNECTION_HEALTH_PROTOCOL_VERSION,
        sequence: 0,
        checkedAt: 0,
        durationMs: 0,
        reason: 'initial',
        overall: 'unknown',
        services: Object.fromEntries(DEFAULT_SERVICE_NAMES.map((name) => [name, createServiceState()])),
    };
}

function createServiceState() {
    return {
        status: 'unknown',
        ok: null,
        stale: true,
        checkedAt: 0,
        latencyMs: 0,
        errorCode: '',
        details: {},
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        lastSuccessAt: 0,
        lastFailureAt: 0,
    };
}

function summarizeOverall(services, { generationPending = false } = {}) {
    if (generationPending) return 'degraded';
    const states = Object.entries(services)
        .filter(([name, service]) => name !== 'generation' || service.status !== 'unknown')
        .map(([, service]) => service.status === 'idle' ? 'up' : service.status);
    if (states.every((status) => status === 'up')) return 'up';
    if (states.some((status) => status === 'down')) return states.some((status) => status === 'up') ? 'degraded' : 'down';
    if (states.some((status) => status === 'up')) return 'degraded';
    return 'unknown';
}

function sanitize(value, maxLength) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
}

function sanitizeDetails(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !['ok', 'errorCode'].includes(key))
        .slice(0, 12)
        .map(([key, item]) => [sanitize(key, 40), typeof item === 'string' ? sanitize(item, 160) : item]));
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
