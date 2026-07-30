import {
    getActiveSillyTavernBindings,
    sanitizeText,
    summarizeSillyTavernBindings,
} from './protocol.js';

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
            if (!health?.ok || health.stopping || health.authRequired) {
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
            generatedText: sanitizeText(data.generatedText || '', 4000),
            diagnostics: {
                unchanged: Boolean(data.unchanged),
                elapsedMs: Number(data.elapsedMs || 0),
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
export const VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION = 'galgame.visual-projection-entity-hints.v1';
export const VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION = 'galgame.visual-projection-shared.v1';

export function normalizeOriginalVisibleChatMessages(chat, { maxTextLength = 4000 } = {}) {
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
            text,
            sentAt: sanitizeText(message.send_date || '', 120),
        });
    }
    return messages;
}

export function createVisualProjectionEntityHints(message) {
    const entities = [];
    const text = sanitizeText(message?.text || '', 4000);
    const speaker = sanitizeText(message?.speaker || '', 160);
    if (message?.role === 'character' && speaker) {
        entities.push({
            entityKeySeed: speaker,
            entityType: 'character',
            displayLabel: speaker.slice(0, 80),
            visibleAttributes: [{
                code: 'character-explicit-name',
                value: speaker.slice(0, 120),
                confidenceBand: 'explicit',
            }],
            confidenceBand: 'explicit',
        });
    }
    if (text) {
        entities.push({
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
    const source = sanitizeText(value, 4000)
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

    let lastSpeaker = role === 'player' ? '你' : fallbackName;
    return displayText
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, index) => {
            const segment = classifyVisualNovelSegment(paragraph, {
                fallbackSpeaker: fallbackName,
                lastSpeaker,
                role,
            });
            if (segment.speaker && segment.type !== 'narration') {
                lastSpeaker = segment.speaker;
            }
            return {
                index,
                ...segment,
            };
        });
}

function classifyVisualNovelSegment(text, { fallbackSpeaker, lastSpeaker, role }) {
    if (role === 'player') {
        return {
            type: 'player',
            speaker: '你',
            text,
        };
    }

    const stageCue = text.match(/^[—-]{1,2}\s*([A-Za-z][\w-]{0,39}|[\p{Script=Han}ぁ-んァ-ヶー]{1,12})(?:\s+|[：:，,。！？!?]|$)/u);
    if (stageCue) {
        return {
            type: 'stage',
            speaker: sanitizeText(stageCue[1], 80),
            text,
        };
    }

    const namedDialogue = text.match(/^([A-Za-z][\w-]{0,39}|[\p{Script=Han}ぁ-んァ-ヶー]{1,12})[：:]\s*(.+)$/u);
    if (namedDialogue && namedDialogue[2]?.trim()) {
        return {
            type: 'dialogue',
            speaker: sanitizeText(namedDialogue[1], 80),
            text: namedDialogue[2].trim(),
        };
    }

    if (/^[“"「『].+[”"」』]$/su.test(text) || /^[“"「『]/u.test(text)) {
        return {
            type: 'dialogue',
            speaker: sanitizeText(lastSpeaker || fallbackSpeaker || '角色', 80),
            text,
        };
    }

    return {
        type: 'narration',
        speaker: '旁白',
        text,
    };
}

function stripHiddenVisualNovelDisplayBlocks(text) {
    return text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\s*(?:think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think|thinking|thought|reasoning)\s*>/gi, '')
        .replace(/\[(?:think|thinking|thought|reasoning)\][\s\S]*?\[\/(?:think|thinking|thought|reasoning)\]/gi, '')
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

    return next;
}

function addVisualNovelParagraphBreaks(text) {
    return text
        .replace(/[ \t]+/g, ' ')
        .replace(/([。！？!?])\s+(?=[“"「『])/g, '$1\n\n')
        .replace(/([。！？!?])\s+(?=—)/g, '$1\n\n')
        .replace(/([”"」』])\s+(?=[^\n])/g, '$1\n\n')
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
    const safeText = sanitizeText(text, 4000).replace(/\r\n?/g, '\n');
    const lines = safeText.split('\n');
    const headed = extractHeadedActions(lines, maxActions);
    if (headed.suggestedActions.length) {
        return headed;
    }
    return extractTrailingNumberedActions(lines, maxActions);
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
        ["'", "'"],
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
