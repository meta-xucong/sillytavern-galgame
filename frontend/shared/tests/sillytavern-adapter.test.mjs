import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEMO_ACTIVE_RELEASE, DEMO_SCENARIO } from '../src/demo-scenario.js';
import {
    SILLYTAVERN_CHAT_ENDPOINTS,
    SILLYTAVERN_ENDPOINTS,
    OriginalRuntimeBridgeClient,
    SillyTavernSpeakerCandidateAdapter,
    SillyTavernAdapter,
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
    createVisualNovelDisplaySegments,
    applyQuotedDialogueSpeakerContinuity,
    createStructuralPageTitleEvidence,
    createStructuralMessageSpeakerIndex,
    createChatLocalObservedSpeakerNames,
    createChatLocalObservedSpeakerNameScopes,
    createStructuralPageTitleEvidenceFromMessageIndex,
    classifyStructuralPageShape,
    createProbableNarrativeSpeakerTitleEvidence,
    createProbableQuoteSpanContinuationTitleEvidence,
    createCoreVisualDisplayEntityHints,
    extractSuggestedActionsFromOriginalText,
    formatVisualNovelDisplayText,
    extractExplicitSpeakerCandidateNames,
    isStructuralFastTitleRule,
    isStructuralExactSpeakerTitleRule,
} from '../src/sillytavern-adapter.js';

const forbiddenEndpointValues = [
    ...Object.values(SILLYTAVERN_ENDPOINTS),
    ...Object.values(SILLYTAVERN_CHAT_ENDPOINTS),
].filter((endpoint) => (
    endpoint.includes('/generate')
    || endpoint.includes('/characters/get')
    || endpoint.includes('/worldinfo/get')
));
assert.deepEqual(forbiddenEndpointValues, []);
// Parser-selected rank 0–2 speaker evidence must cross the fast, memo, and
// narration-title gates. Keep this exhaustive list aligned with
// structuralQuoteSpeakerEvidenceRank so newly added parser evidence cannot be
// silently filtered by presentation code.
for (const ruleId of [
    'known-prefix', 'quoted-attribution', 'post-quote-attribution', 'expanded-explicit-signature',
    'local-speech-cue', 'page-local-explicit-speech-cue', 'leading-named-subject-colon-quote',
    'dashed-explicit-speech-cue', 'named-group-report-attribution', 'group-role-prefix',
    'reported-first-utterance', 'player-direct-speech', 'player-first-person-action',
    'player-first-person-speech', 'player-action-quoted-turn', 'player-social-closure',
    'ranked-unique-action-subject', 'named-subject-colon-quote', 'observed-subject-colon-quote',
    'unrostered-action-attribution', 'direct-action-attribution', 'honorific-display-title',
    'rostered-subject-quoted-clause', 'crowd-report-quote', 'self-identified-creature',
    'actor-vocalization-action', 'pronoun-backreference', 'recent-action-backreference',
    'named-reaction-backreference', 'same-message-intro-pronoun-backreference',
    'recent-pronoun-speaker-continuation', 'prior-sentence-unique-action-subject',
    'spirit-return-utterance', 'bounded-dragon-name-backreference',
    'laughter-speech-continuation', 'quoted-character-reaction',
    'character-expression-subject', 'player-known-prefix',
]) {
    assert.equal(isStructuralFastTitleRule(ruleId), true, `${ruleId} can pass the shared structural title gate`);
    assert.equal(isStructuralExactSpeakerTitleRule(ruleId), true, `${ruleId} can title an exact speaker page`);
}

const structuralTitle = ({ text, names = [], index = 7, hash = 'sha256:structural-title', viewSpan, coreSpan, previousPage, allowPlainNarration } = {}) => {
    const length = Array.from(text).length;
    return createStructuralPageTitleEvidence({
        fullText: text,
        publishedSpeakerNames: names,
        sourceMessageIndex: index,
        sourceMessageHash: hash,
        viewSpan: viewSpan || { start: 0, end: length },
        coreSpan: coreSpan || { start: 0, end: length },
        previousPage,
        ...(allowPlainNarration === undefined ? {} : { allowPlainNarration }),
    });
};

const publishedFastTitle = structuralTitle({ text: 'Lady Veyra：我来。', names: ['Lady Veyra'] });
assert.equal(publishedFastTitle.kind, 'speaker');
assert.equal(publishedFastTitle.text, 'Lady Veyra');
assert.equal(publishedFastTitle.ruleId, 'known-prefix');
assert.deepEqual(publishedFastTitle.speakers[0], {
    mentionRef: 'display-only-7-0-10', text: 'Lady Veyra', start: 0, end: 10,
});
assert.equal(Object.hasOwn(publishedFastTitle, 'identityRef'), false, 'structural title evidence does not assign identity');
assert.equal(Object.hasOwn(publishedFastTitle.speakers[0], 'resolverEntityRef'), false,
    'display-only mention tokens do not bind annotation entities');

const unknownFastTitle = structuralTitle({ text: 'Celestia说：“我们走。”' });
assert.equal(unknownFastTitle.kind, 'speaker');
assert.equal(unknownFastTitle.text, 'Celestia');
assert.equal(unknownFastTitle.ruleId, 'quoted-attribution');
assert.equal(unknownFastTitle.speakers[0].text, 'Celestia');
assert.ok(unknownFastTitle.classificationEvidenceSpans.every((span) => span.start >= 0 && span.end <= Array.from('Celestia说：“我们走。”').length));

const actionAttributionText = 'Celestia整理了一下链甲，露出更多肌肉：“好了，我们可以继续了。”';
const structuralMessageIndex = (text) => createStructuralMessageSpeakerIndex({
    fullText: text,
    sourceMessageIndex: 9,
    sourceMessageHash: 'sha256:structural-action-colon-quote',
    parserVersion: 'full-message-speaker-index.v76',
});
const actionAttribution = structuralMessageIndex(actionAttributionText);
assert.equal(actionAttribution.anchors[0]?.speakerText, 'Celestia',
    'a unique named action subject bound to a colon quote identifies the speaker');
assert.equal(actionAttribution.anchors[0]?.ruleId, 'leading-named-subject-colon-quote');
for (const text of [
    'Pippa吹了声口哨：“这次轮到我。”',
    'Lila看都没看他，弯腰捡起短剑，嫌弃地皱眉：“烂铁，但能捅。”',
    '尼布从灌木里冒头：“那个眼神我认识！”',
]) {
    assert.ok(['Pippa', 'Lila', '尼布'].includes(structuralMessageIndex(text).anchors[0]?.speakerText),
        `a single named action subject before a direct colon quote is recognized: ${text}`);
}
assert.equal(structuralMessageIndex('Celestia离开后，守卫：“站住！”').anchors.length, 0,
    'a later generic speaker subject blocks inheriting the first named actor');
assert.equal(structuralMessageIndex('信件：“明晚行动。”').anchors.length, 0,
    'a written carrier remains narration instead of a speaker');

const chineseCueTitle = structuralTitle({ text: '莉娅问道：“你们准备好了吗？”' });
assert.equal(chineseCueTitle?.text, '莉娅', 'a directly named Chinese speech cue can identify a display-only title');
const knownSpeakerActionAttributionText = '你的位置暴露了，但尼布已经绕到侧面，躲在树根后，低声骂：“好极了，现在他们知道罐头会思考了。”';
const knownSpeakerActionAttribution = structuralTitle({ text: knownSpeakerActionAttributionText, names: ['尼布'] });
assert.equal(knownSpeakerActionAttribution, null, 'a named character in a descriptive clause remains unknown without direct attribution');
assert.equal(structuralTitle({
    text: '队伍里的尼布和薇拉已经绕到侧面，低声骂：“别出声。”', names: ['尼布', '薇拉'],
}), null, 'multiple published names in a speech-attribution clause remain ambiguous');
const postQuoteTitle = structuralTitle({ text: '“没问题。”Nira答道。' });
assert.equal(postQuoteTitle?.text, 'Nira', 'a direct post-quote attribution identifies the speaker');
assert.equal(postQuoteTitle?.ruleId, 'post-quote-attribution');
assert.equal(Array.from('“没问题。”Nira答道。').slice(postQuoteTitle.speakers[0].start, postQuoteTitle.speakers[0].end).join(''), 'Nira',
    'post-quote speaker spans point at the exact name rather than the preceding speech cue');
const englishPostQuoteTitle = structuralTitle({ text: '“Ready?” asked Nira.' });
assert.equal(englishPostQuoteTitle?.text, 'Nira', 'common English post-quote attribution is recognized structurally');

const alternatingSpeakersText = 'Nira说：“在这。”Venn答：“来了。”';
const alternatingSpeakers = structuralTitle({ text: alternatingSpeakersText });
assert.equal(alternatingSpeakers?.kind, 'group', 'attribution scanning restarts after each closed quote');
assert.deepEqual(alternatingSpeakers?.speakers.map((speaker) => speaker.text), ['Nira', 'Venn']);
const mixedResolvedAndUnknownIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Nira说：“在这。” “没人署名。”', publishedSpeakerNames: ['Nira'],
    sourceMessageIndex: 8, sourceMessageHash: 'sha256:mixed-resolved-and-unknown',
});
assert.equal(mixedResolvedAndUnknownIndex.anchors.length, 1,
    'an unknown quote does not erase a separate explicit anchor elsewhere in the same message');
assert.equal(mixedResolvedAndUnknownIndex.unresolvedDialogueSpans.length, 1,
    'the unknown quote remains locally unresolved');
assert.equal(structuralTitle({ text: 'Nira说：“在这。” “没人署名。”' }), null,
    'an unattributed quote prevents the page from being assigned to another known speaker');
assert.equal(structuralTitle({ text: '# 所以战术很简单：优先攻击克罗恩。' }), null,
    'a marked heading is not assigned a speaker or narration title');
assert.equal(structuralTitle({ text: 'Nira: “我来。”' }), null,
    'a bare unrostered name plus colon and quote is not enough to assign a speaker');
assert.equal(structuralTitle({ text: 'Nira: “我来。”', names: ['Nira'] })?.text, 'Nira',
    'an exact published speaker name remains valid in the bare colon-and-quote format');
assert.equal(structuralTitle({ text: 'Nira: 我来。' }), null, 'an unknown colon heading without a quote is not promoted to a person');
assert.equal(structuralTitle({ text: 'The Gate：“门开了。”' }), null,
    'an unknown English title/location phrase beginning with a standalone article is not promoted to a person');
assert.equal(structuralTitle({ text: 'The Gate：“门开了。”', names: ['The Gate'] })?.text, 'The Gate',
    'an exact published name can still be used even when it resembles a titled place');
assert.equal(structuralTitle({ text: 'Nira说：“我来了。' })?.text, 'Nira',
    'a directly attributed open quote can title its current page before a later page continuation');
assert.equal(structuralTitle({ text: '🙂\nNira说：“你好。”' })?.speakers[0].start, 2,
    'speaker spans use Unicode code points rather than UTF-16 offsets');
assert.equal(structuralTitle({ text: 'Nira说：“她轻声说『可以』。”' })?.text, 'Nira', 'nested paired quotes keep the outer direct attribution');
assert.equal(structuralTitle({ text: 'Nira说：“未闭合」' }), null, 'mismatched quote pairs fail closed');

const quotePairs = [['“', '”'], ['「', '」'], ['『', '』'], ['"', '"']];
const generatedCues = ['说', '问', '答', '喊', '说道', '回复', '回答', 'said', 'asked', 'replied'];
let structuralMatrixCases = 0;
for (let index = 0; index < 20; index += 1) {
    const name = `Speaker${String(index).padStart(2, '0')}`;
    const [opening, closing] = quotePairs[index % quotePairs.length];
    const cue = generatedCues[index % generatedCues.length];
    const separator = index % 2 ? '：' : ':';
    const text = `${name}${cue}${separator}${opening}句子${index}${closing}`;
    const result = structuralTitle({ text });
    assert.equal(result?.text, name, `generated explicit attribution ${index} is recognized`);
    assert.equal(Array.from(text).slice(result.speakers[0].start, result.speakers[0].end).join(''), name,
        `generated attribution ${index} has an exact source span`);
    structuralMatrixCases += 1;
}
assert.equal(structuralMatrixCases, 20, 'the deterministic grammar matrix ran every generated case');

const headingNarration = structuralTitle({ text: '所以战术很简单：优先攻击克罗恩。' });
assert.equal(headingNarration.kind, 'classification');
assert.equal(headingNarration.classification, 'narration');
assert.equal(headingNarration.text, '旁白', 'plain unquoted story prose receives a display-only narration title');
assert.equal(headingNarration.ruleId, 'plain-prose-narration');
assert.deepEqual(headingNarration.classificationEvidenceSpans, [{ start: 0, end: Array.from('所以战术很简单：优先攻击克罗恩。').length }]);
const currentNarration = structuralTitle({ text: '你带着核心队伍——Pippa、Celestia、Durik、莉娅、瑞恩——前往Grand Harbor冒险者工会总部。' });
assert.equal(currentNarration.text, '旁白', 'second-person RPG prose does not require a keyword dictionary');
assert.equal(Object.hasOwn(currentNarration, 'identityRef'), false, 'narration title evidence never assigns identity');
assert.equal(structuralTitle({ text: "The goblin bared a surgeon's grin." })?.text, '旁白',
    'an English possessive apostrophe does not suppress an unquoted prose title');
assert.equal(structuralTitle({ text: "'Leave now.'" }), null,
    'a paired single-quoted phrase remains unknown instead of being treated as plain prose');
assert.equal(structuralTitle({ text: '❤ HP: 7/12\n⛨ AC: 15\n🏅 Level: 1\n📈 XP: 0' }), null,
    'a generic multi-line key/value status block is not mislabeled as narration');
assert.equal(structuralTitle({ text: '(Fighter Campaign)' }), null,
    'a standalone parenthesized title remains unclassified instead of becoming narration');
assert.equal(structuralTitle({ text: '所以战术很简单：优先攻击克罗恩。', allowPlainNarration: false }), null,
    'callers with semantic dialogue evidence can disable the coarse narration fallback');
assert.equal(structuralTitle({ text: '“门开了。”' }), null, 'an unattributed quote cannot infer its speaker');
assert.equal(structuralTitle({ text: 'Celestia在门口，大家提到了她。' }).text, '旁白',
    'a name mention in unquoted prose does not assign that name as speaker');
assert.equal(structuralTitle({ text: 'Celestia：我们走。' }), null, 'an unknown colon label needs quoted dialogue');
assert.equal(structuralTitle({ text: 'Lady Veyra来了：我来。', names: ['Lady Veyra'] }).text, '旁白',
    'a published name mention before a later colon is not treated as that speaker');
assert.equal(structuralTitle({ text: '— Celestia：我们走。' })?.text, 'Celestia',
    'a dash-led explicit speaker label assigns the named speaker');

const twoSpeakersText = 'Nira说：“在这。”Venn答：“来了。”';
const twoSpeakersTitle = structuralTitle({ text: twoSpeakersText });
assert.equal(twoSpeakersTitle.kind, 'group');
assert.equal(twoSpeakersTitle.text, '多人对话');
assert.deepEqual(twoSpeakersTitle.speakers.map((speaker) => speaker.text), ['Nira', 'Venn']);
assert.ok(twoSpeakersTitle.classificationEvidenceSpans.every((span) => span.start >= 0 && span.end <= Array.from(twoSpeakersText).length));

const splitQuoteText = 'Lila说：“先等我听见脚步声了。”';
const splitQuoteChars = Array.from(splitQuoteText);
const splitQuotePageEnd = Array.from('Lila说：“先等').length;
const splitQuoteFirstPage = structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 0, end: splitQuotePageEnd },
    coreSpan: { start: 0, end: splitQuotePageEnd },
});
assert.equal(splitQuoteFirstPage.text, 'Lila');
const splitQuotePreviousPage = {
    sourceMessageIndex: 28,
    sourceMessageHash: 'sha256:split-quote',
    sourceSpan: { start: 0, end: splitQuotePageEnd },
    pageTitleEvidence: splitQuoteFirstPage,
    pageTitleEvidenceViewSpan: { start: 0, end: splitQuotePageEnd },
};
const splitQuoteSecondPage = structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 0, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
    previousPage: splitQuotePreviousPage,
});
assert.equal(splitQuoteSecondPage.kind, 'speaker');
assert.equal(splitQuoteSecondPage.text, 'Lila');
assert.equal(splitQuoteSecondPage.ruleId, 'open-quote-continuation');
assert.deepEqual(splitQuoteSecondPage.classificationEvidenceSpans, [{ start: splitQuotePageEnd, end: splitQuoteChars.length }]);

const splitAsciiQuoteText = 'Lila说:"先等我听见脚步声了。"';
const splitAsciiQuoteChars = Array.from(splitAsciiQuoteText);
const splitAsciiQuotePageEnd = Array.from('Lila说:"先等').length;
const splitAsciiFirstPage = structuralTitle({
    text: splitAsciiQuoteText,
    index: 29,
    hash: 'sha256:split-ascii-quote',
    viewSpan: { start: 0, end: splitAsciiQuotePageEnd },
    coreSpan: { start: 0, end: splitAsciiQuotePageEnd },
});
assert.equal(splitAsciiFirstPage.text, 'Lila');
const splitAsciiSecondPage = structuralTitle({
    text: splitAsciiQuoteText,
    index: 29,
    hash: 'sha256:split-ascii-quote',
    viewSpan: { start: 0, end: splitAsciiQuoteChars.length },
    coreSpan: { start: splitAsciiQuotePageEnd, end: splitAsciiQuoteChars.length },
    previousPage: {
        sourceMessageIndex: 29,
        sourceMessageHash: 'sha256:split-ascii-quote',
        sourceSpan: { start: 0, end: splitAsciiQuotePageEnd },
        pageTitleEvidence: splitAsciiFirstPage,
        pageTitleEvidenceViewSpan: { start: 0, end: splitAsciiQuotePageEnd },
    },
});
assert.equal(splitAsciiSecondPage.text, 'Lila');
assert.equal(splitAsciiSecondPage.ruleId, 'open-quote-continuation');

assert.equal(structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:changed-hash',
    viewSpan: { start: 0, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
    previousPage: splitQuotePreviousPage,
}), null, 'a previous-page title from another message hash cannot continue');
assert.equal(structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 0, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
    previousPage: { ...splitQuotePreviousPage, sourceSpan: { start: 0, end: splitQuotePageEnd - 1 } },
}), null, 'a non-adjacent previous page cannot continue');
assert.equal(structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 0, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
}), null, 'an open quote without validated single-speaker page evidence stays unidentified');
assert.equal(structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 0, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
    previousPage: {
        ...splitQuotePreviousPage,
        pageTitleEvidence: { ...splitQuoteFirstPage, sourceMessageHash: 'sha256:other' },
    },
}), null, 'previous-page evidence must validate against its message hash');
assert.equal(structuralTitle({
    text: splitQuoteText,
    index: 28,
    hash: 'sha256:split-quote',
    viewSpan: { start: 1, end: splitQuoteChars.length },
    coreSpan: { start: splitQuotePageEnd, end: splitQuoteChars.length },
    previousPage: splitQuotePreviousPage,
}), null, 'continuation requires the exact previous-core/current-core view window');

const calls = [];
const boundCharacter = DEMO_SCENARIO.sillyTavernBindings.characters[0];
const boundWorldBook = DEMO_SCENARIO.sillyTavernBindings.worldBooks[0];
const boundChatSeedId = DEMO_SCENARIO.sillyTavernBindings.chatSeedId;

const candidateWorldbookName = boundWorldBook.name;
const candidateManifest = {
    id: DEMO_SCENARIO.id,
    version: DEMO_SCENARIO.version,
};
const candidateSnapshot = {
    ok: true,
    fileName: 'candidate-test-chat.jsonl',
    rawChat: [{ chat_metadata: { world_info: candidateWorldbookName } }],
};
const candidateCalls = [];
let candidateWorldbook = { entries: { '1': { comment: 'Companion - Lila' } } };
const candidateFetch = async (url, options = {}) => {
    candidateCalls.push({ url, options });
    if (url.endsWith('/csrf-token')) return jsonResponse({ token: 'candidate-csrf' });
    if (url.endsWith('/api/worldinfo/get')) return jsonResponse(candidateWorldbook);
    return jsonResponse({ error: 'unexpected endpoint' }, 404);
};
const candidateAdapter = new SillyTavernSpeakerCandidateAdapter({ fetchImpl: candidateFetch });
const firstCandidates = await candidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE, manifest: candidateManifest, snapshot: candidateSnapshot,
});
assert.deepEqual(firstCandidates.candidateSpeakerNames, ['Lila']);
assert.match(firstCandidates.resourceFingerprint, /^sha256:[a-f0-9]{64}$/u);
assert.deepEqual(Object.keys(firstCandidates).sort(), ['candidateSpeakerNames', 'resourceFingerprint']);
assert.equal(JSON.stringify(firstCandidates).includes('entries'), false, 'the adapter never returns raw worldbook JSON');
const getCandidateCall = candidateCalls.find((call) => call.url.endsWith('/api/worldinfo/get'));
assert.equal(getCandidateCall.options.method, 'POST');
assert.deepEqual(JSON.parse(getCandidateCall.options.body), { name: candidateWorldbookName });

candidateWorldbook = { entries: { '1': { comment: 'Companion - Celestia' } } };
const refreshedCandidates = await candidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE, manifest: candidateManifest, snapshot: candidateSnapshot,
});
assert.deepEqual(refreshedCandidates.candidateSpeakerNames, ['Celestia'],
    'same snapshot and resource name re-read changed worldbook contents');
assert.notEqual(refreshedCandidates.resourceFingerprint, firstCandidates.resourceFingerprint);
const beforeSecondWorldbook = candidateCalls.length;
assert.deepEqual((await candidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE,
    manifest: candidateManifest,
    snapshot: { ...candidateSnapshot, rawChat: [{ chat_metadata: { world_info: 'OtherWorld' } }] },
})).candidateSpeakerNames, ['Celestia']);
assert.equal(candidateCalls.length, beforeSecondWorldbook + 1, 'a new exact chat worldbook name is read without requiring an Arc binding');
const afterSecondBoundWorldbook = candidateCalls.length;
assert.deepEqual((await candidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE,
    manifest: candidateManifest,
    snapshot: { ...candidateSnapshot, rawChat: [{ chat_metadata: {} }] },
})).candidateSpeakerNames, []);
assert.equal(candidateCalls.length, afterSecondBoundWorldbook, 'a chat without world_info fails closed without listing or guessing');
assert.deepEqual((await candidateAdapter.getBoundWorldbookCandidates({
    release: { ...DEMO_ACTIVE_RELEASE, scenarioVersion: 'wrong-version' },
    manifest: candidateManifest,
    snapshot: candidateSnapshot,
})).candidateSpeakerNames, []);
assert.deepEqual((await candidateAdapter.getBoundWorldbookCandidates({
    release: { ...DEMO_ACTIVE_RELEASE, releaseId: '' },
    manifest: candidateManifest,
    snapshot: candidateSnapshot,
})).candidateSpeakerNames, []);
assert.deepEqual((await candidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE,
    manifest: candidateManifest,
    snapshot: { ...candidateSnapshot, ok: false },
})).candidateSpeakerNames, []);
assert.equal(candidateCalls.length, afterSecondBoundWorldbook, 'invalid scenario/chat scopes do not call worldbook endpoints');
assert.deepEqual(extractExplicitSpeakerCandidateNames({ entries: { '1': { comment: 'Companion - Lila' } } }), ['Lila']);
assert.deepEqual(extractExplicitSpeakerCandidateNames({ entries: {
    '1': { key: ['Celestia'], content: 'Character: Celestia', trigger: ['Lila'] },
} }), [], 'unknown entry shapes do not scan keys/content/triggers for names');

let oversizedBodyRead = false;
const oversizedCandidateAdapter = new SillyTavernSpeakerCandidateAdapter({
    maxResponseBytes: 64,
    fetchImpl: async (url) => {
        if (url.endsWith('/csrf-token')) return jsonResponse({ token: 'candidate-csrf' });
        return {
            ok: true,
            headers: { get: (name) => name === 'content-length' ? '65' : 'application/json' },
            body: { cancel: async () => {} },
            text: async () => { oversizedBodyRead = true; throw new Error('must reject before reading body'); },
        };
    },
});
assert.deepEqual((await oversizedCandidateAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE, manifest: candidateManifest, snapshot: candidateSnapshot,
})).candidateSpeakerNames, []);
assert.equal(oversizedBodyRead, false, 'content-length cap rejects before reading or parsing response JSON');
let unboundedFallbackBodyRead = false;
const unboundedFallbackAdapter = new SillyTavernSpeakerCandidateAdapter({
    fetchImpl: async (url) => {
        if (url.endsWith('/csrf-token')) return jsonResponse({ token: 'candidate-csrf' });
        return {
            ok: true,
            headers: { get: () => null },
            text: async () => { unboundedFallbackBodyRead = true; return JSON.stringify(candidateWorldbook); },
        };
    },
});
assert.deepEqual((await unboundedFallbackAdapter.getBoundWorldbookCandidates({
    release: DEMO_ACTIVE_RELEASE, manifest: candidateManifest, snapshot: candidateSnapshot,
})).candidateSpeakerNames, []);
assert.equal(unboundedFallbackBodyRead, false, 'unbounded non-stream responses fail closed without reading');

const bridgeProof = {
    protocolVersion: 'galgame.original-runtime-bridge-proof.v1',
    audience: 'original-runtime-bridge',
    issuedAt: '2026-07-24T15:00:00.000Z',
    expiresAt: '2026-07-24T15:05:00.000Z',
    nonce: 'adapter-test-proof',
    binding: {
        release: {
            releaseId: DEMO_ACTIVE_RELEASE.releaseId,
            scenarioId: DEMO_ACTIVE_RELEASE.scenarioId,
            scenarioVersion: DEMO_ACTIVE_RELEASE.scenarioVersion,
            arcId: DEMO_ACTIVE_RELEASE.activeArcId,
        },
        target: {
            type: 'character',
            characterId: boundCharacter.id,
            avatar: boundCharacter.avatar,
        },
        chat: {
            chatId: 'galgame-active-test-chat',
            chatSeedId: boundChatSeedId,
            allowedChatIds: ['galgame-active-test-chat'],
        },
    },
    bindingHash: 'sha256:adapter-test',
    signature: 'adapter-test-signature',
};
let savedChat = null;
let savedBody = null;
const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/csrf-token')) {
        return jsonResponse({ token: 'csrf_test' });
    }
    if (url.endsWith('/api/ping')) {
        return new Response(null, { status: 204 });
    }
    if (url.endsWith('/api/characters/all')) {
        return jsonResponse([{ name: boundCharacter.id, avatar: boundCharacter.avatar }]);
    }
    if (url.endsWith('/api/worldinfo/list')) {
        return jsonResponse([{ name: boundWorldBook.name, file_id: boundWorldBook.name }]);
    }
    if (url.endsWith('/api/settings/get')) {
        return jsonResponse({
            openai_setting_names: ['Default', DEMO_SCENARIO.sillyTavernBindings.presetId].filter(Boolean),
            textgenerationwebui_preset_names: ['Neutral'],
            koboldai_setting_names: ['Default'],
            novelai_setting_names: [],
            instruct: [{ name: DEMO_SCENARIO.sillyTavernBindings.instructPresetId || 'Alpaca' }],
            sysprompt: [{ name: DEMO_SCENARIO.sillyTavernBindings.systemPromptId || 'Neutral - Chat' }],
            context: [{ name: DEMO_SCENARIO.sillyTavernBindings.contextPresetId || 'Default' }],
        });
    }
    if (url.endsWith('/api/characters/chats')) {
        const body = JSON.parse(options.body || '{}');
        if (body.avatar_url !== boundCharacter.avatar) {
            return jsonResponse({ error: true });
        }
        return jsonResponse([{
            file_id: boundChatSeedId,
            file_name: `${boundChatSeedId}.jsonl`,
            chat_items: 1,
            last_mes: '2026-07-24T14:00:00.000Z',
            mes: '雨音在窗外轻轻落下。',
        }]);
    }
    if (url.endsWith('/api/chats/get')) {
        return jsonResponse([
            {
                chat_metadata: {},
                user_name: 'Sam',
                character_name: boundCharacter.id,
            },
            {
                name: '青井',
                is_user: false,
                is_system: false,
                send_date: '2026-07-24T14:00:00.000Z',
                mes: '雨音在窗外轻轻落下。',
                extra: {},
            },
        ]);
    }
    if (url.endsWith('/api/chats/save')) {
        savedBody = JSON.parse(options.body);
        savedChat = savedBody.chat;
        return jsonResponse({ ok: true });
    }
    if (url.endsWith('/health')) {
        if (url.startsWith('http://127.0.0.1:8794')) {
            return jsonResponse({ ok: false }, 503);
        }
        if (url.startsWith('http://127.0.0.1:8799')) {
            return jsonResponse({
                ok: true,
                mode: 'sillytavern-original-runtime-bridge',
                browser: true,
                pending: false,
                authRequired: false,
                stopping: false,
            });
        }
        return jsonResponse({
            ok: true,
            mode: 'sillytavern-original-runtime-bridge',
            browser: false,
            pending: false,
            authRequired: false,
            stopping: false,
        });
    }
    if (url.endsWith('/v1/generate-reply')) {
        const body = JSON.parse(options.body || '{}');
        assert.equal(body.protocolVersion, 'galgame.original-runtime-bridge-request.v1');
        assert.equal(body.releaseId, DEMO_ACTIVE_RELEASE.releaseId);
        assert.equal(body.scenarioId, DEMO_ACTIVE_RELEASE.scenarioId);
        assert.equal(body.scenarioVersion, DEMO_ACTIVE_RELEASE.scenarioVersion);
        assert.equal(body.arcId, DEMO_ACTIVE_RELEASE.activeArcId);
        assert.equal(body.character.avatar, boundCharacter.avatar);
        assert.equal(body.chatId, 'galgame-active-test-chat');
        assert.deepEqual(body.bridgeProof, bridgeProof);
        assert.equal(body.sillyTavernBaseUrl, 'http://127.0.0.1:8001');
        assert.equal(JSON.stringify(body).includes('/api/backends/'), false);
        assert.equal(JSON.stringify(body).includes('personality'), false);
        assert.equal(JSON.stringify(body).includes('character_book'), false);
        return jsonResponse({
            ok: true,
            chatId: body.chatId,
            generatedText: '雨声停了一瞬，她终于开口。',
            rawChat: [
                {
                    chat_metadata: {},
                    user_name: 'Sam',
                    character_name: boundCharacter.id,
                },
                {
                    name: 'Sam',
                    is_user: true,
                    is_system: false,
                    send_date: '2026-07-24T15:00:00.000Z',
                    mes: '你好，我来了',
                    extra: {},
                },
                {
                    name: '青井',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-07-24T15:01:00.000Z',
                    mes: '雨声停了一瞬，她终于开口。',
                    extra: {},
                },
            ],
        });
    }
    return jsonResponse({ error: 'unexpected endpoint' }, 404);
};

const client = new SillyTavernHttpClient({ fetchImpl: fakeFetch });
await client.requestJson('/api/ping', { method: 'POST', body: {} });
assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf_test');

const adapter = new SillyTavernAdapter({ fetchImpl: fakeFetch });
assert.equal(typeof adapter.continueSession, 'undefined');
assert.equal(typeof adapter.resolveProfile, 'undefined');
assert.equal(typeof adapter.startSession, 'undefined');
assert.equal((await adapter.healthCheck()).ok, true);
assert.equal((await adapter.listCharacters())[0].name, boundCharacter.id);
assert.equal((await adapter.listWorldBooks())[0].file_id, boundWorldBook.name);

const resourceDiagnostic = await adapter.diagnoseOriginalResourceAvailability(DEMO_SCENARIO);
assert.equal(resourceDiagnostic.referenceOnly, true);
assert.equal(resourceDiagnostic.readonly, true);
assert.equal(resourceDiagnostic.ok, true);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'character-references').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'worldbook-references').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'generation-preset-reference').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'chat-seed-reference').details.missing.length, 0);

const missingDiagnostic = await adapter.diagnoseOriginalResourceAvailability({
    ...DEMO_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [{ id: 'Missing', avatar: 'missing.png', role: 'main' }],
        worldBooks: [{ name: 'MissingWorld', mode: 'scene', weight: 100 }],
        presetId: 'MissingPreset',
        instructPresetId: 'MissingInstruct',
        systemPromptId: 'MissingSystem',
        contextPresetId: 'MissingContext',
    },
});
assert.equal(missingDiagnostic.ok, false);
const missingReferences = missingDiagnostic.checks.flatMap((check) => check.details?.missing || []);
assert.deepEqual(
    missingReferences.sort(),
    ['MissingContext', 'MissingInstruct', 'MissingPreset', 'MissingSystem', 'MissingWorld', boundChatSeedId, 'missing.png'].sort(),
);

const chatBridge = new SillyTavernOriginalChatBridge({
    fetchImpl: fakeFetch,
    now: () => new Date('2026-07-24T15:00:00.000Z'),
});
assert.equal(typeof chatBridge.continueSession, 'undefined');
assert.equal(typeof chatBridge.generate, 'undefined');
assert.equal((await chatBridge.healthCheck()).ok, true);
const chatSnapshot = await chatBridge.loadOpeningChat(DEMO_SCENARIO);
assert.equal(await chatBridge.hasLatestBoundChat(DEMO_SCENARIO), true);
assert.equal(chatSnapshot.ok, true);
assert.equal(chatSnapshot.generationBridge, false);
assert.equal(chatSnapshot.fileName, boundChatSeedId);
assert.equal(chatSnapshot.isSeed, true);
assert.equal(chatSnapshot.messages.length, 1);
assert.equal(chatSnapshot.messages[0].speaker, '青井');
assert.equal(chatSnapshot.messages[0].text, '雨音在窗外轻轻落下。');
const savedSnapshot = await chatBridge.appendUserMessageToChat(DEMO_SCENARIO, chatSnapshot, '窗边有什么声音？');
assert.equal(savedSnapshot.messages.at(-1).role, 'player');
assert.equal(savedSnapshot.isSeed, false);
assert.notEqual(savedBody.file_name, boundChatSeedId);
assert.equal(savedChat.at(-1).mes, '窗边有什么声音？');
assert.equal(savedChat.at(-1).name, 'Sam');

const specificSnapshot = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, 'galgame-active-test-chat');
assert.equal(specificSnapshot.ok, true);
assert.equal(specificSnapshot.fileName, 'galgame-active-test-chat');
assert.equal(specificSnapshot.isSeed, false);

const specificSeedSnapshot = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, boundChatSeedId);
assert.equal(specificSeedSnapshot.ok, true);
assert.equal(specificSeedSnapshot.fileName, boundChatSeedId);
assert.equal(specificSeedSnapshot.isSeed, true);

const runtimeBridge = new OriginalRuntimeBridgeClient({
    baseUrl: 'http://127.0.0.1:8795',
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
    fetchImpl: fakeFetch,
});
assert.equal(runtimeBridge.isConfigured(), true);
assert.equal((await runtimeBridge.healthCheck()).ok, true);
let llmHealthRequest = null;
const llmHealthClient = new OriginalRuntimeBridgeClient({
    baseUrl: 'http://127.0.0.1:8795',
    fetchImpl: async (url, options) => {
        llmHealthRequest = { url, options };
        return jsonResponse({
            protocolVersion: 'galgame.llm-health.v1', ok: true,
            provider: 'claude', model: 'claude-sonnet-4-6', checkedAt: new Date().toISOString(), latencyMs: 42,
        });
    },
});
assert.equal((await llmHealthClient.llmHealthCheck()).ok, true);
assert.equal(llmHealthRequest.url, 'http://127.0.0.1:8795/v1/llm-health');
assert.equal(JSON.parse(llmHealthRequest.options.body).protocolVersion, 'galgame.llm-health.v1');
assert.equal(JSON.stringify(llmHealthRequest.options).includes('token'), false);
const generatedSnapshot = await runtimeBridge.generateReply({
    manifest: DEMO_SCENARIO,
    release: {
        ...DEMO_ACTIVE_RELEASE,
    },
    snapshot: {
        ...savedSnapshot,
        fileName: 'galgame-active-test-chat',
    },
    bridgeProof,
});
assert.equal(generatedSnapshot.generationBridge, true);
assert.equal(generatedSnapshot.fileName, 'galgame-active-test-chat');
assert.equal(generatedSnapshot.messages.at(-1).role, 'character');
assert.equal(generatedSnapshot.messages.at(-1).text, '雨声停了一瞬，她终于开口。');

const discoveredRuntimeBridge = new OriginalRuntimeBridgeClient({
    sillyTavernBaseUrl: 'http://127.0.0.1:8000',
    fetchImpl: fakeFetch,
});
assert.equal(discoveredRuntimeBridge.isConfigured(), false);
const discoveredUrl = await discoveredRuntimeBridge.discoverBaseUrl([
    'http://127.0.0.1:8794',
    'http://127.0.0.1:8795',
    'http://127.0.0.1:8799',
]);
assert.equal(discoveredUrl, 'http://127.0.0.1:8799');
assert.equal(discoveredRuntimeBridge.isConfigured(), true);

const headedActions = extractSuggestedActionsFromOriginalText([
    '青井把伞往你这边递近了一点。',
    '可选行动：',
    '1. 接过伞，向她道谢',
    '2. 问她为什么在这里等你',
    '3. 和她一起走向旧车站',
].join('\n'));
assert.equal(headedActions.displayText, '青井把伞往你这边递近了一点。');
assert.deepEqual(
    headedActions.suggestedActions.map((action) => action.label),
    ['接过伞，向她道谢', '问她为什么在这里等你', '和她一起走向旧车站'],
);

const trailingActions = extractSuggestedActionsFromOriginalText([
    '雨声停了一瞬，她终于开口。',
    'A. 回答“你好，我来了”',
    'B. 先观察站台四周',
].join('\n'));
assert.deepEqual(
    trailingActions.suggestedActions.map((action) => action.value),
    ['回答“你好，我来了”', '先观察站台四周'],
);

const actionsBeforeStatusBlock = extractSuggestedActionsFromOriginalText([
    '战斗正式开始。现在轮到你行动。',
    '',
    '可选行动：',
    '1. 冲向路中央的 Gribble，用巨剑攻击',
    '2. 绕向左侧树根，逼近哥布林弓手',
    '3. 攻击右侧陷阱哥布林',
    '',
    '```',
    '❤ HP: 12/12',
    '⛨ AC: 15',
    '📃 Status: Healthy; alert to ambush',
    '```',
].join('\n'));
assert.deepEqual(
    actionsBeforeStatusBlock.suggestedActions.map((action) => action.label),
    ['冲向路中央的 Gribble，用巨剑攻击', '绕向左侧树根，逼近哥布林弓手', '攻击右侧陷阱哥布林'],
);
assert.equal(actionsBeforeStatusBlock.displayText.includes('可选行动'), false);
assert.equal(actionsBeforeStatusBlock.displayText.includes('❤ HP: 12/12'), true);

const nonChoiceNumberedLine = extractSuggestedActionsFromOriginalText('第一章\n1. 雨落在旧车站的屋檐上。');
assert.equal(nonChoiceNumberedLine.suggestedActions.length, 0);

const roleplayMarkdownText = '*Andrei 没有转身。窗外的 Los Angeles 在雨里缩成一片锈色，街灯把水洼照得像破开的伤口。玻璃上映出他的轮廓，直立，静止，像房间原本就围着他建成。入口处的三名男人仍没有换脚。* *—Andrei 望着窗外。* “你愿以何物偿付？” *声音不高。公寓里的冷却系统停了一拍，随后重新吐出干冷的风。Anna 的手指从腹部滑到外套拉链上。*';
const formattedRoleplayText = formatVisualNovelDisplayText(roleplayMarkdownText);
assert.equal(formattedRoleplayText.includes('*'), false);
assert.equal(formattedRoleplayText.includes('Andrei 没有转身。'), true);
assert.equal(formattedRoleplayText.includes('“你愿以何物偿付？”'), true);
assert.equal(formattedRoleplayText.includes('声音不高。'), true);
assert.equal(formattedRoleplayText.includes('\n\n—Andrei 望着窗外。'), true);
assert.equal(formattedRoleplayText.includes('“你愿以何物偿付？”\n\n声音不高。'), true);

const hiddenInstructionDisplayText = formatVisualNovelDisplayText([
    '<!-- 冒险者 is a human fighter - refer to character_sheet_warrior. -->',
    '<thinking>Roll a secret die and keep the plan hidden.</thinking>',
    '```thinking',
    'Do not show this tactical scratchpad.',
    '```',
    '*树丛忽然晃动。* “把剑握稳。”',
].join('\n'));
assert.equal(hiddenInstructionDisplayText.includes('character_sheet_warrior'), false);
assert.equal(hiddenInstructionDisplayText.includes('secret die'), false);
assert.equal(hiddenInstructionDisplayText.includes('scratchpad'), false);
assert.equal(hiddenInstructionDisplayText.includes('树丛忽然晃动。'), true);
assert.equal(hiddenInstructionDisplayText.includes('“把剑握稳。”'), true);

const multiSceneVisibleText = '你们离开光辉神殿酒馆，穿过城市废墟，回到旧钟楼外的荒地。随后进入灰境前厅，战斗在石柱间爆发。';
const multiSceneHints = createCoreVisualDisplayEntityHints({
    index: 17,
    role: 'character',
    speaker: 'Dungeon Master',
    text: multiSceneVisibleText,
});
assert.equal(multiSceneHints.some((entity) => entity.entityType === 'scene'), false,
    'unstructured narrative prose is classified by the evidence-bound scene analyzer, not raw adapter heuristics');
const labeledSceneHints = createCoreVisualDisplayEntityHints({
    index: 18,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '当前地点: 灰境前厅',
});
assert.equal(labeledSceneHints.find((entity) => entity.entityType === 'scene')?.displayLabel, '灰境前厅');
assert.equal(labeledSceneHints.find((entity) => entity.entityType === 'scene')?.visibleAttributes?.[0]?.value, '灰境前厅');
const bellTowerHints = createCoreVisualDisplayEntityHints({
    index: 19,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '队伍来到旧钟楼，雨幕下停步。',
});
assert.equal(bellTowerHints.some((entity) => entity.entityType === 'scene'), false,
    'the adapter does not infer a scene from prose without validated continuity analysis');
const hiddenOnlySceneHints = createCoreVisualDisplayEntityHints({
    index: 20,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '[thinking]进入灰境前厅[/thinking]\n“我们继续前进。”',
});
assert.equal(hiddenOnlySceneHints.some((entity) => entity.entityType === 'scene'), false);
const xmlAnalysisOnlySceneHints = createCoreVisualDisplayEntityHints({
    index: 21,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '<analysis>进入旧钟楼</analysis>\n\n你继续前进。',
});
assert.equal(xmlAnalysisOnlySceneHints.some((entity) => entity.entityType === 'scene'), false);
assert.equal(formatVisualNovelDisplayText('<analysis>进入旧钟楼</analysis>\n\n你继续前进。').includes('进入旧钟楼'), false);
const bracketAnalysisOnlySceneHints = createCoreVisualDisplayEntityHints({
    index: 22,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '[analysis]进入旧钟楼[/analysis]\n\n你继续前进。',
});
assert.equal(bracketAnalysisOnlySceneHints.some((entity) => entity.entityType === 'scene'), false);
assert.equal(formatVisualNovelDisplayText('[analysis]进入旧钟楼[/analysis]\n\n你继续前进。').includes('进入旧钟楼'), false);

const fencedThinkingDisplayText = formatVisualNovelDisplayText([
    '```',
    '[thinking]',
    '1. Internal planning must stay hidden.',
    '```',
    '行动顺序：Lila > 你 > Pippa。',
].join('\n'));
assert.equal(fencedThinkingDisplayText.includes('Internal planning'), false);
assert.equal(fencedThinkingDisplayText.includes('行动顺序：Lila > 你 > Pippa。'), true);

const combatSegments = createVisualNovelDisplaySegments([
    '他们的感知检定：d20 + 1 = 8。链锤卫兵先开口："赫娅怎么还没回报？"短戟卫兵笑得很贱："她还在里面。"',
    '先攻检定：你 d20 + 0 = 14。行动顺序：Lila > 你 > Pippa。',
].join('\n\n'), { fallbackSpeaker: 'Dungeon Master' });
assert.equal(combatSegments.some((segment) => /^["*]+$/u.test(segment.text)), false);
assert.equal(combatSegments.some((segment) => segment.speaker === '行动顺序'), false);

const longMessageWithTailChoices = `${'这是一段较长的战斗叙述。'.repeat(400)}\n\n❤ HP: 27/32\n📃 Status: 战斗结束\n\n可选行动：\n1. 搜刮现场\n2. 检查暗门\n3. 带同伴离开`;
assert.equal(longMessageWithTailChoices.length > 4000, true);
assert.deepEqual(
    extractSuggestedActionsFromOriginalText(longMessageWithTailChoices).suggestedActions.map((action) => action.label),
    ['搜刮现场', '检查暗门', '带同伴离开'],
);

const singleLineThinkingMarkerText = formatVisualNovelDisplayText('``` [thinking] ``` 你用气若游丝的声音命令尼布：“放囚犯……制造混乱……逃。”');
assert.equal(singleLineThinkingMarkerText.includes('thinking'), false);
assert.equal(singleLineThinkingMarkerText.startsWith('你用气若游丝的声音'), true);

const visibleStatusBlockText = formatVisualNovelDisplayText([
    '```',
    '❤ HP: 12/12',
    '⛨ AC: 15',
    '📃 Status: Healthy',
    '```',
].join('\n'));
assert.equal(visibleStatusBlockText.includes('```'), false);
assert.equal(visibleStatusBlockText.includes('❤ HP: 12/12'), true);
assert.equal(visibleStatusBlockText.includes('📃 Status: Healthy'), true);

const displaySegments = createVisualNovelDisplaySegments(roleplayMarkdownText, {
    fallbackSpeaker: 'WorldDirector',
    role: 'character',
    knownSpeakers: [{ characterKey: 'Andrei', aliases: [] }],
});
assert.deepEqual(
    displaySegments.map((segment) => segment.type),
    ['narration', 'narration', 'stage', 'unattributed-dialogue', 'narration'],
);
assert.equal(displaySegments[2].speaker, 'Andrei');
assert.equal(displaySegments[3].speaker, '未识别');
assert.equal(displaySegments[3].text, '“你愿以何物偿付？”');

const longKnownQuotedDialogue = createVisualNovelDisplaySegments(
    `Pippa说道：“${'这段对白跨过分页仍然属于同一个角色。'.repeat(14)}结束。”`,
    { knownSpeakers: [{ characterKey: 'Pippa', aliases: [] }] },
);
assert.ok(longKnownQuotedDialogue.length > 1, 'long quote should split into multiple visible pages');
assert.ok(longKnownQuotedDialogue.every((segment) => segment.type === 'dialogue' && segment.speaker === 'Pippa'));
assert.equal(longKnownQuotedDialogue[1].speakerContinuation, true, 'an unclosed confirmed quote keeps its speaker on the next page');
assert.equal(longKnownQuotedDialogue.at(-1).speakerContinuation, true, 'the final quote fragment remains bound until its closer');

const quoteCarryIdentity = { type: 'published', id: 'Pippa' };
const quoteCarry = applyQuotedDialogueSpeakerContinuity([
    { type: 'dialogue', speaker: 'Pippa', identityRef: quoteCarryIdentity, sourceText: '“仍在说' },
    { type: 'narration', speaker: '旁白', sourceText: '话，没有闭合。”' },
    { type: 'unattributed-dialogue', speaker: '未识别', identityRef: { type: 'unknown' }, sourceText: '“这是新的一句。”' },
]);
assert.deepEqual(quoteCarry.slice(0, 2).map((segment) => [segment.type, segment.speaker, segment.speakerContinuation]), [
    ['dialogue', 'Pippa', undefined], ['dialogue', 'Pippa', true],
]);
assert.equal(quoteCarry[2].type, 'unattributed-dialogue', 'a closed quote never attributes a later independent quote');

const explicitSpeakerOverridesCarry = applyQuotedDialogueSpeakerContinuity([
    { type: 'dialogue', speaker: 'Pippa', identityRef: quoteCarryIdentity, sourceText: '“旧句仍未结束' },
    { type: 'dialogue', speaker: 'Durik', identityRef: { type: 'published', id: 'Durik' }, sourceText: 'Durik说道：“新角色接话。”' },
    { type: 'unattributed-dialogue', speaker: '未识别', identityRef: { type: 'unknown' }, sourceText: '“没有署名。”' },
]);
assert.equal(explicitSpeakerOverridesCarry[1].speaker, 'Durik');
assert.equal(explicitSpeakerOverridesCarry[2].type, 'unattributed-dialogue', 'explicit new speaker supersedes stale quote carry');

const mismatchedQuotesFailClosed = applyQuotedDialogueSpeakerContinuity([
    { type: 'dialogue', speaker: 'Pippa', identityRef: quoteCarryIdentity, sourceText: '“未闭合' },
    { type: 'unattributed-dialogue', speaker: '未识别', identityRef: { type: 'unknown' }, sourceText: '错配结束』' },
]);
assert.equal(mismatchedQuotesFailClosed[1].type, 'unattributed-dialogue', 'mismatched quote family cannot inherit identity');

const thinkingMarkerSegments = createVisualNovelDisplaySegments('``` [thinking] ``` 你用气若游丝的声音命令尼布：“放囚犯……制造混乱……逃。”', {
    fallbackSpeaker: 'Dungeon Master',
    role: 'character',
});
assert.equal(thinkingMarkerSegments[0].text.startsWith('你用气若游丝的声音'), true);
assert.equal(thinkingMarkerSegments[0].text.includes('[thinking]'), false);

const namedDialogueSegments = createVisualNovelDisplaySegments('Anna: 我会留下。', {
    fallbackSpeaker: 'WorldDirector',
    knownSpeakers: ['Anna'],
});
assert.equal(namedDialogueSegments[0].type, 'dialogue');
assert.equal(namedDialogueSegments[0].speaker, 'Anna');
assert.equal(namedDialogueSegments[0].text, '我会留下。');

const proseHeadingWithColon = createVisualNovelDisplaySegments('所以战术很简单：优先攻击克罗恩，打碎他的面具。', {
    fallbackSpeaker: 'WorldDirector',
});
assert.equal(proseHeadingWithColon[0].type, 'narration');
assert.equal(proseHeadingWithColon[0].speaker, '旁白');
assert.equal(proseHeadingWithColon[0].text, '所以战术很简单：优先攻击克罗恩，打碎他的面具。');

const unknownChineseColonLabel = createVisualNovelDisplaySegments('守卫：前方禁止通行。', {
    fallbackSpeaker: 'WorldDirector',
});
assert.equal(unknownChineseColonLabel[0].type, 'narration');
assert.equal(unknownChineseColonLabel[0].speaker, '旁白');

const knownNarrativeDialogueSegments = createVisualNovelDisplaySegments([
    'Pippa立刻反对：“我们不能现在进去。”',
    '尼布哆嗦着举手：“我有一个办法。”',
    '行动顺序：Pippa > 你 > 尼布。',
].join('\n\n'), {
    fallbackSpeaker: 'Dungeon Master',
    knownSpeakers: [
        { characterKey: 'Pippa', aliases: ['皮帕'] },
        { characterKey: '尼布', aliases: ['Nibu'] },
    ],
});
assert.deepEqual(knownNarrativeDialogueSegments.slice(0, 2).map((segment) => ({
    type: segment.type,
    speaker: segment.speaker,
    text: segment.text,
})), [
    { type: 'dialogue', speaker: 'Pippa', text: '“我们不能现在进去。”' },
    { type: 'dialogue', speaker: '尼布', text: '“我有一个办法。”' },
]);
assert.equal(knownNarrativeDialogueSegments[2].type, 'narration');

const knownEnglishNarrativeDialogue = createVisualNovelDisplaySegments('Pippa immediately objected: "We cannot enter yet."', {
    knownSpeakers: ['Pippa'],
});
assert.equal(knownEnglishNarrativeDialogue[0].type, 'dialogue');
assert.equal(knownEnglishNarrativeDialogue[0].speaker, 'Pippa');
assert.equal(knownEnglishNarrativeDialogue[0].text, '"We cannot enter yet."');

const asciiSpeakerBoundary = createVisualNovelDisplaySegments('Anna immediately objected: "Use the north gate."', {
    knownSpeakers: ['Ann'],
});
assert.equal(asciiSpeakerBoundary[0].type, 'narration');
const asciiSpeakerExact = createVisualNovelDisplaySegments('Ann immediately objected: "Use the north gate."', {
    knownSpeakers: ['Ann'],
});
assert.equal(asciiSpeakerExact[0].speaker, 'Ann');

const inferredGuardDialogueSegments = createVisualNovelDisplaySegments('守卫立刻反对：“这里禁止通行。”', {
    fallbackSpeaker: 'Dungeon Master',
    knownSpeakers: ['Pippa'],
});
assert.equal(inferredGuardDialogueSegments[0].type, 'dialogue');
assert.equal(inferredGuardDialogueSegments[0].speaker, '守卫');
assert.equal(inferredGuardDialogueSegments[0].speakerConfidence, 'inferred');
assert.match(inferredGuardDialogueSegments[0].text, /守卫立刻反对/u);

const inferredNewSpeakerSegments = createVisualNovelDisplaySegments('约翰立刻反对：“这里禁止通行。”', {
    fallbackSpeaker: 'Dungeon Master',
    knownSpeakers: ['Pippa'],
});
assert.equal(inferredNewSpeakerSegments[0].type, 'dialogue');
assert.equal(inferredNewSpeakerSegments[0].speaker, '约翰');
assert.match(inferredNewSpeakerSegments[0].text, /约翰立刻反对/);
assert.equal(inferredNewSpeakerSegments[0].speakerConfidence, 'inferred');
assert.equal(inferredNewSpeakerSegments[0].confidenceBand, 'probable');

const inferredCelestiaSegments = createVisualNovelDisplaySegments(
    '"Celestia整理了一下链甲,露出更多胸肉:"好了,现在我们可以去砍人了吧?我已经等不及要"释放圣光"了~"',
    { fallbackSpeaker: 'Dungeon Master' },
);
assert.equal(inferredCelestiaSegments[0].type, 'dialogue');
assert.equal(inferredCelestiaSegments[0].speaker, 'Celestia');
assert.match(inferredCelestiaSegments[0].text, /整理了一下链甲/);
assert.equal(inferredCelestiaSegments[0].speakerConfidence, 'inferred');
assert.equal(inferredCelestiaSegments[0].confidenceBand, 'probable');

const probableTitleText = '约翰立刻反对：“这里禁止通行。”';
const probableTitlePage = createVisualNovelDisplaySegments(probableTitleText, {
    role: 'character', knownSpeakers: ['Pippa'],
})[0];
const probableTitlePageSnapshot = structuredClone(probableTitlePage);
const probableTitleHash = `sha256:${createHash('sha256').update(probableTitleText, 'utf8').digest('hex')}`;
const probableTitleEvidence = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: probableTitleText,
    sourceMessageIndex: 22,
    sourceMessageHash: probableTitleHash,
    coreSpan: probableTitlePage.sourceSpan,
    segment: probableTitlePage,
});
assert.equal(probableTitleEvidence?.text, '约翰（推测）');
assert.equal(probableTitleEvidence?.ruleId, 'probable-narrative-dialogue');
assert.equal(probableTitleEvidence?.sourceEvidence?.speaker.text, '约翰');
assert.equal(probableTitleEvidence?.sourceEvidence?.action.text, '立刻反对');
assert.equal(probableTitleEvidence?.sourceEvidence?.quote.text, '“这里禁止通行。”');
assert.deepEqual(probableTitlePage, probableTitlePageSnapshot, 'probable projection leaves the production segment unchanged');
assert.ok(probableTitleEvidence.classificationEvidenceSpans.every((span) => (
    span.start >= probableTitlePage.sourceSpan.start && span.end <= probableTitlePage.sourceSpan.end
)));
assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
    fullText: probableTitleText, sourceMessageIndex: 22, sourceMessageHash: `sha256:${'0'.repeat(64)}`,
    coreSpan: probableTitlePage.sourceSpan, segment: probableTitlePage,
}), null, 'hash mismatch fails closed');
const repeatedOutsideCurrentPage = `${probableTitleText}\n\n${probableTitleText}`;
const repeatedOutsideHash = `sha256:${createHash('sha256').update(repeatedOutsideCurrentPage, 'utf8').digest('hex')}`;
const repeatedOutsideEvidence = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: repeatedOutsideCurrentPage,
    sourceMessageIndex: 22,
    sourceMessageHash: repeatedOutsideHash,
    coreSpan: probableTitlePage.sourceSpan,
    segment: probableTitlePage,
});
assert.equal(repeatedOutsideEvidence?.text, '约翰（推测）',
    'same name, action, and quote on another page do not make this page mapping ambiguous');
assert.ok(repeatedOutsideEvidence.classificationEvidenceSpans.every((span) => span.end <= probableTitlePage.sourceSpan.end));
const repeatedInsideText = '约翰立刻反对：“约翰立刻反对这里禁止通行。”';
const repeatedInsidePage = createVisualNovelDisplaySegments(repeatedInsideText, {
    role: 'character', knownSpeakers: ['Pippa'],
})[0];
const repeatedInsideEvidence = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: repeatedInsideText,
    sourceMessageIndex: 23,
    sourceMessageHash: `sha256:${createHash('sha256').update(repeatedInsideText, 'utf8').digest('hex')}`,
    coreSpan: repeatedInsidePage.sourceSpan,
    segment: repeatedInsidePage,
});
assert.equal(repeatedInsideEvidence?.text, '约翰（推测）',
    'anchored parser offsets disambiguate repeated speaker/action literals inside one core');
assert.equal(repeatedInsideEvidence?.sourceEvidence?.speaker.start, 0);
assert.equal(repeatedInsideEvidence?.sourceEvidence?.action.start, Array.from('约翰').length);
assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
    fullText: probableTitleText, sourceMessageIndex: 22, sourceMessageHash: probableTitleHash,
    coreSpan: probableTitlePage.sourceSpan,
    segment: { ...probableTitlePage, sourceText: `${probableTitlePage.sourceText}错位` },
}), null, 'segment text that does not match the exact source core fails closed');
const astralPrefix = '😀旁白描述。\n\n';
const astralOffsetMessage = `${astralPrefix}${probableTitleText}`;
const astralOffsetPages = createVisualNovelDisplaySegments(astralOffsetMessage, {
    role: 'character', knownSpeakers: ['Pippa'],
});
assert.equal(astralOffsetPages.length, 2);
const astralOffsetPage = astralOffsetPages[1];
const astralOffsetEvidence = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: astralOffsetMessage,
    sourceMessageIndex: 24,
    sourceMessageHash: `sha256:${createHash('sha256').update(astralOffsetMessage, 'utf8').digest('hex')}`,
    coreSpan: astralOffsetPage.sourceSpan,
    segment: astralOffsetPage,
});
assert.equal(astralOffsetEvidence?.sourceEvidence?.speaker.start, astralOffsetPage.sourceSpan.start);
assert.equal(Array.from(astralOffsetMessage).slice(
    astralOffsetEvidence.sourceEvidence.speaker.start, astralOffsetEvidence.sourceEvidence.speaker.end,
).join(''), '约翰', 'full-message spans remain exact code-point offsets after an astral character');
assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
    fullText: probableTitleText, sourceMessageIndex: 22, sourceMessageHash: probableTitleHash,
    coreSpan: { start: probableTitlePage.sourceSpan.start + 1, end: probableTitlePage.sourceSpan.end },
    segment: probableTitlePage,
}), null, 'a non-exact page core fails closed');
for (const [field, value] of [
    ['type', 'narration'],
    ['speakerConfidence', 'confirmed'],
    ['confidenceBand', 'high'],
    ['speakerOrigin', 'message-author'],
]) {
    assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
        fullText: probableTitleText,
        sourceMessageIndex: 22,
        sourceMessageHash: probableTitleHash,
        coreSpan: probableTitlePage.sourceSpan,
        segment: { ...probableTitlePage, [field]: value },
    }), null, `non-contract segment field ${field} fails closed`);
}

const quoteContinuationText = 'Mira立刻反对：“第一句继续\n\n第二句结束。”';
const quoteContinuationPages = createVisualNovelDisplaySegments(quoteContinuationText, { role: 'character' });
assert.equal(quoteContinuationPages.length, 2);
const quoteContinuationHash = `sha256:${createHash('sha256').update(quoteContinuationText, 'utf8').digest('hex')}`;
const quoteContinuationIndex = createStructuralMessageSpeakerIndex({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    parserVersion: 'full-message-speaker-index.v70',
});
const quoteContinuationSeed = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    coreSpan: quoteContinuationPages[0].sourceSpan,
    segment: quoteContinuationPages[0],
});
assert.equal(quoteContinuationSeed?.text, 'Mira（推测）');
const quoteContinuationTitle = createProbableQuoteSpanContinuationTitleEvidence({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    coreSpan: quoteContinuationPages[1].sourceSpan,
    currentPageIndex: 1,
    unresolvedSpans: quoteContinuationIndex.unresolvedDialogueSpans,
    seedEvidenceRecords: [{ sourcePageIndex: 0, coreSpan: quoteContinuationPages[0].sourceSpan, evidence: quoteContinuationSeed }],
});
assert.equal(quoteContinuationTitle?.text, 'Mira（推测）');
assert.equal(quoteContinuationTitle?.ruleId, 'probable-quote-span-continuation');
assert.deepEqual(quoteContinuationTitle?.classificationEvidenceSpans, [{
    start: quoteContinuationPages[1].sourceSpan.start,
    end: quoteContinuationPages[1].sourceSpan.end - 1,
}]);
assert.equal(createProbableQuoteSpanContinuationTitleEvidence({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    coreSpan: quoteContinuationPages[1].sourceSpan,
    currentPageIndex: 1,
    unresolvedSpans: quoteContinuationIndex.unresolvedDialogueSpans,
    seedEvidenceRecords: [{
        sourcePageIndex: 0,
        coreSpan: quoteContinuationPages[0].sourceSpan,
        evidence: { ...quoteContinuationSeed, text: 'Other（推测）' },
    }],
}), null, 'a mismatched probable speaker seed fails closed');
assert.equal(createProbableQuoteSpanContinuationTitleEvidence({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    coreSpan: quoteContinuationPages[1].sourceSpan,
    currentPageIndex: 1,
    unresolvedSpans: quoteContinuationIndex.unresolvedDialogueSpans.map((span) => ({ ...span, reasonId: 'conflicting-quoted-attribution' })),
    seedEvidenceRecords: [{ sourcePageIndex: 0, coreSpan: quoteContinuationPages[0].sourceSpan, evidence: quoteContinuationSeed }],
}), null, 'conflicting or non-attribution spans are never inherited');
const closedQuoteText = 'Mira立刻反对：“先说完。”\n\n“另一段未署名对白。”';
const closedQuotePages = createVisualNovelDisplaySegments(closedQuoteText, { role: 'character' });
const closedQuoteHash = `sha256:${createHash('sha256').update(closedQuoteText, 'utf8').digest('hex')}`;
const closedQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: closedQuoteText,
    sourceMessageIndex: 26,
    sourceMessageHash: closedQuoteHash,
});
const closedQuoteSeed = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: closedQuoteText,
    sourceMessageIndex: 26,
    sourceMessageHash: closedQuoteHash,
    coreSpan: closedQuotePages[0].sourceSpan,
    segment: closedQuotePages[0],
});
assert.equal(createProbableQuoteSpanContinuationTitleEvidence({
    fullText: closedQuoteText,
    sourceMessageIndex: 26,
    sourceMessageHash: closedQuoteHash,
    coreSpan: closedQuotePages.at(-1).sourceSpan,
    currentPageIndex: closedQuotePages.length - 1,
    unresolvedSpans: closedQuoteIndex.unresolvedDialogueSpans,
    seedEvidenceRecords: [{ sourcePageIndex: 0, coreSpan: closedQuotePages[0].sourceSpan, evidence: closedQuoteSeed }],
}), null, 'a later closed/new quote does not inherit the preceding speaker');
assert.equal(createProbableQuoteSpanContinuationTitleEvidence({
    fullText: quoteContinuationText,
    sourceMessageIndex: 25,
    sourceMessageHash: quoteContinuationHash,
    coreSpan: quoteContinuationPages[1].sourceSpan,
    currentPageIndex: 3,
    unresolvedSpans: quoteContinuationIndex.unresolvedDialogueSpans,
    seedEvidenceRecords: [{ sourcePageIndex: 0, coreSpan: quoteContinuationPages[0].sourceSpan, evidence: quoteContinuationSeed }],
}), null, 'a valid seed older than the two-page window fails closed');
const twoPageWindowText = 'Mira立刻反对：“第一页继续\n\n中间一页没有角色标题\n\n第三页继续。”';
const twoPageWindowPages = createVisualNovelDisplaySegments(twoPageWindowText, { role: 'character' });
const twoPageWindowHash = `sha256:${createHash('sha256').update(twoPageWindowText, 'utf8').digest('hex')}`;
const twoPageWindowIndex = createStructuralMessageSpeakerIndex({
    fullText: twoPageWindowText,
    sourceMessageIndex: 27,
    sourceMessageHash: twoPageWindowHash,
    parserVersion: 'full-message-speaker-index.v70',
});
const twoPageWindowSeed = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: twoPageWindowText,
    sourceMessageIndex: 27,
    sourceMessageHash: twoPageWindowHash,
    coreSpan: twoPageWindowPages[0].sourceSpan,
    segment: twoPageWindowPages[0],
});
assert.equal(twoPageWindowPages.length, 3);
assert.equal(createProbableQuoteSpanContinuationTitleEvidence({
    fullText: twoPageWindowText,
    sourceMessageIndex: 27,
    sourceMessageHash: twoPageWindowHash,
    coreSpan: twoPageWindowPages[2].sourceSpan,
    currentPageIndex: 2,
    unresolvedSpans: twoPageWindowIndex.unresolvedDialogueSpans,
    seedEvidenceRecords: [{ sourcePageIndex: 0, coreSpan: twoPageWindowPages[0].sourceSpan, evidence: twoPageWindowSeed }],
})?.text, 'Mira（推测）', 'the exact quote may inherit from exactly two pages earlier');

const embeddedPlayerAction = createVisualNovelDisplaySegments('你从背包里掏出烟雾弹：“准备好。”', {
    fallbackSpeaker: 'Dungeon Master',
});
assert.equal(embeddedPlayerAction[0].type, 'narration');

const embeddedRoleDescription = createVisualNovelDisplaySegments('金发牧师在烟雾中大笑，随后她高举战锤：“尝尝这个！”', {
    fallbackSpeaker: 'Dungeon Master',
});
assert.equal(embeddedRoleDescription[0].type, 'narration');

const multiNewSpeakerAscii = createVisualNovelDisplaySegments(
    'Pippa大笑:"好了!"Durik挥舞战斧:"冲锋!"Celestia舔了舔嘴唇:"嗯。"',
    { knownSpeakers: [] },
);
assert.deepEqual(multiNewSpeakerAscii.filter((segment) => segment.type === 'dialogue').map((segment) => segment.speaker), [
    'Pippa', 'Durik', 'Celestia',
]);
assert.equal(multiNewSpeakerAscii.every((segment) => segment.text.includes(':')), true);
assert.equal(multiNewSpeakerAscii.slice(1).every((segment) => !segment.text.startsWith('"')), true);
assert.equal(formatVisualNovelDisplayText('Pippa大笑:"好了!"Durik挥舞战斧:"冲锋!"Celestia舔了舔嘴唇:"嗯。"').includes('\n\n'), false);

const connectorBeforeNewSpeaker = createVisualNovelDisplaySegments(
    '在地牢里，约翰转身：“快走。” 然后Mary低声：“别出声。”',
    { knownSpeakers: [] },
);
assert.deepEqual(connectorBeforeNewSpeaker.filter((segment) => segment.type === 'dialogue').map((segment) => segment.speaker), ['约翰', 'Mary']);
assert.equal(connectorBeforeNewSpeaker.some((segment) => segment.text === '然后'), false);

for (const [text, firstType, firstSpeaker] of [
    ['旁白总结。\n\n然后维克多拿出记录册：“我来。”', 'narration', '旁白'],
    ['Pippa说：“等等。”\n\n然后维克多拿出记录册：“我来。”', 'dialogue', 'Pippa'],
]) {
    const segments = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: ['Pippa'] });
    assert.equal(segments.length, 2, 'blank-line-separated source paragraphs stay separate');
    assert.equal(segments[0].type, firstType);
    assert.equal(segments[0].speaker, firstSpeaker);
    assert.equal(segments[0].text, text.split('\n\n')[0].replace(/^Pippa说：/u, ''));
    assert.equal(segments[0].sourceText, text.split('\n\n')[0]);
    assert.ok(segments.every((segment) => segment.sourceSpan), 'paragraph separation keeps source offsets addressable');
    assert.equal(segments[1].sourceText, '然后维克多拿出记录册：“我来。”',
        'the next actor sentence must never be folded into the previous speaker segment');
}

const chineseSpeakerBoundary = createVisualNovelDisplaySegments('尼布尔哆嗦着举手：“我有一个办法。”', {
    knownSpeakers: ['尼布'],
});
assert.equal(chineseSpeakerBoundary[0].type, 'narration');

const inlineKnownNarrativeDialogues = createVisualNovelDisplaySegments(
    '你拍了拍桌子：“好。”Pippa立刻竖起大拇指：“明智。”尼布松了口气：“太好了。”Celestia插话：“我同意。”',
    {
        fallbackSpeaker: 'Dungeon Master',
        knownSpeakers: ['Pippa', '尼布', 'Celestia'],
    },
);
assert.deepEqual(
    inlineKnownNarrativeDialogues.filter((segment) => ['Pippa', '尼布', 'Celestia'].includes(segment.speaker)).map((segment) => ({
        type: segment.type,
        speaker: segment.speaker,
        text: segment.text,
    })),
    [
        { type: 'dialogue', speaker: 'Pippa', text: '“明智。”' },
        { type: 'dialogue', speaker: '尼布', text: '“太好了。”' },
        { type: 'dialogue', speaker: 'Celestia', text: '“我同意。”' },
    ],
);

const inlineAsciiQuoteDialogues = createVisualNovelDisplaySegments(
    '\"Pippa立刻竖起大拇指:\"明智!有奶妈。\"尼布松了口气:\"太好了!\"',
    { knownSpeakers: ['Pippa', '尼布'] },
);
assert.deepEqual(inlineAsciiQuoteDialogues.filter((segment) => ['Pippa', '尼布'].includes(segment.speaker)).map((segment) => segment.speaker), ['Pippa', '尼布']);

const inlineBoundaryAndNarration = createVisualNovelDisplaySegments(
    '尼布尔松了口气：“这只是提到的名字。”守卫立刻反对：“这里禁止通行。”尼布松了口气：“我有一个办法。”',
    { knownSpeakers: ['尼布'] },
);
assert.equal(inlineBoundaryAndNarration.filter((segment) => segment.speaker === '尼布').length, 1);
assert.equal(inlineBoundaryAndNarration.some((segment) => segment.text.includes('守卫立刻反对')), true);

const inlineNarrativeSoundCue = createVisualNovelDisplaySegments(
    '尼布哆嗦着举手：“我有一个办法。”“他拿出鹅毛笔”唰唰唰”写了几行字。',
    { knownSpeakers: ['尼布'] },
);
assert.equal(inlineNarrativeSoundCue.at(-1).speaker, '旁白');

const excludedNarrativeSpeakers = createVisualNovelDisplaySegments('旁白低声说道：“雾气正在散去。”', {
    fallbackSpeaker: 'Dungeon Master',
    knownSpeakers: ['旁白', '你', '系统', 'Pippa'],
});
assert.equal(excludedNarrativeSpeakers[0].type, 'narration');

const forbiddenCalls = calls.filter((call) => (
    call.url.includes('/api/backends/')
    || call.url.endsWith('/api/characters/get')
    || call.url.endsWith('/api/worldinfo/get')
));
assert.deepEqual(forbiddenCalls, []);

const fullMessageHash = 'sha256:full-message-index';
const splitMessage = 'Lila说：“先等我听见脚步声了，然后我们再进去。”';
const splitMessageChars = Array.from(splitMessage);

for (const [text, pageType, expected] of [
    ['Nira说：“准备好了。”', 'narration', 'dialogue-candidate'],
    ['“Status: Healthy”', 'unattributed-dialogue', 'dialogue-candidate'],
    ['Pippa：-67 + 17 = -50 HP，仍然濒死！', 'narration', 'structured-record'],
    ['Pippa: d20+2 = 15+2 = 17，失败！', 'narration', 'structured-record'],
    ['HP: 12\nAC: 16', 'narration', 'structured-record'],
    ['System: “Encounter begins.”', 'unattributed-dialogue', 'structured-record'],
    ['SYSTEM: “Encounter begins.”', 'unattributed-dialogue', 'structured-record'],
    ['# 神罚仪式', 'narration', 'heading'],
    ['（第一幕）', 'narration', 'heading'],
    ['《新的征程》', 'narration', 'heading'],
    ['普通叙述继续向前。', 'narration', 'narrative'],
    ['Nira: 12', 'narration', 'structured-record'],
    ['选择一：继续守护永冻神殿。', 'narration', 'structured-record'],
    ['左侧通道:囚徒的哭泣与铁链的诅咒', 'narration', 'heading'],
    ['所以战术很简单：优先攻击克罗恩。', 'narration', 'narrative'],
    ['船队的情况：所有船只都已进入港口，补给也完成了。', 'narration', 'narrative'],
    ['你问玛赫拉旧丧钟井的具体位置。玛赫拉把骨杖往地上一点，她从墙上的旧镇图指出位置：“旧丧钟井在钟楼后街下面……”', 'narration', 'narrative'],
    ['树影间，一个矮小身影缓缓走出。对方没有立刻攻击，只用尖细的声音说：“哎哟哟……”', 'narration', 'narrative'],
    ['治疗与审问：格雷戈的情报', 'narration', 'heading'],
]) {
    const sourceSpan = { start: 0, end: Array.from(text).length };
    assert.equal(classifyStructuralPageShape({ fullText: text, pageType, coreSpan: sourceSpan }).kind, expected, text);
    const productionPagesBefore = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: ['Pippa'] });
    const serializedPagesBefore = JSON.stringify(productionPagesBefore);
    classifyStructuralPageShape({ fullText: text, pageType, coreSpan: sourceSpan });
    assert.equal(JSON.stringify(productionPagesBefore), serializedPagesBefore, 'shape classification is a post-page sidecar only');
}
assert.equal(classifyStructuralPageShape({
    fullText: '她低声说：“我不同意。”', pageType: 'narration',
    coreSpan: { start: 0, end: Array.from('她低声说：“我不同意。”').length },
}).kind, 'dialogue-candidate', 'a pronoun plus explicit speech cue without a unique antecedent remains unknown dialogue');
const rosteredSystemQuote = 'System: “The gate is open.”';
const rosteredSystemIndex = createStructuralMessageSpeakerIndex({
    fullText: rosteredSystemQuote, publishedSpeakerNames: ['System'], sourceMessageIndex: 439,
    sourceMessageHash: 'sha256:rostered-system-explicit-line', parserVersion: 'full-message-speaker-index.v29',
});
assert.equal(rosteredSystemIndex.anchors[0]?.speakerText, 'System',
    'an exact rostered System label remains a character speaker rather than metadata');
assert.equal(classifyStructuralPageShape({
    fullText: rosteredSystemQuote, pageType: 'unattributed-dialogue',
    coreSpan: { start: 0, end: Array.from(rosteredSystemQuote).length }, messageIndex: rosteredSystemIndex,
}).kind, 'dialogue-candidate', 'a validated System speaker anchor outranks the generic metadata shape');
const rosteredQuoteCounterexample = 'Pippa脸色认真了些：“南码头表面是鱼市和货仓……”';
const rosteredQuoteCounterexampleIndex = createStructuralMessageSpeakerIndex({
    fullText: rosteredQuoteCounterexample, publishedSpeakerNames: ['Pippa'], sourceMessageIndex: 441,
    sourceMessageHash: 'sha256:rostered-quote-counterexample', parserVersion: 'full-message-speaker-index.v15',
});
assert.equal(rosteredQuoteCounterexampleIndex.anchors[0]?.speakerText, 'Pippa',
    'a rostered speaker before an attributed quote keeps the explicit attribution');

for (const [framedText, hash] of [
    ['你问玛赫拉旧丧钟井的具体位置。玛赫拉把骨杖往地上一点，她从墙上的旧镇图指出位置：“旧丧钟井在钟楼后街下面……”', 'sha256:mahra-narrative-frame'],
    ['树影间，一个矮小身影缓缓走出。对方没有立刻攻击，只用尖细的声音说：“哎哟哟……”', 'sha256:anonymous-narrative-frame'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: framedText, publishedSpeakerNames: hash.includes('mahra') ? ['玛赫拉'] : [],
        sourceMessageIndex: 530, sourceMessageHash: hash, parserVersion: 'full-message-speaker-index.v15',
    });
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: index, fullText: framedText, sourceMessageIndex: 530, sourceMessageHash: hash,
        parserVersion: 'full-message-speaker-index.v15',
        coreSpan: { start: 0, end: Array.from(framedText).length },
    });
    assert.equal(index.anchors.length, 0, 'narrative framing never manufactures a speaker anchor');
    assert.equal(evidence?.kind, 'classification');
    assert.equal(evidence?.classification, hash.includes('anonymous') ? 'unattributed-dialogue' : 'narration');
    assert.equal(evidence?.text, hash.includes('anonymous') ? '？？？' : '旁白');
    assert.equal(evidence?.ruleId, hash.includes('anonymous') ? 'anonymous-first-appearance' : 'narrative-framed-quote');
    assert.deepEqual(evidence?.speakers, []);
}
const calibratedHeadingText = '治疗与审问：格雷戈的情报';
const calibratedHeadingHash = 'sha256:calibrated-home-heading';
const calibratedHeadingIndex = createStructuralMessageSpeakerIndex({
    fullText: calibratedHeadingText, sourceMessageIndex: 533, sourceMessageHash: calibratedHeadingHash,
    parserVersion: 'full-message-speaker-index.v15',
});
const calibratedHeadingEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: calibratedHeadingIndex, fullText: calibratedHeadingText, sourceMessageIndex: 533,
    sourceMessageHash: calibratedHeadingHash, parserVersion: 'full-message-speaker-index.v15',
    coreSpan: { start: 0, end: Array.from(calibratedHeadingText).length },
});
assert.equal(calibratedHeadingEvidence?.kind, 'classification');
assert.equal(calibratedHeadingEvidence?.classification, 'other-visible');
assert.equal(calibratedHeadingEvidence?.text, '标题');
assert.equal(calibratedHeadingEvidence?.ruleId, 'structural-heading-shape');
assert.deepEqual(calibratedHeadingEvidence?.speakers, []);
const inlineHeadingText = '队伍刚走出遗迹。\n\n【疑似标题】';
const inlineHeadingStart = Array.from('队伍刚走出遗迹。\n\n').length;
const inlineHeadingHash = 'sha256:inline-heading-is-narration';
const inlineHeadingIndex = createStructuralMessageSpeakerIndex({
    fullText: inlineHeadingText, sourceMessageIndex: 534, sourceMessageHash: inlineHeadingHash,
    parserVersion: 'full-message-speaker-index.v29',
});
const inlineHeadingEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: inlineHeadingIndex, fullText: inlineHeadingText, sourceMessageIndex: 534,
    sourceMessageHash: inlineHeadingHash, parserVersion: 'full-message-speaker-index.v29',
    coreSpan: { start: inlineHeadingStart, end: Array.from(inlineHeadingText).length }, pageType: 'unknown',
});
assert.equal(inlineHeadingEvidence?.text, '旁白', 'a title-like marker away from a progression opening is narrated text');
assert.equal(inlineHeadingEvidence?.ruleId, 'narrative-heading-outside-opening');
for (const [headingText, sourceMessageIndex] of [['（疑似标题）', 538], ['《疑似标题》', 539]]) {
    const fullText = `之前正文\n\n${headingText}`;
    const coreStart = Array.from('之前正文\n\n').length;
    const sourceMessageHash = `sha256:mid-message-heading-${sourceMessageIndex}`;
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v29',
    });
    assert.equal(classifyStructuralPageShape({
        fullText, pageType: 'unattributed-dialogue',
        coreSpan: { start: coreStart, end: Array.from(fullText).length },
    }).kind, 'narrative', `${headingText} is narrative when it appears after the progression opening`);
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex, fullText, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v29',
        coreSpan: { start: coreStart, end: Array.from(fullText).length }, pageType: 'unattributed-dialogue',
    });
    assert.equal(evidence?.text, '旁白', `${headingText} is narrator when it appears after the progression opening`);
    assert.equal(evidence?.ruleId, 'narrative-heading-outside-opening');
}
const markedProgressionText = '# 新的旅程\n\n队伍刚走出遗迹。';
const markedProgressionStart = 0;
const markedProgressionHash = 'sha256:explicit-progression-heading';
const markedProgressionIndex = createStructuralMessageSpeakerIndex({
    fullText: markedProgressionText, sourceMessageIndex: 535, sourceMessageHash: markedProgressionHash,
    parserVersion: 'full-message-speaker-index.v29',
});
const markedProgressionEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: markedProgressionIndex, fullText: markedProgressionText, sourceMessageIndex: 535,
    sourceMessageHash: markedProgressionHash, parserVersion: 'full-message-speaker-index.v29',
    coreSpan: { start: markedProgressionStart, end: Array.from(markedProgressionText).length }, pageType: 'unknown',
});
assert.equal(markedProgressionEvidence?.text, '标题', 'an explicit Markdown heading at the progression opening is a title');
assert.equal(markedProgressionEvidence?.ruleId, 'structural-heading-shape');
const midMessageMarkdownHeading = '队伍刚走出遗迹。\n\n# 疑似新场景标题';
const midMessageMarkdownStart = Array.from('队伍刚走出遗迹。\n\n').length;
const midMessageMarkdownHash = 'sha256:mid-message-markdown-heading';
const midMessageMarkdownIndex = createStructuralMessageSpeakerIndex({
    fullText: midMessageMarkdownHeading, sourceMessageIndex: 537, sourceMessageHash: midMessageMarkdownHash,
    parserVersion: 'full-message-speaker-index.v29',
});
const midMessageMarkdownEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: midMessageMarkdownIndex, fullText: midMessageMarkdownHeading, sourceMessageIndex: 537,
    sourceMessageHash: midMessageMarkdownHash, parserVersion: 'full-message-speaker-index.v29',
    coreSpan: { start: midMessageMarkdownStart, end: Array.from(midMessageMarkdownHeading).length }, pageType: 'unknown',
});
assert.equal(midMessageMarkdownEvidence?.text, '旁白', 'even an explicit Markdown heading away from progression opening is narration');
assert.equal(midMessageMarkdownEvidence?.ruleId, 'narrative-heading-outside-opening');
const midMessageColonTitle = '战斗结束后，队伍开始整理战利品。\n\n治疗与审问：格雷戈的情报';
const midMessageColonTitleStart = Array.from('战斗结束后，队伍开始整理战利品。\n\n').length;
const midMessageColonTitleHash = 'sha256:mid-message-colon-title';
const midMessageColonTitleIndex = createStructuralMessageSpeakerIndex({
    fullText: midMessageColonTitle, sourceMessageIndex: 536, sourceMessageHash: midMessageColonTitleHash,
    parserVersion: 'full-message-speaker-index.v29',
});
const midMessageColonTitleEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: midMessageColonTitleIndex, fullText: midMessageColonTitle, sourceMessageIndex: 536,
    sourceMessageHash: midMessageColonTitleHash, parserVersion: 'full-message-speaker-index.v29',
    coreSpan: { start: midMessageColonTitleStart, end: Array.from(midMessageColonTitle).length }, pageType: 'unknown',
});
assert.equal(midMessageColonTitleEvidence?.text, '旁白', 'a first-page-style colon title in the middle of a progression is narration');
assert.equal(midMessageColonTitleEvidence?.ruleId, 'narrative-heading-outside-opening');
const anonymousExplicitPronounText = '她低声说：“我不同意。”';
const anonymousExplicitPronounIndex = createStructuralMessageSpeakerIndex({
    fullText: anonymousExplicitPronounText, publishedSpeakerNames: ['Pippa'], sourceMessageIndex: 531,
    sourceMessageHash: 'sha256:anonymous-explicit-pronoun', parserVersion: 'full-message-speaker-index.v15',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: anonymousExplicitPronounIndex, fullText: anonymousExplicitPronounText,
    sourceMessageIndex: 531, sourceMessageHash: 'sha256:anonymous-explicit-pronoun',
    parserVersion: 'full-message-speaker-index.v15',
    coreSpan: { start: 0, end: Array.from(anonymousExplicitPronounText).length },
})?.classification, 'narration', 'a pronoun with a direct speech cue uses the accepted display fallback without a unique backreference');
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: anonymousExplicitPronounIndex, fullText: anonymousExplicitPronounText,
    sourceMessageIndex: 531, sourceMessageHash: 'sha256:anonymous-explicit-pronoun',
    parserVersion: 'full-message-speaker-index.v15',
    coreSpan: { start: 0, end: Array.from(anonymousExplicitPronounText).length },
})?.diagnosticReasonId, 'no-unique-speaker-evidence');
const standaloneQuoteText = '“快走，别回头。”';
const standaloneQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: standaloneQuoteText, sourceMessageIndex: 532, sourceMessageHash: 'sha256:standalone-quote-v13',
    parserVersion: 'full-message-speaker-index.v15',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: standaloneQuoteIndex, fullText: standaloneQuoteText,
    sourceMessageIndex: 532, sourceMessageHash: 'sha256:standalone-quote-v13',
    parserVersion: 'full-message-speaker-index.v15',
    coreSpan: { start: 0, end: Array.from(standaloneQuoteText).length },
})?.classification, 'narration', 'a standalone unresolved quote gets the user-approved narrator display fallback');
assert.equal(classifyStructuralPageShape({
    fullText: 'Nira：我来开门。接着我们就走。',
    pageType: 'dialogue',
    coreSpan: { start: 0, end: Array.from('Nira：我来开门。接着我们就走。').length },
}).kind, 'dialogue-candidate', 'a short person-like colon prefix on the first page is not treated as a scene title');

// Synthetic regression forms derived from the user's 2026-10-07 labels; they
// are not presented as verbatim historical transcript gold. Only direct
// cues/rostered quote prefixes outrank records; list/choice and first-page
// title shapes beat weak full-message quote overlap.
const nibuRosteredContextQuote = '尼布翻开地图：“Boss，左边有路。”';
const nibuRosteredContextIndex = createStructuralMessageSpeakerIndex({
    fullText: nibuRosteredContextQuote,
    sourceMessageIndex: 4432,
    sourceMessageHash: 'sha256:nibu-rostered-context-quote',
    publishedSpeakerNames: ['尼布'],
});
assert.equal(nibuRosteredContextIndex.anchors[0]?.speakerText, '尼布',
    'an exact roster name followed by a same-clause action, colon, and quote identifies the quoted speaker');
assert.equal(nibuRosteredContextIndex.anchors[0]?.ruleId, 'rostered-subject-quoted-clause');
const unrosteredActionQuote = createStructuralMessageSpeakerIndex({
    fullText: '尼布翻开地图：“Boss，左边有路。”',
    sourceMessageIndex: 44321,
    sourceMessageHash: 'sha256:unrostered-action-quote',
    publishedSpeakerNames: [],
});
assert.equal(unrosteredActionQuote.anchors[0]?.speakerText, '尼布',
    'a direct actor action before the colon can identify an unrostered speaker in the same message');
assert.equal(unrosteredActionQuote.anchors[0]?.ruleId, 'unrostered-action-attribution');
const victorTitleCue = '维克多男爵兴奋地说：“我来开门！”';
const victorTitleCueIndex = createStructuralMessageSpeakerIndex({
    fullText: victorTitleCue,
    sourceMessageIndex: 4433,
    sourceMessageHash: 'sha256:victor-title-cue',
    publishedSpeakerNames: ['维克多'],
});
assert.equal(victorTitleCueIndex.anchors[0]?.speakerText, '维克多',
    'a rostered name may carry a bounded descriptive title and manner marker before a direct speech cue');
const directCueVersusQuotedRecord = '尼布说道：“选择一：继续守护永冻神殿。”';
const directCueVersusQuotedRecordIndex = createStructuralMessageSpeakerIndex({
    fullText: directCueVersusQuotedRecord,
    sourceMessageIndex: 4434,
    sourceMessageHash: 'sha256:direct-cue-versus-record',
    publishedSpeakerNames: ['尼布'],
});
assert.equal(classifyStructuralPageShape({
    fullText: directCueVersusQuotedRecord,
    pageType: 'narration',
    coreSpan: { start: 0, end: Array.from(directCueVersusQuotedRecord).length },
    messageIndex: directCueVersusQuotedRecordIndex,
}).kind, 'dialogue-candidate', 'a current-page direct speaker cue outranks a choice-looking quoted utterance');
const unmatchedQuoteRecord = '剧情开场：“第一句。第二句。选择一：继续守护永冻神殿。';
const unmatchedQuoteRecordIndex = createStructuralMessageSpeakerIndex({
    fullText: unmatchedQuoteRecord,
    sourceMessageIndex: 4435,
    sourceMessageHash: 'sha256:unmatched-quote-record',
});
const choiceStart = Array.from(unmatchedQuoteRecord).findIndex((char, index, chars) => chars.slice(index, index + 3).join('') === '选择一');
const choiceCore = { start: choiceStart, end: Array.from(unmatchedQuoteRecord).length };
assert.equal(classifyStructuralPageShape({
    fullText: unmatchedQuoteRecord,
    pageType: 'narration',
    coreSpan: choiceCore,
    messageIndex: unmatchedQuoteRecordIndex,
}).kind, 'structured-record', 'explicit numbered choices beat unmatched quote overlap');
assert.equal(classifyStructuralPageShape({
    fullText: '南码头表面是鱼市和货仓，夜里才露出真正用途。',
    pageType: 'narration',
    coreSpan: { start: 0, end: Array.from('南码头表面是鱼市和货仓，夜里才露出真正用途。').length },
}).kind, 'narrative', 'plain prose without local speech evidence remains narration');

const cappedUnmatchedQuote = '尼布说：“第一句。第二句。第三句之后是旁白。';
const cappedUnmatchedIndex = createStructuralMessageSpeakerIndex({
    fullText: cappedUnmatchedQuote,
    sourceMessageIndex: 4436,
    sourceMessageHash: 'sha256:capped-unmatched-quote',
    publishedSpeakerNames: ['尼布'],
});
assert.equal(cappedUnmatchedIndex.anchors[0]?.speakerText, '尼布');
assert.ok(cappedUnmatchedIndex.anchors[0].utteranceSpans[0].end
    <= Array.from('尼布说：“第一句。第二句。').length,
'an unmatched quote attribution is capped after two sentence stops in evidence only');
const cappedTailStart = Array.from('尼布说：“第一句。第二句。').length;
assert.equal(cappedUnmatchedIndex.dialogueCandidateSpans.some((span) => span.end > cappedTailStart), false,
    'the unmatched quote does not carry weak dialogue overlap into later prose');
assert.equal(classifyStructuralPageShape({
    fullText: cappedUnmatchedQuote,
    pageType: 'narration',
    coreSpan: { start: cappedTailStart, end: Array.from(cappedUnmatchedQuote).length },
    messageIndex: cappedUnmatchedIndex,
}).kind, 'narrative', 'plain prose after the capped unmatched quote no longer inherits its dialogue candidate');
for (const [text, expectedEnd] of [
    ['Nira说：“还没有句末', Array.from('Nira说：“还没有句末').length],
    ['Nira说：“只有一句。仍在同一消息', Array.from('Nira说：“只有一句。仍在同一消息').length],
    ['Nira说：“第一句。第二句。第三句。', Array.from('Nira说：“第一句。第二句。').length],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 44361, sourceMessageHash: `sha256:sentence-cap:${text}`,
        publishedSpeakerNames: ['Nira'],
    });
    assert.equal(index.anchors[0]?.utteranceSpans[0]?.end, expectedEnd,
        'unmatched quote evidence stops at two sentence boundaries only when a second boundary exists');
}
const cappedThenRescannedText = 'Nira说：“第一句。第二句。旁白。Nira说：“第三句。”';
const cappedThenRescannedIndex = createStructuralMessageSpeakerIndex({
    fullText: cappedThenRescannedText,
    sourceMessageIndex: 44362,
    sourceMessageHash: 'sha256:capped-then-rescanned',
    publishedSpeakerNames: ['Nira'],
});
assert.equal(cappedThenRescannedIndex.anchors.length, 2,
    'after an unmatched opener is capped, the suffix is scanned independently for a new valid quoted turn');
assert.equal(cappedThenRescannedIndex.anchors[1]?.speakerText, 'Nira');
const cappedNestedQuoteThenSpeaker = '“第一句。第二句中含有「引文。后」继续。第三句。”\n\nPippa说：“独立发言。”';
const cappedNestedQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: cappedNestedQuoteThenSpeaker,
    sourceMessageIndex: 44363,
    sourceMessageHash: 'sha256:capped-nested-quote-then-speaker',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(cappedNestedQuoteIndex.anchors.at(-1)?.speakerText, 'Pippa',
    'a nested quote closer crossing the evidence cap cannot poison a later independent speaker anchor');
const pairedLongQuote = '“第一句。第二句。第三句仍属同一引语。”';
const pairedLongQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: pairedLongQuote,
    sourceMessageIndex: 4437,
    sourceMessageHash: 'sha256:paired-long-quote',
});
assert.equal(pairedLongQuoteIndex.unresolvedDialogueSpans[0]?.quoteClosed, true,
    'a fully paired quote remains open through multiple sentence stops and closes only at its matching delimiter');
assert.equal(pairedLongQuoteIndex.unresolvedDialogueSpans[0]?.quoteEnd, Array.from(pairedLongQuote).length,
    'the complete paired quote span is retained as evidence');
const joeLongQuoteText = '独眼乔数了数金币,满意地点头,随后压低声音,像一条正在分享秘密的蛇:"好,听仔细了。克罗恩·骸语者这疯子的核心是他那张铁面具。\n\n那玩意儿不是装饰品,而是施法核心——他所有死灵法术都要通过面具的符文回路才能施展。\n\nLady Veyra的笔记里提到过,克罗恩年轻时做实验把自己的脸烧成焦炭,只能戴着面具活命。\n\n如果你们能在战斗中打碎他的面具,他的法术能力会直接废掉80%,只剩一些低级戏法。\n\n而且——"他顿了顿,独眼里闪过一丝恶意的笑容:"没了面具,他会因为呼吸困难陷入窒息状态,每轮自动受1d6窒息伤害,直到他逃跑或死亡。"';
const joeLongQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: joeLongQuoteText, sourceMessageIndex: 44372, sourceMessageHash: 'sha256:joe-long-quote-cap',
    publishedSpeakerNames: ['独眼乔'],
});
const joeLongQuotePages = createVisualNovelDisplaySegments(joeLongQuoteText, { role: 'character' });
const joeNarrationAt = Array.from(joeLongQuoteText).join('').indexOf('那玩意儿不是装饰品');
const joeNarrationPage = joeLongQuotePages.find((page) => page.sourceSpan.start <= joeNarrationAt && joeNarrationAt < page.sourceSpan.end);
assert.ok(joeNarrationPage, 'the original page containing the third sentence is present');
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: joeLongQuoteIndex, fullText: joeLongQuoteText, sourceMessageIndex: 44372,
    sourceMessageHash: 'sha256:joe-long-quote-cap', coreSpan: joeNarrationPage.sourceSpan, pageType: joeNarrationPage.type,
})?.text, '独眼乔', 'a matched long quote keeps its speaker across later production pages without changing page spans');
const repeatedSceneAction = [
    '# 新场景', '镇长——热情的样子——迎接你。', '镇长说：“上一场欢迎。”',
    '# 新场景', '镇长——热情的样子——迎接你。', '镇长说：“中间场欢迎。”',
    '# 新场景', '镇长——热情的样子——迎接你。', '：“现在欢迎。”',
].join('\n');
const repeatedSceneIndex = createStructuralMessageSpeakerIndex({
    fullText: repeatedSceneAction,
    sourceMessageIndex: 44373,
    sourceMessageHash: 'sha256:repeated-scene-action',
});
const repeatedSceneTitle = repeatedSceneIndex.anchors.findLast((anchor) => anchor.ruleId === 'recent-action-backreference');
assert.equal(repeatedSceneTitle?.speakerSpan?.start,
    Array.from(repeatedSceneAction).join('').lastIndexOf('镇长——热情的样子——迎接你'),
    'repeated identical scene text binds speaker evidence to the latest scene occurrence');
const pairedLongSplitText = '“第一句。\n\n第二句。第三句仍属同一引语。”';
const pairedLongSplitIndex = createStructuralMessageSpeakerIndex({
    fullText: pairedLongSplitText,
    sourceMessageIndex: 44371,
    sourceMessageHash: 'sha256:paired-long-split',
});
const pairedLongContinuationStart = Array.from('“第一句。\n\n').length;
assert.equal(classifyStructuralPageShape({
    fullText: pairedLongSplitText,
    pageType: 'narration',
    coreSpan: { start: pairedLongContinuationStart, end: Array.from(pairedLongSplitText).length },
    messageIndex: pairedLongSplitIndex,
}).kind, 'dialogue-candidate', 'a fully paired quote continues across the existing production page core');

const paginationInvariantSource = '尼布说：“第一句。第二句。第三句之后是旁白。';
const paginationInvariantBefore = createVisualNovelDisplaySegments(paginationInvariantSource, { role: 'character', knownSpeakers: ['尼布'] });
createStructuralMessageSpeakerIndex({
    fullText: paginationInvariantSource,
    sourceMessageIndex: 4438,
    sourceMessageHash: 'sha256:pagination-invariant',
    publishedSpeakerNames: ['尼布'],
});
assert.deepEqual(createVisualNovelDisplaySegments(paginationInvariantSource, { role: 'character', knownSpeakers: ['尼布'] }),
    paginationInvariantBefore, 'quote recovery evidence cannot change production body text or pagination');

for (const text of [
    'Pippa：-67 + 17 = -50 HP，仍然濒死！',
    'Pippa: d20+2 = 15+2 = 17，失败！',
    'Pippa: 12',
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 443, sourceMessageHash: `sha256:${text}`,
        publishedSpeakerNames: ['Pippa'],
    });
    assert.equal(index.anchors.length, 0, `${text} cannot produce a known-prefix speaker anchor`);
}

const rosterNumberRecord = 'Pippa：-67 + 17 = -50 HP，仍然濒死！';
const rosterNumberRecordPage = createVisualNovelDisplaySegments(rosterNumberRecord, {
    role: 'character', knownSpeakers: ['Pippa'],
})[0];
assert.equal(rosterNumberRecordPage.type, 'dialogue', 'regression fixture captures the roster-derived base page type');
const rosterNumberShape = classifyStructuralPageShape({
    fullText: rosterNumberRecord,
    pageType: rosterNumberRecordPage.type,
    coreSpan: rosterNumberRecordPage.sourceSpan,
});
assert.equal(rosterNumberShape.kind, 'structured-record', 'record shape outranks a roster-derived dialogue base type');
const rosterNumberIndex = createStructuralMessageSpeakerIndex({
    fullText: rosterNumberRecord, sourceMessageIndex: 4431, sourceMessageHash: 'sha256:roster-number-record',
    publishedSpeakerNames: ['Pippa'],
});
const rosterNumberEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: rosterNumberIndex,
    fullText: rosterNumberRecord,
    sourceMessageIndex: 4431,
    sourceMessageHash: 'sha256:roster-number-record',
    coreSpan: rosterNumberRecordPage.sourceSpan,
    pageType: rosterNumberRecordPage.type,
});
assert.equal(rosterNumberEvidence.classification, 'narration');
assert.equal(rosterNumberEvidence.ruleId, 'structural-record-shape');
assert.deepEqual(rosterNumberEvidence.speakers, []);

const directCueOnNumericValue = 'Pippa说：-67 HP，撑住！';
assert.equal(classifyStructuralPageShape({
    fullText: directCueOnNumericValue,
    pageType: 'dialogue',
    coreSpan: { start: 0, end: Array.from(directCueOnNumericValue).length },
}).kind, 'dialogue-candidate', 'an explicit direct speech cue is checked before numeric shape');

const splitAt = Array.from('Lila说：“先等我').length;
const splitMessageIndex = createStructuralMessageSpeakerIndex({
    fullText: splitMessage,
    sourceMessageIndex: 44,
    sourceMessageHash: fullMessageHash,
    publishedSpeakerFingerprint: 'cast-release-1',
});
const splitContinuationEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: splitMessageIndex,
    fullText: splitMessage,
    sourceMessageIndex: 44,
    sourceMessageHash: fullMessageHash,
    publishedSpeakerFingerprint: 'cast-release-1',
    coreSpan: { start: splitAt, end: splitMessageChars.length },
});
assert.equal(splitContinuationEvidence?.text, 'Lila', 'full-message attribution projects to a later existing page without prior-page title state');
assert.equal(splitContinuationEvidence?.ruleId, 'full-message-structural');
assert.ok(splitContinuationEvidence.speakers[0].start < splitAt, 'speaker source may precede the page core');
assert.deepEqual(splitContinuationEvidence.coreSpan, { start: splitAt, end: splitMessageChars.length });
assert.ok(splitContinuationEvidence.classificationEvidenceSpans.every((span) => span.start >= splitAt && span.end <= splitMessageChars.length));
const productionSplitMessage = 'Lila说：“先等我\n\n听见脚步声了，然后我们再进去。”';
const productionSplitMessageIndex = createStructuralMessageSpeakerIndex({
    fullText: productionSplitMessage,
    sourceMessageIndex: 46,
    sourceMessageHash: 'sha256:production-split-quote',
});
const splitProductionPages = createVisualNovelDisplaySegments(productionSplitMessage, { role: 'character' });
assert.equal(splitProductionPages.length, 2);
assert.deepEqual(splitProductionPages.map((page) => classifyStructuralPageShape({
    fullText: productionSplitMessage,
    pageType: page.type,
    coreSpan: page.sourceSpan,
    messageIndex: productionSplitMessageIndex,
}).kind), ['dialogue-candidate', 'dialogue-candidate'],
'a full-message attributed quote makes every intersecting existing page a candidate, including a continuation page without quote punctuation');

const pippaSouthDockMessage = 'Pippa脸色认真了些：“我已经确认过潮汐和巡逻间隔。\n\n南码头表面是鱼市和货仓，夜里才露出真正用途。\n\n那些船只都在等信号。”';
const pippaSouthDockPages = createVisualNovelDisplaySegments(pippaSouthDockMessage, { role: 'character', knownSpeakers: ['Pippa'] });
const pippaSouthDockIndex = createStructuralMessageSpeakerIndex({
    fullText: pippaSouthDockMessage,
    sourceMessageIndex: 461,
    sourceMessageHash: 'sha256:user-corrected-pippa-south-dock-quote',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(pippaSouthDockIndex.anchors[0]?.speakerText, 'Pippa',
    'the exact rostered Pippa attribution anchors the paired quote before the marker-free continuation');
const pippaMarkerFreeContinuation = pippaSouthDockPages.find((page) => page.text.includes('南码头表面是鱼市和货仓'));
assert.ok(pippaMarkerFreeContinuation, 'the corrected calibration form reaches the production segmenter as a page');
assert.equal(/[“”「」『』]/u.test(pippaMarkerFreeContinuation.text), false,
    'the South Dock continuation page itself contains no quote markers');
assert.equal(classifyStructuralPageShape({
    fullText: pippaSouthDockMessage,
    pageType: pippaMarkerFreeContinuation.type,
    coreSpan: pippaMarkerFreeContinuation.sourceSpan,
    messageIndex: pippaSouthDockIndex,
}).kind, 'dialogue-candidate',
'the marker-free continuation remains inside Pippa\'s same paired, roster-attributed quote');
const pippaSouthDockContinuationTitle = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: pippaSouthDockIndex,
    fullText: pippaSouthDockMessage,
    sourceMessageIndex: 461,
    sourceMessageHash: 'sha256:user-corrected-pippa-south-dock-quote',
    coreSpan: pippaMarkerFreeContinuation.sourceSpan,
});
assert.equal(pippaSouthDockContinuationTitle?.text, 'Pippa',
    "the user's full-message correction assigns the marker-free South Dock continuation to Pippa");
assert.equal(pippaSouthDockContinuationTitle?.ruleId, 'full-message-structural');

const unresolvedSplitMessage = '“先等我\n\n听见脚步声了，然后我们再进去。”';
const unresolvedSplitPages = createVisualNovelDisplaySegments(unresolvedSplitMessage, { role: 'character' });
const unresolvedSplitIndex = createStructuralMessageSpeakerIndex({
    fullText: unresolvedSplitMessage,
    sourceMessageIndex: 45,
    sourceMessageHash: 'sha256:unresolved-split-quote',
});
assert.equal(unresolvedSplitPages.length, 2);
assert.deepEqual(unresolvedSplitPages.map((page) => classifyStructuralPageShape({
    fullText: unresolvedSplitMessage,
    pageType: page.type,
    coreSpan: page.sourceSpan,
    messageIndex: unresolvedSplitIndex,
}).kind), ['dialogue-candidate', 'dialogue-candidate'],
'only the successfully indexed unattributed utterance span extends candidacy across a page boundary');
const spanOnlyStageOne = classifyStructuralPageShape({
    fullText: productionSplitMessage,
    pageType: 'narration',
    coreSpan: splitProductionPages[1].sourceSpan,
    messageIndex: {
        sourceLength: Array.from(productionSplitMessage).length,
        dialogueCandidateSpans: productionSplitMessageIndex.dialogueCandidateSpans,
        anchors: [],
        unresolvedDialogueSpans: [],
    },
});
assert.equal(spanOnlyStageOne.kind, 'dialogue-candidate', 'Stage 1 needs only the roster-independent full-message candidate span');
assert.equal(splitMessageChars.slice(splitContinuationEvidence.speakers[0].start, splitContinuationEvidence.speakers[0].end).join(''), 'Lila');
assert.equal(splitContinuationEvidence.viewSpan.start, 0, 'provenance envelope reaches the speaker anchor without changing semantic page window');

const suffixAnchorText = '“The gate is open and the guards have all gone.” asked Nira.';
const suffixAnchorIndex = createStructuralMessageSpeakerIndex({
    fullText: suffixAnchorText, sourceMessageIndex: 45, sourceMessageHash: 'sha256:suffix-anchor',
});
const suffixCoreEnd = Array.from('“The gate is open and the guards').length;
const suffixAnchorEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: suffixAnchorIndex, fullText: suffixAnchorText,
    sourceMessageIndex: 45, sourceMessageHash: 'sha256:suffix-anchor',
    coreSpan: { start: 0, end: suffixCoreEnd },
});
assert.equal(suffixAnchorEvidence?.text, 'Nira', 'the same-message suffix attribution can be projected to the quote page');
assert.ok(suffixAnchorEvidence.speakers[0].start >= suffixCoreEnd, 'speaker source may follow the page core');
assert.equal(Array.from(suffixAnchorText).slice(suffixAnchorEvidence.speakers[0].start, suffixAnchorEvidence.speakers[0].end).join(''), 'Nira',
    'the suffix speaker offset resolves to the exact name rather than its attribution cue');
assert.ok(suffixAnchorEvidence.viewSpan.end > suffixCoreEnd, 'provenance envelope includes a following attribution anchor');

for (const [text, names] of [
    ['Celestia离开后，旁边的守卫低声说：“不许进。”', ['Celestia']],
    ['她看向Nira，随后说：“进来。”', ['Nira']],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 451, sourceMessageHash: 'sha256:indirect-name-mention',
        publishedSpeakerNames: names,
    });
    assert.equal(index.anchors.length, 0, 'a character mention inside a narrative clause is not a direct speaker attribution');
    assert.equal(index.unresolvedDialogueSpans.length, 1, 'quoted speech with indirect name mention stays unknown');
}

const directModifierText = 'Nira冷冷地说：“离开这里。”';
const directModifierIndex = createStructuralMessageSpeakerIndex({
    fullText: directModifierText, sourceMessageIndex: 452, sourceMessageHash: 'sha256:direct-modifier',
    publishedSpeakerNames: ['Nira'],
});
assert.equal(directModifierIndex.anchors[0]?.speakerText, 'Nira', 'a short, directly attached manner marker may follow a speaker name');

for (const [text, expected] of [
    ['Pippa兴奋地说：“我们走。”', 'Pippa'],
    ['Pippa（通过通讯）说：“收到。”', 'Pippa'],
    ['青岚疑惑地问道：“发生什么了？”', '青岚'],
    ['Kael says: “I will scout ahead.”', 'Kael'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4521, sourceMessageHash: `sha256:${text}`,
        publishedSpeakerNames: ['Pippa', '青岚'],
    });
    assert.equal(index.anchors[0]?.speakerText, expected, `${text} resolves the directly cued speaker without a phrase dictionary`);
    assert.equal(index.unresolvedDialogueSpans.length, 0);
}

for (const cue of ['补充', '补充道', '嘀咕', '嘀咕道', '提醒', '提醒道', '回应', '回应道', '插话', '插话道', '解释', '解释道', '低声道', '轻声道', '尖叫', '怒吼', '咆哮', '嘶声', '低语', '喃喃道', '嘟囔', '嘟囔道']) {
    const prefixText = `青岚${cue}：“我听见了。”`;
    const prefixIndex = createStructuralMessageSpeakerIndex({
        fullText: prefixText, sourceMessageIndex: 4522, sourceMessageHash: `sha256:direct-cue-prefix:${cue}`,
    });
    assert.equal(prefixIndex.anchors[0]?.speakerText, '青岚', `${cue} is accepted as a direct prefix speech cue`);
    assert.equal(prefixIndex.unresolvedDialogueSpans.length, 0);

    const suffixText = `“我听见了。”青岚${cue}。`;
    const suffixIndex = createStructuralMessageSpeakerIndex({
        fullText: suffixText, sourceMessageIndex: 4523, sourceMessageHash: `sha256:direct-cue-suffix:${cue}`,
    });
    assert.equal(suffixIndex.anchors[0]?.speakerText, '青岚', `${cue} is accepted as a direct post-quote speech cue`);
    assert.equal(suffixIndex.unresolvedDialogueSpans.length, 0);
}

for (const [text, expectedSpeaker] of [
    ['玛赫拉补充道：“撤退。”', '玛赫拉'],
    ['战场陷入沉寂，玛赫拉补充道：“撤退。”', '玛赫拉'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45221, sourceMessageHash: `sha256:compound-cue:${text}`,
    });
    assert.equal(index.anchors[0]?.speakerText, expectedSpeaker,
        'a compound cue ending in 道 must not be split off from the preceding multi-character name');
    assert.equal(index.unresolvedDialogueSpans.length, 0);
}

for (const [text, expectedSpeaker] of [
    ['Pippa忍不住小声欢呼：“百万金，我们真的做到了！”', 'Pippa'],
    ['Elena（公爵夫人）走过来：“我们可以利用地下网络。”', 'Elena'],
    ['艾萨克斯低吼：“神殿要崩塌了，快走！”', '艾萨克斯'],
    ['但Celestia立刻撕开反魔法领域卷轴：“Antimagic Field（八环）！”', 'Celestia'],
    ['Nibu清点补给：“三天干粮、水、绳索、攀爬装备都准备好了。”', 'Nibu'],
    ['首相的声音传来：“太好了！”', '首相'],
    ['Durik“轰”的砸碎一个虚空法师的尸体：“还有老大？那任务没结束？”', 'Durik'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4524, sourceMessageHash: `sha256:actor-action:${text}`,
        parserVersion: 'full-message-speaker-index.v29',
    });
    assert.equal(index.anchors[0]?.speakerText, expectedSpeaker,
        `a named subject with an action/reaction cue and colon quote resolves to ${expectedSpeaker}`);
    assert.equal(index.unresolvedDialogueSpans.length, 0, 'resolved action-led utterance is removed from unknown spans');
}

const connectorAfterName = createStructuralMessageSpeakerIndex({
    fullText: '然而维克多随后拿出记录册：“我来。”', sourceMessageIndex: 45241,
    sourceMessageHash: 'sha256:connector-after-speaker-name',
});
assert.equal(connectorAfterName.anchors[0]?.speakerText, '维克多',
    'a discourse connector after a name must not be absorbed into the unrostered speaker');
assert.equal(connectorAfterName.unresolvedDialogueSpans.length, 0);

const newSubjectAfterSound = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa看向天空“轰”她面色凝重：“快跑！”', sourceMessageIndex: 45242,
    sourceMessageHash: 'sha256:new-subject-after-sound-effect', publishedSpeakerNames: ['Pippa'],
});
assert.equal(newSubjectAfterSound.anchors.length, 0,
    'a pronoun-led new subject after a sound effect must not inherit the prior actor');
assert.equal(newSubjectAfterSound.unresolvedDialogueSpans.length, 1);

const subjectAcrossActionClauses = createStructuralMessageSpeakerIndex({
    fullText: '茶里王抬起声音，朝那片潮湿阴暗的树林喊道：“你是谁？Pippa是谁？”',
    sourceMessageIndex: 452421, sourceMessageHash: 'sha256:comma-action-subject',
});
assert.equal(subjectAcrossActionClauses.anchors[0]?.speakerText, '茶里王',
    'a named subject remains the speaker when its action and speech cue are in adjacent comma clauses');
assert.equal(subjectAcrossActionClauses.unresolvedDialogueSpans.length, 0);

for (const [text, expectedSpeaker] of [
    ['维克多朝门口望去，随后说道：“开门。”', '维克多'],
    ['维克多转身，随后说道：“开门。”', '维克多'],
]) {
    const continuedActionCue = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 452420, sourceMessageHash: `sha256:connector-action-cue:${text}`,
    });
    assert.equal(continuedActionCue.anchors[0]?.speakerText, expectedSpeaker,
        'an explicit speech predicate after a discourse connector resolves the subject of the preceding action');
    assert.equal(continuedActionCue.dialogueCandidateSpans.length, 1,
        'connector-mediated speech remains in the dialogue candidate bucket');
    assert.equal(continuedActionCue.unresolvedDialogueSpans.length, 0);
}

const connectorInformationFrame = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa转身，随后系统提示：“获得 100 XP。”', sourceMessageIndex: 452420,
    sourceMessageHash: 'sha256:connector-information-frame', publishedSpeakerNames: ['Pippa'],
});
assert.equal(connectorInformationFrame.anchors.length, 0,
    'an information source after an action connector stays narration despite the preceding named subject');
assert.equal(connectorInformationFrame.dialogueCandidateSpans.length, 0);
assert.equal(connectorInformationFrame.unresolvedDialogueSpans.length, 0);

const boundedNamedActionQuote = createStructuralMessageSpeakerIndex({
    fullText: 'Celestia走过去，温柔地抱住艾米莉：“没事了。”', sourceMessageIndex: 4524201,
    sourceMessageHash: 'sha256:bounded-named-action-quote', publishedSpeakerNames: ['Celestia'],
});
assert.equal(boundedNamedActionQuote.anchors[0]?.speakerText, 'Celestia',
    'one rostered subject plus an observed action clause can own a following colon quote');
assert.equal(boundedNamedActionQuote.dialogueCandidateSpans.length, 1);
assert.equal(boundedNamedActionQuote.unresolvedDialogueSpans.length, 0);

const competingNamedActionQuote = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa和Nibu同时举起武器：“一起上！”', sourceMessageIndex: 4524202,
    sourceMessageHash: 'sha256:competing-named-action-quote', publishedSpeakerNames: ['Pippa'],
});
assert.equal(competingNamedActionQuote.anchors.length, 0,
    'a joined action by a rostered and unrostered subject does not arbitrarily select the first name');
assert.equal(competingNamedActionQuote.dialogueCandidateSpans.length, 1);
assert.equal(competingNamedActionQuote.unresolvedDialogueSpans.length, 1);

const competingRoleActionQuote = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa和一个守卫同时举起武器：“一起上！”', sourceMessageIndex: 45242021,
    sourceMessageHash: 'sha256:competing-role-action-quote', publishedSpeakerNames: ['Pippa'],
});
assert.equal(competingRoleActionQuote.anchors.length, 0,
    'a rostered speaker coordinated with an unrostered role subject stays ambiguous');
assert.equal(competingRoleActionQuote.dialogueCandidateSpans.length, 1);
assert.equal(competingRoleActionQuote.unresolvedDialogueSpans.length, 1);

const coordinatedObjectIsNotSubject = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa拿起地图和钥匙：“我来。”', sourceMessageIndex: 45242022,
    sourceMessageHash: 'sha256:coordinated-object-not-subject', publishedSpeakerNames: ['Pippa'],
});
assert.equal(coordinatedObjectIsNotSubject.anchors[0]?.speakerText, 'Pippa',
    'coordinated objects after an action verb do not invalidate the single speaker');
assert.equal(coordinatedObjectIsNotSubject.unresolvedDialogueSpans.length, 0);

const turnHeaderQuote = createStructuralMessageSpeakerIndex({
    fullText: 'Durik的回合：“轮到我了。”', sourceMessageIndex: 4524204,
    sourceMessageHash: 'sha256:turn-header-quote',
});
assert.equal(turnHeaderQuote.anchors[0]?.speakerText, 'Durik',
    'a generic character turn header can anchor its immediately attached quote');
assert.equal(turnHeaderQuote.dialogueCandidateSpans.length, 1,
    'a turn-header quote is counted as a dialogue candidate');
assert.equal(turnHeaderQuote.unresolvedDialogueSpans.length, 0);

for (const [cue, text] of [
    ['补了一句', 'Pippa补了一句：“继续。”'],
    ['提议', 'Pippa提议：“我们撤退。”'],
    ['命令', 'Pippa命令：“撤退！”'],
]) {
    const indirectSpeechCue = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4524205, sourceMessageHash: `sha256:indirect-speech-cue:${cue}`,
        publishedSpeakerNames: ['Pippa'],
    });
    assert.equal(indirectSpeechCue.anchors[0]?.speakerText, 'Pippa', `${cue} anchors its local speaker`);
    assert.equal(indirectSpeechCue.dialogueCandidateSpans.length, 1);
    assert.equal(indirectSpeechCue.unresolvedDialogueSpans.length, 0);
}

const playerDashDialogue = createStructuralMessageSpeakerIndex({
    fullText: '你看向地图——“三天后出发。目标是虚空教派总部。”',
    sourceMessageIndex: 452422, sourceMessageHash: 'sha256:player-em-dash-turn',
});
assert.equal(playerDashDialogue.anchors[0]?.speakerText, '你',
    'a player-led em-dash turn directly introducing a quote belongs to the player');
assert.equal(playerDashDialogue.dialogueCandidateSpans.length, 1,
    'the player-led em-dash quote is counted as a dialogue candidate as well as attributed to the player');
assert.equal(playerDashDialogue.unresolvedDialogueSpans.length, 0);

for (const [text, expectedSpeaker] of [
    ['背面刻着：“黑喙收账，欠债还肉。”', null],
    ['地图上标注：“旧磨坊，今晚交货。”', null],
    ['系统提示：“获得 100 XP。”', null],
    ['状态：“Healthy”', null],
    ['Pippa翻开账本，记录上写着：“黑喙收账，欠债还肉。”', null],
    ['Pippa翻开地图，地图上标注：“旧磨坊，今晚交货。”', null],
    ['Pippa拆开信，信上写着：“今晚在旧磨坊碰面。”', null],
    ['Pippa点头，系统提示：“获得 100 XP。”', null],
    ['Pippa说：“我们继续前进。”', 'Pippa'],
    ['Pippa喊道：“别看系统提示！”', 'Pippa'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 452423, sourceMessageHash: `sha256:source-frame:${text}`,
        publishedSpeakerNames: ['Pippa'],
    });
    assert.equal(index.anchors[0]?.speakerText || null, expectedSpeaker,
        `${text} uses explicit speaker evidence first, otherwise information quotes are not speakers`);
    assert.equal(index.unresolvedDialogueSpans.length, 0,
        `${text} does not leave a false unattributed-dialogue span`);
    assert.equal(index.dialogueCandidateSpans.length, expectedSpeaker ? 1 : 0,
        `${text} enters the candidate bucket only when directly attributed`);
}

const longNamedContinuationText = `艾瑞克大法师私下找到你：“${'龙魂守护者，封印的线索仍在这里。'.repeat(90)}这就是全部。”`;
const longNamedContinuationIndex = createStructuralMessageSpeakerIndex({
    fullText: longNamedContinuationText, publishedSpeakerNames: ['艾瑞克大法师'],
    sourceMessageIndex: 452424, sourceMessageHash: 'sha256:long-closed-quote-continuation',
});
const longQuoteLength = Array.from(longNamedContinuationText).length;
for (const coreSpan of [
    { start: 0, end: 180 },
    { start: 180, end: 680 },
    { start: 680, end: longQuoteLength },
]) {
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: longNamedContinuationIndex, fullText: longNamedContinuationText,
        sourceMessageIndex: 452424, sourceMessageHash: 'sha256:long-closed-quote-continuation',
        coreSpan, pageType: 'unattributed-dialogue',
    });
    assert.equal(evidence?.text, '艾瑞克大法师',
        'the complete matching quote keeps one speaker across all original production pages');
}

const closedQuoteThenNewTurnText = '艾瑞克大法师说：“这句已经结束。”\n\n“这是一句新的、没有署名的话。”';
const closedQuoteThenNewTurnIndex = createStructuralMessageSpeakerIndex({
    fullText: closedQuoteThenNewTurnText, publishedSpeakerNames: ['艾瑞克大法师'],
    sourceMessageIndex: 452425, sourceMessageHash: 'sha256:closed-quote-no-inherit',
});
assert.equal(closedQuoteThenNewTurnIndex.anchors.length, 1,
    'the second quote cannot inherit the speaker after the first quote has closed');
assert.equal(closedQuoteThenNewTurnIndex.unresolvedDialogueSpans.length, 1);

const explicitlyAttributedSound = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa说：“轰！”', sourceMessageIndex: 45243,
    sourceMessageHash: 'sha256:explicitly-attributed-sound-effect', publishedSpeakerNames: ['Pippa'],
});
assert.equal(explicitlyAttributedSound.anchors[0]?.speakerText, 'Pippa',
    'direct speaker attribution takes precedence over the generic sound-effect rule');
assert.equal(explicitlyAttributedSound.dialogueCandidateSpans.length, 1,
    'an explicitly attributed sound effect is counted consistently as a dialogue candidate');
assert.equal(explicitlyAttributedSound.unresolvedDialogueSpans.length, 0);

for (const sound of ['轰', '轰轰', '轰隆隆', '嗡', '咔咔', '吼——']) {
    const text = `“${sound}！”`;
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4525, sourceMessageHash: `sha256:sound-effect:${sound}`,
        parserVersion: 'full-message-speaker-index.v29',
    });
    assert.equal(index.dialogueCandidateSpans.length, 0, `${sound} is not counted as dialogue`);
    assert.equal(index.unresolvedDialogueSpans.length, 0, `${sound} does not stay unresolved`);
}
assert.equal(createStructuralMessageSpeakerIndex({
    fullText: '“不！”', sourceMessageIndex: 4526, sourceMessageHash: 'sha256:short-negative-speech',
    parserVersion: 'full-message-speaker-index.v29',
}).unresolvedDialogueSpans.length, 1, 'short spoken replies remain unresolved without an attribution');

const userCalibrationV18 = [
    ['光明会的新征程...选择下一步。', '旁白', 'plain-prose-narration'],
    ['“光明会的新征程...选择下一步。”', '旁白', 'narrative-progression-prompt'],
    ['“轰”！', '旁白', 'narrative-sound-effect'],
    ['维克多拿出记录册：“至高领袖，让我算算这段时间的战斗经验……”', '维克多', 'unrostered-action-attribution'],
    ['“加上战斗经验30500 XP，总共获得：70500 XP！”', '旁白', 'structural-record-shape'],
    ['Pippa震惊：“7万经验？！”', 'Pippa', 'unrostered-action-attribution'],
    ['Pippa兴奋地抱着虚空之书：“Boss！老娘研究了虚空之书，发现里面有封印相关的记录——七大灾祸的封印位置和状态都有记载！”', 'Pippa', 'unrostered-action-attribution'],
];
for (const [text, expected, ruleId] of userCalibrationV18) {
    const sourceMessageIndex = 540 + userCalibrationV18.findIndex((sample) => sample[0] === text);
    const sourceMessageHash = `sha256:v18-user-label-${expected}-${sourceMessageIndex}`;
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v29',
    });
    const page = createVisualNovelDisplaySegments(text, { role: 'character' })[0];
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: index, fullText: text, sourceMessageIndex, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v29',
        coreSpan: { start: 0, end: Array.from(text).length }, pageType: page.type,
    });
    assert.equal(evidence?.text, expected, `user calibration title for ${text}`);
    assert.equal(evidence?.ruleId, ruleId, `user calibration rule for ${text}`);
}

// v68 treats the whole unique actor→predicate→quoted-turn relation as one
// structural frame. These source-shaped examples cover object, body-state,
// appearance, tool-use, and reaction predicates without tying attribution to
// a scenario-specific character list.
const v68ActorPredicateFrames = [
    ['玛赫拉把一把生锈钥匙丢给你，上面挂着一块灰木牌：“这是礼拜堂废井台外门的旧锁钥匙。”', '玛赫拉'],
    ['Durik松了口气：“谢了Celestia，幸好你及时赶到。”', 'Durik'],
    ['Celestia穿着秘银链甲，表情严肃：“光明之神啊……”', 'Celestia'],
    ['Pippa用奥术洞察鉴定：“这是深海鳞人的鳞片？”', 'Pippa'],
    ['霜咬的眼神变得严肃：“弗罗斯特莫格……”', '霜咬'],
    ['钢齿眼睛发亮，他一把抓起金币：“成交，好眼光！”', '钢齿'],
];
for (const [index, [text, expected]] of v68ActorPredicateFrames.entries()) {
    const sourceMessageIndex = 6800 + index;
    const sourceMessageHash = `sha256:v68-actor-predicate-${sourceMessageIndex}`;
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v68',
    });
    const quote = messageIndex.anchors.find((anchor) => anchor.speakerText === expected);
    assert.ok(quote, `v68 resolves the unique actor in ${text}`);
    assert.equal(quote.ruleId, 'unrostered-action-attribution');
    assert.equal(messageIndex.unresolvedDialogueSpans.length, 0);
}
const v68AmbiguousAndWrittenFrames = [
    ['Pippa和Durik交换眼神：“走吧。”', ['Pippa', 'Durik']],
    ['Pippa的日志上写着：“计划明日出发。”', []],
    ['天色渐暗，远处传来号角声：“集合！”', []],
];
for (const [index, [text, publishedSpeakerNames]] of v68AmbiguousAndWrittenFrames.entries()) {
    const sourceMessageIndex = 6810 + index;
    const sourceMessageHash = `sha256:v68-non-speaker-frame-${sourceMessageIndex}`;
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText: text, publishedSpeakerNames, sourceMessageIndex, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v68',
    });
    assert.equal(messageIndex.anchors.length, 0, `v68 leaves ambiguous/written/narrative quote without a speaker: ${text}`);
}
for (const shortDialogue of ['“好！”', '“是！”']) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: shortDialogue, sourceMessageIndex: 548, sourceMessageHash: `sha256:short-spoken:${shortDialogue}`,
        parserVersion: 'full-message-speaker-index.v29',
    });
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: index, fullText: shortDialogue, sourceMessageIndex: 548,
        sourceMessageHash: `sha256:short-spoken:${shortDialogue}`, parserVersion: 'full-message-speaker-index.v29',
        coreSpan: { start: 0, end: Array.from(shortDialogue).length },
    });
    assert.equal(evidence?.text, '旁白', 'a short quote without a unique speaker gets the narrator display fallback');
    assert.equal(evidence?.diagnosticReasonId, 'no-unique-speaker-evidence');
    assert.deepEqual(evidence?.speakers, []);
}

for (const text of ['我们都补充道：“撤退。”', '她沉默地补充道：“撤退。”']) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45222, sourceMessageHash: `sha256:generic-subject:${text}`,
    });
    assert.equal(index.anchors.length, 0, 'generic pronoun/discourse subjects must not be invented as character names');
    assert.equal(index.unresolvedDialogueSpans.length, 1, 'ambiguous quoted speech remains unresolved');
}

const actionPrefixIsNotSpeechCue = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa翻开账本：“这里有线索。”', sourceMessageIndex: 45231,
    sourceMessageHash: 'sha256:action-prefix-is-not-speech-cue', publishedSpeakerNames: ['Pippa'],
});
assert.equal(actionPrefixIsNotSpeechCue.anchors[0]?.speakerText, 'Pippa',
    'a same-clause rostered action followed immediately by colon and quoted speech attributes the quote to that role');
assert.equal(actionPrefixIsNotSpeechCue.anchors[0]?.ruleId, 'rostered-subject-quoted-clause');

const chatLocalRosterMessages = [
    { sourceMessageIndex: 1, visibleText: 'Pippa说：“我看到线索了。”' },
    { sourceMessageIndex: 2, visibleText: 'Pippa回答：“在账本里。”' },
    { sourceMessageIndex: 3, visibleText: 'Status: “Healthy”' },
];
const observedChatNames = createChatLocalObservedSpeakerNames({ messages: chatLocalRosterMessages });
assert.deepEqual(observedChatNames, ['Pippa'], 'only a name explicitly attributed in distinct assistant messages enters the chat-local display roster');
const observedNameScopes = createChatLocalObservedSpeakerNameScopes({ messages: chatLocalRosterMessages });
assert.deepEqual(observedNameScopes[0], [], 'a message cannot use its own speaker evidence as a prior anchor');
assert.deepEqual(observedNameScopes[1], [], 'one earlier explicit anchor is insufficient');
assert.deepEqual(observedNameScopes[2], ['Pippa'], 'two earlier explicit anchors are available to later messages');

const crossSceneObservedNameScopes = createChatLocalObservedSpeakerNameScopes({ messages: [
    { sourceMessageIndex: 10, visibleText: 'Pippa说：“先听我说。”' },
    { sourceMessageIndex: 11, visibleText: 'Pippa回答：“我明白。”' },
    { sourceMessageIndex: 12, visibleText: '# 新场景' },
    { sourceMessageIndex: 13, visibleText: '她低声说：“第三句话。”' },
] });
assert.deepEqual(crossSceneObservedNameScopes[2], [], 'an opening scene title clears prior-scene observed names before parsing the title message');
assert.deepEqual(crossSceneObservedNameScopes[3], [], 'a prior speaker name cannot leak through a scene boundary into the next scene');
const crossScenePronounIndex = createStructuralMessageSpeakerIndex({
    fullText: '她低声说：“第三句话。”', sourceMessageIndex: 13,
    sourceMessageHash: 'sha256:cross-scene-observed-name',
    publishedSpeakerNames: crossSceneObservedNameScopes[3],
});
assert.equal(crossScenePronounIndex.anchors.length, 0,
    'a pronoun without a same-scene local antecedent must not inherit the old-scene speaker');

const boundedObservedNameScopes = createChatLocalObservedSpeakerNameScopes({ messages: [
    { sourceMessageIndex: 20, visibleText: 'Pippa说：“一。”' },
    { sourceMessageIndex: 21, visibleText: 'Pippa回答：“二。”' },
    ...Array.from({ length: 9 }, (_, index) => ({
        sourceMessageIndex: index + 22,
        visibleText: `陌生的叙述文本 ${index}。`,
    })),
] });
assert.deepEqual(boundedObservedNameScopes.at(-1), [], 'observed names expire after the bounded recent assistant-message window');

const transferFrameSpeechText = '马库斯把报告递给你，说：“Boss，城门关闭了。”';
const transferFrameSpeechIndex = createStructuralMessageSpeakerIndex({
    fullText: transferFrameSpeechText,
    sourceMessageIndex: 26,
    sourceMessageHash: 'sha256:transfer-frame-speaker-boundary',
});
assert.equal(transferFrameSpeechIndex.anchors[0]?.speakerText, '马库斯',
    'the explicit 说 subject before 把 owns the spoken quote');
assert.deepEqual(transferFrameSpeechIndex.anchors[0]?.speakerSpan, { start: 0, end: 3 },
    'speaker evidence span ends before 把 and the transferred object');
assert.equal(Array.from(transferFrameSpeechText).slice(
    transferFrameSpeechIndex.anchors[0]?.speakerSpan.start,
    transferFrameSpeechIndex.anchors[0]?.speakerSpan.end,
).join(''), '马库斯', 'attribution spans must exactly match the full speaker surface');

const transferFrameWrittenText = '马库斯把报告递给你，报告上写着：“清晨出发。”';
const transferFrameWrittenIndex = createStructuralMessageSpeakerIndex({
    fullText: transferFrameWrittenText,
    sourceMessageIndex: 27,
    sourceMessageHash: 'sha256:transfer-frame-written-content',
});
assert.equal(transferFrameWrittenIndex.anchors.length, 0,
    'a source-transfer action plus report-carrier cue is not attributed to its handler');
const actionQuoteWithObservedName = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa翻开账本：“这里有线索。”', sourceMessageIndex: 4,
    sourceMessageHash: 'sha256:chat-local-action-quote', publishedSpeakerNames: observedChatNames,
});
assert.equal(actionQuoteWithObservedName.anchors[0]?.speakerText, 'Pippa',
    'a repeated same-chat explicit speaker name resolves the approved action-before-quote shape');
const singleMessageObservedName = createChatLocalObservedSpeakerNames({
    messages: [{ sourceMessageIndex: 5, visibleText: 'Pippa说：“我看到线索了。”' }],
});
assert.deepEqual(singleMessageObservedName, [], 'a single message cannot establish a chat-local roster entry');
const sameMessageDuplicateObservedName = createChatLocalObservedSpeakerNames({
    messages: [
        { sourceMessageIndex: 6, visibleText: 'Pippa说：“一。” Pippa补充：“二。”' },
        { sourceMessageIndex: 6, visibleText: 'Pippa回答：“三。”' },
    ],
});
assert.deepEqual(sameMessageDuplicateObservedName, [], 'duplicate source indices do not count as independent chat messages');

for (const action of ['点头', '冷笑', '摇头']) {
    const actionCueIndex = createStructuralMessageSpeakerIndex({
        fullText: `Pippa${action}：“这里有线索。”`, sourceMessageIndex: 45232,
        sourceMessageHash: `sha256:non-speech-action:${action}`, publishedSpeakerNames: ['Pippa'],
    });
    assert.equal(actionCueIndex.anchors[0]?.speakerText, 'Pippa',
        `${action} before colon plus quote attributes to the exact published subject under the user-approved action-before-quote rule`);
    assert.equal(actionCueIndex.anchors[0]?.ruleId, 'rostered-subject-quoted-clause');
}

for (const [text, rosteredName] of [
    ['Celestia喘着气说：“不能无限清理。”', 'Celestia'],
    ['Pippa揉着肋骨，冷笑着说：“等等。”', 'Pippa'],
    ['尼布在门口尖叫：“出来！”', '尼布'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text,
        sourceMessageIndex: 45240,
        sourceMessageHash: `sha256:v27-rostered-predicate:${text}`,
        publishedSpeakerNames: [rosteredName],
    });
    assert.equal(index.anchors[0]?.speakerText, rosteredName,
        `${text} binds an exact rostered subject through a bounded manner/action predicate`);
    assert.equal(index.dialogueCandidateSpans.length, 1, 'the quoted turn remains a dialogue candidate');
    assert.equal(index.unresolvedDialogueSpans.length, 0, 'the explicit rostered speech turn is resolved');
}

const v27SecondSubjectAction = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa喘着气，她转向门口说道：“开门。”',
    sourceMessageIndex: 45241,
    sourceMessageHash: 'sha256:v27-second-subject-action',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v27SecondSubjectAction.anchors.length, 0,
    'a later pronoun-led subject does not inherit the first rostered subject through a comma clause');
assert.equal(v27SecondSubjectAction.unresolvedDialogueSpans.length, 1,
    'a second-subject turn without a name anchor remains unresolved');

const v27UnrosteredDescription = createStructuralMessageSpeakerIndex({
    fullText: '一个年长的法师喘着气说：“别进塔。”',
    sourceMessageIndex: 45242,
    sourceMessageHash: 'sha256:v27-unrostered-description',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v27UnrosteredDescription.anchors.length, 0,
    'a described, unrostered person is not promoted by the rostered-predicate rule');

const v27SourceFrame = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa看向地图，地图上写着：“旧磨坊，今晚交货。”',
    sourceMessageIndex: 45243,
    sourceMessageHash: 'sha256:v27-source-frame',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v27SourceFrame.anchors.length, 0,
    'a map/document source frame stays narration even when a rostered subject precedes it');
assert.equal(v27SourceFrame.dialogueCandidateSpans.length, 0,
    'a quoted map inscription is filtered from dialogue candidates');

for (const text of [
    'Pippa心想：“这是什么？”',
    'Pippa展示地图：“旧磨坊在北边。”',
    'Pippa把地图递给你：“旧磨坊在北边。”',
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text,
        sourceMessageIndex: 45245,
        sourceMessageHash: `sha256:v27-weak-or-source-frame:${text}`,
        publishedSpeakerNames: ['Pippa'],
    });
    assert.equal(index.anchors.length, 0,
        `${text} is not attributed from a bare roster-name prefix or an internal thought/source transfer`);
    assert.equal(index.unresolvedDialogueSpans.length, 1,
        'uncertain thought/map text remains unresolved instead of inventing an audible character turn');
}

const v27ExplicitSpeechAboutMap = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa说：“地图上写着旧磨坊在北边。”',
    sourceMessageIndex: 45246,
    sourceMessageHash: 'sha256:v27-explicit-speech-about-map',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v27ExplicitSpeechAboutMap.anchors[0]?.speakerText, 'Pippa',
    'an explicit speech predicate still attributes a character speaking about a map');

const v27DirectCueAfterAction = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa翻开账本，随后说道：“这里有线索。”',
    sourceMessageIndex: 45244,
    sourceMessageHash: 'sha256:v27-direct-cue-after-action',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v27DirectCueAfterAction.anchors[0]?.speakerText, 'Pippa',
    'an explicit direct-speech predicate wins over the preceding action clause');

const v28ActionCommaSpeechCue = createStructuralMessageSpeakerIndex({
    fullText: 'Celestia转身，随后低声说道：“我知道出口。”',
    sourceMessageIndex: 45247,
    sourceMessageHash: 'sha256:v28-action-comma-cue',
    publishedSpeakerNames: ['Celestia'],
});
assert.equal(v28ActionCommaSpeechCue.anchors[0]?.speakerText, 'Celestia',
    'a bounded action clause followed by comma and explicit speech cue anchors the rostered speaker');

const v28PlayerActionCue = createStructuralMessageSpeakerIndex({
    fullText: '你转身，随后喊道：“别过来！”',
    sourceMessageIndex: 45248,
    sourceMessageHash: 'sha256:v28-player-action-cue',
    publishedSpeakerNames: ['Pippa'],
});
assert.equal(v28PlayerActionCue.anchors[0]?.speakerText, '你',
    'a player subject with an explicit speech predicate is attributed to the player');

const v28PostQuotePlayerCue = createStructuralMessageSpeakerIndex({
    fullText: '“我会留下。”随后你回答。',
    sourceMessageIndex: 45249,
    sourceMessageHash: 'sha256:v28-postquote-player-cue',
});
assert.equal(v28PostQuotePlayerCue.anchors[0]?.speakerText, '你',
    'an explicit post-quote player subject and speech cue identifies the player');

const v28PostQuoteRosterCue = createStructuralMessageSpeakerIndex({
    fullText: '“门开了！”——维克多男爵说道。',
    sourceMessageIndex: 45250,
    sourceMessageHash: 'sha256:v28-postquote-rostered-cue',
    publishedSpeakerNames: ['维克多'],
});
assert.equal(v28PostQuoteRosterCue.anchors[0]?.speakerText, '维克多',
    'an exact roster name remains identifiable after a bounded honorific and direct post-quote cue');
assert.equal(v28PostQuoteRosterCue.anchors[0]?.speakerSpan?.start, Array.from('“门开了！”——').length,
    'the suffix anchor points to the exact roster name, not its honorific or speech cue');

const v28PluralRoleCue = createStructuralMessageSpeakerIndex({
    fullText: '守卫们齐声喊道：“站住！”',
    sourceMessageIndex: 45251,
    sourceMessageHash: 'sha256:v28-plural-role-cue',
});
assert.equal(v28PluralRoleCue.anchors[0]?.displaySpeakerText, '守卫（群体）',
    'a plural role label with an explicit collective speech cue resolves as a group');

const v30UnrosteredExplicitSpeech = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa骂了一句脏话，拽住你的背包带往外拖；尼布在门口尖叫：“出来！出来！”',
    sourceMessageIndex: 45260,
    sourceMessageHash: 'sha256:v30-unrostered-subject-speech-cue',
    parserVersion: 'full-message-speaker-index.v30',
});
assert.equal(v30UnrosteredExplicitSpeech.anchors.at(-1)?.speakerText, '尼布',
    'a unique name subject after a clause boundary can own an explicit speech-predicate quote without a roster');
const v30UnrosteredExplicitSpeechSource = 'Pippa骂了一句脏话，拽住你的背包带往外拖；尼布在门口尖叫：“出来！出来！”';
assert.equal(Array.from(v30UnrosteredExplicitSpeechSource)
    .slice(v30UnrosteredExplicitSpeech.anchors.at(-1).speakerSpan.start,
        v30UnrosteredExplicitSpeech.anchors.at(-1).speakerSpan.end).join(''), '尼布',
'unrostered subject evidence retains the exact source-name span');
assert.equal(v30UnrosteredExplicitSpeech.dialogueCandidateSpans.length, 1,
    'a uniquely anchored quote also enters the candidate span');
assert.equal(v30UnrosteredExplicitSpeech.unresolvedDialogueSpans.length, 0);

const v30UnrosteredAnnounce = createStructuralMessageSpeakerIndex({
    fullText: '马库斯宣布：“今晚行动。”', sourceMessageIndex: 45261,
    sourceMessageHash: 'sha256:v30-unrostered-announce', parserVersion: 'full-message-speaker-index.v30',
});
assert.equal(v30UnrosteredAnnounce.anchors[0]?.speakerText, '马库斯',
    'an explicit announcement predicate supports an unrostered character-like subject');

const v30AmbiguousCoordinatedSubject = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa骂了一句脏话；尼布和维克多在门口尖叫：“出来！”', sourceMessageIndex: 45262,
    sourceMessageHash: 'sha256:v30-coordinated-speech-subject', parserVersion: 'full-message-speaker-index.v30',
});
assert.equal(v30AmbiguousCoordinatedSubject.anchors.length, 0,
    'coordinated unrostered subjects remain ambiguous rather than assigning the quote to one person');

const v30WallAndNicknameNarration = [
    '墙上刻着“灰羽”这个称号：“擅入者死。”',
    '“灰羽”这个绰号被写进传记，后来再次出现：“她只在冬天现身。”',
];
for (const [index, text] of v30WallAndNicknameNarration.entries()) {
    const structural = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45263 + index,
        sourceMessageHash: `sha256:v30-source-or-nickname-negative:${index}`,
        parserVersion: 'full-message-speaker-index.v30',
    });
    assert.equal(structural.anchors.length, 0, 'wall information and quoted nicknames in narration are not speaker evidence');
}

const v30PlayerPostQuoteVocalization = createStructuralMessageSpeakerIndex({
    fullText: '“冲啊！”你怒吼一声，握紧巨剑冲进烟雾。', sourceMessageIndex: 45265,
    sourceMessageHash: 'sha256:v30-player-postquote-vocalization', parserVersion: 'full-message-speaker-index.v30',
});
assert.equal(v30PlayerPostQuoteVocalization.anchors[0]?.speakerText, '你',
    'a short explicit player vocalization after a quote binds it to the player');
assert.equal(v30PlayerPostQuoteVocalization.anchors[0]?.ruleId, 'player-direct-speech');
const v30PlayerActionOnly = createStructuralMessageSpeakerIndex({
    fullText: '“现在！”你带着Pippa快速游向图书馆入口。', sourceMessageIndex: 45266,
    sourceMessageHash: 'sha256:v30-player-action-without-speech', parserVersion: 'full-message-speaker-index.v30',
});
assert.equal(v30PlayerActionOnly.anchors.length, 0,
    'player action after a quote without an explicit vocalization does not claim the quote');

const v30PronounAfterNamedAnchor = createStructuralMessageSpeakerIndex({
    fullText: 'Durik说：“这里安全。”他随后低声说道：“跟我来。”', sourceMessageIndex: 45267,
    sourceMessageHash: 'sha256:v30-unique-pronoun-follow-up', parserVersion: 'full-message-speaker-index.v30',
});
assert.deepEqual(v30PronounAfterNamedAnchor.anchors.map((anchor) => anchor.speakerText), ['Durik', 'Durik'],
    'a unique explicit named anchor resolves a pronoun follow-up within the same message and bounded window');
assert.equal(v30PronounAfterNamedAnchor.anchors[1]?.ruleId, 'pronoun-backreference');
const v30CompetingPronounAntecedents = createStructuralMessageSpeakerIndex({
    fullText: 'Durik说：“这里安全。”Pippa说：“后门有人。”她随后低声说道：“跟我来。”', sourceMessageIndex: 45268,
    sourceMessageHash: 'sha256:v30-competing-pronoun-follow-up', parserVersion: 'full-message-speaker-index.v30',
});
assert.deepEqual(v30CompetingPronounAntecedents.anchors.map((anchor) => anchor.speakerText), ['Durik', 'Pippa'],
    'two nearby named anchors keep a pronoun follow-up unresolved');

const v31ReportedUtterances = [
    '尼布的第一句话是：“我还活着？”',
    '尼布醒来后的第一句话是：“我们出发。”',
    '醒来后，尼布说的第一句话是：“我还活着？”',
];
for (const [index, fullText] of v31ReportedUtterances.entries()) {
    const sourceMessageHash = `sha256:${createHash('sha256').update(fullText, 'utf8').digest('hex')}`;
    const structural = createStructuralMessageSpeakerIndex({
        fullText, sourceMessageIndex: 45269 + index, sourceMessageHash, parserVersion: 'full-message-speaker-index.v32',
    });
    const anchor = structural.anchors[0];
    assert.equal(anchor?.speakerText, '尼布', 'a named character owns a specifically reported first utterance');
    assert.equal(anchor?.ruleId, 'reported-first-utterance');
    assert.equal(Array.from(fullText).slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join(''), '尼布',
        'reported-utterance attribution points at the exact name source span');
    assert.equal(structural.dialogueCandidateSpans.length, 1);
    assert.equal(structural.unresolvedDialogueSpans.length, 0);

    const pages = createVisualNovelDisplaySegments(fullText, { role: 'character' });
    assert.ok(pages.every((page) => Number.isSafeInteger(page.sourceSpan?.start)
        && Number.isSafeInteger(page.sourceSpan?.end) && page.sourceSpan.end > page.sourceSpan.start
        && page.sourceSpan.end <= Array.from(fullText).length),
    'reported first utterances project only onto valid existing production-page spans');
    const evidence = pages.map((page) => createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: structural, fullText, sourceMessageIndex: 45269 + index, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v32', coreSpan: page.sourceSpan, pageType: page.type,
    }));
    assert.ok(evidence.some((item) => item?.kind === 'speaker' && item.text === '尼布'),
        'reported first-utterance evidence reaches an addressable current production page');
}

for (const [index, fullText] of [
    'Pippa心想，她的第一句话是：“别怕。”',
    '账本上的第一句话是：“黑喙收账。”',
    '地图上标注：“旧磨坊，今晚交货。”',
    '治疗与审问：格雷戈的情报',
    '维克多转身，尼布也走到门口：“他们到了。”',
    '“有人在门口。”',
].entries()) {
    const structural = createStructuralMessageSpeakerIndex({
        fullText, sourceMessageIndex: 45272 + index,
        sourceMessageHash: `sha256:v31-negative-${index}`, parserVersion: 'full-message-speaker-index.v32',
    });
    assert.equal(structural.anchors.length, 0, `${fullText} is not assigned by the v31 general structures`);
}

const v31UniqueActionQuote = '维克多转身，走到门口：“他们到了。”';
const v31UniqueActionIndex = createStructuralMessageSpeakerIndex({
    fullText: v31UniqueActionQuote, sourceMessageIndex: 45280,
    sourceMessageHash: 'sha256:v31-unique-action-quote', parserVersion: 'full-message-speaker-index.v32',
});
assert.equal(v31UniqueActionIndex.anchors[0]?.speakerText, '维克多',
    'a unique name subject may persist through bounded action clauses before a colon quote');
assert.equal(v31UniqueActionIndex.anchors[0]?.ruleId, 'unrostered-action-attribution');
assert.equal(Array.from(v31UniqueActionQuote).slice(v31UniqueActionIndex.anchors[0].speakerSpan.start,
    v31UniqueActionIndex.anchors[0].speakerSpan.end).join(''), '维克多');
const v31MultipleActionSubjects = createStructuralMessageSpeakerIndex({
    fullText: '维克多转身，尼布也走到门口：“他们到了。”', sourceMessageIndex: 45281,
    sourceMessageHash: 'sha256:v31-competing-action-subjects', parserVersion: 'full-message-speaker-index.v32',
});
assert.equal(v31MultipleActionSubjects.anchors.length, 0,
    'a later named action subject prevents single-speaker attribution');

const v32NibuReactionQuote = '尼布在旁边看得眼睛发直：“好吧，那屁股现在不是重点了。”';
const v32NibuReactionIndex = createStructuralMessageSpeakerIndex({
    fullText: v32NibuReactionQuote, sourceMessageIndex: 45282,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32NibuReactionQuote, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
assert.equal(v32NibuReactionIndex.anchors[0]?.speakerText, '尼布',
    'an unrostered unique actor can own a quote after a bounded location and result-reaction clause');
assert.equal(Array.from(v32NibuReactionQuote).slice(v32NibuReactionIndex.anchors[0].speakerSpan.start,
    v32NibuReactionIndex.anchors[0].speakerSpan.end).join(''), '尼布',
    'the new attribution keeps its exact source speaker span');

const v32FirstAppearanceEntity = '银面具贵客看见维斯坎特死了，终于不再优雅。她站起身，银面下的嘴角抽了一下：“无礼。”';
const v32FirstAppearanceIndex = createStructuralMessageSpeakerIndex({
    fullText: v32FirstAppearanceEntity, sourceMessageIndex: 45283,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32FirstAppearanceEntity, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
assert.equal(v32FirstAppearanceIndex.anchors[0]?.speakerText, '银面具贵客',
    'a unique descriptive role noun at sentence start can resolve a local pronoun follow-up');
assert.equal(v32FirstAppearanceIndex.anchors[0]?.ruleId, 'pronoun-backreference');
assert.equal(Array.from(v32FirstAppearanceEntity).slice(v32FirstAppearanceIndex.anchors[0].speakerSpan.start,
    v32FirstAppearanceIndex.anchors[0].speakerSpan.end).join(''), '银面具贵客',
    'first-appearance title evidence points to the original descriptive-name span');

const v32DisplayedText = '它没有赫娅的脸，只有一张模糊的空白面孔；胸口却浮着一行灰字：“绑定对象不完整。寻找缺失真名。”';
const v32DisplayedTextIndex = createStructuralMessageSpeakerIndex({
    fullText: v32DisplayedText, sourceMessageIndex: 45284,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32DisplayedText, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
const v32DisplayedTextPage = createVisualNovelDisplaySegments(v32DisplayedText, { role: 'character' })[0];
const v32DisplayedTextEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v32DisplayedTextIndex, fullText: v32DisplayedText, sourceMessageIndex: 45284,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32DisplayedText, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32', coreSpan: v32DisplayedTextPage.sourceSpan,
    pageType: v32DisplayedTextPage.type,
});
assert.equal(v32DisplayedTextEvidence?.classification, 'narration',
    'quoted words explicitly floating as text on a body are narration/info, not a character turn');
assert.deepEqual(v32DisplayedTextIndex.anchors, [], 'displayed text does not create a speaker identity');

const v32CampaignMetadata = '(Fighter Campaign)';
const v32CampaignIndex = createStructuralMessageSpeakerIndex({
    fullText: v32CampaignMetadata, sourceMessageIndex: 45285,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32CampaignMetadata, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
const v32CampaignPage = createVisualNovelDisplaySegments(v32CampaignMetadata, { role: 'character' })[0];
const v32CampaignEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v32CampaignIndex, fullText: v32CampaignMetadata, sourceMessageIndex: 45285,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32CampaignMetadata, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32', coreSpan: v32CampaignPage.sourceSpan,
    pageType: v32CampaignPage.type,
});
assert.equal(v32CampaignEvidence?.classification, 'narration',
    'compact campaign metadata is displayed under the user-selected narration category');

const v32PostQuoteAction = 'Durik握紧战斧:"那我们赶紧砍碎那个心脏!"\n\n"等等!"Pippa举起手:"这里有个陷阱。"';
const v32PostQuoteActionIndex = createStructuralMessageSpeakerIndex({
    fullText: v32PostQuoteAction, publishedSpeakerNames: ['Durik', 'Pippa'], sourceMessageIndex: 45286,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32PostQuoteAction, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
assert.deepEqual(v32PostQuoteActionIndex.anchors.map((anchor) => anchor.speakerText), ['Durik', 'Pippa', 'Pippa'],
    'the post-quote actor action plus its following attributed quote identifies the preceding short quote locally');

const v32FirstAppearanceEnemy = '人鱼战士领队说："龙魂守护者，裂缝深处就是图书馆。触手怪在裂缝边缘巡逻，我们会吸引它们的注意，你们趁机潜入。"';
const v32FirstAppearanceEnemyIndex = createStructuralMessageSpeakerIndex({
    fullText: v32FirstAppearanceEnemy, sourceMessageIndex: 45287,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32FirstAppearanceEnemy, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
assert.equal(v32FirstAppearanceEnemyIndex.anchors[0]?.speakerText, '人鱼战士领队',
    'an explicit speech cue can identify a first-appearance enemy/unit role as a display-only speaker title');

const v32NibuReport = 'Durik吹了声口哨："Boss现在AC 22！尸巫的Circle of Death打中你都只扣18点HP，普通攻击根本碰不到Boss！"\n\n尼布合上账本："Boss，暗影墓穴完全清剿完成！总收获统计：\nHP: 12\n金币: 20"';
const v32NibuReportIndex = createStructuralMessageSpeakerIndex({
    fullText: v32NibuReport, publishedSpeakerNames: ['Durik', '尼布'], sourceMessageIndex: 45288,
    sourceMessageHash: `sha256:${createHash('sha256').update(v32NibuReport, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v32',
});
assert.deepEqual(v32NibuReportIndex.anchors.map((anchor) => anchor.speakerText), ['Durik', '尼布'],
    'a new explicitly named report speaker supersedes the closed previous utterance across record pages');

const v33DirectActionCases = [
    '你闻到湿木、油烟、血和霉粮的味道。尼布趴在一堆蕨叶后，压低声音：“别现在开打，罐头先生。”',
    '你、Pippa和尼布坐在Lila的新坟边上。Pippa把最后一瓶高级治疗药水塞进你手里：“喝了。”',
    '你用最后一点意识，从牙缝里挤出声音：“Pippa……炸了它！”\n\n声音很小，但足够让屋里所有倒霉蛋听见。\n\nPippa 的眼睛亮了。她被两个黑喙帮徒按着，却忽然咧嘴一笑：“终于有人说了句聪明话！”',
    '玛赫拉在旁边哼了一声：“卖什么你自己定。想去旧钟楼，别把所有工具都换成金币。”',
];
for (const [index, text] of v33DirectActionCases.entries()) {
    const parsed = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45289 + index,
        sourceMessageHash: `sha256:v33-action:${index}`,
        parserVersion: 'full-message-speaker-index.v33',
    });
    assert.equal(parsed.anchors.at(-1)?.speakerText, index === 0 ? '尼布' : index === 3 ? '玛赫拉' : 'Pippa',
        'a unique actor remains attributable when a bounded posture/transfer action precedes dialogue');
}

const v33WrittenQuoteCases = [
    '铜制乌鸦徽记约拇指大小，边缘磨损，背面刻着一行歪斜通用语：“黑喙收账，欠债还肉。”',
    '羊皮纸上画着一条简陋地图：泥路向北通往贸易镇灰桥镇，向东则标着一个骷髅符号和几个字：“旧磨坊，今晚交货。”',
    '小皮筒里塞着三张卷紧的账页，内容比主账本更脏：灰桥镇议员布拉姆收过鸦冠会“安静费”；河神小神殿药房从苦蜡铺买过违禁镇痛剂；还有一条被黑墨圈住的记录：“Lady Veyra，黑冠债权，采购：影裂卷轴残页、活体魔力样本、Swiftfoot转交价预付。”',
    '它刚刚跳出来宣布自己是“这段路边的恐怖”，但它的气势大概只够吓唬一只患有焦虑症的萝卜。',
    '你双手握紧巨剑，血从左腿一路淌进靴子里，发出一种非常不英雄、但很湿润的“噗叽”。',
];
for (const [index, text] of v33WrittenQuoteCases.entries()) {
    const sourceMessageIndex = 45291 + index;
    const sourceMessageHash = `sha256:v33-written:${index}`;
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v33',
    });
    const page = createVisualNovelDisplaySegments(text, { role: 'character' })[0];
    const title = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex, fullText: text, sourceMessageIndex, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v33', coreSpan: page.sourceSpan, pageType: page.type,
    });
    assert.equal(title?.classification, 'narration',
        'written source text and inline quoted prose/sound effects remain narration rather than speaker candidates');
}

const v33SelfIntroduction = '“别砍我！我叫尼布，不是格里布那种没文化的肉馅候选人。”';
const v33SelfIntroductionIndex = createStructuralMessageSpeakerIndex({
    fullText: v33SelfIntroduction, sourceMessageIndex: 45295,
    sourceMessageHash: `sha256:${createHash('sha256').update(v33SelfIntroduction, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v33',
});
const v33SelfIntroductionPage = createVisualNovelDisplaySegments(v33SelfIntroduction, { role: 'character' })[0];
const v33SelfIntroductionEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v33SelfIntroductionIndex, fullText: v33SelfIntroduction, sourceMessageIndex: 45295,
    sourceMessageHash: `sha256:${createHash('sha256').update(v33SelfIntroduction, 'utf8').digest('hex')}`,
    parserVersion: 'full-message-speaker-index.v33', coreSpan: v33SelfIntroductionPage.sourceSpan,
    pageType: v33SelfIntroductionPage.type,
});
assert.equal(v33SelfIntroductionEvidence?.text, '？？？',
    'a first self-introduction remains anonymous even when it follows a short plea in the same utterance');
assert.deepEqual(v33SelfIntroductionIndex.anchors, [], 'self-reported names do not create a speaker identity');

assert.equal(formatVisualNovelDisplayText('请翻到上一页。').includes('上一页'), true,
    'review-only 上一页 markers are not stripped from legitimate canonical story text');

for (const [text, roster] of [
    ['“别动！”她大喊。', []],
    ['“别动！”一个年长的法师喊道。', []],
    ['守卫们拔剑：“站住！”', []],
    ['墙上刻着：“进入者不得通行。”', []],
    ['System: “Encounter begins.”', []],
    ['“快跑，别回头！”', []],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text,
        sourceMessageIndex: 45252,
        sourceMessageHash: `sha256:v28-negative:${text}`,
        publishedSpeakerNames: roster,
    });
    assert.equal(index.anchors.length, 0, `${text} does not create a guessed speaker anchor`);
}

const publishedBareColonQuote = createStructuralMessageSpeakerIndex({
    fullText: 'Kael: “I will scout ahead.”', sourceMessageIndex: 45211,
    sourceMessageHash: 'sha256:published-bare-colon-quote', publishedSpeakerNames: ['Kael'],
});
assert.equal(publishedBareColonQuote.anchors[0]?.speakerText, 'Kael', 'a bare colon quote is attributable when the name is in the published roster');

for (const text of ['Status: “Healthy”', 'Strategy: “Attack left.”']) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45212, sourceMessageHash: `sha256:${text}`, publishedSpeakerNames: [],
    });
    assert.equal(index.anchors.length, 0, `${text} cannot invent an unlisted speaker`);
    if (text.startsWith('Status:')) {
        assert.equal(index.dialogueCandidateSpans.length, 0, `${text} is game information and belongs to narration`);
        assert.equal(index.unresolvedDialogueSpans.length, 0, `${text} must not remain in the unattributed-dialogue bucket`);
    } else {
        assert.equal(index.unresolvedDialogueSpans.length, 1, `${text} remains safely unattributed without speaker evidence`);
    }
    const exactLabel = text.slice(0, text.indexOf(':'));
    const scopedIndex = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 45213, sourceMessageHash: `sha256:rostered:${text}`,
        publishedSpeakerNames: [exactLabel],
    });
    assert.equal(scopedIndex.anchors[0]?.speakerText, exactLabel,
        `${text} remains attributable when the exact name is in the published roster`);
}
const clauseIsNotModifier = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa在门口数着金币：“这太多了！”', sourceMessageIndex: 4522,
    sourceMessageHash: 'sha256:clause-is-not-modifier', publishedSpeakerNames: ['Pippa'],
});
assert.equal(clauseIsNotModifier.anchors[0]?.speakerText, 'Pippa',
    'the user-approved rostered action clause plus immediate colon and quote attributes the quote to Pippa');
assert.equal(clauseIsNotModifier.anchors[0]?.ruleId, 'rostered-subject-quoted-clause');
const headingLikeLine = createStructuralMessageSpeakerIndex({
    fullText: 'Strategy: prioritize defense.', sourceMessageIndex: 45221,
    sourceMessageHash: 'sha256:heading-like-line',
});
assert.equal(headingLikeLine.anchors.length, 0, 'an unrostered colon label without a quoted utterance is not promoted to a character');

const incidentalQuoteText = 'Nira说：“门开了。” 她把《旧王冠》称作“沉睡的月亮”。';
const incidentalQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: incidentalQuoteText, sourceMessageIndex: 4523,
    sourceMessageHash: 'sha256:incidental-quoted-title', publishedSpeakerNames: ['Nira'],
});
assert.deepEqual(incidentalQuoteIndex.anchors.map((anchor) => anchor.speakerText), ['Nira']);
assert.equal(incidentalQuoteIndex.unresolvedDialogueSpans.length, 0,
    'an inline title/citation quote does not veto a separate, fully attributed utterance');
const standaloneUnknownQuote = createStructuralMessageSpeakerIndex({
    fullText: '“别动！”', sourceMessageIndex: 4524, sourceMessageHash: 'sha256:standalone-unknown-quote',
});
assert.equal(standaloneUnknownQuote.unresolvedDialogueSpans.length, 1,
    'a standalone quote without attribution remains unknown speech');

const conflictingAttributionText = 'Nira说：“门开了。” Lila回答。';
const conflictingAttributionIndex = createStructuralMessageSpeakerIndex({
    fullText: conflictingAttributionText, sourceMessageIndex: 453, sourceMessageHash: 'sha256:conflicting-attribution',
    publishedSpeakerNames: ['Nira', 'Lila'],
});
assert.equal(conflictingAttributionIndex.anchors.length, 0, 'conflicting prefix and suffix attributions do not select one speaker');
assert.equal(conflictingAttributionIndex.unresolvedDialogueSpans[0]?.reasonId, 'conflicting-quoted-attribution');

for (const [text, names] of [
    ['大家都知道：“快走。”', []],
    ['我们知道：“快走。”', []],
    ['我们都说：“快走。”', []],
    ['“快走。”大家都知道。', []],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4531, sourceMessageHash: `sha256:${text}`,
        publishedSpeakerNames: names,
    });
    assert.equal(index.anchors.length, 0, `${text} must not turn a generic narrative phrase into a speaker label`);
    assert.equal(index.unresolvedDialogueSpans.length, 1, `${text} remains unknown quoted dialogue`);
}

const rosteredHanSingleCue = createStructuralMessageSpeakerIndex({
    fullText: '尼布说：“快走。”', sourceMessageIndex: 4532, sourceMessageHash: 'sha256:rostered-single-cue',
    publishedSpeakerNames: ['尼布'],
});
assert.equal(rosteredHanSingleCue.anchors[0]?.speakerText, '尼布', 'an exact published Chinese name remains valid with a generic speech cue');
const explicitUnknownHanCue = createStructuralMessageSpeakerIndex({
    fullText: '青岚问道：“快走。”', sourceMessageIndex: 4533, sourceMessageHash: 'sha256:explicit-unknown-han',
});
assert.equal(explicitUnknownHanCue.anchors[0]?.speakerText, '青岚', 'an explicit multi-character speech cue may identify a new Chinese speaker');

for (const [text, expectedName] of [
    ['Nira says: \'The gate is open.\'', 'Nira'],
    ['Nira说道：‘门开了。’', 'Nira'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 454, sourceMessageHash: 'sha256:quoted-form',
        publishedSpeakerNames: ['Nira'],
    });
    assert.equal(index.anchors[0]?.speakerText, expectedName, 'ASCII and curly single-quoted direct speech can retain explicit attribution');
    assert.equal(index.unresolvedDialogueSpans.length, 0);
}
const unattributedAsciiQuote = 'The guard said, \'Do not enter.\'';
const unattributedAsciiIndex = createStructuralMessageSpeakerIndex({
    fullText: unattributedAsciiQuote, sourceMessageIndex: 455, sourceMessageHash: 'sha256:unattributed-ascii',
});
assert.equal(unattributedAsciiIndex.anchors.length, 0);
assert.equal(unattributedAsciiIndex.unresolvedDialogueSpans.length, 1, 'unattributed ASCII quoted text must not fall through as narration');
const apostropheText = "Nira's sword gleamed beneath the torch.";
const apostropheIndex = createStructuralMessageSpeakerIndex({
    fullText: apostropheText, sourceMessageIndex: 456, sourceMessageHash: 'sha256:apostrophe-not-quote',
});
assert.equal(apostropheIndex.unresolvedDialogueSpans.length, 0, 'an English possessive apostrophe is not a quoted-dialogue cue');
for (const text of ['That’s fine; the gate is closed.', '她说don’t停下，门已经开了。']) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 4561, sourceMessageHash: `sha256:${text}`,
    });
    assert.equal(index.unresolvedDialogueSpans.length, 0, `${text} uses U+2019 as an apostrophe, not an unmatched quote`);
}
assert.equal(structuralTitle({ text: 'That’s fine; the gate is closed.', allowPlainNarration: true })?.classification,
    'narration', 'a curly apostrophe must not block the plain-prose title fallback');
const quotedInternalApostrophe = createStructuralMessageSpeakerIndex({
    fullText: 'Nira说道：‘it’s fine’', sourceMessageIndex: 4562, sourceMessageHash: 'sha256:quoted-internal-apostrophe',
    publishedSpeakerNames: ['Nira'],
});
assert.equal(quotedInternalApostrophe.anchors[0]?.speakerText, 'Nira', 'an apostrophe inside a curly-quoted English sentence does not close the quote');
assert.equal(Array.from('Nira说道：‘it’s fine’').slice(
    quotedInternalApostrophe.anchors[0]?.utteranceSpans[0]?.start,
    quotedInternalApostrophe.anchors[0]?.utteranceSpans[0]?.end,
).join(''), 'it’s fine');
const quoteImmediatelyFollowedByHan = 'Nira说道：‘hello’她补充。‘另一段无署名对白。’';
const quoteImmediatelyFollowedByHanIndex = createStructuralMessageSpeakerIndex({
    fullText: quoteImmediatelyFollowedByHan, sourceMessageIndex: 4563, sourceMessageHash: 'sha256:quote-followed-by-han',
    publishedSpeakerNames: ['Nira'],
});
assert.deepEqual(quoteImmediatelyFollowedByHanIndex.anchors.map((anchor) => anchor.speakerText), ['Nira'],
    'a true curly quote closes before immediately adjacent Chinese narration');
assert.equal(quoteImmediatelyFollowedByHanIndex.unresolvedDialogueSpans.length, 1,
    'the following independent quote remains unattributed instead of being swallowed by the first speaker');
assert.equal(Array.from(quoteImmediatelyFollowedByHan).slice(
    quoteImmediatelyFollowedByHanIndex.anchors[0].utteranceSpans[0].start,
    quoteImmediatelyFollowedByHanIndex.anchors[0].utteranceSpans[0].end,
).join(''), 'hello');
const quoteFollowedByDifferentNonLatinScript = 'Nira说道：‘Ω’Ж随后。‘另一段无署名对白。’';
const quoteFollowedByDifferentNonLatinScriptIndex = createStructuralMessageSpeakerIndex({
    fullText: quoteFollowedByDifferentNonLatinScript, sourceMessageIndex: 4564, sourceMessageHash: 'sha256:quote-cross-script',
    publishedSpeakerNames: ['Nira'],
});
assert.deepEqual(quoteFollowedByDifferentNonLatinScriptIndex.anchors.map((anchor) => anchor.speakerText), ['Nira'],
    'a curly quote closes when adjacent letters are not a supported Latin apostrophe');
assert.equal(quoteFollowedByDifferentNonLatinScriptIndex.unresolvedDialogueSpans.length, 1,
    'a later independent quote remains unknown after a non-Latin quote closer');

const mixedAttributedAndUnknownText = 'Nira说：“我到了。” “还有一段没有署名。”';
const mixedAttributedAndUnknownIndex = createStructuralMessageSpeakerIndex({
    fullText: mixedAttributedAndUnknownText, sourceMessageIndex: 46, sourceMessageHash: 'sha256:mixed-unresolved',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: mixedAttributedAndUnknownIndex,
    fullText: mixedAttributedAndUnknownText,
    sourceMessageIndex: 46,
    sourceMessageHash: 'sha256:mixed-unresolved',
    coreSpan: { start: 0, end: Array.from(mixedAttributedAndUnknownText).length },
})?.text, 'Nira', 'a page with an explicit speaker keeps that speaker title even when another quote is unresolved');
assert.deepEqual(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: mixedAttributedAndUnknownIndex,
    fullText: mixedAttributedAndUnknownText,
    sourceMessageIndex: 46,
    sourceMessageHash: 'sha256:mixed-unresolved',
    coreSpan: { start: 0, end: Array.from(mixedAttributedAndUnknownText).length },
})?.speakers.map((speaker) => speaker.text), ['Nira'], 'the explicit speaker remains the only attributed title');

const continuedUnresolvedText = '楼梯下传来声音：“快走，别回头。';
const continuedUnresolvedChars = Array.from(continuedUnresolvedText);
const continuedUnresolvedIndex = createStructuralMessageSpeakerIndex({
    fullText: continuedUnresolvedText, sourceMessageIndex: 49, sourceMessageHash: 'sha256:unresolved-page',
});
const unresolvedPageStart = Array.from('楼梯下传来声音：“快走，').length;
const unresolvedPageEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: continuedUnresolvedIndex, fullText: continuedUnresolvedText,
    sourceMessageIndex: 49, sourceMessageHash: 'sha256:unresolved-page',
    coreSpan: { start: unresolvedPageStart, end: continuedUnresolvedChars.length },
});
assert.equal(unresolvedPageEvidence?.text, '旁白');
assert.equal(unresolvedPageEvidence?.classification, 'narration');
assert.equal(unresolvedPageEvidence?.ruleId, 'narrative-framed-quote');
assert.ok(unresolvedPageEvidence.classificationEvidenceSpans.every((span) => (
    span.start >= unresolvedPageStart && span.end <= continuedUnresolvedChars.length
)), 'narrator fallback evidence is confined to the exact page core');
assert.deepEqual(unresolvedPageEvidence.speakers, [], 'narrator fallback stays identity-free');

const twoSpeakerIndexText = 'Nira说：“我到了。” Venn答：“我也到了。”';
const twoSpeakerIndex = createStructuralMessageSpeakerIndex({
    fullText: twoSpeakerIndexText, sourceMessageIndex: 47, sourceMessageHash: 'sha256:two-speakers',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: twoSpeakerIndex, fullText: twoSpeakerIndexText,
    sourceMessageIndex: 47, sourceMessageHash: 'sha256:two-speakers',
    coreSpan: { start: 0, end: Array.from(twoSpeakerIndexText).length },
})?.text, '多人对话');

const scopedIndex = createStructuralMessageSpeakerIndex({
    fullText: splitMessage, sourceMessageIndex: 44, sourceMessageHash: fullMessageHash,
    publishedSpeakerFingerprint: 'different-cast',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: scopedIndex, fullText: splitMessage, sourceMessageIndex: 44,
    sourceMessageHash: fullMessageHash, publishedSpeakerFingerprint: 'cast-release-1',
    coreSpan: { start: splitAt, end: splitMessageChars.length },
}), null, 'a roster fingerprint mismatch invalidates message index projection');

const malformedAfterClearQuoteText = 'Nira说：“这一句有明确归属。” 随后出现“未配对的引号」';
const malformedAfterClearQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: malformedAfterClearQuoteText, sourceMessageIndex: 48, sourceMessageHash: 'sha256:localized-ambiguity',
});
const clearQuoteEnd = Array.from('Nira说：“这一句有明确归属。”').length;
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: malformedAfterClearQuoteIndex,
    fullText: malformedAfterClearQuoteText,
    sourceMessageIndex: 48,
    sourceMessageHash: 'sha256:localized-ambiguity',
    coreSpan: { start: 0, end: clearQuoteEnd },
})?.text, 'Nira', 'a malformed later quote does not erase an earlier complete attribution');
const malformedStart = Array.from('Nira说：“这一句有明确归属。” 随后出现').length;
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: malformedAfterClearQuoteIndex,
    fullText: malformedAfterClearQuoteText,
    sourceMessageIndex: 48,
    sourceMessageHash: 'sha256:localized-ambiguity',
    coreSpan: { start: malformedStart, end: Array.from(malformedAfterClearQuoteText).length },
})?.classification, 'narration', 'an unclosed malformed quote without unique evidence falls back to narrator');
const malformedQuotePageEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: malformedAfterClearQuoteIndex,
    fullText: malformedAfterClearQuoteText,
    sourceMessageIndex: 48,
    sourceMessageHash: 'sha256:localized-ambiguity',
    coreSpan: { start: malformedStart, end: Array.from(malformedAfterClearQuoteText).length },
});
assert.equal(malformedQuotePageEvidence?.text, '旁白');
assert.equal(malformedQuotePageEvidence?.ruleId, 'narrative-framed-quote');

const openQuoteText = '“门外有人';
const openQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: openQuoteText, sourceMessageIndex: 481, sourceMessageHash: 'sha256:open-quote-no-speaker',
});
const openQuoteEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: openQuoteIndex, fullText: openQuoteText, sourceMessageIndex: 481,
    sourceMessageHash: 'sha256:open-quote-no-speaker',
    coreSpan: { start: 0, end: Array.from(openQuoteText).length },
});
assert.equal(openQuoteEvidence?.text, '旁白', 'an unresolved still-open quote falls back to narration in v66');
assert.equal(openQuoteEvidence?.classification, 'narration');
assert.equal(openQuoteEvidence?.ruleId, 'narrative-framed-quote');
assert.equal(openQuoteEvidence?.diagnosticReasonId, 'open-quote-without-unique-speaker');
assert.deepEqual(openQuoteEvidence?.speakers, []);

const orphanLineEndQuoteText = '- 楼下九个护卫可能破窗爬上来"\n\nCelestia严肃地说："方案C风险最高，但最快。"\n\nMira补充："如果留在三楼，Boss有支援；如果下楼，防线更稳。"\n\n六个战力，十五个护卫加一个前圣骑士，三个战术方案，明晚十点行动。';
const orphanLineEndQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: orphanLineEndQuoteText, publishedSpeakerNames: ['Celestia', 'Mira'],
    sourceMessageIndex: 482, sourceMessageHash: 'sha256:orphan-line-end-quote',
});
assert.deepEqual(orphanLineEndQuoteIndex.anchors.map((anchor) => anchor.speakerText), ['Celestia', 'Mira'],
    'a terminal orphan ASCII quote cannot consume the next opener or shift later speaker attribution');
assert.deepEqual(orphanLineEndQuoteIndex.unresolvedDialogueSpans, [],
    'the closed Mira quote and following unquoted summary do not become an open quote');
const summaryStart = Array.from(orphanLineEndQuoteText).join('').indexOf('六个战力');
const orphanQuoteSummary = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: orphanLineEndQuoteIndex, fullText: orphanLineEndQuoteText,
    sourceMessageIndex: 482, sourceMessageHash: 'sha256:orphan-line-end-quote',
    coreSpan: { start: summaryStart, end: Array.from(orphanLineEndQuoteText).length }, pageType: 'narration',
});
assert.equal(orphanQuoteSummary?.text, '旁白',
    'unquoted summary after a closed speaker turn uses the existing plain-prose narrator title');
assert.deepEqual(orphanQuoteSummary?.speakers, [], 'the narration fallback does not create a speaker identity');

const celestiaCueText = 'Celestia严肃地说：“方案C风险最高，但最快。”';
const celestiaCueIndex = createStructuralMessageSpeakerIndex({
    fullText: celestiaCueText, publishedSpeakerNames: ['Celestia'], sourceMessageIndex: 50,
    sourceMessageHash: 'sha256:celestia-explicit-cue', parserVersion: 'full-message-speaker-index.v12',
});
assert.equal(celestiaCueIndex.anchors[0]?.speakerText, 'Celestia',
    'a rostered name followed by an action modifier and explicit speech cue remains attributable');

const selfIntroductionText = '“我是塞拉菲娜，Eldoria林间秘境的守护者……”';
const selfIntroductionIndex = createStructuralMessageSpeakerIndex({
    fullText: selfIntroductionText, publishedSpeakerNames: ['塞拉菲娜'], sourceMessageIndex: 51,
    sourceMessageHash: 'sha256:unknown-self-introduction', parserVersion: 'full-message-speaker-index.v12',
});
const selfIntroductionTitle = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: selfIntroductionIndex, fullText: selfIntroductionText, sourceMessageIndex: 51,
    sourceMessageHash: 'sha256:unknown-self-introduction', parserVersion: 'full-message-speaker-index.v12',
    coreSpan: { start: 0, end: Array.from(selfIntroductionText).length },
});
assert.equal(selfIntroductionTitle?.kind, 'classification');
assert.equal(selfIntroductionTitle?.classification, 'unattributed-dialogue');
assert.equal(selfIntroductionTitle?.text, '？？？', 'first-person introduction does not promote the self-reported name to identity');
assert.equal(selfIntroductionTitle?.ruleId, 'unknown-self-introduction');
assert.deepEqual(selfIntroductionTitle?.speakers, [], 'unknown self-introduction carries no speaker or visual identity');
for (const [ordinaryLine, roster] of [
    ['“我是不会让步的。”', []],
    ['“I am ready.”', []],
]) {
    const ordinaryIndex = createStructuralMessageSpeakerIndex({
        fullText: ordinaryLine, publishedSpeakerNames: roster, sourceMessageIndex: 510,
        sourceMessageHash: `sha256:ordinary-${ordinaryLine}`, parserVersion: 'full-message-speaker-index.v12',
    });
    const ordinaryTitle = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: ordinaryIndex, fullText: ordinaryLine, sourceMessageIndex: 510,
        sourceMessageHash: `sha256:ordinary-${ordinaryLine}`, parserVersion: 'full-message-speaker-index.v12',
        coreSpan: { start: 0, end: Array.from(ordinaryLine).length },
    });
    assert.equal(ordinaryTitle?.text, '旁白',
        'ordinary first-person statements are not mistaken for name introductions');
    assert.equal(ordinaryTitle?.diagnosticReasonId, 'no-unique-speaker-evidence');
}

const pippaPronounText = 'Pippa沉默地走到Lila身边。她没有哭，只是低声说：“她死得像个战士。比大多数人都勇敢。”随后她站起来，看向你：“Lady Veyra死了……”';
const pippaPronounIndex = createStructuralMessageSpeakerIndex({
    fullText: pippaPronounText, publishedSpeakerNames: ['Pippa', 'Lila', 'Lady Veyra'],
    sourceMessageIndex: 52, sourceMessageHash: 'sha256:pippa-pronoun-backreference',
    parserVersion: 'full-message-speaker-index.v12',
});
assert.deepEqual(pippaPronounIndex.anchors.map((anchor) => anchor.speakerText), ['Pippa', 'Pippa'],
    'a unique sentence-subject roster mention can seed a pronoun turn and the next nearby pronoun turn');
for (const anchor of pippaPronounIndex.anchors) {
    assert.equal(Array.from(pippaPronounText).slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join(''), 'Pippa',
        'backreference evidence points to the actual source name span');
}
const pippaPronounTitle = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: pippaPronounIndex, fullText: pippaPronounText, sourceMessageIndex: 52,
    sourceMessageHash: 'sha256:pippa-pronoun-backreference', parserVersion: 'full-message-speaker-index.v12',
    coreSpan: { start: 0, end: Array.from(pippaPronounText).length },
});
assert.equal(pippaPronounTitle?.kind, 'speaker');
assert.equal(pippaPronounTitle?.text, 'Pippa');
assert.equal(pippaPronounTitle?.ruleId, 'pronoun-backreference');

const closedNibuThenPippaText = 'Nibu说：“记住门口的符号。”Pippa沉默地走到Lila身边。她没有哭，只是低声说：“她死得像个战士。”';
const closedNibuThenPippaIndex = createStructuralMessageSpeakerIndex({
    fullText: closedNibuThenPippaText, publishedSpeakerNames: ['Nibu', 'Pippa', 'Lila'],
    sourceMessageIndex: 520, sourceMessageHash: 'sha256:closed-nibu-before-pippa',
    parserVersion: 'full-message-speaker-index.v12',
});
assert.deepEqual(closedNibuThenPippaIndex.anchors.map((anchor) => anchor.speakerText), ['Nibu', 'Pippa'],
    'a closed earlier Nibu quote does not override the later unique Pippa sentence subject');

const competingPronounText = 'Pippa赶到房间。Lila坐在门边。她低声说：“先别进来。”';
const competingPronounIndex = createStructuralMessageSpeakerIndex({
    fullText: competingPronounText, publishedSpeakerNames: ['Pippa', 'Lila'], sourceMessageIndex: 521,
    sourceMessageHash: 'sha256:competing-pronoun-subjects', parserVersion: 'full-message-speaker-index.v12',
});
assert.equal(competingPronounIndex.anchors.length, 0, 'two possible rostered antecedents remain unresolved');

for (const [sceneBreakText, hash] of [
    ['Pippa走到门边。# 新场景\n她低声说：“不要进来。”', 'sha256:markdown-scene-break'],
    ['Pippa走到门边。\n新场景：地牢深处\n她低声说：“不要进来。”', 'sha256:labeled-scene-break'],
    [`Pippa走到门边。# ${'新场景'.repeat(240)}\n她低声说：“不要进来。”`, 'sha256:long-markdown-scene-break'],
    [`Pippa说：“我在门口。”\n# ${'新场景'.repeat(240)}\n她低声说：“不要进来。”`, 'sha256:long-title-after-anchor'],
]) {
    const sceneBreakIndex = createStructuralMessageSpeakerIndex({
        fullText: sceneBreakText, publishedSpeakerNames: ['Pippa'], sourceMessageIndex: 522,
        sourceMessageHash: hash, parserVersion: 'full-message-speaker-index.v12',
    });
    if (hash === 'sha256:long-title-after-anchor') {
        assert.equal(sceneBreakIndex.anchors.length, 1, 'the explicit pre-title quote remains attributed');
        assert.equal(sceneBreakIndex.anchors.some((anchor) => anchor.ruleId === 'pronoun-backreference'), false,
            'a long scene title prevents the prior anchor from crossing into the next scene');
    } else {
        assert.equal(sceneBreakIndex.anchors.length, 0, `pronoun backtrace stops at a scene title marker (${hash})`);
    }
}

const unresolvedPronounIndex = createStructuralMessageSpeakerIndex({
    fullText: '她沉默地说：“我不同意。”', publishedSpeakerNames: ['Pippa'], sourceMessageIndex: 53,
    sourceMessageHash: 'sha256:unresolved-pronoun', parserVersion: 'full-message-speaker-index.v12',
});
assert.equal(unresolvedPronounIndex.anchors.length, 0, 'pronouns without a published, uniquely traceable antecedent remain unresolved');

const pronounActionQuoteText = '但那个矮胖半兽人短弓手没上当。他鼻子抽了抽，盯住你藏身的蕨叶，咧嘴一笑：“不对。这里有血味。”';
const pronounActionQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: pronounActionQuoteText, publishedSpeakerNames: [], sourceMessageIndex: 54,
    sourceMessageHash: 'sha256:typed-role-pronoun-action', parserVersion: 'full-message-speaker-index.v36',
});
assert.equal(pronounActionQuoteIndex.anchors[0]?.speakerText, '矮胖半兽人短弓手',
    'a unique explicit role subject in the preceding sentence resolves a pronoun-led action before quoted speech');
assert.equal(pronounActionQuoteIndex.anchors[0]?.ruleId, 'pronoun-backreference');
const pronounActionTitle = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: pronounActionQuoteIndex, fullText: pronounActionQuoteText, sourceMessageIndex: 54,
    sourceMessageHash: 'sha256:typed-role-pronoun-action', parserVersion: 'full-message-speaker-index.v36',
    coreSpan: { start: 0, end: Array.from(pronounActionQuoteText).length },
});
assert.equal(pronounActionTitle?.text, '矮胖半兽人短弓手',
    'the page-level narrative fallback must not override a validated full-message speaker anchor');

const competingRolePronounText = '短弓手没上当。守门打手回头。他鼻子抽了抽，盯住蕨叶，咧嘴一笑：“不对。”';
const competingRolePronounIndex = createStructuralMessageSpeakerIndex({
    fullText: competingRolePronounText, publishedSpeakerNames: [], sourceMessageIndex: 55,
    sourceMessageHash: 'sha256:competing-typed-role-pronoun', parserVersion: 'full-message-speaker-index.v36',
});
assert.equal(competingRolePronounIndex.anchors.length, 0,
    'multiple nearby typed role subjects leave the pronoun unresolved');

const insultActionQuoteText = '钩刀打手骂了一句，朝木桶方向走去：“出来，小耗子！”';
const insultActionQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: insultActionQuoteText, publishedSpeakerNames: [], sourceMessageIndex: 56,
    sourceMessageHash: 'sha256:unique-role-insult-cue', parserVersion: 'full-message-speaker-index.v36',
});
assert.equal(insultActionQuoteIndex.anchors[0]?.speakerText, '钩刀打手',
    'a unique role subject followed by a bounded insult/speech action owns the quote');

const existingActThenSceneText = '短弓手没上当。他看向树后。旧磨坊门口亮起火光。另一个人喊道：“快跑！”';
const existingActThenSceneIndex = createStructuralMessageSpeakerIndex({
    fullText: existingActThenSceneText, publishedSpeakerNames: [], sourceMessageIndex: 57,
    sourceMessageHash: 'sha256:actor-backreference-scene-break', parserVersion: 'full-message-speaker-index.v36',
});
assert.notEqual(existingActThenSceneIndex.anchors[0]?.speakerText, '短弓手',
    'a scene break and explicit anonymous speaker cannot inherit an older typed role');

for (const [text, expected] of [
    ['Nibu指着远处：“Boss，前方有营地的烟火...不止一个。”', 'Nibu'],
    ['卡尔惊叹：“真的...只有龙魂之力能打开...”', '卡尔'],
    ['卡尔喘着粗气：“该死...这只是第一层...”', '卡尔'],
    ['卡尔大喊：“准备战斗！”', '卡尔'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, publishedSpeakerNames: [], sourceMessageIndex: 58,
        sourceMessageHash: `sha256:action-prefix-${expected}`, parserVersion: 'full-message-speaker-index.v36',
    });
    assert.equal(index.anchors[0]?.speakerText, expected,
        `a named actor followed by a direct action cue and quote resolves to ${expected}: ${text}`);
}

const v37ManualGoldCases = [
    ['工会长格雷森已经在大厅等候，他看到你们到来，立刻恭敬地行礼：“龙魂守护者，龙裔冒险者公会……你们的功绩已经得到认可。”', '格雷森'],
    ['铁拳公会的会长——一个身高两米的壮汉“铁臂”卡尔——走出来：“龙裔公会？S级的新晋传奇公会，也来抢龙巢宝藏？”', '“铁臂”卡尔'],
    ['铁拳公会的卡尔惊叹：“真的……只有龙魂之力能打开……”', '卡尔'],
    ['铁拳公会的卡尔大喊：“准备战斗！”', '卡尔'],
    ['亚龙的动作停顿，竖瞳凝视着你：“龙魂……守护者？金龙长老……那位牺牲封印灰境领主的英雄……”它的语气稍微缓和：“但……其他人类……是窃贼……”它看向铁拳和暗影之刃公会：“人类……你们想要宝藏……”', '亚龙'],
    ['“远亲？”你一愣。', '你'],
];
for (const [text, expected] of v37ManualGoldCases) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, publishedSpeakerNames: [], sourceMessageIndex: 59,
        sourceMessageHash: `sha256:v37-manual-gold-${expected}`, parserVersion: 'full-message-speaker-index.v37',
    });
    assert.ok(index.anchors.length > 0, `user-confirmed speaker has a structural anchor: ${text}`);
    assert.ok(index.anchors.every((anchor) => anchor.speakerText === expected),
        `all user-confirmed utterances resolve to ${expected}: ${JSON.stringify(index.anchors.map((anchor) => anchor.speakerText))}`);
    assert.equal(index.unresolvedDialogueSpans.length, 0, `manual gold does not leave quoted spans unresolved: ${text}`);
}

const unanchoredEntityPronoun = createStructuralMessageSpeakerIndex({
    fullText: '它的语气稍微缓和：“但你们仍需通过试炼。”', publishedSpeakerNames: [], sourceMessageIndex: 60,
    sourceMessageHash: 'sha256:v37-unanchored-entity-pronoun', parserVersion: 'full-message-speaker-index.v37',
});
assert.equal(unanchoredEntityPronoun.anchors.length, 0, 'an entity pronoun without a nearby explicit creature anchor stays unknown');

const humanCannotUseEntityPronoun = createStructuralMessageSpeakerIndex({
    fullText: '卡尔说：“准备战斗。”他缓了缓：“继续前进。”', publishedSpeakerNames: [], sourceMessageIndex: 61,
    sourceMessageHash: 'sha256:v37-human-entity-pronoun', parserVersion: 'full-message-speaker-index.v37',
});
assert.equal(humanCannotUseEntityPronoun.anchors[0]?.speakerText, '卡尔');
assert.ok(humanCannotUseEntityPronoun.anchors.every((anchor) => anchor.speakerText === '卡尔'),
    'the human 他 continuation stays with its own explicit speaker and is not routed through the non-human 它 fallback');

const nonQuestionPlayerReaction = createStructuralMessageSpeakerIndex({
    fullText: '“别靠近！”你一愣。', publishedSpeakerNames: [], sourceMessageIndex: 62,
    sourceMessageHash: 'sha256:v37-non-question-player-reaction', parserVersion: 'full-message-speaker-index.v37',
});
assert.equal(nonQuestionPlayerReaction.anchors.length, 0, 'a player reaction after a non-question quote does not claim the quote');

const v38HistoricalActionCases = [
    ['Durik扛起战斧：“管他什么任务！”', 'Durik'],
    ['格雷森递过地图和卷轴：“龙裔公会，祝你们好运。”', '格雷森'],
    ['艾莉娅冷静地治疗队友：“继续前进。”', '艾莉娅'],
    ['铁拳公会的会长——一个身高两米的壮汉"铁臂"卡尔——走出来："龙裔公会？"', '"铁臂"卡尔'],
];
for (const [text, expected] of v38HistoricalActionCases) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, publishedSpeakerNames: [], sourceMessageIndex: 63,
        sourceMessageHash: `sha256:v38-action-${expected}`, parserVersion: 'full-message-speaker-index.v38',
    });
    assert.equal(index.anchors[0]?.speakerText, expected,
        `a unique named actor performing a local action before a colon quote owns that quote: ${text}`);
}

const v38EntityContinuation = createStructuralMessageSpeakerIndex({
    fullText: '冰霜亚龙发出咆哮。它咆哮：“滚出去！”\n\n亚龙说：“接受试炼。”\n\n卡尔说：“我们不是窃贼。”\n\n它转头看向众人：“再接受一次试炼。”',
    publishedSpeakerNames: [], sourceMessageIndex: 64,
    sourceMessageHash: 'sha256:v38-entity-continuation', parserVersion: 'full-message-speaker-index.v38',
});
assert.equal(v38EntityContinuation.anchors[0]?.speakerText, '亚龙',
    'an explicit creature mention seeds its first 它 turn before another quote exists');
assert.equal(v38EntityContinuation.anchors.at(-1)?.speakerText, '亚龙',
    'human dialogue does not steal a later explicit entity pronoun after prose breaks');
const nearestCreatureContinuation = createStructuralMessageSpeakerIndex({
    fullText: '冰霜亚龙出现，火龙也盘旋。它咆哮：“离开！”', publishedSpeakerNames: [], sourceMessageIndex: 65,
    sourceMessageHash: 'sha256:v38-nearest-creature-continuation', parserVersion: 'full-message-speaker-index.v38',
});
assert.equal(nearestCreatureContinuation.anchors[0]?.speakerText, '龙', 'the nearest explicit creature subject wins a local 它 turn');
const nonCreatureDragonCompound = createStructuralMessageSpeakerIndex({
    fullText: '龙裔公会的人都到了。它咆哮：“离开！”', publishedSpeakerNames: [], sourceMessageIndex: 67,
    sourceMessageHash: 'sha256:v38-non-creature-dragon-compound', parserVersion: 'full-message-speaker-index.v38',
});
assert.equal(nonCreatureDragonCompound.anchors.length, 0, '龙裔 is a people/guild descriptor, not a creature anchor for 它');
const objectLedTransferQuote = createStructuralMessageSpeakerIndex({
    fullText: '地图递给格雷森：“三天后出发。”', publishedSpeakerNames: [], sourceMessageIndex: 66,
    sourceMessageHash: 'sha256:v38-object-led-transfer-quote', parserVersion: 'full-message-speaker-index.v38',
});
assert.equal(objectLedTransferQuote.anchors.length, 0, 'an object-led source transfer does not fabricate a person speaker');

const v39ManualHistoryCases = [
    {
        text: '艾萨克斯说："吾会守护入口。"\n\n一个身高十米、全身冰晶化的巨人从中站起——永冻守护者，冰霜巨人族的传奇英雄，被冰封千年，现在苏醒了！它的眼窝燃烧蓝色冰焰，低吼："窃取...冰霜之书...者...死..."',
        target: '它的眼窝燃烧蓝色冰焰，低吼："窃取...冰霜之书...者...死..."',
        expected: '永冻守护者',
    },
    {
        text: '永冻守护者的动作停顿，冰焰眼窝凝视着你："龙魂...守护者？"',
        target: '永冻守护者的动作停顿，冰焰眼窝凝视着你："龙魂...守护者？"',
        expected: '永冻守护者',
    },
    {
        text: 'Kael和Mira向你汇报："至高领袖，影蛇网络已经整合完毕。"',
        target: 'Kael和Mira向你汇报："至高领袖，影蛇网络已经整合完毕。"',
        expected: '多人对话',
        speakers: ['Kael', 'Mira'],
    },
    {
        text: '突然——一个虚空法师转头，施放Detect Magic！\n\n"有入侵者！"',
        target: '"有入侵者！"',
        expected: '？？？',
        ruleId: 'anonymous-first-appearance',
    },
    {
        text: '泽诺斯慌乱地施放Teleport（七环传送术）试图逃跑——\n\n但Celestia立刻撕开反魔法领域卷轴："Antimagic Field！"\n\n方圆十米内所有魔法失效——泽诺斯的传送术"啪"的崩溃！\n\n"什么？！"',
        target: '"什么？！"',
        expected: '泽诺斯',
    },
    {
        text: '龙霜之剑"唰唰唰唰"劈在泽诺斯身上——他的虚空护盾"咔咔"碎裂！\n\n"啊——！"',
        target: '"啊——！"',
        expected: '旁白',
        ruleId: 'narrative-sound-effect',
    },
    {
        text: '龙霜之剑"唰"的攻击落下。\n\n两条传奇巨龙的双重龙息"轰"的同时击中泽诺斯——\n\n"不...不可能...两条龙...封印守护者...你..."',
        target: '"不...不可能...两条龙...封印守护者...你..."',
        expected: '泽诺斯',
    },
    {
        text: '双重龙息击中泽诺斯。\n\n# 新场景\n\n"什么？！"',
        target: '"什么？！"',
        expected: '旁白',
        ruleId: 'narrative-framed-quote',
    },
];
for (const [caseIndex, sample] of v39ManualHistoryCases.entries()) {
    const sourceMessageIndex = 700 + caseIndex;
    const sourceMessageHash = `sha256:v39-manual-history-${caseIndex}`;
    const fullChars = Array.from(sample.text);
    const targetChars = Array.from(sample.target);
    const targetStart = fullChars.join('').indexOf(sample.target);
    assert.notEqual(targetStart, -1, `v39 manual target ${caseIndex + 1} exists in source`);
    const coreSpan = { start: Array.from(fullChars.join('').slice(0, targetStart)).length,
        end: Array.from(fullChars.join('').slice(0, targetStart)).length + targetChars.length };
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText: sample.text, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v39',
    });
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex, fullText: sample.text, sourceMessageIndex, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v39', coreSpan,
        pageType: createVisualNovelDisplaySegments(sample.target, { role: 'character' })[0]?.type || 'narration',
    });
    assert.equal(evidence?.text, sample.expected,
        `manual history sample ${caseIndex + 1} should display ${sample.expected}: ${JSON.stringify(messageIndex.anchors.map(({ speakerText, ruleId }) => ({ speakerText, ruleId })))}`);
    if (sample.ruleId) assert.equal(evidence?.ruleId, sample.ruleId);
    if (sample.speakers) assert.deepEqual(evidence?.speakers.map(({ text }) => text), sample.speakers);
    assert.equal(fullChars.join(''), sample.text, 'projection never mutates original message text');
}

let calibrationIndex = 600;
for (const [text, expected, ruleId] of [
    ['你冷笑：“告诉他们我们有证据。”', '你', 'player-direct-speech'],
    ['你点头：“慢慢来，剩下的只是残党。”', '你', 'player-direct-speech'],
    ['你看向Kael：“用来清剿虚空教派分支。”', '你', 'player-direct-speech'],
    ['两个穿制服的守卫拔剑：“站住！这里禁止闯入！”', '守卫（群体）', 'group-role-prefix'],
    ['全员齐声：“为了光明会！”', '全员', 'group-role-prefix'],
    ['授勋仪式结束后，艾瑞克大法师私下找到你：“龙魂守护者，虚空之书……”', '艾瑞克大法师', 'unrostered-action-attribution'],
    ['首相继续：“帝国会继续追查虚空行者。”', '首相', 'unrostered-action-attribution'],
    ['艾萨克斯说：“龙魂守护者，我们的任务完成了。”', '艾萨克斯', 'quoted-attribution'],
    ['艾萨克斯和霜咬降落在你身旁，艾萨克斯说：“任务完成了。”', '艾萨克斯', 'quoted-attribution'],
    ['Nibu通过通讯水晶喊：“Boss！神殿要塌了！”', 'Nibu', 'unrostered-action-attribution'],
    ['霜咬展翅：“我们帮你清理残余法师！”', '霜咬', 'unrostered-action-attribution'],
    ['铜制徽记背面刻着：“黑喙收账，欠债还肉。”', '旁白', 'narrative-framed-quote'],
    ['检定：调查 d20 + 0 = 14。不成功也没关系。', '旁白', 'structural-record-shape'],
    ['HP: 12\nAC: 16', '旁白', 'structural-record-shape'],
    ['选择一：继续守护永冻神殿。', '选项', 'structural-record-shape'],
]) {
    const sourceMessageIndex = calibrationIndex++;
    const sourceMessageHash = `sha256:rule-calibration-${ruleId}-${expected}`;
    const sourceSpan = { start: 0, end: Array.from(text).length };
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex, sourceMessageHash, parserVersion: 'full-message-speaker-index.v29',
    });
    const page = createVisualNovelDisplaySegments(text, { role: 'character' })[0];
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: index, fullText: text, sourceMessageIndex, sourceMessageHash,
        parserVersion: 'full-message-speaker-index.v29', coreSpan: sourceSpan, pageType: page.type,
    });
    assert.equal(evidence?.text, expected, `rule calibration title for ${text}`);
    assert.equal(evidence?.ruleId, ruleId, `rule calibration source for ${text}`);
}

const v50AllPartyText = '全员单膝跪地：“遵命，至高领袖！”';
const v50AllPartyIndex = createStructuralMessageSpeakerIndex({
    fullText: v50AllPartyText, sourceMessageIndex: 5050,
    sourceMessageHash: 'sha256:v50-all-party-kneel',
    parserVersion: 'full-message-speaker-index.v50',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v50AllPartyIndex, fullText: v50AllPartyText, sourceMessageIndex: 5050,
    sourceMessageHash: 'sha256:v50-all-party-kneel', parserVersion: 'full-message-speaker-index.v50',
    coreSpan: { start: 0, end: Array.from(v50AllPartyText).length },
})?.text, '全员', 'the user gold label is preserved as the exact visible group title');

const v40MixedNarrationQuoteText = '一段旁白。Pippa说：“我看到了。” “另一段未署名的引语。”';
const v40MixedNarrationQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: v40MixedNarrationQuoteText, publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 4701, sourceMessageHash: 'sha256:v40-mixed-narration-quote',
});
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v40MixedNarrationQuoteIndex, fullText: v40MixedNarrationQuoteText,
    sourceMessageIndex: 4701, sourceMessageHash: 'sha256:v40-mixed-narration-quote',
    coreSpan: { start: 0, end: Array.from(v40MixedNarrationQuoteText).length },
})?.text, 'Pippa', 'a clear speaker remains the page title when narration and another unattributed quote share the page');

const v41NibuUtteranceText = '你还站着，但站得很难看。尼布在侧翼探出头，骂了一声：“他快倒了，你们两个蠢货还砍不准？不对，我为什么在教他们杀你？”';
const v41NibuUtteranceIndex = createStructuralMessageSpeakerIndex({
    fullText: v41NibuUtteranceText,
    sourceMessageIndex: 4712,
    sourceMessageHash: 'sha256:v41-nibu-curses',
});
const v41NibuUtteranceEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v41NibuUtteranceIndex,
    fullText: v41NibuUtteranceText,
    sourceMessageIndex: 4712,
    sourceMessageHash: 'sha256:v41-nibu-curses',
    coreSpan: { start: 0, end: Array.from(v41NibuUtteranceText).length },
});
assert.equal(v41NibuUtteranceEvidence?.text, '尼布', 'a locally named speaker remains attributable after same-subject action and the verbal predicate 骂了一声');

const v42SplitNibuQuoteText = '尼布听完你的计划，露出一种“我讨厌英勇，但我更讨厌被卖去旧磨坊”\n\n的表情。他从地上捡起一块碎瓦，又从怀里摸出半截黑喙铜牌，往远处二楼窗下的破木桶一砸。声响清脆得像税吏敲门，紧接着他捏着嗓子喊：“喂！楼上的瞎眼鸟嘴！\n\n你娘喊你回窝下蛋！”';
const v42SplitNibuIndex = createStructuralMessageSpeakerIndex({
    fullText: v42SplitNibuQuoteText,
    publishedSpeakerNames: ['尼布', 'Pippa'],
    sourceMessageIndex: 420,
    sourceMessageHash: 'sha256:v42-nibu-cross-page-quote',
    parserVersion: 'full-message-speaker-index.v42',
});
const v42SplitNibuPageTitles = createVisualNovelDisplaySegments(v42SplitNibuQuoteText).map((page) => ({
    text: page.text,
    evidence: createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: v42SplitNibuIndex,
        fullText: v42SplitNibuQuoteText,
        sourceMessageIndex: 420,
        sourceMessageHash: 'sha256:v42-nibu-cross-page-quote',
        parserVersion: 'full-message-speaker-index.v42',
        coreSpan: page.sourceSpan,
        pageType: page.type,
    }),
}));
assert.equal(v42SplitNibuPageTitles.find(({ text }) => text.includes('紧接着他捏着嗓子喊'))?.evidence?.text, '尼布',
    'one short narration clause plus an explicit connective may carry a unique prior speaker anchor to the pronoun-led speech');
assert.equal(v42SplitNibuPageTitles.find(({ text }) => text.includes('你娘喊你回窝下蛋'))?.evidence?.text, '尼布',
    'a matching closing quote keeps the entire utterance with the same speaker beyond two sentences');

const v42CompetingPronounSpeakersText = 'Pippa说：“快走。”尼布说：“别动。”声响清脆得像税吏敲门，紧接着他喊：“谁？”';
const v42CompetingPronounSpeakersIndex = createStructuralMessageSpeakerIndex({
    fullText: v42CompetingPronounSpeakersText,
    publishedSpeakerNames: ['尼布', 'Pippa'],
    sourceMessageIndex: 421,
    sourceMessageHash: 'sha256:v42-competing-pronoun-speakers',
    parserVersion: 'full-message-speaker-index.v42',
});
const v42CompetingPronounQuote = v42CompetingPronounSpeakersIndex.anchors.find((anchor) => (
    anchor.utteranceSpans?.some((span) => v42CompetingPronounSpeakersText.slice(span.start, span.end).includes('谁？'))
));
assert.equal(v42CompetingPronounQuote?.speakerText, '尼布',
    'the nearest explicit speaker owns a directly attached pronoun-led continuation after the competing earlier turn');

const v40PageSamples = [
    ['short archer', '短弓手惊叫着丢开弓，拔出短斧贴身反击：“我讨厌会移动的午餐！”', '短弓手'],
    ['Nibu framed reaction across a page break', '尼布听完你的计划，露出一种“我讨厌英勇，但我更讨厌被卖去旧磨坊”\n\n的表情。他从地上捡起碎瓦。', '尼布'],
    ['Nibu direct shout after narration', '莫里克尖叫着爬起。旧磨坊里火星乱飞，尼布在门外探头大喊：“我就说她是自然灾害！\n\n但现在是我们这边的自然灾害！”', '尼布'],
    ['turn header does not steal an explicit action quote', '克罗恩的回合：瘦竹竿男看见你倒地濒死，发出一阵愉悦笑声：“这么快就倒下了？”', '瘦竹竿男'],
    ['Pippa quote wins over a broad player-list prefix', '你、Pippa和尼布坐在Lila的新坟边上。Pippa把最后一瓶药塞进你手里：“喝了。', 'Pippa'],
    ['explicit local cue survives an incomplete quote', 'Celestia严肃地说：“方案C风险最高，但最快。我会准备治疗术随时待命。', 'Celestia'],
];
for (const [label, text, expected] of v40PageSamples) {
    const sourceMessageIndex = 4702 + v40PageSamples.findIndex((item) => item[0] === label);
    const sourceMessageHash = `sha256:v40-${sourceMessageIndex}`;
    const pageSpan = { start: 0, end: Array.from(text).length };
    const index = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: ['你', '尼布', 'Pippa', 'Celestia', '短弓手', '瘦竹竿男'],
        sourceMessageIndex,
        sourceMessageHash,
    });
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex: index, fullText: text, sourceMessageIndex, sourceMessageHash, coreSpan: pageSpan,
    });
assert.equal(evidence?.text, expected, `v40 manual page label: ${label}`);
    assert.equal(evidence?.speakers?.length, 1, `v40 assigns one speaker: ${label}`);
}

const v40TurnHeaderOnlyText = 'Durik的回合：“轮到我了。”';
const v40TurnHeaderOnly = createStructuralMessageSpeakerIndex({
    fullText: v40TurnHeaderOnlyText, sourceMessageIndex: 4710, sourceMessageHash: 'sha256:v40-turn-header-only',
});
assert.equal(v40TurnHeaderOnly.anchors[0]?.speakerText, 'Durik', 'a bare turn header still attributes its own immediately attached quote');

const dashedExplicitSpeechCueSamples = [
    ['Andrei', 'Andrei站在阵眼边缘。—Andrei低声说。 “它要开门进你。”'],
    ['Andrei', '火开始叫他的名字。Andrei站在阵眼边缘。—Andrei低声说。 “它要刻名。”'],
    ['Andrei', '黑水铺开，只抵住一息。—Andrei低声说。 “再一跳，旁观也会被记账。”'],
    ['Andrei', 'Andrei看着阵眼。硫磺味沉成冷线。—Andrei低声说。 “下一口会咬进存在本身。”'],
    ['God', 'God的声音仍温和。—God缓声说。 “砍断绳子时，桶不会变轻。”'],
    ['Anna', '—Anna哑声说。 “Timmy，别过来。”'],
    ['Timmy', '—Timmy站在 Bubbles 身后，清楚地说。 “你还在。”'],
    ['Black', '—Black 平稳地说。 “无行动继续确认主债。”'],
    ['Bubbles', '—Bubbles 闷声说。 “别碰小孩。”'],
    ['Anna', '—Anna 哑声说。\n\n“Timmy，别过来。”'],
    ['Michael', '—Michael 站在裂光中。 “审判进入执行。” God 的声音从没有世界的边缘传来。'],
    ['Timmy', '—Timmy 伸手抓住 Bubbles 的外套，声音清楚。 “我抓住了。”'],
    ['Timmy', '—Timmy 抓着 Bubbles 的外套，声音清楚。 “我没有松手。”'],
    ['Timmy', '—Timmy 被挡在他臂弯里，声音仍清楚。 “我抓紧了。Anna 还在吗？”'],
    ['Pippa', '—Pippa翻开账本。 “这里有线索。”'],
];
for (const [speaker, fullText] of dashedExplicitSpeechCueSamples) {
    const sourceMessageIndex = 4800 + dashedExplicitSpeechCueSamples.findIndex((sample) => sample[1] === fullText);
    const index = createStructuralMessageSpeakerIndex({
        fullText,
        sourceMessageIndex,
        sourceMessageHash: `sha256:dashed-speech-${sourceMessageIndex}`,
    });
    assert.equal(index.anchors.length, 1, `one explicit signed speech cue: ${fullText}`);
    assert.equal(index.anchors[0]?.speakerText, speaker, `speaker from signed speech cue: ${fullText}`);
    assert.equal(index.anchors[0]?.ruleId, 'dashed-explicit-speech-cue');
    assert.equal(Array.from(fullText).slice(index.anchors[0].speakerSpan.start, index.anchors[0].speakerSpan.end).join(''), speaker,
        'speaker span points to the exact source name');
}
const priorSentenceAndrei = createStructuralMessageSpeakerIndex({
    fullText: '前情。Andrei低声说。 “它要开门进你。”', sourceMessageIndex: 4810,
    sourceMessageHash: 'sha256:prior-sentence-andrei',
});
assert.equal(priorSentenceAndrei.anchors[0]?.speakerText, 'Andrei',
    'a single named speech/action subject in the immediately preceding sentence anchors the quote');
for (const fullText of [
    '前情。—Anna翻开账本。中间旁白。 “这里有线索。”',
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText, sourceMessageIndex: 4810, sourceMessageHash: 'sha256:dashed-speech-negative',
    });
    assert.equal(index.anchors.length, 0, `no attribution without dashed explicit cue: ${fullText}`);
}
for (const [fullText, speaker] of [
    ['前情。—Anna看向Black，Black低声说。 “等等。”', 'Anna'],
    ['前情。—Anna看向张三，张三低声说。 “等等。”', 'Anna'],
    ['前情。—Anna看向王小明，王小明平稳地说。 “等等。”', 'Anna'],
]) {
    const index = createStructuralMessageSpeakerIndex({
        fullText, sourceMessageIndex: 4811, sourceMessageHash: 'sha256:dashed-speech-subject-switch',
    });
    assert.equal(index.anchors.length, 1, `resolve the dash-led name as the following quote speaker: ${fullText}`);
    assert.equal(index.anchors[0]?.speakerText, speaker, `dash-led name owns the following quote: ${fullText}`);
    assert.equal(Array.from(fullText).slice(index.anchors[0].speakerSpan.start, index.anchors[0].speakerSpan.end).join(''), speaker,
        'speaker span points to the exact dash-led name');
}

const v51OpenQuoteAcrossPagesText = 'Pippa说：“第一句。\n\n第二句。\n\n第三句收束。”';
const v51OpenQuoteAcrossPages = createVisualNovelDisplaySegments(v51OpenQuoteAcrossPagesText, {
    role: 'character', knownSpeakers: ['Pippa'],
});
assert.deepEqual(v51OpenQuoteAcrossPages.map(({ sourceSpan }) => sourceSpan), [
    { start: 0, end: 12 }, { start: 14, end: 18 }, { start: 20, end: 27 },
], 'v51 projects attribution onto the exact existing page spans');
const v51OpenQuoteAcrossPagesIndex = createStructuralMessageSpeakerIndex({
    fullText: v51OpenQuoteAcrossPagesText,
    publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 5101,
    sourceMessageHash: 'sha256:v51-open-quote-across-pages',
    parserVersion: 'full-message-speaker-index.v51',
});
assert.deepEqual(v51OpenQuoteAcrossPages.map((page) => createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v51OpenQuoteAcrossPagesIndex,
    fullText: v51OpenQuoteAcrossPagesText,
    sourceMessageIndex: 5101,
    sourceMessageHash: 'sha256:v51-open-quote-across-pages',
    parserVersion: 'full-message-speaker-index.v51',
    coreSpan: page.sourceSpan,
    pageType: page.type,
})?.text), ['Pippa', 'Pippa', 'Pippa'], 'a single source-closed quote carries the same explicit speaker across existing pages');

const v51ClosedTurnDoesNotCarryText = 'Pippa说：“第一句。”\n\n“第二句。”';
const v51ClosedTurnDoesNotCarryIndex = createStructuralMessageSpeakerIndex({
    fullText: v51ClosedTurnDoesNotCarryText,
    publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 5102,
    sourceMessageHash: 'sha256:v51-closed-turn-no-carry',
    parserVersion: 'full-message-speaker-index.v51',
});
const v51SecondClosedQuoteStart = Array.from(v51ClosedTurnDoesNotCarryText).lastIndexOf('“');
const v51SecondClosedQuoteEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v51ClosedTurnDoesNotCarryIndex,
    fullText: v51ClosedTurnDoesNotCarryText,
    sourceMessageIndex: 5102,
    sourceMessageHash: 'sha256:v51-closed-turn-no-carry',
    parserVersion: 'full-message-speaker-index.v51',
    coreSpan: { start: v51SecondClosedQuoteStart, end: Array.from(v51ClosedTurnDoesNotCarryText).length },
});
assert.equal(v51SecondClosedQuoteEvidence?.text, '旁白', 'a completed prior turn is not inherited by a later standalone quote');
assert.equal(v51SecondClosedQuoteEvidence?.diagnosticReasonId, 'no-unique-speaker-evidence');
assert.deepEqual(v51SecondClosedQuoteEvidence?.speakers, []);

const v51PostQuoteText = '“先别动。”格雷森停顿片刻，随后提醒道。';
const v51PostQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: v51PostQuoteText,
    publishedSpeakerNames: ['格雷森'],
    sourceMessageIndex: 5103,
    sourceMessageHash: 'sha256:v51-postquote-action-cue',
    parserVersion: 'full-message-speaker-index.v51',
});
assert.equal(v51PostQuoteIndex.anchors[0]?.speakerText, '格雷森', 'a unique rostered actor before a direct post-quote speech cue is resolved');
assert.equal(v51PostQuoteIndex.anchors[0]?.ruleId, 'post-quote-attribution');

const v51AmbiguousPostQuoteText = '“先别动。”Pippa与Durik交换眼神，随后提醒道。';
const v51AmbiguousPostQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: v51AmbiguousPostQuoteText,
    publishedSpeakerNames: ['Pippa', 'Durik'],
    sourceMessageIndex: 5104,
    sourceMessageHash: 'sha256:v51-postquote-ambiguous',
    parserVersion: 'full-message-speaker-index.v51',
});
const v51AmbiguousPostQuoteSpan = createVisualNovelDisplaySegments(v51AmbiguousPostQuoteText, {
    role: 'character', knownSpeakers: ['Pippa', 'Durik'],
})[0].sourceSpan;
const v51AmbiguousPostQuoteEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v51AmbiguousPostQuoteIndex,
    fullText: v51AmbiguousPostQuoteText,
    sourceMessageIndex: 5104,
    sourceMessageHash: 'sha256:v51-postquote-ambiguous',
    parserVersion: 'full-message-speaker-index.v51',
    coreSpan: v51AmbiguousPostQuoteSpan,
});
assert.equal(v51AmbiguousPostQuoteIndex.anchors.length, 0, 'a multi-actor post-quote cue does not choose the first mentioned person');
assert.equal(v51AmbiguousPostQuoteEvidence?.text, '旁白');
assert.equal(v51AmbiguousPostQuoteEvidence?.diagnosticReasonId, 'no-unique-speaker-evidence');
assert.deepEqual(v51AmbiguousPostQuoteEvidence?.speakers, []);

const v51UniquePronounReferenceText = '尼布看着窗外。随后他低声说：“门后有人。”';
const v51UniquePronounReferenceIndex = createStructuralMessageSpeakerIndex({
    fullText: v51UniquePronounReferenceText,
    publishedSpeakerNames: ['尼布', 'Pippa'],
    sourceMessageIndex: 5105,
    sourceMessageHash: 'sha256:v51-unique-pronoun-reference',
    parserVersion: 'full-message-speaker-index.v51',
});
assert.equal(v51UniquePronounReferenceIndex.anchors[0]?.speakerText, '尼布', 'one same-message actor anchor resolves a pronoun-led quote');

const v51AmbiguousPronounReferenceText = 'Pippa与尼布交换眼神。随后她低声说：“来不及了。”';
const v51AmbiguousPronounReferenceIndex = createStructuralMessageSpeakerIndex({
    fullText: v51AmbiguousPronounReferenceText,
    publishedSpeakerNames: ['尼布', 'Pippa'],
    sourceMessageIndex: 5106,
    sourceMessageHash: 'sha256:v51-ambiguous-pronoun-reference',
    parserVersion: 'full-message-speaker-index.v51',
});
const v51AmbiguousPronounReferenceEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v51AmbiguousPronounReferenceIndex,
    fullText: v51AmbiguousPronounReferenceText,
    sourceMessageIndex: 5106,
    sourceMessageHash: 'sha256:v51-ambiguous-pronoun-reference',
    parserVersion: 'full-message-speaker-index.v51',
    coreSpan: { start: 0, end: Array.from(v51AmbiguousPronounReferenceText).length },
});
assert.equal(v51AmbiguousPronounReferenceIndex.anchors.length, 0, 'an ambiguous same-message pronoun has no speaker anchor');
assert.equal(v51AmbiguousPronounReferenceEvidence?.text, '旁白');
assert.deepEqual(v51AmbiguousPronounReferenceEvidence?.speakers, []);

const v53Focused = [
    ['格雷戈喘着气，眼中露出挣扎："我...我不能说...瑟蕾娜会杀了我..."', '格雷戈', '格雷戈', 'unrostered-action-attribution'],
    ['暗影祭司愣住:"什么?!"', '暗影祭司', '暗影祭司', 'unrostered-action-attribution'],
    ['我压低声音：“好消息，我们赶上了。”', '我', '你', 'player-first-person-action'],
    ['马库斯伯爵摊开一份报告："Boss，Lady Veyra的情报网被城主府摧毁了！', '马库斯伯爵', '马库斯', 'honorific-display-title'],
];
for (const [text, sourceSpeaker, displaySpeaker, ruleId] of v53Focused) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text, sourceMessageIndex: 5300, sourceMessageHash: `sha256:v53:${text}`,
        parserVersion: 'full-message-speaker-index.v54',
    });
    assert.equal(index.anchors[0]?.speakerText, sourceSpeaker, `v53 keeps the source speaker surface for ${text}`);
    assert.equal(index.anchors[0]?.displaySpeakerText, displaySpeaker, `v53 projects the requested visible title for ${text}`);
    assert.equal(index.anchors[0]?.ruleId, ruleId, `v53 uses a narrow, auditable rule id for ${text}`);
    assert.equal(index.unresolvedDialogueSpans.length, 0, `v53 resolves the explicitly anchored line: ${text}`);
}
const v53NpcFirstPerson = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa说：“我压低声音，继续解释。”', publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 5301, sourceMessageHash: 'sha256:v53-npc-first-person', parserVersion: 'full-message-speaker-index.v54',
});
assert.equal(v53NpcFirstPerson.anchors[0]?.speakerText, 'Pippa');
assert.notEqual(v53NpcFirstPerson.anchors[0]?.ruleId, 'player-first-person-action',
    'an NPC first-person phrase inside its quotation never produces player evidence');
const v53WrittenCarrier = createStructuralMessageSpeakerIndex({
    fullText: '马库斯伯爵摊开一份报告，报告上写着：“Boss，城门已经关闭。”',
    sourceMessageIndex: 5302, sourceMessageHash: 'sha256:v53-written-carrier', parserVersion: 'full-message-speaker-index.v54',
});
assert.equal(v53WrittenCarrier.anchors.length, 0, 'a written report frame cannot use the honorific display alias');

const v60RankedSubjectText = '尼布推开莫里克，尼布厉声道：“撤退！”他转身离开。';
const v60RankedSubjectIndex = createStructuralMessageSpeakerIndex({
    fullText: v60RankedSubjectText,
    publishedSpeakerNames: ['尼布', '莫里克'],
    sourceMessageIndex: 6000,
    sourceMessageHash: 'sha256:v60-ranked-subject',
});
assert.equal(v60RankedSubjectIndex.parserVersion, 'full-message-speaker-index.v84');
assert.equal(v60RankedSubjectIndex.anchors[0]?.speakerText, '尼布',
    'an explicitly attributed actor wins even when another person appears in the preceding sentence');
const v60QuoteStart = Array.from(v60RankedSubjectText).indexOf('“');
const v60QuoteEnd = Array.from(v60RankedSubjectText).indexOf('”') + 1;
assert.equal(v60RankedSubjectIndex.anchors[0]?.quoteId, `quote:${v60QuoteStart}`);
assert.deepEqual(v60RankedSubjectIndex.anchors[0]?.quoteSpan, { start: v60QuoteStart, end: v60QuoteEnd });
assert.equal(v60RankedSubjectIndex.quoteEvidence.length, 1);
assert.deepEqual(v60RankedSubjectIndex.quoteEvidence[0]?.prefixContextSpan, { start: 0, end: v60QuoteStart });
assert.ok(v60RankedSubjectIndex.quoteEvidence[0]?.suffixContextSpan.end > v60RankedSubjectIndex.quoteEvidence[0]?.quoteSpan.end,
    'each quote retains its immediately following sentence context');
assert.deepEqual(v60RankedSubjectIndex.quoteEvidence[0]?.decision, {
    status: 'attributed',
    speakerText: '尼布',
    displaySpeakerText: '尼布',
    speakerSpan: { start: 0, end: 2 },
    evidenceSpan: { start: 0, end: v60QuoteStart },
    sourceRegion: 'before-quote',
    syntaxRole: 'named-action-subject',
    evidenceRank: 1,
    ruleId: 'rostered-subject-quoted-clause',
}, 'the selected source proof is auditable by quote ID without rewriting the source');

const crossScenarioSpeakerFixtures = [
    { scenario: 'fantasy', name: 'Aurelia', text: 'Aurelia说：“我们走。”' },
    { scenario: 'science-fiction', name: 'Captain Nova', text: 'Captain Nova replied: “Proceed to the airlock.”' },
    { scenario: 'contemporary', name: '林澈', text: '林澈问道：“现在开始吗？”' },
];
for (const fixture of crossScenarioSpeakerFixtures) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: fixture.text,
        publishedSpeakerNames: [fixture.name],
        sourceMessageIndex: 8300,
        sourceMessageHash: `sha256:v83-cross-script:${fixture.scenario}`,
        parserVersion: 'full-message-speaker-index.v83',
    });
    assert.equal(index.anchors[0]?.speakerText, fixture.name,
        `the same shared structural parser handles a new ${fixture.scenario} cast without project-specific names`);
    assert.equal(index.parserVersion, 'full-message-speaker-index.v83');
}

const v83CumulativeActionChainText = 'Nadia看向出口，随后她握紧门把手。\n\n“走吧。”';
const v83CumulativeActionChainIndex = createStructuralMessageSpeakerIndex({
    fullText: v83CumulativeActionChainText,
    publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 8301,
    sourceMessageHash: 'sha256:v83-cumulative-action-chain',
    parserVersion: 'full-message-speaker-index.v83',
});
assert.equal(v83CumulativeActionChainIndex.anchors[0]?.speakerText, 'Nadia');
assert.equal(v83CumulativeActionChainIndex.anchors[0]?.ruleId, 'bounded-action-chain-backreference',
    'current runtime versions inherit cumulative V78+ structural rules');
const v83SummaryReporterIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Aurelia看过地图后总结：“出口在北边。”',
    publishedSpeakerNames: ['Aurelia'],
    sourceMessageIndex: 8302,
    sourceMessageHash: 'sha256:v83-summary-reporter',
    parserVersion: 'full-message-speaker-index.v83',
});
assert.equal(v83SummaryReporterIndex.anchors[0]?.speakerText, 'Aurelia');
assert.equal(v83SummaryReporterIndex.anchors[0]?.ruleId, 'summary-reporting-attribution');
const v83ReadoutCarrierIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Aurelia翻开地图，阅读上面的内容：“出口在北边。”',
    publishedSpeakerNames: ['Aurelia'],
    sourceMessageIndex: 8303,
    sourceMessageHash: 'sha256:v83-readout-carrier',
    parserVersion: 'full-message-speaker-index.v83',
});
assert.equal(v83ReadoutCarrierIndex.anchors.length, 0,
    'the current global rules also inherit the latest written-carrier exclusion');

const v60NestedQuoteText = '维克多说：“他只留下‘快走。’三个字。”';
const v60NestedQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: v60NestedQuoteText,
    sourceMessageIndex: 6001,
    sourceMessageHash: 'sha256:v60-nested-quote',
});
assert.equal(v60NestedQuoteIndex.anchors[0]?.speakerText, '维克多');
assert.equal(v60NestedQuoteIndex.quoteEvidence.length, 2, 'nested quote spans remain individually traceable');
const v60NestedQuote = v60NestedQuoteIndex.quoteEvidence.find((item) => item.parentQuoteId);
assert.ok(v60NestedQuote, 'nested quote records its parent span instead of disappearing');
assert.ok(v60NestedQuoteIndex.quoteEvidence.find((item) => item.quoteId === v60NestedQuote?.parentQuoteId)?.childQuoteIds
    .includes(v60NestedQuote.quoteId));

const v60PriorSentenceText = 'Nadia没有回头。\n\n“Sam，你来得正好。”';
const v60PriorSentenceIndex = createStructuralMessageSpeakerIndex({
    fullText: v60PriorSentenceText,
    publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6004,
    sourceMessageHash: 'sha256:v60-prior-sentence',
    parserVersion: 'full-message-speaker-index.v77',
});
assert.equal(v60PriorSentenceIndex.anchors[0]?.speakerText, 'Nadia',
    'a unique action subject in the immediately preceding complete sentence can anchor a standalone quote');
assert.equal(v60PriorSentenceIndex.anchors[0]?.ruleId, 'prior-sentence-unique-action-subject');
const v60UnrosteredPriorSentenceIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Nadia没有回头。\n\n“你来了啊。”',
    sourceMessageIndex: 6006,
    sourceMessageHash: 'sha256:v60-unrostered-prior-sentence',
});
assert.equal(v60UnrosteredPriorSentenceIndex.anchors[0]?.speakerText, 'Nadia',
    'a unique named actor with a local action predicate remains usable without a published roster');
for (const [index, description] of [
    ['Nadia很漂亮。\n\n“你来了啊。”', 'static description'],
    ['Nadia是队长。\n\n“你来了啊。”', 'role statement'],
    ['Nadia穿着红裙子。\n\n“你来了啊。”', 'appearance description'],
]) {
    const nonActionIndex = createStructuralMessageSpeakerIndex({
        fullText: index,
        publishedSpeakerNames: ['Nadia'],
        sourceMessageIndex: 6010,
        sourceMessageHash: `sha256:v60-non-action-${description}`,
    });
    assert.equal(nonActionIndex.anchors.length, 0,
        `a sole prior name in a ${description} does not prove the following quote speaker`);
}

const v60PriorQuoteBarrier = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa说：“第一句。”\n\n“第二句。”',
    publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 6005,
    sourceMessageHash: 'sha256:v60-prior-quote-barrier',
});
assert.equal(v60PriorQuoteBarrier.anchors.length, 1,
    'a completed earlier quote is not reused as a speaker anchor for an independent unmarked quote');
assert.equal(v60PriorQuoteBarrier.unresolvedDialogueSpans.length, 1);

for (const staticDescription of ['Nadia很漂亮。', 'Nadia是队长。', 'Nadia穿着红裙子。']) {
    const staticDescriptionIndex = createStructuralMessageSpeakerIndex({
        fullText: `${staticDescription}\n\n“你来了啊。”`,
        publishedSpeakerNames: ['Nadia'],
        sourceMessageIndex: 6011,
        sourceMessageHash: `sha256:v60-static-description-${staticDescription}`,
    });
    assert.equal(staticDescriptionIndex.anchors.length, 0,
        'a name in a static preceding sentence is only a candidate, not speaker evidence');
}

const v60StandalonePageText = '尼布在门边守着。\n\n“你必须回去。”';
const v60SecondPageStart = Array.from(v60StandalonePageText).lastIndexOf('“');
const v60PriorTextEnd = Array.from(v60StandalonePageText).indexOf('\n');
const v60StandalonePageIndex = {
    sourceMessageIndex: 6003,
    sourceMessageHash: 'sha256:v60-standalone-page',
    sourceLength: Array.from(v60StandalonePageText).length,
    publishedSpeakerFingerprint: '',
    parserVersion: 'full-message-speaker-index.v60',
    dialogueCandidateSpans: [{ start: v60SecondPageStart + 1, end: Array.from(v60StandalonePageText).length - 1 }],
    anchors: [{
        speakerText: '尼布',
        displaySpeakerText: '尼布',
        speakerSpan: { start: 0, end: 2 },
        utteranceSpans: [{ start: 0, end: v60PriorTextEnd }],
        ruleId: 'line-speaker',
        certainty: 'explicit',
    }],
    unresolvedDialogueSpans: [],
    scanStatus: 'complete',
};
const v60SecondPageEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v60StandalonePageIndex,
    fullText: v60StandalonePageText,
    sourceMessageIndex: 6003,
    sourceMessageHash: 'sha256:v60-standalone-page',
    parserVersion: 'full-message-speaker-index.v60',
    pageType: 'dialogue',
    coreSpan: { start: v60SecondPageStart, end: Array.from(v60StandalonePageText).length },
    previousPageSpans: [{
        sourceSpan: { start: 0, end: v60SecondPageStart },
        pageType: 'dialogue',
    }],
});
assert.equal(v60SecondPageEvidence?.text, '尼布',
    'a standalone quote page can trace one unique raw-source speaker anchor from the prior existing page');
assert.equal(v60SecondPageEvidence?.ruleId, 'recent-page-quote-speaker-continuation');

const v60ActionOnlyPriorPageText = 'Mika站在半开的窗边，肩膀微微一颤。她没有立刻回头。\n\n“你来了。”';
const v60ActionOnlyQuoteStart = Array.from(v60ActionOnlyPriorPageText).lastIndexOf('“');
const v60ActionOnlyPriorPageIndex = {
    sourceMessageIndex: 6012,
    sourceMessageHash: 'sha256:v60-action-only-prior-page',
    sourceLength: Array.from(v60ActionOnlyPriorPageText).length,
    publishedSpeakerFingerprint: '',
    parserVersion: 'full-message-speaker-index.v60',
    dialogueCandidateSpans: [{ start: v60ActionOnlyQuoteStart + 1,
        end: Array.from(v60ActionOnlyPriorPageText).length - 1 }],
    anchors: [],
    unresolvedDialogueSpans: [],
    scanStatus: 'complete',
};
const v60ActionOnlyPageEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v60ActionOnlyPriorPageIndex,
    fullText: v60ActionOnlyPriorPageText,
    sourceMessageIndex: 6012,
    sourceMessageHash: 'sha256:v60-action-only-prior-page',
    parserVersion: 'full-message-speaker-index.v60',
    pageType: 'dialogue',
    coreSpan: { start: v60ActionOnlyQuoteStart, end: Array.from(v60ActionOnlyPriorPageText).length },
    previousPageSpans: [{ sourceSpan: { start: 0, end: v60ActionOnlyQuoteStart }, pageType: 'narration' }],
});
assert.equal(v60ActionOnlyPageEvidence?.text, 'Mika',
    'an unspoken named action subject on the immediately prior source page can anchor its standalone quote');
assert.equal(v60ActionOnlyPageEvidence?.ruleId, 'prior-page-action-subject-continuation');
assert.equal(v60ActionOnlyPageEvidence?.sourceRegion, 'previous-existing-page');
assert.equal(v60ActionOnlyPageEvidence?.syntaxRole, 'named-action-subject');

let v60PriorPageProbeIndex = 6020;
const makeV60PriorPageProbe = (priorPageText, utterance) => {
    const sourceMessageIndex = v60PriorPageProbeIndex++;
    const fullText = `${priorPageText}\n\n“${utterance}”`;
    const sourceMessageHash = `sha256:v60-prior-page-negative-${sourceMessageIndex}`;
    const messageIndex = createStructuralMessageSpeakerIndex({
        fullText,
        publishedSpeakerNames: [],
        sourceMessageIndex,
        sourceMessageHash,
    });
    const pages = createVisualNovelDisplaySegments(fullText, { role: 'character', knownSpeakers: [] });
    const page = pages.at(-1);
    const evidence = createStructuralPageTitleEvidenceFromMessageIndex({
        messageIndex,
        fullText,
        sourceMessageIndex,
        sourceMessageHash,
        parserVersion: messageIndex.parserVersion,
        pageType: page?.type || 'unknown',
        coreSpan: page?.sourceSpan,
        previousPageSpans: pages.slice(0, -1).map((sourcePage) => ({
            sourceSpan: sourcePage.sourceSpan,
            pageType: sourcePage.type,
        })),
    });
    return { evidence, messageIndex };
};
for (const [priorPageText, expectedNotToResolve] of [
    ['莫里克被尼布砸碎面具。', ['莫里克被', '莫里克', '尼布']],
    ['报告被尼布拿起。', ['报告被尼', '报告', '尼布']],
    ['尼布感到震惊。', ['尼布感到', '尼布感', '尼布']],
    ['尼布的神情变得严肃。', ['尼布的', '尼布的神', '尼布']],
    ['尼布翻开账本。账本上写着：城门已经关闭。', ['尼布']],
]) {
    const { evidence, messageIndex } = makeV60PriorPageProbe(priorPageText, '城门已经关闭。');
    assert.ok(!expectedNotToResolve.includes(messageIndex.anchors[0]?.speakerText),
        `full-message quote analysis must reject false prior-sentence speakers: ${priorPageText}`);
    assert.ok(!expectedNotToResolve.includes(evidence?.text),
        `prior-page continuation must reject passive, state, possessive, and written-carrier false positives: ${priorPageText}`);
    assert.notEqual(evidence?.ruleId, 'prior-page-action-subject-continuation',
        `prior-page structural rule must abstain for non-speaker predicate frames: ${priorPageText}`);
}
const v60ActiveActorProbe = makeV60PriorPageProbe('尼布砸碎莫里克的面具。', '城门已经关闭。');
assert.equal(v60ActiveActorProbe.messageIndex.anchors[0]?.speakerText, '尼布',
    'an active named subject still remains attributable after passive/state negatives are rejected');

const v60UnclosedQuoteText = '尼布厉声道：“快走！这里要塌了。';
const v60UnclosedQuoteIndex = createStructuralMessageSpeakerIndex({
    fullText: v60UnclosedQuoteText,
    publishedSpeakerNames: ['尼布'],
    sourceMessageIndex: 6002,
    sourceMessageHash: 'sha256:v60-open-quote',
});
assert.equal(v60UnclosedQuoteIndex.quoteEvidence[0]?.closed, false,
    'an unclosed quote still retains context and explicit open status');
assert.equal(v60UnclosedQuoteIndex.anchors[0]?.speakerText, '尼布');
assert.equal(v60UnclosedQuoteIndex.anchors[0]?.quoteId, v60UnclosedQuoteIndex.quoteEvidence[0]?.quoteId);

const v61RankedCueText = 'Nadia举起手：“快走。”Sam说道。';
const v61RankedCueIndex = createStructuralMessageSpeakerIndex({
    fullText: v61RankedCueText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6100, sourceMessageHash: 'sha256:v61-ranked-cue',
});
assert.equal(v61RankedCueIndex.parserVersion, 'full-message-speaker-index.v84');
assert.equal(v61RankedCueIndex.anchors[0]?.speakerText, 'Sam',
    'an adjacent explicit post-quote speech cue outranks a weaker action subject');
assert.equal(v61RankedCueIndex.anchors[0]?.ruleId, 'post-quote-attribution');
assert.equal(v61RankedCueIndex.quoteEvidence[0]?.decision?.evidenceRank, 0);
assert.deepEqual(v61RankedCueIndex.quoteEvidence[0]?.previousSentenceContextSpan, { start: 0, end: 0 });
assert.deepEqual(v61RankedCueIndex.quoteEvidence[0]?.nextSentenceContextSpan,
    { start: v61RankedCueIndex.quoteEvidence[0].quoteSpan.end, end: Array.from(v61RankedCueText).length });

const v61EqualRankConflictText = 'Nadia说道：“快走。”Sam答道。';
const v61EqualRankConflict = createStructuralMessageSpeakerIndex({
    fullText: v61EqualRankConflictText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6101, sourceMessageHash: 'sha256:v61-equal-rank-conflict',
});
assert.equal(v61EqualRankConflict.anchors.length, 0,
    'two different speakers at the same strongest evidence rank produce no anchor');
assert.equal(v61EqualRankConflict.unresolvedDialogueSpans[0]?.reasonId, 'conflicting-quoted-attribution');

const v61NegativeSubjectText = 'Nadia没有回头。\n\n“你来了啊。”';
const v61NegativeSubject = createStructuralMessageSpeakerIndex({
    fullText: v61NegativeSubjectText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 6102, sourceMessageHash: 'sha256:v61-negative-subject',
});
assert.equal(v61NegativeSubject.anchors[0]?.speakerText, 'Nadia',
    'predicate auxiliaries are not swallowed into the source-bound character name');
assert.deepEqual(v61NegativeSubject.anchors[0]?.speakerSpan,
    { start: 0, end: Array.from('Nadia').length });

const v61PageText = 'Nadia说道：“快走。”Sam说道。';
const v61PagesBefore = createVisualNovelDisplaySegments(v61PageText, { role: 'character', knownSpeakers: ['Nadia', 'Sam'] });
const v61PageIndex = createStructuralMessageSpeakerIndex({
    fullText: v61PageText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6103, sourceMessageHash: 'sha256:v61-page-span',
});
const v61PageEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v61PageIndex, fullText: v61PageText,
    sourceMessageIndex: 6103, sourceMessageHash: 'sha256:v61-page-span',
    parserVersion: v61PageIndex.parserVersion, coreSpan: v61PagesBefore[0]?.sourceSpan,
    pageType: v61PagesBefore[0]?.type,
});
assert.equal(v61PageEvidence?.text, '旁白', 'equal-rank conflict falls back to neutral display evidence');
assert.deepEqual(v61PageIndex.quoteEvidence[0]?.productionPageIntersections, [
    { start: v61PageIndex.quoteEvidence[0].quoteSpan.start, end: v61PageIndex.quoteEvidence[0].quoteSpan.end },
]);
assert.deepEqual(createVisualNovelDisplaySegments(v61PageText, { role: 'character', knownSpeakers: ['Nadia', 'Sam'] }),
    v61PagesBefore, 'the title projector leaves production pages byte-for-byte equivalent as JSON data');

const v63HeadingBridgeText = 'Pippa说道：“好。”\n\n她抬起手：\n\n第十二阶段\n\n“你来了。”Sam答道。';
const v63HeadingBridgeNames = ['Pippa', 'Sam'];
const v63HeadingBridgePages = createVisualNovelDisplaySegments(v63HeadingBridgeText, {
    role: 'character', knownSpeakers: v63HeadingBridgeNames,
});
const v63HeadingBridgePageSnapshot = JSON.stringify(v63HeadingBridgePages);
const v63HeadingBridgeHash = 'sha256:v63-heading-bridge-priority';
const v63HeadingBridgeIndex = createStructuralMessageSpeakerIndex({
    fullText: v63HeadingBridgeText, publishedSpeakerNames: v63HeadingBridgeNames,
    sourceMessageIndex: 6300, sourceMessageHash: v63HeadingBridgeHash,
});
const v63TargetQuotePage = v63HeadingBridgePages.find((page) => page.text === '“你来了。”');
const v63ResolvedHeadingBridgeEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v63HeadingBridgeIndex, fullText: v63HeadingBridgeText,
    sourceMessageIndex: 6300, sourceMessageHash: v63HeadingBridgeHash,
    parserVersion: v63HeadingBridgeIndex.parserVersion,
    coreSpan: v63TargetQuotePage.sourceSpan, pageType: v63TargetQuotePage.type,
});
assert.equal(v63HeadingBridgeIndex.quoteEvidence.at(-1)?.decision?.speakerText, 'Sam');
assert.equal(v63ResolvedHeadingBridgeEvidence?.text, 'Sam',
    'a source quote decision from the current page outranks the older Pippa heading/pronoun bridge');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v63HeadingBridgeText, {
    role: 'character', knownSpeakers: v63HeadingBridgeNames,
})), v63HeadingBridgePageSnapshot,
'heading-bridge title precedence does not mutate production page segmentation');

const v63UnresolvedHeadingBridgeText = 'Pippa说道：“好。”\n\n她抬起手：\n\n第十二阶段\n\n“你来了。”';
const v63UnresolvedHeadingBridgeHash = 'sha256:v63-heading-bridge-unresolved';
const v63UnresolvedHeadingBridgePages = createVisualNovelDisplaySegments(v63UnresolvedHeadingBridgeText, {
    role: 'character', knownSpeakers: ['Pippa'],
});
const v63UnresolvedHeadingBridgeIndex = createStructuralMessageSpeakerIndex({
    fullText: v63UnresolvedHeadingBridgeText, publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 6301, sourceMessageHash: v63UnresolvedHeadingBridgeHash,
});
const v63UnresolvedQuotePage = v63UnresolvedHeadingBridgePages.find((page) => page.text === '“你来了。”');
assert.equal(v63UnresolvedHeadingBridgeIndex.quoteEvidence.at(-1)?.decision?.status, 'unresolved');
const v63UnresolvedHeadingBridgeEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v63UnresolvedHeadingBridgeIndex, fullText: v63UnresolvedHeadingBridgeText,
    sourceMessageIndex: 6301, sourceMessageHash: v63UnresolvedHeadingBridgeHash,
    parserVersion: v63UnresolvedHeadingBridgeIndex.parserVersion,
    coreSpan: v63UnresolvedQuotePage.sourceSpan, pageType: v63UnresolvedQuotePage.type,
});
assert.equal(v63UnresolvedHeadingBridgeEvidence?.text, 'Pippa',
    'a generic unresolved quote may use the old bridge only when the bounded source relation is unique');
const v63ConflictingHeadingBridgeIndex = structuredClone(v63UnresolvedHeadingBridgeIndex);
const v63ConflictingQuote = v63ConflictingHeadingBridgeIndex.quoteEvidence.at(-1);
v63ConflictingQuote.decision.reasonId = 'conflicting-quoted-attribution';
v63ConflictingHeadingBridgeIndex.unresolvedDialogueSpans.at(-1).reasonId = 'conflicting-quoted-attribution';
const v63ConflictingHeadingBridgeEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v63ConflictingHeadingBridgeIndex, fullText: v63UnresolvedHeadingBridgeText,
    sourceMessageIndex: 6301, sourceMessageHash: v63UnresolvedHeadingBridgeHash,
    parserVersion: v63ConflictingHeadingBridgeIndex.parserVersion,
    coreSpan: v63UnresolvedQuotePage.sourceSpan, pageType: v63UnresolvedQuotePage.type,
});
assert.notEqual(v63ConflictingHeadingBridgeEvidence?.text, 'Pippa',
    'a conflicted current-page quote cannot inherit Pippa from the old heading bridge');
assert.notEqual(v63ConflictingHeadingBridgeEvidence?.speakers?.[0]?.text, 'Pippa');

const v64PageLocalCueConflictText = 'Pippa回应Sam说道：“好。”';
const v64PageLocalCueNames = ['Pippa', 'Sam'];
const v64PageLocalCuePages = createVisualNovelDisplaySegments(v64PageLocalCueConflictText, {
    role: 'character', knownSpeakers: v64PageLocalCueNames,
});
const v64PageLocalCuePagesSnapshot = JSON.stringify(v64PageLocalCuePages);
const v64PageLocalCueIndex = createStructuralMessageSpeakerIndex({
    fullText: v64PageLocalCueConflictText, publishedSpeakerNames: v64PageLocalCueNames,
    sourceMessageIndex: 6400, sourceMessageHash: 'sha256:v64-local-cue-conflict',
});
const v64PageLocalCuePage = v64PageLocalCuePages.find((page) => page.sourceText.startsWith('Sam说道'));
assert.equal(v64PageLocalCueIndex.quoteEvidence[0]?.decision?.speakerText, 'Pippa',
    'the full-message parser has a top-level attributed decision to compare');
assert.equal(v64PageLocalCueIndex.quoteEvidence[0]?.candidates, undefined,
    'the message index stores the winner summary only, never losing candidates');
assert.equal(v64PageLocalCueIndex.quoteEvidence[0]?.decision?.evidenceRank, 0);
const v64PageLocalCueEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v64PageLocalCueIndex, fullText: v64PageLocalCueConflictText,
    sourceMessageIndex: 6400, sourceMessageHash: 'sha256:v64-local-cue-conflict',
    parserVersion: v64PageLocalCueIndex.parserVersion,
    coreSpan: v64PageLocalCuePage.sourceSpan, pageType: v64PageLocalCuePage.type,
});
assert.equal(v64PageLocalCueEvidence?.text, '旁白',
    'the page-local Sam cue ties the stored top-rank Pippa decision and abstains');
assert.equal(v64PageLocalCueEvidence?.diagnosticReasonId, 'conflicting-speaker-evidence');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v64PageLocalCueConflictText, {
    role: 'character', knownSpeakers: v64PageLocalCueNames,
})), v64PageLocalCuePagesSnapshot, 'the page-local resolver leaves production segments unchanged');

const v65SameCueBoundaryText = '瑞恩小声说：“至高领袖，我听说天海港黑市深处有个神秘工匠——龙铸者。他是龙族后裔，专门处理龙族材料。\n\n但他的工坊位置是秘密，而且收费极高。”';
const v65SameCueBoundaryPages = createVisualNovelDisplaySegments(v65SameCueBoundaryText, {
    role: 'character', knownSpeakers: [],
});
const v65SameCueBoundarySnapshot = JSON.stringify(v65SameCueBoundaryPages);
const v65SameCueBoundaryIndex = createStructuralMessageSpeakerIndex({
    fullText: v65SameCueBoundaryText, publishedSpeakerNames: [],
    sourceMessageIndex: 6500, sourceMessageHash: 'sha256:v65-same-cue-boundary',
});
assert.equal(v65SameCueBoundaryIndex.quoteEvidence[0]?.decision?.speakerText, '瑞恩');
assert.equal(v65SameCueBoundaryIndex.quoteEvidence[0]?.decision?.evidenceRank, 0);
const v65SameCueFirstPage = v65SameCueBoundaryPages[0];
const v65SameCueFirstEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v65SameCueBoundaryIndex, fullText: v65SameCueBoundaryText,
    sourceMessageIndex: 6500, sourceMessageHash: 'sha256:v65-same-cue-boundary',
    parserVersion: v65SameCueBoundaryIndex.parserVersion,
    coreSpan: v65SameCueFirstPage.sourceSpan, pageType: v65SameCueFirstPage.type,
});
assert.equal(v65SameCueFirstEvidence?.text, '瑞恩',
    'the page-local greedy Han boundary is the same exact cue as the quote winner, not a competing speaker');
const v65SameCueContinuation = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v65SameCueBoundaryIndex, fullText: v65SameCueBoundaryText,
    sourceMessageIndex: 6500, sourceMessageHash: 'sha256:v65-same-cue-boundary',
    parserVersion: v65SameCueBoundaryIndex.parserVersion,
    coreSpan: v65SameCueBoundaryPages[1].sourceSpan, pageType: v65SameCueBoundaryPages[1].type,
    previousPageSpans: [{ sourceSpan: v65SameCueFirstPage.sourceSpan, pageType: v65SameCueFirstPage.type }],
});
assert.equal(v65SameCueContinuation?.text, '瑞恩', 'the same closed quote keeps one speaker on the following page');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v65SameCueBoundaryText, {
    role: 'character', knownSpeakers: [],
})), v65SameCueBoundarySnapshot, 'speaker projection does not alter production page segmentation');

const v65CrossPageConflictText = 'Pippa回应Sam说道：“这是第一段，包含足够长的未结束对白并等待后文。\n\n这是继续内容，最后才说完。”\n\n场景结束。';
const v65CrossPageConflictPages = createVisualNovelDisplaySegments(v65CrossPageConflictText, {
    role: 'character', knownSpeakers: ['Pippa', 'Sam'],
});
const v65CrossPageConflictIndex = createStructuralMessageSpeakerIndex({
    fullText: v65CrossPageConflictText, publishedSpeakerNames: ['Pippa', 'Sam'],
    publishedSpeakerFingerprint: 'sha256:v65-cross-page-conflict',
    sourceMessageIndex: 6501, sourceMessageHash: 'sha256:v65-cross-page-conflict',
});
const v65CrossPageConflictPage = v65CrossPageConflictPages.find((page) => page.sourceText.startsWith('Sam说道'));
const v65CrossPageConflictEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v65CrossPageConflictIndex, fullText: v65CrossPageConflictText,
    sourceMessageIndex: 6501, sourceMessageHash: 'sha256:v65-cross-page-conflict',
    publishedSpeakerFingerprint: 'sha256:v65-cross-page-conflict',
    parserVersion: v65CrossPageConflictIndex.parserVersion,
    coreSpan: v65CrossPageConflictPage.sourceSpan, pageType: v65CrossPageConflictPage.type,
});
assert.equal(v65CrossPageConflictEvidence?.diagnosticReasonId, 'conflicting-speaker-evidence',
    'a genuinely different speaker boundary remains a conflict');
assert.ok(v65CrossPageConflictEvidence.classificationEvidenceSpans.every((span) => (
    span.start >= v65CrossPageConflictPage.sourceSpan.start && span.end <= v65CrossPageConflictPage.sourceSpan.end
)), 'conflict evidence is clipped to the current production page core');

const v64ProbableText = '约翰立刻反对：“这里禁止通行。”';
const v64ProbablePage = createVisualNovelDisplaySegments(v64ProbableText, {
    role: 'character', knownSpeakers: ['Pippa'],
})[0];
const v64ProbableHash = `sha256:${createHash('sha256').update(v64ProbableText, 'utf8').digest('hex')}`;
const v64ProbableIndex = createStructuralMessageSpeakerIndex({
    fullText: v64ProbableText, publishedSpeakerNames: ['Pippa'], sourceMessageIndex: 6401,
    sourceMessageHash: v64ProbableHash,
    parserVersion: 'full-message-speaker-index.v70',
});
const v64SafeProbable = await createProbableNarrativeSpeakerTitleEvidence({
    fullText: v64ProbableText, sourceMessageIndex: 6401, sourceMessageHash: v64ProbableHash,
    coreSpan: v64ProbablePage.sourceSpan, segment: v64ProbablePage, messageIndex: v64ProbableIndex,
});
assert.equal(v64SafeProbable?.text, '约翰（推测）',
    'a validated production hint remains available when its exact quote has no confirmed/conflicting decision');
const v64AttributedProbableIndex = structuredClone(v64ProbableIndex);
v64AttributedProbableIndex.quoteEvidence[0].decision = {
    status: 'attributed', speakerText: 'Pippa', speakerSpan: { start: 0, end: 1 },
    evidenceSpan: { start: 0, end: 1 }, evidenceRank: 0, ruleId: 'quoted-attribution',
};
assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
    fullText: v64ProbableText, sourceMessageIndex: 6401, sourceMessageHash: v64ProbableHash,
    coreSpan: v64ProbablePage.sourceSpan, segment: v64ProbablePage, messageIndex: v64AttributedProbableIndex,
}), null, 'a probable hint cannot override a different confirmed speaker decision');
const v64ConflictingProbableIndex = structuredClone(v64ProbableIndex);
v64ConflictingProbableIndex.quoteEvidence[0].decision = {
    status: 'unresolved', reasonId: 'conflicting-quoted-attribution', evidenceRank: 0,
};
assert.equal(await createProbableNarrativeSpeakerTitleEvidence({
    fullText: v64ProbableText, sourceMessageIndex: 6401, sourceMessageHash: v64ProbableHash,
    coreSpan: v64ProbablePage.sourceSpan, segment: v64ProbablePage, messageIndex: v64ConflictingProbableIndex,
}), null, 'a probable hint remains suppressed when the same quote has a same-rank conflict');

const v66LilaText = 'Lila冷冷回答：“取决于你挣扎多久。”';
const v66LilaIndex = createStructuralMessageSpeakerIndex({
    fullText: v66LilaText, sourceMessageIndex: 6601, sourceMessageHash: 'sha256:v66-lila-manner-cue',
});
assert.equal(v66LilaIndex.quoteEvidence[0]?.decision?.speakerText, 'Lila',
    'a discourse manner modifier does not get absorbed into or block a direct named speech cue');

const v66SeshaText = '塞莎又压低声音补了一句：“旧钟楼地下最近有陌生人活动，像是有人在搬金属、布置镜面、还有往地里埋骨灰。别从正门进，正门那条路今晚会有‘意外’。”';
const v66SeshaPages = createVisualNovelDisplaySegments(v66SeshaText, { role: 'character', knownSpeakers: [] });
const v66SeshaSnapshot = JSON.stringify(v66SeshaPages);
const v66SeshaIndex = createStructuralMessageSpeakerIndex({
    fullText: v66SeshaText, sourceMessageIndex: 6602, sourceMessageHash: 'sha256:v66-sesha-nested-quote',
});
assert.equal(v66SeshaIndex.quoteEvidence[0]?.decision?.speakerText, '塞莎',
    'the direct explicit cue wins over action tokenization in 塞莎又压低声音补了一句');
assert.equal(v66SeshaIndex.anchors[0]?.speakerText, '塞莎');
const v66SeshaInnerQuote = v66SeshaIndex.quoteEvidence.find((quote) => quote.parentQuoteId);
assert.ok(v66SeshaInnerQuote, 'quoted word 意外 remains a nested quote in the source ledger');
assert.equal(v66SeshaInnerQuote.decision?.status, 'no-dialogue-evidence',
    'a nested quoted word does not become an independent speaker or steal the outer line');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v66SeshaText, {
    role: 'character', knownSpeakers: [],
})), v66SeshaSnapshot, 'direct-cue attribution leaves production segmentation unchanged');

const v66SilverMaskText = '银面具贵客轻声说：“有血味。新鲜的。”';
const v66SilverMaskPages = createVisualNovelDisplaySegments(v66SilverMaskText, { role: 'character', knownSpeakers: [] });
const v66SilverMaskIndex = createStructuralMessageSpeakerIndex({
    fullText: v66SilverMaskText, sourceMessageIndex: 6603, sourceMessageHash: 'sha256:v66-anonymous-role',
});
assert.equal(v66SilverMaskIndex.anchors.length, 0,
    'a long descriptive role noun phrase is not truncated into a guessed character name');
assert.equal(v66SilverMaskIndex.unresolvedDialogueSpans[0]?.reasonId, 'anonymous-first-appearance');
assert.equal(createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v66SilverMaskIndex, fullText: v66SilverMaskText, sourceMessageIndex: 6603,
    sourceMessageHash: 'sha256:v66-anonymous-role', coreSpan: v66SilverMaskPages[0].sourceSpan,
    pageType: v66SilverMaskPages[0].type,
})?.text, '？？？', 'a first-seen anonymous role description is displayed as ？？？');
const v66KnownRoleIndex = createStructuralMessageSpeakerIndex({
    fullText: '霜石大法师轻声说：“结界已经稳住。”', publishedSpeakerNames: ['霜石'],
    sourceMessageIndex: 6609, sourceMessageHash: 'sha256:v66-known-role-prefix',
});
assert.equal(v66KnownRoleIndex.quoteEvidence[0]?.decision?.speakerText, '霜石',
    'a rostered character followed by a role title remains that known character, not an anonymous role');

const v66AnonymousOfficerText = '“临时全队不死负责人”的倒霉小官。他尖叫：“快锁门！”';
const v66AnonymousOfficerIndex = createStructuralMessageSpeakerIndex({
    fullText: v66AnonymousOfficerText, sourceMessageIndex: 6604,
    sourceMessageHash: 'sha256:v66-anonymous-officer-pronoun',
});
const v66OfficerQuote = v66AnonymousOfficerIndex.quoteEvidence.at(-1);
assert.equal(v66OfficerQuote?.decision?.reasonId, 'anonymous-first-appearance',
    'a descriptive anonymous role can be recovered through 他 + speech verb across the quoted title boundary');
const v66OfficerEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v66AnonymousOfficerIndex, fullText: v66AnonymousOfficerText,
    sourceMessageIndex: 6604, sourceMessageHash: 'sha256:v66-anonymous-officer-pronoun',
    coreSpan: v66OfficerQuote.quoteSpan, pageType: 'dialogue',
});
assert.equal(v66OfficerEvidence?.text, '？？？', 'the anonymous role is not emitted as a persistent identity');

const v66RecentTwoPageText = 'Anna望向操场。\n\n操场外传来雨声。\n\n“你来了啊。”';
const v66RecentTwoPagePages = createVisualNovelDisplaySegments(v66RecentTwoPageText, { role: 'character', knownSpeakers: [] });
const v66RecentTwoPageSnapshot = JSON.stringify(v66RecentTwoPagePages);
const v66RecentTwoPageIndex = createStructuralMessageSpeakerIndex({
    fullText: v66RecentTwoPageText, sourceMessageIndex: 6605,
    sourceMessageHash: 'sha256:v66-two-page-backtrack',
});
const v66RecentQuotePage = v66RecentTwoPagePages.at(-1);
const v66RecentQuoteEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v66RecentTwoPageIndex, fullText: v66RecentTwoPageText,
    sourceMessageIndex: 6605, sourceMessageHash: 'sha256:v66-two-page-backtrack',
    coreSpan: v66RecentQuotePage.sourceSpan, pageType: v66RecentQuotePage.type,
    previousPageSpans: v66RecentTwoPagePages.slice(0, -1).map((page) => ({
        sourceSpan: page.sourceSpan, pageType: page.type,
    })),
});
assert.equal(v66RecentQuoteEvidence?.text, 'Anna',
    'a standalone quote can use one unique named action subject from the prior two existing pages');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v66RecentTwoPageText, {
    role: 'character', knownSpeakers: [],
})), v66RecentTwoPageSnapshot, 'two-page lookup does not rewrite production page boundaries or text');

const v67AnnaText = '窗玻璃被指节轻轻叩响，发出很浅的一声。\n\nAnna 原本正望着操场边缘出神。她肩膀微微一颤，回过头来，夕阳从她发梢间漏过去，把那双眼睛照得像藏着一点没说出口的心事。\n\n“……你来了啊。”\n\n她';
const v67AnnaPages = createVisualNovelDisplaySegments(v67AnnaText, { role: 'character', knownSpeakers: [] });
const v67AnnaSnapshot = JSON.stringify(v67AnnaPages);
const v67AnnaIndex = createStructuralMessageSpeakerIndex({
    fullText: v67AnnaText, sourceMessageIndex: 6701, sourceMessageHash: 'sha256:v67-anna-full-historical-shape',
});
const v67AnnaQuotePage = v67AnnaPages.find((page) => page.type === 'unattributed-dialogue');
const v67AnnaEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v67AnnaIndex, fullText: v67AnnaText, sourceMessageIndex: 6701,
    sourceMessageHash: 'sha256:v67-anna-full-historical-shape',
    coreSpan: v67AnnaQuotePage.sourceSpan, pageType: v67AnnaQuotePage.type,
    previousPageSpans: v67AnnaPages.slice(0, v67AnnaQuotePage.index).map((page) => ({
        sourceSpan: page.sourceSpan, pageType: page.type,
    })),
});
assert.equal(v67AnnaEvidence?.text, 'Anna',
    'the full historical Anna + action/pronoun chain resolves the standalone quote to Anna');
assert.equal(v67AnnaEvidence?.ruleId, 'prior-page-pronoun-linked-quote-continuation');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v67AnnaText, {
    role: 'character', knownSpeakers: [],
})), v67AnnaSnapshot, 'pronoun-linked title evidence leaves Anna source pagination unchanged');

const v67PronounResumptionText = '—Sam 拿着盘子站在橱柜前。\n\n—Priya 先抬头。她的笔尖停在课本边缘。\n\n“定向障碍？”\n\n她说得很轻，但句子很利。\n\n“姓名、地点、时间。”\n\n—Nadia 关小炉火，把木勺搁在碗边。\n\n“你现在要先坐下。”\n\n她看了一眼 Theo。\n\n“你去倒水。现在。”';
const v67PronounResumptionPages = createVisualNovelDisplaySegments(v67PronounResumptionText, {
    role: 'character', knownSpeakers: [],
});
const v67PronounResumptionSnapshot = JSON.stringify(v67PronounResumptionPages);
const v67PronounResumptionIndex = createStructuralMessageSpeakerIndex({
    fullText: v67PronounResumptionText, sourceMessageIndex: 6702,
    sourceMessageHash: 'sha256:v67-pronoun-resumption',
});
const v67PronounResumptionEvidence = v67PronounResumptionPages.map((page) => createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v67PronounResumptionIndex, fullText: v67PronounResumptionText,
    sourceMessageIndex: 6702, sourceMessageHash: 'sha256:v67-pronoun-resumption',
    coreSpan: page.sourceSpan, pageType: page.type,
    previousPageSpans: v67PronounResumptionPages.slice(0, page.index).map((previous) => ({
        sourceSpan: previous.sourceSpan, pageType: previous.type,
    })),
}));
assert.equal(v67PronounResumptionEvidence[4]?.text, 'Priya',
    'a unique explicit speaker remains the subject through a short pronoun-led speech/action page');
assert.ok(['prior-page-pronoun-speaker-resumption', 'full-message-structural'].includes(v67PronounResumptionEvidence[4]?.ruleId),
    'a full-message quote anchor may supersede the page-local pronoun resumption evidence');
assert.equal(v67PronounResumptionEvidence[8]?.text, 'Nadia',
    'a named object in the pronoun-led action does not steal the prior speaker');
assert.ok(['prior-page-pronoun-speaker-resumption', 'full-message-structural'].includes(v67PronounResumptionEvidence[8]?.ruleId),
    'a full-message quote anchor may supersede the page-local pronoun resumption evidence');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v67PronounResumptionText, {
    role: 'character', knownSpeakers: [],
})), v67PronounResumptionSnapshot, 'pronoun resumption changes titles only, not source pagination');

const v67NoAnchorText = '她看了一眼 Theo。\n\n“你去倒水。现在。”';
const v67NoAnchorPages = createVisualNovelDisplaySegments(v67NoAnchorText, { role: 'character', knownSpeakers: [] });
const v67NoAnchorIndex = createStructuralMessageSpeakerIndex({
    fullText: v67NoAnchorText, sourceMessageIndex: 6703, sourceMessageHash: 'sha256:v67-no-prior-speaker-anchor',
});
const v67NoAnchorEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v67NoAnchorIndex, fullText: v67NoAnchorText, sourceMessageIndex: 6703,
    sourceMessageHash: 'sha256:v67-no-prior-speaker-anchor',
    coreSpan: v67NoAnchorPages.at(-1).sourceSpan, pageType: v67NoAnchorPages.at(-1).type,
    previousPageSpans: v67NoAnchorPages.slice(0, -1).map((page) => ({ sourceSpan: page.sourceSpan, pageType: page.type })),
});
assert.notEqual(v67NoAnchorEvidence?.kind, 'speaker',
    'a pronoun-led action cannot invent a speaker without a prior explicit anchor');

const v67WrittenCarrierText = 'Nadia说道：“先坐下。”\n\n她看了一眼账本，上面写着：\n\n“守卫马上撤离。”';
const v67WrittenCarrierPages = createVisualNovelDisplaySegments(v67WrittenCarrierText, { role: 'character', knownSpeakers: [] });
const v67WrittenCarrierIndex = createStructuralMessageSpeakerIndex({
    fullText: v67WrittenCarrierText, sourceMessageIndex: 6704, sourceMessageHash: 'sha256:v67-written-carrier-resumption-negative',
});
const v67WrittenCarrierPage = v67WrittenCarrierPages.at(-1);
const v67WrittenCarrierEvidence = createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v67WrittenCarrierIndex, fullText: v67WrittenCarrierText, sourceMessageIndex: 6704,
    sourceMessageHash: 'sha256:v67-written-carrier-resumption-negative',
    coreSpan: v67WrittenCarrierPage.sourceSpan, pageType: v67WrittenCarrierPage.type,
    previousPageSpans: v67WrittenCarrierPages.slice(0, -1).map((page) => ({ sourceSpan: page.sourceSpan, pageType: page.type })),
});
assert.notEqual(v67WrittenCarrierEvidence?.text, 'Nadia',
    'a later quote attributed to a written record does not inherit the prior speaker');

const v66PippaText = 'Pippa拍了拍你的肩膀:"好,现在我们得决定招谁。\n\n我建议招Celestia(80金)和Durik(80金)。\n\nCelestia能治疗能输出,Durik能抗能砍,我们就有了一个完整的五人小队:你当主力输出,我当法师炮台,Celestia当奶妈,Durik当肉盾,尼布当……呃……吉祥物?"';
const v66PippaPages = createVisualNovelDisplaySegments(v66PippaText, { role: 'character', knownSpeakers: [] });
assert.equal(v66PippaPages.length, 3, 'the fixture retains three source pages across one long quote');
const v66PippaSnapshot = JSON.stringify(v66PippaPages);
const v66PippaIndex = createStructuralMessageSpeakerIndex({
    fullText: v66PippaText, sourceMessageIndex: 6606, sourceMessageHash: 'sha256:v66-pippa-open-quote-pages',
});
assert.equal(v66PippaIndex.quoteEvidence[0]?.closed, true);
assert.equal(v66PippaIndex.quoteEvidence[0]?.decision?.speakerText, 'Pippa',
    'the source quote opening action anchors one paired utterance through its closing quote');
const v66PippaPageEvidence = v66PippaPages.map((page) => createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex: v66PippaIndex, fullText: v66PippaText, sourceMessageIndex: 6606,
    sourceMessageHash: 'sha256:v66-pippa-open-quote-pages', coreSpan: page.sourceSpan, pageType: page.type,
}));
assert.deepEqual(v66PippaPageEvidence.map((evidence) => evidence?.text), ['Pippa', 'Pippa', 'Pippa'],
    'mentioning Celestia and Durik inside the still-open source quote does not steal the speaker on continuation pages');
assert.deepEqual(JSON.stringify(createVisualNovelDisplaySegments(v66PippaText, {
    role: 'character', knownSpeakers: [],
})), v66PippaSnapshot, 'same-source open-quote continuity does not change pagination');

const v66WrittenCarrierText = '账本上写着：“守卫马上撤离。”';
const v66WrittenCarrierIndex = createStructuralMessageSpeakerIndex({
    fullText: v66WrittenCarrierText, sourceMessageIndex: 6607,
    sourceMessageHash: 'sha256:v66-written-carrier-negative',
});
assert.equal(v66WrittenCarrierIndex.anchors.length, 0,
    'a written record containing a quoted command remains non-dialogue evidence');

const v66EqualRankConflictText = 'Nadia说道：“快走。”Sam答道。';
const v66EqualRankConflict = createStructuralMessageSpeakerIndex({
    fullText: v66EqualRankConflictText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6608, sourceMessageHash: 'sha256:v66-conflicting-cue-negative',
});
assert.equal(v66EqualRankConflict.quoteEvidence[0]?.decision?.status, 'unresolved',
    'a real same-rank different-speaker conflict still abstains after direct-cue generalization');
assert.equal(v66EqualRankConflict.quoteEvidence[0]?.decision?.reasonId, 'conflicting-quoted-attribution');

const v69PriorExpandedText = 'Nadia低声说道。门后传来脚步。“走。”';
const v69PriorExpandedIndex = createStructuralMessageSpeakerIndex({
    fullText: v69PriorExpandedText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6901, sourceMessageHash: 'sha256:v69-prior-expanded-signature',
});
assert.equal(v69PriorExpandedIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'the unique explicit speech signature in the second previous sentence is considered after the nearer sentence has no signer');
assert.equal(v69PriorExpandedIndex.quoteEvidence[0]?.decision?.ruleId, 'expanded-explicit-signature');

const v69NearestSignatureText = 'Nadia低声说道。Sam轻声说道。“走。”';
const v69NearestSignatureIndex = createStructuralMessageSpeakerIndex({
    fullText: v69NearestSignatureText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6902, sourceMessageHash: 'sha256:v69-nearest-signature',
});
assert.equal(v69NearestSignatureIndex.quoteEvidence[0]?.decision?.speakerText, 'Sam',
    'among explicit prior signatures, the closest unblocked sentence wins');

const v69FartherSignatureBlockedText = 'Nadia低声说道。Sam走进房间。“走。”';
const v69FartherSignatureBlockedIndex = createStructuralMessageSpeakerIndex({
    fullText: v69FartherSignatureBlockedText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6903, sourceMessageHash: 'sha256:v69-farther-signature-blocked',
});
assert.equal(v69FartherSignatureBlockedIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'an explicit speech signature outranks a nearer name that appears only in an action');

const v69PostQuoteSignatureText = '“走。”。门后传来脚步。Nadia低声说道。';
const v69PostQuoteSignatureIndex = createStructuralMessageSpeakerIndex({
    fullText: v69PostQuoteSignatureText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 6904, sourceMessageHash: 'sha256:v69-postquote-expanded-signature',
});
assert.equal(v69PostQuoteSignatureIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a clear post-quote speech signature remains available across one unrelated sentence');

const v69DifferentQuoteBlocksText = 'Nadia说道：“先走。”Sam说道：“别走。”';
const v69DifferentQuoteBlocksIndex = createStructuralMessageSpeakerIndex({
    fullText: v69DifferentQuoteBlocksText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6905, sourceMessageHash: 'sha256:v69-neighboring-quote-block',
});
assert.deepEqual(v69DifferentQuoteBlocksIndex.quoteEvidence.map((item) => item.decision?.speakerText), ['Nadia', 'Sam'],
    'a neighboring quote keeps its own direct signer and cannot bleed across the quote boundary');

const v69MentionOnlyText = 'Nadia站在门边。Sam的名字写在信上。“快走。”';
const v69MentionOnlyIndex = createStructuralMessageSpeakerIndex({
    fullText: v69MentionOnlyText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 6906, sourceMessageHash: 'sha256:v69-mention-only-negative',
});
assert.notEqual(v69MentionOnlyIndex.quoteEvidence[0]?.decision?.speakerText, 'Sam',
    'nearby mentions and written names are not promoted to explicit speech signatures');

for (const carrierText of ['信上写着一行字。', '报告显示结果如下。']) {
    const source = `Nadia低声说道。${carrierText}“走。”`;
    const index = createStructuralMessageSpeakerIndex({
        fullText: source, publishedSpeakerNames: ['Nadia'],
        sourceMessageIndex: 6910, sourceMessageHash: `sha256:v69-carrier-bridge-${carrierText.length}`,
    });
    assert.notEqual(index.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
        'a written carrier between a past signer and quote blocks the older signer');
}

const v70AdjacentCueText = '“快走。”。Nadia停顿片刻，随后低声说道。';
const v70AdjacentCueIndex = createStructuralMessageSpeakerIndex({
    fullText: v70AdjacentCueText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 7001, sourceMessageHash: 'sha256:v70-adjacent-cue-positive',
});
assert.equal(v70AdjacentCueIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a known name connected to an explicit speech cue in the immediately adjacent sentence may recover the quote');
assert.equal(v70AdjacentCueIndex.quoteEvidence[0]?.decision?.ruleId, 'adjacent-name-speech-cue-fallback',
    'the conservative adjacent-name recovery runs as a distinct last-resort rule');

const v70AdjacentCueBeforeText = '听见脚步后，Nadia停顿片刻，随后低声说道。“快走。”';
const v70AdjacentCueBeforeIndex = createStructuralMessageSpeakerIndex({
    fullText: v70AdjacentCueBeforeText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 7002, sourceMessageHash: 'sha256:v70-adjacent-cue-before',
});
assert.equal(v70AdjacentCueBeforeIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'the immediate previous sentence can supply a unique name plus speech cue');

const v70MentionOnlyText = 'Nadia在门边。灯光闪烁。“快走。”';
const v70MentionOnlyIndex = createStructuralMessageSpeakerIndex({
    fullText: v70MentionOnlyText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 7003, sourceMessageHash: 'sha256:v70-mention-only-negative',
});
assert.notEqual(v70MentionOnlyIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a nearby rostered name without an explicit speech cue is not enough');

const v70OtherActorText = 'Nadia离开后，守卫低声说：“不许进。”';
const v70OtherActorIndex = createStructuralMessageSpeakerIndex({
    fullText: v70OtherActorText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 7006, sourceMessageHash: 'sha256:v70-other-actor-negative',
});
assert.notEqual(v70OtherActorIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a generic person category explicitly performing the speech action blocks a nearby named character');

const v70OtherActorAfterPauseText = 'Nadia停顿片刻，守卫随后低声说道：“不许进。”';
const v70OtherActorAfterPauseIndex = createStructuralMessageSpeakerIndex({
    fullText: v70OtherActorAfterPauseText, publishedSpeakerNames: ['Nadia'],
    sourceMessageIndex: 7007, sourceMessageHash: 'sha256:v70-other-actor-after-pause-negative',
});
assert.notEqual(v70OtherActorAfterPauseIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a second actor remains blocking even when preceded by a pause/connective');

const v70CompetingNameText = '“快走。”。Nadia看向Sam，随后低声说道。';
const v70CompetingNameIndex = createStructuralMessageSpeakerIndex({
    fullText: v70CompetingNameText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 7004, sourceMessageHash: 'sha256:v70-competing-name-negative',
});
assert.equal(v70CompetingNameIndex.quoteEvidence[0]?.decision?.ruleId, 'expanded-explicit-signature',
    'an existing higher-priority explicit signature remains authoritative and is not replaced by the last-resort fallback');

const v70ExistingRuleWinsText = 'Nadia说道：“先走。”';
const v70ExistingRuleWinsIndex = createStructuralMessageSpeakerIndex({
    fullText: v70ExistingRuleWinsText, publishedSpeakerNames: ['Nadia', 'Sam'],
    sourceMessageIndex: 7005, sourceMessageHash: 'sha256:v70-existing-rule-priority',
});
assert.equal(v70ExistingRuleWinsIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia');
assert.notEqual(v70ExistingRuleWinsIndex.quoteEvidence[0]?.decision?.ruleId, 'adjacent-name-speech-cue-fallback',
    'the fallback does not replace an attribution already supplied by a stronger existing rule');

const v71RosterIndependentCases = [
    ['Pippa一边咳嗽一边踹开一具尸体：“快点，大剑先生！”', 'Pippa', 'unrostered-subject-colon-quote'],
    ['Lila则只问：“入口几个？”', 'Lila', 'unrostered-subject-explicit-cue'],
    ['赫斯克尖声大喊：“滚出我的铺子！”', '赫斯克', 'unrostered-subject-explicit-cue'],
    ['Lila扫着四周，低声说：“别盯摊主……”', 'Lila', 'unrostered-subject-explicit-cue'],
    ['Pippa掏出地图，翻开第一页：“让我看看这里写了什么。”', 'Pippa', 'unrostered-subject-colon-quote'],
    ['塞蕾雅喉头动了一下，低低道：“这里若响，鸦口尾门那边也可能听见。”', '塞蕾雅', 'unrostered-subject-colon-quote'],
    ['赫斯克惨叫，尖得像被煮开的茶壶：“我说！”', '赫斯克', 'unrostered-subject-colon-quote'],
    ['“快走。”。Nadia停顿片刻，随后低声说道。', 'Nadia', 'adjacent-name-speech-cue-fallback'],
];
for (const [text, expectedSpeaker, expectedRule] of v71RosterIndependentCases) {
    const index = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: [],
        sourceMessageIndex: 7100 + v71RosterIndependentCases.findIndex((item) => item[0] === text),
        sourceMessageHash: `sha256:v71-roster-independent-${text.length}`,
        parserVersion: 'full-message-speaker-index.v71',
    });
    assert.equal(index.quoteEvidence[0]?.decision?.speakerText, expectedSpeaker,
        `v71 recovers the grammatical actor without a published roster: ${text}`);
    assert.equal(index.quoteEvidence[0]?.decision?.ruleId, expectedRule,
        `v71 identifies the structural fallback used: ${text}`);
}

const v71MentionOnlyIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Nadia在门边。灯光闪烁。“快走。”',
    publishedSpeakerNames: [], sourceMessageIndex: 7190, sourceMessageHash: 'sha256:v71-mention-only',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.notEqual(v71MentionOnlyIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a nearby name without a local action or speech cue is not promoted');

const v71NearbyRosterMentionIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Nadia在门边，灯光闪烁。“快走。”',
    publishedSpeakerNames: ['Nadia'], sourceMessageIndex: 7198, sourceMessageHash: 'sha256:v71-nearby-roster-mention',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.equal(v71NearbyRosterMentionIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'the last-resort fallback uses a rostered name in an adjacent sentence even without another cue');
assert.equal(v71NearbyRosterMentionIndex.quoteEvidence[0]?.decision?.ruleId, 'nearby-known-name-mention-fallback');

const v71FirstNearbyRosterMentionIndex = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa看向Lila，点了点头。“走！”',
    publishedSpeakerNames: ['Pippa', 'Lila'], sourceMessageIndex: 7199, sourceMessageHash: 'sha256:v71-first-nearby-roster-mention',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.equal(v71FirstNearbyRosterMentionIndex.quoteEvidence[0]?.decision?.speakerText, 'Pippa',
    'when this low-priority fallback finds multiple nearby roster names, it chooses the first textual name');

const v71CompetingActorIndex = createStructuralMessageSpeakerIndex({
    fullText: '“快走。”。Nadia离开后，守卫随后低声说道。',
    publishedSpeakerNames: [], sourceMessageIndex: 7191, sourceMessageHash: 'sha256:v71-competing-actor',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.notEqual(v71CompetingActorIndex.quoteEvidence[0]?.decision?.speakerText, 'Nadia',
    'a later explicit generic actor blocks the earlier named character');

const v71WrittenCarrierIndex = createStructuralMessageSpeakerIndex({
    fullText: '墙上的铭文：“北门开启。”',
    publishedSpeakerNames: [], sourceMessageIndex: 7192, sourceMessageHash: 'sha256:v71-written-carrier',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.notEqual(v71WrittenCarrierIndex.quoteEvidence[0]?.decision?.speakerText, '墙上',
    'a written carrier never becomes a character speaker');

const v73PronounCueCases = [
    ['艾米莉', '艾米莉还蜷缩在祭坛旁边。她小声说：“求求你们带我回家。”', 'pronoun-cue-nearby-unique-actor'],
    ['Lila', 'Lila先上手检查门框；她又检查井盖边缘，低声说：“石盖下面有暗室。”', 'pronoun-cue-nearby-unique-actor'],
    ['Mira', 'Mira蹲在屋顶上，长弓已拉满。她低声说：“Boss，射灭火盆。”', 'pronoun-cue-nearby-unique-actor'],
    ['Lila', 'Lila说：“井边没人。”她又低声说：“快走。”', 'pronoun-backreference'],
];
for (const [index, [speaker, text, ruleId]] of v73PronounCueCases.entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: [],
        sourceMessageIndex: 7300 + index,
        sourceMessageHash: `sha256:v73-pronoun-cue-${index}`,
        parserVersion: 'full-message-speaker-index.v73',
    });
    assert.equal(result.quoteEvidence.at(-1)?.decision?.speakerText, speaker,
        `v73 resolves a direct pronoun-plus-speech cue from its unique nearest actor: ${text}`);
    assert.equal(result.quoteEvidence.at(-1)?.decision?.ruleId, ruleId);
}

const v73AstralPronounCueText = '😀天色渐暗。艾米莉还蜷缩在祭坛旁边。她小声说：“求求你们带我回家。”';
const v73AstralPronounCueIndex = createStructuralMessageSpeakerIndex({
    fullText: v73AstralPronounCueText,
    publishedSpeakerNames: [], sourceMessageIndex: 7313,
    sourceMessageHash: 'sha256:v73-astral-pronoun-cue',
    parserVersion: 'full-message-speaker-index.v73',
});
const v73AstralPronounCueAnchor = v73AstralPronounCueIndex.anchors[0];
assert.equal(v73AstralPronounCueAnchor?.speakerText, '艾米莉');
assert.equal(Array.from(v73AstralPronounCueText).slice(
    v73AstralPronounCueAnchor.speakerSpan.start, v73AstralPronounCueAnchor.speakerSpan.end,
).join(''), '艾米莉', 'v73 attribution offsets remain code-point based after a non-BMP prefix');

for (const text of [
    '艾米莉和Lila站在祭坛旁边。她小声说：“求求你们带我回家。”',
    '墙上的报告写着：Lila蹲下检查井盖。她低声说：“石盖下面有声音。”',
]) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: [],
        sourceMessageIndex: 7310,
        sourceMessageHash: `sha256:v73-pronoun-cue-negative-${text.length}`,
        parserVersion: 'full-message-speaker-index.v73',
    });
    assert.equal(result.anchors.length, 0,
        `v73 abstains on multiple actors or written carriers: ${text}`);
}

const v73PseudoNameBlock = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa兴奋地挥舞着法杖，差点戳到Celestia的脸：“哦哦哦！我们可以利用这个！”',
    publishedSpeakerNames: [], sourceMessageIndex: 7311, sourceMessageHash: 'sha256:v73-block-pseudo-name',
    parserVersion: 'full-message-speaker-index.v73',
});
assert.notEqual(v73PseudoNameBlock.quoteEvidence[0]?.decision?.speakerText, '差点',
    'a common adverb cannot be emitted as an unrostered speaker name');

const v73ReportedInformationNotSpeaker = createStructuralMessageSpeakerIndex({
    fullText: '公爵夫人艾琳娜那边传来消息：“马库斯和艾丽西亚最近走得很近。”',
    publishedSpeakerNames: [], sourceMessageIndex: 7312, sourceMessageHash: 'sha256:v73-reported-information',
    parserVersion: 'full-message-speaker-index.v73',
});
assert.equal(v73ReportedInformationNotSpeaker.anchors.length, 0,
    'a person or place reported as the source of incoming news is not automatically its quoted speaker');

const v74RosteredSubjectCases = [
    ['Celestia翻了个白眼，将法杖推开：“拜托，我们需要精准打击。”', ['Celestia', 'Pippa'], 'Celestia'],
    ['Pippa边走边骂：“我真讨厌这种破主意。每次这么干，门后面都是一堆想咬我们屁股的怪物。”尼布抱着战利品：“我在外面等你们？”', ['Pippa', '尼布'], 'Pippa'],
    ['尼布则在门口跳脚，指着头顶尖叫：“房梁要掉了！”', ['尼布'], '尼布'],
    ['尼布探头，骂了一声：“他快倒了！”', ['尼布'], '尼布'],
    ['Celestia抬手，尼布随后骂了一声：“我早说过！”', ['Celestia', '尼布'], '尼布'],
    ['Veyra pauses, turns toward Mira, and lifts one hand: “Wait.”', ['Veyra', 'Mira'], 'Veyra'],
];
for (const [index, [text, names, speaker]] of v74RosteredSubjectCases.entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: names,
        sourceMessageIndex: 7400 + index,
        sourceMessageHash: `sha256:v74-rostered-subject-${index}`,
        parserVersion: 'full-message-speaker-index.v74',
    });
    assert.equal(result.quoteEvidence[0]?.decision?.speakerText, speaker,
        `v74 uses an exact rostered clause-head subject without requiring a verb whitelist: ${text}`);
}
const v73RosteredSubjectControl = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa边走边骂：“我真讨厌这种破主意。每次这么干，门后面都是一堆想咬我们屁股的怪物。”尼布抱着战利品：“我在外面等你们？”',
    publishedSpeakerNames: ['Pippa', '尼布'],
    sourceMessageIndex: 7409,
    sourceMessageHash: 'sha256:v73-rostered-subject-control',
    parserVersion: 'full-message-speaker-index.v73',
});
assert.notEqual(v73RosteredSubjectControl.quoteEvidence[0]?.decision?.ruleId, 'named-subject-colon-quote',
    'the v74 rostered subject inference is version-gated and does not change v73 replay behavior');

for (const [index, text] of [
    'Celestia与Pippa一起转向门口：“等等。”',
    '墙上的铭文：“北门开启。”',
    'Celestia那边传来消息：“马库斯已经离开。”',
    'Celestia停下来，守卫随后低声说：“不许进。”',
].entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: ['Celestia', 'Pippa'],
        sourceMessageIndex: 7410 + index,
        sourceMessageHash: `sha256:v74-rostered-subject-negative-${index}`,
        parserVersion: 'full-message-speaker-index.v74',
    });
    assert.equal(result.anchors.length, 0,
        `v74 abstains on coordinated subjects, written carriers, reported messages, and earlier actors before another speaker cue: ${text}`);
}

const v75ConnectivePrefixedRosteredCue = createStructuralMessageSpeakerIndex({
    fullText: 'Celestia转向门口。随后尼布低声说：“快走。”',
    publishedSpeakerNames: ['Celestia', '尼布'],
    sourceMessageIndex: 7500,
    sourceMessageHash: 'sha256:v75-connective-prefixed-rostered-cue',
});
assert.equal(v75ConnectivePrefixedRosteredCue.quoteEvidence[0]?.decision?.speakerText, '尼布',
    'a discourse connective before an exact roster name is not swallowed into the speaker label');
assert.equal(
    Array.from('Celestia转向门口。随后尼布低声说：“快走。”').slice(
        v75ConnectivePrefixedRosteredCue.quoteEvidence[0].decision.speakerSpan.start,
        v75ConnectivePrefixedRosteredCue.quoteEvidence[0].decision.speakerSpan.end,
    ).join(''),
    '尼布',
    'the selected speaker span points to the exact source name and excludes the connective',
);
const v74ConnectivePrefixedRosteredCueControl = createStructuralMessageSpeakerIndex({
    fullText: 'Celestia转向门口。随后尼布低声说：“快走。”',
    publishedSpeakerNames: ['Celestia', '尼布'],
    sourceMessageIndex: 7400,
    sourceMessageHash: 'sha256:v74-connective-prefixed-rostered-cue-control',
    parserVersion: 'full-message-speaker-index.v74',
});
assert.equal(v74ConnectivePrefixedRosteredCueControl.quoteEvidence[0]?.decision?.speakerText, '随后尼布',
    'historical v74 replay remains version-stable');

const v75AdjacentTurnsStayIndependent = createStructuralMessageSpeakerIndex({
    fullText: 'Pippa说：“等等。”尼布补充说：“快走。”',
    publishedSpeakerNames: ['Pippa', '尼布'],
    sourceMessageIndex: 7501,
    sourceMessageHash: 'sha256:v75-adjacent-turns-independent',
});
assert.deepEqual(v75AdjacentTurnsStayIndependent.quoteEvidence.map((quote) => quote.decision?.speakerText), ['Pippa', '尼布'],
    'the quote-level index keeps adjacent explicit speaker turns independent');

const v71ActionNounNegativeCases = [
    '胖商人抬手，鼻子抽了抽，皱眉道：“出来吧。”',
    '就在这时，银面具贵客轻声说：“不要动。”',
    '杯子有一道细小裂纹，早就不漏了，但Nadia一直说该扔。“快走。”',
];
for (const [index, text] of v71ActionNounNegativeCases.entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: [],
        sourceMessageIndex: 7194 + index,
        sourceMessageHash: `sha256:v71-action-noun-negative-${index}`,
        parserVersion: 'full-message-speaker-index.v71',
    });
    assert.ok(!['皱眉', '就在', '杯子有一'].includes(result.quoteEvidence[0]?.decision?.speakerText),
        `action words, connectives, and inanimate noun phrases cannot become guessed speakers: ${text}`);
}

const v71PlayerFirstPersonIndex = createStructuralMessageSpeakerIndex({
    fullText: '我扯掉盐簿手嘴里的账皮一角，冷冷道：“说，接下来哪条不蠢。”',
    publishedSpeakerNames: [], sourceMessageIndex: 7197, sourceMessageHash: 'sha256:v71-player-first-person',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.equal(v71PlayerFirstPersonIndex.quoteEvidence[0]?.decision?.speakerText, '我');
assert.equal(v71PlayerFirstPersonIndex.quoteEvidence[0]?.decision?.displaySpeakerText, '你',
    'first-person player narration uses the player display title');

const v71AnonymousFirstAppearanceIndex = createStructuralMessageSpeakerIndex({
    fullText: '一个陌生身影尖声大喊：“滚出去！”',
    publishedSpeakerNames: [], sourceMessageIndex: 7193, sourceMessageHash: 'sha256:v71-anonymous-first-appearance',
    parserVersion: 'full-message-speaker-index.v71',
});
assert.equal(v71AnonymousFirstAppearanceIndex.unresolvedDialogueSpans[0]?.reasonId, 'anonymous-first-appearance',
    'anonymous first appearances stay anonymous and are not turned into a guessed name');

const v84LocalActorQuoteCases = [
    ['瘦竹竿男皱眉：“别挡路。”', '瘦竹竿男'],
    ['蒙面贵客轻轻地点头：“可以。”', '蒙面贵客'],
    ['胖商人一听这词，脸色绿得像坏掉的豌豆汤，立刻把货单递给Pippa：“伟大的持剑先生，我建议采用非致命处理！”', '胖商人'],
    ['护卫甲也疯狂点头：“我也反省！”', '护卫甲'],
    ['打手乙则连连挥手：“我不敢了！”', '打手乙'],
];
for (const [index, [text, expected]] of v84LocalActorQuoteCases.entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: index === 2 ? ['Pippa'] : [],
        sourceMessageIndex: 8400 + index,
        sourceMessageHash: `sha256:v84-local-actor-colon-quote-${index}`,
        parserVersion: 'full-message-speaker-index.v84',
    });
    assert.equal(result.quoteEvidence[0]?.decision?.speakerText, expected,
        `V84 bounded person description or indexed unit resolves only the local actor: ${text}`);
    const span = result.quoteEvidence[0]?.decision?.speakerSpan;
    assert.equal(Array.from(text).slice(span?.start, span?.end).join(''), expected,
        'the projected title span contains only the actor, not particles or manner words');
}

const v84ConflictingFollowupActor = createStructuralMessageSpeakerIndex({
    fullText: '胖商人点头，Pippa随后转身：“快走。”',
    publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 8410,
    sourceMessageHash: 'sha256:v84-local-actor-conflicting-followup',
    parserVersion: 'full-message-speaker-index.v84',
});
assert.equal(v84ConflictingFollowupActor.quoteEvidence[0]?.decision?.speakerText, undefined,
    'a different explicit follow-up subject blocks local actor attribution');

for (const [index, text] of [
    '胖商人点头，守卫转身：“快走。”',
    '胖商人点头，他随后转身：“快走。”',
].entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: [],
        sourceMessageIndex: 8412 + index,
        sourceMessageHash: `sha256:v84-local-actor-generic-conflict-${index}`,
        parserVersion: 'full-message-speaker-index.v84',
    });
    assert.equal(result.quoteEvidence[0]?.decision?.speakerText, undefined,
        'a later generic role or pronoun acting as subject also blocks stale-speaker attribution');
}

const v84ObjectMentionDoesNotConflict = createStructuralMessageSpeakerIndex({
    fullText: '胖商人把货单递给Pippa：“请收好。”',
    publishedSpeakerNames: ['Pippa'],
    sourceMessageIndex: 8414,
    sourceMessageHash: 'sha256:v84-local-actor-object-mention',
    parserVersion: 'full-message-speaker-index.v84',
});
assert.equal(v84ObjectMentionDoesNotConflict.quoteEvidence[0]?.decision?.speakerText, '胖商人',
    'a second person mentioned only as the object/recipient does not replace the actor');

const v84LongerWordSpeechPrefixIsNotAnActionCue = createStructuralMessageSpeakerIndex({
    fullText: '瘦竹竿男说明情况：“快走。”',
    publishedSpeakerNames: [],
    sourceMessageIndex: 8415,
    sourceMessageHash: 'sha256:v84-longer-word-cue-prefix',
    parserVersion: 'full-message-speaker-index.v84',
});
assert.equal(v84LongerWordSpeechPrefixIsNotAnActionCue.quoteEvidence[0]?.decision?.speakerText, undefined,
    'a one-character cue must not match as a prefix inside a longer verb');

const v84WrittenCarrierActor = createStructuralMessageSpeakerIndex({
    fullText: '胖商人打开信件，信上写着：“货物已经运走。”',
    publishedSpeakerNames: [],
    sourceMessageIndex: 8411,
    sourceMessageHash: 'sha256:v84-local-actor-written-carrier',
    parserVersion: 'full-message-speaker-index.v84',
});
assert.equal(v84WrittenCarrierActor.quoteEvidence[0]?.decision?.speakerText, undefined,
    'an actor opening a letter does not become the quoted source');

const v85CompoundRoleCases = [
    {
        text: '门卫头目收手，朝仓内挥了挥：“进。卸到内场三号秤。拍卖半小时后开始。”',
        expected: '门卫头目',
        names: [],
    },
    {
        text: '仓库左侧两名收账鸦正在搬箱。尼布被一名路过的收账鸦盯了一眼，随后那人退开。一个收账鸦队长走来，声音闷在鸟嘴面具里：“新到押运队，三号秤验货。”',
        expected: '收账鸦队长',
        names: [],
    },
    {
        text: '星港护卫队长挥了挥手：“按计划行动。”',
        expected: '星港护卫队长',
        names: ['星港护卫'],
    },
];
for (const [index, item] of v85CompoundRoleCases.entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: item.text,
        publishedSpeakerNames: item.names,
        sourceMessageIndex: 8500 + index,
        sourceMessageHash: `sha256:v85-compound-role-${index}`,
        parserVersion: 'full-message-speaker-index.v85',
    });
    assert.equal(result.quoteEvidence[0]?.decision?.speakerText, item.expected,
        `V85 recognizes only the evidence-backed compound role: ${item.text}`);
    const span = result.quoteEvidence[0]?.decision?.speakerSpan;
    assert.equal(Array.from(item.text).slice(span?.start, span?.end).join(''), item.expected,
        'the title span excludes determiners and action text');
}

const arbitraryCompoundText = '苹果酒队长转身：“快走。”';
const arbitraryCompoundV84 = createStructuralMessageSpeakerIndex({
    fullText: arbitraryCompoundText, publishedSpeakerNames: [], sourceMessageIndex: 8509,
    sourceMessageHash: 'sha256:v84-arbitrary-compound-title-baseline', parserVersion: 'full-message-speaker-index.v84',
});
const arbitraryCompoundV85 = createStructuralMessageSpeakerIndex({
    fullText: arbitraryCompoundText, publishedSpeakerNames: [], sourceMessageIndex: 8509,
    sourceMessageHash: 'sha256:v85-arbitrary-compound-title-no-regression', parserVersion: 'full-message-speaker-index.v85',
});
assert.equal(arbitraryCompoundV85.quoteEvidence[0]?.decision?.speakerText,
    arbitraryCompoundV84.quoteEvidence[0]?.decision?.speakerText,
    'unsupported compound syntax adds no new attribution beyond the existing V84 parser');

for (const [index, text] of [
    '门卫头目收手，尼布随后转身：“快走。”',
    '尼布把门卫头目推到一旁：“快走。”',
    '门卫头目打开告示，告示写着：“临时封锁。”',
].entries()) {
    const result = createStructuralMessageSpeakerIndex({
        fullText: text,
        publishedSpeakerNames: ['尼布'],
        sourceMessageIndex: 8510 + index,
        sourceMessageHash: `sha256:v85-compound-role-negative-${index}`,
        parserVersion: 'full-message-speaker-index.v85',
    });
    assert.notEqual(result.quoteEvidence[0]?.decision?.speakerText, '门卫头目',
        `a conflicting actor, object mention, or written-source frame blocks stale compound attribution: ${index}`);
}

const competingUnrosteredCompoundRoleText = '两名收账鸦正在搬箱。收账鸦盯了一眼。两名灰狼守卫站在门口，灰狼守卫看向门口。收账鸦队长走来，灰狼队长挥了挥：“进。”';
const competingUnrosteredCompoundRoleV85 = createStructuralMessageSpeakerIndex({
    fullText: competingUnrosteredCompoundRoleText,
    publishedSpeakerNames: [],
    sourceMessageIndex: 8513,
    sourceMessageHash: 'sha256:v85-compound-role-conflicting-subject',
    parserVersion: 'full-message-speaker-index.v85',
});
assert.equal(competingUnrosteredCompoundRoleV85.quoteEvidence[0]?.decision?.speakerText, '收账鸦队长',
    'V85 retains its pre-conflict-check compound-role decision');
const competingUnrosteredCompoundRole = createStructuralMessageSpeakerIndex({
    fullText: competingUnrosteredCompoundRoleText,
    publishedSpeakerNames: [],
    sourceMessageIndex: 8513,
    sourceMessageHash: 'sha256:v86-compound-role-conflicting-subject',
    parserVersion: 'full-message-speaker-index.v86',
});
assert.notEqual(competingUnrosteredCompoundRole.quoteEvidence[0]?.decision?.speakerText, '收账鸦队长',
    'a separately evidenced compound-role actor in a later action clause blocks attribution to the earlier compound role');

console.log('sillytavern adapter and original chat bridge tests passed');

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    });
}
