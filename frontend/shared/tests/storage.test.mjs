import assert from 'node:assert/strict';
import { DEMO_SCENARIO } from '../src/demo-scenario.js';
import {
    STORAGE_KEYS,
    bindAdaptivePresentationProfileHashes,
    createActiveRelease,
} from '../src/protocol.js';
import {
    LocalReleaseStore,
    MemoryStorageBackend,
    getMediaConfig,
    saveMediaConfig,
} from '../src/storage.js';

const backend = new MemoryStorageBackend();
const DEFAULT_SCENARIO = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO);
const releaseStore = new LocalReleaseStore(DEFAULT_SCENARIO, backend);
const defaultArcId = DEFAULT_SCENARIO.defaultArcId;
const alternateArcId = 'storage-test-alternate-arc';

const firstRelease = await releaseStore.getActiveRelease();
const secondRelease = await releaseStore.getActiveRelease();
assert.equal(firstRelease.releaseId, secondRelease.releaseId);

const activeManifest = await releaseStore.getActiveManifest();
assert.equal(activeManifest.id, DEFAULT_SCENARIO.id);
assert.equal(
    (await releaseStore.getManifestByVersion(DEFAULT_SCENARIO.id, DEFAULT_SCENARIO.version)).id,
    DEFAULT_SCENARIO.id,
);

const nextManifest = withScenarioVersion({
    ...DEMO_SCENARIO,
    version: '0.3.0',
    title: '当前故事 Plus',
}, '0.3.0');
const draftPublishResult = await releaseStore.publishManifest(nextManifest, { activeArcId: defaultArcId });
assert.equal(draftPublishResult.ok, false);
assert.equal(draftPublishResult.validation.errors.some((error) => error.includes('presentationProfileHash')), true);

const publishableNextManifest = bindAdaptivePresentationProfileHashes(nextManifest, { arcId: defaultArcId });
const staleProfileManifest = {
    ...publishableNextManifest,
    adaptivePresentationProfiles: {
        ...publishableNextManifest.adaptivePresentationProfiles,
        [publishableNextManifest.arcs[0].presentationProfileId]: {
            ...publishableNextManifest.adaptivePresentationProfiles[publishableNextManifest.arcs[0].presentationProfileId],
            template: 'mystery-investigation',
        },
    },
};
const staleProfilePublishResult = await releaseStore.publishManifest(staleProfileManifest, { activeArcId: defaultArcId });
assert.equal(staleProfilePublishResult.ok, false);
assert.equal(staleProfilePublishResult.validation.errors.some((error) => error.includes('presentationProfileHash')), true);

const publishResult = await releaseStore.publishManifest(publishableNextManifest, { activeArcId: defaultArcId });
assert.equal(publishResult.ok, true);
assert.equal((await releaseStore.listStoredScenarios()).some((story) => story.title === '当前故事 Plus'), true);
const playableStories = await releaseStore.listPlayableScenarios();
assert.equal(playableStories.some((story) => story.title === '当前故事 Plus'), true);
const selectedPlayableBundle = await releaseStore.getBundleForPlayableScenario(playableStories.find((story) => story.title === '当前故事 Plus'));
assert.equal(selectedPlayableBundle.manifest.title, '当前故事 Plus');

const publishedRelease = await releaseStore.getActiveRelease();
assert.equal(publishedRelease.scenarioVersion, '0.3.0');
assert.equal(publishedRelease.activeArcId, defaultArcId);
assert.equal((await releaseStore.listReleases()).length, 2);
assert.equal((await releaseStore.getActiveBundle()).manifest.title, '当前故事 Plus');
assert.equal((await releaseStore.getActiveBundle()).manifest.arcId, defaultArcId);

const multiArcManifest = bindAdaptivePresentationProfileHashes(withExtraArc(publishableNextManifest, alternateArcId), { arcId: alternateArcId });
const alternatePublishResult = await releaseStore.publishManifest(multiArcManifest, { activeArcId: alternateArcId });
assert.equal(alternatePublishResult.ok, true);
assert.equal(alternatePublishResult.release.activeArcId, alternateArcId);
assert.equal(Boolean(alternatePublishResult.release.presentationProfileHash), true);

const missingSeedManifest = withMissingArcSeed(multiArcManifest, alternateArcId);
const missingSeedPublishResult = await releaseStore.publishManifest(missingSeedManifest, { activeArcId: alternateArcId });
assert.equal(missingSeedPublishResult.ok, false);
assert.equal(missingSeedPublishResult.validation.errors.some((error) => error.includes('chatSeedId')), true);

const rolledBack = await releaseStore.rollback(firstRelease.releaseId);
assert.equal(rolledBack, true);
assert.equal((await releaseStore.getActiveRelease()).releaseId, firstRelease.releaseId);
assert.equal((await releaseStore.getActiveBundle()).release.activeArcId, defaultArcId);

await releaseStore.cachePublishedRelease(firstRelease, DEFAULT_SCENARIO);
assert.equal((await releaseStore.getActiveBundle()).release.releaseId, firstRelease.releaseId);

const staleBackend = new MemoryStorageBackend();
const staleManifest = {
    ...DEFAULT_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    id: 'stale-local-entry',
    version: '0.0.1',
    sillyTavernBindings: {
        ...DEFAULT_SCENARIO.sillyTavernBindings,
        chatSeedId: '',
    },
};
const staleRelease = createActiveRelease(staleManifest);
await staleBackend.set(`${STORAGE_KEYS.manifestPrefix}${staleManifest.id}@${staleManifest.version}`, staleManifest);
await staleBackend.set(STORAGE_KEYS.activeRelease, staleRelease);
await staleBackend.set(STORAGE_KEYS.releaseHistory, [staleRelease]);
const recoveredStore = new LocalReleaseStore(DEFAULT_SCENARIO, staleBackend);
await assert.rejects(
    () => recoveredStore.getActiveBundle(),
    /ACTIVE_RELEASE_PROFILE_INVALID/,
);

const emptyProfileHashBackend = new MemoryStorageBackend();
const emptyProfileHashRelease = {
    ...createActiveRelease(publishableNextManifest),
    presentationProfileHash: '',
};
await emptyProfileHashBackend.set(`${STORAGE_KEYS.manifestPrefix}${publishableNextManifest.id}@${publishableNextManifest.version}`, publishableNextManifest);
await emptyProfileHashBackend.set(STORAGE_KEYS.activeRelease, emptyProfileHashRelease);
await emptyProfileHashBackend.set(STORAGE_KEYS.releaseHistory, [emptyProfileHashRelease]);
await assert.rejects(
    () => new LocalReleaseStore(DEFAULT_SCENARIO, emptyProfileHashBackend).getActiveBundle(),
    /ACTIVE_RELEASE_PROFILE_INVALID/,
);

const oldBuiltInBackend = new MemoryStorageBackend();
const oldBuiltInManifest = {
    ...DEMO_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    id: 'galgame-test-aoi-entry',
    title: '雨见町测试入口',
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [
            {
                id: 'Galgame_Test_Aoi',
                role: 'main',
                avatar: 'galgame_test_aoi.png',
            },
        ],
        worldBooks: [
            {
                name: 'Galgame_Test_RainTown',
                mode: 'scene',
                weight: 100,
            },
        ],
        chatSeedId: 'galgame-test-aoi-rain-town',
    },
};
const oldBuiltInRelease = createActiveRelease(oldBuiltInManifest);
await oldBuiltInBackend.set(
    `${STORAGE_KEYS.manifestPrefix}${oldBuiltInManifest.id}@${oldBuiltInManifest.version}`,
    oldBuiltInManifest,
);
await oldBuiltInBackend.set(STORAGE_KEYS.activeRelease, oldBuiltInRelease);
await oldBuiltInBackend.set(STORAGE_KEYS.releaseHistory, [oldBuiltInRelease]);
const oldBuiltInStore = new LocalReleaseStore(DEFAULT_SCENARIO, oldBuiltInBackend);
const oldBuiltInRecovered = await oldBuiltInStore.getActiveBundle();
assert.equal(oldBuiltInRecovered.recovered, true);
assert.equal(oldBuiltInRecovered.reason, 'superseded-built-in-entry');
assert.equal(oldBuiltInRecovered.manifest.id, DEFAULT_SCENARIO.id);

const apartmentBuiltInBackend = new MemoryStorageBackend();
const apartmentBuiltInManifest = {
    ...DEMO_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    id: 'galgame-imported-apartment5c-entry',
    title: 'Apartment 5C 测试入口',
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [
            {
                id: 'Apartment 5C',
                role: 'narrator',
                avatar: 'galgame_imported_apartment5c.png',
            },
        ],
        worldBooks: [
            {
                name: 'Galgame_Imported_Apartment5C_Bundle',
                mode: 'character',
                weight: 100,
            },
        ],
        presetId: 'Galgame_Imported_Apartment5C_Preset',
        chatSeedId: 'galgame-imported-apartment5c-seed',
    },
};
const apartmentBuiltInRelease = createActiveRelease(apartmentBuiltInManifest);
await apartmentBuiltInBackend.set(
    `${STORAGE_KEYS.manifestPrefix}${apartmentBuiltInManifest.id}@${apartmentBuiltInManifest.version}`,
    apartmentBuiltInManifest,
);
await apartmentBuiltInBackend.set(STORAGE_KEYS.activeRelease, apartmentBuiltInRelease);
await apartmentBuiltInBackend.set(STORAGE_KEYS.releaseHistory, [apartmentBuiltInRelease]);
const apartmentBuiltInRecovered = await new LocalReleaseStore(DEFAULT_SCENARIO, apartmentBuiltInBackend).getActiveBundle();
assert.equal(apartmentBuiltInRecovered.recovered, true);
assert.equal(apartmentBuiltInRecovered.reason, 'superseded-built-in-entry');
assert.equal(apartmentBuiltInRecovered.manifest.id, DEFAULT_SCENARIO.id);

const luciferBuiltInBackend = new MemoryStorageBackend();
const luciferBuiltInManifest = {
    ...DEMO_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    id: 'galgame-imported-lucifer-arc1-entry',
    title: 'Lucifer：四幕测试入口',
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [
            {
                id: 'The Underworld & The Heavens',
                role: 'narrator',
                avatar: 'galgame_imported_lucifer_worlddirector.png',
            },
        ],
        worldBooks: [
            {
                name: 'Galgame_Imported_Lucifer_Arc1_Bundle',
                mode: 'character',
                weight: 100,
            },
        ],
        presetId: 'Galgame_Imported_Lucifer_Preset',
        chatSeedId: 'galgame-imported-lucifer-seed',
    },
};
const luciferBuiltInRelease = createActiveRelease(luciferBuiltInManifest);
await luciferBuiltInBackend.set(
    `${STORAGE_KEYS.manifestPrefix}${luciferBuiltInManifest.id}@${luciferBuiltInManifest.version}`,
    luciferBuiltInManifest,
);
await luciferBuiltInBackend.set(STORAGE_KEYS.activeRelease, luciferBuiltInRelease);
await luciferBuiltInBackend.set(STORAGE_KEYS.releaseHistory, [luciferBuiltInRelease]);
const luciferBuiltInRecovered = await new LocalReleaseStore(DEFAULT_SCENARIO, luciferBuiltInBackend).getActiveBundle();
assert.equal(luciferBuiltInRecovered.recovered, true);
assert.equal(luciferBuiltInRecovered.reason, 'superseded-built-in-entry');
assert.equal(luciferBuiltInRecovered.manifest.id, DEFAULT_SCENARIO.id);

const customBackend = new MemoryStorageBackend();
const customManifest = bindAdaptivePresentationProfileHashes(withScenarioIdentity(DEFAULT_SCENARIO, {
    id: 'custom-admin-entry',
    title: '管理员发布入口',
}));
const customRelease = createActiveRelease(customManifest);
await customBackend.set(`${STORAGE_KEYS.manifestPrefix}${customManifest.id}@${customManifest.version}`, customManifest);
await customBackend.set(STORAGE_KEYS.activeRelease, customRelease);
await customBackend.set(STORAGE_KEYS.releaseHistory, [customRelease]);
const customBundle = await new LocalReleaseStore(DEFAULT_SCENARIO, customBackend).getActiveBundle();
assert.equal(Boolean(customBundle.recovered), false);
assert.equal(customBundle.manifest.id, customManifest.id);

await saveMediaConfig({ enabled: true, endpoint: 'https://media.example' }, backend);
assert.equal((await getMediaConfig(backend)).endpoint, 'https://media.example');

console.log('storage tests passed');

function withScenarioVersion(manifest, version) {
    return {
        ...manifest,
        version,
        arcs: manifest.arcs.map((arc) => ({
            ...arc,
            scenarioVersion: version,
            arcBindingId: arc.arcBindingId.replace(`:${manifest.version}:`, `:${version}:`),
        })),
    };
}

function withScenarioIdentity(manifest, { id = manifest.id, version = manifest.version, title = manifest.title } = {}) {
    return {
        ...manifest,
        id,
        version,
        title,
        arcs: manifest.arcs.map((arc) => ({
            ...arc,
            scenarioId: id,
            scenarioVersion: version,
            arcBindingId: `${id}:${version}:${arc.arcId}:v1`,
        })),
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

function withMissingArcSeed(manifest, arcId) {
    return {
        ...manifest,
        arcs: manifest.arcs.map((arc) => arc.arcId === arcId
            ? {
                ...arc,
                sillyTavernBindings: {
                    ...arc.sillyTavernBindings,
                    target: {
                        ...arc.sillyTavernBindings.target,
                        chatSeedId: '',
                    },
                },
            }
            : arc),
    };
}
