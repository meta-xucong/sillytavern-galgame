import assert from 'node:assert/strict';
import { PRESENTATION_LIMITS, createVisibleMessageHash, validatePresentationAnnotationRequestAsync } from '../src/presentation-annotation.js';
import { createPresentationBatches, PresentationAnalysisAdapter } from '../src/presentation-analysis-adapter.js';
import { createSceneContinuityAnalysisRequest } from '../src/scene-continuity-analysis.js';

const scope = { scenarioId: 's', scenarioVersion: '1', releaseId: 'r', arcId: '', chatKey: 'c' };
const messages = [];
for (let index = 0; index < 10; index += 1) {
    const visibleText = `剧情段落 ${index}`;
    messages.push({ sourceMessageIndex: index, sourceMessageHash: await createVisibleMessageHash(visibleText), authorLabel: '', visibleText });
}
const batches = await createPresentationBatches({ scope, messages });
assert.deepEqual(batches.map((batch) => batch.messages.length), [8, 2]);
const knownEntities = Array.from({ length: 32 }, (_, index) => ({
    resolverEntityRef: `published:character-${String(index).padStart(2, '0')}`,
    visibleNames: [`Character ${index}`],
    evidenceDigest: `sha256:${String(index).padStart(64, '0')}`,
    attributes: [],
}));
const targetedVisibleText = 'Character 31 enters the room.';
const targetedMessage = {
    sourceMessageIndex: 20,
    sourceMessageHash: await createVisibleMessageHash(targetedVisibleText),
    authorLabel: '',
    visibleText: targetedVisibleText,
};
const castAwareBatch = await createPresentationBatches({ scope, messages: [targetedMessage], knownEntities });
assert.equal(castAwareBatch[0].knownEntities.length, 16, 'each request respects the established 16-item relevant-entity window');
assert.ok(castAwareBatch[0].knownEntities.some((entity) => entity.resolverEntityRef === 'published:character-31'),
    'a mentioned entity beyond the old first-16 slice is prioritized into the request');
const largeKnownEntities = Array.from({ length: 20 }, (_, index) => ({
    resolverEntityRef: `published:character-${String(index).padStart(2, '0')}`,
    visibleNames: Array.from({ length: 8 }, (_, aliasIndex) => `角色${index}-${aliasIndex}-${'名'.repeat(110)}`),
    evidenceDigest: `sha256:${String(index).padStart(64, '0')}`,
    attributes: [],
}));
const boundedBatch = await createPresentationBatches({ scope, messages: [messages[0]], knownEntities: largeKnownEntities });
assert.ok(boundedBatch[0].knownEntities.length < largeKnownEntities.length, 'oversized cast context is reduced to fit the established request body limit');
assert.ok(new TextEncoder().encode(JSON.stringify(boundedBatch[0])).length <= PRESENTATION_LIMITS.bodyBytes);

const oversizedContext = await Promise.all(Array.from({ length: PRESENTATION_LIMITS.maxContextMessages }, async (_, index) => {
    const visibleText = '界'.repeat(PRESENTATION_LIMITS.maxContextMessageCodePoints);
    return { sourceMessageIndex: index, sourceMessageHash: await createVisibleMessageHash(visibleText), visibleText };
}));
const oversizedCurrentText = '界'.repeat(PRESENTATION_LIMITS.maxMessageCodePoints);
const oversizedCurrentMessage = {
    sourceMessageIndex: oversizedContext.length,
    sourceMessageHash: await createVisibleMessageHash(oversizedCurrentText),
    authorLabel: '',
    visibleText: oversizedCurrentText,
};
const bodyBoundedSingleMessage = await createPresentationBatches({
    scope,
    messages: [oversizedCurrentMessage],
    contextMessages: oversizedContext,
});
assert.equal(bodyBoundedSingleMessage.length, 1, 'an oversized first request is retried through deterministic context trimming');
assert.equal(bodyBoundedSingleMessage[0].messages[0].visibleText, oversizedCurrentText, 'body trimming never truncates the target message');
assert.ok(bodyBoundedSingleMessage[0].contextMessages.length < oversizedContext.length, 'context is reduced before any target text is changed');
assert.ok(new TextEncoder().encode(JSON.stringify(bodyBoundedSingleMessage[0])).length <= PRESENTATION_LIMITS.bodyBytes,
    'the retried single-message request fits the protocol byte budget');
assert.deepEqual((await validatePresentationAnnotationRequestAsync(bodyBoundedSingleMessage[0])).errors, [],
    'the reduced request retains valid source hashes and context digest');

const responseFor = async (request) => ({
    ok: true,
    status: 200,
    json: async () => ({
        schemaVersion: 'galgame.presentation-annotation.v1',
        results: request.messages.map((message) => ({
            sourceMessageIndex: message.sourceMessageIndex,
            sourceMessageHash: message.sourceMessageHash,
            segments: [{ start: 0, end: Array.from(message.visibleText).length, textHash: message.sourceMessageHash, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceSpans: [] }],
            entities: [], identityLinkCandidates: [], stateClaims: [],
        })),
    }),
});
let exactPreparedRequest = null;
const exactRequestAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async (_url, init) => {
        exactPreparedRequest = JSON.parse(init.body);
        return responseFor(exactPreparedRequest);
    },
});
await exactRequestAdapter.annotate({ request: castAwareBatch[0] });
assert.deepEqual(exactPreparedRequest, castAwareBatch[0], 'cache callers can send the exact prepared request whose contextDigest they key');
const invalidPreparedRequest = structuredClone(castAwareBatch[0]);
invalidPreparedRequest.knownEntities = [];
await assert.rejects(exactRequestAdapter.annotate({ request: invalidPreparedRequest }), { code: 'INVALID_REQUEST' },
    'prebuilt requests are validated and cannot bypass the context digest contract');
const adapter = new PresentationAnalysisAdapter({ fetchImpl: async (_url, init) => {
    assert.equal(init.credentials, 'omit');
    return responseFor(JSON.parse(init.body));
} });
assert.equal(new PresentationAnalysisAdapter().baseUrl, 'http://127.0.0.1:8798', 'browser adapter uses the established visual-service port');
const annotations = await adapter.annotate({ scope, messages });
assert.equal(annotations.length, 10);

const abortController = new AbortController();
abortController.abort();
await assert.rejects(adapter.annotate({ scope, messages: [messages[0]], signal: abortController.signal }), { code: 'ABORTED' });

const sceneScope = {
    chatId: 'chat-a', releaseId: 'release-a', arcId: null,
    catalogId: 'catalog_test_01', catalogRevision: 1, catalogHash: `sha256:${'b'.repeat(64)}`,
};
let sceneCall = null;
const sceneAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async (url, init = {}) => {
        if (String(url).endsWith('/v1/presentation/health')) {
            assert.equal(String(url).startsWith('http://127.0.0.1:8798'), true);
            assert.equal(init.credentials, 'omit');
            return {
                ok: true,
                json: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'model:annotation.v1', sceneAnalyzerScope: 'model:scene.v1' }),
            };
        }
        assert.equal(init.headers['content-type'], 'text/plain');
        assert.equal(init.headers['x-galgame-scene-continuity-version'], undefined);
        assert.equal(init.credentials, 'omit');
        assert.equal(String(url).endsWith('/v1/presentation/scene-continuity'), true);
        const request = JSON.parse(init.body);
        sceneCall = request;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                schemaVersion: 'galgame.scene-continuity-analysis.v1',
                requestId: request.requestId,
                pageTextSha256: request.segment.pageTextSha256,
                confidenceBand: 'high',
                currentLocation: { start: 4, end: 7 },
                transitionAction: { start: 2, end: 4 },
                referencedLocations: [],
                visualTags: [{ code: 'scene.city', start: 4, end: 7 }],
            }),
        };
    },
});
const sceneResult = await sceneAdapter.analyzeSceneContinuity({
    scope: sceneScope,
    messageId: '10',
    pageIndex: 2,
    pageText: '马车穿过贵族区',
    contextPages: [{ pageText: '前页' }],
});
assert.equal(sceneResult.request.schemaVersion, 'galgame.scene-continuity-analysis-request.v1');
assert.equal(sceneCall.scope.chatId, 'chat-a');
assert.equal((await sceneAdapter.healthCheck()).sceneAnalyzerScope, 'model:scene.v1');

const networkFailureSceneAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async () => { throw new TypeError('Failed to fetch'); },
});
await assert.rejects(networkFailureSceneAdapter.analyzeSceneContinuity({
    scope: sceneScope, messageId: '11', pageIndex: 0, pageText: '场景请求失败诊断',
}), (error) => error.code === 'ANALYZER_UNAVAILABLE'
    && error.transportFailure === 'network-fetch-failed');

let observedFetchReceiver = null;
const receiverBoundSceneAdapter = new PresentationAnalysisAdapter({
    fetchImpl: function (url, init = {}) {
        observedFetchReceiver = this;
        const request = JSON.parse(init.body);
        return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
                schemaVersion: 'galgame.scene-continuity-analysis.v1',
                requestId: request.requestId,
                pageTextSha256: request.segment.pageTextSha256,
                confidenceBand: 'low',
                currentLocation: null,
                transitionAction: null,
                referencedLocations: [],
                visualTags: [],
            }),
        });
    },
});
await receiverBoundSceneAdapter.analyzeSceneContinuity({
    scope: sceneScope, messageId: '12', pageIndex: 0, pageText: '场景接收者测试',
});
assert.equal(observedFetchReceiver, globalThis, 'native fetch remains bound to its global receiver');

const failedHealthAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async () => { throw new TypeError('network failure'); },
});
const failedHealth = await failedHealthAdapter.healthCheck();
assert.equal(failedHealth.serviceReady, false);
assert.equal(failedHealth.diagnosticCode, 'health-request-typeerror');

let transientHealthAttempts = 0;
const recoveringHealthAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async () => {
        transientHealthAttempts += 1;
        if (transientHealthAttempts === 1) throw new TypeError('transient browser network error');
        return {
            ok: true,
            status: 200,
            json: async () => ({
                serviceReady: true,
                analyzerConfigured: true,
                analyzerScope: 'model:annotation.v1',
                sceneAnalyzerScope: 'model:scene.v1',
            }),
        };
    },
});
const recoveredHealth = await recoveringHealthAdapter.healthCheck();
assert.equal(transientHealthAttempts, 2, 'a transient health request failure is retried once');
assert.equal(recoveredHealth.serviceReady, true);
assert.equal(recoveredHealth.diagnosticCode, 'ready');

const incompleteScopeAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ serviceReady: true, analyzerConfigured: true, analyzerScope: 'model:annotation.v1' }),
    }),
});
const incompleteScopeHealth = await incompleteScopeAdapter.healthCheck();
assert.equal(incompleteScopeHealth.serviceReady, false);
assert.equal(incompleteScopeHealth.diagnosticCode, 'health-scope-incomplete');

const unconfiguredHealthAdapter = new PresentationAnalysisAdapter({
    fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ serviceReady: true, analyzerConfigured: false }),
    }),
});
const unconfiguredHealth = await unconfiguredHealthAdapter.healthCheck();
assert.equal(unconfiguredHealth.serviceReady, true);
assert.equal(unconfiguredHealth.analyzerConfigured, false);
assert.equal(unconfiguredHealth.diagnosticCode, 'analyzer-not-configured');
console.log('presentation-analysis-adapter: PASS');
