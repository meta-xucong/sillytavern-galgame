import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryConfigStore, createConfigService } from '../game-config-service/server.mjs';
import {
    createOriginalRuntimeBridgeServer,
    createSignedBridgeProof,
} from './server.mjs';

const repoRoot = new URL('../../', import.meta.url);
const sharedProofSecret = 'startup-contract-test-secret';
const targetChatId = 'galgame-startup-contract-chat';

const launcherRoot = new URL('external-modules/process-supervisor/launchers/', repoRoot);
const configScript = await readFile(new URL('StartGalgameConfigService.cmd', launcherRoot), 'utf8');
const bridgeScript = await readFile(new URL('StartGalgameRuntimeBridge.cmd', launcherRoot), 'utf8');
const servicesScript = await readFile(new URL('StartGalgameServices.cmd', launcherRoot), 'utf8');

assert.match(configScript, /set "SILLYTAVERN_BASE_URL=http:\/\/127\.0\.0\.1:8001"/);
assert.match(configScript, /set "GALGAME_SILLYTAVERN_BASE_URL=http:\/\/127\.0\.0\.1:8001"/);
assert.match(bridgeScript, /set "SILLYTAVERN_BASE_URL=http:\/\/127\.0\.0\.1:8001"/);
assert.match(bridgeScript, /set "GALGAME_SILLYTAVERN_BASE_URL=http:\/\/127\.0\.0\.1:8001"/);
assert.match(configScript, /http:\/\/127\.0\.0\.1:8001,http:\/\/localhost:8001/);
assert.match(bridgeScript, /http:\/\/127\.0\.0\.1:8001,http:\/\/localhost:8001/);
assert.match(configScript, /GALGAME_COMPUTERNAME_LOWER/);
assert.match(bridgeScript, /GALGAME_COMPUTERNAME_LOWER/);
const visualScript = await readFile(new URL('StartGalgameVisualAssetService.cmd', launcherRoot), 'utf8');
assert.match(visualScript, /GALGAME_VISUAL_CORE_PLAYER_ORIGINS/);
assert.match(visualScript, /GALGAME_COMPUTERNAME_LOWER/);
assert.match(servicesScript, /VerifyGalgameServices\.ps1/);
const servicesHealthScript = await readFile(new URL('VerifyGalgameServices.ps1', launcherRoot), 'utf8');
assert.match(servicesHealthScript, /Uri = 'http:\/\/127\.0\.0\.1:8001\/'/);
assert.match(servicesHealthScript, /runtimeProof\.configured -eq \$true/);
assert.match(servicesHealthScript, /proofRequired -eq \$true -and \$body\.proofConfigured -eq \$true/);
assert.match(configScript, /set \/p GALGAME_BRIDGE_PROOF_SECRET=<"%SECRET_FILE%"/);
assert.match(bridgeScript, /set \/p GALGAME_BRIDGE_PROOF_SECRET=<"%SECRET_FILE%"/);
assert.match(configScript, /if not defined GALGAME_BRIDGE_PROOF_SECRET/);
assert.match(bridgeScript, /if not defined GALGAME_BRIDGE_PROOF_SECRET/);
assert.match(bridgeScript, /original-runtime-bridge-chrome/);
assert.equal(configScript.includes('GALGAME_BRIDGE_PROOF_SECRET=' + sharedProofSecret), false);
assert.equal(bridgeScript.includes('GALGAME_BRIDGE_PROOF_SECRET=' + sharedProofSecret), false);

const configServer = createConfigService({
    store: new MemoryConfigStore(),
    corsOrigin: 'http://127.0.0.1:8001',
    proofSecret: sharedProofSecret,
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
});
await listen(configServer);
try {
    const configBaseUrl = serverUrl(configServer);
    const health = await fetch(`${configBaseUrl}/v1/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.deepEqual(health.runtimeProof, { configured: true });
} finally {
    await close(configServer);
}

const unconfiguredConfigServer = createConfigService({
    store: new MemoryConfigStore(),
    corsOrigin: 'http://127.0.0.1:8001',
    proofSecret: '',
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
});
await listen(unconfiguredConfigServer);
try {
    const configBaseUrl = serverUrl(unconfiguredConfigServer);
    const healthResponse = await fetch(`${configBaseUrl}/v1/health`);
    const health = await healthResponse.json();
    assert.equal(health.runtimeProof.configured, false);
    const proofResponse = await fetch(`${configBaseUrl}/v1/runtime-bridge/proofs`, { method: 'POST' });
    assert.equal(proofResponse.status, 503);
    assert.equal((await proofResponse.json()).error, 'BRIDGE_PROOF_ISSUER_UNCONFIGURED');
} finally {
    await close(unconfiguredConfigServer);
}

let forwardedRequest = null;
const bridgeRuntime = {
    async healthCheck() {
        return { ok: true, browser: false };
    },
    async generateReply(request) {
        forwardedRequest = request;
        return {
            ok: true,
            chatId: targetChatId,
            generatedText: 'contract test',
            rawChat: [],
        };
    },
};
const bridgeServer = createOriginalRuntimeBridgeServer({
    runtime: bridgeRuntime,
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
    allowedOrigins: ['http://127.0.0.1:8001'],
    proofSecret: sharedProofSecret,
});
await listen(bridgeServer);
try {
    const bridgeBaseUrl = serverUrl(bridgeServer);
    const bridgeHealth = await fetch(`${bridgeBaseUrl}/health`).then((response) => response.json());
    assert.equal(bridgeHealth.ok, true);
    assert.equal(bridgeHealth.proofRequired, true);
    assert.equal(bridgeHealth.proofConfigured, true);

    const binding = {
        release: {
            releaseId: 'rel_startup_contract',
            scenarioId: 'scenario_startup_contract',
            scenarioVersion: '1.0.0',
            arcId: 'arc1',
            arcVersion: '1.0.0',
        },
        target: {
            type: 'character',
            characterId: 'character_startup_contract',
            avatar: 'character.png',
        },
        chat: {
            chatId: targetChatId,
            chatSeedId: 'galgame-startup-contract-seed',
            allowedChatIds: [targetChatId],
        },
        resources: {
            worldBookRefs: [],
            worldBookApplication: 'none',
        },
    };
    const bridgeProof = createSignedBridgeProof({
        secret: sharedProofSecret,
        binding,
        nonce: 'startup-contract-nonce',
    });
    const response = await fetch(`${bridgeBaseUrl}/v1/generate-reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:8001',
        },
        body: JSON.stringify({
            protocolVersion: 'galgame.original-runtime-bridge-request.v1',
            requestId: 'startup-contract-request',
            releaseId: binding.release.releaseId,
            scenarioId: binding.release.scenarioId,
            scenarioVersion: binding.release.scenarioVersion,
            arcId: binding.release.arcId,
            character: binding.target,
            chatId: targetChatId,
            bridgeProof,
        }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal(forwardedRequest.sillyTavernBaseUrl, 'http://127.0.0.1:8001');
} finally {
    await close(bridgeServer);
}

const busyBridge = createOriginalRuntimeBridgeServer({
    runtime: {
        async healthCheck() { return { ok: true, browser: true }; },
        getStatus() { return { ready: false, pending: true, connectionState: 'generating' }; },
    },
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
    allowedOrigins: ['http://127.0.0.1:8001'],
    proofSecret: sharedProofSecret,
});
await listen(busyBridge);
try {
    const busyHealth = await fetch(`${serverUrl(busyBridge)}/health`).then((response) => response.json());
    assert.equal(busyHealth.ready, false);
    assert.equal(busyHealth.connectionState, 'generating');
    assert.equal(busyHealth.ok, false);
} finally {
    await close(busyBridge);
}

const unconfiguredBridge = createOriginalRuntimeBridgeServer({
    runtime: bridgeRuntime,
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
    allowedOrigins: ['http://127.0.0.1:8001'],
    proofSecret: '',
});
await listen(unconfiguredBridge);
try {
    const bridgeBaseUrl = serverUrl(unconfiguredBridge);
    const unconfiguredHealth = await fetch(bridgeBaseUrl + '/health').then((response) => response.json());
    assert.equal(unconfiguredHealth.proofRequired, true);
    assert.equal(unconfiguredHealth.proofConfigured, false);
    const response = await fetch(`${bridgeBaseUrl}/v1/generate-reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:8001',
        },
        body: JSON.stringify({
            character: { avatar: 'character.png' },
            chatId: targetChatId,
            bridgeProof: {},
        }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).errorCode, 'BRIDGE_PROOF_SECRET_REQUIRED');
} finally {
    await close(unconfiguredBridge);
}

console.log('startup contract tests passed');

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
}

function close(server) {
    return new Promise((resolve) => server.close(resolve));
}

function serverUrl(server) {
    return `http://127.0.0.1:${server.address().port}`;
}
