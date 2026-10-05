import {
    getActiveSillyTavernBindings,
    sanitizeText,
    summarizeSillyTavernBindings,
} from './protocol.js?v=auto-e34cf3849e79';

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
        .replace(/^[\s>*#`*_~\[\]()（）【】「」『』]+|[\s>*#`*_~\[\]()（）【】「」『』]+$/gu, '')
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
    // `addVisualNovelParagraphBreaks` may put a connective such as “然后” in
    // its own paragraph after a closing quote. Join it back to the following
    // strong name/action/quote clause so the connective stays with the prior
    // visible prose instead of becoming a blank speaker row.
    const connectorMergedText = knownSegmentedText.replace(
        /\n{2,}(?=(?:然后|接着|随后|这时|此时)\s*(?:[A-Z][A-Za-z0-9_-]{1,39}|[\p{Script=Han}ぁ-んァ-ヶー]{2,8}).{1,64}?\s*[：:]\s*[“"「『])/gu,
        '',
    );
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

const NARRATIVE_DIALOGUE_ACTION_PATTERN = /(?:哈哈大笑|咯咯笑|大笑|狂笑|冷笑|苦笑|轻笑|奸笑|咆哮|怒吼|挥舞|摸了摸|舔了舔|舔舐|笑着|喊道|说道|问道|答道|高举|猛地|说|道|问|答|喊|叫|反对|同意|拒绝|摇头|点头|举手|嘶声|低声|高声|大声|小声|笑|哭|怒|冷|轻|急|颤|哆嗦|结巴|打断|回应|坚持|承认|警告|威胁|提醒|解释|嘟囔|嘀咕|喃喃|立即|立刻|马上|整理|露出|握紧|检查|拿起|收起|接过|递给|转身|站起|走向|靠近|看向|望向|盯着|抬起|低下|扬起|举起|拍了拍|掏出|穿戴|取出|放下|推开|拉开|松了口气|眼睛一亮|插话|竖起大拇指|翻了个白眼|咧嘴笑|压低声音|满意地点头|转头看向|say|said|says|ask|asked|reply|replied|object|objected|agree|agreed|shout|shouted|yell|yelled|whisper|whispered|mutter|muttered|stammer|raise|raised|interrupt|warn|warning|insist|insisted|answer|answered|immediately|quickly|softly|loudly)/iu;

function hasNarrativeDialogueVerb(value) {
    const normalized = String(value || '').trim();
    const match = normalized.match(NARRATIVE_DIALOGUE_ACTION_PATTERN);
    return Boolean(match && match.index === 0);
}

function isGenericCharacterNoun(value) {
    return /^(?:守卫|士兵|店主|老板|商人|法师|战士|骑士|弓手|盗贼|地精|哥布林|侍者|老人|女人|男人|女孩|男孩|少女|少年|怪物|敌人|队长|首领|教士|牧师|guard|soldier|shopkeeper|merchant|wizard|mage|warrior|knight|archer|rogue|goblin|waiter|old man|woman|man|girl|boy|monster|enemy|captain|leader|priest)$/iu.test(String(value || '').trim());
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
        .replace(/^[\s>*#`*_~\[\]()（）【】「」『』]+|[\s>*#`*_~\[\]()（）【】「」『』]+$/gu, '')
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
    return Boolean(lastVisibleCharacter) && !/[。！？!?\.．…」』”）)\]}*>*`~]$/u.test(lastVisibleCharacter);
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
