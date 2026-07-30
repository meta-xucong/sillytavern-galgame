import assert from 'node:assert/strict';
import { DEMO_SCENARIO } from '../src/demo-scenario.js';
import {
    createActiveRelease,
    createAdaptivePresentationProfileHash,
    getAdaptivePresentationProfileForArc,
} from '../src/protocol.js';
import {
    AUTO_SAVE_ID,
    PLAYER_SAVE_PROTOCOL_VERSION,
    PlayerSaveStore,
    createCanonicalPlayerSaveRelease,
    createPlayerSaveSlot,
    manualSaveIds,
    normalizePlayerSaveSlot,
    validatePlayerSaveSlot,
} from '../src/player-save.js';
import { MemoryStorageBackend } from '../src/storage.js';

const release = createActiveRelease(DEMO_SCENARIO);
const snapshot = {
    ok: true,
    fileName: `${DEMO_SCENARIO.sillyTavernBindings.chatSeedId}-playtest`,
    messages: [
        {
            role: 'character',
            displayText: '薄明かりの奥で、誰かがあなたの名を呼んだ。',
            text: '薄明かりの奥で、誰かがあなたの名を呼んだ。',
        },
        {
            role: 'player',
            displayText: '扉の向こうへ進む。',
            text: '扉の向こうへ進む。',
        },
    ],
};

const slot = createPlayerSaveSlot({
    release,
    manifest: DEMO_SCENARIO,
    snapshot,
    pageIndex: 1,
    visualState: {
        backgroundId: 'default_stage',
        spriteIds: ['default_sprite'],
        bgmId: '',
        mediaJobIds: ['media-opening'],
    },
});

assert.equal(slot.protocolVersion, PLAYER_SAVE_PROTOCOL_VERSION);
assert.equal(slot.saveId, AUTO_SAVE_ID);
assert.equal(slot.releaseId, release.releaseId);
assert.equal(slot.scenarioId, DEMO_SCENARIO.id);
assert.equal(slot.scenarioVersion, DEMO_SCENARIO.version);
assert.equal(slot.arcId, DEMO_SCENARIO.defaultArcId);
assert.equal(slot.presentationProfileId, release.presentationProfileId);
assert.equal(slot.presentationProfileHash, createAdaptivePresentationProfileHash(getAdaptivePresentationProfileForArc(DEMO_SCENARIO, DEMO_SCENARIO.defaultArcId)));
assert.equal(slot.chatId, snapshot.fileName);
assert.equal(slot.lastMessageIndex, 1);
assert.equal(slot.pageIndex, 1);
assert.deepEqual(slot.visualState.mediaJobIds, ['media-opening']);

const validation = validatePlayerSaveSlot(slot);
assert.equal(validation.valid, true);

const legacyReleaseSlot = {
    ...slot,
    releaseId: 'local_legacy_release_that_is_no_longer_registered',
};
const canonicalRelease = createCanonicalPlayerSaveRelease(legacyReleaseSlot, DEMO_SCENARIO);
assert.match(canonicalRelease.releaseId, /^play_/);
assert.notEqual(canonicalRelease.releaseId, legacyReleaseSlot.releaseId);
assert.equal(canonicalRelease.scenarioId, slot.scenarioId);
assert.equal(canonicalRelease.scenarioVersion, slot.scenarioVersion);
assert.equal(canonicalRelease.activeArcId, slot.arcId);
assert.equal(canonicalRelease.presentationProfileHash, slot.presentationProfileHash);
assert.equal(
    createCanonicalPlayerSaveRelease({ ...legacyReleaseSlot, releaseId: 'rel_old_publish' }, DEMO_SCENARIO).releaseId,
    canonicalRelease.releaseId,
);
assert.throws(
    () => createCanonicalPlayerSaveRelease(legacyReleaseSlot, { ...DEMO_SCENARIO, version: 'other-version' }),
    /PLAYER_SAVE_MANIFEST_MISMATCH/,
);

for (const requiredProfileField of ['arcId', 'presentationProfileId', 'presentationProfileHash']) {
    const missingProfileBinding = {
        ...slot,
    };
    delete missingProfileBinding[requiredProfileField];
    assert.equal(validatePlayerSaveSlot(missingProfileBinding).valid, false, requiredProfileField);
    assert.throws(() => normalizePlayerSaveSlot(missingProfileBinding), /PLAYER_SAVE_INVALID/);
}

for (const forbiddenField of ['variables', 'node', 'ending', 'relationship', 'choice']) {
    const invalid = {
        ...slot,
        [forbiddenField]: 'must not be saved',
    };
    assert.equal(validatePlayerSaveSlot(invalid).valid, false, forbiddenField);
    assert.throws(() => normalizePlayerSaveSlot(invalid), /PLAYER_SAVE_INVALID/);
}

const nestedForbidden = {
    ...slot,
    visualState: {
        ...slot.visualState,
        variables: ['parallel-state'],
    },
};
assert.equal(validatePlayerSaveSlot(nestedForbidden).valid, false);

const unknownDisplayField = {
    ...slot,
    summary: 'local chat summary must not replace original chat',
};
assert.equal(validatePlayerSaveSlot(unknownDisplayField).valid, false);

const store = new PlayerSaveStore(new MemoryStorageBackend());
const saved = await store.saveSlot(slot);
assert.equal(saved.chatId, snapshot.fileName);
assert.equal((await store.loadSlot(AUTO_SAVE_ID)).releaseId, release.releaseId);

await store.saveSnapshot({
    saveId: manualSaveIds(1)[0],
    release,
    manifest: DEMO_SCENARIO,
    snapshot,
});
const slots = await store.listSlots();
assert.deepEqual(slots.map((item) => item.saveId), [AUTO_SAVE_ID, 'manual-1']);

console.log('player save tests passed');
