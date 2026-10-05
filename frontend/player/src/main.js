import { createReleaseStore } from '../../shared/src/config-service.js';
import {
    getAssetUrl,
    getSpecialVisualChannelAssetKeys,
    getVisualCharacterBindings,
    getVisualCharacterPool,
    resolveVisualCharacterBinding,
    getActiveSillyTavernBindings,
    materializeManifestForArc,
    resolveAdaptivePresentationProfileBinding,
} from '../../shared/src/protocol.js';
import {
    AUTO_SAVE_ID,
    createCanonicalPlayerSaveRelease,
    createPlayerSaveStore,
    manualSaveIds,
} from '../../shared/src/player-save.js';
import {
    createCoreVisualDisplayEntityHints,
    createCoreVisualDisplayEntityKey,
    detectIncompleteRpgResponse,
    formatVisualNovelDisplayText,
    createVisualNovelDisplaySegments,
    OriginalRuntimeBridgeClient,
    SillyTavernOriginalChatBridge,
} from '../../shared/src/sillytavern-adapter.js';
import { extractAdaptivePresentation } from '../../shared/src/adaptive-presentation.js';
import { collectVisibleHudRecords } from './visible-hud-records.js';
import { createVisibleHudVisualHints } from './visible-hud-visual-hints.js';
import { createDefaultAdaptivePresentationProfile } from '../../shared/src/adaptive-presentation-schema.js';
import { normalizeVisualRuntimeMessage } from '../../shared/src/visual-system-schema.js';
import { createConnectionHealthMonitor } from '../../shared/src/connection-health.js';
import { isSuccessfulShutdownReceipt, LocalProcessSupervisorClient } from '../../shared/src/process-supervisor-adapter.js';
import { createPresentationBatches, PresentationAnalysisAdapter } from '../../shared/src/presentation-analysis-adapter.js';
import { evaluateVisualServiceReadiness } from '../../shared/src/visual-service-health.js';
import {
    buildSceneContinuityProjectionFromAnalysis,
    createSceneContinuityAnalysisRequest,
    createSceneContinuityAnalysisCacheKey,
    deriveSceneContinuityKey,
} from '../../shared/src/scene-continuity-analysis.js';
import {
    createSceneContinuityHistoryCandidate,
    createSceneContinuityHistoryCandidateListHash,
    createSceneContinuityHistoryCheckpoint,
    createSceneContinuityHistoryCheckpointKey,
    createSceneContinuityHistoryTargetCursorHash,
    findLatestVerifiedSceneTransitionAnchor,
    getSceneContinuityHistoryCheckpointResumeOffset,
    parseSceneContinuityHistoryCheckpoint,
    SCENE_CONTINUITY_HISTORY_REPLAY_BATCH_LIMIT,
    SCENE_CONTINUITY_HISTORY_REPLAY_MIN_INTERVAL_MS,
    SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT,
    serializeSceneContinuityHistoryCheckpoint,
} from './scene-continuity-history.js';
import { PresentationAnnotationCache } from '../../shared/src/presentation-cache.js';
import { consumeSceneContinuityProjection, presentationPortraitScopeKey, projectPartyRoster, projectPresentationIdentityDetailed, reservePersistentPresentationAsset } from '../../shared/src/presentation-projection.js';
import { createPublishedPresentationKnownEntities, createVisibleMessageHash, sha256Hex, PRESENTATION_ANNOTATION_VERSION, PRESENTATION_IDENTITY_PROJECTION_VERSION, PRESENTATION_ROSTER_PROJECTION_VERSION } from '../../shared/src/presentation-annotation.js';
import { canApplySceneContinuityPageResult, capSceneContinuityLedgerRecords, createPresentationDisplaySegments, createPresentationPages, createPresentationRosterDisplay, createSceneContinuityLedgerStorageKey, createSceneContinuityTimelinePrefixHash, createSpeakerVisualAttributes, deferShadowPresentationAnalysisUntilVisualSettles, formatPresentationRosterMember, isPresentationProjectionTimelineCurrent, isSceneContinuityCursorStrictlyEarlier, isSceneContinuityProjectionBoundToCursor, parseSceneContinuityLedger, PRESENTATION_ANNOTATION_MODE, resolvePresentationMode, sceneContinuityRecordFingerprint, selectLatestEarlierCompletedScenePage, selectPresentationAnalysisMessages, serializeSceneContinuityLedger, validateSceneContinuityLedgerRecords, waitForPriorSceneContinuityTask } from './presentation-renderer.js';

const releaseStore = createReleaseStore(null, { fallbackToLocal: false });
const playerSaveStore = createPlayerSaveStore();
const processSupervisor = new LocalProcessSupervisorClient({
    baseUrl: document.querySelector('meta[name="galgame-process-supervisor"]')?.content || 'http://127.0.0.1:8790',
});
const chatBridge = new SillyTavernOriginalChatBridge({ baseUrl: getSillyTavernBaseUrl() });
const runtimeBridge = new OriginalRuntimeBridgeClient({
    baseUrl: getOriginalRuntimeBridgeUrl(),
    sillyTavernBaseUrl: getSillyTavernRuntimeBaseUrl(),
});
const presentationAnalysis = new PresentationAnalysisAdapter({
    baseUrl: document.querySelector('meta[name="galgame-presentation-analysis-service"]')?.content || 'http://127.0.0.1:8798',
});
const presentationCache = new PresentationAnnotationCache();
const presentationInflight = new Set();
const presentationAnnotations = new Map();
const presentationProjectionStates = new Map();
const PRESENTATION_PORTRAIT_LEDGER_KEY = 'galgame.presentation-portrait-bindings.v1';
let portraitLedgerPersistenceWarningLogged = false;
let presentationServiceState = null;
let presentationServiceRetryAt = 0;
let presentationAnalyzerScope = '';
let presentationAnalysisEpoch = 0;
let presentationAnalysisController = null;
let shadowPresentationAnalysisController = null;
let sceneContinuityAnalysisController = null;
let sceneContinuityAnalysisTask = null;
let sceneContinuityHistoryBootstrapController = null;
const sceneContinuityHistoryBootstrapRuns = new Map();
let activeSceneContinuityScopeKey = '';
const sceneContinuityAnalysisCache = new Map();
const completedSceneContinuityPages = new Map();
const sceneContinuityBootstrapRefreshRuns = new Map();
const visualBundleRefreshTasks = new Map();
let sceneContinuityLedgerHydratedScopeKey = '';
let sceneContinuityLedgerHydration = null;
const SCENE_CONTINUITY_LEDGER_LIMIT = 512;
const ORIGINAL_RUNTIME_BRIDGE_PORTS = [8795, 8799, 8800, 8796, 8797];
const VISUAL_ICON_TYPES = Object.freeze(['equipment', 'item', 'skill']);
function getVisualCardModule(type) {
    if (type === 'equipment') return 'equipment';
    if (type === 'item') return 'inventory';
    if (type === 'skill') return 'abilities';
    return '';
}

function getVisualCardType(moduleId) {
    if (moduleId === 'equipment') return 'equipment';
    if (moduleId === 'inventory') return 'item';
    if (moduleId === 'abilities') return 'skill';
    return '';
}
const RIGHT_TOP_ADAPTIVE_MODULES = new Set(['equipment', 'inventory', 'abilities']);
const CORE_VISUAL_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
const CORE_VISUAL_DECISION_REQUEST_VERSION = 'galgame.visual-core-visual-decisions-request.v2';
const CORE_VISUAL_DECISION_RESPONSE_VERSION = 'galgame.visual-core-visual-decisions-response.v2';
const CORE_VISUAL_CONTEXT_RESPONSE_VERSION = 'galgame.visual-core-context.v2';
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
let titleSaveStateRequestToken = 0;
let visualBundleRequestToken = 0;
let coreVisualHasVerifiedPresentation = false;
let coreVisualHasVerifiedBackground = false;
// Keep the last verified decision per visual layer. A new dialogue may update
// one layer while the established scene, character or icon remains valid.
const coreVisualPresentationState = new Map();
// Keep every matched visible entity for the detail drawer. The render layer
// uses the first decision for the icon, while the drawer can show all items.
const coreVisualPresentationDetails = new Map();
const activeVisualDetailHints = new Map();
let immediateVisualCharacterIdentity = '';
let verifiedSceneContinuity = { scope: null, scopeKey: '', sceneKey: null, displayLabel: '', messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '' };
let activeSceneContinuityAction = 'preserve';
let activeSceneContinuityToken = 0;

const ui = {
    connectionStatus: document.querySelector('#connectionStatus'),
    connectionResetButton: document.querySelector('#connectionResetButton'),
    homeResetButton: document.querySelector('#homeResetButton'),
    homeShutdownButton: document.querySelector('#homeShutdownButton'),
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

function recordSceneContinuityDiagnostic(stage, {
    state = '', action = '', reason = '', candidates, failedCandidates,
} = {}) {
    if (!ui.visualPresentation) return;
    try {
        if (new URLSearchParams(window.location.search).get('galgameVisualDebug') !== '1') return;
        const safe = (value) => String(value || '').replace(/[^a-z0-9_-]/giu, '').slice(0, 64);
        const countTag = [
            Number.isSafeInteger(candidates) ? `c${Math.max(0, candidates)}` : '',
            Number.isSafeInteger(failedCandidates) ? `f${Math.max(0, failedCandidates)}` : '',
        ].filter(Boolean).join('');
        const entry = [stage, state, action, reason, countTag].map(safe).filter(Boolean).join(':');
        const trace = stage === 'continuity-start'
            ? []
            : String(ui.visualPresentation.dataset.sceneContinuityTrace || '').split('|').filter(Boolean);
        if (entry) trace.push(entry);
        const retainedTrace = trace.slice(-24);
        ui.visualPresentation.dataset.sceneContinuityStage = safe(stage);
        ui.visualPresentation.dataset.sceneContinuityState = safe(state);
        ui.visualPresentation.dataset.sceneContinuityAction = safe(action);
        if (Number.isSafeInteger(candidates)) {
            ui.visualPresentation.dataset.sceneContinuityCandidates = String(Math.max(0, candidates));
        }
        if (Number.isSafeInteger(failedCandidates)) {
            ui.visualPresentation.dataset.sceneContinuityFailedCandidates = String(Math.max(0, failedCandidates));
        }
        ui.visualPresentation.dataset.sceneContinuityReason = safe(reason);
        ui.visualPresentation.dataset.sceneContinuityTrace = retainedTrace.join('|');
        ui.visualPresentation.setAttribute(
            'aria-label',
            `画面素材诊断 ${retainedTrace.join(' > ')}`.trim(),
        );
    } catch {
        // Diagnostics are opt-in and must never affect normal rendering.
    }
}

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
let connectionResetInFlight = false;
let lastObservedVisualHealthStatus = 'unknown';
let shutdownInFlight = false;
let textSizeMode = 'standard';
let motionEnabled = true;
let releaseReadyPromise = null;
let activeMessageSegments = [];
let activeSegmentIndex = 0;
let activeRenderContext = null;
let presentationCarouselTimer = null;
let presentationCarouselEpoch = 0;
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
        return renderChatSnapshot(snapshot, options);
    };
    globalThis.__GALGAME_TEST_START__ = () => startNewGame();
    globalThis.__GALGAME_TEST_CONTINUE__ = () => continueFromSaveOrLatest();
    globalThis.__GALGAME_TEST_LOAD_SAVE__ = (saveId = AUTO_SAVE_ID) => loadPlayerSave(saveId);
    globalThis.__GALGAME_TEST_GET_ACTIVE_CHAT__ = () => activeChatSnapshot;
    globalThis.__GALGAME_TEST_SET_ACTIVE_CHAT__ = (snapshot) => {
        activeChatSnapshot = snapshot;
    };
    globalThis.__GALGAME_TEST_RECOVER_CONTENT_AFTER_RESET__ = () => recoverPlayerContentAfterReset();
    globalThis.__GALGAME_TEST_RENDER_CONNECTION_HEALTH__ = (snapshot) => renderConnectionHealth(snapshot);
    globalThis.__GALGAME_TEST_GET_SCENE_CONTINUITY__ = () => ({
        state: structuredClone(verifiedSceneContinuity), action: activeSceneContinuityAction, token: activeSceneContinuityToken,
        backgroundVerified: coreVisualHasVerifiedBackground,
    });
    globalThis.__GALGAME_TEST_CLEAR_SCENE_LEDGER_MEMORY__ = () => {
        completedSceneContinuityPages.clear();
        sceneContinuityLedgerHydratedScopeKey = '';
        sceneContinuityLedgerHydration = null;
    };
    globalThis.__GALGAME_TEST_COLD_RESET_SCENE__ = () => resetVisualPresentation();
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
    // The browser-safe 8798 facade aggregates both visual dependencies:
    // published catalog access and the analyzer required for scene matching.
    const [response, analysisHealth] = await Promise.all([
        fetchVisualContextWithRetry(baseUrl, signal),
        presentationAnalysis.healthCheck(signal),
    ]);
    const body = await response.json().catch(() => ({}));
    const readiness = evaluateVisualServiceReadiness({
        contextHttpOk: response.ok,
        contextStatus: response.status,
        visualContext: body,
        presentationHealth: analysisHealth,
    });
    return {
        ok: readiness.ok,
        errorCode: readiness.errorCode,
        service: body?.service || '',
        schema: body?.schemaVersion || '',
        enabled: readiness.enabled,
        catalogId: readiness.catalogId,
        analysisReady: analysisHealth?.serviceReady === true && analysisHealth?.analyzerConfigured === true,
        analyzerConfigured: analysisHealth?.analyzerConfigured === true,
    };
}

async function fetchVisualContextWithRetry(baseUrl, signal) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        if (signal?.aborted) throw new DOMException('Visual health check aborted', 'AbortError');
        try {
            const response = await fetch(`${baseUrl}/v1/core/visual-context`, {
                method: 'GET',
                cache: 'no-cache',
                signal,
                headers: { accept: 'application/json' },
            });
            if (![502, 503, 504].includes(response.status) || attempt === 1) return response;
        } catch (error) {
            if (signal?.aborted || error?.name === 'AbortError' || attempt === 1) throw error;
            lastError = error;
        }
        await delay(180);
    }
    throw lastError || new TypeError('VISUAL_CONTEXT_UNAVAILABLE');
}

function renderConnectionHealth(snapshot) {
    if (!ui.connectionStatus || !snapshot) return;
    const visualStatus = snapshot.services?.visualService?.status || 'unknown';
    const visualRecovered = lastObservedVisualHealthStatus === 'down' && visualStatus === 'up';
    lastObservedVisualHealthStatus = visualStatus;
    const generation = snapshot.services?.generation;
    const runtime = snapshot.services?.runtimeBridge;
    const llm = snapshot.services?.llm;
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
        `LLM ${!llm?.checkedAt ? '待按需检测' : llm.stale ? '待复测' : llm.status === 'up' ? '可用' : '不可用'}`,
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
    if (ui.connectionResetButton) {
        const generationFailed = generation?.status === 'down';
        const runtimeNeedsReset = Boolean(runtime?.status === 'pending'
            || runtime?.details?.connectionState === 'generating'
            || runtime?.details?.stale
            || runtime?.details?.stopping);
        const abnormal = snapshot.overall === 'degraded' || snapshot.overall === 'down' || generationFailed || runtimeNeedsReset || llm?.status === 'down' || Boolean(llm?.stale && llm?.checkedAt);
        ui.connectionResetButton.hidden = !abnormal && !connectionResetInFlight;
        ui.connectionResetButton.disabled = connectionResetInFlight;
        ui.connectionResetButton.textContent = connectionResetInFlight ? '复位检查中…' : '复位';
        ui.connectionResetButton.setAttribute('aria-busy', connectionResetInFlight ? 'true' : 'false');
    }
    if (ui.homeResetButton) {
        ui.homeResetButton.disabled = connectionResetInFlight;
        ui.homeResetButton.querySelector('span')?.replaceChildren(
            document.createTextNode(connectionResetInFlight ? '复位检查中…' : '一键复位'),
        );
        ui.homeResetButton.setAttribute('aria-busy', connectionResetInFlight ? 'true' : 'false');
    }
    if (ui.homeShutdownButton) {
        ui.homeShutdownButton.disabled = connectionResetInFlight || shutdownInFlight;
        ui.homeShutdownButton.setAttribute('aria-busy', shutdownInFlight ? 'true' : 'false');
    }
    // A failed visual-health probe can leave the current page in its
    // conservative placeholder state. On confirmed recovery, re-run only the
    // current read-only visual projection so assets return without requiring
    // another story turn or mutating the chat.
    if (visualRecovered && !generationPending && !ui.gameScreen?.hidden
        && activeChatSnapshot && Number.isSafeInteger(activeMessageIndex) && activeMessageIndex >= 0) {
        void scheduleVisualBundleRefresh(activeChatSnapshot, activeMessageIndex);
    }
}

async function resetConnectionState() {
    if (!connectionHealthMonitor || connectionResetInFlight) return;
    connectionResetInFlight = true;
    renderConnectionHealth(connectionHealthMonitor.getSnapshot());
    // Invalidate late visual responses while preserving the already displayed
    // scene/portrait. The active message is re-projected below after probing.
    const visualToken = ++visualBundleRequestToken;
    resetCoreVisualAvailability();
    try {
        const processRecovery = await requestLocalProcessRecovery();
        let snapshot = await connectionHealthMonitor.reset({
            reason: 'user-reset',
            preserveGenerationPending: generationPending,
        });
        const pendingStarts = Object.entries(processRecovery?.services || {})
            .filter(([, service]) => service?.started === true)
            .map(([name]) => name);
        const recoveryDeadline = Date.now() + 20_000;
        while (pendingStarts.length && Date.now() < recoveryDeadline
            && pendingStarts.some((name) => !['up', 'idle'].includes(snapshot.services?.[name]?.status))) {
            await delay(900);
            snapshot = await connectionHealthMonitor.probeNow({ reason: 'process-recovery-wait' });
        }
        const llmResult = await probeLlmForReset();
        snapshot = connectionHealthMonitor.recordLlmCheck(llmResult);
        let contentRecovered = null;
        const contentServicesReady = snapshot.services?.sillyTavern?.status === 'up'
            && snapshot.services?.configService?.status === 'up';
        if (contentServicesReady && !generationPending) {
            try {
                contentRecovered = await recoverPlayerContentAfterReset();
            } catch (error) {
                console.warn('Player content recovery after reset failed.', error);
                contentRecovered = false;
            }
        }
        if (activeChatSnapshot && activeMessageIndex >= 0) {
            void renderCoreVisualPresentation(activeChatSnapshot, activeMessageIndex, visualToken);
        }
        if (llmResult.ok !== true) {
            showToast('基础服务已检查，但剧情生成服务暂不可用；请稍后复位重试');
        } else if (snapshot.overall !== 'up') {
            showToast('仍有连接异常，请稍后再试');
        } else if (generationPending) {
            showToast('连接正常，当前回应仍在处理中');
        } else if (contentRecovered === false) {
            showToast('连接已恢复，但当前内容还没读到；请稍后再试');
        } else if (contentRecovered === true) {
            showToast('连接已恢复，当前内容已重新同步');
        } else {
            showToast('连接已恢复');
        }
    } catch (error) {
        console.warn('Connection health reset failed.', error);
        showToast('连接检查未完成，请稍后再试');
    } finally {
        connectionResetInFlight = false;
        renderConnectionHealth(connectionHealthMonitor.getSnapshot());
    }
}

async function probeLlmForReset() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
        return await runtimeBridge.llmHealthCheck(controller.signal);
    } catch {
        return { ok: false, errorCode: controller.signal.aborted ? 'LLM_HEALTH_TIMEOUT' : 'LLM_HEALTH_REQUEST_FAILED' };
    } finally {
        clearTimeout(timeout);
    }
}

async function requestLocalProcessRecovery() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
        return await processSupervisor.recover(controller.signal);
    } finally {
        clearTimeout(timeout);
    }
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function recoverPlayerContentAfterReset() {
    if (ui.gameScreen?.hidden) {
        if (!release || !manifest) {
            await refreshRelease();
        }
        await refreshPlayableStories();
        renderTitle();
        await refreshTitleSaveState();
        return Boolean(release && manifest);
    }

    if (activeChatSnapshot?.fileName && manifest) {
        const latestSnapshot = await loadLatestSnapshotForActiveChat(activeChatSnapshot);
        if (latestSnapshot?.ok && latestSnapshot.fileName === activeChatSnapshot.fileName) {
            activeChatSnapshot = latestSnapshot;
            renderChatSnapshot(latestSnapshot, getLatestSnapshotRenderOptions(latestSnapshot));
            return true;
        }
        return false;
    }

    // A reset may only refresh the chat already bound in memory. Falling back
    // to AUTO_SAVE_ID or the newest chat can silently switch scenarios when
    // that pointer belongs to an older session. Preserve the visible stage and
    // save until the player explicitly chooses a chat/save to load.
    return false;
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
    ui.connectionResetButton?.addEventListener('click', () => {
        void resetConnectionState();
    });
    ui.homeResetButton?.addEventListener('click', () => {
        void resetConnectionState();
    });
    ui.homeShutdownButton?.addEventListener('click', () => {
        void shutdownGalgameServices();
    });
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

async function shutdownGalgameServices() {
    if (shutdownInFlight || connectionResetInFlight) return;
    if (generationPending || inputPending) {
        showToast('当前剧情回应仍在处理中，请完成后再关闭');
        return;
    }
    shutdownInFlight = true;
    if (ui.homeResetButton) ui.homeResetButton.disabled = true;
    if (ui.homeShutdownButton) ui.homeShutdownButton.disabled = true;
    let result = null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        try { result = await processSupervisor.shutdown(controller.signal); } finally { clearTimeout(timeout); }
    } catch { result = null; }
    const allStopped = isSuccessfulShutdownReceipt(result);
    if (!allStopped) {
        shutdownInFlight = false;
        if (ui.homeShutdownButton) ui.homeShutdownButton.disabled = false;
        if (ui.homeResetButton) ui.homeResetButton.disabled = false;
        showToast(result?.refused
            ? '运行桥状态不明确或仍在生成，服务已保留；请结束当前回应后重试'
            : result?.accepted
                ? '部分服务仍未关闭，页面保持开启；可检查后重试复位'
                : '关闭未获确认，页面保持开启；请检查连接后重试');
        return;
    }
    // The supervisor schedules process termination only after its 202 response
    // has been flushed. Close just this tab; some browsers prohibit script-close.
    try { window.close(); } catch { /* use the in-page closed state below */ }
    setTimeout(() => {
        if (window.closed) return;
        document.title = '已关闭';
        document.documentElement.lang = 'zh-CN';
        document.body.replaceChildren();
        const closed = document.createElement('main');
        closed.setAttribute('aria-label', '服务已关闭');
        closed.textContent = '已关闭';
        Object.assign(closed.style, {
            minHeight: '100vh', display: 'grid', placeItems: 'center',
            margin: '0', background: '#11151a', color: '#f5f2ed',
            font: '500 1.25rem system-ui, sans-serif', letterSpacing: '.08em',
        });
        document.body.style.cssText = 'margin:0;min-height:100vh;background:#11151a';
        document.body.append(closed);
    }, 120);
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
    const requestToken = ++titleSaveStateRequestToken;
    const targetRelease = release;
    const targetManifest = manifest;
    const autoSlot = await playerSaveStore.loadSlot(AUTO_SAVE_ID).catch(() => null);
    if (requestToken !== titleSaveStateRequestToken) return;
    if (autoSlot && saveSlotMatchesCurrentRelease(autoSlot)) {
        ui.continueButton.disabled = false;
        return;
    }

    // The browser auto-save is a recovery pointer, not the source of chat
    // history. Keep Continue available when the bound original ST chat still
    // exists, so a missing IndexedDB slot cannot hide recoverable progress.
    ui.continueButton.disabled = true;
    if (!targetRelease || !targetManifest || typeof chatBridge.hasLatestBoundChat !== 'function') {
        return;
    }
    const historyAvailable = await chatBridge.hasLatestBoundChat(targetManifest).catch(() => false);
    if (requestToken !== titleSaveStateRequestToken || release !== targetRelease || manifest !== targetManifest) return;
    ui.continueButton.disabled = !historyAvailable;
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
        const latestRecovery = await tryRecoverLatestBoundChatForAutoSlot({
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

// Continue is a recovery operation, not a blind replay of the browser's last
// pointer. A stale auto slot can point at a short branch while SillyTavern
// already contains the longer current arc, making history appear missing.
// Manual slots still load their exact chat below.
async function tryRecoverLatestBoundChatForAutoSlot({
    autoSlot,
    seedChatId,
    loadLatestBoundChat,
}) {
    const normalizedAutoChatId = normalizeBoundChatId(autoSlot?.chatId);
    const normalizedSeedChatId = normalizeBoundChatId(seedChatId);
    if (!normalizedAutoChatId) {
        return {
            attempted: false,
            snapshot: null,
        };
    }

    try {
        const snapshot = await loadLatestBoundChat();
        const normalizedSnapshotChatId = normalizeBoundChatId(snapshot?.fileName);
        const savedMessageCount = Math.max(0, Number(autoSlot?.lastMessageIndex || 0) + 1);
        const latestMessageCount = Array.isArray(snapshot?.messages) ? snapshot.messages.length : 0;
        const latestIsArcChat = snapshot?.ok
            && snapshot.isSeed === false
            && normalizedSnapshotChatId
            && normalizedSnapshotChatId !== normalizedSeedChatId;
        if (
            latestIsArcChat
            && (
                normalizedAutoChatId === normalizedSeedChatId
                || (normalizedSnapshotChatId !== normalizedAutoChatId && latestMessageCount > savedMessageCount)
            )
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

async function loadPlayerSave(saveId = AUTO_SAVE_ID, {
    silentFailure = false,
    requestReply = true,
    persistSyncedProgress = true,
} = {}) {
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
        if (restoreOptions.syncedToLatest && persistSyncedProgress) {
            void persistAutoSave(snapshot);
            showToast('已同步到最新回应');
        }
        closeDrawers();
        if (requestReply && snapshotAwaitsReply(snapshot)) {
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

async function loadOriginalChat(mode = 'continue', { requestReply = true, persistSnapshot = true } = {}) {
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
        if (persistSnapshot) {
            void persistAutoSave(snapshot);
        }
        if (requestReply && snapshotAwaitsReply(snapshot)) {
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
        if (generatedSnapshot.generatedText?.trim() && generatedSnapshot.diagnostics?.runtimeProvider) {
            connectionHealthMonitor?.recordLlmCheck({
                ok: true,
                provider: generatedSnapshot.diagnostics.runtimeProvider,
                model: generatedSnapshot.diagnostics.runtimeModel || '',
                latencyMs: Date.now() - generationStartedAt,
            });
        }
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

function createPresentationPagesForMessage(snapshot, messageIndex, message) {
    const presentationMode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    const presentationState = presentationProjectionStates.get(presentationProjectionScope(snapshot));
    const projectedSegments = message?.role === 'character' && presentationMode === 'assisted'
        ? getAssistedPresentationSegments(snapshot, messageIndex, message, presentationState)
        : null;
    const sourceMessageIndex = Number.isSafeInteger(message?.index) ? message.index : messageIndex;
    const sourceText = projectedSegments
        ? String(message?.displayText || message?.text || '')
        : formatVisualNovelDisplayText(message?.displayText || message?.text || '');
    const segments = (projectedSegments || createVisualNovelDisplaySegments(message?.displayText || message?.text, {
        fallbackSpeaker: message?.role === 'player' ? '你' : message?.speaker || getMainCharacterName(),
        role: message?.role,
        knownSpeakers: getManifestKnownVisualSpeakers(),
    })).map((segment) => ({
        ...segment,
        sourceMessageIndex: segment.sourceMessageIndex ?? sourceMessageIndex,
        sourceMessageHash: segment.sourceMessageHash || '',
    }));
    const nonEmptySegments = segments.length ? segments : [{
        index: 0,
        type: message?.role === 'player' ? 'player' : 'narration',
        speaker: message?.role === 'player' ? '你' : '旁白',
        text: message?.displayText || message?.text || '',
        sourceMessageIndex,
    }];
    return {
        sourceText,
        pages: createPresentationPages({
            segments: nonEmptySegments,
            sourceText,
            sourceMessageIndex,
        }),
    };
}

function renderChatSnapshot(snapshot, options = {}) {
    const messageIndex = resolveMessageIndex(snapshot, options.messageIndex);
    const message = snapshot.messages[messageIndex];
    activeMessageIndex = messageIndex;
    abortSceneContinuityTaskForPlayerBranch(snapshot);
    const presentationMode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    cancelShadowPresentationAnalysis();
    const canAnalyzePresentation = snapshot && manifest && presentationMode !== 'off' && !options.skipPresentationAnalysis
        && !globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__;
    if (presentationMode !== 'shadow' && canAnalyzePresentation) {
        // Keep the assisted path's existing eager analysis and projection flow.
        void analyzePresentationSnapshot(snapshot, messageIndex, { mode: presentationMode });
    }

    if (message) {
        const waitingForReply = snapshotAwaitsReply(snapshot);
        const displayingLatest = messageIndex === snapshot.messages.length - 1;
        // Use the original visible message for truncation detection. The
        // display projection removes a valid trailing action block first;
        // checking that shortened text can hide complete RPG choices.
        const incompleteReply = message.role === 'character'
            && displayingLatest
            && detectIncompleteRpgResponse(message.text || message.displayText || '');
        activeMessageSegments = createPresentationPagesForMessage(snapshot, messageIndex, message).pages;
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
        return scheduleVisiblePageVisualBundle(snapshot, messageIndex);
    } else {
        renderBridgeUnavailable();
        return;
    }
}

function cancelShadowPresentationAnalysis() {
    const controller = shadowPresentationAnalysisController;
    if (!controller) return;
    shadowPresentationAnalysisController = null;
    controller.abort();
    if (presentationAnalysisController === controller) {
        presentationAnalysisEpoch += 1;
        presentationAnalysisController = null;
    }
}

function scheduleVisiblePageVisualBundle(snapshot, messageIndex, segmentOverride = null) {
    const mode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    if (mode !== 'shadow') return scheduleVisualBundleRefresh(snapshot, messageIndex, segmentOverride);

    cancelShadowPresentationAnalysis();
    const message = snapshot?.messages?.[messageIndex];
    const visibleText = String(message?.displayText || message?.text || '');
    if (!manifest || message?.role !== 'character' || !visibleText.trim()
        || PRESENTATION_ANNOTATION_MODE === 'off'
        || globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__) {
        return scheduleVisualBundleRefresh(snapshot, messageIndex, segmentOverride);
    }

    const controller = new AbortController();
    shadowPresentationAnalysisController = controller;
    const visualTask = scheduleVisualBundleRefresh(snapshot, messageIndex, segmentOverride);
    void deferShadowPresentationAnalysisUntilVisualSettles(
        visualTask,
        () => analyzePresentationSnapshot(snapshot, messageIndex, { mode: 'shadow', controller }),
        controller.signal,
    ).finally(() => {
        if (shadowPresentationAnalysisController === controller) shadowPresentationAnalysisController = null;
    });
    return visualTask;
}

async function analyzePresentationSnapshot(snapshot, activeIndex, { mode = resolvePresentationMode(String(manifest?.locale || release?.locale || '')), controller: suppliedController = null } = {}) {
    const epoch = ++presentationAnalysisEpoch;
    if (presentationAnalysisController && presentationAnalysisController !== suppliedController) presentationAnalysisController.abort();
    const analysisController = suppliedController || new AbortController();
    presentationAnalysisController = analysisController;
    const analysisSignal = analysisController.signal;
    if (!snapshot?.messages?.length || !snapshot?.fileName || !manifest || Date.now() < presentationServiceRetryAt) {
        if (presentationAnalysisController === analysisController) presentationAnalysisController = null;
        return;
    }
    let annotationsChanged = false;
    try {
        if (presentationServiceState !== true) {
            const status = await presentationAnalysis.healthCheck(analysisSignal);
            if (status?.serviceReady !== true || status?.analyzerConfigured !== true) {
                presentationServiceState = false;
                presentationAnalyzerScope = '';
                presentationServiceRetryAt = Date.now() + 30_000;
                return;
            }
            presentationServiceState = true;
            presentationAnalyzerScope = String(status.analyzerScope || 'configured');
            presentationServiceRetryAt = 0;
        }
        if (analysisSignal.aborted || epoch !== presentationAnalysisEpoch || activeChatSnapshot && activeChatSnapshot.fileName !== snapshot.fileName) return;
        const releaseId = String(release?.releaseId || manifest.releaseId || '');
        const scenarioId = String(release?.scenarioId || manifest.scenarioId || manifest.id || '');
        const scenarioVersion = String(release?.scenarioVersion || manifest.scenarioVersion || manifest.version || '');
        const arcId = String(release?.activeArcId || release?.arcId || manifest.defaultArcId || manifest.arcId || '');
        if (!releaseId || !scenarioId || !scenarioVersion) return;
        const selectedMessages = selectPresentationAnalysisMessages(snapshot.messages, activeIndex, mode);
        const assistantMessages = await Promise.all(selectedMessages.map(async ({ message, index }) => {
            const visibleText = String(message.displayText || message.text || '');
            return {
                index,
                message,
                sourceMessageIndex: Number.isSafeInteger(message.index) ? message.index : index,
                sourceMessageHash: await createVisibleMessageHash(visibleText),
                visibleText,
            };
        }));
        const activeMessage = assistantMessages.find(({ index, message }) => index === activeIndex || message.index === activeIndex);
        const historyMessages = mode === 'assisted' && activeMessage
            ? assistantMessages.filter((item) => item !== activeMessage)
            : mode === 'assisted' ? assistantMessages : [];
        const analysisBatches = mode === 'shadow'
            ? (activeMessage ? [[activeMessage]] : [])
            : [...(activeMessage ? [[activeMessage]] : []), ...chunkPresentationMessages(historyMessages, 8)];
        const chatKey = `chat_${await sha256Hex(`galgame.presentation.chat-scope.v1:${snapshot.fileName}`)}`;
        const publishedContext = await createPublishedPresentationKnownEntities(manifest?.resourceBindings?.characters || {});
        for (const diagnostic of publishedContext.diagnostics) {
            console.warn(`Galgame presentation input limited: ${diagnostic.code} count=${diagnostic.count}`);
        }
        const cacheScope = `${chatKey}/${releaseId}/${arcId}/`;
        if (mode === 'assisted') {
            await presentationCache.reconcileTimeline(cacheScope, assistantMessages.map((item) => ({
                sourceMessageIndex: item.sourceMessageIndex,
                sourceMessageHash: item.sourceMessageHash,
            })));
        }
        for (const entries of analysisBatches) {
            if (analysisSignal.aborted || epoch !== presentationAnalysisEpoch || activeChatSnapshot && activeChatSnapshot.fileName !== snapshot.fileName) return;
            const messages = entries.map(({ message, sourceMessageIndex, sourceMessageHash, visibleText }) => ({
                sourceMessageIndex,
                sourceMessageHash,
                authorLabel: '',
                visibleText,
            }));
            const firstIndex = entries[0]?.index ?? 0;
            const contextMessages = snapshot.messages.slice(Math.max(0, firstIndex - 4), firstIndex)
                .filter((message) => message?.role === 'character')
                .map(async (message, contextOffset) => {
                    const visibleText = String(message.displayText || message.text || '');
                    const sourceMessageIndex = Number.isSafeInteger(message.index) ? message.index : Math.max(0, firstIndex - 4) + contextOffset;
                    return { sourceMessageIndex, sourceMessageHash: await createVisibleMessageHash(visibleText), visibleText };
                });
            const resolvedContext = await Promise.all(contextMessages);
            const requests = await createPresentationBatches({
                scope: { scenarioId, scenarioVersion, releaseId, arcId, chatKey },
                messages,
                contextMessages: resolvedContext.slice(-4),
                knownEntities: publishedContext.knownEntities,
            });
            const analyzerScope = presentationAnalyzerScope;
            for (const request of requests) {
                if (analysisSignal.aborted || epoch !== presentationAnalysisEpoch || activeChatSnapshot && activeChatSnapshot.fileName !== snapshot.fileName) return;
                const uncached = [];
                for (const message of request.messages) {
                    const key = presentationCacheKey({ chatKey, releaseId, arcId, message, contextDigest: request.contextDigest, analyzerScope });
                    const cached = await presentationCache.get(key);
                    if (!cached) uncached.push(message);
                    else annotationsChanged = rememberPresentationAnnotation(snapshot, releaseId, arcId, entries.find((item) => item.sourceMessageIndex === message.sourceMessageIndex), cached) || annotationsChanged;
                }
                if (!uncached.length) continue;
                const inflightKey = `${cacheScope}${request.contextDigest}/${uncached.map((item) => item.sourceMessageHash).join(',')}`;
                if (presentationInflight.has(inflightKey)) continue;
                presentationInflight.add(inflightKey);
                try {
                    const analysisRequest = uncached.length === request.messages.length
                        ? request
                        : { ...request, messages: uncached };
                    const annotations = await presentationAnalysis.annotate({ request: analysisRequest, signal: analysisSignal });
                    if (analysisSignal.aborted || epoch !== presentationAnalysisEpoch || activeChatSnapshot && activeChatSnapshot.fileName !== snapshot.fileName) return;
                    for (const annotation of annotations) {
                        const source = uncached.find((item) => item.sourceMessageIndex === annotation.sourceMessageIndex);
                        if (!source) continue;
                        const key = presentationCacheKey({ chatKey, releaseId, arcId, message: source, contextDigest: request.contextDigest, analyzerScope });
                        await presentationCache.put(key, annotation, {
                            sourceMessageIndex: source.sourceMessageIndex,
                            sourceMessageHash: source.sourceMessageHash,
                            contextDigest: request.contextDigest,
                            schemaVersion: PRESENTATION_ANNOTATION_VERSION,
                            analyzerScope,
                        });
                        annotationsChanged = rememberPresentationAnnotation(snapshot, releaseId, arcId, entries.find((item) => item.sourceMessageIndex === annotation.sourceMessageIndex), annotation) || annotationsChanged;
                    }
                } finally {
                    presentationInflight.delete(inflightKey);
                }
            }
        }
        if (annotationsChanged && mode === 'assisted') {
            const currentState = await buildPresentationProjectionState(snapshot, releaseId, arcId);
            presentationProjectionStates.set(presentationProjectionScope(snapshot, releaseId, arcId), currentState);
            if (resolvePresentationMode(String(manifest?.locale || release?.locale || '')) === 'assisted'
                && epoch === presentationAnalysisEpoch
                && activeChatSnapshot?.fileName === snapshot.fileName) {
                renderChatSnapshot(snapshot, { messageIndex: activeIndex, pageIndex: activeSegmentIndex, skipPresentationAnalysis: true });
            }
        }
    } catch {
        if (analysisSignal.aborted) return;
        presentationServiceState = false;
        presentationServiceRetryAt = Date.now() + 30_000;
    } finally {
        if (presentationAnalysisController === analysisController) presentationAnalysisController = null;
    }
}

function presentationProjectionScope(snapshot, releaseId = release?.releaseId || manifest?.releaseId || '', arcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || manifest?.arcId || '') {
    return `${snapshot?.fileName || ''}/${releaseId}/${arcId}`;
}

function presentationAnnotationMemoryKey(snapshot, releaseId, arcId, sourceMessageIndex) {
    return `${presentationProjectionScope(snapshot, releaseId, arcId)}/${sourceMessageIndex}`;
}

function rememberPresentationAnnotation(snapshot, releaseId, arcId, source, annotation) {
    if (!source || !annotation || source.sourceMessageHash !== annotation.sourceMessageHash) return false;
    const key = presentationAnnotationMemoryKey(snapshot, releaseId, arcId, source.sourceMessageIndex);
    const previous = presentationAnnotations.get(key);
    if (previous?.sourceMessageHash === source.sourceMessageHash && previous.visibleText === source.visibleText) return false;
    presentationAnnotations.set(key, { annotation, sourceMessageHash: source.sourceMessageHash, visibleText: source.visibleText });
    while (presentationAnnotations.size > 2048) presentationAnnotations.delete(presentationAnnotations.keys().next().value);
    return true;
}

async function buildPresentationProjectionState(snapshot, releaseId, arcId) {
    const assistantMessages = await Promise.all(snapshot.messages
        .map((message, index) => ({ message, index }))
        .filter(({ message }) => message?.role === 'character' && String(message.displayText || message.text || '').trim())
        .map(async ({ message, index }) => {
            const visibleText = String(message.displayText || message.text || '');
            const sourceMessageIndex = Number.isSafeInteger(message.index) ? message.index : index;
            const remembered = presentationAnnotations.get(presentationAnnotationMemoryKey(snapshot, releaseId, arcId, sourceMessageIndex));
            return {
                sourceMessageIndex,
                sourceMessageHash: await createVisibleMessageHash(visibleText),
                visibleText,
                authorLabel: String(message.speaker || ''),
                annotation: remembered?.visibleText === visibleText ? remembered.annotation : null,
            };
        }));
    const publishedCast = Object.entries(manifest?.resourceBindings?.characters || {}).map(([id, character]) => ({
        id,
        name: String(character?.displayName || character?.name || id),
        aliases: Array.isArray(character?.aliases) ? character.aliases.map(String) : [],
    }));
    const identity = await projectPresentationIdentityDetailed({
        chatKey: String(snapshot.fileName), releaseId: String(releaseId), messages: assistantMessages, publishedCast,
    });
    return {
        releaseId: String(releaseId),
        arcId: String(arcId),
        projection: identity.projection,
        roster: projectPartyRoster({ chatKey: String(snapshot.fileName), releaseId: String(releaseId), messages: assistantMessages, identityProjection: identity }),
        messages: assistantMessages,
    };
}

function getAssistedPresentationSegments(snapshot, messageIndex, message, state) {
    const visibleText = String(message.displayText || message.text || '');
    const sourceMessageIndex = Number.isSafeInteger(message.index) ? message.index : messageIndex;
    const scope = presentationProjectionScope(snapshot);
    if (!isPresentationProjectionCurrent(snapshot, state) || presentationProjectionScope(snapshot, state.releaseId, state.arcId) !== scope) {
        return [{ index: 0, type: 'unknown', speaker: '未识别', identityRef: { type: 'unknown' }, text: visibleText }];
    }
    const remembered = presentationAnnotations.get(presentationAnnotationMemoryKey(snapshot, state.releaseId, state.arcId, sourceMessageIndex));
    if (!remembered || remembered.visibleText !== visibleText) {
        return [{ index: 0, type: 'unknown', speaker: '未识别', identityRef: { type: 'unknown' }, text: visibleText }];
    }
    return createPresentationDisplaySegments({
        text: visibleText,
        annotation: remembered.annotation,
        projection: state.projection,
        sourceMessageIndex,
        sourceMessageHash: state.messages.find((row) => row.sourceMessageIndex === sourceMessageIndex)?.sourceMessageHash || '',
    });
}

function isPresentationProjectionCurrent(snapshot, state) {
    return isPresentationProjectionTimelineCurrent(snapshot, state)
        && (state.messages || []).every((row) => {
            const remembered = presentationAnnotations.get(presentationAnnotationMemoryKey(snapshot, state.releaseId, state.arcId, row.sourceMessageIndex));
            return row.sourceMessageHash === remembered?.sourceMessageHash
                && row.visibleText === remembered?.visibleText;
        });
}

function chunkPresentationMessages(messages, size) {
    const batches = [];
    for (let index = 0; index < messages.length; index += size) batches.push(messages.slice(index, index + size));
    return batches;
}

function presentationCacheKey({ chatKey, releaseId, arcId, message, contextDigest, analyzerScope }) {
    return [chatKey, releaseId, arcId, message.sourceMessageIndex, message.sourceMessageHash, contextDigest,
        PRESENTATION_ANNOTATION_VERSION, PRESENTATION_IDENTITY_PROJECTION_VERSION,
        PRESENTATION_ROSTER_PROJECTION_VERSION, analyzerScope].join('/');
}

function getManifestKnownVisualSpeakers() {
    if (!manifest) return [];
    const arcId = release?.activeArcId || release?.arcId || manifest.defaultArcId || manifest.arcId || '';
    return [
        ...getVisualCharacterBindings(manifest, arcId),
        ...getVisualCharacterPool(manifest, arcId),
    ];
}

function scheduleVisualBundleRefresh(snapshot, messageIndex, segmentOverride = null) {
    clearPresentationCarousel();
    const token = visualBundleRequestToken + 1;
    visualBundleRequestToken = token;
    immediateVisualCharacterIdentity = '';
    coreVisualPresentationDetails.clear();
    const message = snapshot?.messages?.[messageIndex] || null;
    const visualRole = getActiveVisualSpeakerContext(message, messageIndex, segmentOverride).role;
    // Clear the portrait before each visible message. Keeping the previous
    // character during a narrator/player turn makes the avatar appear to
    // speak for the wrong entity while the validated decision is pending.
    const activePage = activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    const bootstrapCursor = sceneContinuityHistoryBootstrapController?.currentCursor;
    const nextPageIndex = Number.isSafeInteger(activeSegmentIndex) ? activeSegmentIndex : 0;
    const nextVisibleText = String(message?.displayText || message?.text || '');
    const nextPageText = String(activePage?.text || segmentOverride?.text || nextVisibleText);
    const sameBootstrapPage = bootstrapCursor
        && bootstrapCursor.scopeKey === activeSceneContinuityScopeKey
        && bootstrapCursor.messageIndex === messageIndex
        && bootstrapCursor.pageIndex === nextPageIndex
        && activeChatSnapshot?.fileName === snapshot?.fileName
        && bootstrapCursor.messageId === String(message?.index ?? messageIndex)
        && bootstrapCursor.sourceVisibleText === nextVisibleText
        && bootstrapCursor.pageText === nextPageText
        && bootstrapCursor.sourceSpan?.start === activePage?.sourceSpan?.start
        && bootstrapCursor.sourceSpan?.end === activePage?.sourceSpan?.end;
    if (sceneContinuityHistoryBootstrapController && !sameBootstrapPage) {
        recordSceneContinuityDiagnostic('continuity-bootstrap-cancelled', { reason: 'visible-page-changed' });
        sceneContinuityHistoryBootstrapController.abort();
    }
    renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: activePage?.type === 'dialogue-group' ? 'group' : visualRole });
    let refreshTask;
    if (activePage?.type === 'dialogue-group') {
        refreshTask = Promise.all([
            renderCoreVisualGroupScene(snapshot, messageIndex, activePage, token),
            renderPresentationPageCarousel(snapshot, messageIndex, activePage, token),
        ]);
    } else {
        // Bind the active speaker locally as soon as the segment is shown. The
        // remote visual decision still validates and corrects the result later.
        refreshTask = Promise.all([
            renderCoreVisualImmediateCharacter(snapshot, messageIndex, token),
            renderCoreVisualPresentation(snapshot, messageIndex, token),
        ]);
    }
    visualBundleRefreshTasks.set(token, refreshTask);
    while (visualBundleRefreshTasks.size > 64) {
        visualBundleRefreshTasks.delete(visualBundleRefreshTasks.keys().next().value);
    }
    return refreshTask;
}

function completedSceneContinuityPageKey(record) {
    return JSON.stringify([
        record.scopeKey, record.messageIndex, record.pageIndex, record.messageId,
        record.sourceMessageHash, record.pageTextHash,
    ]);
}

function getSceneContinuityLedgerStorage() {
    try {
        return globalThis.localStorage || globalThis.window?.localStorage || null;
    } catch {
        return null;
    }
}

async function hydrateSceneContinuityLedger(scopeKey) {
    if (!scopeKey || sceneContinuityLedgerHydratedScopeKey === scopeKey) return;
    if (sceneContinuityLedgerHydration?.scopeKey === scopeKey) {
        await sceneContinuityLedgerHydration.promise;
        return;
    }
    const promise = (async () => {
        let records = [];
        try {
            const storageKey = await createSceneContinuityLedgerStorageKey(scopeKey, createVisibleMessageHash);
            const storage = getSceneContinuityLedgerStorage();
            const serialized = storageKey ? storage?.getItem(storageKey) : null;
            records = parseSceneContinuityLedger(serialized, scopeKey);
        } catch {
            records = [];
        }
        if (activeSceneContinuityScopeKey !== scopeKey) return;
        for (const [key, record] of completedSceneContinuityPages) {
            if (record.scopeKey === scopeKey) completedSceneContinuityPages.delete(key);
        }
        for (const record of records) completedSceneContinuityPages.set(completedSceneContinuityPageKey(record), record);
        sceneContinuityLedgerHydratedScopeKey = scopeKey;
    })();
    sceneContinuityLedgerHydration = { scopeKey, promise };
    try {
        await promise;
    } finally {
        if (sceneContinuityLedgerHydration?.promise === promise) sceneContinuityLedgerHydration = null;
    }
}

async function persistSceneContinuityLedger(scopeKey) {
    if (!scopeKey || activeSceneContinuityScopeKey !== scopeKey) return false;
    try {
        const storageKey = await createSceneContinuityLedgerStorageKey(scopeKey, createVisibleMessageHash);
        const storage = getSceneContinuityLedgerStorage();
        if (!storageKey || !storage || activeSceneContinuityScopeKey !== scopeKey) return false;
        const records = capSceneContinuityLedgerRecords(Array.from(completedSceneContinuityPages.values())
            .filter((record) => record.scopeKey === scopeKey), SCENE_CONTINUITY_LEDGER_LIMIT);
        const serialized = serializeSceneContinuityLedger(scopeKey, records);
        if (!serialized) return false;
        storage.setItem(storageKey, serialized);
        return true;
    } catch {
        // localStorage is an optional derived cache; unavailable storage must
        // never block the active visual request or affect SillyTavern data.
        return false;
    }
}

function createEarlierVisibleCharacterScenePages(snapshot, currentCursor) {
    const newestFirstPages = [];
    const endMessageIndex = Math.min(currentCursor?.messageIndex ?? -1, (snapshot?.messages?.length || 0) - 1);
    const earliestMessageIndex = Math.max(0, endMessageIndex - 2_047);
    for (let messageIndex = endMessageIndex; messageIndex >= earliestMessageIndex
        && newestFirstPages.length < SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT; messageIndex -= 1) {
        const message = snapshot.messages[messageIndex];
        if (message?.role !== 'character') continue;
        const renderedMessage = createPresentationPagesForMessage(snapshot, messageIndex, message);
        const messageCodePoints = Array.from(renderedMessage.sourceText || '');
        if (messageIndex < currentCursor.messageIndex && messageCodePoints.length > 0 && messageCodePoints.length <= 4000) {
            const candidate = createSceneContinuityHistoryCandidate({
                sourceRole: 'character',
                message,
                messageIndex,
                pageIndex: 0,
                pageText: messageCodePoints.join(''),
                sourceSpan: { start: 0, end: messageCodePoints.length },
                wholeEarlierMessage: true,
            }, currentCursor.scopeKey);
            if (candidate) newestFirstPages.push(candidate);
            continue;
        }
        const { pages: messagePages } = renderedMessage;
        const latestPageIndex = Math.min(messagePages.length - 1,
            messageIndex === currentCursor.messageIndex ? currentCursor.pageIndex - 1 : messagePages.length - 1);
        for (let pageIndex = latestPageIndex; pageIndex >= 0
            && newestFirstPages.length < SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT; pageIndex -= 1) {
            const page = messagePages[pageIndex];
            const candidate = createSceneContinuityHistoryCandidate({
                sourceRole: 'character',
                message,
                messageIndex,
                pageIndex,
                pageText: String(page.text),
                sourceSpan: { start: page.sourceSpan.start, end: page.sourceSpan.end },
            }, currentCursor.scopeKey);
            if (!candidate || !isSceneContinuityCursorStrictlyEarlier(candidate.cursor, currentCursor)
                || !Number.isSafeInteger(page.sourceSpan?.start)
                || !Number.isSafeInteger(page.sourceSpan?.end)
                || page.sourceSpan.end <= page.sourceSpan.start
                || !String(page.text || '').trim()) continue;
            newestFirstPages.push(candidate);
        }
    }
    return newestFirstPages.reverse();
}

async function isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller) {
    if (!controller || controller.signal.aborted
        || activeSceneContinuityScopeKey !== currentCursor?.scopeKey
        || activeChatSnapshot?.fileName !== snapshot?.fileName
        || activeMessageIndex !== currentCursor?.messageIndex
        || activeSegmentIndex !== currentCursor?.pageIndex) return false;
    const message = activeChatSnapshot?.messages?.[currentCursor.messageIndex];
    const visibleText = String(message?.displayText || message?.text || '');
    const activePage = activeRenderContext && activeMessageIndex === currentCursor.messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    const pageText = String(activePage?.text || visibleText);
    const sourceSpan = activePage?.sourceSpan;
    if (!message || message.role !== 'character'
        || String(message.index ?? currentCursor.messageIndex) !== currentCursor.messageId
        || visibleText !== currentCursor.sourceVisibleText || pageText !== currentCursor.pageText
        || sourceSpan?.start !== currentCursor.sourceSpan?.start
        || sourceSpan?.end !== currentCursor.sourceSpan?.end) return false;
    const [sourceMessageHash, pageTextHash, timelinePrefixHash] = await Promise.all([
        createVisibleMessageHash(visibleText),
        createVisibleMessageHash(pageText),
        createSceneContinuityTimelinePrefixHash(
            activeChatSnapshot.messages, currentCursor.messageIndex, createVisibleMessageHash,
        ),
    ]);
    return !controller.signal.aborted
        && activeChatSnapshot?.fileName === snapshot?.fileName
        && activeSceneContinuityScopeKey === currentCursor.scopeKey
        && activeMessageIndex === currentCursor.messageIndex
        && activeSegmentIndex === currentCursor.pageIndex
        && sourceMessageHash === currentCursor.sourceMessageHash
        && pageTextHash === currentCursor.pageTextHash
        && timelinePrefixHash === currentCursor.timelinePrefixHash;
}

function sceneLocationSourceSpan(pageText, projection, pageSourceSpan, sceneKey) {
    const location = projection?.evidenceSpans?.find((span) => span.relation === 'current-location'
        && span.sceneEntityKey === sceneKey);
    if (!location || !Number.isSafeInteger(location.start) || !Number.isSafeInteger(location.end)
        || location.start < 0 || location.end <= location.start || location.end > String(pageText).length
        || !Number.isSafeInteger(pageSourceSpan?.start)) return null;
    const relativeStart = Array.from(String(pageText).slice(0, location.start)).length;
    const relativeEnd = Array.from(String(pageText).slice(0, location.end)).length;
    return { start: pageSourceSpan.start + relativeStart, end: pageSourceSpan.start + relativeEnd };
}

function resolveHistoricalAnchorDisplayPage(snapshot, candidate, projection, sceneKey) {
    if (!candidate?.wholeEarlierMessage) return candidate;
    const location = projection?.evidenceSpans?.find((span) => span.relation === 'current-location'
        && span.sceneEntityKey === sceneKey);
    const transition = projection?.evidenceSpans?.find((span) => span.relation === 'transition-action'
        && span.destinationSceneKey === sceneKey);
    if (!location || !transition) return null;
    const toSourceSpan = (span) => ({
        start: candidate.sourceSpan.start + Array.from(candidate.pageText.slice(0, span.start)).length,
        end: candidate.sourceSpan.start + Array.from(candidate.pageText.slice(0, span.end)).length,
    });
    const locationSourceSpan = toSourceSpan(location);
    const transitionSourceSpan = toSourceSpan(transition);
    const renderedPages = createPresentationPagesForMessage(snapshot, candidate.messageIndex, candidate.message).pages;
    const anchorPage = renderedPages.find((page) => (
        page.sourceSpan?.start <= locationSourceSpan.start
        && page.sourceSpan?.end >= locationSourceSpan.end
        && page.sourceSpan?.start <= transitionSourceSpan.start
        && page.sourceSpan?.end >= transitionSourceSpan.end
    ));
    return anchorPage ? {
        ...candidate,
        pageIndex: anchorPage.index,
        pageText: anchorPage.text,
        sourceSpan: anchorPage.sourceSpan,
        wholeEarlierMessage: false,
    } : null;
}

async function createSceneContinuityHistoryCursor(snapshot, page, currentCursor) {
    const message = page?.message;
    const visibleText = String(message?.displayText || message?.text || '');
    const sourceText = Array.from(resolvePresentationMode(String(manifest?.locale || release?.locale || '')) === 'assisted'
        ? visibleText
        : formatVisualNovelDisplayText(visibleText));
    const pageText = String(page?.pageText || '');
    const sourceSpan = page?.sourceSpan;
    if (!message || message.role !== 'character'
        || !Number.isSafeInteger(sourceSpan?.start) || !Number.isSafeInteger(sourceSpan?.end)
        || sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > sourceText.length
        || sourceText.slice(sourceSpan.start, sourceSpan.end).join('') !== pageText) return null;
    const cursor = {
        scopeKey: currentCursor.scopeKey,
        scope: currentCursor.scope,
        messageIndex: page.messageIndex,
        pageIndex: page.pageIndex,
        messageId: String(message.index ?? page.messageIndex),
        sourceMessageHash: await createVisibleMessageHash(visibleText),
        pageTextHash: await createVisibleMessageHash(pageText),
        timelinePrefixHash: await createSceneContinuityTimelinePrefixHash(
            snapshot?.messages || [], page.messageIndex, createVisibleMessageHash,
        ),
        sourceSpan: { start: sourceSpan.start, end: sourceSpan.end },
    };
    return cursor.timelinePrefixHash ? cursor : null;
}

async function analyzeHistoricalSceneTransitionPage(snapshot, page, contextPages, currentCursor, controller, health) {
    if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
    const message = page?.message;
    const pageCursor = await createSceneContinuityHistoryCursor(snapshot, page, currentCursor);
    if (!pageCursor || !isSceneContinuityCursorStrictlyEarlier(pageCursor, currentCursor)
        || !await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
    const validatedPage = await scenePageStillInCurrentTimeline({
        snapshot,
        message,
        messageIndex: page.messageIndex,
        currentScope: currentCursor.scope,
        currentCursor: pageCursor,
        pageText: page.pageText,
        sourceSpan: page.sourceSpan,
    });
    if (!validatedPage || !await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;

    const request = await createSceneContinuityAnalysisRequest({
        sourceRole: 'character',
        scope: currentCursor.scope,
        messageId: pageCursor.messageId,
        pageIndex: page.pageIndex,
        pageText: page.pageText,
        contextPages,
        previousScene: null,
    });
    const cacheKey = await createSceneContinuityAnalysisCacheKey({
        request,
        analyzerScope: health.sceneAnalyzerScope || '',
        promptVersion: health.sceneAnalyzerScope || '',
    });
    let cached = sceneContinuityAnalysisCache.get(cacheKey);
    if (!cached) {
        const analysis = await presentationAnalysis.analyzeSceneContinuity({
            request,
            signal: controller.signal,
        });
        cached = await buildSceneContinuityProjectionFromAnalysis(analysis);
    }
    if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
    const projection = cached?.projection;
    if (!isSceneContinuityProjectionBoundToCursor(projection, pageCursor)) return null;
    const stillCurrent = await scenePageStillInCurrentTimeline({
        snapshot,
        message,
        messageIndex: page.messageIndex,
        currentScope: currentCursor.scope,
        currentCursor: pageCursor,
        pageText: page.pageText,
        sourceSpan: page.sourceSpan,
    });
    if (!stillCurrent || !await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
    sceneContinuityAnalysisCache.set(cacheKey, cached);

    const result = await consumeSceneContinuityProjection({
        pageText: page.pageText,
        projection,
        expectedScope: currentCursor.scope,
        previousScope: currentCursor.scope,
        previousVerifiedSceneKey: null,
    });
    if (!hasCompletedSceneContinuityEvidence(result, projection)
        || result.state !== 'changed'
        || !cached.visualHint?.displayLabel && !extractCurrentSceneLabelFromProjection(page.pageText, projection)) return {
        state: 'unknown',
        timelineValidated: true,
    };

    const anchorPage = resolveHistoricalAnchorDisplayPage(snapshot, page, projection, result.sceneKey);
    const anchorCursor = anchorPage && await createSceneContinuityHistoryCursor(snapshot, anchorPage, currentCursor);
    const locationSourceSpan = sceneLocationSourceSpan(page.pageText, projection, page.sourceSpan, result.sceneKey);
    const displayLabel = extractCurrentSceneLabelFromProjection(page.pageText, projection);
    if (!anchorPage || !anchorCursor || !locationSourceSpan || !displayLabel
        || locationSourceSpan.start < anchorPage.sourceSpan.start
        || locationSourceSpan.end > anchorPage.sourceSpan.end) return { state: 'unknown', timelineValidated: true };
    await rememberCompletedScenePage({
        scopeKey: currentCursor.scopeKey,
        scope: currentCursor.scope,
        snapshot,
        message,
        messageIndex: anchorPage.messageIndex,
        pageIndex: anchorPage.pageIndex,
        sourceSpan: anchorPage.sourceSpan,
        sceneLocationSpan: locationSourceSpan,
        sourceMessageHash: anchorCursor.sourceMessageHash,
        pageTextHash: anchorCursor.pageTextHash,
        timelinePrefixHash: anchorCursor.timelinePrefixHash,
        lineageFingerprint: '',
        sceneKey: result.sceneKey,
        displayLabel,
        visualHint: cached.visualHint,
    });
    if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
    recordSceneContinuityDiagnostic('continuity-bootstrap-anchor', { state: 'changed' });
    return {
        ...result,
        timelineValidated: true,
        anchorCursor: { messageIndex: anchorPage.messageIndex, pageIndex: anchorPage.pageIndex },
    };
}

function sceneContinuityHistoryRunKey(currentCursor) {
    return JSON.stringify([
        currentCursor.scopeKey,
        currentCursor.timelinePrefixHash,
        currentCursor.messageIndex,
        currentCursor.pageIndex,
    ]);
}

async function reprojectVisiblePageAfterSceneHistoryBootstrap(snapshot, messageIndex, currentCursor, token) {
    const initialRender = visualBundleRefreshTasks.get(token);
    if (initialRender) await initialRender.catch(() => undefined);
    let currentToken = visualBundleRequestToken;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const candidateToken = visualBundleRequestToken;
        const currentRender = visualBundleRefreshTasks.get(candidateToken);
        if (currentRender && currentRender !== initialRender) await currentRender.catch(() => undefined);
        if (candidateToken === visualBundleRequestToken) {
            currentToken = candidateToken;
            break;
        }
        currentToken = visualBundleRequestToken;
    }
    if (activeSceneContinuityScopeKey !== currentCursor.scopeKey
        || activeChatSnapshot?.fileName !== snapshot?.fileName || activeMessageIndex !== messageIndex
        || activeSegmentIndex !== currentCursor.pageIndex) return;
    const message = activeChatSnapshot?.messages?.[messageIndex];
    const activePage = activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    if (!message || !activePage || activeSegmentIndex !== currentCursor.pageIndex) return;
    const mode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    const visibleText = String(message.displayText || message.text || '');
    const sourceText = Array.from(mode === 'assisted' ? visibleText : formatVisualNovelDisplayText(visibleText));
    const sourceSpan = activePage.sourceSpan;
    const pageText = String(activePage.text || '');
    if (!Number.isSafeInteger(sourceSpan?.start) || !Number.isSafeInteger(sourceSpan?.end)
        || sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > sourceText.length
        || sourceText.slice(sourceSpan.start, sourceSpan.end).join('') !== pageText
        || await createVisibleMessageHash(visibleText) !== currentCursor.sourceMessageHash
        || await createVisibleMessageHash(pageText) !== currentCursor.pageTextHash
        || await createSceneContinuityTimelinePrefixHash(activeChatSnapshot.messages, messageIndex, createVisibleMessageHash)
            !== currentCursor.timelinePrefixHash) return;

    if (activePage.type === 'dialogue-group') {
        await renderCoreVisualGroupScene(activeChatSnapshot, messageIndex, activePage, currentToken);
    } else {
        await renderCoreVisualPresentation(activeChatSnapshot, messageIndex, currentToken);
    }
}

function scheduleVisualReprojectionAfterSceneHistoryBootstrap(snapshot, messageIndex, currentCursor, token) {
    const runKey = sceneContinuityHistoryRunKey(currentCursor);
    const existingRefreshRun = sceneContinuityBootstrapRefreshRuns.get(runKey);
    if (existingRefreshRun && !existingRefreshRun.controller?.signal.aborted) return;
    if (existingRefreshRun) sceneContinuityBootstrapRefreshRuns.delete(runKey);
    const refreshRun = { controller: null };
    sceneContinuityBootstrapRefreshRuns.set(runKey, refreshRun);
    const bootstrapPromise = bootstrapEarlierVerifiedScenePage(snapshot, currentCursor, token);
    refreshRun.controller = sceneContinuityHistoryBootstrapController;
    void bootstrapPromise
        .then(async (record) => {
            if (!record) return;
            recordSceneContinuityDiagnostic('continuity-bootstrap-refresh', { state: 'scheduled' });
            await reprojectVisiblePageAfterSceneHistoryBootstrap(snapshot, messageIndex, currentCursor, token);
        })
        .catch(() => {
            recordSceneContinuityDiagnostic('continuity-bootstrap-skipped', { reason: 'history-replay-failed' });
        })
        .finally(() => {
            if (sceneContinuityBootstrapRefreshRuns.get(runKey) === refreshRun) {
                sceneContinuityBootstrapRefreshRuns.delete(runKey);
            }
        });
}

async function bootstrapEarlierVerifiedScenePage(snapshot, currentCursor, token) {
    const runKey = sceneContinuityHistoryRunKey(currentCursor);
    const existing = sceneContinuityHistoryBootstrapRuns.get(runKey);
    if (existing && !existing.controller.signal.aborted) return existing.promise;
    if (existing) sceneContinuityHistoryBootstrapRuns.delete(runKey);

    const controller = new AbortController();
    sceneContinuityHistoryBootstrapController?.abort();
    sceneContinuityHistoryBootstrapController = controller;
    controller.currentCursor = currentCursor;
    controller.snapshot = snapshot;
    const run = { controller, promise: null };
    run.promise = (async () => {
        try {
            if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) return null;
            const health = await presentationAnalysis.healthCheck(controller.signal);
            if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)
                || health?.serviceReady !== true || health?.analyzerConfigured !== true) {
                recordSceneContinuityDiagnostic('continuity-bootstrap-skipped', {
                    reason: health?.diagnosticCode || (controller.signal.aborted ? 'aborted' : 'analyzer-not-ready'),
                });
                return null;
            }
            presentationAnalyzerScope = String(health.analyzerScope || 'configured');
            const pages = createEarlierVisibleCharacterScenePages(snapshot, currentCursor)
                .filter((page) => page.sourceRole === 'character' && String(page.pageText || '').trim()
                    && isSceneContinuityCursorStrictlyEarlier(page.cursor, currentCursor))
                .slice(-SCENE_CONTINUITY_HISTORY_REPLAY_PAGE_LIMIT);
            const scopeHash = await createVisibleMessageHash(currentCursor.scopeKey);
            const targetCursorHash = await createSceneContinuityHistoryTargetCursorHash(
                currentCursor, createVisibleMessageHash,
            );
            const candidateListHash = await createSceneContinuityHistoryCandidateListHash(
                pages, createVisibleMessageHash,
            );
            const checkpointKey = await createSceneContinuityHistoryCheckpointKey(
                currentCursor.scopeKey, createVisibleMessageHash,
            );
            const analyzerScope = String(health.sceneAnalyzerScope || '');
            const expectedCheckpoint = {
                scopeHash,
                targetCursorHash,
                candidateListHash,
                analyzerScope,
                candidateCount: pages.length,
            };
            const storage = getSceneContinuityLedgerStorage();
            let checkpoint = null;
            if (checkpointKey && storage) {
                let savedCheckpoint = '';
                try { savedCheckpoint = storage.getItem(checkpointKey) || ''; } catch { /* optional cache */ }
                checkpoint = parseSceneContinuityHistoryCheckpoint(savedCheckpoint, expectedCheckpoint);
                if (!checkpoint) {
                    try { storage.removeItem(checkpointKey); } catch { /* optional cache */ }
                }
            }
            if (checkpoint?.processedCandidates === pages.length
                && checkpoint.failedCandidateOffsets.length === 0) {
                recordSceneContinuityDiagnostic('continuity-bootstrap-complete', {
                    state: 'no-anchor', candidates: pages.length,
                });
                return null;
            }
            let failedOffsets = new Set(checkpoint?.failedCandidateOffsets || []);
            let processedCandidates = checkpoint?.processedCandidates || 0;
            let nextOffset = checkpoint
                ? getSceneContinuityHistoryCheckpointResumeOffset(checkpoint, pages.length)
                : 0;
            // Revisit the first failed candidate on the next run. Offsets are
            // scheduling hints only and are bound to hashes of the exact chat
            // scope, visible cursor, analyzer, and bounded candidate list.
            failedOffsets = new Set();
            const persistCheckpoint = () => {
                if (!checkpointKey || !storage) return;
                const nextCheckpoint = createSceneContinuityHistoryCheckpoint({
                    ...expectedCheckpoint,
                    processedCandidates,
                    failedCandidateOffsets: [...failedOffsets],
                });
                const serialized = serializeSceneContinuityHistoryCheckpoint(nextCheckpoint);
                if (!serialized) return;
                try { storage.setItem(checkpointKey, serialized); } catch { /* optional cache */ }
            };
            checkpoint = createSceneContinuityHistoryCheckpoint({
                ...expectedCheckpoint,
                processedCandidates: nextOffset,
                failedCandidateOffsets: [],
            });
            processedCandidates = nextOffset;
            persistCheckpoint();
            recordSceneContinuityDiagnostic('continuity-bootstrap-started', {
                candidates: pages.length, state: `resume-${nextOffset}`,
            });
            let failedCandidateCount = 0;
            let lastFailureCode = '';
            let anchor = null;
            while (nextOffset < pages.length
                && await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) {
                const batchStart = nextOffset;
                const batchSize = Math.min(SCENE_CONTINUITY_HISTORY_REPLAY_BATCH_LIMIT, pages.length - batchStart);
                anchor = await findLatestVerifiedSceneTransitionAnchor(pages, {
                    currentCursor,
                    signal: controller.signal,
                    skipNewest: batchStart,
                    batchLimit: batchSize,
                    minIntervalMs: SCENE_CONTINUITY_HISTORY_REPLAY_MIN_INTERVAL_MS,
                    onCandidateError: (_page, error) => {
                        failedCandidateCount += 1;
                        lastFailureCode = String(error?.code || error?.name || 'analysis-failed')
                            .replace(/[^a-z0-9_-]/giu, '').slice(0, 64) || 'analysis-failed';
                    },
                    onCandidateSettled: async ({ status, processedCandidates: settledCount }) => {
                        if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) {
                            controller.abort();
                            return;
                        }
                        processedCandidates = Math.max(processedCandidates, settledCount);
                        if (status === 'failed') failedOffsets.add(settledCount - 1);
                        persistCheckpoint();
                    },
                    analyzePage: (page, options) => analyzeHistoricalSceneTransitionPage(
                        snapshot, page, options.contextPages, currentCursor, controller, health,
                    ),
                });
                if (anchor || controller.signal.aborted) break;
                nextOffset = batchStart + batchSize;
                processedCandidates = Math.max(processedCandidates, nextOffset);
                persistCheckpoint();
                recordSceneContinuityDiagnostic('continuity-bootstrap-progress', {
                    candidates: processedCandidates, failedCandidates: failedCandidateCount,
                    reason: lastFailureCode,
                });
            }
            if (!await isSceneContinuityBootstrapCursorCurrent(snapshot, currentCursor, controller)) {
                recordSceneContinuityDiagnostic('continuity-bootstrap-skipped', {
                    reason: 'aborted', failedCandidates: failedCandidateCount,
                });
                return null;
            }
            if (!anchor) {
                processedCandidates = pages.length;
                persistCheckpoint();
                recordSceneContinuityDiagnostic('continuity-bootstrap-empty', {
                    candidates: pages.length,
                    failedCandidates: failedCandidateCount,
                });
                return null;
            }
            const record = Array.from(completedSceneContinuityPages.values())
                .find((entry) => entry.scopeKey === currentCursor.scopeKey
                    && entry.messageIndex === (anchor.result.anchorCursor?.messageIndex ?? anchor.page.messageIndex)
                    && entry.pageIndex === (anchor.result.anchorCursor?.pageIndex ?? anchor.page.pageIndex)
                    && entry.sceneKey === anchor.result.sceneKey);
            if (record) {
                if (checkpointKey && storage) {
                    try { storage.removeItem(checkpointKey); } catch { /* optional cache */ }
                }
                recordSceneContinuityDiagnostic('continuity-bootstrap-complete', { state: 'restored' });
                return record;
            }
            return null;
        } catch {
            if (!controller.signal.aborted) {
                recordSceneContinuityDiagnostic('continuity-bootstrap-skipped', { reason: 'history-replay-failed' });
            }
            return null;
        } finally {
            if (sceneContinuityHistoryBootstrapController === controller) sceneContinuityHistoryBootstrapController = null;
        }
    })();
    sceneContinuityHistoryBootstrapRuns.set(runKey, run);
    while (sceneContinuityHistoryBootstrapRuns.size > 64) {
        sceneContinuityHistoryBootstrapRuns.delete(sceneContinuityHistoryBootstrapRuns.keys().next().value);
    }
    const result = await run.promise;
    if (!result && sceneContinuityHistoryBootstrapRuns.get(runKey) === run) {
        sceneContinuityHistoryBootstrapRuns.delete(runKey);
    }
    return result;
}

async function findEarlierCompletedScenePage(snapshot, currentCursor, { allowHistoryBootstrap = false, token = visualBundleRequestToken } = {}) {
    const timelineSnapshot = activeChatSnapshot?.fileName === snapshot?.fileName ? activeChatSnapshot : snapshot;
    await hydrateSceneContinuityLedger(currentCursor.scopeKey);
    const originals = new Map(Array.from(completedSceneContinuityPages.values())
        .filter((record) => record.scopeKey === currentCursor.scopeKey)
        .map((record) => [completedSceneContinuityPageKey(record), record]));
    const mode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    const validated = await validateSceneContinuityLedgerRecords(Array.from(originals.values()), {
        messages: timelineSnapshot?.messages || [],
        scopeKey: currentCursor.scopeKey,
        expectedScope: currentCursor.scope,
        hashText: createVisibleMessageHash,
        formatSourceText: (visibleText) => mode === 'assisted' ? visibleText : formatVisualNovelDisplayText(visibleText),
    });
    const validKeys = new Set(validated.map(completedSceneContinuityPageKey));
    let ledgerChanged = false;
    for (const [key, record] of completedSceneContinuityPages) {
        if (record.scopeKey === currentCursor.scopeKey && !validKeys.has(key)) {
            completedSceneContinuityPages.delete(key);
            ledgerChanged = true;
        }
    }
    for (const record of validated) {
        const key = completedSceneContinuityPageKey(record);
        completedSceneContinuityPages.set(key, {
            ...record,
            visualHint: createPersistedSceneVisualHint(record),
        });
    }
    if (ledgerChanged) await persistSceneContinuityLedger(currentCursor.scopeKey);
    let candidates = validated
        .map((record) => ({
            ...record,
            visualHint: createPersistedSceneVisualHint(record),
        }))
        .filter((record) => isSceneContinuityCursorStrictlyEarlier(record, currentCursor));
    if (!candidates.length && allowHistoryBootstrap) {
        // Keep the visible page responsive. Re-analysis runs in the background;
        // when it finds a source-validated transition, the same visible page is
        // reprojected after its first visual request has settled.
        scheduleVisualReprojectionAfterSceneHistoryBootstrap(snapshot, currentCursor.messageIndex, currentCursor, token);
    }
    return selectLatestEarlierCompletedScenePage(candidates, currentCursor);
}

async function findCompletedScenePageAtCursor(snapshot, currentCursor) {
    if (!Number.isSafeInteger(currentCursor?.pageIndex) || currentCursor.pageIndex >= Number.MAX_SAFE_INTEGER) return null;
    // Reuse the complete canonical-timeline validation path, while moving only
    // the ordering cursor one page forward so an exact-current record can be
    // selected. The identity check below rejects every earlier page returned
    // by that lookup.
    const candidate = await findEarlierCompletedScenePage(snapshot, {
        ...currentCursor,
        pageIndex: currentCursor.pageIndex + 1,
    });
    if (!candidate
        || candidate.scopeKey !== currentCursor.scopeKey
        || candidate.messageIndex !== currentCursor.messageIndex
        || candidate.pageIndex !== currentCursor.pageIndex
        || candidate.messageId !== currentCursor.messageId
        || candidate.sourceMessageHash !== currentCursor.sourceMessageHash
        || candidate.pageTextHash !== currentCursor.pageTextHash
        || candidate.timelinePrefixHash !== currentCursor.timelinePrefixHash
        || candidate.sourceSpan?.start !== currentCursor.sourceSpan?.start
        || candidate.sourceSpan?.end !== currentCursor.sourceSpan?.end
        || (candidate.lineageFingerprint || '') !== (currentCursor.lineageFingerprint || '')) return null;
    return candidate;
}

function hasVerifiedSceneBackground(record) {
    return Boolean(record?.scopeKey
        && record.scopeKey === activeSceneContinuityScopeKey
        && record.scopeKey === verifiedSceneContinuity.scopeKey
        && record.sceneKey
        && record.sceneKey === verifiedSceneContinuity.sceneKey
        && coreVisualHasVerifiedBackground
        && ui.stageBackdrop?.dataset.visualAssetIdentity
        && ui.stageBackdrop?.classList?.contains?.('is-visual-active'));
}

function hasCompletedSceneContinuityEvidence(result, projection) {
    if (!result?.sceneKey || !['changed', 'continued'].includes(result.state)
        || projection?.state !== result.state || projection.currentSceneKey !== result.sceneKey
        || !Array.isArray(projection.evidenceSpans)) return false;
    const currentLocation = projection.evidenceSpans.some((span) => (
        span.relation === 'current-location' && span.sceneEntityKey === result.sceneKey
    ));
    if (!currentLocation) return false;
    if (result.state === 'changed') {
        return projection.evidenceSpans.some((span) => (
            span.relation === 'transition-action' && span.destinationSceneKey === result.sceneKey
        ));
    }
    return !projection.evidenceSpans.some((span) => span.relation === 'transition-action');
}

function sceneContinuityRestoreResult(record, token, { currentPage = false } = {}) {
    const backgroundAlreadyVisible = hasVerifiedSceneBackground(record);
    // The ledger record itself was produced by a validated completed page.
    // Rehydrating this identity restores only that verified source cursor; it
    // does not promote an unknown current page into a new scene record.
    verifiedSceneContinuity = {
        scope: record.scope,
        scopeKey: record.scopeKey,
        sceneKey: record.sceneKey,
        displayLabel: record.displayLabel,
        messageIndex: record.messageIndex,
        pageIndex: record.pageIndex,
        messageId: record.messageId,
        sourceMessageHash: record.sourceMessageHash,
    };
    activeSceneContinuityToken = token;
    if (backgroundAlreadyVisible) {
        activeSceneContinuityAction = 'preserve';
        return {
            state: 'continued',
            action: 'preserve',
            sceneKey: record.sceneKey,
            reasonCode: 'validated-scene-background-already-visible',
        };
    }
    activeSceneContinuityAction = 'changed';
    clearVerifiedSceneLayer();
    return {
        state: currentPage ? 'changed' : 'unknown',
        action: 'clear-before-match',
        sceneKey: record.sceneKey,
        visualHint: createPersistedSceneVisualHint(record),
        reasonCode: currentPage ? 'restored-current-page-scene-cache' : 'restored-earlier-verified-scene',
    };
}

function sceneContinuityPreviousSourceKey(record) {
    return sceneContinuityRecordFingerprint(record);
}

function createPersistedSceneVisualHint(record) {
    if (!record?.sceneKey || !record?.displayLabel) return null;
    return {
        entityKeySeed: `validated-scene:${record.sceneKey}`,
        entityType: 'scene',
        displayLabel: record.displayLabel,
        visibleAttributes: [{ code: 'scene-location-kind', value: record.displayLabel, confidenceBand: 'explicit' }],
        confidenceBand: 'explicit',
    };
}

async function sceneContinuityPreviousLineageStillCurrent(snapshot, currentCursor, previousRecord) {
    if (!previousRecord) return !currentCursor.lineageFingerprint;
    const latest = await findEarlierCompletedScenePage(snapshot, currentCursor);
    return Boolean(latest
        && sceneContinuityPreviousSourceKey(latest) === currentCursor.lineageFingerprint
        && sceneContinuityPreviousSourceKey(latest) === sceneContinuityPreviousSourceKey(previousRecord));
}

function finishSceneContinuityTask(task) {
    if (!task) return;
    task.resolve?.();
    if (sceneContinuityAnalysisTask === task) sceneContinuityAnalysisTask = null;
    if (sceneContinuityAnalysisController === task.controller) sceneContinuityAnalysisController = null;
}

function abortSceneContinuityTask() {
    const task = sceneContinuityAnalysisTask;
    if (!task) return;
    task.controller.abort();
    finishSceneContinuityTask(task);
}

function abortSceneContinuityTaskForPlayerBranch(snapshot) {
    const task = sceneContinuityAnalysisTask;
    const chatId = String(snapshot?.fileName || snapshot?.chatId || '');
    const releaseId = String(release?.releaseId || manifest?.releaseId || '');
    const arcId = String(release?.activeArcId || release?.arcId || manifest?.defaultArcId || manifest?.arcId || '') || null;
    const taskMismatch = task && (task.scope.chatId !== chatId || task.scope.releaseId !== releaseId || task.scope.arcId !== arcId);
    const verifiedMismatch = verifiedSceneContinuity.scope
        && (verifiedSceneContinuity.scope.chatId !== chatId
            || verifiedSceneContinuity.scope.releaseId !== releaseId
            || verifiedSceneContinuity.scope.arcId !== arcId);
    if (taskMismatch || verifiedMismatch) {
        abortSceneContinuityTask();
        sceneContinuityHistoryBootstrapController?.abort();
        sceneContinuityHistoryBootstrapController = null;
        sceneContinuityHistoryBootstrapRuns.clear();
        sceneContinuityBootstrapRefreshRuns.clear();
        completedSceneContinuityPages.clear();
        sceneContinuityAnalysisCache.clear();
        sceneContinuityLedgerHydratedScopeKey = '';
        sceneContinuityLedgerHydration = null;
        activeSceneContinuityScopeKey = '';
        verifiedSceneContinuity = {
            scope: null, scopeKey: '', sceneKey: null, displayLabel: '',
            messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '',
        };
        clearVerifiedSceneLayer();
    }
}

async function waitForEarlierSceneContinuityTask(currentCursor) {
    const task = sceneContinuityAnalysisTask;
    if (!await waitForPriorSceneContinuityTask(task, currentCursor)) {
        abortSceneContinuityTask();
    }
}

async function scenePageStillInCurrentTimeline({ snapshot, message, messageIndex, currentScope, currentCursor, pageText, sourceSpan } = {}) {
    if (activeChatSnapshot?.fileName !== snapshot?.fileName
        || activeSceneContinuityScopeKey !== currentCursor?.scopeKey) return false;
    const currentReleaseId = String(release?.releaseId || manifest?.releaseId || '');
    const currentArcId = String(release?.activeArcId || release?.arcId || manifest?.defaultArcId || manifest?.arcId || '') || null;
    if (currentReleaseId !== currentScope.releaseId || currentArcId !== currentScope.arcId) return false;
    const latestMessage = activeChatSnapshot.messages?.[messageIndex];
    if (latestMessage?.role !== 'character'
        || String(latestMessage.index ?? messageIndex) !== currentCursor.messageId) return false;
    const latestVisibleText = String(latestMessage.displayText || latestMessage.text || '');
    if (await createVisibleMessageHash(latestVisibleText) !== currentCursor.sourceMessageHash) return false;
    if (String(message?.displayText || message?.text || '') !== latestVisibleText) return false;
    if (!Number.isSafeInteger(sourceSpan?.start) || !Number.isSafeInteger(sourceSpan?.end)) return false;
    const mode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    const sourceText = Array.from(mode === 'assisted' ? latestVisibleText : formatVisualNovelDisplayText(latestVisibleText));
    if (sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > sourceText.length
        || sourceText.slice(sourceSpan.start, sourceSpan.end).join('') !== pageText) return false;
    const pageTextHash = await createVisibleMessageHash(pageText);
    const timelinePrefixHash = await createSceneContinuityTimelinePrefixHash(
        activeChatSnapshot.messages, messageIndex, createVisibleMessageHash,
    );
    if (!timelinePrefixHash || pageTextHash !== currentCursor.pageTextHash
        || timelinePrefixHash !== currentCursor.timelinePrefixHash) return false;
    return {
        ...currentCursor,
        sourceMessageHash: await createVisibleMessageHash(latestVisibleText),
        pageTextHash,
        timelinePrefixHash,
        sourceSpan: { start: sourceSpan.start, end: sourceSpan.end },
        timelineValidated: true,
    };
}

async function rememberCompletedScenePage({ scopeKey, scope, snapshot, message, messageIndex, pageIndex, sourceSpan, sceneLocationSpan, sourceMessageHash, pageTextHash, timelinePrefixHash, lineageFingerprint, sceneKey, displayLabel, visualHint } = {}) {
    if (!scopeKey || !snapshot?.messages?.[messageIndex] || message?.role !== 'character'
        || !sceneKey || !Number.isSafeInteger(pageIndex) || pageIndex < 0
        || !Number.isSafeInteger(sourceSpan?.start) || !Number.isSafeInteger(sourceSpan?.end)
        || !Number.isSafeInteger(sceneLocationSpan?.start) || !Number.isSafeInteger(sceneLocationSpan?.end)
        || sceneLocationSpan.start < sourceSpan.start || sceneLocationSpan.end <= sceneLocationSpan.start
        || sceneLocationSpan.end > sourceSpan.end
        || !timelinePrefixHash || !scope) return;
    const sourceText = Array.from(resolvePresentationMode(String(manifest?.locale || release?.locale || '')) === 'assisted'
        ? String(message.displayText || message.text || '')
        : formatVisualNovelDisplayText(String(message.displayText || message.text || '')));
    if (sceneLocationSpan.end > sourceText.length) return;
    const sourceLocation = sourceText.slice(sceneLocationSpan.start, sceneLocationSpan.end).join('').trim();
    if (!sourceLocation || await deriveSceneContinuityKey(scope, sourceLocation) !== sceneKey) return;
    const record = {
        scopeKey,
        scope,
        messageIndex,
        pageIndex,
        messageId: String(message.index ?? messageIndex),
        sourceMessageHash,
        pageTextHash,
        timelinePrefixHash,
        sourceSpan: { start: sourceSpan.start, end: sourceSpan.end },
        sceneLocationSpan: { start: sceneLocationSpan.start, end: sceneLocationSpan.end },
        sceneKey: String(sceneKey),
        displayLabel: sourceLocation.slice(0, 80),
        lineageFingerprint: lineageFingerprint || '',
        visualHint: visualHint?.entityType === 'scene' ? structuredClone(visualHint) : null,
    };
    const sourceStillCurrent = await scenePageStillInCurrentTimeline({
        snapshot, message, messageIndex, currentScope: scope,
        currentCursor: { ...record, timelineValidated: false },
        pageText: Array.from(resolvePresentationMode(String(manifest?.locale || release?.locale || '')) === 'assisted'
            ? String(message.displayText || message.text || '')
            : formatVisualNovelDisplayText(String(message.displayText || message.text || '')))
            .slice(sourceSpan.start, sourceSpan.end).join(''),
        sourceSpan,
    });
    if (!sourceStillCurrent || activeSceneContinuityScopeKey !== scopeKey) return;
    completedSceneContinuityPages.set(completedSceneContinuityPageKey(record), { ...record, timelineValidated: true });
    const sameScope = Array.from(completedSceneContinuityPages.values())
        .filter((entry) => entry.scopeKey === scopeKey);
    if (sameScope.length > SCENE_CONTINUITY_LEDGER_LIMIT) {
        const retained = new Set(capSceneContinuityLedgerRecords(sameScope, SCENE_CONTINUITY_LEDGER_LIMIT)
            .map(completedSceneContinuityPageKey));
        for (const [key, entry] of completedSceneContinuityPages) {
            if (entry.scopeKey === scopeKey && !retained.has(key)) completedSceneContinuityPages.delete(key);
        }
    }
    await persistSceneContinuityLedger(scopeKey);
}

async function updateSceneContinuityForVisiblePage(snapshot, message, messageIndex, context, token) {
    const profile = context?.visualProfile;
    recordSceneContinuityDiagnostic('continuity-start');
    if (!profile || token !== visualBundleRequestToken) {
        const reason = !profile ? 'visual-profile-unavailable' : 'request-stale';
        recordSceneContinuityDiagnostic('continuity-skipped', { reason });
        return { state: 'unknown', action: 'preserve', sceneKey: verifiedSceneContinuity.sceneKey };
    }
    const currentScope = {
        chatId: String(snapshot?.fileName || snapshot?.chatId || ''),
        releaseId: String(release?.releaseId || manifest?.releaseId || ''),
        arcId: String(release?.activeArcId || release?.arcId || manifest?.defaultArcId || manifest?.arcId || '') || null,
        catalogId: String(profile.catalogId || ''),
        catalogRevision: profile.catalogRevision,
        catalogHash: String(profile.catalogHash || ''),
    };
    const currentScopeKey = JSON.stringify([
        currentScope.chatId, currentScope.releaseId, currentScope.arcId,
        currentScope.catalogId, currentScope.catalogRevision, currentScope.catalogHash,
    ]);
    if (currentScopeKey !== verifiedSceneContinuity.scopeKey) {
        // Invalidate the old visual identity before inspecting this page's
        // projection. A valid projection in the new scope may then select a
        // scene; an absent or malformed one leaves the new default visible.
        completedSceneContinuityPages.clear();
        sceneContinuityAnalysisCache.clear();
        sceneContinuityHistoryBootstrapController?.abort();
        sceneContinuityHistoryBootstrapController = null;
        sceneContinuityHistoryBootstrapRuns.clear();
        sceneContinuityBootstrapRefreshRuns.clear();
        sceneContinuityLedgerHydratedScopeKey = '';
        if (sceneContinuityAnalysisTask && sceneContinuityAnalysisTask.scopeKey !== currentScopeKey) abortSceneContinuityTask();
        activeSceneContinuityScopeKey = currentScopeKey;
        verifiedSceneContinuity = {
            scope: currentScope, scopeKey: currentScopeKey, sceneKey: null, displayLabel: '',
            messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '',
        };
        clearVerifiedSceneLayer();
    }
    if (activeSceneContinuityScopeKey !== currentScopeKey) activeSceneContinuityScopeKey = currentScopeKey;
    await hydrateSceneContinuityLedger(currentScopeKey);
    if (token !== visualBundleRequestToken || activeSceneContinuityScopeKey !== currentScopeKey) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-scope-stale' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-scope-stale' };
    }

    const activeSegment = activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null;
    const pageIndexForProjection = activeSegmentIndex;
    const pageText = String(activeSegment?.text ?? message?.displayText ?? message?.text ?? '');
    const visibleText = String(message?.displayText || message?.text || '');
    const mode = resolvePresentationMode(String(manifest?.locale || release?.locale || ''));
    const sourceText = Array.from(mode === 'assisted' ? visibleText : formatVisualNovelDisplayText(visibleText));
    const sourceSpan = activeSegment?.sourceSpan
        || { start: 0, end: sourceText.length };
    const messageId = String(message?.index ?? messageIndex);
    const currentCursor = {
        scopeKey: currentScopeKey,
        scope: currentScope,
        messageIndex,
        pageIndex: pageIndexForProjection,
        messageId,
        sourceMessageHash: await createVisibleMessageHash(visibleText),
        pageTextHash: await createVisibleMessageHash(pageText),
        timelinePrefixHash: await createSceneContinuityTimelinePrefixHash(
            snapshot?.messages || [], messageIndex, createVisibleMessageHash,
        ),
        sourceSpan: { start: sourceSpan.start, end: sourceSpan.end },
        sourceVisibleText: visibleText,
        pageText,
    };
    if (token !== visualBundleRequestToken || !currentCursor.timelinePrefixHash
        || !Number.isSafeInteger(sourceSpan.start) || !Number.isSafeInteger(sourceSpan.end)
        || sourceSpan.start < 0 || sourceSpan.end <= sourceSpan.start || sourceSpan.end > sourceText.length
        || sourceText.slice(sourceSpan.start, sourceSpan.end).join('') !== pageText) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-source-invalid' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-source-invalid' };
    }
    const appliedCursor = {
        scopeKey: verifiedSceneContinuity.scopeKey,
        messageIndex: verifiedSceneContinuity.messageIndex,
        pageIndex: verifiedSceneContinuity.pageIndex,
    };
    if (verifiedSceneContinuity.sceneKey
        && verifiedSceneContinuity.scopeKey === currentScopeKey
        && isSceneContinuityCursorStrictlyEarlier(currentCursor, appliedCursor)) {
        verifiedSceneContinuity = {
            scope: currentScope, scopeKey: currentScopeKey, sceneKey: null, displayLabel: '',
            messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '',
        };
        clearVerifiedSceneLayer();
    }

    const sourceRole = message?.role === 'player' ? 'player' : message?.role === 'system' ? 'system' : 'character';
    if (sourceRole !== 'character') {
        // Scene classification describes the assistant-authored visible page.
        // A player/system message may carry stale or injected metadata, but it
        // must neither trigger analysis nor consume that projection. A prior
        // assistant scene can still be restored from the validated continuity
        // ledger after reload/reset; this reuses evidence from the earlier
        // assistant page and never classifies the player/system text.
        const earlierCompletedPage = await findEarlierCompletedScenePage(snapshot, currentCursor, {
            allowHistoryBootstrap: true,
            token,
        });
        if (token !== visualBundleRequestToken) {
            recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'request-stale' });
            return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'request-stale' };
        }
        if (earlierCompletedPage) {
            const restored = sceneContinuityRestoreResult(earlierCompletedPage, token);
            recordSceneContinuityDiagnostic('continuity-cache-hit', {
                state: 'restored',
                action: restored.action,
                reason: 'non-character-page-uses-earlier-verified-scene',
            });
            return restored;
        }
        activeSceneContinuityToken = token;
        activeSceneContinuityAction = 'preserve';
        recordSceneContinuityDiagnostic('continuity-skipped', { action: 'preserve', reason: 'non-character-source' });
        return {
            state: 'unknown',
            action: 'preserve',
            sceneKey: verifiedSceneContinuity.sceneKey,
            reasonCode: 'non-character-source',
            visualHint: null,
        };
    }

    await waitForEarlierSceneContinuityTask(currentCursor);
    if (token !== visualBundleRequestToken) return { state: 'unknown', action: 'preserve', sceneKey: null };
    const earlierCompletedPage = await findEarlierCompletedScenePage(snapshot, currentCursor, {
        allowHistoryBootstrap: true,
        token,
    });
    if (token !== visualBundleRequestToken) return { state: 'unknown', action: 'preserve', sceneKey: null };
    currentCursor.lineageFingerprint = sceneContinuityPreviousSourceKey(earlierCompletedPage);
    const currentCompletedPage = await findCompletedScenePageAtCursor(snapshot, currentCursor);
    if (token !== visualBundleRequestToken) return { state: 'unknown', action: 'preserve', sceneKey: null };
    if (currentCompletedPage) {
        const currentPageStillValid = await scenePageStillInCurrentTimeline({
            snapshot, message, messageIndex, currentScope, currentCursor, pageText, sourceSpan,
        });
        const currentLineageStillValid = currentPageStillValid
            && await sceneContinuityPreviousLineageStillCurrent(snapshot, currentCursor, earlierCompletedPage);
        const validatedCurrentCursor = currentPageStillValid && {
            ...currentPageStillValid,
            lineageFingerprint: currentCursor.lineageFingerprint,
            timelineValidated: true,
        };
        const persistedResultCursor = { ...currentCompletedPage, timelineValidated: true };
        if (!currentLineageStillValid || token !== visualBundleRequestToken || !canApplySceneContinuityPageResult({
            resultToken: token,
            currentToken: visualBundleRequestToken,
            resultCursor: persistedResultCursor,
            currentCursor: validatedCurrentCursor,
        })) {
            recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-current-cache-stale' });
            return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-current-cache-stale' };
        }
        recordSceneContinuityDiagnostic('continuity-cache-hit', { state: 'restored', action: 'preserve' });
        return sceneContinuityRestoreResult(currentCompletedPage, token, { currentPage: true });
    }
    if (!earlierCompletedPage && verifiedSceneContinuity.sceneKey
        && verifiedSceneContinuity.scopeKey === currentScopeKey
        && isSceneContinuityCursorStrictlyEarlier({
            scopeKey: verifiedSceneContinuity.scopeKey,
            messageIndex: verifiedSceneContinuity.messageIndex,
            pageIndex: verifiedSceneContinuity.pageIndex,
        }, currentCursor)) {
        verifiedSceneContinuity = {
            scope: currentScope, scopeKey: currentScopeKey, sceneKey: null, displayLabel: '',
            messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '',
        };
        clearVerifiedSceneLayer();
    }
    const previousScene = earlierCompletedPage
        ? {
            sceneKey: earlierCompletedPage.sceneKey,
            displayLabel: earlierCompletedPage.displayLabel,
            visualHint: earlierCompletedPage.visualHint,
        }
        : null;
    const pageProjections = message?.sceneContinuityByPage;
    const pageProjection = Array.isArray(pageProjections)
        ? pageProjections[pageIndexForProjection]
        : pageProjections?.[pageIndexForProjection];
    const suppliedProjection = activeSegment?.sceneContinuityProjection
        || pageProjection
        || (message?.sceneContinuityProjection?.segment?.pageIndex === pageIndexForProjection
            ? message.sceneContinuityProjection
            : null);
    const testProjectionFactory = globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__
        ? globalThis.__GALGAME_TEST_SCENE_CONTINUITY_FACTORY__
        : null;
    const testProjection = !suppliedProjection && typeof testProjectionFactory === 'function'
        ? await testProjectionFactory({
            pageText,
            scope: currentScope,
            messageId,
            pageIndex: pageIndexForProjection,
            previousVerifiedSceneKey: previousScene?.sceneKey || null,
        })
        : null;
    let projection = suppliedProjection || testProjection;
    let visualHint = null;
    if (!projection && token === visualBundleRequestToken) {
        const controller = new AbortController();
        sceneContinuityAnalysisController = controller;
        let resolveFlight;
        const flight = {
            scopeKey: currentScopeKey,
            scope: currentScope,
            cursor: currentCursor,
            controller,
            promise: new Promise((resolve) => { resolveFlight = resolve; }),
            resolve: null,
        };
        flight.resolve = resolveFlight;
        sceneContinuityAnalysisTask = flight;
        try {
            const health = await presentationAnalysis.healthCheck(controller.signal);
            if (controller.signal.aborted || token !== visualBundleRequestToken) {
                recordSceneContinuityDiagnostic('continuity-skipped', {
                    reason: controller.signal.aborted ? 'health-check-aborted' : 'request-stale',
                });
                return { state: 'unknown', action: 'preserve', sceneKey: previousScene?.sceneKey || null };
            }
            if (health?.serviceReady === true && health?.analyzerConfigured === true && !controller.signal.aborted) {
                recordSceneContinuityDiagnostic('analyzer-ready');
                presentationAnalyzerScope = String(health.analyzerScope || 'configured');
                const contextPages = activeSegment
                    ? activeMessageSegments.slice(Math.max(0, pageIndexForProjection - 2), pageIndexForProjection)
                        .map((segment) => ({ pageText: String(segment.text || '') }))
                    : [];
                const analysisRequest = await createSceneContinuityAnalysisRequest({
                    sourceRole,
                    scope: currentScope,
                    messageId,
                    pageIndex: pageIndexForProjection,
                    pageText,
                    contextPages,
                    previousScene,
                });
                const cacheKey = await createSceneContinuityAnalysisCacheKey({
                    request: analysisRequest,
                    analyzerScope: health.sceneAnalyzerScope || '',
                    promptVersion: health.sceneAnalyzerScope || '',
                });
                let cached = sceneContinuityAnalysisCache.get(cacheKey);
                if (!cached) {
                    const analysis = await presentationAnalysis.analyzeSceneContinuity({
                        request: analysisRequest,
                        signal: controller.signal,
                    });
                    cached = await buildSceneContinuityProjectionFromAnalysis(analysis);
                    const pageStillCurrent = !controller.signal.aborted && await scenePageStillInCurrentTimeline({
                        snapshot, message, messageIndex, currentScope, currentCursor, pageText, sourceSpan,
                    });
                    const projectionBound = isSceneContinuityProjectionBoundToCursor(cached?.projection, currentCursor);
                    const previousLineageStillCurrent = pageStillCurrent && projectionBound
                        && await sceneContinuityPreviousLineageStillCurrent(snapshot, currentCursor, earlierCompletedPage);
                    if (pageStillCurrent && projectionBound && previousLineageStillCurrent) {
                        sceneContinuityAnalysisCache.set(cacheKey, cached);
                        while (sceneContinuityAnalysisCache.size > 128) {
                            sceneContinuityAnalysisCache.delete(sceneContinuityAnalysisCache.keys().next().value);
                        }
                        const completedPageResult = await consumeSceneContinuityProjection({
                            pageText,
                            projection: cached.projection,
                            expectedScope: currentScope,
                            previousScope: currentScope,
                            previousVerifiedSceneKey: previousScene?.sceneKey || null,
                        });
                        const completedPageLabel = cached.visualHint?.displayLabel
                            || extractCurrentSceneLabelFromProjection(pageText, cached.projection)
                            || previousScene?.displayLabel
                            || '';
                        if (hasCompletedSceneContinuityEvidence(completedPageResult, cached.projection) && completedPageLabel) {
                            await rememberCompletedScenePage({
                                scopeKey: currentScopeKey,
                                scope: currentScope,
                                snapshot,
                                message,
                                messageIndex,
                                pageIndex: pageIndexForProjection,
                                sourceSpan,
                                sceneLocationSpan: sceneLocationSourceSpan(pageText, cached.projection, sourceSpan, completedPageResult.sceneKey),
                                sourceMessageHash: currentCursor.sourceMessageHash,
                                pageTextHash: currentCursor.pageTextHash,
                                timelinePrefixHash: currentCursor.timelinePrefixHash,
                                lineageFingerprint: currentCursor.lineageFingerprint,
                                sceneKey: completedPageResult.sceneKey,
                                displayLabel: completedPageLabel,
                                visualHint: cached.visualHint || previousScene?.visualHint,
                            });
                        }
                    }
                }
                if (controller.signal.aborted || token !== visualBundleRequestToken) {
                    recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'analysis-aborted' });
                    return { state: 'unknown', action: 'preserve', sceneKey: previousScene?.sceneKey || null };
                }
                projection = cached.projection;
                visualHint = cached.visualHint;
            } else {
                recordSceneContinuityDiagnostic('continuity-skipped', {
                    reason: health?.diagnosticCode || 'analyzer-not-ready',
                });
            }
        } catch (error) {
            if (error?.code === 'ABORTED' || controller.signal.aborted) {
                recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'analysis-aborted' });
                return { state: 'unknown', action: 'preserve', sceneKey: previousScene?.sceneKey || null };
            }
            const diagnosticCode = typeof error?.code === 'string'
                ? error.code
                : typeof error?.name === 'string' ? error.name : 'analysis-failed';
            const diagnosticStatus = Number.isInteger(error?.status) ? `http${error.status}` : '';
            const transportFailure = typeof error?.transportFailure === 'string' ? error.transportFailure : '';
            recordSceneContinuityDiagnostic('continuity-skipped', {
                reason: [diagnosticCode, diagnosticStatus, transportFailure].filter(Boolean).join('_'),
            });
            // Visual analysis is optional; an unavailable or invalid result
            // keeps the current verified scene and never affects story text.
        } finally {
            finishSceneContinuityTask(flight);
        }
    }
    const projectionBound = isSceneContinuityProjectionBoundToCursor(projection, currentCursor);
    const previousLineageStillCurrent = await sceneContinuityPreviousLineageStillCurrent(snapshot, currentCursor, earlierCompletedPage);
    const validatedRequestCursor = await scenePageStillInCurrentTimeline({
        snapshot, message, messageIndex, currentScope, currentCursor, pageText, sourceSpan,
    });
    if (!previousLineageStillCurrent || !validatedRequestCursor || token !== visualBundleRequestToken) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-lineage-stale' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-lineage-stale' };
    }
    const resultCursor = {
        ...currentCursor,
        lineageFingerprint: currentCursor.lineageFingerprint,
        timelineValidated: true,
    };
    const initialLiveCursor = {
        ...validatedRequestCursor,
        lineageFingerprint: sceneContinuityPreviousSourceKey(earlierCompletedPage),
        timelineValidated: true,
    };
    if (!canApplySceneContinuityPageResult({
        resultToken: token,
        currentToken: visualBundleRequestToken,
        resultCursor,
        currentCursor: initialLiveCursor,
    })) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-current-gate-rejected' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-current-gate-rejected' };
    }
    if (!projectionBound || !projection) {
        if (earlierCompletedPage) {
            recordSceneContinuityDiagnostic('continuity-cache-hit', { state: 'restored', action: 'preserve' });
            return sceneContinuityRestoreResult(earlierCompletedPage, token);
        }
        activeSceneContinuityToken = token;
        activeSceneContinuityAction = 'preserve';
        recordSceneContinuityDiagnostic('continuity-skipped', { action: 'preserve', reason: 'scene-source-gate-rejected' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-source-gate-rejected' };
    }
    const result = await consumeSceneContinuityProjection({
        pageText,
        projection,
        expectedScope: currentScope,
        previousScope: currentScope,
        previousVerifiedSceneKey: previousScene?.sceneKey || null,
    });
    const validatedCurrentCursor = await scenePageStillInCurrentTimeline({
        snapshot: activeChatSnapshot,
        message: activeChatSnapshot?.messages?.[messageIndex],
        messageIndex,
        currentScope,
        currentCursor: resultCursor,
        pageText,
        sourceSpan,
    });
    const latestEarlier = validatedCurrentCursor
        ? await findEarlierCompletedScenePage(activeChatSnapshot, resultCursor)
        : null;
    const validatedLiveCursor = validatedCurrentCursor && {
        ...validatedCurrentCursor,
        lineageFingerprint: sceneContinuityPreviousSourceKey(latestEarlier),
        timelineValidated: true,
    };
    if (!validatedLiveCursor || token !== visualBundleRequestToken) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-lineage-stale' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-lineage-stale' };
    }
    if (!canApplySceneContinuityPageResult({
        resultToken: token,
        currentToken: visualBundleRequestToken,
        resultCursor,
        currentCursor: validatedLiveCursor,
    })) {
        recordSceneContinuityDiagnostic('continuity-skipped', { reason: 'scene-current-gate-rejected' });
        return { state: 'unknown', action: 'preserve', sceneKey: null, reasonCode: 'scene-current-gate-rejected' };
    }
    if (result.state === 'unknown' || !result.sceneKey) {
        if (earlierCompletedPage) {
            recordSceneContinuityDiagnostic('continuity-cache-hit', { state: 'restored', action: 'preserve' });
            return sceneContinuityRestoreResult(earlierCompletedPage, token);
        }
        activeSceneContinuityToken = token;
        activeSceneContinuityAction = 'preserve';
        recordSceneContinuityDiagnostic('continuity-result', {
            state: result.state,
            action: 'preserve',
            reason: result.reasonCode || 'scene-unknown',
        });
        return { ...result, action: 'preserve', sceneKey: null };
    }
    const restoreEarlierSceneAsset = result.state === 'continued'
        && previousScene?.visualHint?.entityType === 'scene'
        && (verifiedSceneContinuity.sceneKey !== result.sceneKey
            || !coreVisualHasVerifiedBackground
            || !ui.stageBackdrop?.dataset.visualAssetIdentity);
    activeSceneContinuityToken = token;
    activeSceneContinuityAction = result.action === 'clear-before-match' || restoreEarlierSceneAsset ? 'changed' : 'preserve';
    recordSceneContinuityDiagnostic('continuity-result', {
        state: result.state,
        action: activeSceneContinuityAction,
        reason: result.reasonCode || (restoreEarlierSceneAsset ? 'restore-verified-scene' : ''),
    });
    if (result.action === 'clear-before-match') {
        verifiedSceneContinuity.sceneKey = result.sceneKey;
        verifiedSceneContinuity.displayLabel = visualHint?.displayLabel || extractCurrentSceneLabelFromProjection(pageText, projection);
        Object.assign(verifiedSceneContinuity, {
            messageIndex, pageIndex: pageIndexForProjection, messageId,
            sourceMessageHash: currentCursor.sourceMessageHash,
        });
        clearVerifiedSceneLayer();
    } else if (result.state === 'continued') {
        verifiedSceneContinuity.sceneKey = result.sceneKey;
        verifiedSceneContinuity.displayLabel = previousScene?.displayLabel
            || verifiedSceneContinuity.displayLabel
            || visualHint?.displayLabel
            || extractCurrentSceneLabelFromProjection(pageText, projection);
        Object.assign(verifiedSceneContinuity, {
            scope: currentScope, scopeKey: currentScopeKey,
            messageIndex, pageIndex: pageIndexForProjection, messageId,
            sourceMessageHash: currentCursor.sourceMessageHash,
        });
        if (restoreEarlierSceneAsset) clearVerifiedSceneLayer();
    } else if (result.sceneKey && previousScene?.displayLabel) {
        verifiedSceneContinuity = {
            scope: currentScope, scopeKey: currentScopeKey,
            sceneKey: result.sceneKey, displayLabel: previousScene.displayLabel,
            messageIndex, pageIndex: pageIndexForProjection, messageId,
            sourceMessageHash: currentCursor.sourceMessageHash,
        };
    }
    if (result.sceneKey && (verifiedSceneContinuity.displayLabel || previousScene?.displayLabel)) {
        await rememberCompletedScenePage({
            scopeKey: currentScopeKey,
            scope: currentScope,
            snapshot,
            message,
            messageIndex,
            pageIndex: pageIndexForProjection,
            sourceSpan,
            sceneLocationSpan: sceneLocationSourceSpan(pageText, projection, sourceSpan, result.sceneKey),
            sourceMessageHash: currentCursor.sourceMessageHash,
            pageTextHash: currentCursor.pageTextHash,
            timelinePrefixHash: currentCursor.timelinePrefixHash,
            lineageFingerprint: currentCursor.lineageFingerprint,
            sceneKey: result.sceneKey,
            displayLabel: verifiedSceneContinuity.displayLabel || previousScene.displayLabel,
            visualHint: visualHint || previousScene?.visualHint,
        });
    }
    return {
        ...result,
        action: restoreEarlierSceneAsset ? 'clear-before-match' : result.action,
        visualHint: restoreEarlierSceneAsset
            ? previousScene.visualHint
            : result.action === 'clear-before-match' ? visualHint || createTestSceneHint(pageText, projection) : null,
    };
}

function extractCurrentSceneLabelFromProjection(pageText, projection) {
    const span = projection?.evidenceSpans?.find((item) => item.relation === 'current-location');
    return span ? String(pageText).slice(span.start, span.end).trim().slice(0, 80) : '';
}

function createTestSceneHint(pageText, projection) {
    if (!globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__) return null;
    const displayLabel = extractCurrentSceneLabelFromProjection(pageText, projection);
    if (!displayLabel) return null;
    return {
        entityKeySeed: `test-validated-scene:${projection.currentSceneKey}`,
        entityType: 'scene',
        displayLabel,
        visibleAttributes: [{ code: 'scene-location-kind', value: displayLabel, confidenceBand: 'explicit' }],
        confidenceBand: 'explicit',
    };
}

function clearVerifiedSceneLayer() {
    coreVisualPresentationState.delete('scene');
    coreVisualPresentationDetails.delete('scene');
    restoreDefaultBackgroundLayer();
}

async function renderCoreVisualGroupScene(snapshot, messageIndex, page, token) {
    try {
        const baseUrl = getCoreVisualServiceUrl();
        const message = snapshot?.messages?.[messageIndex];
        if (!baseUrl || !message || token !== visualBundleRequestToken) return;
        const context = await readCoreVisualContext(baseUrl);
        if (!context?.enabled || !context.visualProfile || token !== visualBundleRequestToken) return;
        const sceneContinuity = await updateSceneContinuityForVisiblePage(snapshot, message, messageIndex, context, token);
        if (token !== visualBundleRequestToken) return;
        const request = await createCoreVisualDecisionRequest({
            snapshot,
            message,
            messageIndex,
            visualProfile: context.visualProfile,
            sceneContinuity,
            segmentOverride: {
                type: 'narration',
                role: 'system',
                speaker: '多人对话',
                text: page.text,
                sourceText: page.text,
                sourceSpan: page.sourceSpan,
            },
        });
        const response = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!response.ok || token !== visualBundleRequestToken) return;
        const body = await response.json();
        if (body?.schemaVersion !== CORE_VISUAL_DECISION_RESPONSE_VERSION || body.ok !== true
            || body.projectionId !== request.projection.projectionId
            || body.projectionHash !== request.projection.projectionHash
            || body.sourceMessageHash !== request.projection.sourceMessageHash
            || body.catalogHash !== context.visualProfile.catalogHash || !Array.isArray(body.decisions)) return;
        const scene = body.decisions.find((item) => item.entityType === 'scene');
        if (activeSceneContinuityToken === token && activeSceneContinuityAction === 'changed'
            && hasValidatedSceneDecisionInput(request)
            && scene && isRenderableCoreVisualDecision(scene, 'scene', request, body)) {
            coreVisualPresentationState.set('scene', scene);
            await applyCoreVisualBackground(scene, baseUrl, token);
        }
        const equipment = body.decisions.filter((item) => ['equipment', 'item', 'skill'].includes(item.entityType));
        if (equipment.length) await applyCoreVisualIcons(new Map(equipment.map((item) => [item.entityType, item])), baseUrl, token);
    } catch (_error) {
        // Group-page scene matching is best-effort and cannot block playback.
    }
}

function clearPresentationCarousel() {
    if (presentationCarouselTimer !== null) {
        clearInterval(presentationCarouselTimer);
        presentationCarouselTimer = null;
    }
    presentationCarouselEpoch += 1;
}

async function renderPresentationPageCarousel(snapshot, messageIndex, page, requestToken) {
    const carouselEpoch = presentationCarouselEpoch;
    try {
        const baseUrl = getCoreVisualServiceUrl();
        if (!baseUrl || !manifest || requestToken !== visualBundleRequestToken) return;
        const context = coreVisualAvailability.context || await readCoreVisualContext(baseUrl);
        const profile = context?.visualProfile;
        if (!profile || requestToken !== visualBundleRequestToken || carouselEpoch !== presentationCarouselEpoch) return;
        const message = snapshot?.messages?.[messageIndex];
        if (!message) return;
        const arcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || '';
        const releaseId = release?.releaseId || manifest?.releaseId || 'release_core_unknown';
        const chatId = snapshot?.fileName || snapshot?.chatId || '';
        const entries = [];

        for (const candidate of page.speakerCandidates || []) {
            if (requestToken !== visualBundleRequestToken || carouselEpoch !== presentationCarouselEpoch) return;
            const identityRef = candidate.identityRef;
            const identitySeed = identityRef?.type && identityRef.type !== 'unknown' && identityRef.id
                ? `identity:${identityRef.type}:${identityRef.id}`
                : '';
            if (!identitySeed || !candidate.speaker) continue;
            const binding = resolveVisualCharacterBinding(manifest, {
                name: candidate.speaker,
                role: 'character',
                arcId,
                allowCharacterPoolFallback: false,
            });
            let decision = null;
            if (binding?.assetId && Number.isSafeInteger(Number(binding.assetVersion || 1))) {
                const assetVersion = Number(binding.assetVersion || 1);
                const channelValid = context.characterChannels?.some((entry) => entry.assetId === binding.assetId
                    && entry.assetVersion === assetVersion && entry.channel === 'character');
                if (!channelValid || ['player', 'narrator', 'system'].includes(binding.channel)) continue;
                const entityKey = await createCoreVisualDisplayEntityKey('character', identitySeed);
                if (!reservePresentationPortraitBinding(entityKey, `${binding.assetId}:${assetVersion}`, { chatId, releaseId })) continue;
                decision = {
                    entityKey,
                    entityType: 'character',
                    assetId: binding.assetId,
                    assetVersion,
                    contentPath: `/v1/core/catalogs/${profile.catalogId}/${profile.catalogRevision}/assets/${binding.assetId}/${assetVersion}/content`,
                };
            } else {
                const sourceSegment = (page.segments || []).find((segment) => identityKeyForPlayer(segment.identityRef) === identityKeyForPlayer(identityRef));
                if (!sourceSegment || !sourceSegment.sourceSpan || !sourceSegment.sourceText) continue;
                const segmentOverride = {
                    ...sourceSegment,
                    speaker: candidate.speaker,
                    identityRef,
                    role: 'character',
                    text: candidate.sourceText || sourceSegment.sourceText,
                    sourceText: candidate.sourceText || sourceSegment.sourceText,
                    sourceMessageIndex: candidate.sourceMessageIndex ?? messageIndex,
                    sourceMessageHash: candidate.sourceMessageHash || sourceSegment.sourceMessageHash || '',
                };
                const request = await createCoreVisualDecisionRequest({
                    snapshot,
                    message,
                    messageIndex,
                    visualProfile: profile,
                    segmentOverride,
                });
                const response = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
                    method: 'POST',
                    credentials: 'omit',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(request),
                });
                if (!response.ok) continue;
                const body = await response.json();
                if (body?.schemaVersion !== CORE_VISUAL_DECISION_RESPONSE_VERSION || body.ok !== true
                    || body.projectionId !== request.projection.projectionId
                    || body.projectionHash !== request.projection.projectionHash
                    || body.sourceMessageHash !== request.projection.sourceMessageHash
                    || body.catalogHash !== profile.catalogHash || !Array.isArray(body.decisions)) continue;
                const entity = request.projection.entities.find((item) => item.entityType === 'character');
                const match = body.decisions.find((item) => item.entityType === 'character' && item.entityKey === entity?.entityKey);
                if (!entity || !isRenderableCoreVisualDecision(match, 'character', request, body)
                    || !reservePresentationPortrait(match, request)) continue;
                decision = match;
            }

            if (requestToken !== visualBundleRequestToken || carouselEpoch !== presentationCarouselEpoch) return;
            if (!decision) continue;
            const sourceUrl = createCoreVisualContentUrl(decision, baseUrl);
            if (!sourceUrl || !(await resolveVisualRenderUrl(sourceUrl))) continue;
            entries.push({ identityKey: identityKeyForPlayer(identityRef), decision });
        }

        if (requestToken !== visualBundleRequestToken || carouselEpoch !== presentationCarouselEpoch) return;
        if (entries.length < 2) {
            applyCoreVisualPlaceholderCharacter('group');
            return;
        }
        let index = 0;
        const showCurrent = () => {
            if (requestToken !== visualBundleRequestToken || carouselEpoch !== presentationCarouselEpoch) return;
            void applyCoreVisualCharacter(entries[index].decision, baseUrl, requestToken);
            index = (index + 1) % entries.length;
        };
        showCurrent();
        presentationCarouselTimer = setInterval(showCurrent, 3000);
    } catch (_error) {
        if (requestToken === visualBundleRequestToken && carouselEpoch === presentationCarouselEpoch) {
            applyCoreVisualPlaceholderCharacter('group');
        }
    }
}

function identityKeyForPlayer(identityRef) {
    return identityRef?.type && identityRef.type !== 'unknown' && identityRef.id
        ? `${identityRef.type}:${identityRef.id}`
        : '';
}

function getActiveVisualSpeakerContext(message, messageIndex, segmentOverride = null) {
    const activeSegment = segmentOverride || (activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null);
    if (activeSegment?.type === 'dialogue-group') {
        return { role: 'group', speaker: '多人对话' };
    }
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
    if (activeSegment.type === 'unattributed-dialogue' || activeSegment.identityRef?.type === 'unknown') {
        return { role: 'system', speaker: '未识别' };
    }
    if (!['dialogue', 'narration', 'player', 'system'].includes(activeSegment.type)) {
        return { role: 'system', speaker: '' };
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
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: !baseUrl ? 'service-unavailable' : !manifest ? 'manifest-unavailable' : 'request-stale' });
            return;
        }
        const context = coreVisualAvailability.context || await readCoreVisualContext(baseUrl);
        const profile = context?.visualProfile;
        if (!profile || token !== visualBundleRequestToken) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: !profile ? 'visual-profile-unavailable' : 'request-stale' });
            return;
        }
        const message = snapshot?.messages?.[messageIndex];
        if (!message) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'visible-message-unavailable' });
            return;
        }
        const speakerContext = getActiveVisualSpeakerContext(message, messageIndex);
        if (!['character', 'narrator', 'player'].includes(speakerContext.role)) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'visual-role-unavailable' });
            return;
        }
        const arcId = release?.activeArcId || release?.arcId || manifest?.defaultArcId || '';
        const binding = resolveVisualCharacterBinding(manifest, {
            name: speakerContext.speaker,
            role: speakerContext.role,
            arcId,
            allowCharacterPoolFallback: false,
        });
        if (speakerContext.role === 'narrator' && binding?.channel !== 'narrator') {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'narrator-binding-unavailable' });
            return;
        }
        if (speakerContext.role === 'player' && binding?.channel !== 'player') {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'player-binding-unavailable' });
            return;
        }
        if (speakerContext.role === 'character' && ['narrator', 'player'].includes(binding?.channel)) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'character-channel-mismatch' });
            return;
        }
        const assetVersion = Number(binding?.assetVersion || 0);
        if (!binding?.assetId || !Number.isSafeInteger(assetVersion) || assetVersion <= 0) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'asset-binding-invalid' });
            return;
        }
        const requiredChannel = speakerContext.role === 'character' ? 'character' : speakerContext.role;
        if (!context.characterChannels.some((entry) => (
            entry.assetId === binding.assetId
            && entry.assetVersion === assetVersion
            && entry.channel === requiredChannel
        ))) {
            recordSceneContinuityDiagnostic('portrait-skipped', { reason: 'asset-channel-unavailable' });
            return;
        }
        const activeSegment = activeRenderContext && activeMessageIndex === messageIndex
            ? activeMessageSegments[activeSegmentIndex]
            : null;
        const identitySeed = activeSegment?.identityRef?.type && activeSegment.identityRef.type !== 'unknown'
            ? `identity:${activeSegment.identityRef.type}:${activeSegment.identityRef.id}`
            : `active-speaker:${speakerContext.speaker}`;
        const entityKey = await createCoreVisualDisplayEntityKey('character', identitySeed);
        const portraitScope = {
            chatId: snapshot?.fileName || snapshot?.chatId || '',
            releaseId: release?.releaseId || 'release_core_unknown',
        };
        if (speakerContext.role === 'character'
            && !reservePresentationPortraitBinding(entityKey, `${binding.assetId}:${assetVersion}`, portraitScope)) return;
        const decision = {
            entityType: 'character',
            assetId: binding.assetId,
            assetVersion,
            contentPath: `/v1/core/catalogs/${profile.catalogId}/${profile.catalogRevision}/assets/${binding.assetId}/${assetVersion}/content`,
        };
        immediateVisualCharacterIdentity = `${decision.assetId}:${decision.assetVersion}`;
        recordSceneContinuityDiagnostic('portrait-load-started');
        await applyCoreVisualCharacter(decision, baseUrl, token);
        const appliedIdentity = decision.assetId + ':' + assetVersion;
        recordSceneContinuityDiagnostic(
            ui.stageHeroine?.dataset.visualAssetIdentity === appliedIdentity
                ? 'portrait-load-succeeded'
                : 'portrait-load-failed',
            { reason: ui.stageHeroine?.dataset.visualAssetIdentity === appliedIdentity ? '' : 'asset-bytes-unavailable' },
        );
    } catch (_error) {
        recordSceneContinuityDiagnostic('portrait-load-failed', { reason: 'visual-request-failed' });
        // The validated remote request remains the authority if local binding
        // cannot be applied (for example while reconnecting to the service).
    }
}

function resetVisualPresentation() {
    clearPresentationCarousel();
    visualBundleRequestToken += 1;
    abortSceneContinuityTask();
    sceneContinuityHistoryBootstrapController?.abort();
    sceneContinuityHistoryBootstrapController = null;
    sceneContinuityHistoryBootstrapRuns.clear();
    sceneContinuityBootstrapRefreshRuns.clear();
    visualBundleRefreshTasks.clear();
    completedSceneContinuityPages.clear();
    sceneContinuityAnalysisCache.clear();
    activeSceneContinuityScopeKey = '';
    sceneContinuityLedgerHydratedScopeKey = '';
    sceneContinuityLedgerHydration = null;
    coreVisualHasVerifiedPresentation = false;
    coreVisualHasVerifiedBackground = false;
    immediateVisualCharacterIdentity = '';
    coreVisualPresentationState.clear();
    coreVisualPresentationDetails.clear();
    verifiedSceneContinuity = {
        scope: null, scopeKey: '', sceneKey: null, displayLabel: '',
        messageIndex: null, pageIndex: null, messageId: '', sourceMessageHash: '',
    };
    activeSceneContinuityAction = 'preserve';
    activeSceneContinuityToken = 0;
    restoreDefaultVisualLayers();
    ui.visualIconStrip?.replaceChildren();
    setVisualStatus('');
}

function renderCoreVisualFallback({ preserveVerified = false, preserveVerifiedBackground = false, role = 'character' } = {}) {
    if (preserveVerified && coreVisualHasVerifiedPresentation) {
        return;
    }
    // Keep the authored stage background visible when runtime matching is
    // unavailable. It is a scenario-owned default, so it cannot be confused
    // with a stale remote match. Character roles still use role-specific
    // neutral placeholders until a validated bound portrait is available.
    // A scene usually persists across several dialogue messages. Keep the
    // last verified scene while the next asynchronous decision is unknown or
    // temporarily unavailable; only use the authored default before the
    // first scene has loaded or after a full stage reset.
    if (!preserveVerifiedBackground || !coreVisualHasVerifiedBackground || !ui.stageBackdrop?.dataset.visualAssetIdentity) {
        restoreDefaultBackgroundLayer();
    }
    if (!immediateVisualCharacterIdentity || ui.stageHeroine?.dataset.visualAssetIdentity !== immediateVisualCharacterIdentity) {
        applyCoreVisualPlaceholderCharacter(role);
    }
    const hasVerifiedIconLayer = Array.from(ui.visualIconStrip?.children || [])
        .some((icon) => icon?.classList?.contains?.('is-visual-active')
            || String(icon?.className || '').split(/\s+/u).includes('is-visual-active'));
    if (!(preserveVerifiedBackground && hasVerifiedIconLayer)) {
        renderCoreVisualIconStrip();
    }
    coreVisualHasVerifiedPresentation = false;
    setVisualStatus('');
}

function getCoreVisualPlaceholderUrl(role = 'character') {
    if (role === 'player') return CORE_PLAYER_PLACEHOLDER_URL;
    if (role === 'narrator' || role === 'system') return CORE_NARRATOR_PLACEHOLDER_URL;
    return CORE_VISUAL_PLACEHOLDER_URL;
}

async function renderCoreVisualPresentation(snapshot, messageIndex, token) {
    if (token !== visualBundleRequestToken) return;
    const visualRole = getActiveVisualSpeakerContext(snapshot?.messages?.[messageIndex], messageIndex).role;
    recordSceneContinuityDiagnostic('visual-decision-started', { state: 'started' });
    try {
        const baseUrl = getCoreVisualServiceUrl();
        if (!baseUrl) {
            recordSceneContinuityDiagnostic('visual-decision-skipped', { reason: 'service-url-empty' });
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            return;
        }
        const context = await readCoreVisualContext(baseUrl);
        if (token !== visualBundleRequestToken) return;
        if (!context?.enabled || !context.visualProfile) {
            recordSceneContinuityDiagnostic('visual-decision-skipped', {
                reason: coreVisualAvailability.reasonCode || 'visual-context-disabled',
            });
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            return;
        }
        const message = snapshot?.messages?.[messageIndex];
        if (!message) {
            recordSceneContinuityDiagnostic('visual-decision-skipped', { reason: 'visible-message-missing' });
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            return;
        }
        const sceneContinuity = await updateSceneContinuityForVisiblePage(snapshot, message, messageIndex, context, token);
        if (token !== visualBundleRequestToken) return;
        const request = await createCoreVisualDecisionRequest({
            snapshot,
            message,
            messageIndex,
            visualProfile: context.visualProfile,
            sceneContinuity,
        });
        if (token !== visualBundleRequestToken) return;
        const requestBody = JSON.stringify(request);
        const requestBytes = new TextEncoder().encode(requestBody).byteLength;
        recordSceneContinuityDiagnostic('visual-decision-request', {
            state: request.projection.entities.some((entity) => entity.entityType === 'scene') ? 'scene-hint' : 'no-scene-hint',
            action: activeSceneContinuityAction,
            reason: `bytes${requestBytes}`,
        });
        const response = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
            method: 'POST',
            credentials: 'omit',
            headers: { 'content-type': 'application/json' },
            body: requestBody,
        });
        if (token !== visualBundleRequestToken) {
            return;
        }
        if (!response.ok) {
            let rejectionCode = `http${response.status}`;
            try {
                const errorBody = await response.clone().json();
                rejectionCode = errorBody?.error?.code || errorBody?.errorCode || errorBody?.code || rejectionCode;
            } catch {
                // Preserve the status-only diagnostic when the service has no JSON error contract.
            }
            recordSceneContinuityDiagnostic('visual-decision-response', { state: 'http-failed', reason: rejectionCode });
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_REJECTED');
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            setVisualStatus('');
            return;
        }
        const body = await response.json();
        if (token !== visualBundleRequestToken) return;
        if (body?.schemaVersion !== CORE_VISUAL_DECISION_RESPONSE_VERSION) {
            recordSceneContinuityDiagnostic('visual-decision-response', { state: 'invalid', reason: 'schema-mismatch' });
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            setVisualStatus('');
            return;
        }
        if (body.ok !== true) {
            recordSceneContinuityDiagnostic('visual-decision-response', {
                state: 'rejected', reason: body?.error?.code || 'response-not-ok',
            });
            markCoreVisualUnavailable(body?.error?.code || 'VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            setVisualStatus('');
            return;
        }
        if (!Array.isArray(body.decisions)) {
            recordSceneContinuityDiagnostic('visual-decision-response', { state: 'invalid', reason: 'decisions-missing' });
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_INVALID_RESPONSE');
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
            setVisualStatus('');
            return;
        }
        await renderCoreVisualDecisions(body.decisions, baseUrl, token, request, body);
    } catch (_error) {
        if (token === visualBundleRequestToken) {
            recordSceneContinuityDiagnostic('visual-decision-failed', {
                reason: _error?.code || _error?.name || 'visual-decision-error',
            });
            markCoreVisualUnavailable('VISUAL_CORE_SERVICE_UNAVAILABLE');
            renderCoreVisualFallback({ preserveVerified: false, preserveVerifiedBackground: true, role: visualRole });
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
    const expectedKeys = ['ok', 'schemaVersion', 'enabled', 'activeCatalog', 'characterChannels', 'visualProfile', 'source', 'sourceVersion', 'contextHash'];
    if (Object.keys(body).sort().join(',') !== expectedKeys.sort().join(',')) return false;
    if (body.ok !== true || body.schemaVersion !== CORE_VISUAL_CONTEXT_RESPONSE_VERSION || typeof body.enabled !== 'boolean') return false;
    if (body.source !== 'visual-control' || body.sourceVersion !== 'galgame.visual-control.v1' || !/^sha256:[a-f0-9]{64}$/.test(body.contextHash)) return false;
    if (!Array.isArray(body.characterChannels) || body.characterChannels.length > 512) return false;
    const seenCharacterChannels = new Set();
    for (const entry of body.characterChannels) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)
            || Object.keys(entry).sort().join(',') !== 'assetId,assetVersion,channel'
            || typeof entry.assetId !== 'string' || !/^[a-z][a-z0-9_-]{2,79}$/u.test(entry.assetId)
            || !Number.isSafeInteger(entry.assetVersion) || entry.assetVersion <= 0
            || !['character', 'player', 'narrator', 'system'].includes(entry.channel)) return false;
        const key = `${entry.assetId}:${entry.assetVersion}`;
        if (seenCharacterChannels.has(key)) return false;
        seenCharacterChannels.add(key);
    }
    if (!body.enabled) {
        if (body.activeCatalog !== null || body.visualProfile !== null || body.characterChannels.length !== 0) return false;
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
        characterChannels: body.characterChannels,
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
        ui.visualIconStrip.append(createCoreVisualIconFigure(type, null, '', { placeholder: true }));
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

function hasValidatedSceneDecisionInput(request) {
    const entity = request?.projection?.entities?.find((candidate) => candidate.entityType === 'scene');
    return Boolean(entity?.confidenceBand === 'explicit'
        && entity.visibleAttributes?.some((attribute) => (
            attribute.code === 'scene-location-kind' && attribute.confidenceBand === 'explicit'
        )));
}

async function renderCoreVisualDecisions(decisions, baseUrl, token, request, response) {
    if (token !== visualBundleRequestToken) {
        recordSceneContinuityDiagnostic('decision-skipped', { reason: 'request-stale' });
        return;
    }
    const byType = new Map();
    const invalidTypes = new Set();
    const currentRole = request?.visibleContext?.current?.role || 'character';
    const sceneDecisionGateOpen = activeSceneContinuityToken === token
        && activeSceneContinuityAction === 'changed'
        && hasValidatedSceneDecisionInput(request);
    const sceneDecisionCount = decisions.filter((decision) => decision?.entityType === 'scene').length;
    recordSceneContinuityDiagnostic('decision-gate', {
        state: sceneDecisionGateOpen ? 'open' : 'closed',
        action: activeSceneContinuityAction,
        reason: !sceneDecisionGateOpen ? 'continuity-gate-closed' : '',
    });
    for (const type of CORE_VISUAL_TYPES) {
        if (type === 'scene' && (activeSceneContinuityToken !== token || activeSceneContinuityAction !== 'changed'
            || !hasValidatedSceneDecisionInput(request))) {
            continue;
        }
        // Character assets belong only to actual character turns. Player and
        // narrator have separate visual channels and must not inherit a
        // character portrait from a remote or stale projection.
        const typeDecisions = decisions.filter((decision) => (
            decision?.entityType === type
            && (type !== 'scene' || (activeSceneContinuityToken === token && activeSceneContinuityAction === 'changed'
                && hasValidatedSceneDecisionInput(request)))
            && (type !== 'character' || currentRole === 'character')
        ));
        const renderable = typeDecisions
            .filter((decision) => isRenderableCoreVisualDecision(decision, type, request, response)
                && Boolean(createCoreVisualContentUrl(decision, baseUrl)))
            .map((decision) => decorateCoreVisualDecision(decision, request));
        let selected = renderable[0] || null;
        if (type === 'character' && selected && currentRole === 'character'
            && !reservePresentationPortrait(selected, request)) {
            selected = null;
            invalidTypes.add(type);
        }
        if (selected) {
            coreVisualPresentationDetails.set(type, renderable);
            coreVisualPresentationState.set(type, selected);
            byType.set(type, selected);
            continue;
        }
        if (typeDecisions.some((decision) => !String(decision?.assetId || '').startsWith('unknown_'))) {
            invalidTypes.add(type);
        }
        // A locally bound avatar is already correct for the active segment.
        // Do not let an incomplete remote response put the previous speaker
        // back while the current request is still in flight.
        if (type === 'character' && immediateVisualCharacterIdentity) {
            continue;
        }
        if (invalidTypes.has(type)) {
            coreVisualPresentationState.delete(type);
            coreVisualPresentationDetails.delete(type);
            continue;
        }
        // A valid response with no current portrait match must not leave a
        // previous turn's character on screen. Scene backgrounds are different:
        // an unknown scene result means the location was not reclassified, so
        // the last verified scene can continue through the next line of dialogue.
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
    recordSceneContinuityDiagnostic('decision-result', {
        state: byType.has('scene') ? 'selected' : 'no-scene',
        action: activeSceneContinuityAction,
        reason: !sceneDecisionGateOpen
            ? 'continuity-gate-closed'
            : (() => {
                const sceneDecision = decisions.find((decision) => decision?.entityType === 'scene');
                const decisionSummary = sceneDecision
                    ? [
                        sceneDecision.assetId || 'asset-missing',
                        Number.isSafeInteger(sceneDecision.score) ? `s${sceneDecision.score}` : '',
                        ...(Array.isArray(sceneDecision.reasonCodes) ? sceneDecision.reasonCodes : []),
                    ].filter(Boolean).join('_')
                    : '';
                const result = sceneDecisionCount ? 'scene-candidate-rejected' : 'no-scene-candidate';
                return decisionSummary ? `${result}_${decisionSummary}` : result;
            })(),
    });
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
            : (coreVisualHasVerifiedBackground
                && ui.stageBackdrop?.dataset.visualAssetIdentity
                ? Promise.resolve()
                : Promise.resolve().then(() => restoreDefaultBackgroundLayer())),
        byType.has('character')
            ? (immediateCharacterStillValid
                ? Promise.resolve()
                : applyCoreVisualCharacter(byType.get('character'), baseUrl, token))
            : ((currentRole === 'character' || currentRole === 'narrator' || currentRole === 'player') && immediateVisualCharacterIdentity
                ? Promise.resolve()
                : Promise.resolve().then(() => applyCoreVisualPlaceholderCharacter(currentRole))),
        applyCoreVisualIcons(byType, baseUrl, token, invalidTypes),
    ]);
    if (token === visualBundleRequestToken) {
        setVisualStatus('');
    }
}

function reservePresentationPortrait(decision, request) {
    const entity = request?.projection?.entities?.find((item) => item.entityKey === decision?.entityKey && item.entityType === 'character');
    if (!entity?.entityKey || !decision?.assetId || !Number.isSafeInteger(decision.assetVersion)) return false;
    return reservePresentationPortraitBinding(entity.entityKey, `${decision.assetId}:${decision.assetVersion}`, request.projection);
}

function reservePresentationPortraitBinding(identityKey, assetKey, projectionScope) {
    if (!identityKey || !assetKey || !projectionScope) return false;
    const scope = presentationPortraitScopeKey(projectionScope);
    if (!scope) return false;
    let storage;
    try {
        storage = window.sessionStorage;
    } catch {
        reportPortraitLedgerPersistenceUnavailable();
        return false;
    }
    const result = reservePersistentPresentationAsset({
        storage,
        storageKey: PRESENTATION_PORTRAIT_LEDGER_KEY,
        scope,
        identityKey,
        assetKey,
        invalidatedAssetKeys: getSpecialVisualChannelAssetKeys(manifest, release?.activeArcId || release?.arcId || manifest?.defaultArcId || ''),
    });
    if (!result.accepted) {
        if (result.reason === 'storage-unavailable') reportPortraitLedgerPersistenceUnavailable();
        return false;
    }
    return true;
}

function reportPortraitLedgerPersistenceUnavailable() {
    if (portraitLedgerPersistenceWarningLogged) return;
    portraitLedgerPersistenceWarningLogged = true;
    console.warn('Galgame dynamic portrait binding unavailable: portrait-ledger-persistence-failed');
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
        recordSceneContinuityDiagnostic('background-skipped', { reason: 'background-decision-unavailable' });
        return;
    }
    const sourceUrl = createCoreVisualContentUrl(decision, baseUrl);
    const identity = `${decision.assetId}:${decision.assetVersion}`;
    if (!sourceUrl || token !== visualBundleRequestToken) {
        recordSceneContinuityDiagnostic('background-skipped', { reason: !sourceUrl ? 'content-url-unavailable' : 'request-stale' });
        return;
    }
    const previousImage = ui.stageBackdrop.style.backgroundImage;
    const previousIdentity = ui.stageBackdrop.dataset.visualAssetIdentity || '';
    const hadPreviousVerifiedBackground = coreVisualHasVerifiedBackground && Boolean(previousIdentity);
    // Show the validated catalog URL immediately; replace it with a same-origin
    // blob after the bytes arrive so large scenes never leave an empty stage.
    applyVisualLayerImage(ui.stageBackdrop, sourceUrl, identity, token, 'background');
    ui.stageBackdrop.classList.add('is-visual-active');
    coreVisualHasVerifiedPresentation = true;
    recordSceneContinuityDiagnostic('background-load-started', { state: 'pending' });
    const renderUrl = await resolveVisualRenderUrl(sourceUrl);
    if (token !== visualBundleRequestToken) return;
    if (!renderUrl) {
        restoreVisualLayerAfterLoadFailure(ui.stageBackdrop, previousImage, previousIdentity);
        coreVisualHasVerifiedBackground = hadPreviousVerifiedBackground;
        recordSceneContinuityDiagnostic('background-load-failed', { state: 'restored', reason: 'asset-bytes-unavailable' });
        return;
    }
    applyVisualLayerImage(ui.stageBackdrop, renderUrl, identity, token, 'background');
    coreVisualHasVerifiedBackground = true;
    recordSceneContinuityDiagnostic('background-load-succeeded', { state: 'applied' });
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

function updateCoreVisualCardText(icon, type) {
    if (!icon) return;
    const result = getVisualCardDetailResult(type);
    const grouped = getAdaptiveGroups(result).flatMap((group) => group.items);
    const items = result.hasVisibleEvidence
        ? (grouped.length ? grouped : getAdaptivePanelItems(result).map(normalizeAdaptiveDetailItem))
        : [];
    const label = getVisualTypeLabel(type);
    const caption = icon.querySelector?.('figcaption');
    if (caption) caption.textContent = items.length || result.explicitEmpty ? `${label} · ${items.length}` : label;
    const names = items.map((item) => item.label).join('、');
    const prefix = result.historical ? '最近记录：' : '';
    const summary = icon.querySelector?.('small');
    if (summary) summary.textContent = names || (result.explicitEmpty ? '无' : '未记录');
    const source = icon.querySelector?.('.visual-icon-source');
    if (source) { source.textContent = result.historical ? '最近记录' : ''; source.hidden = !result.historical; }
    icon.setAttribute('title', `${prefix}${names || (result.explicitEmpty ? '无' : `点击查看${label}详情`)}`.slice(0, 240));
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
    const summary = document.createElement('small');
    summary.className = 'visual-icon-summary';
    const source = document.createElement('span');
    source.className = 'visual-icon-source';
    icon.append(image, caption, summary, source);
    const record = getVisualCardDetailResult(type);
    icon.dataset.hudRecordKey = JSON.stringify([record.evidenceSource || null, record.values]);
    updateCoreVisualCardText(icon, type);
    icon.addEventListener('click', () => openVisualDetailCard(type, icon));
    icon.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openVisualDetailCard(type, icon);
        }
    });
    return icon;
}

async function applyCoreVisualIcons(byType, baseUrl, token, invalidTypes = new Set()) {
    if (token !== visualBundleRequestToken) return;
    if (!ui.visualIconStrip) {
        return;
    }
    for (const type of VISUAL_ICON_TYPES) {
        const explicitlyEmpty = getVisualCardDetailResult(type).explicitEmpty === true;
        const decision = explicitlyEmpty ? null : byType.get(type);
        const isUnknown = !decision || String(decision.assetId || '').startsWith('unknown_');
        const candidateUrl = isUnknown ? '' : createCoreVisualContentUrl(decision, baseUrl);
        const identity = decision?.assetId && decision?.assetVersion
            ? `${decision.assetId}:${decision.assetVersion}`
            : '';
        const existing = findCoreVisualIcon(type);
        if (!candidateUrl) {
            if (existing?.classList?.contains?.('is-visual-active') && !invalidTypes.has(type) && !explicitlyEmpty) {
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
    coreVisualHasVerifiedBackground = false;
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
    const sanitized = String(value || '')
        .normalize('NFC')
        .replace(/[^\p{L}\p{N}\p{P}\p{S}\p{Zs}]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    return Array.from(sanitized).slice(0, maxLength).join('');
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

async function createCoreVisualDecisionRequest({ snapshot, message, messageIndex, visualProfile, segmentOverride = null, sceneContinuity = null }) {
    const visibleContext = getRenderedVisualRuntimeContext(snapshot, message, messageIndex);
    if (!visibleContext) {
        throw new Error('VISIBLE_RUNTIME_CONTEXT_INVALID');
    }
    // Rebuild from the request's immutable chat snapshot/index, exactly as the
    // visible HUD panels do. Never consume the mutable rendered-panel cache:
    // an in-flight page request could otherwise inherit another page's labels.
    const hudVisualHints = await createVisibleHudVisualHints(
        snapshot,
        messageIndex,
        getAdaptivePresentationProfile(),
    );
    const activeSpeakerContext = segmentOverride
        ? { role: segmentOverride.role || 'character', speaker: String(segmentOverride.speaker || '') }
        : getActiveVisualSpeakerContext(message, messageIndex);
    const activeSegment = segmentOverride || (activeRenderContext && activeMessageIndex === messageIndex
        ? activeMessageSegments[activeSegmentIndex]
        : null);
    const activeSegmentRole = activeSpeakerContext.role;
    const activeSegmentSpeaker = activeSegment ? activeSpeakerContext.speaker : '';
    const segmentMessage = activeSegment
        ? normalizePlayerVisualRuntimeMessage({
            index: messageIndex,
            role: activeSegmentRole,
            speaker: activeSegmentSpeaker,
            text: activeSegment.sourceText || activeSegment.text || visibleContext.current.text || '',
        })
        : null;
    const displayedMessage = segmentMessage || visibleContext.current;
    const fullMessage = segmentOverride ? segmentMessage : normalizePlayerVisualRuntimeMessage({
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
    // Carousel candidate requests are scoped to that speaker's verified
    // source segment. Ordinary single-speaker requests preserve the existing
    // full-message visual projection behavior.
    const decisionContextMessage = segmentOverride
        ? segmentMessage
        : segmentMessage && fullMessage
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
    const usesCharacterChannel = displayedMessage.role === 'character' && activeSpeakerContext.role === 'character';
    const bindingMessage = usesCharacterChannel ? displayedMessage : null;
    const characterBinding = usesCharacterChannel
        ? resolveVisualCharacterBinding(manifest, {
            name: bindingMessage.speaker,
            role: activeSpeakerContext.role,
            arcId: activeArcId,
            allowCharacterPoolFallback: false,
        })
        : null;
    const hasActiveCharacterBinding = usesCharacterChannel && Boolean(characterBinding);
    // A runtime paragraph may identify a new speaker before the administrator
    // manifest has a binding for it. Keep that candidate in the visual request
    // so the analyzer can match a stable asset or return the neutral unknown
    // character fallback; never borrow a random character-pool portrait.
    const hasActiveCharacterCandidate = displayedMessage.role === 'character'
        && activeSpeakerContext.role === 'character'
        && Boolean(String(displayedMessage.speaker || '').trim())
        && !isManifestNarratorSpeaker(displayedMessage.speaker);
    const hasActiveCharacterPresentation = hasActiveCharacterBinding || hasActiveCharacterCandidate;
    const entities = [];
    // Keep status/equipment/item/skill evidence from the full visible message,
    // but never let the last location in a long reply overwrite the location
    // of the paragraph currently shown. Scene evidence is timeline-sensitive:
    // a paragraph with a place wins; a paragraph without one emits no new
    // scene and lets the renderer preserve the last verified background.
    const sideVisualTypes = new Set(['equipment', 'item', 'skill']);
    const fullHints = createCoreVisualDisplayEntityHints(fullMessage || displayedMessage)
        .filter((hint) => hint.entityType !== 'scene' && !sideVisualTypes.has(hint.entityType));
    if (activeSegment?.identityRef?.type && activeSegment.identityRef.type !== 'unknown') {
        const identitySeed = `identity:${activeSegment.identityRef.type}:${activeSegment.identityRef.id}`;
        for (const hint of fullHints) {
            if (hint.entityType === 'character') hint.entityKeySeed = identitySeed;
        }
    }
    const isExplicitCharacterHint = (hint) => hint.entityType === 'character'
        && hint.visibleAttributes?.some((attribute) => attribute.code === 'character-explicit-appearance');
    let hints = hasActiveCharacterPresentation
        ? fullHints
        : fullHints.filter((hint) => hint.entityType !== 'character' || (usesCharacterChannel && isExplicitCharacterHint(hint)));
    if (segmentMessage) {
        const segmentHints = createCoreVisualDisplayEntityHints(segmentMessage);
        if (activeSegment?.identityRef?.type && activeSegment.identityRef.type !== 'unknown') {
            const identitySeed = `identity:${activeSegment.identityRef.type}:${activeSegment.identityRef.id}`;
            for (const hint of segmentHints) {
                if (hint.entityType === 'character') hint.entityKeySeed = identitySeed;
            }
        }
        const segmentSceneHint = sceneContinuity?.visualHint?.entityType === 'scene'
            ? sceneContinuity.visualHint
            : null;
        const segmentCharacterHint = segmentHints.find((hint) => hint.entityType === 'character');
        const activeCharacterHint = hasActiveCharacterPresentation
            ? (segmentCharacterHint || {
                entityKeySeed: `active-speaker:${displayedMessage.speaker}`,
                entityType: 'character',
                displayLabel: displayedMessage.speaker || '角色',
                visibleAttributes: [{
                    code: 'character-explicit-name',
                    value: (displayedMessage.speaker || '角色').slice(0, 120),
                    confidenceBand: hasActiveCharacterBinding ? 'explicit' : 'probable',
                }],
                confidenceBand: hasActiveCharacterBinding ? 'explicit' : 'probable',
            })
            : null;
        if (activeCharacterHint) {
            const identityState = activeSegment?.identityRef?.type && activeSegment.identityRef.type !== 'unknown'
                ? presentationProjectionStates.get(presentationProjectionScope(snapshot))
                : null;
            const currentProjection = isPresentationProjectionCurrent(snapshot, identityState) ? identityState.projection : null;
            activeCharacterHint.visibleAttributes = createSpeakerVisualAttributes({
                visibleAttributes: activeCharacterHint.visibleAttributes,
                projection: currentProjection,
                identityRef: currentProjection ? activeSegment.identityRef : null,
            });
        }
        if (activeCharacterHint && !hasActiveCharacterBinding) {
            activeCharacterHint.confidenceBand = 'probable';
            activeCharacterHint.visibleAttributes = (activeCharacterHint.visibleAttributes || []).map((attribute) => (
                attribute.code === 'character-explicit-name'
                    ? { ...attribute, confidenceBand: 'probable' }
                    : attribute
            ));
        }
        hints = [
            ...(activeCharacterHint ? [activeCharacterHint] : []),
            ...(segmentSceneHint ? [segmentSceneHint] : []),
            ...fullHints.filter((hint) => activeCharacterHint
                ? hint.entityType !== 'character' && hint.entityType !== 'scene'
                : (hint.entityType !== 'character' && hint.entityType !== 'scene') || (usesCharacterChannel && isExplicitCharacterHint(hint))),
            ...hudVisualHints,
        ];
    } else {
        if (sceneContinuity?.visualHint?.entityType === 'scene') hints.push(sceneContinuity.visualHint);
        hints.push(...hudVisualHints);
    }
    if (!segmentMessage && hasActiveCharacterPresentation && !hints.some((hint) => hint.entityType === 'character')) {
        hints = [{
            entityKeySeed: `active-speaker:${displayedMessage.speaker}`,
            entityType: 'character',
            displayLabel: displayedMessage.speaker || '旁白',
            visibleAttributes: [{
                code: 'character-explicit-name',
                value: (displayedMessage.speaker || '旁白').slice(0, 120),
                confidenceBand: hasActiveCharacterBinding ? 'explicit' : 'probable',
            }],
            confidenceBand: hasActiveCharacterBinding ? 'explicit' : 'probable',
        }, ...hints];
    }
    if (!usesCharacterChannel) {
        hints = hints.filter((hint) => hint.entityType !== 'character');
    }
    const entityKeys = new Set();
    const entityTypes = new Set();
    for (const hint of hints) {
        if (!CORE_VISUAL_TYPES.includes(hint.entityType)) {
            continue;
        }
        // Keep the projection within its 32-entity schema cap while reserving
        // a placeholder slot for every type not yet represented. Existing
        // character/scene and other visible hints retain priority; excess HUD
        // labels are simply not requested this turn.
        if (entities.length + (CORE_VISUAL_TYPES.length - entityTypes.size) >= 32) {
            continue;
        }
        if (hint.entityType === 'character' && entityTypes.has('character')) {
            continue;
        }
        if (sideVisualTypes.has(hint.entityType)
            && !hint.visibleAttributes?.some((attribute) => (
                sanitizeCoreVisualProtocolValue(attribute?.value, 120) === attribute?.value
                && attribute?.code === `${hint.entityType === 'equipment' ? 'equipment' : hint.entityType}-visible-label`
            ))) {
            // Preserve only labels that survive the protocol sanitizer exactly;
            // transformed text would be a synthetic matcher input.
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
                        ...(usesCharacterChannel && bindingMessage?.speaker
                            ? [{
                                code: 'character-explicit-name',
                                value: bindingMessage.speaker.slice(0, 120),
                                confidenceBand: hasActiveCharacterBinding ? 'explicit' : 'probable',
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
        if (type === 'character' && !hasActiveCharacterPresentation && !projectedTypes.has('character')) {
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
    if (!message) {
        return;
    }

    const text = message.role === 'character' ? message.displayText || message.text || '' : '';
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
    const records = collectVisibleHudRecords(snapshot, messageIndex, profile);
    const panelResults = selectAdaptivePanelResults([
        ...extraction.results.filter((result) => !RIGHT_TOP_ADAPTIVE_MODULES.has(result.module)),
        ...records.values(),
    ], profile);
    activeAdaptivePanelResults = new Map(panelResults.map((result) => [result.module, result]));
    for (const type of VISUAL_ICON_TYPES) {
        const icon = findCoreVisualIcon(type);
        const record = getVisualCardDetailResult(type);
        const recordKey = JSON.stringify([record.evidenceSource || null, record.values]);
        if (icon && (record.explicitEmpty || icon.dataset.hudRecordKey !== recordKey)) {
            coreVisualPresentationState.delete(type);
            coreVisualPresentationDetails.delete(type);
            removeCoreVisualIcon(icon);
            ui.visualIconStrip?.append(createCoreVisualIconFigure(type, null, '', { placeholder: true }));
        } else {
            updateCoreVisualCardText(icon, type);
        }
    }
    const centralPanelResults = panelResults.filter((result) => !RIGHT_TOP_ADAPTIVE_MODULES.has(result.module));

    const projectionState = presentationProjectionStates.get(presentationProjectionScope(snapshot));
    const roster = resolvePresentationMode(String(manifest?.locale || release?.locale || '')) === 'assisted'
        && isPresentationProjectionCurrent(snapshot, projectionState)
        ? createPresentationRosterDisplay({ projection: projectionState.projection, roster: projectionState.roster })
        : null;
    if (!centralPanelResults.length && !roster?.length) {
        return;
    }
    const panelElements = [];
    if (centralPanelResults.length) panelElements.push(createAdaptiveStatusBeltElement(centralPanelResults, profile));
    if (roster?.length) {
        const party = document.createElement('section');
        party.className = 'presentation-party-roster';
        party.setAttribute('aria-label', '同行角色');
        const title = document.createElement('strong');
        title.textContent = '同行者';
        const names = document.createElement('span');
        names.textContent = roster.map(formatPresentationRosterMember).join('、');
        party.append(title, names);
        panelElements.push(party);
    }
    ui.adaptivePanels.replaceChildren(...panelElements);
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
    for (const type of VISUAL_ICON_TYPES) updateCoreVisualCardText(findCoreVisualIcon(type), type);
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
        return normalizeAdaptiveDetailItem({ name: item, raw: item });
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

function getVisualCardDetailResult(type) {
    const adaptiveModule = getVisualCardModule(type);
    const sourceResult = adaptiveModule ? activeAdaptivePanelResults.get(adaptiveModule) : null;
    if (!sourceResult) return createVisualDetailResult(type);
    // Equipment headers and inventory headers are already separated upstream.
    // A weapon explicitly carried in a backpack is still an inventory record;
    // keep its original group rather than hiding it or inferring that it is equipped.
    return { ...sourceResult, module: type, hasVisibleEvidence: true };
}

function openVisualDetailCard(type, returnFocusTarget = null) {
    const result = getVisualCardDetailResult(type);
    openAdaptiveDetail(result, getAdaptivePanelItems(result), returnFocusTarget);
    if (result.hasVisibleEvidence && result.evidenceSource && ui.adaptiveDetailBody) {
        const note = document.createElement('p');
        note.className = 'hud-record-source';
        note.textContent = result.historical
            ? `最近记录：第 ${result.evidenceSource.messageIndex + 1} 条消息，不代表实时状态。`
            : '来自当前消息的明确记录。';
        if (result.explicitEmpty) note.textContent += ' 原文明确记录：无。';
        ui.adaptiveDetailBody.replaceChildren(note, ...Array.from(ui.adaptiveDetailBody.children || []));
    }
}

function getVisualDetailItems(type) {
    // Inventory text is original visible evidence, never a cached image match.
    const entries = activeVisualDetailHints.get(type) || [];
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

function createVisualDetailResult(type) {
    const label = getVisualTypeLabel(type);
    const items = getVisualDetailItems(type);
    const visibleItems = items.length
        ? items
        : [{
            name: '当前未识别到' + label,
            value: '当前对白或状态文本没有提供可展开的' + label + '信息',
            raw: '',
        }];
    return {
        module: type,
        hasVisibleEvidence: items.length > 0,
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
        scheduleVisiblePageVisualBundle(activeRenderContext.snapshot, activeMessageIndex, activeMessageSegments[activeSegmentIndex]);
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
    if (segment?.type === 'dialogue-group') {
        return '多人对话';
    }
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
