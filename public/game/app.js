import { createReleaseStore } from './shared/config-service.js?v=auto-2a72e2a79a23';
import {
    getAssetUrl,
    getVisualCharacterBindings,
    resolveVisualCharacterBinding,
    getActiveSillyTavernBindings,
    materializeManifestForArc,
    resolveAdaptivePresentationProfileBinding,
} from './shared/protocol.js?v=auto-2a72e2a79a23';
import {
    AUTO_SAVE_ID,
    createCanonicalPlayerSaveRelease,
    createPlayerSaveStore,
    manualSaveIds,
} from './shared/player-save.js?v=auto-2a72e2a79a23';
import {
    createCoreVisualDisplayEntityHints,
    createCoreVisualDisplayEntityKey,
    detectIncompleteRpgResponse,
    createVisualNovelDisplaySegments,
    OriginalRuntimeBridgeClient,
    SillyTavernOriginalChatBridge,
} from './shared/sillytavern-adapter.js?v=auto-2a72e2a79a23';
import { extractAdaptivePresentation } from './shared/adaptive-presentation.js?v=auto-2a72e2a79a23';
import { createDefaultAdaptivePresentationProfile } from './shared/adaptive-presentation-schema.js?v=auto-2a72e2a79a23';
import { normalizeVisualRuntimeMessage } from './shared/visual-system-schema.js?v=auto-2a72e2a79a23';
import { createConnectionHealthMonitor } from './shared/connection-health.js?v=auto-2a72e2a79a23';

const releaseStore = createReleaseStore(null, { fallbackToLocal: false });
const playerSaveStore = createPlayerSaveStore();
const chatBridge = new SillyTavernOriginalChatBridge({ baseUrl: getSillyTavernBaseUrl() });
const runtimeBridge = new OriginalRuntimeBridgeClient({
    baseUrl: getOriginalRuntimeBridgeUrl(),
    sillyTavernBaseUrl: getSillyTavernRuntimeBaseUrl(),
});
const ORIGINAL_RUNTIME_BRIDGE_PORTS = [8795, 8799, 8800, 8796, 8797];
const VISUAL_ICON_TYPES = Object.freeze(['equipment', 'item', 'skill']);
function getVisualCardModule(type) {
    if (type === 'item') return 'inventory';
    if (type === 'skill') return 'abilities';
    return '';
}

function getVisualCardType(moduleId) {
    if (moduleId === 'inventory') return 'item';
    if (moduleId === 'abilities') return 'skill';
    return '';
}
const RIGHT_TOP_ADAPTIVE_MODULES = new Set(['inventory', 'abilities']);
const CORE_VISUAL_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
const CORE_VISUAL_DECISION_REQUEST_VERSION = 'galgame.visual-core-visual-decisions-request.v2';
const CORE_VISUAL_DECISION_RESPONSE_VERSION = 'galgame.visual-core-visual-decisions-response.v2';
const CORE_VISUAL_CONTEXT_RESPONSE_VERSION = 'galgame.visual-core-context.v1';
const CORE_VISUAL_PLACEHOLDER_URL = './assets/visual-placeholder.svg';
const CORE_NARRATOR_PLACEHOLDER_URL = './assets/narrator-placeholder.svg';
const CORE_PLAYER_PLACEHOLDER_URL = './assets/player-placeholder.svg';
const VISUAL_CONTEXT_REVALIDATION_INTERVAL_MS = 30_000;
const CORE_VISUAL_LOCAL_DISABLE_CODES = new Set([
    'VISUAL_CORE_DISABLED',
    'VISUAL_CORE_NO_ACTIVE_CATALOG',
    'VISUAL_CORE_SERVICE_UNAVAILABLE',
    'VISUAL_CORE_SERVICE_REJECTED',
    'VISUAL_CORE_SERVICE_INVALID_RESPONSE',
    'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT',
    'VISUAL_CORE_CONTEXT_ORIGIN_REJECTED',
    'VISUAL_CORE_CONTEXT_METHOD_NOT_ALLOWED',
    'VISUAL_CORE_CONTEXT_INVALID',
    'VISUAL_CORE_CONTEXT_UNAVAILABLE',
]);
const coreVisualAvailability = {
    skipRequests: false,
    reasonCode: '',
    contextKey: '',
    baseContextKey: '',
    context: null,
    contextPromise: null,
    nextProbeAt: 0,
};
let runtimeBridgeDiscoveryPromise = null;
let connectionHealthMonitor = null;
let visualBundleRequestToken = 0;
let coreVisualHasVerifiedPresentation = false;
// Keep the last verified decision per visual layer. A new dialogue may update
// one layer while the established scene, character or icon remains valid.
const coreVisualPresentationState = new Map();
// Keep every matched visible entity for the detail drawer. The render layer
// uses the first decision for the icon, while the drawer can show all items.
const coreVisualPresentationDetails = new Map();
const activeVisualDetailHints = new Map();
let immediateVisualCharacterIdentity = '';

const ui = {
    connectionStatus: document.querySelector('#connectionStatus'),
    titleBackdrop: document.querySelector('#titleBackdrop'),
    titleHeroine: document.querySelector('.title-heroine'),
    gameScreen: document.querySelector('#gameScreen'),
    titleScreen: document.querySelector('#titleScreen'),
    stageBackdrop: document.querySelector('#stageBackdrop'),
    stageHeroine: document.querySelector('.stage-heroine'),
    visualPresentation: document.querySelector('#visualPresentation'),
    visualIconStrip: document.querySelector('#visualIconStrip'),
    visualStatus: document.querySelector('#visualStatus'),
    gameTitle: document.querySelector('#gameTitle'),
    stageTitle: document.querySelector('#stageTitle'),
    releaseNote: document.querySelector('#releaseNote'),
    storyPicker: document.querySelector('#storyPicker'),
    storyPickerStatus: document.querySelector('#storyPickerStatus'),
    storyChoiceList: document.querySelector('#storyChoiceList'),
    adaptivePanels: document.querySelector('#adaptivePanels'),
    dialogueBox: document.querySelector('#dialogueBox'),
    speakerName: document.querySelector('#speakerName'),
    dialogueText: document.querySelector('#dialogueText'),
    stageStatus: document.querySelector('#stageStatus'),
    suggestedActions: document.querySelector('#suggestedActions'),
    playerInputForm: document.querySelector('#playerInputForm'),
    playerInput: document.querySelector('#playerInput'),
    sendButton: document.querySelector('#sendButton'),
    recoveryActions: document.querySelector('#recoveryActions'),
    refreshStoryButton: document.querySelector('#refreshStoryButton'),
    startButton: document.querySelector('#startButton'),
    continueButton: document.querySelector('#continueButton'),
    loadButtonTitle: document.querySelector('#loadButtonTitle'),
    settingsButtonTitle: document.querySelector('#settingsButtonTitle'),
    historyButton: document.querySelector('#historyButton'),
    saveButton: document.querySelector('#saveButton'),
    loadButtonStage: document.querySelector('#loadButtonStage'),
    settingsButtonStage: document.querySelector('#settingsButtonStage'),
    backButton: document.querySelector('#backButton'),
    drawerBackdrop: document.querySelector('#drawerBackdrop'),
    historyDrawer: document.querySelector('#historyDrawer'),
    historyList: document.querySelector('#historyList'),
    saveLoadDrawer: document.querySelector('#saveLoadDrawer'),
    saveLoadTitle: document.querySelector('#saveLoadTitle'),
    saveLoadList: document.querySelector('#saveLoadList'),
    settingsDrawer: document.querySelector('#settingsDrawer'),
    adaptiveDetailDrawer: document.querySelector('#adaptiveDetailDrawer'),
    adaptiveDetailTitle: document.querySelector('#adaptiveDetailTitle'),
    adaptiveDetailBody: document.querySelector('#adaptiveDetailBody'),
    adaptiveDetailClose: document.querySelector('#adaptiveDetailClose'),
    fontSizeButton: document.querySelector('#fontSizeButton'),
    motionButton: document.querySelector('#motionButton'),
    toast: document.querySelector('#toast'),
};

const adaptiveTemplateMatrix = Object.freeze({
    'visual-novel': {
        primary: 'actions',
        order: ['actions', 'notes', 'events', 'relationships', 'locations', 'objectives'],
    },
    'rpg-adventure': {
    primary: 'rpg-status',
    order: ['rpg-status', 'dice', 'inventory', 'abilities', 'resources', 'objectives', 'quests', 'locations', 'factions', 'notes'],
    },
    'romance-social': {
        primary: 'affection',
        order: ['affection', 'relationships', 'gifts', 'calendar', 'events', 'actions', 'notes'],
    },
    'mystery-investigation': {
        primary: 'clues',
        order: ['clues', 'suspects', 'locations', 'objectives', 'events', 'notes', 'actions'],
    },
    'management-sim': {
        primary: 'resources',
        order: ['resources', 'factions', 'objectives', 'calendar', 'events', 'locations', 'notes', 'actions'],
    },
    'sandbox-roleplay': {
        primary: 'locations',
        order: ['locations', 'relationships', 'factions', 'objectives', 'notes', 'actions', 'events'],
    },
});

let manifest = null;
let release = null;
let playableStories = [];
let activeChatSnapshot = null;
let activeMessageIndex = -1;
let pageIndex = 0;
let inputPending = false;
let generationPending = false;
let textSizeMode = 'standard';
let motionEnabled = true;
let releaseReadyPromise = null;
let activeMessageSegments = [];
let activeSegmentIndex = 0;
let activeRenderContext = null;
let typewriterTimer = null;
let typewriterToken = 0;
let typewriterRunning = false;
let typewriterFullText = '';
let adaptiveDetailReturnFocus = null;
let adaptiveDetailReturnModule = '';
let activeAdaptivePanelResults = new Map();
let visibleRuntimeChatKey = '';
const visibleRuntimeMessages = new Map();

if (!globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__) {
    bootstrap().catch(() => {
        showToast('暂时无法开始');
    });
}

if (globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__) {
    globalThis.__GALGAME_TEST_SET_MANIFEST__ = (nextManifest, { release: nextRelease = null, render = true } = {}) => {
        manifest = nextManifest;
        release = nextRelease;
        if (!render) {
            return;
        }
        ui.titleScreen.hidden = true;
        ui.gameScreen.hidden = false;
        renderTitle();
        renderStage();
    };
    globalThis.__GALGAME_TEST_RENDER_ADAPTIVE__ = (snapshot, messageIndex = 0) => {
        activeChatSnapshot = snapshot;
        activeMessageIndex = Number.isInteger(Number(messageIndex)) ? Number(messageIndex) : 0;
        const message = snapshot?.messages?.[activeMessageIndex] || snapshot?.messages?.[0] || null;
        renderAdaptivePanels(message, snapshot, activeMessageIndex);
    };
    globalThis.__GALGAME_TEST_RENDER_CHAT__ = (snapshot, options = {}) => {
        activeChatSnapshot = snapshot;
        renderChatSnapshot(snapshot, options);
    };
    globalThis.__GALGAME_TEST_START__ = () => startNewGame();
    globalThis.__GALGAME_TEST_CONTINUE__ = () => continueFromSaveOrLatest();
    globalThis.__GALGAME_TEST_LOAD_SAVE__ = (saveId = AUTO_SAVE_ID) => loadPlayerSave(saveId);
    globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__ = () => activeChatSnapshot;
}

async function bootstrap() {
    bindEvents();
    setupConnectionHealthMonitor();
    renderTitle();
    await refreshTitleSaveState();
    releaseReadyPromise = refreshRelease()
        .then(async () => {
            await refreshPlayableStories();
            renderTitle();
            await refreshTitleSaveState();
        })
        .catch((error) => {
            console.warn('Galgame release refresh failed.', error);
        });
}

function setupConnectionHealthMonitor() {
    if (connectionHealthMonitor) return connectionHealthMonitor;
    connectionHealthMonitor = createConnectionHealthMonitor({
        intervalMs: 10_000,
        timeoutMs: 5_000,
        probes: {
            sillyTavern: (signal) => chatBridge.healthCheck(signal),
            configService: (signal) => releaseStore.publicHealthCheck(signal),
            runtimeBridge: (signal) => probeRuntimeBridge(signal),
            visualService: (signal) => probeVisualService(signal),
        },
    });
    connectionHealthMonitor.subscribe(renderConnectionHealth);
    connectionHealthMonitor.start();
    const updateAfterBrowserNetworkChange = () => {
        void connectionHealthMonitor?.probeNow({ reason: navigator.onLine === false ? 'browser-offline' : 'browser-online' });
    };
    window.addEventListener('online', updateAfterBrowserNetworkChange);
    window.addEventListener('offline', updateAfterBrowserNetworkChange);
    return connectionHealthMonitor;
}

async function probeRuntimeBridge(signal) {
    if (!runtimeBridge.isConfigured()) {
        if (!runtimeBridgeDiscoveryPromise) {
            runtimeBridgeDiscoveryPromise = discoverOriginalRuntimeBridge({ signal })
                .finally(() => {
                    runtimeBridgeDiscoveryPromise = null;
                });
        }
        await runtimeBridgeDiscoveryPromise;
    }
    return runtimeBridge.healthCheck(signal);
}

async function probeVisualService(signal) {
    const baseUrl = getCoreVisualServiceUrl();
    if (!baseUrl) {
        return { ok: false, errorCode: 'VISUAL_SERVICE_UNCONFIGURED' };
    }
    // `/v1/health` is intentionally a local diagnostics endpoint without
    // player CORS headers. The core context route is the browser-safe visual
    // service probe and also confirms that the active catalog is readable.
    const response = await fetch(`${baseUrl}/v1/core/visual-context`, {
        method: 'GET',
        cache: 'no-cache',
        signal,
        headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => ({}));
    return {
        ok: response.ok && body?.ok === true,
        errorCode: response.ok ? '' : `VISUAL_SERVICE_HTTP_${response.status}`,
        service: body?.service || '',
        schema: body?.schemaVersion || '',
        enabled: body?.enabled === true,
        catalogId: body?.visualProfile?.catalogId || '',
    };
}

function renderConnectionHealth(snapshot) {
    if (!ui.connectionStatus || !snapshot) return;
    const generation = snapshot.services?.generation;
    const runtime = snapshot.services?.runtimeBridge;
    const runtimeDetails = runtime?.details || {};
    if (generationPending && (runtimeDetails.stale || runtimeDetails.stopping || runtimeDetails.connectionState === 'stale')) {
        setStageStatus(runtimeDetails.stopping
            ? '运行桥正在停止，请重启桥接服务后再试。'
            : '运行桥响应超时，请重启桥接服务后再试。');
        setRecoveryVisible(true);
    }
    const labels = {
        up: '已连接',
        idle: '待命',
        down: '断开',
        pending: '生成中',
        degraded: '部分异常',
        unknown: '检查中',
    };
    const display = (service) => service?.stale && service?.checkedAt ? '数据过期' : (labels[service?.status] || '检查中');
    const parts = [
        `酒馆 ${display(snapshot.services?.sillyTavern)}`,
        `配置 ${display(snapshot.services?.configService)}`,
        `运行桥 ${display(snapshot.services?.runtimeBridge)}`,
        `视觉 ${display(snapshot.services?.visualService)}`,
    ];
    if (generation?.status && generation.status !== 'unknown') {
        parts.push(`生成 ${labels[generation.status] || generation.status}`);
    }
    const overallLabel = snapshot.overall === 'up' ? '连接正常'
        : snapshot.overall === 'degraded' ? '部分连接异常'
            : snapshot.overall === 'down' ? '连接中断' : '连接检查中';
    ui.connectionStatus.textContent = `${overallLabel} · ${parts.join(' · ')}`;
    ui.connectionStatus.dataset.connectionState = snapshot.overall;
    ui.connectionStatus.title = parts.join('\n');
}

async function refreshRelease() {
    const bundle = await releaseStore.getActiveBundle();
    release = bundle.release;
    if (!bundle.manifest) {
        throw new Error('ACTIVE_SCENARIO_MANIFEST_UNAVAILABLE');
    }
    manifest = bundle.manifest;
}

async function refreshPlayableStories() {
    if (typeof releaseStore.listPlayableScenarios !== 'function') {
        playableStories = [];
        return;
    }
    playableStories = await releaseStore.listPlayableScenarios().catch(() => []);
}

async function ensureReleaseReady() {
    if (releaseReadyPromise) {
        await releaseReadyPromise.catch(() => {});
    }
    if (!release) {
        await refreshRelease();
    }
    if (!manifest) {
        throw new Error('ACTIVE_SCENARIO_UNAVAILABLE');
    }
}

function bindEvents() {
    ui.startButton.addEventListener('click', () => {
        void startNewGame();
    });
    ui.continueButton.addEventListener('click', () => {
        void continueFromSaveOrLatest();
    });
    ui.loadButtonTitle.addEventListener('click', () => {
        void openSaveLoadDrawer('load');
    });
    ui.settingsButtonTitle.addEventListener('click', () => openDrawer(ui.settingsDrawer));
    ui.historyButton.addEventListener('click', () => openHistoryDrawer());
    ui.saveButton.addEventListener('click', () => openSaveLoadDrawer('save'));
    ui.loadButtonStage.addEventListener('click', () => openSaveLoadDrawer('load'));
    ui.settingsButtonStage.addEventListener('click', () => openDrawer(ui.settingsDrawer));
    ui.backButton.addEventListener('click', showTitle);
    ui.drawerBackdrop.addEventListener('click', closeDrawers);
    document.querySelectorAll('[data-close-drawer]').forEach((button) => {
        button.addEventListener('click', closeDrawers);
    });
    ui.adaptiveDetailClose?.addEventListener('click', closeAdaptiveDetail);
    ui.adaptiveDetailDrawer?.querySelector('[data-close-adaptive-detail]')?.addEventListener('click', closeAdaptiveDetail);
    ui.fontSizeButton.addEventListener('click', cycleTextSize);
    ui.motionButton.addEventListener('click', toggleMotion);
    ui.refreshStoryButton.addEventListener('click', () => {
        void retryOrSyncOriginalReply();
    });
    ui.playerInputForm.addEventListener('submit', (event) => {
        void handlePlayerInput(event);
    });
    ui.playerInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            ui.playerInputForm.requestSubmit();
        }
    });
    ui.playerInput.addEventListener('input', () => {
        setInputEnabled(canAcceptPlayerInput());
    });
    ui.dialogueBox.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest('button, textarea, input')) {
            return;
        }
        advanceDialoguePlayback();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && ui.adaptiveDetailDrawer && !ui.adaptiveDetailDrawer.hidden) {
            closeAdaptiveDetail();
            event.preventDefault();
            return;
        }
        if (event.key === 'Tab' && ui.adaptiveDetailDrawer && !ui.adaptiveDetailDrawer.hidden) {
            trapAdaptiveDetailFocus(event);
            return;
        }
        if (![' ', 'Enter'].includes(event.key) || isTextEntryTarget(event.target)) {
            return;
        }
        if (advanceDialoguePlayback()) {
            event.preventDefault();
        }
    });
    ui.suggestedActions.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest('button[data-action-value]');
        if (!button || !canAcceptPlayerInput()) {
            return;
        }
        void submitPlayerMessage(button.dataset.actionValue || button.textContent || '');
    });
}

async function startNewGame() {
    const autoSlot = await playerSaveStore.loadSlot(AUTO_SAVE_ID).catch(() => null);
    if (autoSlot && typeof window.confirm === 'function') {
        const confirmed = window.confirm('开始新游戏会覆盖自动进度。若要保留当前进度，请先在游戏内手动保存到存档槽。仍要开始新游戏吗？');
        if (!confirmed) {
            return;
        }
    }
    await enterGalgameStage('start');
}

function renderTitle() {
    ui.gameTitle.textContent = manifest?.title || '故事尚未发布';
    ui.titleBackdrop.style.backgroundImage = manifest
        ? `url("${getAssetUrl(manifest, manifest.presentation?.titleBackgroundAsset)}")`
        : '';
    ui.titleHeroine.style.backgroundImage = `url("${getTitleSpriteUrl()}")`;
    ui.releaseNote.textContent = release?.scenarioVersion || manifest?.version || '故事准备中';
    ui.continueButton.disabled = true;
    renderStoryPicker();
    renderStage();
}

async function refreshTitleSaveState() {
    const autoSlot = await playerSaveStore.loadSlot(AUTO_SAVE_ID).catch(() => null);
    ui.continueButton.disabled = !autoSlot || !saveSlotMatchesCurrentRelease(autoSlot);
}

function renderStoryPicker() {
    if (!ui.storyPicker || !ui.storyChoiceList) {
        return;
    }
    ui.storyChoiceList.replaceChildren();
    const entries = getVisiblePlayableStories();
    ui.storyPicker.hidden = entries.length <= 1;
    if (ui.storyPickerStatus) {
        ui.storyPickerStatus.textContent = entries.length ? `${entries.length} 部` : '暂无作品';
    }
    for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'story-choice';
        button.classList.toggle('is-active', playableEntryMatchesRelease(entry, release));
        button.style.backgroundImage = entry.coverUrl ? `url("${entry.coverUrl}")` : '';

        const title = document.createElement('strong');
        title.textContent = entry.title || '未命名故事';
        const meta = document.createElement('span');
        const playableArcCount = Number(entry.playableArcCount || entry.arcCount || 0);
        const arcLabel = playableArcCount > 1
            ? `${playableArcCount} 幕`
            : (entry.arcTitle && entry.arcTitle !== entry.title ? entry.arcTitle : '');
        meta.textContent = [
            arcLabel,
            entry.characterName || '',
            entry.isDefault ? '推荐' : '',
        ].filter(Boolean).join(' · ') || '可开始';
        button.append(title, meta);
        button.addEventListener('click', () => {
            void selectPlayableStory(entry);
        });
        ui.storyChoiceList.append(button);
    }
}

function getVisiblePlayableStories() {
    const entries = Array.isArray(playableStories) ? playableStories : [];
    if (entries.length) {
        return entries;
    }
    if (!release || !manifest) {
        return [];
    }
    return [{
        entryId: `${release.scenarioId}@${release.scenarioVersion}#${release.activeArcId || release.arcId || manifest.arcId || manifest.defaultArcId || ''}`,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        arcId: release.activeArcId || release.arcId || manifest.arcId || manifest.defaultArcId || '',
        title: manifest.title,
        arcTitle: '',
        characterName: getMainCharacterName(),
        release,
        isDefault: true,
    }];
}

async function selectPlayableStory(entry) {
    if (playableEntryMatchesRelease(entry, release)) {
        return;
    }
    try {
        const bundle = await releaseStore.getBundleForPlayableScenario(entry);
        release = bundle.release;
        manifest = bundle.manifest;
        activeChatSnapshot = null;
        renderTitle();
        await refreshTitleSaveState();
        showToast(`已选择 ${manifest.title || '故事'}`);
    } catch (error) {
        console.warn('Galgame playable story switch failed.', error);
        showToast('这个故事暂时无法开始');
    }
}

function playableEntryMatchesRelease(entry, targetRelease) {
    if (!entry || !targetRelease) {
        return false;
    }
    const entryArcId = entry.arcId || entry.release?.activeArcId || entry.release?.arcId || '';
    const releaseArcId = targetRelease.activeArcId || targetRelease.arcId || '';
    return entry.scenarioId === targetRelease.scenarioId
        && entry.scenarioVersion === targetRelease.scenarioVersion
        && entryArcId === releaseArcId;
}

function renderStage() {
    clearDialoguePlayback();
    resetCoreVisualAvailability();
    ui.stageTitle.textContent = manifest?.title || '故事尚未发布';
    ui.stageBackdrop.style.backgroundImage = manifest
        ? `url("${getAssetUrl(manifest, manifest.presentation?.defaultBackgroundAsset)}")`
        : '';
    ui.stageHeroine.style.backgroundImage = `url("${getTitleSpriteUrl()}")`;
    resetVisualPresentation();
    ui.speakerName.textContent = getMainCharacterName();
    ui.dialogueText.textContent = '正在连接故事。';
    applySegmentPresentation({ type: 'narration' });
    activeMessageIndex = -1;
    pageIndex = 0;
    setStageStatus('');
    setRecoveryVisible(false);
    renderSuggestedActions();
    ui.playerInput.value = '';
    setInputEnabled(false);
}

async function enterGalgameStage(mode = 'continue') {
    ui.titleScreen.hidden = true;
    ui.gameScreen.hidden = false;
    renderStage();
    try {
        await ensureReleaseReady();
        renderStage();
        await loadOriginalChat(mode);
    } catch (error) {
        console.warn('Galgame active release unavailable.', error);
        activeChatSnapshot = null;
        renderBridgeUnavailable();
    }
}

function showTitle() {
    closeDrawers();
    ui.gameScreen.hidden = true;
    ui.titleScreen.hidden = false;
    void refreshTitleSaveState();
}

async function continueFromSaveOrLatest() {
    await ensureReleaseReady().catch(() => {});
    const autoSlot = await playerSaveStore.loadSlot(AUTO_SAVE_ID).catch(() => null);
    if (autoSlot && saveSlotMatchesCurrentRelease(autoSlot)) {
        const latestRecovery = await tryRecoverLatestBoundChatForSeedAutoSlot({
            autoSlot,
            seedChatId: getCurrentBoundChatSeedId(),
            loadLatestBoundChat: () => chatBridge.loadLatestBoundChat(manifest),
        });
        if (latestRecovery.snapshot?.ok) {
            ui.titleScreen.hidden = true;
            ui.gameScreen.hidden = false;
            renderStage();
            activeChatSnapshot = latestRecovery.snapshot;
            renderChatSnapshot(latestRecovery.snapshot, getLatestSnapshotRenderOptions(latestRecovery.snapshot));
            await persistAutoSave(latestRecovery.snapshot);
            if (snapshotAwaitsReply(latestRecovery.snapshot)) {
                void requestOriginalReply(latestRecovery.snapshot);
            }
            return;
        }
        const loaded = await loadPlayerSave(autoSlot.saveId, { silentFailure: true });
        if (loaded) {
            return;
        }
        showToast('自动进度已失效，已改为读取当前故事');
    } else if (autoSlot) {
        showToast('自动进度不属于当前故事，已改为读取当前故事');
    }
    await enterGalgameStage('continue');
}

function getCurrentBoundChatSeedId() {
    const currentArcId = release?.activeArcId
        || release?.arcId
        || manifest?.arcId
        || manifest?.defaultArcId
        || '';
    return getActiveSillyTavernBindings(manifest, currentArcId)?.chatSeedId || '';
}

function normalizeBoundChatId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

async function tryRecoverLatestBoundChatForSeedAutoSlot({
    autoSlot,
    seedChatId,
    loadLatestBoundChat,
}) {
    const normalizedAutoChatId = normalizeBoundChatId(autoSlot?.chatId);
    const normalizedSeedChatId = normalizeBoundChatId(seedChatId);
    if (!normalizedAutoChatId || !normalizedSeedChatId || normalizedAutoChatId !== normalizedSeedChatId) {
        return {
            attempted: false,
            snapshot: null,
        };
    }

    try {
        const snapshot = await loadLatestBoundChat();
        const normalizedSnapshotChatId = normalizeBoundChatId(snapshot?.fileName);
        if (
            snapshot?.ok
            && snapshot.isSeed === false
            && normalizedSnapshotChatId
            && normalizedSnapshotChatId !== normalizedSeedChatId
        ) {
            return {
                attempted: true,
                snapshot,
            };
        }
    } catch {
        // The existing Continue fallback reads the seed exactly below.
    }

    return {
        attempted: true,
        snapshot: null,
    };
}

async function openHistoryDrawer() {
    renderHistoryList();
    openDrawer(ui.historyDrawer);
}

async function openSaveLoadDrawer(mode = 'load') {
    ui.saveLoadDrawer.dataset.mode = mode;
    ui.saveLoadTitle.textContent = mode === 'save' ? '保存' : '读取';
    await renderSaveLoadList(mode);
    openDrawer(ui.saveLoadDrawer);
}

function openDrawer(drawer) {
    closeDrawers();
    ui.drawerBackdrop.hidden = false;
    drawer.hidden = false;
    drawer.querySelector('button, [tabindex]')?.focus();
}

function closeDrawers() {
    ui.drawerBackdrop.hidden = true;
    for (const drawer of [ui.historyDrawer, ui.saveLoadDrawer, ui.settingsDrawer]) {
        drawer.hidden = true;
    }
}

function renderHistoryList() {
    ui.historyList.replaceChildren();
    const messages = activeChatSnapshot?.messages || [];
    if (!messages.length) {
        ui.historyList.append(createEmptyDrawerMessage('还没有可以回看的内容'));
        return;
    }

    messages.forEach((message, index) => {
        const item = document.createElement('article');
        item.className = 'history-item';
        if (index === getDisplayedMessageIndex(activeChatSnapshot)) {
            item.classList.add('is-current');
        }

        const speaker = document.createElement('p');
        speaker.className = 'history-speaker';
        speaker.textContent = message.role === 'player' ? '你' : message.speaker || getMainCharacterName();

        const text = document.createElement('p');
        text.className = 'history-text';
        text.textContent = message.displayText || message.text;

        const locate = document.createElement('button');
        locate.type = 'button';
        locate.textContent = '定位';
        locate.addEventListener('click', () => {
            activeMessageIndex = index;
            pageIndex = 0;
            renderChatSnapshot(activeChatSnapshot, { messageIndex: index });
            closeDrawers();
        });

        item.append(speaker, text, locate);
        ui.historyList.append(item);
    });
}

async function renderSaveLoadList(mode = 'load') {
    ui.saveLoadList.replaceChildren();
    const slots = await playerSaveStore.listSlots().catch(() => []);
    const slotById = new Map(slots.map((slot) => [slot.saveId, slot]));
    const ids = [AUTO_SAVE_ID, ...manualSaveIds()];
    let visibleSlots = 0;

    for (const saveId of ids) {
        const slot = slotById.get(saveId) || null;
        const item = document.createElement('article');
        item.className = 'save-slot';
        if (!slot) {
            item.classList.add('is-empty');
        }

        const title = document.createElement('h3');
        title.textContent = getSaveSlotLabel(saveId);

        const detail = document.createElement('p');
        detail.textContent = slot
            ? `${slot.scenarioVersion} · ${formatSaveTime(slot.savedAt)}`
            : '空位';

        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = mode === 'save' ? '保存' : '读取';
        action.disabled = mode === 'load' && !slot;
        action.addEventListener('click', () => {
            if (mode === 'save') {
                void saveCurrentSlot(saveId);
            } else {
                void loadPlayerSave(saveId);
            }
        });

        item.append(title, detail, action);
        ui.saveLoadList.append(item);
        visibleSlots += 1;
    }

    if (!visibleSlots) {
        ui.saveLoadList.append(createEmptyDrawerMessage('暂时没有存档'));
    }
}

async function saveCurrentSlot(saveId = AUTO_SAVE_ID) {
    if (!activeChatSnapshot?.ok || !release || !manifest) {
        showToast('暂时无法保存');
        return;
    }
    try {
        await playerSaveStore.saveSnapshot({
            saveId,
            release,
            manifest,
            snapshot: activeChatSnapshot,
            pageIndex,
            visualState: getCurrentVisualState(),
        });
        showToast('已保存');
        await refreshTitleSaveState();
        if (!ui.saveLoadDrawer.hidden) {
            await renderSaveLoadList(ui.saveLoadDrawer.dataset.mode || 'save');
        }
    } catch (error) {
        console.warn('Galgame player save failed.', error);
        showToast('暂时无法保存');
    }
}

async function loadPlayerSave(saveId = AUTO_SAVE_ID, { silentFailure = false } = {}) {
    const slot = await playerSaveStore.loadSlot(saveId).catch(() => null);
    if (!slot) {
        if (!silentFailure) {
            showToast('这个存档暂时无法读取');
        }
        return false;
    }

    try {
        const savedManifest = await getManifestForSave(slot);
        if (!savedManifest) {
            throw new Error('PLAYER_SAVE_MANIFEST_MISSING');
        }
        manifest = savedManifest;
        release = createCanonicalPlayerSaveRelease(slot, savedManifest);
        ui.titleScreen.hidden = true;
        ui.gameScreen.hidden = false;
        renderStage();
        const snapshot = await chatBridge.loadSpecificBoundChat(manifest, slot.chatId);
        if (!snapshot.ok) {
            throw new Error(snapshot.errorCode || 'PLAYER_SAVE_CHAT_UNAVAILABLE');
        }
        activeChatSnapshot = snapshot;
        const restoreOptions = getSaveRestoreRenderOptions(snapshot, slot, saveId);
        renderChatSnapshot(snapshot, restoreOptions);
        if (restoreOptions.syncedToLatest) {
            void persistAutoSave(snapshot);
            showToast('已同步到最新回应');
        }
        closeDrawers();
        if (snapshotAwaitsReply(snapshot)) {
            void requestOriginalReply(snapshot);
        }
        return true;
    } catch (error) {
        console.warn('Galgame player load failed.', error);
        if (!silentFailure) {
            showToast('这个存档暂时无法读取');
            renderBridgeUnavailable();
        }
        return false;
    }
}

async function persistAutoSave(snapshot = activeChatSnapshot) {
    if (!snapshot?.ok || !release || !manifest) {
        return;
    }
    await playerSaveStore.saveSnapshot({
        saveId: AUTO_SAVE_ID,
        release,
        manifest,
        snapshot,
        pageIndex,
        visualState: getCurrentVisualState(),
    }).then(refreshTitleSaveState).catch((error) => {
        console.warn('Galgame auto save failed.', error);
    });
}

async function getManifestForSave(slot) {
    let savedManifest = null;
    if (manifest?.id === slot.scenarioId && manifest?.version === slot.scenarioVersion) {
        savedManifest = manifest;
    } else if (typeof releaseStore.getManifestByVersion === 'function') {
        savedManifest = await releaseStore.getManifestByVersion(slot.scenarioId, slot.scenarioVersion);
    }
    if (!savedManifest) {
        return null;
    }
    if (!saveProfileBindingMatchesManifest(slot, savedManifest)) {
        throw new Error('PLAYER_SAVE_PROFILE_BINDING_MISMATCH');
    }
    return materializeManifestForArc(savedManifest, slot.arcId);
}

function getSaveRestoreRenderOptions(snapshot, slot, saveId) {
    const latestIndex = Math.max(0, (snapshot?.messages?.length || 1) - 1);
    const savedIndex = Number(slot?.lastMessageIndex || 0);
    if (saveId === AUTO_SAVE_ID && latestIndex > savedIndex) {
        return {
            messageIndex: latestIndex,
            pageIndex: 0,
            instant: true,
            syncedToLatest: true,
        };
    }
    return {
        messageIndex: slot.lastMessageIndex,
        pageIndex: slot.pageIndex,
    };
}

function saveProfileBindingMatchesManifest(slot, savedManifest) {
    if (!slot.presentationProfileHash || !slot.presentationProfileId) {
        return false;
    }
    const profileBinding = resolveAdaptivePresentationProfileBinding(savedManifest, slot.arcId);
    if (!profileBinding.valid) {
        return false;
    }
    if (profileBinding.profileId !== slot.presentationProfileId) {
        return false;
    }
    return profileBinding.profileHash === slot.presentationProfileHash;
}

function saveSlotMatchesCurrentRelease(slot) {
    if (!slot || !release) {
        return false;
    }
    const currentArcId = release.activeArcId || release.arcId || manifest?.arcId || manifest?.defaultArcId || '';
    return slot.scenarioId === release.scenarioId
        && slot.scenarioVersion === release.scenarioVersion
        && slot.arcId === currentArcId
        && slot.presentationProfileId === release.presentationProfileId
        && slot.presentationProfileHash === release.presentationProfileHash;
}

function getCurrentVisualState() {
    return {
        backgroundId: manifest.presentation?.defaultBackgroundAsset || '',
        spriteIds: Object.values(manifest.resourceBindings?.characters || {})
            .map((character) => character.sprite)
            .filter(Boolean),
        bgmId: '',
        mediaJobIds: [],
    };
}

function createEmptyDrawerMessage(message) {
    const empty = document.createElement('p');
    empty.className = 'drawer-empty';
    empty.textContent = message;
    return empty;
}

function getSaveSlotLabel(saveId) {
    if (saveId === AUTO_SAVE_ID) {
        return '自动存档';
    }
    const match = saveId.match(/\d+$/);
    return `手动存档 ${match?.[0] || ''}`.trim();
}

function formatSaveTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '时间未知';
    }
    return new Intl.DateTimeFormat('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function cycleTextSize() {
    textSizeMode = textSizeMode === 'standard'
        ? 'large'
        : textSizeMode === 'large'
            ? 'small'
            : 'standard';
    document.documentElement.dataset.textSize = textSizeMode;
    ui.fontSizeButton.textContent = `文字大小：${textSizeMode === 'large' ? '大' : textSizeMode === 'small' ? '小' : '标准'}`;
}

function toggleMotion() {
    motionEnabled = !motionEnabled;
    document.documentElement.dataset.motion = motionEnabled ? 'on' : 'off';
    ui.motionButton.textContent = `动态效果：${motionEnabled ? '开启' : '关闭'}`;
}

async function handlePlayerInput(event) {
    event.preventDefault();
    if (inputPending) {
        return;
    }
    const message = ui.playerInput.value.trim();
    if (!message) {
        return;
    }

    await submitPlayerMessage(message);
}

async function submitPlayerMessage(message) {
    inputPending = true;
    setInputEnabled(false);
    renderSuggestedActions();
    try {
        const snapshot = await chatBridge.appendUserMessageToChat(manifest, activeChatSnapshot, message);
        activeChatSnapshot = snapshot;
        ui.playerInput.value = '';
        renderChatSnapshot(snapshot);
        void persistAutoSave(snapshot);
        showToast('行动已记录');
        await requestOriginalReply(snapshot);
    } catch (error) {
        console.warn('Galgame original chat write failed.', error);
        ui.playerInput.value = message;
        if (activeChatSnapshot) {
            renderChatSnapshot(activeChatSnapshot);
        } else {
            renderBridgeUnavailable();
        }
        showToast('暂时没接上');
    } finally {
        inputPending = false;
        setInputEnabled(canAcceptPlayerInput());
    }
}

async function loadOriginalChat(mode = 'continue') {
    try {
        const snapshot = mode === 'start'
            ? await chatBridge.loadOpeningChat(manifest)
            : await chatBridge.loadLatestBoundChat(manifest);
        if (!snapshot.ok) {
            renderBridgeUnavailable();
            return;
        }
        activeChatSnapshot = snapshot;
        renderChatSnapshot(snapshot);
        void persistAutoSave(snapshot);
        if (snapshotAwaitsReply(snapshot)) {
            void requestOriginalReply(snapshot);
        }
    } catch (error) {
        console.warn('Galgame original chat bridge failed.', error);
        activeChatSnapshot = null;
        renderBridgeUnavailable();
    }
}

async function requestOriginalReply(snapshot = activeChatSnapshot) {
    if (!snapshotAwaitsReply(snapshot)) {
        return;
    }
    if (generationPending) {
        return;
    }
    let currentGenerationSnapshot = snapshot;
    const generationRequestId = `generation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const generationStartedAt = Date.now();

    generationPending = true;
    try {
        const latestSnapshot = await loadLatestSnapshotForActiveChat(currentGenerationSnapshot);
        if (latestSnapshot?.ok) {
            currentGenerationSnapshot = latestSnapshot;
            activeChatSnapshot = latestSnapshot;
            if (!snapshotAwaitsReply(latestSnapshot)) {
                renderChatSnapshot(latestSnapshot, getLatestSnapshotRenderOptions(latestSnapshot));
                void persistAutoSave(latestSnapshot);
                showToast('已同步到最新回应');
                return;
            }
        }
        connectionHealthMonitor?.recordGenerationStart({ requestId: generationRequestId });
        const bridgeReady = await ensureRuntimeBridgeReady();
        if (!bridgeReady) {
            connectionHealthMonitor?.recordGeneration({
                ok: false,
                requestId: generationRequestId,
                errorCode: 'ORIGINAL_RUNTIME_BRIDGE_UNAVAILABLE',
                latencyMs: Date.now() - generationStartedAt,
            });
            renderWaitingForReply();
            return;
        }
        renderThinkingForReply();
        const bridgeProof = await getRuntimeBridgeProof(currentGenerationSnapshot);
        if (!bridgeProof) {
            throw new Error('ORIGINAL_RUNTIME_BRIDGE_PROOF_UNAVAILABLE');
        }
        const generatedSnapshot = await runtimeBridge.generateReply({
            manifest,
            release,
            snapshot: currentGenerationSnapshot,
            bridgeProof,
        });
        activeChatSnapshot = generatedSnapshot;
        connectionHealthMonitor?.recordGeneration({
            ok: true,
            requestId: generationRequestId,
            latencyMs: Date.now() - generationStartedAt,
        });
        renderChatSnapshot(generatedSnapshot);
        void persistAutoSave(generatedSnapshot);
        if (!snapshotAwaitsReply(generatedSnapshot)) {
            showToast('回应已到');
        }
    } catch (error) {
        connectionHealthMonitor?.recordGeneration({
            ok: false,
            requestId: generationRequestId,
            errorCode: error?.code || error?.message || 'GENERATION_FAILED',
            latencyMs: Date.now() - generationStartedAt,
        });
        console.warn('Galgame original runtime bridge failed.', error);
        const reloaded = await chatBridge.loadSpecificBoundChat(manifest, currentGenerationSnapshot.fileName).catch(() => null);
        activeChatSnapshot = reloaded?.ok ? reloaded : currentGenerationSnapshot;
        renderChatSnapshot(activeChatSnapshot);
        if (snapshotAwaitsReply(activeChatSnapshot)) {
            renderWaitingForReply();
        }
    } finally {
        void connectionHealthMonitor?.probeNow({ reason: 'generation-finished' });
        generationPending = false;
        setInputEnabled(canAcceptPlayerInput());
    }
}

async function retryOrSyncOriginalReply() {
    const synced = await syncActiveChatSnapshot({ showSyncedToast: true });
    if (snapshotAwaitsReply(synced)) {
        await requestOriginalReply(synced);
        return;
    }
    if (!synced) {
        await loadOriginalChat('continue');
    }
}

async function syncActiveChatSnapshot({ showSyncedToast = false } = {}) {
    if (!activeChatSnapshot?.fileName || !manifest) {
        return activeChatSnapshot;
    }
    const latestSnapshot = await loadLatestSnapshotForActiveChat(activeChatSnapshot);
    if (!latestSnapshot?.ok) {
        return activeChatSnapshot;
    }
    const wasAwaitingReply = snapshotAwaitsReply(activeChatSnapshot);
    activeChatSnapshot = latestSnapshot;
    renderChatSnapshot(latestSnapshot, getLatestSnapshotRenderOptions(latestSnapshot));
    void persistAutoSave(latestSnapshot);
    if (showSyncedToast && wasAwaitingReply && !snapshotAwaitsReply(latestSnapshot)) {
        showToast('已同步到最新回应');
    }
    return latestSnapshot;
}

async function loadLatestSnapshotForActiveChat(snapshot) {
    if (!snapshot?.fileName || !manifest) {
        return null;
    }
    return chatBridge.loadSpecificBoundChat(manifest, snapshot.fileName).catch(() => null);
}

function getLatestSnapshotRenderOptions(snapshot) {
    return {
        messageIndex: Math.max(0, (snapshot?.messages?.length || 1) - 1),
        pageIndex: 0,
        instant: true,
    };
}

async function ensureRuntimeBridgeReady() {
    if (runtimeBridge.isConfigured()) {
        const health = await runtimeBridge.healthCheck().catch(() => null);
        if (health?.ok && health?.ready !== false && !health.stopping && !health.pending && !health.stale && !health.authRequired) {
            return true;
        }
        if (health?.pending || health?.stale) {
            setStageStatus(health.stale ? '运行桥响应超时，请重启桥接服务后再试。' : '上一段仍在生成中，请稍后再试。');
        } else if (health?.stopping) {
            setStageStatus('运行桥正在停止，请重启桥接服务后再试。');
        }
    }
    if (!runtimeBridgeDiscoveryPromise) {
        runtimeBridgeDiscoveryPromise = discoverOriginalRuntimeBridge()
            .finally(() => {
                runtimeBridgeDiscoveryPromise = null;
            });
    }
    return Boolean(await runtimeBridgeDiscoveryPromise);
}

async function discoverOriginalRuntimeBridge({ signal = null } = {}) {
    return runtimeBridge.discoverBaseUrl(getOriginalRuntimeBridgeCandidateUrls(), { signal });
}

function getOriginalRuntimeBridgeCandidateUrls() {
    const configured = getOriginalRuntimeBridgeUrl();
    if (configured) {
        return [configured];
    }
    const hostname = window.location.hostname === 'localhost' ? 'localhost' : '127.0.0.1';
    return ORIGINAL_RUNTIME_BRIDGE_PORTS.map((port) => `http://${hostname}:${port}`);
}

async function getRuntimeBridgeProof(snapshot) {
    if (typeof releaseStore.issueRuntimeBridgeProof !== 'function') {
        return null;
    }
    return releaseStore.issueRuntimeBridgeProof({
        release,
        manifest,
        snapshot,
    });
}

function renderChatSnapshot(snapshot, options = {}) {
    const messageIndex = resolveMessageIndex(snapshot, options.messageIndex);
    const message = snapshot.messages[messageIndex];
    activeMessageIndex = messageIndex;

    if (message) {
        const waitingForReply = snapshotAwaitsReply(snapshot);
        const displayingLatest = messageIndex === snapshot.messages.length - 1;
        // Use the original visible message for truncation detection. The
        // display projection removes a valid trailing action block first;
        // checking that shortened text can hide complete RPG choices.
        const incompleteReply = message.role === 'character'
            && displayingLatest
            && detectIncompleteRpgResponse(message.text || message.displayText || '');
        const segments = createVisualNovelDisplaySegments(message.displayText || message.text, {
            fallbackSpeaker: message.role === 'player' ? '你' : message.speaker || getMainCharacterName(),
            role: message.role,
        });
        activeMessageSegments = segments.length ? segments : [{
            index: 0,
            type: message.role === 'player' ? 'player' : 'narration',
            speaker: message.role === 'player' ? '你' : '旁白',
            text: message.displayText || message.text || '',
        }];
        activeSegmentIndex = clampIndex(Number(options.pageIndex || 0), activeMessageSegments.length);
        pageIndex = activeSegmentIndex;
        activeRenderContext = {
            snapshot,
            message,
            waitingForReply,
            displayingLatest,
            incompleteReply,
        };
        renderAdaptivePanels(message, snapshot, messageIndex);
        renderActiveDialogueSegment({
            animate: shouldAnimateMessage(message, waitingForReply, displayingLatest, options),
        });
        rememberRenderedVisualRuntimeMessage(snapshot, message, messageIndex);
        scheduleVisualBundleRefresh(snapshot, messageIndex);
        return;
    } else {
        renderBridgeUnavailable();
        return;
    }
}

function scheduleVisualBundleRefresh(snapshot, messageIndex) {
    const token = visualBundleRequestToken + 1;
    visualBundleRequestToken = token;
    immediateVisualCharacterIdentity = '';
    coreVisualPresentationDetails.clear();
    const message = snapshot?.messages?.[messageIndex] || null;
    const visualRole = getActiveVisualSpeakerContext(message, messageIndex).role;
    // Clear the portrait before each visible message. Keeping the previous
    // character during a narrator/player turn makes the avatar appear to
    // speak for the wrong entity while the validated decision is pending.
    renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
    // Bind the active speaker locally as soon as the segment is shown. The
    // remote visual decision still validates and corrects the result later.
    void renderCoreVisualImmediateCharacter(snapshot, messageIndex, token);
    void renderCoreVisualPresentation(snapshot, messageIndex, token);
}

function getActiveVisualSpeakerContext(message, messageIndex) {
    const activeSegment = activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    if (!activeSegment) {
        if (message?.role === 'character' && isManifestNarratorSpeaker(message.speaker)) {
            return { role: 'narrator', speaker: '旁白' };
        }
        return {
            role: message?.role === 'player' ? 'player' : 'character',
            speaker: message?.role === 'player' ? '你' : message?.speaker || getMainCharacterName(),
        };
    }
    if (message?.role === 'system') {
        return { role: 'system', speaker: '系统' };
    }
    if (message?.role === 'character' && isManifestNarratorSpeaker(activeSegment.speaker || message.speaker)) {
        return { role: 'narrator', speaker: '旁白' };
    }
    if (message?.role === 'character'
        && activeSegment.type === 'narration'
        && isCharacterVisualMetadataSegment(activeSegment.text)
        && !isManifestNarratorSpeaker(message.speaker)) {
        return { role: 'character', speaker: message.speaker || getMainCharacterName() };
    }
    const role = activeSegment.type === 'narration'
        ? 'narrator'
        : activeSegment.type === 'player'
            ? 'player'
            : activeSegment.type === 'system'
                ? 'system'
                : 'character';
    const speaker = activeSegment.type === 'narration'
        ? '旁白'
        : activeSegment.type === 'player'
            ? '你'
            : activeSegment.type === 'system'
                ? '系统'
                : activeSegment.speaker || message?.speaker || getMainCharacterName();
    return { role, speaker };
}

function isCharacterVisualMetadataSegment(value) {
    return /^(?:角色|人物|立绘|性别|性别表现|种族|物种|外观|外貌|特征|服装|衣着|穿着|character|person|sprite|gender|species|appearance|features|clothing|outfit)\s*[:：]/iu.test(String(value || '').trim());
}

function normalizeManifestSpeakerName(value) {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[：:，,。！？!?]+$/u, '')
        .replace(/\s+/gu, ' ')
        .trim()
        .toLocaleLowerCase();
}

function isManifestNarratorSpeaker(value) {
    const normalized = normalizeManifestSpeakerName(value);
    if (!normalized || !manifest) return false;
    const arcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || '';
    return getVisualCharacterBindings(manifest, arcId).some((binding) => {
        if (binding?.channel !== 'narrator') return false;
        return [binding.characterKey, ...(Array.isArray(binding.aliases) ? binding.aliases : [])]
            .some((candidate) => normalizeManifestSpeakerName(candidate) === normalized);
    });
}

async function renderCoreVisualImmediateCharacter(snapshot, messageIndex, token) {
    try {
        const baseUrl = getCoreVisualServiceUrl();
        if (!baseUrl || token !== visualBundleRequestToken || !manifest) {
            return;
        }
        const context = coreVisualAvailability.context || await readCoreVisualContext(baseUrl);
        const profile = context?.visualProfile;
        if (!profile || token !== visualBundleRequestToken) {
            return;
        }
        const message = snapshot?.messages?.[messageIndex];
        if (!message) {
            return;
        }
        const speakerContext = getActiveVisualSpeakerContext(message, messageIndex);
        if (speakerContext.role !== 'character') {
            return;
        }
        const arcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || '';
        const binding = resolveVisualCharacterBinding(manifest, {
            name: speakerContext.speaker,
            role: speakerContext.role,
            arcId,
            allowCharacterPoolFallback: false,
        });
        const assetVersion = Number(binding?.assetVersion || 0);
        if (!binding?.assetId || !Number.isSafeInteger(assetVersion) || assetVersion <= 0) {
            return;
        }
        const decision = {
            entityType: 'character',
            assetId: binding.assetId,
            assetVersion,
            contentPath: `/v1/core/catalogs/${profile.catalogId}/${profile.catalogRevision}/assets/${binding.assetId}/${assetVersion}/content`,
        };
        immediateVisualCharacterIdentity = `${decision.assetId}:${decision.assetVersion}`;
        await applyCoreVisualCharacter(decision, baseUrl, token);
    } catch (_error) {
        // The validated remote request remains the authority if local binding
        // cannot be applied (for example while reconnecting to the service).
    }
}

function resetVisualPresentation() {
    visualBundleRequestToken += 1;
    coreVisualHasVerifiedPresentation = false;
    immediateVisualCharacterIdentity = '';
    coreVisualPresentationState.clear();
    coreVisualPresentationDetails.clear();
    restoreDefaultVisualLayers();
    ui.visualIconStrip?.replaceChildren();
    setVisualStatus('');
}

function renderCoreVisualFallback({ preserveVerified = false, role = 'character' } = {}) {
    if (preserveVerified && coreVisualHasVerifiedPresentation) {
        return;
    }
    // Keep the authored stage background visible when runtime matching is
    // unavailable. It is a scenario-owned default, so it cannot be confused
    // with a stale remote match. Character roles still use role-specific
    // neutral placeholders until a validated bound portrait is available.
    restoreDefaultBackgroundLayer();
    applyCoreVisualPlaceholderCharacter(role);
    renderCoreVisualIconStrip();
    coreVisualHasVerifiedPresentation = false;
    setVisualStatus('');
}

function getCoreVisualPlaceholderUrl(role = 'character') {
    if (role === 'player') return CORE_PLAYER_PLACEHOLDER_URL;
    if (role === 'narrator' || role === 'system') return CORE_NARRATOR_PLACEHOLDER_URL;
    return CORE_VISUAL_PLACEHOLDER_URL;
}

function renderCoreVisualPlaceholder(role = 'character') {
    applyCoreVisualPlaceholderBackground();
    applyCoreVisualPlaceholderCharacter(role);
    renderCoreVisualIconStrip();
}

async function renderCoreVisualPresentation(snapshot, messageIndex, token) {
    const visualRole = getActiveVisualSpeakerContext(snapshot?.messages?.[messageIndex], messageIndex).role;
    try {
        const baseUrl = getCoreVisualServiceUrl();
        if (!baseUrl) {
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            return;
        }
        const context = await readCoreVisualContext(baseUrl);
        if (!context?.enabled || !context.visualProfile) {
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            return;
        }
        const message = snapshot?.messages?.[messageIndex];
        if (!message) {
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            return;
        }
        const request = await createCoreVisualDecisionRequest({
            snapshot,
            message,
            messageIndex,
            visualProfile: context.visualProfile,
        });
        const response = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (token !== visualBundleRequestToken) {
            return;
        }
        if (!response.ok) {
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_REJECTED');
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            setVisualStatus('');
            return;
        }
        const body = await response.json();
        if (body?.schemaVersion !== CORE_VISUAL_DECISION_RESPONSE_VERSION) {
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            setVisualStatus('');
            return;
        }
        if (body.ok !== true) {
            markCoreVisualUnavailable(body?.error?.code || 'VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            setVisualStatus('');
            return;
        }
        if (!Array.isArray(body.decisions)) {
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            setVisualStatus('');
            return;
        }
        await renderCoreVisualDecisions(body.decisions, baseUrl, token, request, body);
    } catch (_error) {
        if (token === visualBundleRequestToken) {
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_UNAVAILABLE');
            renderCoreVisualFallback({ preserveVerified: false, role: visualRole });
            setVisualStatus('');
        }
    }
}

function resetCoreVisualAvailability(baseContextKey = '') {
    coreVisualAvailability.skipRequests = false;
    coreVisualAvailability.reasonCode = '';
    coreVisualAvailability.contextKey = '';
    coreVisualAvailability.baseContextKey = baseContextKey;
    coreVisualAvailability.context = null;
    coreVisualAvailability.contextPromise = null;
    coreVisualAvailability.nextProbeAt = 0;
}

function getCoreVisualBaseContextKey(baseUrl) {
    return JSON.stringify([
        baseUrl,
        release?.releaseId || '',
        release?.scenarioId || manifest?.id || manifest?.scenarioId || '',
        release?.scenarioVersion || manifest?.version || '',
        release?.activeArcId || release?.arcId || manifest?.defaultArcId || '',
    ]);
}

function getCoreVisualContextKey(baseUrl, context) {
    const profile = context?.visualProfile || null;
    return JSON.stringify([
        getCoreVisualBaseContextKey(baseUrl),
        context?.contextHash || '',
        profile?.visualProfileId || '',
        profile?.profileHash || '',
        profile?.catalogId || '',
        profile?.catalogRevision || 0,
        profile?.catalogHash || '',
    ]);
}

async function readCoreVisualContext(baseUrl) {
    const baseContextKey = getCoreVisualBaseContextKey(baseUrl);
    if (coreVisualAvailability.baseContextKey !== baseContextKey) {
        resetCoreVisualAvailability(baseContextKey);
    }
    const now = Date.now();
    if (coreVisualAvailability.skipRequests && now < coreVisualAvailability.nextProbeAt) {
        return null;
    }
    if (coreVisualAvailability.context && now < coreVisualAvailability.nextProbeAt) {
        return coreVisualAvailability.context;
    }
    if (coreVisualAvailability.contextPromise) {
        return coreVisualAvailability.contextPromise;
    }
    coreVisualAvailability.contextPromise = (async () => {
        try {
            const response = await fetch(`${baseUrl}/v1/core/visual-context`, {
                method: 'GET',
                credentials: 'omit',
                headers: { accept: 'application/json' },
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                markCoreVisualUnavailable(body?.error?.code || 'VISUAL_CORE_CONTEXT_UNAVAILABLE');
                return null;
            }
            if (!(await validateCoreVisualContext(body))) {
                markCoreVisualUnavailable('VISUAL_CORE_CONTEXT_INVALID');
                return null;
            }
            coreVisualAvailability.contextKey = getCoreVisualContextKey(baseUrl, body);
            coreVisualAvailability.nextProbeAt = Date.now() + VISUAL_CONTEXT_REVALIDATION_INTERVAL_MS;
            coreVisualAvailability.reasonCode = '';
            coreVisualAvailability.skipRequests = false;
            if (!body.enabled) {
                coreVisualAvailability.context = null;
                coreVisualAvailability.skipRequests = true;
                coreVisualAvailability.reasonCode = 'VISUAL_CORE_NO_ACTIVE_CATALOG';
                return null;
            }
            coreVisualAvailability.context = body;
            return body;
        } catch (_error) {
            markCoreVisualUnavailable('VISUAL_CORE_CONTEXT_UNAVAILABLE');
            return null;
        } finally {
            coreVisualAvailability.contextPromise = null;
        }
    })();
    return coreVisualAvailability.contextPromise;
}

async function validateCoreVisualContext(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    const expectedKeys = ['ok', 'schemaVersion', 'enabled', 'activeCatalog', 'visualProfile', 'source', 'sourceVersion', 'contextHash'];
    if (Object.keys(body).sort().join(',') !== expectedKeys.sort().join(',')) return false;
    if (body.ok !== true || body.schemaVersion !== CORE_VISUAL_CONTEXT_RESPONSE_VERSION || typeof body.enabled !== 'boolean') return false;
    if (body.source !== 'visual-control' || body.sourceVersion !== 'galgame.visual-control.v1' || !/^sha256:[a-f0-9]{64}$/.test(body.contextHash)) return false;
    if (!body.enabled) {
        if (body.activeCatalog !== null || body.visualProfile !== null) return false;
    } else {
        if (!body.activeCatalog || !body.visualProfile) return false;
        const profileKeys = ['visualProfileId', 'profileHash', 'catalogId', 'catalogRevision', 'catalogHash'];
        if (Object.keys(body.visualProfile).sort().join(',') !== profileKeys.sort().join(',')) return false;
        if (!/^vprof_[a-z0-9_-]{8,80}$/.test(body.visualProfile.visualProfileId)
            || !/^sha256:[a-f0-9]{64}$/.test(body.visualProfile.profileHash)
            || !/^[a-z][a-z0-9_-]{2,79}$/.test(body.visualProfile.catalogId)
            || !Number.isSafeInteger(body.visualProfile.catalogRevision)
            || body.visualProfile.catalogRevision <= 0
            || !/^sha256:[a-f0-9]{64}$/.test(body.visualProfile.catalogHash)) return false;
        if (Object.keys(body.activeCatalog).sort().join(',') !== ['catalogId', 'catalogRevision', 'catalogHash'].sort().join(',')) return false;
        if (body.activeCatalog.catalogId !== body.visualProfile.catalogId
            || body.activeCatalog.catalogRevision !== body.visualProfile.catalogRevision
            || body.activeCatalog.catalogHash !== body.visualProfile.catalogHash) return false;
    }
    const expectedContextHash = await sha256Digest(canonicalJson({
        schemaVersion: body.schemaVersion,
        enabled: body.enabled,
        activeCatalog: body.activeCatalog,
        visualProfile: body.visualProfile,
        source: body.source,
        sourceVersion: body.sourceVersion,
    }));
    return expectedContextHash === body.contextHash;
}

function markCoreVisualUnavailable(code) {
    if (!CORE_VISUAL_LOCAL_DISABLE_CODES.has(code)) {
        return;
    }
    coreVisualAvailability.skipRequests = true;
    coreVisualAvailability.reasonCode = code;
    coreVisualAvailability.context = null;
    coreVisualAvailability.nextProbeAt = Date.now() + VISUAL_CONTEXT_REVALIDATION_INTERVAL_MS;
}

function renderCoreVisualIconStrip() {
    if (!ui.visualIconStrip) {
        return;
    }
    ui.visualIconStrip.replaceChildren();
    for (const type of VISUAL_ICON_TYPES) {
        const icon = document.createElement('figure');
        icon.className = `visual-icon visual-icon-${type} is-unavailable is-placeholder`;
        const image = document.createElement('img');
        image.alt = `${getVisualTypeLabel(type)}暂时不可用`;
        image.src = CORE_VISUAL_PLACEHOLDER_URL;
        const caption = document.createElement('figcaption');
        caption.textContent = getVisualTypeLabel(type);
        icon.append(image, caption);
        ui.visualIconStrip.append(icon);
    }
}

function decorateCoreVisualDecision(decision, request) {
    const entity = request?.projection?.entities?.find((candidate) => candidate.entityKey === decision?.entityKey);
    if (!entity) {
        return decision;
    }
    return {
        ...decision,
        displayLabel: entity.displayLabel || '',
        visibleAttributes: Array.isArray(entity.visibleAttributes) ? entity.visibleAttributes : [],
        confidenceBand: entity.confidenceBand || decision.confidenceBand || '',
    };
}

async function renderCoreVisualDecisions(decisions, baseUrl, token, request, response) {
    const byType = new Map();
    const currentRole = request?.visibleContext?.current?.role || 'character';
    for (const type of CORE_VISUAL_TYPES) {
        // Character assets belong only to character turns. A remote or
        // stale projection must never make a narrator/player turn inherit a
        // portrait, even if the response contains a character decision.
        const typeDecisions = decisions.filter((decision) => (
            decision?.entityType === type
            && (type !== 'character' || currentRole === 'character')
        ));
        const renderable = typeDecisions
            .filter((decision) => isRenderableCoreVisualDecision(decision, type, request, response))
            .map((decision) => decorateCoreVisualDecision(decision, request));
        const selected = renderable[0] || null;
        if (selected) {
            coreVisualPresentationDetails.set(type, renderable);
            coreVisualPresentationState.set(type, selected);
            byType.set(type, selected);
            continue;
        }
        // A locally bound avatar is already correct for the active segment.
        // Do not let an incomplete remote response put the previous speaker
        // back while the current request is still in flight.
        if (type === 'character' && immediateVisualCharacterIdentity) {
            continue;
        }
        // A valid response with no current portrait/scene match must not leave
        // a previous turn's entity on screen. Small status icons are cumulative
        // presentation details, so they may remain until a newer explicit
        // status replaces them.
        if (['equipment', 'item', 'skill'].includes(type)) {
            const preserved = coreVisualPresentationState.get(type);
            if (preserved && isRenderablePreservedCoreVisualDecision(preserved, request)) {
                byType.set(type, preserved);
                continue;
            }
        }
        coreVisualPresentationState.delete(type);
        coreVisualPresentationDetails.delete(type);
    }
    // The verified response is scoped to this visible message. Missing layers
    // remain unknown instead of inheriting an unrelated earlier entity.
    coreVisualHasVerifiedPresentation = coreVisualHasVerifiedPresentation || byType.size > 0;
    const remoteCharacterIdentity = byType.get('character')
        ? `${byType.get('character').assetId}:${byType.get('character').assetVersion}`
        : '';
    const immediateCharacterStillValid = Boolean(
        remoteCharacterIdentity
        && remoteCharacterIdentity === immediateVisualCharacterIdentity
        && ui.stageHeroine?.dataset.visualAssetIdentity === immediateVisualCharacterIdentity,
    );
    await Promise.all([
        byType.has('scene')
            ? applyCoreVisualBackground(byType.get('scene'), baseUrl, token)
            : Promise.resolve().then(() => restoreDefaultBackgroundLayer()),
        byType.has('character')
            ? (immediateCharacterStillValid
                ? Promise.resolve()
                : applyCoreVisualCharacter(byType.get('character'), baseUrl, token))
            : (currentRole === 'character' && immediateVisualCharacterIdentity
                ? Promise.resolve()
                : Promise.resolve().then(() => applyCoreVisualPlaceholderCharacter(currentRole))),
        applyCoreVisualIcons(byType, baseUrl, token),
    ]);
    if (token === visualBundleRequestToken) {
        setVisualStatus('');
    }
}

function isRenderablePreservedCoreVisualDecision(decision, request) {
    if (!decision || String(decision.assetId || '').startsWith('unknown_')) {
        return false;
    }
    const profile = request?.visualProfile;
    return Number.isSafeInteger(decision.assetVersion)
        && decision.assetVersion > 0
        && Number(decision.score) >= 60
        && ['medium', 'high'].includes(decision.scoreBand)
        && decision.visualProfileId === profile?.visualProfileId
        && decision.profileHash === profile?.profileHash
        && decision.catalogId === profile?.catalogId
        && decision.catalogRevision === profile?.catalogRevision
        && decision.catalogHash === profile?.catalogHash
        && /^sha256:[a-f0-9]{64}$/.test(String(decision.assetMetadataHash || ''))
        && /^(?:sha256:)?[a-f0-9]{64}$/.test(String(decision.assetContentSha256 || ''));
}

function isRenderableCoreVisualDecision(decision, type, request, response) {
    if (!decision || decision.entityType !== type || String(decision.assetId || '').startsWith('unknown_')) {
        return false;
    }
    const projectedEntity = request?.projection?.entities?.find((entity) => entity.entityKey === decision.entityKey);
    if (!projectedEntity || projectedEntity.entityType !== type) {
        return false;
    }
    if (!Number.isSafeInteger(decision.assetVersion) || decision.assetVersion <= 0 || Number(decision.score) < 60) {
        return false;
    }
    if (!['medium', 'high'].includes(decision.scoreBand)) {
        return false;
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(String(decision.profileHash || ''))
        || !/^sha256:[a-f0-9]{64}$/.test(String(decision.catalogHash || ''))
        || !/^sha256:[a-f0-9]{64}$/.test(String(decision.assetMetadataHash || ''))
        || !/^(?:sha256:)?[a-f0-9]{64}$/.test(String(decision.assetContentSha256 || ''))) {
        return false;
    }
    if (decision.projectionId !== request?.projection?.projectionId
        || decision.sourceMessageIndex !== request?.projection?.sourceMessageIndex
        || decision.sourceMessageHash !== request?.projection?.sourceMessageHash
        || decision.visualProfileId !== request?.visualProfile?.visualProfileId
        || decision.profileHash !== request?.visualProfile?.profileHash
        || decision.catalogId !== request?.visualProfile?.catalogId
        || decision.catalogRevision !== request?.visualProfile?.catalogRevision
        || decision.catalogHash !== request?.visualProfile?.catalogHash) {
        return false;
    }
    if (response?.schemaVersion === CORE_VISUAL_DECISION_RESPONSE_VERSION
        && (response.projectionId !== request.projection.projectionId
            || response.projectionHash !== request.projection.projectionHash
            || response.sourceMessageIndex !== request.projection.sourceMessageIndex
            || response.sourceMessageHash !== request.projection.sourceMessageHash
            || response.catalogId !== request.visualProfile.catalogId
            || response.catalogRevision !== request.visualProfile.catalogRevision
            || response.catalogHash !== request.visualProfile.catalogHash)) {
        return false;
    }
    return true;
}

const visualObjectUrlCache = new Map();
const visualObjectUrlInflight = new Map();
const VISUAL_RUNTIME_MESSAGE_MAX_TEXT_LENGTH = 4000;
const VISUAL_RUNTIME_MESSAGE_HEAD_LENGTH = 1400;

function normalizePlayerVisualRuntimeMessage(message) {
    if (!message || typeof message !== 'object') {
        return normalizeVisualRuntimeMessage(message);
    }
    const text = String(message.text || '');
    if (Array.from(text).length <= VISUAL_RUNTIME_MESSAGE_MAX_TEXT_LENGTH) {
        return normalizeVisualRuntimeMessage(message);
    }
    const marker = '\n[…]\n';
    const headLength = Math.min(VISUAL_RUNTIME_MESSAGE_HEAD_LENGTH, VISUAL_RUNTIME_MESSAGE_MAX_TEXT_LENGTH - marker.length);
    const tailLength = VISUAL_RUNTIME_MESSAGE_MAX_TEXT_LENGTH - marker.length - headLength;
    const codePoints = Array.from(text);
    const boundedText = `${codePoints.slice(0, headLength).join('')}${marker}${codePoints.slice(-tailLength).join('')}`;
    return normalizeVisualRuntimeMessage({ ...message, text: boundedText });
}

// Cross-origin CSS backgrounds can report a successful response yet remain unpainted in the player.
// Fetch the bytes and render a same-origin blob URL instead.
function supportsBlobVisualRender() {
    if (typeof document?.createElement !== 'function'
        || typeof HTMLElement === 'undefined'
        || typeof URL?.createObjectURL !== 'function') {
        return false;
    }
    return document.createElement('img') instanceof HTMLElement;
}

function loadDirectVisualImage(url) {
    if (!url || typeof Image === 'undefined') {
        return Promise.resolve(Boolean(url));
    }
    return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = url;
    });
}

async function resolveVisualRenderUrl(url) {
    if (!url) {
        return '';
    }
    if (!supportsBlobVisualRender()) {
        return (await loadDirectVisualImage(url)) ? url : '';
    }
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        return url;
    }
    const cached = visualObjectUrlCache.get(url);
    if (cached) {
        return cached;
    }
    const pending = visualObjectUrlInflight.get(url);
    if (pending) {
        return pending;
    }
    const request = fetch(url, { credentials: 'omit', mode: 'cors' }) // /v1/core/catalogs/<catalogId>/<revision>/assets/<assetId>/<version>/content
        .then((response) => {
            if (!response.ok) {
                throw new Error(`visual asset request failed: ${response.status}`);
            }
            return response.blob();
        })
        .then((blob) => {
            const objectUrl = URL.createObjectURL(blob);
            visualObjectUrlCache.set(url, objectUrl);
            return objectUrl;
        })
        .catch(() => '');
    visualObjectUrlInflight.set(url, request);
    try {
        return await request;
    } finally {
        visualObjectUrlInflight.delete(url);
    }
}

async function applyCoreVisualBackground(decision, baseUrl, token) {
    if (!ui.stageBackdrop || !decision || String(decision.assetId || '').startsWith('unknown_')) {
        return;
    }
    const sourceUrl = createCoreVisualContentUrl(decision, baseUrl);
    const identity = `${decision.assetId}:${decision.assetVersion}`;
    if (!sourceUrl || token !== visualBundleRequestToken) return;
    const previousImage = ui.stageBackdrop.style.backgroundImage;
    const previousIdentity = ui.stageBackdrop.dataset.visualAssetIdentity || '';
    // Show the validated catalog URL immediately; replace it with a same-origin
    // blob after the bytes arrive so large scenes never leave an empty stage.
    applyVisualLayerImage(ui.stageBackdrop, sourceUrl, identity, token, 'background');
    ui.stageBackdrop.classList.add('is-visual-active');
    coreVisualHasVerifiedPresentation = true;
    const renderUrl = await resolveVisualRenderUrl(sourceUrl);
    if (token !== visualBundleRequestToken) return;
    if (!renderUrl) {
        restoreVisualLayerAfterLoadFailure(ui.stageBackdrop, previousImage, previousIdentity);
        return;
    }
    applyVisualLayerImage(ui.stageBackdrop, renderUrl, identity, token, 'background');
}

async function applyCoreVisualCharacter(decision, baseUrl, token) {
    if (!ui.stageHeroine || !decision || String(decision.assetId || '').startsWith('unknown_')) {
        return;
    }
    const sourceUrl = createCoreVisualContentUrl(decision, baseUrl);
    const identity = `${decision.assetId}:${decision.assetVersion}`;
    if (!sourceUrl || token !== visualBundleRequestToken) return;
    const previousImage = ui.stageHeroine.style.backgroundImage;
    const previousIdentity = ui.stageHeroine.dataset.visualAssetIdentity || '';
    // Keep the current portrait visible while the catalog bytes are fetched.
    applyVisualLayerImage(ui.stageHeroine, sourceUrl, identity, token, 'character');
    ui.stageHeroine.classList.add('is-visual-active');
    ui.stageHeroine.classList.remove('is-visual-unknown');
    coreVisualHasVerifiedPresentation = true;
    const renderUrl = await resolveVisualRenderUrl(sourceUrl);
    if (token !== visualBundleRequestToken) return;
    if (!renderUrl) {
        restoreVisualLayerAfterLoadFailure(ui.stageHeroine, previousImage, previousIdentity);
        return;
    }
    applyVisualLayerImage(ui.stageHeroine, renderUrl, identity, token, 'character');
}

function restoreVisualLayerAfterLoadFailure(element, previousImage, previousIdentity) {
    if (!element) return;
    if (previousImage) {
        element.style.backgroundImage = previousImage;
        if (previousIdentity) {
            element.dataset.visualAssetIdentity = previousIdentity;
        } else {
            delete element.dataset.visualAssetIdentity;
            element.classList.remove('is-visual-active');
        }
    } else {
        element.style.backgroundImage = `url("${CORE_VISUAL_PLACEHOLDER_URL}")`;
        delete element.dataset.visualAssetIdentity;
        element.classList.remove('is-visual-active');
    }
    if (typeof element.style.removeProperty === 'function') {
        element.style.removeProperty('--visual-previous-image');
    }
    element.classList.remove('is-visual-transitioning');
}

function applyVisualLayerImage(element, renderUrl, identity, token, layer) {
    const nextImage = `url("${renderUrl}")`;
    const previousImage = element.style.backgroundImage;
    const previousIdentity = element.dataset.visualAssetIdentity || '';
    if (previousImage && previousIdentity && previousIdentity !== identity) {
        const transitionToken = `${token}:${layer}:${identity}`;
        element.dataset.visualTransitionToken = transitionToken;
        element.style.setProperty('--visual-previous-image', previousImage);
        element.style.backgroundImage = nextImage;
        element.classList.remove('is-visual-transitioning');
        void element.offsetWidth;
        element.classList.add('is-visual-transitioning');
        setTimeout(() => {
            if (element.dataset.visualTransitionToken !== transitionToken) return;
            if (typeof element.style.removeProperty === 'function') {
        element.style.removeProperty('--visual-previous-image');
    }
            element.classList.remove('is-visual-transitioning');
        }, 460);
    } else {
        element.style.backgroundImage = nextImage;
    }
    element.dataset.visualAssetIdentity = identity;
}

function findCoreVisualIcon(type) {
    const selector = `.visual-icon-${type}`;
    const direct = ui.visualIconStrip?.querySelector?.(selector);
    if (direct) return direct;
    return Array.from(ui.visualIconStrip?.children || []).find((child) => (
        String(child?.className || '').split(/\s+/).includes(`visual-icon-${type}`)
    )) || null;
}

function removeCoreVisualIcon(icon) {
    if (!icon) return;
    if (typeof icon.remove === 'function') {
        icon.remove();
        return;
    }
    const children = ui.visualIconStrip?.children;
    if (Array.isArray(children)) {
        const index = children.indexOf(icon);
        if (index >= 0) children.splice(index, 1);
    }
}

function createCoreVisualIconFigure(type, decision, imageUrl, { placeholder = false } = {}) {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous';
    const loaded = !placeholder && Boolean(imageUrl);
    image.alt = loaded
        ? `${getVisualTypeLabel(type)}：${decision?.assetId || ''}`
        : `${getVisualTypeLabel(type)}暂时不可用`;
    image.src = loaded ? imageUrl : CORE_VISUAL_PLACEHOLDER_URL;
    if (loaded) {
        image.loading = 'lazy';
    }
    const icon = document.createElement('figure');
    icon.className = `visual-icon visual-icon-${type}${loaded ? ' is-visual-active' : ' is-unavailable is-placeholder'}`;
    if (decision?.assetId && decision?.assetVersion) {
        icon.dataset.visualAssetIdentity = `${decision.assetId}:${decision.assetVersion}`;
    }
    const caption = document.createElement('figcaption');
    caption.textContent = getVisualTypeLabel(type);
    icon.dataset.visualType = type;
    icon.setAttribute('role', 'button');
    icon.setAttribute('tabindex', '0');
    icon.setAttribute('aria-label', '打开' + getVisualTypeLabel(type) + '详情');
    icon.setAttribute('title', '点击查看' + getVisualTypeLabel(type) + '详情');
    icon.append(image, caption);
    icon.addEventListener('click', () => openVisualDetailCard(type, icon));
    icon.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openVisualDetailCard(type, icon);
        }
    });
    return icon;
}

async function applyCoreVisualIcons(byType, baseUrl, token) {
    if (!ui.visualIconStrip) {
        return;
    }
    for (const type of VISUAL_ICON_TYPES) {
        const decision = byType.get(type);
        const isUnknown = !decision || String(decision.assetId || '').startsWith('unknown_');
        const candidateUrl = isUnknown ? '' : createCoreVisualContentUrl(decision, baseUrl);
        const identity = decision?.assetId && decision?.assetVersion
            ? `${decision.assetId}:${decision.assetVersion}`
            : '';
        const selector = `.visual-icon-${type}`;
        const existing = findCoreVisualIcon(type);
        if (!candidateUrl) {
            if (existing?.classList?.contains?.('is-visual-active')) {
                continue;
            }
            if (!existing || !existing.classList?.contains?.('is-placeholder')) {
                removeCoreVisualIcon(existing);
                ui.visualIconStrip.append(createCoreVisualIconFigure(type, null, '', { placeholder: true }));
            }
            continue;
        }
        if (!existing || existing.dataset?.visualAssetIdentity !== identity) {
            removeCoreVisualIcon(existing);
            ui.visualIconStrip.append(createCoreVisualIconFigure(type, decision, candidateUrl));
        }
        coreVisualHasVerifiedPresentation = true;
        void resolveVisualRenderUrl(candidateUrl).then((renderUrl) => {
            if (!renderUrl || token !== visualBundleRequestToken) {
                return;
            }
            const current = findCoreVisualIcon(type);
            if (!current || current.dataset?.visualAssetIdentity !== identity) {
                return;
            }
            const image = current.querySelector?.('img');
            if (image && image.src !== renderUrl) {
                image.src = renderUrl;
            }
        });
    }
}
function createCoreVisualContentUrl(decision, baseUrl) {
    const contentPath = decision?.contentPath;
    if (
        !contentPath
        || typeof contentPath !== 'string'
        || !contentPath.startsWith('/v1/core/catalogs/')
        || contentPath.includes('?')
        || contentPath.includes('#')
    ) {
        return '';
    }
    try {
        const url = new URL(contentPath, baseUrl);
        const base = new URL(baseUrl);
        if (
            url.origin !== base.origin
            || url.username
            || url.password
            || url.search
            || url.hash
            || !url.pathname.startsWith('/v1/core/catalogs/')
        ) {
            return '';
        }
        return url.href;
    } catch (_error) {
        return '';
    }
}

function applyCoreVisualPlaceholderBackground() {
    if (!ui.stageBackdrop) {
        return;
    }
    ui.stageBackdrop.style.backgroundImage = `url("${CORE_VISUAL_PLACEHOLDER_URL}")`;
    delete ui.stageBackdrop.dataset.visualAssetIdentity;
    ui.stageBackdrop.classList.remove('is-visual-active', 'is-visual-transitioning');
}

function applyCoreVisualPlaceholderCharacter(role = 'character') {
    if (!ui.stageHeroine) {
        return;
    }
    ui.stageHeroine.style.backgroundImage = `url("${getCoreVisualPlaceholderUrl(role)}")`;
    delete ui.stageHeroine.dataset.visualAssetIdentity;
    ui.stageHeroine.classList.remove('is-visual-active', 'is-visual-unknown', 'is-visual-transitioning');
}

export function restoreDefaultVisualLayers() {
    restoreDefaultBackgroundLayer();
    restoreDefaultCharacterLayer();
}

function restoreDefaultBackgroundLayer() {
    if (ui.stageBackdrop) {
        ui.stageBackdrop.style.backgroundImage = manifest
            ? `url("${getAssetUrl(manifest, manifest.presentation?.defaultBackgroundAsset)}")`
            : '';
        delete ui.stageBackdrop.dataset.visualAssetIdentity;
        ui.stageBackdrop.classList.remove('is-visual-active', 'is-visual-transitioning');
    }
}

function restoreDefaultCharacterLayer() {
    if (ui.stageHeroine) {
        ui.stageHeroine.style.backgroundImage = `url("${getTitleSpriteUrl()}")`;
        delete ui.stageHeroine.dataset.visualAssetIdentity;
        ui.stageHeroine.classList.remove('is-visual-active', 'is-visual-unknown', 'is-visual-transitioning');
    }
}

function setVisualStatus(message) {
    if (ui.visualStatus) {
        ui.visualStatus.textContent = message || '';
        ui.visualStatus.hidden = !message;
    }
}

function getVisualTypeLabel(type) {
    return {
        scene: '场景',
        character: '角色',
        equipment: '装备',
        item: '道具',
        skill: '技能',
    }[type] || '素材';
}

function rememberRenderedVisualRuntimeMessage(snapshot, message, messageIndex) {
    const chatKey = String(snapshot?.fileName || snapshot?.chatId || 'chat_core');
    if (visibleRuntimeChatKey !== chatKey) {
        visibleRuntimeChatKey = chatKey;
        visibleRuntimeMessages.clear();
    }
    // Seed history only on the first render of a chat. Later renders keep the
    // rendered-message guard so a replaced snapshot cannot leak unseen text.
    const shouldHydrateSnapshot = visibleRuntimeMessages.size === 0;
    const snapshotMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    for (const [index, remembered] of visibleRuntimeMessages.entries()) {
        const snapshotMessage = snapshotMessages[index];
        if (!snapshotMessage) {
            visibleRuntimeMessages.delete(index);
            continue;
        }
        const normalizedSnapshotMessage = normalizePlayerVisualRuntimeMessage({
            index,
            role: snapshotMessage.role === 'player' ? 'player' : 'character',
            speaker: snapshotMessage.role === 'player' ? '你' : snapshotMessage.speaker || getMainCharacterName(),
            text: snapshotMessage.displayText || snapshotMessage.text || '',
        });
        if (!normalizedSnapshotMessage || canonicalJson(normalizedSnapshotMessage) !== canonicalJson(remembered)) {
            visibleRuntimeMessages.delete(index);
        }
    }
    const startIndex = Math.max(0, Number(messageIndex) - 3);
    if (shouldHydrateSnapshot) {
        for (let index = startIndex; index < Number(messageIndex); index += 1) {
            const snapshotMessage = snapshotMessages[index];
        if (!snapshotMessage) {
            visibleRuntimeMessages.delete(index);
            continue;
        }
        const normalizedSnapshotMessage = normalizePlayerVisualRuntimeMessage({
            index,
            role: snapshotMessage.role === 'player' ? 'player' : 'character',
            speaker: snapshotMessage.role === 'player' ? '你' : snapshotMessage.speaker || getMainCharacterName(),
            text: snapshotMessage.displayText || snapshotMessage.text || '',
        });
            if (normalizedSnapshotMessage) {
                visibleRuntimeMessages.set(index, normalizedSnapshotMessage);
            } else {
                visibleRuntimeMessages.delete(index);
            }
        }
    }
    const normalized = normalizePlayerVisualRuntimeMessage({
        index: messageIndex,
        role: message?.role === 'player' ? 'player' : 'character',
        speaker: message?.role === 'player' ? '你' : message?.speaker || getMainCharacterName(),
        text: message?.displayText || message?.text || '',
    });
    if (normalized) {
        visibleRuntimeMessages.set(messageIndex, normalized);
    }
}

function getRenderedVisualRuntimeContext(snapshot, message, messageIndex) {
    rememberRenderedVisualRuntimeMessage(snapshot, message, messageIndex);
    const current = visibleRuntimeMessages.get(messageIndex);
    if (!current) {
        return null;
    }
    const recent = [...visibleRuntimeMessages.values()]
        .filter((item) => item.index < current.index)
        .sort((left, right) => right.index - left.index)
        .slice(0, 3)
        .reverse()
        .map((item) => ({
            ...item,
            // The runtime contract allows up to 1,200 characters for history.
            // Keep the tail so status and inventory lines remain available.
            text: Array.from(item.text).slice(-1200).join(''),
        }));
    return { current, recent };
}

function sanitizeCoreVisualProtocolValue(value, maxLength = 120) {
    return String(value || '')
        .normalize('NFC')
        .replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeCoreVisualProtocolAttributes(attributes) {
    const seen = new Set();
    return (Array.isArray(attributes) ? attributes : [])
        .map((attribute) => ({
            ...attribute,
            value: sanitizeCoreVisualProtocolValue(attribute?.value, 120),
        }))
        .filter((attribute) => {
            if (!attribute.value || seen.has(attribute.code)) {
                return false;
            }
            seen.add(attribute.code);
            return true;
        });
}

async function createCoreVisualDecisionRequest({ snapshot, message, messageIndex, visualProfile }) {
    const visibleContext = getRenderedVisualRuntimeContext(snapshot, message, messageIndex);
    if (!visibleContext) {
        throw new Error('VISIBLE_RUNTIME_CONTEXT_INVALID');
    }
    const activeSpeakerContext = getActiveVisualSpeakerContext(message, messageIndex);
    const activeSegment = activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    const activeSegmentRole = activeSpeakerContext.role;
    const activeSegmentSpeaker = activeSegment ? activeSpeakerContext.speaker : '';
    const segmentMessage = activeSegment
        ? normalizePlayerVisualRuntimeMessage({
            index: messageIndex,
            role: activeSegmentRole,
            speaker: activeSegmentSpeaker,
            text: activeSegment.text || visibleContext.current.text || '',
        })
        : null;
    const displayedMessage = segmentMessage || visibleContext.current;
    const fullMessage = normalizePlayerVisualRuntimeMessage({
        index: messageIndex,
        role: message?.role === 'player'
            ? 'player'
            : message?.role === 'system'
                ? 'system'
                : 'character',
        speaker: message?.role === 'player'
            ? '你'
            : message?.role === 'system'
                ? '系统'
                : message?.speaker || getMainCharacterName(),
        text: message?.displayText || message?.text || '',
    });
    // Keep the full visible text available to the runtime analyzer while
    // retaining the active paragraph's speaker for avatar binding.
    const decisionContextMessage = segmentMessage && fullMessage
        ? {
            ...fullMessage,
            role: displayedMessage.role,
            speaker: displayedMessage.speaker,
        }
        : (fullMessage || displayedMessage);
    const effectiveVisibleContext = segmentMessage
        ? { ...visibleContext, current: decisionContextMessage }
        : visibleContext;
    const sourceMessageHash = await sha256Digest(canonicalJson(decisionContextMessage));
    const activeArcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || '';
    const bindingMessage = displayedMessage.role === 'character' ? displayedMessage : fullMessage;
    const characterBinding = bindingMessage?.role === 'character'
        ? resolveVisualCharacterBinding(manifest, {
            name: bindingMessage.speaker,
            role: 'character',
            arcId: activeArcId,
            allowCharacterPoolFallback: false,
        })
        : null;
    const hasActiveCharacterBinding = displayedMessage.role === 'character' && Boolean(characterBinding);
    const entities = [];
    // Extract equipment, item, skill and scene labels from the full visible
    // message. The active paragraph is only the character/voice selection
    // input; using it as the whole projection drops status lines that follow.
    const fullHints = createCoreVisualDisplayEntityHints(fullMessage || displayedMessage);
    const isExplicitCharacterHint = (hint) => hint.entityType === 'character'
        && hint.visibleAttributes?.some((attribute) => attribute.code === 'character-explicit-appearance');
    let hints = hasActiveCharacterBinding
        ? fullHints
        : fullHints.filter((hint) => hint.entityType !== 'character' || isExplicitCharacterHint(hint));
    if (segmentMessage) {
        const segmentHints = createCoreVisualDisplayEntityHints(segmentMessage);
        const segmentCharacterHint = segmentHints.find((hint) => hint.entityType === 'character');
        const fullCharacterHint = fullHints.find((hint) => hint.entityType === 'character');
        const activeCharacterHint = hasActiveCharacterBinding
            ? (segmentCharacterHint || {
                entityKeySeed: `active-speaker:${displayedMessage.speaker}`,
                entityType: 'character',
                displayLabel: displayedMessage.speaker || '角色',
                visibleAttributes: [{
                    code: 'character-explicit-name',
                    value: (displayedMessage.speaker || '角色').slice(0, 120),
                    confidenceBand: 'explicit',
                }],
                confidenceBand: 'explicit',
            })
            : null;
        if (activeCharacterHint && fullCharacterHint && activeCharacterHint !== fullCharacterHint) {
            const attributes = [...(activeCharacterHint.visibleAttributes || [])];
            const seenCodes = new Set(attributes.map((attribute) => attribute.code));
            for (const attribute of fullCharacterHint.visibleAttributes || []) {
                if (!seenCodes.has(attribute.code)) {
                    attributes.push(attribute);
                    seenCodes.add(attribute.code);
                }
            }
            activeCharacterHint.visibleAttributes = attributes;
        }
        hints = [
            ...(activeCharacterHint ? [activeCharacterHint] : []),
            ...fullHints.filter((hint) => activeCharacterHint
                ? hint.entityType !== 'character'
                : hint.entityType !== 'character' || isExplicitCharacterHint(hint)),
        ];
    } else if (hasActiveCharacterBinding && !hints.some((hint) => hint.entityType === 'character')) {
        hints = [{
            entityKeySeed: `active-speaker:${displayedMessage.speaker}`,
            entityType: 'character',
            displayLabel: displayedMessage.speaker || '旁白',
            visibleAttributes: [{
                code: 'character-explicit-name',
                value: (displayedMessage.speaker || '旁白').slice(0, 120),
                confidenceBand: 'explicit',
            }],
            confidenceBand: 'explicit',
        }, ...hints];
    }
    const entityKeys = new Set();
    const entityTypes = new Set();
    for (const hint of hints) {
        if (!CORE_VISUAL_TYPES.includes(hint.entityType)) {
            continue;
        }
        if (hint.entityType === 'character' && entityTypes.has('character')) {
            continue;
        }
        const entityKey = await createCoreVisualDisplayEntityKey(hint.entityType, hint.entityKeySeed);
        if (entityKeys.has(entityKey)) {
            continue;
        }
        entityKeys.add(entityKey);
        entityTypes.add(hint.entityType);
        entities.push({
            entityKey,
            entityType: hint.entityType,
            displayLabel: sanitizeCoreVisualProtocolValue(hint.displayLabel, 80)
                || getVisualTypeLabel(hint.entityType),
            visibleAttributes: sanitizeCoreVisualProtocolAttributes(
                hint.entityType === 'character'
                    ? [
                        ...hint.visibleAttributes.filter((attribute) => attribute.code !== 'character-explicit-name'),
                        ...(bindingMessage?.role === 'character' && bindingMessage.speaker
                            ? [{
                                code: 'character-explicit-name',
                                value: bindingMessage.speaker.slice(0, 120),
                                confidenceBand: 'explicit',
                            }]
                            : []),
                        ...(characterBinding && bindingMessage?.speaker
                            ? [{
                                code: 'character-visual-binding',
                                value: characterBinding.assetId,
                                confidenceBand: 'explicit',
                            }]
                            : []),
                    ]
                    : hint.visibleAttributes,
            ),
            confidenceBand: hint.confidenceBand,
        });
    }
    const projectedTypes = new Set(entities.map((entity) => entity.entityType));
    for (const type of CORE_VISUAL_TYPES) {
        if (type === 'character' && !hasActiveCharacterBinding && !projectedTypes.has('character')) {
            continue;
        }
        if (projectedTypes.has(type)) {
            continue;
        }
        entities.push({
            entityKey: await createCoreVisualDisplayEntityKey(type, `runtime-slot:${displayedMessage.index}:${sourceMessageHash}`),
            entityType: type,
            displayLabel: getVisualTypeLabel(type),
            visibleAttributes: [],
            confidenceBand: 'unknown',
        });
    }
    const baseProjection = {
        projectionId: '',
        projectionHash: '',
        sourceMessageIndex: messageIndex,
        sourceMessageHash,
        releaseId: release?.releaseId || 'release_core_unknown',
        scenarioId: release?.scenarioId || manifest?.id || 'scenario_core_unknown',
        scenarioVersion: release?.scenarioVersion || manifest?.version || 'v1',
        arcId: release?.activeArcId || release?.arcId || manifest?.defaultArcId || 'arc_core',
        chatId: snapshot?.fileName || snapshot?.chatId || 'chat_core',
        entities,
    };
    const projectionId = await createCoreVisualPrefixedId('vvp', [
        baseProjection.releaseId,
        baseProjection.arcId,
        baseProjection.chatId,
        baseProjection.sourceMessageIndex,
        baseProjection.sourceMessageHash,
    ]);
    const projection = {
        ...baseProjection,
        projectionId,
    };
    projection.projectionHash = await sha256Digest(canonicalJson(projection));
    return {
        schemaVersion: CORE_VISUAL_DECISION_REQUEST_VERSION,
        requestId: await createCoreVisualPrefixedId('req', [projection.projectionId, projection.sourceMessageHash, visualProfile.catalogHash]),
        projection,
        visibleContext: effectiveVisibleContext,
        visualProfile,
        expectedProjectionHash: projection.projectionHash,
        expectedSourceMessageHash: projection.sourceMessageHash,
        createdAt: new Date().toISOString(),
    };
}

function getCoreVisualServiceUrl() {
    const globalConfig = window.GALGAME_CORE_VISUAL_SERVICE || window.GALGAME_VISUAL_CORE_SERVICE || '';
    const globalEndpoint = typeof globalConfig === 'string'
        ? globalConfig
        : globalConfig.endpoint || '';
    const metaEndpoint = document
        .querySelector?.('meta[name="galgame-visual-core-service"]')
        ?.getAttribute?.('content') || '';
    return String(globalEndpoint || metaEndpoint || '')
        .trim()
        .replace(/\/+$/, '');
}

async function createCoreVisualPrefixedId(prefix, parts) {
    const digest = await sha256Hex(canonicalJson(parts));
    return `${prefix}_${digest.slice(0, 32)}`;
}

async function sha256Digest(value) {
    return `sha256:${await sha256Hex(value)}`;
}

async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function canonicalJson(value) {
    return JSON.stringify(sortCanonical(value));
}

function sortCanonical(value) {
    if (Array.isArray(value)) {
        return value.map(sortCanonical);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortCanonical(value[key])]));
    }
    return value;
}

function renderBridgeUnavailable() {
    clearDialoguePlayback();
    hideAdaptivePanels();
    ui.speakerName.textContent = getMainCharacterName();
    ui.dialogueText.textContent = '故事暂时还没有接上。请稍后再试。';
    applySegmentPresentation({ type: 'narration' });
    setStageStatus('你可以稍后刷新回应。');
    setRecoveryVisible(true);
    renderSuggestedActions();
    setInputEnabled(false);
}

function renderWaitingForReply() {
    completeTypewriter();
    setStageStatus('这一段暂时没接上。可以再试一次。');
    ui.refreshStoryButton.textContent = '再试一次';
    setRecoveryVisible(true);
    renderSuggestedActions();
    setInputEnabled(false);
}

function renderThinkingForReply() {
    completeTypewriter();
    setStageStatus('思考中...');
    ui.refreshStoryButton.textContent = '再试一次';
    setRecoveryVisible(false);
    renderSuggestedActions();
    setInputEnabled(false);
}

function renderAdaptivePanels(message, snapshot, messageIndex) {
    if (!ui.adaptivePanels) {
        return;
    }
    hideAdaptivePanels();
    if (!message || message.role !== 'character') {
        return;
    }

    const text = message.displayText || message.text || '';
    activeVisualDetailHints.clear();
    const visualHints = createCoreVisualDisplayEntityHints({
        index: messageIndex,
        role: message.role,
        speaker: message.speaker || getMainCharacterName(),
        text,
    });
    for (const hint of visualHints) {
        if (!CORE_VISUAL_TYPES.includes(hint.entityType)) {
            continue;
        }
        const list = activeVisualDetailHints.get(hint.entityType) || [];
        list.push(hint);
        activeVisualDetailHints.set(hint.entityType, list);
    }
    const profile = getAdaptivePresentationProfile();
    const extraction = extractAdaptivePresentation([
        {
            text,
            chatId: snapshot?.fileName || '',
            messageIndex,
        },
    ], {
        profile,
        chatId: snapshot?.fileName || '',
        messageIndex,
    });
    const panelResults = selectAdaptivePanelResults(extraction.results, profile);
    activeAdaptivePanelResults = new Map(panelResults.map((result) => [result.module, result]));
    const centralPanelResults = panelResults.filter((result) => !RIGHT_TOP_ADAPTIVE_MODULES.has(result.module));

    if (!centralPanelResults.length) {
        return;
    }
    ui.adaptivePanels.replaceChildren(createAdaptiveStatusBeltElement(centralPanelResults, profile));
    ui.adaptivePanels.hidden = false;
}

export function selectAdaptivePanelResults(results, profile = getAdaptivePresentationProfile()) {
    return asArray(results)
        .filter((result) => result.module !== 'actions')
        .filter((result) => result.displayOnly === true)
        .sort((left, right) => compareAdaptivePanelResults(left, right, profile));
}

export function summarizeAdaptiveTemplateRender(results, profile = getAdaptivePresentationProfile()) {
    const panelResults = selectAdaptivePanelResults(results, profile);
    const template = getAdaptiveTemplateId(profile);
    return {
        template,
        beltClass: `adaptive-status-belt template-${sanitizeClassName(template)}`,
        empty: panelResults.length === 0,
        primaryModule: panelResults.length ? getAdaptivePrimaryModule(panelResults, profile) : '',
        moduleOrder: panelResults.map((result) => result.module),
        unknownModules: panelResults
            .map((result) => result.module)
            .filter((moduleId) => getAdaptiveTemplateMatrix(profile).order.indexOf(moduleId) < 0),
    };
}

function hideAdaptivePanels() {
    if (!ui.adaptivePanels) {
        return;
    }
    ui.adaptivePanels.replaceChildren();
    ui.adaptivePanels.hidden = true;
    activeAdaptivePanelResults = new Map();
    activeVisualDetailHints.clear();
    closeAdaptiveDetail();
}

function createAdaptiveStatusBeltElement(results, profile = getAdaptivePresentationProfile()) {
    const belt = document.createElement('section');
    const template = getAdaptiveTemplateId(profile);
    belt.className = `adaptive-status-belt template-${sanitizeClassName(template)}`;
    belt.dataset.template = template;
    belt.setAttribute('aria-label', `${getAdaptiveTemplateLabel(template)}摘要`);

    const primaryModule = getAdaptivePrimaryModule(results, profile);
    const primaryResult = results.find((result) => result.module === primaryModule) || results[0];
    const primaryPanel = createAdaptivePanelElement(primaryResult);
    if (primaryPanel) {
        primaryPanel.classList.add('is-belt-primary');
        belt.append(primaryPanel);
    }

    const secondaryResults = results.filter((result) => result !== primaryResult);
    if (secondaryResults.length) {
        const secondary = document.createElement('div');
        secondary.className = 'adaptive-status-secondary';
        for (const result of secondaryResults) {
            const panel = createAdaptivePanelElement(result);
            if (panel) {
                panel.classList.add('is-belt-secondary');
                secondary.append(panel);
            }
        }
        belt.append(secondary);
    }

    return belt;
}

function createAdaptivePanelElement(result) {
    const items = getAdaptivePanelItems(result);
    if (!items.length) {
        return null;
    }
    if (result.module === 'rpg-status') {
        return createRpgStatusPanelElement(result, items);
    }
    const meta = getAdaptiveModuleMeta(result.module);
    const groups = getAdaptiveGroups(result);
    const section = document.createElement('section');
    section.className = `adaptive-panel adaptive-panel-${sanitizeClassName(result.module)}`;
    section.dataset.module = result.module;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'adaptive-panel-button';
    button.dataset.module = result.module;
    button.setAttribute('aria-label', `查看${getAdaptiveModuleLabel(result.module)}详情`);

    const kicker = document.createElement('span');
    kicker.className = 'adaptive-panel-kicker';
    kicker.textContent = meta.kicker;
    button.append(kicker);

    const heading = document.createElement('span');
    heading.className = 'adaptive-panel-head';
    const title = document.createElement('span');
    title.className = 'adaptive-panel-title';
    title.textContent = meta.label;
    const count = document.createElement('span');
    count.className = 'adaptive-panel-count';
    count.textContent = `${groups.length || items.length}`;
    heading.append(title, count);
    button.append(heading);

    const list = document.createElement('div');
    list.className = 'adaptive-panel-items';
    const summaryItems = getAdaptivePanelSummaryItems(result, items);
    for (const item of summaryItems) {
        list.append(createAdaptiveChipElement(item));
    }
    button.append(list);
    button.addEventListener('click', (event) => openAdaptiveDetail(result, items, event.currentTarget));
    section.append(button);
    return section;
}

function createRpgStatusPanelElement(result, items) {
    const fields = result?.values?.fields || {};
    const stats = getRpgHudStats(fields);
    const section = document.createElement('section');
    section.className = 'adaptive-panel adaptive-panel-rpg-status is-primary-hud';
    section.dataset.module = result.module;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'adaptive-panel-button adaptive-hud-button';
    button.dataset.module = result.module;
    button.setAttribute('aria-label', '查看状态详情');

    const header = document.createElement('span');
    header.className = 'adaptive-hud-header';
    const titleGroup = document.createElement('span');
    titleGroup.className = 'adaptive-hud-title-group';
    const kicker = document.createElement('span');
    kicker.className = 'adaptive-panel-kicker';
    kicker.textContent = 'STATUS';
    const title = document.createElement('span');
    title.className = 'adaptive-panel-title';
    title.textContent = '角色状态';
    titleGroup.append(kicker, title);
    const cue = document.createElement('span');
    cue.className = 'adaptive-detail-cue';
    cue.textContent = '详情';
    header.append(titleGroup, cue);
    button.append(header);

    const grid = document.createElement('div');
    grid.className = 'rpg-hud-grid';
    const visibleStats = stats.length ? stats : items.slice(0, 4).map((item) => ({
        key: sanitizeClassName(item.label),
        label: item.label,
        value: item.value || '',
        tone: item.tone || '',
    }));
    for (const stat of visibleStats.slice(0, 6)) {
        grid.append(createRpgHudStatElement(stat));
    }
    button.append(grid);
    button.addEventListener('click', (event) => openAdaptiveDetail(result, items, event.currentTarget));
    section.append(button);
    return section;
}

function createRpgHudStatElement(stat) {
    const item = document.createElement('span');
    item.className = `rpg-hud-stat${stat.tone ? ` tone-${sanitizeClassName(stat.tone)}` : ''}`;
    item.dataset.stat = stat.key || '';
    const label = document.createElement('span');
    label.className = 'rpg-hud-label';
    label.textContent = stat.label;
    const value = document.createElement('span');
    value.className = 'rpg-hud-value';
    value.textContent = stat.value || '未知';
    item.append(label, value);
    if (Number.isFinite(stat.current) && Number.isFinite(stat.max) && stat.max > 0) {
        const meter = document.createElement('span');
        meter.className = 'rpg-hud-meter';
        meter.style.setProperty('--meter-value', `${Math.max(0, Math.min(100, Math.round((stat.current / stat.max) * 100)))}%`);
        item.append(meter);
    }
    return item;
}

function createAdaptiveChipElement(item) {
    const chip = document.createElement('span');
    chip.className = createAdaptiveChipClassName(item);
    const label = document.createElement('span');
    label.className = 'adaptive-chip-label';
    label.textContent = item.label;
    chip.append(label);
    const value = item.count || item.value;
    if (value) {
        const valueEl = document.createElement('span');
        valueEl.className = 'adaptive-chip-value';
        valueEl.textContent = String(value);
        chip.append(valueEl);
    }
    return chip;
}

function createAdaptiveChipClassName(item) {
    const classes = ['adaptive-chip'];
    if (item.emphasis) {
        classes.push('is-emphasis');
    }
    if (item.tone) {
        classes.push(`tone-${sanitizeClassName(item.tone)}`);
    }
    return classes.join(' ');
}

function getAdaptivePanelSummaryItems(result, fallbackItems) {
    const groups = getAdaptiveGroups(result);
    if (groups.length) {
        return groups.slice(0, 5).map((group) => ({
            label: group.title,
            count: asArray(group.items).length,
            tone: group.tone,
            emphasis: group.tone === 'danger',
        }));
    }
    return fallbackItems.slice(0, 5);
}

export function compareAdaptivePanelResults(left, right, profile = getAdaptivePresentationProfile()) {
    return getAdaptivePanelPriority(left.module, profile) - getAdaptivePanelPriority(right.module, profile);
}

export function getAdaptivePanelPriority(moduleId, profile = getAdaptivePresentationProfile()) {
    const profilePriority = getAdaptiveProfilePriority(moduleId, profile);
    if (Number.isFinite(profilePriority)) {
        return profilePriority;
    }
    const template = getAdaptiveTemplateMatrix(profile);
    const templateIndex = template.order.indexOf(moduleId);
    if (templateIndex >= 0) {
        return 20 + templateIndex;
    }
    return ({
        'rpg-status': 0,
        dice: 1,
        inventory: 2,
        abilities: 3,
        resources: 4,
        objectives: 5,
        quests: 6,
        clues: 7,
        locations: 8,
        relationships: 9,
        affection: 10,
        calendar: 11,
        events: 12,
        suspects: 13,
        factions: 14,
        gifts: 15,
        notes: 16,
    }[moduleId] ?? 80);
}

function getAdaptiveProfilePriority(moduleId, profile) {
    const visualPriority = profile?.visualPriority || {};
    if (visualPriority.primaryPanel === moduleId) {
        return 0;
    }
    const secondaryIndex = asArray(visualPriority.secondaryPanels).indexOf(moduleId);
    if (secondaryIndex >= 0) {
        return 5 + secondaryIndex;
    }
    return Number.NaN;
}

export function getAdaptivePrimaryModule(results, profile) {
    const available = new Set(results.map((result) => result.module));
    const visualPrimary = profile?.visualPriority?.primaryPanel;
    if (visualPrimary && available.has(visualPrimary)) {
        return visualPrimary;
    }
    const templatePrimary = getAdaptiveTemplateMatrix(profile).primary;
    if (templatePrimary && available.has(templatePrimary)) {
        return templatePrimary;
    }
    return results[0]?.module || '';
}

export function getAdaptiveTemplateMatrix(profile) {
    return adaptiveTemplateMatrix[getAdaptiveTemplateId(profile)] || adaptiveTemplateMatrix['visual-novel'];
}

export function getAdaptiveTemplateId(profile) {
    return adaptiveTemplateMatrix[profile?.template] ? profile.template : 'visual-novel';
}

export function getAdaptiveTemplateLabel(template) {
    return {
        'visual-novel': '视觉小说信息',
        'rpg-adventure': '冒险状态',
        'romance-social': '关系状态',
        'mystery-investigation': '调查线索',
        'management-sim': '经营状态',
        'sandbox-roleplay': '沙盒记录',
    }[template] || '当前信息';
}

function getAdaptivePanelItems(result) {
    const values = result?.values || {};
    switch (result.module) {
        case 'rpg-status':
            return formatRpgStatus(values.fields || {});
        case 'inventory':
            return formatNamedItems(values.items);
        case 'abilities':
            return formatNamedItems(values.abilities);
        case 'quests':
            return formatNamedItems(values.quests);
        case 'relationships':
            return formatNamedItems(values.relationships);
        case 'affection':
            return formatAffectionItems(values.affection);
        case 'gifts':
            return formatNamedItems(values.gifts);
        case 'events':
            return formatNamedItems(values.events);
        case 'calendar':
            return formatNamedItems(values.calendar);
        case 'clues':
            return formatNamedItems(values.clues);
        case 'suspects':
            return formatNamedItems(values.suspects);
        case 'locations':
            return formatNamedItems(values.locations);
        case 'factions':
            return formatNamedItems(values.factions);
        case 'resources':
            return formatNamedItems(values.resources, { emphasis: true });
        case 'objectives':
            return formatNamedItems(values.objectives);
        case 'dice':
            return formatNamedItems(values.events);
        case 'notes':
            return formatNamedItems(values.notes);
        default:
            return formatAdminPatternItems(values.matches);
    }
}

function getAdaptiveGroups(result) {
    return asArray(result?.values?.groups)
        .map((group) => ({
            id: group.id || sanitizeClassName(group.title || 'group'),
            title: group.title || '记录',
            tone: group.tone || 'neutral',
            items: asArray(group.items).map(normalizeAdaptiveDetailItem).filter((item) => item.label),
        }))
        .filter((group) => group.items.length);
}

function normalizeAdaptiveDetailItem(item) {
    if (typeof item === 'string') {
        return { label: item, raw: item };
    }
    const name = item?.name || item?.label || '';
    const value = item?.value || '';
    const label = name || item?.raw || '';
    return {
        label: String(label || '').trim(),
        value: String(value || '').trim(),
        raw: item?.raw || label,
        traits: asArray(item?.traits || item?.tags).map((trait) => String(trait || '').trim()).filter(Boolean),
        tone: item?.tone || '',
        emphasis: Boolean(item?.emphasis),
        originalName: item?.originalName || '',
    };
}

function openVisualDetailCard(type, returnFocusTarget = null) {
    const adaptiveModule = getVisualCardModule(type);
    const sourceResult = adaptiveModule ? activeAdaptivePanelResults.get(adaptiveModule) : null;
    if (sourceResult) {
        let detailResult = { ...sourceResult, module: type };
        if (type === 'item' && Array.isArray(sourceResult.values?.groups)) {
            const groups = sourceResult.values.groups.filter((group) => group?.id !== 'weapons');
            if (groups.length) {
                detailResult = {
                    ...detailResult,
                    values: { ...sourceResult.values, groups },
                };
            }
        }
        const fallbackItems = getAdaptivePanelItems(detailResult);
        openAdaptiveDetail(detailResult, fallbackItems, returnFocusTarget);
        return;
    }
    const result = createVisualDetailResult(type, coreVisualPresentationState.get(type));
    openAdaptiveDetail(result, getAdaptivePanelItems(result), returnFocusTarget);
}

function getVisualDetailItems(type, decision) {
    const decisionEntries = coreVisualPresentationDetails.get(type)
        || (decision ? [decision] : []);
    const hintEntries = activeVisualDetailHints.get(type) || [];
    const entries = decisionEntries.length ? decisionEntries : hintEntries;
    const items = [];
    for (const entry of entries) {
        const displayLabel = String(entry?.displayLabel || '').trim();
        if (!displayLabel) {
            continue;
        }
        const attributeValues = asArray(entry?.visibleAttributes)
            .map((attribute) => String(attribute?.value || '').trim())
            .filter((value) => value && value !== displayLabel);
        const names = type === 'skill'
            ? displayLabel.split(/[,，;；]/u).map((value) => value.trim()).filter(Boolean)
            : [displayLabel];
        for (const name of names) {
            items.push({
                name,
                value: attributeValues.length ? attributeValues.join(' · ') : '',
                raw: displayLabel,
                traits: type === 'skill' && names.length > 1 ? ['当前技能'] : [],
            });
        }
    }
    return items;
}

function createVisualDetailResult(type, decision) {
    const label = getVisualTypeLabel(type);
    const items = getVisualDetailItems(type, decision);
    const visibleItems = items.length
        ? items
        : [{
            name: '当前未识别到' + label,
            value: '当前对白或状态文本没有提供可展开的' + label + '信息',
            raw: '',
        }];
    return {
        module: type,
        values: {
            groups: [{
                title: label + '明细',
                tone: type === 'skill' ? 'skill' : type === 'item' ? 'item' : 'gold',
                items: visibleItems,
            }],
        },
    };
}

function openAdaptiveDetail(result, fallbackItems = [], returnFocusTarget = null) {
    if (!ui.adaptiveDetailDrawer || !ui.adaptiveDetailTitle || !ui.adaptiveDetailBody) {
        return;
    }
    const isHtmlElement = (value) => typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
    adaptiveDetailReturnFocus = isHtmlElement(returnFocusTarget)
        ? returnFocusTarget
        : isHtmlElement(document.activeElement)
        ? document.activeElement
        : null;
    adaptiveDetailReturnModule = result?.module || '';
    const title = getAdaptiveModuleMeta(result.module).label;
    ui.adaptiveDetailTitle.textContent = title;
    ui.adaptiveDetailBody.replaceChildren(...createAdaptiveDetailNodes(result, fallbackItems));
    ui.adaptiveDetailDrawer.hidden = false;
    document.body.classList.add('adaptive-detail-open');
    ui.adaptiveDetailClose?.focus();
}

function closeAdaptiveDetail() {
    if (!ui.adaptiveDetailDrawer) {
        return;
    }
    const shouldRestoreFocus = !ui.adaptiveDetailDrawer.hidden;
    ui.adaptiveDetailDrawer.hidden = true;
    document.body.classList.remove('adaptive-detail-open');
    const returnFocusTarget = shouldRestoreFocus
        ? getAdaptiveDetailReturnFocusTarget()
        : null;
    const returnFocusModule = adaptiveDetailReturnModule;
    if (globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__) {
        globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__ = {
            shouldRestoreFocus,
            returnFocusModule,
            hasReturnFocusTarget: Boolean(returnFocusTarget),
            returnFocusTargetModule: returnFocusTarget?.dataset?.module || '',
            returnFocusTargetTag: returnFocusTarget?.tagName || '',
            returnFocusTargetDisabled: Boolean(returnFocusTarget?.disabled),
            returnFocusTargetTabIndex: Number.isInteger(returnFocusTarget?.tabIndex) ? returnFocusTarget.tabIndex : null,
            returnFocusTargetOffsetParent: Boolean(returnFocusTarget?.offsetParent),
            beforeFocusActive: document.activeElement?.id || document.activeElement?.tagName || '',
        };
    }
    if (returnFocusTarget) {
        focusAdaptiveReturnTarget(returnFocusTarget);
        if (globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__) {
            globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__.afterImmediateFocus = document.activeElement?.dataset?.module
                || document.activeElement?.id
                || document.activeElement?.tagName
                || '';
        }
        window.setTimeout(() => {
            const fallbackTarget = getAdaptivePanelButtonByModule(returnFocusModule);
            const focusTarget = returnFocusTarget.isConnected ? returnFocusTarget : fallbackTarget;
            if (focusTarget) {
                focusAdaptiveReturnTarget(focusTarget);
            }
            if (globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__ && globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__) {
                globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__.hasDelayedFallbackTarget = Boolean(fallbackTarget);
                globalThis.__GALGAME_TEST_LAST_ADAPTIVE_CLOSE__.afterDelayedFocus = document.activeElement?.dataset?.module
                    || document.activeElement?.id
                    || document.activeElement?.tagName
                    || '';
            }
        }, 60);
    }
    adaptiveDetailReturnFocus = null;
    adaptiveDetailReturnModule = '';
}

function getAdaptiveDetailReturnFocusTarget() {
    if (adaptiveDetailReturnFocus?.isConnected) {
        return adaptiveDetailReturnFocus;
    }
    const visualType = getVisualCardType(adaptiveDetailReturnModule)
        || (['equipment', 'item', 'skill'].includes(adaptiveDetailReturnModule) ? adaptiveDetailReturnModule : '');
    const visualTarget = visualType
        ? ui.visualIconStrip?.querySelector?.('[data-visual-type="' + visualType + '"]')
        : null;
    if (visualTarget) {
        return visualTarget;
    }
    if (!adaptiveDetailReturnModule || !ui.adaptivePanels) {
        return null;
    }
    return Array.from(ui.adaptivePanels.querySelectorAll('button[data-module]'))
        .find((button) => button.dataset.module === adaptiveDetailReturnModule) || null;
}

function getAdaptivePanelButtonByModule(moduleId) {
    if (!moduleId || !ui.adaptivePanels) {
        return null;
    }
    return Array.from(ui.adaptivePanels.querySelectorAll('button[data-module]'))
        .find((button) => button.dataset.module === moduleId) || null;
}

function focusAdaptiveReturnTarget(target) {
    if (!target) {
        return;
    }
    if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '0');
    }
    target.focus({ preventScroll: true });
}

function trapAdaptiveDetailFocus(event) {
    const focusable = getFocusableElements(ui.adaptiveDetailDrawer);
    if (!focusable.length) {
        event.preventDefault();
        ui.adaptiveDetailClose?.focus();
        return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
        return;
    }
    if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

function getFocusableElements(root) {
    if (!root) {
        return [];
    }
    return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element instanceof HTMLElement && !element.disabled && !element.hidden && element.offsetParent !== null);
}

function createAdaptiveDetailNodes(result, fallbackItems) {
    const groups = getAdaptiveGroups(result);
    if (groups.length) {
        return groups.map(createAdaptiveDetailGroup);
    }
    const section = document.createElement('section');
    section.className = 'adaptive-detail-group tone-neutral';
    const heading = document.createElement('h3');
    heading.textContent = '完整记录';
    section.append(heading);
    const list = document.createElement('div');
    list.className = 'adaptive-detail-list';
    for (const item of fallbackItems.map(normalizeAdaptiveDetailItem)) {
        list.append(createAdaptiveDetailItem(item));
    }
    section.append(list);
    return [section];
}

function createAdaptiveDetailGroup(group) {
    const section = document.createElement('section');
    section.className = `adaptive-detail-group tone-${sanitizeClassName(group.tone)}`;
    const head = document.createElement('div');
    head.className = 'adaptive-detail-group-head';
    const heading = document.createElement('h3');
    heading.textContent = group.title;
    const count = document.createElement('span');
    count.className = 'adaptive-detail-count';
    count.textContent = `${group.items.length}`;
    head.append(heading, count);
    section.append(head);
    const list = document.createElement('div');
    list.className = 'adaptive-detail-list';
    for (const item of group.items) {
        list.append(createAdaptiveDetailItem(item));
    }
    section.append(list);
    return section;
}

function createAdaptiveDetailItem(item) {
    const article = document.createElement('article');
    article.className = `adaptive-detail-item${item.emphasis ? ' is-emphasis' : ''}`;
    const main = document.createElement('div');
    main.className = 'adaptive-detail-main';
    const label = document.createElement('p');
    label.className = 'adaptive-detail-label';
    label.textContent = item.label;
    main.append(label);
    if (item.value) {
        const value = document.createElement('p');
        value.className = 'adaptive-detail-value';
        value.textContent = item.value;
        main.append(value);
    }
    article.append(main);
    if (item.originalName && item.originalName !== item.label) {
        const original = document.createElement('p');
        original.className = 'adaptive-detail-original';
        original.textContent = item.originalName;
        article.append(original);
    }
    if (item.traits.length) {
        const traits = document.createElement('div');
        traits.className = 'adaptive-detail-traits';
        for (const trait of item.traits) {
            const chip = document.createElement('span');
            chip.textContent = trait;
            traits.append(chip);
        }
        article.append(traits);
    }
    if (item.raw
        && item.raw !== item.label
        && item.raw !== item.originalName
        && item.raw !== `${item.label} ${item.value}`.trim()) {
        const raw = document.createElement('p');
        raw.className = 'adaptive-detail-raw';
        raw.textContent = item.raw;
        article.append(raw);
    }
    return article;
}

function getAdaptiveModuleMeta(moduleId) {
    const label = getAdaptiveModuleLabel(moduleId);
    return {
        'rpg-status': { label, kicker: 'STATUS' },
        inventory: { label, kicker: 'PACK' },
        abilities: { label, kicker: 'ABILITY' },
        equipment: { label, kicker: 'EQUIP' },
        item: { label, kicker: 'ITEM' },
        skill: { label, kicker: 'SKILL' },
        quests: { label, kicker: 'QUEST' },
        relationships: { label, kicker: 'BOND' },
        affection: { label, kicker: 'BOND' },
        gifts: { label, kicker: 'ITEM' },
        events: { label, kicker: 'EVENT' },
        calendar: { label, kicker: 'TIME' },
        clues: { label, kicker: 'CLUE' },
        suspects: { label, kicker: 'CASE' },
        locations: { label, kicker: 'MAP' },
        factions: { label, kicker: 'FACTION' },
        resources: { label, kicker: 'SUPPLY' },
        objectives: { label, kicker: 'GOAL' },
        dice: { label, kicker: 'ROLL' },
        notes: { label, kicker: 'NOTE' },
    }[moduleId] || { label, kicker: 'INFO' };
}

function formatRpgStatus(fields) {
    const items = [];
    addPairItem(items, 'HP', fields.hp);
    addPairItem(items, 'MP', fields.mp);
    addValueItem(items, '防御', fields.ac);
    addValueItem(items, '等级', fields.level);
    addPairItem(items, '经验', fields.xp);
    addValueItem(items, '金币', fields.gold);
    addTextItem(items, '行动顺序', fields.turnOrder);
    addTextItem(items, '状态', fields.status);
    return items;
}

function getRpgHudStats(fields) {
    const stats = [];
    addHudPairStat(stats, 'hp', 'HP', fields.hp, 'danger');
    addHudValueStat(stats, 'ac', 'AC', fields.ac, 'guard');
    addHudValueStat(stats, 'level', '等级', fields.level, 'gold');
    addHudPairStat(stats, 'xp', '经验', fields.xp, 'skill');
    addHudValueStat(stats, 'gold', '金币', fields.gold, 'gold');
    addHudTextStat(stats, 'turn-order', '行动顺序', fields.turnOrder, 'initiative');
    addHudTextStat(stats, 'status', '状态', fields.status, 'condition');
    return stats;
}

function addHudPairStat(stats, key, label, value, tone) {
    if (!value) {
        return;
    }
    const max = value.max === null || value.max === undefined ? '' : `/${value.max}`;
    stats.push({
        key,
        label,
        value: `${value.current}${max}`,
        current: value.current,
        max: value.max,
        tone,
    });
}

function addHudValueStat(stats, key, label, value, tone) {
    if (!value) {
        return;
    }
    stats.push({
        key,
        label,
        value: String(value.value),
        tone,
    });
}

function addHudTextStat(stats, key, label, value, tone) {
    if (!value?.label) {
        return;
    }
    stats.push({
        key,
        label,
        value: shortenHudText(value.label),
        tone,
    });
}

function shortenHudText(value) {
    const text = String(value || '').trim();
    if (text.length <= 18) {
        return text;
    }
    return `${text.slice(0, 17)}…`;
}

function addPairItem(items, label, value) {
    if (!value) {
        return;
    }
    const max = value.max === null || value.max === undefined ? '' : `/${value.max}`;
    items.push({ label: `${label} ${value.current}${max}`, emphasis: label === 'HP' });
}

function addValueItem(items, label, value) {
    if (!value) {
        return;
    }
    items.push({ label: `${label} ${value.value}` });
}

function addTextItem(items, label, value) {
    if (!value?.label) {
        return;
    }
    items.push({ label: `${label} ${value.label}` });
}

function formatAffectionItems(entries) {
    return asArray(entries).map((entry) => {
        const name = entry.name && entry.name !== 'default' ? `${entry.name} ` : '';
        const max = entry.max ? `/${entry.max}` : '';
        const label = entry.label ? ` · ${entry.label}` : '';
        return {
            label: `${name}${entry.value}${max}${label}`.trim(),
            emphasis: true,
        };
    }).filter((item) => item.label);
}

function formatNamedItems(entries, { emphasis = false } = {}) {
    return asArray(entries).map((entry) => {
        if (typeof entry === 'string') {
            return { label: entry, emphasis };
        }
        const name = entry?.label || entry?.name || '';
        const value = entry?.value || '';
        const label = value ? `${name} ${value}` : name;
        return { label: label.trim(), emphasis };
    }).filter((item) => item.label);
}

function formatAdminPatternItems(matches) {
    return asArray(matches).flatMap((match) => {
        const fields = Object.values(match?.fields || {})
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        return fields.length ? [{ label: fields.join(' ') }] : [];
    });
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function getAdaptivePresentationProfile() {
    const profileId = getActiveArcPresentationProfileId();
    const profiles = manifest?.adaptivePresentationProfiles
        || manifest?.presentationProfiles
        || manifest?.presentation?.profiles
        || {};
    const configuredProfile = profiles[profileId]
        || profiles.default
        || manifest?.adaptivePresentationProfile
        || manifest?.presentation?.adaptiveProfile
        || {};
    return createDefaultAdaptivePresentationProfile({
        profileId: profileId || configuredProfile.profileId || 'default-visual-novel',
        ...configuredProfile,
    });
}

function getActiveArcPresentationProfileId() {
    const arcId = manifest?.arcId || manifest?.defaultArcId;
    const arc = (manifest?.arcs || []).find((candidate) => candidate.arcId === arcId)
        || manifest?.arcs?.[0];
    return arc?.presentationProfileId || manifest?.presentationProfileId || 'default';
}

function getAdaptiveModuleLabel(moduleId) {
    return {
        'rpg-status': '状态',
        'turn-order': '行动顺序',
        inventory: '背包',
        abilities: '技能',
        equipment: '装备',
        item: '道具',
        skill: '技能',
        quests: '任务',
        relationships: '关系',
        affection: '好感',
        gifts: '礼物',
        events: '事件',
        calendar: '日程',
        clues: '线索',
        suspects: '人物',
        locations: '地点',
        factions: '阵营',
        resources: '资源',
        objectives: '目标',
        dice: '判定',
        notes: '笔记',
    }[moduleId] || '信息';
}

function sanitizeClassName(value) {
    return String(value || 'unknown').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function renderSuggestedActions(message = null, { waitingForReply = false } = {}) {
    const actions = !waitingForReply && isMessagePlaybackComplete() && message?.role === 'character'
        ? message.suggestedActions || []
        : [];
    ui.suggestedActions.replaceChildren();
    ui.suggestedActions.hidden = actions.length < 2;
    if (actions.length < 2) {
        return;
    }

    for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggested-action';
        button.textContent = action.label;
        button.dataset.actionValue = action.value;
        ui.suggestedActions.append(button);
    }
}

function setInputEnabled(enabled) {
    ui.playerInput.disabled = !enabled;
    ui.sendButton.disabled = !enabled
        || inputPending
        || generationPending
        || !ui.playerInput.value.trim();
}

function setStageStatus(message) {
    ui.stageStatus.textContent = message;
}

function setRecoveryVisible(visible) {
    ui.recoveryActions.hidden = !visible;
}

function renderActiveDialogueSegment({ animate = false } = {}) {
    const segment = activeMessageSegments[activeSegmentIndex] || activeMessageSegments[0];
    if (!segment || !activeRenderContext) {
        return;
    }

    pageIndex = activeSegmentIndex;
    ui.speakerName.textContent = getDisplayedSpeakerName(segment, activeRenderContext.message);
    applySegmentPresentation(segment);
    renderSuggestedActions(activeRenderContext.message, { waitingForReply: true });
    setInputEnabled(false);

    if (animate && segment.text) {
        startTypewriter(segment.text);
    } else {
        stopTypewriter();
        ui.dialogueText.textContent = segment.text;
        finishDialogueSegment();
    }
}

function finishDialogueSegment() {
    typewriterRunning = false;
    ui.dialogueBox.classList.remove('is-typing');
    renderSuggestedActions(activeRenderContext?.message, {
        waitingForReply: shouldHoldInteraction(),
    });
    updateDialoguePlaybackStatus();
    setInputEnabled(canAcceptPlayerInput());
}

function updateDialoguePlaybackStatus() {
    if (!activeRenderContext) {
        return;
    }
    if (typewriterRunning) {
        setStageStatus('点击显示全文');
        setRecoveryVisible(false);
        return;
    }
    if (activeSegmentIndex < activeMessageSegments.length - 1) {
        setStageStatus(`点击继续 · ${activeSegmentIndex + 1}/${activeMessageSegments.length}`);
        setRecoveryVisible(false);
        return;
    }
    if (activeRenderContext.waitingForReply && activeRenderContext.displayingLatest) {
        renderWaitingForReply();
    } else if (activeRenderContext.incompleteReply && activeRenderContext.displayingLatest) {
        setStageStatus('这一段回应可能没有生成完。你可以输入“继续”补完。');
        setRecoveryVisible(false);
        renderSuggestedActions();
        setInputEnabled(canAcceptPlayerInput());
    } else if (!activeRenderContext.displayingLatest) {
        setStageStatus('正在回看历史');
        setRecoveryVisible(false);
    } else {
        setStageStatus('');
        setRecoveryVisible(false);
    }
}

function advanceDialoguePlayback() {
    if (!activeRenderContext || !activeMessageSegments.length) {
        return false;
    }
    if (typewriterRunning) {
        completeTypewriter();
        return true;
    }
    if (activeSegmentIndex < activeMessageSegments.length - 1) {
        activeSegmentIndex += 1;
        pageIndex = activeSegmentIndex;
        renderActiveDialogueSegment({ animate: shouldAnimateActiveSegment() });
        // Re-project the active inline speaker so portrait and narration avatar
        // follow the dialogue segment without clearing verified layers.
        scheduleVisualBundleRefresh(activeRenderContext.snapshot, activeMessageIndex);
        void persistAutoSave(activeRenderContext.snapshot);
        return true;
    }
    return false;
}

function startTypewriter(text) {
    stopTypewriter();
    typewriterRunning = true;
    typewriterFullText = text;
    typewriterToken += 1;
    ui.dialogueBox.classList.add('is-typing');
    const token = typewriterToken;
    const chars = Array.from(text);
    let index = 0;
    ui.dialogueText.textContent = '';
    updateDialoguePlaybackStatus();

    const tick = () => {
        if (token !== typewriterToken) {
            return;
        }
        index += 1;
        ui.dialogueText.textContent = chars.slice(0, index).join('');
        if (index >= chars.length) {
            typewriterRunning = false;
            typewriterTimer = null;
            finishDialogueSegment();
            return;
        }
        typewriterTimer = window.setTimeout(tick, getTypewriterDelay(chars[index - 1]));
    };

    typewriterTimer = window.setTimeout(tick, 24);
}

function completeTypewriter() {
    if (!typewriterRunning) {
        return;
    }
    stopTypewriter();
    ui.dialogueText.textContent = typewriterFullText;
    finishDialogueSegment();
}

function stopTypewriter() {
    typewriterToken += 1;
    if (typewriterTimer) {
        window.clearTimeout(typewriterTimer);
        typewriterTimer = null;
    }
    typewriterRunning = false;
    ui.dialogueBox.classList.remove('is-typing');
}

function clearDialoguePlayback() {
    stopTypewriter();
    activeMessageSegments = [];
    activeSegmentIndex = 0;
    activeRenderContext = null;
    typewriterFullText = '';
}

function getTypewriterDelay(character) {
    if (!motionEnabled) {
        return 0;
    }
    if (/[。！？!?]/u.test(character)) {
        return 130;
    }
    if (/[，、；：,.]/u.test(character)) {
        return 70;
    }
    return 26;
}

function applySegmentPresentation(segment) {
    const type = segment?.type || 'narration';
    ui.dialogueBox.dataset.segmentType = type;
    ui.dialogueBox.classList.toggle('is-typing', typewriterRunning);
    ui.speakerName.dataset.segmentType = type;
    ui.dialogueText.dataset.segmentType = type;
}

function getDisplayedSpeakerName(segment, message) {
    if (message?.role === 'player' || segment.type === 'player') {
        return '你';
    }
    if (segment.type === 'narration') {
        return '旁白';
    }
    if (segment.type === 'stage') {
        return segment.speaker ? `${segment.speaker} · 动作` : '动作';
    }
    return segment.speaker || message?.speaker || getMainCharacterName();
}

function shouldAnimateMessage(message, waitingForReply, displayingLatest, options = {}) {
    if (options.instant) {
        return false;
    }
    return motionEnabled
        && message.role === 'character'
        && displayingLatest
        && !waitingForReply;
}

function shouldAnimateActiveSegment() {
    return motionEnabled
        && activeRenderContext?.message?.role === 'character'
        && activeRenderContext?.displayingLatest
        && !activeRenderContext?.waitingForReply;
}

function shouldHoldInteraction() {
    return Boolean(typewriterRunning
        || activeSegmentIndex < activeMessageSegments.length - 1
        || activeRenderContext?.waitingForReply
        || !activeRenderContext?.displayingLatest);
}

function isMessagePlaybackComplete() {
    return !typewriterRunning && activeSegmentIndex >= activeMessageSegments.length - 1;
}

function isTextEntryTarget(target) {
    return target instanceof HTMLElement
        && ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName);
}

function snapshotAwaitsReply(snapshot) {
    return snapshot?.messages?.at(-1)?.role === 'player';
}

function resolveMessageIndex(snapshot, preferredIndex) {
    const messages = snapshot?.messages || [];
    if (!messages.length) {
        return -1;
    }
    const fallback = messages.length - 1;
    const index = Number.isInteger(Number(preferredIndex))
        ? Number(preferredIndex)
        : fallback;
    return Math.min(Math.max(0, index), fallback);
}

function getDisplayedMessageIndex(snapshot) {
    return resolveMessageIndex(snapshot, activeMessageIndex);
}

function canAcceptPlayerInput() {
    return Boolean(activeChatSnapshot?.writable)
        && getDisplayedMessageIndex(activeChatSnapshot) === (activeChatSnapshot?.messages?.length || 0) - 1
        && !snapshotAwaitsReply(activeChatSnapshot)
        && isMessagePlaybackComplete()
        && !inputPending
        && !generationPending;
}

function clampIndex(value, length) {
    if (!length) {
        return 0;
    }
    const index = Number.isFinite(value) ? Math.floor(value) : 0;
    return Math.min(Math.max(0, index), length - 1);
}

function getTitleSpriteUrl() {
    if (!manifest) {
        return '';
    }
    const character = Object.values(manifest.resourceBindings?.characters || {})[0];
    return getAssetUrl(manifest, character?.sprite || manifest.presentation?.defaultBackgroundAsset);
}

function getMainCharacterName() {
    if (!manifest) {
        return '系统';
    }
    const character = Object.values(manifest.resourceBindings?.characters || {})[0];
    return character?.displayName || manifest.sillyTavernBindings?.characters?.[0]?.id || '角色';
}

function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('is-visible');
    window.setTimeout(() => {
        ui.toast.classList.remove('is-visible');
    }, 1800);
}

function getSillyTavernBaseUrl() {
    return (document.querySelector('meta[name="galgame-sillytavern-base"]')?.content || '')
        .trim()
        .replace(/\/+$/, '');
}

function getSillyTavernRuntimeBaseUrl() {
    const runtimeBaseUrl = (document.querySelector('meta[name="galgame-sillytavern-runtime-base"]')?.content || '')
        .trim()
        .replace(/\/+$/, '');
    return runtimeBaseUrl || getSillyTavernBaseUrl() || window.location.origin;
}

function getOriginalRuntimeBridgeUrl() {
    return (document.querySelector('meta[name="galgame-original-runtime-bridge"]')?.content || '')
        .trim()
        .replace(/\/+$/, '');
}
