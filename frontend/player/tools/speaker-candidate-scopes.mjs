import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { resolveContainedHistoryChatPath } from '../../shared/tools/presentation-history-replay.mjs';
import { extractExplicitSpeakerCandidateNames as extractExplicitSpeakerCandidateNamesShared } from '../../shared/src/sillytavern-adapter.js';

export const SPEAKER_CANDIDATE_SCOPES_SCHEMA_VERSION = 'galgame.speaker-candidate-scopes.v1';
export const SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION = 'galgame.speaker-candidate-scopes.v2';
export const SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION = 'galgame.speaker-candidate-scopes.v3';
export const SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION = 'galgame.speaker-candidate-adapters.v1';
export const SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION = 'galgame.speaker-candidate-adapters.v2';
export const SPEAKER_CANDIDATE_EXTRACTION_RULE_VERSION = 'explicit-character-heading.v1';

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_HEADER_BYTES = 1024 * 1024;
const MAX_ADAPTERS_PER_RESOURCE = 8;
const MAX_ENTRIES_PER_RESOURCE = 20_000;
const MAX_CANDIDATES_PER_SCOPE = 2_000;
const MAX_JSON_POINTER_LENGTH = 256;
const MAX_CHARACTER_CARD_BYTES = 32 * 1024 * 1024;
const MAX_PNG_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_CARD_METADATA_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class SpeakerCandidateScopeError extends Error {
    constructor(code) {
        super(code);
        this.name = 'SpeakerCandidateScopeError';
        this.code = code;
    }
}

export function createSpeakerChatFingerprint(chatsRoot, chatPath) {
    const relativePath = path.relative(path.resolve(chatsRoot), path.resolve(chatsRoot, chatPath)).replace(/\\/gu, '/');
    if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
        throw new SpeakerCandidateScopeError('CHAT_PATH_OUTSIDE_ROOT');
    }
    return `sha256:${createHash('sha256').update(relativePath, 'utf8').digest('hex')}`;
}

export function validateSpeakerCandidateScopes(scopes) {
    if (isRecord(scopes) && scopes.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION) {
        return validateSpeakerCandidateScopesV3(scopes);
    }
    if (isRecord(scopes) && scopes.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION) {
        return validateSpeakerCandidateScopesV2(scopes);
    }
    return validateLegacySpeakerCandidateScopes(scopes);
}

function validateLegacySpeakerCandidateScopes(scopes) {
    if (!isRecord(scopes) || !exactKeys(scopes, ['schemaVersion', 'entries'])
        || scopes.schemaVersion !== SPEAKER_CANDIDATE_SCOPES_SCHEMA_VERSION || !Array.isArray(scopes.entries)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
    }
    const fingerprints = new Set();
    for (const entry of scopes.entries) {
        if (!isRecord(entry) || !exactKeys(entry, [
            'chatFingerprint', 'resourceName', 'resourceFingerprint', 'extractionRuleVersion', 'candidateSpeakerNames',
        ]) || !HASH_PATTERN.test(entry.chatFingerprint) || fingerprints.has(entry.chatFingerprint)
            || !isResourceName(entry.resourceName) || !HASH_PATTERN.test(entry.resourceFingerprint)
            || entry.extractionRuleVersion !== SPEAKER_CANDIDATE_EXTRACTION_RULE_VERSION
            || !Array.isArray(entry.candidateSpeakerNames) || !entry.candidateSpeakerNames.length) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        }
        const names = new Set();
        for (const name of entry.candidateSpeakerNames) {
            if (!isSpeakerName(name) || names.has(name)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            names.add(name);
        }
        fingerprints.add(entry.chatFingerprint);
    }
    return scopes;
}

export function validateSpeakerCandidateAdapterConfig(config) {
    if (isRecord(config) && config.schemaVersion === SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION) {
        return validateSpeakerCandidateAdapterConfigV2(config);
    }
    if (!isRecord(config) || !exactKeys(config, ['schemaVersion', 'resources'])
        || config.schemaVersion !== SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION
        || !Array.isArray(config.resources) || !config.resources.length) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
    }
    const resourceNames = new Set();
    for (const resource of config.resources) {
        if (!isRecord(resource) || !exactKeys(resource, ['resourceName', 'adapters'])
            || !isResourceName(resource.resourceName) || resourceNames.has(resource.resourceName)
            || !Array.isArray(resource.adapters) || !resource.adapters.length
            || resource.adapters.length > MAX_ADAPTERS_PER_RESOURCE) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        }
        resourceNames.add(resource.resourceName);
        for (const adapter of resource.adapters) validateAdapter(adapter);
    }
    return config;
}

function validateSpeakerCandidateAdapterConfigV2(config) {
    if (!isRecord(config) || !exactKeys(config, ['schemaVersion', 'resources'])
        || config.schemaVersion !== SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION
        || !Array.isArray(config.resources) || !config.resources.length || config.resources.length > 64) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
    }
    const sourceIds = new Set();
    for (const resource of config.resources) {
        if (!isRecord(resource) || !isSafeId(resource.sourceId) || sourceIds.has(resource.sourceId)
            || !['sillytavern.worldbook-json.v1', 'sillytavern.character-card-png.v1'].includes(resource.sourceType)
            || !Array.isArray(resource.adapters) || !resource.adapters.length || resource.adapters.length > MAX_ADAPTERS_PER_RESOURCE) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        }
        sourceIds.add(resource.sourceId);
        if (resource.sourceType === 'sillytavern.worldbook-json.v1') {
            if (!exactKeys(resource, ['sourceId', 'sourceType', 'binding', 'resourceRoot', 'resourceNames', 'adapters'])
                || resource.resourceRoot !== 'worldbooks' || !Array.isArray(resource.resourceNames)
                || !resource.resourceNames.length || resource.resourceNames.length > 128
                || resource.resourceNames.some((name) => !isResourceName(name))
                || new Set(resource.resourceNames).size !== resource.resourceNames.length || !isRecord(resource.binding)
                || !exactKeys(resource.binding, ['kind', 'pointer']) || resource.binding.kind !== 'chat-header-pointer'
                || !isSafeJsonPointer(resource.binding.pointer)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
            }
            for (const adapter of resource.adapters) validateV2Extractor(adapter, resource.sourceType);
        } else {
            if (!exactKeys(resource, ['sourceId', 'sourceType', 'binding', 'resourceRoot', 'adapters'])
                || resource.resourceRoot !== 'characters' || !isRecord(resource.binding)
                || !exactKeys(resource.binding, ['kind']) || resource.binding.kind !== 'chat-character-card'
                || resource.adapters.length !== 1 || resource.adapters[0]?.adapterId !== 'character-card.canonical-name.v1'
                || !exactKeys(resource.adapters[0], ['adapterId'])) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
            }
        }
    }
    return config;
}

function validateV2Extractor(adapter, sourceType) {
    if (!isRecord(adapter) || typeof adapter.adapterId !== 'string') {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
    }
    if (adapter.adapterId === 'worldbook.explicit-headings.v1' && sourceType === 'sillytavern.worldbook-json.v1') {
        if (!exactKeys(adapter, ['adapterId'])) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        return adapter;
    }
    if (adapter.adapterId === 'json.typed-entry-fields.v1' && sourceType === 'sillytavern.worldbook-json.v1') {
        return validateAdapter(adapter);
    }
    if (adapter.adapterId === 'json.declared-name-fields.v1' && sourceType === 'sillytavern.worldbook-json.v1') {
        if (!exactKeys(adapter, ['adapterId', 'entriesPointer', 'namePointers', 'aliasPointers', 'typePointers', 'acceptedTypes', 'sourceKind'])
            || !isSafeJsonPointer(adapter.entriesPointer) || !Array.isArray(adapter.namePointers)
            || !adapter.namePointers.length || adapter.namePointers.length > 8
            || adapter.namePointers.some((pointer) => !isSafeJsonPointer(pointer))
            || !Array.isArray(adapter.aliasPointers) || adapter.aliasPointers.length > 8
            || adapter.aliasPointers.some((pointer) => !isSafeJsonPointer(pointer))
            || !Array.isArray(adapter.typePointers) || adapter.typePointers.length > 8
            || adapter.typePointers.some((pointer) => !isSafeJsonPointer(pointer))
            || !Array.isArray(adapter.acceptedTypes) || adapter.acceptedTypes.length > 32
            || adapter.acceptedTypes.some((type) => !isSpeakerName(type) || type.length > 48)
            || !['typed-roster', 'declared-roster'].includes(adapter.sourceKind)
            || (adapter.sourceKind === 'typed-roster' && (!adapter.typePointers.length || !adapter.acceptedTypes.length))) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        }
        return {
            adapterId: adapter.adapterId,
            entriesPointer: adapter.entriesPointer,
            namePointers: [...new Set(adapter.namePointers)],
            aliasPointers: [...new Set(adapter.aliasPointers)],
            typePointers: [...new Set(adapter.typePointers)],
            acceptedTypes: [...new Set(adapter.acceptedTypes.map(normalizeType))],
            sourceKind: adapter.sourceKind,
        };
    }
    if (adapter.adapterId === 'character-card.canonical-name.v1' && sourceType === 'sillytavern.character-card-png.v1'
        && exactKeys(adapter, ['adapterId'])) {
        return { adapterId: adapter.adapterId };
    }
    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_UNSUPPORTED');
}

function validateSpeakerCandidateScopesV2(scopes) {
    if (!isRecord(scopes) || !exactKeys(scopes, ['schemaVersion', 'entries'])
        || !Array.isArray(scopes.entries) || scopes.schemaVersion !== SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
    }
    const fingerprints = new Set();
    for (const entry of scopes.entries) {
        if (!isRecord(entry) || !exactKeys(entry, [
            'chatFingerprint', 'resourceName', 'resourceFingerprint', 'adapters', 'candidateSpeakerNames',
        ]) || !HASH_PATTERN.test(entry.chatFingerprint) || fingerprints.has(entry.chatFingerprint)
            || !isResourceName(entry.resourceName) || !HASH_PATTERN.test(entry.resourceFingerprint)
            || !Array.isArray(entry.adapters) || !entry.adapters.length || entry.adapters.length > MAX_ADAPTERS_PER_RESOURCE
            || !Array.isArray(entry.candidateSpeakerNames) || entry.candidateSpeakerNames.length > MAX_CANDIDATES_PER_SCOPE) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        }
        const adapterNames = new Set();
        const aggregate = new Set();
        for (const adapter of entry.adapters) {
            if (!isRecord(adapter) || !exactKeys(adapter, ['adapterId', 'config', 'configFingerprint', 'candidateSpeakerNames'])
                || !isRecord(adapter.config) || !HASH_PATTERN.test(adapter.configFingerprint) || !Array.isArray(adapter.candidateSpeakerNames)
                || adapter.candidateSpeakerNames.length > MAX_CANDIDATES_PER_SCOPE) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            const validatedAdapter = validateAdapter({ adapterId: adapter.adapterId, ...adapter.config });
            if (adapterNames.has(adapter.configFingerprint)
                || hashText(stableStringify(validatedAdapter)) !== adapter.configFingerprint) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            adapterNames.add(adapter.configFingerprint);
            const adapterNameSet = new Set();
            for (const name of adapter.candidateSpeakerNames) {
                if (!isSpeakerName(name) || adapterNameSet.has(name)) {
                    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
                }
                adapterNameSet.add(name);
                aggregate.add(name);
            }
        }
        const names = new Set();
        for (const name of entry.candidateSpeakerNames) {
            if (!isSpeakerName(name) || names.has(name)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            names.add(name);
        }
        if (!sameStrings([...aggregate], entry.candidateSpeakerNames)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        }
        fingerprints.add(entry.chatFingerprint);
    }
    return scopes;
}

function validateSpeakerCandidateScopesV3(scopes) {
    if (!isRecord(scopes) || !exactKeys(scopes, ['schemaVersion', 'entries'])
        || scopes.schemaVersion !== SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION || !Array.isArray(scopes.entries)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
    }
    const chatFingerprints = new Set();
    for (const entry of scopes.entries) {
        if (!isRecord(entry) || !exactKeys(entry, ['chatFingerprint', 'sources', 'unavailableSources'])
            || !HASH_PATTERN.test(entry.chatFingerprint) || chatFingerprints.has(entry.chatFingerprint)
            || !Array.isArray(entry.sources) || entry.sources.length > 64 || !Array.isArray(entry.unavailableSources)
            || entry.unavailableSources.length > 64) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        }
        const sourceIds = new Set();
        const resourceBindings = new Set();
        for (const source of entry.sources) {
            if (!isRecord(source) || !exactKeys(source, [
                'sourceId', 'sourceType', 'binding', 'resourceFingerprint', 'sourceConfigFingerprint', 'adapters',
            ]) || !isSafeId(source.sourceId) || sourceIds.has(source.sourceId)
                || !['sillytavern.worldbook-json.v1', 'sillytavern.character-card-png.v1'].includes(source.sourceType)
                || !HASH_PATTERN.test(source.resourceFingerprint) || !HASH_PATTERN.test(source.sourceConfigFingerprint)
                || !Array.isArray(source.adapters) || !source.adapters.length || source.adapters.length > MAX_ADAPTERS_PER_RESOURCE) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            sourceIds.add(source.sourceId);
            const binding = source.binding;
            if (!isRecord(binding) || typeof binding.resourceName !== 'string' || !isResourceName(binding.resourceName)
                || (source.sourceType === 'sillytavern.worldbook-json.v1'
                    ? !exactKeys(binding, ['kind', 'pointer', 'resourceName']) || binding.kind !== 'chat-header-pointer' || !isSafeJsonPointer(binding.pointer)
                    : !exactKeys(binding, ['kind', 'resourceName']) || binding.kind !== 'chat-character-card' || path.extname(binding.resourceName).toLowerCase() !== '.png')) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            const resourceKey = `${source.sourceType}\u0000${binding.resourceName}`;
            if (resourceBindings.has(resourceKey)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            resourceBindings.add(resourceKey);
            const adapterIds = new Set();
            let totalCandidates = 0;
            for (const adapter of source.adapters) {
                if (!isRecord(adapter) || !exactKeys(adapter, ['adapterId', 'config', 'configFingerprint', 'candidates'])
                    || typeof adapter.adapterId !== 'string' || !isRecord(adapter.config)
                    || Object.hasOwn(adapter.config, 'adapterId')
                    || !HASH_PATTERN.test(adapter.configFingerprint) || !Array.isArray(adapter.candidates)) {
                    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
                }
                const validated = validateV2Extractor({ adapterId: adapter.adapterId, ...adapter.config }, source.sourceType);
                if (adapterIds.has(adapter.adapterId)
                    || hashText(stableStringify(validated)) !== adapter.configFingerprint) {
                    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
                }
                adapterIds.add(adapter.adapterId);
                const candidateNames = new Set();
                for (const candidate of adapter.candidates) {
                    if (!isRecord(candidate) || !exactKeys(candidate, ['name', 'fieldPointer'])
                        || !isSpeakerName(candidate.name) || !isSafeJsonPointer(candidate.fieldPointer)
                        || candidateNames.has(candidate.name)) {
                        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
                    }
                    candidateNames.add(candidate.name);
                    totalCandidates += 1;
                }
            }
            if (totalCandidates > MAX_CANDIDATES_PER_SCOPE) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_TOO_LARGE');
        }
        for (const unavailable of entry.unavailableSources) {
            if (!isRecord(unavailable) || !exactKeys(unavailable, ['sourceId', 'sourceConfigFingerprint', 'reasonCode'])
                || !isSafeId(unavailable.sourceId) || sourceIds.has(unavailable.sourceId)
                || !HASH_PATTERN.test(unavailable.sourceConfigFingerprint)
                || !['SOURCE_BINDING_UNAVAILABLE', 'SOURCE_RESOURCE_UNAVAILABLE', 'SOURCE_RESOURCE_INVALID', 'CARD_IDENTITY_MISMATCH', 'CARD_PATH_UNSUPPORTED'].includes(unavailable.reasonCode)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
            }
            sourceIds.add(unavailable.sourceId);
        }
        chatFingerprints.add(entry.chatFingerprint);
    }
    return scopes;
}

function validateAdapter(adapter) {
    if (!isRecord(adapter) || typeof adapter.adapterId !== 'string') {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
    }
    if (adapter.adapterId === 'worldbook.explicit-headings.v1') {
        if (!exactKeys(adapter, ['adapterId'])) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        return { adapterId: adapter.adapterId };
    }
    if (adapter.adapterId === 'json.typed-entry-fields.v1') {
        if (!exactKeys(adapter, ['adapterId', 'entriesPointer', 'namePointers', 'typePointers', 'acceptedTypes'])
            || !isSafeJsonPointer(adapter.entriesPointer) || !Array.isArray(adapter.namePointers)
            || !adapter.namePointers.length || adapter.namePointers.length > 8
            || adapter.namePointers.some((pointer) => !isSafeJsonPointer(pointer))
            || !Array.isArray(adapter.typePointers) || !adapter.typePointers.length || adapter.typePointers.length > 8
            || adapter.typePointers.some((pointer) => !isSafeJsonPointer(pointer))
            || !Array.isArray(adapter.acceptedTypes) || !adapter.acceptedTypes.length || adapter.acceptedTypes.length > 32
            || adapter.acceptedTypes.some((type) => !isSpeakerName(type) || type.length > 48)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID');
        }
        return {
            adapterId: adapter.adapterId,
            entriesPointer: adapter.entriesPointer,
            namePointers: [...new Set(adapter.namePointers)],
            typePointers: [...new Set(adapter.typePointers)],
            acceptedTypes: [...new Set(adapter.acceptedTypes.map(normalizeType))],
        };
    }
    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_UNSUPPORTED');
}

function adapterConfiguration(adapter) {
    const { adapterId, ...config } = adapter;
    return config;
}

function runCandidateAdapter(worldbook, adapter) {
    if (adapter.adapterId === 'worldbook.explicit-headings.v1') {
        return extractExplicitSpeakerCandidateNames(worldbook);
    }
    if (adapter.adapterId === 'json.typed-entry-fields.v1') {
        const container = resolveJsonPointer(worldbook, adapter.entriesPointer);
        if (!Array.isArray(container) && !isRecord(container)) return [];
        const entries = Array.isArray(container) ? container : Object.keys(container).sort().map((key) => container[key]);
        if (entries.length > MAX_ENTRIES_PER_RESOURCE) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_RESOURCE_TOO_LARGE');
        }
        const acceptedTypes = new Set(adapter.acceptedTypes.map(normalizeType));
        const names = new Set();
        for (const entry of entries) {
            if (!isRecord(entry)) continue;
            const entryTypes = adapter.typePointers.flatMap((pointer) => valuesAtPointer(entry, pointer))
                .filter((value) => typeof value === 'string').map(normalizeType);
            if (!entryTypes.some((type) => acceptedTypes.has(type))) continue;
            for (const value of adapter.namePointers.map((pointer) => resolveJsonPointer(entry, pointer))) {
                if (typeof value === 'string' && isSpeakerName(value)) names.add(value);
            }
        }
        const candidates = [...names];
        if (candidates.length > MAX_CANDIDATES_PER_SCOPE) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_TOO_LARGE');
        }
        return candidates;
    }
    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_UNSUPPORTED');
}

function valuesAtPointer(value, pointer) {
    const result = resolveJsonPointer(value, pointer);
    if (result === undefined || result === null) return [];
    return Array.isArray(result) ? result : [result];
}

function resolveJsonPointer(value, pointer) {
    let current = value;
    for (const encodedPart of pointer.slice(1).split('/')) {
        const part = encodedPart.replace(/~1/gu, '/').replace(/~0/gu, '~');
        if (Array.isArray(current)) {
            if (!/^(?:0|[1-9]\d*)$/u.test(part)) return undefined;
            current = current[Number(part)];
        } else if (isRecord(current) && Object.hasOwn(current, part)) {
            current = current[part];
        } else {
            return undefined;
        }
    }
    return current;
}

function isSafeJsonPointer(value) {
    if (typeof value !== 'string' || value.length > MAX_JSON_POINTER_LENGTH || !value.startsWith('/')) return false;
    const parts = value.slice(1).split('/');
    return parts.length > 0 && parts.length <= 16 && parts.every((part) => (
        part !== '' && part !== '*'
        && !['__proto__', 'prototype', 'constructor'].includes(part.replace(/~1/gu, '/').replace(/~0/gu, '~'))
        && !/(?:~(?![01]))/u.test(part)
    ));
}

function normalizeType(value) {
    return String(value).trim().toLocaleLowerCase('en-US');
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function hashText(value) {
    return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

export async function buildSpeakerCandidateScopes({ chatPaths = [], chatsRoot, worldbooksRoot, charactersRoot, candidateAdapters = null } = {}) {
    if (!Array.isArray(chatPaths) || !chatsRoot || !worldbooksRoot) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_OPTIONS_INVALID');
    }
    if (candidateAdapters) {
        if (candidateAdapters.schemaVersion === SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION) {
            return buildSpeakerCandidateScopesV3({ chatPaths, chatsRoot, worldbooksRoot, charactersRoot, candidateAdapters });
        }
        return buildSpeakerCandidateScopesV2({ chatPaths, chatsRoot, worldbooksRoot, candidateAdapters });
    }
    const entries = [];
    const fingerprints = new Set();
    for (const chatPath of chatPaths) {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
        if (fingerprints.has(chatFingerprint)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        fingerprints.add(chatFingerprint);
        const header = await readChatHeader(chatsRoot, path.resolve(chatsRoot, chatPath));
        const resourceName = header?.chat_metadata?.world_info;
        if (typeof resourceName !== 'string' || !resourceName.trim()) continue;
        const resourceBytes = await readBoundWorldbook(worldbooksRoot, resourceName);
        const worldbook = parseJson(resourceBytes, 'SPEAKER_CANDIDATE_WORLD_BOOK_INVALID');
        const candidateSpeakerNames = extractExplicitSpeakerCandidateNames(worldbook);
        if (!candidateSpeakerNames.length) continue;
        entries.push({
            chatFingerprint,
            resourceName,
            resourceFingerprint: hashBytes(resourceBytes),
            extractionRuleVersion: SPEAKER_CANDIDATE_EXTRACTION_RULE_VERSION,
            candidateSpeakerNames,
        });
    }
    return validateSpeakerCandidateScopes({ schemaVersion: SPEAKER_CANDIDATE_SCOPES_SCHEMA_VERSION, entries });
}

async function buildSpeakerCandidateScopesV3({ chatPaths, chatsRoot, worldbooksRoot, charactersRoot, candidateAdapters }) {
    if (!charactersRoot) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_OPTIONS_INVALID');
    const config = validateSpeakerCandidateAdapterConfig(candidateAdapters);
    const entries = [];
    const fingerprints = new Set();
    for (const chatPath of chatPaths) {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
        if (fingerprints.has(chatFingerprint)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        fingerprints.add(chatFingerprint);
        const { sources, unavailableSources } = await resolveV3Sources({
            chatPath, chatsRoot, worldbooksRoot, charactersRoot, config,
        });
        entries.push({ chatFingerprint, sources, unavailableSources });
    }
    return validateSpeakerCandidateScopes({ schemaVersion: SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION, entries });
}

async function resolveV3Sources({ chatPath, chatsRoot, worldbooksRoot, charactersRoot, config }) {
    const header = await readChatHeader(chatsRoot, path.resolve(chatsRoot, chatPath));
    const sources = [];
    const unavailableSources = [];
    for (const resource of config.resources) {
        const normalizedResource = normalizeV2Resource(resource);
        const sourceConfigFingerprint = hashText(stableStringify(normalizedResource));
        let resourceName = '';
        let binding;
        let resourceBytes;
        let payload;
        if (resource.sourceType === 'sillytavern.worldbook-json.v1') {
            const value = resolveJsonPointer(header, resource.binding.pointer);
            if (!isResourceName(value)) {
                unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'SOURCE_BINDING_UNAVAILABLE' });
                continue;
            }
            if (!resource.resourceNames.includes(value)) continue;
            resourceName = `${value}.json`;
            binding = { kind: resource.binding.kind, pointer: resource.binding.pointer, resourceName: value };
            try {
                resourceBytes = await readBoundWorldbook(worldbooksRoot, value);
            } catch (error) {
                if (error?.code === 'SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND') {
                    unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'SOURCE_RESOURCE_UNAVAILABLE' });
                    continue;
                }
                throw error;
            }
            try {
                payload = parseJson(resourceBytes, 'SPEAKER_CANDIDATE_WORLD_BOOK_INVALID');
            } catch (error) {
                if (error?.code === 'SPEAKER_CANDIDATE_WORLD_BOOK_INVALID') {
                    unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'SOURCE_RESOURCE_INVALID' });
                    continue;
                }
                throw error;
            }
        } else {
            const cardKey = deriveCardKeyFromChatPath(chatsRoot, chatPath);
            if (!cardKey) {
                unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'CARD_PATH_UNSUPPORTED' });
                continue;
            }
            resourceName = `${cardKey}.png`;
            binding = { kind: resource.binding.kind, resourceName };
            try {
                resourceBytes = await readBoundCharacterCard(charactersRoot, resourceName);
            } catch (error) {
                if (error?.code === 'SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND') {
                    unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'SOURCE_RESOURCE_UNAVAILABLE' });
                    continue;
                }
                throw error;
            }
            try {
                payload = decodeCharacterCardPng(resourceBytes);
            } catch (error) {
                if (error instanceof SpeakerCandidateScopeError && /CHARACTER_CARD|CARD_METADATA/u.test(error.code)) {
                    unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'SOURCE_RESOURCE_INVALID' });
                    continue;
                }
                throw error;
            }
            const headerName = typeof header?.character_name === 'string' ? header.character_name : '';
            if (!headerName || payload.identity !== headerName) {
                unavailableSources.push({ sourceId: resource.sourceId, sourceConfigFingerprint, reasonCode: 'CARD_IDENTITY_MISMATCH' });
                continue;
            }
        }
        const adapters = resource.adapters.map((adapter) => {
            const normalized = validateV2Extractor(adapter, resource.sourceType);
            const candidates = extractV2CandidateRecords(payload, normalized, resource.sourceType);
            return {
                adapterId: normalized.adapterId,
                config: adapterConfiguration(normalized),
                configFingerprint: hashText(stableStringify(normalized)),
                candidates,
            };
        });
        sources.push({
            sourceId: resource.sourceId,
            sourceType: resource.sourceType,
            binding,
            resourceFingerprint: hashBytes(resourceBytes),
            sourceConfigFingerprint,
            adapters,
        });
    }
    return { sources, unavailableSources };
}

function normalizeV2Resource(resource) {
    const normalized = {
        sourceId: resource.sourceId,
        sourceType: resource.sourceType,
        binding: resource.binding,
        resourceRoot: resource.resourceRoot,
        adapters: resource.adapters.map((adapter) => validateV2Extractor(adapter, resource.sourceType)),
    };
    if (resource.sourceType === 'sillytavern.worldbook-json.v1') normalized.resourceNames = [...resource.resourceNames];
    return normalized;
}

function extractV2CandidateRecords(payload, adapter, sourceType) {
    if (sourceType === 'sillytavern.character-card-png.v1') {
        if (adapter.adapterId !== 'character-card.canonical-name.v1') throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_UNSUPPORTED');
        return [{ name: payload.identity, fieldPointer: payload.identityPointer }];
    }
    if (adapter.adapterId === 'worldbook.explicit-headings.v1') return extractExplicitCandidateRecords(payload);
    const container = resolveJsonPointer(payload, adapter.entriesPointer);
    if (!Array.isArray(container) && !isRecord(container)) return [];
    const entries = Array.isArray(container)
        ? container.map((value, index) => ({ key: String(index), value }))
        : Object.keys(container).sort().map((key) => ({ key, value: container[key] }));
    if (entries.length > MAX_ENTRIES_PER_RESOURCE) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_RESOURCE_TOO_LARGE');
    const candidates = [];
    for (const { key, value } of entries) {
        if (!isRecord(value)) continue;
        const basePointer = `${adapter.entriesPointer}/${escapeJsonPointerPart(key)}`;
        if (adapter.adapterId === 'json.typed-entry-fields.v1' || adapter.sourceKind === 'typed-roster') {
            const types = adapter.typePointers.flatMap((pointer) => valuesAtPointer(value, pointer))
                .filter((item) => typeof item === 'string').map(normalizeType);
            if (!types.some((type) => adapter.acceptedTypes.includes(type))) continue;
        }
        for (const pointer of adapter.namePointers) {
            const name = resolveJsonPointer(value, pointer);
            if (isSpeakerName(name)) {
                if (candidates.length >= MAX_CANDIDATES_PER_SCOPE) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_TOO_LARGE');
                candidates.push({ name, fieldPointer: `${basePointer}${pointer}` });
            }
        }
        if (adapter.adapterId === 'json.declared-name-fields.v1') {
            for (const pointer of adapter.aliasPointers) {
                const aliases = resolveJsonPointer(value, pointer);
                const values = Array.isArray(aliases) ? aliases : [aliases];
                for (let index = 0; index < values.length; index += 1) {
                    if (!isSpeakerName(values[index])) continue;
                    if (candidates.length >= MAX_CANDIDATES_PER_SCOPE) {
                        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_TOO_LARGE');
                    }
                    const aliasPointer = Array.isArray(aliases) ? `${basePointer}${pointer}/${index}` : `${basePointer}${pointer}`;
                    candidates.push({ name: values[index], fieldPointer: aliasPointer });
                }
            }
        }
    }
    return uniqueCandidateRecords(candidates);
}

function extractExplicitCandidateRecords(worldbook) {
    if (!isRecord(worldbook) || !isRecord(worldbook.entries) && !Array.isArray(worldbook.entries)) return [];
    const entries = Array.isArray(worldbook.entries)
        ? worldbook.entries.map((value, index) => ({ key: String(index), value }))
        : Object.keys(worldbook.entries).sort().map((key) => ({ key, value: worldbook.entries[key] }));
    const result = [];
    for (const { key, value } of entries) {
        if (!isRecord(value) || typeof value.comment !== 'string') continue;
        const name = extractExplicitCharacterHeading(value.comment);
        if (name) result.push({ name, fieldPointer: `/entries/${escapeJsonPointerPart(key)}/comment` });
    }
    return uniqueCandidateRecords(result);
}

function uniqueCandidateRecords(candidates) {
    const seen = new Set();
    return candidates.filter(({ name }) => !seen.has(name) && seen.add(name));
}

async function buildSpeakerCandidateScopesV2({ chatPaths, chatsRoot, worldbooksRoot, candidateAdapters }) {
    const validatedConfig = validateSpeakerCandidateAdapterConfig(candidateAdapters);
    const adaptersByResource = new Map(validatedConfig.resources.map((resource) => [
        resource.resourceName,
        resource.adapters.map(validateAdapter),
    ]));
    const entries = [];
    const fingerprints = new Set();
    for (const chatPath of chatPaths) {
        const chatFingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
        if (fingerprints.has(chatFingerprint)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID');
        fingerprints.add(chatFingerprint);
        const header = await readChatHeader(chatsRoot, path.resolve(chatsRoot, chatPath));
        const resourceName = header?.chat_metadata?.world_info;
        if (typeof resourceName !== 'string' || !resourceName.trim()) continue;
        const adapterConfigs = adaptersByResource.get(resourceName);
        if (!adapterConfigs) continue;
        const resourceBytes = await readBoundWorldbook(worldbooksRoot, resourceName);
        const worldbook = parseJson(resourceBytes, 'SPEAKER_CANDIDATE_WORLD_BOOK_INVALID');
        const adapters = adapterConfigs.map((adapterConfig) => ({
            adapterId: adapterConfig.adapterId,
            config: adapterConfiguration(adapterConfig),
            configFingerprint: hashText(stableStringify(adapterConfig)),
            candidateSpeakerNames: runCandidateAdapter(worldbook, adapterConfig),
        }));
        const candidateSpeakerNames = [...new Set(adapters.flatMap((adapter) => adapter.candidateSpeakerNames))];
        entries.push({
            chatFingerprint,
            resourceName,
            resourceFingerprint: hashBytes(resourceBytes),
            adapters,
            candidateSpeakerNames,
        });
    }
    return validateSpeakerCandidateScopes({ schemaVersion: SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION, entries });
}

export async function bindSpeakerCandidateScopes(scopes, { chatPaths = [], chatsRoot, worldbooksRoot, charactersRoot, candidateAdapters = null } = {}) {
    const validated = validateSpeakerCandidateScopes(scopes);
    if (!Array.isArray(chatPaths) || !chatsRoot || !worldbooksRoot) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_OPTIONS_INVALID');
    }
    const validatedAdapters = validated.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION
        ? validateSpeakerCandidateAdapterConfig(candidateAdapters) : null;
    if (validated.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION) {
        const v3Adapters = validateSpeakerCandidateAdapterConfig(candidateAdapters);
        if (!charactersRoot) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_OPTIONS_INVALID');
        const chatByFingerprint = new Map();
        for (const chatPath of chatPaths) {
            const fingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
            if (chatByFingerprint.has(fingerprint)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_CHAT_DUPLICATE');
            chatByFingerprint.set(fingerprint, chatPath);
        }
        const bound = new Map();
        for (const entry of validated.entries) {
            const chatPath = chatByFingerprint.get(entry.chatFingerprint);
            if (!chatPath) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_CHAT_NOT_IN_REPLAY');
            const current = await resolveV3Sources({
                chatPath, chatsRoot, worldbooksRoot, charactersRoot, config: v3Adapters,
            });
            if (stableStringify(current.sources) !== stableStringify(entry.sources)
                || stableStringify(current.unavailableSources) !== stableStringify(entry.unavailableSources)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SOURCE_RESULT_MISMATCH');
            }
            const candidateSpeakerNames = [...new Set(current.sources.flatMap((source) => source.adapters.flatMap((adapter) => adapter.candidates.map(({ name }) => name))))];
            bound.set(entry.chatFingerprint, { ...entry, candidateSpeakerNames });
        }
        return bound;
    }
    const chatByFingerprint = new Map();
    for (const chatPath of chatPaths) {
        const fingerprint = createSpeakerChatFingerprint(chatsRoot, chatPath);
        if (chatByFingerprint.has(fingerprint)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_CHAT_DUPLICATE');
        chatByFingerprint.set(fingerprint, chatPath);
    }
    const byFingerprint = new Map();
    for (const entry of validated.entries) {
        const chatPath = chatByFingerprint.get(entry.chatFingerprint);
        if (!chatPath) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_CHAT_NOT_IN_REPLAY');
        const header = await readChatHeader(chatsRoot, path.resolve(chatsRoot, chatPath));
        if (header?.chat_metadata?.world_info !== entry.resourceName) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_SCOPE_RESOURCE_BINDING_MISMATCH');
        }
        const resourceBytes = await readBoundWorldbook(worldbooksRoot, entry.resourceName);
        if (hashBytes(resourceBytes) !== entry.resourceFingerprint) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_HASH_MISMATCH');
        }
        const worldbook = parseJson(resourceBytes, 'SPEAKER_CANDIDATE_WORLD_BOOK_INVALID');
        if (validated.schemaVersion === SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION) {
            const resourceConfig = validatedAdapters.resources.find(({ resourceName }) => resourceName === entry.resourceName);
            if (!resourceConfig) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_MISMATCH');
            const configuredAdapters = resourceConfig.adapters.map(validateAdapter);
            const configuredFingerprints = configuredAdapters.map((config) => hashText(stableStringify(config)));
            const sidecarFingerprints = entry.adapters.map(({ configFingerprint }) => configFingerprint);
            if (!sameStrings(configuredFingerprints, sidecarFingerprints)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_CONFIG_MISMATCH');
            }
            const currentAdapters = configuredAdapters.map((config) => {
                return {
                    adapterId: config.adapterId,
                    config: adapterConfiguration(config),
                    configFingerprint: hashText(stableStringify(config)),
                    candidateSpeakerNames: runCandidateAdapter(worldbook, config),
                };
            });
            if (stableStringify(currentAdapters) !== stableStringify(entry.adapters)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_ADAPTER_RESULT_MISMATCH');
            }
            const aggregate = [...new Set(currentAdapters.flatMap((adapter) => adapter.candidateSpeakerNames))];
            if (!sameStrings(aggregate, entry.candidateSpeakerNames)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_NAMES_DO_NOT_MATCH_RESOURCE');
            }
        } else {
            const currentNames = extractExplicitSpeakerCandidateNames(worldbook);
            if (!sameStrings(currentNames, entry.candidateSpeakerNames)) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_NAMES_DO_NOT_MATCH_RESOURCE');
            }
        }
        if (byFingerprint.has(entry.chatFingerprint)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_NAMES_DO_NOT_MATCH_RESOURCE');
        }
        byFingerprint.set(entry.chatFingerprint, entry);
    }
    return byFingerprint;
}

export function extractExplicitSpeakerCandidateNames(worldbook) {
    return extractExplicitSpeakerCandidateNamesShared(worldbook);
}

function resolveWorldbookPath(worldbooksRoot, resourceName) {
    if (!isResourceName(resourceName)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_RESOURCE_NAME_INVALID');
    const root = path.resolve(worldbooksRoot);
    const resolved = path.resolve(root, `${resourceName}.json`);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_RESOURCE_NAME_INVALID');
    }
    return resolved;
}

async function readBoundWorldbook(worldbooksRoot, resourceName) {
    const resourcePath = resolveWorldbookPath(worldbooksRoot, resourceName);
    const rootPath = path.resolve(worldbooksRoot);
    const rootStatus = await lstat(rootPath).catch(() => null);
    if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink() || await realpath(rootPath).catch(() => '') !== rootPath) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND');
    }
    const beforeOpen = await lstat(resourcePath).catch(() => null);
    if (!beforeOpen?.isFile() || beforeOpen.isSymbolicLink()) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND');
    }
    const file = await open(resourcePath, 'r').catch(() => null);
    if (!file) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND');
    try {
        const opened = await file.stat();
        if (!sameFileVersion(beforeOpen, opened) || await realpath(resourcePath) !== resourcePath
            || !sameFileObject(opened, await lstat(resourcePath))) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_CHANGED_DURING_READ');
        }
        const bytes = await file.readFile();
        const afterRead = await file.stat();
        const finalPathStat = await lstat(resourcePath);
        if (!sameFileVersion(opened, afterRead) || await realpath(resourcePath) !== resourcePath
            || finalPathStat.isSymbolicLink() || !sameFileObject(afterRead, finalPathStat)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_CHANGED_DURING_READ');
        }
        return bytes;
    } catch (error) {
        if (error instanceof SpeakerCandidateScopeError) throw error;
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND');
    } finally {
        await file.close();
    }
}

function deriveCardKeyFromChatPath(chatsRoot, chatPath) {
    const relative = path.relative(path.resolve(chatsRoot), path.resolve(chatsRoot, chatPath));
    const parts = relative.split(path.sep);
    if (parts.length !== 2 || !isResourceName(parts[0]) || !isResourceName(path.parse(parts[1]).name)
        || path.extname(parts[1]).toLowerCase() !== '.jsonl') return '';
    return parts[0];
}

async function readBoundCharacterCard(charactersRoot, resourceName) {
    if (!isResourceName(path.parse(resourceName).name) || path.extname(resourceName).toLowerCase() !== '.png') {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    }
    const rootPath = path.resolve(charactersRoot);
    const resourcePath = path.resolve(rootPath, resourceName);
    const relative = path.relative(rootPath, resourcePath);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    }
    const rootStatus = await lstat(rootPath).catch(() => null);
    if (!rootStatus?.isDirectory() || rootStatus.isSymbolicLink() || await realpath(rootPath).catch(() => '') !== rootPath) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    }
    const beforeOpen = await lstat(resourcePath).catch(() => null);
    if (!beforeOpen?.isFile() || beforeOpen.isSymbolicLink() || beforeOpen.size > MAX_CHARACTER_CARD_BYTES) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    }
    const file = await open(resourcePath, 'r').catch(() => null);
    if (!file) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    try {
        const opened = await file.stat();
        if (!sameFileVersion(beforeOpen, opened) || await realpath(resourcePath) !== resourcePath
            || !sameFileObject(opened, await lstat(resourcePath))) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_CHANGED_DURING_READ');
        }
        const bytes = await file.readFile();
        const afterRead = await file.stat();
        const finalPathStat = await lstat(resourcePath);
        if (bytes.length > MAX_CHARACTER_CARD_BYTES || !sameFileVersion(opened, afterRead)
            || await realpath(resourcePath) !== resourcePath || finalPathStat.isSymbolicLink()
            || !sameFileObject(afterRead, finalPathStat)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_CHANGED_DURING_READ');
        }
        return bytes;
    } catch (error) {
        if (error instanceof SpeakerCandidateScopeError) throw error;
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_NOT_FOUND');
    } finally {
        await file.close();
    }
}

export function decodeCharacterCardPng(bytes) {
    if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > MAX_CHARACTER_CARD_BYTES
        || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
    }
    let offset = PNG_SIGNATURE.length;
    let sawHeader = false;
    let sawEnd = false;
    let metadataTotal = 0;
    const metadata = new Map();
    while (offset < bytes.length) {
        if (offset + 12 > bytes.length) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
        const length = bytes.readUInt32BE(offset);
        if (length > MAX_PNG_CHUNK_BYTES || length > bytes.length - offset - 12) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
        }
        const type = bytes.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        const chunkEnd = dataEnd + 4;
        if (!/^[A-Za-z]{4}$/u.test(type) || crc32(bytes.subarray(offset + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
        }
        if (!sawHeader) {
            if (type !== 'IHDR' || length !== 13) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
            sawHeader = true;
        } else if (type === 'IHDR') {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
        }
        if (type === 'tEXt') {
            const nul = bytes.indexOf(0, dataStart);
            if (nul < dataStart + 1 || nul >= dataEnd || nul - dataStart > 79) {
                throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
            }
            const keyword = bytes.toString('latin1', dataStart, nul);
            if (keyword === 'chara' || keyword === 'ccv3') {
                const encoded = bytes.subarray(nul + 1, dataEnd);
                metadataTotal += encoded.length;
                if (metadataTotal > MAX_CARD_METADATA_BYTES || encoded.some((char) => char > 0x7f)) {
                    throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
                }
                const value = encoded.toString('ascii');
                if (metadata.has(keyword) && metadata.get(keyword) !== value) {
                    throw new SpeakerCandidateScopeError('CARD_METADATA_DUPLICATE_CONFLICT');
                }
                metadata.set(keyword, value);
            }
        }
        offset = chunkEnd;
        if (type === 'IEND') {
            if (length !== 0 || sawEnd || offset !== bytes.length) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
            sawEnd = true;
            break;
        }
    }
    if (!sawHeader || !sawEnd) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID');
    if (metadata.size === 0) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_MISSING');
    const decoded = new Map();
    for (const [keyword, encoded] of metadata) decoded.set(keyword, parseCharacterCardPayload(encoded, keyword));
    const chara = decoded.get('chara');
    const ccv3 = decoded.get('ccv3');
    if (chara && ccv3 && chara.identity !== ccv3.identity) {
        throw new SpeakerCandidateScopeError('CARD_METADATA_IDENTITY_CONFLICT');
    }
    return ccv3 || chara;
}

function parseCharacterCardPayload(encoded, keyword) {
    const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
    if (!encoded || !base64Pattern.test(encoded)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID');
    const decoded = Buffer.from(encoded, 'base64');
    if (decoded.length > MAX_CARD_METADATA_BYTES || decoded.toString('base64') !== encoded) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID');
    }
    let payload;
    try {
        const jsonText = decoded.toString('utf8');
        if (!Buffer.from(jsonText, 'utf8').equals(decoded)) throw new Error('invalid utf8');
        payload = JSON.parse(jsonText);
    } catch {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID');
    }
    if (!isRecord(payload)) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID');
    const version = Number(payload.spec_version);
    const spec = payload.spec;
    const allowedV2 = spec === 'chara_card_v2' && version === 2;
    const allowedV3 = spec === 'chara_card_v3' && version === 3;
    const legacyV2 = keyword === 'chara' && spec === undefined && payload.spec_version === undefined
        && isRecord(payload.data) && isSpeakerName(payload.data.name);
    if (keyword === 'ccv3' ? !allowedV3 : !(allowedV2 || allowedV3 || legacyV2)) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_VERSION_UNSUPPORTED');
    }
    const topName = isSpeakerName(payload.name) ? payload.name : '';
    const dataName = isSpeakerName(payload.data?.name) ? payload.data.name : '';
    if (!topName && !dataName || topName && dataName && topName !== dataName) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHARACTER_CARD_IDENTITY_INVALID');
    }
    return { identity: dataName || topName, identityPointer: dataName ? '/data/name' : '/name' };
}

let crcTable;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let index = 0; index < 256; index += 1) {
            let value = index;
            for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
            crcTable[index] = value >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

async function readChatHeader(chatsRoot, candidatePath) {
    let filePath;
    try {
        filePath = await resolveContainedHistoryChatPath(chatsRoot, candidatePath);
    } catch (error) {
        throw new SpeakerCandidateScopeError(error?.code === 'CHAT_PATH_SYMLINK'
            ? 'SPEAKER_CANDIDATE_CHAT_SYMLINK'
            : 'SPEAKER_CANDIDATE_CHAT_NOT_READABLE');
    }
    const beforeOpen = await lstat(filePath).catch(() => null);
    if (!beforeOpen?.isFile() || beforeOpen.isSymbolicLink()) {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_NOT_READABLE');
    }
    const file = await open(filePath, 'r').catch(() => {
        throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_NOT_READABLE');
    });
    try {
        const opened = await file.stat();
        if (!sameFileVersion(beforeOpen, opened)
            || await realpath(filePath) !== filePath
            || !sameFileObject(opened, await lstat(filePath))) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_CHANGED_DURING_READ');
        }
        const chunks = [];
        let totalBytes = 0;
        let position = 0;
        while (totalBytes <= MAX_HEADER_BYTES) {
            const buffer = Buffer.alloc(16 * 1024);
            const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
            if (!bytesRead) break;
            position += bytesRead;
            const chunk = buffer.subarray(0, bytesRead);
            const newline = chunk.indexOf(0x0a);
            const headerChunk = newline >= 0 ? chunk.subarray(0, newline) : chunk;
            chunks.push(Buffer.from(headerChunk));
            totalBytes += headerChunk.length;
            if (newline >= 0) break;
            if (totalBytes > MAX_HEADER_BYTES) throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_HEADER_TOO_LARGE');
        }
        const afterRead = await file.stat();
        const finalPathStat = await lstat(filePath);
        if (!sameFileVersion(opened, afterRead) || await realpath(filePath) !== filePath
            || finalPathStat.isSymbolicLink() || !sameFileObject(afterRead, finalPathStat)) {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_CHANGED_DURING_READ');
        }
        if (!totalBytes) return null;
        const firstLine = Buffer.concat(chunks).toString('utf8').replace(/\r$/u, '');
        try {
            return JSON.parse(firstLine);
        } catch {
            throw new SpeakerCandidateScopeError('SPEAKER_CANDIDATE_CHAT_HEADER_INVALID');
        }
    } finally {
        await file.close();
    }
}

function sameFileObject(left, right) {
    return Boolean(left && right && left.isFile() && right.isFile()
        && left.dev === right.dev && left.ino === right.ino && left.birthtimeMs === right.birthtimeMs);
}

function sameFileVersion(left, right) {
    return sameFileObject(left, right)
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function parseJson(value, code) {
    try {
        return JSON.parse(value.toString('utf8'));
    } catch {
        throw new SpeakerCandidateScopeError(code);
    }
}

function hashBytes(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function isResourceName(value) {
    return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 160
        && !/[\\/:]/u.test(value) && value !== '.' && value !== '..';
}

function isSafeId(value) {
    return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(value);
}

function escapeJsonPointerPart(value) {
    return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1');
}

function isSpeakerName(value) {
    return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80
        && !/[\r\n\u0000]/u.test(value);
}

function sameStrings(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function exactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
