import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, open, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
    HistoryReplayError,
    readHistoryChat,
    resolveContainedHistoryChatPath,
    runPresentationHistoryReplay,
    scoreHistoryReplay,
    selectHistoryReplayTargets,
    validateHistoryGoldSidecar,
} from '../tools/presentation-history-replay.mjs';
import { createVisibleMessageHash } from '../src/presentation-annotation.js';

const temporaryRoot = await mkdtemp(join(tmpdir(), 'galgame-presentation-replay-'));
try {
    const chatsRoot = join(temporaryRoot, 'chats');
    const outsideRoot = join(temporaryRoot, 'outside');
    await mkdir(chatsRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    const visibleText = '😀Mira说：“嗨。”';
    const chatPath = join(chatsRoot, 'selected.jsonl');
    const rows = [
        { character_name: 'private-header', user_name: 'private-user', chat_metadata: { sentinel: 'HEADER_SECRET' } },
        { is_user: false, is_system: false, name: 'message-author-channel', mes: visibleText },
        { is_user: true, is_system: false, name: 'Player', mes: 'PLAYER_SECRET must never be submitted' },
        { is_user: false, is_system: false, name: 'message-author-channel', mes: '' },
        { is_user: false, is_system: true, name: 'System', mes: 'SYSTEM_SECRET must never be submitted' },
    ];
    await writeFile(chatPath, rows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
    const history = await readHistoryChat(chatPath, { chatsRoot });
    assert.equal(history.assistantMessages.length, 1);
    assert.equal(history.assistantMessages[0].sourceMessageIndex, 0);
    assert.equal(history.assistantMessages[0].authorLabel, '');
    assert.equal(history.assistantMessages[0].visibleText, visibleText);
    const dryReport = await runPresentationHistoryReplay({ chatPath, chatsRoot });
    assert.equal(dryReport.status, 'dry-run');
    assert.equal(dryReport.externalAnalysisStarted, false);
    assert.equal(dryReport.chatWriteback, false);
    assert.equal(JSON.stringify(dryReport).includes('SECRET'), false, 'reports never include chat/header/player/system text');

    const outsideChat = join(outsideRoot, 'outside.jsonl');
    await writeFile(outsideChat, JSON.stringify({ is_user: false, is_system: false, mes: 'outside' }), 'utf8');
    await assert.rejects(resolveContainedHistoryChatPath(chatsRoot, outsideChat), { code: 'CHAT_PATH_OUTSIDE_ROOT' });
    await assert.rejects(resolveContainedHistoryChatPath(chatsRoot, join(chatsRoot, '..', 'outside', 'outside.jsonl')), { code: 'CHAT_PATH_OUTSIDE_ROOT' });
    let rejectedOpenCount = 0;
    await assert.rejects(readHistoryChat(outsideChat, {
        chatsRoot,
        openFileImpl: async (...args) => { rejectedOpenCount += 1; return open(...args); },
    }), { code: 'CHAT_PATH_OUTSIDE_ROOT' });
    assert.equal(rejectedOpenCount, 0, 'path checks reject before opening chat content');

    const raceHandle = await open(outsideChat, 'r');
    let raceReadCount = 0;
    await assert.rejects(readHistoryChat(chatPath, {
        chatsRoot,
        openFileImpl: async () => ({
            stat: () => raceHandle.stat(),
            readFile: async (...args) => { raceReadCount += 1; return raceHandle.readFile(...args); },
            close: () => raceHandle.close(),
        }),
    }), { code: 'CHAT_FILE_CHANGED_DURING_OPEN' }, 'an object swapped in between path validation and open is rejected by handle identity');
    assert.equal(raceReadCount, 0, 'a mismatched opened file handle is rejected before reading any bytes');

    const escapeLink = join(chatsRoot, 'escape');
    await symlink(outsideRoot, escapeLink, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveContainedHistoryChatPath(chatsRoot, join(escapeLink, 'outside.jsonl')), { code: 'CHAT_PATH_SYMLINK' });
    const targetFileLink = join(chatsRoot, 'linked-chat.jsonl');
    let fileLinkFs = null;
    try {
        await symlink(chatPath, targetFileLink, 'file');
    } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) throw error;
        fileLinkFs = {
            lstat: async (path) => path === targetFileLink ? { isSymbolicLink: () => true } : lstat(path),
            realpath,
        };
    }
    const resolveFileLink = fileLinkFs
        ? (root, candidate) => resolveContainedHistoryChatPath(root, candidate, fileLinkFs)
        : (root, candidate) => resolveContainedHistoryChatPath(root, candidate);
    await assert.rejects(resolveFileLink(chatsRoot, targetFileLink), { code: 'CHAT_PATH_SYMLINK' },
        'a file symlink inside the permitted chat root is rejected even when it targets another in-root chat');
    let targetFileOpenCount = 0;
    await assert.rejects(readHistoryChat(targetFileLink, {
        chatsRoot,
        resolvePathImpl: resolveFileLink,
        openFileImpl: async (...args) => { targetFileOpenCount += 1; return open(...args); },
    }), { code: 'CHAT_PATH_SYMLINK' });
    assert.equal(targetFileOpenCount, 0, 'an in-root file symlink is rejected before opening chat contents');
    const danglingLink = join(chatsRoot, 'dangling');
    await symlink(join(temporaryRoot, 'missing-directory'), danglingLink, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(resolveContainedHistoryChatPath(chatsRoot, join(danglingLink, 'missing.jsonl')), { code: 'CHAT_PATH_SYMLINK' });
    const linkedChatsRoot = join(temporaryRoot, 'linked-chats-root');
    await symlink(outsideRoot, linkedChatsRoot, process.platform === 'win32' ? 'junction' : 'dir');
    const linkedRootChat = join(linkedChatsRoot, 'outside.jsonl');
    await assert.rejects(resolveContainedHistoryChatPath(linkedChatsRoot, linkedRootChat), { code: 'CHAT_PATH_SYMLINK' },
        'the configured chats root itself cannot redirect reads through a symlink');
    let linkedRootOpenCount = 0;
    await assert.rejects(readHistoryChat(linkedRootChat, {
        chatsRoot: linkedChatsRoot,
        openFileImpl: async (...args) => { linkedRootOpenCount += 1; return open(...args); },
    }), { code: 'CHAT_PATH_SYMLINK' });
    assert.equal(linkedRootOpenCount, 0, 'a symlinked chats root is rejected before opening file contents');

    const codePoints = Array.from(visibleText);
    const entityStart = codePoints.indexOf('M');
    const entityEnd = entityStart + Array.from('Mira').length;
    const quoteEnd = codePoints.length;
    const sourceMessageHash = await createVisibleMessageHash(visibleText);
    const annotation = {
        sourceMessageIndex: 0,
        sourceMessageHash,
        segments: [
            {
                start: 0, end: entityStart,
                textHash: await createVisibleMessageHash(codePoints.slice(0, entityStart).join('')),
                kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceSpans: [],
            },
            {
                start: entityStart, end: quoteEnd,
                textHash: await createVisibleMessageHash(codePoints.slice(entityStart, quoteEnd).join('')),
                kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'text-explicit', confidenceBand: 'high',
                evidenceSpans: [{ start: entityStart, end: entityEnd, purpose: 'speaker' }],
            },
        ],
        entities: [{ mentionRef: 'm0', surfaceSpan: { start: entityStart, end: entityEnd }, kind: 'person', attributeEvidence: [] }],
        identityLinkCandidates: [],
        stateClaims: [],
    };
    const gold = {
        schemaVersion: 'galgame.presentation-history-gold.v1',
        publishedEntityMap: {},
        messages: [{
            sourceMessageIndex: 0,
            sourceMessageHash,
            scriptId: 'synthetic-script',
            segments: [
                { start: 0, end: entityStart, kind: 'narration', speakerEntityKey: null },
                { start: entityStart, end: quoteEnd, kind: 'dialogue', speakerEntityKey: 'mira-key' },
            ],
            entityMentions: [{ start: entityStart, end: entityEnd, entityKey: 'mira-key' }],
    }],
    };
    assert.equal(validateHistoryGoldSidecar(gold), gold);

    const confirmedChatPath = join(chatsRoot, 'confirmed-replay.jsonl');
    const confirmedRows = Array.from({ length: 4 }, (_, index) => ({
        is_user: false, is_system: false, mes: `Synthetic narration ${index}.`,
    }));
    await writeFile(confirmedChatPath, confirmedRows.map((row) => JSON.stringify(row)).join('\n'), 'utf8');
    const confirmedHistory = await readHistoryChat(confirmedChatPath, { chatsRoot });
    const confirmedGold = {
        schemaVersion: 'galgame.presentation-history-gold.v1',
        publishedEntityMap: {},
        messages: await Promise.all(confirmedHistory.assistantMessages.map(async (message) => ({
            sourceMessageIndex: message.sourceMessageIndex,
            sourceMessageHash: message.sourceMessageHash,
            scriptId: 'synthetic-replay',
            segments: [{ start: 0, end: Array.from(message.visibleText).length, kind: 'narration', speakerEntityKey: null }],
            entityMentions: [],
        }))),
    };
    const confirmedGoldPath = join(temporaryRoot, 'gold-sidecar.json');
    await writeFile(confirmedGoldPath, JSON.stringify(confirmedGold), 'utf8');
    let activeProviderCalls = 0;
    let maximumProviderConcurrency = 0;
    const confirmedReplay = await runPresentationHistoryReplay({
        chatPath: confirmedChatPath,
        chatsRoot,
        confirmExternalAnalysis: true,
        goldPath: confirmedGoldPath,
        fetchImpl: async (url, init = {}) => {
            const parsedUrl = new URL(url);
            if (parsedUrl.pathname === '/v1/releases/active') {
                return { ok: true, json: async () => ({
                    scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', manifestUrl: 'http://127.0.0.1:8791/v1/manifest',
                }) };
            }
            if (parsedUrl.pathname === '/v1/manifest') return { ok: true, json: async () => ({ resourceBindings: { characters: {} } }) };
            if (parsedUrl.pathname === '/v1/presentation/health') return { ok: true, json: async () => ({
                serviceReady: true,
                analyzerConfigured: true,
                analyzerScope: 'fake:annotator.v6',
                sceneAnalyzerScope: 'fake:scene.v4',
            }) };
            assert.equal(parsedUrl.pathname, '/v1/presentation/annotations');
            assert.equal(init.headers.origin, 'http://127.0.0.1:8001');
            const request = JSON.parse(init.body);
            const message = request.messages[0];
            activeProviderCalls += 1;
            maximumProviderConcurrency = Math.max(maximumProviderConcurrency, activeProviderCalls);
            await new Promise((resolve) => setTimeout(resolve, 15));
            activeProviderCalls -= 1;
            if (message.sourceMessageIndex === 2) {
                return {
                    ok: false,
                    status: 503,
                    json: async () => ({ schemaVersion: 'galgame.presentation-error.v1', code: 'ANALYZER_UNAVAILABLE', requestId: 'test' }),
                };
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    schemaVersion: 'galgame.presentation-annotation.v1',
                    results: [{
                        sourceMessageIndex: message.sourceMessageIndex,
                        sourceMessageHash: message.sourceMessageHash,
                        segments: [{
                            start: 0,
                            end: Array.from(message.visibleText).length,
                            textHash: message.sourceMessageHash,
                            kind: 'narration',
                            speakerMentionRef: null,
                            speakerSource: 'none',
                            confidenceBand: 'high',
                            evidenceSpans: [],
                        }],
                        entities: [], identityLinkCandidates: [], stateClaims: [],
                    }],
                }),
            };
        },
    });
    assert.equal(confirmedReplay.selectedAssistantMessages, 4);
    assert.equal(confirmedReplay.validAnnotations, 3);
    assert.deepEqual(confirmedReplay.failures, { ANALYZER_UNAVAILABLE: 1 });
    assert.equal(confirmedReplay.scoring.scoredMessages, 4, 'failed model calls remain in the human-gold denominator');
    assert.equal(confirmedReplay.scoring.annotationCoverage, 0.75);
    assert.equal(confirmedReplay.scoring.metrics.spanCoverage.estimate, 0.75);
    assert.equal(confirmedReplay.chatWriteback, false);
    assert.equal(confirmedReplay.sourceUnchanged, true);
    assert.equal(maximumProviderConcurrency, 2, 'historical replay uses the bounded two-request analysis capacity');

    const longHistoryTargets = Array.from({ length: 20 }, (_, sourceMessageIndex) => ({
        ...history.assistantMessages[0], sourceMessageIndex,
    }));
    const selectedGold = {
        ...gold,
        messages: [
            { ...gold.messages[0], sourceMessageIndex: 1, scriptId: 'earlier-script' },
            { ...gold.messages[0], sourceMessageIndex: 18, scriptId: 'later-script' },
        ],
    };
    assert.deepEqual(selectHistoryReplayTargets(longHistoryTargets, selectedGold).map((row) => row.sourceMessageIndex), [1, 18],
        'gold indices select exact historical targets even when they are outside the default latest-12 smoke window');
    const missingGoldTarget = structuredClone(selectedGold);
    missingGoldTarget.messages[0].sourceMessageIndex = 30;
    assert.throws(() => selectHistoryReplayTargets(longHistoryTargets, missingGoldTarget), { code: 'GOLD_TARGET_MISMATCH' },
        'a missing gold target fails before external analysis rather than silently shrinking the evaluation');
    const mismatchedGoldTarget = structuredClone(selectedGold);
    mismatchedGoldTarget.messages[0].sourceMessageHash = `sha256:${'0'.repeat(64)}`;
    assert.throws(() => selectHistoryReplayTargets(longHistoryTargets, mismatchedGoldTarget), { code: 'GOLD_TARGET_MISMATCH' },
        'a changed target hash cannot be scored against stale gold');
    const scored = await scoreHistoryReplay({
        targets: history.assistantMessages,
        annotations: [annotation],
        gold,
        chatKey: 'history-test-scope',
        releaseId: 'release-test',
    });
    assert.equal(scored.metrics.speakerPrecision.estimate, 1);
    assert.equal(scored.metrics.speakerRecall.estimate, 1);
    assert.equal(scored.metrics.speakerPrecision.eligibleScriptCount, 1);
    assert.equal(scored.metrics.speakerPrecision.ciLower, null, 'a single script has no estimable cluster CI');
    assert.equal(scored.metrics.spanCoverage.estimate, 1, 'emoji spans are checked as Unicode code points');

    const secondTarget = { ...history.assistantMessages[0], sourceMessageIndex: 1 };
    const unattributedSegment = {
        start: 0,
        end: codePoints.length,
        kind: 'unattributed-dialogue',
        speakerEntityKey: null,
    };
    const clusterGold = {
        schemaVersion: 'galgame.presentation-history-gold.v1',
        publishedEntityMap: {},
        messages: [
            { ...gold.messages[0], scriptId: 'script-a', segments: [unattributedSegment] },
            { ...gold.messages[0], sourceMessageIndex: 1, scriptId: 'script-b', segments: [unattributedSegment] },
        ],
    };
    const fullHashSegment = async (kind, sourceMessageIndex) => ({
        sourceMessageIndex,
        sourceMessageHash,
        segments: [{
            start: 0,
            end: codePoints.length,
            textHash: await createVisibleMessageHash(visibleText),
            kind,
            speakerMentionRef: null,
            speakerSource: 'none',
            confidenceBand: 'high',
            evidenceSpans: [],
        }],
        entities: [],
        identityLinkCandidates: [],
        stateClaims: [],
    });
    const clusterScored = await scoreHistoryReplay({
        targets: [history.assistantMessages[0], secondTarget],
        annotations: [await fullHashSegment('narration', 0), await fullHashSegment('unattributed-dialogue', 1)],
        gold: clusterGold,
        chatKey: 'history-bootstrap-test',
        releaseId: 'release-test',
    });
    const bootstrapMetric = clusterScored.metrics.dialogueFalseNarrationRate;
    assert.equal(bootstrapMetric.estimate, 0.5);
    assert.equal(bootstrapMetric.eligibleScriptCount, 2);
    assert.equal(bootstrapMetric.ciLower, 0, 'bootstrap must include resamples containing only the zero-error cluster');
    assert.equal(bootstrapMetric.ciUpper, 1, 'bootstrap must include resamples containing only the full-error cluster');

    const wrongGold = structuredClone(gold);
    wrongGold.messages[0].sourceMessageHash = `sha256:${'0'.repeat(64)}`;
    await assert.rejects(scoreHistoryReplay({ targets: history.assistantMessages, annotations: [annotation], gold: wrongGold }), { code: 'GOLD_SOURCE_HASH_MISMATCH' });
    const goldWithBody = structuredClone(gold);
    goldWithBody.messages[0].visibleText = visibleText;
    assert.throws(() => validateHistoryGoldSidecar(goldWithBody), { code: 'GOLD_SCHEMA_INVALID' }, 'gold sidecars reject transcript content');
} finally {
    const resolvedTempRoot = resolve(temporaryRoot);
    assert.equal(dirname(resolvedTempRoot), resolve(tmpdir()), 'test cleanup stays inside its dedicated temporary root');
    await rm(resolvedTempRoot, { recursive: true, force: true });
}

console.log('presentation-history-replay: PASS');
