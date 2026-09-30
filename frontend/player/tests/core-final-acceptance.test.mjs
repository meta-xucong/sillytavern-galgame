import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
    DICTIONARY_HASH,
    DICTIONARY_VERSION,
    PNG_MIME,
    createVisualAssetService,
    encodePng,
    VISUAL_RUNTIME_HINTS_VERSION,
} from '../../../external-modules/visual-asset-service/server.mjs';

const ADMIN_TOKEN = 'core-final-admin-token';
const ADMIN_ORIGIN = 'http://127.0.0.1:41111';
const PLAYER_ORIGIN = 'http://127.0.0.1:8001';
const PROFILE_HASH = hashDigest('core-final-profile');
const SIMPLE_UPLOAD_SCHEMA_VERSION = 'galgame.visual-simple-upload-request.v1';

globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;
globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ = true;
globalThis.window = {
    location: { origin: PLAYER_ORIGIN },
    setTimeout,
    clearTimeout,
};

const noop = () => {};
const elements = new Map();
const stageBackdropElement = createStubElement('div');
const stageHeroineElement = createStubElement('div');
const visualIconStripElement = createStubElement('div');
const visualStatusElement = createStubElement('p');
const VISUAL_PLACEHOLDER_URL = './assets/visual-placeholder.svg';
const NARRATOR_PLACEHOLDER_URL = './assets/narrator-placeholder.svg';
let visualCoreServiceMeta = '';
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

const nativeFetch = globalThis.fetch;
const networkEvidence = [];
let failImagePathFragment = '';
let catalogAssetTypeById = new Map();
let currentCatalog = null;

globalThis.fetch = async (url, options = {}) => {
    const stringUrl = String(url);
    if (
        stringUrl.includes('/v1/player/visual-bundle')
        || stringUrl.includes('/v1/player/visual-assets/')
        || stringUrl.includes('/v1/visual-match')
    ) {
        throw new Error(`CORE final acceptance must not call legacy/heavy visual route: ${stringUrl}`);
    }
    const nextOptions = { ...options };
    if (stringUrl.endsWith('/v1/core/visual-decisions') || stringUrl.endsWith('/v1/core/visual-context')) {
        nextOptions.headers = { ...(options.headers || {}), origin: PLAYER_ORIGIN };
    }
    const response = await nativeFetch(url, nextOptions);
    let errorCode = '';
    let errorMessage = '';
    if (stringUrl.endsWith('/v1/core/visual-decisions') && !response.ok) {
        const errorBody = await response.clone().json().catch(() => null);
        errorCode = errorBody?.error?.code || '';
        errorMessage = errorBody?.error?.message || '';
    }
    const requestSummary = stringUrl.endsWith('/v1/core/visual-decisions')
        ? summarizeCoreDecisionRequest(options.body)
        : null;
    const responseSummary = stringUrl.endsWith('/v1/core/visual-decisions')
        ? await response.clone().json().catch(() => null)
        : null;
    networkEvidence.push({
        url: stringUrl,
        status: response.status,
        contentType: response.headers.get('content-type') || '',
        contentHash: '',
        errorCode,
        errorMessage,
        requestSummary,
        responseSummary,
    });
    return response;
};

globalThis.Image = class TestImage {
    set src(value) {
        this._src = String(value);
        void this.load();
    }

    get src() {
        return this._src || '';
    }

    async load() {
        if (failImagePathFragment && this.src.includes(failImagePathFragment)) {
            this.onerror?.();
            return;
        }
        try {
            const response = await nativeFetch(this.src);
            const bytes = Buffer.from(await response.arrayBuffer());
            networkEvidence.push({
                url: this.src,
                status: response.status,
                contentType: response.headers.get('content-type') || '',
                contentLength: bytes.length,
                contentHash: response.headers.get('x-galgame-asset-content-sha256') || createHash('sha256').update(bytes).digest('hex'),
            });
            if (response.ok && response.headers.get('content-type') === PNG_MIME && bytes.length > 0) {
                this.onload?.();
            } else {
                this.onerror?.();
            }
        } catch (_error) {
            this.onerror?.();
        }
    }
};

const playerModule = await import('../src/main.js');
const playerHtml = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
const playerCss = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(playerHtml, /id="stageBackdrop"[^>]*aria-hidden="true"/);
assert.match(playerHtml, /class="stage-heroine"[^>]*aria-hidden="true"/);
assert.match(playerHtml, /id="visualIconStrip"[^>]*aria-label="视觉图标"/);
assert.match(playerCss, /@media \(max-width: 860px\)/);

const unavailableService = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ADMIN_ORIGIN] });
await withServer(unavailableService, async (baseUrl) => {
    resetAcceptanceEvidence();
    visualCoreServiceMeta = baseUrl;
    const { catalog, uploadedAssets } = await preparePublishedCatalog(baseUrl, { expectedAnalysisStatus: 'unavailable' });
    assert.equal(uploadedAssets.every(({ asset }) => asset.analysisStatus === 'unavailable'), true);
    assert.equal(uploadedAssets.every(({ asset }) => asset.analysis.tagCodes.length === 0 && asset.analysis.attributeCodes.length === 0), true);
    assert.equal(uploadedAssets.some(({ asset }) => asset.tagCodes.length > 0), true);
    setManifestForCatalog(catalog, { bindCharacter: false });

    await renderMessage(acceptanceMessage(), { expectedDecisionReads: 1, expectedContentReads: 2 });

    assert.equal(fetchCount('/v1/core/visual-decisions'), 1);
    assert.equal(contentReadCount(), 2);
    assert.deepEqual(activeVisualClasses(), {
        backdrop: true,
        heroine: false,
        icons: [
            'visual-icon visual-icon-equipment is-unavailable is-placeholder',
            'visual-icon visual-icon-item is-visual-active',
            'visual-icon visual-icon-skill is-unavailable is-placeholder',
        ],
    });
    assert.equal(stageBackdropElement.style.backgroundImage.includes(catalogContentPath('scene')), true);
    assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`);
    assert.deepEqual(visualIconStripElement.children.map((item) => item.children[0].src), [
        VISUAL_PLACEHOLDER_URL,
        `${baseUrl}${catalogContentPath('item')}`,
        VISUAL_PLACEHOLDER_URL,
    ]);
    const decisions = latestDecisionResponse().decisions;
    const sceneDecision = decisions.find((decision) => decision.entityType === 'scene');
    assert.equal(sceneDecision.assetId, catalog.assetRefs.find((ref) => ref.assetType === 'scene').assetId);
    assert.ok(sceneDecision.score >= 60);
    const itemDecision = decisions.find((decision) => decision.entityType === 'item');
    assert.equal(itemDecision.assetId, catalog.assetRefs.find((ref) => ref.assetType === 'item').assetId);
    assert.ok(itemDecision.score >= 60);
    const equipmentDecision = decisions.find((decision) => decision.entityType === 'equipment');
    assert.equal(equipmentDecision.score, 50);
    assert.deepEqual(equipmentDecision.reasonCodes, ['type-match', 'unknown-fallback']);
    const skillDecision = decisions.find((decision) => decision.entityType === 'skill');
    assert.equal(skillDecision.score, 0);
    assert.deepEqual(skillDecision.reasonCodes, ['candidate-empty']);
});

const analyzerRequests = [];
const analyzerCodesByType = {
    scene: 'scene.forest',
    character: 'character.human',
    equipment: 'equipment.weapon',
    item: 'item.key',
    skill: 'skill.fireball',
};
const analyzerService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ADMIN_ORIGIN],
    visualRuntimeAnalyzer: async ({ visibleContext }) => {
        const text = visibleContext.current.text;
        const codeByType = {
            scene: /森林/u.test(text) ? 'scene.forest' : null,
            character: /人类/u.test(text) ? 'character.human' : null,
            equipment: /剑/u.test(text) ? 'equipment.weapon' : null,
            item: /钥匙/u.test(text) ? 'item.key' : null,
            skill: /火球术/u.test(text) ? 'skill.fireball' : null,
        };
        const entities = Object.entries(codeByType)
            .filter(([, code]) => code)
            .map(([entityType, code]) => ({
                entityType,
                codes: [code],
                confidence: 0.95,
                confidenceBand: 'explicit',
            }));
        return {
            schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
            status: entities.length ? 'ready' : 'ambiguous',
            dictionaryVersion: DICTIONARY_VERSION,
            dictionaryHash: DICTIONARY_HASH,
            entities,
        };
    },
    visualAnalyzer: async (request) => {
        analyzerRequests.push(request);
        return {
            description: `test-only closed analysis for ${request.assetType}`,
            tagCodes: [analyzerCodesByType[request.assetType]],
            attributeCodes: [],
            confidence: 0.95,
            analyzerVersion: 'test-only-independent-analyzer-v1',
        };
    },
});
await withServer(analyzerService, async (baseUrl) => {
    resetAcceptanceEvidence();
    visualCoreServiceMeta = baseUrl;
    const { catalog } = await preparePublishedCatalog(baseUrl, { expectedAnalysisStatus: 'ready' });
    setManifestForCatalog(catalog);

    assert.equal(analyzerRequests.length, 5);
    assert.equal(analyzerRequests.every((request) => (
        Object.keys(request).sort().join(',') === 'assetType,contentHash,imageBase64,schemaVersion,task'
        && !Object.hasOwn(request, 'chat')
        && !Object.hasOwn(request, 'context')
        && !Object.hasOwn(request, 'prompt')
        && !Object.hasOwn(request, 'resourceBody')
        && !Object.values(request).some((value) => String(value).includes('ST key'))
    )), true);

    await renderMessage(acceptanceMessage(), { expectedDecisionReads: 1, expectedContentReads: 5 });

    assert.equal(fetchCount('/v1/core/visual-decisions'), 1);
    assert.deepEqual(activeVisualClasses(), {
        backdrop: true,
        heroine: true,
        icons: ['visual-icon visual-icon-equipment is-visual-active', 'visual-icon visual-icon-item is-visual-active', 'visual-icon visual-icon-skill is-visual-active'],
    });
    assert.equal(stageBackdropElement.style.backgroundImage.includes(catalogContentPath('scene')), true);
    assert.equal(stageHeroineElement.style.backgroundImage.includes(catalogContentPath('character')), true);
    assert.deepEqual(contentReadsByType().sort(), ['character', 'equipment', 'item', 'scene', 'skill']);

    const decisionBodies = networkEvidence.filter((entry) => entry.url.endsWith('/v1/core/visual-decisions'));
    assert.equal(decisionBodies.every((entry) => entry.contentType.includes('application/json')), true);
    assert.deepEqual([...new Set(decisionBodies.at(-1).requestSummary.entityTypes)].sort(), ['character', 'equipment', 'item', 'scene', 'skill']);
    assert.equal(decisionBodies.at(-1).responseSummary.decisions
        .filter((decision) => decision.entityType !== 'character')
        .every((decision) => decision.reasonCodes.includes('tag-overlap')), true);
    assert.equal(decisionBodies.at(-1).responseSummary.decisions.every((decision) => !decision.assetId.startsWith('unknown_')), true);

    await renderMessage({
        speaker: '银发骑士',
        text: '她望向雨幕，台词没有任何视觉素材标签。',
    }, { expectedDecisionReads: 1, expectedContentReads: 0 });
    assert.equal(stageBackdropElement.style.backgroundImage.includes(catalogContentPath('scene')), true);
    assert.equal(stageHeroineElement.style.backgroundImage, `url("${NARRATOR_PLACEHOLDER_URL}")`);
    assert.deepEqual(visualIconStripElement.children.map((item) => item.className), [
        'visual-icon visual-icon-equipment is-visual-active',
        'visual-icon visual-icon-item is-visual-active',
        'visual-icon visual-icon-skill is-visual-active',
    ]);

    failImagePathFragment = catalogContentPath('character');
    await renderMessage(acceptanceMessage(), { expectedDecisionReads: 1, expectedContentReads: 4 });
    assert.equal(stageHeroineElement.style.backgroundImage, `url("${VISUAL_PLACEHOLDER_URL}")`);
    assert.equal(stageBackdropElement.classList.contains('is-visual-active'), true);

    failImagePathFragment = catalogContentPath('equipment');
    await renderMessage(acceptanceMessage(), { expectedDecisionReads: 1, expectedContentReads: 4 });
    assert.equal(visualIconStripElement.children[0].className, 'visual-icon visual-icon-equipment is-visual-active');
    assert.equal(visualIconStripElement.children[0].children[0].src.includes(catalogContentPath('equipment')), true);
    assert.equal(visualIconStripElement.children[1].className, 'visual-icon visual-icon-item is-visual-active');

    failImagePathFragment = '';
    visualCoreServiceMeta = 'http://127.0.0.1:9';
    await renderMessage({
        speaker: '银发骑士',
        text: '场景: 雨中的旧庭院',
    }, { expectedDecisionReads: 0, expectedContentReads: 0 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
    assert.equal(stageHeroineElement.style.backgroundImage, `url(\"${NARRATOR_PLACEHOLDER_URL}\")`);
    assert.equal(visualStatusElement.hidden, true);
});

const playerSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
assert.equal(/playerVisualSessionReader|visual-bundle|visual-assets|projection-proof|restore-proof|\/v1\/visual-match|binding writer|provider|\bLLM\b/i.test(playerSource), false);
assert.match(playerSource, /runtimeBridge\.generateReply/);
    assert.equal(stageBackdropElement.style.backgroundImage, 'url("/assets/default-background.png")');
    assert.equal(stageHeroineElement.style.backgroundImage, `url(\"${NARRATOR_PLACEHOLDER_URL}\")`);

console.log('CORE-5 focused final acceptance tests passed: unavailable fallback and test-only analyzer overlap paths');

async function preparePublishedCatalog(baseUrl, { expectedAnalysisStatus = null } = {}) {
    const uploadedAssets = [];
    for (const asset of [
        ['scene', '雨中的旧庭院', ['scene.forest'], makePng({ colorType: 2, rgb: [22, 44, 66] })],
        ['character', '银发骑士', ['character.human'], makePng({ colorType: 6, rgb: [180, 180, 220], alpha: 0 })],
        ['equipment', '银色盾牌', ['equipment.armor'], makePng({ colorType: 2, rgb: [120, 130, 140] })],
        ['item', '蓝色钥匙', ['item.key'], makePng({ colorType: 2, rgb: [30, 80, 180] })],
        ['skill', '火球术', ['skill.fireball'], makePng({ colorType: 2, rgb: [120, 210, 230] })],
    ]) {
        const [assetType, title, tagCodes, png] = asset;
        const response = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
            token: ADMIN_TOKEN,
            origin: ADMIN_ORIGIN,
            body: {
                schemaVersion: SIMPLE_UPLOAD_SCHEMA_VERSION,
                assetType,
                title,
                tagCodes,
                imageBase64: png.toString('base64'),
                fileName: `${assetType}.png`,
            },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        if (expectedAnalysisStatus !== null) {
            assert.equal(response.body.asset.analysisStatus, expectedAnalysisStatus, JSON.stringify(response.body));
            assert.equal(response.body.asset.analysis.status, expectedAnalysisStatus, JSON.stringify(response.body));
        }
        uploadedAssets.push({ assetType, asset: response.body.asset });
    }
    const published = await request(baseUrl, 'POST', '/v1/admin/visual/publish', {
        token: ADMIN_TOKEN,
        origin: ADMIN_ORIGIN,
        body: {},
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.visual.ready, true, JSON.stringify(published.body));
    assert.equal(published.body.catalog.status, 'published');
    assert.equal(published.body.catalog.assetRefs.length, 5);
    currentCatalog = published.body.catalog;
    catalogAssetTypeById = new Map(currentCatalog.assetRefs.map((ref) => [ref.assetId, ref.assetType]));
    return { catalog: currentCatalog, uploadedAssets };
}

function acceptanceMessage() {
    return {
        speaker: '人类骑士',
        text: [
            '角色: 人类',
            '场景: 森林',
            '装备: 剑',
            '道具: 钥匙',
            '技能: 火球术',
        ].join('\n'),
    };
}

function unavailableVisualClasses() {
    return {
        backdrop: false,
        heroine: false,
icons: ['visual-icon visual-icon-equipment is-unavailable is-placeholder', 'visual-icon visual-icon-item is-unavailable is-placeholder', 'visual-icon visual-icon-skill is-unavailable is-placeholder'],
    };
}

function latestDecisionResponse() {
    const entry = networkEvidence.filter((item) => item.url.endsWith('/v1/core/visual-decisions')).at(-1);
    assert.ok(entry?.responseSummary, 'missing core decision response evidence');
    return entry.responseSummary;
}

function resetAcceptanceEvidence() {
    networkEvidence.splice(0);
    failImagePathFragment = '';
    catalogAssetTypeById = new Map();
    currentCatalog = null;
}

function setManifestForCatalog(catalog, { bindCharacter = true } = {}) {
    globalThis.__GALGAME_TEST_SET_MANIFEST__({
        id: 'scenario_core_final',
        title: 'Core Final Visual Test',
        version: '1.0.0',
        defaultArcId: 'arc_core_final',
        visualPresentation: {
            visualProfileId: 'vprof_corefinal',
            profileHash: PROFILE_HASH,
            catalogId: catalog.catalogId,
            catalogRevision: catalog.catalogRevision,
            catalogHash: catalog.catalogHash,
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
                    displayName: '银发骑士',
                    sprite: 'hero-sprite',
                },
            },
        },
        visualBindings: {
            schemaVersion: 'galgame.visual-character-bindings.v1',
            characters: bindCharacter ? [{
                characterKey: '人类骑士',
                aliases: ['人类'],
                assetId: catalog.assetRefs.find((item) => item.assetType === 'character')?.assetId,
                assetVersion: 1,
                channel: 'character',
            }] : [],
        },
    }, {
        release: {
            releaseId: 'release_core_final',
            scenarioId: 'scenario_core_final',
            scenarioVersion: '1.0.0',
            activeArcId: 'arc_core_final',
        },
    });
}

async function renderMessage({ speaker, text }, { expectedDecisionReads = 0, expectedContentReads = 0 } = {}) {
    const decisionReadsBefore = fetchCount('/v1/core/visual-decisions');
    const contentReadsBefore = contentReadCount();
    globalThis.__GALGAME_TEST_RENDER_CHAT__({
        ok: true,
        fileName: 'chat-core-final.json',
        writable: true,
        messages: [{
            role: 'character',
            speaker,
            displayText: text,
            text,
        }],
    }, { messageIndex: 0 });
    await waitFor(() => (
        fetchCount('/v1/core/visual-decisions') >= decisionReadsBefore + expectedDecisionReads
        && contentReadCount() >= contentReadsBefore + expectedContentReads
    ), 1500, () => ({
        expectedDecisionReads,
        expectedContentReads,
        decisionReads: fetchCount('/v1/core/visual-decisions') - decisionReadsBefore,
        contentReads: contentReadCount() - contentReadsBefore,
        recent: networkEvidence.slice(-8),
            classes: activeVisualClasses(),
        }));
    await new Promise((resolve) => setTimeout(resolve, 0));
}

function activeVisualClasses() {
    return {
        backdrop: stageBackdropElement.classList.contains('is-visual-active'),
        heroine: stageHeroineElement.classList.contains('is-visual-active'),
        icons: visualIconStripElement.children.map((item) => item.className),
    };
}

function contentReadsByType() {
    return networkEvidence
        .filter((entry) => entry.url.includes('/v1/core/catalogs/') && entry.url.endsWith('/content') && entry.status === 200)
        .map((entry) => {
            assert.equal(entry.contentType, PNG_MIME);
            assert.ok(Number(entry.contentLength) > 0);
            assert.match(entry.contentHash, /^[a-f0-9]{64}$/);
            const match = entry.url.match(/assets\/(asset_[a-z0-9_-]+)\/([1-9][0-9]{0,5})\/content$/);
            assert.ok(match, entry.url);
            return catalogAssetTypeById.get(match[1]) || '';
        });
}

function catalogContentPath(type) {
    const ref = currentCatalog?.assetRefs?.find((item) => item.assetType === type);
    assert.ok(ref, `missing catalog ref for ${type}`);
    return `/v1/core/catalogs/${currentCatalog.catalogId}/${currentCatalog.catalogRevision}/assets/${ref.assetId}/${ref.assetVersion}/content`;
}

function fetchCount(pathname) {
    return networkEvidence.filter((entry) => entry.url.endsWith(pathname)).length;
}

function contentReadCount() {
    return networkEvidence.filter((entry) => entry.url.includes('/v1/core/catalogs/') && entry.url.endsWith('/content')).length;
}

function summarizeCoreDecisionRequest(body) {
    try {
        const parsed = JSON.parse(String(body || '{}'));
        return {
            requestId: parsed.requestId,
            schemaVersion: parsed.schemaVersion,
            projectionId: parsed.projection?.projectionId,
            projectionHash: parsed.projection?.projectionHash,
            sourceMessageHash: parsed.projection?.sourceMessageHash,
            expectedProjectionHash: parsed.expectedProjectionHash,
            expectedSourceMessageHash: parsed.expectedSourceMessageHash,
            createdAt: parsed.createdAt,
            releaseId: parsed.projection?.releaseId,
            scenarioId: parsed.projection?.scenarioId,
            scenarioVersion: parsed.projection?.scenarioVersion,
            arcId: parsed.projection?.arcId,
            chatId: parsed.projection?.chatId,
            visualProfileId: parsed.visualProfile?.visualProfileId,
            profileHash: parsed.visualProfile?.profileHash,
            catalogId: parsed.visualProfile?.catalogId,
            catalogRevision: parsed.visualProfile?.catalogRevision,
            catalogHash: parsed.visualProfile?.catalogHash,
            entityTypes: parsed.projection?.entities?.map((entity) => entity.entityType),
            entityKeys: parsed.projection?.entities?.map((entity) => entity.entityKey),
            entityLabels: parsed.projection?.entities?.map((entity) => entity.displayLabel),
            characterAttributes: parsed.projection?.entities
                ?.filter((entity) => entity.entityType === 'character')
                ?.map((entity) => entity.visibleAttributes.map((attribute) => attribute.code)),
        };
    } catch (_error) {
        return { parseError: true };
    }
}

async function withServer(service, fn) {
    const server = http.createServer(service.handleRequest);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        return await fn(`http://127.0.0.1:${port}`);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

async function request(baseUrl, method, pathname, { token = null, origin = null, body } = {}) {
    const headers = {};
    if (token !== null) headers.authorization = `Bearer ${token}`;
    if (origin !== null) headers.origin = origin;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await nativeFetch(`${baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
}

function makePng({ width = 2, height = 2, colorType = 2, rgb = [10, 20, 30], alpha = 255 } = {}) {
    const channels = colorType === 6 ? 4 : 3;
    const rowBytes = width * channels;
    const scanlines = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y += 1) {
        const rowStart = y * (rowBytes + 1);
        scanlines[rowStart] = 0;
        for (let x = 0; x < width; x += 1) {
            const p = rowStart + 1 + x * channels;
            scanlines[p] = rgb[0];
            scanlines[p + 1] = rgb[1];
            scanlines[p + 2] = rgb[2];
            if (channels === 4) scanlines[p + 3] = alpha;
        }
    }
    return encodePng({
        width,
        height,
        bitDepth: 8,
        colorType,
        compression: 0,
        filter: 0,
        interlace: 0,
    }, scanlines);
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

async function waitFor(predicate, timeoutMs, describe = () => ({})) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`timed out waiting for CORE visual acceptance condition: ${JSON.stringify(describe())}`);
}

function hashDigest(value) {
    return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}
