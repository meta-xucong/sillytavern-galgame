import assert from 'node:assert/strict';
import { deriveSceneContinuityKey } from '../../shared/src/scene-continuity-analysis.js';
import { createHash } from 'node:crypto';
import { canApplySceneContinuityPageResult, capSceneContinuityLedgerRecords, createIdentityVisualAttributes, createPresentationDisplaySegments, createPresentationPages, createPresentationRosterDisplay, createSceneContinuityLedgerStorageKey, createSceneContinuityTimelinePrefixHash, createSpeakerVisualAttributes, deferShadowPresentationAnalysisUntilVisualSettles, formatPresentationRosterMember, isPresentationProjectionTimelineCurrent, isSceneContinuityCursorStrictlyEarlier, isSceneContinuityProjectionBoundToCursor, parseSceneContinuityLedger, PRESENTATION_ANNOTATION_MODE, PRESENTATION_GATE_REPORTS, resolvePresentationMode, sanitizeSceneContinuityLedgerRecord, sceneContinuityRecordFingerprint, selectLatestEarlierCompletedScenePage, selectPresentationAnalysisMessages, serializeSceneContinuityLedger, shouldWaitForSceneContinuityTask, validateSceneContinuityLedgerRecords, waitForPriorSceneContinuityTask } from '../src/presentation-renderer.js';

const hashText = async (value) => `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;

assert.equal(PRESENTATION_ANNOTATION_MODE, 'shadow');
assert.deepEqual(PRESENTATION_GATE_REPORTS, {});
assert.equal(resolvePresentationMode('zh-CN'), 'shadow');
const analysisMessages = [
    { role: 'character', index: 10, text: '历史消息' },
    { role: 'player', index: 11, text: '玩家输入' },
    { role: 'character', index: 12, text: '当前消息' },
];
assert.deepEqual(selectPresentationAnalysisMessages(analysisMessages, 2, 'shadow'), [{ message: analysisMessages[2], index: 2 }], 'shadow annotation selects only the active assistant message');
assert.deepEqual(selectPresentationAnalysisMessages(analysisMessages, 2, 'assisted'), [
    { message: analysisMessages[0], index: 0 },
    { message: analysisMessages[2], index: 2 },
], 'assisted annotation retains full assistant history');
const noShadowScan = new Proxy(analysisMessages, {
    get(target, property, receiver) {
        if (property === Symbol.iterator || property === 'map' || property === 'filter') throw new Error('shadow selection scanned history');
        return Reflect.get(target, property, receiver);
    },
});
assert.deepEqual(selectPresentationAnalysisMessages(noShadowScan, 2, 'shadow'), [{ message: analysisMessages[2], index: 2 }], 'shadow selection reads only the active array slot');

let settleVisualTask;
const delayedVisualTask = new Promise((resolve) => { settleVisualTask = resolve; });
let delayedAnalysisStarted = false;
const deferredAnalysis = deferShadowPresentationAnalysisUntilVisualSettles(delayedVisualTask, () => {
    delayedAnalysisStarted = true;
}, new AbortController().signal);
await Promise.resolve();
assert.equal(delayedAnalysisStarted, false, 'shadow service work does not start while the visual bundle is pending');
settleVisualTask();
await deferredAnalysis;
assert.equal(delayedAnalysisStarted, true, 'shadow service work starts after the visual bundle settles');

let abortedAnalysisStarted = false;
let settleAbortedVisual;
const abortController = new AbortController();
const abortedVisualTask = new Promise((resolve) => { settleAbortedVisual = resolve; });
const abortedDeferredAnalysis = deferShadowPresentationAnalysisUntilVisualSettles(abortedVisualTask, () => {
    abortedAnalysisStarted = true;
}, abortController.signal);
abortController.abort();
settleAbortedVisual();
await abortedDeferredAnalysis;
assert.equal(abortedAnalysisStarted, false, 'switching the visible page cancels a shadow request that has not started');

const sceneScopeKey = 'chat/release/arc/catalog@1/hash';
const scenePage0 = {
    scopeKey: sceneScopeKey, messageIndex: 4, pageIndex: 0, messageId: '470',
    sourceMessageHash: 'source-hash', pageTextHash: 'page-0-hash', timelineValidated: true,
    sceneKey: 'scene-city', displayLabel: '贵族区街道',
};
const scenePage1 = { ...scenePage0, pageIndex: 1, pageTextHash: 'page-1-hash' };
const currentScenePage = { ...scenePage0, pageIndex: 2, pageTextHash: 'page-2-hash' };
assert.equal(isSceneContinuityCursorStrictlyEarlier(scenePage1, currentScenePage), true);
assert.equal(shouldWaitForSceneContinuityTask(scenePage0, currentScenePage), false, 'a newer visible page is not queued behind an older analysis');
assert.equal(shouldWaitForSceneContinuityTask(currentScenePage, scenePage1), false, 'rewinding cancels a pending future-page request');
assert.equal(shouldWaitForSceneContinuityTask({ ...scenePage0, scopeKey: 'another-chat' }, currentScenePage), false, 'scope changes cancel rather than inherit pending analysis');
assert.equal(shouldWaitForSceneContinuityTask(currentScenePage, { ...currentScenePage }), true, 'an identical current-page request can reuse the in-flight analysis');
let settlePriorPageAnalysis;
const priorPageAnalysis = new Promise((resolve) => { settlePriorPageAnalysis = resolve; });
let newestPageMayStart = false;
const newestPageWait = waitForPriorSceneContinuityTask({ cursor: scenePage0, promise: priorPageAnalysis }, currentScenePage)
    .then((waitedForCurrentPage) => { newestPageMayStart = !waitedForCurrentPage; });
await Promise.resolve();
assert.equal(newestPageMayStart, true, 'the newest page starts immediately and supersedes the older analysis');
settlePriorPageAnalysis();
await newestPageWait;
assert.equal(newestPageMayStart, true, 'the newest page remains eligible after the old task settles');
assert.equal(isSceneContinuityCursorStrictlyEarlier(scenePage1, { ...currentScenePage, scopeKey: 'another-chat' }), false, 'a different chat or catalog scope cannot inherit scene history');
assert.equal(isSceneContinuityCursorStrictlyEarlier(currentScenePage, scenePage1), false, 'a future page cannot become previousScene while rewinding');
assert.equal(selectLatestEarlierCompletedScenePage([
    scenePage0,
    { ...scenePage1, timelineValidated: false },
    { ...scenePage1, scopeKey: 'another-chat' },
], currentScenePage)?.pageIndex, 0, 'only completed, same-scope, timeline-validated earlier pages are reusable');
const lineagePageCursor = { ...currentScenePage, lineageFingerprint: 'earlier-page-hash-a' };
const validatedLineageCursor = {
    ...lineagePageCursor, timelineValidated: true,
    timelinePrefixHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    sourceSpan: { start: 0, end: 16 },
};
assert.equal(canApplySceneContinuityPageResult({ resultToken: 5, currentToken: 5, resultCursor: validatedLineageCursor, currentCursor: { ...validatedLineageCursor } }), true);
assert.equal(canApplySceneContinuityPageResult({
    resultToken: 5, currentToken: 5, resultCursor: validatedLineageCursor,
    currentCursor: { ...validatedLineageCursor, lineageFingerprint: 'earlier-page-hash-b' },
}), false, 'an edited earlier branch invalidates a result even when the current message is unchanged');
assert.equal(canApplySceneContinuityPageResult({
    resultToken: 5, currentToken: 5, resultCursor: validatedLineageCursor,
    currentCursor: { ...validatedLineageCursor, timelinePrefixHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
}), false, 'source timeline must be revalidated independently before DOM application');
assert.equal(canApplySceneContinuityPageResult({
    resultToken: 5, currentToken: 6, resultCursor: validatedLineageCursor, currentCursor: validatedLineageCursor,
}), false, 'a late request token cannot mutate the visible page');

const ledgerScopeKey = JSON.stringify(['chat-private-name', 'release-a', 'arc-a', 'catalog-a', 1, `sha256:${'c'.repeat(64)}`]);
const ledgerScope = {
    chatId: 'chat-private-name', releaseId: 'release-a', arcId: 'arc-a',
    catalogId: 'catalog-a', catalogRevision: 1, catalogHash: `sha256:${'c'.repeat(64)}`,
};
const ledgerMessages = [
    { role: 'character', index: 10, speaker: 'Narrator', displayText: '她穿过旧钟楼。完整历史正文。', text: '她穿过旧钟楼。完整历史正文。' },
    { role: 'character', index: 12, speaker: 'Heroine', displayText: '她抵达了港口。另一段完整正文。', text: '她抵达了港口。另一段完整正文。' },
];
const firstPageText = '她穿过旧钟楼。';
const secondPageText = '她抵达了港口。';
const firstSource = Array.from(ledgerMessages[0].displayText);
const secondSource = Array.from(ledgerMessages[1].displayText);
const firstLedgerRecord = {
    scopeKey: ledgerScopeKey, scope: ledgerScope, messageIndex: 0, pageIndex: 0, messageId: '10',
    sourceMessageHash: await hashText(ledgerMessages[0].displayText), pageTextHash: await hashText(firstPageText),
    timelinePrefixHash: await createSceneContinuityTimelinePrefixHash(ledgerMessages, 0, hashText),
    sourceSpan: { start: 0, end: Array.from(firstPageText).length },
    sceneLocationSpan: { start: 3, end: 6 },
    sceneKey: await deriveSceneContinuityKey(ledgerScope, '旧钟楼'), displayLabel: '旧钟楼', lineageFingerprint: '',
    pageText: firstPageText, prompt: 'forbidden prompt', apiKey: 'forbidden-key',
    visualHint: { entityType: 'scene', visibleAttributes: [{ value: 'full source excerpt' }] },
};
const secondLedgerRecord = {
    scopeKey: ledgerScopeKey, scope: ledgerScope, messageIndex: 1, pageIndex: 0, messageId: '12',
    sourceMessageHash: await hashText(ledgerMessages[1].displayText), pageTextHash: await hashText(secondPageText),
    timelinePrefixHash: await createSceneContinuityTimelinePrefixHash(ledgerMessages, 1, hashText),
    sourceSpan: { start: 0, end: Array.from(secondPageText).length },
    sceneLocationSpan: { start: 4, end: 6 },
    sceneKey: await deriveSceneContinuityKey(ledgerScope, '港口'), displayLabel: '港口',
    lineageFingerprint: sceneContinuityRecordFingerprint(firstLedgerRecord),
};
assert.equal(firstSource.slice(firstLedgerRecord.sourceSpan.start, firstLedgerRecord.sourceSpan.end).join(''), firstPageText);
assert.equal(secondSource.slice(secondLedgerRecord.sourceSpan.start, secondLedgerRecord.sourceSpan.end).join(''), secondPageText);
const serializedLedger = serializeSceneContinuityLedger(ledgerScopeKey, [firstLedgerRecord, secondLedgerRecord]);
assert.equal(serializedLedger.includes('完整历史正文'), false, 'durable ledger never stores chat text');
assert.equal(serializedLedger.includes('forbidden prompt'), false, 'durable ledger never stores prompts');
assert.equal(serializedLedger.includes('forbidden-key'), false, 'durable ledger never stores credentials');
assert.equal(serializedLedger.includes('visualHint'), false, 'durable ledger stores only allowlisted projection metadata');
const storageKey = await createSceneContinuityLedgerStorageKey(ledgerScopeKey, hashText);
assert.match(storageKey, /^galgame\.scene-continuity-ledger\.v2\.[a-f0-9]{64}$/u);
assert.equal(storageKey.includes('chat-private-name'), false, 'storage key is scope-hashed');
const restoredLedger = parseSceneContinuityLedger(serializedLedger, ledgerScopeKey);
assert.equal(restoredLedger.length, 2, 'the allowlisted cache can be restored for its exact scope');
assert.equal(sanitizeSceneContinuityLedgerRecord({ ...secondLedgerRecord, scopeKey: 'another-scope' })?.scopeKey, 'another-scope');
assert.equal(parseSceneContinuityLedger(serializedLedger, 'another-scope').length, 0, 'a different scope cannot read this ledger');
assert.equal(parseSceneContinuityLedger('{invalid', ledgerScopeKey).length, 0, 'a corrupt cache safely behaves as empty');
const restoredValid = await validateSceneContinuityLedgerRecords(restoredLedger, {
    messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
});
assert.equal(restoredValid.length, 2, 'restored metadata is accepted only after current timeline hashes and spans validate');
assert.equal(restoredValid[1].sceneKey, await deriveSceneContinuityKey(ledgerScope, '港口'));
const tamperedLabelRestored = await validateSceneContinuityLedgerRecords([{
    ...firstLedgerRecord, displayLabel: '伪造地点', visualHint: { entityType: 'scene', displayLabel: '伪造地点' },
}], { messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText });
assert.equal(tamperedLabelRestored[0]?.displayLabel, '旧钟楼',
'a modified local cache label is replaced by the exact source evidence');
assert.equal((await validateSceneContinuityLedgerRecords([{
    ...firstLedgerRecord, sceneKey: 'scene_tampered',
}], { messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText })).length, 0,
'a modified local cache key cannot replace a key derived from the exact source evidence');
assert.equal((await validateSceneContinuityLedgerRecords(restoredLedger, {
    messages: ledgerMessages, scopeKey: ledgerScopeKey,
    expectedScope: { ...ledgerScope, catalogHash: `sha256:${'d'.repeat(64)}` }, hashText,
})).length, 0, 'a hash-valid cache cannot cross an active catalog scope');
const earlierEdited = structuredClone(ledgerMessages);
earlierEdited[0].displayText = '她穿过被改写的钟楼。完整历史正文。';
earlierEdited[0].text = earlierEdited[0].displayText;
const afterEarlierEdit = await validateSceneContinuityLedgerRecords(restoredLedger, {
    messages: earlierEdited, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
});
assert.equal(afterEarlierEdit.length, 0, 'editing an earlier message invalidates its cache point and every dependent lineage entry');
const activeMessageEdited = structuredClone(ledgerMessages);
activeMessageEdited[1].displayText = '另一种回复覆盖当前页。';
activeMessageEdited[1].text = activeMessageEdited[1].displayText;
const afterCurrentReplacement = await validateSceneContinuityLedgerRecords(restoredLedger, {
    messages: activeMessageEdited, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
});
assert.equal(afterCurrentReplacement.length, 1, 'replacing the current message invalidates its own cached result');
const invalidSpanLedger = [{ ...firstLedgerRecord, sourceSpan: { start: 0, end: 999 } }];
assert.equal((await validateSceneContinuityLedgerRecords(invalidSpanLedger, {
    messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
})).length, 0, 'an out-of-range cached source span is rejected');
assert.equal((await validateSceneContinuityLedgerRecords([secondLedgerRecord], {
    messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
})).length, 0, 'a downstream cache entry without its recorded ancestor fails closed');
const cappedLedger = capSceneContinuityLedgerRecords([firstLedgerRecord, secondLedgerRecord], 1);
assert.equal(cappedLedger.length, 1, 'persistent scene metadata has a hard record cap');
assert.equal((await validateSceneContinuityLedgerRecords(cappedLedger, {
    messages: ledgerMessages, scopeKey: ledgerScopeKey, expectedScope: ledgerScope, hashText,
})).length, 0, 'cap pruning that removes an ancestor never makes a dangling descendant trusted');
const projectionForCursor = {
    schemaVersion: 'galgame.scene-continuity.v1', scope: ledgerScope,
    segment: { messageId: '12', pageIndex: 0, pageTextSha256: secondLedgerRecord.pageTextHash },
};
const timelineBoundCursor = {
    scope: ledgerScope, messageId: '12', pageIndex: 0, pageTextHash: secondLedgerRecord.pageTextHash,
};
assert.equal(isSceneContinuityProjectionBoundToCursor(projectionForCursor, timelineBoundCursor), true);
assert.equal(isSceneContinuityProjectionBoundToCursor(projectionForCursor, { ...timelineBoundCursor, messageId: 'swiped-message' }), false, 'supplied and cached projections cannot bypass current message identity');
const skippedPageProjection = {
    ...projectionForCursor,
    segment: { ...projectionForCursor.segment, pageIndex: 1 },
};
// The frozen analysis protocol only lets contextPages disambiguate; it cannot
// promote a skipped page's transition evidence into the currently visible page.
assert.equal(isSceneContinuityProjectionBoundToCursor(skippedPageProjection, {
    ...timelineBoundCursor, pageIndex: 2,
}), false, 'context from a skipped intermediate page cannot be consumed as current-page scene evidence');

let releaseDelayedSceneAnalysis;
const delayedSceneAnalysis = new Promise((resolve) => { releaseDelayedSceneAnalysis = resolve; });
let liveSceneToken = 21;
let visibleSceneKey = null;
const delayedSceneCursor = { ...scenePage0, pageIndex: 0 };
const delayedSceneResultPromise = delayedSceneAnalysis.then((result) => {
    const completedRecord = { ...delayedSceneCursor, ...result, timelineValidated: true };
    const stillCurrentPage = canApplySceneContinuityPageResult({
        resultToken: 21,
        currentToken: liveSceneToken,
        resultCursor: delayedSceneCursor,
        currentCursor: { ...currentScenePage, messageIndex: 4, pageIndex: 2 },
    });
    if (stillCurrentPage) visibleSceneKey = result.sceneKey;
    return completedRecord;
});
liveSceneToken = 22;
releaseDelayedSceneAnalysis({ sceneKey: 'scene-city', displayLabel: '贵族区街道' });
const delayedCompletedPage = await delayedSceneResultPromise;
assert.equal(visibleSceneKey, null, 'a delayed prior-page response never changes the current page DOM');
assert.equal(selectLatestEarlierCompletedScenePage([delayedCompletedPage], currentScenePage)?.sceneKey, 'scene-city', 'a completed, still-on-timeline earlier page can seed previousScene');
assert.equal(selectLatestEarlierCompletedScenePage([{ ...delayedCompletedPage, timelineValidated: false }], currentScenePage), null, 'edited or removed chat content invalidates the delayed page result');

const fallback = createPresentationDisplaySegments({ text: '正文标题\n内容' });
assert.equal(fallback.length, 1);
assert.equal(fallback[0].type, 'unknown');
assert.equal(fallback[0].speaker, '未识别');

const text = '😀Celestia：你好。旁白继续。';
const chars = Array.from(text);
const speakerStart = chars.indexOf('C');
const speakerEnd = speakerStart + Array.from('Celestia').length;
const replyEnd = chars.indexOf('旁');
const annotation = {
    segments: [
        { start: 0, end: replyEnd, kind: 'dialogue' },
        { start: replyEnd, end: chars.length, kind: 'narration' },
    ],
};
const projection = {
    segmentSpeakers: [{ sourceMessageIndex: 3, segmentIndex: 0, resolvedSpeakerRef: { type: 'chat-local', id: 'cl_abc' } }],
    entities: [{ identityRef: { type: 'chat-local', id: 'cl_abc' }, aliases: [{ value: 'Celestia' }] }],
};
const segments = createPresentationDisplaySegments({ text, annotation, projection, sourceMessageIndex: 3 });
assert.equal(segments[0].speaker, 'Celestia');
assert.equal(segments[1].speaker, '旁白');
assert.equal(segments.map((segment) => segment.text).join(''), text);
assert.equal(speakerEnd > speakerStart, true);

const groupSource = 'Celestia：你好。\n\nPippa：我在。';
const groupChars = Array.from(groupSource);
const firstLineEnd = groupChars.indexOf('\n');
const secondLineStart = firstLineEnd + 2;
const groupedPages = createPresentationPages({
    sourceText: groupSource,
    sourceMessageIndex: 7,
    sourceMessageHash: 'sha256:message-hash',
    segments: [
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, sourceSpan: { start: 0, end: firstLineEnd }, sourceMessageIndex: 7, sourceMessageHash: 'sha256:message-hash' },
        { type: 'dialogue', speaker: 'Pippa', identityRef: { type: 'published', id: 'pippa' }, sourceSpan: { start: secondLineStart, end: groupChars.length }, sourceMessageIndex: 7, sourceMessageHash: 'sha256:message-hash' },
    ],
});
assert.equal(groupedPages.length, 1);
assert.equal(groupedPages[0].type, 'dialogue-group');
assert.equal(groupedPages[0].speaker, '多人对话');
assert.equal(groupedPages[0].text, groupSource, 'grouped page reconstructs the complete visible source without dropping punctuation or separators');
assert.deepEqual(groupedPages[0].speakerCandidates.map((item) => item.identityRef.id), ['celestia', 'pippa']);

const splitByNarration = createPresentationPages({
    sourceText: groupSource,
    sourceMessageIndex: 7,
    segments: [
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, sourceSpan: { start: 0, end: firstLineEnd }, sourceMessageIndex: 7 },
        { type: 'narration', speaker: '旁白', identityRef: null, sourceSpan: { start: firstLineEnd, end: secondLineStart }, sourceMessageIndex: 7 },
        { type: 'dialogue', speaker: 'Pippa', identityRef: { type: 'published', id: 'pippa' }, sourceSpan: { start: secondLineStart, end: groupChars.length }, sourceMessageIndex: 7 },
    ],
});
assert.equal(splitByNarration.some((page) => page.type === 'dialogue-group'), false, 'narration is a hard boundary between carousel candidates');

const unsafeCarouselSources = [
    [
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, sourceSpan: { start: 0, end: firstLineEnd }, sourceMessageIndex: 7 },
        { type: 'dialogue', speaker: 'Pippa', identityRef: { type: 'unknown' }, sourceSpan: { start: secondLineStart, end: groupChars.length }, sourceMessageIndex: 7 },
    ],
    [
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, sourceSpan: { start: 0, end: firstLineEnd }, sourceMessageIndex: 7 },
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, speakerContinuation: true, sourceSpan: { start: secondLineStart, end: groupChars.length }, sourceMessageIndex: 7 },
    ],
    [
        { type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, sourceSpan: { start: 0, end: firstLineEnd }, sourceMessageIndex: 7 },
        { type: 'dialogue', speaker: 'Pippa', identityRef: { type: 'published', id: 'pippa' }, sourceSpan: { start: secondLineStart + 1, end: groupChars.length }, sourceMessageIndex: 7 },
    ],
];
for (const segmentsToReject of unsafeCarouselSources) {
    assert.equal(createPresentationPages({ segments: segmentsToReject, sourceText: groupSource, sourceMessageIndex: 7 }).some((page) => page.type === 'dialogue-group'), false);
}

const oversized = 'A'.repeat(901);
const oversizedPage = createPresentationPages({
    sourceText: oversized,
    sourceMessageIndex: 8,
    segments: [{ type: 'dialogue', speaker: 'Celestia', identityRef: { type: 'published', id: 'celestia' }, text: oversized, sourceSpan: { start: 0, end: 901 }, sourceMessageIndex: 8 }],
});
assert.equal(oversizedPage[0].text, oversized, 'an indivisible oversized segment stays complete');
assert.notEqual(oversizedPage[0].type, 'dialogue-group');

const decorated = createPresentationDisplaySegments({
    text: '旁白。系统：成功。选项：继续。',
    annotation: { segments: [
        { start: 0, end: 3, kind: 'narration' },
        { start: 3, end: 9, kind: 'status' },
        { start: 10, end: 15, kind: 'choice' },
    ] },
    projection: { segmentSpeakers: [] },
});
assert.deepEqual(decorated.map((item) => item.identityRef), [null, null, null]);
assert.deepEqual(createPresentationRosterDisplay({
    projection: { complete: true, entities: [{ identityRef: { type: 'chat-local', id: 'cl_a' }, aliases: [{ value: 'Celestia' }] }] },
    roster: { complete: true, entries: [{ identityRef: { type: 'chat-local', id: 'cl_a' }, membership: 'member' }] },
}), [{ identityRef: { type: 'chat-local', id: 'cl_a' }, name: 'Celestia', membership: 'member' }]);
assert.deepEqual(createPresentationRosterDisplay({
    projection: { complete: true, entities: [{ identityRef: { type: 'chat-local', id: 'cl_a' }, aliases: [{ value: 'Celestia' }] }] },
    roster: {
        complete: true,
        entries: [{ identityRef: { type: 'chat-local', id: 'cl_a' }, membership: 'unknown' }],
        conflicts: [{ identityRef: { type: 'chat-local', id: 'cl_a' }, sourceMessageIndices: [4] }],
    },
}), [{ identityRef: { type: 'chat-local', id: 'cl_a' }, name: 'Celestia', membership: 'unknown' }], 'roster conflicts stay visible as uncertain membership');
assert.equal(formatPresentationRosterMember({ name: 'Celestia', membership: 'unknown' }), 'Celestia（状态待确认）');
assert.equal(createPresentationRosterDisplay({ projection: { complete: false }, roster: { complete: true, entries: [] } }), null);
const characterAttributesProjection = { entities: [
    { identityRef: { type: 'chat-local', id: 'speaker' }, attributes: [{ category: 'gender', value: '女性', sourceMessageIndex: 1 }, { category: 'species', value: '精灵', sourceMessageIndex: 1 }] },
    { identityRef: { type: 'chat-local', id: 'npc' }, attributes: [{ category: 'gender', value: '男性', sourceMessageIndex: 1 }, { category: 'appearance', value: '银发', sourceMessageIndex: 1 }] },
] };
assert.deepEqual(createIdentityVisualAttributes(characterAttributesProjection, { type: 'chat-local', id: 'speaker' }), [
    { code: 'character-explicit-gender-presentation', value: '女性', confidenceBand: 'probable' },
    { code: 'character-explicit-species', value: '精灵', confidenceBand: 'probable' },
]);
assert.deepEqual(createIdentityVisualAttributes(characterAttributesProjection, { type: 'chat-local', id: 'other' }), [], 'attributes from other characters never leak into active identity');
assert.deepEqual(createSpeakerVisualAttributes({
    visibleAttributes: [
        { code: 'character-explicit-name', value: 'Celestia', confidenceBand: 'probable' },
        { code: 'character-explicit-species', value: '错误合并的兽人', confidenceBand: 'probable' },
        { code: 'character-explicit-appearance', value: '错误合并的红发', confidenceBand: 'probable' },
    ],
}), [{ code: 'character-explicit-name', value: 'Celestia', confidenceBand: 'probable' }], 'unattributed full-message/segment appearance hints are discarded');
assert.deepEqual(createSpeakerVisualAttributes({
    visibleAttributes: [{ code: 'character-explicit-name', value: 'Celestia', confidenceBand: 'probable' }],
    projection: characterAttributesProjection,
    identityRef: { type: 'chat-local', id: 'speaker' },
}), [
    { code: 'character-explicit-name', value: 'Celestia', confidenceBand: 'probable' },
    { code: 'character-explicit-gender-presentation', value: '女性', confidenceBand: 'probable' },
    { code: 'character-explicit-species', value: '精灵', confidenceBand: 'probable' },
]);

const timelineSnapshot = { fileName: 'chat-a', messages: [
    { index: 2, role: 'character', speaker: 'Mira', text: '先前剧情' },
    { index: 4, role: 'character', speaker: 'Mira', text: '当前剧情' },
] };
const timelineState = {
    projection: { complete: true, chatKey: 'chat-a' },
    messages: timelineSnapshot.messages.map((message) => ({
        sourceMessageIndex: message.index,
        visibleText: message.text,
        authorLabel: message.speaker,
        sourceMessageHash: `hash-${message.index}`,
        annotation: { sourceMessageHash: `hash-${message.index}` },
    })),
};
assert.equal(isPresentationProjectionTimelineCurrent(timelineSnapshot, timelineState), true);
assert.equal(isPresentationProjectionTimelineCurrent({ ...timelineSnapshot, messages: [{ ...timelineSnapshot.messages[0], text: '编辑过的前序剧情' }, timelineSnapshot.messages[1]] }, timelineState), false, 'edited prior message invalidates timeline projection');
assert.equal(isPresentationProjectionTimelineCurrent({ ...timelineSnapshot, messages: [timelineSnapshot.messages[0], { ...timelineSnapshot.messages[1], speaker: 'Lyra' }] }, timelineState), false, 'changed author invalidates timeline projection');
assert.equal(isPresentationProjectionTimelineCurrent({ ...timelineSnapshot, messages: [timelineSnapshot.messages[0]] }, timelineState), false, 'removed/swiped message invalidates timeline projection');
console.log('presentation-renderer: PASS');
