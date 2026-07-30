import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEMO_SCENARIO } from '../../frontend/shared/src/demo-scenario.js';
import {
    bindAdaptivePresentationProfileHashes,
} from '../../frontend/shared/src/protocol.js';
import {
    createConfigService,
    issueVisualProjection,
    MemoryConfigStore,
    MemoryVisualProjectionStore,
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
    corsOrigin: 'http://127.0.0.1:8000,http://localhost:8000,http://127.0.0.1:8001',
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
            sillyTavernBaseUrl: 'http://127.0.0.1:8001',
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
            display_text: '倒塌的木屋被冷雨浸透，门口的泥里留着新鲜脚印。',
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
    assert.equal(canonicalVisible[2].text, '倒塌的木屋被冷雨浸透，门口的泥里留着新鲜脚印。');
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
    assert.equal(projectionResponse.evidence.sourceMessageHash, projectionResponse.projection.sourceMessageHash);
    assert.equal(projectionResponse.evidence.entityCount, projectionResponse.projection.entities.length);
    assert.equal(projectionResponse.projection.sourceMessageIndex, 2);
    assert.equal(projectionResponse.projection.entities.some((entity) => JSON.stringify(entity).includes('倒塌的木屋')), true);
    assert.equal(JSON.stringify(projectionResponse).includes('这段原始 mes 不应优先于 display_text'), false);
    assert.equal(projectionResponse.projection.entities.some((entity) => entity.entityType === 'character'), true);
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
    assert.equal(stubResponse.entities.length, projectionResponse.projection.entities.length);
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
            chatId: DEMO_SCENARIO.sillyTavernBindings.chatSeedId,
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
            catalogHash: testSha256('wrong-catalog'),
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
            oldSave: {
                saveId: 'save_visual_projection_001',
                saveBindingHash: testSha256('save-binding'),
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
            padding: 'x'.repeat(9000),
        }),
    });
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error, 'VISUAL_PROJECTION_REQUEST_TOO_LARGE');

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

    console.log('game config service visual projection issuer tests passed');
} finally {
    visualServer.close();
}

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
    return {
        protocolVersion: 'galgame.visual-projection-request.v1',
        idempotencyKey: 'idem_visual_projection_0001',
        releaseId: release.releaseId,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        arcId: release.activeArcId || release.arcId,
        chatId,
        sourceMessageIndex: 2,
        profileId: scope.profileId,
        profileHash: scope.profileHash,
        catalogId: scope.catalogId,
        catalogRevision: scope.catalogRevision,
        catalogHash: scope.catalogHash,
        dictionaryVersion: scope.dictionaryVersion,
        dictionaryHash: scope.dictionaryHash,
        ...overrides,
    };
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

function quietLogger() {
    return {
        log() {},
        warn() {},
        error() {},
    };
}
