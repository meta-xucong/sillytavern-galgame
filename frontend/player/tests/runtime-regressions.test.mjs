import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createPresentationPageTitleEvidence, createPresentationPageWindow, createSafePresentationDisplaySegments, createPresentationPages, createPresentationDisplaySegments, createPresentationTimelineSnapshot, createSceneContinuityTimelinePrefixHash, createStablePresentationBasePages, getPresentationSpeakerLabel, getPresentationVisualSpeakerContext, isPresentationProjectionTimelineCurrent, isPresentationTimelineSnapshotCurrent, matchesPresentationTimelineSnapshot, resolvePresentationMode, selectPresentationAnalysisMessages } from '../src/presentation-renderer.js';
import { createPresentationContextDigest, createVisibleMessageHash as hashVisibleMessage, validatePresentationAnnotationResponse } from '../../shared/src/presentation-annotation.js';
import { createPresentationBatches } from '../../shared/src/presentation-analysis-adapter.js';
import { classifyStructuralPageShape, createStructuralPageTitleEvidence, createStructuralMessageSpeakerIndex, createStructuralPageTitleEvidenceFromMessageIndex, createChatLocalObservedSpeakerNameScopes, createProbableNarrativeSpeakerTitleEvidence, createProbableQuoteSpanContinuationTitleEvidence, createVisualNovelDisplaySegments, formatVisualNovelDisplayText, isStructuralFastTitleRule } from '../../shared/src/sillytavern-adapter.js';
const source = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const rendererSource = await readFile(new URL('../src/presentation-renderer.js', import.meta.url), 'utf8');
const publicRuntime = await readFile(new URL('../../../public/game/app.js', import.meta.url), 'utf8');
const publicIndex = await readFile(new URL('../../../public/game/index.html', import.meta.url), 'utf8');
function load(name, context) {
    context.createStablePresentationBasePages ||= createStablePresentationBasePages;
    context.createPresentationPageWindow ||= createPresentationPageWindow;
    context.createPresentationPages ||= createPresentationPages;
    context.formatVisualNovelDisplayText ||= formatVisualNovelDisplayText;
    context.createVisualNovelDisplaySegments ||= createVisualNovelDisplaySegments;
    context.getManifestKnownVisualSpeakers ||= () => [];
    context.getPublishedStructuralSpeakerNames ||= () => [];
    context.getChatLocalObservedStructuralSpeakerNames ||= () => [];
    context.getStructuralSpeakerNamesForSnapshot ||= () => context.getPublishedStructuralSpeakerNames();
    context.createChatLocalObservedSpeakerNameScopes ||= createChatLocalObservedSpeakerNameScopes;
    context.presentationChatObservedSpeakerNames ||= new WeakMap();
    context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION ||= 'full-message-speaker-index.v24';
    context.classifyStructuralPageShape ||= classifyStructuralPageShape;
    context.structuralSpeakerNamesFingerprint ||= () => '[]';
    context.getMainCharacterName ||= () => '';
    context.PRESENTATION_PAGE_ANALYSIS_MAX_FULL_MESSAGE_CODE_POINTS ||= 6_000;
    context.PRESENTATION_PAGE_ANALYSIS_MAX_FULL_PAGES ||= 8;
    context.PRESENTATION_LIMITS ||= { maxMessageCodePoints: 6000 };
    context.shouldUsePresentationPageWindow ||= (value, pages) => Array.from(String(value || '')).length > context.PRESENTATION_PAGE_ANALYSIS_MAX_FULL_MESSAGE_CODE_POINTS
        || (Array.isArray(pages) && pages.length > context.PRESENTATION_PAGE_ANALYSIS_MAX_FULL_PAGES);
    if (name === 'createPresentationPagesForMessage' && !context.shouldUseStructuralHeadingTitle) {
        load('shouldUseStructuralHeadingTitle', context);
    }
    if (name === 'analyzePresentationSnapshot' && !context.createPresentationPagesForMessage) {
        context.presentationStructuralPageTitles ||= new Map();
        context.presentationStructuralTitleInflight ||= new Map();
        context.presentationPageAnnotations ||= new Map();
        context.presentationPageAnalysisContextDigests ||= new Map();
        context.getPresentationSpeakerLabel ||= getPresentationSpeakerLabel;
        context.getAssistedPresentationSegments ||= () => null;
        context.getCurrentPresentationPageSegment ||= () => null;
        for (const helper of ['samePresentationSpan', 'hasCoarseNarrationPageTitle', 'structuralPageTitleMemoryKey', 'getStructuralPageTitleMemo']) {
            if (!context[helper]) load(helper, context);
        }
        context.createPresentationPagesForMessage = load('createPresentationPagesForMessage', context);
    }
    let start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing production function ${name}`);
    if (source.slice(start - 6, start) === 'async ') start -= 6;
    const next = /\n(?:export )?(?:async )?function /u.exec(source.slice(start + 1));
    const end = next ? start + 1 + next.index : source.length;
    let body = source.slice(start, end);
    return context[name] = vm.runInContext(`(${body}\n)`, context);
}
function createOriginalSourcePages(text, role, sourceMessageIndex, fallbackSpeaker = '') {
    const sourceText = formatVisualNovelDisplayText(text);
    const segments = createVisualNovelDisplaySegments(text, { role, fallbackSpeaker, knownSpeakers: [] }).map((segment) => ({
        ...segment,
        sourceMessageIndex: segment.sourceMessageIndex ?? sourceMessageIndex,
        sourceMessageHash: segment.sourceMessageHash || '',
    }));
    const nonEmptySegments = segments.length ? segments : [{
        index: 0,
        type: role === 'player' ? 'player' : 'narration',
        speaker: role === 'player' ? '你' : fallbackSpeaker || '旁白',
        text,
        sourceMessageIndex,
    }];
    return {
        sourceText,
        pages: nonEmptySegments,
    };
}
function speakerContext(segment) {
    const context = vm.createContext({ activeRenderContext: {}, activeMessageIndex: 7,
        activeMessageSegments: [segment], activeSegmentIndex: 0,
        getPresentationVisualSpeakerContext,
    });
    return load('getActiveVisualSpeakerContext', context);
}

await test('public page-title analysis shares the canonical active-message controller and cache-busted assets', () => {
    assert.doesNotMatch(publicRuntime, /scheduleCurrentPresentationPageAnalysis|presentationPageAnalysisController|presentationPageAnalysisRunIdentity/u,
        'public runtime must not keep a second page-only controller that races complete annotation');
    assert.match(publicRuntime, /await analyzeCurrentPresentationPageWindow\(/u,
        'public active-message analysis owns the current page-window request');
    assert.match(publicRuntime, /pageIndex: activeSegmentIndex/u,
        'public render passes the settled page cursor into the shared analysis run');
    assert.match(publicRuntime, /contextMessages: resolvedContext/u,
        'short singleton analysis retains its existing bounded prior-character context');
    const buildVersion = publicIndex.match(/\.\/app\.js\?v=([^"']+)/u)?.[1];
    assert.ok(buildVersion, 'public entry point has a build-versioned player bundle');
    assert.ok(publicRuntime.includes(`presentation-renderer.js?v=${buildVersion}`),
        'public app and renderer cache versions advance together');
});

async function createLongPageAnalysisHarness({ deferAnnotation = false, corruptCachedAnnotation = false,
    responseKind = 'dialogue' } = {}) {
    const paragraphs = Array.from({ length: 12 }, (_, index) => index === 10
        ? 'Alice: 这是紧邻前页。'
        : index === 11 ? '续言😀这是当前页。' : `旧段落 ${index}。`);
    const text = paragraphs.join('\n\n');
    const snapshot = { fileName: 'page-window-chat', messages: [{ role: 'character', index: 47, speaker: 'Author', text }] };
    const { sourceText, pages } = createOriginalSourcePages(text, 'character', 47, 'Author');
    const pageIndex = 11;
    const pageWindow = createPresentationPageWindow({ sourceText, pages, pageIndex, lookbehindPages: 1 });
    const expectedFullHash = await hashVisibleMessage(sourceText);
    const requests = [];
    const cacheKeys = [];
    const cachePuts = [];
    const cacheDeletes = [];
    let cacheValue = null;
    let annotationResolve = null;
    let pageAnalyzeCalls = 0;
    let fullAnalyzeCalls = 0;
    let rendered = null;
    let renderedCount = 0;
    let cacheReads = 0;
    let freshValidation = false;

    const makeAnnotation = (requestMessage) => {
        const chars = Array.from(requestMessage.visibleText);
        const speakerStart = chars.join('').indexOf('Alice');
        const speakerEnd = speakerStart + Array.from('Alice').length;
        const coreStart = Array.from(pageWindow.viewText).length - Array.from(pageWindow.coreText).length;
        const result = {
            sourceMessageIndex: requestMessage.sourceMessageIndex,
            sourceMessageHash: requestMessage.sourceMessageHash,
            segments: [{ start: 0, end: chars.length, textHash: requestMessage.sourceMessageHash, kind: responseKind,
                speakerMentionRef: responseKind === 'dialogue' ? 'm0' : null,
                speakerSource: responseKind === 'dialogue' ? 'text-explicit' : 'none',
                confidenceBand: responseKind === 'dialogue' ? 'high' : 'medium',
                evidenceSpans: [
                    { start: coreStart, end: chars.length, purpose: 'classification' },
                    ...(responseKind === 'dialogue' ? [{ start: speakerStart, end: speakerEnd, purpose: 'speaker' }] : []),
                ] }],
            entities: responseKind === 'dialogue'
                ? [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: speakerStart, end: speakerEnd }, attributeEvidence: [] }]
                : [],
            identityLinkCandidates: [], stateClaims: [],
        };
        return result;
    };
    const currentViewHash = await hashVisibleMessage(pageWindow.viewText);
    cacheValue = corruptCachedAnnotation ? { ...makeAnnotation({ sourceMessageIndex: 47, sourceMessageHash: currentViewHash, visibleText: pageWindow.viewText }), sourceMessageIndex: 999 } : null;
    const context = vm.createContext({
        AbortController, Date,
        manifest: { locale: 'zh-CN', releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', defaultArcId: 'arc', resourceBindings: { characters: {} } },
        release: { releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', activeArcId: 'arc' },
        presentationServiceState: true, presentationServiceRetryAt: 0, presentationAnalyzerScope: 'scope-v1',
        presentationAnalysisEpoch: 0, presentationAnalysisController: null, presentationAnalysisRunIdentity: null, presentationInflight: new Set(),
        activeChatSnapshot: snapshot, activeMessageIndex: 0, activeSegmentIndex: pageIndex,
        presentationPageAnnotations: new Map(), presentationPageAnalysisContextDigests: new Map(),
        presentationStructuralPageTitles: new Map(), presentationStructuralTitleInflight: new Map(),
        presentationAnnotations: new Map(), presentationProjectionStates: new Map(),
        presentationCache: {
            get: async (key) => { cacheReads += 1; cacheKeys.push(key); return cacheValue; },
            delete: async (key) => { cacheDeletes.push(key); cacheValue = null; return true; },
            put: async (...args) => { cachePuts.push(args); },
        },
        presentationAnalysis: {
            healthCheck: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'scope-v1' }),
            annotate: async ({ request, signal }) => {
                requests.push(request);
                if (request.messages[0]?.visibleText !== pageWindow.viewText) {
                    fullAnalyzeCalls += 1;
                    return [];
                }
                pageAnalyzeCalls += 1;
                assert.equal(request.contextMessages.length, 0, 'page requests do not carry unrelated full historical messages');
                assert.equal(request.messages.length, 1, 'one active page-window target is analyzed');
                if (deferAnnotation) return await new Promise((resolve) => { annotationResolve = resolve; });
                const annotation = makeAnnotation(request.messages[0]);
                const validation = await validatePresentationAnnotationResponse({ schemaVersion: 'galgame.presentation-annotation.v1', results: [annotation] }, request);
                freshValidation = validation.valid;
                assert.equal(validation.valid, true, `mock result satisfies Annotation v1: ${validation.errors.join(', ')}`);
                return [annotation];
            },
        },
        createPublishedPresentationKnownEntities: async () => ({ diagnostics: [], knownEntities: [] }),
        createPresentationContextDigest,
        validatePresentationAnnotationResponse,
        createPresentationBatches,
        createVisibleMessageHash: hashVisibleMessage,
        sha256Hex: async (value) => `digest-${value}`,
        createSceneContinuityTimelinePrefixHash,
        createPresentationTimelineSnapshot,
        matchesPresentationTimelineSnapshot,
        createStablePresentationBasePages,
        createPresentationPageWindow,
        createPresentationPageTitleEvidence,
        createStructuralPageTitleEvidence,
        getAssistedPresentationSegments: () => null,
        createSafePresentationDisplaySegments,
        createPresentationPages,
        createPresentationDisplaySegments,
        formatVisualNovelDisplayText,
        shouldUsePresentationPageWindow: (value, basePages) => Array.from(value).length > 10 || basePages.length > 8,
        PRESENTATION_PAGE_ANALYSIS_MAX_FULL_MESSAGE_CODE_POINTS: 10,
        PRESENTATION_PAGE_ANALYSIS_MAX_FULL_PAGES: 8,
        PRESENTATION_PAGE_WINDOW_CACHE_VERSION: 'galgame.presentation-page-cache.v1',
        PRESENTATION_PAGE_WINDOW_PROVENANCE: 'current-page-window.v1',
        PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
        PRESENTATION_ANNOTATION_VERSION: 'galgame.presentation-annotation.v1',
        PRESENTATION_IDENTITY_PROJECTION_VERSION: 'galgame.identity-projection.v1',
        PRESENTATION_ROSTER_PROJECTION_VERSION: 'galgame.roster-projection.v1',
        PRESENTATION_LIMITS: { maxMessageCodePoints: 6000 },
        createPresentationContextDigest,
        resolvePresentationMode,
        getPresentationSpeakerLabel,
        getPresentationVisualSpeakerContext,
        isPresentationTimelineSnapshotCurrent,
        selectPresentationAnalysisMessages,
        renderChatSnapshot: (renderedSnapshot, options) => {
            renderedCount += 1;
            const message = renderedSnapshot.messages[options.messageIndex];
            const pages = context.createPresentationPagesForMessage(renderedSnapshot, options.messageIndex, message, options.pageIndex).pages;
            const page = pages[options.pageIndex];
            rendered = {
                page,
                label: getPresentationSpeakerLabel(page, message),
                visual: getPresentationVisualSpeakerContext(page, message),
            };
        },
        canonicalJson: () => '{}',
    });
    load('hasCoarseNarrationPageTitle', context);
    for (const name of ['currentPresentationScenarioId', 'currentPresentationScenarioVersion', 'presentationKnownEntitiesSourceFingerprint',
        'presentationProjectionScope', 'presentationPageAnnotationMemoryKey', 'presentationCacheKey', 'getCurrentPresentationPageSegment',
        'presentationPageWindowCacheKey', 'structuralPageTitleMemoryKey', 'getStructuralPageTitleMemo',
        'samePresentationSpan', 'isCurrentRenderedPresentationPageSpan', 'shouldUsePresentationPageWindow', 'createPresentationPagesForMessage',
        'analyzeCurrentPresentationPageWindow', 'isPresentationAnalysisSnapshotCurrent', 'analyzePresentationSnapshot']) load(name, context);
    return { context, snapshot, text, sourceText, pages, pageIndex, pageWindow, expectedFullHash, requests, cacheKeys, cachePuts, cacheDeletes,
        get analyzeCalls() { return pageAnalyzeCalls; }, get fullAnalyzeCalls() { return fullAnalyzeCalls; }, get rendered() { return rendered; }, get renderedCount() { return renderedCount; },
        get cacheReads() { return cacheReads; }, get freshValidation() { return freshValidation; },
        resolveAnnotation: (request) => annotationResolve?.([makeAnnotation(request.messages[0])]),
    };
}

function createStructuralFastTitleHarness({ deferHash = false, text = 'Celestia说：“我们走。”', semanticSegments = null, pageSpans = null, pageType = 'unknown', productionSegments = false, priorTexts = [], boundWorldbookCandidates = [], parserVersion = 'full-message-speaker-index.v24' } = {}) {
    const messages = [
        ...priorTexts.map((priorText, index) => ({ role: 'character', index: index + 50, text: priorText })),
        { role: 'character', index: priorTexts.length + 50, text },
    ];
    const targetMessageIndex = messages.length - 1;
    const snapshot = { fileName: 'structural-title-chat', messages };
    let hashResolve = null;
    let hashCalls = 0;
    let renderCount = 0;
    const context = vm.createContext({
        manifest: { locale: 'zh-CN', resourceBindings: { characters: {} } }, release: null,
        presentationProjectionStates: new Map(), presentationStructuralPageTitles: new Map(), presentationStructuralMessageIndexes: new Map(),
        presentationStructuralTitleInflight: new Map(), presentationChatObservedSpeakerNames: new WeakMap(),
        speakerCandidateAdapter: { getBoundWorldbookCandidates: async () => ({ candidateSpeakerNames: boundWorldbookCandidates }) },
        STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION: parserVersion,
        presentationProjectionScope: () => 'structural-title-scope', presentationKnownEntitiesSourceFingerprint: () => '{}',
        canonicalJson: (value) => JSON.stringify(value), getAssistedPresentationSegments: () => semanticSegments,
        activeChatSnapshot: snapshot, activeMessageIndex: targetMessageIndex, activeSegmentIndex: 0,
        activeMessageSegments: [], activeRenderContext: { message: snapshot.messages[targetMessageIndex] },
        ui: { speakerName: { textContent: '' }, dialogueText: { textContent: text } },
        getDisplayedSpeakerName: (segment, message) => getPresentationSpeakerLabel(segment, message),
        applySegmentPresentation: () => {},
        crypto: globalThis.crypto,
        TextEncoder,
        formatVisualNovelDisplayText, createStablePresentationBasePages, createVisualNovelDisplaySegments, createPresentationPageWindow,
        createChatLocalObservedSpeakerNameScopes,
        createSafePresentationDisplaySegments, createPresentationPages, createStructuralPageTitleEvidence,
        createStructuralMessageSpeakerIndex, createStructuralPageTitleEvidenceFromMessageIndex, classifyStructuralPageShape,
        createProbableNarrativeSpeakerTitleEvidence,
        createProbableQuoteSpanContinuationTitleEvidence,
        getPresentationSpeakerLabel, resolvePresentationMode: () => 'assisted',
        isStructuralFastTitleRule,
        shouldUsePresentationPageWindow: () => false,
        createVisibleMessageHash: deferHash ? () => {
            hashCalls += 1;
            return new Promise((resolve) => { hashResolve = resolve; });
        } : hashVisibleMessage,
        renderActiveDialogueSegment: () => {
            renderCount += 1;
        },
    });
    context.createVisualNovelDisplaySegments = (value) => {
        if (productionSegments) return createVisualNovelDisplaySegments(value, { role: 'character', knownSpeakers: ['Pippa'] });
        const chars = Array.from(String(value));
        const spans = pageSpans || [{ start: 0, end: chars.length }];
        return spans.map((sourceSpan, index) => ({ index, type: pageType, speaker: pageType === 'narration' ? '旁白' : '未识别',
            ...(pageType === 'unknown' ? { identityRef: { type: 'unknown' } } : {}), text: chars.slice(sourceSpan.start, sourceSpan.end).join(''),
            sourceText: chars.slice(sourceSpan.start, sourceSpan.end).join(''), sourceSpan }));
    };
    load('hasCoarseNarrationPageTitle', context);
    load('hasStructuralQuoteCue', context);
    for (const name of ['structuralPageTitleMemoryKey', 'getStructuralPageTitleMemo', 'samePresentationSpan',
        'hasAuthoritativePageTitle', 'shouldUseStructuralHeadingTitle', 'isFastStructuralRule', 'buildStructuralPresentationPageTitle',
        'structuralMessageIndexMemoryKey', 'structuralSpeakerNamesFingerprint', 'isExactStructuralMessagePageEvidence',
        'structuralSpeakerCandidateRequestScope', 'structuralSpeakerCandidateSourceFingerprint',
        'shouldRetryPageTitleWithBoundCandidates', 'applyStructuralTitleMemoToPages', 'updateActiveStructuralTitle',
        'isValidPresentationEvidenceSpan', 'isExactSourceEvidenceSpan',
        'createPresentationPagesForMessage', 'createStructuralContinuationEvidenceFromAnnotation',
        'isCurrentStructuralTitleTarget', 'getPublishedStructuralSpeakerNames', 'getChatLocalObservedStructuralSpeakerNames',
        'getStructuralSpeakerNamesForSnapshot', 'ensureStructuralPresentationPageTitle']) load(name, context);
    return { context, snapshot, text, targetMessageIndex, get renderCount() { return renderCount; }, get hashCalls() { return hashCalls; }, resolveHash: (value) => hashResolve?.(value) };
}

await test('explicit structured speaker title appears after local hash validation without changing identity', async () => {
    const harness = createStructuralFastTitleHarness();
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, 'Celestia');
    assert.equal(harness.renderCount, 0, 'title refresh does not restart or complete body typewriter rendering');
    assert.equal(harness.context.ui.dialogueText.textContent, harness.text);
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.type, 'unknown');
    assert.deepEqual(page.identityRef, { type: 'unknown' });
    assert.equal(page.text, harness.text);
    assert.equal(page.pageTitleEvidence.ruleId, 'quoted-attribution');
});

await test('explicit Durik roar overrides semantic unknown before worldbook candidates resolve', async () => {
    const text = 'Durik咆哮："老子挡住他们！Boss专心封印！"';
    const basePage = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: [] })[0];
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = [{
        index: 0,
        type: 'unattributed-dialogue',
        speaker: '未识别',
        identityRef: { type: 'unknown' },
        text: basePage.text,
        sourceText: basePage.sourceText,
        sourceSpan: basePage.sourceSpan,
        sourceMessageIndex: 50,
        sourceMessageHash,
    }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, productionSegments: true });
    let worldbookReads = 0;
    harness.context.speakerCandidateAdapter.getBoundWorldbookCandidates = () => {
        worldbookReads += 1;
        return new Promise(() => {});
    };

    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);

    assert.equal(harness.context.ui.speakerName.textContent, 'Durik');
    assert.equal(worldbookReads, 0, 'complete local speech evidence does not wait for optional worldbook lookup');
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.semanticPresentation.type, 'unattributed-dialogue', 'title projection does not rewrite semantic classification');
    assert.equal(page.pageTitleEvidence.ruleId, 'quoted-attribution');
    assert.equal(page.text, text);
    assert.deepEqual(page.sourceSpan, basePage.sourceSpan);
});

await test('explicit dash speech evidence titles a semantic narration page without changing its body or role', async () => {
    const text = '—Timmy站在 Bubbles 身后，清楚地说。 “你还在。”';
    const chars = Array.from(text);
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = [{
        index: 0,
        type: 'narration',
        speaker: '旁白',
        text,
        sourceText: text,
        sourceSpan: { start: 0, end: chars.length },
        sourceMessageIndex: 50,
        sourceMessageHash,
    }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, pageType: 'narration',
        parserVersion: 'full-message-speaker-index.v86' });

    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);

    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.pageTitleEvidence?.ruleId, 'dashed-explicit-speech-cue');
    assert.equal(harness.context.ui.speakerName.textContent, 'Timmy');
    assert.equal(page.type, 'narration');
    assert.equal(page.semanticPresentation.type, 'narration');
    assert.deepEqual(page.sourceSpan, { start: 0, end: chars.length });
    assert.equal(page.text, text);
});

await test('exact structural speaker title overrides semantic narration without changing page semantics', async () => {
    const text = '烛火在窗边摇曳，雨声渐渐远去。Pippa说：“我们现在出发。”她收起地图，推开了门。';
    const chars = Array.from(text);
    const semanticSegments = [{
        index: 0,
        type: 'narration',
        speaker: '旁白',
        text,
        sourceText: text,
        sourceSpan: { start: 0, end: chars.length },
        sourceMessageIndex: 50,
        sourceMessageHash: await hashVisibleMessage(text),
    }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, pageType: 'narration' });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);

    const page = harness.context.activeMessageSegments[0];
    assert.equal(harness.context.ui.speakerName.textContent, 'Pippa');
    assert.equal(page.type, 'narration');
    assert.equal(page.semanticPresentation.type, 'narration');
    assert.equal(page.identityRef, undefined);
    assert.equal(page.text, text);
    assert.deepEqual(page.sourceSpan, { start: 0, end: chars.length });
    assert.equal(page.pageTitleEvidence.ruleId, 'quoted-attribution');
    assert.equal(getPresentationVisualSpeakerContext(page, harness.snapshot.messages[0]).role, 'narrator');
});

await test('parser rule contract includes named-subject quote titles through every projection gate', async () => {
    const text = '维克多展开账本："Boss，近期所有收获汇总——';
    const chars = Array.from(text);
    const semanticSegments = [{
        index: 0,
        type: 'narration',
        speaker: '旁白',
        text,
        sourceText: text,
        sourceSpan: { start: 0, end: chars.length },
        sourceMessageIndex: 50,
        sourceMessageHash: await hashVisibleMessage(text),
    }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, pageType: 'narration',
        parserVersion: 'full-message-speaker-index.v86' });
    let worldbookReads = 0;
    harness.context.speakerCandidateAdapter.getBoundWorldbookCandidates = async () => {
        worldbookReads += 1;
        return { candidateSpeakerNames: [] };
    };
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);

    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.pageTitleEvidence?.ruleId, 'named-subject-colon-quote');
    assert.equal(worldbookReads, 1, 'rank-1 structural attribution still follows the bound-candidate path');
    assert.equal(harness.context.ui.speakerName.textContent, '维克多');
    assert.equal(page.semanticPresentation.type, 'narration');
    assert.equal(page.type, 'narration');
    assert.equal(page.text, text);
    assert.equal(page.sourceSpan.end, chars.length);
});

await test('an unattributed quote on a narration page does not gain an invented speaker title', async () => {
    const text = '雨声敲打着窗沿。“我们现在出发。”夜色仍笼罩着街道。';
    const chars = Array.from(text);
    const semanticSegments = [{
        index: 0,
        type: 'narration',
        speaker: '旁白',
        text,
        sourceText: text,
        sourceSpan: { start: 0, end: chars.length },
        sourceMessageIndex: 50,
        sourceMessageHash: await hashVisibleMessage(text),
    }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, pageType: 'narration' });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);

    const page = harness.context.activeMessageSegments[0];
    assert.equal(harness.context.ui.speakerName.textContent, '旁白');
    assert.equal(page.type, 'narration');
    assert.equal(page.semanticPresentation.type, 'narration');
    assert.equal(page.identityRef, undefined);
    assert.equal(page.text, text);
    assert.deepEqual(page.sourceSpan, { start: 0, end: chars.length });
});

await test('bound worldbook candidate names are supplied to title parsing without assigning identity', async () => {
    const text = 'Celestia：我们走。';
    const harness = createStructuralFastTitleHarness({ text, boundWorldbookCandidates: ['Celestia'] });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, 'Celestia');
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.pageTitleEvidence?.kind, 'speaker');
    assert.equal(page.pageTitleEvidence?.text, 'Celestia');
    assert.equal(harness.context.getStructuralPageTitleMemo(
        harness.snapshot, harness.snapshot.messages[0].index, 0, text, page, 0, ['Celestia'],
    )?.pageTitleEvidence?.text, 'Celestia', 'memo is retrievable with the candidate fingerprint used when it was written');
    assert.equal(harness.context.getStructuralPageTitleMemo(
        harness.snapshot, harness.snapshot.messages[0].index, 0, text, page, 0,
    ), null, 'a candidate title is not exposed through a name scope that lacks its bound candidates');
    assert.deepEqual(page.identityRef, { type: 'unknown' });
    assert.equal(page.type, 'unknown');
    assert.equal(page.text, text);
});

await test('player reuses repeated explicit speaker names only within the current chat display sidecar', async () => {
    const priorTexts = ['Pippa说：“我看到线索了。”', 'Pippa回答：“在账本里。”'];
    const text = 'Pippa翻开账本：“这里有线索。”';
    const harness = createStructuralFastTitleHarness({ text, priorTexts });
    const targetIndex = harness.targetMessageIndex;
    assert.deepEqual(Array.from(harness.context.getStructuralSpeakerNamesForSnapshot(harness.snapshot)), ['Pippa']);
    await harness.context.ensureStructuralPresentationPageTitle(
        harness.snapshot, targetIndex, harness.snapshot.messages[targetIndex], 0,
    );
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page?.pageTitleEvidence?.ruleId, 'rostered-subject-quoted-clause');
    assert.equal(harness.context.ui.speakerName.textContent, 'Pippa');
    assert.equal(page.type, 'unknown', 'the speaker roster does not rewrite the SillyTavern-derived segment type');
    assert.deepEqual(page.identityRef, { type: 'unknown' }, 'chat-local evidence does not create persistent identity');
    assert.equal(page.text, text, 'the body stays byte-for-byte the same');
    assert.equal(page.pageTitleEvidence.ruleId, 'rostered-subject-quoted-clause');
});

await test('player does not use future-message speaker anchors to retitle earlier pages', async () => {
    const harness = createStructuralFastTitleHarness({ text: '她翻开账本：“这里有线索。”' });
    harness.snapshot.messages.push(
        { role: 'character', index: 80, text: 'Pippa说：“先看这里。”' },
        { role: 'character', index: 81, text: 'Pippa回答：“我明白了。”' },
    );
    assert.deepEqual(Array.from(harness.context.getStructuralSpeakerNamesForSnapshot(harness.snapshot, 0)), [],
        'the current page starts with an empty prior-message speaker scope');
    assert.deepEqual(Array.from(harness.context.getStructuralSpeakerNamesForSnapshot(harness.snapshot, 2)), [],
        'one earlier explicit anchor is insufficient');
    assert.deepEqual(Array.from(harness.context.getStructuralSpeakerNamesForSnapshot(harness.snapshot, 3)), ['Pippa'],
        'two earlier messages establish the name for later pages');
});

await test('full-message evidence titles the exact continuation page without inheriting a prior-page label', async () => {
    const text = 'Lila说：“先等我听见脚步声了，然后我们再进去。”';
    const splitAt = Array.from('Lila说：“先等我').length;
    const length = Array.from(text).length;
    const harness = createStructuralFastTitleHarness({
        text,
        pageSpans: [{ start: 0, end: splitAt }, { start: splitAt, end: length }],
    });
    harness.context.activeSegmentIndex = 1;
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 1);
    assert.equal(harness.context.ui.speakerName.textContent, 'Lila');
    const page = harness.context.activeMessageSegments[1];
    assert.equal(page.pageTitleEvidence.ruleId, 'full-message-structural');
    assert.deepEqual(page.sourceSpan, { start: splitAt, end: length });
    assert.ok(page.pageTitleEvidence.speakers[0].start < splitAt);
    assert.deepEqual(page.pageTitleEvidence.classificationEvidenceSpans, [{ start: splitAt, end: length - 1 }]);
    assert.equal(page.type, 'unknown');
    assert.deepEqual(page.identityRef, { type: 'unknown' });
    assert.equal(page.text, Array.from(text).slice(splitAt).join(''));
    assert.equal(harness.context.presentationStructuralMessageIndexes.size, 1, 'the full message is indexed once and memoized in memory');
});

await test('unattributed quoted speech uses narrator display fallback without changing the base page', async () => {
    const text = '“快走，别回头。”';
    const harness = createStructuralFastTitleHarness({ text, productionSegments: true });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '旁白');
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.type, 'unattributed-dialogue', 'the existing source page classification is preserved');
    assert.equal(page.pageTitleEvidence.classification, 'narration');
    assert.equal(page.pageTitleEvidence.ruleId, 'narrative-framed-quote');
    assert.equal(page.pageTitleEvidence.diagnosticReasonId, 'no-unique-speaker-evidence');
    assert.deepEqual(page.identityRef, { type: 'unknown' }, 'display fallback does not create a speaker identity');
    assert.equal(page.text, text, 'display fallback does not rewrite body text');
});

await test('plain unquoted RPG prose gets a fast narration title without becoming narrator identity', async () => {
    const text = '你带着核心队伍——Pippa、Celestia、Durik、莉娅、瑞恩——前往Grand Harbor冒险者工会总部。';
    const harness = createStructuralFastTitleHarness({ text });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '旁白');
    const page = harness.context.activeMessageSegments[0];
    assert.equal(page.type, 'unknown', 'coarse title classification does not rewrite the semantic segment');
    assert.deepEqual(page.identityRef, { type: 'unknown' }, 'narration title does not create a narrator identity');
    assert.equal(page.text, text, 'narration title does not rewrite source text');
    assert.equal(page.pageTitleEvidence.ruleId, 'plain-prose-narration');
});

await test('production shape sidecars label record and heading pages without changing page bodies or identity', async () => {
    for (const [text, expectedTitle, expectedRule] of [
        ['HP: 12\nAC: 16', '旁白', 'structural-record-shape'],
        ['# 神罚仪式', '标题', 'structural-heading-shape'],
    ]) {
        const harness = createStructuralFastTitleHarness({ text });
        await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
        const page = harness.context.activeMessageSegments[0];
        assert.equal(harness.context.ui.speakerName.textContent, expectedTitle);
        assert.equal(page.pageTitleEvidence.ruleId, expectedRule);
        assert.equal(page.text, text, 'shape classification leaves source page text intact');
        assert.deepEqual(page.identityRef, { type: 'unknown' }, 'shape title does not create a speaker or narrator identity');
    }
});

await test('first-page headings remain titled when semantic overlays say narration, other-visible, or unattributed-dialogue', async () => {
    const text = '治疗与审问：格雷戈的情报';
    const length = Array.from(text).length;
    for (const semanticType of ['narration', 'other-visible', 'unattributed-dialogue']) {
        const semanticSegments = [{ index: 0, type: semanticType,
            speaker: semanticType === 'narration' ? '旁白' : '', identityRef: { type: 'unknown' },
            text, sourceText: text, sourceSpan: { start: 0, end: length },
            sourceMessageIndex: 54, sourceMessageHash: 'sha256:heading-semantic-overlay' }];
        const harness = createStructuralFastTitleHarness({ text, semanticSegments });
        await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
        assert.equal(harness.context.ui.speakerName.textContent, '标题',
            `structural heading wins the display label over semantic ${semanticType}`);
        const page = harness.context.createPresentationPagesForMessage(harness.snapshot, 0, harness.snapshot.messages[0], 0).pages[0];
        assert.equal(page.semanticPresentation.type, semanticType, 'semantic annotation remains unchanged');
        assert.equal(page.pageTitleEvidence?.ruleId, 'structural-heading-shape');
        assert.deepEqual(page.identityRef, { type: 'unknown' }, 'heading display does not assign a visual identity');
        assert.equal(page.text, text, 'heading integration does not alter the source page body');
    }
});

await test('semantic unattributed dialogue blocks the coarse plain-prose narration title', async () => {
    const text = 'Celestia：我们走。';
    const length = Array.from(text).length;
    const semanticSegments = [{ index: 0, type: 'unattributed-dialogue', speaker: '未识别',
        identityRef: { type: 'unknown' }, text, sourceText: text,
        sourceSpan: { start: 0, end: length }, sourceMessageIndex: 54, sourceMessageHash: 'sha256:semantic-test' }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '');
    const page = harness.context.createPresentationPagesForMessage(harness.snapshot, 0, harness.snapshot.messages[0], 0).pages[0];
    assert.equal(page.type, 'unknown', 'semantic classification does not rewrite the body-page type');
    assert.equal(page.semanticPresentation.type, 'unattributed-dialogue', 'the title classification stays in its separate metadata field');
    assert.equal(getPresentationSpeakerLabel(page, harness.snapshot.messages[0]), '未识别');
    assert.equal(harness.context.presentationStructuralPageTitles.size, 0);
});

await test('complete structural attribution supplies only the title over semantic unknown', async () => {
    const text = 'Celestia兴奋地说：“我们走。” 她把《旧王冠》称作“沉睡的月亮”。';
    const length = Array.from(text).length;
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = [{ index: 0, type: 'unattributed-dialogue', speaker: '未识别',
        identityRef: { type: 'unknown' }, text, sourceText: text,
        sourceSpan: { start: 0, end: length }, sourceMessageIndex: 54, sourceMessageHash }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    const page = harness.context.createPresentationPagesForMessage(harness.snapshot, 0, harness.snapshot.messages[0], 0).pages[0];
    assert.equal(getPresentationSpeakerLabel(page, harness.snapshot.messages[0]), 'Celestia');
    assert.equal(page.semanticPresentation.type, 'unattributed-dialogue', 'semantic classification remains unchanged');
    assert.deepEqual(page.identityRef, { type: 'unknown' }, 'display title does not create a character identity');
    assert.equal(getPresentationVisualSpeakerContext(page, harness.snapshot.messages[0]).role, 'unknown', 'unknown visual routing is preserved');
    assert.equal(page.text, text, 'body text remains byte-for-byte intact');
});

await test('semantic dialogue invalidates a previously memoized coarse narration title', async () => {
    const text = '新来的旅人走进了大厅，公会成员纷纷转头看向她。';
    const harness = createStructuralFastTitleHarness({ text });
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '旁白');
    assert.equal(harness.context.presentationStructuralPageTitles.size, 1);

    const length = Array.from(text).length;
    const semanticSegments = [{ index: 0, type: 'unattributed-dialogue', speaker: '未识别',
        identityRef: { type: 'unknown' }, text, sourceText: text,
        sourceSpan: { start: 0, end: length }, sourceMessageIndex: 54, sourceMessageHash: 'sha256:semantic-test' }];
    harness.context.getAssistedPresentationSegments = () => semanticSegments;
    harness.context.activeMessageSegments = harness.context.createPresentationPagesForMessage(
        harness.snapshot, 0, harness.snapshot.messages[0], 0,
    ).pages;
    harness.context.ui.speakerName.textContent = '未识别';
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '未识别');
    assert.equal(harness.context.presentationStructuralPageTitles.size, 0,
        'a semantic dialogue classification removes stale plain-prose title evidence');
});

await test('structural title memo is bound to the current cast fingerprint and parser version', () => {
    const harness = createStructuralFastTitleHarness();
    const { context, snapshot, text } = harness;
    let cast = ['Celestia'];
    context.getManifestKnownVisualSpeakers = () => cast.map((name) => ({ name }));
    context.canonicalJson = (value) => JSON.stringify(value);
    const span = { start: 0, end: Array.from(text).length };
    const page = { sourceSpan: span, type: 'unknown' };
    const parserVersion = context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION;
    const fingerprint = context.structuralSpeakerNamesFingerprint();
    const key = context.structuralPageTitleMemoryKey(snapshot, 54, 0, span, 0, fingerprint, parserVersion);
    const sourceMessageHash = 'sha256:scope-bound-title';
    const memo = {
        sourceText: text, sourceMessageIndex: 54, sourceMessageHash, sourceSpan: span,
        viewSpan: span, publishedSpeakerFingerprint: fingerprint, parserVersion,
        pageTitleEvidence: {
            sourceMessageIndex: 54, sourceMessageHash, coreSpan: span, viewSpan: span,
            kind: 'speaker', text: 'Celestia', speakers: [], ruleId: 'quoted-attribution',
        },
    };
    context.presentationStructuralPageTitles.set(key, memo);
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 54, 0, text, page), memo,
        'the exact cast and parser scope can reuse the title memo');

    cast = ['Celestia', 'Nira'];
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 54, 0, text, page), null,
        'a cast change cannot reuse the old title memo');
    cast = ['Celestia'];
    context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION = 'full-message-speaker-index.next';
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 54, 0, text, page), null,
        'a parser upgrade cannot reuse a title memo from the previous parser version');
});

await test('same candidate names from a different chat-bound worldbook cannot reuse the previous title memo', () => {
    const harness = createStructuralFastTitleHarness();
    const { context, snapshot, text } = harness;
    snapshot.rawChat = [{ chat_metadata: { world_info: 'Worldbook A' } }];
    const sourceFingerprintA = context.structuralSpeakerCandidateSourceFingerprint(snapshot, {
        resourceFingerprint: 'sha256:identical-content',
    });
    const candidateFingerprintA = context.structuralSpeakerNamesFingerprint(['Celestia'], sourceFingerprintA);
    const span = { start: 0, end: Array.from(text).length };
    const keyA = context.structuralPageTitleMemoryKey(snapshot, 50, 0, span, 0, candidateFingerprintA,
        context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION);
    const sourceMessageHash = 'sha256:worldbook-scope-title';
    const memo = {
        sourceText: text, sourceMessageIndex: 50, sourceMessageHash, sourceSpan: span,
        viewSpan: span, publishedSpeakerFingerprint: candidateFingerprintA,
        parserVersion: context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION,
        pageTitleEvidence: { sourceMessageIndex: 50, sourceMessageHash, coreSpan: span, viewSpan: span,
            kind: 'speaker', text: 'Celestia', speakers: [], ruleId: 'quoted-attribution' },
    };
    context.presentationStructuralPageTitles.set(keyA, memo);
    const page = { sourceSpan: span, type: 'unknown' };
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 50, 0, text, page, 0, ['Celestia'], sourceFingerprintA), memo);

    snapshot.rawChat[0].chat_metadata.world_info = 'Worldbook B';
    const sourceFingerprintB = context.structuralSpeakerCandidateSourceFingerprint(snapshot, {
        resourceFingerprint: 'sha256:identical-content',
    });
    const candidateFingerprintB = context.structuralSpeakerNamesFingerprint(['Celestia'], sourceFingerprintB);
    assert.notEqual(candidateFingerprintB, candidateFingerprintA,
        'the exact chat-bound resource name participates in the candidate fingerprint even when candidates/content match');
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 50, 0, text, page, 0, ['Celestia'], sourceFingerprintB), null,
        'a memo from the previous chat worldbook is not reused');
});

for (const { label, mutate } of [
    { label: 'release id', mutate: (context) => { context.release.releaseId = 'new-release'; } },
    { label: 'scenario id', mutate: (context) => { context.release.scenarioId = 'new-scenario'; } },
    { label: 'scenario version', mutate: (context) => { context.release.scenarioVersion = '2'; } },
    { label: 'active arc', mutate: (context) => { context.release.activeArcId = 'new-arc'; } },
    { label: 'chat filename', mutate: (context) => {
        context.activeChatSnapshot = { ...context.activeChatSnapshot, fileName: 'new-chat-file' };
    } },
]) {
    await test(`delayed worldbook candidates are discarded after only the ${label} changes`, async () => {
        const harness = createStructuralFastTitleHarness({ text: 'Celestia：我们走。', boundWorldbookCandidates: ['Celestia'] });
        const { context, snapshot } = harness;
        context.release = { releaseId: 'release-1', scenarioId: 'scenario-1', scenarioVersion: '1', activeArcId: 'arc-1' };
        context.manifest = { id: 'scenario-1', version: '1' };
        let resolveCandidates;
        context.speakerCandidateAdapter.getBoundWorldbookCandidates = () => new Promise((resolve) => {
            resolveCandidates = resolve;
        });
        const pending = context.ensureStructuralPresentationPageTitle(snapshot, 0, snapshot.messages[0], 0);
        mutate(context);
        resolveCandidates({ candidateSpeakerNames: ['Celestia'], resourceFingerprint: 'sha256:stale-worldbook' });
        await pending;
        assert.notEqual(context.ui.speakerName.textContent, 'Celestia');
        assert.equal(context.presentationStructuralPageTitles.size, 0,
            `a response from the previous ${label} scope cannot populate a title memo`);
    });
}

await test('delayed worldbook candidates are discarded after the active chat binding changes', async () => {
    const harness = createStructuralFastTitleHarness({ text: 'Celestia：我们走。', boundWorldbookCandidates: ['Celestia'] });
    const { context, snapshot } = harness;
    snapshot.rawChat = [{ chat_metadata: { world_info: 'Old Worldbook' } }];
    context.release = { releaseId: 'release-1', scenarioId: 'scenario-1', scenarioVersion: '1', activeArcId: 'arc-1' };
    context.manifest = { id: 'scenario-1', version: '1' };
    let resolveCandidates;
    context.speakerCandidateAdapter.getBoundWorldbookCandidates = () => new Promise((resolve) => {
        resolveCandidates = resolve;
    });
    const pending = context.ensureStructuralPresentationPageTitle(snapshot, 0, snapshot.messages[0], 0);
    context.activeChatSnapshot = { ...snapshot, rawChat: [{ chat_metadata: { world_info: 'New Worldbook' } }] };
    resolveCandidates({ candidateSpeakerNames: ['Celestia'], resourceFingerprint: 'sha256:old-worldbook' });
    await pending;
    assert.notEqual(context.ui.speakerName.textContent, 'Celestia');
    assert.equal(context.presentationStructuralPageTitles.size, 0,
        'a response from the old chat worldbook cannot populate a memo after header rebinding');
});

await test('probable segmenter hint adds only a same-page 推测 title over semantic unknown', async () => {
    const text = '约翰立刻反对：“这里禁止通行。”';
    const pages = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: ['Pippa'] });
    const page = pages[0];
    assert.equal(page.type, 'dialogue');
    assert.equal(page.speakerConfidence, 'inferred');
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = [{ index: 0, type: 'unattributed-dialogue', speaker: '未识别',
        identityRef: { type: 'unknown' }, text: page.text, sourceText: page.sourceText,
        sourceSpan: page.sourceSpan, sourceMessageIndex: 54, sourceMessageHash }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, productionSegments: true });
    harness.context.createStructuralContinuationEvidenceFromAnnotation = () => null;
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.context.ui.speakerName.textContent, '约翰（推测）');
    const projected = harness.context.createPresentationPagesForMessage(harness.snapshot, 0, harness.snapshot.messages[0], 0).pages[0];
    assert.equal(projected.semanticPresentation.type, 'unattributed-dialogue');
    assert.equal(projected.pageTitleEvidence.ruleId, 'probable-narrative-dialogue');
    assert.equal(projected.type, 'dialogue');
    assert.equal(projected.text, text);
    assert.deepEqual(projected.sourceSpan, page.sourceSpan);
    assert.equal(getPresentationSpeakerLabel(projected, harness.snapshot.messages[0]), '约翰（推测）');
    assert.equal(getPresentationVisualSpeakerContext(projected, harness.snapshot.messages[0]).role, 'unknown');
});

await test('probable runtime title is suppressed by a conflicting decision for the exact source quote', async () => {
    const text = '约翰立刻反对：“这里禁止通行。”';
    const page = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: ['Pippa'] })[0];
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = [{ index: 0, type: 'unattributed-dialogue', speaker: '未识别',
        identityRef: { type: 'unknown' }, text: page.text, sourceText: page.sourceText,
        sourceSpan: page.sourceSpan, sourceMessageIndex: 54, sourceMessageHash }];
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, productionSegments: true });
    const buildIndex = harness.context.createStructuralMessageSpeakerIndex;
    harness.context.createStructuralMessageSpeakerIndex = (...args) => {
        const index = buildIndex(...args);
        index.quoteEvidence[0].decision = {
            status: 'unresolved', reasonId: 'conflicting-quoted-attribution', evidenceRank: 0,
        };
        index.unresolvedDialogueSpans[0].reasonId = 'conflicting-quoted-attribution';
        return index;
    };
    harness.context.createStructuralContinuationEvidenceFromAnnotation = () => null;
    await harness.context.ensureStructuralPresentationPageTitle(
        harness.snapshot, 0, harness.snapshot.messages[0], 0,
    );
    const projected = harness.context.createPresentationPagesForMessage(
        harness.snapshot, 0, harness.snapshot.messages[0], 0,
    ).pages[0];
    assert.notEqual(harness.context.ui.speakerName.textContent, '约翰（推测）');
    assert.notEqual(projected.pageTitleEvidence?.ruleId, 'probable-narrative-dialogue');
    assert.equal(projected.semanticPresentation.type, 'unattributed-dialogue');
    assert.deepEqual(projected.sourceSpan, page.sourceSpan);
    assert.equal(projected.text, page.text);
});

await test('probable speaker continues only across the exact same quote span on a later page', async () => {
    const text = 'Mira立刻反对：“第一句继续\n\n第二句结束。”';
    const basePages = createVisualNovelDisplaySegments(text, { role: 'character' });
    assert.equal(basePages.length, 2);
    assert.equal(basePages[0].confidenceBand, 'probable');
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = basePages.map((page, index) => ({
        index,
        type: 'unattributed-dialogue',
        speaker: '未识别',
        identityRef: { type: 'unknown' },
        text: page.text,
        sourceText: page.sourceText,
        sourceSpan: page.sourceSpan,
        sourceMessageIndex: 54,
        sourceMessageHash,
    }));
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, productionSegments: true });
    harness.context.createStructuralPageTitleEvidenceFromMessageIndex = () => null;
    harness.context.createStructuralContinuationEvidenceFromAnnotation = () => null;
    harness.context.activeSegmentIndex = 1;
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 1);
    assert.equal(harness.context.presentationStructuralPageTitles.size, 1,
        'a page title sidecar should be memoized for the continuation page');
    const projectedPages = harness.context.createPresentationPagesForMessage(
        harness.snapshot, 0, harness.snapshot.messages[0], 1,
    ).pages;
    assert.equal(harness.context.ui.speakerName.textContent, 'Mira（推测）');
    assert.equal(projectedPages[1].pageTitleEvidence.ruleId, 'probable-quote-span-continuation');
    assert.equal(projectedPages[1].type, basePages[1].type, 'the production segment type is unchanged');
    assert.equal(projectedPages[1].semanticPresentation.type, 'unattributed-dialogue');
    assert.deepEqual(projectedPages[1].identityRef, basePages[1].identityRef);
    assert.equal(projectedPages[1].text, basePages[1].text);
    assert.deepEqual(projectedPages[1].sourceSpan, basePages[1].sourceSpan);
    assert.equal(getPresentationVisualSpeakerContext(projectedPages[1], harness.snapshot.messages[0]).role, 'unknown');
});

await test('probable runtime title remains valid when the same literals recur elsewhere in this assistant message', async () => {
    const paragraph = '约翰立刻反对：“这里禁止通行。”';
    const text = `${paragraph}\n\n${paragraph}`;
    const basePages = createVisualNovelDisplaySegments(text, { role: 'character', knownSpeakers: ['Pippa'] });
    assert.equal(basePages.length, 2);
    const sourceMessageHash = await hashVisibleMessage(text);
    const semanticSegments = basePages.map((page, index) => ({
        index,
        type: 'unattributed-dialogue',
        speaker: '未识别',
        identityRef: { type: 'unknown' },
        text: page.text,
        sourceText: page.sourceText,
        sourceSpan: page.sourceSpan,
        sourceMessageIndex: 54,
        sourceMessageHash,
    }));
    const harness = createStructuralFastTitleHarness({ text, semanticSegments, productionSegments: true });
    harness.context.createStructuralPageTitleEvidenceFromMessageIndex = () => null;
    harness.context.createStructuralContinuationEvidenceFromAnnotation = () => null;
    await harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    const projectedPages = harness.context.createPresentationPagesForMessage(
        harness.snapshot, 0, harness.snapshot.messages[0], 0,
    ).pages;
    assert.equal(harness.context.ui.speakerName.textContent, '约翰（推测）');
    assert.equal(projectedPages[0].pageTitleEvidence.ruleId, 'probable-narrative-dialogue');
    assert.equal(projectedPages[1].pageTitleEvidence, undefined, 'the sidecar does not propagate across page cores');
    assert.deepEqual(projectedPages.map(({ index, type, speaker, text, sourceText, sourceSpan }) => (
        { index, type, speaker, text, sourceText, sourceSpan }
    )), basePages.map(({ index, type, speaker, text, sourceText, sourceSpan }) => (
        { index, type, speaker, text, sourceText, sourceSpan }
    )), 'pagination fields remain exactly equal to the production segmenter output');
});

await test('published aliases are included in the structural speaker scope', () => {
    const context = vm.createContext({
        getManifestKnownVisualSpeakers: () => [{ displayName: 'Nira', aliases: ['Nira Vale', 'Captain Nira'] }],
    });
    const names = Array.from(load('getPublishedStructuralSpeakerNames', context)());
    assert.deepEqual(names, ['Nira', 'Nira Vale', 'Captain Nira']);
});

await test('semantic unattributed dialogue evicts a conflicting structural speaker memo', () => {
    const text = 'Celestia说：“我们走。”';
    const harness = createStructuralFastTitleHarness({ text });
    const { context, snapshot } = harness;
    const span = { start: 0, end: Array.from(text).length };
    const fingerprint = context.structuralSpeakerNamesFingerprint();
    const parserVersion = context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION;
    const key = context.structuralPageTitleMemoryKey(snapshot, 54, 0, span, 0, fingerprint, parserVersion);
    const sourceMessageHash = 'sha256:semantic-unattributed-priority';
    context.presentationStructuralPageTitles.set(key, {
        sourceText: text, sourceMessageIndex: 54, sourceMessageHash, sourceSpan: span, viewSpan: span,
        publishedSpeakerFingerprint: fingerprint, parserVersion,
        pageTitleEvidence: {
            sourceMessageIndex: 54, sourceMessageHash, coreSpan: span, viewSpan: span,
            kind: 'speaker', text: 'Celestia', speakers: [], ruleId: 'quoted-attribution',
        },
    });
    const semanticPage = {
        sourceSpan: span, type: 'unknown',
        semanticPresentation: { type: 'unattributed-dialogue' },
    };
    assert.equal(context.getStructuralPageTitleMemo(snapshot, 54, 0, text, semanticPage), null,
        'validated unknown-speaker semantics reject a conflicting structural memo');
    assert.equal(context.presentationStructuralPageTitles.has(key), false, 'the rejected conflicting memo is evicted');
});

await test('late structured title hash is discarded after the displayed page changes', async () => {
    const harness = createStructuralFastTitleHarness({ deferHash: true });
    const pending = harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    for (let attempt = 0; attempt < 20 && !harness.context.presentationStructuralTitleInflight.size; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    harness.context.activeSegmentIndex = 1;
    harness.resolveHash(await hashVisibleMessage(harness.text));
    await pending;
    assert.equal(harness.context.presentationStructuralPageTitles.size, 0);
    assert.equal(harness.context.ui.speakerName.textContent, '');
});

await test('late structural evidence is discarded when the same chat message is edited in place', async () => {
    const harness = createStructuralFastTitleHarness({ deferHash: true });
    const pending = harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    for (let attempt = 0; attempt < 20 && !harness.context.presentationStructuralTitleInflight.size; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    harness.context.activeChatSnapshot = {
        fileName: harness.snapshot.fileName,
        messages: [{ role: 'character', index: 54, text: 'Celestia说：“内容已经编辑。”' }],
    };
    harness.resolveHash(await hashVisibleMessage(harness.text));
    await pending;
    assert.equal(harness.context.presentationStructuralPageTitles.size, 0,
        'the old hash cannot populate the current page memo after its source text changes');
    assert.equal(harness.context.ui.speakerName.textContent, '',
        'the old message evidence cannot write its title into the current message header');
});

await test('structural title work coalesces concurrent render and analysis requests for the same page', async () => {
    const harness = createStructuralFastTitleHarness({ deferHash: true });
    const first = harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    for (let attempt = 0; attempt < 20 && !harness.context.presentationStructuralTitleInflight.size; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
    const second = harness.context.ensureStructuralPresentationPageTitle(harness.snapshot, 0, harness.snapshot.messages[0], 0);
    assert.equal(harness.hashCalls, 1, 'only one full-message hash is computed for identical in-flight page work');
    harness.resolveHash(await hashVisibleMessage(harness.text));
    await Promise.all([first, second]);
    assert.equal(harness.context.ui.speakerName.textContent, 'Celestia');
    assert.equal(harness.context.presentationStructuralPageTitles.size, 1);
});

await test('actual visible speaker overrides message author', () => {
    const resolve = speakerContext({ type: 'dialogue', speaker: 'Alice', identityRef: { type: 'published', id: 'alice' } });
    assert.equal(resolve({ role: 'character', speaker: 'Author' }, 7).speaker, 'Alice');
    assert.equal(resolve({ role: 'character', speaker: 'Author' }, 7, { type: 'dialogue', speaker: 'Bob', identityRef: { type: 'published', id: 'bob' } }).speaker, 'Bob');
});
for (const [segment, role, speaker] of [
    [{ type: 'dialogue-group', speakerCandidates: [{ speaker: 'Alice', identityRef: { type: 'published', id: 'a' } }, { speaker: 'Bob', identityRef: { type: 'published', id: 'b' } }] }, 'group', '多人对话'],
    [{ type: 'dialogue', speaker: 'X', identityRef: { type: 'unknown' } }, 'unknown', '未识别'],
    [{ type: 'unattributed-dialogue' }, 'unknown', '未识别'],
    [{ type: 'system' }, 'unknown', '未识别'],
    [{ type: 'narration', text: 'The wind blows.' }, 'narrator', '旁白'],
    [{ type: 'player' }, 'player', '你'],
    [{ type: 'stage' }, 'unknown', '未识别'],
]) {
    await test(`override preserves ${segment.type}/${speaker} channel`, () => {
        const result = speakerContext(null)({ role: 'character', speaker: 'Author' }, 7, segment);
        assert.equal(result.role, role); assert.equal(result.speaker, speaker);
    });
}
await test('system message cannot be promoted to a character', () => {
    const result = speakerContext(null)({ role: 'system' }, 7, { type: 'dialogue', speaker: 'Bob', identityRef: { type: 'published', id: 'bob' } });
    assert.equal(result.role, 'system');
});
await test('string inventory records have complete detail-renderer fields', () => {
    const context = vm.createContext({}); load('asArray', context);
    const item = load('normalizeAdaptiveDetailItem', context)('Iron Sword');
    assert.equal(item.label, 'Iron Sword'); assert.equal(item.traits.length, 0);
    assert.equal(item.value, ''); assert.equal(item.originalName, '');
});
await test('image matches cannot invent or overwrite inventory text', () => {
    const context = vm.createContext({ activeVisualDetailHints: new Map([['equipment', [{ displayLabel: 'Iron Sword' }]]]) });
    load('asArray', context);
    assert.equal(load('getVisualDetailItems', context)('equipment', { displayLabel: 'Wrong Sword' })[0].name, 'Iron Sword');
    assert.equal(context.getVisualDetailItems('item', { displayLabel: 'Invented potion' }).length, 0);
});
await test('carried weapons retain their source group and are not hidden or relabeled', () => {
    const context = vm.createContext({ getVisualCardModule: () => 'inventory',
        activeAdaptivePanelResults: new Map([['inventory', { values: { groups: [{ id: 'weapons', items: ['Sword'] }] } }]]),
        createVisualDetailResult: () => ({ hasVisibleEvidence: false }),
    });
    const result = load('getVisualCardDetailResult', context)('item');
    assert.equal(result.hasVisibleEvidence, true);
    assert.equal(result.values.groups[0].id, 'weapons');
    assert.equal(result.values.groups[0].items[0], 'Sword');
});
await test('late context response cannot reset a newer portrait', async () => {
    let complete; let resets = 0;
    const context = vm.createContext({ visualBundleRequestToken: 1,
        getActiveVisualSpeakerContext: () => ({ role: 'character' }), getCoreVisualServiceUrl: () => 'http://unit.test',
        readCoreVisualContext: () => new Promise((resolve) => { complete = resolve; }),
        recordSceneContinuityDiagnostic: () => {},
        renderCoreVisualFallback: () => { resets++; }, markCoreVisualUnavailable: () => {}, setVisualStatus: () => {},
    });
    const result = load('renderCoreVisualPresentation', context)({ messages: [{}] }, 0, 1);
    context.visualBundleRequestToken = 2; complete(null);
    await result; assert.equal(resets, 0);
});
await test('obsolete renderer and icon work has no side effects', async () => {
    const context = vm.createContext({ visualBundleRequestToken: 2, recordSceneContinuityDiagnostic: () => {} });
    await load('renderCoreVisualDecisions', context)([], '', 1, {}, {});
    await load('applyCoreVisualIcons', context)(new Map(), '', 1);
});
await test('late JSON response cannot reset a newer portrait', async () => {
    let complete; let resets = 0; const diagnostics = [];
    const context = vm.createContext({ visualBundleRequestToken: 1,
        activeSceneContinuityAction: 'preserve',
        TextEncoder,
        getActiveVisualSpeakerContext: () => ({ role: 'character' }), getCoreVisualServiceUrl: () => 'http://unit.test',
        readCoreVisualContext: async () => ({ enabled: true, visualProfile: {} }),
        updateSceneContinuityForVisiblePage: async () => {}, createCoreVisualDecisionRequest: async () => ({ projection: { entities: [] } }),
        recordSceneContinuityDiagnostic: (stage, details) => diagnostics.push(`${stage}:${details?.reason || ''}`),
        fetch: async () => ({ ok: true, json: () => new Promise((resolve) => { complete = resolve; }) }),
        renderCoreVisualFallback: () => { resets++; }, markCoreVisualUnavailable: () => {}, setVisualStatus: () => {},
    });
    const result = load('renderCoreVisualPresentation', context)({ messages: [{}] }, 0, 1);
    for (let i = 0; i < 20 && !complete; i++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.ok(complete, `request stage was ${diagnostics.at(-1) || 'none'}`);
    context.visualBundleRequestToken = 2; complete({ ok: false });
    await result; assert.equal(resets, 0);
});
await test('right-hand card count and tooltip remain available without images', () => {
    const context = vm.createContext({ getVisualCardDetailResult: () => ({ hasVisibleEvidence: true }),
        getAdaptiveGroups: () => [{ items: [{ label: 'Iron Sword' }, { label: 'Shield' }] }],
        getVisualTypeLabel: () => '装备',
    });
    const caption = {}; const attributes = {};
    const summary = {};
    const icon = { querySelector: (selector) => selector === 'figcaption' ? caption : selector === 'small' ? summary : null, setAttribute: (key, value) => { attributes[key] = value; } };
    load('updateCoreVisualCardText', context)(icon, 'equipment');
    assert.equal(caption.textContent, '装备 · 2'); assert.equal(attributes.title, 'Iron Sword、Shield');
    assert.equal(summary.textContent, 'Iron Sword、Shield');
});

await test('semantic annotation cannot change the GitHub direct visible-segment playback', () => {
    const first = 'Alice说：“早。”';
    const second = 'Bob说：“来了。”';
    const text = `${first}${second}`;
    let parserCalls = 0;
    let semanticSegments = null;
    const context = vm.createContext({ manifest: { locale: 'zh-CN' }, release: null,
        resolvePresentationMode: () => 'assisted', presentationProjectionStates: new Map([['scope', { ready: true }]]),
        presentationProjectionScope: () => 'scope', getAssistedPresentationSegments: () => semanticSegments,
        presentationStructuralPageTitles: new Map(), presentationStructuralTitleInflight: new Map(), getPresentationSpeakerLabel,
        formatVisualNovelDisplayText: (value) => value,
        createVisualNovelDisplaySegments: () => {
            parserCalls += 1;
            return [
                { index: 0, type: 'dialogue', speaker: 'Alice', identityRef: { type: 'published', id: 'alice' },
                    text: first, sourceText: first, sourceSpan: { start: 0, end: Array.from(first).length } },
                { index: 1, type: 'dialogue', speaker: 'Bob', identityRef: { type: 'published', id: 'bob' },
                    text: second, sourceText: second,
                    sourceSpan: { start: Array.from(first).length, end: Array.from(text).length } },
            ];
        },
        createPresentationPages: () => { throw new Error('player body playback must not call the identity-grouping paginator'); },
    });
    load('samePresentationSpan', context);
    load('hasCoarseNarrationPageTitle', context);
    load('structuralPageTitleMemoryKey', context);
    load('getStructuralPageTitleMemo', context);
    const createPages = load('createPresentationPagesForMessage', context);
    const message = { role: 'character', index: 8, text };
    const snapshot = { fileName: 'pagination-isolation', messages: [message] };
    const withoutSemantic = createPages(snapshot, 0, message, 0);

    semanticSegments = [
        { index: 0, type: 'dialogue', speaker: 'Alicia', identityRef: { type: 'published', id: 'alice' },
            text: first, sourceText: first, sourceSpan: { start: 0, end: Array.from(first).length },
            sourceMessageIndex: 8, sourceMessageHash: 'sha256:semantic' },
        { index: 1, type: 'stage', speaker: '', identityRef: null,
            text: second, sourceText: second, sourceSpan: { start: Array.from(first).length + 2, end: Array.from(text).length },
            sourceMessageIndex: 8, sourceMessageHash: 'sha256:semantic' },
    ];
    const withSemanticOverlay = createPages(snapshot, 0, message, 0);
    semanticSegments = [{ index: 0, type: 'dialogue-group', speaker: '多人对话', identityRef: null,
        text, sourceText: text, sourceSpan: { start: 0, end: Array.from(text).length },
        sourceMessageIndex: 8, sourceMessageHash: 'sha256:semantic' }];
    const withDifferentSegmentation = createPages(snapshot, 0, message, 0);

    assert.equal(parserCalls, 3, 'each render uses the same deterministic source segmenter');
    assert.equal(withoutSemantic.sourceText, withSemanticOverlay.sourceText);
    const bodyShape = (result) => result.pages.map(({ index, type, speaker, identityRef, text: body, sourceText, sourceSpan, sourceMessageIndex }) =>
        ({ index, type, speaker, identityRef, text: body, sourceText, sourceSpan, sourceMessageIndex }));
    assert.equal(withoutSemantic.pages.length, 2, 'each historical visible segment remains one playback page');
    assert.equal(createPresentationPages({ segments: withoutSemantic.pages, sourceText: withoutSemantic.sourceText, sourceMessageIndex: 8 }).length, 1,
        'the later identity paginator would merge these same adjacent speakers into one body page');
    assert.deepEqual(bodyShape(withSemanticOverlay), bodyShape(withoutSemantic), 'semantic labels never reshape body segments');
    assert.equal(withSemanticOverlay.pages[0].type, 'dialogue', 'semantic kind stays outside the body-page type');
    assert.equal(withSemanticOverlay.pages[0].speaker, 'Alice', 'semantic display title does not rewrite the source segment speaker');
    assert.equal(withSemanticOverlay.pages[0].semanticPresentation.type, 'dialogue', 'speaker metadata remains available separately');
    assert.equal(getPresentationSpeakerLabel(withSemanticOverlay.pages[0], message), 'Alicia', 'semantic metadata may update only the title');
    assert.equal(getPresentationVisualSpeakerContext(withSemanticOverlay.pages[0], message).role, 'character');
    assert.deepEqual(bodyShape(withDifferentSegmentation), bodyShape(withoutSemantic), 'semantic grouping cannot merge the source segments');
    assert.equal(withDifferentSegmentation.pages.length, 2, 'the old page count remains even when one semantic segment spans both speakers');
    assert.equal(withDifferentSegmentation.pages.map((page) => page.text).join(''), text, 'visible body segments retain their original ordered text');
});
await test('invalid assisted annotation still uses the original deterministic visible segments', () => {
    const text = '正文\n\n😀后续';
    const context = vm.createContext({ manifest: {}, release: null, resolvePresentationMode: () => 'assisted',
        presentationProjectionStates: new Map([['scope', { ready: false }]]), presentationProjectionScope: () => 'scope',
        getAssistedPresentationSegments: () => null, formatVisualNovelDisplayText: (value) => value,
        presentationStructuralPageTitles: new Map(), presentationStructuralTitleInflight: new Map(), getPresentationSpeakerLabel,
        createVisualNovelDisplaySegments: (value) => [{ index: 0, type: 'unknown', speaker: '未识别', text: value,
            sourceText: value, sourceSpan: { start: 0, end: Array.from(value).length } }],
        createPresentationPages,
    });
    load('structuralPageTitleMemoryKey', context);
    load('getStructuralPageTitleMemo', context);
    load('hasCoarseNarrationPageTitle', context);
    const pages = load('createPresentationPagesForMessage', context)({}, 0, { role: 'character', text }).pages;
    assert.equal(pages.map((page) => page.text).join(''), text);
    assert.equal(pages[0].sourceSpan.end, Array.from(text).length);
    assert.equal(pages[0].type, 'unknown');
});
await test('active singleton title renders in a long chat; older rows wait until individually visited', async () => {
    const messages = Array.from({ length: 15 }, (_, index) => ({ role: 'character', index, text: `历史正文 ${index}` }));
    messages[14] = { role: 'character', index: 14, text: 'Alice：“你好。”' };
    const snapshot = { fileName: 'long-chat', messages };
    const currentText = messages[14].text;
    const sourceMessageHash = await hashVisibleMessage(currentText);
    const chars = Array.from(currentText);
    const nameEnd = Array.from('Alice').length;
    const annotation = {
        sourceMessageIndex: 14,
        sourceMessageHash,
        segments: [{ start: 0, end: chars.length, textHash: sourceMessageHash, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'text-explicit', confidenceBand: 'high',
            evidenceSpans: [{ start: 0, end: nameEnd, purpose: 'speaker' }] }],
        entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: 0, end: nameEnd }, attributeEvidence: [] }],
        identityLinkCandidates: [],
        stateClaims: [],
    };
    let cacheReads = 0; const analyzerRequestSizes = []; const cacheKeys = []; let visibleLabel = null; let visibleIdentity = null;
    const context = vm.createContext({
        AbortController, Date,
        manifest: { locale: 'zh-CN', releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', defaultArcId: 'arc', resourceBindings: { characters: {} } },
        release: { releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', activeArcId: 'arc' },
        presentationServiceState: true, presentationServiceRetryAt: 0, presentationAnalyzerScope: 'scope-v1',
        presentationAnalysisEpoch: 0, presentationAnalysisController: null, presentationAnalysisRunIdentity: null, presentationInflight: new Set(),
        PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
        presentationAnnotations: new Map(), presentationProjectionStates: new Map(),
        activeChatSnapshot: snapshot, activeMessageIndex: 14, activeSegmentIndex: 0,
        presentationCache: {
            get: async (key) => { cacheKeys.push(key); return ++cacheReads === 1 ? annotation : null; },
            delete: async () => true,
            put: async () => {},
        },
        presentationAnalysis: {
            healthCheck: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'scope-v1' }),
            annotate: async ({ request }) => { analyzerRequestSizes.push(request.messages.length); throw new Error('simulated analyzer outage'); },
        },
        createPublishedPresentationKnownEntities: async () => ({ diagnostics: [], knownEntities: [] }),
        createPresentationContextDigest,
        validatePresentationAnnotationResponse,
        createPresentationBatches: async ({ messages: requestMessages }) => [{ messages: requestMessages, contextDigest: `ctx-${requestMessages[0].sourceMessageIndex}`, knownEntities: [] }],
        createVisibleMessageHash: hashVisibleMessage,
        sha256Hex: async (value) => `digest-${value}`,
        createSceneContinuityTimelinePrefixHash,
        createPresentationTimelineSnapshot,
        matchesPresentationTimelineSnapshot,
        projectPresentationIdentityDetailed: async ({ messages: timeline }) => ({
            projection: { complete: timeline.every((row) => Boolean(row.annotation)), chatKey: 'long-chat', entities: [], segmentSpeakers: [] },
            mentionIdentity: new Map(),
        }),
        projectPartyRoster: () => ({ complete: false, entries: [] }),
        createPresentationDisplaySegments,
        isPresentationProjectionTimelineCurrent,
        isPresentationTimelineSnapshotCurrent,
        selectPresentationAnalysisMessages,
        resolvePresentationMode,
        getPresentationSpeakerLabel,
        getPresentationVisualSpeakerContext,
        canonicalJson: () => '{}',
        PRESENTATION_ANNOTATION_VERSION: 'galgame.presentation-annotation.v1',
        PRESENTATION_IDENTITY_PROJECTION_VERSION: 'galgame.identity-projection.v1',
        PRESENTATION_ROSTER_PROJECTION_VERSION: 'galgame.roster-projection.v1',
        renderChatSnapshot: (renderedSnapshot, options) => {
            const message = renderedSnapshot.messages[options.messageIndex];
            const state = context.presentationProjectionStates.get(context.presentationProjectionScope(renderedSnapshot));
            const segments = context.getAssistedPresentationSegments(renderedSnapshot, options.messageIndex, message, state);
            visibleLabel = segments?.[0] ? getPresentationSpeakerLabel(segments[0], message) : null;
            visibleIdentity = segments?.[0]?.identityRef || null;
        },
    });
    for (const name of ['currentPresentationScenarioId', 'currentPresentationScenarioVersion', 'presentationKnownEntitiesSourceFingerprint',
        'presentationProjectionScope', 'presentationAnnotationMemoryKey', 'presentationCacheKey', 'rememberPresentationAnnotation',
        'buildPresentationProjectionState', 'isPresentationProjectionCurrent', 'getAssistedPresentationSegments',
        'isPresentationAnalysisSnapshotCurrent', 'analyzePresentationSnapshot']) load(name, context);
    const currentTimelineSnapshot = createPresentationTimelineSnapshot(snapshot);
    context.presentationAnalysisEpoch = 1;
    assert.equal(context.isPresentationAnalysisSnapshotCurrent(snapshot, 14, currentTimelineSnapshot, 1, new AbortController().signal), true,
        'test fixture is a current chat/cursor before analysis starts');
    context.activeMessageIndex = 13;
    assert.equal(context.isPresentationAnalysisSnapshotCurrent(snapshot, 14, currentTimelineSnapshot, 1, new AbortController().signal), false,
        'an async analysis result is rejected after the active message cursor changes');
    context.activeMessageIndex = 14;
    messages[2].text = '编辑后的旧消息';
    assert.equal(context.isPresentationAnalysisSnapshotCurrent(snapshot, 14, currentTimelineSnapshot, 1, new AbortController().signal), false,
        'an async analysis result is rejected after earlier timeline text changes');
    messages[2].text = '历史正文 2';
    context.presentationAnalysisEpoch = 0;
    await context.analyzePresentationSnapshot(snapshot, 14, { mode: 'assisted' });
    assert.equal(cacheReads, 1, 'a long chat causes only one active-message cache lookup');
    assert.deepEqual(analyzerRequestSizes, [], 'no historical batch or backfill LLM request runs behind the active message');
    assert.ok(cacheKeys[0].startsWith('galgame.presentation-cache.v3/'), 'new lookups cannot select entries from the old multi-batch cache namespace');
    assert.ok(cacheKeys[0].includes('current-message-singleton.v1'), 'cache key explicitly records singleton provenance');
    assert.equal(visibleLabel, 'Alice', 'valid current-message singleton annotation renders without waiting for historical work');
    assert.deepEqual(visibleIdentity, { type: 'unknown' }, 'incomplete timeline never promotes the speaker to a chat-local identity');
    const state = context.presentationProjectionStates.get(context.presentationProjectionScope(snapshot));
    assert.equal(state.projection.complete, false);
    assert.equal(state.roster.complete, false);
    assert.equal(context.getAssistedPresentationSegments(snapshot, 13, messages[13], state), null, 'a different message cursor cannot reuse the active annotation');
    context.activeMessageIndex = 13;
    context.presentationAnalysisEpoch = 1;
    await context.analyzePresentationSnapshot(snapshot, 13, { mode: 'assisted' });
    assert.deepEqual(analyzerRequestSizes, [1], 'an older row is analyzed only as a singleton after it becomes the active target');
    messages[1].text = '历史被修改';
    assert.equal(context.getAssistedPresentationSegments(snapshot, 14, messages[14], state), null, 'a changed earlier prefix invalidates the title cache');
});
await test('fresh singleton annotation is validated, cached, memoized, and immediately rendered', async () => {
    const text = 'Alice：“你好。”';
    const snapshot = { fileName: 'fresh-annotation-chat', messages: [{ role: 'character', index: 0, speaker: 'Author', text }] };
    const sourceMessageHash = await hashVisibleMessage(text);
    const sourceLength = Array.from(text).length;
    const nameEnd = Array.from('Alice').length;
    const annotation = {
        sourceMessageIndex: 0,
        sourceMessageHash,
        segments: [{ start: 0, end: sourceLength, textHash: sourceMessageHash, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'text-explicit', confidenceBand: 'high',
            evidenceSpans: [{ start: 0, end: nameEnd, purpose: 'speaker' }] }],
        entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: 0, end: nameEnd }, attributeEvidence: [] }],
        identityLinkCandidates: [],
        stateClaims: [],
    };
    const persisted = [];
    let validationPassed = false;
    let analyzeCalls = 0;
    let renderedLabel = null;
    const context = vm.createContext({
        AbortController, Date,
        manifest: { locale: 'zh-CN', releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', defaultArcId: 'arc', resourceBindings: { characters: {} } },
        release: { releaseId: 'release', scenarioId: 'scenario', scenarioVersion: '1', activeArcId: 'arc' },
        presentationServiceState: true, presentationServiceRetryAt: 0, presentationAnalyzerScope: 'scope-v1',
        presentationAnalysisEpoch: 0, presentationAnalysisController: null, presentationAnalysisRunIdentity: null, presentationInflight: new Set(),
        PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
        presentationAnnotations: new Map(), presentationProjectionStates: new Map(),
        activeChatSnapshot: snapshot, activeMessageIndex: 0, activeSegmentIndex: 0,
        presentationCache: {
            get: async () => null,
            delete: async () => true,
            put: async (...args) => { persisted.push(args); },
        },
        presentationAnalysis: {
            healthCheck: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'scope-v1' }),
            annotate: async ({ request }) => {
                analyzeCalls += 1;
                const validation = await validatePresentationAnnotationResponse(
                    { schemaVersion: 'galgame.presentation-annotation.v1', results: [annotation] }, request,
                );
                validationPassed = validation.valid;
                assert.equal(validation.valid, true, `mock annotate response passes Annotation v1 validation: ${validation.errors.join(', ')}`);
                return [annotation];
            },
        },
        createPublishedPresentationKnownEntities: async () => ({ diagnostics: [], knownEntities: [] }),
        createPresentationContextDigest,
        validatePresentationAnnotationResponse,
        createPresentationBatches: async ({ messages, knownEntities }) => [{ messages, contextDigest: 'ctx-active', knownEntities }],
        createVisibleMessageHash: hashVisibleMessage,
        sha256Hex: async (value) => `digest-${value}`,
        createSceneContinuityTimelinePrefixHash,
        createPresentationTimelineSnapshot,
        matchesPresentationTimelineSnapshot,
        projectPresentationIdentityDetailed: async () => ({
            projection: { complete: false, chatKey: 'fresh-annotation-chat', entities: [], segmentSpeakers: [] },
            mentionIdentity: new Map(),
        }),
        projectPartyRoster: () => ({ complete: false, entries: [] }),
        createPresentationDisplaySegments,
        isPresentationProjectionTimelineCurrent,
        isPresentationTimelineSnapshotCurrent,
        selectPresentationAnalysisMessages,
        resolvePresentationMode,
        getPresentationSpeakerLabel,
        getPresentationVisualSpeakerContext,
        canonicalJson: () => '{}',
        PRESENTATION_ANNOTATION_VERSION: 'galgame.presentation-annotation.v1',
        PRESENTATION_IDENTITY_PROJECTION_VERSION: 'galgame.identity-projection.v1',
        PRESENTATION_ROSTER_PROJECTION_VERSION: 'galgame.roster-projection.v1',
        renderChatSnapshot: (renderedSnapshot, options) => {
            const message = renderedSnapshot.messages[options.messageIndex];
            const state = context.presentationProjectionStates.get(context.presentationProjectionScope(renderedSnapshot));
            const segments = context.getAssistedPresentationSegments(renderedSnapshot, options.messageIndex, message, state);
            renderedLabel = segments?.[0] ? getPresentationSpeakerLabel(segments[0], message) : null;
        },
    });
    for (const name of ['currentPresentationScenarioId', 'currentPresentationScenarioVersion', 'presentationKnownEntitiesSourceFingerprint',
        'presentationProjectionScope', 'presentationAnnotationMemoryKey', 'presentationCacheKey', 'rememberPresentationAnnotation',
        'buildPresentationProjectionState', 'isPresentationProjectionCurrent', 'getAssistedPresentationSegments',
        'isPresentationAnalysisSnapshotCurrent', 'analyzePresentationSnapshot']) load(name, context);

    await context.analyzePresentationSnapshot(snapshot, 0, { mode: 'assisted' });

    assert.equal(analyzeCalls, 1, 'the current message is sent through the singleton analyzer exactly once');
    assert.equal(validationPassed, true, 'fresh analyzer output is Annotation v1 validated before the mock returns it');
    assert.equal(persisted.length, 1, 'fresh valid annotation is written to cache');
    assert.ok(persisted[0][0].startsWith('galgame.presentation-cache.v3/'));
    assert.equal(persisted[0][1], annotation);
    assert.equal(persisted[0][2].annotationProvenance, 'current-message-singleton.v1');
    const memo = [...context.presentationAnnotations.values()][0];
    assert.equal(memo.annotation, annotation, 'fresh valid annotation is remembered in the in-memory memo');
    assert.equal(memo.annotationProvenance, 'current-message-singleton.v1');
    const state = context.presentationProjectionStates.get(context.presentationProjectionScope(snapshot));
    assert.equal(memo.timelinePrefixHash, state.messages[0].timelinePrefixHash, 'fresh memo records the exact source timeline prefix');
    assert.equal(state.activeAnnotationIdentity.timelinePrefixHash, state.messages[0].timelinePrefixHash,
        'active identity proof retains the prefix of the exact analyzed message');
    assert.equal(renderedLabel, 'Alice', 'the exact source speaker label renders immediately after analysis');
});
await test('long assistant reply annotates only the active visible segment and renders a label without identity projection', async () => {
    const harness = await createLongPageAnalysisHarness();
    const { context, snapshot, sourceText, pageIndex, pageWindow, requests, cacheKeys, cachePuts } = harness;
    const baseline = context.createPresentationPagesForMessage(snapshot, 0, snapshot.messages[0], pageIndex).pages;
    assert.equal(baseline.length, 12, 'playback count comes directly from the historical visible segmenter');
    assert.equal(baseline.map((page) => page.text).join('\n\n'), sourceText, 'the visible segmenter retains the old paragraph layout');
    await context.analyzePresentationSnapshot(snapshot, 0, { mode: 'assisted', pageIndex });

    assert.equal(harness.analyzeCalls, 1, 'only the active page window receives the title-analysis request');
    assert.equal(harness.freshValidation, true, 'fresh page response passes the exact Annotation v1 validator');
    const pageRequest = requests.find((request) => request.messages[0]?.visibleText === pageWindow.viewText);
    assert.ok(pageRequest, 'page request receives only the immediate previous page plus current core');
    assert.equal(pageRequest.messages[0].visibleText.includes(sourceText.slice(0, pageWindow.viewSpan.start)), false,
        'text outside the immediate lookbehind window is excluded');
    assert.equal(pageRequest.messages[0].sourceMessageHash, await hashVisibleMessage(pageWindow.viewText));
    assert.equal(pageRequest.messages.length, 1);
    assert.equal(pageRequest.contextMessages.length, 0, 'no unrelated historical chat message enters the page request');
    assert.equal(cachePuts.length, 1);
    assert.ok(cacheKeys[0].startsWith('galgame.presentation-page-cache.v1/'), 'page results use an isolated cache namespace');
    for (const value of [await hashVisibleMessage(sourceText), await hashVisibleMessage(pageWindow.coreText),
        await hashVisibleMessage(pageWindow.viewText), 'current-page-window.v1', requests[0].contextDigest, 'scope-v1', '47']) {
        assert.ok(cacheKeys[0].includes(value), `cache binds required page provenance ${value}`);
    }
    assert.equal(cachePuts[0][2].sourceMessageIndex, 47);
    assert.equal(cachePuts[0][2].sourceMessageHash, requests[0].messages[0].sourceMessageHash,
        'persisted cache metadata stores the page-view hash, not source prose');
    assert.equal(context.presentationAnnotations.size, 0, 'page annotation never enters the full-message identity memo');
    assert.equal(context.presentationProjectionStates.size, 0, 'page annotation never marks identity or roster projection complete');
    assert.equal(harness.renderedCount, 1, 'validated active-page result immediately triggers a render');
    assert.equal(harness.rendered.label, 'Alice', 'the current page title uses the validated speaker evidence from its single lookbehind');
    assert.equal(harness.rendered.visual.role, 'narrator', 'the restored source parser owns the narration visual channel');
    assert.notEqual(harness.rendered.page.identityRef?.type, 'published', 'title evidence alone cannot create a character identity');
    assert.equal(harness.rendered.page.type, 'narration', 'semantic title metadata does not replace the GitHub source-parser page kind');
    assert.notEqual(harness.rendered.page.identityRef?.type, 'published');
    assert.equal(harness.rendered.page.text, baseline[pageIndex].text, 'annotation does not rewrite current page body');
    assert.deepEqual(harness.rendered.page.sourceSpan, baseline[pageIndex].sourceSpan, 'annotation does not rewrite page range');
    assert.equal(context.createPresentationPagesForMessage(snapshot, 0, snapshot.messages[0], pageIndex).pages.length, baseline.length,
        'annotation leaves base page count unchanged');
});

await test('current page annotation can fill an unknown title while an incomplete full-message projection exists', async () => {
    const harness = await createLongPageAnalysisHarness();
    const { context, snapshot, sourceText, pageIndex } = harness;
    await context.analyzePresentationSnapshot(snapshot, 0, { mode: 'assisted', pageIndex });
    context.getAssistedPresentationSegments = () => createSafePresentationDisplaySegments({
        text: sourceText, role: 'character', sourceMessageIndex: 47,
    });

    const projected = context.createPresentationPagesForMessage(snapshot, 0, snapshot.messages[0], pageIndex);
    assert.equal(projected.pages.length, harness.pages.length, 'the current full-message segment array remains intact');
    assert.equal(getPresentationSpeakerLabel(projected.pages[pageIndex], snapshot.messages[0]), 'Alice',
        'an existing segment array does not suppress a title validated for the exact visible source page');
    assert.equal(getPresentationVisualSpeakerContext(projected.pages[pageIndex], snapshot.messages[0]).role, 'narrator',
        'the supplemented title does not create an identity or avatar');
    assert.notEqual(projected.pages[pageIndex].identityRef?.type, 'published');
    assert.equal(projected.pages[pageIndex].text, harness.pages[pageIndex].text);
    assert.deepEqual(projected.pages[pageIndex].sourceSpan, harness.pages[pageIndex].sourceSpan);
});

await test('page-window semantic unattributed dialogue replaces a coarse narration title', async () => {
    const harness = await createLongPageAnalysisHarness({ responseKind: 'unattributed-dialogue' });
    const { context, snapshot, sourceText, pageIndex, pageWindow, expectedFullHash } = harness;
    const page = harness.pages[pageIndex];
    const coarseTitleEvidence = {
        sourceMessageIndex: 47,
        sourceMessageHash: expectedFullHash,
        viewSpan: { ...pageWindow.viewSpan },
        coreSpan: { ...page.sourceSpan },
        classificationEvidenceSpans: [{ ...page.sourceSpan }],
        kind: 'classification',
        classification: 'narration',
        text: '旁白',
        speakers: [],
        ruleId: 'plain-prose-narration',
    };
    const structuralKey = context.structuralPageTitleMemoryKey(snapshot, 47, pageIndex, page.sourceSpan);
    context.presentationStructuralPageTitles.set(structuralKey, {
        sourceText, sourceMessageIndex: 47, sourceMessageHash: expectedFullHash,
        sourceSpan: { ...page.sourceSpan }, viewSpan: { ...pageWindow.viewSpan },
        publishedSpeakerFingerprint: context.structuralSpeakerNamesFingerprint(),
        parserVersion: context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION,
        pageTitleEvidence: coarseTitleEvidence,
    });
    const coarsePage = context.createPresentationPagesForMessage(snapshot, 0, snapshot.messages[0], pageIndex).pages[pageIndex];
    assert.equal(getPresentationSpeakerLabel(coarsePage, snapshot.messages[0]), '旁白', 'fast structural title is visible before the semantic request');

    await context.analyzePresentationSnapshot(snapshot, 0, { mode: 'assisted', pageIndex });

    assert.equal(harness.analyzeCalls, 1, 'coarse narration does not suppress current page-window semantic analysis');
    assert.equal(harness.rendered.label, '未识别', 'validated unattributed-dialogue evidence replaces the coarse narration title');
    assert.equal(harness.rendered.page.pageTitleEvidence.classification, 'unattributed-dialogue');
    assert.equal(harness.rendered.page.type, 'narration', 'page-window title correction does not rewrite the source parser page kind');
    assert.notEqual(harness.rendered.page.identityRef?.type, 'published', 'page-window title evidence does not create a character identity');
    assert.equal(harness.rendered.page.text, page.text, 'page-window title correction preserves the original page body');
});

await test('page title metadata does not alter the restored source page', async () => {
    const harness = await createLongPageAnalysisHarness();
    const { context, snapshot, sourceText, pageIndex, pages, expectedFullHash, pageWindow } = harness;
    const page = pages[pageIndex];
    const speakerText = '续言';
    const structuralEvidence = {
        sourceMessageIndex: 47,
        sourceMessageHash: expectedFullHash,
        viewSpan: { ...pageWindow.viewSpan },
        coreSpan: { ...pageWindow.coreSpan },
        classificationEvidenceSpans: [{ ...pageWindow.coreSpan }],
        kind: 'speaker',
        text: speakerText,
        speakers: [{ mentionRef: 'display-only-structural-test', text: speakerText,
            start: page.sourceSpan.start, end: page.sourceSpan.start + Array.from(speakerText).length }],
        ruleId: 'quoted-attribution',
    };
    const structuralKey = context.structuralPageTitleMemoryKey(snapshot, 47, pageIndex, page.sourceSpan);
    context.presentationStructuralPageTitles.set(structuralKey, {
        sourceText, sourceMessageIndex: 47, sourceMessageHash: expectedFullHash,
        sourceSpan: { ...page.sourceSpan }, viewSpan: { ...pageWindow.viewSpan },
        publishedSpeakerFingerprint: context.structuralSpeakerNamesFingerprint(),
        parserVersion: context.STRUCTURAL_MESSAGE_SPEAKER_INDEX_VERSION,
        pageTitleEvidence: structuralEvidence,
    });

    const pageAnnotationKey = context.presentationPageAnnotationMemoryKey(snapshot, 0, pageIndex, pageWindow.coreSpan);
    const semanticEvidence = { ...structuralEvidence };
    delete semanticEvidence.ruleId;
    context.presentationPageAnalysisContextDigests.set(pageAnnotationKey, 'validated-page-context');
    context.presentationPageAnnotations.set(pageAnnotationKey, {
        pageTitleEvidence: semanticEvidence,
        sourceMessageIndex: 47,
        annotationVersion: 'galgame.presentation-annotation.v1',
        scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: 'arc',
        analyzerScope: 'scope-v1', contextDigest: 'validated-page-context',
        annotationProvenance: 'current-page-window.v1',
        publishedKnownEntitiesSourceFingerprint: '{}',
        coreSpan: { ...pageWindow.coreSpan }, viewSpan: { ...pageWindow.viewSpan },
        fullMessageHash: expectedFullHash,
        timelineSnapshot: createPresentationTimelineSnapshot(snapshot),
    });
    context.ensureStructuralPresentationPageTitle = async () => {};

    const beforeAnalysis = context.createPresentationPagesForMessage(snapshot, 0, snapshot.messages[0], pageIndex).pages[pageIndex];
    assert.equal(getPresentationSpeakerLabel(beforeAnalysis, snapshot.messages[0]), speakerText);
    assert.equal(beforeAnalysis.text, page.text, 'title metadata leaves body text unchanged');
    assert.deepEqual(beforeAnalysis.sourceSpan, page.sourceSpan, 'title metadata leaves body boundaries unchanged');
    assert.equal(beforeAnalysis.type, page.type, 'title metadata leaves the source parser page kind unchanged');
});

await test('page-window semantic context includes the paragraph gap without changing page ranges', () => {
    const text = '上一段。\n\n当前段。';
    const { sourceText, pages } = createOriginalSourcePages(text, 'character', 19, 'Author');
    const window = createPresentationPageWindow({ sourceText, pages, pageIndex: 1, lookbehindPages: 1 });
    assert.ok(window, 'the source parser page sequence provides a valid title-analysis window');
    assert.equal(window.viewText, sourceText, 'semantic lookbehind includes the original whitespace gap');
    assert.equal(window.coreText, '当前段。');
    assert.deepEqual(window.coreSpan, pages[1].sourceSpan, 'analysis core stays on the exact current source page');
    assert.equal(pages.map((page) => page.text).join('\n\n'), sourceText, 'page body sequence remains the GitHub source-derived layout');
});

await test('corrupt page cache is rejected against the exact current view and replaced by fresh validated analysis', async () => {
    const harness = await createLongPageAnalysisHarness({ corruptCachedAnnotation: true });
    await harness.context.analyzePresentationSnapshot(harness.snapshot, 0, { mode: 'assisted', pageIndex: harness.pageIndex });
    assert.equal(harness.cacheReads, 2, 'the active page-window cache and full-message singleton cache remain independent');
    assert.equal(harness.cacheDeletes.length, 1, 'invalid cached Annotation v1 is deleted');
    assert.equal(harness.analyzeCalls, 1, 'corrupt cache is treated as a miss and freshly analyzed');
    assert.equal(harness.freshValidation, true);
    assert.equal(harness.rendered.label, 'Alice', 'only the newly validated exact-view result can supply a title');
});

await test('page result arriving after page cursor changes is rejected before cache or render writeback', async () => {
    const harness = await createLongPageAnalysisHarness({ deferAnnotation: true });
    const pending = harness.context.analyzePresentationSnapshot(harness.snapshot, 0, { mode: 'assisted', pageIndex: harness.pageIndex });
    for (let attempt = 0; attempt < 30 && !harness.requests.length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(harness.requests.length, 1, 'active page request has started');
    harness.context.activeSegmentIndex = harness.pageIndex - 1;
    harness.resolveAnnotation(harness.requests[0]);
    await pending;
    assert.equal(harness.cachePuts.length, 0, 'stale response cannot populate persistent cache');
    assert.equal(harness.context.presentationPageAnnotations.size, 0, 'stale response cannot populate page memo');
    assert.equal(harness.renderedCount, 0, 'stale response cannot rerender a different page');
});

await test('presentation memo is replaced when analyzer scope or context digest changes', () => {
    const annotations = new Map();
    const context = vm.createContext({ presentationAnnotations: annotations, release: { releaseId: 'release', activeArcId: 'arc' }, manifest: {},
        PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
        PRESENTATION_ANNOTATION_VERSION: 'annotation-v1', PRESENTATION_IDENTITY_PROJECTION_VERSION: 'identity-v1', PRESENTATION_ROSTER_PROJECTION_VERSION: 'roster-v1' });
    load('presentationProjectionScope', context);
    load('presentationAnnotationMemoryKey', context);
    const remember = load('rememberPresentationAnnotation', context);
    const cacheKey = load('presentationCacheKey', context);
    const snapshot = { fileName: 'chat' };
    const sourceMessageHash = 'sha256:one';
    const source = { sourceMessageIndex: 4, sourceMessageHash, visibleText: 'Alice：“嗨”', timelinePrefixHash: 'sha256:prefix' };
    const annotation = { sourceMessageHash, segments: [] };
    const identity = { scenarioId: 'scenario', scenarioVersion: '1', publishedKnownEntitiesFingerprint: 'sha256:entities-a', annotationProvenance: 'current-message-singleton.v1' };
    assert.equal(remember(snapshot, 'release', 'arc', source, annotation, { contextDigest: 'ctx-a', analyzerScope: 'scope-a', timelinePrefixHash: 'sha256:prefix', ...identity }), true);
    assert.equal(remember(snapshot, 'release', 'arc', source, annotation, { contextDigest: 'ctx-a', analyzerScope: 'scope-a', timelinePrefixHash: 'sha256:prefix', ...identity }), false,
        'equal source, context, and analyzer scope reuses the exact memo');
    assert.equal(remember(snapshot, 'release', 'arc', source, annotation, { contextDigest: 'ctx-b', analyzerScope: 'scope-a', timelinePrefixHash: 'sha256:prefix', ...identity }), true,
        'a changed context digest invalidates the memo');
    assert.equal(remember(snapshot, 'release', 'arc', source, annotation, { contextDigest: 'ctx-b', analyzerScope: 'scope-b', timelinePrefixHash: 'sha256:prefix', ...identity }), true,
        'a changed analyzer scope invalidates the memo');
    assert.equal([...annotations.values()][0].contextDigest, 'ctx-b');
    assert.equal([...annotations.values()][0].analyzerScope, 'scope-b');
    const priorSingleton = annotations.get(context.presentationAnnotationMemoryKey(snapshot, 'release', 'arc', 4, 'scenario', '1'));
    assert.equal(remember(snapshot, 'release', 'arc', source, { sourceMessageHash, segments: [{ kind: 'batch-result' }] }, {
        contextDigest: 'ctx-b', analyzerScope: 'scope-b', timelinePrefixHash: 'sha256:prefix',
        ...identity, annotationProvenance: 'multi-message-batch.v1',
    }), false, 'a multi-message annotation cannot enter the singleton memo path');
    assert.equal(annotations.get(context.presentationAnnotationMemoryKey(snapshot, 'release', 'arc', 4, 'scenario', '1')), priorSingleton,
        'a non-singleton result cannot overwrite an existing singleton memo');
    const keyBase = { chatKey: 'chat-key', scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: 'arc', message: source, contextDigest: 'ctx-a', analyzerScope: 'scope-a', timelinePrefixHash: 'prefix-a', publishedKnownEntitiesFingerprint: 'sha256:entities-a' };
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, contextDigest: 'ctx-b' }), 'cache identity includes the context digest');
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, analyzerScope: 'scope-b' }), 'cache identity includes the analyzer scope');
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, timelinePrefixHash: 'prefix-b' }), 'cache identity includes the source timeline prefix');
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, scenarioId: 'other-scenario' }), 'cache identity includes the published scenario ID');
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, scenarioVersion: '2' }), 'cache identity includes the published scenario version');
    assert.notEqual(cacheKey(keyBase), cacheKey({ ...keyBase, publishedKnownEntitiesFingerprint: 'sha256:entities-b' }), 'cache identity includes the current published known-entities fingerprint');
});
await test('historical memo is excluded when provenance, scenario version, or published known entities change', async () => {
    const text = 'Alice：“我在。”';
    const sourceMessageHash = await hashVisibleMessage(text);
    const snapshot = { fileName: 'memo-scope-chat', messages: [{ role: 'character', index: 0, text }] };
    for (const mismatch of [
        { scenarioId: 'old-scenario', scenarioVersion: '2', publishedKnownEntitiesFingerprint: 'sha256:entities-current' },
        { scenarioVersion: '1', publishedKnownEntitiesFingerprint: 'sha256:entities-current' },
        { scenarioVersion: '2', publishedKnownEntitiesFingerprint: 'sha256:entities-old' },
    ]) {
        const context = vm.createContext({
            manifest: { scenarioId: 'scenario', scenarioVersion: '2', resourceBindings: { characters: {} } },
            release: { scenarioId: 'scenario', scenarioVersion: '2', releaseId: 'release', activeArcId: 'arc' },
            presentationAnalyzerScope: 'scope-current',
            PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
            presentationAnnotations: new Map(),
            createVisibleMessageHash: async () => sourceMessageHash,
            createSceneContinuityTimelinePrefixHash: async () => 'sha256:current-prefix',
            createPresentationTimelineSnapshot,
            canonicalJson: () => '{}',
            projectPresentationIdentityDetailed: async ({ messages }) => ({
                projection: { complete: messages.every((row) => Boolean(row.annotation)), chatKey: 'memo-scope-chat', entities: [], segmentSpeakers: [] },
                mentionIdentity: new Map(),
            }),
            projectPartyRoster: ({ identityProjection }) => ({ complete: identityProjection.projection.complete, entries: [] }),
            PRESENTATION_ANNOTATION_VERSION: 'galgame.presentation-annotation.v1',
            PRESENTATION_IDENTITY_PROJECTION_VERSION: 'galgame.identity-projection.v1',
            PRESENTATION_ROSTER_PROJECTION_VERSION: 'galgame.roster-projection.v1',
        });
        for (const name of ['currentPresentationScenarioId', 'currentPresentationScenarioVersion', 'presentationKnownEntitiesSourceFingerprint',
            'presentationProjectionScope', 'presentationAnnotationMemoryKey', 'buildPresentationProjectionState']) load(name, context);
        const currentKey = context.presentationAnnotationMemoryKey(snapshot, 'release', 'arc', 0, 'scenario', '2');
        context.presentationAnnotations.set(currentKey, {
            annotation: { sourceMessageIndex: 0, sourceMessageHash, segments: [] },
            sourceMessageHash,
            visibleText: text,
            contextDigest: 'sha256:context',
            analyzerScope: 'scope-current',
            timelinePrefixHash: 'sha256:current-prefix',
            scenarioId: mismatch.scenarioId || 'scenario',
            scenarioVersion: mismatch.scenarioVersion,
            publishedKnownEntitiesFingerprint: mismatch.publishedKnownEntitiesFingerprint,
            annotationProvenance: 'current-message-singleton.v1',
        });
        const state = await context.buildPresentationProjectionState(snapshot, 'release', 'arc', 0, null, {
            scenarioId: 'scenario',
            scenarioVersion: '2',
            publishedKnownEntitiesFingerprint: 'sha256:entities-current',
            publishedKnownEntitiesSourceFingerprint: '{}',
        });
        assert.equal(state.messages[0].annotation, null, 'a stale historical annotation is omitted from the current projection');
        assert.equal(state.projection.complete, false, 'stale history keeps identity projection incomplete');
        assert.equal(state.roster.complete, false, 'stale history cannot mark the roster complete');
    }
});
await test('corrupted cached Annotation v1 is deleted and never promoted after analyzer failure', async () => {
    const text = 'Alice：“你好。”';
    const sourceMessageHash = await hashVisibleMessage(text);
    const messages = [{ role: 'character', index: 0, text }];
    const snapshot = { fileName: 'corrupt-cache-chat', messages };
    let cacheDeleted = false; let annotationCalled = false; let rendered = false;
    const cachedAnnotation = {
        sourceMessageIndex: 0,
        sourceMessageHash,
        segments: [{ start: 0, end: Array.from(text).length, textHash: sourceMessageHash, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'text-explicit', confidenceBand: 'high', evidenceSpans: [{ start: 0, end: 5, purpose: 'speaker' }] }],
        entities: [{ mentionRef: 'm0', kind: 'person', surfaceSpan: { start: 0, end: 5 }, attributeEvidence: [] }],
        identityLinkCandidates: [{ fromMentionRef: 'm0', toResolverEntityRef: 'published:removed', relation: 'alias-of', evidenceSpans: [{ start: 0, end: 5, purpose: 'coreference' }], confidenceBand: 'high' }],
        stateClaims: [],
    };
    const staleKnownEntityValidation = await validatePresentationAnnotationResponse(
        { schemaVersion: 'galgame.presentation-annotation.v1', results: [cachedAnnotation] },
        { messages: [{ sourceMessageIndex: 0, sourceMessageHash, visibleText: text }], knownEntities: [] },
    );
    assert.equal(staleKnownEntityValidation.valid, false, 'the fixture is invalid specifically under the current known-entity set');
    assert.ok(staleKnownEntityValidation.errors.some((error) => error.includes('toResolverEntityRef')));
    const context = vm.createContext({
        AbortController, Date,
        manifest: { locale: 'zh-CN', scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', defaultArcId: 'arc', resourceBindings: { characters: {} } },
        release: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', activeArcId: 'arc' },
        presentationServiceState: true, presentationServiceRetryAt: 0, presentationAnalyzerScope: 'scope-v1',
        presentationAnalysisEpoch: 1, presentationAnalysisController: null, presentationAnalysisRunIdentity: null, presentationInflight: new Set(),
        PRESENTATION_SINGLETON_PROVENANCE: 'current-message-singleton.v1',
        presentationAnnotations: new Map(), presentationProjectionStates: new Map(),
        activeChatSnapshot: snapshot, activeMessageIndex: 0, activeSegmentIndex: 0,
        presentationCache: {
            reconcileTimeline: async () => {},
            get: async () => cachedAnnotation,
            delete: async () => { cacheDeleted = true; return true; },
            put: async () => {},
        },
        presentationAnalysis: {
            healthCheck: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'scope-v1' }),
            annotate: async () => { annotationCalled = true; throw new Error('simulated analyzer outage'); },
        },
        createPublishedPresentationKnownEntities: async () => ({ diagnostics: [], knownEntities: [] }),
        createPresentationContextDigest,
        validatePresentationAnnotationResponse,
        createPresentationBatches: async ({ messages: requestMessages }) => [{ messages: requestMessages, knownEntities: [], contextDigest: 'sha256:context' }],
        createVisibleMessageHash: hashVisibleMessage,
        sha256Hex: async (value) => `digest-${value}`,
        createSceneContinuityTimelinePrefixHash,
        createPresentationTimelineSnapshot,
        matchesPresentationTimelineSnapshot,
        projectPresentationIdentityDetailed: async () => ({ projection: { complete: false, chatKey: 'corrupt-cache-chat', entities: [], segmentSpeakers: [] }, mentionIdentity: new Map() }),
        projectPartyRoster: () => ({ complete: false, entries: [] }),
        createPresentationDisplaySegments,
        isPresentationProjectionTimelineCurrent,
        isPresentationTimelineSnapshotCurrent,
        selectPresentationAnalysisMessages,
        resolvePresentationMode,
        getPresentationSpeakerLabel,
        getPresentationVisualSpeakerContext,
        PRESENTATION_ANNOTATION_VERSION: 'galgame.presentation-annotation.v1',
        PRESENTATION_IDENTITY_PROJECTION_VERSION: 'galgame.identity-projection.v1',
        PRESENTATION_ROSTER_PROJECTION_VERSION: 'galgame.roster-projection.v1',
        renderChatSnapshot: () => { rendered = true; },
        canonicalJson: () => '{}',
    });
    for (const name of ['currentPresentationScenarioId', 'currentPresentationScenarioVersion', 'presentationKnownEntitiesSourceFingerprint',
        'presentationProjectionScope', 'presentationAnnotationMemoryKey', 'presentationCacheKey', 'rememberPresentationAnnotation',
        'buildPresentationProjectionState', 'isPresentationProjectionCurrent', 'getAssistedPresentationSegments',
        'isPresentationAnalysisSnapshotCurrent', 'analyzePresentationSnapshot']) load(name, context);
    await context.analyzePresentationSnapshot(snapshot, 0, { mode: 'assisted' });
    assert.equal(cacheDeleted, true, 'invalid cached result is evicted');
    assert.equal(annotationCalled, true, 'invalid cache result becomes a fresh analysis request');
    assert.equal(context.presentationAnnotations.size, 0, 'invalid cache result is never remembered in projection memory');
    assert.equal(context.presentationProjectionStates.size, 0, 'invalid cache result never creates a projection state');
    assert.equal(rendered, false, 'invalid cache result cannot render a speaker label');
});
await test('unknown immediate portrait skips all catalog and reservation work', async () => {
    const context = vm.createContext({ getActiveVisualSpeakerContext: () => ({ role: 'unknown', speaker: '未识别' }),
        recordSceneContinuityDiagnostic: () => {}, readCoreVisualContext: () => { throw Error('unknown queried catalog'); },
    });
    await load('renderCoreVisualImmediateCharacter', context)({ messages: [{ role: 'character' }] }, 0, 1);
});
await test('unknown placeholder is distinct from every catalog channel', () => {
    const context = vm.createContext({ CORE_UNKNOWN_SPEAKER_PLACEHOLDER_URL: 'unknown.svg', CORE_NARRATOR_PLACEHOLDER_URL: 'narrator.svg',
        CORE_PLAYER_PLACEHOLDER_URL: 'player.svg', CORE_VISUAL_PLACEHOLDER_URL: 'generic.svg',
    });
    const resolve = load('getCoreVisualPlaceholderUrl', context);
    assert.equal(resolve('unknown'), 'unknown.svg');
    for (const role of ['player', 'narrator', 'system', 'character']) assert.notEqual(resolve(role), 'unknown.svg');
});
await test('speaker labels never fall back to a message author for non-speaker segments', () => {
    const context = vm.createContext({ getPresentationSpeakerLabel });
    const resolve = load('getDisplayedSpeakerName', context);
    for (const [type, label] of [['stage-direction', '动作'], ['status', '状态'], ['choice', '选项'], ['other-visible', '正文'], ['unknown', '未识别']]) {
        assert.equal(resolve({ type, speaker: 'Author' }, { role: 'character', speaker: 'Author' }), label);
    }
});

await test('valid resolved carousel reserves unique portraits, rotates every 3s, and clears on continuation', async () => {
    const applied = []; const reservations = []; let rotate; let cleared = false;
    const context = vm.createContext({
        presentationCarouselEpoch: 1, presentationCarouselTimer: null, visualBundleRequestToken: 4,
        manifest: {}, release: { activeArcId: 'arc', releaseId: 'release' },
        coreVisualAvailability: { context: { visualProfile: { catalogId: 'catalog', catalogRevision: 1 }, characterChannels: [
            { assetId: 'portrait_a', assetVersion: 1, channel: 'character' },
            { assetId: 'portrait_b', assetVersion: 1, channel: 'character' },
        ] } },
        getCoreVisualServiceUrl: () => 'http://visual.test',
        resolveVisualCharacterBinding: (_manifest, { name, allowCharacterPoolFallback }) => {
            assert.equal(allowCharacterPoolFallback, false);
            return { assetId: name === 'Alice' ? 'portrait_a' : 'portrait_b', assetVersion: 1, channel: 'character' };
        },
        createCoreVisualDisplayEntityKey: async (_type, seed) => seed,
        reservePresentationPortraitBinding: (key, asset, scope) => { reservations.push([key, asset, scope.chatId]); return true; },
        identityKeyForPlayer: (identity) => `${identity.type}:${identity.id}`,
        createCoreVisualContentUrl: (decision) => decision.contentPath,
        resolveVisualRenderUrl: async (value) => value,
        applyCoreVisualCharacter: async (decision) => { applied.push(decision.assetId); },
        applyCoreVisualPlaceholderCharacter: () => { throw Error('valid carousel unexpectedly degraded'); },
        setInterval: (callback, ms) => { assert.equal(ms, 3000); rotate = callback; return 9; },
        clearInterval: (timer) => { assert.equal(timer, 9); cleared = true; },
    });
    const page = { speakerCandidates: [
        { speaker: 'Alice', identityRef: { type: 'published', id: 'a' } },
        { speaker: 'Bob', identityRef: { type: 'chat-local', id: 'b' } },
    ] };
    await load('renderPresentationPageCarousel', context)({ fileName: 'chat', messages: [{ role: 'character' }] }, 0, page, 4);
    assert.equal(applied[0], 'portrait_a');
    rotate(); assert.equal(applied[1], 'portrait_b');
    rotate(); assert.equal(applied[2], 'portrait_a');
    assert.equal(reservations.length, 2);
    assert.equal(new Set(reservations.map(([key]) => key)).size, 2);
    load('clearPresentationCarousel', context)();
    assert.equal(cleared, true); assert.equal(context.presentationCarouselTimer, null);
    const pinned = speakerContext({ type: 'dialogue', speaker: 'Bob', speakerContinuation: true, identityRef: { type: 'chat-local', id: 'b' } });
    assert.equal(pinned({ role: 'character', speaker: 'Author' }, 7).speaker, 'Bob');
});
await test('resolved portrait still requires the exact published character channel and uniqueness reservation', async () => {
    let applied = 0; let allowed = true; let actualChannel = 'narrator';
    const context = vm.createContext({
        manifest: {}, release: { activeArcId: 'arc', releaseId: 'release' }, visualBundleRequestToken: 4,
        activeRenderContext: {}, activeMessageIndex: 0, activeSegmentIndex: 0,
        activeMessageSegments: [{ type: 'dialogue', speaker: 'Alice', identityRef: { type: 'published', id: 'a' } }],
        coreVisualAvailability: { context: null }, immediateVisualCharacterIdentity: '', ui: { stageHeroine: { dataset: {} } },
        getActiveVisualSpeakerContext: () => ({ role: 'character', speaker: 'Alice' }),
        getCoreVisualServiceUrl: () => 'http://visual.test', recordSceneContinuityDiagnostic: () => {},
        readCoreVisualContext: async () => ({ visualProfile: { catalogId: 'catalog', catalogRevision: 1 }, characterChannels: [{ assetId: 'portrait_a', assetVersion: 1, channel: actualChannel }] }),
        resolveVisualCharacterBinding: () => ({ channel: 'character', assetId: 'portrait_a', assetVersion: 1 }),
        createCoreVisualDisplayEntityKey: async (_type, seed) => seed,
        reservePresentationPortraitBinding: (key) => { assert.equal(key, 'identity:published:a'); return allowed; },
        applyCoreVisualCharacter: async () => { applied++; context.ui.stageHeroine.dataset.visualAssetIdentity = 'portrait_a:1'; },
    });
    const render = load('renderCoreVisualImmediateCharacter', context);
    const snapshot = { fileName: 'chat', messages: [{ role: 'character', speaker: 'Author' }] };
    await render(snapshot, 0, 4); assert.equal(applied, 0, 'wrong asset channel must fail closed');
    actualChannel = 'character'; allowed = false;
    await render(snapshot, 0, 4); assert.equal(applied, 0, 'denied uniqueness reservation must fail closed');
    allowed = true;
    await render(snapshot, 0, 4); assert.equal(applied, 1, 'resolved identity keeps the exact published portrait');
});

await test('architecture guard requires direct historical segments before semantic overlays', async () => {
    const auditSource = await readFile(new URL('../../tools/static-architecture-audit.mjs', import.meta.url), 'utf8');
    const start = auditSource.indexOf('async function checkSafePresentationFallback(');
    const end = auditSource.indexOf('\nasync function ', start + 1);
    const body = auditSource.slice(start, end);
    const paginatorMutation = source.replace('const basePages = nonEmptySegments;',
        'const basePages = createPresentationPages({ segments: projectedSegments || nonEmptySegments, sourceText, sourceMessageIndex });');
    for (const [candidate, expected] of [[source, true], [paginatorMutation, false]]) {
        const checks = [];
        const context = vm.createContext({
            readRepoFile: async (relativePath) => relativePath === 'frontend/player/src/presentation-renderer.js' ? rendererSource : candidate,
            checks,
        });
        await vm.runInContext(`(${body})`, context)();
        assert.equal(checks[0].ok, expected);
    }
});
