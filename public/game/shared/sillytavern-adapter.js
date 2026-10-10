import {
    ARC_BINDING_PROTOCOL_VERSION,
    getActiveSillyTavernBindings,
    sanitizeText,
    summarizeSillyTavernBindings,
} from './protocol.js?v=galgame-2026-10-10-speaker-title-v4';

export const SILLYTAVERN_ENDPOINTS = Object.freeze({
    csrf: '/csrf-token',
    ping: '/api/ping',
    charactersAll: '/api/characters/all',
    worldInfoList: '/api/worldinfo/list',
    settingsGet: '/api/settings/get',
});

export const SILLYTAVERN_CHAT_ENDPOINTS = Object.freeze({
    characterChats: '/api/characters/chats',
    chatsGet: '/api/chats/get',
    chatsSave: '/api/chats/save',
});

export const ORIGINAL_RUNTIME_BRIDGE_ENDPOINTS = Object.freeze({
    health: '/health',
    llmHealth: '/v1/llm-health',
    generateReply: '/v1/generate-reply',
});

export class SillyTavernHttpClient {
    constructor({ baseUrl = '', fetchImpl = defaultFetch, credentials = '' } = {}) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
        this.credentials = credentials || (this.baseUrl ? 'include' : 'same-origin');
        this.csrfToken = '';
    }

    async getCsrfToken(signal) {
        if (this.csrfToken) {
            return this.csrfToken;
        }

        const response = await this.fetchImpl(this.url(SILLYTAVERN_ENDPOINTS.csrf), {
            method: 'GET',
            credentials: this.credentials,
            signal,
        });
        if (!response.ok) {
            throw new Error('CSRF_UNAVAILABLE');
        }
        const data = await response.json();
        this.csrfToken = data.token || '';
        return this.csrfToken;
    }

    async requestJson(pathName, { method = 'POST', body, signal, allowErrorObject = false } = {}) {
        const token = await this.getCsrfToken(signal);
        const response = await this.fetchImpl(this.url(pathName), {
            method,
            credentials: this.credentials,
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': token,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers?.get?.('content-type') || '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok || (data?.error && !allowErrorObject)) {
            throw new Error(typeof data?.error === 'string' ? data.error : 'SILLYTAVERN_REQUEST_FAILED');
        }

        return data;
    }

    url(pathName) {
        return `${this.baseUrl}${pathName}`;
    }
}

export class SillyTavernAdapter {
    constructor({ baseUrl = '', fetchImpl = defaultFetch } = {}) {
        this.client = new SillyTavernHttpClient({ baseUrl, fetchImpl });
    }

    async healthCheck(signal) {
        try {
            await this.client.requestJson(SILLYTAVERN_ENDPOINTS.ping, {
                method: 'POST',
                body: {},
                signal,
            });
            return {
                ok: true,
                mode: 'sillytavern-original',
                readonly: true,
            };
        } catch {
            return {
                ok: false,
                mode: 'sillytavern-original',
                readonly: true,
                errorCode: 'ORIGINAL_UNAVAILABLE',
            };
        }
    }

    async listCharacters(signal) {
        return this.client.requestJson(SILLYTAVERN_ENDPOINTS.charactersAll, {
            method: 'POST',
            body: {},
            signal,
        });
    }

    async listWorldBooks(signal) {
        return this.client.requestJson(SILLYTAVERN_ENDPOINTS.worldInfoList, {
            method: 'POST',
            body: {},
            signal,
        });
    }

    async getSettings(signal) {
        return this.client.requestJson(SILLYTAVERN_ENDPOINTS.settingsGet, {
            method: 'POST',
            body: {},
            signal,
        });
    }

    async listCharacterChats({ avatar }, signal) {
        const data = await this.client.requestJson(SILLYTAVERN_CHAT_ENDPOINTS.characterChats, {
            method: 'POST',
            body: {
                avatar_url: avatar,
                metadata: true,
            },
            signal,
            allowErrorObject: true,
        });
        if (data?.error) {
            return [];
        }
        return normalizeCharacterChatList(data);
    }

    async diagnoseOriginalResourceAvailability(manifest, signal) {
        const summary = summarizeSillyTavernBindings(manifest);
        const health = await safeDiagnosticCall(() => this.healthCheck(signal));
        const characters = await safeDiagnosticCall(() => this.listCharacters(signal));
        const worldBooks = await safeDiagnosticCall(() => this.listWorldBooks(signal));
        const settings = await safeDiagnosticCall(() => this.getSettings(signal));
        const chatSeedId = getBoundChatSeedId(manifest);
        const primaryCharacter = summary.characters[0] || {};
        const chatSeeds = chatSeedId && primaryCharacter.avatar
            ? await safeDiagnosticCall(() => this.listCharacterChats({ avatar: primaryCharacter.avatar }, signal))
            : { ok: true, data: [] };
        const characterReferenceCheck = buildReferenceCheck({
            name: 'character-references',
            required: summary.characters,
            available: characters.data,
            toReference: (character) => character.avatar || character.id,
            toCandidates: (character) => [
                character.avatar,
                character.avatar_url,
                character.filename,
                character.file_name,
                character.name,
                character.id,
            ],
        });
        const worldBookReferenceCheck = buildReferenceCheck({
            name: 'worldbook-references',
            required: summary.worldBooks,
            available: worldBooks.data,
            toReference: (worldBook) => worldBook.name,
            toCandidates: (worldBook) => [
                worldBook.name,
                worldBook.file_id,
                worldBook.filename,
                worldBook.file_name,
                worldBook.id,
            ],
        });
        const originalSettings = collectOriginalSettings(settings.data);
        const generationPresetCheck = buildScalarReferenceCheck({
            name: 'generation-preset-reference',
            label: 'generation preset',
            reference: summary.settings.find((item) => item.key === 'presetId')?.value,
            available: originalSettings.generationPresets,
        });
        const instructPresetCheck = buildScalarReferenceCheck({
            name: 'instruct-preset-reference',
            label: 'instruct preset',
            reference: summary.settings.find((item) => item.key === 'instructPresetId')?.value,
            available: originalSettings.instructPresets,
        });
        const systemPromptCheck = buildScalarReferenceCheck({
            name: 'system-prompt-reference',
            label: 'system prompt',
            reference: summary.settings.find((item) => item.key === 'systemPromptId')?.value,
            available: originalSettings.systemPrompts,
        });
        const contextPresetCheck = buildScalarReferenceCheck({
            name: 'context-preset-reference',
            label: 'context preset',
            reference: summary.settings.find((item) => item.key === 'contextPresetId')?.value,
            available: originalSettings.contextPresets,
        });
        const chatSeedCheck = buildScalarReferenceCheck({
            name: 'chat-seed-reference',
            label: 'chat seed',
            reference: chatSeedId,
            available: arrayFromResourceList(chatSeeds.data).flatMap((chat) => [chat.fileId, chat.fileName]),
        });

        const checks = [
            {
                name: 'sillytavern-health',
                ok: Boolean(health.data?.ok),
                details: health.data || { error: health.error },
            },
            {
                name: 'characters-list',
                ok: characters.ok,
                details: {
                    count: countResourceItems(characters.data),
                    error: characters.error,
                },
            },
            characterReferenceCheck,
            {
                name: 'worldbooks-list',
                ok: worldBooks.ok,
                details: {
                    count: countResourceItems(worldBooks.data),
                    error: worldBooks.error,
                },
            },
            worldBookReferenceCheck,
            {
                name: 'settings-get',
                ok: settings.ok,
                details: {
                    generationPresetCount: originalSettings.generationPresets.length,
                    instructPresetCount: originalSettings.instructPresets.length,
                    systemPromptCount: originalSettings.systemPrompts.length,
                    contextPresetCount: originalSettings.contextPresets.length,
                    error: settings.error,
                },
            },
            generationPresetCheck,
            instructPresetCheck,
            systemPromptCheck,
            contextPresetCheck,
            {
                name: 'chat-seed-list',
                ok: chatSeeds.ok,
                details: {
                    count: countResourceItems(chatSeeds.data),
                    error: chatSeeds.error,
                },
            },
            chatSeedCheck,
        ];

        return {
            ok: checks.every((check) => check.ok),
            mode: 'sillytavern-original-resource-diagnostic',
            referenceOnly: true,
            readonly: true,
            checks,
        };
    }
}

const SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';
const SPEAKER_CANDIDATE_MAX_WORLD_INFO_BYTES = 8 * 1024 * 1024;
const SPEAKER_CANDIDATE_MAX_WORLD_INFO_ENTRIES = 20_000;
const SPEAKER_CANDIDATE_MAX_NAMES = 2_000;
const SPEAKER_CANDIDATE_REQUEST_TIMEOUT_MS = 1_200;

/**
 * Narrow, read-only adapter for display-title candidate names. This is
 * intentionally separate from SillyTavernOriginalChatBridge: it never
 * returns or stores worldbook payloads and never participates in generation.
 */
export class SillyTavernSpeakerCandidateAdapter {
    constructor({
        baseUrl = '',
        fetchImpl = defaultFetch,
        requestTimeoutMs = SPEAKER_CANDIDATE_REQUEST_TIMEOUT_MS,
        maxResponseBytes = SPEAKER_CANDIDATE_MAX_WORLD_INFO_BYTES,
    } = {}) {
        this.client = new SillyTavernHttpClient({ baseUrl, fetchImpl });
        this.requestTimeoutMs = clampInteger(requestTimeoutMs, 100, 10_000, SPEAKER_CANDIDATE_REQUEST_TIMEOUT_MS);
        this.maxResponseBytes = clampInteger(maxResponseBytes, 1, SPEAKER_CANDIDATE_MAX_WORLD_INFO_BYTES,
            SPEAKER_CANDIDATE_MAX_WORLD_INFO_BYTES);
        this.inflightBySnapshot = new WeakMap();
    }

    async getBoundWorldbookCandidates({ release, manifest, snapshot } = {}, signal = null) {
        const binding = resolveBoundSpeakerCandidateWorldbook({ release, manifest, snapshot });
        if (!binding) return emptySpeakerCandidateResult();
        let inflight = this.inflightBySnapshot.get(snapshot);
        if (!inflight) {
            inflight = new Map();
            this.inflightBySnapshot.set(snapshot, inflight);
        }
        const key = binding.scopeKey;
        const pending = inflight.get(key);
        if (pending) return pending;
        const request = this.readWorldbookCandidateNames(binding.resourceName, signal);
        inflight.set(key, request);
        try {
            return await request;
        } finally {
            if (inflight.get(key) === request) inflight.delete(key);
            if (inflight.size === 0) this.inflightBySnapshot.delete(snapshot);
        }
    }

    async readWorldbookCandidateNames(resourceName, parentSignal = null) {
        const controller = new AbortController();
        const abortFromParent = () => controller.abort();
        parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
        const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        try {
            const csrfToken = await this.client.getCsrfToken(controller.signal);
            const response = await this.client.fetchImpl(this.client.url(SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT), {
                method: 'POST',
                credentials: this.client.credentials,
                cache: 'no-cache',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                body: JSON.stringify({ name: resourceName }),
                signal: controller.signal,
            });
            if (!response.ok) return emptySpeakerCandidateResult();
            const contentLength = Number(response.headers?.get?.('content-length'));
            if (Number.isFinite(contentLength) && contentLength > this.maxResponseBytes) {
                try { await response.body?.cancel?.(); } catch { /* no raw response data is surfaced */ }
                return emptySpeakerCandidateResult();
            }
            const rawText = await readResponseTextWithinLimit(response, this.maxResponseBytes);
            if (rawText === null) return emptySpeakerCandidateResult();
            let worldbook;
            try {
                worldbook = JSON.parse(rawText);
            } catch {
                return emptySpeakerCandidateResult();
            }
            const candidateSpeakerNames = extractExplicitSpeakerCandidateNames(worldbook);
            return {
                candidateSpeakerNames,
                resourceFingerprint: `sha256:${await sha256Hex(rawText)}`,
            };
        } catch {
            return emptySpeakerCandidateResult();
        } finally {
            clearTimeout(timer);
            parentSignal?.removeEventListener?.('abort', abortFromParent);
        }
    }
}

function resolveBoundSpeakerCandidateWorldbook({ release, manifest, snapshot } = {}) {
    const releaseId = typeof release?.releaseId === 'string' ? release.releaseId.trim() : '';
    const scenarioId = typeof manifest?.id === 'string' ? manifest.id : '';
    const scenarioVersion = typeof manifest?.version === 'string' ? manifest.version : '';
    const chatFileName = typeof snapshot?.fileName === 'string' ? snapshot.fileName : '';
    const chatWorldInfo = snapshot?.rawChat?.[0]?.chat_metadata?.world_info;
    if (!releaseId || !scenarioId || !scenarioVersion || !chatFileName || snapshot?.ok !== true
        || release.scenarioId !== scenarioId || release.scenarioVersion !== scenarioVersion
        || (release.manifestId && release.manifestId !== scenarioId)
        || (release.manifestVersion && release.manifestVersion !== scenarioVersion)
        || typeof chatWorldInfo !== 'string' || !chatWorldInfo.trim()) return null;
    return {
        resourceName: chatWorldInfo,
        scopeKey: JSON.stringify([releaseId, scenarioId, scenarioVersion, chatFileName, chatWorldInfo]),
    };
}

function emptySpeakerCandidateResult() {
    return { candidateSpeakerNames: [], resourceFingerprint: '' };
}

function clampInteger(value, minimum, maximum, fallback) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) return fallback;
    return Math.max(minimum, Math.min(maximum, parsed));
}

async function readResponseTextWithinLimit(response, maximumBytes) {
    if (!response.body?.getReader) return null;
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value?.byteLength || 0;
            if (length > maximumBytes) {
                await reader.cancel().catch(() => {});
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock?.();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

export function extractExplicitSpeakerCandidateNames(worldbook) {
    if (!worldbook || typeof worldbook !== 'object' || Array.isArray(worldbook)
        || (!worldbook.entries || typeof worldbook.entries !== 'object')) return [];
    const entries = Array.isArray(worldbook.entries) ? worldbook.entries : Object.values(worldbook.entries);
    if (entries.length > SPEAKER_CANDIDATE_MAX_WORLD_INFO_ENTRIES) return [];
    const names = new Set();
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.comment !== 'string') continue;
        const name = extractExplicitCharacterHeading(entry.comment);
        if (name) names.add(name);
        if (names.size > SPEAKER_CANDIDATE_MAX_NAMES) return [];
    }
    return [...names];
}

function extractExplicitCharacterHeading(comment) {
    const companion = comment.match(/^Companion\s*-\s*(.{1,80}?)\s*$/iu);
    if (companion && isSpeakerCandidateName(companion[1])) return companion[1];
    const characterSection = comment.match(/^\[([^\]]{1,160})\]\s*([^—–:]{1,80}?)\s*[—–]\s*.+$/u);
    if (!characterSection) return '';
    const idName = characterSection[1].split('_').at(-1)?.trim() || '';
    const displayName = characterSection[2].trim();
    if (!isSpeakerCandidateName(displayName) || idName.toLocaleLowerCase('en-US') !== displayName.toLocaleLowerCase('en-US')) return '';
    return displayName;
}

function isSpeakerCandidateName(value) {
    return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80
        && !/[\r\n\u0000]/u.test(value);
}

export class SillyTavernOriginalChatBridge {
    constructor({ baseUrl = '', fetchImpl = defaultFetch, now = () => new Date() } = {}) {
        this.client = new SillyTavernHttpClient({ baseUrl, fetchImpl });
        this.now = now;
    }

    async healthCheck(signal) {
        try {
            await this.client.requestJson(SILLYTAVERN_ENDPOINTS.ping, {
                method: 'POST',
                body: {},
                signal,
            });
            return {
                ok: true,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
            };
        } catch {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                errorCode: 'ORIGINAL_UNAVAILABLE',
            };
        }
    }

    async listCharacterChats({ avatar }, signal) {
        const data = await this.client.requestJson(SILLYTAVERN_CHAT_ENDPOINTS.characterChats, {
            method: 'POST',
            body: {
                avatar_url: avatar,
                metadata: true,
            },
            signal,
            allowErrorObject: true,
        });
        if (data?.error) {
            return [];
        }
        return normalizeCharacterChatList(data);
    }

    async getCharacterChat({ avatar, fileName }, signal) {
        const chat = await this.client.requestJson(SILLYTAVERN_CHAT_ENDPOINTS.chatsGet, {
            method: 'POST',
            body: {
                avatar_url: avatar,
                file_name: normalizeChatFileId(fileName),
            },
            signal,
        });
        return Array.isArray(chat) ? chat : [];
    }

    async saveCharacterChat({ avatar, characterName, fileName, chat }, signal) {
        return this.client.requestJson(SILLYTAVERN_CHAT_ENDPOINTS.chatsSave, {
            method: 'POST',
            body: {
                ch_name: sanitizeText(characterName || 'Character', 160),
                avatar_url: avatar,
                file_name: normalizeChatFileId(fileName),
                chat,
                force: false,
            },
            signal,
        });
    }

    async loadOpeningChat(manifest, signal) {
        return this.loadBoundChat(manifest, { preferSeed: true, signal });
    }

    async loadLatestBoundChat(manifest, signal) {
        return this.loadBoundChat(manifest, { preferSeed: false, signal });
    }

    async hasLatestBoundChat(manifest, signal) {
        const character = getPrimaryBoundCharacter(manifest);
        if (!character.avatar) {
            return false;
        }
        const chats = await this.listCharacterChats(character, signal);
        const seedId = getBoundChatSeedId(manifest);
        const seed = seedId ? findChatById(chats, seedId) : null;
        const selected = pickLatestArcChat(chats, {
            arcId: getManifestRuntimeArcId(manifest),
            seedId,
        }) || seed || (!seedId ? pickLatestChat(chats) : null);
        return Boolean(selected);
    }

    async loadSpecificBoundChat(manifest, fileName, signal) {
        const character = getPrimaryBoundCharacter(manifest);
        if (!character.avatar || !fileName) {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                writable: false,
                empty: true,
                character,
                errorCode: 'ORIGINAL_CHAT_UNAVAILABLE',
                messages: [],
            };
        }

        const rawChat = await this.getCharacterChat({
            avatar: character.avatar,
            fileName,
        }, signal);
        const messages = normalizeOriginalChatMessages(rawChat);
        return {
            ok: messages.length > 0,
            mode: 'sillytavern-original-chat-bridge',
            generationBridge: false,
            writable: messages.length > 0,
            empty: messages.length === 0,
            character,
            fileName: normalizeChatFileId(fileName),
            isSeed: normalizeChatFileId(fileName) === getBoundChatSeedId(manifest),
            rawChat: normalizeRawChat(rawChat),
            messages,
            errorCode: messages.length > 0 ? undefined : 'ORIGINAL_CHAT_EMPTY',
        };
    }

    async loadBoundChat(manifest, { preferSeed = false, signal } = {}) {
        const character = getPrimaryBoundCharacter(manifest);
        if (!character.avatar) {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                writable: false,
                errorCode: 'ORIGINAL_CHARACTER_UNBOUND',
                messages: [],
            };
        }

        const chats = await this.listCharacterChats(character, signal);
        const seedId = getBoundChatSeedId(manifest);
        const seed = seedId ? findChatById(chats, seedId) : null;
        const selected = preferSeed && seedId
            ? seed
            : (pickLatestArcChat(chats, {
                arcId: getManifestRuntimeArcId(manifest),
                seedId,
            }) || seed || (!seedId ? pickLatestChat(chats) : null));
        if (preferSeed && seedId && !selected) {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                writable: false,
                empty: true,
                character,
                missingChatSeedId: seedId,
                errorCode: 'ORIGINAL_CHAT_SEED_MISSING',
                messages: [],
            };
        }
        if (!selected) {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                writable: false,
                empty: true,
                character,
                errorCode: 'ORIGINAL_CHAT_EMPTY',
                messages: [],
            };
        }

        const rawChat = await this.getCharacterChat({
            avatar: character.avatar,
            fileName: selected.fileId,
        }, signal);
        const messages = normalizeOriginalChatMessages(rawChat);
        if (!messages.length) {
            return {
                ok: false,
                mode: 'sillytavern-original-chat-bridge',
                generationBridge: false,
                writable: false,
                empty: true,
                character,
                fileName: selected.fileId,
                isSeed: Boolean(seedId && normalizeChatFileId(seedId) === selected.fileId),
                errorCode: 'ORIGINAL_CHAT_SEED_EMPTY',
                messages: [],
            };
        }

        return {
            ok: true,
            mode: 'sillytavern-original-chat-bridge',
            generationBridge: false,
            writable: true,
            empty: false,
            character,
            fileName: selected.fileId,
            isSeed: Boolean(seedId && normalizeChatFileId(seedId) === selected.fileId),
            rawChat: normalizeRawChat(rawChat),
            messages,
        };
    }

    async appendUserMessageToBoundChat(manifest, text, signal) {
        const snapshot = await this.loadLatestBoundChat(manifest, signal);
        return this.appendUserMessageToChat(manifest, snapshot, text, signal);
    }

    async appendUserMessageToChat(manifest, snapshot, text, signal) {
        const messageText = sanitizeText(text, 4000);
        if (!messageText) {
            throw new Error('EMPTY_PLAYER_MESSAGE');
        }
        if (!snapshot.ok || !snapshot.writable) {
            throw new Error(snapshot.errorCode || 'ORIGINAL_CHAT_UNAVAILABLE');
        }
        const fileName = snapshot.isSeed
            ? createChatFileId(manifest, snapshot.character, this.now())
            : snapshot.fileName;

        const nextChat = [
            ...normalizeRawChat(snapshot.rawChat),
            {
                name: getOriginalChatUserName(snapshot.rawChat),
                is_user: true,
                is_system: false,
                send_date: this.now().toISOString(),
                mes: messageText,
                extra: {},
            },
        ];

        await this.saveCharacterChat({
            avatar: snapshot.character.avatar,
            characterName: snapshot.character.id,
            fileName,
            chat: nextChat,
        }, signal);

        return {
            ...snapshot,
            empty: false,
            fileName,
            isSeed: false,
            rawChat: nextChat,
            messages: normalizeOriginalChatMessages(nextChat),
        };
    }
}

export class OriginalRuntimeBridgeClient {
    constructor({
        baseUrl = '',
        sillyTavernBaseUrl = '',
        fetchImpl = defaultFetch,
        timeoutMs = 180000,
    } = {}) {
        this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
        this.sillyTavernBaseUrl = String(sillyTavernBaseUrl || '').trim().replace(/\/+$/, '');
        this.fetchImpl = fetchImpl;
        this.timeoutMs = timeoutMs;
    }

    isConfigured() {
        return Boolean(this.baseUrl);
    }

    setBaseUrl(baseUrl = '') {
        this.baseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    }

    async discoverBaseUrl(candidateUrls = [], {
        timeoutMs = 900,
        signal = null,
    } = {}) {
        const candidates = [...new Set((Array.isArray(candidateUrls) ? candidateUrls : [])
            .map((url) => String(url || '').trim().replace(/\/+$/, ''))
            .filter(Boolean))];
        const checks = await Promise.all(candidates.map((url, index) => (
            this.checkCandidateBaseUrl(url, { index, timeoutMs, signal })
        )));
        const selected = checks
            .filter(Boolean)
            .sort((left, right) => right.score - left.score || left.index - right.index)[0];
        if (!selected) {
            return '';
        }
        this.setBaseUrl(selected.url);
        return selected.url;
    }

    async checkCandidateBaseUrl(url, { index = 0, timeoutMs = 900, signal = null } = {}) {
        const controller = new AbortController();
        const timeout = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 900;
        const timer = setTimeout(() => controller.abort(), timeout);
        const abortOnParentSignal = () => controller.abort();
        signal?.addEventListener?.('abort', abortOnParentSignal, { once: true });
        try {
            const response = await this.fetchImpl(`${url}${ORIGINAL_RUNTIME_BRIDGE_ENDPOINTS.health}`, {
                method: 'GET',
                cache: 'no-cache',
                signal: controller.signal,
            });
            if (!response.ok) {
                return null;
            }
            const health = await response.json().catch(() => null);
            if (!health?.ok || health.ready === false || health.stopping || health.pending || health.stale || health.authRequired) {
                return null;
            }
            return {
                url,
                index,
                score: (health.browser ? 2 : 0) + (health.pending ? -1 : 0),
            };
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', abortOnParentSignal);
        }
    }

    async healthCheck(signal) {
        if (!this.isConfigured()) {
            return {
                ok: false,
                mode: 'sillytavern-original-runtime-bridge',
                errorCode: 'ORIGINAL_RUNTIME_BRIDGE_UNCONFIGURED',
            };
        }

        const response = await this.fetchImpl(this.url(ORIGINAL_RUNTIME_BRIDGE_ENDPOINTS.health), {
            method: 'GET',
            cache: 'no-cache',
            signal,
        });
        if (!response.ok) {
            return {
                ok: false,
                mode: 'sillytavern-original-runtime-bridge',
                errorCode: 'ORIGINAL_RUNTIME_BRIDGE_UNAVAILABLE',
            };
        }
        return response.json();
    }

    async llmHealthCheck(signal) {
        if (!this.isConfigured()) {
            return { ok: false, errorCode: 'ORIGINAL_RUNTIME_BRIDGE_UNCONFIGURED' };
        }
        const response = await this.fetchImpl(this.url(ORIGINAL_RUNTIME_BRIDGE_ENDPOINTS.llmHealth), {
            method: 'POST',
            cache: 'no-cache',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ protocolVersion: 'galgame.llm-health.v1' }),
            signal,
        });
        const result = await response.json().catch(() => null);
        if (!result || result.protocolVersion !== 'galgame.llm-health.v1') {
            return { ok: false, errorCode: 'LLM_HEALTH_RESPONSE_INVALID' };
        }
        return { ...result, ok: response.ok && result.ok === true };
    }

    async generateReply({ manifest, release = null, snapshot, bridgeProof = null, signal, timeoutMs = this.timeoutMs } = {}) {
        if (!this.isConfigured()) {
            throw new Error('ORIGINAL_RUNTIME_BRIDGE_UNCONFIGURED');
        }
        if (!snapshot?.ok || !snapshot.character?.avatar || !snapshot.fileName) {
            throw new Error('ORIGINAL_CHAT_UNAVAILABLE');
        }

        const proof = resolveOriginalRuntimeBridgeProof({ manifest, snapshot, bridgeProof });
        const releaseIndex = buildRuntimeBridgeReleaseIndex({ manifest, release, proof });
        const response = await this.fetchImpl(this.url(ORIGINAL_RUNTIME_BRIDGE_ENDPOINTS.generateReply), {
            method: 'POST',
            cache: 'no-cache',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                protocolVersion: 'galgame.original-runtime-bridge-request.v1',
                requestId: createRuntimeBridgeRequestId(),
                sillyTavernBaseUrl: this.sillyTavernBaseUrl,
                releaseId: releaseIndex.releaseId,
                scenarioId: releaseIndex.scenarioId,
                scenarioVersion: releaseIndex.scenarioVersion,
                arcId: releaseIndex.arcId,
                character: {
                    id: getPrimaryBoundCharacter(manifest).id || snapshot.character.id,
                    avatar: snapshot.character.avatar,
                },
                chatId: snapshot.fileName,
                bridgeProof: proof,
                timeoutMs,
            }),
            signal,
        });

        const data = await readJsonResponse(response);
        if (!response.ok || !data?.ok) {
            throw new Error(data?.errorCode || 'ORIGINAL_RUNTIME_BRIDGE_FAILED');
        }

        const rawChat = normalizeRawChat(data.rawChat);
        const runtimeGenerationSettings = data.diagnostics?.runtimeGenerationSettings || {};
        const runtimeProvider = sanitizeText(runtimeGenerationSettings.provider || '', 40).toLowerCase();
        const runtimeModel = sanitizeText(runtimeGenerationSettings.model || '', 120);
        return {
            ok: true,
            mode: 'sillytavern-original-runtime-bridge',
            generationBridge: true,
            writable: true,
            empty: rawChat.length <= 1,
            character: snapshot.character,
            fileName: normalizeChatFileId(data.chatId || snapshot.fileName),
            isSeed: false,
            rawChat,
            messages: normalizeOriginalChatMessages(rawChat),
            generatedText: sanitizeText(data.generatedText || '', MAX_VISIBLE_CHAT_TEXT_LENGTH),
            diagnostics: {
                unchanged: Boolean(data.unchanged),
                elapsedMs: Number(data.elapsedMs || 0),
                ...(runtimeProvider ? { runtimeProvider } : {}),
                ...(runtimeModel ? { runtimeModel } : {}),
            },
        };
    }

    url(pathName) {
        return `${this.baseUrl}${pathName}`;
    }
}

async function safeDiagnosticCall(executor) {
    try {
        return {
            ok: true,
            data: await executor(),
        };
    } catch (error) {
        return {
            ok: false,
            error: error.message || String(error),
        };
    }
}

function buildReferenceCheck({ name, required, available, toReference, toCandidates }) {
    const candidateSet = new Set(arrayFromResourceList(available)
        .flatMap((item) => toCandidates(item).flatMap(expandReferenceAliases))
        .filter(Boolean));
    const missing = required
        .map((item) => toReference(item))
        .filter(Boolean)
        .filter((reference) => !expandReferenceAliases(reference).some((alias) => candidateSet.has(alias)));

    return {
        name,
        ok: missing.length === 0,
        details: {
            required: required.length,
            available: countResourceItems(available),
            missing,
        },
    };
}

function buildScalarReferenceCheck({ name, label, reference, available }) {
    if (!reference) {
        return {
            name,
            ok: true,
            details: {
                required: 0,
                available: available.length,
                missing: [],
            },
        };
    }

    const candidateSet = new Set(available.flatMap(expandReferenceAliases));
    const missing = expandReferenceAliases(reference).some((alias) => candidateSet.has(alias))
        ? []
        : [reference];
    return {
        name,
        ok: missing.length === 0,
        details: {
            label,
            required: 1,
            available: available.length,
            missing,
        },
    };
}

function collectOriginalSettings(settings = {}) {
    const generationPresets = [
        ...stringArray(settings.openai_setting_names),
        ...stringArray(settings.textgenerationwebui_preset_names),
        ...stringArray(settings.koboldai_setting_names),
        ...stringArray(settings.novelai_setting_names),
    ];
    return {
        generationPresets,
        instructPresets: namedArray(settings.instruct),
        systemPrompts: namedArray(settings.sysprompt),
        contextPresets: namedArray(settings.context),
    };
}

function countResourceItems(value) {
    return arrayFromResourceList(value).length;
}

function arrayFromResourceList(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value && typeof value === 'object') {
        return Object.values(value);
    }
    return [];
}

function normalizeCharacterChatList(value) {
    return arrayFromResourceList(value)
        .filter((chat) => chat && (chat.file_id || chat.file_name))
        .map((chat) => ({
            fileId: normalizeChatFileId(chat.file_id || chat.file_name),
            fileName: normalizeChatFileId(chat.file_name || chat.file_id),
            messageCount: Number(chat.message_count ?? chat.chat_items ?? 0),
            lastMessageAt: sanitizeText(chat.last_mes || '', 120),
            preview: sanitizeText(chat.preview_message || chat.mes || '', 800),
        }))
        .filter((chat) => chat.fileId);
}

function expandReferenceAliases(value) {
    const normalized = normalizeResourceReference(value);
    if (!normalized) {
        return [];
    }

    const bare = normalized.replace(/\.(json|png|webp|jpg|jpeg|world)$/i, '');
    return [...new Set([
        normalized,
        bare,
        `${bare}.json`,
        `${bare}.png`,
        `${bare}.world`,
    ])];
}

function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function namedArray(value) {
    return arrayFromResourceList(value)
        .map((item) => typeof item === 'string' ? item : item?.name)
        .filter(Boolean)
        .map((item) => sanitizeText(item, 160));
}

function normalizeResourceReference(value) {
    return String(value || '').trim().replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function getPrimaryBoundCharacter(manifest) {
    const bindings = getActiveSillyTavernBindings(manifest, manifest?.arcId || manifest?.activeArcId || manifest?.defaultArcId);
    const character = bindings?.characters?.[0] || {};
    return {
        id: sanitizeText(character.id || '', 160),
        avatar: sanitizeText(character.avatar || '', 240),
        role: sanitizeText(character.role || 'main', 40),
    };
}

function getBoundChatSeedId(manifest) {
    const bindings = getActiveSillyTavernBindings(manifest, manifest?.arcId || manifest?.activeArcId || manifest?.defaultArcId);
    return normalizeChatFileId(bindings?.chatSeedId || '');
}

function resolveOriginalRuntimeBridgeProof({ manifest, snapshot, bridgeProof }) {
    return bridgeProof
        || snapshot?.bridgeProof
        || manifest?.originalRuntimeBridge?.bindingProof
        || manifest?.runtimeBridge?.bindingProof
        || manifest?.sillyTavernBindings?.runtimeBridgeProof
        || null;
}

function buildRuntimeBridgeReleaseIndex({ manifest, release, proof }) {
    const proofRelease = proof?.binding?.release || {};
    return {
        releaseId: sanitizeText(release?.releaseId || proofRelease.releaseId || '', 240),
        scenarioId: sanitizeText(release?.scenarioId || proofRelease.scenarioId || manifest?.id || '', 160),
        scenarioVersion: sanitizeText(release?.scenarioVersion || proofRelease.scenarioVersion || manifest?.version || '', 80),
        arcId: sanitizeText(release?.activeArcId || release?.arcId || proofRelease.arcId || manifest?.arcId || manifest?.defaultArcId || 'default', 120),
    };
}

function createRuntimeBridgeRequestId() {
    if (globalThis.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
    }
    return `bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pickLatestChat(chats) {
    return [...chats].sort((first, second) => (
        parseChatTime(second.lastMessageAt) - parseChatTime(first.lastMessageAt)
    ))[0] || null;
}

function pickLatestArcChat(chats, { arcId = '', seedId = '' } = {}) {
    const normalizedArc = normalizeChatToken(arcId);
    if (!normalizedArc) {
        return null;
    }
    const normalizedSeedId = normalizeChatFileId(seedId);
    return pickLatestChat((Array.isArray(chats) ? chats : []).filter((chat) => {
        const fileId = normalizeChatFileId(chat.fileId || chat.fileName);
        return fileId
            && fileId !== normalizedSeedId
            && normalizeChatToken(fileId).includes(normalizedArc);
    }));
}

function findChatById(chats, fileName) {
    const expected = normalizeChatFileId(fileName);
    return chats.find((chat) => (
        chat.fileId === expected
        || chat.fileName === expected
        || expandReferenceAliases(chat.fileId).includes(expected)
        || expandReferenceAliases(chat.fileName).includes(expected)
    )) || null;
}

function parseChatTime(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : 0;
}

function createEmptyChatHeader() {
    return [{
        chat_metadata: {},
        user_name: 'Player',
        character_name: 'Character',
    }];
}

function getOriginalChatUserName(chat) {
    const header = normalizeRawChat(chat)[0] || {};
    return sanitizeText(header.user_name || 'Player', 160);
}

function normalizeRawChat(chat) {
    if (!Array.isArray(chat) || !chat.length) {
        return createEmptyChatHeader();
    }
    const header = chat[0]?.chat_metadata ? chat[0] : createEmptyChatHeader()[0];
    return [
        header,
        ...chat.slice(1).filter((message) => message && typeof message === 'object'),
    ];
}

export const ORIGINAL_VISIBLE_CHAT_EXTRACTOR_VERSION = 'galgame.original-visible-chat-extractor.v1';
export const VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION = 'galgame.visual-projection-entity-hints.v2';
export const VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION = 'galgame.visual-projection-shared.v2';
export const CORE_VISUAL_DISPLAY_ENTITY_HINT_EXTRACTOR_VERSION = 'galgame.core-visual-display-entity-hints.v2';

// Preserve long original messages so hidden planning, status blocks, and
// trailing choice lists are all available to the display and action parsers.
export const MAX_VISIBLE_CHAT_TEXT_LENGTH = 16000;

const VISUAL_PROJECTION_LABEL_TYPES = new Map([
    ['场景', 'scene'],
    ['背景', 'scene'],
    ['背景设定', 'scene'],
    ['地点', 'scene'],
    ['当前地点', 'scene'],
    ['环境', 'scene'],
    ['战场', 'scene'],
    ['场景描述', 'scene'],
    ['scene', 'scene'],
    ['background', 'scene'],
    ['setting', 'scene'],
    ['location', 'scene'],
    ['current location', 'scene'],
    ['environment', 'scene'],
    ['battlefield', 'scene'],
    ['scene description', 'scene'],
    ['装备', 'equipment'],
    ['武器', 'equipment'],
    ['防具', 'equipment'],
    ['equipment', 'equipment'],
    ['weapon', 'equipment'],
    ['weapons/shield', 'equipment'],
    ['armor', 'equipment'],
    ['装备栏', 'equipment'],
    ['道具', 'item'],
    ['inventory', 'item'],
    ['inventory/items', 'item'],
    ['物品栏', 'item'],
    ['技能', 'skill'],
    ['abilities', 'skill'],
    ['ability', 'skill'],
    ['spells', 'skill'],
    ['物品', 'item'],
    ['材料', 'item'],
    ['线索', 'item'],
    ['item', 'item'],
    ['material', 'item'],
    ['clue', 'item'],
    ['技能', 'skill'],
    ['法术', 'skill'],
    ['skill', 'skill'],
    ['spell', 'skill'],
]);

const VISUAL_PROJECTION_LABEL_ATTRIBUTE_CODES = Object.freeze({
    scene: 'scene-location-kind',
    equipment: 'equipment-visible-label',
    item: 'item-visible-label',
    skill: 'skill-visible-label',
});

const CORE_VISUAL_DISPLAY_LABEL_TYPES = new Map([
    ...VISUAL_PROJECTION_LABEL_TYPES,
    ['角色', 'character'],
    ['人物', 'character'],
    ['立绘', 'character'],
    ['性别', 'character'],
    ['性别表现', 'character'],
    ['gender', 'character'],
    ['gender presentation', 'character'],
    ['种族', 'character'],
    ['物种', 'character'],
    ['race', 'character'],
    ['species', 'character'],
    ['特征', 'character'],
    ['外观', 'character'],
    ['外貌', 'character'],
    ['appearance', 'character'],
    ['features', 'character'],
    ['traits', 'character'],
    ['服装', 'character'],
    ['衣着', 'character'],
    ['穿着', 'character'],
    ['clothing', 'character'],
    ['outfit', 'character'],
    ['character', 'character'],
    ['sprite', 'character'],
]);

const CORE_VISUAL_DISPLAY_LABEL_ATTRIBUTE_CODES = Object.freeze({
    ...VISUAL_PROJECTION_LABEL_ATTRIBUTE_CODES,
    character: 'character-explicit-appearance',
});

export function normalizeOriginalVisibleChatMessages(chat, { maxTextLength = MAX_VISIBLE_CHAT_TEXT_LENGTH } = {}) {
    const messages = [];
    for (const [rawOffset, message] of normalizeRawChat(chat).slice(1).entries()) {
        if (!message || typeof message !== 'object' || message.is_system) {
            continue;
        }
        const text = sanitizeText(message.extra?.display_text ?? message.mes, maxTextLength);
        if (!text.trim()) {
            continue;
        }
        const role = message.is_user ? 'player' : 'character';
        const index = messages.length;
        messages.push({
            id: `original-chat-message-${index}`,
            index,
            rawIndex: rawOffset + 1,
            speaker: sanitizeText(message.name || (message.is_user ? 'Player' : 'Character'), 160),
            role,
            isUser: Boolean(message.is_user),
            characterIdentity: message.characterIdentity || null,
            text,
            sentAt: sanitizeText(message.send_date || '', 120),
        });
    }
    return messages;
}

export function createVisualProjectionEntityHints(message) {
    return createVisibleMessageEntityHints(message, {
        labelTypes: VISUAL_PROJECTION_LABEL_TYPES,
        labelAttributeCodes: VISUAL_PROJECTION_LABEL_ATTRIBUTE_CODES,
    });
}

export function createCoreVisualDisplayEntityHints(message) {
    return createVisibleMessageEntityHints(message, {
        labelTypes: CORE_VISUAL_DISPLAY_LABEL_TYPES,
        labelAttributeCodes: CORE_VISUAL_DISPLAY_LABEL_ATTRIBUTE_CODES,
        mergeCurrentSpeakerCharacterAppearance: true,
    });
}

export async function createCoreVisualDisplayEntityKey(type, value) {
    const digest = await sha256Hex(String(value || type));
    return `entity_${type}_${digest.slice(0, 24)}`;
}

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function createVisibleMessageEntityHints(message, {
    labelTypes,
    labelAttributeCodes,
    mergeCurrentSpeakerCharacterAppearance = false,
}) {
    const entities = [];
    // Entity extraction must use the same visible projection as the player
    // renderer. Hidden reasoning/status scaffolding is not story evidence and
    // must never create a scene or character hint.
    const text = formatVisualNovelDisplayText(message?.text || '').slice(0, MAX_VISIBLE_CHAT_TEXT_LENGTH);
    const speaker = sanitizeText(message?.speaker || '', 160);
    const characterIdentity = message?.characterIdentity && typeof message.characterIdentity === 'object'
        ? message.characterIdentity
        : null;
    const stableCharacterSeed = sanitizeText(
        characterIdentity?.characterId || characterIdentity?.id || characterIdentity?.avatar || characterIdentity?.name || '',
        160,
    );
    const seenSeeds = new Set();
    const pushEntity = (entity) => {
        const dedupeKey = `${entity.entityType}:${entity.entityKeySeed}`;
        if (seenSeeds.has(dedupeKey)) {
            return;
        }
        seenSeeds.add(dedupeKey);
        entities.push(entity);
    };
    const speakerCharacterEntity = message?.role === 'character'
        && speaker
        && !isNonCharacterVisualLabel(speaker)
        && !(mergeCurrentSpeakerCharacterAppearance && isNarratorSpeaker(speaker))
        ? {
            entityKeySeed: stableCharacterSeed || speaker,
            entityType: 'character',
            displayLabel: speaker.slice(0, 80),
            visibleAttributes: [
                {
                    code: 'character-explicit-name',
                    value: speaker.slice(0, 120),
                    confidenceBand: 'explicit',
                },
                ...inferEnemyCharacterAttributes(speaker),
            ],
            confidenceBand: 'explicit',
        }
        : null;
    const labelEntities = extractExplicitVisualProjectionLabelEntities(text, message?.index, {
        labelTypes,
        labelAttributeCodes,
        labelAttributeCodeResolver: mergeCurrentSpeakerCharacterAppearance
            ? resolveCoreCharacterLabelAttributeCode
            : null,
    });
    if (mergeCurrentSpeakerCharacterAppearance) {
        const characterLabels = uniqueEntitiesBySeed(labelEntities.filter((entity) => entity.entityType === 'character'));
        const characterLabelAttributes = characterLabels.flatMap((entity) => entity.visibleAttributes || []);
        const attributeCounts = new Map();
        for (const attribute of characterLabelAttributes) {
            attributeCounts.set(attribute.code, (attributeCounts.get(attribute.code) || 0) + 1);
        }
        const hasConflictingCharacterLabels = [...attributeCounts.values()].some((count) => count > 1);
        if (speakerCharacterEntity && characterLabels.length > 0 && !hasConflictingCharacterLabels) {
            pushEntity({
                ...speakerCharacterEntity,
                visibleAttributes: mergeVisibleAttributes([
                    ...speakerCharacterEntity.visibleAttributes,
                    ...characterLabelAttributes,
                ]),
            });
        } else if (speakerCharacterEntity) {
            pushEntity(speakerCharacterEntity);
        }
        for (const entity of labelEntities) {
            if (entity.entityType === 'character') {
                if (!speakerCharacterEntity) {
                    pushEntity(entity);
                }
                continue;
            }
            pushEntity(entity);
        }
    } else {
        if (speakerCharacterEntity) {
            pushEntity(speakerCharacterEntity);
        }
        for (const entity of labelEntities) {
            pushEntity(entity);
        }
    }
    if (text) {
        pushEntity({
            entityKeySeed: `${message?.index ?? ''}:${text}`,
            entityType: 'unknown',
            displayLabel: 'visible-message',
            visibleAttributes: [{
                code: 'status-visible-text-fragment',
                value: text.slice(0, 120),
                confidenceBand: 'explicit',
            }],
            confidenceBand: 'explicit',
        });
    }
    return entities.slice(0, 32);
}

function uniqueEntitiesBySeed(entities) {
    const seen = new Set();
    const unique = [];
    for (const entity of entities) {
        const key = `${entity.entityType}:${entity.entityKeySeed}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(entity);
    }
    return unique;
}

function mergeVisibleAttributes(attributes) {
    const merged = [];
    const seen = new Set();
    for (const attribute of attributes) {
        if (seen.has(attribute.code)) {
            continue;
        }
        seen.add(attribute.code);
        merged.push(attribute);
    }
    return merged;
}

function extractExplicitVisualProjectionLabelEntities(text, messageIndex, {
    labelTypes,
    labelAttributeCodes,
    labelAttributeCodeResolver,
}) {
    const entities = [];
    for (const line of text.split(/\n+/)) {
        const trimmed = sanitizeText(line, 400).trim().replace(/^[-*•]\s*/, '');
        const normalizedLine = trimmed.replace(/^[^A-Za-z\u4e00-\u9fff]+/u, '');
        const match = normalizedLine.match(/^(.{1,80}?)\s*[:：]\s*(.{1,400})$/u);
        if (!match) {
            continue;
        }
        const rawLabel = normalizeVisualProjectionLabel(match[1]);
        const type = labelTypes.get(rawLabel);
        if (!type) {
            continue;
        }
        const value = sanitizeText(match[2], 160).trim();
        if (!value) {
            continue;
        }
        if (type === 'character' && (isNarratorSpeaker(value) || /^(?:你|玩家|player|user)$/iu.test(value))) {
            continue;
        }
        const attributeCodes = labelAttributeCodeResolver?.(rawLabel, type)
            || [labelAttributeCodes[type]];
        entities.push({
            entityKeySeed: `${messageIndex ?? ''}:${type}:${rawLabel}:${value}`,
            entityType: type,
            displayLabel: value.slice(0, 80),
            visibleAttributes: attributeCodes.filter(Boolean).map((code) => ({
                code,
                value: value.slice(0, 120),
                confidenceBand: 'explicit',
            })),
            confidenceBand: 'explicit',
        });
    }
    return entities;
}

function resolveCoreCharacterLabelAttributeCode(rawLabel, type) {
    if (type !== 'character') return null;
    if (['性别', '性别表现', 'gender', 'gender presentation'].includes(rawLabel)) {
        return ['character-explicit-gender-presentation'];
    }
    if (['种族', '物种', 'race', 'species'].includes(rawLabel)) {
        return ['character-explicit-species'];
    }
    if (['服装', '衣着', '穿着', 'clothing', 'outfit'].includes(rawLabel)) {
        return ['character-explicit-clothing'];
    }
    if (['特征', '外观', '外貌', 'appearance', 'features', 'traits'].includes(rawLabel)) {
        return ['character-explicit-appearance'];
    }
    return null;
}

function normalizeVisualProjectionLabel(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/^[\s>*#`*_~\x5b\x5d()（）【】「」『』]+|[\s>*#`*_~\x5b\x5d()（）【】「」『』]+$/gu, '')
        .replace(/[：:]+$/u, '')
        .replace(/[\\/_-]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
}


function normalizeOriginalChatMessages(chat) {
    return normalizeOriginalVisibleChatMessages(chat)
        .map((message, index) => {
            const originalChoices = message.role === 'character'
                ? extractSuggestedActionsFromOriginalText(message.text)
                : { displayText: message.text, suggestedActions: [] };
            return {
                id: `original-chat-message-${index}`,
                speaker: message.speaker,
                role: message.role,
                text: message.text,
                displayText: formatVisualNovelDisplayText(originalChoices.displayText),
                suggestedActions: originalChoices.suggestedActions,
                sentAt: message.sentAt,
            };
        });
}

export function formatVisualNovelDisplayText(value) {
    const source = sanitizeText(value, MAX_VISIBLE_CHAT_TEXT_LENGTH)
        .replace(/\r\n?/g, '\n')
        .replace(/<br\s*\/?>/gi, '\n');
    if (!source) {
        return '';
    }

    const withoutHiddenBlocks = stripHiddenVisualNovelDisplayBlocks(source);
    const withoutMetaMarkers = stripVisualNovelMetaMarkers(withoutHiddenBlocks);
    const withoutMarkdownFences = stripVisualNovelMarkdownCodeFences(withoutMetaMarkers);
    const withoutMarkdownEmphasis = stripVisualNovelMarkdownEmphasis(withoutMarkdownFences);
    const withParagraphBreaks = addVisualNovelParagraphBreaks(withoutMarkdownEmphasis);
    return splitLongVisualNovelParagraphs(withParagraphBreaks)
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function stripVisualNovelMarkdownCodeFences(value) {
    return String(value || '')
        .split('\n')
        .filter((line) => !/^```[\w-]*\s*$/.test(line.trim()))
        .join('\n');
}

function stripVisualNovelMetaMarkers(value) {
    return String(value || '')
        .replace(/```\s*\[?\s*(?:think|thinking|thought|reasoning|analysis)\s*\]?\s*```/gi, '')
        .replace(/^\s*\[\s*(?:think|thinking|thought|reasoning|analysis)\s*\]\s*[:：-]?\s*/i, '')
        .replace(/^\s*(?:think|thinking|thought|reasoning|analysis)\s*[:：]\s*/i, '');
}

export function createVisualNovelDisplaySegments(value, {
    fallbackSpeaker = '',
    role = 'character',
    knownSpeakers = [],
    characterNames = [],
} = {}) {
    const displayText = formatVisualNovelDisplayText(value);
    const fallbackName = sanitizeText(fallbackSpeaker, 160);
    if (!displayText) {
        return [{
            index: 0,
            type: role === 'player' ? 'player' : 'narration',
            speaker: role === 'player' ? '你' : fallbackName || '旁白',
            text: '',
        }];
    }

    const knownSpeakerMap = createKnownSpeakerMap([
        ...(Array.isArray(knownSpeakers) ? knownSpeakers : []),
        ...(Array.isArray(characterNames) ? characterNames : []),
    ]);
    // The original runtime may put several `name + action + quoted speech`
    // clauses inside one long visible paragraph. Split those clauses only for
    // presentation so the active speaker can select its verified visual
    // binding; the canonical chat message remains unchanged.
    const knownSegmentedText = splitKnownInlineNarrativeDialogues(displayText, knownSpeakerMap);
    const sourceText = String(value ?? '');
    const connectorParagraphPattern = /\n{2,}(?=(?:然后|接着|随后|这时|此时)\s*(?:[A-Z][A-Za-z0-9_-]{1,39}|[\p{Script=Han}ぁ-んァ-ヶー]{2,8}).{1,64}?\s*[：:]\s*[“"「『])/gu;
    const connectorMergedText = knownSegmentedText.replace(connectorParagraphPattern, (separator, offset, segmentedText) => {
        const connectorClause = segmentedText.slice(offset + separator.length).match(
            /^(?:然后|接着|随后|这时|此时)\s*(?:[A-Z][A-Za-z0-9_-]{1,39}|[\p{Script=Han}ぁ-んァ-ヶー]{2,8}).{1,64}?\s*[：:]\s*[“"「『]/u,
        )?.[0] || '';
        // Preserve a paragraph break that exists in the original chat body.
        // Only undo a break introduced by the display formatter; never merge
        // source paragraphs or destroy the offsets used by title evidence.
        return connectorClause && sourceText.includes(`\n\n${connectorClause}`) ? separator : '';
    });
    const segmentedDisplayText = splitInferredInlineNarrativeDialogues(connectorMergedText, knownSpeakerMap);
    let sourceCursor = 0;
    const segments = segmentedDisplayText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph && !isPunctuationOnlyVisualNovelSegment(paragraph))
        .map((paragraph, index) => {
            const segment = classifyVisualNovelSegment(paragraph, {
                fallbackSpeaker: fallbackName,
                role,
                knownSpeakerMap,
            });
            const startUtf16 = displayText.indexOf(paragraph, sourceCursor);
            const sourceSpan = startUtf16 < 0
                ? null
                : {
                    start: Array.from(displayText.slice(0, startUtf16)).length,
                    end: Array.from(displayText.slice(0, startUtf16 + paragraph.length)).length,
                };
            if (startUtf16 >= 0) sourceCursor = startUtf16 + paragraph.length;
            return {
                index,
                ...segment,
                sourceSpan,
                sourceText: sourceSpan ? Array.from(displayText).slice(sourceSpan.start, sourceSpan.end).join('') : paragraph,
            };
        });
    return applyQuotedDialogueSpeakerContinuity(segments);
}

export function applyQuotedDialogueSpeakerContinuity(segments) {
    let carry = null;
    return (Array.isArray(segments) ? segments : []).map((sourceSegment) => {
        const segment = { ...sourceSegment };
        const raw = String(segment.sourceText ?? segment.text ?? '');
        const identityRef = segment.identityRef;
        const hasIdentity = identityRef?.type && identityRef.type !== 'unknown' && identityRef.id;

        if (carry && ['unattributed-dialogue', 'narration'].includes(segment.type)) {
            const scanned = scanDialogueQuoteState(raw, carry.stack);
            if (scanned.reliable && raw.trim()) {
                segment.type = 'dialogue';
                segment.speaker = carry.speaker;
                segment.identityRef = carry.identityRef;
                segment.speakerContinuation = true;
                carry = scanned.stack.length
                    ? { ...carry, stack: scanned.stack }
                    : null;
                return segment;
            }
            carry = null;
            return segment;
        }

        if (segment.type === 'dialogue' && hasIdentity && !segment.speakerContinuation) {
            const scanned = scanDialogueQuoteState(raw, []);
            carry = scanned.reliable && scanned.stack.length
                ? { speaker: segment.speaker, identityRef: { ...identityRef }, stack: scanned.stack }
                : null;
        } else {
            carry = null;
        }
        return segment;
    });
}

/**
 * Low-priority quote continuation for validated presentation annotations.
 * Narration always remains narration; only an open quote in an already
 * resolved dialogue can supply identity to a contiguous unattributed segment.
 */
export function applyAnnotationDialogueSpeakerContinuity(segments) {
    let carry = null;
    const resolved = (identity) => ['published', 'chat-local'].includes(identity?.type)
        && typeof identity.id === 'string' && Boolean(identity.id.trim());
    const sameIdentity = (left, right) => resolved(left) && resolved(right)
        && left.type === right.type && left.id === right.id;
    return (Array.isArray(segments) ? segments : []).map((sourceSegment) => {
        const segment = { ...sourceSegment };
        delete segment.speakerContinuation;
        const raw = String(segment.sourceText ?? segment.text ?? '');
        const span = segment.sourceSpan;
        const sourceValid = Number.isSafeInteger(segment.sourceMessageIndex) && segment.sourceMessageIndex >= 0
            && typeof segment.sourceMessageHash === 'string' && Boolean(segment.sourceMessageHash)
            && Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
            && span.start >= 0 && span.end > span.start && span.end - span.start === Array.from(raw).length;
        const contiguous = carry && sourceValid && carry.sourceMessageIndex === segment.sourceMessageIndex
            && carry.sourceMessageHash === segment.sourceMessageHash && carry.end === span.start;
        const mayContinue = contiguous && (segment.type === 'unattributed-dialogue'
            || (segment.type === 'dialogue' && sameIdentity(segment.identityRef, carry.identityRef)));
        if (mayContinue) {
            const scanned = scanDialogueQuoteState(raw, carry.stack);
            const carriedQuoteEnd = findAnnotationCarriedQuoteEnd(raw, carry.stack);
            const closesAtEnd = carriedQuoteEnd === null
                || !Array.from(raw).slice(carriedQuoteEnd).join('').trim();
            if (scanned.reliable && raw.trim() && closesAtEnd) {
                if (segment.type === 'unattributed-dialogue') {
                    segment.type = 'dialogue';
                    segment.speaker = carry.speaker;
                    segment.identityRef = { ...carry.identityRef };
                }
                segment.speakerContinuation = true;
                carry = scanned.stack.length ? { ...carry, stack: scanned.stack, end: span.end } : null;
                return segment;
            }
        }
        carry = null;
        if (sourceValid && segment.type === 'dialogue' && resolved(segment.identityRef) && String(segment.speaker || '').trim()) {
            const scanned = scanDialogueQuoteState(raw, []);
            if (scanned.reliable && scanned.stack.length) {
                carry = {
                    speaker: segment.speaker,
                    identityRef: { ...segment.identityRef },
                    stack: scanned.stack,
                    end: span.end,
                    sourceMessageIndex: segment.sourceMessageIndex,
                    sourceMessageHash: segment.sourceMessageHash,
                };
            }
        }
        return segment;
    });
}

/**
 * Build display-only speaker title evidence from a small set of explicit
 * source forms. This deliberately does not classify, split, or rewrite text.
 */
export function createStructuralPageTitleEvidence({
    fullText = '',
    publishedSpeakerNames = [],
    sourceMessageIndex,
    sourceMessageHash = '',
    viewSpan,
    coreSpan,
    previousPage,
    allowPlainNarration = true,
} = {}) {
    const chars = Array.from(String(fullText ?? ''));
    if (!Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
        || typeof sourceMessageHash !== 'string' || !sourceMessageHash.trim()
        || !isValidStructuralPageSpan(viewSpan, chars.length)
        || !isValidStructuralPageSpan(coreSpan, chars.length)
        || coreSpan.start < viewSpan.start || coreSpan.end > viewSpan.end) return null;

    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .map((item) => typeof item === 'string' ? item : item?.characterKey)
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))];
    const coreText = chars.slice(coreSpan.start, coreSpan.end).join('');
    if (isNarrativeSoundEffectQuote(coreText)) {
        return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-sound-effect',
        }, coreSpan, { sourceMessageIndex, sourceMessageHash, core: coreSpan });
    }
    const matches = findStructuralSpeakerAttributions(coreText, knownNames, coreSpan.start);
    if (matches?.length && matches.hasUnresolvedAttribution) return null;
    if (matches?.length) return buildStructuralPageTitleEvidence(matches, {
        sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan,
    });

    const continuation = findStructuralQuoteContinuation({
        chars,
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan,
        coreSpan,
        previousPage,
    });
    if (continuation) return buildStructuralPageTitleEvidence([continuation], {
        sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan,
    });
    if (matches === null) return null;
    return allowPlainNarration
        ? buildPlainNarrationPageTitleEvidence(coreText, { sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan })
        : null;
}

/**
 * Classify the shape of one already-created production page. This is display /
 * replay metadata only: it does not create or modify a page, and it does not
 * It may consume already-validated message-index evidence to keep direct
 * attribution stronger than generic page-shape overlap.
 */
export function classifyStructuralPageShape({ fullText = '', pageType = '', coreSpan, messageIndex } = {}) {
    const chars = Array.from(String(fullText ?? ''));
    if (!isValidStructuralPageSpan(coreSpan, chars.length)) return { kind: 'unaddressable', evidenceSpan: null };
    const coreText = chars.slice(coreSpan.start, coreSpan.end).join('');
    const trimmed = trimStructuralSourceSpan(chars, coreSpan.start, coreSpan.end);
    if (!trimmed) return { kind: 'unaddressable', evidenceSpan: null };
    const pageText = chars.slice(trimmed.start, trimmed.end).join('');

    // A validated message-level speaker anchor is the strongest local evidence.
    // Weak lexical cue matches are evaluated after heading/narrative framing so
    // a title like `治疗与审问：...` cannot become dialogue merely because its
    // final character is also a speech verb.
    if (hasStructuralMessageSpeakerAnchor(messageIndex, chars.length, trimmed)) {
        return { kind: 'dialogue-candidate', evidenceSpan: trimmed };
    }

    // First-page title shape precedes weak lexical cue matches. A real speaker
    // anchor has already won above, while title morphology avoids treating
    // compounds such as `审问` as a speech predicate.
    const firstVisibleOffset = chars.findIndex((char) => !/\s/u.test(char));
    const coreStartsAtFirstVisible = firstVisibleOffset >= 0
        && chars.slice(0, coreSpan.start).every((char) => /\s/u.test(char))
        && coreSpan.end > firstVisibleOffset;
    const standaloneHeading = isLikelyStandalonePresentationHeading(pageText);
    const explicitProgressionHeading = /^#{1,6}\s+\S/u.test(pageText);
    const sceneTitleCandidate = isLikelyFirstPageSceneTitle(pageText);
    if ((coreStartsAtFirstVisible && (standaloneHeading || explicitProgressionHeading))
        || (coreStartsAtFirstVisible
            && !['unattributed-dialogue', 'dialogue', 'dialogue-group'].includes(pageType)
            && sceneTitleCandidate)) {
        return { kind: 'heading', evidenceSpan: trimmed };
    }

    // The user-confirmed title contract is strictly positional: every title
    // shape, including explicit Markdown headings, is narration away from the
    // opening page of a progression.
    if ((standaloneHeading || sceneTitleCandidate || explicitProgressionHeading) && !coreStartsAtFirstVisible) {
        return { kind: 'narrative', evidenceSpan: trimmed };
    }

    if (isNarrativeProgressionPromptQuote(pageText)) return { kind: 'narrative', evidenceSpan: trimmed };
    if (isNarrativeSoundEffectQuote(pageText)) return { kind: 'narrative', evidenceSpan: trimmed };

    // A news/rumor frame with several reported quotations is a narrow,
    // positive narration cue. Keep generic framed-quote handling below the
    // explicit speaker cue so a later-message anchor cannot be shadowed.
    if (hasNarrativeReportedQuoteCluster(pageText)) {
        return { kind: 'narrative', evidenceSpan: trimmed };
    }
    if (hasNarrativeFramedUnattributedQuote(pageText)) {
        return { kind: 'narrative', evidenceSpan: trimmed };
    }
    if (hasStructuralExplicitDialogueCue(pageText, messageIndex, chars.length, trimmed)) {
        return { kind: 'dialogue-candidate', evidenceSpan: trimmed };
    }

    // Strong current-page record shapes outrank only the weak fact that an
    // unmatched/full-message quote span happens to cross this page.
    if (isStructuralRecordShape(pageText)) return { kind: 'structured-record', evidenceSpan: trimmed };
    if (hasStructuralNarrativeInformationQuote(chars, trimmed)) {
        return { kind: 'narrative', evidenceSpan: trimmed };
    }

    // Message-level quote overlap is only a fallback signal. It remains useful
    // for continuation pages, but must not swallow an explicitly structured
    // record or a first-page title.
    if (hasStructuralMessageDialogueOverlap(messageIndex, chars.length, trimmed)) {
        return containsStructuralQuoteMarker(pageText) || hasStructuralClosedQuoteOverlap(messageIndex, chars.length, trimmed)
            ? { kind: 'dialogue-candidate', evidenceSpan: trimmed }
            : { kind: 'ambiguous', evidenceSpan: trimmed };
    }

    // A local standalone quote / weak quote shape is less decisive than an
    // explicit speech cue, but still safer to show as unrecognized dialogue
    // than to label as narration.
    if (hasStructuralDialogueCandidateShape(pageText)) return { kind: 'dialogue-candidate', evidenceSpan: trimmed };
    if (['unattributed-dialogue', 'dialogue', 'dialogue-group'].includes(pageType)) {
        return { kind: 'dialogue-candidate', evidenceSpan: trimmed };
    }
    if (['narration', 'unknown'].includes(pageType) && !isLikelyUnpublishedSpeakerPrefix(pageText)) {
        return { kind: 'narrative', evidenceSpan: trimmed };
    }
    return { kind: 'ambiguous', evidenceSpan: trimmed };
}

function hasStructuralDialogueCandidateShape(value) {
    const chars = Array.from(String(value ?? ''));
    const scan = scanStructuralMessageQuotes(chars);
    if (scan.spans.some((quote) => isStructuralQuotedUtterance(chars, quote,
        findStructuralAttributionStart(chars, quote.start), findStructuralAttributionEnd(chars, quote.end)))) return true;
    const text = chars.join('');
    return /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[^\n。！？!?;；:：]{1,24}(?:低声说|轻声说|小声说|喊道|答道|问道|说道|回答|回复|骂道|说|问|答|喊|骂)(?:[:：]\s*|\s+)\S/u.test(text.trim())
        || /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[\p{L}][^\n.!?;:]{0,39}\b(?:whispered|whispers|replied|replies|answered|answers|shouted|shouts|asked|asks|called|calls|said|says)\b(?:[:,]\s*|\s+)\S/iu.test(text.trim());
}

function isNarrativeSoundEffectQuote(value) {
    const chars = Array.from(String(value ?? '').trim());
    const scan = findStructuralQuotedSpans(chars);
    if (!scan.reliable || scan.spans.length !== 1) return false;
    const quote = scan.spans[0];
    if (quote.start !== 0
        || !/^[!！?？。…]*$/u.test(chars.slice(quote.end).join('').trim())) return false;
    return isNarrativeSoundEffectSpan(chars, quote);
}

function isNarrativeProgressionPromptQuote(value) {
    const text = String(value ?? '').trim();
    const scan = findStructuralQuotedSpans(Array.from(text));
    if (!scan.reliable || scan.spans.length !== 1) return false;
    const quote = scan.spans[0];
    if (quote.start !== 0 || quote.end !== Array.from(text).length) return false;
    const content = Array.from(text).slice(1, -1).join('').trim();
    return /(?:…|\.{3})[^。！？!?]{0,36}选择(?:下一步|下一项|下一幕)[。！？!?]*$/u.test(content);
}

function isNarrativeSoundEffectSpan(sourceChars, quote) {
    if (!Array.isArray(sourceChars) || !isValidStructuralPageSpan(quote, sourceChars.length)) return false;
    const content = sourceChars.slice(quote.start + 1, quote.end - 1).join('').trim()
        .replace(/[!！?？。…]+$/u, '')
        .replace(/[—–-]{1,3}$/u, '');
    // Short sound tokens and their common repeated/elongated forms are scene
    // narration; ordinary replies (`好！`, `不！`) remain dialogue candidates.
    return /^(?:轰(?:隆{1,3}|轰{1,2})?|砰{1,2}|啪{1,2}|嘭{1,2}|咚{1,2}|嗡{1,2}|咣|哐|咔|咔嚓|咔{2,3}|噼啪|唰|咻|叮|铿锵|吼|啊{1,8}|(?:咣当|哐当){2})$/u.test(content);
}

function isNarrativeCombatOutcomeQuote(sourceChars, quote) {
    if (!Array.isArray(sourceChars) || !isValidStructuralPageSpan(quote, sourceChars.length)) return false;
    const content = sourceChars.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim()
        .replace(/[!！。]+$/u, '');
    if (!/^(?:成功|失败)$/u.test(content)) return false;
    const prior = sourceChars.slice(Math.max(0, quote.start - 140), quote.start).join('').trimEnd()
        .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).at(-1) || '';
    return /(?:攻击|命中|未命中|伤害|治疗|豁免|检定|判定|偷袭)[^。！？!?;；\n]{0,100}$/u.test(prior);
}

function findStructuralCrowdQuoteSpeaker(sourceChars, quote) {
    if (!Array.isArray(sourceChars) || !isValidStructuralPageSpan(quote, sourceChars.length)) return null;
    let paragraphStart = quote.start;
    while (paragraphStart > 1 && !(sourceChars[paragraphStart - 1] === '\n' && sourceChars[paragraphStart - 2] === '\n')) paragraphStart -= 1;
    let paragraphEnd = quote.end;
    while (paragraphEnd < sourceChars.length - 1 && !(sourceChars[paragraphEnd] === '\n' && sourceChars[paragraphEnd + 1] === '\n')) paragraphEnd += 1;
    const paragraph = sourceChars.slice(paragraphStart, paragraphEnd).join('');
    const quoteScan = findStructuralQuotedSpans(Array.from(paragraph));
    if (!quoteScan.reliable || quoteScan.spans.length < 2) return null;
    const contextStart = Math.max(0, paragraphStart - 100);
    let contextEnd = paragraphEnd;
    let nextParagraphStart = paragraphEnd;
    while (nextParagraphStart < sourceChars.length && /[\r\n]/u.test(sourceChars[nextParagraphStart])) nextParagraphStart += 1;
    if (nextParagraphStart > paragraphEnd && nextParagraphStart < sourceChars.length) {
        let nextParagraphEnd = nextParagraphStart;
        while (nextParagraphEnd < sourceChars.length - 1
            && !(sourceChars[nextParagraphEnd] === '\n' && sourceChars[nextParagraphEnd + 1] === '\n')) nextParagraphEnd += 1;
        const nextParagraph = sourceChars.slice(nextParagraphStart, nextParagraphEnd).join('');
        if (Array.from(nextParagraph).length <= 140
            && /(?:人群|水手们|群众|众人|大家)/u.test(nextParagraph)
            && /(?:热烈)?(?:欢呼|喝彩|叫好|高喊|齐声)/u.test(nextParagraph)) {
            contextEnd = nextParagraphEnd;
        }
    }
    const context = sourceChars.slice(contextStart, contextEnd).join('');
    const groupCue = /(?:人群|水手们|群众|众人|大家)/u.exec(context);
    const reportedSpread = /(?:传遍了?消息|消息(?:迅速|很快|很快地)?(?:传开|传来|传遍|散开|扩散)|欢呼声|纷纷议论)/u.test(context);
    // A reported rumor followed immediately by multiple consecutive quotes
    // is sufficient evidence for the collective display title. A quote run
    // without that same-message spread frame remains unattributed.
    const reportedQuoteRun = /(?:消息|传闻)(?:迅速|很快|很快地)?(?:传开|传遍|传来|散开|扩散)\s*[—–-]{1,2}\s*[“「『"]/u.test(context);
    if (!groupCue || (reportedSpread && !reportedQuoteRun)
        || (!/(?:热烈)?(?:欢呼|喝彩|叫好|高喊|齐声)/u.test(context) && !reportedQuoteRun)
        || !reportedSpread) return null;
    const group = /人群/u.test(context) ? '人群'
        : /水手们/u.test(context) ? '水手'
            : /群众/u.test(context) ? '群众' : '众人';
    const groupStart = contextStart + Array.from(context.slice(0, groupCue.index)).length;
    const contextSpan = { start: paragraphStart, end: contextEnd };
    return {
        text: group,
        displayText: ['人群', '群众', '众人'].includes(group) ? group : `${group}（群体）`,
        ruleId: 'crowd-report-quote',
        start: groupStart,
        end: groupStart + Array.from(group).length,
        contextSpan,
    };
}

function hasStructuralExplicitDialogueCue(value, messageIndex, sourceLength, coreSpan) {
    if (hasStructuralMessageSpeakerAnchor(messageIndex, sourceLength, coreSpan)) return true;
    const text = String(value ?? '').trim();
    return /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[^\n。！？!?;；:：]{1,24}(?:低声说|轻声说|小声说|喊道|答道|问道|说道|回答|回复|骂道|说|问|答|喊|骂)(?:[:：]\s*|\s+)\S/u.test(text)
        || /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[\p{L}][^\n.!?;:]{0,39}\b(?:whispered|whispers|replied|replies|answered|answers|shouted|shouts|asked|asks|called|calls|said|says)\b(?:[:,]\s*|\s+)\S/iu.test(text);
}

function hasStructuralMessageSpeakerAnchor(messageIndex, sourceLength, coreSpan) {
    if (messageIndex?.sourceLength !== sourceLength) return false;
    const overlaps = (span) => isValidStructuralPageSpan(span, sourceLength)
        && span.start < coreSpan.end && coreSpan.start < span.end;
    return (messageIndex.anchors || []).some((anchor) => (anchor.utteranceSpans || []).some(overlaps));
}

function hasNarrativeFramedUnattributedQuote(value) {
    const chars = Array.from(String(value ?? ''));
    const scan = findStructuralQuotedSpans(chars);
    if (!scan.reliable || !scan.spans.length) return false;
    return scan.spans.some((quote) => {
        const prefixStart = findStructuralAttributionStart(chars, quote.start);
        const prefix = chars.slice(prefixStart, quote.start).join('').trim();
        const clause = prefix.replace(/[:：]\s*$/u, '').trim();
        const finalClause = clause.split(/[，,]/u).at(-1)?.trim() || clause;
        if (quote.closed && /(?:消息|传闻)(?:迅速|很快|很快地)?(?:传开|传遍|传来|散开|扩散)(?:[—–-]{1,2})?$/u.test(finalClause)) return true;
        if (!/[:：]\s*$/u.test(prefix)) return false;
        if (isStructuralQuotedInformationFrame(clause, finalClause)) return true;
        // A short quotation copied from an inscription, note, or record is
        // narrated text, not a character turn.
        if (/(?:刻着|刻有|铭刻着|铭刻有|写着|写有|记着|记录着|标注着|标着|注明|显示着|浮现出|浮现着)$/u.test(finalClause)) return true;
        // A pronoun-led action clause followed by a colon is narration framing,
        // not proof that the pronoun owns the quote. Keep explicit speech
        // predicates such as `她低声说：` unresolved unless a separate anchor
        // or safe same-message backreference already identifies the speaker.
        const pronounAction = /^(?:她|他)(?=.{3,})/u.test(finalClause)
            && !/(?:低声说|轻声说|小声说|说道|问道|答道|喊道|说|问|答|喊|骂|道)$/u.test(finalClause);
        if (pronounAction) return true;
        // Generic/description-led subjects may explicitly be described as
        // speaking, but without a rostered name they remain part of narration.
        // Standalone quotes and named roster/unknown-name anchors do not match.
        return /(?:对方|(?:一个|那|某个|矮小的|瘦小的|高大的)?(?:身影|人影)|陌生人|那个人|说话者|someone|the figure|the stranger)/iu.test(clause)
            && /(?:低声说|轻声说|小声说|说道|问道|答道|喊道|说|问|答|喊|骂|道)$/u.test(clause);
    });
}

function hasNarrativeReportedQuoteCluster(value) {
    const source = String(value ?? '').trim();
    if (!source) return false;
    const chars = Array.from(source);
    const quoteSpans = findStructuralQuotedSpans(chars);
    if (!quoteSpans.reliable || quoteSpans.spans.length < 2) return false;
    const frames = [...source.matchAll(/(?:消息|传闻)(?:迅速|很快|很快地)?(?:传开|传遍|传来|散开|扩散)\s*[—–-]{1,2}\s*/gu)];
    return frames.some((frame) => {
        const frameEnd = Array.from(source.slice(0, frame.index + frame[0].length)).length;
        // A preceding unrelated quotation (for example a sign or plaque) is
        // allowed. Only count the immediately subsequent reported quote run.
        const following = quoteSpans.spans.filter((span) => span.start >= frameEnd);
        if (following.length < 2 || chars.slice(frameEnd, following[0].start).join('').trim()) return false;
        let count = 1;
        let previousEnd = following[0].end;
        for (const span of following.slice(1)) {
            if (chars.slice(previousEnd, span.start).join('').trim()) break;
            count += 1;
            previousEnd = span.end;
        }
        return count >= 2;
    });
}

function isNarrativeCoordinatedActionQuote(value) {
    const text = String(value ?? '').trim();
    const firstQuoteStart = text.search(/[“「『"]/u);
    if (firstQuoteStart < 0) return false;
    const prefix = text.slice(0, firstQuoteStart).trim();
    const match = /^(?<first>[A-Z][A-Za-z0-9'’.-]{1,20}|[\p{Script=Han}]{2,4})\s*(?:和|与|以及)\s*(?<second>[A-Z][A-Za-z0-9'’.-]{1,20}|[\p{Script=Han}]{2,4})(?<tail>[^。！？!?;；:：\n]{0,72})\s*[:：]$/u.exec(prefix);
    return Boolean(match?.groups?.first && match.groups.second
        && /(?:留守|留下|留在|负责|管理|照看|护送|驻守)/u.test(match.groups.tail || ''));
}

function isNarrativeShortCommandAfterOpeningHeading(sourceChars, coreSpan) {
    if (!Array.isArray(sourceChars) || !isValidStructuralPageSpan(coreSpan, sourceChars.length)) return false;
    const pageText = sourceChars.slice(coreSpan.start, coreSpan.end).join('').trim();
    if (!/^[“"「『](?:行动|出发|开始|进攻|冲锋|撤退)[!！。]?[”"」』]$/u.test(pageText)) return false;
    const before = sourceChars.slice(0, coreSpan.start).join('').trim();
    if (!before || /[“”"「」『』]/u.test(before)) return false;
    const leadingLines = before.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    return leadingLines.length === 1 && leadingLines[0].length <= 24
        && !/[，,。！？!?;；:：]/u.test(leadingLines[0]);
}

function isStructuralQuotedInformationFrame(clause, finalClause = clause) {
    const source = String(clause ?? '').trim();
    const tail = String(finalClause ?? '').trim()
        .replace(/^(?:(?:但是|不过|然而|随后|接着|然后|并|同时|这时|此时)\s*)+/u, '').trim();
    if (!source) return false;
    // Source plus reporting verb identifies an inscription/citation, not a
    // speaking character. Treat these as source families instead of separate
    // character-name or sentence exceptions.
    const sourceNoun = '(?:地图|图|羊皮纸|卷轴|信件|信纸|信|账本|账页|记录册|记录|条目|日志|报告|公告|文书|清单|碑文|石碑|墙面|徽记|徽章|牌子|告示|面板|屏幕|状态栏|系统提示|铭文|纸条|便笺|书页)';
    // Source prose often places a short description between the writing verb
    // and the quote (`徽记背面刻着一行歪斜通用语：...`) or gives the carrier
    // earlier in the same sentence (`羊皮纸...标着几个字：...`). Keep this
    // bounded and require both a concrete carrier and a visible-text verb.
    const sourceFrame = new RegExp(`(?:${sourceNoun})(?:的)?(?:背面|表面|上|中|里|内|边缘|内容)?[^。！？!?;；“”「」『』"']{0,88}(?:写着|写有|写道|记着|记载着|记载|记录着|记录|标注着|标注|标着|注明|显示着|显示|浮现出|浮现着|刻着|刻有|铭刻着|铭刻有|列着|列出|写明|指出(?:位置|地点)?|指明|指向|标出|内容是|画着|描绘着|绘着)[^。！？!?;；“”「」『』"']{0,24}$`, 'u');
    const genericInscriptionFrame = /(?:背面|正面|表面|上面|碑上|墙上|内容)?(?:刻着|刻有|铭刻着|铭刻有|写着|写有|写道|记着|记载着|记录着|标注着|注明|显示着|浮现出|浮现着)(?:一行|几行|几个字|一段文字|一些文字|字样|文字|内容)?[^。！？!?;；“”「」『』"']{0,18}$/u;
    // AI prose may describe text projected on a body, object, or empty surface
    // without naming a conventional source such as a map or screen. Treat the
    // quoted text as displayed information when the local frame explicitly
    // says that characters/words are floating or appearing there.
    const displayedTextFrame = /(?:[\p{Script=Han}]{1,8})(?:却)?(?:浮着|浮现着|显现着|显现出|显示着|显示出)[^。！？!?;；“”「」『』"']{0,16}(?:字|文字|字符|符号)$/u;
    const documentEntryFrame = /^(?:(?:还有|另有|其中|上面|里面)?\s*)?(?:一|两|三|几|数)?(?:条|行|项|段)(?:[^。！？!?;；“”「」『』"']{0,28})(?:账页|记录|条目|档案|条款|清单)$/u;
    if (sourceFrame.test(tail) || sourceFrame.test(source) || genericInscriptionFrame.test(tail)
        || displayedTextFrame.test(tail) || displayedTextFrame.test(source)
        || documentEntryFrame.test(tail) || documentEntryFrame.test(source)) return true;
    const label = tail.match(/^(.{1,32})$/u)?.[1]?.trim() || '';
    return Boolean(label && isStructuralInformationLabel(label));
}

function isStructuralInformationLabel(value) {
    const label = String(value ?? '').trim();
    return isNonCharacterVisualLabel(label)
        || /^(?:HP|MP|AC|XP|EXP|状态|属性|战斗记录|经验记录|系统(?:提示)?|游戏信息|行动顺序|先攻顺序|金币|生命|魔力|目标|地点|位置|事件|线索|证据)$/iu.test(label);
}

function isStructuralNarrativeInformationQuote(source, quote, prefixStart, suffixEnd) {
    if (!Array.isArray(source) || !isValidStructuralPageSpan(quote, source.length)) return false;
    if (isNarrativeSoundEffectSpan(source, quote)
        || isNarrativeCombatOutcomeQuote(source, quote)
        || isNarrativeProgressionPromptQuote(source.slice(quote.start, quote.end).join(''))) return true;
    const content = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    if (!content || isStructuralRecordShape(content)) return true;
    const prefix = source.slice(prefixStart, quote.start).join('').trim();
    const clause = prefix.replace(/[:：]\s*$/u, '').trim();
    const finalClause = clause.split(/[，,]/u).at(-1)?.trim() || clause;
    if (isStructuralQuotedInformationFrame(clause, finalClause)) return true;
    if (/^(?:[^:：\r\n]{1,32})\s*[:：]\s*$/u.test(prefix)) {
        const label = prefix.replace(/[:：]\s*$/u, '').trim();
        if (isStructuralInformationLabel(label)) return true;
    }
    return false;
}

function isStrongStructuralQuoteSpeaker(speaker) {
    if (!speaker) return false;
    // A named subject plus an ordinary action can introduce speech, but it is
    // weaker than a frame that explicitly says the text came from a map,
    // record, letter, interface, or other information source.
    return !['rostered-subject-quoted-clause', 'unrostered-action-attribution'].includes(speaker.ruleId);
}

function isStructuralNarrativeInformationFrame(source, quote, prefixStart, suffixEnd, speaker = null) {
    if (!isStructuralNarrativeInformationQuote(source, quote, prefixStart, suffixEnd)
        || isStrongStructuralQuoteSpeaker(speaker)) return false;
    // A named actor's action directly introducing a quoted turn takes
    // precedence over record-shaped words inside that quote. Keep explicit
    // inscription/citation frames (for example, `记录上写着`) in narration.
    if (['rostered-subject-quoted-clause', 'unrostered-action-attribution'].includes(speaker?.ruleId)) {
        const prefix = source.slice(prefixStart, quote.start).join('').replace(/[:：]\s*$/u, '').trim();
        const finalClause = prefix.split(/[，,]/u).at(-1)?.trim() || prefix;
        if (!isStructuralQuotedInformationFrame(prefix, finalClause)) return false;
    }
    return true;
}

function hasStructuralNarrativeInformationQuote(source, span) {
    if (!Array.isArray(source) || !isValidStructuralPageSpan(span, source.length)) return false;
    const page = source.slice(span.start, span.end);
    const scan = scanStructuralMessageQuotes(page);
    return scan.spans.some((localQuote) => {
        const quote = { start: span.start + localQuote.start, end: span.start + localQuote.end, closed: localQuote.closed };
        const prefixStart = findStructuralAttributionStart(source, quote.start);
        const suffixEnd = findStructuralAttributionEnd(source, quote.end);
        const prefixSpeaker = findStructuralSpeakerInPrefix(source.slice(prefixStart, quote.start), []);
        const suffixSpeaker = findStructuralSpeakerInSuffix(source.slice(quote.end, suffixEnd), [],
            source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end));
        return isStructuralNarrativeInformationFrame(source, quote, prefixStart, suffixEnd, prefixSpeaker || suffixSpeaker);
    });
}

function hasStructuralMessageDialogueOverlap(messageIndex, sourceLength, coreSpan) {
    if (!messageIndex || messageIndex.sourceLength !== sourceLength) return false;
    const overlapsCore = (span) => isValidStructuralPageSpan(span, sourceLength)
        && span.start < coreSpan.end && coreSpan.start < span.end;
    return (messageIndex.dialogueCandidateSpans || []).some(overlapsCore);
}

function hasStructuralClosedQuoteOverlap(messageIndex, sourceLength, coreSpan) {
    if (!messageIndex || messageIndex.sourceLength !== sourceLength) return false;
    return (messageIndex.unresolvedDialogueSpans || []).some((span) => span.quoteClosed === true
        && isValidStructuralPageSpan(span, sourceLength)
        && span.start < coreSpan.end && coreSpan.start < span.end);
}

function isStructuralRecordShape(value) {
    const text = String(value ?? '').trim();
    if (!text) return false;
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    // An unrostered English System: field is game metadata, not a speaker
    // header. A validated message-level speaker anchor is checked before this
    // shape filter, so an explicitly rostered character named System wins.
    if (lines.some((line) => /^system\s*:\s*\S/iu.test(line))) return true;
    // Explicit game-mechanics labels describe narrated game output, even when
    // a result sentence follows the roll on the same visual page.
    if (lines.some((line) => /^(?:检定|判定|豁免|伤害(?:计算|记录)?|战斗检定|经验(?:值|奖励)?|奖励|状态|属性|行动顺序|先攻顺序)\s*[:：]\s*\S/u.test(line))) return true;
    if (lines.some((line) => /^(?:选择|选项)\s*(?:[一二三四五六七八九十\d]+|[A-D])\s*[：:]\s*\S/iu.test(line))) return true;
    const listRows = lines.filter((line) => /^(?:[-*+]\s+|\d+[.)]\s+)/u.test(line));
    const fieldRows = lines.filter((line) => /^[^:：\r\n]{1,48}[:：]\s*\S/u.test(line));
    if (listRows.length >= 2 || (fieldRows.length >= 2 && fieldRows.length * 2 >= lines.length)) return true;
    if (lines.length !== 1) return false;
    const line = lines[0].replace(/^(?:[-—–*+]\s*)/u, '');
    const colon = line.search(/[:：]/u);
    if (colon <= 0) return false;
    const valuePart = line.slice(colon + 1).trim();
    return isStructuralNumericValue(valuePart) || isStructuralMultiFieldValue(valuePart);
}

function isLikelyFirstPageSceneTitle(value) {
    const text = String(value ?? '').trim();
    if (!text || text.length > 96 || /[\r\n“”「」『』"']/u.test(text)) return false;
    const match = text.match(/^([^:：]{4,8})\s*[:：]\s*(.{4,60})$/u);
    if (!match) return false;
    const heading = match[1].trim();
    const subtitle = match[2].trim();
    if (/[的地得]/u.test(heading)
        || /^(?:所以|因此|但是|不过|如果|虽然|而且|同时|此外|后来|接着|于是|这时|此时|随后|我|你|我们|他们|她|他)/u.test(heading)
        || /(?:情况|消息|计划|安排|方法|结果|原因|结论|问题|想法|策略|战术|办法|任务|方案|决定|行动|是|有|在|了|着|过|很|简单|觉得|认为|表示|意味着|需要|应该|必须)$/u.test(heading)) return false;
    if (/^(?:选择|选项|状态|HP|MP|AC|HP|MP|金币|生命|魔力|等级|经验|装备|技能|道具|背包|支出明细)$/iu.test(heading)) return false;
    if (/^(?:选择|选项)\s*(?:[一二三四五六七八九十\d]+|[A-D])$/iu.test(heading)) return false;
    // Avoid interpreting short speaker-like labels as titles when roster data
    // is unavailable. A current-page direct cue or validated roster anchor has
    // already won before this fallback.
    if (/^[\p{Script=Han}]{2,3}$/u.test(heading)
        || /^[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}$/u.test(heading)) return false;
    const trailingCue = findTrailingSpeechCue(heading);
    if (trailingCue) {
        const cueSubject = heading.slice(0, heading.length - trailingCue.text.length).trim();
        if (isLikelyInferredSpeakerName(cueSubject)) return false;
    }
    return Boolean(subtitle);
}

function isStructuralMultiFieldValue(value) {
    const text = String(value ?? '').trim();
    const fields = text.match(/(?:^|\s)[\p{L}_][\p{L}\p{N}_ -]{0,20}\s*[:=]\s*(?:[+\-−]?\d+(?:[.,]\d+)?|[dD]\d+(?:\s*[+\-−]\s*\d+)?)/gu) || [];
    return fields.length >= 2;
}

function isStructuralNumericValue(value) {
    const text = String(value ?? '').trim();
    if (!text || STRUCTURAL_QUOTE_OPENERS.has(Array.from(text)[0])) return false;
    const startsNumeric = /^(?:[+\-−]?\d+(?:[.,]\d+)?|[dD]\d+)(?:\b|\s|[+\-−*/×÷=])/u.test(text);
    return startsNumeric && (/^[+\-−]?\d+(?:[.,]\d+)?$/u.test(text)
        || /[=+\-−*/×÷]/u.test(text)
        || /^(?:[+\-−]?\d+(?:[.,]\d+)?|[dD]\d+)\s+[\p{L}]{1,12}(?:\b|\s|[.!。！])/u.test(text));
}

function buildStructuralDialogueCandidateSpans(chars, quoteScan, publishedSpeakerNames = [], parserVersion = 'full-message-speaker-index.v84') {
    const spans = [];
    for (const quote of quoteScan?.spans || []) {
        const prefixStart = findStructuralAttributionStart(chars, quote.start);
        const suffixEnd = findStructuralAttributionEnd(chars, quote.end);
        const prefixSpeaker = findStructuralSpeakerInPrefix(chars.slice(prefixStart, quote.start), publishedSpeakerNames, parserVersion);
        const suffixSpeaker = findStructuralSpeakerInSuffix(chars.slice(quote.end, suffixEnd), publishedSpeakerNames,
            chars.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join(''));
        const readoutCarrierFrameV78 = isStructuralParserVersionV78(parserVersion)
            && isStructuralQuotedReadoutFrameV78(chars, quote);
        if (isStructuralNarrativeInformationFrame(chars, quote, prefixStart, suffixEnd, prefixSpeaker || suffixSpeaker)
            || readoutCarrierFrameV78) continue;
        if (!isStructuralQuotedUtterance(chars, quote, prefixStart, suffixEnd)
            && !['player-direct-speech', 'player-first-person-action'].includes(prefixSpeaker?.ruleId)) continue;
        const utterance = trimStructuralSourceSpan(chars, quote.start + 1, quote.closed ? quote.end - 1 : quote.end);
        if (utterance) spans.push(utterance);
    }

    // Direct cues without quote marks are candidates too. Capture only the
    // utterance tail after the cue; do not consult or infer a speaker.
    const cuePatterns = [
        /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[^\n。！？!?;；:：]{1,24}(?:低声说|轻声说|小声说|喊道|答道|问道|说道|回答|回复|骂道|说|问|答|喊|骂)(?:[:：]\s*|\s+)(\S.*)$/u,
        /^(?!\s*(?:#{1,6}|[-*+]\s|\d+[.)]\s))[\p{L}][^\n.!?;:]{0,39}\b(?:whispered|whispers|replied|replies|answered|answers|shouted|shouts|asked|asks|called|calls|said|says)\b(?:[:,]\s*|\s+)(\S.*)$/iu,
    ];
    let lineStart = 0;
    while (lineStart < chars.length) {
        let lineEnd = chars.indexOf('\n', lineStart);
        if (lineEnd < 0) lineEnd = chars.length;
        const lineText = chars.slice(lineStart, lineEnd).join('');
        if (containsStructuralQuoteMarker(lineText)) {
            if (lineEnd === chars.length) break;
            lineStart = lineEnd + 1;
            continue;
        }
        for (const pattern of cuePatterns) {
            const match = pattern.exec(lineText);
            if (!match?.[1]) continue;
            const tailOffset = match[0].lastIndexOf(match[1]);
            const utterance = trimStructuralSourceSpan(chars, lineStart + tailOffset, lineEnd);
            if (utterance) spans.push(utterance);
            break;
        }
        if (lineEnd === chars.length) break;
        lineStart = lineEnd + 1;
    }
    return [...new Map(spans.map((span) => [`${span.start}:${span.end}`, span])).values()]
        .sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Build a read-only, full-message index of directly attributed speech. The
 * index is only a source of evidence; callers must project it onto existing
 * production page spans with createStructuralPageTitleEvidenceFromMessageIndex.
 */
// One canonical capability contract for rules that may become presentation
// titles. Include all parser-selected rank 0–2 speaker/group evidence; keep
// the player gate and renderer tied to this parser-owned list so a valid
// structural result cannot be silently blocked by a stale secondary gate.
const STRUCTURAL_FAST_TITLE_RULES = new Set([
    'known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution', 'structured-speaker',
    'rostered-subject-quoted-clause', 'open-quote-continuation', 'full-message-structural',
    'annotation-title', 'plain-prose-narration', 'unattributed-quoted-speech', 'structural-record-shape',
    'structural-heading-shape', 'unattributed-dialogue-shape', 'pronoun-backreference',
    'recent-action-backreference', 'unknown-self-introduction', 'anonymous-first-appearance',
    'narrative-framed-quote', 'probable-narrative-dialogue', 'probable-quote-span-continuation',
    'player-direct-speech', 'player-first-person-action', 'honorific-display-title', 'group-role-prefix',
    'unrostered-action-attribution', 'recent-pronoun-speaker-continuation',
    'named-subject-colon-quote', 'leading-named-subject-colon-quote',
    'local-speech-cue', 'dashed-explicit-speech-cue', 'page-local-explicit-speech-cue',
    'expanded-explicit-signature', 'named-group-report-attribution', 'reported-first-utterance',
    'player-first-person-speech', 'player-action-quoted-turn', 'player-social-closure',
    'ranked-unique-action-subject', 'observed-subject-colon-quote', 'direct-action-attribution',
    'crowd-report-quote', 'self-identified-creature', 'actor-vocalization-action',
    'named-reaction-backreference', 'same-message-intro-pronoun-backreference',
    'prior-sentence-unique-action-subject', 'spirit-return-utterance',
    'bounded-dragon-name-backreference', 'laughter-speech-continuation',
    'quoted-character-reaction', 'character-expression-subject', 'player-known-prefix',
]);
const STRUCTURAL_EXACT_SPEAKER_TITLE_RULES = new Set([
    'known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution', 'structured-speaker',
    'rostered-subject-quoted-clause', 'open-quote-continuation', 'full-message-structural',
    'pronoun-backreference', 'recent-action-backreference', 'recent-pronoun-speaker-continuation',
    'named-subject-colon-quote', 'leading-named-subject-colon-quote', 'player-direct-speech',
    'player-first-person-action', 'honorific-display-title',
    'group-role-prefix', 'unrostered-action-attribution',
    'local-speech-cue', 'dashed-explicit-speech-cue', 'page-local-explicit-speech-cue',
    'expanded-explicit-signature', 'named-group-report-attribution', 'reported-first-utterance',
    'player-first-person-speech', 'player-action-quoted-turn', 'player-social-closure',
    'ranked-unique-action-subject', 'observed-subject-colon-quote', 'direct-action-attribution',
    'crowd-report-quote', 'self-identified-creature', 'actor-vocalization-action',
    'named-reaction-backreference', 'same-message-intro-pronoun-backreference',
    'prior-sentence-unique-action-subject', 'spirit-return-utterance',
    'bounded-dragon-name-backreference', 'laughter-speech-continuation',
    'quoted-character-reaction', 'character-expression-subject', 'player-known-prefix',
]);

export function isStructuralFastTitleRule(ruleId) {
    return STRUCTURAL_FAST_TITLE_RULES.has(ruleId);
}

export function isStructuralExactSpeakerTitleRule(ruleId) {
    return STRUCTURAL_EXACT_SPEAKER_TITLE_RULES.has(ruleId);
}

export function createStructuralMessageSpeakerIndex({
    fullText = '',
    publishedSpeakerNames = [],
    publishedSpeakerFingerprint = '',
    sourceMessageIndex,
    sourceMessageHash = '',
    parserVersion = 'full-message-speaker-index.v84',
} = {}) {
    const chars = Array.from(String(fullText ?? ''));
    if (!Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
        || typeof sourceMessageHash !== 'string' || !sourceMessageHash.trim()
        || typeof parserVersion !== 'string' || !parserVersion.trim()) {
        return {
            sourceMessageIndex, sourceMessageHash, publishedSpeakerFingerprint, parserVersion,
            sourceLength: chars.length, dialogueCandidateSpans: [], anchors: [], unresolvedDialogueSpans: [], scanStatus: 'invalid-source',
        };
    }

    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .map((item) => typeof item === 'string' ? item : item?.characterKey)
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))];
    const quoteScan = scanStructuralMessageQuotes(chars);
    const quoteResolutionById = new Map();
    const v84BlockedQuoteIds = new Set();
    const quoteEvidence = quoteScan.allSpans.map((quote) => ({
        quoteId: quote.quoteId,
        parentQuoteId: quote.parentQuoteId || null,
        quoteSpan: { start: quote.start, end: quote.end },
        closed: quote.closed === true,
        recoveredAtSentenceLimit: quote.recoveredAtSentenceLimit === true,
        prefixContextSpan: { start: findStructuralAttributionStart(chars, quote.start), end: quote.start },
        suffixContextSpan: { start: quote.end, end: findStructuralSentenceContextEnd(chars, quote.end) },
        previousSentenceContextSpan: findStructuralPreviousSentenceContextSpan(chars, quote.start),
        nextSentenceContextSpan: { start: quote.end, end: findStructuralSentenceContextEnd(chars, quote.end) },
        childQuoteIds: quoteScan.allSpans.filter((candidate) => candidate.parentQuoteId === quote.quoteId)
            .map((candidate) => candidate.quoteId),
    }));
    const dialogueCandidateSpans = buildStructuralDialogueCandidateSpans(chars, quoteScan, knownNames, parserVersion);
    const lineLabels = findStructuralLineSpeakerLabels(chars, knownNames, 0);
    const anchors = [];
    const unresolvedDialogueSpans = [...quoteScan.ambiguousSpans.map((span) => ({ ...span, reasonId: 'quote-scan-ambiguous' }))];

    for (const quote of quoteScan.spans) {
        let prefixStart = findStructuralAttributionStart(chars, quote.start);
        const detachedSpeechCueStart = findStructuralDetachedSpeechCueStart(chars, quote.start);
        if (detachedSpeechCueStart != null) prefixStart = detachedSpeechCueStart;
        let prefixAttributionStart = prefixStart;
        let prefix = chars.slice(prefixStart, quote.start);
        const suffixEnd = findStructuralAttributionEnd(chars, quote.end);
        const suffix = chars.slice(quote.end, suffixEnd);
        const currentUtteranceText = chars.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('');
        const localPrefixText = chars.slice(prefixStart, quote.start).join('');
        const readoutCarrierFrameV78 = isStructuralParserVersionV78(parserVersion)
            && isStructuralQuotedReadoutFrameV78(chars, quote);
        const writtenCarrierFrame = (isStructuralQuotedInformationFrame(localPrefixText, currentUtteranceText)
            || readoutCarrierFrameV78)
            && !findTrailingSpeechCue(localPrefixText);
        const directSpeechCue = findStructuralDirectSpeechCueSpeaker(prefix, knownNames);
        const summaryReporter = isStructuralParserVersionV78(parserVersion)
            ? findStructuralSummaryReporterV78(localPrefixText, knownNames, parserVersion) : null;
        const prefixSpeechCue = findTrailingSpeechCue(localPrefixText.replace(/[:：]\s*$/u, ''));
        const v74RosteredCueSpeaker = isStructuralParserVersionV76(parserVersion) && prefixSpeechCue
            ? findV75RosteredCueSpeaker(Array.from(localPrefixText).slice(0, prefixSpeechCue.start).join('').replace(/[，,]+$/u, ''), knownNames, prefixSpeechCue.text)
            : parserVersion === 'full-message-speaker-index.v74' && prefixSpeechCue
                ? findV74RosteredCueSpeaker(Array.from(localPrefixText).slice(0, prefixSpeechCue.start).join('').replace(/[，,]+$/u, ''), knownNames, prefixSpeechCue.text)
            : null;
        let prefixSpeaker = v74RosteredCueSpeaker
            || (directSpeechCue?.anonymous ? null : directSpeechCue || summaryReporter
                || findStructuralSpeakerInPrefix(prefix, knownNames, parserVersion));
        const detachedSpeechOwner = !prefixSpeaker
            ? findStructuralDetachedSpeechCueOwner(chars, quote.start, knownNames) : null;
        if (detachedSpeechOwner) {
            prefixSpeaker = {
                text: detachedSpeechOwner.text,
                start: detachedSpeechOwner.speakerSpan.start - prefixStart,
                end: detachedSpeechOwner.speakerSpan.end - prefixStart,
                ruleId: 'quoted-attribution',
            };
        }
        let suffixSpeaker = findStructuralSpeakerInSuffix(suffix, knownNames,
            chars.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join(''));
        if (!suffixSpeaker && quote.closed) suffixSpeaker = isStructuralParserVersionV77(parserVersion)
            ? findStructuralPostQuoteAttributionCueV77(chars, quote, knownNames)
                || findStructuralPostQuoteAttributionCue(chars, quote, knownNames)
            : findStructuralPostQuoteAttributionCue(chars, quote, knownNames);
        if (!suffixSpeaker && quote.closed) suffixSpeaker = findStructuralPostQuoteActorCue(chars, quote, knownNames);
        let crowdSpeaker = null;
        if (!prefixSpeaker && !suffixSpeaker) {
            crowdSpeaker = findStructuralCrowdQuoteSpeaker(chars, quote);
        }
        if (!prefixSpeaker && !suffixSpeaker) {
            const localCueSpeaker = findStructuralLocalSpeechCueSpeaker(chars, prefixStart, quote.start, knownNames);
            if (localCueSpeaker) {
                prefixSpeaker = {
                    ...localCueSpeaker,
                    start: localCueSpeaker.start - prefixStart,
                    end: localCueSpeaker.end - prefixStart,
                    ruleId: 'local-speech-cue',
                };
            }
        }
        if (!prefixSpeaker && !suffixSpeaker) {
            const dashedSpeechCueSpeaker = findStructuralDashedSpeechCueBeforeQuote(chars, quote, knownNames);
            if (dashedSpeechCueSpeaker) {
                prefixAttributionStart = dashedSpeechCueSpeaker.attributionStart;
                prefixSpeaker = {
                    ...dashedSpeechCueSpeaker,
                    start: dashedSpeechCueSpeaker.start - prefixStart,
                    end: dashedSpeechCueSpeaker.end - prefixStart,
                    ruleId: 'dashed-explicit-speech-cue',
                };
            }
        }
        const endsWithPronounSpeechCue = /(?:^|[。！？!?;；\n，,])(?:她|他|那位|那人)(?:(?![。！？!?;；\n，,]).){0,20}?(?:说着|说道|说|问道|问|喊道|喊)[，,:：]?$/u
            .test(prefix.join('').trim());
        if (endsWithPronounSpeechCue) {
            // The name in a preceding object/look-at clause is not the owner
            // of this pronoun-led line. Let the bounded prior-anchor path
            // resolve it, and leave it unknown when two people could fit.
            prefixSpeaker = null;
            suffixSpeaker = null;
        }
        // Generic Han-name parsing can mistake a connective plus pronoun
        // (“紧接着他喊”) for an unrostered character name. Leave that shape
        // for the bounded pronoun-backreference path below; without one unique
        // prior explicit anchor it must remain unresolved.
        if (/^(?:随后|紧接着|接着|然后|这时|此时|接下来)[她他]$/u.test(prefixSpeaker?.text || '')) {
            prefixSpeaker = null;
        }
        // A short quote can be followed by one actor's action and then that
        // actor's next quoted line (`“Wait!” Pippa raises a hand: “Trap!”`).
        // The immediately following attributed quote provides a local anchor
        // for the first quote; adjacency alone never does.
        if (!prefixSpeaker && !suffixSpeaker && quote.closed) {
            const nextQuote = quoteScan.spans.find((candidate) => candidate.start >= quote.end);
            if (nextQuote) {
                const betweenQuotes = chars.slice(quote.end, nextQuote.start);
                const betweenText = betweenQuotes.join('');
                const nextPrefixStart = findStructuralAttributionStart(chars, nextQuote.start);
                const nextPrefixSpeaker = findStructuralSpeakerInPrefix(chars.slice(nextPrefixStart, nextQuote.start), knownNames, parserVersion);
                const actionSpeaker = findStructuralSpeakerInPrefix(betweenQuotes, knownNames, parserVersion);
                const priorUtteranceLength = Array.from(chars.slice(quote.start + 1,
                    quote.closed ? quote.end - 1 : quote.end).join('').trim()).length;
                if (priorUtteranceLength <= 24 && nextPrefixSpeaker && actionSpeaker
                    && sameStructuralSpeakerName(nextPrefixSpeaker.text, actionSpeaker.text)
                    && /^\s*[^。！？!?;；\n]{1,48}[：:]\s*$/u.test(betweenText)) {
                    suffixSpeaker = {
                        ...actionSpeaker,
                        ruleId: 'post-quote-attribution',
                    };
                }
            }
        }
        // A quoted sound effect can sit between the actor's action and the
        // actor's next line (`Durik “轰”砸碎…：“还有老大？”`). It is not a
        // turn boundary, so look through only that recognized sound token.
        if (!prefixSpeaker && !suffixSpeaker) {
            const priorQuote = [...quoteScan.spans].reverse().find((item) => item.end <= quote.start);
            if (priorQuote && isNarrativeSoundEffectSpan(chars, priorQuote)) {
                const gap = chars.slice(priorQuote.end, quote.start).join('');
                const trimmedGap = gap.trim();
                const soundActionTail = trimmedGap.replace(/^(?:的|地|得|着|并|又|继续)\s*/u, '');
                const hasDirectSoundActionContinuation = new RegExp(`^(?:${STRUCTURAL_ACTION_CUE})`, 'u')
                    .test(soundActionTail);
                const hasVoiceFramedQuote = /^(?:的|地|得)?(?:金属声|声音|嗓音)[:：]\s*$/u.test(trimmedGap);
                // Only bridge a short grammatical continuation of the same
                // action. The text after the sound must begin with an action
                // predicate; a new subject/event, even without punctuation,
                // must not inherit the earlier actor.
                if (Array.from(trimmedGap).length <= 80
                    && (hasDirectSoundActionContinuation || hasVoiceFramedQuote)
                    && !/[,，、。！？!?;；\n]/u.test(gap)) {
                    const extendedStart = findStructuralAttributionStart(chars, priorQuote.start);
                    const extendedPrefix = chars.slice(extendedStart, quote.start);
                    const explicitNamesBeforeSound = [...new Set(anchors
                        .filter((anchor) => anchor?.certainty === 'explicit'
                            && Array.isArray(anchor.utteranceSpans)
                            && anchor.utteranceSpans.some((span) => isValidStructuralPageSpan(span, chars.length)
                                && span.end <= priorQuote.start)
                            && isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
                            && chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') === anchor.speakerText)
                        .map((anchor) => anchor.speakerText))];
                    const actionLead = chars.slice(extendedStart, priorQuote.start);
                    const localNamedAction = hasVoiceFramedQuote
                        ? findStructuralUniqueActionSubjectInClauses(actionLead.join(''), knownNames) : null;
                    const actionSpeaker = localNamedAction || findStructuralSpeakerInPrefix(actionLead, explicitNamesBeforeSound, parserVersion);
                    const actionSpeakerIsLocallyAnchored = actionSpeaker
                        && (localNamedAction?.ruleId === 'unrostered-action-attribution'
                            || explicitNamesBeforeSound.some((name) => sameStructuralSpeakerName(name, actionSpeaker.text)))
                        && !explicitNamesBeforeSound.some((name) => !sameStructuralSpeakerName(name, actionSpeaker.text)
                            && actionLead.join('').includes(name))
                        && findLatestStructuralSceneBoundaryEnd(chars, Math.max(0, extendedStart - 1), quote.start) == null;
                    const extendedSpeaker = actionSpeakerIsLocallyAnchored
                        ? actionSpeaker : findStructuralSpeakerInPrefix(extendedPrefix, knownNames, parserVersion);
                    if (extendedSpeaker) {
                        prefixStart = extendedStart;
                        prefix = extendedPrefix;
                        prefixSpeaker = extendedSpeaker;
                    }
                }
            }
        }
        if (!prefixSpeaker && !suffixSpeaker) {
            const laughterContinuation = findStructuralLaughingQuoteContinuation({
                source: chars,
                quote,
                knownNames,
                quotes: quoteScan.spans,
            });
            if (laughterContinuation) {
                prefixStart = laughterContinuation.speakerSpan.start;
                prefix = chars.slice(prefixStart, quote.start);
                prefixSpeaker = {
                    text: laughterContinuation.text,
                    start: 0,
                    end: Array.from(laughterContinuation.text).length,
                    ruleId: 'laughter-speech-continuation',
                };
            }
        }
        if (!prefixSpeaker && !suffixSpeaker && !crowdSpeaker && quote.closed) {
            const introPronounSpeaker = findStructuralAnonymousIntroPronounSpeaker({
                source: chars,
                quote,
                quotes: quoteScan.spans,
                knownNames,
            });
            if (introPronounSpeaker) {
                prefixSpeaker = {
                    text: introPronounSpeaker.text,
                    start: introPronounSpeaker.speakerSpan.start - prefixStart,
                    end: introPronounSpeaker.speakerSpan.end - prefixStart,
                    ruleId: 'same-message-intro-pronoun-backreference',
                };
                prefixAttributionStart = introPronounSpeaker.attributionStart;
            }
        }
        // A single named actor's immediately preceding action paragraph may
        // own one standalone conversational quote. This is intentionally
        // source-message-local and refuses written carriers, competing actors,
        // scene headings, unclosed quotes, and pronoun-only subjects.
        if (!prefixSpeaker && !suffixSpeaker && !crowdSpeaker && quote.closed) {
            const adjacentActionSpeaker = findStructuralAdjacentNamedActionSpeaker(chars, quote, knownNames);
            if (adjacentActionSpeaker) {
                prefixStart = adjacentActionSpeaker.contextSpan.start;
                prefixAttributionStart = adjacentActionSpeaker.contextSpan.start;
                prefix = chars.slice(prefixStart, quote.start);
                prefixSpeaker = {
                    text: adjacentActionSpeaker.text,
                    start: adjacentActionSpeaker.speakerSpan.start - prefixStart,
                    end: adjacentActionSpeaker.speakerSpan.end - prefixStart,
                    ruleId: 'unrostered-action-attribution',
                };
            }
        }
        // v78 follows a single named actor through a short action chain before
        // a standalone quote. It is bounded by sentence count, source span,
        // scene boundaries, quote boundaries, and source-carrier checks.
        if (isStructuralParserVersionV78(parserVersion) && !prefixSpeaker && !suffixSpeaker
            && !crowdSpeaker && quote.closed && !writtenCarrierFrame
            && !isNarrativeSoundEffectSpan(chars, quote)) {
            const actionChainSpeaker = findStructuralRecentActionChainSpeakerV78(chars, quote, knownNames);
            if (actionChainSpeaker) {
                prefixStart = actionChainSpeaker.contextSpan.start;
                prefixAttributionStart = actionChainSpeaker.contextSpan.start;
                prefix = chars.slice(prefixStart, quote.start);
                prefixSpeaker = {
                    text: actionChainSpeaker.text,
                    start: actionChainSpeaker.speakerSpan.start - prefixStart,
                    end: actionChainSpeaker.speakerSpan.end - prefixStart,
                    ruleId: 'bounded-action-chain-backreference',
                };
            }
        }
        // A unique grammatical action subject immediately introducing a quote
        // outranks other names in the same sentence (objects, possessors, or
        // people merely mentioned). Explicit speech attribution still wins.
        const prefixText = prefix.join('');
        const finalClauseStart = Math.max(prefixText.lastIndexOf('，'), prefixText.lastIndexOf(',')) + 1;
        const finalClause = prefixText.slice(finalClauseStart);
        const finalClauseHasSpeechCue = Boolean(findTrailingSpeechCue(finalClause.replace(/[:：]\s*$/u, '')));
        const finalClauseCandidate = /[:：]\s*$/u.test(finalClause) && !finalClauseHasSpeechCue
            ? findStructuralUniqueActionSubjectInClauses(prefixText, knownNames, { allowQuoteLocalBodyState: true }) : null;
        const uniqueActionSubject = finalClauseCandidate;
        const isVoiceMannerFrame = /^(?:只)?(?:用|以|通过|借助)[^，,。！？!?;；\n]{0,18}(?:声音|嗓音|语气)(?:里|中)?(?:说道|说|道|喊|叫)[：:]?$/u.test(finalClause.trim());
        const actionSubjectTail = finalClauseCandidate && finalClauseCandidate.start >= finalClauseStart
            ? Array.from(finalClause).slice(finalClauseCandidate.end - finalClauseStart).join('').trimStart() : '';
        const isModifierInsteadOfSubject = /^(?:地|的)/u.test(actionSubjectTail);
        if (uniqueActionSubject && !isModifierInsteadOfSubject && prefixSpeaker && !isVoiceMannerFrame
            && !isStructuralQuotedInformationFrame(prefixText, finalClause)) {
            const prefixRank = structuralQuoteSpeakerEvidenceRank(prefixSpeaker?.ruleId);
            const prefixIsPublishedName = knownNames.some((name) => sameStructuralSpeakerName(name, prefixSpeaker.text));
            if (!prefixIsPublishedName && prefixRank > 2
                && !sameStructuralSpeakerName(prefixSpeaker.text, uniqueActionSubject.text)) {
                prefixSpeaker = {
                    ...uniqueActionSubject,
                    ruleId: 'ranked-unique-action-subject',
                };
            }
        }
        const hasLocalAttributionContext = Boolean(prefix.join('').trim());
        const priorSentenceSpeaker = hasLocalAttributionContext || endsWithPronounSpeechCue
            || isNarrativeSoundEffectSpan(chars, quote)
            || writtenCarrierFrame
            || isStructuralFirstPersonIntroduction(currentUtteranceText)
            || isStructuralAnonymousFirstAppearance(chars, quote, prefixStart, suffixEnd)
            ? null : findStructuralUniquePriorSentenceActionSpeaker(chars, quote, knownNames);
        if (priorSentenceSpeaker && (!prefixSpeaker
            || (structuralQuoteSpeakerEvidenceRank(prefixSpeaker.ruleId) > 2
                && !knownNames.some((name) => sameStructuralSpeakerName(name, prefixSpeaker.text))))) {
            prefixStart = priorSentenceSpeaker.speakerSpan.start;
            prefixAttributionStart = priorSentenceSpeaker.contextSpan.start;
            prefix = chars.slice(prefixStart, quote.start);
            prefixSpeaker = {
                text: priorSentenceSpeaker.text,
                start: 0,
                end: Array.from(priorSentenceSpeaker.text).length,
                ruleId: 'prior-sentence-unique-action-subject',
            };
        }
        // A direct action may introduce a verbal quote, but a sound token
        // alone is not a speaking turn unless a speech predicate names it.
        if (quote.closed && isNarrativeSoundEffectSpan(chars, quote)) {
            if (prefixSpeaker?.ruleId === 'unrostered-action-attribution') prefixSpeaker = null;
            if (suffixSpeaker?.ruleId === 'unrostered-action-attribution') suffixSpeaker = null;
        }
        const utteranceStart = quote.start + 1;
        const utteranceEnd = quote.closed ? quote.end - 1 : quote.end;
        const utterance = trimStructuralSourceSpan(chars, utteranceStart, utteranceEnd);
        const quoteCandidates = [];
        const addQuoteCandidate = (candidate, speakerSpan, evidenceSpan) => {
            const candidateRuleId = candidate?.ruleId || 'quoted-attribution';
            const playerRosterContext = candidateRuleId === 'known-prefix'
                && /^(?:你|我|我们|你们)$/u.test(candidate?.text || '');
            const resolvedRuleId = playerRosterContext ? 'player-known-prefix' : candidateRuleId;
            if (!candidate?.text || !isValidStructuralPageSpan(speakerSpan, chars.length)
                || chars.slice(speakerSpan.start, speakerSpan.end).join('') !== candidate.text
                || !isValidStructuralPageSpan(evidenceSpan, chars.length)) return;
            quoteCandidates.push({
                speakerText: candidate.text,
                displaySpeakerText: candidate.displayText || candidate.text,
                speakerSpan: { ...speakerSpan },
                evidenceSpan: { ...evidenceSpan },
                sourceRegion: evidenceSpan.end <= quote.start ? 'before-quote'
                    : evidenceSpan.start >= quote.end ? 'after-quote' : 'quote-context',
                syntaxRole: structuralQuoteSyntaxRole(resolvedRuleId),
                ruleId: resolvedRuleId,
                evidenceRank: structuralQuoteSpeakerEvidenceRank(resolvedRuleId),
                groupMembers: Array.isArray(candidate.groupMembers) ? candidate.groupMembers : null,
            });
        };
        if (prefixSpeaker) addQuoteCandidate(prefixSpeaker, {
            start: prefixStart + prefixSpeaker.start, end: prefixStart + prefixSpeaker.end,
        }, { start: prefixAttributionStart, end: quote.start });
        if (suffixSpeaker) addQuoteCandidate(suffixSpeaker, {
            start: quote.end + suffixSpeaker.start, end: quote.end + suffixSpeaker.end,
        }, { start: quote.end, end: suffixEnd });
        if (crowdSpeaker) addQuoteCandidate(crowdSpeaker, {
            start: crowdSpeaker.start, end: crowdSpeaker.end,
        }, crowdSpeaker.contextSpan);
        if (uniqueActionSubject && !isModifierInsteadOfSubject && !isVoiceMannerFrame
            && !isStructuralQuotedInformationFrame(prefixText, finalClause)) {
            const actionSpan = {
                start: prefixStart + uniqueActionSubject.start,
                end: prefixStart + uniqueActionSubject.end,
            };
            addQuoteCandidate({ ...uniqueActionSubject, ruleId: 'ranked-unique-action-subject' }, actionSpan,
                { start: prefixAttributionStart, end: quote.start });
        }
        if (priorSentenceSpeaker) addQuoteCandidate({
            text: priorSentenceSpeaker.text, ruleId: 'prior-sentence-unique-action-subject',
        }, priorSentenceSpeaker.speakerSpan, priorSentenceSpeaker.contextSpan);
        let speaker = null;
        let speakerSpan = null;
        let attributionSpan = null;
        let ruleId = '';
        for (const label of lineLabels.filter((item) => item.utteranceSpan?.start <= quote.start
            && item.utteranceSpan?.end >= quote.end)) {
            addQuoteCandidate({ text: label.text, ruleId: label.ruleId },
                { start: label.start, end: label.end },
                { start: label.start, end: label.classificationEvidenceSpan.end });
        }
        const identifiedDragon = findStructuralSelfIdentifiedDragonSpeaker({ source: chars, quote, prefixStart });
        if (identifiedDragon) {
            addQuoteCandidate({ text: identifiedDragon.text, ruleId: 'self-identified-creature' },
                identifiedDragon.speakerSpan, { start: prefixStart, end: quote.end });
        }
        const expressionSpeaker = findStructuralCharacterExpressionQuoteSpeaker({
            source: chars, quote, prefixStart, suffixEnd, knownNames,
        });
        if (expressionSpeaker) addQuoteCandidate({
            text: expressionSpeaker.text, ruleId: 'character-expression-subject',
        }, expressionSpeaker.speakerSpan, expressionSpeaker.evidenceSpan);
        const vocalizationSpeaker = findStructuralActorVocalizationSpeaker({
            source: chars, quote, prefixStart, quoteSpans: quoteScan.spans,
        });
        if (vocalizationSpeaker) addQuoteCandidate({
            text: vocalizationSpeaker.text, ruleId: 'actor-vocalization-action',
        }, vocalizationSpeaker.speakerSpan, vocalizationSpeaker.evidenceSpan);

        // A pronoun-led turn may be resolved from a unique, nearby typed
        // subject before the generic narrative-frame fallback runs. The
        // evidence remains tied to the original subject text.
        const pronounBackreference = !writtenCarrierFrame ? findStructuralPronounBackreference({
            source: chars,
            quote,
            prefixStart,
            knownNames,
            anchors,
        }) : null;
        if (pronounBackreference) {
            addQuoteCandidate({ text: pronounBackreference.text, ruleId: 'pronoun-backreference' },
                pronounBackreference.speakerSpan,
                { start: pronounBackreference.speakerSpan.start, end: quote.start });
        }
        const postQuotePronounBackreference = !writtenCarrierFrame ? findStructuralPostQuotePronounBackreference({
            source: chars,
            quote,
            knownNames,
            anchors,
        }) : null;
        if (postQuotePronounBackreference) {
            addQuoteCandidate({ text: postQuotePronounBackreference.text, ruleId: 'pronoun-backreference' },
                postQuotePronounBackreference.speakerSpan,
                { start: quote.end, end: suffixEnd });
        }
        const entityPronounBackreference = !writtenCarrierFrame ? findStructuralEntityPronounBackreference({
            source: chars,
            quote,
            prefixStart,
            anchors,
            quotes: quoteScan.spans,
        }) : null;
        if (entityPronounBackreference) {
            addQuoteCandidate({ text: entityPronounBackreference.text, ruleId: 'pronoun-backreference' },
                entityPronounBackreference.speakerSpan,
                { start: entityPronounBackreference.speakerSpan.start, end: quote.start });
        }

        // A departing spirit can deliver one final first-person line after a
        // short, immediately preceding action sentence. Keep this narrow to
        // the spirit + farewell/action shape and a first-person return phrase.
        const spiritReturnSpeaker = !writtenCarrierFrame ? findStructuralSpiritReturnSpeaker({
            source: chars,
            quote,
        }) : null;
        if (spiritReturnSpeaker) {
            addQuoteCandidate({ text: spiritReturnSpeaker.text, ruleId: 'spirit-return-utterance' },
                spiritReturnSpeaker.speakerSpan,
                { start: spiritReturnSpeaker.speakerSpan.start, end: quote.start });
        }

        // A unique named actor who performs an action in the immediately
        // preceding sentence can own a following standalone quote. This is a
        // deliberately local display heuristic; it does not create identity
        // or carry across a scene break.
        const recentActionSpeaker = !writtenCarrierFrame ? findStructuralRecentActionSpeaker({
            source: chars,
            quote,
            prefixStart,
            suffixEnd,
            knownNames,
            anchors,
        }) : null;
        if (recentActionSpeaker) {
            addQuoteCandidate({ text: recentActionSpeaker.text, ruleId: 'recent-action-backreference' },
                recentActionSpeaker.speakerSpan,
                { start: recentActionSpeaker.speakerSpan.start, end: quote.start });
        }
        const namedReactionSpeaker = !writtenCarrierFrame ? findStructuralNamedReactionSpeaker({
            source: chars,
            quote,
            anchors,
            knownNames,
        }) : null;
        if (namedReactionSpeaker) {
            addQuoteCandidate({ text: namedReactionSpeaker.text, ruleId: 'named-reaction-backreference' },
                namedReactionSpeaker.speakerSpan,
                { start: namedReactionSpeaker.speakerSpan.start, end: quote.start });
        }
        const quotedCharacterReaction = !writtenCarrierFrame ? findStructuralQuotedCharacterReactionSpeaker({
            source: chars,
            quote,
            prefixStart,
            suffixEnd,
            knownNames,
        }) : null;
        if (quotedCharacterReaction) {
            addQuoteCandidate({ text: quotedCharacterReaction.text, ruleId: 'quoted-character-reaction' },
                quotedCharacterReaction.speakerSpan,
                { start: quote.end, end: suffixEnd });
        }
        const selfIdentifiedCreature = /^(?:龙|巨龙|冰霜巨龙)$/u.test(prefixSpeaker?.text || '')
            ? findStructuralSelfIdentifiedDragonSpeaker({ source: chars, quote, prefixStart }) : null;
        if (selfIdentifiedCreature) addQuoteCandidate({
            text: selfIdentifiedCreature.text,
            ruleId: 'self-identified-creature',
        }, selfIdentifiedCreature.speakerSpan, { start: prefixStart, end: quote.end });
        const nearbyDragonSpeaker = !writtenCarrierFrame ? findStructuralNearbyDragonSpeaker({
            source: chars,
            quote,
            anchors,
            quoteSpans: quoteScan.spans,
        }) : null;
        if (nearbyDragonSpeaker) addQuoteCandidate({
            text: nearbyDragonSpeaker.text,
            ruleId: 'bounded-dragon-name-backreference',
        }, nearbyDragonSpeaker.speakerSpan, nearbyDragonSpeaker.speakerSpan.start >= quote.end
            ? { start: quote.end, end: nearbyDragonSpeaker.speakerSpan.end }
            : { start: nearbyDragonSpeaker.speakerSpan.start, end: quote.start });

        // If the quote has no quote-attached explicit signature, inspect at
        // most two adjacent sentences for an explicit named speech tag. The
        // helper blocks unrelated neighboring quote turns and gives a direct
        // post-quote tag priority over older context; plain name mentions and
        // action-only subjects never enter this candidate set.
        if (quote.closed && !writtenCarrierFrame
            && !quoteCandidates.some((candidate) => candidate.evidenceRank === 0)) {
            for (const candidate of findStructuralExpandedExplicitQuoteSignatures({
                source: chars, quote, quotes: quoteScan.allSpans, knownNames,
            })) {
                addQuoteCandidate({ text: candidate.text, ruleId: 'expanded-explicit-signature' },
                    candidate.speakerSpan, candidate.evidenceSpan);
            }
        }

        // Last-resort recovery: only when every existing quote-local rule
        // produced no candidate, allow one adjacent sentence to complete a
        // rostered name + speech-cue construction. Mere nearby names never
        // qualify; competing or interrupted signatures abstain.
        if (parserVersion === 'full-message-speaker-index.v70'
            && quote.closed && !writtenCarrierFrame && quoteCandidates.length === 0) {
            const candidate = findStructuralAdjacentKnownNameSpeechCue({
                source: chars, quote, quotes: quoteScan.allSpans, knownNames,
            });
            if (candidate) addQuoteCandidate({ text: candidate.text, ruleId: 'adjacent-name-speech-cue-fallback' },
                candidate.speakerSpan, candidate.evidenceSpan);
        }
        const v84WeakLocalActorRules = new Set([
            'unrostered-action-attribution', 'unrostered-subject-colon-quote', 'leading-named-subject-colon-quote',
            'named-subject-colon-quote', 'rostered-subject-quoted-clause', 'local-speech-cue',
            'ranked-unique-action-subject',
        ]);
        const v84CanReviewLocalActor = quoteCandidates.length === 0
            || quoteCandidates.every((candidate) => v84WeakLocalActorRules.has(candidate.ruleId));
        let v84LocalActorConflict = false;
        if (isStructuralParserVersionAtLeast(parserVersion, 84) && quote.closed && !writtenCarrierFrame
            && v84CanReviewLocalActor) {
            const boundedActor = findStructuralV84BoundedActorQuoteSubject({
                source: chars, quote, prefixStart, knownNames, quoteSpans: quoteScan.allSpans,
                allowCompoundRole: isStructuralParserVersionAtLeast(parserVersion, 85),
                allowCompoundRoleConflict: isStructuralParserVersionAtLeast(parserVersion, 86),
            });
            if (boundedActor?.status === 'conflict') {
                quoteCandidates.splice(0, quoteCandidates.length);
                v84LocalActorConflict = true;
                v84BlockedQuoteIds.add(quote.quoteId);
                speaker = null;
                speakerSpan = null;
                attributionSpan = null;
                ruleId = null;
            } else if (boundedActor) {
                quoteCandidates.splice(0, quoteCandidates.length);
                addQuoteCandidate({ text: boundedActor.text, displayText: boundedActor.displayText, ruleId: boundedActor.ruleId },
                    boundedActor.speakerSpan, boundedActor.evidenceSpan);
            }
        }
        // v71 is roster-independent: a name in the grammatical subject
        // position can be recovered from the local quote-introducing clause.
        // This remains a last-resort display title and never overrides an
        // existing quote candidate.
        if (isStructuralParserVersionAtLeast(parserVersion, 71)
            && quote.closed && !writtenCarrierFrame && !v84LocalActorConflict && quoteCandidates.length === 0) {
            let introduced = findStructuralUnrosteredQuoteIntroducerSubject({
                source: chars, quote, prefixStart, knownNames,
            });
            if (introduced) addQuoteCandidate({ text: introduced.text, displayText: introduced.displayText, ruleId: introduced.ruleId },
                introduced.speakerSpan, introduced.evidenceSpan);
            if (!quoteCandidates.length) {
                const adjacent = findStructuralAdjacentKnownNameSpeechCue({
                    source: chars, quote, quotes: quoteScan.allSpans, knownNames, allowUnrostered: true,
                });
                if (adjacent) addQuoteCandidate({ text: adjacent.text, displayText: adjacent.displayText, ruleId: 'adjacent-name-speech-cue-fallback' },
                    adjacent.speakerSpan, adjacent.evidenceSpan);
            }
            if (!quoteCandidates.length && !isStructuralParserVersionAtLeast(parserVersion, 73)) {
                const mentioned = findStructuralAdjacentKnownNameMention({
                    source: chars, quote, quotes: quoteScan.allSpans, knownNames,
                });
                if (mentioned) addQuoteCandidate({ text: mentioned.text, ruleId: 'nearby-known-name-mention-fallback' },
                    mentioned.speakerSpan, mentioned.evidenceSpan);
            }
        }
        if (!v84LocalActorConflict && isStructuralParserVersionV76(parserVersion) && quote.closed && !writtenCarrierFrame
            && (!quoteCandidates.length || quoteCandidates.every((candidate) => (
                candidate.ruleId === 'ranked-unique-action-subject'
            )))) {
            const leadingSubject = findStructuralLeadingNamedSubjectBeforeColonQuote({
                source: chars, quote, prefixStart, knownNames,
            }) || (isStructuralParserVersionV77(parserVersion)
                ? findStructuralLeadingActionActorBeforeColonQuoteV77({ source: chars, quote, prefixStart, knownNames })
                : null);
            if (leadingSubject) addQuoteCandidate({
                text: leadingSubject.text,
                displayText: leadingSubject.displayText,
                ruleId: 'leading-named-subject-colon-quote',
            }, leadingSubject.speakerSpan, leadingSubject.evidenceSpan);
        }
        // v73 replaces the broad nearby-name guess with a bounded anaphora
        // rule. A local pronoun must itself introduce a direct speech cue; the
        // antecedent must be the unique recent explicit speaker or unique
        // named action subject, with no intervening quote or scene boundary.
        if (!v84LocalActorConflict && isStructuralParserVersionAtLeast(parserVersion, 73)
            && quote.closed && !writtenCarrierFrame && quoteCandidates.length === 0) {
            const pronounCueSpeaker = findStructuralPronounCueActionAntecedent({
                source: chars, quote, quotes: quoteScan.allSpans, anchors, knownNames,
            });
            if (pronounCueSpeaker) addQuoteCandidate({
                text: pronounCueSpeaker.text, ruleId: 'pronoun-cue-nearby-unique-actor',
            }, pronounCueSpeaker.speakerSpan, pronounCueSpeaker.evidenceSpan);
        }

        if (!v84LocalActorConflict && isStructuralParserVersionV76(parserVersion) && quote.closed && !writtenCarrierFrame && quoteCandidates.length === 0) {
            const continuation = findStructuralPronounLedQuoteContinuation({
                source: chars,
                quote,
                quotes: quoteScan.spans,
                anchors,
            });
            if (continuation) addQuoteCandidate({
                text: continuation.text,
                ruleId: 'same-speaker-pronoun-quote-continuation',
            }, continuation.speakerSpan, continuation.evidenceSpan);
        }

        const quoteResolution = resolveStructuralQuoteSpeakerCandidates(quoteCandidates);
        quoteResolutionById.set(quote.quoteId, quoteResolution.status === 'selected' ? {
            status: 'selected', rank: quoteResolution.rank,
            candidate: {
                speakerText: quoteResolution.candidate.speakerText,
                displaySpeakerText: quoteResolution.candidate.displaySpeakerText,
                speakerSpan: { ...quoteResolution.candidate.speakerSpan },
                evidenceSpan: { ...quoteResolution.candidate.evidenceSpan },
                sourceRegion: quoteResolution.candidate.sourceRegion,
                syntaxRole: quoteResolution.candidate.syntaxRole,
                ruleId: quoteResolution.candidate.ruleId,
                evidenceRank: quoteResolution.candidate.evidenceRank,
            },
        } : { status: quoteResolution.status, rank: quoteResolution.rank });
        if (quoteResolution.status === 'conflict') {
            unresolvedDialogueSpans.push({
                start: utterance?.start ?? quote.start,
                end: utterance?.end ?? quote.end,
                quoteStart: quote.start,
                quoteEnd: quote.end,
                quoteClosed: quote.closed,
                quoteId: quote.quoteId,
                reasonId: 'conflicting-quoted-attribution',
            });
            continue;
        }
        if (quoteResolution.status === 'selected') {
            const selected = quoteResolution.candidate;
            speaker = {
                text: selected.speakerText,
                displayText: selected.displaySpeakerText,
                ruleId: selected.ruleId,
                groupMembers: selected.groupMembers,
            };
            speakerSpan = selected.speakerSpan;
            attributionSpan = selected.evidenceSpan;
            ruleId = selected.ruleId;
        }

        // Standalone onomatopoeia is narration unless a direct speaker anchor
        // explicitly owns it. Do this before nearby-speaker continuation so a
        // sound effect cannot inherit the previous actor by accident.
        if (isStructuralNarrativeInformationFrame(chars, quote, prefixStart, suffixEnd, speaker)
            || readoutCarrierFrameV78) continue;

        // Quoted words inside an ordinary prose sentence (a title, item name,
        // or cited phrase) are not automatically dialogue. An unattributed
        // quote is speech evidence only when it is standalone or adjacent to
        // a direct speech cue / speaker-shaped line label.
        if (!speaker && !isStructuralQuotedUtterance(chars, quote, prefixStart, suffixEnd)) continue;

        if (!speaker || !speakerSpan || !utterance) {
            unresolvedDialogueSpans.push({
                start: utterance?.start ?? quote.start,
                end: utterance?.end ?? quote.end,
                quoteStart: quote.start,
                quoteEnd: quote.end,
                quoteClosed: quote.closed,
                quoteId: quote.quoteId,
                reasonId: (isStructuralParserVersionV77(parserVersion)
                    ? isStructuralAnonymousFirstAppearanceV77(chars, quote, prefixStart, suffixEnd)
                    : isStructuralAnonymousFirstAppearance(chars, quote, prefixStart, suffixEnd))
                    || (isStructuralParserVersionV77(parserVersion) && isStructuralAnonymousPostQuoteSpeaker(chars, quote))
                    || (isStructuralParserVersionV77(parserVersion)
                        && hasAnonymousPronounActionQuoteContinuation(chars, quote, unresolvedDialogueSpans,
                            quoteScan.spans, anchors))
                    || isStructuralUnidentifiedDragonSpeech({ source: chars, quote, quoteSpans: quoteScan.spans })
                    ? 'anonymous-first-appearance' : 'unattributed-quoted-speech',
            });
            continue;
        }
        const groupMembers = Array.isArray(speaker.groupMembers) ? speaker.groupMembers : null;
        if (groupMembers?.length > 1) {
            const groupId = `${sourceMessageIndex}:${quote.start}:${quote.end}`;
            for (const member of groupMembers) {
                anchors.push({
                    speakerText: member.text,
                    displaySpeakerText: member.text,
                    speakerSpan: { start: prefixStart + member.start, end: prefixStart + member.end },
                    utteranceSpans: [utterance],
                    attributionSpan,
                    ruleId: ruleId || 'named-group-report-attribution',
                    quoteId: quote.quoteId,
                    quoteSpan: { start: quote.start, end: quote.end },
                    groupId,
                    certainty: 'explicit',
                });
            }
        } else {
            anchors.push({
                speakerText: speaker.text,
                displaySpeakerText: speaker.displayText || speaker.text,
                speakerSpan,
                utteranceSpans: [utterance],
                attributionSpan,
                ruleId: ruleId || 'quoted-attribution',
                quoteId: quote.quoteId,
                quoteSpan: { start: quote.start, end: quote.end },
                certainty: 'explicit',
            });
        }
    }

    for (const label of lineLabels) {
        if (!label.utteranceSpan || !trimStructuralSourceSpan(chars, label.utteranceSpan.start, label.utteranceSpan.end)) continue;
        if ([...v84BlockedQuoteIds].some((quoteId) => {
            const blocked = quoteScan.spans.find((quote) => quote.quoteId === quoteId);
            return blocked && label.start <= blocked.start && label.utteranceSpan.end >= blocked.end;
        })) continue;
        if (quoteScan.spans.some((quote) => quote.start < label.start && label.start < quote.end)) continue;
        // A label that introduces quoted text is used only as a fallback
        // attribution for that quote above; avoid adding a duplicate line unit.
        if (quoteScan.spans.some((quote) => label.utteranceSpan.start <= quote.start && label.utteranceSpan.end >= quote.end)) continue;
        const utterance = trimStructuralSourceSpan(chars, label.utteranceSpan.start, label.utteranceSpan.end);
        if (!utterance) continue;
        anchors.push({
            speakerText: label.text,
            speakerSpan: { start: label.start, end: label.end },
            utteranceSpans: [utterance],
            attributionSpan: { start: label.start, end: label.classificationEvidenceSpan.end },
            ruleId: label.ruleId,
            certainty: 'explicit',
        });
    }

    const deduplicatedAnchors = deduplicateStructuralMessageAnchors(anchors);
    for (const anchor of deduplicatedAnchors) {
        const quote = quoteEvidence.find((item) => item.quoteId === anchor.quoteId);
        const evidenceSpan = anchor.attributionSpan;
        anchor.sourceRegion = anchor.ruleId === 'prior-page-action-subject-continuation' ? 'previous-existing-page'
            : evidenceSpan && quote && evidenceSpan.start < quote.quoteSpan.start ? 'before-quote'
                : evidenceSpan && quote && evidenceSpan.start >= quote.quoteSpan.end ? 'after-quote'
                    : 'quote-context';
        anchor.syntaxRole = structuralQuoteSyntaxRole(anchor.ruleId);
    }
    for (const evidence of quoteEvidence) {
        const quoteResolution = quoteResolutionById.get(evidence.quoteId);
        const selected = deduplicatedAnchors.find((anchor) => anchor.quoteId === evidence.quoteId);
        const unresolved = unresolvedDialogueSpans.find((span) => span.quoteId === evidence.quoteId);
        evidence.decision = selected ? {
            status: 'attributed',
            speakerText: selected.speakerText,
            displaySpeakerText: selected.displaySpeakerText || selected.speakerText,
            speakerSpan: { ...selected.speakerSpan },
            evidenceSpan: selected.attributionSpan ? { ...selected.attributionSpan } : null,
            sourceRegion: selected.sourceRegion,
            syntaxRole: selected.syntaxRole,
            evidenceRank: structuralQuoteSpeakerEvidenceRank(selected.ruleId),
            ruleId: selected.ruleId,
        } : unresolved ? {
            status: 'unresolved',
            evidenceSpan: { start: unresolved.start, end: unresolved.end },
            sourceRegion: 'quote-context',
            syntaxRole: 'unresolved-speaker',
            ...(unresolved.reasonId === 'conflicting-quoted-attribution'
                ? { evidenceRank: quoteResolution?.rank ?? null } : {}),
            reasonId: unresolved.reasonId,
        } : { status: 'no-dialogue-evidence', sourceRegion: 'quote-context', syntaxRole: 'none' };
    }
    unresolvedDialogueSpans.sort((left, right) => left.start - right.start || left.end - right.end);
    return {
        sourceMessageIndex,
        sourceMessageHash,
        publishedSpeakerFingerprint: String(publishedSpeakerFingerprint || ''),
        parserVersion,
        sourceLength: chars.length,
        quoteEvidence,
        dialogueCandidateSpans,
        anchors: deduplicatedAnchors,
        unresolvedDialogueSpans,
        scanStatus: quoteScan.ambiguousSpans.length ? 'ambiguous' : 'complete',
    };
}

/**
 * Derive a bounded chat-local display-name lexicon from repeated explicit
 * speaker evidence. Two distinct prior message positions are required; the
 * scope expires after eight inputs and resets at an opening scene/title. The
 * names never carry speaker ownership or pronouns and never become identity
 * or resource bindings; the target message still needs its own local cue.
 */
export function createChatLocalObservedSpeakerNameScopes({
    messages = [],
    publishedSpeakerNames = [],
    minimumDistinctMessages = 2,
} = {}) {
    if (!Array.isArray(messages) || !Number.isSafeInteger(minimumDistinctMessages)
        || minimumDistinctMessages < 2 || minimumDistinctMessages > 10) return [];
    const publishedNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))];
    const publishedKeys = new Set(publishedNames.map((name) => name.normalize('NFC').toLocaleLowerCase()));
    const supportByName = new Map();
    const observedNamesAtCursor = [];
    const maxLookbackMessages = 8;
    const eligibleRules = new Set([
        'known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution',
        'rostered-subject-quoted-clause',
    ]);
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        const text = typeof message?.visibleText === 'string' ? message.visibleText : '';
        if (isChatLocalObservedSpeakerSceneBoundary(text)) supportByName.clear();
        const oldestAllowedPosition = index - maxLookbackMessages;
        for (const [key, value] of supportByName) {
            for (const [sourceMessageIndex, position] of value.messages) {
                if (position < oldestAllowedPosition) value.messages.delete(sourceMessageIndex);
            }
            if (!value.messages.size) supportByName.delete(key);
        }
        observedNamesAtCursor.push([...supportByName.entries()]
            .filter(([key, value]) => value.messages.size >= minimumDistinctMessages && !publishedKeys.has(key))
            .map(([, value]) => value.text)
            .sort((left, right) => left.localeCompare(right)));
        const sourceMessageIndex = Number.isSafeInteger(message?.sourceMessageIndex) && message.sourceMessageIndex >= 0
            ? message.sourceMessageIndex : index;
        if (!text.trim()) continue;
        const evidence = createStructuralMessageSpeakerIndex({
            fullText: text,
            publishedSpeakerNames: publishedNames,
            publishedSpeakerFingerprint: '',
            sourceMessageIndex,
            // This preliminary index is used only to count explicit evidence;
            // its synthetic digest is never persisted or projected to a page.
            sourceMessageHash: typeof message?.sourceMessageHash === 'string' && message.sourceMessageHash.trim()
                ? message.sourceMessageHash : `observed-speaker-scan:${sourceMessageIndex}`,
            parserVersion: 'chat-local-observed-speakers.v1',
        });
        for (const anchor of evidence.anchors || []) {
            if (!eligibleRules.has(anchor.ruleId) || typeof anchor.speakerText !== 'string' || !anchor.speakerText.trim()) continue;
            const speaker = anchor.speakerText.trim();
            const utteranceText = (anchor.utteranceSpans || []).filter((span) => isValidStructuralPageSpan(span, Array.from(text).length))
                .map((span) => Array.from(text).slice(span.start, span.end).join('')).join('\n');
            if (isNonDialogueLabel(speaker) || isStructuralInformationLabel(speaker) || isGenericCharacterNoun(speaker)
                || isNarratorSpeaker(speaker) || !isLikelyInferredSpeakerName(speaker)
                || /^(?:效果|备注|風险|风险|优势|機械|机械|检定|判定|豁免|状态|属性|装备|背包|物品|道具|技能|能力|法术|经验|金币|生命|魔力|目标|地点|位置|事件|线索|证据|数据|结果|规则|说明|提示|统计|行动顺序|先攻顺序)$/u.test(speaker)
                || (utteranceText && isStructuralRecordShape(`${speaker}：${utteranceText}`))) continue;
            const key = speaker.normalize('NFC').toLocaleLowerCase();
            if (!supportByName.has(key)) supportByName.set(key, { text: speaker, messages: new Map() });
            supportByName.get(key).messages.set(sourceMessageIndex, index);
        }
    }
    observedNamesAtCursor.push([...supportByName.entries()]
        .filter(([key, value]) => value.messages.size >= minimumDistinctMessages && !publishedKeys.has(key))
        .map(([, value]) => value.text)
        .sort((left, right) => left.localeCompare(right)));
    return observedNamesAtCursor;
}

function isChatLocalObservedSpeakerSceneBoundary(value) {
    const firstLine = String(value ?? '').split(/\r?\n/u, 1)[0].trim();
    return Boolean(firstLine && (isLikelyStandalonePresentationHeading(firstLine)
        || isLikelyFirstPageSceneTitle(firstLine)
        || /^(?:新?场景|场景|scene|地点|location)\s*[:：]\s*\S+/iu.test(firstLine)));
}

export function createChatLocalObservedSpeakerNames(options = {}) {
    const scopes = createChatLocalObservedSpeakerNameScopes(options);
    return scopes.at(-1) || [];
}

/** Project a message index to one exact, already-existing display page span. */
export function createStructuralPageTitleEvidenceFromMessageIndex({
    messageIndex,
    fullText = '',
    sourceMessageIndex,
    sourceMessageHash = '',
    publishedSpeakerFingerprint = '',
    parserVersion = 'full-message-speaker-index.v84',
    coreSpan,
    pageType = 'narration',
    previousPageSpans = [],
    allowPlainNarration = true,
} = {}) {
    const chars = Array.from(String(fullText ?? ''));
    if (!Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
        || typeof sourceMessageHash !== 'string' || !sourceMessageHash.trim()
        || !isValidStructuralPageSpan(coreSpan, chars.length)
        || !messageIndex || messageIndex.scanStatus === 'invalid-source'
        || messageIndex.sourceMessageIndex !== sourceMessageIndex
        || messageIndex.sourceMessageHash !== sourceMessageHash
        || messageIndex.sourceLength !== chars.length
        || messageIndex.parserVersion !== parserVersion
        || messageIndex.publishedSpeakerFingerprint !== String(publishedSpeakerFingerprint || '')) return null;

    const core = { start: coreSpan.start, end: coreSpan.end };
    const knownPageSpans = [
        ...previousPageSpans.map((page) => page?.sourceSpan).filter((span) => isValidStructuralPageSpan(span, chars.length)),
        core,
    ];
    for (const quote of messageIndex.quoteEvidence || []) {
        if (!isValidStructuralPageSpan(quote?.quoteSpan, chars.length)) continue;
        const overlaps = knownPageSpans.filter((span) => span.start < quote.quoteSpan.end && quote.quoteSpan.start < span.end)
            .map((span) => ({ start: Math.max(span.start, quote.quoteSpan.start),
                end: Math.min(span.end, quote.quoteSpan.end) }));
        const uniqueOverlaps = new Map([...(quote.productionPageIntersections || []), ...overlaps]
            .map((span) => [`${span.start}:${span.end}`, span]));
        quote.productionPageIntersections = [...uniqueOverlaps.values()].sort((left, right) => left.start - right.start);
    }
    const pageShape = classifyStructuralPageShape({ fullText, pageType, coreSpan: core, messageIndex });
    const unresolvedSpansForPage = (messageIndex.unresolvedDialogueSpans || []).filter((span) => (
        isValidStructuralPageSpan(span, chars.length) && span.start < core.end && core.start < span.end
    ));
    const hasAnonymousFirstAppearanceOnPage = unresolvedSpansForPage.some((span) => (
        span?.reasonId === 'anonymous-first-appearance'
    ));
    const hasConflictingQuoteAttributionOnPage = unresolvedSpansForPage.some((span) => (
        span?.reasonId === 'conflicting-quoted-attribution'
    ));
    const explicitSpeakerOnPage = (messageIndex.anchors || []).some((anchor) => (
        anchor?.certainty === 'explicit' && Array.isArray(anchor.utteranceSpans)
        && anchor.utteranceSpans.some((span) => isValidStructuralPageSpan(span, chars.length)
            && span.start < core.end && core.start < span.end)
    ));
    const currentPageHasQuoteDecision = (messageIndex.quoteEvidence || []).some((quote) => (
        isValidStructuralPageSpan(quote?.quoteSpan, chars.length)
        && quote.quoteSpan.start < core.end && core.start < quote.quoteSpan.end
        && (quote.decision?.status === 'attributed'
            || (quote.decision?.status === 'unresolved'
                && quote.decision.reasonId === 'conflicting-quoted-attribution'))
    ));
    const allowSpeakerBridge = !currentPageHasQuoteDecision && !hasConflictingQuoteAttributionOnPage;
    const singleHeadingPronounOwner = allowSpeakerBridge
        ? findStructuralSpeakerAcrossSingleHeadingBridge({ messageIndex, chars, core }) : null;
    if (singleHeadingPronounOwner) {
        const speaker = {
            mentionRef: `display-only-${sourceMessageIndex}-${singleHeadingPronounOwner.speakerSpan.start}-${singleHeadingPronounOwner.speakerSpan.end}`,
            text: singleHeadingPronounOwner.displaySpeakerText || singleHeadingPronounOwner.speakerText,
            ...(singleHeadingPronounOwner.displaySpeakerText
                && singleHeadingPronounOwner.displaySpeakerText !== singleHeadingPronounOwner.speakerText
                ? { sourceText: singleHeadingPronounOwner.speakerText } : {}),
            start: singleHeadingPronounOwner.speakerSpan.start,
            end: singleHeadingPronounOwner.speakerSpan.end,
        };
        return {
            sourceMessageIndex,
            sourceMessageHash,
            viewSpan: { start: Math.min(core.start, speaker.start), end: core.end },
            coreSpan: core,
            classificationEvidenceSpans: [core],
            kind: 'speaker',
            text: speaker.text,
            speakers: [speaker],
            ruleId: 'pronoun-backreference',
        };
    }
    const recentPronounOwner = allowSpeakerBridge ? findStructuralRecentPronounSpeakerContinuation({
        messageIndex, chars, core, pageType, previousPageSpans,
    }) : null;
    if (recentPronounOwner) {
        const speaker = {
            mentionRef: `display-only-${sourceMessageIndex}-${recentPronounOwner.speakerSpan.start}-${recentPronounOwner.speakerSpan.end}`,
            text: recentPronounOwner.speakerText,
            start: recentPronounOwner.speakerSpan.start,
            end: recentPronounOwner.speakerSpan.end,
        };
        return {
            sourceMessageIndex,
            sourceMessageHash,
            viewSpan: { start: Math.min(core.start, speaker.start), end: core.end },
            coreSpan: core,
            classificationEvidenceSpans: [recentPronounOwner.quoteSpan],
            kind: 'speaker',
            text: speaker.text,
            speakers: [speaker],
            sourceRegion: 'previous-existing-page',
            syntaxRole: 'pronoun-reference',
            ruleId: recentPronounOwner.ruleId || 'recent-pronoun-speaker-continuation',
        };
    }
    const recentPageOwner = allowSpeakerBridge ? findStructuralRecentPageSpeakerContinuation({
        messageIndex, chars, core, pageType, previousPageSpans,
    }) : null;
    if (recentPageOwner && !hasAnonymousFirstAppearanceOnPage && !explicitSpeakerOnPage) {
        const speaker = {
            mentionRef: `display-only-${sourceMessageIndex}-${recentPageOwner.speakerSpan.start}-${recentPageOwner.speakerSpan.end}`,
            text: recentPageOwner.speakerText,
            start: recentPageOwner.speakerSpan.start,
            end: recentPageOwner.speakerSpan.end,
        };
        return {
            sourceMessageIndex,
            sourceMessageHash,
            viewSpan: { start: Math.min(core.start, speaker.start), end: core.end },
            coreSpan: core,
            classificationEvidenceSpans: [recentPageOwner.quoteSpan],
            kind: 'speaker',
            text: speaker.text,
            speakers: [speaker],
            sourceRegion: 'previous-existing-page',
            syntaxRole: structuralQuoteSyntaxRole(recentPageOwner.ruleId),
            ruleId: recentPageOwner.ruleId || 'recent-page-quote-speaker-continuation',
        };
    }
    const openUnresolvedSpan = unresolvedSpansForPage.find((span) => span.quoteClosed !== true);
    if (openUnresolvedSpan && !hasAnonymousFirstAppearanceOnPage && !explicitSpeakerOnPage) {
        if (isStructuralParserVersionAtLeast(parserVersion, 66)) {
            return buildStructuralNarratorFallbackEvidence('open-quote-without-unique-speaker',
                trimStructuralSourceSpan(chars, Math.max(core.start, openUnresolvedSpan.start),
                    Math.min(core.end, openUnresolvedSpan.end)),
                { sourceMessageIndex, sourceMessageHash, core });
        }
        return buildStructuralShapeClassificationEvidence({
            classification: 'unattributed-dialogue', text: '未识别', ruleId: 'unattributed-quoted-speech',
        }, trimStructuralSourceSpan(chars, Math.max(core.start, openUnresolvedSpan.start),
            Math.min(core.end, openUnresolvedSpan.end)), { sourceMessageIndex, sourceMessageHash, core });
    }
    if (isNarrativeShortCommandAfterOpeningHeading(chars, core) && !hasAnonymousFirstAppearanceOnPage) {
        const overlappingUnresolvedSpan = unresolvedSpansForPage[0];
        if (overlappingUnresolvedSpan && overlappingUnresolvedSpan.quoteClosed === true && !explicitSpeakerOnPage) {
            return buildStructuralNarratorFallbackEvidence('narrative-shape-with-unattributed-quote',
                trimStructuralSourceSpan(chars, Math.max(core.start, overlappingUnresolvedSpan.start),
                    Math.min(core.end, overlappingUnresolvedSpan.end)),
                { sourceMessageIndex, sourceMessageHash, core });
        }
        if (!overlappingUnresolvedSpan && !explicitSpeakerOnPage) return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-command-after-heading',
        }, pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    }
    if (pageShape.kind === 'structured-record' || pageShape.kind === 'heading') {
        const pageText = chars.slice(core.start, core.end).join('').trim();
        const isNumberedChoice = /^(?:选择|选项)\s*(?:[一二三四五六七八九十\d]+|[A-D])\s*[：:]\s*\S/iu.test(pageText);
        const gameMetadata = /^\([^()\r\n]{1,48}\)$/u.test(pageText)
            && /\b(?:campaign|scenario|session|module|game|adventure)\b/iu.test(pageText);
        const mapping = pageShape.kind === 'structured-record'
            ? isNumberedChoice
                ? { classification: 'choice', text: '选项', ruleId: 'structural-record-shape' }
                : { classification: 'narration', text: '旁白', ruleId: 'structural-record-shape' }
            : gameMetadata
                ? { classification: 'narration', text: '旁白', ruleId: 'structural-game-metadata' }
                : { classification: 'other-visible', text: '标题', ruleId: 'structural-heading-shape' };
        return buildStructuralShapeClassificationEvidence(mapping, pageShape.evidenceSpan, {
            sourceMessageIndex, sourceMessageHash, core,
        });
    }
    if (pageShape.kind === 'narrative' && isNarrativeProgressionPromptQuote(chars.slice(core.start, core.end).join(''))) {
        return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-progression-prompt',
        }, pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    }
    if (pageShape.kind === 'narrative' && isNarrativeSoundEffectQuote(chars.slice(core.start, core.end).join(''))) {
        return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-sound-effect',
        }, pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    }
    const pageText = chars.slice(core.start, core.end).join('').trim();
    const firstVisibleOffset = chars.findIndex((char) => !/\s/u.test(char));
    const coreStartsAtFirstVisible = firstVisibleOffset >= 0
        && chars.slice(0, core.start).every((char) => /\s/u.test(char))
        && core.end > firstVisibleOffset;
    const explicitProgressionHeading = /^#{1,6}\s+\S/u.test(pageText);
    if (pageShape.kind === 'narrative'
        && (isLikelyStandalonePresentationHeading(pageText) || isLikelyFirstPageSceneTitle(pageText) || explicitProgressionHeading)
        && !coreStartsAtFirstVisible) {
        return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-heading-outside-opening',
        }, pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    }
    const unresolvedClosedQuote = unresolvedSpansForPage.length === 1
        && unresolvedSpansForPage[0].quoteClosed === true
        ? unresolvedSpansForPage[0] : null;
    if (isStructuralParserVersionAtLeast(parserVersion, 56)
        && !hasAnonymousFirstAppearanceOnPage && !explicitSpeakerOnPage && unresolvedClosedQuote
        && !findStructuralPageLocalSpeakerCue(chars, core)
        && hasAnonymousReportedSpeechContinuation(chars, unresolvedClosedQuote, messageIndex)) {
        return buildStructuralShapeClassificationEvidence({
            classification: 'unattributed-dialogue', text: '？？？', ruleId: 'anonymous-first-appearance',
        }, trimStructuralSourceSpan(chars, Math.max(core.start, unresolvedClosedQuote.start),
            Math.min(core.end, unresolvedClosedQuote.end)), { sourceMessageIndex, sourceMessageHash, core });
    }
    if (pageShape.kind === 'narrative' && !hasAnonymousFirstAppearanceOnPage && !explicitSpeakerOnPage
        && (hasNarrativeReportedQuoteCluster(chars.slice(core.start, core.end).join())
            || hasNarrativeFramedUnattributedQuote(chars.slice(core.start, core.end).join()))) {
        const unresolvedQuoteSpan = (messageIndex.unresolvedDialogueSpans || []).find((span) => (
            isValidStructuralPageSpan(span, chars.length) && span.start < core.end && core.start < span.end
        ));
        const explicitlyAttributedOnPage = (messageIndex.anchors || []).some((anchor) => (
            anchor?.certainty === 'explicit' && Array.isArray(anchor.utteranceSpans)
            && anchor.utteranceSpans.some((span) => isValidStructuralPageSpan(span, chars.length)
                && span.start < core.end && core.start < span.end)
        ));
        if (unresolvedQuoteSpan && unresolvedQuoteSpan.quoteClosed === true && !explicitlyAttributedOnPage) {
            return buildStructuralNarratorFallbackEvidence('narrative-shape-with-unattributed-quote',
                trimStructuralSourceSpan(chars, Math.max(core.start, unresolvedQuoteSpan.start),
                    Math.min(core.end, unresolvedQuoteSpan.end)),
                { sourceMessageIndex, sourceMessageHash, core });
        }
        if (!unresolvedQuoteSpan) return buildStructuralShapeClassificationEvidence({
            classification: 'narration', text: '旁白', ruleId: 'narrative-framed-quote',
        }, pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    }
    const speechUnits = [];
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || typeof anchor.speakerText !== 'string'
            || !anchor.speakerText.trim() || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText
            || !Array.isArray(anchor.utteranceSpans)) continue;
        for (const span of anchor.utteranceSpans) {
            if (!isValidStructuralPageSpan(span, chars.length)) continue;
            const start = Math.max(core.start, span.start);
            const end = Math.min(core.end, span.end);
            const overlap = trimStructuralSourceSpan(chars, start, end);
            if (overlap) speechUnits.push({
                anchor, speakerText: anchor.speakerText,
                displaySpeakerText: anchor.displaySpeakerText || anchor.speakerText,
                speakerSpan: anchor.speakerSpan, groupId: anchor.groupId,
                ruleId: anchor.ruleId, overlap, span,
            });
        }
    }
    let pageLocalQuoteConflict = false;
    let pageLocalConflictSpan = null;
    const pageCue = findStructuralPageLocalSpeakerCue(chars, core);
    if (pageCue?.directCue) {
        const targetQuotes = (messageIndex.quoteEvidence || []).filter((quote) => (
            isValidStructuralPageSpan(quote?.quoteSpan, chars.length)
            && quote.quoteSpan.start === pageCue.quoteStart
            && quote.quoteSpan.start < core.end && core.start < quote.quoteSpan.end
        ));
        if (targetQuotes.length === 1) {
            const quote = targetQuotes[0];
            const resolution = resolvePageLocalQuoteSpeakerCue(quote, pageCue, parserVersion);
            if (resolution.status === 'conflict') {
                pageLocalQuoteConflict = true;
                pageLocalConflictSpan = quote.quoteSpan;
                for (let index = speechUnits.length - 1; index >= 0; index -= 1) {
                    if (speechUnits[index].anchor?.quoteId === quote.quoteId) speechUnits.splice(index, 1);
                }
            } else if (resolution.status === 'selected') {
                const selected = resolution.candidate;
                const overlap = trimStructuralSourceSpan(chars,
                    Math.max(core.start, quote.quoteSpan.start), Math.min(core.end, quote.quoteSpan.end));
                const existing = speechUnits.find((unit) => unit.anchor?.quoteId === quote.quoteId
                    && normalizeStructuralSpeakerKey(unit.speakerText) === normalizeStructuralSpeakerKey(selected.speakerText));
                if (overlap && !existing) speechUnits.push({
                    candidate: selected,
                    speakerText: selected.speakerText,
                    displaySpeakerText: selected.displaySpeakerText || selected.speakerText,
                    speakerSpan: selected.speakerSpan,
                    groupId: selected.groupId,
                    ruleId: selected.ruleId,
                    overlap,
                    span: quote.quoteSpan,
                });
            }
        }
    }

    // A quote cluster can span several already-existing display pages. Use
    // the full source message only to recognize its reported-news frame, then
    // classify the intersecting unresolved quote page as narration. Explicit
    // speaker evidence above remains stronger and page spans are untouched.
    const pageHasUnresolvedQuote = unresolvedSpansForPage.length > 0;
    if (!speechUnits.length && pageHasUnresolvedQuote && !hasAnonymousFirstAppearanceOnPage
        && hasNarrativeReportedQuoteCluster(chars.join(''))) {
        const unresolvedQuoteSpan = (messageIndex.unresolvedDialogueSpans || []).find((span) => (
            isValidStructuralPageSpan(span, chars.length) && span.start < core.end && core.start < span.end
        ));
        if (unresolvedQuoteSpan.quoteClosed === true) {
            return buildStructuralNarratorFallbackEvidence('narrative-shape-with-unattributed-quote',
                trimStructuralSourceSpan(chars, Math.max(core.start, unresolvedQuoteSpan.start),
                    Math.min(core.end, unresolvedQuoteSpan.end)),
                { sourceMessageIndex, sourceMessageHash, core });
        }
    }

    const unresolvedEvidenceSpans = [...new Map((messageIndex.unresolvedDialogueSpans || [])
        .filter((span) => isValidStructuralPageSpan(span, chars.length) && span.start < core.end && core.start < span.end)
        .map((span) => trimStructuralSourceSpan(chars, Math.max(core.start, span.start), Math.min(core.end, span.end)))
        .filter(Boolean)
        .map((span) => [`${span.start}:${span.end}`, span]))
        .values()].sort((left, right) => left.start - right.start);
    const hasUnresolvedSpeech = unresolvedEvidenceSpans.length > 0;
    const projectedSpeechUnits = preferMoreLocalStructuralSpeakerEvidence(speechUnits);
    const hasConflictingSpeakerOverlap = projectedSpeechUnits.some((unit, index) => projectedSpeechUnits.slice(index + 1).some((other) => (
        unit.overlap.start < other.overlap.end && other.overlap.start < unit.overlap.end
        && normalizeStructuralSpeakerKey(unit.speakerText) !== normalizeStructuralSpeakerKey(other.speakerText)
        && (!unit.groupId || unit.groupId !== other.groupId)
    )));
    if (pageLocalQuoteConflict) {
        const conflictQuoteSpan = trimStructuralSourceSpan(chars,
            Math.max(core.start, pageLocalConflictSpan.start), Math.min(core.end, pageLocalConflictSpan.end));
        return buildStructuralNarratorFallbackEvidence('conflicting-speaker-evidence', conflictQuoteSpan, {
            sourceMessageIndex, sourceMessageHash, core,
        });
    }
    if (hasConflictingSpeakerOverlap) {
        const left = projectedSpeechUnits.find((unit, index) => projectedSpeechUnits.slice(index + 1).some((other) => (
            unit.overlap.start < other.overlap.end && other.overlap.start < unit.overlap.end
            && normalizeStructuralSpeakerKey(unit.speakerText) !== normalizeStructuralSpeakerKey(other.speakerText)
            && (!unit.groupId || unit.groupId !== other.groupId)
        )));
        const right = left && projectedSpeechUnits.slice(projectedSpeechUnits.indexOf(left) + 1).find((other) => (
            left.overlap.start < other.overlap.end && other.overlap.start < left.overlap.end
            && normalizeStructuralSpeakerKey(left.speakerText) !== normalizeStructuralSpeakerKey(other.speakerText)
            && (!left.groupId || left.groupId !== other.groupId)
        ));
        const conflictSpan = left && right ? trimStructuralSourceSpan(chars,
            Math.max(core.start, left.overlap.start, right.overlap.start),
            Math.min(core.end, left.overlap.end, right.overlap.end)) : unresolvedEvidenceSpans[0];
        return buildStructuralNarratorFallbackEvidence('conflicting-speaker-evidence', conflictSpan, {
            sourceMessageIndex, sourceMessageHash, core,
        });
    }

    // Unresolved quotes do not create a speaker identity. Keep explicit
    // anonymous introductions as `？？？`, keep first-person self-introduction
    // unknown, and otherwise use the user's accepted narrator fallback when
    // no unique local/upstream actor can be established.
    if (hasUnresolvedSpeech && !projectedSpeechUnits.length) {
        const anonymousFirstAppearance = (messageIndex.unresolvedDialogueSpans || []).some((span) => (
            span?.reasonId === 'anonymous-first-appearance'
            && span.start < core.end && core.start < span.end
        ));
        const selfIntroduction = unresolvedEvidenceSpans.some((span) => (
            isStructuralFirstPersonIntroduction(chars.slice(span.start, span.end).join(''))
        ));
        if (anonymousFirstAppearance) {
            return {
                sourceMessageIndex,
                sourceMessageHash,
                viewSpan: core,
                coreSpan: core,
                classificationEvidenceSpans: unresolvedEvidenceSpans,
                kind: 'classification',
                classification: 'unattributed-dialogue',
                text: '？？？',
                speakers: [],
                ruleId: 'anonymous-first-appearance',
            };
        }
        // The page classifier has already marked these quote-bearing words as
        // narrative (rather than a dialogue candidate). Respect that coarse
        // result after preserving anonymous first appearances; do not turn a
        // narrative action frame into an unresolved speaker solely because it
        // contains punctuation used for quoted text.
        const allUnresolvedQuotesClosed = (messageIndex.unresolvedDialogueSpans || [])
            .filter((span) => isValidStructuralPageSpan(span, chars.length)
                && span.start < core.end && core.start < span.end)
            .every((span) => span.quoteClosed === true);
        const unresolvedPageText = chars.slice(core.start, core.end).join('');
        const localEntityOwner = findStructuralLocalEntityOwnerForPage({
            messageIndex,
            chars,
            core,
        });
        if (localEntityOwner) {
            const speaker = {
                mentionRef: `display-only-${sourceMessageIndex}-${localEntityOwner.speakerSpan.start}-${localEntityOwner.speakerSpan.end}`,
                text: localEntityOwner.displaySpeakerText || localEntityOwner.speakerText,
                ...(localEntityOwner.displaySpeakerText
                    && localEntityOwner.displaySpeakerText !== localEntityOwner.speakerText
                    ? { sourceText: localEntityOwner.speakerText } : {}),
                displayText: localEntityOwner.displaySpeakerText || localEntityOwner.speakerText,
                start: localEntityOwner.speakerSpan.start,
                end: localEntityOwner.speakerSpan.end,
            };
            return {
                sourceMessageIndex,
                sourceMessageHash,
                viewSpan: { start: Math.min(core.start, speaker.start), end: Math.max(core.end, speaker.end) },
                coreSpan: core,
                classificationEvidenceSpans: unresolvedEvidenceSpans,
                kind: 'speaker',
                text: speaker.displayText,
                speakers: [speaker],
                ruleId: 'pronoun-backreference',
            };
        }
        if (!selfIntroduction && allUnresolvedQuotesClosed
            && isNarrativeCoordinatedActionQuote(chars.slice(core.start, core.end).join())) {
            return buildStructuralNarratorFallbackEvidence('narrative-shape-with-unattributed-quote',
                unresolvedEvidenceSpans[0], { sourceMessageIndex, sourceMessageHash, core });
        }
        if (pageShape.kind === 'narrative' && !selfIntroduction && allUnresolvedQuotesClosed) {
            return buildStructuralNarratorFallbackEvidence('narrative-shape-with-unattributed-quote',
                unresolvedEvidenceSpans[0], { sourceMessageIndex, sourceMessageHash, core });
        }
        if (isUnresolvedEntityReferenceOrShortReaction(unresolvedPageText)) {
            return buildStructuralNarratorFallbackEvidence('ambiguous-local-reference',
                unresolvedEvidenceSpans[0], { sourceMessageIndex, sourceMessageHash, core });
        }
        if (selfIntroduction) {
            return {
                sourceMessageIndex,
                sourceMessageHash,
                viewSpan: core,
                coreSpan: core,
                classificationEvidenceSpans: unresolvedEvidenceSpans,
                kind: 'classification',
                classification: 'unattributed-dialogue',
                text: '？？？',
                speakers: [],
                ruleId: 'unknown-self-introduction',
            };
        }
        const matchingUnresolved = (messageIndex.unresolvedDialogueSpans || []).filter((span) => (
            isValidStructuralPageSpan(span, chars.length) && span.start < core.end && core.start < span.end
        ));
        const diagnosticReasonId = matchingUnresolved.some((span) => span.reasonId === 'quote-scan-ambiguous')
            ? 'ambiguous-quote-structure'
            : matchingUnresolved.some((span) => span.quoteClosed === false)
                ? 'open-quote-without-unique-speaker'
                : isUnresolvedEntityReferenceOrShortReaction(unresolvedPageText)
                    ? 'ambiguous-local-reference' : 'no-unique-speaker-evidence';
        return buildStructuralNarratorFallbackEvidence(diagnosticReasonId,
            unresolvedEvidenceSpans[0] || trimStructuralSourceSpan(chars, core.start, core.end),
            { sourceMessageIndex, sourceMessageHash, core });
    }

    if (projectedSpeechUnits.length) {
        const unique = new Map();
        for (const unit of projectedSpeechUnits) {
            const key = normalizeStructuralSpeakerKey(unit.speakerText);
            if (!unique.has(key)) unique.set(key, unit);
        }
        const speakers = [...unique.values()].map((unit) => ({
            mentionRef: `display-only-${sourceMessageIndex}-${unit.speakerSpan.start}-${unit.speakerSpan.end}`,
            text: unit.displaySpeakerText,
            ...(unit.displaySpeakerText && unit.displaySpeakerText !== unit.speakerText
                ? { sourceText: unit.speakerText } : {}),
            displayText: unit.displaySpeakerText,
            start: unit.speakerSpan.start,
            end: unit.speakerSpan.end,
        }));
        const provenanceStart = Math.min(core.start, ...speakers.map((speaker) => speaker.start));
        const provenanceEnd = Math.max(core.end, ...speakers.map((speaker) => speaker.end));
        const viewSpan = { start: provenanceStart, end: provenanceEnd };
        const classificationEvidenceSpans = [...new Map(projectedSpeechUnits.map(({ overlap }) => (
            [`${overlap.start}:${overlap.end}`, overlap]
        ))).values()].sort((left, right) => left.start - right.start);
        const ruleIds = [...new Set(projectedSpeechUnits.map(({ ruleId }) => ruleId))];
        const speakerOutsideCore = speakers.some((speaker) => speaker.start < core.start || speaker.end > core.end);
        const ruleId = speakerOutsideCore ? 'full-message-structural'
            : ruleIds.length === 1 ? ruleIds[0] : 'structured-speaker';
        return {
            sourceMessageIndex,
            sourceMessageHash,
            viewSpan,
            coreSpan: core,
            classificationEvidenceSpans,
            kind: speakers.length === 1 ? 'speaker' : 'group',
            text: speakers.length === 1 ? speakers[0].displayText : '多人对话',
            speakers,
            ruleId,
        };
    }

    if (pageShape.kind === 'dialogue-candidate') return buildStructuralNarratorFallbackEvidence(
        'dialogue-shape-without-speaker', pageShape.evidenceSpan, { sourceMessageIndex, sourceMessageHash, core });
    return allowPlainNarration && pageShape.kind === 'narrative'
        ? buildPlainNarrationPageTitleEvidence(chars.slice(core.start, core.end).join(''), {
            sourceMessageIndex, sourceMessageHash, viewSpan: core, coreSpan: core,
            allowInlineQuotes: true,
        })
        : null;
}

function findStructuralSpeakerAcrossSingleHeadingBridge({ messageIndex, chars, core }) {
    const pageText = chars.slice(core.start, core.end).join('');
    if (!/^\s*["“「『]/u.test(pageText) || /[。！？!?;；\n]{2}/u.test(pageText)) return null;
    const pageSeparator = findLastStructuralParagraphBreak(chars, Math.max(0, core.start - 1));
    if (pageSeparator < 0) return null;
    const headingSeparator = findLastStructuralParagraphBreak(chars, pageSeparator - 1);
    if (headingSeparator < 0) return null;
    const headingStart = headingSeparator + 2;
    const heading = chars.slice(headingStart, pageSeparator).join('').trim();
    if (!/^第[一二三四五六七八九十\d]+阶段(?:（[^）\r\n]{1,16}）)?[^。！？!?;；\r\n]{0,80}$/u.test(heading)) return null;
    const actionSeparator = headingSeparator;
    const previousSeparator = findLastStructuralParagraphBreak(chars, Math.max(0, actionSeparator - 1));
    const actionStart = previousSeparator + 2;
    const action = chars.slice(actionStart, actionSeparator).join('').trim();
    if (!/^(?:他|她)[^。！？!?;；\n]{0,28}(?:伸出|抬起|举起|指向|递出|递给|翻开|翻到|点头|转身|走到)[^。！？!?;；\n]{0,30}[：:]$/u.test(action)) return null;
    const latest = [];
    let latestEnd = -1;
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || anchor.groupId || typeof anchor.speakerText !== 'string'
            || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        const end = Math.max(-1, ...(anchor.utteranceSpans || [])
            .filter((span) => isValidStructuralPageSpan(span, chars.length) && span.end <= actionStart)
            .map((span) => span.end));
        if (end < 0 || actionStart - end > 48
            || findLatestStructuralSceneBoundaryEnd(chars, end, actionStart) != null) continue;
        if (end > latestEnd) {
            latest.length = 0;
            latestEnd = end;
        }
        if (end === latestEnd) latest.push(anchor);
    }
    const speakers = uniqueStructuralActors(latest.map((anchor) => ({
        text: anchor.speakerText,
        speakerSpan: anchor.speakerSpan,
    })));
    if (speakers.length !== 1) return null;
    const anchor = latest.find((item) => item.speakerText === speakers[0].text);
    return anchor || null;
}

function findStructuralRecentPronounSpeakerContinuation({ messageIndex, chars, core, pageType, previousPageSpans }) {
    if (!Array.isArray(previousPageSpans) || !previousPageSpans.length
        || !['dialogue', 'dialogue-group', 'unattributed-dialogue', 'narration', 'unknown'].includes(pageType)) return null;
    const priorPages = previousPageSpans.slice(-2);
    if (priorPages.length === 0 || priorPages.some((page) => !isValidStructuralPageSpan(page?.sourceSpan, chars.length)
        || page.sourceSpan.end > core.start || ['heading', 'structured-record'].includes(classifyStructuralPageShape({
            fullText: chars.join(''), pageType: page.pageType || '', coreSpan: page.sourceSpan, messageIndex,
        }).kind))) return null;

    const currentText = chars.slice(core.start, core.end).join('');
    const quotedSpans = findStructuralQuotedSpans(chars.slice(core.start, core.end));
    if (!quotedSpans.reliable || !quotedSpans.spans.length) return null;
    const localCurrentChars = Array.from(currentText);
    const standaloneQuote = quotedSpans.spans.length === 1
        ? quotedSpans.spans[0]
        : null;
    if (standaloneQuote && standaloneQuote.start <= 1
        && standaloneQuote.end >= localCurrentChars.length - 1
        && ['”', '」', '』', '"', '’', '｣'].includes(localCurrentChars[standaloneQuote.end - 1])) {
        const recentPronounResumption = findStructuralPriorPagePronounResumption({
            messageIndex, chars, core, priorPages, quoteSpan: {
                start: core.start + standaloneQuote.start,
                end: core.start + standaloneQuote.end,
            },
        });
        if (recentPronounResumption) return recentPronounResumption;
    }
    const framePattern = /^\s*(?:(?:随后|接着|然后|这时|此时)\s*)?(他|她|它|该角色|那名角色|这个人)([^。！？!?;；\n]{0,110})[：:]\s*$/u;
    const quote = quotedSpans.spans.find((span) => {
        if (span.start <= 0 || !['”', '」', '』', '"', '’', '｣'].includes(chars[core.start + span.end - 1])) return false;
        const prefix = chars.slice(core.start, core.start + span.start).join('');
        return framePattern.test(prefix);
    });
    if (!quote) return null;
    const prefix = chars.slice(core.start, core.start + quote.start).join('');
    const leadingLength = Array.from(prefix).findIndex((char) => !/\s/u.test(char));
    const frameStart = core.start + Math.max(0, leadingLength);
    const frameEnd = core.start + quote.start;
    const quoteSpan = trimStructuralSourceSpan(chars, core.start + quote.start, core.start + quote.end);
    const frameText = chars.slice(frameStart, frameEnd).join('');
    const quoteText = quoteSpan ? chars.slice(quoteSpan.start, quoteSpan.end).join('') : '';
    const writtenCarrierFrame = /(?:地图|羊皮纸|卷轴|信件|信纸|信|账本|账页|记录册|记录|条目|日志|报告|公告|文书|清单|碑文|石碑|墙面|徽记|徽章|牌子|告示|面板|屏幕|状态栏|铭文|纸条|便笺|书页)[^。！？!?;；\n]{0,72}(?:写着|写有|写道|记着|记载着|记录着|标注着|标着|注明|显示着|显示|刻着|刻有|铭刻着|铭刻有|列着|列出|写明|内容是|画着|描绘着|绘着)/u.test(frameText)
        || /(?:上面|里面|背面|正面|表面|墙上|碑上)[^。！？!?;；\n]{0,28}(?:写着|写有|记载着|记录着|标注着|注明|显示着|刻着|刻有|浮现出|浮现着)/u.test(frameText);
    if (!quoteSpan || isNarrativeSoundEffectSpan(chars, quoteSpan) || writtenCarrierFrame
        || isStructuralQuotedInformationFrame(frameText, quoteText)) return null;

    const anchors = [];
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || anchor.groupId || typeof anchor.speakerText !== 'string'
            || !anchor.speakerText.trim() || /^(?:你|我|他|她|它|该角色|那名角色|这个人|旁白|众人|全员|价值)$/u.test(anchor.speakerText)
            || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const utterance of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(utterance, chars.length) || utterance.end > core.start
                || !priorPages.some((page) => utterance.start < page.sourceSpan.end && page.sourceSpan.start < utterance.end)
                || findLatestStructuralSceneBoundaryEnd(chars, utterance.end, frameStart) != null) continue;
            const bridge = chars.slice(utterance.end, frameStart).join('');
            if (isStructuralQuotedInformationFrame(bridge, chars.slice(quoteSpan.start, quoteSpan.end).join())) continue;
            anchors.push({
                speakerText: anchor.speakerText,
                speakerSpan: anchor.speakerSpan,
                utteranceSpan: utterance,
            });
        }
    }
    if (!anchors.length) return null;
    if (new Set(anchors.map(({ speakerText }) => normalizeStructuralSpeakerKey(speakerText))).size !== 1) return null;
    const latestEnd = Math.max(...anchors.map(({ utteranceSpan }) => utteranceSpan.end));
    const latest = anchors.filter(({ utteranceSpan }) => utteranceSpan.end === latestEnd);
    const uniqueSpeakers = new Map(latest.map((anchor) => [
        normalizeStructuralSpeakerKey(anchor.speakerText), anchor,
    ]));
    if (uniqueSpeakers.size !== 1) return null;
    const selected = [...uniqueSpeakers.values()][0];
    const pageShape = classifyStructuralPageShape({
        fullText: chars.join(''), pageType, coreSpan: core, messageIndex,
    });
    if (['heading', 'structured-record', 'ambiguous'].includes(pageShape.kind)) return null;
    return {
        speakerText: selected.speakerText,
        speakerSpan: selected.speakerSpan,
        quoteSpan,
    };
}

function findStructuralRecentPageSpeakerContinuation({ messageIndex, chars, core, pageType, previousPageSpans }) {
    if (!Array.isArray(previousPageSpans) || !previousPageSpans.length
        || !['dialogue', 'dialogue-group', 'unattributed-dialogue', 'unknown'].includes(pageType)) return null;
    // A standalone quote may follow a title/metadata page while its last
    // speaker cue is still on the immediately preceding dialogue page. Keep
    // the source lookback bounded to two pages, but skip non-prose pages
    // instead of letting one heading erase otherwise local evidence.
    const priorPages = previousPageSpans.slice(-2).filter((page) => (
        isValidStructuralPageSpan(page?.sourceSpan, chars.length)
        && page.sourceSpan.end <= core.start
        && !['heading', 'structured-record'].includes(classifyStructuralPageShape({
            fullText: chars.join(''), pageType: page.pageType || '', coreSpan: page.sourceSpan, messageIndex,
        }).kind)
    ));
    if (!priorPages.length) return null;
    const current = chars.slice(core.start, core.end).join('').trim();
    const localChars = Array.from(current);
    const localQuotes = findStructuralQuotedSpans(localChars);
    if (!localQuotes.reliable || localQuotes.spans.length !== 1) return null;
    const quote = localQuotes.spans[0];
    if (quote.start > 1 || quote.end < localChars.length - 1
        || !['”', '」', '』', '"', '’', '｣'].includes(localChars[quote.end - 1])) return null;
    const quoteSpan = trimStructuralSourceSpan(chars, core.start + quote.start, core.start + quote.end);
    if (!quoteSpan || isNarrativeSoundEffectSpan(chars, quoteSpan)
        || isStructuralQuotedInformationFrame('', chars.slice(quoteSpan.start, quoteSpan.end).join(''))) return null;
    const pageShape = classifyStructuralPageShape({ fullText: chars.join(''), pageType, coreSpan: core, messageIndex });
    if (['heading', 'structured-record', 'ambiguous'].includes(pageShape.kind)) return null;

    const candidates = [];
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || anchor.groupId || typeof anchor.speakerText !== 'string'
            || !anchor.speakerText.trim() || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const utterance of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(utterance, chars.length) || utterance.end > core.start
                || !priorPages.some((page) => utterance.start < page.sourceSpan.end && page.sourceSpan.start < utterance.end)
                || findLatestStructuralSceneBoundaryEnd(chars, utterance.end, core.start) != null) continue;
            const sourceQuote = isValidStructuralPageSpan(anchor.quoteSpan, chars.length)
                ? chars.slice(anchor.quoteSpan.start, anchor.quoteSpan.end) : null;
            if (sourceQuote && ['”', '」', '』', '"', '’', '｣'].includes(sourceQuote.at(-1))) continue;
            const bridge = chars.slice(utterance.end, core.start).join('');
            if (isStructuralQuotedInformationFrame(bridge, chars.slice(quoteSpan.start, quoteSpan.end).join())
                || /(?:^|[。！？!?\n])\s*(?:[^。！？!?\n]{0,24}(?:说道|喊道|问道|回答|开口)\s*[：:]|[-—–]\s*\S)/u.test(bridge)) continue;
            candidates.push({ speakerText: anchor.speakerText, speakerSpan: anchor.speakerSpan, utteranceSpan: utterance });
        }
    }
    if (!candidates.length) {
        // A prior page can establish a speaker candidate through a unique
        // named action subject even when it contains no earlier dialogue.
        // This supports first turns such as “Mika stands by the window” on
        // one page followed by her standalone quote on the next. It is
        // intentionally narrower than searching for any name mention.
        for (const page of [...priorPages].reverse()) {
            const pageText = chars.slice(page.sourceSpan.start, page.sourceSpan.end);
            const pageString = pageText.join('');
            const quoteText = chars.slice(quoteSpan.start + 1, quoteSpan.end - 1).join('');
            if (containsStructuralQuoteMarker(pageString)
                || containsStructuralWrittenCarrierFrame(pageString, quoteText)) continue;
            const sentenceCandidates = [];
            let sentenceStart = 0;
            for (let cursor = 0; cursor <= pageText.length; cursor += 1) {
                if (cursor < pageText.length && !/[。！？!?;；\n]/u.test(pageText[cursor])) continue;
                const sentence = pageText.slice(sentenceStart, cursor);
                const subject = findStructuralUniqueActionSubjectInClauses(sentence.join(''), []);
                if (subject && isValidStructuralPageSpan(subject, sentence.length)
                    && sentence.slice(subject.start, subject.end).join('') === subject.text) {
                    sentenceCandidates.push({
                        speakerText: subject.text,
                        speakerSpan: { start: page.sourceSpan.start + sentenceStart + subject.start,
                            end: page.sourceSpan.start + sentenceStart + subject.end },
                        subjectEnd: page.sourceSpan.start + cursor,
                    });
                }
                sentenceStart = cursor + 1;
            }
            if (!sentenceCandidates.length) {
                const pronounLinkedActor = findStructuralPronounLinkedPriorPageActor({
                    pageText: pageString,
                    pageSpan: page.sourceSpan,
                    chars,
                    core,
                });
                if (pronounLinkedActor
                    && findLatestStructuralSceneBoundaryEnd(chars, pronounLinkedActor.speakerSpan.end, core.start) == null) {
                    return {
                        speakerText: pronounLinkedActor.speakerText,
                        speakerSpan: pronounLinkedActor.speakerSpan,
                        quoteSpan,
                        ruleId: 'prior-page-pronoun-linked-quote-continuation',
                    };
                }
                continue;
            }
            const latestSubjectEnd = Math.max(...sentenceCandidates.map((item) => item.subjectEnd));
            const latestCandidates = sentenceCandidates.filter((item) => item.subjectEnd === latestSubjectEnd);
            const uniqueLatest = new Map(latestCandidates.map((item) => [
                normalizeStructuralSpeakerKey(item.speakerText), item,
            ]));
            if (uniqueLatest.size !== 1) return null;
            const selected = [...uniqueLatest.values()][0];
            const bridge = chars.slice(selected.subjectEnd, core.start);
            if (bridge.some((char) => /[“”「」『』"'‘’]/u.test(char))
                || findLatestStructuralSceneBoundaryEnd(chars, selected.subjectEnd, core.start) != null
                || isStructuralQuotedInformationFrame(bridge.join(''), chars.slice(quoteSpan.start, quoteSpan.end).join())) return null;
            return { speakerText: selected.speakerText, speakerSpan: selected.speakerSpan, quoteSpan,
                ruleId: 'prior-page-action-subject-continuation' };
        }
        return null;
    }
    const latestEnd = Math.max(...candidates.map((candidate) => candidate.utteranceSpan.end));
    const latest = candidates.filter((candidate) => candidate.utteranceSpan.end === latestEnd);
    const unique = new Map(latest.map((candidate) => [normalizeStructuralSpeakerKey(candidate.speakerText), candidate]));
    if (unique.size !== 1) return null;
    const selected = [...unique.values()][0];
    return { speakerText: selected.speakerText, speakerSpan: selected.speakerSpan, quoteSpan };
}

function findStructuralPronounLinkedPriorPageActor({ pageText, pageSpan, chars, core }) {
    if (typeof pageText !== 'string' || !isValidStructuralPageSpan(pageSpan, chars.length)) return null;
    const postQuote = chars.slice(core.end).join('').match(/^\s*(?<pronoun>他|她|它)(?=$|[\s，,。！？!?;；])/u);
    const pronoun = postQuote?.groups?.pronoun;
    if (!pronoun) return null;

    const ignoredCapitalizedWords = new Set([
        'A', 'An', 'And', 'After', 'Before', 'But', 'He', 'Her', 'His', 'It', 'Now', 'She', 'So', 'Suddenly',
        'That', 'The', 'Their', 'Then', 'They', 'This', 'When', 'While', 'With', 'You',
    ]);
    const namePattern = /[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}/gu;
    const actionPattern = /(?:望着|望向|看着|看向|注视|凝视|出神|回过头|转过身|肩膀|微微一颤|抬起头|抬头|低下头|站起身|起身|走到|走向|靠近|停下脚步|转身)/u;
    const nameCandidates = [];
    for (const match of pageText.matchAll(namePattern)) {
        const name = match[0].trim();
        if (!name || ignoredCapitalizedWords.has(name) || !/^[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}$/u.test(name)) continue;
        const previousBoundary = Math.max(
            pageText.lastIndexOf('。', match.index - 1), pageText.lastIndexOf('！', match.index - 1),
            pageText.lastIndexOf('？', match.index - 1), pageText.lastIndexOf('!', match.index - 1),
            pageText.lastIndexOf('?', match.index - 1), pageText.lastIndexOf('\n', match.index - 1),
        ) + 1;
        const nextBoundaryCandidates = ['。', '！', '？', '!', '?', '\n']
            .map((boundary) => pageText.indexOf(boundary, match.index + match[0].length))
            .filter((position) => position >= 0);
        const sentenceEnd = nextBoundaryCandidates.length ? Math.min(...nextBoundaryCandidates) : pageText.length;
        const subjectSentence = pageText.slice(previousBoundary, sentenceEnd);
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!new RegExp(`^\\s*${escapedName}(?:\\s|$)`, 'u').test(subjectSentence)
            || !actionPattern.test(subjectSentence.slice(match.index - previousBoundary + match[0].length))) continue;

        const afterSentence = pageText.slice(sentenceEnd + (sentenceEnd < pageText.length ? 1 : 0));
        const pronounSentence = afterSentence.split(/[。！？!?;；\n]/u, 1)[0] || '';
        if (!new RegExp(`^\\s*${pronoun}[^。！？!?;；\\n]{0,90}(?:肩膀|微微一颤|回过头|转过身|抬起头|抬头|低下头|站起身|起身|走到|走向|靠近|停下脚步)`, 'u')
            .test(pronounSentence)) continue;

        const nameOffset = Array.from(pageText.slice(0, match.index)).length;
        const start = pageSpan.start + nameOffset;
        const end = start + Array.from(name).length;
        const speakerSpan = { start, end };
        if (!isValidStructuralPageSpan(speakerSpan, chars.length)
            || chars.slice(start, end).join('') !== name) continue;
        nameCandidates.push({ speakerText: name, speakerSpan });
    }
    const unique = new Map(nameCandidates.map((candidate) => [normalizeStructuralSpeakerKey(candidate.speakerText), candidate]));
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function isStructuralFirstPersonIntroduction(value) {
    const text = String(value ?? '').trim().replace(/^[“「『"'‘｢]+/u, '').trimStart();
    const introduction = "(?:(?:我叫|我的名字是|我是|在下(?:叫|是)?)[\\p{Script=Han}]{2,4}(?=[，,。！？!?；;：:]|$)|(?:My name is)\\s+[A-Z][A-Za-z'’\\-]{1,24}(?=[,，.。!?！？;；:]|$))";
    return new RegExp(`^(?:${introduction}|[^。！？!?;；\\n]{1,24}[，,。！？!?;；]\\s*${introduction})`, 'u').test(text);
}

function isUnresolvedEntityReferenceOrShortReaction(value) {
    const text = String(value ?? '').trim();
    if (/^(?:(?:随后|接着|然后|这时|此时)\s*)?它(?:的[^。！？!?;；\n]{0,48}|[^。！？!?;；\n]{0,32})(?:说|问|答|喊|低吼|咆哮|怒吼)?\s*[:：]\s*[“「『"]/u.test(text)) return true;
    const scan = findStructuralQuotedSpans(Array.from(text));
    if (!scan.reliable || scan.spans.length !== 1) return false;
    const quote = scan.spans[0];
    const content = Array.from(text).slice(quote.start + 1, quote.end - 1).join('').trim();
    return /^(?:什么[？！!?…]*|不[\s.。…]{0,8}不可能[^。！？!?]{0,12}|不可能[^。！？!?]{0,12})$/u.test(content);
}

function findStructuralLocalEntityOwnerForPage({ messageIndex, chars, core }) {
    const pageText = chars.slice(core.start, core.end).join('').trim();
    const explicitEntityAction = /^(?:(?:随后|接着|然后|这时|此时)\s*)?它从(?:龙鳞|鳞片|龙爪|龙翼|龙瞳|龙尾|龙角|龙息)[^。！？!?;；\n]{0,18}(?:取出|拿出|摘下|举起|伸出|收起|展开|低下|递出)[^。！？!?;；\n]{0,48}[：:]\s*[“「『"“‘]/u.test(pageText);
    if (!explicitEntityAction) return null;
    const recent = [];
    let latestEnd = -1;
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || /^(?:你|我|他|她|它|旁白|众人|全员)$/u.test(anchor.speakerText)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const span of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(span, chars.length) || span.end > core.start
                || core.start - span.end > 140
                || findLatestStructuralSceneBoundaryEnd(chars, span.end, core.start) != null) continue;
            if (span.end > latestEnd) {
                latestEnd = span.end;
                recent.length = 0;
            }
            if (span.end === latestEnd) recent.push(anchor);
        }
    }
    const owners = uniqueStructuralActors(recent);
    return owners.length === 1 ? owners[0] : null;
}

function findStructuralRecentActionSpeaker({ source, quote, prefixStart, suffixEnd, knownNames = [], anchors = [] }) {
    const quotePrefix = source.slice(prefixStart, quote.start).join('').trim();
    const quoteSuffix = source.slice(quote.end, suffixEnd).join('').trim();
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    const playerDeclaration = /(?:^|[，,。！？!?…\s])(?:我|我们)(?:以[^。！？!?；;]{0,32}之名)?[^。！？!?；;]{0,36}(?:召唤|宣誓|决定|接受|拒绝|命令|要求)/u.test(utterance);
    const playerSelfStatement = /^(?:我|我们)(?:是|叫|名为|来自|曾|已经|刚刚|亲手|在[^。！？!?；;]{0,16}(?:封印|击败|拯救|净化))/u.test(utterance);
    const priorPlayerContextStart = Math.max(0, quote.start - 180);
    const priorPlayerContext = source.slice(priorPlayerContextStart, quote.start).join('').trimEnd();
    let playerActionOffset = Math.max(
        priorPlayerContext.lastIndexOf('。') + 1,
        priorPlayerContext.lastIndexOf('！') + 1,
        priorPlayerContext.lastIndexOf('？') + 1,
        priorPlayerContext.lastIndexOf('\n') + 1,
    );
    while (playerActionOffset < priorPlayerContext.length && /\s/u.test(priorPlayerContext[playerActionOffset])) playerActionOffset += 1;
    const playerActionSentenceStart = priorPlayerContextStart + Array.from(priorPlayerContext.slice(0, playerActionOffset)).length;
    const playerActionSentence = priorPlayerContext.slice(playerActionOffset)
        .replace(/[—–-]{1,3}\s*$/u, '').trimEnd();
    const playerActionBeforeDeclaration = (playerDeclaration || playerSelfStatement)
        && /^你(?=.{0,100}(?:毫不犹豫|没有退缩|未退缩|拿出|取出|举起|展示|接过|递出|以[^。！？!?;；]{0,24}身份))/u.test(playerActionSentence);
    if (playerActionBeforeDeclaration) {
        return { text: '你', speakerSpan: { start: playerActionSentenceStart, end: playerActionSentenceStart + 1 } };
    }
    const spiritReturn = /(?:^|[，,。！？!?…\s])(?:我|吾)(?:回来了|归来|回到|重返)/u.test(utterance);
    const recentTextStart = Math.max(0, quote.start - 180);
    const recentText = source.slice(recentTextStart, quote.start).join('');
    const latestSceneSlice = recentText.split(/\n\s*#{1,6}\s+|\n\s*[-*_]{3,}\s*\n|(?:新?场景|场景|地点|location)\s*[:：]/iu).at(-1) || '';
    const directWelcome = /(?:^|[。！？!?;；\n])(?<actor>[\p{Script=Han}]{2,4})(?:——|—|–|-)[^。！？!?;；\n]{1,32}(?:——|—|–|-)(?:急忙|立刻|马上)?(?:迎接|迎上前|接待|招呼|迎上来)/u.exec(latestSceneSlice);
    if (directWelcome?.groups?.actor) {
        // `latestSceneSlice` is the final split component. Derive its true
        // suffix offset instead of searching by text: identical scene prose
        // may occur more than once before the current quote.
        const latestSceneStart = recentText.length - latestSceneSlice.length;
        const prefixThroughScene = recentText.slice(0, latestSceneStart);
        const actorOffset = directWelcome.index + directWelcome[0].indexOf(directWelcome.groups.actor);
        const start = recentTextStart + Array.from(prefixThroughScene).length
            + Array.from(latestSceneSlice.slice(0, actorOffset)).length;
        return { text: directWelcome.groups.actor, speakerSpan: {
            start, end: start + Array.from(directWelcome.groups.actor).length,
        } };
    }
    const pronounSpeechPrefix = /(?:^|[。！？!?;；\n，,])(?:她|他|那位|那人)(?:(?![。！？!?;；\n，,]).){0,20}?(?:说着|说道|说|问道|问|喊道|喊)[，,:：]?$/u.test(quotePrefix);
    if (quotePrefix && !pronounSpeechPrefix) return null;
    if ((quoteSuffix && !/^(?:他|她)?(?:说着|说道|说|问道|问|喊道|喊)/u.test(quoteSuffix) && !spiritReturn)) return null;

    // A short pronoun-led speech cue may continue the immediately preceding
    // explicitly attributed utterance (for example, “X said ...” followed by
    // “she said, ‘...’”). Keep this local to the current message and reject
    // competing intervening speakers.
    if (pronounSpeechPrefix) {
        const preceding = anchors.filter((anchor) => anchor?.certainty === 'explicit'
            && (anchor.utteranceSpans || []).some((span) => isValidStructuralPageSpan(span, source.length)
                && span.end <= quote.start && quote.start - span.end <= 180
                && findLatestStructuralSceneBoundaryEnd(source, span.end, quote.start) == null));
        const owners = uniqueStructuralActors(preceding);
        if (owners.length === 1) {
            const anchor = preceding.find((candidate) => candidate.speakerText === owners[0].text);
            if (anchor?.speakerSpan) return { text: owners[0].text, speakerSpan: anchor.speakerSpan };
        }
        return null;
    }
    // A standalone quote may begin the next paragraph. Look back through only
    // the immediately preceding paragraph (and at most 220 characters), then
    // require the candidate name to be the subject at a clause boundary.
    let contextStart = quote.start;
    while (contextStart > 0 && quote.start - contextStart < 220) {
        if (source[contextStart - 1] === '\n' && source[contextStart - 2] === '\n') break;
        contextStart -= 1;
    }
    let context = source.slice(contextStart, quote.start).join('').trim();
    if (!context) {
        let cursor = quote.start - 1;
        while (cursor >= 0 && /\s/u.test(source[cursor])) cursor -= 1;
        let sentenceStops = 0;
        while (cursor >= 0 && quote.start - cursor < 220 && sentenceStops < 3) {
            if (source[cursor] === '\n' && source[cursor - 1] === '\n') break;
            if (/[。！？!?;；]/u.test(source[cursor])) sentenceStops += 1;
            cursor -= 1;
        }
        contextStart = cursor + 1;
        context = source.slice(contextStart, quote.start).join('').trim();
    }
    if (!context || /(?:标题|章节|回合|状态|记录|账本|地图|信件|公告|菜单|选项)\s*[：:]/u.test(context)) return null;
    const boundaryEnd = findLatestStructuralSceneBoundaryEnd(source, contextStart, quote.start);
    const boundedStart = boundaryEnd == null ? contextStart : boundaryEnd;
    const rawBounded = source.slice(boundedStart, quote.start).join('');
    const boundedLeading = Array.from(rawBounded.slice(0, rawBounded.length - rawBounded.trimStart().length)).length;
    const bounded = rawBounded.trim();
    const candidateBase = boundedStart + boundedLeading;
    const roleWelcomingAction = /(?:^|[。！？!?;；\n])(?<actor>[\p{Script=Han}]{2,4})(?:——|—|–|-)[^。！？!?;；\n]{1,32}(?:——|—|–|-)(?:急忙|立刻|马上)?(?:迎接|迎上前|接待|招呼|迎上来)/gu;
    const welcomingActors = [];
    for (const match of bounded.matchAll(roleWelcomingAction)) {
        const actor = match.groups?.actor || '';
        const actorOffset = match.index + match[0].indexOf(actor);
        welcomingActors.push({ text: actor, speakerSpan: {
            start: candidateBase + Array.from(bounded.slice(0, actorOffset)).length,
            end: candidateBase + Array.from(bounded.slice(0, actorOffset)).length + Array.from(actor).length,
        } });
    }
    const welcomingOwners = uniqueStructuralActors(welcomingActors);
    if (welcomingOwners.length === 1) return welcomingOwners[0];
    const boundedQuoteScan = findStructuralQuotedSpans(Array.from(bounded));
    if (!bounded || !boundedQuoteScan.reliable) return null;
    // An earlier line of dialogue does not block a fresh, explicitly named
    // actor action immediately before this standalone quote. Search only the
    // narrative suffix after the last prior quote, so an unrelated speaker
    // cannot be carried forward by adjacency alone.
    const lastPriorQuote = boundedQuoteScan.spans.at(-1);
    const actionSuffixStart = lastPriorQuote?.end || 0;
    const actionSuffixRaw = bounded.slice(actionSuffixStart);
    const actionSuffixLeading = actionSuffixRaw.length - actionSuffixRaw.trimStart().length;
    const actionContext = actionSuffixRaw.trim();
    const actionContextBase = candidateBase + Array.from(bounded.slice(0, actionSuffixStart + actionSuffixLeading)).length;
    if (!actionContext || Array.from(actionContext).length > 140
        || isStructuralQuotedInformationFrame(actionContext, actionContext)) return null;

    const actionAtSubject = /^(?:(?:突然|立刻|马上|随后|接着|然后|这时|此时|仍|又|也|正|正在|刚刚|刚才)\s*)*(?:刚说完|头也不抬地翻|闻(?:了)?(?:一下|一闻)?|嗅(?:了)?(?:一下)?|打了个喷嚏|脸色|神情|皱眉|点头|转身|停下脚步|走到|走向|看向|望向|拿起|放下|递给|吓得|尖叫|喊道|说着|说|笑(?:了|着)?|咧嘴|咆哮|怒吼|翻(?:了)?(?:一页|页)|探出|探头)/u;
    const candidates = [];
    const roster = [...new Set(knownNames)].sort((a, b) => b.length - a.length);
    const playerAction = /(?:^|[，,。！？!?;；\n—–])(?<actor>你)(?<tail>[^。！？!?;；\n]{0,110})/gu;
    for (const match of bounded.matchAll(playerAction)) {
        if (!/(?:闭上眼睛|瞬移|冲向|冲到|锁定|感知|举起|握紧|拔出|挡住|闪避|躲开|逼近|追上|拦住|看准|瞄准|没有退缩|未退缩)/u.test(match.groups?.tail || '')) continue;
        const actorOffset = match.index + match[0].indexOf(match.groups.actor);
        candidates.push({ text: '你', speakerSpan: {
            start: candidateBase + Array.from(bounded.slice(0, actorOffset)).length,
            end: candidateBase + Array.from(bounded.slice(0, actorOffset)).length + 1,
        } });
    }
    let clauseOffset = 0;
    for (const rawClause of actionContext.split(/(?<=[，,。！？!?;；\n])/u)) {
        const clause = rawClause.replace(/[，,。！？!?;；\n]+$/u, '').trimStart()
            .replace(/^(?:(?:但是|不过|然而|但|随后|接着|然后|同时|这时|此时|突然|忽然)\s*)+/u, '');
        const trimOffset = rawClause.length - rawClause.trimStart().length;
        const connectorOffset = rawClause.slice(trimOffset).length - rawClause.slice(trimOffset).replace(/^(?:(?:但是|不过|然而|但|随后|接着|然后|同时|这时|此时|突然|忽然)\s*)+/u, '').length;
        const sourceClauseOffset = Array.from(actionContext.slice(0, clauseOffset + trimOffset + connectorOffset)).length;
        if ((playerDeclaration || playerSelfStatement) && /^你(?=.{0,72}(?:毫不犹豫|拿出|取出|举起|握紧|拔出|接受|决定|宣誓|没有退缩|未退缩|深吸一口气|开口|说道|说))/u.test(clause)) {
            const playerStart = sourceClauseOffset;
            candidates.push({ text: '你', speakerSpan: {
                start: actionContextBase + playerStart,
                end: actionContextBase + playerStart + 1,
            } });
            clauseOffset += Array.from(rawClause).length;
            continue;
        }
        const rosterName = roster.find((name) => clause.startsWith(name));
        let actor = rosterName || '';
        const latinActor = !actor
            ? /^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u.exec(clause)
            : null;
        if (latinActor?.groups?.name && actionAtSubject.test((latinActor.groups.tail || '').trimStart())) actor = latinActor.groups.name;
        const compoundActor = !actor ? /^([\p{Script=Han}]{2,4}·[\p{Script=Han}]{1,4})(?=.{0,24}(?:咆哮|怒吼|咧嘴|笑|抬头|看向|望向))/u.exec(clause) : null;
        if (compoundActor) actor = compoundActor[1];
        if (!actor) {
            const generic = /^([\p{Script=Han}]{2,4})(?=.{0,12}$)/u.exec(clause);
            if (generic && !/^(?:立刻|突然|忽然|随后|接着|然后|同时|这时|此时|刚才|正在|于是|并且|而且|但是|不过|然而|她平静地|他平静地|她低声地|他低声地)$/u.test(generic[1])) actor = generic[1];
        }
        const tail = actor ? clause.slice(Array.from(actor).length) : '';
        if (actor && actionAtSubject.test(tail.trimStart()) && !/^[的地得被让由]/u.test(tail.trimStart())) {
            candidates.push({ text: actor, speakerSpan: {
                start: actionContextBase + sourceClauseOffset,
                end: actionContextBase + sourceClauseOffset + Array.from(actor).length,
            } });
        }
        clauseOffset += Array.from(rawClause).length;
    }
    const unique = uniqueStructuralActors(candidates);
    const hasCompetingSubject = actionContext.split(/(?<=[，,。！？!?;；\n])/u).some((rawClause) => {
        const clause = rawClause.replace(/[，,。！？!?;；\n]+$/u, '').trimStart()
            .replace(/^(?:(?:但是|不过|然而|但|随后|接着|然后|同时|这时|此时|突然|忽然)\s*)+/u, '');
        return /^(?:有人|某人|陌生人|对方|那个(?:人|守卫|士兵|骑士|法师|敌人)|一名(?:守卫|士兵|骑士|法师|敌人)|守卫|侍卫|护卫|士兵|骑士|法师|术士|敌人|人群|众人|大家)/u.test(clause);
    });
    if (!hasCompetingSubject && spiritReturn) {
        const spirit = /^(?<actor>[\p{Script=Han}]{2,4})的灵魂(?<tail>[^。！？!?;；\n]{1,72})$/u.exec(bounded);
        if (spirit?.groups?.actor && /(?:微笑|升向|升起|飘向|飘散|浮向|化为)/u.test(spirit.groups.tail)) {
            const actor = spirit.groups.actor;
            const actorLength = Array.from(actor).length;
            return { text: actor, speakerSpan: { start: candidateBase, end: candidateBase + actorLength } };
        }
    }
    if (hasCompetingSubject || unique.length !== 1) return null;
    return { text: unique[0].text, speakerSpan: unique[0].speakerSpan };
}

function findStructuralAnonymousIntroPronounSpeaker({ source, quote, quotes = [], knownNames = [] }) {
    if (!Array.isArray(source) || !quote?.closed) return null;
    const precedingQuotes = quotes.filter((candidate) => candidate?.closed && candidate.end <= quote.start);
    // Deliberately support only the first anonymous self-introduction in a
    // source message. A later new character or scene must establish its own
    // local speaker evidence.
    if (precedingQuotes.length !== 1) return null;
    const introductionQuote = precedingQuotes[0];
    const introductionText = source.slice(introductionQuote.start + 1, introductionQuote.end - 1).join('').trim();
    if (!isStructuralFirstPersonIntroduction(introductionText)) return null;
    if (findLatestStructuralSceneBoundaryEnd(source, introductionQuote.end, quote.start) != null) return null;

    const continuation = source.slice(introductionQuote.end, quote.start).join('').trim();
    if (!continuation || Array.from(continuation).length > 140
        || /[“”「」『』"]/u.test(continuation)
        || isStructuralQuotedInformationFrame(continuation, source.slice(quote.start + 1, quote.end - 1).join(''))) return null;
    const pronounAction = /^(?<pronoun>她|他)(?<context>[^。！？!?;；“”「」『』"]{0,120})(?:[。！？!?;；]+)?$/u.exec(continuation);
    if (!pronounAction?.groups?.context
        || !new RegExp(`(?:${STRUCTURAL_ACTION_CUE}|声音|嗓音|俯身)`, 'u').test(pronounAction.groups.context)) return null;

    const paragraphBreak = findLastStructuralParagraphBreak(source, introductionQuote.start);
    const preludeEnd = paragraphBreak < 0 ? introductionQuote.start : paragraphBreak;
    const precedingParagraphBreak = findLastStructuralParagraphBreak(source, preludeEnd);
    const preludeStart = precedingParagraphBreak < 0 ? 0 : precedingParagraphBreak + 2;
    const preludeRaw = source.slice(preludeStart, preludeEnd).join('');
    const preludeLeading = Array.from(preludeRaw.slice(0, preludeRaw.length - preludeRaw.trimStart().length)).length;
    const normalizedPreludeStart = preludeStart + preludeLeading;
    const prelude = preludeRaw.trim();
    if (!prelude || /[“”「」『』"]/u.test(prelude)
        || isLikelyStandalonePresentationHeading(prelude)
        || isLikelyFirstPageSceneTitle(prelude)
        || isStructuralQuotedInformationFrame(prelude, prelude)) return null;
    const leadClause = prelude.split(/[，,。！？!?;；\n]/u, 1)[0].trim();
    if (!leadClause || hasCoordinatedSubjectsBeforeAction(leadClause, knownNames)) return null;
    const leadingActor = findUnrosteredSubjectBeforeAction(leadClause);
    if (!leadingActor || leadingActor.start !== 0) return null;
    const speakerText = source.slice(normalizedPreludeStart, normalizedPreludeStart + leadingActor.end).join('').trim();
    if (!speakerText || speakerText !== leadingActor.text || isGenericCharacterNoun(speakerText)
        || isStructuralAnonymousSpeakerDescription(speakerText)) return null;
    const competingName = [...new Set(knownNames)].some((name) => name !== speakerText
        && (prelude.includes(name) || continuation.includes(name)));
    const otherLatinName = /\b[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}\b/u.test(
        `${prelude.slice(speakerText.length)} ${continuation}`,
    );
    if (competingName || otherLatinName) return null;
    const speakerStart = normalizedPreludeStart + leadingActor.start;
    return {
        text: speakerText,
        speakerSpan: { start: speakerStart, end: speakerStart + Array.from(speakerText).length },
        attributionStart: normalizedPreludeStart,
    };
}

function findStructuralSpiritReturnSpeaker({ source, quote }) {
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    if (!/(?:^|[，,。！？!?…\.．\s])(?:我|吾)(?:回来了|归来|回到|重返)/u.test(utterance)) return null;
    let start = quote.start - 1;
    while (start >= 0 && /\s/u.test(source[start])) start -= 1;
    while (start >= 0 && source[start] !== '\n') start -= 1;
    start += 1;
    const preceding = source.slice(start, quote.start).join('').trim();
    const match = /^(?<actor>[\p{Script=Han}]{2,4})的灵魂(?<tail>[^。！？!?;；“”「」『』"\n]{1,64})[—–-]*$/u.exec(preceding);
    if (!match?.groups?.actor || !/(?:微笑|升向|升起|飘向|飘散|浮向|化为)/u.test(match.groups.tail)) return null;
    const actor = match.groups.actor;
    const sourceStart = start + Array.from(preceding.slice(0, preceding.indexOf(actor))).length;
    return { text: actor, speakerSpan: { start: sourceStart, end: sourceStart + Array.from(actor).length } };
}

function findStructuralSelfIdentifiedDragonSpeaker({ source, quote, prefixStart }) {
    const prefix = source.slice(prefixStart, quote.start).join('').trim();
    if (!/^(?:(?:随后|接着|然后|这时|此时)\s*)?(?:它|巨龙)[^。！？!?;；\n]{0,48}(?:龙头|巨龙|龙首)[^。！？!?;；\n]{0,24}[：:]$/u.test(prefix)) return null;
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('');
    const match = /^\s*我[，,]\s*(?<name>[\p{Script=Han}]{2,4}·[\p{Script=Han}]{1,4})/u.exec(utterance);
    if (!match?.groups?.name) return null;
    const sourceStart = quote.start + 1 + Array.from(utterance.slice(0, match.index + match[0].indexOf(match.groups.name))).length;
    return { text: match.groups.name, speakerSpan: { start: sourceStart, end: sourceStart + Array.from(match.groups.name).length } };
}

function findStructuralCharacterExpressionQuoteSpeaker({ source, quote, prefixStart, suffixEnd, knownNames = [] }) {
    const prefix = source.slice(prefixStart, quote.start).join('').trim();
    let localSuffixEnd = Math.min(source.length, quote.end + 24);
    const suffix = source.slice(quote.end, localSuffixEnd).join('').trimStart();
    if (!/^(?:的)?(?:表情|神情|神色|笑容|心声)(?:中|里)?/u.test(suffix)
        || !/(?:露出|浮现|显出|流露出)(?:了)?(?:一种|一丝|一抹|满脸)?$/u.test(prefix)) return null;
    const candidates = [...new Set((knownNames || []).filter((name) => typeof name === 'string' && name.trim()))]
        .map((name) => ({ name, index: prefix.indexOf(name) }))
        .filter(({ name, index }) => index >= 0 && prefix.indexOf(name, index + name.length) < 0
            && ![...(knownNames || [])].some((other) => other !== name
                && !/^(?:你|我|他|她|它|我们|你们|他们|她们)$/u.test(other) && prefix.includes(other))
            && !prefix.slice(0, index).trim());
    if (candidates.length !== 1) return null;
    const { name, index } = candidates[0];
    const speakerStart = prefixStart + Array.from(prefix.slice(0, index)).length;
    const speakerSpan = { start: speakerStart, end: speakerStart + Array.from(name).length };
    if (!isValidStructuralPageSpan(speakerSpan, source.length)
        || source.slice(speakerSpan.start, speakerSpan.end).join('') !== name) return null;
    localSuffixEnd = quote.end + Array.from(source.slice(quote.end, quote.end + 24).join('').match(/^\s*(?:的)?(?:表情|神情|神色|笑容|心声)(?:中|里)?/u)?.[0] || '').length;
    return { text: name, speakerSpan, evidenceSpan: { start: prefixStart, end: localSuffixEnd } };
}

function findStructuralActorVocalizationSpeaker({ source, quote, prefixStart, quoteSpans = [] }) {
    const priorSoundQuote = [...quoteSpans].reverse().find((candidate) => candidate.end <= quote.start
        && isNarrativeSoundEffectSpan(source, candidate));
    if (priorSoundQuote) {
        const connector = source.slice(priorSoundQuote.end, quote.start).join('').trim();
        const actorSpanStart = findStructuralAttributionStart(source, priorSoundQuote.start);
        const actorPrelude = source.slice(actorSpanStart, priorSoundQuote.start).join('').trim();
        if (/^(?:的)?(?:咆哮|怒吼|低吼|嘶吼|大笑|笑声|吼声|叫声|喊声)[:：]$/u.test(connector)) {
            const actorMatch = /^(?:(?:随后|接着|然后|这时|此时)\s*)?(?<name>(?:[\p{Script=Han}]{2,4}(?:·[\p{Script=Han}]{2,4})?|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}))$/u.exec(actorPrelude);
            if (actorMatch?.groups?.name) {
                const localStart = actorPrelude.indexOf(actorMatch.groups.name);
                const speakerStart = actorSpanStart + Array.from(actorPrelude.slice(0, localStart)).length;
                const speakerSpan = { start: speakerStart, end: speakerStart + Array.from(actorMatch.groups.name).length };
                if (isValidStructuralPageSpan(speakerSpan, source.length)
                    && source.slice(speakerSpan.start, speakerSpan.end).join('') === actorMatch.groups.name) {
                    return { text: actorMatch.groups.name, speakerSpan, evidenceSpan: { start: actorSpanStart, end: quote.start } };
                }
            }
        }
    }
    const prefix = source.slice(prefixStart, quote.start).join('');
    const name = String.raw`(?<name>(?:[\p{Script=Han}]{2,4}(?:·[\p{Script=Han}]{2,4})?|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}))`;
    const pattern = new RegExp(`^(?:(?:随后|接着|然后|这时|此时)\\s*)?${name}(?:\\s*[“"「『][^”"」』\\r\\n]{1,16}[”"」』](?:的)?(?:咆哮|怒吼|低吼|嘶吼|大笑|笑声|吼声|叫声|喊声)|(?:发出|爆发出)(?:了一阵|一阵|一声)?[^。！？!?;；\\n]{0,16}(?:咆哮|怒吼|低吼|嘶吼|大笑|笑声|吼声|叫声|喊声))\\s*[:：]$`, 'u');
    const match = pattern.exec(prefix.trim());
    if (!match?.groups?.name) return null;
    const trimmedStart = prefix.length - prefix.trimStart().length;
    const localStart = Array.from(prefix.slice(0, trimmedStart + match[0].indexOf(match.groups.name))).length;
    const speakerSpan = { start: prefixStart + localStart, end: prefixStart + localStart + Array.from(match.groups.name).length };
    if (!isValidStructuralPageSpan(speakerSpan, source.length)
        || source.slice(speakerSpan.start, speakerSpan.end).join('') !== match.groups.name) return null;
    return { text: match.groups.name, speakerSpan, evidenceSpan: { start: prefixStart, end: quote.start } };
}

function findStructuralNearbyDragonSpeaker({ source, quote, anchors = [], quoteSpans = [] }) {
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    const priorStart = Math.max(0, quote.start - 320);
    const priorText = source.slice(priorStart, quote.start).join('');
    const sceneBoundaryPattern = /(?:^|\n)\s*(?:#{1,6}\s+|(?:新?场景|场景|地点|location)\s*[:：])|(?:^|\n)\s*[-*_]{3,}\s*(?:\n|$)/giu;
    let boundedStart = priorStart;
    for (const boundary of priorText.matchAll(sceneBoundaryPattern)) {
        boundedStart = priorStart + Array.from(priorText.slice(0, boundary.index + boundary[0].length)).length;
    }
    const boundedPrior = source.slice(boundedStart, quote.start).join('');
    const recentContext = source.slice(Math.max(0, quote.start - 120), quote.start).join('');
    const dragonUtterance = /(?:龙魂守护者|龙语|龙息|龙鳞|冰霜吐息)/u.test(utterance);
    const dragonActionNearby = /(?:巨龙|龙头|龙首|龙瞳|龙吟|龙息|龙鳞)[^。！？!?;；\n]{0,64}(?:睁开|张开|抬起|咆哮|蓄力|回荡|震动|收起|低下|认可|苏醒)|(?:低沉|威严)[^。！？!?;；\n]{0,24}声音[^。！？!?;；\n]{0,16}(?:回荡|响起|传来)/u.test(recentContext)
        || /(?:龙语|龙吟|巨龙|龙头|龙瞳|龙息|龙鳞)/u.test(utterance);

    // A quote immediately preceding an entity's explicit self-introduction
    // can reuse that name when the intervening narration keeps the dragon as
    // the unique subject and the short name was already present nearby.
    const followingQuote = quoteSpans.find((candidate) => candidate.start >= quote.end
        && candidate.start - quote.end <= 180);
    if (followingQuote && /^\s*(?:它|巨龙)[^。！？!?;；\n]{0,48}(?:低下|抬起|转向|看向)[^。！？!?;；\n]{0,24}(?:龙头|龙首)[^。！？!?;；\n]{0,24}[：:]/u.test(source.slice(quote.end, followingQuote.start).join(''))) {
        const followingText = source.slice(followingQuote.start + 1, followingQuote.closed ? followingQuote.end - 1 : followingQuote.end).join('');
        const introduction = /^\s*我[，,]\s*(?<name>[\p{Script=Han}]{2,4}·[\p{Script=Han}]{1,4})/u.exec(followingText);
        const precedingActionSpan = findStructuralPreviousParagraphSpan(source, quote.start, 110);
        const precedingAction = precedingActionSpan
            ? source.slice(precedingActionSpan.start, precedingActionSpan.end).join('').trim() : '';
        const priorDragonName = introduction?.groups?.name?.match(/^([\p{Script=Han}]{2,4})·/u)?.[1] || '';
        const priorNameContext = source.slice(Math.max(0, quote.start - 180), quote.start).join('');
        const priorNamePattern = priorDragonName
            ? new RegExp(`(?:^|[\\n\\s，,。！？!?：:])${priorDragonName}(?=[“\"‘]|的(?:回合|咆哮|龙头|龙瞳)|(?:咆哮|怒吼|低吼))`, 'u')
            : null;
        if (introduction?.groups?.name && /它[^。！？!?;；\n]{0,44}(?:龙瞳|龙头)[^。！？!?;；\n]{0,24}[：:]$/u.test(precedingAction)
            && priorNamePattern?.test(priorNameContext)) {
            const localIndex = followingText.indexOf(introduction.groups.name);
            const speakerStart = followingQuote.start + 1 + Array.from(followingText.slice(0, localIndex)).length;
            return { text: introduction.groups.name, speakerSpan: { start: speakerStart, end: speakerStart + Array.from(introduction.groups.name).length } };
        }
    }

    if (!dragonUtterance || !dragonActionNearby) return null;
    const quotedRanges = quoteSpans || [];
    const names = [];
    const boundedString = boundedPrior;
    const compoundPattern = /[\p{Script=Han}]{2,4}·[\p{Script=Han}]{1,4}(?=(?:的|[，,。！？!?；;\s（(]|站起来|站起|站稳|起身|抬头|抬起|睁开|微笑|笑着|点头|转身|看向|望向|审视|打量|指向|用|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|探出|咆哮|怒吼|咧嘴))/gu;
    for (const match of boundedString.matchAll(compoundPattern)) {
        const localStart = boundedStart + Array.from(boundedString.slice(0, match.index)).length;
        const localEnd = localStart + Array.from(match[0]).length;
        if (quotedRanges.some((span) => localStart >= span.start && localStart < span.end)) continue;
        const near = source.slice(Math.max(boundedStart, localStart - 24), Math.min(quote.start, localEnd + 72)).join('');
        if (!/(?:龙|巨龙|龙族|龙鳞|龙瞳|龙息|龙语|龙吟|咆哮)/u.test(near)) continue;
        names.push({ text: match[0], speakerSpan: { start: localStart, end: localEnd } });
    }
    const uniqueNames = uniqueStructuralActors(names);
    if (uniqueNames.length !== 1) return null;
    const name = uniqueNames[0].text;
    const occurrence = names.filter((candidate) => candidate.text === name).at(-1);
    return occurrence || null;
}

function isStructuralUnidentifiedDragonSpeech({ source, quote, quoteSpans = [] }) {
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    const local = source.slice(Math.max(0, quote.start - 120), quote.start).join('');
    const dragonUtterance = /(?:龙魂守护者|龙语|龙息|龙鳞|冰霜吐息)/u.test(utterance);
    const dragonCue = /(?:巨龙|龙头|龙首|龙瞳|龙吟|龙息|龙鳞|声音回荡|威严的声音|低沉的声音)/u.test(local)
        || /(?:龙语|龙吟|巨龙|龙头|龙瞳|龙息|龙鳞)/u.test(utterance);
    if (!dragonUtterance || !dragonCue) return false;
    return !findStructuralNearbyDragonSpeaker({ source, quote, quoteSpans });
}

function findStructuralNamedReactionSpeaker({ source, quote, anchors = [], knownNames = [] }) {
    const quoteText = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    const denialReaction = /^(?:不[\s.。…]{0,12}不可能|不可能|不敢相信|怎么可能)[^。！？!?]{0,48}$/u.test(quoteText);
    const surpriseReaction = /^什么[？！!?…]*$/u.test(quoteText);
    if (!denialReaction && !surpriseReaction) return null;

    const start = Math.max(0, quote.start - 520);
    const context = source.slice(start, quote.start).join('');
    const anchorNames = (anchors || []).filter((anchor) => anchor?.certainty === 'explicit'
        && typeof anchor.speakerText === 'string' && anchor.speakerText.trim()
        && (anchor.utteranceSpans || []).some((span) => Number.isSafeInteger(span?.end) && span.end <= quote.start))
        .map((anchor) => anchor.speakerText);
    const names = [...new Set([...knownNames, ...anchorNames])]
        .filter((name) => typeof name === 'string' && name.trim()
            && !/^(?:你|我|他|她|它|众人|全员)$/u.test(name.trim()))
        .sort((left, right) => right.length - left.length);
    const candidates = [];
    const actionEvents = [];
    const addLocalActor = (name, localIndex) => {
        const value = String(name ?? '').trim();
        if (!value || isGenericCharacterNoun(value) || /^(?:然后|随后|同时|两条龙|双重龙息|传送术|法术)$/u.test(value)) return;
        const absoluteStart = start + Array.from(context.slice(0, localIndex)).length;
        candidates.push({ text: value, speakerSpan: { start: absoluteStart, end: absoluteStart + Array.from(value).length } });
    };
    for (const match of context.matchAll(/(?:^|[，,。！？!?；;\s—–-])(?<name>[\p{Script=Han}]{2,10})的(?:传送术|法术|施法|咒语)[^。！？!?]{0,36}(?:崩溃|失败|消散|中断|失效)/gu)) {
        const nameStart = match.index + match[0].indexOf(match.groups?.name || '');
        const actor = { text: match.groups?.name, speakerSpan: {
            start: start + Array.from(context.slice(0, nameStart)).length,
            end: start + Array.from(context.slice(0, nameStart)).length + Array.from(match.groups?.name || '').length,
        } };
        actionEvents.push({ end: match.index + match[0].length, actor });
    }
    for (const match of context.matchAll(/(?:击中|打中|击在|劈在|刺中|落在)(?<name>[\p{Script=Han}]{2,10})/gu)) {
        const nameStart = match.index + match[0].indexOf(match.groups.name);
        const actor = { text: match.groups.name, speakerSpan: {
            start: start + Array.from(context.slice(0, nameStart)).length,
            end: start + Array.from(context.slice(0, nameStart)).length + Array.from(match.groups.name).length,
        } };
        actionEvents.push({ end: match.index + match[0].length, actor });
    }
    // A named status line can anchor the immediately following pronoun-led
    // reaction when the target is explicit and no new subject intervenes.
    for (const match of context.matchAll(/(?<name>[\p{Script=Han}]{2,10})剩余\s*[`'“]?\d+(?:\.\d+)?\s*(?:HP|生命值)[`'”]?/giu)) {
        const nameStart = match.index + match[0].indexOf(match.groups.name);
        const reactionTail = context.slice(match.index + match[0].length);
        const reaction = /(?:^|[。！？!?;；\n])\s*(?<clause>(?:他|她)[^。！？!?;；\n]{0,80}(?:踉跄|后退|恐惧|惊恐|难以置信|不可能)[^。！？!?;；\n]{0,48}[：:]\s*)$/u.exec(reactionTail);
        if (reactionTail.length > 180 || !reaction?.groups?.clause
            || /(?:^|\n)\s*(?:#{1,6}\s|(?:新?场景|场景|scene|地点|location)\s*[:：])/iu.test(reactionTail)) continue;
        const actor = { text: match.groups.name, speakerSpan: {
            start: start + Array.from(context.slice(0, nameStart)).length,
            end: start + Array.from(context.slice(0, nameStart)).length + Array.from(match.groups.name).length,
        } };
        actionEvents.push({ end: match.index + match[0].length, actor });
    }
    for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const failedAction = new RegExp(`${escaped}的(?:传送术|法术|施法|咒语)[^。！？!?]{0,36}(?:崩溃|失败|消散|中断|失效)`, 'u');
        const hitTarget = new RegExp(`(?:龙息|攻击|剑|刀|箭|法术)[^。！？!?]{0,36}(?:击中|打中|击在|劈在|刺中|落在)${escaped}`, 'u');
        if (!failedAction.test(context) && !hitTarget.test(context)) continue;
        const localIndex = context.lastIndexOf(name);
        if (localIndex < 0) continue;
        const absoluteStart = start + Array.from(context.slice(0, localIndex)).length;
        const speakerSpan = { start: absoluteStart, end: absoluteStart + Array.from(name).length };
        const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, speakerSpan.end, quote.start);
        if (sceneBoundary != null && sceneBoundary >= speakerSpan.end) continue;
        const event = actionEvents.find(({ actor }) => actor.text === name);
        if (event) candidates.push({ text: name, speakerSpan });
    }
    // A short reaction belongs to the actor targeted by the immediately
    // preceding decisive action. Older targets in the same long message must
    // not compete with a nearer hit/failure event.
    const sceneSafeActionEvents = actionEvents.filter(({ actor }) => {
        const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, actor.speakerSpan.end, quote.start);
        return sceneBoundary == null || sceneBoundary < actor.speakerSpan.end;
    });
    const latestActionCandidates = actionEvents.length
        ? sceneSafeActionEvents.length
            ? sceneSafeActionEvents.filter((event) => event.end === Math.max(...sceneSafeActionEvents.map((item) => item.end)))
                .map((event) => event.actor)
            : []
        : candidates;
    const unique = uniqueStructuralActors(latestActionCandidates);
    return unique.length === 1 ? unique[0] : null;
}

function isStructuralAnonymousFirstAppearance(source, quote, prefixStart, suffixEnd) {
    const prefix = source.slice(prefixStart, quote.start).join('').trim();
    const suffix = source.slice(quote.end, suffixEnd).join('').trim();
    const directCue = /(?:说|问|喊|叫|尖叫|大喊|高喊|怒吼|低语|声音传来|声音响起|shout(?:ed|s|ing)?|say(?:s|ing)?|said|call(?:ed|s|ing)?|cry(?:ing|ies)?|voice)/iu;
    const anonymous = /(?:有人|对方|陌生人|未知来客|不明身影|矮小身影|小小身影|人影|身影|那个生物|某个生物|一个哥布林|哥布林|(?:一个|一名|一位)(?:虚空|黑暗|邪教)?(?:法师|术士|守卫|士兵|骑士|刺客|战士)|(?:(?:一个|一名|一位|那名|那个)\s*)?(?:[^，。！？!?;；\n]{0,18}的)?(?:女人|女子|男子|男人|女孩|男孩|女性|男性)|(?:一只|一个|一名|一位)[\p{Script=Han}]{1,12}(?:面具|身影|人形|生物|怪物|来客|声音)|[\p{Script=Han}]{1,14}(?:贵客|来客|访客|客人|小官|官员|军官|教官|守卫|卫兵|士兵|骑士|刺客|法师|术士|战士|弓手|弓箭手)|a goblin|the goblin|small goblin|a creature|the creature|someone|a small figure|the figure|a voice)/iu;
    const appearance = /(?:出现|冒出|晃了?一下|窜出|探出|走来|走入|进入|传来|响起|pops? out|popped out|appear(?:ed)?|emerge[ds]?|step(?:ped)? out|came out)/iu;
    const introducedAgentActs = /(?:转头|抬手|施放|施法|施展|拔剑|亮出武器|冲出来|迎上前|喊道|高喊|怒吼|尖叫)/u;
    if (anonymous.test(prefix) && directCue.test(prefix)) return !isStructuralQuotedInformationFrame(prefix, prefix);
    if (anonymous.test(suffix) && directCue.test(suffix)) return !isStructuralQuotedInformationFrame(suffix, suffix);
    // First-appearance narration followed immediately by the new entity's
    // opening line, including English NPC introductions. Keep the lookback
    // to one short paragraph and require a visible appearance cue.
    const initialWindowStart = Math.max(0, quote.start - 420);
    const boundary = findLatestStructuralSceneBoundaryEnd(source, initialWindowStart, quote.start);
    const start = boundary == null ? initialWindowStart : Math.max(initialWindowStart, boundary);
    const prior = source.slice(start, quote.start).join('').trim();
    return anonymous.test(prior) && (appearance.test(prior) || introducedAgentActs.test(prior))
        && !isStructuralQuotedInformationFrame(prior, prior);
}

function hasAnonymousReportedSpeechContinuation(source, unresolvedSpan, messageIndex) {
    if (!Array.isArray(source) || unresolvedSpan?.quoteClosed !== true
        || !Number.isSafeInteger(unresolvedSpan.quoteStart) || !Number.isSafeInteger(unresolvedSpan.quoteEnd)
        || unresolvedSpan.quoteStart < 0 || unresolvedSpan.quoteEnd <= unresolvedSpan.quoteStart
        || unresolvedSpan.quoteEnd > source.length) return false;
    const targetQuote = { start: unresolvedSpan.quoteStart, end: unresolvedSpan.quoteEnd };
    const targetText = source.slice(targetQuote.start + 1, targetQuote.end - 1).join('').trim();
    if ((targetText.match(/[\p{L}]{2,}/gu) || []).length < 2 || isNarrativeSoundEffectQuote(targetText)
        || isStructuralRecordShape(targetText)) return false;

    const quoteScan = findStructuralQuotedSpans(source);
    if (!quoteScan.reliable) return false;
    const precedingQuote = quoteScan.spans.filter((span) => span.end <= targetQuote.start).at(-1);
    if (!precedingQuote || precedingQuote.end <= precedingQuote.start + 2) return false;
    const priorUtterance = source.slice(precedingQuote.start + 1, precedingQuote.end - 1).join('').trim();
    if ((priorUtterance.match(/[\p{L}]{2,}/gu) || []).length < 2 || isNarrativeSoundEffectQuote(priorUtterance)) return false;

    const transition = source.slice(precedingQuote.end, targetQuote.start).join('').trim();
    if (!transition || Array.from(transition).length > 180 || containsStructuralQuoteMarker(transition)
        || findLatestStructuralSceneBoundaryEnd(source, precedingQuote.end, targetQuote.start) != null
        || isStructuralQuotedInformationFrame(transition, targetText)) return false;
    const anonymousReportedSpeech = /^(?:(?:it|he|she|the\s+(?:goblin|creature|monster|figure|stranger|voice))\s+(?:(?:then|again|suddenly)\s+)?(?:said|says|shouted|shouts|screeched|screams?|cried|called|growled|whispered|yelled|spat)\b|(?:它|他|她|那个(?:生物|身影|哥布林)|(?:一个|一名|一位)(?:陌生人|生物|哥布林))\s*(?:(?:随后|接着|突然|又|再次)\s*)?(?:说|问|喊|叫|尖叫|大喊|高喊|怒吼|低语|嘶声))[^。！？!?;；]{0,150}$/iu;
    if (!anonymousReportedSpeech.test(transition)) return false;

    const introductionStart = Math.max(0, precedingQuote.start - 420);
    const introduction = source.slice(introductionStart, precedingQuote.start).join('');
    const anonymousEntity = /\b(?:a|an|the)\s+(?:goblin|creature|monster|figure|stranger|voice)\b|(?:一个|一名|一位|某个|陌生人|不明身影|小小身影|人影|身影|生物|哥布林)/iu;
    const appearance = /\b(?:out\s+popped|popped\s+out|emerged|appeared|stepped\s+out|came\s+out)\b|(?:出现|冒出|窜出|探出|走来|传来|响起)/iu;
    if (!anonymousEntity.test(introduction) || !appearance.test(introduction)
        || isStructuralQuotedInformationFrame(introduction, introduction)) return false;

    const speakerEvidenceBetween = (messageIndex?.anchors || []).some((anchor) => (
        Array.isArray(anchor.utteranceSpans)
        && anchor.utteranceSpans.some((span) => Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
            && span.start < targetQuote.end && precedingQuote.start < span.end)
    ));
    return !speakerEvidenceBetween;
}

function findStructuralPronounBackreference({ source, quote, prefixStart, knownNames, anchors }) {
    let speakerTurnStart = prefixStart;
    for (let index = quote.start - 1; index >= prefixStart; index -= 1) {
        if (/[。！？!?;；\n]/u.test(source[index])) {
            speakerTurnStart = index + 1;
            break;
        }
    }
    while (speakerTurnStart < quote.start && /\s/u.test(source[speakerTurnStart])) speakerTurnStart += 1;
    let prefixText = source.slice(speakerTurnStart, quote.start).join('').trim().replace(/^[,，、]\s*/u, '');
    const localPrefixText = source.slice(prefixStart, quote.start).join('').trim()
        .replace(/^[”」』"'‘’\s]+/u, '').replace(/^[,，、]\s*/u, '');
    const priorParagraph = findStructuralPreviousParagraphSpan(source, quote.start, 100);
    const priorParagraphText = priorParagraph
        ? source.slice(priorParagraph.start, priorParagraph.end).join('').trim()
            .replace(/^[”」』"'‘’\s]+/u, '').replace(/[。！？!?;；\s]+$/u, '')
        : '';
    if (/^第[一二三四五六七八九十\d]+阶段(?:（[^）\r\n]{1,16}）)?[^。！？!?;；\r\n]{0,80}$/u.test(prefixText)) {
        const priorBlank = findLastStructuralParagraphBreak(source, Math.max(0, speakerTurnStart - 1));
        const earlierBlank = priorBlank > 0 ? findLastStructuralParagraphBreak(source, priorBlank - 1) : -1;
        const actionStart = earlierBlank + 2;
        const actionText = source.slice(actionStart, priorBlank < 0 ? speakerTurnStart : priorBlank).join('').trim();
        const isPronounActionHeadingBridge = /^(?:他|她)[^。！？!?;；\n]{0,28}(?:伸出|抬起|举起|指向|递出|递给|翻开|翻到|点头|转身|走到)[^。！？!?;；\n]{0,30}[：:]$/u.test(actionText);
        if (isPronounActionHeadingBridge) {
            const priorAnchors = [];
            for (const anchor of anchors || []) {
                if (anchor?.certainty !== 'explicit' || anchor.groupId
                    || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
                    || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
                const end = Math.max(-1, ...(anchor.utteranceSpans || [])
                    .filter((span) => isValidStructuralPageSpan(span, source.length) && span.end <= actionStart)
                    .map((span) => span.end));
                if (end < 0 || actionStart - end > 48
                    || findLatestStructuralSceneBoundaryEnd(source, end, actionStart) != null) continue;
                priorAnchors.push({ anchor, end });
            }
            const latestEnd = Math.max(-1, ...priorAnchors.map((item) => item.end));
            const latest = priorAnchors.filter((item) => item.end === latestEnd);
            const latestNames = uniqueStructuralActors(latest.map(({ anchor }) => ({
                text: anchor.speakerText,
                speakerSpan: anchor.speakerSpan,
            })));
            if (latestNames.length === 1) {
                const anchor = latest.find(({ anchor: item }) => item.speakerText === latestNames[0].text)?.anchor;
                if (anchor) return {
                    text: anchor.speakerText,
                    displayText: anchor.displaySpeakerText || anchor.speakerText,
                    speakerSpan: { ...anchor.speakerSpan },
                };
            }
        }
    }
    const connectedPronounClause = /^(?<lead>[^。！？!?;；\n]{1,48}[，,]\s*)(?:紧接着|随后|接着|然后|这时|此时|接下来)\s*(?<clause>[她他它](?:[^。！？!?;；\n]{0,80})(?:(?:低声说|轻声说|小声说|喃喃道|说道|问道|答道|喊道|说|问|答|喊|道)\s*[:：]?|[:：])\s*)$/u.exec(prefixText);
    const connectedPronounBackreference = Boolean(connectedPronounClause);
    const pronounActionBackreference = /^(?:(?:随后|接着|然后|这时|此时|接下来)\s*)?[她他它][^。！？!?;；\n]{1,96}[：:]\s*$/u.test(prefixText)
        && (NARRATIVE_DIALOGUE_ACTION_PATTERN.test(prefixText)
            || /(?:翻到|翻开|中箭|踉跄|后退|受伤|跌倒)/u.test(prefixText));
    const pronounNarrativeActionBackreference = [prefixText, localPrefixText, priorParagraphText].some((candidate) => (
        /^(?:(?:随后|接着|然后|这时|此时|接下来)\s*)?[她他它][^。！？!?;；\n]{1,96}$/u.test(candidate)
        && /(?:看向|望向|抬眼|抬头|转身|停下|咬紧牙关|脸色|神情|声音|嗓音|语气|低声|轻声|继续道)/u.test(candidate)
    ));
    if (connectedPronounClause
        && !(knownNames || []).some((name) => connectedPronounClause.groups.lead.includes(name))) {
        // Permit one short narrative clause followed by an explicit connective
        // and a pronoun-led speech clause (e.g. “声响清脆……，紧接着他喊：”).
        // The name itself still comes only from one nearby explicit anchor;
        // any named actor in the lead clause keeps this shape ambiguous.
        prefixText = connectedPronounClause.groups.clause.trim();
    }
    const hasPronounSpeechCue = [prefixText, localPrefixText, priorParagraphText].some((candidate) => (
        /^(?:(?:随后|接着|然后|这时|此时|接下来)\s*)?[她他它](?:[^。！？!?;；\n]{0,80})(?:(?:低声说|轻声说|小声说|喃喃道|说道|问道|答道|喊道|说|问|答|喊|道)\s*[:：]?|[:：])[，,]?\s*$/u.test(candidate)
    ));
    const simplePronounSpeechCue = [prefixText, localPrefixText, priorParagraphText].some((candidate) => (
        /^[她他](?:[^。！？!?;；\n]{0,48})(?:(?:低声说|轻声说|小声说|喃喃道|说道|问道|答道|喊道|说|问|答|喊|道)\s*[:：]?)[，,]?\s*$/u.test(candidate)
    ));
    if (!hasPronounSpeechCue && !pronounActionBackreference && !pronounNarrativeActionBackreference) return null;
    // Fallback: inspect no more than the two immediately preceding sentence
    // fragments and accept roster names or a single explicitly typed entity
    // noun at sentence starts. A newly named narrative subject outranks an
    // older completed speaker turn; a name merely mentioned inside a sentence
    // (for example, `走到 Lila 身边`) is ignored.
    let start = speakerTurnStart;
    let stops = 0;
    // Three preceding delimiters expose at most the two complete sentences
    // before the pronoun-led clause: the first delimiter closes sentence one,
    // the second closes sentence two, and the third marks their left edge.
    while (start > 0 && stops < 3) {
        start -= 1;
        if (/[。！？!?]/u.test(source[start])) stops += 1;
        if (source[start] === '\n' && source[start - 1] === '\n') break;
    }
    const sceneBoundaryEnd = findLatestStructuralSceneBoundaryEnd(source, start, speakerTurnStart);
    if (sceneBoundaryEnd != null) start = Math.max(start, sceneBoundaryEnd);
    const window = source.slice(start, speakerTurnStart);
    const candidates = [];
    let sentenceStart = 0;
    for (let index = 0; index <= window.length; index += 1) {
        if (index !== window.length && !/[。！？!?\n]/u.test(window[index])) continue;
        const segmentStart = sentenceStart;
        const segmentEnd = index;
        let contentStart = segmentStart;
        while (contentStart < segmentEnd && /[\s"“”「」『』'‘’—–-]/u.test(window[contentStart])) contentStart += 1;
        const content = window.slice(contentStart, segmentEnd);
        if (containsStructuralQuoteMarker(content.join(''))) {
            sentenceStart = index + 1;
            continue;
        }
        const sentenceNames = [];
        for (const name of knownNames || []) {
            const nameChars = Array.from(name);
            if (!nameChars.length || content.slice(0, nameChars.length).join('') !== name) continue;
            sentenceNames.push({ name, length: nameChars.length });
        }
        const sentenceName = sentenceNames.sort((left, right) => right.length - left.length)[0];
        if (sentenceName) {
            const absoluteStart = start + contentStart;
            candidates.push({ text: sentenceName.name, speakerSpan: { start: absoluteStart, end: absoluteStart + sentenceName.length } });
        } else {
            const contentText = content.join('');
            const descriptiveSubjectLead = contentText.match(/^(?:(?:但是|不过|然而|但|随后|接着|然后|这时|此时)\s*)?(?:(?:那个|这名|那名|一个|一名|某个|某位)\s*)/u)?.[0] || '';
            const descriptiveSubjectText = contentText.slice(Array.from(descriptiveSubjectLead).length);
            const descriptiveEntity = /^(?<speaker>[\p{Script=Han}]{1,8}(?:贵客|客人|来客|领队|队长|首领|统领|守卫|侍卫|护卫|士兵|骑士|法师|术士|长老|商人|猎人|船长|弓手|弩手|打手|刀手|枪手|矛手|斧手|公爵夫人|夫人|女士|先生|大人))(?<predicate>[^。！？!?;；\n]{1,64})$/u.exec(descriptiveSubjectText);
            const possessiveSubject = /^(?<speaker>(?:[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}|[\p{Script=Han}]{2,4}))\s*的(?:眼睛|目光|脸色|神情|表情|嘴角|眉头|笑容|肩膀|声音|手指|双手|呼吸)(?<predicate>[^。！？!?;；\n]{1,28})$/u.exec(contentText);
            if (descriptiveEntity?.groups?.speaker && descriptiveEntity.groups.predicate
                && !isGenericCharacterNoun(descriptiveEntity.groups.speaker)
                && !/^(?:的|所|被|与|和|及|在|于)/u.test(descriptiveEntity.groups.predicate)
                && !isStructuralQuotedInformationFrame(contentText, contentText.split(/[，,]/u).at(-1)?.trim() || contentText)) {
                const absoluteStart = start + contentStart + Array.from(descriptiveSubjectLead).length;
                const speakerLength = Array.from(descriptiveEntity.groups.speaker).length;
                candidates.push({
                    text: descriptiveEntity.groups.speaker,
                    speakerSpan: { start: absoluteStart, end: absoluteStart + speakerLength },
                });
            } else if (possessiveSubject?.groups?.speaker && !isGenericCharacterNoun(possessiveSubject.groups.speaker)
                && !isStructuralQuotedInformationFrame(contentText, contentText.split(/[，,]/u).at(-1)?.trim() || contentText)) {
                const absoluteStart = start + contentStart;
                const speakerLength = Array.from(possessiveSubject.groups.speaker).length;
                candidates.push({
                    text: possessiveSubject.groups.speaker,
                    speakerSpan: { start: absoluteStart, end: absoluteStart + speakerLength },
                });
            }
        }
        sentenceStart = index + 1;
    }
    const unique = uniqueStructuralActors(candidates);
    if (unique.length === 1) {
        const candidate = unique[0];
        let sentenceStart = candidate.speakerSpan.start;
        while (sentenceStart > start && !/[。！？!?;；\n]/u.test(source[sentenceStart - 1])) sentenceStart -= 1;
        let sentenceEnd = candidate.speakerSpan.end;
        while (sentenceEnd < speakerTurnStart && !/[。！？!?;；\n]/u.test(source[sentenceEnd])) sentenceEnd += 1;
        const candidateSentence = source.slice(sentenceStart, sentenceEnd);
        const competingNames = [...new Set(knownNames || [])].filter((name) => {
            if (name === candidate.text) return false;
            const nameChars = Array.from(name);
            for (let index = 0; index <= candidateSentence.length - nameChars.length; index += 1) {
                if (candidateSentence.slice(index, index + nameChars.length).join('') !== name) continue;
                const before = candidateSentence.slice(Math.max(0, index - 12), index).join('');
                // A locative mention such as “走到 Lila 身边” is not a
                // competing speaker subject; gaze/transfer targets remain
                // ambiguous because the following pronoun may refer to them.
                if (!/(?:走到|跑到|来到|靠近|走向|站在|坐在|蹲在|依偎在)\s*$/u.test(before)) return true;
            }
            return false;
        });
        if (!competingNames.length) return candidate;
        return null;
    }
    if (unique.length > 1) return null;

    // Quote continuation can be separated from its only explicit speaker by
    // several paragraphs/pages inside this one source message. For a
    // pronoun-led action ending at this quote, resolve only to the nearest
    // exact explicit anchor in the same scene. A tie between different
    // speakers, a mismatched source span, or any scene boundary fails closed.
    if (pronounActionBackreference || pronounNarrativeActionBackreference) {
        const nearestBySpeaker = new Map();
        const localSpeakerKeys = new Set();
        for (const anchor of anchors || []) {
            if (anchor?.certainty !== 'explicit' || anchor.groupId
                || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
                || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText
                || !Array.isArray(anchor.utteranceSpans)
                || /^(?:旁白|未识别|\?{2,}|你|我|他|她|它)$/u.test(anchor.speakerText)) continue;
            const end = Math.max(-1, ...anchor.utteranceSpans.filter((span) => (
                isValidStructuralPageSpan(span, source.length) && span.end <= prefixStart
            )).map((span) => span.end));
            if (end < 0 || findLatestStructuralSceneBoundaryEnd(source, end, prefixStart) != null) continue;
            const gap = source.slice(end, prefixStart).join('');
            if ((gap.match(/[。！？!?]/gu) || []).length <= 2) {
                localSpeakerKeys.add(normalizeStructuralSpeakerKey(anchor.speakerText));
            }
            const current = nearestBySpeaker.get(normalizeStructuralSpeakerKey(anchor.speakerText));
            if (!current || end > current.end) nearestBySpeaker.set(normalizeStructuralSpeakerKey(anchor.speakerText), { anchor, end });
        }
        if (localSpeakerKeys.size > 1) return null;
        const latestEnd = Math.max(-1, ...[...nearestBySpeaker.values()].map((item) => item.end));
        const latest = [...nearestBySpeaker.values()].filter((item) => item.end === latestEnd);
        const latestSpeakers = uniqueStructuralActors(latest.map(({ anchor }) => ({
            text: anchor.speakerText,
            displayText: anchor.displaySpeakerText || anchor.speakerText,
            speakerSpan: anchor.speakerSpan,
        })));
        if (latestEnd >= 0 && latestSpeakers.length === 1) {
            const item = latest.find(({ anchor }) => normalizeStructuralSpeakerKey(anchor.speakerText)
                === normalizeStructuralSpeakerKey(latestSpeakers[0].text));
            if (item) return {
                text: latestSpeakers[0].text,
                displayText: item.anchor.displaySpeakerText || item.anchor.speakerText,
                speakerSpan: { ...item.anchor.speakerSpan },
            };
        }
        return null;
    }

    // If there is no new rostered subject in the bounded window, a unique
    // nearby explicit speaker can carry a consecutive pronoun turn. The
    // explicit anchor stays bound to its original source-name span.
    const nearby = [];
    for (const anchor of anchors || []) {
        if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
            || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const span of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(span, source.length) || span.end > prefixStart) continue;
            const anchorSceneBoundary = findLatestStructuralSceneBoundaryEnd(source, span.end, prefixStart);
            if (anchorSceneBoundary != null) continue;
            if (sceneBoundaryEnd != null && span.end < sceneBoundaryEnd) continue;
            const gap = source.slice(span.end, prefixStart).join('');
            const stopCount = (gap.match(/[。！？!?]/gu) || []).length;
            if (stopCount <= 2 && (simplePronounSpeechCue || connectedPronounBackreference || pronounActionBackreference
                || pronounNarrativeActionBackreference || !/\n\s*\n/u.test(gap))) {
                nearby.push({ anchor, span, stopCount, distance: prefixStart - span.end });
            }
        }
    }
    // When several people spoke earlier in the same paragraph, the nearest
    // explicit turn is the useful antecedent for a pronoun-led speech cue.
    // Rank by intervening sentence stops first, then source distance; ties
    // between different speakers remain unresolved.
    const nearestStops = Math.min(...nearby.map((item) => item.stopCount), Number.POSITIVE_INFINITY);
    const sameTurnWindow = simplePronounSpeechCue
        ? nearby.filter((item) => item.stopCount === nearestStops) : nearby;
    const nearestDistance = simplePronounSpeechCue
        ? Math.min(...sameTurnWindow.map((item) => item.distance), Number.POSITIVE_INFINITY) : null;
    const uniqueNearby = uniqueStructuralActors((nearestDistance == null ? sameTurnWindow
        : sameTurnWindow.filter((item) => item.distance === nearestDistance)).map(({ anchor }) => anchor));
    if (uniqueNearby.length !== 1) return null;
    const anchor = uniqueNearby[0];
    return { text: anchor.text, speakerSpan: { ...anchor.speakerSpan } };
}

function findStructuralPostQuotePronounBackreference({ source, quote, knownNames = [], anchors = [] }) {
    const candidates = [];
    const nearbyAnchorNames = new Set((anchors || []).filter((anchor) => (
        anchor?.certainty === 'explicit' && Array.isArray(anchor.utteranceSpans)
        && anchor.utteranceSpans.some((span) => Number.isSafeInteger(span?.end)
            && span.end <= quote.start && quote.start - span.end <= 180)
    )).map((anchor) => normalizeStructuralSpeakerKey(anchor.speakerText)));
    if (nearbyAnchorNames.size > 1) return null;
    for (const anchor of anchors || []) {
        if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
            || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const span of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(span, source.length) || span.end > quote.start) continue;
            const gap = source.slice(span.end, quote.start).join('');
            if (Array.from(gap).length > 180) continue;
            const continuation = gap.replace(/^[”」』"’'\s,，、]*/u, '').trim();
            if (!/^(?:(?:随后|接着|然后|这时|此时)\s*)?[她他](?:[^。！？!?;；“”「」『』\n]{0,100})(?:说着|说道|问道|答道|喊道|说|问|答|喊)(?:[^“”「」『』]{0,40})$/u.test(continuation)) continue;
            const otherName = [...new Set(knownNames)].some((name) => name !== anchor.speakerText && continuation.includes(name));
            if (otherName || containsStructuralQuoteMarker(continuation)) continue;
            candidates.push({ text: anchor.speakerText, speakerSpan: anchor.speakerSpan });
        }
    }
    const unique = new Map();
    for (const candidate of candidates) {
        const key = normalizeStructuralSpeakerKey(candidate.text);
        if (key && !unique.has(key)) unique.set(key, candidate);
    }
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function findStructuralEntityPronounBackreference({ source, quote, prefixStart, anchors = [], quotes = [] }) {
    let prefix = source.slice(prefixStart, quote.start).join('').trim();
    let lineStart = quote.start - 1;
    while (lineStart >= 0 && source[lineStart] !== '\n') lineStart -= 1;
    const sourceLinePrefix = source.slice(lineStart + 1, quote.start).join('').trim();
    if (/^(?:(?:随后|接着|然后|这时|此时)\s*)?它/u.test(sourceLinePrefix)) prefix = sourceLinePrefix;
    const lastLine = prefix.slice(prefix.lastIndexOf('\n') + 1).trim();
    if (/^(?:(?:随后|接着|然后|这时|此时)\s*)?它/u.test(lastLine)) prefix = lastLine;
    prefix = prefix.replace(/[:：]\s*$/u, '').trimEnd();
    const uniqueOwnerClause = /^(?:(?:随后|接着|然后|这时|此时)\s*)?它从(?:龙鳞|鳞片|龙爪|龙翼|龙瞳|龙尾|龙角|龙息)[^。！？!?;；\n]{0,18}(?:取出|拿出|摘下|举起|伸出|收起|展开|低下|递出)[^。！？!?;；\n]{0,36}$/u.test(prefix);
    if (uniqueOwnerClause) {
        const latest = [];
        let latestEnd = -1;
        for (const anchor of anchors || []) {
            if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
                || /^(?:你|我|他|她|它|旁白|众人|全员)$/u.test(anchor.speakerText)
                || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
            for (const span of anchor.utteranceSpans || []) {
                if (!isValidStructuralPageSpan(span, source.length) || span.end > quote.start
                    || quote.start - span.end > 120
                    || findLatestStructuralSceneBoundaryEnd(source, span.end, quote.start) != null) continue;
                if (span.end > latestEnd) {
                    latestEnd = span.end;
                    latest.length = 0;
                }
                if (span.end === latestEnd) latest.push(anchor);
            }
        }
        const owner = uniqueStructuralActors(latest);
        if (owner.length === 1) return { ...owner[0], ruleId: 'pronoun-backreference' };
    }
    if (!/^(?:(?:随后|接着|然后|这时|此时)\s*)?它(?:的(?:语气|动作|声线|声音|目光|竖瞳|眼窝|身体)[^。！？!?;；\n]{0,48}|(?:看向|望向|凝视|咆哮|怒吼|低吼|转头|抬头|停顿|缓和|走向|取出|拿出|摘下|举起|伸出|收起|展开|低下|递出)[^。！？!?;；\n]{0,48}|(?:从[^。！？!?;；\n]{1,24})?(?:取出|拿出|摘下|举起|伸出|收起|展开|低下|递出)[^。！？!?;；\n]{0,48})$/u.test(prefix)) return null;

    const nearby = [];
    // The first quoted turn may use 它 before any quoted turn has established
    // the creature anchor. Bind only to one explicit creature type in this
    // same scene; an intervening heading ends the lookup.
    // Only use the local scene window. A same-message inventory/status block
    // can mention allied dragons far before the current actor and must not
    // steal an entity pronoun from the immediately preceding page.
    const lookbackStart = Math.max(0, prefixStart - 720);
    const priorText = source.slice(lookbackStart, prefixStart).join('');
    const creaturePattern = /(?<prefix>冰霜|寒冰|霜|古代|上古|巨型|火|冰|毒|黑|白|红|蓝|金|银|绿|雷|风|地)?(?<name>亚龙|巨龙|恶龙|飞龙|龙兽|魔兽|怪物|魔物|生物|巨兽|魔龙|龙)(?!魂|语|族|鳞|裔|脊|巢|骨)/giu;
    const creatureMentions = [...priorText.matchAll(creaturePattern)].filter((match) => {
        const matchStart = Array.from(priorText.slice(0, match.index)).length;
        return !(quotes || []).some((span) => matchStart >= span.start && matchStart < span.end);
    });
    const introducedUnit = findStructuralNamedUnitIntroduction(source, lookbackStart, prefixStart, quotes);
    const introducedUnitOffset = introducedUnit?.speakerSpan?.start ?? -1;
    const lastCreatureMentionAfterIntroduction = creatureMentions.find((match) => {
        const mentionStart = lookbackStart + Array.from(priorText.slice(0, match.index)).length;
        return introducedUnitOffset >= 0 && mentionStart > introducedUnitOffset;
    });
    const lastMention = introducedUnit && !lastCreatureMentionAfterIntroduction
        ? null : creatureMentions.at(-1);
    if (lastMention?.groups?.name) {
        const mentionEnd = lookbackStart + Array.from(priorText.slice(0, lastMention.index + lastMention[0].length)).length;
        const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, mentionEnd, prefixStart);
        if (mentionEnd > (sceneBoundary ?? 0)) {
            // In prose, an immediate 它 after an explicit creature mention
            // normally points to that nearest subject, even when an earlier
            // paragraph compared it to another dragon.
            const match = lastMention;
            const nameStart = lookbackStart + Array.from(priorText.slice(0, match.index + (match.groups.prefix || '').length)).length;
            const speakerText = match.groups.name;
            nearby.push({ text: speakerText, speakerSpan: { start: nameStart, end: nameStart + Array.from(speakerText).length } });
        }
    }
    if (introducedUnit) nearby.push(introducedUnit);
    for (const anchor of anchors || []) {
        if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
            || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        if (introducedUnit && anchor.speakerSpan.end <= introducedUnitOffset) continue;
        const speakerContext = source.slice(Math.max(0, anchor.speakerSpan.start - 720), anchor.speakerSpan.end + 100).join('');
        const typedCreature = /(?:亚龙|巨龙|恶龙|飞龙|龙兽|魔兽|怪物|魔物|生物|巨兽|魔龙|dragon|wyvern|beast|monster)$/iu.test(anchor.speakerText);
        const explicitlyNonHuman = /(?:冰霜巨人族|霜巨人族|冰霜巨人|霜巨人|巨人族|非人形|怪物|魔物|魔兽)/u.test(speakerContext);
        if (!typedCreature && !explicitlyNonHuman) continue;
        const priorSpans = (anchor.utteranceSpans || []).filter((span) => isValidStructuralPageSpan(span, source.length)
            && span.end <= prefixStart && prefixStart - span.end <= 240);
        for (const span of priorSpans) {
            const gap = source.slice(span.end, prefixStart).join('');
            if (findLatestStructuralSceneBoundaryEnd(source, span.end, prefixStart) != null) continue;
            const competingAnchor = (anchors || []).some((other) => other !== anchor
                && other?.certainty === 'explicit'
                && (/(?:亚龙|巨龙|恶龙|飞龙|龙兽|魔兽|怪物|魔物|生物|巨兽|魔龙|dragon|wyvern|beast|monster)$/iu.test(other.speakerText)
                    || /(?:冰霜巨人族|霜巨人族|冰霜巨人|霜巨人|巨人族|非人形|怪物|魔物|魔兽)/u.test(source.slice(Math.max(0, other.speakerSpan?.start - 720), (other.speakerSpan?.end || 0) + 100).join('')))
                && normalizeStructuralSpeakerKey(other.speakerText) !== normalizeStructuralSpeakerKey(anchor.speakerText)
                    && (other.utteranceSpans || []).some((otherSpan) => isValidStructuralPageSpan(otherSpan, source.length)
                    && otherSpan.start >= span.end && otherSpan.end <= prefixStart));
            if (!competingAnchor) nearby.push({ text: anchor.speakerText, speakerSpan: { ...anchor.speakerSpan } });
        }
    }
    const entityAction = /龙鳞|鳞片|龙爪|龙翼|龙瞳|龙尾|龙角|龙息/u.test(prefix);
    if (entityAction) {
        const recentExplicit = [];
        const recentAnySpeaker = [];
        let nearestEnd = -1;
        for (const anchor of anchors || []) {
            if (anchor?.certainty !== 'explicit' || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
                || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
            for (const span of anchor.utteranceSpans || []) {
                if (!isValidStructuralPageSpan(span, source.length) || span.end > quote.start
                    || quote.start - span.end > 140
                    || findLatestStructuralSceneBoundaryEnd(source, span.end, quote.start) != null) continue;
                if (span.end > nearestEnd) {
                    nearestEnd = span.end;
                    recentExplicit.length = 0;
                }
                if (span.end === nearestEnd) recentExplicit.push(anchor);
            }
        }
        const nearestActors = uniqueStructuralActors(recentExplicit);
        if (nearestActors.length === 1) nearby.push(nearestActors[0]);
        // A physical pronoun action on a uniquely owned creature-specific
        // object (for example, “它从龙鳞中取出…”) can continue the nearest
        // explicit speaker even when the dialogue itself does not repeat a
        // species label. The short distance and scene boundary checks above
        // still apply; player/narrator labels cannot become creature actors.
        if (!nearestActors.length) {
            for (const anchor of anchors || []) {
                if (anchor?.certainty !== 'explicit' || /^(?:你|我|他|她|它|旁白|众人|全员)$/u.test(anchor.speakerText)
                    || !isValidStructuralPageSpan(anchor.speakerSpan, source.length)
                    || source.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
                for (const span of anchor.utteranceSpans || []) {
                    if (!isValidStructuralPageSpan(span, source.length) || span.end > quote.start
                        || quote.start - span.end > 180
                        || findLatestStructuralSceneBoundaryEnd(source, span.end, quote.start) != null) continue;
                    recentAnySpeaker.push(anchor);
                }
            }
            const nearestAny = uniqueStructuralActors(recentAnySpeaker);
            if (nearestAny.length === 1) nearby.push(nearestAny[0]);
        }
    }
    const unique = uniqueStructuralActors(nearby);
    return unique.length === 1 ? unique[0] : null;
}

function findStructuralNamedUnitIntroduction(source, windowStart, end, quotes = []) {
    const sourceWindow = source.slice(windowStart, end).join('');
    const pattern = /(?:——|—|–)\s*(?<name>[\p{Script=Han}]{2,12})(?=[，,])/gu;
    const candidates = [];
    for (const match of sourceWindow.matchAll(pattern)) {
        const name = match.groups?.name;
        if (!name) continue;
        const localStart = match.index + match[0].indexOf(name);
        const absoluteStart = windowStart + Array.from(sourceWindow.slice(0, localStart)).length;
        const absoluteEnd = absoluteStart + Array.from(name).length;
        if (quotes.some((span) => absoluteStart >= span.start && absoluteStart < span.end)) continue;
        const before = source.slice(Math.max(windowStart, absoluteStart - 90), absoluteStart).join('');
        const after = source.slice(absoluteEnd, Math.min(end, absoluteEnd + 72)).join('');
        const introducesUnit = /(?:巨人|巨龙|亚龙|怪物|魔物|魔兽|生物|敌人|法师|首领|守护者)/u.test(before)
            && /(?:站起|苏醒|出现|走出|破开|跃出|显现|冲出|浮现|降临)/u.test(before)
            && /(?:巨人族|传奇英雄|守护者|首领|法师|队长|领队|Boss|级)/iu.test(after);
        if (!introducesUnit) continue;
        const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, absoluteEnd, end);
        if (sceneBoundary != null && sceneBoundary >= absoluteEnd) continue;
        candidates.push({ text: name, speakerSpan: { start: absoluteStart, end: absoluteEnd } });
    }
    // Several earlier units can be introduced in one assistant message. The
    // immediately preceding named introduction is the useful antecedent for
    // a following entity pronoun; distant earlier introductions must not make
    // the local reference ambiguous by themselves.
    return candidates.sort((left, right) => left.speakerSpan.start - right.speakerSpan.start).at(-1) || null;
}

function findLatestStructuralSceneBoundaryEnd(source, start, end) {
    let latest = null;
    let lineStart = start;
    while (lineStart < end) {
        let lineEnd = source.indexOf('\n', lineStart);
        if (lineEnd < 0 || lineEnd > end) lineEnd = end;
        const line = source.slice(lineStart, lineEnd).join('').trim();
        const inlineMarkdownTitle = /[。！？!?]\s*(#{1,6}\s+\S.*)$/u.test(line);
        const explicitTitle = /^(?:新?场景|场景|scene|地点|location)\s*[:：]\s*\S+/iu.test(line);
        const markdownTitle = /^#{1,6}\s+\S/u.test(line);
        const shapeTitle = isLikelyFirstPageSceneTitle(line);
        if (inlineMarkdownTitle || explicitTitle || markdownTitle || shapeTitle) {
            latest = lineEnd < end ? lineEnd + 1 : lineEnd;
        }
        lineStart = lineEnd + 1;
    }
    return latest;
}

function findLastStructuralParagraphBreak(source, beforeIndex) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    for (let index = Math.min(beforeIndex, chars.length - 1); index >= 1; index -= 1) {
        if (chars[index - 1] === '\n' && chars[index] === '\n') return index - 1;
    }
    return -1;
}

function findStructuralPreviousParagraphSpan(source, beforeIndex, maxLength = 100) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    const latestBreak = findLastStructuralParagraphBreak(chars, beforeIndex);
    if (latestBreak < 0) return null;
    const previousBreak = findLastStructuralParagraphBreak(chars, latestBreak);
    const start = previousBreak >= 0 ? previousBreak + 2 : Math.max(0, latestBreak - maxLength);
    if (latestBreak - start > maxLength) return null;
    return { start, end: latestBreak };
}

function uniqueStructuralActors(actors) {
    const unique = new Map();
    for (const actor of actors || []) {
        const key = normalizeStructuralSpeakerKey(actor?.speakerText || actor?.text);
        if (key && !unique.has(key)) unique.set(key, {
            text: actor.speakerText || actor.text,
            speakerSpan: actor.speakerSpan,
        });
    }
    return [...unique.values()];
}

function buildStructuralShapeClassificationEvidence(mapping, evidenceSpan, { sourceMessageIndex, sourceMessageHash, core }) {
    return {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: core,
        coreSpan: core,
        classificationEvidenceSpans: [evidenceSpan],
        kind: 'classification',
        classification: mapping.classification,
        text: mapping.text,
        speakers: [],
        ruleId: mapping.ruleId,
    };
}

function buildStructuralNarratorFallbackEvidence(reasonId, evidenceSpan, context) {
    const safeReasonId = new Set([
        'ambiguous-quote-structure',
        'conflicting-speaker-evidence',
        'open-quote-without-unique-speaker',
        'narrative-shape-with-unattributed-quote',
        'ambiguous-local-reference',
        'no-unique-speaker-evidence',
        'dialogue-shape-without-speaker',
    ]).has(reasonId) ? reasonId : 'no-unique-speaker-evidence';
    return {
        ...buildStructuralShapeClassificationEvidence({
            classification: 'narration',
            text: '旁白',
            // Reuse the existing renderer-supported neutral title rule. The
            // diagnostic reason below distinguishes fallback from a quote
            // that was positively classified as narrative framing.
            ruleId: 'narrative-framed-quote',
        }, evidenceSpan, context),
        diagnosticReasonId: safeReasonId,
    };
}

function normalizeStructuralSpeakerKey(value) {
    return String(value ?? '').normalize('NFC').toLocaleLowerCase();
}

function structuralSpeakerEvidencePriority(ruleId) {
    if ([
        'rostered-subject-quoted-clause', 'unrostered-action-attribution', 'quoted-attribution',
        'post-quote-attribution', 'local-speech-cue', 'quoted-character-reaction',
    ].includes(ruleId)) return 3;
    if (['pronoun-backreference', 'recent-action-backreference', 'named-reaction-backreference'].includes(ruleId)) return 2;
    return 1;
}

function preferMoreLocalStructuralSpeakerEvidence(units) {
    return units.filter((unit) => !units.some((other) => {
        if (unit === other || !unit.overlap || !other.overlap
            || !(unit.overlap.start < other.overlap.end && other.overlap.start < unit.overlap.end)
            || normalizeStructuralSpeakerKey(unit.speakerText) === normalizeStructuralSpeakerKey(other.speakerText)
            || (unit.groupId && unit.groupId === other.groupId)) return false;
        return structuralSpeakerEvidencePriority(other.ruleId) > structuralSpeakerEvidencePriority(unit.ruleId);
    }));
}

function trimStructuralSourceSpan(chars, start, end) {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > chars.length || end <= start) return null;
    let trimmedStart = start;
    let trimmedEnd = end;
    while (trimmedStart < trimmedEnd && /\s/u.test(chars[trimmedStart])) trimmedStart += 1;
    while (trimmedEnd > trimmedStart && /\s/u.test(chars[trimmedEnd - 1])) trimmedEnd -= 1;
    return trimmedStart < trimmedEnd ? { start: trimmedStart, end: trimmedEnd } : null;
}

function deduplicateStructuralMessageAnchors(anchors) {
    const result = [];
    for (const anchor of anchors.sort((left, right) => (
        left.utteranceSpans[0].start - right.utteranceSpans[0].start
        || left.utteranceSpans[0].end - right.utteranceSpans[0].end
    ))) {
        const duplicate = result.find((existing) => {
            const left = existing.utteranceSpans[0];
            const right = anchor.utteranceSpans[0];
            const sameSpeaker = normalizeStructuralSpeakerKey(existing.speakerText) === normalizeStructuralSpeakerKey(anchor.speakerText);
            const overlaps = left.start < right.end && right.start < left.end;
            const contains = (left.start <= right.start && left.end >= right.end)
                || (right.start <= left.start && right.end >= left.end);
            return sameSpeaker && overlaps && contains;
        });
        if (!duplicate) result.push(anchor);
        else if (anchor.ruleId === 'quoted-attribution' || anchor.ruleId === 'post-quote-attribution') {
            Object.assign(duplicate, anchor);
        }
    }
    return result;
}

function scanStructuralMessageQuotes(source) {
    const stack = [];
    const spans = [];
    const allSpans = [];
    const ambiguousSpans = [];
    const asciiSingleQuoteRanges = findPairedAsciiSingleQuoteRanges(source);
    const asciiSingleQuoteStarts = new Map(asciiSingleQuoteRanges.map((range) => [range.start, range.end]));
    const asciiSingleQuoteEnds = new Set(asciiSingleQuoteRanges.map((range) => range.end - 1));
    const recoverUnclosedTail = (open, limitEnd) => {
        const recovered = {
            quoteId: open.quoteId, parentQuoteId: open.parentQuoteId || null,
            start: open.start, end: limitEnd, closed: false, recoveredAtSentenceLimit: true,
        };
        spans.push(recovered);
        allSpans.push(recovered);
        const suffix = scanStructuralMessageQuotes(source.slice(limitEnd));
        const offsetSpan = (span) => ({
            ...span,
            start: span.start + limitEnd,
            end: span.end + limitEnd,
            quoteId: `quote:${span.start + limitEnd}`,
            parentQuoteId: span.parentQuoteId
                ? `quote:${Number(span.parentQuoteId.slice('quote:'.length)) + limitEnd}` : null,
        });
        spans.push(...suffix.spans.map(offsetSpan));
        allSpans.push(...suffix.allSpans.map(offsetSpan));
        ambiguousSpans.push(...suffix.ambiguousSpans.map((span) => ({ ...span, start: span.start + limitEnd, end: span.end + limitEnd })));
        return {
            spans: spans.sort((left, right) => left.start - right.start),
            allSpans: allSpans.sort((left, right) => left.start - right.start),
            ambiguousSpans,
        };
    };
    const sentenceLimitEnd = (open) => {
        let stops = 0;
        for (let cursor = open.start + 1; cursor < source.length; cursor += 1) {
            if (!/[。！？!?]/u.test(source[cursor])) continue;
            stops += 1;
            if (stops === 2) return cursor + 1;
        }
        return source.length;
    };
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (asciiSingleQuoteStarts.has(index)) {
            stack.push({ close: "'", start: index, quoteId: `quote:${index}`, parentQuoteId: stack.at(-1)?.quoteId || null });
            continue;
        }
        if (asciiSingleQuoteEnds.has(index)) {
            if (stack.at(-1)?.close !== "'") {
                ambiguousSpans.push({ start: stack[0]?.start ?? index, end: source.length });
                break;
            }
            const opening = stack.pop();
            const span = { ...opening, end: index + 1, closed: true };
            delete span.close;
            allSpans.push(span);
            if (!stack.length) {
                spans.push(span);
            }
            continue;
        }
        if (char === "'") continue;
        if (char === '"') {
            if (stack.at(-1)?.close === '"') {
                const opening = stack.pop();
                const span = { ...opening, end: index + 1, closed: true };
                delete span.close;
                allSpans.push(span);
                if (!stack.length) {
                    spans.push(span);
                }
            } else if (!stack.length && isOrphanAsciiQuoteCloser(source, index)) {
                // A stray closing quote at the end of an unquoted line must
                // not become an opener and shift every later dialogue pair.
                continue;
            } else {
                stack.push({ close: '"', start: index, quoteId: `quote:${index}`, parentQuoteId: stack.at(-1)?.quoteId || null });
            }
            continue;
        }
        if (isCurlySingleQuoteApostrophe(source, index)) continue;
        if (STRUCTURAL_QUOTE_OPENERS.has(char)) {
            stack.push({ close: STRUCTURAL_QUOTE_OPENERS.get(char), start: index, quoteId: `quote:${index}`, parentQuoteId: stack.at(-1)?.quoteId || null });
            continue;
        }
        if (!STRUCTURAL_QUOTE_OPENERS.has(char) && STRUCTURAL_QUOTE_CLOSERS.has(char)) {
            if (stack.at(-1)?.close !== char) {
                ambiguousSpans.push({ start: stack[0]?.start ?? index, end: source.length });
                break;
            }
            const opening = stack.pop();
            const span = { ...opening, end: index + 1, closed: true };
            delete span.close;
            allSpans.push(span);
            if (!stack.length) {
                spans.push(span);
            }
        }
    }
    if (!ambiguousSpans.length && stack.length === 1) {
        // Unmatched openers are force-closed after two sentence stops without
        // changing source text, production page segmentation, or page spans.
        const open = stack[0];
        const end = sentenceLimitEnd(open);
        return recoverUnclosedTail(open, end);
    } else if (!ambiguousSpans.length && stack.length > 1) {
        ambiguousSpans.push({ start: stack[0].start, end: source.length });
    }
    return {
        spans: spans.sort((left, right) => left.start - right.start),
        allSpans: allSpans.sort((left, right) => left.start - right.start),
        ambiguousSpans,
    };
}

function findStructuralSentenceContextEnd(source, start) {
    const limit = Math.min(source.length, start + 240);
    for (let cursor = start; cursor < limit; cursor += 1) {
        if (/[。！？!?\n]/u.test(source[cursor])) return cursor + 1;
    }
    return limit;
}

function findStructuralUniquePriorSentenceActionSpeaker(source, quote, publishedSpeakerNames = []) {
    let end = quote.start;
    while (end > 0 && /\s/u.test(source[end - 1])) end -= 1;
    if (end <= 0 || !/[。！？!?;；]/u.test(source[end - 1])) return null;
    end -= 1;
    const maxStart = Math.max(0, end - 180);
    let start = end;
    while (start > maxStart && !/[。！？!?;；\n]/u.test(source[start - 1])) start -= 1;
    if (start === maxStart && start > 0 && !/[。！？!?;；\n]/u.test(source[start - 1])) return null;
    const sentence = source.slice(start, end).join('').trim();
    if (!sentence || containsStructuralQuoteMarker(sentence)
        || /^(?:随后|紧接着|接着|然后|这时|此时|接下来)[她他它]/u.test(sentence)
        || isLikelyStandalonePresentationHeading(sentence)
        || isStructuralQuotedInformationFrame(sentence, sentence)
        || isStructuralMentalOrSourceTransferFrame(sentence)
        || isStructuralRecordShape(sentence)
        || hasCoordinatedSubjectsBeforeAction(sentence, publishedSpeakerNames)) return null;
    // A name at sentence start is not enough: static descriptions must not
    // make that person own the following quote. Keep only a locally parsed
    // action or speech subject from the preceding sentence.
    const subject = findStructuralUniqueActionSubjectInClauses(sentence, publishedSpeakerNames);
    if (!subject || isGenericCharacterNoun(subject.text) || isStructuralAnonymousSpeakerDescription(subject.text)
        || /^(?:随后|紧接着|接着|然后|这时|此时|接下来)[她他它]$/u.test(subject.text)
        || /^(?:旁白|叙述|系统|地图|账本|信件|报告|屏幕|你|我|他|她|它)$/u.test(subject.text)) return null;
    const subjectTail = Array.from(sentence).slice(subject.end).join('').trimStart();
    if (/^(?:地|的)/u.test(subjectTail)
        || /^(?:只)?(?:用|以|通过|借助)[^，,。！？!?;；\n]{0,18}(?:声音|嗓音|语气)/u.test(sentence)) return null;
    const speakerSpan = {
        start: start + subject.start,
        end: start + subject.end,
    };
    if (!isValidStructuralPageSpan(speakerSpan, source.length)
        || source.slice(speakerSpan.start, speakerSpan.end).join('') !== subject.text) return null;
    return { text: subject.text, speakerSpan, contextSpan: { start, end } };
}

function findStructuralExpandedExplicitQuoteSignatures({ source, quote, quotes = [], knownNames = [] } = {}) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    if (!quote?.closed || !isValidStructuralPageSpan(quote, chars.length)) return [];
    const otherQuotes = quotes.filter((item) => item?.quoteId !== quote.quoteId
        && isValidStructuralPageSpan(item, chars.length));
    const hasOtherQuoteBetween = (start, end) => otherQuotes.some((item) => (
        item.start < end && start < item.end
    ));
    const isInsideQuote = (position) => otherQuotes.some((item) => item.start <= position && position < item.end);
    const isSentenceStop = (char) => /[。！？!?;；]/u.test(char);
    const findPreviousStop = (from) => {
        for (let index = from; index >= 0; index -= 1) {
            if (isInsideQuote(index)) {
                const containing = otherQuotes.find((item) => item.start <= index && index < item.end);
                if (containing) index = containing.start;
                continue;
            }
            if (isSentenceStop(chars[index])) return index;
        }
        return -1;
    };

    const priorSentences = [];
    const lastStop = findPreviousStop(quote.start - 1);
    if (lastStop >= 0) {
        let end = lastStop;
        for (let distance = 1; distance <= 2; distance += 1) {
            const previousStop = findPreviousStop(end - 1);
            const start = previousStop + 1;
            const span = trimStructuralSourceSpan(chars, start, end);
            if (span) priorSentences.push({ span, distance });
            if (previousStop < 0) break;
            end = previousStop;
        }
    }

    const readExplicitSentenceSignature = (span) => {
        const text = chars.slice(span.start, span.end).join('');
        if (!text || containsStructuralQuoteMarker(text)
            || isLikelyStandalonePresentationHeading(text)
            || isStructuralQuotedInformationFrame(text, text)
            || isStructuralRecordShape(text)) return { hasCue: false, candidate: null };
        const cue = findTrailingSpeechCue(text);
        if (!cue) return { hasCue: false, candidate: null };
        const parsed = findStructuralSpeakerInPrefix(Array.from(text), knownNames);
        if (!parsed || !isValidStructuralPageSpan(parsed, Array.from(text).length)) {
            return { hasCue: true, candidate: null };
        }
        const name = Array.from(text).slice(parsed.start, parsed.end).join('');
        if (!name || isGenericCharacterNoun(name) || isStructuralAnonymousSpeakerDescription(name)) {
            return { hasCue: true, candidate: null };
        }
        return {
            hasCue: true,
            candidate: {
                text: name,
                speakerSpan: { start: span.start + parsed.start, end: span.start + parsed.end },
                evidenceSpan: span,
            },
        };
    };

    // A named speech tag in the sentence immediately after the quote is a
    // stronger attachment than an older nearby signature, but only when no
    // other quote or scene boundary intervenes. Also tolerate punctuation
    // placed outside the closing quote (`“…”。Name replied`).
    const findPostQuoteSignature = () => {
        let cursor = quote.end;
        let sentenceDistance = 0;
        let bridgeHasSpeechCue = false;
        while (cursor < chars.length && sentenceDistance < 2) {
            while (cursor < chars.length && /[\s。！？!?;；,，、:：]/u.test(chars[cursor])) cursor += 1;
            if (cursor >= chars.length) return { candidate: null, blocked: false };
            const nextQuote = otherQuotes.find((item) => item.start >= cursor);
            const limit = nextQuote ? Math.min(chars.length, nextQuote.start) : chars.length;
            let end = cursor;
            while (end < limit && !isSentenceStop(chars[end])) end += 1;
            const span = trimStructuralSourceSpan(chars, cursor, end);
            if (!span) {
                if (end >= limit) return { candidate: null, blocked: Boolean(nextQuote) };
                cursor = end + 1;
                continue;
            }
            sentenceDistance += 1;
            if (hasOtherQuoteBetween(quote.end, span.start)
                || findLatestStructuralSceneBoundaryEnd(chars, quote.end, span.start) != null) {
                return { candidate: null, blocked: true };
            }
            const text = chars.slice(span.start, span.end).join('');
            if (isStructuralQuotedInformationFrame(text, text) || isStructuralRecordShape(text)) {
                return { candidate: null, blocked: true };
            }
            const hasCue = Boolean(findTrailingSpeechCue(text));
            if (hasCue) {
                const parsed = findStructuralSpeakerInPrefix(Array.from(text), knownNames);
                if (!parsed || !isValidStructuralPageSpan(parsed, Array.from(text).length)) {
                    return { candidate: null, blocked: true };
                }
                const name = Array.from(text).slice(parsed.start, parsed.end).join('');
                if (!name || isGenericCharacterNoun(name) || isStructuralAnonymousSpeakerDescription(name)) {
                    return { candidate: null, blocked: true };
                }
                return { candidate: {
                    text: name,
                    speakerSpan: { start: span.start + parsed.start, end: span.start + parsed.end },
                    evidenceSpan: { start: quote.end, end: span.end },
                    sentenceDistance,
                    postQuote: true,
                }, blocked: false };
            }
            if (sentenceDistance >= 2 || hasCue || containsStructuralQuoteMarker(text)
                || hasOtherQuoteBetween(quote.end, span.end)) return { candidate: null, blocked: true };
            bridgeHasSpeechCue = bridgeHasSpeechCue || hasCue;
            if (end >= limit) return { candidate: null, blocked: Boolean(nextQuote) };
            cursor = end + 1;
        }
        return { candidate: null, blocked: bridgeHasSpeechCue };
    };

    const postQuote = findPostQuoteSignature();
    if (postQuote.candidate) return [postQuote.candidate];

    // The closest complete prior sentence wins. A quote turn, explicit speech
    // cue with an unresolvable subject, carrier frame, or scene break blocks
    // a more distant signature, preventing adjacent speakers from bleeding
    // into this quote.
    for (const { span } of priorSentences) {
        if (hasOtherQuoteBetween(span.end, quote.start)
            || findLatestStructuralSceneBoundaryEnd(chars, span.end, quote.start) != null) break;
        const bridge = chars.slice(span.end, quote.start).join('');
        const bridgeSentences = bridge.split(/[。！？!?;；\n]+/u).map((item) => item.trim()).filter(Boolean);
        if (bridgeSentences.some((sentence) => isStructuralQuotedInformationFrame(sentence, sentence)
            || isStructuralRecordShape(sentence))) break;
        const parsed = readExplicitSentenceSignature(span);
        if (parsed.hasCue) return parsed.candidate ? [parsed.candidate] : [];
    }
    return [];
}

function findStructuralAdjacentKnownNameSpeechCue({ source, quote, quotes = [], knownNames = [], allowUnrostered = false } = {}) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    if (!quote?.closed || !isValidStructuralPageSpan(quote, chars.length)) return null;
    const validNames = [...new Set(knownNames)]
        .filter((name) => typeof name === 'string' && name.trim() && !isStructuralAnonymousSpeakerDescription(name)
            && !isStructuralInformationLabel(name)
            && !/^(?:你|我|他|她|它|我们|你们|他们|她们|旁白|叙述|系统|众人|全员|人群)$/u.test(name))
        .sort((left, right) => Array.from(right).length - Array.from(left).length);
    if (!validNames.length && !allowUnrostered) return null;

    const quoteSpans = quotes.filter((item) => isValidStructuralPageSpan(item, chars.length));
    const otherQuotes = quoteSpans.filter((item) => item.quoteId !== quote.quoteId);
    const stop = (char) => /[。！？!?;；\n]/u.test(char);
    const findBoundary = (from, direction) => {
        for (let index = from; index >= 0 && index < chars.length; index += direction) {
            const containing = quoteSpans.find((item) => item.start <= index && index < item.end);
            if (containing) {
                index = direction < 0 ? containing.start : containing.end - 1;
                continue;
            }
            if (stop(chars[index])) return index;
        }
        return direction < 0 ? -1 : chars.length;
    };
    const previousStop = findBoundary(quote.start - 1, -1);
    const currentStart = previousStop + 1;
    const currentStop = findBoundary(quote.end, 1);
    const previousPreviousStop = previousStop >= 0 ? findBoundary(previousStop - 1, -1) : -1;
    const nextStart = currentStop + 1;
    const nextStop = currentStop < chars.length ? findBoundary(nextStart, 1) : chars.length;
    const regions = [
        previousStop >= 0 ? { start: previousPreviousStop + 1, end: previousStop, distance: 1 } : null,
        { start: currentStart, end: currentStop < chars.length ? currentStop : chars.length, distance: 0 },
        currentStop < chars.length ? { start: nextStart, end: nextStop < chars.length ? nextStop : chars.length, distance: 1 } : null,
    ].filter(Boolean).filter((span) => trimStructuralSourceSpan(chars, span.start, span.end));
    const cues = [...STRUCTURAL_SPEECH_CUES, ...STRUCTURAL_ENGLISH_SPEECH_CUES]
        .sort((left, right) => Array.from(right).length - Array.from(left).length)
        .map((text) => ({ text, chars: Array.from(text) }));
    const isQuoted = (start, end) => quoteSpans.some((item) => item.start < end && start < item.end);
    const candidates = [];

    for (const region of regions) {
        const text = chars.slice(region.start, region.end).join('').trim();
        const span = trimStructuralSourceSpan(chars, region.start, region.end);
        if (!span || !text || isLikelyStandalonePresentationHeading(text)
            || isStructuralQuotedInformationFrame(text, text) || isStructuralRecordShape(text)
            || otherQuotes.some((item) => item.start < span.end && span.start < item.end)) continue;
        const contextStart = Math.min(span.start, quote.start);
        const contextEnd = Math.max(span.end, quote.end);
        if (findLatestStructuralSceneBoundaryEnd(chars, contextStart, contextEnd) != null) continue;

        for (let cueStart = span.start; cueStart < span.end; cueStart += 1) {
            const cue = cues.find((item) => chars.slice(cueStart, cueStart + item.chars.length).join('') === item.text);
            if (!cue || cueStart + cue.chars.length > span.end
                || isQuoted(cueStart, cueStart + cue.chars.length)) continue;
            const cueEnd = cueStart + cue.chars.length;
            const prefixStart = Math.max(span.start, cueStart - 52);
            const cuePrefix = chars.slice(prefixStart, cueStart).join('');
            if (!cuePrefix.trim() || /(?:^|[，,])\s*(?:有人|某人|他|她|它|众人|大家|对方)\s*(?:.{0,12})?$/u.test(cuePrefix)) continue;
            const nameOccurrences = [];
            for (let nameStart = prefixStart; nameStart < cueStart; nameStart += 1) {
                if (isQuoted(nameStart, nameStart + 1)) continue;
                const name = validNames.find((candidate) => (
                    chars.slice(nameStart, nameStart + Array.from(candidate).length).join('') === candidate
                ));
                if (!name) continue;
                const nameEnd = nameStart + Array.from(name).length;
                if (nameEnd > cueStart || cueStart - nameEnd > 52 || isQuoted(nameStart, nameEnd)) continue;
                if (/^[A-Za-z0-9]/u.test(name) && /[A-Za-z0-9]/u.test(chars[nameStart - 1] || '')) continue;
                if (/^[A-Za-z0-9]/u.test(name) && /[A-Za-z0-9]/u.test(chars[nameEnd] || '')) continue;
                nameOccurrences.push({ text: name, start: nameStart, end: nameEnd });
                nameStart = nameEnd - 1;
            }
            const distinctNames = new Map(nameOccurrences.map((item) => [normalizeStructuralSpeakerKey(item.text), item]));
            if (distinctNames.size === 1) {
                const speaker = [...distinctNames.values()][0];
                const between = chars.slice(speaker.end, cueStart).join('');
                const trailingFrameSubject = between.split(/[，,]/u).at(-1)?.trim()
                    .replace(/(?:(?:低声|轻声|小声|高声|大声|柔声|冷声|随后|接着|然后|这时|此时|接下来))*$/u, '');
                if (!(/[。！？!?;；“”「」『』"']/u.test(between)
                    || /(?:^|[，,])\s*(?:他|她|它|有人|某人|另一人|对方|众人|大家)(?=$|[，,])/u.test(between)
                    || isGenericCharacterNoun(trailingFrameSubject)
                    || isStructuralAnonymousSpeakerDescription(trailingFrameSubject))) {
                    const distanceToQuote = cueEnd <= quote.start ? quote.start - cueEnd
                        : cueStart >= quote.end ? cueStart - quote.end : 0;
                    candidates.push({
                        text: speaker.text,
                        speakerSpan: { start: speaker.start, end: speaker.end },
                        evidenceSpan: { start: speaker.start, end: cueEnd },
                        sentenceDistance: region.distance,
                        distanceToQuote,
                    });
                }
            }
            if (allowUnrostered) {
                const cueBoundSpeaker = findStructuralLeadingSubjectForCue(text, span.start, cueStart - span.start, knownNames);
                if (cueBoundSpeaker) {
                    const cueDistanceToQuote = cueEnd <= quote.start ? quote.start - cueEnd
                        : cueStart >= quote.end ? cueStart - quote.end : 0;
                    candidates.push({
                        text: cueBoundSpeaker.text,
                        speakerSpan: cueBoundSpeaker.speakerSpan,
                        evidenceSpan: { start: cueBoundSpeaker.speakerSpan.start, end: cueEnd },
                        sentenceDistance: region.distance,
                        distanceToQuote: cueDistanceToQuote,
                    });
                }
            }
        }
    }

    if (!candidates.length) return null;
    candidates.sort((left, right) => left.sentenceDistance - right.sentenceDistance
        || left.distanceToQuote - right.distanceToQuote);
    const best = candidates.filter((item) => item.sentenceDistance === candidates[0].sentenceDistance
        && item.distanceToQuote === candidates[0].distanceToQuote);
    const unique = new Map(best.map((item) => [normalizeStructuralSpeakerKey(item.text), item]));
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function isStructuralQuotedReadoutFrameV78(source, quote) {
    if (!Array.isArray(source) || quote?.closed !== true || !isValidStructuralPageSpan(quote, source.length)) return false;
    const end = quote.start;
    let start = Math.max(0, end - 420);
    const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, start, end);
    if (sceneBoundary != null) start = sceneBoundary;
    const previousQuote = findStructuralQuotedSpans(source.slice(start, end)).spans.at(-1);
    if (previousQuote) start += previousQuote.end;
    const text = source.slice(start, end).join('');
    if (!text || containsStructuralQuoteMarker(text)) return false;
    const sentences = text.split(/(?<=[。！？!?;；\n])/u).map((item) => item.trim()).filter(Boolean).slice(-4);
    const window = sentences.join(' ');
    const carrier = /(?:地图|图|羊皮纸|卷轴|信件|信纸|信|账本|账页|记录册|记录|日志|报告|公告|文书|清单|碑文|石碑|牌子|告示|面板|屏幕|铭文|纸条|便笺|书页)/u;
    const reading = /(?:读|阅读|扫读|翻阅|浏览|查看|检查|翻看|翻开|展开|打开|摊开|审阅)/u;
    const readoutBridge = /(?:内容|上面|里面|信上|纸上|图上|地图上|卷轴上|记录中|文字|字迹)(?:[^。！？!?;；]{0,56})(?:[:：]|如下|写着|写道|显示|注明|是)/u;
    const finalClause = sentences.at(-1) || '';
    if (!carrier.test(window) || !reading.test(window) || !readoutBridge.test(window)
        || findTrailingSpeechCue(finalClause.replace(/[:：]\s*$/u, ''))) return false;
    return true;
}

function findStructuralSummaryReporterV78(prefixText, publishedSpeakerNames = [], parserVersion = '') {
    const prefix = String(prefixText ?? '').trim();
    if (!prefix || !/[:：]$/u.test(prefix)
        || isStructuralQuotedInformationFrame(prefix, prefix.replace(/[:：]$/u, ''))
        || isStructuralMentalOrSourceTransferFrame(prefix)) return null;
    const match = /(?:^|[，,。！？!?;；\n])(?<subject>[^，,。！？!?;；:：\n]{1,28}?)(?:总结|概括|归纳|归结)(?:了一句|道|说)?[:：]$/u.exec(prefix);
    if (!match?.groups?.subject) return null;
    const subject = match.groups.subject.trim();
    if (!subject) return null;
    const synthetic = `${subject}说道`;
    const candidate = findStructuralSpeakerInPrefix(Array.from(synthetic), publishedSpeakerNames, parserVersion);
    if (!candidate || isStructuralUnrosteredPersonDescriptor(candidate.text)
        || isGenericCharacterNoun(candidate.text)
        || /^(?:旁白|叙述|角色|状态|系统|日志|报告|记录)$/u.test(candidate.text)) return null;
    const subjectStart = prefix.lastIndexOf(subject);
    const start = Array.from(prefix.slice(0, subjectStart)).length + candidate.start;
    return {
        text: candidate.text,
        displayText: candidate.displayText || candidate.text,
        start,
        end: start + Array.from(candidate.text).length,
        ruleId: 'summary-reporting-attribution',
    };
}

function hasAnonymousPronounActionQuoteContinuation(source, quote, unresolvedSpans = [], quoteSpans = [], anchors = []) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return false;
    const priorQuote = quoteSpans.filter((span) => span.end <= quote.start).at(-1);
    if (!priorQuote || !isValidStructuralPageSpan(priorQuote, source.length)) return false;
    const priorUnresolved = unresolvedSpans.find((span) => span.quoteStart === priorQuote.start
        && span.quoteEnd === priorQuote.end && span.reasonId === 'anonymous-first-appearance');
    if (!priorUnresolved) return false;
    const transition = source.slice(priorQuote.end, quote.start).join('').trim();
    if (!transition || Array.from(transition).length > 180 || containsStructuralQuoteMarker(transition)
        || findLatestStructuralSceneBoundaryEnd(source, priorQuote.end, quote.start) != null
        || isStructuralQuotedInformationFrame(transition, source.slice(quote.start + 1, quote.end - 1).join(''))) return false;
    if (!isStructuralAnonymousPostQuoteSpeaker(source, priorQuote)) return false;
    let actionEnd = quote.end;
    while (actionEnd < source.length && actionEnd - quote.end <= 180
        && !/[。！？!?;；\r\n“「『"]/u.test(source[actionEnd])) actionEnd += 1;
    const suffix = source.slice(quote.end, actionEnd).join('').trim()
        .replace(/^[\s*_~]+/u, '').replace(/[\s*_~]+$/u, '');
    const actionText = suffix.replace(/[。！？!?]+$/u, '');
    if (!actionText || /[。！？!?;；\r\n]/u.test(actionText)
        || !/^(?:它|他|她)(?=[^。！？!?;；\r\n]{1,160}$)/u.test(actionText)
        || !NARRATIVE_DIALOGUE_ACTION_PATTERN.test(actionText)
        || isStructuralQuotedInformationFrame(suffix, suffix)
        || findLatestStructuralSceneBoundaryEnd(source, quote.end, actionEnd) != null) return false;
    return !(anchors || []).some((anchor) => (anchor?.utteranceSpans || []).some((span) => (
        isValidStructuralPageSpan(span, source.length) && span.start < actionEnd && priorQuote.end < span.end
    )));
}

function findStructuralPostQuoteSpeechClause(source, quote) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    let start = quote.end;
    while (start < source.length && /[\s*_~]/u.test(source[start]) && start - quote.end <= 8) start += 1;
    if (start - quote.end > 8 || start >= source.length) return null;
    let limit = start;
    while (limit < source.length && limit - start <= 88 && !/[。！？!?;；\r\n“「『"]/u.test(source[limit])) limit += 1;
    const raw = source.slice(start, limit).join('');
    const ends = [...raw.matchAll(/[,，]/gu).map((match) => match.index), raw.length];
    for (const end of ends) {
        const clause = raw.slice(0, end).trim();
        if (!clause || Array.from(clause).length > 64) continue;
        const cue = findTrailingSpeechCueV77(clause);
        if (!cue || cue.start <= 0) continue;
        const actorFrame = Array.from(clause).slice(0, cue.start).join('').trimEnd();
        const latin = actorFrame.match(/^(?<actor>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<modifier>[^。！？!?;；\r\n,，:：]{0,32})$/u);
        let match = latin;
        if (!match) {
            const actorChars = Array.from(actorFrame);
            for (let actorLength = 2; actorLength <= Math.min(4, actorChars.length); actorLength += 1) {
                const modifier = actorChars.slice(actorLength).join('');
                if (!/^(?:用|以|借助|通过|的|地|正|正在|低声|轻声|小声|高声|大声|尖声|冷声|柔声|缓声|兴奋地|严肃地|认真地|平静地)/u.test(modifier)) continue;
                match = { groups: { actor: actorChars.slice(0, actorLength).join(''), modifier } };
                break;
            }
        }
        if (!match?.groups?.actor || !match.groups.modifier.trim()) continue;
        const actorLength = Array.from(match.groups.actor).length;
        return {
            actor: match.groups.actor,
            modifier: match.groups.modifier,
            cue: cue.text,
            start,
            actorStart: start,
            actorEnd: start + actorLength,
        };
    }
    return null;
}

function findStructuralPostQuoteAttributionCueV77(source, quote, publishedSpeakerNames = []) {
    const clause = findStructuralPostQuoteSpeechClause(source, quote);
    if (!clause || isStructuralAnonymousSpeakerDescription(clause.actor)
        || isGenericCharacterNoun(clause.actor)
        || /^(?:我|你|他|她|它|我们|你们|他们|她们|它们)$/u.test(clause.actor)) return null;
    const speaker = parseStructuralSpeakerLabel(clause.actor, publishedSpeakerNames, {
        allowUnknownHan: true, allowUnknownLatin: true,
    });
    if (!speaker) return null;
    return {
        text: speaker.text,
        start: clause.actorStart - quote.end,
        end: clause.actorEnd - quote.end,
        ruleId: 'post-quote-attribution',
    };
}

function findTrailingSpeechCueV77(value) {
    const existing = findTrailingSpeechCue(value);
    if (existing) return existing;
    const text = String(value ?? '').trimEnd().replace(/[，,]$/u, '');
    const match = /(?:威胁|恐吓|警告|嘲讽|讥讽)(?:(?:了|上|出|起|过)?(?:一(?:句|声|下))?|道)?$/u.exec(text);
    if (!match) return null;
    return { start: Array.from(text.slice(0, match.index)).length, text: match[0] };
}

function isStructuralAnonymousPostQuoteSpeaker(source, quote) {
    const clause = findStructuralPostQuoteSpeechClause(source, quote);
    return Boolean(clause && (isStructuralAnonymousSpeakerDescription(clause.actor)
        || isGenericCharacterNoun(clause.actor))
        && /(?:用|以|借助|通过)[^。！？!?;；\r\n]{0,32}(?:声音|嗓音|语气)/u.test(clause.modifier)
        && !isStructuralQuotedInformationFrame(clause.modifier, clause.modifier));
}

function isStructuralAnonymousFirstAppearanceV77(source, quote, prefixStart, suffixEnd) {
    if (!Array.isArray(source) || !isValidStructuralPageSpan(quote, source.length)) return false;
    const localWindowStart = Math.max(0, quote.start - 420);
    const sceneBoundaryEnd = findLatestStructuralSceneBoundaryEnd(source, localWindowStart, quote.start);
    const boundedPrefixStart = sceneBoundaryEnd == null ? prefixStart : Math.max(prefixStart, sceneBoundaryEnd);
    return isStructuralAnonymousFirstAppearance(source, quote, boundedPrefixStart, suffixEnd);
}

function findStructuralLeadingActionActorBeforeColonQuoteV77({ source, quote, prefixStart, knownNames = [] } = {}) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    let start = Number.isSafeInteger(prefixStart) ? prefixStart : findStructuralAttributionStart(source, quote.start);
    while (start < quote.start && /\s/u.test(source[start])) start += 1;
    const raw = source.slice(start, quote.start).join('');
    if (!/[:：]\s*$/u.test(raw)) return null;
    const prefix = raw.replace(/[:：]\s*$/u, '').trimEnd();
    const chars = Array.from(prefix);
    if (!prefix || chars.length > 180 || /[。！？!?;；\r\n“”「」『』"']/u.test(prefix)
        || isLikelyStandalonePresentationHeading(prefix)
        || isStructuralQuotedInformationFrame(prefix, prefix.split(/[，,]/u).at(-1)?.trim() || prefix)
        || containsStructuralWrittenCarrierFrame(prefix)
        || isStructuralMentalOrSourceTransferFrame(prefix)
        || isStructuralRecordShape(prefix)) return null;
    if (!knownNames.some((name) => prefix.startsWith(name))
        && /^(?:(?:一个|一名|一位|某个|某名|某位|那个|那名|银面具)?[\p{Script=Han}]{1,14}(?:贵客|来客|访客|客人|小官|官员|军官|教官|守卫|卫兵|士兵|骑士|刺客|法师|术士|战士|弓手|弓箭手)(?:用[^，,。！？!?]{0,18})?(?:轻声|低声|小声|高声|大声|厉声)?(?:说道|说|道|问道|问|喊道|喊|尖叫|怒吼|咆哮))$/u.test(prefix)) return null;

    let actor = null;
    let actorLength = 0;
    const known = [...new Set(knownNames)].filter((name) => typeof name === 'string' && name.trim())
        .sort((left, right) => Array.from(right).length - Array.from(left).length)
        .find((name) => prefix.startsWith(name));
    if (known) {
        actor = known;
        actorLength = Array.from(known).length;
    } else {
        const latin = prefix.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
        if (latin?.groups?.name && !/^(?:a|an|the)(?:\s|$)/iu.test(latin.groups.name)) {
            actor = latin.groups.name;
            actorLength = Array.from(actor).length;
        } else {
            for (let length = 2; length <= Math.min(4, chars.length); length += 1) {
                const candidate = chars.slice(0, length).join('');
                if (!/^[\p{Script=Han}]{2,4}$/u.test(candidate) || isGenericCharacterNoun(candidate)
                    || isStructuralAnonymousSpeakerDescription(candidate) || isStructuralInformationLabel(candidate)
                    || isStructuralUnrosteredPersonDescriptor(candidate) || !isV77PlausibleHanSpeakerName(candidate)) continue;
                if (!v77LeadingSubjectHasAction(chars.slice(length).join(''))) continue;
                actor = candidate;
                actorLength = length;
                break;
            }
        }
    }
    if (!actor || actorLength <= 0 || isGenericCharacterNoun(actor)
        || isStructuralAnonymousSpeakerDescription(actor) || /^(?:我|你|他|她|它|我们|你们|他们|她们|它们)$/u.test(actor)) return null;
    const laterActor = findV77LastActionSubjectBeforeQuote(prefix, knownNames);
    let actorOffset = 0;
    if (laterActor) {
        actor = laterActor.name;
        actorLength = Array.from(actor).length;
        actorOffset = laterActor.offset;
    }
    const tail = chars.slice(actorLength).join('');
    if (/(?:和|与|以及|及|跟|同|、)\s*(?:[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})/u.test(tail)
        || !v77LeadingSubjectHasAction(tail)
        || (!laterActor && v77HasCompetingLeadingActionSubject(prefix, actor, knownNames))) return null;
    const speakerStart = start + Array.from(raw.slice(0, raw.indexOf(prefix))).length + actorOffset;
    const candidate = parseStructuralSpeakerLabel(actor, knownNames, { allowUnknownHan: true, allowUnknownLatin: true });
    if (!candidate) return null;
    return {
        text: candidate.text,
        displayText: candidate.displayText,
        speakerSpan: { start: speakerStart, end: speakerStart + actorLength },
        evidenceSpan: { start, end: quote.start },
    };
}

function findV77LastActionSubjectBeforeQuote(prefix, knownNames = []) {
    const clauses = String(prefix ?? '').split(/[，,]/u).slice(1);
    let selected = null;
    let cursor = 0;
    for (const rawClause of clauses) {
        const clause = rawClause.trim().replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并) *)+/u, '');
        const rawIndex = String(prefix ?? '').indexOf(rawClause, cursor);
        cursor = rawIndex < 0 ? cursor : rawIndex + rawClause.length;
        const leadingOffset = Math.max(0, rawClause.indexOf(clause));
        if (!clause || /^(?:他|她|它|自己|你|我|我们|你们|他们|她们|它们|对|向|朝|给|把|将|和|与|及|跟|同|通过|借助)/u.test(clause)) continue;
        const known = [...new Set(knownNames)].sort((left, right) => Array.from(right).length - Array.from(left).length)
            .find((name) => clause.startsWith(name));
        if (known && v77LeadingSubjectHasAction(clause.slice(Array.from(known).length))) {
            selected = { name: known, offset: Array.from(String(prefix ?? '').slice(0, rawIndex + leadingOffset)).length };
            continue;
        }
        const latin = clause.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
        if (latin?.groups?.name && !/^(?:a|an|the)(?:\s|$)/iu.test(latin.groups.name)
            && v77LeadingSubjectHasAction(latin.groups.tail)) {
            selected = { name: latin.groups.name, offset: Array.from(String(prefix ?? '').slice(0, rawIndex + leadingOffset)).length };
            continue;
        }
        const chars = Array.from(clause);
        for (let length = 2; length <= Math.min(4, chars.length); length += 1) {
            const candidate = chars.slice(0, length).join('');
            if (!isV77PlausibleHanSpeakerName(candidate)
                || !v77LeadingSubjectHasAction(chars.slice(length).join(''))) continue;
            selected = { name: candidate, offset: Array.from(String(prefix ?? '').slice(0, rawIndex + leadingOffset)).length };
            break;
        }
    }
    return selected;
}

function isV77PlausibleHanSpeakerName(value) {
    const name = String(value ?? '').trim();
    if (!/^[\p{Script=Han}]{2,4}$/u.test(name) || isGenericCharacterNoun(name)
        || isStructuralAnonymousSpeakerDescription(name) || isStructuralInformationLabel(name)
        || isStructuralUnrosteredPersonDescriptor(name)) return false;
    if (/^(?:我|你|他|她|它|我们|你们|他们|她们|它们|大家|众人|全员|一只|一条|一头|一群|一队|一批|数名|旁边|附近|门口|身后|远处|不远|角落|一旁|对面|随后|接着|然后|这时|此时|突然|忽然|于是|因此|所以|但是|不过|然而|其实|可能|应该|自己|对方|有人|某人)/u.test(name)) return false;
    if (isLikelyInferredSpeakerName(name)) return true;
    return !/^(?:随后|接着|然后|同时|这时|此时|突然|忽然|于是|因此|所以|但是|不过|然而|其实|可能|应该|必须|自己|对方|有人|某人|陌生人|一人|众人|大家|队伍|全员|头发|袍角|伤口|账本|信件|报告|地图|系统|旁白|叙述|角色|场景|地点|状态|物品|道具|技能|装备)$/u.test(name)
        && !/(?:的|地|得|被|把|将|对|向|从|里|上|下|前|后|旁|声|头|脸|眼|手|们|其|这|那)$/u.test(name);
}

function v77LeadingSubjectHasAction(value) {
    const tail = String(value ?? '').trimStart();
    if (!tail) return false;
    if (hasStructuralLocalActionOrManner(tail) || NARRATIVE_DIALOGUE_ACTION_PATTERN.test(tail)
        || Boolean(findTrailingSpeechCueV77(tail))) return true;
    if (/^(?:把|将)[^，,。！？!?;；:：]{1,36}(?:锁|反锁|关上|关闭|打开|推开|拉开|拍|打|砸|灭|掏|拿|取|递|交|举|拔|扔|丢|放|收|撕|抓|接|推|塞|按|压|抱|扶|拖|拽|护|挡|刺|挥|砍|斩|劈)/u.test(tail)) return true;
    if (/^(?:(?:立刻|马上|突然|随后|接着|然后|又|也|仍|就|便|轻轻地|认真地|严肃地|平静地)\s*)*(?:竖起|扬起|挑起)(?:了)?(?:眉毛|眉|眼睛|手|下巴|嘴角|大拇指)/u.test(tail)) return true;
    if (/^(?:(?:立刻|马上|突然|随后|接着|然后|又|也|仍|就|便|轻轻地|认真地|严肃地|平静地)\s*)*(?:转身|回头|站起|坐下|走近|走开|点头|摇头|抬头|低头|伸手|看向|望向|转向|冲向|跑向)/u.test(tail)) return true;
    return /^(?:那张|那副|一张|一副)(?:瘦|胖|苍白|苍老|年轻)?(?:脸|面孔|脸庞)[^，,。！？!?;；:：]{0,24}(?:(?:顿时|突然|立刻|马上|猛地|一下|瞬间)\s*)?(?:垮|白|红|僵|阴沉|一沉|皱起|扭曲)/u.test(tail);
}

function v77HasCompetingLeadingActionSubject(prefix, actor, knownNames = []) {
    const clauses = String(prefix ?? '').split(/[，,]/u).slice(1);
    for (const rawClause of clauses) {
        const clause = rawClause.trim().replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u, '');
        const reportedClause = clause.match(/^(?<subject>[^，,。！？!?;；:：]{1,20}?)(?:(?:压低|放低|提高|拔高)?(?:声音|嗓音|语气))?(?:低声|轻声|小声|高声|大声|厉声|冷冷地|突然|立刻)?(?:说道|说|道|问道|问|喊道|喊|叫道|叫|尖叫|怒吼|咆哮|低语|嘀咕|回应|补充|提醒|解释)/u);
        const reportedSubject = reportedClause?.groups?.subject?.replace(/^(?:(?:旁边|附近|门口|身后|远处|不远处|角落里|一旁|对面)(?:的)?)+/u, '').trim();
        if (reportedSubject && (isGenericCharacterNoun(reportedSubject)
            || isStructuralAnonymousSpeakerDescription(reportedSubject)
            || /(?:守卫|卫兵|士兵|骑士|法师|祭司|刺客|弓手|男子|女人|少女|少年|陌生人|人影|身影)$/u.test(reportedSubject))) return true;
        if (/^(?:一个|一名|一位|一只|一群|一队|某个|某名|某位|那个|那名)[\p{Script=Han}]{1,18}(?:从[^，,。！？!?]{0,12})?(?:说道|说|道|问道|问|喊道|喊|骂道|骂|叫道|叫|尖叫|怒吼|咆哮)/u.test(clause)) return true;
        const pronounSubject = clause.match(/^(?:他|她|它|自己|你|我|我们|你们|他们|她们|它们)(?<tail>[\s\S]*)$/u);
        if (pronounSubject && v77LeadingSubjectHasAction(pronounSubject.groups.tail)) return true;
        if (!clause || /^(?:他|她|它|自己|你|我|我们|你们|他们|她们|它们|对|向|朝|给|把|将|和|与|及|跟|同|通过|借助)/u.test(clause)) continue;
        const namedRosterSubject = [...new Set(knownNames)].find((name) => clause.startsWith(name)
            && !sameStructuralSpeakerName(name, actor) && v77LeadingSubjectHasAction(clause.slice(Array.from(name).length)));
        if (namedRosterSubject) return true;
        const latin = clause.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
        if (latin?.groups?.name && !sameStructuralSpeakerName(latin.groups.name, actor)
            && v77LeadingSubjectHasAction(latin.groups.tail)) return true;
        for (let length = 2; length <= Math.min(4, Array.from(clause).length); length += 1) {
            const candidate = Array.from(clause).slice(0, length).join('');
            if (!isV77PlausibleHanSpeakerName(candidate)
                || !v77LeadingSubjectHasAction(Array.from(clause).slice(length).join(''))) continue;
            if (!sameStructuralSpeakerName(candidate, actor)) return true;
            break;
        }
    }
    return false;
}

function findStructuralPronounLedQuoteContinuation({ source, quote, quotes = [], anchors = [] }) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    const previousQuote = quotes.filter((candidate) => candidate?.quoteId !== quote.quoteId
        && isValidStructuralPageSpan(candidate, source.length) && candidate.end <= quote.start)
        .sort((left, right) => right.end - left.end)[0];
    if (!previousQuote?.closed) return null;

    const priorOwners = uniqueStructuralActors((anchors || []).filter((anchor) => (
        anchor?.certainty === 'explicit' && anchor.quoteId === previousQuote.quoteId
        && isValidStructuralPageSpan(anchor.speakerSpan, source.length)
        && Array.isArray(anchor.utteranceSpans)
        && anchor.utteranceSpans.some((span) => isValidStructuralPageSpan(span, source.length)
            && span.start >= previousQuote.start && span.end <= previousQuote.end)
    )));
    if (priorOwners.length !== 1) return null;

    const bridgeSpan = trimStructuralSourceSpan(source, previousQuote.end, quote.start);
    const rawBridge = source.slice(previousQuote.end, quote.start).join('');
    if (!bridgeSpan || quote.start - previousQuote.end > 112
        || findLatestStructuralSceneBoundaryEnd(source, previousQuote.end, quote.start) != null) return null;
    if (!/\r?\n/u.test(rawBridge)) return null;
    // Source messages may put each narration beat on its own paragraph. Keep
    // the bridge bounded to the same small text, but ignore formatting-only
    // line breaks around the pronoun-led action sentence.
    const bridge = rawBridge.trim();
    const match = /^(?:(?:随后|接着|然后|这时|此时)\s*)?(?<pronoun>[他她])(?<action>[^。！？!?;；\n]{0,72})[。！？!?]?$/u.exec(bridge);
    if (!match || !/(?:说|问|答|补充|插话|低声|轻声|小声|笑|点头|摇头|抬眼|抬头|看向|看了|望向|回头|转身|皱眉|叹|停顿|开口|示意|咳)/u.test(match.groups.action || '')) return null;
    const currentQuoteText = source.slice(quote.start + 1, quote.end - 1).join('');
    if (containsStructuralWrittenCarrierFrame(bridge, currentQuoteText)
        || isStructuralMentalOrSourceTransferFrame(bridge)) return null;

    const priorQuoteHasExplicitCompetingSpeaker = (anchors || []).some((anchor) => (
        anchor?.certainty === 'explicit' && anchor.quoteId === previousQuote.quoteId
        && !sameStructuralSpeakerName(anchor.speakerText, priorOwners[0].text)
    ));
    if (priorQuoteHasExplicitCompetingSpeaker) return null;
    return {
        text: priorOwners[0].text,
        speakerSpan: priorOwners[0].speakerSpan,
        evidenceSpan: { start: bridgeSpan.start, end: quote.start },
    };
}

function findStructuralUnrosteredQuoteIntroducerSubject({ source, quote, prefixStart, knownNames = [] } = {}) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    let start = Number.isSafeInteger(prefixStart) ? prefixStart : findStructuralAttributionStart(source, quote.start);
    while (start < quote.start && /\s/u.test(source[start])) start += 1;
    const rawPrefix = source.slice(start, quote.start).join('');
    if (!/[:：]\s*$/u.test(rawPrefix)) return null;
    const prefix = rawPrefix.replace(/[:：]\s*$/u, '').trimEnd();
    if (!prefix || prefix.length > 180 || isLikelyStandalonePresentationHeading(prefix)
        || isStructuralQuotedInformationFrame(prefix, source.slice(quote.start + 1, quote.end - 1).join(''))
        || containsStructuralWrittenCarrierFrame(prefix, source.slice(quote.start + 1, quote.end - 1).join())) return null;
    const finalClause = prefix.split(/[，,]/u).at(-1)?.trim()
        .replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u, '') || '';
    if (/^(?:他|她|它|对方|有人|某人|众人|大家|人群|守卫|侍卫|护卫|士兵|骑士|法师|敌人|另一人)/u.test(finalClause)) return null;
    const subject = findStructuralUniqueLocalQuoteSubject(prefix, knownNames, { requireAction: true });
    if (!subject) return null;
    const subjectStart = start + subject.start;
    const subjectEnd = start + subject.end;
    return {
        text: subject.text,
        displayText: subject.displayText,
        speakerSpan: { start: subjectStart, end: subjectEnd },
        evidenceSpan: { start: subjectStart, end: quote.start },
        ruleId: subject.hasSpeechCue ? 'unrostered-subject-explicit-cue' : 'unrostered-subject-colon-quote',
    };
}

function findStructuralV84BoundedActorQuoteSubject({ source, quote, prefixStart, knownNames = [], quoteSpans = [], allowCompoundRole = false, allowCompoundRoleConflict = false } = {}) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    const start = Number.isSafeInteger(prefixStart) ? prefixStart : findStructuralAttributionStart(source, quote.start);
    const rawPrefix = source.slice(start, quote.start).join('');
    if (!/[:：]\s*$/u.test(rawPrefix)) return null;
    const prefix = rawPrefix.replace(/[:：]\s*$/u, '').trim();
    const utterance = source.slice(quote.start + 1, quote.end - 1).join('');
    if (!prefix || prefix.length > 180 || /[。！？!?;；\n“”「」『』"'‘’]/u.test(prefix)
        || isLikelyStandalonePresentationHeading(prefix)
        || isStructuralQuotedInformationFrame(prefix, utterance)
        || isStructuralMentalOrSourceTransferFrame(prefix)
        || containsStructuralWrittenCarrierFrame(prefix, utterance)) return null;

    const parts = prefix.split(/[，,]/u);
    const leading = parts[0] || '';
    const connective = leading.match(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u)?.[0] || '';
    const subjectText = leading.slice(connective.length);
    let actor = parseStructuralV84BoundedActor(subjectText);
    let actorOffset = 0;
    if (allowCompoundRole) {
        const compound = parseStructuralV85CompoundRoleActor(subjectText);
        if (compound && isStructuralV85CompoundRolePrefixSupported({
                source, prefixStart: start + Array.from(connective).length + compound.prefixOffset,
                prefix: compound.rolePrefix, knownNames, quoteSpans,
            })) {
            const compoundPredicateTail = subjectText.slice(compound.length);
            const compoundHasAction = hasStructuralV86CompoundRoleActionPredicate(compoundPredicateTail);
            if (compoundHasAction) {
                actor = { text: compound.text, length: compound.length };
                actorOffset = compound.prefixOffset;
            }
        }
    }
    if (!actor) return null;
    const predicateTail = subjectText.slice(actor.length);
    const hasActorActionPredicate = hasStructuralV84BoundedActionPredicate(predicateTail)
        || (allowCompoundRole && hasStructuralV86CompoundRoleActionPredicate(predicateTail));
    if (!hasActorActionPredicate) {
        return hasStructuralV84LongerWordCuePrefix(predicateTail) ? { status: 'conflict' } : null;
    }

    const actorKey = normalizeStructuralSpeakerKey(actor.text);
    let clauseSearchStart = 0;
    for (const rawClause of parts.slice(1)) {
        const clauseOffset = prefix.indexOf(rawClause, clauseSearchStart);
        clauseSearchStart = clauseOffset + rawClause.length + 1;
        const rawConnective = rawClause.match(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并|也|又|则|便|就)\s*)+/u)?.[0] || '';
        const clause = rawClause.slice(rawConnective.length);
        if (allowCompoundRoleConflict) {
            const compoundClause = parseStructuralV85CompoundRoleActor(clause);
            if (compoundClause && normalizeStructuralSpeakerKey(compoundClause.text) !== actorKey
                && isStructuralV85CompoundRolePrefixSupported({
                    source,
                    prefixStart: start + clauseOffset + Array.from(rawConnective).length + compoundClause.prefixOffset,
                    prefix: compoundClause.rolePrefix,
                    knownNames,
                    quoteSpans,
                })
                && hasStructuralV86CompoundRoleActionPredicate(clause.slice(compoundClause.length))) return { status: 'conflict' };
        }
        const otherActor = parseStructuralV84BoundedActor(clause);
        if (otherActor && normalizeStructuralSpeakerKey(otherActor.text) !== actorKey
            && hasStructuralV84BoundedActionPredicate(clause.slice(otherActor.length))) return { status: 'conflict' };

        const rosteredSubject = [...new Set(knownNames)]
            .filter((name) => typeof name === 'string' && name.trim())
            .sort((left, right) => Array.from(right).length - Array.from(left).length)
            .find((name) => clause.startsWith(name)
                && !sameStructuralSpeakerName(name, actor.text)
                && hasStructuralV84BoundedActionPredicate(clause.slice(Array.from(name).length)));
        if (rosteredSubject && !hasStructuralV84DirectSpeechCue(clause.slice(Array.from(rosteredSubject).length))) return { status: 'conflict' };
        if (hasStructuralV84CompetingLocalSubject(clause, actor.text, knownNames)) return { status: 'conflict' };
    }

    const subjectStart = start + Array.from(connective).length + actorOffset;
    const subjectEnd = subjectStart + actor.length - actorOffset;
    return {
        text: actor.text,
        speakerSpan: { start: subjectStart, end: subjectEnd },
        evidenceSpan: { start: subjectStart, end: quote.start },
        ruleId: 'unrostered-subject-colon-quote',
    };
}

function parseStructuralV85CompoundRoleActor(subjectText) {
    const value = String(subjectText ?? '');
    const determiner = /^(?:一个|一名|一位)/u.exec(value)?.[0] || '';
    const candidate = Array.from(value).slice(Array.from(determiner).length).join('');
    const heads = ['头目', '队长', '首领', '领队', '统领'];
    const chars = Array.from(candidate);
    for (let prefixLength = 1; prefixLength <= Math.min(6, chars.length); prefixLength += 1) {
        const rolePrefix = chars.slice(0, prefixLength).join('');
        if (!/^\p{Script=Han}+$/u.test(rolePrefix)) break;
        const rest = chars.slice(prefixLength).join('');
        const head = heads.find((item) => rest.startsWith(item));
        if (!head) continue;
        return {
            text: `${rolePrefix}${head}`,
            length: Array.from(determiner).length + prefixLength + Array.from(head).length,
            prefixOffset: Array.from(determiner).length,
            rolePrefix,
        };
    }
    return null;
}

function hasStructuralV86CompoundRoleActionPredicate(valueText) {
    return hasStructuralV84BoundedActionPredicate(valueText)
        || /^(?:(?:则|也|又|仍|就|便|先|立刻|马上|突然|随后|接着|然后|这时|此时|正在)\s*)*(?:收手|挥了挥)/u.test(String(valueText ?? '').trimStart());
}

function isStructuralV85CompoundRolePrefixSupported({ source, prefixStart, prefix, knownNames = [], quoteSpans = [] } = {}) {
    const rolePrefix = String(prefix ?? '');
    if (!Array.isArray(source) || !rolePrefix) return false;
    const candidates = [...new Set(knownNames)].filter((item) => typeof item === 'string' && item.trim());
    if (candidates.includes(rolePrefix)) return true;
    if (['门卫', '守卫', '护卫', '侍卫', '卫兵', '士兵', '打手', '佣兵', '骑士', '法师', '祭司', '队员', '海盗'].includes(rolePrefix)) return true;
    const bounded = parseStructuralV84BoundedActor(rolePrefix);
    if (bounded && bounded.text === rolePrefix) return true;

    const start = Number.isSafeInteger(prefixStart) ? prefixStart : source.length;
    const prefixChars = Array.from(rolePrefix);
    const spans = Array.isArray(quoteSpans) ? quoteSpans : [];
    const outsideQuotes = (index, end) => !spans.some((span) => span
        && Number.isSafeInteger(span.start) && Number.isSafeInteger(span.end)
        && index < span.end && end > span.start);
    let mentions = 0;
    let repeatedActionSubject = false;
    for (let index = 0; index + prefixChars.length <= start; index += 1) {
        if (!prefixChars.every((character, offset) => source[index + offset] === character)) continue;
        const end = index + prefixChars.length;
        if (!outsideQuotes(index, end)) continue;
        const left = source.slice(Math.max(0, index - 10), index).join('');
        const right = source.slice(end, Math.min(start, end + 14)).join('');
        const independentMention = index === 0 || /(?:^|[，,。！？!?；;：:\s]|两名|三名|一名|一位|一个|几名|几位|那些|这名|该名|的|有|被|让|遇到|看见|见到)$/u.test(left);
        if (!independentMention) continue;
        mentions += 1;
        const compoundRole = /^(?:守卫|护卫|侍卫|卫兵|士兵|队长|头目|首领|领队|统领|法师|祭司|佣兵|骑士|队员|海盗)/u.exec(right)?.[0] || '';
        const roleActionTail = compoundRole ? right.slice(Array.from(compoundRole).length) : right;
        if (/^(?:盯了一眼|盯着|看了一眼|看向|走来|走上前|走近|转身|抬手|收手|挥了挥)/u.test(roleActionTail)
            || hasStructuralV84BoundedActionPredicate(roleActionTail)) repeatedActionSubject = true;
    }
    return mentions >= 2 && repeatedActionSubject;
}

function hasStructuralV84CompetingLocalSubject(clauseText, selectedActor, knownNames = []) {
    const clause = String(clauseText ?? '').trim();
    const pronoun = /^(?<subject>他|她|它|对方|另一人|另一个人)(?<tail>[\s\S]*)$/u.exec(clause);
    if (pronoun?.groups && !hasStructuralV84DirectSpeechCue(pronoun.groups.tail)
        && hasStructuralV84BoundedActionPredicate(pronoun.groups.tail)) return true;

    const genericActor = /^(?<subject>一名|一位|几名|几位|一群)?(?<role>守卫|护卫|侍卫|卫兵|士兵|打手|佣兵|骑士|法师|祭司|村民|队员|海盗|商人|贵客|客人|来客|访客|教官|官员|队长|首领|敌人|人群|众人|大家)(?:们)?(?<tail>[\s\S]*)$/u.exec(clause);
    if (genericActor?.groups && !hasStructuralV84DirectSpeechCue(genericActor.groups.tail)
        && hasStructuralV84BoundedActionPredicate(genericActor.groups.tail)) return true;

    const inferred = findStructuralLocalClauseSubject(clause, knownNames);
    return Boolean(inferred && !hasStructuralV84DirectSpeechCue(clause.slice(inferred.end))
        && !sameStructuralSpeakerName(inferred.text, selectedActor)
        && hasStructuralV84BoundedActionPredicate(clause.slice(inferred.end)));
}

function hasStructuralV84DirectSpeechCue(valueText) {
    const cues = [...STRUCTURAL_SPEECH_CUES, ...STRUCTURAL_ENGLISH_SPEECH_CUES,
        '说道', '问道', '答道', '喊道', '叫道', '道', '说', '问', '答', '喊', '回道', '回应', '补充', '插话', '提醒', '解释'];
    return new RegExp(`(?:${cues.join('|')})\\s*$`, 'iu').test(String(valueText ?? '').trim());
}

function parseStructuralV84BoundedActor(valueText) {
    const value = String(valueText ?? '');
    const unitRoles = ['佣兵', '侍卫', '卫兵', '护卫', '守卫', '士兵', '打手', '骑士', '法师', '祭司', '村民', '队员', '海盗'];
    const role = unitRoles.find((item) => value.startsWith(item));
    if (role) {
        const suffix = Array.from(value).slice(Array.from(role).length).join('');
        const index = /^([甲乙丙丁戊己庚辛壬癸]|[A-Z]|\d{1,2})(?![A-Za-z0-9])/u.exec(suffix);
        if (index) return { text: `${role}${index[1]}`, length: Array.from(role + index[1]).length };
    }

    const modifiers = ['戴面具的', '高大', '矮小', '年轻', '年迈', '年老', '金发', '银发', '红发', '黑发', '白发', '独眼', '驼背', '蒙面', '胖', '瘦'];
    const features = ['竹竿', '壮汉', '瘦削', '高瘦', '矮胖', '魁梧', '精瘦', '干瘦'];
    const personRoles = ['男子', '女人', '少女', '少年', '身影', '人影', '商人', '贵客', '客人', '来客', '访客', '守卫', '护卫', '士兵', '骑士', '法师', '祭司', '教官', '小官', '官员', '队员', '村民', '男', '女'];
    for (const modifierCount of [2, 1, 0]) {
        const modifierPattern = modifierCount
            ? `(?<modifiers>(?:${modifiers.join('|')}){0,${modifierCount}})`
            : '(?<modifiers>)';
        const pattern = new RegExp(`^${modifierPattern}(?<feature>${features.join('|')}|)(?<role>${personRoles.join('|')})`, 'u');
        const match = pattern.exec(value);
        if (!match) continue;
        const text = `${match.groups.modifiers}${match.groups.feature}${match.groups.role}`;
        // A role suffix without a descriptor is not a unique unrostered actor.
        if (!match.groups.modifiers && !match.groups.feature) return null;
        return { text, length: Array.from(text).length };
    }
    return null;
}

function hasStructuralV84BoundedActionPredicate(valueText) {
    const cues = `(?:${STRUCTURAL_ACTION_CUE}|${STRUCTURAL_SPEECH_CUES.join('|')}|${STRUCTURAL_ENGLISH_SPEECH_CUES.join('|')}|一听|听见|推到|推向)`;
    const modifiers = '(?:(?:则|也|又|仍|就|便|先|立刻|马上|突然|随后|接着|然后|这时|此时|正在|轻轻地|认真地|严肃地|平静地|兴奋地|冷静地|迅速地|疯狂地|疯狂|连连|拼命地|用力地)\s*)*';
    const match = new RegExp(`^${modifiers}(?<cue>${cues})`, 'iu').exec(String(valueText ?? '').trimStart());
    if (!match) return false;
    const tail = Array.from(String(valueText ?? '').trimStart()).slice(Array.from(match[0]).length).join('');
    return !(Array.from(match.groups.cue).length === 1 && /^\p{Script=Han}/u.test(tail));
}

function hasStructuralV84LongerWordCuePrefix(valueText) {
    const modifiers = /^(?:(?:则|也|又|仍|就|便|先|立刻|马上|突然|随后|接着|然后|这时|此时|正在|轻轻地|认真地|严肃地|平静地|兴奋地|冷静地|迅速地|疯狂地|疯狂|连连|拼命地|用力地)\s*)*/u;
    const value = String(valueText ?? '').trimStart().replace(modifiers, '');
    return /^(?:说|问|答|喊|看|朝|找|抓|戳)\p{Script=Han}/u.test(value);
}

function findStructuralLeadingNamedSubjectBeforeColonQuote({ source, quote, prefixStart, knownNames = [] } = {}) {
    if (!Array.isArray(source) || !quote?.closed || !isValidStructuralPageSpan(quote, source.length)) return null;
    const start = Number.isSafeInteger(prefixStart) ? prefixStart : findStructuralAttributionStart(source, quote.start);
    const rawPrefix = source.slice(start, quote.start).join('');
    if (!/[:：]\s*$/u.test(rawPrefix)) return null;
    const raw = rawPrefix.replace(/[:：]\s*$/u, '').trim();
    if (!raw || raw.length > 180 || /[。！？!?;；\n“”「」『』"'‘’]/u.test(raw)
        || isLikelyStandalonePresentationHeading(raw)
        || isStructuralQuotedInformationFrame(raw, currentUtteranceTextForQuote(source, quote))
        || isStructuralMentalOrSourceTransferFrame(raw)
        || hasCoordinatedSubjectsBeforeAction(raw, knownNames)
        || containsStructuralWrittenCarrierFrame(raw, currentUtteranceTextForQuote(source, quote))) return null;

    const trimmedLeading = raw.match(/^[—–-]\s*/u)?.[0] || '';
    const unprefixed = raw.slice(trimmedLeading.length);
    const connectivePrefix = unprefixed.match(/^(?:(?:随后|接着|然后|同时|这时|此时|突然|忽然)\s*)+/u)?.[0] || '';
    const prefix = unprefixed.slice(connectivePrefix.length);
    const prefixOffset = Array.from(trimmedLeading + connectivePrefix).length;
    if (!prefix || /^(?:有人|某人|一个(?:人|身影)|一名|几名|一群|众人|大家|人群)/u.test(prefix)) return null;
    const names = [...new Set(knownNames)].filter((name) => typeof name === 'string' && name.trim()
        && name === name.trim() && !isStructuralInformationLabel(name) && !isGenericCharacterNoun(name))
        .sort((left, right) => Array.from(right).length - Array.from(left).length);
    const actionPrefix = new RegExp(`^(?:${STRUCTURAL_ACTION_CUE}|整理|吹(?:了)?(?:一)?声?口哨|翻了?个白眼|看都没看|弯腰|从[^，,：:]{0,16}(?:冒头|探出|钻出))`, 'u');
    let selected = null;
    const exactName = names.find((name) => prefix.startsWith(name)
        && !/^[·・•.]/u.test(Array.from(prefix).slice(Array.from(name).length).join('')));
    if (exactName) selected = { text: exactName, length: Array.from(exactName).length };

    if (!selected) {
        const latin = /^([A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?=[\p{Script=Han}\s])/u.exec(prefix);
        if (latin) {
            const length = Array.from(latin[1].trim()).length;
            if (actionPrefix.test(Array.from(prefix).slice(length).join('').trimStart())) {
                selected = { text: latin[1].trim(), length };
            }
        }
    }
    if (!selected) {
        const chars = Array.from(prefix);
        for (let length = Math.min(4, chars.length - 1); length >= 2; length -= 1) {
            const name = chars.slice(0, length).join('');
            const tail = chars.slice(length).join('');
            if (!/^\p{Script=Han}+$/u.test(name) || isStructuralInformationLabel(name)
                || isGenericCharacterNoun(name)
                || /^(?:有人|某人|一个人|一名|几名|一群|众人|大家|人群|全员|所有人)$/u.test(name)
                || /^(?:你们|我们|他们|她们|你|我|他|她|它|大家|众人|全员|人群|旁白|叙述|系统|随后|接着|然后|同时|这时|此时|突然|忽然)/u.test(name)
                || !actionPrefix.test(tail)) continue;
            selected = { text: name, length };
            break;
        }
    }
    if (!selected || isStructuralInformationLabel(selected.text) || isGenericCharacterNoun(selected.text)) return null;
    const tail = Array.from(prefix).slice(selected.length).join('');
    if (!tail || !/(?:\p{Script=Han}|[A-Za-z])/u.test(tail)) return null;
    const finalClause = prefix.split(/[，,]/u).at(-1)?.trim() || prefix;
    const competingGenericSubject = /(?:首相|公爵夫人|大法师|法师|将军|队长|船长|守卫|侍卫|护卫|士兵|骑士|村民|群众|人群|敌人)(?:长|们)?(?:(?:随后|接着|然后|这时|此时))?(?:低声|轻声|小声|高声|怒吼|咆哮)*(?:说道|说|道|问|喊)?$/u.exec(finalClause)?.[0];
    const competingPronounSubject = /^(?:你|我|他|她|它)(?:[^，,。！？!?;；:：]{0,28})(?:说|道|问|喊|回应|补充|解释|提醒)/u.test(finalClause);
    const competingRosterSubject = names.find((name) => finalClause.startsWith(name)
        && !sameStructuralSpeakerName(name, selected.text));
    const competingLatinSubject = /^([A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?=[\p{Script=Han}\s])/u.exec(finalClause)?.[1];
    const competingNamedActionSubject = (() => {
        const clause = finalClause.replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u, '');
        const clauseChars = Array.from(clause);
        for (let length = Math.min(4, clauseChars.length); length >= 2; length -= 1) {
            let name = clauseChars.slice(0, length).join('');
            const tail = clauseChars.slice(length).join('');
            if (/(?:也|又|则|便|就)$/u.test(name)) name = name.replace(/(?:也|又|则|便|就)$/u, '');
            const actionTail = tail.replace(/^(?:也|又|则|便|就)\s*/u, '');
            if (Array.from(name).length < 2 || !/^\p{Script=Han}+$/u.test(name)
                || /(?:地|得|的)$/u.test(name)
                || isGenericCharacterNoun(name) || /^(?:有人|某人|一个人|众人|大家|人群|守卫|侍卫|士兵)$/u.test(name)
                || !actionPrefix.test(actionTail)) continue;
            return name;
        }
        return null;
    })();
    if (competingPronounSubject
        || (competingGenericSubject && !sameStructuralSpeakerName(competingGenericSubject, selected.text))
        || competingRosterSubject || (competingLatinSubject && !sameStructuralSpeakerName(competingLatinSubject, selected.text))
        || (competingNamedActionSubject && !sameStructuralSpeakerName(competingNamedActionSubject, selected.text))) return null;
    const speakerStart = start + prefixOffset;
    return {
        text: selected.text,
        speakerSpan: { start: speakerStart, end: speakerStart + selected.length },
        evidenceSpan: { start: speakerStart, end: quote.start },
    };
}

function findStructuralLeadingSubjectForCue(regionText, regionStart, cueOffset, knownNames = []) {
    const beforeCue = Array.from(String(regionText ?? '')).slice(0, cueOffset).join('').trim();
    if (!beforeCue || beforeCue.length > 180 || isStructuralMentalOrSourceTransferFrame(beforeCue)) return null;
    const subject = findStructuralUniqueLocalQuoteSubject(beforeCue, knownNames, { requireAction: true });
    if (!subject) return null;
    const tailAfterSubject = beforeCue.slice(subject.end);
    const clauses = beforeCue.split(/[，,]/u).map((item) => item.trim()).filter(Boolean);
    const finalClause = clauses.at(-1) || '';
    const afterFinalBoundary = finalClause.replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u, '');
    if (/^(?:他|她|它|对方|有人|某人|众人|大家|人群|守卫|侍卫|护卫|士兵|骑士|法师|敌人|另一人)/u.test(afterFinalBoundary)
        && !afterFinalBoundary.startsWith(subject.text)) return null;
    if (knownNames.some((name) => name !== subject.text
        && tailAfterSubject.split(/[，,、]/u).slice(1).some((clause) => clause.trim().startsWith(name)))) return null;
    return {
        text: subject.text,
        displayText: subject.displayText,
        speakerSpan: { start: regionStart + subject.start, end: regionStart + subject.end },
    };
}

function findStructuralUniqueLocalQuoteSubject(valueText, knownNames = [], { requireAction = false } = {}) {
    const source = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '').trimEnd();
    if (!source || /[。！？!?;；\n“”「」『』"']/u.test(source)
        || isStructuralQuotedInformationFrame(source, source)
        || isStructuralMentalOrSourceTransferFrame(source)) return null;
    const clauses = [];
    let offset = 0;
    for (const part of source.split(/(?<=[，,])/u)) {
        const raw = part.replace(/[，,]\s*$/u, '').trim();
        const leading = part.length - part.trimStart().length;
        if (raw) clauses.push({ text: raw, offset: offset + leading });
        offset += Array.from(part).length;
    }
    const cueClauses = clauses.map((clause) => ({
        ...clause,
        hasSpeechCue: Boolean(findTrailingSpeechCue(clause.text)),
    }));
    const explicitSubjects = cueClauses.map((clause) => ({
        ...clause,
        subject: findStructuralLocalClauseSubject(clause.text, knownNames),
    })).filter((clause) => clause.subject && clause.hasSpeechCue);
    let selected = null;
    if (explicitSubjects.length) {
        const latest = explicitSubjects.at(-1);
        const names = new Set(explicitSubjects.filter((item) => item.offset === latest.offset)
            .map((item) => normalizeStructuralSpeakerKey(item.subject.text)));
        if (names.size !== 1) return null;
        selected = { ...latest.subject, offset: latest.offset, hasSpeechCue: true };
    } else {
        const leadingSubjects = cueClauses.map((clause) => ({
            ...clause,
            subject: findStructuralLocalClauseSubject(clause.text, knownNames),
        })).filter((clause) => clause.subject);
        const unique = new Map(leadingSubjects.map((item) => [normalizeStructuralSpeakerKey(item.subject.text), item]));
        if (unique.size !== 1) return null;
        selected = { ...[...unique.values()][0].subject, offset: [...unique.values()][0].offset, hasSpeechCue: false };
    }
    if (requireAction && !cueClauses.some((clause) => hasStructuralLocalActionOrManner(clause.text.slice(
        Math.max(0, (selected.offset === clause.offset ? selected.end : 0)),
    )))) return null;
    if (clauses.some((clause) => isStructuralRecordShape(clause.text))) return null;
    return {
        text: selected.text,
        displayText: selected.displayText,
        start: selected.offset + selected.start,
        end: selected.offset + selected.end,
        hasSpeechCue: selected.hasSpeechCue || cueClauses.some((clause) => clause.hasSpeechCue),
    };
}

function findStructuralPronounCueActionAntecedent({ source, quote, quotes = [], anchors = [], knownNames = [] } = {}) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    if (!quote?.closed || !isValidStructuralPageSpan(quote, chars.length)) return null;
    const previousQuoteEnd = Math.max(0, ...quotes.filter((item) => item.quoteId !== quote.quoteId
        && item.end <= quote.start).map((item) => item.end));
    const prefixStart = Math.max(previousQuoteEnd, quote.start - 240);
    const prefix = chars.slice(prefixStart, quote.start).join('').replace(/[:：]\s*$/u, '').trimEnd();
    if (!prefix || prefix.length > 260 || isStructuralMentalOrSourceTransferFrame(prefix)
        || isStructuralQuotedInformationFrame(prefix, currentUtteranceTextForQuote(chars, quote))) return null;
    const cue = findTrailingSpeechCue(prefix);
    if (!cue) return null;
    const beforeCue = Array.from(prefix).slice(0, cue.start).join('').trimEnd();
    const pronounPattern = /(?:^|[。！？!?;；\n，,]\s*)(?<pronoun>他|她|它)(?<tail>[^。！？!?;；\n]{0,96})$/u;
    const pronounMatch = pronounPattern.exec(beforeCue);
    if (!pronounMatch?.groups?.pronoun) return null;
    const frameTail = pronounMatch.groups.tail || '';
    if (/[“”「」『』"'‘’]/u.test(frameTail)
        || isStructuralMentalOrSourceTransferFrame(frameTail)
        || /(?:地图|信件|报告|账本|记录|告示|屏幕|铭文|碑文|写着|写道|记载|显示)/u.test(frameTail)) return null;
    const pronounOffsetInPrefix = Array.from(beforeCue.slice(
        0, pronounMatch.index + pronounMatch[0].indexOf(pronounMatch.groups.pronoun),
    )).length;
    const frameStart = prefixStart + pronounOffsetInPrefix;
    const spokenText = currentUtteranceTextForQuote(chars, quote);

    const priorAnchors = [];
    for (const anchor of anchors) {
        if (anchor?.certainty !== 'explicit' || anchor.groupId || typeof anchor.speakerText !== 'string'
            || !anchor.speakerText.trim() || /^(?:你|我|他|她|它|旁白|众人|全员)$/u.test(anchor.speakerText)
            || !Array.isArray(anchor.utteranceSpans) || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        const latestUtterance = anchor.utteranceSpans.filter((span) => isValidStructuralPageSpan(span, chars.length)
            && span.end <= frameStart).sort((left, right) => right.end - left.end)[0];
        if (!latestUtterance || frameStart - latestUtterance.end > 420
            || findLatestStructuralSceneBoundaryEnd(chars, latestUtterance.end, frameStart) != null) continue;
        priorAnchors.push({ anchor, utterance: latestUtterance });
    }
    if (priorAnchors.length) {
        const latestEnd = Math.max(...priorAnchors.map(({ utterance }) => utterance.end));
        const latest = priorAnchors.filter(({ utterance }) => utterance.end === latestEnd);
        const speakers = new Map(latest.map(({ anchor }) => [
            normalizeStructuralSpeakerKey(anchor.speakerText), anchor,
        ]));
        const selected = speakers.size === 1 ? [...speakers.values()][0] : null;
        if (!selected) return null;
        const selectedQuote = isValidStructuralPageSpan(selected.quoteSpan, chars.length) ? selected.quoteSpan : null;
        if (!selectedQuote || quotes.some((item) => item.quoteId !== quote.quoteId
            && item.start >= selectedQuote.end && item.end <= frameStart)) return null;
        return {
            text: selected.displaySpeakerText || selected.speakerText,
            speakerSpan: selected.speakerSpan,
            evidenceSpan: { start: selectedQuote.start, end: frameStart },
        };
    }

    // No earlier quote anchor exists. A direct pronoun speech frame may refer
    // to one unique named actor in the immediately preceding sentence/clause;
    // stop after two boundaries and abstain on quoted, multi-actor, or scene text.
    const priorText = chars.slice(Math.max(0, frameStart - 300), frameStart).join('');
    const regions = [];
    let regionStart = 0;
    for (let index = 0; index <= priorText.length; index += 1) {
        if (index < priorText.length && !/[。！？!?;；\n]/u.test(priorText[index])) continue;
        const value = priorText.slice(regionStart, index).trim();
        if (value) regions.push({ text: value, end: frameStart - Array.from(priorText.slice(index)).length });
        regionStart = index + 1;
    }
    for (const region of regions.slice(-2).reverse()) {
        if (/[“”「」『』"'‘’]/u.test(region.text)
            || isStructuralQuotedInformationFrame(region.text, spokenText)
            || containsStructuralWrittenCarrierFrame(region.text, spokenText)) return null;
        // Pronouns are especially easy to reverse in a transfer/look-at
        // sentence (`A hands B ... He ...`). Require one rostered person in
        // the whole local antecedent region before using this last-resort
        // action-subject guess; the action parser alone may only see A.
        const namedActors = new Set(knownNames.filter((name) => name && region.text.includes(name))
            .map(normalizeStructuralSpeakerKey));
        if (namedActors.size > 1) return null;
        const actor = findStructuralUniqueActionSubjectInClauses(region.text, knownNames);
        if (!actor) continue;
        const regionStartOffset = frameStart - Array.from(priorText).length
            + Array.from(priorText.slice(0, priorText.lastIndexOf(region.text))).length;
        const speakerSpan = { start: regionStartOffset + actor.start, end: regionStartOffset + actor.end };
        if (!isValidStructuralPageSpan(speakerSpan, chars.length)
            || chars.slice(speakerSpan.start, speakerSpan.end).join('') !== actor.text
            || findLatestStructuralSceneBoundaryEnd(chars, speakerSpan.end, frameStart) != null) return null;
        if (quotes.some((item) => item.quoteId !== quote.quoteId && item.start >= speakerSpan.end && item.end <= frameStart)) return null;
        return {
            text: actor.displayText || actor.text,
            speakerSpan,
            evidenceSpan: { start: speakerSpan.start, end: frameStart },
        };
    }
    return null;
}

function findStructuralAdjacentKnownNameMention({ source, quote, quotes = [], knownNames = [] } = {}) {
    const chars = Array.isArray(source) ? source : Array.from(String(source ?? ''));
    if (!quote?.closed || !isValidStructuralPageSpan(quote, chars.length)) return null;
    const validNames = [...new Set(knownNames)]
        .filter((name) => typeof name === 'string' && name.trim() && !isStructuralAnonymousSpeakerDescription(name)
            && !isStructuralInformationLabel(name)
            && !/^(?:你|我|他|她|它|我们|你们|他们|她们|旁白|叙述|系统|众人|全员|人群)$/u.test(name))
        .sort((left, right) => Array.from(right).length - Array.from(left).length);
    if (!validNames.length) return null;
    const quoteSpans = quotes.filter((item) => isValidStructuralPageSpan(item, chars.length));
    const otherQuotes = quoteSpans.filter((item) => item.quoteId !== quote.quoteId);
    const stop = (char) => /[。！？!?;；\n]/u.test(char);
    const findBoundary = (from, direction) => {
        for (let index = from; index >= 0 && index < chars.length; index += direction) {
            const containing = quoteSpans.find((item) => item.start <= index && index < item.end);
            if (containing) {
                index = direction < 0 ? containing.start : containing.end - 1;
                continue;
            }
            if (stop(chars[index])) return index;
        }
        return direction < 0 ? -1 : chars.length;
    };
    const previousStop = findBoundary(quote.start - 1, -1);
    const currentStart = previousStop + 1;
    const currentStop = findBoundary(quote.end, 1);
    const previousPreviousStop = previousStop >= 0 ? findBoundary(previousStop - 1, -1) : -1;
    const nextStart = currentStop + 1;
    const nextStop = currentStop < chars.length ? findBoundary(nextStart, 1) : chars.length;
    const regions = [
        previousStop >= 0 ? { start: previousPreviousStop + 1, end: previousStop, distance: 1 } : null,
        { start: currentStart, end: currentStop < chars.length ? currentStop : chars.length, distance: 0 },
        currentStop < chars.length ? { start: nextStart, end: nextStop < chars.length ? nextStop : chars.length, distance: 1 } : null,
    ].filter(Boolean).filter((span) => trimStructuralSourceSpan(chars, span.start, span.end));
    const hasCompetingLocalActor = regions.some((region) => {
        const span = trimStructuralSourceSpan(chars, region.start, region.end);
        if (!span) return false;
        const unquoted = chars.slice(span.start, span.end).map((char, index) => (
            quoteSpans.some((item) => item.start <= span.start + index && span.start + index < item.end) ? ' ' : char
        )).join('');
        return hasStructuralNearbyGenericActorCue(unquoted) || hasCoordinatedSubjectsBeforeAction(unquoted, validNames);
    });
    if (hasCompetingLocalActor) return null;
    const candidates = [];
    for (const region of regions) {
        const span = trimStructuralSourceSpan(chars, region.start, region.end);
        const regionText = span ? chars.slice(span.start, span.end).map((char, index) => (
            quoteSpans.some((item) => item.start <= span.start + index && span.start + index < item.end) ? ' ' : char
        )).join('') : '';
        if (!span || isLikelyStandalonePresentationHeading(chars.slice(span.start, span.end).join(''))
            || isStructuralRecordShape(chars.slice(span.start, span.end).join(''))
            || isStructuralQuotedInformationFrame(regionText, currentUtteranceTextForQuote(chars, quote))
            || isStructuralMentalOrSourceTransferFrame(regionText)
            || containsStructuralWrittenCarrierFrame(regionText, currentUtteranceTextForQuote(chars, quote))
            || otherQuotes.some((item) => item.start < span.end && span.start < item.end)) continue;
        const contextStart = Math.min(span.start, quote.start);
        const contextEnd = Math.max(span.end, quote.end);
        if (findLatestStructuralSceneBoundaryEnd(chars, contextStart, contextEnd) != null) continue;
        for (let nameStart = span.start; nameStart < span.end; nameStart += 1) {
            if (quoteSpans.some((item) => item.start <= nameStart && nameStart < item.end)) continue;
            const name = validNames.find((candidate) => chars.slice(nameStart, nameStart + Array.from(candidate).length).join('') === candidate);
            if (!name) continue;
            const nameEnd = nameStart + Array.from(name).length;
            if (nameEnd > span.end || (/^[A-Za-z0-9]/u.test(name)
                && (/[A-Za-z0-9]/u.test(chars[nameStart - 1] || '') || /[A-Za-z0-9]/u.test(chars[nameEnd] || '')))) continue;
            const afterName = chars.slice(nameEnd, Math.min(span.end, nameEnd + 12)).join('');
            if (/^的(?:名字|姓名|署名|落款)/u.test(afterName)) continue;
            const beforeName = chars.slice(Math.max(span.start, nameStart - 16), nameStart).join('');
            if (/(?:看向|看着|望向|望着|瞥见|指着|指向|对着|递给|交给|问|注视着)$/u.test(beforeName)) continue;
            candidates.push({
                text: name,
                speakerSpan: { start: nameStart, end: nameEnd },
                evidenceSpan: { start: span.start, end: span.end },
                sentenceDistance: region.distance,
                sourceOffset: nameStart,
            });
            nameStart = nameEnd - 1;
        }
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => left.sentenceDistance - right.sentenceDistance || left.sourceOffset - right.sourceOffset);
    return candidates[0];
}

function currentUtteranceTextForQuote(source, quote) {
    return source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('');
}

function hasStructuralNearbyGenericActorCue(valueText) {
    const clauses = String(valueText ?? '').split(/[，,。！？!?;；\n]/u).map((item) => item.trim())
        .filter(Boolean).map((item) => item.replace(/^(?:(?:但是|不过|然而|但|随后|接着|然后|同时|这时|此时|突然|就)\s*)+/u, ''));
    return clauses.some((clause) => {
        if (/^(?:我|你|他|她|它|那人|对方)/u.test(clause)
            && hasStructuralLocalActionOrManner(clause.replace(/^(?:我|你|他|她|它|那人|对方)/u, ''))) return true;
        const chars = Array.from(clause);
        for (let offset = 0; offset <= Math.min(12, chars.length - 2); offset += 1) {
            for (let length = Math.min(4, chars.length - offset); length >= 2; length -= 1) {
                const subject = chars.slice(offset, offset + length).join('');
                if (!isGenericCharacterNoun(subject)) continue;
                if (hasStructuralLocalActionOrManner(chars.slice(offset + length).join(''))) return true;
            }
        }
        return false;
    });
}

function findStructuralLocalClauseSubject(valueText, knownNames = []) {
    const clause = String(valueText ?? '').trim().replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并|只要|就)\s*)+/u, '');
    if (/^我/u.test(clause)) {
        const tail = clause.slice(1);
        if (hasStructuralLocalActionOrManner(tail)) return { text: '我', displayText: '你', start: 0, end: 1 };
    }
    if (!clause || /^(?:我|你|他|她|它|我们|你们|他们|她们|大家|全员|众人|某人|有人|另一人|对方|守卫|侍卫|护卫|士兵|骑士|法师|敌人|旁白|系统|叙述|地图|信件|账本|记录|告示|面板)/u.test(clause)) return null;
    const known = [...new Set(knownNames)].sort((left, right) => Array.from(right).length - Array.from(left).length)
        .find((name) => clause.startsWith(name));
    if (known) {
        const tail = clause.slice(Array.from(known).length);
        return hasStructuralLocalActionOrManner(tail) ? { text: known, start: 0, end: Array.from(known).length } : null;
    }
    const latin = clause.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
    if (latin?.groups?.name && !/^(?:a|an|the)\s/iu.test(latin.groups.name)
        && hasStructuralLocalActionOrManner(latin.groups.tail)
        && !isStructuralAnonymousSpeakerDescription(latin.groups.name)
        && !isGenericCharacterNoun(latin.groups.name)
        && isLikelyInferredSpeakerName(latin.groups.name)) {
        return { text: latin.groups.name, start: 0, end: Array.from(latin.groups.name).length };
    }
    const chars = Array.from(clause);
    const candidates = [];
    for (let length = Math.min(4, chars.findIndex((char) => !/\p{Script=Han}/u.test(char)) < 0
        ? chars.length : chars.findIndex((char) => !/\p{Script=Han}/u.test(char))); length >= 2; length -= 1) {
        const name = chars.slice(0, length).join('');
        const tail = chars.slice(length).join('');
        if (!hasStructuralLocalActionOrManner(tail) || isStructuralAnonymousSpeakerDescription(name)
            || isGenericCharacterNoun(name) || isStructuralInformationLabel(name)
            || isStructuralUnrosteredPersonDescriptor(name) || isStructuralLocalCueFragment(name)
            || /有[一二三四五六七八九十]?$/u.test(name) || !isLikelyInferredSpeakerName(name)) continue;
        candidates.push({ text: name, start: 0, end: length, boundaryScore: structuralLocalSubjectBoundaryScore(tail) });
    }
    candidates.sort((left, right) => right.boundaryScore - left.boundaryScore || right.end - left.end);
    if (!candidates.length) return null;
    const best = candidates.filter((item) => item.boundaryScore === candidates[0].boundaryScore);
    return new Set(best.map((item) => normalizeStructuralSpeakerKey(item.text))).size === 1 ? best[0] : null;
}

function hasStructuralLocalActionOrManner(valueText) {
    let tail = String(valueText ?? '').replace(/^\s*/u, '');
    if (!tail) return false;
    if (/^一边[^，,。！？!?;；]{1,48}一边/u.test(tail)) return true;
    tail = tail.replace(/^(?:(?:则只|只|则|也|又|仍|就|便|立刻|马上|突然|随后|接着|然后|这时|此时|正在|轻轻地|轻轻|认真地|严肃地|平静地|低声|轻声|小声|高声|大声|尖声|冷冷|冷声|柔声|急切地|怒气冲冲地)\s*)+/u, '');
    if (/^(?:道|叫)(?=.)/u.test(tail)) return false;
    return /^(?:([\p{Script=Han}]{1,2})(?:动(?:了)?(?:一下)?|颤(?:了)?(?:一下)?|僵(?:了)?|一紧|一松|一沉|一缩)|惨叫|扯掉|掏出?|踹开|扫着|停顿|顿了顿|咳嗽|尖声|低声|轻声|小声|高声|大声|反对|一愣|脸色|神情|沉默|沉吟|松了口气|看向|望向|走到|走向|转身|回头|点头|皱眉|微笑|冷笑|摇头|翻开|拿起|递给|砸碎|说|问|答|喊|道|said|says|asked|replied|answered|whispered|shouted)/iu.test(tail)
        || new RegExp(`^(?:${STRUCTURAL_ACTION_CUE}|${STRUCTURAL_SPEECH_CUES.join('|')}|${STRUCTURAL_ENGLISH_SPEECH_CUES.join('|')})`, 'u').test(tail);
}

function isStructuralLocalCueFragment(valueText) {
    const value = String(valueText ?? '').trim();
    if (!value) return true;
    if (new RegExp(`^(?:${STRUCTURAL_ACTION_CUE})$`, 'u').test(value)
        || STRUCTURAL_SPEECH_CUES.includes(value) || STRUCTURAL_ENGLISH_SPEECH_CUES.includes(value)) return true;
    // Reduplicated manner adverbs often sit before a bare speech cue. In a
    // rosterless fallback they must not become a guessed character name.
    return /^((?:冷|低|轻|柔|淡|慢|缓|幽|静|悄|急|默|微))\1$/u.test(value);
}

function isStructuralUnrosteredPersonDescriptor(value) {
    const name = String(value ?? '').trim();
    return /^(?:胖|瘦|高大|矮小|年轻|年迈|年老|金发|银发|红发|黑发|白发|独眼|驼背|蒙面|戴面具的?)(?:商人|贵客|客人|来客|访客|护卫|守卫|士兵|骑士|法师|祭司|教官|男子|女人|少女|少年|身影|人影)$/u.test(name);
}

function structuralLocalSubjectBoundaryScore(tail) {
    const value = String(tail ?? '');
    const bodyAction = value.match(/^[\p{Script=Han}]{1,2}(?:动(?:了)?(?:一下)?|颤(?:了)?(?:一下)?|僵(?:了)?|一紧|一松|一沉|一缩)/u);
    if (bodyAction) return 4 + Array.from(bodyAction[0]).length;
    if (/^(?:则|只|也|又|仍|就|便|立刻|马上|突然|随后|接着|然后|这时|此时|一边|掏出?|踹开|扫着|停顿|顿了顿|咳嗽|尖声|低声|轻声|小声|高声|大声)/u.test(value)) return 2;
    return new RegExp(`^(?:${STRUCTURAL_ACTION_CUE}|${STRUCTURAL_SPEECH_CUES.join('|')}|${STRUCTURAL_ENGLISH_SPEECH_CUES.join('|')})`, 'u').test(value) ? 1 : 0;
}

function structuralQuoteSpeakerEvidenceRank(ruleId) {
    if (['known-prefix', 'quoted-attribution', 'post-quote-attribution', 'expanded-explicit-signature', 'local-speech-cue', 'page-local-explicit-speech-cue',
        'leading-named-subject-colon-quote',
        'dashed-explicit-speech-cue', 'named-group-report-attribution', 'group-role-prefix',
        'reported-first-utterance', 'player-direct-speech', 'player-first-person-action',
        'player-first-person-speech', 'player-action-quoted-turn', 'player-social-closure'].includes(ruleId)) return 0;
    if (['ranked-unique-action-subject', 'named-subject-colon-quote', 'observed-subject-colon-quote',
        'unrostered-action-attribution', 'direct-action-attribution', 'honorific-display-title',
        'rostered-subject-quoted-clause', 'crowd-report-quote', 'self-identified-creature',
        'actor-vocalization-action'].includes(ruleId)) return 1;
    if (['pronoun-backreference', 'recent-action-backreference', 'named-reaction-backreference',
        'same-message-intro-pronoun-backreference', 'recent-pronoun-speaker-continuation',
        'prior-sentence-unique-action-subject', 'spirit-return-utterance',
        'bounded-dragon-name-backreference', 'laughter-speech-continuation', 'quoted-character-reaction',
        'character-expression-subject', 'player-known-prefix'].includes(ruleId)) return 2;
    return 3;
}

function findPairedAsciiSingleQuoteRanges(source) {
    const text = Array.isArray(source) ? source.join('') : String(source ?? '');
    const ranges = [];
    const pattern = /(?:^|[^\p{L}\p{N}])'[^'\r\n]{1,240}'(?=$|[^\p{L}\p{N}])/gu;
    for (const match of text.matchAll(pattern)) {
        const openingOffset = match.index + match[0].indexOf("'");
        const closingOffset = match.index + match[0].lastIndexOf("'");
        const start = Array.from(text.slice(0, openingOffset)).length;
        const end = Array.from(text.slice(0, closingOffset)).length + 1;
        if (start < end) ranges.push({ start, end });
    }
    return ranges;
}

function buildPlainNarrationPageTitleEvidence(coreText, { sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan, allowInlineQuotes = false }) {
    const text = Array.from(String(coreText ?? ''));
    let start = 0;
    let end = text.length;
    while (start < end && /\s/u.test(text[start])) start += 1;
    while (end > start && /\s/u.test(text[end - 1])) end -= 1;
    if (start === end) return null;
    const visible = text.slice(start, end).join('');
    // The full-message structural classifier may explicitly decide that an
    // inline quote is cited prose rather than an utterance. Only that path may
    // allow embedded quotes; direct/standalone quote-shaped pages stay unknown.
    if ((!allowInlineQuotes && (containsStructuralQuoteMarker(visible) || containsPairedAsciiSingleQuotedText(visible)))
        || isLikelyUnpublishedSpeakerPrefix(visible) || isLikelyStructuredKeyValueBlock(visible)
        || isLikelyStandalonePresentationHeading(visible)) return null;
    const firstLine = visible.split(/\r?\n/u, 1)[0];
    if (/^[-—–]\s*\S/u.test(firstLine)) return null;
    const evidenceSpan = { start: coreSpan.start + start, end: coreSpan.start + end };
    return {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: viewSpan.start, end: viewSpan.end },
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        classificationEvidenceSpans: [evidenceSpan],
        kind: 'classification',
        classification: 'narration',
        text: '旁白',
        speakers: [],
        ruleId: allowInlineQuotes && containsStructuralQuoteMarker(visible)
            ? 'narrative-framed-quote' : 'plain-prose-narration',
    };
}

function containsPairedAsciiSingleQuotedText(value) {
    return /(?:^|[^\p{L}\p{N}])'[^'\r\n]{1,240}'(?=$|[^\p{L}\p{N}])/u.test(String(value ?? ''));
}

function isLikelyStructuredKeyValueBlock(value) {
    const lines = String(value ?? '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const labeledLines = lines.filter((line) => /^[^:：]{1,48}[:：]\s*\S/u.test(line)).length;
    return labeledLines >= 2 && labeledLines * 2 >= lines.length;
}

function isLikelyStandalonePresentationHeading(value) {
    const text = String(value ?? '').trim();
    return /^#{1,6}\s+\S/u.test(text)
        || /^\([^()\r\n]{1,80}\)$/u.test(text)
        || /^（[^（）\r\n]{1,80}）$/u.test(text)
        || /^\[[^\[\]\r\n]{1,80}\]$/u.test(text)
        || /^【[^】\r\n]{1,80}】$/u.test(text)
        || /^《[^《》\r\n]{1,80}》$/u.test(text);
}

function isOrphanAsciiQuoteCloser(source, index) {
    let lineEnd = index + 1;
    while (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r'
        && /\s/u.test(source[lineEnd])) lineEnd += 1;
    if (lineEnd < source.length && source[lineEnd] !== '\n' && source[lineEnd] !== '\r') return false;

    let lineStart = index - 1;
    while (lineStart >= 0 && source[lineStart] !== '\n' && source[lineStart] !== '\r') lineStart -= 1;
    return source.slice(lineStart + 1, index).some((char) => !/\s/u.test(char));
}

function isLikelyUnpublishedSpeakerPrefix(text) {
    const firstLine = String(text ?? '').split(/\r?\n/u, 1)[0].trimStart();
    return /^(?:[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,3})\s*[:：]\s*\S/u.test(firstLine);
}

function isValidStructuralPageSpan(span, sourceLength) {
    return Number.isSafeInteger(span?.start) && Number.isSafeInteger(span?.end)
        && span.start >= 0 && span.end > span.start && span.end <= sourceLength;
}

function findStructuralSpeakerAttributions(coreText, publishedSpeakerNames, sourceOffset) {
    const source = Array.from(coreText);
    const quoteScan = findStructuralQuotedSpans(source);
    if (!quoteScan.reliable) return null;
    const matches = [];
    let hasUnresolvedAttribution = false;
    const lineLabels = findStructuralLineSpeakerLabels(source, publishedSpeakerNames, sourceOffset);
    matches.push(...lineLabels);

    for (const quote of quoteScan.spans) {
        const prefixStart = findStructuralAttributionStart(source, quote.start);
        const prefix = source.slice(prefixStart, quote.start);
        const suffixEnd = findStructuralAttributionEnd(source, quote.end);
        const suffix = source.slice(quote.end, suffixEnd);
        const prefixSpeaker = findStructuralSpeakerInPrefix(prefix, publishedSpeakerNames);
        const suffixSpeaker = findStructuralSpeakerInSuffix(suffix, publishedSpeakerNames,
            source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join(''));
        if (prefixSpeaker && suffixSpeaker && !sameStructuralSpeakerName(prefixSpeaker.text, suffixSpeaker.text)) {
            hasUnresolvedAttribution = true;
            continue;
        }
        const speaker = prefixSpeaker || suffixSpeaker;
        if (!speaker) {
            const enclosingLineLabel = lineLabels.find((item) => item.start >= sourceOffset + prefixStart
                && item.classificationEvidenceSpan.end <= sourceOffset + quote.start);
            if (enclosingLineLabel) {
                matches.push({
                    ...enclosingLineLabel,
                    classificationEvidenceSpan: {
                        start: enclosingLineLabel.classificationEvidenceSpan.start,
                        end: sourceOffset + quote.end,
                    },
                });
                continue;
            }
            if (!isStructuralNarrativeInformationFrame(source, quote, prefixStart, suffixEnd, speaker)) {
                hasUnresolvedAttribution = true;
            }
            continue;
        }
        const speakerBase = prefixSpeaker ? prefixStart : quote.end;
        const evidenceStart = prefixSpeaker ? prefixStart + speaker.evidenceStart : quote.start;
        const evidenceEnd = prefixSpeaker ? quote.end : Math.min(suffixEnd, quote.end + speaker.evidenceEnd);
        matches.push({
            text: speaker.text,
            displayText: speaker.displayText || speaker.text,
            start: sourceOffset + speakerBase + speaker.start,
            end: sourceOffset + speakerBase + speaker.end,
            classificationEvidenceSpan: {
                start: sourceOffset + evidenceStart,
                end: sourceOffset + evidenceEnd,
            },
            ruleId: speaker.ruleId,
        });
    }

    if (!matches.length) return quoteScan.spans.some((quote) => {
        const prefixStart = findStructuralAttributionStart(source, quote.start);
        const suffixEnd = findStructuralAttributionEnd(source, quote.end);
        const prefixSpeaker = findStructuralSpeakerInPrefix(source.slice(prefixStart, quote.start), publishedSpeakerNames);
        const suffixSpeaker = findStructuralSpeakerInSuffix(source.slice(quote.end, suffixEnd), publishedSpeakerNames,
            source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join(''));
        return !isStructuralNarrativeInformationFrame(source, quote, prefixStart, suffixEnd, prefixSpeaker || suffixSpeaker);
    }) ? null : [];
    const deduplicated = [];
    for (const match of matches) {
        const existing = deduplicated.find((item) => item.start === match.start && item.end === match.end);
        if (existing) {
            if (match.classificationEvidenceSpan.end > existing.classificationEvidenceSpan.end) {
                existing.classificationEvidenceSpan = match.classificationEvidenceSpan;
            }
            continue;
        }
        if (deduplicated.some((item) => item.start < match.end && match.start < item.end)) return null;
        deduplicated.push(match);
    }
    const sorted = deduplicated.sort((left, right) => left.start - right.start || left.end - right.end);
    sorted.hasUnresolvedAttribution = hasUnresolvedAttribution;
    return sorted;
}

const STRUCTURAL_QUOTE_OPENERS = new Map([['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’'], ['"', '"']]);
const STRUCTURAL_QUOTE_CLOSERS = new Set(STRUCTURAL_QUOTE_OPENERS.values());
const STRUCTURAL_SPEECH_CUES = ['补充了一句', '补了一句', '低声说', '轻声说', '小声说', '低声道', '轻声道', '喃喃道', '嘟囔道', '补充道', '提醒道', '回应道', '插话道', '解释道', '嘀咕道', '宣布道', '宣告道', '大喊', '高喊', '喊道', '答道', '问道', '说道', '继续道', '接着道', '咧嘴道', '介绍', '开口', '回答', '回复', '骂道', '哼了一声', '宣布', '宣告', '报告', '通报', '补充', '嘀咕', '提醒', '回应', '插话', '解释', '尖叫', '怒吼', '咆哮', '嘶声', '低语', '嘟囔', '说', '问', '答', '喊', '骂'];
const STRUCTURAL_ENGLISH_SPEECH_CUES = ['whispered', 'whispers', 'replied', 'replies', 'answered', 'answers', 'shouted', 'shouts', 'announced', 'announces', 'reported', 'reports', 'declared', 'declares', 'asked', 'asks', 'called', 'calls', 'said', 'says'];
const STRUCTURAL_INDIRECT_SPEECH_CUE = /(?:补(?:充)?|添加|提议|建议|请求|命令|吩咐|宣布|宣告|报告|通报|大喊|高喊|呼喊|叫喊|尖叫|怒吼|咆哮|嘶吼|低语|嘟囔|骂)(?:(?:了|上|出|起|过)?(?:一(?:句|声|下))?|道)?$/u;
const STRUCTURAL_ACTION_CUE = '(?:拍(?:了)?拍|骂了?一(?:句|声)|骂骂咧咧|扑(?:到|向|上|过去)|仔细阅读|阅读|一愣|脸色|神情|沉默|沉吟|松了口气|发亮|鉴定|看向|望向|看着|望着|望去|看去|盯住|盯着|转向|转身|回身|回头|朝|走到|走向|走近|走来|走过来|走过去|来到|找到|找了?|捡起|捡出|踢了?踢|丢给|扔给|丢出|扔出|递过|递给|递上|递到|塞进|塞给|推给|交给|伸手|点头|皱眉|微笑|冷笑|咬牙|咧嘴(?:一)?笑|沉思|继续|补充|回应|插话|解释|提醒|嘀咕|大笑|摇头|挥手|翻开|拿起|拿出|抓起|撕开|抱着|抱住|握紧|举手|举起|弯起|覆在|拂过|俯身|震惊|惊讶|疑惑|担忧|愤怒|兴奋|激动|忍不住|欢呼|低吼|清点|数(?:着)?|浮出|声音传来|声音响起|扫过|停下|停在|抬眼|抬头|戳|蹲到|蹲下|上手检查|检查|查看|探查|搜查|调查|蜷缩|蜷起|蜷在|等待|等候|躺在|躺下|跪在|咽(?:了)?口?气|跟在后面|(?:抬高|抬起|提高|压低|放低)(?:了)?声音|趴(?:伏)?在|蹲在|伏在|藏在|躲在|倚在|靠在|坐在|私下|通过|通讯|展翅|敬礼|冲过来|别在|站在|砸碎|低声说|轻声说|小声说|问道|说道|回答|宣布|喊道|说|问|喊)';

function findStructuralTurnHeaderSpeaker(valueText, publishedSpeakerNames = []) {
    const value = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '');
    const match = value.match(/^(.{1,48}?)(?:\s*的)?\s*回合$/u);
    const subject = match?.[1]?.trim();
    if (!subject || isStructuralInformationLabel(subject)) return null;
    if (/^(?:你|玩家|玩家角色)$/u.test(subject)) {
        return { text: '你', ruleId: 'player-direct-speech', start: 0, end: 1 };
    }
    const parsed = parseDirectStructuralSpeakerLabel(subject, publishedSpeakerNames, {
        allowUnknownHan: true, allowUnknownLatin: true,
    });
    if (!parsed || isUnrosteredHanSingleCharacterCue(parsed)) return null;
    const subjectOffset = Array.from(value.slice(0, value.indexOf(subject))).length;
    return {
        ...parsed,
        ruleId: parsed.ruleId === 'published-name' ? 'known-prefix' : 'line-speaker',
        start: subjectOffset + parsed.start,
        end: subjectOffset + parsed.end,
    };
}

function isCurlySingleQuoteApostrophe(chars, index) {
    const source = Array.isArray(chars) ? chars : Array.from(String(chars ?? ''));
    const left = source[index - 1];
    const right = source[index + 1];
    const isWordCharacter = (value) => typeof value === 'string' && /[\p{L}\p{N}]/u.test(value);
    // U+2019 is both an English-style apostrophe and a curly quote closer.
    // Treat it as a word-internal apostrophe only for Latin words (or a
    // numeric separator). Other scripts fail closed as a quote closer, so a
    // quoted word followed immediately by narration cannot swallow the next span.
    const latinWord = /[\p{Script=Latin}]/u.test(left || '') && /[\p{Script=Latin}]/u.test(right || '');
    const numericSeparator = /[\p{N}]/u.test(left || '') && /[\p{N}]/u.test(right || '');
    return source[index] === '’' && isWordCharacter(left) && isWordCharacter(right) && (latinWord || numericSeparator);
}

function containsStructuralQuoteMarker(value) {
    const chars = Array.from(String(value ?? ''));
    const markers = new Set(['“', '”', '「', '」', '『', '』', '‘', '’', '｢', '｣', '"']);
    return chars.some((char, index) => markers.has(char) && !isCurlySingleQuoteApostrophe(chars, index));
}

function findStructuralQuotedSpans(source) {
    const stack = [];
    const spans = [];
    const asciiSingleQuoteRanges = findPairedAsciiSingleQuoteRanges(source);
    const asciiSingleQuoteStarts = new Map(asciiSingleQuoteRanges.map((range) => [range.start, range.end]));
    const asciiSingleQuoteEnds = new Set(asciiSingleQuoteRanges.map((range) => range.end - 1));
    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (asciiSingleQuoteStarts.has(index)) {
            stack.push({ close: "'", start: index });
            continue;
        }
        if (asciiSingleQuoteEnds.has(index)) {
            if (stack.at(-1)?.close !== "'") return { reliable: false, spans: [] };
            const opening = stack.pop();
            if (!stack.length) spans.push({ start: opening.start, end: index + 1 });
            continue;
        }
        if (char === "'") continue;
        if (char === '"') {
            if (stack.at(-1)?.close === '"') {
                const opening = stack.pop();
                if (!stack.length) spans.push({ start: opening.start, end: index + 1 });
            } else if (!stack.length && isOrphanAsciiQuoteCloser(source, index)) {
                continue;
            } else {
                if (stack.length && stack.at(-1)?.close === '"') return { reliable: false, spans: [] };
                stack.push({ close: '"', start: index });
            }
            continue;
        }
        if (isCurlySingleQuoteApostrophe(source, index)) continue;
        if (STRUCTURAL_QUOTE_OPENERS.has(char)) {
            stack.push({ close: STRUCTURAL_QUOTE_OPENERS.get(char), start: index });
            continue;
        }
        if (!STRUCTURAL_QUOTE_OPENERS.has(char) && STRUCTURAL_QUOTE_CLOSERS.has(char)) {
            if (stack.at(-1)?.close !== char) return { reliable: false, spans: [] };
            const opening = stack.pop();
            if (!stack.length) spans.push({ start: opening.start, end: index + 1 });
        }
    }
    if (stack.length > 1) return { reliable: false, spans: [] };
    if (stack.length === 1) spans.push({ start: stack[0].start, end: source.length });
    return { reliable: true, spans: spans.sort((left, right) => left.start - right.start) };
}

function findStructuralLineSpeakerLabels(source, publishedSpeakerNames, sourceOffset) {
    const matches = [];
    let start = 0;
    while (start < source.length) {
        let end = source.indexOf('\n', start);
        if (end < 0) end = source.length;
        let contentStart = start;
        while (contentStart < end && /\s/u.test(source[contentStart])) contentStart += 1;
        let dashLedSpeakerLabel = false;
        if (['-', '—', '–'].includes(source[contentStart])) {
            dashLedSpeakerLabel = true;
            contentStart += 1;
            while (contentStart < end && /\s/u.test(source[contentStart])) contentStart += 1;
        }
        const line = source.slice(contentStart, end);
        if (!['#', '>', '*', '['].includes(line[0])) {
            const colon = line.findIndex((char) => char === ':' || char === '：');
            if (colon > 0 && colon < 80 && line.slice(colon + 1).some((char) => !/\s/u.test(char))) {
                const labelText = line.slice(0, colon).join('');
                const wholeLine = line.join('');
                const isRecordLine = isStructuralRecordShape(wholeLine)
                    && !hasStructuralDialogueCandidateShape(wholeLine);
                let candidate = findTrailingSpeechCue(labelText) ? null
                    : findStructuralTurnHeaderSpeaker(labelText, publishedSpeakerNames)
                        || parseStructuralSpeakerLabel(line.slice(0, colon), publishedSpeakerNames, {
                        // An unlisted bare `Name: “quote”` has the same shape
                        // as a heading/field label. It is a dialogue candidate,
                        // but not sufficient evidence to invent the speaker.
                        // Published names and cue-based attribution are resolved
                        // independently above.
                        allowUnknownHan: dashLedSpeakerLabel,
                        allowUnknownLatin: dashLedSpeakerLabel,
                        allowKnownPrefixExtension: false,
                    });
                if (isRecordLine) candidate = null;
                if (candidate?.ruleId === 'unknown-name' && candidate.text !== labelText.trim()) candidate = null;
                if (candidate) {
                    const nameStart = contentStart + candidate.start;
                    const nameEnd = contentStart + candidate.end;
                    matches.push({
                        text: candidate.text,
                        start: sourceOffset + nameStart,
                        end: sourceOffset + nameEnd,
                        classificationEvidenceSpan: { start: sourceOffset + nameStart, end: sourceOffset + contentStart + colon + 1 },
                        utteranceSpan: {
                            start: sourceOffset + contentStart + colon + 1,
                            end: sourceOffset + end,
                        },
                        ruleId: candidate.ruleId === 'published-name' ? 'known-prefix' : 'line-speaker',
                    });
                }
            }
        }
        if (end === source.length) break;
        start = end + 1;
    }
    return matches;
}

function isStructuralQuotedUtterance(source, quote, prefixStart, suffixEnd) {
    const prefix = source.slice(prefixStart, quote.start).join('').trim();
    const cuePrefix = prefix.replace(/[,，、]\s*$/u, '').trimEnd();
    const suffix = source.slice(quote.end, suffixEnd).join('').trim();
    if (!prefix) return true;
    if (findTrailingSpeechCue(cuePrefix) || /[:：]\s*$/u.test(prefix)) return true;
    if (/^(?:said|asked|replied|answered|shouted|whispered|called)\b/iu.test(suffix)) return true;
    const lineStart = source.lastIndexOf('\n', Math.max(0, quote.start - 1)) + 1;
    const lineEndIndex = source.indexOf('\n', quote.end);
    const lineEnd = lineEndIndex < 0 ? source.length : lineEndIndex;
    const beforeOnLine = source.slice(lineStart, quote.start).join('').trim();
    return !beforeOnLine;
}

function findStructuralAttributionStart(source, quoteStart) {
    let start = quoteStart;
    while (start > 0 && quoteStart - start < 160) {
        const previous = source[start - 1];
        if (previous === '\n' || /[。！？!?;；]/u.test(previous)) break;
        if (/[”」』"]/u.test(previous)) {
            const nearby = source.slice(Math.max(0, start - 16), quoteStart).join('').replace(/[:：]\s*$/u, '');
            if (!/(?:“[^”]{1,8}”|「[^」]{1,8}」|『[^』]{1,8}』|"[^"]{1,8}")[\p{Script=Han}]{2,4}(?:——|—|–)(?:走出来|走出|走来|走上前|站出来|站出)$/u.test(nearby)) break;
        }
        start -= 1;
    }
    while (start < quoteStart && /\s/u.test(source[start])) start += 1;
    while (['-', '—', '–', '*'].includes(source[start])) {
        start += 1;
        while (start < quoteStart && /\s/u.test(source[start])) start += 1;
    }
    return start;
}

function findStructuralAttributionEnd(source, quoteEnd) {
    let end = quoteEnd;
    const maxEnd = Math.min(source.length, quoteEnd + 100);
    while (end < maxEnd && !/[。！？!?;；.\n]/u.test(source[end])) end += 1;
    return end;
}

function hasStructuralTransferFrameSpeechCue(valueText) {
    const source = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '').trimEnd();
    return Boolean(findTrailingSpeechCue(source) && isStructuralMentalOrSourceTransferFrame(source));
}

function findStructuralDetachedSpeechCueStart(source, quoteStart) {
    let cueSpan = null;
    const directlyPrecedingSingleNewline = source[quoteStart - 1] === '\n' && source[quoteStart - 2] !== '\n';
    if (directlyPrecedingSingleNewline) {
        // Some generated replies put a continuation cue on its own line and
        // start the quote after one newline (`Oswin ... continued:\n“…”`).
        // Inspect only that immediately preceding line; never cross a blank
        // paragraph or widen the bounded local evidence window.
        let end = quoteStart;
        if (source[end - 1] === '\n') end -= 1;
        if (source[end - 1] === '\r') end -= 1;
        let start = end - 1;
        while (start >= 0 && source[start] !== '\n') start -= 1;
        start += 1;
        if (start < end && quoteStart - start <= 100
            && !source.slice(start, end).some((char) => char === '\n')) cueSpan = { start, end };
    }
    cueSpan ||= findStructuralPreviousParagraphSpan(source, quoteStart, 100);
    if (!cueSpan) return null;
    const start = cueSpan.start;
    const text = source.slice(start, cueSpan.end).join('').trim().replace(/[:：]\s*$/u, '').trimEnd();
    if (!text || containsStructuralQuoteMarker(text) || isLikelyStandalonePresentationHeading(text)
        || isStructuralQuotedInformationFrame(text, text)) return null;
    const cue = findTrailingSpeechCue(text);
    if (!cue || !/^(?:继续道|接着道|说|道|答|问|喊|叫|骂|低语|嘶声|解释|补充|提醒|回应|插话|介绍)/u.test(cue.text)) return null;
    return start;
}

function findStructuralDetachedSpeechCueOwner(source, quoteStart, knownNames = []) {
    const start = findStructuralDetachedSpeechCueStart(source, quoteStart);
    if (start == null) return null;
    const raw = source.slice(start, quoteStart).join('');
    const text = raw.trim().replace(/[:：]\s*$/u, '').trimEnd();
    const cue = findTrailingSpeechCue(text);
    if (!cue) return null;
    const beforeCue = Array.from(text).slice(0, cue.start).join('').replace(/[,，、]\s*$/u, '').trimEnd();
    const subject = findUnrosteredSubjectBeforeExplicitSpeechCue(beforeCue, cue.text);
    if (!subject || isStructuralAnonymousSpeakerDescription(subject.text)
        || /^(?:旁白|叙述|系统|记录|面板|屏幕|地图|账本|信件|告示|玩家|你)$/u.test(subject.text)) return null;
    const leading = raw.length - raw.trimStart().length;
    const speakerStart = start + Array.from(raw.slice(0, leading)).length + subject.start;
    const speakerSpan = { start: speakerStart, end: speakerStart + Array.from(subject.text).length };
    if (!isValidStructuralPageSpan(speakerSpan, source.length)
        || source.slice(speakerSpan.start, speakerSpan.end).join('') !== subject.text) return null;
    return { text: subject.text, speakerSpan };
}

function findStructuralTransferFrameSpeechSpeaker(valueText, publishedSpeakerNames = []) {
    const source = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '').trimEnd();
    const cue = findTrailingSpeechCue(source);
    if (!cue || !/(?:说|问|喊|回答|回应|解释|补充|提醒|低声道|轻声道|低语|喃喃道|嘟囔道|开口)/u.test(cue.text)) return null;
    const beforeCue = Array.from(source).slice(0, cue.start).join('').replace(/[，,]+$/u, '').trimEnd();
    const transferAction = /(?:把[^，,。！？!?;；:：]{1,32}(?:递给|递到|交给|交到|交出|递出|递过)[^，,。！？!?;；:：]{0,24}|(?:摊开|展开)[^，,。！？!?;；:：]{0,16}(?:报告|地图|账本|信件|卷轴|文书|清单|日志|记录册))/u;
    if (!isStructuralMentalOrSourceTransferFrame(beforeCue) || !transferAction.test(beforeCue)) return null;

    const names = [...new Set(Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])]
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim())
        .sort((left, right) => right.length - left.length);
    let speaker = names.find((name) => beforeCue.startsWith(name)
        && /^(?:把|摊开|展开)/u.test(beforeCue.slice(name.length))) || '';
    if (!speaker) {
        // The transfer marker is a grammatical boundary: infer only the whole
        // immediately preceding 2–4 Han-character subject, never extend the
        // name through 把 or into the carried object.
        speaker = beforeCue.match(/^(?<speaker>[\p{Script=Han}]{2,4})(?=把)/u)?.groups?.speaker || '';
    }
    if (!speaker || /^(?:你|我|他|她|它|我们|你们|他们|她们|众人|大家|报告|地图|账本|信件|卷轴|文书)$/u.test(speaker)) return null;
    return { text: speaker, start: 0, end: Array.from(speaker).length, ruleId: 'quoted-attribution' };
}

function findDirectActionSpeakerBeforeQuote(valueText, publishedSpeakerNames = []) {
    const source = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '').trimEnd();
    if (!source || Array.from(source).length > 180 || /[。！？!?;；\n]/u.test(source)
        || (isStructuralMentalOrSourceTransferFrame(source) && /(?:递给|递到|交给)(?:你|他|她|对方)/u.test(source))
        || isStructuralQuotedInformationFrame(source, source.split(/[，,]/u).at(-1)?.trim() || source)
        || /(?:心想|暗想|想着|思忖|思考|默念|心中|心里想|内心想)/u.test(source)) return null;
    // Possessive voice framing is direct attribution when a named subject's
    // voice performs a speech act. Keep the matched span on the subject only;
    // generic sound effects and written-content frames are handled elsewhere.
    const namedVoice = /(?:^|[，,、\s])(?<name>(?:[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}|[\p{Script=Han}]{2,4}))\s*的(?:声音|嗓音)(?:(?:突然|立刻|马上|低低地|高高地|尖锐地)\s*)?(?:尖叫(?:起来)?|喊(?:道|起来)?|叫(?:道|起来)?|大喊|高喊|嘶喊|哭喊|说(?:道|起来)?|响起|传来|回荡)[^。！？!?;；\n]*$/u.exec(source);
    if (namedVoice?.groups?.name) {
        const sourceStart = namedVoice.index + namedVoice[0].indexOf(namedVoice.groups.name);
        const roster = Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [];
        const isHanName = /^[\p{Script=Han}]+$/u.test(namedVoice.groups.name);
        // A Han run inside `只用尖细的声音说` can resemble a name even after
        // a comma. Only use this voice construction for Han names already
        // established by the bounded chat-local roster; Latin proper names
        // remain lexically distinguishable on first appearance.
        if (isHanName && !roster.includes(namedVoice.groups.name)) return null;
        const start = Array.from(source.slice(0, sourceStart)).length;
        return { text: namedVoice.groups.name, start, end: start + Array.from(namedVoice.groups.name).length,
            ruleId: 'unrostered-action-attribution' };
    }
    // Possessive body/state framing is usable only when it leads directly
    // into this quote's colon (`霜咬的眼神变得严肃：“...”`). The same
    // descriptive sentence on a previous page is not a speaking cue.
    const namedBodyState = /^(?<name>(?:[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}|[\p{Script=Han}]{2,4}))的(?:眼神|目光|眼睛|眼中|脸色|神情|表情|声音|嗓音|语气)[^。！？!?;；\n]{0,56}$/u.exec(source);
    if (namedBodyState?.groups?.name) {
        const start = Array.from(source.slice(0, namedBodyState.index)).length;
        return { text: namedBodyState.groups.name, start, end: start + Array.from(namedBodyState.groups.name).length,
            ruleId: 'unrostered-action-attribution' };
    }
    const titledActor = /(?<title>[“「『"][^”」』"]{1,8}[”」』"])(?<name>[\p{Script=Han}]{2,4})(?:——|—|–)(?<action>走出来|走出|走来|走上前|站出来|站出)$/u.exec(source);
    if (titledActor?.groups?.title && titledActor.groups.name && titledActor.groups.action) {
        const speakerText = `${titledActor.groups.title}${titledActor.groups.name}`;
        const start = Array.from(source.slice(0, titledActor.index)).length;
        return { text: speakerText, start, end: start + Array.from(speakerText).length };
    }
    // A reporting action can follow an organization/title phrase and a
    // possessive marker (`Iron Fist guild's Karl exclaimed`). Attribute only
    // the person-shaped name immediately before the cue.
    const possessiveActor = /的(?<name>[\p{Script=Han}]{2,4})(?<action>惊叹|喘着粗气|喘着|喘息|喘气|大喊|高喊|行礼)$/u.exec(source);
    if (possessiveActor?.groups?.name && possessiveActor.groups.action) {
        const start = Array.from(source.slice(0, possessiveActor.index + 1)).length;
        return { text: possessiveActor.groups.name, start, end: start + Array.from(possessiveActor.groups.name).length };
    }
    // A named creature may introduce speech through a short body/voice
    // description. Keep the recognized non-human subject set explicit.
    const creatureAction = /(?<name>亚龙|巨龙|恶龙|飞龙|龙兽|魔兽|怪物|魔物|生物)的(?:动作停顿|语气(?:稍微)?缓和|竖瞳凝视|目光凝视|身体停顿)[^。！？!?;；\n]{0,36}$/u.exec(source);
    if (creatureAction?.groups?.name) {
        const start = Array.from(source.slice(0, creatureAction.index)).length;
        return { text: creatureAction.groups.name, start, end: start + Array.from(creatureAction.groups.name).length };
    }
    if (/[、“”「」『』]/u.test(source)) return null;
    const action = /^(?:(?:也|则|又|先|立刻|马上|突然|随后|接着|然后|恭敬地|认真地|严肃地|平静地|兴奋地|冷静地|轻轻地|迅速地)\s*)*(?:(?:穿着|披着|戴着)[^。！？!?;；:：]{1,28}[，,]\s*)?(?:(?:把|将)[^。！？!?;；:：]{1,20}?)?(?:(?:用|以|借助)[^。！？!?;；:：]{1,28}?)?(?:丢给|扔给|丢出|扔出|抓起|咬牙|指着|指向|惊叹|喘着|喘息|喘气|大喊|高喊|行礼|跪下|跪倒|分工|检查|停住|扛起|扛着|扛在肩上|踱步|探头|踢(?:了)?踢|捡起|找(?:了)?|举手|递过|递给|治疗|摊开|顿了顿|中箭|愣住|喘着气|发亮|松了口气|鉴定|脸色|神情|表情)/u;
    const actorHonorific = /^(?:爵士|男爵|女爵|伯爵|公爵夫人|公爵|侯爵|子爵|夫人|女士|先生|大人|大法师|将军|队长|船长|骑士|守卫|队员)/u;
    const candidates = [];
    const add = (name, tail, start = 0, includeHonorific = false) => {
        if (!name || /(?:的|地|得|被|把|将|眼神|目光|眼睛|眼中|脸色|神情|表情)$/u.test(name)
            || /^(?:(?:随后|接着|然后|这时|此时|突然)\s*)?(?:你|我|他|她|它|我们|你们|他们|她们|自己|对方|有人|某人|陌生人|人影|身影|众人|大家|系统|旁白|叙述|地图|图表|图纸|海图|信件|信纸|卷轴|羊皮纸|账本|记录|日志|报告|公告|文书|清单|碑文|石碑|铭文)/u.test(name)
            || /[也则把]$/u.test(name) || isStructuralAnonymousSpeakerDescription(name)) return;
        const tailAfterHonorific = actorHonorific.exec(tail)?.[0] || '';
        const actionTail = tail.slice(Array.from(tailAfterHonorific).length).replace(/^(?:也|则)\s*/u, '');
        if (action.test(actionTail)) {
            const text = includeHonorific ? `${name}${tailAfterHonorific}` : name;
            const stripHonorific = includeHonorific && tailAfterHonorific === '伯爵';
            const displayText = stripHonorific ? name : text;
            candidates.push({ text, displayText,
                ruleId: stripHonorific ? 'honorific-display-title' : 'unrostered-action-attribution',
                start, end: start + Array.from(text).length });
        }
    };
    const roster = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    for (const name of roster) {
        if (source.startsWith(name)) add(name, source.slice(name.length));
    }
    if (!candidates.length) {
        const latin = source.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
        if (latin?.groups?.name && !/^(?:a|an|the)\s/iu.test(latin.groups.name)) add(latin.groups.name, latin.groups.tail);
        const titled = /^(?<name>[\p{Script=Han}]{2,4})(?<honorific>爵士|男爵|女爵|伯爵|公爵夫人|公爵|侯爵|子爵|夫人|女士|先生|大人|大法师|将军|队长|船长|骑士|守卫|队员)(?<tail>[\s\S]*)$/u.exec(source);
        const titledAction = Boolean(titled?.groups?.name && titled.groups.honorific && titled.groups.tail
            && action.test(titled.groups.tail));
        if (titledAction) {
            add(titled.groups.name, `${titled.groups.honorific}${titled.groups.tail}`, 0, true);
        }
        if (!titledAction) {
            const chars = Array.from(source);
            const hanRun = chars.findIndex((char) => !/\p{Script=Han}/u.test(char));
            const hanLength = hanRun < 0 ? chars.length : hanRun;
            for (let length = Math.min(4, hanLength); length >= 2; length -= 1) {
                add(chars.slice(0, length).join(''), chars.slice(length).join(''));
            }
        }
    }
    const unique = new Map();
    for (const candidate of candidates) {
        const key = normalizeStructuralSpeakerKey(candidate.text);
        if (key && !unique.has(key)) unique.set(key, candidate);
    }
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function findStructuralNamedPronounActionBeforeQuote(valueText) {
    const source = String(valueText ?? '').trim();
    if (!source || Array.from(source).length > 180 || /[。！？!?;；\n“”「」『』]/u.test(source)) return null;
    const pronoun = /[，,]\s*(?<pronoun>他|她)(?<tail>[^。！？!?;；\n]{0,52})$/u.exec(source);
    if (!pronoun?.groups?.tail || !/(?:看见|看到|望向|看向|点头|皱眉|微笑|行礼|鞠躬|转身|走来|走近|递上|递过|回答|示意)/u.test(pronoun.groups.tail)) return null;
    const subjectFrame = source.slice(0, pronoun.index).replace(/[，,]\s*$/u, '');
    const marker = /(?:已经|早已|早就|正在|正|刚刚?)/u.exec(subjectFrame);
    if (!marker) return null;
    const namedSubject = subjectFrame.slice(0, marker.index);
    const titled = /(?<title>工会长|公会长|会长|领队|队长|首领|长老|大人|先生|女士)(?<name>[\p{Script=Han}]{2,4})$/u.exec(namedSubject);
    let name = titled?.groups?.name || '';
    let nameUtf16Start = titled ? titled.index + titled.groups.title.length : -1;
    if (!name) {
        const plain = /(?<name>[\p{Script=Han}]{2,4})$/u.exec(namedSubject);
        const beforeName = plain ? namedSubject.slice(0, plain.index) : '';
        if (!plain || (beforeName && !/(?:^|[，,、;；]\s*|的)$/u.test(beforeName))) return null;
        name = plain.groups.name;
        nameUtf16Start = plain.index;
    }
    const markerTail = subjectFrame.slice(marker.index + marker[0].length);
    if (!/^[^。！？!?;；\n]{0,32}$/u.test(markerTail)) return null;
    const nameStartBeforeMarker = namedSubject.slice(nameUtf16Start);
    if (nameStartBeforeMarker !== name) return null;
    const start = Array.from(source.slice(0, nameUtf16Start)).length;
    return { text: name, start, end: start + Array.from(name).length };
}

function findStructuralDirectSpeechCueSpeaker(prefix, publishedSpeakerNames = []) {
    const source = (Array.isArray(prefix) ? prefix : Array.from(String(prefix ?? '')))
        .join('').trimEnd().replace(/[:：]\s*$/u, '').trimEnd();
    if (!source || isStructuralQuotedInformationFrame(source, source)) return null;
    const cue = findTrailingSpeechCue(source);
    if (!cue) return null;
    const beforeCue = Array.from(source).slice(0, cue.start).join('').replace(/[，,、]+$/u, '').trimEnd();
    if (!beforeCue || isStructuralMentalOrSourceTransferFrame(source)) return null;

    const mannerBoundary = /(?:又|仍|再次|随后|接着|然后)?(?:压低(?:了)?声音|放低(?:了)?声音|提高(?:了)?声音|抬高(?:了)?声音|冷冷|冷声|淡淡|缓缓|慢慢|轻轻地|轻轻|严肃地|认真地|平静地|急切地|怒气冲冲地)$/u.exec(beforeCue);
    const subjectText = (mannerBoundary ? beforeCue.slice(0, mannerBoundary.index) : beforeCue).trim();
    if (!subjectText) return null;
    if (/^(?:我|你|他|她|它|我们|你们|他们|她们|大家|全员|众人|某人|有人)(?:$|[\p{Script=Han}])/u.test(subjectText)) return null;
    const names = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    const known = names.find((name) => subjectText === name || (subjectText.startsWith(name)
        && /^(?:公爵夫人|大法师|将军|领队|队长|船长|法师|贵客|来客|访客|客人|男爵|伯爵|子爵|夫人|女士|先生|大人)$/u
            .test(subjectText.slice(name.length))));
    if (!known && isStructuralAnonymousSpeakerDescription(subjectText)) return { anonymous: true };
    const latin = subjectText.match(/^[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}$/u)?.[0];
    const han = subjectText.match(/^[\p{Script=Han}]{2,4}$/u)?.[0];
    const speaker = known || latin || han;
    if (!speaker || /^(?:我|你|他|她|它|我们|你们|他们|她们|旁白|系统|叙述)$/u.test(speaker)) return null;
    const speakerOffset = Array.from(source.slice(0, source.indexOf(subjectText))).length;
    return {
        text: speaker,
        start: speakerOffset,
        end: speakerOffset + Array.from(speaker).length,
        ruleId: known ? 'known-prefix' : 'quoted-attribution',
    };
}

function findStructuralPriorPagePronounResumption({ messageIndex, chars, core, priorPages, quoteSpan }) {
    if (priorPages.length < 2 || !isValidStructuralPageSpan(quoteSpan, chars.length)
        || isNarrativeSoundEffectSpan(chars, quoteSpan)) return null;
    const bridgePage = priorPages.at(-1);
    const anchorPages = priorPages.slice(0, -1);
    if (!bridgePage || !anchorPages.length) return null;
    const bridgeText = chars.slice(bridgePage.sourceSpan.start, bridgePage.sourceSpan.end).join('').trim();
    if (!bridgeText || containsStructuralQuoteMarker(bridgeText)
        || containsStructuralWrittenCarrierFrame(bridgeText, chars.slice(quoteSpan.start, quoteSpan.end).join())
        || isStructuralQuotedInformationFrame(bridgeText, chars.slice(quoteSpan.start, quoteSpan.end).join())) return null;
    const pronounFrame = /^(?:(?:随后|接着|然后|这时|此时)\s*)?(?<pronoun>她|他|它)(?<tail>[^。！？!?;；\n]{0,100})[。！？!?]$/u.exec(bridgeText);
    if (!pronounFrame?.groups?.tail
        || !new RegExp(`(?:${STRUCTURAL_ACTION_CUE}|看.{0,4}一眼)`, 'u').test(pronounFrame.groups.tail)) return null;

    const candidates = [];
    for (const anchor of messageIndex.anchors || []) {
        if (anchor?.certainty !== 'explicit' || anchor.groupId || typeof anchor.speakerText !== 'string'
            || !anchor.speakerText.trim() || /^(?:你|我|他|她|它|该角色|那名角色|这个人|旁白|众人|全员)$/u.test(anchor.speakerText)
            || !isValidStructuralPageSpan(anchor.speakerSpan, chars.length)
            || chars.slice(anchor.speakerSpan.start, anchor.speakerSpan.end).join('') !== anchor.speakerText) continue;
        for (const utterance of anchor.utteranceSpans || []) {
            if (!isValidStructuralPageSpan(utterance, chars.length) || utterance.end > bridgePage.sourceSpan.start
                || !anchorPages.some((page) => utterance.start < page.sourceSpan.end && page.sourceSpan.start < utterance.end)
                || findLatestStructuralSceneBoundaryEnd(chars, utterance.end, bridgePage.sourceSpan.start) != null) continue;
            const bridgeStart = isValidStructuralPageSpan(anchor.quoteSpan, chars.length)
                && anchor.quoteSpan.end >= utterance.end ? anchor.quoteSpan.end : utterance.end;
            const bridge = chars.slice(bridgeStart, bridgePage.sourceSpan.start).join('');
            if (containsStructuralQuoteMarker(bridge)
                || isStructuralQuotedInformationFrame(bridge, chars.slice(quoteSpan.start, quoteSpan.end).join())) continue;
            candidates.push({ speakerText: anchor.speakerText, speakerSpan: anchor.speakerSpan, utteranceSpan: utterance });
        }
    }
    if (!candidates.length) return null;
    const latestEnd = Math.max(...candidates.map((candidate) => candidate.utteranceSpan.end));
    const latest = candidates.filter((candidate) => candidate.utteranceSpan.end === latestEnd);
    const unique = new Map(latest.map((candidate) => [normalizeStructuralSpeakerKey(candidate.speakerText), candidate]));
    if (unique.size !== 1) return null;
    const selected = [...unique.values()][0];
    const pageShape = classifyStructuralPageShape({ fullText: chars.join(''), pageType: 'dialogue', coreSpan: core, messageIndex });
    if (['heading', 'structured-record', 'ambiguous'].includes(pageShape.kind)) return null;
    return {
        speakerText: selected.speakerText,
        speakerSpan: selected.speakerSpan,
        quoteSpan,
        ruleId: 'prior-page-pronoun-speaker-resumption',
    };
}

function findStructuralSpeakerInPrefix(prefix, publishedSpeakerNames, parserVersion = 'full-message-speaker-index.v84') {
    const text = prefix.join('').trim();
    if (!text || /^\s*(?:#{1,6}|>)/u.test(text)) return null;
    const prefixChars = prefix.join('');
    const leadingOffset = Array.from(prefixChars.slice(0, prefixChars.length - prefixChars.trimStart().length)).length;
    const value = Array.from(text.replace(/\s+$/u, ''));
    const valueText = value.join('');
    const compoundNamedColonActor = /^[\p{Script=Han}]{2,4}·[\p{Script=Han}]{1,4}(?=.{0,56}(?:站起来|站起|站稳|起身|抬头|抬起|睁开|微笑|笑着|点头|转身|看向|望向|审视|打量|指向|用|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|探出|咆哮|怒吼|咧嘴))/u.test(valueText);
    const namedColonActor = compoundNamedColonActor
        ? findStructuralNamedSubjectBeforeColon(valueText, publishedSpeakerNames, parserVersion) : null;
    if (namedColonActor) return {
        ...namedColonActor,
        start: leadingOffset + namedColonActor.start,
        end: leadingOffset + namedColonActor.end,
        evidenceStart: leadingOffset + namedColonActor.start,
        ruleId: 'named-subject-colon-quote',
    };
    const namedGroup = findStructuralNamedGroupSpeakerPrefix(valueText);
    if (namedGroup) return {
        ...namedGroup,
        start: leadingOffset + namedGroup.start,
        end: leadingOffset + namedGroup.end,
        groupMembers: namedGroup.groupMembers.map((member) => ({
            ...member,
            start: leadingOffset + member.start,
            end: leadingOffset + member.end,
        })),
        evidenceStart: leadingOffset + namedGroup.start,
    };
    const possessiveEntityActor = findStructuralPossessiveEntityActionSpeaker(valueText);
    if (possessiveEntityActor) return {
        ...possessiveEntityActor,
        start: leadingOffset + possessiveEntityActor.start,
        end: leadingOffset + possessiveEntityActor.end,
        evidenceStart: leadingOffset + possessiveEntityActor.start,
    };
    const pronounActionActor = findStructuralNamedPronounActionBeforeQuote(valueText);
    if (pronounActionActor) return {
        ...pronounActionActor,
        start: leadingOffset + pronounActionActor.start,
        end: leadingOffset + pronounActionActor.end,
        evidenceStart: leadingOffset + pronounActionActor.start,
        ruleId: 'pronoun-backreference',
    };
    const laughingActor = findStructuralLaughingActorBeforeQuote(valueText);
    if (laughingActor) return {
        ...laughingActor,
        start: leadingOffset + laughingActor.start,
        end: leadingOffset + laughingActor.end,
        evidenceStart: leadingOffset + laughingActor.start,
        ruleId: 'unrostered-action-attribution',
    };
    const transferSpeechSpeaker = findStructuralTransferFrameSpeechSpeaker(valueText, publishedSpeakerNames);
    if (transferSpeechSpeaker) return {
        ...transferSpeechSpeaker,
        start: leadingOffset + transferSpeechSpeaker.start,
        end: leadingOffset + transferSpeechSpeaker.end,
        evidenceStart: leadingOffset + transferSpeechSpeaker.start,
    };
    if (hasStructuralTransferFrameSpeechCue(valueText)) return null;
    // An explicit speech predicate is stronger than the coarser action-head
    // parser. Let the trailing-cue path split “塞莎又压低声音补了一句” before
    // generic action parsing can absorb the discourse particle into her name.
    const directActionActor = findTrailingSpeechCue(valueText)
        ? null : findDirectActionSpeakerBeforeQuote(valueText, publishedSpeakerNames);
    if (directActionActor) return {
        ...directActionActor,
        start: leadingOffset + directActionActor.start,
        end: leadingOffset + directActionActor.end,
        evidenceStart: leadingOffset + directActionActor.start,
        ruleId: directActionActor.ruleId || 'unrostered-action-attribution',
    };
    const playerFirstPersonAction = findStructuralPlayerFirstPersonActionBeforeQuote(valueText);
    if (playerFirstPersonAction) return {
        text: '我', displayText: '你', ruleId: 'player-first-person-action',
        start: leadingOffset + playerFirstPersonAction.start,
        end: leadingOffset + playerFirstPersonAction.end,
        evidenceStart: leadingOffset + playerFirstPersonAction.start,
    };
    const playerFirstPersonActor = findStructuralPlayerFirstPersonSpeechPrefix(valueText);
    if (playerFirstPersonActor) return {
        text: '你', ruleId: 'player-first-person-speech',
        start: leadingOffset + playerFirstPersonActor.start,
        end: leadingOffset + playerFirstPersonActor.end,
        evidenceStart: leadingOffset + playerFirstPersonActor.start,
    };
    const playerSpeaker = findPlayerDirectSpeechPrefix(valueText, publishedSpeakerNames);
    if (playerSpeaker) return {
        text: '你', ruleId: 'player-direct-speech', start: leadingOffset + playerSpeaker.start,
        end: leadingOffset + playerSpeaker.end, evidenceStart: leadingOffset + playerSpeaker.start,
    };
    const playerActionSpeaker = findStructuralPlayerActionBeforeQuote(valueText);
    if (playerActionSpeaker) return {
        text: '你', ruleId: 'player-action-quoted-turn', start: leadingOffset + playerActionSpeaker.start,
        end: leadingOffset + playerActionSpeaker.end, evidenceStart: leadingOffset + playerActionSpeaker.start,
    };
    const groupSpeaker = findStructuralGroupSpeakerPrefix(valueText);
    if (groupSpeaker) return {
        ...groupSpeaker,
        start: leadingOffset + groupSpeaker.start,
        end: leadingOffset + groupSpeaker.end,
        evidenceStart: leadingOffset + groupSpeaker.start,
    };
    if (parserVersion === 'full-message-speaker-index.v74' || isStructuralParserVersionV75(parserVersion)) {
        const cue = findTrailingSpeechCue(valueText.replace(/[:：]\s*$/u, ''));
        if (cue) {
            const rosteredCueSpeaker = isStructuralParserVersionV75(parserVersion)
                ? findV75RosteredCueSpeaker(Array.from(valueText).slice(0, cue.start).join('').replace(/[，,]+$/u, ''), publishedSpeakerNames, cue.text)
                : findV74RosteredCueSpeaker(
                Array.from(valueText).slice(0, cue.start).join('').replace(/[，,]+$/u, ''),
                publishedSpeakerNames,
                cue.text,
            );
            if (rosteredCueSpeaker) return {
                ...rosteredCueSpeaker,
                start: leadingOffset + rosteredCueSpeaker.start,
                end: leadingOffset + rosteredCueSpeaker.end,
                evidenceStart: leadingOffset + rosteredCueSpeaker.start,
            };
        }
    }
    if (hasCoordinatedSubjectsBeforeAction(valueText, publishedSpeakerNames)) return null;
    const turnHeaderSpeaker = findStructuralTurnHeaderSpeaker(valueText, publishedSpeakerNames);
    if (turnHeaderSpeaker) return {
        ...turnHeaderSpeaker,
        start: leadingOffset + turnHeaderSpeaker.start,
        end: leadingOffset + turnHeaderSpeaker.end,
        evidenceStart: leadingOffset + turnHeaderSpeaker.start,
    };
    const cue = findTrailingSpeechCue(valueText);
    if (cue) {
        const beforeCue = Array.from(valueText.slice(0, cue.start)).join('').trimEnd();
        const lastComma = Math.max(beforeCue.lastIndexOf('，'), beforeCue.lastIndexOf(','));
        const clauseOffset = lastComma + 1;
        const finalClauseRaw = beforeCue.slice(clauseOffset);
        const finalClause = finalClauseRaw.trimStart();
        const finalClauseOffset = clauseOffset + Array.from(finalClauseRaw.slice(0, finalClauseRaw.length - finalClauseRaw.trimStart().length)).length;
        const v74RosteredCueSpeaker = isStructuralParserVersionV75(parserVersion)
            ? findV75RosteredCueSpeaker(beforeCue, publishedSpeakerNames, cue.text)
            : parserVersion === 'full-message-speaker-index.v74'
                ? findV74RosteredCueSpeaker(beforeCue, publishedSpeakerNames, cue.text) : null;
        if (v74RosteredCueSpeaker) return {
            ...v74RosteredCueSpeaker,
            start: leadingOffset + v74RosteredCueSpeaker.start,
            end: leadingOffset + v74RosteredCueSpeaker.end,
            evidenceStart: leadingOffset + v74RosteredCueSpeaker.start,
        };
        const rosteredPredicateSpeaker = findRosteredSpeakerBeforeSpeechCue(beforeCue, publishedSpeakerNames, parserVersion);
        if (rosteredPredicateSpeaker) return {
            ...rosteredPredicateSpeaker,
            start: leadingOffset + rosteredPredicateSpeaker.start,
            end: leadingOffset + rosteredPredicateSpeaker.end,
            evidenceStart: leadingOffset + rosteredPredicateSpeaker.start,
        };
        const parsed = parseDirectStructuralSpeakerLabel(finalClause, publishedSpeakerNames, {
            allowUnknownHan: true, allowUnknownLatin: true,
        });
        if (parsed && !isUnrosteredHanSingleCharacterCue(parsed, cue.text)) return { ...parsed,
            start: leadingOffset + finalClauseOffset + parsed.start,
            end: leadingOffset + finalClauseOffset + parsed.end,
            evidenceStart: leadingOffset + finalClauseOffset + parsed.start,
            ruleId: 'quoted-attribution' };
        const actionSubject = findUnrosteredSubjectBeforeAction(beforeCue);
        if (actionSubject) return { ...actionSubject,
            start: leadingOffset + actionSubject.start,
            end: leadingOffset + actionSubject.end,
            evidenceStart: leadingOffset + actionSubject.start };
        const explicitSubject = findUnrosteredSubjectBeforeExplicitSpeechCue(beforeCue, cue.text);
        if (explicitSubject) return { ...explicitSubject,
            start: leadingOffset + explicitSubject.start,
            end: leadingOffset + explicitSubject.end,
            evidenceStart: leadingOffset + explicitSubject.start,
            ruleId: 'quoted-attribution' };
    }
    if (valueText.endsWith(':') || valueText.endsWith('：')) {
        const beforeColon = Array.from(valueText.slice(0, -1)).join('').trimEnd();
        const observedActor = /^(?<name>[\p{Script=Han}]{2,4})(?:看到|看见|注意到|察觉|发现)[^。！？!?;；\n，,]{1,32}[，,](?<reaction>[^。！？!?;；\n]{1,40})$/u.exec(beforeColon);
        if (observedActor?.groups?.name && !isGenericCharacterNoun(observedActor.groups.name)
            && /(?:眼|瞳|目光|神情|脸色|表情|身体|身躯|龙鳞|龙瞳|动作|手臂|翅膀|武器|闪烁|颤抖|发亮|收紧|绷紧|一震)/u.test(observedActor.groups.reaction)) {
            return {
                text: observedActor.groups.name,
                start: leadingOffset,
                end: leadingOffset + Array.from(observedActor.groups.name).length,
                evidenceStart: leadingOffset,
                ruleId: 'observed-subject-colon-quote',
            };
        }
        const reportedFirstUtterance = findReportedFirstUtteranceSpeaker(beforeColon, publishedSpeakerNames);
        if (reportedFirstUtterance) return {
            ...reportedFirstUtterance,
            start: leadingOffset + reportedFirstUtterance.start,
            end: leadingOffset + reportedFirstUtterance.end,
            evidenceStart: leadingOffset + reportedFirstUtterance.start,
            ruleId: 'reported-first-utterance',
        };
        const fullPrefixCue = findTrailingSpeechCue(beforeColon);
        if (fullPrefixCue) {
            const speechPrefix = Array.from(beforeColon).slice(0, fullPrefixCue.start).join('').trimEnd();
            // A reporting verb inside a source frame (a map, letter, record,
            // system panel) does not make the preceding character its speaker.
            // Explicit character speech such as `Pippa说` remains eligible.
            const sourceInformationFrame = isStructuralQuotedInformationFrame(beforeColon, speechPrefix);
            if (!sourceInformationFrame && !isStructuralMentalOrSourceTransferFrame(beforeColon)
                && parserVersion !== 'full-message-speaker-index.v74' && !isStructuralParserVersionV75(parserVersion)) {
                const rosteredPredicateSpeaker = findRosteredSpeakerBeforeSpeechCue(speechPrefix, publishedSpeakerNames, parserVersion);
                if (rosteredPredicateSpeaker) return {
                    ...rosteredPredicateSpeaker,
                    start: leadingOffset + rosteredPredicateSpeaker.start,
                    end: leadingOffset + rosteredPredicateSpeaker.end,
                    evidenceStart: leadingOffset + rosteredPredicateSpeaker.start,
                };
            }
            if (!sourceInformationFrame && !isStructuralMentalOrSourceTransferFrame(beforeColon)
                && (parserVersion === 'full-message-speaker-index.v74' || isStructuralParserVersionV75(parserVersion))) {
                const lastClauseOffset = Math.max(speechPrefix.lastIndexOf('，'), speechPrefix.lastIndexOf(',')) + 1;
                const rawSpeechClause = speechPrefix.slice(lastClauseOffset);
                const speechClause = rawSpeechClause.trim();
                const speechClauseLeadingSpace = rawSpeechClause.length - rawSpeechClause.trimStart().length;
                const cueOnlyClause = new RegExp(`^(?:${STRUCTURAL_ACTION_CUE})`, 'u').test(speechClause);
                const explicitSubject = cueOnlyClause ? null
                    : findUnrosteredSubjectBeforeExplicitSpeechCue(speechClause, fullPrefixCue.text);
                if (explicitSubject) {
                    const normalizedSpeaker = explicitSubject.text.replace(/(?:随后|接着|然后|同时|这时|此时)$/u, '');
                    if (normalizedSpeaker !== explicitSubject.text && isGenericCharacterNoun(normalizedSpeaker)) return null;
                    const localStart = Array.from(speechPrefix.slice(0, lastClauseOffset + speechClauseLeadingSpace)).length + explicitSubject.start;
                    const explicitCandidate = {
                        ...explicitSubject,
                        text: normalizedSpeaker,
                        start: leadingOffset + localStart,
                        end: leadingOffset + localStart + Array.from(normalizedSpeaker).length,
                        evidenceStart: leadingOffset + localStart,
                        ruleId: 'quoted-attribution',
                    };
                    const exactPublishedActor = (Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
                        .find((name) => typeof name === 'string' && explicitCandidate.text.startsWith(name));
                    if (!exactPublishedActor) return explicitCandidate;
                }
                if (/^(?:(?:随后|接着|然后|这时|此时|突然|同时)\s*)?(?:(?:一个|一名|一位|那名|那位)\s*)?(?:守卫|侍卫|护卫|士兵|骑士|法师|术士|村民|队员|同伴|敌人|海盗|群众|人群|众人|大家)/u.test(speechClause)) return null;
                const rosteredPredicateSpeaker = findRosteredSpeakerBeforeSpeechCue(speechPrefix, publishedSpeakerNames);
                if (rosteredPredicateSpeaker) return {
                    ...rosteredPredicateSpeaker,
                    start: leadingOffset + rosteredPredicateSpeaker.start,
                    end: leadingOffset + rosteredPredicateSpeaker.end,
                    evidenceStart: leadingOffset + rosteredPredicateSpeaker.start,
                };
                if (!explicitSubject) {
                    const prefixSubject = findUnrosteredSubjectBeforeExplicitSpeechCue(speechPrefix, fullPrefixCue.text);
                    if (prefixSubject) return {
                        ...prefixSubject,
                        start: leadingOffset + prefixSubject.start,
                        end: leadingOffset + prefixSubject.end,
                        evidenceStart: leadingOffset + prefixSubject.start,
                        ruleId: 'quoted-attribution',
                    };
                }
                if (explicitSubject) {
                    const normalizedSpeaker = explicitSubject.text.replace(/(?:随后|接着|然后|同时|这时|此时)$/u, '');
                    const localStart = Array.from(speechPrefix.slice(0, lastClauseOffset + speechClauseLeadingSpace)).length + explicitSubject.start;
                    return {
                        ...explicitSubject,
                        text: normalizedSpeaker,
                        start: leadingOffset + localStart,
                        end: leadingOffset + localStart + Array.from(normalizedSpeaker).length,
                        evidenceStart: leadingOffset + localStart,
                        ruleId: 'quoted-attribution',
                    };
                }
            }
        } else if (isStructuralMentalOrSourceTransferFrame(beforeColon)) return null;
        const commaStart = Math.max(beforeColon.lastIndexOf('，'), beforeColon.lastIndexOf(','));
        const finalClauseStart = commaStart + 1;
        const finalClause = beforeColon.slice(finalClauseStart).trimStart();
        const finalClauseOffset = finalClauseStart + (beforeColon.slice(finalClauseStart).length - beforeColon.slice(finalClauseStart).trimStart().length);
        const finalClauseCue = findTrailingSpeechCue(finalClause);
        const useFinalClause = Boolean(finalClauseCue)
            && !/^(?:只是|也是|就是|然后|随后|接着|这时|此时|所以|但是|她|他|它|你|我|我们|你们|他们|她们)/u.test(finalClause);
        const speakerContext = useFinalClause ? finalClause : beforeColon;
        const speakerContextOffset = useFinalClause ? finalClauseOffset : 0;
        const trailingCue = useFinalClause ? finalClauseCue : findTrailingSpeechCue(beforeColon);
        const speakerText = trailingCue
            ? Array.from(speakerContext).slice(0, trailingCue.start).join('').trimEnd()
            : speakerContext;
        const parsed = parseDirectStructuralSpeakerLabel(speakerText, publishedSpeakerNames, {
            allowUnknownHan: Boolean(trailingCue), allowUnknownLatin: Boolean(trailingCue),
        });
        if (!trailingCue && hasCompetingRosteredSubjects(speakerText, publishedSpeakerNames)) return null;
        if (!trailingCue) {
            const contextual = findRosteredSpeakerBeforeNarrativeColon(speakerText, publishedSpeakerNames);
            if (contextual) return {
                ...contextual,
                start: leadingOffset + speakerContextOffset + contextual.start,
                end: leadingOffset + speakerContextOffset + contextual.end,
                evidenceStart: leadingOffset + speakerContextOffset + contextual.start,
                ruleId: 'rostered-subject-quoted-clause',
            };
        }
        if (!trailingCue && parsed?.ruleId === 'published-name'
            && parsed.end < Array.from(speakerText.trim()).length) return null;
        let actionSubject = findUnrosteredSubjectBeforeAction(speakerText);
        let actionSubjectOffset = speakerContextOffset;
        if (!actionSubject && useFinalClause) {
            const fullPrefixCue = findTrailingSpeechCue(beforeColon);
            const actionPrefix = fullPrefixCue
                ? Array.from(beforeColon).slice(0, fullPrefixCue.start).join('').trimEnd()
                : beforeColon;
            actionSubject = findUnrosteredSubjectBeforeAction(actionPrefix);
            actionSubjectOffset = 0;
        }
        if (actionSubject && parsed?.ruleId !== 'published-name') return { ...actionSubject,
            start: leadingOffset + actionSubjectOffset + actionSubject.start,
            end: leadingOffset + actionSubjectOffset + actionSubject.end,
            evidenceStart: leadingOffset + actionSubjectOffset + actionSubject.start,
        };
        const uniqueActionSubject = findUnrosteredUniqueActionSubjectBeforeQuote(beforeColon, publishedSpeakerNames);
        if (uniqueActionSubject) return { ...uniqueActionSubject,
            start: leadingOffset + uniqueActionSubject.start,
            end: leadingOffset + uniqueActionSubject.end,
            evidenceStart: leadingOffset + uniqueActionSubject.start,
            ruleId: 'unrostered-action-attribution',
        };
        if (parsed && !isUnrosteredHanSingleCharacterCue(parsed, trailingCue?.text)) return { ...parsed,
            start: leadingOffset + speakerContextOffset + parsed.start,
            end: leadingOffset + speakerContextOffset + parsed.end,
            evidenceStart: leadingOffset + parsed.start + speakerContextOffset, ruleId: parsed.ruleId === 'published-name' ? 'known-prefix' : 'quoted-attribution' };
        if (fullPrefixCue && parserVersion !== 'full-message-speaker-index.v74' && !isStructuralParserVersionV75(parserVersion)
            && !isStructuralQuotedInformationFrame(beforeColon,
                Array.from(beforeColon).slice(0, fullPrefixCue.start).join('').trimEnd())
            && !isStructuralMentalOrSourceTransferFrame(beforeColon)) {
            const speechPrefix = Array.from(beforeColon).slice(0, fullPrefixCue.start).join('').trimEnd();
            const explicitSubject = findUnrosteredSubjectBeforeExplicitSpeechCue(speechPrefix, fullPrefixCue.text);
            if (explicitSubject) return { ...explicitSubject,
                start: leadingOffset + explicitSubject.start,
                end: leadingOffset + explicitSubject.end,
                evidenceStart: leadingOffset + explicitSubject.start,
                ruleId: 'quoted-attribution' };
        }
    }
    const namedSubjectActor = findStructuralNamedSubjectBeforeColon(valueText, publishedSpeakerNames, parserVersion);
    if (namedSubjectActor) return {
        ...namedSubjectActor,
        start: leadingOffset + namedSubjectActor.start,
        end: leadingOffset + namedSubjectActor.end,
        evidenceStart: leadingOffset + namedSubjectActor.start,
        ruleId: 'named-subject-colon-quote',
    };
    return null;
}

function findStructuralCompoundNamedSubject(clause) {
    const value = String(clause ?? '');
    const head = /^([\p{Script=Han}]{2,4}·)([\p{Script=Han}]{1,8})([\s\S]*)$/u.exec(value);
    if (!head) return null;
    const [, nameHead, suffix, remaining] = head;
    const actions = /(?:站起来|站起|站稳|起身|抬头|抬起|睁开|微笑|笑着|点头|转身|看向|望向|审视|打量|指向|用|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|探出|咆哮|怒吼|咧嘴)/u;
    const directAction = /^(?:站起来|站起|站稳|起身|抬头|抬起|睁开|微笑|笑着|点头|转身|看向|望向|审视|打量|指向|用|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|探出|咆哮|怒吼|咧嘴)/u;
    const descriptiveLead = /^(?:巨大(?:的)?|宽大(?:的)?|强壮(?:的)?|高大(?:的)?|银白色(?:的)?|冰蓝色(?:的)?|锋利(?:的)?|厚重(?:的)?|巨型(?:的)?)/u;
    for (let length = Math.min(4, Array.from(suffix).length); length >= 1; length -= 1) {
        const nameTail = Array.from(suffix).slice(0, length).join('');
        const tail = Array.from(suffix).slice(length).join('') + remaining;
        const hasDirectAction = directAction.test(tail);
        const hasDescribedAction = descriptiveLead.test(tail) && Array.from(tail).length <= 56 && actions.test(tail);
        const nameEndsInAction = /(?:用|站|起|抬|睁|微笑|笑着|点头|转身|看向|望向|审视|打量|指向|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|探出|咆哮|怒吼|咧嘴)$/u.test(nameTail);
        if ((hasDirectAction || hasDescribedAction) && !(hasDescribedAction && nameEndsInAction)
            && !/[。！？!?;；\n]/u.test(tail)) {
            return { text: `${nameHead}${nameTail}`, tail };
        }
    }
    return null;
}

function findStructuralNamedSubjectBeforeColon(valueText, publishedSpeakerNames = [], parserVersion = 'full-message-speaker-index.v84') {
    const value = String(valueText ?? '').trimEnd();
    if (!value.endsWith(':') && !value.endsWith('：')) return null;
    const clause = value.replace(/[:：]\s*$/u, '').trimEnd();
    if (!clause || Array.from(clause).length > 180 || /[。！？!?;；\n“”「」『』]/u.test(clause)) return null;
    const finalClause = clause.split(/[，,]/u).at(-1)?.trim() || clause;
    if (isStructuralQuotedInformationFrame(clause, finalClause)
        || isStructuralMentalOrSourceTransferFrame(clause)) return null;
    if (/[，,]\s*[\p{Script=Han}]{2,4}(?:也|又|则)?(?:站|走|转身|抬头|看向|望向|点头|递|举|拿|取|拔|伸|低头)/u.test(clause)) return null;
    const actionLead = /^(?:站起来|站起|站稳|起身|抬头|抬起|睁开|微笑|笑着|点头|转身|看向|望向|指向|用|扛起|举起|伸出|拔出|取出|拿出|递出|走来|走向|展开|低下|抬起|探出|沉默|犹豫|迟疑|颤抖|感叹|感慨)/u;
    const names = [...new Set(Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])]
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim())
        .sort((left, right) => right.length - left.length);
    // A published character at the head of the exact colon-introduced quote
    // clause is already a bounded subject cue. Do not require an action-word
    // whitelist here: the roster supplies the person boundary, the clause
    // head supplies the subject position, and the adjacent colon+quote binds
    // the clause to this utterance. Coordinated subjects and written/source
    // frames were rejected above.
    const rosteredSubject = (parserVersion === 'full-message-speaker-index.v74' || isStructuralParserVersionV75(parserVersion)) && names.find((name) => {
        if (!clause.startsWith(name) || Array.from(clause).length <= Array.from(name).length
            || isGenericCharacterNoun(name) || isStructuralInformationLabel(name)
            || hasCompetingRosteredSubjects(clause.slice(Array.from(name).length), names)) return false;
        const tail = clause.slice(Array.from(name).length);
        if (/^[·・•.]/u.test(tail)) return false;
        // If a later speech predicate appears, the leading character may only
        // be mentioned in the setup (for example, "Celestia left; the guard
        // said ..."). Let the explicit predicate rules decide that case.
        return !/(?:说|说道|说着|开口|问|问道|喊|喊道|低声道|轻声道|回应道|回答|解释道|said|says|asked|replied|answered)/iu.test(tail);
    });
    if (rosteredSubject) {
        const start = Array.from(clause.slice(0, clause.length - clause.trimStart().length)).length;
        return { text: rosteredSubject, start, end: start + Array.from(rosteredSubject).length };
    }
    let actor = '';
    let tail = '';
    const englishSpeechCue = /(?:开口|低声说|轻声说|小声说|说道|说着|说|问道|喊道|喊|回应道|回答|解释道)/u.exec(clause);
    if (englishSpeechCue) {
        const beforeCue = clause.slice(0, englishSpeechCue.index);
        const englishNames = [...beforeCue.matchAll(/(?<![\p{Script=Latin}\p{N}])(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<markdown>\*{0,2})/gu)]
            .filter((match) => {
                const afterName = beforeCue.slice(match.index + match[0].length);
                return Array.from(afterName).length <= 64
                    && /(?:从|在|向|朝|对|转向|探出|走来|走到|声音|语气|开口|说|喊|问|回应|回答|解释)/u.test(afterName);
            });
        const uniqueEnglishNames = [...new Set(englishNames.map((match) => match.groups?.name).filter(Boolean))];
        if (uniqueEnglishNames.length === 1) {
            const match = englishNames.find((candidate) => candidate.groups?.name === uniqueEnglishNames[0]);
            const nameStart = Array.from(clause.slice(0, match.index + match[0].indexOf(match.groups.name))).length;
            return { text: match.groups.name, start: nameStart, end: nameStart + Array.from(match.groups.name).length };
        }
    }
    const compoundSubject = findStructuralCompoundNamedSubject(clause);
    if (compoundSubject) {
        actor = compoundSubject.text;
        tail = compoundSubject.tail;
    }
    if (!actor) {
        const rosterName = names.find((name) => clause.startsWith(name)
            && actionLead.test(clause.slice(Array.from(name).length)));
        if (rosterName) {
            actor = rosterName;
            tail = clause.slice(Array.from(rosterName).length);
        }
    }
    if (!actor) {
        for (let length = 4; length >= 2; length -= 1) {
            const candidate = Array.from(clause).slice(0, length).join('');
            const candidateTail = Array.from(clause).slice(length).join('');
            if (!/^[\p{Script=Han}]{2,4}$/u.test(candidate) || !actionLead.test(candidateTail)) continue;
            if (isGenericCharacterNoun(candidate) || /^(?:你|我|他|她|它)(?:$|[\p{Script=Han}])|^(?:我们|你们|他们|她们|然后|随后|接着|同时|这时|此时|但是|不过|然而|所以|于是|冰原|神殿|宝藏|标题|旁白|角色|单位)/u.test(candidate)) continue;
            actor = candidate;
            tail = candidateTail;
            break;
        }
    }
    const boundedCompoundAction = actor.includes('·') && Boolean(findStructuralCompoundNamedSubject(clause));
    if (!actor || !tail || (!actionLead.test(tail) && !boundedCompoundAction)) return null;
    const start = Array.from(clause.slice(0, clause.length - clause.trimStart().length)).length;
    return { text: actor, start, end: start + Array.from(actor).length };
}

function findStructuralLocalSpeechCueSpeaker(source, prefixStart, quoteStart, publishedSpeakerNames = []) {
    const text = source.slice(prefixStart, quoteStart).join('');
    const lastClauseOffset = Math.max(text.lastIndexOf('，'), text.lastIndexOf(','), text.lastIndexOf('；'), text.lastIndexOf(';')) + 1;
    const sources = [
        { start: prefixStart, text },
        { start: prefixStart + Array.from(text.slice(0, lastClauseOffset)).length, text: text.slice(lastClauseOffset) },
    ];
    const roster = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    const speechTail = /^(?:在[^。！？!?;；\n]{0,14})?(?:探头|转身|回头|抬头|突然|立刻|马上|用力|轻轻地|严肃地|冷静地|兴奋地|愉悦地|愉悦|疯狂地|发出[^。！？!?;；\n]{0,16}(?:笑声|叫声|声音)|看见[^。！？!?;；\n]{0,24}?(?:笑|叫|喊|说)|(?:惊叫着|惊叫|尖叫着|尖叫|喊叫|大喊|高喊|怒吼|咆哮|说着|说道|说|喊|低声道|轻声道|嘶声|低语|喃喃道|嘟囔道|补充道|回应道|解释道|提醒道|插话道|反击))[^。！？!?;；\n]{0,40}$/u;
    const rejectedSubject = /^(?:(?:随后|接着|然后|这时|此时|突然)?(?:我|你|他|她|它|我们|你们|他们|她们|大家|有人|某人|某个|某名|某位|一个|一名|一位|那名|那个|对方|陌生人|身影|人影|不知名|系统|旁白|叙述|说话者))/u;
    for (const sourcePart of sources) {
        const local = sourcePart.text.trim().replace(/[:：]\s*$/u, '').trimEnd();
        if (!local || Array.from(local).length > 80 || /[。！？!?;；\n]/u.test(local)) continue;
        const leadingWhitespace = sourcePart.text.length - sourcePart.text.trimStart().length;
        const base = sourcePart.start + Array.from(sourcePart.text.slice(0, leadingWhitespace)).length;
        const rosterName = roster.find((name) => local.startsWith(name) && speechTail.test(local.slice(name.length)));
        if (rosterName) return { text: rosterName, start: base, end: base + Array.from(rosterName).length };
        if (rejectedSubject.test(local)) continue;
        for (let length = 2; length <= 4; length += 1) {
            const name = Array.from(local).slice(0, length).join('');
            const tail = Array.from(local).slice(length).join('');
            const localSubjectCue = /^(?:(?:在|正|刚|突然|立刻|马上)[^。！？!?;；\n]{0,28})(?:说着|说道|说|喊道|大喊|高喊|尖叫|怒吼|咆哮|低声道|轻声道|嘶声|低语|喃喃道|嘟囔道|补充道|回应道|解释道|提醒道)$/u.test(tail);
            const roleSubjectCue = /(?:手|男|女|客|官|者|师|长|卫|兵|士|弓手|守卫)$/u.test(name) && speechTail.test(tail);
            if (!/^\p{Script=Han}+$/u.test(name) || rejectedSubject.test(name)
                || (!localSubjectCue && !roleSubjectCue)) continue;
            return { text: name, start: base, end: base + length };
        }
    }
    return null;
}

function findStructuralDashedSpeechCueBeforeQuote(source, quote, knownNames = []) {
    // In this dialogue format, a dash-led standalone sentence names the
    // speaker for the immediately following quote (`—Timmy grabs Bubbles.
    // “I have him.”`). The name itself is the structural marker; an explicit
    // reporting verb is not required. Keep the evidence local and bounded.
    let cursor = quote.start - 1;
    let whitespace = 0;
    while (cursor >= 0 && /\s/u.test(source[cursor]) && whitespace <= 3) {
        cursor -= 1;
        whitespace += 1;
    }
    if (whitespace > 3 || cursor < 0 || !/[。.!?！？]/u.test(source[cursor])) return null;
    const sentenceEnd = cursor;
    let sentenceStart = sentenceEnd - 1;
    while (sentenceStart >= 0 && sentenceEnd - sentenceStart <= 100
        && !/[。.!?！？\n]/u.test(source[sentenceStart])) sentenceStart -= 1;
    sentenceStart += 1;
    const rawCueText = source.slice(sentenceStart, sentenceEnd).join('');
    if (!rawCueText || /\n\s*\n/u.test(rawCueText)) return null;
    const leadingTrim = Array.from(rawCueText).length - Array.from(rawCueText.trimStart()).length;
    const cueText = rawCueText.trim();
    const signedPrefix = /^(?:—|–|-)\s*/u.exec(cueText);
    if (!signedPrefix) return null;

    const nameText = cueText.slice(signedPrefix[0].length);
    const roster = [...new Set((Array.isArray(knownNames) ? knownNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    const rosterSpeaker = roster.find((name) => nameText.startsWith(name));
    const fallbackName = /^(?<speaker>[\p{Script=Han}]{2,4}|[A-Z][\p{Script=Latin}\p{M}\p{N}'’.-]*(?:\s+[A-Z][\p{Script=Latin}\p{M}\p{N}'’.-]*){0,2})/u.exec(nameText);
    const speaker = rosterSpeaker || fallbackName?.groups?.speaker;
    if (!speaker) return null;

    const speakerOffset = cueText.indexOf(speaker, signedPrefix[0].length);
    if (speakerOffset < 0) return null;
    const start = sentenceStart + leadingTrim + Array.from(cueText.slice(0, speakerOffset)).length;
    return {
        text: speaker,
        start,
        end: start + Array.from(speaker).length,
        attributionStart: sentenceStart + leadingTrim,
    };
}

function findStructuralPageLocalSpeakerCue(chars, core) {
    const text = chars.slice(core.start, core.end).join('');
    const pattern = /(?<name>[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,3})(?<lead>[^。！？!?;；\n“”「」『』]{0,36}?)(?<cue>说道|说着|说|补充道|回应道|解释道|提醒道|插话道|嘟囔道|低声道|轻声道|喊道|大喊|高喊|尖叫|怒吼|咆哮|低语|叫道)[:：]\s*(?<quote>[“"「『])/gu;
    const matches = [...text.matchAll(pattern)].filter((match) => match.index === text.search(/\S/u)
        && match.groups?.name && match.groups?.quote
        && !/^(?:(?:随后|接着|然后|这时|此时|突然)?(?:我|你|他|她|它|我们|你们|他们|她们|大家|有人|某人|某个|某名|某位|一个|一名|一位|那名|那个|对方|陌生人|身影|人影|不知名|系统|旁白|叙述|说话者))/u.test(match.groups.name));
    if (matches.length !== 1) return null;
    const match = matches[0];
    const nameStart = core.start + Array.from(text.slice(0, match.index)).length;
    const quoteStart = core.start + Array.from(text.slice(0, match.index + match[0].indexOf(match.groups.quote))).length;
    const quoteEnd = quoteStart + Array.from(match.groups.quote).length;
    const utterance = trimStructuralSourceSpan(chars, quoteStart + 1, core.end);
    if (!utterance) return null;
    const evidenceSpan = trimStructuralSourceSpan(chars, nameStart, quoteStart);
    if (!evidenceSpan || chars.slice(evidenceSpan.start, evidenceSpan.end).join('').trim() !== match[0].slice(0, match[0].indexOf(match.groups.quote)).trim()) return null;
    return {
        text: match.groups.name,
        lead: match.groups.lead,
        directCue: /^(?:\s|[，,])*(?:(?:轻声|低声|小声|高声|大声|轻轻地|低声地|平静地|严肃地|急切地|怒气冲冲地|冷冷|冷声|淡淡|缓缓)\s*)*$/u.test(match.groups.lead || ''),
        speakerSpan: { start: nameStart, end: nameStart + Array.from(match.groups.name).length },
        evidenceSpan,
        quoteStart,
        quoteEnd,
        utteranceSpan: utterance,
    };
}

function findStructuralQuotedCharacterReactionSpeaker({ source, quote, prefixStart, suffixEnd, knownNames = [] }) {
    if (!quote?.closed) return null;
    const prefix = source.slice(prefixStart, quote.start).join('');
    const suffix = source.slice(quote.end, Math.min(source.length, Math.max(suffixEnd, quote.end + 20)))
        .join('').trimStart();
    if (!/^(?:的)?(?:表情|神情|念头|想法)/u.test(suffix)) return null;
    const reactionTail = /^(?:听完[^。！？!?;；\n]{0,28}[，,]?\s*)?(?:露出|显出|浮现出)(?:了)?(?:一种|一副|些)?$/u;
    const roster = [...new Set((Array.isArray(knownNames) ? knownNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    for (const name of roster) {
        const index = prefix.lastIndexOf(name);
        if (index < 0 || !reactionTail.test(prefix.slice(index + name.length))) continue;
        const start = prefixStart + Array.from(prefix.slice(0, index)).length;
        return { text: name, speakerSpan: { start, end: start + Array.from(name).length } };
    }
    const match = /(?<name>[\p{Script=Han}]{2,4})(?:听完[^。！？!?;；\n]{0,28}[，,]?\s*)?(?:露出|显出|浮现出)(?:了)?(?:一种|一副|些)?$/u.exec(prefix);
    if (!match?.groups?.name) return null;
    const start = prefixStart + Array.from(prefix.slice(0, match.index)).length;
    return { text: match.groups.name, speakerSpan: { start, end: start + Array.from(match.groups.name).length } };
}

function findStructuralNamedGroupSpeakerPrefix(valueText) {
    const value = String(valueText ?? '').trim();
    const name = '(?:[A-Z][A-Za-z0-9\'’.-]{1,20}|[\\p{Script=Han}]{2,4})';
    const match = new RegExp(`^(?<first>${name})(?<connector>和|与|及|、|&|and)(?<second>${name})(?<tail>[^:：]{0,28})[:：]$`, 'u').exec(value);
    if (!match?.groups || !/(?:汇报|报告|回报|通报|说道|答道|回应|说明|补充|表示|喊道|发言|say|said|report|reported|reply|replied)/iu.test(match.groups.tail)) return null;
    const firstStart = Array.from(value.slice(0, match.index + match[0].indexOf(match.groups.first))).length;
    const secondTextOffset = match[0].indexOf(match.groups.second, match[0].indexOf(match.groups.connector) + match.groups.connector.length);
    const secondStart = Array.from(value.slice(0, match.index + secondTextOffset)).length;
    const first = { text: match.groups.first, start: firstStart, end: firstStart + Array.from(match.groups.first).length };
    const second = { text: match.groups.second, start: secondStart, end: secondStart + Array.from(match.groups.second).length };
    return {
        text: first.text,
        start: first.start,
        end: first.end,
        ruleId: 'named-group-report-attribution',
        groupMembers: [first, second],
    };
}

function findStructuralPossessiveEntityActionSpeaker(valueText) {
    const value = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '').trimEnd();
    const match = /^(?<speaker>[\p{Script=Han}]{2,10})的(?:动作|目光|眼窝|竖瞳|声音|语气|神情|表情|身体|身躯)(?<tail>[^。！？!?;；:：]{0,80})$/u.exec(value);
    if (!match?.groups || /^(?:它|他|她|你|我|我们|你们|他们|她们|敌人|对方|旁白|系统)$/u.test(match.groups.speaker)
        || !/(?:停顿|凝视|燃烧|看向|望向|转头|移动|颤抖|变得|低吼|咆哮|沉默|抬起|站起)/u.test(match.groups.tail)
        || isStructuralQuotedInformationFrame(value, value.split(/[，,]/u).at(-1)?.trim() || value)) return null;
    return {
        text: match.groups.speaker,
        start: 0,
        end: Array.from(match.groups.speaker).length,
        ruleId: 'unrostered-action-attribution',
    };
}

function parseDirectStructuralSpeakerLabel(value, publishedSpeakerNames, { allowUnknownHan = false, allowUnknownLatin = false } = {}) {
    const raw = Array.isArray(value) ? value : Array.from(String(value ?? ''));
    let start = 0;
    while (start < raw.length && /\s/u.test(raw[start])) start += 1;
    while (['-', '—', '–', '*'].includes(raw[start])) {
        start += 1;
        while (start < raw.length && /\s/u.test(raw[start])) start += 1;
    }
    const label = raw.slice(start).join('').trim();
    if (!label) return null;
    const labelStart = start;
    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))];
    const isDirectModifier = (tail) => {
        if (!tail) return true;
        if (/^(?:终于|终于还是)$/u.test(tail)) return true;
        if (/^[\s]*[（(][^()（）\n]{1,32}[）)]$/u.test(tail)) return true;
        if (/^[\p{Script=Han}]{1,8}(?:地|着)$/u.test(tail)) return true;
        if (/^\s+[a-z]+ly$/iu.test(tail)) return true;
        return false;
    };
    const exactCandidates = knownNames
        .filter((name) => label.startsWith(name))
        .sort((left, right) => right.length - left.length);
    let parsed = null;
    for (const candidate of exactCandidates) {
        const tail = label.slice(candidate.length);
        if (isDirectModifier(tail)) {
            parsed = { text: candidate, ruleId: 'published-name', offset: 0 };
            break;
        }
    }
    // Voice/manner words are speech cues, not inferred names. Exact published
    // names above retain priority, while `一个陌生身影……冷声说道：“…”` must
    // stay anonymous instead of turning `冷声` into an unrostered speaker.
    if (!parsed && isStructuralAnonymousSpeakerDescription(label)) return null;
    if (!parsed && allowUnknownLatin && !/^(?:a|an|the)\s/iu.test(label)) {
        const latin = label.match(/^([A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(.*)$/u);
        if (latin && isDirectModifier(latin[2])) {
            parsed = { text: latin[1], ruleId: 'unknown-name', offset: 0 };
        }
    }
    if (!parsed && allowUnknownHan) {
        const han = label.match(/^([\p{Script=Han}]{2,4})(.*)$/u);
        if (han && isDirectModifier(han[2])) parsed = { text: han[1], ruleId: 'unknown-name', offset: 0 };
    }
    if (!parsed) return null;
    const speakerOffset = parsed.offset;
    const speakerLength = Array.from(parsed.text).length;
    return {
        ...parsed,
        start: labelStart + speakerOffset,
        end: labelStart + speakerOffset + speakerLength,
    };
}

function sameStructuralSpeakerName(left, right) {
    return String(left ?? '').normalize('NFC').toLocaleLowerCase()
        === String(right ?? '').normalize('NFC').toLocaleLowerCase();
}

function isUnrosteredHanSingleCharacterCue(parsedSpeaker, cue) {
    if (parsedSpeaker?.ruleId !== 'unknown-name' || !/^[\p{Script=Han}]{2,4}$/u.test(String(parsedSpeaker.text ?? ''))) return false;
    if (/^[\p{Script=Han}]$/u.test(String(cue ?? '')) && !['说', '问', '喊'].includes(cue)) return true;
    return /^(?:我|你|他|她|它|我们|你们|他们|她们|大家|众人|所有人|对方|随后|接着|然后|于是|同时|这时|此时)/u.test(parsedSpeaker.text);
}

function findStructuralLaughingActorBeforeQuote(valueText) {
    const source = String(valueText ?? '').trimEnd();
    const withoutQuoteDelimiter = source.replace(/[：:]\s*$/u, '');
    const headerColon = Math.max(withoutQuoteDelimiter.lastIndexOf('：'), withoutQuoteDelimiter.lastIndexOf(':'));
    const clauseOffset = headerColon >= 0 ? headerColon + 1 : 0;
    const clause = source.slice(clauseOffset).trimStart();
    const leading = source.slice(clauseOffset).length - source.slice(clauseOffset).trimStart().length;
    const normalizedClause = clause.replace(/[：:]\s*$/u, '');
    const match = /^(?<actor>[\p{Script=Han}]{2,8})(?:看见|发现|注意到)[^。！？!?;；\n]{0,40}[，,]\s*(?:发出|爆发出|响起)[^。！？!?;；\n]{0,40}笑声$/u.exec(normalizedClause);
    if (!match?.groups?.actor) return null;
    const start = clauseOffset + leading;
    return {
        text: match.groups.actor,
        start,
        end: start + Array.from(match.groups.actor).length,
        ruleId: 'unrostered-action-attribution',
    };
}

function findStructuralLaughingQuoteContinuation({ source, quote, knownNames = [], quotes = [] }) {
    const priorQuote = [...quotes].reverse().find((candidate) => candidate.end <= quote.start);
    if (!priorQuote?.closed) return null;
    const laugh = source.slice(priorQuote.start + 1, priorQuote.end - 1).join('').trim();
    if (!/^哈{2,6}$/u.test(laugh)) return null;
    const priorPrefixStart = findStructuralAttributionStart(source, priorQuote.start);
    const priorPrefix = source.slice(priorPrefixStart, priorQuote.start).join('');
    const leading = priorPrefix.match(/^\s*/u)?.[0] || '';
    const actorText = priorPrefix.slice(leading.length).trimEnd();
    const name = [...new Set(knownNames)].sort((left, right) => right.length - left.length)
        .find((candidate) => candidate === actorText);
    if (!name) return null;

    const gap = source.slice(priorQuote.end, quote.start).join('');
    if (!/^(?:大笑|笑着|笑道|放声大笑)[，,][^。！？!?;；\n]{1,72}[:：]\s*$/u.test(gap)) return null;
    if (findLatestStructuralSceneBoundaryEnd(source, priorQuote.end, quote.start) != null) return null;
    if ([...new Set(knownNames)].some((other) => other !== name && gap.includes(other))) return null;
    const utterance = source.slice(quote.start + 1, quote.closed ? quote.end - 1 : quote.end).join('').trim();
    if (!/(?:我|老子|本王|本大爷)/u.test(utterance)) return null;

    const nameOffset = Array.from(priorPrefix.slice(0, leading.length)).length;
    const speakerStart = priorPrefixStart + nameOffset;
    return { text: name, speakerSpan: { start: speakerStart, end: speakerStart + Array.from(name).length } };
}

function findStructuralPostQuoteAttributionCue(source, quote, publishedSpeakerNames = []) {
    let start = quote.end;
    while (start < source.length && /\s/u.test(source[start]) && start - quote.end <= 4) start += 1;
    if (start - quote.end > 4 || start >= source.length) return null;
    let end = start;
    while (end < source.length && end - start <= 48
        && !/[。！？!?;；\r\n“「『"]/u.test(source[end])) end += 1;
    const text = source.slice(start, end).join('').trim().replace(/[,，]\s*$/u, '').trimEnd();
    // A closed quote may be followed by its reporting clause (`“...” Ren低声说，
    // “...”`). Accept a short, punctuation-free manner/action modifier between
    // the named subject and a direct speech predicate; the source must still
    // begin with a parseable person-shaped label and end at the speech cue.
    const match = /^(?<name>[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<modifier>[^。！？!?;；\r\n,，:：]{0,16}?)(?<cue>介绍道|说道|答道|问道|补充道|回应道|解释道|提醒道|说|答|问)$/u.exec(text);
    if (!match?.groups?.name) return null;
    const speaker = parseStructuralSpeakerLabel(match.groups.name, publishedSpeakerNames, {
        allowUnknownHan: true, allowUnknownLatin: true,
    });
    if (!speaker || isStructuralAnonymousSpeakerDescription(speaker.text)
        || /^(?:我|你|他|她|它|我们|你们|他们|她们|它们)(?:$|[\p{Script=Han}])/u.test(speaker.text)) return null;
    return {
        text: speaker.text,
        start: start - quote.end,
        end: start - quote.end + Array.from(match.groups.name).length,
        ruleId: 'post-quote-attribution',
    };
}

function findStructuralPostQuoteActorCue(source, quote, publishedSpeakerNames = []) {
    let start = quote.end;
    while (start < source.length && /[\s,，、—–-]/u.test(source[start]) && start - quote.end <= 8) start += 1;
    if (start - quote.end > 8 || start >= source.length) return null;
    let end = start;
    while (end < source.length && end - start <= 96 && !/[。！？!?;；\r\n“「『"]/u.test(source[end])) end += 1;
    const tail = source.slice(start, end).join('').trim();
    if (!tail || Array.from(tail).length > 96) return null;
    const cue = findTrailingSpeechCue(tail);
    if (!cue || ![...STRUCTURAL_SPEECH_CUES, ...STRUCTURAL_ENGLISH_SPEECH_CUES].includes(cue.text)) return null;

    const cueStart = cue.start;
    const actorClause = Array.from(tail).slice(0, cueStart);
    if (!actorClause.some((char) => !/\s/u.test(char))) return null;

    // Post-quote actions can place the reporting verb after a brief gesture
    // (`Pippa turns, then reminds him`). The actor must be the one explicit
    // rostered name that leads this same bounded clause. If another rostered
    // name is mentioned before the cue, the source does not resolve who spoke.
    const actorNames = [...new Set(publishedSpeakerNames)]
        .filter((name) => typeof name === 'string' && name.trim() && tail.startsWith(name))
        .sort((left, right) => right.length - left.length);
    if (!actorNames.length || (actorNames.length > 1 && actorNames[0].length === actorNames[1].length)) return null;
    const actorText = actorNames[0];
    if (isStructuralAnonymousSpeakerDescription(actorText)) return null;
    const actorEnd = Array.from(actorText).length;
    const actorClauseText = actorClause.join('');
    const otherKnownNames = [...new Set(publishedSpeakerNames)].filter((name) => name !== actorText && actorClauseText.includes(name));
    if (otherKnownNames.length || actorEnd >= cueStart) return null;
    return {
        text: actorText,
        start: start - quote.end,
        end: start - quote.end + actorEnd,
        ruleId: 'post-quote-attribution',
    };
}

function findStructuralSpeakerInSuffix(suffix, publishedSpeakerNames, utterance = '') {
    const original = suffix.join('');
    const leading = original.match(/^[\s,，、—–-]*/u)?.[0] || '';
    const trimOffset = Array.from(leading).length;
    const text = original.slice(leading.length).trimEnd();
    if (!text) return null;
    // The manually confirmed player interjection appears as a short question
    // immediately followed by the player's own surprised reaction. Keep this
    // fallback restricted to question-shaped utterances and explicit first-
    // person reaction wording; ordinary NPC dialogue followed by player
    // narration remains unresolved.
    if (/[？?]$/u.test(String(utterance ?? '').trim())
        && /^你(?:一愣|一怔|愣了一下|怔了一下)$/u.test(text)) {
        return {
            text: '你', ruleId: 'post-quote-attribution', start: trimOffset, end: trimOffset + 1,
            evidenceStart: trimOffset, evidenceEnd: trimOffset + Array.from(text).length,
        };
    }
    // A short negotiated/social closing line followed immediately by the
    // player's handshake is the player's turn, not the NPC's narration.
    if (/^(?:合作愉快|成交|幸会|很高兴(?:认识你|合作)?|谢谢|感谢|请多关照)[。！!]?$/u.test(String(utterance ?? '').trim())
        && /^你(?:与.{1,18}握手|和.{1,18}握手|握住.{1,18}的手|伸手与.{1,18}相握)/u.test(text)) {
        return {
            text: '你', ruleId: 'player-social-closure', start: trimOffset, end: trimOffset + 1,
            evidenceStart: trimOffset, evidenceEnd: trimOffset + Array.from(text).length,
        };
    }
    const playerSpeaker = findExplicitPlayerSpeechSuffix(text, publishedSpeakerNames);
    if (playerSpeaker) return {
        ...playerSpeaker,
        start: trimOffset + playerSpeaker.start,
        end: trimOffset + playerSpeaker.end,
        evidenceStart: trimOffset,
        evidenceEnd: trimOffset + Array.from(text).length,
    };
    const knownPostQuoteSpeaker = findRosteredSpeakerPostQuoteCue(text, publishedSpeakerNames);
    if (knownPostQuoteSpeaker) return {
        ...knownPostQuoteSpeaker,
        start: trimOffset + knownPostQuoteSpeaker.start,
        end: trimOffset + knownPostQuoteSpeaker.end,
        evidenceStart: trimOffset,
        evidenceEnd: trimOffset + Array.from(text).length,
    };
    const cueMatch = text.match(/^(?:(?:said|asked|replied|answered|shouted|whispered|called)\s+)?(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,3})(?:\s+(?<cue>said|asked|replied|answered|shouted|whispered|called))?$/iu);
    const latinChineseCue = text.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,3})(?<cue>低声说|轻声说|小声说|低声道|轻声道|喃喃道|嘟囔道|补充道|提醒道|回应道|插话道|解释道|嘀咕道|喊道|答道|问道|说道|介绍|回复|回答|骂道|补充|嘀咕|提醒|回应|插话|解释|尖叫|怒吼|咆哮|嘶声|低语|嘟囔|说|问|答|喊|道)$/u);
    const chineseCue = text.match(/^(?<name>[\p{Script=Han}]{2,4}?)(?<cue>低声说|轻声说|小声说|低声道|轻声道|喃喃道|嘟囔道|补充道|提醒道|回应道|插话道|解释道|嘀咕道|喊道|答道|问道|说道|介绍|回复|回答|骂道|补充|嘀咕|提醒|回应|插话|解释|尖叫|怒吼|咆哮|嘶声|低语|嘟囔|说|问|答|喊|道)$/u);
    const matched = cueMatch || latinChineseCue || chineseCue;
    const matchedName = matched?.groups?.name || '';
    const parsed = parseStructuralSpeakerLabel(matchedName, publishedSpeakerNames, { allowUnknownHan: true });
    if (!parsed || isUnrosteredHanSingleCharacterCue(parsed, matched?.groups?.cue)
        || (parsed.ruleId === 'unknown-name' && isStructuralAnonymousSpeakerDescription(parsed.text))) return null;
    const nameOffset = matchedName ? Array.from(text.slice(0, text.indexOf(matchedName))).length : 0;
    return { ...parsed, start: trimOffset + nameOffset + parsed.start, end: trimOffset + nameOffset + parsed.end,
        evidenceStart: trimOffset, evidenceEnd: trimOffset + Array.from(text).length, ruleId: 'post-quote-attribution' };
}

function findTrailingSpeechCue(value) {
    const cues = [...STRUCTURAL_SPEECH_CUES, ...STRUCTURAL_ENGLISH_SPEECH_CUES]
        .sort((left, right) => right.length - left.length);
    // Chinese prose commonly uses a comma before the opening quote instead
    // of a colon: `Ren低声说，“…”`. Treat that comma as a cue delimiter.
    const text = String(value ?? '').trimEnd().replace(/[，,]$/u, '');
    for (const cue of cues) {
        if (!text.endsWith(cue)) continue;
        const start = text.length - cue.length;
        if (/^[A-Za-z]/u.test(cue) && start > 0 && /[A-Za-z]/u.test(text[start - 1])) continue;
        return { start: Array.from(text.slice(0, start)).length, text: cue };
    }
    const indirectCue = text.match(STRUCTURAL_INDIRECT_SPEECH_CUE);
    if (indirectCue) {
        const start = text.length - indirectCue[0].length;
        return { start: Array.from(text.slice(0, start)).length, text: indirectCue[0] };
    }
    return null;
}

function isStructuralAnonymousSpeakerDescription(value) {
    const text = String(value ?? '').trim();
    return /^(?:一个|一名|一位|某个|某名|某位|那个|那名|陌生人|不知名的人|说话者|人影|身影|披甲法师|年长的法师|冷声|低声|轻声|小声|高声|大声|厉声|柔声)/u.test(text)
        || /^(?:(?:随后|这时|此时|忽然|突然|远处|不远处|附近|身后|角落里)?有人)$/u.test(text)
        // Long descriptive role phrases (e.g. 银面具贵客、倒霉小官) identify
        // a first-appearance subject, not a guessed proper name. The list is
        // deliberately restricted to role-noun endings so ordinary names
        // and descriptive prose are not swallowed as anonymous speakers.
        || /^[\p{Script=Han}]{1,14}(?:贵客|来客|访客|客人|小官|官员|军官|教官|守卫|卫兵|士兵|骑士|刺客|法师|术士|战士|弓手|弓箭手)$/u.test(text);
}

function parseStructuralSpeakerLabel(value, publishedSpeakerNames, {
    allowUnknownHan = false,
    allowUnknownLatin = true,
    allowKnownPrefixExtension = false,
} = {}) {
    const raw = Array.isArray(value) ? value : Array.from(String(value ?? ''));
    let start = 0;
    while (start < raw.length && /\s/u.test(raw[start])) start += 1;
    while (['-', '—', '–', '*'].includes(raw[start])) {
        start += 1;
        while (start < raw.length && /\s/u.test(raw[start])) start += 1;
    }
    const candidate = raw.slice(start).join('').replace(/[：:]?\s*$/u, '').trimEnd();
    const candidates = [];
    for (const name of publishedSpeakerNames) {
        const nameChars = Array.from(name);
        if (!nameChars.length || raw.slice(start, start + nameChars.length).join('') !== name) continue;
        const remainder = raw.slice(start + nameChars.length).join('').trim();
        if (!remainder || /^[,，、]/u.test(remainder)
            || (allowKnownPrefixExtension && /^[\p{Script=Han}]/u.test(remainder))) {
            candidates.push({ text: name, start, end: start + nameChars.length, ruleId: 'published-name' });
        }
    }
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) return null;

    const label = candidate.trim();
    if (isStructuralAnonymousSpeakerDescription(label)) return null;
    const english = allowUnknownLatin
        ? label.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?=$|[\p{Script=Han}])/u)
        : null;
    if (english?.groups?.name && english.groups.name.length <= 48) {
        if (/^(?:a|an|the)\s/iu.test(english.groups.name)) return null;
        const nameStart = raw.findIndex((char, index) => index >= start && !/\s/u.test(char));
        const name = Array.from(english.groups.name);
        return { text: english.groups.name, start: nameStart, end: nameStart + name.length, ruleId: 'unknown-name' };
    }
    if (allowUnknownHan) {
        const han = label.match(/^(?<name>[\p{Script=Han}]{2,4})$/u);
        if (han?.groups?.name) {
            const nameStart = raw.findIndex((char, index) => index >= start && !/\s/u.test(char));
            return { text: han.groups.name, start: nameStart, end: nameStart + Array.from(han.groups.name).length, ruleId: 'unknown-name' };
        }
    }
    return null;
}

function buildStructuralPageTitleEvidence(matches, { sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan }) {
    const speakers = [];
    const seen = new Set();
    for (const match of matches) {
        const key = match.text.normalize('NFC').toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        speakers.push({
            mentionRef: `display-only-${sourceMessageIndex}-${match.start}-${match.end}`,
            text: match.displayText || match.text,
            ...(match.displayText && match.displayText !== match.text ? { sourceText: match.text } : {}),
            start: match.start,
            end: match.end,
        });
    }
    const ruleIds = [...new Set(matches.map((match) => match.ruleId))];
    const mayCarrySpeakerOutsideView = ruleIds.length === 1 && ruleIds[0] === 'open-quote-continuation';
    if (!speakers.length || speakers.some((speaker) => speaker.end > viewSpan.end
        || (speaker.start < viewSpan.start && !mayCarrySpeakerOutsideView))) return null;
    const evidence = {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: viewSpan.start, end: viewSpan.end },
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        classificationEvidenceSpans: matches.map((match) => match.classificationEvidenceSpan),
        kind: speakers.length === 1 ? 'speaker' : 'group',
        text: speakers.length === 1 ? speakers[0].text : '多人对话',
        speakers,
    };
    evidence.ruleId = ruleIds.length === 1 ? ruleIds[0] : 'structured-speaker';
    return evidence;
}

function findStructuralQuoteContinuation({ chars, sourceMessageIndex, sourceMessageHash, viewSpan, coreSpan, previousPage }) {
    const previousSpan = previousPage?.sourceSpan;
    const evidence = previousPage?.pageTitleEvidence;
    const previousView = previousPage?.pageTitleEvidenceViewSpan;
    const speaker = evidence?.speakers?.[0];
    if (!isValidStructuralPageSpan(previousSpan, chars.length)
        || !isValidStructuralPageSpan(previousView, chars.length)
        || previousPage.sourceMessageIndex !== sourceMessageIndex
        || previousPage.sourceMessageHash !== sourceMessageHash
        || previousSpan.end !== coreSpan.start
        || viewSpan.start !== previousSpan.start || viewSpan.end !== coreSpan.end
        || evidence?.sourceMessageIndex !== sourceMessageIndex
        || evidence?.sourceMessageHash !== sourceMessageHash
        || evidence?.viewSpan?.start !== previousView.start || evidence?.viewSpan?.end !== previousView.end
        || evidence?.coreSpan?.start !== previousSpan.start || evidence?.coreSpan?.end !== previousSpan.end
        || evidence?.kind !== 'speaker' || evidence?.text !== speaker?.text
        || evidence?.speakers?.length !== 1
        || !Array.isArray(evidence?.classificationEvidenceSpans) || !evidence.classificationEvidenceSpans.length
        || evidence.classificationEvidenceSpans.some((span) => !isValidStructuralPageSpan(span, chars.length)
            || span.start < previousSpan.start || span.end > previousSpan.end)
        || !isValidStructuralPageSpan(speaker, chars.length)
        || (speaker.start < previousView.start && !['open-quote-continuation', 'annotation-title', 'full-message-structural'].includes(evidence.ruleId))
        || speaker.end > previousView.end
        || chars.slice(speaker.start, speaker.end).join('') !== speaker.text
        || (evidence.ruleId && !['known-prefix', 'line-speaker', 'quoted-attribution', 'post-quote-attribution', 'rostered-subject-quoted-clause', 'structured-speaker', 'full-message-structural', 'open-quote-continuation', 'annotation-title'].includes(evidence.ruleId))) return null;

    const priorScan = scanStructuralQuoteState(chars.slice(speaker.end, previousSpan.end).join(''));
    if (!priorScan.reliable || priorScan.stack.length !== 1) return null;
    const currentText = chars.slice(coreSpan.start, coreSpan.end);
    const currentScan = scanStructuralQuoteState(currentText.join(''), priorScan.stack);
    const quoteContinuesOrCloses = currentScan.carriedQuoteClosedAtEnd
        || (!currentScan.carriedQuoteClosedAtEnd && currentScan.stack.length === 1);
    if (!currentScan.reliable || !quoteContinuesOrCloses || !currentScan.hasContent) return null;
    const first = currentText.findIndex((char) => !/\s/u.test(char));
    if (first < 0 || currentScan.fragmentEnd <= first) return null;
    return {
        text: speaker.text,
        start: speaker.start,
        end: speaker.end,
        classificationEvidenceSpan: { start: coreSpan.start + first, end: coreSpan.start + currentScan.fragmentEnd },
        ruleId: 'open-quote-continuation',
    };
}

function scanStructuralQuoteState(value, initialStack = []) {
    const pairs = new Map([['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’'], ['"', '"']]);
    const closers = new Set(pairs.values());
    const chars = Array.from(String(value ?? ''));
    const stack = [...initialStack];
    const initialDepth = stack.length;
    let carriedQuoteClosedAtEnd = false;
    let hasContent = false;
    let fragmentEnd = 0;
    let carriedClosed = false;
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '"') {
            if (stack.at(-1) === '"') {
                stack.pop();
                if (initialDepth && stack.length < initialDepth) {
                    carriedClosed = true;
                    fragmentEnd = index + 1;
                }
            } else {
                if (carriedClosed) return { reliable: false, stack: [] };
                stack.push('"');
            }
            continue;
        }
        if (pairs.has(char)) {
            if (carriedClosed) return { reliable: false, stack: [] };
            stack.push(pairs.get(char));
            continue;
        }
        if (closers.has(char)) {
            if (stack.at(-1) !== char) return { reliable: false, stack: [] };
            stack.pop();
            if (initialDepth && stack.length < initialDepth) {
                carriedClosed = true;
                fragmentEnd = index + 1;
            }
            continue;
        }
        if (initialDepth && !carriedClosed && !/\s/u.test(char) && !/[，。！？!?；;、,.]/u.test(char)) {
            hasContent = true;
            fragmentEnd = index + 1;
        } else if (carriedClosed && !/\s/u.test(char) && !/[，。！？!?；;、,.]/u.test(char)) {
            return { reliable: false, stack: [] };
        }
    }
    carriedQuoteClosedAtEnd = initialDepth > 0 && carriedClosed && stack.length === 0;
    if (initialDepth && !carriedClosed && stack.length !== initialDepth) return { reliable: false, stack: [] };
    return { reliable: true, stack, carriedQuoteClosedAtEnd, hasContent, fragmentEnd };
}

function scanDialogueQuoteState(value, initialStack = []) {
    const pairs = new Map([['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’'], ['｢', '｣']]);
    const closers = new Set(pairs.values());
    const chars = Array.from(String(value || ''));
    const stack = [...initialStack];
    let escapedSlashCount = 0;
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '\\') {
            escapedSlashCount += 1;
            continue;
        }
        const escaped = escapedSlashCount % 2 === 1;
        escapedSlashCount = 0;
        if (char === '"') {
            if (escaped) continue;
            if (stack.at(-1) === '"') stack.pop();
            else stack.push('"');
            continue;
        }
        if (escaped) continue;
        if (pairs.has(char)) {
            stack.push(pairs.get(char));
            continue;
        }
        if (closers.has(char)) {
            if (stack.at(-1) !== char) return { reliable: false, stack: [] };
            stack.pop();
        }
    }
    if (escapedSlashCount % 2 === 1) return { reliable: false, stack: [] };
    return { reliable: true, stack };
}

function findAnnotationCarriedQuoteEnd(value, initialStack = []) {
    if (!initialStack.length) return null;
    const pairs = new Map([['“', '”'], ['「', '」'], ['『', '』'], ['‘', '’'], ['｢', '｣']]);
    const closers = new Set(pairs.values());
    const chars = Array.from(String(value || ''));
    const stack = [...initialStack];
    let escapedSlashCount = 0;
    for (let index = 0; index < chars.length; index += 1) {
        const char = chars[index];
        if (char === '\\') {
            escapedSlashCount += 1;
            continue;
        }
        const escaped = escapedSlashCount % 2 === 1;
        escapedSlashCount = 0;
        if (char === '"') {
            if (escaped) continue;
            if (stack.at(-1) === '"') stack.pop();
            else stack.push('"');
            if (!stack.length) return index + 1;
            continue;
        }
        if (escaped) continue;
        if (pairs.has(char)) stack.push(pairs.get(char));
        else if (closers.has(char)) {
            if (stack.at(-1) !== char) return null;
            stack.pop();
            if (!stack.length) return index + 1;
        }
    }
    return null;
}

function classifyVisualNovelSegment(text, { fallbackSpeaker, role, knownSpeakerMap }) {
    if (role === 'player') {
        return {
            type: 'player',
            speaker: '你',
            text,
        };
    }

    const stageCue = text.match(/^[—-]{1,2}\s*([A-Za-z][\w-]{0,39}|[\p{Script=Han}ぁ-んァ-ヶー]{1,12})(?:\s+|[：:，,。！？!?]|$)/u);
    if (stageCue && isTrustedVisualDialogueSpeaker(stageCue[1], knownSpeakerMap, fallbackSpeaker)) {
        return {
            type: 'stage',
            speaker: sanitizeText(stageCue[1], 80),
            text,
        };
    }

    const narrativeDialogue = matchKnownNarrativeDialogue(text, knownSpeakerMap);
    if (narrativeDialogue) {
        return narrativeDialogue;
    }
    // A new NPC is not present in the published manifest yet. Strong
    // in-text evidence may still identify a display-only speaker: a
    // name-shaped prefix, a bounded narrative action, and quoted speech.
    // This does not create a canonical ST character or allocate an avatar;
    // it only prevents an unmistakable new speaker from being flattened into
    // the narrator channel.
    const inferredNarrativeDialogue = matchInferredNarrativeDialogue(text, knownSpeakerMap);
    if (inferredNarrativeDialogue) {
        return inferredNarrativeDialogue;
    }
    if (isNarrativeDialogueParagraph(text)) {
        return {
            type: 'narration',
            speaker: '旁白',
            text,
        };
    }

    const namedDialogue = text.match(/^([A-Za-z][\w-]{0,39}(?:[ \t]+[A-Za-z][\w-]{0,39}){0,3}|[\p{Script=Han}ぁ-んァ-ヶー]{1,12})[：:]\s*(.+)$/u);
    // A colon is not enough evidence that the prefix is a speaker. Generated
    // prose frequently uses the same shape for headings such as
    // "所以战术很简单：优先攻击…". Only a published/known speaker (or the
    // current original message speaker) may claim an unquoted direct line;
    // otherwise keep the complete paragraph as narration and preserve the
    // original text. Unknown names remain narration even when they use a
    // colon, so they cannot create a new character identity.
    const namedDialogueSpeaker = namedDialogue?.[1]?.trim() || '';
    const namedDialogueIsTrusted = namedDialogueSpeaker
        && !isNonDialogueLabel(namedDialogueSpeaker)
        && isTrustedVisualDialogueSpeaker(namedDialogueSpeaker, knownSpeakerMap, fallbackSpeaker);
    if (namedDialogue && namedDialogue[2]?.trim() && namedDialogueIsTrusted) {
        const knownSpeaker = knownSpeakerMap.get(normalizeKnownSpeaker(namedDialogueSpeaker));
        return {
            type: 'dialogue',
            speaker: sanitizeText(knownSpeaker?.displayName || knownSpeaker || fallbackSpeaker || namedDialogueSpeaker, 80),
            ...(knownSpeaker?.identityRef ? { identityRef: knownSpeaker.identityRef } : {}),
            text: namedDialogue[2].trim(),
        };
    }

    if (/^[“"「『].+[”"」』]$/su.test(text) || /^[“"「『]/u.test(text)) {
        // A quoted paragraph that contains another quote is usually a
        // narrative action with an embedded sound/dialogue quote (for
        // example, `"他拿出鹅毛笔"唰唰唰"写下...`). Do not let it inherit
        // the previous character's portrait.
        if (/^[“"「『][\s\S]*[“"「『]/u.test(text)) {
            return {
                type: 'narration',
                speaker: '旁白',
                text,
            };
        }
        return {
            type: 'unattributed-dialogue',
            speaker: '未识别',
            identityRef: { type: 'unknown' },
            text,
        };
    }

    return {
        type: 'narration',
        speaker: '旁白',
        text,
    };
}

function isTrustedVisualDialogueSpeaker(value, knownSpeakerMap, fallbackSpeaker) {
    const normalized = normalizeKnownSpeaker(value);
    if (!normalized || isNarratorSpeaker(normalized) || /^(?:你|玩家|player|user|系统|system)$/iu.test(normalized)) {
        return false;
    }
    if (knownSpeakerMap instanceof Map && knownSpeakerMap.has(normalized)) {
        return true;
    }
    return normalized === normalizeKnownSpeaker(fallbackSpeaker);
}

function createKnownSpeakerMap(values) {
    const map = new Map();
    for (const value of values) {
        const candidates = typeof value === 'object' && value !== null
            ? [value.characterKey, value.name, value.speaker, ...(Array.isArray(value.aliases) ? value.aliases : [])]
            : [value];
        const displayName = candidates.find((candidate) => {
            const normalized = normalizeKnownSpeaker(candidate);
            return normalized && !isNarratorSpeaker(normalized) && !/^(?:你|玩家|player|user|系统|system)$/iu.test(normalized);
        });
        if (!displayName) continue;
        for (const candidate of candidates) {
            const normalized = normalizeKnownSpeaker(candidate);
            if (!normalized || isNarratorSpeaker(normalized) || /^(?:你|玩家|player|user|系统|system)$/iu.test(normalized)) {
                continue;
            }
            const identityRef = typeof value === 'object' && value !== null && value.characterKey
                ? { type: 'published', id: String(value.characterKey) }
                : null;
            const entry = { displayName: sanitizeText(displayName, 80), identityRef };
            map.set(normalized, entry);
        }
    }
    return map;
}

function normalizeKnownSpeaker(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[：:，,。！？!?]+$/u, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
}

function matchKnownNarrativeDialogue(text, knownSpeakerMap) {
    if (!(knownSpeakerMap instanceof Map) || !knownSpeakerMap.size) return null;
    const ordered = [...knownSpeakerMap.keys()].sort((left, right) => right.length - left.length);
    for (const normalizedName of ordered) {
        const entry = knownSpeakerMap.get(normalizedName);
        const displayName = entry?.displayName || entry;
        const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const boundary = /^[A-Za-z0-9_-]+$/u.test(normalizedName) ? '(?![A-Za-z0-9_-])' : '';
        const match = text.match(new RegExp(`^[“「『"]?${escaped}${boundary}\\s*(.{1,48}?)\\s*[：:]\\s*([“"「『][\\s\\S]*(?:[”"」』]|$))$`, 'iu'));
        if (!match || !hasNarrativeDialogueVerb(match[1].trim())) continue;
        return {
            type: 'dialogue',
            speaker: displayName,
            ...(entry?.identityRef ? { identityRef: entry.identityRef } : {}),
            text: match[2].trim(),
        };
    }
    return null;
}

function matchInferredNarrativeDialogue(text, knownSpeakerMap) {
    const parsed = parseNarrativeDialogueParagraph(text);
    if (!parsed || !parsed.speaker || /[，,。！？!?；;]/u.test(parsed.speaker)
        || isNarratorSpeaker(parsed.speaker) || isNonDialogueLabel(parsed.speaker)
        || !isLikelyInferredSpeakerName(parsed.speaker)
        || /^(?:你|玩家|我|他|她|他们|我们|队伍|大家|所有人|player|user|系统|system)$/iu.test(normalizeKnownSpeaker(parsed.speaker))) {
        return null;
    }
    const normalized = normalizeKnownSpeaker(parsed.speaker);
    if (knownSpeakerMap instanceof Map && (knownSpeakerMap.has(normalized) || hasKnownSpeakerPrefixConflict(normalized, knownSpeakerMap))) {
        return null;
    }
    if (isGenericCharacterNoun(parsed.speaker) && !getEnemyCharacterLabelMatch(parsed.speaker)) {
        return null;
    }
    return {
        type: 'dialogue',
        speaker: sanitizeText(parsed.speaker, 80),
        // Preserve the action lead in the visible text. The segment carries
        // the inferred speaker for the title/visual request, while no prose
        // is discarded from the original runtime reply.
        text: String(text || '').trim(),
        quote: parsed.quote,
        speakerConfidence: 'inferred',
        confidenceBand: 'probable',
        speakerOrigin: 'runtime-text',
    };
}

/**
 * Add display-only paragraph boundaries before known speakers embedded in a
 * long narrative paragraph. This intentionally requires both a published
 * speaker name and a bounded narrative action followed by quoted text, so a
 * name mentioned as an ordinary noun is not promoted to a speaker.
 */
function splitKnownInlineNarrativeDialogues(text, knownSpeakerMap) {
    if (!(knownSpeakerMap instanceof Map) || !knownSpeakerMap.size) return text;
    const source = String(text || '');
    if (!source) return source;

    const matches = [];
    const ordered = [...knownSpeakerMap.keys()].sort((left, right) => right.length - left.length);
    for (const normalizedName of ordered) {
        const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const asciiName = /^[A-Za-z0-9_-]+$/u.test(normalizedName);
        // CJK names are immediately followed by CJK action text in natural
        // prose (`尼布松了口气`). The action whitelist below is the boundary
        // check; rejecting every following Han character would hide valid
        // known speakers.
        const boundaryAfter = asciiName ? '(?![A-Za-z0-9_-])' : '';
        // Keep the quote tail conservative. Curly/CJK quotes are paired; an
        // ASCII quote closes at the next ASCII quote, which is sufficient for
        // presentation segmentation and avoids consuming the rest of a reply.
        const quoteTail = '(?:[“「『][^\\r\\n]*?(?:[”」』]|(?=\\n{2,}|$))|"[^"\\r\\n]*(?:"|(?=\\n{2,}|$)))';
        const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})${boundaryAfter}\\s*(.{1,64}?)\\s*[：:]\\s*${quoteTail}`, 'giu');
        for (const match of source.matchAll(pattern)) {
            const prefix = match[1] || '';
            const nameStart = (match.index ?? 0) + prefix.length;
            const action = String(match[3] || '').trim();
            if (!hasNarrativeDialogueVerb(action)) continue;
            // A name at the beginning may be preceded by a display-only quote
            // left by ASCII quote normalization; the classifier accepts it.
            // For later clauses, insert a boundary immediately before name.
            if (nameStart > 0) matches.push(nameStart);
        }
    }
    if (!matches.length) return source;
    const unique = [...new Set(matches)].sort((left, right) => left - right);
    let result = source;
    for (let index = unique.length - 1; index >= 0; index -= 1) {
        const offset = unique[index];
        if (offset <= 0 || result.slice(offset - 2, offset) === '\n\n') continue;
        result = `${result.slice(0, offset)}\n\n${result.slice(offset)}`;
    }
    return result;
}

function isNarrativeDialogueParagraph(text) {
    return Boolean(parseNarrativeDialogueParagraph(text));
}

function parseNarrativeDialogueParagraph(text) {
    // ASCII quote normalization can leave a paragraph without its closing
    // quote when the next sentence starts on a new display page. Keep it a
    // narration candidate instead of inheriting the previous character's
    // avatar.
    const match = text.match(/^(.{2,80}?)\s*[：:]\s*([“"「『][\s\S]*(?:[”"」』]|$))$/u);
    if (!match) return null;
    const prefix = match[1].trim()
        .replace(/^(?:然后|接着|随后|这时|此时)\s*/u, '')
        .replace(/^[“"「『]+|[”"」』]+$/gu, '')
        .trim();
    const actionStart = prefix.search(NARRATIVE_DIALOGUE_ACTION_PATTERN);
    if (actionStart <= 0 || !hasNarrativeDialogueVerb(prefix.slice(actionStart).trim())) return null;
    const speaker = prefix.slice(0, actionStart).replace(/^[“"「『]+|[”"」』]+$/gu, '').trim();
    if (!speaker) return null;
    return {
        normalizedName: normalizeKnownSpeaker(speaker),
        speaker,
        quote: match[2].trim(),
    };
}

function findRosteredSpeakerBeforeNarrativeColon(value, publishedSpeakerNames) {
    const label = String(value ?? '').trim();
    const names = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    for (const name of names) {
        if (!label.startsWith(name)) continue;
        const actionClause = label.slice(name.length).trim();
        const actionLength = Array.from(actionClause).length;
        if (actionLength < 2 || actionLength > 80
            || /[\r\n:：。！？!?;；“”「」『』"']/u.test(actionClause)
            || isStructuralMentalOrSourceTransferFrame(actionClause)
            || /^(?:状态|属性|装备|技能|道具|背包|金币|生命|魔力|等级|经验|选择|选项|行动顺序|HP|MP|AC)$/iu.test(actionClause)) continue;
        if (hasCompetingRosteredSubjects(actionClause, names)) continue;
        return { text: name, start: 0, end: Array.from(name).length, ruleId: 'published-name' };
    }
    return null;
}

function isStructuralMentalOrSourceTransferFrame(value) {
    const text = String(value ?? '').trim();
    if (/(?:心想|暗想|想着|思忖|思考|默念|心中|心里想|内心想)/u.test(text)) return true;
    if (/(?:传来|传出|传递|转述|传达)(?:了)?(?:消息|信息|来信|口信|报告|命令|通知)|(?:消息|信息|来信|口信|报告|命令|通知)[^。！？!?;；:：]{0,16}(?:来自|送到|传到|传来|传出)/u.test(text)) return true;
    const source = '(?:地图|图表|图纸|海图|信件|信纸|卷轴|羊皮纸|账本|记录册|日志|报告|公告|文书|清单|碑文|石碑|铭文|纸条|便笺|书页|告示|面板|屏幕)';
    const showOrTransfer = '(?:展示|展现|递给|递过|递到|交给|交到|交出|递出|摊给|摊开给|指给|举给|给你看|拿给)';
    return new RegExp(`(?:${source})[^。！？!?;；:：]{0,16}${showOrTransfer}|${showOrTransfer}[^。！？!?;；:：]{0,16}${source}`, 'u').test(text);
}

function hasCompetingRosteredSubjects(value, publishedSpeakerNames = []) {
    const text = String(value ?? '');
    for (const name of publishedSpeakerNames || []) {
        if (typeof name !== 'string' || !name.trim()) continue;
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`(?:和|与|及|以及|跟|同|and|&)\\s*${escaped}(?=$|[\\s，,、\\p{Script=Han}])`, 'iu').test(text)) return true;
    }
    return false;
}

function findStructuralPlayerActionBeforeQuote(valueText) {
    const value = String(valueText ?? '').trim();
    if (!/[:：]$/u.test(value) || Array.from(value).length > 100) return null;
    const body = value.replace(/[:：]$/u, '').trimEnd();
    const lastComma = Math.max(body.lastIndexOf('，'), body.lastIndexOf(','));
    const clause = body.slice(lastComma + 1).trimStart();
    if (!/^你(?:在|正|正在|站|坐|走|朝|向|看|望|转|抬|点头|面对|背对|来到|停在|停下)/u.test(clause)
        || /(?:你|我|他|她|它|我们|他们|她们|和.{1,8}(?:站|坐|走|看|望|转))/u.test(clause.slice(1))) return null;
    const prefixChars = Array.from(body.slice(0, body.lastIndexOf(clause)));
    const leadingTrim = Array.from(clause.slice(0, clause.length - clause.trimStart().length)).length;
    return { start: prefixChars.length + leadingTrim, end: prefixChars.length + leadingTrim + 1 };
}

function findStructuralPlayerFirstPersonActionBeforeQuote(valueText) {
    const value = String(valueText ?? '').trim();
    if (!/[:：]$/u.test(value) || Array.from(value).length > 100
        || /[“”「」『』"'‘’]/u.test(value)) return null;
    const body = value.replace(/[:：]$/u, '').trimEnd();
    if (!/^我(?:轻轻地|缓缓地|低声地|压低|放低|压住|放轻|轻声|低声|小声)?[^。！？!?;；\n]{0,42}(?:声音|嗓音|语气)(?:[^。！？!?;；\n]{0,18})?$/u.test(body)
        || !/(?:压低|放低|压住|放轻|低声|轻声|小声)/u.test(body)) return null;
    return { start: 0, end: 1 };
}

function findStructuralPlayerFirstPersonSpeechPrefix(valueText) {
    const value = String(valueText ?? '').trim();
    if (!/[:：]$/u.test(value) || Array.from(value).length > 100
        || /[“”「」『』"'‘’]/u.test(value)) return null;
    const body = value.replace(/[:：]$/u, '').trimEnd();
    if (!/^我[^。！？!?;；\n]{0,72}(?:对你|向你)(?:低声|轻声|小声)?(?:说道|说|道|问|喊|告诉你)$/u.test(body)) return null;
    const playerTarget = Array.from(body).findIndex((char, index, chars) => char === '你'
        && chars[index - 1] === '对' || char === '你' && chars[index - 1] === '向');
    return playerTarget >= 0 ? { start: playerTarget, end: playerTarget + 1 } : null;
}

function findPlayerDirectSpeechPrefix(valueText, publishedSpeakerNames = []) {
    const value = String(valueText ?? '').trim();
    const candidateBody = value.replace(/[:：]\s*$/u, '').replace(/(?:——|—|–)$/u, '').trimEnd();
    const hasCompetingSubject = candidateBody.startsWith('你')
        && hasCompetingSubjectPredicateClause(candidateBody.slice(1).split(/[，,]/u), publishedSpeakerNames);
    const explicitCue = !hasCompetingSubject && /^你[^。！？!?；;\n]{0,80}[:：]$/u.test(value);
    // A paired quote immediately after a player-led em-dash turn is also a
    // conventional direct-speech form (`你看向地图——“三天后出发。”`).
    const dashTurn = !hasCompetingSubject && /^你[^。！？!?；;\n]{1,80}(?:——|—|–)$/u.test(value);
    const colonless = value.replace(/[:：]\s*$/u, '').trimEnd();
    const cue = findTrailingSpeechCue(colonless);
    const beforeCue = cue ? Array.from(colonless).slice(0, cue.start).join('').trimEnd() : '';
    const playerActionCue = Boolean(!hasCompetingSubject && cue && beforeCue.startsWith('你')
        && !hasCompetingSubjectPredicateClause(beforeCue.slice(1).split(/[，,]/u), publishedSpeakerNames));
    if (!explicitCue && !dashTurn && !playerActionCue) return null;
    return { start: 0, end: 1 };
}

function findExplicitPlayerSpeechSuffix(valueText, publishedSpeakerNames = []) {
    const value = String(valueText ?? '').trim();
    const transition = value.match(/^(?:(?:然后|随后|接着|于是|同时|这时|此时)[\s,，、]*)+/u)?.[0] || '';
    const body = value.slice(transition.length).trimStart();
    if (!body.startsWith('你')) return null;
    const firstClause = body.split(/[，,。！？!?;；\n]/u, 1)[0].trimEnd();
    const trailingCue = findTrailingSpeechCue(firstClause);
    let beforeCue = trailingCue ? Array.from(firstClause).slice(0, trailingCue.start).join('').trimEnd() : '';
    let cueIsDirect = Boolean(trailingCue);
    if (!cueIsDirect) {
        // A completed quote can be followed by a short player vocalization and
        // then more action (`“Charge!” you shout once, gripping the sword...`).
        // Accept only a first-clause speech predicate with a short aspect/count
        // tail; later movement or another subject does not qualify.
        const cues = [...STRUCTURAL_SPEECH_CUES, ...STRUCTURAL_ENGLISH_SPEECH_CUES]
            .sort((left, right) => right.length - left.length);
        for (const speechCue of cues) {
            const index = firstClause.indexOf(speechCue, 1);
            if (index < 1) continue;
            if (/^[A-Za-z]/u.test(speechCue) && index > 0 && /[A-Za-z]/u.test(firstClause[index - 1])) continue;
            const tail = firstClause.slice(index + speechCue.length).trim();
            if (!/^(?:(?:了|着|地|道|一声|了一声|一嗓子|一下|一口气)\s*)*$/u.test(tail)) continue;
            beforeCue = firstClause.slice(0, index).trimEnd();
            cueIsDirect = true;
            break;
        }
    }
    if (!cueIsDirect || !beforeCue.startsWith('你') || Array.from(beforeCue).length > 80
        || hasCompetingSubjectPredicateClause(beforeCue.slice(1).split(/[，,]/u), publishedSpeakerNames)) return null;
    const start = Array.from(transition).length + Array.from(value.slice(transition.length, value.length - body.length)).length;
    return { text: '你', start, end: start + 1, ruleId: 'player-direct-speech' };
}

function findRosteredSpeakerPostQuoteCue(valueText, publishedSpeakerNames = []) {
    const value = String(valueText ?? '').trim();
    const cue = findTrailingSpeechCue(value);
    if (!cue) return null;
    const beforeCue = Array.from(value).slice(0, cue.start).join('').trimEnd();
    const honorific = /^(?:男爵|女爵|伯爵|公爵夫人|公爵|侯爵|子爵|夫人|女士|先生|大人|大法师|法师|将军|队长|船长|骑士|守卫|队员)?$/u;
    const names = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    for (const name of names) {
        if (!beforeCue.startsWith(name)) continue;
        const title = beforeCue.slice(name.length).trim();
        if (!honorific.test(title)) continue;
        return { text: name, start: 0, end: Array.from(name).length, ruleId: 'post-quote-attribution' };
    }
    return null;
}

function findStructuralGroupSpeakerPrefix(valueText) {
    const value = String(valueText ?? '').trim();
    const role = '(?<role>守卫|侍卫|护卫|士兵|骑士|村民|群众|队员|同伴|打手|敌人|海盗|士卒|战士|佣兵|卫兵|警卫|法师|术士|刺客|弓箭手|冒险者|人群|众人|大家|全员)';
    const count = '(?:两|二|三|四|五|六|七|八|九|十|几|数|若干|一群|众多|全体|所有)(?:个|名|位|群)?';
    const action = '(?:[^:：]{0,18})(?:单膝跪地|跪地|跪下|拔剑|亮出武器|齐声|异口同声|一同|一起|同时|喊|喊道|齐喊|叫道|说道|开口|喝道|大喊|高喊|怒喝)';
    const counted = new RegExp(`^${count}(?:[\\p{Script=Han}]{0,12}?)${role}${action}\\s*[:：]$`, 'u');
    const collective = new RegExp(`^(?<role>众人|大家|人群|全员)${action}\\s*[:：]$`, 'u');
    const pluralRole = new RegExp(`^(?<role>${role.slice('(?<role>'.length, -1)})(?:们|群体)(?:[^:：]{0,12})(?:齐声|异口同声|齐喊|一起|一同|同时|喊道|喊|叫道|说道|开口|喝道|大喊|高喊|怒喝)\\s*[:：]$`, 'u');
    const match = value.match(counted) || value.match(collective) || value.match(pluralRole);
    if (!match?.groups?.role) return null;
    const roleText = match.groups.role;
    const start = Array.from(value.slice(0, value.indexOf(roleText))).length;
    return {
        text: roleText,
        displayText: ['全员', '人群', '众人', '大家', '群众'].includes(roleText)
            ? roleText : `${roleText}（群体）`,
        ruleId: 'group-role-prefix',
        start,
        end: start + Array.from(roleText).length,
    };
}

function hasCoordinatedSubjectsBeforeAction(valueText, publishedSpeakerNames = []) {
    const value = String(valueText ?? '').trim().replace(/[:：]\s*$/u, '');
    const action = new RegExp(STRUCTURAL_ACTION_CUE, 'u').exec(value);
    if (!action) return false;
    const actionStart = Array.from(value.slice(0, action.index)).length;
    const beforeAction = Array.from(value).slice(0, actionStart).join('');
    const connectorPattern = /(?:以及|和|与|及|跟|同|\band\b|&)/giu;
    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    const isSubject = (candidate) => {
        const subject = String(candidate ?? '').trim()
            .replace(/^(?:(?:但是|不过|然而|随后|接着|然后|这时|此时|突然)\s*)+/u, '')
            .replace(/(?:也|都|各自|同时|一起|一同|共同|齐|纷纷|并)$/u, '')
            .trim();
        if (!subject) return false;
        if (/^(?:你|我|他|她|它|我们|你们|他们|她们|众人|大家|守卫|侍卫|护卫|士兵|骑士|村民|队员|同伴|敌人|海盗|法师|术士|士卒)$/u.test(subject)) return true;
        if (knownNames.some((name) => name === subject)) return true;
        if (/^(?:(?:一个|一名|一位|两名|两位|三名|三位|几名|几位)\s*)[\p{Script=Han}]{2,8}$/u.test(subject)) return true;
        return /^(?:[\p{Script=Han}]{2,6}|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})$/u.test(subject);
    };
    for (const match of beforeAction.matchAll(connectorPattern)) {
        const left = beforeAction.slice(0, match.index).trim();
        const right = beforeAction.slice(match.index + match[0].length).trim();
        const leftHasRosteredSubjectAndPredicate = knownNames.some((name) => left.startsWith(name)
            && /(?:脸色|神情|沉默|看向|望向|看着|望着|转身|点头|皱眉|微笑|冷笑|走|拿|递|伸|抱|举|握|喊|说|问|答|着|地|得|在|从|向|朝|对着|眼神|声音|语气)/u.test(left.slice(name.length)));
        if ((isSubject(left) || leftHasRosteredSubjectAndPredicate) && isSubject(right)) return true;
    }
    return false;
}

function findRosteredSpeakerBeforeSpeechCue(valueText, publishedSpeakerNames = [], parserVersion = 'full-message-speaker-index.v84') {
    const prefix = String(valueText ?? '').trim();
    if (!prefix || /[\r\n:：。！？!?;；“”「」『』"']/u.test(prefix)
        || hasCoordinatedSubjectsBeforeAction(prefix, publishedSpeakerNames)) return null;
    const names = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    for (const name of names) {
        if (!prefix.startsWith(name)) continue;
        if (/^[A-Za-z0-9_-]+$/u.test(name) && /[A-Za-z0-9_-]/u.test(prefix[name.length] || '')) continue;
        const predicate = prefix.slice(name.length).trim().replace(/[，,]+$/u, '').trim();
        const predicateLength = Array.from(predicate).length;
        if (predicateLength < 1 || predicateLength > 80) continue;
        const clauses = predicate.split(/[，,]/u).map((clause) => clause.trim()).filter(Boolean);
        if (!clauses.length || hasCompetingSubjectPredicateClause(clauses, names)) continue;
        const finalClause = clauses.at(-1) || predicate;
        if (isStructuralQuotedInformationFrame(prefix, finalClause)) continue;
        const v74ActionCue = (parserVersion === 'full-message-speaker-index.v74' || isStructuralParserVersionV75(parserVersion))
            && /(?:探头|探出头|探出|跳脚|指着|尖叫|惊叫|喊叫|骂了?一(?:句|声))/u.test(predicate);
        const hasActionOrManner = v74ActionCue || new RegExp(STRUCTURAL_ACTION_CUE, 'u').test(predicate)
            || /(?:着|地|得|在|从|向|朝|对着?|面向|脸色|面色|神情|表情|眼神|语气|声音)(?:[^，,]{0,12})$/u.test(predicate);
        if (!hasActionOrManner) continue;
        return {
            text: name,
            start: 0,
            end: Array.from(name).length,
            ruleId: 'quoted-attribution',
        };
    }
    return null;
}

function findV74RosteredCueSpeaker(valueText, publishedSpeakerNames = [], speechCue = '') {
    const source = String(valueText ?? '').trim().replace(/[，,]+$/u, '').trimEnd();
    if (!source || /[\r\n:：。！？!?;；“”「」『』]/u.test(source)) return null;
    const names = [...new Set(Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])]
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim())
        .sort((left, right) => right.length - left.length);
    const genericSubject = /^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然)\s*)*(?:(?:旁边的|附近的|身后的|前面的|不远处的)\s*)?(?:(?:一个|一名|一位|那名|那位)\s*)?(?:守卫|侍卫|护卫|士兵|骑士|法师|术士|村民|队员|同伴|敌人|海盗|群众|人群|众人|大家)(?=$|[，,\s]|随后|接着|然后|突然|立刻|低声|轻声|小声|高声|大声|严肃地|认真地|平静地|说|问|喊)/u;
    const actionCue = /(?:在.{0,12}(?:探头|探出头|跳脚)|探头|探出头|探出|跳脚|指着|尖叫|惊叫|喊叫|骂了?一(?:句|声)|停下|抬手|转身|走到|看向|望向|点头|说|问|喊|回答|回应|解释|低声|轻声)/u;
    let selected = null;
    let offset = 0;
    const clauses = source.split(/(?<=[，,])/u);
    for (const [index, rawClause] of clauses.entries()) {
        const clause = rawClause.replace(/[，,]$/u, '').trim();
        const leading = rawClause.length - rawClause.trimStart().length;
        if (genericSubject.test(clause)) return null;
        const name = names.find((candidate) => clause.startsWith(candidate)
            && (!/^[A-Za-z0-9_-]+$/u.test(candidate) || !/[A-Za-z0-9_-]/u.test(clause[candidate.length] || '')));
        const cueForClause = index === clauses.length - 1 ? speechCue : '';
        if (name && actionCue.test(`${clause.slice(name.length)}${cueForClause}`)) {
            selected = {
                text: name,
                start: Array.from(source.slice(0, offset + leading)).length,
                end: Array.from(source.slice(0, offset + leading)).length + Array.from(name).length,
                ruleId: 'quoted-attribution',
            };
        }
        offset += Array.from(rawClause).length;
    }
    return selected;
}

function findV75RosteredCueSpeaker(valueText, publishedSpeakerNames = [], speechCue = '') {
    const source = String(valueText ?? '');
    const leadingConnective = /^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|忽然|紧接着|与此同时)\s*)+/u.exec(source)?.[0] || '';
    const stripped = source.slice(leadingConnective.length);
    const candidate = findV74RosteredCueSpeaker(stripped, publishedSpeakerNames, speechCue);
    if (!candidate) return null;
    const offset = Array.from(leadingConnective).length;
    return { ...candidate, start: candidate.start + offset, end: candidate.end + offset };
}

function isStructuralParserVersionAtLeast(parserVersion, minimum) {
    const match = /^full-message-speaker-index\.v(\d+)$/u.exec(String(parserVersion ?? ''));
    return Boolean(match && Number(match[1]) >= minimum);
}

function isStructuralParserVersionV75(parserVersion) {
    return isStructuralParserVersionAtLeast(parserVersion, 75);
}

function isStructuralParserVersionV76(parserVersion) {
    return isStructuralParserVersionAtLeast(parserVersion, 76);
}

function isStructuralParserVersionV77(parserVersion) {
    return isStructuralParserVersionAtLeast(parserVersion, 77);
}

function isStructuralParserVersionV78(parserVersion) {
    return isStructuralParserVersionAtLeast(parserVersion, 78);
}

function hasCompetingSubjectPredicateClause(clauses, publishedSpeakerNames) {
    const subjectNames = [...new Set(publishedSpeakerNames)].sort((left, right) => right.length - left.length);
    const genericSubject = /^(?:她|他|它|你|我|我们|你们|他们|她们|自己|对方|一个(?:人|守卫|法师|士兵|骑士)|一名(?:守卫|法师|士兵|骑士)|那(?:个|名)?(?:人|守卫|法师|士兵|骑士)|(?:守卫|侍卫|护卫|士兵|骑士|法师|术士|村民|队员|同伴|敌人|海盗))/u;
    return clauses.slice(1).some((rawClause) => {
        const clause = rawClause.replace(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u, '').trim();
        if (!clause) return false;
        return subjectNames.some((name) => clause.startsWith(name)
            && (!/^[A-Za-z0-9_-]+$/u.test(name) || !/[A-Za-z0-9_-]/u.test(clause[name.length] || '')))
            || genericSubject.test(clause);
    });
}

function findUnrosteredSubjectBeforeAction(valueText) {
    const value = String(valueText ?? '').replace(/[:：]\s*$/u, '').trim();
    if (/[，,]/u.test(value)) {
        const candidates = [];
        let offset = 0;
        for (const piece of value.split(/(?<=[，,])/u)) {
            const clause = piece.replace(/[，,]$/u, '').trim();
            const leadingSpace = piece.length - piece.trimStart().length;
            const found = clause ? findUnrosteredSubjectBeforeAction(clause) : null;
            if (found) candidates.push({ ...found, start: offset + leadingSpace + found.start, end: offset + leadingSpace + found.end });
            offset += Array.from(piece).length;
        }
        const unique = new Map(candidates.map((candidate) => [normalizeStructuralSpeakerKey(candidate.text), candidate]));
        return unique.size === 1 ? [...unique.values()][0] : null;
    }
    const rawClause = value.split(/[，,]/u).at(-1)?.trim() || value;
    const discoursePrefix = rawClause.match(/^(?:(?:但是|不过|然而|但|却|而|随后|接着|然后|同时|这时|此时|突然|忽然)\s*)+/u)?.[0] || '';
    const clause = rawClause.slice(discoursePrefix.length).trim() || rawClause;
    const label = '(?<speaker>(?:首相|公爵夫人|大法师|法师|将军|队长|船长|队员|守卫|侍卫|护卫|士兵|骑士|村民|群众|同伴|打手|敌人)|(?:[\\p{Script=Han}]{2,4}(?:大法师|公爵夫人|将军|法师|队长|船长|夫人|女士|先生))|(?:[\\p{Script=Han}]{2,4}?)|(?:[A-Z][A-Za-z0-9\'’.-]*(?:\\s+[A-Z][A-Za-z0-9\'’.-]*){0,2}))';
    const action = STRUCTURAL_ACTION_CUE;
    const match = clause.match(new RegExp(`^${label}(?<tail>[^。！？!?;；:：]{0,80})$`, 'u'));
    if (!match?.groups?.speaker || !new RegExp(action, 'u').test(match.groups.tail || '')) return null;
    let speaker = match.groups.speaker;
    let tail = match.groups.tail || '';
    let actionMatch = new RegExp(action, 'u').exec(tail);
    let actionPosition = Array.from(speaker).length + Array.from(tail.slice(0, actionMatch.index)).length;
    // The generic Han-name pattern is intentionally short and can initially
    // stop inside a 3–4 character name (e.g. 维克多拿出). Extend it only when
    // the next Han character moves the same action cue earlier or equally
    // close; this avoids both truncation and swallowing a verb as part of a name.
    while (/^[\p{Script=Han}]/u.test(tail) && Array.from(speaker).length < 4) {
        if (/^(?:随后|接着|然后|这时|此时|立刻|马上)/u.test(tail)) break;
        if (/^(?:在|对|朝|向|从|以|用|通过|把|将)/u.test(tail)) break;
        if (/^(?:眼神|目光|眼睛|眼中|脸色|神情|表情)/u.test(tail)) break;
        if (/^(?:感到|觉得|显得|看起来|变得|似乎|感觉|没有|没|未|不曾|不再|不|无|并未|并没有)/u.test(tail)) break;
        const next = Array.from(tail)[0];
        if (/[的地得]/u.test(next)) break;
        const candidateTail = Array.from(tail).slice(1).join('');
        if (/^(?:把|将)/u.test(candidateTail)) {
            speaker += next;
            tail = candidateTail;
            break;
        }
        const candidateCue = new RegExp(action, 'u').exec(candidateTail);
        if (!candidateCue) break;
        const candidatePosition = Array.from(speaker).length + 1
            + Array.from(candidateTail.slice(0, candidateCue.index)).length;
        if (candidatePosition > actionPosition) break;
        speaker += next;
        tail = candidateTail;
        actionMatch = candidateCue;
        actionPosition = candidatePosition;
    }
    if (/^(?:只是|也是|就是|差点|险些|几乎|突然|立即|立刻|随后|接着|然后|这时|此时|似乎|仿佛|不禁|仍然|居然|竟然|甚至|可能|应该|必须|刚才|马上|终于|已经|依然|依旧|原本|本来|显然|当然|然而|不过|但是|而且|同时|其实|于是|因为|所以|结果|效果|备注|风险|优势|机械|检定|判定|豁免|状态|属性|装备|背包|物品|道具|技能|能力|法术|经验|金币|生命|魔力|目标|地点|位置|事件|线索|证据|数据|规则|说明|提示|统计|她|他|它|你|我|我们|你们|他们|她们|一个|一名|一位|某个|某位|某人|有人|陌生人|陌生身影|不明身影|未知来客|某个生物|冷声|低声|轻声|小声|高声|大声|厉声|柔声)/u.test(speaker)) return null;
    const speakerStart = Array.from(value.slice(0, value.lastIndexOf(clause))).length
        + Array.from(clause.slice(0, clause.indexOf(speaker))).length;
    return {
        text: speaker,
        ruleId: 'unrostered-action-attribution',
        start: speakerStart,
        end: speakerStart + Array.from(speaker).length,
    };
}

function findStructuralAdjacentNamedActionSpeaker(source, quote, publishedSpeakerNames = []) {
    if (!Array.isArray(source) || quote?.closed !== true || !isValidStructuralPageSpan(quote, source.length)) return null;
    let previousEnd = quote.start;
    while (previousEnd > 0 && /\s/u.test(source[previousEnd - 1])) previousEnd -= 1;
    if (quote.start - previousEnd > 4) return null;
    const paragraphBreak = findLastStructuralParagraphBreak(source, previousEnd);
    if (paragraphBreak < 0) return null;
    const contextStart = paragraphBreak + 2;
    const rawContext = source.slice(contextStart, previousEnd).join('');
    const leadingWhitespace = rawContext.match(/^\s*/u)?.[0] || '';
    const context = rawContext.slice(leadingWhitespace.length).trimEnd();
    const contextOffset = Array.from(leadingWhitespace).length;
    const contextChars = Array.from(context);
    if (!context || contextChars.length > 100 || !/[。！？!?]$/u.test(context)
        || isLikelyStandalonePresentationHeading(context)
        || findLatestStructuralSceneBoundaryEnd(source, contextStart, quote.start) != null) return null;
    const pronounSubject = findStructuralPronounSubjectFromNamedActionContext(context);
    if (/[。！？!?;；\n]/u.test(context.slice(0, -1)) && !pronounSubject) return null;
    const actor = pronounSubject || findStructuralUniqueActionSubjectInClauses(context, publishedSpeakerNames);
    if (!actor || !isValidStructuralPageSpan(actor, contextChars.length)
        || contextChars.slice(actor.start, actor.end).join('') !== actor.text) return null;
    const actorTail = contextChars.slice(actor.end).join('');
    if (!new RegExp(STRUCTURAL_ACTION_CUE, 'u').test(actorTail)) return null;
    const suffixEnd = findStructuralAttributionEnd(source, quote.end);
    if (isStructuralNarrativeInformationFrame(source, quote, contextStart + contextOffset, suffixEnd, null)) return null;
    const knownOthers = [...new Set(publishedSpeakerNames)]
        .filter((name) => typeof name === 'string' && name.trim() && name !== actor.text && context.includes(name));
    if (knownOthers.length) return null;
    return {
        text: actor.text,
        speakerSpan: {
            start: contextStart + contextOffset + actor.start,
            end: contextStart + contextOffset + actor.end,
        },
        contextSpan: { start: contextStart + contextOffset, end: previousEnd },
    };
}

function findStructuralRecentActionChainSpeakerV78(source, quote, publishedSpeakerNames = []) {
    if (!Array.isArray(source) || quote?.closed !== true || !isValidStructuralPageSpan(quote, source.length)) return null;
    let end = quote.start;
    while (end > 0 && /\s/u.test(source[end - 1])) end -= 1;
    if (quote.start - end > 4) return null;
    let start = Math.max(0, end - 180);
    const sceneBoundary = findLatestStructuralSceneBoundaryEnd(source, start, end);
    if (sceneBoundary != null) start = sceneBoundary;
    const raw = source.slice(start, end).join('');
    const leading = raw.match(/^\s*/u)?.[0] || '';
    const context = raw.slice(leading.length).trimEnd();
    const contextStart = start + Array.from(leading).length;
    if (!context || containsStructuralQuoteMarker(context)
        || isStructuralQuotedInformationFrame(context, context)
        || isLikelyStandalonePresentationHeading(context)) return null;

    const sentences = [];
    const chars = Array.from(context);
    let sentenceStart = 0;
    for (let index = 0; index <= chars.length; index += 1) {
        const isBlankLine = index < chars.length && chars[index] === '\n'
            && /^\n\s*\n/u.test(chars.slice(index).join(''));
        if (index < chars.length && !/[。！？!?;；]/u.test(chars[index]) && !isBlankLine) continue;
        const rawSentence = chars.slice(sentenceStart, index).join('').replace(/[\r\n]+/gu, ' ');
        const text = rawSentence.trim();
        if (text) {
            const leadingText = rawSentence.match(/^\s*/u)?.[0] || '';
            const localStart = sentenceStart + Array.from(leadingText).length;
            sentences.push({ text, start: contextStart + localStart });
        }
        sentenceStart = index + (isBlankLine ? 2 : 1);
    }
    if (!sentences.length || sentences.length > 2) return null;
    const last = sentences.at(-1);
    const pronoun = /^(?:(?:随后|接着|然后|这时|此时|突然|忽然|同时)\s*)?(?<subject>他|她|它|你|我|我们|你们)(?<tail>[\s\S]*)$/u.exec(last.text);
    if (!pronoun) {
        const direct = findStructuralUniqueActionSubjectInClauses(last.text, publishedSpeakerNames);
        if (direct && !/^(?:你|我|我们|你们|他|她|它|他们|她们|它们)$/u.test(direct.text)) {
            return {
                text: direct.text,
                speakerSpan: { start: last.start + direct.start, end: last.start + direct.end },
                contextSpan: { start: contextStart, end },
            };
        }
        // Do not infer ownership merely because a roster name begins a
        // narrative sentence that later mentions another speaker's quote.
        // Direct named action/speech cues are handled by the established
        // structural attribution path; this v78 fallback only carries an
        // already evidenced speaker through a pronoun-led action chain.
        return null;
    }
    if (!v77LeadingSubjectHasAction(pronoun.groups.tail)) return null;
    const prior = sentences.slice(0, -1);
    let owner = null;
    for (let index = prior.length - 1; index >= 0; index -= 1) {
        const candidate = findStructuralUniqueActionSubjectInClauses(prior[index].text, publishedSpeakerNames);
        if (candidate) {
            owner = {
                text: candidate.text,
                speakerSpan: {
                    start: prior[index].start + candidate.start,
                    end: prior[index].start + candidate.end,
                },
            };
            break;
        }
        // A pronoun or competing actor in the intervening clause makes
        // the antecedent non-unique; do not jump over it to an older name.
        if (/^(?:他|她|它|你|我|我们|你们|他们|她们|它们)/u.test(prior[index].text)
            || findUnrosteredSubjectBeforeAction(prior[index].text)) return null;
    }
    if (!owner) return null;
    const priorSource = sentences.slice(0, -1).map((sentence) => sentence.text).join(' ');
    if ([...new Set(publishedSpeakerNames)].some((name) => name !== owner.text && priorSource.includes(name))) return null;
    const competingActions = prior.filter((sentence) => {
        const candidate = findStructuralUniqueActionSubjectInClauses(sentence.text, publishedSpeakerNames);
        return candidate && !sameStructuralSpeakerName(candidate.text, owner.text);
    });
    if (competingActions.length) return null;
    if (!owner || !isValidStructuralPageSpan(owner.speakerSpan, source.length)
        || source.slice(owner.speakerSpan.start, owner.speakerSpan.end).join('') !== owner.text) return null;
    return {
        text: owner.text,
        speakerSpan: owner.speakerSpan,
        contextSpan: { start: contextStart, end },
    };
}

function findStructuralPronounSubjectFromNamedActionContext(valueText) {
    const chars = Array.from(String(valueText ?? ''));
    const clauses = [];
    let start = 0;
    for (let index = 0; index <= chars.length; index += 1) {
        if (index < chars.length && !/[。！？!?]/u.test(chars[index])) continue;
        const raw = chars.slice(start, index).join('');
        const leading = raw.match(/^[\s—–-]*/u)?.[0] || '';
        const text = raw.slice(leading.length).trim();
        if (text) clauses.push({ text, start: start + Array.from(leading).length });
        start = index + 1;
    }
    if (clauses.length < 2 || clauses.length > 4) return null;
    const last = clauses.at(-1);
    if (!/^(?:她|他|它)(?:的)?[^。！？!?;；\n]{0,64}$/u.test(last.text)
        || !/(?:声音|嗓音|语气|眼神|脸色|神情|停在|扫过|抬眼|抬头|转身|咬紧牙关|看向|望向)/u.test(last.text)) return null;
    const candidates = [];
    for (const clause of clauses.slice(0, -1)) {
        const subject = findUnrosteredSubjectBeforeAction(clause.text);
        if (!subject || isGenericCharacterNoun(subject.text)
            || /^(?:状态|记录|检定|系统|旁白|面板|日志|地图|账本)$/u.test(subject.text)) continue;
        candidates.push({
            text: subject.text,
            start: clause.start + subject.start,
            end: clause.start + subject.end,
        });
    }
    const unique = new Map(candidates.map((item) => [normalizeStructuralSpeakerKey(item.text), item]));
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function findStructuralUniqueActionSubjectInClauses(valueText, publishedSpeakerNames = [], {
    allowQuoteLocalBodyState = false,
} = {}) {
    const source = String(valueText ?? '').trim().replace(/[。！？!?]$/u, '');
    if (!source.trim() || /[。！？!?;；\n]/u.test(source)
        || isStructuralQuotedInformationFrame(source, source.split(/[，,]/u).at(-1)?.trim() || source)) return null;
    const matches = [];
    let offset = 0;
    for (const piece of source.split(/(?<=[，,])/u)) {
        const leading = piece.match(/^\s*/u)?.[0] || '';
        const clause = piece.slice(leading.length).replace(/[，,]\s*$/u, '').trimEnd();
        const rosterNamesInClause = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
            .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()
                && clause.includes(name)))];
        const coordinatedRosterSubjects = rosterNamesInClause.length > 1
            && rosterNamesInClause.some((left, index) => rosterNamesInClause.slice(index + 1).some((right) => {
                const leftAt = clause.indexOf(left);
                const rightAt = clause.indexOf(right);
                const between = leftAt < rightAt ? clause.slice(leftAt + left.length, rightAt)
                    : clause.slice(rightAt + right.length, leftAt);
                return /(?:和|与|及|以及|跟|同|、|\band\b|&)/iu.test(between);
            }));
        let candidate = clause && !/^(?:把|将)(?:你|我|他|她|它|我们|你们|他们|她们|对方)/u.test(clause)
            && !coordinatedRosterSubjects
            && !isStructuralMentalOrSourceTransferFrame(clause)
            ? findDirectActionSpeakerBeforeQuote(clause, publishedSpeakerNames)
                || findUnrosteredSubjectBeforeAction(clause)
            : null;
        if (candidate && /(?:还|仍|正|就|才|再|也|则|又|先|立刻|马上|突然|随后|接着|然后)$/u.test(candidate.text)) {
            const trimmedText = Array.from(candidate.text).slice(0, -1).join('');
            const trimmedEnd = candidate.end - 1;
            if (trimmedText && Array.from(clause).slice(candidate.start, trimmedEnd).join('') === trimmedText
                && new RegExp(STRUCTURAL_ACTION_CUE, 'u').test(Array.from(clause).slice(trimmedEnd).join(''))) {
                candidate = { ...candidate, text: trimmedText, end: trimmedEnd };
            }
        }
        const quoteLocalBodyState = allowQuoteLocalBodyState
            && /^(?:眼神|目光|眼睛|眼中|脸色|神情|表情)[^。！？!?;；:：]{0,36}$/u.test(
                Array.from(clause).slice(candidate?.end || 0).join(''));
        if (candidate && (quoteLocalBodyState || isStructuralActiveNamedActionSubject(clause, candidate))
            && isValidStructuralPageSpan(candidate, Array.from(clause).length)
            && Array.from(clause).slice(candidate.start, candidate.end).join('') === candidate.text) {
            matches.push({
                ...candidate,
                start: offset + Array.from(leading).length + candidate.start,
                end: offset + Array.from(leading).length + candidate.end,
            });
        }
        offset += Array.from(piece).length;
    }
    const unique = new Map(matches.map((candidate) => [normalizeStructuralSpeakerKey(candidate.text), candidate]));
    return unique.size === 1 ? [...unique.values()][0] : null;
}

function resolveStructuralQuoteSpeakerCandidates(candidates = []) {
    const valid = candidates.filter((candidate) => candidate && Number.isInteger(candidate.evidenceRank)
        && typeof candidate.speakerText === 'string' && candidate.speakerText.trim()
        && isValidStructuralPageSpan(candidate.speakerSpan, Number.MAX_SAFE_INTEGER)
        && isValidStructuralPageSpan(candidate.evidenceSpan, Number.MAX_SAFE_INTEGER));
    if (!valid.length) return { status: 'none', candidate: null };
    const bestRank = Math.min(...valid.map((candidate) => candidate.evidenceRank));
    const best = valid.filter((candidate) => candidate.evidenceRank === bestRank);
    const bySpeaker = new Map();
    for (const candidate of best) {
        const key = normalizeStructuralSpeakerKey(candidate.speakerText);
        const existing = bySpeaker.get(key);
        if (!existing || (candidate.speakerSpan.end - candidate.speakerSpan.start)
            < (existing.speakerSpan.end - existing.speakerSpan.start)) bySpeaker.set(key, candidate);
    }
    if (bySpeaker.size > 1) return { status: 'conflict', candidate: null, rank: bestRank };
    const candidate = [...bySpeaker.values()][0];
    return { status: 'selected', candidate, rank: bestRank };
}

function resolvePageLocalQuoteSpeakerCue(quote, pageCue, parserVersion = '') {
    if (!quote || !pageCue) return { status: 'none', candidate: null };
    let localCandidate = {
        speakerText: pageCue.text,
        displaySpeakerText: pageCue.text,
        speakerSpan: { ...pageCue.speakerSpan },
        evidenceSpan: { ...pageCue.evidenceSpan },
        sourceRegion: 'before-quote',
        syntaxRole: 'explicit-speaker-cue',
        ruleId: 'page-local-explicit-speech-cue',
        evidenceRank: structuralQuoteSpeakerEvidenceRank('page-local-explicit-speech-cue'),
    };
    const decision = quote.decision;
    const attributedCandidate = decision?.status === 'attributed' ? {
        speakerText: decision.speakerText,
        displaySpeakerText: decision.displaySpeakerText || decision.speakerText,
        speakerSpan: { ...decision.speakerSpan },
        evidenceSpan: { ...decision.evidenceSpan },
        sourceRegion: decision.sourceRegion,
        syntaxRole: decision.syntaxRole,
        ruleId: decision.ruleId,
        evidenceRank: decision.evidenceRank,
    } : null;
    if (isStructuralParserVersionV75(parserVersion) && attributedCandidate
        && attributedCandidate.evidenceRank === 0 && localCandidate.evidenceRank === 0) {
        const connective = /^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|忽然|紧接着|与此同时)\s*)+/u.exec(localCandidate.speakerText)?.[0] || '';
        const connectiveLength = Array.from(connective).length;
        const strippedPageName = localCandidate.speakerText.slice(connective.length);
        const exactRosterNameAtCueHead = strippedPageName.startsWith(attributedCandidate.speakerText)
            && localCandidate.speakerSpan.start + connectiveLength === attributedCandidate.speakerSpan.start
            && localCandidate.speakerSpan.end >= attributedCandidate.speakerSpan.end
            && localCandidate.evidenceSpan.end === quote.quoteSpan.start
            && attributedCandidate.evidenceSpan.end === quote.quoteSpan.start;
        if (exactRosterNameAtCueHead && (connectiveLength > 0
            || localCandidate.speakerText !== attributedCandidate.speakerText)) {
            // The full-message quote decision has exact name and source spans.
            // The page-local tokenizer may include a leading connective or
            // manner word in its Han token; when both cues terminate at this
            // exact quote, the complete source-bound decision is authoritative.
            localCandidate = { ...attributedCandidate };
        }
    }
    const sameCueSpan = attributedCandidate
        && isValidStructuralPageSpan(attributedCandidate.evidenceSpan, Number.MAX_SAFE_INTEGER)
        && isValidStructuralPageSpan(localCandidate.evidenceSpan, Number.MAX_SAFE_INTEGER)
        && attributedCandidate.evidenceSpan.start === localCandidate.evidenceSpan.start
        && attributedCandidate.evidenceSpan.end === localCandidate.evidenceSpan.end;
    const sameSpeakerStart = attributedCandidate
        && isValidStructuralPageSpan(attributedCandidate.speakerSpan, Number.MAX_SAFE_INTEGER)
        && attributedCandidate.speakerSpan.start === localCandidate.speakerSpan.start;
    const prefixBoundaryVariant = attributedCandidate
        && (attributedCandidate.speakerText.startsWith(localCandidate.speakerText)
            || localCandidate.speakerText.startsWith(attributedCandidate.speakerText));
    // Both extractors may parse different name lengths from the same exact
    // pre-quote cue (`瑞恩小声说`: the page-local Han-name matcher can swallow
    // 小声). This is one source assertion with competing token boundaries,
    // not independent, different-speaker evidence. Keep the full quote
    // resolver's selected boundary only when the cue span and start are exact.
    if (sameCueSpan && sameSpeakerStart && prefixBoundaryVariant
        && attributedCandidate.evidenceRank === localCandidate.evidenceRank
        && attributedCandidate.sourceRegion === 'before-quote'
        && attributedCandidate.syntaxRole === 'explicit-speaker-cue') {
        return { status: 'selected', candidate: attributedCandidate, rank: attributedCandidate.evidenceRank };
    }
    if (decision?.status === 'unresolved' && decision.reasonId === 'conflicting-quoted-attribution') {
        const conflictRank = Number.isInteger(decision.evidenceRank) ? decision.evidenceRank : 0;
        return conflictRank <= localCandidate.evidenceRank
            ? { status: 'conflict', candidate: null, rank: conflictRank }
            : resolveStructuralQuoteSpeakerCandidates([localCandidate]);
    }
    const candidates = attributedCandidate ? [attributedCandidate] : [];
    return resolveStructuralQuoteSpeakerCandidates([...candidates, localCandidate]);
}

function findStructuralPreviousSentenceContextSpan(source, quoteStart) {
    let boundary = quoteStart - 1;
    while (boundary >= 0 && /\s/u.test(source[boundary])) boundary -= 1;
    while (boundary >= 0 && !/[。！？!?;；\n]/u.test(source[boundary])) boundary -= 1;
    if (boundary < 0) return { start: 0, end: 0 };
    const end = boundary + 1;
    let start = boundary - 1;
    while (start >= 0 && !/[。！？!?;；\n]/u.test(source[start])) start -= 1;
    return { start: Math.max(0, start + 1), end };
}

function structuralQuoteSyntaxRole(ruleId) {
    if (['line-speaker', 'known-prefix', 'quoted-attribution', 'named-subject-colon-quote',
        'dashed-explicit-speech-cue', 'post-quote-attribution', 'page-local-explicit-speech-cue'].includes(ruleId)) {
        return 'explicit-speaker-cue';
    }
    if (['unrostered-action-attribution', 'direct-action-attribution', 'ranked-unique-action-subject',
        'prior-page-action-subject-continuation', 'prior-sentence-unique-action-subject',
        'rostered-subject-quoted-clause'].includes(ruleId)) {
        return 'named-action-subject';
    }
    if (String(ruleId || '').includes('pronoun') || String(ruleId || '').includes('backreference')) return 'pronoun-reference';
    if (String(ruleId || '').includes('player-')) return 'player-self-reference';
    if (String(ruleId || '').includes('anonymous')) return 'anonymous-first-appearance';
    if (String(ruleId || '').includes('group')) return 'group-speaker';
    return 'contextual-speaker-evidence';
}

function isStructuralActiveNamedActionSubject(clauseText, candidate) {
    if (!candidate || !isValidStructuralPageSpan(candidate, Array.from(String(clauseText ?? '')).length)) return false;
    const tail = Array.from(String(clauseText ?? '')).slice(candidate.end).join('').trimStart();
    if (!tail || /^(?:地|得|被|和|与|及|跟|同)/u.test(tail)) return false;
    // A named actor can be separated from the quote by an ordinary object or
    // instrument phrase (`把钥匙丢给你`, `用奥术洞察鉴定`). Treat the full
    // clause as the predicate frame; the grammatical subject remains the
    // leading unique actor selected by findUnrosteredSubjectBeforeAction.
    if (/^(?:把|将|用|以|借助)[^。！？!?;；:：]{1,48}(?:丢给|扔给|丢出|扔出|递给|递到|交给|塞给|推给|拿起|抓起|鉴定|检查|辨认|打碎|击碎|撕开)/u.test(tail)) return true;
    const modifiers = '(?:(?:还|仍|正|正在|已|已经|就|才|再|也|则|又|先|立刻|马上|突然|随后|接着|然后|缓缓|慢慢|迅速|轻轻|恭敬地|认真地|严肃地|平静地|兴奋地|没有|没|未|不曾|不再|并未)\\s*)*';
    const actionTail = tail.replace(new RegExp(`^${modifiers}`, 'u'), '');
    if (/^(?:感到|觉得|显得|看起来|变得|似乎|脸色|神情|表情|沉默|震惊|惊讶|疑惑|担忧|愤怒|兴奋|激动)/u.test(actionTail)) return false;
    if (new RegExp(`^(?:${STRUCTURAL_ACTION_CUE})`, 'u').test(actionTail)) return true;
    return new RegExp(`^${modifiers}(?:把|将)[^。！？!?;；:：]{1,24}?(?:递|塞|推|交|放|拿|撕|打|砸)`, 'u').test(tail);
}

function containsStructuralWrittenCarrierFrame(valueText, quoteText = '') {
    const source = String(valueText ?? '');
    return source.split(/(?<=[。！？!?;；\n])/u).some((sentence) => {
        const clause = sentence.trim().replace(/[。！？!?;；]+$/u, '');
        return clause && (isStructuralQuotedInformationFrame(clause, clause)
            || isStructuralQuotedInformationFrame(clause, quoteText));
    });
}

function findUnrosteredSubjectBeforeExplicitSpeechCue(valueText, speechCue) {
    const source = String(valueText ?? '');
    if (!source.trim() || !speechCue || isStructuralMentalOrSourceTransferFrame(source)) return null;
    const boundaries = [...source.matchAll(/[。！？!?;；\n]/gu)];
    const lastBoundary = boundaries.at(-1);
    const clauseStart = lastBoundary ? lastBoundary.index + lastBoundary[0].length : 0;
    const afterBoundary = source.slice(clauseStart);
    const transition = afterBoundary.match(/^(?:(?:但是|不过|然而|但|而|随后|接着|然后|同时|这时|此时|突然|并且|并)\s*)+/u)?.[0] || '';
    const afterTransition = afterBoundary.slice(transition.length);
    const whitespace = afterTransition.match(/^\s*/u)?.[0] || '';
    const clause = afterTransition.slice(whitespace.length);
    if (!clause || /^(?:她|他|它|你|我|我们|你们|他们|她们|某人|有人|一个人|一名|一位|对方|众人|大家|陌生人|人影|身影|说话者|系统|旁白|叙述|传闻|铭文|地图|信件|账本|记录|告示|面板|屏幕)/u.test(clause)) return null;
    if (isStructuralAnonymousSpeakerDescription(clause)) return null;
    if (/(?:和|与|以及|及|跟|同)\s*(?:[\p{Script=Han}]{2,4}|[A-Z][A-Za-z0-9'’.-]*)/u.test(clause)
        || /\b[A-Z][A-Za-z0-9'’.-]*\s+(?:and|&)\s+[A-Z][A-Za-z0-9'’.-]*/iu.test(clause)) return null;

    const modifier = new RegExp(`^\\s*(?:[,，、]\\s*)?(?:在|正|正在|又|仍|随后|接着|然后|立刻|突然|朝|向|对|从|以|用|通过|低声|轻声|小声|高声|大声|兴奋地|严肃地|认真地|平静地|in\\s|at\\s|near\\s|from\\s|toward\\s|while\\s|(?:${STRUCTURAL_ACTION_CUE}))`, 'iu');
    const nonCharacterSubjects = /^(?:系统|旁白|叙述|传闻|铭文|地图|图表|信件|账本|记录|告示|面板|屏幕|守卫|士兵|骑士|法师|敌人|群众|人群|众人|大家|全员)$/u;
    const candidates = [];
    const addCandidate = (name, tail) => {
        const speaker = String(name ?? '').trim();
        if (!speaker || isStructuralAnonymousSpeakerDescription(speaker) || nonCharacterSubjects.test(speaker)
            || (tail && !modifier.test(tail))) return;
        candidates.push(speaker);
    };

    // Separate common discourse/manner material from the name before trying
    // a short CJK tokenization. Otherwise “塞莎又压低声音” yields several
    // equally plausible 2–4 character pseudo-names, and “Lila冷冷” rejects
    // the real name because 冷冷 is not a grammatical name suffix.
    const mannerBoundary = /(?:又|仍|再次|随后|接着|然后)?(?:压低(?:了)?声音|放低(?:了)?声音|提高(?:了)?声音|抬高(?:了)?声音|冷冷|冷声|淡淡|缓缓|慢慢|轻轻地|轻轻|严肃地|认真地|平静地|急切地|怒气冲冲地)$/u.exec(clause);
    if (mannerBoundary?.index > 0) {
        const nameText = clause.slice(0, mannerBoundary.index).trim();
        const latinName = nameText.match(/^[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}$/u)?.[0];
        const hanName = nameText.match(/^[\p{Script=Han}]{2,4}$/u)?.[0];
        const name = latinName || hanName;
        if (name && !isStructuralAnonymousSpeakerDescription(name)) {
            const start = Array.from(source.slice(0, clauseStart + transition.length)).length + Array.from(whitespace).length;
            return { text: name, start, end: start + Array.from(name).length, ruleId: 'quoted-attribution' };
        }
    }

    const latin = clause.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
    if (latin?.groups?.name && !/^(?:a|an|the)\s/iu.test(latin.groups.name)) {
        addCandidate(latin.groups.name, latin.groups.tail);
    }
    const hanLength = Array.from(clause).findIndex((char) => !/\p{Script=Han}/u.test(char));
    const hanRunLength = hanLength < 0 ? Array.from(clause).length : hanLength;
    for (let length = Math.min(4, hanRunLength); length >= 2; length -= 1) {
        const head = Array.from(clause).slice(0, length).join('');
        const rest = Array.from(clause).slice(length).join('');
        const honorific = rest.match(/^(?:大法师|公爵夫人|将军|领队|队长|船长|法师|男爵|伯爵|子爵|夫人|女士|先生|大人)/u)?.[0] || '';
        addCandidate(`${head}${honorific}`, rest.slice(Array.from(honorific).length));
    }

    const distinct = [...new Set(candidates.map((candidate) => normalizeStructuralSpeakerKey(candidate)))];
    if (distinct.length !== 1) return null;
    const text = candidates.find((candidate) => normalizeStructuralSpeakerKey(candidate) === distinct[0]);
    const start = Array.from(source.slice(0, clauseStart + transition.length)).length + Array.from(whitespace).length;
    return { text, start, end: start + Array.from(text).length, ruleId: 'quoted-attribution' };
}

function findReportedFirstUtteranceSpeaker(valueText, publishedSpeakerNames = []) {
    const source = String(valueText ?? '').trim();
    if (!source || isStructuralMentalOrSourceTransferFrame(source)) return null;
    const marker = source.match(/(?:(?:说|说道|问|问道|喊|喊道|叫道|讲|讲道)的?)?(?:的)?第(?:一|1)句(?:话|台词)?(?:内容)?(?:是|为|说|说道|问道|喊道|叫道)?\s*$/u);
    if (!marker) return null;

    const subjectPrefix = source.slice(0, marker.index).trimEnd();
    const leadingTime = subjectPrefix.match(/^(?:(?:刚刚?|在)?(?:醒来|醒过来|苏醒|恢复意识)后)[，,、\s]*/u)?.[0] || '';
    let subjectOffset = Array.from(leadingTime).length;
    let subject = subjectPrefix.slice(leadingTime.length).trim();
    const trailingTime = subject.match(/(?:刚刚?|醒来|醒过来|苏醒|恢复意识)后$/u)?.[0] || '';
    if (trailingTime) subject = subject.slice(0, -trailingTime.length).trimEnd();
    if (subject.endsWith('的')) subject = subject.slice(0, -1).trimEnd();
    if (!subject || /^(?:你|我|他|她|它|我们|你们|他们|她们)$/u.test(subject)
        || /(?:旁白|系统|地图|图表|图纸|海图|信件|信纸|卷轴|羊皮纸|账本|记录|日志|报告|公告|文书|清单|碑文|石碑|铭文|告示|面板|屏幕|标题|章节|场景|序幕|开场)/u.test(subject)
        || isStructuralAnonymousSpeakerDescription(subject)) return null;

    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))]
        .sort((left, right) => right.length - left.length);
    const known = knownNames.find((name) => subject === name);
    const unrostered = /^(?:[\p{Script=Han}]{2,4}(?:大法师|公爵夫人|将军|队长|船长|法师|男爵|伯爵|子爵|夫人|女士|先生|大人)?|[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})$/u.test(subject)
        && !/^(?:系统|旁白|叙述|传闻|铭文|地图|图表|信件|账本|记录|告示|面板|屏幕|守卫|士兵|骑士|法师|敌人|群众|人群|众人|大家|全员|标题|章节|场景|序幕|开场)$/u.test(subject);
    if (!known && !unrostered) return null;
    const spanText = known || subject;
    return {
        text: spanText,
        start: subjectOffset,
        end: subjectOffset + Array.from(spanText).length,
        ruleId: 'reported-first-utterance',
    };
}

function findUnrosteredUniqueActionSubjectBeforeQuote(valueText, publishedSpeakerNames = []) {
    const source = String(valueText ?? '').trim();
    if (!source || Array.from(source).length > 120
        || /[。！？!?;；\n]/u.test(source)
        || findTrailingSpeechCue(source)
        || isStructuralMentalOrSourceTransferFrame(source)
        || isStructuralQuotedInformationFrame(source, source.split(/[，,]/u).at(-1)?.trim() || source)
        || hasCoordinatedSubjectsBeforeAction(source, publishedSpeakerNames)) return null;

    const clauses = source.split(/[，,]/u).map((clause) => clause.trim()).filter(Boolean);
    if (!clauses.length || clauses.length > 3) return null;
    const firstClause = clauses[0];
    const actionPrefix = new RegExp(`^(?:(?:立刻|马上|突然|随即|缓缓|慢慢|迅速|轻轻|随后|接着|然后|正|正在|又|仍)\\s*)?(?:(?:在|于)[^，,。！？!?;；:：]{1,12})?(?:(?:把)[^，,。！？!?;；:：]{1,24}?(?:塞|递|推|交|放))?(?:看得[^，,。！？!?;；:：]{1,10}|${STRUCTURAL_ACTION_CUE})`, 'u');
    const candidates = [];
    const addCandidate = (name, tail) => {
        const speaker = String(name ?? '').trim();
        if (!speaker || /^(?:(?:随后|接着|然后|这时|此时|突然)\s*)?(?:你|我|他|她|它|我们|你们|他们|她们|自己|对方|有人|某人|一个人|一名|一位|陌生人|人影|身影)/u.test(speaker)
            || isStructuralAnonymousSpeakerDescription(speaker)
            || /^(?:系统|旁白|叙述|传闻|铭文|地图|图表|信件|账本|记录|告示|面板|屏幕|守卫|士兵|骑士|法师|敌人|群众|人群|众人|大家|全员|标题|章节|场景|序幕|开场)$/u.test(speaker)
            || !actionPrefix.test(tail)) return;
        candidates.push(speaker);
    };

    const latinSubject = firstClause.match(/^(?<name>[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2})(?<tail>[\s\S]*)$/u);
    if (latinSubject?.groups?.name && !/^(?:a|an|the)\s/iu.test(latinSubject.groups.name)) {
        addCandidate(latinSubject.groups.name, latinSubject.groups.tail);
    }

    const hanRunLength = Array.from(firstClause).findIndex((char) => !/\p{Script=Han}/u.test(char));
    const leadingHanLength = hanRunLength < 0 ? Array.from(firstClause).length : hanRunLength;
    for (let length = Math.min(4, leadingHanLength); length >= 2; length -= 1) {
        const head = Array.from(firstClause).slice(0, length).join('');
        const rest = Array.from(firstClause).slice(length).join('');
        const honorific = rest.match(/^(?:大法师|公爵夫人|将军|领队|队长|船长|法师|男爵|伯爵|子爵|夫人|女士|先生|大人)/u)?.[0] || '';
        addCandidate(`${head}${honorific}`, rest.slice(Array.from(honorific).length));
    }
    const distinct = [...new Set(candidates.map((name) => normalizeStructuralSpeakerKey(name)))];
    if (distinct.length !== 1) return null;
    const speaker = candidates.find((name) => normalizeStructuralSpeakerKey(name) === distinct[0]);

    const knownNames = [...new Set((Array.isArray(publishedSpeakerNames) ? publishedSpeakerNames : [])
        .filter((name) => typeof name === 'string' && name.trim() && name === name.trim()))];
    for (const clause of clauses.slice(1)) {
        const continuation = clause.replace(/^(?:(?:随后|接着|然后|这时|此时|突然|并|又)\s*)+/u, '');
        if (/^(?:你|我|他|她|它|我们|你们|他们|她们|自己|对方|众人|大家|一个人|守卫|士兵|骑士|法师|敌人)/u.test(continuation)
            || knownNames.some((name) => continuation.startsWith(name))) return null;
        const cue = actionPrefix.exec(continuation);
        if (cue) continue;
        const nextAction = new RegExp(STRUCTURAL_ACTION_CUE, 'u').exec(continuation);
        if (!nextAction || nextAction.index > 12) return null;
        const preceding = Array.from(continuation.slice(0, nextAction.index)).join('').trim();
        if (/^[\p{Script=Han}]{2,4}(?:也|又|仍)?$/u.test(preceding)
            || /^[A-Z][A-Za-z0-9'’.-]*(?:\s+[A-Z][A-Za-z0-9'’.-]*){0,2}$/u.test(preceding)) return null;
    }

    return { text: speaker, start: 0, end: Array.from(speaker).length, ruleId: 'unrostered-action-attribution' };
}

/** Create a display-only probable title from one already-inferred production segment. */
export async function createProbableNarrativeSpeakerTitleEvidence({
    fullText = '',
    sourceMessageIndex,
    sourceMessageHash = '',
    coreSpan,
    segment,
    messageIndex = null,
} = {}) {
    const source = String(fullText ?? '');
    const chars = Array.from(source);
    if (!Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
        || !/^sha256:[a-f0-9]{64}$/u.test(sourceMessageHash)
        || !isValidStructuralPageSpan(coreSpan, chars.length)
        || segment?.type !== 'dialogue'
        || segment?.speakerConfidence !== 'inferred'
        || segment?.confidenceBand !== 'probable'
        || segment?.speakerOrigin !== 'runtime-text'
        || typeof segment.speaker !== 'string' || !segment.speaker.trim()
        || typeof segment.quote !== 'string' || !segment.quote.trim()
        || segment.sourceSpan?.start !== coreSpan.start || segment.sourceSpan?.end !== coreSpan.end) return null;
    if (messageIndex) {
        if (messageIndex.sourceMessageIndex !== sourceMessageIndex
            || messageIndex.sourceMessageHash !== sourceMessageHash
            || messageIndex.sourceLength !== chars.length) return null;
        const currentQuotes = (messageIndex.quoteEvidence || []).filter((quote) => (
            isValidStructuralPageSpan(quote?.quoteSpan, chars.length)
            && quote.quoteSpan.start < coreSpan.end && coreSpan.start < quote.quoteSpan.end
            && quote.quoteSpan.start >= coreSpan.start
            && quote.quoteSpan.start + Array.from(segment.quote).length <= coreSpan.end
            && chars.slice(quote.quoteSpan.start, quote.quoteSpan.start + Array.from(segment.quote).length).join('') === segment.quote
        ));
        if (currentQuotes.length !== 1) return null;
        if (currentQuotes.some((quote) => quote.decision?.status === 'attributed'
            || (quote.decision?.status === 'unresolved'
                && quote.decision.reasonId === 'conflicting-quoted-attribution'))) return null;
        const pageCue = findStructuralPageLocalSpeakerCue(chars, coreSpan);
        if (pageCue?.directCue) {
            const targetQuotes = currentQuotes.filter((quote) => quote.quoteSpan.start === pageCue.quoteStart);
            if (targetQuotes.length !== 1) return null;
            const resolution = resolvePageLocalQuoteSpeakerCue(targetQuotes[0], pageCue, '');
            if (resolution.status !== 'none') return null;
        }
    }

    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof TextEncoder !== 'function') return null;
    let actualHash;
    try {
        const digest = await subtle.digest('SHA-256', new TextEncoder().encode(source));
        actualHash = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    } catch {
        return null;
    }
    if (actualHash !== sourceMessageHash) return null;

    const pageText = chars.slice(coreSpan.start, coreSpan.end).join('');
    if (!pageText || segment.sourceText !== pageText) return null;
    const parsed = parseNarrativeDialogueParagraph(pageText);
    if (!parsed || parsed.speaker !== segment.speaker || parsed.quote !== segment.quote) return null;

    const matched = /^(.{2,80}?)\s*[：:]\s*([“"「『][\s\S]*(?:[”"」』]|$))$/du.exec(pageText);
    if (!matched) return null;
    const localChars = Array.from(pageText);
    const codePointOffset = (utf16Offset) => Array.from(pageText.slice(0, utf16Offset)).length;
    const trimRange = (range) => {
        while (range.start < range.end && /\s/u.test(localChars[range.start])) range.start += 1;
        while (range.end > range.start && /\s/u.test(localChars[range.end - 1])) range.end -= 1;
        return range;
    };
    const openingQuotes = new Set(['“', '"', '「', '『']);
    const closingQuotes = new Set(['”', '"', '」', '』']);
    const prefixRange = trimRange({
        start: codePointOffset(matched.indices[1][0]),
        end: codePointOffset(matched.indices[1][1]),
    });
    const prefixBeforeConnector = localChars.slice(prefixRange.start, prefixRange.end).join('');
    const connector = prefixBeforeConnector.match(/^(?:然后|接着|随后|这时|此时)\s*/u)?.[0] || '';
    prefixRange.start += Array.from(connector).length;
    while (prefixRange.start < prefixRange.end && openingQuotes.has(localChars[prefixRange.start])) prefixRange.start += 1;
    while (prefixRange.end > prefixRange.start && closingQuotes.has(localChars[prefixRange.end - 1])) prefixRange.end -= 1;
    trimRange(prefixRange);
    const prefix = localChars.slice(prefixRange.start, prefixRange.end).join('');
    const actionStart = prefix.search(NARRATIVE_DIALOGUE_ACTION_PATTERN);
    const actionStartCodePoints = actionStart < 0 ? -1 : Array.from(prefix.slice(0, actionStart)).length;
    if (actionStartCodePoints <= 0) return null;
    const action = prefix.slice(actionStart).trim();
    const actionCue = action.match(NARRATIVE_DIALOGUE_ACTION_PATTERN);
    const speakerRange = trimRange({ start: prefixRange.start, end: prefixRange.start + actionStartCodePoints });
    while (speakerRange.start < speakerRange.end && openingQuotes.has(localChars[speakerRange.start])) speakerRange.start += 1;
    while (speakerRange.end > speakerRange.start && closingQuotes.has(localChars[speakerRange.end - 1])) speakerRange.end -= 1;
    trimRange(speakerRange);
    const speaker = localChars.slice(speakerRange.start, speakerRange.end).join('');
    const quote = matched[2].trim();
    if (!speaker || speaker !== parsed.speaker || !action || !actionCue || actionCue.index !== 0
        || quote !== parsed.quote) return null;

    const fullSpan = (range) => ({ start: coreSpan.start + range.start, end: coreSpan.start + range.end });
    const actionRange = trimRange({ start: prefixRange.start + actionStartCodePoints, end: prefixRange.end });
    const quoteRange = trimRange({
        start: codePointOffset(matched.indices[2][0]),
        end: codePointOffset(matched.indices[2][1]),
    });
    const speakerSpan = fullSpan(speakerRange);
    const actionSpan = fullSpan(actionRange);
    const quoteSpan = fullSpan(quoteRange);
    const spans = [speakerSpan, actionSpan, quoteSpan];
    if (spans.some((span) => !span || span.start < coreSpan.start || span.end > coreSpan.end)
        || !(speakerSpan.start < speakerSpan.end && speakerSpan.end <= actionSpan.start
            && actionSpan.end <= quoteSpan.start && quoteSpan.start < quoteSpan.end)
        || spans.some((span, index) => chars.slice(span.start, span.end).join('')
            !== [speaker, action, quote][index])) return null;

    const sourceEvidence = {
        speakerConfidence: 'inferred',
        confidenceBand: 'probable',
        speakerOrigin: 'runtime-text',
        speaker: { text: speaker, ...speakerSpan },
        action: { text: action, ...actionSpan },
        quote: { text: quote, ...quoteSpan },
    };
    return {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: coreSpan.start, end: coreSpan.end },
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        classificationEvidenceSpans: spans.map((span) => ({ start: span.start, end: span.end })),
        kind: 'speaker',
        text: `${speaker}（推测）`,
        speakers: [{
            mentionRef: `display-only-probable-${sourceMessageIndex}-${speakerSpan.start}-${speakerSpan.end}`,
            text: speaker,
            start: speakerSpan.start,
            end: speakerSpan.end,
        }],
        ruleId: 'probable-narrative-dialogue',
        confidenceBand: 'probable',
        sourceEvidence,
    };
}

/**
 * Continue a probable display title only when the exact same unresolved quote
 * span crosses from a page with a validated probable seed into a later page.
 * This is a title-only projection; it does not mutate segments or identities.
 */
export function createProbableQuoteSpanContinuationTitleEvidence({
    fullText = '',
    sourceMessageIndex,
    sourceMessageHash = '',
    coreSpan,
    currentPageIndex,
    unresolvedSpans = [],
    seedEvidenceRecords = [],
} = {}) {
    const chars = Array.from(String(fullText ?? ''));
    if (!Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
        || !/^sha256:[a-f0-9]{64}$/u.test(sourceMessageHash)
        || !Number.isSafeInteger(currentPageIndex) || currentPageIndex < 1
        || !isValidStructuralPageSpan(coreSpan, chars.length)
        || !Array.isArray(unresolvedSpans) || !Array.isArray(seedEvidenceRecords)) return null;

    const targets = unresolvedSpans.filter((span) => span?.reasonId === 'unattributed-quoted-speech'
        && isValidStructuralPageSpan(span, chars.length)
        && span.start < coreSpan.end && coreSpan.start < span.end);
    if (!targets.length) return null;

    const seeds = seedEvidenceRecords.filter((record) => {
        const evidence = record?.evidence;
        const seedCore = record?.coreSpan;
        const probable = evidence?.sourceEvidence;
        const spans = [probable?.speaker, probable?.action, probable?.quote];
        return evidence?.kind === 'speaker'
            && evidence.ruleId === 'probable-narrative-dialogue'
            && evidence.sourceMessageIndex === sourceMessageIndex
            && evidence.sourceMessageHash === sourceMessageHash
            && evidence.confidenceBand === 'probable'
            && typeof probable?.speaker?.text === 'string'
            && probable.speaker.text === evidence.speakers?.[0]?.text
            && evidence.text === `${probable.speaker.text}（推测）`
            && probable.speakerConfidence === 'inferred'
            && probable.confidenceBand === 'probable'
            && probable.speakerOrigin === 'runtime-text'
            && isValidStructuralPageSpan(seedCore, chars.length)
            && Number.isSafeInteger(record.sourcePageIndex)
            && record.sourcePageIndex >= currentPageIndex - 2
            && record.sourcePageIndex < currentPageIndex
            && seedCore.end <= coreSpan.start
            && spans.every((span) => isValidStructuralPageSpan(span, chars.length)
                && chars.slice(span.start, span.end).join('') === span.text)
            && spans[0].start < spans[1].start && spans[1].end <= spans[2].start
            && evidence.speakers?.length === 1
            && evidence.speakers[0].start === spans[0].start
            && evidence.speakers[0].end === spans[0].end
            && spans[0].start >= seedCore.start && spans[2].end <= seedCore.end;
    });
    if (!seeds.length) return null;

    const selected = [];
    for (const target of targets) {
        const matches = seeds.filter(({ evidence }) => {
            const quote = evidence.sourceEvidence.quote;
            return quote.start < target.end && target.start < quote.end;
        });
        const speakers = new Map(matches.map(({ evidence }) => [
            normalizeStructuralSpeakerKey(evidence.sourceEvidence.speaker.text), evidence.sourceEvidence.speaker.text,
        ]));
        if (speakers.size !== 1) return null;
        const [speakerKey, speaker] = [...speakers.entries()][0];
        const matchingSeeds = matches.filter(({ evidence }) => (
            normalizeStructuralSpeakerKey(evidence.sourceEvidence.speaker.text) === speakerKey
        ));
        const overlap = trimStructuralSourceSpan(chars, Math.max(coreSpan.start, target.start), Math.min(coreSpan.end, target.end));
        if (!overlap) return null;
        selected.push({ speaker, speakerKey, overlap, seed: matchingSeeds[0] });
    }
    const speakerKeys = new Set(selected.map((item) => item.speakerKey));
    if (speakerKeys.size !== 1) return null;

    const { speaker, seed } = selected[0];
    const speakerEvidence = seed.evidence.sourceEvidence.speaker;
    const classificationEvidenceSpans = [...new Map(selected.map(({ overlap }) => (
        [`${overlap.start}:${overlap.end}`, overlap]
    ))).values()].sort((left, right) => left.start - right.start);
    return {
        sourceMessageIndex,
        sourceMessageHash,
        viewSpan: { start: speakerEvidence.start, end: coreSpan.end },
        coreSpan: { start: coreSpan.start, end: coreSpan.end },
        classificationEvidenceSpans,
        kind: 'speaker',
        text: `${speaker}（推测）`,
        speakers: [{
            mentionRef: `display-only-probable-continuation-${sourceMessageIndex}-${speakerEvidence.start}-${speakerEvidence.end}`,
            text: speaker,
            start: speakerEvidence.start,
            end: speakerEvidence.end,
        }],
        ruleId: 'probable-quote-span-continuation',
        confidenceBand: 'probable',
        sourceEvidence: {
            speakerConfidence: 'inferred',
            confidenceBand: 'probable',
            speakerOrigin: 'runtime-text',
            seedCoreSpan: { ...seed.coreSpan },
            speaker: { ...speakerEvidence },
            action: { ...seed.evidence.sourceEvidence.action },
            quote: { ...seed.evidence.sourceEvidence.quote },
            continuedQuoteSpans: targets.map(({ start, end }) => ({ start, end })),
        },
    };
}

const NARRATIVE_DIALOGUE_ACTION_PATTERN = /(?:哈哈大笑|咯咯笑|大笑|狂笑|冷笑|苦笑|轻笑|奸笑|咆哮|怒吼|挥舞|摸了摸|舔了舔|舔舐|笑着|喊道|说道|问道|答道|高举|猛地|说|道|问|答|喊|叫|反对|同意|拒绝|摇头|点头|举手|嘶声|低声|高声|大声|小声|笑|哭|怒|冷|轻|急|颤|哆嗦|结巴|打断|回应|坚持|承认|警告|威胁|提醒|解释|嘟囔|嘀咕|喃喃|立即|立刻|马上|整理|露出|握紧|检查|拿起|收起|接过|递给|转身|站起|走向|靠近|看向|望向|盯着|抬起|低下|扬起|举起|拍了拍|掏出|穿戴|取出|放下|推开|拉开|松了口气|眼睛一亮|插话|竖起大拇指|翻了个白眼|咧嘴笑|压低声音|满意地点头|转头看向|say|said|says|ask|asked|reply|replied|object|objected|agree|agreed|shout|shouted|yell|yelled|whisper|whispered|mutter|muttered|stammer|raise|raised|interrupt|warn|warning|insist|insisted|answer|answered|immediately|quickly|softly|loudly)/iu;

function hasNarrativeDialogueVerb(value) {
    const normalized = String(value || '').trim();
    const match = normalized.match(NARRATIVE_DIALOGUE_ACTION_PATTERN);
    return Boolean(match && match.index === 0);
}

function isGenericCharacterNoun(value) {
    return /^(?:守卫|士兵|店主|老板|商人|法师|战士|骑士|弓手|盗贼|地精|哥布林|侍者|老人|女人|男人|女孩|男孩|少女|少年|怪物|敌人|队长|首领|教士|牧师|龙|巨龙|冰霜巨龙|亚龙|冰霜亚龙|飞龙|蓝龙|红龙|黑龙|白龙|绿龙|冷声|低声|轻声|小声|高声|大声|厉声|柔声|guard|soldier|shopkeeper|merchant|wizard|mage|warrior|knight|archer|rogue|goblin|waiter|old man|woman|man|girl|boy|monster|enemy|captain|leader|priest|dragon|wyrm|drake)$/iu.test(String(value || '').trim());
}

// Enemy labels are valid runtime speakers. They used to be filtered as
// status/narration labels, which made a turn such as `哥布林：` render with
// the narrator/placeholder avatar. Keep this mapping conservative: it adds
// only species/archetype evidence explicitly present in the visible label and
// never guesses a gender.
const ENEMY_CHARACTER_LABEL_PATTERNS = Object.freeze([
    { pattern: /哥布林|地精|狗头人|kobold|goblin/iu, value: '哥布林' },
    { pattern: /兽人|半兽人|兽族|兽魔人|orc|半兽人/iu, value: '兽人' },
    { pattern: /蜥蜴人|蜥人|鱼人|鳄人|lizardfolk|lizardman/iu, value: '蜥蜴人' },
    { pattern: /豺狼人|狼族|狼人|野狼|狼群|gnoll|werewolf|wolf/iu, value: '豺狼人' },
    { pattern: /食人魔|巨魔|独眼巨人|ogre|troll|cyclops/iu, value: '食人魔' },
    { pattern: /骷髅|骸骨|僵尸|尸鬼|食尸鬼|幽灵|鬼魂|亡灵|不死|skeleton|zombie|ghoul|wraith|undead/iu, value: '亡灵' },
    { pattern: /恶魔|魔鬼|深渊|demon|devil/iu, value: '兽人' },
    { pattern: /强盗|土匪|劫匪|山贼|盗匪|掠夺者|强盗团|bandit|brigand|raider/iu, value: '强盗' },
    { pattern: /邪教徒|cultist|刺客|杀手|assassin/iu, value: '强盗' },
    { pattern: /敌人|敌军|敌方|怪物|魔物|魔兽|enemy|monster|hostile/iu, value: '敌人' },
    { pattern: /守卫|卫兵|士兵|哨兵|captain|guard|soldier|sentinel/iu, value: '敌方战士' },
]);

function getEnemyCharacterLabelMatch(value) {
    const label = String(value || '').normalize('NFKC').trim();
    return ENEMY_CHARACTER_LABEL_PATTERNS.find(({ pattern }) => pattern.test(label)) || null;
}

function inferEnemyCharacterAttributes(value) {
    const match = getEnemyCharacterLabelMatch(value);
    if (!match) return [];
    return [{
        code: 'character-explicit-species',
        value: match.value,
        confidenceBand: 'explicit',
    }];
}

function isLikelyInferredSpeakerName(value) {
    const name = String(value || '').trim();
    if (getEnemyCharacterLabelMatch(name)) return true;
    if (/^[A-Z][A-Za-z0-9_-]{1,39}$/u.test(name)) return true;
    if (!/^[\p{Script=Han}ぁ-んァ-ヶー]{2,8}$/u.test(name)) return false;
    if (/^(?:差点|险些|几乎|突然|立即|立刻|随后|接着|然后|此时|这时|似乎|仿佛|不禁|仍然|居然|竟然|甚至|可能|应该|必须|只是|真的|刚才|马上|终于|已经|依然|依旧|原本|本来|显然|当然|然而|不过|但是|而且|同时|其实|于是|因为|所以|结果|效果|备注|风险|优势|机械|检定|判定|豁免|状态|属性|装备|背包|物品|道具|技能|能力|法术|经验|金币|生命|魔力|目标|地点|位置|事件|线索|证据|数据|规则|说明|提示|统计)$/u.test(name)) return false;
    return !/(?:你|我|他|她|他们|我们|队伍|大家|所有人|独眼|金发|银发|红发|黑发|白发|高大|瘦小|年轻|年迈|老人|女人|男人|少女|少年|半兽人|卫兵|守卫|士兵|牧师|法师|骑士|战士|怪物|地精|哥布林|在|里|中|后|前|旁|上|下|着|和|与|被|将|把|从|向|对|用|的|地|得|其|这|那|个|些|们|又|则|大|小|拍|手|尖|哈|嘿|呵|哼|咯|笑|声|头|脸|咧|嘴|眯眼)/u.test(name);
}

function hasKnownSpeakerPrefixConflict(normalized, knownSpeakerMap) {
    if (!(knownSpeakerMap instanceof Map) || !normalized) return false;
    return [...knownSpeakerMap.keys()].some((known) => known
        && (normalized.startsWith(known) || known.startsWith(normalized)));
}

/**
 * Split a strong, previously unknown `name + action + quoted speech` clause
 * embedded after sentence punctuation. This is presentation-only: the
 * canonical SillyTavern message remains one unchanged string.
 */
function splitInferredInlineNarrativeDialogues(text, knownSpeakerMap) {
    const source = String(text || '');
    if (!source) return source;
    const matches = [];
    const boundaryPattern = /(^|[。！？!?，,]\s*|\n|[”」』]\s*(?:然后|接着|随后|这时|此时)?\s*|"\s*)/gu;
    const candidatePattern = /^(?:[“"「『])?(.{2,80}?)\s*[：:]\s*[“"「『]/u;
    for (const boundary of source.matchAll(boundaryPattern)) {
        const boundaryText = String(boundary[0] || '');
        const candidateStart = (boundary.index ?? 0) + boundaryText.length;
        const candidate = source.slice(candidateStart).match(candidatePattern);
        if (!candidate) continue;
        const prefix = String(candidate[1] || '').trim().replace(/^(?:然后|接着|随后|这时|此时)\s*/u, '').replace(/^[“"「『]+|[”"」』]+$/gu, '').trim();
        const actionStart = prefix.search(NARRATIVE_DIALOGUE_ACTION_PATTERN);
        if (actionStart <= 0) continue;
        const name = prefix.slice(0, actionStart).replace(/^[“"「『]+|[”"」』]+$/gu, '').trim();
        const action = prefix.slice(actionStart).trim();
        const normalized = normalizeKnownSpeaker(name);
        if (!name || !hasNarrativeDialogueVerb(action)
            || /[，,。！？!?；;“”"「」『』]/u.test(name)
            || !isLikelyInferredSpeakerName(name)
            || isNarratorSpeaker(name) || isNonDialogueLabel(name)
            || (isGenericCharacterNoun(name) && !getEnemyCharacterLabelMatch(name))
            || (knownSpeakerMap instanceof Map
                && (knownSpeakerMap.has(normalized) || hasKnownSpeakerPrefixConflict(normalized, knownSpeakerMap)))) {
            continue;
        }
        if (candidateStart > 0) matches.push(candidateStart);
    }
    if (!matches.length) return source;
    const unique = [...new Set(matches)].sort((left, right) => left - right);
    let result = source;
    for (let index = unique.length - 1; index >= 0; index -= 1) {
        const offset = unique[index];
        if (offset <= 0 || result.slice(offset - 2, offset) === '\n\n') continue;
        result = `${result.slice(0, offset)}\n\n${result.slice(offset)}`;
    }
    return result;
}

function isNonDialogueLabel(value) {
    return isNonCharacterVisualLabel(value)
        || /(?:检定|判定|豁免|豁免记录|行动顺序|顺序|状态|属性|装备|背包|物品|道具|技能|能力|法术|经验|金币|生命|魔力|目标|地点|位置|事件|线索|证据)$/u
            .test(String(value || '').trim());
}

function isNarratorSpeaker(value) {
    const speaker = String(value || '')
        .normalize('NFKC')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
    return /^(?:旁白|解说|系统|主持人|地下城主|dungeon master|dm|gm|game master|narrator|storyteller)$/iu.test(speaker);
}

/**
 * Labels that describe the visible status/action stream are not speakers.
 * Keep this list presentation-only: it must not infer or mutate story state.
 */
function isNonCharacterVisualLabel(value) {
    const label = String(value || '')
        .normalize('NFKC')
        .replace(/^[\s>*#`*_~\x5b\x5d()（）【】「」『』]+|[\s>*#`*_~\x5b\x5d()（）【】「」『』]+$/gu, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
    if (getEnemyCharacterLabelMatch(label)) return false;
    return /^(?:旁白|解说|系统|主持人|地下城主|场景|背景|背景设定|地点|当前地点|环境|战场|场景描述|角色|人物|立绘|character|person|sprite|伤害|伤害记录|死亡豁免|死亡豁免记录|豁免|豁免记录|你的回合|玩家回合|行动顺序|先攻顺序|顺序|状态|属性|战斗状态|回合|行动|(?:.+?)(?:的)?回合|(?:.+?)(?:的)?行动|background|setting|scene|location|current location|environment|battlefield|scene description|damage|damage record|death save|death saves|saving throw|save record|your turn|player turn|initiative order|turn order|action order|status|state)$/iu.test(label);
}

function isPunctuationOnlyVisualNovelSegment(value) {
    return !String(value || '').replace(/[\s\p{P}\p{S}`*_~]/gu, '');
}

function stripHiddenVisualNovelDisplayBlocks(text) {
    return text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\s*(?:think|thinking|thought|reasoning|analysis)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think|thinking|thought|reasoning|analysis)\s*>/gi, '')
        .replace(/\[(?:think|thinking|thought|reasoning|analysis)\][\s\S]*?\[\/(?:think|thinking|thought|reasoning|analysis)\]/gi, '')
        .replace(/```[ \t]*\r?\n[ \t]*\[(?:think|thinking|thought|reasoning|analysis)\][ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```/gi, '')
        .replace(/```\s*\[?\s*(?:think|thinking|thought|reasoning|analysis)\s*\]?\s*[\r\n]+[\s\S]*?```/gi, '')
        .replace(/```(?:think|thinking|thought|reasoning|analysis)[\s\S]*?```/gi, '')
        .replace(/^\s*(?:thinking|reasoning)\s*:\s*[\s\S]*?(?=\n{2,}|$)/gim, '');
}

function stripVisualNovelMarkdownEmphasis(text) {
    let next = text
        .replace(/(\*{1,3}[^*\n]+?\*{1,3})[ \t]+(?=\*{1,3}[^*\n]+?\*{1,3})/g, '$1\n\n')
        .replace(/(_{1,3}[^_\n]+?_{1,3})[ \t]+(?=_{1,3}[^_\n]+?_{1,3})/g, '$1\n\n');

    for (let pass = 0; pass < 3; pass += 1) {
        next = next
            .replace(/(^|[\s([{（「『“])\*{1,3}([^*\n]+?)\*{1,3}(?=$|[\s.,!?;:，。！？；：)\]}）」』”])/gu, '$1$2')
            .replace(/(^|[\s([{（「『“])_{1,3}([^_\n]+?)_{1,3}(?=$|[\s.,!?;:，。！？；：)\]}）」』”])/gu, '$1$2');
    }

    return next
        .replace(/\*{1,3}([^*\n]+?)\*{1,3}/gu, '$1')
        .replace(/_{1,3}([^_\n]+?)_{1,3}/gu, '$1');
}

function addVisualNovelParagraphBreaks(text) {
    return text
        .replace(/[ \t]+/g, ' ')
        // ASCII `"` is symmetric and commonly closes the previous quoted
        // line (`!"Durik...`). Treat only directional/CJK opening quotes as
        // paragraph starts; sentence punctuation already provides the
        // boundary for an adjacent ASCII-named speaker.
        .replace(/([。！？!?])\s*(?=[“「『])/g, '$1\n\n')
        .replace(/([。！？!?])\s+(?=—)/g, '$1\n\n')
        // ASCII double quotes are symmetric; treating `"` as a closing quote
        // splits normal dialogue into punctuation-only paragraphs.
        .replace(/([”」』])\s*(?=[\p{Script=Han}A-Za-z])/gu, '$1\n\n')
        .replace(/([。！？!?])\s+(?=[A-Z][a-z]+ 的|[A-Z][a-z]+ [a-z])/g, '$1\n\n');
}

function splitLongVisualNovelParagraphs(text) {
    return text
        .split(/\n{2,}/)
        .flatMap((paragraph) => splitLongVisualNovelParagraph(paragraph.trim()))
        .filter(Boolean)
        .join('\n\n');
}

function splitLongVisualNovelParagraph(paragraph) {
    if (paragraph.length <= 82) {
        return [paragraph];
    }

    const sentences = paragraph.match(/[^。！？!?]+[。！？!?]+(?:[”"」』])?|[^。！？!?]+$/gu) || [paragraph];
    const result = [];
    let current = '';

    for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) {
            continue;
        }
        const candidate = current ? `${current}${trimmed}` : trimmed;
        if (current && candidate.length > 76) {
            result.push(current);
            current = trimmed;
        } else {
            current = candidate;
        }
    }

    if (current) {
        result.push(current);
    }
    return result.length ? result : [paragraph];
}

export function extractSuggestedActionsFromOriginalText(text, { maxActions = 4 } = {}) {
    const safeText = sanitizeText(text, MAX_VISIBLE_CHAT_TEXT_LENGTH).replace(/\r\n?/g, '\n');
    const lines = safeText.split('\n');
    const headed = extractHeadedActions(lines, maxActions);
    if (headed.suggestedActions.length) {
        return headed;
    }
    return extractTrailingNumberedActions(lines, maxActions);
}

/**
 * Detect a likely truncated RPG response without treating every continuation
 * or short narration as an error. This is presentation/recovery metadata only;
 * it never changes the canonical SillyTavern chat.
 */
export function detectIncompleteRpgResponse(text, { minVisibleLength = 450 } = {}) {
    const visibleText = formatVisualNovelDisplayText(text);
    const narrativeText = stripTrailingRpgMetadata(visibleText);
    if (narrativeText.length < minVisibleLength) {
        return false;
    }
    if (extractSuggestedActionsFromOriginalText(text).suggestedActions.length >= 2) {
        return false;
    }
    if (/(?:GAME\s*OVER|游戏结束|可选行动|行动选项|剧情选项|请选择|下一步)\s*[：:]?/iu.test(narrativeText)) {
        return false;
    }
    const lastVisibleCharacter = narrativeText.trim().slice(-1);
    return Boolean(lastVisibleCharacter) && !/[。！？!?．…」』”）)\]}*>*`~]$/u.test(lastVisibleCharacter);
}

function stripTrailingRpgMetadata(value) {
    const lines = String(value || '').split('\n');
    const metadataLine = /^(?:❤|⛨|🏅|📈|🎚|⚔|🛡|💼|🤸|🔥|💰|📃)\s|^(?:HP|MP|AC|Level|XP|Gold|Status|Weapons\/shield|Armor|Inventory|Abilities|Spells|状态|装备|防具|道具|技能|能力|法术|金币|经验|等级|生命|魔力)\s*[:：]/iu;
    const firstMetadataIndex = lines.findIndex((line) => metadataLine.test(line.trim()));
    if (firstMetadataIndex < 0) {
        return String(value || '').trim();
    }
    return lines.slice(0, firstMetadataIndex).join('\n').trim();
}

function extractHeadedActions(lines, maxActions) {
    const headingIndex = findLastActionHeading(lines);
    if (headingIndex < 0) {
        return noSuggestedActions(lines);
    }

    const suggestedActions = [];
    let actionBlockEnd = headingIndex + 1;
    for (let index = headingIndex + 1; index < lines.length; index += 1) {
        const trimmed = lines[index].trim();
        if (!trimmed) {
            if (suggestedActions.length) {
                actionBlockEnd = index + 1;
            }
            continue;
        }
        const parsed = parseSuggestedActionLine(trimmed, { allowBullet: true });
        if (!parsed) {
            if (suggestedActions.length) {
                actionBlockEnd = index;
                break;
            }
            return noSuggestedActions(lines);
        }
        suggestedActions.push(parsed);
        actionBlockEnd = index + 1;
    }

    return suggestedActions.length >= 2
        ? buildSuggestedActionResult(lines, headingIndex, suggestedActions, maxActions, actionBlockEnd)
        : noSuggestedActions(lines);
}

function extractTrailingNumberedActions(lines, maxActions) {
    const suggestedActions = [];
    let blockStart = -1;

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const trimmed = lines[index].trim();
        if (!trimmed) {
            continue;
        }
        const parsed = parseSuggestedActionLine(trimmed, { allowBullet: false });
        if (!parsed) {
            break;
        }
        suggestedActions.unshift(parsed);
        blockStart = index;
    }

    return suggestedActions.length >= 2 && blockStart >= 0
        ? buildSuggestedActionResult(lines, blockStart, suggestedActions, maxActions)
        : noSuggestedActions(lines);
}

function findLastActionHeading(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (isActionHeading(lines[index])) {
            return index;
        }
    }
    return -1;
}

function isActionHeading(line) {
    return /^(?:可选行动|行动选项|剧情选项|选择|选项|下一步|行动建议|你可以|请选择|接下来可以)\s*[：:]?\s*$/u
        .test(line.trim());
}

function parseSuggestedActionLine(line, { allowBullet }) {
    const numbered = line.match(/^(?:选项\s*)?(?:[1-9]\d*|[A-Da-d]|[一二三四五六七八九十]|[①②③④⑤⑥⑦⑧⑨])[.、)、):：]\s*(.+)$/u);
    const bullet = allowBullet
        ? line.match(/^(?:[-*•·])\s*(.+)$/u)
        : null;
    const rawLabel = numbered?.[1] || bullet?.[1] || '';
    const label = sanitizeSuggestedActionLabel(rawLabel);
    if (!label) {
        return null;
    }
    return {
        label,
        value: label,
    };
}

function sanitizeSuggestedActionLabel(value) {
    const label = sanitizeText(value, 240).trim();
    const quotePairs = [
        ['"', '"'],
        ['\'', '\''],
        ['“', '”'],
        ['‘', '’'],
        ['「', '」'],
        ['『', '』'],
    ];
    for (const [open, close] of quotePairs) {
        if (label.startsWith(open) && label.endsWith(close)) {
            return label.slice(open.length, -close.length).trim();
        }
    }
    return label;
}

function buildSuggestedActionResult(lines, blockStart, suggestedActions, maxActions, blockEnd = lines.length) {
    const uniqueActions = [];
    const seen = new Set();
    for (const action of suggestedActions) {
        const key = action.value.toLocaleLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        uniqueActions.push(action);
        if (uniqueActions.length >= maxActions) {
            break;
        }
    }

    if (uniqueActions.length < 2) {
        return noSuggestedActions(lines);
    }

    return {
        displayText: [
            ...lines.slice(0, blockStart),
            ...lines.slice(blockEnd),
        ].join('\n').trim() || lines.join('\n').trim(),
        suggestedActions: uniqueActions,
    };
}

function noSuggestedActions(lines) {
    return {
        displayText: lines.join('\n').trim(),
        suggestedActions: [],
    };
}

function createChatFileId(manifest, character, date) {
    const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const seed = [
        'galgame',
        manifest?.id || 'entry',
        getManifestRuntimeArcId(manifest) || 'default',
        character.id || character.avatar || 'character',
        stamp,
    ].join('-');
    return seed
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/_+/g, '_')
        .slice(0, 160);
}

function normalizeChatFileId(value) {
    return sanitizeText(value || '', 240)
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

function getManifestRuntimeArcId(manifest) {
    return sanitizeText(manifest?.arcId || manifest?.activeArcId || manifest?.defaultArcId || '', 120);
}

function normalizeChatToken(value) {
    return normalizeChatFileId(value)
        .replace(/[^a-z0-9_-]+/gi, '_')
        .replace(/_+/g, '_')
        .toLowerCase();
}

function defaultFetch(...args) {
    return globalThis.fetch(...args);
}

async function readJsonResponse(response) {
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
        return response.json();
    }
    return {
        ok: false,
        errorCode: 'ORIGINAL_RUNTIME_BRIDGE_BAD_RESPONSE',
        text: await response.text().catch(() => ''),
    };
}
