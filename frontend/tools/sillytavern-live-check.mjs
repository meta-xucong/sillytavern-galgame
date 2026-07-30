import { SillyTavernAdapter } from '../shared/src/sillytavern-adapter.js';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';

const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8000');
const strict = args.strict === true;
const strictBindings = args['strict-bindings'] === true;
const fetchWithCookies = createCookieFetch(globalThis.fetch);

const result = {
    ok: false,
    baseUrl,
    generate: false,
    checks: [],
    hints: [],
};

await runCheck('csrf-token', async () => {
    const response = await fetchWithCookies(`${baseUrl}/csrf-token`, {
        method: 'GET',
        credentials: 'include',
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    const data = contentType.includes('application/json') ? JSON.parse(text) : null;
    return {
        ok: response.ok && Boolean(data?.token),
        status: response.status,
        contentType,
        tokenPresent: Boolean(data?.token),
    };
});

const adapter = new SillyTavernAdapter({ baseUrl, fetchImpl: fetchWithCookies });
await runCheck('adapter-health', async () => adapter.healthCheck());
await runCheck('characters-list', async () => {
    const data = await adapter.listCharacters();
    return {
        ok: true,
        count: Array.isArray(data) ? data.length : Object.keys(data || {}).length,
    };
});
await runCheck('worldbooks-list', async () => {
    const data = await adapter.listWorldBooks();
    return {
        ok: true,
        count: Array.isArray(data) ? data.length : Object.keys(data || {}).length,
    };
});
await runCheck('original-resource-bindings-diagnostic', async () => {
    const diagnostic = await adapter.diagnoseOriginalResourceAvailability(DEMO_SCENARIO);
    return {
        ok: strictBindings ? diagnostic.ok : true,
        bindingsReady: diagnostic.ok,
        referenceOnly: diagnostic.referenceOnly,
        checks: diagnostic.checks,
    };
});

result.ok = result.checks.every((check) => check.ok);
if (!result.ok) {
    result.hints.push('确认 baseUrl 指向 SillyTavern 主服务，而不是其他本地代理或上游 API。');
    result.hints.push('如果 SillyTavern 开启登录，需要在同源浏览器会话或受控代理下完成联调。');
    result.hints.push('不要为了联调修改 SillyTavern 后端；应调整部署地址、反向代理或前端适配层配置。');
}

console.log(JSON.stringify(result, null, 2));
if (strict && !result.ok) {
    process.exitCode = 1;
}

async function runCheck(name, executor) {
    try {
        const details = await executor();
        result.checks.push({
            name,
            ok: Boolean(details.ok),
            details,
        });
    } catch (error) {
        result.checks.push({
            name,
            ok: false,
            details: {
                error: error.message || String(error),
            },
        });
    }
}

function parseArgs(values) {
    const parsed = {};
    const booleanFlags = new Set(['strict', 'strict-bindings']);
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            const key = value.slice(2);
            if (booleanFlags.has(key)) {
                parsed[key] = true;
                continue;
            }
            parsed[key] = values[index + 1];
            index += 1;
        }
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
