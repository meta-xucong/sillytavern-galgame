import { DEFAULT_SILLYTAVERN_SCENARIO } from './shared/demo-scenario.js?v=auto-6923a6936f85';
import { createReleaseStore } from './shared/config-service.js?v=auto-6923a6936f85';
import {
    bindAdaptivePresentationProfileHashes,
    getDefaultArcId,
    getManifestArcBindings,
    materializeManifestForArc,
    safeJsonParse,
    summarizeSillyTavernBindings,
    validateAdaptivePresentationProfiles,
    validateScenarioManifest,
    validateSillyTavernBindings,
} from './shared/protocol.js?v=auto-6923a6936f85';
import {
    createDefaultAdaptivePresentationProfile,
    PRESENTATION_MODULES,
    PRESENTATION_MATCHED_SIGNAL_CODES,
    PRESENTATION_NO_CLAIM_CODES,
    PRESENTATION_SAFE_WARNING_CODES,
    PRESENTATION_TEMPLATES,
    validateAdaptivePresentationProfile,
} from './shared/adaptive-presentation-schema.js?v=auto-6923a6936f85';
import {
    getMediaConfig,
    saveMediaConfig,
} from './shared/storage.js?v=auto-6923a6936f85';
import { SillyTavernAdapter } from './shared/sillytavern-adapter.js?v=auto-6923a6936f85';

const releaseStore = createReleaseStore(DEFAULT_SILLYTAVERN_SCENARIO, { fallbackToLocal: true });
const scriptAssistantState = {
    selectedFiles: [],
    draft: null,
    acceptedPresentationRecommendationId: '',
    busy: false,
    service: {
        url: '',
        configured: false,
        checking: false,
        reachable: false,
        authConfigured: false,
        llmConfigured: false,
        error: '',
    },
};
const visualAssetState = {
    service: {
        url: '',
        configured: false,
    },
    busy: false,
};

const pageTitles = {
    dashboard: '上传剧本',
    publish: '故事上架',
    library: '故事库',
    enhancements: '画面设置',
    advanced: '更多检查',
};

const ui = {
    pageTitle: document.querySelector('#pageTitle'),
    sampleButton: document.querySelector('#sampleButton'),
    navButtons: [...document.querySelectorAll('[data-tab]')],
    panels: [...document.querySelectorAll('[data-panel]')],
    activeTitle: document.querySelector('#activeTitle'),
    activeVersion: document.querySelector('#activeVersion'),
    activeArc: document.querySelector('#activeArc'),
    activePublishedAt: document.querySelector('#activePublishedAt'),
    dashboardStoryStatus: document.querySelector('#dashboardStoryStatus'),
    dashboardRuntimeStatus: document.querySelector('#dashboardRuntimeStatus'),
    dashboardEnhancementStatus: document.querySelector('#dashboardEnhancementStatus'),
    storyLibrarySummary: document.querySelector('#storyLibrarySummary'),
    releaseHistory: document.querySelector('#releaseHistory'),
    refreshButton: document.querySelector('#refreshButton'),
    fileInput: document.querySelector('#fileInput'),
    manifestEditor: document.querySelector('#manifestEditor'),
    validateButton: document.querySelector('#validateButton'),
    publishButton: document.querySelector('#publishButton'),
    validationResult: document.querySelector('#validationResult'),
    storyPackageSummary: document.querySelector('#storyPackageSummary'),
    publishCheckList: document.querySelector('#publishCheckList'),
    wizardTemplateSelect: document.querySelector('#wizardTemplateSelect'),
    wizardStyleResult: document.querySelector('#wizardStyleResult'),
    publishSummary: document.querySelector('#publishSummary'),
    publishResult: document.querySelector('#publishResult'),
    publishStepListItems: () => [...document.querySelectorAll('#publishStepList [data-step]')],
    scriptFileInput: document.querySelector('#scriptFileInput'),
    organizeScriptButton: document.querySelector('#organizeScriptButton'),
    redeployScriptButton: document.querySelector('#redeployScriptButton'),
    confirmScriptDraftButton: document.querySelector('#confirmScriptDraftButton'),
    scriptFileSummary: document.querySelector('#scriptFileSummary'),
    scriptAssistantResult: document.querySelector('#scriptAssistantResult'),
    scriptDraftPreview: document.querySelector('#scriptDraftPreview'),
    scriptAssistantServiceStatus: document.querySelector('#scriptAssistantServiceStatus'),
    arcPublishSelect: document.querySelector('#arcPublishSelect'),
    arcRefreshButton: document.querySelector('#arcRefreshButton'),
    arcValidateButton: document.querySelector('#arcValidateButton'),
    arcPublishButton: document.querySelector('#arcPublishButton'),
    arcResult: document.querySelector('#arcResult'),
    arcList: document.querySelector('#arcList'),
    profileRefreshButton: document.querySelector('#profileRefreshButton'),
    profileArcName: document.querySelector('#profileArcName'),
    profileTemplateSelect: document.querySelector('#profileTemplateSelect'),
    profileModuleList: document.querySelector('#profileModuleList'),
    profileApplyButton: document.querySelector('#profileApplyButton'),
    profileResult: document.querySelector('#profileResult'),
    resourceCheckButton: document.querySelector('#resourceCheckButton'),
    resourceLiveCheckButton: document.querySelector('#resourceLiveCheckButton'),
    resourceResult: document.querySelector('#resourceResult'),
    resourceLiveResult: document.querySelector('#resourceLiveResult'),
    referenceEvidenceList: document.querySelector('#referenceEvidenceList'),
    runtimeEvidenceList: document.querySelector('#runtimeEvidenceList'),
    deferredEvidenceList: document.querySelector('#deferredEvidenceList'),
    characterBindingList: document.querySelector('#characterBindingList'),
    worldBookBindingList: document.querySelector('#worldBookBindingList'),
    settingBindingList: document.querySelector('#settingBindingList'),
    mediaEnabledInput: document.querySelector('#mediaEnabledInput'),
    mediaEndpointInput: document.querySelector('#mediaEndpointInput'),
    saveMediaButton: document.querySelector('#saveMediaButton'),
    testMediaButton: document.querySelector('#testMediaButton'),
    mediaResult: document.querySelector('#mediaResult'),
    visualServiceStatus: document.querySelector('#visualServiceStatus'),
    simpleVisualUploadInputs: [...document.querySelectorAll('.simple-visual-upload-input')],
    systemStatus: document.querySelector('#systemStatus'),
    toast: document.querySelector('#toast'),
};

const visualAssetTypeLabels = {
    scene: '场景',
    character: '人物',
    equipment: '装备',
    item: '道具',
    skill: '技能',
};

const templateLabels = {
    'visual-novel': '视觉小说',
    'rpg-adventure': 'RPG 冒险',
    'romance-social': '恋爱/社交',
    'mystery-investigation': '推理调查',
    'management-sim': '经营模拟',
    'sandbox-roleplay': '沙盒扮演',
};

const moduleLabels = {
    actions: '行动建议',
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
};

const recommendationTemplateDetails = {
    'visual-novel': '适合对白、旁白和少量行动输入。',
    'rpg-adventure': '适合展示状态、装备、技能、任务和判定。',
    'romance-social': '适合展示关系、好感、礼物和日程。',
    'mystery-investigation': '适合展示线索、嫌疑人、地点和目标。',
    'management-sim': '适合展示资源、阵营、目标和日历。',
    'sandbox-roleplay': '适合展示地点、关系、目标和笔记。',
};

const signalLabels = {
    'signal-vn-dialogue-format': '发现对白/旁白结构',
    'signal-action-options-format': '发现可作为输入参考的行动提示',
    'signal-hp-ac-format': '发现 HP/AC 等可见状态',
    'signal-inventory-section': '发现背包/物品区',
    'signal-equipment-section': '发现装备/武器区',
    'signal-attack-section': '发现攻击/招式区',
    'signal-skill-list': '发现技能列表',
    'signal-quest-objective': '发现任务或目标',
    'signal-dice-roll': '发现判定/骰子文本',
    'signal-affection-score': '发现好感度文本',
    'signal-relationship-stage': '发现关系阶段',
    'signal-gift-event': '发现礼物/事件',
    'signal-calendar-event': '发现日程信息',
    'signal-clue-section': '发现线索区',
    'signal-suspect-section': '发现嫌疑人/人物区',
    'signal-location-section': '发现地点区',
    'signal-resource-counter': '发现资源计数',
    'signal-faction-status': '发现阵营状态',
    'signal-sandbox-notes': '发现沙盒笔记',
    'signal-unknown-structure': '有未识别结构，建议人工确认',
};

const warningCodeLabels = {
    'warning-low-confidence': '匹配度偏低，建议检查显示模块。',
    'warning-ambiguous-template': '类型判断不唯一，建议人工确认。',
    'warning-conflicting-signals': '材料里有混合类型信号。',
    'warning-no-stable-status-format': '状态格式不稳定，前端会保守展示。',
    'warning-no-opening-chat-detected': '没有稳定识别到开场聊天。',
    'warning-missing-character-reference': '角色资料引用需要确认。',
    'warning-missing-worldbook-reference': '世界设定引用需要确认。',
    'warning-admin-review-required': '确认前请快速检查一遍。',
    'warning-deterministic-fallback-used': 'AI 未完成，已用基础整理。',
    'warning-provider-output-rejected': 'AI 输出未通过安全检查，已改用基础整理。',
    'warning-profile-not-published': '展示方案尚未随故事上架。',
    'warning-patterns-disabled': '未启用自定义解析规则，只使用内置展示。',
};

const noClaimLabels = {
    'no-frontend-combat-calculation': '不在前端计算战斗、伤害或 AC。',
    'no-frontend-inventory-authority': '背包事实仍以原版聊天文本为准。',
    'no-frontend-affection-calculation': '不在前端计算好感度。',
    'no-frontend-resource-calculation': '不在前端计算资源变化。',
    'no-chapter-ending-judgment': '不在前端判断章节或结局。',
    'no-runtime-llm-assistant': '玩家游玩时不会调用导入助手。',
    'no-hidden-resource-reading': '不读取隐藏角色卡或世界书正文做展示事实。',
    'no-prompt-context-copy': '不复制提示词或上下文。',
    'no-regenerate-undo-swipe-group-quickreply': '高级原版操作仍保持未接入。',
    'no-preset-instruct-context-switching': '预设/上下文自动切换仍保持未接入。',
};

const fallbackRecommendationWarnings = {
    provider: 'AI 整理没有完成，已改用基础整理。',
    safety: 'AI 输出未通过安全检查，已改用基础整理。',
    timeout: 'AI 整理等待太久，已改用基础整理。',
};

bootstrap().catch(() => {
    showToast('管理端暂时无法载入');
});

async function bootstrap() {
    ui.manifestEditor.value = formatJson(DEFAULT_SILLYTAVERN_SCENARIO);
    bindEvents();
    validateDraft();
    renderScriptAssistant();
    await checkScriptAssistantHealth();
    renderArcBindings();
    renderPublishWizard();
    renderResourceBindings();
    renderAdaptiveProfileControls();
    renderVisualAssetControls();
    void renderMediaSettings();
    void renderSystemStatus();
    await refreshActiveManifest();
}

async function refreshActiveManifest() {
    ui.manifestEditor.value = formatJson(await releaseStore.getActiveManifest());
    await renderAll();
}

function bindEvents() {
    for (const button of ui.navButtons) {
        button.addEventListener('click', () => {
            switchTab(button.dataset.tab).catch(() => {
                showToast('页面暂时无法刷新');
            });
        });
    }
    for (const button of document.querySelectorAll('[data-jump-tab]')) {
        button.addEventListener('click', () => {
            switchTab(button.dataset.jumpTab).catch(() => {
                showToast('页面暂时无法刷新');
            });
        });
    }

    ui.sampleButton.addEventListener('click', () => {
        ui.manifestEditor.value = formatJson(DEFAULT_SILLYTAVERN_SCENARIO);
        showToast('已载入示例故事');
        validateDraft();
        renderArcBindings();
        renderPublishWizard();
        renderAdaptiveProfileControls();
    });

    ui.refreshButton.addEventListener('click', () => {
        refreshAdminState().catch(() => {
            showToast('刷新失败');
        });
    });
    ui.validateButton.addEventListener('click', () => {
        validateDraftWithLiveResources().catch(() => {
            setResourceLiveResult('更多检查暂时不可用。', false);
        });
    });
    ui.resourceCheckButton.addEventListener('click', () => renderResourceBindings());
    ui.resourceLiveCheckButton.addEventListener('click', () => {
        checkOriginalResourcesLive().catch(() => {
            setResourceLiveResult('更多检查暂时不可用。', false);
        });
    });
    ui.publishButton.addEventListener('click', () => {
        publishDraft().catch(() => {
            showToast('发布失败');
        });
    });
    ui.arcRefreshButton.addEventListener('click', () => renderArcBindings());
    ui.arcValidateButton.addEventListener('click', () => {
        checkOriginalResourcesLive().catch(() => {
            setResourceLiveResult('更多检查暂时不可用。', false);
        });
    });
    ui.arcPublishButton?.addEventListener('click', () => {
        publishDraft().catch(() => {
            showToast('发布失败');
        });
    });
    ui.arcPublishSelect.addEventListener('change', () => {
        renderPublishWizard();
        renderResourceBindings();
        renderArcBindings();
        renderAdaptiveProfileControls();
    });
    ui.wizardTemplateSelect.addEventListener('change', () => {
        applyWizardTemplateToDraft();
    });
    ui.profileRefreshButton.addEventListener('click', () => renderAdaptiveProfileControls());
    ui.profileTemplateSelect.addEventListener('change', () => renderAdaptiveProfileControls({ keepTemplate: true }));
    ui.profileApplyButton.addEventListener('click', () => {
        applyAdaptiveProfileToDraft();
    });
    ui.saveMediaButton.addEventListener('click', () => {
        saveMediaSettings().catch(() => {
            showToast('保存失败');
        });
    });
    ui.testMediaButton.addEventListener('click', () => {
        testMedia().catch(() => {
            setMediaResult('接口暂时不可用。', false);
        });
    });
    ui.simpleVisualUploadInputs.forEach((input) => {
        input.addEventListener('change', () => {
            uploadSimpleVisualFileForType(input).catch((error) => {
                setSimpleVisualCardStatus(input.dataset.visualUploadType, formatVisualError(error), false);
                setVisualServiceStatus(formatVisualError(error), false);
                setVisualBusy(false);
            });
        });
    });

    ui.fileInput.addEventListener('change', async () => {
        const file = ui.fileInput.files?.[0];
        if (!file) {
            return;
        }
        ui.manifestEditor.value = await file.text();
        validateDraft();
        renderArcBindings();
        renderPublishWizard();
        renderAdaptiveProfileControls();
    });

    ui.scriptFileInput?.addEventListener('change', () => {
        loadScriptAssistantFiles().catch(() => {
            setScriptAssistantResult('文件暂时无法读取，请换一个文本文件再试。', false);
        });
    });
    ui.organizeScriptButton?.addEventListener('click', () => {
        createScriptAssistantDraft().catch((error) => {
            setScriptAssistantResult(formatScriptAssistantError(error), false);
            setScriptAssistantBusy(false);
        });
    });
    ui.redeployScriptButton?.addEventListener('click', () => {
        redeployScriptAssistantDraft().catch((error) => {
            setScriptAssistantResult(formatScriptAssistantError(error), false);
            setScriptAssistantBusy(false);
        });
    });
    ui.confirmScriptDraftButton?.addEventListener('click', () => {
        confirmScriptAssistantDraft().catch((error) => {
            setScriptAssistantResult(formatScriptAssistantError(error), false);
            setScriptAssistantBusy(false);
        });
    });
}

async function switchTab(tab) {
    for (const button of ui.navButtons) {
        button.classList.toggle('is-active', button.dataset.tab === tab);
    }
    for (const panel of ui.panels) {
        panel.classList.toggle('is-hidden', panel.dataset.panel !== tab);
    }
    ui.pageTitle.textContent = pageTitles[tab] || '管理';
    if (tab === 'dashboard') {
        await renderRelease();
    }
    if (tab === 'publish' || tab === 'library') {
        renderArcBindings();
    }
    if (tab === 'publish') {
        renderPublishWizard();
    }
    if (tab === 'enhancements') {
        renderAdaptiveProfileControls();
        renderVisualAssetControls();
        await renderMediaSettings();
    }
    if (tab === 'advanced') {
        renderResourceBindings();
        await renderSystemStatus();
    }
}

async function renderAll() {
    await renderRelease();
    validateDraft();
    renderScriptAssistant();
    renderArcBindings();
    renderPublishWizard();
    renderResourceBindings();
    renderAdaptiveProfileControls();
    renderVisualAssetControls();
    await renderMediaSettings();
    await renderSystemStatus();
}

async function refreshAdminState() {
    await checkScriptAssistantHealth();
    await renderAll();
}

async function renderRelease() {
    const { release: active, manifest } = await releaseStore.getActiveBundle();
    ui.activeTitle.textContent = manifest.title;
    ui.activeVersion.textContent = manifest.version;
    const activeArcId = active.activeArcId || active.arcId || manifest.arcId || getDefaultArcId(manifest);
    const activeArc = getManifestArcBindings(manifest).find((arc) => arc.arcId === activeArcId);
    ui.activeArc.textContent = activeArc?.title || activeArcId;
    ui.activePublishedAt.textContent = new Date(active.publishedAt).toLocaleString();
    const bindingStatus = validateSillyTavernBindings(manifest, { arcId: activeArcId });
    ui.dashboardStoryStatus.textContent = bindingStatus.ready ? '可以游玩' : '需要补齐';
    ui.dashboardRuntimeStatus.textContent = bindingStatus.ready ? '可请求回复' : '等待检查';
    const profileStatus = validateAdaptivePresentationProfiles(manifest);
    ui.dashboardEnhancementStatus.textContent = profileStatus.ready ? '已配置显示方式' : '使用默认显示';

    const storedStories = typeof releaseStore.listStoredScenarios === 'function'
        ? await releaseStore.listStoredScenarios().catch(() => [])
        : [];
    renderStoryLibrarySummary({
        manifest,
        activeArcId,
        release: active,
        bindingStatus,
        profileStatus,
        storedStories,
    });
    ui.releaseHistory.replaceChildren();
    const history = await releaseStore.listReleases();
    if (!history.length) {
        const empty = document.createElement('div');
        empty.className = 'release-card';
        empty.textContent = '还没有上架记录。当前使用已准备好的默认入口。';
        ui.releaseHistory.append(empty);
        return;
    }

    for (const [index, release] of history.entries()) {
        const card = document.createElement('article');
        card.className = 'release-card version-card';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = index === 0 ? '当前使用版本' : '历史版本';
        const meta = document.createElement('span');
        const releaseArc = getManifestArcBindings(manifest).find((arc) => arc.arcId === (release.activeArcId || release.arcId));
        meta.textContent = [
            `上架时间 ${formatDateTime(release.publishedAt)}`,
            `章节 ${releaseArc?.title || '默认章节'}`,
            `故事版本 ${release.scenarioVersion || '-'}`,
        ].join(' · ');
        const detail = document.createElement('p');
        detail.className = 'arc-card-detail';
        detail.textContent = release.releaseId === active.releaseId
            ? '玩家新开游戏会进入这个版本。'
            : '恢复后只影响之后进入的玩家；已有存档仍按各自记录继续。';
        info.append(title, meta, detail);
        const rollback = document.createElement('button');
        rollback.type = 'button';
        rollback.textContent = release.releaseId === active.releaseId ? '当前版本' : '恢复到这个版本';
        rollback.disabled = release.releaseId === active.releaseId;
        rollback.addEventListener('click', async () => {
            await releaseStore.rollback(release.releaseId);
            showToast('已恢复到这个版本');
            await renderAll();
        });
        card.append(info, rollback);
        ui.releaseHistory.append(card);
    }
}

function renderStoryLibrarySummary({
    manifest,
    activeArcId,
    release,
    bindingStatus,
    profileStatus,
    storedStories = [],
}) {
    ui.storyLibrarySummary.replaceChildren();
    const arcs = getManifestArcBindings(manifest);
    const activeArc = arcs.find((arc) => arc.arcId === activeArcId);
    const readyStories = storedStories.filter((story) => story.ready).length;
    const items = storedStories.length
        ? storedStories.map((story) => [
            story.title || '未命名故事',
            [
                story.ready ? '已准备好' : '还需整理',
                `${story.playableArcCount || 0}/${story.arcCount || 1} 个入口可游玩`,
                story.scenarioId === manifest.id && story.scenarioVersion === manifest.version ? '当前默认' : '',
            ].filter(Boolean).join(' · '),
        ])
        : [
            ['默认推荐', manifest.title || '未命名故事'],
            ['当前入口', activeArc?.title || '默认章节'],
            ['可玩状态', bindingStatus.ready ? '可以游玩' : '需要补齐材料'],
            ['界面样式', profileStatus.ready ? '已配置' : '默认样式'],
            ['最近上架', formatDateTime(release.publishedAt)],
            ['章节数量', `${arcs.length || 1} 个`],
        ];

    for (const [label, value] of items) {
        const card = document.createElement('article');
        card.className = 'library-summary-card';
        const span = document.createElement('span');
        span.textContent = label;
        const strong = document.createElement('strong');
        strong.textContent = value;
        card.append(span, strong);
        ui.storyLibrarySummary.append(card);
    }

    if (storedStories.length) {
        const card = document.createElement('article');
        card.className = 'library-summary-card';
        const span = document.createElement('span');
        span.textContent = '作品总数';
        const strong = document.createElement('strong');
        strong.textContent = `${storedStories.length} 部，${readyStories} 部可选`;
        card.append(span, strong);
        ui.storyLibrarySummary.prepend(card);
    }
}

function renderPublishWizard() {
    const manifest = readDraftManifest();
    const validation = validateScenarioManifest(manifest);
    const selectedArcId = validation.valid ? getSelectedArcId(manifest) : '';
    const arcs = validation.valid ? getManifestArcBindings(manifest) : [];
    const selectedArc = arcs.find((arc) => arc.arcId === selectedArcId) || arcs[0] || null;
    const arcManifest = validation.valid ? materializeManifestForArc(manifest, selectedArcId) : null;
    const bindingStatus = validation.valid
        ? validateSillyTavernBindings(manifest, { arcId: selectedArcId })
        : { ready: false, errors: validation.errors, warnings: [] };
    const profileId = selectedArc?.presentationProfileId || 'default';
    const profile = validation.valid
        ? getDraftAdaptiveProfile(manifest, profileId)
        : createDefaultAdaptivePresentationProfile();
    const profileStatus = validateAdaptivePresentationProfile(profile);
    const selectedTemplate = profile.template || 'visual-novel';

    ui.storyPackageSummary.textContent = validation.valid
        ? `${manifest.title} · ${manifest.version} · ${arcs.length || 1} 个章节入口`
        : '还没有可读取的故事入口，请载入已准备好的故事。';

    renderWizardTemplateOptions(selectedTemplate, validation.valid);
    ui.wizardStyleResult.textContent = validation.valid
        ? `${templateLabels[selectedTemplate] || selectedTemplate}。只改变玩家页面的显示栏，不改变剧情。`
        : '载入故事后再选择界面样式。';

    renderPublishCheckList({
        validation,
        bindingStatus,
        arcManifest,
        profileStatus,
    });

    const readyToPublish = validation.valid && bindingStatus.ready && profileStatus.valid;
    ui.publishSummary.textContent = validation.valid
        ? `准备发布：${manifest.title} · ${selectedArc?.title || selectedArcId || '默认章节'} · ${templateLabels[selectedTemplate] || selectedTemplate}`
        : '发布前需要先载入故事。';
    setPublishResult(
        readyToPublish
            ? '可以发布。发布时仍会读取原版资源做最后检查；旧存档不会被改动。'
            : getBeginnerPublishBlockReason(validation, bindingStatus, profileStatus),
        readyToPublish,
    );
    updatePublishStepList(validation, bindingStatus, selectedArc, profileStatus);
}

function renderScriptAssistant() {
    const serviceUrl = getScriptImportAssistantBaseUrl();
    const hasService = Boolean(serviceUrl);
    if (hasService && scriptAssistantState.service.url !== serviceUrl && !scriptAssistantState.service.checking) {
        scriptAssistantState.service = {
            url: serviceUrl,
            configured: true,
            checking: true,
            reachable: false,
            authConfigured: false,
            llmConfigured: false,
            error: '',
        };
        window.setTimeout(() => {
            checkScriptAssistantHealth().catch(() => {
                scriptAssistantState.service = {
                    url: serviceUrl,
                    configured: true,
                    checking: false,
                    reachable: false,
                    authConfigured: false,
                    llmConfigured: false,
                    error: 'SERVICE_UNREACHABLE',
                };
                renderScriptAssistant();
            });
        }, 0);
    }
    const serviceReady = hasService
        && scriptAssistantState.service.reachable
        && scriptAssistantState.service.authConfigured;
    const hasFiles = scriptAssistantState.selectedFiles.length > 0;
    const hasDraft = Boolean(scriptAssistantState.draft?.draftId);

    ui.scriptAssistantServiceStatus.textContent = getScriptAssistantServiceLabel(serviceUrl);
    ui.scriptAssistantServiceStatus.classList.toggle('is-ok', serviceReady);
    ui.scriptAssistantServiceStatus.classList.toggle('is-error', !serviceReady && !scriptAssistantState.service.checking);
    ui.scriptAssistantServiceStatus.classList.toggle('is-checking', scriptAssistantState.service.checking);

    ui.organizeScriptButton.disabled = scriptAssistantState.busy || !serviceReady || !hasFiles;
    ui.redeployScriptButton.disabled = scriptAssistantState.busy || !serviceReady || !hasDraft;
    ui.confirmScriptDraftButton.disabled = scriptAssistantState.busy || !serviceReady || !hasDraft;

    if (!hasService) {
        setScriptAssistantResult('自动整理服务还没有接入。请先启动导入助手服务；已准备好的故事仍可上架。', false);
    } else if (scriptAssistantState.service.checking) {
        setScriptAssistantResult('正在检查自动整理服务...', true);
    } else if (!scriptAssistantState.service.reachable) {
        setScriptAssistantResult('自动整理服务暂时没有响应。请确认本机导入助手已经启动。', false);
    } else if (!scriptAssistantState.service.authConfigured) {
        setScriptAssistantResult('自动整理服务需要先接好管理员保护，防止任何人上传或写入故事材料。', false);
    } else if (!hasFiles && !hasDraft) {
        setScriptAssistantResult(
            scriptAssistantState.service.llmConfigured
                ? 'AI 整理已就绪。请选择剧本文件，然后点击开始整理。'
                : '基础整理可用；接好服务端 AI 密钥后，会自动升级为 AI 整理。',
            true,
        );
    }

    if (!hasFiles && !hasDraft) {
        ui.scriptFileSummary.textContent = '还没有选择文件。';
        ui.scriptDraftPreview.replaceChildren();
    }
}

async function checkScriptAssistantHealth() {
    const serviceUrl = getScriptImportAssistantBaseUrl();
    scriptAssistantState.service = {
        url: serviceUrl,
        configured: Boolean(serviceUrl),
        checking: Boolean(serviceUrl),
        reachable: false,
        authConfigured: false,
        llmConfigured: false,
        error: '',
    };
    renderScriptAssistant();
    if (!serviceUrl) {
        return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(`${serviceUrl}/v1/health`, {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
        });
        const body = response.ok ? await response.json() : {};
        scriptAssistantState.service = {
            url: serviceUrl,
            configured: true,
            checking: false,
            reachable: Boolean(response.ok && body?.ok),
            authConfigured: Boolean(body?.adminAuth?.configured),
            llmConfigured: Boolean(body?.llm?.configured),
            error: response.ok ? '' : `HTTP_${response.status}`,
        };
    } catch (error) {
        scriptAssistantState.service = {
            url: serviceUrl,
            configured: true,
            checking: false,
            reachable: false,
            authConfigured: false,
            llmConfigured: false,
            error: String(error?.name || error?.message || 'SERVICE_UNREACHABLE'),
        };
    } finally {
        window.clearTimeout(timer);
        renderScriptAssistant();
    }
}

function getScriptAssistantServiceLabel(serviceUrl) {
    if (!serviceUrl) {
        return '未接入';
    }
    const service = scriptAssistantState.service;
    if (service.checking) {
        return '检查中';
    }
    if (!service.reachable) {
        return '未启动';
    }
    if (!service.authConfigured) {
        return '需保护';
    }
    return service.llmConfigured ? 'AI 已就绪' : '基础整理';
}

async function loadScriptAssistantFiles() {
    const files = [...(ui.scriptFileInput.files || [])];
    scriptAssistantState.draft = null;
    scriptAssistantState.acceptedPresentationRecommendationId = '';
    scriptAssistantState.selectedFiles = [];
    if (!files.length) {
        renderScriptAssistant();
        return;
    }

    let totalLength = 0;
    const loaded = [];
    for (const file of files) {
        const text = await file.text();
        totalLength += text.length;
        if (text.length > 800000 || totalLength > 1600000) {
            throw new Error('SCRIPT_FILE_TOO_LARGE');
        }
        loaded.push({
            name: sanitizeFileNameForDisplay(file.name),
            type: file.type || guessScriptFileType(file.name),
            text,
        });
    }

    scriptAssistantState.selectedFiles = loaded;
    ui.scriptFileSummary.textContent = `${loaded.length} 个文件已选择，共 ${formatCharacterCount(totalLength)} 字符。文件正文只会临时用于整理。`;
    ui.scriptDraftPreview.replaceChildren();
    setScriptAssistantResult('文件已准备好，可以开始整理。', true);
    renderScriptAssistant();
}

async function createScriptAssistantDraft() {
    if (!scriptAssistantState.selectedFiles.length) {
        setScriptAssistantResult('请先选择剧本文件。', false);
        return;
    }
    setScriptAssistantBusy(true, '正在整理草稿...');
    const result = await requestScriptAssistant('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: {
            protocolVersion: 'galgame.script-import-assistant.request.v1',
            files: scriptAssistantState.selectedFiles,
            options: {
                locale: 'zh-CN',
                preferredTemplate: 'auto',
            },
        },
    });

    if (!result.responseOk || !result.body?.ok || !result.body?.draft) {
        throw new Error(result.body?.safeMessage || result.body?.error || 'SCRIPT_ASSISTANT_CREATE_FAILED');
    }

    scriptAssistantState.draft = result.body.draft;
    scriptAssistantState.acceptedPresentationRecommendationId = '';
    clearScriptAssistantSourceFiles();
    renderScriptAssistantDraft(scriptAssistantState.draft);
    setScriptAssistantResult(formatScriptAssistantDraftStatus(scriptAssistantState.draft, 'organized'), true);
    setScriptAssistantBusy(false);
}

async function redeployScriptAssistantDraft() {
    const draftId = scriptAssistantState.draft?.draftId;
    if (!draftId) {
        setScriptAssistantResult('还没有可重新整理的草稿。', false);
        return;
    }
    setScriptAssistantBusy(true, '正在重新整理...');
    const result = await requestScriptAssistant(`/v1/admin/script-import/drafts/${encodeURIComponent(draftId)}/redeploy`, {
        method: 'POST',
        body: {
            reason: '管理员请求重新整理',
        },
    });

    if (!result.responseOk || !result.body?.ok || !result.body?.draft) {
        throw new Error(result.body?.safeMessage || result.body?.error || 'SCRIPT_ASSISTANT_REDEPLOY_FAILED');
    }

    scriptAssistantState.draft = result.body.draft;
    scriptAssistantState.acceptedPresentationRecommendationId = '';
    renderScriptAssistantDraft(scriptAssistantState.draft);
    setScriptAssistantResult(formatScriptAssistantDraftStatus(scriptAssistantState.draft, 'redeployed'), true);
    setScriptAssistantBusy(false);
}

async function confirmScriptAssistantDraft() {
    const draftId = scriptAssistantState.draft?.draftId;
    if (!draftId) {
        setScriptAssistantResult('还没有可确认的草稿。', false);
        return;
    }
    setScriptAssistantBusy(true, '正在确认草稿...');
    const result = await requestScriptAssistant(`/v1/admin/script-import/drafts/${encodeURIComponent(draftId)}/confirm`, {
        method: 'POST',
        body: {},
    });
    const draft = result.body?.draft || scriptAssistantState.draft;
    if (draft) {
        scriptAssistantState.draft = draft;
        renderScriptAssistantDraft(draft);
    }
    if (
        result.body?.status === 'deferred'
        || result.body?.error === 'SCRIPT_IMPORT_CONFIRM_DEFERRED_TO_AA3'
        || result.responseStatus === 501
    ) {
        setScriptAssistantResult('草稿已确认；真正写入原版故事材料的步骤将在下一阶段接入。现在不会替换玩家故事。', true);
        setScriptAssistantBusy(false);
        return;
    }
    if (!result.responseOk || !result.body?.ok) {
        throw new Error(result.body?.safeMessage || result.body?.error || 'SCRIPT_ASSISTANT_CONFIRM_FAILED');
    }
    if (result.body.manifest && typeof result.body.manifest === 'object') {
        ui.manifestEditor.value = formatJson(result.body.manifest);
        validateDraft();
        renderArcBindings();
        renderPublishWizard();
        renderResourceBindings();
        renderAdaptiveProfileControls();
        setScriptAssistantResult('已写入原版故事材料，并生成可上架故事入口。检查通过后点击上架即可。', true);
    } else {
        setScriptAssistantResult('草稿已确认；请继续走后续上架检查。', true);
    }
    setScriptAssistantBusy(false);
}

async function requestScriptAssistant(path, { method = 'GET', body = undefined } = {}) {
    const scriptAssistantBaseUrl = getScriptImportAssistantBaseUrl();
    if (!scriptAssistantBaseUrl) {
        throw new Error('SCRIPT_ASSISTANT_NOT_CONFIGURED');
    }
    if (!scriptAssistantState.service.reachable || !scriptAssistantState.service.authConfigured) {
        throw new Error('SCRIPT_ASSISTANT_NOT_READY');
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(`${scriptAssistantBaseUrl}${path}`, {
            method,
            credentials: 'include',
            headers: body ? { 'content-type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const text = await response.text();
        let payload = {};
        if (text) {
            payload = JSON.parse(text);
        }
        return {
            responseOk: response.ok,
            responseStatus: response.status,
            body: payload,
        };
    } finally {
        window.clearTimeout(timer);
    }
}

function renderScriptAssistantDraft(draft) {
    ui.scriptDraftPreview.replaceChildren();
    if (!draft) {
        return;
    }
    const summary = draft.summary || {};
    const importPlan = draft.importPlan || {};
    const modeNotice = document.createElement('div');
    modeNotice.className = `script-draft-mode ${summary.usesLlm ? 'is-ai' : 'is-basic'}`;
    const modeTitle = document.createElement('strong');
    modeTitle.textContent = summary.usesLlm ? '已用 AI 帮你整理' : '已用基础方式整理';
    const modeText = document.createElement('span');
    modeText.textContent = summary.usesLlm
        ? '可以直接检查草稿；不满意就点重新整理。'
        : '没有使用 AI，只做了安全的基础整理；建议重点检查名称、人物和开场记录。';
    modeNotice.append(modeTitle, modeText);

    const wrapper = document.createElement('div');
    wrapper.className = 'script-draft-grid';

    for (const [label, value] of [
        ['草稿名称', summary.title || '未命名故事'],
        ['建议样式', templateLabels[summary.recommendedTemplate] || summary.recommendedTemplate || '自动判断'],
        ['主要人物', formatList(summary.mainCharacters, '等待整理')],
        ['章节规模', formatArcEstimate(summary.estimatedArcs)],
        ['整理方式', summary.usesLlm ? 'AI 整理' : '基础整理'],
        ['草稿版本', `第 ${draft.revision || 1} 版`],
    ]) {
        const item = document.createElement('article');
        item.className = 'script-draft-item';
        const itemLabel = document.createElement('span');
        itemLabel.textContent = label;
        const itemValue = document.createElement('strong');
        itemValue.textContent = value;
        item.append(itemLabel, itemValue);
        wrapper.append(item);
    }

    const plan = document.createElement('div');
    plan.className = 'script-import-plan';
    const planTitle = document.createElement('strong');
    planTitle.textContent = importPlan.writePolicy === 'imported-aa3'
        ? '已经准备好'
        : '确认后会准备';
    const planItems = document.createElement('ul');
    for (const item of [
        importPlan.characterName ? '角色资料' : '',
        importPlan.worldBookName ? '世界设定' : '',
        importPlan.chatSeedId ? '开场记录' : '',
    ].filter(Boolean)) {
        const li = document.createElement('li');
        li.textContent = item;
        planItems.append(li);
    }
    if (!planItems.children.length) {
        const li = document.createElement('li');
        li.textContent = '等待下一阶段补齐';
        planItems.append(li);
    }
    plan.append(planTitle, planItems);

    const warnings = document.createElement('div');
    warnings.className = 'script-draft-warnings';
    const warningList = (draft.safeWarnings || draft.warnings || summary.warnings || [])
        .map(formatScriptAssistantWarning)
        .filter(Boolean)
        .slice(0, 4);
    warnings.textContent = warningList.length
        ? `需要留意：${warningList.join('；')}`
        : '暂未发现需要特别处理的提醒。';

    ui.scriptDraftPreview.append(modeNotice, wrapper, renderPresentationRecommendationCard(draft), plan, warnings);
}

function renderPresentationRecommendationCard(draft) {
    const recommendation = draft?.presentationRecommendation;
    const card = document.createElement('section');
    card.className = 'presentation-recommendation-card';
    card.dataset.presentationRecommendationCard = 'true';

    const header = document.createElement('div');
    header.className = 'presentation-recommendation-header';
    const title = document.createElement('div');
    const eyebrow = document.createElement('span');
    eyebrow.textContent = '界面建议';
    const heading = document.createElement('strong');
    heading.textContent = '按剧本自动选择显示方式';
    title.append(eyebrow, heading);
    const source = document.createElement('span');
    source.className = `recommendation-source ${recommendation?.usesLlm ? 'is-ai' : 'is-basic'}`;
    source.textContent = recommendation?.usesLlm ? 'AI 判断' : '基础判断';
    header.append(title, source);
    card.append(header);

    if (!recommendation || typeof recommendation !== 'object') {
        const empty = document.createElement('p');
        empty.className = 'presentation-recommendation-empty';
        empty.textContent = '暂时没有界面建议。仍可按基础导入继续，玩家端不会加载任何额外玩法。';
        card.append(empty);
        return card;
    }

    const profile = recommendation.recommendedProfile || {};
    const templateId = PRESENTATION_TEMPLATES.includes(profile.template)
        ? profile.template
        : (PRESENTATION_TEMPLATES.includes(recommendation.detectedGenre) ? recommendation.detectedGenre : 'visual-novel');
    const confidence = typeof recommendation.confidence === 'number' && Number.isFinite(recommendation.confidence)
        ? recommendation.confidence
        : null;

    const summary = document.createElement('div');
    summary.className = 'presentation-recommendation-summary';
    const templateBlock = document.createElement('article');
    templateBlock.className = 'presentation-recommendation-template';
    const templateLabel = document.createElement('span');
    templateLabel.textContent = '推荐界面';
    const templateValue = document.createElement('strong');
    templateValue.textContent = templateLabels[templateId] || '极简对白';
    const templateText = document.createElement('p');
    templateText.textContent = recommendationTemplateDetails[templateId] || '先保持保守展示，只显示原版聊天里明确出现的信息。';
    templateBlock.append(templateLabel, templateValue, templateText);

    const confidenceBlock = document.createElement('article');
    confidenceBlock.className = 'presentation-recommendation-confidence';
    const confidenceLabel = document.createElement('span');
    confidenceLabel.textContent = '匹配把握';
    const confidenceValue = document.createElement('strong');
    confidenceValue.textContent = formatRecommendationConfidence(confidence);
    const confidenceText = document.createElement('p');
    confidenceText.textContent = confidence === null
        ? '没有可靠分数，建议按基础显示检查。'
        : `约 ${Math.round(confidence * 100)}%，只作为管理端参考。`;
    confidenceBlock.append(confidenceLabel, confidenceValue, confidenceText);
    summary.append(templateBlock, confidenceBlock);
    card.append(summary);

    const moduleValues = normalizeKnownCodes(profile.preferredModules, moduleLabels, PRESENTATION_MODULES);
    card.append(renderRecommendationCodeGroup('建议显示', moduleValues, 'module'));

    const signalValues = normalizeKnownCodes(recommendation.evidence?.matchedSignals, signalLabels, PRESENTATION_MATCHED_SIGNAL_CODES);
    card.append(renderRecommendationCodeGroup('判断依据', signalValues, 'signal'));

    const warningValues = normalizeKnownCodes(recommendation.safeWarnings, warningCodeLabels, PRESENTATION_SAFE_WARNING_CODES);
    if (warningValues.length) {
        card.append(renderRecommendationCodeGroup('需要留意', warningValues, 'warning'));
    }

    const noClaimValues = normalizeKnownCodes(recommendation.noClaim, noClaimLabels, PRESENTATION_NO_CLAIM_CODES);
    card.append(renderRecommendationCodeGroup('不会替你做这些', noClaimValues, 'no-claim'));

    const actions = document.createElement('div');
    actions.className = 'presentation-recommendation-actions';
    const acceptedId = recommendation.recommendationId || `${draft?.draftId || 'draft'}:${draft?.revision || 1}`;
    const accepted = scriptAssistantState.acceptedPresentationRecommendationId === acceptedId;
    const acceptButton = document.createElement('button');
    acceptButton.type = 'button';
    acceptButton.className = 'secondary-button';
    acceptButton.dataset.recommendationAcceptButton = 'true';
    acceptButton.textContent = accepted ? '已采用，等待确认' : '采用这个界面建议';
    acceptButton.setAttribute('aria-pressed', accepted ? 'true' : 'false');
    acceptButton.addEventListener('click', () => {
        scriptAssistantState.acceptedPresentationRecommendationId = acceptedId;
        setScriptAssistantResult('已采用界面建议。它只会作为待确认的展示方案，不会改变原版故事或直接上架。', true);
        renderScriptAssistantDraft(draft);
    });
    const actionNote = document.createElement('span');
    actionNote.textContent = accepted
        ? '状态：recommendation-accepted / pending presentation profile。'
        : '确认前不会写入玩家入口、发布清单或原版资源。';
    actions.append(acceptButton, actionNote);
    card.append(actions);

    return card;
}

function normalizeKnownCodes(values, labels, allowedCodes) {
    if (!Array.isArray(values)) {
        return [];
    }
    const allowed = new Set(allowedCodes);
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (typeof value !== 'string' || !allowed.has(value) || seen.has(value)) {
            continue;
        }
        seen.add(value);
        const label = labels[value];
        if (label) {
            result.push({ code: value, label });
        }
    }
    return result;
}

function renderRecommendationCodeGroup(title, values, variant) {
    const group = document.createElement('div');
    group.className = `recommendation-code-group is-${variant}`;
    const groupTitle = document.createElement('span');
    groupTitle.textContent = title;
    const list = document.createElement('div');
    list.className = 'recommendation-chip-list';
    const safeValues = values.length ? values : [{ code: 'empty', label: '暂未识别，保持隐藏或基础显示' }];
    for (const item of safeValues) {
        const chip = document.createElement('span');
        chip.className = 'recommendation-chip';
        chip.textContent = item.label;
        list.append(chip);
    }
    group.append(groupTitle, list);
    return group;
}

function formatRecommendationConfidence(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '需要确认';
    }
    if (value >= 0.78) {
        return '匹配度高';
    }
    if (value >= 0.55) {
        return '可以试用';
    }
    return '建议人工确认';
}

function formatScriptAssistantDraftStatus(draft, action = 'organized') {
    const summary = draft?.summary || {};
    if (summary.usesLlm) {
        return action === 'redeployed'
            ? 'AI 已重新整理。请检查草稿；确认后才会准备原版故事材料。'
            : 'AI 已整理完成。请检查草稿；确认后才会准备原版故事材料。';
    }
    return action === 'redeployed'
        ? '已用基础方式重新整理。建议检查草稿；不满意可以稍后接好 AI 服务再重试。'
        : '已用基础方式整理。建议检查草稿；确认前不会写入或上架。';
}

function formatScriptAssistantWarning(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }
    if (/SCRIPT_IMPORT_LLM_|https?:\/\/|Bearer\s+|token|api[_-]?key|provider/i.test(text)) {
        if (/等待太久|timeout/i.test(text)) {
            return 'AI 整理等待太久，已改用基础整理。';
        }
        if (/安全|schema|invalid|forbidden|rejected/i.test(text)) {
            return 'AI 整理结果未通过安全校验，已改用基础整理。';
        }
        return 'AI 整理没有完成，已改用基础整理。';
    }
    return text;
}

function clearScriptAssistantSourceFiles() {
    scriptAssistantState.selectedFiles = [];
    ui.scriptFileInput.value = '';
    ui.scriptFileSummary.textContent = '已生成草稿，文件正文已从页面临时缓存清除。';
}

function setScriptAssistantBusy(busy, message = '') {
    scriptAssistantState.busy = busy;
    ui.organizeScriptButton.disabled = true;
    ui.redeployScriptButton.disabled = true;
    ui.confirmScriptDraftButton.disabled = true;
    if (message) {
        setScriptAssistantResult(message, true);
    }
    if (!busy) {
        renderScriptAssistant();
    }
}

function setScriptAssistantResult(message, ok) {
    ui.scriptAssistantResult.textContent = message;
    ui.scriptAssistantResult.classList.toggle('is-ok', ok);
    ui.scriptAssistantResult.classList.toggle('is-error', !ok);
}

function getScriptImportAssistantBaseUrl() {
    const configured = window.GALGAME_SCRIPT_IMPORT_ASSISTANT_URL
        || document.querySelector('meta[name="galgame-script-import-assistant"]')?.content
        || '';
    return String(configured || '').trim().replace(/\/+$/, '');
}

function formatScriptAssistantError(error) {
    const message = String(error?.message || error || '');
    if (message === 'SCRIPT_ASSISTANT_NOT_CONFIGURED') {
        return '自动整理服务还没有接入。';
    }
    if (message === 'SCRIPT_ASSISTANT_NOT_READY') {
        return '自动整理服务还没准备好，请点“重新检查”。';
    }
    if (message === 'SCRIPT_FILE_TOO_LARGE') {
        return '文件太大，请先拆成几个较小的文本文件。';
    }
    if (/ADMIN_AUTH|401|403|503/.test(message)) {
        return '管理员访问保护未通过，请检查后台服务是否已由部署层接好。';
    }
    if (/abort|timeout/i.test(message)) {
        return '整理等待时间过长，请稍后重试。';
    }
    return '整理暂时失败，请稍后重试。';
}

function sanitizeFileNameForDisplay(name) {
    return String(name || 'story.txt').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function guessScriptFileType(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.json')) {
        return 'application/json';
    }
    if (lower.endsWith('.md')) {
        return 'text/markdown';
    }
    return 'text/plain';
}

function formatCharacterCount(value) {
    return Number(value || 0).toLocaleString('zh-CN');
}

function formatList(items, fallback) {
    const values = Array.isArray(items)
        ? items.map((item) => String(item || '').trim()).filter(Boolean)
        : [];
    return values.length ? values.join('、') : fallback;
}

function formatArcEstimate(value) {
    const count = Number(value || 0);
    return count > 0 ? `${count} 个阶段` : '自动判断';
}

function renderWizardTemplateOptions(selectedTemplate, enabled) {
    ui.wizardTemplateSelect.replaceChildren(...PRESENTATION_TEMPLATES.map((templateId) => {
        const option = document.createElement('option');
        option.value = templateId;
        option.textContent = templateLabels[templateId] || templateId;
        option.selected = templateId === selectedTemplate;
        return option;
    }));
    ui.wizardTemplateSelect.disabled = !enabled;
}

function renderPublishCheckList({ validation, bindingStatus, arcManifest, profileStatus }) {
    const summary = arcManifest ? summarizeSillyTavernBindings(arcManifest) : null;
    const chatSeedId = arcManifest?.sillyTavernBindings?.chatSeedId
        || arcManifest?.sillyTavernBindings?.target?.chatSeedId
        || '';
    const rows = [
        {
            label: '故事入口',
            state: validation.valid ? 'ok' : 'error',
            text: validation.valid ? '已载入，可以继续检查。' : '暂时无法读取故事入口。',
        },
        {
            label: '角色资料',
            state: summary?.characters?.length ? 'ok' : 'error',
            text: summary?.characters?.length
                ? `已找到 ${summary.characters.map((character) => character.id).join('、')}`
                : '缺少原版角色资料引用。',
        },
        {
            label: '世界设定',
            state: summary?.worldBooks?.length ? 'ok' : 'warning',
            text: summary?.worldBooks?.length
                ? `已找到 ${summary.worldBooks.map((worldBook) => worldBook.name).join('、')}`
                : '未声明世界设定；如故事需要世界设定，请先补齐。',
        },
        {
            label: '开场记录',
            state: chatSeedId ? 'ok' : 'error',
            text: chatSeedId ? `已绑定 ${chatSeedId}` : '缺少原版开场记录。',
        },
        {
            label: '回复通道',
            state: bindingStatus.ready ? 'ok' : 'error',
            text: bindingStatus.ready
                ? '可做发布前连通检查，回复仍由原版生成。'
                : friendlyBindingErrors(bindingStatus).join('；') || '故事材料未完整。',
        },
        {
            label: '界面样式',
            state: profileStatus.valid ? 'ok' : 'error',
            text: profileStatus.valid ? '已选择显示样式。' : profileStatus.errors.join('；') || '显示样式无效。',
        },
    ];

    ui.publishCheckList.replaceChildren(...rows.map((row) => {
        const item = document.createElement('li');
        item.className = `check-item is-${row.state}`;
        const label = document.createElement('strong');
        label.textContent = row.label;
        const text = document.createElement('span');
        text.textContent = row.text;
        item.append(label, text);
        return item;
    }));
}

function updatePublishStepList(validation, bindingStatus, selectedArc, profileStatus) {
    const readyToPublish = validation.valid && bindingStatus.ready && selectedArc && profileStatus.valid;
    const activeStep = !validation.valid
        ? 'choose'
        : !bindingStatus.ready
            ? 'check'
            : !selectedArc || !profileStatus.valid
                ? 'chapter'
                : 'publish';
    for (const item of ui.publishStepListItems()) {
        const step = item.dataset.step;
        item.classList.toggle('is-active', step === activeStep);
        item.classList.toggle('is-done', (
            (step === 'choose' && validation.valid)
            || (step === 'check' && validation.valid && bindingStatus.ready)
            || (step === 'chapter' && readyToPublish)
        ));
    }
}

function getBeginnerPublishBlockReason(validation, bindingStatus, profileStatus) {
    if (!validation.valid) {
        return friendlyValidationErrors(validation).join('；') || '故事入口还没有准备好。';
    }
    if (!bindingStatus.ready) {
        return friendlyBindingErrors(bindingStatus).join('；') || '故事材料还没有准备完整。';
    }
    if (!profileStatus.valid) {
        return profileStatus.errors.join('；') || '显示样式还没有准备好。';
    }
    return '发布前需要完成检查。';
}

function validateDraft() {
    const manifest = readDraftManifest();
    const validation = validateScenarioManifest(manifest);
    ui.validationResult.classList.toggle('is-ok', validation.valid);
    ui.validationResult.classList.toggle('is-error', !validation.valid);

    if (validation.valid) {
        const selectedArcId = getSelectedArcId(manifest);
        const bindingStatus = validateSillyTavernBindings(manifest, { arcId: selectedArcId });
        const bindingNote = bindingStatus.ready ? ' 故事材料可用于发布检查。' : ' 故事材料未完整。';
        const arcCount = getManifestArcBindings(manifest).length;
        const arcNote = arcCount > 1 ? ` 已登记 ${arcCount} 个幕章入口。` : '';
        const warnings = validation.warnings.length ? ` 警告：${validation.warnings.join('；')}` : '';
        ui.validationResult.textContent = `校验通过。${bindingNote}${arcNote}${warnings}`;
        return validation;
    }

    ui.validationResult.textContent = validation.errors.join('；') || '开发文件无法解析。';
    return validation;
}

async function publishDraft() {
    const manifest = readDraftManifest();
    const selectedArcId = getSelectedArcId(manifest);
    const validation = validateScenarioManifest(manifest);
    if (!validation.valid) {
        validateDraft();
        renderPublishWizard();
        setPublishResult(getBeginnerPublishBlockReason(validation, { ready: false, errors: [], warnings: [] }, { valid: true, errors: [] }), false);
        showToast('发布前需要先修正故事入口');
        return;
    }

    const bindingStatus = validateSillyTavernBindings(manifest, { arcId: selectedArcId });
    if (!bindingStatus.ready) {
        renderArcBindings();
        renderResourceBindings();
        renderPublishWizard();
        showToast('发布前需要补齐故事材料');
        await switchTab('publish');
        setPublishResult(friendlyBindingErrors(bindingStatus).join('；') || '发布前需要补齐故事材料。', false);
        return;
    }

    const diagnostic = await runOriginalResourceDiagnostic(manifest, selectedArcId);
    if (!diagnostic.ok) {
        renderPublishWizard();
        showToast('发布前需要补齐故事材料');
        await switchTab('publish');
        setPublishResult('发布前需要补齐故事材料。' + formatMissingOriginalResourceText(diagnostic), false);
        return;
    }

    const manifestForPublish = markSelectedArcForPublish(manifest, selectedArcId);
    const result = await releaseStore.publishManifest(manifestForPublish, { activeArcId: selectedArcId });
    if (!result.ok) {
        validateDraft();
        renderPublishWizard();
        setPublishResult('发布失败，当前玩家入口没有被替换。', false);
        showToast('发布前需要先修正故事入口');
        return;
    }
    ui.manifestEditor.value = formatJson(manifestForPublish);
    setPublishResult('已上架。玩家可以在作品选择里看到这个故事；已有存档不会被改动。', true);
    showToast('已上架');
    await renderAll();
    await switchTab('dashboard');
}

function markSelectedArcForPublish(manifest, activeArcId) {
    if (!Array.isArray(manifest?.arcs) || !manifest.arcs.length) {
        return manifest;
    }
    const selectedArcId = activeArcId || getSelectedArcId(manifest);
    const publishedAt = new Date().toISOString();
    const profileBoundManifest = bindAdaptivePresentationProfileHashes(manifest, { arcId: selectedArcId });
    return {
        ...profileBoundManifest,
        updatedAt: publishedAt,
        arcs: profileBoundManifest.arcs.map((arc) => (
            arc?.arcId === selectedArcId
                ? {
                    ...arc,
                    status: 'published',
                    publishedAt: arc.publishedAt || publishedAt,
                }
                : arc
        )),
    };
}

function renderResourceBindings() {
    const manifest = readDraftManifest();
    const selectedArcId = getSelectedArcId(manifest);
    const manifestForArc = materializeManifestForArc(manifest, selectedArcId);
    const validation = validateScenarioManifest(manifest);
    const bindingStatus = validateSillyTavernBindings(manifest, { arcId: selectedArcId });
    const summary = summarizeSillyTavernBindings(manifestForArc);
    const ready = validation.valid && bindingStatus.ready;

    renderAdvancedEvidence({
        validation,
        bindingStatus,
        summary,
        manifestForArc,
    });

    ui.resourceResult.classList.toggle('is-ok', ready);
    ui.resourceResult.classList.toggle('is-error', !ready);
    if (!validation.valid) {
        ui.resourceResult.textContent = '当前故事入口未通过基础校验。';
    } else if (bindingStatus.ready) {
        const warnings = bindingStatus.warnings.length ? ' 注意：' + bindingStatus.warnings.join('；') : '';
        ui.resourceResult.textContent = `当前章节 ${selectedArcId || '默认'} 的引用格式完整，发布前还需通过实时诊断。${warnings}`;
    } else {
        ui.resourceResult.textContent = [...bindingStatus.errors, ...bindingStatus.warnings].join('；') || '故事材料未完整。';
    }

    renderBindingList(ui.characterBindingList, summary.characters, (character) => [
        ['角色资料', character.id],
        ['角色定位', character.role],
        ['头像引用', character.avatar || '未绑定'],
    ]);
    renderBindingList(ui.worldBookBindingList, summary.worldBooks, (worldBook) => [
        ['世界设定', worldBook.name],
        ['激活模式', worldBook.mode],
        ['权重', worldBook.weight === null ? '原版默认' : String(worldBook.weight)],
    ]);
    renderBindingList(ui.settingBindingList, summary.settings, (setting) => [
        [setting.label, setting.bound ? setting.value : '未绑定'],
    ]);
}

function renderArcBindings() {
    const manifest = readDraftManifest();
    const validation = validateScenarioManifest(manifest);
    const arcs = getManifestArcBindings(manifest);
    const selectedArcId = getSelectedArcId(manifest);

    ui.arcPublishSelect.replaceChildren();
    for (const arc of arcs) {
        const option = document.createElement('option');
        option.value = arc.arcId;
        option.textContent = `${arc.order || '-'} · ${arc.title || arc.arcId}`;
        option.selected = arc.arcId === selectedArcId;
        ui.arcPublishSelect.append(option);
    }

    ui.arcResult.classList.toggle('is-ok', validation.valid && arcs.length > 0);
    ui.arcResult.classList.toggle('is-error', !validation.valid || !arcs.length);
    if (!validation.valid) {
        ui.arcResult.textContent = '当前故事入口未通过基础校验，暂不能发布幕章。';
    } else if (!arcs.length) {
        ui.arcResult.textContent = '当前故事没有可发布章节。';
    } else {
        const selectedStatus = validateSillyTavernBindings(manifest, { arcId: selectedArcId });
        ui.arcResult.classList.toggle('is-ok', selectedStatus.ready);
        ui.arcResult.classList.toggle('is-error', !selectedStatus.ready);
        ui.arcResult.textContent = selectedStatus.ready
            ? `当前选择 ${selectedArcId || '默认章节'}。材料格式完整；发布前仍需通过更多检查。`
            : `当前选择 ${selectedArcId || '默认章节'} 暂不能发布：${[
                ...selectedStatus.errors,
                ...selectedStatus.warnings,
            ].join('；') || '故事材料未完整。'}`;
    }

    ui.arcList.replaceChildren();
    if (!arcs.length) {
        const empty = document.createElement('div');
        empty.className = 'binding-empty';
        empty.textContent = '暂无幕章入口';
        ui.arcList.append(empty);
        return;
    }

    for (const arc of arcs) {
        const card = document.createElement('article');
        card.className = 'arc-card';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = arc.title || arc.arcId;
        const arcManifest = materializeManifestForArc(manifest, arc.arcId);
        const summary = summarizeSillyTavernBindings(arcManifest);
        const bindingStatus = validateSillyTavernBindings(manifest, { arcId: arc.arcId });
        card.classList.toggle('is-ready', bindingStatus.ready);
        card.classList.toggle('is-blocked', !bindingStatus.ready);
        const meta = document.createElement('span');
        meta.textContent = [
            `状态 ${formatArcStatus(arc.status)}`,
            `角色资料 ${summary.characters.length ? '已准备' : '待补齐'}`,
            `世界设定 ${summary.worldBooks.length ? '已准备' : '未声明'}`,
            `开场记录 ${getArcChatSeedLabel(arcManifest)}`,
            bindingStatus.ready ? '可做实时诊断' : '待补齐',
            '高级运行项需验收',
        ].join(' · ');
        const detail = document.createElement('p');
        detail.className = 'arc-card-detail';
        detail.textContent = bindingStatus.ready
            ? '发布前仍需通过更多检查；运行中验证只对已有证据的项目显示通过。'
            : [...bindingStatus.errors, ...bindingStatus.warnings].join('；') || '故事材料未完整。';
        info.append(title, meta);
        info.append(detail);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = arc.arcId === selectedArcId ? '已选择' : '选择';
        button.disabled = arc.arcId === selectedArcId;
        button.addEventListener('click', () => {
            ui.arcPublishSelect.value = arc.arcId;
            renderArcBindings();
            renderResourceBindings();
        });
        card.append(info, button);
        ui.arcList.append(card);
    }
}

function renderAdaptiveProfileControls({ keepTemplate = false } = {}) {
    const manifest = readDraftManifest();
    if (!manifest || typeof manifest !== 'object') {
        setProfileResult('当前开发文件无法解析。', false);
        ui.profileArcName.textContent = '-';
        ui.profileTemplateSelect.replaceChildren();
        ui.profileModuleList.replaceChildren();
        return;
    }

    const selectedArc = getSelectedArc(manifest);
    const profileId = selectedArc?.presentationProfileId || 'default';
    const currentProfile = getDraftAdaptiveProfile(manifest, profileId);
    const template = keepTemplate
        ? ui.profileTemplateSelect.value || currentProfile.template
        : currentProfile.template;
    const displayProfile = keepTemplate
        ? createDefaultAdaptivePresentationProfile({ profileId, template })
        : currentProfile;
    const enabledModules = getEnabledAdaptiveModules(displayProfile);

    ui.profileArcName.textContent = `${selectedArc?.title || selectedArc?.arcId || '默认幕章'} · ${profileId}`;
    ui.profileTemplateSelect.replaceChildren(...PRESENTATION_TEMPLATES.map((templateId) => {
        const option = document.createElement('option');
        option.value = templateId;
        option.textContent = templateLabels[templateId] || templateId;
        option.selected = templateId === template;
        return option;
    }));

    ui.profileModuleList.replaceChildren(...PRESENTATION_MODULES.map((moduleId) => {
        const label = document.createElement('label');
        label.className = 'profile-module-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = moduleId;
        input.checked = enabledModules.has(moduleId);
        const span = document.createElement('span');
        span.textContent = moduleLabels[moduleId] || moduleId;
        label.append(input, span);
        return label;
    }));

    const profileStatus = validateAdaptivePresentationProfile(currentProfile);
    const manifestStatus = validateAdaptivePresentationProfiles(manifest);
    const ok = profileStatus.valid && manifestStatus.ready;
    setProfileResult(ok
        ? '展示配置有效。它只影响玩家端是否显示对应信息栏；信息值仍从故事聊天文本读取。'
        : [...profileStatus.errors, ...manifestStatus.errors].join('；') || '展示配置无效。',
    ok);
}

function applyAdaptiveProfileToDraft() {
    const manifest = readDraftManifest();
    if (!manifest || typeof manifest !== 'object') {
        setProfileResult('当前开发文件无法解析。', false);
        return;
    }

    const selectedArc = getSelectedArc(manifest);
    const profileId = selectedArc?.presentationProfileId || 'default';
    const existingProfile = getDraftAdaptiveProfile(manifest, profileId);
    const enabledModules = [...ui.profileModuleList.querySelectorAll('input[type="checkbox"]:checked')]
        .map((input) => input.value)
        .filter((moduleId) => PRESENTATION_MODULES.includes(moduleId));
    const disabledModules = PRESENTATION_MODULES.filter((moduleId) => !enabledModules.includes(moduleId));
    const template = ui.profileTemplateSelect.value || existingProfile.template;
    const nextProfile = createDefaultAdaptivePresentationProfile({
        ...existingProfile,
        profileId,
        template,
        preferredModules: enabledModules,
        disabledModules,
        visualPriority: {
            ...existingProfile.visualPriority,
            primaryPanel: enabledModules[0] || 'actions',
            secondaryPanels: enabledModules.slice(1, 5),
        },
    });
    const profileStatus = validateAdaptivePresentationProfile(nextProfile);
    if (!profileStatus.valid) {
        setProfileResult(profileStatus.errors.join('；'), false);
        return;
    }

    const nextManifest = {
        ...manifest,
        adaptivePresentationProfiles: {
            ...(manifest.adaptivePresentationProfiles || {}),
            [profileId]: nextProfile,
        },
    };
    ui.manifestEditor.value = formatJson(nextManifest);
    validateDraft();
    renderArcBindings();
    renderPublishWizard();
    renderResourceBindings();
    renderAdaptiveProfileControls();
    showToast('已应用展示配置');
}

function renderVisualAssetControls() {
    if (!visualAssetState.service.configured) {
        visualAssetState.service.url = getVisualAssetServiceBaseUrl();
        visualAssetState.service.configured = Boolean(visualAssetState.service.url);
    }
    const message = isLocalVisualAdminEntry() && visualAssetState.service.configured
        ? '本地视觉后台已接入；请选择一种素材图片上传。'
        : visualAssetState.service.configured
        ? '视觉素材服务已配置；请选择一种素材图片上传。'
        : '未配置视觉素材服务。请先通过受控管理员部署边界接入，浏览器页面不会保存服务密钥。';
    setVisualServiceStatus(message, visualAssetState.service.configured);
}

async function uploadSimpleVisualFileForType(input) {
    const assetType = input?.dataset?.visualUploadType || '';
    if (!Object.prototype.hasOwnProperty.call(visualAssetTypeLabels, assetType)) {
        throw new Error('VISUAL_ASSET_BAD_TYPE');
    }
    const file = input.files?.[0];
    if (!file) {
        setSimpleVisualCardStatus(assetType, '请选择 8 位、非隔行 RGB/RGBA PNG 图片。', false);
        return;
    }
    if (file.type && file.type !== 'image/png') {
        setSimpleVisualCardStatus(assetType, '当前只支持 8 位、非隔行的 RGB/RGBA PNG 图片。', false);
        return;
    }
    const uploadBody = {
        schemaVersion: 'galgame.visual-simple-upload-request.v1',
        assetType,
        title: createSimpleVisualTitle(assetType, file),
        imageBase64: await fileToBase64(file),
        tagCodes: [],
        fileName: sanitizeVisualUploadFileName(file?.name || ''),
    };
    setVisualBusy(true);
    setSimpleVisualCardStatus(assetType, '正在上传。', true);
    setVisualServiceStatus('正在保存图片。', true);
    const uploadResult = await visualAdminFetch('/v1/admin/visual/upload', {
        method: 'POST',
        body: uploadBody,
        timeoutMs: 15000,
    });
    if (!uploadResult.ok) {
        throw new Error(uploadResult.error?.code || 'VISUAL_ASSET_UPLOAD_FAILED');
    }
    setSimpleVisualCardStatus(assetType, formatVisualAnalysisStatus(uploadResult.asset?.analysis, '图片已保存，正在应用。'), true);
    const publishResult = await visualAdminFetch('/v1/admin/visual/publish', {
        method: 'POST',
        body: {},
        timeoutMs: 15000,
    });
    setVisualBusy(false);
    if (!publishResult.ok) {
        throw new Error(publishResult.error?.code || 'VISUAL_SIMPLE_PUBLISH_FAILED');
    }
    setSimpleVisualCardStatus(assetType, '已上传并应用到游戏画面。', true);
    setVisualServiceStatus('图片已上传并应用。可以继续上传其它类型。', true);
    showToast(`${visualAssetTypeLabels[assetType]}图片已上传`);
}

function formatVisualAnalysisStatus(analysis, fallback) {
    if (analysis?.status === 'ready') return '图片已保存，识别已完成，正在发布。';
    if (analysis?.status === 'failed') return '图片已保存，识别未完成，图片仍可使用，正在发布。';
    if (analysis?.status === 'unavailable') return '图片已保存，识别未完成，图片仍可使用，正在发布。';
    return fallback;
}

function createSimpleVisualTitle(assetType, file) {
    const rawName = String(file?.name || '').replace(/\.[^.]+$/, '').trim();
    const base = rawName ? clampText(rawName, 56) : `${visualAssetTypeLabels[assetType]}图片`;
    return `${visualAssetTypeLabels[assetType]}-${base}`.slice(0, 80);
}

function setSimpleVisualCardStatus(assetType, message, ok) {
    const status = document.querySelector(`[data-simple-visual-type="${CSS.escape(assetType)}"] .simple-visual-upload-status`);
    if (!status) {
        return;
    }
    status.textContent = message;
    status.classList.toggle('is-ok', Boolean(ok));
    status.classList.toggle('is-error', ok === false);
}

function sanitizeVisualUploadFileName(value) {
    const name = String(value || '').split(/[\\/]/).pop() || '';
    return name.replace(/[^\w .()-]/g, '_').slice(0, 120) || 'upload.png';
}

function updateVisualSimpleButtons() {
    const busy = visualAssetState.busy;
    ui.simpleVisualUploadInputs.forEach((input) => {
        input.disabled = busy;
    });
}

function setVisualBusy(busy) {
    visualAssetState.busy = busy;
    updateVisualSimpleButtons();
}

function setVisualServiceStatus(message, ok) {
    if (!ui.visualServiceStatus) {
        return;
    }
    ui.visualServiceStatus.textContent = message;
    ui.visualServiceStatus.classList.toggle('is-ok', Boolean(ok));
    ui.visualServiceStatus.classList.toggle('is-error', !ok);
}

function getVisualAssetServiceBaseUrl() {
    return window.GALGAME_VISUAL_ASSET_SERVICE_URL
        || document.querySelector('meta[name="galgame-visual-asset-service"]')?.content
        || '';
}

function requireVisualAssetServiceBaseUrl() {
    const baseUrl = getVisualAssetServiceBaseUrl().replace(/\/+$/, '');
    visualAssetState.service.url = baseUrl;
    visualAssetState.service.configured = Boolean(baseUrl);
    if (!baseUrl) {
        throw new Error('VISUAL_ASSET_SERVICE_NOT_CONFIGURED');
    }
    return baseUrl;
}

function isLocalVisualAdminEntry() {
    return window.GALGAME_VISUAL_ASSET_LOCAL_ADMIN === true
        || document.querySelector('meta[name="galgame-visual-asset-local-admin"]')?.content === 'true';
}

function getVisualAdminRequestPath(path) {
    if (!isLocalVisualAdminEntry()) {
        return path;
    }
    if (path === '/v1/admin/visual/upload') return '/v1/local-admin/visual/upload';
    if (path === '/v1/admin/visual/publish') return '/v1/local-admin/visual/publish';
    return path;
}

async function visualAdminFetch(path, { method = 'GET', body = null, timeoutMs = 8000 } = {}) {
    const visualMediaServiceBaseUrl = requireVisualAssetServiceBaseUrl();
    const requestPath = getVisualAdminRequestPath(path);
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const headers = {};
    if (body) {
        headers['content-type'] = 'application/json';
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod)) {
        const csrfToken = getVisualAssetCsrfToken();
        if (!csrfToken) {
            return {
                ok: false,
                error: { code: 'VISUAL_ASSET_CSRF_NOT_CONFIGURED' },
            };
        }
        headers['x-galgame-csrf-token'] = csrfToken;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${visualMediaServiceBaseUrl}${requestPath}`, {
            method: normalizedMethod,
            credentials: 'include',
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
        });
        const text = await response.text();
        const parsed = text ? safeJsonParse(text, null) : null;
        if (!response.ok || !parsed?.ok) {
            return {
                ok: false,
                error: parsed?.error || { code: `HTTP_${response.status}` },
            };
        }
        return parsed;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('VISUAL_ASSET_SERVICE_TIMEOUT');
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

function getVisualAssetCsrfToken() {
    const token = window.GALGAME_VISUAL_ASSET_CSRF_TOKEN
        || document.querySelector('meta[name="galgame-visual-asset-csrf-token"]')?.content
        || '';
    return /^[A-Za-z0-9._:-]{16,256}$/.test(token) ? token : '';
}

async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
}

function formatVisualError(error) {
    const code = error?.message || String(error || '');
    if (code === 'VISUAL_ASSET_PNG_UNSUPPORTED') {
        return '当前只支持 8 位、非隔行的 RGB/RGBA PNG 图片。请转换后重试。';
    }
    if (code === 'VISUAL_ASSET_SERVICE_NOT_CONFIGURED') {
        return '视觉素材服务未配置。请先通过受控管理员部署边界接入。';
    }
    if (code === 'VISUAL_ASSET_CSRF_NOT_CONFIGURED') {
        return '管理员写入保护未配置。请通过受控部署边界完成安全校验后再操作。';
    }
    if (/TIMEOUT|Abort/i.test(code)) {
        return '视觉素材服务响应超时，请稍后重试。';
    }
    if (/401|403|AUTH|ORIGIN|CSRF/i.test(code)) {
        return '管理员访问边界未通过，请检查外部登录或反向代理配置。';
    }
    if (/409|CONFLICT|STATE/i.test(code)) {
        return '目录状态已变化，请刷新后再操作。';
    }
    if (/HTTP_5|5\d\d|SERVER/i.test(code)) {
        return '视觉素材服务出错，请稍后重试或联系管理员。';
    }
    if (/VALID|BAD|UNKNOWN_CODE|ROLE|LICENSE|IMAGE|SIZE/i.test(code)) {
        return '素材或目录信息未通过校验，请检查字段后重试。';
    }
    return '视觉素材服务暂时不可用。';
}

function clampText(value, maxLength) {
    const text = String(value || '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function applyWizardTemplateToDraft() {
    const manifest = readDraftManifest();
    if (!manifest || typeof manifest !== 'object') {
        setPublishResult('当前故事入口无法读取，暂不能选择样式。', false);
        renderPublishWizard();
        return;
    }

    const selectedArc = getSelectedArc(manifest);
    const profileId = selectedArc?.presentationProfileId || 'default';
    const template = ui.wizardTemplateSelect.value || 'visual-novel';
    const nextProfile = createDefaultAdaptivePresentationProfile({
        profileId,
        template,
    });
    const profileStatus = validateAdaptivePresentationProfile(nextProfile);
    if (!profileStatus.valid) {
        setPublishResult(profileStatus.errors.join('；') || '显示样式无效。', false);
        return;
    }

    const nextManifest = {
        ...manifest,
        adaptivePresentationProfiles: {
            ...(manifest.adaptivePresentationProfiles || {}),
            [profileId]: nextProfile,
        },
    };
    ui.manifestEditor.value = formatJson(nextManifest);
    validateDraft();
    renderArcBindings();
    renderPublishWizard();
    renderResourceBindings();
    renderAdaptiveProfileControls();
    showToast('已选择界面样式');
}

function getDraftAdaptiveProfile(manifest, profileId) {
    const profiles = manifest?.adaptivePresentationProfiles
        || manifest?.presentationProfiles
        || {};
    return createDefaultAdaptivePresentationProfile({
        profileId,
        ...(profiles[profileId] || profiles.default || {}),
    });
}

function getEnabledAdaptiveModules(profile) {
    const preferred = new Set(profile.preferredModules || []);
    const disabled = new Set(profile.disabledModules || []);
    const source = preferred.size ? preferred : new Set(PRESENTATION_MODULES);
    return new Set([...source].filter((moduleId) => !disabled.has(moduleId)));
}

function getSelectedArc(manifest) {
    const selectedArcId = getSelectedArcId(manifest);
    return getManifestArcBindings(manifest).find((arc) => arc.arcId === selectedArcId)
        || getManifestArcBindings(manifest)[0]
        || null;
}

async function validateDraftWithLiveResources() {
    const validation = validateDraft();
    if (!validation.valid) {
        renderPublishWizard();
        return validation;
    }
    const manifest = readDraftManifest();
    const selectedArcId = getSelectedArcId(manifest);
    const bindingStatus = validateSillyTavernBindings(manifest, { arcId: selectedArcId });
    if (!bindingStatus.ready) {
        renderArcBindings();
        renderResourceBindings();
        renderPublishWizard();
        return validation;
    }
    const diagnostic = await runOriginalResourceDiagnostic(manifest, selectedArcId);
    ui.validationResult.classList.toggle('is-ok', diagnostic.ok);
    ui.validationResult.classList.toggle('is-error', !diagnostic.ok);
    ui.validationResult.textContent = diagnostic.ok
        ? '校验通过。故事材料存在性检查通过，可以发布。'
        : '校验未通过。' + formatMissingOriginalResourceText(diagnostic);
    renderPublishWizard();
    return validation;
}

function getSelectedArcId(manifest) {
    const arcs = getManifestArcBindings(manifest);
    const selected = ui.arcPublishSelect?.value || '';
    if (selected && arcs.some((arc) => arc.arcId === selected)) {
        return selected;
    }
    const defaultArcId = getDefaultArcId(manifest);
    if (defaultArcId && arcs.some((arc) => arc.arcId === defaultArcId)) {
        return defaultArcId;
    }
    return arcs[0]?.arcId || '';
}

async function checkOriginalResourcesLive() {
    const manifest = readDraftManifest();
    const selectedArcId = getSelectedArcId(manifest);
    const validation = validateScenarioManifest(manifest);
    if (!validation.valid) {
        setResourceLiveResult('当前故事入口未通过基础校验，暂不执行原版连通测试。', false);
        return;
    }

    await runOriginalResourceDiagnostic(manifest, selectedArcId);
}

async function runOriginalResourceDiagnostic(manifest, arcId = '') {
    setResourceLiveResult('正在读取资源列表...', true);
    setArcResult('正在读取资源列表...', true);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
        const adapter = new SillyTavernAdapter({ baseUrl: getSillyTavernBaseUrl() });
        const diagnostic = await adapter.diagnoseOriginalResourceAvailability(materializeManifestForArc(manifest, arcId), controller.signal);
        const resultText = formatOriginalResourceDiagnostic(diagnostic);
        setResourceLiveResult(resultText, diagnostic.ok);
        setArcResult(resultText, diagnostic.ok);
        return diagnostic;
    } finally {
        window.clearTimeout(timer);
    }
}

function renderBindingList(container, items, toRows) {
    container.replaceChildren();
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'binding-empty';
        empty.textContent = '暂无绑定';
        container.append(empty);
        return;
    }

    for (const item of items) {
        const card = document.createElement('article');
        card.className = 'binding-card';
        for (const [label, value] of toRows(item)) {
            const row = document.createElement('div');
            const key = document.createElement('span');
            key.textContent = label;
            const itemValue = document.createElement('strong');
            itemValue.textContent = value;
            row.append(key, itemValue);
            card.append(row);
        }
        container.append(card);
    }
}

function renderAdvancedEvidence({ validation, bindingStatus, summary, manifestForArc }) {
    const chatSeedId = manifestForArc?.sillyTavernBindings?.chatSeedId
        || manifestForArc?.sillyTavernBindings?.target?.chatSeedId
        || '';
    const settingRows = new Map((summary?.settings || []).map((setting) => [setting.label, setting]));
    const referenceRows = [
        {
            label: '角色资料',
            status: summary.characters.length ? '引用存在' : '缺少引用',
            ok: summary.characters.length > 0,
        },
        {
            label: '世界设定',
            status: summary.worldBooks.length ? '引用存在' : '未声明',
            ok: summary.worldBooks.length > 0,
        },
        {
            label: '开场记录',
            status: chatSeedId ? '引用存在' : '缺少引用',
            ok: Boolean(chatSeedId),
        },
        {
            label: '基础格式',
            status: validation.valid && bindingStatus.ready ? '可继续诊断' : '需要处理',
            ok: validation.valid && bindingStatus.ready,
        },
    ];
    const runtimeRows = [
        {
            label: '原版资料存在性',
            status: '点击“测试原版连通”后更新',
            ok: null,
        },
        {
            label: '目标记录读回',
            status: '由玩家链路或专项 smoke 验收',
            ok: null,
        },
        {
            label: '世界设定本次运行',
            status: '只在真实生成证据中显示已验证',
            ok: null,
        },
    ];
    const deferredRows = [
        ['Generation preset', '运行风格'],
        ['Instruct preset', '指令格式'],
        ['System prompt', '系统文本'],
        ['Context preset', '上下文模板'],
    ].map(([key, label]) => {
        const setting = settingRows.get(key);
        return {
            label,
            status: setting?.bound ? '引用存在，自动切换暂未接入' : '未绑定，自动切换暂未接入',
            ok: null,
        };
    });

    renderEvidenceList(ui.referenceEvidenceList, referenceRows);
    renderEvidenceList(ui.runtimeEvidenceList, runtimeRows);
    renderEvidenceList(ui.deferredEvidenceList, deferredRows);
}

function renderEvidenceList(container, rows) {
    container.replaceChildren(...rows.map((row) => {
        const item = document.createElement('div');
        item.className = 'evidence-row';
        item.classList.toggle('is-ok', row.ok === true);
        item.classList.toggle('is-error', row.ok === false);
        item.classList.toggle('is-pending', row.ok === null);
        const label = document.createElement('span');
        label.textContent = row.label;
        const status = document.createElement('strong');
        status.textContent = row.status;
        item.append(label, status);
        return item;
    }));
}

async function renderMediaSettings() {
    const config = await getMediaConfig();
    ui.mediaEnabledInput.checked = config.enabled;
    ui.mediaEndpointInput.value = config.endpoint;
    ui.mediaResult.textContent = config.enabled ? '媒体接口已启用。' : '媒体接口未启用，玩家端使用降级画面。';
    ui.mediaResult.classList.toggle('is-ok', !config.enabled || Boolean(config.endpoint));
    ui.mediaResult.classList.toggle('is-error', config.enabled && !config.endpoint);
}

async function saveMediaSettings() {
    await saveMediaConfig({
        enabled: ui.mediaEnabledInput.checked,
        endpoint: ui.mediaEndpointInput.value,
    });
    showToast('已保存媒体配置');
    await renderMediaSettings();
}

async function testMedia() {
    await saveMediaSettings();
    const config = await getMediaConfig();
    if (!config.enabled || !config.endpoint) {
        setMediaResult('媒体接口未启用。', false);
        return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(`${config.endpoint.replace(/\/+$/, '')}/v1/health`, {
            signal: controller.signal,
        });
        setMediaResult(response.ok ? '连接正常。' : '接口暂时不可用。', response.ok);
    } catch {
        setMediaResult('接口暂时不可用。', false);
    } finally {
        window.clearTimeout(timer);
    }
}

function setMediaResult(message, ok) {
    ui.mediaResult.textContent = message;
    ui.mediaResult.classList.toggle('is-ok', ok);
    ui.mediaResult.classList.toggle('is-error', !ok);
}

function setResourceLiveResult(message, ok) {
    ui.resourceLiveResult.textContent = message;
    ui.resourceLiveResult.classList.toggle('is-ok', ok);
    ui.resourceLiveResult.classList.toggle('is-error', !ok);
}

function setArcResult(message, ok) {
    ui.arcResult.textContent = message;
    ui.arcResult.classList.toggle('is-ok', ok);
    ui.arcResult.classList.toggle('is-error', !ok);
}

function setPublishResult(message, ok) {
    ui.publishResult.textContent = message;
    ui.publishResult.classList.toggle('is-ok', ok);
    ui.publishResult.classList.toggle('is-error', !ok);
}

function setProfileResult(message, ok) {
    ui.profileResult.textContent = message;
    ui.profileResult.classList.toggle('is-ok', ok);
    ui.profileResult.classList.toggle('is-error', !ok);
}

function formatArcStatus(status = '') {
    if (status === 'published') {
        return '已发布';
    }
    if (status === 'archived') {
        return '已归档';
    }
    return '待验证';
}

function getArcChatSeedLabel(manifest) {
    const chatSeedId = manifest?.sillyTavernBindings?.chatSeedId
        || manifest?.sillyTavernBindings?.target?.chatSeedId
        || '';
    return chatSeedId ? '已准备' : '待补齐';
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return '-';
    }
    return date.toLocaleString();
}

function formatOriginalResourceDiagnostic(diagnostic) {
    const health = diagnostic.checks.find((check) => check.name === 'sillytavern-health');
    const characters = diagnostic.checks.find((check) => check.name === 'characters-list');
    const worldBooks = diagnostic.checks.find((check) => check.name === 'worldbooks-list');
    const settings = diagnostic.checks.find((check) => check.name === 'settings-get');
    const missing = missingOriginalResourceReferences(diagnostic);

    if (!diagnostic.ok) {
        return `更多检查未通过。连接：${health?.ok ? '正常' : '异常'}；角色资料：${characters?.ok ? characters.details.count : '不可用'}；世界设定：${worldBooks?.ok ? worldBooks.details.count : '不可用'}；运行风格：${settings?.ok ? '已读取' : '不可用'}。${formatMissingOriginalResourceText(diagnostic)}`;
    }

    return `更多检查通过。角色资料 ${characters.details.count} 项，世界设定 ${worldBooks.details.count} 项，运行风格已读取；当前故事只保存引用，资源本体仍由原版维护入口维护。`;
}

function missingOriginalResourceReferences(diagnostic) {
    return diagnostic.checks
        .flatMap((check) => check.details?.missing || [])
        .filter(Boolean);
}

function formatMissingOriginalResourceText(diagnostic) {
    const missing = missingOriginalResourceReferences(diagnostic);
    return missing.length
        ? `缺少引用：${missing.join('、')}。`
        : '资源服务不可用，无法确认绑定是否存在。';
}

function friendlyValidationErrors(validation) {
    const errors = validation?.errors || [];
    if (!errors.length) {
        return [];
    }
    return errors.map((error) => {
        if (/schemaVersion|Unsupported schemaVersion/i.test(error)) {
            return '故事文件版本不匹配';
        }
        if (/\bid\b|title|version|locale/i.test(error)) {
            return '故事名称或版本信息不完整';
        }
        if (/presentation/i.test(error)) {
            return '默认画面素材未准备好';
        }
        if (/chatSeedId/i.test(error)) {
            return '缺少开场记录';
        }
        if (/character|group/i.test(error)) {
            return '缺少角色资料';
        }
        if (/world book|worldBooks|worldBook/i.test(error)) {
            return '世界设定填写不完整';
        }
        if (/adaptivePresentationProfiles|profile/i.test(error)) {
            return '界面样式配置不完整';
        }
        return error;
    });
}

function friendlyBindingErrors(bindingStatus) {
    const messages = [...(bindingStatus?.errors || []), ...(bindingStatus?.warnings || [])];
    if (!messages.length) {
        return [];
    }
    return messages.map((message) => {
        if (/chatSeedId/i.test(message)) {
            return '缺少开场记录';
        }
        if (/character|group/i.test(message)) {
            return '缺少角色资料';
        }
        if (/world book|worldBooks|worldBook/i.test(message)) {
            return '世界设定未准备好';
        }
        if (/avatar/i.test(message)) {
            return '角色头像引用未准备好';
        }
        if (/sillyTavernBindings/i.test(message)) {
            return '故事材料引用未填写';
        }
        return message;
    });
}

async function renderSystemStatus() {
    const mediaConfig = await getMediaConfig();
    const configHealth = await releaseStore.healthCheck();
    const releaseMode = releaseStore.getMode();
    const configStatus = releaseMode === 'external-config-service'
        ? configHealth.ok ? '已接入' : '不可用，使用本地缓存'
        : '本地演示';
    const items = [
        ['原版能力', '保持独立，未改动'],
        ['玩家端入口', 'public/game'],
        ['管理端入口', 'public/game-admin'],
        ['共享协议', 'frontend/shared'],
        ['配置服务', configStatus],
        ['媒体接入', mediaConfig.enabled ? '外部接口已配置' : '等待外部接口'],
        ['当前模式', releaseMode === 'external-config-service' ? '共享部署' : '本地演示'],
    ];

    ui.systemStatus.replaceChildren();
    for (const [label, value] of items) {
        const item = document.createElement('article');
        item.className = 'status-item';
        const span = document.createElement('span');
        span.textContent = label;
        const strong = document.createElement('strong');
        strong.textContent = value;
        item.append(span, strong);
        ui.systemStatus.append(item);
    }
}

function readDraftManifest() {
    return safeJsonParse(ui.manifestEditor.value, null);
}

function formatJson(value) {
    return JSON.stringify(value, null, 2);
}

function getSillyTavernBaseUrl() {
    return window.GALGAME_SILLYTAVERN_BASE_URL
        || document.querySelector('meta[name="sillytavern-base-url"]')?.content
        || '';
}

function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('is-visible');
    window.setTimeout(() => {
        ui.toast.classList.remove('is-visible');
    }, 1800);
}
