export const ADAPTIVE_PRESENTATION_PROTOCOL_VERSION = 'galgame.adaptive-presentation.v1';
export const ADAPTIVE_EXTRACTION_RESULT_PROTOCOL_VERSION = 'galgame.presentation-extraction-result.v1';
export const PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION = 'galgame.presentation-recommendation.v1';

export const PRESENTATION_TEMPLATES = Object.freeze([
    'visual-novel',
    'rpg-adventure',
    'romance-social',
    'mystery-investigation',
    'management-sim',
    'sandbox-roleplay',
]);

export const PRESENTATION_MODULES = Object.freeze([
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
    'factions',
    'resources',
    'objectives',
    'dice',
    'notes',
]);

export const PRESENTATION_MATCHED_SIGNAL_CODES = Object.freeze([
    'signal-vn-dialogue-format',
    'signal-action-options-format',
    'signal-hp-ac-format',
    'signal-inventory-section',
    'signal-equipment-section',
    'signal-attack-section',
    'signal-skill-list',
    'signal-quest-objective',
    'signal-dice-roll',
    'signal-affection-score',
    'signal-relationship-stage',
    'signal-gift-event',
    'signal-calendar-event',
    'signal-clue-section',
    'signal-suspect-section',
    'signal-location-section',
    'signal-resource-counter',
    'signal-faction-status',
    'signal-sandbox-notes',
    'signal-unknown-structure',
]);

export const PRESENTATION_EXAMPLE_TEMPLATE_CODES = Object.freeze([
    'example-hp-current-max',
    'example-inventory-visible-list',
    'example-equipment-with-visible-traits',
    'example-affection-score',
    'example-clue-list',
    'example-resource-counter',
    'example-action-options',
]);

export const PRESENTATION_SAFE_WARNING_CODES = Object.freeze([
    'warning-low-confidence',
    'warning-ambiguous-template',
    'warning-conflicting-signals',
    'warning-no-stable-status-format',
    'warning-no-opening-chat-detected',
    'warning-missing-character-reference',
    'warning-missing-worldbook-reference',
    'warning-admin-review-required',
    'warning-deterministic-fallback-used',
    'warning-provider-output-rejected',
    'warning-profile-not-published',
    'warning-patterns-disabled',
]);

export const PRESENTATION_NO_CLAIM_CODES = Object.freeze([
    'no-frontend-combat-calculation',
    'no-frontend-inventory-authority',
    'no-frontend-affection-calculation',
    'no-frontend-resource-calculation',
    'no-chapter-ending-judgment',
    'no-runtime-llm-assistant',
    'no-hidden-resource-reading',
    'no-prompt-context-copy',
    'no-regenerate-undo-swipe-group-quickreply',
    'no-preset-instruct-context-switching',
]);

export const BUILTIN_TEMPLATE_MODULES = Object.freeze({
    'visual-novel': ['actions', 'notes'],
    'rpg-adventure': ['rpg-status', 'inventory', 'abilities', 'quests', 'dice', 'actions'],
    'romance-social': ['relationships', 'affection', 'gifts', 'calendar', 'events', 'actions'],
    'mystery-investigation': ['clues', 'locations', 'suspects', 'objectives', 'notes', 'actions'],
    'management-sim': ['resources', 'factions', 'objectives', 'calendar', 'actions'],
    'sandbox-roleplay': ['locations', 'relationships', 'objectives', 'notes', 'actions'],
});

const TEMPLATE_SET = new Set(PRESENTATION_TEMPLATES);
const MODULE_SET = new Set(PRESENTATION_MODULES);
const MATCHED_SIGNAL_SET = new Set(PRESENTATION_MATCHED_SIGNAL_CODES);
const EXAMPLE_TEMPLATE_SET = new Set(PRESENTATION_EXAMPLE_TEMPLATE_CODES);
const SAFE_WARNING_SET = new Set(PRESENTATION_SAFE_WARNING_CODES);
const NO_CLAIM_SET = new Set(PRESENTATION_NO_CLAIM_CODES);
const LOW_CONFIDENCE_BEHAVIORS = new Set(['plain-dialogue', 'history-only']);
const PATTERN_KINDS = new Set(['regex', 'line-prefix', 'table-like', 'key-value-block']);
const PROFILE_KEYS = new Set([
    'schemaVersion',
    'profileId',
    'template',
    'preferredModules',
    'disabledModules',
    'extractionPolicy',
    'adminPatterns',
    'visualPriority',
]);
const EXTRACTION_POLICY_KEYS = new Set([
    'confidenceThreshold',
    'maxRecentMessages',
    'allowAdminPatterns',
    'allowBuiltinPatterns',
    'lowConfidenceBehavior',
]);
const PATTERN_KEYS = new Set([
    'id',
    'module',
    'source',
    'patternKind',
    'pattern',
    'fields',
    'confidence',
    'locale',
]);
const VISUAL_PRIORITY_KEYS = new Set(['primaryPanel', 'secondaryPanels', 'collapseBelowWidth']);
const CONFIGURATION_SOURCE_KINDS = new Set(['admin-profile', 'builtin-template', 'builtin-pattern']);
const RECOMMENDATION_KEYS = new Set([
    'schemaVersion',
    'recommendationId',
    'sourceDigest',
    'draftId',
    'revision',
    'detectedGenre',
    'confidence',
    'recommendedProfile',
    'evidence',
    'safeWarnings',
    'noClaim',
    'usesLlm',
]);
const RECOMMENDED_PROFILE_KEYS = new Set([
    'template',
    'preferredModules',
    'disabledModules',
    'visualPriority',
    'extractionPolicy',
]);
const RECOMMENDATION_EVIDENCE_KEYS = new Set([
    'evidenceDigest',
    'sourceKind',
    'matchedSignals',
    'exampleTemplateCodes',
]);

// These keys indicate original resource bodies, prompts, or story-authority data.
// Profiles must store references and display rules only; original resource body fields are rejected.
const forbiddenBodyKeys = new Set([
    'content',
    'entries',
    'entry',
    'prompt',
    'systemPrompt',
    'description',
    'personality',
    'scenario',
    'firstMessage',
    'mes_example',
    'characterBook',
    'character_book',
    'lore',
    'data',
]);

const FORBIDDEN_PROFILE_AUTHORITY_KEYS = new Set([
    'hp',
    'mp',
    'xp',
    'gold',
    'inventory',
    'items',
    'affection',
    'relationship',
    'relationships',
    'quest',
    'quests',
    'clues',
    'resources',
    'variables',
    'flags',
    'node',
    'route',
    'ending',
    'choice',
    'choices',
]);

const FORBIDDEN_RESULT_AUTHORITY_KEYS = new Set([
    'variables',
    'flags',
    'node',
    'route',
    'ending',
    'choice',
    'choices',
]);

const FORBIDDEN_RECOMMENDATION_KEYS = new Set([
    'adminPatterns',
    'regex',
    'redactedExamples',
    'providerSummary',
    'providerResponse',
    'uploadText',
    'uploadedText',
    'rawRecommendation',
    'rawExamples',
    'dialogue',
    'message',
    'choices',
    'options',
    'nodes',
    'storyNodes',
    'ending',
    'endings',
    'route',
    'branch',
    'relationshipState',
    'affectionValue',
    'inventoryState',
    'hp',
    'mp',
    'xp',
    'gold',
    'resourceState',
    'sceneresult',
    'narrativeruntime',
    'continuesession',
    'runtimeStory',
    'localState',
    'prompt',
    'context',
    'system',
    'instruct',
    'characterCard',
    'worldBookEntries',
    'resourceBody',
    'manifestBody',
]);

const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RECOMMENDATION_ID_PATTERN = /^rec_[a-z0-9_-]{12,80}$/;
const PROFILE_ID_PATTERN = /^profile_[a-z0-9_-]{12,80}$/;
const DRAFT_ID_PATTERN = /^draft_[a-z0-9_-]{8,80}$/;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function isPresentationTemplate(value) {
    return TEMPLATE_SET.has(value);
}

export function isPresentationModule(value) {
    return MODULE_SET.has(value);
}

export function isPresentationMatchedSignalCode(value) {
    return MATCHED_SIGNAL_SET.has(value);
}

export function isPresentationExampleTemplateCode(value) {
    return EXAMPLE_TEMPLATE_SET.has(value);
}

export function isPresentationSafeWarningCode(value) {
    return SAFE_WARNING_SET.has(value);
}

export function isPresentationNoClaimCode(value) {
    return NO_CLAIM_SET.has(value);
}

export function createDefaultAdaptivePresentationProfile(overrides = {}) {
    return normalizeAdaptivePresentationProfile({
        schemaVersion: ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
        profileId: 'default-visual-novel',
        template: 'visual-novel',
        preferredModules: BUILTIN_TEMPLATE_MODULES['visual-novel'],
        disabledModules: [],
        extractionPolicy: {
            confidenceThreshold: 0.75,
            maxRecentMessages: 4,
            allowAdminPatterns: true,
            allowBuiltinPatterns: true,
            lowConfidenceBehavior: 'plain-dialogue',
        },
        adminPatterns: [],
        visualPriority: {
            primaryPanel: 'actions',
            secondaryPanels: [],
            collapseBelowWidth: 640,
        },
        ...overrides,
    });
}

export function normalizeAdaptivePresentationProfile(profile = {}) {
    const source = isPlainObject(profile) ? profile : {};
    const template = isPresentationTemplate(source.template) ? source.template : 'visual-novel';
    const defaults = BUILTIN_TEMPLATE_MODULES[template] || BUILTIN_TEMPLATE_MODULES['visual-novel'];
    const extractionPolicy = isPlainObject(source.extractionPolicy) ? source.extractionPolicy : {};

    return {
        schemaVersion: ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
        profileId: sanitizeId(source.profileId || `profile-${template}`),
        template,
        preferredModules: normalizeModuleList(source.preferredModules, defaults),
        disabledModules: normalizeModuleList(source.disabledModules, []),
        extractionPolicy: {
            confidenceThreshold: clampNumber(extractionPolicy.confidenceThreshold, 0.75, 0, 1),
            maxRecentMessages: Math.round(clampNumber(extractionPolicy.maxRecentMessages, 4, 1, 20)),
            allowAdminPatterns: extractionPolicy.allowAdminPatterns !== false,
            allowBuiltinPatterns: extractionPolicy.allowBuiltinPatterns !== false,
            lowConfidenceBehavior: LOW_CONFIDENCE_BEHAVIORS.has(extractionPolicy.lowConfidenceBehavior)
                ? extractionPolicy.lowConfidenceBehavior
                : 'plain-dialogue',
        },
        adminPatterns: normalizeAdminPatterns(source.adminPatterns),
        visualPriority: normalizeVisualPriority(source.visualPriority),
    };
}

export function validateAdaptivePresentationProfile(profile) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(profile)) {
        return { valid: false, errors: ['Adaptive presentation profile must be an object.'], warnings };
    }

    rejectUnknownKeys(profile, PROFILE_KEYS, 'profile', errors);
    rejectForbiddenKeys(profile, 'profile', errors, FORBIDDEN_PROFILE_AUTHORITY_KEYS);

    if (profile.schemaVersion !== ADAPTIVE_PRESENTATION_PROTOCOL_VERSION) {
        errors.push(`profile.schemaVersion must be ${ADAPTIVE_PRESENTATION_PROTOCOL_VERSION}.`);
    }
    requireString(profile.profileId, 'profile.profileId', errors);
    if (!isPresentationTemplate(profile.template)) {
        errors.push(`profile.template must be one of: ${PRESENTATION_TEMPLATES.join(', ')}.`);
    }
    validateModuleList(profile.preferredModules, 'profile.preferredModules', errors, false);
    validateModuleList(profile.disabledModules, 'profile.disabledModules', errors, false);

    if (profile.extractionPolicy !== undefined) {
        validateExtractionPolicy(profile.extractionPolicy, errors);
    }
    if (profile.adminPatterns !== undefined) {
        validateAdminPatterns(profile.adminPatterns, errors);
    }
    if (profile.visualPriority !== undefined) {
        validateVisualPriority(profile.visualPriority, errors);
    }

    return { valid: errors.length === 0, errors, warnings };
}

export function validateAdaptiveExtractionResult(result) {
    const errors = [];
    if (!isPlainObject(result)) {
        return { valid: false, errors: ['Extraction result must be an object.'] };
    }
    if (result.schemaVersion !== ADAPTIVE_EXTRACTION_RESULT_PROTOCOL_VERSION) {
        errors.push(`result.schemaVersion must be ${ADAPTIVE_EXTRACTION_RESULT_PROTOCOL_VERSION}.`);
    }
    if (!isPresentationModule(result.module)) {
        errors.push('result.module must be a known presentation module.');
    }
    if (!Number.isFinite(Number(result.confidence)) || Number(result.confidence) < 0 || Number(result.confidence) > 1) {
        errors.push('result.confidence must be a number from 0 to 1.');
    }
    if (!isPlainObject(result.evidenceSource) || result.evidenceSource.kind !== 'visible-chat-message') {
        errors.push('result.evidenceSource.kind must be visible-chat-message.');
    }
    if (result.configurationSource !== undefined) {
        if (!isPlainObject(result.configurationSource) || !CONFIGURATION_SOURCE_KINDS.has(result.configurationSource.kind)) {
            errors.push('result.configurationSource.kind must be admin-profile, builtin-template, or builtin-pattern.');
        }
    }
    if (!isPlainObject(result.values)) {
        errors.push('result.values must be an object.');
    } else {
        rejectForbiddenKeys(result.values, 'result.values', errors, FORBIDDEN_RESULT_AUTHORITY_KEYS);
    }
    if (result.displayOnly !== true) {
        errors.push('result.displayOnly must be true.');
    }
    return { valid: errors.length === 0, errors };
}

export function validatePresentationRecommendation(recommendation, context = {}) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(recommendation)) {
        return { valid: false, errors: ['Presentation recommendation must be an object.'], warnings };
    }

    rejectPrototypePollutionKeys(recommendation, 'recommendation', errors);
    rejectUnknownKeys(recommendation, RECOMMENDATION_KEYS, 'recommendation', errors);
    rejectForbiddenKeys(recommendation, 'recommendation', errors, FORBIDDEN_RECOMMENDATION_KEYS);

    if (recommendation.schemaVersion !== PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION) {
        errors.push(`recommendation.schemaVersion must be ${PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION}.`);
    }
    validatePatternString(recommendation.recommendationId, RECOMMENDATION_ID_PATTERN, 'recommendation.recommendationId', errors);
    validatePatternString(recommendation.sourceDigest, DIGEST_PATTERN, 'recommendation.sourceDigest', errors);
    validatePatternString(recommendation.draftId, DRAFT_ID_PATTERN, 'recommendation.draftId', errors);
    validatePositiveInteger(recommendation.revision, 'recommendation.revision', errors);
    if (recommendation.detectedGenre !== 'unknown' && !isPresentationTemplate(recommendation.detectedGenre)) {
        errors.push('recommendation.detectedGenre must be a known template or unknown.');
    }
    validateBoundedNumber(recommendation.confidence, 'recommendation.confidence', errors, 0, 1);
    if (typeof recommendation.usesLlm !== 'boolean') {
        errors.push('recommendation.usesLlm must be boolean.');
    }

    validateServiceDerivedField(recommendation, context, 'recommendationId', 'recommendation.recommendationId', errors);
    validateServiceDerivedField(recommendation, context, 'sourceDigest', 'recommendation.sourceDigest', errors);
    validateServiceDerivedField(recommendation, context, 'draftId', 'recommendation.draftId', errors);
    validateServiceDerivedField(recommendation, context, 'revision', 'recommendation.revision', errors);
    validateServiceDerivedField(recommendation, context, 'usesLlm', 'recommendation.usesLlm', errors);
    if (context.currentRevision !== undefined && recommendation.revision !== context.currentRevision) {
        errors.push('recommendation.revision must match the current draft revision.');
    }
    if (context.minimumRevision !== undefined && recommendation.revision < context.minimumRevision) {
        errors.push('recommendation.revision is older than the accepted minimum revision.');
    }

    validateRecommendedProfile(recommendation.recommendedProfile, errors);
    validateRecommendationEvidence(recommendation.evidence, context, errors);
    validateUniqueEnumArray(recommendation.safeWarnings, SAFE_WARNING_SET, 'recommendation.safeWarnings', errors, 0, 8);
    validateUniqueEnumArray(recommendation.noClaim, NO_CLAIM_SET, 'recommendation.noClaim', errors, 0, 12);
    validateSerializedSize(recommendation, 'recommendation', errors, 24 * 1024);

    return { valid: errors.length === 0, errors, warnings };
}

export function convertPresentationRecommendationToProfile(recommendation, context = {}) {
    const status = validatePresentationRecommendation(recommendation, context);
    if (!status.valid) {
        return { ok: false, errors: status.errors, warnings: status.warnings, profile: null };
    }
    if (context.profileId !== undefined && !PROFILE_ID_PATTERN.test(context.profileId)) {
        return { ok: false, errors: ['context.profileId has an invalid format.'], warnings: status.warnings, profile: null };
    }
    const recommended = recommendation.recommendedProfile;
    const policy = recommended.extractionPolicy || {};
    const visualPriority = recommended.visualPriority || {};
    const profileId = context.profileId || deriveProfileId(recommendation);
    const preferredModules = [...new Set(recommended.preferredModules || [])];
    const disabledModules = [...new Set(recommended.disabledModules || [])];
    const profile = {
        schemaVersion: ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
        profileId,
        template: recommended.template,
        preferredModules,
        disabledModules,
        extractionPolicy: {
            confidenceThreshold: policy.confidenceThreshold ?? 0.75,
            maxRecentMessages: policy.maxRecentMessages ?? 4,
            allowAdminPatterns: false,
            allowBuiltinPatterns: policy.allowBuiltinPatterns !== false,
            lowConfidenceBehavior: LOW_CONFIDENCE_BEHAVIORS.has(policy.lowConfidenceBehavior)
                ? policy.lowConfidenceBehavior
                : 'plain-dialogue',
        },
        adminPatterns: [],
        visualPriority: {
            primaryPanel: isPresentationModule(visualPriority.primaryPanel)
                ? visualPriority.primaryPanel
                : preferredModules[0] || 'actions',
            secondaryPanels: normalizeModuleList(visualPriority.secondaryPanels, [])
                .filter((moduleId) => preferredModules.includes(moduleId) && !disabledModules.includes(moduleId)),
            collapseBelowWidth: Math.round(clampNumber(visualPriority.collapseBelowWidth, 640, 320, 1440)),
        },
    };
    const profileStatus = validateAdaptivePresentationProfile(profile);
    if (!profileStatus.valid) {
        return { ok: false, errors: profileStatus.errors, warnings: profileStatus.warnings, profile: null };
    }
    return { ok: true, errors: [], warnings: status.warnings, profile };
}

function validateExtractionPolicy(policy, errors) {
    if (!isPlainObject(policy)) {
        errors.push('profile.extractionPolicy must be an object.');
        return;
    }
    rejectUnknownKeys(policy, EXTRACTION_POLICY_KEYS, 'profile.extractionPolicy', errors);
    if (policy.confidenceThreshold !== undefined && (!Number.isFinite(Number(policy.confidenceThreshold)) || Number(policy.confidenceThreshold) < 0 || Number(policy.confidenceThreshold) > 1)) {
        errors.push('profile.extractionPolicy.confidenceThreshold must be a number from 0 to 1.');
    }
    if (policy.maxRecentMessages !== undefined && (!Number.isFinite(Number(policy.maxRecentMessages)) || Number(policy.maxRecentMessages) < 1 || Number(policy.maxRecentMessages) > 20)) {
        errors.push('profile.extractionPolicy.maxRecentMessages must be a number from 1 to 20.');
    }
    for (const key of ['allowAdminPatterns', 'allowBuiltinPatterns']) {
        if (policy[key] !== undefined && typeof policy[key] !== 'boolean') {
            errors.push(`profile.extractionPolicy.${key} must be boolean.`);
        }
    }
    if (policy.lowConfidenceBehavior !== undefined && !LOW_CONFIDENCE_BEHAVIORS.has(policy.lowConfidenceBehavior)) {
        errors.push('profile.extractionPolicy.lowConfidenceBehavior must be plain-dialogue or history-only.');
    }
}

function validateRecommendedProfile(profile, errors) {
    if (!isPlainObject(profile)) {
        errors.push('recommendation.recommendedProfile must be an object.');
        return;
    }
    rejectPrototypePollutionKeys(profile, 'recommendation.recommendedProfile', errors);
    rejectUnknownKeys(profile, RECOMMENDED_PROFILE_KEYS, 'recommendation.recommendedProfile', errors);
    rejectForbiddenKeys(profile, 'recommendation.recommendedProfile', errors, FORBIDDEN_RECOMMENDATION_KEYS);
    if (!isPresentationTemplate(profile.template)) {
        errors.push('recommendation.recommendedProfile.template must be a known presentation template.');
    }
    validateUniqueEnumArray(profile.preferredModules, MODULE_SET, 'recommendation.recommendedProfile.preferredModules', errors, 1, 12);
    validateUniqueEnumArray(profile.disabledModules, MODULE_SET, 'recommendation.recommendedProfile.disabledModules', errors, 0, 12, true);
    if (Array.isArray(profile.preferredModules) && Array.isArray(profile.disabledModules)) {
        const disabled = new Set(profile.disabledModules);
        for (const moduleId of profile.preferredModules) {
            if (disabled.has(moduleId)) {
                errors.push(`recommendation.recommendedProfile.${moduleId} cannot be both preferred and disabled.`);
            }
        }
    }
    if (profile.extractionPolicy !== undefined) {
        validateRecommendationExtractionPolicy(profile.extractionPolicy, errors);
    }
    if (profile.visualPriority !== undefined) {
        validateRecommendationVisualPriority(profile.visualPriority, profile, errors);
    }
}

function validateRecommendationExtractionPolicy(policy, errors) {
    if (!isPlainObject(policy)) {
        errors.push('recommendation.recommendedProfile.extractionPolicy must be an object.');
        return;
    }
    rejectPrototypePollutionKeys(policy, 'recommendation.recommendedProfile.extractionPolicy', errors);
    rejectUnknownKeys(policy, EXTRACTION_POLICY_KEYS, 'recommendation.recommendedProfile.extractionPolicy', errors);
    validateBoundedNumber(policy.confidenceThreshold, 'recommendation.recommendedProfile.extractionPolicy.confidenceThreshold', errors, 0, 1, true);
    validateIntegerRange(policy.maxRecentMessages, 'recommendation.recommendedProfile.extractionPolicy.maxRecentMessages', errors, 1, 20, true);
    if (policy.allowAdminPatterns !== undefined && policy.allowAdminPatterns !== false) {
        errors.push('recommendation.recommendedProfile.extractionPolicy.allowAdminPatterns must be false.');
    }
    if (policy.allowBuiltinPatterns !== undefined && typeof policy.allowBuiltinPatterns !== 'boolean') {
        errors.push('recommendation.recommendedProfile.extractionPolicy.allowBuiltinPatterns must be boolean.');
    }
    if (policy.lowConfidenceBehavior !== undefined && !LOW_CONFIDENCE_BEHAVIORS.has(policy.lowConfidenceBehavior)) {
        errors.push('recommendation.recommendedProfile.extractionPolicy.lowConfidenceBehavior must be plain-dialogue or history-only.');
    }
}

function validateRecommendationVisualPriority(visualPriority, profile, errors) {
    if (!isPlainObject(visualPriority)) {
        errors.push('recommendation.recommendedProfile.visualPriority must be an object.');
        return;
    }
    rejectPrototypePollutionKeys(visualPriority, 'recommendation.recommendedProfile.visualPriority', errors);
    rejectUnknownKeys(visualPriority, VISUAL_PRIORITY_KEYS, 'recommendation.recommendedProfile.visualPriority', errors);
    const preferred = new Set(Array.isArray(profile.preferredModules) ? profile.preferredModules : []);
    const disabled = new Set(Array.isArray(profile.disabledModules) ? profile.disabledModules : []);
    if (visualPriority.primaryPanel !== undefined) {
        if (!isPresentationModule(visualPriority.primaryPanel)) {
            errors.push('recommendation.recommendedProfile.visualPriority.primaryPanel must be a known presentation module.');
        } else if (!preferred.has(visualPriority.primaryPanel) || disabled.has(visualPriority.primaryPanel)) {
            errors.push('recommendation.recommendedProfile.visualPriority.primaryPanel must be enabled by preferredModules.');
        }
    }
    validateUniqueEnumArray(visualPriority.secondaryPanels, MODULE_SET, 'recommendation.recommendedProfile.visualPriority.secondaryPanels', errors, 0, 8, true);
    if (Array.isArray(visualPriority.secondaryPanels)) {
        for (const moduleId of visualPriority.secondaryPanels) {
            if (!preferred.has(moduleId) || disabled.has(moduleId)) {
                errors.push(`recommendation.recommendedProfile.visualPriority.secondaryPanels contains disabled or non-preferred module: ${moduleId}.`);
            }
        }
    }
    validateIntegerRange(visualPriority.collapseBelowWidth, 'recommendation.recommendedProfile.visualPriority.collapseBelowWidth', errors, 320, 1440, true);
}

function validateRecommendationEvidence(evidence, context, errors) {
    if (!isPlainObject(evidence)) {
        errors.push('recommendation.evidence must be an object.');
        return;
    }
    rejectPrototypePollutionKeys(evidence, 'recommendation.evidence', errors);
    rejectUnknownKeys(evidence, RECOMMENDATION_EVIDENCE_KEYS, 'recommendation.evidence', errors);
    rejectForbiddenKeys(evidence, 'recommendation.evidence', errors, FORBIDDEN_RECOMMENDATION_KEYS);
    validatePatternString(evidence.evidenceDigest, DIGEST_PATTERN, 'recommendation.evidence.evidenceDigest', errors);
    validateServiceDerivedField(evidence, context, 'evidenceDigest', 'recommendation.evidence.evidenceDigest', errors);
    if (evidence.sourceKind !== 'uploaded-admin-material') {
        errors.push('recommendation.evidence.sourceKind must be uploaded-admin-material.');
    }
    validateUniqueEnumArray(evidence.matchedSignals, MATCHED_SIGNAL_SET, 'recommendation.evidence.matchedSignals', errors, 0, 12);
    validateUniqueEnumArray(evidence.exampleTemplateCodes, EXAMPLE_TEMPLATE_SET, 'recommendation.evidence.exampleTemplateCodes', errors, 0, 6, true);
}

function validateAdminPatterns(patterns, errors) {
    if (!Array.isArray(patterns)) {
        errors.push('profile.adminPatterns must be an array.');
        return;
    }
    patterns.forEach((pattern, index) => {
        const label = `profile.adminPatterns[${index}]`;
        if (!isPlainObject(pattern)) {
            errors.push(`${label} must be an object.`);
            return;
        }
        rejectUnknownKeys(pattern, PATTERN_KEYS, label, errors);
        rejectForbiddenKeys(pattern, label, errors, FORBIDDEN_PROFILE_AUTHORITY_KEYS);
        requireString(pattern.id, `${label}.id`, errors);
        if (!isPresentationModule(pattern.module)) {
            errors.push(`${label}.module must be a known presentation module.`);
        }
        if (pattern.source !== 'visible-chat-text') {
            errors.push(`${label}.source must be visible-chat-text.`);
        }
        if (!PATTERN_KINDS.has(pattern.patternKind)) {
            errors.push(`${label}.patternKind is not supported.`);
        }
        requireString(pattern.pattern, `${label}.pattern`, errors);
        if (!Array.isArray(pattern.fields) || !pattern.fields.every((field) => typeof field === 'string' && field.trim())) {
            errors.push(`${label}.fields must be a non-empty string array.`);
        }
        if (pattern.confidence !== undefined && (!Number.isFinite(Number(pattern.confidence)) || Number(pattern.confidence) < 0 || Number(pattern.confidence) > 1)) {
            errors.push(`${label}.confidence must be a number from 0 to 1.`);
        }
    });
}

function validateVisualPriority(visualPriority, errors) {
    if (!isPlainObject(visualPriority)) {
        errors.push('profile.visualPriority must be an object.');
        return;
    }
    rejectUnknownKeys(visualPriority, VISUAL_PRIORITY_KEYS, 'profile.visualPriority', errors);
    if (visualPriority.primaryPanel !== undefined && !isPresentationModule(visualPriority.primaryPanel)) {
        errors.push('profile.visualPriority.primaryPanel must be a known presentation module.');
    }
    validateModuleList(visualPriority.secondaryPanels, 'profile.visualPriority.secondaryPanels', errors, true);
    if (visualPriority.collapseBelowWidth !== undefined && (!Number.isFinite(Number(visualPriority.collapseBelowWidth)) || Number(visualPriority.collapseBelowWidth) < 0)) {
        errors.push('profile.visualPriority.collapseBelowWidth must be a non-negative number.');
    }
}

function rejectUnknownKeys(value, allowedKeys, label, errors) {
    for (const key of Object.getOwnPropertyNames(value || {})) {
        if (!allowedKeys.has(key)) {
            errors.push(`${label}.${key} is not allowed.`);
        }
    }
}

function rejectForbiddenKeys(value, label, errors, authorityKeys) {
    if (!isPlainObject(value) && !Array.isArray(value)) {
        return;
    }
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value);
    for (const [key, child] of entries) {
        const childLabel = `${label}.${key}`;
        const canonicalKey = key.toLowerCase();
        if (forbiddenBodyKeys.has(key)) {
            errors.push(`${childLabel} is an original resource body field; adaptive presentation profiles must store references only.`);
        }
        if (authorityKeys.has(key) || authorityKeys.has(canonicalKey)) {
            errors.push(`${childLabel} is a story-authority field; adaptive presentation profiles must not store module values.`);
        }
        rejectForbiddenKeys(child, childLabel, errors, authorityKeys);
    }
}

function rejectPrototypePollutionKeys(value, label, errors) {
    if (!isPlainObject(value) && !Array.isArray(value)) {
        return;
    }
    const entries = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.getOwnPropertyNames(value).map((key) => [key, value[key]]);
    for (const [key, child] of entries) {
        const childLabel = `${label}.${key}`;
        if (POLLUTION_KEYS.has(key)) {
            errors.push(`${childLabel} is not allowed.`);
        }
        rejectPrototypePollutionKeys(child, childLabel, errors);
    }
}

function validatePatternString(value, pattern, label, errors) {
    if (typeof value !== 'string' || !pattern.test(value)) {
        errors.push(`${label} has an invalid format.`);
    }
}

function validatePositiveInteger(value, label, errors) {
    validateIntegerRange(value, label, errors, 1, Number.MAX_SAFE_INTEGER);
}

function validateIntegerRange(value, label, errors, min, max, optional = false) {
    if (value === undefined && optional) {
        return;
    }
    if (!Number.isInteger(value) || value < min || value > max) {
        errors.push(`${label} must be an integer from ${min} to ${max}.`);
    }
}

function validateBoundedNumber(value, label, errors, min, max, optional = false) {
    if (value === undefined && optional) {
        return;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        errors.push(`${label} must be a finite number from ${min} to ${max}.`);
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

function validateSerializedSize(value, label, errors, maxBytes) {
    const size = new TextEncoder().encode(JSON.stringify(value)).length;
    if (size > maxBytes) {
        errors.push(`${label} exceeds the maximum serialized size.`);
    }
}

function validateServiceDerivedField(source, context, key, label, errors) {
    if (context[key] === undefined) {
        errors.push(`${label} requires a service-derived ${key} for validation.`);
        return;
    }
    if (context[key] !== undefined && source[key] !== context[key]) {
        errors.push(`${label} must match the service-derived ${key}.`);
    }
}

function deriveProfileId(recommendation) {
    const suffix = String(recommendation.recommendationId || '')
        .replace(/^rec_/, '')
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 72);
    return `profile_${suffix || 'recommendation'}`;
}

function validateModuleList(value, label, errors, optional) {
    if (value === undefined && optional) {
        return;
    }
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array.`);
        return;
    }
    for (const moduleId of value) {
        if (!isPresentationModule(moduleId)) {
            errors.push(`${label} contains unsupported module: ${moduleId}.`);
        }
    }
}

function normalizeModuleList(value, fallback) {
    if (!Array.isArray(value)) {
        return [...fallback];
    }
    return [...new Set(value.filter(isPresentationModule))];
}

function normalizeAdminPatterns(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .filter((pattern) => isPlainObject(pattern))
        .map((pattern) => ({
            id: sanitizeId(pattern.id || 'pattern'),
            module: isPresentationModule(pattern.module) ? pattern.module : 'notes',
            source: 'visible-chat-text',
            patternKind: PATTERN_KINDS.has(pattern.patternKind) ? pattern.patternKind : 'regex',
            pattern: String(pattern.pattern || ''),
            fields: Array.isArray(pattern.fields) ? pattern.fields.map((field) => String(field).trim()).filter(Boolean) : [],
            confidence: clampNumber(pattern.confidence, 0.86, 0, 1),
            locale: ['zh-CN', 'en', 'mixed'].includes(pattern.locale) ? pattern.locale : 'mixed',
        }))
        .filter((pattern) => pattern.pattern && pattern.fields.length);
}

function normalizeVisualPriority(value) {
    const source = isPlainObject(value) ? value : {};
    return {
        primaryPanel: isPresentationModule(source.primaryPanel) ? source.primaryPanel : 'actions',
        secondaryPanels: normalizeModuleList(source.secondaryPanels, []),
        collapseBelowWidth: Math.round(clampNumber(source.collapseBelowWidth, 640, 0, 4096)),
    };
}

function requireString(value, label, errors) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${label} is required.`);
    }
}

function sanitizeId(value) {
    return String(value || '')
        .trim()
        .replace(/[^\w.-]+/g, '-')
        .slice(0, 120) || 'profile';
}

function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, number));
}

function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
