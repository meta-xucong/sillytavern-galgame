import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import { bindAdaptivePresentationProfileHashes } from '../shared/src/protocol.js';
import {
    createConfigService,
    MemoryConfigStore,
} from '../../external-modules/game-config-service/server.mjs';
import { createOriginalRuntimeBridgeServer } from '../../external-modules/original-runtime-bridge/server.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidenceDir = path.join(repoRoot, '.codex-longrun', 'evidence');
const serviceEvidencePath = path.join(evidenceDir, 'runtime-c0-services.json');
const smokeEvidencePath = path.join(evidenceDir, 'runtime-c0-browser-smoke.json');
const configPort = 8791;
const bridgePort = 8795;
const sillyTavernBaseUrl = 'http://127.0.0.1:8001';
const playerBaseUrl = sillyTavernBaseUrl;
const proofSecret = randomUUID();
const demoScenario = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO);

await mkdir(evidenceDir, { recursive: true });

const store = new MemoryConfigStore();
const configService = createConfigService({
    store,
    proofSecret,
    sillyTavernBaseUrl,
    corsOrigin: playerBaseUrl,
});
const runtimeBridge = createOriginalRuntimeBridgeServer({
    proofSecret,
    sillyTavernBaseUrl,
    logger: quietLogger(),
});

try {
    await listen(configService, configPort);
    await listen(runtimeBridge, bridgePort);

    const configBaseUrl = `http://127.0.0.1:${configPort}`;
    const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
    await postJson(`${configBaseUrl}/v1/admin/scenarios/import`, { manifest: demoScenario });
    const publish = await postJson(`${configBaseUrl}/v1/admin/releases`, {
        scenarioId: demoScenario.id,
        scenarioVersion: demoScenario.version,
    });
    assert.equal(publish.ok, true);

    const configHealth = await getJson(`${configBaseUrl}/v1/admin/health`);
    const activeRelease = await getJson(`${configBaseUrl}/v1/releases/active`);
    const bridgeHealth = await getJson(`${bridgeBaseUrl}/health`);
    assert.equal(configHealth.ok, true);
    assert.equal(configHealth.active, true);
    assert.equal(activeRelease.scenarioId, demoScenario.id);
    assert.equal(bridgeHealth.ok, true);
    assert.equal(bridgeHealth.proofRequired, true);

    await writeFile(serviceEvidencePath, JSON.stringify({
        ok: true,
        generatedAt: new Date().toISOString(),
        configBaseUrl,
        bridgeBaseUrl,
        playerBaseUrl,
        configHealth,
        bridgeHealth,
        activeRelease,
        proofSecretStoredInFrontend: false,
    }, null, 2), 'utf8');

    const { stdout, stderr } = await execFileAsync(process.execPath, [
        'frontend/tools/browser-smoke-narrow.mjs',
        '--base-url',
        playerBaseUrl,
        '--player-only',
        'true',
        '--runtime-reply-smoke',
        'true',
    ], {
        cwd: repoRoot,
        timeout: 8 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const smoke = JSON.parse(stdout);
    await writeFile(smokeEvidencePath, JSON.stringify({
        ok: smoke.ok,
        generatedAt: new Date().toISOString(),
        command: 'node frontend/tools/browser-smoke-narrow.mjs --base-url http://127.0.0.1:8001 --player-only true --runtime-reply-smoke true',
        stdout: smoke,
        stderr: stderr.trim(),
    }, null, 2), 'utf8');
    assert.equal(smoke.ok, true);
    assert.equal(smoke.verification?.liveSillyTavernGeneration, true);

    const runtimeResult = smoke.results.find((result) => result.name === 'player-approved-original-runtime-reply');
    assert.equal(runtimeResult?.details?.turns?.length, 2);
    console.log(JSON.stringify({
        ok: true,
        serviceEvidence: toRepoPath(serviceEvidencePath),
        smokeEvidence: toRepoPath(smokeEvidencePath),
        turns: runtimeResult.details.turns.length,
        liveSillyTavernGeneration: smoke.verification.liveSillyTavernGeneration,
    }, null, 2));
} catch (error) {
    await writeFile(smokeEvidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        error: error.message,
        stderr: error.stderr?.toString?.() || '',
        stdout: error.stdout?.toString?.() || '',
    }, null, 2), 'utf8').catch(() => {});
    throw error;
} finally {
    await closeServer(runtimeBridge);
    await closeServer(configService);
}

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        setTimeout(resolve, 5000).unref();
    });
}

async function getJson(url) {
    const response = await fetch(url, { cache: 'no-cache' });
    const data = await response.json();
    assert.equal(response.ok, true, data.error || JSON.stringify(data));
    return data;
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        cache: 'no-cache',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.ok, true, data.error || JSON.stringify(data));
    return data;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function quietLogger() {
    return {
        log() {},
        warn() {},
        error() {},
    };
}
