import assert from 'node:assert/strict';
import { DEMO_ACTIVE_RELEASE, DEMO_SCENARIO } from '../src/demo-scenario.js';
import {
    SILLYTAVERN_CHAT_ENDPOINTS,
    SILLYTAVERN_ENDPOINTS,
    OriginalRuntimeBridgeClient,
    SillyTavernAdapter,
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
    createVisualNovelDisplaySegments,
    extractSuggestedActionsFromOriginalText,
    formatVisualNovelDisplayText,
} from '../src/sillytavern-adapter.js';

const forbiddenEndpointValues = [
    ...Object.values(SILLYTAVERN_ENDPOINTS),
    ...Object.values(SILLYTAVERN_CHAT_ENDPOINTS),
].filter((endpoint) => (
    endpoint.includes('/generate')
    || endpoint.includes('/characters/get')
    || endpoint.includes('/worldinfo/get')
));
assert.deepEqual(forbiddenEndpointValues, []);

const calls = [];
const boundCharacter = DEMO_SCENARIO.sillyTavernBindings.characters[0];
const boundWorldBook = DEMO_SCENARIO.sillyTavernBindings.worldBooks[0];
const boundChatSeedId = DEMO_SCENARIO.sillyTavernBindings.chatSeedId;
const bridgeProof = {
    protocolVersion: 'galgame.original-runtime-bridge-proof.v1',
    audience: 'original-runtime-bridge',
    issuedAt: '2026-07-24T15:00:00.000Z',
    expiresAt: '2026-07-24T15:05:00.000Z',
    nonce: 'adapter-test-proof',
    binding: {
        release: {
            releaseId: DEMO_ACTIVE_RELEASE.releaseId,
            scenarioId: DEMO_ACTIVE_RELEASE.scenarioId,
            scenarioVersion: DEMO_ACTIVE_RELEASE.scenarioVersion,
            arcId: DEMO_ACTIVE_RELEASE.activeArcId,
        },
        target: {
            type: 'character',
            characterId: boundCharacter.id,
            avatar: boundCharacter.avatar,
        },
        chat: {
            chatId: 'galgame-active-test-chat',
            chatSeedId: boundChatSeedId,
            allowedChatIds: ['galgame-active-test-chat'],
        },
    },
    bindingHash: 'sha256:adapter-test',
    signature: 'adapter-test-signature',
};
let savedChat = null;
let savedBody = null;
const fakeFetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/csrf-token')) {
        return jsonResponse({ token: 'csrf_test' });
    }
    if (url.endsWith('/api/ping')) {
        return new Response(null, { status: 204 });
    }
    if (url.endsWith('/api/characters/all')) {
        return jsonResponse([{ name: boundCharacter.id, avatar: boundCharacter.avatar }]);
    }
    if (url.endsWith('/api/worldinfo/list')) {
        return jsonResponse([{ name: boundWorldBook.name, file_id: boundWorldBook.name }]);
    }
    if (url.endsWith('/api/settings/get')) {
        return jsonResponse({
            openai_setting_names: ['Default', DEMO_SCENARIO.sillyTavernBindings.presetId].filter(Boolean),
            textgenerationwebui_preset_names: ['Neutral'],
            koboldai_setting_names: ['Default'],
            novelai_setting_names: [],
            instruct: [{ name: DEMO_SCENARIO.sillyTavernBindings.instructPresetId || 'Alpaca' }],
            sysprompt: [{ name: DEMO_SCENARIO.sillyTavernBindings.systemPromptId || 'Neutral - Chat' }],
            context: [{ name: DEMO_SCENARIO.sillyTavernBindings.contextPresetId || 'Default' }],
        });
    }
    if (url.endsWith('/api/characters/chats')) {
        const body = JSON.parse(options.body || '{}');
        if (body.avatar_url !== boundCharacter.avatar) {
            return jsonResponse({ error: true });
        }
        return jsonResponse([{
            file_id: boundChatSeedId,
            file_name: `${boundChatSeedId}.jsonl`,
            chat_items: 1,
            last_mes: '2026-07-24T14:00:00.000Z',
            mes: '雨音在窗外轻轻落下。',
        }]);
    }
    if (url.endsWith('/api/chats/get')) {
        return jsonResponse([
            {
                chat_metadata: {},
                user_name: 'Sam',
                character_name: boundCharacter.id,
            },
            {
                name: '青井',
                is_user: false,
                is_system: false,
                send_date: '2026-07-24T14:00:00.000Z',
                mes: '雨音在窗外轻轻落下。',
                extra: {},
            },
        ]);
    }
    if (url.endsWith('/api/chats/save')) {
        savedBody = JSON.parse(options.body);
        savedChat = savedBody.chat;
        return jsonResponse({ ok: true });
    }
    if (url.endsWith('/health')) {
        if (url.startsWith('http://127.0.0.1:8794')) {
            return jsonResponse({ ok: false }, 503);
        }
        if (url.startsWith('http://127.0.0.1:8799')) {
            return jsonResponse({
                ok: true,
                mode: 'sillytavern-original-runtime-bridge',
                browser: true,
                pending: false,
                authRequired: false,
                stopping: false,
            });
        }
        return jsonResponse({
            ok: true,
            mode: 'sillytavern-original-runtime-bridge',
            browser: false,
            pending: false,
            authRequired: false,
            stopping: false,
        });
    }
    if (url.endsWith('/v1/generate-reply')) {
        const body = JSON.parse(options.body || '{}');
        assert.equal(body.protocolVersion, 'galgame.original-runtime-bridge-request.v1');
        assert.equal(body.releaseId, DEMO_ACTIVE_RELEASE.releaseId);
        assert.equal(body.scenarioId, DEMO_ACTIVE_RELEASE.scenarioId);
        assert.equal(body.scenarioVersion, DEMO_ACTIVE_RELEASE.scenarioVersion);
        assert.equal(body.arcId, DEMO_ACTIVE_RELEASE.activeArcId);
        assert.equal(body.character.avatar, boundCharacter.avatar);
        assert.equal(body.chatId, 'galgame-active-test-chat');
        assert.deepEqual(body.bridgeProof, bridgeProof);
        assert.equal(body.sillyTavernBaseUrl, 'http://127.0.0.1:8001');
        assert.equal(JSON.stringify(body).includes('/api/backends/'), false);
        assert.equal(JSON.stringify(body).includes('personality'), false);
        assert.equal(JSON.stringify(body).includes('character_book'), false);
        return jsonResponse({
            ok: true,
            chatId: body.chatId,
            generatedText: '雨声停了一瞬，她终于开口。',
            rawChat: [
                {
                    chat_metadata: {},
                    user_name: 'Sam',
                    character_name: boundCharacter.id,
                },
                {
                    name: 'Sam',
                    is_user: true,
                    is_system: false,
                    send_date: '2026-07-24T15:00:00.000Z',
                    mes: '你好，我来了',
                    extra: {},
                },
                {
                    name: '青井',
                    is_user: false,
                    is_system: false,
                    send_date: '2026-07-24T15:01:00.000Z',
                    mes: '雨声停了一瞬，她终于开口。',
                    extra: {},
                },
            ],
        });
    }
    return jsonResponse({ error: 'unexpected endpoint' }, 404);
};

const client = new SillyTavernHttpClient({ fetchImpl: fakeFetch });
await client.requestJson('/api/ping', { method: 'POST', body: {} });
assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf_test');

const adapter = new SillyTavernAdapter({ fetchImpl: fakeFetch });
assert.equal(typeof adapter.continueSession, 'undefined');
assert.equal(typeof adapter.resolveProfile, 'undefined');
assert.equal(typeof adapter.startSession, 'undefined');
assert.equal((await adapter.healthCheck()).ok, true);
assert.equal((await adapter.listCharacters())[0].name, boundCharacter.id);
assert.equal((await adapter.listWorldBooks())[0].file_id, boundWorldBook.name);

const resourceDiagnostic = await adapter.diagnoseOriginalResourceAvailability(DEMO_SCENARIO);
assert.equal(resourceDiagnostic.referenceOnly, true);
assert.equal(resourceDiagnostic.readonly, true);
assert.equal(resourceDiagnostic.ok, true);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'character-references').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'worldbook-references').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'generation-preset-reference').details.missing.length, 0);
assert.equal(resourceDiagnostic.checks.find((check) => check.name === 'chat-seed-reference').details.missing.length, 0);

const missingDiagnostic = await adapter.diagnoseOriginalResourceAvailability({
    ...DEMO_SCENARIO,
    arcs: undefined,
    defaultArcId: undefined,
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [{ id: 'Missing', avatar: 'missing.png', role: 'main' }],
        worldBooks: [{ name: 'MissingWorld', mode: 'scene', weight: 100 }],
        presetId: 'MissingPreset',
        instructPresetId: 'MissingInstruct',
        systemPromptId: 'MissingSystem',
        contextPresetId: 'MissingContext',
    },
});
assert.equal(missingDiagnostic.ok, false);
const missingReferences = missingDiagnostic.checks.flatMap((check) => check.details?.missing || []);
assert.deepEqual(
    missingReferences.sort(),
    ['MissingContext', 'MissingInstruct', 'MissingPreset', 'MissingSystem', 'MissingWorld', boundChatSeedId, 'missing.png'].sort(),
);

const chatBridge = new SillyTavernOriginalChatBridge({
    fetchImpl: fakeFetch,
    now: () => new Date('2026-07-24T15:00:00.000Z'),
});
assert.equal(typeof chatBridge.continueSession, 'undefined');
assert.equal(typeof chatBridge.generate, 'undefined');
assert.equal((await chatBridge.healthCheck()).ok, true);
const chatSnapshot = await chatBridge.loadOpeningChat(DEMO_SCENARIO);
assert.equal(chatSnapshot.ok, true);
assert.equal(chatSnapshot.generationBridge, false);
assert.equal(chatSnapshot.fileName, boundChatSeedId);
assert.equal(chatSnapshot.isSeed, true);
assert.equal(chatSnapshot.messages.length, 1);
assert.equal(chatSnapshot.messages[0].speaker, '青井');
assert.equal(chatSnapshot.messages[0].text, '雨音在窗外轻轻落下。');
const savedSnapshot = await chatBridge.appendUserMessageToChat(DEMO_SCENARIO, chatSnapshot, '窗边有什么声音？');
assert.equal(savedSnapshot.messages.at(-1).role, 'player');
assert.equal(savedSnapshot.isSeed, false);
assert.notEqual(savedBody.file_name, boundChatSeedId);
assert.equal(savedChat.at(-1).mes, '窗边有什么声音？');
assert.equal(savedChat.at(-1).name, 'Sam');

const specificSnapshot = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, 'galgame-active-test-chat');
assert.equal(specificSnapshot.ok, true);
assert.equal(specificSnapshot.fileName, 'galgame-active-test-chat');
assert.equal(specificSnapshot.isSeed, false);

const specificSeedSnapshot = await chatBridge.loadSpecificBoundChat(DEMO_SCENARIO, boundChatSeedId);
assert.equal(specificSeedSnapshot.ok, true);
assert.equal(specificSeedSnapshot.fileName, boundChatSeedId);
assert.equal(specificSeedSnapshot.isSeed, true);

const runtimeBridge = new OriginalRuntimeBridgeClient({
    baseUrl: 'http://127.0.0.1:8795',
    sillyTavernBaseUrl: 'http://127.0.0.1:8001',
    fetchImpl: fakeFetch,
});
assert.equal(runtimeBridge.isConfigured(), true);
assert.equal((await runtimeBridge.healthCheck()).ok, true);
const generatedSnapshot = await runtimeBridge.generateReply({
    manifest: DEMO_SCENARIO,
    release: {
        ...DEMO_ACTIVE_RELEASE,
    },
    snapshot: {
        ...savedSnapshot,
        fileName: 'galgame-active-test-chat',
    },
    bridgeProof,
});
assert.equal(generatedSnapshot.generationBridge, true);
assert.equal(generatedSnapshot.fileName, 'galgame-active-test-chat');
assert.equal(generatedSnapshot.messages.at(-1).role, 'character');
assert.equal(generatedSnapshot.messages.at(-1).text, '雨声停了一瞬，她终于开口。');

const discoveredRuntimeBridge = new OriginalRuntimeBridgeClient({
    sillyTavernBaseUrl: 'http://127.0.0.1:8000',
    fetchImpl: fakeFetch,
});
assert.equal(discoveredRuntimeBridge.isConfigured(), false);
const discoveredUrl = await discoveredRuntimeBridge.discoverBaseUrl([
    'http://127.0.0.1:8794',
    'http://127.0.0.1:8795',
    'http://127.0.0.1:8799',
]);
assert.equal(discoveredUrl, 'http://127.0.0.1:8799');
assert.equal(discoveredRuntimeBridge.isConfigured(), true);

const headedActions = extractSuggestedActionsFromOriginalText([
    '青井把伞往你这边递近了一点。',
    '可选行动：',
    '1. 接过伞，向她道谢',
    '2. 问她为什么在这里等你',
    '3. 和她一起走向旧车站',
].join('\n'));
assert.equal(headedActions.displayText, '青井把伞往你这边递近了一点。');
assert.deepEqual(
    headedActions.suggestedActions.map((action) => action.label),
    ['接过伞，向她道谢', '问她为什么在这里等你', '和她一起走向旧车站'],
);

const trailingActions = extractSuggestedActionsFromOriginalText([
    '雨声停了一瞬，她终于开口。',
    'A. 回答“你好，我来了”',
    'B. 先观察站台四周',
].join('\n'));
assert.deepEqual(
    trailingActions.suggestedActions.map((action) => action.value),
    ['回答“你好，我来了”', '先观察站台四周'],
);

const actionsBeforeStatusBlock = extractSuggestedActionsFromOriginalText([
    '战斗正式开始。现在轮到你行动。',
    '',
    '可选行动：',
    '1. 冲向路中央的 Gribble，用巨剑攻击',
    '2. 绕向左侧树根，逼近哥布林弓手',
    '3. 攻击右侧陷阱哥布林',
    '',
    '```',
    '❤ HP: 12/12',
    '⛨ AC: 15',
    '📃 Status: Healthy; alert to ambush',
    '```',
].join('\n'));
assert.deepEqual(
    actionsBeforeStatusBlock.suggestedActions.map((action) => action.label),
    ['冲向路中央的 Gribble，用巨剑攻击', '绕向左侧树根，逼近哥布林弓手', '攻击右侧陷阱哥布林'],
);
assert.equal(actionsBeforeStatusBlock.displayText.includes('可选行动'), false);
assert.equal(actionsBeforeStatusBlock.displayText.includes('❤ HP: 12/12'), true);

const nonChoiceNumberedLine = extractSuggestedActionsFromOriginalText('第一章\n1. 雨落在旧车站的屋檐上。');
assert.equal(nonChoiceNumberedLine.suggestedActions.length, 0);

const roleplayMarkdownText = '*Andrei 没有转身。窗外的 Los Angeles 在雨里缩成一片锈色，街灯把水洼照得像破开的伤口。玻璃上映出他的轮廓，直立，静止，像房间原本就围着他建成。入口处的三名男人仍没有换脚。* *—Andrei 望着窗外。* “你愿以何物偿付？” *声音不高。公寓里的冷却系统停了一拍，随后重新吐出干冷的风。Anna 的手指从腹部滑到外套拉链上。*';
const formattedRoleplayText = formatVisualNovelDisplayText(roleplayMarkdownText);
assert.equal(formattedRoleplayText.includes('*'), false);
assert.equal(formattedRoleplayText.includes('Andrei 没有转身。'), true);
assert.equal(formattedRoleplayText.includes('“你愿以何物偿付？”'), true);
assert.equal(formattedRoleplayText.includes('声音不高。'), true);
assert.equal(formattedRoleplayText.includes('\n\n—Andrei 望着窗外。'), true);
assert.equal(formattedRoleplayText.includes('“你愿以何物偿付？”\n\n声音不高。'), true);

const hiddenInstructionDisplayText = formatVisualNovelDisplayText([
    '<!-- 冒险者 is a human fighter - refer to character_sheet_warrior. -->',
    '<thinking>Roll a secret die and keep the plan hidden.</thinking>',
    '```thinking',
    'Do not show this tactical scratchpad.',
    '```',
    '*树丛忽然晃动。* “把剑握稳。”',
].join('\n'));
assert.equal(hiddenInstructionDisplayText.includes('character_sheet_warrior'), false);
assert.equal(hiddenInstructionDisplayText.includes('secret die'), false);
assert.equal(hiddenInstructionDisplayText.includes('scratchpad'), false);
assert.equal(hiddenInstructionDisplayText.includes('树丛忽然晃动。'), true);
assert.equal(hiddenInstructionDisplayText.includes('“把剑握稳。”'), true);

const singleLineThinkingMarkerText = formatVisualNovelDisplayText('``` [thinking] ``` 你用气若游丝的声音命令尼布：“放囚犯……制造混乱……逃。”');
assert.equal(singleLineThinkingMarkerText.includes('thinking'), false);
assert.equal(singleLineThinkingMarkerText.startsWith('你用气若游丝的声音'), true);

const visibleStatusBlockText = formatVisualNovelDisplayText([
    '```',
    '❤ HP: 12/12',
    '⛨ AC: 15',
    '📃 Status: Healthy',
    '```',
].join('\n'));
assert.equal(visibleStatusBlockText.includes('```'), false);
assert.equal(visibleStatusBlockText.includes('❤ HP: 12/12'), true);
assert.equal(visibleStatusBlockText.includes('📃 Status: Healthy'), true);

const displaySegments = createVisualNovelDisplaySegments(roleplayMarkdownText, {
    fallbackSpeaker: 'WorldDirector',
    role: 'character',
});
assert.deepEqual(
    displaySegments.map((segment) => segment.type),
    ['narration', 'narration', 'stage', 'dialogue', 'narration'],
);
assert.equal(displaySegments[2].speaker, 'Andrei');
assert.equal(displaySegments[3].speaker, 'Andrei');
assert.equal(displaySegments[3].text, '“你愿以何物偿付？”');

const thinkingMarkerSegments = createVisualNovelDisplaySegments('``` [thinking] ``` 你用气若游丝的声音命令尼布：“放囚犯……制造混乱……逃。”', {
    fallbackSpeaker: 'Dungeon Master',
    role: 'character',
});
assert.equal(thinkingMarkerSegments[0].text.startsWith('你用气若游丝的声音'), true);
assert.equal(thinkingMarkerSegments[0].text.includes('[thinking]'), false);

const namedDialogueSegments = createVisualNovelDisplaySegments('Anna: 我会留下。', {
    fallbackSpeaker: 'WorldDirector',
});
assert.equal(namedDialogueSegments[0].type, 'dialogue');
assert.equal(namedDialogueSegments[0].speaker, 'Anna');
assert.equal(namedDialogueSegments[0].text, '我会留下。');

const forbiddenCalls = calls.filter((call) => (
    call.url.includes('/api/backends/')
    || call.url.endsWith('/api/characters/get')
    || call.url.endsWith('/api/worldinfo/get')
));
assert.deepEqual(forbiddenCalls, []);

console.log('sillytavern adapter and original chat bridge tests passed');

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json',
        },
    });
}
