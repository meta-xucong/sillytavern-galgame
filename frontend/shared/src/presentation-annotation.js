export const PRESENTATION_ANNOTATION_REQUEST_VERSION = 'galgame.presentation-annotation-request.v1';
export const PRESENTATION_ANNOTATION_VERSION = 'galgame.presentation-annotation.v1';
export const PRESENTATION_IDENTITY_PROJECTION_VERSION = 'galgame.identity-projection.v1';
export const PRESENTATION_ROSTER_PROJECTION_VERSION = 'galgame.roster-projection.v1';
export const PRESENTATION_ERROR_VERSION = 'galgame.presentation-error.v1';

export const PRESENTATION_LIMITS = Object.freeze({
    bodyBytes: 48 * 1024,
    maxBatchMessages: 8,
    maxMessageCodePoints: 6000,
    maxContextMessages: 4,
    maxContextMessageCodePoints: 3000,
    maxKnownEntities: 32,
});

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ANNOTATION_KINDS = new Set([
    'narration', 'dialogue', 'unattributed-dialogue', 'stage-direction', 'status', 'choice', 'other-visible',
]);
const SPEAKER_SOURCES = new Set(['text-explicit', 'quoted-attribution', 'none']);
const CONFIDENCE_BANDS = new Set(['low', 'medium', 'high']);
const EVIDENCE_PURPOSES = new Set(['speaker', 'classification', 'coreference', 'attribute', 'state']);
const ENTITY_KINDS = new Set(['person', 'collective', 'place', 'object', 'unknown']);
const ATTRIBUTE_CATEGORIES = new Set(['gender', 'species', 'appearance']);
const LINK_RELATIONS = new Set(['same-entity', 'alias-of', 'not-same-entity']);
const CLAIM_TYPES = new Set(['party.join', 'party.leave', 'party.snapshot', 'unresolved']);
const SNAPSHOT_COMPLETENESS = new Set(['complete', 'partial']);

const spanSchema = (purpose) => ({
    type: 'object', additionalProperties: false, required: ['start', 'end', ...(purpose ? ['purpose'] : [])],
    properties: {
        start: { type: 'integer', minimum: 0 },
        end: { type: 'integer', minimum: 1 },
        ...(purpose ? { purpose: { type: 'string', enum: purpose } } : {}),
    },
});

const evidenceSchema = (purpose, maxItems = 32) => ({ type: 'array', maxItems, items: spanSchema(purpose) });

export const PRESENTATION_ANNOTATION_RESPONSE_JSON_SCHEMA = Object.freeze({
    type: 'object', additionalProperties: false, required: ['schemaVersion', 'results'],
    properties: {
        schemaVersion: { type: 'string', const: PRESENTATION_ANNOTATION_VERSION },
        results: {
            type: 'array', minItems: 1, maxItems: 8,
            items: {
                type: 'object', additionalProperties: false,
                required: ['sourceMessageIndex', 'sourceMessageHash', 'segments', 'entities', 'identityLinkCandidates', 'stateClaims'],
                properties: {
                    sourceMessageIndex: { type: 'integer', minimum: 0 },
                    sourceMessageHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                    segments: {
                        type: 'array', minItems: 1, maxItems: 256,
                        items: {
                            type: 'object', additionalProperties: false,
                            required: ['start', 'end', 'textHash', 'kind', 'speakerMentionRef', 'speakerSource', 'confidenceBand', 'evidenceSpans'],
                            properties: {
                                start: { type: 'integer', minimum: 0 }, end: { type: 'integer', minimum: 1 },
                                textHash: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' },
                                kind: { type: 'string', enum: [...ANNOTATION_KINDS] },
                                speakerMentionRef: { anyOf: [{ type: 'string', pattern: '^m(?:[0-9]|[1-5][0-9]|6[0-3])$' }, { type: 'null' }] },
                                speakerSource: { type: 'string', enum: [...SPEAKER_SOURCES] },
                                confidenceBand: { type: 'string', enum: [...CONFIDENCE_BANDS] },
                                evidenceSpans: { type: 'array', maxItems: 8, items: spanSchema([...EVIDENCE_PURPOSES]) },
                            },
                        },
                    },
                    entities: {
                        type: 'array', maxItems: 64,
                        items: {
                            type: 'object', additionalProperties: false, required: ['mentionRef', 'surfaceSpan', 'kind', 'attributeEvidence'],
                            properties: {
                                mentionRef: { type: 'string', pattern: '^m(?:[0-9]|[1-5][0-9]|6[0-3])$' },
                                surfaceSpan: spanSchema(null),
                                kind: { type: 'string', enum: [...ENTITY_KINDS] },
                                attributeEvidence: {
                                    type: 'array', maxItems: 16,
                                    items: {
                                        type: 'object', additionalProperties: false, required: ['category', 'value', 'span'],
                                        properties: {
                                            category: { type: 'string', enum: [...ATTRIBUTE_CATEGORIES] },
                                            value: { type: 'string', minLength: 1, maxLength: 80 }, span: spanSchema(null),
                                        },
                                    },
                                },
                            },
                        },
                    },
                    identityLinkCandidates: {
                        type: 'array', maxItems: 64,
                        items: {
                            type: 'object', additionalProperties: false,
                            required: ['fromMentionRef', 'toResolverEntityRef', 'relation', 'evidenceSpans', 'confidenceBand'],
                            properties: {
                                fromMentionRef: { type: 'string' }, toResolverEntityRef: { type: 'string' },
                                relation: { type: 'string', enum: [...LINK_RELATIONS] },
                                evidenceSpans: evidenceSchema(['coreference'], 4),
                                confidenceBand: { type: 'string', enum: [...CONFIDENCE_BANDS] },
                            },
                        },
                    },
                    stateClaims: {
                        type: 'array', maxItems: 64,
                        items: {
                            type: 'object', additionalProperties: false,
                            required: ['claimType', 'targetMentionRef', 'memberMentionRefs', 'rosterSnapshotCompleteness', 'evidenceSpans', 'confidenceBand'],
                            properties: {
                                claimType: { type: 'string', enum: [...CLAIM_TYPES] },
                                targetMentionRef: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                                memberMentionRefs: { type: 'array', maxItems: 32, items: { type: 'string' } },
                                rosterSnapshotCompleteness: { anyOf: [{ type: 'string', enum: [...SNAPSHOT_COMPLETENESS] }, { type: 'null' }] },
                                evidenceSpans: evidenceSchema(['state']),
                                confidenceBand: { type: 'string', enum: [...CONFIDENCE_BANDS] },
                            },
                        },
                    },
                },
            },
        },
    },
});

export function codePointLength(value) {
    return Array.from(String(value)).length;
}

export function codePointSlice(value, start, end) {
    return Array.from(String(value)).slice(start, end).join('');
}

export async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
}

/**
 * Converts only the administrator-published character binding index into the
 * closed, provider-neutral entity list accepted by presentation annotations.
 * It intentionally does not inspect visual assets, cards, world books, or chat
 * text, and keeps ambiguous duplicate names as separate candidates.
 */
export async function createPublishedPresentationKnownEntities(resourceBindings = {}) {
    const entries = isRecord(resourceBindings) ? Object.entries(resourceBindings).sort(([left], [right]) => compareCodePointStrings(left, right)) : [];
    const knownEntities = [];
    let invalidCount = 0;
    for (const [id, character] of entries.slice(0, PRESENTATION_LIMITS.maxKnownEntities)) {
        const resolverEntityRef = `published:${id}`;
        if (codePointLength(resolverEntityRef) > 160 || !isRecord(character)) {
            invalidCount += 1;
            continue;
        }
        const canonicalName = [character.displayName, character.name, id]
            .find((value) => typeof value === 'string' && value.trim() && codePointLength(value.trim()) <= 120)?.trim();
        if (!canonicalName) {
            invalidCount += 1;
            continue;
        }
        const seen = new Set([normalizeKnownName(canonicalName)]);
        const visibleNames = [canonicalName];
        const aliases = Array.isArray(character.aliases)
            ? character.aliases.filter((value) => typeof value === 'string').map((value) => value.trim())
                .filter((value) => value && codePointLength(value) <= 120)
                .sort(compareCodePointStrings)
            : [];
        for (const alias of aliases) {
            const normalized = normalizeKnownName(alias);
            if (!normalized || seen.has(normalized)) continue;
            seen.add(normalized);
            visibleNames.push(alias);
            if (visibleNames.length >= 8) break;
        }
        const evidenceDigest = `sha256:${await sha256Hex(JSON.stringify([resolverEntityRef, visibleNames]))}`;
        knownEntities.push({ resolverEntityRef, visibleNames, evidenceDigest, attributes: [] });
    }
    const diagnostics = [];
    if (entries.length > PRESENTATION_LIMITS.maxKnownEntities) {
        diagnostics.push({ code: 'known-entity-cap', count: entries.length - PRESENTATION_LIMITS.maxKnownEntities });
    }
    if (invalidCount) diagnostics.push({ code: 'known-entity-invalid', count: invalidCount });
    return { knownEntities, diagnostics };
}

function normalizeKnownName(value) {
    return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

function compareCodePointStrings(left, right) {
    const a = Array.from(String(left));
    const b = Array.from(String(right));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
        if (delta) return delta;
    }
    return a.length - b.length;
}

export async function createVisibleMessageHash(visibleText) {
    return `sha256:${await sha256Hex(visibleText)}`;
}

export async function createPresentationContextDigest(contextMessages = [], knownEntities = []) {
    const canonicalContext = contextMessages.map((message) => ({
        sourceMessageIndex: message.sourceMessageIndex,
        sourceMessageHash: message.sourceMessageHash,
        visibleText: message.visibleText,
    }));
    const canonicalEntities = knownEntities.map((entity) => ({
        resolverEntityRef: entity.resolverEntityRef,
        visibleNames: [...entity.visibleNames],
        evidenceDigest: entity.evidenceDigest,
        attributes: entity.attributes.map((attribute) => ({
            category: attribute.category,
            value: attribute.value,
        })),
    }));
    return `sha256:${await sha256Hex(JSON.stringify([canonicalContext, canonicalEntities]))}`;
}

export async function createPresentationAnnotationRequest({
    scope,
    messages,
    contextMessages = [],
    knownEntities = [],
    requestId = globalThis.crypto.randomUUID(),
} = {}) {
    const request = {
        schemaVersion: PRESENTATION_ANNOTATION_REQUEST_VERSION,
        annotationSchemaVersion: PRESENTATION_ANNOTATION_VERSION,
        requestId,
        scope: {
            scenarioId: String(scope?.scenarioId ?? ''),
            scenarioVersion: String(scope?.scenarioVersion ?? ''),
            releaseId: String(scope?.releaseId ?? ''),
            arcId: String(scope?.arcId ?? ''),
            chatKey: String(scope?.chatKey ?? ''),
        },
        contextDigest: await createPresentationContextDigest(contextMessages, knownEntities),
        contextMessages: contextMessages.map((message) => ({
            sourceMessageIndex: message.sourceMessageIndex,
            sourceMessageHash: message.sourceMessageHash,
            visibleText: message.visibleText,
        })),
        messages: messages.map((message) => ({
            sourceMessageIndex: message.sourceMessageIndex,
            sourceMessageHash: message.sourceMessageHash,
            role: 'assistant',
            authorLabel: String(message.authorLabel ?? ''),
            visibleText: message.visibleText,
        })),
        knownEntities: knownEntities.map((entity) => ({
            resolverEntityRef: entity.resolverEntityRef,
            visibleNames: [...entity.visibleNames],
            evidenceDigest: entity.evidenceDigest,
            attributes: entity.attributes.map((attribute) => ({
                category: attribute.category,
                value: attribute.value,
            })),
        })),
    };
    return request;
}

export function validatePresentationAnnotationRequest(request) {
    const errors = [];
    assertExactKeys(request, [
        'schemaVersion', 'annotationSchemaVersion', 'requestId', 'scope', 'contextDigest',
        'contextMessages', 'messages', 'knownEntities',
    ], 'request', errors);
    if (!isRecord(request)) return result(errors);
    if (request.schemaVersion !== PRESENTATION_ANNOTATION_REQUEST_VERSION) errors.push('request.schemaVersion');
    if (request.annotationSchemaVersion !== PRESENTATION_ANNOTATION_VERSION) errors.push('request.annotationSchemaVersion');
    if (typeof request.requestId !== 'string' || !UUID_PATTERN.test(request.requestId)) errors.push('request.requestId');
    if (!HASH_PATTERN.test(String(request.contextDigest))) errors.push('request.contextDigest');
    assertExactKeys(request.scope, ['scenarioId', 'scenarioVersion', 'releaseId', 'arcId', 'chatKey'], 'request.scope', errors);
    for (const key of ['scenarioId', 'scenarioVersion', 'releaseId', 'chatKey']) {
        if (!isBoundedString(request.scope?.[key], 1, 256)) errors.push(`request.scope.${key}`);
    }
    if (!isBoundedString(request.scope?.arcId, 0, 256)) errors.push('request.scope.arcId');
    validateRequestMessages(request.contextMessages, { min: 0, max: PRESENTATION_LIMITS.maxContextMessages, maxText: PRESENTATION_LIMITS.maxContextMessageCodePoints, path: 'request.contextMessages', errors });
    validateRequestMessages(request.messages, { min: 1, max: PRESENTATION_LIMITS.maxBatchMessages, maxText: PRESENTATION_LIMITS.maxMessageCodePoints, path: 'request.messages', player: true, errors });
    if (Array.isArray(request.messages) && !isStrictlyIncreasing(request.messages.map((message) => message?.sourceMessageIndex))) errors.push('request.messages.order');
    if (Array.isArray(request.contextMessages) && Array.isArray(request.messages)) {
        const indexes = new Set(request.messages.map((message) => message?.sourceMessageIndex));
        if (request.contextMessages.some((message) => indexes.has(message?.sourceMessageIndex))) errors.push('request.contextMessages.duplicate-message');
        if (!isStrictlyIncreasing(request.contextMessages.map((message) => message?.sourceMessageIndex))) errors.push('request.contextMessages.order');
    }
    if (!Array.isArray(request.knownEntities) || request.knownEntities.length > PRESENTATION_LIMITS.maxKnownEntities) {
        errors.push('request.knownEntities');
    } else {
        request.knownEntities.forEach((entity, index) => validateKnownEntity(entity, `request.knownEntities.${index}`, errors));
    }
    return result(errors);
}

export async function validatePresentationAnnotationRequestAsync(request, { maxBytes = PRESENTATION_LIMITS.bodyBytes } = {}) {
    const base = validatePresentationAnnotationRequest(request);
    const errors = [...base.errors];
    if (isRecord(request)) {
        if (BufferOrTextEncoderByteLength(JSON.stringify(request)) > maxBytes) errors.push('request.body-too-large');
        if (Array.isArray(request.contextMessages) && Array.isArray(request.knownEntities)) {
            try {
                const digest = await createPresentationContextDigest(request.contextMessages, request.knownEntities);
                if (request.contextDigest !== digest) errors.push('request.contextDigest-mismatch');
            } catch {
                errors.push('request.contextDigest-invalid');
            }
        }
        for (const [collectionName, collection] of [['contextMessages', request.contextMessages], ['messages', request.messages]]) {
            if (!Array.isArray(collection)) continue;
            for (let index = 0; index < collection.length; index += 1) {
                if (await createVisibleMessageHash(collection[index]?.visibleText || '') !== collection[index]?.sourceMessageHash) {
                    errors.push(`request.${collectionName}.${index}.sourceMessageHash-mismatch`);
                }
            }
        }
    }
    return result(errors);
}

export async function validatePresentationAnnotationResponse(response, request) {
    const errors = [];
    assertExactKeys(response, ['schemaVersion', 'results'], 'response', errors);
    if (!isRecord(response)) return result(errors);
    if (response.schemaVersion !== PRESENTATION_ANNOTATION_VERSION) errors.push('response.schemaVersion');
    if (!Array.isArray(response.results) || response.results.length !== request?.messages?.length) {
        errors.push('response.results');
        return result(errors);
    }

    for (let resultIndex = 0; resultIndex < response.results.length; resultIndex += 1) {
        const item = response.results[resultIndex];
        const source = request.messages[resultIndex];
        const prefix = `response.results.${resultIndex}`;
        assertExactKeys(item, [
            'sourceMessageIndex', 'sourceMessageHash', 'segments', 'entities', 'identityLinkCandidates', 'stateClaims',
        ], prefix, errors);
        if (!isRecord(item)) continue;
        if (item.sourceMessageIndex !== source.sourceMessageIndex) errors.push(`${prefix}.sourceMessageIndex`);
        if (item.sourceMessageHash !== source.sourceMessageHash) errors.push(`${prefix}.sourceMessageHash`);

        const text = Array.from(source.visibleText);
        const entities = validateEntities(item.entities, source.visibleText, text.length, prefix, errors);
        const segments = validateSegments(item.segments, source.visibleText, text.length, entities, prefix, errors);
        validateIdentityLinks(item.identityLinkCandidates, entities, request.knownEntities, text.length, prefix, errors);
        validateStateClaims(item.stateClaims, entities, text.length, prefix, errors);
        validateEvidenceSegmentReferences(item, entities, segments, prefix, errors);
        if (segments.length > 0 && segments.at(-1)?.end !== text.length) errors.push(`${prefix}.segments.coverage`);
    }
    if (errors.length) return result(errors);

    for (let index = 0; index < response.results.length; index += 1) {
        const source = request.messages[index];
        const item = response.results[index];
        if (await createVisibleMessageHash(source.visibleText) !== source.sourceMessageHash) errors.push(`response.results.${index}.sourceMessageHash-source-mismatch`);
        for (let segmentIndex = 0; segmentIndex < item.segments.length; segmentIndex += 1) {
            const segment = item.segments[segmentIndex];
            const exactSlice = codePointSlice(source.visibleText, segment.start, segment.end);
            if (await createVisibleMessageHash(exactSlice) !== segment.textHash) errors.push(`response.results.${index}.segments.${segmentIndex}.textHash`);
        }
    }
    return result(errors);
}

function validateRequestMessages(messages, { min, max, maxText, path, player = false, errors }) {
    if (!Array.isArray(messages) || messages.length < min || messages.length > max) {
        errors.push(path);
        return;
    }
    messages.forEach((message, index) => {
        const itemPath = `${path}.${index}`;
        const fields = player
            ? ['sourceMessageIndex', 'sourceMessageHash', 'role', 'authorLabel', 'visibleText']
            : ['sourceMessageIndex', 'sourceMessageHash', 'visibleText'];
        assertExactKeys(message, fields, itemPath, errors);
        if (!Number.isSafeInteger(message?.sourceMessageIndex) || message.sourceMessageIndex < 0) errors.push(`${itemPath}.sourceMessageIndex`);
        if (!HASH_PATTERN.test(String(message?.sourceMessageHash))) errors.push(`${itemPath}.sourceMessageHash`);
        if (player && message?.role !== 'assistant') errors.push(`${itemPath}.role`);
        if (player && !isBoundedString(message?.authorLabel, 0, 160)) errors.push(`${itemPath}.authorLabel`);
        if (!isBoundedString(message?.visibleText, 1, maxText)) errors.push(`${itemPath}.visibleText`);
    });
}

function validateKnownEntity(entity, path, errors) {
    assertExactKeys(entity, ['resolverEntityRef', 'visibleNames', 'evidenceDigest', 'attributes'], path, errors);
    if (!isRecord(entity)) return;
    if (!isBoundedString(entity.resolverEntityRef, 1, 160)) errors.push(`${path}.resolverEntityRef`);
    if (!HASH_PATTERN.test(String(entity.evidenceDigest))) errors.push(`${path}.evidenceDigest`);
    if (!Array.isArray(entity.visibleNames) || entity.visibleNames.length < 1 || entity.visibleNames.length > 8
        || entity.visibleNames.some((name) => !isBoundedString(name, 1, 120))) errors.push(`${path}.visibleNames`);
    if (!Array.isArray(entity.attributes) || entity.attributes.length > 16) {
        errors.push(`${path}.attributes`);
        return;
    }
    entity.attributes.forEach((attribute, index) => {
        const itemPath = `${path}.attributes.${index}`;
        assertExactKeys(attribute, ['category', 'value'], itemPath, errors);
        if (!ATTRIBUTE_CATEGORIES.has(attribute?.category) || !isBoundedString(attribute?.value, 1, 80)) errors.push(itemPath);
    });
}

function validateEntities(entities, visibleText, textLength, path, errors) {
    const refs = new Map();
    if (!Array.isArray(entities) || entities.length > 64) {
        errors.push(`${path}.entities`);
        return refs;
    }
    entities.forEach((entity, index) => {
        const itemPath = `${path}.entities.${index}`;
        assertExactKeys(entity, ['mentionRef', 'surfaceSpan', 'kind', 'attributeEvidence'], itemPath, errors);
        if (!isRecord(entity)) return;
        if (!/^m(?:[0-9]|[1-5][0-9]|6[0-3])$/u.test(String(entity.mentionRef)) || refs.has(entity.mentionRef)) errors.push(`${itemPath}.mentionRef`);
        if (!ENTITY_KINDS.has(entity.kind)) errors.push(`${itemPath}.kind`);
        validateSpan(entity.surfaceSpan, textLength, `${itemPath}.surfaceSpan`, errors);
        if (!Array.isArray(entity.attributeEvidence) || entity.attributeEvidence.length > 16) {
            errors.push(`${itemPath}.attributeEvidence`);
        } else {
            entity.attributeEvidence.forEach((attribute, attributeIndex) => {
                const attributePath = `${itemPath}.attributeEvidence.${attributeIndex}`;
                assertExactKeys(attribute, ['category', 'value', 'span'], attributePath, errors);
                if (!ATTRIBUTE_CATEGORIES.has(attribute?.category) || !isBoundedString(attribute?.value, 1, 80)) errors.push(attributePath);
                validateSpan(attribute?.span, textLength, `${attributePath}.span`, errors);
                if (Number.isSafeInteger(attribute?.span?.start) && Number.isSafeInteger(attribute?.span?.end)) {
                    const evidenceText = codePointSlice(visibleText, attribute.span.start, attribute.span.end).toLocaleLowerCase();
                    if (!evidenceText.includes(String(attribute?.value || '').toLocaleLowerCase())) errors.push(`${attributePath}.value-not-in-evidence`);
                }
            });
        }
        refs.set(entity.mentionRef, entity);
    });
    return refs;
}

function validateSegments(segments, visibleText, textLength, entities, path, errors) {
    if (!Array.isArray(segments) || segments.length < 1 || segments.length > 256) {
        errors.push(`${path}.segments`);
        return [];
    }
    let cursor = 0;
    segments.forEach((segment, index) => {
        const itemPath = `${path}.segments.${index}`;
        assertExactKeys(segment, [
            'start', 'end', 'textHash', 'kind', 'speakerMentionRef', 'speakerSource', 'confidenceBand', 'evidenceSpans',
        ], itemPath, errors);
        if (!isRecord(segment)) return;
        if (!Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end)
            || segment.start !== cursor || segment.end <= segment.start || segment.end > textLength) {
            errors.push(`${itemPath}.range-or-coverage`);
        } else {
            cursor = segment.end;
        }
        if (!HASH_PATTERN.test(String(segment.textHash))) errors.push(`${itemPath}.textHash`);
        if (!ANNOTATION_KINDS.has(segment.kind)) errors.push(`${itemPath}.kind`);
        if (segment.speakerMentionRef !== null && typeof segment.speakerMentionRef !== 'string') errors.push(`${itemPath}.speakerMentionRef`);
        if (!SPEAKER_SOURCES.has(segment.speakerSource)) errors.push(`${itemPath}.speakerSource`);
        if (!CONFIDENCE_BANDS.has(segment.confidenceBand)) errors.push(`${itemPath}.confidenceBand`);
        if (!Array.isArray(segment.evidenceSpans) || segment.evidenceSpans.length > 8) {
            errors.push(`${itemPath}.evidenceSpans`);
        } else {
            segment.evidenceSpans.forEach((evidence, evidenceIndex) => {
                const evidencePath = `${itemPath}.evidenceSpans.${evidenceIndex}`;
                assertExactKeys(evidence, ['start', 'end', 'purpose'], evidencePath, errors);
                validateSpan(evidence, textLength, evidencePath, errors, ['purpose']);
                if (!EVIDENCE_PURPOSES.has(evidence?.purpose)) errors.push(`${evidencePath}.purpose`);
                if (Number.isSafeInteger(evidence?.start) && Number.isSafeInteger(evidence?.end)
                    && evidence?.purpose !== 'speaker'
                    && (evidence.start < segment.start || evidence.end > segment.end)) errors.push(`${evidencePath}.outside-segment`);
            });
        }
        const mention = segment.speakerMentionRef === null ? null : entities.get(segment.speakerMentionRef);
        if (segment.speakerMentionRef !== null && (!mention || mention.kind !== 'person')) errors.push(`${itemPath}.speaker-ref`);
        const speakerEvidence = segment.evidenceSpans?.some((evidence) => evidence?.purpose === 'speaker');
        if (segment.kind === 'dialogue'
            && (!mention || !['text-explicit', 'quoted-attribution'].includes(segment.speakerSource) || !speakerEvidence)) errors.push(`${itemPath}.dialogue-speaker`);
        if (segment.kind === 'unattributed-dialogue'
            && (segment.speakerMentionRef !== null || segment.speakerSource !== 'none')) errors.push(`${itemPath}.unattributed-speaker`);
        if (segment.kind === 'narration'
            && (segment.speakerMentionRef !== null || segment.speakerSource !== 'none')) errors.push(`${itemPath}.narration-speaker`);
        if (!['dialogue'].includes(segment.kind)
            && !['unattributed-dialogue', 'narration'].includes(segment.kind)
            && (segment.speakerMentionRef !== null || segment.speakerSource !== 'none')) errors.push(`${itemPath}.non-dialogue-speaker`);
        if (segment.kind === 'dialogue' && mention && speakerEvidence) {
            const spans = segment.evidenceSpans.filter((evidence) => evidence.purpose === 'speaker');
            if (!spans.some((span) => span.start <= mention.surfaceSpan.start && span.end >= mention.surfaceSpan.end)) {
                errors.push(`${itemPath}.speaker-evidence-does-not-cover-mention`);
            }
        }
        if (Number.isSafeInteger(segment.start) && Number.isSafeInteger(segment.end) && segment.end <= textLength) {
            const exact = codePointSlice(visibleText, segment.start, segment.end);
            if (!exact) errors.push(`${itemPath}.empty-text`);
        }
    });
    if (cursor !== textLength) errors.push(`${path}.segments.coverage`);
    return segments;
}

function validateIdentityLinks(links, entities, knownEntities, textLength, path, errors) {
    if (!Array.isArray(links) || links.length > 64) {
        errors.push(`${path}.identityLinkCandidates`);
        return;
    }
    const knownRefs = new Set((knownEntities || []).map((entity) => entity.resolverEntityRef));
    links.forEach((link, index) => {
        const itemPath = `${path}.identityLinkCandidates.${index}`;
        assertExactKeys(link, ['fromMentionRef', 'toResolverEntityRef', 'relation', 'evidenceSpans', 'confidenceBand'], itemPath, errors);
        if (!isRecord(link)) return;
        if (entities.get(link.fromMentionRef)?.kind !== 'person') errors.push(`${itemPath}.fromMentionRef`);
        if (!knownRefs.has(link.toResolverEntityRef)) errors.push(`${itemPath}.toResolverEntityRef`);
        if (!LINK_RELATIONS.has(link.relation) || !CONFIDENCE_BANDS.has(link.confidenceBand)) errors.push(itemPath);
        if (!Array.isArray(link.evidenceSpans) || link.evidenceSpans.length < 1 || link.evidenceSpans.length > 4) {
            errors.push(`${itemPath}.evidenceSpans`);
        } else {
            link.evidenceSpans.forEach((span, spanIndex) => {
                const spanPath = `${itemPath}.evidenceSpans.${spanIndex}`;
                validateSpan(span, textLength, spanPath, errors, ['purpose']);
                if (span?.purpose !== 'coreference') errors.push(`${spanPath}.purpose`);
            });
            const mention = entities.get(link.fromMentionRef);
            if (mention && !link.evidenceSpans.some((span) => span.start <= mention.surfaceSpan.start && span.end >= mention.surfaceSpan.end)) {
                errors.push(`${itemPath}.evidence-does-not-cover-mention`);
            }
        }
    });
}

function validateStateClaims(claims, entities, textLength, path, errors) {
    if (!Array.isArray(claims) || claims.length > 64) {
        errors.push(`${path}.stateClaims`);
        return;
    }
    claims.forEach((claim, index) => {
        const itemPath = `${path}.stateClaims.${index}`;
        assertExactKeys(claim, [
            'claimType', 'targetMentionRef', 'memberMentionRefs', 'rosterSnapshotCompleteness', 'evidenceSpans', 'confidenceBand',
        ], itemPath, errors);
        if (!isRecord(claim)) return;
        if (!CLAIM_TYPES.has(claim.claimType) || !CONFIDENCE_BANDS.has(claim.confidenceBand)) errors.push(itemPath);
        if (!Array.isArray(claim.memberMentionRefs) || claim.memberMentionRefs.length > 32) errors.push(`${itemPath}.memberMentionRefs`);
        const members = Array.isArray(claim.memberMentionRefs) ? claim.memberMentionRefs : [];
        if (new Set(members).size !== members.length) errors.push(`${itemPath}.memberMentionRefs.duplicate`);
        if (members.some((ref) => entities.get(ref)?.kind !== 'person')) errors.push(`${itemPath}.memberMentionRefs.ref`);
        if (!Array.isArray(claim.evidenceSpans) || claim.evidenceSpans.length < 1 || claim.evidenceSpans.length > 32) {
            errors.push(`${itemPath}.evidenceSpans`);
        } else {
            claim.evidenceSpans.forEach((span, spanIndex) => {
                const spanPath = `${itemPath}.evidenceSpans.${spanIndex}`;
                validateSpan(span, textLength, spanPath, errors, ['purpose']);
                if (span?.purpose !== 'state') errors.push(`${spanPath}.purpose`);
            });
        }
        if (claim.claimType === 'party.join' || claim.claimType === 'party.leave') {
            if (entities.get(claim.targetMentionRef)?.kind !== 'person' || members.length !== 0 || claim.rosterSnapshotCompleteness !== null) errors.push(`${itemPath}.join-leave-shape`);
            const target = entities.get(claim.targetMentionRef);
            if (target && Array.isArray(claim.evidenceSpans) && !claim.evidenceSpans.some((span) => span.start <= target.surfaceSpan.start && span.end >= target.surfaceSpan.end)) {
                errors.push(`${itemPath}.target-evidence`);
            }
        } else if (claim.claimType === 'party.snapshot') {
            if (claim.targetMentionRef !== null || !SNAPSHOT_COMPLETENESS.has(claim.rosterSnapshotCompleteness)) errors.push(`${itemPath}.snapshot-shape`);
            if (members.some((ref) => !claim.evidenceSpans.some((span) => {
                const entity = entities.get(ref);
                return span.start <= entity.surfaceSpan.start && span.end >= entity.surfaceSpan.end;
            }))) errors.push(`${itemPath}.snapshot-member-evidence`);
            const memberOffsets = members.map((ref) => entities.get(ref)?.surfaceSpan.start ?? Number.MAX_SAFE_INTEGER);
            if (!isNondecreasing(memberOffsets)) errors.push(`${itemPath}.memberMentionRefs.order`);
        } else if (claim.claimType === 'unresolved') {
            if (claim.targetMentionRef !== null || members.length !== 0 || claim.rosterSnapshotCompleteness !== null) errors.push(`${itemPath}.unresolved-shape`);
        }
    });
}

function validateEvidenceSegmentReferences(resultItem, entities, segments, path, errors) {
    const isInsideSegment = (span) => segments.some((segment) => segment.start <= span.start && segment.end >= span.end);
    for (const [entityIndex, entity] of [...entities.values()].entries()) {
        if (!isInsideSegment(entity.surfaceSpan)) errors.push(`${path}.entities.${entityIndex}.outside-segments`);
        for (const attribute of entity.attributeEvidence || []) {
            if (!isInsideSegment(attribute.span)) errors.push(`${path}.entities.${entityIndex}.attribute-outside-segments`);
        }
    }
    for (const [linkIndex, link] of (resultItem.identityLinkCandidates || []).entries()) {
        for (const [spanIndex, span] of (link.evidenceSpans || []).entries()) {
            if (!isInsideSegment(span)) errors.push(`${path}.identityLinkCandidates.${linkIndex}.evidenceSpans.${spanIndex}.outside-segments`);
        }
    }
    for (const [claimIndex, claim] of (resultItem.stateClaims || []).entries()) {
        for (const [spanIndex, span] of (claim.evidenceSpans || []).entries()) {
            if (!isInsideSegment(span)) errors.push(`${path}.stateClaims.${claimIndex}.evidenceSpans.${spanIndex}.outside-segments`);
        }
    }
}

function validateSpan(span, textLength, path, errors, extraKeys = []) {
    assertExactKeys(span, ['start', 'end', ...extraKeys], path, errors);
    if (!isRecord(span) || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
        || span.start < 0 || span.end <= span.start || span.end > textLength) errors.push(`${path}.range`);
}

function assertExactKeys(value, keys, path, errors) {
    if (!isRecord(value)) {
        errors.push(`${path}.object`);
        return;
    }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) errors.push(`${path}.keys`);
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isBoundedString(value, min, max) {
    return typeof value === 'string' && codePointLength(value) >= min && codePointLength(value) <= max;
}

function isStrictlyIncreasing(values) {
    return values.every((value, index) => Number.isSafeInteger(value) && (index === 0 || value > values[index - 1]));
}

function isNondecreasing(values) {
    return values.every((value, index) => Number.isSafeInteger(value) && (index === 0 || value >= values[index - 1]));
}

function BufferOrTextEncoderByteLength(value) {
    return new TextEncoder().encode(value).byteLength;
}

function result(errors) {
    return { valid: errors.length === 0, errors };
}
