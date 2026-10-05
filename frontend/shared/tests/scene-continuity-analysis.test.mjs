import assert from 'node:assert/strict';
import {
    buildSceneContinuityProjectionFromAnalysis,
    createSceneContinuityAnalysisCacheKey,
    createSceneContinuityAnalysisRequest,
    sceneContinuityAnalysisProviderInput,
    validateSceneContinuityAnalysisResponse,
} from '../src/scene-continuity-analysis.js';
import { consumeSceneContinuityProjection } from '../src/presentation-projection.js';

const scope = {
    chatId: 'chat-existing',
    releaseId: 'release-current',
    arcId: 'arc-main',
    catalogId: 'catalog_player_01',
    catalogRevision: 1,
    catalogHash: `sha256:${'a'.repeat(64)}`,
};
const pageText = '😀马车穿过凌晨两点的贵族区，远处还能看见森林。';
const findCp = (text, value, from = 0) => {
    const points = Array.from(text);
    const needle = Array.from(value);
    for (let start = from; start <= points.length - needle.length; start += 1) {
        if (needle.every((point, offset) => point === points[start + offset])) return { start, end: start + needle.length };
    }
    throw new Error(`missing span: ${value}`);
};
const request = await createSceneContinuityAnalysisRequest({
    scope,
    messageId: '47',
    pageIndex: 5,
    pageText,
    contextPages: [{ pageText: '上一页还在旅店。' }],
    requestId: 'fbdc26e4-d450-4e4d-8c0f-b0b8f2c7e2fd',
});
const analysis = {
    schemaVersion: 'galgame.scene-continuity-analysis.v1',
    requestId: request.requestId,
    pageTextSha256: request.segment.pageTextSha256,
    confidenceBand: 'high',
    currentLocation: findCp(pageText, '凌晨两点的贵族区'),
    transitionAction: findCp(pageText, '穿过'),
    referencedLocations: [findCp(pageText, '森林')],
    visualTags: [{ code: 'scene.city', ...findCp(pageText, '贵族区') }, { code: 'scene.night', ...findCp(pageText, '凌晨两点') }],
};
assert.deepEqual(await validateSceneContinuityAnalysisResponse(analysis, request), { valid: true, code: null });

const projected = await buildSceneContinuityProjectionFromAnalysis({ request, response: analysis });
assert.equal(projected.projection.state, 'changed');
assert.equal(projected.visualHint.displayLabel, '凌晨两点的贵族区');
assert.match(projected.visualHint.visibleAttributes[0].value, /city night/u);
const consumed = await consumeSceneContinuityProjection({
    pageText,
    projection: projected.projection,
    expectedScope: scope,
    previousScope: scope,
    previousVerifiedSceneKey: null,
});
assert.equal(consumed.action, 'clear-before-match');
assert.equal(consumed.sceneKey, projected.sceneKey);
const currentSpan = projected.projection.evidenceSpans.find((span) => span.relation === 'current-location');
assert.equal(pageText.slice(currentSpan.start, currentSpan.end), '凌晨两点的贵族区', 'code point offsets convert to UTF-16 safely after emoji');

const plannedRequest = await createSceneContinuityAnalysisRequest({
    scope,
    messageId: request.segment.messageId,
    pageIndex: request.segment.pageIndex,
    pageText,
    contextPages: request.contextPages,
    previousScene: null,
    requestId: 'b6537c88-44cb-4b81-9586-5f47f23ab8dd',
});
const planned = await buildSceneContinuityProjectionFromAnalysis({
    request: plannedRequest,
    response: { ...analysis, requestId: plannedRequest.requestId, pageTextSha256: plannedRequest.segment.pageTextSha256, transitionAction: null },
});
assert.equal(planned.projection.state, 'unknown', 'a place mention without a present transition cannot change the scene');

const sameSceneRequest = await createSceneContinuityAnalysisRequest({
    scope, messageId: '48', pageIndex: 0, pageText: '我们仍在凌晨两点的贵族区交谈。',
    previousScene: { sceneKey: projected.sceneKey, displayLabel: '凌晨两点的贵族区' },
    requestId: '5fc63d0a-2752-478b-98d1-ecc15ccaa7a3',
});
const continuedResponse = {
    schemaVersion: 'galgame.scene-continuity-analysis.v1',
    requestId: sameSceneRequest.requestId,
    pageTextSha256: sameSceneRequest.segment.pageTextSha256,
    confidenceBand: 'high',
    currentLocation: findCp(sameSceneRequest.segment.pageText, '凌晨两点的贵族区'),
    transitionAction: null,
    referencedLocations: [],
    visualTags: [],
};
const continued = await buildSceneContinuityProjectionFromAnalysis({ request: sameSceneRequest, response: continuedResponse });
assert.equal(continued.projection.state, 'continued');
assert.equal(continued.visualHint, null);

assert.equal((await validateSceneContinuityAnalysisResponse({ ...analysis, extra: true }, request)).valid, false);
assert.deepEqual((await validateSceneContinuityAnalysisResponse({ ...analysis, extra: true }, request)).errors, ['SCENE_OUTPUT_KEYS']);
assert.equal((await validateSceneContinuityAnalysisResponse({ ...analysis, requestId: '00000000-0000-4000-8000-000000000000' }, request)).valid, false);
assert.equal((await validateSceneContinuityAnalysisResponse({ ...analysis, visualTags: [{ code: 'asset:random', start: 0, end: 1 }] }, request)).valid, false);
assert.equal((await validateSceneContinuityAnalysisResponse({ ...analysis, currentLocation: { start: 0, end: Array.from(pageText).length + 1 } }, request)).valid, false, 'code point offsets stay within the exact page');
assert.deepEqual((await validateSceneContinuityAnalysisResponse({ ...analysis, currentLocation: { start: 0, end: Array.from(pageText).length + 1 } }, request)).errors, ['SCENE_EVIDENCE_OUT_OF_RANGE']);
assert.equal((await validateSceneContinuityAnalysisResponse({
    ...analysis,
    currentLocation: findCp(pageText, '贵族区'),
    visualTags: [{ code: 'scene.night', ...findCp(pageText, '凌晨两点') }],
}, request)).valid, false, 'visual tag evidence must be inside the current location span');
assert.equal((await validateSceneContinuityAnalysisResponse({
    ...analysis,
    currentLocation: null,
}, request)).valid, false, 'null current location cannot carry visual tags');
assert.equal((await validateSceneContinuityAnalysisResponse({
    ...analysis,
    currentLocation: findCp(pageText, '凌晨两点的贵族区'),
    visualTags: [{ code: 'scene.night', ...findCp(pageText, '凌晨两点') }],
}, request)).valid, true, 'contained environment modifier tags are valid');

const providerInput = sceneContinuityAnalysisProviderInput(request);
assert.deepEqual(Object.keys(providerInput).sort(), ['contextPages', 'pageText', 'previousScene']);
assert.equal(JSON.stringify(providerInput).includes('chat-existing'), false, 'provider receives no local identifiers');
assert.notEqual(
    await createSceneContinuityAnalysisCacheKey({ request, analyzerScope: 'model:v1' }),
    await createSceneContinuityAnalysisCacheKey({ request: { ...request, previousScene: { sceneKey: 'other', displayLabel: '其他' } }, analyzerScope: 'model:v1' }),
);
assert.notEqual(
    await createSceneContinuityAnalysisCacheKey({ request, analyzerScope: 'model:v2', promptVersion: 'scene-prompt:v1' }),
    await createSceneContinuityAnalysisCacheKey({ request, analyzerScope: 'model:v2', promptVersion: 'scene-prompt:v2' }),
    'prompt-version changes invalidate cached analysis',
);
console.log('scene-continuity-analysis: PASS');
