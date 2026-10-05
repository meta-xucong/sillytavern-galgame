import assert from 'node:assert/strict';
import { createPresentationAnnotationRequest, createVisibleMessageHash } from '../../frontend/shared/src/presentation-annotation.js';
import { createSceneContinuityAnalysisRequest } from '../../frontend/shared/src/scene-continuity-analysis.js';

process.env.GALGAME_PRESENTATION_ANALYZER_PROVIDER = 'anthropic';
process.env.GALGAME_PRESENTATION_ANALYZER_BASE_URL = 'https://provider.example';
process.env.GALGAME_PRESENTATION_ANALYZER_API_KEY = 'hidden-test-value';
process.env.GALGAME_PRESENTATION_ANALYZER_MODEL = 'model-test';
process.env.GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS = 'provider.example';
const {
    server,
    loadConfig,
    invokeProvider,
    createPresentationAnalyzerInput,
    materializePresentationAnalyzerCandidate,
    PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
    PRESENTATION_MODEL_CANDIDATE_VERSION,
} = await import('./server.mjs?scene-continuity-test');
const {
    SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA,
    validateSceneContinuityAnalysisModelOutput,
} = await import('./scene-continuity-contract.mjs');

const invalid = loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'http://127.0.0.1',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'test',
    GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS: '127.0.0.1',
});
assert.equal(invalid, null);
const disallowed = loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://provider.example',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'test',
    GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS: 'other.example',
});
assert.equal(disallowed, null);

const exactVisibleText = 'Mira说：“好。”';
const localAnnotationRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'chat_private_scope' },
    messages: [{
        sourceMessageIndex: 8,
        sourceMessageHash: await createVisibleMessageHash(exactVisibleText),
        authorLabel: 'message-channel-must-not-be-used',
        visibleText: exactVisibleText,
    }],
    knownEntities: [{
        resolverEntityRef: 'published:mira',
        visibleNames: ['Mira'],
        evidenceDigest: await createVisibleMessageHash('published:mira|Mira'),
        attributes: [],
    }],
    requestId: '19389206-b600-4c87-986a-56f797842dc4',
});
const providerSafeInput = createPresentationAnalyzerInput(localAnnotationRequest);
assert.equal(Object.hasOwn(providerSafeInput, 'requestId'), false, 'internal request IDs are stripped before provider calls');
assert.equal(Object.hasOwn(providerSafeInput, 'scope'), false, 'chat and release scope are stripped before provider calls');
assert.equal(providerSafeInput.messages[0].authorLabel, '', 'message-level author channels are never forwarded as speaker hints');
assert.equal(providerSafeInput.messages[0].visibleText, exactVisibleText, 'visible source text remains unchanged for evidence offsets');
assert.equal(Object.hasOwn(providerSafeInput.messages[0], 'sourceMessageIndex'), false, 'provider input omits deterministic source indexes');
assert.equal(Object.hasOwn(providerSafeInput.messages[0], 'sourceMessageHash'), false, 'provider input omits deterministic source hashes');
assert.equal(Object.hasOwn(providerSafeInput.knownEntities[0], 'evidenceDigest'), false, 'provider input omits deterministic entity digests');

const candidateForLocalRequest = {
    schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION,
    results: [{
        segments: [
            { startAnchor: { beforeText: '', afterText: 'Mira说：' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
            { startAnchor: { beforeText: '说：', afterText: '“' }, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'quoted-attribution', confidenceBand: 'high', evidenceQuotes: [{ text: 'Mira说：', purpose: 'speaker' }] },
        ],
        entities: [{ mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira说：', kind: 'person', attributeEvidence: [] }],
        identityLinkCandidates: [],
        stateClaims: [],
    }],
};
const materialized = await materializePresentationAnalyzerCandidate(candidateForLocalRequest, localAnnotationRequest);
assert.equal(materialized.valid, true, 'service validates speaker evidence in an adjacent narration segment');
assert.equal(materialized.response.results[0].sourceMessageIndex, 8, 'service binds the source index locally');
assert.equal(materialized.response.results[0].sourceMessageHash, localAnnotationRequest.messages[0].sourceMessageHash, 'service binds the source message hash locally');
assert.equal(materialized.response.results[0].segments[0].textHash, await createVisibleMessageHash('Mira说：'), 'service calculates segment hashes locally');
assert.deepEqual(materialized.response.results[0].segments[1].evidenceSpans, [{ start: 0, end: 6, purpose: 'speaker' }],
    'service resolves exact quote evidence to Unicode code-point ranges');
assert.deepEqual(materialized.response.results[0].entities[0].surfaceSpan, { start: 0, end: 4 },
    'service resolves a surface mention inside its unique context quote');
assert.deepEqual(await materializePresentationAnalyzerCandidate({ schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION, results: [] }, localAnnotationRequest),
    { valid: false, errors: ['candidate.results.count'] }, 'safe structural diagnostics distinguish missing result coverage');
assert.deepEqual(await materializePresentationAnalyzerCandidate({ ...candidateForLocalRequest, unexpected: true }, localAnnotationRequest),
    { valid: false, errors: ['candidate.keys.extra'] }, 'safe structural diagnostics reject extra top-level output keys without logging values');
assert.deepEqual(await materializePresentationAnalyzerCandidate({ schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION }, localAnnotationRequest),
    { valid: false, errors: ['candidate.keys.missing.results'] }, 'safe structural diagnostics identify a missing required field without logging values');
const candidateWithDerivedMetadata = structuredClone(candidateForLocalRequest);
candidateWithDerivedMetadata.results[0].segments[0].start = 0;
assert.equal((await materializePresentationAnalyzerCandidate(candidateWithDerivedMetadata, localAnnotationRequest)).valid, false,
    'candidate must not supply service-owned offsets');
const incompleteCandidate = structuredClone(candidateForLocalRequest);
incompleteCandidate.results[0].segments[1].startAnchor.afterText = '好';
assert.equal((await materializePresentationAnalyzerCandidate(incompleteCandidate, localAnnotationRequest)).valid, false,
    'candidate boundary quotes that do not occur contiguously in source are rejected');
const ambiguousSpeakerQuote = structuredClone(candidateForLocalRequest);
ambiguousSpeakerQuote.results[0].segments[1].evidenceQuotes[0].text = '说';
assert.equal((await materializePresentationAnalyzerCandidate(ambiguousSpeakerQuote, localAnnotationRequest)).valid, false,
    'speaker evidence quotes must identify one exact source occurrence and cover the person mention');

const repeatedBoundaryText = 'A::B::C::D';
const repeatedBoundaryRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'repeated-boundaries' },
    messages: [{ sourceMessageIndex: 9, sourceMessageHash: await createVisibleMessageHash(repeatedBoundaryText), authorLabel: '', visibleText: repeatedBoundaryText }],
    knownEntities: [],
});
const repeatedBoundaryCandidate = {
    schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION,
    results: [{
        segments: [
            { startAnchor: { beforeText: '', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
            { startAnchor: { beforeText: ':', afterText: ':' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
            { startAnchor: { beforeText: 'B:', afterText: ':C' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
        ],
        entities: [], identityLinkCandidates: [], stateClaims: [],
    }],
};
const orderedRepeatedBoundaries = await materializePresentationAnalyzerCandidate(repeatedBoundaryCandidate, repeatedBoundaryRequest);
assert.equal(orderedRepeatedBoundaries.valid, true,
    'repeated exact boundary quotes are accepted only when full source order resolves one unique boundary sequence');
assert.deepEqual(orderedRepeatedBoundaries.response.results[0].segments.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 2 }, { start: 2, end: 5 }, { start: 5, end: Array.from(repeatedBoundaryText).length },
]);
const ambiguousRepeatedBoundaries = structuredClone(repeatedBoundaryCandidate);
ambiguousRepeatedBoundaries.results[0].segments[2].startAnchor = { beforeText: ':', afterText: ':' };
const unresolvedBoundaryCandidate = await materializePresentationAnalyzerCandidate(ambiguousRepeatedBoundaries, repeatedBoundaryRequest);
assert.equal(unresolvedBoundaryCandidate.valid, false,
    'repeated anchors remain rejected when multiple monotonic segmentations are possible');
assert.ok(unresolvedBoundaryCandidate.errors.includes('candidate.results.0.segments.boundaries'));
const denseAnchorText = 'A'.repeat(1500);
const denseAnchorRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'dense-boundaries' },
    messages: [{ sourceMessageIndex: 10, sourceMessageHash: await createVisibleMessageHash(denseAnchorText), authorLabel: '', visibleText: denseAnchorText }],
    knownEntities: [],
});
const denseAnchorCandidate = structuredClone(repeatedBoundaryCandidate);
denseAnchorCandidate.results[0].segments = [
    { startAnchor: { beforeText: '', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
    { startAnchor: { beforeText: 'A', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
];
assert.equal((await materializePresentationAnalyzerCandidate(denseAnchorCandidate, denseAnchorRequest)).valid, false,
    'an extremely repetitive anchor fails closed after a bounded linear scan');
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties, 'sourceMessageIndex'), false);
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties, 'start'), false);
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties, 'textHash'), false);

const originalFetch = globalThis.fetch;
let providerUrl;
let providerBody;
const emptyCandidate = { schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION, results: [] };
globalThis.fetch = async (url, init) => {
    providerUrl = new URL(url).pathname;
    providerBody = JSON.parse(init.body);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['x-api-key'], 'hidden-test-value');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(emptyCandidate) }] }), { status: 200 });
};
try {
    const config = loadConfig({
        GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
        GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://provider.example',
        GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
        GALGAME_PRESENTATION_ANALYZER_MODEL: 'model-test',
        GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS: 'provider.example',
    });
    const parsed = await invokeProvider(config, { messages: [] });
    assert.equal(providerUrl, '/v1/messages');
    assert.match(providerBody.system, /identityLinkCandidates/u);
    assert.match(providerBody.system, /additionalProperties/u);
    assert.match(providerBody.system, /galgame\.presentation-analyzer-candidate\.v1/u);
    assert.match(providerBody.system, /service attaches source-message indexes and message hashes/u);
    assert.match(providerBody.system, /quotation marks alone do not prove a speaker/u);
    assert.match(providerBody.system, /unattributed-dialogue rather than guessing/u);
    assert.equal(parsed.schemaVersion, PRESENTATION_MODEL_CANDIDATE_VERSION);
    let attempts = 0;
    globalThis.fetch = async () => {
        attempts += 1;
        if (attempts === 1) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(emptyCandidate) }] }), { status: 200 });
    };
    await invokeProvider(config, { messages: [] });
    assert.equal(attempts, 2, 'transient provider failures receive exactly one retry');

    const compatibleConfig = loadConfig({
        GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'openai-compatible',
        GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://provider.example',
        GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
        GALGAME_PRESENTATION_ANALYZER_MODEL: 'model-test',
        GALGAME_PRESENTATION_ANALYZER_ALLOWED_HOSTS: 'provider.example',
    });
    const providerFormats = [];
    let providerTemperature;
    let providerSystemPrompt;
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        providerFormats.push(requestBody.response_format);
        providerTemperature = requestBody.temperature;
        providerSystemPrompt = requestBody.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    };
    const structuredResult = await invokeProvider(
        compatibleConfig,
        { pageText: '场景文本' },
        '只分析输入',
        null,
        SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA,
        'scene_continuity',
    );
    assert.deepEqual(structuredResult, { ok: true });
    assert.deepEqual(providerFormats, [{
        type: 'json_schema',
        json_schema: { name: 'scene_continuity', strict: true, schema: SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA },
    }], 'OpenAI-compatible scene requests use strict structured output');
    assert.equal(providerTemperature, 0, 'presentation extraction uses deterministic temperature');

    providerFormats.length = 0;
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        providerFormats.push(requestBody.response_format);
        providerSystemPrompt = requestBody.messages[0].content;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    };
    await invokeProvider(
        compatibleConfig,
        { messages: [] },
        '只分析输入\nRequired candidate JSON Schema: duplicated schema should be removed',
        null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
        'presentation_analyzer_candidate',
    );
    assert.deepEqual(providerFormats, [{
        type: 'json_schema',
        json_schema: { name: 'presentation_analyzer_candidate', strict: true, schema: PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA },
    }], 'OpenAI-compatible identity annotation requests use the provider-facing candidate schema');
    assert.equal(providerSystemPrompt, '只分析输入', 'structured mode sends the schema once via response_format, not duplicated in system text');

    providerFormats.length = 0;
    const fallbackSystemPrompts = [];
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        providerFormats.push(requestBody.response_format);
        fallbackSystemPrompts.push(requestBody.messages[0].content);
        if (providerFormats.length === 1) return new Response('{}', { status: 400 });
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    };
    const fallbackResult = await invokeProvider(
        compatibleConfig,
        { pageText: '场景文本' },
        '只分析输入',
        null,
        SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA,
        'scene_continuity',
    );
    assert.deepEqual(fallbackResult, { ok: true });
    assert.deepEqual(providerFormats, [
        { type: 'json_schema', json_schema: { name: 'scene_continuity', strict: true, schema: SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA } },
        { type: 'json_object' },
    ], 'a rejected schema format gets one bounded JSON-mode compatibility retry');
    assert.equal(fallbackSystemPrompts[0], '只分析输入', 'initial structured request omits duplicate system schema');
    assert.match(fallbackSystemPrompts[1], /Required output JSON Schema:/u, 'JSON-mode fallback carries the schema once in system text');

    let malformedAttempts = 0;
    globalThis.fetch = async () => {
        malformedAttempts += 1;
        const content = malformedAttempts === 1 ? '{' : JSON.stringify({ recovered: true });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
    const recoveredResult = await invokeProvider(compatibleConfig, { pageText: '场景文本' }, '只分析输入');
    assert.deepEqual(recoveredResult, { recovered: true });
    assert.equal(malformedAttempts, 2, 'malformed model JSON receives exactly one bounded retry');

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: {
        content: '结果如下：\n```json\n{"wrapped":true}\n```\n以上为结构化结果。',
    } }] }), { status: 200 });
    const wrappedJsonResult = await invokeProvider(compatibleConfig, { pageText: '场景文本' }, '只分析输入');
    assert.deepEqual(wrappedJsonResult, { wrapped: true }, 'one unambiguous JSON object can be recovered from common gateway wrappers');

    let validationAttempts = 0;
    let validationRetryPrompt = '';
    const validationSystemPrompts = [];
    const validationResponseFormats = [];
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        validationRetryPrompt = requestBody.messages[0].content;
        validationSystemPrompts.push(requestBody.messages[0].content);
        validationResponseFormats.push(requestBody.response_format);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidate: true }) } }] }), { status: 200 });
    };
    const validatedResult = await invokeProvider(
        compatibleConfig,
        { messages: [] },
        '按给定文本输出证据\nRequired candidate JSON Schema: duplicated schema should be removed',
        null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
        'presentation_analyzer_candidate',
        async () => ({ valid: ++validationAttempts === 2, errors: ['response.evidence-span'] }),
    );
    assert.deepEqual(validatedResult, { candidate: true });
    assert.equal(validationAttempts, 2, 'semantic validation failure triggers one bounded regeneration');
    assert.match(validationRetryPrompt, /response\.evidence-span/u, 'safe validator paths are passed to the bounded repair prompt');
    assert.equal(validationSystemPrompts[0], '按给定文本输出证据', 'candidate schema is absent from structured-mode system prompt');
    assert.equal(validationSystemPrompts[1].includes('Required candidate JSON Schema:'), false, 'validation retry does not reintroduce duplicate candidate schema');
    assert.match(validationSystemPrompts[1], /Required output JSON Schema:/u, 'validation rejection switches to JSON mode with one prompt schema');
    assert.deepEqual(validationResponseFormats.map((format) => format.type), ['json_schema', 'json_object'],
        'a provider response that violates accepted strict schema mode gets one bounded JSON-mode retry');

    let exhaustedCalls = 0;
    globalThis.fetch = async (_url, init) => {
        exhaustedCalls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ candidate: true }) } }] }), { status: 200 });
    };
    await assert.rejects(invokeProvider(
        compatibleConfig,
        { messages: [] },
        '只分析输入\nRequired candidate JSON Schema: duplicated schema should be removed',
        null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
        'presentation_analyzer_candidate',
        async () => ({ valid: false, errors: ['candidate.results.count'] }),
    ), (error) => {
        assert.equal(error.code, 'INVALID_MODEL_OUTPUT');
        assert.deepEqual(error.attemptTrace.map((row) => row.outcome), ['invalid-output', 'invalid-output', 'invalid-output']);
        assert.deepEqual(error.attemptTrace.map((row) => row.modes.at(-1)), ['json_schema', 'json_object', 'json_object']);
        assert.deepEqual(error.attemptTrace.map((row) => row.validationCategories), [['count'], ['count'], ['count']],
            'attempt diagnostics retain only fixed validation categories, not candidate-controlled path values');
        assert.equal(error.attemptTrace.some((row) => Object.hasOwn(row, 'text') || Object.hasOwn(row, 'response')), false,
            'attempt diagnostics contain no model text or response payload');
        return true;
    });
    assert.equal(exhaustedCalls, 3, 'strict-to-JSON recovery remains bounded to three provider attempts');

    let frozenFailureCalls = 0;
    globalThis.fetch = async () => {
        frozenFailureCalls += 1;
        throw Object.freeze(new TypeError('private transport detail'));
    };
    await assert.rejects(invokeProvider(compatibleConfig, { messages: [] }, '只分析输入', null, PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA), (error) => {
        assert.equal(error.message, 'analysis provider request failed', 'provider failure wrappers do not preserve private transport messages');
        assert.equal(JSON.stringify(error).includes('private transport detail'), false);
        assert.equal(error.attemptTrace.length, 2, 'diagnostics survive non-extensible platform errors across a transient retry');
        assert.deepEqual(error.attemptTrace.map((row) => row.modes), [['json_schema'], ['json_schema']]);
        assert.deepEqual(error.attemptTrace.map((row) => row.outcome), ['provider-error', 'provider-error']);
        return true;
    });
    assert.equal(frozenFailureCalls, 2, 'transport failure retry remains bounded');
} finally {
    globalThis.fetch = originalFetch;
}

await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
try {
    const address = server.address();
    const health = await fetch(`http://127.0.0.1:${address.port}/v1/health`, { headers: { origin: 'http://127.0.0.1:8001' } });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8001');
    const payload = await health.json();
    assert.equal(payload.serviceReady, true);
    assert.equal(typeof payload.analyzerConfigured, 'boolean');
    assert.match(payload.analyzerScope, /presentation-annotator\.v7/u);
    assert.match(payload.sceneAnalyzerScope, /scene-continuity-analyzer\.v4:galgame\.scene-continuity-analysis\.v1/u);
    const healthPrivateNetworkPreflight = await fetch(`http://127.0.0.1:${address.port}/v1/health`, {
        method: 'OPTIONS',
        headers: {
            origin: 'http://127.0.0.1:8001',
            'access-control-request-method': 'GET',
            'access-control-request-private-network': 'true',
        },
    });
    assert.equal(healthPrivateNetworkPreflight.status, 204);
    assert.equal(healthPrivateNetworkPreflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:8001');
    assert.equal(healthPrivateNetworkPreflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
    assert.equal(healthPrivateNetworkPreflight.headers.get('access-control-allow-private-network'), 'true');
    const deniedHealthPreflight = await fetch(`http://127.0.0.1:${address.port}/v1/health`, {
        method: 'OPTIONS',
        headers: {
            origin: 'http://unapproved.invalid',
            'access-control-request-method': 'GET',
            'access-control-request-private-network': 'true',
        },
    });
    assert.equal(deniedHealthPreflight.status, 403);
    const wrongMethodHealthPreflight = await fetch(`http://127.0.0.1:${address.port}/v1/health`, {
        method: 'OPTIONS',
        headers: {
            origin: 'http://127.0.0.1:8001',
            'access-control-request-method': 'POST',
            'access-control-request-private-network': 'true',
        },
    });
    assert.equal(wrongMethodHealthPreflight.status, 403);
    const suffixSpoofHealthPreflight = await fetch(`http://127.0.0.1:${address.port}/v1/health`, {
        method: 'OPTIONS',
        headers: {
            origin: 'http://127.0.0.1:8001.evil.invalid',
            'access-control-request-method': 'GET',
            'access-control-request-private-network': 'true',
        },
    });
    assert.equal(suffixSpoofHealthPreflight.status, 403);

    const originalRouteFetch = globalThis.fetch;
    let capturedProviderInput;
    globalThis.fetch = async (url, init = {}) => {
        if (new URL(url).hostname === 'provider.example') {
            capturedProviderInput = JSON.parse(init.body);
            return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(candidateForLocalRequest) }] }), { status: 200 });
        }
        return originalRouteFetch(url, init);
    };
    try {
        const annotationResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
            method: 'POST',
            headers: {
                origin: 'http://127.0.0.1:8001',
                'content-type': 'application/json',
                'x-galgame-presentation-version': '1',
            },
            body: JSON.stringify(localAnnotationRequest),
        });
        assert.equal(annotationResponse.status, 200, 'service materializes the candidate into the stable annotation v1 contract');
        const annotation = await annotationResponse.json();
        assert.equal(annotation.schemaVersion, 'galgame.presentation-annotation.v1');
        assert.equal(annotation.results[0].sourceMessageIndex, 8);
        assert.equal(annotation.results[0].sourceMessageHash, localAnnotationRequest.messages[0].sourceMessageHash);
        assert.equal(annotation.results[0].segments[1].speakerMentionRef, 'm0');
        assert.equal(annotation.results[0].segments[1].textHash, await createVisibleMessageHash('“好。”'));
        assert.deepEqual(JSON.parse(capturedProviderInput.messages[0].content), {
            contextMessages: [],
            messages: [{ role: 'assistant', authorLabel: '', visibleText: exactVisibleText }],
            knownEntities: [{ resolverEntityRef: 'published:mira', visibleNames: ['Mira'], attributes: [] }],
        }, 'provider receives only the exact visible text and semantic context required for analysis');
        assert.equal(JSON.stringify(annotation).includes('presentation-analyzer-candidate'), false,
            'the provider candidate DTO does not leak into the stable browser response');
    } finally {
        globalThis.fetch = originalRouteFetch;
    }

    const diagnosticLeakToken = 'm7DiagnosticLeak42';
    const diagnosticText = 'Mira（female）说：“好。”';
    const diagnosticRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'diagnostic-redaction' },
        messages: [{ sourceMessageIndex: 9, sourceMessageHash: await createVisibleMessageHash(diagnosticText), authorLabel: '', visibleText: diagnosticText }],
        knownEntities: [],
    });
    const diagnosticCandidate = {
        schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION,
        results: [{
            segments: [
                { startAnchor: { beforeText: '', afterText: 'Mira（female）说：' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [] },
                { startAnchor: { beforeText: '说：', afterText: '“' }, kind: 'dialogue', speakerMentionRef: diagnosticLeakToken, speakerSource: 'quoted-attribution', confidenceBand: 'high', evidenceQuotes: [{ text: 'Mira（female）说：', purpose: 'speaker' }] },
            ],
            entities: [{
                mentionRef: diagnosticLeakToken, surfaceText: 'Mira', contextText: 'Mira（female）说：', kind: 'person',
                attributeEvidence: [{ category: 'gender', value: 'female', evidenceText: 'female）说：“好。”' }],
            }],
            identityLinkCandidates: [], stateClaims: [],
        }],
    };
    const diagnosticCapturedLogs = [];
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = function captureDiagnosticStderr(chunk, ...args) {
        diagnosticCapturedLogs.push(String(chunk));
        return true;
    };
    const originalDiagnosticFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init = {}) => {
            if (new URL(url).hostname === 'provider.example') {
                return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(diagnosticCandidate) }] }), { status: 200 });
            }
            return originalDiagnosticFetch(url, init);
        };
        const diagnosticResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
            method: 'POST',
            headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
            body: JSON.stringify(diagnosticRequest),
        });
        assert.equal(diagnosticResponse.status, 502, 'malformed model mention references remain rejected');
    } finally {
        globalThis.fetch = originalDiagnosticFetch;
        process.stderr.write = originalStderrWrite;
    }
    const diagnosticEvent = diagnosticCapturedLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-rejected');
    assert.ok(diagnosticEvent, 'the rejected model candidate emits a structured safe diagnostic');
    assert.equal(JSON.stringify(diagnosticEvent).includes(diagnosticLeakToken), false,
        'model-controlled mention references cannot enter diagnostics even when they use log-safe characters');
    assert.ok(diagnosticEvent.validationCategories.includes('attribute-outside-segments'),
        'validation diagnostics identify entity error class without copying model-controlled paths');
    assert.equal(diagnosticEvent.validationIssueCount > 0, true, 'safe diagnostics preserve bounded issue counts');

    const extraKeyLogs = [];
    process.stderr.write = function captureExtraKeyStderr(chunk, ...args) {
        extraKeyLogs.push(String(chunk));
        return true;
    };
    const originalExtraKeyFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init = {}) => {
            if (new URL(url).hostname === 'provider.example') {
                return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({
                    ...diagnosticCandidate,
                    [diagnosticLeakToken]: true,
                }) }] }), { status: 200 });
            }
            return originalExtraKeyFetch(url, init);
        };
        const extraKeyResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
            method: 'POST',
            headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
            body: JSON.stringify(diagnosticRequest),
        });
        assert.equal(extraKeyResponse.status, 502, 'candidates with unexpected top-level keys remain rejected');
    } finally {
        globalThis.fetch = originalExtraKeyFetch;
        process.stderr.write = originalStderrWrite;
    }
    const extraKeyEvent = extraKeyLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-rejected');
    assert.ok(extraKeyEvent?.validationCategories.includes('extra-key'), 'safe diagnostics classify an unexpected field without copying its name');
    assert.equal(JSON.stringify(extraKeyEvent).includes(diagnosticLeakToken), false, 'unexpected model field names cannot enter diagnostics');

    const scenePreflight = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
        method: 'OPTIONS',
        headers: { origin: 'http://127.0.0.1:8001' },
    });
    assert.equal(scenePreflight.status, 204);
    assert.equal(scenePreflight.headers.get('access-control-allow-headers'), 'content-type, x-galgame-scene-continuity-version');
    const sceneScope = {
        chatId: 'existing-chat', releaseId: 'release-test', arcId: 'arc-main',
        catalogId: 'catalog_test_01', catalogRevision: 1, catalogHash: `sha256:${'a'.repeat(64)}`,
    };
    const sceneText = '夜幕下，马车穿过贵族区。';
    const sceneRequest = await createSceneContinuityAnalysisRequest({
        scope: sceneScope,
        messageId: '9',
        pageIndex: 4,
        pageText: sceneText,
        contextPages: [{ pageText: '上一屏在驿站。' }],
        previousScene: { sceneKey: 'scene_previous', displayLabel: '驿站' },
        requestId: '19389206-b600-4c87-986a-56f797842dc4',
    });
    const validModelOutput = {
        confidenceBand: 'high',
        currentLocationText: '贵族区',
        transitionActionText: '穿过',
        referencedLocationTexts: [],
        visualTags: [],
    };
    const oversizedDisjointTags = await validateSceneContinuityAnalysisModelOutput({
        ...validModelOutput,
        visualTags: Array.from({ length: 9 }, () => ({ code: 'scene.night', evidenceText: '夜' })),
    }, sceneRequest);
    assert.equal(oversizedDisjointTags.valid, false, 'dropping unsupported evidence must not hide an oversized raw tag array');
    assert.deepEqual(oversizedDisjointTags.errors, ['SCENE_VISUAL_TAGS_SHAPE']);
    const oversizedMixedTags = await validateSceneContinuityAnalysisModelOutput({
        ...validModelOutput,
        visualTags: [
            ...Array.from({ length: 8 }, () => ({ code: 'scene.day', evidenceText: '贵' })),
            { code: 'scene.night', evidenceText: '夜' },
        ],
    }, sceneRequest);
    assert.equal(oversizedMixedTags.valid, false, 'dropping one disjoint tag must not reduce an oversized raw array to the allowed limit');
    assert.deepEqual(oversizedMixedTags.errors, ['SCENE_VISUAL_TAGS_SHAPE']);
    const unknownTag = await validateSceneContinuityAnalysisModelOutput({
        ...validModelOutput,
        visualTags: [{ code: 'scene.unknown', evidenceText: '贵' }],
    }, sceneRequest);
    assert.equal(unknownTag.valid, false, 'unknown tags must survive normalization and fail closed validation');
    assert.deepEqual(unknownTag.errors, ['SCENE_VISUAL_TAGS_SHAPE']);
    const malformedTag = await validateSceneContinuityAnalysisModelOutput({
        ...validModelOutput,
        visualTags: [{ code: 'scene.night', evidenceText: '夜', extra: true }],
    }, sceneRequest);
    assert.equal(malformedTag.valid, false, 'malformed tags must survive normalization and fail closed validation');
    assert.deepEqual(malformedTag.errors, ['SCENE_VISUAL_TAGS_SHAPE']);
    const repeatedQuote = await validateSceneContinuityAnalysisModelOutput({
        ...validModelOutput,
        currentLocationText: '的',
    }, sceneRequest);
    assert.equal(repeatedQuote.valid, false, 'repeated evidence quotes fail closed instead of guessing which occurrence is meant');
    assert.deepEqual(repeatedQuote.errors, ['SCENE_CURRENT_LOCATION_QUOTE_INVALID']);
    const repeatedOptionalEvidenceRequest = await createSceneContinuityAnalysisRequest({
        scope: sceneScope,
        messageId: '11',
        pageIndex: 6,
        pageText: '贵族区城门前，车队离开贵族区。',
        requestId: '2e01f00a-34bc-49cc-8f08-b59bfb8c9422',
    });
    const repeatedOptionalEvidence = await validateSceneContinuityAnalysisModelOutput({
        confidenceBand: 'high',
        currentLocationText: '贵族区城门前',
        transitionActionText: '离开',
        referencedLocationTexts: ['贵族区'],
        visualTags: [{ code: 'scene.city', evidenceText: '贵族区' }],
    }, repeatedOptionalEvidenceRequest);
    assert.equal(repeatedOptionalEvidence.valid, true,
        'unresolvable optional quotes are discarded without losing exact core location and transition evidence');
    assert.deepEqual(repeatedOptionalEvidence.response.referencedLocations, []);
    assert.deepEqual(repeatedOptionalEvidence.response.visualTags, []);
    const emojiRequest = await createSceneContinuityAnalysisRequest({
        scope: sceneScope,
        messageId: '10',
        pageIndex: 5,
        pageText: '😀夜幕下进入石室。',
        requestId: 'b433d7d5-1711-4c2b-a48d-9123511cf1be',
    });
    const emojiQuote = await validateSceneContinuityAnalysisModelOutput({
        confidenceBand: 'high',
        currentLocationText: '石室',
        transitionActionText: '进入',
        referencedLocationTexts: [],
        visualTags: [],
    }, emojiRequest);
    assert.equal(emojiQuote.valid, true);
    assert.deepEqual(emojiQuote.response.currentLocation, { start: 6, end: 8 },
        'the service derives code point spans from exact quotes even when an astral symbol precedes them');
    const providerCalls = [];
    const priorFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        if (new URL(url).hostname === 'provider.example') {
            const providerPayload = JSON.parse(init.body);
            const providerInput = JSON.parse(providerPayload.messages[0].content);
            providerCalls.push({ providerPayload, providerInput });
            assert.match(providerPayload.system, /currentLocationText/u);
            assert.match(providerPayload.system, /Do not calculate or output numeric offsets/u);
            assert.match(providerPayload.system, /environment modifiers/u);
            assert.match(providerPayload.system, /transition-from/u);
            return new Response(JSON.stringify({ content: [{
                type: 'text',
                text: JSON.stringify({
                    confidenceBand: 'high',
                    currentLocationText: '贵族区',
                    transitionActionText: '穿过',
                    referencedLocationTexts: [],
                    visualTags: [{ code: 'scene.night', evidenceText: '夜幕' }],
                }),
            }] }), { status: 200 });
        }
        return priorFetch(url, init);
    };
    try {
        const sceneResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
            method: 'POST',
            headers: {
                origin: 'http://127.0.0.1:8001',
                'content-type': 'application/json',
                'x-galgame-scene-continuity-version': '1',
            },
            body: JSON.stringify(sceneRequest),
        });
        assert.equal(sceneResponse.status, 200);
        const sceneResponseBody = await sceneResponse.json();
        assert.equal(sceneResponseBody.schemaVersion, 'galgame.scene-continuity-analysis.v1');
        assert.equal(sceneResponseBody.requestId, sceneRequest.requestId);
        assert.equal(sceneResponseBody.pageTextSha256, sceneRequest.segment.pageTextSha256);
        assert.deepEqual(sceneResponseBody.currentLocation, { start: 8, end: 11 });
        assert.deepEqual(sceneResponseBody.transitionAction, { start: 6, end: 8 });
        assert.deepEqual(sceneResponseBody.visualTags, [], 'unsupported optional modifier evidence is dropped without losing valid location and transition evidence');
        assert.equal(providerCalls.length, 1);
        assert.deepEqual(Object.keys(providerCalls[0].providerInput).sort(), ['contextPages', 'pageText', 'previousScene']);
        assert.equal(JSON.stringify(providerCalls[0].providerInput).includes('existing-chat'), false);
        assert.equal(JSON.stringify(providerCalls[0].providerInput).includes('catalog_test_01'), false);
        assert.equal(Object.hasOwn(providerCalls[0].providerInput, 'sourceRole'), false);
        let abortProviderStarted = false;
        let abortProviderObserved = false;
        let returnValidProviderResult = false;
        globalThis.fetch = async (url, init = {}) => {
            if (new URL(url).hostname === 'provider.example') {
                if (returnValidProviderResult) {
                    return new Response(JSON.stringify({ content: [{
                        type: 'text',
                        text: JSON.stringify({
                            confidenceBand: 'high',
                            currentLocationText: '贵族区',
                            transitionActionText: '穿过',
                            referencedLocationTexts: [],
                            visualTags: [{ code: 'scene.city', evidenceText: '贵族区' }],
                        }),
                    }] }), { status: 200 });
                }
                abortProviderStarted = true;
                return await new Promise((resolve, reject) => {
                    const failAborted = () => {
                        abortProviderObserved = true;
                        reject(new DOMException('Aborted', 'AbortError'));
                    };
                    if (init.signal?.aborted) return failAborted();
                    init.signal?.addEventListener('abort', failAborted, { once: true });
                });
            }
            return priorFetch(url, init);
        };
        const cancelledRequest = new AbortController();
        const cancelledFetch = fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
            method: 'POST',
            headers: {
                origin: 'http://127.0.0.1:8001',
                'content-type': 'application/json',
                'x-galgame-scene-continuity-version': '1',
            },
            body: JSON.stringify(sceneRequest),
            signal: cancelledRequest.signal,
        });
        for (let attempt = 0; attempt < 100 && !abortProviderStarted; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(abortProviderStarted, true, 'the route starts its provider request before cancellation');
        cancelledRequest.abort();
        await assert.rejects(cancelledFetch, { name: 'AbortError' });
        for (let attempt = 0; attempt < 100 && !abortProviderObserved; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(abortProviderObserved, true, 'disconnecting the visible-page request aborts the upstream provider call');
        returnValidProviderResult = true;
        const afterAbortResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
            method: 'POST',
            headers: {
                origin: 'http://127.0.0.1:8001',
                'content-type': 'application/json',
                'x-galgame-scene-continuity-version': '1',
            },
            body: JSON.stringify(sceneRequest),
        });
        assert.equal(afterAbortResponse.status, 200, 'a newer visible-page analysis can start after the older request is cancelled');
        const characterProviderCallCount = providerCalls.length;
        for (const [sourceRole, requestId] of [
            ['player', 'd3af4509-30c9-491b-9181-a07c1ff352dc'],
            ['system', '79fc2019-7918-4d52-b815-13bdb0917141'],
        ]) {
            const nonCharacterRequest = await createSceneContinuityAnalysisRequest({
                sourceRole,
                scope: sceneScope,
                messageId: '10',
                pageIndex: 2,
                pageText: sceneText,
                contextPages: [{ pageText: '前页' }],
                previousScene: { sceneKey: 'scene_previous', displayLabel: '驿站' },
                requestId,
            });
            const nonCharacterResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
                method: 'POST',
                headers: {
                    origin: 'http://127.0.0.1:8001',
                    'content-type': 'application/json',
                    'x-galgame-scene-continuity-version': '1',
                },
                body: JSON.stringify(nonCharacterRequest),
            });
            assert.equal(nonCharacterResponse.status, 200);
            assert.deepEqual(await nonCharacterResponse.json(), {
                schemaVersion: 'galgame.scene-continuity-analysis.v1',
                requestId,
                pageTextSha256: nonCharacterRequest.segment.pageTextSha256,
                confidenceBand: 'low',
                currentLocation: null,
                transitionAction: null,
                referencedLocations: [],
                visualTags: [],
            });
        }
        assert.equal(providerCalls.length, characterProviderCallCount, 'player/system scene requests bypass upstream generation');
    } finally {
        globalThis.fetch = priorFetch;
    }
    const sceneBadVersion = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/scene-continuity`, {
        method: 'POST',
        headers: {
            origin: 'http://127.0.0.1:8001',
            'content-type': 'application/json',
            'x-galgame-presentation-version': '1',
        },
        body: JSON.stringify(sceneRequest),
    });
    assert.equal(sceneBadVersion.status, 400);
    assert.equal((await sceneBadVersion.json()).code, 'INVALID_REQUEST');
    const blocked = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
        method: 'POST',
        headers: { origin: 'https://attacker.example', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
        body: '{}',
    });
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'ORIGIN_DENIED');
    const duplicateKey = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
        body: '{"schemaVersion":"first","schemaVersion":"second"}',
    });
    assert.equal(duplicateKey.status, 400);
    assert.equal((await duplicateKey.json()).code, 'INVALID_REQUEST');
} finally {
    await new Promise((resolve) => server.close(resolve));
}
console.log('presentation-analysis-service: PASS');
