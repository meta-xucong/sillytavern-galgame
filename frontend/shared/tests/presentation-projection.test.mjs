import assert from 'node:assert/strict';
import {
    allocateUniqueAssets,
    bindUniquePresentationAsset,
    consumeSceneContinuityProjection,
    createSceneContinuityProjection,
    presentationPortraitScopeKey,
    projectPartyRoster,
    projectPresentationIdentity,
    projectPresentationIdentityDetailed,
    reservePersistentPresentationAsset,
} from '../src/presentation-projection.js';

function message(index, text, persons = [], stateClaims = [], segments = []) {
    const entities = persons.map(({ ref, name, start, end, attributes = [] }) => ({
        mentionRef: ref,
        surfaceSpan: { start, end },
        kind: 'person',
        attributeEvidence: attributes,
    }));
    return {
        sourceMessageIndex: index,
        sourceMessageHash: `sha256:${String(index).padStart(64, '0')}`,
        visibleText: text,
        annotation: {
            sourceMessageHash: `sha256:${String(index).padStart(64, '0')}`,
            entities,
            stateClaims,
            segments: segments.map(({ ref, kind = 'dialogue' }, segmentIndex) => ({
                kind,
                speakerMentionRef: ref,
                segmentIndex,
            })),
        },
    };
}

const find = (text, value, offset = 0) => {
    const all = Array.from(text);
    const needle = Array.from(value);
    for (let start = offset; start <= all.length - needle.length; start += 1) {
        if (needle.every((part, index) => all[start + index] === part)) return { start, end: start + needle.length };
    }
    throw new Error(`Unable to find ${value}`);
};

const t0 = '😀Celestia：我们出发。\n旁白：夜色降临。';
const p0 = find(t0, 'Celestia');
const t1 = 'Celestia点头。';
const p1 = find(t1, 'Celestia');
const timeline = [
    message(0, t0, [{ ref: 'm0', name: 'Celestia', ...p0 }], [], [
        { ref: 'm0' }, { ref: null, kind: 'narration' }, { ref: null, kind: 'status' },
        { ref: null, kind: 'choice' }, { ref: null, kind: 'stage-direction' },
        { ref: null, kind: 'other-visible' }, { ref: null, kind: 'unattributed-dialogue' },
    ]),
    message(1, t1, [{ ref: 'm0', name: 'Celestia', ...p1 }], [], [{ ref: 'm0' }]),
];
const projected = await projectPresentationIdentity({
    chatKey: 'chat-a', releaseId: 'release-a', messages: timeline,
    publishedCast: [{ id: 'cast-celestia', name: 'Celestia', aliases: [] }],
});
assert.equal(projected.entities.length, 1);
assert.deepEqual(projected.entities[0].identityRef, { type: 'published', id: 'cast-celestia' });
assert.equal(projected.segmentSpeakers[0].resolvedSpeakerRef.id, 'cast-celestia');
assert.equal(projected.segmentSpeakers[1].resolvedSpeakerRef, null);
for (const nonSpeechSegment of projected.segmentSpeakers.slice(2, 6)) {
    assert.equal(nonSpeechSegment.resolvedSpeakerRef, null, 'non-speech display segments have no speaker identity');
}
assert.deepEqual(projected.segmentSpeakers[6].resolvedSpeakerRef, { type: 'unknown' }, 'unattributed dialogue remains unknown speaker');

const sameName = await projectPresentationIdentity({ chatKey: 'chat-a', releaseId: 'release-a', messages: timeline });
assert.equal(sameName.entities.length, 1);
assert.equal(sameName.entities[0].identityRef.type, 'chat-local');
assert.equal(sameName.entities[0].identityRef.id, (await projectPresentationIdentity({ chatKey: 'chat-a', releaseId: 'release-a', messages: timeline })).entities[0].identityRef.id);

const duplicate = '林 和 林。';
const firstLin = find(duplicate, '林');
const secondLin = find(duplicate, '林', firstLin.end + 1);
const ambiguousTimeline = [message(4, duplicate, [
    { ref: 'm0', name: '林', ...firstLin }, { ref: 'm1', name: '林', ...secondLin },
], [], [{ ref: 'm0' }, { ref: 'm1' }])];
const ambiguous = await projectPresentationIdentity({ chatKey: 'chat-a', releaseId: 'release-a', messages: ambiguousTimeline });
assert.equal(ambiguous.entities.length, 2);
assert.notEqual(ambiguous.entities[0].identityRef.id, ambiguous.entities[1].identityRef.id);

const [joinStart, joinEnd] = [0, 9];
const joinedText = '林加入队伍。';
const rosterTimeline = [message(0, joinedText, [{ ref: 'm0', name: '林', ...find(joinedText, '林') }], [{
    claimType: 'party.join', targetMentionRef: 'm0', memberMentionRefs: [], rosterSnapshotCompleteness: null,
    evidenceSpans: [{ start: joinStart, end: joinEnd, purpose: 'state' }],
}], [])];
const detailed = await projectPresentationIdentityDetailed({ chatKey: 'c', releaseId: 'r', messages: rosterTimeline });
const roster = projectPartyRoster({ chatKey: 'c', releaseId: 'r', messages: rosterTimeline, identityProjection: detailed });
assert.equal(roster.complete, true);
assert.equal(roster.entries[0].membership, 'member');

const conflictMessage = message(1, '林离队又加入。', [{ ref: 'm0', name: '林', ...find('林离队又加入。', '林') }], [
    { claimType: 'party.leave', targetMentionRef: 'm0', memberMentionRefs: [], rosterSnapshotCompleteness: null, evidenceSpans: [{ start: 0, end: 2, purpose: 'state' }] },
    { claimType: 'party.join', targetMentionRef: 'm0', memberMentionRefs: [], rosterSnapshotCompleteness: null, evidenceSpans: [{ start: 2, end: 5, purpose: 'state' }] },
], []);
const conflictTimeline = [...rosterTimeline, conflictMessage];
const conflictIdentity = await projectPresentationIdentityDetailed({ chatKey: 'c', releaseId: 'r', messages: conflictTimeline });
const conflictRoster = projectPartyRoster({ chatKey: 'c', releaseId: 'r', messages: conflictTimeline, identityProjection: conflictIdentity });
assert.equal(conflictRoster.entries[0].membership, 'unknown');
assert.deepEqual(conflictRoster.conflicts[0].sourceMessageIndices, [1]);

const partial = projectPartyRoster({ chatKey: 'c', releaseId: 'r', messages: [...rosterTimeline, { sourceMessageIndex: 2, sourceMessageHash: 'x' }], identityProjection: detailed });
assert.equal(partial.complete, false);
assert.equal(partial.entries[0].membership, 'member');

const rosterSnapshotText = '队伍成员：旅人。';
const snapshotTimeline = [
    ...rosterTimeline,
    message(1, rosterSnapshotText, [{ ref: 'm0', name: '旅人', ...find(rosterSnapshotText, '旅人') }], [{
        claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'], rosterSnapshotCompleteness: 'complete',
        evidenceSpans: [{ start: 0, end: Array.from(rosterSnapshotText).length, purpose: 'state' }],
    }], []),
];
const snapshotIdentity = await projectPresentationIdentityDetailed({ chatKey: 'c', releaseId: 'r', messages: snapshotTimeline });
const snapshotRoster = projectPartyRoster({ chatKey: 'c', releaseId: 'r', messages: snapshotTimeline, identityProjection: snapshotIdentity });
assert.equal(snapshotRoster.entries.find((entry) => entry.identityRef.id === detailed.projection.entities[0].identityRef.id).membership, 'not-member');
assert.equal(snapshotRoster.entries.find((entry) => entry.identityRef.id !== detailed.projection.entities[0].identityRef.id).membership, 'member');

const multiRosterText = '队伍成员：林、米拉。';
const linSpan = find(multiRosterText, '林');
const miraSpan = find(multiRosterText, '米拉');
const multiRosterMessage = message(0, multiRosterText, [
    { ref: 'm0', name: '林', ...linSpan },
    { ref: 'm1', name: '米拉', ...miraSpan },
], [{
    claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0', 'm1'], rosterSnapshotCompleteness: 'partial',
    evidenceSpans: [
        { ...linSpan, purpose: 'state' },
        { ...miraSpan, purpose: 'state' },
    ],
}], []);
const multiRosterIdentity = await projectPresentationIdentityDetailed({ chatKey: 'c', releaseId: 'r', messages: [multiRosterMessage] });
const multiRoster = projectPartyRoster({ chatKey: 'c', releaseId: 'r', messages: [multiRosterMessage], identityProjection: multiRosterIdentity });
assert.deepEqual(multiRoster.entries.map((entry) => [entry.evidence.at(-1).start, entry.evidence.at(-1).end]).sort((a, b) => a[0] - b[0]), [linSpan, miraSpan].map(({ start, end }) => [start, end]).sort((a, b) => a[0] - b[0]), 'each roster member retains its own supporting evidence span');

const unique = allocateUniqueAssets([], [
    { identityRef: { type: 'chat-local', id: 'b' }, assetId: 'portrait-1', confidence: 0.99, minimumConfidence: 0.8, margin: 0.5, minimumMargin: 0.1, firstMention: { sourceMessageIndex: 2, start: 0 } },
    { identityRef: { type: 'chat-local', id: 'a' }, assetId: 'portrait-1', confidence: 0.9, minimumConfidence: 0.8, margin: 0.2, minimumMargin: 0.1, firstMention: { sourceMessageIndex: 1, start: 3 } },
    { identityRef: { type: 'chat-local', id: 'a' }, assetId: 'portrait-2', confidence: 0.99, minimumConfidence: 0.8, margin: 0.5, minimumMargin: 0.1, firstMention: { sourceMessageIndex: 3, start: 0 } },
]);
assert.equal(unique.length, 1);
assert.equal(unique[0].identityRef.id, 'a', 'first mention order wins a one-to-one portrait allocation');
const firstPortrait = bindUniquePresentationAsset([], 'character:a', 'portrait-1:1');
assert.equal(firstPortrait.accepted, true);
assert.equal(bindUniquePresentationAsset(firstPortrait.bindings, 'character:a', 'portrait-1:1').accepted, true, 'same character keeps its original portrait');
assert.equal(bindUniquePresentationAsset(firstPortrait.bindings, 'character:a', 'portrait-2:1').accepted, false, 'bound character cannot silently switch portraits');
assert.equal(bindUniquePresentationAsset(firstPortrait.bindings, 'character:b', 'portrait-1:1').accepted, false, 'another character cannot reuse a reserved portrait');
const longPortraitLedger = Array.from({ length: 160 }, (_, index) => ({ identityKey: `character:${index}`, assetKey: `portrait-${index}:1` }));
assert.equal(bindUniquePresentationAsset(longPortraitLedger, 'character:new', 'portrait-0:1').accepted, false, 'old reservations remain active after more than 128 characters');
assert.equal(bindUniquePresentationAsset(longPortraitLedger, 'character:new', 'portrait-new:1').bindings.length, 161, 'portrait ledger does not evict old bindings');
assert.equal(presentationPortraitScopeKey({ chatId: 'chat-a', releaseId: 'release-a', arcId: 'arc-1' }), presentationPortraitScopeKey({ chatId: 'chat-a', releaseId: 'release-a', arcId: 'arc-2' }), 'portrait reservation survives Arc changes within the same chat/release');

const continuityScope = {
    chatId: 'fixture-chat', releaseId: 'fixture-release', arcId: null, catalogId: 'fixture-catalog', catalogRevision: 1,
    catalogHash: 'sha256:7fc58396c2dcf1684849862201f847ad76a2efe04111a3224a2be7aa02d23e42',
};
const sceneFixtures = [
    {
        pageText: '此刻仍在城堡，明天计划去港口。', previousVerifiedSceneKey: 'scene:castle', expected: 'continued',
        projection: {
            schemaVersion: 'galgame.scene-continuity.v1', scope: continuityScope,
            segment: { messageId: 'fixture-message-1', pageIndex: 0, pageTextSha256: 'sha256:9863a1c0de69f6b0d035d30b98937141f9f37454cc07cc576648c4eefe2ee620' },
            state: 'continued', sceneEntityKeys: ['scene:castle', 'scene:harbor'], currentSceneKey: 'scene:castle',
            evidenceSpans: [
                { start: 4, end: 6, relation: 'current-location', sceneEntityKey: 'scene:castle', destinationSceneKey: null },
                { start: 12, end: 14, relation: 'referenced-location', sceneEntityKey: 'scene:harbor', destinationSceneKey: null },
            ],
        },
    },
    {
        pageText: '众人终于抵达港口。', previousVerifiedSceneKey: 'scene:castle', expected: 'changed',
        projection: {
            schemaVersion: 'galgame.scene-continuity.v1', scope: continuityScope,
            segment: { messageId: 'fixture-message-2', pageIndex: 0, pageTextSha256: 'sha256:4c1657e0f44bb1d1911aa94ede956583e23539aead1f4b283f33955e6ef95a29' },
            state: 'changed', sceneEntityKeys: ['scene:harbor'], currentSceneKey: 'scene:harbor',
            evidenceSpans: [
                { start: 4, end: 6, relation: 'transition-action', sceneEntityKey: null, destinationSceneKey: 'scene:harbor' },
                { start: 6, end: 8, relation: 'current-location', sceneEntityKey: 'scene:harbor', destinationSceneKey: null },
            ],
        },
    },
    {
        pageText: '港口😀，远处仍是城堡。', previousVerifiedSceneKey: 'scene:castle', expected: 'continued',
        projection: {
            schemaVersion: 'galgame.scene-continuity.v1', scope: continuityScope,
            segment: { messageId: 'fixture-message-3', pageIndex: 0, pageTextSha256: 'sha256:ad746554a7e1b30ef478ecce99dd1bf7d8b89668a0a75bd1c1ee2d6d72e34ac2' },
            state: 'continued', sceneEntityKeys: ['scene:castle', 'scene:harbor'], currentSceneKey: 'scene:castle',
            evidenceSpans: [
                { start: 0, end: 2, relation: 'referenced-location', sceneEntityKey: 'scene:harbor', destinationSceneKey: null },
                { start: 9, end: 11, relation: 'current-location', sceneEntityKey: 'scene:castle', destinationSceneKey: null },
            ],
        },
    },
];
for (const fixture of sceneFixtures) {
    const consumed = await consumeSceneContinuityProjection({
        pageText: fixture.pageText, projection: fixture.projection, expectedScope: continuityScope,
        previousScope: continuityScope, previousVerifiedSceneKey: fixture.previousVerifiedSceneKey,
    });
    assert.equal(consumed.state, fixture.expected, `scene fixture ${fixture.projection.segment.messageId}`);
    assert.equal(consumed.action, fixture.expected === 'changed' ? 'clear-before-match' : 'preserve');
}
const producerProjection = await createSceneContinuityProjection({
    scope: continuityScope, messageId: 'fixture-produced', pageIndex: 0, pageText: '当前在城堡。', state: 'continued',
    sceneEntityKeys: ['scene:castle'], currentSceneKey: 'scene:castle',
    evidenceSpans: [{ start: 3, end: 5, relation: 'current-location', sceneEntityKey: 'scene:castle', destinationSceneKey: null }],
});
assert.equal(producerProjection.segment.pageTextSha256, 'sha256:' + await (async () => {
    const bytes = new TextEncoder().encode('当前在城堡。');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
})(), 'producer hashes exact unnormalized page text');
const producerConsumed = await consumeSceneContinuityProjection({
    pageText: '当前在城堡。', projection: producerProjection, expectedScope: continuityScope,
    previousScope: continuityScope, previousVerifiedSceneKey: 'scene:castle',
});
assert.equal(producerConsumed.state, 'continued');

const malformedCases = [];
const badHash = structuredClone(sceneFixtures[0].projection);
badHash.segment.pageTextSha256 = `sha256:${'0'.repeat(64)}`;
malformedCases.push([sceneFixtures[0].pageText, badHash, 'page-hash-mismatch']);
const badRange = structuredClone(sceneFixtures[0].projection);
badRange.evidenceSpans[0].end = 99;
malformedCases.push([sceneFixtures[0].pageText, badRange, 'evidence-span-invalid']);
const missingDestination = structuredClone(sceneFixtures[1].projection);
missingDestination.evidenceSpans[0].destinationSceneKey = null;
malformedCases.push([sceneFixtures[1].pageText, missingDestination, 'transition-evidence-invalid']);
const unknownState = structuredClone(sceneFixtures[0].projection);
unknownState.state = 'unclassified';
malformedCases.push([sceneFixtures[0].pageText, unknownState, 'state-invalid']);
const splitEmoji = structuredClone(sceneFixtures[2].projection);
splitEmoji.evidenceSpans[0].start = 3;
splitEmoji.evidenceSpans[0].end = 4;
malformedCases.push([sceneFixtures[2].pageText, splitEmoji, 'evidence-span-splits-surrogate']);
for (const [pageText, projection, reason] of malformedCases) {
    const consumed = await consumeSceneContinuityProjection({
        pageText, projection, expectedScope: continuityScope, previousScope: continuityScope,
        previousVerifiedSceneKey: 'scene:castle',
    });
    assert.equal(consumed.state, 'unknown');
    assert.equal(consumed.action, 'preserve');
    assert.equal(consumed.sceneKey, 'scene:castle');
    assert.equal(consumed.reasonCode, reason);
}
for (const scopeKey of ['chatId', 'releaseId', 'arcId', 'catalogId', 'catalogRevision', 'catalogHash']) {
    const changedScope = { ...continuityScope, [scopeKey]: scopeKey === 'arcId' ? 'arc-changed'
        : scopeKey === 'catalogRevision' ? 2
            : scopeKey === 'catalogHash' ? `sha256:${'a'.repeat(64)}` : `${continuityScope[scopeKey]}-changed` };
    const invalidProjection = { ...sceneFixtures[0].projection, segment: { ...sceneFixtures[0].projection.segment, pageTextSha256: 'bad' } };
    const consumed = await consumeSceneContinuityProjection({
        pageText: sceneFixtures[0].pageText, projection: invalidProjection, expectedScope: changedScope,
        previousScope: continuityScope, previousVerifiedSceneKey: 'scene:castle',
    });
    assert.deepEqual(consumed, { state: 'scope-changed', action: 'reset-to-default', sceneKey: null, reasonCode: 'scope-changed' }, `${scopeKey} change invalidates before projection checks`);
}

const portraitStorageMap = new Map();
const portraitStorage = {
    getItem(key) { return portraitStorageMap.get(key) ?? null; },
    setItem(key, value) { portraitStorageMap.set(key, value); },
};
const persistentPortrait = reservePersistentPresentationAsset({
    storage: portraitStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:a', assetKey: 'portrait-a:1',
});
assert.equal(persistentPortrait.accepted, true, 'a new portrait is accepted only after persistence');
assert.equal(reservePersistentPresentationAsset({
    storage: portraitStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:b', assetKey: 'portrait-a:1',
}).accepted, false, 'persisted portrait reservation prevents another identity from reusing it');
portraitStorage.setItem('portrait-ledger', JSON.stringify({
    'chat/release': [
        { identityKey: 'character:old', assetKey: 'narrator-symbol:1' },
        { identityKey: 'character:other', assetKey: 'portrait-other:1' },
    ],
}));
const repairedSpecialChannelReservation = reservePersistentPresentationAsset({
    storage: portraitStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:old', assetKey: 'portrait-rebound:1',
    invalidatedAssetKeys: ['narrator-symbol:1', 'player-placeholder:1'],
});
assert.equal(repairedSpecialChannelReservation.accepted, true, 'a previously misbound special-channel image can be replaced from an explicit policy list');
assert.equal(repairedSpecialChannelReservation.removedInvalidatedBindings, 1);
assert.deepEqual(JSON.parse(portraitStorage.getItem('portrait-ledger'))['chat/release'], [
    { identityKey: 'character:other', assetKey: 'portrait-other:1' },
    { identityKey: 'character:old', assetKey: 'portrait-rebound:1' },
], 'only the explicitly invalidated derived portrait reservation is removed');
assert.equal(reservePersistentPresentationAsset({
    storage: portraitStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:forbidden', assetKey: 'narrator-symbol:1',
    invalidatedAssetKeys: ['narrator-symbol:1'],
}).reason, 'asset-ineligible', 'an explicitly special-channel asset cannot be rebound to a character');
assert.equal(reservePersistentPresentationAsset({
    storage: portraitStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:other', assetKey: 'portrait-other:2',
}).accepted, false, 'ordinary existing identity bindings remain immutable');
const blockedReadStorage = { getItem() { throw new Error('storage denied'); }, setItem() {} };
assert.deepEqual(reservePersistentPresentationAsset({
    storage: blockedReadStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:c', assetKey: 'portrait-c:1',
}), { accepted: false, reason: 'storage-unavailable', bindings: [] }, 'blocked reads fail closed');
const blockedWriteStorage = { getItem() { return null; }, setItem() { throw new Error('quota exceeded'); } };
assert.deepEqual(reservePersistentPresentationAsset({
    storage: blockedWriteStorage, storageKey: 'portrait-ledger', scope: 'chat/release',
    identityKey: 'character:c', assetKey: 'portrait-c:1',
}), { accepted: false, reason: 'storage-unavailable', bindings: [] }, 'quota/write failures fail closed');
console.log('presentation-projection: PASS');
