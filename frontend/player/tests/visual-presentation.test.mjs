import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createSceneContinuityProjection } from '../../shared/src/presentation-projection.js';
import { deriveSceneContinuityKey } from '../../shared/src/scene-continuity-analysis.js';

globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;
globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ = true;
let portraitStorageMode = 'ready';
const portraitStorageItems = new Map();
const portraitStorage = {
    getItem(key) {
        if (portraitStorageMode === 'read-blocked') throw new Error('session storage denied');
        return portraitStorageItems.get(key) ?? null;
    },
    setItem(key, value) {
        if (portraitStorageMode === 'write-blocked') throw new Error('session storage quota exceeded');
        portraitStorageItems.set(key, value);
    },
};
const sceneLedgerStorageItems = new Map();
globalThis.localStorage = {
    getItem(key) { return sceneLedgerStorageItems.get(key) ?? null; },
    setItem(key, value) { sceneLedgerStorageItems.set(key, value); },
};
globalThis.window = {
    location: { origin: 'http://127.0.0.1:8001' },
    setTimeout,
    clearTimeout,
    sessionStorage: portraitStorage,
};
const noop = () => {};
const elements = new Map();
const stageBackdropElement = createStubElement();
const stageHeroineElement = createStubElement();
const visualIconStripElement = createStubElement();
const visualStatusElement = createStubElement();
const VISUAL_PLACEHOLDER_URL = './assets/visual-placeholder.svg';
const NARRATOR_PLACEHOLDER_URL = './assets/narrator-placeholder.svg';
const PLAYER_PLACEHOLDER_URL = './assets/player-placeholder.svg';
let visualCoreServiceMeta = '';
let sceneContinuityMode = 'changed';
let sceneFactoryCalls = 0;
let lastSceneFactoryPreviousKey = null;
let sceneAnalyzerAvailable = false;
let sceneAnalyzerRequestCount = 0;
globalThis.__GALGAME_TEST_SCENE_CONTINUITY_FACTORY__ = async ({ pageText, scope, messageId, pageIndex, previousVerifiedSceneKey }) => {
    sceneFactoryCalls += 1;
    lastSceneFactoryPreviousKey = previousVerifiedSceneKey || null;
    if (sceneContinuityMode === 'missing' || sceneContinuityMode === 'real-unknown') return null;
    const source = String(pageText || '');
    const codePoints = Array.from(source);
    if (codePoints.length < 2) return null;
    const firstEnd = codePoints[0].length;
    const secondEnd = firstEnd + codePoints[1].length;
    if (sceneContinuityMode === 'continued' && previousVerifiedSceneKey) {
        return createSceneContinuityProjection({
            scope, messageId, pageIndex, pageText: source, state: 'continued',
            sceneEntityKeys: [previousVerifiedSceneKey], currentSceneKey: previousVerifiedSceneKey,
            evidenceSpans: [
                { start: 0, end: firstEnd, relation: 'current-location', sceneEntityKey: previousVerifiedSceneKey, destinationSceneKey: null },
                { start: firstEnd, end: secondEnd, relation: 'referenced-location', sceneEntityKey: previousVerifiedSceneKey, destinationSceneKey: null },
            ],
        });
    }
    const preferredLocations = ['光辉神殿酒馆', '旧钟楼', '庭院', '港口', '贵族区', '森林'];
    const selectedLocation = preferredLocations.find((location) => source.includes(location));
    if (!selectedLocation) return null;
    const locationOffset = source.indexOf(selectedLocation);
    const locationStart = Array.from(source.slice(0, locationOffset)).length;
    const locationSpan = { start: locationStart, end: locationStart + Array.from(selectedLocation).length };
    const transitionWords = ['进入', '来到', '抵达', '穿过', '走进', '回到'];
    const transitionWord = transitionWords.find((word) => source.includes(word)) || codePoints.slice(0, 1).join('');
    const transitionOffset = source.indexOf(transitionWord);
    const transitionStart = Array.from(source.slice(0, transitionOffset < 0 ? 0 : transitionOffset)).length;
    const transitionSpan = { start: transitionStart, end: transitionStart + Array.from(transitionWord).length };
    const sceneKey = await deriveSceneContinuityKey(scope, selectedLocation);
    return createSceneContinuityProjection({
        scope, messageId, pageIndex, pageText: source, state: 'changed',
        sceneEntityKeys: [sceneKey], currentSceneKey: sceneKey,
        evidenceSpans: [
            { ...transitionSpan, relation: 'transition-action', sceneEntityKey: null, destinationSceneKey: sceneKey },
            { ...locationSpan, relation: 'current-location', sceneEntityKey: sceneKey, destinationSceneKey: null },
        ],
    });
};
let coreDecisionPaths = createValidCoreDecisionPaths();
let coreCatalogCharacterChannels = [
    { assetId: 'asset_character_1b4268f70a37', assetVersion: 1, channel: 'character' },
    { assetId: 'asset_character_player_route', assetVersion: 1, channel: 'character' },
    { assetId: 'asset_character_player_bound', assetVersion: 1, channel: 'player' },
];
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
let lastCoreDecisionExchange = null;
let carouselCallback = null;
let carouselIntervalMs = null;
let carouselClearCount = 0;
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
    if (String(url).endsWith('/v1/presentation/health') && String(url).startsWith('http://127.0.0.1:8798')) {
        return new Response(JSON.stringify({
            serviceReady: true,
            analyzerConfigured: sceneAnalyzerAvailable,
            analyzerScope: 'test-analyzer',
            sceneAnalyzerScope: 'test-scene-analyzer',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/presentation/scene-continuity')) {
        sceneAnalyzerRequestCount += 1;
        const request = JSON.parse(options.body);
        assert.equal(request.segment.pageTextSha256.startsWith('sha256:'), true);
        return new Response(JSON.stringify({
            schemaVersion: 'galgame.scene-continuity-analysis.v1',
            requestId: request.requestId,
            pageTextSha256: request.segment.pageTextSha256,
            confidenceBand: 'low',
            currentLocation: null,
            transitionAction: null,
            referencedLocations: [],
            visualTags: [],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/core/visual-decisions')) {
        const body = JSON.parse(options.body);
        assert.equal(options.credentials, 'omit');
        assert.equal(options.headers['content-type'], 'application/json');
        assert.equal(body.visualProfile.catalogId, 'catalog_core_player');
        assert.equal(
            body.projection.entities.some((entity) => entity.visibleAttributes.some((attribute) => attribute.code === 'character-explicit-appearance')),
            false,
            'message-wide/segment appearance labels are not attributed to the active speaker without identity-linked evidence',
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
        if (coreDecisionMode === 'none') {
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
                usesLlm: false,
                understandingStatus: 'unavailable',
                errorCode: null,
                decisions: [],
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        const decisions = (coreDecisionMode === 'partial'
            ? ['scene']
            : ['scene', 'character', 'equipment', 'item', 'skill'])
            .map((type) => coreDecision(type, `asset_${type}_player_route`, coreDecisionPaths[type], body));
        lastCoreDecisionExchange = { request: body, decisions };
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
            decisions,
        }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
};

const playerModule = await import('../src/main.js');
const renderChat = globalThis.__GALGAME_TEST_RENDER_CHAT__;
let pendingVisualWork = Promise.resolve();
globalThis.__GALGAME_TEST_RENDER_CHAT__ = (...args) => {
    pendingVisualWork = Promise.resolve(renderChat(...args));
    return pendingVisualWork;
};
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
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
assert.equal(stageHeroineElement.style.backgroundImage, `url("${NARRATOR_PLACEHOLDER_URL}")`);
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
const placeholderItemIcon = visualIconStripElement.children[1];
assert.equal(placeholderItemIcon.attributes.role, 'button');
assert.equal(placeholderItemIcon.attributes['aria-label'], '打开道具详情');
placeholderItemIcon.dispatch('click');
assert.equal(elements.get('#adaptiveDetailDrawer').hidden, false, 'the unavailable item tile still opens its detail drawer');
assert.equal(elements.get('#adaptiveDetailTitle').textContent, '道具');
elements.get('#adaptiveDetailDrawer').hidden = true;

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

const sceneStateBeforePlayerTurn = globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().state;
const playerPageText = '你（玩家）尝试向森林前进。';
const precedingAssistantPageText = '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护';
const forgedPlayerProjection = await createSceneContinuityProjection({
    scope: sceneStateBeforePlayerTurn.scope,
    messageId: '1',
    pageIndex: 0,
    pageText: playerPageText,
    state: 'changed',
    sceneEntityKeys: ['scene:forged-player'],
    currentSceneKey: 'scene:forged-player',
    evidenceSpans: [
        { start: 0, end: 1, relation: 'transition-action', sceneEntityKey: null, destinationSceneKey: 'scene:forged-player' },
        { start: 8, end: 10, relation: 'current-location', sceneEntityKey: 'scene:forged-player', destinationSceneKey: null },
    ],
});
const sceneFactoryCallsBeforePlayerTurn = sceneFactoryCalls;
const backgroundBeforePlayerTurn = stageBackdropElement.style.backgroundImage;
const playerTurnSnapshot = {
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [
        { role: 'character', index: 0, speaker: 'Test Heroine', displayText: precedingAssistantPageText, text: precedingAssistantPageText },
        { role: 'player', index: 1, speaker: '你', displayText: playerPageText, text: playerPageText, sceneContinuityProjection: forgedPlayerProjection },
    ],
};
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(playerTurnSnapshot, { messageIndex: 1, instant: true });
await waitForCoreDecision();
assert.equal(sceneFactoryCalls, sceneFactoryCallsBeforePlayerTurn, 'player pages skip scene analysis');
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().action, 'preserve');
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().state.sceneKey, sceneStateBeforePlayerTurn.sceneKey);
assert.equal(stageBackdropElement.style.backgroundImage, backgroundBeforePlayerTurn, 'player-supplied projection cannot change the scene');
const playerSceneInput = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body)
    .projection.entities.find((entity) => entity.entityType === 'scene');
assert.deepEqual(playerSceneInput.visibleAttributes, [], 'player projection is not passed to the visual matcher');

// A reset/reload removes the in-memory scene identity and stage pixels. The
// trailing player message must restore only the latest validated earlier
// assistant scene from the persistent ledger without analyzing player text.
globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(playerTurnSnapshot, { messageIndex: 1, instant: true });
await waitForCoreDecision();
assert.equal(sceneFactoryCalls, sceneFactoryCallsBeforePlayerTurn, 'restoring from ledger never analyzes player text');
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().state.sceneKey, sceneStateBeforePlayerTurn.sceneKey);
assert.equal(stageBackdropElement.style.backgroundImage, backgroundBeforePlayerTurn,
    'reloading on a trailing player turn restores the previously verified scene background');
const restoredPlayerSceneInput = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body)
    .projection.entities.find((entity) => entity.entityType === 'scene');
assert.ok(restoredPlayerSceneInput?.visibleAttributes.some((attribute) => attribute.code === 'scene-location-kind'),
    'only the earlier verified scene evidence is provided to the matcher');

// Same-scope unknown continuity preserves the last verified scene even when
// the matcher returns a different scene candidate.
const verifiedBackgroundBeforeUnknown = stageBackdropElement.style.backgroundImage;
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她仍在原地等待。', text: '她仍在原地等待。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.equal(stageBackdropElement.style.backgroundImage, verifiedBackgroundBeforeUnknown);
sceneContinuityMode = 'changed';

// A verified transition clears the previous background first. If matching
// returns no usable scene, the published default remains visible.
coreDecisionMode = 'none';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '众人终于抵达港口。', text: '众人终于抵达港口。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
assert.equal(stageBackdropElement.dataset.visualAssetIdentity, undefined);
coreDecisionMode = 'ok';

// A chat scope change clears the prior scene even if the new page has no
// trusted continuity projection.
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core-other-scope.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她望向陌生的街道。', text: '她望向陌生的街道。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
sceneContinuityMode = 'changed';

fetchCalls = [];
coreDecisionMode = 'disabled';
coreCatalogCharacterChannels = [
    { assetId: 'asset_character_1b4268f70a37', assetVersion: 1, channel: 'narrator' },
    { assetId: 'asset_character_player_route', assetVersion: 1, channel: 'character' },
];
visualCoreServiceMeta = 'http://visual-core-special-channel.test';
setCoreVisualManifest();
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core-special-channel.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`, 'a local character binding declared as narrator in the active catalog must fail closed');
assert.equal(fetchCalls.some((call) => call.url.includes('/assets/asset_character_1b4268f70a37/1/content')), false);
coreDecisionMode = 'ok';
coreCatalogCharacterChannels = [
    { assetId: 'asset_character_1b4268f70a37', assetVersion: 1, channel: 'character' },
    { assetId: 'asset_character_player_route', assetVersion: 1, channel: 'character' },
    { assetId: 'asset_character_player_bound', assetVersion: 1, channel: 'player' },
];
visualCoreServiceMeta = 'http://visual-core.test';

fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core-segments.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '你们进入光辉神殿酒馆。\n\n队伍随后来到旧钟楼。',
        text: '你们进入光辉神殿酒馆。\n\n队伍随后来到旧钟楼。',
    }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const firstSegmentRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(firstSegmentRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '光辉神殿酒馆');
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core-segments.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '你们进入光辉神殿酒馆。\n\n队伍随后来到旧钟楼。',
        text: '你们进入光辉神殿酒馆。\n\n队伍随后来到旧钟楼。',
    }],
}, { messageIndex: 0, pageIndex: 1, instant: true });
await waitForCoreDecision();
const segmentRequests = fetchCalls
    .filter((call) => call.url.endsWith('/v1/core/visual-decisions'))
    .map((call) => JSON.parse(call.options.body));
assert.equal(segmentRequests.at(-1).projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '旧钟楼');

fetchCalls = [];
const noScenePageChat = {
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
};
globalThis.__GALGAME_TEST_RENDER_CHAT__(noScenePageChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const backgroundBeforeNoScenePage = stageBackdropElement.style.backgroundImage;
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(noScenePageChat, { messageIndex: 1, instant: true });
await waitForCoreDecision();
const recentRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(recentRequest.schemaVersion, 'galgame.visual-core-visual-decisions-request.v2');
assert.equal(recentRequest.visibleContext.current.index, 1);
assert.equal(recentRequest.visibleContext.current.text, '她望向远处。');
assert.deepEqual(recentRequest.visibleContext.recent.map((message) => message.text), ['角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护']);
assert.deepEqual(recentRequest.projection.entities.map((entity) => entity.entityType).sort(), ['equipment', 'item', 'scene', 'skill']);
assert.deepEqual(recentRequest.projection.entities.filter((entity) => ['equipment', 'item', 'skill'].includes(entity.entityType))
    .map((entity) => entity.displayLabel).sort(), ['守护', '钥匙', '银盾']);
assert.deepEqual(recentRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.visibleAttributes, [],
    'a page without a validated location contributes no invented scene hint');
assert.equal(stageBackdropElement.style.backgroundImage, backgroundBeforeNoScenePage,
    'a page without a new scene preserves the last verified background');

sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character', speaker: 'Test Heroine',
        displayText: '场景: 明确标注的庭院\n人物继续交谈。',
        text: '场景: 明确标注的庭院\n人物继续交谈。',
    }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const unvalidatedSceneRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.deepEqual(
    unvalidatedSceneRequest.projection.entities.find((entity) => entity.entityType === 'scene').visibleAttributes,
    [],
    'explicit scene labels do not bypass the page-scoped continuity producer',
);
sceneContinuityMode = 'changed';

fetchCalls = [];
const longVisibleReply = `角色: 银发骑士\\n${'长回复内容。'.repeat(900)}`;
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: longVisibleReply,
        text: longVisibleReply,
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
const boundedRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
const boundedTexts = [boundedRequest.visibleContext.current, ...boundedRequest.visibleContext.recent]
    .map((message) => message.text);
assert.equal(boundedTexts.every((text) => Array.from(text).length <= 4000), true);
assert.equal(boundedTexts.some((text) => text.includes('\n[…]\n')), true);

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
        role: 'character',
        speaker: 'Dungeon Master',
        displayText: 'Celestia整理了一下链甲，露出更多胸肉：“现在出发。”',
        text: 'Celestia整理了一下链甲，露出更多胸肉：“现在出发。”',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
const inferredSpeakerRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(inferredSpeakerRequest.visibleContext.current.role, 'character');
const inferredCharacterEntity = inferredSpeakerRequest.projection.entities.find((entity) => entity.entityType === 'character');
assert.ok(inferredCharacterEntity);
assert.equal(inferredCharacterEntity.displayLabel, 'Celestia');
assert.equal(inferredCharacterEntity.confidenceBand, 'probable');
assert.equal(inferredCharacterEntity.visibleAttributes.some((attribute) => (
    attribute.code === 'character-explicit-name' && attribute.value === 'Celestia'
)), true);

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
    ['—Unknown NPC 站在门口。', 'narrator'],
    ['Unknown NPC：我不认识你。', 'narrator'],
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
assert.equal(stageHeroineElement.style.backgroundImage, `url("${NARRATOR_PLACEHOLDER_URL}")`);
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
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
assert.equal(stageBackdropElement.classList.contains('is-visual-active'), false);

assert.equal(stageHeroineElement.dataset.visualAssetIdentity, 'asset_character_1b4268f70a37:1', 'published exact portrait survives analyzer failure');
const drawerText = (element) => [element?.textContent || '', ...(element?.children || []).map(drawerText)].join(' ');
for (const [type, label] of [['equipment', '银盾'], ['item', '钥匙'], ['skill', '守护']]) {
    const icon = visualIconStripElement.children.find((entry) => entry.dataset.visualType === type);
    assert.ok(icon, `missing ${type} detail entry`);
    icon.dispatch('click');
    assert.ok(drawerText(elements.get('#adaptiveDetailBody')).includes(label), `${type} detail must use original text without a matched image`);
}
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true, fileName: 'chat-visual-core.json', writable: true,
    messages: [{ role: 'character', speaker: 'Unbound Stranger', text: '角色: 陌生来客', displayText: '角色: 陌生来客' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`, 'unbound speaker cannot inherit the previous exact portrait');

// Establish a verified scene, then prove that a same-scope continued page
// ignores an empty scene decision and keeps that background.
visualCoreServiceMeta = 'http://visual-core-continuity.test';
coreDecisionMode = 'ok';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她走进庭院。', text: '她走进庭院。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.ok(stageBackdropElement.style.backgroundImage.includes('/v1/core/catalogs/'), JSON.stringify({
    state: globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__(), background: stageBackdropElement.style.backgroundImage,
    calls: fetchCalls.map((call) => call.url),
}));
assert.ok(sceneLedgerStorageItems.size > 0, 'completed scene metadata is persisted locally for this exact scope');
const restoredEarlierSceneChat = {
    ok: true,
    fileName: 'cold-earlier-recovery.json',
    writable: true,
    messages: [
        { role: 'character', speaker: 'Test Heroine', displayText: '她走进庭院。', text: '她走进庭院。' },
        { role: 'character', speaker: 'Test Heroine', displayText: '她在钟楼门口停下，暂时没有继续行动。', text: '她在钟楼门口停下，暂时没有继续行动。' },
    ],
};
globalThis.__GALGAME_TEST_RENDER_CHAT__(restoredEarlierSceneChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().state.sceneKey, null, 'cold reset clears in-memory scene identity');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")', 'cold reset clears the rendered background');
sceneContinuityMode = 'missing';
visualCoreServiceMeta = 'http://visual-core-recovery.test';
coreDecisionMode = 'ok';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(restoredEarlierSceneChat, { messageIndex: 1, instant: true });
await waitForCoreDecision();
assert.ok(lastSceneFactoryPreviousKey, 'after cold reset, the analyzer receives the restored validated prior scene from local storage');
const earlierRecoveryRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(earlierRecoveryRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '庭院', 'unknown active page rematches the last validated scene label');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("http://visual-core-recovery.test/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content")');
assert.equal(stageBackdropElement.classList.contains('is-visual-active'), true);
const recoveredBackground = stageBackdropElement.style.backgroundImage;
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(restoredEarlierSceneChat, { messageIndex: 1, instant: true });
await waitForCoreDecision();
const stableUnknownRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().action, 'preserve');
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().backgroundVerified, true);
assert.equal(stableUnknownRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.visibleAttributes.length, 0, 'an already visible validated scene is not rematched after unknown analysis');
assert.equal(stageBackdropElement.style.backgroundImage, recoveredBackground, 'an already correct background does not flicker or clear');

// A true cold reload must recover the exact current page's ledger record even
// when the optional analyzer is unavailable, and obtain the image again from
// the current 8798 catalog decision response (never from a cached asset URL).
sceneContinuityMode = 'changed';
visualCoreServiceMeta = 'http://visual-core-cold-current.test';
coreDecisionMode = 'ok';
const coldCurrentChat = {
    ok: true,
    fileName: 'cold-current-page.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她抵达港口。', text: '她抵达港口。' }],
};
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(coldCurrentChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
assert.ok(sceneLedgerStorageItems.size > 0);
globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
assert.equal(globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().backgroundVerified, false, 'cold reset clears the verified-background flag');
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(coldCurrentChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const exactCacheRequestCall = fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions'));
assert.ok(exactCacheRequestCall, 'cold current-page cache recovery requests a fresh catalog match');
const exactCacheRequest = JSON.parse(exactCacheRequestCall.options.body);
assert.equal(exactCacheRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '港口', 'exact current cache reconstructs the validated scene hint');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("http://visual-core-cold-current.test/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content")');
assert.ok(!JSON.stringify(exactCacheRequest.projection.entities.find((entity) => entity.entityType === 'scene')).includes('/content'), 'cached recovery contains no asset URL; matching is requested from the catalog service');
assert.ok(Array.from(sceneLedgerStorageItems.values()).every((entry) => !entry.includes('她抵达港口。') && !entry.includes('/content')), 'local ledger stores projections and hashes, never message body or asset URL');

// A fresh analyzer response can be structurally valid and hash-bound while
// still classifying the page as unknown. It must never become a completed
// current-page ledger record just because consume() carries the prior scene key.
sceneContinuityMode = 'changed';
sceneAnalyzerAvailable = false;
visualCoreServiceMeta = 'http://visual-core-unknown-ledger.test';
const unknownProjectionChat = {
    ok: true,
    fileName: 'cold-unknown-projection.json',
    writable: true,
    messages: [
        { role: 'character', speaker: 'Test Heroine', displayText: '她走进庭院。', text: '她走进庭院。' },
        { role: 'character', speaker: 'Test Heroine', displayText: '她停下，周围暂时没有变化。', text: '她停下，周围暂时没有变化。' },
    ],
};
globalThis.__GALGAME_TEST_RENDER_CHAT__(unknownProjectionChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
sceneContinuityMode = 'real-unknown';
sceneAnalyzerAvailable = true;
const analyzerRequestsBeforeUnknown = sceneAnalyzerRequestCount;
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(unknownProjectionChat, { messageIndex: 1, instant: true });
await waitForCoreDecision();
assert.equal(sceneAnalyzerRequestCount, analyzerRequestsBeforeUnknown + 1, 'the valid unknown response came from the fresh analyzer path');
const unknownEnvelope = Array.from(sceneLedgerStorageItems.values())
    .map((serialized) => { try { return JSON.parse(serialized); } catch { return null; } })
    .find((entry) => entry?.records?.some((record) => record.scope?.chatId === 'cold-unknown-projection.json'));
assert.ok(unknownEnvelope?.records.some((record) => record.scope.chatId === 'cold-unknown-projection.json' && record.messageIndex === 0), 'the validated earlier scene remains persisted');
assert.equal(unknownEnvelope.records.some((record) => record.scope.chatId === 'cold-unknown-projection.json' && record.messageIndex === 1), false, 'unknown current-page result is never persisted as verified');

globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
sceneContinuityMode = 'missing';
sceneAnalyzerAvailable = false;
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(unknownProjectionChat, { messageIndex: 1, instant: true });
await waitForCoreDecision();
const afterUnknownColdRestore = globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__().state;
assert.equal(afterUnknownColdRestore.messageIndex, 0, 'cold restore uses only the earlier verified scene cursor');
assert.equal(afterUnknownColdRestore.pageIndex, 0);
const afterUnknownColdRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(afterUnknownColdRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '庭院', 'unavailable cold restore rematches the earlier validated scene');

// Same chat/page index with replaced text invalidates the persisted source hash;
// another chat and another catalog scope cannot reuse that scene projection.
globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true, fileName: 'cold-current-page.json', writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她来到森林深处。', text: '她来到森林深处。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const replacedTextRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.notEqual(replacedTextRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '港口', 'replaced source text cannot consume the prior cached label');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")', 'replaced source text cannot restore a stale cached image');

globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true, fileName: 'different-cold-chat.json', writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '她抵达港口。', text: '她抵达港口。' }],
}, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const differentChatRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.notEqual(differentChatRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '港口', 'another chat cannot consume the persisted scene record');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")', 'another chat cannot display the cached scene image');

globalThis.__GALGAME_TEST_COLD_RESET_SCENE__();
setCoreVisualManifest({ catalogHash: 'sha256:4444444444444444444444444444444444444444444444444444444444444444' });
sceneContinuityMode = 'missing';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__(coldCurrentChat, { messageIndex: 0, instant: true });
await waitForCoreDecision();
const differentScopeRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.notEqual(differentScopeRequest.projection.entities.find((entity) => entity.entityType === 'scene')?.displayLabel, '港口', 'a different catalog scope cannot consume the persisted scene record');
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")', 'a different catalog scope cannot display the cached scene image');

setCoreVisualManifest({ catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222' });
sceneContinuityMode = 'changed';
coreDecisionMode = 'ok';
visualCoreServiceMeta = 'http://visual-core.test';
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
    fileName: 'chat-visual-core-unsafe-url.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Test Heroine',
        displayText: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
        text: '角色: 银发骑士\n场景: 庭院\n装备: 银盾\n道具: 钥匙\n技能: 守护',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")', 'a rejected scene URL falls back to the release default instead of retaining an outdated matched scene');
assert.equal(stageHeroineElement.style.backgroundImage, 'url(\"http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_1b4268f70a37/1/content\")');
assert.deepEqual(visualIconStripElement.children.map((item) => item.className), [
    'visual-icon visual-icon-equipment is-unavailable is-placeholder',
    'visual-icon visual-icon-item is-unavailable is-placeholder',
    'visual-icon visual-icon-skill is-unavailable is-placeholder',
]);

setCoreVisualManifest({ includePlayer: true });
coreDecisionPaths = {
    scene: '/v1/core/catalogs/catalog_core_player/1/assets/asset_scene_player_route/1/content',
    character: '/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content',
    equipment: '/v1/core/catalogs/catalog_core_player/1/assets/asset_equipment_player_route/1/content',
    item: '/v1/core/catalogs/catalog_core_player/1/assets/asset_item_player_route/1/content',
    skill: '/v1/core/catalogs/catalog_core_player/1/assets/asset_skill_player_route/1/content',
};
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-core-player.json',
    writable: true,
    messages: [{
        role: 'player',
        speaker: 'Player',
        displayText: '我退后一步。',
        text: '我退后一步。',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
const boundPlayerRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.equal(boundPlayerRequest.visibleContext.current.role, 'player');
assert.equal(boundPlayerRequest.projection.entities.some((entity) => entity.entityType === 'character'), false, 'player turns never enter the character portrait channel');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_bound/1/content")', 'a separately published playerAssetId uses the player channel');
assert.equal(stageHeroineElement.classList.contains('is-visual-active'), true);

portraitStorageMode = 'read-blocked';
fetchCalls = [];
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-portrait-storage-blocked.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Storage Test Heroine',
        displayText: '她走进庭院。',
        text: '她走进庭院。',
    }],
}, { messageIndex: 0 });
await waitForCoreDecision();
assert.equal(stageHeroineElement.style.backgroundImage, `url("${NARRATOR_PLACEHOLDER_URL}")`, 'dynamic portrait fails closed when its uniqueness ledger cannot be read');
assert.equal(fetchCalls.some((call) => call.url.includes('/assets/asset_character_player_route/1/content')), false, 'unpersisted portrait is never rendered');
portraitStorageMode = 'ready';

// A dialogue page with two resolved speakers must rotate only their own
// verified release portraits, at the agreed three-second cadence.
fetchCalls = [];
coreCatalogCharacterChannels = [
    { assetId: 'asset_character_1b4268f70a37', assetVersion: 1, channel: 'character' },
    { assetId: 'asset_character_player_route', assetVersion: 1, channel: 'character' },
];
globalThis.setInterval = (callback, intervalMs) => {
    carouselCallback = callback;
    carouselIntervalMs = intervalMs;
    return 9876;
};
globalThis.clearInterval = (timer) => {
    if (timer === 9876) {
        carouselClearCount += 1;
        carouselCallback = null;
    }
};
globalThis.__GALGAME_TEST_SET_MANIFEST__({
    title: 'Visual Carousel Test',
    version: '1.0.0',
    visualPresentation: {
        visualProfileId: 'vprof_playercore',
        profileHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        catalogId: 'catalog_core_player',
        catalogRevision: 1,
        catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    },
    presentation: { defaultBackgroundAsset: 'default-bg', titleBackgroundAsset: 'title-bg' },
    resourceBindings: {
        assets: {
            'default-bg': '/assets/default-background.png',
            'title-bg': '/assets/title-background.png',
            'hero-sprite': '/assets/default-character.png',
        },
        characters: { heroine: { displayName: 'Heroine', sprite: 'hero-sprite' } },
    },
    visualBindings: {
        schemaVersion: 'galgame.visual-character-bindings.v1',
        characters: [
            { characterKey: 'Test Heroine', aliases: [], assetId: 'asset_character_1b4268f70a37', assetVersion: 1, channel: 'character' },
            { characterKey: 'Pippa', aliases: [], assetId: 'asset_character_player_route', assetVersion: 1, channel: 'character' },
        ],
    },
}, {
    release: { releaseId: 'release.visual.core', scenarioId: 'scenario.visual', scenarioVersion: '1.0.0', activeArcId: 'arc.visual' },
});
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-carousel.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Dungeon Master',
        displayText: 'Test Heroine说道：“我来开门。”\n\nPippa说道：“我掩护你。”',
        text: 'Test Heroine说道：“我来开门。”\n\nPippa说道：“我掩护你。”',
    }],
}, { messageIndex: 0, instant: true });
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(elements.get('#speakerName').textContent, '多人对话');
assert.equal(carouselIntervalMs, 3000, 'portrait carousel advances every three seconds');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_1b4268f70a37/1/content")');
carouselCallback?.();
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(stageHeroineElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_player_route/1/content")');
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-carousel.json',
    writable: true,
    messages: [{ role: 'character', speaker: 'Test Heroine', displayText: '“我继续处理。”', text: '“我继续处理。”' }],
}, { messageIndex: 0, instant: true });
assert.ok(carouselClearCount >= 1, 'rendering a continuation page clears the previous group carousel');
assert.equal(carouselCallback, null, 'a single-speaker continuation does not install a new carousel');
globalThis.__GALGAME_TEST_RENDER_CHAT__({
    ok: true,
    fileName: 'chat-visual-long-quote.json',
    writable: true,
    messages: [{
        role: 'character',
        speaker: 'Dungeon Master',
        displayText: `Test Heroine说道：“${'这段较长的台词仍由她连续说出。'.repeat(14)}说完了。”`,
        text: `Test Heroine说道：“${'这段较长的台词仍由她连续说出。'.repeat(14)}说完了。”`,
    }],
}, { messageIndex: 0, pageIndex: 1, instant: true });
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(elements.get('#speakerName').textContent, 'Test Heroine', 'the continuation page keeps the exact attributed speaker');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("http://visual-core.test/v1/core/catalogs/catalog_core_player/1/assets/asset_character_1b4268f70a37/1/content")', 'the continuation page remains pinned to that speaker portrait');
assert.equal(carouselCallback, null, 'a quote continuation page never starts group rotation');

playerModule.restoreDefaultVisualLayers();
assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
assert.equal(stageHeroineElement.style.backgroundImage, 'url("/assets/default-character.png")');

// Exercise the production renderer through repeated original-message snapshots.
setCoreVisualManifest({ render: false });
visualCoreServiceMeta = 'http://visual-core-hud-records.test';
coreDecisionMode = 'ok';
coreDecisionPaths = createValidCoreDecisionPaths();
const hudSnapshot = {
    ok: true, writable: true, fileName: 'isolated-hud-integration.json',
    messages: [{ role: 'character', speaker: 'Test Heroine', text: '装备：银盾\n道具：药水 ×2\n技能：守护' }],
};
fetchCalls = [];
await globalThis.__GALGAME_TEST_RENDER_CHAT__(hudSnapshot, { messageIndex: 0, instant: true });
for (let turn = 1; turn <= 20; turn++) {
    hudSnapshot.messages.push({ role: 'character', speaker: 'Test Heroine', text: `第 ${turn} 段普通对白。` });
    await globalThis.__GALGAME_TEST_RENDER_CHAT__(hudSnapshot, { messageIndex: turn, instant: true });
    const hudRequest = fetchCalls.filter((call) => call.url.endsWith('/v1/core/visual-decisions')).at(-1);
    assert.ok(hudRequest, `visual decision request missing at HUD history turn ${turn}`);
    const requestBody = JSON.parse(hudRequest.options.body);
    assert.ok(requestBody.projection.entities.length <= 32, 'visual projection stays within the protocol entity cap');
    const visibleHudEntities = requestBody.projection.entities.filter((entity) => entity.visibleAttributes.some((attribute) => (
        ['equipment-visible-label', 'item-visible-label', 'skill-visible-label'].includes(attribute.code)
    )));
    for (const [type, name, code] of [
        ['equipment', '银盾', 'equipment-visible-label'],
        ['item', '药水 ×2', 'item-visible-label'],
        ['skill', '守护', 'skill-visible-label'],
    ]) {
        const matches = visibleHudEntities.filter((entity) => entity.entityType === type
            && entity.visibleAttributes.some((attribute) => attribute.code === code && attribute.value === name));
        assert.equal(matches.length, 1, `${type} uses the exact latest HUD label as explicit visual evidence`);
        const selected = lastCoreDecisionExchange.decisions.find((decision) => decision.entityType === type);
        assert.equal(selected?.entityKey, matches[0].entityKey,
            'the selected decision must be tied to an entity created from an actual visible HUD label');
    }
    assert.equal(visibleHudEntities.some((entity) => entity.visibleAttributes.some((attribute) => /第 \d+ 段普通对白/u.test(attribute.value))), false,
        'unrelated story text does not become HUD label evidence');
    for (const [type, name] of [['equipment', '银盾'], ['item', '药水 ×2'], ['skill', '守护']]) {
        const icon = visualIconStripElement.children.find((entry) => entry.classList.contains(`visual-icon-${type}`));
        assert.ok(icon, `missing ${type} card at turn ${turn}`);
        assert.ok(icon.querySelector('small').textContent.includes(name));
        assert.equal(icon.querySelector('.visual-icon-source').textContent, '最近记录');
    }
}

const manyHudLabels = [
    ...Array.from({ length: 40 }, (_, index) => `装备：物品${index}`),
    '道具：药水',
    '技能：守护',
].join('\n');
const manyHudSnapshot = {
    ok: true, writable: true, fileName: 'many-hud-labels.json',
    messages: [{ role: 'character', speaker: 'Test Heroine', text: manyHudLabels }],
};
fetchCalls = [];
await globalThis.__GALGAME_TEST_RENDER_CHAT__(manyHudSnapshot, { messageIndex: 0, instant: true });
const boundedHudRequest = JSON.parse(fetchCalls.find((call) => call.url.endsWith('/v1/core/visual-decisions')).options.body);
assert.ok(boundedHudRequest.projection.entities.length <= 32, 'many labels cannot exceed projection.entities maxLength');
for (const entity of boundedHudRequest.projection.entities) {
    for (const attribute of entity.visibleAttributes) {
        if (attribute.code === 'equipment-visible-label') assert.match(attribute.value, /^物品\d+$/u);
        if (attribute.code === 'item-visible-label') assert.equal(attribute.value, '药水');
        if (attribute.code === 'skill-visible-label') assert.equal(attribute.value, '守护');
    }
}
assert.ok(boundedHudRequest.projection.entities.some((entity) => entity.visibleAttributes.some((attribute) => attribute.code === 'item-visible-label')),
    'round-robin HUD candidates preserve item evidence under the entity cap');
assert.ok(boundedHudRequest.projection.entities.some((entity) => entity.visibleAttributes.some((attribute) => attribute.code === 'skill-visible-label')),
    'round-robin HUD candidates preserve skill evidence under the entity cap');
coreDecisionMode = 'disabled';
visualCoreServiceMeta = 'http://visual-core-hud-disabled.test';
hudSnapshot.messages.push({ role: 'character', speaker: 'Test Heroine', text: '装备：无\n道具：无\n技能：无' });
await globalThis.__GALGAME_TEST_RENDER_CHAT__(hudSnapshot, { messageIndex: 21, instant: true });
for (const icon of visualIconStripElement.children) {
    assert.equal(icon.classList.contains('is-visual-active'), false);
    assert.ok(icon.querySelector('figcaption').textContent.endsWith(' · 0'));
    assert.equal(icon.querySelector('small').textContent, '无');
}

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
        schemaVersion: 'galgame.visual-core-context.v2',
        enabled: true,
        activeCatalog: {
            catalogId: 'catalog_core_player',
            catalogRevision: 1,
            catalogHash: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
        },
        characterChannels: coreCatalogCharacterChannels.map((entry) => ({ ...entry })),
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
        characterChannels: context.characterChannels,
        visualProfile: context.visualProfile,
        source: context.source,
        sourceVersion: context.sourceVersion,
    }));
    return context;
}

async function waitForCoreDecision() {
    let timer;
    try {
        await Promise.race([
            pendingVisualWork,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Current visual render did not settle')), 5000); }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function setCoreVisualManifest({ catalogHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222', render = true, includePlayer = false } = {}) {
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
            ...(includePlayer ? { defaults: { playerAssetId: 'asset_character_player_bound' } } : {}),
        },
    }, {
        release: {
            releaseId: 'release.visual.core',
            scenarioId: 'scenario.visual',
            scenarioVersion: '1.0.0',
            activeArcId: 'arc.visual',
        },
        render,
    });
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
    const attributes = {};
    const listeners = new Map();
    const element = {
        hidden: false,
        disabled: false,
        textContent: '',
        value: '',
        type: '',
        get className() { return [...classes].join(' '); },
        set className(value) { classes.clear(); String(value).split(/\s+/u).filter(Boolean).forEach((name) => classes.add(name)); },
        tagName,
        dataset: {},
        attributes,
        style: { setProperty: noop, backgroundImage: '' },
        children: [],
        addEventListener: (name, listener) => {
            if (!listeners.has(name)) listeners.set(name, []);
            listeners.get(name).push(listener);
        },
        dispatch: (name, event = {}) => {
            for (const listener of listeners.get(name) || []) listener({ target: element, currentTarget: element, preventDefault: noop, ...event });
        },
        querySelector: (selector) => element.children.find((child) => selector.startsWith('.') ? child.classList?.contains(selector.slice(1)) : child.tagName === selector) || null,
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
        setAttribute: (name, value) => { attributes[name] = String(value); },
        removeAttribute: (name) => { delete attributes[name]; },
    };
    return element;
}
