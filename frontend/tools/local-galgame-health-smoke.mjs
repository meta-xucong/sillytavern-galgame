const args = parseArgs(process.argv.slice(2));
const playerUrl = normalizeBaseUrl(args['player-url'] || 'http://127.0.0.1:8000');
const configUrl = normalizeBaseUrl(args['config-url'] || 'http://127.0.0.1:8791');
const bridgeCandidates = String(args['bridge-urls'] || 'http://127.0.0.1:8795,http://127.0.0.1:8798,http://127.0.0.1:8799,http://127.0.0.1:8800,http://127.0.0.1:8796,http://127.0.0.1:8797')
    .split(',')
    .map(normalizeBaseUrl)
    .filter(Boolean);

const failures = [];
const configHealth = await fetchJson(`${configUrl}/v1/health`).catch((error) => {
    failures.push(`config service health unavailable: ${error.message}`);
    return null;
});
if (configHealth && !configHealth.ok) {
    failures.push('config service health is not ok');
}
if (configHealth && !configHealth.runtimeProof?.configured) {
    failures.push('config service runtime proof is not configured');
}

const playableStories = await fetchJson(`${configUrl}/v1/scenarios`).catch((error) => {
    failures.push(`playable story list unavailable: ${error.message}`);
    return null;
});
if (playableStories && !Array.isArray(playableStories.entries)) {
    failures.push('playable story list has no entries array');
}
if (playableStories && playableStories.entries.length < 1) {
    failures.push('playable story list is empty');
}

const playerHtml = await fetchText(`${playerUrl}/game/`).catch((error) => {
    failures.push(`player page unavailable: ${error.message}`);
    return '';
});
if (playerHtml && !/\.\/app\.js\?v=auto-[a-f0-9]{12}/.test(playerHtml)) {
    failures.push('player app script is not using automatic cache-busting');
}
if (playerHtml && !/\.\/styles\.css\?v=auto-[a-f0-9]{12}/.test(playerHtml)) {
    failures.push('player stylesheet is not using automatic cache-busting');
}

const bridgeChecks = await Promise.all(bridgeCandidates.map(async (url, index) => {
    const health = await fetchJson(`${url}/health`, { timeoutMs: 1200 }).catch(() => null);
    if (!health?.ok || health.stopping || health.authRequired) {
        return null;
    }
    return {
        url,
        index,
        browser: Boolean(health.browser),
        pending: Boolean(health.pending),
        proofRequired: Boolean(health.proofRequired),
        score: (health.browser ? 2 : 0) + (health.pending ? -1 : 0),
    };
}));
const bridge = bridgeChecks
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0] || null;
if (!bridge) {
    failures.push('original runtime bridge is not discoverable');
} else if (!bridge.proofRequired) {
    failures.push('original runtime bridge does not require runtime proof');
}

const result = {
    ok: failures.length === 0,
    config: configHealth && {
        ok: Boolean(configHealth.ok),
        active: Boolean(configHealth.active),
        playableStories: Number(configHealth.playableStories || 0),
        runtimeProofConfigured: Boolean(configHealth.runtimeProof?.configured),
    },
    bridge,
    player: {
        url: `${playerUrl}/game/`,
        autoVersioned: Boolean(playerHtml && /v=auto-[a-f0-9]{12}/.test(playerHtml)),
    },
    failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
    process.exitCode = 1;
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
            parsed[key] = 'true';
        } else {
            parsed[key] = next;
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

async function fetchJson(url, { timeoutMs = 3000 } = {}) {
    const response = await fetchWithTimeout(url, { timeoutMs });
    if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
    }
    return response.json();
}

async function fetchText(url, { timeoutMs = 3000 } = {}) {
    const response = await fetchWithTimeout(url, { timeoutMs });
    if (!response.ok) {
        throw new Error(`HTTP_${response.status}`);
    }
    return response.text();
}

async function fetchWithTimeout(url, { timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            method: 'GET',
            cache: 'no-cache',
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }
}
