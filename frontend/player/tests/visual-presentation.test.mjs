import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;
globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ = true;
globalThis.window = {
    location: { origin: 'http://127.0.0.1:8001' },
    setTimeout,
    clearTimeout,
};
const noop = () => {};
const elements = new Map();
const stageBackdropElement = createStubElement();
const stageHeroineElement = createStubElement();
const visualIconStripElement = createStubElement();
const visualStatusElement = createStubElement();
const VISUAL_PLACEHOLDER_URL = './assets/visual-placeholder.svg';
let visualCoreServiceMeta = '';
let coreDecisionPaths = createValidCoreDecisionPaths();
elements.set('#stageBackdrop', stageBackdropElement);
elements.set('.stage-heroine', stageHeroineElement);
elements.set('#visualIconStrip', visualIconStripElement);
elements.set('#visualStatus', visualStatusElement);
globalThis.document = {
    cookie: 'galgame_player_csrf=must-not-be-used',
    querySelector: (selector) => {
        if (String(selector).startsWith('meta[')) {
            if (String(selector).includes('galgame-visual-core-service') && visualCoreServiceMeta) {
                return { getAttribute: () => visualCoreServiceMeta, content: visualCoreServiceMeta };
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

let fetchCalls = [];
let coreDecisionMode = 'ok';
globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url).includes('/v1/player/visual-bundle') || String(url).includes('/v1/player/visual-assets/')) {
        throw new Error('CORE visual path must not call player visual-bundle or asset tickets');
    }
    if (String(url).endsWith('/v1/core/visual-context')) {
        assert.equal(options.credentials, 'omit');
        assert.equal(options.headers.accept, 'application/json');
        return new Response(JSON.stringify(createCoreVisualContext()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/core/visual-decisions')) {
        const body = JSON.parse(options.body);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.headers['content-type'], 'application/json');
        assert.equal(body.visualProfile.catalogId, 'catalog_core_player');
        assert.equal(
            body.projection.entities.some((entity) => entity.visibleAttributes.some((attribute) => attribute.code === 'character-explicit-appearance')),
            body.visibleContext.current.text.includes('角色:'),
        );
        if (coreDecisionMode === 'disabled') {
            return new Response(JSON.stringify({
                ok: false,
                schemaVersion: 'galgame.visual-core-visual-decisions-response.v2',
                requestId: null,
                projectionId: null,
                projectionHash: null,
                sourceMessageIndex: null,
                sourceMessageHash: null,
                catalogId: null,
                catalogRevision: null,
                catalogHash: null,
                matcherVersion: 'vs-runtime-matcher-v2',
                scorerVersion: 'vs-runtime-scorer-v2',
                usesLlm: false,
                understandingStatus: 'unavailable',
                errorCode: 'VISUAL_CORE_DISABLED',
                decisions: [],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({
            ok: true,
            schemaVersion: 'galgame.visual-core-visual-decisions-response.v2',
            requestId: body.requestId,
            projectionId: body.projection.projectionId,
            projectionHash: body.projection.projectionHash,
            sourceMessageIndex: body.projection.sourceMessageIndex,
            sourceMessageHash: body.projection.sourceMessageHash,
            catalogId: body.visualProfile.catalogId,
            catalogRevision: body.visualProfile.catalogRevision,
            catalogHash: body.visualProfile.catalogHash,
            matcherVersion: 'vs-runtime-matcher-v2',
            scorerVersion: 'vs-runtime-scorer-v2',
            usesLlm: true,
            understandingStatus: 'ready',
            errorCode: null,
            decisions: (coreDecisionMode === 'partial'
                ? ['scene']
                : ['scene', 'character', 'equipment', 'item', 'skill'])
                .map((type) => coreDecision(type, `asset_${type}_player_route`, coreDecisionPaths[type], body)),
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
};

const playerModule = await import('../src/main.js');
const playerHtml = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
assert.match(playerHtml, /id="stageBackdrop"[^>]*aria-hidden="true"/);

globalThis.__GALGAME_TEST_SET_MANIFEST__({
    title: 'Visual Test',
    version: '1.0.0',
    presentation: {
        defaultBackgroundAsset: 'default-bg',
        titleBackgroundAsset: 'title-bg',
    },
    resourceBindings: {
        assets: {
            'default-bg': '/assets/default-background.png',
            'title-bg': '/assets/title-background.png',
            'hero-sprite': '/assets/default-character.png',
        },
        characters: {
            heroine: {
                displayName: 'Heroine',
                sprite: 'hero-sprite',
            },
        },
    },
    visualBindings: {
        schemaVersion: 'galgame.visual-character-bindings.v1',
        characters: [{
            characterKey: 'Test Heroine',
            aliases: ['Test Heroine'],
            assetId: 'asset_character_1b4268f70a37',
            assetVersion: 1,
            channel: 'character',
        }],
    },
}, {
    release: {
        releaseId: 'release.visual.core',
        scenarioId: 'scenario.visual',
        scenarioVersion: '1.0.0',
        activeArcId: 'arc.visual',
    },
});

stageBackdropElement.style.backgroundImage = 'url("/old-release-background.png")';
stageHeroineElement.style.backgroundImage = 'url("/old-character.png")';
stageBackdropElement.classList.add('is-visual-active');
stageHeroineElement.classList.add('is-visual-active', 'is-visual-unknown');

globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(fetchCalls.length, 0);
assert.equal(stageBackdropElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`);
assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`);
assert.equal(stageBackdropElement.classList.contains('is-visual-active'), false);
assert.equal(stageHeroineElement.classList.contains('is-visual-active'), false);
assert.equal(stageHeroineElement.classList.contains('is-visual-unknown'), false);
assert.equal(visualStatusElement.textContent, '');
assert.equal(visualStatusElement.hidden, true);
assert.equal(visualIconStripElement.children.length, 3);
assert.deepEqual(visualIconStripElement.children.map((item) => item.className), [
    'visual-icon visual-icon-equipment is-unavailable is-placeholder',
    'visual-icon visual-icon-item is-unavailable is-placeholder',
    'visual-icon visual-icon-skill is-unavailable is-placeholder',
]);
assert.deepEqual(visualIconStripElement.children.map((item) => item.children[0].alt), [
    '装备暂时不可用',
    '道具暂时不可用',
    '技能暂时不可用',
]);
assert.deepEqual(visualIconStripElement.children.map((item) => item.children[0].src), [
    VISUAL_PLACEHOLDER_URL,
    VISUAL_PLACEHOLDER_URL,
    VISUAL_PLACEHOLDER_URL,
]);

visualCoreServiceMeta = 'http://visual-core.test';
globalThis.__GALGAME_TEST_SET_MANIFEST__({
    title: 'Visual Test',
    version: '1.0.0',
    visualPresentation: {
        visualProfileId: 'vprof_playercore',
        profileHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        catalogId: 'catalog_core_player',
        catalogRevision: 1,
        catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    presentation: {
        defaultBackgroundAsset: 'default-bg',
        titleBackgroundAsset: 'title-bg',
    },
    resourceBindings: {
        assets: {
            'default-bg': '/assets/default-background.png',
            'title-bg': '/assets/title-background.png',
            'hero-sprite': '/assets/default-character.png',
        },
        characters: {
            heroine: {
                displayName: 'Heroine',
                sprite: 'hero-sprite',
            },
        },
    },
    visualBindings: {
        schemaVersion: 'galgame.visual-character-bindings.v1',
        characters: [{
            characterKey: 'Test Heroine',
            aliases: ['Test Heroine'],
            assetId: 'asset_character_1b4268f70a37',
            assetVersion: 1,
            channel: 'character',
        }],
    },
}, {
    release: {
        releaseId: 'release.visual.core',
        scenarioId: 'scenario.visual',
        scenarioVersion: '1.0.0',
        activeArcId: 'arc.visual',
    },
});
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();

assert.equal(fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length, 1);
assert.equal(stageBackdropElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content")');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content")');
assert.equal(stageBackdropElement.classList.contains('is-visual-active'), true);
assert.equal(stageHeroineElement.classList.contains('is-visual-active'), true);
assert.equal(visualIconStripElement.children.length, 3);
assert.deepEqual(visualIconStripElement.children.map((item) => item.children[0].src), [
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_equipment_player_route/1/content',
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_item_player_route/1/content',
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_skill_player_route/1/content',
]);
assert.equal(fetchCalls.some((call) => call.url.includes('/v1/player/visual-bundle')), false);

fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [
        {
            role: 'character',
            speaker: 'Test Heroine',
            displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
            text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        },
        {
            role: 'character',
            speaker: 'Test Heroine',
            displayText: '她望向远处。',
            text: '她望向远处。',
        },
    ],
}, { messageIndex: 1 });
await waitForCoreDecision();
const recentRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(recentRequest.schemaVersion, 'galgame.visual-core-visual-decisions-request.v2');
assert.equal(recentRequest.visibleContext.current.index, 1);
assert.equal(recentRequest.visibleContext.current.text, '她望向远处。');
assert.deepEqual(recentRequest.visibleContext.recent.map((message) => message.text), ['角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护']);
assert.deepEqual(recentRequest.projection.entities.map((entity) => entity.entityType).sort(), ['equipment', 'item', 'scene', 'skill']);
assert.deepEqual(recentRequest.projection.entities.filter((entity) => entity.entityType !== 'character').map((entity) => entity.displayLabel).sort(), ['场景', '技能', '装备', '道具']);

fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '伤害：1d6 穿刺',
        text: '伤害：1d6 穿刺',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
const narrationRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(narrationRequest.visibleContext.current.role, 'narrator');
assert.equal(narrationRequest.projection.entities.some((entity) => entity.entityType === 'character'), false);

fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'player',
        speaker: 'Player',
        displayText: '我退后一步。',
        text: '我退后一步。',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
const playerRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(playerRequest.visibleContext.current.role, 'player');
assert.equal(playerRequest.projection.entities.some((entity) => entity.entityType === 'character'), false);

for (const [text, expectedRole] of [
    ['系统：当前无法继续。', 'system'],
    ['—Unknown NPC 站在门口。', 'character'],
    ['Unknown NPC：我不认识你。', 'character'],
]) {
    fetchCalls = [];
    globalThis.__GALGAME_TEST_RENDER_CHAT__({
        ok: true,
        fileName: 'chat-visual-core.json',
        writable: true,
        messages: [{
            role: expectedRole === 'system' ? 'system' : 'character',
            speaker: expectedRole === 'system' ? 'System' : 'WorldDirector',
            displayText: text,
            text,
        }],
    }, { messageIndex: 0 });
    await waitForCoreDecision();
    const negativeRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
    assert.equal(negativeRequest.visibleContext.current.role, expectedRole);
    assert.equal(negativeRequest.projection.entities.some((entity) => entity.entityType === 'character'), false, text);
}

coreDecisionMode = 'partial';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [
        {
            role: 'character',
            speaker: 'Test Heroine',
            displayText: '她继续望向远处。',
            text: '她继续望向远处。',
        },
    ],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content")');
assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`);
assert.deepEqual(visualIconStripElement.children.map((item) => item.children[0].src), [
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_equipment_player_route/1/content',
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_item_player_route/1/content',
    'http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_skill_player_route/1/content',
]);
coreDecisionMode = 'ok';

fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [
        {
            role: 'character',
            speaker: 'Replacement Heroine',
            displayText: '替换后的旧消息。',
            text: '替换后的旧消息。',
        },
        {
            role: 'character',
            speaker: 'Replacement Heroine',
            displayText: '当前消息。',
            text: '当前消息。',
        },
    ],
}, { messageIndex: 1 });
await waitForCoreDecision();
const replacementRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.deepEqual(replacementRequest.visibleContext.recent, []);

coreDecisionMode = 'disabled';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length, 1);
assert.equal(stageBackdropElement.style.backgroundImage, `url(\"${VISUAL_PLACEHOLDER_URL}\")`);
assert.equal(stageHeroineElement.style.backgroundImage, `url(\"${VISUAL_PLACEHOLDER_URL}\")`);

globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length, 1);
assert.equal(fetchCalls.some((call) => call.url.includes('/v1/player/visual-bundle')), false);
coreDecisionMode = 'ok';
setCoreVisualManifest({
    catalogHash: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    render: false,
});
fetchCalls = [];

globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length, 1);

coreDecisionPaths = {
    scene: 'https://evil.example/scene.png',
    character: '/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content?token=bad',
    equipment: '/v1/core/catalogs/catalog_core_player/1/assets/asset_equipment_player_route/1/content#hash',
    item: '/v1/core/../evil',
    skill: '//evil.example/v1/core/catalogs/catalog_core_player/1/assets/asset_skill_player_route/1/content',
};
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(stageBackdropElement.style.backgroundImage, 'url(\"http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content\")');
assert.equal(stageHeroineElement.style.backgroundImage, 'url(\"http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content\")');
assert.deepEqual(visualIconStripElement.children.map((item) => item.className), [
    'visual-icon visual-icon-equipment is-unavailable is-placeholder',
    'visual-icon visual-icon-item is-unavailable is-placeholder',
    'visual-icon visual-icon-skill is-unavailable is-placeholder',
]);

playerModule.restoreDefaultVisualLayers();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("/assets/default-character.png")');

console.log('player CORE visual presentation tests passed');

function createValidCoreDecisionPaths() {
    return {
        scene: '/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content',
        character: '/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content',
        equipment: '/v1/core/catalogs/catalog_core_player/1/assets/asset_equipment_player_route/1/content',
        item: '/v1/core/catalogs/catalog_core_player/1/assets/asset_item_player_route/1/content',
        skill: '/v1/core/catalogs/catalog_core_player/1/assets/asset_skill_player_route/1/content',
    };
}

function createCoreVisualContext() {
    const context = {
        ok: true,
        schemaVersion: 'galgame.visual-core-context.v1',
        enabled: true,
        activeCatalog: {
            catalogId: 'catalog_core_player',
            catalogRevision: 1,
            catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
        visualProfile: {
            visualProfileId: 'vprof_playercore',
            profileHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
            catalogId: 'catalog_core_player',
            catalogRevision: 1,
            catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
        source: 'visual-control',
        sourceVersion: 'galgame.visual-control.v1',
    };
    context.contextHash = hashDigest(canonicalJson({
        schemaVersion: context.schemaVersion,
        enabled: context.enabled,
        activeCatalog: context.activeCatalog,
        visualProfile: context.visualProfile,
        source: context.source,
        sourceVersion: context.sourceVersion,
    }));
    return context;
}

async function waitForCoreDecision() {
    const deadline = Date.now() + 2000;
    while (fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).length < 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The request is issued before the response is validated and the image
    // layers are painted. Give that promise chain a turn before accepting the
    // placeholder that was present while the request was in flight.
    await new Promise((resolve) => setTimeout(resolve, 25));
    // The decision response and layer painting are separate async stages.
    // Wait for the rendered catalog URL (or the shared placeholder) so tests
    // observe the player surface rather than merely an outbound request.
    while (!stageBackdropElement.style.backgroundImage
        .includes('/v1/core/catalogs/')
        && !stageBackdropElement.style.backgroundImage.includes(VISUAL_PLACEHOLDER_URL)
        && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
}

function setCoreVisualManifest({ catalogHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222', render = true } = {}) {
    globalThis.__GALGAME_TEST_SET_MANIFEST__({
        title: 'Visual Test',
        version: '1.0.0',
        visualPresentation: {
            visualProfileId: 'vprof_playercore',
            profileHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
            catalogId: 'catalog_core_player',
            catalogRevision: 1,
            catalogHash,
        },
        presentation: {
            defaultBackgroundAsset: 'default-bg',
            titleBackgroundAsset: 'title-bg',
        },
        resourceBindings: {
            assets: {
                'default-bg': '/assets/default-background.png',
                'title-bg': '/assets/title-background.png',
                'hero-sprite': '/assets/default-character.png',
            },
            characters: {
                heroine: {
                    displayName: 'Heroine',
                    sprite: 'hero-sprite',
                },
            },
        },
        visualBindings: {
            schemaVersion: 'galgame.visual-character-bindings.v1',
            characters: [{
                characterKey: 'Test Heroine',
                aliases: ['Test Heroine'],
                assetId: 'asset_character_1b4268f70a37',
                assetVersion: 1,
                channel: 'character',
            }],
        },
    }, {
        release: {
            releaseId: 'release.visual.core',
            scenarioId: 'scenario.visual',
            scenarioVersion: '1.0.0',
            activeArcId: 'arc.visual',
        },
    }, { render });
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashDigest(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function coreDecision(entityType, assetId, contentPath, request) {
    return {
        schemaVersion: 'galgame.visual-candidate-decision.v1',
        decisionId: `vcd_${entityType}_player`,
        entityKey: request?.projection?.entities?.find((entity) => entity.entityType === entityType)?.entityKey
            || `entity_${entityType}_player`,
        entityType,
        projectionId: request?.projection?.projectionId || 'vvp_player_core',
        sourceMessageIndex: request?.projection?.sourceMessageIndex ?? 0,
        sourceMessageHash: request?.projection?.sourceMessageHash || 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
        evidenceDigest: request?.projection?.projectionHash || 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
        visualProfileId: request?.visualProfile?.visualProfileId || 'vprof_playercore',
        profileHash: request?.visualProfile?.profileHash || 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        catalogId: request?.visualProfile?.catalogId || 'catalog_core_player',
        catalogRevision: request?.visualProfile?.catalogRevision || 1,
        catalogHash: request?.visualProfile?.catalogHash || 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        dictionaryVersion: '2',
        dictionaryHash: 'sha256:5555555555555555555555555555555555555555555555555555555555555555',
        assetId,
        assetVersion: 1,
        assetContentSha256: '43739c566e26fd7cb88f69d3864ea34740372f5ee99acac169e090beffbce5c6',
        assetMetadataHash: 'sha256:6666666666666666666666666666666666666666666666666666666666666666',
        score: 60,
        scoreBand: 'medium',
        reasonCodes: ['tag-overlap'],
        matcherVersion: 'core',
        scorerVersion: 'core',
        usesLlm: false,
        createdAt: '2026-08-01T00:00:00.000Z',
        contentPath,
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
        focus: noop,
        setAttribute: noop,
        removeAttribute: noop,
    };
    return element;
}
