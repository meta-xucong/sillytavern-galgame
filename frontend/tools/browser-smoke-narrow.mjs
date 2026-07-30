import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createOriginalRuntimeBridgeServer } from '../../external-modules/original-runtime-bridge/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicRoot = path.join(repoRoot, 'public');
const screenshotRoot = path.join(repoRoot, '.codex-longrun', 'screenshots');
const args = parseArgs(process.argv.slice(2));
const externalBaseUrl = normalizeBaseUrl(args['base-url'] || '');
const expectedArcId = String(args['expected-arc-id'] || '').trim();
const expectedScenarioId = String(args['expected-scenario-id'] || '').trim();
const expectedScenarioVersion = String(args['expected-scenario-version'] || '').trim();
const expectedChatSeedId = String(args['expected-chat-seed-id'] || '').trim();
const requestedWebPort = Number(args['web-port'] || 0);
const webPort = externalBaseUrl ? 0 : (requestedWebPort || await getFreePort(8789));
const debugPort = await getFreePort(9249);
const smokeMetaOverrides = {
    sillyTavernBaseUrl: normalizeBaseUrl(args['sillytavern-base-url'] || ''),
    proxySillyTavernApi: args['proxy-sillytavern-api'] === 'true',
    configServiceUrl: Object.hasOwn(args, 'config-service-url') ? normalizeBaseUrl(args['config-service-url'] || '') : null,
    originalRuntimeBridgeUrl: Object.hasOwn(args, 'original-runtime-bridge-url')
        ? normalizeBaseUrl(args['original-runtime-bridge-url'] || '')
        : null,
    scriptImportAssistantUrl: Object.hasOwn(args, 'script-import-assistant-url')
        ? normalizeBaseUrl(args['script-import-assistant-url'] || '')
        : null,
};
const scriptImportFixturePath = args['script-import-fixture']
    ? path.resolve(repoRoot, args['script-import-fixture'])
    : '';
const scriptAssistantAdminToken = process.env[args['script-assistant-admin-token-env'] || 'GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_FOR_SMOKE'] || '';
const SMOKE_ST_PROXY_ALLOWED_ENDPOINTS = new Set([
    '/csrf-token',
    '/api/ping',
    '/api/characters/all',
    '/api/worldinfo/list',
    '/api/settings/get',
    '/api/characters/chats',
    '/api/chats/get',
    '/api/chats/save',
    '/api/chats/delete',
]);
const server = externalBaseUrl ? null : await startStaticServer(publicRoot, webPort, smokeMetaOverrides);
const runtimeBridgeServer = args['start-original-runtime-bridge'] === 'true'
    ? await startOriginalRuntimeBridge({
        port: Number(args['runtime-bridge-port'] || 8795),
        sillyTavernBaseUrl: normalizeBaseUrl(args['sillytavern-base-url'] || externalBaseUrl || 'http://127.0.0.1:8001'),
        allowedOrigins: [
            normalizeBaseUrl(externalBaseUrl || `http://127.0.0.1:${webPort}`),
            'http://127.0.0.1:8001',
            'http://localhost:8001',
        ].filter(Boolean),
    })
    : null;
const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${path.join(repoRoot, '.codex-longrun', `chrome-narrow-profile-${Date.now()}`)}`,
    'about:blank',
], {
    stdio: 'ignore',
    windowsHide: true,
});

try {
    await mkdir(screenshotRoot, { recursive: true });
    const browser = await connectBrowser(debugPort);
    const baseUrl = externalBaseUrl || `http://127.0.0.1:${webPort}`;
    const results = [];

    if (args['admin-script-import-assistant-only'] === 'true') {
        results.push(await withTimeout(
            checkAdminScriptImportAssistant(browser, baseUrl, { width: 1366, height: 768, label: 'desktop' }),
            45000,
            'admin script import assistant desktop check timed out',
        ));
        results.push(await withTimeout(
            checkAdminScriptImportAssistant(browser, baseUrl, { width: 390, height: 780, label: 'mobile' }),
            45000,
            'admin script import assistant mobile check timed out',
        ));
        const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
        const output = {
            ok: failures.length === 0,
            baseUrl,
            verification: {
                realBrowser: true,
                staticDomOnly: false,
                liveSillyTavernGeneration: false,
                adminScriptImportAssistantOnly: true,
                note: 'Narrow real-browser smoke for the beginner script import assistant homepage.',
            },
            results,
            failures,
        };
        console.log(JSON.stringify(output, null, 2));
        process.exitCode = output.ok ? 0 : 1;
        await withTimeout(browser.send('Browser.close').catch(() => {}), 3000, 'browser close timed out').catch(() => {});
        chrome.kill();
        await closeServer(runtimeBridgeServer);
        server?.close();
        process.exit(process.exitCode);
    }

    if (args['admin-script-import-assistant-real-only'] === 'true') {
        results.push(await withTimeout(
            checkAdminScriptImportAssistantReal(browser, baseUrl, { width: 1366, height: 768, label: 'desktop' }),
            240000,
            'real admin script import assistant desktop check timed out',
        ));
        const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
        const output = {
            ok: failures.length === 0,
            baseUrl,
            verification: {
                realBrowser: true,
                staticDomOnly: false,
                liveSillyTavernGeneration: false,
                adminScriptImportAssistantRealOnly: true,
                note: 'Real-browser smoke for the beginner script import assistant using the configured external assistant and config services.',
            },
            results,
            failures,
        };
        console.log(JSON.stringify(output, null, 2));
        process.exitCode = output.ok ? 0 : 1;
        await withTimeout(browser.send('Browser.close').catch(() => {}), 3000, 'browser close timed out').catch(() => {});
        chrome.kill();
        await closeServer(runtimeBridgeServer);
        server?.close();
        process.exit(process.exitCode);
    }

    results.push(await withTimeout(checkPlayer(browser, baseUrl), 45000, 'player check timed out'));
    results.push(await withTimeout(checkPlayerMobile(browser, baseUrl), 45000, 'player mobile layout check timed out'));
    if (args['player-only'] === 'true') {
        if (args['runtime-reply-smoke'] === 'true') {
            results.push(await runSmokeCheck({
                name: 'player-approved-original-runtime-reply',
                level: 'real-browser-live-sillytavern-runtime',
                timeoutMs: 240000,
                timeoutLabel: 'player original runtime reply check timed out',
                run: () => checkPlayerRuntimeReply(browser, baseUrl),
            }));
        }
        if (args['write-chat-smoke'] === 'true') {
            results.push(await runSmokeCheck({
                name: 'player-chat-write-and-readback',
                level: 'real-browser-live-sillytavern-chat-write',
                timeoutMs: 240000,
                timeoutLabel: 'player chat write check timed out',
                run: () => checkPlayerChatWrite(browser, baseUrl),
            }));
        }
        if (args['save-restore-smoke'] === 'true') {
            results.push(await runSmokeCheck({
                name: 'player-save-restore-original-chat-readback',
                level: 'real-browser-ui-save-restore',
                timeoutMs: 60000,
                timeoutLabel: 'player save restore check timed out',
                run: () => checkPlayerSaveRestore(browser, baseUrl),
            }));
        }
        const proxyDenylist = smokeMetaOverrides.proxySillyTavernApi
            ? await verifySmokeProxyDenylist(baseUrl)
            : null;
        if (proxyDenylist && !proxyDenylist.ok) {
            results.push({
                name: 'test-only-sillytavern-proxy-denylist',
                level: 'test-harness-boundary',
                details: proxyDenylist,
                failures: ['test-only proxy forwarded or failed to reject a prohibited SillyTavern endpoint'],
            });
        }
        const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
        const output = {
            ok: failures.length === 0,
            baseUrl,
            verification: {
                realBrowser: true,
                staticDomOnly: false,
                liveSillyTavernGeneration: args['runtime-reply-smoke'] === 'true',
                writeChatSmoke: args['write-chat-smoke'] === 'true',
                saveRestoreSmoke: args['save-restore-smoke'] === 'true',
                testOnlyProxyDenylist: proxyDenylist,
                note: args['runtime-reply-smoke'] === 'true'
                    ? 'Player-only browser smoke: verifies custom UI delegates one reply through the approved original-runtime bridge.'
                    : 'Player-only browser smoke: verifies custom route and original chat seed display only.',
            },
            results,
            failures,
        };
        console.log(JSON.stringify(output, null, 2));
        process.exitCode = output.ok ? 0 : 1;
        await withTimeout(browser.send('Browser.close').catch(() => {}), 3000, 'browser close timed out').catch(() => {});
        chrome.kill();
        await closeServer(runtimeBridgeServer);
        server?.close();
        process.exit(process.exitCode);
    }
    results.push(await withTimeout(checkAdminResources(browser, baseUrl), 45000, 'admin resources check timed out'));
    results.push(await withTimeout(checkAdminAdaptivePresentation(browser, baseUrl), 45000, 'admin adaptive presentation check timed out'));
    results.push(await withTimeout(checkAdminScriptImportAssistant(browser, baseUrl), 45000, 'admin script import assistant check timed out'));
    results.push(await withTimeout(checkAdminValidationPath(browser, baseUrl), 45000, 'admin validation check timed out'));
    results.push(await withTimeout(checkAdapterCall(browser, baseUrl), 45000, 'adapter and chat bridge check timed out'));
    if (args['runtime-reply-smoke'] === 'true') {
        results.push(await runSmokeCheck({
            name: 'player-approved-original-runtime-reply',
            level: 'real-browser-live-sillytavern-runtime',
            timeoutMs: 240000,
            timeoutLabel: 'player original runtime reply check timed out',
            run: () => checkPlayerRuntimeReply(browser, baseUrl),
        }));
    }
    if (args['write-chat-smoke'] === 'true') {
        results.push(await runSmokeCheck({
            name: 'player-chat-write-and-readback',
            level: 'real-browser-live-sillytavern-chat-write',
            timeoutMs: 240000,
            timeoutLabel: 'player chat write check timed out',
            run: () => checkPlayerChatWrite(browser, baseUrl),
        }));
    }
    if (args['save-restore-smoke'] === 'true') {
        results.push(await runSmokeCheck({
            name: 'player-save-restore-original-chat-readback',
            level: 'real-browser-ui-save-restore',
            timeoutMs: 60000,
            timeoutLabel: 'player save restore check timed out',
            run: () => checkPlayerSaveRestore(browser, baseUrl),
        }));
    }
    const proxyDenylist = smokeMetaOverrides.proxySillyTavernApi
        ? await verifySmokeProxyDenylist(baseUrl)
        : null;
    if (proxyDenylist && !proxyDenylist.ok) {
        results.push({
            name: 'test-only-sillytavern-proxy-denylist',
            level: 'test-harness-boundary',
            details: proxyDenylist,
            failures: ['test-only proxy forwarded or failed to reject a prohibited SillyTavern endpoint'],
        });
    }

    const failures = results.flatMap((result) => result.failures.map((failure) => `${result.name}: ${failure}`));
    const output = {
        ok: failures.length === 0,
        baseUrl,
        verification: {
            realBrowser: true,
            staticDomOnly: false,
            liveSillyTavernGeneration: args['runtime-reply-smoke'] === 'true',
            writeChatSmoke: args['write-chat-smoke'] === 'true',
            saveRestoreSmoke: args['save-restore-smoke'] === 'true',
            testOnlyProxyDenylist: proxyDenylist,
            note: args['runtime-reply-smoke'] === 'true'
                ? 'Narrow browser smoke plus approved original-runtime bridge generation.'
                : 'Narrow deterministic browser smoke: no live model generation is triggered.',
        },
        results,
        failures,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exitCode = output.ok ? 0 : 1;
    await withTimeout(browser.send('Browser.close').catch(() => {}), 3000, 'browser close timed out').catch(() => {});
    chrome.kill();
    await closeServer(runtimeBridgeServer);
    server?.close();
} catch (error) {
    await closeServer(runtimeBridgeServer);
    server?.close();
    chrome.kill();
    console.error(error);
    process.exitCode = 1;
}

async function waitForExpectedArcSlot(browser, sessionId) {
    if (!expectedArcId && !expectedScenarioId && !expectedScenarioVersion && !expectedChatSeedId) {
        return null;
    }
    const expression = `(async () => {
        const saveModule = await import('/game/shared/player-save.js');
        const store = saveModule.createPlayerSaveStore();
        const slot = await store.loadSlot(saveModule.AUTO_SAVE_ID).catch(() => null);
        if (!slot) return false;
        if (${JSON.stringify(expectedArcId)} && slot.arcId !== ${JSON.stringify(expectedArcId)}) return false;
        if (${JSON.stringify(expectedScenarioId)} && slot.scenarioId !== ${JSON.stringify(expectedScenarioId)}) return false;
        if (${JSON.stringify(expectedScenarioVersion)} && slot.scenarioVersion !== ${JSON.stringify(expectedScenarioVersion)}) return false;
        if (${JSON.stringify(expectedChatSeedId)} && slot.chatId !== ${JSON.stringify(expectedChatSeedId)}) return false;
        return true;
    })()`;
    await waitForEvaluate(browser, sessionId, expression, 10000).catch(() => {});
    return evaluate(browser, sessionId, `(async () => {
        const saveModule = await import('/game/shared/player-save.js');
        const store = saveModule.createPlayerSaveStore();
        const slot = await store.loadSlot(saveModule.AUTO_SAVE_ID).catch(() => null);
        return slot ? {
            saveId: slot.saveId,
            releaseId: slot.releaseId,
            scenarioId: slot.scenarioId,
            scenarioVersion: slot.scenarioVersion,
            arcId: slot.arcId || '',
            chatId: slot.chatId,
        } : null;
    })()`);
}

function collectActiveSlotExpectationFailures(activeArcSlot, label) {
    const failures = [];
    if (expectedArcId && activeArcSlot?.arcId !== expectedArcId) {
        failures.push(`${label} active Arc mismatch: ${activeArcSlot?.arcId || 'none'} !== ${expectedArcId}`);
    }
    if (expectedScenarioId && activeArcSlot?.scenarioId !== expectedScenarioId) {
        failures.push(`${label} active scenario mismatch: ${activeArcSlot?.scenarioId || 'none'} !== ${expectedScenarioId}`);
    }
    if (expectedScenarioVersion && activeArcSlot?.scenarioVersion !== expectedScenarioVersion) {
        failures.push(`${label} active scenario version mismatch: ${activeArcSlot?.scenarioVersion || 'none'} !== ${expectedScenarioVersion}`);
    }
    if (expectedChatSeedId && activeArcSlot?.chatId !== expectedChatSeedId) {
        failures.push(`${label} active chat seed mismatch: ${activeArcSlot?.chatId || 'none'} !== ${expectedChatSeedId}`);
    }
    return failures;
}

async function revealCurrentDialogue(browser, sessionId, { minLength = 20, maxClicks = 8 } = {}) {
    let state = await evaluate(browser, sessionId, `(() => ({
        href: window.location.href,
        gameHidden: document.querySelector('#gameScreen')?.hidden ?? true,
        titleHidden: document.querySelector('#titleScreen')?.hidden ?? false,
        speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
        dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
        stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
        inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
        adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
        adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
        adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim().slice(0, 500) || '',
    }))()`);

    for (let attempt = 0; attempt < maxClicks; attempt += 1) {
        if ((state.dialogue || '').length >= minLength || state.inputDisabled === false) {
            return state;
        }
        await evaluate(browser, sessionId, `document.querySelector('#dialogueBox')?.click()`);
        await delay(160);
        state = await evaluate(browser, sessionId, `(() => ({
            href: window.location.href,
            gameHidden: document.querySelector('#gameScreen')?.hidden ?? true,
            titleHidden: document.querySelector('#titleScreen')?.hidden ?? false,
            speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
            dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
            stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
            inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
            adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
            adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
            adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim().slice(0, 500) || '',
        }))()`);
    }

    return state;
}

async function checkPlayer(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/`, 1366, 768);
    const details = await evaluate(browser, sessionId, `(() => {
        const text = document.body.innerText || '';
        const forbiddenTerms = [
            'SillyTavern',
            '模型',
            'API',
            'Token',
            '提示词',
            '角色卡',
            '世界书',
            '预设',
            '权重',
            '生成控制',
            '故事入口',
            '场景管理',
            '剧本库',
            '原版资源'
        ];
        const links = [...document.querySelectorAll('a, button')]
            .map((node) => ({
                text: node.textContent.trim(),
                href: node.getAttribute('href') || '',
                dataTab: node.getAttribute('data-tab') || '',
            }));
        return {
            title: document.querySelector('#gameTitle')?.textContent?.trim() || '',
            initialHref: window.location.href,
            forbiddenTerms: forbiddenTerms.filter((term) => text.includes(term)),
            adminEntryCandidates: links.filter((link) => (
                /admin|管理|原版资源|故事入口|剧本|场景管理/i.test(link.text + ' ' + link.href + ' ' + link.dataTab)
            )),
            visibleText: text.slice(0, 500),
        };
    })()`);
    const screenshotPath = await capture(browser, sessionId, 'narrow-player-title');
    await evaluate(browser, sessionId, `(() => {
        window.confirm = () => true;
        document.querySelector('#startButton')?.click();
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => {
        const gameVisible = document.querySelector('#gameScreen')?.hidden === false;
        const dialogue = document.querySelector('#dialogueText')?.textContent?.trim() || '';
        return gameVisible && dialogue && !['正在准备故事。', '正在连接故事。'].includes(dialogue);
    })()`, baseUrl.includes('8001') ? 15000 : 5000).catch(() => {});
    const activeArcSlot = await waitForExpectedArcSlot(browser, sessionId);
    const stage = await revealCurrentDialogue(browser, sessionId, { minLength: 80, maxClicks: 24 });
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (!details.title) failures.push('player title did not render');
    if (stage.href !== details.initialHref) {
        failures.push(`player start button navigated away from custom Galgame UI: ${stage.href}`);
    }
    if (stage.gameHidden || !stage.titleHidden) failures.push('player start button did not enter custom Galgame stage');
    if (!stage.speaker || !stage.dialogue) failures.push('custom Galgame stage did not render speaker/dialogue placeholders');
    if (baseUrl.includes('8001') && stage.dialogue.includes('故事已经准备好')) {
        failures.push('actual player route showed empty ready prompt instead of original chat seed text');
    }
    if (baseUrl.includes('8001') && stage.dialogue.includes('故事暂时还没有接上')) {
        failures.push('actual player route did not load the bound original chat seed');
    }
    if (baseUrl.includes('8001') && stage.dialogue.length < 20) {
        failures.push(`actual player route did not show a substantive original chat seed text: ${stage.dialogue}`);
    }
    if (baseUrl.includes('8001') && details.title.includes('Dungeon Master') && stage.adaptivePanelCount < 2) {
        failures.push('Dungeon Master structured opening did not render adaptive display panels');
    }
    if (details.forbiddenTerms.length) failures.push(`player visible forbidden terms: ${details.forbiddenTerms.join(', ')}`);
    const adaptiveForbiddenTerms = details.forbiddenTerms
        .filter((term) => stage.adaptivePanelText.includes(term));
    if (adaptiveForbiddenTerms.length) {
        failures.push(`adaptive panels leaked forbidden terms: ${adaptiveForbiddenTerms.join(', ')}`);
    }
    if (details.adminEntryCandidates.length) failures.push(`player exposes admin/story-management entry candidates: ${JSON.stringify(details.adminEntryCandidates)}`);
    failures.push(...collectActiveSlotExpectationFailures(activeArcSlot, 'player'));

    return {
        name: 'player-visible-terms-and-route-isolation',
        level: 'real-browser',
        screenshotPath,
        details: {
            ...details,
            stage,
            activeArcSlot,
        },
        failures,
    };
}

async function checkPlayerMobile(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/?layout=mobile-${Date.now()}`, 390, 844);
    const title = await evaluate(browser, sessionId, `(() => ({
        href: window.location.href,
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        title: document.querySelector('#gameTitle')?.textContent?.trim() || '',
        startVisible: Boolean(document.querySelector('#startButton')?.offsetParent),
        loadVisible: Boolean(document.querySelector('#loadButtonTitle')?.offsetParent),
        settingsVisible: Boolean(document.querySelector('#settingsButtonTitle')?.offsetParent),
        text: document.body.innerText || '',
    }))()`);
    const titleScreenshotPath = await capture(browser, sessionId, 'narrow-player-title-mobile');
    await evaluate(browser, sessionId, `(() => {
        window.confirm = () => true;
        document.querySelector('#startButton')?.click();
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#gameScreen')?.hidden === false)()`, 5000);
    await waitForEvaluate(browser, sessionId, `(() => {
        const dialogue = document.querySelector('#dialogueText')?.textContent?.trim() || '';
        return dialogue && !['正在准备故事。', '正在连接故事。'].includes(dialogue);
    })()`, baseUrl.includes('8001') ? 15000 : 5000).catch(() => {});
    const activeArcSlot = await waitForExpectedArcSlot(browser, sessionId);
    await revealCurrentDialogue(browser, sessionId, { minLength: 80, maxClicks: 24 });
    const stage = await evaluate(browser, sessionId, `(() => {
        const input = document.querySelector('#playerInput');
        const send = document.querySelector('#sendButton');
        const history = document.querySelector('#historyButton');
        const save = document.querySelector('#saveButton');
        const load = document.querySelector('#loadButtonStage');
        const dialogue = document.querySelector('#dialogueBox');
        const rects = [input, send, history, save, load, dialogue].map((node) => {
            const rect = node?.getBoundingClientRect?.();
            return rect ? {
                id: node.id,
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                top: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
                width: Math.round(rect.width),
                height: Math.round(rect.height),
            } : null;
        }).filter(Boolean);
        return {
            href: window.location.href,
            width: document.documentElement.clientWidth,
            scrollWidth: document.documentElement.scrollWidth,
            gameHidden: document.querySelector('#gameScreen')?.hidden ?? true,
            titleHidden: document.querySelector('#titleScreen')?.hidden ?? false,
            speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
            dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
            adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
            adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
            adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim().slice(0, 500) || '',
            inputTag: input?.tagName || '',
            sendText: send?.textContent?.trim() || '',
            rects,
        };
    })()`);
    await evaluate(browser, sessionId, `document.querySelector('#historyButton')?.click()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#historyDrawer')?.hidden === false)()`, 5000);
    const historyOpen = await evaluate(browser, sessionId, `(() => ({
        hidden: document.querySelector('#historyDrawer')?.hidden ?? true,
        text: document.querySelector('#historyDrawer')?.innerText?.slice(0, 300) || '',
        scrollWidth: document.documentElement.scrollWidth,
        width: document.documentElement.clientWidth,
    }))()`);
    await evaluate(browser, sessionId, `document.querySelector('[data-close-drawer]')?.click()`);
    await evaluate(browser, sessionId, `document.querySelector('#loadButtonStage')?.click()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#saveLoadDrawer')?.hidden === false)()`, 5000);
    const saveLoadOpen = await evaluate(browser, sessionId, `(() => ({
        hidden: document.querySelector('#saveLoadDrawer')?.hidden ?? true,
        text: document.querySelector('#saveLoadDrawer')?.innerText?.slice(0, 300) || '',
        scrollWidth: document.documentElement.scrollWidth,
        width: document.documentElement.clientWidth,
    }))()`);
    const stageScreenshotPath = await capture(browser, sessionId, 'narrow-player-stage-mobile');
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const forbiddenTerms = [
        'SillyTavern',
        '模型',
        'API',
        'Token',
        '提示词',
        '角色卡',
        '世界书',
        '预设',
        '权重',
        '生成控制',
        '原版资源',
        '管理员',
    ];
    const failures = [];
    if (!title.title || !title.startVisible || !title.loadVisible || !title.settingsVisible) {
        failures.push('mobile title menu did not render required player controls');
    }
    if (title.scrollWidth > title.width + 2) {
        failures.push(`mobile title has horizontal overflow: ${title.scrollWidth} > ${title.width}`);
    }
    if (stage.scrollWidth > stage.width + 2) {
        failures.push(`mobile stage has horizontal overflow: ${stage.scrollWidth} > ${stage.width}`);
    }
    if (stage.href !== title.href) {
        failures.push(`mobile start navigated away from custom Galgame UI: ${stage.href}`);
    }
    if (stage.gameHidden || !stage.titleHidden) {
        failures.push('mobile start did not enter stage');
    }
    if (stage.inputTag !== 'TEXTAREA') {
        failures.push('mobile player input is not a multiline textarea');
    }
    if (stage.sendText !== '送出') {
        failures.push('mobile send button copy is not localized');
    }
    if (!stage.speaker || !stage.dialogue) {
        failures.push('mobile stage did not render speaker/dialogue');
    }
    if (baseUrl.includes('8001') && title.title.includes('Dungeon Master') && stage.adaptivePanelCount < 2) {
        failures.push('mobile Dungeon Master structured opening did not render adaptive display panels');
    }
    for (const rect of stage.rects) {
        if (rect.left < -2 || rect.right > stage.width + 2) {
            failures.push(`mobile element overflows viewport: ${rect.id}`);
        }
        if (rect.top < -2 || rect.bottom > 844 + 2) {
            failures.push(`mobile element vertical overflow: ${rect.id}`);
        }
        if (rect.height < 34 && rect.id !== 'dialogueBox') {
            failures.push(`mobile touch target is too short: ${rect.id}`);
        }
    }
    if (historyOpen.hidden || !historyOpen.text.includes('历史')) {
        failures.push('mobile history drawer did not open');
    }
    if (historyOpen.scrollWidth > historyOpen.width + 2) {
        failures.push('mobile history drawer has horizontal overflow');
    }
    if (saveLoadOpen.hidden || !saveLoadOpen.text.includes('读取')) {
        failures.push('mobile save/load drawer did not open');
    }
    if (saveLoadOpen.scrollWidth > saveLoadOpen.width + 2) {
        failures.push('mobile save/load drawer has horizontal overflow');
    }
    const visibleText = [title.text, stage.dialogue, historyOpen.text, saveLoadOpen.text].join('\n');
    const visibleForbidden = forbiddenTerms.filter((term) => visibleText.includes(term));
    if (visibleForbidden.length) {
        failures.push(`mobile visible forbidden terms: ${visibleForbidden.join(', ')}`);
    }
    failures.push(...collectActiveSlotExpectationFailures(activeArcSlot, 'mobile'));

    return {
        name: 'player-mobile-layout-and-drawers',
        level: 'real-browser',
        screenshotPath: stageScreenshotPath,
        details: {
            titleScreenshotPath,
            title,
            stage,
            historyOpen,
            saveLoadOpen,
            activeArcSlot,
        },
        failures,
    };
}

async function checkAdminResources(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game-admin/`, 1366, 768);
    await waitForEvaluate(browser, sessionId, `(() => Boolean(document.querySelector('[data-tab="advanced"]')))()`, 10000);
    await evaluate(browser, sessionId, `document.querySelector('[data-tab="advanced"]')?.click()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#advancedPanel')?.classList.contains('is-hidden') === false)()`, 10000);
    await waitForEvaluate(browser, sessionId, `(() => Boolean(document.querySelector('#characterBindingList .binding-card')))()`, 10000).catch(() => {});
    const details = await evaluate(browser, sessionId, `(() => {
        const panel = document.querySelector('#advancedPanel');
        const text = panel?.innerText || '';
        return {
            pageTitle: document.querySelector('#pageTitle')?.textContent?.trim() || '',
            panelHidden: panel?.classList.contains('is-hidden') ?? true,
            hasCharacterList: Boolean(document.querySelector('#characterBindingList .binding-card')),
            hasWorldBookList: Boolean(document.querySelector('#worldBookBindingList .binding-card')),
            hasSettingList: Boolean(document.querySelector('#settingBindingList .binding-card')),
            hasLiveCheckButton: Boolean(document.querySelector('#resourceLiveCheckButton')),
            liveResultText: document.querySelector('#resourceLiveResult')?.textContent?.trim() || '',
            evidenceCards: [...document.querySelectorAll('[data-evidence-card]')].map((node) => node.getAttribute('data-evidence-card')),
            referenceEvidenceText: document.querySelector('#referenceEvidenceList')?.innerText?.trim() || '',
            runtimeEvidenceText: document.querySelector('#runtimeEvidenceList')?.innerText?.trim() || '',
            deferredEvidenceText: document.querySelector('#deferredEvidenceList')?.innerText?.trim() || '',
            hasParityNote: text.includes('原版维护边界') && text.includes('资源本体') && text.includes('原版维护入口'),
            hasSecurityNote: text.includes('安全提醒') && text.includes('不等于登录保护'),
            textPreview: text.slice(0, 1200),
        };
    })()`);
    const screenshotPath = await capture(browser, sessionId, 'narrow-admin-resources');
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (details.panelHidden) failures.push('admin resource panel did not open');
    if (details.pageTitle !== '更多检查') failures.push(`admin page title was ${JSON.stringify(details.pageTitle)}`);
    if (!details.hasCharacterList) failures.push('admin resource page did not render original character binding list');
    if (!details.hasWorldBookList) failures.push('admin resource page did not render original world book binding list');
    if (!details.hasSettingList) failures.push('admin resource page did not render original preset/context binding list');
    if (!details.hasLiveCheckButton) failures.push('admin resource page live diagnostic button is missing');
    if (!details.liveResultText.includes('尚未测试原版连通')) failures.push('admin resource page live diagnostic status is missing');
    if (JSON.stringify(details.evidenceCards) !== JSON.stringify(['reference-exists', 'runtime-evidence', 'deferred-evidence'])) {
        failures.push(`admin advanced evidence cards are incomplete: ${details.evidenceCards.join(', ')}`);
    }
    if (!details.referenceEvidenceText.includes('引用存在')) {
        failures.push(`admin reference evidence did not distinguish reference existence: ${details.referenceEvidenceText}`);
    }
    if (!details.runtimeEvidenceText.includes('只在真实生成证据中显示已验证')) {
        failures.push(`admin runtime evidence did not preserve evidence-only wording: ${details.runtimeEvidenceText}`);
    }
    if (!details.deferredEvidenceText.includes('自动切换暂未接入')) {
        failures.push(`admin deferred evidence did not preserve unbridged wording: ${details.deferredEvidenceText}`);
    }
    if (/已应用|已启用/.test(details.deferredEvidenceText)) {
        failures.push(`admin deferred evidence incorrectly claims runtime application: ${details.deferredEvidenceText}`);
    }
    if (!details.hasParityNote) failures.push('admin resource page parity boundary note is missing');
    if (!details.hasSecurityNote) failures.push('admin advanced check security note is missing');

    return {
        name: 'admin-original-resource-page-dom',
        level: 'real-browser',
        screenshotPath,
        details,
        failures,
    };
}

async function checkAdminAdaptivePresentation(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game-admin/`, 1366, 768);
    await waitForEvaluate(browser, sessionId, `(() => Boolean(document.querySelector('[data-tab="enhancements"]')))()`, 10000);
    await evaluate(browser, sessionId, `document.querySelector('[data-tab="enhancements"]')?.click()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#enhancementsPanel')?.classList.contains('is-hidden') === false)()`, 10000);
    const details = await evaluate(browser, sessionId, `(() => {
        const panel = document.querySelector('#enhancementsPanel');
        const modules = [...document.querySelectorAll('#profileModuleList input[type="checkbox"]')]
            .map((input) => ({ value: input.value, checked: input.checked }));
        const beforeEditor = document.querySelector('#manifestEditor')?.value || '';
        document.querySelector('#profileApplyButton')?.click();
        const afterEditor = document.querySelector('#manifestEditor')?.value || '';
        let parsed = null;
        try {
            parsed = JSON.parse(afterEditor);
        } catch {}
        const profileId = parsed?.arcs?.[0]?.presentationProfileId || '';
        const profile = parsed?.adaptivePresentationProfiles?.[profileId] || null;
        const enhancementCardIds = [...document.querySelectorAll('[data-enhancement-card]')]
            .map((node) => node.getAttribute('data-enhancement-card'));
        const secretFields = [...document.querySelectorAll('#enhancementsPanel input')]
            .filter((input) => ['password', 'search'].includes(input.type) || /key|token|secret/i.test(input.id + input.name + input.placeholder))
            .map((input) => ({
                id: input.id,
                type: input.type,
                placeholder: input.placeholder,
            }));
        return {
            pageTitle: document.querySelector('#pageTitle')?.textContent?.trim() || '',
            panelHidden: panel?.classList.contains('is-hidden') ?? true,
            arcName: document.querySelector('#profileArcName')?.textContent?.trim() || '',
            templateValue: document.querySelector('#profileTemplateSelect')?.value || '',
            moduleCount: modules.length,
            checkedModules: modules.filter((module) => module.checked).map((module) => module.value),
            resultText: document.querySelector('#profileResult')?.textContent?.trim() || '',
            enhancementCardIds,
            secretFields,
            editorChangedOrStable: Boolean(afterEditor && beforeEditor),
            profile,
            forbiddenProfileValues: profile
                ? ['hp', 'mp', 'inventory', 'affection', 'relationship', 'relationships', 'quest', 'quests', 'clues', 'resources', 'variables', 'node', 'route', 'ending', 'choice']
                    .filter((key) => Object.prototype.hasOwnProperty.call(profile, key))
                : [],
            textPreview: panel?.innerText?.slice(0, 1200) || '',
        };
    })()`);
    const screenshotPath = await capture(browser, sessionId, 'narrow-admin-adaptive-presentation');
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (details.panelHidden) failures.push('admin adaptive presentation panel did not open');
    if (details.pageTitle !== '画面设置') failures.push(`admin adaptive page title was ${JSON.stringify(details.pageTitle)}`);
    if (!details.arcName) failures.push('admin adaptive panel did not show selected Arc/profile binding');
    if (!details.templateValue) failures.push('admin adaptive template select is empty');
    if (details.moduleCount < 8) failures.push(`admin adaptive module checklist is incomplete: ${details.moduleCount}`);
    if (!details.profile) failures.push('admin adaptive apply did not write adaptivePresentationProfiles entry');
    if (details.forbiddenProfileValues.length) failures.push(`admin adaptive profile stored module authority values: ${details.forbiddenProfileValues.join(', ')}`);
    if (!details.resultText.includes('展示配置有效') && !details.resultText.includes('已应用')) {
        failures.push(`admin adaptive result text did not confirm display-only configuration: ${details.resultText}`);
    }
    if (JSON.stringify(details.enhancementCardIds) !== JSON.stringify(['display-template', 'media-provider', 'visual-assets', 'content-notice', 'service-check'])) {
        failures.push(`admin enhancement cards are incomplete or reordered unexpectedly: ${details.enhancementCardIds.join(', ')}`);
    }
    if (!details.textPreview.includes('密钥不放这里') || !details.textPreview.includes('外部媒体服务中配置')) {
        failures.push(`admin media enhancement does not keep secret boundary visible: ${details.textPreview}`);
    }
    if (!details.textPreview.includes('背景和立绘') || !details.textPreview.includes('内容提示') || !details.textPreview.includes('服务检查')) {
        failures.push(`admin enhancement page is missing independent add-on cards: ${details.textPreview}`);
    }
    if (!details.textPreview.includes('只影响画面') || !details.textPreview.includes('不写剧情') || !details.textPreview.includes('只看状态')) {
        failures.push(`admin enhancement cards do not explain display-only/no-story boundaries: ${details.textPreview}`);
    }
    if (details.secretFields.length) {
        failures.push(`admin enhancement page exposes secret input fields: ${JSON.stringify(details.secretFields)}`);
    }

    return {
        name: 'admin-adaptive-presentation-profile-dom',
        level: 'real-browser',
        screenshotPath,
        details,
        failures,
    };
}

async function checkAdminScriptImportAssistant(browser, baseUrl, viewport = { width: 1366, height: 768, label: 'desktop' }) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game-admin/`, viewport.width, viewport.height);
    await waitForEvaluate(browser, sessionId, `(() => Boolean(document.querySelector('[data-tab="publish"]')))()`, 10000);
    const details = await evaluate(browser, sessionId, `(async () => {
        const originalFetch = window.fetch.bind(window);
        const calls = [];
        const sourceDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
        const evidenceDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const draftOne = {
            protocolVersion: 'galgame.script-import-draft.v1',
            draftId: 'draft_ui_smoke_20260728',
            revision: 1,
            status: 'ready-for-confirmation',
            summary: {
                title: '月下学园',
                recommendedTemplate: 'rpg-adventure',
                mainCharacters: ['Anna', 'Andrei'],
                estimatedArcs: 2,
                usesLlm: true,
                importOnly: true,
                playerCallable: false
            },
            importPlan: {
                writePolicy: 'deferred-aa3',
                characterName: 'Galgame_AIImport_MoonlitSchool',
                characterAvatar: 'galgame_aiimport_moonlit_school.png',
                worldBookName: 'Galgame_AIImport_MoonlitSchool_World',
                chatSeedId: 'galgame-aiimport-moonlit-school-seed'
            },
            presentationRecommendation: {
                schemaVersion: 'galgame.presentation-recommendation.v1',
                recommendationId: 'rec_uismoke20260728',
                sourceDigest,
                draftId: 'draft_ui_smoke_20260728',
                revision: 1,
                detectedGenre: 'rpg-adventure',
                confidence: 0.84,
                recommendedProfile: {
                    template: 'rpg-adventure',
                    preferredModules: ['rpg-status', 'inventory', 'abilities', 'quests', 'dice', 'actions'],
                    disabledModules: [],
                    extractionPolicy: {
                        confidenceThreshold: 0.72,
                        maxRecentMessages: 8,
                        allowAdminPatterns: false,
                        allowBuiltinPatterns: true,
                        lowConfidenceBehavior: 'plain-dialogue'
                    },
                    visualPriority: {
                        primaryPanel: 'rpg-status',
                        secondaryPanels: ['inventory', 'abilities', 'quests'],
                        collapseBelowWidth: 640
                    }
                },
                evidence: {
                    evidenceDigest,
                    sourceKind: 'uploaded-admin-material',
                    matchedSignals: ['signal-hp-ac-format', 'signal-equipment-section', 'signal-quest-objective'],
                    exampleTemplateCodes: ['example-hp-current-max', 'example-equipment-with-visible-traits']
                },
                safeWarnings: ['warning-admin-review-required', 'warning-patterns-disabled'],
                noClaim: ['no-runtime-llm-assistant', 'no-frontend-combat-calculation', 'no-prompt-context-copy'],
                usesLlm: true
            },
            warnings: []
        };
        const draftTwo = {
            ...draftOne,
            revision: 2,
            summary: {
                ...draftOne.summary,
                estimatedArcs: 3,
                usesLlm: false
            },
            presentationRecommendation: {
                ...draftOne.presentationRecommendation,
                recommendationId: 'rec_uismoke20260728b',
                revision: 2,
                confidence: 0.46,
                evidence: {
                    ...draftOne.presentationRecommendation.evidence,
                    matchedSignals: ['signal-vn-dialogue-format', 'signal-unknown-structure']
                },
                safeWarnings: ['warning-deterministic-fallback-used', 'warning-provider-output-rejected', 'warning-admin-review-required'],
                usesLlm: false
            },
            safeWarnings: ['AI 整理结果未通过安全校验。原因：SCRIPT_IMPORT_LLM_HTTP_STATUS_500 https://provider.example token abc']
        };
        const scriptAssistantManifest = {
            schemaVersion: '1.0',
            id: 'galgame-aiimport-moonlit-school',
            version: '1.0.0-ui-smoke',
            title: '月下学园',
            author: '本地导入',
            locale: 'zh-CN',
            contentRating: 'mature',
            saveCompatibility: 'sillytavern-live-1',
            minimumPlayerVersion: '1.0.0',
            story: { mode: 'sillytavern-live', nodes: {} },
            sillyTavernBindings: {
                target: {
                    mode: 'single-character',
                    characterRef: {
                        name: 'Galgame_AIImport_MoonlitSchool',
                        avatar: 'galgame_aiimport_moonlit_school.png'
                    },
                    chatSeedId: 'galgame-aiimport-moonlit-school-seed'
                },
                worldBookRefs: ['Galgame_AIImport_MoonlitSchool_World'],
                characters: [{
                    id: 'Galgame_AIImport_MoonlitSchool',
                    role: 'narrator',
                    avatar: 'galgame_aiimport_moonlit_school.png'
                }],
                worldBooks: [{
                    name: 'Galgame_AIImport_MoonlitSchool_World',
                    mode: 'manual',
                    weight: 100
                }],
                chatSeedId: 'galgame-aiimport-moonlit-school-seed'
            },
            defaultArcId: 'main',
            arcs: [{
                schemaVersion: 'galgame.arc-release.v1',
                arcBindingId: 'galgame-aiimport-moonlit-school:1.0.0-ui-smoke:main:v1',
                scenarioId: 'galgame-aiimport-moonlit-school',
                scenarioVersion: '1.0.0-ui-smoke',
                arcId: 'main',
                arcVersion: '1.0.0',
                title: '开始',
                order: 1,
                status: 'draft',
                sillyTavernBindings: {
                    target: {
                        mode: 'single-character',
                        characterRef: {
                            name: 'Galgame_AIImport_MoonlitSchool',
                            avatar: 'galgame_aiimport_moonlit_school.png'
                        },
                        chatSeedId: 'galgame-aiimport-moonlit-school-seed'
                    },
                    worldBookRefs: ['Galgame_AIImport_MoonlitSchool_World']
                },
                presentationProfileId: 'default',
                mediaPolicyId: 'default',
                contentRating: 'mature',
                createdAt: '2026-07-26T00:00:00+08:00'
            }],
            presentation: {
                titleBackgroundAsset: 'title_scene',
                defaultBackgroundAsset: 'default_stage',
                titleTone: 'quiet'
            },
            resourceBindings: { assets: {} },
            metadata: {
                importedBy: 'script-import-assistant',
                sourceDigest: 'ui-smoke'
            }
        };
        window.GALGAME_SCRIPT_IMPORT_ASSISTANT_URL = 'https://assistant.example';
        window.fetch = async (url, options = {}) => {
            const urlText = String(url);
            if (!urlText.startsWith('https://assistant.example')) {
                return originalFetch(url, options);
            }
            const headers = {};
            if (options.headers instanceof Headers) {
                for (const [key, value] of options.headers.entries()) {
                    headers[key] = value;
                }
            } else {
                Object.assign(headers, options.headers || {});
            }
            const bodyText = String(options.body || '');
            let bodySummary = {
                length: bodyText.length,
                fileCount: 0,
                hasProtocolVersion: false,
                requestIncludesUploadedFileText: bodyText.includes('Anna: 这行原始正文不能留在页面缓存里。')
            };
            try {
                const parsedBody = bodyText ? JSON.parse(bodyText) : {};
                bodySummary = {
                    ...bodySummary,
                    fileCount: Array.isArray(parsedBody.files) ? parsedBody.files.length : 0,
                    hasProtocolVersion: parsedBody.protocolVersion === 'galgame.script-import-assistant.request.v1'
                };
            } catch {}
            calls.push({
                url: urlText,
                method: options.method || 'GET',
                headers,
                credentials: options.credentials || '',
                bodySummary
            });
            if (urlText.endsWith('/v1/health')) {
                return new Response(JSON.stringify({
                    ok: true,
                    service: 'script-import-assistant',
                    protocolVersion: 'galgame.script-import-assistant.health.v1',
                    adminAuth: { required: true, configured: true, mode: 'external-auth-boundary' },
                    llm: { configured: true, model: 'mocked-ui-smoke' }
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            if (urlText.endsWith('/v1/admin/script-import/drafts')) {
                return new Response(JSON.stringify({ ok: true, draft: draftOne }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            if (urlText.endsWith('/redeploy')) {
                return new Response(JSON.stringify({ ok: true, draft: draftTwo }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            if (urlText.endsWith('/confirm')) {
                const confirmedDraft = {
                    ...draftTwo,
                    status: 'confirmed-ready-for-publish',
                    importPlan: {
                        ...draftTwo.importPlan,
                        writePolicy: 'imported-aa3'
                    }
                };
                return new Response(JSON.stringify({
                    ok: true,
                    status: 'ready-for-publish',
                    safeMessage: '已写入原版故事材料，并生成可上架入口草稿。',
                    draft: confirmedDraft,
                    manifest: scriptAssistantManifest,
                    validation: { valid: true, warnings: [] },
                    importResult: {
                        mode: 'original-sillytavern-api',
                        actions: [
                            { kind: 'worldbook', action: 'created' },
                            { kind: 'character', action: 'created' },
                            { kind: 'chat-seed', action: 'created' }
                        ],
                        safeguards: {
                            presetWritten: false,
                            playerManifestBodyWritten: false
                        }
                    }
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        };
        document.querySelector('[data-tab="dashboard"]')?.click();
        document.querySelector('#refreshButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const input = document.querySelector('#scriptFileInput');
        const transfer = new DataTransfer();
        transfer.items.add(new File([
            '# 月下学园\\n角色: Anna, Andrei\\nAnna: 这行原始正文不能留在页面缓存里。'
        ], 'moonlit-school.md', { type: 'text/markdown' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 400));
        const beforeOrganize = {
            service: document.querySelector('#scriptAssistantServiceStatus')?.textContent?.trim() || '',
            fileSummary: document.querySelector('#scriptFileSummary')?.textContent?.trim() || '',
            organizeDisabled: document.querySelector('#organizeScriptButton')?.disabled ?? true
        };
        document.querySelector('#organizeScriptButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const afterOrganize = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            fileSummary: document.querySelector('#scriptFileSummary')?.textContent?.trim() || '',
            preview: document.querySelector('#scriptDraftPreview')?.innerText?.trim() || '',
            recommendationCard: document.querySelector('[data-presentation-recommendation-card="true"]')?.innerText?.trim() || '',
            recommendationAcceptButton: document.querySelector('[data-recommendation-accept-button="true"]')?.textContent?.trim() || '',
            selectedFileCount: document.querySelector('#scriptFileInput')?.files?.length ?? -1,
            redeployDisabled: document.querySelector('#redeployScriptButton')?.disabled ?? true,
            confirmDisabled: document.querySelector('#confirmScriptDraftButton')?.disabled ?? true
        };
        document.querySelector('[data-recommendation-accept-button="true"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 120));
        const afterAccept = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            recommendationCard: document.querySelector('[data-presentation-recommendation-card="true"]')?.innerText?.trim() || '',
            adminCallCount: calls.filter((call) => /\\/v1\\/admin\\//.test(call.url)).length
        };
        document.querySelector('#redeployScriptButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const afterRedeploy = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            preview: document.querySelector('#scriptDraftPreview')?.innerText?.trim() || '',
            recommendationCard: document.querySelector('[data-presentation-recommendation-card="true"]')?.innerText?.trim() || ''
        };
        const editorBeforeConfirm = document.querySelector('#manifestEditor')?.value || '';
        document.querySelector('#confirmScriptDraftButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 500));
        const editorAfterConfirm = document.querySelector('#manifestEditor')?.value || '';
        const afterConfirm = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            preview: document.querySelector('#scriptDraftPreview')?.innerText?.trim() || '',
            editorChanged: editorAfterConfirm !== editorBeforeConfirm,
            editorContainsGeneratedManifest: editorAfterConfirm.includes('galgame-aiimport-moonlit-school')
                && editorAfterConfirm.includes('Galgame_AIImport_MoonlitSchool_World')
                && !editorAfterConfirm.includes('Anna: 这行原始正文')
        };
        const localStorageLeaks = Object.keys(localStorage)
            .filter((key) => /script|assistant|draft|source|upload/i.test(key))
            .map((key) => ({ key, value: String(localStorage.getItem(key) || '').slice(0, 240) }));
        return {
            panelVisible: document.querySelector('#dashboardPanel')?.classList.contains('is-hidden') === false,
            hasCard: Boolean(document.querySelector('[data-script-assistant-card="upload"]')),
            beforeOrganize,
            afterOrganize,
            afterAccept,
            afterRedeploy,
            afterConfirm,
            calls,
            localStorageLeaks,
            pageTextPreview: (document.body.innerText || '').slice(0, 1200)
        };
    })()`);
    const screenshotPath = await capture(browser, sessionId, `narrow-admin-script-import-assistant-${viewport.label || 'desktop'}`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (!details.panelVisible) failures.push('admin dashboard panel did not open for script assistant');
    if (!details.hasCard) failures.push('script assistant upload card is missing');
    if (details.beforeOrganize.service !== 'AI 已就绪') failures.push(`service status did not switch to AI ready: ${details.beforeOrganize.service}`);
    if (!details.beforeOrganize.fileSummary.includes('1 个文件已选择')) failures.push(`selected file summary missing: ${details.beforeOrganize.fileSummary}`);
    if (details.beforeOrganize.organizeDisabled) failures.push('organize button remained disabled after selecting a file');
    if (!details.afterOrganize.result.includes('AI 已整理完成')) failures.push(`organize result missing AI status: ${details.afterOrganize.result}`);
    if (!details.afterOrganize.fileSummary.includes('文件正文已从页面临时缓存清除')) failures.push(`file source was not cleared after draft creation: ${details.afterOrganize.fileSummary}`);
    if (details.afterOrganize.selectedFileCount !== 0) failures.push(`file input still holds selected source files: ${details.afterOrganize.selectedFileCount}`);
    if (!details.afterOrganize.preview.includes('已用 AI 帮你整理') || !details.afterOrganize.preview.includes('月下学园') || !details.afterOrganize.preview.includes('角色资料') || !details.afterOrganize.preview.includes('开场记录')) {
        failures.push(`draft preview did not show beginner summary/import plan: ${details.afterOrganize.preview}`);
    }
    if (!details.afterOrganize.recommendationCard.includes('推荐界面') || !details.afterOrganize.recommendationCard.includes('RPG 冒险') || !details.afterOrganize.recommendationCard.includes('状态') || !details.afterOrganize.recommendationCard.includes('背包') || !details.afterOrganize.recommendationCard.includes('发现 HP/AC 等可见状态')) {
        failures.push(`presentation recommendation card did not show fixed beginner labels: ${details.afterOrganize.recommendationCard}`);
    }
    if (/rec_|sha256:|sourceDigest|evidenceDigest|provider|token|api[_-]?key|Anna: 这行原始正文/i.test(details.afterOrganize.recommendationCard)) {
        failures.push(`presentation recommendation card leaked raw provider/source/identity details: ${details.afterOrganize.recommendationCard}`);
    }
    if (!details.afterOrganize.recommendationAcceptButton.includes('采用这个界面建议')) {
        failures.push(`presentation recommendation accept button missing: ${details.afterOrganize.recommendationAcceptButton}`);
    }
    if (!details.afterAccept.recommendationCard.includes('已采用，等待确认') || !details.afterAccept.result.includes('不会改变原版故事') || details.afterAccept.adminCallCount !== 1) {
        failures.push(`presentation recommendation accept did not remain local pending state: ${JSON.stringify(details.afterAccept)}`);
    }
    if (details.afterOrganize.preview.includes('Anna: 这行原始正文')) {
        failures.push('draft preview leaked uploaded raw source text');
    }
    if (!details.afterRedeploy.result.includes('基础方式重新整理') || !details.afterRedeploy.preview.includes('已用基础方式整理') || !details.afterRedeploy.preview.includes('第 2 版')) {
        failures.push(`redeploy did not update draft revision: ${details.afterRedeploy.result} / ${details.afterRedeploy.preview}`);
    }
    if (!details.afterRedeploy.recommendationCard.includes('基础判断') || !details.afterRedeploy.recommendationCard.includes('AI 输出未通过安全检查') || !details.afterRedeploy.recommendationCard.includes('建议人工确认')) {
        failures.push(`redeploy did not show fixed fallback recommendation state: ${details.afterRedeploy.recommendationCard}`);
    }
    if (/SCRIPT_IMPORT_LLM_|https?:\/\/|token abc/i.test(details.afterRedeploy.preview)) {
        failures.push(`redeploy warning leaked provider internals: ${details.afterRedeploy.preview}`);
    }
    if (!details.afterConfirm.result.includes('已写入原版故事材料') || !details.afterConfirm.result.includes('可上架故事入口')) {
        failures.push(`confirm did not show AA3 handoff wording: ${details.afterConfirm.result}`);
    }
    if (!details.afterConfirm.preview.includes('已经准备好') || !details.afterConfirm.editorChanged || !details.afterConfirm.editorContainsGeneratedManifest) {
        failures.push(`confirm did not load references-only manifest handoff: ${JSON.stringify(details.afterConfirm)}`);
    }
    if (/已发布|已上架/.test(details.afterConfirm.result)) {
        failures.push(`confirm incorrectly claimed publish success: ${details.afterConfirm.result}`);
    }
    if (details.localStorageLeaks.length) {
        failures.push(`script assistant wrote localStorage keys: ${JSON.stringify(details.localStorageLeaks)}`);
    }
    if (details.pageTextPreview.includes('Anna: 这行原始正文')) {
        failures.push('uploaded raw source text remained visible in admin page');
    }
    const adminCalls = details.calls.filter((call) => /\/v1\/admin\//.test(call.url));
    if (adminCalls.length !== 3) {
        failures.push(`script assistant did not make the expected create/redeploy/confirm calls: ${adminCalls.length}`);
    }
    for (const call of adminCalls) {
        const headerText = JSON.stringify(call.headers);
        if (/authorization|bearer|token/i.test(headerText)) {
            failures.push(`script assistant request carried frontend credential header: ${headerText}`);
        }
        if (call.credentials !== 'include') {
            failures.push(`script assistant request did not delegate credentials to protected deployment boundary: ${call.credentials}`);
        }
    }

    return {
        name: `admin-script-import-assistant-upload-draft-${viewport.label || 'desktop'}`,
        level: 'real-browser-with-mocked-assistant',
        viewport,
        screenshotPath,
        details,
        failures,
    };
}

async function checkAdminScriptImportAssistantReal(browser, baseUrl, viewport = { width: 1366, height: 768, label: 'desktop' }) {
    const fixtureText = scriptImportFixturePath
        ? await readFile(scriptImportFixturePath, 'utf8')
        : [
            '# UAP7 管理员真实导入验收',
            '角色: Mira, Ren',
            'HP: 12/12',
            'AC: 15',
            'Inventory: rope, torch, old key',
            'UAP7_RAW_SOURCE_LINE_SHOULD_NOT_APPEAR_IN_UI_OR_MANIFEST',
        ].join('\n');
    const fixtureName = args['script-import-fixture-name']
        ? String(args['script-import-fixture-name'])
        : (scriptImportFixturePath ? path.basename(scriptImportFixturePath) : 'uap7-admin-real-import.md');
    const payload = {
        fixtureName,
        fixtureText,
        token: scriptAssistantAdminToken,
        expectedUsesLlm: args['expected-script-assistant-uses-llm'] === 'true',
        expectedTemplate: String(args['expected-presentation-template'] || ''),
    };
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game-admin/`, viewport.width, viewport.height);
    await waitForEvaluate(browser, sessionId, `(() => Boolean(document.querySelector('[data-tab="dashboard"]')))()`, 10000);
    const details = await evaluate(browser, sessionId, `(async (payload) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitFor = async (predicate, timeoutMs, label) => {
            const deadline = Date.now() + timeoutMs;
            let last = null;
            while (Date.now() < deadline) {
                last = await predicate();
                if (last) return last;
                await wait(150);
            }
            return null;
        };
        if (payload.token) {
            document.cookie = 'galgame_script_admin_token=' + encodeURIComponent(payload.token) + '; path=/; SameSite=Lax';
        }
        const originalFetch = window.fetch.bind(window);
        const calls = [];
        window.fetch = async (url, options = {}) => {
            const response = await originalFetch(url, options);
            const urlText = String(url);
            let requestSummary = {
                length: String(options.body || '').length,
                fileCount: 0,
                includesRawMarker: String(options.body || '').includes('UAP7_RAW_SOURCE_LINE_SHOULD_NOT_APPEAR_IN_UI_OR_MANIFEST'),
            };
            try {
                const parsedBody = options.body ? JSON.parse(String(options.body)) : {};
                requestSummary = {
                    ...requestSummary,
                    fileCount: Array.isArray(parsedBody.files) ? parsedBody.files.length : 0,
                    protocolVersion: parsedBody.protocolVersion || '',
                };
            } catch {}
            let responseSummary = {};
            try {
                const text = await response.clone().text();
                const body = text ? JSON.parse(text) : {};
                responseSummary = {
                    keys: Object.keys(body || {}).sort(),
                    ok: body?.ok === true,
                    status: body?.status || '',
                    error: body?.error || '',
                    safeMessage: body?.safeMessage || '',
                    hasDraft: Boolean(body?.draft?.draftId),
                    hasManifest: Boolean(body?.manifest?.id),
                    importMode: body?.importResult?.mode || '',
                    actionKinds: Array.isArray(body?.importResult?.actions)
                        ? body.importResult.actions.map((item) => item.kind || item.action || '').filter(Boolean)
                        : [],
                    leakedRawMarker: text.includes('UAP7_RAW_SOURCE_LINE_SHOULD_NOT_APPEAR_IN_UI_OR_MANIFEST'),
                };
            } catch (error) {
                responseSummary = { parseError: String(error?.message || error) };
            }
            calls.push({
                url: urlText.replace(/\\?.*$/, ''),
                method: options.method || 'GET',
                credentials: options.credentials || '',
                status: response.status,
                ok: response.ok,
                requestSummary,
                responseSummary,
            });
            return response;
        };
        document.querySelector('[data-tab="dashboard"]')?.click();
        document.querySelector('#refreshButton')?.click();
        await waitFor(() => {
            const label = document.querySelector('#scriptAssistantServiceStatus')?.textContent?.trim() || '';
            return ['AI 已就绪', '基础整理'].includes(label) ? label : '';
        }, 10000, 'assistant service ready');

        const input = document.querySelector('#scriptFileInput');
        const transfer = new DataTransfer();
        transfer.items.add(new File([payload.fixtureText], payload.fixtureName, { type: 'text/markdown' }));
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitFor(() => !document.querySelector('#organizeScriptButton')?.disabled, 10000, 'organize enabled');
        const beforeOrganize = {
            service: document.querySelector('#scriptAssistantServiceStatus')?.textContent?.trim() || '',
            fileSummary: document.querySelector('#scriptFileSummary')?.textContent?.trim() || '',
        };

        document.querySelector('#organizeScriptButton')?.click();
        await waitFor(() => {
            const preview = document.querySelector('#scriptDraftPreview')?.innerText?.trim() || '';
            return preview.includes('整理') && preview.includes('草稿名称') ? preview : '';
        }, 30000, 'draft rendered');
        const afterOrganize = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            fileSummary: document.querySelector('#scriptFileSummary')?.textContent?.trim() || '',
            preview: document.querySelector('#scriptDraftPreview')?.innerText?.trim() || '',
            recommendationCard: document.querySelector('[data-presentation-recommendation-card="true"]')?.innerText?.trim() || '',
            selectedFileCount: document.querySelector('#scriptFileInput')?.files?.length ?? -1,
        };

        document.querySelector('[data-recommendation-accept-button="true"]')?.click();
        await wait(150);
        const afterAccept = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            recommendationCard: document.querySelector('[data-presentation-recommendation-card="true"]')?.innerText?.trim() || '',
        };

        const editorBeforeConfirm = document.querySelector('#manifestEditor')?.value || '';
        document.querySelector('#confirmScriptDraftButton')?.click();
        await waitFor(() => {
            const text = document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '';
            return text.includes('已写入原版故事材料') || text.includes('可上架故事入口') ? text : '';
        }, 60000, 'confirm handoff');
        const editorAfterConfirm = document.querySelector('#manifestEditor')?.value || '';
        let manifest = null;
        try {
            manifest = JSON.parse(editorAfterConfirm);
        } catch {}
        const afterConfirm = {
            result: document.querySelector('#scriptAssistantResult')?.textContent?.trim() || '',
            editorChanged: editorAfterConfirm !== editorBeforeConfirm,
            manifestId: manifest?.id || '',
            manifestVersion: manifest?.version || '',
            arcId: manifest?.defaultArcId || manifest?.arcs?.[0]?.arcId || '',
            arcStatus: manifest?.arcs?.[0]?.status || '',
            chatSeedId: manifest?.arcs?.[0]?.sillyTavernBindings?.target?.chatSeedId
                || manifest?.arcs?.[0]?.sillyTavernBindings?.chatSeedId
                || manifest?.sillyTavernBindings?.target?.chatSeedId
                || manifest?.sillyTavernBindings?.chatSeedId
                || '',
            worldBookRefs: manifest?.arcs?.[0]?.sillyTavernBindings?.worldBookRefs
                || manifest?.sillyTavernBindings?.worldBookRefs
                || [],
            manifestTextPreview: editorAfterConfirm.slice(0, 1400),
            containsRawSource: editorAfterConfirm.includes('UAP7_RAW_SOURCE_LINE_SHOULD_NOT_APPEAR_IN_UI_OR_MANIFEST'),
            containsRecommendation: /presentationRecommendation|recommendationId|matchedSignals|evidenceDigest|provider response|raw recommendation/i.test(editorAfterConfirm),
        };

        let afterPublish = {
            skipped: true,
            result: '确认失败，未尝试上架。',
            manifestTextPreview: (document.querySelector('#manifestEditor')?.value || '').slice(0, 1400),
        };
        if (afterConfirm.editorChanged && afterConfirm.result.includes('已写入原版故事材料')) {
            document.querySelector('[data-tab="publish"]')?.click();
            await waitFor(() => !document.querySelector('#publishPanel')?.classList.contains('is-hidden'), 10000, 'publish tab visible');
            if (payload.expectedTemplate) {
                const templateSelect = document.querySelector('#wizardTemplateSelect');
                if (templateSelect && [...templateSelect.options].some((option) => option.value === payload.expectedTemplate)) {
                    templateSelect.value = payload.expectedTemplate;
                    templateSelect.dispatchEvent(new Event('change', { bubbles: true }));
                    await wait(150);
                }
            }
            await waitFor(() => !document.querySelector('#publishButton')?.disabled, 15000, 'publish enabled');
            document.querySelector('#publishButton')?.click();
            await waitFor(() => {
                const text = document.querySelector('#publishResult')?.textContent?.trim() || '';
                return text.includes('已上架') ? text : '';
            }, 60000, 'publish success');
            afterPublish = {
                skipped: false,
                result: document.querySelector('#publishResult')?.textContent?.trim() || '',
                manifestTextPreview: (document.querySelector('#manifestEditor')?.value || '').slice(0, 1400),
            };
        }
        let publishedManifest = null;
        try {
            publishedManifest = JSON.parse(document.querySelector('#manifestEditor')?.value || '');
        } catch {}

        const localStorageLeaks = Object.keys(localStorage)
            .filter((key) => /script|assistant|draft|source|upload|recommendation/i.test(key))
            .map((key) => ({ key, value: String(localStorage.getItem(key) || '').slice(0, 240) }));
        const pageText = document.body.innerText || '';
        return {
            url: location.href,
            beforeOrganize,
            afterOrganize,
            afterAccept,
            afterConfirm,
            afterPublish,
            published: {
                manifestId: publishedManifest?.id || '',
                manifestVersion: publishedManifest?.version || '',
                arcId: publishedManifest?.defaultArcId || publishedManifest?.arcs?.[0]?.arcId || '',
                arcStatus: publishedManifest?.arcs?.[0]?.status || '',
                presentationProfileId: publishedManifest?.arcs?.[0]?.presentationProfileId || '',
                presentationProfileHash: publishedManifest?.arcs?.[0]?.presentationProfileHash || '',
                profileKeys: Object.keys(publishedManifest?.adaptivePresentationProfiles || {}),
            },
            localStorageLeaks,
            calls,
            pageContainsRawSource: pageText.includes('UAP7_RAW_SOURCE_LINE_SHOULD_NOT_APPEAR_IN_UI_OR_MANIFEST'),
            pageContainsTechnicalLeak: /SCRIPT_IMPORT_LLM_|Bearer\\s+|api[_-]?key|token abc|provider\\.example/i.test(pageText),
        };
    })(${JSON.stringify(payload)})`);
    const screenshotPath = await capture(browser, sessionId, `uap7-admin-real-script-import-${viewport.label || 'desktop'}`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (!['AI 已就绪', '基础整理'].includes(details.beforeOrganize.service)) {
        failures.push(`assistant service did not become ready: ${details.beforeOrganize.service}`);
    }
    if (!details.beforeOrganize.fileSummary.includes('1 个文件已选择')) {
        failures.push(`selected file summary missing: ${details.beforeOrganize.fileSummary}`);
    }
    if (!details.afterOrganize.fileSummary.includes('文件正文已从页面临时缓存清除')) {
        failures.push(`file source was not cleared after organize: ${details.afterOrganize.fileSummary}`);
    }
    if (details.afterOrganize.selectedFileCount !== 0) {
        failures.push(`file input still holds selected source files: ${details.afterOrganize.selectedFileCount}`);
    }
    if (payload.expectedUsesLlm && !details.afterOrganize.preview.includes('已用 AI 帮你整理')) {
        failures.push(`expected AI organize state but got: ${details.afterOrganize.preview}`);
    }
    if (!payload.expectedUsesLlm && !details.afterOrganize.preview.includes('已用基础方式整理')) {
        failures.push(`expected deterministic fallback organize state but got: ${details.afterOrganize.preview}`);
    }
    if (!details.afterOrganize.recommendationCard.includes('推荐界面')) {
        failures.push(`presentation recommendation card missing: ${details.afterOrganize.recommendationCard}`);
    }
    if (!details.afterAccept.recommendationCard.includes('已采用，等待确认') || !details.afterAccept.result.includes('不会改变原版故事')) {
        failures.push(`recommendation accept did not stay pending/local: ${JSON.stringify(details.afterAccept)}`);
    }
    if (!details.afterConfirm.result.includes('已写入原版故事材料') || !details.afterConfirm.editorChanged) {
        failures.push(`confirm did not hand off original ST resources into a manifest: ${JSON.stringify(details.afterConfirm)}`);
    }
    if (details.afterConfirm.arcStatus !== 'draft') {
        failures.push(`confirm should leave Arc draft before publish, got: ${details.afterConfirm.arcStatus}`);
    }
    if (!details.afterConfirm.chatSeedId || !details.afterConfirm.worldBookRefs.length) {
        failures.push(`confirm manifest missing original chat/world refs: ${JSON.stringify(details.afterConfirm)}`);
    }
    if (details.afterConfirm.containsRawSource || details.afterConfirm.containsRecommendation) {
        failures.push('confirm manifest leaked upload text or draft recommendation payload');
    }
    if (details.afterPublish.skipped || details.published.arcStatus !== 'published') {
        failures.push(`manual publish did not complete: ${JSON.stringify(details.afterPublish)} / ${JSON.stringify(details.published)}`);
    }
    if (!details.published.presentationProfileId || !details.published.presentationProfileHash) {
        failures.push(`published manifest missing presentation profile binding: ${JSON.stringify(details.published)}`);
    }
    if (details.localStorageLeaks.length) {
        failures.push(`admin UI stored assistant source/recommendation keys: ${JSON.stringify(details.localStorageLeaks)}`);
    }
    if (details.pageContainsRawSource || details.pageContainsTechnicalLeak) {
        failures.push('admin page leaked raw upload text or provider/token/internal error wording');
    }

    return {
        name: `admin-script-import-assistant-real-upload-confirm-publish-${viewport.label || 'desktop'}`,
        level: 'real-browser-real-assistant-and-config-service',
        viewport,
        screenshotPath,
        details: {
            ...details,
            afterConfirm: {
                ...details.afterConfirm,
                manifestTextPreview: undefined,
            },
            afterPublish: {
                ...details.afterPublish,
                manifestTextPreview: undefined,
            },
        },
        failures,
    };
}

async function checkAdapterCall(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/`, 1024, 720);
    const details = await evaluate(browser, sessionId, `(async () => {
        const module = await import('/game/shared/sillytavern-adapter.js');
        const scenarioModule = await import('/game/shared/demo-scenario.js');
        const boundCharacter = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.characters[0];
        const boundWorldBook = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.worldBooks[0];
        const calls = [];
        const fakeFetch = async (url, options = {}) => {
            calls.push({ url: String(url), method: options.method || 'GET' });
            if (String(url).endsWith('/csrf-token')) {
                return new Response(JSON.stringify({ token: 'csrf_test' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/ping')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/characters/all')) {
                return new Response(JSON.stringify([{ name: boundCharacter.id, avatar: boundCharacter.avatar }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/worldinfo/list')) {
                const scenarioModule = await import('/game-admin/shared/demo-scenario.js');
                const worldBooks = new Map();
                for (const worldBook of scenarioModule.DEMO_SCENARIO.sillyTavernBindings.worldBooks || []) {
                    worldBooks.set(worldBook.name, { name: worldBook.name, file_id: worldBook.name });
                }
                for (const arc of scenarioModule.DEMO_SCENARIO.arcs || []) {
                    for (const name of arc.sillyTavernBindings?.worldBookRefs || []) {
                        worldBooks.set(name, { name, file_id: name });
                    }
                }
                return new Response(JSON.stringify([...worldBooks.values()]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/settings/get')) {
                return new Response(JSON.stringify({
                    openai_setting_names: ['Default', scenarioModule.DEMO_SCENARIO.sillyTavernBindings.presetId].filter(Boolean),
                    textgenerationwebui_preset_names: ['Neutral'],
                    koboldai_setting_names: ['Default'],
                    novelai_setting_names: [],
                    instruct: [{ name: scenarioModule.DEMO_SCENARIO.sillyTavernBindings.instructPresetId || 'Alpaca' }],
                    sysprompt: [{ name: scenarioModule.DEMO_SCENARIO.sillyTavernBindings.systemPromptId || 'Neutral - Chat' }],
                    context: [{ name: scenarioModule.DEMO_SCENARIO.sillyTavernBindings.contextPresetId || 'Default' }],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/characters/chats')) {
                const body = JSON.parse(options.body || '{}');
                if (body.avatar_url !== boundCharacter.avatar) {
                    return new Response(JSON.stringify({ error: true }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }
                return new Response(JSON.stringify([{
                    file_id: scenarioModule.DEMO_SCENARIO.sillyTavernBindings.chatSeedId,
                    file_name: scenarioModule.DEMO_SCENARIO.sillyTavernBindings.chatSeedId + '.jsonl',
                    chat_items: 1,
                    last_mes: '2026-07-24T14:00:00.000Z',
                    mes: '泥泞道路通向一片正在发出异响的树丛。',
                }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/chats/get')) {
                return new Response(JSON.stringify([
                    {
                        chat_metadata: {},
                        user_name: 'Player',
                        character_name: boundCharacter.id,
                    },
                    {
                        name: boundCharacter.id,
                        is_user: false,
                        is_system: false,
                        send_date: '2026-07-24T14:00:00.000Z',
                        mes: '泥泞道路通向一片正在发出异响的树丛。',
                        extra: {},
                    },
                ]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ error: 'unexpected' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        };
        const adapter = new module.SillyTavernAdapter({ baseUrl: '', fetchImpl: fakeFetch });
        const health = await adapter.healthCheck();
        const diagnostic = await adapter.diagnoseOriginalResourceAvailability(scenarioModule.DEMO_SCENARIO);
        const chatBridge = new module.SillyTavernOriginalChatBridge({ baseUrl: '', fetchImpl: fakeFetch });
        const chatSnapshot = await chatBridge.loadOpeningChat(scenarioModule.DEMO_SCENARIO);
        return { health, diagnostic, chatSnapshot, calls };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (!details.health?.ok) failures.push(`adapter health check failed: ${JSON.stringify(details.health)}`);
    if (!details.diagnostic?.ok) failures.push(`adapter original resource diagnostic failed: ${JSON.stringify(details.diagnostic)}`);
    if (!details.calls?.some((call) => call.url.endsWith('/csrf-token'))) failures.push('adapter did not request CSRF token');
    if (!details.calls?.some((call) => call.url.endsWith('/api/ping'))) failures.push('adapter did not call SillyTavern ping endpoint');
    if (!details.calls?.some((call) => call.url.endsWith('/api/characters/all'))) failures.push('adapter did not call SillyTavern characters list endpoint');
    if (!details.calls?.some((call) => call.url.endsWith('/api/worldinfo/list'))) failures.push('adapter did not call SillyTavern world info list endpoint');
    if (!details.calls?.some((call) => call.url.endsWith('/api/settings/get'))) failures.push('adapter did not call SillyTavern settings endpoint');
    if (!details.chatSnapshot?.ok) failures.push(`original chat bridge load failed: ${JSON.stringify(details.chatSnapshot)}`);
    if (details.chatSnapshot?.generationBridge !== false) failures.push('original chat bridge incorrectly reports a generation bridge');
    if (!details.calls?.some((call) => call.url.endsWith('/api/characters/chats'))) failures.push('chat bridge did not call original character chats endpoint');
    if (!details.calls?.some((call) => call.url.endsWith('/api/chats/get'))) failures.push('chat bridge did not call original chat get endpoint');
    if (details.calls?.some((call) => call.url.includes('/api/backends/'))) failures.push('adapter or bridge called a backend generation endpoint');

    return {
        name: 'sillytavern-adapter-and-chat-bridge-call-contract',
        level: 'real-browser-with-mocked-fetch',
        details,
        failures,
    };
}

async function checkPlayerChatWrite(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/`, 1366, 768);
    const testMessage = `我轻轻敲了敲窗边。${Date.now().toString(36)}`;
    await installFetchProbe(browser, sessionId);
    await evaluate(browser, sessionId, `(() => {
        window.confirm = () => true;
        document.querySelector('#startButton')?.click();
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#gameScreen')?.hidden === false)()`, 5000);
    const openingState = await waitForPlayerInputReady(browser, sessionId, 45000);
    const activeArcSlot = await waitForExpectedArcSlot(browser, sessionId);
    const submitResult = await evaluate(browser, sessionId, `(async () => {
        const input = document.querySelector('#playerInput');
        const form = document.querySelector('#playerInputForm');
        input.value = ${JSON.stringify(testMessage)};
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        return {
            beforeText: document.querySelector('#dialogueText')?.textContent?.trim() || '',
        };
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => {
        const dialogue = document.querySelector('#dialogueText')?.textContent || '';
        const status = document.querySelector('#stageStatus')?.textContent || '';
        return dialogue.includes(${JSON.stringify(testMessage)}) || status.includes('思考中');
    })()`, 20000);
    await waitForEvaluate(browser, sessionId, `(() => {
        const speaker = document.querySelector('#speakerName')?.textContent?.trim() || '';
        const dialogue = document.querySelector('#dialogueText')?.textContent?.trim() || '';
        const status = document.querySelector('#stageStatus')?.textContent || '';
        const recoveryVisible = document.querySelector('#recoveryActions')?.hidden === false;
        const inputDisabled = document.querySelector('#playerInput')?.disabled ?? true;
        if (inputDisabled && !status.includes('思考中')) {
            document.querySelector('#dialogueBox')?.click();
        }
        return recoveryVisible
            || status.includes('这一段暂时没接上')
            || (speaker && speaker !== '你' && dialogue && !dialogue.includes(${JSON.stringify(testMessage)}) && inputDisabled === false);
    })()`, 180000).catch(() => {});
    const afterSubmit = await evaluate(browser, sessionId, `(() => ({
        speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
        dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
        stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
        inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
        recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
        toast: document.querySelector('#toast')?.textContent?.trim() || '',
        fetches: window.__galgameSmokeFetches || [],
    }))()`);
    const cleanup = await evaluate(browser, sessionId, `(async () => {
        const module = await import('/game/shared/sillytavern-adapter.js');
        const configModule = await import('/game/shared/config-service.js');
        const scenarioModule = await import('/game/shared/demo-scenario.js');
        const bridge = new module.SillyTavernOriginalChatBridge({ baseUrl: '' });
        const strictExpected = Boolean(${JSON.stringify(expectedScenarioId)});
        const releaseStore = strictExpected
            ? configModule.createReleaseStore(null, { fallbackToLocal: false })
            : configModule.createReleaseStore(scenarioModule.DEMO_SCENARIO);
        const bundle = await releaseStore.getActiveBundle();
        const smokeManifest = bundle.manifest || (strictExpected ? null : scenarioModule.DEMO_SCENARIO);
        const release = bundle.release;
        if (!smokeManifest || (strictExpected && (
            smokeManifest.id !== ${JSON.stringify(expectedScenarioId)}
            || smokeManifest.version !== ${JSON.stringify(expectedScenarioVersion)}
            || (release?.activeArcId || release?.arcId || '') !== ${JSON.stringify(expectedArcId)}
        ))) {
            return {
                attempted: true,
                restored: false,
                failedClosed: true,
                reason: 'active-manifest-unavailable-or-mismatched',
                active: {
                    scenarioId: smokeManifest?.id || '',
                    scenarioVersion: smokeManifest?.version || '',
                    arcId: release?.activeArcId || release?.arcId || '',
                },
            };
        }
        const snapshot = await bridge.loadLatestBoundChat(smokeManifest);
        const lastMessage = snapshot.rawChat.at(-1);
        const containsTestMessage = snapshot.rawChat.some((message) => message?.mes === ${JSON.stringify(testMessage)});
        if (lastMessage?.mes === ${JSON.stringify(testMessage)}) {
            await bridge.saveCharacterChat({
                avatar: snapshot.character.avatar,
                characterName: snapshot.character.id,
                fileName: snapshot.fileName,
                chat: snapshot.rawChat.slice(0, -1),
            });
            return { attempted: true, restored: true, deleted: false, containsTestMessage, fileName: snapshot.fileName };
        }
        if (containsTestMessage) {
            await bridge.client.requestJson('/api/chats/delete', {
                method: 'POST',
                body: {
                    avatar_url: snapshot.character.avatar,
                    chatfile: snapshot.fileName,
                },
                allowErrorObject: true,
            });
            return { attempted: true, restored: false, deleted: true, containsTestMessage, fileName: snapshot.fileName, lastMessage: lastMessage?.mes || '' };
        }
        return { attempted: true, restored: false, deleted: false, containsTestMessage, fileName: snapshot.fileName, lastMessage: lastMessage?.mes || '' };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    const originalReplyArrived = afterSubmit.speaker && afterSubmit.speaker !== '你'
        && afterSubmit.dialogue
        && !afterSubmit.dialogue.includes(testMessage)
        && afterSubmit.inputDisabled === false
        && afterSubmit.recoveryHidden;
    const recoveryArrived = !afterSubmit.recoveryHidden || afterSubmit.stageStatus.includes('这一段暂时没接上');
    if (!originalReplyArrived && !recoveryArrived) {
        failures.push(`player chat write did not settle into original reply or recovery: ${JSON.stringify(afterSubmit)}`);
    }
    if (originalReplyArrived && !cleanup.deleted) {
        failures.push(`temporary generated chat was not deleted after original reply: ${JSON.stringify(cleanup)}`);
    }
    if (recoveryArrived && !cleanup.restored && !cleanup.deleted) {
        failures.push(`temporary chat smoke message was not restored or deleted after recovery: ${JSON.stringify(cleanup)}`);
    }
    if (afterSubmit.dialogue.includes('故事暂时还没有接上')) failures.push('runtime failure injected a generic local story fallback into the dialogue');
    if (!cleanup.containsTestMessage) failures.push(`target original chat did not contain submitted smoke message before cleanup: ${JSON.stringify(cleanup)}`);
    failures.push(...collectActiveSlotExpectationFailures(activeArcSlot, 'chat-write'));

    return {
        name: 'player-chat-write-and-readback',
        level: 'real-browser-live-sillytavern-chat-write',
        details: {
            openingState,
            submitResult,
            activeArcSlot,
            afterSubmit,
            cleanup,
        },
        failures,
    };
}

async function checkPlayerSaveRestore(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/?v=save-restore-smoke-${Date.now()}`, 1366, 768);
    await installFetchProbe(browser, sessionId);
    await evaluate(browser, sessionId, `(() => {
        window.confirm = () => true;
        document.querySelector('#startButton')?.click();
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#gameScreen')?.hidden === false)()`, 5000);
    const openingState = await waitForPlayerInputReady(browser, sessionId, 45000);
    const activeArcSlot = await waitForExpectedArcSlot(browser, sessionId);
    const beforeSave = await evaluate(browser, sessionId, `(() => ({
        speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
        dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
        adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
        adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
        adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim() || '',
        gameHidden: document.querySelector('#gameScreen')?.hidden ?? true,
        titleHidden: document.querySelector('#titleScreen')?.hidden ?? false,
    }))()`);

    const saveResult = await evaluate(browser, sessionId, `(async () => {
        document.querySelector('#saveButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        const manualOne = [...document.querySelectorAll('#saveLoadList .save-slot')]
            .find((item) => (item.innerText || '').includes('手动存档 1'));
        manualOne?.querySelector('button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const drawerText = document.querySelector('#saveLoadDrawer')?.innerText || '';
        const toast = document.querySelector('#toast')?.textContent?.trim() || '';
        const saveModule = await import('/game/shared/player-save.js');
        const store = saveModule.createPlayerSaveStore();
        const manualSlot = await store.loadSlot('manual-1').catch(() => null);
        const forbidden = new Set(['hp', 'mp', 'xp', 'gold', 'inventory', 'items', 'affection', 'relationship', 'relationships', 'quest', 'quests', 'clues', 'resources', 'variables', 'node', 'route', 'ending', 'choice', 'choices']);
        const forbiddenSaveKeys = [];
        const walk = (value, path = '') => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                const nextPath = path ? path + '.' + key : key;
                if (forbidden.has(String(key).toLowerCase())) {
                    forbiddenSaveKeys.push(nextPath);
                }
                walk(child, nextPath);
            }
        };
        walk(manualSlot);
        document.querySelector('#saveLoadDrawer [data-close-drawer]')?.click();
        return { drawerText: drawerText.slice(0, 500), toast, manualSlot, forbiddenSaveKeys };
    })()`);

    await evaluate(browser, sessionId, `document.querySelector('#backButton')?.click()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#titleScreen')?.hidden === false)()`, 5000);
    const restoreClickResult = await evaluate(browser, sessionId, `(async () => {
        document.querySelector('#loadButtonTitle')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        const manualOne = [...document.querySelectorAll('#saveLoadList .save-slot')]
            .find((item) => (item.innerText || '').includes('手动存档 1'));
        const slotText = manualOne?.innerText || '';
        manualOne?.querySelector('button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return { slotText };
    })()`);
    const restoredReadyState = await waitForPlayerInputReady(browser, sessionId, 45000);
    const restoreResult = await evaluate(browser, sessionId, `(() => {
        const slotText = ${JSON.stringify(restoreClickResult.slotText || '')};
        return {
            slotText,
            speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
            dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
            adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
            adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
            adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim() || '',
            gameHidden: document.querySelector('#gameScreen')?.hidden ?? true,
            titleHidden: document.querySelector('#titleScreen')?.hidden ?? false,
            recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
            stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
        };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (!beforeSave.speaker || !beforeSave.dialogue) failures.push('save-restore smoke did not load an original chat line before saving');
    if (!saveResult.toast.includes('已保存')) failures.push(`manual save did not show success toast: ${saveResult.toast}`);
    if (saveResult.forbiddenSaveKeys?.length) failures.push(`manual save stored adaptive/story authority fields: ${saveResult.forbiddenSaveKeys.join(', ')}`);
    if (!restoreResult.slotText.includes('手动存档 1') || restoreResult.slotText.includes('空位')) {
        failures.push(`manual save slot was not available for load: ${restoreResult.slotText}`);
    }
    if (restoreResult.gameHidden || !restoreResult.titleHidden) failures.push('loading a save did not return to the custom stage');
    if (restoreResult.speaker !== beforeSave.speaker) failures.push(`save restore speaker mismatch: ${restoreResult.speaker} !== ${beforeSave.speaker}`);
    if (restoreResult.dialogue !== beforeSave.dialogue) failures.push('save restore did not reload the original chat text through the stage');
    if (beforeSave.adaptivePanelCount > 0 && restoreResult.adaptivePanelCount < 1) {
        failures.push('save restore did not recompute adaptive panels from restored original chat text');
    }
    if (beforeSave.adaptivePanelText && restoreResult.adaptivePanelText !== beforeSave.adaptivePanelText) {
        failures.push('save restore adaptive panel text changed instead of being recomputed from the same restored message');
    }
    if (!restoreResult.recoveryHidden) failures.push('save restore incorrectly showed recovery actions');
    if (restoreResult.dialogue.includes('故事暂时还没有接上')) failures.push('save restore used local unavailable fallback instead of original chat readback');
    failures.push(...collectActiveSlotExpectationFailures(activeArcSlot, 'save-restore'));
    const manualSlotFailures = collectActiveSlotExpectationFailures(saveResult.manualSlot || null, 'manual save');
    if (manualSlotFailures.length) {
        failures.push(...manualSlotFailures);
    }

    return {
        name: 'player-save-restore-original-chat-readback',
        level: 'real-browser-ui-save-restore',
        details: {
            openingState,
            beforeSave,
            activeArcSlot,
            saveResult,
            restoreClickResult,
            restoredReadyState,
            restoreResult,
        },
        failures,
    };
}

async function checkPlayerRuntimeReply(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game/?v=runtime-reply-smoke-${Date.now()}`, 1366, 768);
    const testStamp = Date.now().toString(36);
    await installFetchProbe(browser, sessionId);
    await evaluate(browser, sessionId, `(() => {
        window.confirm = () => true;
        document.querySelector('#startButton')?.click();
    })()`);
    await waitForEvaluate(browser, sessionId, `(() => document.querySelector('#gameScreen')?.hidden === false)()`, 5000);
    const openingState = await waitForPlayerInputReady(browser, sessionId, 45000);
    const activeArcSlot = await waitForExpectedArcSlot(browser, sessionId);
    const turns = [];
    for (let turnIndex = 1; turnIndex <= 2; turnIndex += 1) {
        const submitResult = await evaluate(browser, sessionId, `(async () => {
            const input = document.querySelector('#playerInput');
            const form = document.querySelector('#playerInputForm');
            const firstSuggestedAction = document.querySelector('#suggestedActions button')?.textContent?.trim() || '';
            const message = firstSuggestedAction
                ? \`第${turnIndex}轮我选择：\${firstSuggestedAction}。测试编号${testStamp}\`
                : \`第${turnIndex}轮我谨慎观察四周，准备听从 Dungeon Master 的判定。测试编号${testStamp}\`;
            input.value = message;
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            return {
                beforeText: document.querySelector('#dialogueText')?.textContent?.trim() || '',
                firstSuggestedAction,
                testMessage: message,
            };
        })()`);
        const testMessage = submitResult.testMessage;
        await waitForEvaluate(browser, sessionId, `(() => {
            const dialogue = document.querySelector('#dialogueText')?.textContent || '';
            const status = document.querySelector('#stageStatus')?.textContent || '';
            return dialogue.includes(${JSON.stringify(testMessage)}) || status.includes('思考中');
        })()`, 20000);
        const duringGeneration = await evaluate(browser, sessionId, `(() => ({
            speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
            dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
            stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
            inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
            recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
        }))()`);
        await waitForEvaluate(browser, sessionId, `(() => {
            const speaker = document.querySelector('#speakerName')?.textContent?.trim() || '';
            const dialogue = document.querySelector('#dialogueText')?.textContent?.trim() || '';
            const status = document.querySelector('#stageStatus')?.textContent?.trim() || '';
            const inputDisabled = document.querySelector('#playerInput')?.disabled ?? true;
            if (inputDisabled && !status.includes('思考中')) {
                document.querySelector('#dialogueBox')?.click();
            }
            return speaker && speaker !== '你'
                && dialogue
                && !dialogue.includes(${JSON.stringify(testMessage)})
                && !dialogue.includes('这一段暂时没接上')
                && !status.includes('思考中')
                && inputDisabled === false;
        })()`, 220000).catch(async (error) => {
            const timeoutState = await evaluate(browser, sessionId, `(() => ({
                error: ${JSON.stringify(error.message || String(error))},
                speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
                dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
                stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
                inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
                recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
                suggestedActions: Array.from(document.querySelectorAll('#suggestedActions button'))
                    .map((button) => button.textContent?.trim() || '')
                    .filter(Boolean),
                fetches: window.__galgameSmokeFetches || [],
            }))()`);
            turns.push({
                submitResult,
                duringGeneration,
                timeoutState,
                afterReply: null,
            });
            return false;
        });
        if (turns.at(-1)?.timeoutState) {
            break;
        }
        const afterReply = await evaluate(browser, sessionId, `(() => ({
            speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
            dialogue: document.querySelector('#dialogueText')?.textContent?.trim() || '',
            stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
            inputDisabled: document.querySelector('#playerInput')?.disabled ?? true,
            recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
            adaptivePanelHidden: document.querySelector('#adaptivePanels')?.hidden ?? true,
            adaptivePanelCount: document.querySelectorAll('#adaptivePanels .adaptive-panel').length,
            adaptivePanelText: document.querySelector('#adaptivePanels')?.innerText?.trim().slice(0, 500) || '',
            suggestedActions: Array.from(document.querySelectorAll('#suggestedActions button'))
                .map((button) => button.textContent?.trim() || '')
                .filter(Boolean),
            toast: document.querySelector('#toast')?.textContent?.trim() || '',
        }))()`);
        const readyAfterReply = await waitForPlayerInputReady(browser, sessionId, 15000);
        turns.push({ submitResult, duringGeneration, afterReply, readyAfterReply });
    }
    const testMessages = turns.map((turn) => turn.submitResult.testMessage);
    const finalFetches = await evaluate(browser, sessionId, `window.__galgameSmokeFetches || []`);
    const cleanup = await evaluate(browser, sessionId, `(async () => {
        const module = await import('/game/shared/sillytavern-adapter.js');
        const configModule = await import('/game/shared/config-service.js');
        const bridge = new module.SillyTavernOriginalChatBridge({ baseUrl: '' });
        const releaseStore = configModule.createReleaseStore(null, { fallbackToLocal: false });
        const bundle = await releaseStore.getActiveBundle();
        const activeManifest = bundle.manifest;
        const release = bundle.release;
        if (!activeManifest || activeManifest.id !== ${JSON.stringify(expectedScenarioId)} || activeManifest.version !== ${JSON.stringify(expectedScenarioVersion)} || (release?.activeArcId || release?.arcId || '') !== ${JSON.stringify(expectedArcId)}) {
            return {
                attempted: true,
                deleted: false,
                failedClosed: true,
                reason: 'active-manifest-unavailable-or-mismatched',
                active: {
                    scenarioId: activeManifest?.id || '',
                    scenarioVersion: activeManifest?.version || '',
                    arcId: release?.activeArcId || release?.arcId || '',
                },
            };
        }
        const snapshot = await bridge.loadLatestBoundChat(activeManifest);
        const testMessages = ${JSON.stringify(testMessages)};
        const containsTestMessage = snapshot.rawChat.some((message) => testMessages.includes(message?.mes));
        if (containsTestMessage) {
            await bridge.client.requestJson('/api/chats/delete', {
                method: 'POST',
                body: {
                    avatar_url: snapshot.character.avatar,
                    chatfile: snapshot.fileName,
                },
                allowErrorObject: true,
            });
            return { attempted: true, deleted: true, fileName: snapshot.fileName };
        }
        return { attempted: true, deleted: false, fileName: snapshot.fileName, lastMessage: snapshot.rawChat.at(-1)?.mes || '' };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (turns.length !== 2) failures.push(`expected two runtime turns, got ${turns.length}`);
    for (const [index, turn] of turns.entries()) {
        const turnNumber = index + 1;
        const { submitResult, duringGeneration, afterReply } = turn;
        if (!duringGeneration.inputDisabled) failures.push(`turn ${turnNumber}: player input was not paused while original runtime reply was pending`);
        if (turn.timeoutState) {
            failures.push(`turn ${turnNumber}: original runtime reply did not arrive: ${JSON.stringify(turn.timeoutState)}`);
            continue;
        }
        if (afterReply.speaker === '你') failures.push(`turn ${turnNumber}: player stage still shows the submitted player message after runtime reply`);
        if (!afterReply.dialogue || afterReply.dialogue.includes(submitResult.testMessage)) failures.push(`turn ${turnNumber}: player stage did not display a new original character reply`);
        if (afterReply.dialogue.includes('这一段暂时没接上')) failures.push(`turn ${turnNumber}: player stage fell back to retry state instead of displaying the original reply`);
        if (afterReply.inputDisabled) failures.push(`turn ${turnNumber}: player input did not re-enable after original reply`);
        if (!afterReply.recoveryHidden) failures.push(`turn ${turnNumber}: recovery actions remained visible after original reply`);
        if (afterReply.dialogue.includes('可选行动')) failures.push(`turn ${turnNumber}: original action list heading leaked into dialogue text instead of button layer`);
        const structuredPanelFailures = getStructuredAdaptivePanelFailures(afterReply);
        for (const failure of structuredPanelFailures) {
            failures.push(`turn ${turnNumber}: ${failure}`);
        }
    }
    if (!cleanup.deleted) failures.push(`temporary runtime smoke chat was not deleted: ${JSON.stringify(cleanup)}`);
    failures.push(...collectActiveSlotExpectationFailures(activeArcSlot, 'runtime-reply'));

    return {
        name: 'player-approved-original-runtime-reply',
        level: 'real-browser-live-original-generate',
        details: {
            openingState,
            activeArcSlot,
            turns,
            fetches: finalFetches,
            cleanup,
        },
        failures,
    };
}

function getStructuredAdaptivePanelFailures(stage) {
    const dialogue = stage?.dialogue || '';
    const panelText = stage?.adaptivePanelText || '';
    const failures = [];
    const expectsStatus = /(?:HP|生命|AC|等级|Level|XP|经验|金币|Gold|状态|Status)\s*[:：]/iu.test(dialogue);
    const expectsInventory = /(?:背包|Inventory|物品|道具|装备|Equipment|Weapons?|武器)\s*[:：]/iu.test(dialogue);
    const expectsAbility = /(?:技能|Abilities|能力|专长|Features?)\s*[:：]/iu.test(dialogue);
    if ((expectsStatus || expectsInventory || expectsAbility) && stage.adaptivePanelCount < 1) {
        failures.push('structured original reply did not show any adaptive display panel');
        return failures;
    }
    if (expectsStatus && !/(?:STATUS|角色状态|HP|生命|AC|等级|经验|金币|状态)/iu.test(panelText)) {
        failures.push('status fields from original reply were not reflected in the adaptive display panel');
    }
    if (expectsInventory && !/(?:PACK|背包|装备|武器|物品|道具|Inventory|Equipment|Weapon)/iu.test(panelText)) {
        failures.push('inventory/equipment fields from original reply were not reflected in the adaptive display panel');
    }
    if (expectsAbility && !/(?:ABILITY|技能|能力|专长|Abilities|Features)/iu.test(panelText)) {
        failures.push('ability fields from original reply were not reflected in the adaptive display panel');
    }
    return failures;
}

async function checkAdminValidationPath(browser, baseUrl) {
    const { targetId, sessionId } = await openPage(browser, `${baseUrl}/game-admin/`, 1366, 768);
    const details = await evaluate(browser, sessionId, `(async () => {
        let boundCharacter = { id: '', avatar: '' };
        let boundWorldBook = { name: '' };
        let expectedPresetId = '';
        let expectedInstructPresetId = '';
        let expectedSystemPromptId = '';
        let expectedContextPresetId = '';
        let expectedChatSeedId = '';
        let expectedArcId = '';
        const fakeFetch = async (url, options = {}) => {
            if (String(url).endsWith('/csrf-token')) {
                return new Response(JSON.stringify({ token: 'csrf_test' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/ping')) {
                return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/characters/all')) {
                return new Response(JSON.stringify([{ name: boundCharacter.id, avatar: boundCharacter.avatar }]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/worldinfo/list')) {
                const scenarioModule = await import('/game-admin/shared/demo-scenario.js');
                const worldBooks = new Map();
                for (const worldBook of scenarioModule.DEMO_SCENARIO.sillyTavernBindings.worldBooks || []) {
                    worldBooks.set(worldBook.name, { name: worldBook.name, file_id: worldBook.name });
                }
                for (const arc of scenarioModule.DEMO_SCENARIO.arcs || []) {
                    for (const name of arc.sillyTavernBindings?.worldBookRefs || []) {
                        worldBooks.set(name, { name, file_id: name });
                    }
                }
                return new Response(JSON.stringify([...worldBooks.values()]), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/settings/get')) {
                return new Response(JSON.stringify({
                    openai_setting_names: ['Default', expectedPresetId].filter(Boolean),
                    textgenerationwebui_preset_names: ['Neutral'],
                    koboldai_setting_names: ['Default'],
                    novelai_setting_names: [],
                    instruct: [{ name: expectedInstructPresetId }],
                    sysprompt: [{ name: expectedSystemPromptId }],
                    context: [{ name: expectedContextPresetId }],
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (String(url).endsWith('/api/characters/chats')) {
                const body = JSON.parse(options.body || '{}');
                if (body.avatar_url !== boundCharacter.avatar) {
                    return new Response(JSON.stringify({ error: true }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                    });
                }
                const scenarioModule = await import('/game-admin/shared/demo-scenario.js');
                const chatSeeds = [
                    scenarioModule.DEMO_SCENARIO.sillyTavernBindings.chatSeedId,
                    ...(scenarioModule.DEMO_SCENARIO.arcs || [])
                        .map((arc) => arc.sillyTavernBindings?.target?.chatSeedId)
                        .filter(Boolean),
                ];
                return new Response(JSON.stringify([...new Set(chatSeeds)].map((chatSeedId, index) => ({
                    file_id: chatSeedId,
                    file_name: chatSeedId + '.jsonl',
                    chat_items: 1,
                    last_mes: '2026-07-24T14:0' + index + ':00.000Z',
                    mes: '原版开场聊天已存在。',
                }))), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({ error: 'unexpected' }), {
                status: 404,
                headers: { 'content-type': 'application/json' },
            });
        };
        window.fetch = fakeFetch;
        const scenarioModule = await import('/game-admin/shared/demo-scenario.js');
        const configModule = await import('/game-admin/shared/config-service.js');
        const releaseStore = configModule.createReleaseStore(scenarioModule.DEMO_SCENARIO);
        boundCharacter = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.characters[0];
        boundWorldBook = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.worldBooks[0];
        expectedPresetId = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.presetId;
        expectedInstructPresetId = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.instructPresetId;
        expectedSystemPromptId = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.systemPromptId;
        expectedContextPresetId = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.contextPresetId;
        expectedChatSeedId = scenarioModule.DEMO_SCENARIO.sillyTavernBindings.chatSeedId;
        expectedArcId = scenarioModule.DEMO_SCENARIO.defaultArcId;
        document.querySelector('#manifestEditor').value = JSON.stringify(scenarioModule.DEMO_SCENARIO, null, 2);
        document.querySelector('#validateButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        const passText = document.querySelector('#validationResult')?.textContent?.trim() || '';
        const passLiveText = document.querySelector('#resourceLiveResult')?.textContent?.trim() || '';
        const activeBeforeFailedPublish = await releaseStore.getActiveRelease();
        const missingManifest = {
            ...scenarioModule.DEMO_SCENARIO,
            arcs: scenarioModule.DEMO_SCENARIO.arcs.map((arc) => arc.arcId === scenarioModule.DEMO_SCENARIO.defaultArcId
                ? {
                    ...arc,
                    sillyTavernBindings: {
                        ...arc.sillyTavernBindings,
                        target: {
                            ...arc.sillyTavernBindings.target,
                            characterRef: { name: 'Missing', avatar: 'missing.png' },
                        },
                        worldBookRefs: ['MissingWorld'],
                        generationPresetRef: 'MissingPreset',
                        instructPresetRef: 'MissingInstruct',
                        systemPromptRef: 'MissingSystem',
                        contextPresetRef: 'MissingContext',
                    },
                }
                : arc),
        };
        document.querySelector('#manifestEditor').value = JSON.stringify(missingManifest, null, 2);
        document.querySelector('#validateButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        const rejectText = document.querySelector('#validationResult')?.textContent?.trim() || '';
        const rejectLiveText = document.querySelector('#resourceLiveResult')?.textContent?.trim() || '';
        document.querySelector('#publishButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        const publishPageTitle = document.querySelector('#pageTitle')?.textContent?.trim() || '';
        const publishToast = document.querySelector('#toast')?.textContent?.trim() || '';
        const publishResult = document.querySelector('#publishResult')?.textContent?.trim() || '';
        const activeAfterFailedPublish = await releaseStore.getActiveRelease();
        document.querySelector('#manifestEditor').value = JSON.stringify(scenarioModule.DEMO_SCENARIO, null, 2);
        document.querySelector('#validateButton')?.click();
        await new Promise((resolve) => setTimeout(resolve, 700));
        document.querySelector('[data-tab="library"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 300));
        const arcPanelText = document.querySelector('#libraryPanel')?.innerText || '';
        const libraryHasStorySummary = Boolean(document.querySelector('#storyLibrarySummary .library-summary-card'));
        const libraryHasSaveBindingNote = document.querySelector('.save-binding-note')?.textContent?.trim() || '';
        return {
            passText,
            passLiveText,
            rejectText,
            rejectLiveText,
            publishPageTitle,
            publishToast,
            publishResult,
            activeBeforeFailedPublish: activeBeforeFailedPublish?.releaseId || '',
            activeAfterFailedPublish: activeAfterFailedPublish?.releaseId || '',
            arcPanelText,
            libraryHasStorySummary,
            libraryHasSaveBindingNote,
            expectedChatSeedId,
            expectedArcId,
        };
    })()`);
    await browser.send('Target.closeTarget', { targetId }).catch(() => {});

    const failures = [];
    if (
        !details.passText.includes('故事材料存在性检查通过')
        && !details.passText.includes('原版资源引用可用于发布检查')
    ) {
        failures.push(`admin validate did not pass selected publishable Arc bindings: ${details.passText}`);
    }
    if (!details.passLiveText.includes('更多检查通过')) failures.push(`admin live result did not show pass: ${details.passLiveText}`);
    if (!details.rejectText.includes('缺少引用')) failures.push(`admin validate did not reject missing bindings: ${details.rejectText}`);
    if (!details.rejectLiveText.includes('missing.png') || !details.rejectLiveText.includes('MissingWorld')) {
        failures.push(`admin live result did not show missing references: ${details.rejectLiveText}`);
    }
    if (details.publishPageTitle !== '上架故事') failures.push(`admin publish failure did not stay in beginner publish wizard: ${details.publishPageTitle}`);
    if (!details.publishToast.includes('发布前需要补齐故事材料')) failures.push(`admin publish did not show missing material toast: ${details.publishToast}`);
    if (!details.publishResult.includes('发布前需要补齐故事材料') && !details.publishResult.includes('缺少')) {
        failures.push(`admin publish wizard did not show missing material result: ${details.publishResult}`);
    }
    if (details.activeBeforeFailedPublish !== details.activeAfterFailedPublish) {
        failures.push(`failed admin publish replaced active release: ${details.activeBeforeFailedPublish} -> ${details.activeAfterFailedPublish}`);
    }
    if (!details.libraryHasStorySummary) {
        failures.push('admin library did not render beginner story summary cards');
    }
    if (!details.libraryHasSaveBindingNote.includes('已有存档不会被改动')) {
        failures.push(`admin library did not show old-save binding explanation: ${details.libraryHasSaveBindingNote}`);
    }
    if (details.arcPanelText.includes(details.expectedArcId) || details.arcPanelText.includes(details.expectedChatSeedId)) {
        failures.push(`admin library leaked raw Arc/chat seed identifiers: ${details.arcPanelText}`);
    }
    if (!details.arcPanelText.includes('开场记录 已准备')) {
        failures.push(`admin library did not show friendly opening record status: ${details.arcPanelText}`);
    }
    if (
        !details.arcPanelText.includes('可做实时诊断')
        || !details.arcPanelText.includes('高级运行项需验收')
        || !details.arcPanelText.includes('运行中验证只对已有证据的项目显示通过')
    ) {
        failures.push(`admin Arc page did not preserve ready/no-claim status: ${details.arcPanelText}`);
    }
    if (details.arcPanelText.includes('开场 缺失') || details.arcPanelText.includes('待补齐')) {
        failures.push(`admin Arc page still reports missing seeds after import: ${details.arcPanelText}`);
    }

    return {
        name: 'admin-validation-complete-and-missing-bindings',
        level: 'real-browser-with-mocked-fetch',
        details,
        failures,
    };
}

async function openPage(browser, url, width, height) {
    const target = await browser.send('Target.createTarget', { url: 'about:blank' });
    const attached = await browser.send('Target.attachToTarget', {
        targetId: target.targetId,
        flatten: true,
    });
    const sessionId = attached.sessionId;
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Runtime.enable', {}, sessionId);
    await installSmokeRuntimeOverrides(browser, sessionId);
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: width < 700,
    }, sessionId);
    await browser.send('Page.navigate', { url }, sessionId);
    await delay(1000);
    return { targetId: target.targetId, sessionId };
}

async function installSmokeRuntimeOverrides(browser, sessionId) {
    const configServiceUrl = smokeMetaOverrides.configServiceUrl;
    const originalRuntimeBridgeUrl = smokeMetaOverrides.originalRuntimeBridgeUrl;
    const sillyTavernBaseUrl = smokeMetaOverrides.sillyTavernBaseUrl;
    const proxySillyTavernApi = smokeMetaOverrides.proxySillyTavernApi;
    if (configServiceUrl === null && originalRuntimeBridgeUrl === null && !sillyTavernBaseUrl) {
        return;
    }
    await browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => {
            const overrides = ${JSON.stringify({
                configServiceUrl,
                originalRuntimeBridgeUrl,
                sillyTavernBaseUrl,
                proxySillyTavernApi,
            })};
            if (overrides.configServiceUrl !== null) {
                window.GALGAME_CONFIG_SERVICE_URL = overrides.configServiceUrl || '';
                window.GALGAME_CONFIG_SERVICE = {
                    ...(window.GALGAME_CONFIG_SERVICE || {}),
                    endpoint: overrides.configServiceUrl || '',
                };
            }
            const applyMetaOverride = (name, value) => {
                if (value === null || value === undefined) return;
                const head = document.head || document.querySelector('head');
                if (!head) return;
                let meta = document.querySelector('meta[name="' + name + '"]');
                if (!meta) {
                    meta = document.createElement('meta');
                    meta.setAttribute('name', name);
                    head.appendChild(meta);
                }
                meta.setAttribute('content', value || '');
            };
            const applyAll = () => {
                applyMetaOverride('galgame-config-service', overrides.configServiceUrl);
                applyMetaOverride('galgame-original-runtime-bridge', overrides.originalRuntimeBridgeUrl);
                if (overrides.sillyTavernBaseUrl && !overrides.proxySillyTavernApi) {
                    applyMetaOverride('galgame-sillytavern-base', overrides.sillyTavernBaseUrl);
                }
                if (overrides.sillyTavernBaseUrl) {
                    applyMetaOverride('galgame-sillytavern-runtime-base', overrides.sillyTavernBaseUrl);
                }
            };
            applyAll();
            document.addEventListener('readystatechange', applyAll);
            document.addEventListener('DOMContentLoaded', applyAll, { once: true });
            const observer = new MutationObserver(applyAll);
            const startObserver = () => {
                if (document.documentElement) {
                    observer.observe(document.documentElement, { childList: true, subtree: true });
                }
            };
            startObserver();
            window.__galgameSmokeRuntimeOverrides = overrides;
        })();`,
    }, sessionId);
}

async function capture(browser, sessionId, name) {
    const screenshot = await browser.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
    }, sessionId);
    const screenshotPath = path.join(screenshotRoot, `${name}.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    return screenshotPath;
}

async function evaluate(browser, sessionId, expression) {
    const result = await browser.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
    }, sessionId);
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result?.value;
}

async function connectBrowser(port) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
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

    socket.on('message', (payload) => {
        const message = JSON.parse(payload.toString());
        if (!message.id || !pending.has(message.id)) {
            return;
        }
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) {
            reject(new Error(message.error.message));
        } else {
            resolve(message.result || {});
        }
    });

    return {
        async send(method, params = {}, sessionId = undefined) {
            await onceOpen(socket);
            return new Promise((resolve, reject) => {
                const id = ++sequence;
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params, sessionId }));
            });
        },
    };
}

function onceOpen(socket) {
    if (socket.readyState === WebSocket.OPEN) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });
}

function startStaticServer(root, preferredPort, metaOverrides = {}) {
    const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
    };

    const server = createServer(async (request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        if (metaOverrides.proxySillyTavernApi) {
            if (shouldProxySillyTavernApi(url.pathname)) {
                await proxySillyTavernApiRequest(request, response, url, metaOverrides.sillyTavernBaseUrl);
                return;
            }
            if (url.pathname === '/csrf-token' || url.pathname.startsWith('/api/')) {
                recordSmokeProxyRejection({
                    path: url.pathname,
                    method: request.method || 'GET',
                    reason: 'endpoint-not-allowed',
                });
                response.writeHead(403, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                response.end(JSON.stringify({ error: 'SMOKE_ST_PROXY_ENDPOINT_NOT_ALLOWED' }));
                return;
            }
        }
        const safePath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
        const candidate = path.normalize(path.join(root, safePath || 'index.html'));
        const target = candidate.startsWith(root) ? candidate : path.join(root, 'index.html');
        const filePath = (await isDirectory(target)) ? path.join(target, 'index.html') : target;
        try {
            await stat(filePath);
            const extension = path.extname(filePath);
            response.setHeader('Content-Type', mimeTypes[extension] || 'application/octet-stream');
            if (extension === '.html') {
                const html = await readFile(filePath, 'utf8');
                response.end(applySmokeMetaOverrides(html, metaOverrides));
                return;
            }
            createReadStream(filePath).pipe(response);
        } catch {
            response.statusCode = 404;
            response.end('Not found');
        }
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(preferredPort, '127.0.0.1', () => resolve(server));
    });
}

function applySmokeMetaOverrides(html, overrides) {
    let next = html;
    if (overrides.sillyTavernBaseUrl && !overrides.proxySillyTavernApi) {
        next = replaceMetaContent(next, 'galgame-sillytavern-base', overrides.sillyTavernBaseUrl);
    }
    if (overrides.sillyTavernBaseUrl) {
        next = replaceMetaContent(next, 'galgame-sillytavern-runtime-base', overrides.sillyTavernBaseUrl);
    }
    if (overrides.configServiceUrl !== null) {
        next = replaceMetaContent(next, 'galgame-config-service', overrides.configServiceUrl || '');
    }
    if (overrides.originalRuntimeBridgeUrl !== null) {
        next = replaceMetaContent(next, 'galgame-original-runtime-bridge', overrides.originalRuntimeBridgeUrl || '');
    }
    if (overrides.scriptImportAssistantUrl !== null) {
        next = replaceMetaContent(next, 'galgame-script-import-assistant', overrides.scriptImportAssistantUrl || '');
    }
    return next;
}

function shouldProxySillyTavernApi(pathName) {
    return SMOKE_ST_PROXY_ALLOWED_ENDPOINTS.has(pathName);
}

async function proxySillyTavernApiRequest(request, response, url, targetBaseUrl) {
    if (!targetBaseUrl) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: 'SMOKE_ST_PROXY_TARGET_MISSING' }));
        return;
    }
    const targetUrl = `${targetBaseUrl}${url.pathname}${url.search}`;
    try {
        const body = ['GET', 'HEAD'].includes(String(request.method || 'GET').toUpperCase())
            ? undefined
            : await readRequestBuffer(request);
        if (url.pathname === '/api/chats/delete') {
            const validation = validateSmokeProxyDeleteBody(body);
            if (!validation.ok) {
                recordSmokeProxyRejection({
                    path: url.pathname,
                    method: request.method || 'GET',
                    reason: validation.reason,
                });
                response.writeHead(403, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Cache-Control': 'no-store',
                });
                response.end(JSON.stringify({
                    error: 'SMOKE_ST_PROXY_DELETE_NOT_ALLOWED',
                    reason: validation.reason,
                }));
                return;
            }
        }
        const upstream = await fetch(targetUrl, {
            method: request.method,
            headers: buildProxyHeaders(request),
            body,
            redirect: 'manual',
        });
        response.statusCode = upstream.status;
        copyProxyResponseHeaders(upstream, response);
        const buffer = Buffer.from(await upstream.arrayBuffer());
        response.end(buffer);
    } catch (error) {
        response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({
            error: 'SMOKE_ST_PROXY_FAILED',
            message: error?.message || String(error),
        }));
    }
}

function recordSmokeProxyRejection(entry) {
    const current = globalThis.__galgameSmokeProxyRejections || [];
    current.push({
        path: String(entry.path || ''),
        method: String(entry.method || ''),
        reason: String(entry.reason || ''),
        at: new Date().toISOString(),
    });
    globalThis.__galgameSmokeProxyRejections = current.slice(-20);
}

function buildProxyHeaders(request) {
    const headers = {};
    for (const name of ['accept', 'content-type', 'cookie', 'x-csrf-token']) {
        const value = request.headers[name];
        if (value) {
            headers[name] = value;
        }
    }
    return headers;
}

function copyProxyResponseHeaders(upstream, response) {
    for (const name of ['content-type', 'cache-control']) {
        const value = upstream.headers.get(name);
        if (value) {
            response.setHeader(name, value);
        }
    }
    const setCookies = typeof upstream.headers.getSetCookie === 'function'
        ? upstream.headers.getSetCookie()
        : [];
    if (setCookies.length) {
        response.setHeader('set-cookie', setCookies);
        return;
    }
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) {
        response.setHeader('set-cookie', setCookie);
    }
}

function readRequestBuffer(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        request.on('data', (chunk) => chunks.push(chunk));
        request.on('end', () => resolve(Buffer.concat(chunks)));
        request.on('error', reject);
    });
}

async function verifySmokeProxyDenylist(baseUrl) {
    const denied = [];
    for (const pathName of ['/api/backends/openai/generate', '/api/novelai/generate']) {
        const response = await fetch(`${baseUrl}${pathName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: 'must-not-forward' }),
            cache: 'no-store',
        }).catch((error) => ({
            ok: false,
            status: 0,
            async json() {
                return { error: error?.message || String(error) };
            },
        }));
        const body = await response.json().catch(() => ({}));
        denied.push({
            path: pathName,
            status: response.status,
            error: body?.error || '',
        });
    }
    const deleteSeed = await fetch(`${baseUrl}/api/chats/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            avatar_url: 'smoke.png',
            chatfile: expectedChatSeedId || 'seed-must-not-delete',
        }),
        cache: 'no-store',
    }).catch((error) => ({
        ok: false,
        status: 0,
        async json() {
            return { error: error?.message || String(error) };
        },
    }));
    const deleteSeedBody = await deleteSeed.json().catch(() => ({}));
    return {
        ok: denied.every((item) => item.status >= 400 && item.error === 'SMOKE_ST_PROXY_ENDPOINT_NOT_ALLOWED')
            && deleteSeed.status >= 400
            && deleteSeedBody?.error === 'SMOKE_ST_PROXY_DELETE_NOT_ALLOWED',
        denied,
        deleteSeedDenied: {
            status: deleteSeed.status,
            error: deleteSeedBody?.error || '',
            reason: deleteSeedBody?.reason || '',
        },
        proxyRejections: globalThis.__galgameSmokeProxyRejections || [],
        testCleanupDeletePolicy: 'only generated chat files containing expected scenario and Arc may be forwarded; seed chat deletion is rejected',
    };
}

function validateSmokeProxyDeleteBody(body) {
    let parsed = {};
    try {
        parsed = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '{}'));
    } catch {
        return { ok: false, reason: 'invalid-json' };
    }
    const chatfile = String(parsed.chatfile || parsed.fileName || '');
    if (!expectedScenarioId || !expectedArcId) {
        return { ok: false, reason: 'missing-expected-binding' };
    }
    if (!chatfile || chatfile === expectedChatSeedId) {
        return { ok: false, reason: 'seed-or-empty-chatfile' };
    }
    if (!chatfile.includes(expectedScenarioId) || !chatfile.includes(`-${expectedArcId}-`)) {
        return { ok: false, reason: 'chatfile-outside-current-smoke-release' };
    }
    return { ok: true };
}

function replaceMetaContent(html, name, value) {
    const pattern = new RegExp(`<meta\\s+name=["']${escapeRegExp(name)}["']\\s+content=["'][^"']*["']\\s*>`, 'i');
    const replacement = `<meta name="${name}" content="${escapeHtmlAttribute(value)}">`;
    return pattern.test(html)
        ? html.replace(pattern, replacement)
        : html.replace('</head>', `    ${replacement}\n</head>`);
}

function escapeHtmlAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function startOriginalRuntimeBridge({ port, sillyTavernBaseUrl, allowedOrigins }) {
    const bridge = createOriginalRuntimeBridgeServer({
        sillyTavernBaseUrl,
        allowedOrigins,
    });
    return new Promise((resolve, reject) => {
        bridge.once('error', reject);
        bridge.listen(port, '127.0.0.1', () => resolve(bridge));
    });
}

function closeServer(candidate) {
    if (!candidate) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        candidate.close(() => resolve());
    });
}

async function isDirectory(target) {
    try {
        return (await stat(target)).isDirectory();
    } catch {
        return false;
    }
}

async function getFreePort(start) {
    for (let port = start; port < start + 100; port += 1) {
        if (await canListen(port)) {
            return port;
        }
    }
    throw new Error(`No free port near ${start}.`);
}

function canListen(port) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolve(true));
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

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            parsed[value.slice(2)] = values[index + 1];
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitForEvaluate(browser, sessionId, expression, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await evaluate(browser, sessionId, expression)) {
            return;
        }
        await delay(250);
    }
    throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function runSmokeCheck({
    name,
    level,
    timeoutMs,
    timeoutLabel,
    run,
}) {
    try {
        return await withTimeout(run(), timeoutMs, timeoutLabel);
    } catch (error) {
        return {
            name,
            level,
            details: {
                error: error?.message || String(error),
                stack: String(error?.stack || '').slice(0, 2000),
            },
            failures: [error?.message || String(error)],
        };
    }
}

async function waitForPlayerInputReady(browser, sessionId, timeoutMs) {
    const start = Date.now();
    let lastState = null;
    while (Date.now() - start < timeoutMs) {
        lastState = await evaluate(browser, sessionId, `(() => {
            const input = document.querySelector('#playerInput');
            const state = {
                inputDisabled: input?.disabled ?? true,
                speaker: document.querySelector('#speakerName')?.textContent?.trim() || '',
                dialogue: document.querySelector('#dialogueText')?.textContent?.trim().slice(0, 500) || '',
                stageStatus: document.querySelector('#stageStatus')?.textContent?.trim() || '',
                recoveryHidden: document.querySelector('#recoveryActions')?.hidden ?? true,
                fetches: window.__galgameSmokeFetches || [],
            };
            if (state.inputDisabled) {
                document.querySelector('#dialogueBox')?.click();
            }
            return state;
        })()`);
        if (lastState.inputDisabled === false) {
            return lastState;
        }
        await delay(300);
    }
    throw new Error(`Timed out waiting for player input ready: ${JSON.stringify(lastState)}`);
}

async function installFetchProbe(browser, sessionId) {
    await evaluate(browser, sessionId, `(() => {
        if (window.__galgameSmokeFetchProbeInstalled) return;
        window.__galgameSmokeFetchProbeInstalled = true;
        window.__galgameSmokeFetches = [];
        const copyText = (value, max = 240) => String(value || '').slice(0, max);
        const copyRefs = (value) => Array.isArray(value)
            ? value.map((item) => copyText(item, 240)).filter(Boolean).slice(0, 12)
            : [];
        const copyCountMap = (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
            const out = {};
            for (const [key, count] of Object.entries(value).slice(0, 24)) {
                out[copyText(key, 240)] = Number.isFinite(Number(count)) ? Number(count) : 0;
            }
            return out;
        };
        const copyChatSummary = (value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            return {
                count: Number.isFinite(Number(value.count)) ? Number(value.count) : 0,
                lastIsUser: Boolean(value.lastIsUser),
                lastIsSystem: Boolean(value.lastIsSystem),
                worldInfoRef: copyText(value.worldInfoRef, 240),
            };
        };
        const summarizeBridgeDiagnostics = (data) => {
            if (!String(data?.mode || '').includes('sillytavern-original-runtime-bridge')) return null;
            const diagnostics = data?.diagnostics || {};
            const authorization = diagnostics.bridgeAuthorization || {};
            return {
                ok: Boolean(data?.ok),
                unchanged: Boolean(data?.unchanged),
                chatId: copyText(data?.chatId, 240),
                messageCount: Array.isArray(data?.messages) ? data.messages.length : undefined,
                generatedTextPresent: Boolean(String(data?.generatedText || '').trim()),
                openedFromChatId: copyText(diagnostics.openedFromChatId, 240),
                currentChatIdAfterOpen: copyText(diagnostics.currentChatIdAfterOpen, 240),
                currentChatIdAfterGenerate: copyText(diagnostics.currentChatIdAfterGenerate, 240),
                runtimeWorldBookRefs: copyRefs(diagnostics.runtimeWorldBookRefs),
                chatMetadataWorldInfo: copyText(diagnostics.chatMetadataWorldInfo, 240),
                expectedWorldInfoActivated: Boolean(diagnostics.expectedWorldInfoActivated),
                worldInfoExactSetDuringGenerate: Boolean(diagnostics.worldInfoExactSetDuringGenerate),
                duringGenerateWorldInfoWorldRefs: copyRefs(diagnostics.duringGenerateWorldInfoWorldRefs || diagnostics.activatedWorldInfoWorldRefs),
                preGenerateWorldInfoWorldRefs: copyRefs(diagnostics.preGenerateWorldInfoWorldRefs),
                unexpectedLuciferArcWorldInfoDuringGenerate: copyRefs(diagnostics.unexpectedLuciferArcWorldInfoDuringGenerate),
                duringGenerateWorldInfoEntryCountByWorld: copyCountMap(diagnostics.duringGenerateWorldInfoEntryCountByWorld || diagnostics.activatedWorldInfoEntryCountByWorld),
                preGenerateWorldInfoEntryCountByWorld: copyCountMap(diagnostics.preGenerateWorldInfoEntryCountByWorld),
                targetBefore: copyChatSummary(diagnostics.targetBefore),
                targetAfter: copyChatSummary(diagnostics.targetAfter),
                characterPrimaryWorldTemporarilyDisabled: Boolean(diagnostics.characterPrimaryWorldTemporarilyDisabled),
                characterPrimaryWorldRestored: Boolean(diagnostics.characterPrimaryWorldRestored),
                bridgeAuthorization: {
                    decision: copyText(authorization.decision, 80),
                    releaseId: copyText(authorization.releaseId, 240),
                    scenarioId: copyText(authorization.scenarioId, 160),
                    scenarioVersion: copyText(authorization.scenarioVersion, 80),
                    arcId: copyText(authorization.arcId, 120),
                    chatIdHash: copyText(authorization.chatIdHash, 80),
                    targetBindingHash: copyText(authorization.targetBindingHash, 80),
                    worldBookRefsHash: copyText(authorization.worldBookRefsHash, 80),
                    runtimeWorldBookRefs: copyRefs(authorization.runtimeWorldBookRefs),
                },
            };
        };
        const summarizeBody = async (response) => {
            const clone = response.clone();
            const contentType = clone.headers?.get?.('content-type') || '';
            if (!contentType.includes('application/json')) {
                return { contentType };
            }
            try {
                const data = await clone.json();
                const summary = {
                    contentType,
                    keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 16) : [],
                    okField: Boolean(data?.ok),
                    error: typeof data?.error === 'string' ? data.error : '',
                    errorCode: typeof data?.errorCode === 'string' ? data.errorCode : '',
                    releaseId: data?.releaseId || data?.release?.releaseId || '',
                    scenarioId: data?.scenarioId || data?.release?.scenarioId || data?.id || '',
                    activeArcId: data?.activeArcId || data?.release?.activeArcId || data?.defaultArcId || '',
                    chatCount: Array.isArray(data) ? data.length : Array.isArray(data?.chats) ? data.chats.length : undefined,
                };
                const bridgeGenerateReply = summarizeBridgeDiagnostics(data);
                if (bridgeGenerateReply) {
                    summary.bridgeGenerateReply = bridgeGenerateReply;
                }
                return summary;
            } catch {
                return { contentType, jsonParseFailed: true };
            }
        };
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
            const startedAt = Date.now();
            const url = String(args[0]?.url || args[0] || '');
            window.__galgameSmokeFetchSeq = (Number(window.__galgameSmokeFetchSeq || 0) || 0) + 1;
            const entry = {
                id: window.__galgameSmokeFetchSeq,
                url,
                pending: true,
                startedAt,
            };
            window.__galgameSmokeFetches.push(entry);
            try {
                const response = await originalFetch(...args);
                const summary = await summarizeBody(response).catch(() => ({}));
                Object.assign(entry, {
                    pending: false,
                    ok: response.ok,
                    status: response.status,
                    elapsedMs: Date.now() - startedAt,
                    summary,
                });
                return response;
            } catch (error) {
                Object.assign(entry, {
                    pending: false,
                    ok: false,
                    error: String(error?.message || error || ''),
                    elapsedMs: Date.now() - startedAt,
                });
                throw error;
            }
        };
    })()`);
}

function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}
