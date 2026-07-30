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
const exportDir = path.resolve(repoRoot, args['export-dir'] || '.codex-longrun/research/World-Forge/Samples/Export');
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const client = new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies });
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl,
    fetchImpl: fetchWithCookies,
    now: () => new Date(),
});

const importPlan = {
    source: 'https://github.com/AndreiNicu/World-Forge',
    sourceSample: 'Samples/Export',
    activeArc: 1,
    primaryCharacterName: 'The Underworld & The Heavens',
    primaryCharacterAvatar: 'galgame_imported_lucifer_worlddirector.png',
    primaryCharacterFileName: 'galgame_imported_lucifer_worlddirector',
    companionCharacterName: 'Anna Johansson',
    companionCharacterAvatar: 'galgame_imported_lucifer_anna.png',
    companionCharacterFileName: 'galgame_imported_lucifer_anna',
    activeBundledWorldName: 'Galgame_Imported_Lucifer_Arc1_Bundle',
    presetName: 'Galgame_Imported_Lucifer_Preset',
    chatSeedId: 'galgame-imported-lucifer-seed',
    characters: [
        {
            sourceFile: 'WorldDirector_Card.json',
            importName: 'The Underworld & The Heavens',
            avatar: 'galgame_imported_lucifer_worlddirector.png',
            fileName: 'galgame_imported_lucifer_worlddirector',
            role: 'narrator',
        },
        {
            sourceFile: 'Anna_Card.json',
            importName: 'Anna Johansson',
            avatar: 'galgame_imported_lucifer_anna.png',
            fileName: 'galgame_imported_lucifer_anna',
            role: 'companion',
        },
    ],
    worlds: [
        { sourceFile: 'Lucifer-World_Lorebook.json', importName: 'Galgame_Imported_Lucifer_World', bundleGroup: 'common' },
        { sourceFile: 'Lucifer-WorldDirector_Lorebook.json', importName: 'Galgame_Imported_Lucifer_WorldDirector', bundleGroup: 'common' },
        { sourceFile: 'Lucifer-Anna_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Anna', bundleGroup: 'common' },
        { sourceFile: 'Lucifer-Andrei_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Andrei', bundleGroup: 'common' },
        { sourceFile: 'Lucifer-Anna_Intimacy_Profile.json', importName: 'Galgame_Imported_Lucifer_Anna_Intimacy_Profile', bundleGroup: 'common' },
        { sourceFile: 'Lucifer-Arc1_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Arc1', arc: 1 },
        { sourceFile: 'Lucifer-Arc1_Intimacy_Register.json', importName: 'Galgame_Imported_Lucifer_Arc1_Intimacy_Register', arc: 1 },
        { sourceFile: 'Lucifer-Arc2_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Arc2', arc: 2 },
        { sourceFile: 'Lucifer-Arc2_Intimacy_Register.json', importName: 'Galgame_Imported_Lucifer_Arc2_Intimacy_Register', arc: 2 },
        { sourceFile: 'Lucifer-Arc3_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Arc3', arc: 3 },
        { sourceFile: 'Lucifer-Arc3_Intimacy_Register.json', importName: 'Galgame_Imported_Lucifer_Arc3_Intimacy_Register', arc: 3 },
        { sourceFile: 'Lucifer-Arc4_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Arc4', arc: 4 },
        { sourceFile: 'Lucifer-Arc4_Intimacy_Register.json', importName: 'Galgame_Imported_Lucifer_Arc4_Intimacy_Register', arc: 4 },
        { sourceFile: 'Lucifer-Group_Lorebook.json', importName: 'Galgame_Imported_Lucifer_Group', bundleGroup: 'optional-group' },
    ],
};

const galgameResponseInstruction = [
    '本测试入口面向简体中文玩家。除非玩家明确要求其他语言，所有旁白、对白、内心动作、行动建议都必须使用自然的简体中文。',
    '保留原角色名和地点名，例如 Andrei、Anna、Black、Bubbles、Jack、Los Angeles；不要把名字硬翻译成中文。',
    '以视觉小说节奏推进：每次回复必须让当前 Arc/Beat 至少发生一个可观察变化，例如人物靠近、信息揭示、威胁升级、关系张力变化或场景状态改变。',
    '单次回复控制在 350 到 900 个中文字符。不要输出超长段落；如果还有更多内容，先完成当前段落和行动列表，让玩家决定下一步。',
    '不要原地复述同一个气氛。不要用“等待玩家决定”替代剧情推进。世界会移动，NPC 会行动。',
    '每次回复末尾必须追加一个可见行动列表，格式必须是：',
    '可选行动：',
    '1. 当前场景内可执行的短行动',
    '2. 另一个当前场景内可执行的短行动',
    '3. 可选的第三个短行动',
    '这些行动只是普通玩家输入建议。不要提前写出选择结果，也不要提到系统、模型、API、提示词、角色卡或世界书。',
].join('\n');

const worldDirectorOpeningMessage = [
    '*雨已经连续下了三天。顶层公寓的落地窗外，洛杉矶被昏黄的水光压低，街道像一张还没有干透的旧照片。电梯间安静得不正常，三名男人守在入口处，没有人真正放松。*',
    '',
    '*Black 先听见了电梯上行的声音。他没有回头，只把手从外套口袋里抽出来，指节在灯下白了一瞬。Bubbles 仍靠着墙，像一尊过于庞大的影子。Andrei 站在窗前，没有转身。*',
    '',
    '*叮。*',
    '',
    '*电梯门缓缓打开。一个女人站在那里，脸色苍白，雨水和疲惫把她整个人压得很低。她记住了这个楼层，也付出了代价才来到这里。她的名字是 Anna。她以为自己知道接下来会发生什么，但这间公寓里的每个人，都比她想象得更危险，也更难预测。*',
    '',
    '可选行动：',
    '1. 让 Black 先开口，确认 Anna 为什么会找到这里。',
    '2. 让 Andrei 转身，直接问 Anna 想从他这里得到什么。',
    '3. 保持沉默，观察 Anna 进入公寓后的第一个反应。',
].join('\n');

const annaOpeningMessage = [
    '*电梯门打开时，Anna 几乎站不稳。大理石地面太亮，空气太干净，她忽然意识到自己和这里的一切都不相配。雨水从她的袖口滴下来，她把手缩进外套里，试图藏住颤抖。*',
    '',
    '*她听见自己的声音比想象中更沙哑。*',
    '“我找 Andrei。”',
    '',
    '*没有人立刻回答。那种沉默让她想后退，可电梯门已经在身后合上。*',
    '',
    '可选行动：',
    '1. 抬头看向站在窗边的男人。',
    '2. 先向守在门口的 Black 解释来意。',
    '3. 什么都不说，只努力让自己不要倒下。',
].join('\n');

const result = {
    ok: false,
    baseUrl,
    exportDir,
    plan: importPlan,
    imported: {
        characters: [],
        worlds: [],
        arcBundles: [],
        preset: false,
        chatSeed: false,
    },
};

try {
    const importedWorlds = [];
    const cards = {};

    for (const world of importPlan.worlds) {
        const data = await readJson(path.join(exportDir, world.sourceFile));
        const renamed = renameWorldBook(data, world.importName);
        await saveWorldBook(world.importName, renamed);
        importedWorlds.push({
            ...world,
            data,
        });
        result.imported.worlds.push(world.importName);
    }

    for (const arc of [1, 2, 3, 4]) {
        const bundleName = `Galgame_Imported_Lucifer_Arc${arc}_Bundle`;
        const bundledWorld = createArcBundledWorldBook(importedWorlds, bundleName, arc);
        await saveWorldBook(bundleName, bundledWorld);
        result.imported.arcBundles.push(bundleName);
    }

    const preset = await readJson(path.join(exportDir, 'Lucifer-Lucifer_ChatPreset.json'));
    await savePreset(importPlan.presetName, preset);
    result.imported.preset = true;

    for (const character of importPlan.characters) {
        const card = await readJson(path.join(exportDir, character.sourceFile));
        cards[character.importName] = card;
        await upsertCharacter(card, character);
        result.imported.characters.push({
            name: character.importName,
            avatar: character.avatar,
        });
    }

    await saveOpeningChat(cards[importPlan.primaryCharacterName]);
    result.imported.chatSeed = true;

    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    result.error = error.message || String(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

async function upsertCharacter(card, character) {
    const existing = await client.requestJson('/api/characters/all', {
        method: 'POST',
        body: {},
    });
    const exists = Object.values(existing || {}).some((candidate) => (
        candidate?.avatar === character.avatar
        || candidate?.avatar_url === character.avatar
        || candidate?.name === character.importName
    ));

    if (exists) {
        await editCharacter(card, character);
        return;
    }

    await client.requestJson('/api/characters/create', {
        method: 'POST',
        body: buildCharacterBody(card, character, {
            file_name: character.fileName,
        }),
    });
}

async function editCharacter(card, character) {
    const body = buildCharacterBody(card, character);
    const form = new FormData();
    form.set('avatar_url', character.avatar);
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

function buildCharacterBody(card, character, extra = {}) {
    const data = card.data || {};
    const extensions = data.extensions || {};
    const firstMessage = character.importName === importPlan.primaryCharacterName
        ? worldDirectorOpeningMessage
        : annaOpeningMessage;

    return {
        ...extra,
        ch_name: character.importName,
        description: data.description || '',
        personality: data.personality || '',
        scenario: data.scenario || '',
        first_mes: firstMessage,
        mes_example: data.mes_example || '',
        creator_notes: [
            data.creator_notes || '',
            '',
            `Imported for local Galgame testing from ${importPlan.source} (${importPlan.sourceSample}).`,
            'Imported through existing SillyTavern APIs; the custom player references this card by avatar only.',
        ].join('\n').trim(),
        system_prompt: appendInstruction(data.system_prompt || '', 'You must preserve this World-Forge package semantics, but render all player-facing prose in natural Simplified Chinese unless the player explicitly asks otherwise.'),
        post_history_instructions: appendInstruction(data.post_history_instructions || '', galgameResponseInstruction),
        creator: data.creator || 'World Forge',
        character_version: `${data.character_version || '1.0'}-galgame-import`,
        tags: arrayValue(data.tags).join(','),
        talkativeness: String(extensions.talkativeness ?? 0.5),
        fav: 'false',
        world: importPlan.activeBundledWorldName,
        depth_prompt_prompt: appendInstruction(extensions.depth_prompt?.prompt || '', '必须使用自然简体中文回复，并在末尾按指定格式给出“可选行动”列表。每次回复都要推进一个具体剧情节拍。'),
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
                activeGalgameBundle: importPlan.activeBundledWorldName,
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

async function saveOpeningChat() {
    const chat = [
        {
            chat_metadata: {
                imported_source: importPlan.source,
                source_sample: importPlan.sourceSample,
                fixture: 'worldforge-lucifer',
                active_arc: importPlan.activeArc,
                world_info: importPlan.activeBundledWorldName,
                runtime_application_source: 'sillytavern-chat-metadata-world_info',
            },
            user_name: 'Andrei',
            character_name: importPlan.primaryCharacterName,
        },
        {
            name: importPlan.primaryCharacterName,
            is_user: false,
            is_system: false,
            send_date: new Date('2026-07-25T00:00:00.000Z').toISOString(),
            mes: worldDirectorOpeningMessage,
            extra: {},
        },
    ];

    await chatBridge.saveCharacterChat({
        avatar: importPlan.primaryCharacterAvatar,
        characterName: importPlan.primaryCharacterName,
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

function createArcBundledWorldBook(importedWorlds, name, arc) {
    const includedWorlds = importedWorlds.filter((world) => (
        world.bundleGroup === 'common'
        || world.arc === arc
    ));
    const entries = {};
    let uid = 0;
    for (const world of includedWorlds) {
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
        key: ['Lucifer', 'Andrei', 'Anna', 'Black', 'Bubbles', 'Jack', 'Galgame', '可选行动'],
        keysecondary: [],
        comment: 'Galgame local display adapter - Chinese output, plot beat movement, visible action suggestions',
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
        description: `Combined World-Forge Lucifer Arc ${arc} Galgame test bundle imported from ${importPlan.sourceSample}. Full original lorebooks are also imported separately.`,
        scan_depth: 50,
        token_budget: 8192,
        recursive_scanning: false,
        extensions: {
            imported_source: {
                source: importPlan.source,
                sample: importPlan.sourceSample,
                activeArc: arc,
                bundledFrom: includedWorlds.map((world) => world.importName),
                note: 'The large Group lorebook is imported separately and intentionally not enabled in this default bundle.',
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
