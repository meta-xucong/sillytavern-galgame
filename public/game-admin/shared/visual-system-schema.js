export const VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION = 'galgame.visual-visible-projection.v1';
export const VISUAL_PROJECTION_STUB_PROTOCOL_VERSION = 'galgame.visual-projection-stub.v1';
export const VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION = 'galgame.visual-projection-proof.v1';
export const VISUAL_ASSET_CATALOG_PROTOCOL_VERSION = 'galgame.visual-asset-catalog.v1';
export const VISUAL_ASSET_PROTOCOL_VERSION = 'galgame.visual-asset.v1';
export const ADMIN_VISUAL_PROFILE_PROTOCOL_VERSION = 'galgame.admin-visual-profile.v1';
export const VISUAL_DICTIONARY_PROTOCOL_VERSION = 'galgame.visual-dictionary.v1';
export const VISUAL_BINDING_PROTOCOL_VERSION = 'galgame.visual-binding.v1';
export const VISUAL_MATCH_RESULT_PROTOCOL_VERSION = 'galgame.visual-match-result.v1';

export const VISUAL_ENTITY_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill', 'unknown']);
export const VISUAL_ASSET_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
export const VISUAL_BINDABLE_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
export const VISUAL_CONFIDENCE_BANDS = Object.freeze(['explicit', 'probable', 'ambiguous', 'unknown']);
export const VISUAL_SCORE_BANDS = Object.freeze(['unknown', 'low', 'medium', 'high']);
export const VISUAL_LOCALES = Object.freeze(['zh-CN', 'en', 'mixed', 'unknown']);
export const VISUAL_CATALOG_STATUSES = Object.freeze(['draft', 'validated', 'published', 'archived']);
export const VISUAL_ASSET_MIME_TYPES = Object.freeze(['image/webp', 'image/png', 'image/jpeg']);
export const VISUAL_LAYER_HINTS = Object.freeze(['background', 'sprite', 'icon', 'decorative']);
export const VISUAL_SAFE_CROP_MODES = Object.freeze(['cover-safe', 'contain', 'focus-anchor']);
export const VISUAL_TEMPLATE_CODES = Object.freeze([
    'visual-novel',
    'rpg-adventure',
    'romance-social',
    'mystery-investigation',
    'management-sim',
    'sandbox-roleplay',
]);
export const VISUAL_REASON_CODES = Object.freeze([
    'explicit-visible-label',
    'explicit-appearance',
    'type-match',
    'tag-overlap',
    'locale-match',
    'style-match',
    'negative-tag-conflict',
    'ambiguous-appearance-capped',
    'missing-visible-label',
    'scene-ambiguous-low-confidence',
    'candidate-empty',
    'asset-missing',
    'hash-mismatch',
    'proof-invalid',
    'projection-stale',
    'dictionary-unavailable',
    'unknown-fallback',
]);

export const VISUAL_RUNTIME_MESSAGE_ROLES = Object.freeze(['player', 'character', 'narrator', 'system']);

/**
 * Return the only message fields allowed to cross the runtime visual boundary.
 * The service and browser use this same normalization before hashing.
 */
export function normalizeVisualRuntimeMessage(message, { maxTextLength = 4000 } = {}) {
    if (!isPlainObject(message)) return null;
    const keys = Object.keys(message).sort();
    const allowedKeys = ['characterIdentity', 'index', 'role', 'speaker', 'text'];
    if (!keys.every((key) => allowedKeys.includes(key))) return null;
    if (!['index', 'role', 'speaker', 'text'].every((key) => keys.includes(key))) return null;
    if (keys.join('\u0000') !== ['index', 'role', 'speaker', 'text'].sort().join('\u0000')) return null;
    if (!Number.isSafeInteger(message.index) || message.index < 0) return null;
    if (!VISUAL_RUNTIME_MESSAGE_ROLES.includes(message.role)) return null;
    if (typeof message.speaker !== 'string' || Array.from(message.speaker).length > 160) return null;
    if (typeof message.text !== 'string' || Array.from(message.text).length > maxTextLength) return null;
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message.speaker) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message.text)) return null;
    return {
        index: message.index,
        role: message.role,
        speaker: message.speaker,
        text: message.text.normalize('NFC'),
        ...(message.characterIdentity && typeof message.characterIdentity === 'object' ? { characterIdentity: message.characterIdentity } : {}),
    };
}
export const VISUAL_ATTRIBUTE_CODES = Object.freeze([
    'scene-location-kind',
    'scene-atmosphere',
    'character-explicit-name',
    'character-visual-binding',
    'character-explicit-appearance',
    'character-explicit-clothing',
    'character-explicit-species',
    'character-explicit-gender-presentation',
    'equipment-visible-label',
    'equipment-visible-trait',
    'item-visible-label',
    'item-visible-trait',
    'skill-visible-label',
    'skill-visible-trait',
    'status-visible-text-fragment',
]);

export const IMMUTABLE_UNKNOWN_VISUAL_ASSETS = Object.freeze({
    scene: Object.freeze({
        assetId: 'unknown_scene',
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        type: 'scene',
    }),
    character: Object.freeze({
        assetId: 'unknown_character',
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        type: 'character',
    }),
    equipment: Object.freeze({
        assetId: 'unknown_equipment',
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        type: 'equipment',
    }),
    item: Object.freeze({
        assetId: 'unknown_item',
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        type: 'item',
    }),
    skill: Object.freeze({
        assetId: 'unknown_skill',
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        type: 'skill',
    }),
});

const ENTITY_TYPE_SET = new Set(VISUAL_ENTITY_TYPES);
const ASSET_TYPE_SET = new Set(VISUAL_ASSET_TYPES);
const BINDABLE_TYPE_SET = new Set(VISUAL_BINDABLE_TYPES);
const CONFIDENCE_BAND_SET = new Set(VISUAL_CONFIDENCE_BANDS);
const SCORE_BAND_SET = new Set(VISUAL_SCORE_BANDS);
const LOCALE_SET = new Set(VISUAL_LOCALES);
const CATALOG_STATUS_SET = new Set(VISUAL_CATALOG_STATUSES);
const MIME_TYPE_SET = new Set(VISUAL_ASSET_MIME_TYPES);
const LAYER_HINT_SET = new Set(VISUAL_LAYER_HINTS);
const SAFE_CROP_MODE_SET = new Set(VISUAL_SAFE_CROP_MODES);
const TEMPLATE_CODE_SET = new Set(VISUAL_TEMPLATE_CODES);
const REASON_CODE_SET = new Set(VISUAL_REASON_CODES);
const ATTRIBUTE_CODE_SET = new Set(VISUAL_ATTRIBUTE_CODES);
const PROOF_AUDIENCES = new Set(['visual-asset-service']);
const PROOF_PURPOSES = new Set(['visual-match']);
const CHARACTER_REF_MODES = new Set(['single-character', 'multi-character', 'group']);
const SCENE_POLICIES = new Set(['ttl-message-count', 'ttl-time', 'manual-disabled']);
const CHARACTER_POLICIES = new Set(['session-fixed-on-first-explicit-appearance', 'silhouette-only-until-explicit']);
const VISIBLE_LABEL_POLICIES = new Set(['display-binding-on-first-visible-label']);
const BINDING_POLICIES = new Set(['scene-ttl', 'session-fixed', 'entity-first-seen-fixed', 'unknown']);

const PROJECTION_KEYS = new Set([
    'schemaVersion',
    'projectionId',
    'projectionHash',
    'source',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'characterRef',
    'sourceMessageIndex',
    'sourceMessageHash',
    'visibleTextDigest',
    'locale',
    'entities',
    'extractorVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'createdAt',
]);
const CHARACTER_REF_KEYS = new Set(['mode', 'refHash']);
const PROJECTED_ENTITY_KEYS = new Set(['entityKey', 'entityType', 'displayLabel', 'visibleAttributes', 'confidenceBand']);
const VISIBLE_ATTRIBUTE_KEYS = new Set(['code', 'value', 'confidenceBand']);
const STUB_KEYS = new Set([
    'schemaVersion',
    'projectionId',
    'projectionHash',
    'sourceMessageHash',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'profileId',
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'sourceMessageIndex',
    'entities',
    'extractorVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'expiresAt',
]);
const PROOF_KEYS = new Set([
    'schemaVersion',
    'audience',
    'purpose',
    'projectionId',
    'projectionHash',
    'sourceMessageHash',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'profileId',
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'sourceMessageIndex',
    'extractorVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'nonce',
    'issuedAt',
    'expiresAt',
    'signature',
]);
const CATALOG_KEYS = new Set([
    'schemaVersion',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'dictionaryVersion',
    'dictionaryHash',
    'status',
    'assets',
    'createdAt',
    'publishedAt',
    'archivedAt',
]);
const ASSET_REF_KEYS = new Set(['assetId', 'assetVersion', 'assetContentSha256', 'type']);
const ASSET_KEYS = new Set([
    'schemaVersion',
    'catalogId',
    'catalogRevision',
    'assetId',
    'assetVersion',
    'assetContentSha256',
    'type',
    'title',
    'caption',
    'tags',
    'localeTags',
    'styleTags',
    'negativeTags',
    'assetUri',
    'thumbnailUri',
    'mime',
    'width',
    'height',
    'transparentBackground',
    'safeCrop',
    'layerHint',
    'licenseCode',
    'sourceLabel',
    'status',
    'createdAt',
    'updatedAt',
]);
const SAFE_CROP_KEYS = new Set(['mode', 'anchorX', 'anchorY']);
const PROFILE_KEYS = new Set([
    'schemaVersion',
    'profileId',
    'profileRevision',
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'templateCode',
    'enabledTypes',
    'priorityRules',
    'scenePolicy',
    'characterPolicy',
    'equipmentPolicy',
    'itemPolicy',
    'skillPolicy',
    'threshold',
    'allowProviderMatcher',
    'allowAdminPatterns',
]);
const PRIORITY_RULE_KEYS = new Set(['type', 'weight']);
const DICTIONARY_KEYS = new Set([
    'schemaVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'tagCodes',
    'synonyms',
    'negativeTags',
    'weights',
]);
const BINDING_KEYS = new Set([
    'schemaVersion',
    'bindingId',
    'bindingType',
    'entityKey',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'sourceMessageIndex',
    'sourceMessageHash',
    'evidenceDigest',
    'projectionId',
    'visualProfileId',
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'assetId',
    'assetVersion',
    'assetContentSha256',
    'matcherVersion',
    'scorerVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'score',
    'scoreBand',
    'reasonCodes',
    'bindingPolicy',
    'idempotencyKey',
    'createdAt',
    'updatedAt',
    'expiresAt',
]);
const MATCH_RESULT_KEYS = new Set([
    'schemaVersion',
    'matchId',
    'bindingId',
    'entityKey',
    'type',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'visualProfileId',
    'profileHash',
    'evidenceDigest',
    'projectionId',
    'sourceMessageIndex',
    'sourceMessageHash',
    'assetId',
    'assetVersion',
    'assetContentSha256',
    'matcherVersion',
    'scorerVersion',
    'dictionaryVersion',
    'dictionaryHash',
    'score',
    'scoreBand',
    'reasonCodes',
    'usesLlm',
    'createdAt',
    'expiresAt',
]);

const FORBIDDEN_VISUAL_FIELDS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    'rawText',
    'rawChat',
    'prompt',
    'context',
    'resourceBody',
    'providerResponse',
    'regex',
    'script',
    'adminPattern',
    'dialogue',
    'choices',
    'nodes',
    'endings',
    'relationship',
    'inventoryState',
    'hpState',
    'ownership',
    'unlock',
    'effect',
    'provider',
    'llm',
    'visualService',
    'bindingWriter',
    'localState',
    'storyState',
]);
const FORBIDDEN_VISUAL_FIELDS_CANONICAL = new Set([...FORBIDDEN_VISUAL_FIELDS].map((key) => key.toLowerCase()));

const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const GENERIC_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const PROJECTION_ID_PATTERN = /^vvp_[a-z0-9_-]{12,80}$/;
const MATCH_ID_PATTERN = /^vm_[a-z0-9_-]{12,80}$/;
const BINDING_ID_PATTERN = /^vb_[a-z0-9_-]{12,80}$/;
const CATALOG_ID_PATTERN = /^vc_[a-z0-9_-]{8,80}$/;
const PROFILE_ID_PATTERN = /^vprof_[a-z0-9_-]{8,80}$/;
const ASSET_ID_PATTERN = /^(unknown_(scene|character|equipment|item|skill)|asset_[a-z0-9_-]{8,80})$/;
const ENTITY_KEY_PATTERN = /^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$/;
const NONCE_PATTERN = /^nonce_[A-Za-z0-9._:-]{16,96}$/;
const IDEMPOTENCY_KEY_PATTERN = /^idem_[A-Za-z0-9._:-]{16,120}$/;

export function getImmutableUnknownVisualAssetRef(type) {
    if (!BINDABLE_TYPE_SET.has(type)) {
        return null;
    }
    const key = type;
    return { ...IMMUTABLE_UNKNOWN_VISUAL_ASSETS[key] };
}

export function isImmutableUnknownVisualAssetRef(assetRef, type = assetRef?.type) {
    const expected = IMMUTABLE_UNKNOWN_VISUAL_ASSETS[type];
    return Boolean(
        expected
        && assetRef?.assetId === expected.assetId
        && assetRef?.assetVersion === expected.assetVersion
        && assetRef?.assetContentSha256 === expected.assetContentSha256
        && assetRef?.type === expected.type,
    );
}

export function applyVisualScorePolicy(input = {}) {
    const errors = [];
    if (!BINDABLE_TYPE_SET.has(input.type)) {
        errors.push('scorePolicy.type must be a bindable visual type.');
    }
    validateIntegerRange(input.score, 'scorePolicy.score', errors, 0, 100);
    if (input.confidenceBand !== undefined && !CONFIDENCE_BAND_SET.has(input.confidenceBand)) {
        errors.push('scorePolicy.confidenceBand must be a known confidence band.');
    }
    if (input.candidateCount !== undefined) {
        validateIntegerRange(input.candidateCount, 'scorePolicy.candidateCount', errors, 0, 1000);
    }
    if (input.hasExplicitVisibleLabel !== undefined && typeof input.hasExplicitVisibleLabel !== 'boolean') {
        errors.push('scorePolicy.hasExplicitVisibleLabel must be boolean.');
    }
    if (input.hasExplicitAppearanceEvidence !== undefined && typeof input.hasExplicitAppearanceEvidence !== 'boolean') {
        errors.push('scorePolicy.hasExplicitAppearanceEvidence must be boolean.');
    }
    validateUniqueEnumArray(input.reasonCodes, REASON_CODE_SET, 'scorePolicy.reasonCodes', errors, 0, 8, true);
    if (errors.length) {
        return { ok: false, errors, score: null, isUnknown: true, assetRef: null, reasonCodes: [] };
    }

    const type = input.type;
    let score = input.score;
    const reasonCodes = new Set(input.reasonCodes || []);
    if (input.candidateCount === 0) {
        score = 0;
        reasonCodes.add('candidate-empty');
    }
    if (type === 'character' && input.confidenceBand !== 'explicit' && input.hasExplicitAppearanceEvidence !== true) {
        score = Math.min(score, 19);
        reasonCodes.add('ambiguous-appearance-capped');
    }
    if (['equipment', 'item', 'skill'].includes(type) && input.hasExplicitVisibleLabel !== true) {
        score = 0;
        reasonCodes.add('missing-visible-label');
    }
    const isUnknown = score < 20;
    if (isUnknown) {
        reasonCodes.add('unknown-fallback');
    }
    return {
        ok: true,
        errors: [],
        score,
        isUnknown,
        assetRef: isUnknown ? getImmutableUnknownVisualAssetRef(type) : null,
        reasonCodes: [...reasonCodes].filter((code) => REASON_CODE_SET.has(code)),
    };
}

export function validateVisualVisibleProjection(projection) {
    const errors = [];
    if (!isPlainObject(projection)) {
        return invalid('VisualVisibleProjectionV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(projection, 'projection', errors);
    rejectUnknownKeys(projection, PROJECTION_KEYS, 'projection', errors);
    requireExactValue(projection.schemaVersion, VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION, 'projection.schemaVersion', errors);
    validatePatternString(projection.projectionId, PROJECTION_ID_PATTERN, 'projection.projectionId', errors);
    validatePatternString(projection.projectionHash, SHA256_DIGEST_PATTERN, 'projection.projectionHash', errors);
    requireExactValue(projection.source, 'target-chat-readback', 'projection.source', errors);
    validateGenericId(projection.releaseId, 'projection.releaseId', errors);
    validateGenericId(projection.scenarioId, 'projection.scenarioId', errors);
    validateGenericId(projection.scenarioVersion, 'projection.scenarioVersion', errors);
    validateGenericId(projection.arcId, 'projection.arcId', errors);
    validateGenericId(projection.chatId, 'projection.chatId', errors);
    if (projection.characterRef !== undefined) {
        validateCharacterRef(projection.characterRef, 'projection.characterRef', errors);
    }
    validateIntegerRange(projection.sourceMessageIndex, 'projection.sourceMessageIndex', errors, 0, Number.MAX_SAFE_INTEGER);
    validatePatternString(projection.sourceMessageHash, SHA256_DIGEST_PATTERN, 'projection.sourceMessageHash', errors);
    validatePatternString(projection.visibleTextDigest, SHA256_DIGEST_PATTERN, 'projection.visibleTextDigest', errors);
    validateEnumValue(projection.locale, LOCALE_SET, 'projection.locale', errors);
    validateProjectedEntities(projection.entities, 'projection.entities', errors, 0, 32);
    validateVersionString(projection.extractorVersion, 'projection.extractorVersion', errors);
    validateVersionString(projection.dictionaryVersion, 'projection.dictionaryVersion', errors);
    validatePatternString(projection.dictionaryHash, SHA256_DIGEST_PATTERN, 'projection.dictionaryHash', errors);
    validateIsoTimestamp(projection.createdAt, 'projection.createdAt', errors);
    validateSerializedSize(projection, 'projection', errors, 32 * 1024);
    return validationStatus(errors);
}

export function validateVisualProjectionStub(stub) {
    const errors = [];
    if (!isPlainObject(stub)) {
        return invalid('VisualProjectionStubV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(stub, 'stub', errors);
    rejectUnknownKeys(stub, STUB_KEYS, 'stub', errors);
    requireExactValue(stub.schemaVersion, VISUAL_PROJECTION_STUB_PROTOCOL_VERSION, 'stub.schemaVersion', errors);
    validateProjectionScopeFields(stub, 'stub', errors);
    validatePatternString(stub.profileId, PROFILE_ID_PATTERN, 'stub.profileId', errors);
    validatePatternString(stub.profileHash, SHA256_DIGEST_PATTERN, 'stub.profileHash', errors);
    validatePatternString(stub.catalogId, CATALOG_ID_PATTERN, 'stub.catalogId', errors);
    validatePositiveInteger(stub.catalogRevision, 'stub.catalogRevision', errors);
    validatePatternString(stub.catalogHash, SHA256_DIGEST_PATTERN, 'stub.catalogHash', errors);
    validateProjectedEntities(stub.entities, 'stub.entities', errors, 0, 32);
    validateVersionString(stub.extractorVersion, 'stub.extractorVersion', errors);
    validateVersionString(stub.dictionaryVersion, 'stub.dictionaryVersion', errors);
    validatePatternString(stub.dictionaryHash, SHA256_DIGEST_PATTERN, 'stub.dictionaryHash', errors);
    validateIsoTimestamp(stub.expiresAt, 'stub.expiresAt', errors);
    validateSerializedSize(stub, 'stub', errors, 32 * 1024);
    return validationStatus(errors);
}

export function validateVisualProjectionProofShape(proof) {
    const errors = [];
    if (!isPlainObject(proof)) {
        return invalid('VisualProjectionProofV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(proof, 'proof', errors);
    rejectUnknownKeys(proof, PROOF_KEYS, 'proof', errors);
    requireExactValue(proof.schemaVersion, VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION, 'proof.schemaVersion', errors);
    validateEnumValue(proof.audience, PROOF_AUDIENCES, 'proof.audience', errors);
    validateEnumValue(proof.purpose, PROOF_PURPOSES, 'proof.purpose', errors);
    validateProjectionScopeFields(proof, 'proof', errors);
    validatePatternString(proof.profileId, PROFILE_ID_PATTERN, 'proof.profileId', errors);
    validatePatternString(proof.profileHash, SHA256_DIGEST_PATTERN, 'proof.profileHash', errors);
    validatePatternString(proof.catalogId, CATALOG_ID_PATTERN, 'proof.catalogId', errors);
    validatePositiveInteger(proof.catalogRevision, 'proof.catalogRevision', errors);
    validatePatternString(proof.catalogHash, SHA256_DIGEST_PATTERN, 'proof.catalogHash', errors);
    validateVersionString(proof.extractorVersion, 'proof.extractorVersion', errors);
    validateVersionString(proof.dictionaryVersion, 'proof.dictionaryVersion', errors);
    validatePatternString(proof.dictionaryHash, SHA256_DIGEST_PATTERN, 'proof.dictionaryHash', errors);
    validatePatternString(proof.nonce, NONCE_PATTERN, 'proof.nonce', errors);
    validateIsoTimestamp(proof.issuedAt, 'proof.issuedAt', errors);
    validateIsoTimestamp(proof.expiresAt, 'proof.expiresAt', errors);
    validateStringLength(proof.signature, 'proof.signature', errors, 32, 512);
    validateChronology(proof.issuedAt, proof.expiresAt, 'proof.issuedAt', 'proof.expiresAt', errors);
    validateSerializedSize(proof, 'proof', errors, 12 * 1024);
    return validationStatus(errors);
}

export function validateVisualAssetCatalog(catalog) {
    const errors = [];
    if (!isPlainObject(catalog)) {
        return invalid('VisualAssetCatalogV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(catalog, 'catalog', errors);
    rejectUnknownKeys(catalog, CATALOG_KEYS, 'catalog', errors);
    requireExactValue(catalog.schemaVersion, VISUAL_ASSET_CATALOG_PROTOCOL_VERSION, 'catalog.schemaVersion', errors);
    validatePatternString(catalog.catalogId, CATALOG_ID_PATTERN, 'catalog.catalogId', errors);
    validatePositiveInteger(catalog.catalogRevision, 'catalog.catalogRevision', errors);
    validatePatternString(catalog.catalogHash, SHA256_DIGEST_PATTERN, 'catalog.catalogHash', errors);
    validateVersionString(catalog.dictionaryVersion, 'catalog.dictionaryVersion', errors);
    validatePatternString(catalog.dictionaryHash, SHA256_DIGEST_PATTERN, 'catalog.dictionaryHash', errors);
    validateEnumValue(catalog.status, CATALOG_STATUS_SET, 'catalog.status', errors);
    validateAssetRefs(catalog.assets, 'catalog.assets', errors, 5, 500);
    validateUnknownAssetsPresent(catalog.assets, 'catalog.assets', errors);
    validateIsoTimestamp(catalog.createdAt, 'catalog.createdAt', errors);
    validateOptionalIsoTimestamp(catalog.publishedAt, 'catalog.publishedAt', errors);
    validateOptionalIsoTimestamp(catalog.archivedAt, 'catalog.archivedAt', errors);
    validateSerializedSize(catalog, 'catalog', errors, 96 * 1024);
    return validationStatus(errors);
}

export function validateVisualAsset(asset) {
    const errors = [];
    if (!isPlainObject(asset)) {
        return invalid('VisualAssetV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(asset, 'asset', errors);
    rejectUnknownKeys(asset, ASSET_KEYS, 'asset', errors);
    requireExactValue(asset.schemaVersion, VISUAL_ASSET_PROTOCOL_VERSION, 'asset.schemaVersion', errors);
    validatePatternString(asset.catalogId, CATALOG_ID_PATTERN, 'asset.catalogId', errors);
    validatePositiveInteger(asset.catalogRevision, 'asset.catalogRevision', errors);
    validatePatternString(asset.assetId, ASSET_ID_PATTERN, 'asset.assetId', errors);
    validatePositiveInteger(asset.assetVersion, 'asset.assetVersion', errors);
    validatePatternString(asset.assetContentSha256, SHA256_HEX_PATTERN, 'asset.assetContentSha256', errors);
    validateEnumValue(asset.type, ASSET_TYPE_SET, 'asset.type', errors);
    validateStringLength(asset.title, 'asset.title', errors, 1, 80);
    validateOptionalStringLength(asset.caption, 'asset.caption', errors, 0, 160);
    validateBoundedStringArray(asset.tags, 'asset.tags', errors, 1, 32, 1, 40);
    validateBoundedStringArray(asset.localeTags, 'asset.localeTags', errors, 0, 24, 1, 40, true);
    validateBoundedStringArray(asset.styleTags, 'asset.styleTags', errors, 0, 24, 1, 40, true);
    validateBoundedStringArray(asset.negativeTags, 'asset.negativeTags', errors, 0, 24, 1, 40, true);
    validateRelativeAssetUri(asset.assetUri, 'asset.assetUri', errors);
    validateRelativeAssetUri(asset.thumbnailUri, 'asset.thumbnailUri', errors);
    validateEnumValue(asset.mime, MIME_TYPE_SET, 'asset.mime', errors);
    validateIntegerRange(asset.width, 'asset.width', errors, 1, 8192);
    validateIntegerRange(asset.height, 'asset.height', errors, 1, 8192);
    if (typeof asset.transparentBackground !== 'boolean') {
        errors.push('asset.transparentBackground must be boolean.');
    }
    if (asset.safeCrop !== undefined) {
        validateSafeCrop(asset.safeCrop, 'asset.safeCrop', errors);
    }
    validateOptionalEnumValue(asset.layerHint, LAYER_HINT_SET, 'asset.layerHint', errors);
    validateOptionalStringLength(asset.licenseCode, 'asset.licenseCode', errors, 0, 40);
    validateOptionalStringLength(asset.sourceLabel, 'asset.sourceLabel', errors, 0, 120);
    validateEnumValue(asset.status, CATALOG_STATUS_SET, 'asset.status', errors);
    validateIsoTimestamp(asset.createdAt, 'asset.createdAt', errors);
    validateIsoTimestamp(asset.updatedAt, 'asset.updatedAt', errors);
    validateSerializedSize(asset, 'asset', errors, 32 * 1024);
    return validationStatus(errors);
}

export function validateAdminVisualProfile(profile) {
    const errors = [];
    if (!isPlainObject(profile)) {
        return invalid('AdminVisualProfileV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(profile, 'profile', errors);
    rejectUnknownKeys(profile, PROFILE_KEYS, 'profile', errors);
    requireExactValue(profile.schemaVersion, ADMIN_VISUAL_PROFILE_PROTOCOL_VERSION, 'profile.schemaVersion', errors);
    validatePatternString(profile.profileId, PROFILE_ID_PATTERN, 'profile.profileId', errors);
    validatePositiveInteger(profile.profileRevision, 'profile.profileRevision', errors);
    validatePatternString(profile.profileHash, SHA256_DIGEST_PATTERN, 'profile.profileHash', errors);
    validatePatternString(profile.catalogId, CATALOG_ID_PATTERN, 'profile.catalogId', errors);
    validatePositiveInteger(profile.catalogRevision, 'profile.catalogRevision', errors);
    validatePatternString(profile.catalogHash, SHA256_DIGEST_PATTERN, 'profile.catalogHash', errors);
    validateEnumValue(profile.templateCode, TEMPLATE_CODE_SET, 'profile.templateCode', errors);
    validateUniqueEnumArray(profile.enabledTypes, BINDABLE_TYPE_SET, 'profile.enabledTypes', errors, 1, 5);
    validatePriorityRules(profile.priorityRules, 'profile.priorityRules', errors);
    validateEnumValue(profile.scenePolicy, SCENE_POLICIES, 'profile.scenePolicy', errors);
    validateEnumValue(profile.characterPolicy, CHARACTER_POLICIES, 'profile.characterPolicy', errors);
    validateEnumValue(profile.equipmentPolicy, VISIBLE_LABEL_POLICIES, 'profile.equipmentPolicy', errors);
    validateEnumValue(profile.itemPolicy, VISIBLE_LABEL_POLICIES, 'profile.itemPolicy', errors);
    validateEnumValue(profile.skillPolicy, VISIBLE_LABEL_POLICIES, 'profile.skillPolicy', errors);
    validateIntegerRange(profile.threshold, 'profile.threshold', errors, 20, 100);
    if (profile.allowProviderMatcher !== false) {
        errors.push('profile.allowProviderMatcher must be false in VS1-SG.');
    }
    if (profile.allowAdminPatterns !== false) {
        errors.push('profile.allowAdminPatterns must be false in VS1-SG.');
    }
    validateSerializedSize(profile, 'profile', errors, 24 * 1024);
    return validationStatus(errors);
}

export function validateVisualDictionary(dictionary) {
    const errors = [];
    if (!isPlainObject(dictionary)) {
        return invalid('VisualDictionaryV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(dictionary, 'dictionary', errors);
    rejectUnknownKeys(dictionary, DICTIONARY_KEYS, 'dictionary', errors);
    requireExactValue(dictionary.schemaVersion, VISUAL_DICTIONARY_PROTOCOL_VERSION, 'dictionary.schemaVersion', errors);
    validateVersionString(dictionary.dictionaryVersion, 'dictionary.dictionaryVersion', errors);
    validatePatternString(dictionary.dictionaryHash, SHA256_DIGEST_PATTERN, 'dictionary.dictionaryHash', errors);
    validateBoundedStringArray(dictionary.tagCodes, 'dictionary.tagCodes', errors, 1, 1000, 1, 64);
    validateStringArrayMap(dictionary.synonyms, 'dictionary.synonyms', errors, 0, 1000, 0, 32, 1, 64);
    validateStringArrayMap(dictionary.negativeTags, 'dictionary.negativeTags', errors, 0, 1000, 0, 32, 1, 64);
    validateNumberMap(dictionary.weights, 'dictionary.weights', errors, 0, 1000, 0, 100);
    validateSerializedSize(dictionary, 'dictionary', errors, 128 * 1024);
    return validationStatus(errors);
}

export function validateVisualBinding(binding, context = {}) {
    const errors = [];
    if (!isPlainObject(binding)) {
        return invalid('VisualBindingV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(binding, 'binding', errors);
    rejectUnknownKeys(binding, BINDING_KEYS, 'binding', errors);
    requireExactValue(binding.schemaVersion, VISUAL_BINDING_PROTOCOL_VERSION, 'binding.schemaVersion', errors);
    validatePatternString(binding.bindingId, BINDING_ID_PATTERN, 'binding.bindingId', errors);
    validateEnumValue(binding.bindingType, BINDABLE_TYPE_SET, 'binding.bindingType', errors);
    validateEntityKey(binding.entityKey, 'binding.entityKey', errors);
    validateReleaseScope(binding, 'binding', errors);
    validateIntegerRange(binding.sourceMessageIndex, 'binding.sourceMessageIndex', errors, 0, Number.MAX_SAFE_INTEGER);
    validatePatternString(binding.sourceMessageHash, SHA256_DIGEST_PATTERN, 'binding.sourceMessageHash', errors);
    validatePatternString(binding.evidenceDigest, SHA256_DIGEST_PATTERN, 'binding.evidenceDigest', errors);
    validatePatternString(binding.projectionId, PROJECTION_ID_PATTERN, 'binding.projectionId', errors);
    validatePatternString(binding.visualProfileId, PROFILE_ID_PATTERN, 'binding.visualProfileId', errors);
    validatePatternString(binding.profileHash, SHA256_DIGEST_PATTERN, 'binding.profileHash', errors);
    validatePatternString(binding.catalogId, CATALOG_ID_PATTERN, 'binding.catalogId', errors);
    validatePositiveInteger(binding.catalogRevision, 'binding.catalogRevision', errors);
    validatePatternString(binding.catalogHash, SHA256_DIGEST_PATTERN, 'binding.catalogHash', errors);
    validatePatternString(binding.assetId, ASSET_ID_PATTERN, 'binding.assetId', errors);
    validatePositiveInteger(binding.assetVersion, 'binding.assetVersion', errors);
    validatePatternString(binding.assetContentSha256, SHA256_HEX_PATTERN, 'binding.assetContentSha256', errors);
    validateVersionString(binding.matcherVersion, 'binding.matcherVersion', errors);
    validateVersionString(binding.scorerVersion, 'binding.scorerVersion', errors);
    validateVersionString(binding.dictionaryVersion, 'binding.dictionaryVersion', errors);
    validatePatternString(binding.dictionaryHash, SHA256_DIGEST_PATTERN, 'binding.dictionaryHash', errors);
    validateIntegerRange(binding.score, 'binding.score', errors, 0, 100);
    validateEnumValue(binding.scoreBand, SCORE_BAND_SET, 'binding.scoreBand', errors);
    validateUniqueEnumArray(binding.reasonCodes, REASON_CODE_SET, 'binding.reasonCodes', errors, 1, 8);
    validateEnumValue(binding.bindingPolicy, BINDING_POLICIES, 'binding.bindingPolicy', errors);
    validatePatternString(binding.idempotencyKey, IDEMPOTENCY_KEY_PATTERN, 'binding.idempotencyKey', errors);
    validateIsoTimestamp(binding.createdAt, 'binding.createdAt', errors);
    validateIsoTimestamp(binding.updatedAt, 'binding.updatedAt', errors);
    validateOptionalIsoTimestamp(binding.expiresAt, 'binding.expiresAt', errors);
    validateExpectedScope(binding, context, 'binding', errors);
    validateUnknownAssetCoherence(binding, binding.bindingType, 'binding', errors);
    validateSerializedSize(binding, 'binding', errors, 32 * 1024);
    return validationStatus(errors);
}

export function validateVisualMatchResult(result, context = {}) {
    const errors = [];
    if (!isPlainObject(result)) {
        return invalid('VisualMatchResultV1 must be an object.');
    }
    rejectForbiddenFieldsDeep(result, 'matchResult', errors);
    rejectUnknownKeys(result, MATCH_RESULT_KEYS, 'matchResult', errors);
    requireExactValue(result.schemaVersion, VISUAL_MATCH_RESULT_PROTOCOL_VERSION, 'matchResult.schemaVersion', errors);
    validatePatternString(result.matchId, MATCH_ID_PATTERN, 'matchResult.matchId', errors);
    validatePatternString(result.bindingId, BINDING_ID_PATTERN, 'matchResult.bindingId', errors);
    validateEntityKey(result.entityKey, 'matchResult.entityKey', errors);
    validateEnumValue(result.type, BINDABLE_TYPE_SET, 'matchResult.type', errors);
    validatePatternString(result.catalogId, CATALOG_ID_PATTERN, 'matchResult.catalogId', errors);
    validatePositiveInteger(result.catalogRevision, 'matchResult.catalogRevision', errors);
    validatePatternString(result.catalogHash, SHA256_DIGEST_PATTERN, 'matchResult.catalogHash', errors);
    validatePatternString(result.visualProfileId, PROFILE_ID_PATTERN, 'matchResult.visualProfileId', errors);
    validatePatternString(result.profileHash, SHA256_DIGEST_PATTERN, 'matchResult.profileHash', errors);
    validatePatternString(result.evidenceDigest, SHA256_DIGEST_PATTERN, 'matchResult.evidenceDigest', errors);
    validatePatternString(result.projectionId, PROJECTION_ID_PATTERN, 'matchResult.projectionId', errors);
    validateIntegerRange(result.sourceMessageIndex, 'matchResult.sourceMessageIndex', errors, 0, Number.MAX_SAFE_INTEGER);
    validatePatternString(result.sourceMessageHash, SHA256_DIGEST_PATTERN, 'matchResult.sourceMessageHash', errors);
    validatePatternString(result.assetId, ASSET_ID_PATTERN, 'matchResult.assetId', errors);
    validatePositiveInteger(result.assetVersion, 'matchResult.assetVersion', errors);
    validatePatternString(result.assetContentSha256, SHA256_HEX_PATTERN, 'matchResult.assetContentSha256', errors);
    validateVersionString(result.matcherVersion, 'matchResult.matcherVersion', errors);
    validateVersionString(result.scorerVersion, 'matchResult.scorerVersion', errors);
    validateVersionString(result.dictionaryVersion, 'matchResult.dictionaryVersion', errors);
    validatePatternString(result.dictionaryHash, SHA256_DIGEST_PATTERN, 'matchResult.dictionaryHash', errors);
    validateIntegerRange(result.score, 'matchResult.score', errors, 0, 100);
    validateEnumValue(result.scoreBand, SCORE_BAND_SET, 'matchResult.scoreBand', errors);
    validateUniqueEnumArray(result.reasonCodes, REASON_CODE_SET, 'matchResult.reasonCodes', errors, 1, 8);
    if (result.usesLlm !== false) {
        errors.push('matchResult.usesLlm must be false in VS1-SG.');
    }
    validateIsoTimestamp(result.createdAt, 'matchResult.createdAt', errors);
    validateOptionalIsoTimestamp(result.expiresAt, 'matchResult.expiresAt', errors);
    validateExpectedScope(result, context, 'matchResult', errors);
    validateUnknownAssetCoherence(result, result.type, 'matchResult', errors);
    validateSerializedSize(result, 'matchResult', errors, 32 * 1024);
    return validationStatus(errors);
}

export function resolveVisualMatchResultForScope(result, context = {}) {
    const status = validateVisualMatchResult(result, context);
    if (status.valid) {
        return { ok: true, errors: [], result, unknownAsset: null };
    }
    const hasBindableType = BINDABLE_TYPE_SET.has(result?.type);
    const errors = [...status.errors];
    if (!hasBindableType) {
        errors.push('matchResult.type cannot be resolved to an immutable unknown asset without a valid bindable type.');
    }
    return {
        ok: false,
        errors,
        result: null,
        unknownAsset: hasBindableType ? getImmutableUnknownVisualAssetRef(result.type) : null,
    };
}

function validateProjectionScopeFields(source, label, errors) {
    validatePatternString(source.projectionId, PROJECTION_ID_PATTERN, `${label}.projectionId`, errors);
    validatePatternString(source.projectionHash, SHA256_DIGEST_PATTERN, `${label}.projectionHash`, errors);
    validatePatternString(source.sourceMessageHash, SHA256_DIGEST_PATTERN, `${label}.sourceMessageHash`, errors);
    validateReleaseScope(source, label, errors);
    validateIntegerRange(source.sourceMessageIndex, `${label}.sourceMessageIndex`, errors, 0, Number.MAX_SAFE_INTEGER);
}

function validateReleaseScope(source, label, errors) {
    validateGenericId(source.releaseId, `${label}.releaseId`, errors);
    validateGenericId(source.scenarioId, `${label}.scenarioId`, errors);
    validateGenericId(source.scenarioVersion, `${label}.scenarioVersion`, errors);
    validateGenericId(source.arcId, `${label}.arcId`, errors);
    validateGenericId(source.chatId, `${label}.chatId`, errors);
}

function validateCharacterRef(ref, label, errors) {
    if (!isPlainObject(ref)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    rejectUnknownKeys(ref, CHARACTER_REF_KEYS, label, errors);
    validateEnumValue(ref.mode, CHARACTER_REF_MODES, `${label}.mode`, errors);
    validatePatternString(ref.refHash, SHA256_DIGEST_PATTERN, `${label}.refHash`, errors);
}

function validateProjectedEntities(entities, label, errors, minLength, maxLength) {
    if (!Array.isArray(entities)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (entities.length < minLength || entities.length > maxLength) {
        errors.push(`${label} must contain ${minLength} to ${maxLength} items.`);
    }
    const seen = new Set();
    for (const [index, entity] of entities.entries()) {
        const entityLabel = `${label}[${index}]`;
        validateProjectedEntity(entity, entityLabel, errors);
        if (entity?.entityKey) {
            if (seen.has(entity.entityKey)) {
                errors.push(`${entityLabel}.entityKey is duplicated.`);
            }
            seen.add(entity.entityKey);
        }
    }
}

function validateProjectedEntity(entity, label, errors) {
    if (!isPlainObject(entity)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    rejectUnknownKeys(entity, PROJECTED_ENTITY_KEYS, label, errors);
    validateEntityKey(entity.entityKey, `${label}.entityKey`, errors);
    validateEnumValue(entity.entityType, ENTITY_TYPE_SET, `${label}.entityType`, errors);
    validateStringLength(entity.displayLabel, `${label}.displayLabel`, errors, 1, 80);
    validateVisibleAttributes(entity.visibleAttributes, `${label}.visibleAttributes`, errors);
    validateEnumValue(entity.confidenceBand, CONFIDENCE_BAND_SET, `${label}.confidenceBand`, errors);
}

function validateVisibleAttributes(attributes, label, errors) {
    if (!Array.isArray(attributes)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (attributes.length > 16) {
        errors.push(`${label} must contain 0 to 16 items.`);
    }
    for (const [index, attribute] of attributes.entries()) {
        const attributeLabel = `${label}[${index}]`;
        if (!isPlainObject(attribute)) {
            errors.push(`${attributeLabel} must be an object.`);
            continue;
        }
        rejectUnknownKeys(attribute, VISIBLE_ATTRIBUTE_KEYS, attributeLabel, errors);
        validateEnumValue(attribute.code, ATTRIBUTE_CODE_SET, `${attributeLabel}.code`, errors);
        validateStringLength(attribute.value, `${attributeLabel}.value`, errors, 1, 120);
        validateEnumValue(attribute.confidenceBand, CONFIDENCE_BAND_SET, `${attributeLabel}.confidenceBand`, errors);
    }
}

function validateAssetRefs(assetRefs, label, errors, minLength, maxLength) {
    if (!Array.isArray(assetRefs)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (assetRefs.length < minLength || assetRefs.length > maxLength) {
        errors.push(`${label} must contain ${minLength} to ${maxLength} items.`);
    }
    const seen = new Set();
    for (const [index, assetRef] of assetRefs.entries()) {
        const assetLabel = `${label}[${index}]`;
        validateAssetRef(assetRef, assetLabel, errors);
        const key = `${assetRef?.assetId}@${assetRef?.assetVersion}`;
        if (seen.has(key)) {
            errors.push(`${assetLabel} duplicates an asset id/version.`);
        }
        seen.add(key);
    }
}

function validateAssetRef(assetRef, label, errors) {
    if (!isPlainObject(assetRef)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    rejectUnknownKeys(assetRef, ASSET_REF_KEYS, label, errors);
    validatePatternString(assetRef.assetId, ASSET_ID_PATTERN, `${label}.assetId`, errors);
    validatePositiveInteger(assetRef.assetVersion, `${label}.assetVersion`, errors);
    validatePatternString(assetRef.assetContentSha256, SHA256_HEX_PATTERN, `${label}.assetContentSha256`, errors);
    validateEnumValue(assetRef.type, ASSET_TYPE_SET, `${label}.type`, errors);
}

function validateUnknownAssetsPresent(assetRefs, label, errors) {
    if (!Array.isArray(assetRefs)) {
        return;
    }
    for (const type of VISUAL_BINDABLE_TYPES) {
        if (!assetRefs.some((assetRef) => isImmutableUnknownVisualAssetRef(assetRef, type))) {
            errors.push(`${label} must include immutable unknown asset for ${type}.`);
        }
    }
}

function validateSafeCrop(safeCrop, label, errors) {
    if (!isPlainObject(safeCrop)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    rejectUnknownKeys(safeCrop, SAFE_CROP_KEYS, label, errors);
    validateEnumValue(safeCrop.mode, SAFE_CROP_MODE_SET, `${label}.mode`, errors);
    validateOptionalBoundedNumber(safeCrop.anchorX, `${label}.anchorX`, errors, 0, 1);
    validateOptionalBoundedNumber(safeCrop.anchorY, `${label}.anchorY`, errors, 0, 1);
}

function validatePriorityRules(rules, label, errors) {
    if (!Array.isArray(rules)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (rules.length < 1 || rules.length > 5) {
        errors.push(`${label} must contain 1 to 5 items.`);
    }
    const seen = new Set();
    for (const [index, rule] of rules.entries()) {
        const ruleLabel = `${label}[${index}]`;
        if (!isPlainObject(rule)) {
            errors.push(`${ruleLabel} must be an object.`);
            continue;
        }
        rejectUnknownKeys(rule, PRIORITY_RULE_KEYS, ruleLabel, errors);
        validateEnumValue(rule.type, BINDABLE_TYPE_SET, `${ruleLabel}.type`, errors);
        validateIntegerRange(rule.weight, `${ruleLabel}.weight`, errors, 0, 100);
        if (seen.has(rule.type)) {
            errors.push(`${ruleLabel}.type is duplicated.`);
        }
        seen.add(rule.type);
    }
}

function validateStringArrayMap(value, label, errors, minKeys, maxKeys, minItems, maxItems, minLength, maxLength) {
    if (!isPlainObject(value)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    const keys = Object.keys(value);
    if (keys.length < minKeys || keys.length > maxKeys) {
        errors.push(`${label} must contain ${minKeys} to ${maxKeys} keys.`);
    }
    for (const key of keys) {
        validateStringLength(key, `${label}.${key} key`, errors, 1, 64);
        validateBoundedStringArray(value[key], `${label}.${key}`, errors, minItems, maxItems, minLength, maxLength);
    }
}

function validateNumberMap(value, label, errors, minKeys, maxKeys, min, max) {
    if (!isPlainObject(value)) {
        errors.push(`${label} must be an object.`);
        return;
    }
    const keys = Object.keys(value);
    if (keys.length < minKeys || keys.length > maxKeys) {
        errors.push(`${label} must contain ${minKeys} to ${maxKeys} keys.`);
    }
    for (const key of keys) {
        validateStringLength(key, `${label}.${key} key`, errors, 1, 64);
        validateBoundedNumber(value[key], `${label}.${key}`, errors, min, max);
    }
}

function validateUnknownAssetCoherence(record, type, label, errors) {
    if (!record || !record.assetId || !record.assetContentSha256 || !record.scoreBand) {
        return;
    }
    const expectedType = BINDABLE_TYPE_SET.has(type) ? type : null;
    if (record.score < 20 || record.scoreBand === 'unknown') {
        const expected = expectedType ? IMMUTABLE_UNKNOWN_VISUAL_ASSETS[expectedType] : null;
        if (!expected || record.assetId !== expected.assetId || record.assetVersion !== expected.assetVersion || record.assetContentSha256 !== expected.assetContentSha256) {
            errors.push(`${label} below-threshold or unknown score must use immutable type-specific unknown asset.`);
        }
    }
}

function validateExpectedScope(record, context, label, errors) {
    if (!isPlainObject(context) || Object.keys(context).length === 0) {
        return;
    }
    const fields = [
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'chatId',
        'projectionId',
        'sourceMessageIndex',
        'sourceMessageHash',
        'evidenceDigest',
        'visualProfileId',
        'profileHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'dictionaryVersion',
        'dictionaryHash',
    ];
    for (const field of fields) {
        if (record[field] === undefined) {
            continue;
        }
        if (context[field] !== undefined && record[field] !== context[field]) {
            errors.push(`${label}.${field} must match expected scope.`);
        }
    }
}

function validateEntityKey(value, label, errors) {
    validatePatternString(value, ENTITY_KEY_PATTERN, label, errors);
    if (typeof value === 'string' && Array.from(value).length > 96) {
        errors.push(`${label} exceeds 96 characters.`);
    }
}

function validateGenericId(value, label, errors) {
    validatePatternString(value, GENERIC_ID_PATTERN, label, errors);
}

function validateVersionString(value, label, errors) {
    validatePatternString(value, VERSION_ID_PATTERN, label, errors);
}

function validateRelativeAssetUri(value, label, errors) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${label} must be a relative content-addressed asset path.`);
        return;
    }
    const normalized = value.trim();
    if (
        normalized.length > 240
        || /^[a-z][a-z0-9+.-]*:/i.test(normalized)
        || normalized.startsWith('/')
        || normalized.startsWith('\\\\')
        || normalized.includes('\\')
        || normalized.includes('..')
        || !/^(assets|visual-assets)\/[a-z0-9._/-]+\.(webp|png|jpg|jpeg)$/i.test(normalized)
    ) {
        errors.push(`${label} must be a service-generated relative image path.`);
    }
}

function validateUniqueEnumArray(value, allowedSet, label, errors, minLength, maxLength, optional = false) {
    if (value === undefined && optional) {
        return;
    }
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (value.length < minLength || value.length > maxLength) {
        errors.push(`${label} must contain ${minLength} to ${maxLength} items.`);
    }
    const seen = new Set();
    for (const item of value) {
        if (!allowedSet.has(item)) {
            errors.push(`${label} contains unsupported value: ${String(item)}.`);
            continue;
        }
        if (seen.has(item)) {
            errors.push(`${label} contains duplicate value: ${item}.`);
        }
        seen.add(item);
    }
}

function validateBoundedStringArray(value, label, errors, minItems, maxItems, minLength, maxLength, optional = false) {
    if (value === undefined && optional) {
        return;
    }
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    if (value.length < minItems || value.length > maxItems) {
        errors.push(`${label} must contain ${minItems} to ${maxItems} items.`);
    }
    const seen = new Set();
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string') {
            errors.push(`${label}[${index}] must be a string.`);
            continue;
        }
        validateStringLength(item, `${label}[${index}]`, errors, minLength, maxLength);
        if (seen.has(item)) {
            errors.push(`${label}[${index}] is duplicated.`);
        }
        seen.add(item);
    }
}

function validateOptionalEnumValue(value, allowedSet, label, errors) {
    if (value === undefined) {
        return;
    }
    validateEnumValue(value, allowedSet, label, errors);
}

function validateEnumValue(value, allowedSet, label, errors) {
    if (!allowedSet.has(value)) {
        errors.push(`${label} contains unsupported value: ${String(value)}.`);
    }
}

function validatePatternString(value, pattern, label, errors) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        errors.push(`${label} has an invalid format.`);
    }
}

function validateStringLength(value, label, errors, minLength, maxLength) {
    if (typeof value !== 'string') {
        errors.push(`${label} must be a string.`);
        return;
    }
    const length = Array.from(value).length;
    if (length < minLength || length > maxLength) {
        errors.push(`${label} must be ${minLength} to ${maxLength} characters.`);
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
        errors.push(`${label} must not contain control characters.`);
    }
}

function validateOptionalStringLength(value, label, errors, minLength, maxLength) {
    if (value === undefined) {
        return;
    }
    validateStringLength(value, label, errors, minLength, maxLength);
}

function validatePositiveInteger(value, label, errors) {
    validateIntegerRange(value, label, errors, 1, Number.MAX_SAFE_INTEGER);
}

function validateIntegerRange(value, label, errors, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
        errors.push(`${label} must be an integer from ${min} to ${max}.`);
    }
}

function validateBoundedNumber(value, label, errors, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        errors.push(`${label} must be a finite number from ${min} to ${max}.`);
    }
}

function validateOptionalBoundedNumber(value, label, errors, min, max) {
    if (value === undefined) {
        return;
    }
    validateBoundedNumber(value, label, errors, min, max);
}

function validateIsoTimestamp(value, label, errors) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${label} must be an ISO timestamp string.`);
        return;
    }
    const time = Date.parse(value);
    if (!Number.isFinite(time) || new Date(time).toISOString() !== value) {
        errors.push(`${label} must be a canonical ISO timestamp.`);
    }
}

function validateOptionalIsoTimestamp(value, label, errors) {
    if (value === undefined) {
        return;
    }
    validateIsoTimestamp(value, label, errors);
}

function validateChronology(start, end, startLabel, endLabel, errors) {
    if (typeof start !== 'string' || typeof end !== 'string') {
        return;
    }
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs <= startMs) {
        errors.push(`${endLabel} must be later than ${startLabel}.`);
    }
}

function requireExactValue(value, expected, label, errors) {
    if (value !== expected) {
        errors.push(`${label} must be ${expected}.`);
    }
}

function rejectUnknownKeys(value, allowedKeys, label, errors) {
    for (const key of Object.getOwnPropertyNames(value || {})) {
        if (!allowedKeys.has(key)) {
            errors.push(`${label}.${key} is not allowed.`);
        }
    }
}

function rejectForbiddenFieldsDeep(value, label, errors) {
    if (!isObjectLike(value)) {
        return;
    }
    const entries = Array.isArray(value)
        ? value.map((child, index) => [String(index), child])
        : Object.getOwnPropertyNames(value).map((key) => [key, value[key]]);
    for (const [key, child] of entries) {
        const childLabel = `${label}.${key}`;
        if (FORBIDDEN_VISUAL_FIELDS.has(key) || FORBIDDEN_VISUAL_FIELDS_CANONICAL.has(String(key).toLowerCase())) {
            errors.push(`${childLabel} is forbidden in visual presentation contracts.`);
        }
        rejectForbiddenFieldsDeep(child, childLabel, errors);
    }
}

function validateSerializedSize(value, label, errors, maxBytes) {
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    if (size > maxBytes) {
        errors.push(`${label} exceeds the maximum serialized size.`);
    }
}

function invalid(error) {
    return { valid: false, errors: [error], warnings: [] };
}

function validationStatus(errors) {
    return { valid: errors.length === 0, errors, warnings: [] };
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isObjectLike(value) {
    return Boolean(value && typeof value === 'object');
}
