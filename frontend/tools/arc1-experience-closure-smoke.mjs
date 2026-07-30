import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import { bindAdaptivePresentationProfileHashes } from '../shared/src/protocol.js';
import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';
import {
    createConfigService,
    MemoryConfigStore,
} from '../../external-modules/game-config-service/server.mjs';
import { createOriginalRuntimeBridgeServer } from '../../external-modules/original-runtime-bridge/server.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const evidenceDir = path.join(repoRoot, '.codex-longrun', 'evidence');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/arc1-experience-closure.json');
const browserLiveEvidencePath = path.join(evidenceDir, 'arc1-experience-browser-live.json');
const recoverySaveEvidencePath = path.join(evidenceDir, 'arc1-experience-recovery-save.json');
const demoScenario = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO, { arcId: 'lucifer-arc1' });
const configPort = Number(args['config-port'] || 8791);
const bridgePort = Number(args['bridge-port'] || 8795);
const sillyTavernBaseUrl = normalizeBaseUrl(args['base-url'] || 'http://127.0.0.1:8001');
const proofSecret = randomUUID();
const cookieFetch = createCookieFetch();
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
    now: () => new Date(),
});
const client = new SillyTavernHttpClient({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
});

await mkdir(evidenceDir, { recursive: true });

const store = new MemoryConfigStore();
const configService = createConfigService({
    store,
    proofSecret,
    sillyTavernBaseUrl,
    corsOrigin: sillyTavernBaseUrl,
});
const runtimeBridge = createOriginalRuntimeBridgeServer({
    proofSecret,
    sillyTavernBaseUrl,
    logger: quietLogger(),
});

let servicesStarted = false;

try {
    await listen(configService, configPort);
    await listen(runtimeBridge, bridgePort);
    servicesStarted = true;

    const configBaseUrl = `http://127.0.0.1:${configPort}`;
    const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
    const activeRelease = await publishArc1(configBaseUrl);
    const direct = await runSignedDirectGenerate({
        configBaseUrl,
        bridgeBaseUrl,
        activeRelease,
    });

    const browserLive = await runBrowserSmoke({
        args: [
            'frontend/tools/browser-smoke-narrow.mjs',
            '--base-url',
            sillyTavernBaseUrl,
            '--player-only',
            'true',
            '--runtime-reply-smoke',
            'true',
        ],
        evidencePath: browserLiveEvidencePath,
        expectedLive: true,
    });

    await closeServer(runtimeBridge);
    await closeServer(configService);
    servicesStarted = false;

    const recoveryAndSave = await runBrowserSmoke({
        args: [
            'frontend/tools/browser-smoke-narrow.mjs',
            '--base-url',
            sillyTavernBaseUrl,
            '--player-only',
            'true',
            '--write-chat-smoke',
            'true',
            '--save-restore-smoke',
            'true',
        ],
        evidencePath: recoverySaveEvidencePath,
        expectedLive: false,
    });

    const evidence = {
        ok: true,
        generatedAt: new Date().toISOString(),
        baseUrl: sillyTavernBaseUrl,
        arcId: 'lucifer-arc1',
        directSignedGenerate: direct.evidence,
        browserLive: browserLive.evidence,
        recoveryAndSave: recoveryAndSave.evidence,
        stopAndTimeout: {
            coveredBy: 'node external-modules/original-runtime-bridge/test.mjs',
            evidence: 'original runtime bridge pending-generation + /v1/stop regression covers stop request, forced timeout, in-flight failure, lock cleanup, and 503 after stop.',
        },
        runtimeApplied: 'deferred/unbridged-referenceOnly-not-claimed',
        arc2To4: {
            status: 'blocked-by-missing-independent-original-chat-seeds',
            noSeedCreationAttempted: true,
        },
        boundaries: {
            proofSecretStoredInFrontend: false,
            localScriptedFallbackUsed: false,
            directBottomGenerateUsed: false,
            originalSillyTavernBackendMutated: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        evidence: toRepoPath(evidencePath),
        directTempChatDeleted: direct.evidence.cleanup.deleted,
        browserLiveTurns: browserLive.evidence.runtimeTurns,
        recoverySmoke: recoveryAndSave.evidence.recoveryOk,
        saveRestoreSmoke: recoveryAndSave.evidence.saveRestoreOk,
    }, null, 2));
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        error: error.message,
        stack: error.stack,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
} finally {
    if (servicesStarted) {
        await closeServer(runtimeBridge);
        await closeServer(configService);
    }
}

async function publishArc1(configBaseUrl) {
    await postJson(`${configBaseUrl}/v1/admin/scenarios/import`, { manifest: demoScenario });
    const publish = await postJson(`${configBaseUrl}/v1/admin/releases`, {
        scenarioId: demoScenario.id,
        scenarioVersion: demoScenario.version,
        activeArcId: 'lucifer-arc1',
    });
    assert.equal(publish.ok, true);
    assert.equal(publish.release.activeArcId, 'lucifer-arc1');
    return publish.release;
}

async function runSignedDirectGenerate({
    configBaseUrl,
    bridgeBaseUrl,
    activeRelease,
}) {
    let pending = null;
    const opening = await chatBridge.loadOpeningChat(DEMO_SCENARIO);
    assert.equal(opening.ok, true, 'Arc1 opening chat must load before direct signed generation');

    try {
        const testMessage = `Arc1闭环测试：Anna 在门口停下，等待房间里的人先开口。${Date.now().toString(36)}`;
        pending = await chatBridge.appendUserMessageToChat(DEMO_SCENARIO, opening, testMessage);
        const targetBefore = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, pending.fileName);
        assert.equal(targetBefore.messages.at(-1)?.role, 'player', 'target chat must await a character reply');
        assert.equal(targetBefore.messages.at(-1)?.text, testMessage, 'target chat readback must contain the test player message');

        const nonTargetBefore = mapNonTargetChats(await chatBridge.listCharacterChats(pending.character), pending.fileName);
        const proofResponse = await postJson(`${configBaseUrl}/v1/runtime-bridge/proofs`, {
            protocolVersion: 'galgame.runtime-bridge-proof-request.v1',
            releaseId: activeRelease.releaseId,
            scenarioId: activeRelease.scenarioId,
            scenarioVersion: activeRelease.scenarioVersion,
            arcId: activeRelease.activeArcId,
            chatId: pending.fileName,
            character: pending.character,
        });
        assert.equal(proofResponse.ok, true);
        assert.equal(proofResponse.proof.binding.release.arcId, 'lucifer-arc1');
        assert.equal(proofResponse.proof.binding.chat.chatId, pending.fileName);
        assert.equal(JSON.stringify(proofResponse).includes(proofSecret), false, 'proof response must not leak signing secret');

        const bridgeResult = await postJson(`${bridgeBaseUrl}/v1/generate-reply`, {
            protocolVersion: 'galgame.original-runtime-bridge-request.v1',
            requestId: `arc1-direct-${Date.now().toString(36)}`,
            sillyTavernBaseUrl,
            releaseId: activeRelease.releaseId,
            scenarioId: activeRelease.scenarioId,
            scenarioVersion: activeRelease.scenarioVersion,
            arcId: activeRelease.activeArcId,
            character: pending.character,
            chatId: pending.fileName,
            bridgeProof: proofResponse.proof,
            timeoutMs: 240000,
        });
        assert.equal(bridgeResult.ok, true);
        assert.equal(bridgeResult.chatId, pending.fileName);
        assert.equal(bridgeResult.rawChat.at(-1)?.is_user, false, 'bridge result must end with original character reply');

        const targetAfter = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, pending.fileName);
        assert.equal(targetAfter.messages.at(-1)?.role, 'character', 'target chat readback must end with character reply');
        assert.ok(!targetAfter.messages.at(-1)?.text.includes(testMessage), 'target latest reply must not be the player message');

        const nonTargetChanges = diffNonTargetChats(nonTargetBefore, await chatBridge.listCharacterChats(pending.character), pending.fileName);
        assert.deepEqual(nonTargetChanges, [], `non-target chats must not change: ${JSON.stringify(nonTargetChanges)}`);

        const cleanup = await deleteChat(pending.fileName, pending.character.avatar);
        const evidence = {
            ok: true,
            releaseId: activeRelease.releaseId,
            arcId: activeRelease.activeArcId,
            targetChatId: pending.fileName,
            proof: proofResponse.evidence,
            targetBefore: {
                latestRole: targetBefore.messages.at(-1)?.role,
                latestTextHash: hashText(targetBefore.messages.at(-1)?.text),
            },
            targetAfter: {
                latestRole: targetAfter.messages.at(-1)?.role,
                latestTextPreview: targetAfter.messages.at(-1)?.text?.slice(0, 180) || '',
                messageCount: targetAfter.messages.length,
            },
            nonTargetChanges,
            bridgeDiagnostics: bridgeResult.diagnostics || {},
            cleanup,
        };
        pending = null;
        return {
            tempFileName: evidence.targetChatId,
            evidence,
        };
    } catch (error) {
        if (pending?.fileName) {
            await deleteChat(pending.fileName, pending.character.avatar).catch(() => {});
        }
        throw error;
    }
}

async function runBrowserSmoke({ args: smokeArgs, evidencePath: targetEvidencePath, expectedLive }) {
    const { stdout, stderr } = await execFileAsync(process.execPath, smokeArgs, {
        cwd: repoRoot,
        timeout: expectedLive ? 8 * 60 * 1000 : 2 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const output = JSON.parse(stdout);
    const runtimeResult = output.results.find((result) => result.name === 'player-approved-original-runtime-reply');
    const recoveryResult = output.results.find((result) => result.name === 'player-original-chat-write-display');
    const saveRestoreResult = output.results.find((result) => result.name === 'player-save-restore-original-chat-readback');
    const evidence = {
        ok: output.ok,
        generatedAt: new Date().toISOString(),
        command: `node ${smokeArgs.join(' ')}`,
        liveSillyTavernGeneration: output.verification?.liveSillyTavernGeneration,
        runtimeTurns: runtimeResult?.details?.turns?.length || 0,
        recoveryOk: Boolean(recoveryResult && recoveryResult.failures.length === 0),
        saveRestoreOk: Boolean(saveRestoreResult && saveRestoreResult.failures.length === 0),
        stdout: output,
        stderr: stderr.trim(),
    };
    await writeFile(targetEvidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    assert.equal(output.ok, true, JSON.stringify(output.failures));
    assert.equal(Boolean(output.verification?.liveSillyTavernGeneration), expectedLive);
    return { evidence };
}

async function deleteChat(fileName, avatar) {
    const result = await client.requestJson('/api/chats/delete', {
        method: 'POST',
        body: {
            avatar_url: avatar,
            chatfile: fileName,
        },
        allowErrorObject: true,
    }).catch((error) => ({ error: error.message }));
    return {
        attempted: true,
        deleted: !result?.error,
        fileName,
        result,
    };
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
        if (!server?.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        setTimeout(resolve, 5000).unref();
    });
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
    assert.equal(response.ok, true, data.error || data.errorCode || JSON.stringify(data));
    return data;
}

function createCookieFetch() {
    let cookie = '';
    return async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (cookie && !headers.has('cookie')) {
            headers.set('cookie', cookie);
        }
        const response = await fetch(url, {
            ...options,
            headers,
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            cookie = setCookie.split(',').map((item) => item.split(';')[0]).join('; ');
        }
        return response;
    };
}

function mapNonTargetChats(chats, targetFileName) {
    const target = normalizeChatFileId(targetFileName);
    return new Map(chats
        .filter((chat) => normalizeChatFileId(chat.fileId) !== target)
        .map((chat) => [normalizeChatFileId(chat.fileId), {
            messageCount: chat.messageCount,
            lastMessageAt: chat.lastMessageAt,
            previewHash: hashText(chat.preview),
        }]));
}

function diffNonTargetChats(before, afterChats, targetFileName) {
    const target = normalizeChatFileId(targetFileName);
    const changes = [];
    for (const chat of afterChats) {
        const fileId = normalizeChatFileId(chat.fileId);
        if (!fileId || fileId === target) {
            continue;
        }
        const previous = before.get(fileId);
        if (!previous) {
            changes.push({ fileId, change: 'created' });
            continue;
        }
        const after = {
            messageCount: chat.messageCount,
            lastMessageAt: chat.lastMessageAt,
            previewHash: hashText(chat.preview),
        };
        if (
            previous.messageCount !== after.messageCount
            || previous.lastMessageAt !== after.lastMessageAt
            || previous.previewHash !== after.previewHash
        ) {
            changes.push({ fileId, before: previous, after });
        }
    }
    return changes;
}

function normalizeChatFileId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `fnv1a:${hash.toString(16).padStart(8, '0')}`;
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            parsed[value.slice(2)] = values[index + 1];
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
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
