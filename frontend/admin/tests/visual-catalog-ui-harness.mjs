import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import {
    createVisualAssetService,
    encodePng,
    FileContentStore,
    FileVisualAssetStore,
    FileVisualControlStore,
} from '../../../external-modules/visual-asset-service/server.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const publicRoot = join(projectRoot, 'public');
const csrfToken = 'visual-csrf-token-0001';
const args = process.argv.slice(2);
const evidencePath = args.includes('--evidence')
    ? resolve(projectRoot, args[args.indexOf('--evidence') + 1])
    : '';
const realLocalAdminService = args.includes('--real-local-admin-service');

const staticPort = await getFreePort(8894);
const servicePort = await getFreePort(8994);
const debugPort = await getFreePort(9294);
const visualServiceBaseUrl = `http://127.0.0.1:${servicePort}`;
const pageBaseUrl = realLocalAdminService ? visualServiceBaseUrl : `http://127.0.0.1:${staticPort}`;
const SIMPLE_VISUAL_PATHS = new Set(realLocalAdminService
    ? ['/v1/local-admin/visual/upload', '/v1/local-admin/visual/publish']
    : ['/v1/admin/visual/upload', '/v1/admin/visual/publish']);
const SIMPLE_VISUAL_TYPES = ['scene', 'character', 'equipment', 'item', 'skill'];
const validPngBase64 = createHarnessPngBase64();
const mockState = realLocalAdminService ? null : createMockVisualServiceState();
const realState = realLocalAdminService ? { requests: [], dataRoot: mkdtempSync(join(os.tmpdir(), 'galgame-real-local-admin-')) } : null;
const staticServer = realLocalAdminService ? null : await startStaticServer(publicRoot, staticPort, {
    visualServiceBaseUrl,
    csrfToken,
});
const serviceServer = realLocalAdminService
    ? await startRealLocalVisualAssetService(servicePort, realState)
    : await startMockVisualAssetService(servicePort, mockState);
const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(projectRoot, '.codex-longrun', `chrome-simple-visual-${Date.now()}`)}`,
    'about:blank',
], {
    stdio: 'ignore',
    windowsHide: true,
});

let browser;
let sessionId;
let targetId;
const failures = [];
const checks = {};

try {
    browser = await connectBrowser(debugPort);
    ({ targetId, sessionId } = await openAdminPage(browser, `${pageBaseUrl}/game-admin/`));
    await waitForEvaluate(browser, sessionId, `document.readyState === 'complete' && Boolean(document.querySelector('#scriptFileInput'))`, 15000);

    await verifyMinimalScriptDom();
    await evaluate(browser, sessionId, `document.querySelector('[data-tab="enhancements"]')?.click()`);
    await waitForEvaluate(browser, sessionId, `!document.querySelector('#enhancementsPanel')?.classList.contains('is-hidden') && Boolean(document.querySelector('#simpleVisualUploadGrid'))`, 5000);
    await verifyMinimalVisualDom();
    await verifyFiveVisualUploads();
    if (!realLocalAdminService) {
        await verifyMinimalVisualRecovery();
    }

    const fetchCalls = await evaluate(browser, sessionId, `window.__visualHarnessFetchCalls || []`);
    checks.fetchProbe = {
        calls: fetchCalls.map((call) => ({
            method: call.method,
            path: call.path,
            credentials: call.credentials,
            hasCsrf: call.hasCsrf,
            hasAuthorization: call.hasAuthorization,
        })),
        onlySimpleVisualApiCalls: fetchCalls
            .filter((call) => call.url.startsWith(visualServiceBaseUrl))
            .every((call) => SIMPLE_VISUAL_PATHS.has(call.path)),
        allVisualPostWritesUseCsrf: fetchCalls
            .filter((call) => call.url.startsWith(visualServiceBaseUrl) && call.method !== 'GET')
            .every((call) => call.hasCsrf),
        allVisualCallsUseCredentialsInclude: fetchCalls
            .filter((call) => call.url.startsWith(visualServiceBaseUrl))
            .every((call) => call.credentials === 'include'),
        noAuthorizationHeader: fetchCalls.every((call) => !call.hasAuthorization),
    };
    checks.serviceRequests = summarizeMockRequests((mockState || realState).requests);
    checks.routeMatrixExecuted = {
        upload: (mockState || realState).requests.filter((request) => SIMPLE_VISUAL_PATHS.has(request.path) && request.path.endsWith('/upload') && request.method === 'POST').length,
        publish: (mockState || realState).requests.filter((request) => SIMPLE_VISUAL_PATHS.has(request.path) && request.path.endsWith('/publish') && request.method === 'POST').length,
        forbidden: (mockState || realState).requests
            .filter((request) => request.path.startsWith('/v1/') && !SIMPLE_VISUAL_PATHS.has(request.path))
            .map((request) => request.path),
    };
    checks.routeMatrixExecuted.all = checks.routeMatrixExecuted.upload >= 5
        && checks.routeMatrixExecuted.publish >= 5
        && checks.routeMatrixExecuted.forbidden.length === 0;

    assert(checks.fetchProbe.onlySimpleVisualApiCalls, 'browser called a non-SIMPLE visual asset API');
    assert(checks.fetchProbe.allVisualPostWritesUseCsrf, 'visual POST requests did not all carry CSRF header');
    assert(checks.fetchProbe.allVisualCallsUseCredentialsInclude, 'visual requests did not all use credentials include');
    assert(checks.fetchProbe.noAuthorizationHeader, 'browser sent authorization header');
    assert(checks.routeMatrixExecuted.all, 'minimal visual upload route matrix did not match upload/publish only');
    if (realLocalAdminService) {
        checks.realLocalAdminStatus = await fetch(`${visualServiceBaseUrl}/v1/health`).then((response) => response.json());
        checks.realLocalAdminPersistence = await verifyRealLocalAdminPersistence(realState);
    }
} catch (error) {
    failures.push(error.stack || error.message || String(error));
    if (browser && sessionId) {
        checks.failureDebug = await evaluate(browser, sessionId, `(() => ({
            href: location.href,
            readyState: document.readyState,
            status: document.querySelector('#visualServiceStatus')?.textContent?.trim() || '',
            serviceMeta: document.querySelector('meta[name="galgame-visual-asset-service"]')?.content || '',
            csrfMetaPresent: Boolean(document.querySelector('meta[name="galgame-visual-asset-csrf-token"]')?.content),
            fetchCalls: window.__visualHarnessFetchCalls || [],
            bodyText: document.body?.innerText?.slice(0, 1000) || ''
        }))()`).catch((debugError) => ({ debugError: debugError.message }));
        checks.failureMockRequests = summarizeMockRequests((mockState || realState).requests);
    }
} finally {
    if (browser && targetId) {
        await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    await browser?.send('Browser.close').catch(() => {});
    chrome.kill();
    await closeServer(staticServer);
    await closeServer(serviceServer);
}

const evidence = {
    schemaVersion: 'galgame.simple-visual-admin-ui-harness.v1',
    generatedAt: new Date().toISOString(),
    ok: failures.length === 0,
    verification: {
        realBrowser: true,
        mockVisualAssetService: !realLocalAdminService,
        realLocalAdminVisualAssetService: realLocalAdminService,
        simpleBeginnerVisualCardOnly: true,
        staticStringOnly: false,
    },
    urls: {
        pageBaseUrl,
        visualServiceBaseUrl,
    },
    checks,
    failures,
};

if (evidencePath) {
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

if (!evidence.ok) {
    console.error(JSON.stringify(evidence, null, 2));
    process.exit(1);
}

console.log(JSON.stringify({
    ok: true,
    visualUploadEntries: checks.dom?.visualUploadEntries?.length || 0,
    visualUploadRequests: checks.routeMatrixExecuted.upload,
    visualPublishRequests: checks.routeMatrixExecuted.publish,
    recoveryCases: Object.keys(checks.errorRecovery || {}).length,
    realLocalAdminService,
}, null, 2));

async function verifyMinimalScriptDom() {
    const dom = await evaluate(browser, sessionId, `(() => {
        const visible = (node) => Boolean(node && !node.hidden && node.offsetParent !== null);
        return {
            visibleScriptFileInputs: [...document.querySelectorAll('#scriptFileInput')].filter(visible).length,
            visibleScriptButtons: [...document.querySelectorAll('[data-script-assistant-card="upload"] button')].filter(visible).map((node) => node.textContent.trim()),
            cardText: document.querySelector('[data-script-assistant-card="upload"]')?.innerText || '',
            visibleNavTabs: [...document.querySelectorAll('.nav-tabs button')].filter(visible).map((node) => node.textContent.trim()),
        };
    })()`);
    checks.scriptDom = dom;
    assert(dom.visibleScriptFileInputs === 1, 'script area must expose exactly one upload file input');
    assert(dom.visibleScriptButtons.length === 0, 'script area exposes organize/redeploy/confirm buttons');
    assert(!/开始整理|重新整理|确认草稿|provider|模型|提示词|上下文|服务地址/i.test(dom.cardText), 'script area exposes forbidden workflow or parameter text');
    assert(JSON.stringify(dom.visibleNavTabs) === JSON.stringify(['上传剧本', '上传图片']), 'admin nav is not reduced to script/image upload tabs');
}

async function verifyMinimalVisualDom() {
    const dom = await evaluate(browser, sessionId, `(() => ({
        cardText: document.querySelector('[data-enhancement-card="visual-assets"]')?.innerText || '',
        legacyFormPresent: Boolean(document.querySelector('#visualUploadForm')),
        legacyControlsPresent: Boolean(document.querySelector('#visualAssetTypeSelect, #visualAssetTitleInput, #visualTagCodesInput, #visualAssetFileInput, #visualPublishCatalogButton, #visualEnableButton, #visualDisableButton, #visualRestoreDefaultsButton')),
        inputs: [...document.querySelectorAll('[data-enhancement-card="visual-assets"] input, [data-enhancement-card="visual-assets"] textarea, [data-enhancement-card="visual-assets"] select')]
            .map((node) => ({ id: node.id, type: node.type || node.tagName.toLowerCase(), placeholder: node.getAttribute('placeholder') || '' })),
        visibleInputs: [...document.querySelectorAll('[data-enhancement-card="visual-assets"] input, [data-enhancement-card="visual-assets"] textarea, [data-enhancement-card="visual-assets"] select')]
            .filter((node) => !node.hidden && node.offsetParent !== null)
            .map((node) => ({ id: node.id, type: node.type || node.tagName.toLowerCase(), visualType: node.dataset.visualUploadType || '' })),
        visibleButtons: [...document.querySelectorAll('[data-enhancement-card="visual-assets"] button')]
            .filter((node) => !node.hidden && node.offsetParent !== null)
            .map((node) => node.textContent.trim()),
        visualUploadEntries: [...document.querySelectorAll('.simple-visual-upload-input')]
            .filter((node) => !node.hidden && node.offsetParent !== null)
            .map((node) => node.dataset.visualUploadType || ''),
        hasBase64Input: Boolean([...document.querySelectorAll('[data-enhancement-card="visual-assets"] input, [data-enhancement-card="visual-assets"] textarea')]
            .find((node) => /base64/i.test(node.id + ' ' + (node.placeholder || '')))),
    }))()`);
    checks.dom = dom;
    const forbiddenText = /素材编号|目录编号|目录版本|素材引用|特征代码|内容校验|元数据校验|连接测试|检查服务|恢复默认|开启|关闭|发布策略|显示方式|接口地址|catalog|profile|proof|token|hash|base64|provider|模型|提示词|上下文/i;
    assert(!forbiddenText.test(dom.cardText), 'visual card displays a forbidden technical field');
    assert(!dom.legacyFormPresent && !dom.legacyControlsPresent, 'legacy hidden visual form or controls remain');
    assert(!dom.hasBase64Input, 'visual card exposes a base64 input');
    assert(JSON.stringify(dom.visualUploadEntries.sort()) === JSON.stringify([...SIMPLE_VISUAL_TYPES].sort()), 'visual card must expose exactly five type-specific upload entries');
    assert(dom.visibleInputs.length === 5 && dom.visibleInputs.every((item) => item.type === 'file'), 'visual card exposes non-file visible inputs');
    assert(dom.visibleButtons.length === 0, 'visual card exposes extra visible buttons');
}

async function verifyFiveVisualUploads() {
    if (mockState) {
        mockState.mode = 'ok';
    }
    for (const type of SIMPLE_VISUAL_TYPES) {
        await evaluate(browser, sessionId, `(() => {
            const input = document.querySelector('[data-visual-upload-type="${type}"]');
            if (!input) throw new Error('missing visual input ${type}');
            const bytes = Uint8Array.from(atob(${JSON.stringify(validPngBase64)}), (char) => char.charCodeAt(0));
            const file = new File([bytes], '${type}.png', { type: 'image/png' });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await waitForEvaluate(browser, sessionId, `document.querySelector('[data-simple-visual-type="${type}"] .simple-visual-upload-status')?.textContent.includes('已上传并应用')`, 8000);
    }
    const uploadRequests = realLocalAdminService
        ? (await evaluate(browser, sessionId, `window.__visualHarnessFetchCalls || []`))
            .filter((request) => request.path === '/v1/local-admin/visual/upload')
            .map((request) => ({ body: safeJson(request.body || '{}') }))
        : mockState.requests.filter((request) => request.path === '/v1/admin/visual/upload');
    checks.uploadRequest = {
        bodies: uploadRequests.map((request) => request.body),
        uploadedTypes: uploadRequests.map((request) => request.body?.assetType),
        hasImageBase64: uploadRequests.every((request) => typeof request.body?.imageBase64 === 'string' && request.body.imageBase64.length > 0),
        forbiddenTechnicalFields: [...new Set(uploadRequests.flatMap((request) => findForbiddenUploadFields(request.body)))],
        noTagCodes: uploadRequests.every((request) => Array.isArray(request.body?.tagCodes) && request.body.tagCodes.length === 0),
        noIgnoredLocalStateField: uploadRequests.every((request) => !Object.prototype.hasOwnProperty.call(request.body || {}, 'ignoredFriendlyTags')),
    };
    assert(checks.uploadRequest.hasImageBase64, 'upload did not transport file as base64 internally');
    assert(checks.uploadRequest.forbiddenTechnicalFields.length === 0, 'simple upload sent forbidden technical fields');
    assert(JSON.stringify(checks.uploadRequest.uploadedTypes.sort()) === JSON.stringify([...SIMPLE_VISUAL_TYPES].sort()), 'not all five visual types uploaded');
    assert(checks.uploadRequest.noTagCodes, 'minimal upload must not expose friendly or advanced tag codes');
    assert(checks.uploadRequest.noIgnoredLocalStateField, 'simple upload leaked local ignored-tag state');
}

async function verifyMinimalVisualRecovery() {
    const cases = [
        { mode: 'csrf-missing', action: 'upload-no-csrf', expected: '写入保护未配置', run: async () => {
            await evaluate(browser, sessionId, `(() => {
                window.GALGAME_VISUAL_ASSET_CSRF_TOKEN = '';
                document.querySelector('meta[name="galgame-visual-asset-csrf-token"]').content = '';
                const input = document.querySelector('[data-visual-upload-type="scene"]');
                const bytes = Uint8Array.from(atob(${JSON.stringify(validPngBase64)}), (char) => char.charCodeAt(0));
                const file = new File([bytes], 'csrf.png', { type: 'image/png' });
                const transfer = new DataTransfer();
                transfer.items.add(file);
                input.files = transfer.files;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            })()`);
        } },
        { mode: '401', action: 'upload-401', expected: '访问边界未通过', run: async () => chooseMinimalVisualFile('scene', 'auth.png') },
        { mode: '403', action: 'upload-403', expected: '访问边界未通过', run: async () => chooseMinimalVisualFile('character', 'origin.png') },
        { mode: '409', action: 'publish-409', expected: '目录状态已变化', run: async () => {
            await restoreCsrfToken();
            await chooseMinimalVisualFile('equipment', 'conflict.png');
        } },
        { mode: '500', action: 'upload-500', expected: '服务出错', run: async () => chooseMinimalVisualFile('item', 'server.png') },
    ];
    checks.errorRecovery = {};
    for (const item of cases) {
        mockState.mode = item.mode;
        await item.run();
        await waitForEvaluate(browser, sessionId, `document.querySelector('#visualServiceStatus')?.textContent.includes(${JSON.stringify(item.expected)})`, item.mode === 'timeout' ? 8000 : 5000);
        checks.errorRecovery[item.action] = {
            mode: item.mode,
            statusText: await getStatusText(),
        };
        mockState.mode = 'ok';
        await restoreCsrfToken();
    }
}

async function chooseMinimalVisualFile(type, fileName) {
    await evaluate(browser, sessionId, `(() => {
        const input = document.querySelector('[data-visual-upload-type="${type}"]');
        if (!input) throw new Error('missing visual input ${type}');
        const bytes = Uint8Array.from(atob(${JSON.stringify(validPngBase64)}), (char) => char.charCodeAt(0));
        const file = new File([bytes], ${JSON.stringify(fileName)}, { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
}

async function restoreCsrfToken() {
    await evaluate(browser, sessionId, `(() => {
        window.GALGAME_VISUAL_ASSET_CSRF_TOKEN = ${JSON.stringify(csrfToken)};
        const meta = document.querySelector('meta[name="galgame-visual-asset-csrf-token"]');
        if (meta) meta.content = ${JSON.stringify(csrfToken)};
    })()`);
}

async function getStatusText() {
    return evaluate(browser, sessionId, `document.querySelector('#visualServiceStatus')?.textContent?.trim() || ''`);
}

function summarizeMockRequests(requests) {
    return requests.map((request) => ({
        method: request.method,
        path: request.path,
        hasCsrf: request.hasCsrf,
        origin: request.origin,
        contentType: request.contentType,
        status: request.status,
    }));
}

function findForbiddenUploadFields(body) {
    const forbidden = [
        'assetId',
        'assetVersion',
        'role',
        'assetContentSha256',
        'assetMetadataHash',
        'catalogId',
        'catalogRevision',
        'catalogHash',
        'profileId',
        'profileHash',
        'proof',
        'token',
        'sourceLabel',
        'licenseCode',
        'path',
    ];
    return forbidden.filter((field) => Object.prototype.hasOwnProperty.call(body || {}, field));
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createMockVisualServiceState() {
    return {
        mode: 'ok',
        requests: [],
        uploadCount: 0,
        visual: createVisualControl({ enabled: false, hasActiveCatalog: false }),
    };
}

function createVisualControl({ enabled, hasActiveCatalog }) {
    return {
        schemaVersion: 'galgame.visual-control.v1',
        enabled,
        activeCatalog: hasActiveCatalog ? {
            catalogId: 'catalog_simple_test',
            catalogRevision: 1,
            catalogHash: `sha256:${'a'.repeat(64)}`,
        } : null,
        hasActiveCatalog,
        ready: Boolean(enabled && hasActiveCatalog),
        statusCode: enabled ? (hasActiveCatalog ? 'visual-enabled' : 'visual-enabled-without-catalog') : 'visual-disabled',
        updatedAt: new Date().toISOString(),
    };
}

function createSimpleCatalog() {
    return {
        schemaVersion: 'galgame.visual-asset-catalog.v1',
        catalogId: 'catalog_simple_test',
        catalogRevision: 1,
        status: 'published',
        assetRefs: [{ assetId: 'asset_scene_simpletest', assetVersion: 1, assetType: 'scene' }],
        unknownAssetRefs: [],
        updatedAt: new Date().toISOString(),
    };
}

function createHarnessPngBase64() {
    const scanline = Buffer.from([
        0, 16, 32, 48, 0, 64, 80, 96, 255,
        0, 112, 128, 144, 255, 160, 176, 192, 255,
    ]);
    return encodePng({
        width: 2,
        height: 2,
        bitDepth: 8,
        colorType: 6,
        compression: 0,
        filter: 0,
        interlace: 0,
    }, scanline).toString('base64');
}

async function startRealLocalVisualAssetService(port, state) {
    const service = createVisualAssetService({
        adminToken: '',
        adminOrigins: [],
        assetStore: new FileVisualAssetStore(join(state.dataRoot, 'metadata')),
        contentStore: new FileContentStore(join(state.dataRoot, 'content')),
        visualControlStore: new FileVisualControlStore(join(state.dataRoot, 'control')),
    });
    const server = createServer((request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        const record = {
            method: request.method || 'GET',
            path: url.pathname,
            origin: request.headers.origin || '',
            hasCsrf: Boolean(request.headers['x-galgame-csrf-token']),
            hasAuthorization: Boolean(request.headers.authorization),
            contentType: request.headers['content-type'] || '',
            status: 0,
        };
        state.requests.push(record);
        response.on('finish', () => {
            record.status = response.statusCode;
        });
        service.handleRequest(request, response);
    });
    await new Promise((resolvePromise) => server.listen(port, '127.0.0.1', resolvePromise));
    return server;
}

async function verifyRealLocalAdminPersistence(state) {
    const restartedState = { requests: [], dataRoot: state.dataRoot };
    const restartedServer = await startRealLocalVisualAssetService(await getFreePort(9094), restartedState);
    const restartedPort = restartedServer.address().port;
    const restartedBaseUrl = `http://127.0.0.1:${restartedPort}`;
    try {
        const htmlResponse = await fetch(`${restartedBaseUrl}/game-admin/`);
        const html = await htmlResponse.text();
        const cookie = htmlResponse.headers.get('set-cookie') || '';
        const csrfTokenValue = html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=([^;]+);/)?.[1]
            ? JSON.parse(html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=([^;]+);/)?.[1])
            : '';
        const statusResponse = await fetch(`${restartedBaseUrl}/v1/local-admin/visual/status`, {
            headers: {
                cookie,
                origin: restartedBaseUrl,
            },
        });
        const status = await statusResponse.json();
        assert(statusResponse.status === 200, 'restarted local admin status failed');
        assert(status.visual?.enabled === true, 'visual-control enabled state did not survive restart');
        assert(Boolean(status.visual?.activeCatalog), 'active visual catalog did not survive restart');
        return {
            ok: true,
            restartedBaseUrl,
            csrfTokenPresentAfterRestart: Boolean(csrfTokenValue),
            statusCode: status.visual.statusCode,
            activeCatalog: status.visual.activeCatalog,
            requests: summarizeMockRequests(restartedState.requests),
        };
    } finally {
        await closeServer(restartedServer);
    }
}

async function startMockVisualAssetService(port, state) {
    const server = createServer(async (request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        if (request.method === 'OPTIONS') {
            setCors(response, request);
            response.writeHead(204);
            response.end();
            return;
        }
        const bodyText = await readRequestBody(request);
        const record = {
            method: request.method || 'GET',
            path: url.pathname,
            origin: request.headers.origin || '',
            hasCsrf: request.headers['x-galgame-csrf-token'] === csrfToken,
            contentType: request.headers['content-type'] || '',
            body: bodyText ? safeJson(bodyText) : null,
            status: 200,
        };
        state.requests.push(record);
        setCors(response, request);
        if ((request.method || 'GET') !== 'GET' && record.hasCsrf !== true) {
            record.status = 403;
            sendJson(response, 403, { ok: false, error: { code: 'VISUAL_ASSET_CSRF_INVALID' } });
            return;
        }
        if (state.mode === 'timeout') {
            await delay(6200);
        }
        if (state.mode === '401') {
            record.status = 401;
            sendJson(response, 401, { ok: false, error: { code: 'VISUAL_ASSET_ADMIN_AUTH_REQUIRED' } });
            return;
        }
        if (state.mode === '403') {
            record.status = 403;
            sendJson(response, 403, { ok: false, error: { code: 'VISUAL_ASSET_ORIGIN_REJECTED' } });
            return;
        }
        if (state.mode === '500') {
            record.status = 500;
            sendJson(response, 500, { ok: false, error: { code: 'VISUAL_ASSET_SERVER_ERROR' } });
            return;
        }
        if (state.mode === '409' && url.pathname === '/v1/admin/visual/publish') {
            record.status = 409;
            sendJson(response, 409, { ok: false, error: { code: 'VISUAL_SIMPLE_PUBLISH_CONFLICT' } });
            return;
        }
        if (request.method === 'GET' && url.pathname === '/v1/admin/visual/status') {
            sendJson(response, 200, { ok: true, visual: state.visual });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/admin/visual/upload') {
            state.uploadCount += 1;
            sendJson(response, 200, {
                ok: true,
                simpleUpload: {
                    schemaVersion: 'galgame.visual-simple-upload-response.v1',
                    assetId: 'asset_scene_simpletest',
                    assetVersion: 1,
                    assetContentSha256: `sha256:${'b'.repeat(64)}`,
                    assetMetadataHash: `sha256:${'c'.repeat(64)}`,
                },
                asset: {
                    assetType: record.body?.assetType || 'scene',
                    role: 'background',
                    title: record.body?.title || '图片',
                    status: 'draft',
                },
            });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/admin/visual/publish') {
            state.visual = createVisualControl({ enabled: true, hasActiveCatalog: true });
            sendJson(response, 200, {
                ok: true,
                schemaVersion: 'galgame.visual-simple-publish-response.v1',
                published: true,
                idempotent: false,
                visual: state.visual,
                catalog: createSimpleCatalog(),
            });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/admin/visual/enable') {
            state.visual = createVisualControl({ enabled: true, hasActiveCatalog: true });
            sendJson(response, 200, { ok: true, visual: state.visual });
            return;
        }
        if (request.method === 'POST' && url.pathname === '/v1/admin/visual/disable') {
            state.visual = createVisualControl({ enabled: false, hasActiveCatalog: true });
            sendJson(response, 200, { ok: true, visual: state.visual });
            return;
        }
        record.status = 404;
        sendJson(response, 404, { ok: false, error: { code: 'NOT_FOUND' } });
    });
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolvePromise(server));
    });
}

function setCors(response, request) {
    const origin = request.headers.origin || `http://127.0.0.1:${staticPort}`;
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type,x-galgame-csrf-token');
    response.setHeader('vary', 'Origin');
}

function sendJson(response, status, body) {
    const text = JSON.stringify(body);
    response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
    });
    response.end(text);
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function readRequestBody(request) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('error', reject);
        request.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    });
}

async function startStaticServer(root, port, config) {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
    };
    const server = createServer((request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        let pathname = decodeURIComponent(url.pathname);
        if (pathname === '/') pathname = '/game-admin/';
        if (pathname.endsWith('/')) pathname += 'index.html';
        const filePath = normalize(join(root, pathname));
        if (!filePath.startsWith(normalize(root + sep))) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
        }
        try {
            let bytes = readFileSync(filePath);
            let contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
            if (filePath.endsWith('index.html')) {
                let html = bytes.toString('utf8')
                    .replace(/<meta name="galgame-config-service" content="[^"]*">/, '<meta name="galgame-config-service" content="">')
                    .replace(/<meta name="galgame-visual-asset-service" content="[^"]*">/, `<meta name="galgame-visual-asset-service" content="${config.visualServiceBaseUrl}">`)
                    .replace(/<meta name="galgame-visual-asset-csrf-token" content="[^"]*">/, `<meta name="galgame-visual-asset-csrf-token" content="${config.csrfToken}">`);
                bytes = Buffer.from(html, 'utf8');
                contentType = 'text/html; charset=utf-8';
            }
            response.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length });
            response.end(bytes);
        } catch {
            response.writeHead(404);
            response.end('Not found');
        }
    });
    return new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolvePromise(server));
    });
}

async function openAdminPage(cdp, url) {
    const { targetId: nextTargetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: nextSessionId } = await cdp.send('Target.attachToTarget', { targetId: nextTargetId, flatten: true });
    await cdp.send('Runtime.enable', {}, nextSessionId);
    await cdp.send('Page.enable', {}, nextSessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        mobile: false,
    }, nextSessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
            window.__visualHarnessFetchCalls = [];
            const originalFetch = window.fetch.bind(window);
            window.fetch = (input, init = {}) => {
                const url = typeof input === 'string' ? input : input?.url || '';
                const headers = new Headers(init.headers || {});
                window.__visualHarnessFetchCalls.push({
                    url,
                    path: (() => { try { return new URL(url, location.href).pathname; } catch { return ''; } })(),
                    method: String(init.method || 'GET').toUpperCase(),
                    credentials: init.credentials || '',
                    hasCsrf: headers.has('x-galgame-csrf-token'),
                    hasAuthorization: headers.has('authorization'),
                    body: typeof init.body === 'string' ? init.body.slice(0, 500000) : ''
                });
                return originalFetch(input, init);
            };
        })()`,
    }, nextSessionId);
    await cdp.send('Page.navigate', { url }, nextSessionId);
    return { targetId: nextTargetId, sessionId: nextSessionId };
}

async function evaluate(cdp, currentSessionId, expression) {
    const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    }, currentSessionId);
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result?.value;
}

async function waitForEvaluate(cdp, currentSessionId, expression, timeoutMs) {
    const started = Date.now();
    let lastValue;
    while (Date.now() - started < timeoutMs) {
        lastValue = await evaluate(cdp, currentSessionId, `(() => Boolean(${expression}))()`).catch(() => false);
        if (lastValue) return true;
        await delay(120);
    }
    throw new Error(`Timed out waiting for expression: ${expression}; last=${lastValue}`);
}

async function connectBrowser(port) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        try {
            const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
            return createCdpClient(version.webSocketDebuggerUrl);
        } catch {
            await delay(100);
        }
    }
    throw new Error('Chrome debugging endpoint did not start.');
}

function createCdpClient(url) {
    const socket = new WebSocket(url);
    let sequence = 0;
    const pending = new Map();
    const opened = new Promise((resolvePromise, reject) => {
        socket.once('open', resolvePromise);
        socket.once('error', reject);
    });
    socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (!message.id || !pending.has(message.id)) return;
        const { resolve: resolveMessage, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolveMessage(message.result || {});
    });
    return {
        async send(method, params = {}, currentSessionId = null) {
            await opened;
            return new Promise((resolveMessage, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve: resolveMessage, reject });
                socket.send(JSON.stringify({ id, method, params, ...(currentSessionId ? { sessionId: currentSessionId } : {}) }));
            });
        },
        close() {
            socket.close();
        },
    };
}

async function getFreePort(start) {
    for (let port = start; port < start + 100; port += 1) {
        if (await canListen(port)) return port;
    }
    throw new Error(`No free port near ${start}.`);
}

function canListen(port) {
    return new Promise((resolvePromise) => {
        const server = createServer();
        server.once('error', () => resolvePromise(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolvePromise(true));
        });
    });
}

function findChrome() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const candidate of candidates) {
        try {
            statSync(candidate);
            return candidate;
        } catch {
            continue;
        }
    }
    throw new Error('Chrome or Edge was not found in the common Windows install paths.');
}

function closeServer(server) {
    if (!server) return Promise.resolve();
    return new Promise((resolvePromise) => server.close(() => resolvePromise()));
}

function delay(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
