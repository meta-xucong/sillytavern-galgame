import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(moduleDir, '../..');
export const PROCESS_SUPERVISOR_SERVICE_PORTS = Object.freeze({ sillyTavern: 8000, configService: 8791, runtimeBridge: 8795, visualService: 8798 });
export const PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL = 'galgame.process-supervisor-shutdown.v1';
export const ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL = 'galgame.original-runtime-shutdown-gate.v1';
export const PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS = Object.freeze([
    'sillyTavern', 'configService', 'runtimeBridge', 'visualService', 'presentationAnalysis', 'runtimeBridgeChrome', 'processSupervisor',
]);
export const PROCESS_SUPERVISOR_SHUTDOWN_OPERATION_LIMIT = 32;
export const PROCESS_SUPERVISOR_SHUTDOWN_OPERATION_TTL_MS = 5 * 60_000;
const shutdownFinalErrorCodes = new Set(['RUNTIME_BRIDGE_STATE_CHANGED', 'SHUTDOWN_GATE_RENEWAL_FAILED', 'SHUTDOWN_PARTIAL_FAILURE', 'SHUTDOWN_EXECUTION_FAILED', 'WINDOWS_SHUTDOWN_UNAVAILABLE']);
const healthPaths = Object.freeze({ sillyTavern: '/', configService: '/v1/health', runtimeBridge: '/health', visualService: '/v1/health' });
const optionalServicePorts = Object.freeze({ presentationAnalysis: 8801 });
const optionalHealthPaths = Object.freeze({ presentationAnalysis: '/v1/health' });
const startupScripts = Object.freeze({
    configService: path.join('external-modules', 'process-supervisor', 'launchers', 'StartGalgameConfigService.cmd'),
    runtimeBridge: path.join('external-modules', 'process-supervisor', 'launchers', 'StartGalgameRuntimeBridge.cmd'),
    presentationAnalysis: path.join('external-modules', 'presentation-analysis-service', 'StartGalgamePresentationAnalysisService.cmd'),
});
const logDir = path.join(repoRoot, '.codex-longrun');

export function createProcessSupervisor({
    allowedOrigins = getAllowedOrigins(),
    probes = createDefaultProbes(),
    optionalProbes = createDefaultOptionalProbes(),
    listenerHost = '127.0.0.1',
    listenerPort = Number(process.env.GALGAME_PROCESS_SUPERVISOR_PORT || 8790),
    startupConfirmationTimeoutMs = 15_000,
    startupProbeIntervalMs = 300,
    launcher = launchAllowlistedService,
    bridgeShutdownHealthProbe = probeRuntimeBridgeForShutdown,
    bridgeShutdownGate = acquireRuntimeBridgeShutdownGate,
    bridgeShutdownGateRenew = renewRuntimeBridgeShutdownGate,
    bridgeShutdownGateRelease = releaseRuntimeBridgeShutdownGate,
    shutdownExecutor = executeAllowlistedShutdown,
    shutdownDelayMs = 250,
    shutdownOperationLimit = PROCESS_SUPERVISOR_SHUTDOWN_OPERATION_LIMIT,
    shutdownOperationTtlMs = PROCESS_SUPERVISOR_SHUTDOWN_OPERATION_TTL_MS,
    shutdownGateRenewIntervalMs = 15_000,
    now = () => Date.now(),
} = {}) {
    if (listenerHost !== '127.0.0.1') throw new Error('PROCESS_SUPERVISOR_LOOPBACK_ONLY');
    const allowedOriginSet = new Set(allowedOrigins);
    const shutdownOperations = new Map();
    let activeShutdownRecord = null;
    return createServer(async (request, response) => {
        const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
        if (origin && allowedOriginSet.has(origin)) {
            response.setHeader('Access-Control-Allow-Origin', origin);
            response.setHeader('Vary', 'Origin');
            response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Galgame-Recovery, X-Galgame-Shutdown');
        }
        if (request.method === 'OPTIONS') {
            if (!allowedOriginSet.has(origin)) return sendJson(response, 403, { ok: false, errorCode: 'ORIGIN_NOT_ALLOWED' });
            response.writeHead(204).end();
            return;
        }

        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/health') {
            return sendJson(response, 200, { ok: true, mode: 'galgame-process-supervisor', protocolVersion: 'galgame.process-supervisor.v1' });
        }
        const shutdownStatusMatch = url.pathname.match(/^\/v1\/shutdown\/([0-9a-f-]{36})$/i);
        if (request.method === 'GET' && shutdownStatusMatch) {
            if (!allowedOriginSet.has(origin) || request.headers['x-galgame-shutdown'] !== '1') {
                return sendJson(response, 403, { ok: false, errorCode: 'SHUTDOWN_REQUEST_NOT_ALLOWED' });
            }
            pruneShutdownOperations(shutdownOperations, now(), shutdownOperationLimit, shutdownOperationTtlMs);
            const record = shutdownOperations.get(shutdownStatusMatch[1]);
            if (!record) return sendJson(response, 404, { ok: false, errorCode: 'SHUTDOWN_OPERATION_NOT_FOUND' });
            return sendJson(response, 200, { ...record.operation });
        }
        if (request.method === 'POST' && url.pathname === '/v1/shutdown') {
            if (!allowedOriginSet.has(origin) || request.headers['x-galgame-shutdown'] !== '1'
                || !String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
                return sendJson(response, 403, { ok: false, errorCode: 'SHUTDOWN_REQUEST_NOT_ALLOWED' });
            }
            const body = await readJsonBody(request).catch(() => null);
            if (!body || body.protocolVersion !== PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL
                || Object.keys(body).some((key) => key !== 'protocolVersion')) {
                return sendJson(response, 400, { ok: false, errorCode: 'SHUTDOWN_PROTOCOL_INVALID' });
            }

            // Once admitted, every duplicate click resolves to the same active
            // receipt. The bridge gate is a short lease, so it cannot provide
            // process-level single-flight on its own.
            if (activeShutdownRecord && activeShutdownRecord.completedAtMs === null) {
                const inFlightRecord = activeShutdownRecord;
                await inFlightRecord.admissionPromise;
                if (!inFlightRecord.operation.accepted) {
                    return sendJson(response, 409, {
                        ok: false, protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL,
                        errorCode: inFlightRecord.operation.errorCode,
                        status: inFlightRecord.operation.status,
                        operationId: inFlightRecord.operation.operationId,
                    });
                }
                response.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                response.end(JSON.stringify(inFlightRecord.operation));
                return;
            }

            const operationId = randomUUID();
            pruneShutdownOperations(shutdownOperations, now(), shutdownOperationLimit, shutdownOperationTtlMs);
            const operation = {
                ok: true,
                accepted: true,
                complete: false,
                protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL,
                operationId,
                status: 'shutdown-preparing',
                errorCode: '',
                services: createScheduledShutdownServices(),
            };
            let resolveAdmission;
            const admissionPromise = new Promise((resolve) => { resolveAdmission = resolve; });
            const record = { operation, completedAtMs: null, admissionPromise };
            shutdownOperations.set(operationId, record);
            activeShutdownRecord = record;
            let gate;
            try { gate = await bridgeShutdownGate(); } catch { gate = null; }
            if (!gate?.ok || typeof gate.gateId !== 'string' || !gate.gateId
                || gate.pending !== false || gate.stale !== false || gate.stopping !== false) {
                operation.ok = false;
                operation.accepted = false;
                operation.complete = true;
                operation.status = 'refused';
                operation.errorCode = 'RUNTIME_BRIDGE_NOT_SAFE_TO_CLOSE';
                operation.services = createFailedShutdownServices();
                record.completedAtMs = now();
                resolveAdmission();
                activeShutdownRecord = null;
                return sendJson(response, 409, {
                    ok: false,
                    protocolVersion: PROCESS_SUPERVISOR_SHUTDOWN_PROTOCOL,
                    errorCode: 'RUNTIME_BRIDGE_NOT_SAFE_TO_CLOSE',
                    status: 'refused',
                    operationId,
                });
            }
            operation.status = 'shutdown-scheduled';
            resolveAdmission();
            response.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify(operation));
            response.once('finish', () => {
                setTimeout(() => {
                    operation.status = 'shutting-down';
                    void runShutdownOperation(operation, {
                        gateId: gate.gateId, shutdownExecutor, bridgeShutdownHealthProbe,
                        bridgeShutdownGateRenew, bridgeShutdownGateRelease, shutdownGateRenewIntervalMs,
                    })
                        .finally(() => {
                            record.completedAtMs = now();
                            if (activeShutdownRecord === record) activeShutdownRecord = null;
                            pruneShutdownOperations(shutdownOperations, now(), shutdownOperationLimit, shutdownOperationTtlMs);
                        });
                }, Math.max(0, shutdownDelayMs)).unref?.();
            });
            return;
        }
        if (request.method !== 'POST' || url.pathname !== '/v1/recover') {
            return sendJson(response, 404, { ok: false, errorCode: 'NOT_FOUND' });
        }
        if (!allowedOriginSet.has(origin) || request.headers['x-galgame-recovery'] !== '1'
            || !String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
            return sendJson(response, 403, { ok: false, errorCode: 'RECOVERY_REQUEST_NOT_ALLOWED' });
        }
        const body = await readJsonBody(request).catch(() => null);
        if (!body || body.protocolVersion !== 'galgame.process-supervisor.v1') {
            return sendJson(response, 400, { ok: false, errorCode: 'RECOVERY_PROTOCOL_INVALID' });
        }

        const results = {};
        for (const name of Object.keys(PROCESS_SUPERVISOR_SERVICE_PORTS)) {
            const probe = await probes[name]().catch(() => ({ reachable: false, healthy: false, errorCode: 'PROBE_FAILED' }));
            const staleBridgeCanRestart = name === 'runtimeBridge'
                && probe.reachable && probe.stale === true && probe.pending === true && probe.stopping !== true;
            if (staleBridgeCanRestart) {
                try {
                    const launchResult = await launcher(name);
                    const started = launchResult?.started === true;
                    const confirmed = (started || launchResult?.alreadyRunning === true)
                        ? await waitForHealthyService(probes[name], { timeoutMs: startupConfirmationTimeoutMs, intervalMs: startupProbeIntervalMs })
                        : null;
                    results[name] = recoveryResult(launchResult, confirmed, 'restarting', true);
                } catch {
                    results[name] = { status: 'not-started', started: false, restarted: false, errorCode: 'SERVICE_START_FAILED' };
                }
                continue;
            }
            if (probe.reachable) {
                results[name] = { status: probe.healthy ? 'running' : 'running-unhealthy', started: false, errorCode: probe.healthy ? '' : probe.errorCode || 'SERVICE_UNHEALTHY' };
                continue;
            }
            try {
                const launchResult = await launcher(name);
                const started = launchResult?.started === true;
                const confirmed = (started || launchResult?.alreadyRunning === true)
                    ? await waitForHealthyService(probes[name], { timeoutMs: startupConfirmationTimeoutMs, intervalMs: startupProbeIntervalMs })
                    : null;
                results[name] = recoveryResult(launchResult, confirmed, 'starting', false);
            } catch {
                results[name] = { status: 'not-started', started: false, errorCode: 'SERVICE_START_FAILED' };
            }
        }
        const optionalDiagnostics = {};
        for (const name of Object.keys(optionalServicePorts)) {
            const probe = await optionalProbes[name]().catch(() => ({ reachable: false, healthy: false, errorCode: 'PROBE_FAILED' }));
            if (probe.reachable) {
                if (name === 'presentationAnalysis' && probe.healthy && probe.analyzerConfigured !== true) {
                    try {
                        const launchResult = await launcher(name);
                        const started = launchResult?.started === true;
                        const confirmed = started
                            ? await waitForConfiguredOptionalService(optionalProbes[name], { timeoutMs: startupConfirmationTimeoutMs, intervalMs: startupProbeIntervalMs })
                            : null;
                        optionalDiagnostics[name] = {
                            status: confirmed === true ? 'ready' : started ? 'starting' : 'running-unconfigured',
                            reachable: confirmed === true,
                            serviceReady: confirmed === true,
                            analyzerConfigured: confirmed === true,
                            errorCode: confirmed === true ? '' : launchResult?.errorCode || (started ? 'ANALYZER_CONFIGURATION_RELOAD_PENDING' : 'ANALYZER_NOT_CONFIGURED'),
                        };
                    } catch {
                        optionalDiagnostics[name] = { status: 'running-unconfigured', reachable: true, serviceReady: true, analyzerConfigured: false, errorCode: 'SERVICE_START_FAILED' };
                    }
                    continue;
                }
                // The analysis service is auxiliary. Its availability and provider
                // configuration must never affect core recovery's ok/accepted state.
                optionalDiagnostics[name] = {
                    status: probe.healthy ? (probe.analyzerConfigured ? 'ready' : 'running-unconfigured') : 'running-unhealthy',
                    reachable: true,
                    serviceReady: probe.healthy === true,
                    analyzerConfigured: probe.analyzerConfigured === true,
                    errorCode: probe.healthy ? (probe.analyzerConfigured ? '' : 'ANALYZER_NOT_CONFIGURED') : probe.errorCode || 'SERVICE_UNHEALTHY',
                };
                continue;
            }
            try {
                const launchResult = await launcher(name);
                optionalDiagnostics[name] = {
                    status: launchResult?.started ? 'starting' : 'not-started',
                    reachable: false,
                    serviceReady: false,
                    analyzerConfigured: false,
                    errorCode: launchResult?.errorCode || (launchResult?.started ? '' : 'SERVICE_START_FAILED'),
                };
            } catch {
                optionalDiagnostics[name] = { status: 'not-started', reachable: false, serviceReady: false, analyzerConfigured: false, errorCode: 'SERVICE_START_FAILED' };
            }
        }
        writeRecoveryLog({ ...results, diagnostics: optionalDiagnostics });
        return sendJson(response, 200, {
            ok: Object.values(results).every((entry) => entry.status === 'running'),
            accepted: Object.values(results).every((entry) => entry.status !== 'not-started'),
            mode: 'galgame-process-supervisor',
            protocolVersion: 'galgame.process-supervisor.v1',
            services: results,
            diagnostics: optionalDiagnostics,
        });
    });
}

async function probeRuntimeBridgeForShutdown() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
        const headers = {};
        const token = String(process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '').trim();
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetch('http://127.0.0.1:8795/health', { headers, signal: controller.signal, cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body.pending !== 'boolean' || typeof body.stale !== 'boolean' || typeof body.stopping !== 'boolean') {
            return { available: false };
        }
        return { available: true, pending: body.pending, stale: body.stale, stopping: body.stopping, shutdownGate: body.shutdownGate === true };
    } catch {
        return { available: false };
    } finally {
        clearTimeout(timer);
    }
}

async function acquireRuntimeBridgeShutdownGate() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
        const headers = { 'Content-Type': 'application/json' };
        const token = String(process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '').trim();
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetch('http://127.0.0.1:8795/v1/shutdown-gate', {
            method: 'POST',
            headers,
            body: JSON.stringify({ protocolVersion: ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL, action: 'acquire' }),
            signal: controller.signal,
            cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        return response.ok && body?.ok === true && body?.protocolVersion === ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL
            ? body
            : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
}

async function releaseRuntimeBridgeShutdownGate(gateId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
        const headers = { 'Content-Type': 'application/json' };
        const token = String(process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '').trim();
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetch('http://127.0.0.1:8795/v1/shutdown-gate/release', {
            method: 'POST', headers,
            body: JSON.stringify({ protocolVersion: ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL, action: 'release', gateId }),
            signal: controller.signal, cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        return response.ok && body?.released === true;
    } catch { return false; }
    finally { clearTimeout(timer); }
}

async function renewRuntimeBridgeShutdownGate(gateId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2_000);
    try {
        const headers = { 'Content-Type': 'application/json' };
        const token = String(process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '').trim();
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetch('http://127.0.0.1:8795/v1/shutdown-gate/renew', {
            method: 'POST', headers,
            body: JSON.stringify({ protocolVersion: ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL, action: 'renew', gateId }),
            signal: controller.signal, cache: 'no-store',
        });
        const body = await response.json().catch(() => null);
        return response.ok && body?.ok === true && body?.renewed === true
            && body?.protocolVersion === ORIGINAL_RUNTIME_SHUTDOWN_GATE_PROTOCOL && body?.gateId === gateId;
    } catch { return false; }
    finally { clearTimeout(timer); }
}

function createShutdownGateKeeper({ gateId, renew, intervalMs }) {
    let stopped = false;
    let waitTimer = null;
    let resolveWait = null;
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    const loop = (async () => {
        while (!stopped) {
            await new Promise((resolve) => {
                resolveWait = resolve;
                waitTimer = setTimeout(resolve, Math.max(1, Number(intervalMs) || 15_000));
            });
            waitTimer = null;
            resolveWait = null;
            if (stopped) return;
            let renewed = false;
            try { renewed = await renew(gateId) === true; } catch { renewed = false; }
            if (!renewed) throw new Error('SHUTDOWN_GATE_RENEWAL_FAILED');
        }
    })();
    loop.catch(rejectFailure);
    return {
        failure,
        async stop() {
            stopped = true;
            if (waitTimer) clearTimeout(waitTimer);
            waitTimer = null;
            resolveWait?.();
            resolveWait = null;
            await loop.catch(() => {});
        },
    };
}

async function runShutdownOperation(operation, {
    gateId, shutdownExecutor, bridgeShutdownHealthProbe, bridgeShutdownGateRenew,
    bridgeShutdownGateRelease, shutdownGateRenewIntervalMs,
}) {
    let renewalFailed = false;
    try {
        const runtimeState = await bridgeShutdownHealthProbe();
        if (!runtimeState?.available || runtimeState.shutdownGate !== true || runtimeState.pending !== false
            || runtimeState.stale !== false || runtimeState.stopping !== false) {
            throw new Error('RUNTIME_BRIDGE_STATE_CHANGED');
        }
        const abortController = new AbortController();
        let signalExecutorStarted;
        const executorStarted = new Promise((resolve) => { signalExecutorStarted = resolve; });
        const executorPromise = Promise.resolve().then(() => {
            signalExecutorStarted();
            return shutdownExecutor({ operationId: operation.operationId, gateId, bridgeShutdownHealthProbe, signal: abortController.signal });
        });
        // Start the executor before the renewal timer; this guarantees any
        // renewal failure can cancel an already-admitted executor explicitly.
        await executorStarted;
        const gateKeeper = createShutdownGateKeeper({ gateId, renew: bridgeShutdownGateRenew, intervalMs: shutdownGateRenewIntervalMs });
        let result;
        try {
            const outcome = await Promise.race([
                executorPromise.then((value) => ({ kind: 'complete', value }), (error) => ({ kind: 'executor-error', error })),
                gateKeeper.failure.then(
                    () => ({ kind: 'renewal-error' }),
                    (error) => ({ kind: 'renewal-error', error }),
                ),
            ]);
            if (outcome.kind === 'renewal-error') {
                renewalFailed = true;
                abortController.abort();
                // Do not release the owner lease or permit a second executor
                // until the executor confirms that it has stopped acting.
                await executorPromise.catch(() => {});
                throw new Error('SHUTDOWN_GATE_RENEWAL_FAILED');
            }
            if (outcome.kind === 'executor-error') throw outcome.error;
            result = outcome.value;
        } finally {
            await gateKeeper.stop();
        }
        operation.services = result?.services || operation.services;
        const servicesValid = validateShutdownServices(operation.services, 'final');
        operation.ok = result?.ok === true && servicesValid && shutdownServicesAllStopped(operation.services);
        if (!servicesValid) operation.services = createFailedShutdownServices();
        operation.complete = true;
        operation.status = operation.ok ? 'completed' : 'failed';
        operation.errorCode = operation.ok ? '' : shutdownFinalErrorCodes.has(result?.errorCode) ? result.errorCode : 'SHUTDOWN_PARTIAL_FAILURE';
    } catch (error) {
        operation.ok = false;
        operation.complete = true;
        operation.status = 'failed';
        operation.errorCode = shutdownFinalErrorCodes.has(error?.code || error?.message)
            ? (error?.code || error?.message)
            : 'SHUTDOWN_EXECUTION_FAILED';
        for (const [name, current] of Object.entries(operation.services)) {
            if (current.status === 'scheduled') operation.services[name] = { status: 'failed', errorCode: operation.errorCode };
        }
    }
    if (!operation.ok && !renewalFailed) await bridgeShutdownGateRelease(gateId).catch(() => false);
}

function createScheduledShutdownServices() {
    return Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, {
        status: name === 'processSupervisor' ? 'kept-running' : 'scheduled',
    }]));
}

function createFailedShutdownServices() {
    return Object.fromEntries(PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.map((name) => [name, {
        status: name === 'processSupervisor' ? 'kept-running' : 'failed',
    }]));
}

export function validateShutdownServices(services, phase = 'final') {
    if (!services || typeof services !== 'object' || Array.isArray(services)) return false;
    const actualKeys = Object.keys(services).sort();
    const expectedKeys = [...PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) return false;
    for (const name of PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS) {
        const record = services[name];
        if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
        if (name === 'processSupervisor') {
            if (record.status !== 'kept-running') return false;
        } else if (phase === 'final') {
            if (!['stopped', 'already-stopped', 'failed'].includes(record.status)) return false;
        } else if (phase === 'accepted' || phase === 'pending') {
            if (record.status !== 'scheduled') return false;
        } else return false;
    }
    return true;
}

function shutdownServicesAllStopped(services) {
    return validateShutdownServices(services, 'final')
        && PROCESS_SUPERVISOR_SHUTDOWN_SERVICE_KEYS.filter((name) => name !== 'processSupervisor')
            .every((name) => ['stopped', 'already-stopped'].includes(services[name].status));
}

function pruneShutdownOperations(operations, nowMs, completedLimit, ttlMs) {
    for (const [id, record] of operations) {
        if (record.completedAtMs !== null && nowMs - record.completedAtMs >= ttlMs) operations.delete(id);
    }
    const completed = [...operations.entries()]
        .filter(([, record]) => record.completedAtMs !== null)
        .sort((left, right) => left[1].completedAtMs - right[1].completedAtMs);
    const limit = Math.max(1, Math.floor(Number(completedLimit) || PROCESS_SUPERVISOR_SHUTDOWN_OPERATION_LIMIT));
    while (completed.length > limit) {
        const [id] = completed.shift();
        operations.delete(id);
    }
}

async function executeAllowlistedShutdown({ operationId, gateId, bridgeShutdownHealthProbe, signal }) {
    if (process.platform !== 'win32') return Promise.resolve({ ok: false, errorCode: 'WINDOWS_SHUTDOWN_UNAVAILABLE' });
    const runtimeState = await bridgeShutdownHealthProbe();
    if (!runtimeState?.available || runtimeState.shutdownGate !== true || runtimeState.pending !== false
        || runtimeState.stale !== false || runtimeState.stopping !== false) {
        throw new Error('RUNTIME_BRIDGE_STATE_CHANGED');
    }
    if (signal?.aborted) throw Object.assign(new Error('SHUTDOWN_GATE_RENEWAL_FAILED'), { code: 'SHUTDOWN_GATE_RENEWAL_FAILED' });
    const script = path.join(moduleDir, 'shutdown-allowlist.ps1');
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
            cwd: repoRoot,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'ignore'],
            env: { ...process.env, GALGAME_SUPERVISOR_REPO_ROOT: repoRoot, GALGAME_SHUTDOWN_OPERATION_ID: operationId, GALGAME_SHUTDOWN_GATE_ID: gateId },
        });
        let output = '';
        const abortChild = () => { child.kill(); };
        if (signal?.aborted) abortChild();
        else signal?.addEventListener('abort', abortChild, { once: true });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-16_384); });
        child.once('error', (error) => {
            signal?.removeEventListener('abort', abortChild);
            reject(signal?.aborted ? Object.assign(new Error('SHUTDOWN_GATE_RENEWAL_FAILED'), { code: 'SHUTDOWN_GATE_RENEWAL_FAILED' }) : error);
        });
        child.once('close', (code) => {
            signal?.removeEventListener('abort', abortChild);
            if (signal?.aborted) return reject(Object.assign(new Error('SHUTDOWN_GATE_RENEWAL_FAILED'), { code: 'SHUTDOWN_GATE_RENEWAL_FAILED' }));
            if (code !== 0 && code !== 2) return reject(new Error('SHUTDOWN_EXECUTOR_FAILED'));
            try {
                const result = JSON.parse(output.trim());
                if (result?.operationId !== operationId || !result?.services || typeof result.ok !== 'boolean') throw new Error('SHUTDOWN_EXECUTOR_INVALID_RESULT');
                resolve(result);
            } catch { reject(new Error('SHUTDOWN_EXECUTOR_INVALID_RESULT')); }
        });
    });
}

function recoveryResult(launchResult, confirmed, pendingStatus, restarted) {
    const started = launchResult?.started === true;
    const alreadyRunning = launchResult?.alreadyRunning === true;
    const verified = confirmed === true;
    const timedOut = (started || alreadyRunning) && confirmed === false;
    const pending = (started || alreadyRunning) && confirmed === null;
    return {
        status: verified ? 'running' : (timedOut ? 'not-started' : pending ? pendingStatus : 'not-started'),
        started: verified || (started && confirmed === null),
        ...(alreadyRunning ? { alreadyRunning: true } : {}),
        ...(restarted ? { restarted: (verified && !alreadyRunning) || (started && confirmed === null) } : {}),
        errorCode: launchResult?.errorCode || (timedOut ? 'STARTUP_HEALTH_CHECK_TIMEOUT' : ''),
    };
}

async function waitForHealthyService(probe, { timeoutMs, intervalMs }) {
    if (timeoutMs <= 0) return null;
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const result = await probe().catch(() => null);
        if (result?.reachable && result?.healthy) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
    }
}

async function waitForConfiguredOptionalService(probe, { timeoutMs, intervalMs }) {
    if (timeoutMs <= 0) return null;
    const deadline = Date.now() + timeoutMs;
    while (true) {
        const result = await probe().catch(() => null);
        if (result?.reachable && result?.healthy && result?.analyzerConfigured === true) return true;
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, deadline - Date.now()))));
    }
}

function createDefaultProbes() {
    return Object.fromEntries(Object.entries(PROCESS_SUPERVISOR_SERVICE_PORTS).map(([name, port]) => [name, async () => {
        const base = `http://127.0.0.1:${port}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1_500);
        try {
            const response = await fetch(`${base}${healthPaths[name]}`, { signal: controller.signal, cache: 'no-store' });
            let body = null;
            if (name !== 'sillyTavern') body = await response.json().catch(() => null);
            const reachable = true;
            const healthy = response.ok && (name === 'sillyTavern' || body?.ok === true && (name !== 'runtimeBridge' || body.ready !== false));
            return {
                reachable,
                healthy,
                stale: name === 'runtimeBridge' && body?.stale === true,
                pending: name === 'runtimeBridge' && body?.pending === true,
                stopping: name === 'runtimeBridge' && body?.stopping === true,
                errorCode: healthy ? '' : body?.errorCode || `HTTP_${response.status}`,
            };
        } catch {
            const listening = await isTcpListening(port);
            return { reachable: listening, healthy: false, errorCode: listening ? 'HEALTH_ENDPOINT_UNAVAILABLE' : 'PROCESS_NOT_LISTENING' };
        } finally {
            clearTimeout(timeout);
        }
    }]));
}

function createDefaultOptionalProbes() {
    return Object.fromEntries(Object.entries(optionalServicePorts).map(([name, port]) => [name, async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1_500);
        try {
            const response = await fetch(`http://127.0.0.1:${port}${optionalHealthPaths[name]}`, { signal: controller.signal, cache: 'no-store' });
            const body = await response.json().catch(() => null);
            const healthy = response.ok && body?.serviceReady === true;
            return {
                reachable: true,
                healthy,
                analyzerConfigured: body?.analyzerConfigured === true,
                errorCode: healthy ? '' : body?.errorCode || `HTTP_${response.status}`,
            };
        } catch {
            const listening = await isTcpListening(port);
            return { reachable: listening, healthy: false, analyzerConfigured: false, errorCode: listening ? 'HEALTH_ENDPOINT_UNAVAILABLE' : 'PROCESS_NOT_LISTENING' };
        } finally {
            clearTimeout(timeout);
        }
    }]));
}

async function launchAllowlistedService(name) {
    if (name === 'sillyTavern') {
        mkdirSync(logDir, { recursive: true });
        const child = spawn(process.execPath, [path.join(repoRoot, 'server.js')], {
            cwd: repoRoot,
            detached: true,
            windowsHide: true,
            // Keep application output out of supervisor logs; server output
            // can contain request details, while recovery only needs health.
            stdio: 'ignore',
        });
        child.unref();
        return { started: true };
    }
    if (startupScripts[name]) {
        const script = path.join(repoRoot, startupScripts[name]);
        if (!existsSync(script)) return { started: false, errorCode: 'START_SCRIPT_MISSING' };
        spawn('cmd.exe', ['/d', '/c', script], { cwd: repoRoot, detached: true, windowsHide: true, stdio: 'ignore' }).unref();
        return { started: true };
    }
    if (name === 'visualService') {
        return launchVisualService();
    }
    return { started: false, errorCode: 'SERVICE_NOT_ALLOWLISTED' };
}

export async function launchVisualService({
    tcpListenerProbe = isTcpListening,
    providerEnv = process.env,
    providerConfigReader = readProviderConfig,
    fileExists = existsSync,
    spawnProcess = spawn,
} = {}) {
    // visual-asset-service must be idempotent. A healthy existing instance on
    // the fixed loopback port is the desired state; do not spawn a duplicate
    // process that will only fail with EADDRINUSE and confuse recovery status.
    if (await tcpListenerProbe(PROCESS_SUPERVISOR_SERVICE_PORTS.visualService)) {
        return { started: false, alreadyRunning: true };
    }
    const configuredPath = providerEnv.GALGAME_VISUAL_PROVIDER_ENV_FILE || path.join(repoRoot, '.env.local');
    const configured = providerConfigReader(configuredPath);
    const script = configured.valid
        ? path.join(repoRoot, 'external-modules', 'process-supervisor', 'launchers', 'StartGalgameVisualAnalyzerTest.ps1')
        : fileExists(configuredPath)
            ? ''
            : path.join(repoRoot, 'external-modules', 'process-supervisor', 'launchers', 'StartGalgameVisualAssetService.cmd');
    if (!script || !fileExists(script)) return { started: false, errorCode: 'VISUAL_PROVIDER_CONFIGURATION_UNAVAILABLE' };
    if (script.endsWith('.ps1')) {
        spawnProcess('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
            cwd: repoRoot, detached: true, windowsHide: true, stdio: 'ignore',
            env: { ...providerEnv, GALGAME_VISUAL_PROVIDER_ENV_FILE: configuredPath },
        }).unref();
    } else {
        spawnProcess('cmd.exe', ['/d', '/c', script], { cwd: repoRoot, detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    }
    return { started: true };
}

function readProviderConfig(filePath) {
    if (!existsSync(filePath)) return { valid: false };
    try {
        const values = new Map();
        for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*(REFERENCE_VISION_BASE_URL|REFERENCE_VISION_MODEL|REFERENCE_VISION_API_KEY)\s*=\s*(.*?)\s*$/);
            if (!match || !match[2]) continue;
            values.set(match[1], match[2].replace(/^(['"])(.*)\1$/, '$2'));
        }
        const base = values.get('REFERENCE_VISION_BASE_URL') || '';
        const model = values.get('REFERENCE_VISION_MODEL') || '';
        const token = values.get('REFERENCE_VISION_API_KEY') || '';
        let validBase = false;
        try {
            const url = new URL(base);
            validBase = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
        } catch { /* invalid provider URL */ }
        return { valid: Boolean(validBase && model && token) };
    } catch {
        return { valid: false };
    }
}

function getAllowedOrigins() {
    const names = new Set(['127.0.0.1', 'localhost', String(process.env.COMPUTERNAME || '').toLowerCase()].filter(Boolean));
    return [...names].map((hostname) => `http://${hostname}:8000`);
}

function isTcpListening(port) {
    return new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port });
        socket.setTimeout(500);
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('timeout', () => { socket.destroy(); resolve(false); });
        socket.once('error', () => resolve(false));
    });
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 2_048) reject(new Error('BODY_TOO_LARGE'));
        });
        request.on('end', () => {
            try { resolve(JSON.parse(body)); } catch { reject(new Error('INVALID_JSON')); }
        });
        request.on('error', reject);
    });
}

function sendJson(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
}

function writeRecoveryLog(services) {
    try {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(path.join(logDir, 'galgame-process-supervisor.log'), `${new Date().toISOString()} ${JSON.stringify(services)}\n`, 'utf8');
    } catch { /* diagnostics must not change recovery behavior */ }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const host = process.env.GALGAME_PROCESS_SUPERVISOR_HOST || '127.0.0.1';
    if (host !== '127.0.0.1') throw new Error('PROCESS_SUPERVISOR_LOOPBACK_ONLY');
    const port = Number(process.env.GALGAME_PROCESS_SUPERVISOR_PORT || 8790);
    createProcessSupervisor({ listenerHost: host, listenerPort: port }).listen(port, host, () => {
        console.log(`Galgame process supervisor listening at http://${host}:${port}`);
    });
}
