import assert from 'node:assert/strict';

import {
    ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
    PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION,
    convertPresentationRecommendationToProfile,
    validatePresentationRecommendation,
} from '../src/adaptive-presentation-schema.js';

const context = Object.freeze({
    recommendationId: 'rec_rpgsafe123456',
    sourceDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    draftId: 'draft_rpgsafe01',
    revision: 3,
    currentRevision: 3,
    evidenceDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    usesLlm: true,
    profileId: 'profile_rpgsafe123456',
});

const validRecommendation = Object.freeze({
    schemaVersion: PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION,
    recommendationId: context.recommendationId,
    sourceDigest: context.sourceDigest,
    draftId: context.draftId,
    revision: context.revision,
    detectedGenre: 'rpg-adventure',
    confidence: 0.91,
    recommendedProfile: {
        template: 'rpg-adventure',
        preferredModules: ['rpg-status', 'inventory', 'abilities', 'quests', 'actions'],
        disabledModules: ['affection'],
        visualPriority: {
            primaryPanel: 'rpg-status',
            secondaryPanels: ['inventory', 'abilities'],
            collapseBelowWidth: 640,
        },
        extractionPolicy: {
            confidenceThreshold: 0.82,
            maxRecentMessages: 6,
            allowBuiltinPatterns: true,
            allowAdminPatterns: false,
            lowConfidenceBehavior: 'plain-dialogue',
        },
    },
    evidence: {
        evidenceDigest: context.evidenceDigest,
        sourceKind: 'uploaded-admin-material',
        matchedSignals: ['signal-hp-ac-format', 'signal-inventory-section', 'signal-attack-section'],
        exampleTemplateCodes: ['example-hp-current-max', 'example-inventory-visible-list'],
    },
    safeWarnings: ['warning-admin-review-required', 'warning-patterns-disabled'],
    noClaim: [
        'no-frontend-combat-calculation',
        'no-frontend-inventory-authority',
        'no-runtime-llm-assistant',
    ],
    usesLlm: true,
});

const validStatus = validatePresentationRecommendation(validRecommendation, context);
assert.equal(validStatus.valid, true, validStatus.errors.join('\n'));

const conversion = convertPresentationRecommendationToProfile(validRecommendation, context);
assert.equal(conversion.ok, true, conversion.errors.join('\n'));
assert.equal(conversion.profile.schemaVersion, ADAPTIVE_PRESENTATION_PROTOCOL_VERSION);
assert.equal(conversion.profile.profileId, context.profileId);
assert.equal(conversion.profile.template, 'rpg-adventure');
assert.deepEqual(conversion.profile.preferredModules, ['rpg-status', 'inventory', 'abilities', 'quests', 'actions']);
assert.equal(conversion.profile.extractionPolicy.allowAdminPatterns, false);
assert.deepEqual(conversion.profile.adminPatterns, []);
assert.equal(JSON.stringify(conversion.profile).includes('matchedSignals'), false);
assert.equal(JSON.stringify(conversion.profile).includes('safeWarnings'), false);
assert.equal(JSON.stringify(conversion.profile).includes('exampleTemplateCodes'), false);
assert.equal(JSON.stringify(conversion.profile).includes('rawRecommendation'), false);

assertInvalid('missing service context', validRecommendation, {}, 'requires a service-derived');
assertInvalid('unknown root key', withPatch({ extra: true }), context, 'recommendation.extra is not allowed');
assertInvalid('unknown nested key', withPatch({ recommendedProfile: { ...validRecommendation.recommendedProfile, displayText: 'RPG' } }), context, 'displayText is not allowed');
assertInvalid('prototype pollution key', JSON.parse(`{"schemaVersion":"${PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION}","recommendationId":"${context.recommendationId}","sourceDigest":"${context.sourceDigest}","draftId":"${context.draftId}","revision":3,"detectedGenre":"rpg-adventure","confidence":0.91,"recommendedProfile":{"template":"rpg-adventure","preferredModules":["actions"]},"evidence":{"evidenceDigest":"${context.evidenceDigest}","sourceKind":"uploaded-admin-material","matchedSignals":[]},"safeWarnings":[],"noClaim":[],"usesLlm":true,"__proto__":{"polluted":true}}`), context, '__proto__');
assertInvalid('redactedExamples rejected', withPatch({ evidence: { ...validRecommendation.evidence, redactedExamples: ['Anna whispered'] } }), context, 'redactedExamples');
assertInvalid('provider text example rejected', withPatch({ evidence: { ...validRecommendation.evidence, exampleTemplateCodes: ['HP: 12/20'] } }), context, 'unsupported value');
assertInvalid('unknown signal code rejected', withPatch({ evidence: { ...validRecommendation.evidence, matchedSignals: ['hp-ac-format'] } }), context, 'unsupported value');
assertInvalid('duplicate signal code rejected', withPatch({ evidence: { ...validRecommendation.evidence, matchedSignals: ['signal-hp-ac-format', 'signal-hp-ac-format'] } }), context, 'duplicate');
assertInvalid('unknown warning code rejected', withPatch({ safeWarnings: ['AI thinks this is RPG'] }), context, 'unsupported value');
assertInvalid('unknown noClaim code rejected', withPatch({ noClaim: ['no-local-inventory'] }), context, 'unsupported value');
assertInvalid('NaN confidence rejected', withPatch({ confidence: Number.NaN }), context, 'finite number');
assertInvalid('Infinity confidence rejected', withPatch({ confidence: Number.POSITIVE_INFINITY }), context, 'finite number');
assertInvalid('revision zero rejected', withPatch({ revision: 0 }), { ...context, revision: 0 }, 'integer');
assertInvalid('revision mismatch rejected', withPatch({ revision: 2 }), context, 'service-derived revision');
assertInvalid('old current revision rejected', withPatch({ revision: 2 }), { ...context, revision: 2, currentRevision: 3 }, 'current draft revision');
assertInvalid('source mismatch rejected', withPatch({ sourceDigest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' }), context, 'service-derived sourceDigest');
assertInvalid('draft mismatch rejected', withPatch({ draftId: 'draft_other001' }), context, 'service-derived draftId');
assertInvalid('fake usesLlm rejected', withPatch({ usesLlm: true }), { ...context, usesLlm: false }, 'service-derived usesLlm');
assertInvalid('allowAdminPatterns true rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        extractionPolicy: { ...validRecommendation.recommendedProfile.extractionPolicy, allowAdminPatterns: true },
    },
}), context, 'allowAdminPatterns must be false');
assertInvalid('adminPatterns rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        adminPatterns: [{ pattern: 'HP: (.+)' }],
    },
}), context, 'adminPatterns');
assertInvalid('regex body rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        regex: '^HP',
    },
}), context, 'regex');
assertInvalid('dangerous nested choices rejected', withPatch({
    evidence: {
        ...validRecommendation.evidence,
        nested: { choices: ['Attack'] },
    },
}), context, 'nested');
assertInvalid('preferred duplicate rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        preferredModules: ['actions', 'actions'],
    },
}), context, 'duplicate');
assertInvalid('preferred too many rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        preferredModules: [
            'actions',
            'rpg-status',
            'inventory',
            'abilities',
            'quests',
            'relationships',
            'affection',
            'gifts',
            'events',
            'calendar',
            'clues',
            'suspects',
            'locations',
        ],
    },
}), context, '1 to 12');
assertInvalid('visual priority disabled module rejected', withPatch({
    recommendedProfile: {
        ...validRecommendation.recommendedProfile,
        visualPriority: { ...validRecommendation.recommendedProfile.visualPriority, primaryPanel: 'affection' },
    },
}), context, 'enabled by preferredModules');

const fallbackContext = { ...context, recommendationId: 'rec_vnsafe123456', usesLlm: false };
const deterministicRecommendation = {
    ...structuredClone(validRecommendation),
    recommendationId: fallbackContext.recommendationId,
    usesLlm: false,
    detectedGenre: 'visual-novel',
    recommendedProfile: {
        template: 'visual-novel',
        preferredModules: ['actions', 'notes'],
        extractionPolicy: { allowAdminPatterns: false },
    },
    evidence: {
        evidenceDigest: context.evidenceDigest,
        sourceKind: 'uploaded-admin-material',
        matchedSignals: ['signal-vn-dialogue-format'],
        exampleTemplateCodes: ['example-action-options'],
    },
    safeWarnings: ['warning-deterministic-fallback-used'],
    noClaim: ['no-runtime-llm-assistant'],
};
assert.equal(validatePresentationRecommendation(deterministicRecommendation, fallbackContext).valid, true);

const badProfileIdConversion = convertPresentationRecommendationToProfile(validRecommendation, {
    ...context,
    profileId: 'bad profile id',
});
assert.equal(badProfileIdConversion.ok, false);
assert.equal(badProfileIdConversion.errors.some((error) => error.includes('context.profileId')), true);

console.log('presentation recommendation schema tests passed');

function withPatch(patch) {
    return deepMerge(structuredClone(validRecommendation), patch);
}

function deepMerge(base, patch) {
    for (const [key, value] of Object.entries(patch)) {
        if (isPlainObject(value) && isPlainObject(base[key])) {
            deepMerge(base[key], value);
        } else {
            base[key] = value;
        }
    }
    return base;
}

function assertInvalid(label, recommendation, validationContext, expectedText) {
    const status = validatePresentationRecommendation(recommendation, validationContext);
    assert.equal(status.valid, false, `${label} should fail validation`);
    assert.equal(
        status.errors.some((error) => error.includes(expectedText)),
        true,
        `${label} should include "${expectedText}" in ${status.errors.join(' | ')}`,
    );
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
