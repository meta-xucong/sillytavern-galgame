export const PROCESS_SUPERVISOR_PROTOCOL_VERSION = 'galgame.process-supervisor.v1';
export const PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION = 'galgame.process-supervisor-shutdown.v1';
export const PROCESS_SUPERVISOR_ENDPOINTS = Object.freeze({ recover: '/v1/recover', shutdown: '/v1/shutdown' });
export const PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS = Object.freeze([
    'sillyTavern', 'configService', 'runtimeBridge', 'visualService', 'presentationAnalysis', 'runtimeBridgeChrome', 'processSupervisor',
]);
const finalShutdownErrorCodes = new Set(['RUNTIME_BRIDGE_STATE_CHANGED', 'SHUTDOWN_PARTIAL_FAILURE', 'SHUTDOWN_EXECUTION_FAILED', 'WINDOWS_SHUTDOWN_UNAVAILABLE']);

export function hasExactShutdownServiceKeys(services) {
    if (!services || typeof services !== 'object' || Array.isArray(services)) return false;
    const keys = Object.keys(services).sort();
    const expected = [...PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS].sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

export function isSuccessfulShutdownReceipt(receipt) {
    if (!receipt || receipt.accepted !== true || receipt.complete !== true || receipt.ok !== true
        || receipt.status !== 'completed' || receipt.errorCode !== ''
        || receipt.protocolVersion !== PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION
        || !hasExactShutdownServiceKeys(receipt.services)) return false;
    return PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.every((name) => receipt.services[name]?.status === (name === 'processSupervisor' ? 'kept-running' : ['stopped', 'already-stopped'].includes(receipt.services[name]?.status) ? receipt.services[name].status : ''));
}

function isShutdownOperationShape(operation, phase) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)
        || operation.protocolVersion !== PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION
        || typeof operation.operationId !== 'string' || !hasExactShutdownServiceKeys(operation.services)) return false;
    const allowedTopLevelKeys = ['ok', 'accepted', 'complete', 'protocolVersion', 'operationId', 'status', 'errorCode', 'services'];
    const keys = Object.keys(operation).sort();
    if (keys.length !== allowedTopLevelKeys.length || keys.some((key, index) => key !== [...allowedTopLevelKeys].sort()[index])) return false;
    if (phase === 'accepted') {
        return operation.accepted === true && operation.complete === false && operation.ok === true
            && operation.status === 'shutdown-scheduled' && operation.errorCode === ''
            && PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.every((name) => operation.services[name]?.status === (name === 'processSupervisor' ? 'kept-running' : 'scheduled'));
    }
    if (operation.accepted !== true || typeof operation.complete !== 'boolean' || typeof operation.ok !== 'boolean') return false;
    if (!operation.complete) {
        return operation.ok === true && operation.errorCode === '' && ['shutdown-scheduled', 'shutting-down'].includes(operation.status)
            && PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.every((name) => operation.services[name]?.status === (name === 'processSupervisor' ? 'kept-running' : 'scheduled'));
    }
    if (operation.ok) return isSuccessfulShutdownReceipt(operation);
    return operation.status === 'failed' && finalShutdownErrorCodes.has(operation.errorCode)
        && PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.every((name) => operation.services[name]?.status === (name === 'processSupervisor' ? 'kept-running' : ['stopped', 'already-stopped', 'failed'].includes(operation.services[name]?.status) ? operation.services[name].status : ''));
}

/** Thin player-side adapter for the optional same-machine recovery manager. */
export class LocalProcessSupervisorClient {
    constructor({ baseUrl = 'http://127.0.0.1:8790', fetchImpl = globalThis.fetch } = {}) {
        this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
        this.fetchImpl = fetchImpl;
    }

    async recover(signal) {
        if (!this.baseUrl || typeof this.fetchImpl !== 'function') return null;
        try {
            const response = await this.fetchImpl(`${this.baseUrl}${PROCESS_SUPERVISOR_ENDPOINTS.recover}`, {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-Galgame-Recovery': '1' },
                body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION }),
                signal,
            });
            if (!response.ok) return null;
            const result = await response.json().catch(() => null);
            return result?.protocolVersion === PROCESS_SUPERVISOR_PROTOCOL_VERSION ? result : null;
        } catch {
            // The companion is optional; health probing remains available without it.
            return null;
        }
    }

    async shutdown(signal) {
        if (!this.baseUrl || typeof this.fetchImpl !== 'function') return null;
        try {
            const response = await this.fetchImpl(`${this.baseUrl}${PROCESS_SUPERVISOR_ENDPOINTS.shutdown}`, {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json', 'X-Galgame-Shutdown': '1' },
                body: JSON.stringify({ protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION }),
                signal,
            });
            const result = await response.json().catch(() => null);
            if (response.status === 409) return { ...result, ok: false, refused: true };
            if (response.status !== 202 || !isShutdownOperationShape(result, 'accepted')) return null;
            const deadline = Date.now() + 25_000;
            while (Date.now() < deadline && !signal?.aborted) {
                const statusResponse = await this.fetchImpl(`${this.baseUrl}${PROCESS_SUPERVISOR_ENDPOINTS.shutdown}/${encodeURIComponent(result.operationId)}`, {
                    method: 'GET', cache: 'no-store',
                    headers: { 'X-Galgame-Shutdown': '1', accept: 'application/json' },
                    signal,
                });
                if (!statusResponse.ok) return { ...result, ok: false, complete: true, errorCode: 'SHUTDOWN_STATUS_UNAVAILABLE' };
                const status = await statusResponse.json().catch(() => null);
                if (!isShutdownOperationShape(status, status?.complete === true ? 'final' : 'pending')
                    || status.operationId !== result.operationId) return null;
                if (status.complete === true) return status;
                await new Promise((resolve) => {
                    const cleanup = () => signal?.removeEventListener('abort', onAbort);
                    const timer = setTimeout(() => { cleanup(); resolve(); }, 250);
                    const onAbort = () => { clearTimeout(timer); cleanup(); resolve(); };
                    signal?.addEventListener('abort', onAbort, { once: true });
                });
            }
            return { ...result, ok: false, complete: false, errorCode: signal?.aborted ? 'SHUTDOWN_WAIT_ABORTED' : 'SHUTDOWN_CONFIRMATION_TIMEOUT' };
        } catch {
            return null;
        }
    }
}
