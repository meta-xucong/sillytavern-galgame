import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createSpeakerChatFingerprint,
    compareFixedSpeakerCandidateCohort,
    listHistoryChatFiles,
    replayStructuralSpeakerHistory,
    runStructuralSpeakerReplayCli,
    scoreStructuralSpeakerReplay,
    isStructuralReplayEvidenceValid,
    validateSpeakerTitleGold,
    validateSpeakerScopes,
} from '../tools/speaker-structure-replay.mjs';
import {
    createStructuralPageTitleEvidence,
    createStructuralPageTitleEvidenceFromMessageIndex,
    createStructuralMessageSpeakerIndex,
    createVisualNovelDisplaySegments,
    formatVisualNovelDisplayText,
} from '../../shared/src/sillytavern-adapter.js';
import { readHistoryChat } from '../../shared/tools/presentation-history-replay.mjs';

const digest = (value) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;

test('structural replay scans deterministically, scores a private gold sidecar, and never calls a provider', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'story.jsonl';
    const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const visibleText = 'Nira说：“准备好了。”';
    const messageHash = digest(visibleText);
    const history = {
        canonicalPath: path.join(chatsRoot, chatPath),
        sourceDigest: digest('source-file-snapshot'),
        assistantMessages: [{ sourceMessageIndex: 4, sourceMessageHash: messageHash, visibleText }],
    };
    const gold = {
        schemaVersion: 'galgame.structural-speaker-title-gold.v1',
        publishedSpeakerNames: [],
        messages: [{
            chatFingerprint,
            sourceMessageIndex: 4,
            sourceMessageHash: messageHash,
            pages: [{ pageIndex: 0, start: 0, end: Array.from(visibleText).length, expectedKind: 'speaker', expectedSpeakers: ['Nira'] }],
        }],
    };
    let reads = 0;
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        gold,
        readHistoryChatImpl: async () => { reads += 1; return history; },
    });

    assert.equal(reads, 2, 'the source snapshot is checked again after replay');
    assert.equal(result.status, 'scored');
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.messagesScanned, 1);
    assert.equal(result.pagesScanned, 1);
    assert.equal(result.predictions[0].kind, 'speaker');
    assert.deepEqual(result.predictions[0].speakers, ['Nira']);
    assert.equal(result.structuralEvidencePages, 1);
    assert.equal(result.validStructuralEvidencePages, 1);
    assert.equal(result.structuralEvidenceValidity, 1);
    assert.equal(typeof result.pageParseLatencyMs.p50, 'number');
    assert.equal(typeof result.pageParseLatencyMs.p95, 'number');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.goldScoring.speakerTitlePrecision, 1);
    assert.equal(result.goldScoring.speakerTitleRecall, 1);
    assert.equal(result.goldScoring.exactTitleAccuracy, 1);
    assert.equal(JSON.stringify({ ...result, predictions: undefined }).includes(visibleText), false,
        'aggregate evidence does not include source transcript text');
});

test('v30 replay attributes bounded explicit cues and player vocalizations while filtering source text', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'v30-bounded-cues.jsonl';
    const visibleTexts = [
        'Pippa骂了一句脏话，拽住你的背包带往外拖；尼布在门口尖叫：“出来！出来！”',
        'Pippa翻开账本，记录上写着：“黑喙收账，欠债还肉。”',
        '“冲啊！”你怒吼一声，握紧巨剑冲进烟雾。',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 80,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v30-bounded-cues-source'),
            assistantMessages,
        }),
    });

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    const byMessage = (sourceMessageIndex) => result.predictions.filter((row) => row.sourceMessageIndex === sourceMessageIndex);
    assert.ok(byMessage(80).some((row) => row.kind === 'speaker' && row.speakers.includes('尼布')),
        'a unique unrostered character subject with an explicit speech cue is replay-attributed');
    assert.ok(byMessage(81).every((row) => row.kind === 'narration' && row.speakers.length === 0),
        'source-frame text remains narration even when a rostered character precedes it');
    assert.ok(byMessage(82).some((row) => row.kind === 'speaker' && row.speakers.includes('你')),
        'a post-quote player vocalization provides direct speaker evidence');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v75 replay strips a leading discourse connective before a rostered speaker cue', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'v75-connective-cue.jsonl';
    const visibleText = 'Celestia转向门口。随后尼布低声说：“快走。”';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['Celestia', '尼布'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v75-connective-cue-source'),
            assistantMessages: [{ sourceMessageIndex: 750, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.ok(result.predictions.some((row) => row.sourceMessageIndex === 750
        && row.kind === 'speaker' && row.speakers.includes('尼布')));
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v31 replay projects reported first utterances and unique action turns onto addressable pages', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'v31-reported-and-action-turns.jsonl';
    const visibleTexts = [
        '尼布的第一句话是：“我还活着？”',
        '醒来后，尼布说的第一句话是：“我们出发。”',
        '维克多转身，走到门口：“他们到了。”',
        '维克多转身，尼布也走到门口：“他们到了。”',
        '账本上的第一句话是：“黑喙收账。”',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 90,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v31-reported-and-action-turns-source'),
            assistantMessages,
        }),
    });
    const byMessage = (sourceMessageIndex) => result.predictions.filter((row) => row.sourceMessageIndex === sourceMessageIndex);

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.ok(byMessage(90).some((row) => row.kind === 'speaker' && row.speakers.includes('尼布')),
        'the first-utterance construction creates a title on its existing addressable page');
    assert.ok(byMessage(91).some((row) => row.kind === 'speaker' && row.speakers.includes('尼布')),
        'a temporal lead-in does not displace the explicitly named first-utterance subject');
    assert.ok(byMessage(92).some((row) => row.kind === 'speaker' && row.speakers.includes('维克多')),
        'a unique named actor can carry through bounded action clauses into a colon quote');
    assert.ok(!byMessage(93).some((row) => row.kind === 'speaker' && row.speakers.includes('维克多')),
        'a competing named action subject prevents single-speaker attribution');
    assert.ok(!byMessage(94).some((row) => row.kind === 'speaker'),
        'a record source first sentence is not attributed to a character');
    assert.equal(result.unaddressablePages, 0);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('page-kind replay uses exclusive categories and a dialogue-only candidate denominator', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = [
        'Pippa说：“我来处理。”',
        '“有人在外面。”',
        'HP: 12\nAC: 16',
        '# 神罚仪式',
        '普通叙述继续向前。',
    ].join('\n\n');
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['shape-mix.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'shape-mix.jsonl'),
            sourceDigest: digest('shape-mix-source'),
            assistantMessages: [{ sourceMessageIndex: 8, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.pagesScanned, result.predictions.length);
    assert.equal(result.dialogueCandidatePages, 2);
    assert.equal(result.attributedDialoguePages, 1);
    assert.equal(result.unattributedDialogueCandidates, 1);
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 1, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 1, unresolvedCandidates: 0,
    });
    assert.equal(result.pageKindCounts['attributed-dialogue'], 1);
    assert.equal(result.pageKindCounts['unattributed-dialogue'], 1);
    assert.equal(result.pageKindCounts['structured-record'], 1);
    assert.equal(result.pageKindCounts.heading, 0, 'a Markdown heading after prior story text is not a progression title');
    assert.equal(result.pageKindCounts.narrative, 2);
    assert.equal(Object.values(result.pageKindCounts).reduce((sum, count) => sum + count, 0), result.pagesScanned,
        'exclusive page-kind counts cover each addressable page once');
    assert.equal(result.speakerAccuracy, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.predictions.find((row) => row.pageKind === 'structured-record').kind, 'narration');
    const fallback = result.predictions.find((row) => row.candidateBucket === 'narratorFallback');
    assert.equal(fallback?.titleText, '旁白');
    assert.equal(fallback?.kind, 'narration');
    assert.equal(fallback?.diagnosticReasonId, 'no-unique-speaker-evidence');
    assert.deepEqual(fallback?.speakers, [], 'a narrator fallback does not create an attributed speaker');
    assert.equal(result.unresolvedCandidateNatureCounts.quotedSpanIntersection.yes, 0,
        'narrator fallback pages remain outside the unresolved-candidate bucket');
    assert.equal(result.noUniqueNarratorFallbackNatureCounts.quotedSpanIntersection.yes, 1,
        'no-unique narrator fallback pages receive quote-span diagnostics');
    assert.equal(result.noUniqueNarratorFallbackNatureCounts.basePageTypes['unattributed-dialogue'], 1,
        'fallback diagnostics preserve the production page type');
    assert.equal(result.noUniqueNarratorFallbackNatureCounts.overlappingAnchorCount.zero, 1,
        'fallback diagnostics distinguish pages with no overlapping speaker anchor');
    assert.equal(result.candidateFallbackReasonCountTotal, result.dialogueCandidateBuckets.narratorFallback);
    assert.deepEqual(result.candidateFallbackReasonCounts, {
        'narrative-shape-with-unattributed-quote': 0,
        'no-unique-speaker-evidence': 1,
        'conflicting-speaker-evidence': 0,
        'ambiguous-local-reference': 0,
        'ambiguous-quote-structure': 0,
        'open-quote-without-unique-speaker': 0,
        'dialogue-shape-without-speaker': 0,
    });
    assert.equal(result.chatWriteback, false);
});

test('self-introduction is reported as an anonymous title, not a genuinely unresolved speaker', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '“别砍我！我叫尼布，不是格里布那种没文化的肉馅候选人。”';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['anonymous-introduction.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'anonymous-introduction.jsonl'),
            sourceDigest: digest('anonymous-introduction-source'),
            assistantMessages: [{ sourceMessageIndex: 22, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 0, anonymousIntroduction: 1, probableDisplayTitle: 0, narratorFallback: 0, unresolvedCandidates: 0,
    });
    assert.equal(result.predictions[0].ruleId, 'unknown-self-introduction');
    assert.equal(result.predictions[0].kind, 'unknown', 'the speaker has no identity until the introduction is resolved');
});

test('v66 sends an unclosed quote without a unique speaker to narrator fallback, not unresolved', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '“门外有人';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['open-quote.jsonl'], chatsRoot, parserVersion: 'full-message-speaker-index.v66',
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'open-quote.jsonl'),
            sourceDigest: digest('open-quote-source'),
            assistantMessages: [{ sourceMessageIndex: 8, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(result.dialogueCandidatePages, 1);
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 0, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 1, unresolvedCandidates: 0,
    });
    assert.equal(result.predictions[0].titleText, '旁白');
    assert.equal(result.predictions[0].ruleId, 'narrative-framed-quote');
    assert.equal(result.predictions[0].diagnosticReasonId, 'open-quote-without-unique-speaker');
    assert.deepEqual(result.predictions[0].speakers, []);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v37 incorporates the six latest user labels without inventing persistent speaker identities', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v37.jsonl';
    const visibleTexts = [
        '树影间，一个矮小身影晃了一下。对方没有立刻攻击，只用尖细的声音说：“哎哟哟，把格里布切得这么对称？”',
        '远处旧磨坊忽然传来一声爆响。随后有人大喊：“抓住那个小疯子！”',
        '皮袋里有一撮白色粉末，尼布闻了一下，立刻打了个喷嚏。\n\n“黑喙提神粉。能让人一小时不困。”',
        '尼布刚说完，林子更深处传来一声低沉号角。不是很威武，但效果很明确：他脸色瞬间惨白。\n\n“糟了，巡林的黑喙打手来了……”他说着后退半步，“你要去旧磨坊，就快点。”',
        '克罗恩的回合：瘦竹竿男看见你倒地濒死，发出一阵像指甲刮黑板的愉悦笑声：“这么快就倒下了？”',
        'A small goblin pops out from behind the barrels, shouting: “Oi, ye daft bugger!”',
        'Pippa被守卫推倒。有人整理了Pippa的背包，点头。“没东西。”',
        '尼布走到门边。有人从后面推了尼布一下，皱眉。“快走。”',
        '尼布看向Pippa。她低声说：“我不同意。”',
        'Pippa递给尼布一瓶药。他说：“我不喝。”',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 140,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['尼布', 'Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v37-source'),
            assistantMessages,
        }),
    });
    const byMessage = (index) => result.predictions.filter((row) => row.sourceMessageIndex === index + 140);

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (const index of [0, 1, 5]) {
        assert.ok(byMessage(index).some((row) => row.kind === 'unknown'
            && row.ruleId === 'anonymous-first-appearance'), `sample ${index + 1} uses the neutral anonymous title: ${JSON.stringify(byMessage(index))}`);
    }
    assert.ok(byMessage(2).some((row) => row.kind === 'speaker' && row.speakers.includes('尼布')),
        `a unique character action immediately before a standalone quote anchors the quote to that character: ${JSON.stringify(byMessage(2))}`);
    assert.ok(byMessage(3).some((row) => row.kind === 'speaker' && row.speakers.includes('尼布')),
        'nearby action and pronoun continuation preserve the same speaker over adjacent quotes');
    assert.ok(byMessage(4).some((row) => row.kind === 'speaker' && row.speakers.includes('瘦竹竿男')),
        `a role name before an observable laughing action outranks an earlier turn header: ${JSON.stringify(byMessage(4))}`);
    assert.ok(byMessage(6).every((row) => row.kind !== 'speaker'),
        'a character mentioned as a passive object or possessor is not assigned the later speaker turn');
    assert.ok(byMessage(7).every((row) => row.kind !== 'speaker'),
        'another anonymous actor in the action clause prevents inheriting the named object as speaker');
    assert.ok(byMessage(8).every((row) => row.kind !== 'speaker'),
        'a second rostered person in the same antecedent sentence keeps gendered pronoun resolution ambiguous');
    assert.ok(byMessage(9).every((row) => row.kind !== 'speaker'),
        'a second rostered person mentioned in the antecedent sentence blocks a potentially reversed pronoun guess');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v37 replays addressable user labels and keeps all six anchors in adapter tests', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v37.jsonl';
    const visibleTexts = [
        '工会长格雷森已经在大厅等候，他看到你们到来，立刻恭敬地行礼：“龙魂守护者，龙裔冒险者公会……你们的功绩已经得到认可。”',
        '铁拳公会的会长——一个身高两米的壮汉“铁臂”卡尔——走出来：“龙裔公会？S级的新晋传奇公会，也来抢龙巢宝藏？”',
        '铁拳公会的卡尔惊叹：“真的……只有龙魂之力能打开……”',
        '铁拳公会的卡尔大喊：“准备战斗！”',
        '亚龙的动作停顿，竖瞳凝视着你：“龙魂……守护者？金龙长老……那位牺牲封印灰境领主的英雄……”它的语气稍微缓和：“但……其他人类……是窃贼……”它看向铁拳和暗影之刃公会：“人类……你们想要宝藏……”',
        '“远亲？”你一愣。',
    ];
    const expectedSpeakers = ['格雷森', '“铁臂”卡尔', '卡尔', '卡尔', '亚龙', '你'];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 880,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v37-source'),
            assistantMessages,
        }),
    });

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    // Sample 2's nickname/name span crosses the formatter page boundary;
    // sample 5's final page span exceeds the source length. The parser anchors
    // for both are asserted in the adapter suite; replay assertions here use
    // only page spans addressable under the unchanged production segmenter.
    for (const index of [0, 2, 3, 5]) {
        const pages = result.predictions.filter((row) => row.sourceMessageIndex === index + 880);
        assert.ok(pages.length > 0, `sample ${index + 1} was replayed`);
        assert.ok(pages.some((row) => row.kind === 'speaker' && row.speakers.includes(expectedSpeakers[index])),
            `sample ${index + 1} has an addressable page displaying ${expectedSpeakers[index]}: ${JSON.stringify(pages.map(({ kind, speakers }) => ({ kind, speakers })))}`);
        assert.ok(pages.every((row) => row.kind !== 'speaker' || row.speakers.includes(expectedSpeakers[index])),
            `sample ${index + 1} does not assign a competing speaker: ${JSON.stringify(pages.map(({ kind, speakers }) => ({ kind, speakers })))}`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('replay reuses repeated explicit names only inside one chat and leaves production page spans unchanged', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleTexts = [
        'Pippa说：“我看到线索了。”',
        'Pippa回答：“在账本里。”',
        'Pippa翻开账本：“这里有线索。”',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 20,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['observed-roster.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'observed-roster.jsonl'),
            sourceDigest: digest('observed-roster-source'),
            assistantMessages,
        }),
    });
    const productionSpans = visibleTexts.flatMap((visibleText) => createVisualNovelDisplaySegments(visibleText, {
        role: 'character',
        knownSpeakers: [],
    }).map(({ sourceSpan }) => sourceSpan));

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.chatsWithObservedSpeakerNames, 1);
    assert.equal(result.observedSpeakerNameCount, 1);
    assert.equal(result.predictions[2].kind, 'speaker');
    assert.deepEqual(result.predictions[2].speakers, ['Pippa']);
    assert.equal(result.predictions[2].scopeStatus, 'scope-unavailable',
        'observed same-chat names are evidence for display, not a published scenario roster');
    assert.deepEqual(result.predictions.map(({ start, end }) => ({ start, end })),
        productionSpans.map((span) => ({ start: span.start, end: span.end })),
        'observed names never enter the production segmenter or change page spans');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('replay never lets future assistant messages establish an earlier speaker title', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleTexts = [
        '她翻开账本：“这里有线索。”',
        'Pippa说：“先看这里。”',
        'Pippa回答：“我明白了。”',
        'Pippa翻开账本：“这是后续线索。”',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 30,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['future-anchor.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'future-anchor.jsonl'),
            sourceDigest: digest('future-anchor-source'),
            assistantMessages,
        }),
    });

    assert.equal(result.predictions[0].kind, 'narration');
    assert.deepEqual(result.predictions[0].speakers, []);
    assert.equal(result.predictions[3].kind, 'speaker');
    assert.deepEqual(result.predictions[3].speakers, ['Pippa']);
});

test('user-calibrated anonymous appearance and homepage heading rules replay without false speaker assignment', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v13.jsonl';
    const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const samples = [
        {
            sourceMessageIndex: 31,
            visibleText: '你问玛赫拉旧丧钟井的具体位置。玛赫拉把骨杖往地上一点，她从墙上的旧镇图指出位置：“旧丧钟井在钟楼后街下面……”',
            expectedKind: 'narration', expectedPageKind: 'narrative',
        },
        {
            sourceMessageIndex: 32,
            visibleText: '树影间，一个矮小身影缓缓走出。对方没有立刻攻击，只用尖细的声音说：“哎哟哟……”',
            expectedKind: 'unknown', expectedPageKind: 'narrative',
        },
        {
            sourceMessageIndex: 33,
            visibleText: '治疗与审问：格雷戈的情报', expectedKind: 'unknown', expectedPageKind: 'heading',
        },
    ].map((sample) => ({ ...sample, sourceMessageHash: digest(sample.visibleText) }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot, publishedSpeakerNames: ['玛赫拉'],
        gold: {
            schemaVersion: 'galgame.structural-speaker-title-gold.v1', publishedSpeakerNames: ['玛赫拉'],
            messages: samples.map((sample) => ({
                chatFingerprint, sourceMessageIndex: sample.sourceMessageIndex, sourceMessageHash: sample.sourceMessageHash,
                pages: [{ pageIndex: 0, start: 0, end: Array.from(sample.visibleText).length,
                    expectedKind: sample.expectedKind, expectedSpeakers: [] }],
            })),
        },
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath), sourceDigest: digest('user-calibration-v13-snapshot'),
            assistantMessages: samples.map(({ sourceMessageIndex, sourceMessageHash, visibleText }) => ({
                sourceMessageIndex, sourceMessageHash, visibleText,
            })),
        }),
    });

    assert.equal(result.status, 'scored');
    assert.deepEqual(result.predictions.map(({ kind, pageKind, speakers }) => ({ kind, pageKind, speakers })), [
        { kind: 'narration', pageKind: 'narrative', speakers: [] },
        { kind: 'unknown', pageKind: 'narrative', speakers: [] },
        { kind: 'unknown', pageKind: 'heading', speakers: [] },
    ]);
    assert.equal(result.goldScoring.exactTitleAccuracy, 1);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('strong local subject and quote evidence outranks a weaker probable segmenter hint', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '约翰立刻反对：“这里禁止通行。”';
    const sourceMessageHash = digest(visibleText);
    const base = createVisualNovelDisplaySegments(visibleText, {
        role: 'character', knownSpeakers: ['Pippa'],
    })[0];
    assert.equal(base.type, 'dialogue');
    assert.equal(base.speakerConfidence, 'inferred');
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['probable.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'probable.jsonl'),
            sourceDigest: digest('probable-source'),
            assistantMessages: [{ sourceMessageIndex: 15, sourceMessageHash, visibleText }],
        }),
    });
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 1, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 0, unresolvedCandidates: 0,
    });
    assert.equal(result.dialogueCandidatePages, 1);
    assert.equal(result.probableSegmenterHints, 1);
    assert.equal(result.probableHintSpanValidated, 1);
    assert.equal(result.probableHintSpanRejected, 0);
    assert.equal(result.probableHintDecisionBlocked, 1);
    assert.equal(result.predictions[0].probableDisplayTitle, null, 'the validated but weaker segmenter hint is suppressed by structural attribution');
    assert.equal(result.predictions[0].titleText, '约翰', 'a unique name + action + colon quote is the stronger title evidence');
    assert.equal(result.predictions[0].ruleId, 'unrostered-subject-colon-quote');
    assert.equal(result.speakerAccuracy, 'INSUFFICIENT_EVIDENCE');
});

test('structural name/action/quote evidence applies to repeated exact source spans in one message', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const paragraph = '约翰立刻反对：“这里禁止通行。”';
    const visibleText = `${paragraph}\n\n${paragraph}`;
    const pages = createVisualNovelDisplaySegments(visibleText, { role: 'character', knownSpeakers: ['Pippa'] });
    assert.equal(pages.length, 2);
    assert.ok(pages.every((page) => page.speakerConfidence === 'inferred'));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['repeated-probable.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'repeated-probable.jsonl'),
            sourceDigest: digest('repeated-probable-source'),
            assistantMessages: [{ sourceMessageIndex: 16, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(result.dialogueCandidatePages, 2);
    assert.equal(result.probableSegmenterHints, 2);
    assert.equal(result.probableHintSpanValidated, 2);
    assert.equal(result.probableHintSpanRejected, 0);
    assert.equal(result.probableHintDecisionBlocked, 2);
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 2, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 0, unresolvedCandidates: 0,
    });
    assert.deepEqual(result.predictions.map((row) => row.probableDisplayTitle), [null, null]);
    assert.deepEqual(result.predictions.map((row) => row.titleText), ['约翰', '约翰']);
    assert.equal(result.speakerAccuracy, 'INSUFFICIENT_EVIDENCE');
});

test('known-name numeric record stays out of the dialogue denominator despite a dialogue base type', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Pippa：-67 + 17 = -50 HP，仍然濒死！';
    const basePage = createVisualNovelDisplaySegments(visibleText, {
        role: 'character', knownSpeakers: ['Pippa'],
    })[0];
    assert.equal(basePage.type, 'dialogue');

    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['numeric-record.jsonl'], chatsRoot, publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'numeric-record.jsonl'),
            sourceDigest: digest('numeric-record-source'),
            assistantMessages: [{ sourceMessageIndex: 9, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(result.pagesScanned, 1);
    assert.equal(result.dialogueCandidatePages, 0);
    assert.equal(result.attributedDialoguePages, 0);
    assert.equal(result.unattributedDialogueCandidates, 0);
    assert.equal(result.pageKindCounts['structured-record'], 1);
    assert.equal(result.predictions[0].pageKind, 'structured-record');
    assert.deepEqual(result.predictions[0].speakers, []);
    assert.equal(result.predictions[0].ruleId, 'structural-record-shape');
});

test('unrostered System metadata is excluded while an exact rostered System line stays dialogue', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const metadataLines = ['System: “Encounter begins.”', 'SYSTEM: “Encounter begins.”'];
    const metadataResult = await replayStructuralSpeakerHistory({
        chatPaths: ['system-metadata.jsonl'], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'system-metadata.jsonl'),
            sourceDigest: digest(metadataLines.join('\n')),
            assistantMessages: metadataLines.map((visibleText, sourceMessageIndex) => ({
                sourceMessageIndex, sourceMessageHash: digest(visibleText), visibleText,
            })),
        }),
    });
    assert.equal(metadataResult.dialogueCandidatePages, 0);
    assert.equal(metadataResult.pageKindCounts['structured-record'], 2);
    assert.deepEqual(metadataResult.dialogueCandidateBuckets, {
        confirmedAttributed: 0, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 0, unresolvedCandidates: 0,
    });

    const explicitCharacterText = 'System: “The gate is open.”';
    const rosteredResult = await replayStructuralSpeakerHistory({
        chatPaths: ['rostered-system.jsonl'], chatsRoot, publishedSpeakerNames: ['System'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'rostered-system.jsonl'),
            sourceDigest: digest(explicitCharacterText),
            assistantMessages: [{ sourceMessageIndex: 0, sourceMessageHash: digest(explicitCharacterText), visibleText: explicitCharacterText }],
        }),
    });
    assert.equal(rosteredResult.dialogueCandidatePages, 1);
    assert.equal(rosteredResult.attributedDialoguePages, 1);
    assert.deepEqual(rosteredResult.predictions[0].speakers, ['System']);
});

test('published speaker names are consumed as exact structural labels during replay', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Lady Veyra： “我来处理。”';
    const messageHash = digest(visibleText);
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Lady Veyra'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('source-file-snapshot'),
            assistantMessages: [{ sourceMessageIndex: 6, sourceMessageHash: messageHash, visibleText }],
        }),
    });

    assert.equal(result.structuralEvidenceKinds.speaker, 1);
    assert.deepEqual(result.predictions[0].speakers, ['Lady Veyra']);
    assert.equal(result.externalProviderCalls, 0);
});

test('replay reports recoveries from the newly supported direct speech cues', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Nira补充：“我听见了。”';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Nira'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('new-direct-cue-snapshot'),
            assistantMessages: [{ sourceMessageIndex: 7, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(result.addedDirectCueAttributedUtterances, 1);
    assert.equal(result.addedDirectSpeechCueCounts['补充'], 1);
    assert.equal(result.predictions[0].kind, 'speaker');
    assert.deepEqual(result.predictions[0].speakers, ['Nira']);
});

test('one full-message index projects a directly attributed quote onto each original page span', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Lila说：“先等我\n\n听见脚步声了，然后我们再进去。”';
    const originalPages = createVisualNovelDisplaySegments(visibleText, { role: 'character' });
    const messageHash = digest(visibleText);
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('split-quote-snapshot'),
            assistantMessages: [{ sourceMessageIndex: 15, sourceMessageHash: messageHash, visibleText }],
        }),
    });
    assert.equal(originalPages.length, 2, 'fixture crosses the production source segmenter page boundary');
    assert.equal(result.pagesScanned, originalPages.length, 'replay uses the production segmenter count');
    assert.equal(result.predictions[0].kind, 'speaker');
    assert.equal(result.predictions[1].kind, 'speaker', 'the continuation page uses the same directly attributed full-message quote');
    assert.equal(result.dialogueCandidatePages, 2, 'every page intersecting the indexed utterance enters the candidate denominator');
    assert.equal(result.attributedDialoguePages, 2);
    assert.equal(result.unattributedDialogueCandidates, 0);
    assert.deepEqual(result.predictions[0].speakers, ['Lila']);
    assert.deepEqual(result.predictions.map((row) => ({ start: row.start, end: row.end })),
        originalPages.map((page) => page.sourceSpan));
    assert.equal(result.predictions[1].ruleId, 'full-message-structural');
    assert.equal(result.fullMessageProjectionPages, 1);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.chatWriteback, false);
});

test('full-message unattributed quote overlaps keep marker-free continuation pages in replay denominator', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '“先等我\n\n听见脚步声了，然后我们再进去。”';
    const originalPages = createVisualNovelDisplaySegments(visibleText, { role: 'character' });
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('unattributed-split-quote-snapshot'),
            assistantMessages: [{ sourceMessageIndex: 16, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(originalPages.length, 2, 'fixture crosses the production source segmenter page boundary');
    assert.equal(originalPages[1].type, 'narration', 'continuation core has no local quote marker and base type is narration');
    assert.equal(result.dialogueCandidatePages, 2);
    assert.equal(result.attributedDialoguePages, 0);
    assert.equal(result.unattributedDialogueCandidates, 2);
    assert.equal(result.uniqueUnresolvedDialogueSpans, 1, 'one source utterance is counted once even when it spans two pages');
    assert.equal(result.unresolvedSpanPageLinks, 2, 'page-level impact remains visible separately');
    assert.equal(result.multiPageUnresolvedDialogueSpans, 1, 'the replay reports the continuation inflation explicitly');
    assert.deepEqual(result.predictions.map((row) => row.pageKind), ['unattributed-dialogue', 'unattributed-dialogue']);
    assert.deepEqual(result.predictions.map((row) => row.speakers), [[], []]);
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 0, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 2, unresolvedCandidates: 0,
    });
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.chatWriteback, false);
});

test('same exact quote span carries the structural speaker title to a marker-free continuation page', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Mira立刻反对：“第一句继续\n\n第二句结束。”';
    const pages = createVisualNovelDisplaySegments(visibleText, { role: 'character' });
    assert.equal(pages.length, 2);
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['probable-quote-continuation.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'probable-quote-continuation.jsonl'),
            sourceDigest: digest('probable-quote-continuation-source'),
            assistantMessages: [{ sourceMessageIndex: 21, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(result.probableQuoteContinuationPages, 0);
    assert.equal(result.probableQuoteContinuationSpanLinks, 0);
    assert.deepEqual(result.dialogueCandidateBuckets, {
        confirmedAttributed: 2, anonymousIntroduction: 0, probableDisplayTitle: 0, narratorFallback: 0, unresolvedCandidates: 0,
    });
    assert.deepEqual(result.predictions.map((row) => row.titleText), ['Mira', 'Mira']);
    assert.deepEqual(result.predictions.map((row) => row.speakers), [['Mira'], ['Mira']],
        'the one quote-level source attribution projects across its existing pages');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('a source-level quote attribution stays bound to all existing pages of that exact quote', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Mira立刻反对：“第一屏继续\n\n第二屏仍未署名\n\n第三屏仍未署名\n\n第四屏结束。”';
    const pages = createVisualNovelDisplaySegments(visibleText, { role: 'character' });
    assert.equal(pages.length, 4);
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['two-page-window.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'two-page-window.jsonl'),
            sourceDigest: digest('two-page-window-source'),
            assistantMessages: [{ sourceMessageIndex: 31, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.deepEqual(result.predictions.map((row) => row.titleText), ['Mira', 'Mira', 'Mira', 'Mira']);
    assert.deepEqual(result.predictions.map((row) => row.speakers), [['Mira'], ['Mira'], ['Mira'], ['Mira']]);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('multi-chat replay requires per-chat speaker scopes and never applies one global roster to all chats', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const paths = ['one.jsonl', 'two.jsonl'];
    const fingerprints = paths.map((item) => createSpeakerChatFingerprint(chatsRoot, item));
    const histories = new Map(paths.map((item) => [item, {
        canonicalPath: path.join(chatsRoot, item),
        sourceDigest: digest(`source-${item}`),
        assistantMessages: [{ sourceMessageIndex: 2, sourceMessageHash: digest('Nira: 正文。'), visibleText: 'Nira: 正文。' }],
    }]));
    const scopes = {
        schemaVersion: 'galgame.speaker-scopes.v1',
        entries: [
            { chatFingerprint: fingerprints[0], releaseVersion: 'release-a', publishedSpeakerNames: ['Nira'] },
            { chatFingerprint: fingerprints[1], releaseVersion: 'release-b', publishedSpeakerNames: ['Other'] },
        ],
    };
    assert.equal(validateSpeakerScopes(scopes), scopes);
    const scoped = await replayStructuralSpeakerHistory({
        chatPaths: paths, chatsRoot, speakerScopes: scopes,
        readHistoryChatImpl: async (absolutePath) => histories.get(path.basename(absolutePath)),
    });
    assert.deepEqual(scoped.predictions.map((row) => row.kind), ['speaker', 'unknown']);
    assert.deepEqual(scoped.predictions.map((row) => row.scopeStatus), ['scoped', 'scoped']);
    assert.equal(scoped.speakerScopeStatus, 'available');

    const unscoped = await replayStructuralSpeakerHistory({
        chatPaths: paths, chatsRoot, publishedSpeakerNames: ['Nira'],
        readHistoryChatImpl: async (absolutePath) => histories.get(path.basename(absolutePath)),
    });
    assert.deepEqual(unscoped.predictions.map((row) => row.kind), ['unknown', 'unknown']);
    assert.equal(unscoped.speakerScopeStatus, 'scope-unavailable');
    assert.equal(unscoped.scopeUnavailableChats, 2);
    assert.equal(unscoped.scopeUnavailablePages, 2);
});

test('speaker scope sidecar rejects duplicate chat fingerprints and duplicate names', () => {
    const base = { schemaVersion: 'galgame.speaker-scopes.v1', entries: [] };
    const entry = { chatFingerprint: digest('chat'), releaseVersion: 'release', publishedSpeakerNames: ['Nira'] };
    assert.throws(() => validateSpeakerScopes({ ...base, entries: [entry, entry] }), { code: 'SPEAKER_SCOPES_SCHEMA_INVALID' });
    assert.throws(() => validateSpeakerScopes({ ...base, entries: [{ ...entry, publishedSpeakerNames: ['Nira', 'Nira'] }] }), { code: 'SPEAKER_SCOPES_SCHEMA_INVALID' });
});

test('fixed V79 cohort comparison pins exact membership in addition to size and source spans', () => {
    const sourceDigest = 'sha256:3cd35138de9729080525259936cb95376ee662b59691f917d4903a7bd47bd6bd';
    const predictions = Array.from({ length: 1309 }, (_, index) => ({
        chatFingerprint: digest('fixed-chat'),
        sourceMessageIndex: index,
        sourceMessageHash: digest(`message-${index}`),
        pageIndex: 0,
        start: 0,
        end: 10,
        kind: 'narration',
        pageKind: 'unattributed-dialogue',
        speakers: [],
        diagnosticReasonId: 'no-unique-speaker-evidence',
    }));
    const baseline = {
        verifiedSourceSetDigest: sourceDigest,
        sourceUnchanged: true,
        chatWriteback: false,
        externalProviderCalls: 0,
        predictions,
    };
    const candidate = {
        ...baseline,
        predictions: predictions.map((row, index) => index < 3 ? {
            ...row,
            kind: 'speaker',
            speakers: ['Nira'],
            diagnosticReasonId: null,
        } : row),
    };
    assert.throws(() => compareFixedSpeakerCandidateCohort({
        baseline,
        candidate: { ...candidate, predictions: candidate.predictions.slice(1) },
    }), { code: 'FIXED_COHORT_PAGE_COUNT_MISMATCH' });
    assert.throws(() => compareFixedSpeakerCandidateCohort({ baseline, candidate }), {
        code: 'FIXED_COHORT_MEMBERSHIP_MISMATCH',
    }, 'a cohort with the correct size but different page membership must not be reported as the historical fixed cohort');
});

test('an empty per-chat roster sidecar is present but unavailable for speaker attribution', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'empty-roster.jsonl';
    const fingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const visibleText = 'Nira: 正文。';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        speakerScopes: {
            schemaVersion: 'galgame.speaker-scopes.v1',
            entries: [{ chatFingerprint: fingerprint, releaseVersion: 'release-empty', publishedSpeakerNames: [] }],
        },
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('empty-roster-source'),
            assistantMessages: [{ sourceMessageIndex: 3, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(result.speakerScopeStatus, 'scope-unavailable');
    assert.equal(result.scopeUnavailableChats, 1);
    assert.equal(result.predictions[0].scopeStatus, 'scope-unavailable');
    assert.equal(result.predictions[0].kind, 'unknown');
});

test('single-chat replay without a roster reports unavailable scope instead of an empty usable scope', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = 'Nira: 正文。';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        publishedSpeakerNames: [],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('unchanged-source'),
            assistantMessages: [{ sourceMessageIndex: 3, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(result.speakerScopeStatus, 'scope-unavailable');
    assert.equal(result.scopeUnavailableChats, 1);
    assert.equal(result.predictions[0].scopeStatus, 'scope-unavailable');
    assert.equal(result.predictions[0].kind, 'unknown', 'an empty roster must not be reported as a scoped attribution run');
});

test('historical replay uses the exact source segmenter page spans without safe-paginator whitespace expansion', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '第一段正文。\n\n 第二段正文。';
    const messageHash = digest(visibleText);
    const expectedPages = createVisualNovelDisplaySegments(visibleText, { role: 'character' });
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('unchanged-source'),
            assistantMessages: [{ sourceMessageIndex: 9, sourceMessageHash: messageHash, visibleText }],
        }),
    });

    assert.equal(result.pagesScanned, expectedPages.length);
    assert.deepEqual(result.predictions.map(({ start, end }) => ({ start, end })),
        expectedPages.map(({ sourceSpan }) => ({ start: sourceSpan.start, end: sourceSpan.end })));
    assert.equal(result.unaddressablePages, 0);
    assert.equal(result.externalProviderCalls, 0);
});

test('unaddressable source segments remain unknown instead of aborting structural replay', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest('empty-source'),
            assistantMessages: [{ sourceMessageIndex: 10, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });

    assert.equal(result.pagesScanned, 1);
    assert.equal(result.structuralEvidenceKinds.unknown, 1);
    assert.equal(result.unaddressablePages, 1);
    assert.equal(result.pageKindCounts.unaddressable, 1);
    assert.equal(result.pageKindByBaseType.narration.unaddressable, 1);
    assert.equal(result.dialogueCandidatePages, 0);
    assert.equal(result.speakerAccuracy, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.predictions[0].start, null);
    assert.equal(result.predictions[0].end, null);
    assert.equal(result.externalProviderCalls, 0);
});

test('replay evidence is bound to the exact message hash and view/core window', () => {
    const visibleText = 'Nira说：“准备好了。”';
    const sourceMessageIndex = 4;
    const sourceMessageHash = digest(visibleText);
    const end = Array.from(visibleText).length;
    const expected = {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: 0, end },
        coreSpan: { start: 0, end },
    };
    const evidence = createStructuralPageTitleEvidence({
        fullText: visibleText,
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: expected.viewSpan,
        coreSpan: expected.coreSpan,
    });

    assert.equal(isStructuralReplayEvidenceValid(evidence, visibleText, expected), true);
    assert.equal(isStructuralReplayEvidenceValid({ ...evidence, sourceMessageIndex: 5 }, visibleText, expected), false);
    assert.equal(isStructuralReplayEvidenceValid({ ...evidence, sourceMessageHash: digest('other') }, visibleText, expected), false);
    assert.equal(isStructuralReplayEvidenceValid({ ...evidence, viewSpan: { start: 1, end } }, visibleText, expected), false);
    assert.equal(isStructuralReplayEvidenceValid({ ...evidence, coreSpan: { start: 1, end } }, visibleText, expected), false);
    assert.equal(isStructuralReplayEvidenceValid({
        ...evidence,
        classificationEvidenceSpans: [{ start: 0, end: end + 1 }],
    }, visibleText, expected), false);
});

test('gold validation is hash/span bound and rejects transcript bodies', () => {
    const visibleText = '“没人署名。”';
    const gold = {
        schemaVersion: 'galgame.structural-speaker-title-gold.v1',
        publishedSpeakerNames: [],
        messages: [{
            chatFingerprint: digest('chat-path'), sourceMessageIndex: 0, sourceMessageHash: digest(visibleText),
            pages: [{ pageIndex: 0, start: 0, end: Array.from(visibleText).length, expectedKind: 'unknown', expectedSpeakers: [] }],
        }],
    };
    assert.equal(validateSpeakerTitleGold(gold), gold);
    assert.throws(() => validateSpeakerTitleGold({ ...gold, visibleText }), { code: 'GOLD_SCHEMA_INVALID' });
    assert.throws(() => scoreStructuralSpeakerReplay({ predictions: [], gold: { ...gold, messages: [] } }), { code: 'GOLD_SAMPLE_EMPTY' });
});

test('a source change during replay stops scoring instead of shrinking the sample', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleText = '“没人署名。”';
    let reads = 0;
    await assert.rejects(replayStructuralSpeakerHistory({
        chatPaths: ['story.jsonl'], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'story.jsonl'),
            sourceDigest: digest(`source-${++reads}`),
            assistantMessages: [{ sourceMessageIndex: 0, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    }), { code: 'CHAT_CHANGED_DURING_REPLAY' });
});

test('chat discovery is recursive, sorted, and excludes non-JSONL files', async (t) => {
    const chatsRoot = await mkdtemp(path.join(os.tmpdir(), 'galgame-structural-replay-'));
    t.after(() => rm(chatsRoot, { recursive: true, force: true }));
    await mkdir(path.join(chatsRoot, 'nested'));
    await writeFile(path.join(chatsRoot, 'b.jsonl'), '{}\n');
    await writeFile(path.join(chatsRoot, 'nested', 'a.JSONL'), '{}\n');
    await writeFile(path.join(chatsRoot, 'ignore.txt'), 'private');
    assert.deepEqual(await listHistoryChatFiles(chatsRoot), ['b.jsonl', path.join('nested', 'a.JSONL')]);
});

test('current parser projects the six user-confirmed labels through the structural replay', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v40.jsonl';
    const visibleTexts = [
        '短弓手惊叫着丢开弓，拔出短斧贴身反击：“我讨厌会移动的午餐！”',
        '尼布听完你的计划，露出一种“我讨厌英勇，但我更讨厌被卖去旧磨坊”\n\n的表情。他从地上捡起碎瓦。',
        '莫里克尖叫着爬起。旧磨坊里火星乱飞，尼布在门外探头大喊：“我就说她是自然灾害！\n\n但现在是我们这边的自然灾害！”',
        '克罗恩的回合：瘦竹竿男看见你倒地濒死，发出一阵愉悦笑声:"这么快就倒下了?Lady Veyra的杀手也不过如此嘛!"',
        '你、Pippa和尼布坐在Lila的新坟边上。Pippa把最后一瓶药塞进你手里:"喝了。',
        'Celestia严肃地说:"方案C风险最高，但最快。我会准备治疗术随时待命。',
    ];
    const expected = ['短弓手', '尼布', '尼布', '瘦竹竿男', 'Pippa', 'Celestia'];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 900,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['你', '尼布', 'Pippa', 'Celestia', '短弓手', '瘦竹竿男'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v40-source'),
            assistantMessages,
        }),
    });

    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (let index = 0; index < expected.length; index += 1) {
        const pages = result.predictions.filter((row) => row.sourceMessageIndex === index + 900);
        assert.ok(pages.some((row) => row.kind === 'speaker' && row.speakers.includes(expected[index])),
            `sample ${index + 1} resolves to ${expected[index]}: ${JSON.stringify(pages.map(({ kind, text, speakers, ruleId }) => ({ kind, text, speakers, ruleId })))}`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('manual v43 labels resolve spirit farewell, compound dragon name, and unique entity pronoun continuation', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v43.jsonl';
    const samples = [
        ['你', '你同时拿出两片龙鳞契约："两条龙一起召唤！艾萨克斯！霜咬·银翼！我以龙魂守护者之名召唤你们——阻止虚空吞噬者复苏！"'],
        ['？？？', '一个虚空法师转头，施放Detect Magic！\n\n"有入侵者！"'],
        ['霜石', '霜石的灵魂微笑着升向天空——\n\n"冰原...吾回来了..."'],
        ['霜石', '霜石站起来，眼中冰焰变得温和："封印守护者，冰霜之书记录着吾族所有的魔法、历史和封印知识。"'],
        ['霜咬·银翼', '霜咬·银翼用巨大的龙爪指向宝藏堆："这些是五百年来，冰霜巨人部落献给我的贡品。"'],
        ['霜咬', '霜咬微笑："我说过这是试炼，不是杀戮。"\n\n它从龙鳞中取出一片银白色龙鳞："这是我的龙鳞契约。需要时，呼唤我的真名。"'],
        ['Durik', 'Durik"哈哈"大笑，冰霜巨人王冠完全免疫龙息："龙的冰霜？对老子没用！"'],
    ];
    const assistantMessages = samples.map(([, visibleText], index) => ({
        sourceMessageIndex: index + 1200,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['霜咬', 'Durik'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v43-source'),
            assistantMessages,
        }),
    });

    for (let index = 0; index < samples.length; index += 1) {
        const [expected] = samples[index];
        const pages = result.predictions.filter((row) => row.sourceMessageIndex === index + 1200);
        assert.ok(pages.some((row) => row.kind === 'speaker' && row.speakers.includes(expected)
            || expected === '？？？' && row.ruleId === 'anonymous-first-appearance'),
            `sample ${index + 1} resolves to ${expected}: ${JSON.stringify(pages.map(({ kind, text, speakers, ruleId }) => ({ kind, text, speakers, ruleId })))}`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('manual v44 dragon-scene labels resolve only with bounded name evidence', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v44.jsonl';
    const samples = [
        ['霜咬·银翼', '霜咬·银翼，体长五十米的冰霜巨龙在宝藏中央沉睡。\n\n你用龙语呼唤：“霜咬·银翼，冰原的守护者，我请求对话。”\n\n巨龙睁开眼睛——冰蓝色竖瞳锁定你们。\n\n低沉而威严的声音回荡：“龙魂守护者……五百年了……终于有人敢用龙语叫醒我……”', '五百年了'],
        ['霜咬·银翼', '霜咬·银翼巨大的龙头抬起，冰蓝色竖瞳审视着你：“龙魂守护者……这个称号不是随便能用的。证明给我看——你凭什么配得上与我对话？”', '这个称号不是随便能用的'],
        ['你', '你没有退缩，胸口的龙魂之心"嗡"的爆发金色光芒——\n\n“我是金龙长老的继承者。在寒霜神殿，我加固了灰境领主的千年封印。”', '我是金龙长老的继承者'],
        ['霜咬·银翼', '霜咬·银翼咆哮——龙吟"轰"的震动整座冰山！\n\n“很好！让我看看——龙魂守护者的力量！”', '让我看看'],
        ['霜咬·银翼', '战斗开始：霜咬·银翼（12级传奇巨龙，试炼模式）\n\n先攻检定：霜咬：22\n\n霜咬的回合：\n\n巨龙张开巨嘴——冰霜龙息蓄力！\n\n“承受我的龙息——冰霜吐息！”', '承受我的龙息'],
        ['霜咬', '霜咬看到你的指挥，龙瞳闪烁：“你在我的龙息下还能保持冷静……不错……”', '你在我的龙息下还能保持冷静'],
        ['霜咬·银翼', '霜咬“吼”的咆哮：“够了！你们通过了我的试炼！”\n\n它收起敌意，翅膀“轰”的收拢，龙瞳中充满认可：\n\n“龙魂守护者，你在我的龙息下存活，你的剑伤到我的龙鳞，你们证明了实力。”\n\n它低下龙头：“我，霜咬·银翼，冰原的守护者，认可你。”', '你在我的龙息下存活'],
    ];
    const negatives = [
        '巨龙睁开眼睛。\n\n低沉而威严的声音回荡：“龙魂守护者……终于有人敢用龙语叫醒我……”',
        `霜咬·银翼，体长五十米的冰霜巨龙。${'漫长的冰原旅程和战斗记录。'.repeat(40)}\n\n巨龙张开巨嘴，冰霜龙息蓄力：“承受我的龙息！”`,
        '霜咬·银翼在左侧，艾萨克斯·深海在右侧。巨龙张开巨嘴，龙息蓄力：“承受我的龙息！”',
        '霜咬·银翼，体长五十米的冰霜巨龙。\n\n# 新场景\n\n巨龙睁开眼睛，低沉而威严的声音回荡：“龙魂守护者……承受我的龙息！”',
    ];
    const visibleSamples = [...samples.map(([, text]) => text), ...negatives];
    const assistantMessages = visibleSamples.map((visibleText, index) => ({
        sourceMessageIndex: index + 1400,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v44-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (let index = 0; index < samples.length; index += 1) {
        const [expected, , marker] = samples[index];
        const text = formatVisualNovelDisplayText(assistantMessages[index].visibleText);
        const targetStart = Array.from(text).join('').indexOf(marker);
        const page = result.predictions.find((row) => row.sourceMessageIndex === index + 1400
            && row.start <= targetStart && targetStart < row.end);
        assert.equal(page?.kind, 'speaker', `positive ${index + 1}: ${JSON.stringify({ page, targetStart, predictions: result.predictions.filter((row) => row.sourceMessageIndex === index + 1500) })}`);
        assert.ok(page.speakers.includes(expected), `positive ${index + 1}: ${JSON.stringify(page)}`);
    }
    for (let index = 0; index < negatives.length; index += 1) {
        const messageIndex = index + samples.length + 1400;
        const pages = result.predictions.filter((row) => row.sourceMessageIndex === messageIndex);
        assert.ok(pages.some((row) => row.kind === 'unknown'),
            `negative ${index + 1} stays anonymous: ${JSON.stringify(pages.map(({ kind, speakers, ruleId }) => ({ kind, speakers, ruleId })))}`);
        assert.equal(pages.some((row) => row.kind === 'speaker'), false, `negative ${index + 1} must not guess a dragon name`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('manual v45 labels resolve local role, creature, and player-action continuations', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-v45.jsonl';
    const samples = [
        ['镇长', '镇长——一个满脸愁容的中年男子——急忙迎接你们。\n\n“帝国派来的支援？太好了！空间裂缝在镇北五里的矿坑深处！”', '帝国派来的支援'],
        ['首相', '首相沉默片刻：“虚空教派在帝国潜伏已久，但我们一直无法抓到实证。”\n\n他站起来，从保险箱取出一个沉重的钱袋：“任务圆满完成——三万金，如数支付。”', '任务圆满完成'],
        ['章鱼', '章鱼犹豫，然后用触手指向港口东侧：“那边……有人类的船……他们想要我们的墨汁和触手……”', '有人类的船'],
        ['光头', '光头颤抖：“影……影蛇……”', '影……影蛇'],
        ['你', '你瞬移到鳞刃面前，龙霜之剑挡住去路！\n\n“你跑不掉。”', '你跑不掉'],
        ['你', '你闭上眼睛，用龙魂守护者的感知锁定真身——\n\n“在左边！”', '在左边'],
        ['莫里斯', '莫里斯感叹：“您不仅有实力，还有智慧和仁慈……海洋守护者之名，名副其实。”', '您不仅有实力'],
    ];
    const anonymousFirstAppearance = '一个陌生身影从暗处走来，冷声说道：“你们来晚了。”';
    const visibleTexts = [...samples.map(([, text]) => text), anonymousFirstAppearance];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: index + 1500,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v45-source'),
            assistantMessages,
        }),
    });
    for (let index = 0; index < samples.length; index += 1) {
        const [expected, , marker] = samples[index];
        const text = formatVisualNovelDisplayText(assistantMessages[index].visibleText);
        const targetStart = Array.from(text).join('').indexOf(marker);
        const page = result.predictions.find((row) => row.sourceMessageIndex === index + 1500
            && row.start <= targetStart && targetStart < row.end);
        assert.equal(page?.kind, 'speaker', `positive ${index + 1}: ${JSON.stringify(page)}`);
        assert.ok(page.speakers.includes(expected), `positive ${index + 1}: ${JSON.stringify(page)}`);
    }
    const anonymousPages = result.predictions.filter((row) => row.sourceMessageIndex === 1507);
    assert.ok(anonymousPages.some((row) => row.kind === 'unknown' && row.ruleId === 'anonymous-first-appearance'), JSON.stringify(anonymousPages));
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);

    const rosteredVoiceName = '冷声：“进来吧。”';
    const rostered = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['冷声'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v45-rostered-voice-source'),
            assistantMessages: [{
                sourceMessageIndex: 1600,
                sourceMessageHash: digest(rosteredVoiceName),
                visibleText: rosteredVoiceName,
            }],
        }),
    });
    assert.ok(rostered.predictions.some((row) => row.kind === 'speaker' && row.speakers.includes('冷声')),
        'an exact published character name takes priority over the voice-word fallback');
});

test('v45 recognizes a final speaking action and comma-delimited quote cue', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'speech-cue-v45.jsonl';
    const texts = [
        'Mira终于开口：“这里在等某个人回应。”',
        'Ren低声说，“不是窗。”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('speech-cue-v45-source'),
            assistantMessages: texts.map((visibleText, index) => ({
                sourceMessageIndex: index + 1700,
                sourceMessageHash: digest(visibleText),
                visibleText,
            })),
        }),
    });
    assert.ok(result.predictions.some((row) => row.sourceMessageIndex === 1700
        && row.kind === 'speaker' && row.speakers.includes('Mira')));
    assert.ok(result.predictions.some((row) => row.sourceMessageIndex === 1701
        && row.kind === 'speaker' && row.speakers.includes('Ren')));
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('current calibration follows named upstream actions and keeps dash labels explicit', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'user-calibration-current.jsonl';
    const samples = [
        ['Priya', '餐桌边，Priya 头也不抬地翻了一页。\n\n“他不会的。”\n\n她平静地说，“鉴别诊断：他又进入神游状态了。”', '鉴别诊断'],
        ['Priya', '—Priya：“我的技能是睡眠剥夺、临床焦虑和在三十秒内判断你需不需要急诊。现在冷却时间为零。”', '我的技能'],
        ['Theo', '“蛋白质。碳水。盐。奇迹般不像医院食堂的湿纸板。”\n\n—走廊那头的吉他声停了一拍。Theo 探出半个身子，头发乱得很有艺术立场。\n\n“等等，香肠那个吗？老天，man，这个味道有低音线。”', '等等，香肠'],
        ['Kael', '雇佣来的Kael**从阴影中开口，声音低沉："我可以潜入任何一位贵族的宅邸，获取确凿证据。只需要给我目标和时间。"', '我可以潜入'],
    ];
    const assistantMessages = samples.map(([, visibleText], index) => ({
        sourceMessageIndex: index + 1800,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['Priya', 'Theo', 'Kael'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-current-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (let index = 0; index < samples.length; index += 1) {
        const [expected, , marker] = samples[index];
        const text = formatVisualNovelDisplayText(assistantMessages[index].visibleText);
        const targetStart = Array.from(text).join('').indexOf(marker);
        const page = result.predictions.find((row) => row.sourceMessageIndex === index + 1800
            && row.start <= targetStart && targetStart < row.end);
        assert.equal(page?.kind, 'speaker', `calibration ${index + 1}: ${JSON.stringify(page)}`);
        assert.ok(page.speakers.includes(expected), `calibration ${index + 1}: ${JSON.stringify(page)}`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v49 preserves adjacent quotes attributed to standalone dash-led names, including action sentences', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const chatPath = 'signed-speech-cue-v49.jsonl';
    const samples = [
        [192, 'Andrei', 'Andrei站在阵眼边缘。—Andrei低声说。“它要开门进你。”火光在远处摇曳。'],
        [190, 'Andrei', '火开始叫他的名字。Andrei站在阵眼边缘。—Andrei低声说。“它要刻名。”余烬随即暗下去。'],
        [188, 'Andrei', '黑水铺开，只抵住一息。—Andrei低声说。“再一跳，旁观也会被记账。”井壁传来回声。'],
        [186, 'Andrei', 'Andrei看着阵眼。硫磺味沉成冷线。—Andrei低声说。“下一口会咬进存在本身。”空气凝住了。'],
        [194, 'God', 'God的声音仍温和。—God缓声说。“砍断绳子时，桶不会变轻。它会掉下去。现在有人在井边。”火焰轻轻摇晃。'],
    ];
    const assistantMessages = samples.map(([sourceMessageIndex, , visibleText]) => ({
        sourceMessageIndex,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('signed-speech-cue-v49-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (let index = 0; index < samples.length; index += 1) {
        const [sourceMessageIndex, expected, visibleText] = samples[index];
        const marker = visibleText.slice(visibleText.indexOf('“') + 1, visibleText.indexOf('”'));
        const start = Array.from(formatVisualNovelDisplayText(visibleText)).join('').indexOf(marker);
        const page = result.predictions.find((row) => row.sourceMessageIndex === sourceMessageIndex
            && row.start <= start && start < row.end);
        assert.equal(page?.kind, 'speaker', `v49 sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
        assert.ok(page.speakers.includes(expected), `v49 sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v49 applies user-calibrated player, continuation, crowd, sound-effect, and action-cue labels', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v49-calibration');
    const chatPath = 'user-calibration-v49.jsonl';
    const samples = [
        [901, '你', '你毫不犹豫，同时拿出两片龙鳞契约——\n\n“我以龙魂守护者之名召唤你们！”', '我以龙魂守护者之名召唤你们'],
        [902, '霜石', '霜石继续：“冰霜之书记载了吾族的历史。”\n\n它走向祭坛，恭敬地捧起冰霜之书：“现在，吾将它交给汝。”', '现在，吾将它交给汝'],
        [903, '旁白', '偷袭伤害：26点总伤害\n\n“成功！”\n\n霜咬的回合：', '成功'],
        [904, '你', '你没有退缩，胸口的龙魂之心爆发金色光芒——“我是金龙长老的继承者。”', '我是金龙长老的继承者'],
        [905, '你', '海狼陈说：“愿意友好合作。”\n\n“合作愉快。”你与海狼陈握手。', '合作愉快'],
        [906, '人群', '码头区消息传开——“公会端掉了影蛇！”“海怪问题解决了！”“会长太强了！”\n\n商船公会门前挤满了人群，水手们热烈欢呼。', '海怪问题解决了'],
        [908, '毒牙', '毒牙咬牙：“想端掉我？做梦！”', '想端掉我？做梦！'],
    ];
    const assistantMessages = samples.map(([sourceMessageIndex, , visibleText]) => ({
        sourceMessageIndex,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['霜石', '毒牙'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v49-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (const [sourceMessageIndex, expected, visibleText, marker] of samples) {
        const markerStart = Array.from(formatVisualNovelDisplayText(visibleText)).join('').indexOf(marker);
        assert.ok(markerStart >= 0, `calibration marker exists for ${sourceMessageIndex}`);
        const page = result.predictions.find((row) => row.sourceMessageIndex === sourceMessageIndex
            && row.start <= markerStart && markerStart < row.end);
        assert.equal(page?.titleText, expected, `v50 visible title ${sourceMessageIndex}: ${JSON.stringify(page)}`);
        if (expected === '旁白') {
            assert.equal(page?.kind, 'narration', `v49 narration sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
        } else {
            assert.equal(page?.kind, 'speaker', `v49 speaker sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
            assert.ok(page.speakers.includes(expected), `v49 expected ${expected}: ${JSON.stringify(page)}`);
        }
    }
    const soundEffectPage = '“咔”！';
    const soundEffectLength = Array.from(soundEffectPage).length;
    const soundEffectEvidence = createStructuralPageTitleEvidence({
        fullText: soundEffectPage,
        publishedSpeakerNames: [],
        sourceMessageIndex: 909,
        sourceMessageHash: digest(soundEffectPage),
        viewSpan: { start: 0, end: soundEffectLength },
        coreSpan: { start: 0, end: soundEffectLength },
    });
    assert.equal(soundEffectEvidence?.text, '旁白', 'single 咔 remains a scene sound effect rather than a speaker turn');
    const crowdText = '码头区消息传开——“公会端掉了影蛇！”“海怪问题解决了！”“会长太强了！”\n\n门前挤满了人群，水手们热烈欢呼。\n\n莫里斯激动地说：“这是传奇功绩！”';
    const crowdIndex = createStructuralMessageSpeakerIndex({
        fullText: crowdText,
        sourceMessageIndex: 910,
        sourceMessageHash: digest(crowdText),
    });
    const crowdAnchors = crowdIndex.anchors.filter((anchor) => anchor.ruleId === 'crowd-report-quote');
    assert.equal(crowdAnchors.length, 3, 'the same explicit crowd context attributes the reported quote cluster');
    for (const anchor of crowdAnchors) {
        assert.equal(anchor.speakerText, '人群');
        assert.ok(anchor.attributionSpan.start <= anchor.utteranceSpans[0].start
            && anchor.attributionSpan.end >= anchor.utteranceSpans[0].end,
        'crowd attribution evidence contains its quote and the exact nearby crowd cue');
        assert.equal(Array.from(crowdText).slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join(''), '人群',
            'the group title points to the exact crowd noun in source text');
        assert.ok(anchor.attributionSpan.end <= Array.from(crowdText.slice(0, crowdText.indexOf('莫里斯'))).length,
            'crowd attribution evidence must not extend into the next named character quote');
    }
    assert.ok(crowdIndex.anchors.find((anchor) => anchor.speakerText === '莫里斯'
        && anchor.ruleId !== 'crowd-report-quote'),
        'the following named speaker keeps independent local attribution');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v51 applies whole-party, explicit action, introduction, and narration fallback labels', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v51-calibration');
    const chatPath = 'user-calibration-v51.jsonl';
    const samples = [
        [911, '全员', '全员单膝跪地：“遵命，至高领袖！”', '遵命'],
        [912, '你', '会议室中，你站在长桌前：“六个月的建设，光明会已经蜕变。现在讨论未来战略——我们要成为什么样的组织？”', '六个月的建设'],
        [913, '接待员', '接待员一愣：“注册公会？请稍等，我叫工会长来……”', '注册公会'],
        [914, '格雷森', '格雷森仔细阅读：“很完善……好，我批准了。缴纳1000金注册费，龙裔冒险者公会正式成立！”', '很完善'],
        [915, '旁白', '消息迅速传开——“有个新公会！会长是龙魂守护者！”“传奇10级队伍！还有公爵夫人担保！”“他们说有龙族传承！”', '有个新公会'],
        [916, '旁白', 'Pippa和Durik留守Grand Harbor管理龙裔公会：“Boss放心！老娘会把公会管理得妥妥的！”', 'Boss放心'],
        [917, '艾瑞克', '“这位是帝国首相·凯撒，代表皇室与你们商谈。”艾瑞克介绍。', '这位是帝国首相'],
        [918, '旁白', '影蛇清剿战\n\n“行动！”', '行动'],
    ];
    const assistantMessages = samples.map(([sourceMessageIndex, , visibleText]) => ({
        sourceMessageIndex,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('user-calibration-v50-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    for (const [sourceMessageIndex, expected, visibleText, marker] of samples) {
        const markerStart = Array.from(visibleText).join('').indexOf(marker);
        const page = result.predictions.find((row) => row.sourceMessageIndex === sourceMessageIndex
            && row.start <= markerStart && markerStart < row.end);
        assert.equal(page?.titleText, expected, `v50 exact visible title ${sourceMessageIndex}: ${JSON.stringify(page)}`);
        if (expected === '旁白') {
            assert.equal(page?.kind, 'narration', `v50 narration sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
        } else {
            assert.ok(['speaker', 'group'].includes(page?.kind), `v50 speaker sample ${sourceMessageIndex}: ${JSON.stringify(page)}`);
            assert.ok(page.speakers.includes(expected), `v50 expected ${expected}: ${JSON.stringify(page)}`);
        }
    }
    const bossOffset = Array.from(samples[5][2].slice(0, samples[5][2].indexOf('Boss'))).length;
    const conservativePippaDurikFallback = result.predictions.find((row) => row.sourceMessageIndex === 916
        && row.start <= bossOffset && row.end > bossOffset);
    assert.equal(conservativePippaDurikFallback?.titleText, '旁白');
    assert.equal(conservativePippaDurikFallback?.diagnosticReasonId, 'no-unique-speaker-evidence');
    assert.deepEqual(conservativePippaDurikFallback?.speakers, [], 'the Pippa/Durik joint action fallback has no fabricated speaker or avatar');
    const openingHeadingCommandFallback = result.predictions.find((row) => row.sourceMessageIndex === 918
        && row.start > 0 && row.titleText === '旁白');
    assert.equal(openingHeadingCommandFallback?.candidateBucket, 'narratorFallback');
    assert.equal(openingHeadingCommandFallback?.diagnosticReasonId, 'narrative-shape-with-unattributed-quote');
    assert.ok(result.dialogueCandidateBuckets.narratorFallback >= 1);
    assert.equal(result.speakerAccuracy, 'INSUFFICIENT_EVIDENCE');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v51 ignores an orphan line-end ASCII quote without changing historic page spans', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v51-orphan-quote');
    const chatPath = 'orphan-quote.jsonl';
    const visibleText = '- 楼下九个护卫可能破窗爬上来"\n\nCelestia严肃地说："方案C风险最高，但最快。"\n\nMira补充："如果留在三楼，Boss有支援；如果下楼，防线更稳。"\n\n六个战力，十五个护卫加一个前圣骑士，三个战术方案，明晚十点行动。';
    const baseSegments = createVisualNovelDisplaySegments(visibleText, {
        role: 'character', knownSpeakers: ['Celestia', 'Mira'],
    });
    assert.deepEqual(baseSegments.map(({ sourceSpan }) => sourceSpan), [
        { start: 0, end: 16 }, { start: 18, end: 45 }, { start: 47, end: 81 }, { start: 83, end: 115 },
    ], 'the fixed fixture keeps its original visible page count, order, and code-point spans');
    const message = {
        sourceMessageIndex: 940,
        sourceMessageHash: digest(visibleText),
        visibleText,
    };
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot, publishedSpeakerNames: ['Celestia', 'Mira'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v51-orphan-quote-fixture'),
            assistantMessages: [message],
        }),
    });
    assert.deepEqual(result.predictions.map(({ start, end }) => ({ start, end })),
        baseSegments.map(({ sourceSpan }) => sourceSpan), 'classification preserves the production segmenter spans');
    assert.equal(result.predictions.find((row) => row.titleText === 'Celestia')?.titleText, 'Celestia');
    assert.equal(result.predictions.find((row) => row.titleText === 'Mira')?.titleText, 'Mira',
        'the explicit opener following the orphan closer remains usable');
    const summaryStart = Array.from(visibleText).join('').indexOf('六个战力');
    const summary = result.predictions.find((row) => row.start === summaryStart);
    assert.equal(summary?.titleText, '旁白');
    assert.deepEqual(summary?.speakers, []);
    assert.equal(summary?.diagnosticReasonId, null, 'a directly readable unquoted summary uses ordinary narration evidence');
    assert.equal(result.dialogueCandidateBuckets.unresolvedCandidates, 0);
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('CLI help is local and does not inspect chat content', async () => {
    const help = await runStructuralSpeakerReplayCli(['--help']);
    assert.equal(help.status, 'help');
    assert.match(help.usage, /speaker-structure-replay/u);
});

test('v52 back-attributes a closed quote from a short post-quote speech cue', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v52-postquote');
    const chatPath = 'v52-postquote.jsonl';
    const visibleText = '“你刚才敲的位置……” Ren低声说，“不是窗。”\n\n窗框内侧浮现出一圈暗淡的蓝色符号。';
    const message = {
        sourceMessageIndex: 0,
        sourceMessageHash: digest(visibleText),
        visibleText,
    };
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v52-postquote-source'),
            assistantMessages: [message],
        }),
    });
    for (const phrase of ['你刚才敲的位置', '不是窗']) {
        const start = Array.from(visibleText).join('').indexOf(phrase);
        const page = result.predictions.find((row) => row.sourceMessageIndex === 0
            && row.start <= start && start < row.end);
        assert.equal(page?.titleText, 'Ren', `post-quote speaker cue ${phrase}: ${JSON.stringify(page)}`);
        assert.ok(page?.speakers.includes('Ren'));
    }
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v52 scores the ten user-calibrated structural titles and keeps source-frame negatives', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v52-calibration');
    const chatPath = 'v52-gold.jsonl';
    const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const samples = [
        [5200, 'Pippa', 'Pippa说：“先把账册翻开。”\n\n她翻到账本后面：“分给内圈。”', '分给内圈'],
        [5201, '格雷戈', '格雷戈转身：“退后！”', '退后'],
        [5202, '你', '我压低声音，对你道：“别动。”', '别动'],
        [5203, '旁白', '账页上写着：“入城期限：三天。”', '入城期限'],
        [5204, '人群', '围观人群中，消息迅速传开——“新公会成立了！”“会长真强！”', '新公会成立'],
        [5205, '旁白', '影蛇清剿战\n\n“行动！”', '行动'],
        [5206, '暗影祭司', '暗影祭司顿了顿：“不可能！”', '不可能'],
        [5207, '维斯坎特', '维斯坎特说：“我还能站住。”\n\n他中箭，踉跄后退：“不可能！”', '踉跄后退'],
        [5208, '加里克爵士', '加里克爵士眼神变得严肃：“训练开始。”', '训练开始'],
        [5209, '马库斯', '马库斯伯爵摊开报告：“Boss，清晨出发。”', '清晨出发'],
    ].map(([sourceMessageIndex, expected, visibleText, marker]) => ({
        sourceMessageIndex, expected, visibleText, marker,
        sourceMessageHash: digest(visibleText),
    }));
    const pagesForGold = samples.map((sample) => {
        const segments = createVisualNovelDisplaySegments(sample.visibleText, {
            role: 'character', knownSpeakers: ['马库斯', '加里克爵士'],
        });
        const markerStart = Array.from(sample.visibleText).join('').indexOf(sample.marker);
        const pageIndex = segments.findIndex(({ sourceSpan }) => sourceSpan.start <= markerStart && markerStart < sourceSpan.end);
        assert.ok(pageIndex >= 0, `gold marker has an existing page span: ${sample.sourceMessageIndex}`);
        const { sourceSpan } = segments[pageIndex];
        return {
            chatFingerprint,
            sourceMessageIndex: sample.sourceMessageIndex,
            sourceMessageHash: sample.sourceMessageHash,
            pageIndex,
            start: sourceSpan.start,
            end: sourceSpan.end,
            expectedKind: sample.expected === '旁白' ? 'narration' : 'speaker',
            expectedSpeakers: sample.expected === '旁白' ? [] : [sample.expected],
        };
    });
    const gold = {
        schemaVersion: 'galgame.structural-speaker-title-gold.v1',
        publishedSpeakerNames: ['马库斯', '加里克爵士'],
        messages: samples.map((sample) => ({
            chatFingerprint,
            sourceMessageIndex: sample.sourceMessageIndex,
            sourceMessageHash: sample.sourceMessageHash,
            pages: pagesForGold.filter((page) => page.sourceMessageIndex === sample.sourceMessageIndex)
                .map(({ pageIndex, start, end, expectedKind, expectedSpeakers }) => (
                    { pageIndex, start, end, expectedKind, expectedSpeakers }
                )),
        })),
    };
    const assistantMessages = samples.map(({ sourceMessageIndex, sourceMessageHash, visibleText }) => ({
        sourceMessageIndex, sourceMessageHash, visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        gold,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v52-calibration-source'),
            assistantMessages,
        }),
    });
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.goldScoring?.scoredPages, 10);
    assert.equal(result.goldScoring?.exactTitleAccuracy, 1, JSON.stringify(samples.map((sample) => {
        const markerStart = Array.from(sample.visibleText).join('').indexOf(sample.marker);
        const row = result.predictions.find((prediction) => prediction.sourceMessageIndex === sample.sourceMessageIndex
            && prediction.start <= markerStart && markerStart < prediction.end);
        return { sourceMessageIndex: sample.sourceMessageIndex, expected: sample.expected, row };
    })));
    for (const sample of samples) {
        const markerStart = Array.from(sample.visibleText).join('').indexOf(sample.marker);
        const title = result.predictions.find((row) => row.sourceMessageIndex === sample.sourceMessageIndex
            && row.start <= markerStart && markerStart < row.end);
        assert.equal(title?.titleText, sample.expected, `v52 exact gold ${sample.sourceMessageIndex}: ${JSON.stringify(title)}`);
    }

    const negativeMessages = [
        [5210, 'Pippa说：“我压低声音。”', '我压低声音'],
        [5211, 'Pippa说：“第一句。”\n\n“第二句。”', '第二句'],
        [5212, 'Pippa说：“先走。”\n\n# 新场景\n她低声说：“不要进来。”', '不要进来'],
        [5213, '消息迅速传开——“有人来了。”“快走！”', '快走'],
        [5214, '马库斯伯爵摊开报告，报告上写着：“清晨出发。”', '清晨出发'],
        [5215, 'Pippa说：“先走。”\n\n“这段引语还没有结束。', '这段引语'],
    ];
    const negativeRows = [];
    const negatives = negativeMessages.map(([sourceMessageIndex, visibleText, marker]) => ({
        sourceMessageIndex,
        visibleText,
        sourceMessageHash: digest(visibleText),
        marker,
    }));
    const negativeResult = await replayStructuralSpeakerHistory({
        chatPaths: ['v52-negatives.jsonl'],
        chatsRoot,
        publishedSpeakerNames: ['Pippa', '马库斯'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'v52-negatives.jsonl'),
            sourceDigest: digest('v52-negative-source'),
            assistantMessages: negatives.map(({ sourceMessageIndex, sourceMessageHash, visibleText }) => ({
                sourceMessageIndex, sourceMessageHash, visibleText,
            })),
        }),
    });
    for (const sample of negatives) {
        const markerStart = Array.from(sample.visibleText).join('').indexOf(sample.marker);
        const row = negativeResult.predictions.find((candidate) => candidate.sourceMessageIndex === sample.sourceMessageIndex
            && candidate.start <= markerStart && markerStart < candidate.end);
        negativeRows.push(row);
    }
    assert.equal(negativeRows[0]?.titleText, 'Pippa', 'NPC first person inside a quote is not player evidence');
    assert.equal(negativeRows[1]?.titleText, '旁白', 'a completed earlier turn is not inherited by proximity');
    assert.equal(negativeRows[2]?.titleText, '旁白', `a scene boundary stops a previous-speaker reference: ${JSON.stringify(negativeRows[2])}`);
    assert.equal(negativeRows[3]?.titleText, '旁白', 'quote plurality without a reliable collective source remains narrator');
    assert.equal(negativeRows[3]?.candidateBucket, null, 'a narration-shaped quoted report is outside the dialogue candidate denominator');
    assert.equal(negativeResult.candidateFallbackReasonCountTotal,
        negativeResult.dialogueCandidateBuckets.narratorFallback,
        'candidate fallback reasons sum exactly to the candidate fallback bucket');
    assert.equal(negativeResult.candidateFallbackReasonCounts['narrative-shape-with-unattributed-quote'], 0,
        'noncandidate narrative fallback is not included in candidate reason counts');
    assert.ok(negativeResult.allPageNarratorFallbackReasonCounts['narrative-shape-with-unattributed-quote'] >= 1,
        'all-page diagnostics retain the noncandidate narrative fallback separately');
    assert.equal(negativeRows[4]?.titleText, '旁白', 'written report contents remain narrator even when a character holds the report');
    assert.equal(negativeRows[5]?.titleText, '旁白', 'an unclosed quote without a unique speaker falls back to narration in v66');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(negativeResult.sourceUnchanged, true);
    assert.equal(negativeResult.chatWriteback, false);
    assert.equal(negativeResult.externalProviderCalls, 0);
});

test('v53 historical gold uses the exact real chat pages, hashes, spans, and visible titles', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const fixtures = [
        {
            chatPath: 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl',
            sourceMessageIndex: 592,
            sourceMessageHash: 'sha256:964ce4e190fe8e2f968b41db3b9264124f4f0b91ca2762edcb8b049cc3643c5c',
            pageIndex: 6,
            start: 303,
            end: 340,
            sourcePageText: '格雷戈喘着气，眼中露出挣扎："我...我不能说...瑟蕾娜会杀了我..."',
            expectedTitle: '格雷戈',
        },
        {
            chatPath: 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl',
            sourceMessageIndex: 328,
            sourceMessageHash: 'sha256:e417f4e0dc25f900be38b3f1bd2b093c27db417f2181f9bca857fbf84cd348ca',
            pageIndex: 5,
            start: 187,
            end: 200,
            sourcePageText: '暗影祭司愣住:"什么?!"',
            expectedTitle: '暗影祭司',
        },
        {
            chatPath: 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl',
            sourceMessageIndex: 70,
            sourceMessageHash: 'sha256:7e5ae2764e77c212ca30d58eb522e024d665fa507ca00bd3b6a13c271943586d',
            pageIndex: 4,
            start: 220,
            end: 256,
            sourcePageText: '他踉跄后退，脸上第一次露出真正的恐惧：“不可能……你这种低账级资产——”',
            expectedTitle: '维斯坎特',
        },
        {
            chatPath: '伊芙琳·灰烬誓约/伊芙琳·灰烬誓约 - 2026-05-22@01h00m29s145ms.jsonl',
            sourceMessageIndex: 36,
            sourceMessageHash: 'sha256:8d942482afb211827554dfafec5dc2247fcd700d8a78a7b7e05feb548804c56b',
            pageIndex: 16,
            start: 506,
            end: 534,
            sourcePageText: '我压低声音：“好消息，我们赶上了。坏消息，他们还没睡。”',
            expectedTitle: '你',
        },
        {
            chatPath: 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl',
            sourceMessageIndex: 472,
            sourceMessageHash: 'sha256:cd9e31e04296d68a7b35cb9b3f4b9c95af1872676c5cbb07b8d9d13f6d8f4d3b',
            pageIndex: 5,
            start: 133,
            end: 180,
            sourcePageText: '"你们刚买了新装备对吧？术士的法杖、牧师的圣徽、战士的战斧——Lady Veyra订的好东西！',
            expectedTitle: '加里克爵士',
        },
        {
            chatPath: 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl',
            sourceMessageIndex: 476,
            sourceMessageHash: 'sha256:c1759caab7ac8350277f1e491e09438341ffbc91e34c745e612fb541fc38a750',
            pageIndex: 18,
            start: 970,
            end: 1023,
            sourcePageText: '马库斯伯爵摊开一份报告："Boss，Lady Veyra的情报网被城主府摧毁了，但光明会的情报网刚刚建立！',
            expectedTitle: '马库斯',
        },
    ];
    const chatPaths = [...new Set(fixtures.map(({ chatPath }) => chatPath))];
    const histories = new Map();
    for (const chatPath of chatPaths) {
        histories.set(chatPath, await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot }));
    }

    const goldMessages = new Map();
    for (const fixture of fixtures) {
        const history = histories.get(fixture.chatPath);
        const message = history.assistantMessages.find(({ sourceMessageIndex }) => (
            sourceMessageIndex === fixture.sourceMessageIndex
        ));
        assert.ok(message, `historical assistant message exists: ${fixture.chatPath}#${fixture.sourceMessageIndex}`);
        assert.equal(message.sourceMessageHash, fixture.sourceMessageHash, 'the fixture is pinned to the exact original visible message');
        const pages = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] });
        const page = pages[fixture.pageIndex];
        assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end }, 'the production segmenter page and exact source span remain the fixture boundary');
        assert.equal(Array.from(message.visibleText).slice(fixture.start, fixture.end).join(''), fixture.sourcePageText,
            'the pinned page text is an exact excerpt of the original visible message');
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
        const key = `${chatFingerprint}:${fixture.sourceMessageIndex}`;
        if (!goldMessages.has(key)) {
            goldMessages.set(key, {
                chatFingerprint,
                sourceMessageIndex: fixture.sourceMessageIndex,
                sourceMessageHash: fixture.sourceMessageHash,
                pages: [],
            });
        }
        goldMessages.get(key).pages.push({
            pageIndex: fixture.pageIndex,
            start: fixture.start,
            end: fixture.end,
            expectedKind: 'speaker',
            expectedSpeakers: [fixture.expectedTitle],
        });
    }

    const gold = {
        schemaVersion: 'galgame.structural-speaker-title-gold.v1',
        publishedSpeakerNames: [],
        messages: [...goldMessages.values()],
    };
    const result = await replayStructuralSpeakerHistory({ chatPaths, chatsRoot, gold });
    const actual = fixtures.map((fixture) => {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
        const row = result.predictions.find((candidate) => candidate.chatFingerprint === chatFingerprint
            && candidate.sourceMessageIndex === fixture.sourceMessageIndex
            && candidate.pageIndex === fixture.pageIndex);
        return {
            sourceMessageIndex: row?.sourceMessageIndex,
            sourceMessageHash: row?.sourceMessageHash,
            pageIndex: row?.pageIndex,
            start: row?.start,
            end: row?.end,
            titleText: row?.titleText,
            ruleId: row?.ruleId,
        };
    });
    assert.deepEqual(actual.map(({ ruleId, ...row }) => row), fixtures.map((fixture) => ({
        sourceMessageIndex: fixture.sourceMessageIndex,
        sourceMessageHash: fixture.sourceMessageHash,
        pageIndex: fixture.pageIndex,
        start: fixture.start,
        end: fixture.end,
        titleText: fixture.expectedTitle,
    })), 'the actual historical display pages must match the human labels and exact original spans');
    assert.ok(actual.every(({ ruleId }) => typeof ruleId === 'string' && ruleId.length > 0),
        'every attributed historical page must retain a concrete display evidence rule');
    assert.equal(result.goldScoring?.scoredPages, fixtures.length);
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('transfer-frame speech uses the explicit subject and never accepts a truncated Han span', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-replay-root');
    const visibleTexts = [
        '马库斯把报告递给你，说：“Boss，城门关闭了。”',
        '马库斯把报告递给你，报告上写着：“清晨出发。”',
        '马库斯把地图递给你：“跟我来。”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['transfer-frame-speech.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'transfer-frame-speech.jsonl'),
            sourceDigest: digest('transfer-frame-speech-source'),
            assistantMessages: visibleTexts.map((visibleText, index) => ({
                sourceMessageIndex: index + 1,
                sourceMessageHash: digest(visibleText),
                visibleText,
            })),
        }),
    });
    const spoken = result.predictions.find((row) => row.sourceMessageIndex === 1);
    const written = result.predictions.find((row) => row.sourceMessageIndex === 2);
    const transferred = result.predictions.find((row) => row.sourceMessageIndex === 3);

    assert.equal(spoken?.titleText, '马库斯');
    assert.equal(spoken?.ruleId, 'quoted-attribution');
    assert.deepEqual(spoken?.speakers, ['马库斯'], 'the title is the complete subject before 把, never a truncated name containing 把');
    assert.equal(written?.titleText, '旁白', 'written report content does not inherit its handler as the speaker');
    assert.equal(written?.candidateBucket, null, 'the report carrier remains narrative, not a dialogue candidate');
    assert.equal(transferred?.titleText, '旁白', 'a transfer action without an explicit speech cue does not assign its actor as speaker');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v54 exact historical candidate gold pins the six real production pages', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const dungeonChat = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const fixtures = [
        {
            chatPath: dungeonChat, sourceMessageIndex: 26,
            sourceMessageHash: 'sha256:b625d48c35864613e531108a8ac9a6dc42df47a387e16d89e4c9784da513a734',
            pageIndex: 13, start: 674, end: 724,
            sourcePageText: '屋内，Pippa 的声音尖叫起来：“外面那个拿大剑的！砍门！砍人！砍账本！优先级随你，反正都该死！”',
            expectedTitle: 'Pippa',
        },
        {
            chatPath: dungeonChat, sourceMessageIndex: 38,
            sourceMessageHash: 'sha256:002a2eda6a50ed7e120092f6e8b7455c2bfb54cae9e26f487db3594207d30f9b',
            pageIndex: 5, start: 250, end: 289,
            sourcePageText: '尼布则在门口跳脚，指着头顶尖叫：“诸位英雄、蠢货和可出售残骸们，房梁要掉了！”',
            expectedTitle: '尼布',
        },
        {
            chatPath: dungeonChat, sourceMessageIndex: 42,
            sourceMessageHash: 'sha256:0ea2638738614ab8f3022095ac5517a0649e94fc1c6343d789d5be8da272b4d5',
            pageIndex: 10, start: 483, end: 524,
            sourcePageText: 'Pippa检查你的黑喙账本，翻到一页时突然停住：“等等，茶里王。这里有你的描述。”',
            expectedTitle: 'Pippa',
        },
        {
            chatPath: dungeonChat, sourceMessageIndex: 50,
            sourceMessageHash: 'sha256:600f6f7b117da53b3c5c49eda174c3fa306db81d4e0eff20a3d475c85fddf8d1',
            pageIndex: 5, start: 304, end: 352,
            sourcePageText: '胖商人也立刻跪下，金边镜片掉进泥里，哭得像账本进了水：“都别打了！我愿意重新定义我的商业立场！”',
            expectedTitle: '胖商人',
        },
        {
            chatPath: dungeonChat, sourceMessageIndex: 162,
            sourceMessageHash: 'sha256:15480e92c9941d5a3b6d8277e11dd5837db40612402629e40c44c755130d5c02',
            pageIndex: 1, start: 67, end: 106,
            sourcePageText: '你负责近身硬推，我负责切后路。绳索和攀爬钩给我，我会把它们变成一条能活命的路。',
            expectedTitle: 'Lila',
        },
        {
            chatPath: 'galgame_imported_apartment5c/galgame-galgame-imported-apartment5c-entry-Apartment_5C-20260725120816.jsonl',
            sourceMessageIndex: 0,
            sourceMessageHash: 'sha256:a3a667ba0153ad75b04a5498688c11a6296b95c9122b039f41ddf20d3eec3a09',
            pageIndex: 6, start: 246, end: 269,
            sourcePageText: '她平静地说，“鉴别诊断：他又进入神游状态了。”',
            expectedTitle: 'Priya',
        },
    ];
    const chatPaths = [...new Set(fixtures.map(({ chatPath }) => chatPath))];
    const histories = new Map();
    for (const chatPath of chatPaths) {
        histories.set(chatPath, await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot }));
    }
    for (const fixture of fixtures) {
        const history = histories.get(fixture.chatPath);
        const message = history.assistantMessages.find(({ sourceMessageIndex }) => (
            sourceMessageIndex === fixture.sourceMessageIndex
        ));
        assert.ok(message, `historical assistant message exists: ${fixture.chatPath}#${fixture.sourceMessageIndex}`);
        assert.equal(message.sourceMessageHash, fixture.sourceMessageHash, 'fixture pins the original visible message');
        const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[fixture.pageIndex];
        assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end }, 'existing production page span is unchanged');
        assert.equal(Array.from(message.visibleText).slice(fixture.start, fixture.end).join(''), fixture.sourcePageText,
            'fixture excerpt exactly matches original visible source');
    }

    const ledgerHistory = histories.get(dungeonChat);
    const ledgerMessage = ledgerHistory.assistantMessages.find(({ sourceMessageIndex }) => sourceMessageIndex === 42);
    const writtenPage = createVisualNovelDisplaySegments(ledgerMessage.visibleText, { role: 'character', knownSpeakers: [] })[11];
    assert.deepEqual(writtenPage?.sourceSpan, { start: 526, end: 596 }, 'the following ledger-text negative keeps its production span');
    assert.equal(Array.from(ledgerMessage.visibleText).slice(526, 596).join(''),
        '她把账本递来，上面歪歪扭扭写着：‘携巨剑之鳞甲人，已卷入磨坊损失。若存活，悬赏 75 gold，活捉优先。’ 恭喜，你已经从“路过的倒霉蛋”',
        'the written-carrier negative exactly matches the real following page');

    const result = await replayStructuralSpeakerHistory({ chatPaths, chatsRoot });
    const actual = fixtures.map((fixture) => {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
        const row = result.predictions.find((candidate) => candidate.chatFingerprint === chatFingerprint
            && candidate.sourceMessageIndex === fixture.sourceMessageIndex
            && candidate.pageIndex === fixture.pageIndex);
        return {
            sourceMessageIndex: fixture.sourceMessageIndex,
            pageIndex: fixture.pageIndex,
            start: row?.start,
            end: row?.end,
            titleText: row?.titleText,
            ruleId: row?.ruleId,
            candidateBucket: row?.candidateBucket,
        };
    });
    assert.deepEqual(actual.map(({ ruleId, candidateBucket, ...row }) => row), fixtures.map((fixture) => ({
        sourceMessageIndex: fixture.sourceMessageIndex,
        pageIndex: fixture.pageIndex,
        start: fixture.start,
        end: fixture.end,
        titleText: fixture.expectedTitle,
    })), JSON.stringify(actual));
    assert.ok(actual.every(({ ruleId }) => typeof ruleId === 'string' && ruleId.length > 0),
        'each attributed result is backed by a production evidence rule');
    const ledgerRow = result.predictions.find((candidate) => candidate.chatFingerprint
        === createSpeakerChatFingerprint(chatsRoot, dungeonChat)
        && candidate.sourceMessageIndex === 42 && candidate.pageIndex === 11);
    assert.equal(ledgerRow?.titleText, '旁白', 'ledger contents remain narrator even immediately after Pippa’s spoken quote');
    assert.deepEqual(ledgerRow?.speakers, [], 'written-carrier narrator does not acquire Pippa speaker evidence');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v55 exact historical pages retain anonymous introductions and resolve the following same-message speaker turns', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const dungeonChat = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const seraphinaChat = 'default_Seraphina/Seraphina - 2023-5-12 @21h 32m 29s 224ms.jsonl';
    const fixtures = [
        {
            chatPath: dungeonChat, sourceMessageIndex: 36,
            sourceMessageHash: 'sha256:ec78fed1c3c5d8b7b8fc5072d1f4a56db57f920327d4dbad4b2bbcb5354f8a87',
            pageIndex: 8, start: 378, end: 449,
            sourcePageText: '物品鉴别检定：`d20 + 0 = 11`，你只能判断它不是普通货，但具体魔力不明。Pippa探头看了一眼，吹了声口哨：“哦，那玩意儿会咬人。',
            expectedTitle: 'Pippa',
            expectedRuleId: 'unrostered-action-attribution',
            expectedAnchorRuleId: 'unrostered-action-attribution',
            expectedAnchorSpan: { start: 420, end: 425 },
        },
        {
            chatPath: dungeonChat, sourceMessageIndex: 36,
            sourceMessageHash: 'sha256:ec78fed1c3c5d8b7b8fc5072d1f4a56db57f920327d4dbad4b2bbcb5354f8a87',
            pageIndex: 9, start: 451, end: 473,
            sourcePageText: '可能咬别人，也可能咬你。经典好刀，坏主意。”',
            expectedTitle: 'Pippa',
            expectedRuleId: 'full-message-structural',
            expectedAnchorRuleId: 'unrostered-action-attribution',
            expectedAnchorSpan: { start: 420, end: 425 },
        },
        {
            chatPath: seraphinaChat, sourceMessageIndex: 2,
            sourceMessageHash: 'sha256:757212f1d995fb01c49ab08faa14b806456784b44551455e23038c6be463c93c',
            pageIndex: 3, start: 108, end: 144,
            sourcePageText: '“那么，茶里王——在你踏入这片森林之前，你心里最放不下的，究竟是什么？”',
            expectedTitle: 'Seraphina',
            expectedRuleId: 'full-message-structural',
            expectedAnchorRuleId: 'same-message-intro-pronoun-backreference',
            expectedAnchorSpan: { start: 0, end: 9 },
        },
        {
            chatPath: seraphinaChat, sourceMessageIndex: 4,
            sourceMessageHash: 'sha256:7e2e539fc281a51d0d05405a10a83d2e921a3418f0ad6d4cb4e0caff21f74056',
            pageIndex: 3, start: 117, end: 150,
            sourcePageText: '“茶里王，在来到这片森林之前，你心里一直轻轻挂念着的，是什么呢？”',
            expectedTitle: 'Seraphina',
            expectedRuleId: 'full-message-structural',
            expectedAnchorRuleId: 'same-message-intro-pronoun-backreference',
            expectedAnchorSpan: { start: 0, end: 9 },
        },
    ];
    const anonymousIntroductions = [
        { chatPath: seraphinaChat, sourceMessageIndex: 2, sourceMessageHash: 'sha256:757212f1d995fb01c49ab08faa14b806456784b44551455e23038c6be463c93c', pageIndex: 1, start: 43, end: 85,
            sourcePageText: '“我是塞拉菲娜，Eldoria林间秘境的守护者，以治愈与结界守护所有误入黑暗的人。”' },
        { chatPath: seraphinaChat, sourceMessageIndex: 4, sourceMessageHash: 'sha256:7e2e539fc281a51d0d05405a10a83d2e921a3418f0ad6d4cb4e0caff21f74056', pageIndex: 1, start: 38, end: 85,
            sourcePageText: '“我是塞拉菲娜，这片林间秘境的守护者，会用微光、花香与治愈之力，静静守着每一个来到这里的人。”' },
    ];
    const chatPaths = [dungeonChat, seraphinaChat];
    const histories = new Map();
    for (const chatPath of chatPaths) histories.set(chatPath,
        await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot }));
    for (const fixture of [...fixtures, ...anonymousIntroductions]) {
        const message = histories.get(fixture.chatPath).assistantMessages.find(({ sourceMessageIndex }) => (
            sourceMessageIndex === fixture.sourceMessageIndex
        ));
        assert.ok(message, `historical assistant message exists: ${fixture.chatPath}#${fixture.sourceMessageIndex}`);
        assert.equal(message.sourceMessageHash, fixture.sourceMessageHash, 'fixture pins the original visible message');
        const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[fixture.pageIndex];
        assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end }, 'production page span stays frozen');
        assert.equal(Array.from(message.visibleText).slice(fixture.start, fixture.end).join(''), fixture.sourcePageText,
            'fixture excerpt exactly matches original visible source');
        const index = createStructuralMessageSpeakerIndex({
            fullText: message.visibleText,
            publishedSpeakerNames: [],
            sourceMessageIndex: fixture.sourceMessageIndex,
            sourceMessageHash: fixture.sourceMessageHash,
            parserVersion: 'full-message-speaker-index.v58',
        });
        const anchor = index.anchors.find((candidate) => candidate.speakerText === fixture.expectedTitle
            && candidate.utteranceSpans.some((span) => span.start < fixture.end && fixture.start < span.end));
        assert.deepEqual(anchor?.speakerSpan, fixture.expectedAnchorSpan, 'the evidence span remains bound to the named source subject');
        if (fixture.expectedAnchorRuleId) assert.equal(anchor?.ruleId, fixture.expectedAnchorRuleId);
    }

    const result = await replayStructuralSpeakerHistory({ chatPaths, chatsRoot });
    const actual = [...fixtures, ...anonymousIntroductions].map((fixture) => {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
        const row = result.predictions.find((candidate) => candidate.chatFingerprint === chatFingerprint
            && candidate.sourceMessageIndex === fixture.sourceMessageIndex
            && candidate.pageIndex === fixture.pageIndex);
        return {
            sourceMessageIndex: fixture.sourceMessageIndex,
            pageIndex: fixture.pageIndex,
            start: row?.start,
            end: row?.end,
            titleText: row?.titleText,
            ruleId: row?.ruleId,
        };
    });
    assert.deepEqual(actual.map(({ ruleId, ...row }) => row), [
        ...fixtures.map((fixture) => ({
            sourceMessageIndex: fixture.sourceMessageIndex,
            pageIndex: fixture.pageIndex,
            start: fixture.start,
            end: fixture.end,
            titleText: fixture.expectedTitle,
        })),
        ...anonymousIntroductions.map((fixture) => ({
            sourceMessageIndex: fixture.sourceMessageIndex,
            pageIndex: fixture.pageIndex,
            start: fixture.start,
            end: fixture.end,
            titleText: '？？？',
        })),
    ], JSON.stringify(actual));
    assert.ok(actual.slice(0, fixtures.length).every(({ ruleId }) => typeof ruleId === 'string' && ruleId.length > 0),
        'resolved titles keep concrete structural evidence');
    assert.deepEqual(actual.slice(0, fixtures.length).map(({ ruleId }) => ruleId),
        fixtures.map(({ expectedRuleId }) => expectedRuleId), 'historical display pages keep the expected evidence path');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v55 same-message inferences keep sound effects, new scenes, new speakers, and written carriers bounded', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v55-bounded-negative-root');
    const visibleTexts = [
        'Pippa探头看了一眼，吹了声口哨：“咻！”',
        'Seraphina将手轻轻覆在心口。\n\n“我是塞拉菲娜，守护者。”\n\n# 新场景\n她微微俯身，声音轻得像月光。\n\n“那么，你要去哪？”',
        'Seraphina将手轻轻覆在心口。\n\n“我是塞拉菲娜，守护者。”\n\nPippa说：“准备好了？”',
        'Seraphina将手轻轻覆在心口。\n\n“我是塞拉菲娜，守护者。”\n\n她翻开报告，上面写着：“行动将于黎明开始。”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: ['v55-bounded-negative.jsonl'],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, 'v55-bounded-negative.jsonl'),
            sourceDigest: digest('v55-bounded-negative-source'),
            assistantMessages: visibleTexts.map((visibleText, index) => ({
                sourceMessageIndex: index,
                sourceMessageHash: digest(`v55-bounded-negative-message-${index}`),
                visibleText,
            })),
        }),
    });
    const row = (sourceMessageIndex, pageIndex) => result.predictions.find((candidate) => (
        candidate.sourceMessageIndex === sourceMessageIndex && candidate.pageIndex === pageIndex
    ));
    assert.equal(row(0, 0)?.titleText, '旁白', 'a whistle represented only by a sound token is not speaker speech');
    assert.equal(row(1, 3)?.titleText, '旁白', 'same-message pronoun continuity stops at a new scene title');
    assert.equal(row(2, 2)?.titleText, 'Pippa', 'a new speaker’s direct quote takes precedence over the prior introduction');
    assert.equal(row(3, 2)?.titleText, '旁白', 'written report contents do not inherit the introduced character');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v56 anonymous creature self-naming quote gets only the anonymous display title', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const chatPath = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const history = await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot });
    const message = history.assistantMessages.find(({ sourceMessageIndex }) => sourceMessageIndex === 0);
    assert.ok(message, 'the canonical source message exists');
    assert.equal(message.sourceMessageHash,
        'sha256:655c7df055d87f6dfe5cb1fcc338254a4eac09f7f3c59b874fdfa573e351e9ea',
        'the original visible source hash is pinned');
    const pageIndex = 4;
    const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[pageIndex];
    assert.deepEqual(page?.sourceSpan, { start: 586, end: 878 }, 'the production page span remains unchanged');
    assert.equal(Array.from(message.visibleText).slice(586, 878).join(''),
        '"Prepare ta be amb\'shed by Gribble da Goblin, da terror of... well, dis bit o da roadside, really." The creature pulled out a blade so rusty it had tetanus written all over it. It wore a helmet that was suspiciously similar to an upturned chamber pot, complete with suspiciously brown stains.',
        'the exact production page source is pinned');

    const result = await replayStructuralSpeakerHistory({ chatPaths: [chatPath], chatsRoot });
    const row = result.predictions.find((candidate) => candidate.chatFingerprint
        === createSpeakerChatFingerprint(chatsRoot, chatPath)
        && candidate.sourceMessageIndex === 0 && candidate.pageIndex === pageIndex);
    assert.equal(row?.start, 586);
    assert.equal(row?.end, 878);
    assert.equal(row?.titleText, '？？？', 'the first-time speaking creature has an anonymous title');
    assert.equal(row?.ruleId, 'anonymous-first-appearance');
    assert.deepEqual(row?.speakers, [], 'the self-mentioned name is not extracted as speaker identity');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v57 exact historical local-action and quote-continuation titles are source-bound', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const chatPath = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const fixtures = [
        {
            sourceMessageIndex: 20,
            sourceMessageHash: 'sha256:448d4049d5494fe5da229ecb8fb356b919c3779bde0ce85bb4c94823c1712b61',
            pageIndex: 4, start: 175, end: 202,
            sourcePageText: '“好了，罐头先生，现在你看起来像一堆失败的露营用品。”',
            expectedTitle: '尼布',
        },
        {
            sourceMessageIndex: 34,
            sourceMessageHash: 'sha256:6b42ce8475296f5002f6c8362720a0dfadbdc25338175866478ff4593477d34e',
            pageIndex: 11, start: 603, end: 665,
            sourcePageText: 'Pippa踢了踢莫里克的尸体，捡起一串钥匙，咧嘴道：“大剑先生，你救了我一命。虽然你中途死了两次，流程很难看，但结果能用。”',
            expectedTitle: 'Pippa',
        },
        {
            sourceMessageIndex: 248,
            sourceMessageHash: 'sha256:25529abce52c0f2459ffbfcf741fd658bec39a8e7d4eba4c887b5364691d3b6f',
            pageIndex: 15, start: 837, end: 874,
            sourcePageText: '这种货在黑市上很抢手,卫兵队和赏金猎人都爱用。每件45金币,两件90金币。',
            quoteStart: 805, quoteEnd: 875,
            expectedTitle: '独眼乔',
        },
        {
            sourceMessageIndex: 248,
            sourceMessageHash: 'sha256:25529abce52c0f2459ffbfcf741fd658bec39a8e7d4eba4c887b5364691d3b6f',
            pageIndex: 16, start: 875, end: 885,
            sourcePageText: '尼布立刻举手:"卖!',
            expectedTitle: '尼布',
            negativeAgainstPreviousSpeaker: true,
        },
    ];
    const history = await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot });
    for (const fixture of fixtures) {
        const message = history.assistantMessages.find(({ sourceMessageIndex }) => (
            sourceMessageIndex === fixture.sourceMessageIndex
        ));
        assert.ok(message, `historical assistant message exists: #${fixture.sourceMessageIndex}`);
        assert.equal(message.sourceMessageHash, fixture.sourceMessageHash, 'fixture pins the original visible source');
        const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[fixture.pageIndex];
        assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end }, 'the production page span remains frozen');
        assert.equal(Array.from(message.visibleText).slice(fixture.start, fixture.end).join(''), fixture.sourcePageText,
            'the exact production page excerpt remains source-bound');
        if (fixture.quoteStart !== undefined) {
            const index = createStructuralMessageSpeakerIndex({
                fullText: message.visibleText,
                publishedSpeakerNames: [],
                sourceMessageIndex: fixture.sourceMessageIndex,
                sourceMessageHash: fixture.sourceMessageHash,
                parserVersion: 'full-message-speaker-index.v58',
            });
            assert.ok(index.anchors.some((anchor) => anchor.speakerText === fixture.expectedTitle
                && anchor.utteranceSpans?.some((span) => span.start === fixture.quoteStart + 1
                    && span.end === fixture.quoteEnd - 1)),
            'speaker evidence owns the exact original closed quote span');
            assert.ok(!index.anchors.some((anchor) => anchor.speakerText === '尼布'
                && anchor.utteranceSpans?.some((span) => span.start === fixture.quoteStart + 1
                    && span.end === fixture.quoteEnd - 1)), 'the next speaker cannot retroactively own a long quote');
            assert.ok(!index.anchors.some((anchor) => anchor.utteranceSpans?.some((span) => span.start === 795
                && span.end === 799)), 'the separate metal-clank sound quote stays narration');
        }
    }

    const result = await replayStructuralSpeakerHistory({ chatPaths: [chatPath], chatsRoot });
    const fingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const actual = fixtures.map((fixture) => {
        const row = result.predictions.find((candidate) => candidate.chatFingerprint === fingerprint
            && candidate.sourceMessageIndex === fixture.sourceMessageIndex
            && candidate.pageIndex === fixture.pageIndex);
        return { sourceMessageIndex: fixture.sourceMessageIndex, pageIndex: fixture.pageIndex,
            start: row?.start, end: row?.end, titleText: row?.titleText, ruleId: row?.ruleId };
    });
    assert.deepEqual(actual.map(({ ruleId, ...row }) => row), fixtures.map((fixture) => ({
        sourceMessageIndex: fixture.sourceMessageIndex,
        pageIndex: fixture.pageIndex,
        start: fixture.start,
        end: fixture.end,
        titleText: fixture.expectedTitle,
    })), JSON.stringify(actual));
    assert.ok(actual.every(({ ruleId }) => typeof ruleId === 'string' && ruleId.length > 0),
        'historical titles retain structural rule IDs');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v57 local attribution and quote continuation stop at written carriers, no-cue transfers, and ambiguity', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v57-bounded-negative-root');
    const chatPath = 'v57-bounded-negative.jsonl';
    const visibleTexts = [
        'Pippa翻开账本，上面写着：“欠款三枚金币。”',
        '尼布把地图递给你：“北门现在无人。”',
        '他小声说：“行动。”',
        '尼布立刻举手：“卖！”',
        'Pippa看向塔楼，“轰”地一声，塔楼坍塌：“快跑！”',
        'Pippa看向塔楼，“轰”地一声塔楼坍塌：“快跑！”',
        'Pippa看向塔楼，“轰”地一声塔楼发出金属声：“快跑！”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v57-bounded-negative-source'),
            assistantMessages: visibleTexts.map((visibleText, index) => ({
                sourceMessageIndex: index,
                sourceMessageHash: digest(`v57-bounded-negative-message-${index}`),
                visibleText,
            })),
        }),
    });
    const firstPage = (messageIndex) => result.predictions.find((row) => row.sourceMessageIndex === messageIndex
        && row.pageIndex === 0);
    assert.equal(firstPage(0)?.titleText, '旁白', 'a ledger carrier does not turn quoted writing into Pippa speech');
    assert.equal(firstPage(1)?.titleText, '旁白', 'transferring a map without a speech predicate is not enough attribution evidence');
    assert.equal(firstPage(2)?.titleText, '旁白', 'a pronoun without a unique local named anchor remains unresolved/fallback');
    assert.notEqual(firstPage(3)?.titleText, '独眼乔', 'a new speaker quote cannot inherit the earlier quote owner');
    assert.equal(firstPage(4)?.titleText, '旁白', 'an independent event after an SFX cannot inherit the prior actor');
    assert.equal(firstPage(5)?.titleText, '旁白', 'an unpunctuated noun-led event after an SFX cannot inherit the prior actor');
    assert.equal(firstPage(6)?.titleText, '旁白', 'a noun-led event cannot pass through a later voice-framed sound label');
    const directActionContinuation = createStructuralMessageSpeakerIndex({
        fullText: 'Durik“轰”砸碎一个虚空法师的尸体：“还有老大？”',
        sourceMessageHash: digest('Durik“轰”砸碎一个虚空法师的尸体：“还有老大？”'),
        sourceMessageIndex: 9999,
        publishedSpeakerNames: [],
    });
    assert.ok(directActionContinuation.anchors.some((anchor) => anchor.speakerText === 'Durik'
        && anchor.utteranceSpans?.some((span) => Array.from('Durik“轰”砸碎一个虚空法师的尸体：“还有老大？”').slice(span.start, span.end).join('') === '还有老大？')),
    'a sound effect followed immediately by a direct action predicate can retain its unique action actor');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v56 anonymous display title does not capture written announcements or sound-only descriptions', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v56-bounded-negative-root');
    const chatPath = 'v56-anonymous-negatives.jsonl';
    const visibleTexts = [
        'A notice on the wall read: "A goblin will attack at dawn."',
        'A goblin screeched out like a cat in a cheese press, baring its teeth.',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v56-anonymous-negative-source'),
            assistantMessages: visibleTexts.map((visibleText, index) => ({
                sourceMessageIndex: index,
                sourceMessageHash: digest(`v56-anonymous-negative-message-${index}`),
                visibleText,
            })),
        }),
    });
    const row = (sourceMessageIndex) => result.predictions.find((candidate) => (
        candidate.sourceMessageIndex === sourceMessageIndex && candidate.pageIndex === 0
    ));
    assert.equal(row(0)?.titleText, '旁白', 'quoted source-carried text stays narrator');
    assert.deepEqual(row(0)?.speakers, []);
    assert.notEqual(row(1)?.titleText, '？？？', 'sound description without a language-bearing quote stays non-speaker');
    assert.ok(['旁白', '未识别'].includes(row(1)?.titleText), JSON.stringify(row(1)));
    assert.deepEqual(row(1)?.speakers, []);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v58 inferred structure probes stay source-bound and resolve only bounded local evidence', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const dungeonChat = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const fixtures = [
        { chatPath: 'galgame_aiimport_aa5full_ms1zd4rg_director/galgame-galgame-aiimport-aa5_ms1zd4rg_9bd19e1b-main-Galgame_AIImport_AA5Full_ms1zd4rg_Director-20260726155746.jsonl', sourceMessageIndex: 2, pageIndex: 11, start: 334, end: 360, sourceMessageHash: 'sha256:704f19ef3b77c8331ba2d9b3c0e44dd6550560a50b567dd649a7312a8e4aa612', sourcePageText: '“要继续敲第二下吗？还是先让Ren试着接入控制台？”', expectedTitle: 'Mira' },
        { chatPath: 'galgame_imported_apartment5c/galgame-galgame-imported-apartment5c-entry-Apartment_5C-20260725120816.jsonl', sourceMessageIndex: 4, pageIndex: 5, start: 170, end: 211, sourceMessageHash: 'sha256:f07580c17810dc1bcdf109bc214e5aa6af30659b4d5fbc4da3e746bd89e38438', sourcePageText: '“姓名、地点、时间。Sam，你在 5C。你手里拿着盘子。你刚才没有撞到头，对吧？”', expectedTitle: 'Priya' },
        { chatPath: dungeonChat, sourceMessageIndex: 44, pageIndex: 3, start: 111, end: 152, sourceMessageHash: 'sha256:c81228b1fb7dd97e61693e4526ef76951af6aec4380d8351d24b08eb99a4c213', sourcePageText: '她说，“这种东西通常不是响给别人听的，是响给你的脑子听的。然后你的脑子就辞职了。”', expectedTitle: 'Pippa' },
        { chatPath: dungeonChat, sourceMessageIndex: 68, pageIndex: 10, start: 528, end: 560, sourceMessageHash: 'sha256:8e665f187991637fccb58505c1e6cb29ad870f525ed6814cca3325c4a089b3cb', sourcePageText: '维斯坎特停下手，慢慢抬眼：“预检室的人，上来这么久，是死了吗？”', expectedTitle: '维斯坎特' },
        { chatPath: dungeonChat, sourceMessageIndex: 84, pageIndex: 8, start: 347, end: 411, sourceMessageHash: 'sha256:0b5ae1d35670e6ea5cb935cc4d2c2f5a90651c72215fa8cdfec1ad8b55ad0664', sourcePageText: '外头收账鸦撞门，第一次破门检定：`d20 + 3 = 11`，失败。门板震得灰尘乱落，一只鸟嘴面具从门缝里骂道：“开门，杂碎！”', expectedTitle: '？？？' },
        { chatPath: dungeonChat, sourceMessageIndex: 172, pageIndex: 3, start: 128, end: 191, sourceMessageHash: 'sha256:8595fb3afa7e6810dc903e5d17fa3c1f024ddaedd69eb4f54e663c6fcd3a880a', sourcePageText: '凹槽下面连着三根细簧，填错东西会把门后那块骨板抬起来，放出响铃，同时把里面的灰蜡机关全部激活。简单说，门会先记住你，再恨你。”', expectedTitle: 'Lila' },
        { chatPath: dungeonChat, sourceMessageIndex: 188, pageIndex: 7, start: 375, end: 381, sourceMessageHash: 'sha256:e4ad55a6797c924a08b716d44707345d31bf29219b422f0795e71f85ef43b813', sourcePageText: '“第三组？”', expectedTitle: '？？？' },
        { chatPath: dungeonChat, sourceMessageIndex: 204, pageIndex: 7, start: 353, end: 380, sourceMessageHash: 'sha256:2f84648e153e73d64eae1e5d488c55b579027a67a39630b38c2728bf48a75360', sourcePageText: '这里的建筑不讲道德，只讲用途，像一名特别没品的会计。”', expectedTitle: '赫娅' },
        { chatPath: dungeonChat, sourceMessageIndex: 270, pageIndex: 15, start: 1029, end: 1134, sourceMessageHash: 'sha256:6eaf83eb6caa47457b434a1dfd7ef86a3b3ecbd435503f23eef46cb0b734bf78', sourcePageText: 'Celestia跟在后面,她换了一身干净的白袍,金发湿漉漉的,像刚洗完澡,胸口的链甲反射着窗外的阳光,晃得你眼睛疼:"我刚洗了个澡~感觉整个人都重生了~"她走到你床边,坐下来,胸部几乎贴到你脸上:"你呢,英雄?', expectedTitle: 'Celestia' },
        { chatPath: '伊芙琳·灰烬誓约/伊芙琳·灰烬誓约 - 2026-05-22@01h00m29s145ms.jsonl', sourceMessageIndex: 18, pageIndex: 13, start: 466, end: 534, sourceMessageHash: 'sha256:6c1ae3babd8e324e9b1dceb2c2e03b9ffd6c9d797da21ee7aba5f1df4ac1b84b', sourcePageText: '继续道：\n“主街和北门都已被教会盯住。议会旧年在黑松堡留过一条抄写道，从这里往西，有一道封死井口，能通到城墙外的磨坊废窖……若还没塌。”', expectedTitle: '奥斯文' },
    ];
    const chatPaths = [...new Set(fixtures.map(({ chatPath }) => chatPath))];
    const histories = new Map();
    for (const chatPath of chatPaths) histories.set(chatPath,
        await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot }));
    for (const fixture of fixtures) {
        const message = histories.get(fixture.chatPath).assistantMessages.find(({ sourceMessageIndex }) => (
            sourceMessageIndex === fixture.sourceMessageIndex
        ));
        assert.ok(message, `historical assistant message exists: ${fixture.chatPath}#${fixture.sourceMessageIndex}`);
        assert.equal(message.sourceMessageHash, fixture.sourceMessageHash, 'probe pins the complete visible message');
        const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[fixture.pageIndex];
        assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end }, 'production page span is unchanged');
        assert.equal(Array.from(message.visibleText).slice(fixture.start, fixture.end).join(''), fixture.sourcePageText,
            'the probe is bound to the exact original page text');
    }
    const result = await replayStructuralSpeakerHistory({ chatPaths, chatsRoot });
    const predictions = fixtures.map((fixture) => {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
        const row = result.predictions.find((candidate) => candidate.chatFingerprint === chatFingerprint
            && candidate.sourceMessageIndex === fixture.sourceMessageIndex
            && candidate.pageIndex === fixture.pageIndex);
        return { fixture, row };
    });
    const matchedProbes = predictions.filter(({ fixture, row }) => row?.titleText === fixture.expectedTitle);
    assert.ok(matchedProbes.length >= 8,
        `at least eight of the ten non-gold probes resolve to their inferred display title: ${JSON.stringify(predictions.map(({ fixture, row }) => ({ expected: fixture.expectedTitle, actual: row?.titleText, ruleId: row?.ruleId })))}`);
    assert.equal(predictions[2].row?.titleText, 'Pippa', 'the quote is assigned from the adjacent “她说” cue and nearest named action subject');
    assert.equal(predictions[5].row?.titleText, 'Lila',
        'a quote opened by Lila remains hers through the exact matching closing quote, even when its body spans display pages');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v60 prior-page action subject resolves the exact historical standalone quote page', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const fixture = {
        chatPath: 'galgame_aiimport_aa5full_uap6vnuap6m3_director/galgame-galgame-aiimport-aa5_uap6vnuap6m3_3d6a17db-main-Galgame_AIImport_AA5Full_uap6vnuap6m3_Director-20260728160740.jsonl',
        sourceMessageIndex: 2,
        sourceMessageHash: 'sha256:0796eab8987b6c465cc30f56be30bf68945c13243f2414eaae291ef52bd8a9fc',
        pageIndex: 2,
        start: 91,
        end: 97,
        expectedTitle: 'Mika',
    };
    const history = await readHistoryChat(path.join(chatsRoot, fixture.chatPath), { chatsRoot });
    const message = history.assistantMessages.find(({ sourceMessageIndex }) => sourceMessageIndex === fixture.sourceMessageIndex);
    assert.ok(message);
    assert.equal(message.sourceMessageHash, fixture.sourceMessageHash);
    const page = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] })[fixture.pageIndex];
    assert.deepEqual(page?.sourceSpan, { start: fixture.start, end: fixture.end });
    const result = await replayStructuralSpeakerHistory({ chatPaths: [fixture.chatPath], chatsRoot });
    const fingerprint = createSpeakerChatFingerprint(chatsRoot, fixture.chatPath);
    const row = result.predictions.find((candidate) => candidate.chatFingerprint === fingerprint
        && candidate.sourceMessageIndex === fixture.sourceMessageIndex && candidate.pageIndex === fixture.pageIndex);
    assert.equal(row?.titleText, fixture.expectedTitle);
    assert.equal(row?.ruleId, 'prior-page-action-subject-continuation');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v58 detached continuation cue is local and refuses competing speakers and written carriers', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v58-detached-cue-root');
    const chatPath = 'v58-detached-cue-bounds.jsonl';
    const visibleTexts = [
        '奥斯文咽了口气，继续道：\n“主街已被教会盯住。”',
        '奥斯文和Pippa对视，继续道：\n“主街已被教会盯住。”',
        '公告上写着，继续道：\n“北门开放。”',
        '奥斯文翻开账本，上面写着：\n“继续道：北门开放。”',
        'Pippa说：“我来。”\n奥斯文继续道：\n“现在走。”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v58-detached-cue-bounds-source'),
            assistantMessages: visibleTexts.map((visibleText, sourceMessageIndex) => ({
                sourceMessageIndex, sourceMessageHash: digest(`v58-detached-cue-message-${sourceMessageIndex}`), visibleText,
            })),
        }),
    });
    const page = (sourceMessageIndex, pageIndex = 0) => result.predictions.find((row) => (
        row.sourceMessageIndex === sourceMessageIndex && row.pageIndex === pageIndex
    ));
    assert.equal(page(0, 1)?.titleText, '奥斯文', 'an immediate named continuation cue can own its quote');
    assert.equal(page(1)?.titleText, '旁白', 'competing subjects keep the continuation unattributed');
    assert.equal(page(2)?.titleText, '旁白', 'a source carrier does not become a speaker');
    assert.equal(page(3)?.titleText, '旁白', 'quoted written content does not inherit a character');
    assert.equal(page(4)?.titleText, 'Pippa', 'a new explicit speaker remains ahead of later continuation text');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v59 carries a pronoun-led quoted turn only from one explicit source anchor in the prior two pages', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v59-pronoun-carry-root');
    const chatPath = 'v59-pronoun-carry.jsonl';
    const visibleTexts = [
        'Pippa说：“我先去。”\n\n尼布说：“我也去。”\n\n它重新坐回王座：“试炼开始。”',
        '大厅里的寒气骤然加重。\n\n冰霜巨人领主继续说：“击败四位领主。”\n\n它重新坐回王座：“试炼……开始……”',
        'Pippa说：“我先去。”\n\n账本上写着：“它重新坐回王座：试炼开始。”',
        'Pippa说：“我先去。”\n\n它敲了一下：“咣！”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v59-pronoun-carry-source'),
            assistantMessages: visibleTexts.map((visibleText, sourceMessageIndex) => ({
                sourceMessageIndex,
                sourceMessageHash: digest(`v59-pronoun-carry-message-${sourceMessageIndex}`),
                visibleText,
            })),
        }),
    });
    const pages = (sourceMessageIndex) => result.predictions.filter((row) => (
        row.sourceMessageIndex === sourceMessageIndex
    ));
    const continuation = pages(1).find((row) => row.ruleId === 'recent-pronoun-speaker-continuation');
    assert.equal(continuation?.titleText, '冰霜巨人');
    assert.equal(pages(0).some((row) => row.ruleId === 'recent-pronoun-speaker-continuation'), false,
        'two competing source anchors do not carry');
    assert.equal(pages(2).some((row) => row.ruleId === 'recent-pronoun-speaker-continuation'), false,
        'written-carrier speech does not carry');
    assert.equal(pages(3).some((row) => row.ruleId === 'recent-pronoun-speaker-continuation'), false,
        'a sound effect is not a speaking turn');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v59 exact historical continuation stays bound to the original source and two preceding page spans', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const chatPath = 'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl';
    const sourceMessageIndex = 572;
    const sourceMessageHash = 'sha256:b68fc04ee1421d93f5bb7854610361ba148a99d243d92f5b5a52355e20786c8f';
    const history = await readHistoryChat(path.join(chatsRoot, chatPath), { chatsRoot });
    const message = history.assistantMessages.find((row) => row.sourceMessageIndex === sourceMessageIndex);
    assert.ok(message);
    assert.equal(message.sourceMessageHash, sourceMessageHash);
    const pages = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] });
    assert.deepEqual(pages[12]?.sourceSpan, { start: 578, end: 629 });
    assert.deepEqual(pages[13]?.sourceSpan, { start: 631, end: 690 });
    assert.deepEqual(pages[14]?.sourceSpan, { start: 692, end: 725 });
    assert.equal(Array.from(message.visibleText).slice(692, 725).join(''),
        '它重新坐回王座，冰霜战锤"咣"的敲在地上："试炼...开始..."');

    const result = await replayStructuralSpeakerHistory({ chatPaths: [chatPath], chatsRoot });
    const fingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
    const row = result.predictions.find((candidate) => candidate.chatFingerprint === fingerprint
        && candidate.sourceMessageIndex === sourceMessageIndex && candidate.pageIndex === 14);
    assert.equal(row?.titleText, '冰霜巨人');
    assert.equal(row?.ruleId, 'recent-pronoun-speaker-continuation');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v61 ranks quote evidence by source-bound strength and abstains on same-rank conflict', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v61-ranked-quotes-root');
    const chatPath = 'v61-ranked-quotes.jsonl';
    const visibleTexts = [
        'Nadia举起手：“快走。”Sam说道。',
        'Nadia说道：“快走。”Sam答道。',
        'Nadia没有回头。\n\n“你来了啊。”',
        '账本上写着：“北门开放。”',
        'Pippa说：“他说‘快走。’然后离开。”',
    ];
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        publishedSpeakerNames: ['Nadia', 'Sam', 'Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v61-ranked-quotes-source'),
            assistantMessages: visibleTexts.map((visibleText, sourceMessageIndex) => ({
                sourceMessageIndex,
                sourceMessageHash: digest(`v61-ranked-quotes-${sourceMessageIndex}`),
                visibleText,
            })),
        }),
    });
    const messageRows = (sourceMessageIndex) => result.predictions.filter((row) => row.sourceMessageIndex === sourceMessageIndex);
    assert.ok(messageRows(0).some((row) => row.kind === 'speaker' && row.speakers.includes('Sam')),
        'an explicit adjacent post-quote speech cue outranks a weaker action subject');
    assert.ok(!messageRows(1).some((row) => row.kind === 'speaker' && row.speakers.some((speaker) => ['Nadia', 'Sam'].includes(speaker))),
        'different speakers at the same strongest quote rank remain unattributed');
    assert.ok(messageRows(2).some((row) => row.kind === 'speaker' && row.speakers.includes('Nadia')),
        'predicate particles are not absorbed into the exact source speaker span');
    assert.ok(!messageRows(3).some((row) => row.kind === 'speaker'),
        'written carrier text does not become character speech');
    assert.ok(messageRows(4).some((row) => row.kind === 'speaker' && row.speakers.includes('Pippa')),
        'the nested quote remains inside the parent speaker turn');
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v61.2 routes character-expression and actor-vocalization quotes through the ranker', () => {
    const expressionText = '尼布听完你的计划，露出一种“我讨厌英勇，但我更讨厌被卖去旧磨坊”\n\n的表情。';
    const expressionIndex = createStructuralMessageSpeakerIndex({
        fullText: expressionText, sourceMessageIndex: 1, sourceMessageHash: digest(expressionText),
        publishedSpeakerNames: ['尼布'], parserVersion: 'full-message-speaker-index.v68',
    });
    assert.ok(expressionIndex.anchors.some((anchor) => anchor.speakerText === '尼布'
        && anchor.ruleId === 'character-expression-subject'), 'a unique character expression is a bounded display-title source');

    const vocalizationText = '霜咬“吼”的咆哮：“够了！你们通过了我的试炼！”';
    const vocalizationIndex = createStructuralMessageSpeakerIndex({
        fullText: vocalizationText, sourceMessageIndex: 2, sourceMessageHash: digest(vocalizationText),
        publishedSpeakerNames: ['尼布'], parserVersion: 'full-message-speaker-index.v68',
    });
    assert.ok(vocalizationIndex.anchors.some((anchor) => anchor.speakerText === '霜咬'
        && anchor.ruleId === 'actor-vocalization-action'), 'a named vocalization immediately introducing speech ranks as action evidence');

    const isolatedSoundIndex = createStructuralMessageSpeakerIndex({
        fullText: '霜咬“吼”的咆哮。', sourceMessageIndex: 3, sourceMessageHash: 'sha256:isolated-sound-vocalization',
        parserVersion: 'full-message-speaker-index.v68',
    });
    assert.equal(isolatedSoundIndex.anchors.length, 0, 'an isolated sound quote does not become a speaking turn');
});

test('v66 keeps a source-bound quote winner when the page-local Han parser swallows a voice modifier', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v66-boundary-variant');
    const chatPath = 'v66-boundary-variant.jsonl';
    const visibleText = '瑞恩小声说：“至高领袖，我听说天海港黑市深处有个神秘工匠——龙铸者。他是龙族后裔，专门处理龙族材料。\n\n但他的工坊位置是秘密，而且收费极高。”';
    const basePages = createVisualNovelDisplaySegments(visibleText, { role: 'character', knownSpeakers: [] });
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v66-boundary-variant-source'),
            assistantMessages: [{ sourceMessageIndex: 6500, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    const messageRows = result.predictions.filter((row) => row.sourceMessageIndex === 6500);
    const firstQuotePage = basePages[0];
    const firstRow = messageRows.find((row) => row.start === firstQuotePage.sourceSpan.start);
    assert.equal(firstRow?.titleText, '瑞恩', 'the first visible page must use the resolved quote speaker');
    assert.ok(firstRow?.speakers.includes('瑞恩'));
    const continuationPage = basePages[1];
    const continuationRow = messageRows.find((row) => row.start === continuationPage.sourceSpan.start);
    assert.equal(continuationRow?.titleText, '瑞恩', 'the quote continuation keeps the same speaker');
    assert.equal(result.dialogueCandidateBuckets.unresolvedCandidates, 0);
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v68 historical object-transfer frame titles the exact original page without roster data', {
    skip: !existsSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/default-user/chats')),
}, async () => {
    const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const chatsRoot = path.join(repositoryRoot, 'data', 'default-user', 'chats');
    const chatPath = path.join(chatsRoot,
        'galgame_imported_dungeon_master/galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140.jsonl');
    const history = await readHistoryChat(chatPath, { chatsRoot });
    const message = history.assistantMessages.find(({ sourceMessageIndex }) => sourceMessageIndex === 144);
    assert.ok(message);
    assert.equal(message.sourceMessageHash, 'sha256:b1e345145fe3da31419fccb61240b9a00fc21468094a852d5f16f15c4813d7a1');
    const pages = createVisualNovelDisplaySegments(message.visibleText, { role: 'character', knownSpeakers: [] });
    const page = pages[10];
    assert.deepEqual(page?.sourceSpan, { start: 488, end: 563 });
    assert.equal(page?.text, '玛赫拉把一把生锈钥匙丢给你，上面挂着一块灰木牌：“这是礼拜堂废井台外门的旧锁钥匙，应该还能用。别太指望它，钥匙这东西跟誓言一样，老了以后都不太可靠。”');
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText: message.visibleText,
        publishedSpeakerNames: [],
        sourceMessageIndex: message.sourceMessageIndex,
        sourceMessageHash: message.sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v68',
    });
    const title = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex,
        fullText: message.visibleText,
        sourceMessageIndex: message.sourceMessageIndex,
        sourceMessageHash: message.sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v68',
        coreSpan: page.sourceSpan,
        pageType: page.type,
        previousPageSpans: pages.slice(0, 10).map(({ sourceSpan, type }) => ({ sourceSpan, pageType: type })),
    });
    assert.equal(title?.text, '玛赫拉');
    assert.equal(title?.ruleId, 'unrostered-action-attribution');
    assert.deepEqual(page.sourceSpan, { start: 488, end: 563 }, 'title inference cannot change the production page span');
});

test('v66 replay projects one open source quote across all generated pages without unresolved speakers', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v66-open-quote-replay');
    const chatPath = 'v66-open-quote-replay.jsonl';
    const visibleText = 'Pippa拍了拍你的肩膀:"好,现在我们得决定招谁。\n\n我建议招Celestia(80金)和Durik(80金)。\n\nCelestia能治疗能输出,Durik能抗能砍,我们就有了一个完整的五人小队:你当主力输出,我当法师炮台,Celestia当奶妈,Durik当肉盾,尼布当……呃……吉祥物?"';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v66-open-quote-replay-source'),
            assistantMessages: [{ sourceMessageIndex: 6606, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    const rows = result.predictions.filter((row) => row.sourceMessageIndex === 6606);
    assert.equal(rows.length, 3, 'the replay uses the original three production page spans');
    assert.deepEqual(rows.map((row) => row.titleText), ['Pippa', 'Pippa', 'Pippa']);
    assert.equal(result.dialogueCandidateBuckets.unresolvedCandidates, 0);
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v76 carries the last explicit speaker through one short pronoun action bridge', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v76-pronoun-bridge');
    const chatPath = 'pronoun-bridge.jsonl';
    const visibleText = 'Lila说：“先听我说。”\n\n她笑了一下，很轻。\n\n“现在我们走。”';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v76-pronoun-bridge-source'),
            assistantMessages: [{ sourceMessageIndex: 7600, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    const index = createStructuralMessageSpeakerIndex({
        fullText: visibleText, sourceMessageIndex: 7600, sourceMessageHash: digest(visibleText),
        parserVersion: 'full-message-speaker-index.v76',
    });
    const lastQuote = result.predictions.find((row) => row.sourceMessageIndex === 7600
        && row.speakers.includes('Lila') && row.ruleId === 'full-message-structural');
    assert.ok(lastQuote, 'the later quote inherits the previous explicit speaker across the short pronoun bridge');
    assert.equal(result.unattributedDialogueCandidates, 0);
    assert.ok(index.anchors.some((anchor) => anchor.ruleId === 'same-speaker-pronoun-quote-continuation'));
    assert.equal(result.parserVersion, 'full-message-speaker-index.v86');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v76 does not carry a speaker across a scene boundary or over a new explicit speaker', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v76-pronoun-bridge-guards');
    const chatPath = 'bridge-guards.jsonl';
    const visibleText = 'Lila说：“第一句。”\n\n新场景：夜晚\n\n她笑了一下。\n\n“第二句。”\n\n守卫队长说：“站住！”';
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath], chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v76-pronoun-bridge-guards-source'),
            assistantMessages: [{ sourceMessageIndex: 7601, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    const rows = result.predictions.filter((row) => row.sourceMessageIndex === 7601);
    const index = createStructuralMessageSpeakerIndex({
        fullText: visibleText, sourceMessageIndex: 7601, sourceMessageHash: digest(visibleText),
        parserVersion: 'full-message-speaker-index.v76',
    });
    assert.ok(rows.some((row) => row.kind === 'narration' && row.titleText === '旁白'),
        'a scene boundary prevents continuation from the prior actor');
    assert.ok(rows.some((row) => row.speakers.includes('守卫队长')), 'a new local speaker cue takes precedence');
    assert.ok(!index.anchors.some((anchor) => anchor.ruleId === 'same-speaker-pronoun-quote-continuation'
        && anchor.utteranceSpans.some((span) => span.start > visibleText.indexOf('新场景'))),
    'the continuation rule stays inside one scene');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v77 recognizes post-quote voice reporting for anonymous actors and carries the neutral title through a pronoun action', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v77-anonymous-postquote');
    const chatPath = 'anonymous-postquote.jsonl';
    const visibleText = '*地精格里布尔挥舞着那把锈迹斑斑的弯刀，在泥泞的道路上跳来跳去。*\n\n'
        + '"嘿嘿嘿！交出你的金币，不然俺就把你的肠子拽出来当腰带！"*地精用尖锐刺耳的声音威胁道，同时从腰间摸出一个小瓶。*\n\n'
        + '"这可是俺秘制的炸弹！要不要尝尝？"*它得意地晃了晃小瓶，脸上露出猥琐的笑容。*';
    const index = createStructuralMessageSpeakerIndex({
        fullText: visibleText,
        sourceMessageIndex: 7700,
        sourceMessageHash: digest(visibleText),
        parserVersion: 'full-message-speaker-index.v77',
    });
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v77-anonymous-postquote-source'),
            assistantMessages: [{ sourceMessageIndex: 7700, sourceMessageHash: digest(visibleText), visibleText }],
        }),
    });
    assert.equal(index.anchors.length, 0, 'generic role labels do not become guessed character identities');
    assert.deepEqual(index.unresolvedDialogueSpans.map((span) => span.reasonId), [
        'anonymous-first-appearance', 'anonymous-first-appearance',
    ]);
    const rows = result.predictions.filter((row) => row.sourceMessageIndex === 7700
        && row.pageKind === 'unattributed-dialogue');
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.titleText === '？？？' && row.ruleId === 'anonymous-first-appearance'));
    assert.equal(result.sourceUnchanged, true);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v77 keeps a rostered post-quote speaker and rejects written-carrier text as a speaker cue', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v77-postquote-guards');
    const chatPath = 'postquote-guards.jsonl';
    const visibleTexts = [
        '“停下！”Pippa用低沉的声音威胁道，同时抬起手。',
        '账本上写着：“立即撤退。”',
        '“滚开！”陌生人用沙哑的声音警告道。\n\n新场景：夜晚\n\n“站住！”她转过身。',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: 7710 + index,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: ['Pippa'],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v77-postquote-guards-source'),
            assistantMessages,
        }),
    });
    const namedPage = result.predictions.find((row) => row.sourceMessageIndex === 7710);
    const writtenPage = result.predictions.find((row) => row.sourceMessageIndex === 7711);
    const afterScenePage = result.predictions.find((row) => row.sourceMessageIndex === 7712
        && row.candidateBucket === 'narratorFallback');
    assert.ok(namedPage?.kind === 'speaker' && namedPage.speakers.includes('Pippa'), JSON.stringify(namedPage));
    assert.equal(writtenPage?.titleText, '旁白');
    assert.notEqual(writtenPage?.titleText, '？？？');
    assert.equal(afterScenePage?.titleText, '旁白', `anonymous speech never carries through a scene boundary: ${JSON.stringify(result.predictions.filter((row) => row.sourceMessageIndex === 7712))}`);
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
});

test('v77 attributes one local action subject before a colon quote and rejects ambiguous co-speakers', async () => {
    const chatsRoot = path.join(os.tmpdir(), 'galgame-speaker-v77-leading-action-subject');
    const chatPath = 'leading-action-subject.jsonl';
    const visibleTexts = [
        'Pippa摇摇晃晃站起来，头发冒烟，袍角起火，她一脚踩灭火苗，对莫里克竖起中指：“你完了。”',
        '尼布把门反锁，压低声音：“先躲起来。”',
        '莫里克那张瘦脸顿时垮成一张湿账单：“这不可能。”',
        'Pippa和尼布一起说：“准备好了。”',
        'Pippa做动作，尼布转身：“快走。”',
        '尼布心想：“也许还有机会。”',
        '账本上写着：“立即撤退。”',
    ];
    const assistantMessages = visibleTexts.map((visibleText, index) => ({
        sourceMessageIndex: 7780 + index,
        sourceMessageHash: digest(visibleText),
        visibleText,
    }));
    const result = await replayStructuralSpeakerHistory({
        chatPaths: [chatPath],
        chatsRoot,
        publishedSpeakerNames: [],
        readHistoryChatImpl: async () => ({
            canonicalPath: path.join(chatsRoot, chatPath),
            sourceDigest: digest('v77-leading-action-subject-source'),
            assistantMessages,
        }),
    });
    const rowsFor = (sourceMessageIndex) => result.predictions.filter((row) => row.sourceMessageIndex === sourceMessageIndex);
    const hasSpeaker = (index, speaker) => rowsFor(index).some((row) => row.kind === 'speaker' && row.speakers.includes(speaker));
    assert.ok(hasSpeaker(7780, 'Pippa'));
    assert.ok(hasSpeaker(7781, '尼布'));
    assert.ok(hasSpeaker(7782, '莫里克'));
    assert.ok(!rowsFor(7783).some((row) => row.kind === 'speaker'), 'coordinated actors are not arbitrarily assigned to the first speaker');
    assert.ok(hasSpeaker(7784, '尼布'), `the last local actor takes ownership of its own quote: ${JSON.stringify(rowsFor(7784))}`);
    assert.ok(rowsFor(7785).every((row) => row.titleText === '旁白'), 'mental reporting is not a spoken-speaker cue');
    assert.ok(rowsFor(7786).every((row) => row.titleText === '旁白'), 'written carriers are not spoken-speaker cues');
    assert.equal(result.chatWriteback, false);
    assert.equal(result.externalProviderCalls, 0);
    assert.equal(result.sourceUnchanged, true);
});

test('v78 follows one named actor through a bounded pronoun action chain and blocks competing actors', () => {
    const cases = [
        { text: '尼布扑到你身边。他把药递给你。“喝下去。”', expected: '尼布' },
        { text: 'Pippa抬手挡住门口。Durik转身看向窗边。他把窗帘拉开。“外面有人。”', expected: 'Durik' },
        { text: '地图旁的信件写着：“立即撤退。”', expected: null },
        { text: '尼布扑到你身边。他把药递给你。她转头看向门口。“喝下去。”', expected: null },
        { text: 'Pippa总结：“好消息，它能伤人。”', expected: 'Pippa' },
        { text: 'Pippa回头说：“终于，他的账平了。”你快速扫读信件。内容很短，却足够恶心：“立即撤退。”', expected: null },
        { text: 'Celestia离开后，旁边的守卫低声说：“不许进。”', expected: null },
        { text: 'Pippa抬手挡住门口。Pippa转身。“等等。”', expected: 'Pippa' },
    ];
    const indexes = cases.map(({ text }, index) => createStructuralMessageSpeakerIndex({
        fullText: text,
        sourceMessageIndex: 7800 + index,
        sourceMessageHash: digest(text),
        publishedSpeakerNames: ['尼布', 'Pippa', 'Durik'],
        parserVersion: 'full-message-speaker-index.v78',
    }));
    assert.equal(indexes[0].anchors[0]?.speakerText, '尼布',
        'a unique named actor continues through a single pronoun-led action');
    assert.equal(indexes[1].anchors[0]?.speakerText, 'Durik', 'the nearest explicit action subject owns a following pronoun action');
    assert.equal(indexes[2].anchors.length, 0, 'written carriers do not become character speech');
    assert.equal(indexes[3].anchors.length, 0, 'a different pronoun subject remains unattributed');
    assert.equal(indexes[4].anchors[0]?.speakerText, 'Pippa', 'a character summary predicate is a speech/reporting cue');
    const readoutQuoteId = indexes[5].quoteEvidence.at(-1)?.quoteId;
    assert.ok(!indexes[5].anchors.some((anchor) => anchor.quoteId === readoutQuoteId),
        'a readout quote remains narration when a document-reading frame introduces it, despite an unrelated prior speaker');
    assert.equal(indexes[6].anchors.length, 0,
        'a roster name in a narrative clause does not steal a quote explicitly attributed to another person');
    assert.equal(indexes[7].anchors[0]?.ruleId, 'bounded-action-chain-backreference',
        'a directly named action subject in the immediately preceding sentence remains a bounded action-chain case');
    assert.equal(indexes[0].quoteEvidence[0]?.decision?.ruleId, 'bounded-action-chain-backreference');
});

console.log('speaker-structure-replay: PASS');

