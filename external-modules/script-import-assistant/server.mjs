import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import {
    fileURLToPath,
    pathToFileURL,
} from 'node:url';
import {
    createOriginalSillyTavernImporter,
    ScriptImportResourceConflictError,
    ScriptImportUnavailableError,
} from './original-st-importer.mjs';
import {
    BUILTIN_TEMPLATE_MODULES,
    PRESENTATION_MATCHED_SIGNAL_CODES,
    PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION,
    PRESENTATION_SAFE_WARNING_CODES,
    PRESENTATION_NO_CLAIM_CODES,
    convertPresentationRecommendationToProfile,
    validatePresentationRecommendation,
} from '../../frontend/shared/src/adaptive-presentation-schema.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 8796;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_FILES = 32;
const MAX_SCRIPT_FILE_CHARS = 1_000_000;
const MAX_SCRIPT_TOTAL_CHARS = 1_500_000;
const SUPPORTED_SCRIPT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json']);
const SUPPORTED_SCRIPT_TYPES = new Set(['', 'text/plain', 'text/markdown', 'application/json']);
const DEFAULT_LLM_TIMEOUT_MS = 20_000;
const DEFAULT_LLM_RETRY_COUNT = 1;
const DEFAULT_LLM_MAX_INPUT_CHARS = 120_000;
const DEFAULT_LLM_RETRY_DELAY_MS = 750;
const PRESENTATION_NO_CLAIM_BASE = Object.freeze([
    'no-frontend-combat-calculation',
    'no-frontend-inventory-authority',
    'no-frontend-affection-calculation',
    'no-frontend-resource-calculation',
    'no-chapter-ending-judgment',
    'no-runtime-llm-assistant',
    'no-hidden-resource-reading',
    'no-prompt-context-copy',
]);
const PRESENTATION_TEMPLATE_SET = new Set(Object.keys(BUILTIN_TEMPLATE_MODULES));
const PRESENTATION_MODULE_SET = new Set(Object.values(BUILTIN_TEMPLATE_MODULES).flat());
const PRESENTATION_SIGNAL_SET = new Set(PRESENTATION_MATCHED_SIGNAL_CODES);
const PRESENTATION_WARNING_SET = new Set(PRESENTATION_SAFE_WARNING_CODES);
const PRESENTATION_NO_CLAIM_SET = new Set(PRESENTATION_NO_CLAIM_CODES);

export function createScriptImportAssistantService({
    store = new MemoryDraftStore(),
    corsOrigin = process.env.GALGAME_SCRIPT_ASSISTANT_CORS_ORIGIN || '',
    adminToken = process.env.GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN || '',
    adminTokenExpiresAt = process.env.GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN_EXPIRES_AT || '',
    trustExternalAuth = process.env.GALGAME_SCRIPT_ASSISTANT_TRUST_EXTERNAL_AUTH === 'true',
    trustedProxyToken = process.env.GALGAME_SCRIPT_ASSISTANT_TRUSTED_PROXY_TOKEN || '',
    host = process.env.HOST || '127.0.0.1',
    llmBaseUrl = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_BASE_URL || '',
    llmModel = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_MODEL || '',
    llmApiKey = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY || '',
    llmApiKeyEnv = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_API_KEY_ENV || '',
    llmTimeoutMs = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_TIMEOUT_MS || DEFAULT_LLM_TIMEOUT_MS,
    llmRetryCount = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_RETRY_COUNT || DEFAULT_LLM_RETRY_COUNT,
    llmMaxInputChars = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_MAX_INPUT_CHARS || DEFAULT_LLM_MAX_INPUT_CHARS,
    llmRetryDelayMs = process.env.GALGAME_SCRIPT_ASSISTANT_LLM_RETRY_DELAY_MS || DEFAULT_LLM_RETRY_DELAY_MS,
    llmFetch = globalThis.fetch,
    llmSleep = delay,
    now = () => Date.now(),
    planner = null,
    resourceImporter = createOriginalSillyTavernImporter(),
} = {}) {
    const allowedOrigins = parseAllowedOrigins(corsOrigin);
    const auth = createAdminAuthConfig({
        adminToken,
        adminTokenExpiresAt,
        trustExternalAuth,
        trustedProxyToken,
        host,
        now,
    });
    const llm = createLlmConfig({
        llmBaseUrl,
        llmModel,
        llmApiKey,
        llmApiKeyEnv,
        llmTimeoutMs,
        llmRetryCount,
        llmMaxInputChars,
        llmRetryDelayMs,
        llmFetch,
        llmSleep,
    });

    return http.createServer(async (request, response) => {
        try {
            await handleRequest(request, response, {
                store,
                allowedOrigins,
                auth,
                llm,
                planner,
                resourceImporter,
            });
        } catch (error) {
            sendJson(response, 500, {
                ok: false,
                error: sanitizeErrorCode(error),
            }, { request, allowedOrigins });
        }
    });
}

export async function handleRequest(request, response, {
    store,
    allowedOrigins = [],
    auth,
    llm,
    planner = null,
    resourceImporter,
}) {
    if (request.method === 'OPTIONS') {
        if (!isOriginAllowed(request, allowedOrigins)) {
            sendJson(response, 403, {
                ok: false,
                error: 'ADMIN_ORIGIN_NOT_ALLOWED',
            }, { request, allowedOrigins });
            return;
        }
        sendOptions(response, request, allowedOrigins);
        return;
    }

    const url = new URL(request.url || '/', 'http://localhost');
    const method = request.method || 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/v1/health') {
        sendJson(response, 200, {
            ok: true,
            service: 'script-import-assistant',
            protocolVersion: 'galgame.script-import-assistant.health.v1',
            adminAuth: publicAuthStatus(auth),
            llm: publicLlmStatus(llm),
        }, { request, allowedOrigins });
        return;
    }

    if (pathname.startsWith('/v1/admin/')) {
        const originCheck = requireAllowedOrigin(request, allowedOrigins);
        if (!originCheck.ok) {
            sendJson(response, originCheck.status, {
                ok: false,
                error: originCheck.error,
            }, { request, allowedOrigins });
            return;
        }
        const authCheck = authorizeAdminRequest(request, auth);
        if (!authCheck.ok) {
            sendJson(response, authCheck.status, {
                ok: false,
                error: authCheck.error,
            }, {
                request,
                allowedOrigins,
                extraHeaders: authCheck.status === 401
                    ? { 'WWW-Authenticate': 'Bearer realm="galgame-script-import-assistant"' }
                    : {},
            });
            return;
        }
    }

    if (method === 'POST' && pathname === '/v1/admin/script-import/drafts') {
        const body = await readJsonBody(request);
        const draft = await createDraftFromRequest({
            body,
            store,
            llm,
            planner,
        });
        sendJson(response, draft.status, draft.body, { request, allowedOrigins });
        return;
    }

    const redeployMatch = /^\/v1\/admin\/script-import\/drafts\/([^/]+)\/redeploy$/.exec(pathname);
    if (method === 'POST' && redeployMatch) {
        const body = await readJsonBody(request);
        const result = await redeployDraft({
            draftId: decodeURIComponent(redeployMatch[1]),
            body,
            store,
            llm,
            planner,
        });
        sendJson(response, result.status, result.body, { request, allowedOrigins });
        return;
    }

    const confirmMatch = /^\/v1\/admin\/script-import\/drafts\/([^/]+)\/confirm$/.exec(pathname);
    if (method === 'POST' && confirmMatch) {
        const result = await confirmDraftHandoff({
            draftId: decodeURIComponent(confirmMatch[1]),
            store,
            resourceImporter,
        });
        sendJson(response, result.status, result.body, { request, allowedOrigins });
        return;
    }

    sendJson(response, 404, {
        ok: false,
        error: 'NOT_FOUND',
    }, { request, allowedOrigins });
}

export class MemoryDraftStore {
    constructor() {
        this.drafts = new Map();
    }

    async count() {
        return this.drafts.size;
    }

    async save(record) {
        this.drafts.set(record.draft.draftId, record);
        return record.draft;
    }

    async get(draftId) {
        return this.drafts.get(sanitizeReference(draftId, 160)) || null;
    }
}

async function createDraftFromRequest({
    body,
    store,
    llm,
    planner,
}) {
    const validation = validateDraftRequest(body);
    if (!validation.valid) {
        return {
            status: 400,
            body: {
                ok: false,
                error: 'SCRIPT_IMPORT_REQUEST_INVALID',
                details: validation.errors,
            },
        };
    }
    const files = normalizeFiles(body.files);
    const sourceDigest = hashSourceFiles(files);
    const planResult = await createSafeImportDraftPlan({
        files,
        options: body.options || {},
        sourceDigest,
        revision: 1,
        draftId: '',
        llm,
        planner,
    });
    const draft = finalizeDraft(planResult.plan, {
        sourceDigest,
        revision: 1,
        draftId: planResult.plan.draftId || `draft_${sourceDigest.slice(0, 16)}`,
        usesLlm: planResult.usesLlmAccepted,
    });
    await store.save({
        draft,
        files,
        options: body.options || {},
        sourceDigest,
    });
    return {
        status: 200,
        body: {
            ok: true,
            draft,
        },
    };
}

async function redeployDraft({
    draftId,
    body,
    store,
    llm,
    planner,
}) {
    const record = await store.get(draftId);
    if (!record) {
        return {
            status: 404,
            body: {
                ok: false,
                error: 'SCRIPT_IMPORT_DRAFT_NOT_FOUND',
            },
        };
    }
    const revision = Number(record.draft.revision || 1) + 1;
    const planResult = await createSafeImportDraftPlan({
        files: record.files,
        options: {
            ...record.options,
            ...(body?.options && typeof body.options === 'object' ? body.options : {}),
            redeployReason: sanitizeText(body?.reason || body?.redeployReason || '', 240),
        },
        sourceDigest: record.sourceDigest,
        revision,
        draftId: record.draft.draftId,
        llm,
        planner,
    });
    const draft = finalizeDraft(planResult.plan, {
        sourceDigest: record.sourceDigest,
        revision,
        draftId: record.draft.draftId,
        usesLlm: planResult.usesLlmAccepted,
    });
    await store.save({
        draft,
        files: record.files,
        options: record.options,
        sourceDigest: record.sourceDigest,
    });
    return {
        status: 200,
        body: {
            ok: true,
            draft,
        },
    };
}

async function confirmDraftHandoff({
    draftId,
    store,
    resourceImporter,
}) {
    const record = await store.get(draftId);
    if (!record) {
        return {
            status: 404,
            body: {
                ok: false,
                error: 'SCRIPT_IMPORT_DRAFT_NOT_FOUND',
            },
        };
    }
    if (!resourceImporter || typeof resourceImporter.confirmDraft !== 'function') {
        return {
            status: 503,
            body: {
                ok: false,
                protocolVersion: 'galgame.script-import-confirm-response.v1',
                status: 'unavailable',
                error: 'SCRIPT_IMPORT_ORIGINAL_IMPORTER_UNCONFIGURED',
                safeMessage: '原版故事材料导入服务还没有准备好。',
                draft: publicDraftSummary(record.draft),
            },
        };
    }

    try {
        const imported = await resourceImporter.confirmDraft(record);
        const nextDraft = finalizeDraft({
            ...record.draft,
            status: 'confirmed-ready-for-publish',
            importPlan: {
                ...record.draft.importPlan,
                writePolicy: 'imported-aa3',
            },
        }, {
            sourceDigest: record.sourceDigest,
            revision: record.draft.revision || 1,
            draftId: record.draft.draftId,
            usesLlm: Boolean(record.draft.summary?.usesLlm),
            allowImportedWritePolicy: true,
        });
        await store.save({
            ...record,
            draft: nextDraft,
            confirmedAt: new Date().toISOString(),
            importResult: imported.importResult,
            manifest: imported.manifest,
        });
        return {
            status: 200,
            body: {
                ok: true,
                protocolVersion: imported.protocolVersion || 'galgame.script-import-confirm-response.v1',
                status: imported.status || 'ready-for-publish',
                safeMessage: '已写入原版故事材料，并生成可上架入口草稿。',
                draft: publicDraftSummary(nextDraft),
                manifest: imported.manifest,
                validation: imported.validation,
                importResult: imported.importResult,
            },
        };
    } catch (error) {
        if (error instanceof ScriptImportResourceConflictError) {
            return {
                status: 409,
                body: {
                    ok: false,
                    protocolVersion: 'galgame.script-import-confirm-response.v1',
                    status: 'conflict',
                    error: error.code,
                    safeMessage: '发现同名故事材料已存在且来源不同，已停止写入，避免覆盖已有内容。',
                    conflict: error.details,
                    draft: publicDraftSummary(record.draft),
                },
            };
        }
        if (error instanceof ScriptImportUnavailableError) {
            return {
                status: 502,
                body: {
                    ok: false,
                    protocolVersion: 'galgame.script-import-confirm-response.v1',
                    status: 'unavailable',
                    error: error.code,
                    safeMessage: '原版故事材料暂时无法写入，请确认 SillyTavern 正在运行后重试。',
                    details: error.details,
                    draft: publicDraftSummary(record.draft),
                },
            };
        }
        throw error;
    }
}

export function createDeterministicImportDraft({
    files,
    options = {},
    sourceDigest,
    revision = 1,
    draftId = '',
    llm,
}) {
    const combined = files.map((file) => file.text).join('\n\n');
    const title = sanitizeTitle(
        options.title
        || extractMarkdownTitle(combined)
        || stripExtension(files[0]?.name || '')
        || '未命名故事',
    );
    const slug = createSlug(`${title}-${sourceDigest.slice(0, 8)}`);
    const characters = extractCharacterNames(combined);
    const worldBookCount = estimateWorldBookCount(combined);
    const warnings = [
        ...(llm.configured ? [] : ['未配置 LLM，当前只生成保守导入草稿。']),
        ...(characters.length ? [] : ['没有识别到明确角色名单，请确认草稿。']),
    ];
    const summary = {
        title,
        recommendedTemplate: recommendTemplate(combined, options.preferredTemplate),
        mainCharacters: characters,
        worldBookCount,
        openingReady: combined.trim().length > 0,
        usesLlm: false,
        importOnly: true,
        playerCallable: false,
    };

    return {
        protocolVersion: 'galgame.script-import-draft.v1',
        draftId: draftId || `draft_${sourceDigest.slice(0, 16)}`,
        revision,
        status: 'ready-for-confirmation',
        summary,
        importPlan: {
            characterName: `Galgame_AIImport_${slug}_Director`,
            characterAvatar: `galgame_aiimport_${slug}_director.png`,
            worldBookName: `Galgame_AIImport_${slug}_World`,
            chatSeedId: `galgame-aiimport-${slug}-seed`,
            writePolicy: 'deferred-aa3',
        },
        sourceDigest,
        sourceStats: {
            fileCount: files.length,
            totalCharacters: combined.length,
        },
        presentationRecommendation: createDeterministicPresentationRecommendationCandidate({
            text: combined,
            summary,
            llmConfigured: Boolean(llm.configured),
        }),
        safeWarnings: warnings,
    };
}

async function createSafeImportDraftPlan({
    files,
    options = {},
    sourceDigest,
    revision = 1,
    draftId = '',
    llm,
    planner,
}) {
    try {
        const providerResult = typeof planner === 'function'
            ? {
                plan: await planner({
                    files,
                    options,
                    sourceDigest,
                    revision,
                    draftId,
                    llm,
                }),
                usesLlmAccepted: false,
            }
            : await createDefaultImportDraftPlan({
                files,
                options,
                sourceDigest,
                revision,
                draftId,
                llm,
            });
        const plan = providerResult.plan;
        const validation = validatePlannerDraft(plan);
        if (!validation.valid) {
            throw Object.assign(new Error('SCRIPT_IMPORT_PLANNER_OUTPUT_REJECTED'), {
                code: 'SCRIPT_IMPORT_PLANNER_OUTPUT_REJECTED',
                safeDetails: validation.errors,
            });
        }
        const presentationValidation = validateDraftPresentationCandidate(plan.presentationRecommendation, {
            sourceDigest,
            draftId: plan.draftId || draftId || `draft_${sourceDigest.slice(0, 16)}`,
            revision,
            usesLlm: Boolean(providerResult.usesLlmAccepted),
            summary: plan.summary,
        });
        if (!presentationValidation.valid) {
            throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED'), {
                code: 'SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED',
                safeDetails: presentationValidation.errors,
            });
        }
        return {
            plan,
            usesLlmAccepted: Boolean(providerResult.usesLlmAccepted),
            fallback: false,
        };
    } catch (error) {
        const fallback = createDeterministicImportDraft({
            files,
            options: {
                ...options,
                preferredTemplate: options.preferredTemplate || 'auto',
            },
            sourceDigest,
            revision,
            draftId,
            llm: { configured: Boolean(llm?.configured) },
        });
        const fallbackPresentationWarnings = uniqueArray([
            ...normalizeStableCodeArray(fallback.presentationRecommendation?.safeWarnings, [], 8),
            'warning-deterministic-fallback-used',
            'warning-provider-output-rejected',
            'warning-admin-review-required',
        ]).slice(0, 8);
        return {
            plan: {
                ...fallback,
                presentationRecommendation: {
                    ...fallback.presentationRecommendation,
                    safeWarnings: fallbackPresentationWarnings,
                },
                safeWarnings: uniqueArray([
                    ...normalizeWarnings(fallback.safeWarnings),
                    formatPlannerFallbackWarning(error),
                ]),
            },
            usesLlmAccepted: false,
            fallback: true,
            errorCode: sanitizeErrorCode(error),
        };
    }
}

async function createDefaultImportDraftPlan({
    files,
    options = {},
    sourceDigest,
    revision = 1,
    draftId = '',
    llm,
}) {
    if (!llm?.configured) {
        return {
            plan: createDeterministicImportDraft({
                files,
                options,
                sourceDigest,
                revision,
                draftId,
                llm: { configured: false },
            }),
            usesLlmAccepted: false,
        };
    }
    const llmPlan = await callLlmPlanner({
        files,
        options,
        sourceDigest,
        revision,
        draftId,
        llm,
    });
    const plan = convertLlmPlanToDraft(llmPlan, {
        files,
        sourceDigest,
        revision,
        draftId,
    });
    return {
        plan,
        usesLlmAccepted: true,
    };
}

async function callLlmPlanner({
    files,
    options = {},
    sourceDigest,
    revision = 1,
    draftId = '',
    llm,
}) {
    const input = buildLlmPlannerInput({
        files,
        options,
        sourceDigest,
        revision,
        draftId,
        maxInputChars: llm.maxInputChars,
    });
    const requestBody = {
        model: llm.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content: [
                    'Return only JSON for galgame.script-import-llm-plan.v1.',
                    'Only summarize administrator import metadata and naming references.',
                    'Do not output dialogue, choices, nodes, endings, relationships, runtime story, prompts, context, or resource bodies.',
                    'Use exactly this JSON shape and no other keys anywhere:',
                    '{"protocolVersion":"galgame.script-import-llm-plan.v1","summary":{"title":"short title","recommendedTemplate":"visual-novel|rpg|chat","mainCharacters":["name"],"worldBookCount":1,"openingReady":true},"importPlan":{"characterName":"Galgame_AIImport_Safe_Name_Director","characterAvatar":"galgame_aiimport_safe_name_director.png","worldBookName":"Galgame_AIImport_Safe_Name_World","chatSeedId":"galgame-aiimport-safe-name-seed"},"presentationRecommendation":{"detectedGenre":"visual-novel|rpg-adventure|romance-social|mystery-investigation|management-sim|sandbox-roleplay|unknown","confidence":0.7,"recommendedProfile":{"template":"visual-novel","preferredModules":["actions","notes"],"disabledModules":[],"extractionPolicy":{"confidenceThreshold":0.75,"maxRecentMessages":4,"allowAdminPatterns":false,"allowBuiltinPatterns":true,"lowConfidenceBehavior":"plain-dialogue"},"visualPriority":{"primaryPanel":"actions","secondaryPanels":["notes"],"collapseBelowWidth":640}},"evidence":{"matchedSignals":["signal-vn-dialogue-format"]},"safeWarnings":["warning-admin-review-required"],"noClaim":["no-runtime-llm-assistant","no-hidden-resource-reading","no-prompt-context-copy"]}}',
                    'Do not use sourceFiles, projectTitle, characters, scenes, structure, notes, description, content, prompt, context, story, dialogue, choices, nodes, endings, relationship, inventory, variables, or state.',
                ].join(' '),
            },
            {
                role: 'user',
                content: JSON.stringify(input),
            },
        ],
    };
    const endpoint = createChatCompletionsUrl(llm.baseUrl);
    let lastError = null;
    const attempts = llm.retryCount + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), llm.timeoutMs);
        try {
            const response = await llm.fetchImpl(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${llm.apiKey}`,
                    'Idempotency-Key': createLlmIdempotencyKey({ sourceDigest, revision, draftId }),
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal,
            });
            if (!response || !response.ok) {
                throw new Error(`SCRIPT_IMPORT_LLM_HTTP_STATUS_${response?.status || 0}`);
            }
            const data = await readProviderJson(response, controller.signal);
            const plan = parseProviderPlannerContent(data);
            const validation = validateLlmPlannerPlan(plan);
            if (!validation.valid) {
                throw Object.assign(new Error('SCRIPT_IMPORT_LLM_PLAN_REJECTED'), {
                    code: 'SCRIPT_IMPORT_LLM_PLAN_REJECTED',
                    safeDetails: validation.errors,
                });
            }
            return plan;
        } catch (error) {
            lastError = normalizeLlmProviderError(error);
            if (!isRetriableLlmError(lastError) || attempt >= attempts - 1) {
                throw lastError;
            }
            await llm.sleep(llm.retryDelayMs * (attempt + 1));
        } finally {
            clearTimeout(timeout);
        }
    }
    throw lastError || new Error('SCRIPT_IMPORT_LLM_FAILED');
}

function buildLlmPlannerInput({
    files,
    options = {},
    sourceDigest,
    revision,
    draftId,
    maxInputChars,
}) {
    const totalCharacters = files.reduce((sum, file) => sum + file.text.length, 0);
    if (totalCharacters > maxInputChars) {
        throw new Error('SCRIPT_IMPORT_LLM_INPUT_TOO_LARGE');
    }
    return {
        protocolVersion: 'galgame.script-import-llm-input.v1',
        sourceDigest,
        revision,
        draftId,
        locale: sanitizeReference(options.locale || 'zh-CN', 32),
        preferredTemplate: sanitizeReference(options.preferredTemplate || 'auto', 80),
        files: files.map((file) => ({
            name: file.name,
            type: file.type,
            text: file.text,
        })),
    };
}

function convertLlmPlanToDraft(plan, {
    files,
    sourceDigest,
    revision,
    draftId,
}) {
    const combined = files.map((file) => file.text).join('\n\n');
    return {
        protocolVersion: 'galgame.script-import-draft.v1',
        draftId: draftId || `draft_${sourceDigest.slice(0, 16)}`,
        revision,
        status: 'ready-for-confirmation',
        summary: {
            ...(plan.summary || {}),
            usesLlm: false,
            importOnly: true,
            playerCallable: false,
        },
        importPlan: {
            ...(plan.importPlan || {}),
            writePolicy: 'deferred-aa3',
        },
        presentationRecommendation: plan.presentationRecommendation,
        sourceDigest,
        sourceStats: {
            fileCount: files.length,
            totalCharacters: combined.length,
        },
        safeWarnings: [],
    };
}

function validateLlmPlannerPlan(plan) {
    const errors = [];
    if (!isPlainObject(plan)) {
        return {
            valid: false,
            errors: ['LLM plan must be an object'],
        };
    }
    collectLlmPlanSchemaViolations(plan, '', errors);
    if (plan.protocolVersion !== 'galgame.script-import-llm-plan.v1') {
        errors.push('LLM plan protocolVersion is unsupported');
    }
    if (!isPlainObject(plan.summary)) {
        errors.push('LLM plan summary must be an object');
    }
    if (!isPlainObject(plan.importPlan)) {
        errors.push('LLM plan importPlan must be an object');
    }
    if (plan.safeWarnings !== undefined) {
        errors.push('LLM plan safeWarnings is not accepted; service generates administrator warnings');
    }
    if (Array.isArray(plan.summary?.mainCharacters) && plan.summary.mainCharacters.some((item) => typeof item === 'object' && item !== null)) {
        errors.push('LLM plan summary.mainCharacters must contain text only');
    }
    return {
        valid: errors.length === 0,
        errors: uniqueArray(errors).slice(0, 20),
    };
}

function collectLlmPlanSchemaViolations(value, pathName, errors) {
    if (errors.length >= 20) {
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            if (item && typeof item === 'object') {
                collectLlmPlanSchemaViolations(item, `${pathName}[]`, errors);
            }
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    const allowedKeys = llmPlanAllowedKeysForPath(pathName);
    for (const [key, item] of Object.entries(value)) {
        const childPath = pathName ? `${pathName}.${key}` : key;
        if (!allowedKeys.has(key)) {
            errors.push(looksForbiddenPlannerKey(key)
                ? `forbidden LLM planner field: ${childPath}`
                : `unknown LLM planner field: ${childPath}`);
            continue;
        }
        collectLlmPlanSchemaViolations(item, childPath, errors);
    }
}

function llmPlanAllowedKeysForPath(pathName) {
    if (!pathName) {
        return new Set(['protocolVersion', 'summary', 'importPlan', 'presentationRecommendation']);
    }
    if (pathName === 'summary') {
        return new Set(['title', 'recommendedTemplate', 'mainCharacters', 'worldBookCount', 'openingReady']);
    }
    if (pathName === 'importPlan') {
        return new Set(['characterName', 'characterAvatar', 'worldBookName', 'chatSeedId']);
    }
    if (pathName === 'presentationRecommendation') {
        return new Set(['detectedGenre', 'confidence', 'recommendedProfile', 'evidence', 'safeWarnings', 'noClaim']);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile') {
        return new Set(['template', 'preferredModules', 'disabledModules', 'extractionPolicy', 'visualPriority']);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile.extractionPolicy') {
        return new Set(['confidenceThreshold', 'maxRecentMessages', 'allowAdminPatterns', 'allowBuiltinPatterns', 'lowConfidenceBehavior']);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile.visualPriority') {
        return new Set(['primaryPanel', 'secondaryPanels', 'collapseBelowWidth']);
    }
    if (pathName === 'presentationRecommendation.evidence') {
        return new Set(['matchedSignals']);
    }
    return new Set();
}

async function readProviderJson(response, signal) {
    try {
        return await withAbortSignal(response.json(), signal);
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw error;
        }
        throw new Error('SCRIPT_IMPORT_LLM_INVALID_JSON');
    }
}

function withAbortSignal(promise, signal) {
    if (!signal) {
        return promise;
    }
    if (signal.aborted) {
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(promise).then(
            (value) => {
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            },
            (error) => {
                signal.removeEventListener('abort', onAbort);
                reject(error);
            },
        );
    });
}

function parseProviderPlannerContent(data) {
    const content = extractProviderMessageContent(data?.choices?.[0]?.message?.content);
    if (typeof content !== 'string') {
        throw new Error('SCRIPT_IMPORT_LLM_RESPONSE_EMPTY');
    }
    let parsed;
    try {
        parsed = JSON.parse(stripJsonFence(content));
    } catch {
        throw new Error('SCRIPT_IMPORT_LLM_INVALID_JSON');
    }
    return normalizeProviderPlannerPayload(parsed);
}

function extractProviderMessageContent(content) {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map((part) => {
                if (typeof part === 'string') {
                    return part;
                }
                if (part && typeof part === 'object' && typeof part.text === 'string') {
                    return part.text;
                }
                return '';
            })
            .join('')
            .trim();
    }
    return content;
}

function stripJsonFence(content) {
    const trimmed = String(content || '').trim();
    const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    return match ? match[1].trim() : trimmed;
}

function normalizeProviderPlannerPayload(payload) {
    if (!isPlainObject(payload)) {
        return payload;
    }
    if (payload.protocolVersion === 'galgame.script-import-llm-plan.v1') {
        return payload;
    }
    if (payload.protocolVersion === 'galgame.script-import-draft.v1') {
        return coerceDraftPayloadToLlmPlan(payload);
    }
    const keys = Object.keys(payload);
    if (keys.length === 1 && isPlainObject(payload.plan)) {
        return normalizeProviderPlannerPayload(payload.plan);
    }
    if (keys.length === 1 && isPlainObject(payload.draft)) {
        return normalizeProviderPlannerPayload(payload.draft);
    }
    return payload;
}

function coerceDraftPayloadToLlmPlan(draft) {
    const allowedDraftKeys = new Set([
        'protocolVersion',
        'draftId',
        'revision',
        'status',
        'summary',
        'importPlan',
        'presentationRecommendation',
        'sourceDigest',
        'sourceStats',
    ]);
    const unexpectedKeys = Object.keys(draft).filter((key) => !allowedDraftKeys.has(key));
    if (unexpectedKeys.length) {
        const firstKey = unexpectedKeys[0];
        throw new Error(looksForbiddenPlannerKey(firstKey)
            ? `SCRIPT_IMPORT_LLM_PLAN_REJECTED_FORBIDDEN_${firstKey}`
            : `SCRIPT_IMPORT_LLM_PLAN_REJECTED_UNKNOWN_${firstKey}`);
    }
    assertDraftWrapperObjectKeys(draft.summary, new Set([
        'title',
        'recommendedTemplate',
        'mainCharacters',
        'worldBookCount',
        'openingReady',
        'usesLlm',
        'importOnly',
        'playerCallable',
    ]), 'summary');
    assertDraftWrapperObjectKeys(draft.importPlan, new Set([
        'characterName',
        'characterAvatar',
        'worldBookName',
        'chatSeedId',
        'writePolicy',
    ]), 'importPlan');
    return {
        protocolVersion: 'galgame.script-import-llm-plan.v1',
        summary: pickObjectKeys(draft.summary, [
            'title',
            'recommendedTemplate',
            'mainCharacters',
            'worldBookCount',
            'openingReady',
        ]),
        importPlan: pickObjectKeys(draft.importPlan, [
            'characterName',
        'characterAvatar',
        'worldBookName',
        'chatSeedId',
    ]),
        presentationRecommendation: draft.presentationRecommendation,
    };
}

function assertDraftWrapperObjectKeys(value, allowedKeys, pathName) {
    if (value === undefined) {
        return;
    }
    if (!isPlainObject(value)) {
        throw new Error(`SCRIPT_IMPORT_LLM_PLAN_REJECTED_INVALID_${pathName}`);
    }
    for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
            throw new Error(looksForbiddenPlannerKey(key)
                ? `SCRIPT_IMPORT_LLM_PLAN_REJECTED_FORBIDDEN_${pathName}_${key}`
                : `SCRIPT_IMPORT_LLM_PLAN_REJECTED_UNKNOWN_${pathName}_${key}`);
        }
    }
}

function pickObjectKeys(value, keys) {
    if (!isPlainObject(value)) {
        return value;
    }
    const result = {};
    for (const key of keys) {
        if (Object.hasOwn(value, key)) {
            result[key] = value[key];
        }
    }
    return result;
}

function normalizeLlmProviderError(error) {
    const message = String(error?.message || error || 'SCRIPT_IMPORT_LLM_FAILED');
    if (error?.name === 'AbortError') {
        return new Error('SCRIPT_IMPORT_LLM_TIMEOUT');
    }
    if (/SCRIPT_IMPORT_LLM_/i.test(message)) {
        return new Error(sanitizeErrorCode(message));
    }
    return new Error('SCRIPT_IMPORT_LLM_FETCH_FAILED');
}

function formatPlannerFallbackWarning(error) {
    const code = sanitizeErrorCode(error);
    if (/SCRIPT_IMPORT_LLM_TIMEOUT/.test(code)) {
        return 'AI 整理等待太久，已改用基础整理。你可以稍后点“重新整理”。';
    }
    if (/SCRIPT_IMPORT_LLM_INPUT_TOO_LARGE/.test(code)) {
        return '剧本内容较长，AI 整理暂未处理，已改用基础整理。';
    }
    if (/SCRIPT_IMPORT_(?:PLANNER_OUTPUT_REJECTED|PRESENTATION_RECOMMENDATION_(?:REJECTED|MISSING)|PRESENTATION_PROFILE_REJECTED|LLM_(?:PLAN_REJECTED|INVALID_JSON|RESPONSE_EMPTY))/.test(code)) {
        return 'AI 整理结果未通过安全校验，已改用基础整理。';
    }
    const status = Number(/SCRIPT_IMPORT_LLM_HTTP_STATUS_(\d+)/.exec(code)?.[1] || 0);
    if (status === 401 || status === 403) {
        return 'AI 整理服务配置暂不可用，已改用基础整理。';
    }
    if (status === 429) {
        return 'AI 整理服务繁忙，已改用基础整理。你可以稍后点“重新整理”。';
    }
    if (status >= 500 || /SCRIPT_IMPORT_LLM_FETCH_FAILED/.test(code)) {
        return 'AI 整理服务暂时无法连接，已改用基础整理。';
    }
    return 'AI 整理没有完成，已改用基础整理。';
}

function isRetriableLlmError(error) {
    const message = String(error?.message || '');
    if (/SCRIPT_IMPORT_LLM_(?:TIMEOUT|FETCH_FAILED)/.test(message)) {
        return true;
    }
    const status = /SCRIPT_IMPORT_LLM_HTTP_STATUS_(\d+)/.exec(message)?.[1];
    if (!status) {
        return false;
    }
    const numericStatus = Number(status);
    return numericStatus === 429 || numericStatus >= 500;
}

function createChatCompletionsUrl(baseUrl) {
    const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
    return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function createLlmIdempotencyKey({
    sourceDigest,
    revision,
    draftId,
}) {
    const stable = [
        'galgame-script-import-llm-v1',
        sanitizeReference(sourceDigest, 80),
        sanitizeReference(draftId, 160) || 'new-draft',
        clampInteger(revision, 1, 999999),
    ].join(':');
    return createHash('sha256').update(stable).digest('hex');
}

function finalizeDraft(plan, {
    sourceDigest,
    revision,
    draftId,
    usesLlm = false,
    allowImportedWritePolicy = false,
}) {
    const validation = validatePlannerDraft(plan, { allowImportedWritePolicy });
    if (!validation.valid) {
        throw Object.assign(new Error('SCRIPT_IMPORT_PLANNER_OUTPUT_REJECTED'), {
            code: 'SCRIPT_IMPORT_PLANNER_OUTPUT_REJECTED',
            safeDetails: validation.errors,
        });
    }
    const normalizedDraftId = sanitizeReference(draftId, 160);
    const normalizedRevision = clampInteger(revision, 1, 999999);
    const summary = normalizeSummary(plan.summary, { usesLlm });
    const presentationRecommendation = createDraftPresentationRecommendation(plan.presentationRecommendation, {
        sourceDigest,
        draftId: normalizedDraftId,
        revision: normalizedRevision,
        usesLlm: Boolean(usesLlm),
        summary,
    });
    return {
        protocolVersion: 'galgame.script-import-draft.v1',
        draftId: normalizedDraftId,
        revision: normalizedRevision,
        status: sanitizeReference(plan.status || 'ready-for-confirmation', 80),
        summary,
        importPlan: normalizeImportPlan(plan.importPlan, sourceDigest, { allowImportedWritePolicy }),
        sourceDigest,
        sourceStats: normalizeSourceStats(plan.sourceStats),
        presentationRecommendation,
        safeWarnings: normalizeWarnings(plan.safeWarnings),
    };
}

function validatePlannerDraft(plan, {
    allowImportedWritePolicy = false,
} = {}) {
    const errors = [];
    if (!isPlainObject(plan)) {
        return {
            valid: false,
            errors: ['planner output must be an object'],
        };
    }

    collectPlannerSchemaViolations(plan, '', errors);

    if (plan.protocolVersion && plan.protocolVersion !== 'galgame.script-import-draft.v1') {
        errors.push('protocolVersion is unsupported');
    }
    if (plan.summary !== undefined && !isPlainObject(plan.summary)) {
        errors.push('summary must be an object');
    }
    if (plan.importPlan !== undefined && !isPlainObject(plan.importPlan)) {
        errors.push('importPlan must be an object');
    }
    if (plan.sourceStats !== undefined && !isPlainObject(plan.sourceStats)) {
        errors.push('sourceStats must be an object');
    }
    if (plan.safeWarnings !== undefined && !Array.isArray(plan.safeWarnings)) {
        errors.push('safeWarnings must be an array');
    }
    if (Array.isArray(plan.safeWarnings) && plan.safeWarnings.some((item) => typeof item === 'object' && item !== null)) {
        errors.push('safeWarnings must contain text only');
    }
    if (Array.isArray(plan.summary?.mainCharacters) && plan.summary.mainCharacters.some((item) => typeof item === 'object' && item !== null)) {
        errors.push('summary.mainCharacters must contain text only');
    }
    if (plan.importPlan?.writePolicy === 'imported-aa3' && !allowImportedWritePolicy) {
        errors.push('planner output must not declare imported-aa3');
    }
    if (plan.status === 'confirmed-ready-for-publish' && !allowImportedWritePolicy) {
        errors.push('planner output must not declare confirmed-ready-for-publish');
    }
    if (Object.hasOwn(plan, 'publishedAt')) {
        errors.push('planner output must not declare publishedAt');
    }

    return {
        valid: errors.length === 0,
        errors: uniqueArray(errors).slice(0, 20),
    };
}

function collectPlannerSchemaViolations(value, pathName, errors) {
    if (errors.length >= 20) {
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            if (item && typeof item === 'object') {
                collectPlannerSchemaViolations(item, `${pathName}[]`, errors);
            }
        }
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }

    const allowedKeys = plannerAllowedKeysForPath(pathName);
    for (const [key, item] of Object.entries(value)) {
        const childPath = pathName ? `${pathName}.${key}` : key;
        if (!allowedKeys.has(key)) {
            errors.push(looksForbiddenPlannerKey(key)
                ? `forbidden planner field: ${childPath}`
                : `unknown planner field: ${childPath}`);
            continue;
        }
        if (looksForbiddenPlannerKey(key) && !plannerAllowedDangerousNameExceptions(pathName).has(key)) {
            errors.push(`forbidden planner field: ${childPath}`);
            continue;
        }
        collectPlannerSchemaViolations(item, childPath, errors);
    }
}

function plannerAllowedKeysForPath(pathName) {
    if (!pathName) {
        return new Set([
            'protocolVersion',
            'draftId',
            'revision',
            'status',
            'summary',
            'importPlan',
            'presentationRecommendation',
            'sourceDigest',
            'sourceStats',
            'safeWarnings',
        ]);
    }
    if (pathName === 'summary') {
        return new Set([
            'title',
            'recommendedTemplate',
            'mainCharacters',
            'worldBookCount',
            'openingReady',
            'usesLlm',
            'importOnly',
            'playerCallable',
        ]);
    }
    if (pathName === 'importPlan') {
        return new Set([
            'characterName',
            'characterAvatar',
            'worldBookName',
            'chatSeedId',
            'writePolicy',
        ]);
    }
    if (pathName === 'sourceStats') {
        return new Set([
            'fileCount',
            'totalCharacters',
        ]);
    }
    if (pathName === 'presentationRecommendation') {
        return new Set([
            'schemaVersion',
            'recommendationId',
            'sourceDigest',
            'draftId',
            'revision',
            'detectedGenre',
            'confidence',
            'recommendedProfile',
            'evidence',
            'safeWarnings',
            'noClaim',
            'usesLlm',
        ]);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile') {
        return new Set([
            'template',
            'preferredModules',
            'disabledModules',
            'extractionPolicy',
            'visualPriority',
        ]);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile.extractionPolicy') {
        return new Set([
            'confidenceThreshold',
            'maxRecentMessages',
            'allowAdminPatterns',
            'allowBuiltinPatterns',
            'lowConfidenceBehavior',
        ]);
    }
    if (pathName === 'presentationRecommendation.recommendedProfile.visualPriority') {
        return new Set([
            'primaryPanel',
            'secondaryPanels',
            'collapseBelowWidth',
        ]);
    }
    if (pathName === 'presentationRecommendation.evidence') {
        return new Set([
            'evidenceDigest',
            'sourceKind',
            'matchedSignals',
            'exampleTemplateCodes',
        ]);
    }
    return new Set();
}

function plannerAllowedDangerousNameExceptions(pathName) {
    if (pathName === 'summary') {
        return new Set(['worldBookCount']);
    }
    if (pathName === 'importPlan') {
        return new Set(['worldBookName']);
    }
    return new Set();
}

function looksForbiddenPlannerKey(key) {
    const normalized = String(key || '')
        .replace(/[^a-z0-9]+/gi, '')
        .toLowerCase();
    return [
        'dialogue',
        'dialog',
        'line',
        'lines',
        'choice',
        'choices',
        'node',
        'nodes',
        'ending',
        'endings',
        'sceneresult',
        'relationship',
        'relationships',
        'affection',
        'variables',
        'inventory',
        'story',
        'runtimestory',
        'localstorystate',
        'manifest',
        'prompt',
        'context',
        'resourcebody',
        'charactercard',
        'worldbookentries',
        'firstmes',
        'mesexample',
        'description',
        'personality',
        'scenario',
        'content',
        'entries',
        'publishedat',
    ].some((token) => normalized.includes(token));
}

function validateDraftRequest(body) {
    const errors = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return {
            valid: false,
            errors: ['request must be an object'],
        };
    }
    if (body.protocolVersion && body.protocolVersion !== 'galgame.script-import-assistant.request.v1') {
        errors.push('protocolVersion is unsupported');
    }
    if (!Array.isArray(body.files) || !body.files.length) {
        errors.push('files must include at least one text file');
    } else if (body.files.length > MAX_SCRIPT_FILES) {
        errors.push(`files must not exceed ${MAX_SCRIPT_FILES}`);
    } else {
        const names = new Set();
        let totalCharacters = 0;
        for (const [index, file] of body.files.entries()) {
            if (!file || typeof file !== 'object' || Array.isArray(file)) {
                errors.push(`files[${index}] must be an object`);
                continue;
            }
            const name = sanitizeReference(file.name, 240);
            const type = sanitizeReference(file.type || '', 120).toLowerCase().split(';')[0].trim();
            const extension = path.extname(name).toLowerCase();
            if (!name) {
                errors.push(`files[${index}].name is required`);
            } else {
                const duplicateKey = name.toLowerCase();
                if (names.has(duplicateKey)) {
                    errors.push(`files[${index}].name is duplicated`);
                }
                names.add(duplicateKey);
                if (extension && !SUPPORTED_SCRIPT_EXTENSIONS.has(extension)) {
                    errors.push(`files[${index}].extension is unsupported`);
                }
            }
            if (type && !SUPPORTED_SCRIPT_TYPES.has(type)) {
                errors.push(`files[${index}].type is unsupported`);
            }
            if (typeof file.text !== 'string' || !file.text.trim()) {
                errors.push(`files[${index}].text is required`);
            } else {
                if (file.text.length > MAX_SCRIPT_FILE_CHARS) {
                    errors.push(`files[${index}].text is too large`);
                }
                totalCharacters += file.text.length;
            }
        }
        if (totalCharacters > MAX_SCRIPT_TOTAL_CHARS) {
            errors.push(`files total text is too large`);
        }
    }
    return {
        valid: errors.length === 0,
        errors,
    };
}

function normalizeFiles(files) {
    return files.map((file) => ({
        name: sanitizeReference(file.name, 240),
        type: sanitizeReference(file.type || 'text/plain', 120),
        text: sanitizeUploadText(file.text),
    }));
}

function normalizeSummary(summary = {}, {
    usesLlm = false,
} = {}) {
    return {
        title: sanitizeTitle(summary.title || '未命名故事'),
        recommendedTemplate: sanitizeReference(summary.recommendedTemplate || 'visual-novel', 80),
        mainCharacters: uniqueArray((Array.isArray(summary.mainCharacters) ? summary.mainCharacters : [])
            .map((name) => sanitizeText(name, 80))
            .filter(Boolean))
            .slice(0, 12),
        worldBookCount: clampInteger(summary.worldBookCount, 0, 999),
        openingReady: Boolean(summary.openingReady),
        usesLlm: Boolean(usesLlm),
        importOnly: true,
        playerCallable: false,
    };
}

function normalizeImportPlan(importPlan = {}, sourceDigest, {
    allowImportedWritePolicy = false,
} = {}) {
    const slug = createSlug(sourceDigest.slice(0, 12));
    const writePolicy = sanitizeReference(importPlan.writePolicy || 'deferred-aa3', 80);
    return {
        characterName: sanitizeResourceName(importPlan.characterName || `Galgame_AIImport_${slug}_Director`),
        characterAvatar: sanitizeFileName(importPlan.characterAvatar || `galgame_aiimport_${slug}_director.png`),
        worldBookName: sanitizeResourceName(importPlan.worldBookName || `Galgame_AIImport_${slug}_World`),
        chatSeedId: sanitizeChatSeedId(importPlan.chatSeedId || `galgame-aiimport-${slug}-seed`),
        writePolicy: allowImportedWritePolicy && writePolicy === 'imported-aa3' ? 'imported-aa3' : 'deferred-aa3',
    };
}

function normalizeSourceStats(stats = {}) {
    return {
        fileCount: clampInteger(stats.fileCount, 0, 999),
        totalCharacters: clampInteger(stats.totalCharacters, 0, 20_000_000),
    };
}

function validateDraftPresentationCandidate(candidate, context) {
    try {
        createDraftPresentationRecommendation(candidate, context);
        return { valid: true, errors: [] };
    } catch (error) {
        return {
            valid: false,
            errors: uniqueArray(error?.safeDetails || [sanitizeErrorCode(error)]).slice(0, 20),
        };
    }
}

function createDraftPresentationRecommendation(candidate, {
    sourceDigest,
    draftId,
    revision,
    usesLlm,
    summary,
}) {
    if (!isPlainObject(candidate) && usesLlm) {
        throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_MISSING'), {
            code: 'SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_MISSING',
            safeDetails: ['LLM plan must include a presentationRecommendation candidate'],
        });
    }
    const baseCandidate = isPlainObject(candidate)
        ? candidate
        : createDeterministicPresentationRecommendationCandidate({
            text: '',
            summary,
            llmConfigured: usesLlm,
        });
    const normalized = usesLlm && !isFullPresentationRecommendation(baseCandidate)
        ? normalizeStrictProviderPresentationRecommendationCandidate(baseCandidate)
        : normalizePresentationRecommendationCandidate(baseCandidate, summary);
    const serviceFields = createPresentationRecommendationServiceFields({
        sourceDigest,
        draftId,
        revision,
        usesLlm,
        normalized,
    });
    const recommendation = {
        schemaVersion: PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION,
        recommendationId: serviceFields.recommendationId,
        sourceDigest: serviceFields.sourceDigest,
        draftId: serviceFields.draftId,
        revision: serviceFields.revision,
        detectedGenre: normalized.detectedGenre,
        confidence: normalized.confidence,
        recommendedProfile: normalized.recommendedProfile,
        evidence: {
            evidenceDigest: serviceFields.evidenceDigest,
            sourceKind: 'uploaded-admin-material',
            matchedSignals: normalized.evidence.matchedSignals,
            exampleTemplateCodes: normalized.evidence.exampleTemplateCodes,
        },
        safeWarnings: normalized.safeWarnings,
        noClaim: normalized.noClaim,
        usesLlm: serviceFields.usesLlm,
    };
    const validation = validatePresentationRecommendation(recommendation, {
        recommendationId: serviceFields.recommendationId,
        sourceDigest: serviceFields.sourceDigest,
        draftId: serviceFields.draftId,
        revision: serviceFields.revision,
        currentRevision: serviceFields.revision,
        minimumRevision: serviceFields.revision,
        evidenceDigest: serviceFields.evidenceDigest,
        usesLlm: serviceFields.usesLlm,
    });
    if (!validation.valid) {
        throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED'), {
            code: 'SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED',
            safeDetails: validation.errors,
        });
    }
    const conversion = convertPresentationRecommendationToProfile(recommendation, {
        recommendationId: serviceFields.recommendationId,
        sourceDigest: serviceFields.sourceDigest,
        draftId: serviceFields.draftId,
        revision: serviceFields.revision,
        currentRevision: serviceFields.revision,
        minimumRevision: serviceFields.revision,
        evidenceDigest: serviceFields.evidenceDigest,
        usesLlm: serviceFields.usesLlm,
    });
    if (!conversion.ok) {
        throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_PROFILE_REJECTED'), {
            code: 'SCRIPT_IMPORT_PRESENTATION_PROFILE_REJECTED',
            safeDetails: conversion.errors,
        });
    }
    return recommendation;
}

function createPresentationRecommendationServiceFields({
    sourceDigest,
    draftId,
    revision,
    usesLlm,
    normalized,
}) {
    const canonicalSourceDigest = toRecommendationSourceDigest(sourceDigest);
    const safeDraftId = sanitizeReference(draftId, 160);
    const safeRevision = clampInteger(revision, 1, 999999);
    const recommendationSeed = [
        'galgame.presentation-recommendation.v1',
        canonicalSourceDigest,
        safeDraftId,
        String(safeRevision),
    ].join('\0');
    const evidenceSeed = [
        'galgame.presentation-recommendation.evidence.v1',
        canonicalSourceDigest,
        safeDraftId,
        String(safeRevision),
        normalized.detectedGenre,
        normalized.recommendedProfile.template,
        ...normalized.evidence.matchedSignals,
        ...normalized.evidence.exampleTemplateCodes,
    ].join('\0');
    return {
        recommendationId: `rec_${hashText(recommendationSeed).slice(0, 24)}`,
        sourceDigest: canonicalSourceDigest,
        draftId: safeDraftId,
        revision: safeRevision,
        evidenceDigest: `sha256:${hashText(evidenceSeed)}`,
        usesLlm: Boolean(usesLlm),
    };
}

function isFullPresentationRecommendation(candidate) {
    return isPlainObject(candidate)
        && candidate.schemaVersion === PRESENTATION_RECOMMENDATION_PROTOCOL_VERSION
        && Object.hasOwn(candidate, 'recommendationId')
        && Object.hasOwn(candidate, 'sourceDigest')
        && Object.hasOwn(candidate, 'draftId')
        && Object.hasOwn(candidate, 'revision')
        && Object.hasOwn(candidate, 'usesLlm');
}

function normalizeStrictProviderPresentationRecommendationCandidate(candidate) {
    const errors = [];
    if (!isPlainObject(candidate)) {
        throwPresentationCandidateRejected(['presentationRecommendation must be an object']);
    }
    rejectExactKeys(candidate, new Set([
        'detectedGenre',
        'confidence',
        'recommendedProfile',
        'evidence',
        'safeWarnings',
        'noClaim',
    ]), 'presentationRecommendation', errors);

    const detectedGenre = candidate.detectedGenre;
    if (detectedGenre !== 'unknown' && !PRESENTATION_TEMPLATE_SET.has(detectedGenre)) {
        errors.push('presentationRecommendation.detectedGenre must be a known template or unknown');
    }
    if (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
        errors.push('presentationRecommendation.confidence must be a finite number from 0 to 1');
    }

    const profile = candidate.recommendedProfile;
    if (!isPlainObject(profile)) {
        errors.push('presentationRecommendation.recommendedProfile must be an object');
    } else {
        rejectExactKeys(profile, new Set([
            'template',
            'preferredModules',
            'disabledModules',
            'extractionPolicy',
            'visualPriority',
        ]), 'presentationRecommendation.recommendedProfile', errors);
        if (!PRESENTATION_TEMPLATE_SET.has(profile.template)) {
            errors.push('presentationRecommendation.recommendedProfile.template must be a known template');
        }
        validateStableEnumArray(profile.preferredModules, PRESENTATION_MODULE_SET, 'presentationRecommendation.recommendedProfile.preferredModules', errors, 1, 12);
        validateStableEnumArray(profile.disabledModules, PRESENTATION_MODULE_SET, 'presentationRecommendation.recommendedProfile.disabledModules', errors, 0, 12, true);
        if (Array.isArray(profile.preferredModules) && Array.isArray(profile.disabledModules)) {
            const disabled = new Set(profile.disabledModules);
            for (const moduleId of profile.preferredModules) {
                if (disabled.has(moduleId)) {
                    errors.push(`presentationRecommendation.recommendedProfile.${moduleId} cannot be both preferred and disabled`);
                }
            }
        }
        validateStrictRecommendationExtractionPolicy(profile.extractionPolicy, errors);
        validateStrictRecommendationVisualPriority(profile.visualPriority, profile, errors);
    }

    const evidence = candidate.evidence;
    if (!isPlainObject(evidence)) {
        errors.push('presentationRecommendation.evidence must be an object');
    } else {
        rejectExactKeys(evidence, new Set(['matchedSignals']), 'presentationRecommendation.evidence', errors);
        validateStableEnumArray(evidence.matchedSignals, PRESENTATION_SIGNAL_SET, 'presentationRecommendation.evidence.matchedSignals', errors, 0, 12);
    }
    validateStableEnumArray(candidate.safeWarnings, PRESENTATION_WARNING_SET, 'presentationRecommendation.safeWarnings', errors, 0, 8);
    validateStableEnumArray(candidate.noClaim, PRESENTATION_NO_CLAIM_SET, 'presentationRecommendation.noClaim', errors, 0, 12);
    if (errors.length) {
        throwPresentationCandidateRejected(errors);
    }
    return {
        detectedGenre,
        confidence: candidate.confidence,
        recommendedProfile: {
            template: profile.template,
            preferredModules: [...profile.preferredModules],
            disabledModules: [...(profile.disabledModules || [])],
            extractionPolicy: {
                confidenceThreshold: profile.extractionPolicy?.confidenceThreshold ?? 0.75,
                maxRecentMessages: profile.extractionPolicy?.maxRecentMessages ?? 4,
                allowAdminPatterns: false,
                allowBuiltinPatterns: profile.extractionPolicy?.allowBuiltinPatterns !== false,
                lowConfidenceBehavior: profile.extractionPolicy?.lowConfidenceBehavior || 'plain-dialogue',
            },
            visualPriority: {
                primaryPanel: profile.visualPriority?.primaryPanel || profile.preferredModules[0],
                secondaryPanels: [...(profile.visualPriority?.secondaryPanels || [])],
                collapseBelowWidth: profile.visualPriority?.collapseBelowWidth ?? 640,
            },
        },
        evidence: {
            matchedSignals: [...evidence.matchedSignals],
            exampleTemplateCodes: chooseExampleTemplateCodes(evidence.matchedSignals),
        },
        safeWarnings: [...candidate.safeWarnings],
        noClaim: [...candidate.noClaim],
    };
}

function validateStrictRecommendationExtractionPolicy(policy, errors) {
    if (policy === undefined) {
        return;
    }
    if (!isPlainObject(policy)) {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy must be an object');
        return;
    }
    rejectExactKeys(policy, new Set([
        'confidenceThreshold',
        'maxRecentMessages',
        'allowAdminPatterns',
        'allowBuiltinPatterns',
        'lowConfidenceBehavior',
    ]), 'presentationRecommendation.recommendedProfile.extractionPolicy', errors);
    if (policy.confidenceThreshold !== undefined && (typeof policy.confidenceThreshold !== 'number' || !Number.isFinite(policy.confidenceThreshold) || policy.confidenceThreshold < 0 || policy.confidenceThreshold > 1)) {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy.confidenceThreshold must be a finite number from 0 to 1');
    }
    if (policy.maxRecentMessages !== undefined && (!Number.isInteger(policy.maxRecentMessages) || policy.maxRecentMessages < 1 || policy.maxRecentMessages > 20)) {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy.maxRecentMessages must be an integer from 1 to 20');
    }
    if (policy.allowAdminPatterns !== undefined && policy.allowAdminPatterns !== false) {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy.allowAdminPatterns must be false');
    }
    if (policy.allowBuiltinPatterns !== undefined && typeof policy.allowBuiltinPatterns !== 'boolean') {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy.allowBuiltinPatterns must be boolean');
    }
    if (policy.lowConfidenceBehavior !== undefined && !['plain-dialogue', 'history-only'].includes(policy.lowConfidenceBehavior)) {
        errors.push('presentationRecommendation.recommendedProfile.extractionPolicy.lowConfidenceBehavior is unsupported');
    }
}

function validateStrictRecommendationVisualPriority(visualPriority, profile, errors) {
    if (visualPriority === undefined) {
        return;
    }
    if (!isPlainObject(visualPriority)) {
        errors.push('presentationRecommendation.recommendedProfile.visualPriority must be an object');
        return;
    }
    rejectExactKeys(visualPriority, new Set(['primaryPanel', 'secondaryPanels', 'collapseBelowWidth']), 'presentationRecommendation.recommendedProfile.visualPriority', errors);
    const preferred = new Set(Array.isArray(profile.preferredModules) ? profile.preferredModules : []);
    const disabled = new Set(Array.isArray(profile.disabledModules) ? profile.disabledModules : []);
    if (visualPriority.primaryPanel !== undefined) {
        if (!PRESENTATION_MODULE_SET.has(visualPriority.primaryPanel)) {
            errors.push('presentationRecommendation.recommendedProfile.visualPriority.primaryPanel must be a known module');
        } else if (!preferred.has(visualPriority.primaryPanel) || disabled.has(visualPriority.primaryPanel)) {
            errors.push('presentationRecommendation.recommendedProfile.visualPriority.primaryPanel must be enabled');
        }
    }
    validateStableEnumArray(visualPriority.secondaryPanels, PRESENTATION_MODULE_SET, 'presentationRecommendation.recommendedProfile.visualPriority.secondaryPanels', errors, 0, 8, true);
    if (Array.isArray(visualPriority.secondaryPanels)) {
        for (const moduleId of visualPriority.secondaryPanels) {
            if (!preferred.has(moduleId) || disabled.has(moduleId)) {
                errors.push(`presentationRecommendation.recommendedProfile.visualPriority.secondaryPanels contains disabled or non-preferred module: ${moduleId}`);
            }
        }
    }
    if (visualPriority.collapseBelowWidth !== undefined && (!Number.isInteger(visualPriority.collapseBelowWidth) || visualPriority.collapseBelowWidth < 320 || visualPriority.collapseBelowWidth > 1440)) {
        errors.push('presentationRecommendation.recommendedProfile.visualPriority.collapseBelowWidth must be an integer from 320 to 1440');
    }
}

function validateStableEnumArray(value, allowedSet, label, errors, minLength, maxLength, optional = false) {
    if (value === undefined && optional) {
        return;
    }
    if (!Array.isArray(value)) {
        errors.push(`${label} must be an array`);
        return;
    }
    if (value.length < minLength || value.length > maxLength) {
        errors.push(`${label} must contain ${minLength} to ${maxLength} items`);
    }
    const seen = new Set();
    for (const item of value) {
        if (!allowedSet.has(item)) {
            errors.push(`${label} contains unsupported value: ${String(item)}`);
            continue;
        }
        if (seen.has(item)) {
            errors.push(`${label} contains duplicate value: ${item}`);
        }
        seen.add(item);
    }
}

function rejectExactKeys(value, allowedKeys, label, errors) {
    if (!isPlainObject(value)) {
        return;
    }
    for (const key of Object.getOwnPropertyNames(value)) {
        if (!allowedKeys.has(key)) {
            errors.push(`${label}.${key} is not allowed`);
        }
    }
}

function throwPresentationCandidateRejected(errors) {
    throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED'), {
        code: 'SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED',
        safeDetails: uniqueArray(errors).slice(0, 20),
    });
}

function normalizePresentationRecommendationCandidate(candidate, summary = {}) {
    if (!isPlainObject(candidate)) {
        throw new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_INVALID');
    }
    const template = normalizePresentationTemplate(candidate.recommendedProfile?.template || candidate.detectedGenre || summary.recommendedTemplate);
    const defaultModules = BUILTIN_TEMPLATE_MODULES[template] || BUILTIN_TEMPLATE_MODULES['visual-novel'];
    const preferredModules = normalizeStableCodeArray(candidate.recommendedProfile?.preferredModules, defaultModules, 12);
    const disabledModules = normalizeStableCodeArray(candidate.recommendedProfile?.disabledModules, [], 12)
        .filter((moduleId) => !preferredModules.includes(moduleId));
    const primaryPanel = preferredModules.includes(candidate.recommendedProfile?.visualPriority?.primaryPanel)
        ? candidate.recommendedProfile.visualPriority.primaryPanel
        : preferredModules[0] || 'actions';
    const secondaryPanels = normalizeStableCodeArray(candidate.recommendedProfile?.visualPriority?.secondaryPanels, [], 8)
        .filter((moduleId) => preferredModules.includes(moduleId) && !disabledModules.includes(moduleId) && moduleId !== primaryPanel);
    const extractionPolicy = isPlainObject(candidate.recommendedProfile?.extractionPolicy)
        ? candidate.recommendedProfile.extractionPolicy
        : {};
    if (Object.hasOwn(extractionPolicy, 'allowAdminPatterns') && extractionPolicy.allowAdminPatterns !== false) {
        throw Object.assign(new Error('SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED'), {
            code: 'SCRIPT_IMPORT_PRESENTATION_RECOMMENDATION_REJECTED',
            safeDetails: ['presentationRecommendation.recommendedProfile.extractionPolicy.allowAdminPatterns must be false'],
        });
    }
    return {
        detectedGenre: normalizePresentationTemplate(candidate.detectedGenre || template, { allowUnknown: true }),
        confidence: clampNumber(candidate.confidence, template === 'visual-novel' ? 0.55 : 0.7, 0, 1),
        recommendedProfile: {
            template,
            preferredModules,
            disabledModules,
            extractionPolicy: {
                confidenceThreshold: clampNumber(extractionPolicy.confidenceThreshold, 0.75, 0, 1),
                maxRecentMessages: clampInteger(extractionPolicy.maxRecentMessages ?? 4, 1, 20),
                allowAdminPatterns: false,
                allowBuiltinPatterns: extractionPolicy.allowBuiltinPatterns !== false,
                lowConfidenceBehavior: ['plain-dialogue', 'history-only'].includes(extractionPolicy.lowConfidenceBehavior)
                    ? extractionPolicy.lowConfidenceBehavior
                    : 'plain-dialogue',
            },
            visualPriority: {
                primaryPanel,
                secondaryPanels,
                collapseBelowWidth: clampInteger(candidate.recommendedProfile?.visualPriority?.collapseBelowWidth ?? 640, 320, 1440),
            },
        },
        evidence: {
            matchedSignals: normalizeStableCodeArray(candidate.evidence?.matchedSignals, ['signal-unknown-structure'], 12),
            exampleTemplateCodes: normalizeStableCodeArray(candidate.evidence?.exampleTemplateCodes, [], 6),
        },
        safeWarnings: normalizeStableCodeArray(candidate.safeWarnings, [], 8),
        noClaim: normalizeStableCodeArray(candidate.noClaim, PRESENTATION_NO_CLAIM_BASE, 12),
    };
}

function createDeterministicPresentationRecommendationCandidate({
    text,
    summary = {},
    llmConfigured = false,
}) {
    const signals = detectPresentationSignals(text);
    const template = normalizePresentationTemplate(summary.recommendedTemplate || chooseTemplateFromSignals(signals));
    const modules = BUILTIN_TEMPLATE_MODULES[template] || BUILTIN_TEMPLATE_MODULES['visual-novel'];
    const warnings = [
        ...(llmConfigured ? [] : ['warning-deterministic-fallback-used']),
        ...(signals.includes('signal-unknown-structure') ? ['warning-low-confidence'] : []),
        'warning-admin-review-required',
        'warning-patterns-disabled',
    ];
    return {
        detectedGenre: signals.includes('signal-unknown-structure') ? 'unknown' : template,
        confidence: signals.includes('signal-unknown-structure') ? 0.45 : 0.68,
        recommendedProfile: {
            template,
            preferredModules: modules,
            disabledModules: [],
            extractionPolicy: {
                confidenceThreshold: 0.75,
                maxRecentMessages: 4,
                allowAdminPatterns: false,
                allowBuiltinPatterns: true,
                lowConfidenceBehavior: 'plain-dialogue',
            },
            visualPriority: {
                primaryPanel: modules[0] || 'actions',
                secondaryPanels: modules.slice(1, 4),
                collapseBelowWidth: 640,
            },
        },
        evidence: {
            matchedSignals: signals,
            exampleTemplateCodes: chooseExampleTemplateCodes(signals),
        },
        safeWarnings: uniqueArray(warnings),
        noClaim: PRESENTATION_NO_CLAIM_BASE,
    };
}

function detectPresentationSignals(text) {
    const source = String(text || '');
    const signals = [];
    if (/(?:^|\n)\s*(?:行动|选择|Options?|Actions?)\s*[:：]/i.test(source)) {
        signals.push('signal-action-options-format');
    }
    if (/(?:HP|生命值|体力)\s*[:：]?\s*\d+\s*\/\s*\d+/i.test(source)) {
        signals.push('signal-hp-ac-format');
    }
    if (/(?:^|\n)\s*(?:背包|物品|道具|Inventory|Items)\s*[:：]/i.test(source)) {
        signals.push('signal-inventory-section');
    }
    if (/(?:^|\n)\s*(?:装备|武器|Equipment|Weapons?)\s*[:：]/i.test(source)) {
        signals.push('signal-equipment-section');
    }
    if (/(?:^|\n)\s*(?:攻击|Attacks?)\s*[:：]/i.test(source)) {
        signals.push('signal-attack-section');
    }
    if (/(?:^|\n)\s*(?:技能|Skills?)\s*[:：]/i.test(source)) {
        signals.push('signal-skill-list');
    }
    if (/(?:任务|目标|Quest|Objective)/i.test(source)) {
        signals.push('signal-quest-objective');
    }
    if (/\b(?:d20|1d\d+|2d\d+|骰)\b/i.test(source)) {
        signals.push('signal-dice-roll');
    }
    if (/(?:好感|亲密度|affection|romance)/i.test(source)) {
        signals.push('signal-affection-score');
    }
    if (/(?:关系|relationship|bond)/i.test(source)) {
        signals.push('signal-relationship-stage');
    }
    if (/(?:礼物|gift)/i.test(source)) {
        signals.push('signal-gift-event');
    }
    if (/(?:日程|日期|calendar|schedule)/i.test(source)) {
        signals.push('signal-calendar-event');
    }
    if (/(?:线索|clue|evidence)/i.test(source)) {
        signals.push('signal-clue-section');
    }
    if (/(?:嫌疑人|suspect)/i.test(source)) {
        signals.push('signal-suspect-section');
    }
    if (/(?:地点|location|place)/i.test(source)) {
        signals.push('signal-location-section');
    }
    if (/(?:资源|resource|gold|金币|粮食|木材)/i.test(source)) {
        signals.push('signal-resource-counter');
    }
    if (/(?:阵营|faction|声望)/i.test(source)) {
        signals.push('signal-faction-status');
    }
    if (/(?:笔记|notes?|自由|sandbox)/i.test(source)) {
        signals.push('signal-sandbox-notes');
    }
    return uniqueArray(signals).slice(0, 12).length
        ? uniqueArray(signals).slice(0, 12)
        : ['signal-unknown-structure'];
}

function chooseTemplateFromSignals(signals) {
    const set = new Set(signals);
    if (set.has('signal-hp-ac-format') || set.has('signal-equipment-section') || set.has('signal-attack-section') || set.has('signal-dice-roll')) {
        return 'rpg-adventure';
    }
    if (set.has('signal-affection-score') || set.has('signal-relationship-stage') || set.has('signal-gift-event')) {
        return 'romance-social';
    }
    if (set.has('signal-clue-section') || set.has('signal-suspect-section')) {
        return 'mystery-investigation';
    }
    if (set.has('signal-resource-counter') || set.has('signal-faction-status')) {
        return 'management-sim';
    }
    if (set.has('signal-sandbox-notes') || set.has('signal-location-section')) {
        return 'sandbox-roleplay';
    }
    return 'visual-novel';
}

function chooseExampleTemplateCodes(signals) {
    const set = new Set(signals);
    const examples = [];
    if (set.has('signal-hp-ac-format')) {
        examples.push('example-hp-current-max');
    }
    if (set.has('signal-inventory-section')) {
        examples.push('example-inventory-visible-list');
    }
    if (set.has('signal-equipment-section') || set.has('signal-attack-section')) {
        examples.push('example-equipment-with-visible-traits');
    }
    if (set.has('signal-affection-score')) {
        examples.push('example-affection-score');
    }
    if (set.has('signal-clue-section')) {
        examples.push('example-clue-list');
    }
    if (set.has('signal-resource-counter')) {
        examples.push('example-resource-counter');
    }
    if (set.has('signal-action-options-format')) {
        examples.push('example-action-options');
    }
    return uniqueArray(examples).slice(0, 6);
}

function normalizePresentationTemplate(value, { allowUnknown = false } = {}) {
    const normalized = sanitizeReference(value, 80);
    if (allowUnknown && normalized === 'unknown') {
        return 'unknown';
    }
    if (normalized === 'rpg') {
        return 'rpg-adventure';
    }
    if (normalized === 'romance') {
        return 'romance-social';
    }
    if (normalized === 'mystery') {
        return 'mystery-investigation';
    }
    if (normalized === 'management') {
        return 'management-sim';
    }
    if (normalized === 'sandbox') {
        return 'sandbox-roleplay';
    }
    return BUILTIN_TEMPLATE_MODULES[normalized] ? normalized : 'visual-novel';
}

function normalizeStableCodeArray(value, fallback, maxLength) {
    const source = Array.isArray(value) ? value : fallback;
    return uniqueArray(source
        .filter((item) => typeof item === 'string')
        .map((item) => sanitizeReference(item, 120))
        .filter(Boolean))
        .slice(0, maxLength);
}

function toRecommendationSourceDigest(sourceDigest) {
    const text = String(sourceDigest || '').trim();
    if (/^sha256:[a-f0-9]{64}$/i.test(text)) {
        return text.toLowerCase();
    }
    if (/^[a-f0-9]{64}$/i.test(text)) {
        return `sha256:${text.toLowerCase()}`;
    }
    return `sha256:${hashText(text)}`;
}

function normalizeWarnings(warnings) {
    return (Array.isArray(warnings) ? warnings : [])
        .map((item) => sanitizeText(item, 240))
        .filter(Boolean)
        .slice(0, 12);
}

function publicDraftSummary(draft) {
    return {
        draftId: draft.draftId,
        revision: draft.revision,
        status: draft.status,
        summary: draft.summary,
        importPlan: draft.importPlan,
        sourceDigest: draft.sourceDigest,
        presentationRecommendation: draft.presentationRecommendation,
    };
}

function hashSourceFiles(files) {
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file.name);
        hash.update('\0');
        hash.update(file.type);
        hash.update('\0');
        hash.update(file.text);
        hash.update('\0');
    }
    return hash.digest('hex');
}

function hashText(value) {
    return createHash('sha256').update(String(value || '')).digest('hex');
}

function extractMarkdownTitle(text) {
    const heading = /^#\s+(.+)$/m.exec(text);
    return heading?.[1] || '';
}

function extractCharacterNames(text) {
    const candidates = [];
    const labelMatch = /(?:^|\n)\s*(?:角色|人物|主要角色|Characters?|Cast)\s*[:：]\s*([^\n]+)/i.exec(text);
    if (labelMatch) {
        candidates.push(...labelMatch[1].split(/[、,，/|]/g));
    }
    for (const match of text.matchAll(/(?:^|\n)\s*[-*]\s*(?:角色|人物)?\s*([A-Z][A-Za-z]{1,30}|[\u4e00-\u9fa5]{2,8})\s*(?:[:：-]|$)/g)) {
        candidates.push(match[1]);
    }
    return uniqueArray(candidates
        .map((name) => sanitizeText(name.replace(/\(.+?\)|（.+?）/g, ''), 80))
        .filter((name) => name && !/^(Chapter|Scene|Arc|World|Story)$/i.test(name)))
        .slice(0, 8);
}

function estimateWorldBookCount(text) {
    const explicitSections = [...text.matchAll(/(?:^|\n)\s*#{1,4}\s*(?:世界|设定|背景|地点|组织|规则|World|Setting|Lore|Location)\b/gi)].length;
    if (explicitSections > 0) {
        return Math.min(explicitSections, 99);
    }
    return text.trim().length > 0 ? 1 : 0;
}

function recommendTemplate(text, preferredTemplate) {
    const preferred = sanitizeReference(preferredTemplate, 80);
    if (preferred && preferred !== 'auto') {
        return preferred;
    }
    if (/HP|MP|背包|装备|技能|dungeon|quest|inventory|stat/i.test(text)) {
        return 'rpg';
    }
    if (/好感|约会|恋爱|relationship|romance|affection/i.test(text)) {
        return 'romance';
    }
    if (/案件|线索|推理|mystery|clue|detective/i.test(text)) {
        return 'mystery';
    }
    return 'visual-novel';
}

function createAdminAuthConfig({
    adminToken = '',
    adminTokenExpiresAt = '',
    trustExternalAuth = false,
    trustedProxyToken = '',
    host = '127.0.0.1',
    now = () => Date.now(),
} = {}) {
    const token = String(adminToken || '').trim();
    const expiryText = String(adminTokenExpiresAt || '').trim();
    const expiresAtMs = expiryText ? Date.parse(expiryText) : 0;
    const proxyToken = String(trustedProxyToken || '').trim();
    const loopback = isLoopbackHost(host);
    let configurationError = '';
    if (expiryText && !Number.isFinite(expiresAtMs)) {
        configurationError = 'ADMIN_AUTH_EXPIRY_INVALID';
    }
    if (trustExternalAuth && !loopback && !proxyToken) {
        configurationError = 'EXTERNAL_AUTH_BOUNDARY_UNVERIFIED';
    }
    return {
        required: true,
        configured: !configurationError && (Boolean(token) || Boolean(trustExternalAuth)),
        mode: configurationError ? 'invalid' : token ? 'token' : trustExternalAuth ? 'external-auth-boundary' : 'unconfigured',
        token,
        trustedProxyToken: proxyToken,
        loopback,
        configurationError,
        expiresAtMs,
        now,
    };
}

function authorizeAdminRequest(request, auth) {
    if (auth.configurationError) {
        return {
            ok: false,
            status: 503,
            error: auth.configurationError,
        };
    }
    if (!auth.configured) {
        return {
            ok: false,
            status: 503,
            error: 'ADMIN_AUTH_UNCONFIGURED',
        };
    }
    if (Number.isFinite(auth.expiresAtMs) && auth.expiresAtMs > 0 && auth.expiresAtMs <= auth.now()) {
        return {
            ok: false,
            status: 401,
            error: 'ADMIN_AUTH_EXPIRED',
        };
    }
    if (auth.mode === 'external-auth-boundary') {
        if (auth.trustedProxyToken && !safeTokenEqual(getTrustedProxyTokenFromRequest(request), auth.trustedProxyToken)) {
            return {
                ok: false,
                status: 401,
                error: 'ADMIN_AUTH_REQUIRED',
            };
        }
        return { ok: true };
    }
    const provided = getAdminTokenFromRequest(request);
    if (!safeTokenEqual(provided, auth.token)) {
        return {
            ok: false,
            status: 401,
            error: 'ADMIN_AUTH_REQUIRED',
        };
    }
    return { ok: true };
}

function publicAuthStatus(auth) {
    return {
        required: true,
        configured: auth.configured,
        mode: auth.mode,
        expires: Boolean(auth.expiresAtMs),
        loopbackOnlyTrust: auth.mode === 'external-auth-boundary' && auth.loopback && !auth.trustedProxyToken,
        proxyProofRequired: auth.mode === 'external-auth-boundary' && Boolean(auth.trustedProxyToken),
        configurationError: auth.configurationError || '',
    };
}

function createLlmConfig({
    llmBaseUrl = '',
    llmModel = '',
    llmApiKey = '',
    llmApiKeyEnv = '',
    llmTimeoutMs = DEFAULT_LLM_TIMEOUT_MS,
    llmRetryCount = DEFAULT_LLM_RETRY_COUNT,
    llmMaxInputChars = DEFAULT_LLM_MAX_INPUT_CHARS,
    llmRetryDelayMs = DEFAULT_LLM_RETRY_DELAY_MS,
    llmFetch = globalThis.fetch,
    llmSleep = delay,
} = {}) {
    const keyFromEnv = llmApiKeyEnv ? process.env[llmApiKeyEnv] || '' : '';
    const apiKey = String(keyFromEnv || llmApiKey || '').trim();
    return {
        configured: Boolean(apiKey && llmBaseUrl && llmModel && typeof llmFetch === 'function'),
        baseUrl: String(llmBaseUrl || '').trim(),
        model: String(llmModel || '').trim(),
        apiKey,
        apiKeySource: apiKey ? (llmApiKeyEnv ? 'env-reference' : 'service-env') : 'none',
        timeoutMs: clampInteger(llmTimeoutMs, 1, 120_000),
        retryCount: clampInteger(llmRetryCount, 0, 3),
        maxInputChars: clampInteger(llmMaxInputChars, 1_000, MAX_SCRIPT_TOTAL_CHARS),
        retryDelayMs: clampInteger(llmRetryDelayMs, 0, 10_000),
        fetchImpl: typeof llmFetch === 'function' ? llmFetch : null,
        sleep: typeof llmSleep === 'function' ? llmSleep : delay,
    };
}

function publicLlmStatus(llm) {
    return {
        configured: llm.configured,
        provider: 'openai-compatible',
        baseUrlConfigured: Boolean(llm.baseUrl),
        modelConfigured: Boolean(llm.model),
        apiKeyConfigured: Boolean(llm.apiKey),
        apiKeySource: llm.apiKeySource,
    };
}

function getAdminTokenFromRequest(request) {
    const authorization = request.headers.authorization || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(String(authorization));
    if (bearer) {
        return bearer[1].trim();
    }
    const headerToken = request.headers['x-galgame-admin-token'];
    if (headerToken) {
        return String(Array.isArray(headerToken) ? headerToken[0] : headerToken).trim();
    }
    const cookies = parseCookies(request.headers.cookie || '');
    return cookies.galgame_script_admin_token || cookies.galgame_admin_token || '';
}

function getTrustedProxyTokenFromRequest(request) {
    const headerToken = request.headers['x-galgame-trusted-proxy-token'];
    if (headerToken) {
        return String(Array.isArray(headerToken) ? headerToken[0] : headerToken).trim();
    }
    return '';
}

function safeTokenEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length || !leftBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCookies(cookieHeader) {
    return String(cookieHeader || '')
        .split(';')
        .map((item) => item.trim())
        .filter(Boolean)
        .reduce((cookies, item) => {
            const separator = item.indexOf('=');
            if (separator < 0) {
                return cookies;
            }
            return {
                ...cookies,
                [decodeURIComponent(item.slice(0, separator).trim())]: decodeURIComponent(item.slice(separator + 1).trim()),
            };
        }, {});
}

function parseAllowedOrigins(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function requireAllowedOrigin(request, allowedOrigins) {
    if (!isOriginAllowed(request, allowedOrigins)) {
        return {
            ok: false,
            status: 403,
            error: 'ADMIN_ORIGIN_NOT_ALLOWED',
        };
    }
    return { ok: true };
}

function isOriginAllowed(request, allowedOrigins) {
    const origin = request.headers.origin || '';
    if (!origin) {
        return true;
    }
    if (!allowedOrigins.length || allowedOrigins.includes('*')) {
        return false;
    }
    return allowedOrigins.includes(String(origin));
}

async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw new Error('REQUEST_TOO_LARGE');
        }
        chunks.push(chunk);
    }
    if (!chunks.length) {
        return {};
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new Error('INVALID_JSON');
    }
}

function sendOptions(response, request, allowedOrigins) {
    applyCors(response, request, allowedOrigins);
    response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Galgame-Admin-Token',
        'Access-Control-Max-Age': '600',
    });
    response.end();
}

function sendJson(response, status, data, {
    request = null,
    allowedOrigins = [],
    extraHeaders = {},
} = {}) {
    if (request) {
        applyCors(response, request, allowedOrigins);
    }
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...extraHeaders,
    });
    response.end(JSON.stringify(data));
}

function applyCors(response, request, allowedOrigins) {
    const origin = request?.headers?.origin || '';
    if (!origin || !isOriginAllowed(request, allowedOrigins)) {
        return;
    }
    if (allowedOrigins.includes('*')) {
        return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Vary', 'Origin');
}

function sanitizeUploadText(value) {
    return String(value || '')
        .replace(/\u0000/g, '')
        .slice(0, 1_000_000);
}

function sanitizeText(value, maxLength = 4000) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function sanitizeTitle(value) {
    return sanitizeText(value, 120) || '未命名故事';
}

function sanitizeReference(value, maxLength = 240) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]+/g, '')
        .trim()
        .slice(0, maxLength);
}

function sanitizeResourceName(value) {
    return sanitizeReference(value, 180)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'Galgame_AIImport_Untitled';
}

function sanitizeFileName(value) {
    return sanitizeReference(value, 180)
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_')
        .replace(/^_+|_+$/g, '')
        || 'galgame_aiimport_director.png';
}

function sanitizeChatSeedId(value) {
    return sanitizeReference(value, 180)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        || 'galgame-aiimport-seed';
}

function stripExtension(value) {
    return sanitizeReference(value, 160).replace(/\.[^.]+$/, '');
}

function createSlug(value) {
    return sanitizeChatSeedId(value).replace(/-/g, '_').slice(0, 64) || 'untitled';
}

function clampInteger(value, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return min;
    }
    return Math.min(Math.max(Math.round(parsed), min), max);
}

function clampNumber(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, min), max);
}

function uniqueArray(values) {
    return [...new Set(values)];
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeErrorCode(error) {
    return String(error?.message || error || 'SCRIPT_IMPORT_ASSISTANT_ERROR')
        .replace(/[^A-Z0-9_:-]+/gi, '_')
        .replace(/(?:TOKEN|SECRET|KEY)[^_:-]*/gi, '[redacted]')
        .slice(0, 120);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const host = process.env.HOST || '127.0.0.1';
    const port = Number(process.env.PORT || process.env.GALGAME_SCRIPT_ASSISTANT_PORT || DEFAULT_PORT);
    if (
        !isLoopbackHost(host)
        && !process.env.GALGAME_SCRIPT_ASSISTANT_ADMIN_TOKEN
        && !process.env.GALGAME_SCRIPT_ASSISTANT_TRUSTED_PROXY_TOKEN
    ) {
        console.error(JSON.stringify({
            ok: false,
            service: 'script-import-assistant',
            error: 'ADMIN_AUTH_REQUIRED_FOR_NON_LOOPBACK',
        }));
        process.exit(1);
    }
    const server = createScriptImportAssistantService();
    server.listen(port, host, () => {
        console.log(JSON.stringify({
            ok: true,
            service: 'script-import-assistant',
            url: `http://${host}:${port}`,
        }));
    });
}

function isLoopbackHost(value) {
    const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost'
        || host === '127.0.0.1'
        || host === '::1'
        || host.startsWith('127.');
}
