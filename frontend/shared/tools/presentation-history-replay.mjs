import { randomUUID, createHash } from 'node:crypto';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PresentationAnalysisAdapter } from '../src/presentation-analysis-adapter.js';
import { codePointSlice, createPublishedPresentationKnownEntities, createVisibleMessageHash } from '../src/presentation-annotation.js';
import { projectPresentationIdentityDetailed } from '../src/presentation-projection.js';
import { formatVisualNovelDisplayText } from '../src/sillytavern-adapter.js';

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const CHAT_ROOT = resolve(REPOSITORY_ROOT, 'data', 'default-user', 'chats');
const PLAYER_ORIGIN = 'http://127.0.0.1:8001';
const DEFAULT_CONFIG_URL = 'http://127.0.0.1:8791';
const DEFAULT_ANALYSIS_URL = 'http://127.0.0.1:8798';
const MAX_REPLAY_MESSAGES = 12;
const GOLD_SCHEMA_VERSION = 'galgame.presentation-history-gold.v1';

export class HistoryReplayError extends Error {
    constructor(code) {
        super(code);
        this.name = 'HistoryReplayError';
        this.code = code;
    }
}

/** Resolve an explicit chat file and reject every symlinked path component. */
export async function resolveContainedHistoryChatPath(chatsRoot, candidatePath, fs = { lstat, realpath }) {
    if (typeof candidatePath !== 'string' || !isAbsolute(candidatePath)) throw new HistoryReplayError('CHAT_PATH_MUST_BE_ABSOLUTE');
    const lexicalRoot = resolve(chatsRoot);
    const lexicalTarget = resolve(candidatePath);
    const relativeTarget = relative(lexicalRoot, lexicalTarget);
    if (!isPathInside(lexicalRoot, lexicalTarget) || !relativeTarget) throw new HistoryReplayError('CHAT_PATH_OUTSIDE_ROOT');

    await assertNoSymlinkComponents(lexicalRoot, fs, 'CHAT_ROOT_UNAVAILABLE', 'CHAT_PATH_SYMLINK');
    let rootStat;
    try {
        rootStat = await fs.lstat(lexicalRoot);
    } catch {
        throw new HistoryReplayError('CHAT_ROOT_UNAVAILABLE');
    }
    if (!rootStat.isDirectory()) throw new HistoryReplayError('CHAT_ROOT_UNAVAILABLE');

    let canonicalRoot;
    try {
        canonicalRoot = await fs.realpath(lexicalRoot);
    } catch {
        throw new HistoryReplayError('CHAT_ROOT_UNAVAILABLE');
    }
    let currentPath = lexicalRoot;
    for (const part of relativeTarget.split(sep)) {
        if (!part || part === '.' || part === '..') throw new HistoryReplayError('CHAT_PATH_OUTSIDE_ROOT');
        currentPath = join(currentPath, part);
        let partStat;
        try {
            partStat = await fs.lstat(currentPath);
        } catch {
            throw new HistoryReplayError('CHAT_FILE_UNAVAILABLE');
        }
        if (partStat.isSymbolicLink()) throw new HistoryReplayError('CHAT_PATH_SYMLINK');
    }

    let canonicalTarget;
    let targetStat;
    try {
        canonicalTarget = await fs.realpath(lexicalTarget);
        targetStat = await fs.lstat(canonicalTarget);
    } catch {
        throw new HistoryReplayError('CHAT_FILE_UNAVAILABLE');
    }
    if (!isPathInside(canonicalRoot, canonicalTarget) || !targetStat.isFile()) throw new HistoryReplayError('CHAT_PATH_OUTSIDE_ROOT');
    if (extname(canonicalTarget).toLowerCase() !== '.jsonl') throw new HistoryReplayError('CHAT_FORMAT_UNSUPPORTED');
    return canonicalTarget;
}

async function assertNoSymlinkComponents(candidatePath, fs, missingCode, symlinkCode) {
    const absolutePath = resolve(candidatePath);
    const pathRoot = parse(absolutePath).root;
    let currentPath = pathRoot;
    const components = relative(pathRoot, absolutePath).split(sep).filter(Boolean);
    for (const component of [null, ...components]) {
        if (component !== null) currentPath = join(currentPath, component);
        let stat;
        try {
            stat = await fs.lstat(currentPath);
        } catch {
            throw new HistoryReplayError(missingCode);
        }
        if (stat.isSymbolicLink()) throw new HistoryReplayError(symlinkCode);
    }
}

function sameFileObject(left, right) {
    return Boolean(left && right && left.isFile() && right.isFile()
        && left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs);
}

function sameFileVersion(left, right) {
    return sameFileObject(left, right)
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Parse SillyTavern JSONL without retaining player/system message bodies. */
export async function readHistoryChat(candidatePath, {
    chatsRoot = CHAT_ROOT,
    openFileImpl = open,
    lstatImpl = lstat,
    realpathImpl = realpath,
    resolvePathImpl = resolveContainedHistoryChatPath,
} = {}) {
    const canonicalPath = await resolvePathImpl(chatsRoot, candidatePath);
    let raw;
    let fileHandle;
    try {
        const beforeOpen = await lstatImpl(canonicalPath);
        if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile()) throw new HistoryReplayError('CHAT_PATH_SYMLINK');
        fileHandle = await openFileImpl(canonicalPath, 'r');
        const opened = await fileHandle.stat();
        if (!sameFileVersion(beforeOpen, opened)) throw new HistoryReplayError('CHAT_FILE_CHANGED_DURING_OPEN');
        const openedRealPath = await realpathImpl(canonicalPath);
        const openedPathStat = await lstatImpl(canonicalPath);
        if (openedRealPath !== canonicalPath || openedPathStat.isSymbolicLink() || !sameFileObject(opened, openedPathStat)) {
            throw new HistoryReplayError('CHAT_FILE_CHANGED_DURING_OPEN');
        }
        raw = await fileHandle.readFile({ encoding: 'utf8' });
        const afterRead = await fileHandle.stat();
        const finalRealPath = await realpathImpl(canonicalPath);
        const finalPathStat = await lstatImpl(canonicalPath);
        if (!sameFileVersion(opened, afterRead) || finalRealPath !== canonicalPath
            || finalPathStat.isSymbolicLink() || !sameFileObject(afterRead, finalPathStat)) {
            throw new HistoryReplayError('CHAT_FILE_CHANGED_DURING_READ');
        }
    } catch (error) {
        if (error instanceof HistoryReplayError) throw error;
        throw new HistoryReplayError('CHAT_FILE_UNAVAILABLE');
    } finally {
        await fileHandle?.close().catch(() => {});
    }
    const sourceDigest = createHash('sha256').update(raw, 'utf8').digest('hex');
    const timeline = [];
    let messageIndex = 0;
    for (const line of String(raw).split(/\r?\n/u)) {
        if (!line.trim()) continue;
        let row;
        try {
            row = JSON.parse(line);
        } catch {
            throw new HistoryReplayError('CHAT_JSONL_INVALID');
        }
        if (!isRecord(row)) throw new HistoryReplayError('CHAT_JSONL_INVALID');
        if (typeof row.mes !== 'string') continue;
        const isAssistant = row.is_user === false && row.is_system !== true;
        const visibleText = isAssistant ? formatVisualNovelDisplayText(row.mes) : '';
        timeline.push({
            sourceMessageIndex: messageIndex,
            role: isAssistant ? 'assistant' : 'other',
            ...(visibleText.trim() ? { visibleText } : {}),
        });
        messageIndex += 1;
    }
    const assistantMessages = [];
    for (const row of timeline) {
        if (row.role !== 'assistant' || !row.visibleText) continue;
        assistantMessages.push({
            sourceMessageIndex: row.sourceMessageIndex,
            sourceMessageHash: await createVisibleMessageHash(row.visibleText),
            role: 'assistant',
            authorLabel: '',
            visibleText: row.visibleText,
        });
    }
    return { canonicalPath, sourceDigest, timeline, assistantMessages };
}

export function selectHistoryReplayTargets(assistantMessages, gold = null) {
    if (!Array.isArray(assistantMessages)) throw new HistoryReplayError('HISTORY_MESSAGES_INVALID');
    if (!gold) return assistantMessages.slice(-MAX_REPLAY_MESSAGES);
    const rows = validateHistoryGoldSidecar(gold).messages;
    if (!rows.length) throw new HistoryReplayError('GOLD_SAMPLE_EMPTY');
    const messageByIndex = new Map(assistantMessages.map((message) => [message.sourceMessageIndex, message]));
    return [...rows]
        .sort((left, right) => left.sourceMessageIndex - right.sourceMessageIndex)
        .map((goldMessage) => {
            const target = messageByIndex.get(goldMessage.sourceMessageIndex);
            if (!target || target.sourceMessageHash !== goldMessage.sourceMessageHash) {
                throw new HistoryReplayError('GOLD_TARGET_MISMATCH');
            }
            return target;
        });
}

export function validateHistoryGoldSidecar(gold) {
    if (!isRecord(gold) || !exactKeys(gold, ['schemaVersion', 'publishedEntityMap', 'messages'])
        || gold.schemaVersion !== GOLD_SCHEMA_VERSION || !isRecord(gold.publishedEntityMap) || !Array.isArray(gold.messages)) {
        throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
    }
    const seenIndices = new Set();
    for (const row of gold.messages) {
        if (!isRecord(row) || !exactKeys(row, ['sourceMessageIndex', 'sourceMessageHash', 'scriptId', 'segments', 'entityMentions'])
            || !Number.isSafeInteger(row.sourceMessageIndex) || row.sourceMessageIndex < 0
            || !/^sha256:[a-f0-9]{64}$/u.test(row.sourceMessageHash)
            || typeof row.scriptId !== 'string' || !row.scriptId || row.scriptId.length > 80
            || !Array.isArray(row.segments) || !Array.isArray(row.entityMentions)
            || seenIndices.has(row.sourceMessageIndex)) {
            throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
        }
        seenIndices.add(row.sourceMessageIndex);
        for (const segment of row.segments) {
            if (!isRecord(segment) || !exactKeys(segment, ['start', 'end', 'kind', 'speakerEntityKey'])
                || !Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end)
                || segment.start < 0 || segment.end <= segment.start
                || !['narration', 'dialogue', 'unattributed-dialogue', 'stage-direction', 'status', 'choice', 'other-visible'].includes(segment.kind)
                || !(segment.speakerEntityKey === null || (typeof segment.speakerEntityKey === 'string' && segment.speakerEntityKey))) {
                throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
            }
            if ((segment.kind === 'dialogue') !== Boolean(segment.speakerEntityKey)) throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
        }
        for (const mention of row.entityMentions) {
            if (!isRecord(mention) || !exactKeys(mention, ['start', 'end', 'entityKey'])
                || !Number.isSafeInteger(mention.start) || !Number.isSafeInteger(mention.end)
                || mention.start < 0 || mention.end <= mention.start
                || typeof mention.entityKey !== 'string' || !mention.entityKey) {
                throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
            }
        }
    }
    for (const [resolverRef, entityKey] of Object.entries(gold.publishedEntityMap)) {
        if (!resolverRef.startsWith('published:') || typeof entityKey !== 'string' || !entityKey) {
            throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
        }
    }
    return gold;
}

export async function scoreHistoryReplay({ targets, annotations, gold: suppliedGold, chatKey, releaseId, publishedCast = [] } = {}) {
    const gold = validateHistoryGoldSidecar(suppliedGold);
    const goldByIndex = new Map(gold.messages.map((row) => [row.sourceMessageIndex, row]));
    const targetByIndex = new Map((targets || []).map((row) => [row.sourceMessageIndex, row]));
    const annotationByIndex = new Map((annotations || []).map((row) => [row.sourceMessageIndex, row]));
    const joined = [...targetByIndex.values()].filter((row) => goldByIndex.has(row.sourceMessageIndex));
    for (const row of joined) {
        if (goldByIndex.get(row.sourceMessageIndex).sourceMessageHash !== row.sourceMessageHash) {
            throw new HistoryReplayError('GOLD_SOURCE_HASH_MISMATCH');
        }
        validateGoldMessageCoverage(goldByIndex.get(row.sourceMessageIndex), Array.from(row.visibleText).length);
    }
    const identityMessages = joined.map((target) => ({
        sourceMessageIndex: target.sourceMessageIndex,
        sourceMessageHash: target.sourceMessageHash,
        visibleText: target.visibleText,
        annotation: annotationByIndex.get(target.sourceMessageIndex) || null,
    }));
    const identity = await projectPresentationIdentityDetailed({
        chatKey,
        releaseId,
        messages: identityMessages,
        publishedCast,
    });
    const speakersBySegment = new Map(identity.projection.segmentSpeakers.map((row) => [
        `${row.sourceMessageIndex}:${row.segmentIndex}`, row.resolvedSpeakerRef,
    ]));
    const scriptTotals = new Map();
    const confusion = {};
    let totalSourceCodePoints = 0;
    let coveredSourceCodePoints = 0;
    let validResultCount = 0;
    let scoredMessages = 0;

    for (const target of joined) {
        const goldMessage = goldByIndex.get(target.sourceMessageIndex);
        const annotation = annotationByIndex.get(target.sourceMessageIndex);
        const sourceCodePoints = Array.from(target.visibleText);
        const valid = await isCompleteAnnotation(annotation, target, sourceCodePoints.length);
        totalSourceCodePoints += sourceCodePoints.length;
        const scriptCoverage = getScriptTotals(scriptTotals, goldMessage.scriptId).spanCoverage;
        scriptCoverage.denominator += sourceCodePoints.length;
        if (valid) {
            coveredSourceCodePoints += sourceCodePoints.length;
            validResultCount += 1;
            scriptCoverage.numerator += sourceCodePoints.length;
        }
        scoredMessages += 1;
        const totals = getScriptTotals(scriptTotals, goldMessage.scriptId);
        const goldSegments = goldMessage.segments;
        const predictedSegments = valid ? annotation.segments : [];
        for (const [cpIndex, codePoint] of sourceCodePoints.entries()) {
            if (/^\s+$/u.test(codePoint)) continue;
            const goldSegment = goldSegments.find((segment) => segment.start <= cpIndex && cpIndex < segment.end);
            if (!goldSegment) throw new HistoryReplayError('GOLD_SEGMENT_COVERAGE_INVALID');
            const predictedSegmentIndex = predictedSegments.findIndex((segment) => segment.start <= cpIndex && cpIndex < segment.end);
            const rawPrediction = predictedSegmentIndex >= 0 ? predictedSegments[predictedSegmentIndex] : null;
            const predictedSpeakerKey = rawPrediction?.kind === 'dialogue'
                ? await canonicalPredictedSpeaker({
                    identityRef: speakersBySegment.get(`${target.sourceMessageIndex}:${predictedSegmentIndex}`),
                    identity,
                    goldMessages: goldByIndex,
                    publishedEntityMap: gold.publishedEntityMap,
                })
                : null;
            const predictedKind = !rawPrediction ? 'missing'
                : rawPrediction.kind === 'dialogue' && !predictedSpeakerKey ? 'unattributed-dialogue'
                    : rawPrediction.kind;
            addConfusion(confusion, goldSegment.kind, predictedKind);
            if (goldSegment.kind === 'dialogue' && predictedKind === 'dialogue' && goldSegment.speakerEntityKey === predictedSpeakerKey) {
                totals.speakerCorrect += 1;
            }
            if (predictedKind === 'dialogue') totals.predictedAttributedDialogue += 1;
            if (goldSegment.kind === 'dialogue') totals.goldAttributedDialogue += 1;
            if ((goldSegment.kind === 'dialogue' || goldSegment.kind === 'unattributed-dialogue') && predictedKind === 'narration') {
                totals.dialogueFalseNarration += 1;
            }
            if (goldSegment.kind === 'narration' && predictedKind === 'dialogue') totals.narrationFalseSpeaker += 1;
            if (goldSegment.kind === 'unattributed-dialogue') {
                totals.goldUnattributed += 1;
                if (predictedKind === 'unattributed-dialogue') totals.correctUnattributed += 1;
            }
            if (predictedKind === 'unattributed-dialogue') totals.predictedUnattributed += 1;
            if (predictedKind === 'dialogue' || predictedKind === 'unattributed-dialogue') totals.predictedSpeech += 1;
            if (goldSegment.kind === 'narration') totals.goldNarration += 1;
            if (['stage-direction', 'status', 'choice', 'other-visible'].includes(goldSegment.kind)) {
                const metric = totals.otherKinds[goldSegment.kind] || { correct: 0, gold: 0 };
                metric.gold += 1;
                if (predictedKind === goldSegment.kind) metric.correct += 1;
                totals.otherKinds[goldSegment.kind] = metric;
            }
            if (goldSegment.kind === 'dialogue' && (predictedKind === 'unattributed-dialogue' || predictedKind === 'missing')) {
                const isPublished = Object.values(gold.publishedEntityMap).includes(goldSegment.speakerEntityKey);
                if (isPublished) totals.knownCastToUnknown += 1;
                else totals.newSpeakerToUnknown += 1;
            }
            const goldBucket = goldSegment.kind;
            const predictedBucket = predictedKind;
            totals.pointMetrics.speakerPrecision.denominator += predictedKind === 'dialogue' ? 1 : 0;
            totals.pointMetrics.speakerRecall.denominator += goldSegment.kind === 'dialogue' ? 1 : 0;
            totals.pointMetrics.dialogueFalseNarrationRate.denominator += ['dialogue', 'unattributed-dialogue'].includes(goldSegment.kind) ? 1 : 0;
            totals.pointMetrics.narrationFalseSpeakerRate.denominator += goldSegment.kind === 'narration' ? 1 : 0;
            totals.pointMetrics.unattributedDialogueRecall.denominator += goldSegment.kind === 'unattributed-dialogue' ? 1 : 0;
            totals.pointMetrics.predictedUnattributedDialogueRate.denominator += ['dialogue', 'unattributed-dialogue'].includes(predictedKind) ? 1 : 0;
            if (goldBucket === 'dialogue' && predictedKind === 'dialogue' && goldSegment.speakerEntityKey === predictedSpeakerKey) totals.pointMetrics.speakerPrecision.numerator += 1;
            if (goldBucket === 'dialogue' && predictedKind === 'dialogue' && goldSegment.speakerEntityKey === predictedSpeakerKey) totals.pointMetrics.speakerRecall.numerator += 1;
            if (['dialogue', 'unattributed-dialogue'].includes(goldBucket) && predictedKind === 'narration') totals.pointMetrics.dialogueFalseNarrationRate.numerator += 1;
            if (goldBucket === 'narration' && predictedKind === 'dialogue') totals.pointMetrics.narrationFalseSpeakerRate.numerator += 1;
            if (goldBucket === 'unattributed-dialogue' && predictedKind === 'unattributed-dialogue') totals.pointMetrics.unattributedDialogueRecall.numerator += 1;
            if (predictedKind === 'unattributed-dialogue') totals.pointMetrics.predictedUnattributedDialogueRate.numerator += 1;
        }
    }
    const merged = mergeScriptTotals([...scriptTotals.values()]);
    const metricPairs = {
        speakerPrecision: [merged.pointMetrics.speakerPrecision.numerator, merged.pointMetrics.speakerPrecision.denominator],
        speakerRecall: [merged.pointMetrics.speakerRecall.numerator, merged.pointMetrics.speakerRecall.denominator],
        dialogueFalseNarrationRate: [merged.pointMetrics.dialogueFalseNarrationRate.numerator, merged.pointMetrics.dialogueFalseNarrationRate.denominator],
        narrationFalseSpeakerRate: [merged.pointMetrics.narrationFalseSpeakerRate.numerator, merged.pointMetrics.narrationFalseSpeakerRate.denominator],
        unattributedDialogueRecall: [merged.pointMetrics.unattributedDialogueRecall.numerator, merged.pointMetrics.unattributedDialogueRecall.denominator],
        predictedUnattributedDialogueRate: [merged.pointMetrics.predictedUnattributedDialogueRate.numerator, merged.pointMetrics.predictedUnattributedDialogueRate.denominator],
        spanCoverage: [coveredSourceCodePoints, totalSourceCodePoints],
    };
    const metrics = {};
    for (const [name, [numerator, denominator]] of Object.entries(metricPairs)) {
        metrics[name] = { estimate: ratio(numerator, denominator), ...scriptClusterInterval(scriptTotals, name) };
    }
    for (const kind of ['stage-direction', 'status', 'choice', 'other-visible']) {
        const numerator = merged.otherKinds[kind]?.correct || 0;
        const denominator = merged.otherKinds[kind]?.gold || 0;
        metrics[`${kind}Recall`] = { estimate: ratio(numerator, denominator), ...scriptClusterInterval(scriptTotals, `${kind}Recall`) };
    }
    return {
        scoredMessages,
        matchedGoldMessages: joined.length,
        goldCoverage: ratio(joined.length, gold.messages.length),
        annotationCoverage: ratio(validResultCount, joined.length),
        metrics,
        confusion,
        errorTransitions: {
            dialogueToNarration: merged.pointMetrics.dialogueFalseNarrationRate.numerator,
            narrationToSpeaker: merged.pointMetrics.narrationFalseSpeakerRate.numerator,
            knownCastToUnknown: merged.knownCastToUnknown,
            newSpeakerToUnknown: merged.newSpeakerToUnknown,
        },
    };
}

export async function runPresentationHistoryReplay({
    chatPath,
    chatsRoot = CHAT_ROOT,
    confirmExternalAnalysis = false,
    goldPath = '',
    configBaseUrl = DEFAULT_CONFIG_URL,
    analysisBaseUrl = DEFAULT_ANALYSIS_URL,
    fetchImpl = globalThis.fetch,
} = {}) {
    if (typeof fetchImpl !== 'function') throw new HistoryReplayError('FETCH_UNAVAILABLE');
    const history = await readHistoryChat(chatPath, { chatsRoot });
    const gold = goldPath ? await readGoldSidecar(goldPath, REPOSITORY_ROOT) : null;
    const targets = selectHistoryReplayTargets(history.assistantMessages, gold);
    if (!confirmExternalAnalysis) {
        return {
            status: 'dry-run',
            selectedAssistantMessages: targets.length,
            externalAnalysisStarted: false,
            chatWriteback: false,
        };
    }
    if (!targets.length) throw new HistoryReplayError('NO_VISIBLE_ASSISTANT_MESSAGES');
    const safeAnalysisBaseUrl = validateLoopbackBase(analysisBaseUrl, 'ANALYSIS_SERVICE_URL_INVALID');
    const originFetch = (url, init = {}) => fetchImpl(url, {
        ...init,
        headers: { ...(init.headers || {}), origin: PLAYER_ORIGIN },
    });
    const releaseBundle = await fetchActiveRelease(originFetch, configBaseUrl);
    const analyzer = new PresentationAnalysisAdapter({ baseUrl: safeAnalysisBaseUrl.toString().replace(/\/$/u, ''), fetchImpl: originFetch });
    const health = await analyzer.healthCheck();
    if (health.serviceReady !== true || health.analyzerConfigured !== true) throw new HistoryReplayError('ANALYZER_NOT_READY');
    const { knownEntities, diagnostics } = await createPublishedPresentationKnownEntities(releaseBundle.manifest.resourceBindings?.characters || {});
    const scope = {
        scenarioId: releaseBundle.release.scenarioId,
        scenarioVersion: releaseBundle.release.scenarioVersion,
        releaseId: releaseBundle.release.releaseId,
        arcId: releaseBundle.release.activeArcId || releaseBundle.release.arcId || '',
        chatKey: `history-${randomUUID()}`,
    };
    const annotationsByTarget = Array(targets.length).fill(null);
    const latencyByTarget = Array(targets.length).fill(null);
    const failures = {};
    // Match the analysis service's two-request inflight cap while avoiding a
    // full-history serial wait. Store by target order so reports stay stable.
    for (let offset = 0; offset < targets.length; offset += 2) {
        const batch = targets.slice(offset, offset + 2);
        await Promise.all(batch.map(async (target, batchIndex) => {
            const targetIndex = offset + batchIndex;
            const startedAt = Date.now();
            try {
                const contextMessages = await recentAssistantContext(history.timeline, target.sourceMessageIndex);
                const rows = await analyzer.annotate({ scope, messages: [target], contextMessages, knownEntities });
                if (rows.length !== 1) throw new HistoryReplayError('ANNOTATION_RESULT_COUNT_INVALID');
                annotationsByTarget[targetIndex] = rows[0];
            } catch (error) {
                const code = safeErrorCode(error?.code);
                failures[code] = (failures[code] || 0) + 1;
            } finally {
                latencyByTarget[targetIndex] = Date.now() - startedAt;
            }
        }));
    }
    const annotations = annotationsByTarget.filter(Boolean);
    const latencyMs = latencyByTarget.filter(Number.isFinite);
    const after = await readHistoryChat(chatPath, { chatsRoot });
    const sourceUnchanged = after.canonicalPath === history.canonicalPath && after.sourceDigest === history.sourceDigest;
    if (!sourceUnchanged) throw new HistoryReplayError('CHAT_CHANGED_DURING_REPLAY');
    let scoring = null;
    if (gold) {
        scoring = await scoreHistoryReplay({
            targets,
            annotations,
            gold,
            chatKey: scope.chatKey,
            releaseId: scope.releaseId,
            publishedCast: knownEntities.map((entity) => ({
                id: entity.resolverEntityRef.slice('published:'.length),
                name: entity.visibleNames[0],
                aliases: entity.visibleNames.slice(1),
            })),
        });
    }
    return {
        status: failuresCount(failures) ? 'partial' : 'completed',
        selectedAssistantMessages: targets.length,
        validAnnotations: annotations.length,
        failures,
        analyzerScope: health.analyzerScope,
        providerLatencyMs: summarizeLatencies(latencyMs),
        publishedContextCount: knownEntities.length,
        inputDiagnostics: diagnostics,
        sourceUnchanged,
        chatWriteback: false,
        scoring,
    };
}

async function fetchActiveRelease(fetcher, baseUrl) {
    const base = validateLoopbackBase(baseUrl, 'CONFIG_SERVICE_URL_INVALID');
    let response;
    try {
        response = await fetcher(new URL('/v1/releases/active', base), { method: 'GET', cache: 'no-store', redirect: 'error' });
    } catch {
        throw new HistoryReplayError('CONFIG_SERVICE_UNAVAILABLE');
    }
    if (!response.ok) throw new HistoryReplayError('ACTIVE_RELEASE_UNAVAILABLE');
    let release;
    try {
        release = await response.json();
    } catch {
        throw new HistoryReplayError('ACTIVE_RELEASE_INVALID');
    }
    if (!isRecord(release) || !['scenarioId', 'scenarioVersion', 'releaseId', 'manifestUrl'].every((key) => nonEmptyString(release[key]))) {
        throw new HistoryReplayError('ACTIVE_RELEASE_INVALID');
    }
    let manifestUrl;
    try {
        manifestUrl = new URL(release.manifestUrl, base);
    } catch {
        throw new HistoryReplayError('ACTIVE_RELEASE_INVALID');
    }
    if (!isLoopbackUrl(manifestUrl) || manifestUrl.port !== base.port || manifestUrl.search || manifestUrl.hash) {
        throw new HistoryReplayError('ACTIVE_RELEASE_INVALID');
    }
    let manifestResponse;
    try {
        manifestResponse = await fetcher(manifestUrl, { method: 'GET', cache: 'no-store', redirect: 'error' });
    } catch {
        throw new HistoryReplayError('ACTIVE_MANIFEST_UNAVAILABLE');
    }
    if (!manifestResponse.ok) throw new HistoryReplayError('ACTIVE_MANIFEST_UNAVAILABLE');
    let manifest;
    try {
        manifest = await manifestResponse.json();
    } catch {
        throw new HistoryReplayError('ACTIVE_MANIFEST_INVALID');
    }
    if (!isRecord(manifest) || !isRecord(manifest.resourceBindings)) throw new HistoryReplayError('ACTIVE_MANIFEST_INVALID');
    return { release, manifest };
}

async function readGoldSidecar(goldPath, repositoryRoot) {
    if (typeof goldPath !== 'string' || !isAbsolute(goldPath)) throw new HistoryReplayError('GOLD_PATH_MUST_BE_ABSOLUTE');
    let canonical;
    try {
        canonical = await realpath(goldPath);
    } catch {
        throw new HistoryReplayError('GOLD_FILE_UNAVAILABLE');
    }
    if (isPathInside(repositoryRoot, canonical)) throw new HistoryReplayError('GOLD_FILE_MUST_BE_PRIVATE');
    let raw;
    try {
        raw = await readFile(canonical, 'utf8');
    } catch {
        throw new HistoryReplayError('GOLD_FILE_UNAVAILABLE');
    }
    let gold;
    try {
        gold = JSON.parse(raw);
    } catch {
        throw new HistoryReplayError('GOLD_SCHEMA_INVALID');
    }
    return validateHistoryGoldSidecar(gold);
}

async function recentAssistantContext(timeline, targetIndex) {
    const firstIndex = Math.max(0, targetIndex - 4);
    const context = timeline.filter((row) => row.sourceMessageIndex >= firstIndex
        && row.sourceMessageIndex < targetIndex && row.role === 'assistant' && row.visibleText).slice(-4);
    return Promise.all(context.map(async (row) => ({
        sourceMessageIndex: row.sourceMessageIndex,
        sourceMessageHash: await createVisibleMessageHash(row.visibleText),
        visibleText: row.visibleText,
    })));
}

async function canonicalPredictedSpeaker({ identityRef, identity, goldMessages, publishedEntityMap }) {
    if (!identityRef || identityRef.type === 'unknown') return null;
    if (identityRef.type === 'published') return publishedEntityMap[`published:${identityRef.id}`] || null;
    if (identityRef.type !== 'chat-local') return null;
    const projected = identity.projection.entities.find((entity) => entity.identityRef.type === 'chat-local' && entity.identityRef.id === identityRef.id);
    if (!projected) return null;
    const keys = new Set();
    for (const alias of projected.aliases) {
        const row = goldMessages.get(alias.sourceMessageIndex);
        for (const mention of row?.entityMentions || []) {
            if (mention.start === alias.start && mention.end === alias.end) keys.add(mention.entityKey);
        }
    }
    return keys.size === 1 ? [...keys][0] : null;
}

async function isCompleteAnnotation(annotation, target, sourceLength) {
    if (!isRecord(annotation) || annotation.sourceMessageIndex !== target.sourceMessageIndex
        || annotation.sourceMessageHash !== target.sourceMessageHash || !Array.isArray(annotation.segments)) return false;
    let cursor = 0;
    for (const segment of annotation.segments) {
        if (segment.start !== cursor || segment.end <= segment.start || segment.end > sourceLength
            || segment.textHash !== await createVisibleMessageHash(codePointSlice(target.visibleText, segment.start, segment.end))) return false;
        cursor = segment.end;
    }
    return cursor === sourceLength;
}

function validateGoldMessageCoverage(goldMessage, sourceLength) {
    let cursor = 0;
    for (const segment of goldMessage.segments) {
        if (segment.start !== cursor || segment.end <= segment.start || segment.end > sourceLength) {
            throw new HistoryReplayError('GOLD_SEGMENT_COVERAGE_INVALID');
        }
        cursor = segment.end;
    }
    if (cursor !== sourceLength) throw new HistoryReplayError('GOLD_SEGMENT_COVERAGE_INVALID');
    for (const mention of goldMessage.entityMentions) {
        if (mention.end > sourceLength) throw new HistoryReplayError('GOLD_ENTITY_SPAN_INVALID');
    }
}

function getScriptTotals(map, scriptId) {
    if (map.has(scriptId)) return map.get(scriptId);
    const pointMetrics = Object.fromEntries([
        'speakerPrecision', 'speakerRecall', 'dialogueFalseNarrationRate', 'narrationFalseSpeakerRate',
        'unattributedDialogueRecall', 'predictedUnattributedDialogueRate',
    ].map((name) => [name, { numerator: 0, denominator: 0 }]));
    const totals = {
        pointMetrics,
        spanCoverage: { numerator: 0, denominator: 0 },
        otherKinds: {},
        speakerCorrect: 0,
        predictedAttributedDialogue: 0,
        goldAttributedDialogue: 0,
        dialogueFalseNarration: 0,
        narrationFalseSpeaker: 0,
        goldUnattributed: 0,
        correctUnattributed: 0,
        predictedUnattributed: 0,
        predictedSpeech: 0,
        goldNarration: 0,
        knownCastToUnknown: 0,
        newSpeakerToUnknown: 0,
    };
    map.set(scriptId, totals);
    return totals;
}

function mergeScriptTotals(rows) {
    const result = getScriptTotals(new Map(), 'merged');
    for (const row of rows) {
        for (const metric of Object.keys(result.pointMetrics)) {
            result.pointMetrics[metric].numerator += row.pointMetrics[metric].numerator;
            result.pointMetrics[metric].denominator += row.pointMetrics[metric].denominator;
        }
        result.spanCoverage.numerator += row.spanCoverage.numerator;
        result.spanCoverage.denominator += row.spanCoverage.denominator;
        for (const key of ['knownCastToUnknown', 'newSpeakerToUnknown']) result[key] += row[key];
        for (const [kind, value] of Object.entries(row.otherKinds)) {
            const merged = result.otherKinds[kind] || { correct: 0, gold: 0 };
            merged.correct += value.correct;
            merged.gold += value.gold;
            result.otherKinds[kind] = merged;
        }
    }
    return result;
}

function scriptClusterInterval(scriptTotals, metricName) {
    const scripts = [...scriptTotals.entries()]
        .map(([scriptId, totals]) => ({ scriptId, ...metricCounts(totals, metricName) }))
        .filter((item) => item.denominator > 0)
        .sort((left, right) => compareCodePoints(left.scriptId, right.scriptId));
    if (scripts.length < 2) return { ciLower: null, ciUpper: null, eligibleScriptCount: scripts.length };
    const estimates = [];
    let state = 20261002 >>> 0;
    for (let iteration = 0; iteration < 2000; iteration += 1) {
        let numerator = 0;
        let denominator = 0;
        for (let draw = 0; draw < scripts.length; draw += 1) {
            state = (1664525 * state + 1013904223) >>> 0;
            const selected = scripts[Math.floor((state / 0x1_0000_0000) * scripts.length)];
            numerator += selected.numerator;
            denominator += selected.denominator;
        }
        estimates.push(numerator / denominator);
    }
    estimates.sort((left, right) => left - right);
    return {
        ciLower: estimates[Math.floor((estimates.length - 1) * 0.025)],
        ciUpper: estimates[Math.floor((estimates.length - 1) * 0.975)],
        eligibleScriptCount: scripts.length,
    };
}

function metricCounts(totals, metricName) {
    if (metricName === 'spanCoverage') return totals.spanCoverage;
    if (metricName.endsWith('Recall') && ['stage-directionRecall', 'statusRecall', 'choiceRecall', 'other-visibleRecall'].includes(metricName)) {
        const item = totals.otherKinds[metricName.replace(/Recall$/u, '')] || { correct: 0, gold: 0 };
        return { numerator: item.correct, denominator: item.gold };
    }
    return totals.pointMetrics[metricName] || { numerator: 0, denominator: 0 };
}

function ratio(numerator, denominator) {
    return denominator > 0 ? numerator / denominator : null;
}

function addConfusion(confusion, goldKind, predictedKind) {
    const row = confusion[goldKind] || {};
    row[predictedKind] = (row[predictedKind] || 0) + 1;
    confusion[goldKind] = row;
}

function compareCodePoints(left, right) {
    const a = Array.from(left);
    const b = Array.from(right);
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
        if (delta) return delta;
    }
    return a.length - b.length;
}

function isPathInside(parent, target) {
    const child = relative(parent, target);
    return Boolean(child) && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function validateLoopbackBase(value, errorCode) {
    let url;
    try {
        url = new URL(value);
    } catch {
        throw new HistoryReplayError(errorCode);
    }
    if (!isLoopbackUrl(url) || url.search || url.hash || url.pathname !== '/' && url.pathname !== '') {
        throw new HistoryReplayError(errorCode);
    }
    return url;
}

function isLoopbackUrl(url) {
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())
        && !url.username && !url.password;
}

function summarizeLatencies(values) {
    if (!values.length) return { count: 0, mean: null, p95: null };
    const ordered = [...values].sort((left, right) => left - right);
    return {
        count: values.length,
        mean: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
        p95: ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * 0.95))],
    };
}

function failuresCount(failures) {
    return Object.values(failures).reduce((sum, count) => sum + count, 0);
}

function safeErrorCode(value) {
    const code = String(value || 'ANALYSIS_FAILED').toUpperCase();
    return /^[A-Z0-9_-]{1,64}$/u.test(code) ? code : 'ANALYSIS_FAILED';
}

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
    if (!isRecord(value)) return false;
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseArguments(args) {
    const options = { chatPath: '', goldPath: '', confirmExternalAnalysis: false };
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === '--confirm-external-analysis') options.confirmExternalAnalysis = true;
        else if (args[index] === '--chat' && args[index + 1]) options.chatPath = args[++index];
        else if (args[index] === '--gold' && args[index + 1]) options.goldPath = args[++index];
        else throw new HistoryReplayError('ARGUMENT_INVALID');
    }
    if (!options.chatPath) throw new HistoryReplayError('CHAT_PATH_REQUIRED');
    return options;
}

async function main() {
    try {
        const options = parseArguments(process.argv.slice(2));
        const report = await runPresentationHistoryReplay(options);
        process.stdout.write(`${JSON.stringify(report)}\n`);
    } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', code: safeErrorCode(error?.code) })}\n`);
        process.exitCode = 1;
    }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
