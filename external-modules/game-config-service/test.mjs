import assert from 'node:assert/strict';
import http from 'node:http';
import {
    createHash,
    createHmac,
    timingSafeEqual,
} from 'node:crypto';
import { DEMO_SCENARIO } from '../../frontend/shared/src/demo-scenario.js';
import {
    bindAdaptivePresentationProfileHashes,
} from '../../frontend/shared/src/protocol.js';
import {
    createConfigService,
    issueVisualOldSaveRestoreProof,
    issueVisualRollbackRestoreProof,
    issueVisualProjection,
    MemoryConfigStore,
    MemoryVisualProjectionStore,
    MemoryVisualRestoreIssuerStore,
} from './server.mjs';
import { createOriginalRuntimeBridgeServer } from '../original-runtime-bridge/server.mjs';
import {
    normalizeOriginalVisibleChatMessages,
} from '../../frontend/shared/src/sillytavern-adapter.js';

const defaultArcId = DEMO_SCENARIO.defaultArcId;
const alternateArcId = 'config-service-test-alternate-arc';
const missingArcId = 'config-service-missing-arc';
const testScenario = bindAdaptivePresentationProfileHashes(withExtraArc(
    bindAdaptivePresentationProfileHashes(DEMO_SCENARIO),
    alternateArcId,
));
const visualScope = Object.freeze({
    profileId: 'vprof_configtest01',
    profileHash: testSha256('visual-profile'),
    catalogId: 'vc_configtest01',
    catalogRevision: 1,
    catalogHash: testSha256('visual-catalog'),
    dictionaryVersion: 'dict-vs1-pi',
    dictionaryHash: testSha256('visual-dictionary'),
});
const visualScenario = withVisualScope(testScenario, visualScope);
const visualProjectionStubToken = 'visual-projection-stub-token';
const unboundScenario = withExtraArc(DEMO_SCENARIO, alternateArcId);
const staleProfileScenario = {
    ...testScenario,
    adaptivePresentationProfiles: {
        ...testScenario.adaptivePresentationProfiles,
        [testScenario.arcs[0].presentationProfileId]: {
            ...testScenario.adaptivePresentationProfiles[testScenario.arcs[0].presentationProfileId],
            template: 'management-sim',
        },
    },
};
const boundCharacter = DEMO_SCENARIO.sillyTavernBindings.characters[0];
const runtimeWorldInfo = DEMO_SCENARIO.sillyTavernBindings.worldBooks[0].name;

const store = new MemoryConfigStore();
const server = createConfigService({ store });
await listen(server);
let baseUrl = serverBaseUrl(server);

try {
    const health = await fetchJson('/v1/admin/health');
    assert.equal(health.ok, true);
    assert.equal(health.active, false);
    assert.equal(health.adminAuth, 'disabled');
    assert.equal(health.runtimeProof.configured, false);
    const publicHealth = await fetchJson('/v1/health');
    assert.equal(publicHealth.ok, true);
    assert.equal(publicHealth.service, 'game-config-service');
    assert.equal(publicHealth.runtimeProof.configured, false);

    await fetchJson('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: unboundScenario },
    });
    const unboundPublish = await rawFetch('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: unboundScenario.id,
            scenarioVersion: unboundScenario.version,
            activeArcId: defaultArcId,
        },
    });
    assert.equal(unboundPublish.status, 400);
    assert.equal(unboundPublish.body.validation.errors.some((error) => error.includes('presentationProfileHash')), true);

    const staleProfileImport = await rawFetch('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: staleProfileScenario },
    });
    assert.equal(staleProfileImport.status, 400);
    assert.equal(staleProfileImport.body.validation.errors.some((error) => error.includes('presentationProfileHash')), true);

    const importResult = await fetchJson('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: testScenario },
    });
    assert.equal(importResult.ok, true);

    const validation = await fetchJson(`/v1/admin/scenarios/${testScenario.id}/versions/${testScenario.version}/validate`, {
        method: 'POST',
        body: {},
    });
    assert.equal(validation.valid, true);

    const publishResult = await fetchJson('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: testScenario.id,
            scenarioVersion: testScenario.version,
            activeArcId: defaultArcId,
        },
    });
    assert.equal(publishResult.ok, true);
    assert.equal(publishResult.release.activeArcId, defaultArcId);

    const active = await fetchJson('/v1/releases/active');
    assert.equal(active.scenarioId, testScenario.id);
    assert.equal(active.activeArcId, defaultArcId);
    assert.equal(active.presentationProfileHash, testScenario.arcs.find((arc) => arc.arcId === defaultArcId).presentationProfileHash);

    const manifest = await fetchJson(active.manifestUrl);
    assert.equal(manifest.title, testScenario.title);
    assert.equal(manifest.arcs.find((arc) => arc.arcId === defaultArcId).presentationProfileHash, active.presentationProfileHash);
    const playableStories = await fetchJson('/v1/scenarios');
    const importedStoryEntries = playableStories.entries.filter((entry) => entry.scenarioId === testScenario.id);
    assert.equal(importedStoryEntries.length, 1);
    assert.equal(importedStoryEntries[0].arcId, defaultArcId);
    assert.equal(importedStoryEntries[0].playableArcCount, 2);
    assert.equal(JSON.stringify(playableStories).includes('personality'), false);
    const storedStories = await fetchJson('/v1/admin/scenarios');
    assert.equal(storedStories.stories.some((story) => story.scenarioId === testScenario.id && story.ready), true);

    const alternatePublishResult = await fetchJson('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: testScenario.id,
            scenarioVersion: testScenario.version,
            activeArcId: alternateArcId,
        },
    });
    assert.equal(alternatePublishResult.ok, true);
    assert.equal(alternatePublishResult.release.activeArcId, alternateArcId);
    assert.equal(alternatePublishResult.release.presentationProfileHash, testScenario.arcs.find((arc) => arc.arcId === alternateArcId).presentationProfileHash);

    const missingArc = await rawFetch('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: testScenario.id,
            scenarioVersion: testScenario.version,
            activeArcId: missingArcId,
        },
    });
    assert.equal(missingArc.status, 400);
    assert.equal(missingArc.body.error, 'ACTIVE_ARC_NOT_FOUND');
    assert.equal((await fetchJson('/v1/releases/active')).activeArcId, alternateArcId);

    const releases = await fetchJson('/v1/admin/releases');
    assert.equal(releases.releases.length, 2);

    store.releases = store.releases.map((release) => release.releaseId === active.releaseId
        ? {
            ...release,
            presentationProfileHash: '',
        }
        : release);
    const tamperedRollback = await rawFetch(`/v1/admin/releases/${active.releaseId}/rollback`, {
        method: 'POST',
        body: {},
    });
    assert.equal(tamperedRollback.status, 404);
    assert.equal((await fetchJson('/v1/releases/active')).activeArcId, alternateArcId);
    store.releases = store.releases.map((release) => release.releaseId === active.releaseId ? active : release);

    const rollback = await fetchJson(`/v1/admin/releases/${active.releaseId}/rollback`, {
        method: 'POST',
        body: {},
    });
    assert.equal(rollback.ok, true);
    assert.equal(rollback.release.activeArcId, defaultArcId);
    assert.equal(rollback.release.presentationProfileHash, active.presentationProfileHash);
    assert.equal((await fetchJson('/v1/releases/active')).activeArcId, defaultArcId);

    const restoredActive = await fetchJson('/v1/releases/active');
    store.activeRelease = {
        ...restoredActive,
        presentationProfileHash: '',
    };
    const tamperedActive = await rawFetch('/v1/releases/active');
    assert.equal(tamperedActive.status, 404);
    store.activeRelease = restoredActive;

    const proofUnavailable = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        body: { chatId: 'galgame-play-chat-001' },
    });
    assert.equal(proofUnavailable.status, 503);
    assert.equal(proofUnavailable.body.error, 'BRIDGE_PROOF_ISSUER_UNCONFIGURED');

    console.log('game config service tests passed');
} finally {
    server.close();
}

const protectedStore = new MemoryConfigStore();
const protectedServer = createConfigService({
    store: protectedStore,
    adminToken: 'secret-token',
});
await listen(protectedServer);
baseUrl = serverBaseUrl(protectedServer);

try {
    const unauthorized = await rawFetch('/v1/admin/health');
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.body.error, 'ADMIN_AUTH_REQUIRED');

    const authorizedHealth = await fetchJson('/v1/admin/health', {
        headers: {
            Authorization: 'Bearer secret-token',
        },
    });
    assert.equal(authorizedHealth.ok, true);
    assert.equal(authorizedHealth.adminAuth, 'required');

    await fetchJson('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: testScenario },
        headers: {
            'X-Galgame-Admin-Token': 'secret-token',
        },
    });
    const publishResult = await fetchJson('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: testScenario.id,
            scenarioVersion: testScenario.version,
        },
        headers: {
            Cookie: 'galgame_admin_token=secret-token',
        },
    });
    assert.equal(publishResult.ok, true);

    const publicActive = await fetchJson('/v1/releases/active');
    assert.equal(publicActive.scenarioId, testScenario.id);

    console.log('game config service auth tests passed');
} finally {
    protectedServer.close();
}

const corsServer = createConfigService({
    store: new MemoryConfigStore(),
    corsOrigin: 'http://127.0.0.1:8000,http://localhost:8000',
});
await listen(corsServer);
baseUrl = serverBaseUrl(corsServer);

try {
    const preflight = await fetch(`${baseUrl}/v1/runtime-bridge/proofs`, {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://127.0.0.1:8000',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8000');
    assert.equal(preflight.headers.get('access-control-allow-origin')?.includes(','), false);

    const health = await fetch(`${baseUrl}/v1/health`, {
        headers: {
            Origin: 'http://localhost:8000',
        },
    });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://localhost:8000');

    console.log('game config service cors tests passed');
} finally {
    corsServer.close();
}

const proofSecret = 'config-service-proof-secret';
const runtimeProofToken = 'runtime-proof-token';
const seedChat = [
    { chat_metadata: { world_info: runtimeWorldInfo }, user_name: 'Player', character_name: boundCharacter.id },
    { name: boundCharacter.id, is_user: false, mes: '开场：冒险在危险道路旁展开。' },
];
const playChat = [
    ...seedChat,
    { name: 'Player', is_user: true, mes: '我靠近树丛，听听里面有什么。' },
];
const notAwaitingChat = [
    ...seedChat,
    { name: boundCharacter.id, is_user: false, mes: '道路重新安静下来。' },
];
const unrelatedChat = [
    { chat_metadata: {}, user_name: 'Player', character_name: boundCharacter.id },
    { name: 'Other', is_user: false, mes: '这不是同一个开场。' },
    { name: 'Player', is_user: true, mes: '尝试绕过。' },
];
const wrongWorldChat = [
    { chat_metadata: { world_info: 'Galgame_Wrong_World' }, user_name: 'Player', character_name: boundCharacter.id },
    seedChat[1],
    { name: 'Player', is_user: true, mes: '尝试错误世界书。' },
];
const proofChatBridge = createFakeOriginalChatBridge({
    [DEMO_SCENARIO.sillyTavernBindings.chatSeedId]: seedChat,
    'galgame-play-chat-001': playChat,
    'galgame-not-awaiting-chat': notAwaitingChat,
    'galgame-unrelated-chat': unrelatedChat,
    'galgame-wrong-world-chat': wrongWorldChat,
});
const proofStore = new MemoryConfigStore();
const proofServer = createConfigService({
    store: proofStore,
    proofSecret,
    runtimeProofToken,
    originalChatBridge: proofChatBridge,
});
await listen(proofServer);
baseUrl = serverBaseUrl(proofServer);

let bridgeServer;
try {
    await fetchJson('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: testScenario },
    });
    const publishResult = await fetchJson('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: testScenario.id,
            scenarioVersion: testScenario.version,
            activeArcId: defaultArcId,
        },
    });
    const active = publishResult.release;
    assert.equal(active.activeArcId, defaultArcId);

    const unauthorizedProof = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        body: runtimeProofBody(active, 'galgame-play-chat-001'),
    });
    assert.equal(unauthorizedProof.status, 401);
    assert.equal(unauthorizedProof.body.error, 'RUNTIME_PROOF_AUTH_REQUIRED');

    const proofResponse = await fetchJson('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: runtimeProofBody(active, 'galgame-play-chat-001'),
    });
    assert.equal(proofResponse.ok, true);
    assert.equal(proofResponse.proof.protocolVersion, 'galgame.original-runtime-bridge-proof.v1');
    assert.equal(proofResponse.proof.binding.release.releaseId, active.releaseId);
    assert.equal(proofResponse.proof.binding.chat.chatId, 'galgame-play-chat-001');
    assert.equal(proofResponse.proof.binding.chat.chatSeedId, DEMO_SCENARIO.sillyTavernBindings.chatSeedId);
    assert.deepEqual(proofResponse.proof.binding.resources.worldBookRefs, [runtimeWorldInfo]);
    assert.equal(proofResponse.proof.binding.resources.worldBookApplication, 'sillytavern-chat-metadata-world_info');
    assert.equal(proofResponse.evidence.runtimeWorldInfo, runtimeWorldInfo);
    assert.equal(JSON.stringify(proofResponse).includes(proofSecret), false);

    const playableStories = await fetchJson('/v1/scenarios');
    const canonicalPlayableRelease = playableStories.entries.find((entry) => (
        entry.scenarioId === testScenario.id && entry.arcId === defaultArcId
    ))?.release;
    assert.match(canonicalPlayableRelease.releaseId, /^play_/);
    const canonicalSaveProof = await fetchJson('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: runtimeProofBody(canonicalPlayableRelease, 'galgame-play-chat-001'),
    });
    assert.equal(canonicalSaveProof.proof.binding.release.releaseId, canonicalPlayableRelease.releaseId);

    const wrongAvatar = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: {
            ...runtimeProofBody(active, 'galgame-play-chat-001'),
            character: { id: 'Attacker', avatar: 'attacker.png' },
        },
    });
    assert.equal(wrongAvatar.status, 403);
    assert.equal(wrongAvatar.body.error, 'RUNTIME_PROOF_TARGET_MISMATCH');

    const crossRelease = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: {
            ...runtimeProofBody(active, 'galgame-play-chat-001'),
            releaseId: 'rel_other_release',
        },
    });
    assert.equal(crossRelease.status, 403);
    assert.equal(crossRelease.body.error, 'RUNTIME_PROOF_RELEASE_NOT_ALLOWED');

    proofStore.releases = [
        {
            ...active,
            releaseId: 'rel_invalid_profile_history',
            presentationProfileHash: '',
        },
        ...proofStore.releases,
    ];
    const invalidHistoryProof = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: {
            ...runtimeProofBody(active, 'galgame-play-chat-001'),
            releaseId: 'rel_invalid_profile_history',
        },
    });
    assert.equal(invalidHistoryProof.status, 403);
    assert.equal(invalidHistoryProof.body.error, 'RUNTIME_PROOF_RELEASE_PROFILE_INVALID');

    const unrelated = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: runtimeProofBody(active, 'galgame-unrelated-chat'),
    });
    assert.equal(unrelated.status, 403);
    assert.equal(unrelated.body.error, 'RUNTIME_PROOF_CHAT_NOT_SEED_DERIVED');

    const notAwaiting = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: runtimeProofBody(active, 'galgame-not-awaiting-chat'),
    });
    assert.equal(notAwaiting.status, 409);
    assert.equal(notAwaiting.body.error, 'RUNTIME_PROOF_TARGET_CHAT_NOT_AWAITING_REPLY');

    const wrongWorld = await rawFetch('/v1/runtime-bridge/proofs', {
        method: 'POST',
        headers: { 'X-Galgame-Runtime-Token': runtimeProofToken },
        body: runtimeProofBody(active, 'galgame-wrong-world-chat'),
    });
    assert.equal(wrongWorld.status, 409);
    assert.equal(wrongWorld.body.error, 'RUNTIME_PROOF_WORLD_INFO_NOT_APPLIED');

    bridgeServer = createOriginalRuntimeBridgeServer({
        runtime: {
            isStopping: () => false,
            async generateReply(request) {
                assert.deepEqual(request.runtimeWorldBookRefs, [runtimeWorldInfo]);
                return {
                    ok: true,
                    chatId: request.chatId,
                    generatedText: 'DM 描述树丛中的威胁终于现身。',
                    rawChat: [
                        ...playChat,
                        { name: boundCharacter.id, is_user: false, mes: 'DM 描述树丛中的威胁终于现身。' },
                    ],
                };
            },
        },
        proofSecret,
        logger: quietLogger(),
    });
    await listen(bridgeServer);
    const bridgeBaseUrl = serverBaseUrl(bridgeServer);
    const bridgeResponse = await fetch(`${bridgeBaseUrl}/v1/generate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            protocolVersion: 'galgame.original-runtime-bridge-request.v1',
            requestId: 'config-service-proof-test',
            sillyTavernBaseUrl: 'http://127.0.0.1:8000',
            releaseId: active.releaseId,
            scenarioId: active.scenarioId,
            scenarioVersion: active.scenarioVersion,
            arcId: active.activeArcId,
            character: {
                id: boundCharacter.id,
                avatar: boundCharacter.avatar,
            },
            chatId: 'galgame-play-chat-001',
            bridgeProof: proofResponse.proof,
            timeoutMs: 30000,
        }),
    });
    const bridgeData = await bridgeResponse.json();
    assert.equal(bridgeResponse.status, 200);
    assert.equal(bridgeData.ok, true);
    assert.equal(bridgeData.chatId, 'galgame-play-chat-001');

    console.log('game config service runtime proof issuer tests passed');
} finally {
    proofServer.close();
    bridgeServer?.close();
}

const visualProjectionSecret = 'visual-projection-secret';
const visualProjectionToken = 'visual-projection-token';
const visualProjectionChat = [
    ...seedChat,
    { name: 'System', is_system: true, mes: '系统消息不应进入视觉投影。' },
    { name: boundCharacter.id, is_user: false, mes: '   ' },
    { name: 'Player', is_user: true, mes: '我查看倒塌的木屋和门口的脚印。' },
    {
        name: boundCharacter.id,
        is_user: false,
        mes: '这段原始 mes 不应优先于 display_text。',
        extra: {
            display_text: [
                '场景: 倒塌的木屋',
                '装备: 生锈短剑',
                '道具: 蓝色钥匙',
                '技能: 火花术',
                '倒塌的木屋被冷雨浸透，门口的泥里留着新鲜脚印。',
            ].join('\n'),
        },
    },
];
const visualChatBridge = createFakeOriginalChatBridge({
    [DEMO_SCENARIO.sillyTavernBindings.chatSeedId]: seedChat,
    'galgame-visual-chat-001': visualProjectionChat,
});
const visualStore = new MemoryConfigStore();
const visualProjectionStore = new MemoryVisualProjectionStore({ rateLimit: 20 });
const visualServer = createConfigService({
    store: visualStore,
    visualProjectionSecret,
    visualProjectionServiceToken: visualProjectionToken,
    visualProjectionStubServiceToken: visualProjectionStubToken,
    visualProjectionTtlMs: 60000,
    visualProjectionStore,
    originalChatBridge: visualChatBridge,
});
await listen(visualServer);
baseUrl = serverBaseUrl(visualServer);
let restartProbe = null;

try {
    await fetchJson('/v1/admin/scenarios/import', {
        method: 'POST',
        body: { manifest: visualScenario },
    });
    const publishResult = await fetchJson('/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: visualScenario.id,
            scenarioVersion: visualScenario.version,
            activeArcId: defaultArcId,
        },
    });
    const active = publishResult.release;
    const canonicalVisible = normalizeOriginalVisibleChatMessages(visualProjectionChat);
    assert.equal(canonicalVisible.length, 3);
    assert.equal(canonicalVisible[2].index, 2);
    assert.equal(canonicalVisible[2].rawIndex, 5);
    assert.equal(canonicalVisible[2].text.includes('场景: 倒塌的木屋'), true);
    assert.equal(canonicalVisible[2].text.includes('倒塌的木屋被冷雨浸透'), true);
    const requestBody = visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
        idempotencyKey: 'idem_visual_projection_0001',
    });

    const noToken = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        body: requestBody,
    });
    assert.equal(noToken.status, 401);
    assert.equal(noToken.body.error, 'VISUAL_PROJECTION_AUTH_REQUIRED');

    const wrongToken = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
        body: requestBody,
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.body.error, 'VISUAL_PROJECTION_AUTH_REQUIRED');

    const browserDirect = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualProjectionToken}`,
            Origin: 'http://127.0.0.1:8001',
        },
        body: requestBody,
    });
    assert.equal(browserDirect.status, 403);
    assert.equal(browserDirect.body.error, 'VISUAL_PROJECTION_BROWSER_DIRECT_FORBIDDEN');

    const queryTokenRejected = await rawFetch('/v1/visual/projections?proof=not-allowed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: requestBody,
    });
    assert.equal(queryTokenRejected.status, 400);
    assert.equal(queryTokenRejected.body.error, 'VISUAL_PROJECTION_FORBIDDEN_TRANSPORT');

    const cookieProofRejected = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualProjectionToken}`,
            Cookie: 'visual_projection_proof=not-allowed',
        },
        body: requestBody,
    });
    assert.equal(cookieProofRejected.status, 400);
    assert.equal(cookieProofRejected.body.error, 'VISUAL_PROJECTION_FORBIDDEN_TRANSPORT');

    const futureProofHeaderRejected = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualProjectionToken}`,
            'X-Galgame-Visual-Projection-Proof': 'future-matcher-proof-not-for-issuer',
        },
        body: requestBody,
    });
    assert.equal(futureProofHeaderRejected.status, 400);
    assert.equal(futureProofHeaderRejected.body.error, 'VISUAL_PROJECTION_FORBIDDEN_TRANSPORT');

    const projectionRaw = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: requestBody,
    });
    assert.equal(projectionRaw.status, 200, JSON.stringify(projectionRaw.body));
    const projectionResponse = projectionRaw.body;
    assert.equal(projectionResponse.ok, true);
    assert.equal(projectionResponse.protocolVersion, 'galgame.visual-projection-response.v1');
    assert.equal(projectionResponse.proof.schemaVersion, 'galgame.visual-projection-proof.v1');
    assert.equal(projectionResponse.proof.nonce.startsWith('nonce_'), true);
    assert.equal(Object.hasOwn(projectionResponse.proof, 'jti'), false);
    assert.equal(projectionResponse.proof.profileId, visualScope.profileId);
    assert.equal(projectionResponse.proof.catalogId, visualScope.catalogId);
    assert.equal(projectionResponse.proof.dictionaryHash, visualScope.dictionaryHash);
    assert.equal(projectionResponse.stub.projectionId, projectionResponse.projection.projectionId);
    assert.equal(projectionResponse.stub.projectionHash, projectionResponse.projection.projectionHash);
    assert.equal(projectionResponse.projection.extractorVersion, 'galgame.visual-projection-shared.v2');
    assert.equal(projectionResponse.evidence.sourceMessageHash, projectionResponse.projection.sourceMessageHash);
    assert.equal(projectionResponse.evidence.entityCount, projectionResponse.projection.entities.length);
    assert.equal(projectionResponse.projection.sourceMessageIndex, 2);
    assert.equal(projectionResponse.projection.entities.some((entity) => JSON.stringify(entity).includes('倒塌的木屋')), true);
    assert.equal(JSON.stringify(projectionResponse).includes('这段原始 mes 不应优先于 display_text'), false);
    assert.equal(projectionResponse.projection.entities.some((entity) => entity.entityType === 'character'), true);
    assert.deepEqual(new Set(projectionResponse.projection.entities.map((entity) => entity.entityType)), new Set(['character', 'scene', 'equipment', 'item', 'skill', 'unknown']));
    assert.equal(projectionResponse.projection.entities.some((entity) => entity.entityKeySeed), false);
    const expectedVisualAttributeCode = {
        scene: 'scene-location-kind',
        equipment: 'equipment-visible-label',
        item: 'item-visible-label',
        skill: 'skill-visible-label',
    };
    for (const entityType of ['scene', 'equipment', 'item', 'skill']) {
        const projectionEntity = projectionResponse.projection.entities.find((entity) => entity.entityType === entityType);
        assert.ok(projectionEntity);
        assert.equal(projectionEntity.visibleAttributes[0].code, expectedVisualAttributeCode[entityType]);
    }
    assert.equal(JSON.stringify(projectionResponse).includes(visualProjectionSecret), false);
    assert.equal(JSON.stringify(projectionResponse).includes(visualProjectionToken), false);

    const stubNoToken = await rawFetch(`/v1/visual/projection-stubs/${projectionResponse.projection.projectionId}`);
    assert.equal(stubNoToken.status, 401);
    assert.equal(stubNoToken.body.error, 'VISUAL_PROJECTION_STUB_AUTH_REQUIRED');

    const stubWrongToken = await rawFetch(`/v1/visual/projection-stubs/${projectionResponse.projection.projectionId}`, {
        headers: { Authorization: 'Bearer wrong-stub-token' },
    });
    assert.equal(stubWrongToken.status, 401);
    assert.equal(stubWrongToken.body.error, 'VISUAL_PROJECTION_STUB_AUTH_REQUIRED');

    const stubBrowserDirect = await rawFetch(`/v1/visual/projection-stubs/${projectionResponse.projection.projectionId}`, {
        headers: {
            Authorization: `Bearer ${visualProjectionStubToken}`,
            Origin: 'http://127.0.0.1:8001',
        },
    });
    assert.equal(stubBrowserDirect.status, 403);
    assert.equal(stubBrowserDirect.body.error, 'VISUAL_PROJECTION_STUB_BROWSER_FORBIDDEN');

    const stubQueryToken = await rawFetch(`/v1/visual/projection-stubs/${projectionResponse.projection.projectionId}?token=${visualProjectionStubToken}`, {
        headers: { Authorization: `Bearer ${visualProjectionStubToken}` },
    });
    assert.equal(stubQueryToken.status, 400);
    assert.equal(stubQueryToken.body.error, 'VISUAL_PROJECTION_STUB_FORBIDDEN_TRANSPORT');

    const stubBadId = await rawFetch('/v1/visual/projection-stubs/not-a-valid-id', {
        headers: { Authorization: `Bearer ${visualProjectionStubToken}` },
    });
    assert.equal(stubBadId.status, 400);
    assert.equal(stubBadId.body.error, 'VISUAL_PROJECTION_STUB_INVALID_ID');

    const stubResponse = await fetchJson(`/v1/visual/projection-stubs/${projectionResponse.projection.projectionId}`, {
        headers: { Authorization: `Bearer ${visualProjectionStubToken}` },
    });
    assert.equal(stubResponse.schemaVersion, 'galgame.visual-projection-stub.v1');
    assert.equal(stubResponse.projectionId, projectionResponse.projection.projectionId);
    assert.equal(stubResponse.projectionHash, projectionResponse.projection.projectionHash);
    assert.equal(stubResponse.sourceMessageHash, projectionResponse.projection.sourceMessageHash);
    assert.equal(stubResponse.extractorVersion, 'galgame.visual-projection-shared.v2');
    assert.equal(stubResponse.entities.length, projectionResponse.projection.entities.length);
    for (const projectionEntity of projectionResponse.projection.entities) {
        const stubEntity = stubResponse.entities.find((entity) => entity.entityKey === projectionEntity.entityKey);
        assert.deepEqual(stubEntity, projectionEntity);
    }
    assert.equal(Object.hasOwn(stubResponse, 'ok'), false);
    assert.equal(JSON.stringify(stubResponse).includes('这段原始 mes 不应优先于 display_text'), false);
    assert.equal(JSON.stringify(stubResponse).includes(visualProjectionSecret), false);
    assert.equal(JSON.stringify(stubResponse).includes(visualProjectionStubToken), false);

    const idempotentAgain = await fetchJson('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: requestBody,
    });
    assert.equal(idempotentAgain.projection.projectionId, projectionResponse.projection.projectionId);
    assert.equal(idempotentAgain.proof.nonce, projectionResponse.proof.nonce);
    assert.equal(visualProjectionStore.readStub(projectionResponse.projection.projectionId).projectionHash, projectionResponse.projection.projectionHash);

    const distinctIdempotency = await fetchJson('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_distinct01',
        }),
    });
    assert.notEqual(distinctIdempotency.projection.projectionId, projectionResponse.projection.projectionId);
    assert.equal(distinctIdempotency.projection.sourceMessageHash, projectionResponse.projection.sourceMessageHash);
    assert.equal(visualProjectionStore.readStub(projectionResponse.projection.projectionId).projectionHash, projectionResponse.projection.projectionHash);
    assert.equal(visualProjectionStore.readStub(distinctIdempotency.projection.projectionId).projectionHash, distinctIdempotency.projection.projectionHash);

    const idempotencyConflict = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: {
            ...requestBody,
            scopeHint: {
                ...requestBody.scopeHint,
                chatId: DEMO_SCENARIO.sillyTavernBindings.chatSeedId,
            },
        },
    });
    assert.equal(idempotencyConflict.status, 409);
    assert.equal(idempotencyConflict.body.error, 'VISUAL_PROJECTION_IDEMPOTENCY_CONFLICT');

    const expectedHashMismatch = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_0002',
            expectedSourceMessageHash: testSha256('wrong-source-message'),
        },
    });
    assert.equal(expectedHashMismatch.status, 409);
    assert.equal(expectedHashMismatch.body.error, 'VISUAL_PROJECTION_SOURCE_MESSAGE_HASH_MISMATCH');
    assert.equal(JSON.stringify(expectedHashMismatch.body).includes('倒塌的木屋'), false);

    const scopeMismatch = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_0003',
            scopeHint: {
                ...requestBody.scopeHint,
                catalogId: 'vc_wrongcatalog000000',
            },
        },
    });
    assert.equal(scopeMismatch.status, 403);
    assert.equal(scopeMismatch.body.error, 'VISUAL_PROJECTION_SCOPE_MISMATCH');

    const oldSaveRejected = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_0004',
            requestMode: 'old-save',
            oldSaveHint: {
                saveId: 'save_visual_projection_001',
                releaseId: active.releaseId,
                profileId: visualScope.profileId,
                catalogId: visualScope.catalogId,
            },
        },
    });
    assert.equal(oldSaveRejected.status, 403);
    assert.equal(oldSaveRejected.body.error, 'VISUAL_PROJECTION_OLD_SAVE_UNSUPPORTED');

    const oversized = await rawFetchRawBody('/v1/visual/projections', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualProjectionToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_0005',
            padding: 'x'.repeat(17000),
        }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, 'VISUAL_PROJECTION_REQUEST_TOO_LARGE');

    const duplicateKeyBody = JSON.stringify(requestBody).replace(
        '"requestPurpose":"visual-projection"',
        '"requestPurpose":"visual-projection","requestPurpose":"visual-projection"',
    );
    const duplicateKeyRejected = await rawFetchRawBody('/v1/visual/projections', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualProjectionToken}`,
            'Content-Type': 'application/json',
        },
        body: duplicateKeyBody,
    });
    assert.equal(duplicateKeyRejected.status, 400);
    assert.equal(duplicateKeyRejected.body.error, 'VISUAL_PROJECTION_DUPLICATE_KEY');

    const clientEntityHintIgnored = await fetchJson('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_0008',
            entityHints: [{
                entityKey: 'entity_scene_clientfake001',
                entityType: 'scene',
                displayLabel: 'CLIENT FAKE WOODEN HOUSE',
            }],
        }),
    });
    assert.equal(JSON.stringify(clientEntityHintIgnored.projection).includes('CLIENT FAKE WOODEN HOUSE'), false);

    const gatewayEntity = projectionResponse.projection.entities.find((entity) => (
        ['scene', 'character', 'equipment', 'item', 'skill'].includes(entity.entityType)
    ));
    assert.ok(gatewayEntity, 'visual projection should expose a bindable entity for 3A gateway tests');
    const gatewayBindableEntityKeys = projectionResponse.projection.entities
        .filter((entity) => ['scene', 'character', 'equipment', 'item', 'skill'].includes(entity.entityType))
        .map((entity) => entity.entityKey);
    assert.deepEqual(gatewayBindableEntityKeys, projectionResponse.projection.entities
        .filter((entity) => entity.entityType !== 'unknown')
        .map((entity) => entity.entityKey));
    const visualMatchToken = 'visual-match-service-token-000000001';
    const internalMatchRequests = [];
    const fakeMatchServer = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        assert.equal(request.method, 'POST');
        assert.equal(url.pathname, '/v1/internal/visual-match');
        assert.equal(request.headers.authorization, `Bearer ${visualMatchToken}`);
        assert.equal(request.headers.origin, undefined);
        assert.equal(request.headers.cookie, undefined);
        assert.equal(Object.hasOwn(request.headers, 'x-galgame-visual-projection-proof'), true);
        const proof = JSON.parse(Buffer.from(request.headers['x-galgame-visual-projection-proof'], 'base64url').toString('utf8'));
        const body = JSON.parse(await readRequestText(request));
        internalMatchRequests.push({ proof, body });
        const result = createFakeVisualMatchResult({ proof, body });
        response.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end(JSON.stringify({ ok: true, result }));
    });
    await listen(fakeMatchServer);
    const fakeMatchBaseUrl = serverBaseUrl(fakeMatchServer);
    const visualAssetToken = 'visual-asset-internal-read-token-0001';
    const internalAssetRequests = [];
    const fakePng = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const fakeAssetServer = http.createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.authorization, `Bearer ${visualAssetToken}`);
        assert.equal(request.headers.origin, undefined);
        assert.equal(request.headers.cookie, undefined);
        const body = JSON.parse(await readRequestText(request));
        internalAssetRequests.push({ path: url.pathname, body });
        assert.equal(body.catalogId, visualScope.catalogId);
        assert.equal(body.catalogRevision, visualScope.catalogRevision);
        assert.equal(body.catalogHash, visualScope.catalogHash);
        assert.equal(Object.hasOwn(body, 'releaseId'), false);
        assert.equal(Object.hasOwn(body, 'profileHash'), false);
        if (url.pathname === '/v1/internal/assets/metadata-resolve') {
            response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({
                ok: true,
                schemaVersion: 'galgame.visual-asset-internal-metadata-resolve-response.v1',
                requestId: body.requestId,
                assetType: body.assetType,
                assetId: body.assetId,
                assetVersion: body.assetVersion,
                assetContentSha256: body.assetContentSha256,
                assetMetadataHash: `sha256:${testPlainSha256(`asset-metadata:${body.assetId}`)}`,
                catalogRefHash: `sha256:${testPlainSha256(`catalog-ref:${body.assetId}`)}`,
                catalogId: body.catalogId,
                catalogRevision: body.catalogRevision,
                catalogHash: body.catalogHash,
                canonicalMime: 'image/png',
            }));
            return;
        }
        if (url.pathname === '/v1/internal/assets/content-read') {
            response.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': String(fakePng.length),
                'X-Galgame-Asset-Content-Sha256': createHash('sha256').update(fakePng).digest('hex'),
                'Cache-Control': 'no-store',
            });
            response.end(fakePng);
            return;
        }
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND' } }));
    });
    await listen(fakeAssetServer);
    const fakeAssetBaseUrl = serverBaseUrl(fakeAssetServer);
    const visualGatewayStore = visualStore;
    const visualGatewayServer = createConfigService({
        store: visualGatewayStore,
        visualProjectionSecret,
        visualProjectionTtlMs: 60000,
        visualProjectionStore: new MemoryVisualProjectionStore({ rateLimit: 20 }),
        originalChatBridge: visualChatBridge,
        playerVisualGatewayOrigins: 'http://game.example.test',
        playerVisualGatewayTrustedProxyMode: 'required',
        playerVisualSessionReader: async (sessionId) => {
            assert.equal(sessionId, 'player-session-0001');
            return {
                csrfToken: 'csrf-token-00000001',
                chatId: 'galgame-visual-chat-001',
            };
        },
        visualMatchInternalBaseUrl: fakeMatchBaseUrl,
        visualMatchServiceToken: visualMatchToken,
        visualAssetServiceBaseUrl: fakeAssetBaseUrl,
        visualAssetInternalReadToken: visualAssetToken,
    });
    await listen(visualGatewayServer);
    const previousBaseUrl = baseUrl;
    baseUrl = serverBaseUrl(visualGatewayServer);
    try {
        const playerVisualRequest = {
            schemaVersion: 'galgame.player-visual-bundle.request.v1',
            requestId: 'pvbr_visual_gateway_0001',
            idempotencyKey: 'idem_visual_gateway_bundle01',
            sourceMessageIndex: 2,
            expectedSourceMessageHash: projectionResponse.projection.sourceMessageHash,
            requestedEntityKeys: [gatewayEntity.entityKey],
        };
        const noProxyModeServer = createConfigService({
            store: visualGatewayStore,
            visualProjectionSecret,
            originalChatBridge: visualChatBridge,
            playerVisualGatewayOrigins: 'http://game.example.test',
            playerVisualSessionReader: async () => ({
                csrfToken: 'csrf-token-00000001',
                chatId: 'galgame-visual-chat-001',
            }),
            visualMatchInternalBaseUrl: fakeMatchBaseUrl,
            visualMatchServiceToken: visualMatchToken,
        });
        await listen(noProxyModeServer);
        const noProxyBase = serverBaseUrl(noProxyModeServer);
        const noProxyResponse = await fetch(`${noProxyBase}/v1/player/visual-bundle`, {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(playerVisualRequest),
        });
        assert.equal(noProxyResponse.status, 503);
        assert.equal((await noProxyResponse.json()).error, 'VISUAL_PLAYER_AUTH_REQUIRED');
        noProxyModeServer.close();

        const missingCsrf = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
            },
            body: playerVisualRequest,
        });
        assert.equal(missingCsrf.status, 403);
        assert.equal(missingCsrf.body.error, 'VISUAL_PLAYER_CSRF_INVALID');

        const wrongOrigin = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://evil.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: playerVisualRequest,
        });
        assert.equal(wrongOrigin.status, 403);
        assert.equal(wrongOrigin.body.error, 'VISUAL_PLAYER_ORIGIN_REJECTED');

        const duplicateKeyBody = JSON.stringify(playerVisualRequest).replace(
            '"requestId":"pvbr_visual_gateway_0001"',
            '"requestId":"pvbr_visual_gateway_0001","requestId":"pvbr_visual_gateway_0001"',
        );
        const duplicateKey = await rawFetchRawBody('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
                'Content-Type': 'application/json',
            },
            body: duplicateKeyBody,
        });
        assert.equal(duplicateKey.status, 400);
        assert.equal(duplicateKey.body.error, 'VISUAL_PLAYER_REQUEST_INVALID');

        const missingExpectedHashRequest = { ...playerVisualRequest };
        delete missingExpectedHashRequest.expectedSourceMessageHash;
        const missingExpectedHash = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: missingExpectedHashRequest,
        });
        assert.equal(missingExpectedHash.status, 400);
        assert.equal(missingExpectedHash.body.error, 'VISUAL_PLAYER_REQUEST_INVALID');
        assert.match(
            JSON.stringify(missingExpectedHash.body.validation.errors),
            /expectedSourceMessageHash must be present/,
        );

        const wrongRequestedEntityKeysType = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: {
                ...playerVisualRequest,
                requestId: 'pvbr_visual_gateway_badtype',
                requestedEntityKeys: gatewayEntity.entityKey,
            },
        });
        assert.equal(wrongRequestedEntityKeysType.status, 400);
        assert.equal(wrongRequestedEntityKeysType.body.error, 'VISUAL_PLAYER_REQUEST_INVALID');
        assert.match(
            JSON.stringify(wrongRequestedEntityKeysType.body.validation.errors),
            /requestedEntityKeys must be an array/,
        );

        const duplicateRequestedEntityKeys = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: {
                ...playerVisualRequest,
                requestId: 'pvbr_visual_gateway_dupkeys',
                requestedEntityKeys: [gatewayEntity.entityKey, gatewayEntity.entityKey],
            },
        });
        assert.equal(duplicateRequestedEntityKeys.status, 400);
        assert.equal(duplicateRequestedEntityKeys.body.error, 'VISUAL_PLAYER_REQUEST_INVALID');

        const bundle = await fetchJson('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: playerVisualRequest,
        });
        assert.equal(bundle.schemaVersion, 'galgame.player-visual-bundle.v1');
        assert.equal(bundle.mode, 'current-release');
        assert.equal(bundle.assetReadTickets.length, 1);
        assert.deepEqual(Object.keys(bundle.assetReadTickets[0]).sort(), [
            'assetId',
            'assetVersion',
            'bindingId',
            'entityKey',
            'expiresAt',
            'proxyPath',
            'schemaVersion',
            'ticketId',
        ]);
        assert.equal(JSON.stringify(bundle.assetReadTickets[0]).includes('assetMetadataHash'), false);
        assert.equal(JSON.stringify(bundle.assetReadTickets[0]).includes('catalogRefHash'), false);
        assert.equal(bundle.matchResults.length, 1);
        assert.equal(bundle.bindings.length, 1);
        assert.equal(bundle.bindings[0].bindingId, bundle.matchResults[0].bindingId);
        assert.equal(bundle.bindings[0].bindingType, gatewayEntity.entityType);
        assert.equal(bundle.bindings[0].bindingPolicy, expectedBindingPolicyForType(gatewayEntity.entityType));
        assert.equal(bundle.bindings[0].assetId, bundle.matchResults[0].assetId);
        assert.equal(bundle.bindings[0].assetContentSha256, bundle.matchResults[0].assetContentSha256);
        assert.equal(bundle.bindings[0].idempotencyKey, internalMatchRequests[0].body.idempotencyKey);
        assert.notEqual(bundle.bindings[0].idempotencyKey, playerVisualRequest.idempotencyKey);
        assert.equal(bundle.matchResults[0].usesLlm, false);
        assert.equal(bundle.releaseScope.catalogId, visualScope.catalogId);
        assert.equal(bundle.source.entityKeys[0], gatewayEntity.entityKey);
        assert.equal(internalMatchRequests.length, 1);
        assert.equal(internalMatchRequests[0].body.entityKey, gatewayEntity.entityKey);
        assert.equal(internalMatchRequests[0].proof.catalogId, visualScope.catalogId);
        assert.equal(internalAssetRequests[0].path, '/v1/internal/assets/metadata-resolve');
        assert.equal(Object.hasOwn(internalAssetRequests[0].body, 'bindingId'), false);
        assert.equal(Object.hasOwn(internalAssetRequests[0].body, 'entityKey'), false);
        const assetContent = await fetch(`${baseUrl}${bundle.assetReadTickets[0].proxyPath}`, {
            method: 'GET',
            headers: {
                Origin: 'http://game.example.test',
                'X-Galgame-Player-Session': 'player-session-0001',
            },
        });
        assert.equal(assetContent.status, 200);
        assert.equal(assetContent.headers.get('content-type'), 'image/png');
        assert.equal(Buffer.compare(Buffer.from(await assetContent.arrayBuffer()), fakePng), 0);
        assert.equal(internalAssetRequests[1].path, '/v1/internal/assets/content-read');
        assert.equal(internalAssetRequests[1].body.assetMetadataHash, `sha256:${testPlainSha256(`asset-metadata:${bundle.bindings[0].assetId}`)}`);
        const assetCookieRejected = await fetch(`${baseUrl}${bundle.assetReadTickets[0].proxyPath}`, {
            method: 'GET',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
            },
        });
        assert.equal(assetCookieRejected.status, 400);
        assert.equal((await assetCookieRejected.json()).error, 'VISUAL_PLAYER_FORBIDDEN_TRANSPORT');
        const bundleText = JSON.stringify(bundle);
        assert.equal(bundleText.includes(visualMatchToken), false);
        assert.equal(bundleText.includes(visualProjectionSecret), false);
        assert.equal(bundleText.includes('x-galgame-visual-projection-proof'), false);
        assert.equal(bundleText.includes('这段原始 mes 不应优先于 display_text'), false);

        const omittedEntityKeysRequest = {
            ...playerVisualRequest,
            requestId: 'pvbr_visual_gateway_0002',
            idempotencyKey: 'idem_visual_gateway_bundle02',
        };
        delete omittedEntityKeysRequest.requestedEntityKeys;
        const omittedMatchStart = internalMatchRequests.length;
        const omittedBundle = await fetchJson('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: omittedEntityKeysRequest,
        });
        assert.equal(omittedBundle.mode, 'current-release');
        assert.deepEqual(omittedBundle.source.entityKeys, gatewayBindableEntityKeys);
        assert.equal(omittedBundle.matchResults.length, gatewayBindableEntityKeys.length);
        assert.equal(internalMatchRequests.length, omittedMatchStart + gatewayBindableEntityKeys.length);
        assert.deepEqual(internalMatchRequests.slice(omittedMatchStart).map((entry) => entry.body.entityKey), gatewayBindableEntityKeys);
        assert.equal(omittedBundle.bindings[0].idempotencyKey, internalMatchRequests[omittedMatchStart].body.idempotencyKey);
        assert.notEqual(omittedBundle.bindings[0].idempotencyKey, omittedEntityKeysRequest.idempotencyKey);

        const emptyEntityKeysRequest = {
            ...playerVisualRequest,
            requestId: 'pvbr_visual_gateway_0003',
            idempotencyKey: 'idem_visual_gateway_bundle03',
            requestedEntityKeys: [],
        };
        const emptyMatchStart = internalMatchRequests.length;
        const emptyBundle = await fetchJson('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: emptyEntityKeysRequest,
        });
        assert.equal(emptyBundle.mode, 'current-release');
        assert.deepEqual(emptyBundle.source.entityKeys, gatewayBindableEntityKeys);
        assert.equal(internalMatchRequests.length, emptyMatchStart + gatewayBindableEntityKeys.length);
        assert.deepEqual(internalMatchRequests.slice(emptyMatchStart).map((entry) => entry.body.entityKey), gatewayBindableEntityKeys);
    } finally {
        baseUrl = previousBaseUrl;
        visualGatewayServer.close();
        fakeMatchServer.close();
        fakeAssetServer.close();
    }

    const createTamperedStubGateway = async (projectionStore) => {
        const server = createConfigService({
            store: visualGatewayStore,
            visualProjectionSecret,
            visualProjectionTtlMs: 60000,
            visualProjectionStore: projectionStore,
            originalChatBridge: visualChatBridge,
            playerVisualGatewayOrigins: 'http://game.example.test',
            playerVisualGatewayTrustedProxyMode: 'required',
            playerVisualSessionReader: async () => ({
                csrfToken: 'csrf-token-00000001',
                chatId: 'galgame-visual-chat-001',
            }),
            visualMatchInternalBaseUrl: fakeMatchBaseUrl,
            visualMatchServiceToken: visualMatchToken,
            visualAssetServiceBaseUrl: fakeAssetBaseUrl,
            visualAssetInternalReadToken: visualAssetToken,
        });
        await listen(server);
        return server;
    };

    class MissingStubEntitiesProjectionStore extends MemoryVisualProjectionStore {
        save(entry, nowMs) {
            const saved = super.save(entry, nowMs);
            const { entities: _entities, ...stubWithoutEntities } = saved.stub;
            return { ...saved, stub: stubWithoutEntities };
        }
    }

    class MismatchedStubEntityProjectionStore extends MemoryVisualProjectionStore {
        save(entry, nowMs) {
            const saved = super.save(entry, nowMs);
            return {
                ...saved,
                stub: {
                    ...saved.stub,
                    entities: saved.stub.entities.map((entity, index) => index === 0
                        ? { ...entity, entityType: entity.entityType === 'character' ? 'scene' : 'character' }
                        : entity),
                },
            };
        }
    }

    const malformedStubServer = await createTamperedStubGateway(new MissingStubEntitiesProjectionStore({ rateLimit: 20 }));
    const malformedPreviousBaseUrl = baseUrl;
    baseUrl = serverBaseUrl(malformedStubServer);
    try {
        const malformedStubResponse = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: {
                schemaVersion: 'galgame.player-visual-bundle.request.v1',
                requestId: 'pvbr_visual_gateway_badstub',
                idempotencyKey: 'idem_visual_gateway_badstub01',
                sourceMessageIndex: 2,
                expectedSourceMessageHash: projectionResponse.projection.sourceMessageHash,
            },
        });
        assert.equal(malformedStubResponse.status, 409);
        assert.equal(malformedStubResponse.body.mode, 'recovery');
        assert.equal(malformedStubResponse.body.recovery.code, 'VISUAL_PLAYER_SCOPE_INVALID');
        assert.deepEqual(malformedStubResponse.body.source.entityKeys, []);
    } finally {
        baseUrl = malformedPreviousBaseUrl;
        malformedStubServer.close();
    }

    const mismatchStubServer = await createTamperedStubGateway(new MismatchedStubEntityProjectionStore({ rateLimit: 20 }));
    const mismatchPreviousBaseUrl = baseUrl;
    baseUrl = serverBaseUrl(mismatchStubServer);
    try {
        const mismatchStubResponse = await rawFetch('/v1/player/visual-bundle', {
            method: 'POST',
            headers: {
                Origin: 'http://game.example.test',
                Cookie: 'galgame_player_csrf=csrf-token-00000001',
                'X-Galgame-Player-Session': 'player-session-0001',
                'X-Galgame-Player-CSRF': 'csrf-token-00000001',
            },
            body: {
                schemaVersion: 'galgame.player-visual-bundle.request.v1',
                requestId: 'pvbr_visual_gateway_typemismatch',
                idempotencyKey: 'idem_visual_gateway_typemismatch01',
                sourceMessageIndex: 2,
                expectedSourceMessageHash: projectionResponse.projection.sourceMessageHash,
            },
        });
        assert.equal(mismatchStubResponse.status, 409);
        assert.equal(mismatchStubResponse.body.mode, 'recovery');
        assert.equal(mismatchStubResponse.body.recovery.code, 'VISUAL_PLAYER_SCOPE_INVALID');
        assert.deepEqual(mismatchStubResponse.body.source.entityKeys, []);
    } finally {
        baseUrl = mismatchPreviousBaseUrl;
        mismatchStubServer.close();
    }

    const internalProjection = await issueVisualProjection({
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_internal01',
        },
        store: visualStore,
        projectionSecret: visualProjectionSecret,
        projectionTtlMs: 60000,
        originalChatBridge: visualChatBridge,
        projectionStore: new MemoryVisualProjectionStore(),
    });
    assert.equal(internalProjection.status, 200);
    assert.equal(internalProjection.body.ok, true);

    const nonceStore = new MemoryVisualProjectionStore();
    const nonceFirst = await issueVisualProjection({
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_nonce01',
        },
        store: visualStore,
        projectionSecret: visualProjectionSecret,
        projectionTtlMs: 60000,
        originalChatBridge: visualChatBridge,
        projectionStore: nonceStore,
        nonceFactory: () => 'nonce_duplicate_nonce_001',
    });
    assert.equal(nonceFirst.status, 200);
    const nonceSecond = await issueVisualProjection({
        body: {
            ...requestBody,
            idempotencyKey: 'idem_visual_projection_nonce02',
        },
        store: visualStore,
        projectionSecret: visualProjectionSecret,
        projectionTtlMs: 60000,
        originalChatBridge: visualChatBridge,
        projectionStore: nonceStore,
        nonceFactory: () => 'nonce_duplicate_nonce_001',
    });
    assert.equal(nonceSecond.status, 500);
    assert.equal(nonceSecond.body.error, 'VISUAL_PROJECTION_NONCE_CONFLICT');

    restartProbe = {
        active,
        requestBody,
        projectionId: projectionResponse.projection.projectionId,
        projectionHash: projectionResponse.projection.projectionHash,
        proofNonce: projectionResponse.proof.nonce,
    };

    console.log('game config service visual projection issuer tests passed');
} finally {
    visualServer.close();
}

const visualRestartProjectionStore = new MemoryVisualProjectionStore({ rateLimit: 20 });
const visualRestartServer = createConfigService({
    store: visualStore,
    visualProjectionSecret,
    visualProjectionServiceToken: visualProjectionToken,
    visualProjectionStubServiceToken: visualProjectionStubToken,
    visualProjectionTtlMs: 60000,
    visualProjectionStore: visualRestartProjectionStore,
    originalChatBridge: visualChatBridge,
});
await listen(visualRestartServer);
baseUrl = serverBaseUrl(visualRestartServer);

try {
    assert.ok(restartProbe, 'visual projection restart probe must be captured before restart');
    const oldStubAfterRestart = await rawFetch(`/v1/visual/projection-stubs/${restartProbe.projectionId}`, {
        headers: { Authorization: `Bearer ${visualProjectionStubToken}` },
    });
    assert.equal(oldStubAfterRestart.status, 404);
    assert.equal(oldStubAfterRestart.body.error, 'VISUAL_PROJECTION_STUB_MISSING');

    const sameRequestAfterRestart = await fetchJson('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: restartProbe.requestBody,
    });
    assert.equal(sameRequestAfterRestart.projection.projectionId, restartProbe.projectionId);
    assert.notEqual(sameRequestAfterRestart.projection.projectionHash, restartProbe.projectionHash);
    assert.notEqual(sameRequestAfterRestart.proof.nonce, restartProbe.proofNonce);
    assert.equal(visualRestartProjectionStore.readStub(restartProbe.projectionId).projectionHash, sameRequestAfterRestart.projection.projectionHash);
} finally {
    visualRestartServer.close();
}

const restartNonceStore = new MemoryVisualProjectionStore();
const restartNonceFirst = await issueVisualProjection({
    body: visualProjectionBody(restartProbe.active, 'galgame-visual-chat-001', visualScope, {
        idempotencyKey: 'idem_visual_projection_restart01',
    }),
    store: visualStore,
    projectionSecret: visualProjectionSecret,
    projectionTtlMs: 60000,
    originalChatBridge: visualChatBridge,
    projectionStore: restartNonceStore,
    nonceFactory: () => 'nonce_restart_reused_001',
});
assert.equal(restartNonceFirst.status, 200);
const restartNonceSecond = await issueVisualProjection({
    body: visualProjectionBody(restartProbe.active, 'galgame-visual-chat-001', visualScope, {
        idempotencyKey: 'idem_visual_projection_restart02',
    }),
    store: visualStore,
    projectionSecret: visualProjectionSecret,
    projectionTtlMs: 60000,
    originalChatBridge: visualChatBridge,
    projectionStore: new MemoryVisualProjectionStore(),
    nonceFactory: () => 'nonce_restart_reused_001',
});
assert.equal(restartNonceSecond.status, 200);
assert.equal(restartNonceSecond.body.proof.nonce, restartNonceFirst.body.proof.nonce);

const visualNoSecretServer = createConfigService({
    store: visualStore,
    visualProjectionServiceToken: visualProjectionToken,
    originalChatBridge: visualChatBridge,
});
await listen(visualNoSecretServer);
baseUrl = serverBaseUrl(visualNoSecretServer);

try {
    const active = await visualStore.getActiveRelease();
    const secretMissing = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_0006',
        }),
    });
    assert.equal(secretMissing.status, 503);
    assert.equal(secretMissing.body.error, 'VISUAL_PROJECTION_SECRET_UNCONFIGURED');
} finally {
    visualNoSecretServer.close();
}

const visualNoTokenServer = createConfigService({
    store: visualStore,
    visualProjectionSecret,
    originalChatBridge: visualChatBridge,
});
await listen(visualNoTokenServer);
baseUrl = serverBaseUrl(visualNoTokenServer);

try {
    const active = await visualStore.getActiveRelease();
    const authUnconfigured = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_0007',
        }),
    });
    assert.equal(authUnconfigured.status, 503);
    assert.equal(authUnconfigured.body.error, 'VISUAL_PROJECTION_AUTH_UNCONFIGURED');
} finally {
    visualNoTokenServer.close();
}

const rateStore = new MemoryConfigStore({ manifests: [visualScenario] });
await rateStore.publish(visualScenario.id, visualScenario.version, { activeArcId: defaultArcId });
const rateProjectionStore = new MemoryVisualProjectionStore({ rateLimit: 1 });
const rateServer = createConfigService({
    store: rateStore,
    visualProjectionSecret,
    visualProjectionServiceToken: visualProjectionToken,
    originalChatBridge: visualChatBridge,
    visualProjectionStore: rateProjectionStore,
});
await listen(rateServer);
baseUrl = serverBaseUrl(rateServer);

try {
    const active = await rateStore.getActiveRelease();
    await fetchJson('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_rate01',
        }),
    });
    const rateLimited = await rawFetch('/v1/visual/projections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualProjectionToken}` },
        body: visualProjectionBody(active, 'galgame-visual-chat-001', visualScope, {
            idempotencyKey: 'idem_visual_projection_rate02',
        }),
    });
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.body.error, 'VISUAL_PROJECTION_RATE_LIMITED');
} finally {
    rateServer.close();
}

const visualRestoreIssuerToken = 'visual-restore-issuer-token';
const visualRestoreProofSecret = 'visual-restore-proof-secret';
const visualRestoreProofKeyId = 'vis_restore_key_testkey01';
const visualRestoreStore = new MemoryConfigStore();
await visualRestoreStore.saveManifest(visualScenario);
const rollbackTargetRelease = await visualRestoreStore.publish(visualScenario.id, visualScenario.version, { activeArcId: defaultArcId });
const driftActiveRelease = await visualRestoreStore.publish(visualScenario.id, visualScenario.version, { activeArcId: alternateArcId });
assert.notEqual(rollbackTargetRelease.releaseId, driftActiveRelease.releaseId);
const visualRestoreReleaseScopeHash = testSha256(`visual-restore-scope:${rollbackTargetRelease.releaseId}:${defaultArcId}`);
const visualRestoreBindingIds = ['vb_oldsavebind01', 'vb_oldsavebind02'];
const trustedSaveSnapshot = createTrustedSaveBindingSnapshot({
    release: rollbackTargetRelease,
    arcId: defaultArcId,
    scope: visualScope,
    releaseScopeHash: visualRestoreReleaseScopeHash,
    bindingIds: visualRestoreBindingIds,
});
const trustedRollbackEvent = createTrustedRollbackEvent({
    release: rollbackTargetRelease,
    arcId: defaultArcId,
    scope: visualScope,
    releaseScopeHash: visualRestoreReleaseScopeHash,
});
const saveReaderState = { snapshot: trustedSaveSnapshot };
const rollbackReaderState = { event: trustedRollbackEvent };
const visualRestoreIssuerStore = new MemoryVisualRestoreIssuerStore();
const visualRestoreServer = createConfigService({
    store: visualRestoreStore,
    visualRestoreIssuerServiceToken: visualRestoreIssuerToken,
    visualRestoreProofSecret,
    visualRestoreProofKeyId,
    visualRestoreProofTtlMs: 240000,
    visualRestoreIssuerStore,
    visualSaveBindingReader: {
        async readSaveBinding(saveId) {
            return saveReaderState.snapshot?.saveId === saveId ? saveReaderState.snapshot : null;
        },
    },
    visualRollbackEventReader: {
        async readRollbackEvent(rollbackRequestId) {
            return rollbackReaderState.event?.rollbackRequestId === rollbackRequestId ? rollbackReaderState.event : null;
        },
    },
});
await listen(visualRestoreServer);
baseUrl = serverBaseUrl(visualRestoreServer);

try {
    const oldSaveRequest = oldSaveRestoreIssueBody(trustedSaveSnapshot);
    const rollbackRequest = rollbackRestoreIssueBody({
        release: rollbackTargetRelease,
        event: trustedRollbackEvent,
        scope: visualScope,
        releaseScopeHash: visualRestoreReleaseScopeHash,
    });

    const oldSaveNoToken = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        body: oldSaveRequest,
    });
    assert.equal(oldSaveNoToken.status, 401);
    assert.equal(oldSaveNoToken.body.error, 'VISUAL_RESTORE_ISSUER_AUTH_INVALID');

    const oldSaveWrongToken = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveWrongToken.status, 401);
    assert.equal(oldSaveWrongToken.body.error, 'VISUAL_RESTORE_ISSUER_AUTH_INVALID');

    const oldSaveBrowserDirect = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualRestoreIssuerToken}`,
            Origin: 'http://127.0.0.1:8001',
        },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveBrowserDirect.status, 403);
    assert.equal(oldSaveBrowserDirect.body.error, 'VISUAL_RESTORE_ISSUER_BROWSER_FORBIDDEN');

    const oldSaveQueryToken = await rawFetch('/v1/visual/restore-proofs/old-save?token=not-allowed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveQueryToken.status, 400);
    assert.equal(oldSaveQueryToken.body.error, 'VISUAL_RESTORE_ISSUER_FORBIDDEN_TRANSPORT');

    const oldSaveCookieRejected = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualRestoreIssuerToken}`,
            Cookie: 'galgame_visual_restore=not-allowed',
        },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveCookieRejected.status, 400);
    assert.equal(oldSaveCookieRejected.body.error, 'VISUAL_RESTORE_ISSUER_FORBIDDEN_TRANSPORT');

    const futureProofHeaderRejected = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualRestoreIssuerToken}`,
            'X-Galgame-Visual-Restore-Proof': 'browser-must-not-forward-proof',
        },
        body: oldSaveRequest,
    });
    assert.equal(futureProofHeaderRejected.status, 400);
    assert.equal(futureProofHeaderRejected.body.error, 'VISUAL_RESTORE_ISSUER_FORBIDDEN_TRANSPORT');

    const duplicateOldSaveBody = JSON.stringify(oldSaveRequest).replace(
        '"schemaVersion":"galgame.visual-old-save-proof-issue-request.v1"',
        '"schemaVersion":"galgame.visual-old-save-proof-issue-request.v1","schemaVersion":"galgame.visual-old-save-proof-issue-request.v1"',
    );
    const duplicateOldSave = await rawFetchRawBody('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualRestoreIssuerToken}`,
            'Content-Type': 'application/json',
        },
        body: duplicateOldSaveBody,
    });
    assert.equal(duplicateOldSave.status, 400);
    assert.equal(duplicateOldSave.body.error, 'VISUAL_RESTORE_ISSUE_DUPLICATE_KEY');

    const oversizedOldSave = await rawFetchRawBody('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${visualRestoreIssuerToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...oldSaveRequest,
            padding: 'x'.repeat(17000),
        }),
    });
    assert.equal(oversizedOldSave.status, 413);
    assert.equal(oversizedOldSave.body.error, 'VISUAL_RESTORE_ISSUE_REQUEST_OVERSIZE');

    const badBindingId = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_badbind01',
            bindingIds: ['vb_legacy:wide'],
        },
    });
    assert.equal(badBindingId.status, 400);
    assert.equal(badBindingId.body.error, 'VISUAL_RESTORE_ISSUE_REQUEST_INVALID');

    const ownerMismatch = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_owner01',
            expectedSaveOwnerHash: testSha256('wrong-owner'),
        },
    });
    assert.equal(ownerMismatch.status, 403);
    assert.equal(ownerMismatch.body.error, 'VISUAL_RESTORE_SAVE_OWNER_MISMATCH');

    const bindingHashMismatch = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_bindhash',
            expectedSaveBindingHash: testSha256('wrong-save-binding'),
        },
    });
    assert.equal(bindingHashMismatch.status, 409);
    assert.equal(bindingHashMismatch.body.error, 'VISUAL_RESTORE_SAVE_BINDING_HASH_MISMATCH');

    const saveScopeMismatch = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_scope01',
            expectedCatalogHash: testSha256('wrong-catalog'),
        },
    });
    assert.equal(saveScopeMismatch.status, 409);
    assert.equal(saveScopeMismatch.body.error, 'VISUAL_RESTORE_SAVE_SCOPE_MISMATCH');

    const missingBinding = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_missing01',
            bindingIds: ['vb_missingbind01'],
        },
    });
    assert.equal(missingBinding.status, 409);
    assert.equal(missingBinding.body.error, 'VISUAL_RESTORE_SAVE_BINDING_MISSING');

    const oldSaveIssued = await fetchJson('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveIssued.protocolVersion, 'galgame.visual-restore-proof-issue-response.v1');
    assert.equal(oldSaveIssued.proofType, 'old-save');
    assert.equal(oldSaveIssued.keyId, visualRestoreProofKeyId);
    assert.equal(JSON.stringify(oldSaveIssued).includes(visualRestoreProofSecret), false);
    assert.equal(JSON.stringify(oldSaveIssued).includes(visualRestoreIssuerToken), false);
    const oldSavePayload = verifyRestoreProofToken(oldSaveIssued.proof, 'gvosrp1', visualRestoreProofSecret);
    assert.equal(oldSavePayload.schemaVersion, 'galgame.visual-old-save-restore-proof.v1');
    assert.equal(oldSavePayload.purpose, 'old-save-visual-binding-restore');
    assert.equal(oldSavePayload.issuer, 'game-config-service');
    assert.equal(oldSavePayload.audience, 'visual-asset-service');
    assert.equal(oldSavePayload.saveId, trustedSaveSnapshot.saveId);
    assert.equal(oldSavePayload.arcId, defaultArcId);
    assert.deepEqual(oldSavePayload.bindingIds, visualRestoreBindingIds);
    assert.equal((Date.parse(oldSavePayload.expiresAt) - Date.parse(oldSavePayload.issuedAt)) <= 120000, true);

    const oldSaveIdempotent = await fetchJson('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveIdempotent.proof, oldSaveIssued.proof);

    const oldSaveChangedBodySameIdempotency = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            requestId: 'req_visual_restore_old_0002',
        },
    });
    assert.equal(oldSaveChangedBodySameIdempotency.status, 409);
    assert.equal(oldSaveChangedBodySameIdempotency.body.error, 'VISUAL_RESTORE_ISSUE_IDEMPOTENCY_CONFLICT');

    const oldSaveIdempotencyConflict = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...oldSaveRequest,
            expectedDictionaryHash: testSha256('changed-dictionary'),
        },
    });
    assert.equal(oldSaveIdempotencyConflict.status, 409);
    assert.equal(oldSaveIdempotencyConflict.body.error, 'VISUAL_RESTORE_SAVE_SCOPE_MISMATCH');

    saveReaderState.snapshot = {
        ...trustedSaveSnapshot,
        status: 'retained',
    };
    const oldSaveAuthorityChanged = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRequest,
    });
    assert.equal(oldSaveAuthorityChanged.status, 409);
    assert.equal(oldSaveAuthorityChanged.body.error, 'VISUAL_RESTORE_ISSUE_IDEMPOTENCY_CONFLICT');
    saveReaderState.snapshot = trustedSaveSnapshot;

    const rollbackNoEvent = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_noevent',
            expectedRollbackRequestId: 'rollback_missing_event01',
        },
    });
    assert.equal(rollbackNoEvent.status, 404);
    assert.equal(rollbackNoEvent.body.error, 'VISUAL_RESTORE_ROLLBACK_EVENT_NOT_FOUND');

    const rollbackHashMismatch = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_hash',
            expectedRollbackEventHash: testSha256('wrong-rollback-event'),
        },
    });
    assert.equal(rollbackHashMismatch.status, 409);
    assert.equal(rollbackHashMismatch.body.error, 'VISUAL_RESTORE_ROLLBACK_EVENT_HASH_MISMATCH');

    const rollbackTimeMismatch = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_time',
            expectedRolledBackAt: new Date(Date.parse(trustedRollbackEvent.rolledBackAt) + 1000).toISOString(),
        },
    });
    assert.equal(rollbackTimeMismatch.status, 409);
    assert.equal(rollbackTimeMismatch.body.error, 'VISUAL_RESTORE_ROLLBACK_EVENT_TIME_MISMATCH');

    const rollbackTargetMismatch = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_target',
            targetArcId: alternateArcId,
        },
    });
    assert.equal(rollbackTargetMismatch.status, 409);
    assert.equal(rollbackTargetMismatch.body.error, 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH');

    const rollbackReleaseHashMismatch = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_release',
            expectedTargetReleaseHash: testSha256('wrong-release'),
        },
    });
    assert.equal(rollbackReleaseHashMismatch.status, 409);
    assert.equal(rollbackReleaseHashMismatch.body.error, 'VISUAL_RESTORE_ROLLBACK_SCOPE_MISMATCH');

    const rollbackProfileMismatch = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_rollback_profile',
            expectedVisualProfileHash: testSha256('wrong-profile'),
        },
    });
    assert.equal(rollbackProfileMismatch.status, 409);
    assert.equal(rollbackProfileMismatch.body.error, 'VISUAL_RESTORE_ROLLBACK_PROFILE_CATALOG_MISMATCH');

    const rollbackIssued = await fetchJson('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: rollbackRequest,
    });
    assert.equal(rollbackIssued.proofType, 'rollback');
    const rollbackPayload = verifyRestoreProofToken(rollbackIssued.proof, 'gvrrp1', visualRestoreProofSecret);
    assert.equal(rollbackPayload.schemaVersion, 'galgame.visual-rollback-restore-proof.v1');
    assert.equal(rollbackPayload.purpose, 'rollback-visual-binding-restore');
    assert.equal(rollbackPayload.rollbackRequestId, trustedRollbackEvent.rollbackRequestId);
    assert.equal(rollbackPayload.targetReleaseId, rollbackTargetRelease.releaseId);
    assert.equal(rollbackPayload.arcId, defaultArcId);
    assert.equal(rollbackPayload.targetReleaseHash, rollbackRequest.expectedTargetReleaseHash);
    assert.equal(rollbackPayload.rolledBackAt, trustedRollbackEvent.rolledBackAt);
    assert.equal(await visualRestoreStore.getActiveRelease(), driftActiveRelease);

    const rollbackIdempotent = await fetchJson('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: rollbackRequest,
    });
    assert.equal(rollbackIdempotent.proof, rollbackIssued.proof);

    const rollbackChangedBodySameIdempotency = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: {
            ...rollbackRequest,
            requestId: 'req_visual_restore_rollback02',
        },
    });
    assert.equal(rollbackChangedBodySameIdempotency.status, 409);
    assert.equal(rollbackChangedBodySameIdempotency.body.error, 'VISUAL_RESTORE_ISSUE_IDEMPOTENCY_CONFLICT');

    const internalOldSave = await issueVisualOldSaveRestoreProof({
        body: {
            ...oldSaveRequest,
            idempotencyKey: 'idem_visual_restore_internal01',
        },
        saveBindingReader: () => trustedSaveSnapshot,
        restoreProofSecret: visualRestoreProofSecret,
        restoreProofKeyId: visualRestoreProofKeyId,
        issuerStore: new MemoryVisualRestoreIssuerStore(),
    });
    assert.equal(internalOldSave.status, 200);
    assert.equal(verifyRestoreProofToken(internalOldSave.body.proof, 'gvosrp1', visualRestoreProofSecret).saveId, trustedSaveSnapshot.saveId);

    const internalRollback = await issueVisualRollbackRestoreProof({
        body: {
            ...rollbackRequest,
            idempotencyKey: 'idem_visual_restore_internal02',
        },
        store: visualRestoreStore,
        rollbackEventReader: () => trustedRollbackEvent,
        restoreProofSecret: visualRestoreProofSecret,
        restoreProofKeyId: visualRestoreProofKeyId,
        issuerStore: new MemoryVisualRestoreIssuerStore(),
    });
    assert.equal(internalRollback.status, 200);
    assert.equal(verifyRestoreProofToken(internalRollback.body.proof, 'gvrrp1', visualRestoreProofSecret).targetReleaseId, rollbackTargetRelease.releaseId);

    console.log('game config service visual restore proof issuer tests passed');
} finally {
    visualRestoreServer.close();
}

const visualRestoreNoReaderServer = createConfigService({
    store: visualRestoreStore,
    visualRestoreIssuerServiceToken: visualRestoreIssuerToken,
    visualRestoreProofSecret,
    visualRestoreProofKeyId,
});
await listen(visualRestoreNoReaderServer);
baseUrl = serverBaseUrl(visualRestoreNoReaderServer);

try {
    const noReader = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRestoreIssueBody(trustedSaveSnapshot),
    });
    assert.equal(noReader.status, 503);
    assert.equal(noReader.body.error, 'VISUAL_RESTORE_SAVE_READER_UNCONFIGURED');
    const noRollbackReader = await rawFetch('/v1/visual/restore-proofs/rollback', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: rollbackRestoreIssueBody({
            release: rollbackTargetRelease,
            event: trustedRollbackEvent,
            scope: visualScope,
            releaseScopeHash: visualRestoreReleaseScopeHash,
        }),
    });
    assert.equal(noRollbackReader.status, 403);
    assert.equal(noRollbackReader.body.error, 'VISUAL_RESTORE_ROLLBACK_EVENT_REQUIRED');
} finally {
    visualRestoreNoReaderServer.close();
}

const visualRestoreNoSecretServer = createConfigService({
    store: visualRestoreStore,
    visualRestoreIssuerServiceToken: visualRestoreIssuerToken,
    visualRestoreProofKeyId,
    visualSaveBindingReader: () => trustedSaveSnapshot,
});
await listen(visualRestoreNoSecretServer);
baseUrl = serverBaseUrl(visualRestoreNoSecretServer);

try {
    const noSecret = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRestoreIssueBody(trustedSaveSnapshot),
    });
    assert.equal(noSecret.status, 503);
    assert.equal(noSecret.body.error, 'VISUAL_RESTORE_ISSUER_SECRET_MISSING');
} finally {
    visualRestoreNoSecretServer.close();
}

const visualRestoreBadKeyServer = createConfigService({
    store: visualRestoreStore,
    visualRestoreIssuerServiceToken: visualRestoreIssuerToken,
    visualRestoreProofSecret,
    visualRestoreProofKeyId: 'bad-key',
    visualSaveBindingReader: () => trustedSaveSnapshot,
});
await listen(visualRestoreBadKeyServer);
baseUrl = serverBaseUrl(visualRestoreBadKeyServer);

try {
    const badKey = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        headers: { Authorization: `Bearer ${visualRestoreIssuerToken}` },
        body: oldSaveRestoreIssueBody(trustedSaveSnapshot),
    });
    assert.equal(badKey.status, 503);
    assert.equal(badKey.body.error, 'VISUAL_RESTORE_ISSUER_KEY_INVALID');
} finally {
    visualRestoreBadKeyServer.close();
}

const visualRestoreNoTokenServer = createConfigService({
    store: visualRestoreStore,
    visualRestoreProofSecret,
    visualRestoreProofKeyId,
    visualSaveBindingReader: () => trustedSaveSnapshot,
});
await listen(visualRestoreNoTokenServer);
baseUrl = serverBaseUrl(visualRestoreNoTokenServer);

try {
    const noTokenConfigured = await rawFetch('/v1/visual/restore-proofs/old-save', {
        method: 'POST',
        body: oldSaveRestoreIssueBody(trustedSaveSnapshot),
    });
    assert.equal(noTokenConfigured.status, 503);
    assert.equal(noTokenConfigured.body.error, 'VISUAL_RESTORE_ISSUER_AUTH_MISSING');
} finally {
    visualRestoreNoTokenServer.close();
}

async function fetchJson(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await rawFetch(path, { method, body, headers });
    assert.equal(response.ok, true, response.body.error || JSON.stringify(response.body));
    return response.body;
}

async function rawFetch(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...headers,
            ...(body === undefined ? {} : {
            'Content-Type': 'application/json',
            }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    return {
        ok: response.ok,
        status: response.status,
        body: data,
    };
}

async function rawFetchRawBody(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body,
    });
    const data = await response.json();
    return {
        ok: response.ok,
        status: response.status,
        body: data,
    };
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function serverBaseUrl(server) {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
}

function runtimeProofBody(release, chatId) {
    return {
        protocolVersion: 'galgame.runtime-bridge-proof-request.v1',
        releaseId: release.releaseId,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        arcId: release.activeArcId || release.arcId,
        chatId,
        character: {
            id: boundCharacter.id,
            avatar: boundCharacter.avatar,
        },
    };
}

function visualProjectionBody(release, chatId, scope, overrides = {}) {
    const base = {
        schemaVersion: 'galgame.visual-projection-issuance-request.v1',
        requestPurpose: 'visual-projection',
        idempotencyKey: 'idem_visual_projection_0001',
        requestMode: 'active-release',
        sourceMessageIndex: 2,
        scopeHint: {
            releaseId: release.releaseId,
            scenarioId: release.scenarioId,
            scenarioVersion: release.scenarioVersion,
            arcId: release.activeArcId || release.arcId,
            chatId,
            profileId: scope.profileId,
            catalogId: scope.catalogId,
            catalogRevision: scope.catalogRevision,
            dictionaryVersion: scope.dictionaryVersion,
        },
    };
    const result = {
        ...base,
        ...overrides,
    };
    if (overrides.scopeHint) {
        result.scopeHint = {
            ...base.scopeHint,
            ...overrides.scopeHint,
        };
    }
    return result;
}

function oldSaveRestoreIssueBody(snapshot, overrides = {}) {
    return {
        schemaVersion: 'galgame.visual-old-save-proof-issue-request.v1',
        requestId: 'req_visual_restore_old_0001',
        idempotencyKey: 'idem_visual_restore_old_0001',
        saveId: snapshot.saveId,
        expectedSaveOwnerHash: snapshot.saveOwnerHash,
        expectedSaveBindingHash: snapshot.saveBindingHash,
        expectedReleaseId: snapshot.releaseId,
        expectedReleaseScopeHash: snapshot.releaseScopeHash,
        expectedScenarioId: snapshot.scenarioId,
        expectedScenarioVersion: snapshot.scenarioVersion,
        expectedVisualProfileId: snapshot.visualProfileId,
        expectedVisualProfileHash: snapshot.visualProfileHash,
        expectedCatalogId: snapshot.catalogId,
        expectedCatalogRevision: snapshot.catalogRevision,
        expectedCatalogHash: snapshot.catalogHash,
        expectedDictionaryVersion: snapshot.dictionaryVersion,
        expectedDictionaryHash: snapshot.dictionaryHash,
        chatIdHash: snapshot.chatIdHash,
        bindingIds: [...snapshot.bindingIds],
        ...overrides,
    };
}

function rollbackRestoreIssueBody({ release, event, scope, releaseScopeHash }, overrides = {}) {
    return {
        schemaVersion: 'galgame.visual-rollback-proof-issue-request.v1',
        requestId: 'req_visual_restore_rollback01',
        idempotencyKey: 'idem_visual_restore_rollback01',
        expectedRollbackRequestId: event.rollbackRequestId,
        expectedRollbackEventHash: event.rollbackEventHash,
        expectedRolledBackAt: event.rolledBackAt,
        expectedPublishedAt: release.publishedAt,
        targetReleaseId: release.releaseId,
        targetArcId: release.activeArcId || release.arcId,
        expectedTargetReleaseHash: computeVisualRestoreTargetReleaseHash(release),
        expectedReleaseScopeHash: releaseScopeHash,
        expectedScenarioId: release.scenarioId,
        expectedScenarioVersion: release.scenarioVersion,
        expectedVisualProfileId: scope.profileId,
        expectedVisualProfileHash: scope.profileHash,
        expectedCatalogId: scope.catalogId,
        expectedCatalogRevision: scope.catalogRevision,
        expectedCatalogHash: scope.catalogHash,
        expectedDictionaryVersion: scope.dictionaryVersion,
        expectedDictionaryHash: scope.dictionaryHash,
        ...overrides,
    };
}

function createTrustedSaveBindingSnapshot({
    release,
    arcId,
    scope,
    releaseScopeHash,
    bindingIds,
}) {
    return {
        saveId: 'save_visual_restore_001',
        saveOwnerHash: testSha256('visual-save-owner'),
        saveBindingHash: testSha256('visual-save-binding'),
        releaseId: release.releaseId,
        releaseScopeHash,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        arcId,
        visualProfileId: scope.profileId,
        visualProfileHash: scope.profileHash,
        catalogId: scope.catalogId,
        catalogRevision: scope.catalogRevision,
        catalogHash: scope.catalogHash,
        dictionaryVersion: scope.dictionaryVersion,
        dictionaryHash: scope.dictionaryHash,
        chatIdHash: testSha256('visual-old-save-chat'),
        bindingIds,
        status: 'active',
    };
}

function createTrustedRollbackEvent({
    release,
    arcId,
    scope,
    releaseScopeHash,
}) {
    const event = {
        rollbackRequestId: 'rollback_visual_restore_001',
        status: 'committed',
        targetReleaseId: release.releaseId,
        targetArcId: arcId,
        targetReleaseHash: computeVisualRestoreTargetReleaseHash(release),
        releaseScopeHash,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        visualProfileId: scope.profileId,
        visualProfileHash: scope.profileHash,
        catalogId: scope.catalogId,
        catalogRevision: scope.catalogRevision,
        catalogHash: scope.catalogHash,
        dictionaryVersion: scope.dictionaryVersion,
        dictionaryHash: scope.dictionaryHash,
        publishedAt: release.publishedAt,
        rolledBackAt: '2026-08-01T05:40:00.000Z',
    };
    return {
        ...event,
        rollbackEventHash: computeRollbackEventHash(event),
    };
}

function verifyRestoreProofToken(token, prefix, secret) {
    const parts = String(token || '').split('.');
    assert.equal(parts.length, 3);
    assert.equal(parts[0], prefix);
    assert.equal(parts.some((part) => part.includes('=')), false);
    const signingInput = `${parts[0]}.${parts[1]}`;
    const expectedSignature = createHmac('sha256', secret)
        .update(signingInput, 'ascii')
        .digest();
    const actualSignature = Buffer.from(parts[2], 'base64url');
    assert.equal(actualSignature.length, expectedSignature.length);
    assert.equal(timingSafeEqual(actualSignature, expectedSignature), true);
    const payloadText = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadText);
    assert.equal(payloadText, canonicalJson(payload));
    return payload;
}

function computeVisualRestoreTargetReleaseHash(release) {
    return testSha256(canonicalJson({
        releaseId: String(release?.releaseId || '').trim().slice(0, 240),
        scenarioId: String(release?.scenarioId || '').trim().slice(0, 240),
        scenarioVersion: String(release?.scenarioVersion || '').trim().slice(0, 240),
        activeArcId: String(release?.activeArcId || release?.arcId || '').trim().slice(0, 240),
        arcId: String(release?.arcId || release?.activeArcId || '').trim().slice(0, 240),
        contentHash: String(release?.contentHash || '').trim().slice(0, 240),
        presentationProfileId: String(release?.presentationProfileId || '').trim().slice(0, 240),
        presentationProfileHash: String(release?.presentationProfileHash || '').trim().slice(0, 240),
        manifestUrl: String(release?.manifestUrl || '').trim().slice(0, 240),
    }));
}

function computeRollbackEventHash(event) {
    const copy = { ...event };
    delete copy.rollbackEventHash;
    return testSha256(canonicalJson(copy));
}

function expectedBindingPolicyForType(type) {
    if (type === 'scene') return 'scene-ttl';
    if (type === 'character') return 'session-fixed';
    if (['equipment', 'item', 'skill'].includes(type)) return 'entity-first-seen-fixed';
    return 'unknown';
}

async function readRequestText(request) {
    const chunks = [];
    for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}

function createFakeVisualMatchResult({ proof, body }) {
    const plainContentHash = testPlainSha256(`visual-match-asset-content:${body.entityType}`);
    const createdAt = '2026-08-01T06:30:00.000Z';
    return {
        schemaVersion: 'galgame.visual-match-result.v1',
        matchId: `vm_${testPlainSha256(`match:${body.requestId}`).slice(0, 24)}`,
        bindingId: `vb_${testPlainSha256(`binding:${body.requestId}`).slice(0, 24)}`,
        entityKey: body.entityKey,
        type: body.entityType,
        catalogId: proof.catalogId,
        catalogRevision: proof.catalogRevision,
        catalogHash: proof.catalogHash,
        visualProfileId: proof.profileId,
        profileHash: proof.profileHash,
        evidenceDigest: proof.projectionHash,
        projectionId: proof.projectionId,
        sourceMessageIndex: proof.sourceMessageIndex,
        sourceMessageHash: proof.sourceMessageHash,
        assetId: `asset_${testPlainSha256(`asset:${body.entityType}`).slice(0, 16)}`,
        assetVersion: 1,
        assetContentSha256: plainContentHash,
        matcherVersion: 'vs-code-3a-test-matcher-1',
        scorerVersion: 'vs-code-3a-test-scorer-1',
        dictionaryVersion: proof.dictionaryVersion,
        dictionaryHash: proof.dictionaryHash,
        score: 87,
        scoreBand: 'high',
        reasonCodes: ['type-match'],
        usesLlm: false,
        createdAt,
        expiresAt: proof.expiresAt,
    };
}

function canonicalJson(value) {
    return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value) {
    if (Array.isArray(value)) {
        return value.map(sortCanonical);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => ({
                ...result,
                [key]: sortCanonical(value[key]),
            }), {});
    }
    return value;
}

function withExtraArc(manifest, arcId) {
    const sourceArc = manifest.arcs[0];
    const sourceBindings = sourceArc.sillyTavernBindings || {};
    const sourceTarget = sourceBindings.target || {};
    return {
        ...manifest,
        arcs: [
            ...manifest.arcs,
            {
                ...sourceArc,
                arcBindingId: `${manifest.id}:${manifest.version}:${arcId}:v1`,
                arcId,
                title: '测试备用入口',
                order: sourceArc.order + 1,
                sillyTavernBindings: {
                    ...sourceBindings,
                    target: {
                        ...sourceTarget,
                        chatSeedId: `${sourceTarget.chatSeedId || sourceBindings.chatSeedId}-alternate`,
                    },
                },
            },
        ],
    };
}

function withVisualScope(manifest, scope) {
    return {
        ...manifest,
        visualPresentation: { ...scope },
        arcs: manifest.arcs.map((arc) => ({
            ...arc,
            visualPresentation: { ...scope },
        })),
    };
}

function createFakeOriginalChatBridge(chatsById) {
    return {
        async listCharacterChats() {
            return Object.keys(chatsById).map((fileName) => ({
                fileId: fileName,
                fileName,
            }));
        },
        async getCharacterChat({ fileName }) {
            const chat = chatsById[String(fileName || '').replace(/\.json$/i, '')];
            if (!chat) {
                throw new Error('CHAT_NOT_FOUND');
            }
            return chat;
        },
    };
}

function testSha256(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function testPlainSha256(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

function quietLogger() {
    return {
        log() {},
        warn() {},
        error() {},
    };
}
