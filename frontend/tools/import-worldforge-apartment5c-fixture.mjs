import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const exportDir = path.resolve(
    repoRoot,
    args['export-dir'] || '.codex-longrun/research/World-Forge/Samples/Apartment_Test_Director/Export',
);
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const client = new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies });
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl,
    fetchImpl: fetchWithCookies,
    now: () => new Date(),
});

const importPlan = {
    source: 'https://github.com/AndreiNicu/World-Forge',
    sourceSample: 'Samples/Apartment_Test_Director/Export',
    characterName: 'Apartment 5C',
    characterAvatar: 'galgame_imported_apartment5c.png',
    characterFileName: 'galgame_imported_apartment5c',
    bundledWorldName: 'Galgame_Imported_Apartment5C_Bundle',
    presetName: 'Galgame_Imported_Apartment5C_Preset',
    chatSeedId: 'galgame-imported-apartment5c-seed',
    originalWorlds: [
        {
            sourceFile: 'Apartment_World_Lorebook.json',
            importName: 'Galgame_Imported_Apartment5C_World',
        },
        {
            sourceFile: 'Apartment_NPC_Lorebook.json',
            importName: 'Galgame_Imported_Apartment5C_NPCs',
        },
        {
            sourceFile: 'Sandbox_Lorebook.json',
            importName: 'Galgame_Imported_Apartment5C_Sandbox',
        },
    ],
};

const galgameResponseInstruction = [
    '本测试入口面向简体中文玩家。除非玩家明确要求其他语言，所有角色对白、旁白、环境描写和可选行动都必须使用自然的简体中文。',
    '不要输出英文叙事、英文对白或中英混杂文本。角色名可以保留原名，例如 Sam、Priya、Theo、Nadia。',
    '每次回复只推进一个具体的当下场景节拍，保持视觉小说式的临场感，然后把行动权交回给 Sam。',
    '每次角色回复末尾必须追加一个可见行动列表，格式必须是：',
    '可选行动：',
    '1. 玩家此刻可以尝试的短行动',
    '2. 另一个当前场景内可行的短行动',
    '3. 可选的第三个短行动',
    '这些行动只是普通玩家输入建议。不要提前写出选择结果，也不要提到系统、模型、API、提示词、角色卡或世界书。',
].join('\n');

const localizedOpeningMessage = [
    '*星期二，晚上九点刚过。5C 公寓的厨房又进入了熟悉的夜间状态：人太多，台面太少。Priya 把餐桌占成了临时书桌，摊开的课本旁放着一杯早就凉掉的咖啡；走廊那头，Theo 正抱着没插电的吉他，一遍又一遍地弹同样四个小节；Nadia 站在炉灶前搅着锅里真正像晚饭的东西，香味慢慢漫出来。*',
    '',
    '*Nadia 没有回头。*',
    '“Sam，你来得正好，可以派上用场。盘子难得是干净的，拿三个。要是 Theo 还记得人类需要吃饭，就拿四个。”',
    '',
    '*餐桌边，Priya 头也不抬地翻了一页。*',
    '“他不会的。”她平静地说，“鉴别诊断：他又进入神游状态了。”',
    '',
    '可选行动：',
    '1. 去橱柜拿盘子，顺便看看 Nadia 锅里煮了什么。',
    '2. 坐到 Priya 对面，问她今天为什么这么严肃。',
    '3. 朝走廊喊 Theo 一声，提醒他晚饭快好了。',
].join('\n');

const result = {
    ok: false,
    baseUrl,
    exportDir,
    plan: importPlan,
    imported: {
        character: false,
        worlds: [],
        bundledWorld: false,
        preset: false,
        chatSeed: false,
    },
};

try {
    const card = await readJson(path.join(exportDir, 'WorldDirector_Card.json'));
    const preset = await readJson(path.join(exportDir, 'Apartment5C_ChatPreset.json'));
    const originalWorlds = [];

    for (const world of importPlan.originalWorlds) {
        const data = await readJson(path.join(exportDir, world.sourceFile));
        const renamed = renameWorldBook(data, world.importName);
        await saveWorldBook(world.importName, renamed);
        originalWorlds.push({
            sourceFile: world.sourceFile,
            importName: world.importName,
            data,
        });
        result.imported.worlds.push(world.importName);
    }

    const bundledWorld = createBundledWorldBook(originalWorlds, importPlan.bundledWorldName);
    await saveWorldBook(importPlan.bundledWorldName, bundledWorld);
    result.imported.bundledWorld = true;

    await savePreset(importPlan.presetName, preset);
    result.imported.preset = true;

    await upsertCharacter(card);
    result.imported.character = true;

    await saveOpeningChat(card);
    result.imported.chatSeed = true;

    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    result.error = error.message || String(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

async function upsertCharacter(card) {
    const existing = await client.requestJson('/api/characters/all', {
        method: 'POST',
        body: {},
    });
    const exists = Object.values(existing || {}).some((character) => (
        character?.avatar === importPlan.characterAvatar
        || character?.avatar_url === importPlan.characterAvatar
        || character?.name === importPlan.characterName
    ));

    if (exists) {
        await editCharacter(card);
        return;
    }

    await client.requestJson('/api/characters/create', {
        method: 'POST',
        body: buildCharacterBody(card, {
            file_name: importPlan.characterFileName,
        }),
    });
}

async function editCharacter(card) {
    const body = buildCharacterBody(card);
    const form = new FormData();
    form.set('avatar_url', importPlan.characterAvatar);
    for (const [key, value] of Object.entries(body)) {
        if (key === 'file_name') {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                form.append(key, item);
            }
        } else {
            form.set(key, String(value ?? ''));
        }
    }

    const token = await client.getCsrfToken();
    const response = await fetch(`${baseUrl}/api/characters/edit`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': token,
            Cookie: fetchWithCookies.cookieHeader(),
        },
        body: form,
    });
    fetchWithCookies.remember(response.headers);
    if (!response.ok) {
        throw new Error(`CHARACTER_EDIT_FAILED_${response.status}`);
    }
}

function buildCharacterBody(card, extra = {}) {
    const data = card.data || {};
    const extensions = data.extensions || {};
    return {
        ...extra,
        ch_name: importPlan.characterName,
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: localizedOpeningMessage,
        mes_example: data.mes_example || '',
        creator_notes: [
            data.creator_notes || '',
            '',
            `Imported for local Galgame testing from ${importPlan.source} (${importPlan.sourceSample}).`,
            'Imported through existing SillyTavern APIs; the custom player references this card by avatar only.',
        ].join('\n').trim(),
        system_prompt: data.system_prompt || '',
        post_history_instructions: appendInstruction(data.post_history_instructions || '', galgameResponseInstruction),
        creator: data.creator || 'World Forge',
        character_version: `${data.character_version || '1.0'}-galgame-import`,
        tags: arrayValue(data.tags).join(','),
        talkativeness: String(extensions.talkativeness ?? 0.5),
        fav: 'false',
        world: importPlan.bundledWorldName,
        depth_prompt_prompt: appendInstruction(extensions.depth_prompt?.prompt || '', '必须使用自然简体中文回复，并在末尾按指定格式给出“可选行动”列表。'),
        depth_prompt_depth: String(extensions.depth_prompt?.depth ?? 4),
        depth_prompt_role: extensions.depth_prompt?.role || 'system',
        alternate_greetings: arrayValue(data.alternate_greetings),
        extensions: JSON.stringify({
            ...extensions,
            imported_source: {
                source: importPlan.source,
                sample: importPlan.sourceSample,
                originalName: data.name || card.name || '',
                importedAt: new Date().toISOString(),
            },
        }),
        json_data: JSON.stringify(card),
    };
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

async function savePreset(name, preset) {
    await client.requestJson('/api/presets/save', {
        method: 'POST',
        body: {
            apiId: 'openai',
            name,
            preset,
        },
    });
}

async function saveOpeningChat(card) {
    const firstMessage = sanitizeMultiline(localizedOpeningMessage);
    if (!firstMessage) {
        throw new Error('WORLD_FORGE_CARD_HAS_NO_FIRST_MESSAGE');
    }

    const chat = [
        {
            chat_metadata: {
                imported_source: importPlan.source,
                source_sample: importPlan.sourceSample,
                fixture: 'worldforge-apartment5c',
            },
            user_name: 'Sam',
            character_name: importPlan.characterName,
        },
        {
            name: importPlan.characterName,
            is_user: false,
            is_system: false,
            send_date: new Date('2026-07-25T00:00:00.000Z').toISOString(),
            mes: firstMessage,
            extra: {},
        },
    ];

    await chatBridge.saveCharacterChat({
        avatar: importPlan.characterAvatar,
        characterName: importPlan.characterName,
        fileName: importPlan.chatSeedId,
        chat,
    });
}

function renameWorldBook(world, name) {
    return {
        ...structuredClone(world),
        name,
        description: [
            world.description || '',
            `Imported from ${importPlan.sourceSample}.`,
        ].filter(Boolean).join(' '),
        extensions: {
            ...(world.extensions || {}),
            imported_source: {
                source: importPlan.source,
                sample: importPlan.sourceSample,
                originalName: world.name || '',
            },
        },
    };
}

function createBundledWorldBook(originalWorlds, name) {
    const entries = {};
    let uid = 0;
    for (const world of originalWorlds) {
        for (const entry of Object.values(world.data.entries || {})) {
            entries[String(uid)] = {
                ...structuredClone(entry),
                uid,
                comment: `[${world.importName}] ${entry.comment || `Entry ${entry.uid ?? uid}`}`,
                displayIndex: uid,
            };
            uid += 1;
        }
    }

    entries[String(uid)] = {
        uid,
        key: ['Apartment 5C', 'Priya', 'Theo', 'Nadia', 'Sam', 'Galgame', '可选行动'],
        keysecondary: [],
        comment: 'Galgame local display adapter - language and visible action options',
        content: galgameResponseInstruction,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 1,
        position: 1,
        disable: false,
        ignoreBudget: false,
        excludeRecursion: false,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: false,
        depth: 4,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: 0,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
    };

    return {
        name,
        description: `Combined World-Forge Apartment 5C test world imported from ${importPlan.sourceSample}.`,
        scan_depth: 50,
        token_budget: 4096,
        recursive_scanning: false,
        extensions: {
            imported_source: {
                source: importPlan.source,
                sample: importPlan.sourceSample,
                bundledFrom: originalWorlds.map((world) => world.importName),
            },
        },
        entries,
    };
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

function sanitizeMultiline(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function appendInstruction(base, addition) {
    return [sanitizeMultiline(base), sanitizeMultiline(addition)].filter(Boolean).join('\n\n');
}

function arrayValue(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        parsed[value.slice(2)] = values[index + 1];
        index += 1;
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
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
