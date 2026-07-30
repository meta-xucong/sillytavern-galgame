import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import {
    bindAdaptivePresentationProfileHashes,
    getManifestArcBindings,
    materializeManifestForArc,
} from '../shared/src/protocol.js';
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
const demoScenario = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO);
const arcId = args['arc-id'] || 'lucifer-arc1';
const evidenceDir = path.join(repoRoot, '.codex-longrun', 'evidence');
const evidencePath = path.resolve(repoRoot, args.evidence || `.codex-longrun/evidence/lucifer-arc-live-smoke-${arcId}.json`);
const browserEvidencePath = path.join(evidenceDir, `lucifer-arc-live-browser-${arcId}.json`);
const recoverySaveEvidencePath = path.join(evidenceDir, `lucifer-arc-recovery-save-${arcId}.json`);
const configPort = Number(args['config-port'] || 8791);
const bridgePort = Number(args['bridge-port'] || 8795);
const sillyTavernBaseUrl = normalizeBaseUrl(args['base-url'] || 'http://127.0.0.1:8001');
const proofSecret = randomUUID();
let nowOffsetSeconds = 0;
const cookieFetch = createCookieFetch();
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
    now: () => new Date(Date.now() + (++nowOffsetSeconds * 1000)),
});
const client = new SillyTavernHttpClient({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
});

await mkdir(evidenceDir, { recursive: true });

const arc = getManifestArcBindings(demoScenario).find((item) => item.arcId === arcId);
assert.ok(arc, `Unknown Arc: ${arcId}`);
const arcManifest = materializeManifestForArc(demoScenario, arcId);
const configService = createConfigService({
    store: new MemoryConfigStore(),
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
    const activeRelease = await publishArc(configBaseUrl, arcId);
    const direct = await runSignedDirectGenerate({
        configBaseUrl,
        bridgeBaseUrl,
        activeRelease,
        arcManifest,
    });
    const browserLive = await runBrowserSmoke(browserEvidencePath);
    await closeServer(runtimeBridge);
    const recoveryAndSave = await runRecoverySaveSmoke({
        configBaseUrl,
        evidencePath: recoverySaveEvidencePath,
    });

    const evidence = {
        ok: true,
        generatedAt: new Date().toISOString(),
        baseUrl: sillyTavernBaseUrl,
        arcId,
        arcTitle: arc.title,
        chatSeedId: arcManifest.sillyTavernBindings.chatSeedId,
        activeRelease: pickReleaseEvidence(activeRelease),
        directSignedGenerate: direct.evidence,
        browserLive: browserLive.evidence,
        recoveryAndSave: recoveryAndSave.evidence,
        runtimeApplied: {
            worldbook: direct.evidence.runtimeApplied.worldbook,
            preset: 'deferred/unbridged',
            instruct: 'deferred/unbridged',
            system: 'deferred/unbridged',
            context: 'deferred/unbridged',
        },
        boundaries: {
            proofSecretStoredInFrontend: false,
            localScriptedFallbackUsed: false,
            directBottomGenerateUsed: false,
            originalSillyTavernBackendMutated: false,
            originalFrontendMutated: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        evidence: toRepoPath(evidencePath),
        arcId,
        chatSeedId: evidence.chatSeedId,
        directTargetReadback: evidence.directSignedGenerate.targetAfter.latestRole === 'character',
        browserRuntimeTurns: evidence.browserLive.runtimeTurns,
        recoverySmoke: evidence.recoveryAndSave.recoveryOk,
        saveRestoreSmoke: evidence.recoveryAndSave.saveRestoreOk,
    }, null, 2));
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        arcId,
        error: error.message,
        stack: error.stack,
        bridgeDiagnostics: error.bridgeDiagnostics || null,
        responseStatus: error.responseStatus || null,
        responseData: error.responseData || null,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
} finally {
    if (servicesStarted) {
        await closeServer(runtimeBridge);
        await closeServer(configService);
    }
}

async function publishArc(configBaseUrl, requestedArcId) {
    await postJson(`${configBaseUrl}/v1/admin/scenarios/import`, { manifest: demoScenario });
    const publish = await postJson(`${configBaseUrl}/v1/admin/releases`, {
        scenarioId: demoScenario.id,
        scenarioVersion: demoScenario.version,
        activeArcId: requestedArcId,
    });
    assert.equal(publish.ok, true);
    assert.equal(publish.release.activeArcId, requestedArcId);
    return publish.release;
}

async function runSignedDirectGenerate({
    configBaseUrl,
    bridgeBaseUrl,
    activeRelease,
    arcManifest: manifest,
}) {
    let pending = null;
    let bridgeResultForFailure = null;
    const opening = await chatBridge.loadOpeningChat(manifest);
    assert.equal(opening.ok, true, `${arcId} opening chat must load before signed generation`);
    const expectedWorldInfo = manifest.sillyTavernBindings.worldBooks[0]?.name || '';
    assert.equal(opening.rawChat[0]?.chat_metadata?.world_info, expectedWorldInfo, `${arcId} opening seed must bind chat_metadata.world_info`);

    try {
        const testMessage = `${arcId} 直连验收：玩家沿着当前幕的开场行动推进。${Date.now().toString(36)}`;
        pending = await chatBridge.appendUserMessageToChat(manifest, opening, testMessage);
        assert.equal(pending.fileName.includes(arcId), true, `${arcId} play chat id must include Arc id`);
        assert.equal(pending.rawChat[0]?.chat_metadata?.world_info, expectedWorldInfo, `${arcId} play chat must inherit chat_metadata.world_info`);
        const targetBefore = await chatBridge.loadSpecificBoundChat(manifest, pending.fileName);
        assert.equal(targetBefore.messages.at(-1)?.role, 'player', 'target chat must await a character reply');
        assert.equal(targetBefore.messages.at(-1)?.text, testMessage, 'target chat readback must contain the test player message');
        assert.equal(targetBefore.rawChat[0]?.chat_metadata?.world_info, expectedWorldInfo, `${arcId} target readback must preserve chat_metadata.world_info`);

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
        assert.equal(proofResponse.proof.binding.release.arcId, arcId);
        assert.equal(proofResponse.proof.binding.chat.chatSeedId, manifest.sillyTavernBindings.chatSeedId);
        assert.deepEqual(proofResponse.proof.binding.resources.worldBookRefs, [expectedWorldInfo]);
        assert.equal(proofResponse.evidence.runtimeWorldInfo, expectedWorldInfo);
        assert.equal(JSON.stringify(proofResponse).includes(proofSecret), false, 'proof response must not leak signing secret');

        const bridgeResult = await postJson(`${bridgeBaseUrl}/v1/generate-reply`, {
            protocolVersion: 'galgame.original-runtime-bridge-request.v1',
            requestId: `${arcId}-direct-${Date.now().toString(36)}`,
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
        bridgeResultForFailure = bridgeResult;
        assert.equal(bridgeResult.ok, true);
        assert.equal(bridgeResult.chatId, pending.fileName);
        assert.equal(bridgeResult.rawChat.at(-1)?.is_user, false, 'bridge result must end with original character reply');
        assert.deepEqual(bridgeResult.diagnostics?.bridgeAuthorization?.runtimeWorldBookRefs, [expectedWorldInfo]);
        assert.equal(bridgeResult.diagnostics?.chatMetadataWorldInfo, expectedWorldInfo);
        assert.equal(bridgeResult.diagnostics?.expectedWorldInfoActivated, true, `${arcId} original Generate must emit WORLD_INFO_ACTIVATED for the Arc worldbook during Generate`);
        assert.deepEqual(
            sortedRefs(bridgeResult.diagnostics?.duringGenerateWorldInfoWorldRefs || bridgeResult.diagnostics?.activatedWorldInfoWorldRefs || []),
            sortedRefs([expectedWorldInfo]),
            `${arcId} Generate-window worldbook refs must be an exact set for the active Arc`,
        );
        assert.equal(
            bridgeResult.diagnostics?.worldInfoExactSetDuringGenerate,
            true,
            `${arcId} bridge diagnostics must confirm exact Generate-window worldbook set`,
        );
        assert.deepEqual(
            bridgeResult.diagnostics?.unexpectedLuciferArcWorldInfoDuringGenerate || [],
            [],
            `${arcId} Generate-window events must not include another Lucifer Arc bundle`,
        );
        assert.equal(
            bridgeResult.diagnostics?.characterPrimaryWorldAfterRestore || '',
            bridgeResult.diagnostics?.characterPrimaryWorldBefore || '',
            `${arcId} bridge must restore the original character primary world in browser memory`,
        );

        const targetAfter = await chatBridge.loadSpecificBoundChat(manifest, pending.fileName);
        assert.equal(targetAfter.messages.at(-1)?.role, 'character', 'target chat readback must end with character reply');
        assert.ok(!targetAfter.messages.at(-1)?.text.includes(testMessage), 'target latest reply must not be the player message');
        assert.equal(targetAfter.rawChat[0]?.chat_metadata?.world_info, expectedWorldInfo, `${arcId} target after generation must preserve chat_metadata.world_info`);

        const nonTargetChanges = diffNonTargetChats(nonTargetBefore, await chatBridge.listCharacterChats(pending.character), pending.fileName);
        assert.deepEqual(nonTargetChanges, [], `non-target chats must not change: ${JSON.stringify(nonTargetChanges)}`);

        const cleanup = await deleteChat(pending.fileName, pending.character.avatar);
        const evidence = {
            ok: true,
            arcId,
            releaseId: activeRelease.releaseId,
            targetChatId: pending.fileName,
            proof: proofResponse.evidence,
            runtimeApplied: {
                worldbook: 'verified-chat_metadata.world_info-signed-proof-bridge-diagnostics',
                expectedWorldInfo,
                openingSeedWorldInfo: opening.rawChat[0]?.chat_metadata?.world_info || '',
                targetWorldInfoBefore: targetBefore.rawChat[0]?.chat_metadata?.world_info || '',
                targetWorldInfoAfter: targetAfter.rawChat[0]?.chat_metadata?.world_info || '',
                bridgeWorldInfo: bridgeResult.diagnostics?.chatMetadataWorldInfo || '',
                bridgeRuntimeWorldBookRefs: bridgeResult.diagnostics?.bridgeAuthorization?.runtimeWorldBookRefs || [],
                originalWorldInfoActivated: Boolean(bridgeResult.diagnostics?.expectedWorldInfoActivated),
                preGenerateWorldInfoWorldRefs: bridgeResult.diagnostics?.preGenerateWorldInfoWorldRefs || [],
                preGenerateWorldInfoEntryCountByWorld: bridgeResult.diagnostics?.preGenerateWorldInfoEntryCountByWorld || {},
                duringGenerateWorldInfoWorldRefs: bridgeResult.diagnostics?.duringGenerateWorldInfoWorldRefs || [],
                duringGenerateWorldInfoEntryCountByWorld: bridgeResult.diagnostics?.duringGenerateWorldInfoEntryCountByWorld || {},
                activatedWorldInfoWorldRefs: bridgeResult.diagnostics?.activatedWorldInfoWorldRefs || [],
                activatedWorldInfoEntryCountByWorld: bridgeResult.diagnostics?.activatedWorldInfoEntryCountByWorld || {},
                worldInfoExactSetDuringGenerate: Boolean(bridgeResult.diagnostics?.worldInfoExactSetDuringGenerate),
                unexpectedLuciferArcWorldInfoDuringGenerate: bridgeResult.diagnostics?.unexpectedLuciferArcWorldInfoDuringGenerate || [],
                characterPrimaryWorldBefore: bridgeResult.diagnostics?.characterPrimaryWorldBefore || '',
                characterPrimaryWorldAfterDisable: bridgeResult.diagnostics?.characterPrimaryWorldAfterDisable || '',
                characterPrimaryWorldAfterRestore: bridgeResult.diagnostics?.characterPrimaryWorldAfterRestore || '',
                characterPrimaryWorldTemporarilyDisabled: Boolean(bridgeResult.diagnostics?.characterPrimaryWorldTemporarilyDisabled),
                characterPrimaryWorldRestored: Boolean(bridgeResult.diagnostics?.characterPrimaryWorldRestored),
            },
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
        return { evidence };
    } catch (error) {
        if (pending?.fileName) {
            await deleteChat(pending.fileName, pending.character.avatar).catch(() => {});
        }
        error.bridgeDiagnostics = bridgeResultForFailure?.diagnostics
            || bridgeResultForFailure?.runtimeState
            || error.responseData?.diagnostics
            || error.responseData?.runtimeState
            || null;
        throw error;
    }
}

async function runBrowserSmoke(targetEvidencePath) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
        'frontend/tools/browser-smoke-narrow.mjs',
        '--base-url',
        sillyTavernBaseUrl,
        '--player-only',
        'true',
        '--runtime-reply-smoke',
        'true',
        '--expected-arc-id',
        arcId,
    ], {
        cwd: repoRoot,
        timeout: 8 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const output = JSON.parse(stdout);
    const runtimeResult = output.results.find((result) => result.name === 'player-approved-original-runtime-reply');
    const evidence = {
        ok: output.ok,
        generatedAt: new Date().toISOString(),
        arcId,
        command: `node frontend/tools/browser-smoke-narrow.mjs --base-url ${sillyTavernBaseUrl} --player-only true --runtime-reply-smoke true`,
        liveSillyTavernGeneration: output.verification?.liveSillyTavernGeneration,
        runtimeTurns: runtimeResult?.details?.turns?.length || 0,
        cleanup: runtimeResult?.details?.cleanup || null,
        stdout: output,
        stderr: stderr.trim(),
    };
    await writeFile(targetEvidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    assert.equal(output.ok, true, JSON.stringify(output.failures));
    assert.equal(Boolean(output.verification?.liveSillyTavernGeneration), true);
    assert.equal(evidence.runtimeTurns, 2, `${arcId} browser smoke must complete two live turns`);
    assert.equal(Boolean(evidence.cleanup?.deleted), true, `${arcId} browser smoke temp chat must be deleted`);
    return { evidence };
}

async function runRecoverySaveSmoke({ configBaseUrl, evidencePath: targetEvidencePath }) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
        'frontend/tools/browser-smoke-narrow.mjs',
        '--base-url',
        sillyTavernBaseUrl,
        '--player-only',
        'true',
        '--write-chat-smoke',
        'true',
        '--save-restore-smoke',
        'true',
        '--expected-arc-id',
        arcId,
    ], {
        cwd: repoRoot,
        timeout: 2 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const output = JSON.parse(stdout);
    const recoveryResult = output.results.find((result) => result.name === 'player-original-chat-write-display');
    const saveRestoreResult = output.results.find((result) => result.name === 'player-save-restore-original-chat-readback');
    const evidence = {
        ok: output.ok,
        generatedAt: new Date().toISOString(),
        arcId,
        command: `node frontend/tools/browser-smoke-narrow.mjs --base-url ${sillyTavernBaseUrl} --player-only true --write-chat-smoke true --save-restore-smoke true --expected-arc-id ${arcId}`,
        configServiceUrl: configBaseUrl,
        runtimeBridgeClosedForRecovery: true,
        liveSillyTavernGeneration: output.verification?.liveSillyTavernGeneration,
        recoveryOk: Boolean(recoveryResult && recoveryResult.failures.length === 0),
        saveRestoreOk: Boolean(saveRestoreResult && saveRestoreResult.failures.length === 0),
        stdout: output,
        stderr: stderr.trim(),
    };
    await writeFile(targetEvidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    assert.equal(output.ok, true, JSON.stringify(output.failures));
    assert.equal(Boolean(output.verification?.liveSillyTavernGeneration), false);
    assert.equal(evidence.recoveryOk, true, `${arcId} recovery smoke must pass`);
    assert.equal(evidence.saveRestoreOk, true, `${arcId} save/restore smoke must pass`);
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
    if (!response.ok) {
        const error = new Error(data.error || data.errorCode || JSON.stringify(data));
        error.responseStatus = response.status;
        error.responseData = data;
        throw error;
    }
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

function sortedRefs(refs) {
    return [...new Set(Array.isArray(refs) ? refs : [])].sort((a, b) => a.localeCompare(b));
}

function pickReleaseEvidence(release) {
    return {
        releaseId: release.releaseId,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        activeArcId: release.activeArcId,
        arcId: release.arcId,
        manifestUrl: release.manifestUrl,
    };
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
