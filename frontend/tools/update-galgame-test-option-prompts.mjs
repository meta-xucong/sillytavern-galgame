import { SillyTavernHttpClient } from '../shared/src/sillytavern-adapter.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const avatar = 'galgame_test_aoi.png';
const worldName = 'Galgame_Test_RainTown';
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const client = new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies });

const optionInstruction = [
    '保持日式 Galgame 的克制氛围。优先使用雨见町、雨音堂、银色风铃、明信片和夏日约定等已存在于角色卡与世界书中的原版资源信息。不要提到测试、接口或系统。',
    '每次角色回复正文控制在 80-180 个中文字，避免长篇解释。',
    '每次回复末尾必须追加“可选行动：”并列出 2-3 个玩家下一步可做的短行动。格式必须是：',
    '可选行动：',
    '1. 简短行动',
    '2. 简短行动',
    '3. 简短行动',
    '可选行动必须来自当前剧情场景，不要写成系统说明，不要替玩家决定结果。',
].join('\n');

const depthPrompt = [
    '青井的台词要简短、有留白；情绪通过动作和雨声表现，不直接解释。',
    '回复末尾必须用“可选行动：”列出 2-3 个玩家可选择的短行动，供视觉小说界面显示。',
].join('\n');

const worldOptionEntryContent = [
    '【Galgame 互动格式】',
    '为了让故事以视觉小说方式推进，青井每次回复末尾都要提供 2-3 个可选行动。',
    '固定格式：',
    '可选行动：',
    '1. 一个玩家可以立刻做出的短行动',
    '2. 另一个玩家可以立刻做出的短行动',
    '3. 第三个可选短行动',
    '这些行动只描述玩家可以尝试的下一步，不揭示结果，不提到系统、模型、接口或提示词。',
].join('\n');

const result = {
    ok: false,
    baseUrl,
    character: 'Galgame_Test_Aoi',
    avatar,
    worldName,
    characterUpdated: false,
    worldUpdated: false,
};

try {
    const character = await client.requestJson('/api/characters/get', {
        method: 'POST',
        body: { avatar_url: avatar },
    });
    if (character?.name !== 'Galgame_Test_Aoi') {
        throw new Error(`Unexpected character: ${character?.name || 'unknown'}`);
    }

    await editCharacter(character);
    result.characterUpdated = true;

    const world = await client.requestJson('/api/worldinfo/get', {
        method: 'POST',
        body: { name: worldName },
    });
    const nextWorld = updateWorldOptionEntry(world);
    await client.requestJson('/api/worldinfo/edit', {
        method: 'POST',
        body: {
            name: worldName,
            data: nextWorld,
        },
    });
    result.worldUpdated = true;
    result.ok = true;
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    result.error = error.message || String(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

async function editCharacter(character) {
    const data = character.data || {};
    const extensions = data.extensions || {};
    const form = new FormData();
    form.set('avatar_url', avatar);
    form.set('ch_name', data.name || character.name || 'Galgame_Test_Aoi');
    form.set('description', data.description || character.description || '');
    form.set('personality', data.personality || character.personality || '');
    form.set('scenario', data.scenario || character.scenario || '');
    form.set('first_mes', data.first_mes || character.first_mes || '');
    form.set('mes_example', data.mes_example || character.mes_example || '');
    form.set('creator_notes', data.creator_notes || character.creatorcomment || '');
    form.set('system_prompt', data.system_prompt || '');
    form.set('post_history_instructions', optionInstruction);
    form.set('creator', data.creator || 'Codex fixture');
    form.set('character_version', '2026-07-25-option-actions');
    form.set('tags', arrayValue(data.tags || character.tags).join(','));
    form.set('talkativeness', String(extensions.talkativeness ?? character.talkativeness ?? 0.7));
    form.set('fav', String(Boolean(extensions.fav ?? character.fav ?? false)));
    form.set('world', extensions.world || worldName);
    form.set('depth_prompt_prompt', depthPrompt);
    form.set('depth_prompt_depth', String(extensions.depth_prompt?.depth ?? 4));
    form.set('depth_prompt_role', extensions.depth_prompt?.role || 'system');
    form.set('chat', character.chat || '');
    form.set('create_date', character.create_date || new Date().toISOString());
    form.set('json_data', character.json_data || JSON.stringify(character));

    for (const greeting of arrayValue(data.alternate_greetings)) {
        form.append('alternate_greetings', greeting);
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

function updateWorldOptionEntry(world) {
    const next = world && typeof world === 'object' ? structuredClone(world) : { entries: {} };
    next.entries ||= {};
    const existingKey = Object.keys(next.entries).find((key) => (
        next.entries[key]?.comment === 'Galgame native-first fixture: option output format'
    ));
    const uid = existingKey !== undefined
        ? Number(existingKey)
        : nextUid(next.entries);
    const baseEntry = next.entries[String(uid)] || next.entries[Object.keys(next.entries)[0]] || {};
    next.entries[String(uid)] = {
        ...baseEntry,
        uid,
        key: ['Galgame_Test_Aoi', '青井', '雨见町', '银色风铃', '可选行动'],
        keysecondary: [],
        comment: 'Galgame native-first fixture: option output format',
        content: worldOptionEntryContent,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: 120,
        position: 0,
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
        useProbability: true,
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
    return next;
}

function nextUid(entries) {
    return Object.values(entries)
        .map((entry) => Number(entry?.uid))
        .filter(Number.isFinite)
        .reduce((max, value) => Math.max(max, value), -1) + 1;
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
