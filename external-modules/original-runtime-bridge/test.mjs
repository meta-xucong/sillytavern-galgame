import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
    BrowserOriginalRuntimeBridge,
    createOriginalRuntimeBridgeServer,
    createSignedBridgeProof,
    probeConfiguredLlm,
} from './server.mjs';

const proofSecret = 'test-proof-secret';
const authToken = 'test-auth-token';
const targetChatId = 'galgame-test-aoi-rain-town';
const binding = {
    release: {
        releaseId: 'rel_galgame_test_arc1',
        scenarioId: 'galgame-test-aoi-entry',
        scenarioVersion: '0.1.0',
        arcId: 'arc1',
        arcVersion: '1.0.0',
    },
    target: {
        type: 'character',
        characterId: 'Galgame_Test_Aoi',
        avatar: 'galgame_test_aoi.png',
    },
    chat: {
        chatId: targetChatId,
        chatSeedId: 'galgame-test-aoi-rain-town-seed',
        allowedChatIds: [targetChatId],
    },
    resources: {
        worldBookRefs: ['Galgame_Test_Aoi_RainTown_Bundle'],
        worldBookApplication: 'sillytavern-chat-metadata-world_info',
    },
};

// Health must distinguish an idle bridge that can lazily start its browser
// from a stuck generation and a bridge that was stopped.
const healthProbe = new BrowserOriginalRuntimeBridge({ logger: { warn() {} } });
assert.equal((await healthProbe.healthCheck()).ready, true);
healthProbe.pendingTask = { startedAt: Date.now() - 300000 };
const staleHealth = await healthProbe.healthCheck();
assert.equal(staleHealth.ready, false);
assert.equal(staleHealth.stale, true);
assert.equal(staleHealth.connectionState, 'stale');
healthProbe.pendingTask = null;
healthProbe.stopping = true;
assert.equal((await healthProbe.healthCheck()).connectionState, 'stopping');

class PendingRuntime extends BrowserOriginalRuntimeBridge {
    constructor() {
        super({
            chromePath: process.execPath,
            logger: quietLogger(),
        });
        this.started = createDeferred();
        this.generation = createDeferred();
        this.unsafeCalls = 0;
        this.requestOriginalStopCalls = 0;
        this.closeCalls = 0;
    }

    async generateReplyUnsafe(request) {
        this.unsafeCalls += 1;
        this.started.resolve(request);
        return this.generation.promise;
    }

    async requestOriginalStop() {
        this.requestOriginalStopCalls += 1;
    }

    close() {
        this.closeCalls += 1;
        this.chrome = null;
        this.browser = null;
        this.targetId = null;
        this.sessionId = null;
    }
}

class ProviderRetryRuntime extends BrowserOriginalRuntimeBridge {
    constructor() {
        super({
            chromePath: process.execPath,
            providerRetryDelaysMs: [1],
            logger: quietLogger(),
        });
        this.evaluations = 0;
    }

    async ensurePage() {}

    async evaluate() {
        this.evaluations += 1;
        if (this.evaluations === 1) {
            return {
                ok: false,
                errorCode: 'Got_response_status_502',
                elapsedMs: 25,
                errorMessage: 'Got response status 502',
                runtimeState: {
                    chatId: targetChatId,
                    targetChatId,
                },
            };
        }
        return {
            ok: true,
            chatId: targetChatId,
            generatedText: '第二次请求成功。',
            rawChat: [
                { chat_metadata: { world_info: 'Galgame_Test_Aoi_RainTown_Bundle' } },
                { name: 'Player', is_user: true, mes: '继续', extra: {} },
                { name: '青井', is_user: false, mes: '第二次请求成功。', extra: {} },
            ],
            diagnostics: {
                targetAfter: {
                    count: 2,
                },
            },
        };
    }
}

class NonRetryableBindingRuntime extends BrowserOriginalRuntimeBridge {
    constructor() {
        super({
            chromePath: process.execPath,
            providerRetryDelaysMs: [1],
            logger: quietLogger(),
        });
        this.evaluations = 0;
    }

    async ensurePage() {}

    async evaluate() {
        this.evaluations += 1;
        return {
            ok: false,
            errorCode: 'ORIGINAL_TARGET_CHAT_BINDING_TIMEOUT',
            elapsedMs: 10,
            errorMessage: 'ORIGINAL_TARGET_CHAT_BINDING_TIMEOUT',
        };
    }
}

assert.throws(
    () => createOriginalRuntimeBridgeServer({
        host: '0.0.0.0',
        proofSecret,
        logger: quietLogger(),
    }),
    /GALGAME_BRIDGE_AUTH_REQUIRED_FOR_NON_LOOPBACK/,
);

await runTargetChatReloadGuard();

const calls = [];
const warnings = [];
const fakeRuntime = {
    stopping: false,
    failNext: false,
    async healthCheck() {
        return {
            ok: true,
            fake: true,
        };
    },
    getStatus() {
        return {
            stopping: this.stopping,
            pending: false,
            pendingSinceMs: 0,
        };
    },
    isStopping() {
        return this.stopping;
    },
    async stop() {
        this.stopping = true;
        return {
            stopped: true,
            forced: false,
            stopMode: 'idle',
            stopRequested: true,
            hadPendingTask: false,
            pendingTaskFailed: false,
            pendingCleared: true,
        };
    },
    async generateReply(request) {
        calls.push(request);
        if (this.failNext) {
            this.failNext = false;
            const error = new Error(`Bearer ${authToken} token=${proofSecret}`);
            error.details = {
                token: proofSecret,
                authorization: `Bearer ${authToken}`,
                nested: {
                    apiKey: proofSecret,
                },
            };
            throw error;
        }
        return {
            chatId: request.chatId,
            generatedText: '雨声停了一瞬，她终于开口。',
            rawChat: [
                {
                    chat_metadata: {
                        world_info: 'Galgame_Test_Aoi_RainTown_Bundle',
                    },
                    user_name: 'unused',
                    character_name: 'unused',
                },
                {
                    name: 'Player',
                    is_user: true,
                    is_system: false,
                    send_date: '2026-07-24T15:00:00.000Z',
                    mes: '你好，我来了',
                    extra: {},
                },
                {
                    name: '青井',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-07-24T15:01:00.000Z',
                    mes: '雨声停了一瞬，她终于开口。',
                    extra: {},
                },
            ],
        };
    },
};

const server = createOriginalRuntimeBridgeServer({
    runtime: fakeRuntime,
    allowedOrigins: ['http://127.0.0.1:8000'],
    authToken,
    proofSecret,
    providerSettingsReader: () => ({
        provider: 'claude',
        model: 'claude-sonnet-4-6',
        reverseProxy: 'https://proxy.example.test/v1',
        proxyPassword: 'test-secret-must-not-leak',
    }),
    fetchImpl: async (url, options) => {
        assert.equal(String(url), 'https://proxy.example.test/v1/messages');
        assert.equal(options.headers['anthropic-version'], '2023-06-01');
        assert.equal(options.headers['x-api-key'], 'test-secret-must-not-leak');
        const request = JSON.parse(options.body);
        assert.equal(request.model, 'claude-sonnet-4-6');
        assert.equal(request.max_tokens, 8);
        assert.deepEqual(request.messages, [{ role: 'user', content: 'Reply with OK.' }]);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    },
    logger: {
        warn(...args) {
            warnings.push(args);
        },
    },
});

await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
});

try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const optionsResponse = await fetch(`${baseUrl}/v1/generate-reply`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://127.0.0.1:8001',
        },
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get('access-control-allow-origin'), null);
    assert.equal(optionsResponse.headers.get('access-control-allow-headers'), 'Content-Type, Authorization');

    const unauthenticated = await postGenerate(baseUrl, {
        body: validGenerateBody({ bridgeProof: signedProof() }),
    });
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).errorCode, 'BRIDGE_AUTH_REQUIRED');

    const health = await fetch(`${baseUrl}/health`, {
        headers: authHeaders(),
    }).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.mode, 'sillytavern-original-runtime-bridge');
    assert.equal(health.authRequired, true);
    assert.equal(health.proofRequired, true);
    assert.equal(health.proofConfigured, true);

    const llmHealthResponse = await fetch(`${baseUrl}/v1/llm-health`, {
        method: 'POST',
        headers: { ...authHeaders(), Origin: 'http://127.0.0.1:8000', 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 'galgame.llm-health.v1' }),
    });
    assert.equal(llmHealthResponse.status, 200);
    const llmHealth = await llmHealthResponse.json();
    assert.deepEqual(Object.keys(llmHealth).sort(), ['checkedAt', 'errorCode', 'latencyMs', 'model', 'ok', 'protocolVersion', 'provider'].sort());
    assert.equal(llmHealth.ok, true);
    assert.equal(llmHealth.provider, 'claude');
    assert.equal(llmHealth.model, 'claude-sonnet-4-6');
    assert.equal(JSON.stringify(llmHealth).includes('test-secret'), false);
    assert.equal(JSON.stringify(llmHealth).includes('OK'), false);

    const llmHealthForbiddenOrigin = await fetch(`${baseUrl}/v1/llm-health`, {
        method: 'POST',
        headers: { ...authHeaders(), Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 'galgame.llm-health.v1' }),
    });
    assert.equal(llmHealthForbiddenOrigin.status, 403);
    assert.equal((await llmHealthForbiddenOrigin.json()).errorCode, 'LLM_HEALTH_ORIGIN_NOT_ALLOWED');

    const retiredOrigin = await fetch(`${baseUrl}/v1/llm-health`, {
        method: 'POST',
        headers: { ...authHeaders(), Origin: 'http://127.0.0.1:8001', 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 'galgame.llm-health.v1' }),
    });
    assert.equal(retiredOrigin.status, 403);
    assert.equal((await retiredOrigin.json()).errorCode, 'LLM_HEALTH_ORIGIN_NOT_ALLOWED');

    const llmHealthSimpleRequest = await fetch(`${baseUrl}/v1/llm-health`, {
        method: 'POST',
        headers: { ...authHeaders(), Origin: 'http://127.0.0.1:8000', 'Content-Type': 'text/plain' },
        body: JSON.stringify({ protocolVersion: 'galgame.llm-health.v1' }),
    });
    assert.equal(llmHealthSimpleRequest.status, 415);
    assert.equal((await llmHealthSimpleRequest.json()).errorCode, 'LLM_HEALTH_CONTENT_TYPE_REQUIRED');

    const badLlmHealthProtocol = await fetch(`${baseUrl}/v1/llm-health`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ protocolVersion: 'wrong' }),
    });
    assert.equal(badLlmHealthProtocol.status, 400);
    assert.equal((await badLlmHealthProtocol.json()).errorCode, 'LLM_HEALTH_PROTOCOL_INVALID');

    const invalid = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: { chatId: 'missing-character' },
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).errorCode, 'CHARACTER_AVATAR_REQUIRED');

    const missingProof = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            bridgeProof: null,
            bridgeBinding: {
                release: binding.release,
                target: binding.target,
                chat: binding.chat,
            },
        }),
    });
    assert.equal(missingProof.status, 400);
    assert.equal((await missingProof.json()).errorCode, 'BRIDGE_PROOF_REQUIRED');

    const missingReleaseArc = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            releaseId: '',
            arcId: '',
            bridgeProof: signedProof({
                nonce: 'missing-release-arc',
                bindingOverride: {
                    ...binding,
                    release: {
                        ...binding.release,
                        releaseId: '',
                        arcId: '',
                    },
                },
            }),
        }),
    });
    assert.equal(missingReleaseArc.status, 400);
    assert.equal((await missingReleaseArc.json()).errorCode, 'BRIDGE_RELEASE_BINDING_REQUIRED');

    const generatedResponse = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'valid-once' }) }),
    });
    assert.equal(generatedResponse.status, 200);
    const generated = await generatedResponse.json();
    assert.equal(generated.ok, true);
    assert.equal(generated.chatId, targetChatId);
    assert.equal(generated.generatedText, '雨声停了一瞬，她终于开口。');
    assert.equal(generated.rawChat.length, 3);
    assert.equal(generated.diagnostics.bridgeAuthorization.decision, 'allowed');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].avatar, 'galgame_test_aoi.png');
    assert.equal(calls[0].chatId, targetChatId);
    assert.equal(calls[0].sillyTavernBaseUrl, 'http://127.0.0.1:8001');
    assert.deepEqual(calls[0].runtimeWorldBookRefs, ['Galgame_Test_Aoi_RainTown_Bundle']);

    const replayed = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'valid-once' }) }),
    });
    assert.equal(replayed.status, 400);
    assert.equal((await replayed.json()).errorCode, 'BRIDGE_PROOF_REPLAYED');

    const forgedProof = signedProof({ nonce: 'forged-proof' });
    forgedProof.binding.target.avatar = 'attacker.png';
    const forged = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({ bridgeProof: forgedProof }),
    });
    assert.equal(forged.status, 400);
    assert.equal((await forged.json()).errorCode, 'BRIDGE_PROOF_SIGNATURE_INVALID');

    const expired = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            bridgeProof: signedProof({
                nonce: 'expired-proof',
                issuedAt: new Date('2026-07-24T00:00:00.000Z'),
                ttlMs: 1000,
            }),
        }),
    });
    assert.equal(expired.status, 400);
    assert.equal((await expired.json()).errorCode, 'BRIDGE_PROOF_EXPIRED');

    const wrongAvatar = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            bridgeProof: signedProof({ nonce: 'wrong-avatar' }),
            character: {
                id: 'Galgame_Test_Aoi',
                avatar: 'attacker.png',
            },
        }),
    });
    assert.equal(wrongAvatar.status, 400);
    assert.equal((await wrongAvatar.json()).errorCode, 'BRIDGE_CHARACTER_NOT_ALLOWED');

    const wrongChat = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            bridgeProof: signedProof({ nonce: 'wrong-chat' }),
            chatId: 'attacker-chat',
        }),
    });
    assert.equal(wrongChat.status, 400);
    assert.equal((await wrongChat.json()).errorCode, 'BRIDGE_CHAT_BINDING_MISMATCH');

    const crossRelease = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({
            bridgeProof: signedProof({ nonce: 'cross-release' }),
            releaseId: 'rel_other_arc',
        }),
    });
    assert.equal(crossRelease.status, 400);
    assert.equal((await crossRelease.json()).errorCode, 'BRIDGE_RELEASE_INDEX_MISMATCH');

    fakeRuntime.failNext = true;
    const failedRuntime = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'runtime-failure' }) }),
    });
    assert.equal(failedRuntime.status, 500);
    const failedBody = await failedRuntime.json();
    assert.equal(failedBody.ok, false);
    assert.equal(JSON.stringify(failedBody).includes(authToken), false);
    assert.equal(JSON.stringify(failedBody).includes(proofSecret), false);
    assert.equal(JSON.stringify(warnings).includes(authToken), false);
    assert.equal(JSON.stringify(warnings).includes(proofSecret), false);

    const stopped = await fetch(`${baseUrl}/v1/stop`, {
        method: 'POST',
        headers: authHeaders(),
    }).then((response) => response.json());
    assert.equal(stopped.ok, true);
    assert.equal(stopped.stopping, true);
    assert.equal(stopped.pendingCleared, true);
    assert.equal(stopped.forced, false);
    assert.equal(stopped.hadPendingTask, false);

    const callCountBeforeStoppedGenerate = calls.length;
    const stoppedGenerate = await postGenerate(baseUrl, {
        headers: authHeaders(),
        body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'after-stop' }) }),
    });
    assert.equal(stoppedGenerate.status, 503);
    assert.equal((await stoppedGenerate.json()).errorCode, 'BRIDGE_STOPPING');
    assert.equal(calls.length, callCountBeforeStoppedGenerate);

    await runPendingGenerationStopRegression();
    await runShutdownGateRegression();
    await runProviderRetryRegression();
    await runNonRetryableBindingRegression();

    console.log('original runtime bridge security tests passed');
} finally {
    await new Promise((resolve) => server.close(resolve));
}

const failedLlmProbe = await probeConfiguredLlm({
    settings: {
        provider: 'claude', model: 'claude-sonnet-4-6',
        reverseProxy: 'https://proxy.example.test/v1', proxyPassword: 'secret-not-to-return',
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'secret-not-to-return upstream internal detail' } }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
    }),
});
assert.equal(failedLlmProbe.ok, false);
assert.equal(failedLlmProbe.errorCode, 'LLM_UPSTREAM_HTTP_401');
assert.equal(JSON.stringify(failedLlmProbe).includes('secret-not-to-return'), false);

async function runPendingGenerationStopRegression() {
    const pendingRuntime = new PendingRuntime();
    const pendingServer = createOriginalRuntimeBridgeServer({
        runtime: pendingRuntime,
        allowedOrigins: ['http://127.0.0.1:8000'],
        authToken,
        proofSecret,
        logger: quietLogger(),
    });
    await new Promise((resolve, reject) => {
        pendingServer.once('error', reject);
        pendingServer.listen(0, '127.0.0.1', resolve);
    });

    try {
        const { port } = pendingServer.address();
        const baseUrl = `http://127.0.0.1:${port}`;
        const generationResponsePromise = postGenerate(baseUrl, {
            headers: authHeaders(),
            body: validGenerateBody({
                bridgeProof: signedProof({ nonce: 'pending-stop-generate' }),
                timeoutMs: 30000,
            }),
        });
        await pendingRuntime.started.promise;
        assert.equal(pendingRuntime.unsafeCalls, 1);
        assert.equal(pendingRuntime.requestOriginalStopCalls, 0);

        const stopResponse = await fetch(`${baseUrl}/v1/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(),
            },
            body: JSON.stringify({ timeoutMs: 10 }),
        });
        assert.equal(stopResponse.status, 200);
        const stopBody = await stopResponse.json();
        assert.equal(stopBody.ok, true);
        assert.equal(stopBody.stopping, true);
        assert.equal(stopBody.hadPendingTask, true);
        assert.equal(stopBody.pendingTaskFailed, true);
        assert.equal(stopBody.pendingCleared, true);
        assert.equal(stopBody.forced, true);
        assert.equal(stopBody.stopRequested, true);
        assert.equal(stopBody.stopMode, 'forced-timeout');
        assert.equal(stopBody.errorCode, 'BRIDGE_STOP_TIMEOUT');
        assert.equal(stopBody.pending, false);
        assert.equal(pendingRuntime.requestOriginalStopCalls, 1);
        assert.equal(pendingRuntime.closeCalls, 1);

        const generationResponse = await generationResponsePromise;
        assert.equal(generationResponse.status, 500);
        const generationBody = await generationResponse.json();
        assert.equal(generationBody.ok, false);
        assert.equal(generationBody.errorCode, 'BRIDGE_STOP_TIMEOUT');

        pendingRuntime.generation.resolve({
            ok: true,
            chatId: targetChatId,
            generatedText: 'this late success must be ignored',
            rawChat: [],
        });
        await delay(20);
        assert.equal(pendingRuntime.unsafeCalls, 1);

        const stoppedGenerate = await postGenerate(baseUrl, {
            headers: authHeaders(),
            body: validGenerateBody({
                bridgeProof: signedProof({ nonce: 'after-pending-stop' }),
            }),
        });
        assert.equal(stoppedGenerate.status, 503);
        assert.equal((await stoppedGenerate.json()).errorCode, 'BRIDGE_STOPPING');
        assert.equal(pendingRuntime.unsafeCalls, 1);
    } finally {
        await new Promise((resolve) => pendingServer.close(resolve));
    }
}

async function runShutdownGateRegression() {
    let nowMs = 1_000;
    const gateRuntime = {
        unsafeCalls: 0,
        getStatus: () => ({ pending: false, stale: false, stopping: false }),
        healthCheck: async () => ({ ok: true, ready: true }),
        isStopping: () => false,
        async generateReply() {
            this.unsafeCalls += 1;
            return { chatId: targetChatId, generatedText: 'lease expired safely', diagnostics: {} };
        },
    };
    const gateServer = createOriginalRuntimeBridgeServer({
        runtime: gateRuntime,
        allowedOrigins: ['http://127.0.0.1:8000'],
        authToken,
        proofSecret,
        logger: quietLogger(),
        shutdownGateTtlMs: 2_000,
        now: () => nowMs,
    });
    await new Promise((resolve, reject) => {
        gateServer.once('error', reject);
        gateServer.listen(0, '127.0.0.1', resolve);
    });
    try {
        const baseUrl = `http://127.0.0.1:${gateServer.address().port}`;
        const gateRequest = (body) => fetch(`${baseUrl}${body.action === 'release' ? '/v1/shutdown-gate/release' : '/v1/shutdown-gate'}`, {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        const protocolVersion = 'galgame.original-runtime-shutdown-gate.v1';
        const acquired = await gateRequest({ protocolVersion, action: 'acquire' });
        assert.equal(acquired.status, 200);
        const lease = await acquired.json();
        assert.equal(lease.shutdownGate, true);
        const renewRequest = (gateId) => fetch(`${baseUrl}/v1/shutdown-gate/renew`, {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocolVersion, action: 'renew', gateId }),
        });
        assert.equal((await renewRequest('another-owner')).status, 409, 'only the owner gate id can renew a shutdown lease');
        nowMs += 1_500;
        const renewed = await renewRequest(lease.gateId);
        assert.equal(renewed.status, 200);
        assert.equal((await renewed.json()).renewed, true);
        nowMs += 600;
        const health = await fetch(`${baseUrl}/health`, { headers: authHeaders() }).then((response) => response.json());
        assert.equal(health.shutdownGate, true, 'renewal extends the gate beyond its original expiry');
        assert.equal(health.ready, false);
        const gatedGeneration = await postGenerate(baseUrl, {
            headers: authHeaders(),
            body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'shutdown-gate-blocks-generation' }) }),
        });
        assert.equal(gatedGeneration.status, 503);
        assert.equal((await gatedGeneration.json()).errorCode, 'BRIDGE_SHUTDOWN_IN_PROGRESS');
        assert.equal(gateRuntime.unsafeCalls, 0, 'generation cannot enter runtime while shutdown lease is held');
        const gatedStop = await fetch(`${baseUrl}/v1/stop`, {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ timeoutMs: 1 }),
        });
        assert.equal(gatedStop.status, 409, 'a competing stop request cannot mutate bridge state under the shutdown lease');

        const wrongRelease = await gateRequest({ protocolVersion, action: 'release', gateId: 'wrong-lease' });
        assert.equal(wrongRelease.status, 409);
        assert.equal((await wrongRelease.json()).errorCode, 'BRIDGE_SHUTDOWN_GATE_MISMATCH');
        const released = await gateRequest({ protocolVersion, action: 'release', gateId: lease.gateId });
        assert.equal(released.status, 200);
        assert.equal((await released.json()).released, true);
        const afterRelease = await fetch(`${baseUrl}/health`, { headers: authHeaders() }).then((response) => response.json());
        assert.equal(afterRelease.shutdownGate, false);
        assert.equal(afterRelease.ready, true);

        const abandonedAcquire = await gateRequest({ protocolVersion, action: 'acquire' });
        assert.equal(abandonedAcquire.status, 200);
        const abandonedLease = await abandonedAcquire.json();
        assert.equal(abandonedLease.shutdownGate, true);
        nowMs += 2_001;
        const recoveredHealth = await fetch(`${baseUrl}/health`, { headers: authHeaders() }).then((response) => response.json());
        assert.equal(recoveredHealth.shutdownGate, false, 'expired shutdown leases are lazily cleared by health checks');
        const generationAfterExpiry = await postGenerate(baseUrl, {
            headers: authHeaders(),
            body: validGenerateBody({ bridgeProof: signedProof({ nonce: 'expired-shutdown-gate-allows-generation' }) }),
        });
        assert.equal(generationAfterExpiry.status, 200, 'a crashed supervisor cannot strand the runtime after lease expiry');
        assert.equal(gateRuntime.unsafeCalls, 1);
    } finally {
        await new Promise((resolve) => gateServer.close(resolve));
    }

    const stopAdmissionRuntime = {
        stopCalls: 0,
        getStatus: () => ({ pending: false, stale: false, stopping: false }),
        healthCheck: async () => ({ ok: true, ready: true }),
        isStopping: () => false,
        async stop() { this.stopCalls += 1; return { stopped: true }; },
    };
    const slowStopServer = createOriginalRuntimeBridgeServer({
        runtime: stopAdmissionRuntime,
        allowedOrigins: ['http://127.0.0.1:8000'],
        authToken,
        proofSecret,
        logger: quietLogger(),
    });
    await new Promise((resolve, reject) => {
        slowStopServer.once('error', reject);
        slowStopServer.listen(0, '127.0.0.1', resolve);
    });
    try {
        const baseUrl = `http://127.0.0.1:${slowStopServer.address().port}`;
        const body = JSON.stringify({ timeoutMs: 10 });
        const pendingStop = httpRequest(baseUrl, {
            method: 'POST',
            path: '/v1/stop',
            headers: { ...authHeaders(), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        });
        const stopResult = new Promise((resolve, reject) => {
            pendingStop.once('response', (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
            });
            pendingStop.once('error', reject);
        });
        pendingStop.write('{');
        await new Promise((resolve) => setImmediate(resolve));
        const gateResponse = await fetch(`${baseUrl}/v1/shutdown-gate`, {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', action: 'acquire' }),
        });
        assert.equal(gateResponse.status, 409, 'shutdown gate cannot overtake a stop request with a slow body');
        assert.equal((await gateResponse.json()).errorCode, 'BRIDGE_SHUTDOWN_GATE_BUSY');
        pendingStop.end(body.slice(1));
        const stopped = await stopResult;
        assert.equal(stopped.status, 200);
        assert.equal(stopAdmissionRuntime.stopCalls, 1);
        const gateAfterStop = await fetch(`${baseUrl}/v1/shutdown-gate`, {
            method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocolVersion: 'galgame.original-runtime-shutdown-gate.v1', action: 'acquire' }),
        });
        assert.equal(gateAfterStop.status, 200, 'gate acquisition is available after the admitted stop finishes');
    } finally {
        await new Promise((resolve) => slowStopServer.close(resolve));
    }
}

async function runProviderRetryRegression() {
    const retryRuntime = new ProviderRetryRuntime();
    const result = await retryRuntime.generateReplyUnsafe({
        sillyTavernBaseUrl: 'http://127.0.0.1:8001',
        avatar: binding.target.avatar,
        chatId: targetChatId,
        runtimeWorldBookRefs: binding.resources.worldBookRefs,
        timeoutMs: 30000,
    });
    assert.equal(retryRuntime.evaluations, 2);
    assert.equal(result.ok, true);
    assert.equal(result.generatedText, '第二次请求成功。');
    assert.equal(result.diagnostics.providerRetryAttempts, 1);
    assert.deepEqual(result.diagnostics.providerRetryErrorCodes, ['Got_response_status_502']);
}

async function runNonRetryableBindingRegression() {
    const runtime = new NonRetryableBindingRuntime();
    await assert.rejects(
        () => runtime.generateReplyUnsafe({
            sillyTavernBaseUrl: 'http://127.0.0.1:8001',
            avatar: binding.target.avatar,
            chatId: targetChatId,
            runtimeWorldBookRefs: binding.resources.worldBookRefs,
            timeoutMs: 30000,
        }),
        /ORIGINAL_TARGET_CHAT_BINDING_TIMEOUT/,
    );
    assert.equal(runtime.evaluations, 1);
}

async function runTargetChatReloadGuard() {
    const source = await readFile(new URL('./server.mjs', import.meta.url), 'utf8');
    assert.match(source, /forceReloadTargetChatFromReadback/);
    assert.match(source, /reloadCurrentChat/);
    assert.match(source, /loadItemizedPrompts/);
    assert.match(source, /currentMatchesTargetBeforeGeneration\(\)/);
}

function signedProof({ nonce = randomUUID(), issuedAt = new Date(), ttlMs = 300000, bindingOverride = binding } = {}) {
    return createSignedBridgeProof({
        secret: proofSecret,
        binding: bindingOverride,
        nonce,
        issuedAt,
        ttlMs,
    });
}

function validGenerateBody(overrides = {}) {
    return {
        protocolVersion: 'galgame.original-runtime-bridge-request.v1',
        requestId: randomUUID(),
        sillyTavernBaseUrl: 'http://127.0.0.1:8001',
        releaseId: binding.release.releaseId,
        scenarioId: binding.release.scenarioId,
        scenarioVersion: binding.release.scenarioVersion,
        arcId: binding.release.arcId,
        character: {
            id: binding.target.characterId,
            avatar: binding.target.avatar,
        },
        chatId: targetChatId,
        bridgeProof: signedProof(),
        timeoutMs: 30000,
        ...overrides,
    };
}

async function postGenerate(baseUrl, { headers = {}, body } = {}) {
    return fetch(`${baseUrl}/v1/generate-reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:8000',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

function authHeaders() {
    return {
        Authorization: `Bearer ${authToken}`,
    };
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
    });
    return {
        promise,
        resolve,
        reject,
    };
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function quietLogger() {
    return {
        warn() {},
    };
}
