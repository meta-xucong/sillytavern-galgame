import assert from 'node:assert/strict';
import { hasExactShutdownServiceKeys, isSuccessfulShutdownReceipt, LocalProcessSupervisorClient, PROCESS_SUPERVISOR_PROTOCOL_VERSION, PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS } from '../src/process-supervisor-adapter.js';

let request = null;
const client = new LocalProcessSupervisorClient({
    baseUrl: 'http://127.0.0.1:8790/',
    fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ ok: true, protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION, services: {} }) };
    },
});
const result = await client.recover();
assert.equal(result.ok, true);
assert.equal(request.url, 'http://127.0.0.1:8790/v1/recover');
assert.equal(request.options.method, 'POST');
assert.equal(request.options.headers['X-Galgame-Recovery'], '1');
assert.deepEqual(JSON.parse(request.options.body), { protocolVersion: PROCESS_SUPERVISOR_PROTOCOL_VERSION });

const offline = new LocalProcessSupervisorClient({ fetchImpl: async () => { throw new Error('offline'); } });
assert.equal((await offline.recover()).errorCode, 'RECOVERY_SERVICE_UNAVAILABLE');
const timedOut = new LocalProcessSupervisorClient({ fetchImpl: async () => { throw new DOMException('aborted', 'AbortError'); } });
assert.equal((await timedOut.recover(AbortSignal.abort())).errorCode, 'RECOVERY_REQUEST_TIMEOUT');
const refused = new LocalProcessSupervisorClient({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ errorCode: 'RECOVERY_REQUEST_NOT_ALLOWED' }) }),
});
assert.equal((await refused.recover()).errorCode, 'RECOVERY_REQUEST_NOT_ALLOWED');
const malformed = new LocalProcessSupervisorClient({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ protocolVersion: 'wrong' }) }),
});
assert.equal((await malformed.recover()).errorCode, 'RECOVERY_RESPONSE_INVALID');

let shutdownRequest = null;
const acceptedServices = Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, { status: name === 'processSupervisor' ? 'kept-running' : 'scheduled' }]));
const completedServices = Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, { status: name === 'processSupervisor' ? 'kept-running' : 'stopped' }]));
const successfulReceipt = { complete: true, ok: true, status: 'completed', errorCode: '', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'test-operation', accepted: true, services: completedServices };
assert.equal(hasExactShutdownServiceKeys(acceptedServices), true);
assert.equal(hasExactShutdownServiceKeys({}), false, 'missing and empty shutdown service maps are rejected');
assert.equal(isSuccessfulShutdownReceipt(successfulReceipt), true);
assert.equal(isSuccessfulShutdownReceipt({ ...successfulReceipt, services: { processSupervisor: { status: 'kept-running' } } }), false);
assert.equal(isSuccessfulShutdownReceipt({ ...successfulReceipt, errorCode: 'UNKNOWN_FAILURE' }), false, 'unknown error codes cannot authorize tab closure');
const shutdownClient = new LocalProcessSupervisorClient({
    baseUrl: 'http://127.0.0.1:8790',
    fetchImpl: async (url, options) => {
        shutdownRequest ||= [];
        shutdownRequest.push({ url, options });
        if (options.method === 'POST') return {
            status: 202,
            json: async () => ({ accepted: true, complete: false, ok: true, status: 'shutdown-scheduled', errorCode: '', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'test-operation', services: acceptedServices }),
        };
        return { ok: true, json: async () => successfulReceipt };
    },
});
assert.equal((await shutdownClient.shutdown()).ok, true);
assert.equal(shutdownRequest[0].url, 'http://127.0.0.1:8790/v1/shutdown');
assert.equal(shutdownRequest[0].options.method, 'POST');
assert.equal(shutdownRequest[0].options.headers['X-Galgame-Shutdown'], '1');
assert.deepEqual(JSON.parse(shutdownRequest[0].options.body), { protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION });
assert.equal(shutdownRequest[1].url, 'http://127.0.0.1:8790/v1/shutdown/test-operation');

const partialClient = new LocalProcessSupervisorClient({
    fetchImpl: async (url, options) => options.method === 'POST'
        ? { status: 202, json: async () => ({ accepted: true, complete: false, ok: true, status: 'shutdown-scheduled', errorCode: '', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'partial-operation', services: acceptedServices }) }
        : { ok: true, json: async () => ({ accepted: true, complete: true, ok: false, status: 'failed', errorCode: 'SHUTDOWN_PARTIAL_FAILURE', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'partial-operation', services: { ...completedServices, sillyTavern: { status: 'failed' } } }) },
});
const partialResult = await partialClient.shutdown();
assert.equal(partialResult.complete, true);
assert.equal(partialResult.ok, false, 'a final partial-stop receipt is propagated as failure');

const unavailableReceiptClient = new LocalProcessSupervisorClient({
    fetchImpl: async (_url, options) => options.method === 'POST'
        ? { status: 202, json: async () => ({ accepted: true, complete: false, ok: true, status: 'shutdown-scheduled', errorCode: '', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'lost-operation', services: acceptedServices }) }
        : { ok: false, status: 503, json: async () => ({}) },
});
assert.equal((await unavailableReceiptClient.shutdown()).ok, false, 'a lost receipt cannot be treated as completed shutdown');

const unknownErrorReceiptClient = new LocalProcessSupervisorClient({
    fetchImpl: async (_url, options) => options.method === 'POST'
        ? { status: 202, json: async () => ({ accepted: true, complete: false, ok: true, status: 'shutdown-scheduled', errorCode: '', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'unknown-error-operation', services: acceptedServices }) }
        : { ok: true, json: async () => ({ accepted: true, complete: true, ok: false, status: 'failed', errorCode: 'UNKNOWN_ERROR', protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL_VERSION, operationId: 'unknown-error-operation', services: Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, { status: name === 'processSupervisor' ? 'kept-running' : 'failed' }])) }) },
});
assert.equal(await unknownErrorReceiptClient.shutdown(), null, 'unknown final error values invalidate the receipt');

const refusedClient = new LocalProcessSupervisorClient({ fetchImpl: async () => ({ status: 409, json: async () => ({ errorCode: 'RUNTIME_BRIDGE_NOT_SAFE_TO_CLOSE' }) }) });
assert.equal((await refusedClient.shutdown()).refused, true);
console.log('process supervisor player adapter tests passed');
