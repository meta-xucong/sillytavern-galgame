import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import { SillyTavernOriginalChatBridge } from '../shared/src/sillytavern-adapter.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const force = args.force === true;
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const bridge = new SillyTavernOriginalChatBridge({ baseUrl, fetchImpl: fetchWithCookies });
const character = DEMO_SCENARIO.sillyTavernBindings.characters[0];
const seedId = DEMO_SCENARIO.sillyTavernBindings.chatSeedId;

const result = {
    ok: false,
    baseUrl,
    character: character.id,
    avatar: character.avatar,
    chatSeedId: seedId,
    action: 'none',
    messageCount: 0,
};

try {
    const chats = await bridge.listCharacterChats({ avatar: character.avatar });
    const existing = chats.find((chat) => chat.fileId === seedId || chat.fileName === seedId);
    if (existing && !force) {
        const snapshot = await bridge.getCharacterChat({
            avatar: character.avatar,
            fileName: seedId,
        });
        const messageCount = Math.max(snapshot.length - 1, 0);
        if (messageCount > 0) {
            result.ok = true;
            result.action = 'kept-existing';
            result.messageCount = messageCount;
            console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        }
    }

    const chat = buildSeedChat();
    await bridge.saveCharacterChat({
        avatar: character.avatar,
        characterName: character.id,
        fileName: seedId,
        chat,
    });
    result.ok = true;
    result.action = existing ? 'repaired-empty' : 'created';
    result.messageCount = chat.length - 1;
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    result.error = error.message || String(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
}

function buildSeedChat() {
    return [
        {
            chat_metadata: {},
            user_name: 'unused',
            character_name: 'unused',
        },
        {
            name: '青井',
            is_user: false,
            is_system: false,
            send_date: new Date('2026-07-24T12:00:00.000Z').toISOString(),
            mes: '雨见町的午后，旧教学楼的窗边还留着昨夜的雨痕。青井抱着一叠被风吹乱的讲义站在那里，像是早就知道你会推门进来。',
            extra: {},
        },
        {
            name: '青井',
            is_user: false,
            is_system: false,
            send_date: new Date('2026-07-24T12:00:05.000Z').toISOString(),
            mes: '“你终于来了。”她抬起眼，声音很轻，“如果今天也能听见钟楼的回声，也许我们就能找到那封没有寄出的信。”',
            extra: {},
        },
    ];
}

function parseArgs(values) {
    const parsed = {};
    const booleanFlags = new Set(['force']);
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        const key = value.slice(2);
        if (booleanFlags.has(key)) {
            parsed[key] = true;
            continue;
        }
        parsed[key] = values[index + 1];
        index += 1;
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    return async function cookieFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        rememberCookies(cookies, response.headers);
        return response;
    };
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
