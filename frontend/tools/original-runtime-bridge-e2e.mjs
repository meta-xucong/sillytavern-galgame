import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    BrowserOriginalRuntimeBridge,
    createOriginalRuntimeBridgeServer,
} from '../../external-modules/original-runtime-bridge/server.mjs';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sillyTavernBaseUrl = normalizeBaseUrl(args['base-url'] || 'http://127.0.0.1:8001');
const bridgePort = Number(args['bridge-port'] || 0);
const timeoutMs = Number(args.timeout || 240000);
const cookieFetch = createCookieFetch();
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
    now: () => new Date(),
});
const client = new SillyTavernHttpClient({
    baseUrl: sillyTavernBaseUrl,
    fetchImpl: cookieFetch,
});
const server = createOriginalRuntimeBridgeServer({
    runtime: new BrowserOriginalRuntimeBridge({
        userDataDir: path.join(repoRoot, '.codex-longrun', `original-runtime-bridge-e2e-${process.pid}-${Date.now()}`),
    }),
    sillyTavernBaseUrl,
    allowedOrigins: ['http://127.0.0.1:8001', 'http://localhost:8001'],
});

await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(bridgePort, '127.0.0.1', resolve);
});

let tempFileName = '';
try {
    const address = server.address();
    const bridgeBaseUrl = `http://127.0.0.1:${address.port}`;
    const opening = await chatBridge.loadOpeningChat(DEMO_SCENARIO);
    assert.equal(opening.ok, true, 'opening chat must load');

    const testMessage = `桥接测试：我留在当前场景里，等对方继续说下去。${Date.now().toString(36)}`;
    const pending = await chatBridge.appendUserMessageToChat(DEMO_SCENARIO, opening, testMessage);
    tempFileName = pending.fileName;
    assert.equal(pending.messages.at(-1).role, 'player', 'temporary chat must end with player message');
    const targetBefore = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, tempFileName);
    assert.equal(targetBefore.messages.at(-1)?.text, testMessage, 'target chat must contain the test player message before generation');
    const nonTargetChatsBefore = mapNonTargetChats(await chatBridge.listCharacterChats(pending.character), tempFileName);

    const bridgeResponse = await fetch(`${bridgeBaseUrl}/v1/generate-reply`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:8001',
        },
        body: JSON.stringify({
            sillyTavernBaseUrl,
            character: pending.character,
            chatId: pending.fileName,
            timeoutMs,
        }),
    });
    const result = await bridgeResponse.json();
    assert.equal(bridgeResponse.ok, true, JSON.stringify(result));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.chatId, pending.fileName);
    assert.equal(result.rawChat.at(-1)?.is_user, false, 'latest original chat message must be character reply');
    assert.ok(String(result.generatedText || result.rawChat.at(-1)?.mes || '').trim().length > 0, 'generated reply must not be empty');
    const targetAfter = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, tempFileName);
    assert.equal(targetAfter.messages.at(-1)?.role, 'character', 'target chat readback must end with character reply');
    assert.ok(!targetAfter.messages.at(-1)?.text.includes(testMessage), 'target chat latest reply must not be the player test message');
    const nonTargetChanges = diffNonTargetChats(nonTargetChatsBefore, await chatBridge.listCharacterChats(pending.character), tempFileName);
    assert.deepEqual(nonTargetChanges, [], `non-target chats must not change: ${JSON.stringify(nonTargetChanges)}`);

    console.log(JSON.stringify({
        ok: true,
        bridgeBaseUrl,
        tempFileName,
        latestSpeaker: result.rawChat.at(-1)?.name || '',
        latestPreview: String(result.generatedText || result.rawChat.at(-1)?.mes || '').slice(0, 180),
        elapsedMs: result.elapsedMs,
        diagnostics: result.diagnostics,
    }, null, 2));
} finally {
    if (tempFileName) {
        await client.requestJson('/api/chats/delete', {
            method: 'POST',
            body: {
                avatar_url: DEMO_SCENARIO.sillyTavernBindings.characters[0].avatar,
                chatfile: tempFileName,
            },
            allowErrorObject: true,
        }).catch(() => {});
    }
    await new Promise((resolve) => server.close(resolve));
}

function createCookieFetch() {
    let cookie = '';
    return async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (cookie && !headers.has('cookie')) {
            headers.set('cookie', cookie);
        }
        const response = await fetch(url, {
            ...options,
            headers,
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            cookie = setCookie.split(',').map((item) => item.split(';')[0]).join('; ');
        }
        return response;
    };
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

function mapNonTargetChats(chats, targetFileName) {
    const target = normalizeChatFileId(targetFileName);
    return new Map(chats
        .filter((chat) => normalizeChatFileId(chat.fileId) !== target)
        .map((chat) => [normalizeChatFileId(chat.fileId), {
            messageCount: chat.messageCount,
            lastMessageAt: chat.lastMessageAt,
            preview: chat.preview,
        }]));
}

function diffNonTargetChats(before, afterChats, targetFileName) {
    const target = normalizeChatFileId(targetFileName);
    const changes = [];
    for (const chat of afterChats) {
        const fileId = normalizeChatFileId(chat.fileId);
        if (!fileId || fileId === target) {
            continue;
        }
        const previous = before.get(fileId);
        if (!previous) {
            changes.push({ fileId, change: 'created' });
            continue;
        }
        if (
            previous.messageCount !== chat.messageCount
            || previous.lastMessageAt !== chat.lastMessageAt
            || previous.preview !== chat.preview
        ) {
            changes.push({
                fileId,
                before: previous,
                after: {
                    messageCount: chat.messageCount,
                    lastMessageAt: chat.lastMessageAt,
                    preview: chat.preview,
                },
            });
        }
    }
    return changes;
}

function normalizeChatFileId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}
