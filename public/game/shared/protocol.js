import {
    createDefaultAdaptivePresentationProfile,
    validateAdaptivePresentationProfile,
} from './adaptive-presentation-schema.js?v=auto-fdcc7c7c5302';

export const PROTOCOL_VERSION = '1.0';
export const ARC_BINDING_PROTOCOL_VERSION = 'galgame.arc-release.v1';

export const STORAGE_KEYS = Object.freeze({
    activeRelease: 'galgame.release.active.v1',
    manifestPrefix: 'galgame.scenario.manifest.v1:',
    releaseHistory: 'galgame.release.history.v1',
    playerSavePrefix: 'galgame.player-save.v1:',
    mediaConfig: 'galgame.media.config.v1',
});

const FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS = [
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
];

export function nowIso() {
    return new Date().toISOString();
}

export function safeJsonParse(value, fallback = null) {
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

export function sanitizeText(value, maxLength = 4000) {
    const text = String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export function stableHash(input) {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function isSillyTavernLiveManifest(manifest) {
    return manifest?.story?.mode === 'sillytavern-live';
}

export function validateScenarioManifest(manifest) {
    const errors = [];
    const warnings = [];

    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { valid: false, errors: ['Scenario manifest must be an object.'], warnings };
    }

    requireString(manifest.schemaVersion, 'schemaVersion', errors);
    requireString(manifest.id, 'id', errors);
    requireString(manifest.version, 'version', errors);
    requireString(manifest.title, 'title', errors);
    requireString(manifest.locale, 'locale', errors);

    if (manifest.interaction) {
        errors.push('interaction is not allowed in native-first manifests; player interaction belongs to original SillyTavern.');
    }

    if (manifest.schemaVersion && manifest.schemaVersion !== PROTOCOL_VERSION) {
        errors.push(`Unsupported schemaVersion: ${manifest.schemaVersion}.`);
    }

    if (!manifest.presentation || typeof manifest.presentation !== 'object') {
        errors.push('presentation is required.');
    } else {
        requireString(manifest.presentation.titleBackgroundAsset, 'presentation.titleBackgroundAsset', errors);
        requireString(manifest.presentation.defaultBackgroundAsset, 'presentation.defaultBackgroundAsset', errors);
    }

    const story = manifest.story;
    if (!story || typeof story !== 'object') {
        errors.push('story is required as a launcher anchor.');
    } else {
        validateNativeOnlyStory(story, errors, warnings);
    }

    if (manifest.runtimeRequirements) {
        errors.push('runtimeRequirements is not allowed in native-first manifests; use original SillyTavern runtime settings.');
    }

    if (manifest.media?.events && !Array.isArray(manifest.media.events)) {
        errors.push('media.events must be an array when provided.');
    }

    const adaptiveProfileStatus = validateAdaptivePresentationProfiles(manifest);
    errors.push(...adaptiveProfileStatus.errors);
    warnings.push(...adaptiveProfileStatus.warnings);

    const visualBindingStatus = validateVisualCharacterBindings(manifest);
    errors.push(...visualBindingStatus.errors);
    warnings.push(...visualBindingStatus.warnings);

    if (Array.isArray(manifest.arcs)) {
        const arcStatus = validateArcBindings(manifest);
        errors.push(...arcStatus.errors);
        warnings.push(...arcStatus.warnings);
    } else {
        const bindingStatus = validateSillyTavernBindings(manifest);
        errors.push(...bindingStatus.errors);
        warnings.push(...bindingStatus.warnings);
    }

    return { valid: errors.length === 0, errors, warnings };
}

const VISUAL_BINDING_CHANNELS = Object.freeze(['any', 'character', 'player', 'narrator', 'system']);
const VISUAL_BINDING_DEFAULT_ASSET_KEYS = Object.freeze({
    character: 'characterAssetId',
    player: 'playerAssetId',
    narrator: 'narratorAssetId',
    system: 'systemAssetId',
});

function validateVisualBindingAssetId(value, label, errors) {
    const isCharacterCatalogAsset = /^asset_character_[a-z0-9_-]{6,80}$/.test(String(value || ''))
        || /^asset_curated_character-[a-z0-9_-]{2,80}$/.test(String(value || ''))
        || /^asset_curated_player-[a-z0-9_-]{2,80}$/.test(String(value || ''));
    if (value !== undefined && (!value || !isCharacterCatalogAsset)) {
        errors.push(`${label} must reference a character catalog asset.`);
    }
}

export function validateVisualCharacterBindings(manifest) {
    const errors = [];
    const warnings = [];
    const bindings = manifest?.visualBindings;
    if (bindings === undefined) {
        return { valid: true, errors, warnings };
    }
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
        return { valid: false, errors: ['visualBindings must be an object.'], warnings };
    }
    if (bindings.schemaVersion && bindings.schemaVersion !== 'galgame.visual-character-bindings.v1') {
        errors.push('visualBindings.schemaVersion is unsupported.');
    }
    if (!Array.isArray(bindings.characters)) {
        errors.push('visualBindings.characters must be an array.');
    }
    if (Array.isArray(bindings.characters) && bindings.characters.length > 64) {
        errors.push('visualBindings.characters may contain at most 64 entries.');
    }
    const validateBindingList = (list, listName, { rejectDuplicateKeys = true } = {}) => {
        const keys = new Set();
        const usedAssetIds = new Set();
        (Array.isArray(list) ? list : []).forEach((binding, index) => {
            const label = `visualBindings.${listName}[${index}]`;
            if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
                errors.push(`${label} must be an object.`);
                return;
            }
            requireString(binding.characterKey, `${label}.characterKey`, errors);
            requireString(binding.assetId, `${label}.assetId`, errors);
            validateVisualBindingAssetId(binding.assetId, `${label}.assetId`, errors);
            const assetId = String(binding.assetId || '').trim();
            if (assetId) {
                if (usedAssetIds.has(assetId)) {
                    errors.push(`Duplicate visual character asset "${assetId}"; each asset may be bound to only one character in a scenario.`);
                }
                usedAssetIds.add(assetId);
            }
            if (binding.assetVersion !== undefined && (!Number.isSafeInteger(binding.assetVersion) || binding.assetVersion <= 0)) {
                errors.push(`${label}.assetVersion must be a positive integer.`);
            }
            const aliases = binding.aliases === undefined ? [] : binding.aliases;
            if (!Array.isArray(aliases) || aliases.length > 32) {
                errors.push(`${label}.aliases must be an array with at most 32 strings.`);
            } else {
                aliases.forEach((alias, aliasIndex) => {
                    if (typeof alias !== 'string' || !alias.trim() || alias.length > 160) {
                        errors.push(`${label}.aliases[${aliasIndex}] must be a non-empty string.`);
                    }
                });
            }
            const key = String(binding.characterKey || '').trim().toLocaleLowerCase();
            if (key && rejectDuplicateKeys) {
                if (keys.has(key)) errors.push(`Duplicate visual character binding "${binding.characterKey}".`);
                keys.add(key);
            }
            if (binding.channel && !VISUAL_BINDING_CHANNELS.includes(binding.channel)) {
                errors.push(`${label}.channel must be ${VISUAL_BINDING_CHANNELS.join(', ')}.`);
            }
            if (binding.assetVersion === undefined) {
                warnings.push(`${label}.assetVersion is omitted; version 1 will be used.`);
            }
        });
    };
    validateBindingList(bindings.characters, 'characters');
    if (bindings.characterPool !== undefined && !Array.isArray(bindings.characterPool)) {
        errors.push('visualBindings.characterPool must be an array.');
    }
    if (Array.isArray(bindings.characterPool) && bindings.characterPool.length > 64) {
        errors.push('visualBindings.characterPool may contain at most 64 entries.');
    }
    validateBindingList(bindings.characterPool, 'characterPool', { rejectDuplicateKeys: false });
    // A pool may mirror an explicitly bound character so legacy manifests can
    // keep their alias table, but the same asset must never represent a
    // different character. This preserves one-to-one identity semantics while
    // allowing exact character aliases to be listed in both places.
    const explicitByAssetId = new Map((Array.isArray(bindings.characters) ? bindings.characters : [])
        .filter((binding) => binding && typeof binding === 'object' && !Array.isArray(binding))
        .map((binding) => [String(binding.assetId || '').trim(), normalizeVisualCharacterName(binding.characterKey)]));
    (Array.isArray(bindings.characterPool) ? bindings.characterPool : []).forEach((binding, index) => {
        const assetId = String(binding?.assetId || '').trim();
        const explicitKey = explicitByAssetId.get(assetId);
        if (!assetId || !explicitKey) return;
        const poolKey = normalizeVisualCharacterName(binding.characterKey);
        if (poolKey && poolKey !== explicitKey) {
            errors.push(`visualBindings.characterPool[${index}].assetId duplicates an asset bound to a different character.`);
        }
    });
    const defaults = bindings.defaults;
    if (defaults !== undefined) {
        if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) {
            errors.push('visualBindings.defaults must be an object.');
        } else {
            for (const key of Object.keys(defaults)) {
                if (!Object.values(VISUAL_BINDING_DEFAULT_ASSET_KEYS).includes(key)) {
                    errors.push(`visualBindings.defaults.${key} is not supported.`);
                }
            }
            for (const key of Object.values(VISUAL_BINDING_DEFAULT_ASSET_KEYS)) {
                validateVisualBindingAssetId(defaults[key], `visualBindings.defaults.${key}`, errors);
            }
        }
    }
    return { valid: errors.length === 0, errors, warnings };
}

function getVisualBindingConfig(manifest, arcId = '') {
    const arc = findArcBinding(manifest, arcId);
    const arcBindings = arc?.visualBindings;
    const manifestBindings = manifest?.visualBindings;
    return {
        ...(manifestBindings && typeof manifestBindings === 'object' ? manifestBindings : {}),
        ...(arcBindings && typeof arcBindings === 'object' ? arcBindings : {}),
    };
}

export function getVisualCharacterBindings(manifest, arcId = '') {
    const raw = getVisualBindingConfig(manifest, arcId);
    const characters = Array.isArray(raw?.characters) ? raw.characters : [];
    return characters.filter((binding) => binding && typeof binding === 'object' && !Array.isArray(binding));
}

export function getVisualCharacterPool(manifest, arcId = '') {
    const raw = getVisualBindingConfig(manifest, arcId);
    const pool = Array.isArray(raw?.characterPool) ? raw.characterPool : [];
    return pool.filter((binding) => binding && typeof binding === 'object' && !Array.isArray(binding));
}

function normalizeVisualCharacterName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[：:，,。！？!?]+$/u, '')
        .replace(/\s+/gu, ' ')
        .trim()
        // Runtime status lines may prefix a real name with a turn/action
        // marker. Strip only these presentation suffixes before alias lookup;
        // the original chat text remains untouched.
        .replace(/\s*(?:的)?(?:回合|行动)\s*$/u, '')
        .replace(/\s+(?:turn|action)\s*$/iu, '')
        .trim()
        .toLocaleLowerCase();
}

function hashVisualCharacterName(value) {
    let hash = 2166136261;
    for (const character of String(value || '')) {
        hash ^= character.codePointAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function formatVisualCharacterBinding(binding, fallbackKey = '') {
    if (!binding) return null;
    return {
        characterKey: String(binding.characterKey || fallbackKey).trim(),
        assetId: String(binding.assetId || '').trim(),
        assetVersion: Number.isSafeInteger(binding.assetVersion) && binding.assetVersion > 0 ? binding.assetVersion : 1,
        channel: binding.channel || 'character',
    };
}

const visualCharacterPoolAssignments = new Map();

function getReservedVisualCharacterAssetIds(manifest, arcId) {
    return new Set(getVisualCharacterBindings(manifest, arcId)
        .filter((binding) => (binding.channel || 'any') === 'any' || (binding.channel || 'any') === 'character')
        .map((binding) => String(binding.assetId || '').trim())
        .filter(Boolean));
}

function resolvePooledVisualCharacterBinding(manifest, pool, { normalizedName, arcId, sessionKey = '' }) {
    if (!normalizedName || !pool.length) return null;
    const manifestKey = String(manifest?.id || manifest?.manifestId || 'manifest');
    const scopeKey = `${manifestKey}|${arcId || ''}|${String(sessionKey || 'default').trim() || 'default'}`;
    const assignmentKey = `${scopeKey}|${normalizedName}`;
    const assignments = visualCharacterPoolAssignments.get(scopeKey) || new Map();
    if (assignments.has(assignmentKey)) {
        const assignedAssetId = assignments.get(assignmentKey);
        const assigned = pool.find((binding) => String(binding.assetId || '').trim() === assignedAssetId);
        if (assigned) return formatVisualCharacterBinding(assigned);
    }
    const exactPoolMatch = pool.find((binding) => {
        const channel = binding.channel || 'any';
        if (channel !== 'any' && channel !== 'character') return false;
        const names = [binding.characterKey, ...(Array.isArray(binding.aliases) ? binding.aliases : [])];
        return names.some((candidate) => normalizeVisualCharacterName(candidate) === normalizedName);
    });
    if (exactPoolMatch) {
        const exactAssetId = String(exactPoolMatch.assetId || '').trim();
        const canonicalPoolKey = normalizeVisualCharacterName(exactPoolMatch.characterKey);
        const assignedToAnother = [...assignments.entries()].some(([key, assetId]) => {
            if (key === assignmentKey || assetId !== exactAssetId) return false;
            const assignedBinding = pool.find((binding) => String(binding.assetId || '').trim() === assetId);
            return normalizeVisualCharacterName(assignedBinding?.characterKey) !== canonicalPoolKey;
        });
        if (!assignedToAnother) {
            assignments.set(assignmentKey, exactAssetId);
            visualCharacterPoolAssignments.set(scopeKey, assignments);
            return formatVisualCharacterBinding(exactPoolMatch);
        }
        return null;
    }
    const usedAssetIds = new Set(assignments.values());
    for (const assetId of getReservedVisualCharacterAssetIds(manifest, arcId)) usedAssetIds.add(assetId);
    const startIndex = hashVisualCharacterName(normalizedName) % pool.length;
    let selected = null;
    for (let offset = 0; offset < pool.length; offset += 1) {
        const candidate = pool[(startIndex + offset) % pool.length];
        if (String(candidate.assetId || '').trim() && !usedAssetIds.has(String(candidate.assetId).trim())) {
            selected = candidate;
            break;
        }
    }
    if (!selected) return null;
    assignments.set(assignmentKey, String(selected.assetId || '').trim());
    visualCharacterPoolAssignments.set(scopeKey, assignments);
    return formatVisualCharacterBinding(selected, normalizedName);
}

export function resolveVisualCharacterBinding(manifest, {
    name = '',
    role = 'character',
    arcId = '',
    // Legacy callers can keep deterministic pool assignment. Player visual
    // requests pass false so an unknown NPC receives the unknown placeholder
    // rather than borrowing an arbitrary character asset.
    allowCharacterPoolFallback = true,
    allowPooledCharacterFallback,
    sessionKey = '',
    chatId = '',
} = {}) {
    const normalizedName = normalizeVisualCharacterName(name);
    const normalizedRole = VISUAL_BINDING_CHANNELS.includes(role) ? role : 'character';
    const poolFallbackAllowed = allowPooledCharacterFallback === undefined
        ? allowCharacterPoolFallback
        : allowPooledCharacterFallback;
    const bindings = getVisualCharacterBindings(manifest, arcId);
    const exact = normalizedName
        ? bindings.find((binding) => {
            const channel = binding.channel || 'any';
            if (channel !== 'any' && channel !== normalizedRole) return false;
            const names = [binding.characterKey, ...(Array.isArray(binding.aliases) ? binding.aliases : [])];
            return names.some((candidate) => normalizeVisualCharacterName(candidate) === normalizedName);
        })
        : null;
    if (exact) return formatVisualCharacterBinding(exact);
    if (normalizedRole === 'character' && poolFallbackAllowed) {
        const pooled = resolvePooledVisualCharacterBinding(manifest, getVisualCharacterPool(manifest, arcId), {
            normalizedName,
            arcId,
            sessionKey: sessionKey || chatId,
        });
        if (pooled) return pooled;
    }
    // A character without an exact alias is unknown when pool fallback is
    // disabled. Do not use the manifest's generic character default either:
    // that would silently lock an unrelated NPC to an existing portrait.
    if (normalizedRole === 'character') {
        return null;
    }
    const defaults = getVisualBindingConfig(manifest, arcId).defaults || {};
    const defaultKey = VISUAL_BINDING_DEFAULT_ASSET_KEYS[normalizedRole] || VISUAL_BINDING_DEFAULT_ASSET_KEYS.character;
    const defaultAssetId = defaults[defaultKey] || (normalizedRole !== 'character' ? defaults.characterAssetId : '');
    if (!defaultAssetId) return null;
    return {
        characterKey: `__default_${normalizedRole}`,
        assetId: String(defaultAssetId),
        assetVersion: 1,
        channel: normalizedRole,
    };
}

export function validateAdaptivePresentationProfiles(manifest) {
    const errors = [];
    const warnings = [];
    const profiles = manifest?.adaptivePresentationProfiles || manifest?.presentationProfiles;

    if (manifest?.presentationProfiles && !manifest?.adaptivePresentationProfiles) {
        warnings.push('presentationProfiles is accepted as a compatibility alias; prefer adaptivePresentationProfiles.');
    }
    if (profiles === undefined) {
        return { ready: true, errors, warnings };
    }
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
        return {
            ready: false,
            errors: ['adaptivePresentationProfiles must be an object keyed by profileId.'],
            warnings,
        };
    }

    const profileIds = new Set();
    for (const [profileKey, profile] of Object.entries(profiles)) {
        const label = `adaptivePresentationProfiles.${profileKey}`;
        if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
            errors.push(`${label} must be an AdaptivePresentationProfileV1 object.`);
            continue;
        }
        const profileStatus = validateAdaptivePresentationProfile(profile);
        errors.push(...profileStatus.errors.map((error) => `${label}: ${error}`));
        warnings.push(...profileStatus.warnings.map((warning) => `${label}: ${warning}`));
        if (profile.profileId && profile.profileId !== profileKey) {
            warnings.push(`${label}.profileId should match its manifest key.`);
        }
        if (profileKey) {
            profileIds.add(profileKey);
        }
        if (profile.profileId) {
            profileIds.add(profile.profileId);
        }
    }

    for (const arc of getManifestArcBindings(manifest)) {
        const profileId = sanitizeText(arc.presentationProfileId || 'default', 120);
        if (profileId && profileId !== 'default' && !profileIds.has(profileId)) {
            errors.push(`Arc "${arc.arcId || 'unknown'}" references missing adaptivePresentationProfiles entry "${profileId}".`);
        }
        const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, arc.arcId);
        if (arc.presentationProfileHash) {
            if (!profileBinding.valid) {
                errors.push(`Arc "${arc.arcId || 'unknown'}" presentation profile binding is invalid: ${profileBinding.errors.join('; ')}`);
            } else if (arc.presentationProfileHash !== profileBinding.profileHash) {
                errors.push(`Arc "${arc.arcId || 'unknown'}" presentationProfileHash does not match adaptivePresentationProfiles "${profileBinding.profileId}".`);
            }
        } else if ((arc.status || 'published') === 'published') {
            warnings.push(`Arc "${arc.arcId || 'unknown'}" is missing presentationProfileHash; explicit publish must bind it before activation.`);
        }
    }

    return {
        ready: errors.length === 0,
        errors,
        warnings,
    };
}

export function validateArcBindings(manifest) {
    const errors = [];
    const warnings = [];
    const arcs = Array.isArray(manifest?.arcs) ? manifest.arcs : [];

    if (!arcs.length) {
        return {
            ready: false,
            errors: ['arcs must contain at least one ArcBindingV1 item when provided.'],
            warnings,
        };
    }

    const defaultArcId = sanitizeText(manifest.defaultArcId || '', 120);
    const arcIds = new Set();
    const arcBindingIds = new Set();
    for (const [index, arc] of arcs.entries()) {
        const label = `arcs[${index}]`;
        if (!arc || typeof arc !== 'object' || Array.isArray(arc)) {
            errors.push(`${label} must be an object.`);
            continue;
        }

        if (arc.schemaVersion !== ARC_BINDING_PROTOCOL_VERSION) {
            errors.push(`${label}.schemaVersion must be ${ARC_BINDING_PROTOCOL_VERSION}.`);
        }
        requireString(arc.arcBindingId, `${label}.arcBindingId`, errors);
        requireString(arc.scenarioId, `${label}.scenarioId`, errors);
        requireString(arc.scenarioVersion, `${label}.scenarioVersion`, errors);
        requireString(arc.arcId, `${label}.arcId`, errors);
        requireString(arc.arcVersion, `${label}.arcVersion`, errors);
        requireString(arc.title, `${label}.title`, errors);
        requireString(arc.presentationProfileId, `${label}.presentationProfileId`, errors);

        if (arc.scenarioId && arc.scenarioId !== manifest.id) {
            errors.push(`${label}.scenarioId must match manifest.id.`);
        }
        if (arc.scenarioVersion && arc.scenarioVersion !== manifest.version) {
            errors.push(`${label}.scenarioVersion must match manifest.version.`);
        }
        if (!Number.isFinite(Number(arc.order))) {
            warnings.push(`${label}.order should be a number for administrator sorting.`);
        }
        if (arc.status && !['draft', 'published', 'archived'].includes(arc.status)) {
            errors.push(`${label}.status must be draft, published, or archived.`);
        }
        if (arc.arcId) {
            if (arcIds.has(arc.arcId)) {
                errors.push(`Duplicate arcId "${arc.arcId}" is not allowed.`);
            }
            arcIds.add(arc.arcId);
        }
        if (arc.arcBindingId) {
            if (arcBindingIds.has(arc.arcBindingId)) {
                errors.push(`Duplicate arcBindingId "${arc.arcBindingId}" is not allowed.`);
            }
            arcBindingIds.add(arc.arcBindingId);
        }

        const bindingStatus = validateSillyTavernBindings({
            ...manifest,
            arcs: undefined,
            sillyTavernBindings: arc.sillyTavernBindings,
        });
        const isPublishableArc = (arc.status || 'published') === 'published' || arc.arcId === defaultArcId;
        const bodyCopyErrors = bindingStatus.errors.filter((error) => /references only|resource body/i.test(error));
        const readinessErrors = bindingStatus.errors.filter((error) => !bodyCopyErrors.includes(error));
        errors.push(...bodyCopyErrors.map((error) => `${label}: ${error}`));
        if (isPublishableArc) {
            errors.push(...readinessErrors.map((error) => `${label}: ${error}`));
        } else if (readinessErrors.length) {
            warnings.push(`${label}: draft Arc is not publishable yet: ${readinessErrors.join('; ')}`);
        }
        warnings.push(...bindingStatus.warnings.map((warning) => `${label}: ${warning}`));
    }

    if (defaultArcId && !arcIds.has(defaultArcId)) {
        errors.push(`defaultArcId "${defaultArcId}" does not match any ArcBindingV1 arcId.`);
    }

    return {
        ready: errors.length === 0,
        errors,
        warnings,
    };
}

export function validateSillyTavernBindings(manifest, { arcId = '' } = {}) {
    const errors = [];
    const warnings = [];
    const rawBindings = resolveRawSillyTavernBindings(manifest, arcId);
    const bindings = materializeSillyTavernBindings(rawBindings);

    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
        return {
            ready: false,
            errors,
            warnings: ['sillyTavernBindings is missing; bind original SillyTavern resources before shared deployment.'],
        };
    }

    const characters = Array.isArray(bindings.characters) ? bindings.characters : [];
    if (!characters.length && !bindings.groupId) {
        errors.push('Bind at least one original character or group.');
    }

    if (rawBindings?.target) {
        validateFormalTarget(rawBindings.target, errors);
    }

    if (isSillyTavernLiveManifest(manifest) && !bindings.chatSeedId) {
        errors.push('sillytavern-live entries must bind a chatSeedId so the custom Galgame opening comes from original SillyTavern chat.');
    }

    if (bindings.chatSeedId && characters.length && !characters[0]?.avatar) {
        errors.push('The primary bound character needs an avatar reference when chatSeedId is used.');
    }

    for (const character of characters) {
        if (!character || typeof character !== 'object') {
            errors.push('sillyTavernBindings.characters contains an invalid item.');
            continue;
        }
        if (!character.id || typeof character.id !== 'string') {
            errors.push('Each bound original character needs an id.');
        }
        rejectEmbeddedOriginalResourceBody(character, FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS, 'character "' + (character.id || 'unknown') + '"', errors);
        if (!['main', 'supporting', 'narrator'].includes(character.role)) {
            warnings.push('Character "' + (character.id || 'unknown') + '" should declare role main, supporting, or narrator.');
        }
    }

    const worldBooks = Array.isArray(bindings.worldBooks) ? bindings.worldBooks : [];
    if (!worldBooks.length) {
        warnings.push('No original world book is bound.');
    }

    for (const worldBook of worldBooks) {
        if (!worldBook || typeof worldBook !== 'object') {
            errors.push('sillyTavernBindings.worldBooks contains an invalid item.');
            continue;
        }
        if (!worldBook.name || typeof worldBook.name !== 'string') {
            errors.push('Each bound world book needs a name.');
        }
        rejectEmbeddedOriginalResourceBody(worldBook, FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS, 'world book "' + (worldBook.name || 'unknown') + '"', errors);
        if (!['global', 'character', 'scene', 'manual'].includes(worldBook.mode)) {
            warnings.push('World book "' + (worldBook.name || 'unknown') + '" should declare a SillyTavern-compatible mode.');
        }
        if (worldBook.weight !== undefined && !Number.isFinite(worldBook.weight)) {
            errors.push('World book "' + (worldBook.name || 'unknown') + '" weight must be a number when provided.');
        }
    }

    return {
        ready: errors.length === 0 && (characters.length > 0 || Boolean(bindings.groupId)),
        errors,
        warnings,
    };
}

export function getManifestArcBindings(manifest) {
    const arcs = Array.isArray(manifest?.arcs)
        ? manifest.arcs.filter((arc) => arc && typeof arc === 'object' && !Array.isArray(arc))
        : [];
    if (arcs.length) {
        return arcs;
    }

    const bindings = manifest?.sillyTavernBindings;
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
        return [];
    }
    const arcId = sanitizeText(manifest.defaultArcId || manifest.arcId || 'default', 120) || 'default';
    return [{
        schemaVersion: ARC_BINDING_PROTOCOL_VERSION,
        arcBindingId: `${manifest?.id || 'manifest'}:${manifest?.version || '0'}:${arcId}`,
        scenarioId: manifest?.id || '',
        scenarioVersion: manifest?.version || '',
        arcId,
        arcVersion: manifest?.arcVersion || manifest?.version || '1',
        title: manifest?.title || arcId,
        order: 1,
        status: 'published',
        sillyTavernBindings: bindings,
        presentationProfileId: 'default',
        mediaPolicyId: 'default',
        createdAt: manifest?.createdAt || '',
        publishedAt: manifest?.publishedAt || '',
    }];
}

export function getDefaultArcId(manifest) {
    const explicit = sanitizeText(manifest?.defaultArcId || manifest?.arcId || '', 120);
    if (explicit) {
        return explicit;
    }
    return sanitizeText(getManifestArcBindings(manifest)[0]?.arcId || 'default', 120);
}

export function findArcBinding(manifest, arcId = '') {
    const expected = sanitizeText(arcId || getDefaultArcId(manifest), 120);
    return getManifestArcBindings(manifest).find((arc) => sanitizeText(arc.arcId, 120) === expected) || null;
}

export function getActiveSillyTavernBindings(manifest, arcId = '') {
    return materializeSillyTavernBindings(resolveRawSillyTavernBindings(manifest, arcId));
}

export function getAdaptivePresentationProfiles(manifest) {
    const profiles = manifest?.adaptivePresentationProfiles
        || manifest?.presentationProfiles
        || manifest?.presentation?.profiles
        || {};
    return profiles && typeof profiles === 'object' && !Array.isArray(profiles) ? profiles : {};
}

export function getArcPresentationProfileId(manifest, arcId = '') {
    const arc = findArcBinding(manifest, arcId);
    return sanitizeText(arc?.presentationProfileId || manifest?.presentationProfileId || 'default', 120) || 'default';
}

export function getAdaptivePresentationProfileForArc(manifest, arcId = '') {
    const profileId = getArcPresentationProfileId(manifest, arcId);
    const profiles = getAdaptivePresentationProfiles(manifest);
    const configuredProfile = profiles[profileId]
        || profiles.default
        || manifest?.adaptivePresentationProfile
        || manifest?.presentation?.adaptiveProfile
        || {};
    return createDefaultAdaptivePresentationProfile({
        profileId: profileId || configuredProfile.profileId || 'default',
        ...configuredProfile,
    });
}

export function createAdaptivePresentationProfileHash(profile) {
    const normalized = createDefaultAdaptivePresentationProfile(profile || {});
    return stableHash({
        schemaVersion: normalized.schemaVersion,
        profileId: normalized.profileId,
        template: normalized.template,
        preferredModules: [...normalized.preferredModules],
        disabledModules: [...normalized.disabledModules],
        extractionPolicy: {
            confidenceThreshold: normalized.extractionPolicy.confidenceThreshold,
            maxRecentMessages: normalized.extractionPolicy.maxRecentMessages,
            allowAdminPatterns: Boolean(normalized.extractionPolicy.allowAdminPatterns),
            allowBuiltinPatterns: Boolean(normalized.extractionPolicy.allowBuiltinPatterns),
            lowConfidenceBehavior: normalized.extractionPolicy.lowConfidenceBehavior,
        },
        adminPatterns: Array.isArray(normalized.adminPatterns) ? normalized.adminPatterns : [],
        visualPriority: {
            primaryPanel: normalized.visualPriority.primaryPanel,
            secondaryPanels: [...normalized.visualPriority.secondaryPanels],
            collapseBelowWidth: normalized.visualPriority.collapseBelowWidth,
        },
    });
}

export function resolveAdaptivePresentationProfileBinding(manifest, arcId = '') {
    const errors = [];
    const arc = findArcBinding(manifest, arcId);
    if (!arc) {
        return {
            valid: false,
            errors: [`arc "${sanitizeText(arcId || getDefaultArcId(manifest), 120)}" does not exist.`],
            profileId: '',
            profileHash: '',
            profile: null,
        };
    }
    const profileId = getArcPresentationProfileId(manifest, arc.arcId);
    const profile = getAdaptivePresentationProfileForArc(manifest, arc.arcId);
    const profileStatus = validateAdaptivePresentationProfile(profile);
    if (!profileStatus.valid) {
        errors.push(...profileStatus.errors);
    }
    if (profile.profileId !== profileId) {
        errors.push(`profileId "${profile.profileId}" does not match Arc presentationProfileId "${profileId}".`);
    }
    const profileHash = profileStatus.valid ? createAdaptivePresentationProfileHash(profile) : '';
    return {
        valid: errors.length === 0,
        errors,
        profileId,
        profileHash,
        profile,
    };
}

export function bindAdaptivePresentationProfileHashes(manifest, { arcId = '' } = {}) {
    if (!Array.isArray(manifest?.arcs)) {
        return manifest;
    }
    const selectedArcId = sanitizeText(arcId || '', 120);
    return {
        ...manifest,
        arcs: manifest.arcs.map((arc) => {
            if (!arc || typeof arc !== 'object' || Array.isArray(arc)) {
                return arc;
            }
            if (selectedArcId && arc.arcId !== selectedArcId) {
                return arc;
            }
            const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, arc.arcId);
            if (!profileBinding.valid || !profileBinding.profileHash) {
                return arc;
            }
            return {
                ...arc,
                presentationProfileId: profileBinding.profileId,
                presentationProfileHash: profileBinding.profileHash,
            };
        }),
    };
}

export function materializeManifestForArc(manifest, arcId = '') {
    const arc = findArcBinding(manifest, arcId);
    if (!arc) {
        return manifest;
    }
    return {
        ...manifest,
        arcId: sanitizeText(arc.arcId, 120),
        arcVersion: sanitizeText(arc.arcVersion || manifest?.version || '', 80),
        defaultArcId: getDefaultArcId(manifest),
        sillyTavernBindings: materializeSillyTavernBindings(arc.sillyTavernBindings),
        presentationProfileId: sanitizeText(arc.presentationProfileId || 'default', 120),
        presentationProfileHash: sanitizeText(arc.presentationProfileHash || '', 160),
    };
}

export function summarizeSillyTavernBindings(manifest, { arcId = '' } = {}) {
    const bindings = getActiveSillyTavernBindings(manifest, arcId) || {};
    const characters = Array.isArray(bindings.characters) ? bindings.characters : [];
    const worldBooks = Array.isArray(bindings.worldBooks) ? bindings.worldBooks : [];
    const scalarBindings = [
        ['groupId', 'Group'],
        ['presetId', 'Generation preset'],
        ['instructPresetId', 'Instruct preset'],
        ['systemPromptId', 'System prompt'],
        ['contextPresetId', 'Context preset'],
        ['chatSeedId', 'Chat seed'],
    ];

    return {
        characters: characters.map((character) => ({
            id: sanitizeText(character.id, 120),
            role: sanitizeText(character.role || 'supporting', 40),
            avatar: sanitizeText(character.avatar || '', 240),
        })).filter((character) => character.id),
        worldBooks: worldBooks.map((worldBook) => ({
            name: sanitizeText(worldBook.name, 160),
            mode: sanitizeText(worldBook.mode || 'manual', 40),
            weight: Number.isFinite(worldBook.weight) ? worldBook.weight : null,
        })).filter((worldBook) => worldBook.name),
        settings: scalarBindings.map(([key, label]) => ({
            key,
            label,
            value: sanitizeText(bindings[key] || '', 160),
            bound: Boolean(bindings[key]),
        })),
    };
}

export function createActiveRelease(manifest, { activeArcId = '' } = {}) {
    const publishedAt = nowIso();
    const selectedArc = findArcBinding(manifest, activeArcId) || findArcBinding(manifest, getDefaultArcId(manifest));
    const resolvedArcId = sanitizeText(selectedArc?.arcId || activeArcId || getDefaultArcId(manifest), 120);
    const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, resolvedArcId);
    return {
        releaseId: `local_${manifest.id}_${manifest.version}_${resolvedArcId}_${Date.now().toString(36)}`,
        scenarioId: manifest.id,
        scenarioVersion: manifest.version,
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        activeArcId: resolvedArcId,
        arcId: resolvedArcId,
        arcVersion: sanitizeText(selectedArc?.arcVersion || manifest.arcVersion || manifest.version || '', 80),
        presentationProfileId: sanitizeText(selectedArc?.presentationProfileId || profileBinding.profileId || 'default', 120),
        presentationProfileHash: sanitizeText(selectedArc?.presentationProfileHash || profileBinding.profileHash || '', 160),
        publishedAt,
        manifestUrl: `local:${manifest.id}@${manifest.version}`,
        contentHash: stableHash(manifest),
        minimumPlayerVersion: manifest.minimumPlayerVersion || '1.0.0',
    };
}

export function createPlayableStoryRelease(manifest, {
    activeArcId = '',
    sourceRelease = null,
    manifestUrl = '',
} = {}) {
    const release = createActiveRelease(manifest, { activeArcId });
    const arcId = release.activeArcId || release.arcId || getDefaultArcId(manifest);
    const arc = findArcBinding(manifest, arcId);
    const sourceMatches = sourceRelease
        && sourceRelease.scenarioId === manifest.id
        && sourceRelease.scenarioVersion === manifest.version
        && (sourceRelease.activeArcId || sourceRelease.arcId || getDefaultArcId(manifest)) === arcId;
    return {
        ...release,
        releaseId: `play_${stableHash(`${manifest.id}@${manifest.version}#${arcId}`).replace(':', '_')}`,
        publishedAt: sanitizeText(
            (sourceMatches && sourceRelease.publishedAt)
            || arc?.publishedAt
            || manifest.updatedAt
            || release.publishedAt,
            80,
        ),
        manifestUrl: sanitizeText(manifestUrl || release.manifestUrl, 400),
        contentHash: stableHash(manifest),
    };
}

export function listPlayableStoryEntries(manifests = [], {
    activeRelease = null,
    releases = [],
    manifestUrlFactory = null,
} = {}) {
    const entries = [];
    const seen = new Set();
    for (const manifest of manifests) {
        const validation = validateScenarioManifest(manifest);
        if (!validation.valid) {
            continue;
        }
        const playableArcs = getPlayableArcOptions(manifest);
        const selectedArc = choosePlayableStoryArc(manifest, playableArcs, activeRelease, releases);
        if (!selectedArc) {
            continue;
        }
        const arcId = selectedArc.arcId;
        const entryId = `${manifest.id}@${manifest.version}`;
        if (seen.has(entryId)) {
            continue;
        }
        seen.add(entryId);
        const sourceRelease = findReleaseForStoryEntry([activeRelease, ...releases], manifest, arcId);
        const manifestUrl = typeof manifestUrlFactory === 'function'
            ? manifestUrlFactory(manifest)
            : '';
        const release = createPlayableStoryRelease(manifest, {
            activeArcId: arcId,
            sourceRelease,
            manifestUrl,
        });
        const primaryCharacter = Object.values(manifest.resourceBindings?.characters || {})[0] || {};
        entries.push({
            protocolVersion: 'galgame.playable-story-entry.v1',
            entryId,
            scenarioId: sanitizeText(manifest.id, 120),
            scenarioVersion: sanitizeText(manifest.version, 80),
            title: sanitizeText(manifest.title, 160),
            author: sanitizeText(manifest.author || '', 160),
            locale: sanitizeText(manifest.locale || '', 40),
            contentRating: sanitizeText(manifest.contentRating || '', 60),
            arcId,
            arcTitle: sanitizeText(selectedArc.arc.title || arcId, 160),
            arcCount: getManifestArcBindings(manifest).length || 1,
            playableArcCount: playableArcs.length,
            coverAsset: sanitizeText(manifest.presentation?.titleBackgroundAsset || '', 240),
            coverUrl: sanitizeText(getAssetUrl(manifest, manifest.presentation?.titleBackgroundAsset), 400),
            defaultBackgroundAsset: sanitizeText(manifest.presentation?.defaultBackgroundAsset || '', 240),
            defaultBackgroundUrl: sanitizeText(getAssetUrl(manifest, manifest.presentation?.defaultBackgroundAsset), 400),
            spriteAsset: sanitizeText(primaryCharacter.sprite || '', 240),
            spriteUrl: sanitizeText(getAssetUrl(manifest, primaryCharacter.sprite), 400),
            characterName: sanitizeText(primaryCharacter.displayName || '', 120),
            manifestUrl: release.manifestUrl,
            release,
            isDefault: Boolean(sourceRelease && activeRelease && sourceRelease.releaseId === activeRelease.releaseId),
        });
    }
    return entries.sort((left, right) => {
        if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
        }
        return left.title.localeCompare(right.title, 'zh-CN');
    });
}

export function listStoredStorySummaries(manifests = []) {
    return manifests
        .filter((manifest) => manifest && typeof manifest === 'object' && !Array.isArray(manifest))
        .map((manifest) => {
            const validation = validateScenarioManifest(manifest);
            const playableArcs = validation.valid ? getPlayableArcOptions(manifest) : [];
            const arcs = getManifestArcBindings(manifest);
            return {
                protocolVersion: 'galgame.stored-story-summary.v1',
                scenarioId: sanitizeText(manifest.id || '', 120),
                scenarioVersion: sanitizeText(manifest.version || '', 80),
                title: sanitizeText(manifest.title || '未命名故事', 160),
                author: sanitizeText(manifest.author || '', 160),
                locale: sanitizeText(manifest.locale || '', 40),
                contentRating: sanitizeText(manifest.contentRating || '', 60),
                arcCount: arcs.length || 1,
                playableArcCount: playableArcs.length,
                ready: validation.valid && playableArcs.length > 0,
                updatedAt: sanitizeText(manifest.updatedAt || '', 80),
            };
        })
        .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
}

function getPlayableArcOptions(manifest) {
    const seen = new Set();
    return getManifestArcBindings(manifest)
        .map((arc, index) => {
            const arcId = sanitizeText(arc.arcId || getDefaultArcId(manifest), 120);
            return {
                arc,
                arcId,
                order: Number.isFinite(arc.order) ? arc.order : index + 1,
            };
        })
        .filter((option) => {
            if (!option.arcId || seen.has(option.arcId)) {
                return false;
            }
            seen.add(option.arcId);
            if ((option.arc.status || 'published') !== 'published') {
                return false;
            }
            return validateReleaseArcSelection(manifest, option.arcId, { requirePresentationProfileHash: true }).valid;
        })
        .sort((left, right) => (
            left.order - right.order
            || sanitizeText(left.arc.title || left.arcId, 160).localeCompare(sanitizeText(right.arc.title || right.arcId, 160), 'zh-CN')
        ));
}

function choosePlayableStoryArc(manifest, playableArcs, activeRelease = null, releases = []) {
    if (!playableArcs.length) {
        return null;
    }
    const releaseArcIds = [activeRelease, ...releases]
        .filter((release) => release
            && release.scenarioId === manifest.id
            && release.scenarioVersion === manifest.version)
        .map((release) => sanitizeText(release.activeArcId || release.arcId || getDefaultArcId(manifest), 120))
        .filter(Boolean);
    for (const arcId of releaseArcIds) {
        const matched = playableArcs.find((option) => option.arcId === arcId);
        if (matched) {
            return matched;
        }
    }
    const defaultArcId = getDefaultArcId(manifest);
    return playableArcs.find((option) => option.arcId === defaultArcId) || playableArcs[0];
}

function findReleaseForStoryEntry(releases, manifest, arcId) {
    return releases.filter(Boolean).find((release) => (
        release.scenarioId === manifest.id
        && release.scenarioVersion === manifest.version
        && (release.activeArcId || release.arcId || getDefaultArcId(manifest)) === arcId
    )) || null;
}

export function validateReleaseArcSelection(manifest, activeArcId = '', { requirePresentationProfileHash = false } = {}) {
    const manifestValidation = validateScenarioManifest(manifest);
    if (!manifestValidation.valid) {
        return manifestValidation;
    }

    const arcId = sanitizeText(activeArcId || getDefaultArcId(manifest), 120);
    const arc = findArcBinding(manifest, arcId);
    if (!arc) {
        return {
            valid: false,
            errors: [`activeArcId "${arcId}" does not exist in this scenario manifest.`],
            warnings: [],
        };
    }

    const errors = [];
    const warnings = [...manifestValidation.warnings];
    if ((arc.status || 'published') !== 'published') {
        errors.push(`activeArcId "${arcId}" is ${arc.status || 'draft'} and cannot be published until original resources are complete.`);
    }
    const bindingStatus = validateSillyTavernBindings(manifest, { arcId });
    errors.push(...bindingStatus.errors);
    warnings.push(...bindingStatus.warnings);
    const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, arcId);
    if (!profileBinding.valid) {
        errors.push(...profileBinding.errors.map((error) => `presentation profile: ${error}`));
    }
    if (requirePresentationProfileHash) {
        if (!arc.presentationProfileHash) {
            errors.push(`activeArcId "${arcId}" is missing presentationProfileHash; publish must bind the exact AdaptivePresentationProfileV1 hash.`);
        } else if (arc.presentationProfileHash !== profileBinding.profileHash) {
            errors.push(`activeArcId "${arcId}" presentationProfileHash does not match adaptivePresentationProfiles "${profileBinding.profileId}".`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export function validateActiveReleaseManifestBinding(release, manifest, { requirePresentationProfileHash = true } = {}) {
    const errors = [];
    const warnings = [];
    if (!release || typeof release !== 'object' || Array.isArray(release)) {
        return { valid: false, errors: ['active release is missing or invalid.'], warnings };
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return { valid: false, errors: ['active release manifest is missing or invalid.'], warnings };
    }
    if (release.scenarioId !== manifest.id) {
        errors.push('active release scenarioId does not match manifest.id.');
    }
    if (release.scenarioVersion !== manifest.version) {
        errors.push('active release scenarioVersion does not match manifest.version.');
    }

    const arcId = sanitizeText(release.activeArcId || release.arcId || getDefaultArcId(manifest), 120);
    const arc = findArcBinding(manifest, arcId);
    if (!arc) {
        errors.push(`active release arc "${arcId}" does not exist in manifest.`);
    }

    const arcValidation = validateReleaseArcSelection(manifest, arcId, { requirePresentationProfileHash });
    errors.push(...arcValidation.errors);
    warnings.push(...arcValidation.warnings);

    const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, arcId);
    if (!profileBinding.valid) {
        errors.push(...profileBinding.errors.map((error) => `active release profile: ${error}`));
    }

    const releaseProfileId = sanitizeText(release.presentationProfileId || '', 120);
    const releaseProfileHash = sanitizeText(release.presentationProfileHash || '', 160);
    if (requirePresentationProfileHash) {
        if (!releaseProfileId) {
            errors.push('active release is missing presentationProfileId.');
        }
        if (!releaseProfileHash) {
            errors.push('active release is missing presentationProfileHash.');
        }
    }
    if (releaseProfileId && profileBinding.profileId && releaseProfileId !== profileBinding.profileId) {
        errors.push(`active release presentationProfileId "${releaseProfileId}" does not match Arc presentationProfileId "${profileBinding.profileId}".`);
    }
    if (releaseProfileHash && profileBinding.profileHash && releaseProfileHash !== profileBinding.profileHash) {
        errors.push(`active release presentationProfileHash does not match adaptivePresentationProfiles "${profileBinding.profileId}".`);
    }
    if (arc?.presentationProfileHash && releaseProfileHash && arc.presentationProfileHash !== releaseProfileHash) {
        errors.push('active release presentationProfileHash does not match Arc presentationProfileHash.');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

export function getAssetUrl(manifest, assetId) {
    if (!assetId) {
        return '';
    }

    if (/^(https?:|data:|blob:|asset:\/\/)/.test(assetId)) {
        return assetId.replace('asset://', '');
    }

    const assets = manifest?.resourceBindings?.assets || {};
    return assets[assetId] || assetId;
}

export function createMediaIdempotencyKey(releaseId, sessionId, eventId) {
    return `${releaseId}:${sessionId}:${eventId}`;
}

function resolveRawSillyTavernBindings(manifest, arcId = '') {
    if (Array.isArray(manifest?.arcs)) {
        const arc = findArcBinding(manifest, arcId);
        if (arc) {
            return arc.sillyTavernBindings;
        }
    }
    return manifest?.sillyTavernBindings;
}

function materializeSillyTavernBindings(bindings) {
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings) || !bindings.target) {
        return bindings;
    }

    const target = bindings.target || {};
    const characters = Array.isArray(bindings.characters) && bindings.characters.length
        ? bindings.characters
        : materializeTargetCharacters(target);
    const worldBooks = Array.isArray(bindings.worldBooks) && bindings.worldBooks.length
        ? bindings.worldBooks
        : materializeWorldBookRefs(bindings.worldBookRefs);

    return {
        ...bindings,
        characters,
        groupId: bindings.groupId || target.groupRef?.groupId || '',
        worldBooks,
        presetId: bindings.presetId || bindings.generationPresetRef || '',
        instructPresetId: bindings.instructPresetId || bindings.instructPresetRef || '',
        systemPromptId: bindings.systemPromptId || bindings.systemPromptRef || '',
        contextPresetId: bindings.contextPresetId || bindings.contextPresetRef || '',
        chatSeedId: bindings.chatSeedId || target.chatSeedId || '',
    };
}

function materializeTargetCharacters(target) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        return [];
    }
    if (target.mode === 'single-character') {
        return [materializeCharacterRef(target.characterRef, 'main')].filter((character) => character.id);
    }
    if (target.mode === 'multi-character') {
        const director = target.directorCharacterRef
            ? [materializeCharacterRef(target.directorCharacterRef, 'narrator')]
            : [];
        const characters = (Array.isArray(target.characterRefs) ? target.characterRefs : [])
            .map((ref, index) => materializeCharacterRef(ref, director.length ? 'supporting' : index === 0 ? 'main' : 'supporting'));
        return [...director, ...characters].filter((character) => character.id);
    }
    if (target.mode === 'group') {
        return (Array.isArray(target.characterRefs) ? target.characterRefs : [])
            .map((ref) => materializeCharacterRef(ref, 'supporting'))
            .filter((character) => character.id);
    }
    return [];
}

function materializeCharacterRef(ref, role) {
    return {
        id: sanitizeText(ref?.name || ref?.id || '', 160),
        role,
        avatar: sanitizeText(ref?.avatar || '', 240),
    };
}

function materializeWorldBookRefs(worldBookRefs) {
    return (Array.isArray(worldBookRefs) ? worldBookRefs : [])
        .map((ref) => {
            if (typeof ref === 'string') {
                return {
                    name: sanitizeText(ref, 160),
                    mode: 'manual',
                };
            }
            return {
                name: sanitizeText(ref?.name || ref?.id || '', 160),
                mode: sanitizeText(ref?.mode || 'manual', 40),
                weight: Number.isFinite(ref?.weight) ? ref.weight : undefined,
            };
        })
        .filter((worldBook) => worldBook.name);
}

function validateFormalTarget(target, errors) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        errors.push('sillyTavernBindings.target must be an object when provided.');
        return;
    }
    if (!['single-character', 'multi-character', 'group'].includes(target.mode)) {
        errors.push('sillyTavernBindings.target.mode must be single-character, multi-character, or group.');
    }
    if (!target.chatSeedId || typeof target.chatSeedId !== 'string') {
        errors.push('sillyTavernBindings.target.chatSeedId is required.');
    }
    if (target.characterRef) {
        rejectEmbeddedOriginalResourceBody(target.characterRef, FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS, 'target characterRef', errors);
    }
    for (const [index, ref] of (Array.isArray(target.characterRefs) ? target.characterRefs : []).entries()) {
        rejectEmbeddedOriginalResourceBody(ref, FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS, `target characterRefs[${index}]`, errors);
    }
    if (target.directorCharacterRef) {
        rejectEmbeddedOriginalResourceBody(target.directorCharacterRef, FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS, 'target directorCharacterRef', errors);
    }
    if (target.mode === 'single-character' && !sanitizeText(target.characterRef?.name || target.characterRef?.id || '', 160)) {
        errors.push('sillyTavernBindings.target.characterRef.name is required for single-character targets.');
    }
    if (target.mode === 'multi-character' && !Array.isArray(target.characterRefs)) {
        errors.push('sillyTavernBindings.target.characterRefs is required for multi-character targets.');
    }
    if (target.mode === 'group' && !sanitizeText(target.groupRef?.groupId || '', 160)) {
        errors.push('sillyTavernBindings.target.groupRef.groupId is required for group targets.');
    }
}

export function buildMediaJobRequest({ release, state, manifest, event }) {
    const fallbackAsset = event.fallbackAsset || manifest.presentation.defaultBackgroundAsset;
    return {
        protocol_version: PROTOCOL_VERSION,
        request_id: `media_${event.id}_${Date.now().toString(36)}`,
        kind: event.kind || 'image',
        event: {
            release_id: release.releaseId,
            scenario_id: release.scenarioId,
            chapter_id: sanitizeText(state.chapterId || 'native'),
            scene_id: sanitizeText(state.sceneId || 'native'),
            node_id: sanitizeText(state.nodeId || 'native'),
            event_id: event.id,
        },
        scene: {
            summary: sanitizeText(event.summary || ''),
            location: sanitizeText(event.location || state.sceneId || ''),
            time: sanitizeText(event.time || ''),
            weather: sanitizeText(event.weather || ''),
            mood: sanitizeText(event.mood || ''),
            camera: sanitizeText(event.camera || ''),
        },
        characters: Array.isArray(event.characters) ? event.characters : [],
        prompt: {
            style_id: sanitizeText(event.styleId || manifest.media?.defaultStyleId || 'scenario_default'),
            positive: sanitizeText(event.positive || event.summary || ''),
            negative: sanitizeText(event.negative || manifest.media?.defaultNegative || ''),
        },
        output: {
            width: event.width || 1536,
            height: event.height || 864,
            format: event.format || 'webp',
        },
        policy: {
            blocking: Boolean(event.blocking),
            timeout_ms: event.timeoutMs || manifest.media?.timeoutMs || 120000,
            fallback_asset: fallbackAsset,
        },
    };
}

function validateNativeOnlyStory(story, errors, warnings) {
    if (story.mode !== 'sillytavern-live') {
        errors.push('story.mode must be sillytavern-live; custom authored story engines are not accepted.');
    }

    for (const key of ['initialVariables', 'initialRelationships', 'initialInventory', 'interaction']) {
        if (Object.prototype.hasOwnProperty.call(story, key)) {
            errors.push(`story.${key} is not allowed; frontend state must not become a parallel narrative authority.`);
        }
    }

    const nodes = story.nodes && typeof story.nodes === 'object' ? story.nodes : {};
    if (story.startNodeId && !nodes[story.startNodeId]) {
        errors.push(`story.startNodeId "${story.startNodeId}" does not exist in story.nodes.`);
    }

    for (const [nodeId, node] of Object.entries(nodes)) {
        if (Array.isArray(node.lines) && node.lines.length > 0) {
            errors.push(`story.nodes.${nodeId}.lines must be empty; story text must come from original SillyTavern play.`);
        }
        if (Array.isArray(node.choices) && node.choices.length > 0) {
            errors.push(`story.nodes.${nodeId}.choices must be empty; choices must come from original SillyTavern play.`);
        }
        for (const key of ['allowFreeInput', 'freeInputPrompt', 'choicePrompt', 'fallbackChoices']) {
            if (Object.prototype.hasOwnProperty.call(node, key)) {
                errors.push(`story.nodes.${nodeId}.${key} is not allowed; interaction must stay in original SillyTavern play.`);
            }
        }
        if (node.nextNodeId) {
            errors.push(`story.nodes.${nodeId}.nextNodeId is not allowed.`);
        }
        if (node.freeInputNextNodeId) {
            errors.push(`story.nodes.${nodeId}.freeInputNextNodeId is not allowed.`);
        }
        if (Array.isArray(node.proposedStateChanges) && node.proposedStateChanges.length > 0) {
            errors.push(`story.nodes.${nodeId}.proposedStateChanges is not allowed.`);
        }
    }

    if (!Object.keys(nodes).length) {
        warnings.push('story.nodes is empty; this is acceptable for a pure native launcher but may reduce admin preview context.');
    }
}

function requireString(value, pathName, errors) {
    if (typeof value !== 'string' || !value.trim()) {
        errors.push(`${pathName} is required.`);
    }
}

function rejectEmbeddedOriginalResourceBody(value, forbiddenBodyKeys, label, errors) {
    for (const key of forbiddenBodyKeys) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            errors.push('sillyTavernBindings for ' + label + ' must store references only, not original resource body field "' + key + '".');
        }
    }
}
