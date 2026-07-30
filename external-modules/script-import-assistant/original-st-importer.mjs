import { createHash } from 'node:crypto';

import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../../frontend/shared/src/sillytavern-adapter.js';
import {
    ARC_BINDING_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    validateScenarioManifest,
} from '../../frontend/shared/src/protocol.js';

const RESOURCE_PROTOCOL_VERSION = 'galgame.script-import-resource.v1';
const CONFIRM_PROTOCOL_VERSION = 'galgame.script-import-confirm-response.v1';
const DEFAULT_ST_BASE_URL = 'http://127.0.0.1:8001';

// Static audit guard: this module is import-only and writes resource bodies only into original ST APIs.
const SCRIPT_IMPORT_ORIGINAL_RESOURCE_BODY_GUARD = Object.freeze({
    importOnlyOriginalSillyTavernResourceWriter: true,
    manifestReferencesOnly: true,
    playerRuntimeCallable: false,
    conflictPolicy: 'hash-source-conflict-refuse-overwrite',
});

export class ScriptImportResourceConflictError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ScriptImportResourceConflictError';
        this.code = 'SCRIPT_IMPORT_RESOURCE_CONFLICT';
        this.details = sanitizeConflictDetails(details);
    }
}

export class ScriptImportUnavailableError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'ScriptImportUnavailableError';
        this.code = 'SCRIPT_IMPORT_ORIGINAL_ST_UNAVAILABLE';
        this.details = sanitizeConflictDetails(details);
    }
}

export function createOriginalSillyTavernImporter({
    baseUrl = process.env.GALGAME_SCRIPT_ASSISTANT_ST_BASE_URL
        || process.env.GALGAME_SILLYTAVERN_BASE_URL
        || DEFAULT_ST_BASE_URL,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
} = {}) {
    const fetchWithCookies = createCookieFetch(fetchImpl);
    const client = new SillyTavernHttpClient({
        baseUrl: normalizeBaseUrl(baseUrl),
        fetchImpl: fetchWithCookies,
    });
    const chatBridge = new SillyTavernOriginalChatBridge({
        baseUrl: normalizeBaseUrl(baseUrl),
        fetchImpl: fetchWithCookies,
        now,
    });

    return {
        mode: 'sillytavern-original-resource-importer',
        async confirmDraft(record) {
            return importDraftToOriginalSillyTavern({
                record,
                client,
                chatBridge,
                fetchWithCookies,
                baseUrl: normalizeBaseUrl(baseUrl),
                now,
            });
        },
    };
}

export async function importDraftToOriginalSillyTavern({
    record,
    client,
    chatBridge,
    fetchWithCookies,
    baseUrl = DEFAULT_ST_BASE_URL,
    now = () => new Date(),
}) {
    if (!record?.draft) {
        throw new ScriptImportUnavailableError('SCRIPT_IMPORT_RECORD_INVALID');
    }
    const resourcePackage = buildOriginalResourcePackage(record, { now });
    const actions = [];

    actions.push(await ensureWorldBook({
        resourcePackage,
        client,
    }));
    actions.push(await ensureCharacter({
        resourcePackage,
        client,
        fetchWithCookies,
        baseUrl,
    }));
    actions.push(await ensureChatSeed({
        resourcePackage,
        chatBridge,
    }));

    const readback = await readBackOriginalResources({
        resourcePackage,
        client,
        chatBridge,
    });
    const manifest = buildReferencesOnlyManifest(resourcePackage, { now });
    const validation = validateScenarioManifest(manifest);
    if (!validation.valid) {
        throw new ScriptImportUnavailableError('SCRIPT_IMPORT_MANIFEST_INVALID', {
            errors: validation.errors,
        });
    }
    assertManifestReferencesOnly(manifest);

    return {
        ok: true,
        protocolVersion: CONFIRM_PROTOCOL_VERSION,
        status: 'ready-for-publish',
        manifest,
        validation: {
            valid: true,
            warnings: validation.warnings,
        },
        importResult: {
            protocolVersion: 'galgame.script-import-result.v1',
            mode: 'original-sillytavern-api',
            resourceProtocolVersion: RESOURCE_PROTOCOL_VERSION,
            sourceDigest: resourcePackage.sourceDigest,
            references: resourcePackage.references,
            actions,
            readback,
            safeguards: {
                ...SCRIPT_IMPORT_ORIGINAL_RESOURCE_BODY_GUARD,
                presetWritten: false,
                promptContextCopiedToManifest: false,
                playerManifestBodyWritten: false,
            },
        },
    };
}

export async function diagnoseOriginalResourceReadback({
    resourcePackage,
    client,
    chatBridge,
}) {
    const { characterRef, worldBookRef, chatSeedId } = resourcePackage.references;
    const character = await client.requestJson('/api/characters/get', {
        method: 'POST',
        body: { avatar_url: characterRef.avatar },
    });
    const worldBook = await client.requestJson('/api/worldinfo/get', {
        method: 'POST',
        body: { name: worldBookRef.name },
    });
    const rawChat = await chatBridge.getCharacterChat({
        avatar: characterRef.avatar,
        fileName: chatSeedId,
    });
    const characterExpected = canonicalCharacterResource(resourcePackage.resources.character);
    const characterActual = canonicalCharacterResource(character);
    const worldBookExpected = canonicalWorldBookResource(resourcePackage.resources.worldBook);
    const worldBookActual = canonicalWorldBookResource(worldBook);
    const chatSeedExpected = canonicalChatSeedResource(resourcePackage.resources.chatSeed);
    const chatSeedActual = canonicalChatSeedResource(rawChat);

    return {
        character: buildCanonicalDiagnostic({
            kind: 'character',
            expected: characterExpected,
            actual: characterActual,
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedHash: resourcePackage.resourceHashes.character,
            metadata: extractImportMetadata(character, 'character'),
        }),
        worldBook: buildCanonicalDiagnostic({
            kind: 'worldbook',
            expected: worldBookExpected,
            actual: worldBookActual,
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedHash: resourcePackage.resourceHashes.worldBook,
            metadata: extractImportMetadata(worldBook, 'worldbook'),
        }),
        chatSeed: buildCanonicalDiagnostic({
            kind: 'chat-seed',
            expected: chatSeedExpected,
            actual: chatSeedActual,
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedHash: resourcePackage.resourceHashes.chatSeed,
            metadata: extractImportMetadata(rawChat, 'chat-seed'),
        }),
    };
}

export function buildOriginalResourcePackage(record, { now = () => new Date() } = {}) {
    const draft = record.draft || {};
    const plan = draft.importPlan || {};
    const files = Array.isArray(record.files) ? record.files : [];
    const sourceDigest = sanitizeHash(record.sourceDigest || draft.sourceDigest || hashSourceFiles(files));
    const title = sanitizeText(draft.summary?.title || '未命名故事', 120);
    const slug = createSlug(`${title}-${sourceDigest.slice(0, 8)}`);
    const characterName = sanitizeResourceName(plan.characterName || `Galgame_AIImport_${slug}_Director`);
    const characterAvatar = sanitizeFileName(plan.characterAvatar || `${createSlug(characterName)}.png`);
    const worldBookName = sanitizeResourceName(plan.worldBookName || `Galgame_AIImport_${slug}_World`);
    const chatSeedId = sanitizeChatSeedId(plan.chatSeedId || `galgame-aiimport-${slug}-seed`);
    const mainCharacters = normalizeCharacterNames(draft.summary?.mainCharacters);
    const openingText = buildOpeningText({
        title,
        files,
        characterName,
        mainCharacters,
    });
    const worldBookEntries = buildWorldBookEntries({
        title,
        files,
        mainCharacters,
    });
    const sourceFiles = files.map((file) => sanitizeReference(file.name, 180)).filter(Boolean);
    const references = {
        characterRef: {
            name: characterName,
            avatar: characterAvatar,
        },
        worldBookRef: {
            name: worldBookName,
            mode: 'manual',
            weight: 100,
        },
        chatSeedId,
    };
    const provisionalMetadata = {
        schemaVersion: RESOURCE_PROTOCOL_VERSION,
        kind: '',
        draftId: sanitizeReference(draft.draftId, 160),
        revision: Number(draft.revision || 1),
        sourceDigest,
        resourceHash: '',
        sourceFiles,
        importedAt: now().toISOString(),
    };
    const provisionalWorldBook = buildWorldBookBody({
        name: worldBookName,
        title,
        entries: worldBookEntries,
        metadata: { ...provisionalMetadata, kind: 'worldbook' },
    });
    const provisionalResources = {
        character: buildCharacterBody({
            characterName,
            characterAvatar,
            worldBookName,
            title,
            mainCharacters,
            openingText,
            metadata: { ...provisionalMetadata, kind: 'character' },
            embeddedCharacterBook: convertWorldBookToCharacterBook(provisionalWorldBook),
        }),
        worldBook: provisionalWorldBook,
        chatSeed: buildChatSeed({
            characterName,
            worldBookName,
            openingText,
            metadata: { ...provisionalMetadata, kind: 'chat-seed' },
        }),
    };
    const resourceHashes = {
        character: computeCharacterResourceHash(provisionalResources.character),
        worldBook: computeWorldBookResourceHash(provisionalResources.worldBook),
        chatSeed: computeChatSeedResourceHash(provisionalResources.chatSeed),
    };
    const finalWorldBook = buildWorldBookBody({
        name: worldBookName,
        title,
        entries: worldBookEntries,
        metadata: buildImportMetadata({
            kind: 'worldbook',
            draft,
            sourceDigest,
            resourceHash: resourceHashes.worldBook,
            sourceFiles,
            now,
        }),
    });
    const resources = {
        character: buildCharacterBody({
            characterName,
            characterAvatar,
            worldBookName,
            title,
            mainCharacters,
            openingText,
            metadata: buildImportMetadata({
                kind: 'character',
                draft,
                sourceDigest,
                resourceHash: resourceHashes.character,
                sourceFiles,
                now,
            }),
            embeddedCharacterBook: convertWorldBookToCharacterBook(finalWorldBook),
        }),
        worldBook: finalWorldBook,
        chatSeed: buildChatSeed({
            characterName,
            worldBookName,
            openingText,
            metadata: buildImportMetadata({
                kind: 'chat-seed',
                draft,
                sourceDigest,
                resourceHash: resourceHashes.chatSeed,
                sourceFiles,
                now,
            }),
        }),
    };

    return {
        protocolVersion: RESOURCE_PROTOCOL_VERSION,
        draftId: sanitizeReference(draft.draftId, 160),
        revision: Number(draft.revision || 1),
        title,
        scenarioId: `galgame-aiimport-${slug}`,
        scenarioVersion: `1.0.0-${sourceDigest.slice(0, 8)}`,
        arcId: 'main',
        sourceDigest,
        sourceFiles,
        references,
        resourceHashes,
        resources,
    };
}

async function ensureWorldBook({
    resourcePackage,
    client,
}) {
    const name = resourcePackage.references.worldBookRef.name;
    const list = await client.requestJson('/api/worldinfo/list', {
        method: 'POST',
        body: {},
    });
    const exists = arrayFromResourceMap(list).some((item) => (
        item?.name === name || item?.file_id === name || item?.filename === name || item?.id === name
    ));
    if (exists) {
        const world = await client.requestJson('/api/worldinfo/get', {
            method: 'POST',
            body: { name },
        });
        assertExistingResourceMatches({
            kind: 'worldbook',
            reference: name,
            metadata: extractImportMetadata(world, 'worldbook'),
            expectedCanonical: canonicalWorldBookResource(resourcePackage.resources.worldBook),
            actualCanonical: canonicalWorldBookResource(world),
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedResourceHash: resourcePackage.resourceHashes.worldBook,
        });
        return {
            kind: 'worldbook',
            reference: name,
            action: 'skipped-existing-identical',
            metadataHashMatches: extractImportMetadata(world, 'worldbook')?.resourceHash === resourcePackage.resourceHashes.worldBook,
        };
    }

    await client.requestJson('/api/worldinfo/edit', {
        method: 'POST',
        body: {
            name,
            data: resourcePackage.resources.worldBook,
        },
    });

    return {
        kind: 'worldbook',
        reference: name,
        action: 'created',
    };
}

async function ensureCharacter({
    resourcePackage,
    client,
    fetchWithCookies,
    baseUrl,
}) {
    const { name, avatar } = resourcePackage.references.characterRef;
    const characters = await client.requestJson('/api/characters/all', {
        method: 'POST',
        body: {},
    });
    const existing = arrayFromResourceMap(characters).find((character) => (
        character?.avatar === avatar
        || character?.avatar_url === avatar
        || character?.filename === avatar
        || character?.file_name === avatar
        || character?.name === name
        || character?.id === name
    ));

    if (existing) {
        const targetAvatar = existing.avatar || existing.avatar_url || existing.filename || existing.file_name || avatar;
        const detail = await client.requestJson('/api/characters/get', {
            method: 'POST',
            body: { avatar_url: targetAvatar },
        });
        assertExistingResourceMatches({
            kind: 'character',
            reference: `${name}/${targetAvatar}`,
            metadata: extractImportMetadata(detail, 'character'),
            expectedCanonical: canonicalCharacterResource(resourcePackage.resources.character),
            actualCanonical: canonicalCharacterResource(detail),
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedResourceHash: resourcePackage.resourceHashes.character,
        });
        return {
            kind: 'character',
            reference: { name, avatar: targetAvatar },
            action: 'skipped-existing-identical',
            metadataHashMatches: extractImportMetadata(detail, 'character')?.resourceHash === resourcePackage.resourceHashes.character,
        };
    }

    await client.requestJson('/api/characters/create', {
        method: 'POST',
        body: {
            ...resourcePackage.resources.character,
            file_name: avatar.replace(/\.png$/i, ''),
        },
    });

    await editCharacterViaOriginalApi({
        body: resourcePackage.resources.character,
        avatar,
        fetchWithCookies,
        baseUrl,
        client,
    });

    return {
        kind: 'character',
        reference: { name, avatar },
        action: 'created',
    };
}

async function ensureChatSeed({
    resourcePackage,
    chatBridge,
}) {
    const { characterRef, chatSeedId } = resourcePackage.references;
    const chats = await chatBridge.listCharacterChats({ avatar: characterRef.avatar });
    const exists = chats.some((chat) => normalizeChatFileId(chat.fileId || chat.fileName) === chatSeedId);
    if (exists) {
        const rawChat = await chatBridge.getCharacterChat({
            avatar: characterRef.avatar,
            fileName: chatSeedId,
        });
        assertExistingResourceMatches({
            kind: 'chat-seed',
            reference: `${characterRef.avatar}/${chatSeedId}`,
            metadata: extractImportMetadata(rawChat, 'chat-seed'),
            expectedCanonical: canonicalChatSeedResource(resourcePackage.resources.chatSeed),
            actualCanonical: canonicalChatSeedResource(rawChat),
            expectedSourceDigest: resourcePackage.sourceDigest,
            expectedResourceHash: resourcePackage.resourceHashes.chatSeed,
        });
        return {
            kind: 'chat-seed',
            reference: chatSeedId,
            action: 'skipped-existing-identical',
            metadataHashMatches: extractImportMetadata(rawChat, 'chat-seed')?.resourceHash === resourcePackage.resourceHashes.chatSeed,
        };
    }

    await chatBridge.saveCharacterChat({
        avatar: characterRef.avatar,
        characterName: characterRef.name,
        fileName: chatSeedId,
        chat: resourcePackage.resources.chatSeed,
    });

    return {
        kind: 'chat-seed',
        reference: chatSeedId,
        action: 'created',
    };
}

async function readBackOriginalResources({
    resourcePackage,
    client,
    chatBridge,
}) {
    const { characterRef, worldBookRef, chatSeedId } = resourcePackage.references;
    const character = await client.requestJson('/api/characters/get', {
        method: 'POST',
        body: { avatar_url: characterRef.avatar },
    });
    const worldBook = await client.requestJson('/api/worldinfo/get', {
        method: 'POST',
        body: { name: worldBookRef.name },
    });
    const rawChat = await chatBridge.getCharacterChat({
        avatar: characterRef.avatar,
        fileName: chatSeedId,
    });
    assertExistingResourceMatches({
        kind: 'character',
        reference: characterRef.avatar,
        metadata: extractImportMetadata(character, 'character'),
        expectedCanonical: canonicalCharacterResource(resourcePackage.resources.character),
        actualCanonical: canonicalCharacterResource(character),
        expectedSourceDigest: resourcePackage.sourceDigest,
        expectedResourceHash: resourcePackage.resourceHashes.character,
    });
    assertExistingResourceMatches({
        kind: 'worldbook',
        reference: worldBookRef.name,
        metadata: extractImportMetadata(worldBook, 'worldbook'),
        expectedCanonical: canonicalWorldBookResource(resourcePackage.resources.worldBook),
        actualCanonical: canonicalWorldBookResource(worldBook),
        expectedSourceDigest: resourcePackage.sourceDigest,
        expectedResourceHash: resourcePackage.resourceHashes.worldBook,
    });
    assertExistingResourceMatches({
        kind: 'chat-seed',
        reference: chatSeedId,
        metadata: extractImportMetadata(rawChat, 'chat-seed'),
        expectedCanonical: canonicalChatSeedResource(resourcePackage.resources.chatSeed),
        actualCanonical: canonicalChatSeedResource(rawChat),
        expectedSourceDigest: resourcePackage.sourceDigest,
        expectedResourceHash: resourcePackage.resourceHashes.chatSeed,
    });

    return {
        character: {
            ok: true,
            name: characterRef.name,
            avatar: characterRef.avatar,
            sourceDigest: resourcePackage.sourceDigest,
            resourceHash: resourcePackage.resourceHashes.character,
        },
        worldBook: {
            ok: true,
            name: worldBookRef.name,
            sourceDigest: resourcePackage.sourceDigest,
            resourceHash: resourcePackage.resourceHashes.worldBook,
        },
        chatSeed: {
            ok: true,
            chatSeedId,
            visibleMessageCount: getVisibleChatMessages(rawChat).length,
            chatMetadataWorldInfo: rawChat[0]?.chat_metadata?.world_info || '',
            sourceDigest: resourcePackage.sourceDigest,
            resourceHash: resourcePackage.resourceHashes.chatSeed,
        },
    };
}

async function editCharacterViaOriginalApi({
    body,
    avatar,
    fetchWithCookies,
    baseUrl,
    client,
}) {
    const form = new FormData();
    form.set('avatar_url', avatar);
    for (const [key, value] of Object.entries(body)) {
        if (key === 'file_name') {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                form.append(key, String(item ?? ''));
            }
        } else {
            form.set(key, String(value ?? ''));
        }
    }
    const token = await client.getCsrfToken();
    const response = await fetchWithCookies(`${normalizeBaseUrl(baseUrl)}/api/characters/edit`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': token,
        },
        body: form,
        cache: 'no-cache',
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new ScriptImportUnavailableError(`SCRIPT_IMPORT_CHARACTER_EDIT_FAILED_${response.status}`, {
            status: response.status,
            message: text.slice(0, 120),
        });
    }
}

function buildCharacterBody({
    characterName,
    characterAvatar,
    worldBookName,
    title,
    mainCharacters,
    openingText,
    metadata,
    embeddedCharacterBook,
}) {
    const characterData = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name: characterName,
            description: `导入故事《${title}》的原版 SillyTavern 入口角色。`,
            personality: '作为故事主持人，承接玩家输入，并依据已绑定世界书与聊天历史推进场景。',
            scenario: buildScenarioSummary(title, mainCharacters),
            first_mes: openingText,
            mes_example: '',
            creator_notes: `Created by Galgame script import assistant. sourceDigest=${metadata.sourceDigest}`,
            system_prompt: '',
            post_history_instructions: '',
            alternate_greetings: [],
            tags: ['Galgame_AIImport'],
            creator: 'Galgame script import assistant',
            character_version: metadata.resourceHash.slice(0, 12),
            extensions: {
                world: worldBookName,
                galgameScriptImport: metadata,
            },
        },
    };
    if (embeddedCharacterBook) {
        characterData.data.character_book = embeddedCharacterBook;
    }

    return {
        ch_name: characterName,
        description: characterData.data.description,
        personality: characterData.data.personality,
        scenario: characterData.data.scenario,
        first_mes: openingText,
        mes_example: '',
        creator_notes: characterData.data.creator_notes,
        system_prompt: '',
        post_history_instructions: '',
        creator: characterData.data.creator,
        character_version: characterData.data.character_version,
        tags: characterData.data.tags.join(','),
        talkativeness: '0.7',
        fav: 'false',
        world: worldBookName,
        depth_prompt_prompt: '',
        depth_prompt_depth: '4',
        depth_prompt_role: 'system',
        alternate_greetings: [],
        extensions: JSON.stringify(characterData.data.extensions),
        json_data: JSON.stringify(characterData),
        avatar_url: characterAvatar,
    };
}

function buildWorldBookBody({
    name,
    title,
    entries,
    metadata,
}) {
    const worldEntries = {};
    entries.forEach((entry, index) => {
        worldEntries[String(index)] = {
            uid: index,
            key: entry.key,
            keysecondary: [],
            comment: entry.comment,
            content: entry.content,
            constant: index === 0,
            vectorized: false,
            selective: index !== 0,
            selectiveLogic: 0,
            addMemo: true,
            order: 100 + index,
            position: 0,
            disable: false,
            ignoreBudget: false,
            excludeRecursion: false,
            preventRecursion: false,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchScenario: false,
            matchCreatorNotes: false,
            delayUntilRecursion: 0,
            probability: 100,
            useProbability: false,
            depth: 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            triggers: [],
        };
    });

    return {
        name,
        description: `Imported script world for ${title}.`,
        entries: worldEntries,
        extensions: {
            galgameScriptImport: metadata,
        },
    };
}

function convertWorldBookToCharacterBook(worldBook) {
    const entries = worldBook?.entries && typeof worldBook.entries === 'object' ? worldBook.entries : {};
    return {
        name: sanitizeText(worldBook?.name || '', 200),
        entries: Object.values(entries)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry, index) => ({
                id: normalizeNumber(entry.uid, index),
                keys: normalizeArrayText(entry.key),
                secondary_keys: normalizeArrayText(entry.keysecondary),
                comment: sanitizeText(entry.comment || '', 500),
                content: sanitizeMultilineText(entry.content || '', 120_000),
                constant: Boolean(entry.constant),
                selective: Boolean(entry.selective),
                insertion_order: normalizeNumber(entry.order, 0),
                enabled: !Boolean(entry.disable),
                position: Number(entry.position) === 0 ? 'before_char' : 'after_char',
                use_regex: true,
                extensions: normalizeEmbeddedBookEntryExtensions(entry, index),
            })),
    };
}

function normalizeEmbeddedBookEntryExtensions(entry, index) {
    return {
        ...(entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {}),
        position: normalizeNumber(entry.position, 0),
        exclude_recursion: Boolean(entry.excludeRecursion),
        display_index: entry.displayIndex,
        probability: normalizeNumber(entry.probability, null),
        useProbability: Boolean(entry.useProbability),
        depth: normalizeNumber(entry.depth, 4),
        selectiveLogic: normalizeNumber(entry.selectiveLogic, 0),
        outlet_name: sanitizeText(entry.outletName || '', 200),
        group: sanitizeText(entry.group || '', 200),
        group_override: Boolean(entry.groupOverride),
        group_weight: normalizeNumber(entry.groupWeight, null),
        prevent_recursion: Boolean(entry.preventRecursion),
        delay_until_recursion: firstDefined(entry.delayUntilRecursion, false),
        scan_depth: normalizeNumber(entry.scanDepth, null),
        match_whole_words: firstDefined(entry.matchWholeWords, null),
        use_group_scoring: firstDefined(entry.useGroupScoring, false),
        case_sensitive: firstDefined(entry.caseSensitive, null),
        automation_id: sanitizeText(entry.automationId || '', 200),
        role: normalizeNumber(entry.role, 0),
        vectorized: Boolean(entry.vectorized),
        sticky: normalizeNumber(entry.sticky, null),
        cooldown: normalizeNumber(entry.cooldown, null),
        delay: normalizeNumber(entry.delay, null),
        match_persona_description: Boolean(entry.matchPersonaDescription),
        match_character_description: Boolean(entry.matchCharacterDescription),
        match_character_personality: Boolean(entry.matchCharacterPersonality),
        match_character_depth_prompt: Boolean(entry.matchCharacterDepthPrompt),
        match_scenario: Boolean(entry.matchScenario),
        match_creator_notes: Boolean(entry.matchCreatorNotes),
        triggers: normalizeArrayText(entry.triggers),
        ignore_budget: Boolean(entry.ignoreBudget),
    };
}

function buildChatSeed({
    characterName,
    worldBookName,
    openingText,
    metadata,
}) {
    return [
        {
            chat_metadata: {
                galgame_script_import: metadata,
                world_info: worldBookName,
                runtime_application_source: 'sillytavern-chat-metadata-world_info',
            },
            user_name: 'Player',
            character_name: characterName,
        },
        {
            name: characterName,
            is_user: false,
            is_system: false,
            send_date: '2026-07-26T00:00:00.000Z',
            mes: openingText,
            extra: {},
        },
    ];
}

function buildReferencesOnlyManifest(resourcePackage, { now = () => new Date() } = {}) {
    const { characterRef, worldBookRef, chatSeedId } = resourcePackage.references;
    const bindings = {
        target: {
            mode: 'single-character',
            characterRef,
            chatSeedId,
        },
        worldBookRefs: [worldBookRef.name],
        characters: [
            {
                id: characterRef.name,
                role: 'narrator',
                avatar: characterRef.avatar,
            },
        ],
        worldBooks: [
            worldBookRef,
        ],
        chatSeedId,
    };
    const createdAt = now().toISOString();

    return {
        schemaVersion: PROTOCOL_VERSION,
        id: resourcePackage.scenarioId,
        version: resourcePackage.scenarioVersion,
        title: resourcePackage.title,
        author: '本地导入',
        locale: 'zh-CN',
        contentRating: 'mature',
        saveCompatibility: 'sillytavern-live-1',
        minimumPlayerVersion: '1.0.0',
        story: {
            mode: 'sillytavern-live',
            nodes: {},
        },
        sillyTavernBindings: bindings,
        defaultArcId: resourcePackage.arcId,
        arcs: [
            {
                schemaVersion: ARC_BINDING_PROTOCOL_VERSION,
                arcBindingId: `${resourcePackage.scenarioId}:${resourcePackage.scenarioVersion}:${resourcePackage.arcId}:v1`,
                scenarioId: resourcePackage.scenarioId,
                scenarioVersion: resourcePackage.scenarioVersion,
                arcId: resourcePackage.arcId,
                arcVersion: '1.0.0',
                title: '开始',
                order: 1,
                status: 'draft',
                sillyTavernBindings: bindings,
                presentationProfileId: 'default',
                mediaPolicyId: 'default',
                contentRating: 'mature',
                createdAt,
            },
        ],
        presentation: {
            titleBackgroundAsset: 'title_scene',
            defaultBackgroundAsset: 'default_stage',
            titleTone: 'quiet',
        },
        resourceBindings: {
            assets: {},
        },
        metadata: {
            importedBy: 'script-import-assistant',
            sourceDigest: resourcePackage.sourceDigest,
            importProtocolVersion: RESOURCE_PROTOCOL_VERSION,
        },
        createdAt,
        updatedAt: createdAt,
    };
}

function assertExistingResourceMatches({
    kind,
    reference,
    metadata,
    expectedCanonical,
    actualCanonical,
    expectedSourceDigest,
    expectedResourceHash,
}) {
    const actualResourceHash = hashJson(actualCanonical);
    const unsupportedFindings = collectUnsupportedCanonicalFindings({
        expected: expectedCanonical,
        actual: actualCanonical,
    });
    if (unsupportedFindings.length) {
        throw new ScriptImportResourceConflictError(`SCRIPT_IMPORT_${kind.toUpperCase().replace(/-/g, '_')}_CONFLICT`, {
            kind,
            reference,
            expectedSourceDigest,
            actualSourceDigest: metadata?.sourceDigest || '',
            expectedResourceHash,
            actualResourceHash: metadata?.resourceHash || '',
            actualBodyHash: actualResourceHash || '',
            unsupportedFindings,
            fieldDiffs: diffCanonicalValue(expectedCanonical, actualCanonical).slice(0, 80),
        });
    }
    if (
        metadata?.schemaVersion === RESOURCE_PROTOCOL_VERSION
        && metadata.kind === kind
        && metadata.sourceDigest === expectedSourceDigest
        && actualResourceHash === expectedResourceHash
    ) {
        return;
    }
    throw new ScriptImportResourceConflictError(`SCRIPT_IMPORT_${kind.toUpperCase().replace(/-/g, '_')}_CONFLICT`, {
        kind,
        reference,
        expectedSourceDigest,
        actualSourceDigest: metadata?.sourceDigest || '',
        expectedResourceHash,
        actualResourceHash: metadata?.resourceHash || '',
        actualBodyHash: actualResourceHash || '',
        fieldDiffs: diffCanonicalValue(expectedCanonical, actualCanonical).slice(0, 80),
    });
}

function buildCanonicalDiagnostic({
    kind,
    expected,
    actual,
    expectedSourceDigest,
    expectedHash,
    metadata,
}) {
    const actualHash = hashJson(actual);
    return {
        kind,
        sourceDigestMatches: metadata?.sourceDigest === expectedSourceDigest,
        metadataHash: metadata?.resourceHash || '',
        expectedHash,
        actualHash,
        canonicalMatches: actualHash === expectedHash,
        metadataHashMatches: metadata?.resourceHash === expectedHash,
        unsupportedFindings: collectUnsupportedCanonicalFindings({ expected, actual }).slice(0, 40),
        fieldDiffs: diffCanonicalValue(expected, actual).slice(0, 80),
    };
}

function collectUnsupportedCanonicalFindings({
    expected,
    actual,
}) {
    const findings = [];
    collectUnsupportedCanonicalFields(expected, 'expected', findings);
    collectUnsupportedCanonicalFields(actual, 'actual', findings);
    return findings;
}

function collectUnsupportedCanonicalFields(value, path, findings) {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => collectUnsupportedCanonicalFields(item, `${path}[${index}]`, findings));
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (key.startsWith('unsupported') && Array.isArray(child) && child.length) {
            findings.push({
                path: `${path}.${key}`,
                count: child.length,
                details: child.slice(0, 12),
            });
        }
        collectUnsupportedCanonicalFields(child, `${path}.${key}`, findings);
    }
}

function diffCanonicalValue(expected, actual, prefix = '') {
    if (JSON.stringify(expected) === JSON.stringify(actual)) {
        return [];
    }
    if (
        expected === null
        || actual === null
        || typeof expected !== 'object'
        || typeof actual !== 'object'
        || Array.isArray(expected) !== Array.isArray(actual)
    ) {
        return [{
            path: prefix || '$',
            expected: previewValue(expected),
            actual: previewValue(actual),
        }];
    }
    if (Array.isArray(expected)) {
        const length = Math.max(expected.length, actual.length);
        const diffs = [];
        for (let index = 0; index < length; index += 1) {
            diffs.push(...diffCanonicalValue(expected[index], actual[index], `${prefix}[${index}]`));
        }
        return diffs;
    }
    const keys = uniqueArray([...Object.keys(expected), ...Object.keys(actual)]).sort();
    return keys.flatMap((key) => diffCanonicalValue(expected[key], actual[key], prefix ? `${prefix}.${key}` : key));
}

function previewValue(value) {
    if (typeof value === 'string') {
        return value.length > 160 ? `${value.slice(0, 160)}...` : value;
    }
    if (Array.isArray(value)) {
        return value.slice(0, 8);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value).slice(0, 12);
    }
    return value;
}

function assertManifestReferencesOnly(manifest) {
    const text = JSON.stringify(manifest);
    const forbiddenKeys = [
        '"description"',
        '"personality"',
        '"scenario"',
        '"first_mes"',
        '"mes_example"',
        '"entries"',
        '"content"',
        '"prompt"',
        '"choices"',
        '"lines"',
        '"ending"',
    ];
    const leaked = forbiddenKeys.filter((key) => text.includes(key));
    if (leaked.length) {
        throw new ScriptImportUnavailableError('SCRIPT_IMPORT_MANIFEST_BODY_LEAK', {
            leaked,
        });
    }
}

function extractImportMetadata(value, kind) {
    if (kind === 'chat-seed') {
        return Array.isArray(value) ? value[0]?.chat_metadata?.galgame_script_import || null : null;
    }
    const source = value?.data || value || {};
    const extensions = parseMaybeJson(source.extensions || value?.extensions || {});
    return extensions.galgameScriptImport || null;
}

function computeCharacterResourceHash(value) {
    return hashJson(canonicalCharacterResource(value));
}

function canonicalCharacterResource(value) {
    const formJson = parseMaybeJson(value?.json_data);
    const source = value?.data || formJson?.data || value || {};
    const extensions = parseMaybeJson(source.extensions || value?.extensions || {});
    const depthPrompt = parseMaybeJson(extensions.depth_prompt || source.depth_prompt || {});
    return {
        name: sanitizeText(source.name || source.ch_name || value?.name || '', 200),
        description: sanitizeMultilineText(source.description || value?.description || '', 20_000),
        personality: sanitizeMultilineText(source.personality || value?.personality || '', 20_000),
        scenario: sanitizeMultilineText(source.scenario || value?.scenario || '', 20_000),
        first_mes: sanitizeMultilineText(source.first_mes || value?.first_mes || '', 20_000),
        mes_example: sanitizeMultilineText(source.mes_example || value?.mes_example || '', 20_000),
        creator_notes: sanitizeMultilineText(source.creator_notes || value?.creatorcomment || '', 20_000),
        system_prompt: sanitizeMultilineText(source.system_prompt || '', 20_000),
        post_history_instructions: sanitizeMultilineText(source.post_history_instructions || '', 20_000),
        world: sanitizeText(source.world || extensions.world || '', 200),
        talkativeness: normalizeNumber(firstDefined(source.talkativeness, extensions.talkativeness, value?.talkativeness), null),
        depth_prompt_prompt: sanitizeMultilineText(firstDefined(depthPrompt.prompt, source.depth_prompt_prompt, value?.depth_prompt_prompt, ''), 20_000),
        depth_prompt_depth: normalizeNumber(firstDefined(depthPrompt.depth, source.depth_prompt_depth, value?.depth_prompt_depth), null),
        depth_prompt_role: sanitizeText(firstDefined(depthPrompt.role, source.depth_prompt_role, value?.depth_prompt_role, ''), 80),
        regex_scripts: normalizeRegexScripts(extensions.regex_scripts),
        unsupportedRuntimeExtensions: collectUnsupportedCharacterRuntimeExtensions(extensions),
        embedded_character_book: normalizeEmbeddedCharacterBook(source.character_book),
        alternate_greetings: normalizeAlternateGreetings(source.alternate_greetings),
        creator: sanitizeText(source.creator || '', 200),
        tags: normalizeTags(source.tags || value?.tags),
    };
}

function computeWorldBookResourceHash(value) {
    return hashJson(canonicalWorldBookResource(value));
}

function canonicalWorldBookResource(value) {
    const entries = value?.entries && typeof value.entries === 'object' ? value.entries : {};
    return {
        name: sanitizeText(value?.name || '', 200),
        description: sanitizeMultilineText(value?.description || '', 20_000),
        entries: Object.values(entries)
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                uid: normalizeNumber(entry.uid, 0),
                key: normalizeArrayText(entry.key),
                keysecondary: normalizeArrayText(entry.keysecondary),
                comment: sanitizeText(entry.comment || '', 500),
                content: sanitizeMultilineText(entry.content || '', 120_000),
                constant: normalizeWorldInfoBoolean(entry, 'constant', 'constant', false),
                vectorized: normalizeWorldInfoBoolean(entry, 'vectorized', 'vectorized', false),
                selective: normalizeWorldInfoBoolean(entry, 'selective', 'selective', false),
                selectiveLogic: normalizeWorldInfoNumber(entry, 'selectiveLogic', 'selectiveLogic', 0),
                addMemo: normalizeWorldInfoBoolean(entry, 'addMemo', 'add_memo', false),
                order: normalizeWorldInfoNumber(entry, 'order', 'insertion_order', 0),
                position: normalizeWorldInfoNumber(entry, 'position', 'position', 0),
                disable: normalizeWorldInfoBoolean(entry, 'disable', 'disabled', false),
                enabled: normalizeWorldInfoNullableBoolean(entry, 'enabled', 'enabled'),
                ignoreBudget: normalizeWorldInfoBoolean(entry, 'ignoreBudget', 'ignore_budget', false),
                excludeRecursion: normalizeWorldInfoBoolean(entry, 'excludeRecursion', 'exclude_recursion', false),
                preventRecursion: normalizeWorldInfoBoolean(entry, 'preventRecursion', 'prevent_recursion', false),
                matchPersonaDescription: normalizeWorldInfoBoolean(entry, 'matchPersonaDescription', 'match_persona_description', false),
                matchCharacterDescription: normalizeWorldInfoBoolean(entry, 'matchCharacterDescription', 'match_character_description', false),
                matchCharacterPersonality: normalizeWorldInfoBoolean(entry, 'matchCharacterPersonality', 'match_character_personality', false),
                matchCharacterDepthPrompt: normalizeWorldInfoBoolean(entry, 'matchCharacterDepthPrompt', 'match_character_depth_prompt', false),
                matchScenario: normalizeWorldInfoBoolean(entry, 'matchScenario', 'match_scenario', false),
                matchCreatorNotes: normalizeWorldInfoBoolean(entry, 'matchCreatorNotes', 'match_creator_notes', false),
                delayUntilRecursion: normalizeWorldInfoNumber(entry, 'delayUntilRecursion', 'delay_until_recursion', 0),
                probability: normalizeWorldInfoNumber(entry, 'probability', 'probability', 100),
                useProbability: normalizeWorldInfoBoolean(entry, 'useProbability', 'useProbability', false),
                depth: normalizeWorldInfoNumber(entry, 'depth', 'depth', null),
                outletName: normalizeWorldInfoText(entry, 'outletName', 'outlet_name', 200),
                group: normalizeWorldInfoText(entry, 'group', 'group', 200),
                groupOverride: normalizeWorldInfoBoolean(entry, 'groupOverride', 'group_override', false),
                groupWeight: normalizeWorldInfoNumber(entry, 'groupWeight', 'group_weight', 100),
                scanDepth: normalizeWorldInfoNumber(entry, 'scanDepth', 'scan_depth', null),
                caseSensitive: normalizeWorldInfoNullableBoolean(entry, 'caseSensitive', 'case_sensitive'),
                matchWholeWords: normalizeWorldInfoNullableBoolean(entry, 'matchWholeWords', 'match_whole_words'),
                useGroupScoring: normalizeWorldInfoNullableBoolean(entry, 'useGroupScoring', 'use_group_scoring'),
                automationId: normalizeWorldInfoText(entry, 'automationId', 'automation_id', 200),
                role: normalizeWorldInfoNumber(entry, 'role', 'role', 0),
                sticky: normalizeWorldInfoNumber(entry, 'sticky', 'sticky', null),
                cooldown: normalizeWorldInfoNumber(entry, 'cooldown', 'cooldown', null),
                delay: normalizeWorldInfoNumber(entry, 'delay', 'delay', null),
                triggers: normalizeArrayText(firstDefined(entry.triggers, entry.extensions?.triggers, [])),
                characterFilterNames: normalizeArrayText(entry.characterFilterNames),
                characterFilterTags: normalizeArrayText(entry.characterFilterTags),
                characterFilterExclude: Boolean(entry.characterFilterExclude),
                runtimeExtensionAliases: normalizeKnownWorldInfoRuntimeExtensionAliases(entry),
                unsupportedRuntimeFields: collectUnsupportedWorldInfoRuntimeFields(entry),
            }))
            .sort((left, right) => left.uid - right.uid),
    };
}

function normalizeEmbeddedCharacterBook(characterBook) {
    if (!characterBook) {
        return null;
    }
    if (!characterBook || typeof characterBook !== 'object' || !Array.isArray(characterBook.entries)) {
        return {
            unsupportedCharacterBook: [{
                path: 'character_book',
                reason: 'unsupported-embedded-character-book-shape',
            }],
        };
    }
    return {
        name: sanitizeText(characterBook.name || '', 200),
        entries: characterBook.entries
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry, index) => normalizeEmbeddedCharacterBookEntry(entry, index)),
    };
}

function normalizeEmbeddedCharacterBookEntry(entry, index) {
    const extensions = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    return {
        id: normalizeNumber(firstDefined(entry.id, entry.uid, index), index),
        keys: normalizeArrayText(firstDefined(entry.keys, entry.key, [])),
        secondary_keys: normalizeArrayText(firstDefined(entry.secondary_keys, entry.keysecondary, [])),
        comment: sanitizeText(entry.comment || '', 500),
        content: sanitizeMultilineText(entry.content || '', 120_000),
        constant: Boolean(entry.constant),
        selective: Boolean(entry.selective),
        insertion_order: normalizeNumber(firstDefined(entry.insertion_order, entry.order), 0),
        enabled: firstDefined(entry.enabled, entry.disable === undefined ? true : !entry.disable) === false ? false : true,
        position: sanitizeText(firstDefined(entry.position, extensions.position, ''), 80),
        use_regex: firstDefined(entry.use_regex, true) === false ? false : true,
        extensions: normalizeCharacterBookEntryRuntimeExtensions(extensions),
        unsupportedRuntimeFields: collectUnsupportedCharacterBookEntryRuntimeFields(entry),
    };
}

function normalizeCharacterBookEntryRuntimeExtensions(extensions) {
    return {
        position: normalizeNumber(extensions.position, null),
        exclude_recursion: Boolean(extensions.exclude_recursion),
        display_index: normalizeNumber(extensions.display_index, null),
        probability: normalizeNumber(extensions.probability, null),
        useProbability: firstDefined(extensions.useProbability, null) === null ? null : Boolean(extensions.useProbability),
        depth: normalizeNumber(extensions.depth, null),
        selectiveLogic: normalizeNumber(extensions.selectiveLogic, null),
        outlet_name: sanitizeText(extensions.outlet_name || '', 200),
        group: sanitizeText(extensions.group || '', 200),
        group_override: Boolean(extensions.group_override),
        group_weight: normalizeNumber(extensions.group_weight, null),
        prevent_recursion: Boolean(extensions.prevent_recursion),
        delay_until_recursion: normalizeRuntimeBooleanOrNumber(extensions.delay_until_recursion),
        scan_depth: normalizeNumber(extensions.scan_depth, null),
        match_whole_words: normalizeNullableBooleanValue(extensions.match_whole_words),
        use_group_scoring: normalizeNullableBooleanValue(extensions.use_group_scoring),
        case_sensitive: normalizeNullableBooleanValue(extensions.case_sensitive),
        automation_id: sanitizeText(extensions.automation_id || '', 200),
        role: normalizeNumber(extensions.role, null),
        vectorized: Boolean(extensions.vectorized),
        sticky: normalizeNumber(extensions.sticky, null),
        cooldown: normalizeNumber(extensions.cooldown, null),
        delay: normalizeNumber(extensions.delay, null),
        match_persona_description: Boolean(extensions.match_persona_description),
        match_character_description: Boolean(extensions.match_character_description),
        match_character_personality: Boolean(extensions.match_character_personality),
        match_character_depth_prompt: Boolean(extensions.match_character_depth_prompt),
        match_scenario: Boolean(extensions.match_scenario),
        match_creator_notes: Boolean(extensions.match_creator_notes),
        triggers: normalizeArrayText(extensions.triggers),
        ignore_budget: Boolean(extensions.ignore_budget),
        unsupportedExtensionFields: collectUnsupportedCharacterBookExtensionRuntimeFields(extensions),
    };
}

function computeChatSeedResourceHash(rawChat) {
    return hashJson(canonicalChatSeedResource(rawChat));
}

function canonicalChatSeedResource(rawChat) {
    const chat = Array.isArray(rawChat) ? rawChat : [];
    const metadata = chat[0]?.chat_metadata || {};
    return {
        world_info: sanitizeText(metadata.world_info || '', 200),
        runtime_application_source: sanitizeText(metadata.runtime_application_source || '', 200),
        messages: getVisibleChatMessages(chat).map((message) => ({
            name: sanitizeText(message.name || '', 200),
            is_user: Boolean(message.is_user),
            is_system: Boolean(message.is_system),
            mes: sanitizeMultilineText(message.mes || '', 120_000),
        })),
    };
}

function buildImportMetadata({
    kind,
    draft,
    sourceDigest,
    resourceHash,
    sourceFiles,
    now,
}) {
    return {
        schemaVersion: RESOURCE_PROTOCOL_VERSION,
        kind,
        draftId: sanitizeReference(draft.draftId, 160),
        revision: Number(draft.revision || 1),
        sourceDigest,
        resourceHash,
        sourceFiles,
        importedAt: now().toISOString(),
    };
}

function buildOpeningText({
    title,
    files,
    characterName,
    mainCharacters,
}) {
    const paragraphs = files
        .flatMap((file) => splitParagraphs(file.text))
        .filter((paragraph) => !isMarkdownHeading(paragraph))
        .filter(Boolean)
        .slice(0, 4);
    const sourceOpening = paragraphs.join('\n\n').slice(0, 2400).trim();
    if (sourceOpening) {
        return sourceOpening;
    }
    const castText = mainCharacters.length ? `主要人物：${mainCharacters.join('、')}。` : '';
    return `《${title}》已经载入。${castText}\n\n${characterName} 等待你的第一句话。`;
}

function buildWorldBookEntries({
    title,
    files,
    mainCharacters,
}) {
    const entries = [];
    entries.push({
        key: uniqueArray([title, ...mainCharacters, 'Galgame_AIImport'].filter(Boolean)),
        comment: '导入故事总览',
        content: [
            `故事名称：${title}`,
            mainCharacters.length ? `主要人物：${mainCharacters.join('、')}` : '',
            '这些内容来自管理员确认导入的原版 SillyTavern 世界书资源，不是玩家前端剧情状态。',
        ].filter(Boolean).join('\n'),
    });

    let index = 1;
    for (const file of files) {
        const chunks = chunkTextForWorldBook(file.text, 3200).slice(0, 8);
        for (const chunk of chunks) {
            entries.push({
                key: uniqueArray([
                    title,
                    stripExtension(file.name),
                    ...mainCharacters.slice(0, 4),
                ].filter(Boolean)),
                comment: `导入素材 ${index}: ${sanitizeReference(file.name, 80)}`,
                content: chunk,
            });
            index += 1;
            if (entries.length >= 16) {
                return entries;
            }
        }
    }
    return entries;
}

function buildScenarioSummary(title, mainCharacters) {
    return [
        `故事《${title}》的开局已保存到独立原版聊天。`,
        mainCharacters.length ? `主要人物：${mainCharacters.join('、')}` : '',
        '后续推进由原版 SillyTavern 聊天、世界书和 Generate 语义负责。',
    ].filter(Boolean).join('\n');
}

function normalizeCharacterNames(values) {
    return (Array.isArray(values) ? values : [])
        .map((value) => sanitizeText(value, 80))
        .filter(Boolean)
        .slice(0, 12);
}

function normalizeTags(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeText(item, 80)).filter(Boolean).sort();
    }
    return String(value || '')
        .split(',')
        .map((item) => sanitizeText(item, 80))
        .filter(Boolean)
        .sort();
}

function normalizeArrayText(value) {
    return (Array.isArray(value) ? value : [value])
        .map((item) => sanitizeText(item, 200))
        .filter(Boolean)
        .sort();
}

function normalizeWorldInfoBoolean(entry, camelKey, extensionKey, defaultValue = false) {
    const value = worldInfoEntryValue(entry, camelKey, extensionKey);
    if (value === null || typeof value === 'undefined') {
        return Boolean(defaultValue);
    }
    return Boolean(value);
}

function normalizeWorldInfoNullableBoolean(entry, camelKey, extensionKey) {
    const value = worldInfoEntryValue(entry, camelKey, extensionKey);
    if (value === null || typeof value === 'undefined') {
        return null;
    }
    return Boolean(value);
}

function normalizeWorldInfoNumber(entry, camelKey, extensionKey, defaultValue = 0) {
    return normalizeNumber(worldInfoEntryValue(entry, camelKey, extensionKey), defaultValue);
}

function normalizeWorldInfoText(entry, camelKey, extensionKey, maxLength = 4000) {
    return sanitizeText(worldInfoEntryValue(entry, camelKey, extensionKey) || '', maxLength);
}

function normalizeRegexScripts(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return [];
    }
    if (!Array.isArray(value)) {
        return [{
            unsupportedRegexScriptsShape: true,
        }];
    }
    return value
        .filter((script) => script && typeof script === 'object')
        .map((script) => ({
            id: sanitizeText(script.id || '', 160),
            scriptName: sanitizeText(script.scriptName || script.name || '', 240),
            findRegex: sanitizeMultilineText(script.findRegex || '', 20_000),
            replaceString: sanitizeMultilineText(script.replaceString || '', 20_000),
            trimStrings: normalizeArrayText(script.trimStrings),
            placement: normalizeNumberArray(script.placement),
            disabled: Boolean(script.disabled),
            markdownOnly: Boolean(script.markdownOnly),
            promptOnly: Boolean(script.promptOnly),
            runOnEdit: Boolean(script.runOnEdit),
            substituteRegex: normalizeNumber(script.substituteRegex, 0),
            minDepth: normalizeNumber(script.minDepth, null),
            maxDepth: normalizeNumber(script.maxDepth, null),
            unsupportedRuntimeFields: collectUnsupportedRegexScriptRuntimeFields(script),
        }))
        .sort((left, right) => (
            `${left.id}\u0000${left.scriptName}\u0000${left.findRegex}`
                .localeCompare(`${right.id}\u0000${right.scriptName}\u0000${right.findRegex}`)
        ));
}

function collectUnsupportedCharacterRuntimeExtensions(extensions) {
    if (!extensions || typeof extensions !== 'object') {
        return [];
    }
    const known = new Set([
        'world',
        'galgameScriptImport',
        'talkativeness',
        'fav',
        'depth_prompt',
        'regex_scripts',
    ]);
    return Object.keys(extensions)
        .filter((key) => !known.has(key) && looksCharacterExtensionRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: `extensions.${key}`,
            reason: 'unsupported-character-runtime-extension-field',
        }));
}

function collectUnsupportedRegexScriptRuntimeFields(script) {
    const known = new Set([
        'id',
        'scriptName',
        'name',
        'findRegex',
        'replaceString',
        'trimStrings',
        'placement',
        'disabled',
        'markdownOnly',
        'promptOnly',
        'runOnEdit',
        'substituteRegex',
        'minDepth',
        'maxDepth',
    ]);
    return Object.keys(script || {})
        .filter((key) => !known.has(key) && looksCharacterExtensionRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: `regex_scripts.${key}`,
            reason: 'unsupported-regex-script-runtime-field',
        }));
}

function collectUnsupportedCharacterBookEntryRuntimeFields(entry) {
    const knownTopLevel = new Set([
        'id', 'uid', 'keys', 'key', 'secondary_keys', 'keysecondary', 'comment', 'content',
        'constant', 'selective', 'insertion_order', 'order', 'enabled', 'disable', 'position',
        'use_regex', 'extensions', 'decorators', 'hash',
    ]);
    return Object.keys(entry || {})
        .filter((key) => !knownTopLevel.has(key) && looksWorldInfoRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: `character_book.entries.${key}`,
            reason: 'unsupported-character-book-runtime-field',
        }));
}

function collectUnsupportedCharacterBookExtensionRuntimeFields(extensions) {
    if (!extensions || typeof extensions !== 'object') {
        return [];
    }
    const knownExtension = new Set([
        'position', 'exclude_recursion', 'display_index', 'probability', 'useProbability', 'depth',
        'selectiveLogic', 'outlet_name', 'group', 'group_override', 'group_weight', 'prevent_recursion',
        'delay_until_recursion', 'scan_depth', 'match_whole_words', 'use_group_scoring',
        'case_sensitive', 'automation_id', 'role', 'vectorized', 'sticky', 'cooldown', 'delay',
        'match_persona_description', 'match_character_description', 'match_character_personality',
        'match_character_depth_prompt', 'match_scenario', 'match_creator_notes', 'triggers',
        'ignore_budget',
    ]);
    return Object.keys(extensions)
        .filter((key) => !knownExtension.has(key) && looksWorldInfoRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: `character_book.entries.extensions.${key}`,
            reason: 'unsupported-character-book-runtime-extension-field',
        }));
}

function worldInfoEntryValue(entry, camelKey, extensionKey) {
    const extensions = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    return firstDefined(entry?.[camelKey], extensions?.[extensionKey], extensions?.[camelKey]);
}

function normalizeKnownWorldInfoRuntimeExtensionAliases(entry) {
    const extensions = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    return {
        position: normalizeNumberIfPresent(extensions, 'position'),
        exclude_recursion: normalizeBooleanIfPresent(extensions, 'exclude_recursion'),
        display_index: normalizeNumberIfPresent(extensions, 'display_index'),
        probability: normalizeNumberIfPresent(extensions, 'probability'),
        useProbability: normalizeBooleanIfPresent(extensions, 'useProbability'),
        depth: normalizeNumberIfPresent(extensions, 'depth'),
        selectiveLogic: normalizeNumberIfPresent(extensions, 'selectiveLogic'),
        outlet_name: normalizeTextIfPresent(extensions, 'outlet_name', 200),
        group: normalizeTextIfPresent(extensions, 'group', 200),
        group_override: normalizeBooleanIfPresent(extensions, 'group_override'),
        group_weight: normalizeNumberIfPresent(extensions, 'group_weight'),
        prevent_recursion: normalizeBooleanIfPresent(extensions, 'prevent_recursion'),
        delay_until_recursion: normalizeRuntimeBooleanOrNumberIfPresent(extensions, 'delay_until_recursion'),
        scan_depth: normalizeNumberIfPresent(extensions, 'scan_depth'),
        match_whole_words: normalizeBooleanIfPresent(extensions, 'match_whole_words'),
        use_group_scoring: normalizeBooleanIfPresent(extensions, 'use_group_scoring'),
        case_sensitive: normalizeBooleanIfPresent(extensions, 'case_sensitive'),
        automation_id: normalizeTextIfPresent(extensions, 'automation_id', 200),
        role: normalizeNumberIfPresent(extensions, 'role'),
        vectorized: normalizeBooleanIfPresent(extensions, 'vectorized'),
        sticky: normalizeNumberIfPresent(extensions, 'sticky'),
        cooldown: normalizeNumberIfPresent(extensions, 'cooldown'),
        delay: normalizeNumberIfPresent(extensions, 'delay'),
        match_persona_description: normalizeBooleanIfPresent(extensions, 'match_persona_description'),
        match_character_description: normalizeBooleanIfPresent(extensions, 'match_character_description'),
        match_character_personality: normalizeBooleanIfPresent(extensions, 'match_character_personality'),
        match_character_depth_prompt: normalizeBooleanIfPresent(extensions, 'match_character_depth_prompt'),
        match_scenario: normalizeBooleanIfPresent(extensions, 'match_scenario'),
        match_creator_notes: normalizeBooleanIfPresent(extensions, 'match_creator_notes'),
        triggers: normalizeArrayIfPresent(extensions, 'triggers'),
        ignore_budget: normalizeBooleanIfPresent(extensions, 'ignore_budget'),
    };
}

function collectUnsupportedWorldInfoRuntimeFields(entry) {
    const knownTopLevel = new Set([
        'uid', 'key', 'keysecondary', 'comment', 'content', 'constant', 'vectorized', 'selective',
        'selectiveLogic', 'addMemo', 'order', 'position', 'disable', 'enabled', 'ignoreBudget',
        'excludeRecursion', 'preventRecursion', 'matchPersonaDescription', 'matchCharacterDescription',
        'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes',
        'delayUntilRecursion', 'probability', 'useProbability', 'depth', 'outletName', 'group',
        'groupOverride', 'groupWeight', 'scanDepth', 'caseSensitive', 'matchWholeWords',
        'useGroupScoring', 'automationId', 'role', 'sticky', 'cooldown', 'delay', 'triggers',
        'characterFilterNames', 'characterFilterTags', 'characterFilterExclude', 'extensions',
        'commented', 'displayIndex', 'hash', 'decorators',
    ]);
    const knownExtension = new Set([
        'position', 'exclude_recursion', 'display_index', 'probability', 'useProbability', 'depth',
        'selectiveLogic', 'outlet_name', 'group', 'group_override', 'group_weight', 'prevent_recursion',
        'delay_until_recursion', 'scan_depth', 'match_whole_words', 'use_group_scoring',
        'case_sensitive', 'automation_id', 'role', 'vectorized', 'sticky', 'cooldown', 'delay',
        'match_persona_description', 'match_character_description', 'match_character_personality',
        'match_character_depth_prompt', 'match_scenario', 'match_creator_notes', 'triggers',
        'ignore_budget',
    ]);
    const topLevel = Object.keys(entry || {})
        .filter((key) => !knownTopLevel.has(key) && looksWorldInfoRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: key,
            reason: 'unsupported-worldbook-runtime-field',
        }));
    const extensions = entry?.extensions && typeof entry.extensions === 'object' ? entry.extensions : {};
    const extensionFields = Object.keys(extensions)
        .filter((key) => !knownExtension.has(key) && looksWorldInfoRuntimeSemanticKey(key))
        .sort()
        .map((key) => ({
            path: `extensions.${key}`,
            reason: 'unsupported-worldbook-runtime-extension-field',
        }));
    return [...topLevel, ...extensionFields];
}

function looksWorldInfoRuntimeSemanticKey(key) {
    return /depth|scan|case|match|whole|group|scor|sticky|cooldown|delay|recurs|role|probab|trigger|budget|position|outlet|vector|select|constant|disable|enable|order/i.test(String(key || ''));
}

function looksCharacterExtensionRuntimeSemanticKey(key) {
    return /regex|script|prompt|world|lore|book|context|system|instruct|memory|persona|depth|scan|replace|substitut|placement|trigger|run|role/i.test(String(key || ''));
}

function normalizeNumberIfPresent(source, key) {
    return Object.hasOwn(source || {}, key) ? normalizeNumber(source[key], null) : null;
}

function normalizeBooleanIfPresent(source, key) {
    return Object.hasOwn(source || {}, key) ? normalizeNullableBooleanValue(source[key]) : null;
}

function normalizeTextIfPresent(source, key, maxLength = 4000) {
    return Object.hasOwn(source || {}, key) ? sanitizeText(source[key] || '', maxLength) : '';
}

function normalizeArrayIfPresent(source, key) {
    return Object.hasOwn(source || {}, key) ? normalizeArrayText(source[key]) : [];
}

function normalizeRuntimeBooleanOrNumberIfPresent(source, key) {
    return Object.hasOwn(source || {}, key) ? normalizeRuntimeBooleanOrNumber(source[key]) : null;
}

function normalizeRuntimeBooleanOrNumber(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return null;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    const text = String(value).trim().toLowerCase();
    if (text === 'true') {
        return true;
    }
    if (text === 'false') {
        return false;
    }
    return sanitizeText(value, 80);
}

function normalizeNullableBooleanValue(value) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return null;
    }
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        if (text === 'true') {
            return true;
        }
        if (text === 'false') {
            return false;
        }
    }
    return Boolean(value);
}

function normalizeNumberArray(value) {
    return (Array.isArray(value) ? value : [])
        .map((item) => normalizeNumber(item, null))
        .filter((item) => item !== null)
        .sort((left, right) => left - right);
}

function previewCanonicalUnknownValue(value) {
    if (value === null || typeof value === 'undefined') {
        return value;
    }
    if (typeof value === 'string') {
        return sanitizeMultilineText(value, 4000);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(previewCanonicalUnknownValue).slice(0, 50);
    }
    if (typeof value === 'object') {
        return Object.keys(value).sort().slice(0, 50).map((key) => [key, previewCanonicalUnknownValue(value[key])]);
    }
    return String(value);
}

function normalizeNumber(value, defaultValue = 0) {
    if (value === null || typeof value === 'undefined' || value === '') {
        return defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
}

function firstDefined(...values) {
    return values.find((value) => typeof value !== 'undefined');
}

function normalizeAlternateGreetings(value) {
    const parsed = typeof value === 'string' ? parseMaybeJson(value) : value;
    return (Array.isArray(parsed) ? parsed : [])
        .map((item) => sanitizeMultilineText(item, 20_000))
        .filter(Boolean);
}

function getVisibleChatMessages(rawChat) {
    return Array.isArray(rawChat)
        ? rawChat.slice(1).filter((message) => message && !message.is_system && typeof message.mes === 'string' && message.mes.trim())
        : [];
}

function arrayFromResourceMap(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (!value || typeof value !== 'object') {
        return [];
    }
    return Object.values(value);
}

function parseMaybeJson(value) {
    if (!value) {
        return {};
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(String(value));
    } catch {
        return {};
    }
}

function splitParagraphs(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/g)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
}

function chunkTextForWorldBook(text, maxLength) {
    const clean = sanitizeMultilineText(text, 120_000);
    const chunks = [];
    for (let index = 0; index < clean.length; index += maxLength) {
        chunks.push(clean.slice(index, index + maxLength).trim());
    }
    return chunks.filter(Boolean);
}

function sanitizeMultilineText(value, maxLength = 4000) {
    return String(value || '')
        .replace(/\u0000/g, '')
        .replace(/\r\n?/g, '\n')
        .trim()
        .slice(0, maxLength);
}

function isMarkdownHeading(value) {
    return /^#{1,6}\s+/.test(String(value || '').trim());
}

function hashSourceFiles(files) {
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(String(file.name || ''));
        hash.update('\0');
        hash.update(String(file.type || ''));
        hash.update('\0');
        hash.update(String(file.text || ''));
        hash.update('\0');
    }
    return hash.digest('hex');
}

function hashJson(value) {
    return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function sanitizeHash(value) {
    const text = String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
    return text.length >= 16 ? text.slice(0, 64) : hashJson(text);
}

function sanitizeText(value, maxLength = 4000) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeReference(value, maxLength = 240) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .trim()
        .slice(0, maxLength);
}

function sanitizeResourceName(value) {
    return sanitizeReference(value, 180)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'Galgame_AIImport_Untitled';
}

function sanitizeFileName(value) {
    const clean = sanitizeReference(value, 180)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '');
    const withExt = clean || 'galgame_aiimport_director.png';
    return /\.png$/i.test(withExt) ? withExt : `${withExt}.png`;
}

function sanitizeChatSeedId(value) {
    return sanitizeReference(value, 180)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'galgame-aiimport-seed';
}

function createSlug(value) {
    return sanitizeChatSeedId(value).replace(/-/g, '_').slice(0, 64) || 'untitled';
}

function stripExtension(value) {
    return sanitizeReference(value, 160).replace(/\.[^.]+$/, '');
}

function uniqueArray(values) {
    return [...new Set(values)];
}

function sanitizeConflictDetails(details) {
    return Object.fromEntries(Object.entries(details || {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? sanitizeReference(value, 240) : value,
    ]));
}

function normalizeChatFileId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

function normalizeBaseUrl(value) {
    return String(value || DEFAULT_ST_BASE_URL).trim().replace(/\/+$/, '');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    const cookieFetch = async function cookieFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', cookieHeader());
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        remember(response.headers);
        return response;
    };
    function remember(headers) {
        const setCookieValues = typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : [headers.get('set-cookie')].filter(Boolean);
        for (const value of setCookieValues) {
            for (const cookieText of splitSetCookieHeader(value)) {
                const firstPart = cookieText.split(';')[0];
                const separator = firstPart.indexOf('=');
                if (separator <= 0) {
                    continue;
                }
                cookies.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
            }
        }
    }
    function cookieHeader() {
        return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    cookieFetch.remember = remember;
    cookieFetch.cookieHeader = cookieHeader;
    return cookieFetch;
}

function splitSetCookieHeader(value) {
    return String(value || '').split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}
