import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
    createScriptImportAssistantService,
    MemoryDraftStore,
} from '../../external-modules/script-import-assistant/server.mjs';
import { createOriginalSillyTavernImporter } from '../../external-modules/script-import-assistant/original-st-importer.mjs';
import {
    createConfigService,
    MemoryConfigStore,
} from '../../external-modules/game-config-service/server.mjs';
import {
    BrowserOriginalRuntimeBridge,
    createOriginalRuntimeBridgeServer,
} from '../../external-modules/original-runtime-bridge/server.mjs';
import {
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';
import {
    bindAdaptivePresentationProfileHashes,
    materializeManifestForArc,
} from '../shared/src/protocol.js';
import {
    BUILTIN_TEMPLATE_MODULES,
    PRESENTATION_TEMPLATES,
    convertPresentationRecommendationToProfile,
} from '../shared/src/adaptive-presentation-schema.js';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/aa5-full-upload-to-play-smoke.json');
const sillyTavernBaseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
let assistantPort = Number(args['assistant-port'] || 0);
let configPort = Number(args['config-port'] || 0);
let bridgePort = Number(args['bridge-port'] || 0);
let playerStaticPort = Number(args['player-static-port'] || 0);
const adminToken = `aa5-admin-${randomUUID()}`;
const llmSecret = `aa5-llm-${randomUUID()}`;
const proofSecret = randomUUID();
const runId = String(args['run-id'] || Date.now().toString(36)).toLowerCase();
const templateId = normalizeTemplateId(args.template || 'rpg-adventure');
const uap7RealAdminUiFlow = args['uap7-real-admin-ui-flow'] === 'true';
const providerMode = args['provider-mode'] || (uap7RealAdminUiFlow ? 'deterministic' : 'controlled');
const useControlledProvider = providerMode !== 'deterministic';
const scriptFixturePath = args['script-fixture']
    ? path.resolve(repoRoot, args['script-fixture'])
    : '';
const evidence = {
    ok: false,
    generatedAt: new Date().toISOString(),
    mode: 'aa5-script-import-assistant-full-upload-to-play-smoke',
    sillyTavernBaseUrl,
    runId,
    templateId,
    scriptFixture: scriptFixturePath ? toRepoPath(scriptFixturePath) : '',
    checks: {},
    failures: [],
    boundaries: {
        provider: useControlledProvider
            ? 'controlled-service-side-fake-openai-compatible'
            : 'deterministic-import-only-fallback',
        realExternalLlmNetwork: useControlledProvider
            ? 'blocked-no-explicit-service-credentials'
            : 'not-claimed-no-explicit-service-credentials',
        stInternalSettingsRead: false,
        playerCallsAssistant: false,
        playerStoresProviderSecret: false,
        frozenSillyTavernFilesModified: false,
    },
};

await mkdir(path.dirname(evidencePath), { recursive: true });

let assistantServer = null;
let configServer = null;
let runtimeBridge = null;

try {
    playerStaticPort = playerStaticPort || await getFreePort(8789);
    const playerStaticOrigin = `http://127.0.0.1:${playerStaticPort}`;
    const fakeProvider = useControlledProvider ? createFakeProviderPlan({
        title: `AA5 全链路故事 ${runId}`,
        characterName: `Galgame_AIImport_AA5Full_${runId}_Director`,
        characterAvatar: `galgame_aiimport_aa5full_${runId}_director.png`,
        worldBookName: `Galgame_AIImport_AA5Full_${runId}_World`,
        chatSeedId: `galgame-aiimport-aa5full-${runId}-seed`,
        template: templateId,
    }) : { fetch: null, calls: [] };
    const assistantOptions = {
        store: new MemoryDraftStore(),
        adminToken,
        corsOrigin: playerStaticOrigin,
        resourceImporter: createOriginalSillyTavernImporter({ baseUrl: sillyTavernBaseUrl }),
    };
    if (useControlledProvider) {
        Object.assign(assistantOptions, {
            llmBaseUrl: 'https://aa5-provider.example/v1',
            llmModel: 'aa5-planner',
            llmApiKey: llmSecret,
            llmFetch: fakeProvider.fetch,
            llmRetryCount: 0,
        });
    }
    assistantServer = createScriptImportAssistantService(assistantOptions);

    assistantPort = await listen(assistantServer, assistantPort);
    configServer = createConfigService({
        store: new MemoryConfigStore(),
        proofSecret,
        sillyTavernBaseUrl,
        corsOrigin: playerStaticOrigin,
    });
    const runtimeBridgeUserDataDir = path.join(repoRoot, '.codex-longrun', 'evidence', `aa5-runtime-bridge-chrome-${runId}`);
    await mkdir(runtimeBridgeUserDataDir, { recursive: true });
    const runtime = new BrowserOriginalRuntimeBridge({
        userDataDir: runtimeBridgeUserDataDir,
        logger: quietLogger(),
    });
    runtimeBridge = createOriginalRuntimeBridgeServer({
        runtime,
        proofSecret,
        sillyTavernBaseUrl,
        allowedOrigins: [playerStaticOrigin],
        logger: quietLogger(),
    });
    evidence.boundaries.runtimeBridgeChrome = {
        testOnlyUniqueUserDataDir: toRepoPath(runtimeBridgeUserDataDir),
        reusesPersistentBridge: false,
        touchesOldBridgeProcess: false,
    };

    configPort = await listen(configServer, configPort);
    bridgePort = await listen(runtimeBridge, bridgePort);

    const assistantBaseUrl = `http://127.0.0.1:${assistantPort}`;
    const configBaseUrl = `http://127.0.0.1:${configPort}`;
    const bridgeBaseUrl = `http://127.0.0.1:${bridgePort}`;
    evidence.boundaries.playerStaticOrigin = playerStaticOrigin;
    evidence.boundaries.configServiceOrigin = configBaseUrl;
    evidence.boundaries.bridgeOrigin = bridgeBaseUrl;
    evidence.boundaries.sillyTavernApiOrigin = sillyTavernBaseUrl;
    evidence.boundaries.testOnlySameOriginProxy = {
        enabled: true,
        productionContract: false,
        allowedEndpoints: [
            '/csrf-token',
            '/api/ping',
            '/api/characters/all',
            '/api/worldinfo/list',
            '/api/settings/get',
            '/api/characters/chats',
            '/api/chats/get',
            '/api/chats/save',
        ],
        bottomGenerateForwarded: false,
    };

    if (uap7RealAdminUiFlow) {
        const adminUi = await runRealAdminUiFlow({
            sillyTavernBaseUrl,
            playerStaticPort,
            configBaseUrl,
            assistantBaseUrl,
            expectedTemplate: templateId,
            expectedUsesLlm: useControlledProvider,
        });
        evidence.checks.realAdminUi = adminUi;
        assert.equal(adminUi.ok, true);

        const active = await getJson(`${configBaseUrl}/v1/releases/active`);
        const activeManifest = await getJson(`${configBaseUrl}/v1/scenarios/${encodeURIComponent(active.scenarioId)}/versions/${encodeURIComponent(active.scenarioVersion)}/manifest`);
        const activeBinding = extractBindingEvidence(activeManifest, active.activeArcId);
        const materializedManifest = materializeManifestForArc(activeManifest, active.activeArcId);
        const materializedBinding = extractBindingEvidence(materializedManifest, active.activeArcId);
        evidence.checks.explicitPublish = {
            ok: true,
            releaseId: active.releaseId || '',
            activeArcId: active.activeArcId,
            scenarioId: active.scenarioId,
            scenarioVersion: active.scenarioVersion,
            releasePresentationProfileId: active.presentationProfileId || '',
            releasePresentationProfileHash: active.presentationProfileHash || '',
            activeManifestPresentationProfileId: activeBinding.presentationProfileId,
            activeManifestPresentationProfileHash: activeBinding.presentationProfileHash,
            materializedPresentationProfileId: materializedBinding.presentationProfileId,
            materializedPresentationProfileHash: materializedBinding.presentationProfileHash,
            presentationProfileExact: Boolean(
                active.presentationProfileId
                && active.presentationProfileHash
                && active.presentationProfileId === activeBinding.presentationProfileId
                && active.presentationProfileHash === activeBinding.presentationProfileHash
                && active.presentationProfileId === materializedBinding.presentationProfileId
                && active.presentationProfileHash === materializedBinding.presentationProfileHash
            ),
            activeManifestArcStatus: activeBinding.arcStatus,
            activeManifestPresentationTemplate: resolvePresentationTemplate(activeManifest, activeBinding.presentationProfileId),
            materializedPresentationTemplate: resolvePresentationTemplate(materializedManifest, materializedBinding.presentationProfileId),
            chatSeedId: activeBinding.chatSeedId,
            worldBookRefs: activeBinding.worldBookRefs,
        };
        assert.equal(evidence.checks.explicitPublish.presentationProfileExact, true);
        assert.equal(evidence.checks.explicitPublish.activeManifestPresentationTemplate, templateId);
        assert.equal(evidence.checks.explicitPublish.materializedPresentationTemplate, templateId);
        assert.equal(evidence.checks.explicitPublish.activeArcId, 'main');
        assert.equal(evidence.checks.explicitPublish.activeManifestArcStatus, 'published');
        assert.ok(evidence.checks.explicitPublish.chatSeedId, 'active manifest must expose the Arc chat seed');

        const chatSnapshotBefore = await snapshotCharacterChats({
            avatar: activeBinding.characterAvatar,
            characterName: activeBinding.characterName,
            expectedSeedId: activeBinding.chatSeedId,
        });
        const browser = await runBrowserLiveSmoke({
            sillyTavernBaseUrl,
            playerStaticPort,
            configBaseUrl,
            bridgeBaseUrl,
            expectedScenarioId: activeManifest.id,
            expectedScenarioVersion: activeManifest.version,
            expectedArcId: activeManifest.defaultArcId || active.activeArcId,
            expectedChatSeedId: activeBinding.chatSeedId,
        });
        evidence.checks.playerLive = browser;
        evidence.checks.testOnlyProxyDenylist = browser.testOnlyProxyDenylist || null;
        assert.equal(evidence.checks.testOnlyProxyDenylist?.ok, true);
        assert.equal(browser.ok, true);
        assert.equal(browser.liveSillyTavernGeneration, true);
        assert.equal(browser.runtimeTurns, 2);
        const chatSnapshotAfter = await snapshotCharacterChats({
            avatar: activeBinding.characterAvatar,
            characterName: activeBinding.characterName,
            expectedSeedId: activeBinding.chatSeedId,
        });
        evidence.checks.nonTargetChatReadback = compareCharacterChatSnapshots({
            before: chatSnapshotBefore,
            after: chatSnapshotAfter,
            generatedChatIds: collectGeneratedChatIds(browser),
            seedChatId: activeBinding.chatSeedId,
        });
        assert.equal(evidence.checks.nonTargetChatReadback.ok, true);

        const recovery = await runBrowserBridgeFailureSmoke({
            sillyTavernBaseUrl,
            playerStaticPort,
            configBaseUrl,
            expectedScenarioId: activeManifest.id,
            expectedScenarioVersion: activeManifest.version,
            expectedArcId: activeManifest.defaultArcId || active.activeArcId,
            expectedChatSeedId: activeBinding.chatSeedId,
        });
        evidence.checks.playerRecovery = recovery;
        assert.equal(recovery.ok, true);
        assert.equal(recovery.writeChatSmoke, true);
        assert.equal(recovery.recoveryAccepted, true);
        assert.equal(recovery.localScriptedFallbackDetected, false);

        evidence.ok = true;
    } else {
    const draft = await createProviderDraft({ assistantBaseUrl });
    evidence.checks.providerDraft = {
        ok: draft.ok,
        usesLlm: draft.draft.summary.usesLlm,
        writePolicy: draft.draft.importPlan.writePolicy,
        draftId: draft.draft.draftId,
        revision: draft.draft.revision,
        providerCalls: fakeProvider.calls.length,
        idempotencyKeyHashLength: fakeProvider.calls[0]?.idempotencyKey?.length || 0,
        providerInputDigestMatchesDraft: fakeProvider.calls[0]?.input?.sourceDigest === draft.draft.sourceDigest,
        noSecretInDraft: !JSON.stringify(draft).includes(llmSecret),
    };
    assert.equal(evidence.checks.providerDraft.ok, true);
    assert.equal(evidence.checks.providerDraft.usesLlm, true);
    assert.equal(evidence.checks.providerDraft.writePolicy, 'deferred-aa3');
    assert.equal(evidence.checks.providerDraft.noSecretInDraft, true);

    const confirm = await postJson(`${assistantBaseUrl}/v1/admin/script-import/drafts/${encodeURIComponent(draft.draft.draftId)}/confirm`, {
        body: {},
        headers: adminHeaders(),
    });
    const confirmManifest = confirm.manifest;
    const acceptedProfileResult = createAcceptedPresentationProfileManifest({
        manifest: confirmManifest,
        draft: draft.draft,
    });
    const manifest = acceptedProfileResult.manifest;
    evidence.checks.confirmOriginalResources = {
        ok: confirm.ok,
        status: confirm.status,
        manifestArcStatus: confirmManifest?.arcs?.[0]?.status || '',
        manifestHasPublishedAt: Object.hasOwn(confirmManifest?.arcs?.[0] || {}, 'publishedAt'),
        importMode: confirm.importResult?.mode || '',
        actions: confirm.importResult?.actions || [],
        readbackOk: Boolean(confirm.importResult?.readback?.character?.ok
            && confirm.importResult?.readback?.worldBook?.ok
            && confirm.importResult?.readback?.chatSeed?.ok),
        safeguards: confirm.importResult?.safeguards || {},
        manifestReferencesOnly: manifestReferencesOnly(confirmManifest),
        acceptedPresentationProfile: acceptedProfileResult.evidence,
        noSecretInConfirm: !JSON.stringify(confirm).includes(llmSecret),
    };
    assert.equal(evidence.checks.confirmOriginalResources.ok, true);
    assert.equal(evidence.checks.confirmOriginalResources.manifestArcStatus, 'draft');
    assert.equal(evidence.checks.confirmOriginalResources.manifestHasPublishedAt, false);
    assert.equal(evidence.checks.confirmOriginalResources.readbackOk, true);
    assert.equal(evidence.checks.confirmOriginalResources.manifestReferencesOnly, true);
    assert.equal(evidence.checks.confirmOriginalResources.noSecretInConfirm, true);

    const confirmBinding = extractBindingEvidence(manifest, 'main');
    await postJson(`${configBaseUrl}/v1/admin/scenarios/import`, { body: { manifest } });
    const storedDraftManifest = await getJson(`${configBaseUrl}/v1/scenarios/${encodeURIComponent(manifest.id)}/versions/${encodeURIComponent(manifest.version)}/manifest`);
    const storedDraftBinding = extractBindingEvidence(storedDraftManifest, 'main');
    const draftPublish = await rawJson(`${configBaseUrl}/v1/admin/releases`, {
        method: 'POST',
        body: {
            scenarioId: manifest.id,
            scenarioVersion: manifest.version,
            activeArcId: manifest.defaultArcId,
        },
    });
    evidence.checks.confirmDoesNotPublish = {
        ok: draftPublish.status >= 400,
        rejectedStatus: draftPublish.status,
        rejectedError: draftPublish.body?.error || '',
        activeReleaseAvailableBeforeExplicitPublish: (await rawJson(`${configBaseUrl}/v1/releases/active`)).status === 200,
    };
    assert.equal(evidence.checks.confirmDoesNotPublish.ok, true);
    assert.equal(evidence.checks.confirmDoesNotPublish.activeReleaseAvailableBeforeExplicitPublish, false);

    const publishedManifest = markManifestPublished(manifest);
    evidence.boundaries.markManifestPublished = 'controlled-test-fixture-only; real admin UI must use existing publish flow';
    await postJson(`${configBaseUrl}/v1/admin/scenarios/import`, { body: { manifest: publishedManifest } });
    const storedPublishedManifest = await getJson(`${configBaseUrl}/v1/scenarios/${encodeURIComponent(publishedManifest.id)}/versions/${encodeURIComponent(publishedManifest.version)}/manifest`);
    const storedPublishedBinding = extractBindingEvidence(storedPublishedManifest, 'main');
    const publish = await postJson(`${configBaseUrl}/v1/admin/releases`, {
        body: {
            scenarioId: publishedManifest.id,
            scenarioVersion: publishedManifest.version,
            activeArcId: publishedManifest.defaultArcId,
        },
    });
    const active = await getJson(`${configBaseUrl}/v1/releases/active`);
    const activeManifest = await getJson(`${configBaseUrl}/v1/scenarios/${encodeURIComponent(active.scenarioId)}/versions/${encodeURIComponent(active.scenarioVersion)}/manifest`);
    const activeBinding = extractBindingEvidence(activeManifest, active.activeArcId);
    const materializedManifest = materializeManifestForArc(activeManifest, active.activeArcId);
    const materializedBinding = extractBindingEvidence(materializedManifest, active.activeArcId);
    evidence.checks.bindingPropagation = buildBindingPropagationEvidence({
        expected: {
            ...confirmBinding,
            presentationProfileId: storedPublishedBinding.presentationProfileId,
            presentationProfileHash: storedPublishedBinding.presentationProfileHash,
        },
        confirmBinding,
        storedDraftBinding,
        storedPublishedBinding,
        activeBinding,
        materializedBinding,
    });
    assert.equal(evidence.checks.bindingPropagation.ok, true);
    evidence.checks.explicitPublish = {
        ok: publish.ok,
        releaseId: publish.release?.releaseId || '',
        activeArcId: active.activeArcId,
        scenarioId: active.scenarioId,
        scenarioVersion: active.scenarioVersion,
        releasePresentationProfileId: active.presentationProfileId || '',
        releasePresentationProfileHash: active.presentationProfileHash || '',
        activeManifestPresentationProfileId: activeBinding.presentationProfileId,
        activeManifestPresentationProfileHash: activeBinding.presentationProfileHash,
        materializedPresentationProfileId: materializedBinding.presentationProfileId,
        materializedPresentationProfileHash: materializedBinding.presentationProfileHash,
        presentationProfileExact: Boolean(
            active.presentationProfileId
            && active.presentationProfileHash
            && active.presentationProfileId === activeBinding.presentationProfileId
            && active.presentationProfileHash === activeBinding.presentationProfileHash
            && active.presentationProfileId === materializedBinding.presentationProfileId
            && active.presentationProfileHash === materializedBinding.presentationProfileHash
        ),
        activeManifestArcStatus: activeBinding.arcStatus,
        activeManifestPresentationTemplate: resolvePresentationTemplate(activeManifest, activeBinding.presentationProfileId),
        materializedPresentationTemplate: resolvePresentationTemplate(materializedManifest, materializedBinding.presentationProfileId),
        chatSeedId: activeBinding.chatSeedId,
        worldBookRefs: activeBinding.worldBookRefs,
    };
    assert.equal(evidence.checks.explicitPublish.presentationProfileExact, true);
    assert.equal(evidence.checks.explicitPublish.activeManifestPresentationTemplate, templateId);
    assert.equal(evidence.checks.explicitPublish.materializedPresentationTemplate, templateId);
    assert.equal(evidence.checks.explicitPublish.ok, true);
    assert.equal(evidence.checks.explicitPublish.activeArcId, 'main');
    assert.equal(evidence.checks.explicitPublish.activeManifestArcStatus, 'published');
    assert.ok(evidence.checks.explicitPublish.chatSeedId, 'active manifest must expose the Arc chat seed');

    const chatSnapshotBefore = await snapshotCharacterChats({
        avatar: confirmBinding.characterAvatar,
        characterName: confirmBinding.characterName,
        expectedSeedId: confirmBinding.chatSeedId,
    });
    const browser = await runBrowserLiveSmoke({
        sillyTavernBaseUrl,
        playerStaticPort,
        configBaseUrl,
        bridgeBaseUrl,
        expectedScenarioId: publishedManifest.id,
        expectedScenarioVersion: publishedManifest.version,
        expectedArcId: publishedManifest.defaultArcId,
        expectedChatSeedId: confirmBinding.chatSeedId,
    });
    evidence.checks.playerLive = browser;
    evidence.checks.testOnlyProxyDenylist = browser.testOnlyProxyDenylist || null;
    assert.equal(evidence.checks.testOnlyProxyDenylist?.ok, true);
    assert.equal(browser.ok, true);
    assert.equal(browser.liveSillyTavernGeneration, true);
    assert.equal(browser.runtimeTurns, 2);
    const chatSnapshotAfter = await snapshotCharacterChats({
        avatar: confirmBinding.characterAvatar,
        characterName: confirmBinding.characterName,
        expectedSeedId: confirmBinding.chatSeedId,
    });
    evidence.checks.nonTargetChatReadback = compareCharacterChatSnapshots({
        before: chatSnapshotBefore,
        after: chatSnapshotAfter,
        generatedChatIds: collectGeneratedChatIds(browser),
        seedChatId: confirmBinding.chatSeedId,
    });
    assert.equal(evidence.checks.nonTargetChatReadback.ok, true);

    if (args['failure-recovery-smoke'] === 'true') {
        const recovery = await runBrowserBridgeFailureSmoke({
            sillyTavernBaseUrl,
            playerStaticPort,
            configBaseUrl,
            expectedScenarioId: publishedManifest.id,
            expectedScenarioVersion: publishedManifest.version,
            expectedArcId: publishedManifest.defaultArcId,
            expectedChatSeedId: confirmBinding.chatSeedId,
        });
        evidence.checks.playerRecovery = recovery;
        assert.equal(recovery.ok, true);
        assert.equal(recovery.writeChatSmoke, true);
        assert.equal(recovery.recoveryAccepted, true);
        assert.equal(recovery.localScriptedFallbackDetected, false);
    }

    evidence.ok = true;
    }
} catch (error) {
    evidence.ok = false;
    evidence.failures.push(error?.stack || error?.message || String(error));
} finally {
    await closeServer(runtimeBridge);
    await closeServer(configServer);
    await closeServer(assistantServer);
    await writeFile(evidencePath, JSON.stringify(sanitizeEvidence(evidence), null, 2), 'utf8');
}

console.log(JSON.stringify({
    ok: evidence.ok,
    evidence: toRepoPath(evidencePath),
    failures: evidence.failures,
    providerDraft: evidence.checks.providerDraft || null,
    confirmOriginalResources: evidence.checks.confirmOriginalResources || null,
    explicitPublish: evidence.checks.explicitPublish || null,
    playerLive: evidence.checks.playerLive || null,
}, null, 2));
if (!evidence.ok) {
    process.exitCode = 1;
}

async function createProviderDraft({ assistantBaseUrl }) {
    const fixtureText = scriptFixturePath
        ? await readFile(scriptFixturePath, 'utf8')
        : '';
    const sourceText = fixtureText || [
        `# AA5 full chain ${runId}`,
        '角色: Mira, Ren',
        'Mira and Ren arrive at a sealed observatory. The opening should become an original SillyTavern chat seed only after administrator confirmation.',
    ].join('\n');
    return postJson(`${assistantBaseUrl}/v1/admin/script-import/drafts`, {
        body: {
            protocolVersion: 'galgame.script-import-assistant.request.v1',
            files: [{
                name: scriptFixturePath ? path.basename(scriptFixturePath) : `aa5-full-chain-${runId}.md`,
                type: 'text/markdown',
                text: sourceText,
            }],
            options: {
                locale: 'zh-CN',
                preferredTemplate: templateId,
            },
        },
        headers: adminHeaders(),
    });
}

async function runBrowserLiveSmoke({
    sillyTavernBaseUrl,
    playerStaticPort,
    configBaseUrl,
    bridgeBaseUrl,
    expectedScenarioId,
    expectedScenarioVersion,
    expectedArcId,
    expectedChatSeedId,
}) {
    let stdout = '';
    let stderr = '';
    try {
        const result = await execFileAsync(process.execPath, [
            'frontend/tools/browser-smoke-narrow.mjs',
            '--web-port',
            String(playerStaticPort),
            '--sillytavern-base-url',
            sillyTavernBaseUrl,
            '--proxy-sillytavern-api',
            'true',
            '--config-service-url',
            configBaseUrl,
            '--original-runtime-bridge-url',
            bridgeBaseUrl,
            '--player-only',
            'true',
            '--runtime-reply-smoke',
            'true',
            '--write-chat-smoke',
            'true',
            '--save-restore-smoke',
            'true',
            '--expected-arc-id',
            expectedArcId,
            '--expected-scenario-id',
            expectedScenarioId,
            '--expected-scenario-version',
            expectedScenarioVersion,
            '--expected-chat-seed-id',
            expectedChatSeedId,
        ], {
            cwd: repoRoot,
            timeout: 9 * 60 * 1000,
            maxBuffer: 24 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = error.stdout?.toString?.() || '';
        stderr = error.stderr?.toString?.() || '';
        const parsed = safeJsonParse(stdout);
        return {
            ok: false,
            error: error.message,
            stderr: stderr.trim(),
            stdoutPreview: stdout.slice(0, 2000),
            ...summarizeBrowserSmokeOutput(parsed),
        };
    }
    const output = JSON.parse(stdout);
    return summarizeBrowserSmokeOutput(output, { stderr: stderr.trim() });
}

async function runBrowserBridgeFailureSmoke({
    sillyTavernBaseUrl,
    playerStaticPort,
    configBaseUrl,
    expectedScenarioId,
    expectedScenarioVersion,
    expectedArcId,
    expectedChatSeedId,
}) {
    let stdout = '';
    let stderr = '';
    try {
        const result = await execFileAsync(process.execPath, [
            'frontend/tools/browser-smoke-narrow.mjs',
            '--web-port',
            String(playerStaticPort),
            '--sillytavern-base-url',
            sillyTavernBaseUrl,
            '--proxy-sillytavern-api',
            'true',
            '--config-service-url',
            configBaseUrl,
            '--original-runtime-bridge-url',
            'http://127.0.0.1:1',
            '--player-only',
            'true',
            '--write-chat-smoke',
            'true',
            '--expected-arc-id',
            expectedArcId,
            '--expected-scenario-id',
            expectedScenarioId,
            '--expected-scenario-version',
            expectedScenarioVersion,
            '--expected-chat-seed-id',
            expectedChatSeedId,
        ], {
            cwd: repoRoot,
            timeout: 90 * 1000,
            maxBuffer: 16 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = error.stdout?.toString?.() || '';
        stderr = error.stderr?.toString?.() || '';
        const parsed = safeJsonParse(stdout);
        return summarizeBridgeFailureOutput(parsed, {
            ok: false,
            processError: error.message,
            stderr: stderr.trim(),
            stdoutPreview: stdout.slice(0, 2000),
        });
    }
    return summarizeBridgeFailureOutput(JSON.parse(stdout), { stderr: stderr.trim() });
}

async function runRealAdminUiFlow({
    sillyTavernBaseUrl,
    playerStaticPort,
    configBaseUrl,
    assistantBaseUrl,
    expectedTemplate,
    expectedUsesLlm,
}) {
    let stdout = '';
    let stderr = '';
    const commandArgs = [
        'frontend/tools/browser-smoke-narrow.mjs',
        '--web-port',
        String(playerStaticPort),
        '--sillytavern-base-url',
        sillyTavernBaseUrl,
        '--proxy-sillytavern-api',
        'true',
        '--config-service-url',
        configBaseUrl,
        '--script-import-assistant-url',
        assistantBaseUrl,
        '--admin-script-import-assistant-real-only',
        'true',
        '--expected-script-assistant-uses-llm',
        expectedUsesLlm ? 'true' : 'false',
        '--expected-presentation-template',
        expectedTemplate,
    ];
    if (scriptFixturePath) {
        commandArgs.push(
            '--script-import-fixture',
            toRepoPath(scriptFixturePath),
            '--script-import-fixture-name',
            `uap7-${runId}-${path.basename(scriptFixturePath)}`,
        );
    }
    try {
        const result = await execFileAsync(process.execPath, commandArgs, {
            cwd: repoRoot,
            timeout: 5 * 60 * 1000,
            maxBuffer: 24 * 1024 * 1024,
            env: {
                ...process.env,
                GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_FOR_SMOKE: adminToken,
            },
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = error.stdout?.toString?.() || '';
        stderr = error.stderr?.toString?.() || '';
        return {
            ok: false,
            error: error.message,
            stderr: stderr.trim(),
            stdoutPreview: stdout.slice(0, 2000),
            parsed: safeJsonParse(stdout),
        };
    }
    const output = JSON.parse(stdout);
    return {
        ok: output.ok === true,
        stderr: stderr.trim(),
        baseUrl: output.baseUrl || '',
        verification: output.verification || {},
        result: output.results?.[0] || null,
        failures: output.failures || [],
        expectedUsesLlm,
        expectedTemplate,
    };
}

function summarizeBridgeFailureOutput(output, extra = {}) {
    const summary = summarizeBrowserSmokeOutput(output, extra);
    const writeDetails = summary.stageResults?.writeChat?.details || {};
    const afterSubmit = writeDetails.afterSubmit || {};
    const text = [
        afterSubmit.dialogue,
        afterSubmit.stageStatus,
        ...(summary.failures || []),
    ].filter(Boolean).join('\n');
    const recoveryAccepted = Boolean(
        afterSubmit.recoveryHidden === false
        || /暂时没接上|稍后|重试|恢复/.test(text)
    );
    const localScriptedFallbackDetected = /当前可行动方向|已记录|测试编号/.test(String(afterSubmit.dialogue || ''));
    return {
        ...summary,
        recoveryAccepted,
        localScriptedFallbackDetected,
        recoveryStage: {
            recoveryHidden: afterSubmit.recoveryHidden,
            stageStatus: afterSubmit.stageStatus || '',
            dialoguePreview: String(afterSubmit.dialogue || '').slice(0, 160),
        },
    };
}

function summarizeBrowserSmokeOutput(output, extra = {}) {
    if (!output || typeof output !== 'object') {
        return {
            ok: false,
            ...extra,
            parsedOutput: null,
        };
    }
    const runtimeResult = output.results.find((result) => result.name === 'player-approved-original-runtime-reply');
    const writeChatResult = output.results.find((result) => result.name === 'player-chat-write-and-readback');
    const saveRestoreResult = output.results.find((result) => result.name === 'player-save-restore-original-chat-readback');
    const bridgeDiagnosticsSummary = collectBridgeDiagnosticsSummary([
        runtimeResult,
        writeChatResult,
        saveRestoreResult,
    ]);
    return {
        ok: output.ok,
        ...extra,
        liveSillyTavernGeneration: Boolean(output.verification?.liveSillyTavernGeneration),
        writeChatSmoke: Boolean(output.verification?.writeChatSmoke),
        saveRestoreSmoke: Boolean(output.verification?.saveRestoreSmoke),
        testOnlyProxyDenylist: output.verification?.testOnlyProxyDenylist || null,
        failures: output.failures || [],
        stageResults: {
            runtime: summarizeStageResult(runtimeResult),
            writeChat: summarizeStageResult(writeChatResult),
            saveRestore: summarizeStageResult(saveRestoreResult),
        },
        runtimeTurns: runtimeResult?.details?.turns?.length || 0,
        runtimeFailures: runtimeResult?.failures || [],
        writeChatFailures: writeChatResult?.failures || [],
        saveRestoreFailures: saveRestoreResult?.failures || [],
        cleanup: runtimeResult?.details?.cleanup || null,
        bridgeDiagnosticsSummary,
        firstReplyPreview: runtimeResult?.details?.turns?.[0]?.afterReply?.dialogue?.slice(0, 180) || '',
    };
}

function summarizeStageResult(result) {
    if (!result) {
        return {
            present: false,
            ok: false,
            failures: ['stage result missing'],
        };
    }
    return {
        present: true,
        ok: Array.isArray(result.failures) && result.failures.length === 0,
        name: result.name,
        level: result.level,
        failures: result.failures || [],
        details: result.details || {},
    };
}

function collectBridgeDiagnosticsSummary(results) {
    const entries = [];
    const seen = new Set();
    for (const result of results) {
        if (!result?.details) {
            continue;
        }
        for (const fetch of collectStageFetches(result.details)) {
            const bridge = fetch?.summary?.bridgeGenerateReply;
            if (!bridge) {
                continue;
            }
            const entry = {
                stage: result.name,
                url: fetch.url,
                status: fetch.status,
                ok: fetch.ok,
                chatId: bridge.chatId,
                messageCount: bridge.messageCount,
                targetBeforeCount: bridge.targetBefore?.count ?? null,
                targetAfterCount: bridge.targetAfter?.count ?? null,
                targetChatReadbackAdvanced: Number.isFinite(Number(bridge.targetBefore?.count))
                    && Number.isFinite(Number(bridge.targetAfter?.count))
                    && Number(bridge.targetAfter.count) > Number(bridge.targetBefore.count),
                runtimeWorldBookRefs: bridge.runtimeWorldBookRefs || [],
                duringGenerateWorldInfoWorldRefs: bridge.duringGenerateWorldInfoWorldRefs || [],
                preGenerateWorldInfoWorldRefs: bridge.preGenerateWorldInfoWorldRefs || [],
                worldInfoExactSetDuringGenerate: Boolean(bridge.worldInfoExactSetDuringGenerate),
                expectedWorldInfoActivated: Boolean(bridge.expectedWorldInfoActivated),
                unexpectedLuciferArcWorldInfoDuringGenerate: bridge.unexpectedLuciferArcWorldInfoDuringGenerate || [],
                bridgeAuthorization: bridge.bridgeAuthorization || {},
            };
            const entryKey = JSON.stringify([
                entry.stage,
                entry.url,
                entry.chatId,
                Number(entry.messageCount),
                Number(entry.targetBeforeCount),
                Number(entry.targetAfterCount),
            ]);
            if (seen.has(entryKey)) {
                continue;
            }
            seen.add(entryKey);
            entries.push(entry);
        }
    }
    const allWorldInfoExact = entries.length > 0 && entries.every((entry) => (
        entry.ok
        && entry.targetChatReadbackAdvanced
        && entry.worldInfoExactSetDuringGenerate
        && entry.expectedWorldInfoActivated
        && (!entry.unexpectedLuciferArcWorldInfoDuringGenerate || entry.unexpectedLuciferArcWorldInfoDuringGenerate.length === 0)
        && entry.bridgeAuthorization?.decision === 'allowed'
    ));
    return {
        count: entries.length,
        allWorldInfoExact,
        runtimeGenerateCount: entries.filter((entry) => entry.stage === 'player-approved-original-runtime-reply').length,
        writeGenerateCount: entries.filter((entry) => entry.stage === 'player-chat-write-and-readback').length,
        ok: allWorldInfoExact,
        entries,
    };
}

function collectGeneratedChatIds(browserSummary) {
    const ids = new Set();
    const runtimeCleanup = browserSummary?.cleanup?.fileName || '';
    if (runtimeCleanup) {
        ids.add(runtimeCleanup);
    }
    const stageResults = browserSummary?.stageResults || {};
    for (const stage of [stageResults.runtime, stageResults.writeChat, stageResults.saveRestore]) {
        for (const fetch of collectStageFetches(stage?.details || {})) {
            const chatId = fetch?.summary?.bridgeGenerateReply?.chatId || '';
            if (chatId) {
                ids.add(chatId);
            }
        }
        const cleanupFile = stage?.details?.cleanup?.fileName || '';
        if (cleanupFile) {
            ids.add(cleanupFile);
        }
    }
    return [...ids].filter(Boolean);
}

async function snapshotCharacterChats({
    avatar,
    characterName,
    expectedSeedId,
}) {
    const bridge = new SillyTavernOriginalChatBridge({
        baseUrl: sillyTavernBaseUrl,
        fetchImpl: createSmokeCookieFetch(globalThis.fetch),
        now: () => new Date(),
    });
    const chats = await bridge.listCharacterChats({ avatar });
    const records = [];
    for (const chat of chats) {
        const fileName = normalizeSnapshotChatId(chat.fileName || chat.file_name || chat.fileId || chat.id || chat.name || '');
        if (!fileName) {
            continue;
        }
        const rawChat = await bridge.getCharacterChat({ avatar, fileName }).catch(() => []);
        records.push({
            fileName,
            count: Array.isArray(rawChat) ? Math.max(0, rawChat.length - 1) : 0,
            headerWorldInfo: sanitizeSnapshotText(rawChat?.[0]?.chat_metadata?.world_info || ''),
            lastIsUser: Boolean(rawChat?.at?.(-1)?.is_user),
        });
    }
    return {
        ok: true,
        characterName,
        avatar,
        expectedSeedId: normalizeSnapshotChatId(expectedSeedId),
        chatCount: records.length,
        records: records.sort((left, right) => left.fileName.localeCompare(right.fileName)),
    };
}

function compareCharacterChatSnapshots({
    before,
    after,
    generatedChatIds,
    seedChatId,
}) {
    const allowedGenerated = new Set((generatedChatIds || []).map(normalizeSnapshotChatId));
    const seed = normalizeSnapshotChatId(seedChatId);
    const beforeMap = new Map((before.records || []).map((record) => [record.fileName, record]));
    const afterMap = new Map((after.records || []).map((record) => [record.fileName, record]));
    const allIds = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const changed = [];
    const generatedResidue = [];
    for (const id of allIds) {
        const beforeRecord = beforeMap.get(id) || null;
        const afterRecord = afterMap.get(id) || null;
        if (allowedGenerated.has(id)) {
            if (afterRecord) {
                generatedResidue.push(id);
            }
            continue;
        }
        if (id === seed) {
            if (!beforeRecord || !afterRecord || beforeRecord.count !== afterRecord.count || beforeRecord.headerWorldInfo !== afterRecord.headerWorldInfo) {
                changed.push({ id, before: beforeRecord, after: afterRecord, reason: 'seed-changed' });
            }
            continue;
        }
        if (JSON.stringify(beforeRecord) !== JSON.stringify(afterRecord)) {
            changed.push({ id, before: beforeRecord, after: afterRecord, reason: 'non-target-changed' });
        }
    }
    return {
        ok: changed.length === 0 && generatedResidue.length === 0,
        seedChatId: seed,
        generatedChatIds: [...allowedGenerated],
        beforeChatCount: before.records?.length || 0,
        afterChatCount: after.records?.length || 0,
        nonTargetChangedCount: changed.length,
        generatedResidueCount: generatedResidue.length,
        changed,
        generatedResidue,
    };
}

function normalizeSnapshotChatId(value) {
    return String(value || '').trim().replace(/\.jsonl?$/i, '');
}

function sanitizeSnapshotText(value) {
    return String(value || '').slice(0, 240);
}

function createSmokeCookieFetch(fetchImpl) {
    const cookies = new Map();
    const cookieFetch = async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        const setCookieValues = typeof response.headers?.getSetCookie === 'function'
            ? response.headers.getSetCookie()
            : [response.headers?.get?.('set-cookie')].filter(Boolean);
        for (const value of setCookieValues) {
            for (const cookieText of String(value || '').split(/,(?=\s*[^;,=\s]+=)/g)) {
                const firstPart = cookieText.trim().split(';')[0];
                const separator = firstPart.indexOf('=');
                if (separator > 0) {
                    cookies.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
                }
            }
        }
        return response;
    };
    return cookieFetch;
}

function collectStageFetches(details) {
    const fetches = [];
    if (Array.isArray(details.fetches)) {
        fetches.push(...details.fetches);
    }
    if (Array.isArray(details.turns)) {
        for (const turn of details.turns) {
            if (Array.isArray(turn?.readyAfterReply?.fetches)) {
                fetches.push(...turn.readyAfterReply.fetches);
            }
        }
    }
    if (Array.isArray(details.afterSubmit?.fetches)) {
        fetches.push(...details.afterSubmit.fetches);
    }
    if (Array.isArray(details.readyState?.fetches)) {
        fetches.push(...details.readyState.fetches);
    }
    if (Array.isArray(details.restoredState?.fetches)) {
        fetches.push(...details.restoredState.fetches);
    }
    return fetches;
}

function createFakeProviderPlan({
    title,
    characterName,
    characterAvatar,
    worldBookName,
    chatSeedId,
    template,
}) {
    const calls = [];
    const preferredModules = BUILTIN_TEMPLATE_MODULES[template] || BUILTIN_TEMPLATE_MODULES['visual-novel'];
    const matchedSignals = matchedSignalsForTemplate(template);
    const primaryPanel = preferredModules.find((moduleId) => moduleId !== 'actions') || preferredModules[0] || 'actions';
    const secondaryPanels = preferredModules
        .filter((moduleId) => moduleId !== primaryPanel && moduleId !== 'actions')
        .slice(0, 4);
    return {
        calls,
        async fetch(url, options = {}) {
            const body = JSON.parse(String(options.body || '{}'));
            const userMessage = (Array.isArray(body.messages) ? body.messages : [])
                .find((message) => message.role === 'user');
            const input = userMessage?.content ? JSON.parse(userMessage.content) : {};
            calls.push({
                url: String(url),
                idempotencyKey: String(options.headers?.['Idempotency-Key'] || ''),
                input: {
                    protocolVersion: input.protocolVersion,
                    sourceDigest: input.sourceDigest,
                    revision: input.revision,
                    draftId: input.draftId,
                    fileCount: Array.isArray(input.files) ? input.files.length : 0,
                    totalCharacters: Array.isArray(input.files)
                        ? input.files.reduce((sum, file) => sum + String(file.text || '').length, 0)
                        : 0,
                },
            });
            return new Response(JSON.stringify({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            protocolVersion: 'galgame.script-import-llm-plan.v1',
                            summary: {
                                title,
                                recommendedTemplate: template,
                                mainCharacters: ['Mira', 'Ren'],
                                worldBookCount: 1,
                                openingReady: true,
                            },
                            importPlan: {
                                characterName,
                                characterAvatar,
                                worldBookName,
                                chatSeedId,
                            },
                            presentationRecommendation: {
                                detectedGenre: template,
                                confidence: 0.86,
                                recommendedProfile: {
                                    template,
                                    preferredModules,
                                    disabledModules: [],
                                    extractionPolicy: {
                                        confidenceThreshold: 0.78,
                                        maxRecentMessages: 5,
                                        allowAdminPatterns: false,
                                    },
                                    visualPriority: {
                                        primaryPanel,
                                        secondaryPanels,
                                        collapseBelowWidth: 720,
                                    },
                                },
                                evidence: {
                                    matchedSignals,
                                },
                                safeWarnings: ['warning-admin-review-required', 'warning-patterns-disabled'],
                                noClaim: ['no-runtime-llm-assistant', 'no-hidden-resource-reading', 'no-prompt-context-copy', 'no-frontend-combat-calculation'],
                            },
                        }),
                    },
                }],
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
}

function normalizeTemplateId(value) {
    const candidate = String(value || '').trim();
    if (!PRESENTATION_TEMPLATES.includes(candidate)) {
        throw new Error(`UNKNOWN_PRESENTATION_TEMPLATE_${candidate || 'EMPTY'}`);
    }
    return candidate;
}

function matchedSignalsForTemplate(template) {
    const map = {
        'visual-novel': ['signal-vn-dialogue-format', 'signal-action-options-format'],
        'rpg-adventure': ['signal-hp-ac-format', 'signal-inventory-section', 'signal-equipment-section', 'signal-attack-section', 'signal-dice-roll'],
        'romance-social': ['signal-affection-score', 'signal-relationship-stage', 'signal-gift-event', 'signal-calendar-event'],
        'mystery-investigation': ['signal-clue-section', 'signal-suspect-section', 'signal-location-section'],
        'management-sim': ['signal-resource-counter', 'signal-faction-status', 'signal-calendar-event'],
        'sandbox-roleplay': ['signal-sandbox-notes', 'signal-location-section', 'signal-faction-status'],
    };
    return map[template] || ['signal-unknown-structure'];
}

function resolvePresentationTemplate(manifest, profileId) {
    const profile = manifest?.adaptivePresentationProfiles?.[profileId];
    return profile?.template || '';
}

function markManifestPublished(manifest) {
    const publishedAt = new Date().toISOString();
    const profileBoundManifest = bindAdaptivePresentationProfileHashes(manifest, { arcId: manifest.defaultArcId });
    return {
        ...profileBoundManifest,
        updatedAt: publishedAt,
        arcs: (profileBoundManifest.arcs || []).map((arc) => ({
            ...arc,
            status: 'published',
            publishedAt,
        })),
    };
}

function createAcceptedPresentationProfileManifest({
    manifest,
    draft,
}) {
    const recommendation = draft?.presentationRecommendation;
    const profileResult = convertPresentationRecommendationToProfile(recommendation, {
        recommendationId: recommendation?.recommendationId,
        sourceDigest: recommendation?.sourceDigest,
        draftId: recommendation?.draftId,
        revision: recommendation?.revision,
        currentRevision: recommendation?.revision,
        evidenceDigest: recommendation?.evidence?.evidenceDigest,
        usesLlm: Boolean(recommendation?.usesLlm),
    });
    if (!profileResult.ok) {
        throw new Error(`PRESENTATION_RECOMMENDATION_PROFILE_CONVERSION_FAILED: ${profileResult.errors.join('; ')}`);
    }
    const nextManifest = {
        ...manifest,
        adaptivePresentationProfiles: {
            ...(manifest.adaptivePresentationProfiles || {}),
            [profileResult.profile.profileId]: profileResult.profile,
        },
        arcs: (manifest.arcs || []).map((arc) => (
            arc?.arcId === (manifest.defaultArcId || 'main')
                ? {
                    ...arc,
                    presentationProfileId: profileResult.profile.profileId,
                }
                : arc
        )),
    };
    return {
        manifest: nextManifest,
        evidence: {
            ok: true,
            source: 'controlled-admin-accepted-recommendation-profile',
            profileId: profileResult.profile.profileId,
            template: profileResult.profile.template,
            preferredModules: profileResult.profile.preferredModules,
            allowAdminPatterns: false,
            rawRecommendationWrittenToManifest: JSON.stringify(nextManifest).includes('presentationRecommendation'),
        },
    };
}

function extractBindingEvidence(manifest, arcId = 'main') {
    const arc = (manifest?.arcs || []).find((item) => item.arcId === arcId) || null;
    const bindings = arc?.sillyTavernBindings || manifest?.sillyTavernBindings || {};
    return {
        manifestId: manifest?.id || '',
        manifestVersion: manifest?.version || '',
        arcId: arc?.arcId || manifest?.arcId || arcId,
        arcStatus: arc?.status || '',
        presentationProfileId: arc?.presentationProfileId || manifest?.presentationProfileId || '',
        presentationProfileHash: arc?.presentationProfileHash || manifest?.presentationProfileHash || '',
        targetMode: bindings.target?.mode || '',
        characterName: bindings.target?.characterRef?.name || bindings.characters?.[0]?.id || '',
        characterAvatar: bindings.target?.characterRef?.avatar || bindings.characters?.[0]?.avatar || '',
        chatSeedId: bindings.chatSeedId || bindings.target?.chatSeedId || '',
        worldBookRefs: [...(bindings.worldBookRefs || bindings.worldBooks?.map((worldBook) => worldBook.name) || [])].filter(Boolean).sort(),
        hasRootBindings: Boolean(manifest?.sillyTavernBindings),
        hasArcBindings: Boolean(arc?.sillyTavernBindings),
    };
}

function buildBindingPropagationEvidence({
    expected,
    confirmBinding,
    storedDraftBinding,
    storedPublishedBinding,
    activeBinding,
    materializedBinding,
}) {
    const layers = {
        confirmBinding,
        storedDraftBinding,
        storedPublishedBinding,
        activeBinding,
        materializedBinding,
    };
    const failures = [];
    for (const [name, binding] of Object.entries(layers)) {
        if (binding.chatSeedId !== expected.chatSeedId) {
            failures.push(`${name}.chatSeedId ${binding.chatSeedId || '<empty>'} !== ${expected.chatSeedId}`);
        }
        if (JSON.stringify(binding.worldBookRefs) !== JSON.stringify(expected.worldBookRefs)) {
            failures.push(`${name}.worldBookRefs ${JSON.stringify(binding.worldBookRefs)} !== ${JSON.stringify(expected.worldBookRefs)}`);
        }
        if (binding.characterAvatar !== expected.characterAvatar) {
            failures.push(`${name}.characterAvatar ${binding.characterAvatar || '<empty>'} !== ${expected.characterAvatar}`);
        }
        if (['storedPublishedBinding', 'activeBinding', 'materializedBinding'].includes(name)) {
            if (binding.presentationProfileId !== expected.presentationProfileId) {
                failures.push(`${name}.presentationProfileId ${binding.presentationProfileId || '<empty>'} !== ${expected.presentationProfileId}`);
            }
            if (binding.presentationProfileHash !== expected.presentationProfileHash) {
                failures.push(`${name}.presentationProfileHash ${binding.presentationProfileHash || '<empty>'} !== ${expected.presentationProfileHash}`);
            }
        }
    }
    return {
        ok: failures.length === 0,
        expected: {
            chatSeedId: expected.chatSeedId,
            worldBookRefs: expected.worldBookRefs,
            characterAvatar: expected.characterAvatar,
            presentationProfileId: expected.presentationProfileId,
            presentationProfileHash: expected.presentationProfileHash,
        },
        layers,
        failures,
    };
}

function manifestReferencesOnly(manifest) {
    const text = JSON.stringify(manifest || {});
    return Boolean(manifest?.story?.mode === 'sillytavern-live')
        && text.includes('"nodes":{}')
        && !/"(?:description|personality|scenario|first_mes|mes_example|entries|content|choices|ending|prompt|context)"/i.test(text);
}

function adminHeaders() {
    return { Authorization: `Bearer ${adminToken}` };
}

async function getJson(url) {
    const response = await rawJson(url);
    assert.equal(response.ok, true, response.body?.error || JSON.stringify(response.body));
    return response.body;
}

async function postJson(url, {
    body,
    headers = {},
} = {}) {
    const response = await rawJson(url, { method: 'POST', body, headers });
    assert.equal(response.ok, true, response.body?.error || JSON.stringify(response.body));
    return response.body;
}

async function rawJson(url, {
    method = 'GET',
    body = undefined,
    headers = {},
} = {}) {
    const response = await fetch(url, {
        method,
        headers: {
            ...headers,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
    });
    const text = await response.text();
    let parsed = {};
    if (text) {
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = { text: text.slice(0, 500) };
        }
    }
    return {
        ok: response.ok,
        status: response.status,
        body: parsed,
    };
}

function listen(server, port) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
}

function closeServer(server) {
    if (!server) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        setTimeout(resolve, 3000).unref();
    });
}

function canListen(port) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => {
            server.close(() => resolve(true));
        });
    });
}

async function getFreePort(start) {
    for (let port = start; port < start + 100; port += 1) {
        if (await canListen(port)) {
            return port;
        }
    }
    throw new Error(`NO_FREE_PORT_NEAR_${start}`);
}

function sanitizeEvidence(value) {
    const text = JSON.stringify(value)
        .replaceAll(adminToken, '[redacted-admin-token]')
        .replaceAll(llmSecret, '[redacted-llm-key]')
        .replaceAll(proofSecret, '[redacted-proof-secret]');
    return JSON.parse(text);
}

function safeJsonParse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function quietLogger() {
    return {
        log() {},
        info() {},
        warn() {},
        error() {},
    };
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            parsed[value.slice(2)] = values[index + 1] || '';
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function toRepoPath(value) {
    return path.relative(repoRoot, value).replace(/\\/g, '/');
}
