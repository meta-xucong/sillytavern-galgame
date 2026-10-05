import { applyQuotedDialogueSpeakerContinuity } from './shared/sillytavern-adapter.js?v=auto-b19af4e9a9f8';
import { deriveSceneContinuityKey } from './shared/scene-continuity-analysis.js?v=auto-b19af4e9a9f8';

export const PRESENTATION_ANNOTATION_MODE = 'shadow';
export const PRESENTATION_GATE_REPORTS = Object.freeze({});
export const SCENE_CONTINUITY_LEDGER_SCHEMA_VERSION = 'galgame.scene-continuity-ledger.v2';
export const SCENE_CONTINUITY_LEDGER_STORAGE_PREFIX = 'galgame.scene-continuity-ledger.v2.';

const SCENE_LEDGER_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

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
    const assistantMessages = (Array.isArray(messages) ? messages : [])
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message?.role === 'character' && String(message.displayText || message.text || '').trim());
    return assistantMessages;
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
    return Object.hasOwn(PRESENTATION_GATE_REPORTS, String(language)) ? 'assisted' : 'shadow';
}

export function createPresentationDisplaySegments({ text, annotation, projection, sourceMessageIndex, sourceMessageHash = '' } = {}) {
    const visibleText = String(text || '');
    if (!annotation || !Array.isArray(annotation.segments)) {
        return [{ index: 0, type: 'unknown', speaker: '未识别', identityRef: { type: 'unknown' }, text: visibleText }];
    }
    const speakers = new Map((projection?.segmentSpeakers || [])
        .filter((item) => item.sourceMessageIndex === sourceMessageIndex)
        .map((item) => [item.segmentIndex, item.resolvedSpeakerRef]));
    const segments = annotation.segments.map((segment, index) => ({
        index,
        type: segment.kind,
        speaker: segment.kind === 'narration'
            ? '旁白'
            : segment.kind === 'unattributed-dialogue'
                ? '未识别'
                : segment.kind !== 'dialogue'
                    ? ''
                    : findProjectedName(projection, speakers.get(index)) || '未识别',
        identityRef: segment.kind === 'dialogue'
            ? speakers.get(index) || { type: 'unknown' }
            : segment.kind === 'unattributed-dialogue'
                ? { type: 'unknown' }
                : null,
        text: Array.from(visibleText).slice(segment.start, segment.end).join(''),
        sourceText: Array.from(visibleText).slice(segment.start, segment.end).join(''),
        sourceSpan: { start: segment.start, end: segment.end },
        sourceMessageIndex,
        sourceMessageHash,
    }));
    return applyQuotedDialogueSpeakerContinuity(segments);
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
