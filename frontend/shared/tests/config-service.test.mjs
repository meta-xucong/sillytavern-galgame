import assert from 'node:assert/strict';
import { DEMO_SCENARIO } from '../src/demo-scenario.js';
import { bindAdaptivePresentationProfileHashes, createActiveRelease } from '../src/protocol.js';
import {
    ConfigReleaseStore,
    GameConfigServiceClient,
    getConfigServiceRuntime,
} from '../src/config-service.js';
import {
    LocalReleaseStore,
    MemoryStorageBackend,
} from '../src/storage.js';

const defaultArcId = DEMO_SCENARIO.defaultArcId;
const boundScenario = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO);
const boundCharacter = boundScenario.sillyTavernBindings.characters[0];
const boundWorldBook = boundScenario.sillyTavernBindings.worldBooks[0];
const remoteRelease = {
    ...createActiveRelease(boundScenario),
    releaseId: 'rel_remote_001',
    manifestUrl: `/v1/scenarios/${boundScenario.id}/versions/${boundScenario.version}/manifest`,
};
const calls = [];
const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === 'https://config.example/v1/admin/health') {
        return jsonResponse({ ok: true });
    }
    if (url === 'https://config.example/v1/releases/active') {
        return jsonResponse(remoteRelease);
    }
    if (url === 'https://config.example/v1/scenarios') {
        return jsonResponse({
            entries: [{
                entryId: `${boundScenario.id}@${boundScenario.version}#${defaultArcId}`,
                scenarioId: boundScenario.id,
                scenarioVersion: boundScenario.version,
                title: boundScenario.title,
                arcId: defaultArcId,
                arcTitle: boundScenario.arcs[0].title,
                release: remoteRelease,
                isDefault: true,
            }],
        });
    }
    if (url === 'https://config.example/v1/admin/scenarios') {
        return jsonResponse({
            stories: [{
                scenarioId: boundScenario.id,
                scenarioVersion: boundScenario.version,
                title: boundScenario.title,
                arcCount: 1,
                playableArcCount: 1,
                ready: true,
            }],
        });
    }
    if (url === 'https://config.example/v1/runtime-bridge/proofs') {
        const body = JSON.parse(options.body || '{}');
        assert.equal(body.protocolVersion, 'galgame.runtime-bridge-proof-request.v1');
        assert.equal(body.releaseId, remoteRelease.releaseId);
        assert.equal(body.scenarioId, remoteRelease.scenarioId);
        assert.equal(body.scenarioVersion, remoteRelease.scenarioVersion);
        assert.equal(body.arcId, defaultArcId);
        assert.equal(body.chatId, 'galgame-live-chat-001');
        assert.equal(body.character.avatar, boundCharacter.avatar);
        assert.equal(JSON.stringify(body).includes(boundWorldBook.name), false);
        assert.equal(JSON.stringify(body).includes('personality'), false);
        return jsonResponse({
            ok: true,
            proof: {
                protocolVersion: 'galgame.original-runtime-bridge-proof.v1',
                audience: 'original-runtime-bridge',
                binding: {
                    release: {
                        releaseId: remoteRelease.releaseId,
                        scenarioId: remoteRelease.scenarioId,
                scenarioVersion: remoteRelease.scenarioVersion,
                arcId: defaultArcId,
            },
                    target: {
                        type: 'character',
                        characterId: boundCharacter.id,
                        avatar: boundCharacter.avatar,
                    },
                    chat: {
                        chatId: 'galgame-live-chat-001',
                        chatSeedId: boundScenario.sillyTavernBindings.chatSeedId,
                        allowedChatIds: ['galgame-live-chat-001', boundScenario.sillyTavernBindings.chatSeedId],
                    },
                },
                signature: 'signed-by-config-service',
            },
        });
    }
    if (url === `https://config.example/v1/scenarios/${boundScenario.id}/versions/${boundScenario.version}/manifest`) {
        return jsonResponse(boundScenario);
    }
    if (url === 'https://config.example/v1/admin/scenarios/import') {
        return jsonResponse({ ok: true });
    }
    if (url === `https://config.example/v1/admin/scenarios/${boundScenario.id}/versions/${boundScenario.version}/validate`) {
        return jsonResponse({ valid: true, errors: [], warnings: [] });
    }
    if (url === 'https://config.example/v1/admin/releases' && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        assert.equal(body.activeArcId, defaultArcId);
        return jsonResponse({
            release: {
                ...remoteRelease,
                releaseId: 'rel_remote_002',
                activeArcId: defaultArcId,
                arcId: defaultArcId,
            },
        });
    }
    if (url === 'https://config.example/v1/admin/releases' && options.method === 'GET') {
        return jsonResponse({ releases: [remoteRelease] });
    }
    if (url === 'https://config.example/v1/admin/releases/rel_remote_001/rollback') {
        return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: 'not found' }, 404);
};

const runtime = getConfigServiceRuntime({
    documentRef: {
        querySelector: () => ({
            getAttribute: () => 'https://config.example/',
        }),
    },
    globalRef: {},
});
assert.equal(runtime.endpoint, 'https://config.example');

const client = new GameConfigServiceClient({
    endpoint: 'https://config.example/',
    fetchImpl: fakeFetch,
});
assert.equal(client.isReady(), true);
assert.equal((await client.healthCheck()).ok, true);
assert.equal((await client.getActiveRelease()).releaseId, 'rel_remote_001');
assert.equal((await client.listPlayableScenarios()).length, 1);
assert.equal((await client.listStoredScenarios())[0].ready, true);
assert.equal((await client.getManifest(remoteRelease)).id, boundScenario.id);
const runtimeProof = await client.issueRuntimeBridgeProof({
    release: remoteRelease,
    manifest: boundScenario,
    snapshot: {
        fileName: 'galgame-live-chat-001',
        character: {
            avatar: 'stale-avatar-from-an-old-save.png',
        },
    },
});
assert.equal(runtimeProof.signature, 'signed-by-config-service');
const publishedDefaultArc = await client.publishManifest(boundScenario, { activeArcId: defaultArcId });
assert.equal(publishedDefaultArc.ok, true);
assert.equal(publishedDefaultArc.release.activeArcId, defaultArcId);
assert.equal((await client.listReleases()).length, 1);
assert.equal(await client.rollback('rel_remote_001'), true);
assert.equal(calls[0].options.credentials, 'include');

const localStore = new LocalReleaseStore(boundScenario, new MemoryStorageBackend());
const releaseStore = new ConfigReleaseStore(boundScenario, {
    client,
    localStore,
});
const bundle = await releaseStore.getActiveBundle();
assert.equal(bundle.mode, 'external-config-service');
assert.equal(bundle.release.releaseId, 'rel_remote_001');
assert.equal(bundle.manifest.id, boundScenario.id);
assert.equal((await releaseStore.listPlayableScenarios()).length, 1);
assert.equal((await releaseStore.listStoredScenarios()).length, 1);
const selectedBundle = await releaseStore.getBundleForPlayableScenario((await releaseStore.listPlayableScenarios())[0]);
assert.equal(selectedBundle.manifest.id, boundScenario.id);
assert.equal(selectedBundle.release.releaseId, remoteRelease.releaseId);
const storeProof = await releaseStore.issueRuntimeBridgeProof({
    release: bundle.release,
        manifest: bundle.manifest,
    snapshot: {
        fileName: 'galgame-live-chat-001',
        character: {
            avatar: boundCharacter.avatar,
        },
    },
});
assert.equal(storeProof.signature, 'signed-by-config-service');
assert.equal(
    (await releaseStore.getManifestByVersion(boundScenario.id, boundScenario.version)).id,
    boundScenario.id,
);
const directManifestCalls = [];
const manifestOnlyClient = new GameConfigServiceClient({
    endpoint: 'https://config.example/',
    fetchImpl: async (url) => {
        directManifestCalls.push(url);
        if (url === `https://config.example/v1/scenarios/${boundScenario.id}/versions/${boundScenario.version}/manifest`) {
            return jsonResponse(boundScenario);
        }
        return jsonResponse({ error: 'not found' }, 404);
    },
});
const configOnlyStore = new ConfigReleaseStore(null, { client: manifestOnlyClient });
assert.equal(
    (await configOnlyStore.getManifestByVersion(boundScenario.id, boundScenario.version)).id,
    boundScenario.id,
);
assert.deepEqual(directManifestCalls, [`https://config.example/v1/scenarios/${boundScenario.id}/versions/${boundScenario.version}/manifest`]);

const tamperedReleaseClient = new GameConfigServiceClient({
    endpoint: 'https://config.example/',
    fetchImpl: async (url) => {
        if (url === 'https://config.example/v1/releases/active') {
            return jsonResponse({
                ...remoteRelease,
                presentationProfileHash: '',
            });
        }
        if (url === `https://config.example/v1/scenarios/${boundScenario.id}/versions/${boundScenario.version}/manifest`) {
            return jsonResponse(boundScenario);
        }
        return jsonResponse({ error: 'not found' }, 404);
    },
});
const tamperedReleaseStore = new ConfigReleaseStore(boundScenario, {
    client: tamperedReleaseClient,
    localStore: new LocalReleaseStore(boundScenario, new MemoryStorageBackend()),
});
await assert.rejects(
    () => tamperedReleaseStore.getActiveBundle(),
    /CONFIG_SERVICE_MANIFEST_INVALID/,
);

for (const [label, mutateRelease, mutateManifest = (manifest) => manifest] of [
    ['fallback-missing-profile-hash', (release) => ({ ...release, presentationProfileHash: '' })],
    ['fallback-wrong-profile-hash', (release) => ({ ...release, presentationProfileHash: 'fnv1a:deadbeef' })],
    ['fallback-wrong-profile-id', (release) => ({ ...release, presentationProfileId: 'wrong-profile' })],
    ['fallback-scenario-mismatch', (release) => ({ ...release, scenarioId: 'wrong-scenario' })],
    ['fallback-version-mismatch', (release) => ({ ...release, scenarioVersion: '9.9.9' })],
    ['fallback-arc-mismatch', (release) => ({ ...release, activeArcId: 'missing-arc', arcId: 'missing-arc' })],
    ['fallback-manifest-profile-changed', (release) => release, (manifest) => ({
        ...manifest,
        adaptivePresentationProfiles: {
            ...manifest.adaptivePresentationProfiles,
            [manifest.arcs[0].presentationProfileId]: {
                ...manifest.adaptivePresentationProfiles[manifest.arcs[0].presentationProfileId],
                template: 'mystery-investigation',
            },
        },
    })],
]) {
    const invalidRelease = mutateRelease(remoteRelease);
    const invalidManifest = mutateManifest(boundScenario);
    const invalidFallbackClient = new GameConfigServiceClient({
        endpoint: 'https://config.example/',
        fetchImpl: async (url) => {
            if (url === 'https://config.example/v1/releases/active') {
                return jsonResponse(invalidRelease);
            }
            if (
                url === invalidRelease.manifestUrl
                || url === `https://config.example${invalidRelease.manifestUrl}`
                || url === `https://config.example/v1/scenarios/${invalidRelease.scenarioId}/versions/${invalidRelease.scenarioVersion}/manifest`
            ) {
                return jsonResponse(invalidManifest);
            }
            return jsonResponse({ error: 'not found' }, 404);
        },
    });
    const invalidFallbackStore = new ConfigReleaseStore(boundScenario, {
        client: invalidFallbackClient,
        localStore,
        fallbackToLocal: true,
    });
    await assert.rejects(
        () => invalidFallbackStore.getActiveBundle(),
        /CONFIG_SERVICE_MANIFEST_INVALID/,
        label,
    );
}

const activeNotFoundClient = new GameConfigServiceClient({
    endpoint: 'https://config.example/',
    fetchImpl: async (url) => {
        if (url === 'https://config.example/v1/releases/active') {
            return jsonResponse({ error: 'ACTIVE_RELEASE_UNAVAILABLE' }, 404);
        }
        return jsonResponse({ error: 'not found' }, 404);
    },
});
const activeNotFoundFallbackStore = new ConfigReleaseStore(boundScenario, {
    client: activeNotFoundClient,
    localStore,
    fallbackToLocal: true,
});
await assert.rejects(
    () => activeNotFoundFallbackStore.getActiveBundle(),
    /ACTIVE_RELEASE_UNAVAILABLE/,
);

const failingClient = new GameConfigServiceClient({
    endpoint: 'https://config.example',
    fetchImpl: async () => {
        throw new Error('offline');
    },
});
const failClosedStore = new ConfigReleaseStore(boundScenario, {
    client: failingClient,
    localStore,
});
await assert.rejects(
    () => failClosedStore.getActiveBundle(),
    /offline/,
);
assert.equal(await failClosedStore.issueRuntimeBridgeProof({
    release: remoteRelease,
    manifest: boundScenario,
    snapshot: { fileName: 'galgame-live-chat-001' },
}), null);

const missingConfigStore = new ConfigReleaseStore(null);
await assert.rejects(
    () => missingConfigStore.getActiveBundle(),
    /CONFIG_SERVICE_REQUIRED/,
);
assert.equal((await missingConfigStore.healthCheck()).ok, false);

const fallbackStore = new ConfigReleaseStore(boundScenario, {
    client: failingClient,
    localStore,
    fallbackToLocal: true,
});
const fallback = await fallbackStore.getActiveBundle();
assert.equal(fallback.mode, 'local-fallback');
assert.equal(fallback.release.releaseId, 'rel_remote_001');
assert.equal(await fallbackStore.issueRuntimeBridgeProof({
    release: fallback.release,
    manifest: fallback.manifest,
    snapshot: { fileName: 'galgame-live-chat-001' },
}), null);

console.log('config service tests passed');

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    });
}
