import assert from 'node:assert/strict';
import {
    PRESENTATION_ANNOTATION_REQUEST_VERSION,
    PRESENTATION_ANNOTATION_VERSION,
    PRESENTATION_LIMITS,
    createPublishedPresentationKnownEntities,
    createPresentationAnnotationRequest,
    createVisibleMessageHash,
    validatePresentationAnnotationRequestAsync,
    validatePresentationAnnotationResponse,
} from '../src/presentation-annotation.js';

const text = '😀Celestia：准备出发。';
const start = Array.from(text).slice(1).join('').indexOf('Celestia') + 1;
const end = start + Array.from('Celestia').length;
const messageHash = await createVisibleMessageHash(text);
const segmentHash = await createVisibleMessageHash(text);
const request = await createPresentationAnnotationRequest({
    scope: { scenarioId: 's', scenarioVersion: '1', releaseId: 'r', arcId: '', chatKey: 'chat' },
    messages: [{ sourceMessageIndex: 2, sourceMessageHash: messageHash, authorLabel: 'Narrator', visibleText: text }],
    requestId: '123e4567-e89b-42d3-a456-426614174000',
});

assert.equal(request.schemaVersion, PRESENTATION_ANNOTATION_REQUEST_VERSION);
assert.deepEqual(await validatePresentationAnnotationRequestAsync(request), { valid: true, errors: [] });

const response = {
    schemaVersion: PRESENTATION_ANNOTATION_VERSION,
    results: [{
        sourceMessageIndex: 2,
        sourceMessageHash: messageHash,
        segments: [{
            start: 0, end: Array.from(text).length, textHash: segmentHash, kind: 'dialogue',
            speakerMentionRef: 'm0', speakerSource: 'text-explicit', confidenceBand: 'high',
            evidenceSpans: [{ start, end, purpose: 'speaker' }],
        }],
        entities: [{ mentionRef: 'm0', surfaceSpan: { start, end }, kind: 'person', attributeEvidence: [] }],
        identityLinkCandidates: [],
        stateClaims: [],
    }],
};
assert.deepEqual(await validatePresentationAnnotationResponse(response, request), { valid: true, errors: [] });

const attributedText = 'Mira说：“你好。”';
const attributedCodePoints = Array.from(attributedText);
const attributedDialogueStart = attributedCodePoints.indexOf('“');
const attributedDialogueEnd = attributedCodePoints.length;
const attributedRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 's', scenarioVersion: '1', releaseId: 'r', arcId: '', chatKey: 'chat' },
    messages: [{
        sourceMessageIndex: 3,
        sourceMessageHash: await createVisibleMessageHash(attributedText),
        authorLabel: '',
        visibleText: attributedText,
    }],
    requestId: '123e4567-e89b-42d3-a456-426614174001',
});
const attributedResponse = {
    schemaVersion: PRESENTATION_ANNOTATION_VERSION,
    results: [{
        sourceMessageIndex: 3,
        sourceMessageHash: attributedRequest.messages[0].sourceMessageHash,
        segments: [
            {
                start: 0,
                end: attributedDialogueStart,
                textHash: await createVisibleMessageHash(attributedCodePoints.slice(0, attributedDialogueStart).join('')),
                kind: 'narration',
                speakerMentionRef: null,
                speakerSource: 'none',
                confidenceBand: 'high',
                evidenceSpans: [],
            },
            {
                start: attributedDialogueStart,
                end: attributedDialogueEnd,
                textHash: await createVisibleMessageHash(attributedCodePoints.slice(attributedDialogueStart, attributedDialogueEnd).join('')),
                kind: 'dialogue',
                speakerMentionRef: 'm0',
                speakerSource: 'quoted-attribution',
                confidenceBand: 'high',
                evidenceSpans: [{ start: 0, end: 5, purpose: 'speaker' }],
            },
        ],
        entities: [{
            mentionRef: 'm0',
            surfaceSpan: { start: 0, end: 4 },
            kind: 'person',
            attributeEvidence: [],
        }],
        identityLinkCandidates: [],
        stateClaims: [],
    }],
};
assert.deepEqual(await validatePresentationAnnotationResponse(attributedResponse, attributedRequest), { valid: true, errors: [] },
    'speaker attribution evidence may cross from the adjacent narration clause into its dialogue segment');
const misplacedClassificationEvidence = structuredClone(attributedResponse);
misplacedClassificationEvidence.results[0].segments[1].evidenceSpans = [{ start: 0, end: 5, purpose: 'classification' }];
assert.equal((await validatePresentationAnnotationResponse(misplacedClassificationEvidence, attributedRequest)).valid, false,
    'only speaker evidence may cross a segment boundary');
const outsideMessageSpeakerEvidence = structuredClone(attributedResponse);
outsideMessageSpeakerEvidence.results[0].segments[1].evidenceSpans = [{ start: 0, end: attributedCodePoints.length + 1, purpose: 'speaker' }];
assert.equal((await validatePresentationAnnotationResponse(outsideMessageSpeakerEvidence, attributedRequest)).valid, false,
    'cross-segment speaker evidence still must stay inside the exact source message');

const uncovered = structuredClone(response);
uncovered.results[0].segments[0].end -= 1;
assert.equal((await validatePresentationAnnotationResponse(uncovered, request)).valid, false);

const extra = structuredClone(request);
extra.apiKey = 'never-allowed';
assert.equal((await validatePresentationAnnotationRequestAsync(extra)).valid, false);

const mismatchedRequestHash = structuredClone(request);
mismatchedRequestHash.messages[0].sourceMessageHash = `sha256:${'0'.repeat(64)}`;
assert.equal((await validatePresentationAnnotationRequestAsync(mismatchedRequestHash)).valid, false);

const badHash = structuredClone(response);
badHash.results[0].segments[0].textHash = `sha256:${'0'.repeat(64)}`;
assert.equal((await validatePresentationAnnotationResponse(badHash, request)).valid, false);

const extraSurfaceSpanKey = structuredClone(response);
extraSurfaceSpanKey.results[0].entities[0].surfaceSpan.untrusted = true;
assert.equal((await validatePresentationAnnotationResponse(extraSurfaceSpanKey, request)).valid, false, 'surface span rejects extra fields');

const extraEvidenceSpanKey = structuredClone(response);
extraEvidenceSpanKey.results[0].segments[0].evidenceSpans[0].untrusted = true;
assert.equal((await validatePresentationAnnotationResponse(extraEvidenceSpanKey, request)).valid, false, 'evidence span rejects extra fields');

const extraAttributeSpanKey = structuredClone(response);
extraAttributeSpanKey.results[0].entities[0].attributeEvidence = [{
    category: 'appearance', value: 'Celestia', span: { start, end, source: 'invented' },
}];
assert.equal((await validatePresentationAnnotationResponse(extraAttributeSpanKey, request)).valid, false, 'attribute span rejects extra fields');

const publishedKnown = await createPublishedPresentationKnownEntities({
    zara: { displayName: 'Zara Vey', name: 'ignored fallback', aliases: ['ZV', 'zara vey', 'Zara', 'Alias 4', 'Alias 5', 'Alias 6', 'Alias 7', 'Alias 8'], secret: 'never copied' },
    alpha: { name: 'Alpha', aliases: ['A', 'A'] },
});
assert.deepEqual(publishedKnown.knownEntities.map((entity) => entity.resolverEntityRef), ['published:alpha', 'published:zara']);
assert.deepEqual(publishedKnown.knownEntities[1].visibleNames, ['Zara Vey', 'Alias 4', 'Alias 5', 'Alias 6', 'Alias 7', 'Alias 8', 'ZV', 'Zara']);
assert.deepEqual(publishedKnown.knownEntities[0].attributes, [], 'published bindings do not invent biological attributes');
assert.equal(Object.hasOwn(publishedKnown.knownEntities[1], 'secret'), false, 'private and unrelated resource fields are excluded');
assert.deepEqual(publishedKnown.diagnostics, []);
const duplicateNames = await createPublishedPresentationKnownEntities({
    first: { displayName: 'Same Name' },
    second: { displayName: 'Same Name' },
});
assert.equal(duplicateNames.knownEntities.length, 2, 'same-name cast collisions remain visible as distinct resolver candidates');
const overCapacity = await createPublishedPresentationKnownEntities(Object.fromEntries(
    Array.from({ length: PRESENTATION_LIMITS.maxKnownEntities + 2 }, (_, index) => [`id-${String(index).padStart(2, '0')}`, { name: `Name ${index}` }]),
));
assert.equal(overCapacity.knownEntities.length, PRESENTATION_LIMITS.maxKnownEntities);
assert.deepEqual(overCapacity.diagnostics, [{ code: 'known-entity-cap', count: 2 }]);
assert.deepEqual(overCapacity.knownEntities, await createPublishedPresentationKnownEntities(Object.fromEntries(
    Array.from({ length: PRESENTATION_LIMITS.maxKnownEntities + 2 }, (_, index) => [`id-${String(index).padStart(2, '0')}`, { name: `Name ${index}` }]),
)).then((result) => result.knownEntities), 'published cast truncation is deterministic');
console.log('presentation-annotation: PASS');
