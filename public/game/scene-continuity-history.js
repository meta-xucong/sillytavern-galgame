import { isSceneContinuityCursorStrictlyEarlier } from './presentation-renderer.js?v=auto-b19af4e9a9f8';

export const SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT = 128;
export const SCENE_CONTINUITY_HISTORY_REPLAY_MIN_INTERVAL_MS = 2_100;
export const SCENE_CONTINUITY_HISTORY_REPLAY_BATCH_LIMIT = 12;
export const SCENE_CONTINUITY_HISTORY_CHECKPOINT_SCHEMA_VERSION = 'galgame.scene-continuity-history-checkpoint.v1';
export const SCENE_CONTINUITY_HISTORY_CHECKPOINT_STORAGE_PREFIX = 'galgame.scene-continuity-history-checkpoint.v1.';

/** Attach the ordering cursor required by the replay selector to a candidate. */
export function createSceneContinuityHistoryCandidate(page, scopeKey) {
    if (!page || typeof scopeKey !== 'string' || !scopeKey
        || !Number.isSafeInteger(page.messageIndex) || page.messageIndex < 0
        || !Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0) return null;
    return {
        ...page,
        cursor: {
            scopeKey,
            messageIndex: page.messageIndex,
            pageIndex: page.pageIndex,
        },
    };
}

/**
 * Find the latest validated scene transition before the visible cursor.
 * Pages are examined newest-first so cold restoration stops at the nearest
 * exact, analyzer-validated transition instead of replaying an entire chat.
 * The caller owns canonical chat/hash/scope validation; this helper only
 * sequences candidate pages and never interprets their text.
 */
export async function findLatestVerifiedSceneTransitionAnchor(pages = [], {
    currentCursor,
    analyzePage,
    signal,
    limit = SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT,
    skipNewest = 0,
    batchLimit = SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT,
    minIntervalMs = 0,
    onCandidateError,
    onCandidateSettled,
} = {}) {
    if (!currentCursor || typeof analyzePage !== 'function' || signal?.aborted) return null;
    const safeLimit = Number.isSafeInteger(limit) && limit > 0
        ? Math.min(limit, SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT)
        : SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT;
    const candidates = (Array.isArray(pages) ? pages : [])
        .map((page, sourceIndex) => ({ page, sourceIndex }))
        .filter(({ page }) => page?.sourceRole === 'character'
            && String(page.pageText || '').trim()
            && isSceneContinuityCursorStrictlyEarlier(page.cursor, currentCursor))
        .slice(-safeLimit);
    const safeSkipNewest = Number.isSafeInteger(skipNewest) && skipNewest > 0
        ? Math.min(skipNewest, candidates.length)
        : 0;
    const safeBatchLimit = Number.isSafeInteger(batchLimit) && batchLimit > 0
        ? Math.min(batchLimit, safeLimit)
        : safeLimit;
    const scanCount = Math.min(safeBatchLimit, candidates.length - safeSkipNewest);

    let nextRequestAt = 0;
    for (let step = 0; step < scanCount; step += 1) {
        if (signal?.aborted) return null;
        const candidateIndex = candidates.length - 1 - safeSkipNewest - step;
        const { page, sourceIndex } = candidates[candidateIndex];
        const contextPages = (Array.isArray(pages) ? pages : [])
            .slice(0, sourceIndex)
            .filter((earlier) => earlier?.sourceRole === 'character' && String(earlier.pageText || '').trim())
            .slice(-2)
            .map((earlier) => ({ pageText: Array.from(String(earlier.pageText)).slice(-1_200).join('') }));
        const safeInterval = Number.isSafeInteger(minIntervalMs) && minIntervalMs > 0
            ? Math.min(minIntervalMs, 60_000)
            : 0;
        const waitMs = Math.max(0, nextRequestAt - Date.now());
        if (safeInterval && waitMs) {
            await new Promise((resolve) => {
                let timer;
                const finish = () => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', finish);
                    resolve();
                };
                timer = setTimeout(finish, waitMs);
                signal?.addEventListener('abort', finish, { once: true });
            });
            if (signal?.aborted) return null;
        }
        if (safeInterval) nextRequestAt = Date.now() + safeInterval;
        let result;
        try {
            result = await analyzePage(page, { contextPages, signal });
        } catch (error) {
            if (signal?.aborted) return null;
            try {
                onCandidateError?.(page, error);
            } catch {
                // Diagnostics are best-effort and must not stop older-page recovery.
            }
            await notifyCandidateSettled(onCandidateSettled, {
                page,
                status: 'failed',
                errorCode: safeDiagnosticCode(error?.code || error?.name),
                processedCandidates: safeSkipNewest + step + 1,
            });
            continue;
        }
        if (signal?.aborted) return null;
        await notifyCandidateSettled(onCandidateSettled, {
            page,
            status: 'resolved',
            errorCode: '',
            processedCandidates: safeSkipNewest + step + 1,
        });
        if (result?.timelineValidated === true
            && result.state === 'changed'
            && typeof result.sceneKey === 'string'
            && result.sceneKey) {
            return { page, result };
        }
    }
    return null;
}

export async function createSceneContinuityHistoryCheckpointKey(scopeKey, hashText) {
    if (typeof scopeKey !== 'string' || !scopeKey || typeof hashText !== 'function') return '';
    const digest = String(await hashText(scopeKey)).replace(/^sha256:/u, '');
    return /^[a-f0-9]{64}$/u.test(digest)
        ? `${SCENE_CONTINUITY_HISTORY_CHECKPOINT_STORAGE_PREFIX}${digest}`
        : '';
}

export async function createSceneContinuityHistoryCandidateListHash(pages = [], hashText) {
    if (!Array.isArray(pages) || typeof hashText !== 'function') return '';
    try {
        const rows = [];
        for (const page of pages.slice(-SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT)) {
            if (!page || page.sourceRole !== 'character' || !page.cursor
                || !Number.isSafeInteger(page.cursor.messageIndex) || !Number.isSafeInteger(page.cursor.pageIndex)) return '';
            rows.push({
                messageIndex: page.cursor.messageIndex,
                pageIndex: page.cursor.pageIndex,
                messageId: String(page.message?.index ?? page.cursor.messageIndex),
                sourceMessageHash: String(page.sourceMessageHash || await hashText(
                    String(page.message?.displayText || page.message?.text || ''),
                )),
                pageTextHash: await hashText(String(page.pageText || '')),
                sourceSpan: {
                    start: Number.isSafeInteger(page.sourceSpan?.start) ? page.sourceSpan.start : 0,
                    end: Number.isSafeInteger(page.sourceSpan?.end) ? page.sourceSpan.end : 0,
                },
            });
        }
        const digest = String(await hashText(JSON.stringify(rows))).replace(/^sha256:/u, '');
        return /^[a-f0-9]{64}$/u.test(digest) ? `sha256:${digest}` : '';
    } catch {
        return '';
    }
}

export async function createSceneContinuityHistoryTargetCursorHash(cursor, hashText) {
    if (!cursor || typeof cursor.scopeKey !== 'string' || !cursor.scopeKey
        || typeof hashText !== 'function'
        || !Number.isSafeInteger(cursor.messageIndex) || cursor.messageIndex < 0
        || !Number.isSafeInteger(cursor.pageIndex) || cursor.pageIndex < 0) return '';
    const digest = String(await hashText(JSON.stringify([
        cursor.messageIndex,
        cursor.pageIndex,
        String(cursor.messageId || ''),
        String(cursor.sourceMessageHash || ''),
        String(cursor.pageTextHash || ''),
        String(cursor.timelinePrefixHash || ''),
        cursor.sourceSpan?.start,
        cursor.sourceSpan?.end,
    ]))).replace(/^sha256:/u, '');
    return /^[a-f0-9]{64}$/u.test(digest) ? `sha256:${digest}` : '';
}

export function createSceneContinuityHistoryCheckpoint({
    scopeHash = '', targetCursorHash = '', candidateListHash = '', analyzerScope = '',
    candidateCount = 0, processedCandidates = 0, failedCandidateOffsets = [],
} = {}) {
    const checkpoint = {
        schemaVersion: SCENE_CONTINUITY_HISTORY_CHECKPOINT_SCHEMA_VERSION,
        scopeHash: String(scopeHash),
        targetCursorHash: String(targetCursorHash),
        candidateListHash: String(candidateListHash),
        analyzerScope: String(analyzerScope),
        candidateCount,
        processedCandidates,
        failedCandidateOffsets: Array.isArray(failedCandidateOffsets)
            ? [...new Set(failedCandidateOffsets)].sort((left, right) => left - right)
            : [],
    };
    return validateSceneContinuityHistoryCheckpoint(checkpoint) ? checkpoint : null;
}

export function serializeSceneContinuityHistoryCheckpoint(checkpoint) {
    if (!validateSceneContinuityHistoryCheckpoint(checkpoint)) return '';
    return JSON.stringify(checkpoint);
}

export function parseSceneContinuityHistoryCheckpoint(serialized, expected = {}) {
    if (typeof serialized !== 'string' || !serialized) return null;
    try {
        const checkpoint = JSON.parse(serialized);
        if (!validateSceneContinuityHistoryCheckpoint(checkpoint)) return null;
        for (const key of ['scopeHash', 'targetCursorHash', 'candidateListHash', 'analyzerScope', 'candidateCount']) {
            if (expected[key] !== undefined && checkpoint[key] !== expected[key]) return null;
        }
        return checkpoint;
    } catch {
        return null;
    }
}

export function getSceneContinuityHistoryCheckpointResumeOffset(checkpoint, candidateCount) {
    if (!validateSceneContinuityHistoryCheckpoint(checkpoint)
        || !Number.isSafeInteger(candidateCount) || candidateCount < 0
        || checkpoint.candidateCount !== candidateCount) return 0;
    return checkpoint.failedCandidateOffsets.length
        ? Math.min(...checkpoint.failedCandidateOffsets)
        : checkpoint.processedCandidates;
}

function validateSceneContinuityHistoryCheckpoint(checkpoint) {
    const keys = [
        'schemaVersion', 'scopeHash', 'targetCursorHash', 'candidateListHash', 'analyzerScope',
        'candidateCount', 'processedCandidates', 'failedCandidateOffsets',
    ];
    return Boolean(checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint)
        && Object.keys(checkpoint).sort().join(',') === [...keys].sort().join(',')
        && checkpoint.schemaVersion === SCENE_CONTINUITY_HISTORY_CHECKPOINT_SCHEMA_VERSION
        && /^sha256:[a-f0-9]{64}$/u.test(checkpoint.scopeHash)
        && /^sha256:[a-f0-9]{64}$/u.test(checkpoint.targetCursorHash)
        && /^sha256:[a-f0-9]{64}$/u.test(checkpoint.candidateListHash)
        && typeof checkpoint.analyzerScope === 'string' && checkpoint.analyzerScope.length > 0
        && checkpoint.analyzerScope.length <= 240
        && Number.isSafeInteger(checkpoint.candidateCount)
        && checkpoint.candidateCount >= 0
        && checkpoint.candidateCount <= SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT
        && Number.isSafeInteger(checkpoint.processedCandidates)
        && checkpoint.processedCandidates >= 0 && checkpoint.processedCandidates <= checkpoint.candidateCount
        && Array.isArray(checkpoint.failedCandidateOffsets)
        && checkpoint.failedCandidateOffsets.length <= checkpoint.processedCandidates
        && checkpoint.failedCandidateOffsets.every((offset, index, offsets) => (
            Number.isSafeInteger(offset) && offset >= 0 && offset < checkpoint.processedCandidates
            && (index === 0 || offset > offsets[index - 1])
        )));
}

async function notifyCandidateSettled(callback, result) {
    if (typeof callback !== 'function') return;
    try {
        await callback(result);
    } catch {
        // Optional checkpoint writes and diagnostics must not stop scene recovery.
    }
}

function safeDiagnosticCode(value) {
    return String(value || 'analysis-failed').replace(/[^a-z0-9_-]/giu, '').slice(0, 64) || 'analysis-failed';
}
