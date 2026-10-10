import { applyAnnotationDialogueSpeakerContinuity, createVisualNovelDisplaySegments, isStructuralExactSpeakerTitleRule, isStructuralFastTitleRule } from './shared/sillytavern-adapter.js?v=galgame-2026-10-10-speaker-title-v4';
import { deriveSceneContinuityKey } from './shared/scene-continuity-analysis.js?v=galgame-2026-10-10-speaker-title-v4';

// User-requested experimental activation for the currently published Chinese
// story. The gate report stays empty: this is an explicit unverified rollout,
// not a claim that the gold-corpus production thresholds have passed.
export const PRESENTATION_ANNOTATION_MODE = 'assisted';
export const PRESENTATION_GATE_REPORTS = Object.freeze({});
export const PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES = Object.freeze(['zh-CN']);
export const MAX_ASSISTED_PRESENTATION_MESSAGES = 12;
export const SCENE_CONTINUITY_LEDGER_SCHEMA_VERSION = 'galgame.scene-continuity-ledger.v2';
export const SCENE_CONTINUITY_LEDGER_STORAGE_PREFIX = 'galgame.scene-continuity-ledger.v2.';

const SCENE_LEDGER_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PRESENTATION_PAGE_TITLE_RULES = new Set([
    'known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution',
    'rostered-subject-quoted-clause',
    'structured-speaker', 'open-quote-continuation', 'full-message-structural',
    'annotation-title', 'plain-prose-narration', 'unattributed-quoted-speech',
    'structural-record-shape', 'structural-heading-shape', 'unattributed-dialogue-shape',
    'pronoun-backreference', 'recent-action-backreference', 'unknown-self-introduction', 'anonymous-first-appearance', 'narrative-framed-quote',
    'probable-narrative-dialogue', 'probable-quote-span-continuation',
    'player-direct-speech', 'player-first-person-action', 'honorific-display-title',
    'group-role-prefix', 'unrostered-action-attribution',
]);

export async function createSceneContinuityLedgerStorageKey(scopeKey, hashText) {
    if (typeof scopeKey !== 'string' || !scopeKey || typeof hashText !== 'function') return '';
    const digest = await hashText(scopeKey);
    const hex = String(digest || '').replace(/^sha256:/u, '');
    return /^[a-f0-9]{64}$/u.test(hex) ? `${SCENE_CONTINUITY_LEDGER_STORAGE_PREFIX}${hex}` : '';
}

export function sanitizeSceneContinuityLedgerRecord(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const scope = record.scope;
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return null;
    const normalizedScope = {
        chatId: String(scope.chatId || ''),
        releaseId: String(scope.releaseId || ''),
        arcId: scope.arcId == null ? null : String(scope.arcId),
        catalogId: String(scope.catalogId || ''),
        catalogRevision: scope.catalogRevision,
        catalogHash: String(scope.catalogHash || ''),
    };
    if (!normalizedScope.chatId || !normalizedScope.releaseId || !normalizedScope.catalogId
        || !Number.isSafeInteger(normalizedScope.catalogRevision) || normalizedScope.catalogRevision < 1
        || !SCENE_LEDGER_HASH_PATTERN.test(normalizedScope.catalogHash)
        || typeof record.scopeKey !== 'string' || !record.scopeKey
        || !Number.isSafeInteger(record.messageIndex) || record.messageIndex < 0
        || !Number.isSafeInteger(record.pageIndex) || record.pageIndex < 0
        || typeof record.messageId !== 'string' || !record.messageId
        || !SCENE_LEDGER_HASH_PATTERN.test(String(record.sourceMessageHash || ''))
        || !SCENE_LEDGER_HASH_PATTERN.test(String(record.pageTextHash || ''))
        || !SCENE_LEDGER_HASH_PATTERN.test(String(record.timelinePrefixHash || ''))
        || !record.sourceSpan || !Number.isSafeInteger(record.sourceSpan.start)
        || !Number.isSafeInteger(record.sourceSpan.end) || record.sourceSpan.start < 0
        || record.sourceSpan.end <= record.sourceSpan.start
        || !record.sceneLocationSpan || !Number.isSafeInteger(record.sceneLocationSpan.start)
        || !Number.isSafeInteger(record.sceneLocationSpan.end) || record.sceneLocationSpan.start < record.sourceSpan.start
        || record.sceneLocationSpan.end <= record.sceneLocationSpan.start
        || record.sceneLocationSpan.end > record.sourceSpan.end
        || typeof record.sceneKey !== 'string' || !record.sceneKey
        || typeof record.displayLabel !== 'string' || !record.displayLabel
        || typeof (record.lineageFingerprint ?? '') !== 'string') return null;
    return {
        scopeKey: record.scopeKey,
        scope: normalizedScope,
        messageIndex: record.messageIndex,
        pageIndex: record.pageIndex,
        messageId: record.messageId,
        sourceMessageHash: record.sourceMessageHash,
        pageTextHash: record.pageTextHash,
        timelinePrefixHash: record.timelinePrefixHash,
        sourceSpan: { start: record.sourceSpan.start, end: record.sourceSpan.end },
        sceneLocationSpan: { start: record.sceneLocationSpan.start, end: record.sceneLocationSpan.end },
        sceneKey: record.sceneKey,
        displayLabel: record.displayLabel.slice(0, 160),
        lineageFingerprint: record.lineageFingerprint || '',
    };
}

export function serializeSceneContinuityLedger(scopeKey, records = []) {
    if (typeof scopeKey !== 'string' || !scopeKey) return '';
    const safeRecords = (Array.isArray(records) ? records : [])
        .map(sanitizeSceneContinuityLedgerRecord)
        .filter((record) => record?.scopeKey === scopeKey);
    return JSON.stringify({ schemaVersion: SCENE_CONTINUITY_LEDGER_SCHEMA_VERSION, scopeKey, records: safeRecords });
}

export function capSceneContinuityLedgerRecords(records = [], limit = 512) {
    const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : 512;
    return (Array.isArray(records) ? records : [])
        .map(sanitizeSceneContinuityLedgerRecord)
        .filter(Boolean)
        .slice(-safeLimit);
}

export function parseSceneContinuityLedger(serialized, expectedScopeKey) {
    if (typeof expectedScopeKey !== 'string' || !expectedScopeKey || typeof serialized !== 'string') return [];
    try {
        const envelope = JSON.parse(serialized);
        if (envelope?.schemaVersion !== SCENE_CONTINUITY_LEDGER_SCHEMA_VERSION
            || envelope.scopeKey !== expectedScopeKey || !Array.isArray(envelope.records)) return [];
        return envelope.records.map(sanitizeSceneContinuityLedgerRecord)
            .filter((record) => record?.scopeKey === expectedScopeKey);
    } catch {
        return [];
    }
}

export async function createSceneContinuityTimelinePrefixHash(messages = [], throughIndex, hashText) {
    if (!Array.isArray(messages) || !Number.isSafeInteger(throughIndex) || throughIndex < 0
        || throughIndex >= messages.length || typeof hashText !== 'function') return '';
    const rows = [];
    for (let index = 0; index <= throughIndex; index += 1) {
        const message = messages[index];
        const text = String(message?.displayText || message?.text || '');
        rows.push({
            arrayIndex: index,
            messageId: String(message?.index ?? index),
            role: String(message?.role || ''),
            speaker: String(message?.speaker || ''),
            sourceMessageHash: await hashText(text),
        });
    }
    return hashText(JSON.stringify(rows));
}

export function sceneContinuityRecordFingerprint(record) {
    if (!record) return '';
    return JSON.stringify([
        record.scopeKey, record.messageIndex, record.pageIndex, record.messageId,
        record.sourceMessageHash, record.pageTextHash, record.sceneKey,
    ]);
}

export function isSceneContinuityProjectionBoundToCursor(projection, cursor) {
    const scope = cursor?.scope;
    const projectionScope = projection?.scope;
    const scopeMatches = scope && projectionScope
        && ['chatId', 'releaseId', 'arcId', 'catalogId', 'catalogRevision', 'catalogHash']
            .every((key) => projectionScope[key] === scope[key]);
    return scopeMatches
        && projection?.schemaVersion === 'galgame.scene-continuity.v1'
        && projection.segment?.messageId === cursor.messageId
        && projection.segment?.pageIndex === cursor.pageIndex
        && projection.segment?.pageTextSha256 === cursor.pageTextHash;
}

export async function validateSceneContinuityLedgerRecords(records = [], {
    messages = [], scopeKey = '', expectedScope = null, hashText, formatSourceText = (value) => value,
} = {}) {
    const rows = (Array.isArray(records) ? records : [])
        .map(sanitizeSceneContinuityLedgerRecord)
        .filter((record) => record?.scopeKey === scopeKey)
        .sort((left, right) => left.messageIndex - right.messageIndex || left.pageIndex - right.pageIndex);
    if (typeof hashText !== 'function' || !Array.isArray(messages)) return [];
    const prefixHashes = new Map();
    const valid = [];
    for (const record of rows) {
        if (expectedScope && !['chatId', 'releaseId', 'arcId', 'catalogId', 'catalogRevision', 'catalogHash']
            .every((key) => record.scope[key] === expectedScope[key])) continue;
        const message = messages[record.messageIndex];
        if (message?.role !== 'character'
            || String(message.index ?? record.messageIndex) !== record.messageId) continue;
        const visibleText = String(message.displayText || message.text || '');
        if (await hashText(visibleText) !== record.sourceMessageHash) continue;
        const sourceText = Array.from(String(formatSourceText(visibleText)));
        const { start, end } = record.sourceSpan;
        if (end > sourceText.length) continue;
        const locationSpan = record.sceneLocationSpan;
        if (locationSpan.end > sourceText.length) continue;
        const pageText = sourceText.slice(start, end).join('');
        if (!pageText || await hashText(pageText) !== record.pageTextHash) continue;
        const location = sourceText.slice(locationSpan.start, locationSpan.end).join('').trim();
        if (!location || await deriveSceneContinuityKey(record.scope, location) !== record.sceneKey) continue;
        if (!prefixHashes.has(record.messageIndex)) {
            prefixHashes.set(record.messageIndex, await createSceneContinuityTimelinePrefixHash(messages, record.messageIndex, hashText));
        }
        if (prefixHashes.get(record.messageIndex) !== record.timelinePrefixHash) continue;
        const previous = [...valid].reverse().find((candidate) => isSceneContinuityCursorStrictlyEarlier(candidate, record));
        const expectedLineage = previous ? sceneContinuityRecordFingerprint(previous) : '';
        if ((record.lineageFingerprint || '') !== expectedLineage) continue;
        const validated = { ...record, pageText, displayLabel: location.slice(0, 80), timelineValidated: true };
        valid.push(validated);
    }
    return valid;
}

export function selectPresentationAnalysisMessages(messages = [], activeIndex, mode = PRESENTATION_ANNOTATION_MODE) {
    if (mode === 'shadow') {
        const index = Number.isSafeInteger(activeIndex) ? activeIndex : -1;
        const message = Array.isArray(messages) ? messages[index] : null;
        return message?.role === 'character' && String(message.displayText || message.text || '').trim()
            ? [{ message, index }]
            : [];
    }
    const activeMessageIndex = Number.isSafeInteger(activeIndex) ? activeIndex : Number.MAX_SAFE_INTEGER;
    const assistantMessages = (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({ message, index }))
        .filter(({ message, index }) => index <= activeMessageIndex
            && message?.role === 'character' && String(message.displayText || message.text || '').trim());
    return assistantMessages.slice(-MAX_ASSISTED_PRESENTATION_MESSAGES);
}

export function deferShadowPresentationAnalysisUntilVisualSettles(visualTask, startAnalysis, signal) {
    return Promise.resolve(visualTask)
        .catch(() => undefined)
        .then(() => {
            if (signal?.aborted) return undefined;
            return startAnalysis();
        });
}

export function isSceneContinuityCursorStrictlyEarlier(candidate, current) {
    if (!candidate || !current || candidate.scopeKey !== current.scopeKey
        || !Number.isSafeInteger(candidate.messageIndex) || !Number.isSafeInteger(candidate.pageIndex)
        || !Number.isSafeInteger(current.messageIndex) || !Number.isSafeInteger(current.pageIndex)) return false;
    return candidate.messageIndex < current.messageIndex
        || (candidate.messageIndex === current.messageIndex && candidate.pageIndex < current.pageIndex);
}

export function shouldWaitForSceneContinuityTask(taskCursor, currentCursor) {
    // A request for another page is stale as soon as the player changes the
    // visible page. Only deduplicate an identical current-page request; never
    // make the current page wait for an older page's provider round trip.
    return taskCursor?.scopeKey === currentCursor?.scopeKey
        && taskCursor?.messageIndex === currentCursor?.messageIndex
        && taskCursor?.pageIndex === currentCursor?.pageIndex
        && taskCursor?.messageId === currentCursor?.messageId
        && taskCursor?.sourceMessageHash === currentCursor?.sourceMessageHash
        && taskCursor?.pageTextHash === currentCursor?.pageTextHash
        && taskCursor?.timelinePrefixHash === currentCursor?.timelinePrefixHash
        && taskCursor?.sourceSpan?.start === currentCursor?.sourceSpan?.start
        && taskCursor?.sourceSpan?.end === currentCursor?.sourceSpan?.end;
}

export async function waitForPriorSceneContinuityTask(task, currentCursor) {
    if (!task) return true;
    if (!shouldWaitForSceneContinuityTask(task.cursor, currentCursor)) return false;
    await task.promise;
    return true;
}

export function selectLatestEarlierCompletedScenePage(records = [], current) {
    return (Array.isArray(records) ? records : [])
        .filter((record) => record?.timelineValidated === true && record.sceneKey
            && isSceneContinuityCursorStrictlyEarlier(record, current))
        .sort((left, right) => right.messageIndex - left.messageIndex || right.pageIndex - left.pageIndex)[0] || null;
}

export function canApplySceneContinuityPageResult({ resultToken, currentToken, resultCursor, currentCursor } = {}) {
    return resultToken === currentToken
        && resultCursor?.timelineValidated === true
        && currentCursor?.timelineValidated === true
        && resultCursor?.scopeKey === currentCursor?.scopeKey
        && resultCursor?.messageIndex === currentCursor?.messageIndex
        && resultCursor?.pageIndex === currentCursor?.pageIndex
        && resultCursor?.messageId === currentCursor?.messageId
        && resultCursor?.sourceMessageHash === currentCursor?.sourceMessageHash
        && resultCursor?.pageTextHash === currentCursor?.pageTextHash
        && resultCursor?.timelinePrefixHash === currentCursor?.timelinePrefixHash
        && resultCursor?.sourceSpan?.start === currentCursor?.sourceSpan?.start
        && resultCursor?.sourceSpan?.end === currentCursor?.sourceSpan?.end
        && resultCursor?.lineageFingerprint === currentCursor?.lineageFingerprint;
}

/**
 * Convert already-validated annotation data to renderer-neutral segments.
 * This pure function is shared with the isolated QA harness. In production the
 * compile-time mode remains shadow until a language gate is accepted.
 */
export function resolvePresentationMode(language = '') {
    if (PRESENTATION_ANNOTATION_MODE !== 'assisted') return PRESENTATION_ANNOTATION_MODE;
    const requestedLanguage = String(language);
    return PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES.includes(requestedLanguage)
        || Object.hasOwn(PRESENTATION_GATE_REPORTS, requestedLanguage) ? 'assisted' : 'shadow';
}

/** Display-only paragraph boundaries never imply a speaker or narrative kind. */
export function createSafePresentationDisplaySegments({ text = '', role = 'character', fallbackSpeaker = '', sourceMessageIndex, sourceMessageHash = '', knownSpeakers = [] } = {}) {
    const source = Array.from(String(text ?? ''));
    const fallback = () => {
        const ends = [];
        for (let index = 0; index < source.length - 1; index += 1) {
            if (source[index] === '\n' && source[index + 1] === '\n') {
                ends.push(index + 2);
                index += 1;
            }
        }
        if (ends.at(-1) !== source.length) ends.push(source.length);
        let start = 0;
        return ends.map((end, index) => {
            const value = source.slice(start, end).join('');
            const segment = {
                index,
                type: role === 'player' ? 'player' : 'unknown',
                speaker: role === 'player' ? '你' : '未识别',
                identityRef: { type: 'unknown' },
                text: value,
                sourceText: value,
                sourceSpan: { start, end },
                sourceMessageIndex,
                sourceMessageHash,
            };
            start = end;
            return segment;
        });
    };
    if (!source.length) return fallback();

    // Reuse the former display splitter's source boundaries, but never its
    // rewritten segment text or guessed speaker/type. Expand whitespace gaps
    // into the preceding source slice so the displayed pages still cover the
    // complete, unchanged source in order.
    const historical = createVisualNovelDisplaySegments(source.join(''), { role, fallbackSpeaker, knownSpeakers });
    const spans = historical.map((segment) => segment?.sourceSpan);
    let cursor = 0;
    const valid = spans.length > 0 && historical.every((segment, index) => {
        const span = spans[index];
        if (!Number.isSafeInteger(span?.start) || !Number.isSafeInteger(span?.end)
            || span.start < cursor || span.end <= span.start || span.end > source.length) return false;
        const leadingGap = source.slice(cursor, span.start).join('');
        const segmentSource = source.slice(span.start, span.end).join('');
        if (/\S/u.test(leadingGap) || segmentSource !== String(segment?.sourceText || '')) return false;
        cursor = span.end;
        return true;
    }) && !/\S/u.test(source.slice(cursor).join(''));
    if (!valid) return fallback();

    const starts = [0, ...spans.slice(1).map((span) => span.start)];
    const ends = [...starts.slice(1), source.length];
    if (starts.length !== ends.length || starts.some((start, index) => start < 0 || ends[index] <= start)) return fallback();
    return starts.map((start, index) => {
        const end = ends[index];
        const value = source.slice(start, end).join('');
        return {
            index,
            type: role === 'player' ? 'player' : 'unknown',
            speaker: role === 'player' ? '你' : '未识别',
            identityRef: { type: 'unknown' },
            text: value,
            sourceText: value,
            sourceSpan: { start, end },
            sourceMessageIndex,
            sourceMessageHash,
        };
    });
}

export function createStablePresentationBasePages({ text = '', role = 'character', fallbackSpeaker = '', sourceMessageIndex, sourceMessageHash = '', knownSpeakers = [] } = {}) {
    const sourceText = String(text ?? '');
    const segments = createSafePresentationDisplaySegments({ text: sourceText, role, fallbackSpeaker, sourceMessageIndex, sourceMessageHash, knownSpeakers });
    return createPresentationPages({ segments, sourceText, sourceMessageIndex, sourceMessageHash });
}

export function createPresentationPageWindow({ sourceText = '', pages = [], pageIndex, lookbehindPages = 1 } = {}) {
    const source = Array.from(String(sourceText ?? ''));
    if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length
        || !Number.isSafeInteger(lookbehindPages) || lookbehindPages < 0) return null;
    const corePage = pages[pageIndex];
    const coreSpan = corePage?.sourceSpan;
    const previousPage = lookbehindPages > 0 && pageIndex > 0 ? pages[pageIndex - 1] : null;
    const viewStart = previousPage?.sourceSpan?.start ?? coreSpan?.start;
    const viewEnd = coreSpan?.end;
    const previousGapIsWhitespace = !previousPage
        || Number.isSafeInteger(previousPage.sourceSpan?.end)
            && previousPage.sourceSpan.end <= coreSpan?.start
            && !source.slice(previousPage.sourceSpan.end, coreSpan.start).join('').trim();
    if (!Number.isSafeInteger(coreSpan?.start) || !Number.isSafeInteger(coreSpan?.end)
        || coreSpan.start < 0 || coreSpan.end <= coreSpan.start || coreSpan.end > source.length
        || !Number.isSafeInteger(viewStart) || viewStart < 0 || viewStart > coreSpan.start
        || !Number.isSafeInteger(viewEnd) || viewEnd < coreSpan.end || viewEnd > source.length
        || !previousGapIsWhitespace) return null;
    return {
        pageIndex,
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        viewSpan: { start: viewStart, end: viewEnd },
        coreText: source.slice(coreSpan.start, coreSpan.end).join(''),
        viewText: source.slice(viewStart, viewEnd).join(''),
    };
}

export function createPresentationCorePageSegment({ fullText = '', annotation, sourceMessageIndex, sourceMessageHash = '', viewSpan, coreSpan } = {}) {
    const source = Array.from(String(fullText ?? ''));
    if (!annotation || !Array.isArray(annotation.segments) || !Array.isArray(annotation.entities)
        || !Number.isSafeInteger(sourceMessageIndex) || !sourceMessageHash
        || !Number.isSafeInteger(viewSpan?.start) || !Number.isSafeInteger(viewSpan?.end)
        || !Number.isSafeInteger(coreSpan?.start) || !Number.isSafeInteger(coreSpan?.end)
        || viewSpan.start < 0 || viewSpan.end > source.length || viewSpan.end <= viewSpan.start
        || coreSpan.start < viewSpan.start || coreSpan.end > viewSpan.end || coreSpan.end <= coreSpan.start) return null;
    const localCore = { start: coreSpan.start - viewSpan.start, end: coreSpan.end - viewSpan.start };
    const covering = annotation.segments.filter((segment) => segment.start <= localCore.start && segment.end >= localCore.end);
    if (covering.length !== 1) return null;
    const selected = covering[0];
    const classificationEvidence = (selected.evidenceSpans || []).filter((span) => span.purpose === 'classification'
        && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= localCore.start && span.end <= localCore.end && span.end > span.start);
    if (!classificationEvidence.length) return null;
    const offset = viewSpan.start;
    const mapSpan = (span) => ({ ...span, start: span.start + offset, end: span.end + offset });
    const coreAnnotation = {
        sourceMessageIndex,
        sourceMessageHash,
        segments: [{
            ...selected,
            start: coreSpan.start,
            end: coreSpan.end,
            textHash: sourceMessageHash,
            evidenceSpans: (selected.evidenceSpans || []).map(mapSpan),
        }],
        entities: annotation.entities.map((entity) => ({
            ...entity,
            surfaceSpan: mapSpan(entity.surfaceSpan),
            attributeEvidence: (entity.attributeEvidence || []).map((attribute) => ({ ...attribute, span: mapSpan(attribute.span) })),
        })),
        identityLinkCandidates: [],
        stateClaims: [],
    };
    return createPresentationDisplaySegments({
        text: String(fullText ?? ''),
        annotation: coreAnnotation,
        projection: { complete: false, entities: [], segmentSpeakers: [] },
        sourceMessageIndex,
        sourceMessageHash,
    })[0] || null;
}

/**
 * Summarize validated Annotation v1 evidence intersecting the active page.
 * This returns title evidence only; page text, segment identity, and visuals
 * remain owned by the source-only base page and full-message projection.
 */
export function createPresentationPageTitleEvidence({ fullText = '', annotation, sourceMessageIndex, sourceMessageHash = '', viewSpan, coreSpan } = {}) {
    const source = Array.from(String(fullText ?? ''));
    if (!annotation || !Array.isArray(annotation.segments) || !Array.isArray(annotation.entities)
        || !Number.isSafeInteger(sourceMessageIndex) || !sourceMessageHash
        || !Number.isSafeInteger(viewSpan?.start) || !Number.isSafeInteger(viewSpan?.end)
        || !Number.isSafeInteger(coreSpan?.start) || !Number.isSafeInteger(coreSpan?.end)
        || viewSpan.start < 0 || viewSpan.end > source.length || viewSpan.end <= viewSpan.start
        || coreSpan.start < viewSpan.start || coreSpan.end > viewSpan.end || coreSpan.end <= coreSpan.start) return null;

    const localCore = { start: coreSpan.start - viewSpan.start, end: coreSpan.end - viewSpan.start };
    const intersecting = annotation.segments.filter((segment) => segment.start < localCore.end && segment.end > localCore.start);
    if (!intersecting.length) return null;
    const classificationEvidence = (segment) => (segment.evidenceSpans || []).filter((span) => span.purpose === 'classification'
        && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= localCore.start && span.end <= localCore.end && span.start >= segment.start
        && span.end <= segment.end && span.end > span.start);
    const classified = intersecting.map((segment) => ({ segment, evidence: classificationEvidence(segment) }));
    if (classified.some((item) => item.evidence.length === 0)) return null;
    const offset = viewSpan.start;
    const globalSpans = (spans) => spans.map((span) => ({ start: span.start + offset, end: span.end + offset }));
    const common = {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: viewSpan.start, end: viewSpan.end },
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        classificationEvidenceSpans: globalSpans(classified.flatMap((item) => item.evidence)),
    };

    const unattributed = classified.filter(({ segment }) => segment.kind === 'unattributed-dialogue');
    if (unattributed.length) {
        return {
            ...common,
            classificationEvidenceSpans: globalSpans(unattributed.flatMap((item) => item.evidence)),
            kind: 'classification',
            classification: 'unattributed-dialogue',
            text: '未识别',
            speakers: [],
        };
    }

    const dialogue = classified.filter(({ segment }) => segment.kind === 'dialogue');
    if (dialogue.length) {
        const speakers = [];
        for (const { segment } of dialogue) {
            if (typeof segment.speakerMentionRef !== 'string'
                || !['text-explicit', 'quoted-attribution'].includes(segment.speakerSource)) return null;
            const entity = annotation.entities.find((item) => item.mentionRef === segment.speakerMentionRef && item.kind === 'person');
            const span = entity?.surfaceSpan;
            const backed = (segment.evidenceSpans || []).some((item) => item.purpose === 'speaker'
                && Number.isSafeInteger(item.start) && Number.isSafeInteger(item.end)
                && item.start <= span?.start && item.end >= span?.end);
            const viewLength = viewSpan.end - viewSpan.start;
            if (!backed || !Number.isSafeInteger(span?.start) || !Number.isSafeInteger(span?.end)
                || span.start < 0 || span.end <= span.start || span.end > viewLength) return null;
            const text = source.slice(offset + span.start, offset + span.end).join('').trim();
            if (!text) return null;
            speakers.push({ mentionRef: segment.speakerMentionRef, resolverEntityRef: entity.resolverEntityRef || '',
                text, start: offset + span.start, end: offset + span.end });
        }
        const unique = [...new Map(speakers.map((speaker) => [speaker.resolverEntityRef
            ? `resolver:${speaker.resolverEntityRef}` : `surface:${speaker.text.normalize('NFC').toLocaleLowerCase()}`, speaker])).values()];
        const titleSpeakers = unique.map(({ resolverEntityRef, ...speaker }) => speaker);
        if (unique.length === 1) return { ...common, kind: 'speaker', text: unique[0].text, speakers: titleSpeakers };
        if (unique.length > 1) return { ...common, kind: 'group', text: '多人对话', speakers: titleSpeakers };
        return null;
    }

    const kinds = new Set(classified.map(({ segment }) => segment.kind));
    if (kinds.size !== 1) return null;
    const labels = { narration: '旁白', stage: '动作', 'stage-direction': '动作', status: '状态', choice: '选项', 'other-visible': '正文' };
    const kind = [...kinds][0];
    if (!Object.hasOwn(labels, kind)) return null;
    return { ...common, kind: 'classification', classification: kind, text: labels[kind], speakers: [] };
}

function hasResolvedPresentationIdentity(identityRef) {
    return ['published', 'chat-local'].includes(identityRef?.type)
        && typeof identityRef.id === 'string' && Boolean(identityRef.id.trim());
}

export function getPresentationSpeakerLabel(segment, message) {
    if (message?.role === 'player' || segment?.type === 'player') return '你';
    if (segment?.type === 'dialogue-group') return '多人对话';
    if (isCurrentPageTitleEvidence(segment) && segment.pageTitleEvidence?.ruleId === 'structural-heading-shape') return '标题';
    if (isCurrentPageTitleEvidence(segment)
        && segment.pageTitleEvidence?.ruleId === 'narrative-framed-quote') return '旁白';
    if (isCurrentPageTitleEvidence(segment)
        && segment.pageTitleEvidence?.ruleId === 'honorific-display-title') return segment.pageTitleEvidence.text;
    if (isCurrentPageTitleEvidence(segment)
        && ['unknown-self-introduction', 'anonymous-first-appearance'].includes(segment.pageTitleEvidence?.ruleId)
        && segment.pageTitleEvidence?.classification === 'unattributed-dialogue'
        && segment.pageTitleEvidence?.text === '？？？') return '？？？';
    if (isCurrentPageTitleEvidence(segment) && segment.pageTitleEvidence?.ruleId === 'structural-record-shape') {
        return segment.pageTitleEvidence.classification === 'choice' ? '选项' : '旁白';
    }
    if (isCurrentPageTitleEvidence(segment)
        && ['player-direct-speech', 'player-first-person-action'].includes(segment.pageTitleEvidence?.ruleId)) return '你';
    if (isCurrentPageTitleEvidence(segment) && segment.pageTitleEvidence?.ruleId === 'group-role-prefix') {
        return String(segment.pageTitleEvidence.text || '').trim() || '未识别';
    }
    const semantic = getCurrentSemanticPresentation(segment);
    if (semantic) {
        if (semantic.type === 'narration' && isCurrentPageTitleEvidence(segment)
            && ['speaker', 'group'].includes(segment.pageTitleEvidence?.kind)
            && isStructuralExactSpeakerTitleRule(segment.pageTitleEvidence?.ruleId)) {
            return String(segment.pageTitleEvidence.text || '').trim() || '未识别';
        }
        if (semantic.type === 'dialogue') {
            if (String(semantic.speaker || '').trim()) return String(semantic.speaker).trim();
            if (isCurrentPageTitleEvidence(segment) && ['speaker', 'group'].includes(segment.pageTitleEvidence?.kind)
                && segment.pageTitleEvidence.ruleId !== 'plain-prose-narration') return segment.pageTitleEvidence.text;
            return '未识别';
        }
        if (semantic.type === 'dialogue-group') return '多人对话';
        if (semantic.type === 'unattributed-dialogue') {
            // This remains semantic unknown. A complete, independently
            // validated structural projection may supply only the visible
            // title when it covers the page's detected speech ranges.
            const title = segment?.pageTitleEvidence;
            if (isCurrentPageTitleEvidence(segment)
                && ['speaker', 'group'].includes(title?.kind)
                && ['known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution',
                    'rostered-subject-quoted-clause',
                    'structured-speaker', 'full-message-structural', 'open-quote-continuation',
                    'pronoun-backreference',
                    'player-direct-speech', 'player-first-person-action', 'honorific-display-title',
                    'group-role-prefix', 'unrostered-action-attribution',
                    'probable-narrative-dialogue', 'probable-quote-span-continuation'].includes(title?.ruleId)) {
                return String(title.text || '').trim() || '未识别';
            }
            if (isCurrentPageTitleEvidence(segment) && title?.kind === 'classification'
                && ['unknown-self-introduction', 'anonymous-first-appearance'].includes(title.ruleId)
                && title.classification === 'unattributed-dialogue' && title.text === '？？？') return '？？？';
            return '未识别';
        }
        const semanticLabels = { narration: '旁白', stage: '动作', 'stage-direction': '动作', status: '状态', choice: '选项', 'other-visible': '正文' };
        if (Object.hasOwn(semanticLabels, semantic.type)) return semanticLabels[semantic.type];
    }
    if (segment?.type === 'unknown' && isCurrentPageSpeakerLabelEvidence(segment)) {
        return String(segment.pageSpeakerLabelEvidence.text || '').trim() || '未识别';
    }
    if (segment?.type === 'dialogue' && isCurrentSpeakerLabelEvidence(segment)) {
        return String(segment.speakerLabelEvidence.text || '').trim() || '未识别';
    }
    if (segment?.type === 'dialogue' && hasResolvedPresentationIdentity(segment.identityRef)) {
        return String(segment.speaker || '').trim() || '未识别';
    }
    if (isCurrentPageTitleEvidence(segment)) {
        return String(segment.pageTitleEvidence.text || '').trim() || '未识别';
    }
    const labels = { narration: '旁白', stage: '动作', 'stage-direction': '动作', status: '状态', choice: '选项', 'other-visible': '正文' };
    return Object.hasOwn(labels, segment?.type) ? labels[segment.type] : '未识别';
}

function isCurrentSpeakerLabelEvidence(segment) {
    const evidence = segment?.speakerLabelEvidence;
    return Boolean(evidence
        && typeof evidence.text === 'string'
        && evidence.text.trim()
        && evidence.sourceMessageIndex === segment.sourceMessageIndex
        && evidence.sourceMessageHash
        && evidence.sourceMessageHash === segment.sourceMessageHash
        && Number.isSafeInteger(evidence.start)
        && Number.isSafeInteger(evidence.end)
        && evidence.end > evidence.start
        && typeof evidence.mentionRef === 'string');
}

function isCurrentPageSpeakerLabelEvidence(segment) {
    const evidence = segment?.pageSpeakerLabelEvidence;
    const viewSpan = segment?.pageSpeakerLabelEvidenceViewSpan;
    return Boolean(segment?.identityRef?.type === 'unknown'
        && evidence
        && typeof evidence.text === 'string'
        && evidence.text.trim()
        && evidence.sourceMessageIndex === segment.sourceMessageIndex
        && evidence.sourceMessageHash
        && evidence.sourceMessageHash === segment.sourceMessageHash
        && typeof evidence.mentionRef === 'string'
        && evidence.mentionRef.trim()
        && Number.isSafeInteger(evidence.start)
        && Number.isSafeInteger(evidence.end)
        && Number.isSafeInteger(viewSpan?.start)
        && Number.isSafeInteger(viewSpan?.end)
        && evidence.start >= viewSpan.start
        && evidence.end <= viewSpan.end
        && evidence.end > evidence.start);
}

function isCurrentPageTitleEvidence(segment) {
    const evidence = segment?.pageTitleEvidence;
    const viewSpan = segment?.pageTitleEvidenceViewSpan;
    const coreSpan = segment?.sourceSpan;
    const mayUsePageTitleEvidence = segment?.identityRef?.type === 'unknown'
        || (!segment?.identityRef && segment?.type === 'narration')
        || (!segment?.identityRef && segment?.type === 'dialogue'
            && ['speaker', 'group'].includes(evidence?.kind));
    if (!mayUsePageTitleEvidence || !evidence
        || (evidence.ruleId != null && !PRESENTATION_PAGE_TITLE_RULES.has(evidence.ruleId)
            && !isStructuralFastTitleRule(evidence.ruleId))
        || evidence.sourceMessageIndex !== segment.sourceMessageIndex
        || !evidence.sourceMessageHash || evidence.sourceMessageHash !== segment.sourceMessageHash
        || !Number.isSafeInteger(viewSpan?.start) || !Number.isSafeInteger(viewSpan?.end)
        || !Number.isSafeInteger(coreSpan?.start) || !Number.isSafeInteger(coreSpan?.end)
        || evidence.viewSpan?.start !== viewSpan.start || evidence.viewSpan?.end !== viewSpan.end
        || evidence.coreSpan?.start !== coreSpan.start || evidence.coreSpan?.end !== coreSpan.end
        || viewSpan.start > coreSpan.start || viewSpan.end < coreSpan.end) return false;
    const inView = (span) => Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
        && span.start >= viewSpan.start && span.end <= viewSpan.end && span.end > span.start;
    if (!Array.isArray(evidence.classificationEvidenceSpans) || !evidence.classificationEvidenceSpans.length
        || !evidence.classificationEvidenceSpans.every((span) => inView(span)
            && span.start >= coreSpan.start && span.end <= coreSpan.end)) return false;
    if (evidence.kind === 'speaker') {
        const speaker = evidence.speakers?.[0];
        const probable = ['probable-narrative-dialogue', 'probable-quote-span-continuation'].includes(evidence.ruleId);
        const inheritedSpeaker = ['open-quote-continuation', 'probable-quote-span-continuation'].includes(evidence.ruleId)
            && Number.isSafeInteger(speaker?.start) && Number.isSafeInteger(speaker?.end)
            && speaker.start >= 0 && speaker.end > speaker.start && speaker.start < viewSpan.start
            && speaker.end <= viewSpan.start;
        const groupedRole = evidence.ruleId === 'group-role-prefix';
        const playerAlias = evidence.ruleId === 'player-first-person-action';
        const honorificAlias = evidence.ruleId === 'honorific-display-title';
        const exactAlias = playerAlias
            ? evidence.text === '你' && speaker?.text === '你' && speaker?.sourceText === '我'
                && /^\s*我(?:轻轻地|缓缓地|低声地|压低|放低|压住|放轻|轻声|低声|小声)?[^。！？!?;；\n]{0,42}(?:声音|嗓音|语气)(?:[^。！？!?;；\n]{0,18})?\s*[：:]\s*[“"「]/u.test(String(segment?.sourceText || ''))
                && /(?:压低|放低|压住|放轻|低声|轻声|小声)/u.test(String(segment?.sourceText || ''))
            : honorificAlias
                ? evidence.text === speaker?.text && speaker?.sourceText === `${speaker?.text}伯爵`
                    && String(segment?.sourceText || '').startsWith(speaker.sourceText)
                    && /^(?:[^。！？!?;；\n]{0,40})(?:摊开|展开|递给|递过|交给|递出)[^。！？!?;；\n]{0,40}[：:]\s*["“「]/u.test(
                        String(segment?.sourceText || '').slice(speaker.sourceText.length))
                : false;
        return evidence.speakers?.length === 1
            && (probable ? evidence.text === `${speaker?.text}（推测）`
                : groupedRole ? evidence.text === `${speaker?.text}（群体）` && speaker?.displayText === evidence.text
                    : playerAlias || honorificAlias ? exactAlias : evidence.text === speaker?.text)
            && (inView(speaker) || inheritedSpeaker)
            && typeof speaker.mentionRef === 'string' && speaker.mentionRef.trim();
    }
    if (evidence.kind === 'group') return evidence.text === '多人对话' && Array.isArray(evidence.speakers)
        && evidence.speakers.length >= 2 && evidence.speakers.every((speaker) => inView(speaker)
            && typeof speaker.mentionRef === 'string' && speaker.mentionRef.trim());
    if (evidence.kind === 'classification') {
        if (['unknown-self-introduction', 'anonymous-first-appearance'].includes(evidence.ruleId)) {
            return evidence.classification === 'unattributed-dialogue' && evidence.text === '？？？'
                && Array.isArray(evidence.speakers) && evidence.speakers.length === 0;
        }
        const labels = { narration: '旁白', 'unattributed-dialogue': '未识别', stage: '动作', 'stage-direction': '动作', status: '状态', choice: '选项', 'other-visible': '正文' };
        if (evidence.ruleId === 'structural-heading-shape') return evidence.classification === 'other-visible' && evidence.text === '标题';
        if (evidence.ruleId === 'narrative-framed-quote') {
            return evidence.classification === 'narration' && evidence.text === '旁白';
        }
        if (evidence.ruleId === 'structural-record-shape') {
            return (evidence.classification === 'narration' && evidence.text === '旁白')
                || (evidence.classification === 'choice' && evidence.text === '选项');
        }
        return labels[evidence.classification] === evidence.text;
    }
    return false;
}

export function getPresentationVisualSpeakerContext(segment, message) {
    if (message?.role === 'system') return { role: 'system', speaker: '系统' };
    if (message?.role === 'player' || segment?.type === 'player') return { role: 'player', speaker: '你' };
    if (segment?.type === 'dialogue-group' && segment.speakerCandidates?.length > 1
        && segment.speakerCandidates.every((candidate) => hasResolvedPresentationIdentity(candidate.identityRef) && candidate.speaker)) {
        return { role: 'group', speaker: '多人对话' };
    }
    const semantic = getCurrentSemanticPresentation(segment);
    if (isCurrentPageTitleEvidence(segment) && segment.pageTitleEvidence?.ruleId === 'narrative-framed-quote') {
        return { role: 'narrator', speaker: '旁白' };
    }
    if (isCurrentPageTitleEvidence(segment) && segment.pageTitleEvidence?.ruleId === 'structural-heading-shape') {
        return { role: 'unknown', speaker: '未识别' };
    }
    if (isCurrentPageTitleEvidence(segment)
        && ['unknown-self-introduction', 'anonymous-first-appearance'].includes(segment.pageTitleEvidence?.ruleId)) {
        return { role: 'unknown', speaker: '？？？' };
    }
    if (isCurrentPageTitleEvidence(segment)
        && ['player-direct-speech', 'player-first-person-action'].includes(segment.pageTitleEvidence?.ruleId)) {
        // A page-title sidecar over a source-derived narration page must not
        // promote that page into a player visual identity.
        if (semantic?.type === 'narration' || (!semantic && segment?.type === 'narration')) {
            return { role: 'narrator', speaker: '旁白' };
        }
        return { role: 'player', speaker: '你' };
    }
    if (semantic?.type === 'narration') return { role: 'narrator', speaker: '旁白' };
    if (semantic?.type === 'unattributed-dialogue') return { role: 'unknown', speaker: '未识别' };
    if (semantic?.type === 'dialogue' && hasResolvedPresentationIdentity(semantic.identityRef) && String(semantic.speaker || '').trim()) {
        return { role: 'character', speaker: semantic.speaker };
    }
    if (isCurrentPageTitleEvidence(segment)
        && ['structural-record-shape', 'structural-heading-shape', 'unattributed-quoted-speech',
            'probable-quote-span-continuation'].includes(segment.pageTitleEvidence?.ruleId)) {
        return { role: 'unknown', speaker: '未识别' };
    }
    if (segment?.type === 'narration') return { role: 'narrator', speaker: '旁白' };
    if (segment?.type === 'dialogue' && hasResolvedPresentationIdentity(segment.identityRef) && String(segment.speaker || '').trim()) {
        return { role: 'character', speaker: segment.speaker };
    }
    return { role: 'unknown', speaker: '未识别' };
}

function getCurrentSemanticPresentation(segment) {
    const semantic = segment?.semanticPresentation;
    const bodySpan = segment?.sourceSpan;
    const semanticSpan = semantic?.sourceSpan;
    const bodyText = String(segment?.sourceText ?? segment?.text ?? '');
    return semantic
        && Number.isSafeInteger(semantic.sourceMessageIndex)
        && semantic.sourceMessageIndex === segment.sourceMessageIndex
        && typeof semantic.sourceMessageHash === 'string' && Boolean(semantic.sourceMessageHash)
        && Number.isSafeInteger(bodySpan?.start) && Number.isSafeInteger(bodySpan?.end)
        && bodySpan.start === semanticSpan?.start && bodySpan.end === semanticSpan?.end
        && semantic.sourceText === bodyText
        ? semantic
        : null;
}

export function createPresentationDisplaySegments({ text, annotation, projection, sourceMessageIndex, sourceMessageHash = '' } = {}) {
    const visibleText = String(text || '');
    if (!annotation || !Array.isArray(annotation.segments)) {
        return createSafePresentationDisplaySegments({ text: visibleText, sourceMessageIndex, sourceMessageHash });
    }
    const canUseIdentityProjection = projection?.complete === true;
    const speakers = new Map((canUseIdentityProjection ? projection?.segmentSpeakers || [] : [])
        .filter((item) => item.sourceMessageIndex === sourceMessageIndex)
        .map((item) => [item.segmentIndex, item.resolvedSpeakerRef]));
    const characters = Array.from(visibleText);
    const segments = annotation.segments.map((segment, index) => {
        const identityRef = segment.kind === 'dialogue' ? speakers.get(index) || { type: 'unknown' }
            : segment.kind === 'unattributed-dialogue' ? { type: 'unknown' } : null;
        const speakerLabelEvidence = segment.kind === 'dialogue'
            ? createSpeakerLabelEvidence(segment, annotation, characters, sourceMessageIndex, sourceMessageHash)
            : null;
        return {
            index,
            type: segment.kind,
            speaker: segment.kind === 'narration'
                ? '旁白'
                : segment.kind === 'unattributed-dialogue'
                    ? '未识别'
                    : segment.kind !== 'dialogue'
                        ? ''
                        : findProjectedName(canUseIdentityProjection ? projection : null, identityRef) || speakerLabelEvidence?.text || '未识别',
            identityRef,
            ...(speakerLabelEvidence ? { speakerLabelEvidence } : {}),
            text: characters.slice(segment.start, segment.end).join(''),
            sourceText: characters.slice(segment.start, segment.end).join(''),
            sourceSpan: { start: segment.start, end: segment.end },
            sourceMessageIndex,
            sourceMessageHash,
        };
    });
    return applyAnnotationDialogueSpeakerContinuity(segments);
}

function createSpeakerLabelEvidence(segment, annotation, characters, sourceMessageIndex, sourceMessageHash) {
    if (!sourceMessageHash || !Number.isSafeInteger(sourceMessageIndex)
        || typeof segment?.speakerMentionRef !== 'string'
        || !['text-explicit', 'quoted-attribution'].includes(segment.speakerSource)) return null;
    const entity = (annotation.entities || []).find((item) => item.mentionRef === segment.speakerMentionRef && item.kind === 'person');
    const span = entity?.surfaceSpan;
    if (!Number.isSafeInteger(span?.start) || !Number.isSafeInteger(span?.end)
        || span.start < 0 || span.end <= span.start || span.end > characters.length) return null;
    const coveredByEvidence = (segment.evidenceSpans || []).some((evidence) => evidence.purpose === 'speaker'
        && Number.isSafeInteger(evidence.start) && Number.isSafeInteger(evidence.end)
        && evidence.start <= span.start && evidence.end >= span.end);
    if (!coveredByEvidence) return null;
    const text = characters.slice(span.start, span.end).join('').trim();
    if (!text) return null;
    return { mentionRef: segment.speakerMentionRef, start: span.start, end: span.end, text, sourceMessageIndex, sourceMessageHash };
}

export function createPresentationPages({ segments = [], sourceText = '', sourceMessageIndex, sourceMessageHash = '', maxIdentities = 3, softMaxCodePoints = 900 } = {}) {
    const source = Array.from(String(sourceText || ''));
    const pages = [];
    let group = [];
    let previousEnd = null;
    let groupIdentities = new Set();
    let groupStart = null;
    let groupEnd = null;

    const flush = () => {
        if (!group.length) return;
        const distinct = new Set(group.map((segment) => identityKey(segment.identityRef)).filter(Boolean));
        const spanLength = groupStart === null || groupEnd === null ? Infinity : groupEnd - groupStart;
        if (group.length > 1 && distinct.size > 1 && spanLength <= softMaxCodePoints) {
            const speakerCandidates = [];
            const seen = new Set();
            for (const segment of group) {
                const key = identityKey(segment.identityRef);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                speakerCandidates.push({
                    speaker: segment.speaker,
                    identityRef: segment.identityRef,
                    sourceSpan: segment.sourceSpan,
                    sourceText: source.slice(segment.sourceSpan.start, segment.sourceSpan.end).join(''),
                    sourceMessageIndex: segment.sourceMessageIndex ?? sourceMessageIndex,
                    sourceMessageHash: segment.sourceMessageHash || sourceMessageHash,
                });
            }
            pages.push({
                index: pages.length,
                type: 'dialogue-group',
                speaker: '多人对话',
                identityRef: null,
                text: source.slice(groupStart, groupEnd).join(''),
                sourceSpan: { start: groupStart, end: groupEnd },
                sourceMessageIndex,
                sourceMessageHash,
                segments: [...group],
                speakerCandidates,
            });
        } else {
            pages.push(...group.map((segment) => ({ ...segment, index: pages.length + group.indexOf(segment) })));
        }
        group = [];
        previousEnd = null;
        groupIdentities = new Set();
        groupStart = null;
        groupEnd = null;
    };

    for (const segment of Array.isArray(segments) ? segments : []) {
        const identity = identityKey(segment?.identityRef);
        const span = segment?.sourceSpan;
        const validSpan = Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
            && span.start >= 0 && span.end > span.start && span.end <= source.length
            && (!segment.sourceText || source.slice(span.start, span.end).join('') === segment.sourceText)
            && segment.sourceMessageIndex === sourceMessageIndex
            && (!sourceMessageHash || segment.sourceMessageHash === sourceMessageHash);
        const canGroup = segment?.type === 'dialogue' && identity && !segment.speakerContinuation && validSpan;
        if (!canGroup) {
            flush();
            pages.push({ ...segment, index: pages.length });
            continue;
        }

        const gap = previousEnd === null ? '' : source.slice(previousEnd, span.start).join('');
        const nextIdentities = new Set(groupIdentities);
        nextIdentities.add(identity);
        const nextLength = groupStart === null ? span.end - span.start : span.end - groupStart;
        const hasGap = /\S/u.test(gap);
        const scopeMismatch = group.some((prior) => prior.sourceMessageIndex !== segment.sourceMessageIndex
            || prior.sourceMessageHash !== segment.sourceMessageHash);
        if (hasGap || span.start < (previousEnd ?? span.start) || scopeMismatch
            || nextIdentities.size > maxIdentities || (group.length && nextLength > softMaxCodePoints)) {
            flush();
        }
        if (span.end - span.start > softMaxCodePoints) {
            flush();
            pages.push({ ...segment, index: pages.length });
            continue;
        }
        if (groupStart === null) groupStart = span.start;
        group.push(segment);
        groupIdentities.add(identity);
        groupEnd = span.end;
        previousEnd = span.end;
    }
    flush();
    return pages.map((page, index) => ({ ...page, index }));
}

export function createPresentationRosterDisplay({ projection, roster } = {}) {
    if (projection?.complete !== true || roster?.complete !== true || !Array.isArray(roster.entries)) return null;
    const conflicted = new Set((roster.conflicts || []).map((item) => identityKey(item.identityRef)).filter(Boolean));
    return roster.entries
        .filter((entry) => entry.membership === 'member' || conflicted.has(identityKey(entry.identityRef)))
        .map((entry) => ({
            identityRef: entry.identityRef,
            name: findProjectedName(projection, entry.identityRef) || '未命名角色',
            membership: conflicted.has(identityKey(entry.identityRef)) ? 'unknown' : entry.membership,
        }));
}

export function formatPresentationRosterMember(member) {
    const name = String(member?.name || '未命名角色');
    return member?.membership === 'unknown' ? `${name}（状态待确认）` : name;
}

export function createIdentityVisualAttributes(projection, identityRef) {
    if (!identityRef?.type || identityRef.type === 'unknown' || !identityRef.id) return [];
    const entity = projection?.entities?.find((item) => item.identityRef?.type === identityRef.type && item.identityRef?.id === identityRef.id);
    const codes = {
        gender: 'character-explicit-gender-presentation',
        species: 'character-explicit-species',
        appearance: 'character-explicit-appearance',
    };
    return Object.entries(codes).flatMap(([category, code]) => {
        const latest = [...(entity?.attributes || [])]
            .filter((item) => item.category === category && item.value)
            .sort((left, right) => right.sourceMessageIndex - left.sourceMessageIndex)[0];
        return latest ? [{ code, value: latest.value, confidenceBand: 'probable' }] : [];
    });
}

export function createSpeakerVisualAttributes({ visibleAttributes = [], projection, identityRef } = {}) {
    const anchored = (Array.isArray(visibleAttributes) ? visibleAttributes : [])
        .filter((item) => item?.code === 'character-explicit-name' || item?.code === 'character-visual-binding');
    const seenCodes = new Set(anchored.map((item) => item.code));
    return [
        ...anchored,
        ...createIdentityVisualAttributes(projection, identityRef).filter((item) => !seenCodes.has(item.code)),
    ];
}

export function isPresentationProjectionTimelineCurrent(snapshot, state) {
    const current = (snapshot?.messages || [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message?.role === 'character' && String(message.displayText || message.text || '').trim())
        .map(({ message, index }) => ({
            sourceMessageIndex: Number.isSafeInteger(message.index) ? message.index : index,
            visibleText: String(message.displayText || message.text || ''),
            authorLabel: String(message.speaker || ''),
        }));
    const rows = state?.messages || [];
    return state?.projection?.complete === true
        && state.projection.chatKey === String(snapshot?.fileName || '')
        && rows.length === current.length
        && rows.every((row, index) => row.sourceMessageIndex === current[index].sourceMessageIndex
            && row.visibleText === current[index].visibleText
            && row.authorLabel === current[index].authorLabel
            && row.annotation?.sourceMessageHash === row.sourceMessageHash);
}

/** Exact current chat snapshot check independent of annotation/projection completeness. */
export function isPresentationTimelineSnapshotCurrent(snapshot, state) {
    return String(snapshot?.fileName || '') === String(state?.chatKey || '')
        && matchesPresentationTimelineSnapshot(snapshot, state?.timelineSnapshot);
}

export function createPresentationTimelineSnapshot(snapshot) {
    return (snapshot?.messages || []).map((message, arrayIndex) => ({
        arrayIndex,
        sourceMessageIndex: Number.isSafeInteger(message?.index) ? message.index : arrayIndex,
        role: String(message?.role || ''),
        authorLabel: String(message?.speaker || ''),
        visibleText: String(message?.displayText || message?.text || ''),
    }));
}

export function matchesPresentationTimelineSnapshot(snapshot, captured) {
    const current = createPresentationTimelineSnapshot(snapshot);
    return Array.isArray(captured) && captured.length === current.length
        && captured.every((row, index) => row.arrayIndex === current[index].arrayIndex
            && row.sourceMessageIndex === current[index].sourceMessageIndex
            && row.role === current[index].role
            && row.authorLabel === current[index].authorLabel
            && row.visibleText === current[index].visibleText);
}

function identityKey(identityRef) {
    return identityRef?.type && identityRef?.type !== 'unknown' && identityRef?.id
        ? `${identityRef.type}:${identityRef.id}`
        : '';
}

function findProjectedName(projection, identityRef) {
    if (!identityRef || identityRef.type === 'unknown') return '';
    const identity = projection?.entities?.find((item) => item.identityRef?.type === identityRef.type && item.identityRef?.id === identityRef.id);
    return identity?.aliases?.[0]?.value || '未识别';
}
