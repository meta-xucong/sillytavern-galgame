import assert from 'node:assert/strict';

import { DEMO_ACTIVE_RELEASE, DEMO_SCENARIO } from '../../shared/src/demo-scenario.js';
import { createPlayerSaveSlot, playerSaveKey } from '../../shared/src/player-save.js';

globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;
globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ = true;
globalThis.indexedDB = undefined;

class MemoryStorage {
    constructor() {
        this.values = new Map();
    }

    get length() {
        return this.values.size;
    }

    key(index) {
        return [...this.values.keys()][index] || null;
    }

    getItem(key) {
        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        this.values.set(String(key), String(value));
    }

    removeItem(key) {
        this.values.delete(String(key));
    }
}

globalThis.localStorage = new MemoryStorage();
globalThis.window = {
    location: {
        origin: 'http://127.0.0.1:8001',
        hostname: '127.0.0.1',
    },
    setTimeout,
    clearTimeout,
    confirm: () => true,
};

const noop = () => {};
const elements = new Map();
const chatSeedId = DEMO_SCENARIO.sillyTavernBindings.chatSeedId;
const historicalChatId = 'galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260726092140';
const staleBranchChatId = 'galgame-galgame-imported-dungeon-master-entry-dungeon-master-fighter-campaign-Dungeon_Master-20260929122410';
let chatMode = 'with-history';
const chatCalls = [];

for (const selector of [
    '#titleBackdrop', '.title-heroine', '#gameScreen', '#titleScreen', '#stageBackdrop', '.stage-heroine',
    '#visualPresentation', '#visualIconStrip', '#visualStatus', '#gameTitle', '#stageTitle', '#releaseNote',
    '#storyPicker', '#storyPickerStatus', '#storyChoiceList', '#adaptivePanels', '#dialogueBox', '#speakerName',
    '#dialogueText', '#stageStatus', '#suggestedActions', '#playerInputForm', '#playerInput', '#sendButton',
    '#recoveryActions', '#refreshStoryButton', '#startButton', '#continueButton', '#loadButtonTitle',
    '#settingsButtonTitle', '#historyButton', '#saveButton', '#loadButtonStage', '#settingsButtonStage',
    '#backButton', '#drawerBackdrop', '#historyDrawer', '#historyList', '#saveLoadDrawer', '#saveLoadTitle',
    '#saveLoadList', '#settingsDrawer', '#adaptiveDetailDrawer', '#adaptiveDetailTitle', '#adaptiveDetailBody',
    '#adaptiveDetailClose', '#fontSizeButton', '#motionButton', '#toast',
]) {
    elements.set(selector, createStubElement());
}

globalThis.document = {
    cookie: '',
    documentElement: createStubElement('html'),
    activeElement: null,
    querySelector: (selector) => {
        if (String(selector).startsWith('meta[')) {
            if (String(selector).includes('galgame-sillytavern-base')) {
                return { content: 'http://127.0.0.1:8001', getAttribute: () => 'http://127.0.0.1:8001' };
            }
            return null;
        }
        if (!elements.has(selector)) {
            elements.set(selector, createStubElement());
        }
        return elements.get(selector);
    },
    querySelectorAll: () => [],
    createElement: (tagName) => createStubElement(tagName),
    addEventListener: noop,
    body: { classList: { add: noop, remove: noop } },
};
globalThis.Element = Object;
globalThis.HTMLElement = Object;

globalThis.fetch = async (url, options = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith('/csrf-token')) {
        return jsonResponse({ token: 'test-csrf' });
    }
    if (stringUrl.endsWith('/api/characters/chats')) {
        chatCalls.push({ type: 'list', url: stringUrl });
        return jsonResponse(chatMode === 'with-history'
            ? [
                {
                    file_id: chatSeedId,
                    file_name: `${chatSeedId}.jsonl`,
                    chat_items: 1,
                    last_mes: '2026-07-26T09:20:00.000Z',
                },
                {
                    file_id: historicalChatId,
                    file_name: `${historicalChatId}.jsonl`,
                    chat_items: 184,
                    last_mes: '2026-07-26T09:21:40.000Z',
                },
                {
                    file_id: staleBranchChatId,
                    file_name: `${staleBranchChatId}.jsonl`,
                    chat_items: 2,
                    last_mes: '2026-07-26T09:21:00.000Z',
                },
            ]
            : [{
                file_id: chatSeedId,
                file_name: `${chatSeedId}.jsonl`,
                chat_items: 1,
                last_mes: '2026-07-26T09:20:00.000Z',
            }]);
    }
    if (stringUrl.endsWith('/api/chats/get')) {
        const body = JSON.parse(options.body || '{}');
        const fileName = String(body.file_name || '').replace(/\.jsonl$/i, '');
        chatCalls.push({ type: 'get', fileName });
        return jsonResponse(fileName === historicalChatId ? historicalRawChat() : seedRawChat());
    }
    throw new Error(`unexpected fetch ${stringUrl}`);
};

const playerModule = await import('../src/main.js');
assert.equal(typeof playerModule, 'object');
globalThis.__GALGAME_TEST_SET_MANIFEST__(DEMO_SCENARIO, {
    release: DEMO_ACTIVE_RELEASE,
    render: false,
});

const seedSnapshot = snapshotFromRawChat(seedRawChat(), chatSeedId, true);
const historicalSnapshot = snapshotFromRawChat(historicalRawChat(), historicalChatId, false);

localStorage.removeItem(playerSaveKey('auto'));
chatMode = 'with-history';
await globalThis.__GALGAME_TEST_START__();
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, chatSeedId);
assert.equal(chatCalls.at(-1).fileName, chatSeedId);

localStorage.setItem(playerSaveKey('auto'), JSON.stringify(createPlayerSaveSlot({
    saveId: 'auto',
    release: DEMO_ACTIVE_RELEASE,
    manifest: DEMO_SCENARIO,
    snapshot: seedSnapshot,
})));
chatCalls.length = 0;
await globalThis.__GALGAME_TEST_CONTINUE__();
assert.equal(chatCalls.filter((call) => call.type === 'list').length, 1);
assert.equal(chatCalls.filter((call) => call.type === 'get' && call.fileName === historicalChatId).length, 1);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, historicalChatId);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().messages.length, historicalSnapshot.messages.length);
assert.equal(JSON.parse(localStorage.getItem(playerSaveKey('auto'))).chatId, historicalChatId);

localStorage.setItem(playerSaveKey('auto'), JSON.stringify(createPlayerSaveSlot({
    saveId: 'auto',
    release: DEMO_ACTIVE_RELEASE,
    manifest: DEMO_SCENARIO,
    snapshot: {
        ...seedSnapshot,
        fileName: staleBranchChatId,
        messages: seedSnapshot.messages.slice(0, 1),
    },
})));
chatCalls.length = 0;
await globalThis.__GALGAME_TEST_CONTINUE__();
assert.equal(chatCalls.filter((call) => call.type === 'get' && call.fileName === historicalChatId).length, 1);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, historicalChatId);
assert.equal(JSON.parse(localStorage.getItem(playerSaveKey('auto'))).chatId, historicalChatId);

chatMode = 'seed-only';
localStorage.setItem(playerSaveKey('auto'), JSON.stringify(createPlayerSaveSlot({
    saveId: 'auto',
    release: DEMO_ACTIVE_RELEASE,
    manifest: DEMO_SCENARIO,
    snapshot: seedSnapshot,
})));
chatCalls.length = 0;
await globalThis.__GALGAME_TEST_CONTINUE__();
assert.equal(chatCalls.filter((call) => call.type === 'list').length, 1);
assert.equal(chatCalls.filter((call) => call.type === 'get' && call.fileName === chatSeedId).length, 2);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, chatSeedId);

const manualSnapshot = snapshotFromRawChat(historicalRawChat(), historicalChatId, false);
localStorage.setItem(playerSaveKey('manual-1'), JSON.stringify(createPlayerSaveSlot({
    saveId: 'manual-1',
    release: DEMO_ACTIVE_RELEASE,
    manifest: DEMO_SCENARIO,
    snapshot: manualSnapshot,
})));
const listCountBeforeManualLoad = chatCalls.filter((call) => call.type === 'list').length;
const getCountBeforeManualLoad = chatCalls.filter((call) => call.type === 'get').length;
await globalThis.__GALGAME_TEST_LOAD_SAVE__('manual-1');
assert.equal(chatCalls.filter((call) => call.type === 'list').length, listCountBeforeManualLoad);
assert.equal(chatCalls.filter((call) => call.type === 'get').length, getCountBeforeManualLoad + 1);
assert.equal(chatCalls.at(-1).fileName, historicalChatId);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, historicalChatId);

const staleRecoverySave = JSON.stringify(createPlayerSaveSlot({
    saveId: 'auto',
    release: DEMO_ACTIVE_RELEASE,
    manifest: DEMO_SCENARIO,
    snapshot: { ...historicalSnapshot, messages: historicalSnapshot.messages.slice(0, 1) },
}));
localStorage.setItem(playerSaveKey('auto'), staleRecoverySave);
globalThis.__GALGAME_TEST_SET_ACTIVE_CHAT__(null);
chatCalls.length = 0;
assert.equal(await globalThis.__GALGAME_TEST_RECOVER_CONTENT_AFTER_RESET__(), false);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__(), null);
assert.equal(chatCalls.length, 0);
assert.equal(localStorage.getItem(playerSaveKey('auto')), staleRecoverySave);

// An already-bound chat is re-read in place and reset leaves its auto-save untouched.
globalThis.__GALGAME_TEST_SET_ACTIVE_CHAT__({ ...historicalSnapshot, messages: historicalSnapshot.messages.slice(0, 1) });
chatCalls.length = 0;
assert.equal(await globalThis.__GALGAME_TEST_RECOVER_CONTENT_AFTER_RESET__(), true);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().fileName, historicalChatId);
assert.equal(globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__().messages.length, historicalSnapshot.messages.length);
assert.equal(chatCalls.filter((call) => call.type === 'get' && call.fileName === historicalChatId).length, 1);
assert.equal(chatCalls.some((call) => call.type === 'generate'), false);
assert.equal(localStorage.getItem(playerSaveKey('auto')), staleRecoverySave);

const connectionResetButton = document.querySelector('#connectionResetButton');
connectionResetButton.hidden = true;
globalThis.__GALGAME_TEST_RENDER_CONNECTION_HEALTH__({
    overall: 'up',
    services: {
        sillyTavern: { status: 'up', checkedAt: Date.now(), stale: false },
        configService: { status: 'up', checkedAt: Date.now(), stale: false },
        runtimeBridge: {
            status: 'pending', checkedAt: Date.now(), stale: false,
            details: { connectionState: 'generating', pending: true, stopping: false },
        },
        visualService: { status: 'up', checkedAt: Date.now(), stale: false },
        llm: { status: 'up', checkedAt: Date.now(), stale: false },
        generation: { status: 'pending', checkedAt: Date.now(), stale: false },
    },
});
assert.equal(connectionResetButton.hidden, false);
assert.match(document.querySelector('#connectionStatus').textContent, /运行桥 生成中/u);

console.log('chat history recovery player tests passed');

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function seedRawChat() {
    return [
        {
            chat_metadata: {},
            user_name: 'Player',
            character_name: 'Dungeon Master',
        },
        {
            name: 'Dungeon Master',
            is_user: false,
            is_system: false,
            send_date: '2026-07-26T09:20:00.000Z',
            mes: '战役从这里开始。',
            extra: {},
        },
    ];
}

function historicalRawChat() {
    return [
        {
            chat_metadata: {},
            user_name: 'Player',
            character_name: 'Dungeon Master',
        },
        {
            name: 'Dungeon Master',
            is_user: false,
            is_system: false,
            send_date: '2026-07-26T09:20:00.000Z',
            mes: '欢迎回来，冒险者。',
            extra: {},
        },
        {
            name: 'Player',
            is_user: true,
            is_system: false,
            send_date: '2026-07-26T09:21:00.000Z',
            mes: '我继续前进。',
            extra: {},
        },
        {
            name: 'Dungeon Master',
            is_user: false,
            is_system: false,
            send_date: '2026-07-26T09:21:40.000Z',
            mes: '前方的门缓缓打开。',
            extra: {},
        },
    ];
}

function snapshotFromRawChat(rawChat, fileName, isSeed) {
    const messages = rawChat.slice(1).map((message) => ({
        role: message.is_user ? 'player' : 'character',
        speaker: message.is_user ? '你' : message.name,
        text: message.mes,
        displayText: message.mes,
    }));
    return {
        ok: true,
        mode: 'sillytavern-original-chat-bridge',
        generationBridge: false,
        writable: true,
        empty: false,
        character: {
            id: 'Dungeon Master',
            avatar: 'galgame_imported_dungeon_master.png',
            role: 'narrator',
        },
        fileName,
        isSeed,
        rawChat,
        messages,
    };
}

function createStubElement(tagName = '') {
    const classes = new Set();
    const element = {
        hidden: false,
        disabled: false,
        textContent: '',
        value: '',
        type: '',
        className: '',
        tagName,
        dataset: {},
        style: { setProperty: noop, backgroundImage: '' },
        children: [],
        addEventListener: noop,
        querySelector: () => null,
        querySelectorAll: () => [],
        classList: {
            add: (...names) => names.forEach((name) => classes.add(name)),
            remove: (...names) => names.forEach((name) => classes.delete(name)),
            contains: (name) => classes.has(name),
            toggle: (name, force) => {
                const enabled = force === undefined ? !classes.has(name) : Boolean(force);
                if (enabled) classes.add(name);
                else classes.delete(name);
                return enabled;
            },
        },
        replaceChildren: (...children) => {
            element.children = children;
        },
        append: (...children) => {
            element.children.push(...children);
        },
        appendChild: (child) => {
            element.children.push(child);
            return child;
        },
        focus: noop,
        setAttribute: noop,
        removeAttribute: noop,
        contains: () => false,
        offsetParent: {},
    };
    return element;
}
