import assert from 'node:assert/strict';
import { createServer, get as httpGet } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicRoot = path.join(repoRoot, 'public');
const fixtureRoot = path.join(repoRoot, 'frontend', 'shared', 'tests', 'fixtures', 'adaptive-presentation');
const evidencePath = process.argv.includes('--evidence')
    ? process.argv[process.argv.indexOf('--evidence') + 1]
    : path.join(repoRoot, '.codex-longrun', 'evidence', 'uap4-player-template-matrix-ui-smoke.json');
const screenshotRoot = path.join(repoRoot, '.codex-longrun', 'screenshots');

const cases = [
    ['visual-novel', 'visual-novel-events.txt', 'visual-novel-missing-fields.txt', 'events', ['events', 'relationships', 'locations', 'objectives']],
    ['rpg-adventure', 'dungeon-master-rpg.txt', 'rpg-adventure-missing-fields.txt', 'rpg-status', ['rpg-status', 'inventory', 'abilities']],
    ['romance-social', 'romance-affection.txt', 'romance-social-missing-fields.txt', 'affection', ['affection', 'relationships', 'gifts', 'calendar', 'events']],
    ['mystery-investigation', 'mystery-clues.txt', 'mystery-investigation-missing-fields.txt', 'clues', ['clues', 'suspects', 'locations', 'objectives']],
    ['management-sim', 'management-resources.txt', 'management-sim-missing-fields.txt', 'resources', ['resources', 'objectives', 'calendar']],
    ['sandbox-roleplay', 'sandbox-roleplay.txt', 'sandbox-roleplay-missing-fields.txt', 'locations', ['locations', 'relationships', 'factions', 'objectives', 'events']],
];

class CdpClient {
    constructor(url) {
        this.nextId = 1;
        this.pending = new Map();
        this.ws = new WebSocket(url);
        this.ready = new Promise((resolve, reject) => {
            this.ws.addEventListener('open', resolve, { once: true });
            this.ws.addEventListener('error', reject, { once: true });
        });
        this.ws.addEventListener('message', (event) => {
            const payload = JSON.parse(String(event.data));
            if (payload.id && this.pending.has(payload.id)) {
                const { resolve, reject } = this.pending.get(payload.id);
                this.pending.delete(payload.id);
                if (payload.error) reject(new Error(payload.error.message));
                else resolve(payload.result || {});
            }
        });
    }

    async send(method, params = {}, sessionId = undefined) {
        await this.ready;
        const id = this.nextId++;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
        this.ws.send(JSON.stringify(payload));
        return promise;
    }
}

const port = await getFreePort(8820);
const debugPort = await getFreePort(9320);
const server = await startStaticServer(publicRoot, port);
const chromeUserDataDir = path.join(repoRoot, '.codex-longrun', `chrome-uap4-template-${Date.now()}`);
await mkdir(chromeUserDataDir, { recursive: true });
const chromeDiagnostics = { stderr: '', stdout: '', exitCode: null, exitSignal: null, pid: null };
const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeUserDataDir}`,
    'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
chromeDiagnostics.pid = chrome.pid;
chrome.stdout?.on('data', (chunk) => {
    chromeDiagnostics.stdout += String(chunk).slice(0, 4000);
});
chrome.stderr?.on('data', (chunk) => {
    chromeDiagnostics.stderr += String(chunk).slice(0, 4000);
});
chrome.once('exit', (code, signal) => {
    chromeDiagnostics.exitCode = code;
    chromeDiagnostics.exitSignal = signal;
});

const evidence = {
    ok: false,
    verification: {
        realBrowser: true,
        staticDomOnly: false,
        liveSillyTavernGeneration: false,
        testOnlyMockRelease: true,
        chromeUserDataDir,
        staticPort: port,
        debugPort,
    },
    chromeDiagnostics,
    results: [],
    failures: [],
};

try {
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await mkdir(screenshotRoot, { recursive: true });
    const browser = await connectBrowser(debugPort);
    for (const [template, fixture, missingFixture, expectedPrimary, expectedOrder] of cases) {
        const result = await runTemplateCase(browser, {
            baseUrl: `http://127.0.0.1:${port}`,
            template,
            fixture,
            missingFixture,
            expectedPrimary,
            expectedOrder,
        });
        evidence.results.push(result);
    }
    await browser.send('Browser.close').catch(() => {});
    evidence.failures = evidence.results.flatMap((result) => result.failures.map((failure) => `${result.template}: ${failure}`));
    evidence.ok = evidence.failures.length === 0;
} catch (error) {
    evidence.failures.push(String(error?.stack || error?.message || error));
} finally {
    chrome.kill();
    server.close();
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(evidence, null, 2));
    process.exitCode = evidence.ok ? 0 : 1;
}

async function runTemplateCase(browser, { baseUrl, template, fixture, missingFixture, expectedPrimary, expectedOrder }) {
    const text = await readFile(path.join(fixtureRoot, fixture), 'utf8');
    const missingText = await readFile(path.join(fixtureRoot, missingFixture), 'utf8');
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/?uap4-template=${template}`, template === 'rpg-adventure' ? 1366 : 390, template === 'rpg-adventure' ? 768 : 844);
    await waitForEvaluate(browser, sessionId, `(() => typeof globalThis.__GALGAME_TEST_SET_MANIFEST__ === 'function' && typeof globalThis.__GALGAME_TEST_RENDER_ADAPTIVE__ === 'function')()`, 10000);
    await evaluate(browser, sessionId, buildMockExpression({ template, text }));
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#adaptivePanels')?.hidden === false)()`, 10000);
    const details = await evaluate(browser, sessionId, `(() => {
        const panels = Array.from(document.querySelectorAll('#adaptivePanels .adaptive-panel'));
        const firstButton = panels[0]?.querySelector('button');
        firstButton?.focus();
        firstButton?.click();
        return {
            template: document.querySelector('#adaptivePanels .adaptive-status-belt')?.dataset.template || '',
            beltClass: document.querySelector('#adaptivePanels .adaptive-status-belt')?.className || '',
            moduleOrder: panels.map((panel) => panel.dataset.module || ''),
            primaryModule: panels[0]?.dataset.module || '',
            drawerHiddenAfterOpen: document.querySelector('#adaptiveDetailDrawer')?.hidden ?? true,
            drawerRole: document.querySelector('#adaptiveDetailDrawer [role="dialog"]')?.getAttribute('role') || '',
            drawerModal: document.querySelector('#adaptiveDetailDrawer [role="dialog"]')?.getAttribute('aria-modal') || '',
            drawerTitle: document.querySelector('#adaptiveDetailTitle')?.textContent?.trim() || '',
            focusedAfterOpen: document.activeElement?.id || '',
            scrollWidth: document.documentElement.scrollWidth,
            width: document.documentElement.clientWidth,
        };
    })()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
    await waitForEvaluate(browser, sessionId, `(() => {
        const drawerHidden = document.querySelector('#adaptiveDetailDrawer')?.hidden ?? false;
        const focusedModule = document.activeElement?.closest?.('.adaptive-panel')?.dataset?.module || '';
        return drawerHidden && focusedModule === ${JSON.stringify(expectedPrimary)};
    })()`, 1500).catch(() => {});
    const afterEscape = await evaluate(browser, sessionId, `(() => ({
        drawerHidden: document.querySelector('#adaptiveDetailDrawer')?.hidden ?? false,
        focusedModule: document.activeElement?.closest?.('.adaptive-panel')?.dataset?.module || '',
        activeTag: document.activeElement?.tagName || '',
        focusDebug: globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__ || null,
    }))()`);
    await evaluate(browser, sessionId, buildMockExpression({ template, text: missingText }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const missingDetails = await evaluate(browser, sessionId, `(() => ({
        panelsHidden: document.querySelector('#adaptivePanels')?.hidden ?? false,
        moduleCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
        text: document.querySelector('#adaptivePanels')?.textContent?.trim() || '',
    }))()`);
    const screenshotPath = await capture(browser, sessionId, `uap4-template-${template}`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (details.template !== template) failures.push(`template class mismatch: ${details.template}`);
    if (!details.beltClass.includes(`template-${template}`)) failures.push(`belt class missing template-${template}: ${details.beltClass}`);
    if (details.primaryModule !== expectedPrimary) failures.push(`primary module mismatch: ${details.primaryModule} !== ${expectedPrimary}`);
    for (const moduleId of expectedOrder) {
        if (!details.moduleOrder.includes(moduleId)) failures.push(`missing module ${moduleId}`);
    }
    try {
        assert.deepEqual(details.moduleOrder.slice(0, expectedOrder.length), expectedOrder);
    } catch (error) {
        failures.push(`module order mismatch: ${details.moduleOrder.join(',')} expected ${expectedOrder.join(',')}`);
    }
    if (details.drawerHiddenAfterOpen) failures.push('detail drawer did not open');
    if (details.drawerRole !== 'dialog' || details.drawerModal !== 'true') failures.push('detail drawer dialog aria is incomplete');
    if (!details.drawerTitle) failures.push('detail drawer title missing');
    if (details.focusedAfterOpen !== 'adaptiveDetailClose') failures.push(`focus did not move to close button: ${details.focusedAfterOpen}`);
    if (!afterEscape.drawerHidden) failures.push('Escape did not close detail drawer');
    if (afterEscape.focusedModule !== expectedPrimary) failures.push(`focus did not return to trigger module: ${afterEscape.focusedModule}`);
    if (details.scrollWidth > details.width + 1) failures.push(`horizontal overflow: ${details.scrollWidth} > ${details.width}`);
    if (!missingDetails.panelsHidden) failures.push('missing-field fixture did not hide adaptive panels');
    if (missingDetails.moduleCount !== 0) failures.push(`missing-field fixture rendered modules: ${missingDetails.moduleCount}`);
    if (missingDetails.text) failures.push(`missing-field fixture leaked display text: ${missingDetails.text}`);

    return {
        template,
        fixture,
        missingFixture,
        expectedPrimary,
        expectedOrder,
        screenshotPath,
        details,
        afterEscape,
        missingDetails,
        failures,
    };
}

function buildMockExpression({ template, text }) {
    const manifest = {
        schemaVersion: '1.0',
        id: `uap4-${template}`,
        version: '1.0.0',
        title: `UAP4 ${template}`,
        author: 'test',
        locale: 'zh-CN',
        contentRating: 'general',
        saveCompatibility: 'sillytavern-live-1',
        minimumPlayerVersion: '1.0.0',
        story: { mode: 'sillytavern-live', nodes: {} },
        defaultArcId: 'main',
        sillyTavernBindings: {
            target: { mode: 'single-character', characterRef: { name: 'UAP4 Test', avatar: 'uap4.png' }, chatSeedId: `uap4-${template}-seed` },
            characters: [{ id: 'UAP4 Test', role: 'narrator', avatar: 'uap4.png' }],
            worldBookRefs: [],
        },
        arcs: [{
            arcId: 'main',
            title: 'Main',
            status: 'published',
            presentationProfileId: 'default',
            sillyTavernBindings: {
                target: { mode: 'single-character', characterRef: { name: 'UAP4 Test', avatar: 'uap4.png' }, chatSeedId: `uap4-${template}-seed` },
                worldBookRefs: [],
            },
        }],
        adaptivePresentationProfiles: {
            default: {
                schemaVersion: 'galgame.adaptive-presentation.v1',
                profileId: `profile-${template}`,
                template,
                preferredModules: preferredModulesForTemplate(template),
                disabledModules: [],
                extractionPolicy: {
                    confidenceThreshold: 0.75,
                    maxRecentMessages: 4,
                    allowAdminPatterns: false,
                    allowBuiltinPatterns: true,
                    lowConfidenceBehavior: 'plain-dialogue',
                },
                adminPatterns: [],
                visualPriority: { primaryPanel: '', secondaryPanels: [], collapseBelowWidth: 640 },
            },
        },
        presentation: {},
        resourceBindings: { assets: {} },
    };
    const snapshot = {
        fileName: `uap4-${template}-seed`,
        messages: [{
            role: 'character',
            name: '旁白',
            text,
            displayText: text,
        }],
    };
    return `(() => {
        globalThis.__GALGAME_TEST_SET_MANIFEST__?.(${JSON.stringify(manifest)}, { release: {
            releaseId: 'rel-uap4-${template}',
            scenarioId: '${manifest.id}',
            scenarioVersion: '1.0.0',
            activeArcId: 'main'
        }});
        globalThis.__GALGAME_TEST_RENDER_ADAPTIVE__?.(${JSON.stringify(snapshot)}, 0);
    })()`;
}

function preferredModulesForTemplate(template) {
    return {
        'visual-novel': ['actions', 'events', 'relationships', 'locations', 'objectives', 'notes'],
        'rpg-adventure': ['rpg-status', 'inventory', 'abilities', 'quests', 'dice', 'actions'],
        'romance-social': ['relationships', 'affection', 'gifts', 'calendar', 'events', 'actions'],
        'mystery-investigation': ['clues', 'locations', 'suspects', 'objectives', 'notes', 'actions'],
        'management-sim': ['resources', 'factions', 'objectives', 'calendar', 'actions'],
        'sandbox-roleplay': ['locations', 'relationships', 'objectives', 'factions', 'notes', 'actions', 'events'],
    }[template] || ['actions', 'notes'];
}

async function startStaticServer(root, port) {
    const server = createServer((request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        const filePath = resolveStaticPath(root, url.pathname);
        try {
            const stat = statSync(filePath);
            if (stat.isDirectory()) {
                serveFile(path.join(filePath, 'index.html'), response);
                return;
            }
            serveFile(filePath, response);
        } catch {
            response.writeHead(404);
            response.end('not found');
        }
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    return server;
}

function resolveStaticPath(root, pathname) {
    const decoded = decodeURIComponent(pathname);
    const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
    return path.join(root, normalized || 'index.html');
}

async function serveFile(filePath, response) {
    const ext = path.extname(filePath);
    response.writeHead(200, { 'content-type': ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html; charset=utf-8' });
    if (filePath.endsWith(`${path.sep}game${path.sep}index.html`)) {
        const html = await readFile(filePath, 'utf8');
        response.end(html.replace('</head>', '<script>globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__=true;</script></head>'));
        return;
    }
    createReadStream(filePath).pipe(response);
}

async function openPage(browser, url, width, height) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const session = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = session.sessionId;
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
    }, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.navigate', { url }, sessionId);
    await waitForEvaluate(browser, sessionId, `(() => document.readyState === 'complete')()`, 10000);
    return { targetId, sessionId };
}

async function evaluate(browser, sessionId, expression) {
    const result = await browser.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'evaluation failed');
    }
    return result.result.value;
}

async function waitForEvaluate(browser, sessionId, expression, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await evaluate(browser, sessionId, expression).catch(() => false)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${expression}`);
}

async function capture(browser, sessionId, name) {
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const filePath = path.join(screenshotRoot, `${name}.png`);
    await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
    return filePath;
}

async function connectBrowser(port) {
    const deadline = Date.now() + 15000;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            const version = await getJson(`http://127.0.0.1:${port}/json/version`);
            return new CdpClient(version.webSocketDebuggerUrl);
        } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
    }
    throw new Error(`Chrome debugging endpoint unavailable: ${lastError?.message || 'unknown error'}`);
}

function getJson(url) {
    return new Promise((resolve, reject) => {
        const request = httpGet(url, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                body += chunk;
            });
            response.on('end', () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        });
        request.setTimeout(2000, () => {
            request.destroy(new Error('HTTP probe timed out'));
        });
        request.on('error', reject);
    });
}

async function getFreePort(start) {
    for (let port = start; port < start + 200; port += 1) {
        if (await canListen(port)) return port;
    }
    throw new Error('No free port');
}

function canListen(port) {
    return new Promise((resolve) => {
        const probe = createServer();
        probe.once('error', () => resolve(false));
        probe.once('listening', () => probe.close(() => resolve(true)));
        probe.listen(port, '127.0.0.1');
    });
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            statSync(candidate);
            return candidate;
        } catch {}
    }
    throw new Error('Chrome executable not found');
}
