import assert from 'node:assert/strict';
import {
    createDeterministicImportDraft,
    createScriptImportAssistantService,
    MemoryDraftStore,
} from './server.mjs';
import {
    importDraftToOriginalSillyTavern,
} from './original-st-importer.mjs';
import {
    LocalReleaseStore,
    MemoryStorageBackend,
} from '../../frontend/shared/src/storage.js';
import {
    bindAdaptivePresentationProfileHashes,
} from '../../frontend/shared/src/protocol.js';

const adminToken = 'aa1-admin-token';
const llmSecret = 'TEST_AA1_SECRET_VALUE';
const sourceDialogue = 'Anna: this full source line must not come back to the browser.';
const draftRequest = {
    protocolVersion: 'galgame.script-import-assistant.request.v1',
    files: [
        {
            name: 'moonlit-school.md',
            type: 'text/markdown',
            text: [
                '# 月下学园',
                '角色: Anna, Andrei',
                '## 世界设定',
                '雨夜、旧校舍、失踪的学生会记录。',
                sourceDialogue,
                '可疑字段: choices nodes ending scene result runtime story prompt manifest',
            ].join('\n'),
        },
    ],
    options: {
        locale: 'zh-CN',
        preferredTemplate: 'auto',
    },
};

const noAuthServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
});
await listen(noAuthServer);
let baseUrl = serverBaseUrl(noAuthServer);

try {
    const health = await fetchJson('/v1/health');
    assertHealthResponse(health);
    assert.equal(health.ok, true);
    assert.equal(health.adminAuth.required, true);
    assert.equal(health.adminAuth.configured, false);
    assert.equal(health.llm.apiKeyConfigured, false);
    assertNoLeak(health, [adminToken, llmSecret, sourceDialogue]);

    const rejected = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
    });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.error, 'ADMIN_AUTH_UNCONFIGURED');

    console.log('script import assistant fail-closed auth tests passed');
} finally {
    noAuthServer.close();
}

process.env.AA1_SCRIPT_IMPORT_LLM_KEY = llmSecret;
const protectedServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    corsOrigin: 'http://allowed.example',
    llmBaseUrl: 'https://llm.example/v1',
    llmModel: 'story-planner',
    llmApiKeyEnv: 'AA1_SCRIPT_IMPORT_LLM_KEY',
    planner: createDeterministicImportDraft,
    resourceImporter: createFakeOriginalResourceImporter(),
});
await listen(protectedServer);
baseUrl = serverBaseUrl(protectedServer);

try {
    const health = await fetchJson('/v1/health');
    assertHealthResponse(health);
    assert.equal(health.adminAuth.configured, true);
    assert.equal(health.adminAuth.mode, 'token');
    assert.equal(health.llm.configured, true);
    assert.equal(health.llm.apiKeyConfigured, true);
    assert.equal(health.llm.apiKeySource, 'env-reference');
    assertNoLeak(health, [adminToken, llmSecret, sourceDialogue, 'AA1_SCRIPT_IMPORT_LLM_KEY']);

    const missingToken = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
    });
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.body.error, 'ADMIN_AUTH_REQUIRED');

    const wrongToken = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: 'Bearer wrong-token',
        },
    });
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.body.error, 'ADMIN_AUTH_REQUIRED');

    const crossOrigin = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
            Origin: 'http://evil.example',
        },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.body.error, 'ADMIN_ORIGIN_NOT_ALLOWED');

    const preflight = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'OPTIONS',
        headers: {
            Origin: 'http://allowed.example',
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://allowed.example');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(preflight.headers.get('access-control-allow-headers').includes('X-Galgame-Trusted-Proxy-Token'), false);

    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
            Origin: 'http://allowed.example',
        },
    });
    assert.equal(created.ok, true);
    assert.equal(created.draft.protocolVersion, 'galgame.script-import-draft.v1');
    assert.equal(created.draft.summary.title, '月下学园');
    assert.equal(created.draft.summary.usesLlm, false);
    assert.equal(created.draft.summary.importOnly, true);
    assert.equal(created.draft.summary.playerCallable, false);
    assert.deepEqual(created.draft.summary.mainCharacters, ['Anna', 'Andrei']);
    assert.match(created.draft.importPlan.characterName, /^Galgame_AIImport_/);
    assert.match(created.draft.importPlan.worldBookName, /^Galgame_AIImport_/);
    assert.match(created.draft.importPlan.chatSeedId, /^galgame-aiimport-/);
    assert.equal(created.draft.importPlan.writePolicy, 'deferred-aa3');
    assertPresentationRecommendationDraft(created.draft, { usesLlm: false });
    assertNoLeak(created, [adminToken, llmSecret, sourceDialogue, 'AA1_SCRIPT_IMPORT_LLM_KEY']);
    assertNoRuntimeStoryAuthority(created);

    const redeployed = await fetchJson(`/v1/admin/script-import/drafts/${created.draft.draftId}/redeploy`, {
        method: 'POST',
        body: {
            reason: '重新整理测试',
        },
        headers: {
            'X-Galgame-Admin-Token': adminToken,
        },
    });
    assert.equal(redeployed.draft.draftId, created.draft.draftId);
    assert.equal(redeployed.draft.revision, 2);
    assertPresentationRecommendationDraft(redeployed.draft, { usesLlm: false });
    assert.notEqual(redeployed.draft.presentationRecommendation.recommendationId, created.draft.presentationRecommendation.recommendationId);
    assertNoLeak(redeployed, [adminToken, llmSecret, sourceDialogue]);
    assertNoRuntimeStoryAuthority(redeployed);

    const confirm = await rawFetch(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
        method: 'POST',
        body: {},
        headers: {
            Cookie: `galgame_script_admin_token=${adminToken}`,
        },
    });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body, null, 2));
    assert.equal(confirm.body.ok, true);
    assert.equal(confirm.body.status, 'ready-for-publish');
    assert.equal(confirm.body.draft.importPlan.writePolicy, 'imported-aa3');
    assertPresentationRecommendationDraft(confirm.body.draft, { usesLlm: false });
    assert.equal(confirm.body.manifest.arcs[0].status, 'draft');
    assert.equal(Object.hasOwn(confirm.body.manifest.arcs[0], 'publishedAt'), false);
    assert.equal(confirm.body.importResult.mode, 'original-sillytavern-api');
    assert.equal(confirm.body.importResult.safeguards.presetWritten, false);
    assert.equal(confirm.body.importResult.safeguards.playerManifestBodyWritten, false);
    assert.deepEqual(confirm.body.importResult.actions.map((item) => item.action), ['created', 'created', 'created']);
    assertConfirmManifestReferencesOnly(confirm.body);
    assertNoLeak(confirm.body, [adminToken, llmSecret, sourceDialogue]);
    await assertConfirmDoesNotPublishActiveRelease(confirm.body.manifest);

    const repeated = await rawFetch(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
        method: 'POST',
        body: {},
        headers: {
            Cookie: `galgame_script_admin_token=${adminToken}`,
        },
    });
    assert.equal(repeated.status, 200);
    assert.deepEqual(repeated.body.importResult.actions.map((item) => item.action), [
        'skipped-existing-identical',
        'skipped-existing-identical',
        'skipped-existing-identical',
    ]);
    assertConfirmManifestReferencesOnly(repeated.body);
    assert.equal(JSON.stringify(repeated.body.manifest).includes('presentationRecommendation'), false);
    assertNoLeak(repeated.body, [adminToken, llmSecret, sourceDialogue]);

    console.log('script import assistant protected draft tests passed');
} finally {
    protectedServer.close();
    delete process.env.AA1_SCRIPT_IMPORT_LLM_KEY;
}

const forgedPlannerServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    planner: ({ sourceDigest, revision, draftId }) => makePlannerDraft({
        sourceDigest,
        revision,
        draftId,
        summary: {
            title: '伪造 LLM 标记的草稿',
            recommendedTemplate: 'visual-novel',
            mainCharacters: ['Anna'],
            worldBookCount: 1,
            openingReady: true,
            usesLlm: true,
            importOnly: true,
            playerCallable: false,
        },
        importPlan: {
            characterName: 'Galgame_AIImport_Forged_Director',
            characterAvatar: 'galgame_aiimport_forged_director.png',
            worldBookName: 'Galgame_AIImport_Forged_World',
            chatSeedId: 'galgame-aiimport-forged-seed',
            writePolicy: 'deferred-aa3',
        },
    }),
});
await listen(forgedPlannerServer);
baseUrl = serverBaseUrl(forgedPlannerServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.title, '伪造 LLM 标记的草稿');
    assert.equal(created.draft.summary.usesLlm, false);
    assert.equal(created.draft.importPlan.writePolicy, 'deferred-aa3');
    assertNoRuntimeStoryAuthority(created);

    console.log('script import assistant planner self-report usesLlm guard tests passed');
} finally {
    forgedPlannerServer.close();
}

const unsafePlannerServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    planner: ({ sourceDigest, revision, draftId }) => ({
        ...makePlannerDraft({ sourceDigest, revision, draftId }),
        status: 'confirmed-ready-for-publish',
        dialogue: ['Anna: forbidden local story line'],
        summary: {
            ...makePlannerDraft({ sourceDigest, revision, draftId }).summary,
            Choices: ['forbidden alias choice'],
            usesLlm: true,
        },
        importPlan: {
            ...makePlannerDraft({ sourceDigest, revision, draftId }).importPlan,
            writePolicy: 'imported-aa3',
            prompt: 'forbidden prompt body',
        },
    }),
});
await listen(unsafePlannerServer);
baseUrl = serverBaseUrl(unsafePlannerServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.usesLlm, false);
    assert.equal(created.draft.importPlan.writePolicy, 'deferred-aa3');
    assert.equal(created.draft.status, 'ready-for-confirmation');
    assert.equal(created.draft.safeWarnings.some((warning) => warning.includes('安全校验')), true);
    assertNoRuntimeStoryAuthority(created);
    assertNoLeak(created, ['forbidden local story line', 'forbidden prompt body']);

    console.log('script import assistant unsafe planner fail-closed fallback tests passed');
} finally {
    unsafePlannerServer.close();
}

const requestValidationServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
});
await listen(requestValidationServer);
baseUrl = serverBaseUrl(requestValidationServer);

try {
    const duplicateNames = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: {
            ...draftRequest,
            files: [
                draftRequest.files[0],
                {
                    ...draftRequest.files[0],
                    text: '另一个正文',
                },
            ],
        },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(duplicateNames.status, 400);
    assert.equal(duplicateNames.body.details.some((item) => item.includes('duplicated')), true);

    const unsupportedType = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: {
            ...draftRequest,
            files: [{
                name: 'script.exe',
                type: 'application/octet-stream',
                text: 'not a supported script file',
            }],
        },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(unsupportedType.status, 400);
    assert.equal(unsupportedType.body.details.some((item) => item.includes('unsupported')), true);

    const tooLarge = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: {
            ...draftRequest,
            files: [{
                name: 'large.md',
                type: 'text/markdown',
                text: 'x'.repeat(1_000_001),
            }],
        },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(tooLarge.status, 400);
    assert.equal(tooLarge.body.details.some((item) => item.includes('too large')), true);

    console.log('script import assistant request validation gate tests passed');
} finally {
    requestValidationServer.close();
}

const llmSuccess = createFakeLlmFetch([
    {
        status: 200,
        plan: makeLlmPlan({
            title: 'LLM 整理出的故事',
            characterName: 'Galgame_AIImport_Llm_Director',
            worldBookName: 'Galgame_AIImport_Llm_World',
            chatSeedId: 'galgame-aiimport-llm-seed',
        }),
    },
]);
const llmSuccessServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmFetch: llmSuccess.fetch,
    llmSleep: llmSuccess.sleep,
});
await listen(llmSuccessServer);
baseUrl = serverBaseUrl(llmSuccessServer);

try {
    const first = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    const second = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(first.draft.summary.title, 'LLM 整理出的故事');
    assert.equal(first.draft.summary.usesLlm, true);
    assert.equal(first.draft.summary.importOnly, true);
    assert.equal(first.draft.summary.playerCallable, false);
    assert.equal(first.draft.importPlan.writePolicy, 'deferred-aa3');
    assertPresentationRecommendationDraft(first.draft, {
        usesLlm: true,
        template: 'rpg-adventure',
        primaryPanel: 'rpg-status',
    });
    assert.equal(first.draft.draftId, second.draft.draftId);
    assert.equal(first.draft.sourceDigest, second.draft.sourceDigest);
    assert.equal(first.draft.presentationRecommendation.recommendationId, second.draft.presentationRecommendation.recommendationId);
    assert.equal(first.draft.presentationRecommendation.evidence.evidenceDigest, second.draft.presentationRecommendation.evidence.evidenceDigest);
    assert.equal(llmSuccess.calls.length, 2);
    assert.equal(llmSuccess.calls[0].url, 'https://provider.example/v1/chat/completions');
    assert.equal(llmSuccess.calls[0].authorization, `Bearer ${llmSecret}`);
    assert.match(llmSuccess.calls[0].idempotencyKey, /^[a-f0-9]{64}$/);
    assert.equal(llmSuccess.calls[0].idempotencyKey, llmSuccess.calls[1].idempotencyKey);
    assert.equal(llmSuccess.calls[0].body.model, 'story-planner');
    assert.equal(llmSuccess.calls[0].input.protocolVersion, 'galgame.script-import-llm-input.v1');
    assert.equal(llmSuccess.calls[0].input.sourceDigest, first.draft.sourceDigest);
    assertNoRuntimeStoryAuthority(first);
    assertNoLeak(first, [adminToken, llmSecret, sourceDialogue, 'Anna: this full source line']);

    console.log('script import assistant real LLM provider success/idempotency tests passed');
} finally {
    llmSuccessServer.close();
}

const llmWrappedPayloads = createFakeLlmFetch([
    {
        body: {
            choices: [{
                message: {
                    content: JSON.stringify({ plan: makeLlmPlan({ title: '包装 plan 整理' }) }),
                },
            }],
        },
    },
    {
        body: {
            choices: [{
                message: {
                    content: [
                        '```json\n',
                        JSON.stringify({
                            draft: makePlannerDraft({
                                sourceDigest: 'wrapped-draft',
                                summary: { title: '包装 draft 整理' },
                                importPlan: {
                                    characterName: 'Galgame_AIImport_Wrapped_Director',
                                    worldBookName: 'Galgame_AIImport_Wrapped_World',
                                    chatSeedId: 'galgame-aiimport-wrapped-seed',
                                },
                            }),
                        }),
                        '\n```',
                    ].join(''),
                },
            }],
        },
    },
]);
const llmWrappedPayloadsServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmFetch: llmWrappedPayloads.fetch,
    llmSleep: llmWrappedPayloads.sleep,
});
await listen(llmWrappedPayloadsServer);
baseUrl = serverBaseUrl(llmWrappedPayloadsServer);

try {
    const wrappedPlan = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    const wrappedDraft = await fetchJson(`/v1/admin/script-import/drafts/${wrappedPlan.draft.draftId}/redeploy`, {
        method: 'POST',
        body: { reason: 'wrapped provider payload' },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(wrappedPlan.draft.summary.title, '包装 plan 整理');
    assert.equal(wrappedPlan.draft.summary.usesLlm, true);
    assert.equal(wrappedDraft.draft.summary.title, '包装 draft 整理');
    assert.equal(wrappedDraft.draft.summary.usesLlm, true);
    assert.equal(wrappedDraft.draft.importPlan.writePolicy, 'deferred-aa3');
    assertPresentationRecommendationDraft(wrappedPlan.draft, { usesLlm: true });
    assertPresentationRecommendationDraft(wrappedDraft.draft, { usesLlm: true });
    assertNoRuntimeStoryAuthority(wrappedPlan);
    assertNoRuntimeStoryAuthority(wrappedDraft);

    console.log('script import assistant wrapped LLM payload tests passed');
} finally {
    llmWrappedPayloadsServer.close();
}

const llmRedeploy = createFakeLlmFetch([
    { status: 200, plan: makeLlmPlan({ title: '首次整理' }) },
    { status: 503, body: { error: 'temporary' } },
    { status: 200, plan: makeLlmPlan({ title: '重新整理成功' }) },
]);
const llmRedeployServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmRetryCount: 1,
    llmRetryDelayMs: 5,
    llmFetch: llmRedeploy.fetch,
    llmSleep: llmRedeploy.sleep,
});
await listen(llmRedeployServer);
baseUrl = serverBaseUrl(llmRedeployServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    const redeployed = await fetchJson(`/v1/admin/script-import/drafts/${created.draft.draftId}/redeploy`, {
        method: 'POST',
        body: { reason: 'provider retry idempotency' },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(redeployed.draft.revision, 2);
    assert.equal(redeployed.draft.summary.title, '重新整理成功');
    assertPresentationRecommendationDraft(redeployed.draft, { usesLlm: true });
    assert.notEqual(created.draft.presentationRecommendation.recommendationId, redeployed.draft.presentationRecommendation.recommendationId);
    assert.equal(llmRedeploy.calls.length, 3);
    assert.notEqual(llmRedeploy.calls[0].idempotencyKey, llmRedeploy.calls[1].idempotencyKey);
    assert.equal(llmRedeploy.calls[1].idempotencyKey, llmRedeploy.calls[2].idempotencyKey);
    assert.deepEqual(llmRedeploy.sleeps, [5]);

    console.log('script import assistant real LLM provider redeploy idempotency tests passed');
} finally {
    llmRedeployServer.close();
}

const llmRetry = createFakeLlmFetch([
    { status: 503, body: { error: 'temporary' } },
    { status: 200, plan: makeLlmPlan({ title: '重试后成功' }) },
]);
const llmRetryServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1/chat/completions',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmRetryCount: 1,
    llmRetryDelayMs: 5,
    llmFetch: llmRetry.fetch,
    llmSleep: llmRetry.sleep,
});
await listen(llmRetryServer);
baseUrl = serverBaseUrl(llmRetryServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.title, '重试后成功');
    assert.equal(created.draft.summary.usesLlm, true);
    assertPresentationRecommendationDraft(created.draft, { usesLlm: true });
    assert.equal(llmRetry.calls.length, 2);
    assert.deepEqual(llmRetry.sleeps, [5]);

    console.log('script import assistant real LLM provider retry/backoff tests passed');
} finally {
    llmRetryServer.close();
}

for (const [label, scenarios, expectedWarning] of [
    ['invalid-json', [{ status: 200, text: 'not-json' }], '安全校验'],
    ['non-2xx', [{ status: 500, body: { error: 'server down' } }], '暂时无法连接'],
    ['non-retriable-4xx', [{ status: 401, body: { error: 'bad key' } }, { status: 200, plan: makeLlmPlan({ title: 'should not retry' }) }], '服务配置暂不可用'],
    ['thrown-secret', [{ throwMessage: `provider failed with ${llmSecret}` }], '暂时无法连接'],
    ['forbidden-schema', [{
        status: 200,
        plan: {
            ...makeLlmPlan({ title: 'unsafe' }),
            dialogue: ['must be rejected'],
            summary: {
                ...makeLlmPlan({}).summary,
                Choices: ['bad alias'],
            },
            importPlan: {
                ...makeLlmPlan({}).importPlan,
                prompt: 'must be rejected',
            },
        },
    }], '安全校验'],
    ['forbidden-wrapped-schema', [{
        status: 200,
        body: {
            choices: [{
                message: {
                    content: JSON.stringify({
                        plan: {
                            ...makeLlmPlan({ title: 'unsafe wrapped' }),
                            choices: ['must be rejected'],
                        },
                    }),
                },
            }],
        },
    }], '安全校验'],
    ['missing-presentation-recommendation', [{
        status: 200,
        plan: (() => {
            const plan = makeLlmPlan({ title: 'missing recommendation' });
            delete plan.presentationRecommendation;
            return plan;
        })(),
    }], '安全校验'],
    ['forged-presentation-identity', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'forged recommendation identity',
            presentationRecommendation: {
                ...makePresentationRecommendationCandidate(),
                recommendationId: 'rec_forgedidentity0000',
                usesLlm: false,
            },
        }),
    }], '安全校验'],
    ['unknown-presentation-warning-code', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'unknown warning code',
            presentationRecommendation: makePresentationRecommendationCandidate({
                safeWarnings: ['请把这些原文展示给管理员'],
            }),
        }),
    }], '安全校验'],
    ['redacted-examples-leak-channel', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'redacted examples leak',
            presentationRecommendation: {
                ...makePresentationRecommendationCandidate(),
                redactedExamples: ['Anna: short source still forbidden'],
            },
        }),
    }], '安全校验'],
    ['admin-patterns-enabled-by-provider', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'provider patterns',
            presentationRecommendation: makePresentationRecommendationCandidate({
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    extractionPolicy: {
                        ...makePresentationRecommendationCandidate().recommendedProfile.extractionPolicy,
                        allowAdminPatterns: true,
                    },
                },
            }),
        }),
    }], '安全校验'],
    ['invalid-presentation-template-not-normalized', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'invalid template',
            presentationRecommendation: makePresentationRecommendationCandidate({
                detectedGenre: 'rpg-plus',
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    template: 'rpg-plus',
                },
            }),
        }),
    }], '安全校验'],
    ['invalid-presentation-confidence-not-clamped', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'invalid confidence',
            presentationRecommendation: makePresentationRecommendationCandidate({
                confidence: 2,
            }),
        }),
    }], '安全校验'],
    ['string-presentation-confidence-not-defaulted', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'string confidence',
            presentationRecommendation: makePresentationRecommendationCandidate({
                confidence: 'not-a-number',
            }),
        }),
    }], '安全校验'],
    ['invalid-presentation-policy-not-clamped', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'invalid policy',
            presentationRecommendation: makePresentationRecommendationCandidate({
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    extractionPolicy: {
                        ...makePresentationRecommendationCandidate().recommendedProfile.extractionPolicy,
                        confidenceThreshold: 99,
                        maxRecentMessages: 999,
                    },
                },
            }),
        }),
    }], '安全校验'],
    ['string-presentation-policy-not-defaulted', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'string policy',
            presentationRecommendation: makePresentationRecommendationCandidate({
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    extractionPolicy: {
                        ...makePresentationRecommendationCandidate().recommendedProfile.extractionPolicy,
                        confidenceThreshold: 'high',
                        maxRecentMessages: 'many',
                    },
                },
            }),
        }),
    }], '安全校验'],
    ['invalid-presentation-module-not-filtered', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'invalid module',
            presentationRecommendation: makePresentationRecommendationCandidate({
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    preferredModules: ['rpg-status', 'provider-made-module'],
                },
            }),
        }),
    }], '安全校验'],
    ['wrong-type-presentation-array-not-filtered', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'wrong array',
            presentationRecommendation: makePresentationRecommendationCandidate({
                evidence: {
                    matchedSignals: ['signal-hp-ac-format', { text: 'must be rejected' }],
                },
            }),
        }),
    }], '安全校验'],
    ['invalid-visual-field-not-defaulted', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'invalid visual',
            presentationRecommendation: makePresentationRecommendationCandidate({
                recommendedProfile: {
                    ...makePresentationRecommendationCandidate().recommendedProfile,
                    visualPriority: {
                        primaryPanel: 'provider-made-module',
                        secondaryPanels: ['inventory'],
                        collapseBelowWidth: 12,
                    },
                },
            }),
        }),
    }], '安全校验'],
    ['missing-presentation-profile-fields', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'missing fields',
            presentationRecommendation: {
                detectedGenre: 'rpg-adventure',
                confidence: 0.8,
                evidence: {
                    matchedSignals: ['signal-hp-ac-format'],
                },
                safeWarnings: ['warning-admin-review-required'],
                noClaim: ['no-runtime-llm-assistant'],
            },
        }),
    }], '安全校验'],
    ['provider-example-code-not-accepted', [{
        status: 200,
        plan: makeLlmPlan({
            title: 'provider example code',
            presentationRecommendation: {
                ...makePresentationRecommendationCandidate(),
                evidence: {
                    matchedSignals: ['signal-hp-ac-format'],
                    exampleTemplateCodes: ['example-hp-current-max'],
                },
            },
        }),
    }], '安全校验'],
    ['top-level-provider-warning-text-not-accepted', [{
        status: 200,
        plan: {
            ...makeLlmPlan({ title: 'provider warning text' }),
            safeWarnings: ['must be rejected'],
        },
    }], '安全校验'],
]) {
    const fake = createFakeLlmFetch(scenarios);
    const server = createScriptImportAssistantService({
        store: new MemoryDraftStore(),
        adminToken,
        llmBaseUrl: 'https://provider.example/v1',
        llmModel: 'story-planner',
        llmApiKey: llmSecret,
        llmRetryCount: 0,
        llmFetch: fake.fetch,
        llmSleep: fake.sleep,
    });
    await listen(server);
    baseUrl = serverBaseUrl(server);
    try {
        const created = await fetchJson('/v1/admin/script-import/drafts', {
            method: 'POST',
            body: draftRequest,
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        assert.equal(created.draft.summary.usesLlm, false, `${label} must fallback without LLM acceptance`);
        assert.equal(created.draft.importPlan.writePolicy, 'deferred-aa3');
        assertPresentationRecommendationDraft(created.draft, { usesLlm: false });
        assert.equal(created.draft.presentationRecommendation.safeWarnings.includes('warning-provider-output-rejected'), true);
        assert.equal(created.draft.safeWarnings.some((warning) => warning.includes(expectedWarning)), true, `${label} warning must include ${expectedWarning}`);
        assert.equal(JSON.stringify(created).includes('SCRIPT_IMPORT_LLM_'), false, `${label} must not expose internal provider codes`);
        assert.equal(JSON.stringify(created).includes('https://provider.example'), false, `${label} must not expose provider URL`);
        assert.equal(JSON.stringify(created).includes('server down'), false, `${label} must not expose provider response`);
        assert.equal(JSON.stringify(created).includes('bad key'), false, `${label} must not expose provider auth error`);
        if (label === 'non-retriable-4xx') {
            assert.equal(fake.calls.length, 1, '401 should not be retried');
        }
        assertNoRuntimeStoryAuthority(created);
        assertNoLeak(created, [adminToken, llmSecret, sourceDialogue, 'must be rejected']);
    } finally {
        server.close();
    }
}

const llmTimeout = createFakeLlmFetch([{ timeout: true }]);
const llmTimeoutServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmTimeoutMs: 1,
    llmRetryCount: 0,
    llmFetch: llmTimeout.fetch,
    llmSleep: llmTimeout.sleep,
});
await listen(llmTimeoutServer);
baseUrl = serverBaseUrl(llmTimeoutServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.usesLlm, false);
    assertPresentationRecommendationDraft(created.draft, { usesLlm: false });
    assert.equal(created.draft.safeWarnings.some((warning) => warning.includes('等待太久')), true);
    assert.equal(JSON.stringify(created).includes('SCRIPT_IMPORT_LLM_'), false);
    assertNoRuntimeStoryAuthority(created);

    console.log('script import assistant real LLM provider failure/redaction/timeout tests passed');
} finally {
    llmTimeoutServer.close();
}

const llmBodyTimeout = createFakeLlmFetch([{ bodyTimeout: true }]);
const llmBodyTimeoutServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmTimeoutMs: 1,
    llmRetryCount: 0,
    llmFetch: llmBodyTimeout.fetch,
    llmSleep: llmBodyTimeout.sleep,
});
await listen(llmBodyTimeoutServer);
baseUrl = serverBaseUrl(llmBodyTimeoutServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.usesLlm, false);
    assertPresentationRecommendationDraft(created.draft, { usesLlm: false });
    assert.equal(created.draft.safeWarnings.some((warning) => warning.includes('等待太久')), true);
    assert.equal(JSON.stringify(created).includes('SCRIPT_IMPORT_LLM_'), false);
    assertNoRuntimeStoryAuthority(created);
    assertNoLeak(created, [adminToken, llmSecret, sourceDialogue]);

    console.log('script import assistant real LLM provider body-timeout tests passed');
} finally {
    llmBodyTimeoutServer.close();
}

const llmOversize = createFakeLlmFetch([
    { status: 200, plan: makeLlmPlan({ title: 'should not be called' }) },
]);
const llmOversizeServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    llmBaseUrl: 'https://provider.example/v1',
    llmModel: 'story-planner',
    llmApiKey: llmSecret,
    llmMaxInputChars: 1000,
    llmFetch: llmOversize.fetch,
    llmSleep: llmOversize.sleep,
});
await listen(llmOversizeServer);
baseUrl = serverBaseUrl(llmOversizeServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: {
            ...draftRequest,
            files: [{
                name: 'oversize-for-llm.md',
                type: 'text/markdown',
                text: 'x'.repeat(1200),
            }],
        },
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(created.draft.summary.usesLlm, false);
    assertPresentationRecommendationDraft(created.draft, { usesLlm: false });
    assert.equal(created.draft.safeWarnings.some((warning) => warning.includes('剧本内容较长')), true);
    assert.equal(JSON.stringify(created).includes('SCRIPT_IMPORT_LLM_'), false);
    assert.equal(llmOversize.calls.length, 0);
    assertNoRuntimeStoryAuthority(created);

    console.log('script import assistant real LLM provider size-refusal tests passed');
} finally {
    llmOversizeServer.close();
}

const noCorsProtectedServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
});
await listen(noCorsProtectedServer);
baseUrl = serverBaseUrl(noCorsProtectedServer);

try {
    const directSameOriginStyle = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(directSameOriginStyle.ok, true);

    const crossOriginWithoutWhitelist = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
            Origin: 'http://evil.example',
        },
    });
    assert.equal(crossOriginWithoutWhitelist.status, 403);
    assert.equal(crossOriginWithoutWhitelist.body.error, 'ADMIN_ORIGIN_NOT_ALLOWED');
    assert.equal(crossOriginWithoutWhitelist.headers.get('access-control-allow-origin'), null);

    console.log('script import assistant default CORS fail-closed tests passed');
} finally {
    noCorsProtectedServer.close();
}

const expiredServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    adminTokenExpiresAt: '2000-01-01T00:00:00.000Z',
});
await listen(expiredServer);
baseUrl = serverBaseUrl(expiredServer);

try {
    const expired = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error, 'ADMIN_AUTH_EXPIRED');

    console.log('script import assistant expired token tests passed');
} finally {
    expiredServer.close();
}

const invalidExpiryServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    adminTokenExpiresAt: 'not-a-date',
});
await listen(invalidExpiryServer);
baseUrl = serverBaseUrl(invalidExpiryServer);

try {
    const health = await fetchJson('/v1/health');
    assertHealthResponse(health);
    assert.equal(health.adminAuth.configured, false);
    assert.equal(health.adminAuth.mode, 'invalid');
    assert.equal(health.adminAuth.configurationError, 'ADMIN_AUTH_EXPIRY_INVALID');
    assertNoLeak(health, [adminToken]);

    const invalid = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(invalid.status, 503);
    assert.equal(invalid.body.error, 'ADMIN_AUTH_EXPIRY_INVALID');

    console.log('script import assistant invalid expiry fail-closed tests passed');
} finally {
    invalidExpiryServer.close();
}

const externalAuthServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    trustExternalAuth: true,
});
await listen(externalAuthServer);
baseUrl = serverBaseUrl(externalAuthServer);

try {
    const health = await fetchJson('/v1/health');
    assertHealthResponse(health);
    assert.equal(health.adminAuth.mode, 'external-auth-boundary');
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
    });
    assert.equal(created.ok, true);
    assert.equal(created.draft.summary.importOnly, true);

    console.log('script import assistant external auth boundary tests passed');
} finally {
    externalAuthServer.close();
}

const directExposedExternalAuthServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    trustExternalAuth: true,
    host: '0.0.0.0',
});
await listen(directExposedExternalAuthServer);
baseUrl = serverBaseUrl(directExposedExternalAuthServer);

try {
    const health = await fetchJson('/v1/health');
    assertHealthResponse(health);
    assert.equal(health.adminAuth.configured, false);
    assert.equal(health.adminAuth.configurationError, 'EXTERNAL_AUTH_BOUNDARY_UNVERIFIED');

    const exposed = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
    });
    assert.equal(exposed.status, 503);
    assert.equal(exposed.body.error, 'EXTERNAL_AUTH_BOUNDARY_UNVERIFIED');

    console.log('script import assistant direct exposure external-auth rejection tests passed');
} finally {
    directExposedExternalAuthServer.close();
}

const proxyToken = 'trusted-proxy-secret';
const verifiedExternalAuthServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    trustExternalAuth: true,
    trustedProxyToken: proxyToken,
    host: '0.0.0.0',
});
await listen(verifiedExternalAuthServer);
baseUrl = serverBaseUrl(verifiedExternalAuthServer);

try {
    const missingProxyProof = await rawFetch('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
    });
    assert.equal(missingProxyProof.status, 401);
    assert.equal(missingProxyProof.body.error, 'ADMIN_AUTH_REQUIRED');

    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            'X-Galgame-Trusted-Proxy-Token': proxyToken,
        },
    });
    assert.equal(created.ok, true);
    assert.equal(created.draft.summary.importOnly, true);
    assertNoLeak(created, [proxyToken, sourceDialogue]);

    console.log('script import assistant verified external auth proxy tests passed');
} finally {
    verifiedExternalAuthServer.close();
}

const conflictImporter = createFakeOriginalResourceImporter();
const conflictServer = createScriptImportAssistantService({
    store: new MemoryDraftStore(),
    adminToken,
    resourceImporter: conflictImporter,
});
await listen(conflictServer);
baseUrl = serverBaseUrl(conflictServer);

try {
    const created = await fetchJson('/v1/admin/script-import/drafts', {
        method: 'POST',
        body: draftRequest,
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    const first = await fetchJson(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
        method: 'POST',
        body: {},
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(first.ok, true);
    conflictImporter.tamperCharacterMetadata('different-source');
    const conflict = await rawFetch(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
        method: 'POST',
        body: {},
        headers: {
            Authorization: `Bearer ${adminToken}`,
        },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error, 'SCRIPT_IMPORT_RESOURCE_CONFLICT');
    assert.equal(conflict.body.status, 'conflict');
    assert.equal(conflict.body.safeMessage.includes('避免覆盖'), true);
    assertNoLeak(conflict.body, [adminToken, sourceDialogue]);

    console.log('script import assistant original resource conflict tests passed');
} finally {
    conflictServer.close();
}

for (const tamperKind of [
    'character-body',
    'character-runtime-semantics',
    'character-embedded-book',
    'character-regex-runtime',
    'character-unknown-runtime-extension',
    'worldbook-body',
    'worldbook-runtime-semantics',
    'worldbook-extension-runtime-semantics',
    'worldbook-unknown-runtime-field',
    'chat-seed-body',
]) {
    const bodyConflictImporter = createFakeOriginalResourceImporter();
    const bodyConflictServer = createScriptImportAssistantService({
        store: new MemoryDraftStore(),
        adminToken,
        resourceImporter: bodyConflictImporter,
    });
    await listen(bodyConflictServer);
    baseUrl = serverBaseUrl(bodyConflictServer);
    try {
        const created = await fetchJson('/v1/admin/script-import/drafts', {
            method: 'POST',
            body: draftRequest,
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        const first = await fetchJson(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
            method: 'POST',
            body: {},
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        assert.equal(first.ok, true);
        const writesBefore = bodyConflictImporter.getWriteCounts();
        bodyConflictImporter.tamperResourceBody(tamperKind);
        const conflict = await rawFetch(`/v1/admin/script-import/drafts/${created.draft.draftId}/confirm`, {
            method: 'POST',
            body: {},
            headers: {
                Authorization: `Bearer ${adminToken}`,
            },
        });
        assert.equal(conflict.status, 409);
        assert.equal(conflict.body.error, 'SCRIPT_IMPORT_RESOURCE_CONFLICT');
        assert.equal(conflict.body.conflict.actualBodyHash.length > 0, true);
        assert.notEqual(conflict.body.conflict.actualBodyHash, conflict.body.conflict.expectedResourceHash);
        if (tamperKind.includes('unknown')) {
            assert.ok(
                conflict.body.conflict.unsupportedFindings?.length > 0,
                `${tamperKind} must fail closed with unsupported findings`,
            );
        }
        assert.deepEqual(bodyConflictImporter.getWriteCounts(), writesBefore, `${tamperKind} conflict must not overwrite any ST resource`);
        assertNoLeak(conflict.body, [adminToken, sourceDialogue]);
    } finally {
        bodyConflictServer.close();
    }
}

console.log('script import assistant body-hash conflict/no-overwrite tests passed');

console.log('script import assistant tests passed');

async function fetchJson(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await rawFetch(path, { method, body, headers });
    assert.equal(response.ok, true, response.body.error || JSON.stringify(response.body));
    return response.body;
}

async function rawFetch(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            ...headers,
            ...(body === undefined ? {} : {
                'Content-Type': 'application/json',
            }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsedBody = {};
    if (text) {
        try {
            parsedBody = JSON.parse(text);
        } catch {
            parsedBody = { text };
        }
    }
    return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        body: parsedBody,
    };
}

function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function serverBaseUrl(server) {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
}

function assertNoLeak(value, secrets) {
    const text = JSON.stringify(value);
    for (const secret of secrets) {
        assert.equal(text.includes(secret), false, `response leaked ${secret}`);
    }
}

function assertHealthResponse(value) {
    assert.deepEqual(Object.keys(value).sort(), [
        'adminAuth',
        'llm',
        'ok',
        'protocolVersion',
        'service',
    ]);
    assert.deepEqual(Object.keys(value.adminAuth).sort(), [
        'configurationError',
        'configured',
        'expires',
        'loopbackOnlyTrust',
        'mode',
        'proxyProofRequired',
        'required',
    ]);
    assert.deepEqual(Object.keys(value.llm).sort(), [
        'apiKeyConfigured',
        'apiKeySource',
        'baseUrlConfigured',
        'configured',
        'modelConfigured',
        'provider',
    ]);
    assertNoForbiddenHealthKeys(value);
}

function assertNoForbiddenHealthKeys(value) {
    const forbidden = new Set([
        'drafts',
        'draft',
        'draftId',
        'sourceDigest',
        'sourceStats',
        'files',
        'upload',
        'uploads',
        'source',
        'sourceText',
        'text',
        'prompt',
        'importPlan',
        'characterCard',
        'worldBook',
        'worldbook',
        'resourceBody',
    ]);
    const keys = collectKeys(value);
    for (const key of keys) {
        assert.equal(forbidden.has(key), false, `health leaked forbidden key: ${key}`);
    }
}

function assertNoRuntimeStoryAuthority(value) {
    const forbidden = new Set([
        'dialogue',
        'line',
        'lines',
        'choice',
        'choices',
        'node',
        'nodes',
        'ending',
        'endings',
        'sceneResult',
        'story',
        'runtimeStory',
        'localStoryState',
        'manifest',
        'prompt',
    ]);
    const keys = collectKeys(value);
    for (const key of keys) {
        assert.equal(forbidden.has(key), false, `runtime story key leaked: ${key}`);
    }
}

function assertPresentationRecommendationDraft(draft, {
    usesLlm,
    template,
    primaryPanel,
} = {}) {
    const recommendation = draft.presentationRecommendation;
    assert.equal(recommendation.schemaVersion, 'galgame.presentation-recommendation.v1');
    assert.match(recommendation.recommendationId, /^rec_[a-z0-9_-]{12,80}$/);
    assert.match(recommendation.sourceDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(recommendation.draftId, draft.draftId);
    assert.equal(recommendation.revision, draft.revision);
    assert.equal(recommendation.usesLlm, usesLlm);
    assert.equal(recommendation.evidence.sourceKind, 'uploaded-admin-material');
    assert.match(recommendation.evidence.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Array.isArray(recommendation.evidence.matchedSignals), true);
    assert.equal(recommendation.evidence.matchedSignals.every((code) => /^signal-[a-z0-9-]+$/.test(code)), true);
    assert.equal(Array.isArray(recommendation.evidence.exampleTemplateCodes), true);
    assert.equal(recommendation.safeWarnings.every((code) => /^warning-[a-z0-9-]+$/.test(code)), true);
    assert.equal(recommendation.noClaim.every((code) => /^no-[a-z0-9-]+$/.test(code)), true);
    assert.equal(recommendation.recommendedProfile.extractionPolicy.allowAdminPatterns, false);
    assert.deepEqual(recommendation.recommendedProfile.adminPatterns || [], []);
    if (template) {
        assert.equal(recommendation.recommendedProfile.template, template);
    }
    if (primaryPanel) {
        assert.equal(recommendation.recommendedProfile.visualPriority.primaryPanel, primaryPanel);
    }
    assert.equal(JSON.stringify(recommendation).includes(sourceDialogue), false);
    assert.equal(JSON.stringify(recommendation).includes('redactedExamples'), false);
    assert.equal(JSON.stringify(recommendation).includes('rawRecommendation'), false);
    assert.equal(JSON.stringify(recommendation).includes('providerResponse'), false);
}

function assertConfirmManifestReferencesOnly(value) {
    const manifest = value.manifest;
    assert.equal(manifest.schemaVersion, '1.0');
    assert.equal(manifest.story.mode, 'sillytavern-live');
    assert.deepEqual(manifest.story.nodes, {});
    assert.equal(manifest.arcs[0].status, 'draft');
    assert.equal(Object.hasOwn(manifest.arcs[0], 'publishedAt'), false);
    assert.match(manifest.sillyTavernBindings.characters[0].id, /^Galgame_AIImport_/);
    assert.match(manifest.sillyTavernBindings.characters[0].avatar, /^galgame_aiimport_/);
    assert.match(manifest.sillyTavernBindings.worldBooks[0].name, /^Galgame_AIImport_/);
    assert.match(manifest.sillyTavernBindings.chatSeedId, /^galgame-aiimport-/);
    assert.equal(JSON.stringify(manifest).includes(sourceDialogue), false);
    assert.equal(JSON.stringify(manifest).includes('presentationRecommendation'), false);
    assert.equal(JSON.stringify(manifest).includes('recommendedProfile'), false);
    for (const forbidden of [
        'description',
        'personality',
        'scenario',
        'first_mes',
        'mes_example',
        'entries',
        'content',
        'choices',
        'ending',
        'prompt',
    ]) {
        assert.equal(Object.keys(JSON.parse(JSON.stringify(manifest))).includes(forbidden), false);
        assert.equal(JSON.stringify(manifest).includes(`"${forbidden}"`), false);
    }
}

function makeLlmPlan({
    title = 'LLM 计划草稿',
    characterName = 'Galgame_AIImport_Llm_Director',
    characterAvatar = 'galgame_aiimport_llm_director.png',
    worldBookName = 'Galgame_AIImport_Llm_World',
    chatSeedId = 'galgame-aiimport-llm-seed',
    presentationRecommendation = makePresentationRecommendationCandidate(),
} = {}) {
    return {
        protocolVersion: 'galgame.script-import-llm-plan.v1',
        summary: {
            title,
            recommendedTemplate: 'visual-novel',
            mainCharacters: ['Anna', 'Andrei'],
            worldBookCount: 1,
            openingReady: true,
        },
        importPlan: {
            characterName,
            characterAvatar,
            worldBookName,
            chatSeedId,
        },
        presentationRecommendation,
    };
}

function makePresentationRecommendationCandidate(overrides = {}) {
    return {
        detectedGenre: 'rpg-adventure',
        confidence: 0.86,
        recommendedProfile: {
            template: 'rpg-adventure',
            preferredModules: ['rpg-status', 'inventory', 'abilities', 'quests', 'dice', 'actions'],
            disabledModules: [],
            extractionPolicy: {
                confidenceThreshold: 0.78,
                maxRecentMessages: 5,
                allowAdminPatterns: false,
                allowBuiltinPatterns: true,
                lowConfidenceBehavior: 'plain-dialogue',
            },
            visualPriority: {
                primaryPanel: 'rpg-status',
                secondaryPanels: ['inventory', 'abilities', 'quests'],
                collapseBelowWidth: 640,
            },
        },
        evidence: {
            matchedSignals: ['signal-hp-ac-format', 'signal-inventory-section', 'signal-equipment-section'],
        },
        safeWarnings: ['warning-admin-review-required', 'warning-patterns-disabled'],
        noClaim: ['no-runtime-llm-assistant', 'no-hidden-resource-reading', 'no-prompt-context-copy', 'no-frontend-combat-calculation'],
        ...overrides,
    };
}

function createFakeLlmFetch(scenarios = []) {
    const calls = [];
    const sleeps = [];
    return {
        calls,
        sleeps,
        async sleep(ms) {
            sleeps.push(ms);
        },
        async fetch(url, options = {}) {
            const scenario = scenarios[Math.min(calls.length, Math.max(scenarios.length - 1, 0))] || {};
            const body = JSON.parse(String(options.body || '{}'));
            const userMessage = (Array.isArray(body.messages) ? body.messages : [])
                .find((message) => message.role === 'user');
            const input = userMessage?.content ? JSON.parse(userMessage.content) : {};
            calls.push({
                url,
                authorization: options.headers?.Authorization || '',
                idempotencyKey: options.headers?.['Idempotency-Key'] || '',
                body,
                input,
            });
            if (scenario.timeout) {
                return new Promise((resolve, reject) => {
                    options.signal?.addEventListener('abort', () => {
                        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
                    }, { once: true });
                });
            }
            if (scenario.throwMessage) {
                throw new Error(scenario.throwMessage);
            }
            if (scenario.bodyTimeout) {
                return {
                    ok: true,
                    status: scenario.status || 200,
                    async json() {
                        return new Promise(() => {});
                    },
                };
            }
            if (Object.hasOwn(scenario, 'text')) {
                return new Response(scenario.text, {
                    status: scenario.status || 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            const responseBody = scenario.plan
                ? { choices: [{ message: { content: JSON.stringify(scenario.plan) } }] }
                : scenario.body || {};
            return new Response(JSON.stringify(responseBody), {
                status: scenario.status || 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
}

function makePlannerDraft({
    sourceDigest,
    revision = 1,
    draftId = '',
    summary = {},
    importPlan = {},
    presentationRecommendation = makePresentationRecommendationCandidate(),
} = {}) {
    return {
        protocolVersion: 'galgame.script-import-draft.v1',
        draftId: draftId || `draft_${sourceDigest.slice(0, 16)}`,
        revision,
        status: 'ready-for-confirmation',
        summary: {
            title: '安全 planner 草稿',
            recommendedTemplate: 'visual-novel',
            mainCharacters: ['Anna'],
            worldBookCount: 1,
            openingReady: true,
            usesLlm: false,
            importOnly: true,
            playerCallable: false,
            ...summary,
        },
        importPlan: {
            characterName: 'Galgame_AIImport_Planner_Director',
            characterAvatar: 'galgame_aiimport_planner_director.png',
            worldBookName: 'Galgame_AIImport_Planner_World',
            chatSeedId: 'galgame-aiimport-planner-seed',
            writePolicy: 'deferred-aa3',
            ...importPlan,
        },
        sourceDigest,
        sourceStats: {
            fileCount: 1,
            totalCharacters: 100,
        },
        presentationRecommendation,
    };
}

async function assertConfirmDoesNotPublishActiveRelease(manifest) {
    const store = new LocalReleaseStore(makePublishedManifest(manifest), new MemoryStorageBackend());
    const before = await store.getActiveRelease();
    const directPublish = await store.publishManifest(manifest, { activeArcId: manifest.defaultArcId });
    assert.equal(directPublish.ok, false);
    assert.match(directPublish.validation.errors.join('\n'), /cannot be published/);
    const afterRejected = await store.getActiveRelease();
    assert.equal(afterRejected.releaseId, before.releaseId);

    const explicitPublish = await store.publishManifest(makePublishedManifest(manifest), {
        activeArcId: manifest.defaultArcId,
    });
    assert.equal(explicitPublish.ok, true);
    const afterPublish = await store.getActiveRelease();
    assert.equal(afterPublish.releaseId, explicitPublish.release.releaseId);
    assert.equal(afterPublish.contentHash, explicitPublish.release.contentHash);
    assert.equal(afterPublish.activeArcId, manifest.defaultArcId);
}

function makePublishedManifest(manifest) {
    const publishedAt = '2026-07-26T00:00:00.000Z';
    const profileBoundManifest = bindAdaptivePresentationProfileHashes(manifest, { arcId: manifest.defaultArcId });
    return {
        ...profileBoundManifest,
        updatedAt: publishedAt,
        arcs: profileBoundManifest.arcs.map((arc) => ({
            ...arc,
            status: 'published',
            publishedAt,
        })),
    };
}

function collectKeys(value, keys = []) {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectKeys(item, keys);
        }
        return keys;
    }
    if (!value || typeof value !== 'object') {
        return keys;
    }
    for (const [key, item] of Object.entries(value)) {
        keys.push(key);
        collectKeys(item, keys);
    }
    return keys;
}

function createFakeOriginalResourceImporter() {
    const fake = createFakeOriginalStore();
    return {
        async confirmDraft(record) {
            return importDraftToOriginalSillyTavern({
                record,
                client: fake.client,
                chatBridge: fake.chatBridge,
                fetchWithCookies: fake.fetchWithCookies,
                baseUrl: 'http://fake.sillytavern',
                now: () => new Date('2026-07-26T00:00:00.000Z'),
            });
        },
        tamperCharacterMetadata(sourceDigest) {
            fake.tamperCharacterMetadata(sourceDigest);
        },
        tamperResourceBody(kind) {
            fake.tamperResourceBody(kind);
        },
        getWriteCounts() {
            return fake.getWriteCounts();
        },
        calls: fake.calls,
    };
}

function createFakeOriginalStore() {
    const worlds = new Map();
    const characters = new Map();
    const chats = new Map();
    const calls = [];
    const client = {
        async getCsrfToken() {
            return 'fake-csrf';
        },
        async requestJson(endpoint, { body = {} } = {}) {
            calls.push({ endpoint, body: sanitizeCallBody(body) });
            if (endpoint === '/api/worldinfo/list') {
                return [...worlds.entries()].map(([name, data]) => ({
                    name,
                    file_id: name,
                    extensions: data.extensions || {},
                }));
            }
            if (endpoint === '/api/worldinfo/get') {
                return worlds.get(body.name) || { entries: {} };
            }
            if (endpoint === '/api/worldinfo/edit') {
                worlds.set(body.name, structuredClone(body.data));
                return { ok: true };
            }
            if (endpoint === '/api/characters/all') {
                return Object.fromEntries([...characters.values()].map((character, index) => [
                    String(index),
                    {
                        name: character.name,
                        avatar: character.avatar,
                        filename: character.avatar,
                    },
                ]));
            }
            if (endpoint === '/api/characters/create') {
                const avatar = `${String(body.file_name || body.ch_name || 'character').replace(/\.png$/i, '')}.png`;
                characters.set(avatar, {
                    avatar,
                    name: body.ch_name,
                    data: normalizeCharacterData(body, worlds),
                });
                return avatar;
            }
            if (endpoint === '/api/characters/get') {
                const character = characters.get(body.avatar_url);
                if (!character) {
                    throw new Error('CHARACTER_NOT_FOUND');
                }
                return structuredClone(character);
            }
            throw new Error(`UNEXPECTED_ENDPOINT_${endpoint}`);
        },
    };
    const fetchWithCookies = async (url, options = {}) => {
        calls.push({ endpoint: new URL(url).pathname, method: options.method || 'GET' });
        if (!String(url).endsWith('/api/characters/edit')) {
            return new Response(JSON.stringify({ error: 'unexpected' }), { status: 404 });
        }
        const form = options.body;
        const avatar = String(form.get('avatar_url'));
        characters.set(avatar, {
            avatar,
            name: String(form.get('ch_name')),
            data: normalizeCharacterData(Object.fromEntries(form.entries()), worlds),
        });
        return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
                'content-type': 'application/json',
            },
        });
    };
    fetchWithCookies.remember = () => {};
    fetchWithCookies.cookieHeader = () => '';

    const chatBridge = {
        async listCharacterChats({ avatar }) {
            calls.push({ endpoint: '/api/characters/chats', avatar });
            return [...chats.keys()]
                .filter((key) => key.startsWith(`${avatar}::`))
                .map((key) => {
                    const fileId = key.split('::')[1];
                    return { fileId, fileName: fileId };
                });
        },
        async getCharacterChat({ avatar, fileName }) {
            calls.push({ endpoint: '/api/chats/get', avatar, fileName });
            return structuredClone(chats.get(`${avatar}::${fileName}`) || []);
        },
        async saveCharacterChat({ avatar, fileName, chat }) {
            calls.push({ endpoint: '/api/chats/save', avatar, fileName });
            chats.set(`${avatar}::${fileName}`, structuredClone(chat));
            return { ok: true };
        },
    };

    return {
        calls,
        client,
        chatBridge,
        fetchWithCookies,
        tamperCharacterMetadata(sourceDigest) {
            const first = characters.values().next().value;
            if (!first) {
                return;
            }
            first.data.extensions.galgameScriptImport.sourceDigest = sourceDigest;
        },
        tamperResourceBody(kind) {
            if (kind === 'character-body') {
                const first = characters.values().next().value;
                if (first) {
                    first.data.description = `${first.data.description} changed outside importer`;
                }
                return;
            }
            if (kind === 'character-runtime-semantics') {
                const first = characters.values().next().value;
                if (first) {
                    first.data.extensions.depth_prompt.prompt = 'changed depth prompt outside importer';
                    first.data.extensions.depth_prompt.depth = 9;
                    first.data.extensions.depth_prompt.role = 'assistant';
                    first.data.extensions.talkativeness = 0.1;
                }
                return;
            }
            if (kind === 'character-embedded-book') {
                const first = characters.values().next().value;
                const embeddedEntry = first?.data?.character_book?.entries?.[0];
                if (embeddedEntry) {
                    embeddedEntry.content = `${embeddedEntry.content}\nchanged embedded lore outside importer`;
                }
                return;
            }
            if (kind === 'character-regex-runtime') {
                const first = characters.values().next().value;
                if (first) {
                    first.data.extensions.regex_scripts = [{
                        id: 'regex-smoke',
                        scriptName: 'Runtime rewrite',
                        findRegex: '/Anna/g',
                        replaceString: 'Changed Anna',
                        trimStrings: [],
                        placement: [1, 2],
                        disabled: false,
                        markdownOnly: false,
                        promptOnly: true,
                        runOnEdit: false,
                        substituteRegex: 0,
                        minDepth: 0,
                        maxDepth: 4,
                    }];
                }
                return;
            }
            if (kind === 'character-unknown-runtime-extension') {
                const first = characters.values().next().value;
                if (first) {
                    first.data.extensions.prompt_transform_script = {
                        mode: 'unexpected-runtime-extension',
                    };
                }
                return;
            }
            if (kind === 'worldbook-body') {
                const first = worlds.values().next().value;
                const firstKey = Object.keys(first?.entries || {})[0];
                if (firstKey !== undefined) {
                    first.entries[firstKey].content = `${first.entries[firstKey].content}\nchanged outside importer`;
                }
                return;
            }
            if (kind === 'worldbook-runtime-semantics') {
                const first = worlds.values().next().value;
                const firstKey = Object.keys(first?.entries || {})[0];
                if (firstKey !== undefined) {
                    first.entries[firstKey].probability = 10;
                    first.entries[firstKey].useProbability = true;
                    first.entries[firstKey].matchCharacterDepthPrompt = true;
                    first.entries[firstKey].scanDepth = 12;
                    first.entries[firstKey].caseSensitive = true;
                    first.entries[firstKey].matchWholeWords = false;
                    first.entries[firstKey].useGroupScoring = true;
                    first.entries[firstKey].sticky = 3;
                    first.entries[firstKey].cooldown = 2;
                    first.entries[firstKey].delay = 1;
                    first.entries[firstKey].role = 1;
                    first.entries[firstKey].triggers = ['continue'];
                }
                return;
            }
            if (kind === 'worldbook-extension-runtime-semantics') {
                const first = worlds.values().next().value;
                const firstKey = Object.keys(first?.entries || {})[0];
                if (firstKey !== undefined) {
                    first.entries[firstKey].extensions = {
                        ...(first.entries[firstKey].extensions || {}),
                        scan_depth: 8,
                        case_sensitive: true,
                        match_whole_words: true,
                        use_group_scoring: true,
                        match_character_depth_prompt: true,
                        sticky: 2,
                        cooldown: 1,
                        delay: 1,
                        role: 1,
                    };
                }
                return;
            }
            if (kind === 'worldbook-unknown-runtime-field') {
                const first = worlds.values().next().value;
                const firstKey = Object.keys(first?.entries || {})[0];
                if (firstKey !== undefined) {
                    first.entries[firstKey].extensions = {
                        ...(first.entries[firstKey].extensions || {}),
                        custom_scan_prompt: 'unsupported runtime field must not be silently skipped',
                    };
                }
                return;
            }
            if (kind === 'chat-seed-body') {
                const first = chats.values().next().value;
                if (Array.isArray(first) && first[1]) {
                    first[1].mes = `${first[1].mes}\nchanged outside importer`;
                }
            }
        },
        getWriteCounts() {
            const writeEndpoints = new Set([
                '/api/worldinfo/edit',
                '/api/characters/create',
                '/api/characters/edit',
                '/api/chats/save',
            ]);
            return calls
                .filter((call) => writeEndpoints.has(call.endpoint))
                .reduce((summary, call) => ({
                    ...summary,
                    [call.endpoint]: (summary[call.endpoint] || 0) + 1,
                }), {});
        },
    };
}

function normalizeCharacterData(body, worlds = new Map()) {
    const extensions = typeof body.extensions === 'string'
        ? JSON.parse(body.extensions || '{}')
        : body.extensions || {};
    extensions.talkativeness = Number.isFinite(Number(body.talkativeness))
        ? Number(body.talkativeness)
        : extensions.talkativeness;
    extensions.world = body.world || extensions.world || '';
    extensions.depth_prompt = {
        prompt: body.depth_prompt_prompt ?? extensions.depth_prompt?.prompt ?? '',
        depth: Number.isFinite(Number(body.depth_prompt_depth))
            ? Number(body.depth_prompt_depth)
            : extensions.depth_prompt?.depth ?? 4,
        role: body.depth_prompt_role ?? extensions.depth_prompt?.role ?? 'system',
    };
    const normalized = {
        name: body.ch_name,
        description: body.description || '',
        personality: body.personality || '',
        scenario: body.scenario || '',
        first_mes: body.first_mes || '',
        mes_example: body.mes_example || '',
        creator_notes: body.creator_notes || '',
        system_prompt: body.system_prompt || '',
        post_history_instructions: body.post_history_instructions || '',
        creator: body.creator || '',
        tags: body.tags || '',
        world: body.world || '',
        alternate_greetings: parseMaybeJson(body.alternate_greetings),
        extensions,
    };
    const world = body.world || extensions.world || '';
    const worldBook = worlds.get(world);
    if (worldBook) {
        normalized.character_book = convertFakeWorldBookToCharacterBook(worldBook);
    }
    return normalized;
}

function convertFakeWorldBookToCharacterBook(worldBook) {
    const entries = worldBook?.entries && typeof worldBook.entries === 'object' ? worldBook.entries : {};
    return {
        name: worldBook.name || '',
        entries: Object.values(entries).map((entry, index) => ({
            id: entry.uid ?? index,
            keys: entry.key || [],
            secondary_keys: entry.keysecondary || [],
            comment: entry.comment || '',
            content: entry.content || '',
            constant: entry.constant || false,
            selective: entry.selective || false,
            insertion_order: entry.order,
            enabled: !entry.disable,
            position: entry.position === 0 ? 'before_char' : 'after_char',
            use_regex: true,
            extensions: {
                ...(entry.extensions || {}),
                position: entry.position,
                exclude_recursion: entry.excludeRecursion,
                display_index: entry.displayIndex,
                probability: entry.probability ?? null,
                useProbability: entry.useProbability ?? false,
                depth: entry.depth ?? 4,
                selectiveLogic: entry.selectiveLogic ?? 0,
                outlet_name: entry.outletName ?? '',
                group: entry.group ?? '',
                group_override: entry.groupOverride ?? false,
                group_weight: entry.groupWeight ?? null,
                prevent_recursion: entry.preventRecursion ?? false,
                delay_until_recursion: entry.delayUntilRecursion ?? false,
                scan_depth: entry.scanDepth ?? null,
                match_whole_words: entry.matchWholeWords ?? null,
                use_group_scoring: entry.useGroupScoring ?? false,
                case_sensitive: entry.caseSensitive ?? null,
                automation_id: entry.automationId ?? '',
                role: entry.role ?? 0,
                vectorized: entry.vectorized ?? false,
                sticky: entry.sticky ?? null,
                cooldown: entry.cooldown ?? null,
                delay: entry.delay ?? null,
                match_persona_description: entry.matchPersonaDescription ?? false,
                match_character_description: entry.matchCharacterDescription ?? false,
                match_character_personality: entry.matchCharacterPersonality ?? false,
                match_character_depth_prompt: entry.matchCharacterDepthPrompt ?? false,
                match_scenario: entry.matchScenario ?? false,
                match_creator_notes: entry.matchCreatorNotes ?? false,
                triggers: entry.triggers ?? [],
                ignore_budget: entry.ignoreBudget ?? false,
            },
        })),
    };
}

function parseMaybeJson(value) {
    if (!value) {
        return [];
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(String(value));
    } catch {
        return [];
    }
}

function sanitizeCallBody(body) {
    if (!body || typeof body !== 'object') {
        return {};
    }
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [
        key,
        typeof value === 'string' && value.length > 80 ? `${value.slice(0, 80)}...` : value,
    ]));
}
