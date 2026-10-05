import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    createSceneContinuityHistoryCandidateListHash,
    createSceneContinuityHistoryCheckpoint,
    createSceneContinuityHistoryCheckpointKey,
    createSceneContinuityHistoryCandidate,
    createSceneContinuityHistoryTargetCursorHash,
    findLatestVerifiedSceneTransitionAnchor,
    getSceneContinuityHistoryCheckpointResumeOffset,
    parseSceneContinuityHistoryCheckpoint,
    serializeSceneContinuityHistoryCheckpoint,
} from '../src/scene-continuity-history.js';

const cursor = { scopeKey: 'scope-a', messageIndex: 9, pageIndex: 0 };
const makePage = (messageIndex, state, sourceRole = 'character', scopeKey = 'scope-a') => ({
    sourceRole,
    pageText: `page-${messageIndex}`,
    cursor: { scopeKey, messageIndex, pageIndex: 0 },
    result: state,
});

const runtimeShapedCandidate = createSceneContinuityHistoryCandidate({
    sourceRole: 'character',
    messageIndex: 6,
    pageIndex: 2,
    pageText: 'historical transition page',
}, 'scope-a');
assert.deepEqual(runtimeShapedCandidate?.cursor, {
    scopeKey: 'scope-a', messageIndex: 6, pageIndex: 2,
}, 'runtime candidates carry the cursor required by replay filtering');
const runtimeCandidateResult = await findLatestVerifiedSceneTransitionAnchor([runtimeShapedCandidate], {
    currentCursor: cursor,
    analyzePage: async (page) => ({
        state: 'changed', sceneKey: `scene-${page.cursor.messageIndex}`, timelineValidated: true,
    }),
});
assert.equal(runtimeCandidateResult?.page.cursor.messageIndex, 6,
    'a runtime-shaped historical candidate survives the production replay filter');
assert.equal(createSceneContinuityHistoryCandidate({ messageIndex: -1, pageIndex: 0 }, 'scope-a'), null,
    'invalid cursor coordinates cannot enter history replay');
const futureAndLaterPageCandidates = [
    createSceneContinuityHistoryCandidate({ sourceRole: 'character', messageIndex: 10, pageIndex: 0, pageText: 'future' }, 'scope-a'),
    createSceneContinuityHistoryCandidate({ sourceRole: 'character', messageIndex: 9, pageIndex: 1, pageText: 'later page' }, 'scope-a'),
];
assert.equal(await findLatestVerifiedSceneTransitionAnchor(futureAndLaterPageCandidates, {
    currentCursor: cursor,
    analyzePage: async () => assert.fail('future and later pages must never be replayed'),
}), null, 'future messages and later pages on the current message stay out of replay');

const pages = [
    makePage(2, 'changed'),
    makePage(4, 'continued', 'player'),
    makePage(5, 'unknown'),
    makePage(7, 'changed'),
    makePage(9, 'changed'), // the current page is never replayed
    makePage(8, 'changed', 'character', 'other-scope'),
];

const visited = [];
const latest = await findLatestVerifiedSceneTransitionAnchor(pages, {
    currentCursor: cursor,
    analyzePage: async (page, { contextPages }) => {
        visited.push(page.cursor.messageIndex);
        assert.ok(contextPages.length <= 2);
        return page.result === 'changed'
            ? { state: 'changed', sceneKey: `scene-${page.cursor.messageIndex}`, timelineValidated: true }
            : { state: page.result, sceneKey: null, timelineValidated: true };
    },
});
assert.equal(latest?.page.cursor.messageIndex, 7, 'latest earlier changed transition wins');
assert.deepEqual(visited, [7], 'reverse scan stops at the nearest verified transition');

const failures = [];
const afterProviderFailure = await findLatestVerifiedSceneTransitionAnchor([
    makePage(3, 'changed'), makePage(7, 'changed'), makePage(8, 'unknown'),
], {
    currentCursor: cursor,
    analyzePage: async (page) => {
        if (page.cursor.messageIndex === 8) throw new Error('provider timeout');
        return { state: page.result, sceneKey: `scene-${page.cursor.messageIndex}`, timelineValidated: true };
    },
    onCandidateError: (page) => failures.push(page.cursor.messageIndex),
});
assert.equal(afterProviderFailure?.page.cursor.messageIndex, 7, 'a failed newer page does not hide an older verified transition');
assert.deepEqual(failures, [8], 'candidate failure is isolated and reported without response contents');

const boundedVisited = [];
await findLatestVerifiedSceneTransitionAnchor([
    makePage(2, 'changed'), makePage(3, 'changed'), makePage(4, 'changed'), makePage(5, 'changed'),
], {
    currentCursor: cursor,
    limit: 2,
    analyzePage: async (page) => {
        boundedVisited.push(page.cursor.messageIndex);
        return { state: 'unknown', timelineValidated: true };
    },
});
assert.deepEqual(boundedVisited, [5, 4], 'replay respects the configured page budget');

const resumedVisited = [];
const settledCandidates = [];
await findLatestVerifiedSceneTransitionAnchor([
    makePage(1, 'unknown'), makePage(2, 'unknown'), makePage(3, 'unknown'),
    makePage(4, 'unknown'), makePage(5, 'unknown'), makePage(6, 'unknown'),
], {
    currentCursor: cursor,
    skipNewest: 2,
    batchLimit: 2,
    onCandidateSettled: (entry) => settledCandidates.push(entry),
    analyzePage: async (page) => {
        resumedVisited.push(page.cursor.messageIndex);
        return { state: 'unknown', timelineValidated: true };
    },
});
assert.deepEqual(resumedVisited, [4, 3], 'a later replay batch resumes after the newest two candidates');
assert.deepEqual(settledCandidates.map(({ processedCandidates }) => processedCandidates), [3, 4],
    'settled callbacks expose absolute progress for durable checkpoints');

const validDigest = `sha256:${'a'.repeat(64)}`;
const hashText = async (value) => `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
const candidatePages = [createSceneContinuityHistoryCandidate({
    sourceRole: 'character', message: { index: 4, text: 'safe visible text' },
    messageIndex: 4, pageIndex: 0, pageText: 'safe visible text', sourceSpan: { start: 0, end: 17 },
}, 'scope-a')];
const candidateDigest = await createSceneContinuityHistoryCandidateListHash(candidatePages, hashText);
assert.match(candidateDigest, /^sha256:[a-f0-9]{64}$/u,
    'the checkpoint candidate digest is based on the exact bounded candidate set');
assert.notEqual(candidateDigest, await createSceneContinuityHistoryCandidateListHash([{
    ...candidatePages[0], pageText: 'edited visible text',
}], hashText), 'editing a candidate invalidates its digest');
assert.match(await createSceneContinuityHistoryTargetCursorHash({
    ...cursor, messageId: '9', sourceMessageHash: validDigest, pageTextHash: validDigest,
    timelinePrefixHash: validDigest, sourceSpan: { start: 0, end: 12 },
}, hashText), /^sha256:[a-f0-9]{64}$/u);
const checkpointKeyDigest = (await hashText('scope-a')).slice('sha256:'.length);
assert.equal(await createSceneContinuityHistoryCheckpointKey('scope-a', hashText),
    `galgame.scene-continuity-history-checkpoint.v1.${checkpointKeyDigest}`);
const checkpoint = createSceneContinuityHistoryCheckpoint({
    scopeHash: validDigest, targetCursorHash: validDigest, candidateListHash: validDigest,
    analyzerScope: 'scene-analyzer-v3', candidateCount: 6, processedCandidates: 4,
    failedCandidateOffsets: [2],
});
const serializedCheckpoint = serializeSceneContinuityHistoryCheckpoint(checkpoint);
assert.ok(serializedCheckpoint);
assert.deepEqual(parseSceneContinuityHistoryCheckpoint(serializedCheckpoint, {
    scopeHash: validDigest, targetCursorHash: validDigest, candidateListHash: validDigest,
    analyzerScope: 'scene-analyzer-v3', candidateCount: 6,
}), checkpoint, 'hash-matched progress resumes safely');
assert.equal(getSceneContinuityHistoryCheckpointResumeOffset(checkpoint, 6), 2,
    'the next cold start retries from the earliest failed candidate');
assert.equal(getSceneContinuityHistoryCheckpointResumeOffset(checkpoint, 7), 0,
    'candidate count drift rejects old scheduling progress');
assert.equal(parseSceneContinuityHistoryCheckpoint(serializedCheckpoint, {
    ...checkpoint, targetCursorHash: `sha256:${'b'.repeat(64)}`,
}), null, 'changed visible cursor invalidates the old progress checkpoint');
const checkpointPayload = JSON.parse(serializedCheckpoint);
assert.equal(Object.hasOwn(checkpointPayload, 'chatId'), false);
assert.equal(Object.hasOwn(checkpointPayload, 'pageText'), false);
assert.equal(Object.hasOwn(checkpointPayload, 'analysis'), false,
    'progress cache stores only hashes and scheduler offsets, never story or analyzer data');

const rateLimitedController = new AbortController();
let rateLimitedCalls = 0;
const rateLimitedReplay = findLatestVerifiedSceneTransitionAnchor([
    makePage(2, 'unknown'), makePage(3, 'unknown'), makePage(4, 'unknown'),
], {
    currentCursor: cursor,
    signal: rateLimitedController.signal,
    minIntervalMs: 60_000,
    analyzePage: async () => {
        rateLimitedCalls += 1;
        return { state: 'unknown', timelineValidated: true };
    },
});
setTimeout(() => rateLimitedController.abort(), 10);
assert.equal(await rateLimitedReplay, null, 'an in-flight paced replay can be cancelled');
assert.equal(rateLimitedCalls, 1, 'cancellation stops before the next provider request');

const unknownOnly = await findLatestVerifiedSceneTransitionAnchor([
    makePage(1, 'unknown'), makePage(2, 'continued'),
], {
    currentCursor: cursor,
    analyzePage: async (page) => ({ state: page.result, sceneKey: 'scene-unverified', timelineValidated: true }),
});
assert.equal(unknownOnly, null, 'unknown/continued without a changed anchor cannot create a scene');

const nonCharacterOnly = await findLatestVerifiedSceneTransitionAnchor([
    makePage(1, 'changed', 'player'), makePage(2, 'changed', 'system'),
], {
    currentCursor: cursor,
    analyzePage: async () => assert.fail('player/system pages must not be analyzed'),
});
assert.equal(nonCharacterOnly, null);

const controller = new AbortController();
controller.abort();
assert.equal(await findLatestVerifiedSceneTransitionAnchor(pages, {
    currentCursor: cursor,
    signal: controller.signal,
    analyzePage: async () => assert.fail('aborted replay must stop before analysis'),
}), null);

console.log('Scene continuity history bootstrap tests passed');
