import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import {
    createScriptImportAssistantService,
    MemoryDraftStore,
} from '../../external-modules/script-import-assistant/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/script-assistant-cors-browser-smoke.json');
const pagePort = await getFreePort(8811);
const servicePort = await getFreePort(8796);
const debugPort = await getFreePort(9259);
const pageOrigin = `http://127.0.0.1:${pagePort}`;
const serviceUrl = `http://127.0.0.1:${servicePort}`;
const adminToken = 'aa3-browser-cookie-token';
const sourceLine = 'Anna: this raw source text must not appear in evidence.';

const pageServer = await startPageServer(pagePort);
const assistantServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    corsOrigin: pageOrigin,
    resourceImporter: null,
});
await listen(assistantServer, servicePort);

const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(repoRoot, '.codex-longrun', `chrome-script-assistant-cors-${Date.now()}`)}`,
    'about:blank',
], {
    stdio: 'ignore',
    windowsHide: true,
});

try {
    const browser = await connectBrowser(debugPort);
    const { targetId, sessionId } = await openPage(browser, `${pageOrigin}/`);
    const details = await evaluate(browser, sessionId, `(async () => {
        document.cookie = 'galgame_script_admin_token=${adminToken}; path=/; SameSite=Lax';
        const response = await fetch('${serviceUrl}/v1/admin/script-import/drafts', {
            method: 'POST',
            credentials: 'include',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                protocolVersion: 'galgame.script-import-assistant.request.v1',
                files: [{
                    name: 'cors-smoke.md',
                    type: 'text/markdown',
                    text: '# CORS Smoke\\n角色: Anna, Andrei\\n${sourceLine}'
                }],
                options: { locale: 'zh-CN', preferredTemplate: 'auto' }
            })
        });
        const body = await response.json();
        return {
            fetchOk: response.ok,
            status: response.status,
            draftOk: Boolean(body?.draft?.draftId),
            serviceVisibleText: body?.draft?.summary?.title || '',
            cookieStillLocal: document.cookie.includes('galgame_script_admin_token='),
            bodyKeys: Object.keys(body || {}).sort()
        };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    const failures = [];
    if (!details.fetchOk || details.status !== 200 || !details.draftOk) {
        failures.push(`cross-origin credentialed draft request failed: ${JSON.stringify(details)}`);
    }
    if (JSON.stringify(details).includes(adminToken) || JSON.stringify(details).includes(sourceLine)) {
        failures.push('browser CORS smoke evidence leaked admin token or raw source text');
    }

    const evidence = {
        ok: failures.length === 0,
        generatedAt: new Date().toISOString(),
        level: 'real-browser-cross-origin-cookie-cors',
        pageOrigin,
        serviceUrl,
        credentialsMode: 'include',
        allowWildcardCredentials: false,
        proxyProofHeaderExposedToBrowser: false,
        details,
        failures,
    };
    await mkdir(path.dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: evidence.ok,
        evidence: toRepoPath(evidencePath),
        failures,
    }, null, 2));
    if (!evidence.ok) {
        process.exitCode = 1;
    }
} finally {
    chrome.kill();
    pageServer.close();
    assistantServer.close();
}

function startPageServer(port) {
    const server = createServer((request, response) => {
        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        response.end('<!doctype html><title>script assistant cors smoke</title><main>cors smoke</main>');
    });
    return listen(server, port).then(() => server);
}

function listen(server, port) {
    return new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
}

function getFreePort(start) {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on('error', () => {
            getFreePort(start + 1).then(resolve, reject);
        });
        server.listen(start, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function connectBrowser(port) {
    const endpoint = await waitForJson(`http://127.0.0.1:${port}/json/version`, 10000);
    const socket = new WebSocket(endpoint.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
    let id = 0;
    const pending = new Map();
    socket.on('message', (data) => {
        const message = JSON.parse(String(data));
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            if (message.error) {
                reject(new Error(message.error.message || 'CDP_ERROR'));
            } else {
                resolve(message.result || {});
            }
        }
    });
    return {
        send(method, params = {}, sessionId = '') {
            const messageId = ++id;
            socket.send(JSON.stringify({
                id: messageId,
                method,
                params,
                ...(sessionId ? { sessionId } : {}),
            }));
            return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
        },
    };
}

async function openPage(browser, url) {
    const target = await browser.send('Target.createTarget', { url: 'about:blank' });
    const session = await browser.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
    });
    await browser.send('Page.enable', {}, session.sessionId).catch(() => {});
    await browser.send('Runtime.enable', {}, session.sessionId).catch(() => {});
    await browser.send('Page.navigate', { url }, session.sessionId);
    await waitForEvaluate(browser, session.sessionId, 'document.readyState === "complete"', 10000);
    return {
        targetId: target.targetId,
        sessionId: session.sessionId,
    };
}

async function evaluate(browser, sessionId, expression) {
    const result = await browser.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
    }, sessionId);
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'EVALUATION_FAILED');
    }
    return result.result.value;
}

async function waitForEvaluate(browser, sessionId, expression, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await evaluate(browser, sessionId, expression)) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`WAIT_FOR_EVALUATE_TIMEOUT: ${expression}`);
}

async function waitForJson(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return response.json();
            }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`WAIT_FOR_JSON_TIMEOUT: ${url}`);
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ].filter(Boolean);
    return candidates.find(Boolean);
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
            continue;
        }
        parsed[key] = next;
        index += 1;
    }
    return parsed;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
