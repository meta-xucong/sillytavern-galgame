import assert from 'node:assert/strict';

import * as visualSchema from '../src/visual-system-schema.js';
import {
    ADMIN_VISUAL_PROFILE_PROTOCOL_VERSION,
    IMMUTABLE_UNKNOWN_VISUAL_ASSETS,
    VISUAL_ASSET_CATALOG_PROTOCOL_VERSION,
    VISUAL_ASSET_PROTOCOL_VERSION,
    VISUAL_BINDING_PROTOCOL_VERSION,
    VISUAL_DICTIONARY_PROTOCOL_VERSION,
    VISUAL_MATCH_RESULT_PROTOCOL_VERSION,
    VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION,
    VISUAL_PROJECTION_STUB_PROTOCOL_VERSION,
    VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION,
    applyVisualScorePolicy,
    getImmutableUnknownVisualAssetRef,
    isImmutableUnknownVisualAssetRef,
    resolveVisualMatchResultForScope,
    validateAdminVisualProfile,
    validateVisualAsset,
    validateVisualAssetCatalog,
    validateVisualBinding,
    validateVisualDictionary,
    validateVisualMatchResult,
    validateVisualProjectionProofShape,
    validateVisualProjectionStub,
    validateVisualVisibleProjection,
} from '../src/visual-system-schema.js';

const HASH_A = digest('a');
const HASH_B = digest('b');
const HASH_C = digest('c');
const HASH_D = digest('d');
const HASH_E = digest('e');
const HASH_F = digest('f');
const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const ISO_NOW = '2026-07-30T00:00:00.000Z';
const ISO_LATER = '2026-07-30T00:10:00.000Z';

const baseEntity = Object.freeze({
    entityKey: 'entity_equipment_rusty-dagger001',
    entityType: 'equipment',
    displayLabel: 'Rusty dagger',
    visibleAttributes: [
        {
            code: 'equipment-visible-label',
            value: 'Rusty dagger',
            confidenceBand: 'explicit',
        },
        {
            code: 'equipment-visible-trait',
            value: '1d4 piercing',
            confidenceBand: 'explicit',
        },
    ],
    confidenceBand: 'explicit',
});

const projection = Object.freeze({
    schemaVersion: VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION,
    projectionId: 'vvp_visibleproj12345',
    projectionHash: HASH_A,
    source: 'target-chat-readback',
    releaseId: 'rel_uap7_visible',
    scenarioId: 'scenario-visible',
    scenarioVersion: '1.0.0',
    arcId: 'main',
    chatId: 'chat-visible-001',
    characterRef: {
        mode: 'single-character',
        refHash: HASH_B,
    },
    sourceMessageIndex: 4,
    sourceMessageHash: HASH_C,
    visibleTextDigest: HASH_D,
    locale: 'mixed',
    entities: [baseEntity],
    extractorVersion: 'vs1-sg',
    dictionaryVersion: 'dict-v1',
    dictionaryHash: HASH_E,
    createdAt: ISO_NOW,
});

const stub = Object.freeze({
    schemaVersion: VISUAL_PROJECTION_STUB_PROTOCOL_VERSION,
    projectionId: projection.projectionId,
    projectionHash: projection.projectionHash,
    sourceMessageHash: projection.sourceMessageHash,
    releaseId: projection.releaseId,
    scenarioId: projection.scenarioId,
    scenarioVersion: projection.scenarioVersion,
    arcId: projection.arcId,
    chatId: projection.chatId,
    profileId: 'vprof_visibleprofile01',
    profileHash: HASH_F,
    catalogId: 'vc_catalog01',
    catalogRevision: 7,
    catalogHash: HASH_B,
    sourceMessageIndex: projection.sourceMessageIndex,
    entities: projection.entities,
    extractorVersion: projection.extractorVersion,
    dictionaryVersion: projection.dictionaryVersion,
    dictionaryHash: projection.dictionaryHash,
    expiresAt: ISO_LATER,
});

const proof = Object.freeze({
    schemaVersion: VISUAL_PROJECTION_PROOF_PROTOCOL_VERSION,
    audience: 'visual-asset-service',
    purpose: 'visual-match',
    projectionId: stub.projectionId,
    projectionHash: stub.projectionHash,
    sourceMessageHash: stub.sourceMessageHash,
    releaseId: stub.releaseId,
    scenarioId: stub.scenarioId,
    scenarioVersion: stub.scenarioVersion,
    arcId: stub.arcId,
    chatId: stub.chatId,
    profileId: stub.profileId,
    profileHash: stub.profileHash,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    sourceMessageIndex: stub.sourceMessageIndex,
    extractorVersion: stub.extractorVersion,
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
    nonce: 'nonce_abcdefghijklmnop',
    issuedAt: ISO_NOW,
    expiresAt: ISO_LATER,
    signature: 'signed-shape-only-not-authority-00000001',
});

const catalog = Object.freeze({
    schemaVersion: VISUAL_ASSET_CATALOG_PROTOCOL_VERSION,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
    status: 'published',
    assets: [
        IMMUTABLE_UNKNOWN_VISUAL_ASSETS.scene,
        IMMUTABLE_UNKNOWN_VISUAL_ASSETS.character,
        IMMUTABLE_UNKNOWN_VISUAL_ASSETS.equipment,
        IMMUTABLE_UNKNOWN_VISUAL_ASSETS.item,
        IMMUTABLE_UNKNOWN_VISUAL_ASSETS.skill,
        {
            assetId: 'asset_rustydagger01',
            assetVersion: 1,
            assetContentSha256: HEX_A,
            type: 'equipment',
        },
    ],
    createdAt: ISO_NOW,
    publishedAt: ISO_LATER,
});

const asset = Object.freeze({
    schemaVersion: VISUAL_ASSET_PROTOCOL_VERSION,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    assetId: 'asset_rustydagger01',
    assetVersion: 1,
    assetContentSha256: HEX_A,
    type: 'equipment',
    title: 'Rusty dagger',
    caption: 'Visible equipment icon',
    tags: ['dagger', 'rusty', 'weapon'],
    localeTags: ['mixed'],
    styleTags: ['low-fantasy'],
    negativeTags: ['modern'],
    assetUri: 'visual-assets/aa/rusty-dagger.webp',
    thumbnailUri: 'visual-assets/aa/rusty-dagger-thumb.webp',
    mime: 'image/webp',
    width: 512,
    height: 512,
    transparentBackground: true,
    safeCrop: {
        mode: 'contain',
    },
    layerHint: 'icon',
    licenseCode: 'admin-owned',
    sourceLabel: 'Local visual library',
    status: 'published',
    createdAt: ISO_NOW,
    updatedAt: ISO_LATER,
});

const profile = Object.freeze({
    schemaVersion: ADMIN_VISUAL_PROFILE_PROTOCOL_VERSION,
    profileId: stub.profileId,
    profileRevision: 2,
    profileHash: stub.profileHash,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    templateCode: 'rpg-adventure',
    enabledTypes: ['scene', 'character', 'equipment', 'item', 'skill'],
    priorityRules: [
        { type: 'scene', weight: 70 },
        { type: 'character', weight: 90 },
        { type: 'equipment', weight: 60 },
    ],
    scenePolicy: 'ttl-message-count',
    characterPolicy: 'silhouette-only-until-explicit',
    equipmentPolicy: 'display-binding-on-first-visible-label',
    itemPolicy: 'display-binding-on-first-visible-label',
    skillPolicy: 'display-binding-on-first-visible-label',
    threshold: 20,
    allowProviderMatcher: false,
    allowAdminPatterns: false,
});

const dictionary = Object.freeze({
    schemaVersion: VISUAL_DICTIONARY_PROTOCOL_VERSION,
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
    tagCodes: ['dagger', 'rusty', 'weapon'],
    synonyms: {
        dagger: ['knife', 'shortblade'],
    },
    negativeTags: {
        modern: ['gun', 'laser'],
    },
    weights: {
        dagger: 90,
        rusty: 45,
    },
});

const matchResult = Object.freeze({
    schemaVersion: VISUAL_MATCH_RESULT_PROTOCOL_VERSION,
    matchId: 'vm_visiblematch12345',
    bindingId: 'vb_visiblebinding01',
    entityKey: baseEntity.entityKey,
    type: 'equipment',
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    visualProfileId: stub.profileId,
    profileHash: stub.profileHash,
    evidenceDigest: projection.visibleTextDigest,
    projectionId: projection.projectionId,
    sourceMessageIndex: projection.sourceMessageIndex,
    sourceMessageHash: projection.sourceMessageHash,
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetContentSha256: asset.assetContentSha256,
    matcherVersion: 'matcher-vs1-sg',
    scorerVersion: 'scorer-vs1-sg',
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
    score: 74,
    scoreBand: 'medium',
    reasonCodes: ['explicit-visible-label', 'type-match', 'tag-overlap'],
    usesLlm: false,
    createdAt: ISO_NOW,
    expiresAt: ISO_LATER,
});

const binding = Object.freeze({
    schemaVersion: VISUAL_BINDING_PROTOCOL_VERSION,
    bindingId: matchResult.bindingId,
    bindingType: matchResult.type,
    entityKey: matchResult.entityKey,
    releaseId: stub.releaseId,
    scenarioId: stub.scenarioId,
    scenarioVersion: stub.scenarioVersion,
    arcId: stub.arcId,
    chatId: stub.chatId,
    sourceMessageIndex: matchResult.sourceMessageIndex,
    sourceMessageHash: matchResult.sourceMessageHash,
    evidenceDigest: matchResult.evidenceDigest,
    projectionId: matchResult.projectionId,
    visualProfileId: matchResult.visualProfileId,
    profileHash: matchResult.profileHash,
    catalogId: matchResult.catalogId,
    catalogRevision: matchResult.catalogRevision,
    catalogHash: matchResult.catalogHash,
    assetId: matchResult.assetId,
    assetVersion: matchResult.assetVersion,
    assetContentSha256: matchResult.assetContentSha256,
    matcherVersion: matchResult.matcherVersion,
    scorerVersion: matchResult.scorerVersion,
    dictionaryVersion: matchResult.dictionaryVersion,
    dictionaryHash: matchResult.dictionaryHash,
    score: matchResult.score,
    scoreBand: matchResult.scoreBand,
    reasonCodes: matchResult.reasonCodes,
    bindingPolicy: 'entity-first-seen-fixed',
    idempotencyKey: 'idem_visiblebinding0000001',
    createdAt: ISO_NOW,
    updatedAt: ISO_LATER,
    expiresAt: ISO_LATER,
});

const expectedScope = Object.freeze({
    releaseId: stub.releaseId,
    scenarioId: stub.scenarioId,
    scenarioVersion: stub.scenarioVersion,
    arcId: stub.arcId,
    chatId: stub.chatId,
    projectionId: projection.projectionId,
    sourceMessageIndex: projection.sourceMessageIndex,
    sourceMessageHash: projection.sourceMessageHash,
    evidenceDigest: projection.visibleTextDigest,
    visualProfileId: stub.profileId,
    profileHash: stub.profileHash,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
});

assertValid('projection', validateVisualVisibleProjection(projection));
assertValid('stub', validateVisualProjectionStub(stub));
assertValid('proof shape', validateVisualProjectionProofShape(proof));
assertValid('catalog', validateVisualAssetCatalog(catalog));
assertValid('asset', validateVisualAsset(asset));
assertValid('profile', validateAdminVisualProfile(profile));
assertValid('dictionary', validateVisualDictionary(dictionary));
assertValid('match result', validateVisualMatchResult(matchResult, expectedScope));
assertValid('binding', validateVisualBinding(binding, expectedScope));

assertInvalid('projection unknown root key', validateVisualVisibleProjection({ ...projection, extra: true }), 'projection.extra');
assertInvalid('projection forbidden nested prompt', validateVisualVisibleProjection({
    ...projection,
    entities: [
        {
            ...baseEntity,
            visibleAttributes: [
                ...baseEntity.visibleAttributes,
                { code: 'equipment-visible-trait', value: 'sharp', confidenceBand: 'explicit', prompt: 'steal this' },
            ],
        },
    ],
}), 'forbidden');
assertInvalid('projection forbidden case variant', validateVisualVisibleProjection({
    ...projection,
    entities: [{ ...baseEntity, Prompt: 'do not obey visible text' }],
}), 'forbidden');
assertInvalid('projection prototype pollution', validateVisualVisibleProjection(JSON.parse(`{"schemaVersion":"${VISUAL_VISIBLE_PROJECTION_PROTOCOL_VERSION}","projectionId":"${projection.projectionId}","projectionHash":"${projection.projectionHash}","source":"target-chat-readback","releaseId":"${projection.releaseId}","scenarioId":"${projection.scenarioId}","scenarioVersion":"${projection.scenarioVersion}","arcId":"${projection.arcId}","chatId":"${projection.chatId}","sourceMessageIndex":4,"sourceMessageHash":"${projection.sourceMessageHash}","visibleTextDigest":"${projection.visibleTextDigest}","locale":"mixed","entities":[],"extractorVersion":"vs1-sg","dictionaryVersion":"dict-v1","dictionaryHash":"${projection.dictionaryHash}","createdAt":"${ISO_NOW}","__proto__":{"polluted":true}}`)), '__proto__');
assertInvalid('projection too many entities', validateVisualVisibleProjection({
    ...projection,
    entities: Array.from({ length: 33 }, (_, index) => ({ ...baseEntity, entityKey: `entity_equipment_many-${String(index).padStart(8, '0')}` })),
}), '0 to 32');
assertInvalid('projection duplicate entity', validateVisualVisibleProjection({ ...projection, entities: [baseEntity, baseEntity] }), 'duplicated');
assertInvalid('stub bad hash', validateVisualProjectionStub({ ...stub, catalogHash: `sha256:${'g'.repeat(64)}` }), 'catalogHash');
assertInvalid('proof bad audience', validateVisualProjectionProofShape({ ...proof, audience: 'browser' }), 'proof.audience');
assertInvalid('proof bad chronology', validateVisualProjectionProofShape({ ...proof, expiresAt: ISO_NOW }), 'later than');
assertInvalid('proof replay cache field rejected', validateVisualProjectionProofShape({ ...proof, replayCache: true }), 'replayCache');
assertInvalid('catalog missing unknown asset', validateVisualAssetCatalog({ ...catalog, assets: catalog.assets.filter((entry) => entry.assetId !== 'unknown_skill') }), 'unknown asset for skill');
assertInvalid('catalog duplicate asset ref', validateVisualAssetCatalog({ ...catalog, assets: [...catalog.assets, catalog.assets[0]] }), 'duplicates');
assertInvalid('catalog unknown typed asset rejected', validateVisualAssetCatalog({
    ...catalog,
    assets: [...catalog.assets, { assetId: 'asset_unknownkind01', assetVersion: 1, assetContentSha256: HEX_B, type: 'unknown' }],
}), 'catalog.assets[6].type');
assertInvalid('asset http uri rejected', validateVisualAsset({ ...asset, assetUri: 'https://example.test/rusty.webp' }), 'relative image path');
assertInvalid('asset data uri rejected', validateVisualAsset({ ...asset, thumbnailUri: 'data:image/png;base64,AAA=' }), 'relative image path');
assertInvalid('asset control chars rejected', validateVisualAsset({ ...asset, title: 'bad\u0001title' }), 'control characters');
assertInvalid('asset unknown type rejected', validateVisualAsset({ ...asset, type: 'unknown' }), 'asset.type');
assertInvalid('profile provider matcher rejected', validateAdminVisualProfile({ ...profile, allowProviderMatcher: true }), 'allowProviderMatcher');
assertInvalid('profile admin patterns rejected', validateAdminVisualProfile({ ...profile, adminPatterns: [] }), 'adminPatterns');
assertInvalid('profile duplicate enabled type rejected', validateAdminVisualProfile({ ...profile, enabledTypes: ['scene', 'scene'] }), 'duplicate');
assertInvalid('dictionary duplicate tag rejected', validateVisualDictionary({ ...dictionary, tagCodes: ['dagger', 'dagger'] }), 'duplicated');
assertInvalid('dictionary infinity weight rejected', validateVisualDictionary({ ...dictionary, weights: { dagger: Number.POSITIVE_INFINITY } }), 'finite number');
assertInvalid('match result missing provenance rejected', validateVisualMatchResult(removeKey(matchResult, 'catalogHash'), expectedScope), 'catalogHash');
assertInvalid('match result llm rejected', validateVisualMatchResult({ ...matchResult, usesLlm: true }, expectedScope), 'usesLlm');
assertInvalid('match result bad reason rejected', validateVisualMatchResult({ ...matchResult, reasonCodes: ['LLM said so'] }, expectedScope), 'unsupported value');
assertInvalid('match result scope mismatch rejected', validateVisualMatchResult({ ...matchResult, catalogRevision: 8 }, expectedScope), 'expected scope');
assertInvalid('match result unknown type rejected', validateVisualMatchResult({ ...matchResult, type: 'unknown' }, expectedScope), 'matchResult.type');
assertInvalid('binding stale profile rejected', validateVisualBinding({ ...binding, profileHash: HASH_A }, expectedScope), 'expected scope');
assertInvalid('binding unknown type rejected', validateVisualBinding({ ...binding, bindingType: 'unknown' }, expectedScope), 'binding.bindingType');
assertInvalid('unknown score must use unknown asset', validateVisualMatchResult({
    ...matchResult,
    score: 19,
    scoreBand: 'unknown',
    reasonCodes: ['unknown-fallback'],
}), 'immutable');
assert.equal(getImmutableUnknownVisualAssetRef('unknown'), null);

const unknownPolicy = applyVisualScorePolicy({
    type: 'equipment',
    score: 87,
    confidenceBand: 'explicit',
    hasExplicitVisibleLabel: false,
    candidateCount: 4,
});
assert.equal(unknownPolicy.ok, true);
assert.equal(unknownPolicy.score, 0);
assert.equal(unknownPolicy.isUnknown, true);
assert.deepEqual(unknownPolicy.assetRef, getImmutableUnknownVisualAssetRef('equipment'));
assert.equal(isImmutableUnknownVisualAssetRef(unknownPolicy.assetRef, 'equipment'), true);

const ambiguousCharacterPolicy = applyVisualScorePolicy({
    type: 'character',
    score: 91,
    confidenceBand: 'probable',
    hasExplicitAppearanceEvidence: false,
    candidateCount: 5,
});
assert.equal(ambiguousCharacterPolicy.score, 19);
assert.equal(ambiguousCharacterPolicy.isUnknown, true);
assert.equal(ambiguousCharacterPolicy.assetRef.assetId, 'unknown_character');

const emptyCandidatePolicy = applyVisualScorePolicy({
    type: 'scene',
    score: 65,
    confidenceBand: 'explicit',
    candidateCount: 0,
});
assert.equal(emptyCandidatePolicy.score, 0);
assert.equal(emptyCandidatePolicy.reasonCodes.includes('candidate-empty'), true);
assert.equal(emptyCandidatePolicy.assetRef.assetId, 'unknown_scene');

const invalidTypePolicy = applyVisualScorePolicy({
    type: 'unknown',
    score: 50,
    confidenceBand: 'explicit',
    reasonCodes: [],
});
assert.equal(invalidTypePolicy.ok, false);
assert.equal(invalidTypePolicy.errors.some((error) => error.includes('bindable visual type')), true);
assert.equal(invalidTypePolicy.assetRef, null);

const invalidReasonPolicy = applyVisualScorePolicy({
    type: 'scene',
    score: 50,
    confidenceBand: 'explicit',
    reasonCodes: ['made-up-reason'],
});
assert.equal(invalidReasonPolicy.ok, false);
assert.equal(invalidReasonPolicy.errors.some((error) => error.includes('unsupported value')), true);

const duplicateReasonPolicy = applyVisualScorePolicy({
    type: 'scene',
    score: 50,
    confidenceBand: 'explicit',
    reasonCodes: ['type-match', 'type-match'],
});
assert.equal(duplicateReasonPolicy.ok, false);
assert.equal(duplicateReasonPolicy.errors.some((error) => error.includes('duplicate')), true);

const wrongReasonTypePolicy = applyVisualScorePolicy({
    type: 'scene',
    score: 50,
    confidenceBand: 'explicit',
    reasonCodes: 'type-match',
});
assert.equal(wrongReasonTypePolicy.ok, false);
assert.equal(wrongReasonTypePolicy.errors.some((error) => error.includes('must be an array')), true);

const nanPolicy = applyVisualScorePolicy({
    type: 'scene',
    score: Number.NaN,
    confidenceBand: 'explicit',
    reasonCodes: [],
});
assert.equal(nanPolicy.ok, false);
assert.equal(nanPolicy.errors.some((error) => error.includes('integer')), true);

const infinityPolicy = applyVisualScorePolicy({
    type: 'scene',
    score: Number.POSITIVE_INFINITY,
    confidenceBand: 'explicit',
    reasonCodes: [],
});
assert.equal(infinityPolicy.ok, false);
assert.equal(infinityPolicy.errors.some((error) => error.includes('integer')), true);

const scopedResolution = resolveVisualMatchResultForScope({ ...matchResult, profileHash: HASH_A }, expectedScope);
assert.equal(scopedResolution.ok, false);
assert.equal(scopedResolution.unknownAsset.assetId, 'unknown_equipment');

const malformedResolution = resolveVisualMatchResultForScope(null, expectedScope);
assert.equal(malformedResolution.ok, false);
assert.equal(malformedResolution.unknownAsset, null);
assert.equal(malformedResolution.errors.some((error) => error.includes('valid bindable type')), true);

const missingTypeResolution = resolveVisualMatchResultForScope(removeKey(matchResult, 'type'), expectedScope);
assert.equal(missingTypeResolution.ok, false);
assert.equal(missingTypeResolution.unknownAsset, null);
assert.equal(missingTypeResolution.errors.some((error) => error.includes('valid bindable type')), true);

const unknownTypeResolution = resolveVisualMatchResultForScope({ ...matchResult, type: 'unknown' }, expectedScope);
assert.equal(unknownTypeResolution.ok, false);
assert.equal(unknownTypeResolution.unknownAsset, null);
assert.equal(unknownTypeResolution.errors.some((error) => error.includes('valid bindable type')), true);

const exportNames = Object.keys(visualSchema).sort();
assert.equal(exportNames.some((name) => /verify|authorize|hmac|signer|replay|stubReadback/i.test(name)), false);
assert.equal(exportNames.some((name) => /writeBinding|createBinding|bindingWriter|postBinding|visualServiceClient|fetchVisual/i.test(name)), false);
assert.equal(exportNames.includes('validateVisualProjectionProofShape'), true);

console.log('visual system schema/proof-shape guard tests passed');

function assertValid(label, status) {
    assert.equal(status.valid, true, `${label} should pass: ${status.errors.join(' | ')}`);
}

function assertInvalid(label, status, expectedText) {
    assert.equal(status.valid, false, `${label} should fail`);
    assert.equal(
        status.errors.some((error) => error.includes(expectedText)),
        true,
        `${label} should include "${expectedText}" in ${status.errors.join(' | ')}`,
    );
}

function digest(char) {
    return `sha256:${char.repeat(64)}`;
}

function removeKey(source, key) {
    const next = { ...source };
    delete next[key];
    return next;
}
