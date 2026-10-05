import {
    PRESENTATION_IDENTITY_PROJECTION_VERSION,
    PRESENTATION_ROSTER_PROJECTION_VERSION,
    sha256Hex,
} from './presentation-annotation.js?v=auto-e34cf3849e79';

const UNKNOWN = Object.freeze({ type: 'unknown' });
const SCENE_CONTINUITY_VERSION = 'galgame.scene-continuity.v1';
const SCENE_CONTINUITY_SCOPE_KEYS = Object.freeze(['chatId', 'releaseId', 'arcId', 'catalogId', 'catalogRevision', 'catalogHash']);
const SCENE_CONTINUITY_RELATIONS = new Set(['current-location', 'referenced-location', 'transition-action']);

export function normalizeIdentitySurface(value) {
    return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
}

/**
 * Builds the versioned envelope from a trusted classifier's explicit semantic
 * claims. This helper hashes the exact visible page; it does not infer scenes
 * from prose or turn a location mention into a transition by itself.
 */
export async function createSceneContinuityProjection({
    scope, messageId, pageIndex, pageText, state, sceneEntityKeys = [], currentSceneKey = null,
    evidenceSpans = [],
} = {}) {
    const projection = {
        schemaVersion: SCENE_CONTINUITY_VERSION,
        scope: cloneSceneScope(scope),
        segment: {
            messageId,
            pageIndex,
            pageTextSha256: `sha256:${await sha256Hex(String(pageText ?? ''))}`,
        },
        state,
        sceneEntityKeys: [...sceneEntityKeys],
        currentSceneKey,
        evidenceSpans: evidenceSpans.map((span) => ({ ...span })),
    };
    return projection;
}

/**
 * Validates a scene-continuity claim against exact page text, current runtime
 * scope, and the caller's previously verified scene. Invalid same-scope input
 * is unknown/preserve; a runtime scope change always invalidates first.
 */
export async function consumeSceneContinuityProjection({
    pageText, projection, expectedScope, previousScope = null, previousVerifiedSceneKey = null,
} = {}) {
    if (!isSceneScope(expectedScope)) return unknownSceneContinuity(previousVerifiedSceneKey, 'scope-invalid');
    if (previousScope && !sameSceneScope(previousScope, expectedScope)) {
        return { state: 'scope-changed', action: 'reset-to-default', sceneKey: null, reasonCode: 'scope-changed' };
    }
    try {
        if (!isSceneScope(projection?.scope) || !sameSceneScope(projection.scope, expectedScope)) {
            return unknownSceneContinuity(previousVerifiedSceneKey, 'projection-scope-mismatch');
        }
        if (!isExactObject(projection, ['schemaVersion', 'scope', 'segment', 'state', 'sceneEntityKeys', 'currentSceneKey', 'evidenceSpans'])
            || projection.schemaVersion !== SCENE_CONTINUITY_VERSION
            || !isExactObject(projection.segment, ['messageId', 'pageIndex', 'pageTextSha256'])
            || typeof projection.segment.messageId !== 'string' || !projection.segment.messageId
            || !Number.isSafeInteger(projection.segment.pageIndex) || projection.segment.pageIndex < 0
            || !Array.isArray(projection.sceneEntityKeys)
            || projection.sceneEntityKeys.some((key) => typeof key !== 'string' || !key)
            || new Set(projection.sceneEntityKeys).size !== projection.sceneEntityKeys.length
            || !(projection.currentSceneKey === null || (typeof projection.currentSceneKey === 'string' && projection.currentSceneKey))
            || !Array.isArray(projection.evidenceSpans)) {
            return unknownSceneContinuity(previousVerifiedSceneKey, 'projection-schema-invalid');
        }
        const exactPageText = String(pageText ?? '');
        const expectedHash = `sha256:${await sha256Hex(exactPageText)}`;
        if (projection.segment.pageTextSha256 !== expectedHash) {
            return unknownSceneContinuity(previousVerifiedSceneKey, 'page-hash-mismatch');
        }
        for (const span of projection.evidenceSpans) {
            if (!isExactObject(span, ['start', 'end', 'relation', 'sceneEntityKey', 'destinationSceneKey'])
                || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
                || span.start < 0 || span.end <= span.start || span.end > exactPageText.length
                || !SCENE_CONTINUITY_RELATIONS.has(span.relation)
                || !(span.sceneEntityKey === null || (typeof span.sceneEntityKey === 'string' && span.sceneEntityKey))
                || !(span.destinationSceneKey === null || (typeof span.destinationSceneKey === 'string' && span.destinationSceneKey))) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'evidence-span-invalid');
            }
            if (splitsSurrogatePair(exactPageText, span.start) || splitsSurrogatePair(exactPageText, span.end)) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'evidence-span-splits-surrogate');
            }
            if (span.relation === 'transition-action') {
                if (span.sceneEntityKey !== null || !span.destinationSceneKey) {
                    return unknownSceneContinuity(previousVerifiedSceneKey, 'transition-evidence-invalid');
                }
            } else if (span.destinationSceneKey !== null || !span.sceneEntityKey) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'location-evidence-invalid');
            }
            if (span.sceneEntityKey && !projection.sceneEntityKeys.includes(span.sceneEntityKey)) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'scene-entity-unlisted');
            }
        }
        if (projection.state === 'unknown') return unknownSceneContinuity(previousVerifiedSceneKey, null);
        if (projection.state === 'continued') {
            const hasCurrentEvidence = projection.evidenceSpans.some((span) => (
                span.relation === 'current-location' && span.sceneEntityKey === projection.currentSceneKey
            ));
            if (!previousVerifiedSceneKey || projection.currentSceneKey !== previousVerifiedSceneKey || !hasCurrentEvidence
                || projection.evidenceSpans.some((span) => span.relation === 'transition-action')) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'continued-state-invalid');
            }
            return { state: 'continued', action: 'preserve', sceneKey: previousVerifiedSceneKey, reasonCode: null };
        }
        if (projection.state === 'changed') {
            const destination = projection.currentSceneKey;
            const transition = projection.evidenceSpans.some((span) => (
                span.relation === 'transition-action' && span.destinationSceneKey === destination
            ));
            const currentLocation = projection.evidenceSpans.some((span) => (
                span.relation === 'current-location' && span.sceneEntityKey === destination
            ));
            if (!destination || !transition || !currentLocation || destination === previousVerifiedSceneKey) {
                return unknownSceneContinuity(previousVerifiedSceneKey, 'changed-state-invalid');
            }
            return { state: 'changed', action: 'clear-before-match', sceneKey: destination, reasonCode: null };
        }
        return unknownSceneContinuity(previousVerifiedSceneKey, 'state-invalid');
    } catch {
        return unknownSceneContinuity(previousVerifiedSceneKey, 'projection-invalid');
    }
}

function cloneSceneScope(scope) {
    if (!isSceneScope(scope)) throw new TypeError('scene continuity scope is invalid');
    return Object.fromEntries(SCENE_CONTINUITY_SCOPE_KEYS.map((key) => [key, scope[key]]));
}

function isSceneScope(scope) {
    return isExactObject(scope, SCENE_CONTINUITY_SCOPE_KEYS)
        && typeof scope.chatId === 'string' && scope.chatId.length > 0
        && typeof scope.releaseId === 'string' && scope.releaseId.length > 0
        && (scope.arcId === null || (typeof scope.arcId === 'string' && scope.arcId.length > 0))
        && typeof scope.catalogId === 'string' && scope.catalogId.length > 0
        && Number.isSafeInteger(scope.catalogRevision) && scope.catalogRevision > 0
        && typeof scope.catalogHash === 'string' && /^sha256:[a-f0-9]{64}$/u.test(scope.catalogHash);
}

function sameSceneScope(left, right) {
    return isSceneScope(left) && isSceneScope(right)
        && SCENE_CONTINUITY_SCOPE_KEYS.every((key) => left[key] === right[key]);
}

function isExactObject(value, keys) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
        && Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}

function splitsSurrogatePair(value, offset) {
    if (offset <= 0 || offset >= value.length) return false;
    const before = value.charCodeAt(offset - 1);
    const after = value.charCodeAt(offset);
    return before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF;
}

function unknownSceneContinuity(previousVerifiedSceneKey, reasonCode) {
    return { state: 'unknown', action: 'preserve', sceneKey: previousVerifiedSceneKey || null, reasonCode };
}

/**
 * Resolves only exact published aliases and unambiguous, normalized chat-local
 * names. Model-proposed coreference candidates are deliberately diagnostic-only.
 */
export async function projectPresentationIdentity(options = {}) {
    return (await projectPresentationIdentityDetailed(options)).projection;
}

export async function projectPresentationIdentityDetailed({ chatKey, releaseId, messages, publishedCast = [] } = {}) {
    if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
    const timeline = [...messages].sort((a, b) => a.sourceMessageIndex - b.sourceMessageIndex);
    const publishedAliasIndex = buildPublishedAliasIndex(publishedCast);
    const mentions = [];
    const nameGroups = new Map();

    for (const message of timeline) {
        const annotation = message.annotation;
        if (!message.sourceMessageHash || annotation?.sourceMessageHash !== message.sourceMessageHash) continue;
        const entities = new Map((annotation?.entities || []).map((entity) => [entity.mentionRef, entity]));
        const perMessageNames = new Map();
        for (const entity of entities.values()) {
            if (entity.kind !== 'person') continue;
            const surface = sliceCodePoints(message.visibleText, entity.surfaceSpan.start, entity.surfaceSpan.end);
            const normalized = normalizeIdentitySurface(surface);
            if (!normalized) continue;
            const attributes = (entity.attributeEvidence || []).map(({ category, value }) => ({ category, value: normalizeIdentitySurface(value) }));
            const mention = { message, entity, surface, normalized, attributes };
            mentions.push(mention);
            const group = nameGroups.get(normalized) || { mentions: [], ambiguous: false, attributeValues: new Map() };
            group.mentions.push(mention);
            for (const attribute of attributes) {
                const values = group.attributeValues.get(attribute.category) || new Set();
                values.add(attribute.value);
                group.attributeValues.set(attribute.category, values);
            }
            nameGroups.set(normalized, group);
            const refs = perMessageNames.get(normalized) || new Set();
            refs.add(entity.mentionRef);
            perMessageNames.set(normalized, refs);
        }
        for (const [normalized, refs] of perMessageNames) {
            if (refs.size > 1) nameGroups.get(normalized).ambiguous = true;
        }
    }

    for (const group of nameGroups.values()) {
        if ([...group.attributeValues.values()].some((values) => values.size > 1)) group.ambiguous = true;
    }

    const mentionIdentity = new Map();
    const identities = new Map();
    for (const mention of mentions) {
        const publishedMatches = publishedAliasIndex.get(mention.surface) || [];
        let identityRef;
        let identityKind;
        if (publishedMatches.length === 1) {
            identityRef = { type: 'published', id: publishedMatches[0].id };
            identityKind = 'published';
        } else if (publishedMatches.length > 1) {
            identityRef = UNKNOWN;
            identityKind = 'unknown';
        } else if (!nameGroups.get(mention.normalized)?.ambiguous) {
            const first = nameGroups.get(mention.normalized).mentions[0];
            const id = `cl_${(await sha256Hex(JSON.stringify([
                chatKey, releaseId, first.message.sourceMessageHash,
                first.entity.surfaceSpan.start, first.entity.surfaceSpan.end, first.normalized,
            ]))).slice(0, 24)}`;
            identityRef = { type: 'chat-local', id };
            identityKind = 'chat-local';
        } else {
            const id = `cl_${(await sha256Hex(JSON.stringify([
                chatKey, releaseId, mention.message.sourceMessageHash,
                mention.entity.surfaceSpan.start, mention.entity.surfaceSpan.end, mention.normalized,
            ]))).slice(0, 24)}`;
            identityRef = { type: 'chat-local', id };
            identityKind = 'chat-local';
        }
        mentionIdentity.set(`${mention.message.sourceMessageIndex}:${mention.entity.mentionRef}`, identityRef);
        if (identityRef.type === 'unknown') continue;
        const key = `${identityRef.type}:${identityRef.id}`;
        let projected = identities.get(key);
        if (!projected) {
            projected = {
                identityRef,
                kind: identityKind,
                firstMention: {
                    sourceMessageIndex: mention.message.sourceMessageIndex,
                    sourceMessageHash: mention.message.sourceMessageHash,
                    start: mention.entity.surfaceSpan.start,
                    end: mention.entity.surfaceSpan.end,
                },
                aliases: [],
                attributes: [],
            };
            identities.set(key, projected);
        }
        projected.aliases.push({
            value: mention.surface,
            sourceMessageIndex: mention.message.sourceMessageIndex,
            sourceMessageHash: mention.message.sourceMessageHash,
            start: mention.entity.surfaceSpan.start,
            end: mention.entity.surfaceSpan.end,
        });
        for (const attribute of mention.attributes) {
            projected.attributes.push({
                category: attribute.category,
                value: attribute.value,
                sourceMessageIndex: mention.message.sourceMessageIndex,
                sourceMessageHash: mention.message.sourceMessageHash,
                start: mention.entity.attributeEvidence.find((item) => item.category === attribute.category && normalizeIdentitySurface(item.value) === attribute.value)?.span.start ?? mention.entity.surfaceSpan.start,
                end: mention.entity.attributeEvidence.find((item) => item.category === attribute.category && normalizeIdentitySurface(item.value) === attribute.value)?.span.end ?? mention.entity.surfaceSpan.end,
            });
        }
    }

    const segmentSpeakers = [];
    for (const message of timeline) {
        if (!message.sourceMessageHash || message.annotation?.sourceMessageHash !== message.sourceMessageHash) continue;
        for (const [segmentIndex, segment] of (message.annotation?.segments || []).entries()) {
            const identityRef = segment.kind === 'narration'
                || !['dialogue', 'unattributed-dialogue'].includes(segment.kind)
                ? null
                : segment.speakerMentionRef === null
                    ? UNKNOWN
                    : mentionIdentity.get(`${message.sourceMessageIndex}:${segment.speakerMentionRef}`) || UNKNOWN;
            segmentSpeakers.push({
                sourceMessageIndex: message.sourceMessageIndex,
                sourceMessageHash: message.sourceMessageHash,
                segmentIndex,
                resolvedSpeakerRef: identityRef,
            });
        }
    }

    return {
        projection: {
            schemaVersion: PRESENTATION_IDENTITY_PROJECTION_VERSION,
            chatKey,
            releaseId,
            sourceThroughMessageIndex: timeline.at(-1)?.sourceMessageIndex ?? -1,
            complete: timeline.every((message) => Boolean(message.sourceMessageHash && message.annotation?.sourceMessageHash === message.sourceMessageHash)),
            entities: [...identities.values()].sort(compareFirstMention),
            segmentSpeakers,
        },
        mentionIdentity,
    };
}

/** Pure chronological roster reducer over verified annotation messages. */
export function projectPartyRoster({ chatKey, releaseId, messages, identityProjection } = {}) {
    if (!Array.isArray(messages)) throw new TypeError('messages must be an array');
    const timeline = [...messages].sort((a, b) => a.sourceMessageIndex - b.sourceMessageIndex);
    const states = new Map();
    const conflicts = new Map();
    let complete = true;

    const mentionIdentity = identityProjection?.mentionIdentity;
    const setState = (identityRef, membership, evidence) => {
        if (!identityRef || identityRef.type === 'unknown') return;
        const key = `${identityRef.type}:${identityRef.id}`;
        states.set(key, { identityRef, membership, evidence: [...(states.get(key)?.evidence || []), evidence] });
    };

    for (const message of timeline) {
        const annotation = message.annotation;
        if (!message.sourceMessageHash || !annotation) {
            complete = false;
            continue;
        }
        if (annotation.sourceMessageHash !== message.sourceMessageHash) {
            complete = false;
            continue;
        }
        const messageClaims = new Map();
        const mentionByRef = new Map((annotation.entities || []).map((entity) => [entity.mentionRef, entity]));
        const toIdentity = (ref) => {
            const entity = mentionByRef.get(ref);
            if (!entity || entity.kind !== 'person') return UNKNOWN;
            return mentionIdentity?.get(`${message.sourceMessageIndex}:${ref}`) || UNKNOWN;
        };
        for (const entity of mentionByRef.values()) {
            if (entity.kind !== 'person') continue;
            const identityRef = toIdentity(entity.mentionRef);
            const key = identityKey(identityRef);
            if (key && !states.has(key)) states.set(key, { identityRef, membership: 'unknown', evidence: [] });
        }
        for (const claim of annotation.stateClaims || []) {
            if (claim.claimType === 'unresolved') continue;
            const evidenceSpan = claim.evidenceSpans?.[0];
            const evidence = evidenceSpan ? {
                sourceMessageIndex: message.sourceMessageIndex,
                sourceMessageHash: message.sourceMessageHash,
                start: evidenceSpan.start,
                end: evidenceSpan.end,
                claimType: claim.claimType,
            } : null;
            if (!evidence) continue;
            const mentionEvidence = (mentionRef, fallback) => {
                const mention = mentionByRef.get(mentionRef);
                if (!mention?.surfaceSpan) return fallback;
                const supportingSpan = (claim.evidenceSpans || [])
                    .filter((span) => span.start <= mention.surfaceSpan.start && span.end >= mention.surfaceSpan.end)
                    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
                return supportingSpan ? { ...fallback, start: supportingSpan.start, end: supportingSpan.end } : fallback;
            };
            const target = claim.targetMentionRef === null ? null : toIdentity(claim.targetMentionRef);
            const events = [];
            if (claim.claimType === 'party.join' || claim.claimType === 'party.leave') {
                events.push({ identityRef: target, membership: claim.claimType === 'party.join' ? 'member' : 'not-member', evidence: mentionEvidence(claim.targetMentionRef, evidence) });
            } else if (claim.claimType === 'party.snapshot') {
                const members = new Set(claim.memberMentionRefs.map((ref) => identityKey(toIdentity(ref))).filter(Boolean));
                if (claim.rosterSnapshotCompleteness === 'complete') {
                    for (const [key, state] of states) {
                        if (!members.has(key)) events.push({ identityRef: state.identityRef, membership: 'not-member', evidence });
                    }
                }
                for (const ref of claim.memberMentionRefs) events.push({ identityRef: toIdentity(ref), membership: 'member', evidence: mentionEvidence(ref, evidence) });
            }
            for (const event of events) {
                if (!event.identityRef || event.identityRef.type === 'unknown') continue;
                const key = identityKey(event.identityRef);
                const claims = messageClaims.get(key) || [];
                claims.push(event);
                messageClaims.set(key, claims);
            }
        }
        for (const [key, events] of messageClaims) {
            const membershipKinds = new Set(events.map((event) => event.membership));
            if (membershipKinds.size > 1) {
                states.set(key, { identityRef: events[0].identityRef, membership: 'unknown', evidence: [...(states.get(key)?.evidence || []), ...events.map((event) => event.evidence)] });
                const indices = conflicts.get(key) || new Set();
                indices.add(message.sourceMessageIndex);
                conflicts.set(key, indices);
            } else {
                for (const event of events) setState(event.identityRef, event.membership, event.evidence);
            }
        }
    }

    const through = timeline.at(-1)?.sourceMessageIndex ?? -1;
    const entries = [...states.values()].map((state) => ({
        identityRef: state.identityRef,
        membership: state.membership,
        evidence: state.evidence,
    })).sort((a, b) => {
        const ai = a.evidence.find((item) => item.claimType === 'party.join')?.sourceMessageIndex ?? Number.MAX_SAFE_INTEGER;
        const bi = b.evidence.find((item) => item.claimType === 'party.join')?.sourceMessageIndex ?? Number.MAX_SAFE_INTEGER;
        return ai - bi || identityKey(a.identityRef).localeCompare(identityKey(b.identityRef));
    });
    return {
        schemaVersion: PRESENTATION_ROSTER_PROJECTION_VERSION,
        chatKey,
        releaseId,
        sourceThroughMessageIndex: through,
        complete,
        entries,
        conflicts: [...conflicts.entries()].map(([key, indices]) => ({
            identityRef: states.get(key)?.identityRef || UNKNOWN,
            sourceMessageIndices: [...indices].sort((a, b) => a - b),
        })).sort((a, b) => identityKey(a.identityRef).localeCompare(identityKey(b.identityRef))),
    };
}

export function allocateUniqueAssets(bindings = [], candidates = []) {
    const reserved = new Set(bindings.map((binding) => binding.assetId).filter(Boolean));
    const identities = new Set(bindings.map((binding) => identityKey(binding.identityRef)).filter(Boolean));
    const result = [...bindings];
    const orderedCandidates = [...candidates].sort((a, b) => (a.firstMention?.sourceMessageIndex ?? Number.MAX_SAFE_INTEGER) - (b.firstMention?.sourceMessageIndex ?? Number.MAX_SAFE_INTEGER)
        || (a.firstMention?.start ?? Number.MAX_SAFE_INTEGER) - (b.firstMention?.start ?? Number.MAX_SAFE_INTEGER)
        || identityKey(a.identityRef).localeCompare(identityKey(b.identityRef)));
    for (const candidate of orderedCandidates) {
        const candidateIdentityKey = identityKey(candidate.identityRef);
        if (!candidateIdentityKey || candidate.identityRef.type === 'unknown' || !candidate.assetId
            || reserved.has(candidate.assetId) || identities.has(candidateIdentityKey)) continue;
        if (!(candidate.confidence >= candidate.minimumConfidence && candidate.margin >= candidate.minimumMargin)) continue;
        reserved.add(candidate.assetId);
        identities.add(candidateIdentityKey);
        result.push({ identityRef: candidate.identityRef, assetId: candidate.assetId });
    }
    return result;
}

export function bindUniquePresentationAsset(bindings = [], identityKey, assetKey) {
    if (typeof identityKey !== 'string' || !identityKey || typeof assetKey !== 'string' || !assetKey) {
        return { accepted: false, bindings };
    }
    const existingIdentity = bindings.find((binding) => binding.identityKey === identityKey);
    if (existingIdentity) {
        return { accepted: existingIdentity.assetKey === assetKey, bindings };
    }
    if (bindings.some((binding) => binding.assetKey === assetKey)) return { accepted: false, bindings };
    return { accepted: true, bindings: [...bindings, { identityKey, assetKey }] };
}

export function reservePersistentPresentationAsset({ storage, storageKey, scope, identityKey, assetKey, invalidatedAssetKeys = [] } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
        || typeof storageKey !== 'string' || !storageKey || typeof scope !== 'string' || !scope) {
        return { accepted: false, reason: 'storage-unavailable', bindings: [] };
    }
    if (!Array.isArray(invalidatedAssetKeys) || invalidatedAssetKeys.some((key) => typeof key !== 'string' || !key)) {
        return { accepted: false, reason: 'invalid-invalidation-list', bindings: [] };
    }
    let stored;
    try {
        stored = JSON.parse(storage.getItem(storageKey) || '{}');
    } catch (error) {
        return {
            accepted: false,
            reason: error instanceof SyntaxError ? 'ledger-invalid' : 'storage-unavailable',
            bindings: [],
        };
    }
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
        return { accepted: false, reason: 'ledger-invalid', bindings: [] };
    }
    const originalBindings = Object.hasOwn(stored, scope) ? stored[scope] : [];
    if (!Array.isArray(originalBindings) || originalBindings.some((item) => (
        !item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).sort().join(',') !== 'assetKey,identityKey'
        || typeof item.identityKey !== 'string' || !item.identityKey
        || typeof item.assetKey !== 'string' || !item.assetKey
    ))) {
        return { accepted: false, reason: 'ledger-invalid', bindings: [] };
    }
    if (new Set(originalBindings.map((item) => item.identityKey)).size !== originalBindings.length
        || new Set(originalBindings.map((item) => item.assetKey)).size !== originalBindings.length) {
        return { accepted: false, reason: 'ledger-invalid', bindings: [] };
    }
    const invalidated = new Set(invalidatedAssetKeys);
    const bindings = originalBindings.filter((item) => !invalidated.has(item.assetKey));
    if (invalidated.has(assetKey)) {
        if (bindings.length !== originalBindings.length) {
            stored[scope] = bindings;
            try {
                storage.setItem(storageKey, JSON.stringify(stored));
            } catch {
                return { accepted: false, reason: 'storage-unavailable', bindings: originalBindings };
            }
        }
        return { accepted: false, reason: 'asset-ineligible', bindings };
    }
    const result = bindUniquePresentationAsset(bindings, identityKey, assetKey);
    if (!result.accepted) {
        if (bindings.length !== originalBindings.length) {
            stored[scope] = bindings;
            try {
                storage.setItem(storageKey, JSON.stringify(stored));
            } catch {
                return { accepted: false, reason: 'storage-unavailable', bindings: originalBindings };
            }
        }
        return { accepted: false, reason: 'binding-conflict', bindings };
    }
    if (result.bindings !== bindings || bindings.length !== originalBindings.length) {
        stored[scope] = result.bindings;
        try {
            storage.setItem(storageKey, JSON.stringify(stored));
        } catch {
            return { accepted: false, reason: 'storage-unavailable', bindings };
        }
    }
    return {
        accepted: true,
        reason: null,
        bindings: result.bindings,
        removedInvalidatedBindings: originalBindings.length - bindings.length,
    };
}

export function presentationPortraitScopeKey({ chatId, releaseId } = {}) {
    if (!chatId || !releaseId) return '';
    return JSON.stringify([String(chatId), String(releaseId)]);
}

function buildPublishedAliasIndex(cast) {
    const index = new Map();
    for (const item of cast) {
        for (const alias of [item.name, ...(item.aliases || [])].filter((value) => typeof value === 'string' && value.length)) {
            const matches = index.get(alias) || [];
            if (!matches.some((match) => match.id === item.id)) matches.push(item);
            index.set(alias, matches);
        }
    }
    return index;
}

function sliceCodePoints(value, start, end) {
    return Array.from(String(value)).slice(start, end).join('');
}

function compareFirstMention(a, b) {
    return a.firstMention.sourceMessageIndex - b.firstMention.sourceMessageIndex
        || a.firstMention.start - b.firstMention.start
        || identityKey(a.identityRef).localeCompare(identityKey(b.identityRef));
}

function identityKey(identityRef) {
    return identityRef?.type === 'unknown' ? '' : `${identityRef?.type}:${identityRef?.id}`;
}
