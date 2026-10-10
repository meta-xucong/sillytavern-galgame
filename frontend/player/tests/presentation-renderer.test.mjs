import assert from 'node:assert/strict';
import { applyAnnotationDialogueSpeakerContinuity, createStructuralPageTitleEvidence, createProbableNarrativeSpeakerTitleEvidence, createVisualNovelDisplaySegments } from '../../shared/src/sillytavern-adapter.js';
import { deriveSceneContinuityKey } from '../../shared/src/scene-continuity-analysis.js';
import { createHash } from 'node:crypto';
import { canApplySceneContinuityPageResult, capSceneContinuityLedgerRecords, createIdentityVisualAttributes, createPresentationCorePageSegment, createPresentationPageTitleEvidence, createPresentationPageWindow, createSafePresentationDisplaySegments, createStablePresentationBasePages, getPresentationSpeakerLabel, getPresentationVisualSpeakerContext, createPresentationDisplaySegments, createPresentationPages, createPresentationRosterDisplay, createSceneContinuityLedgerStorageKey, createSceneContinuityTimelinePrefixHash, createSpeakerVisualAttributes, deferShadowPresentationAnalysisUntilVisualSettles, formatPresentationRosterMember, isPresentationProjectionTimelineCurrent, isPresentationTimelineSnapshotCurrent, isSceneContinuityCursorStrictlyEarlier, isSceneContinuityProjectionBoundToCursor, MAX_ASSISTED_PRESENTATION_MESSAGES, parseSceneContinuityLedger, PRESENTATION_ANNOTATION_MODE, PRESENTATION_GATE_REPORTS, PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES, resolvePresentationMode, sanitizeSceneContinuityLedgerRecord, sceneContinuityRecordFingerprint, selectLatestEarlierCompletedScenePage, selectPresentationAnalysisMessages, serializeSceneContinuityLedger, shouldWaitForSceneContinuityTask, validateSceneContinuityLedgerRecords, waitForPriorSceneContinuityTask } from '../src/presentation-renderer.js';

const hashText = async (value) => `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;

assert.equal(PRESENTATION_ANNOTATION_MODE, 'assisted');
assert.deepEqual(PRESENTATION_GATE_REPORTS, {});
assert.deepEqual(PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES, ['zh-CN']);
assert.equal(resolvePresentationMode('zh-CN'), 'assisted');
assert.equal(resolvePresentationMode('en'), 'shadow', 'unverified assisted mode is limited to the active published locale');
const analysisMessages = [
    { role: 'character', index: 10, text: '历史消息' },
    { role: 'player', index: 11, text: '玩家输入' },
    { role: 'character', index: 12, text: '当前消息' },
];
assert.deepEqual(selectPresentationAnalysisMessages(analysisMessages, 2, 'shadow'), [{ message: analysisMessages[2], index: 2 }], 'shadow annotation selects only the active assistant message');
assert.deepEqual(selectPresentationAnalysisMessages(analysisMessages, 2, 'assisted'), [
    { message: analysisMessages[0], index: 0 },
    { message: analysisMessages[2], index: 2 },
], 'assisted annotation includes prior assistant messages within its bounded window');
assert.equal(MAX_ASSISTED_PRESENTATION_MESSAGES, 12);
const extendedAnalysisMessages = Array.from({ length: 20 }, (_, index) => ({ role: 'character', index, text: `角色正文 ${index}` }));
assert.deepEqual(selectPresentationAnalysisMessages(extendedAnalysisMessages, 19, 'assisted').map(({ index }) => index),
    Array.from({ length: 12 }, (_, offset) => offset + 8), 'assisted backfill is capped at the latest 12 messages through the active cursor');
assert.deepEqual(selectPresentationAnalysisMessages(extendedAnalysisMessages, 10, 'assisted').map(({ index }) => index),
    Array.from({ length: 11 }, (_, index) => index), 'assisted analysis never includes messages after the active cursor');
const timelineSnapshotFixture = {
    fileName: 'chat-long',
    messages: [{ role: 'character', index: 0, text: '较早内容' }, { role: 'player', index: 1, text: '行动' }, { role: 'character', index: 2, text: '当前内容' }],
};
const timelineStateFixture = {
    chatKey: 'chat-long',
    timelineSnapshot: timelineSnapshotFixture.messages.map((message, arrayIndex) => ({
        arrayIndex, sourceMessageIndex: message.index, role: message.role, authorLabel: '', visibleText: message.text,
    })),
};
assert.equal(isPresentationTimelineSnapshotCurrent(timelineSnapshotFixture, timelineStateFixture), true);
assert.equal(isPresentationTimelineSnapshotCurrent({ ...timelineSnapshotFixture, messages: [...timelineSnapshotFixture.messages, { role: 'character', index: 3, text: '新回合' }] }, timelineStateFixture), false,
    'a cursor extension invalidates a previously captured projection snapshot');
assert.equal(isPresentationTimelineSnapshotCurrent({ ...timelineSnapshotFixture, messages: [{ ...timelineSnapshotFixture.messages[0], text: '编辑过的早期内容' }, ...timelineSnapshotFixture.messages.slice(1)] }, timelineStateFixture), false,
    'editing earlier history invalidates a current-message annotation binding');
assert.equal(isPresentationTimelineSnapshotCurrent({ ...timelineSnapshotFixture, messages: [...timelineSnapshotFixture.messages.slice(0, 2), { ...timelineSnapshotFixture.messages[2], text: '替代回复' }] }, timelineStateFixture), false,
    'a swiped or replaced assistant reply invalidates its annotation binding');
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
        { start: 0, end: replyEnd, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'text-explicit',
            evidenceSpans: [{ start: speakerStart, end: speakerEnd, purpose: 'speaker' }] },
        { start: replyEnd, end: chars.length, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', evidenceSpans: [] },
    ],
    entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: speakerStart, end: speakerEnd } }],
};
const projection = {
    complete: true,
    segmentSpeakers: [{ sourceMessageIndex: 3, segmentIndex: 0, resolvedSpeakerRef: { type: 'chat-local', id: 'cl_abc' } }],
    entities: [{ identityRef: { type: 'chat-local', id: 'cl_abc' }, aliases: [{ value: 'Celestia' }] }],
};
const segments = createPresentationDisplaySegments({ text, annotation, projection, sourceMessageIndex: 3 });
assert.equal(segments[0].speaker, 'Celestia');
assert.equal(segments[1].speaker, '旁白');
assert.equal(segments.map((segment) => segment.text).join(''), text);
assert.equal(speakerEnd > speakerStart, true);

const incompleteProjectionSegments = createPresentationDisplaySegments({
    text,
    annotation,
    projection: { complete: false, segmentSpeakers: [{ sourceMessageIndex: 3, segmentIndex: 0, resolvedSpeakerRef: { type: 'chat-local', id: 'provisional' } }] },
    sourceMessageIndex: 3,
    sourceMessageHash: 'sha256:current-source',
});
assert.equal(incompleteProjectionSegments[0].speaker, 'Celestia', 'validated exact speaker mention supplies a title while the whole-chat projection is incomplete');
assert.deepEqual(incompleteProjectionSegments[0].identityRef, { type: 'unknown' }, 'partial projection cannot create a chat-local identity');
assert.equal(getPresentationSpeakerLabel(incompleteProjectionSegments[0], { role: 'character' }), 'Celestia');
assert.equal(getPresentationVisualSpeakerContext(incompleteProjectionSegments[0], { role: 'character' }).role, 'unknown', 'partial speaker title cannot trigger character avatar matching');
const aliasProjectionSegments = createPresentationDisplaySegments({
    text,
    annotation,
    projection: {
        complete: true,
        segmentSpeakers: [{ sourceMessageIndex: 3, segmentIndex: 0, resolvedSpeakerRef: { type: 'chat-local', id: 'cl_abc' } }],
        entities: [{ identityRef: { type: 'chat-local', id: 'cl_abc' }, aliases: [{ value: 'Celestia (Harbor Alias)' }] }],
    },
    sourceMessageIndex: 3,
    sourceMessageHash: 'sha256:current-source',
});
assert.equal(aliasProjectionSegments[0].speaker, 'Celestia (Harbor Alias)', 'segment speaker retains the resolved identity label for visual context');
assert.equal(getPresentationSpeakerLabel(aliasProjectionSegments[0], { role: 'character' }), 'Celestia', 'current exact speaker evidence supplies the title ahead of a projected alias');
assert.equal(getPresentationVisualSpeakerContext(aliasProjectionSegments[0], { role: 'character' }).speaker, 'Celestia (Harbor Alias)', 'visual context still uses the resolved identity label');
const unverifiedLabel = { ...incompleteProjectionSegments[0], sourceMessageHash: 'sha256:other-source' };
assert.equal(getPresentationSpeakerLabel(unverifiedLabel, { role: 'character' }), '未识别', 'source hash mismatch cannot retain a speaker title');
const missingSpeakerEvidence = createPresentationDisplaySegments({
    text,
    annotation: { ...annotation, segments: [{ ...annotation.segments[0], evidenceSpans: [] }] },
    sourceMessageIndex: 3,
    sourceMessageHash: 'sha256:current-source',
});
assert.equal(getPresentationSpeakerLabel(missingSpeakerEvidence[0], { role: 'character' }), '未识别', 'a mention without covering speaker evidence stays unknown');

const pagedLongText = 'Alice：“我会继续说明。”\n\n续言😀仍由她说。';
const stableLongPages = createStablePresentationBasePages({ text: pagedLongText, role: 'character', sourceMessageIndex: 9 });
const secondPageWindow = createPresentationPageWindow({ sourceText: pagedLongText, pages: stableLongPages, pageIndex: 1, lookbehindPages: 1 });
assert.equal(stableLongPages.map((page) => page.text).join(''), pagedLongText, 'stable base pages preserve all code points');
assert.deepEqual(secondPageWindow.viewSpan, { start: 0, end: Array.from(pagedLongText).length }, 'page view contains only the immediate lookbehind and core page');
assert.equal(secondPageWindow.coreText, '续言😀仍由她说。');
const pagedChars = Array.from(secondPageWindow.viewText);
const coreLocalStart = secondPageWindow.coreSpan.start - secondPageWindow.viewSpan.start;
const continuedSpeakerAnnotation = {
    sourceMessageIndex: 9,
    sourceMessageHash: 'sha256:page-view',
    segments: [{ start: 0, end: pagedChars.length, textHash: 'sha256:page-view', kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'quoted-attribution', confidenceBand: 'high',
        evidenceSpans: [
            { start: 0, end: 5, purpose: 'speaker' },
            { start: coreLocalStart, end: pagedChars.length, purpose: 'classification' },
        ] }],
    entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: 0, end: 5 }, attributeEvidence: [] }],
};
const pageCoreSpeaker = createPresentationCorePageSegment({ fullText: pagedLongText, annotation: continuedSpeakerAnnotation,
    sourceMessageIndex: 9, sourceMessageHash: 'sha256:full-message', viewSpan: secondPageWindow.viewSpan, coreSpan: secondPageWindow.coreSpan });
assert.equal(pageCoreSpeaker?.type, 'dialogue', 'core classification evidence anchors the current page segment');
assert.deepEqual(pageCoreSpeaker?.speakerLabelEvidence && { start: pageCoreSpeaker.speakerLabelEvidence.start, end: pageCoreSpeaker.speakerLabelEvidence.end },
    { start: 0, end: 5 }, 'a single adjacent lookbehind may prove a continued speaker label');
const labelOnlyBasePage = { ...stableLongPages[1], sourceMessageHash: 'sha256:full-message',
    pageSpeakerLabelEvidence: pageCoreSpeaker.speakerLabelEvidence, pageSpeakerLabelEvidenceViewSpan: secondPageWindow.viewSpan };
assert.equal(getPresentationSpeakerLabel(labelOnlyBasePage, { role: 'character' }), 'Alice', 'page-only evidence is consumed by the title renderer');

assert.equal(getPresentationVisualSpeakerContext(labelOnlyBasePage, { role: 'character' }).role, 'unknown', 'label-only page evidence cannot trigger character avatar matching');
assert.equal(labelOnlyBasePage.type, 'unknown');
assert.equal(labelOnlyBasePage.text, stableLongPages[1].text, 'label projection leaves base page body unchanged');
assert.deepEqual(labelOnlyBasePage.sourceSpan, stableLongPages[1].sourceSpan, 'label projection leaves base page span unchanged');
assert.deepEqual(labelOnlyBasePage.identityRef, { type: 'unknown' }, 'label projection leaves identity unknown');
assert.equal(getPresentationSpeakerLabel({ ...labelOnlyBasePage, pageSpeakerLabelEvidenceViewSpan: { start: 6, end: Array.from(pagedLongText).length } }, { role: 'character' }),
    '未识别', 'lookbehind evidence outside the bound view cannot title the current page');
assert.equal(createPresentationCorePageSegment({ fullText: pagedLongText,
    annotation: { ...continuedSpeakerAnnotation, segments: [{ ...continuedSpeakerAnnotation.segments[0], evidenceSpans: [{ start: 0, end: 5, purpose: 'classification' }] }] },
    sourceMessageIndex: 9, sourceMessageHash: 'sha256:full-message', viewSpan: secondPageWindow.viewSpan, coreSpan: secondPageWindow.coreSpan }),
null, 'classification evidence outside the core cannot project a page label');

const pippaPageText = 'Pippa兴奋地飞奔向最近的书架：“老娘要找魔法书！”';
const pippaChars = Array.from(pippaPageText);
const pippaDialogueStart = pippaChars.indexOf('“');
const pippaAnnotation = { segments: [
    { start: 0, end: pippaDialogueStart, kind: 'stage-direction', textHash: 'view', evidenceSpans: [{ start: 5, end: pippaDialogueStart, purpose: 'classification' }] },
    { start: pippaDialogueStart, end: pippaChars.length, kind: 'dialogue', textHash: 'view', speakerMentionRef: 'pippa', speakerSource: 'text-explicit',
        evidenceSpans: [{ start: pippaDialogueStart, end: pippaChars.length, purpose: 'classification' }, { start: 0, end: 5, purpose: 'speaker' }] },
], entities: [{ mentionRef: 'pippa', kind: 'person', surfaceSpan: { start: 0, end: 5 }, attributeEvidence: [] }] };
const pippaTitle = createPresentationPageTitleEvidence({ fullText: pippaPageText, annotation: pippaAnnotation, sourceMessageIndex: 47,
    sourceMessageHash: 'full', viewSpan: { start: 0, end: pippaChars.length }, coreSpan: { start: 0, end: pippaChars.length } });
const pippaBasePage = { ...createStablePresentationBasePages({ text: pippaPageText, role: 'character', sourceMessageIndex: 47 })[0],
    sourceMessageHash: 'full', pageTitleEvidence: pippaTitle, pageTitleEvidenceViewSpan: { start: 0, end: pippaChars.length } };
assert.equal(getPresentationSpeakerLabel(pippaBasePage, { role: 'character' }), 'Pippa', 'mixed action and dialogue use validated page speaker evidence');
assert.equal(getPresentationVisualSpeakerContext(pippaBasePage, { role: 'character' }).role, 'unknown', 'page title evidence never binds an avatar');
assert.equal(pippaBasePage.text, pippaPageText, 'page title aggregation preserves the original body');

const fullMessageTitleText = '“The signal is clear.” Nira answered.';
const fullMessageChars = Array.from(fullMessageTitleText);
const fullMessageCore = { start: 1, end: Array.from('“The signal').length };
const fullMessageSpeakerStart = fullMessageChars.indexOf('N');
const fullMessageSpeakerEvidence = {
    sourceMessageIndex: 472,
    sourceMessageHash: 'sha256:full-message-structural',
    viewSpan: { start: fullMessageCore.start, end: fullMessageChars.length },
    coreSpan: { ...fullMessageCore },
    classificationEvidenceSpans: [{ start: fullMessageCore.start, end: fullMessageCore.end }],
    kind: 'speaker',
    text: 'Nira',
    speakers: [{ mentionRef: 'display-only-472-25-29', text: 'Nira', start: fullMessageSpeakerStart, end: fullMessageSpeakerStart + 4 }],
    ruleId: 'full-message-structural',
};
const fullMessagePage = {
    type: 'unknown', text: fullMessageChars.slice(fullMessageCore.start, fullMessageCore.end).join(''),
    sourceSpan: { ...fullMessageCore }, sourceMessageIndex: 472,
    sourceMessageHash: 'sha256:full-message-structural', identityRef: { type: 'unknown' },
    pageTitleEvidence: fullMessageSpeakerEvidence,
    pageTitleEvidenceViewSpan: fullMessageSpeakerEvidence.viewSpan,
};
assert.equal(getPresentationSpeakerLabel(fullMessagePage, { role: 'character' }), 'Nira',
    'full-message title provenance may include a suffix attribution after the page core');
assert.equal(getPresentationVisualSpeakerContext(fullMessagePage, { role: 'character' }).role, 'unknown',
    'full-message title metadata does not resolve visual identity');
assert.equal(getPresentationSpeakerLabel({ ...fullMessagePage, pageTitleEvidenceViewSpan: { start: fullMessageCore.start, end: fullMessageCore.end } }, { role: 'character' }), '未识别',
    'a speaker span outside the evidence envelope fails closed');
const semanticUnknownWithStructure = {
    ...fullMessagePage,
    semanticPresentation: { type: 'unattributed-dialogue', sourceText: fullMessagePage.text,
        sourceSpan: { ...fullMessageCore }, sourceMessageIndex: 472,
        sourceMessageHash: 'sha256:full-message-structural' },
};
assert.equal(getPresentationSpeakerLabel(semanticUnknownWithStructure, { role: 'character' }), 'Nira',
    'fully validated direct structural evidence may supply the display title when it covers all detected speech');
assert.equal(getPresentationVisualSpeakerContext(semanticUnknownWithStructure, { role: 'character' }).role, 'unknown',
    'structural title supplementation does not promote semantic unknown into a visual identity');

const unknownIntroductionText = '“我是塞拉菲娜，Eldoria林间秘境的守护者……”';
const unknownIntroductionLength = Array.from(unknownIntroductionText).length;
const unknownIntroductionHash = 'sha256:unknown-self-introduction';
const unknownIntroductionPage = {
    type: 'unattributed-dialogue', text: unknownIntroductionText,
    sourceSpan: { start: 0, end: unknownIntroductionLength }, sourceMessageIndex: 474,
    sourceMessageHash: unknownIntroductionHash, identityRef: { type: 'unknown' },
    semanticPresentation: { type: 'unattributed-dialogue', sourceText: unknownIntroductionText,
        sourceSpan: { start: 0, end: unknownIntroductionLength }, sourceMessageIndex: 474,
        sourceMessageHash: unknownIntroductionHash },
    pageTitleEvidence: {
        sourceMessageIndex: 474, sourceMessageHash: unknownIntroductionHash,
        viewSpan: { start: 0, end: unknownIntroductionLength }, coreSpan: { start: 0, end: unknownIntroductionLength },
        classificationEvidenceSpans: [{ start: 1, end: unknownIntroductionLength - 1 }],
        kind: 'classification', classification: 'unattributed-dialogue', text: '？？？', speakers: [],
        ruleId: 'unknown-self-introduction',
    },
    pageTitleEvidenceViewSpan: { start: 0, end: unknownIntroductionLength },
};
assert.equal(getPresentationSpeakerLabel(unknownIntroductionPage, { role: 'character' }), '？？？',
    'an unknown first-person introduction gets a neutral question-mark title despite semantic unknown');
assert.equal(getPresentationVisualSpeakerContext(unknownIntroductionPage, { role: 'character' }).role, 'unknown',
    'the question-mark introduction title does not create a visual identity');
assert.deepEqual(unknownIntroductionPage.identityRef, { type: 'unknown' });
const anonymousFirstAppearancePage = structuredClone(unknownIntroductionPage);
anonymousFirstAppearancePage.type = 'narration';
anonymousFirstAppearancePage.semanticPresentation.type = 'narration';
anonymousFirstAppearancePage.pageTitleEvidence.ruleId = 'anonymous-first-appearance';
assert.equal(getPresentationSpeakerLabel(anonymousFirstAppearancePage, { role: 'character' }), '？？？',
    'an unnamed first-appearance speaker uses the same neutral display label without becoming an identity');
assert.equal(getPresentationVisualSpeakerContext(anonymousFirstAppearancePage, { role: 'character' }).role, 'unknown');

const narrativeFrameText = '对方只用尖细的声音说：“哎哟哟……”';
const narrativeFrameLength = Array.from(narrativeFrameText).length;
const narrativeFrameHash = 'sha256:narrative-framed-quote';
const narrativeFramePage = {
    type: 'unattributed-dialogue', text: narrativeFrameText, sourceText: narrativeFrameText,
    sourceSpan: { start: 0, end: narrativeFrameLength }, sourceMessageIndex: 475,
    sourceMessageHash: narrativeFrameHash, identityRef: { type: 'unknown' },
    semanticPresentation: { type: 'unattributed-dialogue', sourceText: narrativeFrameText,
        sourceSpan: { start: 0, end: narrativeFrameLength }, sourceMessageIndex: 475, sourceMessageHash: narrativeFrameHash },
    pageTitleEvidence: {
        sourceMessageIndex: 475, sourceMessageHash: narrativeFrameHash,
        viewSpan: { start: 0, end: narrativeFrameLength }, coreSpan: { start: 0, end: narrativeFrameLength },
        classificationEvidenceSpans: [{ start: 0, end: narrativeFrameLength }],
        kind: 'classification', classification: 'narration', text: '旁白', speakers: [], ruleId: 'narrative-framed-quote',
    },
    pageTitleEvidenceViewSpan: { start: 0, end: narrativeFrameLength },
};
assert.equal(getPresentationSpeakerLabel(narrativeFramePage, { role: 'character' }), '旁白',
    'a validated anonymous descriptive quote frame displays as narrator');
assert.deepEqual(getPresentationVisualSpeakerContext(narrativeFramePage, { role: 'character' }), { role: 'narrator', speaker: '旁白' },
    'the narrator channel does not create a character identity');
assert.deepEqual(narrativeFramePage.identityRef, { type: 'unknown' }, 'narrator title evidence leaves identity unresolved');

const homeHeadingText = '治疗与审问：格雷戈的情报';
const homeHeadingLength = Array.from(homeHeadingText).length;
const homeHeadingPage = {
    type: 'unknown', text: homeHeadingText, sourceText: homeHeadingText,
    sourceSpan: { start: 0, end: homeHeadingLength }, sourceMessageIndex: 476,
    sourceMessageHash: 'sha256:home-heading', identityRef: { type: 'unknown' },
    pageTitleEvidence: {
        sourceMessageIndex: 476, sourceMessageHash: 'sha256:home-heading',
        viewSpan: { start: 0, end: homeHeadingLength }, coreSpan: { start: 0, end: homeHeadingLength },
        classificationEvidenceSpans: [{ start: 0, end: homeHeadingLength }],
        kind: 'classification', classification: 'other-visible', text: '标题', speakers: [], ruleId: 'structural-heading-shape',
    },
    pageTitleEvidenceViewSpan: { start: 0, end: homeHeadingLength },
};
assert.equal(getPresentationSpeakerLabel(homeHeadingPage, { role: 'character' }), '标题',
    'a validated first-page scene heading displays the heading label');
assert.deepEqual(getPresentationVisualSpeakerContext(homeHeadingPage, { role: 'character' }), { role: 'unknown', speaker: '未识别' },
    'a heading never selects a narrator or character visual identity');
for (const semanticType of ['narration', 'other-visible']) {
    const semanticHeadingPage = {
        ...homeHeadingPage,
        semanticPresentation: {
            type: semanticType,
            sourceMessageIndex: homeHeadingPage.sourceMessageIndex,
            sourceMessageHash: homeHeadingPage.sourceMessageHash,
            sourceSpan: { ...homeHeadingPage.sourceSpan },
            sourceText: homeHeadingText,
        },
    };
    assert.equal(getPresentationSpeakerLabel(semanticHeadingPage, { role: 'character' }), '标题',
        `validated heading title overrides semantic ${semanticType} for display only`);
    assert.deepEqual(getPresentationVisualSpeakerContext(semanticHeadingPage, { role: 'character' }),
        { role: 'unknown', speaker: '未识别' },
        `semantic ${semanticType} cannot turn a heading into narrator or character visual context`);
}

const structuralPageText = 'Celestia说：“我们走。”';
const structuralPageLength = Array.from(structuralPageText).length;
const structuralEvidence = createStructuralPageTitleEvidence({
    fullText: structuralPageText,
    sourceMessageIndex: 471,
    sourceMessageHash: 'sha256:structural-demo',
    viewSpan: { start: 0, end: structuralPageLength },
    coreSpan: { start: 0, end: structuralPageLength },
});
for (const type of ['unknown', 'dialogue', 'unattributed-dialogue']) {
    const structuralPage = {
        type,
        text: structuralPageText,
        sourceSpan: { start: 0, end: structuralPageLength },
        sourceMessageIndex: 471,
        sourceMessageHash: 'sha256:structural-demo',
        identityRef: { type: 'unknown' },
        pageTitleEvidence: structuralEvidence,
        pageTitleEvidenceViewSpan: { start: 0, end: structuralPageLength },
    };
    assert.equal(getPresentationSpeakerLabel(structuralPage, { role: 'character' }), 'Celestia',
        `${type} body-page type remains independent from display-only structural title evidence`);
    assert.equal(getPresentationVisualSpeakerContext(structuralPage, { role: 'character' }).role, 'unknown', 'a fast title never creates avatar identity');
    assert.equal(structuralPage.type, type, 'a title does not rewrite the semantic segment type');
    assert.equal(structuralPage.text, structuralPageText, 'a title does not rewrite message body');
}

const noIdentityDialoguePage = {
    type: 'dialogue',
    text: structuralPageText,
    sourceSpan: { start: 0, end: structuralPageLength },
    sourceMessageIndex: 471,
    sourceMessageHash: 'sha256:structural-demo',
    pageTitleEvidence: structuralEvidence,
    pageTitleEvidenceViewSpan: { start: 0, end: structuralPageLength },
};
assert.equal(getPresentationSpeakerLabel(noIdentityDialoguePage, { role: 'character' }), 'Celestia',
    'validated display-only attribution can label a dialogue page that has no identity reference');
assert.equal(noIdentityDialoguePage.identityRef, undefined, 'display title does not create an identity reference');
assert.equal(getPresentationVisualSpeakerContext(noIdentityDialoguePage, { role: 'character' }).role, 'unknown',
    'display title alone does not bind a portrait');

const resolvedIdentityWithConflictingTitle = {
    type: 'dialogue',
    speaker: 'Resolved Alice',
    identityRef: { type: 'published', id: 'alice' },
    text: structuralPageText,
    sourceSpan: { start: 0, end: structuralPageLength },
    sourceMessageIndex: 471,
    sourceMessageHash: 'sha256:structural-demo',
    pageTitleEvidence: structuralEvidence,
    pageTitleEvidenceViewSpan: { start: 0, end: structuralPageLength },
};
assert.equal(getPresentationSpeakerLabel(resolvedIdentityWithConflictingTitle, { role: 'character' }), 'Resolved Alice',
    'a resolved identity label takes precedence over conflicting structural title evidence');

const structuralGroupText = 'Nira说：“在这。”Venn答：“来了。”';
const structuralGroupLength = Array.from(structuralGroupText).length;
const structuralGroupEvidence = createStructuralPageTitleEvidence({
    fullText: structuralGroupText,
    sourceMessageIndex: 472,
    sourceMessageHash: 'sha256:structural-group-demo',
    viewSpan: { start: 0, end: structuralGroupLength },
    coreSpan: { start: 0, end: structuralGroupLength },
});
const noIdentityGroupDialoguePage = {
    type: 'dialogue',
    text: structuralGroupText,
    sourceSpan: { start: 0, end: structuralGroupLength },
    sourceMessageIndex: 472,
    sourceMessageHash: 'sha256:structural-group-demo',
    pageTitleEvidence: structuralGroupEvidence,
    pageTitleEvidenceViewSpan: { start: 0, end: structuralGroupLength },
};
assert.equal(getPresentationSpeakerLabel(noIdentityGroupDialoguePage, { role: 'character' }), '多人对话',
    'validated display-only group attribution can label an unbound dialogue page');
assert.equal(getPresentationVisualSpeakerContext(noIdentityGroupDialoguePage, { role: 'character' }).role, 'unknown',
    'multi-speaker title evidence alone does not create or choose a portrait');

const plainProseText = '你带着核心队伍前往Grand Harbor冒险者工会总部。';
const plainProseLength = Array.from(plainProseText).length;
const plainProseEvidence = createStructuralPageTitleEvidence({ fullText: plainProseText, sourceMessageIndex: 473,
    sourceMessageHash: 'sha256:plain-prose', viewSpan: { start: 0, end: plainProseLength }, coreSpan: { start: 0, end: plainProseLength } });
const plainProsePage = { ...createStablePresentationBasePages({ text: plainProseText, role: 'character', sourceMessageIndex: 473 })[0],
    sourceMessageHash: 'sha256:plain-prose', pageTitleEvidence: plainProseEvidence, pageTitleEvidenceViewSpan: { start: 0, end: plainProseLength } };
assert.equal(getPresentationSpeakerLabel(plainProsePage, { role: 'character' }), '旁白', 'unmarked prose has a coarse title fallback');
assert.equal(getPresentationVisualSpeakerContext(plainProsePage, { role: 'character' }).role, 'unknown',
    'coarse narration title does not create a narrator visual channel');
assert.deepEqual(plainProsePage.identityRef, { type: 'unknown' }, 'coarse narration title does not create identity');
assert.equal(plainProsePage.text, plainProseText, 'coarse narration title preserves the original page text');

for (const [sourceText, ruleId, classification, label] of [
    ['HP: 12\nAC: 16', 'structural-record-shape', 'narration', '旁白'],
    ['# 神罚仪式', 'structural-heading-shape', 'other-visible', '标题'],
]) {
    const length = Array.from(sourceText).length;
    const shapePage = {
        type: 'narration', text: sourceText, sourceText,
        sourceSpan: { start: 0, end: length }, sourceMessageIndex: 480,
        sourceMessageHash: `sha256:${ruleId}`,
        identityRef: { type: 'unknown' },
        pageTitleEvidence: {
            sourceMessageIndex: 480,
            sourceMessageHash: `sha256:${ruleId}`,
            viewSpan: { start: 0, end: length }, coreSpan: { start: 0, end: length },
            classificationEvidenceSpans: [{ start: 0, end: length }],
            kind: 'classification', classification, text: label, speakers: [], ruleId,
        },
        pageTitleEvidenceViewSpan: { start: 0, end: length },
    };
    assert.equal(getPresentationSpeakerLabel(shapePage, { role: 'character' }), label,
        `${ruleId} supplies a safe display title without altering page body`);
    assert.equal(getPresentationVisualSpeakerContext(shapePage, { role: 'character' }).role, 'unknown',
        `${ruleId} does not create narrator or character visual identity`);
    assert.equal(shapePage.text, sourceText);
    assert.deepEqual(shapePage.identityRef, { type: 'unknown' });
}

const semanticNarrationOverridesShapeTitle = {
    ...plainProsePage,
    pageTitleEvidence: {
        ...plainProseEvidence,
        ruleId: 'structural-record-shape', classification: 'narration', text: '旁白',
    },
    semanticPresentation: {
        type: 'narration', sourceMessageIndex: 473, sourceMessageHash: 'sha256:plain-prose',
        sourceSpan: { start: 0, end: plainProseLength }, sourceText: plainProseText,
    },
};
assert.equal(getPresentationSpeakerLabel(semanticNarrationOverridesShapeTitle, { role: 'character' }), '旁白',
    'valid semantic title evidence keeps priority over the structural shape sidecar');

const carriedQuoteText = 'Lila说：“先等下一页仍在说，再下一页结束。”';
const carriedQuoteChars = Array.from(carriedQuoteText);
const firstCarriedEnd = Array.from('Lila说：“先等').length;
const secondCarriedEnd = Array.from('Lila说：“先等下一页仍在说').length;
const firstCarriedTitle = createStructuralPageTitleEvidence({
    fullText: carriedQuoteText, sourceMessageIndex: 472, sourceMessageHash: 'sha256:carried-quote',
    viewSpan: { start: 0, end: firstCarriedEnd }, coreSpan: { start: 0, end: firstCarriedEnd },
});
const secondCarriedTitle = createStructuralPageTitleEvidence({
    fullText: carriedQuoteText, sourceMessageIndex: 472, sourceMessageHash: 'sha256:carried-quote',
    viewSpan: { start: 0, end: secondCarriedEnd }, coreSpan: { start: firstCarriedEnd, end: secondCarriedEnd },
    previousPage: { sourceMessageIndex: 472, sourceMessageHash: 'sha256:carried-quote',
        sourceSpan: { start: 0, end: firstCarriedEnd }, pageTitleEvidence: firstCarriedTitle,
        pageTitleEvidenceViewSpan: { start: 0, end: firstCarriedEnd } },
});
const thirdCarriedStart = secondCarriedEnd;
const thirdCarriedTitle = createStructuralPageTitleEvidence({
    fullText: carriedQuoteText, sourceMessageIndex: 472, sourceMessageHash: 'sha256:carried-quote',
    viewSpan: { start: firstCarriedEnd, end: carriedQuoteChars.length }, coreSpan: { start: thirdCarriedStart, end: carriedQuoteChars.length },
    previousPage: { sourceMessageIndex: 472, sourceMessageHash: 'sha256:carried-quote',
        sourceSpan: { start: firstCarriedEnd, end: secondCarriedEnd }, pageTitleEvidence: secondCarriedTitle,
        pageTitleEvidenceViewSpan: { start: 0, end: secondCarriedEnd } },
});
assert.equal(secondCarriedTitle?.text, 'Lila', 'an unclosed quote keeps the confirmed speaker across an intermediate page');
assert.equal(thirdCarriedTitle?.text, 'Lila', 'the speaker remains available when the carried quote closes on a later page');
const thirdCarriedPage = {
    type: 'unattributed-dialogue', text: carriedQuoteChars.slice(thirdCarriedStart).join(''),
    sourceSpan: { start: thirdCarriedStart, end: carriedQuoteChars.length }, sourceMessageIndex: 472,
    sourceMessageHash: 'sha256:carried-quote', identityRef: { type: 'unknown' },
    pageTitleEvidence: thirdCarriedTitle, pageTitleEvidenceViewSpan: { start: firstCarriedEnd, end: carriedQuoteChars.length },
};
assert.equal(getPresentationSpeakerLabel(thirdCarriedPage, { role: 'character' }), 'Lila',
    'a carried title may point to the original same-message speaker mention outside the immediate view');
assert.equal(getPresentationVisualSpeakerContext(thirdCarriedPage, { role: 'character' }).role, 'unknown');

const twoSpeakerText = 'Alice：你好。Bob：我在。';
const twoSpeakerChars = Array.from(twoSpeakerText);
const bobStart = twoSpeakerChars.findIndex((_, index) => twoSpeakerChars.slice(index, index + 3).join('') === 'Bob');
const groupTitle = createPresentationPageTitleEvidence({ fullText: twoSpeakerText, sourceMessageIndex: 48, sourceMessageHash: 'full',
    viewSpan: { start: 0, end: twoSpeakerChars.length }, coreSpan: { start: 0, end: twoSpeakerChars.length }, annotation: { segments: [
        { start: 0, end: bobStart, kind: 'dialogue', speakerMentionRef: 'alice', speakerSource: 'text-explicit',
            evidenceSpans: [{ start: 0, end: bobStart, purpose: 'classification' }, { start: 0, end: 5, purpose: 'speaker' }] },
        { start: bobStart, end: twoSpeakerChars.length, kind: 'dialogue', speakerMentionRef: 'bob', speakerSource: 'text-explicit',
            evidenceSpans: [{ start: bobStart, end: twoSpeakerChars.length, purpose: 'classification' }, { start: bobStart, end: bobStart + 3, purpose: 'speaker' }] },
    ], entities: [
        { mentionRef: 'alice', kind: 'person', surfaceSpan: { start: 0, end: 5 }, attributeEvidence: [] },
        { mentionRef: 'bob', kind: 'person', surfaceSpan: { start: bobStart, end: bobStart + 3 }, attributeEvidence: [] },
    ] } });
assert.equal(groupTitle?.text, '多人对话', 'multiple explicit speakers in one page aggregate to a group title');

const unattributedPageText = '附近传来一句没有署名的话。';
const unattributedPageLength = Array.from(unattributedPageText).length;
const unattributedPageTitle = createPresentationPageTitleEvidence({
    fullText: unattributedPageText,
    sourceMessageIndex: 480,
    sourceMessageHash: 'unattributed-page',
    viewSpan: { start: 0, end: unattributedPageLength },
    coreSpan: { start: 0, end: unattributedPageLength },
    annotation: { segments: [{ start: 0, end: unattributedPageLength, kind: 'unattributed-dialogue',
        evidenceSpans: [{ start: 0, end: unattributedPageLength, purpose: 'classification' }] }], entities: [] },
});
assert.equal(unattributedPageTitle?.text, '未识别', 'page-window unattributed dialogue has an explicit neutral title mapping');
assert.equal(unattributedPageTitle?.classification, 'unattributed-dialogue');
assert.deepEqual(unattributedPageTitle?.classificationEvidenceSpans, [{ start: 0, end: unattributedPageLength }],
    'the neutral title remains backed only by classification evidence inside the displayed core');

const continuationText = 'Alice：“上一页。”\n\n续言😀这是当前页。';
const continuationPages = createStablePresentationBasePages({ text: continuationText, role: 'character', sourceMessageIndex: 49 });
const continuationWindow = createPresentationPageWindow({ sourceText: continuationText, pages: continuationPages, pageIndex: 1, lookbehindPages: 1 });
const continuationChars = Array.from(continuationWindow.viewText);
const continuationCoreStart = continuationWindow.coreSpan.start - continuationWindow.viewSpan.start;
const continuationTitle = createPresentationPageTitleEvidence({ fullText: continuationText, sourceMessageIndex: 49, sourceMessageHash: 'full',
    viewSpan: continuationWindow.viewSpan, coreSpan: continuationWindow.coreSpan, annotation: { segments: [{ start: 0, end: continuationChars.length,
        kind: 'dialogue', speakerMentionRef: 'alice', speakerSource: 'quoted-attribution', evidenceSpans: [
            { start: 0, end: 5, purpose: 'speaker' }, { start: continuationCoreStart, end: continuationChars.length, purpose: 'classification' },
        ] }], entities: [{ mentionRef: 'alice', kind: 'person', surfaceSpan: { start: 0, end: 5 }, attributeEvidence: [] }] } });
assert.equal(continuationTitle?.text, 'Alice', 'one adjacent same-message lookbehind may evidence a continued speaker');
assert.equal(createPresentationPageTitleEvidence({ fullText: pippaPageText, annotation: { ...pippaAnnotation,
    segments: pippaAnnotation.segments.map((segment) => ({ ...segment, evidenceSpans: segment.evidenceSpans.filter((span) => span.purpose !== 'speaker') })) },
    sourceMessageIndex: 47, sourceMessageHash: 'full', viewSpan: { start: 0, end: pippaChars.length }, coreSpan: { start: 0, end: pippaChars.length } }),
null, 'missing speaker evidence leaves mixed dialogue page unknown');

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

// Unknown-safe rendering preserves every formatted code point and paragraph delimiter.
for (const text of ['', '😀标题\n正文', 'Alice：“开门。”\n\n陌生人：“别动。”', '长'.repeat(5000)]) {
    const safe = createSafePresentationDisplaySegments({ text, sourceMessageIndex: 7, sourceMessageHash: 'hash' });
    assert.equal(safe.map((segment) => segment.text).join(''), text);
    assert.equal(safe[0].sourceSpan.start, 0);
    assert.equal(safe.at(-1).sourceSpan.end, Array.from(text).length);
    for (let index = 0; index < safe.length; index++) {
        const segment = safe[index];
        assert.equal(segment.type, 'unknown');
        assert.deepEqual(segment.identityRef, { type: 'unknown' });
        assert.equal(segment.sourceText, Array.from(text).slice(segment.sourceSpan.start, segment.sourceSpan.end).join(''));
        assert.equal(segment.sourceMessageIndex, 7);
        if (index) assert.equal(segment.sourceSpan.start, safe[index - 1].sourceSpan.end);
    }
    if (text.length === 5000) assert.equal(safe.length, 1, 'oversized paragraph is never cut to a character budget');
}
const playerSafe = createSafePresentationDisplaySegments({ text: '我前进。', role: 'player' });
assert.equal(playerSafe[0].type, 'player');
assert.equal(getPresentationSpeakerLabel(playerSafe[0], { role: 'player' }), '你');
assert.equal(getPresentationVisualSpeakerContext(playerSafe[0], { role: 'player' }).role, 'player');
for (const [type, label, role] of [
    ['unknown', '未识别', 'unknown'], ['unattributed-dialogue', '未识别', 'unknown'],
    ['dialogue', '未识别', 'unknown'], ['narration', '旁白', 'narrator'],
    ['stage', '动作', 'unknown'], ['stage-direction', '动作', 'unknown'],
    ['status', '状态', 'unknown'], ['choice', '选项', 'unknown'], ['other-visible', '正文', 'unknown'],
]) {
    const segment = { type, speaker: '消息作者不能成为说话人', identityRef: { type: 'unknown' } };
    assert.equal(getPresentationSpeakerLabel(segment, { role: 'character', speaker: '旁白' }), label);
    assert.equal(getPresentationVisualSpeakerContext(segment, { role: 'character', speaker: '旁白' }).role, role);
}
for (const identityRef of [{ type: 'published', id: 'alice' }, { type: 'chat-local', id: 'cl_a' }]) {
    const segment = { type: 'dialogue', speaker: 'Alice', identityRef };
    assert.equal(getPresentationSpeakerLabel(segment, { role: 'character', speaker: '旁白' }), 'Alice');
    assert.equal(getPresentationVisualSpeakerContext(segment, { role: 'character', speaker: '旁白' }).role, 'character');
}
assert.equal(getPresentationVisualSpeakerContext(null, { role: 'character', speaker: 'Narrator' }).role, 'unknown');
assert.equal(getPresentationVisualSpeakerContext({ type: 'dialogue', speaker: 'Alice', identityRef: { type: 'invented', id: 'alice' } }, { role: 'character' }).role, 'unknown');

const openQuoteText = 'Alice：“未结束。旁白。陌生对白。';
const aliceEnd = Array.from('Alice').length;
const openQuoteSegments = createPresentationDisplaySegments({
    text: openQuoteText, sourceMessageIndex: 9,
    sourceMessageHash: 'sha256:open-quote',
    annotation: { segments: [
        { kind: 'dialogue', start: 0, end: 11, speakerMentionRef: 'm0', speakerSource: 'text-explicit', evidenceSpans: [{ start: 0, end: aliceEnd, purpose: 'speaker' }] },
        { kind: 'narration', start: 11, end: 14 },
        { kind: 'unattributed-dialogue', start: 14, end: Array.from(openQuoteText).length },
    ], entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: 0, end: aliceEnd } }] },
    projection: { complete: true, segmentSpeakers: [{ sourceMessageIndex: 9, segmentIndex: 0, resolvedSpeakerRef: { type: 'published', id: 'a' } }], publishedCast: [{ id: 'a', displayName: 'Alice' }] },
});
assert.equal(openQuoteSegments[1].type, 'narration', 'a missing closing quote cannot override the validated narration kind');
assert.equal(openQuoteSegments[2].type, 'unattributed-dialogue', 'unknown dialogue cannot inherit a prior identity from punctuation alone');
assert.deepEqual(openQuoteSegments[2].identityRef, { type: 'unknown' });

const continuingSource = 'Alice：“继续。仍是Alice。”';
const continuingDialogue = createPresentationDisplaySegments({
    text: continuingSource, sourceMessageIndex: 10, sourceMessageHash: 'hash',
    annotation: { segments: [{ kind: 'dialogue', start: 0, end: 10 }, { kind: 'dialogue', start: 10, end: Array.from(continuingSource).length }] },
    projection: { complete: true, segmentSpeakers: [0, 1].map((segmentIndex) => ({ sourceMessageIndex: 10, segmentIndex, resolvedSpeakerRef: { type: 'chat-local', id: 'alice' } })),
        entities: [{ identityRef: { type: 'chat-local', id: 'alice' }, aliases: [{ value: 'Alice' }] }] },
});
assert.equal(continuingDialogue[1].speakerContinuation, true);
assert.equal(continuingDialogue[1].speaker, 'Alice');
assert.equal(continuingDialogue[1].type, 'dialogue');
assert.deepEqual(continuingDialogue[1].identityRef, continuingDialogue[0].identityRef);
const discontinuousDialogue = createPresentationDisplaySegments({
    text: continuingSource, sourceMessageIndex: 10,
    annotation: { segments: [{ kind: 'dialogue', start: 0, end: 9 }, { kind: 'dialogue', start: 10, end: Array.from(continuingSource).length }] },
    projection: { complete: true, segmentSpeakers: [0, 1].map((segmentIndex) => ({ sourceMessageIndex: 10, segmentIndex, resolvedSpeakerRef: { type: 'chat-local', id: 'alice' } })),
        entities: [{ identityRef: { type: 'chat-local', id: 'alice' }, aliases: [{ value: 'Alice' }] }] },
});
assert.equal(discontinuousDialogue[1].speakerContinuation, undefined, 'a source gap breaks continuation');

assert.equal(getPresentationSpeakerLabel({ type: 'constructor' }, { role: 'character', speaker: 'Author' }), '未识别', 'untrusted type names cannot escape the closed label mapping');

const continuationIdentity = { type: 'chat-local', id: 'alice' };
function continuationFixture(firstText, secondText, { kind = 'unattributed-dialogue', messageIndex = 20, hash = 'sha256:same', gap = 0 } = {}) {
    const firstEnd = Array.from(firstText).length;
    return [
        { type: 'dialogue', speaker: 'Alice', identityRef: continuationIdentity, text: firstText, sourceText: firstText,
            sourceSpan: { start: 0, end: firstEnd }, sourceMessageIndex: 20, sourceMessageHash: 'sha256:same' },
        { type: kind, speaker: kind === 'dialogue' ? 'Alice' : '未识别', identityRef: kind === 'dialogue' ? continuationIdentity : { type: 'unknown' },
            text: secondText, sourceText: secondText, sourceSpan: { start: firstEnd + gap, end: firstEnd + gap + Array.from(secondText).length },
            sourceMessageIndex: messageIndex, sourceMessageHash: hash },
    ];
}
for (const firstText of ['Alice：“说完了。”', 'Alice：没有引号。']) {
    for (const kind of ['dialogue', 'unattributed-dialogue']) {
        const result = applyAnnotationDialogueSpeakerContinuity(continuationFixture(firstText, '下一段正文。', { kind }));
        assert.equal(result[1].type, kind, 'closed or absent quotes cannot reclassify a segment');
        assert.equal(result[1].speakerContinuation, undefined, 'identity adjacency alone is not quote continuation');
        if (kind === 'unattributed-dialogue') assert.deepEqual(result[1].identityRef, { type: 'unknown' });
    }
}
for (const kind of ['dialogue', 'unattributed-dialogue']) {
    const sourceSegments = continuationFixture('Alice：“我还没说完，', '现在说完了。”', { kind });
    const result = applyAnnotationDialogueSpeakerContinuity(sourceSegments);
    assert.equal(result[1].type, 'dialogue');
    assert.equal(result[1].speakerContinuation, true);
    assert.deepEqual(result[1].identityRef, continuationIdentity);
    assert.equal(result[1].speaker, 'Alice');
    assert.equal(result.map((segment) => segment.text).join(''), sourceSegments.map((segment) => segment.text).join(''));
    assert.equal(sourceSegments[1].type, kind, 'continuity never mutates the source annotations');
}
for (const options of [{ kind: 'narration' }, { messageIndex: 21 }, { hash: 'sha256:different' }, { gap: 1 }, { hash: '' }]) {
    const sourceSegments = continuationFixture('Alice：“我还没说完，', '下一段正文。”', options);
    const result = applyAnnotationDialogueSpeakerContinuity(sourceSegments);
    assert.equal(result[1].type, options.kind || 'unattributed-dialogue');
    assert.deepEqual(result[1].identityRef, { type: 'unknown' });
    assert.equal(result[1].speakerContinuation, undefined, 'narration and source mismatches cannot inherit a speaker');
}
const noResolvedPredecessor = continuationFixture('未知：“话未说完，', '继续。”');
noResolvedPredecessor[0].identityRef = { type: 'unknown' };
assert.equal(applyAnnotationDialogueSpeakerContinuity(noResolvedPredecessor)[1].type, 'unattributed-dialogue');
const malformedClosing = continuationFixture('Alice：“话未说完，', '错误的结束引号」');
assert.equal(applyAnnotationDialogueSpeakerContinuity(malformedClosing)[1].type, 'unattributed-dialogue');

// Whole-segment inheritance must not claim visible text after the carried quote closes.
for (const secondText of ['说完了。”旁白继续。', '😀说完了。”\n旁白继续。', '😀结束。”X', '结束了。” “新说话者的台词。”', '结束了。”。']) {
    const sourceSegments = continuationFixture('Alice：“未结束，', secondText);
    const result = applyAnnotationDialogueSpeakerContinuity(sourceSegments);
    assert.equal(result[1].type, 'unattributed-dialogue', 'visible suffix after closure keeps the entire segment unknown');
    assert.deepEqual(result[1].identityRef, { type: 'unknown' });
    assert.equal(result[1].speakerContinuation, undefined);
    assert.equal(result[1].sourceText, secondText, 'fail closed keeps every Unicode code point intact');
    assert.deepEqual(result[1].sourceSpan, sourceSegments[1].sourceSpan);
}
for (const secondText of ['😀现在结束。”', '😀现在结束。” \n\t']) {
    const result = applyAnnotationDialogueSpeakerContinuity(continuationFixture('Alice：“未结束，', secondText));
    assert.equal(result[1].type, 'dialogue', 'an astral character before terminal closure does not shift its code-point offset');
    assert.equal(result[1].speakerContinuation, true);
    assert.deepEqual(result[1].identityRef, continuationIdentity);
}
const asciiSuffix = applyAnnotationDialogueSpeakerContinuity(continuationFixture('Alice: "unfinished ', '😀done" narrator text'));
assert.equal(asciiSuffix[1].type, 'unattributed-dialogue', 'ASCII carried quotes enforce the same suffix boundary');

const probableRendererText = 'Nira immediately objected: “No.”';
const probableRendererPage = createVisualNovelDisplaySegments(probableRendererText, {
    role: 'character', knownSpeakers: [],
})[0];
const probableRendererHash = await hashText(probableRendererText);
const probableRendererTitle = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: probableRendererText,
    sourceMessageIndex: 73,
    sourceMessageHash: probableRendererHash,
    coreSpan: probableRendererPage.sourceSpan,
    segment: probableRendererPage,
});
const probableRendererSegment = {
    ...probableRendererPage,
    sourceMessageIndex: 73,
    sourceMessageHash: probableRendererHash,
    identityRef: { type: 'unknown' },
    semanticPresentation: { type: 'unattributed-dialogue' },
    pageTitleEvidence: probableRendererTitle,
    pageTitleEvidenceViewSpan: probableRendererPage.sourceSpan,
};
assert.equal(getPresentationSpeakerLabel(probableRendererSegment, { role: 'character' }), 'Nira（推测）');
assert.deepEqual(getPresentationVisualSpeakerContext(probableRendererSegment, { role: 'character' }), {
    role: 'unknown', speaker: '未识别',
}, 'a display-only probable title does not create a resolved visual identity');
const narratorStillNarrates = {
    ...probableRendererSegment,
    semanticPresentation: {
        type: 'narration',
        sourceMessageIndex: 73,
        sourceMessageHash: probableRendererHash,
        sourceSpan: probableRendererPage.sourceSpan,
        sourceText: probableRendererPage.sourceText,
    },
};
assert.equal(getPresentationSpeakerLabel(narratorStillNarrates, { role: 'character' }), '旁白',
    'existing semantic narration remains authoritative over probable title hints');
