import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
    BrowserOriginalRuntimeBridge,
    createOriginalRuntimeBridgeServer,
    createSignedBridgeProof,
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
    allowedOrigins: ['http://127.0.0.1:8001'],
    authToken,
    proofSecret,
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
    assert.equal(optionsResponse.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8001');
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
    await runProviderRetryRegression();
    await runNonRetryableBindingRegression();

    console.log('original runtime bridge security tests passed');
} finally {
    await new Promise((resolve) => server.close(resolve));
}

async function runPendingGenerationStopRegression() {
    const pendingRuntime = new PendingRuntime();
    const pendingServer = createOriginalRuntimeBridgeServer({
        runtime: pendingRuntime,
        allowedOrigins: ['http://127.0.0.1:8001'],
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
            Origin: 'http://127.0.0.1:8001',
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
