import assert from 'node:assert/strict';
import { createPresentationAnnotationRequest, createVisibleMessageHash, PRESENTATION_ANNOTATION_VERSION } from '../../frontend/shared/src/presentation-annotation.js';
import { createSceneContinuityAnalysisRequest } from '../../frontend/shared/src/scene-continuity-analysis.js';

process.env.GALGAME_PRESENTATION_ANALYZER_PROVIDER = 'anthropic';
process.env.GALGAME_PRESENTATION_ANALYZER_BASE_URL = 'https://aiself.vip';
process.env.GALGAME_PRESENTATION_ANALYZER_API_KEY = 'hidden-test-value';
process.env.GALGAME_PRESENTATION_ANALYZER_MODEL = 'claude-sonnet-4-6';
const {
    server,
    loadConfig,
    invokeProvider,
    transformAnthropicOutputSchema,
    normalizeAnthropicSourceQuoteGlyphs,
    classifyProviderHttpFailure,
    safeProviderErrorDiagnosticsFromBody,
    createProviderFailure,
    logProviderFailure,
    analyzePresentationWithBoundedTiles,
    createProviderSemaphore,
    createPresentationAnalyzerInput,
    materializePresentationAnalyzerCandidate,
    containsAnyRequestLocalBoundaryMarker,
    createPresentationCoreTiles,
    createRequestLocalBoundaryMarkers,
    createTileMarkerReservationText,
    mergePresentationTileResults,
    attemptMergedAnnotationRecovery,
    logRejectedOutput,
    isDenseLongPresentationMessage,
    PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
    PRESENTATION_MODEL_CANDIDATE_VERSION,
    PRESENTATION_TILE_CANDIDATE_JSON_SCHEMA,
    PRESENTATION_TILE_CANDIDATE_VERSION,
    PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA,
    PRESENTATION_UNIT_CANDIDATE_VERSION,
    createPresentationSourceUnits,
    createPresentationUnitTiles,
    createPresentationUnitProviderInput,
    materializePresentationUnitCandidate,
    validationIssueCategories,
} = await import('./server.mjs?scene-continuity-test');
const {
    SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA,
    validateSceneContinuityAnalysisModelOutput,
} = await import('./scene-continuity-contract.mjs');

function assertAnthropicSchemaConstraintsAreSupported(schema, path = '$') {
    if (Array.isArray(schema)) {
        schema.forEach((value, index) => assertAnthropicSchemaConstraintsAreSupported(value, `${path}[${index}]`));
        return;
    }
    if (!schema || typeof schema !== 'object') return;
    for (const key of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems']) {
        assert.equal(Object.hasOwn(schema, key), false, `${path}.${key} is excluded from the Anthropic grammar`);
    }
    if (Object.hasOwn(schema, 'minItems')) assert.ok([0, 1].includes(schema.minItems), `${path}.minItems uses a supported value`);
    if (typeof schema.pattern === 'string') assert.equal(schema.pattern.includes('(?:'), false, `${path}.pattern uses a supported group form`);
    for (const [key, value] of Object.entries(schema)) assertAnthropicSchemaConstraintsAreSupported(value, `${path}.${key}`);
}

for (const [name, schema] of Object.entries({
    annotation: PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
    tile: PRESENTATION_TILE_CANDIDATE_JSON_SCHEMA,
    unit: PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA,
    sceneContinuity: SCENE_CONTINUITY_ANALYSIS_MODEL_JSON_SCHEMA,
})) {
    assertAnthropicSchemaConstraintsAreSupported(transformAnthropicOutputSchema(schema), name);
}

const boundaryMarkerPattern = /~[0-9a-z]{4,5}~/gu;
const tileMarkerSchema = PRESENTATION_TILE_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties.startMarker;
assert.deepEqual({ minLength: tileMarkerSchema.minLength, maxLength: tileMarkerSchema.maxLength }, { minLength: 6, maxLength: 7 },
    'tile candidate accepts compact six or seven character markers');
assert.equal(PRESENTATION_TILE_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties.evidenceMarkers.minItems, 1,
    'tile candidates must include evidence for each segment classification');
assert.equal(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties.evidenceQuotes.minItems, 1,
    'ordinary candidates must include evidence for each segment classification');
assert.equal(classifyProviderHttpFailure(400, JSON.stringify({ error: { type: 'invalid_request_error', param: 'messages', message: 'Maximum context length exceeded' } })), 'input-context-limit');
assert.equal(classifyProviderHttpFailure(400, JSON.stringify({ error: { param: 'response_format', message: 'unsupported json_object format' } })), 'response-format-parameter');
assert.equal(classifyProviderHttpFailure(400, JSON.stringify({ error: { param: 'max_tokens', message: 'bad request' } })), 'output-token-limit');
assert.equal(classifyProviderHttpFailure(400, JSON.stringify({ error: { type: 'server_error', message: 'temporary upstream failure' } })), 'upstream-server-error');
assert.deepEqual(safeProviderErrorDiagnosticsFromBody(JSON.stringify({ error: {
    type: 'invalid_request_error', code: 'unsupported_parameter', param: 'response_format',
    message: 'private provider body must not be retained',
} })), {
    envelope: 'json-error', type: 'invalid_request_error', code: 'unsupported_parameter', param: 'response_format',
});
assert.deepEqual(safeProviderErrorDiagnosticsFromBody(JSON.stringify({ error: {
    type: 'private-value', code: 'private-value', param: 'private-value', message: 'private body',
} })), { envelope: 'json-error', type: 'other', code: 'other', param: 'other' });
assert.equal(JSON.stringify(safeProviderErrorDiagnosticsFromBody(JSON.stringify({
    error: { message: 'credential=must-not-appear', param: 'not-a-known-field' },
}))).includes('credential'), false);
const wrappedProviderFailure = createProviderFailure({
    status: 400,
    providerErrorCategory: 'request-rejected',
    providerErrorDiagnostics: safeProviderErrorDiagnosticsFromBody(JSON.stringify({ error: {
        type: 'invalid_request_error', code: 'unsupported_parameter', param: 'response_format',
        message: 'credential=must-not-appear and story text must not be logged',
    } })),
}, []);
let safeProviderLog = '';
const originalStderrWrite = process.stderr.write;
process.stderr.write = (chunk) => { safeProviderLog += String(chunk); return true; };
try {
    logProviderFailure('00000000-0000-4000-8000-000000000001', 'annotations', 'ANALYZER_UNAVAILABLE', 'provider-invoke', 5, wrappedProviderFailure);
} finally {
    process.stderr.write = originalStderrWrite;
}
const parsedSafeProviderLog = JSON.parse(safeProviderLog.trim());
assert.deepEqual(parsedSafeProviderLog.providerErrorDiagnostics, {
    envelope: 'json-error', type: 'invalid_request_error', code: 'unsupported_parameter', param: 'response_format',
});
assert.equal(safeProviderLog.includes('credential=must-not-appear'), false);
assert.equal(safeProviderLog.includes('story text must not be logged'), false);
assert.deepEqual(
    validationIssueCategories(['unit-candidate.keys.missing.schemaVersion', 'unit-candidate.keys.missing.results']),
    ['missing-schema-version', 'missing-results'],
    'missing top-level candidate fields are reported only through fixed schema-key categories',
);
    assert.equal(classifyProviderHttpFailure(401, JSON.stringify({ error: { message: 'token must never appear in logs' } })), 'authentication');
    assert.equal(classifyProviderHttpFailure(400, JSON.stringify({ error: { message: 'opaque malformed request with secret=do-not-log' } })), 'request-rejected');
    assert.equal(classifyProviderHttpFailure(400, 'Request blocked by content safety policy'), 'content-policy');

function unmarkProviderView(markedText) {
    const tokens = [];
    boundaryMarkerPattern.lastIndex = 0;
    let codePointOffset = 0;
    let raw = '';
    let cursor = 0;
    for (const match of String(markedText).matchAll(boundaryMarkerPattern)) {
        const between = String(markedText).slice(cursor, match.index);
        raw += between;
        codePointOffset += Array.from(between).length;
        tokens.push({ marker: match[0], offset: codePointOffset });
        cursor = match.index + match[0].length;
    }
    raw += String(markedText).slice(cursor);
    return { raw, tokens };
}

function makeTileCandidate(markedText, semantic = {}) {
    const { raw, tokens } = unmarkProviderView(markedText);
    const tokenAt = new Map(tokens.map(({ marker, offset }) => [offset, marker]));
    const markersForText = (text, fromIndex = 0) => {
        const index = raw.indexOf(text, fromIndex);
        if (index < 0) return null;
        const start = Array.from(raw.slice(0, index)).length;
        const end = start + Array.from(text).length;
        return { startMarker: tokenAt.get(start), endMarker: tokenAt.get(end) };
    };
    const segments = [{
        startMarker: tokenAt.get(0), kind: 'narration', speakerMentionRef: null,
        speakerSource: 'none', confidenceBand: 'high', evidenceMarkers: [],
    }];
    const entities = [];
    let identityLinkCandidates = [];
    let stateClaims = [];
    if (semantic.attribution && raw.includes(semantic.attribution)) {
        const attributionIndex = raw.indexOf(semantic.attribution);
        const dialogueStart = Array.from(raw.slice(0, attributionIndex + semantic.attribution.length)).length;
        segments.push({
            startMarker: tokenAt.get(dialogueStart), kind: 'dialogue', speakerMentionRef: 'm0',
            speakerSource: 'quoted-attribution', confidenceBand: 'high',
            evidenceMarkers: [{ ...markersForText(semantic.attribution), purpose: 'speaker' }],
        });
        const mentionSpan = markersForText('Mira', attributionIndex);
        entities.push({ mentionRef: 'm0', surfaceStartMarker: mentionSpan?.startMarker, surfaceEndMarker: mentionSpan?.endMarker, kind: 'person', attributeEvidence: [] });
        identityLinkCandidates = [{
            fromMentionRef: 'm0', toResolverEntityRef: 'published:mira', relation: 'same-entity',
            evidenceMarkers: [markersForText(semantic.stateEvidenceQuote)], confidenceBand: 'high',
        }];
        stateClaims = [{
            claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'],
            rosterSnapshotCompleteness: 'complete', evidenceMarkers: [markersForText(semantic.stateEvidenceQuote)], confidenceBand: 'high',
        }];
    }
    const rawCodePoints = Array.from(raw);
    const firstSegmentEnd = segments[1]
        ? Array.from(raw.slice(0, raw.indexOf(semantic.attribution) + semantic.attribution.length)).length
        : rawCodePoints.length;
    const requestedClassificationStart = Number.isSafeInteger(semantic.classificationStartOffset)
        ? semantic.classificationStartOffset
        : 0;
    const classificationForSegment = (segmentStart, segmentEnd) => {
        const coreStart = Number.isSafeInteger(semantic.coreStartOffset) ? semantic.coreStartOffset : 0;
        const coreEnd = Number.isSafeInteger(semantic.coreEndOffset) ? semantic.coreEndOffset : rawCodePoints.length;
        const coreSegmentStart = Math.max(segmentStart, coreStart);
        const coreSegmentEnd = Math.min(segmentEnd, coreEnd);
        const evidenceStart = coreSegmentEnd > coreSegmentStart
            ? Math.max(coreSegmentStart, Math.min(coreSegmentEnd - 1, requestedClassificationStart))
            : Math.max(segmentStart, Math.min(segmentEnd - 1, requestedClassificationStart));
        const evidenceEnd = Math.min(segmentEnd, evidenceStart + 24, coreSegmentEnd > coreSegmentStart ? coreSegmentEnd : segmentEnd);
        const text = rawCodePoints.slice(evidenceStart, evidenceEnd).join('');
        const utf16Start = rawCodePoints.slice(0, evidenceStart).join('').length;
        return { ...markersForText(text, utf16Start), purpose: 'classification' };
    };
    const firstClassificationEvidence = classificationForSegment(0, firstSegmentEnd);
    segments[0].evidenceMarkers = [firstClassificationEvidence];
    if (segments[1]) {
        const dialogueStart = tokenAt.get(0) ? [...tokenAt.entries()].find(([, marker]) => marker === segments[1].startMarker)?.[0] : 0;
        segments[1].evidenceMarkers.push(classificationForSegment(dialogueStart, rawCodePoints.length));
    }
    return {
        schemaVersion: PRESENTATION_TILE_CANDIDATE_VERSION,
        results: [{ segments, entities, identityLinkCandidates, stateClaims }],
    };
}

function makeQuoteTileCandidate(visibleText, semantic = {}) {
    const codePoints = Array.from(visibleText);
    const countOccurrences = (source, quote) => {
        let count = 0;
        let cursor = 0;
        while ((cursor = source.indexOf(quote, cursor)) >= 0) {
            count += 1;
            cursor += 1;
        }
        return count;
    };
    const anchorAt = (boundary) => {
        if (boundary === 0) return { beforeText: '', afterText: codePoints.slice(0, Math.min(codePoints.length, 48)).join('') };
        for (let width = 16; width <= Math.min(240, boundary, codePoints.length - boundary); width += 8) {
            const beforeText = codePoints.slice(boundary - width, boundary).join('');
            const afterText = codePoints.slice(boundary, boundary + width).join('');
            if (countOccurrences(visibleText, beforeText + afterText) === 1) return { beforeText, afterText };
        }
        return {
            beforeText: codePoints.slice(Math.max(0, boundary - 240), boundary).join(''),
            afterText: codePoints.slice(boundary, Math.min(codePoints.length, boundary + 240)).join(''),
        };
    };
    const attributionIndex = semantic.attribution ? visibleText.indexOf(semantic.attribution) : -1;
    const dialogueStart = attributionIndex < 0 ? -1 : Array.from(visibleText.slice(0, attributionIndex + semantic.attribution.length)).length;
    const chooseUniqueEvidence = (segmentStart, segmentEnd) => {
        const desiredCoreStart = Number.isSafeInteger(semantic.coreStartOffset) ? semantic.coreStartOffset : 0;
        const desiredCoreEnd = Number.isSafeInteger(semantic.coreEndOffset) ? semantic.coreEndOffset : codePoints.length;
        const overlapStart = Math.max(segmentStart, desiredCoreStart);
        const overlapEnd = Math.min(segmentEnd, desiredCoreEnd);
        const from = overlapEnd > overlapStart ? overlapStart : segmentStart;
        const to = overlapEnd > overlapStart ? overlapEnd : segmentEnd;
        const segmentText = codePoints.slice(segmentStart, segmentEnd).join('');
        for (let length = Math.min(24, to - from); length <= to - from; length += 1) {
            const quote = codePoints.slice(from, from + length).join('');
            if (quote && countOccurrences(segmentText, quote) === 1) return quote;
        }
        return codePoints.slice(from, to).join('');
    };
    const segments = [];
    if (dialogueStart > 0) {
        segments.push({
            startAnchor: anchorAt(0), kind: 'narration', speakerMentionRef: null,
            speakerSource: 'none', confidenceBand: 'high',
            evidenceQuotes: [{ text: chooseUniqueEvidence(0, dialogueStart), purpose: 'classification' }],
        });
        segments.push({
            startAnchor: anchorAt(dialogueStart), kind: 'dialogue', speakerMentionRef: 'm0',
            speakerSource: 'quoted-attribution', confidenceBand: 'high',
            evidenceQuotes: [
                { text: semantic.attribution, purpose: 'speaker' },
                { text: chooseUniqueEvidence(dialogueStart, codePoints.length), purpose: 'classification' },
            ],
        });
    } else {
        segments.push({
            startAnchor: anchorAt(0), kind: 'narration', speakerMentionRef: null,
            speakerSource: 'none', confidenceBand: 'high',
            evidenceQuotes: [{ text: chooseUniqueEvidence(0, codePoints.length), purpose: 'classification' }],
        });
    }
    const hasAttribution = attributionIndex >= 0 && semantic.stateEvidenceQuote && visibleText.includes(semantic.stateEvidenceQuote);
    const entities = hasAttribution ? [{
        mentionRef: 'm0', kind: 'person', surfaceText: 'Mira', contextText: semantic.stateEvidenceQuote, attributeEvidence: [],
    }] : [];
    const identityLinkCandidates = hasAttribution ? [{
        fromMentionRef: 'm0', toResolverEntityRef: 'published:mira', relation: 'same-entity',
        evidenceQuotes: [semantic.stateEvidenceQuote], confidenceBand: 'high',
    }] : [];
    const stateClaims = hasAttribution ? [{
        claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'],
        rosterSnapshotCompleteness: 'complete', evidenceQuotes: [semantic.stateEvidenceQuote], confidenceBand: 'high',
    }] : [];
    return {
        schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION,
        results: [{ segments, entities, identityLinkCandidates, stateClaims }],
    };
}

function makeUnitCandidate(providerInput, classify = () => ({ kind: 'narration', speakerMentionRef: null }), optional = {}) {
    const message = providerInput.messages[0];
    return {
        schemaVersion: PRESENTATION_UNIT_CANDIDATE_VERSION,
        results: [{
            unitClassifications: message.ownedUnits.map((unit) => {
                const selected = classify(unit, message);
                return {
                    unitId: unit.unitId,
                    kind: selected.kind,
                    speakerMentionRef: selected.speakerMentionRef ?? null,
                    classificationEvidenceCellIds: selected.kind === 'mixed'
                        ? [] : [unit.classificationEvidenceCells[0].id],
                    speakerEvidenceCellIds: selected.speakerEvidenceCellIds || [],
                };
            }),
            entities: optional.entities || [],
            identityLinkCandidates: optional.identityLinkCandidates || [],
            stateClaims: optional.stateClaims || [],
        }],
    };
}

assert.equal(PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.unitClassifications.items.additionalProperties, false);
assert.equal(PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA.properties.results.minItems, 1,
    'the unit candidate schema requires one result for its single target message');
assert.equal(PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA.properties.results.maxItems, 1,
    'the unit candidate schema rejects extra top-level results');
const unitRecordProperties = PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.unitClassifications.items.properties;
assert.deepEqual(Object.keys(unitRecordProperties).sort(), [
    'classificationEvidenceCellIds', 'kind', 'speakerEvidenceCellIds', 'speakerMentionRef', 'unitId',
].sort(), 'unit classification records contain only opaque IDs, kind and supported speaker references');
assert.equal(Object.hasOwn(unitRecordProperties, 'start'), false, 'unit records cannot request model-authored numeric offsets');
assert.equal(Object.hasOwn(unitRecordProperties, 'startAnchor'), false, 'unit records cannot request model-authored text anchors');

const repeatedUnicodeText = `${'重复重复没有引号'.repeat(28)}😀e\u0301👩‍👩‍👧‍👦${'重复重复没有引号'.repeat(28)}`;
const shortMixedText = 'Mira推开石门。Mira说：“快走！”Rowan回答：“我来挡住他们。”';
const shortMixedPlan = createPresentationSourceUnits(shortMixedText);
assert.equal(shortMixedPlan.valid, true);
assert.deepEqual(shortMixedPlan.units.map((unit) => shortMixedPlan.codePoints.slice(unit.start, unit.end).join('')), [
    'Mira推开石门。', 'Mira说：“快走！”', 'Rowan回答：“我来挡住他们。”',
], 'short mixed Chinese text is grouped at Unicode sentence boundaries before semantic classification');
const crlfPlan = createPresentationSourceUnits('A\r\nB');
assert.equal(crlfPlan.valid, true);
assert.deepEqual(crlfPlan.units.map((unit) => crlfPlan.codePoints.slice(unit.start, unit.end).join('')), ['A\r\n', 'B'],
    'short source units do not split the CRLF grapheme or create a newline-only unit');
const crlfOnlyPlan = createPresentationSourceUnits('\r\n');
assert.equal(crlfOnlyPlan.valid, true);
assert.deepEqual(crlfOnlyPlan.units.map((unit) => crlfOnlyPlan.codePoints.slice(unit.start, unit.end).join('')), ['\r\n'],
    'a CRLF-only source remains a single intact unit');
const longCrlfText = `${'a'.repeat(139)}\r\n${'b'.repeat(40)}`;
const longCrlfPlan = createPresentationSourceUnits(longCrlfText);
assert.equal(longCrlfPlan.valid, true);
assert.equal(longCrlfPlan.codePoints.slice(longCrlfPlan.units[0].start, longCrlfPlan.units[0].end).join(''), `${'a'.repeat(139)}\r\n`,
    'long-text source units do not split CRLF when choosing a nearby natural boundary');
assert.ok(longCrlfPlan.units.every((unit) => {
    const part = longCrlfPlan.codePoints.slice(unit.start, unit.end).join('');
    return !part.startsWith('\n') && !part.endsWith('\r');
}), 'CRLF stays inside a single grapheme-safe source unit for long text');
const repeatedUnicodePlan = createPresentationSourceUnits(repeatedUnicodeText);
assert.equal(repeatedUnicodePlan.valid, true);
assert.equal(repeatedUnicodePlan.units[0].start, 0);
assert.equal(repeatedUnicodePlan.units.at(-1).end, Array.from(repeatedUnicodeText).length);
assert.ok(repeatedUnicodePlan.units.every((unit, index) => index === 0 || repeatedUnicodePlan.units[index - 1].end === unit.start),
    'source units partition the full Unicode source exactly without gaps or overlaps');
assert.equal(repeatedUnicodePlan.units.map((unit) => repeatedUnicodePlan.codePoints.slice(unit.start, unit.end).join('')).join(''), repeatedUnicodeText,
    'repeated substrings and text without quotation marks reconstruct byte-for-byte from source units');
assert.ok(repeatedUnicodePlan.units.every((unit) => unit.end - unit.start <= 160 || unit.end - unit.start === 1),
    'unit partitioning targets bounded Unicode code-point spans');
const repeatedGraphemeEnds = new Set([0]);
const repeatedUtf16Map = new Map([[0, 0]]);
let repeatedUtf16Cursor = 0;
for (let cpIndex = 0; cpIndex < repeatedUnicodePlan.codePoints.length; cpIndex += 1) {
    repeatedUtf16Cursor += repeatedUnicodePlan.codePoints[cpIndex].length;
    repeatedUtf16Map.set(repeatedUtf16Cursor, cpIndex + 1);
}
for (const part of new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(repeatedUnicodeText)) {
    repeatedGraphemeEnds.add(repeatedUtf16Map.get(part.index + part.segment.length));
}
assert.ok(repeatedUnicodePlan.units.every((unit) => repeatedGraphemeEnds.has(unit.start) && repeatedGraphemeEnds.has(unit.end)),
    'unit boundaries preserve combining sequences and joined emoji graphemes');
assert.notEqual(repeatedUnicodePlan.units[0].id, repeatedUnicodePlan.units[1].id);
assert.doesNotMatch(repeatedUnicodePlan.units[0].id, /^(?:0|1|2|3|4|5|6|7|8|9)+$/u, 'source-unit IDs are opaque rather than offsets');
const repeatedRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'unit-id-materializer' },
    messages: [{ sourceMessageIndex: 1, sourceMessageHash: await createVisibleMessageHash(repeatedUnicodeText), authorLabel: '', visibleText: repeatedUnicodeText }],
    knownEntities: [],
});
const repeatedUnitLocal = repeatedUnicodePlan.units.map(({ id, start, end, depth }) => ({ id, start, end, depth }));
const repeatedMaps = await createPresentationUnitProviderInput(repeatedRequest, repeatedRequest.messages[0], repeatedUnicodePlan.codePoints,
    repeatedUnitLocal, new Set(), true);
assert.equal(repeatedMaps.providerInput.messages[0].visibleText, repeatedUnicodeText);
assert.ok(repeatedMaps.providerInput.messages[0].ownedUnits.every((unit) => unit.classificationEvidenceCells.every((cell) => Array.from(cell.text).length <= 24)),
    'classification evidence is presented as short cells with server-side span maps');
assert.ok(repeatedMaps.providerInput.messages[0].ownedUnits.every((unit) => unit.unitId.length <= 18
    && unit.classificationEvidenceCells.every((cell) => cell.id.length <= 18))
    && repeatedMaps.providerInput.messages[0].speakerEvidenceCells.every((cell) => cell.id.length <= 18),
'opaque IDs stay compact so unit and evidence maps do not consume avoidable prompt tokens');
assert.ok(Buffer.byteLength(JSON.stringify(repeatedMaps.providerInput), 'utf8') < 32 * 1024,
    'repeated source text and evidence cells remain inside a bounded provider payload');
const repeatedUnitCandidate = makeUnitCandidate(repeatedMaps.providerInput);
const wrongUnitResultsShape = structuredClone(repeatedUnitCandidate);
wrongUnitResultsShape.results = {};
const wrongUnitResultsShapeValidation = await materializePresentationUnitCandidate(
    wrongUnitResultsShape, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal);
assert.equal(wrongUnitResultsShapeValidation.valid, false);
assert.deepEqual(wrongUnitResultsShapeValidation.errors, ['unit-candidate.results.type.object'],
    'non-array result wrappers are rejected with a stable type code');
const wrongUnitResultsCount = structuredClone(repeatedUnitCandidate);
wrongUnitResultsCount.results = [];
const wrongUnitResultsCountValidation = await materializePresentationUnitCandidate(
    wrongUnitResultsCount, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal);
assert.equal(wrongUnitResultsCountValidation.valid, false);
assert.deepEqual(wrongUnitResultsCountValidation.errors, ['unit-candidate.results.count'],
    'missing or extra result wrappers are rejected with a stable count code');
const repeatedUnitMaterialized = await materializePresentationUnitCandidate(repeatedUnitCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal);
assert.equal(repeatedUnitMaterialized.valid, true, `opaque unit IDs resolve repeated no-quote text without boundary guessing (${JSON.stringify(repeatedUnitMaterialized.errors || [])})`);
const reversedUnitCandidate = structuredClone(repeatedUnitCandidate);
reversedUnitCandidate.results[0].unitClassifications.reverse();
const reconciledReversedUnits = await materializePresentationUnitCandidate(
    reversedUnitCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
);
assert.equal(reconciledReversedUnits.valid, true,
    'reordered rows are restored only when request-local IDs and each row’s exact evidence agree on a one-to-one unit mapping');
assert.ok(reconciledReversedUnits.recoveryDiagnostics?.issueKinds.includes('unit-ids-reconciled'));
assert.ok(reconciledReversedUnits.recoveryDiagnostics.reconciledUnitRecords > 0
    && reconciledReversedUnits.recoveryDiagnostics.reconciledUnitRecords <= repeatedUnitLocal.length);
const duplicateCellCandidate = structuredClone(repeatedUnitCandidate);
duplicateCellCandidate.results[0].unitClassifications[0].classificationEvidenceCellIds.push(
    duplicateCellCandidate.results[0].unitClassifications[0].classificationEvidenceCellIds[0]);
assert.equal((await materializePresentationUnitCandidate(duplicateCellCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal)).valid, false,
    'duplicate evidence-cell IDs fail closed');
const firstUnitCells = repeatedMaps.providerInput.messages[0].ownedUnits[0].classificationEvidenceCells;
if (firstUnitCells.length >= 3) {
    const noncontiguousCellsCandidate = structuredClone(repeatedUnitCandidate);
    noncontiguousCellsCandidate.results[0].unitClassifications[0].classificationEvidenceCellIds = [firstUnitCells[0].id, firstUnitCells[2].id];
    assert.equal((await materializePresentationUnitCandidate(noncontiguousCellsCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal)).valid, false,
        'noncontiguous classification evidence-cell IDs fail closed');
}
const foreignPlan = createPresentationSourceUnits(repeatedUnicodeText);
const foreignUnitCandidate = structuredClone(repeatedUnitCandidate);
foreignUnitCandidate.results[0].unitClassifications[0].unitId = foreignPlan.units[0].id;
const reconciledForeignUnit = await materializePresentationUnitCandidate(
    foreignUnitCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
);
assert.equal(reconciledForeignUnit.valid, true,
    'an unknown unit ID is ignored only when that row’s exact current-request evidence uniquely identifies its owner');
assert.equal(reconciledForeignUnit.recoveryDiagnostics?.reconciledUnitRecords, 1);
const duplicateUnitCandidate = structuredClone(repeatedUnitCandidate);
duplicateUnitCandidate.results[0].unitClassifications[1].unitId = duplicateUnitCandidate.results[0].unitClassifications[0].unitId;
assert.equal((await materializePresentationUnitCandidate(duplicateUnitCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal)).valid, false,
    'a known source-unit ID that contradicts its evidence owner remains fail closed');
const unknownEvidenceCandidate = structuredClone(repeatedUnitCandidate);
unknownEvidenceCandidate.results[0].unitClassifications[0].classificationEvidenceCellIds = ['e_foreign_evidence_cell'];
assert.equal((await materializePresentationUnitCandidate(unknownEvidenceCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal)).valid, false,
    'unknown evidence-cell IDs fail closed');
if (repeatedUnitLocal.length >= 2) {
    const ambiguousOwnerCandidate = structuredClone(repeatedUnitCandidate);
    ambiguousOwnerCandidate.results[0].unitClassifications[0].unitId = foreignPlan.units[0].id;
    ambiguousOwnerCandidate.results[0].unitClassifications[0].classificationEvidenceCellIds = [
        firstUnitCells[0].id,
        repeatedMaps.providerInput.messages[0].ownedUnits[1].classificationEvidenceCells[0].id,
    ];
    assert.equal((await materializePresentationUnitCandidate(
        ambiguousOwnerCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
    )).valid, false, 'evidence spanning two source units cannot repair an invalid unit ID');
}

function anthropicStructuredOutputResponseFromRequest(init, input) {
    const requestBody = JSON.parse(init.body);
    const format = requestBody.output_config?.format;
    assert.equal(format?.type, 'json_schema', 'schema-bound Anthropic calls must use structured JSON output');
    assert.deepEqual(Object.keys(format).sort(), ['schema', 'type'], 'Anthropic format uses the documented type+schema envelope');
    assert.equal(format.schema?.type, 'object', 'the provider receives the complete object schema');
    assert.equal(Object.hasOwn(requestBody, 'tools'), false, 'this validated route does not rely on gateway tool-use coercion');
    return new Response(JSON.stringify({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(input) }],
    }), { status: 200 });
}
const allMixedCandidate = structuredClone(repeatedUnitCandidate);
allMixedCandidate.results[0].unitClassifications = allMixedCandidate.results[0].unitClassifications.map((row) => ({
    ...row, kind: 'mixed', classificationEvidenceCellIds: [], speakerEvidenceCellIds: [], speakerMentionRef: null,
}));
assert.equal((await materializePresentationUnitCandidate(allMixedCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal)).valid, true,
    'mixed is accepted only as an internal refinement signal, not forced to narration');
const mixedForeignUnitCandidate = structuredClone(allMixedCandidate);
mixedForeignUnitCandidate.results[0].unitClassifications[0].unitId = foreignPlan.units[0].id;
assert.equal((await materializePresentationUnitCandidate(
    mixedForeignUnitCandidate, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
)).valid, false, 'mixed rows have no classification evidence, so unknown IDs cannot be reconciled');
const mixedWithProvisionalClaims = structuredClone(repeatedUnitCandidate);
mixedWithProvisionalClaims.results[0].unitClassifications = mixedWithProvisionalClaims.results[0].unitClassifications.map((row) => ({
    ...row,
    kind: 'mixed',
    speakerMentionRef: 'm0',
    classificationEvidenceCellIds: [row.classificationEvidenceCellIds[0]],
    speakerEvidenceCellIds: [repeatedMaps.providerInput.messages[0].speakerEvidenceCells[0].id],
}));
const recoveredMixedClaims = await materializePresentationUnitCandidate(
    mixedWithProvisionalClaims, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
);
assert.equal(recoveredMixedClaims.valid, true,
    'mixed is a refinement-only control value, so unused provisional evidence and speaker claims do not invalidate final classifications');
assert.ok(recoveredMixedClaims.classifications.every((classification) => (
    classification.kind === 'mixed' && classification.speakerMentionRef === null
        && classification.classificationSpans.length === 0 && classification.speakerSpans.length === 0
)), 'all provisional mixed claims are discarded before refinement');
assert.ok(recoveredMixedClaims.recoveryDiagnostics?.issueKinds.includes('mixed-claims-discarded'));
assert.equal(recoveredMixedClaims.recoveryDiagnostics.discardedMixedClaims, repeatedUnitLocal.length);
const malformedMixedEvidenceShape = structuredClone(mixedWithProvisionalClaims);
malformedMixedEvidenceShape.results[0].unitClassifications[0].speakerEvidenceCellIds = null;
const rejectedMalformedMixedEvidenceShape = await materializePresentationUnitCandidate(
    malformedMixedEvidenceShape, repeatedMaps.tileRequest, repeatedMaps, repeatedUnitLocal,
);
assert.equal(rejectedMalformedMixedEvidenceShape.valid, false,
    'mixed refinement discards bounded claims but still rejects malformed evidence field shapes');
assert.ok(rejectedMalformedMixedEvidenceShape.errors.includes('unit-candidate.units.0.speaker-evidence.shape'));
const repeatedUnitTiles = createPresentationUnitTiles(repeatedUnicodePlan, true);
assert.equal(repeatedUnitTiles.valid, true);
assert.equal(repeatedUnitTiles.tiles[0].coreStart, 0);
assert.equal(repeatedUnitTiles.tiles.at(-1).coreEnd, Array.from(repeatedUnicodeText).length);
assert.ok(repeatedUnitTiles.tiles.every((tile, index) => index === 0 || repeatedUnitTiles.tiles[index - 1].coreEnd === tile.coreStart),
    'unit-aligned tile seams are contiguous and do not split source units');

const invalid = loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'http://127.0.0.1',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'test',
});
assert.equal(invalid, null);
const disallowed = loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://provider.example',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'claude-sonnet-4-6',
});
assert.equal(disallowed, null);
assert.equal(loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://aiself.vip',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'claude-sonnet-5',
}), null, 'the service rejects models other than the pinned semantic-analysis model');
assert.equal(loadConfig({
    GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'openai-compatible',
    GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://aiself.vip',
    GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
    GALGAME_PRESENTATION_ANALYZER_MODEL: 'claude-sonnet-4-6',
}), null, 'the service rejects non-Anthropic providers even on the pinned host');

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
            { startAnchor: { beforeText: '', afterText: 'Mira说：' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: 'Mira说：', purpose: 'classification' }] },
            { startAnchor: { beforeText: '说：', afterText: '“' }, kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'quoted-attribution', confidenceBand: 'high', evidenceQuotes: [{ text: 'Mira说：', purpose: 'speaker' }, { text: '“好。”', purpose: 'classification' }] },
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
assert.deepEqual(materialized.response.results[0].segments[1].evidenceSpans, [
    { start: 0, end: 6, purpose: 'speaker' },
    { start: 6, end: 10, purpose: 'classification' },
], 'service resolves speaker and classification evidence to Unicode code-point ranges');
const missingOrdinaryClassification = structuredClone(candidateForLocalRequest);
missingOrdinaryClassification.results[0].segments.forEach((segment) => { segment.evidenceQuotes = []; });
const rejectedMissingOrdinaryClassification = await materializePresentationAnalyzerCandidate(missingOrdinaryClassification, localAnnotationRequest);
assert.equal(rejectedMissingOrdinaryClassification.valid, false,
    'ordinary quote candidates cannot classify narration or dialogue with empty evidence');
assert.ok(rejectedMissingOrdinaryClassification.errors.includes('candidate.results.0.segments.0.classification-evidence'));
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
            { startAnchor: { beforeText: '', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: 'A:', purpose: 'classification' }] },
            { startAnchor: { beforeText: ':', afterText: ':' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: ':B:', purpose: 'classification' }] },
            { startAnchor: { beforeText: 'B:', afterText: ':C' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: ':C::D', purpose: 'classification' }] },
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

const markerText = '😀ABC';
const markerRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'tile-markers' },
    messages: [{ sourceMessageIndex: 12, sourceMessageHash: await createVisibleMessageHash(markerText), authorLabel: '', visibleText: markerText }],
    knownEntities: [],
});
const markerSet = createRequestLocalBoundaryMarkers(markerText);
const markerAt = (offset) => markerSet.markersByOffset.get(offset);
const firstBoundaryMarker = markerAt(0);
const fullProviderVisibleReservation = createTileMarkerReservationText(markerRequest);
assert.ok(fullProviderVisibleReservation.includes('~ab00~'), 'marker collision scan includes the fixed system prompt example');
assert.ok(fullProviderVisibleReservation.includes('candidateSchema'), 'marker collision scan includes the response schema');
const reservedSemanticInput = JSON.stringify({ otherMessage: 'Somebody speaks here', resolverEntityRef: 'published:known-character' });
const reservedMarkerSet = createRequestLocalBoundaryMarkers('定位', { reservedText: reservedSemanticInput });
assert.ok([...reservedMarkerSet.markersByOffset.values()].every((marker) => !reservedSemanticInput.includes(marker)),
    'every request-local marker is absent from reserved semantic input');
assert.ok(/^[0-9a-z]{2,3}$/u.test(reservedMarkerSet.markersByOffset.get(0).slice(1, -3)),
    'compact marker uses a two or three character nonce');
reservedMarkerSet.dispose();
const collisionAvoidingMarkerSet = createRequestLocalBoundaryMarkers('定位', { reservedText: firstBoundaryMarker });
assert.notEqual(collisionAvoidingMarkerSet.markersByOffset.get(0), firstBoundaryMarker,
    'a marker token already present in provider-visible input is never allocated');
collisionAvoidingMarkerSet.dispose();
const allTwoCharacterNonceMarkers = Array.from({ length: 36 ** 2 }, (_, index) => `~${index.toString(36).padStart(2, '0')}00~`).join(' ');
const fallbackNonceMarkerSet = createRequestLocalBoundaryMarkers('x', { reservedText: allTwoCharacterNonceMarkers });
assert.equal(fallbackNonceMarkerSet.markersByOffset.get(0).slice(1, -3).length, 3,
    'allocator uses the three-character nonce fallback when all short nonce marker tokens are reserved');
fallbackNonceMarkerSet.dispose();
const markerPair = (start, end) => ({ startMarker: markerAt(start), endMarker: markerAt(end) });
const basicTileCandidate = (markers, evidenceMarkers = []) => ({
    schemaVersion: PRESENTATION_TILE_CANDIDATE_VERSION,
    results: [{
        segments: markers.map((startMarker, index) => {
            const start = markerSet.offsetsByMarker.get(startMarker) ?? 0;
            const endMarker = markers[index + 1] || markerAt(Array.from(markerText).length);
            const end = markerSet.offsetsByMarker.get(endMarker) ?? Array.from(markerText).length;
            return {
                startMarker, kind: 'narration', speakerMentionRef: null,
                speakerSource: 'none', confidenceBand: 'high',
                evidenceMarkers: [
                    ...evidenceMarkers,
                    ...(evidenceMarkers.some((evidence) => evidence.purpose === 'classification')
                        ? [] : [{ ...markerPair(start, end), purpose: 'classification' }]),
                ],
            };
        }),
        entities: [], identityLinkCandidates: [], stateClaims: [],
    }],
});
const emojiTile = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0), markerAt(2)]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(emojiTile.valid, true, `internal marker mapping accepts exact Unicode code-point boundaries (${JSON.stringify(emojiTile.errors || [])})`);
assert.deepEqual(emojiTile.response.results[0].segments.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 2 }, { start: 2, end: 4 },
], 'an astral emoji occupies one boundary coordinate, not two UTF-16 units');
const unknownMarker = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0), '⟦foreign-marker⟧']), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(unknownMarker.valid, false);
assert.ok(unknownMarker.errors.includes('candidate.results.0.segments.1.marker-unknown'));
const repeatedMarker = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0), markerAt(0)]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(repeatedMarker.valid, false, 'a repeated boundary marker is rejected');
assert.ok(repeatedMarker.errors.includes('candidate.results.0.segments.1.marker-order'));
const outOfOrderMarker = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0), markerAt(3), markerAt(2)]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(outOfOrderMarker.valid, false, 'out-of-order boundary markers are rejected');
assert.ok(outOfOrderMarker.errors.includes('candidate.results.0.segments.2.marker-order'));
const foreignMarkerSet = createRequestLocalBoundaryMarkers(markerText);
assert.notEqual(foreignMarkerSet.markersByOffset.get(0).slice(1, -3), firstBoundaryMarker.slice(1, -3),
    'simultaneously live tile requests receive distinct ASCII nonces');
const foreignMarker = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0), foreignMarkerSet.markersByOffset.get(2)]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(foreignMarker.valid, false, 'a valid marker from another request has no authority in this tile');
assert.ok(foreignMarker.errors.includes('candidate.results.0.segments.1.marker-unknown'));
const crossTileMarkerValue = { results: [{ entities: [{ attributeEvidence: [{ value: markerAt(0) }] }] }] };
assert.equal(containsAnyRequestLocalBoundaryMarker(crossTileMarkerValue, [foreignMarkerSet.offsetsByMarker]), false,
    'a single tile-local scan cannot see a token allocated by a sibling tile');
assert.equal(containsAnyRequestLocalBoundaryMarker(crossTileMarkerValue, [markerSet.offsetsByMarker, foreignMarkerSet.offsetsByMarker]), true,
    'the final request-wide scan rejects any marker from any sibling tile or message');
foreignMarkerSet.dispose();
const badTileEvidence = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0)], [{ startMarker: '⟦foreign⟧', endMarker: markerAt(2), purpose: 'other' }]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(badTileEvidence.valid, false, 'unknown marker spans fail closed');
assert.ok(badTileEvidence.errors.includes('candidate.results.0.segments.0.evidence.0.marker-unknown'));
const markerNoLeak = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0)], [{ ...markerPair(1, 3), purpose: 'classification' }]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(markerNoLeak.valid, true);
assert.equal(JSON.stringify(markerNoLeak.response).includes(markerAt(0)), false, 'internal markers never enter public Annotation v1');
assert.deepEqual(markerNoLeak.response.results[0].segments[0].evidenceSpans,
    [{ start: 1, end: 3, purpose: 'classification' }], 'the server resolves marker pairs to exact Unicode code-point spans');

const reversedMarkerSpan = await materializePresentationAnalyzerCandidate(
    basicTileCandidate([markerAt(0)], [{ ...markerPair(3, 2), purpose: 'classification' }]), markerRequest,
    { boundaryMarkerMap: markerSet.offsetsByMarker },
);
assert.equal(reversedMarkerSpan.valid, false, 'a marker pair must point forward to a non-empty source span');
assert.ok(reversedMarkerSpan.errors.includes('candidate.results.0.segments.0.evidence.0.marker-range'));

const markerSemanticText = 'Mira（female）加入队伍。Mira说：“好。”';
const markerSemanticRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'tile-marker-semantic' },
    messages: [{ sourceMessageIndex: 19, sourceMessageHash: await createVisibleMessageHash(markerSemanticText), authorLabel: '', visibleText: markerSemanticText }],
    knownEntities: [{ resolverEntityRef: 'published:mira', visibleNames: ['Mira'], evidenceDigest: await createVisibleMessageHash('published:mira|Mira'), attributes: [] }],
});
const semanticMarkers = createRequestLocalBoundaryMarkers(markerSemanticText);
const semanticTokens = semanticMarkers.markersByOffset;
const semanticSpan = (text, occurrence = 0) => {
    let cursor = 0;
    let index = -1;
    for (let i = 0; i <= occurrence; i += 1) {
        index = markerSemanticText.indexOf(text, cursor);
        if (index < 0) throw new Error(`test source span not found: ${text}`);
        cursor = index + text.length;
    }
    const start = Array.from(markerSemanticText.slice(0, index)).length;
    const end = start + Array.from(text).length;
    return { startMarker: semanticTokens.get(start), endMarker: semanticTokens.get(end) };
};
const speakerBoundary = Array.from(markerSemanticText.slice(0, markerSemanticText.indexOf('Mira说：'))).length;
const markerSemanticCodePoints = Array.from(markerSemanticText);
const seamMergeFailure = await mergePresentationTileResults(markerSemanticRequest, [[
    {
        tile: { coreStart: 0, coreEnd: 2, viewStart: 0, viewEnd: markerSemanticCodePoints.length },
        response: { results: [{
            sourceMessageIndex: markerSemanticRequest.messages[0].sourceMessageIndex,
            sourceMessageHash: markerSemanticRequest.messages[0].sourceMessageHash,
            segments: [{ start: 0, end: markerSemanticCodePoints.length, textHash: markerSemanticRequest.messages[0].sourceMessageHash, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceSpans: [{ start: 0, end: 2, purpose: 'classification' }] }],
            entities: [], identityLinkCandidates: [], stateClaims: [],
        }] },
    },
    {
        tile: { coreStart: 2, coreEnd: markerSemanticCodePoints.length, viewStart: 0, viewEnd: markerSemanticCodePoints.length },
        response: { results: [{
            sourceMessageIndex: markerSemanticRequest.messages[0].sourceMessageIndex,
            sourceMessageHash: markerSemanticRequest.messages[0].sourceMessageHash,
            segments: [
                { start: 0, end: speakerBoundary, textHash: await createVisibleMessageHash(markerSemanticCodePoints.slice(0, speakerBoundary).join('')), kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceSpans: [{ start: 0, end: 2, purpose: 'classification' }] },
                { start: speakerBoundary, end: markerSemanticCodePoints.length, textHash: await createVisibleMessageHash(markerSemanticCodePoints.slice(speakerBoundary).join('')), kind: 'unattributed-dialogue', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceSpans: [{ start: speakerBoundary, end: markerSemanticCodePoints.length, purpose: 'classification' }] },
            ],
            entities: [], identityLinkCandidates: [], stateClaims: [],
        }] },
    },
]]);
assert.equal(seamMergeFailure.valid, false,
    'classification evidence found only in lookaround is discarded during clipping and must reject the merged result');
assert.ok(seamMergeFailure.errors.includes('tiles.merge.classification-evidence'), JSON.stringify(seamMergeFailure.errors));
const mergeFailureText = 'MergeFailureSecretSourceText';
const mergeFailureRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'merge-v1-diagnostic' },
    messages: [{ sourceMessageIndex: 20, sourceMessageHash: await createVisibleMessageHash(mergeFailureText), authorLabel: '', visibleText: mergeFailureText }],
    knownEntities: [],
});
const mergeFailureResult = await mergePresentationTileResults(mergeFailureRequest, [[{
    tile: { coreStart: 0, coreEnd: Array.from(mergeFailureText).length, viewStart: 0, viewEnd: Array.from(mergeFailureText).length },
    response: { results: [{
        sourceMessageIndex: mergeFailureRequest.messages[0].sourceMessageIndex,
        sourceMessageHash: mergeFailureRequest.messages[0].sourceMessageHash,
        segments: [{
            start: 0, end: Array.from(mergeFailureText).length, textHash: await createVisibleMessageHash(mergeFailureText),
            kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'invalid-confidence',
            evidenceSpans: [{ start: 0, end: Array.from(mergeFailureText).length, purpose: 'classification' }],
        }],
        entities: [], identityLinkCandidates: [], stateClaims: [],
    }] },
}]]);
assert.equal(mergeFailureResult.valid, false, 'invalid final Annotation v1 output remains rejected after tile merge');
assert.ok(mergeFailureResult.errors.includes('tiles.merge.final-v1-validation'));
assert.ok(mergeFailureResult.errors.includes('response.results.0.segments.0.confidenceBand'));
const mergeFailureCategories = validationIssueCategories(mergeFailureResult.errors);
assert.deepEqual(mergeFailureCategories, ['merge-final-v1-validation', 'confidenceBand'],
    'merge diagnostics preserve the final validation failure and only fixed validator categories');
assert.deepEqual(validationIssueCategories([
    'response.results.0.segments.0.evidenceSpans.0.outside-segment',
    'response.results.0.entities.2.surfaceSpan.start',
    'response.results.0.entities.2.attributeEvidence.1',
    'response.results.0.identityLinkCandidates.1',
    'response.results.0.stateClaims.3',
]), ['outside-segment', 'start', 'attribute-record-invalid', 'identity-link-record-invalid', 'state-claim-record-invalid'],
'final v1 diagnostics classify nested validator failures using fixed categories without logging paths');
assert.equal(mergeFailureResult.recoveryDiagnostics.outcome, 'recovery-not-applicable',
    'unsupported core validation failures explicitly record that optional recovery did not apply');
assert.deepEqual(mergeFailureResult.recoveryDiagnostics.initialValidatorCategories, ['confidenceBand']);
assert.deepEqual(mergeFailureResult.recoveryDiagnostics.finalValidatorCategories, []);
assert.equal(JSON.stringify(mergeFailureCategories).includes(mergeFailureText), false,
    'sanitized merge categories cannot contain source text');
assert.equal(JSON.stringify(mergeFailureResult.errors).includes(mergeFailureText), false,
    'merge validator issue paths cannot contain source text');

const optionalThenCoreFailureResponse = {
    schemaVersion: PRESENTATION_ANNOTATION_VERSION,
    results: [{
        sourceMessageIndex: mergeFailureRequest.messages[0].sourceMessageIndex,
        sourceMessageHash: mergeFailureRequest.messages[0].sourceMessageHash,
        segments: [{
            start: 0, end: Array.from(mergeFailureText).length, textHash: await createVisibleMessageHash(mergeFailureText),
            kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high',
            evidenceSpans: [{ start: 0, end: Array.from(mergeFailureText).length, purpose: 'classification' }],
        }],
        entities: [{
            mentionRef: 'm0', surfaceText: mergeFailureText, contextText: mergeFailureText, kind: 'person', attributeEvidence: [],
        }],
        identityLinkCandidates: [], stateClaims: [],
    }],
};
let recoveryRevalidationCalls = 0;
const optionalRecoveryStillFails = await attemptMergedAnnotationRecovery(
    optionalThenCoreFailureResponse,
    mergeFailureRequest,
    { valid: false, errors: ['response.results.0.entities.0.quote'] },
    async (recoveredResponse) => {
        recoveryRevalidationCalls += 1;
        assert.equal(recoveredResponse.results[0].entities.length, 0,
            'the optional entity is actually dropped before the required final validation');
        return { valid: false, errors: ['response.results.0.segments.0.confidenceBand', `response.results.0.${mergeFailureText}`] };
    },
);
assert.equal(recoveryRevalidationCalls, 1);
assert.equal(optionalRecoveryStillFails.valid, false, 'failed final validation after optional recovery remains fail-closed');
assert.equal(optionalRecoveryStillFails.recoveryDiagnostics.outcome, 'recovery-revalidation-failed');
assert.deepEqual(optionalRecoveryStillFails.recoveryDiagnostics.initialValidatorCategories, ['entity-context-quote']);
assert.deepEqual(optionalRecoveryStillFails.recoveryDiagnostics.finalValidatorCategories, ['confidenceBand', 'other']);
const recoveryFailureLog = [];
const originalRecoveryFailureStderr = process.stderr.write;
process.stderr.write = function captureRecoveryFailureStderr(chunk, ...args) {
    recoveryFailureLog.push(String(chunk));
    return true;
};
try {
    logRejectedOutput('request-test', 'annotations', {
        diagnosticCode: 'OUTPUT_VALIDATION_FAILED',
        validationIssues: [
            'tiles.merge.recovery-revalidation-failed',
            'response.results.0.segments.0.confidenceBand',
            `response.results.0.${mergeFailureText}`,
            'authorization.hidden-test-value',
            'providerBodyPayload',
        ],
        recoveryDiagnostics: optionalRecoveryStillFails.recoveryDiagnostics,
    });
} finally {
    process.stderr.write = originalRecoveryFailureStderr;
}
const recoveryFailureEvent = JSON.parse(recoveryFailureLog[0]);
assert.deepEqual(recoveryFailureEvent.validationCategories, ['other', 'confidenceBand']);
assert.equal(recoveryFailureEvent.recoveryDiagnostics.outcome, 'recovery-revalidation-failed');
assert.deepEqual(recoveryFailureEvent.recoveryDiagnostics.initialValidatorCategories, ['entity-context-quote']);
assert.deepEqual(recoveryFailureEvent.recoveryDiagnostics.finalValidatorCategories, ['confidenceBand', 'other']);
for (const forbidden of [mergeFailureText, 'hidden-test-value', 'providerBodyPayload', 'authorization']) {
    assert.equal(recoveryFailureLog.join('').includes(forbidden), false, `recovery failure log must not leak ${forbidden}`);
}
const surfaceSpan = semanticSpan('Mira');
const markerSemanticCandidate = {
    schemaVersion: PRESENTATION_TILE_CANDIDATE_VERSION,
    results: [{
        segments: [
            { startMarker: semanticTokens.get(0), kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceMarkers: [{ ...semanticSpan('Mira（female）加入队伍。'), purpose: 'classification' }] },
            { startMarker: semanticTokens.get(speakerBoundary), kind: 'dialogue', speakerMentionRef: 'm0', speakerSource: 'quoted-attribution', confidenceBand: 'high', evidenceMarkers: [
                { ...semanticSpan('Mira（female）加入队伍。Mira说：'), purpose: 'speaker' },
                { ...semanticSpan('“好。”'), purpose: 'classification' },
            ] },
        ],
        entities: [{
            mentionRef: 'm0', surfaceStartMarker: surfaceSpan.startMarker, surfaceEndMarker: surfaceSpan.endMarker,
            kind: 'person', attributeEvidence: [{ category: 'gender', value: 'female', evidenceStartMarker: semanticSpan('female').startMarker, evidenceEndMarker: semanticSpan('female').endMarker }],
        }],
        identityLinkCandidates: [{ fromMentionRef: 'm0', toResolverEntityRef: 'published:mira', relation: 'same-entity', evidenceMarkers: [surfaceSpan], confidenceBand: 'high' }],
        stateClaims: [{ claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'], rosterSnapshotCompleteness: 'complete', evidenceMarkers: [semanticSpan('Mira（female）加入队伍。')], confidenceBand: 'high' }],
    }],
};
const markerSemanticResult = await materializePresentationAnalyzerCandidate(markerSemanticCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker });
assert.equal(markerSemanticResult.valid, true, `paired markers materialize all tile evidence fields (${JSON.stringify(markerSemanticResult.errors || [])})`);
assert.deepEqual(markerSemanticResult.response.results[0].entities[0].surfaceSpan, { start: 0, end: 4 });
assert.deepEqual(markerSemanticResult.response.results[0].entities[0].attributeEvidence[0].span, { start: 5, end: 11 });
assert.deepEqual(markerSemanticResult.response.results[0].identityLinkCandidates[0].evidenceSpans[0], { start: 0, end: 4, purpose: 'coreference' });
assert.deepEqual(markerSemanticResult.response.results[0].stateClaims[0].evidenceSpans[0], { start: 0, end: 17, purpose: 'state' });
assert.equal(containsAnyRequestLocalBoundaryMarker(markerSemanticResult.response, [semanticMarkers.offsetsByMarker]), false,
    'marker protocol never leaks into public annotation v1');

const missingClassificationEvidenceCandidate = structuredClone(markerSemanticCandidate);
missingClassificationEvidenceCandidate.results[0].segments[0].evidenceMarkers = [];
const missingClassificationEvidence = await materializePresentationAnalyzerCandidate(
    missingClassificationEvidenceCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker },
);
assert.equal(missingClassificationEvidence.valid, false,
    'a segment with no classification evidence is rejected before Annotation v1 can render a guessed kind');
assert.ok(missingClassificationEvidence.errors.includes('candidate.results.0.segments.0.classification-evidence'));

const optionalClaimCandidate = structuredClone(markerSemanticCandidate);
optionalClaimCandidate.results[0].entities[0].attributeEvidence[0].value = 'masculine';
optionalClaimCandidate.results[0].identityLinkCandidates[0].evidenceMarkers = [semanticSpan('好。')];
optionalClaimCandidate.results[0].stateClaims[0].evidenceMarkers = [semanticSpan('好。')];
const recoveredOptionalClaims = await materializePresentationAnalyzerCandidate(optionalClaimCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker });
assert.equal(recoveredOptionalClaims.valid, true, 'invalid optional claims are dropped without discarding a structurally valid tile annotation');
assert.deepEqual(recoveredOptionalClaims.response.results[0].segments.map(({ start, end, kind, speakerMentionRef }) => ({ start, end, kind, speakerMentionRef })),
    markerSemanticResult.response.results[0].segments.map(({ start, end, kind, speakerMentionRef }) => ({ start, end, kind, speakerMentionRef })),
    'optional attribute, identity and state failures do not change valid segment ranges or labels');
assert.deepEqual(recoveredOptionalClaims.response.results[0].segments.map(({ textHash }) => textHash),
    markerSemanticResult.response.results[0].segments.map(({ textHash }) => textHash),
    'optional claim recovery preserves segment hashes');
assert.equal(recoveredOptionalClaims.response.results[0].entities[0].attributeEvidence.length, 0);
assert.equal(recoveredOptionalClaims.response.results[0].identityLinkCandidates.length, 0);
assert.equal(recoveredOptionalClaims.response.results[0].stateClaims.length, 0);
assert.equal(recoveredOptionalClaims.recoveryDiagnostics.droppedAttributes, 1);
assert.equal(recoveredOptionalClaims.recoveryDiagnostics.droppedIdentityLinks, 1);
assert.equal(recoveredOptionalClaims.recoveryDiagnostics.droppedStateClaims, 1);

const unsupportedSpeakerCandidate = structuredClone(markerSemanticCandidate);
unsupportedSpeakerCandidate.results[0].segments[1].evidenceMarkers = [{ ...semanticSpan('Mira说：'), purpose: 'speaker' }];
unsupportedSpeakerCandidate.results[0].segments[1].evidenceMarkers.push({ ...semanticSpan('“好。”'), purpose: 'classification' });
const recoveredUnsupportedSpeaker = await materializePresentationAnalyzerCandidate(unsupportedSpeakerCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker });
assert.equal(recoveredUnsupportedSpeaker.valid, true, 'unsupported speaker evidence degrades safely while preserving the dialogue span');
const expectedUnsupportedSegments = markerSemanticResult.response.results[0].segments.map((segment) => ({
    start: segment.start, end: segment.end, kind: segment.kind,
    speakerMentionRef: segment.speakerMentionRef, speakerSource: segment.speakerSource, textHash: segment.textHash,
}));
expectedUnsupportedSegments[1].kind = 'unattributed-dialogue';
expectedUnsupportedSegments[1].speakerMentionRef = null;
expectedUnsupportedSegments[1].speakerSource = 'none';
assert.deepEqual(recoveredUnsupportedSpeaker.response.results[0].segments.map(({ start, end, kind, speakerMentionRef, speakerSource, textHash }) => ({ start, end, kind, speakerMentionRef, speakerSource, textHash })),
    expectedUnsupportedSegments, 'speaker recovery changes only the unsupported attribution and retains source offsets/hash');
assert.equal(recoveredUnsupportedSpeaker.response.results[0].segments[1].evidenceSpans.some(({ purpose }) => purpose === 'speaker'), false);
assert.deepEqual(recoveredUnsupportedSpeaker.response.results[0].segments[1].evidenceSpans.map(({ purpose }) => purpose), ['classification'],
    'speaker downgrade preserves the independently validated classification evidence');
assert.equal(recoveredUnsupportedSpeaker.recoveryDiagnostics.downgradedSpeakers, 1);

const invalidNarrationClassificationCandidate = structuredClone(markerSemanticCandidate);
invalidNarrationClassificationCandidate.results[0].segments[0].evidenceMarkers = [{
    ...semanticSpan('Mira说：'), purpose: 'classification',
}];
const invalidNarrationClassification = await materializePresentationAnalyzerCandidate(
    invalidNarrationClassificationCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker },
);
assert.equal(invalidNarrationClassification.valid, false,
    'invalid non-speaker evidence remains fail-closed and cannot preserve a narration classification');
assert.equal(Object.hasOwn(invalidNarrationClassification, 'recoveryDiagnostics'), false,
    'local recovery only removes broken speaker attribution evidence');

assert.equal(JSON.stringify(recoveredOptionalClaims.recoveryDiagnostics).includes(markerSemanticText), false,
    'recovery diagnostics never include source text');
assert.equal(JSON.stringify(recoveredOptionalClaims.recoveryDiagnostics).includes('~'), false,
    'recovery diagnostics never include internal marker tokens');

const unrecognizedSemanticFailureCandidate = structuredClone(markerSemanticCandidate);
unrecognizedSemanticFailureCandidate.results[0].segments[0].kind = 'unsupported-kind';
const unrecognizedSemanticFailure = await materializePresentationAnalyzerCandidate(unrecognizedSemanticFailureCandidate, markerSemanticRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker });
assert.equal(unrecognizedSemanticFailure.valid, false, 'unknown semantic validation failures remain fail-closed');
assert.equal(Object.hasOwn(unrecognizedSemanticFailure, 'recoveryDiagnostics'), false,
    'local recovery does not claim success for unknown validation paths');

const markerCollisionRef = semanticTokens.get(0);
const markerCollisionRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'tile-marker-collision' },
    messages: markerSemanticRequest.messages,
    knownEntities: [{ resolverEntityRef: markerCollisionRef, visibleNames: ['Mira'], evidenceDigest: await createVisibleMessageHash(`${markerCollisionRef}|Mira`), attributes: [] }],
});
const markerCollisionCandidate = structuredClone(markerSemanticCandidate);
markerCollisionCandidate.results[0].identityLinkCandidates[0].toResolverEntityRef = markerCollisionRef;
const markerCollision = await materializePresentationAnalyzerCandidate(markerCollisionCandidate, markerCollisionRequest,
    { boundaryMarkerMap: semanticMarkers.offsetsByMarker });
assert.equal(markerCollision.valid, false, 'a resolver reference colliding with a current marker is rejected before public output');
assert.ok(markerCollision.errors.includes('candidate.output.marker-leak'));
semanticMarkers.dispose();

const overlongMarkerText = 'x'.repeat(1201);
const overlongMarkerRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'tile-marker-length-limit' },
    messages: [{ sourceMessageIndex: 20, sourceMessageHash: await createVisibleMessageHash(overlongMarkerText), authorLabel: '', visibleText: overlongMarkerText }],
    knownEntities: [],
});
const overlongMarkers = createRequestLocalBoundaryMarkers(overlongMarkerText);
const overlongEvidenceCandidate = {
    schemaVersion: PRESENTATION_TILE_CANDIDATE_VERSION,
    results: [{
        segments: [{ startMarker: overlongMarkers.markersByOffset.get(0), kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceMarkers: [{ startMarker: overlongMarkers.markersByOffset.get(0), endMarker: overlongMarkers.markersByOffset.get(1201), purpose: 'classification' }] }],
        entities: [], identityLinkCandidates: [], stateClaims: [],
    }],
};
const overlongEvidence = await materializePresentationAnalyzerCandidate(overlongEvidenceCandidate, overlongMarkerRequest,
    { boundaryMarkerMap: overlongMarkers.offsetsByMarker });
assert.equal(overlongEvidence.valid, false, 'evidence spans above their code-point cap fail closed');
assert.ok(overlongEvidence.errors.includes('candidate.results.0.segments.0.evidence.0.marker-length'));
const oversizedEntityCandidate = structuredClone(overlongEvidenceCandidate);
oversizedEntityCandidate.results[0].segments[0].evidenceMarkers = [];
oversizedEntityCandidate.results[0].entities = [{
    mentionRef: 'm0', surfaceStartMarker: overlongMarkers.markersByOffset.get(0), surfaceEndMarker: overlongMarkers.markersByOffset.get(121),
    kind: 'person', attributeEvidence: [],
}];
const oversizedEntity = await materializePresentationAnalyzerCandidate(oversizedEntityCandidate, overlongMarkerRequest,
    { boundaryMarkerMap: overlongMarkers.offsetsByMarker });
assert.equal(oversizedEntity.valid, false, 'entity surface spans above their stricter code-point cap fail closed');
assert.ok(oversizedEntity.errors.includes('candidate.results.0.entities.0.surface.marker-length'));
overlongMarkers.dispose();
markerSet.dispose();

const semaphore = createProviderSemaphore(1);
const heldPermit = await semaphore.acquire();
const queuedAbort = new AbortController();
const queuedPermit = semaphore.acquire(queuedAbort.signal);
assert.deepEqual(semaphore.snapshot(), { active: 1, queued: 1, capacity: 1 });
queuedAbort.abort();
await assert.rejects(queuedPermit, { name: 'AbortError' }, 'aborted semaphore waiters leave the FIFO queue');
assert.deepEqual(semaphore.snapshot(), { active: 1, queued: 0, capacity: 1 });
heldPermit();
heldPermit();
const afterDoubleRelease = await semaphore.acquire();
assert.deepEqual(semaphore.snapshot(), { active: 1, queued: 0, capacity: 1 }, 'release is idempotent and cannot over-admit');
afterDoubleRelease();
assert.deepEqual(semaphore.snapshot(), { active: 0, queued: 0, capacity: 1 });

const denseAnchorText = 'A'.repeat(1500);
const denseAnchorRequest = await createPresentationAnnotationRequest({
    scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'dense-boundaries' },
    messages: [{ sourceMessageIndex: 10, sourceMessageHash: await createVisibleMessageHash(denseAnchorText), authorLabel: '', visibleText: denseAnchorText }],
    knownEntities: [],
});
const denseAnchorCandidate = structuredClone(repeatedBoundaryCandidate);
denseAnchorCandidate.results[0].segments = [
    { startAnchor: { beforeText: '', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: 'A', purpose: 'classification' }] },
    { startAnchor: { beforeText: 'A', afterText: 'A' }, kind: 'narration', speakerMentionRef: null, speakerSource: 'none', confidenceBand: 'high', evidenceQuotes: [{ text: 'A', purpose: 'classification' }] },
];
assert.equal((await materializePresentationAnalyzerCandidate(denseAnchorCandidate, denseAnchorRequest)).valid, false,
    'an extremely repetitive anchor fails closed after a bounded linear scan');
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties, 'sourceMessageIndex'), false);
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties, 'start'), false);
assert.equal(Object.hasOwn(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.items.properties.segments.items.properties, 'textHash'), false);

const lowDensityLongText = `序幕${'叙'.repeat(1800)}终章`;
assert.equal(isDenseLongPresentationMessage({ visibleText: lowDensityLongText }), false,
    'long but low-delimiter text preserves the existing single-request path');
const denseShortCodePoints = Array.from('😀' + '字'.repeat(479) + '“”'.repeat(10));
const denseShortText = denseShortCodePoints.join('');
assert.equal(denseShortCodePoints.length, 500, 'the high-density regression sample is exactly 500 Unicode code points');
assert.equal(isDenseLongPresentationMessage({ visibleText: denseShortText }), true,
    'a 500-code-point high-delimiter message enters the bounded internal path');
const denseShortPlan = createPresentationCoreTiles(denseShortText);
assert.equal(denseShortPlan.valid, true);
assert.equal(denseShortPlan.tiles.length, 1, 'a high-density 500-code-point sample remains within the 600-code-point core limit');
assert.equal(denseShortPlan.tiles[0].coreStart, 0);
assert.equal(denseShortPlan.tiles.at(-1).coreEnd, denseShortCodePoints.length);
const densePartitionCodePoints = Array.from('😀' + '字'.repeat(859) + '“”'.repeat(20));
const densePartitionPlan = createPresentationCoreTiles(densePartitionCodePoints.join(''));
assert.equal(densePartitionCodePoints.length, 900);
assert.equal(densePartitionPlan.valid, true);
assert.ok(densePartitionPlan.tiles.length >= 2, 'a high-density message exceeding the 600-code-point core limit is split');
assert.equal(densePartitionPlan.tiles[0].coreStart, 0);
assert.equal(densePartitionPlan.tiles.at(-1).coreEnd, densePartitionCodePoints.length);
assert.ok(densePartitionPlan.tiles.every((tile, index) => index === 0 || densePartitionPlan.tiles[index - 1].coreEnd === tile.coreStart),
    'core tiles form a gapless and non-overlapping code-point partition');
assert.ok(densePartitionPlan.tiles.every((tile) => tile.coreEnd - tile.coreStart <= 600
    && tile.viewEnd - tile.viewStart <= 600 + (2 * 48)), 'each model view is bounded by one core plus its limited lookaround');
const overBudgetText = Array.from({ length: 750 }, () => `“${'台'.repeat(19)}`).join('');
const overBudgetPlan = createPresentationCoreTiles(overBudgetText);
assert.equal(overBudgetPlan.valid, false, 'an input that would exceed the tile ceiling fails closed before provider calls');
const overProviderLimitText = Array.from({ length: 3_000 }, (_, index) => index % 40 === 0 ? '“' : 'a').join('');
const overProviderLimitPlan = createPresentationCoreTiles(overProviderLimitText);
assert.equal(overProviderLimitPlan.valid, true);
assert.equal(overProviderLimitPlan.tiles.length, 5, 'the cost-bounded sample has a stable five-view plan');
assert.ok(overBudgetPlan.errors.includes('tiles.count'), 'the fixed upper tile count is enforced independently of source length');

const originalFetch = globalThis.fetch;
let providerUrl;
let providerBody;
const emptyCandidate = { schemaVersion: PRESENTATION_MODEL_CANDIDATE_VERSION, results: [] };
globalThis.fetch = async (url, init) => {
    providerUrl = new URL(url).pathname;
    providerBody = JSON.parse(init.body);
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['x-api-key'], 'hidden-test-value');
    return anthropicStructuredOutputResponseFromRequest(init, emptyCandidate);
};
try {
    const config = loadConfig({
        GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'anthropic',
        GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://aiself.vip',
        GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
        GALGAME_PRESENTATION_ANALYZER_MODEL: 'claude-sonnet-4-6',
    });
    assert.equal(config.model, 'claude-sonnet-4-6');
    assert.equal(config.hostname, 'aiself.vip');
    const parsed = await invokeProvider(
        config, { messages: [] }, undefined, null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result',
    );
    assert.equal(providerUrl, '/v1/messages');
    assert.equal(providerBody.temperature, 0, 'Claude semantic analysis uses deterministic sampling for schema-constrained annotation');
    assert.equal(providerBody.output_config.format.type, 'json_schema');
    assert.deepEqual(Object.keys(providerBody.output_config.format).sort(), ['schema', 'type'],
        'Anthropic output_config.format uses the current documented type+schema shape');
    assert.deepEqual(providerBody.output_config.format.schema,
        transformAnthropicOutputSchema(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA));
    assert.equal(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA.properties.results.maxItems, 8,
        'the canonical local schema retains its original application bounds');
    assert.equal(providerBody.output_config.format.schema.properties.results.maxItems, undefined,
        'unsupported maxItems is removed only from the provider grammar');
    assert.match(providerBody.output_config.format.schema.properties.results.description, /maxItems=8/u,
        'removed provider constraints remain visible as schema guidance');
    assert.equal(providerBody.output_config.format.schema.properties.results.items.properties.segments.items.properties.evidenceQuotes.minItems, 1,
        'Anthropic-supported minItems=1 constraints remain in the provider grammar');
    assert.equal(providerBody.output_config.format.schema.properties.results.items.properties.segments.items.properties.speakerMentionRef.anyOf[0].pattern,
        '^m([0-9]|[1-5][0-9]|6[0-3])$',
        'provider regex is transformed from non-capturing to the documented group form');
    assert.equal(Object.hasOwn(providerBody, 'tools'), false,
        'the production Claude adapter uses the structured-output path validated for this gateway');
    assert.match(providerBody.system, /identityLinkCandidates/u);
    assert.match(providerBody.system, /additionalProperties/u);
    assert.match(providerBody.system, /galgame\.presentation-analyzer-candidate\.v1/u);
    assert.match(providerBody.system, /service attaches source-message indexes and message hashes/u);
    assert.match(providerBody.system, /quotation marks alone do not prove a speaker/u);
    assert.match(providerBody.system, /unattributed-dialogue rather than guessing/u);
    assert.equal(parsed.schemaVersion, PRESENTATION_MODEL_CANDIDATE_VERSION);

    const originalQuotedSource = {
        contextMessages: [{ visibleText: '前情：“别出声。”' }],
        messages: [{
            visibleText: 'Mira说：“快走！”',
            ownedUnits: [{
                text: '“快走！”',
                classificationEvidenceCells: [{ id: 'cell-0000001', text: 'Mira说：“快走' }],
            }],
            speakerEvidenceCells: [{ id: 'cell-0000002', text: 'Mira说：“快走！”' }],
        }],
        knownEntities: [{ visibleNames: ['“Mira”'] }],
    };
    const normalizedQuotedSource = normalizeAnthropicSourceQuoteGlyphs(originalQuotedSource);
    assert.equal(normalizedQuotedSource.messages[0].visibleText, 'Mira说："快走！"');
    assert.equal(normalizedQuotedSource.messages[0].ownedUnits[0].text, '"快走！"');
    assert.equal(normalizedQuotedSource.messages[0].ownedUnits[0].classificationEvidenceCells[0].text, 'Mira说："快走');
    assert.equal(normalizedQuotedSource.contextMessages[0].visibleText, '前情："别出声。"');
    assert.deepEqual(normalizedQuotedSource.knownEntities[0].visibleNames, ['“Mira”'],
        'quote normalization is scoped to source text, not character names or identity data');
    assert.equal(originalQuotedSource.messages[0].visibleText, 'Mira说：“快走！”',
        'the canonical source request remains unchanged');
    await invokeProvider(config, originalQuotedSource, '只分析输入', null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result', null, false, { maxAttempts: 1 });
    const normalizedProviderInput = JSON.parse(providerBody.messages[0].content);
    assert.equal(normalizedProviderInput.messages[0].visibleText, 'Mira说："快走！"',
        'the Anthropic adapter sends quote-normalized provider text while retaining the original source in the caller');
    assert.equal(normalizedProviderInput.messages[0].ownedUnits[0].classificationEvidenceCells[0].text, 'Mira说："快走');

    const unitCandidate = {
        schemaVersion: PRESENTATION_UNIT_CANDIDATE_VERSION,
        results: [{ unitClassifications: [], entities: [], identityLinkCandidates: [], stateClaims: [] }],
    };
    globalThis.fetch = async (_url, init) => anthropicStructuredOutputResponseFromRequest(init, unitCandidate);
    const structuredUnitCandidate = await invokeProvider(
        config, { messages: [] }, undefined, null,
        PRESENTATION_UNIT_CANDIDATE_JSON_SCHEMA, 'presentation_unit_candidate',
    );
    assert.ok(Array.isArray(structuredUnitCandidate.results),
        'Anthropic structured output preserves the nested unit result array');
    assert.equal(structuredUnitCandidate.results[0].unitClassifications.length, 0);

    let malformedStructuredOutput;
    globalThis.fetch = async () => new Response(JSON.stringify({
        stop_reason: 'end_turn', content: [{ type: 'text', text: 'not valid JSON' }],
    }), { status: 200 });
    try {
        await invokeProvider(
            config, { messages: [] }, undefined, null,
            PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result', null, false, { maxAttempts: 1 },
        );
    } catch (error) { malformedStructuredOutput = error; }
    assert.equal(malformedStructuredOutput?.code, 'INVALID_MODEL_OUTPUT', 'malformed schema-bound output is rejected fail-closed');
    assert.ok(malformedStructuredOutput?.attemptTrace?.[0]?.modes.includes('anthropic_json_schema'),
        'safe diagnostics record the fixed structured-output mode without provider output');

    const anthropicFallbackBodies = [];
    const anthropicSchemaJson = JSON.stringify(PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA);
    let anthropicFallbackValidationCalls = 0;
    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        anthropicFallbackBodies.push(body);
        const text = anthropicFallbackBodies.length === 1 ? '{"x":1，"y":2}' : JSON.stringify(emptyCandidate);
        return new Response(JSON.stringify({
            stop_reason: 'end_turn', content: [{ type: 'text', text }],
        }), { status: 200 });
    };
    const recoveredAnthropicStructuredOutput = await invokeProvider(
        config, { messages: [] }, `只分析输入\nRequired candidate JSON Schema: ${anthropicSchemaJson}`, null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result', (candidate) => {
            anthropicFallbackValidationCalls += 1;
            return candidate?.schemaVersion === PRESENTATION_MODEL_CANDIDATE_VERSION
                ? { valid: true, errors: [] }
                : { valid: false, errors: ['candidate.schema-version'] };
        }, false, { maxAttempts: 2 },
    );
    assert.equal(recoveredAnthropicStructuredOutput.schemaVersion, PRESENTATION_MODEL_CANDIDATE_VERSION);
    assert.equal(anthropicFallbackValidationCalls, 1,
        'the recovered prompt-only candidate still passes through the local candidate validator');
    assert.equal(anthropicFallbackBodies.length, 2, 'malformed Anthropic structured output receives one bounded prompt-only retry');
    assert.equal(anthropicFallbackBodies[0].output_config.format.type, 'json_schema');
    assert.equal(Object.hasOwn(anthropicFallbackBodies[1], 'output_config'), false,
        'the retry switches away from the structured-output mode that produced malformed JSON');
    assert.equal(anthropicFallbackBodies[1].system.split(anthropicSchemaJson).length - 1, 1,
        'the bounded retry preserves the production prompt schema without duplicating it');
    assert.match(anthropicFallbackBodies[1].system, /previous structured response was not one valid complete JSON object/u);
    assert.match(anthropicFallbackBodies[1].system, /ASCII comma character U\+002C/u,
        'the single prompt-only fallback gives a safe, stage-specific JSON correction');

    let malformedAnthropicFallbackAttempts = 0;
    let malformedAnthropicFallbackError;
    globalThis.fetch = async () => {
        malformedAnthropicFallbackAttempts += 1;
        return new Response(JSON.stringify({
            stop_reason: 'end_turn', content: [{ type: 'text', text: '{"a":1，"b":2}' }],
        }), { status: 200 });
    };
    try {
        await invokeProvider(config, { messages: [] }, '只分析输入', null,
            PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result');
    } catch (error) { malformedAnthropicFallbackError = error; }
    assert.equal(malformedAnthropicFallbackError?.code, 'INVALID_MODEL_OUTPUT');
    assert.equal(malformedAnthropicFallbackAttempts, 2,
        'a malformed prompt-only fallback fails closed without a third identical-format request');
    assert.deepEqual(malformedAnthropicFallbackError?.attemptTrace?.map((row) => row.modes[0]),
        ['anthropic_json_schema', 'anthropic']);
    assert.equal(malformedAnthropicFallbackError?.attemptTrace?.[0]?.outputDiagnostics?.jsonErrorStage, 'expected-comma');
    assert.equal(malformedAnthropicFallbackError?.attemptTrace?.[0]?.outputDiagnostics?.jsonErrorTokenClass, 'fullwidth-comma',
        'safe parse diagnostics distinguish full-width punctuation without preserving its text');

    let invalidFallbackValidationCalls = 0;
    let invalidFallbackProviderCalls = 0;
    let invalidFallbackError;
    globalThis.fetch = async (_url, init) => {
        invalidFallbackProviderCalls += 1;
        const body = JSON.parse(init.body);
        const text = invalidFallbackProviderCalls === 1
            ? 'not valid JSON' : JSON.stringify({ schemaVersion: 'wrong', results: [] });
        assert.equal(invalidFallbackProviderCalls === 1, Boolean(body.output_config),
            'only the first invalid-JSON attempt uses structured output');
        return new Response(JSON.stringify({
            stop_reason: 'end_turn', content: [{ type: 'text', text }],
        }), { status: 200 });
    };
    try {
        await invokeProvider(config, { messages: [] }, '只分析输入', null,
            PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA, 'presentation_result', () => {
                invalidFallbackValidationCalls += 1;
                return { valid: false, errors: ['candidate.schema-version'] };
            });
    } catch (error) { invalidFallbackError = error; }
    assert.equal(invalidFallbackError?.code, 'INVALID_MODEL_OUTPUT',
        'parseable prompt-only output that fails local validation remains rejected');
    assert.equal(invalidFallbackProviderCalls, 3,
        'semantic validator correction remains bounded after the single malformed-JSON format fallback');
    assert.equal(invalidFallbackValidationCalls, 2,
        'each parseable fallback candidate runs the local validator before any result can be returned');

    let attempts = 0;
    globalThis.fetch = async () => {
        attempts += 1;
        if (attempts === 1) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(emptyCandidate) }] }), { status: 200 });
    };
    await invokeProvider(config, { messages: [] });
    assert.equal(attempts, 2, 'transient provider failures receive exactly one retry');

    let serverError400Attempts = 0;
    globalThis.fetch = async () => {
        serverError400Attempts += 1;
        if (serverError400Attempts === 1) {
            return new Response(JSON.stringify({ error: {
                type: 'server_error', message: 'private upstream diagnostic must not be returned or logged',
            } }), { status: 400 });
        }
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(emptyCandidate) }] }), { status: 200 });
    };
    const recoveredServerError400 = await invokeProvider(config, { messages: [] });
    assert.equal(recoveredServerError400.schemaVersion, PRESENTATION_MODEL_CANDIDATE_VERSION);
    assert.equal(serverError400Attempts, 2, 'an explicit upstream server_error wrapped in HTTP 400 receives one bounded retry');

    const compatibleConfigRejected = loadConfig({
        GALGAME_PRESENTATION_ANALYZER_PROVIDER: 'openai-compatible',
        GALGAME_PRESENTATION_ANALYZER_BASE_URL: 'https://aiself.vip',
        GALGAME_PRESENTATION_ANALYZER_API_KEY: 'hidden-test-value',
        GALGAME_PRESENTATION_ANALYZER_MODEL: 'claude-sonnet-4-6',
    });
    assert.equal(compatibleConfigRejected, null, 'OpenAI-compatible mode is not reachable through service configuration');
    const compatibleConfig = {
        provider: 'openai-compatible',
        baseUrl: 'https://provider.example',
        apiKey: 'hidden-test-value',
        model: 'model-test',
        hostname: 'provider.example',
    };
    let boundedOutputCap = null;
    globalThis.fetch = async (_url, init) => {
        boundedOutputCap = JSON.parse(init.body).max_tokens;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    await invokeProvider(compatibleConfig, { messages: [] }, '只分析输入', null, null, 'test', null, true, { initialMaxOutputTokens: 4096 });
    assert.equal(boundedOutputCap, 4096, 'tiled annotation calls start with enough bounded completion budget for dense segment output');

    const originalDeadlineSetTimeout = globalThis.setTimeout;
    let observedProviderDeadlineMs = null;
    globalThis.setTimeout = (callback, delay, ...args) => {
        if (delay > 60_000) observedProviderDeadlineMs = delay;
        return originalDeadlineSetTimeout(callback, delay, ...args);
    };
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    try {
        await invokeProvider(
            compatibleConfig,
            { messages: [] },
            '只分析输入',
            null,
            null,
            'test',
            null,
            true,
            { deadlineAt: Date.now() + 80_000, maxDurationMs: 120_000, maxAttempts: 1 },
        );
    } finally {
        globalThis.setTimeout = originalDeadlineSetTimeout;
    }
    assert.ok(observedProviderDeadlineMs > 60_000 && observedProviderDeadlineMs <= 80_000,
        'tiled provider attempts honor the shared request deadline beyond the ordinary 60-second call limit');

    let oversizedErrorBodyCanceled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(70_000));
        },
        cancel() {
            oversizedErrorBodyCanceled = true;
        },
    }), { status: 400, headers: { 'content-type': 'text/plain' } });
    await assert.rejects(
        invokeProvider(compatibleConfig, { messages: [] }, '只分析输入', null, null, 'test', null, true, { maxAttempts: 1 }),
        (error) => error.status === 400 && error.providerErrorCategory === 'payload-too-large',
        'a single oversized provider error chunk is rejected before buffering and classified without its body',
    );
    assert.equal(oversizedErrorBodyCanceled, true, 'oversized provider response streams are canceled immediately');

    const outputTokenCaps = [];
    let truncatedRecoveryAttempt = 0;
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        outputTokenCaps.push(requestBody.max_tokens);
        truncatedRecoveryAttempt += 1;
        return new Response(JSON.stringify({
            choices: [{ message: { content: truncatedRecoveryAttempt === 1 ? '{' : JSON.stringify({ recovered: true }) }, finish_reason: truncatedRecoveryAttempt === 1 ? 'length' : 'stop' }],
            usage: { completion_tokens: truncatedRecoveryAttempt === 1 ? 4096 : 4 },
        }), { status: 200 });
    };
    const truncationRecovered = await invokeProvider(compatibleConfig, { pageText: '场景文本' }, '只分析输入', null, null, 'test', null, true);
    assert.deepEqual(truncationRecovered, { recovered: true });
    assert.deepEqual(outputTokenCaps, [4096, 8192],
        'a provider-confirmed truncated JSON response gets one bounded retry with a larger output cap');

    const providerFormats = [];
    let providerTemperature;
    let providerThinking;
    let providerSystemPrompt;
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        providerFormats.push(requestBody.response_format);
        providerTemperature = requestBody.temperature;
        providerThinking = requestBody.thinking;
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
    assert.equal(providerThinking, undefined, 'scene continuity keeps its established thinking configuration');

    providerFormats.length = 0;
    globalThis.fetch = async (_url, init) => {
        const requestBody = JSON.parse(init.body);
        providerFormats.push(requestBody.response_format);
        providerThinking = requestBody.thinking;
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
        null,
        true,
    );
    assert.deepEqual(providerFormats, [{ type: 'json_object' }],
        'OpenAI-compatible identity annotation starts in JSON mode after production evidence showed schema-mode output was unreliable');
    assert.match(providerSystemPrompt, /Required candidate JSON Schema:/u,
        'JSON mode carries the exact candidate schema in the system prompt');
    assert.deepEqual(providerThinking, { type: 'disabled' },
        'presentation annotation explicitly disables the provider model’s default deep-thinking mode');

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

    let duplicateKeyAttempts = 0;
    let duplicateKeyRetryPrompt = '';
    globalThis.fetch = async (_url, init) => {
        duplicateKeyAttempts += 1;
        duplicateKeyRetryPrompt = JSON.parse(init.body).messages[0].content;
        const content = duplicateKeyAttempts === 1 ? '{"value":1,"value":2}' : JSON.stringify({ recovered: true });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    };
    const duplicateKeyRecovered = await invokeProvider(compatibleConfig, { pageText: '场景文本' }, '只分析输入');
    assert.deepEqual(duplicateKeyRecovered, { recovered: true });
    assert.equal(duplicateKeyAttempts, 2);
    assert.match(duplicateKeyRetryPrompt, /repeated a JSON property name/u,
        'duplicate JSON keys receive a targeted retry instruction without logging model output');

    const malformedJsonDiagnosticSample = '{"privateDiagnosticSentinel" 1}';
    globalThis.fetch = async () => new Response(JSON.stringify({
        choices: [{ message: { content: malformedJsonDiagnosticSample }, finish_reason: 'stop' }],
        usage: { completion_tokens: 1 },
    }), { status: 200 });
    await assert.rejects(invokeProvider(compatibleConfig, { pageText: '场景文本' }, '只分析输入',
        null, null, 'test', null, false, { maxAttempts: 1 }), (error) => {
        assert.equal(error.code, 'INVALID_MODEL_OUTPUT');
        assert.equal(error.attemptTrace[0].outputDiagnostics.jsonFailure, 'malformed-structure');
        assert.equal(error.attemptTrace[0].outputDiagnostics.jsonErrorStage, 'expected-colon',
            'safe diagnostics identify the parser expectation without exposing model text');
        assert.equal(error.attemptTrace[0].outputDiagnostics.jsonErrorOffset, malformedJsonDiagnosticSample.indexOf('1'),
            'safe parser diagnostics identify the UTF-16 offset of a malformed token');
        assert.equal(error.attemptTrace[0].outputDiagnostics.jsonErrorTokenClass, 'number',
            'safe parser diagnostics expose only the token class, never the character text');
        assert.equal(error.attemptTrace[0].outputDiagnostics.outputTokens, 1);
        assert.equal(JSON.stringify(error.attemptTrace).includes('pageText'), false,
            'provider-output diagnostics do not retain source text or model output');
        assert.equal(JSON.stringify(error.attemptTrace).includes('场景文本'), false,
            'provider-output diagnostics do not retain the actual synthetic source text');
        assert.equal(JSON.stringify(error.attemptTrace).includes('privateDiagnosticSentinel'), false,
            'safe parser diagnostics never retain a model-controlled property name');
        return true;
    });

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
        async () => ({ valid: ++validationAttempts === 2, errors: ['candidate.results.0.segments.boundaries', 'candidate.results.0.entities.0.quote'] }),
        true,
    );
    assert.deepEqual(validatedResult, { candidate: true });
    assert.equal(validationAttempts, 2, 'semantic validation failure triggers one bounded regeneration');
    assert.match(validationRetryPrompt, /candidate\.results\.0\.segments\.boundaries/u, 'safe validator paths are passed to the bounded repair prompt');
    assert.match(validationRetryPrompt, /complete ordered segment-boundary list is ambiguous/u,
        'boundary validation failures get a generic repair instruction to disambiguate source anchors');
    assert.match(validationRetryPrompt, /entity context quote is absent or ambiguous/u,
        'entity quote validation failures get a generic exact-evidence repair instruction');
    assert.match(validationSystemPrompts[0], /Required candidate JSON Schema:/u,
        'the initial JSON-mode request contains its schema instructions');
    assert.match(validationSystemPrompts[1], /Required candidate JSON Schema:/u,
        'the bounded repair retry retains the same schema instructions');
    assert.deepEqual(validationResponseFormats.map((format) => format.type), ['json_object', 'json_object'],
        'invalid candidate output is retried in JSON mode without a slow unsupported schema-mode attempt');

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
        true,
    ), (error) => {
        assert.equal(error.code, 'INVALID_MODEL_OUTPUT');
        assert.deepEqual(error.attemptTrace.map((row) => row.outcome), ['invalid-output', 'invalid-output', 'invalid-output']);
        assert.deepEqual(error.attemptTrace.map((row) => row.modes.at(-1)), ['json_object', 'json_object', 'json_object']);
        assert.deepEqual(error.attemptTrace.map((row) => row.validationCategories), [['count'], ['count'], ['count']],
            'attempt diagnostics retain only fixed validation categories, not candidate-controlled path values');
        assert.equal(error.attemptTrace.some((row) => Object.hasOwn(row, 'text') || Object.hasOwn(row, 'response')), false,
            'attempt diagnostics contain no model text or response payload');
        return true;
    });
    assert.equal(exhaustedCalls, 3, 'strict-to-JSON recovery remains bounded to three provider attempts');

    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"candidate":true}' } }] }), { status: 200 });
    await assert.rejects(invokeProvider(
        compatibleConfig,
        { messages: [] },
        '只分析输入',
        null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
        'presentation_analyzer_candidate',
        async () => ({ valid: false, errors: [
            'candidate.results.0.segments.0.evidence.0.quote',
            'candidate.results.0.entities.0.quote',
            'candidate.results.0.entities.0.attributes.0.quote',
            'candidate.results.0.identityLinks.0.evidence.0.quote',
            'candidate.results.0.stateClaims.0.evidence.0.quote',
        ] }),
        true,
        { maxAttempts: 1 },
    ), (error) => {
        assert.deepEqual(error.attemptTrace[0].validationCategories, [
            'segment-evidence-quote', 'entity-context-quote', 'attribute-evidence-quote', 'identity-evidence-quote', 'state-evidence-quote',
        ], 'safe telemetry distinguishes the exact-quote field class without logging model text');
        assert.match(error.attemptTrace[0].validationCategories.join(','), /^[a-z,-]+$/u);
        return true;
    });

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

    let deadlineAborted = false;
    let deadlineCalls = 0;
    globalThis.fetch = async (_url, init = {}) => {
        deadlineCalls += 1;
        return await new Promise((resolve, reject) => {
            const abort = () => {
                deadlineAborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
            };
            if (init.signal?.aborted) return abort();
            init.signal?.addEventListener('abort', abort, { once: true });
        });
    };
    await assert.rejects(invokeProvider(
        compatibleConfig,
        { messages: [] },
        '只分析输入',
        null,
        PRESENTATION_MODEL_CANDIDATE_JSON_SCHEMA,
        'presentation_analyzer_candidate',
        null,
        true,
        { deadlineAt: Date.now() + 30, maxAttempts: 1 },
    ), (error) => {
        assert.equal(error.code, 'ANALYZER_TIMEOUT', 'an internal absolute deadline is surfaced as a stable timeout');
        assert.deepEqual(error.attemptTrace.map((row) => row.outcome), ['timeout']);
        return true;
    });
    assert.equal(deadlineCalls, 1, 'an internal one-attempt call cannot retry past its shared deadline');
    assert.equal(deadlineAborted, true, 'the internal deadline aborts the active fetch');

    const queuedSemaphore = createProviderSemaphore(1);
    const blockedPermit = await queuedSemaphore.acquire();
    let queuedDeadlineFetches = 0;
    let queuedDeadlineStage = '';
    globalThis.fetch = async () => {
        queuedDeadlineFetches += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    };
    await assert.rejects(invokeProvider(
        compatibleConfig,
        { messages: [] },
        '只分析输入',
        null,
        null,
        'test',
        null,
        true,
        { deadlineAt: Date.now() + 35, maxAttempts: 1, semaphore: queuedSemaphore,
            onProviderStage: (stage) => { queuedDeadlineStage = stage; } },
    ), (error) => {
        assert.equal(error.code, 'ANALYZER_TIMEOUT', 'time spent waiting for the process semaphore counts toward the absolute deadline');
        return true;
    });
    assert.equal(queuedDeadlineFetches, 0, 'a queued call that reaches its deadline never contacts the provider');
    assert.equal(queuedDeadlineStage, 'semaphore-queue', 'a queued timeout retains its bounded provider stage');
    assert.deepEqual(queuedSemaphore.snapshot(), { active: 1, queued: 0, capacity: 1 }, 'deadline removes a waiter without releasing another call\'s permit');
    blockedPermit();
    const afterQueueDeadline = await invokeProvider(
        compatibleConfig, { messages: [] }, '只分析输入', null, null, 'test', null, true,
        { deadlineAt: Date.now() + 2_000, maxAttempts: 1, semaphore: queuedSemaphore },
    );
    assert.deepEqual(afterQueueDeadline, { ok: true }, 'the semaphore remains usable after a timed-out queue waiter');
    assert.equal(queuedDeadlineFetches, 1);

    const diagnosticTimeoutText = 'PRIVATE_TIMEOUT_SENTINEL：Mira说：“等一下。”';
    const diagnosticTimeoutRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'timeout-diagnostics' },
        messages: [{ sourceMessageIndex: 27, sourceMessageHash: await createVisibleMessageHash(diagnosticTimeoutText), authorLabel: '', visibleText: diagnosticTimeoutText }],
        knownEntities: [],
    });
    const diagnosticTimeoutProgress = {
        plannedTiles: 0, completedTiles: 0, actualProviderCalls: 0, maxRefinementDepth: 0,
        lastTileIndex: 0, lastProviderStage: 'planning', lastProviderAttempt: 0,
        stageStartedAt: Date.now(), providerAttempts: [],
    };
    let timedAnnotationFetchStarted = false;
    const originalTimeoutFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init = {}) => {
        timedAnnotationFetchStarted = true;
        return await new Promise((_resolve, reject) => {
            const abort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (init.signal?.aborted) return abort();
            init.signal?.addEventListener('abort', abort, { once: true });
        });
    };
    let annotationTimeoutFailure = null;
    try {
        await assert.rejects(analyzePresentationWithBoundedTiles(config, diagnosticTimeoutRequest, null, {
            deadlineMs: 1_000, progress: diagnosticTimeoutProgress,
        }), (error) => {
            annotationTimeoutFailure = error;
            assert.equal(error.code, 'ANALYZER_TIMEOUT', 'the shared annotation deadline remains a stable timeout');
            return true;
        });
    } finally {
        globalThis.fetch = originalTimeoutFetch;
    }
    assert.equal(timedAnnotationFetchStarted, true, 'the bounded timeout fixture reaches the mocked provider call');
    assert.equal(diagnosticTimeoutProgress.plannedTiles, 1);
    assert.equal(diagnosticTimeoutProgress.actualProviderCalls, 1);
    assert.equal(diagnosticTimeoutProgress.lastProviderStage, 'provider-call');
    assert.equal(diagnosticTimeoutProgress.providerAttempts.at(-1)?.outcome, 'timeout');
    let annotationTimeoutLog = '';
    const originalTimeoutStderrWrite = process.stderr.write;
    process.stderr.write = (chunk) => { annotationTimeoutLog += String(chunk); return true; };
    try {
        logProviderFailure('00000000-0000-4000-8000-000000000027', 'annotations', 'ANALYZER_TIMEOUT', 'provider-invoke',
            1_000, annotationTimeoutFailure, diagnosticTimeoutProgress);
    } finally {
        process.stderr.write = originalTimeoutStderrWrite;
    }
    const annotationTimeoutEvent = JSON.parse(annotationTimeoutLog);
    assert.deepEqual(annotationTimeoutEvent.providerAttempts.map(({ outcome }) => outcome), ['timeout'],
        'the request-wide timeout preserves the bounded provider attempt trace');
    assert.equal(annotationTimeoutEvent.analysisProgress.actualProviderCalls, 1);
    assert.equal(annotationTimeoutEvent.analysisProgress.lastProviderStage, 'provider-call');
    assert.equal(annotationTimeoutEvent.analysisProgress.plannedTiles, 1);
    assert.equal(annotationTimeoutEvent.analysisProgress.maxRefinementDepth, 0);
    assert.equal(annotationTimeoutLog.includes('PRIVATE_TIMEOUT_SENTINEL'), false,
        'timeout progress logs never include submitted story text');
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
    assert.match(payload.analyzerScope, /presentation-annotator\.v26/u);
    assert.match(payload.sceneAnalyzerScope, /scene-continuity-analyzer\.v6:galgame\.scene-continuity-analysis\.v1/u);
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
        if (new URL(url).hostname === 'aiself.vip') {
            const providerBody = JSON.parse(init.body);
            capturedProviderInput = JSON.parse(providerBody.messages[0].content);
            return anthropicStructuredOutputResponseFromRequest(init, makeUnitCandidate(capturedProviderInput));
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
        assert.equal(annotation.results[0].segments.length, 1);
        assert.equal(annotation.results[0].segments[0].kind, 'narration');
        assert.equal(annotation.results[0].segments[0].textHash, await createVisibleMessageHash(exactVisibleText));
        assert.equal(capturedProviderInput.messages[0].visibleText,
            normalizeAnthropicSourceQuoteGlyphs({ visibleText: exactVisibleText }).visibleText,
            'the provider receives normalized quote glyphs while the returned hash remains based on the untouched source');
        assert.equal(capturedProviderInput.messages[0].ownedUnits.length, 1);
        assert.ok(capturedProviderInput.messages[0].ownedUnits[0].classificationEvidenceCells.every((cell) => typeof cell.id === 'string'));
        assert.deepEqual(capturedProviderInput.knownEntities, [{ resolverEntityRef: 'published:mira', visibleNames: ['Mira'], attributes: [] }]);
        assert.equal(/(?:startCodePoint|endCodePoint|startAnchor|boundaryMarkedText)/u.test(JSON.stringify(capturedProviderInput)), false,
            'the active provider request contains no model-authored locator coordinates or quote anchors');
        assert.equal(JSON.stringify(annotation).includes('presentation-analyzer-unit-candidate'), false,
            'the provider candidate DTO does not leak into the stable browser response');
    } finally {
        globalThis.fetch = originalRouteFetch;
    }

    const denseMixedPrefix = 'Mira加入队伍，Mira说：“你好”旁白转身，Rowan拦住她，Rowan说：“等等”随后远处传来回声';
    const denseMixedText = `${denseMixedPrefix}${'远处人群继续移动'.repeat(70)}${'“场景”'.repeat(18)}`;
    const denseMixedRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'unit-refinement' },
        messages: [{ sourceMessageIndex: 14, sourceMessageHash: await createVisibleMessageHash(denseMixedText), authorLabel: '', visibleText: denseMixedText }],
        knownEntities: [{
            resolverEntityRef: 'published:mira', visibleNames: ['Mira'],
            evidenceDigest: await createVisibleMessageHash('published:mira|Mira'), attributes: [],
        }],
    });
    const denseMixedUnitPlan = createPresentationSourceUnits(denseMixedText);
    assert.equal(denseMixedUnitPlan.valid, true);
    assert.ok(denseMixedUnitPlan.units[0].end >= Array.from(denseMixedPrefix).length,
        'the first coarse unit contains multiple dialogue speakers and narration before refinement');
    assert.equal(isDenseLongPresentationMessage(denseMixedRequest.messages[0]), true,
        'dense text with multiple functions takes the bounded tile path');
    const denseMixedTilePlan = createPresentationUnitTiles(denseMixedUnitPlan, true);
    assert.equal(denseMixedTilePlan.valid, true);
    const routeTileViews = new Map();
    const routeCallTrace = [];
    let activeUnitCalls = 0;
    let maxActiveUnitCalls = 0;
    let unitProviderCallCount = 0;
    let capturedUnitPrompt = '';
    const originalUnitFetch = globalThis.fetch;
    const quoteCellIdsFor = (cells, fullText, quote) => {
        const start = Array.from(fullText.slice(0, fullText.indexOf(quote))).length;
        const end = start + Array.from(quote).length;
        let cursor = 0;
        return cells.filter((cell) => {
            const cellStart = cursor;
            cursor += Array.from(cell.text).length;
            return cursor > start && cellStart < end;
        }).map((cell) => cell.id);
    };
    globalThis.fetch = async (url, init = {}) => {
        if (new URL(url).hostname === 'aiself.vip') {
            unitProviderCallCount += 1;
            activeUnitCalls += 1;
            maxActiveUnitCalls = Math.max(maxActiveUnitCalls, activeUnitCalls);
            const payload = JSON.parse(init.body);
            const providerInput = JSON.parse(payload.messages[0].content);
            capturedUnitPrompt ||= payload.system || '';
            const message = providerInput.messages[0];
            const viewText = message.visibleText;
            let trace = routeTileViews.get(viewText);
            if (!trace) {
                trace = { baseIds: new Set(message.ownedUnits.map((unit) => unit.unitId)), refineCalls: 0 };
                routeTileViews.set(viewText, trace);
            } else trace.refineCalls += 1;
            routeCallTrace.push({ unitCount: message.ownedUnits.length, refinement: trace.refineCalls > 0 });
            assert.equal(providerInput.contextMessages.length, 0, 'dense page-local unit calls omit prior full-page context');
            assert.equal(/(?:startCodePoint|endCodePoint|startAnchor|boundaryMarkedText)/u.test(JSON.stringify(providerInput)), false,
                'dense classification uses no coordinate or copied-boundary locator protocol');
            assert.ok(message.speakerEvidenceCells.every((cell) => Array.from(cell.text).length <= 24),
                'speaker evidence cells remain bounded and server-mapped');
            assert.ok(message.ownedUnits.every((unit) => unit.classificationEvidenceCells.every((cell) => Array.from(cell.text).length <= 24)),
                'classification evidence cells remain bounded and server-mapped');
            const unitClassifications = message.ownedUnits.map((unit) => {
                assert.ok(unit.classificationEvidenceCells.length > 0,
                    `every non-empty source unit has evidence cells (unit=${unit.unitId}, cp=${Array.from(unit.text).length}, text=${JSON.stringify(unit.text.slice(0, 48))})`);
                const hasMiraAndRowan = unit.text.includes('Mira') && unit.text.includes('Rowan');
                let kind = 'narration';
                let speakerMentionRef = null;
                let speakerEvidenceCellIds = [];
                if (hasMiraAndRowan) kind = 'mixed';
                else if (unit.text.includes('你好') || unit.text.includes('Mira说')) {
                    kind = 'dialogue'; speakerMentionRef = 'm0';
                    speakerEvidenceCellIds = quoteCellIdsFor(message.speakerEvidenceCells, viewText, 'Mira加入队伍，Mira说：');
                } else if (unit.text.includes('等等') || unit.text.includes('Rowan说')) {
                    kind = 'dialogue'; speakerMentionRef = 'm1';
                    speakerEvidenceCellIds = quoteCellIdsFor(message.speakerEvidenceCells, viewText, 'Rowan拦住她，Rowan说：');
                }
                return {
                    unitId: unit.unitId,
                    kind,
                    speakerMentionRef,
                    classificationEvidenceCellIds: kind === 'mixed' ? [] : [unit.classificationEvidenceCells[0].id],
                    speakerEvidenceCellIds,
                };
            });
            const entities = [];
            if (viewText.includes('Mira加入队伍')) entities.push({
                mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira加入队伍', kind: 'person', attributeEvidence: [],
            });
            if (viewText.includes('Rowan拦住她')) entities.push({
                mentionRef: 'm1', surfaceText: 'Rowan', contextText: 'Rowan拦住她', kind: 'person', attributeEvidence: [],
            });
            const hasMira = entities.some((entity) => entity.mentionRef === 'm0');
            const candidate = {
                schemaVersion: PRESENTATION_UNIT_CANDIDATE_VERSION,
                results: [{
                    unitClassifications,
                    entities,
                    identityLinkCandidates: hasMira ? [{
                        fromMentionRef: 'm0', toResolverEntityRef: 'published:mira', relation: 'same-entity',
                        evidenceQuotes: ['Mira加入队伍'], confidenceBand: 'high',
                    }] : [],
                    stateClaims: hasMira ? [{
                        claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'],
                        rosterSnapshotCompleteness: 'complete', evidenceQuotes: ['Mira加入队伍'], confidenceBand: 'high',
                    }] : [],
                }],
            };
            await new Promise((resolve) => setTimeout(resolve, 2));
            activeUnitCalls -= 1;
            return anthropicStructuredOutputResponseFromRequest(init, candidate);
        }
        return originalUnitFetch(url, init);
    };
    try {
        const unitResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
            method: 'POST',
            headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
            body: JSON.stringify(denseMixedRequest),
        });
        assert.equal(unitResponse.status, 200,
            `mixed units refine to a complete Annotation v1 result (${JSON.stringify(await unitResponse.clone().json())})`);
        const unitAnnotation = await unitResponse.json();
        assert.equal(unitAnnotation.schemaVersion, 'galgame.presentation-annotation.v1');
        assert.ok(unitProviderCallCount > denseMixedTilePlan.tiles.length,
            'only mixed units trigger additional provider calls');
        assert.ok(unitProviderCallCount <= 24, 'base and mixed-refinement calls share the fixed 24-call ceiling');
        assert.ok([...routeTileViews.values()].some((trace) => trace.refineCalls > 0), 'the compound source unit was batch-refined with fresh child IDs');
        assert.ok(maxActiveUnitCalls <= 3 && maxActiveUnitCalls > 1, 'unit calls respect the shared provider concurrency ceiling');
        assert.ok(capturedUnitPrompt.includes('unitId') && capturedUnitPrompt.includes('classificationEvidenceCellIds'));
        assert.ok(capturedUnitPrompt.includes('exactly one item in top-level results')
            && capturedUnitPrompt.includes('exactly one unit classification')
            && capturedUnitPrompt.includes('in the same order'),
        'the active unit prompt spells out the one-message, one-result, ordered-unit contract');
        assert.equal(/startAnchor|boundaryMarkedText|startCodePoint|endCodePoint/u.test(capturedUnitPrompt), false,
            'active unit prompt does not request text anchors, offsets, or per-character markers');
        const unitResult = unitAnnotation.results[0];
        const dialogueRows = unitResult.segments.filter((segment) => segment.kind === 'dialogue');
        assert.ok(dialogueRows.some((segment) => segment.speakerMentionRef === 'm0'), 'Mira identity survives refinement');
        assert.ok(dialogueRows.some((segment) => segment.speakerMentionRef === 'm1'), 'Rowan speaker changes survive refinement');
        assert.equal(unitResult.entities.length, 2, 'entities emitted in base/refinement responses merge by exact code-point span');
        assert.equal(unitResult.identityLinkCandidates.length, 1, 'valid identity claims survive the unit protocol');
        assert.equal(unitResult.stateClaims.length, 1, 'valid state claims survive the unit protocol');
        let cursor = 0;
        let reconstruction = '';
        for (const segment of unitResult.segments) {
            assert.equal(segment.start, cursor, 'unit materialization reconstructs the complete source with no gaps or overlap');
            const slice = Array.from(denseMixedText).slice(segment.start, segment.end).join('');
            assert.equal(segment.textHash, await createVisibleMessageHash(slice), 'each final hash comes from the exact source code-point span');
            reconstruction += slice;
            cursor = segment.end;
        }
        assert.equal(cursor, Array.from(denseMixedText).length);
        assert.equal(reconstruction, denseMixedText, 'the final annotation preserves every original code point exactly once');
        assert.ok(unitResult.segments.every((segment) => segment.evidenceSpans.some((span) => span.purpose === 'classification'
            && span.start >= segment.start && span.end <= segment.end)), 'classification evidence remains inside each final segment across tile seams');
    } finally {
        globalThis.fetch = originalUnitFetch;
    }

    const ordinaryNoQuoteText = `${'重复片段，'.repeat(35)}没有任何引号却仍能定位正文${'重复片段，'.repeat(35)}`;
    const ordinaryRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'ordinary-unit-route' },
        messages: [{ sourceMessageIndex: 19, sourceMessageHash: await createVisibleMessageHash(ordinaryNoQuoteText), authorLabel: '', visibleText: ordinaryNoQuoteText }],
        knownEntities: [],
    });
    let ordinaryUnitCalls = 0;
    const originalOrdinaryFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        if (new URL(url).hostname === 'aiself.vip') {
            ordinaryUnitCalls += 1;
            const providerInput = JSON.parse(JSON.parse(init.body).messages[0].content);
            return anthropicStructuredOutputResponseFromRequest(init, makeUnitCandidate(providerInput));
        }
        return originalOrdinaryFetch(url, init);
    };
    try {
        const ordinaryResponse = await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
            method: 'POST', headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
            body: JSON.stringify(ordinaryRequest),
        });
        assert.equal(ordinaryResponse.status, 200, 'ordinary non-tiled annotation also uses the unit-ID candidate');
        assert.equal(ordinaryUnitCalls, 1, 'ordinary partitioned units are classified in one provider call');
        const ordinaryAnnotation = await ordinaryResponse.json();
        assert.equal(ordinaryAnnotation.results[0].segments.length, 1, 'adjacent equal units merge into one public segment');
        assert.equal(ordinaryAnnotation.results[0].segments[0].textHash, await createVisibleMessageHash(ordinaryNoQuoteText));
    } finally {
        globalThis.fetch = originalOrdinaryFetch;
    }

    const ambiguousEntityText = 'Mira出现一次，后来又提到Mira。';
    const ambiguousEntityRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'optional-entity-recovery' },
        messages: [{ sourceMessageIndex: 21, sourceMessageHash: await createVisibleMessageHash(ambiguousEntityText), authorLabel: '', visibleText: ambiguousEntityText }],
        knownEntities: [],
    });
    const postMockedUnitCandidate = async (request, createCandidate) => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (url, init = {}) => {
            if (new URL(url).hostname === 'aiself.vip') {
                const providerInput = JSON.parse(JSON.parse(init.body).messages[0].content);
                return anthropicStructuredOutputResponseFromRequest(init, createCandidate(providerInput));
            }
            return originalFetch(url, init);
        };
        try {
            return await fetch(`http://127.0.0.1:${address.port}/v1/presentation/annotations`, {
                method: 'POST', headers: { origin: 'http://127.0.0.1:8001', 'content-type': 'application/json', 'x-galgame-presentation-version': '1' },
                body: JSON.stringify(request),
            });
        } finally {
            globalThis.fetch = originalFetch;
        }
    };
    const normalizedQuoteText = 'Mira说：“快走！”';
    const normalizedQuoteRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'normalized-anthropic-evidence' },
        messages: [{ sourceMessageIndex: 20, sourceMessageHash: await createVisibleMessageHash(normalizedQuoteText), authorLabel: '', visibleText: normalizedQuoteText }],
        knownEntities: [],
    });
    const normalizedQuoteResponse = await postMockedUnitCandidate(normalizedQuoteRequest, (providerInput) => {
        const message = providerInput.messages[0];
        const speakerCell = message.speakerEvidenceCells.find((cell) => cell.text.includes('Mira说'));
        assert.ok(speakerCell, 'the normalized provider view retains an opaque speaker evidence cell');
        return makeUnitCandidate(providerInput,
            () => ({ kind: 'dialogue', speakerMentionRef: 'm0', speakerEvidenceCellIds: [speakerCell.id] }),
            { entities: [{
                mentionRef: 'm0', surfaceText: 'Mira', contextText: message.visibleText,
                kind: 'person', attributeEvidence: [],
            }] },
        );
    });
    assert.equal(normalizedQuoteResponse.status, 200,
        'Anthropic-normalized source quotes are restored before strict entity and speaker evidence validation');
    const normalizedQuoteAnnotation = await normalizedQuoteResponse.json();
    assert.equal(normalizedQuoteAnnotation.results[0].segments[0].kind, 'dialogue');
    assert.equal(normalizedQuoteAnnotation.results[0].segments[0].speakerMentionRef, 'm0');
    assert.equal(normalizedQuoteAnnotation.results[0].sourceMessageHash, await createVisibleMessageHash(normalizedQuoteText),
        'quote reconciliation leaves the public source hash bound to the original text');
    const ambiguousNormalizedQuoteText = 'Mira说：“快走！”Mira说："快走！"';
    const ambiguousNormalizedQuoteRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'ambiguous-normalized-anthropic-evidence' },
        messages: [{ sourceMessageIndex: 21, sourceMessageHash: await createVisibleMessageHash(ambiguousNormalizedQuoteText), authorLabel: '', visibleText: ambiguousNormalizedQuoteText }],
        knownEntities: [],
    });
    const ambiguousNormalizedQuoteResponse = await postMockedUnitCandidate(ambiguousNormalizedQuoteRequest, (providerInput) => {
        const message = providerInput.messages[0];
        const speakerCell = message.speakerEvidenceCells.find((cell) => cell.text.includes('Mira说'));
        assert.ok(speakerCell);
        return makeUnitCandidate(providerInput,
            () => ({ kind: 'dialogue', speakerMentionRef: 'm0', speakerEvidenceCellIds: [speakerCell.id] }),
            { entities: [{
                mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira说："快走！"',
                kind: 'person', attributeEvidence: [],
            }] },
        );
    });
    assert.equal(ambiguousNormalizedQuoteResponse.status, 200,
        'ambiguous normalized quote evidence safely degrades optional speaker attribution');
    const ambiguousNormalizedQuoteAnnotation = await ambiguousNormalizedQuoteResponse.json();
    assert.equal(ambiguousNormalizedQuoteAnnotation.results[0].segments[0].kind, 'unattributed-dialogue');
    assert.equal(ambiguousNormalizedQuoteAnnotation.results[0].segments[0].speakerMentionRef, null,
        'an ASCII quote at a different original occurrence cannot capture the normalized speaker claim');
    assert.ok(denseMixedTilePlan.tiles.length > 1, 'dense regression fixture exercises the tiled merge path');
    const speakerlessDenseResponse = await postMockedUnitCandidate(denseMixedRequest, (providerInput) => makeUnitCandidate(
        providerInput,
        () => ({ kind: 'dialogue', speakerMentionRef: null }),
    ));
    assert.equal(speakerlessDenseResponse.status, 200,
        'speakerless dialogue normalization survives dense tile merge and final Annotation v1 validation');
    const speakerlessDenseAnnotation = await speakerlessDenseResponse.json();
    assert.ok(speakerlessDenseAnnotation.results[0].segments.length > 0);
    assert.ok(speakerlessDenseAnnotation.results[0].segments.every((segment) => (
        segment.kind === 'unattributed-dialogue' && segment.speakerMentionRef === null && segment.speakerSource === 'none'
    )), 'dense merged output preserves speech without inventing speaker attribution');
    let speakerlessDenseCursor = 0;
    for (const segment of speakerlessDenseAnnotation.results[0].segments) {
        assert.equal(segment.start, speakerlessDenseCursor, 'dense speakerless segments retain contiguous coverage');
        const segmentText = Array.from(denseMixedText).slice(segment.start, segment.end).join('');
        assert.equal(segment.textHash, await createVisibleMessageHash(segmentText), 'dense speakerless segment hash matches its exact source span');
        assert.ok(segment.evidenceSpans.some((span) => span.purpose === 'classification'
            && span.start >= segment.start && span.end <= segment.end), 'dense speakerless segment retains local classification evidence');
        assert.equal(segment.evidenceSpans.some((span) => span.purpose === 'speaker'), false);
        speakerlessDenseCursor = segment.end;
    }
    assert.equal(speakerlessDenseCursor, Array.from(denseMixedText).length, 'dense normalization covers the complete source message');

    const crossSegmentNameText = `${'x'.repeat(136)} Lady Veyra${'z'.repeat(1300)}${'“x”'.repeat(30)}`;
    const crossSegmentNameStart = crossSegmentNameText.indexOf('Lady Veyra');
    const crossSegmentNameEnd = crossSegmentNameStart + Array.from('Lady Veyra').length;
    const crossSegmentNamePlan = createPresentationSourceUnits(crossSegmentNameText);
    assert.equal(crossSegmentNamePlan.valid, true);
    assert.ok(crossSegmentNamePlan.units.some((unit) => unit.end > crossSegmentNameStart && unit.end < crossSegmentNameEnd),
        'fixture places an optional person mention across two source units');
    const crossSegmentNameRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'merge-cross-segment-entity' },
        messages: [{ sourceMessageIndex: 25, sourceMessageHash: await createVisibleMessageHash(crossSegmentNameText), authorLabel: '', visibleText: crossSegmentNameText }],
        knownEntities: [],
    });
    assert.equal(isDenseLongPresentationMessage(crossSegmentNameRequest.messages[0]), true,
        'cross-segment entity fixture exercises the dense tile-merge path');
    const crossSegmentMergeLogs = [];
    const originalCrossSegmentMergeStderr = process.stderr.write;
    process.stderr.write = function captureCrossSegmentMergeStderr(chunk, ...args) {
        crossSegmentMergeLogs.push(String(chunk));
        return true;
    };
    let crossSegmentMergeResponse;
    try {
        crossSegmentMergeResponse = await postMockedUnitCandidate(crossSegmentNameRequest, (providerInput) => {
            const message = providerInput.messages[0];
            const candidate = makeUnitCandidate(providerInput, (unit) => (
                unit.text.includes('Veyra')
                    ? { kind: 'dialogue', speakerMentionRef: null }
                    : { kind: 'narration', speakerMentionRef: null }
            ));
            if (message.visibleText.includes('Lady Veyra')) {
                candidate.results[0].entities = [{
                    mentionRef: 'm0', surfaceText: 'Lady Veyra', contextText: 'Lady Veyra', kind: 'person', attributeEvidence: [],
                }];
            }
            return candidate;
        });
    } finally {
        process.stderr.write = originalCrossSegmentMergeStderr;
    }
    assert.equal(crossSegmentMergeResponse.status, 200,
        'invalid optional entities crossing final segment boundaries are dropped during safe merge recovery');
    const crossSegmentMergeAnnotation = await crossSegmentMergeResponse.json();
    assert.equal(crossSegmentMergeAnnotation.results[0].entities.length, 0,
        'a person surface crossing two semantic segments is not published as a valid entity');
    assert.ok(crossSegmentMergeAnnotation.results[0].segments.some((segment) => segment.kind === 'narration'));
    assert.ok(crossSegmentMergeAnnotation.results[0].segments.some((segment) => segment.kind === 'unattributed-dialogue'));
    const crossSegmentMergeRecoveries = crossSegmentMergeLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).filter((row) => row?.event === 'presentation-output-recovered');
    assert.ok(crossSegmentMergeRecoveries.some((row) => row.recoveryDiagnostics?.issueKinds.includes('invalid-entity-dropped')),
        'merge recovery logs only a fixed optional-entity category');
    assert.ok(crossSegmentMergeRecoveries.some((row) => row.recoveryDiagnostics?.outcome === 'recovered'
        && row.recoveryDiagnostics.initialValidatorCategories.includes('outside-segments')
        && row.recoveryDiagnostics.finalValidatorCategories.length === 0),
    'successful optional recovery records bounded initial/final validator categories');
    assert.equal(crossSegmentMergeLogs.join('').includes(crossSegmentNameText), false,
        'cross-segment recovery diagnostics do not include source story text');
    let crossSegmentCursor = 0;
    for (const segment of crossSegmentMergeAnnotation.results[0].segments) {
        assert.equal(segment.start, crossSegmentCursor, 'recovered dense segments retain complete contiguous coverage');
        const segmentText = Array.from(crossSegmentNameText).slice(segment.start, segment.end).join('');
        assert.equal(segment.textHash, await createVisibleMessageHash(segmentText));
        assert.ok(segment.evidenceSpans.some((span) => span.purpose === 'classification'
            && span.start >= segment.start && span.end <= segment.end));
        crossSegmentCursor = segment.end;
    }
    assert.equal(crossSegmentCursor, Array.from(crossSegmentNameText).length);
    for (const resultShapeCase of [
        { label: 'shape', category: 'results-type-object', mutate: (candidate) => { candidate.results = {}; } },
        { label: 'count', category: 'unit-results-count', mutate: (candidate) => { candidate.results = []; } },
    ]) {
        const resultShapeLogs = [];
        const originalResultShapeStderr = process.stderr.write;
        process.stderr.write = function captureResultShapeStderr(chunk, ...args) {
            resultShapeLogs.push(String(chunk));
            return true;
        };
        let resultShapeResponse;
        try {
            resultShapeResponse = await postMockedUnitCandidate(ambiguousEntityRequest, (providerInput) => {
                const candidate = makeUnitCandidate(providerInput);
                resultShapeCase.mutate(candidate);
                return candidate;
            });
        } finally {
            process.stderr.write = originalResultShapeStderr;
        }
        assert.equal(resultShapeResponse.status, 502, `malformed unit result ${resultShapeCase.label} remains rejected`);
        assert.equal((await resultShapeResponse.json()).code, 'INVALID_MODEL_OUTPUT');
        const resultShapeEvent = resultShapeLogs.map((line) => {
            try { return JSON.parse(line); } catch { return null; }
        }).find((row) => row?.event === 'presentation-output-rejected');
        assert.ok(resultShapeEvent?.validationCategories.includes(resultShapeCase.category),
            `sanitized route diagnostics distinguish result ${resultShapeCase.label}`);
        assert.equal(JSON.stringify(resultShapeEvent).includes(ambiguousEntityText), false,
            'result-shape diagnostics omit source text');
    }
    const optionalRecoveryLogs = [];
    const originalOptionalRecoveryStderr = process.stderr.write;
    process.stderr.write = function captureOptionalRecoveryStderr(chunk, ...args) {
        optionalRecoveryLogs.push(String(chunk));
        return true;
    };
    let ambiguousEntityResponse;
    try {
        ambiguousEntityResponse = await postMockedUnitCandidate(ambiguousEntityRequest, (providerInput) => {
            const candidate = makeUnitCandidate(providerInput);
            candidate.results[0].entities = [{
                mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira', kind: 'person', attributeEvidence: [],
            }];
            candidate.results[0].identityLinkCandidates = [{
                fromMentionRef: 'm0', toResolverEntityRef: 'published:mira', relation: 'same-entity',
                evidenceQuotes: ['Mira'], confidenceBand: 'high',
            }];
            candidate.results[0].stateClaims = [{
                claimType: 'party.snapshot', targetMentionRef: null, memberMentionRefs: ['m0'],
                rosterSnapshotCompleteness: 'complete', evidenceQuotes: ['Mira'], confidenceBand: 'high',
            }];
            return candidate;
        });
    } finally {
        process.stderr.write = originalOptionalRecoveryStderr;
    }
    assert.equal(ambiguousEntityResponse.status, 200,
        'ambiguous optional entity context does not invalidate an independently valid narration classification');
    const ambiguousEntityAnnotation = await ambiguousEntityResponse.json();
    assert.equal(ambiguousEntityAnnotation.results[0].segments[0].kind, 'narration');
    assert.equal(ambiguousEntityAnnotation.results[0].entities.length, 0, 'the ambiguous optional entity is dropped safely');
    assert.equal(ambiguousEntityAnnotation.results[0].identityLinkCandidates.length, 0, 'identity links to a dropped entity are also dropped');
    assert.equal(ambiguousEntityAnnotation.results[0].stateClaims.length, 0, 'state claims to a dropped entity are also dropped');
    assert.ok(ambiguousEntityAnnotation.results[0].segments[0].evidenceSpans.some((span) => span.purpose === 'classification'),
        'optional-claim recovery preserves the required core classification evidence');
    const optionalRecoveryEvent = optionalRecoveryLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-recovered');
    assert.ok(optionalRecoveryEvent?.recoveryDiagnostics?.issueKinds.includes('invalid-entity-dropped'));
    assert.ok(optionalRecoveryEvent?.recoveryDiagnostics?.issueKinds.includes('optional-identity-link-dropped'));
    assert.equal(optionalRecoveryLogs.join('').includes(ambiguousEntityText), false,
        'optional-claim recovery diagnostics do not include source story text');

    const malformedCoreEvidenceLogs = [];
    const originalCoreEvidenceStderr = process.stderr.write;
    process.stderr.write = function captureCoreEvidenceStderr(chunk, ...args) {
        malformedCoreEvidenceLogs.push(String(chunk));
        return true;
    };
    let malformedCoreEvidenceResponse;
    try {
        malformedCoreEvidenceResponse = await postMockedUnitCandidate(ambiguousEntityRequest, (providerInput) => {
            const candidate = makeUnitCandidate(providerInput);
            candidate.results[0].unitClassifications[0].classificationEvidenceCellIds = ['e_foreign_core_evidence'];
            candidate.results[0].entities = [{
                mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira', kind: 'person', attributeEvidence: [],
            }];
            return candidate;
        });
    } finally {
        process.stderr.write = originalCoreEvidenceStderr;
    }
    assert.equal(malformedCoreEvidenceResponse.status, 502,
        'invalid core classification evidence rejects the v24 HTTP request even when an optional entity could be dropped');
    assert.equal((await malformedCoreEvidenceResponse.json()).code, 'INVALID_MODEL_OUTPUT',
        'core evidence failures are not converted into optional-claim recovery');
    const malformedCoreEvidenceEvent = malformedCoreEvidenceLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-rejected');
    assert.ok(malformedCoreEvidenceEvent?.validationCategories.includes('classification-evidence-id-unknown'),
        'sanitized diagnostics expose a fixed category for invalid unit evidence IDs');
    assert.equal(JSON.stringify(malformedCoreEvidenceEvent).includes('e_foreign_core_evidence'), false,
        'diagnostic categories never include provider-controlled evidence IDs');
    assert.equal(JSON.stringify(malformedCoreEvidenceEvent).includes(ambiguousEntityText), false,
        'diagnostics never include source text while classifying v24 validation failures');

    const ambiguousSpeakerText = 'Mira说：“你好。”后来Mira说：“再见。”';
    const ambiguousSpeakerRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'optional-speaker-recovery' },
        messages: [{ sourceMessageIndex: 22, sourceMessageHash: await createVisibleMessageHash(ambiguousSpeakerText), authorLabel: '', visibleText: ambiguousSpeakerText }],
        knownEntities: [],
    });
    const ambiguousSpeakerResponse = await postMockedUnitCandidate(ambiguousSpeakerRequest, (providerInput) => {
        const message = providerInput.messages[0];
        const candidate = makeUnitCandidate(providerInput, () => ({
            kind: 'dialogue', speakerMentionRef: 'm0', speakerEvidenceCellIds: [message.speakerEvidenceCells[0].id],
        }));
        candidate.results[0].entities = [{
            mentionRef: 'm0', surfaceText: 'Mira', contextText: 'Mira', kind: 'person', attributeEvidence: [],
        }];
        return candidate;
    });
    assert.equal(ambiguousSpeakerResponse.status, 200,
        'an invalid optional speaker entity downgrades attribution instead of discarding the valid dialogue classification');
    const ambiguousSpeakerAnnotation = await ambiguousSpeakerResponse.json();
    assert.equal(ambiguousSpeakerAnnotation.results[0].entities.length, 0);
    assert.equal(ambiguousSpeakerAnnotation.results[0].segments[0].kind, 'unattributed-dialogue');
    assert.equal(ambiguousSpeakerAnnotation.results[0].segments[0].speakerMentionRef, null);
    assert.equal(ambiguousSpeakerAnnotation.results[0].segments[0].evidenceSpans.some((span) => span.purpose === 'speaker'), false,
        'downgrade removes only unsupported speaker evidence and retains classification evidence');

    const speakerlessDialogueLogs = [];
    const originalSpeakerlessDialogueStderr = process.stderr.write;
    process.stderr.write = function captureSpeakerlessDialogueStderr(chunk, ...args) {
        speakerlessDialogueLogs.push(String(chunk));
        return true;
    };
    let speakerlessDialogueResponse;
    try {
        speakerlessDialogueResponse = await postMockedUnitCandidate(ambiguousSpeakerRequest, (providerInput) => makeUnitCandidate(
            providerInput,
            () => ({ kind: 'dialogue', speakerMentionRef: null }),
        ));
    } finally {
        process.stderr.write = originalSpeakerlessDialogueStderr;
    }
    assert.equal(speakerlessDialogueResponse.status, 200,
        'speech classified as dialogue without a supported speaker is normalized instead of invalidating the whole annotation');
    const speakerlessDialogueAnnotation = await speakerlessDialogueResponse.json();
    assert.ok(speakerlessDialogueAnnotation.results[0].segments.length > 0);
    assert.ok(speakerlessDialogueAnnotation.results[0].segments.every((segment) => (
        segment.kind === 'unattributed-dialogue' && segment.speakerMentionRef === null && segment.speakerSource === 'none'
    )), 'speakerless speech stays visible as unattributed dialogue and never becomes narration');
    assert.ok(speakerlessDialogueAnnotation.results[0].segments.every((segment) => (
        segment.evidenceSpans.some((span) => span.purpose === 'classification')
            && !segment.evidenceSpans.some((span) => span.purpose === 'speaker')
    )), 'normalization preserves classification evidence while excluding unsupported speaker evidence');
    const speakerlessDialogueRecovery = speakerlessDialogueLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-recovered');
    assert.ok(speakerlessDialogueRecovery?.recoveryDiagnostics?.issueKinds.includes('unsupported-speaker-downgraded'),
        'the safe downgrade is recorded using bounded diagnostic categories');
    assert.equal(speakerlessDialogueLogs.join('').includes(ambiguousSpeakerText), false,
        'speaker downgrade logs never include source text');

    const contradictorySpeakerResponse = await postMockedUnitCandidate(ambiguousSpeakerRequest, (providerInput) => {
        const message = providerInput.messages[0];
        return makeUnitCandidate(providerInput, () => ({
            kind: 'dialogue', speakerMentionRef: null, speakerEvidenceCellIds: [message.speakerEvidenceCells[0].id],
        }));
    });
    assert.equal(contradictorySpeakerResponse.status, 502,
        'speaker evidence without a referenced person remains invalid and is not silently normalized');
    assert.equal((await contradictorySpeakerResponse.json()).code, 'INVALID_MODEL_OUTPUT');

    const deepMixedText = `AB${'X'.repeat(126)}`;
    const deepMixedRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'mixed-six-level-resolution' },
        messages: [{ sourceMessageIndex: 23, sourceMessageHash: await createVisibleMessageHash(deepMixedText), authorLabel: '', visibleText: deepMixedText }],
        knownEntities: [],
    });
    let deepMixedCalls = 0;
    const deepMixedResponse = await postMockedUnitCandidate(deepMixedRequest, (providerInput) => {
        deepMixedCalls += 1;
        return makeUnitCandidate(providerInput, (unit) => {
            const remainsMixed = Array.from(unit.text).length > 2 && unit.text.includes('A') && unit.text.includes('B');
            return { kind: remainsMixed ? 'mixed' : 'narration', speakerMentionRef: null };
        });
    });
    assert.equal(deepMixedResponse.status, 200, 'a mixed unit that resolves at the new depth limit can be classified');
    assert.equal(deepMixedCalls, 7, 'one base classification plus six grapheme-safe refinements resolve the deep mixed unit');
    const deepMixedAnnotation = await deepMixedResponse.json();
    assert.equal(deepMixedAnnotation.results[0].segments.length, 1);
    assert.equal(deepMixedAnnotation.results[0].segments[0].kind, 'narration');
    assert.equal(deepMixedAnnotation.results[0].segments[0].textHash, await createVisibleMessageHash(deepMixedText));

    const stillMixedText = 'AB'.repeat(64);
    const stillMixedRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'mixed-fail-closed-at-limit' },
        messages: [{ sourceMessageIndex: 24, sourceMessageHash: await createVisibleMessageHash(stillMixedText), authorLabel: '', visibleText: stillMixedText }],
        knownEntities: [],
    });
    let stillMixedCalls = 0;
    const stillMixedLogs = [];
    const originalStillMixedStderr = process.stderr.write;
    process.stderr.write = function captureStillMixedStderr(chunk, ...args) {
        stillMixedLogs.push(String(chunk));
        return true;
    };
    let stillMixedResponse;
    try {
        stillMixedResponse = await postMockedUnitCandidate(stillMixedRequest, (providerInput) => {
            stillMixedCalls += 1;
            return makeUnitCandidate(providerInput, () => ({ kind: 'mixed', speakerMentionRef: null }));
        });
    } finally {
        process.stderr.write = originalStillMixedStderr;
    }
    assert.equal(stillMixedResponse.status, 502, 'still-mixed text rejects the whole message instead of being coerced to narration');
    assert.equal((await stillMixedResponse.json()).code, 'INVALID_MODEL_OUTPUT');
    assert.equal(stillMixedCalls, 7, 'unresolved mixed text is rejected after six refinements within the provider-call ceiling');
    assert.ok(stillMixedCalls <= 24, 'failed mixed refinements remain within the global provider-call ceiling');
    const stillMixedEvent = stillMixedLogs.map((line) => {
        try { return JSON.parse(line); } catch { return null; }
    }).find((row) => row?.event === 'presentation-output-rejected');
    assert.ok(stillMixedEvent?.validationCategories.includes('mixed-refinement-depth-exhausted'),
        'unresolved text fails specifically at the configured mixed-refinement limit');

    const diagnosticLeakToken = 'm7DiagnosticLeak42';
    const diagnosticText = 'Mira（female）说：“好。”';
    const diagnosticRequest = await createPresentationAnnotationRequest({
        scope: { scenarioId: 'scenario', scenarioVersion: '1', releaseId: 'release', arcId: '', chatKey: 'diagnostic-redaction' },
        messages: [{ sourceMessageIndex: 9, sourceMessageHash: await createVisibleMessageHash(diagnosticText), authorLabel: '', visibleText: diagnosticText }],
        knownEntities: [],
    });
    const diagnosticUnitCandidateFor = (init, includeExtraKey = false) => {
        const providerInput = JSON.parse(JSON.parse(init.body).messages[0].content);
        const message = providerInput.messages[0];
        const candidate = {
            schemaVersion: PRESENTATION_UNIT_CANDIDATE_VERSION,
            results: [{
                unitClassifications: message.ownedUnits.map((unit) => ({
                    unitId: unit.unitId, kind: 'dialogue', speakerMentionRef: diagnosticLeakToken,
                    classificationEvidenceCellIds: [unit.classificationEvidenceCells[0].id], speakerEvidenceCellIds: [],
                })),
                entities: [], identityLinkCandidates: [], stateClaims: [],
            }],
        };
        if (includeExtraKey) candidate[diagnosticLeakToken] = true;
        return candidate;
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
            if (new URL(url).hostname === 'aiself.vip') {
                return anthropicStructuredOutputResponseFromRequest(init, diagnosticUnitCandidateFor(init));
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
    assert.ok(diagnosticEvent.validationCategories.includes('speaker-ref-invalid'),
        'unit protocol validation diagnostics classify invalid speaker references without copying model-controlled paths');
    assert.equal(diagnosticEvent.validationIssueCount > 0, true, 'safe diagnostics preserve bounded issue counts');

    const extraKeyLogs = [];
    process.stderr.write = function captureExtraKeyStderr(chunk, ...args) {
        extraKeyLogs.push(String(chunk));
        return true;
    };
    const originalExtraKeyFetch = globalThis.fetch;
    try {
        globalThis.fetch = async (url, init = {}) => {
            if (new URL(url).hostname === 'aiself.vip') {
                return anthropicStructuredOutputResponseFromRequest(init, diagnosticUnitCandidateFor(init, true));
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
        if (new URL(url).hostname === 'aiself.vip') {
            const providerPayload = JSON.parse(init.body);
            const providerInput = JSON.parse(providerPayload.messages[0].content);
            providerCalls.push({ providerPayload, providerInput });
            assert.match(providerPayload.system, /currentLocationText/u);
            assert.match(providerPayload.system, /Do not calculate or output numeric offsets/u);
            assert.match(providerPayload.system, /environment modifiers/u);
            assert.match(providerPayload.system, /transition-from/u);
            return anthropicStructuredOutputResponseFromRequest(init, {
                    confidenceBand: 'high',
                    currentLocationText: '贵族区',
                    transitionActionText: '穿过',
                    referencedLocationTexts: [],
                    visualTags: [{ code: 'scene.night', evidenceText: '夜幕' }],
                });
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
            if (new URL(url).hostname === 'aiself.vip') {
                if (returnValidProviderResult) {
                    return anthropicStructuredOutputResponseFromRequest(init, {
                            confidenceBand: 'high',
                            currentLocationText: '贵族区',
                            transitionActionText: '穿过',
                            referencedLocationTexts: [],
                            visualTags: [{ code: 'scene.city', evidenceText: '贵族区' }],
                        });
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
