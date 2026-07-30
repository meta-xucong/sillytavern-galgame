import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const moduleRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleRoot, '..', '..');
const DEFAULT_PORT = 8795;
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_PROVIDER_RETRY_DELAYS_MS = [2000, 6000];

export function createOriginalRuntimeBridgeServer({
    runtime = null,
    sillyTavernBaseUrl = process.env.SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8000',
    allowedOrigins = parseAllowedOrigins(process.env.GALGAME_ALLOWED_ORIGINS),
    host = process.env.HOST || '127.0.0.1',
    authToken = process.env.GALGAME_BRIDGE_TOKEN || process.env.GALGAME_BRIDGE_AUTH_TOKEN || '',
    proofSecret = process.env.GALGAME_BRIDGE_PROOF_SECRET || '',
    logger = console,
} = {}) {
    const auth = createBridgeAuthConfig({ host, authToken });
    const proofVerifier = createBridgeProofVerifier({ proofSecret });
    const runtimeBridge = runtime || new BrowserOriginalRuntimeBridge({ logger });

    const server = createServer(async (request, response) => {
        try {
            applyCors(request, response, allowedOrigins);
            if (request.method === 'OPTIONS') {
                response.writeHead(204);
                response.end();
                return;
            }

            if (!authorizeBridgeRequest(request, auth)) {
                sendJson(response, 401, {
                    ok: false,
                    errorCode: 'BRIDGE_AUTH_REQUIRED',
                });
                return;
            }

            const url = new URL(request.url || '/', 'http://127.0.0.1');
            if (request.method === 'GET' && url.pathname === '/health') {
                const health = await runtimeBridge.healthCheck?.().catch((error) => ({
                    ok: false,
                    errorCode: sanitizeErrorCode(error),
                }));
                sendJson(response, 200, {
                    ok: Boolean(health?.ok ?? true),
                    mode: 'sillytavern-original-runtime-bridge',
                    originalRuntime: 'browser-generate',
                    authRequired: auth.required,
                    proofRequired: proofVerifier.required,
                    ...runtimeBridge.getStatus?.(),
                    ...health,
                });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/stop') {
                const body = await readJsonBody(request).catch(() => ({}));
                const stopped = await runtimeBridge.stop?.({
                    reason: 'operator-request',
                    timeoutMs: clampStopTimeout(body.timeoutMs || body.stopTimeoutMs),
                });
                sendJson(response, 200, {
                    ok: true,
                    mode: 'sillytavern-original-runtime-bridge',
                    ...stopped,
                    ...runtimeBridge.getStatus?.(),
                });
                return;
            }

            if (request.method === 'POST' && url.pathname === '/v1/generate-reply') {
                if (runtimeBridge.isStopping?.()) {
                    sendJson(response, 503, {
                        ok: false,
                        errorCode: 'BRIDGE_STOPPING',
                    });
                    return;
                }
                const body = await readJsonBody(request);
                const validation = validateGenerateRequest(body, proofVerifier);
                if (!validation.ok) {
                    sendJson(response, 400, {
                        ok: false,
                        errorCode: validation.errorCode,
                        diagnostics: validation.evidence,
                    });
                    return;
                }

                const startedAt = Date.now();
                const result = await runtimeBridge.generateReply({
                    sillyTavernBaseUrl: normalizeBaseUrl(body.sillyTavernBaseUrl || sillyTavernBaseUrl),
                    avatar: body.character.avatar,
                    chatId: body.chatId,
                    runtimeWorldBookRefs: validation.runtimeBinding?.worldBookRefs || [],
                    timeoutMs: clampTimeout(body.timeoutMs),
                });
                sendJson(response, 200, {
                    ok: true,
                    mode: 'sillytavern-original-runtime-bridge',
                    elapsedMs: Date.now() - startedAt,
                    ...result,
                    diagnostics: {
                        ...result?.diagnostics,
                        bridgeAuthorization: validation.evidence,
                    },
                });
                return;
            }

            sendJson(response, 404, {
                ok: false,
                errorCode: 'NOT_FOUND',
            });
        } catch (error) {
            logger.warn?.('[original-runtime-bridge] request failed', sanitizeLogError(error));
            sendJson(response, 500, {
                ok: false,
                errorCode: sanitizeErrorCode(error),
                diagnostics: sanitizeDiagnostics(error.details),
            });
        }
    });

    server.once('close', () => {
        void (runtimeBridge.stop?.({ reason: 'server-close' }) || runtimeBridge.close?.());
    });
    return server;
}

export class BrowserOriginalRuntimeBridge {
    constructor({
        chromePath = process.env.GALGAME_BRIDGE_CHROME_PATH || '',
        userDataDir = process.env.GALGAME_BRIDGE_USER_DATA_DIR || path.join(repoRoot, '.codex-longrun', 'original-runtime-bridge-chrome'),
        headless = process.env.GALGAME_BRIDGE_HEADLESS !== 'false',
        debugPort = Number(process.env.GALGAME_BRIDGE_DEBUG_PORT || 0),
        providerRetryDelaysMs = parseRetryDelays(process.env.GALGAME_BRIDGE_PROVIDER_RETRY_DELAYS_MS, DEFAULT_PROVIDER_RETRY_DELAYS_MS),
        logger = console,
    } = {}) {
        this.chromePath = chromePath || findChrome();
        this.userDataDir = userDataDir;
        this.headless = headless;
        this.debugPort = debugPort;
        this.providerRetryDelaysMs = providerRetryDelaysMs;
        this.logger = logger;
        this.chrome = null;
        this.browser = null;
        this.targetId = null;
        this.sessionId = null;
        this.currentBaseUrl = '';
        this.queue = Promise.resolve();
        this.pendingTask = null;
        this.stopping = false;
    }

    async healthCheck() {
        return {
            ok: true,
            browser: Boolean(this.browser),
            headless: this.headless,
        };
    }

    getStatus() {
        return {
            stopping: this.stopping,
            pending: Boolean(this.pendingTask),
            pendingSinceMs: this.pendingTask ? Date.now() - this.pendingTask.startedAt : 0,
        };
    }

    isStopping() {
        return this.stopping;
    }

    async generateReply(request) {
        if (this.stopping) {
            throw createBridgeError('BRIDGE_STOPPING');
        }
        const task = this.queue.then(async () => {
            if (this.stopping) {
                throw createBridgeError('BRIDGE_STOPPING');
            }
            const stopSignal = createDeferred();
            this.pendingTask = {
                startedAt: Date.now(),
                chatIdHash: sha256Short(request?.chatId || ''),
                stopSignal,
            };
            try {
                const work = this.generateReplyUnsafe(request);
                work.catch(() => {});
                const result = await Promise.race([work, stopSignal.promise]);
                if (this.stopping) {
                    throw createBridgeError('BRIDGE_STOPPED', {
                        chatIdHash: this.pendingTask?.chatIdHash,
                    });
                }
                return result;
            } finally {
                this.pendingTask = null;
            }
        });
        this.queue = task.catch(() => {});
        return task;
    }

    async generateReplyUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
        const retryErrors = [];
        const retryDelays = Array.isArray(this.providerRetryDelaysMs) ? this.providerRetryDelaysMs : [];
        for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
            try {
                const result = await this.generateReplyOnceUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs, timeoutMs });
                if (retryErrors.length) {
                    result.diagnostics = {
                        ...result.diagnostics,
                        providerRetryAttempts: retryErrors.length,
                        providerRetryErrorCodes: retryErrors.map((error) => sanitizeErrorCode(error)),
                    };
                }
                return result;
            } catch (error) {
                if (!isRetryableOriginalProviderError(error) || attempt >= retryDelays.length || this.stopping) {
                    throw error;
                }
                retryErrors.push(error);
                const retryDelayMs = retryDelays[attempt];
                this.logger.warn?.('[original-runtime-bridge] transient original provider failure; retrying', {
                    attempt: attempt + 1,
                    nextDelayMs: retryDelayMs,
                    error: sanitizeLogError(error),
                });
                await delay(retryDelayMs);
            }
        }
        throw retryErrors.at(-1) || createBridgeError('ORIGINAL_RUNTIME_GENERATE_FAILED');
    }

    async generateReplyOnceUnsafe({ sillyTavernBaseUrl, avatar, chatId, runtimeWorldBookRefs = [], timeoutMs = DEFAULT_TIMEOUT_MS }) {
        await this.ensurePage(sillyTavernBaseUrl);
        const payload = {
            avatar,
            chatId: normalizeChatId(chatId),
            runtimeWorldBookRefs: normalizeWorldBookRefs(runtimeWorldBookRefs),
            timeoutMs: clampTimeout(timeoutMs),
        };
        const result = await this.evaluate(generateInOriginalRuntimeExpression(payload), payload.timeoutMs + 90000);
        if (!result?.ok) {
            const error = new Error(result?.errorCode || 'ORIGINAL_RUNTIME_GENERATE_FAILED');
            error.code = result?.errorCode;
            error.details = {
                elapsedMs: result?.elapsedMs,
                errorMessage: result?.errorMessage,
                errorStack: result?.errorStack,
                runtimeState: result?.runtimeState,
            };
            throw error;
        }
        return result;
    }

    async ensurePage(baseUrl) {
        const normalizedBase = normalizeBaseUrl(baseUrl);
        if (!this.browser) {
            await this.startBrowser();
        }
        if (!this.sessionId || this.currentBaseUrl !== normalizedBase) {
            await this.openOriginalPage(normalizedBase);
        }
    }

    async startBrowser() {
        await mkdir(this.userDataDir, { recursive: true });
        this.debugPort = this.debugPort || await getFreePort(9259);
        const args = [
            '--disable-gpu',
            '--no-first-run',
            '--no-default-browser-check',
            `--remote-debugging-port=${this.debugPort}`,
            `--user-data-dir=${this.userDataDir}`,
            'about:blank',
        ];
        if (this.headless) {
            args.unshift('--headless=new');
        }
        this.chrome = spawn(this.chromePath, args, {
            stdio: 'ignore',
            windowsHide: true,
        });
        this.browser = await connectBrowser(this.debugPort);
    }

    async openOriginalPage(baseUrl) {
        if (this.targetId) {
            await this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
        }
        const target = await this.browser.send('Target.createTarget', { url: 'about:blank' });
        const attached = await this.browser.send('Target.attachToTarget', {
            targetId: target.targetId,
            flatten: true,
        });
        this.targetId = target.targetId;
        this.sessionId = attached.sessionId;
        await this.browser.send('Page.enable', {}, this.sessionId);
        await this.browser.send('Runtime.enable', {}, this.sessionId);
        await this.browser.send('Page.navigate', { url: `${baseUrl}/` }, this.sessionId);
        this.currentBaseUrl = baseUrl;
        await this.evaluate(`(() => new Promise((resolve) => {
            if (document.readyState === 'complete') return resolve(true);
            window.addEventListener('load', () => resolve(true), { once: true });
            setTimeout(() => resolve(document.readyState), 60000);
        }))()`, 65000);
    }

    async evaluate(expression, timeoutMs) {
        const result = await withTimeout(this.browser.send('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        }, this.sessionId), timeoutMs, 'CDP_EVALUATION_TIMEOUT');

        if (result.exceptionDetails) {
            const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'ORIGINAL_RUNTIME_EXCEPTION';
            const error = new Error(description);
            error.code = 'ORIGINAL_RUNTIME_EXCEPTION';
            throw error;
        }
        return result.result?.value;
    }

    close() {
        if (this.targetId && this.browser) {
            void this.browser.send('Target.closeTarget', { targetId: this.targetId }).catch(() => {});
        }
        this.chrome?.kill();
        this.chrome = null;
        this.browser = null;
        this.targetId = null;
        this.sessionId = null;
    }

    async stop({ timeoutMs = 15000 } = {}) {
        const pendingAtStop = this.pendingTask;
        const hadPendingTask = Boolean(pendingAtStop);
        let stopMode = hadPendingTask ? 'safe-complete' : 'idle';
        let forced = false;
        let stopRequested = false;
        this.stopping = true;
        await this.requestOriginalStop()
            .then(() => {
                stopRequested = true;
            })
            .catch(() => {
                stopMode = 'stop-request-failed';
            });
        try {
            await withTimeout(this.queue.catch(() => {}), timeoutMs, 'BRIDGE_STOP_TIMEOUT');
        } catch {
            forced = true;
            stopMode = 'forced-timeout';
            pendingAtStop?.stopSignal?.reject(createBridgeError('BRIDGE_STOP_TIMEOUT', {
                forced: true,
                chatIdHash: pendingAtStop.chatIdHash,
            }));
            await this.queue.catch(() => {});
        }
        this.close();
        this.pendingTask = null;
        this.queue = Promise.resolve();
        return {
            stopped: true,
            forced,
            stopMode,
            stopRequested,
            hadPendingTask,
            pendingTaskFailed: hadPendingTask,
            pendingCleared: true,
            errorCode: forced ? 'BRIDGE_STOP_TIMEOUT' : undefined,
        };
    }

    async requestOriginalStop() {
        if (!this.browser || !this.sessionId) {
            return;
        }
        await this.evaluate(`(() => {
            try {
                const ctx = globalThis.SillyTavern?.getContext?.();
                ctx?.stopGeneration?.();
            } catch {}
            try {
                globalThis.stopGeneration?.();
            } catch {}
            return true;
        })()`, 5000);
    }
}

function generateInOriginalRuntimeExpression(payload) {
    return `(async () => {
        const payload = ${JSON.stringify(payload)};
        const startedAt = Date.now();
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const normalizeChatId = (value) => String(value || '').replace(/\\\\/g, '/').split('/').pop().replace(/\\.jsonl$/i, '').trim();
        const normalizeAvatar = (value) => String(value || '').trim().toLowerCase().replace(/\\\\/g, '/').split('/').pop();
        const sanitizeText = (value, max = 4000) => String(value || '').replace(/[\\u0000-\\u001f\\u007f]+/g, ' ').trim().slice(0, max);
        const targetChatId = normalizeChatId(payload.chatId);
        const expectedWorldBookRefs = Array.isArray(payload.runtimeWorldBookRefs)
            ? payload.runtimeWorldBookRefs.map((value) => sanitizeText(value, 240)).filter(Boolean)
            : [];
        const expectedChatWorldInfo = expectedWorldBookRefs[0] || '';
        let stModule = null;
        let eventsModule = null;
        let worldInfoModule = null;
        let targetLockTimer = null;
        let characterPrimaryWorldBefore = '';
        let characterPrimaryWorldTemporarilyDisabled = false;
        let characterPrimaryWorldRestored = false;
        let characterPrimaryWorldAfterDisable = '';
        let restoreCharacterPrimaryWorld = () => {};
        let applyCharacterPrimaryWorldIsolation = () => {};
        let worldInfoEventWindow = 'preGenerate';
        const preGenerateWorldInfoWorlds = [];
        const preGenerateWorldInfoEntryCountByWorld = {};
        const duringGenerateWorldInfoWorlds = [];
        const duringGenerateWorldInfoEntryCountByWorld = {};
        let forcedRuntimeChatReload = false;
        let forcedRuntimeChatReloadAttempts = 0;
        let runtimeStateBeforeForcedReload = null;
        let runtimeStateAfterForcedReload = null;
        const luciferArcBundlePattern = /^Galgame_Imported_Lucifer_Arc\d+_Bundle$/;
        const uniqueWorldRefs = (worlds) => [...new Set(worlds)];
        const cloneCounts = (counts) => Object.fromEntries(Object.entries(counts));
        const sortedRefs = (refs) => refs.slice().sort((a, b) => a.localeCompare(b));
        const refsEqual = (left, right) => JSON.stringify(sortedRefs(left)) === JSON.stringify(sortedRefs(right));
        const runtimeReloadDiagnostics = () => ({
            forcedRuntimeChatReload,
            forcedRuntimeChatReloadAttempts,
            runtimeStateBeforeForcedReload,
            runtimeStateAfterForcedReload,
        });
        const captureWorldInfoActivation = (entries) => {
            const targetWorlds = worldInfoEventWindow === 'duringGenerate'
                ? duringGenerateWorldInfoWorlds
                : preGenerateWorldInfoWorlds;
            const targetCounts = worldInfoEventWindow === 'duringGenerate'
                ? duringGenerateWorldInfoEntryCountByWorld
                : preGenerateWorldInfoEntryCountByWorld;
            for (const entry of Array.isArray(entries) ? entries : []) {
                const world = sanitizeText(entry?.world || '', 240);
                if (!world) {
                    continue;
                }
                targetWorlds.push(world);
                targetCounts[world] = (targetCounts[world] || 0) + 1;
            }
        };
        const resetDuringGenerateWorldInfoEvents = () => {
            duringGenerateWorldInfoWorlds.length = 0;
            for (const key of Object.keys(duringGenerateWorldInfoEntryCountByWorld)) {
                delete duringGenerateWorldInfoEntryCountByWorld[key];
            }
            worldInfoEventWindow = 'duringGenerate';
        };
        const buildWorldInfoEventDiagnostics = () => {
            const preGenerateWorldInfoWorldRefs = uniqueWorldRefs(preGenerateWorldInfoWorlds);
            const duringGenerateWorldInfoWorldRefs = uniqueWorldRefs(duringGenerateWorldInfoWorlds);
            const unexpectedLuciferArcWorldInfoDuringGenerate = duringGenerateWorldInfoWorldRefs
                .filter((world) => luciferArcBundlePattern.test(world) && !expectedWorldBookRefs.includes(world));
            return {
                preGenerateWorldInfoWorldRefs,
                preGenerateWorldInfoEntryCountByWorld: cloneCounts(preGenerateWorldInfoEntryCountByWorld),
                duringGenerateWorldInfoWorldRefs,
                duringGenerateWorldInfoEntryCountByWorld: cloneCounts(duringGenerateWorldInfoEntryCountByWorld),
                activatedWorldInfoWorldRefs: duringGenerateWorldInfoWorldRefs,
                activatedWorldInfoEntryCountByWorld: cloneCounts(duringGenerateWorldInfoEntryCountByWorld),
                expectedWorldInfoActivated: expectedChatWorldInfo ? duringGenerateWorldInfoWorldRefs.includes(expectedChatWorldInfo) : false,
                worldInfoExactSetDuringGenerate: expectedWorldBookRefs.length
                    ? refsEqual(duringGenerateWorldInfoWorldRefs, expectedWorldBookRefs)
                    : duringGenerateWorldInfoWorldRefs.length === 0,
                unexpectedLuciferArcWorldInfoDuringGenerate,
            };
        };
        const cleanupRuntimeBinding = () => {
            if (targetLockTimer) {
                clearInterval(targetLockTimer);
                targetLockTimer = null;
            }
            worldInfoEventWindow = 'postGenerate';
            if (eventsModule?.eventSource && eventsModule?.event_types?.WORLD_INFO_ACTIVATED) {
                eventsModule.eventSource.removeListener?.(eventsModule.event_types.WORLD_INFO_ACTIVATED, captureWorldInfoActivation);
            }
            restoreCharacterPrimaryWorld();
        };
        const stripHeader = (rawChat) => Array.isArray(rawChat) && rawChat[0]?.chat_metadata
            ? rawChat.slice(1)
            : (Array.isArray(rawChat) ? rawChat : []);
        const latestMessage = (rawChat) => stripHeader(rawChat).at(-1) || null;
        const summarizeRawChat = (rawChat) => {
            const messages = stripHeader(rawChat);
            const last = messages.at(-1) || null;
            const metadata = Array.isArray(rawChat) && rawChat[0]?.chat_metadata ? rawChat[0].chat_metadata : {};
            return {
                count: messages.length,
                lastIsUser: Boolean(last?.is_user),
                lastIsSystem: Boolean(last?.is_system),
                lastPreview: sanitizeText(last?.mes || '', 240),
                worldInfoRef: sanitizeText(metadata.world_info || '', 240),
            };
        };
        const runtimeState = () => {
            const ctx = globalThis.SillyTavern?.getContext?.();
            return {
                onlineStatus: sanitizeText(ctx?.onlineStatus || '', 120),
                mainApi: sanitizeText(ctx?.mainApi || '', 80),
                chatId: sanitizeText(ctx?.getCurrentChatId?.() || '', 240),
                targetChatId,
                chatLength: Array.isArray(ctx?.chat) ? ctx.chat.length : 0,
                lastIsUser: Boolean(ctx?.chat?.at?.(-1)?.is_user),
            };
        };
        const countWorldRefs = (refs) => {
            const counts = {};
            for (const ref of refs) {
                counts[ref] = (counts[ref] || 0) + 1;
            }
            return counts;
        };
        const collectWorldInfoBindingState = async (characterIndex) => {
            const ctx = globalThis.SillyTavern?.getContext?.();
            const characterRefs = [
                ['context.characters[characterIndex]', ctx?.characters?.[characterIndex]],
                ['script.characters[characterIndex]', stModule?.characters?.[characterIndex]],
                ['script.characters[this_chid]', stModule?.characters?.[stModule?.this_chid]],
            ];
            const primaryWorldRefs = [];
            for (const [source, character] of characterRefs) {
                primaryWorldRefs.push({
                    source,
                    name: sanitizeText(character?.name || '', 160),
                    avatar: sanitizeText(character?.avatar || '', 240),
                    world: sanitizeText(character?.data?.extensions?.world || '', 240),
                });
            }
            const selectedWorldInfo = Array.isArray(worldInfoModule?.selected_world_info)
                ? worldInfoModule.selected_world_info.map((value) => sanitizeText(value, 240)).filter(Boolean)
                : [];
            const charLore = Array.isArray(worldInfoModule?.world_info?.charLore)
                ? worldInfoModule.world_info.charLore.map((entry) => ({
                    name: sanitizeText(entry?.name || '', 240),
                    extraBooks: Array.isArray(entry?.extraBooks) ? entry.extraBooks.map((value) => sanitizeText(value, 240)).filter(Boolean) : [],
                }))
                : [];
            let sortedWorldInfoWorldRefs = [];
            let sortedWorldInfoError = '';
            try {
                const sortedEntries = await worldInfoModule.getSortedEntries();
                sortedWorldInfoWorldRefs = uniqueWorldRefs((Array.isArray(sortedEntries) ? sortedEntries : [])
                    .map((entry) => sanitizeText(entry?.world || '', 240))
                    .filter(Boolean));
            } catch (error) {
                sortedWorldInfoError = sanitizeText(error?.message || error, 240);
            }
            return {
                contextCharacterId: sanitizeText(ctx?.characterId ?? '', 80),
                scriptThisChid: sanitizeText(stModule?.this_chid ?? '', 80),
                chatMetadataWorldInfo: sanitizeText(stModule?.chat_metadata?.world_info || '', 240),
                selectedWorldInfo,
                charLore,
                primaryWorldRefs,
                sortedWorldInfoWorldRefs,
                sortedWorldInfoEntryCountByWorld: countWorldRefs(sortedWorldInfoWorldRefs),
                sortedWorldInfoError,
            };
        };
        const readTargetRawChat = async () => {
            if (!stModule?.getRequestHeaders) {
                throw Object.assign(new Error('ORIGINAL_HEADERS_UNAVAILABLE'), { code: 'ORIGINAL_HEADERS_UNAVAILABLE' });
            }
            const response = await fetch('/api/chats/get', {
                method: 'POST',
                headers: stModule.getRequestHeaders(),
                cache: 'no-cache',
                body: JSON.stringify({
                    avatar_url: payload.avatar,
                    file_name: targetChatId,
                }),
            });
            if (!response.ok) {
                throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_READ_FAILED'), { code: 'ORIGINAL_TARGET_CHAT_READ_FAILED' });
            }
            const rawChat = await response.json();
            return Array.isArray(rawChat) ? rawChat : [];
        };
        const snapshot = (rawChat, chatId = targetChatId) => {
            const messagesRaw = stripHeader(rawChat);
            return {
                chatId: normalizeChatId(chatId),
                rawChat,
                messages: messagesRaw
                    .filter((message) => message && typeof message.mes === 'string' && message.mes.trim() && !message.is_system)
                    .map((message, index) => ({
                        id: 'original-runtime-message-' + index,
                        speaker: sanitizeText(message.name || (message.is_user ? 'Player' : 'Character'), 160),
                        role: message.is_user ? 'player' : 'character',
                        text: sanitizeText(message.extra?.display_text || message.mes, 4000),
                        sentAt: sanitizeText(message.send_date || '', 120),
                    })),
            };
        };
        const waitFor = async (predicate, timeoutMs, errorCode) => {
            const end = Date.now() + timeoutMs;
            while (Date.now() < end) {
                try {
                    const value = await predicate();
                    if (value) return value;
                } catch {
                    // keep polling while the original app initializes
                }
                await delay(250);
            }
            throw Object.assign(new Error(errorCode), { code: errorCode });
        };

        try {
            await waitFor(() => globalThis.SillyTavern?.getContext, 60000, 'ORIGINAL_CONTEXT_UNAVAILABLE');
            stModule = await import('/script.js');
            eventsModule = await import('/scripts/events.js');
            if (eventsModule?.eventSource && eventsModule?.event_types?.WORLD_INFO_ACTIVATED) {
                eventsModule.eventSource.on(eventsModule.event_types.WORLD_INFO_ACTIVATED, captureWorldInfoActivation);
            }
            await waitFor(() => Boolean(stModule.token), 60000, 'ORIGINAL_CSRF_UNAVAILABLE');
            worldInfoModule = await import('/scripts/world-info.js');
            await waitFor(() => Array.isArray(worldInfoModule.world_names), 60000, 'ORIGINAL_WORLD_INFO_UNAVAILABLE');
            await waitFor(() => document.querySelector('#send_textarea'), 60000, 'ORIGINAL_INPUT_UNAVAILABLE');
            let ctx = globalThis.SillyTavern.getContext();
            if (typeof ctx.getCharacters === 'function') {
                await ctx.getCharacters();
            }
            await waitFor(() => Array.isArray(globalThis.SillyTavern.getContext().characters) && globalThis.SillyTavern.getContext().characters.length > 0, 60000, 'ORIGINAL_CHARACTERS_UNAVAILABLE');

            ctx = globalThis.SillyTavern.getContext();
            const expectedAvatar = normalizeAvatar(payload.avatar);
            const characterIndex = ctx.characters.findIndex((character) => {
                const avatar = normalizeAvatar(character?.avatar);
                const name = normalizeAvatar(character?.name);
                return avatar === expectedAvatar || avatar.replace(/\\.[^.]+$/, '') === expectedAvatar.replace(/\\.[^.]+$/, '') || name === expectedAvatar;
            });
            if (characterIndex < 0) {
                throw Object.assign(new Error('ORIGINAL_CHARACTER_NOT_FOUND'), { code: 'ORIGINAL_CHARACTER_NOT_FOUND' });
            }

            const openedFromChatId = normalizeChatId(ctx.getCurrentChatId?.() || '');
            const targetBeforeRawChat = await readTargetRawChat();
            const targetBeforeMessages = stripHeader(targetBeforeRawChat);
            const targetBeforeLast = latestMessage(targetBeforeRawChat);
            const targetBeforeWorldInfo = sanitizeText(targetBeforeRawChat[0]?.chat_metadata?.world_info || '', 240);
            if (expectedChatWorldInfo && targetBeforeWorldInfo !== expectedChatWorldInfo) {
                throw Object.assign(new Error('ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH'), {
                    code: 'ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH',
                    diagnostics: {
                        expectedWorldInfo: expectedChatWorldInfo,
                        targetWorldInfo: targetBeforeWorldInfo,
                        targetBefore: summarizeRawChat(targetBeforeRawChat),
                    },
                });
            }
            const forceTargetChatState = () => {
                const current = globalThis.SillyTavern.getContext();
                if (current.characters?.[characterIndex]) {
                    current.characters[characterIndex].chat = targetChatId;
                }
                const selectedChat = document.querySelector('#selected_chat_pole');
                if (selectedChat) {
                    selectedChat.value = targetChatId;
                }
            };
            const currentMatchesTargetBeforeGeneration = () => {
                const current = globalThis.SillyTavern.getContext();
                const currentLast = current.chat?.at?.(-1);
                return normalizeChatId(current.getCurrentChatId?.()) === targetChatId
                    && Array.isArray(current.chat)
                    && current.chat.length === targetBeforeMessages.length
                    && Boolean(currentLast?.is_user) === Boolean(targetBeforeLast?.is_user)
                    && sanitizeText(currentLast?.mes || '', 4000) === sanitizeText(targetBeforeLast?.mes || '', 4000);
            };
            const cloneMessage = (message) => JSON.parse(JSON.stringify(message || {}));
            const forceReloadTargetChatFromReadback = async () => {
                forcedRuntimeChatReloadAttempts += 1;
                runtimeStateBeforeForcedReload = runtimeState();
                forceTargetChatState();
                const currentBeforeReload = globalThis.SillyTavern.getContext();
                if (typeof currentBeforeReload.reloadCurrentChat === 'function') {
                    await currentBeforeReload.reloadCurrentChat();
                    forceTargetChatState();
                    if (currentMatchesTargetBeforeGeneration()) {
                        forcedRuntimeChatReload = true;
                        runtimeStateAfterForcedReload = runtimeState();
                        return;
                    }
                }

                const current = globalThis.SillyTavern.getContext();
                const header = Array.isArray(targetBeforeRawChat) && targetBeforeRawChat[0]?.chat_metadata
                    ? targetBeforeRawChat[0]
                    : { chat_metadata: {} };
                const messages = targetBeforeMessages.map(cloneMessage);
                if (Array.isArray(current.chat)) {
                    current.chat.splice(0, current.chat.length, ...messages);
                }
                if (Array.isArray(stModule?.chat) && stModule.chat !== current.chat) {
                    stModule.chat.splice(0, stModule.chat.length, ...messages.map(cloneMessage));
                }
                if (typeof current.updateChatMetadata === 'function') {
                    current.updateChatMetadata(header.chat_metadata || {}, true);
                }
                if (typeof stModule?.loadItemizedPrompts === 'function') {
                    await stModule.loadItemizedPrompts(targetChatId);
                }
                if (typeof current.printMessages === 'function') {
                    await current.printMessages();
                }
                const eventSource = eventsModule?.eventSource || current.eventSource;
                const eventTypes = eventsModule?.event_types || current.eventTypes;
                if (eventSource?.emit && eventTypes?.CHAT_LOADED) {
                    await eventSource.emit(eventTypes.CHAT_LOADED, { detail: { id: characterIndex, character: current.characters?.[characterIndex] } });
                }
                if (eventSource?.emit && eventTypes?.CHAT_CHANGED) {
                    await eventSource.emit(eventTypes.CHAT_CHANGED, targetChatId);
                }
                forceTargetChatState();
                forcedRuntimeChatReload = true;
                runtimeStateAfterForcedReload = runtimeState();
            };
            const holdTargetBinding = async (durationMs) => {
                const end = Date.now() + durationMs;
                while (Date.now() < end) {
                    forceTargetChatState();
                    applyCharacterPrimaryWorldIsolation();
                    if (!currentMatchesTargetBeforeGeneration()) {
                        throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_BINDING_UNSTABLE'), {
                            code: 'ORIGINAL_TARGET_CHAT_BINDING_UNSTABLE',
                            diagnostics: {
                                ...runtimeState(),
                                ...runtimeReloadDiagnostics(),
                                openedFromChatId,
                                targetBefore: summarizeRawChat(targetBeforeRawChat),
                            },
                        });
                    }
                    await delay(250);
                }
            };
            const saveTargetRawChat = async (rawChat) => {
                const current = globalThis.SillyTavern.getContext();
                const response = await fetch('/api/chats/save', {
                    method: 'POST',
                    headers: stModule.getRequestHeaders(),
                    cache: 'no-cache',
                    body: JSON.stringify({
                        ch_name: sanitizeText(current.characters?.[characterIndex]?.name || 'Character', 160),
                        avatar_url: payload.avatar,
                        file_name: targetChatId,
                        chat: rawChat,
                        force: true,
                    }),
                });
                if (!response.ok) {
                    throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_SAVE_FAILED'), { code: 'ORIGINAL_TARGET_CHAT_SAVE_FAILED' });
                }
            };
            const trimTrailingEmptyOriginalReply = async (rawChat) => {
                const messages = stripHeader(rawChat);
                const last = messages.at(-1);
                if (!(last && !last.is_user && !last.is_system && !sanitizeText(last.mes || '', 4000))) {
                    return rawChat;
                }
                const trimmedRawChat = rawChat.slice(0, -1);
                await saveTargetRawChat(trimmedRawChat);
                return trimmedRawChat;
            };
            if (!targetBeforeMessages.length) {
                throw Object.assign(new Error('ORIGINAL_TARGET_CHAT_EMPTY'), {
                    code: 'ORIGINAL_TARGET_CHAT_EMPTY',
                    diagnostics: {
                        ...runtimeState(),
                        target: summarizeRawChat(targetBeforeRawChat),
                    },
                });
            }

            forceTargetChatState();
            await ctx.selectCharacterById(characterIndex, { switchMenu: false });
            await waitFor(() => String(globalThis.SillyTavern.getContext().characterId) === String(characterIndex), 60000, 'ORIGINAL_CHARACTER_SELECT_TIMEOUT');
            ctx = globalThis.SillyTavern.getContext();
            await ctx.openCharacterChat(targetChatId);
            forceTargetChatState();
            if (!currentMatchesTargetBeforeGeneration()) {
                await forceReloadTargetChatFromReadback();
            }
            await waitFor(currentMatchesTargetBeforeGeneration, 10000, 'ORIGINAL_TARGET_CHAT_BINDING_TIMEOUT');
            if (expectedChatWorldInfo) {
                await waitFor(() => sanitizeText(stModule.chat_metadata?.world_info || '', 240) === expectedChatWorldInfo, 10000, 'ORIGINAL_RUNTIME_WORLD_INFO_NOT_LOADED');
            }
            const activeCharacter = globalThis.SillyTavern.getContext().characters?.[characterIndex];
            characterPrimaryWorldBefore = sanitizeText(activeCharacter?.data?.extensions?.world || '', 240);
            const primaryWorldRestoreTargets = [];
            const addPrimaryWorldRestoreTarget = (character, world) => {
                if (!primaryWorldRestoreTargets.some((target) => target.character === character)) {
                    primaryWorldRestoreTargets.push({ character, world });
                }
            };
            const collectRuntimeCharacterRefs = () => {
                const current = globalThis.SillyTavern.getContext();
                const runtimeCharacterRefs = [];
                const addRuntimeCharacterRef = (character) => {
                    if (character?.data?.extensions && !runtimeCharacterRefs.includes(character)) {
                        runtimeCharacterRefs.push(character);
                    }
                };
                addRuntimeCharacterRef(current.characters?.[characterIndex]);
                addRuntimeCharacterRef(stModule.characters?.[characterIndex]);
                addRuntimeCharacterRef(stModule.characters?.[stModule.this_chid]);
                return runtimeCharacterRefs;
            };
            applyCharacterPrimaryWorldIsolation = () => {
                if (!expectedChatWorldInfo) {
                    return;
                }
                const runtimeCharacterRefs = collectRuntimeCharacterRefs();
                for (const character of runtimeCharacterRefs) {
                    const world = sanitizeText(character?.data?.extensions?.world || '', 240);
                    if (world && world !== expectedChatWorldInfo) {
                        addPrimaryWorldRestoreTarget(character, world);
                        character.data.extensions.world = '';
                        characterPrimaryWorldTemporarilyDisabled = true;
                    }
                }
                characterPrimaryWorldAfterDisable = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
            };
            restoreCharacterPrimaryWorld = () => {
                if (characterPrimaryWorldRestored) {
                    return;
                }
                for (const target of primaryWorldRestoreTargets) {
                    if (target.character?.data?.extensions) {
                        target.character.data.extensions.world = target.world;
                    }
                }
                characterPrimaryWorldRestored = true;
            };
            applyCharacterPrimaryWorldIsolation();
            await holdTargetBinding(2000);
            await waitFor(() => globalThis.SillyTavern.getContext().onlineStatus !== 'no_connection', 60000, 'ORIGINAL_BACKEND_NO_CONNECTION');
            applyCharacterPrimaryWorldIsolation();
            const worldInfoBindingBeforeGenerate = await collectWorldInfoBindingState(characterIndex);

            ctx = globalThis.SillyTavern.getContext();
            const beforeCount = targetBeforeMessages.length;
            if (!targetBeforeLast?.is_user) {
                cleanupRuntimeBinding();
                const characterPrimaryWorldAfterRestore = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
                return {
                    ok: true,
                    unchanged: true,
                    elapsedMs: Date.now() - startedAt,
                    ...snapshot(targetBeforeRawChat, targetChatId),
                    generatedText: sanitizeText(targetBeforeLast?.mes || ''),
                    diagnostics: {
                        openedFromChatId,
                        currentChatIdAfterOpen: normalizeChatId(ctx.getCurrentChatId?.() || ''),
                        runtimeWorldBookRefs: expectedWorldBookRefs,
                        chatMetadataWorldInfo: sanitizeText(stModule.chat_metadata?.world_info || '', 240),
                        ...runtimeReloadDiagnostics(),
                        characterPrimaryWorldBefore,
                        characterPrimaryWorldAfterDisable,
                        characterPrimaryWorldTemporarilyDisabled,
                        characterPrimaryWorldRestored,
                        characterPrimaryWorldAfterRestore,
                        worldInfoBindingBeforeGenerate,
                        ...buildWorldInfoEventDiagnostics(),
                        targetBefore: summarizeRawChat(targetBeforeRawChat),
                        targetAfter: summarizeRawChat(targetBeforeRawChat),
                    },
                };
            }

            const input = document.querySelector('#send_textarea');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            targetLockTimer = setInterval(() => {
                forceTargetChatState();
                applyCharacterPrimaryWorldIsolation();
            }, 100);
            const readTargetReplyStatus = async () => {
                const targetRawChat = await readTargetRawChat();
                const targetMessages = stripHeader(targetRawChat);
                const last = targetMessages.at(-1);
                if (!(targetMessages.length > beforeCount && last && !last.is_user && !last.is_system)) {
                    return null;
                }
                return sanitizeText(last.mes || '', 4000)
                    ? { type: 'ready', rawChat: targetRawChat }
                    : { type: 'empty', rawChat: targetRawChat };
            };
            const waitForTargetReply = async (timeoutMs, errorCode) => {
                const end = Date.now() + timeoutMs;
                while (Date.now() < end) {
                    let status = null;
                    try {
                        status = await readTargetReplyStatus();
                    } catch {
                        await delay(500);
                        continue;
                    }
                    if (status?.type === 'ready') {
                        return status.rawChat;
                    }
                    if (status?.type === 'empty') {
                        const trimmedRawChat = await trimTrailingEmptyOriginalReply(status.rawChat);
                        throw Object.assign(new Error('ORIGINAL_EMPTY_REPLY'), {
                            code: 'ORIGINAL_EMPTY_REPLY',
                            diagnostics: {
                                ...runtimeState(),
                                ...runtimeReloadDiagnostics(),
                                openedFromChatId,
                                targetBefore: summarizeRawChat(targetBeforeRawChat),
                                targetAfter: summarizeRawChat(trimmedRawChat),
                            },
                        });
                    }
                    await delay(500);
                }
                throw Object.assign(new Error(errorCode), { code: errorCode });
            };
            applyCharacterPrimaryWorldIsolation();
            resetDuringGenerateWorldInfoEvents();
            const generation = ctx.generate('normal', { automatic_trigger: false })
                .then(() => ({ type: 'generation-finished' }))
                .catch((error) => ({ type: 'generation-error', error }));
            const replyWritten = waitForTargetReply(payload.timeoutMs, 'ORIGINAL_GENERATE_TIMEOUT')
                .then((rawChat) => ({ type: 'reply-written', rawChat }))
                .catch((error) => ({ type: 'reply-error', error }));
            const generationResult = await Promise.race([
                generation,
                replyWritten,
                delay(payload.timeoutMs).then(() => ({ type: 'timeout' })),
            ]);
            if (generationResult.type === 'timeout') {
                const targetAfterTimeout = await readTargetRawChat().catch(() => []);
                ctx.stopGeneration?.();
                throw Object.assign(new Error('ORIGINAL_GENERATE_TIMEOUT'), {
                    code: 'ORIGINAL_GENERATE_TIMEOUT',
                    diagnostics: {
                        ...runtimeState(),
                        ...runtimeReloadDiagnostics(),
                        openedFromChatId,
                        targetBefore: summarizeRawChat(targetBeforeRawChat),
                        targetAfter: summarizeRawChat(targetAfterTimeout),
                    },
                });
            }
            if (generationResult.type === 'generation-error') {
                throw generationResult.error;
            }
            if (generationResult.type === 'reply-error') {
                ctx.stopGeneration?.();
                throw generationResult.error;
            }
            let finalRawChat = generationResult.rawChat || null;
            if (generationResult.type === 'generation-finished') {
                finalRawChat = await waitForTargetReply(30000, 'ORIGINAL_REPLY_NOT_WRITTEN');
            } else {
                await waitFor(() => !stModule.isGenerating?.(), 15000, 'ORIGINAL_GENERATION_FINALIZE_TIMEOUT').catch(() => {});
                finalRawChat = await readTargetRawChat();
            }
            worldInfoEventWindow = 'postGenerate';

            const currentSnapshot = snapshot(finalRawChat, targetChatId);
            clearInterval(targetLockTimer);
            targetLockTimer = null;
            restoreCharacterPrimaryWorld();
            const characterPrimaryWorldAfterRestore = sanitizeText(globalThis.SillyTavern.getContext().characters?.[characterIndex]?.data?.extensions?.world || '', 240);
            return {
                ok: true,
                unchanged: false,
                elapsedMs: Date.now() - startedAt,
                ...currentSnapshot,
                generatedText: sanitizeText(latestMessage(finalRawChat)?.mes || ''),
                diagnostics: {
                    openedFromChatId,
                    currentChatIdAfterOpen: targetChatId,
                    currentChatIdAfterGenerate: normalizeChatId(globalThis.SillyTavern.getContext().getCurrentChatId?.() || ''),
                    runtimeWorldBookRefs: expectedWorldBookRefs,
                    chatMetadataWorldInfo: sanitizeText(stModule.chat_metadata?.world_info || '', 240),
                    ...runtimeReloadDiagnostics(),
                    characterPrimaryWorldBefore,
                    characterPrimaryWorldAfterDisable,
                    characterPrimaryWorldTemporarilyDisabled,
                    characterPrimaryWorldRestored,
                    characterPrimaryWorldAfterRestore,
                    worldInfoBindingBeforeGenerate,
                    ...buildWorldInfoEventDiagnostics(),
                    targetBefore: summarizeRawChat(targetBeforeRawChat),
                    targetAfter: summarizeRawChat(finalRawChat),
                },
            };
        } catch (error) {
            let targetState = {};
            try {
                targetState = stModule ? summarizeRawChat(await readTargetRawChat()) : {};
            } catch {
                targetState = {};
            }
            return {
                ok: false,
                elapsedMs: Date.now() - startedAt,
                errorCode: error?.code || error?.message || 'ORIGINAL_RUNTIME_FAILED',
                errorMessage: String(error?.message || error || ''),
                errorStack: String(error?.stack || '').slice(0, 2000),
                runtimeState: {
                    ...(error?.diagnostics || runtimeState()),
                    ...runtimeReloadDiagnostics(),
                    targetState,
                },
            };
        } finally {
            cleanupRuntimeBinding();
        }
    })()`;
}

function validateGenerateRequest(body, proofVerifier) {
    if (!body || typeof body !== 'object') {
        return { ok: false, errorCode: 'INVALID_REQUEST' };
    }
    if (!body.character?.avatar) {
        return { ok: false, errorCode: 'CHARACTER_AVATAR_REQUIRED' };
    }
    if (!body.chatId) {
        return { ok: false, errorCode: 'CHAT_ID_REQUIRED' };
    }
    return validateSignedBridgeProof(body, proofVerifier);
}

function validateSignedBridgeProof(body, proofVerifier) {
    const requestId = sanitizeReference(body.requestId || `bridge-${Date.now().toString(36)}`, 80);
    const verification = proofVerifier.verify(body.bridgeProof, { requestId });
    if (!verification.ok) {
        return verification;
    }

    const proof = verification.proof;
    const binding = proof.binding;
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_BINDING_REQUIRED',
            evidence: deniedEvidence({ requestId, reason: 'missing-bridge-binding' }),
        };
    }
    if (proof.protocolVersion !== 'galgame.original-runtime-bridge-proof.v1') {
        return {
            ok: false,
            errorCode: 'BRIDGE_PROOF_VERSION_UNSUPPORTED',
            evidence: deniedEvidence({ requestId, reason: 'unsupported-proof-version' }),
        };
    }
    if (proof.audience !== 'original-runtime-bridge') {
        return {
            ok: false,
            errorCode: 'BRIDGE_PROOF_AUDIENCE_MISMATCH',
            evidence: deniedEvidence({ requestId, reason: 'proof-audience-mismatch' }),
        };
    }

    const release = binding.release || {};
    const target = binding.target || {};
    const chat = binding.chat || {};
    const resources = binding.resources || {};
    const releaseId = sanitizeReference(release.releaseId, 240);
    const scenarioId = sanitizeReference(release.scenarioId, 160);
    const scenarioVersion = sanitizeReference(release.scenarioVersion, 80);
    const arcId = sanitizeReference(release.arcId, 120);
    const chatId = normalizeChatId(body.chatId);
    const bindingChatId = normalizeChatId(chat.chatId);
    const allowedChatIds = uniqueArray([chat.chatId, chat.chatSeedId, ...(Array.isArray(chat.allowedChatIds) ? chat.allowedChatIds : [])]
        .map(normalizeChatId)
        .filter(Boolean));
    const runtimeWorldBookRefs = normalizeWorldBookRefs(resources.worldBookRefs);
    const requestAvatar = normalizeAvatar(body.character.avatar);
    const targetAvatar = normalizeAvatar(target.avatar);
    const requestCharacterId = sanitizeReference(body.character.id || '', 160).toLowerCase();
    const targetCharacterId = sanitizeReference(target.characterId || '', 160).toLowerCase();
    const normalizedBinding = {
        protocolVersion: 'galgame.original-runtime-bridge-binding.v1',
        release: {
            releaseId,
            scenarioId,
            scenarioVersion,
            arcId,
            arcVersion: sanitizeReference(release.arcVersion || '', 80),
        },
        target: {
            type: sanitizeReference(target.type || '', 40),
            characterId: sanitizeReference(target.characterId || '', 160),
            avatar: sanitizeReference(target.avatar || '', 240),
            groupId: sanitizeReference(target.groupId || '', 160),
        },
        chat: {
            chatId: bindingChatId,
            chatSeedId: normalizeChatId(chat.chatSeedId),
            allowedChatIds,
        },
        resources: {
            worldBookRefs: runtimeWorldBookRefs,
            worldBookApplication: sanitizeReference(resources.worldBookApplication || '', 120),
        },
    };
    const targetBindingHash = stableReferenceHash(normalizedBinding);
    const baseEvidence = {
        requestId,
        releaseId,
        scenarioId,
        scenarioVersion,
        arcId,
        chatIdHash: sha256Short(chatId),
        targetBindingHash,
        worldBookRefsHash: sha256Short(runtimeWorldBookRefs.join('\n')),
    };

    const bodyReleaseId = sanitizeReference(body.releaseId || '', 240);
    const bodyScenarioId = sanitizeReference(body.scenarioId || '', 160);
    const bodyScenarioVersion = sanitizeReference(body.scenarioVersion || '', 80);
    const bodyArcId = sanitizeReference(body.arcId || '', 120);
    if (
        (bodyReleaseId && bodyReleaseId !== releaseId)
        || (bodyScenarioId && bodyScenarioId !== scenarioId)
        || (bodyScenarioVersion && bodyScenarioVersion !== scenarioVersion)
        || (bodyArcId && bodyArcId !== arcId)
    ) {
        return {
            ok: false,
            errorCode: 'BRIDGE_RELEASE_INDEX_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'request-index-does-not-match-proof' }),
        };
    }
    if (!releaseId || !scenarioId || !scenarioVersion || !arcId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_RELEASE_BINDING_REQUIRED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'missing-release-or-arc-binding' }),
        };
    }
    if (bindingChatId && bindingChatId !== chatId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHAT_BINDING_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'body-chat-does-not-match-binding-chat' }),
        };
    }
    if (!allowedChatIds.includes(chatId)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHAT_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'chat-not-in-release-allowlist' }),
        };
    }
    if (target.type && target.type !== 'character') {
        return {
            ok: false,
            errorCode: 'BRIDGE_TARGET_UNBRIDGED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'group-target-is-not-yet-bridged' }),
        };
    }
    if (!targetAvatar || !avatarsMatch(requestAvatar, targetAvatar)) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHARACTER_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'avatar-not-in-target-binding' }),
        };
    }
    if (requestCharacterId && targetCharacterId && requestCharacterId !== targetCharacterId) {
        return {
            ok: false,
            errorCode: 'BRIDGE_CHARACTER_NOT_ALLOWED',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'character-id-not-in-target-binding' }),
        };
    }
    if (proof.bindingHash && proof.bindingHash !== targetBindingHash) {
        return {
            ok: false,
            errorCode: 'BRIDGE_BINDING_HASH_MISMATCH',
            evidence: deniedEvidence({ ...baseEvidence, reason: 'binding-hash-mismatch' }),
        };
    }

    return {
        ok: true,
        runtimeBinding: {
            worldBookRefs: runtimeWorldBookRefs,
        },
        evidence: {
            ...baseEvidence,
            decision: 'allowed',
            runtimeWorldBookRefs,
        },
    };
}

export function createSignedBridgeProof({
    secret,
    binding,
    issuedAt = new Date(),
    ttlMs = 5 * 60 * 1000,
    nonce = randomUUID(),
} = {}) {
    const safeBinding = normalizeProofBinding(binding);
    const issuedAtDate = issuedAt instanceof Date ? issuedAt : new Date(issuedAt);
    const expiresAt = new Date(issuedAtDate.getTime() + ttlMs);
    const proof = {
        protocolVersion: 'galgame.original-runtime-bridge-proof.v1',
        audience: 'original-runtime-bridge',
        issuedAt: issuedAtDate.toISOString(),
        expiresAt: expiresAt.toISOString(),
        nonce: sanitizeReference(nonce, 120),
        binding: safeBinding,
        bindingHash: stableReferenceHash(safeBinding),
    };
    return {
        ...proof,
        signature: signProofPayload(proof, secret),
    };
}

function createBridgeProofVerifier({ proofSecret, now = () => Date.now() } = {}) {
    const secret = String(proofSecret || '').trim();
    const usedNonces = new Map();
    return {
        required: true,
        verify(proof, { requestId } = {}) {
            if (!secret) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_SECRET_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-secret-not-configured' }),
                };
            }
            if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'missing-signed-proof' }),
                };
            }
            const nonce = sanitizeReference(proof.nonce, 120);
            const expiresAtMs = Date.parse(proof.expiresAt || '');
            const issuedAtMs = Date.parse(proof.issuedAt || '');
            const nowMs = now();
            purgeUsedNonces(usedNonces, nowMs);
            if (!nonce) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_NONCE_REQUIRED',
                    evidence: deniedEvidence({ requestId, reason: 'missing-proof-nonce' }),
                };
            }
            if (usedNonces.has(nonce)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_REPLAYED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-nonce-replayed' }),
                };
            }
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_EXPIRED',
                    evidence: deniedEvidence({ requestId, reason: 'proof-expired' }),
                };
            }
            if (!Number.isFinite(issuedAtMs) || issuedAtMs - nowMs > 60000) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_TIME_INVALID',
                    evidence: deniedEvidence({ requestId, reason: 'proof-issued-at-invalid' }),
                };
            }
            if (!verifyProofSignature(proof, secret)) {
                return {
                    ok: false,
                    errorCode: 'BRIDGE_PROOF_SIGNATURE_INVALID',
                    evidence: deniedEvidence({ requestId, reason: 'proof-signature-invalid' }),
                };
            }
            usedNonces.set(nonce, expiresAtMs);
            return {
                ok: true,
                proof,
            };
        },
    };
}

function purgeUsedNonces(usedNonces, nowMs) {
    for (const [nonce, expiresAtMs] of usedNonces.entries()) {
        if (expiresAtMs <= nowMs) {
            usedNonces.delete(nonce);
        }
    }
}

function normalizeProofBinding(binding = {}) {
    const release = binding.release || {};
    const target = binding.target || {};
    const chat = binding.chat || {};
    const resources = binding.resources || {};
    return {
        protocolVersion: 'galgame.original-runtime-bridge-binding.v1',
        release: {
            releaseId: sanitizeReference(release.releaseId, 240),
            scenarioId: sanitizeReference(release.scenarioId, 160),
            scenarioVersion: sanitizeReference(release.scenarioVersion, 80),
            arcId: sanitizeReference(release.arcId, 120),
            arcVersion: sanitizeReference(release.arcVersion || '', 80),
        },
        target: {
            type: sanitizeReference(target.type || 'character', 40),
            characterId: sanitizeReference(target.characterId || '', 160),
            avatar: sanitizeReference(target.avatar || '', 240),
            groupId: sanitizeReference(target.groupId || '', 160),
        },
        chat: {
            chatId: normalizeChatId(chat.chatId),
            chatSeedId: normalizeChatId(chat.chatSeedId),
            allowedChatIds: uniqueArray([chat.chatId, chat.chatSeedId, ...(Array.isArray(chat.allowedChatIds) ? chat.allowedChatIds : [])]
                .map(normalizeChatId)
                .filter(Boolean)),
        },
        resources: {
            worldBookRefs: normalizeWorldBookRefs(resources.worldBookRefs),
            worldBookApplication: sanitizeReference(resources.worldBookApplication || '', 120),
        },
    };
}

function signProofPayload(proof, secret) {
    if (!secret) {
        throw new Error('BRIDGE_PROOF_SECRET_REQUIRED');
    }
    return createHmac('sha256', secret)
        .update(canonicalProofPayload(proof))
        .digest('base64url');
}

function verifyProofSignature(proof, secret) {
    const signature = String(proof.signature || '');
    const expected = signProofPayload(proof, secret);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
}

function canonicalProofPayload(proof) {
    const { signature, ...unsignedProof } = proof || {};
    return stableStringify(unsignedProof);
}

function applyCors(request, response, allowedOrigins) {
    const origin = request.headers.origin || '';
    const allowAll = allowedOrigins.includes('*');
    if (allowAll || allowedOrigins.includes(origin)) {
        response.setHeader('Access-Control-Allow-Origin', allowAll ? '*' : origin);
        response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(response, status, data) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(JSON.stringify(data));
}

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        request.on('data', (chunk) => {
            size += chunk.length;
            if (size > 128 * 1024) {
                reject(new Error('REQUEST_TOO_LARGE'));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });
        request.on('end', () => {
            try {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve(text ? JSON.parse(text) : {});
            } catch {
                reject(new Error('INVALID_JSON'));
            }
        });
        request.on('error', reject);
    });
}

function parseAllowedOrigins(value) {
    if (!value) {
        return [
            'http://127.0.0.1:8000',
            'http://localhost:8000',
            'http://127.0.0.1:8001',
            'http://localhost:8001',
        ];
    }
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function createBridgeAuthConfig({ host, authToken }) {
    const normalizedToken = String(authToken || '').trim();
    const loopback = isLoopbackHost(host);
    if (!loopback && !normalizedToken) {
        throw new Error('GALGAME_BRIDGE_AUTH_REQUIRED_FOR_NON_LOOPBACK');
    }
    return {
        required: Boolean(normalizedToken),
        token: normalizedToken,
    };
}

function authorizeBridgeRequest(request, auth) {
    if (!auth.required) {
        return true;
    }
    const header = String(request.headers.authorization || '').trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    return Boolean(match && safeTokenEquals(match[1], auth.token));
}

function isLoopbackHost(value) {
    const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host.startsWith('127.');
}

function safeTokenEquals(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeChatId(value) {
    return String(value || '').replace(/\\/g, '/').split('/').pop().replace(/\.jsonl$/i, '').trim();
}

function normalizeAvatar(value) {
    return String(value || '').trim().toLowerCase().replace(/\\/g, '/').split('/').pop();
}

function avatarsMatch(left, right) {
    return left === right || left.replace(/\.[^.]+$/, '') === right.replace(/\.[^.]+$/, '');
}

function sanitizeReference(value, maxLength = 240) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, maxLength);
}

function normalizeWorldBookRefs(values) {
    return uniqueArray((Array.isArray(values) ? values : [])
        .map((value) => sanitizeReference(value, 240))
        .filter(Boolean));
}

function uniqueArray(values) {
    return [...new Set(values)];
}

function deniedEvidence(evidence) {
    return {
        ...evidence,
        decision: 'denied',
    };
}

function stableReferenceHash(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 24)}`;
}

function sha256Short(value) {
    return createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function clampTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_TIMEOUT_MS;
    }
    return Math.min(Math.max(parsed, 10000), 600000);
}

function clampStopTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 15000;
    }
    return Math.min(Math.max(parsed, 10), 60000);
}

function parseRetryDelays(value, fallback = DEFAULT_PROVIDER_RETRY_DELAYS_MS) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(',');
    const parsed = source
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .map((item) => Math.min(item, 30000));
    return parsed.length ? parsed.slice(0, 5) : fallback.slice();
}

function isRetryableOriginalProviderError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details?.errorMessage,
        error?.details?.runtimeState?.errorMessage,
    ].map((value) => String(value || '')).join(' ');
    if (/ORIGINAL_TARGET_CHAT|BRIDGE_|WORLD_INFO_MISMATCH|CHARACTER_NOT_FOUND|PROOF|BINDING/i.test(text)) {
        return false;
    }
    return /Got[_ ]response[_ ]status[_ ](429|500|502|503|504)|HTTP[_ ]?(429|500|502|503|504)|ECONNRESET|ETIMEDOUT|ENOTFOUND|UND_ERR|socket|network|fetch failed/i.test(text);
}

function sanitizeErrorCode(error) {
    return redactSensitive(String(error?.code || error?.message || error || 'ORIGINAL_RUNTIME_BRIDGE_FAILED'))
        .replace(/[^A-Z0-9_:-]+/gi, '_')
        .slice(0, 120);
}

function sanitizeLogError(error) {
    return {
        code: sanitizeErrorCode(error),
        message: redactSensitive(String(error?.message || error || '')),
        details: sanitizeDiagnostics(error?.details),
    };
}

function sanitizeDiagnostics(value) {
    if (!value || typeof value !== 'object') {
        return value === undefined ? undefined : redactSensitive(String(value));
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeDiagnostics);
    }
    const safe = {};
    for (const [key, item] of Object.entries(value)) {
        if (/authorization|token|secret|api[-_]?key|password/i.test(key)) {
            safe[key] = '[redacted]';
        } else if (typeof item === 'object' && item !== null) {
            safe[key] = sanitizeDiagnostics(item);
        } else {
            safe[key] = redactSensitive(String(item));
        }
    }
    return safe;
}

function redactSensitive(value) {
    return String(value || '')
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
        .replace(/(token|secret|api[-_]?key|authorization)[=:]\s*[^,\s]+/gi, '$1=[redacted]');
}

async function connectBrowser(port) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        try {
            const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
            return createCdpClient(version.webSocketDebuggerUrl);
        } catch {
            await delay(100);
        }
    }
    throw new Error('CHROME_DEBUGGING_ENDPOINT_UNAVAILABLE');
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
    throw new Error('CHROME_NOT_FOUND');
}

async function getFreePort(start) {
    for (let port = start; port < start + 100; port += 1) {
        if (await canListen(port)) {
            return port;
        }
    }
    throw new Error('NO_FREE_DEBUG_PORT');
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

function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function createDeferred() {
    let settled = false;
    let resolve;
    let reject;
    const promise = new Promise((innerResolve, innerReject) => {
        resolve = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            innerResolve(value);
        };
        reject = (error) => {
            if (settled) {
                return;
            }
            settled = true;
            innerReject(error);
        };
    });
    return {
        promise,
        resolve,
        reject,
    };
}

function createBridgeError(code, details = {}) {
    const error = new Error(code);
    error.code = code;
    error.details = details;
    return error;
}

function withTimeout(promise, timeoutMs, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(label)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const port = Number(process.env.PORT || process.env.GALGAME_ORIGINAL_RUNTIME_BRIDGE_PORT || DEFAULT_PORT);
    const host = process.env.HOST || '127.0.0.1';
    const server = createOriginalRuntimeBridgeServer();
    const shutdown = () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    server.listen(port, host, () => {
        console.log(JSON.stringify({
            ok: true,
            service: 'original-runtime-bridge',
            url: `http://${host}:${port}`,
        }));
    });
}
