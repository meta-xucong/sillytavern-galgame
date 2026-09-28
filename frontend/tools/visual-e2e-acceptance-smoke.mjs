import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import { bindAdaptivePresentationProfileHashes } from '../shared/src/protocol.js';
import { normalizeOriginalVisibleChatMessages } from '../shared/src/sillytavern-adapter.js';
import {
    CATALOG_DRAFT_SCHEMA_VERSION,
    DICTIONARY_HASH,
    DICTIONARY_VERSION,
    FileVisualBindingStore,
    MemoryContentStore,
    MemoryProofReplayStore,
    MemoryVisualAssetStore,
    UPLOAD_SCHEMA_VERSION,
    createVisualAssetService,
    encodePng,
} from '../../external-modules/visual-asset-service/server.mjs';
import {
    MemoryConfigStore,
    MemoryVisualProjectionStore,
    createConfigService,
} from '../../external-modules/game-config-service/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicGameRoot = path.join(repoRoot, 'public', 'game');
const csrfToken = 'csrf-token-visual-e2e-0001';
const playerSessionId = 'player-session-visual-e2e-0001';
const chatId = 'galgame-visual-e2e-chat';
const adminToken = 'visual-e2e-admin-token';
const visualProjectionSecret = 'visual-e2e-projection-secret';
const visualProjectionStubToken = 'visual-e2e-projection-stub-token-0001';
const visualMatchServiceToken = 'visual-e2e-match-service-token-000001';
const visualAssetInternalReadToken = 'visual-e2e-asset-read-token-000001';

const routeLog = [];
const proxyLog = [];

async function main() {
    const tmpRoot = mkdtempSync(path.join(tmpdir(), 'galgame-visual-e2e-'));
    const servers = [];
    let chrome = null;
    try {
        const assetService = await startVisualAssetService(servers, tmpRoot);
        const staticEntry = await startStaticEntry(servers);
        const configService = await startConfigService(servers, assetService, staticEntry.baseUrl);
        assetService.setGameConfigBaseUrl(configService.baseUrl);
        staticEntry.setConfigBaseUrl(configService.baseUrl);
        chrome = await launchBrowser();
        const browser = await connectBrowser(chrome.debugPort);
        const result = await runPlayerVisualAcceptance(browser, staticEntry.baseUrl);
        await browser.send('Browser.close').catch(() => {});
        const output = createOutput({ result, assetService, configService, staticEntry });
        console.log(JSON.stringify(output, null, 2));
        process.exitCode = output.ok ? 0 : 1;
    } finally {
        chrome?.process?.kill();
        for (const server of servers.reverse()) {
            await closeServer(server);
        }
        rmSync(tmpRoot, { recursive: true, force: true });
    }
}

async function startVisualAssetService(servers, tmpRoot) {
    let gameConfigBaseUrl = '';
    const service = createVisualAssetService({
        adminToken,
        adminOrigins: ['http://127.0.0.1'],
        visualProjectionSecret,
        visualMatchServiceToken,
        visualAssetInternalReadToken,
        projectionStubServiceToken: visualProjectionStubToken,
        projectionStubReader: async (projectionId) => {
            if (!gameConfigBaseUrl) throw new Error('PROJECTION_STUB_READER_UNCONFIGURED');
            const response = await fetch(`${gameConfigBaseUrl}/v1/visual/projection-stubs/${encodeURIComponent(projectionId)}`, {
                method: 'GET',
                headers: { authorization: `Bearer ${visualProjectionStubToken}`, accept: 'application/json' },
                redirect: 'manual',
            });
            if (!response.ok) throw new Error('PROJECTION_STUB_READER_FAILED');
            return response.json();
        },
        bindingStore: new FileVisualBindingStore(path.join(tmpRoot, 'bindings')),
        proofReplayStore: new MemoryProofReplayStore(),
        assetStore: new MemoryVisualAssetStore(),
        contentStore: new MemoryContentStore(),
    });
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (pathname.startsWith('/v1/internal/')) {
            const entry = { service: 'visual-asset-service', method: req.method, path: pathname };
            routeLog.push(entry);
            captureJsonResponseSummary(res, entry);
            res.on('finish', () => {
                entry.status = res.statusCode;
            });
        }
        service.handleRequest(req, res);
    });
    await listen(server);
    servers.push(server);
    const baseUrl = serverBaseUrl(server);
    const uploads = [];
    for (const spec of visualAssetSpecs()) {
        uploads.push(await uploadAsset(baseUrl, spec));
    }
    const catalog = await publishCatalog(baseUrl, 'vc_visuale2e01', 1, uploads.map((asset) => ({
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
    })));
    return {
        baseUrl,
        catalog,
        setGameConfigBaseUrl(value) {
            gameConfigBaseUrl = value;
        },
    };
}

async function startConfigService(servers, assetService, playerOrigin) {
    const store = new MemoryConfigStore();
    const visualScope = {
        profileId: 'vprof_visuale2e01',
        profileHash: prefixedSha256('visual-e2e-profile'),
        catalogId: assetService.catalog.catalog.catalogId,
        catalogRevision: assetService.catalog.catalog.catalogRevision,
        catalogHash: assetService.catalog.catalog.catalogHash,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
    };
    const manifest = withVisualScope(bindAdaptivePresentationProfileHashes(DEMO_SCENARIO), visualScope);
    await store.saveManifest(manifest);
    const release = await store.publish(manifest.id, manifest.version, { activeArcId: manifest.defaultArcId });
    const server = createConfigService({
        store,
        visualProjectionSecret,
        visualProjectionStubServiceToken: visualProjectionStubToken,
        visualProjectionTtlMs: 60000,
        visualProjectionStore: new MemoryVisualProjectionStore({ rateLimit: 20 }),
        originalChatBridge: createFakeOriginalChatBridge({
            [DEMO_SCENARIO.sillyTavernBindings.chatSeedId]: seedChat(),
            [chatId]: visualChat(),
        }),
        playerVisualGatewayOrigins: playerOrigin,
        playerVisualGatewayTrustedProxyMode: 'required',
        playerVisualSessionReader: async (sessionId) => {
            if (sessionId !== playerSessionId) {
                const error = new Error('VISUAL_PLAYER_AUTH_REQUIRED');
                error.status = 401;
                error.code = 'VISUAL_PLAYER_AUTH_REQUIRED';
                throw error;
            }
            return { csrfToken, chatId };
        },
        visualMatchInternalBaseUrl: assetService.baseUrl,
        visualMatchServiceToken,
        visualAssetServiceBaseUrl: assetService.baseUrl,
        visualAssetInternalReadToken,
    });
    server.on('request', (req) => {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        if (
            pathname === '/v1/releases/active'
            || /^\/v1\/scenarios\/[^/]+\/versions\/[^/]+\/manifest$/.test(pathname)
            || pathname === '/v1/player/visual-bundle'
            || pathname.startsWith('/v1/player/visual-assets/')
            || pathname.startsWith('/v1/visual/projection-stubs/')
        ) {
            const entry = { service: 'game-config-service', method: req.method, path: pathname };
            routeLog.push(entry);
        }
    });
    await listen(server);
    servers.push(server);
    return { baseUrl: serverBaseUrl(server), release, manifest, visualScope };
}

async function startStaticEntry(servers) {
    const state = { lastBundle: null, readOnlyFiles: new Set() };
    let configBaseUrl = '';
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            if (url.pathname === '/v1/releases/active') {
                return proxyReadonlyConfig(req, res, configBaseUrl, '/v1/releases/active', state);
            }
            const manifestMatch = /^\/v1\/scenarios\/([A-Za-z0-9._:-]{1,120})\/versions\/([A-Za-z0-9._:-]{1,80})\/manifest$/.exec(url.pathname);
            if (manifestMatch) {
                return proxyReadonlyConfig(req, res, configBaseUrl, url.pathname, state);
            }
            if (url.pathname === '/v1/player/visual-bundle') {
                return proxyPlayerBundle(req, res, configBaseUrl, state);
            }
            if (/^\/v1\/player\/visual-assets\/vat_[a-z0-9_-]{24,80}\/content$/.test(url.pathname)) {
                return proxyPlayerAssetContent(req, res, configBaseUrl, state);
            }
            if (url.pathname.startsWith('/v1/')) {
                proxyLog.push({ kind: 'reject', method: req.method, path: url.pathname, reason: 'not-allowlisted' });
                return sendText(res, 404, 'not found');
            }
            if (url.pathname === '/' || url.pathname === '/game' || url.pathname === '/game/') {
                return sendGameIndex(res, serverBaseUrl(server), state);
            }
            if (url.pathname.startsWith('/game/')) {
                return sendPublicGameFile(res, url.pathname.replace(/^\/game\/+/, ''), state);
            }
            return sendText(res, 404, 'not found');
        } catch (error) {
            return sendText(res, 500, `smoke server error: ${error.message}`);
        }
    });
    await listen(server);
    servers.push(server);
    return {
        baseUrl: serverBaseUrl(server),
        state,
        setConfigBaseUrl(value) {
            configBaseUrl = value;
        },
    };
}

async function proxyReadonlyConfig(req, res, configBaseUrl, pathname, state) {
    if (req.method !== 'GET') return rejectProxy(res, req, pathname, 'readonly-config-method');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.search || hasForbiddenBrowserHeaders(req)) return rejectProxy(res, req, pathname, 'readonly-config-forbidden-transport');
    proxyLog.push({ kind: 'forward-readonly-config', method: req.method, path: pathname });
    const response = await fetch(`${configBaseUrl}${pathname}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    state.lastConfigStatus = response.status;
    res.end(bytes);
}

async function proxyPlayerBundle(req, res, configBaseUrl, state) {
    if (req.method !== 'POST') return rejectProxy(res, req, '/v1/player/visual-bundle', 'bundle-method');
    const body = await readRequestBody(req, 16 * 1024);
    const strippedHeaders = sensitiveBrowserHeaderNames(req);
    proxyLog.push({
        kind: 'forward-player-bundle',
        method: req.method,
        path: '/v1/player/visual-bundle',
        strippedHeaders,
    });
    const response = await fetch(`${configBaseUrl}/v1/player/visual-bundle`, {
        method: 'POST',
        headers: {
            origin: serverOrigin(req),
            cookie: `galgame_player_csrf=${csrfToken}`,
            'x-galgame-player-session': playerSessionId,
            'x-galgame-player-csrf': csrfToken,
            'content-type': 'application/json',
            accept: 'application/json',
        },
        body,
        redirect: 'manual',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    try {
        state.lastBundle = JSON.parse(bytes.toString('utf8'));
    } catch {
        state.lastBundle = null;
    }
    res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(bytes);
}

async function proxyPlayerAssetContent(req, res, configBaseUrl, state) {
    if (req.method !== 'GET') return rejectProxy(res, req, new URL(req.url, 'http://127.0.0.1').pathname, 'asset-method');
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.search || req.headers.authorization || req.headers.cookie || hasVisualProofHeader(req)) {
        return rejectProxy(res, req, url.pathname, 'asset-forbidden-transport');
    }
    proxyLog.push({ kind: 'forward-player-asset', method: req.method, path: url.pathname });
    const response = await fetch(`${configBaseUrl}${url.pathname}`, {
        method: 'GET',
        headers: {
            origin: serverOrigin(req),
            'x-galgame-player-session': playerSessionId,
            accept: 'image/png',
        },
        redirect: 'manual',
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    state.lastAssetContentStatus = response.status;
    res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'Cache-Control': 'no-store',
    });
    res.end(bytes);
}

function sendGameIndex(res, baseUrl, state) {
    const source = readFileSync(path.join(publicGameRoot, 'index.html'), 'utf8');
    state.readOnlyFiles.add('index.html');
    const injected = source
        .replace(/<meta name="galgame-config-service" content="[^"]*">/, `<meta name="galgame-config-service" content="${baseUrl}">`)
        .replace('</head>', `<meta name="galgame-player-csrf" content="${csrfToken}">
<script>window.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__=true;</script>
</head>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(injected);
}

function sendPublicGameFile(res, relativePath, state) {
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..')) return sendText(res, 400, 'bad path');
    const resolved = path.resolve(path.join(publicGameRoot, normalized));
    const root = path.resolve(publicGameRoot);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return sendText(res, 400, 'bad path');
    const info = statSync(resolved);
    if (!info.isFile()) return sendText(res, 404, 'not found');
    state.readOnlyFiles.add(normalized);
    const ext = path.extname(resolved);
    const type = ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
            ? 'text/css; charset=utf-8'
            : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(readFileSync(resolved));
}

async function runPlayerVisualAcceptance(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/`, 1280, 720);
    try {
        await waitForEvaluate(browser, sessionId, '(() => typeof window.__GALGAME_TEST_RENDER_CHAT__ === "function")()', 10000);
        const details = await evaluate(browser, sessionId, `(async (payload) => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const fetchCalls = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (url, options = {}) => {
                const response = await originalFetch(url, options);
                fetchCalls.push({
                    url: String(url),
                    method: String(options.method || 'GET').toUpperCase(),
                    credentials: options.credentials || '',
                    headers: Object.fromEntries(new Headers(options.headers || {}).entries()),
                    status: response.status,
                    contentType: response.headers.get('content-type') || '',
                });
                return response;
            };
            const bootstrapDeadline = Date.now() + 10000;
            while (Date.now() < bootstrapDeadline) {
                const title = document.querySelector('#gameTitle')?.textContent || '';
                const releaseNote = document.querySelector('#releaseNote')?.textContent || '';
                const defaultTitlePending = !title || title === '当前故事' || title === '故事尚未发布';
                const releasePending = !releaseNote || releaseNote === '故事准备中';
                if (!defaultTitlePending && !releasePending) break;
                await wait(100);
            }
            document.querySelector('#startButton')?.click();
            const stageDeadline = Date.now() + 5000;
            while (Date.now() < stageDeadline) {
                if (document.querySelector('#gameScreen')?.hidden === false) break;
                await wait(50);
            }
            window.__GALGAME_TEST_RENDER_CHAT__(payload.snapshot, { messageIndex: 2, instant: true });
            const deadline = Date.now() + 12000;
            while (Date.now() < deadline) {
                document.querySelector('#visualIconStrip')?.scrollIntoView({ block: 'center' });
                const icons = [...document.querySelectorAll('#visualIconStrip img')];
                const backdropActive = document.querySelector('#stageBackdrop')?.classList.contains('is-visual-active');
                const heroineActive = document.querySelector('.stage-heroine')?.classList.contains('is-visual-active');
                const status = document.querySelector('#visualStatus')?.textContent || '';
                const iconsLoaded = icons.length >= 3 && icons.every((img) => img.complete && img.naturalWidth > 0);
                if (iconsLoaded && backdropActive && heroineActive && !status.includes('暂时不可用')) break;
                await wait(150);
            }
            const backdrop = document.querySelector('#stageBackdrop');
            const heroine = document.querySelector('.stage-heroine');
            document.querySelector('#visualIconStrip')?.scrollIntoView({ block: 'center' });
            const iconStripRect = document.querySelector('#visualIconStrip')?.getBoundingClientRect();
            const icons = [...document.querySelectorAll('#visualIconStrip img')].map((img) => ({
                alt: img.alt,
                src: img.getAttribute('src'),
                complete: img.complete,
                naturalWidth: img.naturalWidth,
            }));
            return {
                visualStatus: document.querySelector('#visualStatus')?.textContent || '',
                backdropActive: backdrop?.classList.contains('is-visual-active') || false,
                backdropImage: backdrop?.style?.backgroundImage || '',
                heroineActive: heroine?.classList.contains('is-visual-active') || false,
                heroineImage: heroine?.style?.backgroundImage || '',
                gameTitle: document.querySelector('#gameTitle')?.textContent || '',
                releaseNote: document.querySelector('#releaseNote')?.textContent || '',
                iconStripRect: iconStripRect ? {
                    top: iconStripRect.top,
                    bottom: iconStripRect.bottom,
                    left: iconStripRect.left,
                    right: iconStripRect.right,
                    width: iconStripRect.width,
                    height: iconStripRect.height,
                } : null,
                icons,
                gameScreenEntityKeys: document.querySelector('#gameScreen')?.dataset?.playerVisualEntityKeys || '',
                bodyTextSample: document.body.innerText.slice(0, 500),
                fetchCalls,
            };
        })(${JSON.stringify({ snapshot: playerSnapshot() })})`);
        const failures = [];
        if (!details.backdropActive || !details.backdropImage.includes('/v1/player/visual-assets/')) failures.push('scene background did not render from player asset proxy');
        if (!details.heroineActive || !details.heroineImage.includes('/v1/player/visual-assets/')) failures.push('character sprite did not render from player asset proxy');
        if (details.icons.length !== 3) failures.push(`expected equipment/item/skill icons, got ${details.icons.length}`);
        for (const icon of details.icons) {
            if (!String(icon.src || '').includes('/v1/player/visual-assets/')) failures.push(`icon did not use proxy path: ${icon.src}`);
            if (!icon.complete || icon.naturalWidth < 1) failures.push(`icon did not load image bytes: ${icon.alt}`);
        }
        const bundleCalls = details.fetchCalls.filter((call) => call.url.includes('/v1/player/visual-bundle'));
        if (bundleCalls.length !== 1) failures.push(`expected exactly one browser bundle fetch, got ${bundleCalls.length}`);
        if (bundleCalls[0]?.credentials !== 'include') failures.push('browser bundle fetch did not use credentials=include');
        if (!bundleCalls[0]?.headers?.['x-galgame-player-csrf']) failures.push('browser bundle fetch did not send CSRF header');
        if (/entity_scene_|entity_character_|entity_equipment_|entity_item_|entity_skill_/.test(details.gameScreenEntityKeys)) {
            failures.push('browser stored pre-derived entity keys in DOM state');
        }
        if (/visual-projection-proof|visual-restore-proof|visual-asset-proof|service-token|raw chat|prompt|context|provider/i.test(JSON.stringify(details.fetchCalls))) {
            failures.push('browser fetch summary leaked forbidden proof/token/raw prompt fields');
        }
        return { details, failures };
    } finally {
        await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    }
}

function createOutput({ result, assetService, configService, staticEntry }) {
    const routeCounts = countRoutes(routeLog);
    const bundleSummary = summarizeBundle(staticEntry.state.lastBundle);
    const bindableTypes = new Set();
    for (const entityKey of bundleSummary?.sourceEntityKeys || []) {
        const match = /^entity_(scene|character|equipment|item|skill)_/.exec(entityKey);
        if (match) bindableTypes.add(match[1]);
    }
    const failures = [...result.failures];
    for (const type of ['scene', 'character', 'equipment', 'item', 'skill']) {
        if (!bindableTypes.has(type)) failures.push(`service bundle did not return ${type} entity key`);
    }
    if (routeCounts['game-config-service GET /v1/releases/active'] < 1) failures.push('active release bootstrap route was not called');
    if (!Object.keys(routeCounts).some((key) => key.startsWith('game-config-service GET /v1/scenarios/') && key.endsWith('/manifest'))) failures.push('manifest bootstrap route was not called');
    if (routeCounts['game-config-service POST /v1/player/visual-bundle'] !== 1) failures.push('player visual-bundle route was not called exactly once');
    if (routeCounts['visual-asset-service POST /v1/internal/visual-match'] !== 5) failures.push('visual-match route was not called once per bindable type');
    if (routeCounts['visual-asset-service POST /v1/internal/assets/metadata-resolve'] !== 5) failures.push('metadata-resolve route was not called once per bindable type');
    if ((routeCounts['visual-asset-service POST /v1/internal/assets/content-read'] || 0) < 5) failures.push('content-read route was not called for five rendered assets');
    return {
        ok: failures.length === 0,
        mode: 'test-double',
        realSillyTavernE2E: false,
        realServiceChain: true,
        writesPublic: false,
        staticEntryMode: 'test-only',
        configServiceBaseUrl: configService.baseUrl,
        visualAssetServiceBaseUrl: assetService.baseUrl,
        catalog: {
            catalogId: assetService.catalog.catalog.catalogId,
            catalogRevision: assetService.catalog.catalog.catalogRevision,
            catalogHash: assetService.catalog.catalog.catalogHash,
            assetRefs: assetService.catalog.catalog.assetRefs.length,
            unknownAssetRefs: assetService.catalog.catalog.unknownAssetRefs.length,
        },
        staticEntry: {
            readOnlyFiles: [...staticEntry.state.readOnlyFiles].sort(),
            proxyLog,
        },
        routeCounts,
        internalRouteLog: routeLog,
        serviceBundle: bundleSummary,
        browser: result.details,
        failures,
    };
}

function captureJsonResponseSummary(res, entry) {
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const chunks = [];
    res.write = (chunk, ...rest) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        return originalWrite(chunk, ...rest);
    };
    res.end = (chunk, ...rest) => {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
        const text = Buffer.concat(chunks).toString('utf8');
        if (/application\/json/i.test(String(res.getHeader('content-type') || '')) && text) {
            try {
                const data = JSON.parse(text);
                entry.response = {
                    ok: data?.ok === true,
                    errorCode: data?.error?.code || data?.error || '',
                };
            } catch {
                entry.response = { parseable: false };
            }
        }
        return originalEnd(chunk, ...rest);
    };
}

function summarizeBundle(bundle) {
    if (!bundle || typeof bundle !== 'object') return null;
    return {
        schemaVersion: bundle.schemaVersion,
        mode: bundle.mode,
        recovery: bundle.recovery || null,
        sourceEntityKeys: bundle.source?.entityKeys || [],
        bindings: (bundle.bindings || []).map((binding) => ({
            bindingId: binding.bindingId,
            bindingType: binding.bindingType,
            entityKey: binding.entityKey,
            assetId: binding.assetId,
            assetVersion: binding.assetVersion,
        })),
        matchResults: (bundle.matchResults || []).map((result) => ({
            matchId: result.matchId,
            bindingId: result.bindingId,
            type: result.type,
            entityKey: result.entityKey,
            assetId: result.assetId,
            scoreBand: result.scoreBand,
            usesLlm: result.usesLlm,
        })),
        assetReadTickets: (bundle.assetReadTickets || []).map((ticket) => ({
            ticketId: ticket.ticketId,
            bindingId: ticket.bindingId,
            entityKey: ticket.entityKey,
            assetId: ticket.assetId,
            proxyPath: ticket.proxyPath,
        })),
    };
}

async function uploadAsset(baseUrl, spec) {
    const response = await jsonRequest(baseUrl, 'POST', '/v1/admin/assets/upload', {
        token: adminToken,
        body: {
            schemaVersion: UPLOAD_SCHEMA_VERSION,
            metadata: {
                assetId: spec.assetId,
                assetVersion: 1,
                assetType: spec.assetType,
                role: spec.role,
                title: spec.title,
                tagCodes: spec.tagCodes,
                featureCodes: spec.featureCodes,
                licenseCode: 'user-owned',
                sourceLabel: 'visual e2e fixture',
            },
            imageBase64: makePng(spec).toString('base64'),
        },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body.asset;
}

async function publishCatalog(baseUrl, catalogId, catalogRevision, assetRefs) {
    const draft = await jsonRequest(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
        token: adminToken,
        body: { schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION, catalogId, catalogRevision, assetRefs },
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const validated = await jsonRequest(baseUrl, 'POST', `/v1/admin/catalogs/${catalogId}/${catalogRevision}/validate`, { token: adminToken, body: {} });
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    const published = await jsonRequest(baseUrl, 'POST', `/v1/admin/catalogs/${catalogId}/${catalogRevision}/publish`, { token: adminToken, body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    return published.body;
}

async function jsonRequest(baseUrl, method, pathname, { token, body } = {}) {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            origin: 'http://127.0.0.1',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}

function visualAssetSpecs() {
    return [
        { assetId: 'asset_scene_visuale2e_hut', assetType: 'scene', role: 'background', title: '倒塌的木屋', tagCodes: ['scene.ruins'], featureCodes: ['feature.wooden'], colorType: 2, rgb: [45, 76, 96] },
        { assetId: 'asset_character_visuale2e_miku', assetType: 'character', role: 'transparent-sprite', title: '测试角色', tagCodes: ['character.human'], featureCodes: ['feature.transparent'], colorType: 6, rgb: [172, 64, 132], alpha: 0 },
        { assetId: 'asset_equipment_visuale2e_dagger', assetType: 'equipment', role: 'icon', title: '生锈短剑', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon', 'feature.blade'], colorType: 2, rgb: [154, 143, 113] },
        { assetId: 'asset_item_visuale2e_key', assetType: 'item', role: 'icon', title: '蓝色钥匙', tagCodes: ['item.quest'], featureCodes: ['feature.icon'], colorType: 2, rgb: [37, 98, 201] },
        { assetId: 'asset_skill_visuale2e_spark', assetType: 'skill', role: 'icon', title: '火花术', tagCodes: ['skill.stealth'], featureCodes: ['feature.icon'], colorType: 2, rgb: [241, 198, 64] },
    ];
}

function makePng({ colorType = 2, rgb = [80, 90, 100], alpha = 255 } = {}) {
    const width = 2;
    const height = 2;
    const bytesPerPixel = colorType === 6 ? 4 : 3;
    const scanlines = Buffer.alloc(height * (1 + width * bytesPerPixel));
    for (let y = 0; y < height; y += 1) {
        const row = y * (1 + width * bytesPerPixel);
        scanlines[row] = 0;
        for (let x = 0; x < width; x += 1) {
            const offset = row + 1 + x * bytesPerPixel;
            scanlines[offset] = rgb[0];
            scanlines[offset + 1] = rgb[1];
            scanlines[offset + 2] = rgb[2];
            if (colorType === 6) scanlines[offset + 3] = x === 0 && y === 0 ? alpha : 255;
        }
    }
    return encodePng({ width, height, bitDepth: 8, colorType, compression: 0, filter: 0, interlace: 0 }, scanlines);
}

function withVisualScope(manifest, scope) {
    return {
        ...manifest,
        visualPresentation: { ...scope },
        arcs: manifest.arcs.map((arc) => ({ ...arc, visualPresentation: { ...scope } })),
    };
}

function createFakeOriginalChatBridge(chatsById) {
    return {
        async listCharacterChats() {
            return Object.keys(chatsById).map((fileName) => ({ fileId: fileName, fileName }));
        },
        async getCharacterChat({ fileName }) {
            const chat = chatsById[String(fileName || '').replace(/\.json$/i, '')];
            if (!chat) throw new Error('CHAT_NOT_FOUND');
            return chat;
        },
    };
}

function visualChat() {
    return [
        ...seedChat(),
        { name: 'System', is_system: true, mes: '系统消息不应进入视觉投影。' },
        { name: 'Player', is_user: true, mes: '我查看倒塌的木屋和门口的脚印。' },
        {
            name: DEMO_SCENARIO.sillyTavernBindings.characters[0].id,
            is_user: false,
            mes: '原始 mes 不应优先于 display_text。',
            extra: {
                display_text: [
                    '场景: 倒塌的木屋',
                    '装备: 生锈短剑',
                    '道具: 蓝色钥匙',
                    '技能: 火花术',
                    '倒塌的木屋被冷雨浸透，门口的泥里留着新鲜脚印。',
                ].join('\n'),
            },
        },
    ];
}

function seedChat() {
    return [
        { name: 'Player', is_user: true, mes: '你好。' },
        { name: DEMO_SCENARIO.sillyTavernBindings.characters[0].id, is_user: false, mes: '欢迎来到这里。' },
    ];
}

function playerSnapshot() {
    const messages = normalizeOriginalVisibleChatMessages(visualChat()).map((message) => ({
        id: `msg-${message.index}`,
        role: message.role === 'user' ? 'player' : 'character',
        speaker: message.name,
        text: message.text,
        displayText: message.text,
    }));
    return { chatId, writable: true, messages };
}

function hasForbiddenBrowserHeaders(req) {
    return Boolean(req.headers.authorization || req.headers.cookie || hasVisualProofHeader(req) || req.headers['x-galgame-player-session']);
}

function hasVisualProofHeader(req) {
    return Boolean(req.headers['x-galgame-visual-projection-proof'] || req.headers['x-galgame-visual-restore-proof'] || req.headers['x-galgame-visual-asset-proof']);
}

function sensitiveBrowserHeaderNames(req) {
    return [
        'authorization',
        'cookie',
        'x-galgame-player-session',
        'x-galgame-visual-projection-proof',
        'x-galgame-visual-restore-proof',
        'x-galgame-visual-asset-proof',
        'x-galgame-provider-key',
        'x-galgame-service-token',
    ].filter((name) => Object.hasOwn(req.headers, name));
}

function rejectProxy(res, req, pathName, reason) {
    proxyLog.push({ kind: 'reject', method: req.method, path: pathName, reason });
    return sendText(res, reason.includes('method') ? 405 : 400, 'rejected');
}

function countRoutes(entries) {
    const counts = {};
    for (const entry of entries) {
        const key = `${entry.service} ${entry.method} ${entry.path}`;
        counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
}

function serverOrigin(req) {
    return `http://${req.headers.host || '127.0.0.1'}`;
}

function readRequestBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                reject(new Error('body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

async function launchBrowser() {
    const debugPort = await getFreePort();
    const userDataDir = path.join(tmpdir(), `galgame-visual-e2e-chrome-${Date.now()}`);
    const process = spawn(findChrome(), [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${userDataDir}`,
        'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    return { process, debugPort };
}

async function connectBrowser(debugPort) {
    const deadline = Date.now() + 15000;
    let endpoint = '';
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
            const json = await response.json();
            endpoint = json.webSocketDebuggerUrl || '';
            if (endpoint) break;
        } catch {}
        await delay(150);
    }
    if (!endpoint) throw new Error('Chrome DevTools endpoint did not become available');
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    let nextId = 1;
    const pending = new Map();
    socket.on('message', (message) => {
        const data = JSON.parse(String(message));
        if (data.id && pending.has(data.id)) {
            const { resolve, reject } = pending.get(data.id);
            pending.delete(data.id);
            if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
            else resolve(data.result);
        }
    });
    return {
        send(method, params = {}, sessionId = null) {
            const id = nextId;
            nextId += 1;
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
            return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
    };
}

async function openPage(browser, url, width, height) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Page.navigate', { url }, sessionId);
    await waitForEvaluate(browser, sessionId, 'document.readyState === "complete"', 10000);
    return { targetId, sessionId };
}

async function evaluate(browser, sessionId, expression) {
    const result = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
}

async function waitForEvaluate(browser, sessionId, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate(browser, sessionId, expression).catch(() => false)) return true;
        await delay(150);
    }
    throw new Error(`timed out waiting for ${expression}`);
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve));
}

function serverBaseUrl(server) {
    return `http://127.0.0.1:${server.address().port}`;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendText(res, status, text) {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(text);
}

function prefixedSha256(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
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
        try {
            if (statSync(candidate).isFile()) return candidate;
        } catch {}
    }
    throw new Error('Chrome or Edge executable was not found');
}

await main();
