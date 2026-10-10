import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { classifyStructuralPageShape, createStructuralMessageSpeakerIndex, createStructuralPageTitleEvidenceFromMessageIndex, createProbableNarrativeSpeakerTitleEvidence, createProbableQuoteSpanContinuationTitleEvidence, createVisualNovelDisplaySegments, createChatLocalObservedSpeakerNameScopes } from '../../shared/src/sillytavern-adapter.js';
import { readHistoryChat } from '../../shared/tools/presentation-history-replay.mjs';
import {
    bindSpeakerCandidateScopes,
    buildSpeakerCandidateScopes,
    createSpeakerChatFingerprint as createCandidateChatFingerprint,
    SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION,
    validateSpeakerCandidateScopes,
} from './speaker-candidate-scopes.mjs';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, '../../..');
const DEFAULT_CHAT_ROOT = path.join(REPOSITORY_ROOT, 'data', 'default-user', 'chats');
const DEFAULT_WORLDBOOK_ROOT = path.join(REPOSITORY_ROOT, 'data', 'default-user', 'worlds');
const DEFAULT_CHARACTER_ROOT = path.join(REPOSITORY_ROOT, 'data', 'default-user', 'characters');
const V79_FIXED_COHORT_SOURCE_DIGEST = 'sha256:3cd35138de9729080525259936cb95376ee662b59691f917d4903a7bd47bd6bd';
const V79_FIXED_COHORT_SIZE = 1309;
const V79_FIXED_COHORT_MEMBERSHIP_DIGEST = 'sha256:87da8450dada84378ea5dc405834fd4b1144d27152ae5df360a4b0f02c754d00';
const GOLD_SCHEMA_VERSION = 'galgame.structural-speaker-title-gold.v1';
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GOLD_KINDS = new Set(['speaker', 'group', 'narration', 'unknown']);
const SPEAKER_SCOPES_SCHEMA_VERSION = 'galgame.speaker-scopes.v1';
const STRUCTURAL_PARSER_VERSION = 'full-message-speaker-index.v86';
const REPLAY_ADDED_DIRECT_SPEECH_CUES = ['补充道', '提醒道', '回应道', '插话道', '解释道', '嘀咕道', '嘟囔道', '补充', '嘀咕', '提醒', '回应', '插话', '解释', '低声道', '轻声道', '尖叫', '怒吼', '咆哮', '嘶声', '低语', '喃喃道', '嘟囔'];
const NARRATOR_FALLBACK_REASON_IDS = [
    'narrative-shape-with-unattributed-quote',
    'no-unique-speaker-evidence',
    'conflicting-speaker-evidence',
    'ambiguous-local-reference',
    'ambiguous-quote-structure',
    'open-quote-without-unique-speaker',
    'dialogue-shape-without-speaker',
];

function createFallbackReasonCounts() {
    return Object.fromEntries(NARRATOR_FALLBACK_REASON_IDS.map((reasonId) => [reasonId, 0]));
}

export class SpeakerStructureReplayError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SpeakerStructureReplayError';
        this.code = code;
    }
}

export function createSpeakerChatFingerprint(chatsRoot, chatPath) {
    return createCandidateChatFingerprint(chatsRoot, chatPath);
}

export function validateSpeakerTitleGold(gold) {
    if (!isRecord(gold) || !exactKeys(gold, ['schemaVersion', 'publishedSpeakerNames', 'messages'])
        || gold.schemaVersion !== GOLD_SCHEMA_VERSION || !Array.isArray(gold.publishedSpeakerNames)
        || !Array.isArray(gold.messages)) throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');

    const names = new Set();
    for (const name of gold.publishedSpeakerNames) {
        if (typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 80 || names.has(name)) {
            throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');
        }
        names.add(name);
    }

    const messageKeys = new Set();
    for (const message of gold.messages) {
        if (!isRecord(message) || !exactKeys(message, ['chatFingerprint', 'sourceMessageIndex', 'sourceMessageHash', 'pages'])
            || !HASH_PATTERN.test(message.chatFingerprint) || !Number.isSafeInteger(message.sourceMessageIndex)
            || message.sourceMessageIndex < 0 || !HASH_PATTERN.test(message.sourceMessageHash) || !Array.isArray(message.pages)) {
            throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');
        }
        const messageKey = `${message.chatFingerprint}:${message.sourceMessageIndex}`;
        if (messageKeys.has(messageKey)) throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');
        messageKeys.add(messageKey);
        const pageKeys = new Set();
        for (const page of message.pages) {
            if (!isRecord(page) || !exactKeys(page, ['pageIndex', 'start', 'end', 'expectedKind', 'expectedSpeakers'])
                || !Number.isSafeInteger(page.pageIndex) || page.pageIndex < 0
                || !Number.isSafeInteger(page.start) || !Number.isSafeInteger(page.end) || page.start < 0 || page.end <= page.start
                || !GOLD_KINDS.has(page.expectedKind) || !Array.isArray(page.expectedSpeakers)
                || page.expectedSpeakers.some((name) => typeof name !== 'string' || !name.trim() || name !== name.trim())
                || pageKeys.has(page.pageIndex)) throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');
            pageKeys.add(page.pageIndex);
            const uniqueSpeakers = new Set(page.expectedSpeakers);
            if (uniqueSpeakers.size !== page.expectedSpeakers.length
                || ((page.expectedKind === 'speaker') !== (page.expectedSpeakers.length === 1))
                || ((page.expectedKind === 'group') !== (page.expectedSpeakers.length >= 2))
                || (['narration', 'unknown'].includes(page.expectedKind) && page.expectedSpeakers.length !== 0)) {
                throw new SpeakerStructureReplayError('GOLD_SCHEMA_INVALID');
            }
        }
    }
    return gold;
}

export function validateSpeakerScopes(scopes) {
    if (!isRecord(scopes) || !exactKeys(scopes, ['schemaVersion', 'entries'])
        || scopes.schemaVersion !== SPEAKER_SCOPES_SCHEMA_VERSION || !Array.isArray(scopes.entries)) {
        throw new SpeakerStructureReplayError('SPEAKER_SCOPES_SCHEMA_INVALID');
    }
    const fingerprints = new Set();
    for (const entry of scopes.entries) {
        if (!isRecord(entry) || !exactKeys(entry, ['chatFingerprint', 'releaseVersion', 'publishedSpeakerNames'])
            || !HASH_PATTERN.test(entry.chatFingerprint) || fingerprints.has(entry.chatFingerprint)
            || typeof entry.releaseVersion !== 'string' || !entry.releaseVersion.trim()
            || entry.releaseVersion !== entry.releaseVersion.trim() || entry.releaseVersion.length > 120) {
            throw new SpeakerStructureReplayError('SPEAKER_SCOPES_SCHEMA_INVALID');
        }
        const names = validatePublishedSpeakerNames(entry.publishedSpeakerNames);
        if (names.length !== entry.publishedSpeakerNames.length) throw new SpeakerStructureReplayError('SPEAKER_SCOPES_SCHEMA_INVALID');
        fingerprints.add(entry.chatFingerprint);
    }
    return scopes;
}

export function scoreStructuralSpeakerReplay({ predictions = [], gold } = {}) {
    const validatedGold = validateSpeakerTitleGold(gold);
    const predictedByKey = new Map(predictions.map((row) => [
        `${row.chatFingerprint}:${row.sourceMessageIndex}:${row.pageIndex}`,
        row,
    ]));
    const goldRows = validatedGold.messages.flatMap((message) => message.pages.map((page) => ({
        ...page,
        key: `${message.chatFingerprint}:${message.sourceMessageIndex}:${page.pageIndex}`,
    })));
    if (!goldRows.length) throw new SpeakerStructureReplayError('GOLD_SAMPLE_EMPTY');
    const checked = goldRows.map((row) => {
        const prediction = predictedByKey.get(row.key);
        if (!prediction || prediction.start !== row.start || prediction.end !== row.end
            || prediction.sourceMessageHash !== validatedGold.messages.find((item) => (
                `${item.chatFingerprint}:${item.sourceMessageIndex}:${row.pageIndex}` === row.key
            ))?.sourceMessageHash) {
            throw new SpeakerStructureReplayError('GOLD_TARGET_MISMATCH');
        }
        return { gold: row, prediction, exact: isExactTitleMatch(row, prediction) };
    });

    const predictedSpeaker = checked.filter(({ prediction }) => ['speaker', 'group'].includes(prediction.kind));
    const goldSpeaker = checked.filter(({ gold: row }) => ['speaker', 'group'].includes(row.expectedKind));
    const correctSpeaker = checked.filter(({ gold: row, prediction, exact }) => exact
        && ['speaker', 'group'].includes(row.expectedKind) && ['speaker', 'group'].includes(prediction.kind));
    const nonSpeakerGold = checked.filter(({ gold: row }) => ['narration', 'unknown'].includes(row.expectedKind));
    const falsePersonOnNonSpeaker = nonSpeakerGold.filter(({ prediction }) => ['speaker', 'group'].includes(prediction.kind));
    const groupGold = checked.filter(({ gold: row }) => row.expectedKind === 'group');
    const groupCorrect = groupGold.filter(({ exact }) => exact);
    const total = checked.length;

    return {
        schemaVersion: GOLD_SCHEMA_VERSION,
        scoredPages: total,
        exactTitleAccuracy: ratio(checked.filter(({ exact }) => exact).length, total),
        speakerTitlePrecision: ratio(correctSpeaker.length, predictedSpeaker.length),
        speakerTitleRecall: ratio(correctSpeaker.length, goldSpeaker.length),
        falsePersonOnNonSpeakerRate: ratio(falsePersonOnNonSpeaker.length, nonSpeakerGold.length),
        multiSpeakerTitleAccuracy: ratio(groupCorrect.length, groupGold.length),
        predictedUnknownPages: checked.filter(({ prediction }) => prediction.kind === 'unknown').length,
        eligibleGoldMessages: validatedGold.messages.length,
    };
}

export function compareFixedSpeakerCandidateCohort({ baseline, candidate } = {}) {
    if (!isRecord(baseline) || !isRecord(candidate)
        || baseline.verifiedSourceSetDigest !== V79_FIXED_COHORT_SOURCE_DIGEST
        || candidate.verifiedSourceSetDigest !== V79_FIXED_COHORT_SOURCE_DIGEST
        || !baseline.sourceUnchanged || !candidate.sourceUnchanged
        || baseline.chatWriteback !== false || candidate.chatWriteback !== false
        || baseline.externalProviderCalls !== 0 || candidate.externalProviderCalls !== 0
        || !Array.isArray(baseline.predictions) || !Array.isArray(candidate.predictions)) {
        throw new SpeakerStructureReplayError('FIXED_COHORT_SOURCE_VERIFICATION_FAILED');
    }
    const candidateByKey = new Map();
    for (const row of candidate.predictions) {
        const key = getReplayPageKey(row);
        if (candidateByKey.has(key)) throw new SpeakerStructureReplayError('FIXED_COHORT_CANDIDATE_DUPLICATE_PAGE');
        candidateByKey.set(key, row);
    }
    if (candidateByKey.size !== baseline.predictions.length) {
        throw new SpeakerStructureReplayError('FIXED_COHORT_PAGE_COUNT_MISMATCH');
    }
    for (const row of baseline.predictions) {
        const target = candidateByKey.get(getReplayPageKey(row));
        if (!target || target.start !== row.start || target.end !== row.end) {
            throw new SpeakerStructureReplayError('FIXED_COHORT_SOURCE_SPAN_MISMATCH');
        }
    }
    const cohort = baseline.predictions.filter((row) => row.diagnosticReasonId === 'no-unique-speaker-evidence');
    if (cohort.length !== V79_FIXED_COHORT_SIZE) {
        throw new SpeakerStructureReplayError('FIXED_COHORT_SIZE_MISMATCH');
    }
    const fixedCohortMembershipDigest = createFixedCohortMembershipDigest(cohort);
    if (fixedCohortMembershipDigest !== V79_FIXED_COHORT_MEMBERSHIP_DIGEST) {
        throw new SpeakerStructureReplayError('FIXED_COHORT_MEMBERSHIP_MISMATCH');
    }
    const transitions = new Map();
    const afterCounts = { speaker: 0, group: 0, narration: 0, fallback: 0 };
    let changedRows = 0;
    for (const row of cohort) {
        const after = candidateByKey.get(getReplayPageKey(row));
        const beforeLabel = summarizeCandidateComparisonLabel(row);
        const afterLabel = summarizeCandidateComparisonLabel(after);
        const key = `${beforeLabel} -> ${afterLabel}`;
        transitions.set(key, (transitions.get(key) || 0) + 1);
        if (beforeLabel !== afterLabel) changedRows += 1;
        if (after.kind === 'speaker') afterCounts.speaker += 1;
        else if (after.kind === 'group') afterCounts.group += 1;
        else if (after.kind === 'narration') afterCounts.narration += 1;
        else afterCounts.fallback += 1;
    }
    return {
        status: 'coverage-only',
        accuracy: 'INSUFFICIENT_EVIDENCE',
        baselineSourceDigest: baseline.verifiedSourceSetDigest,
        candidateSourceDigest: candidate.verifiedSourceSetDigest,
        fixedCohortPages: cohort.length,
        fixedCohortMembershipDigest,
        fullReplayPageSpansMatched: true,
        changedRows,
        after: afterCounts,
        transitions: Object.fromEntries([...transitions.entries()].sort((left, right) => right[1] - left[1])),
    };
}

function createFixedCohortMembershipDigest(cohort) {
    const membership = cohort.map((row) => ({
        key: getReplayPageKey(row),
        start: row.start,
        end: row.end,
    })).sort((left, right) => compareText(left.key, right.key));
    return `sha256:${createHash('sha256').update(JSON.stringify(membership)).digest('hex')}`;
}

function getReplayPageKey(row) {
    if (!isRecord(row) || typeof row.chatFingerprint !== 'string'
        || !Number.isSafeInteger(row.sourceMessageIndex) || typeof row.sourceMessageHash !== 'string'
        || !Number.isSafeInteger(row.pageIndex)) throw new SpeakerStructureReplayError('FIXED_COHORT_PAGE_KEY_INVALID');
    return `${row.chatFingerprint}:${row.sourceMessageIndex}:${row.sourceMessageHash}:${row.pageIndex}`;
}

function summarizeCandidateComparisonLabel(row) {
    if (['speaker', 'group'].includes(row.kind)) return `${row.kind}:${row.speakers.join('+')}`;
    if (row.kind === 'narration') return 'narration';
    return `fallback:${row.diagnosticReasonId || 'unknown'}`;
}

export async function listHistoryChatFiles(chatsRoot = DEFAULT_CHAT_ROOT, { readdirImpl = readdir, lstatImpl = lstat } = {}) {
    const root = path.resolve(chatsRoot);
    let rootStat;
    try {
        rootStat = await lstatImpl(root);
    } catch {
        throw new SpeakerStructureReplayError('CHAT_ROOT_UNAVAILABLE');
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new SpeakerStructureReplayError('CHAT_ROOT_UNAVAILABLE');

    const files = [];
    async function walk(directory, relativeDirectory) {
        const entries = await readdirImpl(directory, { withFileTypes: true });
        entries.sort((left, right) => compareText(left.name, right.name));
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const absolutePath = path.join(directory, entry.name);
            const relativePath = path.join(relativeDirectory, entry.name);
            if (entry.isDirectory()) {
                await walk(absolutePath, relativePath);
            } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.jsonl') {
                files.push(relativePath);
            }
        }
    }
    await walk(root, '');
    return files.sort(compareText);
}

export async function replayStructuralSpeakerHistory({
    chatPaths = [],
    chatsRoot = DEFAULT_CHAT_ROOT,
    gold = null,
    publishedSpeakerNames = [],
    speakerScopes = null,
    speakerCandidateScopes = null,
    speakerCandidateAdapters = null,
    worldbooksRoot = DEFAULT_WORLDBOOK_ROOT,
    charactersRoot = DEFAULT_CHARACTER_ROOT,
    parserVersion = STRUCTURAL_PARSER_VERSION,
    minimumDistinctMessages = 2,
    maxMessages = Number.POSITIVE_INFINITY,
    readHistoryChatImpl = readHistoryChat,
} = {}) {
    if (!Array.isArray(chatPaths) || !Number.isSafeInteger(maxMessages) && maxMessages !== Number.POSITIVE_INFINITY
        || maxMessages <= 0 || typeof readHistoryChatImpl !== 'function'
        || !Number.isSafeInteger(minimumDistinctMessages) || minimumDistinctMessages < 1 || minimumDistinctMessages > 10
        || typeof parserVersion !== 'string' || !parserVersion.trim()) {
        throw new SpeakerStructureReplayError('REPLAY_OPTIONS_INVALID');
    }
    const validatedGold = gold ? validateSpeakerTitleGold(gold) : null;
    const globalNames = validatedGold?.publishedSpeakerNames || validatePublishedSpeakerNames(publishedSpeakerNames);
    const validatedScopes = speakerScopes ? validateSpeakerScopes(speakerScopes) : null;
    const scopeByFingerprint = new Map((validatedScopes?.entries || []).map((entry) => [entry.chatFingerprint, entry]));
    const candidateScopeByFingerprint = speakerCandidateScopes
        ? await bindSpeakerCandidateScopes(speakerCandidateScopes, {
            chatPaths, chatsRoot, worldbooksRoot, charactersRoot, candidateAdapters: speakerCandidateAdapters,
        }) : new Map();
    const candidateSpeakerNameCount = [...candidateScopeByFingerprint.values()]
        .reduce((sum, entry) => sum + entry.candidateSpeakerNames.length, 0);
    const predictions = [];
    const counts = { speaker: 0, group: 0, narration: 0, unknown: 0 };
    const pageKindCounts = {
        'attributed-dialogue': 0,
        'unattributed-dialogue': 0,
        'structured-record': 0,
        heading: 0,
        narrative: 0,
        ambiguous: 0,
        unaddressable: 0,
    };
    const pageKindByBaseType = {};
    const ruleCounts = {};
    const unknownShapeCounts = { quoted: 0, quoteAndSpeechCue: 0, postQuoteAttributionShape: 0, lineColon: 0, dashLed: 0, multiQuote: 0 };
    const sources = [];
    const pageParseDurationsMs = [];
    const messageParseDurationsMs = [];
    let structuralEvidencePages = 0;
    let validStructuralEvidencePages = 0;
    let unaddressablePages = 0;
    let scopeUnavailableChats = 0;
    let scopeUnavailablePages = 0;
    let ambiguousPages = 0;
    let fullMessageProjectionPages = 0;
    let messagesScanned = 0;
    let pagesScanned = 0;
    let dialogueCandidatePages = 0;
    let attributedDialoguePages = 0;
    let unattributedDialogueCandidates = 0;
    let probableSegmenterHints = 0;
    let probableHintSpanValidated = 0;
    let probableHintSpanRejected = 0;
    let probableHintDecisionBlocked = 0;
    let probableQuoteContinuationPages = 0;
    let probableQuoteContinuationSpanLinks = 0;
    let chatsWithObservedSpeakerNames = 0;
    let observedSpeakerNameCount = 0;
    const dialogueCandidateBuckets = {
        confirmedAttributed: 0,
        anonymousIntroduction: 0,
        probableDisplayTitle: 0,
        narratorFallback: 0,
        unresolvedCandidates: 0,
    };
    const candidateFallbackReasonCounts = createFallbackReasonCounts();
    const allPageNarratorFallbackReasonCounts = createFallbackReasonCounts();
    const unresolvedCandidateNatureCounts = {
        quotedSpanIntersection: { yes: 0, no: 0 },
        priorTwoPageSpeakerSeed: { yes: 0, no: 0 },
        matchingPriorQuoteSeed: { yes: 0, no: 0 },
        priorQuoteSeedCoverage: { none: 0, partial: 0, all: 0, noQuotedSpan: 0 },
        matchingSeedSpeakers: { one: 0, multiple: 0, none: 0 },
        quoteStatus: { crossPageOpen: 0, closed: 0, openOrUnclear: 0, noQuotedSpan: 0 },
        localQuoteMarker: { yes: 0, no: 0 },
        lineColonShape: { yes: 0, no: 0 },
        dashLedShape: { yes: 0, no: 0 },
        speechCueLexeme: { yes: 0, no: 0 },
        basePageTypes: {},
        candidateEvidenceSource: { unresolvedQuoteSpan: 0, quoteEvidence: 0, localShapeCue: 0, basePageTypeOnly: 0, noObservedMarker: 0 },
        quoteLedgerIntersection: { yes: 0, no: 0 },
        invalidProjectionEvidence: { yes: 0, no: 0 },
    };
    const noUniqueNarratorFallbackNatureCounts = {
        quotedSpanIntersection: { yes: 0, no: 0 },
        priorTwoPageSpeakerSeed: { yes: 0, no: 0 },
        matchingPriorQuoteSeed: { yes: 0, no: 0 },
        priorQuoteSeedCoverage: { none: 0, partial: 0, all: 0, noQuotedSpan: 0 },
        matchingSeedSpeakers: { one: 0, multiple: 0, none: 0 },
        quoteStatus: { crossPageOpen: 0, closed: 0, openOrUnclear: 0, noQuotedSpan: 0 },
        localQuoteMarker: { yes: 0, no: 0 },
        lineColonShape: { yes: 0, no: 0 },
        dashLedShape: { yes: 0, no: 0 },
        speechCueLexeme: { yes: 0, no: 0 },
        basePageTypes: {},
        candidateEvidenceSource: { unresolvedQuoteSpan: 0, quoteEvidence: 0, localShapeCue: 0, basePageTypeOnly: 0, noObservedMarker: 0 },
        quoteLedgerIntersection: { yes: 0, no: 0 },
        invalidProjectionEvidence: { yes: 0, no: 0 },
        overlappingAnchorCount: { zero: 0, one: 0, multiple: 0 },
    };
    const unresolvedSpanPages = new Map();
    const addedDirectCueUtterances = new Map();
    const startedAt = Date.now();
    const sourceSetHash = createHash('sha256');

    for (const chatPath of chatPaths) {
        const absoluteChatPath = path.resolve(chatsRoot, chatPath);
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
        const scopedEntry = scopeByFingerprint.get(chatFingerprint) || null;
        const candidateScopeEntry = candidateScopeByFingerprint.get(chatFingerprint) || null;
        const candidateNames = candidateScopeEntry?.candidateSpeakerNames || [];
        const hasScopedRoster = Array.isArray(scopedEntry?.publishedSpeakerNames)
            && scopedEntry.publishedSpeakerNames.length > 0;
        const hasSingleChatRosterScope = !validatedScopes && chatPaths.length === 1 && globalNames.length > 0;
        const scopeStatus = hasScopedRoster ? 'scoped'
            : hasSingleChatRosterScope ? 'single-chat-scope' : 'scope-unavailable';
        const effectiveNames = hasScopedRoster ? scopedEntry.publishedSpeakerNames
            : (hasSingleChatRosterScope ? globalNames : []);
        const speakerScopeFingerprint = hasScopedRoster
            ? `sha256:${createHash('sha256').update(JSON.stringify({ releaseVersion: scopedEntry.releaseVersion, names: effectiveNames }), 'utf8').digest('hex')}`
            : scopeStatus === 'single-chat-scope'
                ? `sha256:${createHash('sha256').update(JSON.stringify({ names: effectiveNames }), 'utf8').digest('hex')}`
                : '';
        if (scopeStatus === 'scope-unavailable') scopeUnavailableChats += 1;
        const history = await readHistoryChatImpl(absoluteChatPath, { chatsRoot });
        const observedNameScopes = createChatLocalObservedSpeakerNameScopes({
            messages: history.assistantMessages,
            publishedSpeakerNames: effectiveNames,
            minimumDistinctMessages,
        });
        let messageCountForChat = 0;
        const namesObservedInChat = new Set();
        for (let messagePosition = 0; messagePosition < history.assistantMessages.length; messagePosition += 1) {
            const message = history.assistantMessages[messagePosition];
            if (messagesScanned >= maxMessages) break;
            // Only earlier assistant messages can establish this title-only scope.
            const observedSpeakerNames = observedNameScopes[messagePosition] || [];
            for (const name of observedSpeakerNames) namesObservedInChat.add(name);
            const structuralNames = [...new Set([...effectiveNames, ...candidateNames, ...observedSpeakerNames])];
            const structuralSpeakerFingerprint = `sha256:${createHash('sha256').update(JSON.stringify({
                scope: speakerScopeFingerprint,
                candidateScope: candidateScopeEntry ? {
                    resourceFingerprint: candidateScopeEntry.resourceFingerprint,
                    extractionRuleVersion: candidateScopeEntry.extractionRuleVersion || null,
                    adapters: candidateScopeEntry.adapters?.map(({ adapterId, configFingerprint }) => ({ adapterId, configFingerprint })) || [],
                    sources: candidateScopeEntry.sources?.map(({ sourceId, sourceType, resourceFingerprint, sourceConfigFingerprint }) => ({
                        sourceId, sourceType, resourceFingerprint, sourceConfigFingerprint,
                    })) || [],
                    unavailableSourceCount: candidateScopeEntry.unavailableSources?.length || 0,
                    names: candidateNames,
                } : null,
                beforeMessageIndex: message.sourceMessageIndex,
                observedNames: observedSpeakerNames,
                parserVersion,
            }), 'utf8').digest('hex')}`;
            // Replay the exact source segmenter used by the player. Do not use
            // the semantic-safe grouping helper here: even whitespace span
            // expansion changes which text belongs to a displayed page.
            const visibleSegments = createVisualNovelDisplaySegments(message.visibleText, {
                role: 'character',
                knownSpeakers: effectiveNames,
            });
            const pages = visibleSegments.length ? visibleSegments : [{
                index: 0,
                type: 'narration',
                speaker: '旁白',
                text: message.visibleText,
                sourceText: message.visibleText,
                sourceSpan: null,
            }];
            const messageParseStartedAt = performance.now();
            const structuralMessageIndex = createStructuralMessageSpeakerIndex({
                fullText: message.visibleText,
                publishedSpeakerNames: structuralNames,
                publishedSpeakerFingerprint: structuralSpeakerFingerprint,
                sourceMessageIndex: message.sourceMessageIndex,
                sourceMessageHash: message.sourceMessageHash,
                parserVersion,
            });
            const probableSeedEvidenceRecords = [];
            for (const anchor of structuralMessageIndex.anchors || []) {
                if (!isValidSourcePageSpan(anchor?.attributionSpan, Array.from(String(message.visibleText || '')).length)
                    || !Array.isArray(anchor.utteranceSpans)) continue;
                const attributionText = Array.from(message.visibleText).slice(
                    anchor.attributionSpan.start, anchor.attributionSpan.end,
                ).join('').trim().replace(/[:：]\s*$/u, '').trimEnd();
                const cue = REPLAY_ADDED_DIRECT_SPEECH_CUES.find((candidate) => attributionText.endsWith(candidate));
                if (!cue) continue;
                for (const span of anchor.utteranceSpans) {
                    if (!isValidSourcePageSpan(span, Array.from(String(message.visibleText || '')).length)) continue;
                    const key = `${chatFingerprint}:${message.sourceMessageIndex}:${span.start}:${span.end}`;
                    addedDirectCueUtterances.set(key, cue);
                }
            }
            messageParseDurationsMs.push(performance.now() - messageParseStartedAt);
            for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
                const page = pages[pageIndex];
                const hasProbableSegmenterHint = page?.type === 'dialogue'
                    && page?.speakerConfidence === 'inferred'
                    && page?.confidenceBand === 'probable'
                    && page?.speakerOrigin === 'runtime-text';
                if (hasProbableSegmenterHint) probableSegmenterHints += 1;
                if (!isValidSourcePageSpan(page.sourceSpan, Array.from(String(message.visibleText || '')).length)) {
                    if (hasProbableSegmenterHint) probableHintSpanRejected += 1;
                    const pageText = String(page.sourceText || page.text || '');
                    const row = {
                        chatFingerprint,
                        sourceMessageIndex: message.sourceMessageIndex,
                        sourceMessageHash: message.sourceMessageHash,
                        pageIndex,
                        start: Number.isSafeInteger(page.sourceSpan?.start) ? page.sourceSpan.start : null,
                        end: Number.isSafeInteger(page.sourceSpan?.end) ? page.sourceSpan.end : null,
                        kind: 'unknown',
                        pageKind: 'unaddressable',
                        isDialogueCandidate: false,
                        speakers: [],
                        ruleId: null,
                        scopeStatus,
                    };
                    predictions.push(row);
                    counts.unknown += 1;
                    pageKindCounts.unaddressable += 1;
                    incrementPageKindByBaseType(pageKindByBaseType, page.type, 'unaddressable');
                    accumulateUnknownShapeCounts(unknownShapeCounts, pageText);
                    pagesScanned += 1;
                    unaddressablePages += 1;
                    if (scopeStatus === 'scope-unavailable') scopeUnavailablePages += 1;
                    continue;
                }
                const coreText = Array.from(message.visibleText).slice(page.sourceSpan.start, page.sourceSpan.end).join('');
                const shape = classifyStructuralPageShape({
                    fullText: message.visibleText,
                    pageType: page.type,
                    coreSpan: page.sourceSpan,
                    messageIndex: structuralMessageIndex,
                });
                const parseStartedAt = performance.now();
                const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
                    messageIndex: structuralMessageIndex,
                    fullText: message.visibleText,
                    sourceMessageIndex: message.sourceMessageIndex,
                    sourceMessageHash: message.sourceMessageHash,
                    publishedSpeakerFingerprint: structuralSpeakerFingerprint,
                    parserVersion,
                    coreSpan: page.sourceSpan,
                    pageType: page.type,
                    previousPageSpans: pages.slice(Math.max(0, pageIndex - 2), pageIndex).map((priorPage) => ({
                        sourceSpan: priorPage.sourceSpan,
                        pageType: priorPage.type,
                    })),
                });
                pageParseDurationsMs.push(performance.now() - parseStartedAt);
                const evidenceIsValid = Boolean(evidence && isStructuralReplayEvidenceValid(evidence, message.visibleText, {
                    sourceMessageIndex: message.sourceMessageIndex,
                    sourceMessageHash: message.sourceMessageHash,
                    viewSpan: evidence.viewSpan,
                    coreSpan: page.sourceSpan,
                }));
                const probableHintSpanEvidence = hasProbableSegmenterHint
                    ? await createProbableNarrativeSpeakerTitleEvidence({
                        fullText: message.visibleText,
                        sourceMessageIndex: message.sourceMessageIndex,
                        sourceMessageHash: message.sourceMessageHash,
                        coreSpan: page.sourceSpan,
                        segment: page,
                    }) : null;
                const probableHintEvidence = probableHintSpanEvidence
                    ? await createProbableNarrativeSpeakerTitleEvidence({
                        fullText: message.visibleText,
                        sourceMessageIndex: message.sourceMessageIndex,
                        sourceMessageHash: message.sourceMessageHash,
                        coreSpan: page.sourceSpan,
                        segment: page,
                        messageIndex: structuralMessageIndex,
                    }) : null;
                if (hasProbableSegmenterHint) {
                    if (probableHintSpanEvidence) probableHintSpanValidated += 1;
                    else probableHintSpanRejected += 1;
                    if (probableHintSpanEvidence && !probableHintEvidence) probableHintDecisionBlocked += 1;
                }
                if (evidence) {
                    structuralEvidencePages += 1;
                    if (evidenceIsValid) validStructuralEvidencePages += 1;
                }
                const kind = evidence?.kind === 'speaker' ? 'speaker'
                    : evidence?.kind === 'group' ? 'group'
                        : evidence?.classification === 'narration' ? 'narration' : 'unknown';
                const isDialogueCandidate = shape.kind === 'dialogue-candidate';
                const isAttributedDialogue = isDialogueCandidate && evidenceIsValid
                    && ['speaker', 'group'].includes(evidence?.kind);
                let probableTitle = isDialogueCandidate && !isAttributedDialogue
                    && !['structured-record', 'heading'].includes(shape.kind)
                    ? probableHintEvidence : null;
                let probableTitleRuleId = probableTitle?.ruleId || null;
                if (!probableTitle && isDialogueCandidate && !isAttributedDialogue
                    && !['structured-record', 'heading'].includes(shape.kind)) {
                    probableTitle = createProbableQuoteSpanContinuationTitleEvidence({
                        fullText: message.visibleText,
                        sourceMessageIndex: message.sourceMessageIndex,
                        sourceMessageHash: message.sourceMessageHash,
                        coreSpan: page.sourceSpan,
                        currentPageIndex: pageIndex,
                        unresolvedSpans: structuralMessageIndex.unresolvedDialogueSpans,
                        seedEvidenceRecords: probableSeedEvidenceRecords,
                    });
                    probableTitleRuleId = probableTitle?.ruleId || null;
                    if (probableTitle) {
                        probableQuoteContinuationPages += 1;
                        probableQuoteContinuationSpanLinks += probableTitle.sourceEvidence.continuedQuoteSpans.length;
                    }
                }
                const hasAnonymousIntroductionTitle = evidenceIsValid
                    && ['unknown-self-introduction', 'anonymous-first-appearance'].includes(evidence?.ruleId);
                const isNarratorFallback = evidenceIsValid
                    && typeof evidence?.diagnosticReasonId === 'string'
                    && evidence?.kind === 'classification'
                    && evidence?.classification === 'narration'
                    && evidence?.text === '旁白'
                    && Array.isArray(evidence?.speakers) && evidence.speakers.length === 0;
                const candidateBucket = !isDialogueCandidate ? null
                    : isAttributedDialogue ? 'confirmedAttributed'
                        : hasAnonymousIntroductionTitle ? 'anonymousIntroduction'
                            : isNarratorFallback ? 'narratorFallback'
                                : probableTitle ? 'probableDisplayTitle' : 'unresolvedCandidates';
                let unresolvedNature = null;
                const isNoUniqueNarratorFallback = candidateBucket === 'narratorFallback'
                    && evidence?.diagnosticReasonId === 'no-unique-speaker-evidence';
                if (candidateBucket === 'unresolvedCandidates' || isNoUniqueNarratorFallback) {
                    const natureCounts = isNoUniqueNarratorFallback
                        ? noUniqueNarratorFallbackNatureCounts : unresolvedCandidateNatureCounts;
                    const intersectingQuoteEvidence = (structuralMessageIndex.quoteEvidence || []).filter((quote) => (
                        isValidSourcePageSpan(quote?.quoteSpan, Array.from(String(message.visibleText || '')).length)
                        && quote.quoteSpan.start < page.sourceSpan.end && page.sourceSpan.start < quote.quoteSpan.end
                    ));
                    const intersectingAnchors = (structuralMessageIndex.anchors || []).filter((anchor) => (
                        isValidSourcePageSpan(anchor?.quoteSpan, Array.from(String(message.visibleText || '')).length)
                        && anchor.quoteSpan.start < page.sourceSpan.end && page.sourceSpan.start < anchor.quoteSpan.end
                    ));
                    const unresolvedQuotedSpans = (structuralMessageIndex.unresolvedDialogueSpans || []).filter((span) => (
                        span?.reasonId === 'unattributed-quoted-speech'
                        && span.start < page.sourceSpan.end && page.sourceSpan.start < span.end
                    ));
                    const priorWindowSeeds = probableSeedEvidenceRecords.filter((record) => (
                        Number.isSafeInteger(record.sourcePageIndex)
                        && record.sourcePageIndex >= pageIndex - 2
                        && record.sourcePageIndex < pageIndex
                    ));
                    const matchesPerTarget = unresolvedQuotedSpans.map((span) => priorWindowSeeds.filter(({ evidence }) => {
                            const quote = evidence?.sourceEvidence?.quote;
                            return Number.isSafeInteger(quote?.start) && Number.isSafeInteger(quote?.end)
                                && quote.start < span.end && span.start < quote.end;
                        }));
                    const matchedTargets = matchesPerTarget.filter((matches) => matches.length > 0).length;
                    const hasMatchingPriorQuoteSeed = matchedTargets > 0;
                    const priorQuoteSeedCoverage = !unresolvedQuotedSpans.length ? 'noQuotedSpan'
                        : matchedTargets === 0 ? 'none'
                            : matchedTargets === unresolvedQuotedSpans.length ? 'all' : 'partial';
                    const matchedSpeakerKeys = new Set(matchesPerTarget.flatMap((matches) => matches.map(({ evidence }) => (
                        String(evidence?.sourceEvidence?.speaker?.text || '').normalize('NFKC').trim().toLocaleLowerCase()
                    ))).filter(Boolean));
                    const matchingSeedSpeakers = matchedSpeakerKeys.size === 0 ? 'none'
                        : matchedSpeakerKeys.size === 1 ? 'one' : 'multiple';
                    const firstLine = coreText.split(/\r?\n/u, 1)[0].trimStart();
                    const hasLocalQuoteMarker = /[“”「」『』"｢｣‘’]/u.test(coreText);
                    const hasLineColonShape = /^(?:[\p{L}\p{N}][^:\n]{0,60})[:：]\s*\S/u.test(firstLine);
                    const hasDashLedShape = /^[-—–]\s*\S/u.test(firstLine);
                    const hasSpeechCueLexeme = /(?:说|问|答|喊|道|said|says|asked|asks|replied|replies|answered|answers|shouted|shouts|whispered|whispers|called|calls)/iu.test(coreText);
                    const quoteClosedValues = [...new Set(intersectingQuoteEvidence
                        .map((quote) => quote.closed).filter((value) => typeof value === 'boolean'))];
                    const crossPageOpen = intersectingQuoteEvidence.some((quote) => quote.closed === false
                        && (quote.quoteSpan.start < page.sourceSpan.start || quote.quoteSpan.end > page.sourceSpan.end));
                    const quoteStatus = !intersectingQuoteEvidence.length ? 'noQuotedSpan'
                        : crossPageOpen ? 'crossPageOpen'
                            : quoteClosedValues.length === 1 && quoteClosedValues[0] ? 'closed' : 'openOrUnclear';
                    const candidateEvidenceSource = unresolvedQuotedSpans.length ? 'unresolvedQuoteSpan'
                        : intersectingQuoteEvidence.length ? 'quoteEvidence'
                            : hasLocalQuoteMarker || hasLineColonShape || hasDashLedShape || hasSpeechCueLexeme ? 'localShapeCue'
                                : ['unattributed-dialogue', 'dialogue', 'dialogue-group'].includes(page.type) ? 'basePageTypeOnly'
                                    : 'noObservedMarker';
                    unresolvedNature = {
                        quotedSpanIntersection: unresolvedQuotedSpans.length > 0,
                        quoteLedgerIntersection: intersectingQuoteEvidence.length > 0,
                        quoteDecisionStatuses: [...new Set(intersectingQuoteEvidence.map((quote) => quote.decision?.status || 'missing'))],
                        overlappingAnchors: [...new Set(intersectingAnchors.map((anchor) => (
                            String(anchor?.speakerText || '').normalize('NFKC').trim().toLocaleLowerCase()
                        )).filter(Boolean))],
                        invalidProjectionEvidence: Boolean(evidence && !evidenceIsValid),
                        priorTwoPageSpeakerSeed: priorWindowSeeds.length > 0,
                        matchingPriorQuoteSeed: hasMatchingPriorQuoteSeed,
                        priorQuoteSeedCoverage,
                        matchingSeedSpeakers,
                        quoteStatus,
                        localQuoteMarker: hasLocalQuoteMarker,
                        lineColonShape: hasLineColonShape,
                        dashLedShape: hasDashLedShape,
                        speechCueLexeme: hasSpeechCueLexeme,
                        basePageType: typeof page.type === 'string' ? page.type : 'missing',
                        candidateEvidenceSource,
                    };
                    natureCounts.quotedSpanIntersection[unresolvedNature.quotedSpanIntersection ? 'yes' : 'no'] += 1;
                    natureCounts.quoteLedgerIntersection[unresolvedNature.quoteLedgerIntersection ? 'yes' : 'no'] += 1;
                    natureCounts.invalidProjectionEvidence[unresolvedNature.invalidProjectionEvidence ? 'yes' : 'no'] += 1;
                    natureCounts.priorTwoPageSpeakerSeed[unresolvedNature.priorTwoPageSpeakerSeed ? 'yes' : 'no'] += 1;
                    natureCounts.matchingPriorQuoteSeed[unresolvedNature.matchingPriorQuoteSeed ? 'yes' : 'no'] += 1;
                    natureCounts.priorQuoteSeedCoverage[priorQuoteSeedCoverage] += 1;
                    natureCounts.matchingSeedSpeakers[matchingSeedSpeakers] += 1;
                    natureCounts.quoteStatus[quoteStatus] += 1;
                    natureCounts.localQuoteMarker[hasLocalQuoteMarker ? 'yes' : 'no'] += 1;
                    natureCounts.lineColonShape[hasLineColonShape ? 'yes' : 'no'] += 1;
                    natureCounts.dashLedShape[hasDashLedShape ? 'yes' : 'no'] += 1;
                    natureCounts.speechCueLexeme[hasSpeechCueLexeme ? 'yes' : 'no'] += 1;
                    natureCounts.basePageTypes[unresolvedNature.basePageType] = (
                        natureCounts.basePageTypes[unresolvedNature.basePageType] || 0
                    ) + 1;
                    natureCounts.candidateEvidenceSource[candidateEvidenceSource] += 1;
                    if (isNoUniqueNarratorFallback) {
                        const count = intersectingAnchors.length;
                        natureCounts.overlappingAnchorCount[count === 0 ? 'zero' : count === 1 ? 'one' : 'multiple'] += 1;
                    }
                }
                const pageKind = isAttributedDialogue ? 'attributed-dialogue'
                    : isDialogueCandidate ? 'unattributed-dialogue'
                        : shape.kind;
                if (isDialogueCandidate && !isAttributedDialogue) {
                    for (const span of structuralMessageIndex.unresolvedDialogueSpans || []) {
                        if (span.start >= page.sourceSpan.end || span.end <= page.sourceSpan.start) continue;
                        const key = `${chatFingerprint}:${message.sourceMessageIndex}:${span.start}:${span.end}:${span.reasonId || ''}`;
                        if (!unresolvedSpanPages.has(key)) unresolvedSpanPages.set(key, new Set());
                        unresolvedSpanPages.get(key).add(pageIndex);
                    }
                }
                const row = {
                    chatFingerprint,
                    sourceMessageIndex: message.sourceMessageIndex,
                    sourceMessageHash: message.sourceMessageHash,
                    pageIndex,
                    start: page.sourceSpan.start,
                    end: page.sourceSpan.end,
                    kind,
                    pageKind,
                    isDialogueCandidate,
                    candidateBucket,
                    unresolvedNature,
                    probableDisplayTitle: probableTitle?.text || null,
                    probableTitleRuleId,
                    titleText: (evidenceIsValid ? evidence?.text : null) || probableTitle?.text || null,
                    speakers: (evidenceIsValid ? evidence?.speakers || [] : []).map((speaker) => speaker.text),
                    ruleId: evidenceIsValid && typeof evidence?.ruleId === 'string' ? evidence.ruleId : null,
                    diagnosticReasonId: evidenceIsValid && typeof evidence?.diagnosticReasonId === 'string'
                        ? evidence.diagnosticReasonId
                        : evidence && !evidenceIsValid ? 'invalid-projection-evidence' : null,
                    scopeStatus,
                    candidateScopeStatus: !candidateScopeEntry ? 'unavailable'
                        : candidateScopeEntry.candidateSpeakerNames.length ? 'resource-derived-candidates'
                            : candidateScopeEntry.unavailableSources?.length ? 'adapter-unavailable'
                                : 'adapter-configured-empty',
                    candidateScopeNameCount: candidateNames.length,
                };
                predictions.push(row);
                counts[kind] += 1;
                pageKindCounts[pageKind] += 1;
                incrementPageKindByBaseType(pageKindByBaseType, page.type, pageKind);
                if (isDialogueCandidate) {
                    dialogueCandidatePages += 1;
                    dialogueCandidateBuckets[candidateBucket] += 1;
                    if (isAttributedDialogue) attributedDialoguePages += 1;
                    else unattributedDialogueCandidates += 1;
                }
                if (isNarratorFallback) {
                    const reasonId = evidence.diagnosticReasonId;
                    allPageNarratorFallbackReasonCounts[reasonId] = (
                        allPageNarratorFallbackReasonCounts[reasonId] || 0
                    ) + 1;
                    if (isDialogueCandidate) {
                        candidateFallbackReasonCounts[reasonId] = (
                            candidateFallbackReasonCounts[reasonId] || 0
                        ) + 1;
                    }
                }
                if (scopeStatus === 'scope-unavailable') scopeUnavailablePages += 1;
                if (structuralMessageIndex.unresolvedDialogueSpans.some((span) => (
                    span.start < page.sourceSpan.end && page.sourceSpan.start < span.end
                ))) ambiguousPages += 1;
                if (row.ruleId === 'full-message-structural') fullMessageProjectionPages += 1;
                if (row.ruleId) ruleCounts[row.ruleId] = (ruleCounts[row.ruleId] || 0) + 1;
                if (kind === 'unknown') accumulateUnknownShapeCounts(unknownShapeCounts, coreText);
                if (probableHintEvidence && !isAttributedDialogue
                    && !['structured-record', 'heading'].includes(shape.kind)) {
                    probableSeedEvidenceRecords.push({ sourcePageIndex: pageIndex, coreSpan: page.sourceSpan, evidence: probableHintEvidence });
                }
                pagesScanned += 1;
            }
            messagesScanned += 1;
            messageCountForChat += 1;
        }
        if (namesObservedInChat.size) chatsWithObservedSpeakerNames += 1;
        observedSpeakerNameCount += namesObservedInChat.size;
        const after = await readHistoryChatImpl(absoluteChatPath, { chatsRoot });
        if (after.canonicalPath !== history.canonicalPath || after.sourceDigest !== history.sourceDigest) {
            throw new SpeakerStructureReplayError('CHAT_CHANGED_DURING_REPLAY');
        }
        sourceSetHash.update(chatFingerprint);
        sourceSetHash.update('\0');
        sourceSetHash.update(history.sourceDigest);
        sourceSetHash.update('\0');
        sources.push({ chatFingerprint, sourceDigest: history.sourceDigest, messagesScanned: messageCountForChat });
        if (messagesScanned >= maxMessages) break;
    }

    const scoring = validatedGold
        ? scoreStructuralSpeakerReplay({ predictions, gold: validatedGold })
        : null;
    const candidateFallbackReasonCountTotal = Object.values(candidateFallbackReasonCounts)
        .reduce((sum, count) => sum + count, 0);
    if (candidateFallbackReasonCountTotal !== dialogueCandidateBuckets.narratorFallback) {
        throw new SpeakerStructureReplayError('CANDIDATE_FALLBACK_REASON_COUNT_MISMATCH');
    }
    const unresolvedSpanPageLinks = [...unresolvedSpanPages.values()].reduce((sum, pages) => sum + pages.size, 0);
    const multiPageUnresolvedDialogueSpans = [...unresolvedSpanPages.values()].filter((pages) => pages.size > 1).length;
    return {
        status: chatPaths.length ? (validatedGold ? 'scored' : 'coverage-only') : 'no-chat-files',
        parserVersion,
        chatFilesScanned: sources.length,
        messagesScanned,
        pagesScanned,
        structuralEvidenceKinds: counts,
        pageKindCounts,
        pageKindByBaseType,
        dialogueCandidatePages,
        attributedDialoguePages,
        unattributedDialogueCandidates,
        probableSegmenterHints,
        probableHintSpanValidated,
        probableHintSpanRejected,
        probableHintDecisionBlocked,
        probableQuoteContinuationPages,
        probableQuoteContinuationSpanLinks,
        dialogueCandidateBuckets,
        narratorFallbackPages: dialogueCandidateBuckets.narratorFallback,
        candidateFallbackReasonCounts,
        candidateFallbackReasonCountTotal,
        allPageNarratorFallbackReasonCounts,
        unresolvedCandidateNatureCounts,
        noUniqueNarratorFallbackNatureCounts,
        uniqueUnresolvedDialogueSpans: unresolvedSpanPages.size,
        unresolvedSpanPageLinks,
        multiPageUnresolvedDialogueSpans,
        addedDirectCueAttributedUtterances: addedDirectCueUtterances.size,
        addedDirectSpeechCueCounts: Object.fromEntries(REPLAY_ADDED_DIRECT_SPEECH_CUES.map((cue) => [
            cue, [...addedDirectCueUtterances.values()].filter((value) => value === cue).length,
        ])),
        speakerAccuracy: validatedGold ? 'GOLD_SCORED' : 'INSUFFICIENT_EVIDENCE',
        ruleCounts,
        unknownShapeCounts,
        structuralEvidencePages,
        validStructuralEvidencePages,
        unaddressablePages,
        structuralEvidenceValidity: ratio(validStructuralEvidencePages, structuralEvidencePages),
        pageParseLatencyMs: summarizeLatency(pageParseDurationsMs),
        messageParseLatencyMs: summarizeLatency(messageParseDurationsMs),
        fullMessageProjectionPages,
        ambiguousPages,
        speakerScopeStatus: scopeUnavailableChats ? 'scope-unavailable' : 'available',
        scopeUnavailableChats,
        scopeUnavailablePages,
        candidateScopeStatus: candidateScopeByFingerprint.size ? 'resource-derived-candidates' : 'unavailable',
        candidateScopeChatsWithNoNames: [...candidateScopeByFingerprint.values()]
            .filter((entry) => !entry.candidateSpeakerNames.length).length,
        candidateScopeChats: candidateScopeByFingerprint.size,
        candidateSpeakerNameCount,
        chatsWithObservedSpeakerNames,
        observedSpeakerNameCount,
        sourceUnchanged: true,
        chatWriteback: false,
        externalProviderCalls: 0,
        goldScoring: scoring,
        elapsedMs: Date.now() - startedAt,
        verifiedSourceSetDigest: `sha256:${sourceSetHash.digest('hex')}`,
        predictions,
    };
}

function incrementPageKindByBaseType(counts, baseType, pageKind) {
    const key = typeof baseType === 'string' && baseType.trim() ? baseType : 'missing';
    if (!counts[key]) counts[key] = {};
    counts[key][pageKind] = (counts[key][pageKind] || 0) + 1;
}

function scopeCandidateNames(entry) {
    if (Array.isArray(entry?.candidateSpeakerNames)) return entry.candidateSpeakerNames;
    return [...new Set((entry?.sources || []).flatMap((source) => (source.adapters || [])
        .flatMap((adapter) => (adapter.candidates || []).map(({ name }) => name))))];
}

export async function runStructuralSpeakerReplayCli(args = process.argv.slice(2)) {
    const options = parseCliArgs(args);
    if (options.help) return { status: 'help', usage: 'node frontend/player/tools/speaker-structure-replay.mjs [--chat-root PATH] [--worldbook-root PATH] [--character-root PATH] [--speaker-names-file PATH] [--speaker-scopes-file PATH] [--speaker-candidate-scopes-file PATH [--candidate-adapters-file PATH]] [--build-speaker-candidate-scopes [--candidate-adapters-file PATH] --output PATH] [--gold PATH] [--max-messages N]' };
    const chatPaths = await listHistoryChatFiles(options.chatsRoot);
    if (options.buildSpeakerCandidateScopes) {
        if (!options.outputPath || options.speakerCandidateScopesPath) {
            throw new SpeakerStructureReplayError('CANDIDATE_SCOPE_BUILD_ARGUMENTS_INVALID');
        }
        const candidateAdapters = options.candidateAdaptersPath
            ? JSON.parse(await readFile(options.candidateAdaptersPath, 'utf8')) : null;
        const candidateScopes = await buildSpeakerCandidateScopes({
            chatPaths,
            chatsRoot: options.chatsRoot,
            worldbooksRoot: options.worldbooksRoot,
            charactersRoot: options.charactersRoot,
            candidateAdapters,
        });
        await writeFile(options.outputPath, `${JSON.stringify(candidateScopes, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
        return {
            status: 'speaker-candidate-scopes-built',
            chatFilesScanned: chatPaths.length,
            candidateScopeChats: candidateScopes.entries.length,
            candidateSpeakerNameCount: candidateScopes.entries.reduce((sum, entry) => sum + scopeCandidateNames(entry).length, 0),
            unavailableSourceCount: candidateScopes.entries.reduce((sum, entry) => sum + (entry.unavailableSources?.length || 0), 0),
            schemaVersion: candidateScopes.schemaVersion,
            adapterSchemaVersion: candidateAdapters?.schemaVersion || null,
        };
    }
    if (options.candidateAdaptersPath && !options.speakerCandidateScopesPath) {
        throw new SpeakerStructureReplayError('CANDIDATE_ADAPTERS_REQUIRE_SCOPE_REPLAY');
    }
    const gold = options.goldPath ? JSON.parse(await readFile(options.goldPath, 'utf8')) : null;
    const speakerNames = options.speakerNamesPath ? JSON.parse(await readFile(options.speakerNamesPath, 'utf8')) : [];
    const speakerScopes = options.speakerScopesPath ? JSON.parse(await readFile(options.speakerScopesPath, 'utf8')) : null;
    if (options.speakerCandidateScopesPath) {
        if (gold || speakerNames.length || speakerScopes || options.maxMessages !== Number.POSITIVE_INFINITY) {
            throw new SpeakerStructureReplayError('FIXED_COHORT_COMPARISON_ARGUMENTS_INVALID');
        }
        const speakerCandidateScopes = JSON.parse(await readFile(options.speakerCandidateScopesPath, 'utf8'));
        validateSpeakerCandidateScopes(speakerCandidateScopes);
        const candidateAdapters = options.candidateAdaptersPath
            ? JSON.parse(await readFile(options.candidateAdaptersPath, 'utf8')) : null;
        const needsV1 = speakerCandidateScopes.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION;
        const needsV2 = speakerCandidateScopes.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION;
        if ((needsV1 && candidateAdapters?.schemaVersion !== SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION)
            || (needsV2 && candidateAdapters?.schemaVersion !== SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION)
            || (!needsV1 && !needsV2 && candidateAdapters)) {
            throw new SpeakerStructureReplayError('CANDIDATE_ADAPTERS_UNEXPECTED_FOR_SCOPE_VERSION');
        }
        const sharedOptions = { chatPaths, chatsRoot: options.chatsRoot, worldbooksRoot: options.worldbooksRoot, charactersRoot: options.charactersRoot };
        const baseline = await replayStructuralSpeakerHistory(sharedOptions);
        const candidate = await replayStructuralSpeakerHistory({
            ...sharedOptions,
            speakerCandidateScopes,
            speakerCandidateAdapters: candidateAdapters,
        });
        const fixedCohortComparison = compareFixedSpeakerCandidateCohort({ baseline, candidate });
        const { predictions: baselinePredictions, ...baselineSummary } = baseline;
        const { predictions: candidatePredictions, ...candidateSummary } = candidate;
        return {
            status: 'candidate-cohort-compared',
            baseline: baselineSummary,
            candidate: candidateSummary,
            fixedCohortComparison,
            predictionRowsCompared: baselinePredictions.length,
            candidatePredictionRowsCompared: candidatePredictions.length,
        };
    }
    const result = await replayStructuralSpeakerHistory({
        chatPaths,
        chatsRoot: options.chatsRoot,
        worldbooksRoot: options.worldbooksRoot,
        charactersRoot: options.charactersRoot,
        gold,
        publishedSpeakerNames: speakerNames,
        speakerScopes,
        maxMessages: options.maxMessages,
    });
    const { predictions, ...safeSummary } = result;
    return safeSummary;
}

function parseCliArgs(args) {
    const options = {
        chatsRoot: DEFAULT_CHAT_ROOT,
        worldbooksRoot: DEFAULT_WORLDBOOK_ROOT,
        charactersRoot: DEFAULT_CHARACTER_ROOT,
        goldPath: '',
        outputPath: '',
        speakerNamesPath: '',
        speakerScopesPath: '',
        speakerCandidateScopesPath: '',
        candidateAdaptersPath: '',
        buildSpeakerCandidateScopes: false,
        maxMessages: Number.POSITIVE_INFINITY,
        help: false,
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') options.help = true;
        else if (arg === '--chat-root' && args[index + 1]) options.chatsRoot = path.resolve(args[++index]);
        else if (arg === '--worldbook-root' && args[index + 1]) options.worldbooksRoot = path.resolve(args[++index]);
        else if (arg === '--character-root' && args[index + 1]) options.charactersRoot = path.resolve(args[++index]);
        else if (arg === '--gold' && args[index + 1]) options.goldPath = path.resolve(args[++index]);
        else if (arg === '--output' && args[index + 1]) options.outputPath = path.resolve(args[++index]);
        else if (arg === '--speaker-names-file' && args[index + 1]) options.speakerNamesPath = path.resolve(args[++index]);
        else if (arg === '--speaker-scopes-file' && args[index + 1]) options.speakerScopesPath = path.resolve(args[++index]);
        else if (arg === '--speaker-candidate-scopes-file' && args[index + 1]) options.speakerCandidateScopesPath = path.resolve(args[++index]);
        else if (arg === '--candidate-adapters-file' && args[index + 1]) options.candidateAdaptersPath = path.resolve(args[++index]);
        else if (arg === '--build-speaker-candidate-scopes') options.buildSpeakerCandidateScopes = true;
        else if (arg === '--max-messages' && /^\d+$/u.test(args[index + 1] || '')) options.maxMessages = Number(args[++index]);
        else throw new SpeakerStructureReplayError('CLI_ARGUMENT_INVALID');
    }
    if (!Number.isSafeInteger(options.maxMessages) && options.maxMessages !== Number.POSITIVE_INFINITY) {
        throw new SpeakerStructureReplayError('CLI_ARGUMENT_INVALID');
    }
    if (options.maxMessages <= 0) throw new SpeakerStructureReplayError('CLI_ARGUMENT_INVALID');
    return options;
}

function isExactTitleMatch(goldRow, prediction) {
    if (goldRow.expectedKind !== prediction.kind) return false;
    if (!['speaker', 'group'].includes(goldRow.expectedKind)) return true;
    return goldRow.expectedSpeakers.length === prediction.speakers.length
        && goldRow.expectedSpeakers.every((name) => prediction.speakers.includes(name));
}

function validatePublishedSpeakerNames(names) {
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || !name.trim() || name !== name.trim() || name.length > 80)) {
        throw new SpeakerStructureReplayError('SPEAKER_NAMES_INVALID');
    }
    return [...new Set(names)];
}

function accumulateUnknownShapeCounts(counts, text) {
    const value = String(text ?? '');
    const quotes = Array.from(value).filter((char) => ['“', '”', '「', '」', '『', '』', '"'].includes(char)).length;
    const firstLine = value.split(/\r?\n/u, 1)[0].trimStart();
    const hasSpeechCue = /(?:说|问|答|喊|道|said|says|asked|asks|replied|replies|answered|answers|shouted|shouts|whispered|whispers|called|calls)/iu.test(value);
    if (quotes) counts.quoted += 1;
    if (quotes && hasSpeechCue) counts.quoteAndSpeechCue += 1;
    if (/(?:[”」』"]\s*)(?:[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?:说|问|答|喊|道|说道|问道|答道|回复|回答|\s+(?:said|asked|replied|answered|shouted|whispered|called))/u.test(value)) {
        counts.postQuoteAttributionShape += 1;
    }
    if (/^(?:[\p{L}\p{N}][^:\n]{0,60})[:：]\s*\S/u.test(firstLine)) counts.lineColon += 1;
    if (/^[-—–]\s*\S/u.test(firstLine)) counts.dashLed += 1;
    if (quotes >= 2) counts.multiQuote += 1;
}

function ratio(numerator, denominator) {
    return denominator ? numerator / denominator : null;
}

export function isStructuralReplayEvidenceValid(evidence, sourceText, expected = {}) {
    const chars = Array.from(String(sourceText ?? ''));
    const spans = evidence?.classificationEvidenceSpans;
    const { sourceMessageIndex, sourceMessageHash, coreSpan } = expected;
    const viewSpan = evidence?.viewSpan;
    if (!Array.isArray(spans) || !spans.length || !isRecord(viewSpan) || !isRecord(coreSpan)
        || evidence.sourceMessageIndex !== sourceMessageIndex || evidence.sourceMessageHash !== sourceMessageHash
        || (expected.viewSpan && !sameReplaySpan(evidence.viewSpan, expected.viewSpan)) || !sameReplaySpan(evidence.coreSpan, coreSpan)
        || !Number.isSafeInteger(viewSpan.start) || !Number.isSafeInteger(viewSpan.end)
        || !Number.isSafeInteger(coreSpan.start) || !Number.isSafeInteger(coreSpan.end)
        || viewSpan.start < 0 || viewSpan.end > chars.length || viewSpan.end <= viewSpan.start
        || viewSpan.start > coreSpan.start || viewSpan.end < coreSpan.end
        || coreSpan.start < 0 || coreSpan.end > chars.length || coreSpan.end <= coreSpan.start) return false;
    if (spans.some((span) => !isRecord(span) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
        || span.start < coreSpan.start || span.end > coreSpan.end || span.end <= span.start
        || span.end > chars.length || !chars.slice(span.start, span.end).some((char) => !/\s/u.test(char)))) return false;
    const fallbackReasons = new Set([
        'ambiguous-quote-structure',
        'conflicting-speaker-evidence',
        'open-quote-without-unique-speaker',
        'narrative-shape-with-unattributed-quote',
        'ambiguous-local-reference',
        'no-unique-speaker-evidence',
        'dialogue-shape-without-speaker',
    ]);
    if (evidence.diagnosticReasonId !== undefined
        && (evidence.kind !== 'classification' || evidence.classification !== 'narration'
            || evidence.text !== '旁白' || evidence.ruleId !== 'narrative-framed-quote'
            || !fallbackReasons.has(evidence.diagnosticReasonId))) return false;
    return Array.isArray(evidence.speakers) && evidence.speakers.every((speaker) => (
        isRecord(speaker) && typeof speaker.text === 'string'
        && Number.isSafeInteger(speaker.start) && Number.isSafeInteger(speaker.end)
        && speaker.start >= viewSpan.start && speaker.end > speaker.start && speaker.end <= viewSpan.end
        && chars.slice(speaker.start, speaker.end).join('') === (speaker.sourceText || speaker.text)
    ));
}

function isValidSourcePageSpan(span, sourceLength) {
    return isRecord(span) && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end > span.start && span.end <= sourceLength;
}

function sameReplaySpan(left, right) {
    return isRecord(left) && Number.isSafeInteger(left.start) && Number.isSafeInteger(left.end)
        && left.start === right.start && left.end === right.end;
}

function summarizeLatency(samples) {
    if (!samples.length) return { p50: null, p95: null, max: null };
    const sorted = [...samples].sort((left, right) => left - right);
    const percentile = (value) => sorted[Math.max(0, Math.ceil(value * sorted.length) - 1)];
    return {
        p50: Math.round(percentile(0.5) * 100) / 100,
        p95: Math.round(percentile(0.95) * 100) / 100,
        max: Math.round(sorted.at(-1) * 100) / 100,
    };
}

function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        console.log(JSON.stringify(await runStructuralSpeakerReplayCli()));
    } catch (error) {
        console.error(JSON.stringify({ status: 'failed', code: error?.code || 'REPLAY_FAILED', chatWriteback: false }));
        process.exitCode = 1;
    }
}

