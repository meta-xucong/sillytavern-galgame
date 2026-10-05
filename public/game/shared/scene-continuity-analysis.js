import { sha256Hex } from './presentation-annotation.js?v=auto-b19af4e9a9f8';
import { createSceneContinuityProjection } from './presentation-projection.js?v=auto-b19af4e9a9f8';

export const SCENE_CONTINUITY_ANALYSIS_REQUEST_VERSION = 'galgame.scene-continuity-analysis-request.v1';
export const SCENE_CONTINUITY_ANALYSIS_RESPONSE_VERSION = 'galgame.scene-continuity-analysis.v1';
export const SCENE_CONTINUITY_ANALYSIS_LIMITS = Object.freeze({
    maxRequestBytes: 48 * 1024,
    maxPageCodePoints: 4000,
    maxContextPages: 2,
    maxContextPageCodePoints: 1200,
    maxReferencedLocations: 12,
    maxVisualTags: 8,
});

export const SCENE_CONTINUITY_VISUAL_TAGS = Object.freeze([
    'scene.interior', 'scene.exterior', 'scene.ruins', 'scene.forest',
    'scene.city', 'scene.dungeon', 'scene.night', 'scene.day',
]);

const REQUEST_SCOPE_KEYS = Object.freeze(['chatId', 'releaseId', 'arcId', 'catalogId', 'catalogRevision', 'catalogHash']);
const REQUEST_KEYS = Object.freeze(['schemaVersion', 'requestId', 'sourceRole', 'scope', 'segment', 'contextPages', 'previousScene']);
const SEGMENT_KEYS = Object.freeze(['messageId', 'pageIndex', 'pageText', 'pageTextSha256']);
const LOCATION_RESPONSE_KEYS = Object.freeze(['schemaVersion', 'requestId', 'pageTextSha256', 'confidenceBand', 'currentLocation', 'transitionAction', 'referencedLocations', 'visualTags']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export async function createSceneContinuityAnalysisRequest({
    sourceRole = 'character', scope, messageId, pageIndex, pageText, contextPages = [], previousScene = null, requestId = globalThis.crypto?.randomUUID?.(),
} = {}) {
    const exactPageText = String(pageText ?? '');
    const request = {
        schemaVersion: SCENE_CONTINUITY_ANALYSIS_REQUEST_VERSION,
        requestId,
        sourceRole,
        scope: cloneScope(scope),
        segment: {
            messageId: String(messageId ?? ''),
            pageIndex,
            pageText: exactPageText,
            pageTextSha256: `sha256:${await sha256Hex(exactPageText)}`,
        },
        contextPages: [...contextPages].slice(-SCENE_CONTINUITY_ANALYSIS_LIMITS.maxContextPages).map(({ pageText: text }) => ({ pageText: String(text ?? '') })),
        previousScene: previousScene === null ? null : {
            sceneKey: String(previousScene.sceneKey ?? ''),
            displayLabel: String(previousScene.displayLabel ?? ''),
        },
    };
    const validation = await validateSceneContinuityAnalysisRequest(request);
    if (!validation.valid) throw new TypeError('scene continuity analysis request is invalid');
    return request;
}

export async function validateSceneContinuityAnalysisRequest(request, { maxBytes = SCENE_CONTINUITY_ANALYSIS_LIMITS.maxRequestBytes } = {}) {
    try {
        if (!isExactObject(request, REQUEST_KEYS)
            || request.schemaVersion !== SCENE_CONTINUITY_ANALYSIS_REQUEST_VERSION
            || typeof request.requestId !== 'string' || !UUID_PATTERN.test(request.requestId)
            || !['character', 'player', 'system'].includes(request.sourceRole)
            || !isExactObject(request.scope, REQUEST_SCOPE_KEYS)
            || !isScope(request.scope)
            || !isExactObject(request.segment, SEGMENT_KEYS)
            || typeof request.segment.messageId !== 'string' || !request.segment.messageId.trim()
            || !Number.isSafeInteger(request.segment.pageIndex) || request.segment.pageIndex < 0
            || typeof request.segment.pageText !== 'string'
            || Array.from(request.segment.pageText).length > SCENE_CONTINUITY_ANALYSIS_LIMITS.maxPageCodePoints
            || request.segment.pageTextSha256 !== `sha256:${await sha256Hex(request.segment.pageText)}`
            || !Array.isArray(request.contextPages) || request.contextPages.length > SCENE_CONTINUITY_ANALYSIS_LIMITS.maxContextPages
            || request.contextPages.some((page) => !isExactObject(page, ['pageText'])
                || typeof page.pageText !== 'string'
                || Array.from(page.pageText).length > SCENE_CONTINUITY_ANALYSIS_LIMITS.maxContextPageCodePoints)
            || !(request.previousScene === null || (isExactObject(request.previousScene, ['sceneKey', 'displayLabel'])
                && typeof request.previousScene.sceneKey === 'string' && request.previousScene.sceneKey.length > 0
                && Array.from(request.previousScene.sceneKey).length <= 200
                && typeof request.previousScene.displayLabel === 'string' && request.previousScene.displayLabel.trim().length > 0
                && Array.from(request.previousScene.displayLabel).length <= 160))) {
            return { valid: false, code: 'INVALID_REQUEST' };
        }
        if (new TextEncoder().encode(JSON.stringify(request)).byteLength > maxBytes) return { valid: false, code: 'BODY_TOO_LARGE' };
        return { valid: true, code: null };
    } catch {
        return { valid: false, code: 'INVALID_REQUEST' };
    }
}

export async function validateSceneContinuityAnalysisResponse(response, request) {
    try {
        if (!isExactObject(response, LOCATION_RESPONSE_KEYS)) return invalidSceneOutput('SCENE_OUTPUT_KEYS');
        if (response.schemaVersion !== SCENE_CONTINUITY_ANALYSIS_RESPONSE_VERSION
            || response.requestId !== request?.requestId
            || response.pageTextSha256 !== request?.segment?.pageTextSha256) return invalidSceneOutput('SCENE_OUTPUT_SCOPE');
        if (!['low', 'medium', 'high'].includes(response.confidenceBand)
            || !isSpanOrNull(response.currentLocation)
            || !isSpanOrNull(response.transitionAction)) return invalidSceneOutput('SCENE_OUTPUT_SPAN_SHAPE');
        if (!Array.isArray(response.referencedLocations)
            || response.referencedLocations.length > SCENE_CONTINUITY_ANALYSIS_LIMITS.maxReferencedLocations
            || response.referencedLocations.some((span) => !isSpan(span))) return invalidSceneOutput('SCENE_REFERENCED_LOCATIONS_SHAPE');
        if (!Array.isArray(response.visualTags)
            || response.visualTags.length > SCENE_CONTINUITY_ANALYSIS_LIMITS.maxVisualTags
            || response.visualTags.some((tag) => !isExactObject(tag, ['code', 'start', 'end'])
                || !SCENE_CONTINUITY_VISUAL_TAGS.includes(tag.code)
                || !isCoordinatePair(tag))) return invalidSceneOutput('SCENE_VISUAL_TAGS_SHAPE');
        const pageText = request.segment.pageText;
        const spans = [response.currentLocation, response.transitionAction, ...response.referencedLocations, ...response.visualTags]
            .filter(Boolean);
        const codePointLength = Array.from(pageText).length;
        if (spans.some((span) => span.end > codePointLength)) return invalidSceneOutput('SCENE_EVIDENCE_OUT_OF_RANGE');
        if (response.currentLocation === null && response.visualTags.length > 0) {
            return invalidSceneOutput('SCENE_TAG_WITHOUT_LOCATION');
        }
        if (response.currentLocation && response.visualTags.some((tag) => (
            tag.start < response.currentLocation.start || tag.end > response.currentLocation.end
        ))) {
            return invalidSceneOutput('SCENE_TAG_OUTSIDE_LOCATION');
        }
        if (response.currentLocation && !sliceCodePoints(pageText, response.currentLocation.start, response.currentLocation.end).trim()) {
            return invalidSceneOutput('SCENE_LOCATION_EVIDENCE_EMPTY');
        }
        return { valid: true, code: null };
    } catch {
        return invalidSceneOutput('SCENE_RESPONSE_CHECK_FAILED');
    }
}

function invalidSceneOutput(issue) {
    return { valid: false, code: 'INVALID_MODEL_OUTPUT', errors: [issue] };
}

export async function buildSceneContinuityProjectionFromAnalysis({ request, response } = {}) {
    const validation = await validateSceneContinuityAnalysisResponse(response, request);
    if (!validation.valid) throw new TypeError('scene continuity analysis response is invalid');

    const pageText = request.segment.pageText;
    const scope = request.scope;
    if (request.sourceRole !== 'character') {
        return {
            projection: await createSceneContinuityProjection({
                scope,
                messageId: request.segment.messageId,
                pageIndex: request.segment.pageIndex,
                pageText,
                state: 'unknown',
            }),
            visualHint: null,
            sceneKey: null,
            displayLabel: '',
            visualTags: [],
        };
    }
    const previous = request.previousScene;
    const location = response.currentLocation
        ? sliceCodePoints(pageText, response.currentLocation.start, response.currentLocation.end).trim()
        : '';
    const currentSceneKey = location
        ? await deriveSceneContinuityKey(scope, location)
        : null;
    const referenced = [];
    for (const span of response.referencedLocations) {
        const label = sliceCodePoints(pageText, span.start, span.end).trim();
        if (!label) continue;
        referenced.push({ span, key: await deriveSceneContinuityKey(scope, label) });
    }

    const entityKeys = new Set(referenced.map((entry) => entry.key));
    const evidenceSpans = referenced.map(({ span, key }) => ({
        ...toUtf16Span(pageText, span),
        relation: 'referenced-location',
        sceneEntityKey: key,
        destinationSceneKey: null,
    }));
    let state = 'unknown';
    let activeSceneKey = null;
    if (currentSceneKey && response.confidenceBand === 'high') {
        entityKeys.add(currentSceneKey);
        evidenceSpans.push({
            ...toUtf16Span(pageText, response.currentLocation),
            relation: 'current-location',
            sceneEntityKey: currentSceneKey,
            destinationSceneKey: null,
        });
        if (previous?.sceneKey === currentSceneKey) {
            state = 'continued';
            activeSceneKey = currentSceneKey;
        } else if (response.transitionAction) {
            state = 'changed';
            activeSceneKey = currentSceneKey;
            evidenceSpans.push({
                ...toUtf16Span(pageText, response.transitionAction),
                relation: 'transition-action',
                sceneEntityKey: null,
                destinationSceneKey: currentSceneKey,
            });
        }
    }

    const projection = await createSceneContinuityProjection({
        scope,
        messageId: request.segment.messageId,
        pageIndex: request.segment.pageIndex,
        pageText,
        state,
        sceneEntityKeys: [...entityKeys],
        currentSceneKey: activeSceneKey,
        evidenceSpans,
    });
    const visualHint = state === 'changed' && location ? {
        entityKeySeed: `validated-scene:${currentSceneKey}`,
        entityType: 'scene',
        displayLabel: location.slice(0, 80),
        visibleAttributes: [{
            code: 'scene-location-kind',
            value: [location, ...new Set(response.visualTags.map((tag) => sceneTagAlias(tag.code)))].filter(Boolean).join(' ').slice(0, 160),
            confidenceBand: 'explicit',
        }],
        confidenceBand: 'explicit',
    } : null;
    return {
        projection,
        visualHint,
        sceneKey: activeSceneKey,
        displayLabel: location || '',
        visualTags: response.visualTags.map(({ code }) => code),
    };
}

export async function createSceneContinuityAnalysisCacheKey({ request, analyzerScope = '', promptVersion = '' } = {}) {
    if (!request || !isScope(request.scope) || !request.segment?.pageTextSha256) return '';
    return sha256Hex(JSON.stringify([
        ...REQUEST_SCOPE_KEYS.map((key) => request.scope[key]),
        request.segment.messageId,
        request.segment.pageIndex,
        request.segment.pageTextSha256,
        request.contextPages.map((page) => page.pageText),
        request.previousScene?.sceneKey || null,
        analyzerScope,
        promptVersion,
    ]));
}

export function sceneContinuityAnalysisProviderInput(request) {
    return {
        pageText: request.segment.pageText,
        contextPages: request.contextPages.map(({ pageText }) => ({ pageText })),
        previousScene: request.previousScene ? { displayLabel: request.previousScene.displayLabel } : null,
    };
}

function cloneScope(scope) {
    if (!isScope(scope)) throw new TypeError('scene continuity scope is invalid');
    return Object.fromEntries(REQUEST_SCOPE_KEYS.map((key) => [key, scope[key]]));
}

function isScope(scope) {
    return isExactObject(scope, REQUEST_SCOPE_KEYS)
        && typeof scope.chatId === 'string' && scope.chatId.length > 0 && scope.chatId.length <= 200
        && typeof scope.releaseId === 'string' && scope.releaseId.length > 0 && scope.releaseId.length <= 200
        && (scope.arcId === null || (typeof scope.arcId === 'string' && scope.arcId.length > 0 && scope.arcId.length <= 200))
        && typeof scope.catalogId === 'string' && /^[a-z][a-z0-9_-]{2,79}$/u.test(scope.catalogId)
        && Number.isSafeInteger(scope.catalogRevision) && scope.catalogRevision > 0
        && typeof scope.catalogHash === 'string' && HASH_PATTERN.test(scope.catalogHash);
}

function isSpan(span) {
    return isExactObject(span, ['start', 'end']) && isCoordinatePair(span);
}

function isCoordinatePair(span) {
    return Boolean(span && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && span.start >= 0 && span.end > span.start);
}

function isSpanOrNull(span) {
    return span === null || isSpan(span);
}

function isExactObject(value, keys) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}

function sliceCodePoints(value, start, end) {
    return Array.from(String(value)).slice(start, end).join('');
}

function toUtf16Span(pageText, span) {
    const points = Array.from(pageText);
    return {
        start: points.slice(0, span.start).join('').length,
        end: points.slice(0, span.end).join('').length,
    };
}

export async function deriveSceneContinuityKey(scope, label) {
    const normalized = String(label).normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/gu, ' ');
    const scopeKey = REQUEST_SCOPE_KEYS.map((key) => scope[key]);
    return `scene_${(await sha256Hex(JSON.stringify([scopeKey, normalized]))).slice(0, 24)}`;
}

function sceneTagAlias(code) {
    return ({
        'scene.interior': 'interior',
        'scene.exterior': 'exterior',
        'scene.ruins': 'ruins',
        'scene.forest': 'forest',
        'scene.city': 'city',
        'scene.dungeon': 'dungeon',
        'scene.night': 'night',
        'scene.day': 'day',
    })[code] || '';
}
