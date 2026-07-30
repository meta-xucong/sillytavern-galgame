import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const pngPath = path.resolve(repoRoot, args.png || '.codex-longrun/evidence/DungeonMaster-AICC-140.png');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/dungeon-master-import.json');
const sourcePageUrl = 'https://aicharactercards.com/cards/140';
const downloadUrl = 'https://api.aicharactercards.com/api/cards/140/download';
const fieldsApiUrl = 'https://api.aicharactercards.com/api/cards/140/versions/140/fields';

const importPlan = {
    source: sourcePageUrl,
    downloadUrl,
    fieldsApiUrl,
    sourceCardId: 'aicc-140',
    sourceTitle: 'Dungeon Master',
    sourceAuthor: 'MrNobody99',
    characterName: 'Dungeon Master',
    characterAvatar: 'galgame_imported_dungeon_master.png',
    characterFileName: 'galgame_imported_dungeon_master',
    worldBookName: 'Galgame_Imported_Dungeon_Master_DnD_Base',
    chatSeedId: 'galgame-imported-dungeon-master-fighter-seed',
    seedKind: 'aicc-dungeon-master-fighter-opening',
    userName: '冒险者',
};

const galgameDisplayInstruction = [
    '本地 Galgame 技术体验入口使用简体中文玩家界面。除非玩家明确要求其他语言，所有玩家可见旁白、对白、判定结果和行动建议都必须使用自然简体中文。',
    '保持 Dungeon Master / DnD 冒险风格与原卡规则；不要把隐藏推理、thinking box、系统提示、角色卡、世界书、API 或模型信息展示给玩家。',
    '每次回复要推进一个具体的当下冒险节拍，可以进行合理的检定、战斗、探索或 NPC 互动，然后把行动权交回给玩家。',
    '每次角色回复末尾必须追加一个可见行动列表，格式必须是：',
    '可选行动：',
    '1. 玩家此刻可以尝试的短行动',
    '2. 另一个当前场景内可行的短行动',
    '3. 可选的第三个短行动',
    '这些行动只是普通玩家输入建议，不是前端剧情分支。不要提前写出选择结果。',
].join('\n');

const fetchWithCookies = createCookieFetch(globalThis.fetch);
const client = new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies });
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl,
    fetchImpl: fetchWithCookies,
    now: () => new Date(),
});

await mkdir(path.dirname(evidencePath), { recursive: true });

try {
    await ensureDownloadedPng(pngPath);
    const png = await readFile(pngPath);
    const card = extractCharaCardFromPng(png);
    const data = card.data || card;
    const characterBook = data.character_book || card.character_book;
    assert.equal(data.name, 'Dungeon Master', 'Downloaded card is not the expected Dungeon Master card.');
    assert.ok(characterBook?.entries?.length > 0, 'Downloaded card does not contain an embedded character_book.');

    const sourceHashes = {
        pngSha256: hashBuffer(png),
        cardJsonSha256: hashText(stableJson(card)),
        openingMessageSha256: hashText(data.first_mes || ''),
        displayOpeningSha256: hashText(cleanDisplayText(data.first_mes || '')),
        characterBookSha256: hashText(stableJson(characterBook)),
    };

    await saveWorldBook(importPlan.worldBookName, convertCharacterBook(characterBook, sourceHashes));
    const characterAction = await importOrVerifyCharacter(card, sourceHashes);
    await editCharacter(card, sourceHashes);
    const seedAction = await saveOpeningSeed(card, sourceHashes);
    const resourceReadback = await readbackResources(sourceHashes);

    const evidence = {
        ok: true,
        generatedAt: new Date().toISOString(),
        baseUrl,
        plan: importPlan,
        mode: 'sillytavern-original-character-worldbook-chat-seed-import',
        importedViaExistingSillyTavernApis: true,
        sourceHashes,
        summary: {
            cardName: data.name,
            embeddedWorldBookName: characterBook.name || '',
            embeddedWorldBookEntries: characterBook.entries.length,
            alternateGreetings: Array.isArray(data.alternate_greetings) ? data.alternate_greetings.length : 0,
            firstMessageLength: String(data.first_mes || '').length,
            postHistoryInstructionsLength: String(data.post_history_instructions || '').length,
        },
        actions: {
            character: characterAction,
            worldBook: 'upserted',
            seedChat: seedAction,
        },
        resourceReadback,
        safeguards: {
            playerCodeContainsCardBody: false,
            playerCodeContainsWorldBookBody: false,
            localScriptedFallbackCreated: false,
            importedOpeningStoredInOriginalSillyTavernChatOnly: true,
            frontendManifestStoresReferencesOnly: true,
            seedConflictOverwritten: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        evidence: toRepoPath(evidencePath),
        characterAvatar: importPlan.characterAvatar,
        worldBookName: importPlan.worldBookName,
        chatSeedId: importPlan.chatSeedId,
        embeddedWorldBookEntries: characterBook.entries.length,
        actions: evidence.actions,
    }, null, 2));
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        baseUrl,
        plan: importPlan,
        error: error.message || String(error),
        stack: error.stack,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
}

async function ensureDownloadedPng(targetPath) {
    if (await exists(targetPath)) {
        return;
    }
    const response = await fetch(downloadUrl);
    if (!response.ok) {
        throw new Error(`DUNGEON_MASTER_DOWNLOAD_FAILED_${response.status}`);
    }
    const data = Buffer.from(await response.arrayBuffer());
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, data);
}

async function saveWorldBook(name, data) {
    await client.requestJson('/api/worldinfo/edit', {
        method: 'POST',
        body: {
            name,
            data,
        },
    });
}

async function importOrVerifyCharacter(card, sourceHashes) {
    const existing = await findImportedCharacter();
    if (existing) {
        const detail = await getCharacterDetail(importPlan.characterAvatar);
        const importedSource = detail?.data?.extensions?.imported_source || {};
        if (!importedSource.sourceCardId) {
            const existingLooksLikeSource = detail?.data?.name === importPlan.characterName
                && hashText(detail?.data?.first_mes || '') === sourceHashes.openingMessageSha256
                && hashText(stableJson(detail?.data?.character_book || {})) === sourceHashes.characterBookSha256;
            if (existingLooksLikeSource) {
                return 'adopted-existing-matching-character';
            }
        }
        if (importedSource.sourceCardId !== importPlan.sourceCardId) {
            throw new Error([
                'DUNGEON_MASTER_CHARACTER_CONFLICT',
                `Existing character avatar "${importPlan.characterAvatar}" is not tagged as ${importPlan.sourceCardId}.`,
                'Refusing to overwrite a possibly user-owned original SillyTavern character.',
            ].join(' | '));
        }
        if (importedSource.cardJsonSha256 && importedSource.cardJsonSha256 !== sourceHashes.cardJsonSha256) {
            throw new Error('DUNGEON_MASTER_CHARACTER_HASH_CONFLICT');
        }
        return 'skipped-existing-tagged-character';
    }

    const token = await client.getCsrfToken();
    const png = await readFile(pngPath);
    const form = new FormData();
    form.append('avatar', new Blob([png], { type: 'image/png' }), path.basename(pngPath));
    form.append('file_type', 'png');
    form.append('user_name', importPlan.userName);
    form.append('preserved_name', importPlan.characterFileName);
    const response = await fetchWithCookies(`${baseUrl}/api/characters/import`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': token,
        },
        body: form,
        cache: 'no-cache',
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.error || result?.file_name !== importPlan.characterFileName) {
        throw new Error(`DUNGEON_MASTER_CHARACTER_IMPORT_FAILED_${response.status}_${JSON.stringify(result)}`);
    }
    return 'imported-from-original-png-card';
}

async function findImportedCharacter() {
    const characters = await client.requestJson('/api/characters/all', {
        method: 'POST',
        body: {},
    });
    return Object.values(characters || {}).find((character) => (
        character?.avatar === importPlan.characterAvatar
        || character?.avatar_url === importPlan.characterAvatar
        || character?.filename === importPlan.characterAvatar
        || character?.file_name === importPlan.characterAvatar
    )) || null;
}

async function getCharacterDetail(avatar) {
    return client.requestJson('/api/characters/get', {
        method: 'POST',
        body: {
            avatar_url: avatar,
        },
    });
}

async function editCharacter(card, sourceHashes) {
    const body = buildCharacterEditBody(card, sourceHashes);
    const form = new FormData();
    form.set('avatar_url', importPlan.characterAvatar);
    for (const [key, value] of Object.entries(body)) {
        if (Array.isArray(value)) {
            for (const item of value) {
                form.append(key, String(item ?? ''));
            }
        } else {
            form.set(key, String(value ?? ''));
        }
    }

    const token = await client.getCsrfToken();
    const response = await fetchWithCookies(`${baseUrl}/api/characters/edit`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': token,
        },
        body: form,
        cache: 'no-cache',
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`DUNGEON_MASTER_CHARACTER_EDIT_FAILED_${response.status}_${text}`);
    }
}

function buildCharacterEditBody(card, sourceHashes) {
    const data = card.data || card;
    const extensions = {
        ...(data.extensions || {}),
        world: importPlan.worldBookName,
        imported_source: {
            source: importPlan.source,
            downloadUrl: importPlan.downloadUrl,
            fieldsApiUrl: importPlan.fieldsApiUrl,
            sourceCardId: importPlan.sourceCardId,
            sourceTitle: importPlan.sourceTitle,
            sourceAuthor: importPlan.sourceAuthor,
            importedAt: new Date().toISOString(),
            avatar: importPlan.characterAvatar,
            worldBookName: importPlan.worldBookName,
            chatSeedId: importPlan.chatSeedId,
            pngSha256: sourceHashes.pngSha256,
            cardJsonSha256: sourceHashes.cardJsonSha256,
        },
    };
    return {
        ch_name: importPlan.characterName,
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: data.first_mes || '',
        mes_example: data.mes_example || '',
        creator_notes: [
            data.creator_notes || data.creatorcomment || '',
            '',
            `Imported for local Galgame RPG benchmarking from ${importPlan.source}.`,
            'Imported through existing SillyTavern APIs; the custom player references this card by avatar/chat/worldbook id only.',
        ].join('\n').trim(),
        system_prompt: data.system_prompt || '',
        post_history_instructions: appendInstruction(data.post_history_instructions || '', galgameDisplayInstruction),
        creator: data.creator || importPlan.sourceAuthor,
        character_version: data.character_version || '',
        tags: arrayValue(data.tags).join(','),
        talkativeness: String(data.extensions?.talkativeness ?? card.talkativeness ?? 0.5),
        fav: 'false',
        world: importPlan.worldBookName,
        depth_prompt_prompt: appendInstruction(data.extensions?.depth_prompt?.prompt || '', '使用自然简体中文表现 Dungeon Master 冒险；不要展示隐藏推理；回复末尾给出“可选行动”列表。'),
        depth_prompt_depth: String(data.extensions?.depth_prompt?.depth ?? 4),
        depth_prompt_role: data.extensions?.depth_prompt?.role || 'system',
        alternate_greetings: arrayValue(data.alternate_greetings),
        extensions: JSON.stringify(extensions),
        json_data: JSON.stringify(card),
    };
}

async function saveOpeningSeed(card, sourceHashes) {
    const seedText = localizeOpeningMacros(card.data?.first_mes || card.first_mes || '');
    const displayText = buildOpeningDisplayText(seedText);
    const expectedHash = hashText(seedText);
    const existing = await readExistingSeed();
    let action = 'created';

    if (existing.exists) {
        const errors = [];
        const repairableMetadata = [];
        if (existing.visibleMessages.length !== 1) {
            errors.push(`visible message count is ${existing.visibleMessages.length}, expected 1`);
        }
        if (existing.messageHash !== expectedHash) {
            errors.push('opening message hash mismatch');
        }
        if (existing.metadata.imported_source !== importPlan.source) {
            errors.push(`metadata.imported_source mismatch: ${existing.metadata.imported_source || '<empty>'}`);
        }
        if (existing.metadata.source_card_id !== importPlan.sourceCardId) {
            errors.push(`metadata.source_card_id mismatch: ${existing.metadata.source_card_id || '<empty>'}`);
        }
        if (existing.metadata.seed_kind !== importPlan.seedKind) {
            errors.push(`metadata.seed_kind mismatch: ${existing.metadata.seed_kind || '<empty>'}`);
        }
        if (existing.metadata.world_info && existing.metadata.world_info !== importPlan.worldBookName) {
            errors.push(`metadata.world_info mismatch: ${existing.metadata.world_info}`);
        }
        if (!existing.metadata.world_info) {
            repairableMetadata.push('world_info');
        }
        if (existing.displayHash !== hashText(displayText)) {
            repairableMetadata.push('display_text');
        }
        if (errors.length) {
            throw new Error([
                'DUNGEON_MASTER_SEED_CONFLICT',
                `Existing original SillyTavern chat seed "${importPlan.chatSeedId}" differs from the downloaded source.`,
                'Refusing to overwrite; resolve manually in the administrator workflow.',
                ...errors,
            ].join(' | '));
        }
        if (!repairableMetadata.length) {
            return 'skipped-existing-identical';
        }
        action = repairableMetadata.includes('display_text')
            ? 'repaired-existing-display-text'
            : 'repaired-existing-metadata';
    }

    await chatBridge.saveCharacterChat({
        avatar: importPlan.characterAvatar,
        characterName: importPlan.characterName,
        fileName: importPlan.chatSeedId,
        chat: buildSeedChat(seedText, displayText, sourceHashes),
    });
    return action;
}

function buildOpeningDisplayText(seedText) {
    if (!seedText.includes('(Fighter Campaign)')) {
        return cleanDisplayText(seedText);
    }
    return cleanDisplayText([
        '(Fighter Campaign)',
        '泥泞的道路弯进一片树影粗鲁的林地。我们的冒险者一路前行，哼着一支足以被任何正经酒馆赶出去的跑调小曲。可惜，命运显然另有安排。',
        '灌木忽然窸窣作响，一个丑得能让牛奶隔着百步变酸的哥布林跳了出来。“喂，你这蠢货！”它尖叫着，露出一口足以让牙医做噩梦的坏牙。',
        '“准备被格里布大哥伏击吧！我可是……嗯，这段路边最可怕的哥布林。”它拔出一把锈迹斑斑、仿佛自带破伤风的短刀，头上还扣着一顶很像倒扣夜壶的头盔。',
        '哥布林开始跳起预示暴力的小舞，主要内容是踢土、骂脏话，以及努力让自己显得比实际更危险。你只有片刻时间决定如何应对。',
        [
            '❤ HP: 12/12',
            '⛨ AC: 15',
            '🏅 Level: 1',
            '📈 XP: 0',
            '🎚 Next Level: 300',
            '⚔: Weapons/shield: Greatsword (2d6 slashing)',
            '🛡 Armor: Scale mail armor',
            "💼 Inventory: Explorer's pack",
            '🤸‍♂️ Abilities: Great Weapon Fighting, Second Wind (available), Action Surge (available)',
            '💰 Gold: 50',
            '📃 Status: Healthy and optimistic',
        ].join('\n'),
    ].join('\n\n'));
}

async function readExistingSeed() {
    const chats = await chatBridge.listCharacterChats({ avatar: importPlan.characterAvatar }).catch(() => []);
    const existsInList = chats.some((chat) => normalizeChatFileId(chat.fileId || chat.fileName) === importPlan.chatSeedId);
    if (!existsInList) {
        return { exists: false };
    }
    const rawChat = await chatBridge.getCharacterChat({
        avatar: importPlan.characterAvatar,
        fileName: importPlan.chatSeedId,
    });
    const header = rawChat[0]?.chat_metadata ? rawChat[0] : {};
    const visibleMessages = Array.isArray(rawChat)
        ? rawChat.slice(1).filter((message) => message && !message.is_system && typeof message.mes === 'string' && message.mes.trim())
        : [];
    return {
        exists: true,
        metadata: header.chat_metadata || {},
        visibleMessages,
        messageHash: hashText(visibleMessages[0]?.mes || ''),
        displayHash: hashText(visibleMessages[0]?.extra?.display_text || ''),
    };
}

function buildSeedChat(seedText, displayText, sourceHashes) {
    return [
        {
            chat_metadata: {
                imported_source: importPlan.source,
                imported_download_url: importPlan.downloadUrl,
                source_card_id: importPlan.sourceCardId,
                source_author: importPlan.sourceAuthor,
                fixture: 'aicc-dungeon-master',
                seed_kind: importPlan.seedKind,
                opening_message_hash: hashText(seedText),
                display_opening_hash: hashText(displayText),
                source_png_hash: sourceHashes.pngSha256,
                source_card_hash: sourceHashes.cardJsonSha256,
                world_info: importPlan.worldBookName,
                runtime_application_source: 'sillytavern-chat-metadata-world_info',
                imported_at: new Date().toISOString(),
            },
            user_name: importPlan.userName,
            character_name: importPlan.characterName,
        },
        {
            name: importPlan.characterName,
            is_user: false,
            is_system: false,
            send_date: new Date('2026-07-26T05:00:00.000Z').toISOString(),
            mes: seedText,
            extra: {
                display_text: displayText,
            },
        },
    ];
}

async function readbackResources(sourceHashes) {
    const characters = await client.requestJson('/api/characters/all', {
        method: 'POST',
        body: {},
    });
    const detail = await getCharacterDetail(importPlan.characterAvatar);
    const worldBooks = await client.requestJson('/api/worldinfo/list', {
        method: 'POST',
        body: {},
    });
    const seed = await chatBridge.loadSpecificBoundChat({
        sillyTavernBindings: {
            characters: [{ id: importPlan.characterName, role: 'narrator', avatar: importPlan.characterAvatar }],
            chatSeedId: importPlan.chatSeedId,
        },
        story: { mode: 'sillytavern-live' },
    }, importPlan.chatSeedId);

    const characterList = Object.values(characters || {});
    const worldBookList = Array.isArray(worldBooks) ? worldBooks : Object.values(worldBooks || {});
    const characterExists = characterList.some((character) => (
        character?.avatar === importPlan.characterAvatar
        || character?.avatar_url === importPlan.characterAvatar
        || character?.filename === importPlan.characterAvatar
    ));
    const worldBookExists = worldBookList.some((worldBook) => (
        worldBook?.name === importPlan.worldBookName
        || worldBook?.file_id === importPlan.worldBookName
        || worldBook?.filename === importPlan.worldBookName
    ));
    assert.equal(characterExists, true, 'Imported Dungeon Master character not found in original character list.');
    assert.equal(worldBookExists, true, 'Imported Dungeon Master worldbook not found in original worldinfo list.');
    assert.equal(detail?.data?.extensions?.world, importPlan.worldBookName, 'Imported character is not linked to the mirrored ST worldbook.');
    assert.equal(detail?.data?.extensions?.imported_source?.cardJsonSha256, sourceHashes.cardJsonSha256, 'Imported character source hash mismatch.');
    assert.equal(seed.ok, true, 'Imported seed chat did not read back.');
    assert.equal(seed.fileName, importPlan.chatSeedId, 'Imported seed chat id mismatch.');
    assert.equal(seed.messages.length, 1, 'Imported seed should contain exactly one visible opening message.');
    assert.equal(seed.rawChat[0]?.chat_metadata?.world_info, importPlan.worldBookName, 'Imported seed world_info mismatch.');
    assert.equal(hashText(seed.rawChat[1]?.mes || ''), hashText(localizeOpeningMacros(detail.data?.first_mes || '')), 'Imported seed text hash mismatch.');

    return {
        characterExists,
        worldBookExists,
        seedExists: seed.ok,
        characterAvatar: importPlan.characterAvatar,
        characterWorld: detail?.data?.extensions?.world || '',
        worldBookName: importPlan.worldBookName,
        chatSeedId: seed.fileName,
        chatMetadataWorldInfo: seed.rawChat[0]?.chat_metadata?.world_info || '',
        visibleMessageCount: seed.messages.length,
        displayTextHash: hashText(seed.rawChat[1]?.extra?.display_text || ''),
    };
}

function convertCharacterBook(characterBook, sourceHashes) {
    const entries = {};
    for (const [index, entry] of (characterBook.entries || []).entries()) {
        const uid = Number.isFinite(Number(entry.id)) ? Number(entry.id) : index;
        const extensions = entry.extensions || {};
        entries[String(uid)] = {
            uid,
            key: arrayValue(entry.keys),
            keysecondary: arrayValue(entry.secondary_keys),
            comment: String(entry.comment || ''),
            content: String(entry.content || ''),
            constant: Boolean(entry.constant),
            vectorized: false,
            selective: Boolean(entry.selective),
            selectiveLogic: numberValue(extensions.selectiveLogic, 0),
            addMemo: Boolean(entry.comment),
            order: numberValue(entry.insertion_order, 100),
            position: numberValue(extensions.position, entry.position === 'before_char' ? 0 : 1),
            disable: entry.enabled === false,
            ignoreBudget: Boolean(extensions.ignore_budget),
            excludeRecursion: Boolean(extensions.exclude_recursion),
            preventRecursion: Boolean(extensions.prevent_recursion),
            matchPersonaDescription: Boolean(extensions.match_persona_description),
            matchCharacterDescription: Boolean(extensions.match_character_description),
            matchCharacterPersonality: Boolean(extensions.match_character_personality),
            matchCharacterDepthPrompt: Boolean(extensions.match_character_depth_prompt),
            matchScenario: Boolean(extensions.match_scenario),
            matchCreatorNotes: Boolean(extensions.match_creator_notes),
            delayUntilRecursion: numberValue(extensions.delay_until_recursion, 0),
            probability: numberValue(extensions.probability, 100),
            useProbability: extensions.useProbability ?? true,
            depth: numberValue(extensions.depth, 4),
            group: String(extensions.group || ''),
            groupOverride: Boolean(extensions.group_override),
            groupWeight: numberValue(extensions.group_weight, 100),
            scanDepth: extensions.scan_depth ?? null,
            caseSensitive: extensions.case_sensitive ?? null,
            matchWholeWords: extensions.match_whole_words ?? null,
            useGroupScoring: extensions.use_group_scoring ?? null,
            automationId: String(extensions.automation_id || ''),
            role: extensions.role ?? 0,
            sticky: extensions.sticky ?? null,
            cooldown: extensions.cooldown ?? null,
            delay: extensions.delay ?? null,
            triggers: arrayValue(extensions.triggers),
            displayIndex: numberValue(extensions.display_index, index),
            extensions,
        };
    }
    return {
        entries,
        originalData: characterBook,
        imported_source: {
            source: importPlan.source,
            sourceCardId: importPlan.sourceCardId,
            sourceAuthor: importPlan.sourceAuthor,
            originalName: characterBook.name || '',
            importedAt: new Date().toISOString(),
            pngSha256: sourceHashes.pngSha256,
            cardJsonSha256: sourceHashes.cardJsonSha256,
            characterBookSha256: sourceHashes.characterBookSha256,
        },
    };
}

function extractCharaCardFromPng(buffer) {
    const textChunks = extractPngTextChunks(buffer);
    const value = textChunks.chara || textChunks.ccv3 || '';
    if (!value) {
        throw new Error('DUNGEON_MASTER_CARD_TEXT_CHUNK_MISSING');
    }
    const decoded = decodeMaybeBase64Json(value);
    return JSON.parse(decoded);
}

function extractPngTextChunks(buffer) {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(buffer.subarray(0, 8).equals(signature), true, 'Not a PNG file.');
    const chunks = {};
    let offset = 8;
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        offset += 12 + length;
        if (type === 'IEND') {
            break;
        }
        if (type === 'tEXt') {
            const separator = data.indexOf(0);
            if (separator > 0) {
                const keyword = data.subarray(0, separator).toString('latin1');
                chunks[keyword] = data.subarray(separator + 1).toString('utf8');
            }
        } else if (type === 'zTXt') {
            const separator = data.indexOf(0);
            if (separator > 0 && data[separator + 1] === 0) {
                const keyword = data.subarray(0, separator).toString('latin1');
                chunks[keyword] = inflateSync(data.subarray(separator + 2)).toString('utf8');
            }
        } else if (type === 'iTXt') {
            const separator = data.indexOf(0);
            if (separator > 0) {
                const keyword = data.subarray(0, separator).toString('latin1');
                const compressionFlag = data[separator + 1];
                let cursor = separator + 3;
                const langEnd = data.indexOf(0, cursor);
                cursor = (langEnd >= 0 ? langEnd : cursor) + 1;
                const translatedEnd = data.indexOf(0, cursor);
                cursor = (translatedEnd >= 0 ? translatedEnd : cursor) + 1;
                const textData = data.subarray(cursor);
                chunks[keyword] = compressionFlag === 1 ? inflateSync(textData).toString('utf8') : textData.toString('utf8');
            }
        }
    }
    return chunks;
}

function decodeMaybeBase64Json(value) {
    const trimmed = String(value || '').trim();
    if (trimmed.startsWith('{')) {
        return trimmed;
    }
    return Buffer.from(trimmed, 'base64').toString('utf8');
}

function cleanDisplayText(value) {
    return localizeOpeningMacros(value)
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\s*(?:think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*(?:think|thinking|thought|reasoning)\s*>/gi, '')
        .replace(/\[(?:think|thinking|thought|reasoning)\][\s\S]*?\[\/(?:think|thinking|thought|reasoning)\]/gi, '')
        .replace(/```(?:think|thinking|thought|reasoning)[\s\S]*?```/gi, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function localizeOpeningMacros(value) {
    return String(value || '')
        .replace(/\{\{\s*user\s*\}\}/gi, importPlan.userName)
        .replace(/\{\{\s*char\s*\}\}/gi, importPlan.characterName);
}

function appendInstruction(base, addition) {
    const text = String(base || '').trim();
    const instruction = String(addition || '').trim();
    if (!instruction || text.includes(instruction)) {
        return text;
    }
    return [text, instruction].filter(Boolean).join('\n\n');
}

function arrayValue(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => item !== undefined && item !== null).map((item) => String(item));
    }
    if (typeof value === 'string' && value.trim()) {
        return [value.trim()];
    }
    return [];
}

function numberValue(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function hashBuffer(value) {
    return createHash('sha256').update(value).digest('hex');
}

function hashText(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function stableJson(value) {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableJson(item)).join(',')}]`;
    }
    return `{${Object.keys(value).sort().map((key) => (
        `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
}

function normalizeChatFileId(value) {
    return String(value || '').replace(/\.jsonl$/i, '');
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        const key = value.slice(2);
        const next = values[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = true;
            continue;
        }
        parsed[key] = next;
        index += 1;
    }
    return parsed;
}

async function exists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function toRepoPath(value) {
    return path.relative(repoRoot, value).replace(/\\/g, '/');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    const cookieFetch = async (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...init,
            headers,
        });
        rememberCookies(cookies, response.headers);
        return response;
    };
    cookieFetch.cookieHeader = () => [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    return cookieFetch;
}

function rememberCookies(cookies, headers) {
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

function splitSetCookieHeader(value) {
    return String(value || '').split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}
