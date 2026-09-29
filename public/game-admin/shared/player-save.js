import {
    STORAGE_KEYS,
    createPlayableStoryRelease,
    nowIso,
    resolveAdaptivePresentationProfileBinding,
    sanitizeText,
} from './protocol.js?v=auto-aad3711e0118';
import { createStorageBackend } from './storage.js?v=auto-aad3711e0118';

export const PLAYER_SAVE_PROTOCOL_VERSION = 'galgame.player-save.v1';
export const AUTO_SAVE_ID = 'auto';
export const MANUAL_SAVE_COUNT = 6;

const TOP_LEVEL_KEYS = new Set([
    'protocolVersion',
    'saveId',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'presentationProfileId',
    'presentationProfileHash',
    'chatId',
    'lastMessageIndex',
    'pageIndex',
    'visualState',
    'savedAt',
]);

const VISUAL_STATE_KEYS = new Set([
    'backgroundId',
    'spriteIds',
    'bgmId',
    'mediaJobIds',
]);

const FORBIDDEN_NORMALIZED_KEYS = new Set([
    'affection',
    'choice',
    'choices',
    'completedchoice',
    'completedchoices',
    'ending',
    'flag',
    'flags',
    'inventory',
    'item',
    'items',
    'node',
    'nodeid',
    'plot',
    'quest',
    'relationship',
    'relationships',
    'route',
    'routeid',
    'sceneresult',
    'storyresult',
    'statechange',
    'statechanges',
    'variable',
    'variables',
    'worldfact',
    'worldfacts',
]);

export function createPlayerSaveStore(backend = createStorageBackend()) {
    return new PlayerSaveStore(backend);
}

export class PlayerSaveStore {
    constructor(backend = createStorageBackend()) {
        this.backend = backend;
    }

    async saveSlot(slot) {
        const normalized = normalizePlayerSaveSlot(slot);
        await this.backend.set(playerSaveKey(normalized.saveId), normalized);
        return normalized;
    }

    async saveSnapshot({
        saveId = AUTO_SAVE_ID,
        release,
        manifest,
        snapshot,
        pageIndex = 0,
        visualState = {},
    }) {
        return this.saveSlot(createPlayerSaveSlot({
            saveId,
            release,
            manifest,
            snapshot,
            pageIndex,
            visualState,
        }));
    }

    async loadSlot(saveId) {
        const slot = await this.backend.get(playerSaveKey(saveId));
        if (!slot) {
            return null;
        }
        return normalizePlayerSaveSlot(slot);
    }

    async listSlots() {
        const entries = await this.backend.entries(STORAGE_KEYS.playerSavePrefix);
        return entries
            .map((entry) => normalizePlayerSaveSlot(entry.value, { allowInvalid: true }))
            .filter(Boolean)
            .sort(comparePlayerSaveSlots);
    }
}

export function createPlayerSaveSlot({
    saveId = AUTO_SAVE_ID,
    release,
    manifest,
    snapshot,
    pageIndex = 0,
    visualState = {},
}) {
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    const arcId = release?.activeArcId || release?.arcId || manifest?.arcId || manifest?.defaultArcId || '';
    const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, arcId);
    return normalizePlayerSaveSlot({
        protocolVersion: PLAYER_SAVE_PROTOCOL_VERSION,
        saveId,
        releaseId: release?.releaseId,
        scenarioId: release?.scenarioId || manifest?.id,
        scenarioVersion: release?.scenarioVersion || manifest?.version,
        arcId,
        presentationProfileId: release?.presentationProfileId || profileBinding.profileId || '',
        presentationProfileHash: release?.presentationProfileHash || profileBinding.profileHash || '',
        chatId: snapshot?.fileName,
        lastMessageIndex: Math.max(0, messages.length - 1),
        pageIndex,
        visualState: normalizeVisualState({
            backgroundId: visualState.backgroundId || manifest?.presentation?.defaultBackgroundAsset || '',
            spriteIds: visualState.spriteIds || getDefaultSpriteIds(manifest),
            bgmId: visualState.bgmId || '',
            mediaJobIds: visualState.mediaJobIds || [],
        }),
        savedAt: nowIso(),
    });
}

export function createCanonicalPlayerSaveRelease(slot, manifest) {
    const normalized = normalizePlayerSaveSlot(slot);
    if (
        !manifest
        || manifest.id !== normalized.scenarioId
        || manifest.version !== normalized.scenarioVersion
    ) {
        throw new Error('PLAYER_SAVE_MANIFEST_MISMATCH');
    }

    const profileBinding = resolveAdaptivePresentationProfileBinding(manifest, normalized.arcId);
    if (
        !profileBinding.valid
        || profileBinding.profileId !== normalized.presentationProfileId
        || profileBinding.profileHash !== normalized.presentationProfileHash
    ) {
        throw new Error('PLAYER_SAVE_PROFILE_BINDING_MISMATCH');
    }

    // Local and republished release IDs can expire; the scenario version and Arc remain the durable save binding.
    return createPlayableStoryRelease(manifest, {
        activeArcId: normalized.arcId,
    });
}

export function normalizePlayerSaveSlot(slot, { allowInvalid = false } = {}) {
    const validation = validatePlayerSaveSlot(slot);
    if (!validation.valid) {
        if (allowInvalid) {
            return null;
        }
        throw new Error(`PLAYER_SAVE_INVALID: ${validation.errors.join('; ')}`);
    }

    const normalized = {
        protocolVersion: PLAYER_SAVE_PROTOCOL_VERSION,
        saveId: sanitizeText(slot.saveId, 80),
        releaseId: sanitizeText(slot.releaseId, 240),
        scenarioId: sanitizeText(slot.scenarioId, 160),
        scenarioVersion: sanitizeText(slot.scenarioVersion, 80),
        chatId: sanitizeText(slot.chatId, 240),
        lastMessageIndex: Math.max(0, Math.floor(Number(slot.lastMessageIndex || 0))),
        pageIndex: Math.max(0, Math.floor(Number(slot.pageIndex || 0))),
        visualState: normalizeVisualState(slot.visualState),
        savedAt: sanitizeText(slot.savedAt, 120),
    };

    if (slot.arcId) {
        normalized.arcId = sanitizeText(slot.arcId, 120);
    }
    if (slot.presentationProfileId) {
        normalized.presentationProfileId = sanitizeText(slot.presentationProfileId, 120);
    }
    if (slot.presentationProfileHash) {
        normalized.presentationProfileHash = sanitizeText(slot.presentationProfileHash, 160);
    }

    return normalized;
}

export function validatePlayerSaveSlot(slot) {
    const errors = [];
    if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
        return { valid: false, errors: ['save slot must be an object'] };
    }

    collectForbiddenKeys(slot, errors);
    for (const key of Object.keys(slot)) {
        if (!TOP_LEVEL_KEYS.has(key)) {
            errors.push(`field "${key}" is not allowed in player saves`);
        }
    }

    if (slot.protocolVersion !== PLAYER_SAVE_PROTOCOL_VERSION) {
        errors.push('unsupported player save protocol version');
    }
    for (const key of [
        'saveId',
        'releaseId',
        'scenarioId',
        'scenarioVersion',
        'arcId',
        'presentationProfileId',
        'presentationProfileHash',
        'chatId',
        'savedAt',
    ]) {
        if (!sanitizeText(slot[key], 400)) {
            errors.push(`${key} is required`);
        }
    }
    for (const key of ['lastMessageIndex', 'pageIndex']) {
        if (!Number.isInteger(Number(slot[key])) || Number(slot[key]) < 0) {
            errors.push(`${key} must be a non-negative integer`);
        }
    }

    validateVisualState(slot.visualState, errors);

    return {
        valid: errors.length === 0,
        errors,
    };
}

export function playerSaveKey(saveId) {
    return `${STORAGE_KEYS.playerSavePrefix}${sanitizeText(saveId, 80)}`;
}

export function manualSaveIds(count = MANUAL_SAVE_COUNT) {
    return Array.from({ length: count }, (_, index) => `manual-${index + 1}`);
}

function normalizeVisualState(visualState = {}) {
    return {
        backgroundId: sanitizeText(visualState.backgroundId || '', 240),
        spriteIds: normalizeStringArray(visualState.spriteIds, 12, 160),
        bgmId: sanitizeText(visualState.bgmId || '', 240),
        mediaJobIds: normalizeStringArray(visualState.mediaJobIds, 20, 160),
    };
}

function validateVisualState(visualState, errors) {
    if (!visualState || typeof visualState !== 'object' || Array.isArray(visualState)) {
        errors.push('visualState is required');
        return;
    }
    for (const key of Object.keys(visualState)) {
        if (!VISUAL_STATE_KEYS.has(key)) {
            errors.push(`visualState.${key} is not allowed`);
        }
    }
    for (const key of ['spriteIds', 'mediaJobIds']) {
        if (visualState[key] !== undefined && !Array.isArray(visualState[key])) {
            errors.push(`visualState.${key} must be an array`);
        }
    }
}

function collectForbiddenKeys(value, errors, path = '') {
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = normalizeKey(key);
        const keyPath = path ? `${path}.${key}` : key;
        if (FORBIDDEN_NORMALIZED_KEYS.has(normalizedKey)) {
            errors.push(`forbidden story field "${keyPath}"`);
        }
        if (child && typeof child === 'object') {
            collectForbiddenKeys(child, errors, keyPath);
        }
    }
}

function normalizeStringArray(value, maxItems, maxLength) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => sanitizeText(item, maxLength))
        .filter(Boolean)
        .slice(0, maxItems);
}

function getDefaultSpriteIds(manifest) {
    const characters = Object.values(manifest?.resourceBindings?.characters || {});
    return normalizeStringArray(characters.map((character) => character.sprite), 12, 160);
}

function normalizeKey(key) {
    return String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function comparePlayerSaveSlots(left, right) {
    if (left.saveId === AUTO_SAVE_ID) {
        return -1;
    }
    if (right.saveId === AUTO_SAVE_ID) {
        return 1;
    }
    return Date.parse(right.savedAt) - Date.parse(left.savedAt);
}
