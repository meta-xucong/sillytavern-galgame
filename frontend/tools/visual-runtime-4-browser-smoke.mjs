import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import WebSocket from 'ws';

import {
    DICTIONARY_HASH,
    DICTIONARY_VERSION,
    VISUAL_RUNTIME_HINTS_VERSION,
    createGlobalDisplayVisualProfile,
    createVisualAssetService,
    encodePng,
} from '../../external-modules/visual-asset-service/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicGameRoot = path.join(repoRoot, 'public', 'game');
const evidencePath = path.resolve(repoRoot, '.codex-longrun/evidence/visual-runtime-4-browser-smoke-v1.json');
const adminToken = 'runtime4-browser-smoke-admin-token';
const adminOrigin = 'http://127.0.0.1';
const fetchForbidden = /\/v1\/player\/visual-bundle|\/v1\/visual-match|assetReadTickets|Authorization|x-api-key|ST key|token/i;

let visualBaseUrl = '';
let playerBaseUrl = '';
let browserProcess = null;
let browser = null;
const servers = [];
const result = {
    ok: false,
    schemaVersion: 'galgame.visual-runtime-4-browser-smoke.v1',
    mode: 'test-only-browser-v2',
    realSillyTavernE2E: false,
    testDouble: true,
    sourceCommit: '',
    provider: { attempted: false, transportStatus: 'test-double', bodyCaptured: false },
    request: { schemaVersion: '', currentMessageHash: '', recentMessageHash: '' },
    decision: { understandingStatus: '', errorCode: '', scores: [], matchedTypes: [] },
    browser: {
        dialogueRenderedBeforeVisual: false,
        providerOriginSeen: false,
        credentialSeen: false,
        horizontalOverflow: false,
        visualContextCalls: 0,
        visualDecisionCalls: 0,
        contentReadCount: 0,
        legacyRouteCalls: 0,
    },
    failures: [],
};

try {
    result.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const staticServer = http.createServer((req, res) => serveStatic(req, res));
    await listen(staticServer);
    servers.push(staticServer);
    playerBaseUrl = serverBaseUrl(staticServer);

    const service = createVisualAssetService({
        adminToken,
        adminOrigins: [adminOrigin],
        corePlayerOrigins: [playerBaseUrl],
        visualAnalyzer: async ({ assetType }) => ({
            description: 'test-only visual analysis for ' + assetType,
            tagCodes: [{
                scene: 'scene.forest',
                character: 'character.human',
                equipment: 'equipment.weapon',
                item: 'item.key',
                skill: 'skill.fireball',
            }[assetType]],
            attributeCodes: [],
            confidence: 0.95,
            analyzerVersion: 'test-only-browser-v2',
        }),
        visualRuntimeAnalyzer: async ({ visibleContext }) => {
            const text = visibleContext.current.text;
            const codeByType = {
                scene: /森林/u.test(text) ? 'scene.forest' : null,
                character: /人类/u.test(text) ? 'character.human' : null,
                equipment: /剑/u.test(text) ? 'equipment.weapon' : null,
                item: /钥匙/u.test(text) ? 'item.key' : null,
                skill: /火球术/u.test(text) ? 'skill.fireball' : null,
            };
            const entities = Object.entries(codeByType)
                .filter(([, code]) => code)
                .map(([entityType, code]) => ({
                    entityType,
                    codes: [code],
                    confidence: 0.95,
                    confidenceBand: 'explicit',
                }));
            return {
                schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
                status: entities.length ? 'ready' : 'ambiguous',
                dictionaryVersion: DICTIONARY_VERSION,
                dictionaryHash: DICTIONARY_HASH,
                entities,
            };
        },
    });
    const visualServer = http.createServer(service.handleRequest);
    await listen(visualServer);
    servers.push(visualServer);
    visualBaseUrl = serverBaseUrl(visualServer);
    const catalog = await prepareCatalog();

    const launched = await launchBrowser();
    browserProcess = launched.process;
    browser = await connectBrowser(launched.port);
    const page = await openPage(browser);
    await injectTestHooks(page.sessionId);
    await navigate(page.sessionId, playerBaseUrl + '/game/');
    await waitForEvaluate(page.sessionId, 'typeof window.__GALGAME_TEST_SET_MANIFEST__ === "function"', 15000);

    const visualProfile = createGlobalDisplayVisualProfile({
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        catalogHash: catalog.catalogHash,
    });
    const release = {
        releaseId: 'release_runtime4_browser',
        scenarioId: 'scenario_runtime4_browser',
        scenarioVersion: '1.0.0',
        activeArcId: 'arc_runtime4_browser',
    };
    const manifest = {
        id: release.scenarioId,
        title: 'RUNTIME-4 浏览器测试',
        version: release.scenarioVersion,
        defaultArcId: release.activeArcId,
        visualPresentation: visualProfile,
        presentation: { defaultBackgroundAsset: '', titleBackgroundAsset: '' },
        resourceBindings: { assets: {}, characters: {} },
    };
    await evaluate(page.sessionId, 'window.__GALGAME_TEST_SET_MANIFEST__(' + JSON.stringify(manifest) + ', { release: ' + JSON.stringify(release) + ' });');
    const message = {
        role: 'character',
        speaker: '人类骑士',
        displayText: '角色: 人类\\n场景: 森林\\n装备: 剑\\n道具: 钥匙\\n技能: 火球术',
        text: '角色: 人类\\n场景: 森林\\n装备: 剑\\n道具: 钥匙\\n技能: 火球术',
    };
    result.request.currentMessageHash = digest(message.text);
    await evaluate(page.sessionId, 'window.__GALGAME_TEST_RENDER_CHAT__(' + JSON.stringify({
        ok: true,
        fileName: 'runtime4-browser-test.json',
        writable: true,
        messages: [message],
    }) + ', { messageIndex: 0 }); window.__RUNTIME4_DIALOGUE_PRESENT_AT__ = performance.now();');
    await waitForEvaluate(page.sessionId, 'document.querySelector("#dialogueText")?.textContent.includes("森林") === true && document.querySelector("#stageBackdrop")?.classList.contains("is-visual-active") === true', 15000);

    const details = await evaluate(page.sessionId, '(() => {' +
        'const calls = window.__RUNTIME4_VISUAL_FETCHES__ || [];' +
        'const decision = [...calls].reverse().find((call) => call.url.endsWith("/v1/core/visual-decisions"));' +
        'const contextCall = calls.find((call) => call.url.endsWith("/v1/core/visual-context"));' +
        'const contentCount = performance.getEntriesByType("resource").filter((entry) => String(entry.name).includes("/v1/core/catalogs/") && String(entry.name).endsWith("/content")).length;' +
        'const icons = [...document.querySelectorAll("#visualIconStrip img")];' +
        'const backdrop = document.querySelector("#stageBackdrop");' +
        'const heroine = document.querySelector(".stage-heroine");' +
        'return { calls, decision, contextCall, contentCount,' +
        'backdropActive: backdrop?.classList.contains("is-visual-active") === true,' +
        'heroineActive: heroine?.classList.contains("is-visual-active") === true,' +
        'iconsActive: icons.length === 3 && icons.every((img) => img.closest(".visual-icon")?.classList.contains("is-visual-active") && img.complete && img.naturalWidth > 0),' +
        'dialogue: String(document.querySelector("#dialogueText")?.textContent || ""),' +
        'dialogueAt: window.__RUNTIME4_DIALOGUE_PRESENT_AT__ || 0,' +
        'horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,' +
        'technicalText: /provider|token|authorization|visual-bundle|visual-match|assetReadTickets/i.test(document.body.innerText),' +
        'backdropImage: getComputedStyle(backdrop).backgroundImage || "",' +
        'heroineImage: getComputedStyle(heroine).backgroundImage || "" };' +
    '})()');
    result.browser.dialogueRenderedBeforeVisual = details.dialogue.includes('森林') && details.dialogueAt > 0;
    result.browser.visualContextCalls = details.calls.filter((call) => call.url.endsWith('/v1/core/visual-context')).length;
    result.browser.visualDecisionCalls = details.calls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length;
    result.browser.contentReadCount = details.contentCount;
    result.browser.legacyRouteCalls = details.calls.filter((call) => fetchForbidden.test(call.url)).length;
    result.browser.providerOriginSeen = details.calls.some((call) => /aiself|anthropic|openai|provider/i.test(call.url));
    result.browser.credentialSeen = details.calls.some((call) => fetchForbidden.test(call.headers || '') || fetchForbidden.test(call.body || ''));
    result.browser.horizontalOverflow = details.horizontalOverflow;
    result.request.schemaVersion = details.decision?.requestBodyJson?.schemaVersion || '';
    result.request.recentMessageHash = details.decision?.requestBodyJson?.visibleContext?.recentHash || '';
    result.decision.understandingStatus = details.decision?.bodyJson?.understandingStatus || '';
    result.decision.errorCode = details.decision?.bodyJson?.errorCode || '';
    result.decision.scores = Array.isArray(details.decision?.bodyJson?.decisions)
        ? details.decision.bodyJson.decisions.map((item) => Number(item.score))
        : [];
    result.decision.matchedTypes = Array.isArray(details.decision?.bodyJson?.decisions)
        ? details.decision.bodyJson.decisions.filter((item) => item.assetId && item.score >= 60).map((item) => item.entityType)
        : [];

    if (!result.browser.dialogueRenderedBeforeVisual) result.failures.push('dialogue was not rendered before current v2 visual presentation');
    if (details.contextCall?.status !== 200) result.failures.push('visual-context did not return 200');
    if (result.request.schemaVersion !== 'galgame.visual-core-visual-decisions-request.v2') result.failures.push('browser did not send current v2 decision schema');
    if (result.browser.visualContextCalls !== 1) result.failures.push('expected one visual-context call, got ' + result.browser.visualContextCalls);
    if (result.browser.visualDecisionCalls !== 1) result.failures.push('expected one visual-decisions call, got ' + result.browser.visualDecisionCalls);
    if (result.decision.understandingStatus !== 'ready') result.failures.push('expected understandingStatus=ready, got ' + result.decision.understandingStatus);
    if (result.decision.scores.length !== 5 || result.decision.scores.some((score) => score < 60)) result.failures.push('current decisions did not meet score threshold for all five visible entities');
    if (!details.backdropActive || !details.heroineActive || !details.iconsActive) result.failures.push('current v2 decisions did not render concrete background, character and icons');
    if (result.browser.contentReadCount < 5) result.failures.push('expected five core content reads, got ' + result.browser.contentReadCount);
    if (result.browser.legacyRouteCalls !== 0) result.failures.push('legacy visual route was called');
    if (result.browser.providerOriginSeen || result.browser.credentialSeen) result.failures.push('provider origin or credential material appeared in browser calls');
    if (result.browser.horizontalOverflow) result.failures.push('desktop viewport has horizontal overflow');
    if (details.technicalText) result.failures.push('technical visual/provider text appeared in player UI');

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }, page.sessionId);
    const mobile = await evaluate(page.sessionId, '({ overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, width: document.documentElement.clientWidth })');
    if (mobile.overflow) result.failures.push('mobile viewport has horizontal overflow');
    if (mobile.width > 390) result.failures.push('mobile viewport width is not constrained');
    result.browser.horizontalOverflow = result.browser.horizontalOverflow || Boolean(mobile.overflow);
    result.ok = result.failures.length === 0;
} catch (error) {
    result.failures.push(sanitizeError(error));
} finally {
    if (browser) await browser.close().catch(() => {});
    if (browserProcess) browserProcess.kill();
    for (const server of servers.reverse()) await closeServer(server);
    await writeFileEvidence(result);
}
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.ok ? 0 : 1;

async function prepareCatalog() {
    const assets = [
        ['scene', '测试森林', ['scene.forest'], [20, 40, 80]],
        ['character', '测试角色', ['character.human'], [180, 180, 220], 180],
        ['equipment', '测试剑', ['equipment.weapon'], [120, 130, 140]],
        ['item', '测试钥匙', ['item.key'], [30, 80, 180]],
        ['skill', '测试火球术', ['skill.fireball'], [220, 80, 30]],
    ];
    for (const asset of assets) {
        const response = await request('/v1/admin/visual/upload', {
            method: 'POST',
            origin: adminOrigin,
            token: adminToken,
            body: {
                schemaVersion: 'galgame.visual-simple-upload-request.v1',
                assetType: asset[0],
                title: asset[1],
                tagCodes: asset[2],
                imageBase64: makePng(asset[3], asset[4]).toString('base64'),
                fileName: asset[0] + '.png',
            },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
    }
    const published = await request('/v1/admin/visual/publish', {
        method: 'POST',
        origin: adminOrigin,
        token: adminToken,
        body: {},
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.visual.ready, true, JSON.stringify(published.body));
    return published.body.catalog;
}

async function serveStatic(req, res) {
    const requestUrl = new URL(req.url || '/', playerBaseUrl || 'http://127.0.0.1');
    if (requestUrl.pathname === '/game/' || requestUrl.pathname === '/game/index.html') {
        const html = readFileSync(path.join(publicGameRoot, 'index.html'), 'utf8')
            .replace(/<meta name="galgame-visual-core-service" content="[^"]*">/u, '<meta name="galgame-visual-core-service" content="' + visualBaseUrl + '">');
        return send(res, 200, 'text/html; charset=utf-8', html);
    }
    const relative = requestUrl.pathname.startsWith('/game/') ? requestUrl.pathname.slice('/game/'.length) : '';
    if (!relative) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const filePath = path.resolve(publicGameRoot, relative);
    const publicGamePrefix = publicGameRoot + path.sep;
    if (!(filePath === publicGameRoot || filePath.startsWith(publicGamePrefix)) || !existsSync(filePath)) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const mime = filePath.endsWith('.js') ? 'text/javascript; charset=utf-8' : filePath.endsWith('.css') ? 'text/css; charset=utf-8' : filePath.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    return send(res, 200, mime, readFileSync(filePath));
}

async function injectTestHooks(sessionId) {
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ = true; window.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;' +
            ' window.__RUNTIME4_VISUAL_FETCHES__ = [];' +
            ' const runtime4OriginalFetch = window.fetch.bind(window);' +
            ' window.fetch = async function(input, init) {' +
            ' const requestUrl = String(typeof input === "string" ? input : input?.url || "");' +
            ' const requestBody = typeof init?.body === "string" ? init.body : "";' +
            ' const entry = { url: requestUrl, method: String(init?.method || "GET"), body: requestBody, headers: JSON.stringify(init?.headers || {}) };' +
            ' window.__RUNTIME4_VISUAL_FETCHES__.push(entry);' +
            ' const response = await runtime4OriginalFetch(input, init); entry.status = response.status;' +
            ' entry.requestBodyJson = JSON.parse(requestBody || "{}"); entry.bodyJson = await response.clone().json().catch(() => null); return response;' +
            ' };',
    }, sessionId);
}

async function navigate(sessionId, url) {
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.navigate', { url }, sessionId);
}

async function openPage(client) {
    const target = await client.send('Target.createTarget', { url: 'about:blank' });
    const sessionId = (await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false }, sessionId);
    await client.send('Runtime.enable', {}, sessionId);
    await client.send('Page.enable', {}, sessionId);
    return { sessionId };
}

async function evaluate(sessionId, expression) {
    const response = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || JSON.stringify(response.exceptionDetails));
    return response.result?.value;
}

async function waitForEvaluate(sessionId, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate(sessionId, expression).catch(() => false)) return;
        await delay(100);
    }
    throw new Error('timed out: ' + expression);
}

async function connectBrowser(port) {
    const version = await fetch('http://127.0.0.1:' + port + '/json/version').then((response) => response.json());
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.on('message', (raw) => {
        const message = JSON.parse(String(raw));
        if (message.id && pending.has(message.id)) {
            const item = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) item.reject(new Error(message.error.message || 'CDP command failed'));
            else item.resolve(message.result);
        } else {
            for (const listener of listeners) listener(message);
        }
    });
    return {
        send(method, params = {}, sessionId = null) {
            const requestId = ++id;
            socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
            return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
        },
        async close() { socket.close(); },
    };
}

async function launchBrowser() {
    const executable = findChrome();
    const port = await getFreePort();
    const profile = path.join(tmpdir(), 'runtime4-browser-' + Date.now().toString(36));
    const child = spawn(executable, [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--remote-debugging-port=' + port,
        '--user-data-dir=' + profile,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('browser exited before remote debugging started');
        if (await fetch('http://127.0.0.1:' + port + '/json/version').then((response) => response.ok).catch(() => false)) return { process: child, port };
        await delay(100);
    }
    child.kill();
    throw new Error('browser remote debugging did not start');
}

async function request(pathname, options = {}) {
    const headers = {};
    if (options.origin) headers.origin = options.origin;
    if (options.token) headers.authorization = 'Bearer ' + options.token;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(visualBaseUrl + pathname, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
}

async function fetchJson(url, origin) {
    const response = await fetch(url, { headers: { origin } });
    return response.json();
}

function makePng(rgb, alpha = 255) {
    const width = 2;
    const height = 2;
    const channels = alpha === 255 ? 3 : 4;
    const scanlines = Buffer.alloc((width * channels + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const row = y * (width * channels + 1);
        scanlines[row] = 0;
        for (let x = 0; x < width; x += 1) {
            const offset = row + 1 + x * channels;
            scanlines[offset] = rgb[0];
            scanlines[offset + 1] = rgb[1];
            scanlines[offset + 2] = rgb[2];
            if (channels === 4) scanlines[offset + 3] = alpha;
        }
    }
    return encodePng({ width, height, bitDepth: 8, colorType: channels === 4 ? 6 : 2, compression: 0, filter: 0, interlace: 0 }, scanlines);
}

function digest(value) {
    return 'sha256:' + createHash('sha256').update(String(value)).digest('hex');
}

function serverBaseUrl(server) {
    return 'http://127.0.0.1:' + server.address().port;
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

function send(res, status, type, body) {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }
    throw new Error('Chrome or Edge executable not found');
}

function sanitizeError(error) {
    return String(error?.message || error || 'UNKNOWN')
        .replace(/(sk-[A-Za-z0-9_-]{8,}|Bearer\\s+\\S+|x-api-key\\s*[:=]\\s*\\S+)/gi, '[redacted]')
        .slice(0, 240);
}

async function writeFileEvidence(value) {
    const output = { ...value, generatedAt: new Date().toISOString() };
    writeFileSync(evidencePath, JSON.stringify(output, null, 2) + '\n', 'utf8');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
