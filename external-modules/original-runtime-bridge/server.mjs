import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';
import { waitForOriginalGenerationCompletion } from './generation-lifecycle.mjs';

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleRoot, '..', '..');
const DEFAULT_PORT = 8795;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_PROVIDER_RETRY_DELAYS_MS = [2000, 6000];
const DEFAULT_PENDING_STALE_AFTER_MS = 240000;
const CDP_EVALUATION_GRACE_MS = 45000;
const CHROME_EXIT_TIMEOUT_MS = 5000;
const MAX_BRIDGE_VISIBLE_TEXT_LENGTH = 16000;
const DEFAULT_CLAUDE_SETTINGS_PATH = path.join(repoRoot, 'data', 'default-user', 'OpenAI Settings', 'Default.json');

function readRuntimeProviderSettings() {
    try {
        const settings = JSON.parse(readFileSync(DEFAULT_CLAUDE_SETTINGS_PATH, 'utf8'));
        const provider = String(settings.chat_completion_source || '').trim().toLowerCase();
        if (provider !== 'claude') {
            return {};
        }
        return {
            provider,
            model: String(settings.claude_model || 'claude-sonnet-4-6').trim(),
            reverseProxy: String(settings.reverse_proxy || '').trim(),
            proxyPassword: String(settings.proxy_password || ''),
            maxTokens: Number(settings.openai_max_tokens) || 4096,
        };
    } catch {
        return {};
    }
}

export function createOriginalRuntimeBridgeServer({
    runtime = null,
    sillyTavernBaseUrl = process.env.SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8000',
    allowedOrigins = parseAllowedOrigins(process.env.GALGAME_ALLOWED_ORIGINS),
    host = process.env.HOST || '127.0.0.1',
    authToken = process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '',
    proofSecret = process.env.GALGAME_BRIDGE_PROOF_SECRET || '',
    logger = console,
    providerSettingsReader = readRuntimeProviderSettings,
    fetchImpl = globalThis.fetch,
    llmHealthTimeoutMs = 20_000,
    shutdownGateTtlMs = 60_000,
    now = () => Date.now(),
} = {}) {
    const auth = createBridgeAuthConfig({ host, authToken });
    const proofVerifier = createBridgeProofVerifier({ proofSecret });
    const runtimeBridge = runtime || new BrowserOriginalRuntimeBridge({ logger });
    let shutdownGateId = '';
    let shutdownGateExpiresAt = 0;
    let generationAdmissions = 0;
    let stopAdmissions = 0;

    const refreshShutdownGate = () => {
        if (shutdownGateId && now() >= shutdownGateExpiresAt) {
            shutdownGateId = '';
            shutdownGateExpiresAt = 0;
        }
        return Boolean(shutdownGateId);
    };

    const server = createServer(async (request, response) => {
        try {
            refreshShutdownGate();
            applyCors(request, response, allowedOrigins);
            if (request.method === 'OPTIONS') {
                response.writeHead(204);
                response.end();
                return;
            }

            if (!authorizeBridgeRequest(request, auth)) {
                sendJson(response, 401, {
                    ok: false,
                    errorCode: 'BRIDGE_AUTH_REQUIRED',
                });
                return;
            }

            const url = new URL(request.url || '/', 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/health') {
                const health = await runtimeBridge.healthCheck?.().catch((error) => ({
                    ok: false,
                    errorCode: sanitizeErrorCode(error),
                }));
                const status = {
                    ...runtimeBridge.getStatus?.(),
                    shutdownGate: Boolean(shutdownGateId),
                    ready: !shutdownGateId && resolveBridgeReady(health, runtimeBridge.getStatus?.()),
                    ...(shutdownGateId ? { connectionState: 'shutdown-gated' } : {}),
                };
                sendJson(response, 200, {
                    // `ok` means the bridge can accept a new generation.  Keep
                    // transport reachability separate so a stale/pending or
                    // stopped browser session is never reported as healthy.
                    ok: !shutdownGateId && resolveBridgeReady(health, status),
                    mode: 'sillytavern-original-runtime-bridge',
                    originalRuntime: 'browser-generate',
                    authRequired: auth.required,
                    proofRequired: proofVerifier.required,
                    proofConfigured: proofVerifier.configured,
                    ...status,
                    ...health,
                    shutdownGate: Boolean(shutdownGateId),
                    ready: !shutdownGateId && resolveBridgeReady(health, status),
                    ...(shutdownGateId ? { connectionState: 'shutdown-gated' } : {}),
                    ok: !shutdownGateId && resolveBridgeReady(health, status),
                });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/shutdown-gate') {
                const body = await readJsonBody(request).catch(() => null);
                if (!body || body.protocolVersion !== 'galgame.original-runtime-shutdown-gate.v1'
                    || body.action !== 'acquire'
                    || Object.keys(body).some((key) => !['protocolVersion', 'action'].includes(key))) {
                    sendJson(response, 400, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_PROTOCOL_INVALID' });
                    return;
                }
                const status = runtimeBridge.getStatus?.() || {};
                if (shutdownGateId || generationAdmissions > 0 || stopAdmissions > 0 || status.pending || status.stale || status.stopping || runtimeBridge.isStopping?.()) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_BUSY' });
                    return;
                }
                shutdownGateId = randomUUID();
                shutdownGateExpiresAt = now() + Math.max(1_000, Number(shutdownGateTtlMs) || 60_000);
                sendJson(response, 200, {
                    ok: true,
                    protocolVersion: 'galgame.original-runtime-shutdown-gate.v1',
                    gateId: shutdownGateId,
                    pending: false,
                    stale: false,
                    stopping: false,
                    shutdownGate: true,
                });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/shutdown-gate/renew') {
                const body = await readJsonBody(request).catch(() => null);
                if (!body || body.protocolVersion !== 'galgame.original-runtime-shutdown-gate.v1'
                    || body.action !== 'renew' || typeof body.gateId !== 'string'
                    || Object.keys(body).some((key) => !['protocolVersion', 'action', 'gateId'].includes(key))) {
                    sendJson(response, 400, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_PROTOCOL_INVALID' });
                    return;
                }
                refreshShutdownGate();
                if (!shutdownGateId || body.gateId !== shutdownGateId) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_MISMATCH' });
                    return;
                }
                const status = runtimeBridge.getStatus?.() || {};
                if (generationAdmissions > 0 || stopAdmissions > 0 || status.pending || status.stale || status.stopping || runtimeBridge.isStopping?.()) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_BUSY' });
                    return;
                }
                shutdownGateExpiresAt = now() + Math.max(1_000, Number(shutdownGateTtlMs) || 60_000);
                sendJson(response, 200, {
                    ok: true,
                    protocolVersion: 'galgame.original-runtime-shutdown-gate.v1',
                    gateId: shutdownGateId,
                    renewed: true,
                    shutdownGate: true,
                });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/shutdown-gate/release') {
                const body = await readJsonBody(request).catch(() => null);
                if (!body || body.protocolVersion !== 'galgame.original-runtime-shutdown-gate.v1'
                    || body.action !== 'release' || typeof body.gateId !== 'string'
                    || Object.keys(body).some((key) => !['protocolVersion', 'action', 'gateId'].includes(key))) {
                    sendJson(response, 400, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_PROTOCOL_INVALID' });
                    return;
                }
                if (!shutdownGateId || body.gateId !== shutdownGateId) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_MISMATCH' });
                    return;
                }
                const status = runtimeBridge.getStatus?.() || {};
                if (generationAdmissions > 0 || stopAdmissions > 0 || status.pending || status.stale || status.stopping || runtimeBridge.isStopping?.()) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_GATE_BUSY' });
                    return;
                }
                shutdownGateId = '';
                shutdownGateExpiresAt = 0;
                sendJson(response, 200, { ok: true, protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', released: true });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/llm-health') {
                const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
                if (origin && !allowedOrigins.includes('*') && !allowedOrigins.includes(origin)) {
                    sendJson(response, 403, {
                        protocolVersion: 'galgame.llm-health.v1',
                        ok: false,
                        errorCode: 'LLM_HEALTH_ORIGIN_NOT_ALLOWED',
                    });
                    return;
                }
                if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
                    sendJson(response, 415, {
                        protocolVersion: 'galgame.llm-health.v1',
                        ok: false,
                        errorCode: 'LLM_HEALTH_CONTENT_TYPE_REQUIRED',
                    });
                    return;
                }
                const body = await readJsonBody(request).catch(() => null);
                if (body?.protocolVersion !== 'galgame.llm-health.v1') {
                    sendJson(response, 400, {
                        protocolVersion: 'galgame.llm-health.v1',
                        ok: false,
                        errorCode: 'LLM_HEALTH_PROTOCOL_INVALID',
                    });
                    return;
                }
                const result = await probeConfiguredLlm({
                    settings: providerSettingsReader(),
                    fetchImpl,
                    timeoutMs: llmHealthTimeoutMs,
                });
                sendJson(response, result.ok ? 200 : 503, result);
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/stop') {
                if (shutdownGateId) {
                    sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_IN_PROGRESS' });
                    return;
                }
                // Reserve the stop operation before reading its body. Otherwise
                // gate acquisition can overtake a slow request body and close
                // the bridge while this admitted stop is still in flight.
                stopAdmissions += 1;
                try {
                    const body = await readJsonBody(request).catch(() => ({}));
                    if (shutdownGateId) {
                        sendJson(response, 409, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_IN_PROGRESS' });
                        return;
                    }
                    const stopped = await runtimeBridge.stop?.({
                        reason: 'operator-request',
                        timeoutMs: clampStopTimeout(body.timeoutMs || body.stopTimeoutMs),
                    });
                    sendJson(response, 200, {
                        ok: true,
                        mode: 'sillytavern-original-runtime-bridge',
                        ...stopped,
                        ...runtimeBridge.getStatus?.(),
                    });
                } finally {
                    stopAdmissions = Math.max(0, stopAdmissions - 1);
                }
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/generate-reply') {
                if (shutdownGateId) {
                    sendJson(response, 503, { ok: false, errorCode: 'BRIDGE_SHUTDOWN_IN_PROGRESS' });
                    return;
                }
                if (runtimeBridge.isStopping?.()) {
                    sendJson(response, 503, {
                        ok: false,
                        errorCode: 'BRIDGE_STOPPING',
                    });
                    return;
                }
                const runtimeStatus = runtimeBridge.getStatus?.() || {};
                if (runtimeStatus.pending) {
                    sendJson(response, runtimeStatus.stale ? 504 : 409, {
                        ok: false,
                        errorCode: runtimeStatus.stale ? 'BRIDGE_PENDING_STALE' : 'BRIDGE_GENERATION_IN_PROGRESS',
                        diagnostics: {
                            connectionState: runtimeStatus.connectionState,
                            pendingSinceMs: runtimeStatus.pendingSinceMs,
                        },
                    });
                    return;
                }
                generationAdmissions += 1;
                try {
                const body = await readJsonBody(request);
                const validation = validateGenerateRequest(body, proofVerifier);
                if (!validation.ok) {
                    sendJson(response, 400, {
                        ok: false,
                        errorCode: validation.errorCode,
                        diagnostics: validation.evidence,
                    });
                    return;
                }

                const startedAt = Date.now();
                const result = await runtimeBridge.generateReply({
                    sillyTavernBaseUrl: normalizeBaseUrl(body.sillyTavernBaseUrl || sillyTavernBaseUrl),
                    avatar: body.character.avatar,
                    chatId: body.chatId,
                    runtimeWorldBookRefs: validation.runtimeBinding?.worldBookRefs || [],
                    timeoutMs: clampTimeout(body.timeoutMs),
                });
                sendJson(response, 200, {
                    ok: true,
                    mode: 'sillytavern-original-runtime-bridge',
                    elapsedMs: Date.now() - startedAt,
                    ...result,
                    diagnostics: {
                        ...result?.diagnostics,
                        bridgeAuthorization: validation.evidence,
                    },
                });
                return;
                } finally {
                    generationAdmissions = Math.max(0, generationAdmissions - 1);
                }
            }

            sendJson(response, 404, {
                ok: false,
                errorCode: 'NOT_FOUND',
            });
        } catch (error) {
            logger.warn?.('[original-runtime-bridge] request failed', sanitizeLogError(error));
            sendJson(response, 500, {
                ok: false,
                errorCode: sanitizeErrorCode(error),
                diagnostics: sanitizeDiagnostics(error.details),
            });
        }
    });

    server.once('close', () => {
        void (runtimeBridge.stop?.({ reason: 'server-close' }) || runtimeBridge.close?.());
    });
    return server;
}

export async function probeConfiguredLlm({ settings = {}, fetchImpl = globalThis.fetch, timeoutMs = 20_000, now = () => Date.now() } = {}) {
    const startedAt = now();
    const provider = String(settings.provider || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40).toLowerCase();
    const model = String(settings.model || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
    const baseUrl = String(settings.reverseProxy || '').trim().replace(/\/+$/, '');
    const token = String(settings.proxyPassword || '');
    const result = (ok, errorCode = '') => ({
        protocolVersion: 'galgame.llm-health.v1',
        ok,
        provider,
        model,
        checkedAt: new Date(now()).toISOString(),
        latencyMs: Math.max(0, now() - startedAt),
        errorCode,
    });
    if (provider !== 'claude') return result(false, 'LLM_PROVIDER_NOT_CLAUDE');
    if (!model || !baseUrl || !token) return result(false, 'LLM_PROVIDER_SETTINGS_INCOMPLETE');
    if (typeof fetchImpl !== 'function') return result(false, 'LLM_FETCH_UNAVAILABLE');

    let endpoint;
    try {
        endpoint = new URL(`${baseUrl}/messages`);
        if (endpoint.protocol !== 'https:') return result(false, 'LLM_PROXY_HTTPS_REQUIRED');
    } catch {
        return result(false, 'LLM_PROXY_URL_INVALID');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(250, Number(timeoutMs) || 20_000));
    try {
        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'anthropic-version': '2023-06-01',
                'x-api-key': token,
            },
            body: JSON.stringify({
                model,
                max_tokens: 8,
                messages: [{ role: 'user', content: 'Reply with OK.' }],
            }),
            signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        const hasText = Array.isArray(payload?.content)
            && payload.content.some((item) => item?.type === 'text' && String(item.text || '').trim());
        if (!response.ok) return result(false, `LLM_UPSTREAM_HTTP_${response.status}`);
        if (!hasText) return result(false, 'LLM_UPSTREAM_EMPTY_RESPONSE');
        return result(true);
    } catch (error) {
        return result(false, controller.signal.aborted ? 'LLM_UPSTREAM_TIMEOUT' : 'LLM_UPSTREAM_UNREACHABLE');
    } finally {
        clearTimeout(timeout);
    }
}

export class BrowserOriginalRuntimeBridge {
    constructor({
        chromePath = process.env.GALGAME_BRIDGE_CHROME_PATH || '',
        userDataDir = process.env.GALGAME_BRIDGE_USER_DATA_DIR || path.join(repoRoot, '.codex-longrun', 'original-runtime-bridge-chrome'),
        headless = process.env.GALGAME_BRIDGE_HEADLESS !== 'false',
        debugPort = Number(process.env.GALGAME_BRIDGE_DEBUG_PORT || 0),
        providerRetryDelaysMs = parseRetryDelays(process.env.GALGAME_BRIDGE_PROVIDER_RETRY_DELAYS_MS, DEFAULT_PROVIDER_RETRY_DELAYS_MS),
        logger = console,
    } = {}) {
        this.chromePath = chromePath || findChrome();
        this.userDataDir = userDataDir;
        this.headless = headless;
        this.debugPort = debugPort;
        this.providerRetryDelaysMs = providerRetryDelaysMs;
        this.logger = logger;
        this.chrome = null;
        this.browser = null;
        this.targetId = null;
        this.sessionId = null;
        this.currentBaseUrl = '';
        this.queue = Promise.resolve();
        this.pendingTask = null;
        this.stopping = false;
        this.lastGeneration = {
            state: 'never',
            at: 0,
            elapsedMs: 0,
            errorCode: '',
        };
        this.pendingStaleAfterMs = Number(process.env.GALGAME_BRIDGE_PENDING_STALE_AFTER_MS)
            || DEFAULT_PENDING_STALE_AFTER_MS;
    }

    async healthCheck() {
        const status = this.getStatus();
        return {
            ok: status.ready,
            ready: status.ready,
            transportOk: true,
            browser: Boolean(this.browser),
            headless: this.headless,
            ...status,
        };
    }

    getStatus() {
        const pendingSinceMs = this.pendingTask ? Date.now() - this.pendingTask.startedAt : 0;
        const stale = Boolean(this.pendingTask) && pendingSinceMs >= this.pendingStaleAfterMs;
        const connectionState = this.stopping
            ? 'stopping'
            : stale
                ? 'stale'
                : this.pendingTask
                    ? 'generating'
                    : this.browser
                        ? 'ready'
                        : 'idle';
        return {
            stopping: this.stopping,
            pending: Boolean(this.pendingTask),
            pendingSinceMs,
            pendingStaleAfterMs: this.pendingStaleAfterMs,
            stale,
            ready: !this.stopping && !stale && !this.pendingTask,
            connectionState,
            lastGeneration: { ...this.lastGeneration },
        };
    }

    isStopping() {
        return this.stopping;
    }

    async generateReply(request) {
        if (this.stopping) {
            throw createBridgeError('BRIDGE_STOPPING');
        }
        const task = this.queue.then(async () => {
            if (this.stopping) {
                throw createBridgeError('BRIDGE_STOPPING');
            }
            const stopSignal = createDeferred();
            this.pendingTask = {
                startedAt: Date.now(),
                chatIdHash: sha256Short(request?.chatId || ''),
                stopSignal,
            };
            try {
                const work = this.generateReplyUnsafe(request);
                work.catch(() => {});
                const result = await Promise.race([work, stopSignal.promise]);
                if (this.stopping) {
                    throw createBridgeError('BRIDGE_STOPPED', {
                        chatIdHash: this.pendingTask?.chatIdHash,
                    });
                }
                this.lastGeneration = {
                    state: 'succeeded',
                    at: Date.now(),
                    elapsedMs: Date.now() - this.pendingTask.startedAt,
                    errorCode: '',
                };
                return result;
            } catch (error) {
                this.lastGeneration = {
                    state: this.stopping || error?.code === 'BRIDGE_STOP_TIMEOUT' ? 'stopped' : 'failed',
                    at: Date.now(),
                    elapsedMs: Date.now() - this.pendingTask.startedAt,
                    errorCode: sanitizeErrorCode(error),
                };
                throw error;
            } finally {
                this.pendingTask = null;
            }
        });
        this.queue = task.catch(() => {});
        return task;
    }

    async generateReplyUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
        const retryErrors = [];
        const retryDelays = Array.isArray(this.providerRetryDelaysMs) ? this.providerRetryDelaysMs : [];
        for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
            try {
                const result = await this.generateReplyOnceUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs, timeoutMs });
                if (retryErrors.length) {
                    result.diagnostics = {
                        ...result.diagnostics,
                        providerRetryAttempts: retryErrors.length,
                        providerRetryErrorCodes: retryErrors.map((error) => sanitizeErrorCode(error)),
                    };
                }
                return result;
            } catch (error) {
                if (!isRetryableOriginalProviderError(error) || attempt >= retryDelays.length || this.stopping) {
                    throw error;
                }
                retryErrors.push(error);
                const retryDelayMs = retryDelays[attempt];
                this.logger.warn?.('[original-runtime-bridge] transient original provider failure; retrying', {
                    attempt: attempt + 1,
                    nextDelayMs: retryDelayMs,
                    error: sanitizeLogError(error),
                });
                await delay(retryDelayMs);
            }
        }
        throw retryErrors.at(-1) || createBridgeError('ORIGINAL_RUNTIME_GENERATE_FAILED');
    }

    async generateReplyOnceUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
        await this.ensurePage(sillyTavernBaseUrl);
        const payload = {
            avatar,
            chatId: normalizeChatId(chatId),
            runtimeWorldBookRefs: normalizeWorldBookRefs(runtimeWorldBookRefs),
            providerSettings: readRuntimeProviderSettings(),
            timeoutMs: clampTimeout(timeoutMs),
        };
        let result;
        try {
            // The in-page lifecycle already bounds generation and chat readback.
            // Leave enough time for those errors to cross CDP, but do not keep a
            // stuck renderer pending for another arbitrary 90 seconds.
            result = await this.evaluate(generateInOriginalRuntimeExpression(payload), payload.timeoutMs + CDP_EVALUATION_GRACE_MS);
        } catch (error) {
            if (error?.code === 'CDP_EVALUATION_TIMEOUT') {
                this.stopping = true;
                try {
                    await this.close();
                    // The timed-out reply remains a failure. The next explicit
                    // retry reloads the exact original chat before Generate().
                    this.stopping = false;
                } catch (closeError) {
                    this.logger.warn?.('[original-runtime-bridge] timed-out browser exit was not confirmed', {
                        errorCode: sanitizeErrorCode(closeError),
                    });
                }
            }
            throw error;
        }
        if (!result?.ok) {
            if (result?.errorCode === 'ORIGINAL_GENERATION_STOP_UNCONFIRMED') {
                this.stopping = true;
                await this.close();
            }
            const error = new Error(result?.errorCode || 'ORIGINAL_RUNTIME_GENERATE_FAILED');
            error.code = result?.errorCode;
            error.details = {
                elapsedMs: result?.elapsedMs,
                errorMessage: result?.errorMessage,
                errorStack: result?.errorStack,
                runtimeState: result?.runtimeState,
            };
            throw error;
        }
        return result;
    }

    async ensurePage(baseUrl) {
        const normalizedBase = normalizeBaseUrl(baseUrl);
        if (!this.browser) {
            await this.startBrowser();
        }
        if (!this.sessionId || this.currentBaseUrl !== normalizedBase) {
            await this.openOriginalPage(normalizedBase);
        }
    }

    async startBrowser() {
        await mkdir(this.userDataDir, { recursive: true });
        this.debugPort = this.debugPort || await getFreePort(9259);
        const args = [
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            `--remote-debugging-port=${this.debugPort}`,
            `--user-data-dir=${this.userDataDir}`,
            'about:blank',
        ];
        if (this.headless) {
            args.unshift('--headless=new');
        }
        this.chrome = spawn(this.chromePath, args, {
            stdio: 'ignore',
            windowsHide: true,
        });
        this.browser = await connectBrowser(this.debugPort);
    }

    async openOriginalPage(baseUrl) {
        if (this.targetId) {
            await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
        }
        const target = await this.browser.send('Target.createTarget', { url: 'about:blank' });
        const attached = await this.browser.send('Target.attachToTarget', {
            targetId: target.targetId,
            flatten: true,
        });
        this.targetId = target.targetId;
        this.sessionId = attached.sessionId;
        await this.browser.send('Page.enable', {}, this.sessionId);
        await this.browser.send('Runtime.enable', {}, this.sessionId);
        await this.browser.send('Page.navigate', { url: `${baseUrl}/` }, this.sessionId);
        this.currentBaseUrl = baseUrl;
        await this.evaluate(`(() => new Promise((resolve) => {
            if (document.readyState === 'complete') return resolve(true);
            window.addEventListener('load', () => resolve(true), { once: true });
            setTimeout(() => resolve(document.readyState), 60000);
        }))()`, 65000);
    }

    async evaluate(expression, timeoutMs) {
        const result = await withTimeout(this.browser.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        }, this.sessionId), timeoutMs, 'CDP_EVALUATION_TIMEOUT');

        if (result.exceptionDetails) {
            const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'ORIGINAL_RUNTIME_EXCEPTION';
            const error = new Error(description);
            error.code = 'ORIGINAL_RUNTIME_EXCEPTION';
            throw error;
        }
        return result.result?.value;
    }

    async close() {
        const chrome = this.chrome;
        if (this.targetId && this.browser) {
            void this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
        }
        this.chrome = null;
        this.browser = null;
        this.targetId = null;
        this.sessionId = null;
        if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;

        const exited = waitForChildExit(chrome, CHROME_EXIT_TIMEOUT_MS);
        chrome.kill();
        if (!await exited) {
            throw createBridgeError('BRIDGE_CHROME_EXIT_UNCONFIRMED');
        }
    }

    async stop({ timeoutMs = 15000 } = {}) {
        const pendingAtStop = this.pendingTask;
        const hadPendingTask = Boolean(pendingAtStop);
        let stopMode = hadPendingTask ? 'safe-complete' : 'idle';
        let forced = false;
        let stopRequested = false;
        this.stopping = true;
        await this.requestOriginalStop()
            .then(() => {
                stopRequested = true;
            })
            .catch(() => {
                stopMode = 'stop-request-failed';
            });
        try {
            await withTimeout(this.queue.catch(() => {}), timeoutMs, 'BRIDGE_STOP_TIMEOUT');
        } catch {
            forced = true;
            stopMode = 'forced-timeout';
            pendingAtStop?.stopSignal?.reject(createBridgeError('BRIDGE_STOP_TIMEOUT', {
                forced: true,
                chatIdHash: pendingAtStop.chatIdHash,
            }));
            await this.queue.catch(() => {});
        }
        await this.close();
        this.pendingTask = null;
        this.queue = Promise.resolve();
        return {
            stopped: true,
            forced,
            stopMode,
            stopRequested,
            hadPendingTask,
            pendingTaskFailed: hadPendingTask,
            pendingCleared: true,
            errorCode: forced ? 'BRIDGE_STOP_TIMEOUT' : undefined,
        };
    }

    async requestOriginalStop() {
        if (!this.browser || !this.sessionId) {
            return;
        }
        await this.evaluate(`(() => {
            try {
                const ctx = globalThis.SillyTavern?.getContext?.();
                ctx?.stopGeneration?.();
            } catch {}
            try {
                globalThis.stopGeneration?.();
            } catch {}
            return true;
        })()`, 5000);
    }
}

export function generateInOriginalRuntimeExpression(payload) {
    return `(async () => {
        const payload = ${JSON.stringify(payload)};
        const startedAt = Date.now();
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalizeChatId = (value) => String(value || '').replace(/\\\\/g, '/').split('/').pop().replace(/\\.jsonl$/i, '').trim();
        const normalizeAvatar = (value) => String(value || '').trim().toLowerCase().replace(/\\\\/g, '/').split('/').pop();
        const sanitizeText = (value, max = 4000) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]+/g, ' ').trim().slice(0, max);
        const targetChatId = normalizeChatId(payload.chatId);
        const expectedWorldBookRefs = Array.isArray(payload.runtimeWorldBookRefs)
            ? payload.runtimeWorldBookRefs.map((value) => sanitizeText(value, 240)).filter(Boolean)
            : [];
        const expectedChatWorldInfo = expectedWorldBookRefs[0] || '';
        let stModule = null;
        let openaiSettingsModule = null;
        let eventsModule = null;
        let worldInfoModule = null;
        let targetLockTimer = null;
        let characterPrimaryWorldBefore = '';
        let characterPrimaryWorldTemporarilyDisabled = false;
        let characterPrimaryWorldRestored = false;
        let characterPrimaryWorldAfterDisable = '';
        let restoreCharacterPrimaryWorld = () => {};
        let applyCharacterPrimaryWorldIsolation = () => {};
        let worldInfoEventWindow = 'preGenerate';
        const preGenerateWorldInfoWorlds = [];
        const preGenerateWorldInfoEntryCountByWorld = {};
        const duringGenerateWorldInfoWorlds = [];
        const duringGenerateWorldInfoEntryCountByWorld = {};
        let forcedRuntimeChatReload = false;
        let forcedRuntimeChatReloadAttempts = 0;
        let runtimeStateBeforeForcedReload = null;
        let runtimeStateAfterForcedReload = null;
        const luciferArcBundlePattern = /^Galgame_Imported_Lucifer_Arc\d+_Bundle$/;
        const uniqueWorldRefs = (worlds) => [...new Set(worlds)];
        const cloneCounts = (counts) => Object.fromEntries(Object.entries(counts));
        const sortedRefs = (refs) => refs.slice().sort((a, b) => a.localeCompare(b));
        const refsEqual = (left, right) => JSON.stringify(sortedRefs(left)) === JSON.stringify(sortedRefs(right));
        const runtimeReloadDiagnostics = () => ({
            forcedRuntimeChatReload,
            forcedRuntimeChatReloadAttempts,
            runtimeStateBeforeForcedReload,
            runtimeStateAfterForcedReload,
        });
        const captureWorldInfoActivation = (entries) => {
            const targetWorlds = worldInfoEventWindow === 'duringGenerate'
                ? duringGenerateWorldInfoWorlds
                : preGenerateWorldInfoWorlds;
            const targetCounts = worldInfoEventWindow === 'duringGenerate'
                ? duringGenerateWorldInfoEntryCountByWorld
                : preGenerateWorldInfoEntryCountByWorld;
            for (const entry of Array.isArray(entries) ? entries : []) {
                const world = sanitizeText(entry?.world || '', 240);
                if (!world) {
                    continue;
                }
                targetWorlds.push(world);
                targetCounts[world] = (targetCounts[world] || 0) + 1;
            }
        };
        const resetDuringGenerateWorldInfoEvents = () => {
            duringGenerateWorldInfoWorlds.length = 0;
            for (const key of Object.keys(duringGenerateWorldInfoEntryCountByWorld)) {
                delete duringGenerateWorldInfoEntryCountByWorld[key];
            }
            worldInfoEventWindow = 'duringGenerate';
        };
        const buildWorldInfoEventDiagnostics = () => {
            const preGenerateWorldInfoWorldRefs = uniqueWorldRefs(preGenerateWorldInfoWorlds);
            const duringGenerateWorldInfoWorldRefs = uniqueWorldRefs(duringGenerateWorldInfoWorlds);
            const unexpectedLuciferArcWorldInfoDuringGenerate = duringGenerateWorldInfoWorldRefs
                .filter((world) => luciferArcBundlePattern.test(world) && !expectedWorldBookRefs.includes(world));
            return {
                preGenerateWorldInfoWorldRefs,
                preGenerateWorldInfoEntryCountByWorld: cloneCounts(preGenerateWorldInfoEntryCountByWorld),
                duringGenerateWorldInfoWorldRefs,
                duringGenerateWorldInfoEntryCountByWorld: cloneCounts(duringGenerateWorldInfoEntryCountByWorld),
                activatedWorldInfoWorldRefs: duringGenerateWorldInfoWorldRefs,
                activatedWorldInfoEntryCountByWorld: cloneCounts(duringGenerateWorldInfoEntryCountByWorld),
                expectedWorldInfoActivated: expectedChatWorldInfo ? duringGenerateWorldInfoWorldRefs.includes(expectedChatWorldInfo) : false,
                worldInfoExactSetDuringGenerate: expectedWorldBookRefs.length
                    ? refsEqual(duringGenerateWorldInfoWorldRefs, expectedWorldBookRefs)
                    : duringGenerateWorldInfoWorldRefs.length === 0,
                unexpectedLuciferArcWorldInfoDuringGenerate,
            };
        };
        const cleanupRuntimeBinding = () => {
            if (targetLockTimer) {
                clearInterval(targetLockTimer);
                targetLockTimer = null;
            }
            worldInfoEventWindow = 'postGenerate';
            if (eventsModule?.eventSource && eventsModule?.event_types?.WORLD_INFO_ACTIVATED) {
                eventsModule.eventSource.removeListener?.(eventsModule.event_types.WORLD_INFO_ACTIVATED, captureWorldInfoActivation);
            }
            restoreCharacterPrimaryWorld();
        };
        const stripHeader = (rawChat) => Array.isArray(rawChat) && rawChat[0]?.chat_metadata
            ? rawChat.slice(1)
            : (Array.isArray(rawChat) ? rawChat : []);
        const latestMessage = (rawChat) => stripHeader(rawChat).at(-1) || null;
        const summarizeRawChat = (rawChat) => {
            const messages = stripHeader(rawChat);
            const last = messages.at(-1) || null;
            const metadata = Array.isArray(rawChat) && rawChat[0]?.chat_metadata ? rawChat[0].chat_metadata : {};
            return {
                count: messages.length,
                lastIsUser: Boolean(last?.is_user),
                lastIsSystem: Boolean(last?.is_system),
                lastPreview: sanitizeText(last?.mes || '', 240),
                worldInfoRef: sanitizeText(metadata.world_info || '', 240),
            };
        };
        const runtimeState = () => {
            const ctx = globalThis.SillyTavern?.getContext?.();
            const settings = stModule?.oai_settings || ctx?.oai_settings || {};
            const provider = sanitizeText(document.querySelector('#chat_completion_source')?.value || settings.chat_completion_source || ctx?.mainApi || '', 80).toLowerCase();
            const modelSelector = provider === 'claude' ? '#model_claude_select' : '#model_openai_select';
            const model = document.querySelector(modelSelector)?.value || (provider === 'claude'
                ? settings.claude_model
                : provider === 'openai'
                    ? settings.openai_model
                    : settings[provider + '_model']);
            return {
                onlineStatus: sanitizeText(ctx?.onlineStatus || '', 120),
                mainApi: sanitizeText(ctx?.mainApi || '', 80),
                provider,
                model: sanitizeText(model || '', 120),
                chatId: sanitizeText(ctx?.getCurrentChatId?.() || '', 240),
                targetChatId,
                chatLength: Array.isArray(ctx?.chat) ? ctx.chat.length : 0,
                lastIsUser: Boolean(ctx?.chat?.at?.(-1)?.is_user),
            };
        };
        const countWorldRefs = (refs) => {
            const counts = {};
            for (const ref of refs) {
                counts[ref] = (counts[ref] || 0) + 1;
            }
            return counts;
        };
        const collectWorldInfoBindingState = async (characterIndex) => {
            const ctx = globalThis.SillyTavern?.getContext?.();
            const characterRefs = [
                ['context.characters[characterIndex]', ctx?.characters?.[characterIndex]],
                ['script.characters[characterIndex]', stModule?.characters?.[characterIndex]],
                ['script.characters[this_chid]', stModule?.characters?.[stModule?.this_chid]],
            ];
            const primaryWorldRefs = [];
            for (const [source, character] of characterRefs) {
                primaryWorldRefs.push({
                    source,
                    name: sanitizeText(character?.name || '', 160),
                    avatar: sanitizeText(character?.avatar || '', 240),
                    world: sanitizeText(character?.data?.extensions?.world || '', 240),
                });
            }
            const selectedWorldInfo = Array.isArray(worldInfoModule?.selected_world_info)
                ? worldInfoModule.selected_world_info.map((value) => sanitizeText(value, 240)).filter(Boolean)
                : [];
            const charLore = Array.isArray(worldInfoModule?.world_info?.charLore)
                ? worldInfoModule.world_info.charLore.map((entry) => ({
                    name: sanitizeText(entry?.name || '', 240),
                    extraBooks: Array.isArray(entry?.extraBooks) ? entry.extraBooks.map((value) => sanitizeText(value, 240)).filter(Boolean) : [],
                }))
                : [];
            let sortedWorldInfoWorldRefs = [];
            let sortedWorldInfoError = '';
            try {
                const sortedEntries = await worldInfoModule.getSortedEntries();
                sortedWorldInfoWorldRefs = uniqueWorldRefs((Array.isArray(sortedEntries) ? sortedEntries : [])
                    .map((entry) => sanitizeText(entry?.world || '', 240))
                    .filter(Boolean));
            } catch (error) {
                sortedWorldInfoError = sanitizeText(error?.message || error, 240);
            }
            return {
                contextCharacterId: sanitizeText(ctx?.characterId ?? '', 80),
                scriptThisChid: sanitizeText(stModule?.this_chid ?? '', 80),
                chatMetadataWorldInfo: sanitizeText(stModule?.chat_metadata?.world_info || '', 240),
                selectedWorldInfo,
                charLore,
                primaryWorldRefs,
                sortedWorldInfoWorldRefs,
                sortedWorldInfoEntryCountByWorld: countWorldRefs(sortedWorldInfoWorldRefs),
                sortedWorldInfoError,
            };
        };
        const readTargetRawChat = async () => {
            if (!stModule?.getRequestHeaders) {
                throw Object.assign(new Error('ORIGINAL_HEADERS_UNAVAILABLE'), { code: 'ORIGINAL_HEADERS_UNAVAILABLE' });
            }
            const response = await fetch('/api/chats/get', {
                method: 'POST',
                headers: stModule.getRequestHeaders(),
                cache: 'no-cache',
                body: JSON.stringify({
                    avatar_url: payload.avatar,
                    file_name: targetChatId,
                }),
            });
            if (!response.ok) {
                throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_READ_FAILED'), { code: 'ORIGINAL_TARGET_CHAT_READ_FAILED' });
            }
            const rawChat = await response.json();
            return Array.isArray(rawChat) ? rawChat : [];
        };
        const resolveCharacterIdentity = (message) => {
            if (!message || message.is_user) return null;
            const ctx = globalThis.SillyTavern?.getContext?.();
            const characters = Array.isArray(ctx?.characters) ? ctx.characters : [];
            const activeId = Number.isInteger(ctx?.characterId) ? ctx.characterId : Number(ctx?.characterId);
            const active = Number.isInteger(activeId) ? characters[activeId] : null;
            const matched = active || characters.find((character) => sanitizeText(character?.name || '', 160) === sanitizeText(message.name || '', 160)) || null;
            const speaker = sanitizeText(message.name || '', 160);
            const matchedId = Number.isInteger(activeId) && active === matched
                ? activeId
                : characters.indexOf(matched);
            const avatar = sanitizeText(matched?.avatar || '', 240);
            const name = sanitizeText(matched?.name || speaker, 160);
            if (!matched && !speaker && !avatar) return null;
            return {
                characterId: matchedId >= 0 ? matchedId : '',
                avatar,
                name,
            };
        };
        const snapshot = (rawChat, chatId = targetChatId) => {
            const messagesRaw = stripHeader(rawChat);
            return {
                chatId: normalizeChatId(chatId),
                rawChat,
                messages: messagesRaw
                    .filter((message) => message && typeof message.mes === 'string' && message.mes.trim() && !message.is_system)
                    .map((message, index) => ({
                        id: 'original-runtime-message-' + index,
                        speaker: sanitizeText(message.name || (message.is_user ? 'Player' : 'Character'), 160),
                        role: message.is_user ? 'player' : 'character',
                        characterIdentity: resolveCharacterIdentity(message),
                        text: sanitizeText(message.extra?.display_text || message.mes, 16000),
                        sentAt: sanitizeText(message.send_date || '', 120),
                    })),
            };
        };
        const waitFor = async (predicate, timeoutMs, errorCode) => {
            const end = Date.now() + timeoutMs;
            while (Date.now() < end) {
                try {
                    const value = await predicate();
                    if (value) return value;
                } catch {
                    // keep polling while the original app initializes
                }
                await delay(250);
            }
            throw Object.assign(new Error(errorCode), { code: errorCode });
        };

        try {
            await waitFor(() => globalThis.SillyTavern?.getContext, 60000, 'ORIGINAL_CONTEXT_UNAVAILABLE');
            stModule = await import('/script.js');
            openaiSettingsModule = await import('/scripts/openai.js');
            eventsModule = await import('/scripts/events.js');
            if (eventsModule?.eventSource && eventsModule?.event_types?.WORLD_INFO_ACTIVATED) {
                eventsModule.eventSource.on(eventsModule.event_types.WORLD_INFO_ACTIVATED, captureWorldInfoActivation);
            }
            await waitFor(() => Boolean(stModule.token), 60000, 'ORIGINAL_CSRF_UNAVAILABLE');
            worldInfoModule = await import('/scripts/world-info.js');
            await waitFor(() => Array.isArray(worldInfoModule.world_names), 60000, 'ORIGINAL_WORLD_INFO_UNAVAILABLE');
            await waitFor(() => document.querySelector('#send_textarea'), 60000, 'ORIGINAL_INPUT_UNAVAILABLE');
            let ctx = globalThis.SillyTavern.getContext();
            if (typeof ctx.getCharacters === 'function') {
                await ctx.getCharacters();
            }
            await waitFor(() => Array.isArray(globalThis.SillyTavern.getContext().characters) && globalThis.SillyTavern.getContext().characters.length > 0, 60000, 'ORIGINAL_CHARACTERS_UNAVAILABLE');

            ctx = globalThis.SillyTavern.getContext();
            const expectedAvatar = normalizeAvatar(payload.avatar);
            const characterIndex = ctx.characters.findIndex((character) => {
                const avatar = normalizeAvatar(character?.avatar);
                const name = normalizeAvatar(character?.name);
                return avatar === expectedAvatar || avatar.replace(/\\.[^.]+$/, '') === expectedAvatar.replace(/\\.[^.]+$/, '') || name === expectedAvatar;
            });
            if (characterIndex < 0) {
                throw Object.assign(new Error('ORIGINAL_CHARACTER_NOT_FOUND'), { code: 'ORIGINAL_CHARACTER_NOT_FOUND' });
            }

            const openedFromChatId = normalizeChatId(ctx.getCurrentChatId?.() || '');
            let targetBeforeRawChat = await readTargetRawChat();
            let targetBeforeMessages = stripHeader(targetBeforeRawChat);
            let targetBeforeLast = latestMessage(targetBeforeRawChat);
            const targetBeforeWorldInfo = sanitizeText(targetBeforeRawChat[0]?.chat_metadata?.world_info || '', 240);
            if (expectedChatWorldInfo && targetBeforeWorldInfo !== expectedChatWorldInfo) {
                throw Object.assign(new Error('ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH'), {
                    code: 'ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH',
                    diagnostics: {
                        expectedWorldInfo: expectedChatWorldInfo,
                        targetWorldInfo: targetBeforeWorldInfo,
                        targetBefore: summarizeRawChat(targetBeforeRawChat),
                    },
                });
            }
            const forceTargetChatState = () => {
                const current = globalThis.SillyTavern.getContext();
                if (current.characters?.[characterIndex]) {
                    current.characters[characterIndex].chat = targetChatId;
                }
                // SillyTavern exposes character state through both the
                // context object and the original script module. In some
                // builds these arrays are not the same object; updating only
                // the context leaves getCurrentChatId() reading the old chat
                // and makes the binding look unstable.
                if (stModule?.characters?.[characterIndex]) {
                    stModule.characters[characterIndex].chat = targetChatId;
                }
                if (stModule?.this_chid !== undefined
                    && Number(stModule.this_chid) === Number(characterIndex)
                    && stModule?.characters?.[stModule.this_chid]) {
                    stModule.characters[stModule.this_chid].chat = targetChatId;
                }
                const selectedChat = document.querySelector('#selected_chat_pole');
                if (selectedChat) {
                    selectedChat.value = targetChatId;
                }
            };
            const currentMatchesTargetBeforeGeneration = () => {
                const current = globalThis.SillyTavern.getContext();
                const currentLast = current.chat?.at?.(-1);
                return normalizeChatId(current.getCurrentChatId?.()) === targetChatId
                    && Array.isArray(current.chat)
                    && current.chat.length === targetBeforeMessages.length
                    && Boolean(currentLast?.is_user) === Boolean(targetBeforeLast?.is_user)
                    && sanitizeText(currentLast?.mes || '', 4000) === sanitizeText(targetBeforeLast?.mes || '', 4000);
            };
            const cloneMessage = (message) => JSON.parse(JSON.stringify(message || {}));
            const forceReloadTargetChatFromReadback = async () => {
                forcedRuntimeChatReloadAttempts += 1;
                runtimeStateBeforeForcedReload = runtimeState();
                forceTargetChatState();
                const currentBeforeReload = globalThis.SillyTavern.getContext();
                if (typeof currentBeforeReload.reloadCurrentChat === 'function') {
                    await currentBeforeReload.reloadCurrentChat();
                    forceTargetChatState();
                    if (currentMatchesTargetBeforeGeneration()) {
                        forcedRuntimeChatReload = true;
                        runtimeStateAfterForcedReload = runtimeState();
                        return;
                    }
                }

                const current = globalThis.SillyTavern.getContext();
                const header = Array.isArray(targetBeforeRawChat) && targetBeforeRawChat[0]?.chat_metadata
                    ? targetBeforeRawChat[0]
                    : { chat_metadata: {} };
                const messages = targetBeforeMessages.map(cloneMessage);
                if (Array.isArray(current.chat)) {
                    current.chat.splice(0, current.chat.length, ...messages);
                }
                if (Array.isArray(stModule?.chat) && stModule.chat !== current.chat) {
                    stModule.chat.splice(0, stModule.chat.length, ...messages.map(cloneMessage));
                }
                if (typeof current.updateChatMetadata === 'function') {
                    current.updateChatMetadata(header.chat_metadata || {}, true);
                }
                if (typeof stModule?.loadItemizedPrompts === 'function') {
                    await stModule.loadItemizedPrompts(targetChatId);
                }
                if (typeof current.printMessages === 'function') {
                    await current.printMessages();
                }
                const eventSource = eventsModule?.eventSource || current.eventSource;
                const eventTypes = eventsModule?.event_types || current.eventTypes;
                if (eventSource?.emit && eventTypes?.CHAT_LOADED) {
                    await eventSource.emit(eventTypes.CHAT_LOADED, { detail: { id: characterIndex, character: current.characters?.[characterIndex] } });
                }
                if (eventSource?.emit && eventTypes?.CHAT_CHANGED) {
                    await eventSource.emit(eventTypes.CHAT_CHANGED, targetChatId);
                }
                forceTargetChatState();
                forcedRuntimeChatReload = true;
                runtimeStateAfterForcedReload = runtimeState();
            };
            const holdTargetBinding = async (durationMs) => {
                const end = Date.now() + durationMs;
                while (Date.now() < end) {
                    forceTargetChatState();
                    applyCharacterPrimaryWorldIsolation();
                    if (!currentMatchesTargetBeforeGeneration()) {
                        throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_BINDING_UNSTABLE'), {
                            code: 'ORIGINAL_TARGET_CHAT_BINDING_UNSTABLE',
                            diagnostics: {
                                ...runtimeState(),
                                ...runtimeReloadDiagnostics(),
                                openedFromChatId,
                                targetBefore: summarizeRawChat(targetBeforeRawChat),
                            },
                        });
                    }
                    await delay(250);
                }
            };
            const saveTargetRawChat = async (rawChat) => {
                const current = globalThis.SillyTavern.getContext();
                const response = await fetch('/api/chats/save', {
                    method: 'POST',
                    headers: stModule.getRequestHeaders(),
                    cache: 'no-cache',
                    body: JSON.stringify({
                        ch_name: sanitizeText(current.characters?.[characterIndex]?.name || 'Character', 160),
                        avatar_url: payload.avatar,
                        file_name: targetChatId,
                        chat: rawChat,
                        force: true,
                    }),
                });
                if (!response.ok) {
                    throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_SAVE_FAILED'), { code: 'ORIGINAL_TARGET_CHAT_SAVE_FAILED' });
                }
            };
            const trimTrailingEmptyOriginalReply = async (rawChat) => {
                let trimmedRawChat = rawChat;
                while (true) {
                    const messages = stripHeader(trimmedRawChat);
                    const last = messages.at(-1);
                    if (!(last && !last.is_user && !last.is_system && !sanitizeText(last.mes || '', 4000))) {
                        break;
                    }
                    trimmedRawChat = trimmedRawChat.slice(0, -1);
                }
                if (trimmedRawChat === rawChat) {
                    return rawChat;
                }
                await saveTargetRawChat(trimmedRawChat);
                return trimmedRawChat;
            };
            // A failed generation can leave an empty assistant placeholder at
            // the end of an otherwise valid chat. The player adapter filters
            // that placeholder and correctly sees the preceding user message
            // as awaiting a reply, but the original runtime would otherwise
            // treat the empty assistant record as the final message and return
            // unchanged. Remove only that known empty failure artifact before
            // binding the runtime target, then continue with the real user
            // message. This preserves all non-empty conversation data.
            const trimmedTargetBeforeRawChat = await trimTrailingEmptyOriginalReply(targetBeforeRawChat);
            if (trimmedTargetBeforeRawChat !== targetBeforeRawChat) {
                targetBeforeRawChat = trimmedTargetBeforeRawChat;
                targetBeforeMessages = stripHeader(targetBeforeRawChat);
                targetBeforeLast = latestMessage(targetBeforeRawChat);
            }
            if (!targetBeforeMessages.length) {
                throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_EMPTY'), {
                    code: 'ORIGINAL_TARGET_CHAT_EMPTY',
                    diagnostics: {
                        ...runtimeState(),
                        target: summarizeRawChat(targetBeforeRawChat),
                    },
                });
            }

            forceTargetChatState();
            await ctx.selectCharacterById(characterIndex, { switchMenu: false });
            await waitFor(() => String(globalThis.SillyTavern.getContext().characterId) === String(characterIndex), 60000, 'ORIGINAL_CHARACTER_SELECT_TIMEOUT');
            ctx = globalThis.SillyTavern.getContext();
            await ctx.openCharacterChat(targetChatId);
            forceTargetChatState();
            if (!currentMatchesTargetBeforeGeneration()) {
                await forceReloadTargetChatFromReadback();
            }
            await waitFor(currentMatchesTargetBeforeGeneration, 10000, 'ORIGINAL_TARGET_CHAT_BINDING_TIMEOUT');
            if (expectedChatWorldInfo) {
                await waitFor(() => sanitizeText(stModule.chat_metadata?.world_info || '', 240) === expectedChatWorldInfo, 10000, 'ORIGINAL_RUNTIME_WORLD_INFO_NOT_LOADED');
            }
            const activeCharacter = globalThis.SillyTavern.getContext().characters?.[characterIndex];
            characterPrimaryWorldBefore = sanitizeText(activeCharacter?.data?.extensions?.world || '', 240);
            const primaryWorldRestoreTargets = [];
            const addPrimaryWorldRestoreTarget = (character, world) => {
                if (!primaryWorldRestoreTargets.some((target) => target.character === character)) {
                    primaryWorldRestoreTargets.push({ character, world });
                }
            };
            const collectRuntimeCharacterRefs = () => {
                const current = globalThis.SillyTavern.getContext();
                const runtimeCharacterRefs = [];
                const addRuntimeCharacterRef = (character) => {
                    if (character?.data?.extensions && !runtimeCharacterRefs.includes(character)) {
                        runtimeCharacterRefs.push(character);
                    }
                };
                addRuntimeCharacterRef(current.characters?.[characterIndex]);
                addRuntimeCharacterRef(stModule.characters?.[characterIndex]);
                addRuntimeCharacterRef(stModule.characters?.[stModule.this_chid]);
                return runtimeCharacterRefs;
            };
            applyCharacterPrimaryWorldIsolation = () => {
                if (!expectedChatWorldInfo) {
                    return;
                }
                const runtimeCharacterRefs = collectRuntimeCharacterRefs();
                for (const character of runtimeCharacterRefs) {
                    const world = sanitizeText(character?.data?.extensions?.world || '', 240);
                    if (world && world !== expectedChatWorldInfo) {
                        addPrimaryWorldRestoreTarget(character, world);
                        character.data.extensions.world = '';
                        characterPrimaryWorldTemporarilyDisabled = true;
                    }
                }
                characterPrimaryWorldAfterDisable = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
            };
            restoreCharacterPrimaryWorld = () => {
                if (characterPrimaryWorldRestored) {
                    return;
                }
                for (const target of primaryWorldRestoreTargets) {
                    if (target.character?.data?.extensions) {
                        target.character.data.extensions.world = target.world;
                    }
                }
                characterPrimaryWorldRestored = true;
            };
            applyCharacterPrimaryWorldIsolation();
            await holdTargetBinding(2000);
            await waitFor(() => globalThis.SillyTavern.getContext().onlineStatus !== 'no_connection', 60000, 'ORIGINAL_BACKEND_NO_CONNECTION');
            applyCharacterPrimaryWorldIsolation();
            const worldInfoBindingBeforeGenerate = await collectWorldInfoBindingState(characterIndex);

            ctx = globalThis.SillyTavern.getContext();
            const beforeCount = targetBeforeMessages.length;
            if (!targetBeforeLast?.is_user) {
                cleanupRuntimeBinding();
                const characterPrimaryWorldAfterRestore = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
                return {
                    ok: true,
                    unchanged: true,
                    elapsedMs: Date.now() - startedAt,
                    ...snapshot(targetBeforeRawChat, targetChatId),
                    generatedText: sanitizeText(targetBeforeLast?.mes || '', 16000),
                    diagnostics: {
                        openedFromChatId,
                        currentChatIdAfterOpen: normalizeChatId(ctx.getCurrentChatId?.() || ''),
                        runtimeWorldBookRefs: expectedWorldBookRefs,
                        chatMetadataWorldInfo: sanitizeText(stModule.chat_metadata?.world_info || '', 240),
                        ...runtimeReloadDiagnostics(),
                        characterPrimaryWorldBefore,
                        characterPrimaryWorldAfterDisable,
                        characterPrimaryWorldTemporarilyDisabled,
                        characterPrimaryWorldRestored,
                        characterPrimaryWorldAfterRestore,
                        worldInfoBindingBeforeGenerate,
                        ...buildWorldInfoEventDiagnostics(),
                        targetBefore: summarizeRawChat(targetBeforeRawChat),
                        targetAfter: summarizeRawChat(targetBeforeRawChat),
                    },
                };
            }

            const applyProviderRuntimeSettings = () => {
                const dispatchChange = (element) => element?.dispatchEvent(new Event('change', { bubbles: true }));
                const ctx = globalThis.SillyTavern?.getContext?.();
                const settings = openaiSettingsModule?.oai_settings
                    || ctx?.chatCompletionSettings
                    || stModule?.oai_settings
                    || ctx?.oai_settings
                    || {};
                const forcedProviderSettings = payload.providerSettings || {};
                if (forcedProviderSettings.provider === 'claude') {
                    settings.chat_completion_source = 'claude';
                    settings.claude_model = forcedProviderSettings.model || settings.claude_model || 'claude-sonnet-4-6';
                    if (forcedProviderSettings.reverseProxy) {
                        settings.reverse_proxy = forcedProviderSettings.reverseProxy;
                    }
                    if (forcedProviderSettings.proxyPassword) {
                        settings.proxy_password = forcedProviderSettings.proxyPassword;
                    }
                    settings.openai_max_tokens = forcedProviderSettings.maxTokens || settings.openai_max_tokens || 4096;
                }
                const provider = sanitizeText(forcedProviderSettings.provider || document.querySelector('#chat_completion_source')?.value || settings.chat_completion_source || ctx?.mainApi || '', 80).toLowerCase();
                const modelSelector = provider === 'claude' ? '#model_claude_select' : '#model_openai_select';
                const modelKey = provider === 'claude' ? 'claude_model' : 'openai_model';
                const modelSelect = document.querySelector(modelSelector);
                const currentModel = sanitizeText(settings[modelKey] || modelSelect?.value || '', 120);
                if (provider !== 'openai') {
                    return {
                        provider,
                        model: currentModel,
                        reasoningEffort: sanitizeText(settings.reasoning_effort || '', 40),
                        verbosity: sanitizeText(settings.verbosity || '', 40),
                        maxTokens: sanitizeText(settings.openai_max_tokens || '', 40),
                        applied: false,
                    };
                }
                const preferredModel = ['gpt-5.5', 'gpt-5.5-2026-04-23']
                    .map((value) => [...(modelSelect?.options || [])].find((option) => option.value === value))
                    .find(Boolean);
                if (preferredModel && modelSelect.value !== preferredModel.value) {
                    modelSelect.value = preferredModel.value;
                    dispatchChange(modelSelect);
                }
                for (const [selector, value] of [['#openai_reasoning_effort', 'medium'], ['#openai_verbosity', 'medium']]) {
                    const element = document.querySelector(selector);
                    if (element && [...(element.options || [])].some((option) => option.value === value) && element.value !== value) {
                        element.value = value;
                        dispatchChange(element);
                    }
                }
                return {
                    provider,
                    model: sanitizeText(modelSelect?.value || '', 120),
                    reasoningEffort: sanitizeText(document.querySelector('#openai_reasoning_effort')?.value || '', 40),
                    verbosity: sanitizeText(document.querySelector('#openai_verbosity')?.value || '', 40),
                    maxTokens: sanitizeText(document.querySelector('#openai_max_tokens')?.value || '', 40),
                    applied: true,
                };
            };
            const runtimeGenerationSettings = applyProviderRuntimeSettings();
            const input = document.querySelector('#send_textarea');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            targetLockTimer = setInterval(() => {
                forceTargetChatState();
                applyCharacterPrimaryWorldIsolation();
            }, 100);
            const readTargetReplyStatus = async () => {
                const assertTarget = () => {
                    if (normalizeChatId(globalThis.SillyTavern.getContext().getCurrentChatId?.() || '') !== targetChatId) {
                        throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_BINDING_LOST'), { code: 'ORIGINAL_TARGET_CHAT_BINDING_LOST', fatal: true });
                    }
                };
                assertTarget();
                const targetRawChat = await readTargetRawChat();
                assertTarget();
                const targetMessages = stripHeader(targetRawChat);
                if (targetMessages.length < beforeCount || targetBeforeMessages.some((item, index) => (
                    item.mes !== targetMessages[index]?.mes
                    || Boolean(item.is_user) !== Boolean(targetMessages[index]?.is_user)
                ))) {
                    throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_CHANGED'), { code: 'ORIGINAL_TARGET_CHAT_CHANGED', fatal: true });
                }
                const last = targetMessages.at(-1);
                if (!(targetMessages.length > beforeCount && last && !last.is_user && !last.is_system)) {
                    return null;
                }
                return sanitizeText(last.mes || '', 4000)
                    ? { type: 'ready', rawChat: targetRawChat }
                    : { type: 'empty', rawChat: targetRawChat };
            };
            applyCharacterPrimaryWorldIsolation();
            resetDuringGenerateWorldInfoEvents();
            const finalRawChat = await (${waitForOriginalGenerationCompletion.toString()})({
                generate: () => ctx.generate('normal', { automatic_trigger: false }),
                readReply: readTargetReplyStatus,
                stopGeneration: () => ctx.stopGeneration?.(),
                timeoutMs: payload.timeoutMs,
                readbackTimeoutMs: 30000,
            });
            worldInfoEventWindow = 'postGenerate';

            const currentSnapshot = snapshot(finalRawChat, targetChatId);
            clearInterval(targetLockTimer);
            targetLockTimer = null;
            restoreCharacterPrimaryWorld();
            const characterPrimaryWorldAfterRestore = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
            return {
                ok: true,
                unchanged: false,
                elapsedMs: Date.now() - startedAt,
                ...currentSnapshot,
                generatedText: sanitizeText(latestMessage(finalRawChat)?.mes || '', 16000),
                diagnostics: {
                    openedFromChatId,
                    currentChatIdAfterOpen: targetChatId,
                    currentChatIdAfterGenerate: normalizeChatId(globalThis.SillyTavern.getContext().getCurrentChatId?.() || ''),
                    runtimeWorldBookRefs: expectedWorldBookRefs,
                    chatMetadataWorldInfo: sanitizeText(stModule.chat_metadata?.world_info || '', 240),
                    ...runtimeReloadDiagnostics(),
                    characterPrimaryWorldBefore,
                    characterPrimaryWorldAfterDisable,
                    characterPrimaryWorldTemporarilyDisabled,
                    characterPrimaryWorldRestored,
                    characterPrimaryWorldAfterRestore,
                    runtimeGenerationSettings,
                    worldInfoBindingBeforeGenerate,
                    ...buildWorldInfoEventDiagnostics(),
                    targetBefore: summarizeRawChat(targetBeforeRawChat),
                    targetAfter: summarizeRawChat(finalRawChat),
                },
            };
        } catch (error) {
            let targetState = {};
            try {
                targetState = stModule ? summarizeRawChat(await readTargetRawChat()) : {};
            } catch {
                targetState = {};
            }
            return {
                ok: false,
                elapsedMs: Date.now() - startedAt,
                errorCode: error?.code || error?.message || 'ORIGINAL_RUNTIME_FAILED',
                errorMessage: String(error?.message || error || ''),
                errorStack: String(error?.stack || '').slice(0, 2000),
                runtimeState: {
                    ...(error?.diagnostics || runtimeState()),
                    ...runtimeReloadDiagnostics(),
                    targetState,
                },
            };
        } finally {
            cleanupRuntimeBinding();
        }
    })()`;
}

function resolveBridgeReady(health, status = {}) {
    if (typeof health?.ready === 'boolean') return health.ready;
    if (typeof status?.ready === 'boolean') return status.ready;
    // Compatibility for test doubles and older bridge runtimes that only
    // expose `{ ok: true }`; the real browser bridge always supplies ready.
    return Boolean(health?.ok ?? true);
}

function validateGenerateRequest(body, proofVerifier) {
    if (!body || typeof body !== 'object') {
        return { ok: false, errorCode: 'INVALID_REQUEST' };
    }
    if (!body.character?.avatar) {
        return { ok: false, errorCode: 'CHARACTER_AVATAR_REQUIRED' };
    }
    if (!body.chatId) {
        return { ok: false, errorCode: 'CHAT_ID_REQUIRED' };
    }
    return validateSignedBridgeProof(body, proofVerifier);
}

function validateSignedBridgeProof(body, proofVerifier) {
    const requestId = sanitizeReference(body.requestId || `bridge-${Date.now().toString(36)}`, 80);
    const verification = proofVerifier.verify(body.bridgeProof, { requestId });
    if (!verification.ok) {
        return verification;
    }

    const proof = verification.proof;
    const binding = proof.binding;
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_BINDING_REQUIRED',
            evidence: deniedEvidence({ requestId, reason: 'missing-bridge-binding' }),
        };
    }
    if (proof.protocolVersion !== 'galgame.original-runtime-bridge-proof.v1') {
        return {
            ok: false,
            errorCode: 'BRIDGE_PROOF_VERSION_UNSUPPORTED',
            evidence: deniedEvidence({ requestId, reason: 'unsupported-proof-version' }),
        };
    }
    if (proof.audience !== 'original-runtime-bridge') {
        return {
            ok: false,
            errorCode: 'BRIDGE_PROOF_AUDIENCE_MISMATCH',
            evidence: deniedEvidence({ requestId, reason: 'proof-audience-mismatch' }),
        };
    }

    const release = binding.release || {};
    const target = binding.target || {};
    const chat = binding.chat || {};
    const resources = binding.resources || {};
    const releaseId = sanitizeReference(release.releaseId, 240);
    const scenarioId = sanitizeReference(release.scenarioId, 160);
    const scenarioVersion = sanitizeReference(release.scenarioVersion, 80);
    const arcId = sanitizeReference(release.arcId, 120);
    const chatId = normalizeChatId(body.chatId);
    const bindingChatId = normalizeChatId(chat.chatId);
    const allowedChatIds = uniqueArray([chat.chatId, chat.chatSeedId, ...(Array.isArray(chat.allowedChatIds) ? chat.allowedChatIds : [])]
        .map(normalizeChatId)
        .filter(Boolean));
    const runtimeWorldBookRefs = normalizeWorldBookRefs(resources.worldBookRefs);
    const requestAvatar = normalizeAvatar(body.character.avatar);
    const targetAvatar = normalizeAvatar(target.avatar);
    const requestCharacterId = sanitizeReference(body.character.id || '', 160).toLowerCase();
    const targetCharacterId = sanitizeReference(target.characterId || '', 160).toLowerCase();
    const normalizedBinding = {
        protocolVersion: 'galgame.original-runtime-bridge-binding.v1',
        release: {
            releaseId,
            scenarioId,
            scenarioVersion,
            arcId,
            arcVersion: sanitizeReference(release.arcVersion || '', 80),
        },
        target: {
            type: sanitizeReference(target.type || '', 40),
            characterId: sanitizeReference(target.characterId || '', 160),
            avatar: sanitizeReference(target.avatar || '', 240),
            groupId: sanitizeReference(target.groupId || '', 160),
        },
        chat: {
            chatId: bindingChatId,
            chatSeedId: normalizeChatId(chat.chatSeedId),
            allowedChatIds,
        },
        resources: {
            worldBookRefs: runtimeWorldBookRefs,
            worldBookApplication: sanitizeReference(resources.worldBookApplication || '', 120),
        },
    };
    const targetBindingHash = stableReferenceHash(normalizedBinding);
    const baseEvidence = {
        requestId,
        releaseId,
        scenarioId,
        scenarioVersion,
        arcId,
        chatIdHash: sha256Short(chatId),
        targetBindingHash,
        worldBookRefsHash: sha256Short(runtimeWorldBookRefs.join('\n')),
    };

    const bodyReleaseId = sanitizeReference(body.releaseId || '', 240);
    const bodyScenarioId = sanitizeReference(body.scenarioId || '', 160);
    const bodyScenarioVersion = sanitizeReference(body.scenarioVersion || '', 80);
    const bodyArcId = sanitizeReference(body.arcId || '', 120);
    if (
        (bodyReleaseId && bodyReleaseId !== releaseId)
        || (bodyScenarioId && bodyScenarioId !== scenarioId)
        || (bodyScenarioVersion && bodyScenarioVersion !== scenarioVersion)
        || (bodyArcId && bodyArcId !== arcId)
    ) {
        return {
            ok: false,
            errorCode: 'BRIDGE_RELEASE_INDEX_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'request-index-does-not-match-proof' }),
        };
    }
    if (!releaseId || !scenarioId || !scenarioVersion || !arcId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_RELEASE_BINDING_REQUIRED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'missing-release-or-arc-binding' }),
        };
    }
    if (bindingChatId && bindingChatId !== chatId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHAT_BINDING_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'body-chat-does-not-match-binding-chat' }),
        };
    }
    if (!allowedChatIds.includes(chatId)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHAT_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'chat-not-in-release-allowlist' }),
        };
    }
    if (target.type && target.type !== 'character') {
        return {
            ok: false,
            errorCode: 'BRIDGE_TARGET_UNBRIDGED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'group-target-is-not-yet-bridged' }),
        };
    }
    if (!targetAvatar || !avatarsMatch(requestAvatar, targetAvatar)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHARACTER_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'avatar-not-in-target-binding' }),
        };
    }
    if (requestCharacterId && targetCharacterId && requestCharacterId !== targetCharacterId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHARACTER_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'character-id-not-in-target-binding' }),
        };
    }
    if (proof.bindingHash && proof.bindingHash !== targetBindingHash) {
        return {
            ok: false,
            errorCode: 'BRIDGE_BINDING_HASH_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'binding-hash-mismatch' }),
        };
    }

    return {
        ok: true,
        runtimeBinding: {
            worldBookRefs: runtimeWorldBookRefs,
        },
        evidence: {
            ...baseEvidence,
            decision: 'allowed',
            runtimeWorldBookRefs,
        },
    };
}

export function createSignedBridgeProof({
    secret,
    binding,
    issuedAt = new Date(),
    ttlMs = 5 * 60 * 1000,
    nonce = randomUUID(),
} = {}) {
    const safeBinding = normalizeProofBinding(binding);
    const issuedAtDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
    const expiresAt = new Date(issuedAtDate.getTime() + ttlMs);
    const proof = {
        protocolVersion: 'galgame.original-runtime-bridge-proof.v1',
        audience: 'original-runtime-bridge',
        issuedAt: issuedAtDate.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce: sanitizeReference(nonce, 120),
        binding: safeBinding,
        bindingHash: stableReferenceHash(safeBinding),
    };
    return {
        ...proof,
        signature: signProofPayload(proof, secret),
    };
}

function createBridgeProofVerifier({ proofSecret, now = () => Date.now() } = {}) {
    const secret = String(proofSecret || '').trim();
    const usedNonces = new Map();
    return {
        required: true,
        configured: Boolean(secret),
        verify(proof, { requestId } = {}) {
            if (!secret) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_SECRET_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-secret-not-configured' }),
                };
            }
            if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'missing-signed-proof' }),
                };
            }
            const nonce = sanitizeReference(proof.nonce, 120);
            const expiresAtMs = Date.parse(proof.expiresAt || '');
            const issuedAtMs = Date.parse(proof.issuedAt || '');
            const nowMs = now();
            purgeUsedNonces(usedNonces, nowMs);
            if (!nonce) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_NONCE_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'missing-proof-nonce' }),
                };
            }
            if (usedNonces.has(nonce)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_REPLAYED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-nonce-replayed' }),
                };
            }
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_EXPIRED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-expired' }),
                };
            }
            if (!Number.isFinite(issuedAtMs) || issuedAtMs - nowMs > 60000) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_TIME_INVALID',
                    evidence: deniedEvidence({ requestId, reason: 'proof-issued-at-invalid' }),
                };
            }
            if (!verifyProofSignature(proof, secret)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_SIGNATURE_INVALID',
                    evidence: deniedEvidence({ requestId, reason: 'proof-signature-invalid' }),
                };
            }
            usedNonces.set(nonce, expiresAtMs);
            return {
                ok: true,
                proof,
            };
        },
    };
}

function purgeUsedNonces(usedNonces, nowMs) {
    for (const [nonce, expiresAtMs] of usedNonces.entries()) {
        if (expiresAtMs <= nowMs) {
            usedNonces.delete(nonce);
        }
    }
}

function normalizeProofBinding(binding = {}) {
    const release = binding.release || {};
    const target = binding.target || {};
    const chat = binding.chat || {};
    const resources = binding.resources || {};
    return {
        protocolVersion: 'galgame.original-runtime-bridge-binding.v1',
        release: {
            releaseId: sanitizeReference(release.releaseId, 240),
            scenarioId: sanitizeReference(release.scenarioId, 160),
            scenarioVersion: sanitizeReference(release.scenarioVersion, 80),
            arcId: sanitizeReference(release.arcId, 120),
            arcVersion: sanitizeReference(release.arcVersion || '', 80),
        },
        target: {
            type: sanitizeReference(target.type || 'character', 40),
            characterId: sanitizeReference(target.characterId || '', 160),
            avatar: sanitizeReference(target.avatar || '', 240),
            groupId: sanitizeReference(target.groupId || '', 160),
        },
        chat: {
            chatId: normalizeChatId(chat.chatId),
            chatSeedId: normalizeChatId(chat.chatSeedId),
            allowedChatIds: uniqueArray([chat.chatId, chat.chatSeedId, ...(Array.isArray(chat.allowedChatIds) ? chat.allowedChatIds : [])]
                .map(normalizeChatId)
                .filter(Boolean)),
        },
        resources: {
            worldBookRefs: normalizeWorldBookRefs(resources.worldBookRefs),
            worldBookApplication: sanitizeReference(resources.worldBookApplication || '', 120),
        },
    };
}

function signProofPayload(proof, secret) {
    if (!secret) {
        throw new Error('BRIDGE_PROOF_SECRET_REQUIRED');
    }
    return createHmac('sha256', secret)
        .update(canonicalProofPayload(proof))
        .digest('base64url');
}

function verifyProofSignature(proof, secret) {
    const signature = String(proof.signature || '');
    const expected = signProofPayload(proof, secret);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

function canonicalProofPayload(proof) {
    const { signature, ...unsignedProof } = proof || {};
    return stableStringify(unsignedProof);
}

function applyCors(request, response, allowedOrigins) {
    const origin = request.headers.origin || '';
    const allowAll = allowedOrigins.includes('*');
    if (allowAll || allowedOrigins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
        response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(response, status, data) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(data));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > 128 * 1024) {
                reject(new Error('REQUEST_TOO_LARGE'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text ? JSON.parse(text) : {});
            } catch {
                reject(new Error('INVALID_JSON'));
            }
        });
        request.on('error', reject);
    });
}

function parseAllowedOrigins(value) {
    if (!value) {
        return [
            'http://127.0.0.1:8000',
            'http://localhost:8000',
        ];
    }
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function createBridgeAuthConfig({ host, authToken }) {
    const normalizedToken = String(authToken || '').trim();
    const loopback = isLoopbackHost(host);
    if (!loopback && !normalizedToken) {
        throw new Error('GALGAME_BRIDGE_AUTH_REQUIRED_FOR_NON_LOOPBACK');
    }
    return {
        required: Boolean(normalizedToken),
        token: normalizedToken,
    };
}

function authorizeBridgeRequest(request, auth) {
    if (!auth.required) {
        return true;
    }
    const header = String(request.headers.authorization || '').trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    return Boolean(match && safeTokenEquals(match[1], auth.token));
}

function isLoopbackHost(value) {
    const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host.startsWith('127.');
}

function safeTokenEquals(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeChatId(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop().replace(/\.jsonl$/i, '').trim();
}

function normalizeAvatar(value) {
    return String(value || '').trim().toLowerCase().replace(/\\/g, '/').split('/').pop();
}

function avatarsMatch(left, right) {
    return left === right || left.replace(/\.[^.]+$/, '') === right.replace(/\.[^.]+$/, '');
}

function sanitizeReference(value, maxLength = 240) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, maxLength);
}

function normalizeWorldBookRefs(values) {
    return uniqueArray((Array.isArray(values) ? values : [])
        .map((value) => sanitizeReference(value, 240))
        .filter(Boolean));
}

function uniqueArray(values) {
    return [...new Set(values)];
}

function deniedEvidence(evidence) {
    return {
        ...evidence,
        decision: 'denied',
    };
}

function stableReferenceHash(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24)}`;
}

function sha256Short(value) {
    return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function clampTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.max(parsed, 10000), 600000);
}

function clampStopTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 15000;
    }
    return Math.min(Math.max(parsed, 10), 60000);
}

function parseRetryDelays(value, fallback = DEFAULT_PROVIDER_RETRY_DELAYS_MS) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    const parsed = source
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .map((item) => Math.min(item, 30000));
    return parsed.length ? parsed.slice(0, 5) : fallback.slice();
}

function isRetryableOriginalProviderError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details?.errorMessage,
        error?.details?.runtimeState?.errorMessage,
    ].map((value) => String(value || '')).join(' ');
    if (/ORIGINAL_TARGET_CHAT|BRIDGE_|WORLD_INFO_MISMATCH|CHARACTER_NOT_FOUND|PROOF|BINDING/i.test(text)) {
        return false;
    }
    return /Got[_ ]response[_ ]status[_ ](429|500|502|503|504)|HTTP[_ ]?(429|500|502|503|504)|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR|socket|network|fetch failed/i.test(text);
}

function sanitizeErrorCode(error) {
    return redactSensitive(String(error?.code || error?.message || error || 'ORIGINAL_RUNTIME_BRIDGE_FAILED'))
        .replace(/[^A-Z0-9_:-]+/gi, '_')
        .slice(0, 120);
}

function sanitizeLogError(error) {
    return {
        code: sanitizeErrorCode(error),
        message: redactSensitive(String(error?.message || error || '')),
        details: sanitizeDiagnostics(error?.details),
    };
}

function sanitizeDiagnostics(value) {
    if (!value || typeof value !== 'object') {
        return value === undefined ? undefined : redactSensitive(String(value));
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeDiagnostics);
    }
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
        if (/authorization|token|secret|api[-_]?key|password/i.test(key)) {
            safe[key] = '[redacted]';
        } else if (typeof item === 'object' && item !== null) {
            safe[key] = sanitizeDiagnostics(item);
        } else {
            safe[key] = redactSensitive(String(item));
        }
    }
    return safe;
}

function redactSensitive(value) {
    return String(value || '')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/(token|secret|api[-_]?key|authorization)[=:]\s*[^,\s]+/gi, '$1=[redacted]');
}

async function connectBrowser(port) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
            const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
            return createCdpClient(version.webSocketDebuggerUrl);
        } catch {
            await delay(100);
        }
    }
    throw new Error('CHROME_DEBUGGING_ENDPOINT_UNAVAILABLE');
}

function createCdpClient(url) {
    const socket = new WebSocket(url);
    let sequence = 0;
    const pending = new Map();

    socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (!message.id || !pending.has(message.id)) {
            return;
        }
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
            reject(new Error(message.error.message));
        } else {
            resolve(message.result || {});
        }
    });

    return {
        async send(method, params = {}, sessionId = undefined) {
            await onceOpen(socket);
            return new Promise((resolve, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        },
    };
}

function onceOpen(socket) {
    if (socket.readyState === WebSocket.OPEN) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
}

function findChrome() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const candidate of candidates) {
        try {
            statSync(candidate);
            return candidate;
        } catch {
            continue;
        }
    }
    throw new Error('CHROME_NOT_FOUND');
}

async function getFreePort(start) {
    for (let port = start; port < start + 100; port += 1) {
        if (await canListen(port)) {
            return port;
        }
    }
    throw new Error('NO_FREE_DEBUG_PORT');
}

function canListen(port) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolve(true));
        });
    });
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function waitForChildExit(child, timeoutMs) {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
        return Promise.resolve(true);
    }
    return new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (didExit) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.removeListener('exit', onExit);
            resolve(didExit);
        };
        const onExit = () => finish(true);
        child.once('exit', onExit);
        timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
        if (child.exitCode !== null || child.signalCode !== null) finish(true);
    });
}

function createDeferred() {
    let settled = false;
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            innerResolve(value);
        };
        reject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            innerReject(error);
        };
    });
    return {
        promise,
        resolve,
        reject,
    };
}

function createBridgeError(code, details = {}) {
    const error = new Error(code);
    error.code = code;
    error.details = details;
    return error;
}

function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const port = Number(process.env.PORT || process.env.GALGAME_ORIGINAL_RUNTIME_BRIDGE_PORT || DEFAULT_PORT);
    const host = process.env.HOST || '127.0.0.1';
    const server = createOriginalRuntimeBridgeServer();
    const shutdown = () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.listen(port, host, () => {
        console.log(JSON.stringify({
            ok: true,
            service: 'original-runtime-bridge',
            url: `http://${host}:${port}`,
        }));
    });
}
