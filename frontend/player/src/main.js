import { createReleaseStore } from '../../shared/src/config-service.js';
import {
    getAssetUrl,
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
    createVisualNovelDisplaySegments,
    OriginalRuntimeBridgeClient,
    SillyTavernOriginalChatBridge,
} from '../../shared/src/sillytavern-adapter.js';
import { extractAdaptivePresentation } from '../../shared/src/adaptive-presentation.js';
import { createDefaultAdaptivePresentationProfile } from '../../shared/src/adaptive-presentation-schema.js';

const releaseStore = createReleaseStore(null, { fallbackToLocal: false });
const playerSaveStore = createPlayerSaveStore();
const chatBridge = new SillyTavernOriginalChatBridge({ baseUrl: getSillyTavernBaseUrl() });
const runtimeBridge = new OriginalRuntimeBridgeClient({
    baseUrl: getOriginalRuntimeBridgeUrl(),
    sillyTavernBaseUrl: getSillyTavernRuntimeBaseUrl(),
});
const ORIGINAL_RUNTIME_BRIDGE_PORTS = [8795, 8798, 8799, 8800, 8796, 8797];
let runtimeBridgeDiscoveryPromise = null;

const ui = {
    titleBackdrop: document.querySelector('#titleBackdrop'),
    titleHeroine: document.querySelector('.title-heroine'),
    gameScreen: document.querySelector('#gameScreen'),
    titleScreen: document.querySelector('#titleScreen'),
    stageBackdrop: document.querySelector('#stageBackdrop'),
    stageHeroine: document.querySelector('.stage-heroine'),
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

if (!globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__) {
    bootstrap().catch(() => {
        showToast('暂时无法开始');
    });
}

if (globalThis.__GALGAME_PLAYER_TEMPLATE_MATRIX_SMOKE__) {
    globalThis.__GALGAME_TEST_SET_MANIFEST__ = (nextManifest, { release: nextRelease = null } = {}) => {
        manifest = nextManifest;
        release = nextRelease;
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
}

async function bootstrap() {
    bindEvents();
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
    ui.stageTitle.textContent = manifest?.title || '故事尚未发布';
    ui.stageBackdrop.style.backgroundImage = manifest
        ? `url("${getAssetUrl(manifest, manifest.presentation?.defaultBackgroundAsset)}")`
        : '';
    ui.stageHeroine.style.backgroundImage = `url("${getTitleSpriteUrl()}")`;
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
        const bridgeReady = await ensureRuntimeBridgeReady();
        if (!bridgeReady) {
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
        renderChatSnapshot(generatedSnapshot);
        void persistAutoSave(generatedSnapshot);
        if (!snapshotAwaitsReply(generatedSnapshot)) {
            showToast('回应已到');
        }
    } catch (error) {
        console.warn('Galgame original runtime bridge failed.', error);
        const reloaded = await chatBridge.loadSpecificBoundChat(manifest, currentGenerationSnapshot.fileName).catch(() => null);
        activeChatSnapshot = reloaded?.ok ? reloaded : currentGenerationSnapshot;
        renderChatSnapshot(activeChatSnapshot);
        if (snapshotAwaitsReply(activeChatSnapshot)) {
            renderWaitingForReply();
        }
    } finally {
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
        if (health?.ok && !health.stopping && !health.authRequired) {
            return true;
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

async function discoverOriginalRuntimeBridge() {
    return runtimeBridge.discoverBaseUrl(getOriginalRuntimeBridgeCandidateUrls());
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
        };
        renderAdaptivePanels(message, snapshot, messageIndex);
        renderActiveDialogueSegment({
            animate: shouldAnimateMessage(message, waitingForReply, displayingLatest, options),
        });
        return;
    } else {
        renderBridgeUnavailable();
        return;
    }
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

    if (!panelResults.length) {
        return;
    }
    ui.adaptivePanels.replaceChildren(createAdaptiveStatusBeltElement(panelResults, profile));
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

function openAdaptiveDetail(result, fallbackItems = [], returnFocusTarget = null) {
    if (!ui.adaptiveDetailDrawer || !ui.adaptiveDetailTitle || !ui.adaptiveDetailBody) {
        return;
    }
    adaptiveDetailReturnFocus = returnFocusTarget instanceof HTMLElement
        ? returnFocusTarget
        : document.activeElement instanceof HTMLElement
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
    if (item.raw && item.raw !== item.label && item.raw !== `${item.label} ${item.value}`.trim()) {
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
        inventory: '背包',
        abilities: '技能',
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
