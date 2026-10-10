import { hasOriginalTargetReadback } from './original-runtime-readback-guard.mjs';
import { execFile } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const scopeArgs = String(args.scope || 'frontend/player,frontend/admin,frontend/shared,public/game,public/game-admin,external-modules')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/code-architecture-audit.json');

const frozenPaths = [
    'src',
    'server.js',
    'plugins.js',
    'config.yaml',
    'public/index.html',
    'public/script.js',
    'public/style.css',
    'package.json',
    'package-lock.json',
];

const textFileExtensions = new Set([
    '.js',
    '.mjs',
    '.cjs',
    '.html',
    '.css',
    '.json',
    '.md',
    '.svg',
]);

const allowedSillyTavernEndpoints = new Set([
    '/csrf-token',
    '/api/ping',
    '/api/characters/all',
    '/api/worldinfo/list',
    '/api/settings/get',
    '/api/characters/chats',
    '/api/chats/get',
    '/api/chats/save',
]);

const allowedScriptImportOriginalStEndpoints = new Set([
    '/csrf-token',
    '/api/ping',
    '/api/characters/all',
    '/api/characters/create',
    '/api/characters/edit',
    '/api/characters/get',
    '/api/worldinfo/list',
    '/api/worldinfo/get',
    '/api/worldinfo/edit',
    '/api/characters/chats',
    '/api/chats/get',
    '/api/chats/save',
]);

const stateAudit = {
    stateWrites: [],
    statePersistence: [],
    callSites: [],
    bridgeSecurity: [],
};

const allowedPlayerStateFields = new Set([
    'active',
    'activeRelease',
    'arc',
    'arcId',
    'backgroundId',
    'browser',
    'chat',
    'chatId',
    'chatSeedId',
    'contentHash',
    'currentBaseUrl',
    'displayText',
    'empty',
    'error',
    'errorCode',
    'fileName',
    'generationBridge',
    'id',
    'inputPending',
    'isSeed',
    'lastMessageIndex',
    'manifest',
    'manifestPrefix',
    'manifestUrl',
    'defaultManifest',
    'mediaConfig',
    'mediaJobIds',
    'message',
    'messages',
    'minimumPlayerVersion',
    'mode',
    'ok',
    'pageIndex',
    'presentation',
    'playerSavePrefix',
    'protocolVersion',
    'publishedAt',
    'rawChat',
    'release',
    'releaseHistory',
    'releaseId',
    'resourceBindings',
    'scenario',
    'scenarioId',
    'scenarioVersion',
    'saveId',
    'savedAt',
    'sentAt',
    'speaker',
    'spriteIds',
    'status',
    'suggestedActions',
    'text',
    'title',
    'updatedAt',
    'version',
    'visualState',
    'writable',
]);

const allowedUiStateNames = new Set([
    'dialogueText',
    'gameScreen',
    'gameTitle',
    'generationPending',
    'inputPending',
    'loadButtonTitle',
    'playerInput',
    'playerInputForm',
    'recoveryActions',
    'releaseNote',
    'sendButton',
    'speakerName',
    'stageBackdrop',
    'stageHeroine',
    'stageStatus',
    'stageTitle',
    'startButton',
    'suggestedActions',
    'titleBackdrop',
    'titleHeroine',
    'titleScreen',
    'toast',
]);

const suspiciousStoryStatePattern = /\b(?:affection|ending|inventory|node|plot|quest|relationship|route|flag|好感|物品|结局|剧情节点|路线)\b/i;

const requiredPlayerSaveFields = [
    'protocolVersion',
    'saveId',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'lastMessageIndex',
    'pageIndex',
    'visualState',
    'savedAt',
];

const requiredPlayerSaveVisualFields = [
    'backgroundId',
    'spriteIds',
    'bgmId',
    'mediaJobIds',
];

const requiredForbiddenPlayerSaveFields = [
    'affection',
    'choice',
    'node',
    'ending',
    'relationship',
    'variables',
];

const riskRules = [
    {
        id: 'legacy-narrative-gateway',
        category: 'legacy-runtime',
        pattern: /\bnarrative-gateway\b/i,
        reason: 'Custom narrative gateway must not be active.',
    },
    {
        id: 'legacy-narrative-runtime',
        category: 'legacy-runtime',
        pattern: /\b(?:NarrativeRuntime|createNarrativeRuntime|narrativeRuntime)\b/,
        reason: 'Custom narrative runtime must not be active.',
    },
    {
        id: 'scene-result-loop',
        category: 'parallel-story-state',
        pattern: /\b(?:SceneResult|normalizeSceneResult|reduceSceneResult)\b/,
        reason: 'SceneResult-driven gameplay loop must not be active.',
    },
    {
        id: 'legacy-continue-session',
        category: 'legacy-runtime',
        pattern: /\bcontinueSession\b/,
        reason: 'continueSession was part of the old custom story loop.',
    },
    {
        id: 'authored-story-state',
        category: 'parallel-story-state',
        pattern: /\b(?:initialVariables|initialRelationships|initialInventory|fallbackChoices|nextNodeId|freeInputNextNodeId|proposedStateChanges)\b/,
        reason: 'Frontend story state, choices, node jumps, and state changes are not narrative authority.',
    },
    {
        id: 'scripted-fallback',
        category: 'local-scripted-fallback',
        pattern: /\b(?:scripted fallback|scriptedFallback|local story|fixed story|local fallback story)\b/i,
        reason: 'Runtime failure must not play local scripted story.',
    },
    {
        id: 'bottom-generate-endpoint',
        category: 'direct-bottom-generate',
        pattern: /\/api\/(?:backends\/[^'"`\s)]*generate|novelai\/generate)\b/i,
        reason: 'Custom player code must not call bottom model generation endpoints.',
    },
    {
        id: 'prompt-assembly',
        category: 'prompt-context-copy',
        pattern: /\b(?:composeNarrativeMessages|buildPrompt|assemblePrompt|promptAssembly|worldInfoBefore|worldInfoAfter)\b/i,
        reason: 'Custom code must not copy prompt/context assembly.',
    },
    {
        id: 'resource-body-copy',
        category: 'resource-body-copy',
        pattern: /\b(?:mes_example|personality|characterBook|character_book|lorebookEntries|worldInfoEntries)\b/,
        reason: 'Custom manifest/code must not copy character card or world book bodies.',
    },
    {
        id: 'original-frontend-runtime-global',
        category: 'original-runtime-global',
        pattern: /\bglobalThis\.SillyTavern\b|import\(['"]\/script\.js['"]\)|from\s+['"][^'"]*public\/script\.js['"]/,
        reason: 'Original frontend runtime globals are only allowed inside the approved external runtime bridge.',
    },
];

const findings = [];
const checks = [];

const startedAt = new Date().toISOString();
const files = await collectScopeFiles(scopeArgs);

for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    const rel = toRepoPath(filePath);
    scanRiskRules(rel, source);
    scanImports(rel, source);
    scanFetchAndEndpoints(rel, source);
    scanPlayerStateAndPersistence(rel, source);
    scanCallSites(rel, source);
}

await checkPlayerRouteIsolation();
await checkSourcePublicConsistency();
await checkFrozenBoundary();
await checkOriginalRuntimeBridgeSecurity();
await checkPresentationCacheSafety();
await checkPresentationGateReports();
await checkSafePresentationFallback();

const classificationSummary = summarize(findings, 'classification');
const categorySummary = summarize(findings, 'category');
const prohibited = findings.filter((finding) => finding.classification === 'prohibited-active');
const needsReview = findings.filter((finding) => finding.classification === 'needs-review');
const failedChecks = checks.filter((check) => !check.ok);

const report = {
    protocolVersion: 'galgame.static-architecture-audit.v1',
    ok: prohibited.length === 0 && needsReview.length === 0 && failedChecks.length === 0,
    generatedAt: startedAt,
    repoRoot,
    inputScopes: scopeArgs,
    frozenPaths,
    summary: {
        totalFiles: files.length,
        totalFindings: findings.length,
        findingsByClassification: classificationSummary,
        findingsByCategory: categorySummary,
        failedChecks: failedChecks.map((check) => check.name),
        prohibitedActiveCount: prohibited.length,
        needsReviewCount: needsReview.length,
    },
    checks,
    findings,
    stateAudit,
    nextActions: buildNextActions({ prohibited, needsReview, failedChecks }),
};

await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
    ok: report.ok,
    evidence: toRepoPath(evidencePath),
    totalFiles: files.length,
    totalFindings: findings.length,
    prohibitedActiveCount: prohibited.length,
    needsReviewCount: needsReview.length,
    failedChecks: failedChecks.map((check) => check.name),
}, null, 2));
process.exitCode = report.ok ? 0 : 1;

async function collectScopeFiles(scopes) {
    const result = [];
    for (const scope of scopes) {
        const abs = path.resolve(repoRoot, scope);
        if (!abs.startsWith(repoRoot)) {
            throw new Error(`Scope escapes repository root: ${scope}`);
        }
        await walk(abs, result);
    }
    return [...new Set(result)].sort();
}

async function walk(target, result) {
    let info;
    try {
        info = await stat(target);
    } catch {
        checks.push({
            name: `scope-exists:${toRepoPath(target)}`,
            ok: false,
            details: { reason: 'scope path does not exist' },
        });
        return;
    }
    if (info.isDirectory()) {
        const entries = await readdir(target, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.git') {
                continue;
            }
            await walk(path.join(target, entry.name), result);
        }
        return;
    }
    if (info.isFile() && textFileExtensions.has(path.extname(target).toLowerCase())) {
        result.push(target);
    }
}

function scanRiskRules(rel, source) {
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        for (const rule of riskRules) {
            if (!rule.pattern.test(line)) {
                continue;
            }
            const classification = classifyRiskHit({ rel, line, rule, lines, index, source });
            findings.push({
                ruleId: rule.id,
                category: rule.category,
                classification,
                file: rel,
                line: index + 1,
                excerpt: line.trim().slice(0, 240),
                reason: rule.reason,
            });
        }
    }
}

function scanPlayerStateAndPersistence(rel, source) {
    if (!isPlayerRuntimePath(rel) || !/\.(?:js|mjs)$/.test(rel)) {
        return;
    }

    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const lineNumber = index + 1;

        collectStateFieldReads(rel, line, lineNumber);
        collectStateWrites(rel, line, lineNumber);
        collectPersistenceWrite(rel, line, lineNumber, source);
    }
}

function collectStateFieldReads(rel, line, lineNumber) {
    const fieldPattern = /\b(?:state|save|session|snapshot|release|manifest|active|message|event)\.([A-Za-z_$][\w$]*)/g;
    for (const match of line.matchAll(fieldPattern)) {
        const field = match[1];
        const classification = classifyPlayerStateField({ rel, line, field, isPersistence: false });
        const entry = {
            kind: 'state-field-reference',
            classification,
            file: rel,
            line: lineNumber,
            field,
            excerpt: line.trim().slice(0, 240),
        };
        stateAudit.stateWrites.push(entry);
        if (classification === 'prohibited-active' || classification === 'needs-review') {
            findings.push({
                ruleId: 'player-state-field-reference',
                category: 'parallel-story-state',
                classification,
                file: rel,
                line: lineNumber,
                excerpt: entry.excerpt,
                reason: `Player/public game state references field "${field}" outside the allowed UI/release/chat/display list.`,
            });
        }
    }
}

function collectStateWrites(rel, line, lineNumber) {
    const assignmentPattern = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*=(?!=)/g;
    for (const match of line.matchAll(assignmentPattern)) {
        const target = match[1];
        if (!isStateLikeAssignment(target, line)) {
            continue;
        }
        const field = target.split('.').pop();
        const classification = classifyPlayerStateField({ rel, line, field, isPersistence: false });
        const entry = {
            kind: 'assignment',
            classification,
            file: rel,
            line: lineNumber,
            target,
            field,
            excerpt: line.trim().slice(0, 240),
        };
        stateAudit.stateWrites.push(entry);
        if (classification === 'prohibited-active' || classification === 'needs-review') {
            findings.push({
                ruleId: 'player-state-write',
                category: 'parallel-story-state',
                classification,
                file: rel,
                line: lineNumber,
                excerpt: entry.excerpt,
                reason: `Player/public game writes state-like field "${field}" outside the allowed UI/release/chat/display list.`,
            });
        }
    }
}

function collectPersistenceWrite(rel, line, lineNumber, source) {
    if (!/\b(?:backend\.set|localStorage\.setItem|store\.put|cachePublishedRelease|publishManifest|saveMediaConfig)\s*\(/.test(line)) {
        return;
    }
    const fields = extractPersistenceFields(line);
    const classifications = fields.map((field) => classifyPlayerStateField({
        rel,
        line,
        field,
        isPersistence: true,
    }));
    let classification = classifications.includes('prohibited-active')
        ? 'prohibited-active'
        : classifications.includes('needs-review')
            ? 'needs-review'
            : 'allowed-adapter';
    const guardEvidence = collectPersistenceGuardEvidence({ rel, line, source });
    if (guardEvidence?.kind === 'player-save-v1' && classification !== 'prohibited-active') {
        classification = guardEvidence.ok ? 'allowed-adapter' : 'needs-review';
    }
    const entry = {
        kind: 'persistence-write',
        classification,
        file: rel,
        line: lineNumber,
        fields,
        guardEvidence,
        excerpt: line.trim().slice(0, 240),
    };
    stateAudit.statePersistence.push(entry);
    if (classification === 'prohibited-active' || classification === 'needs-review') {
        findings.push({
            ruleId: 'player-state-persistence',
            category: 'parallel-story-state',
            classification,
            file: rel,
            line: lineNumber,
            excerpt: entry.excerpt,
            reason: 'Player/public game persistence writes unknown or story-authoritative state fields.',
        });
    }
}

function scanCallSites(rel, source) {
    if (!/\.(?:js|mjs)$/.test(rel)) {
        return;
    }
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/\b(?:fetch|requestJson|generateReply|ctx\.generate|generate)\s*\(/.test(line)) {
            continue;
        }
        if (/^\s*(?:async\s+)?(?:function\s+)?(?:generateReply|requestJson)\s*\(/.test(line)) {
            continue;
        }
        const callKind = classifyCallKind(line);
        const classification = classifyCallSite(rel, line, callKind, source);
        const entry = {
            callKind,
            classification,
            file: rel,
            line: index + 1,
            excerpt: line.trim().slice(0, 240),
        };
        stateAudit.callSites.push(entry);
        if (classification === 'prohibited-active' || classification === 'needs-review') {
            findings.push({
                ruleId: 'call-site-review',
                category: callKind.includes('generate') ? 'direct-bottom-generate' : 'sillytavern-endpoint',
                classification,
                file: rel,
                line: index + 1,
                excerpt: entry.excerpt,
                reason: 'Fetch/request/generate call site requires an allowed adapter or approved bridge classification.',
            });
        }
    }
}

function scanImports(rel, source) {
    const importPattern = /\b(?:import\s+(?:[^'"`]*?\s+from\s+)?|import\s*\()\s*['"`]([^'"`]+)['"`]/g;
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        const line = getLineNumber(source, match.index || 0);
        if (specifier.includes('/script.js') || specifier.includes('public/script.js')) {
            findings.push({
                ruleId: 'original-frontend-import',
                category: 'original-runtime-global',
                classification: isApprovedRuntimeBridge(rel) ? 'allowed-adapter' : 'prohibited-active',
                file: rel,
                line,
                excerpt: specifier,
                reason: 'Importing original frontend runtime is allowed only inside original-runtime-bridge.',
            });
        }
        const resolvedSpecifier = resolveImportSpecifier(rel, specifier);
        if (resolvedSpecifier === 'src' || resolvedSpecifier.startsWith('src/')) {
            findings.push({
                ruleId: 'backend-src-import',
                category: 'backend-freeze',
                classification: 'prohibited-active',
                file: rel,
                line,
                excerpt: specifier,
                reason: 'Custom code must not import SillyTavern backend src.',
            });
        }
    }
}

function scanFetchAndEndpoints(rel, source) {
    const endpointPattern = /['"`](\/(?:csrf-token|api\/[^'"`]+|v1\/[^'"`]+|health))['"`]/g;
    for (const match of source.matchAll(endpointPattern)) {
        const endpoint = match[1];
        const line = getLineNumber(source, match.index || 0);
        const category = endpoint.startsWith('/v1/') || endpoint === '/health'
            ? 'external-module-contract'
            : 'sillytavern-endpoint';
        let classification = classifyEndpoint(rel, endpoint, source);
        findings.push({
            ruleId: 'endpoint-reference',
            category,
            classification,
            file: rel,
            line,
            excerpt: endpoint,
            reason: explainEndpoint(rel, endpoint, classification),
        });
    }
}

function classifyRiskHit({ rel, line, rule, lines, index, source }) {
    if (isDocumentation(rel)) {
        return 'allowed-documentation';
    }
    if (isTestFile(rel)) {
        return 'deprecated-test-fixture';
    }
    if (rule.id === 'resource-body-copy') {
        if (isScriptImportOriginalResourceWriter(rel, source)) {
            return 'allowed-adapter';
        }
        if (isScriptImportPlannerGuardRejection(rel, lines, index)) {
            return 'allowed-adapter';
        }
        return isExplicitResourceBodyRejection(lines, index, source)
            ? 'allowed-adapter'
            : 'prohibited-active';
    }
    if (isProtocolValidator(rel) && isValidationContext(line)) {
        return 'allowed-adapter';
    }
    if (isAdapter(rel) && isValidationContext(line)) {
        return 'allowed-adapter';
    }
    if (isApprovedRuntimeBridge(rel)) {
        if (rule.id === 'bottom-generate-endpoint') {
            return 'prohibited-active';
        }
        return 'allowed-adapter';
    }
    if (rule.id === 'authored-story-state' && isProtocolValidator(rel)) {
        return 'allowed-adapter';
    }
    return 'prohibited-active';
}

function classifyEndpoint(rel, endpoint, source = '') {
    if (isDocumentation(rel)) {
        return 'allowed-documentation';
    }
    if (isTestFile(rel)) {
        return 'deprecated-test-fixture';
    }
    if (/\/api\/(?:backends\/[^/]*\/generate|novelai\/generate)/i.test(endpoint)) {
        return 'prohibited-active';
    }
    if (isApprovedRuntimeBridge(rel)) {
        return allowedSillyTavernEndpoints.has(endpoint) || endpoint === '/health' || endpoint === '/v1/generate-reply' || endpoint === '/v1/stop' || endpoint === '/v1/llm-health' || endpoint === '/v1/shutdown-gate' || endpoint === '/v1/shutdown-gate/renew' || endpoint === '/v1/shutdown-gate/release'
            ? 'allowed-adapter'
            : 'needs-review';
    }
    if (isScriptImportOriginalResourceWriter(rel, source)) {
        return allowedScriptImportOriginalStEndpoints.has(endpoint) || endpoint.startsWith('/v1/')
            ? 'allowed-adapter'
            : 'needs-review';
    }
    if (endpoint === '/api/worldinfo/get') {
        return isSpeakerCandidateWorldbookEndpoint(rel, source) ? 'allowed-adapter' : 'needs-review';
    }
    if (isAdapter(rel)) {
        if (isPresentationAnalysisAdapter(rel)) {
            return endpoint === '/v1/presentation/annotations' || endpoint === '/v1/health'
                ? 'allowed-adapter'
                : 'needs-review';
        }
        if (isProcessSupervisorAdapter(rel)) {
            return endpoint === '/v1/recover' || endpoint === '/v1/shutdown' ? 'allowed-adapter' : 'needs-review';
        }
        return allowedSillyTavernEndpoints.has(endpoint) || endpoint === '/health' || endpoint === '/v1/generate-reply' || endpoint === '/v1/llm-health'
            ? 'allowed-adapter'
            : 'needs-review';
    }
    if (isConfigOrMediaAdapter(rel) && endpoint.startsWith('/v1/')) {
        return 'allowed-adapter';
    }
    if (isAdminApp(rel) && endpoint.startsWith('/v1/')) {
        return isAllowedAdminExternalEndpoint(endpoint) || isAllowedAdminVisualFacadeEndpoint(endpoint)
            ? 'allowed-adapter'
            : 'needs-review';
    }
    if (isExternalModule(rel) && endpoint.startsWith('/v1/')) {
        return 'allowed-adapter';
    }
    return endpoint.startsWith('/api/') || endpoint === '/csrf-token'
        ? 'prohibited-active'
        : 'allowed-adapter';
}

function explainEndpoint(rel, endpoint, classification) {
    if (classification === 'prohibited-active') {
        return `Endpoint ${endpoint} is not allowed from this path.`;
    }
    if (isApprovedRuntimeBridge(rel)) {
        return 'Approved external original-runtime bridge may call the original runtime/chat contract.';
    }
    if (isAdapter(rel)) {
        if (isProcessSupervisorAdapter(rel)) {
            return 'Player process recovery endpoint is isolated in the loopback supervisor adapter.';
        }
        return 'SillyTavern endpoint detail is isolated in the shared adapter layer.';
    }
    if (endpoint.startsWith('/v1/')) {
        return 'Versioned external module contract.';
    }
    return 'Allowed non-generation endpoint.';
}

async function checkPlayerRouteIsolation() {
    const playerFiles = [
        'frontend/player/src/index.html',
        'frontend/player/src/main.js',
        'public/game/index.html',
        'public/game/app.js',
    ];
    const forbiddenVisibleTerms = [
        'SillyTavern',
        '模型',
        'API',
        'Token',
        '提示词',
        '预设',
        '角色卡',
        '世界书',
        '权重',
        '上下文',
        '生成控制',
        '管理员',
        '原版资源',
        '故事入口',
        '场景管理',
        'game-admin',
    ];
    const leaks = [];
    for (const rel of playerFiles) {
        const source = await readRepoFile(rel);
        const visible = rel.endsWith('.html')
            ? stripHtmlTags(source)
            : extractQuotedStrings(source).join('\n');
        const terms = forbiddenVisibleTerms.filter((term) => visible.includes(term));
        if (terms.length) {
            leaks.push({ file: rel, terms });
        }
    }
    checks.push({
        name: 'player-visible-terms-and-route-isolation',
        ok: leaks.length === 0,
        details: {
            scannedFiles: playerFiles,
            leaks,
        },
    });
    for (const leak of leaks) {
        findings.push({
            ruleId: 'player-visible-term-leak',
            category: 'player-admin-isolation',
            classification: 'prohibited-active',
            file: leak.file,
            line: 1,
            excerpt: leak.terms.join(', '),
            reason: 'Player-visible UI must not expose admin or SillyTavern technical terms.',
        });
    }
}

async function checkSourcePublicConsistency() {
    const pairs = [
        {
            name: 'player-html-build',
            source: 'frontend/player/src/index.html',
            output: 'public/game/index.html',
            normalizeSource: normalizeHtmlSource,
            normalizeOutput: normalizeHtmlOutput,
        },
        {
            name: 'player-css-build',
            source: 'frontend/player/src/styles.css',
            output: 'public/game/styles.css',
            normalizeSource: identity,
            normalizeOutput: identity,
        },
        {
            name: 'player-js-build',
            source: 'frontend/player/src/main.js',
            output: 'public/game/app.js',
            normalizeSource: normalizeAppJsSource,
            normalizeOutput: normalizeBuiltJs,
        },
        {
            name: 'admin-html-build',
            source: 'frontend/admin/src/index.html',
            output: 'public/game-admin/index.html',
            normalizeSource: normalizeHtmlSource,
            normalizeOutput: normalizeHtmlOutput,
        },
        {
            name: 'admin-css-build',
            source: 'frontend/admin/src/styles.css',
            output: 'public/game-admin/styles.css',
            normalizeSource: identity,
            normalizeOutput: identity,
        },
        {
            name: 'admin-js-build',
            source: 'frontend/admin/src/main.js',
            output: 'public/game-admin/app.js',
            normalizeSource: normalizeAppJsSource,
            normalizeOutput: normalizeBuiltJs,
        },
    ];

    for (const pair of pairs) {
        const source = pair.normalizeSource(await readRepoFile(pair.source));
        const output = pair.normalizeOutput(await readRepoFile(pair.output));
        const ok = source === output;
        checks.push({
            name: pair.name,
            ok,
            details: {
                source: pair.source,
                output: pair.output,
                sourceHash: hashString(source),
                outputHash: hashString(output),
            },
        });
        if (!ok) {
            findings.push({
                ruleId: 'source-public-mismatch',
                category: 'build-artifact',
                classification: 'prohibited-active',
                file: pair.output,
                line: 1,
                excerpt: `${pair.output} is not synchronized with ${pair.source}`,
                reason: 'Public build output must be rebuilt from current frontend source.',
            });
        }
    }

    for (const target of [
        { entry: 'frontend/player/src/main.js', publicRoot: 'public/game/shared' },
        { entry: 'frontend/admin/src/main.js', publicRoot: 'public/game-admin/shared' },
    ]) {
        const sharedFiles = await collectImportedSharedSources(target.entry);
        for (const relSource of sharedFiles) {
            const suffix = relSource.replace('frontend/shared/src/', '');
            const publicRoot = target.publicRoot;
            const relOutput = `${publicRoot}/${suffix}`;
            const source = normalizeBuiltJs(await readRepoFile(relSource));
            const output = normalizeBuiltJs(await readRepoFile(relOutput));
            const ok = source === output;
            checks.push({
                name: `shared-build:${relOutput}`,
                ok,
                details: {
                    source: relSource,
                    output: relOutput,
                    sourceHash: hashString(source),
                    outputHash: hashString(output),
                },
            });
            if (!ok) {
                findings.push({
                    ruleId: 'source-public-mismatch',
                    category: 'build-artifact',
                    classification: 'prohibited-active',
                    file: relOutput,
                    line: 1,
                    excerpt: `${relOutput} is not synchronized with ${relSource}`,
                    reason: 'Public shared module output must be rebuilt from current shared source.',
                });
            }
        }
    }

    await checkBuiltModuleGraph('public/game/app.js', 'public/game');
    await checkBuiltModuleGraph('public/game-admin/app.js', 'public/game-admin');
}

async function checkBuiltModuleGraph(entryFile, outputRoot) {
    const pending = [entryFile];
    const visited = new Set();
    while (pending.length) {
        const relPath = pending.pop();
        if (visited.has(relPath)) continue;
        visited.add(relPath);
        let source;
        try {
            source = await readRepoFile(relPath);
        } catch {
            checks.push({ name: `module-graph:${relPath}`, ok: false, details: { error: 'module file missing' } });
            continue;
        }
        for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/gu)) {
            const specifier = match[1];
            if (!specifier.startsWith('.')) continue;
            const cleanSpecifier = specifier.split(/[?#]/u, 1)[0];
            const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relPath), cleanSpecifier));
            if (resolved !== outputRoot && !resolved.startsWith(`${outputRoot}/`)) {
                checks.push({ name: `module-graph:${relPath}`, ok: false, details: { error: 'relative import escapes build root', specifier } });
                continue;
            }
            try {
                await stat(path.resolve(repoRoot, resolved));
                checks.push({ name: `module-graph:${resolved}`, ok: true, details: { importedBy: relPath } });
                if (resolved.endsWith('.js')) pending.push(resolved);
            } catch {
                checks.push({ name: `module-graph:${resolved}`, ok: false, details: { error: 'imported module missing', importedBy: relPath, specifier } });
            }
        }
    }
}

async function checkPresentationGateReports() {
    const { MAX_ASSISTED_PRESENTATION_MESSAGES, PRESENTATION_ANNOTATION_MODE, PRESENTATION_GATE_REPORTS, PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES, resolvePresentationMode } = await import('../player/src/presentation-renderer.js');
    const { verifyPresentationGateReports } = await import('../shared/src/presentation-gate.js');
    const modeValid = ['off', 'shadow', 'assisted'].includes(PRESENTATION_ANNOTATION_MODE);
    const experimentalRolloutValid = Array.isArray(PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES)
        && PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES.length === 1
        && PRESENTATION_UNVERIFIED_ASSISTED_LANGUAGES[0] === 'zh-CN'
        && MAX_ASSISTED_PRESENTATION_MESSAGES === 12
        && resolvePresentationMode('zh-CN') === 'assisted'
        && resolvePresentationMode('en') === 'shadow';
    const validation = await verifyPresentationGateReports({
        reports: PRESENTATION_GATE_REPORTS,
        readText: (relativePath) => readRepoFile(relativePath),
        sha256: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
    });
    checks.push({
        name: 'presentation-gate-and-explicit-experiment-rollout',
        ok: modeValid && validation.valid && experimentalRolloutValid,
        details: { modeValid, experimentalRolloutValid, languageCount: validation.languages?.length || 0, errors: validation.errors },
    });
}

function isSpeakerCandidateWorldbookEndpoint(rel, source = '') {
    const normalizedPath = rel.replaceAll('\\', '/');
    const allowedFiles = new Set([
        'frontend/shared/src/sillytavern-adapter.js',
        'public/game/shared/sillytavern-adapter.js',
        'public/game-admin/shared/sillytavern-adapter.js',
    ]);
    if (!allowedFiles.has(normalizedPath)) return false;

    const routeConstant = "const SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT = '/api/worldinfo/get';";
    const classDeclaration = 'export class SillyTavernSpeakerCandidateAdapter';
    const routeReference = 'SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT';
    const classStart = source.indexOf(classDeclaration);
    const classBodyStart = classStart < 0 ? -1 : source.indexOf('{', classStart + classDeclaration.length);
    const classBodyEnd = classBodyStart < 0 ? -1 : findMatchingJavaScriptBrace(source, classBodyStart);
    const candidateClassBody = classBodyEnd < 0 ? '' : source.slice(classBodyStart, classBodyEnd + 1);
    return source.includes(routeConstant)
        && classStart >= 0
        && classBodyEnd >= classBodyStart
        && source.split('/api/worldinfo/get').length === 2
        && source.split(routeReference).length === 3
        && source.split('this.client.url(SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT)').length === 2
        && candidateClassBody.split('this.client.url(SPEAKER_CANDIDATE_WORLD_INFO_GET_ENDPOINT)').length === 2;
}

function findMatchingJavaScriptBrace(source, openingIndex) {
    let depth = 0;
    let quote = '';
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = openingIndex; index < source.length; index += 1) {
        const character = source[index];
        const next = source[index + 1];
        if (lineComment) {
            if (character === '\n') lineComment = false;
            continue;
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === quote) {
                quote = '';
            }
            continue;
        }
        if (character === '/' && next === '/') {
            lineComment = true;
            index += 1;
            continue;
        }
        if (character === '/' && next === '*') {
            blockComment = true;
            index += 1;
            continue;
        }
        if (character === "'" || character === '"' || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth += 1;
        if (character === '}') {
            depth -= 1;
            if (depth === 0) return index;
        }
    }
    return -1;
}

async function checkSafePresentationFallback() {
    const source = await readRepoFile('frontend/player/src/main.js');
    const start = source.indexOf('function createPresentationPagesForMessage(');
    const end = source.indexOf('\nfunction renderChatSnapshot(', start);
    const renderPath = source.slice(start, end);
    const basePagesIndex = renderPath.indexOf('const basePages = nonEmptySegments;');
    const semanticIndex = renderPath.indexOf('getAssistedPresentationSegments(');
    const sourceBodyPipeline = renderPath.slice(0, basePagesIndex < 0 ? renderPath.length : basePagesIndex);
    const usesOriginalFormatter = sourceBodyPipeline.includes('const sourceText = formatVisualNovelDisplayText(visibleText);');
    const importsLegacyParser = /\bcreateVisualNovelDisplaySegments\b/u.test(source);
    const usesOriginalDisplaySplitter = sourceBodyPipeline.includes('createVisualNovelDisplaySegments(visibleText,');
    const sourceSegmentsBecomePagesDirectly = basePagesIndex >= 0
        && !renderPath.includes('createPresentationPages(');
    const semanticRunsAfterBase = semanticIndex > basePagesIndex && basePagesIndex >= 0;
    const semanticAbsentFromBodyPipeline = !sourceBodyPipeline.includes('projectedSegments')
        && !sourceBodyPipeline.includes('getAssistedPresentationSegments(');
    const semanticMetadataIsSeparate = renderPath.includes('semanticPresentation: {')
        && !renderPath.includes('\n            type: segment.type,')
        && !renderPath.includes('\n            speaker: segment.speaker,')
        && !renderPath.includes('\n            identityRef: segment.identityRef,')
        && !renderPath.includes('\n            text: segment.text,')
        && !renderPath.includes('\n            sourceSpan: segment.sourceSpan,');
    const renderer = await readRepoFile('frontend/player/src/presentation-renderer.js');
    const sourceBoundariesOnly = renderer.includes('source.slice(span.start, span.end).join(\'\')');
    checks.push({
        name: 'presentation-safe-fallback',
        ok: start >= 0 && end > start && usesOriginalFormatter && importsLegacyParser && usesOriginalDisplaySplitter
            && sourceSegmentsBecomePagesDirectly && semanticRunsAfterBase && semanticAbsentFromBodyPipeline
            && semanticMetadataIsSeparate && sourceBoundariesOnly,
        details: { usesOriginalFormatter, importsLegacyParser, usesOriginalDisplaySplitter, sourceSegmentsBecomePagesDirectly,
            semanticRunsAfterBase, semanticAbsentFromBodyPipeline, semanticMetadataIsSeparate, sourceBoundariesOnly },
    });
}

async function collectImportedSharedSources(entryPoint) {
    const pending = [entryPoint];
    const visited = new Set();
    const sharedSources = new Set();
    while (pending.length) {
        const relPath = pending.pop();
        if (visited.has(relPath)) continue;
        visited.add(relPath);
        const source = await readRepoFile(relPath);
        const absolutePath = path.resolve(repoRoot, relPath);
        const sharedRoot = path.resolve(repoRoot, 'frontend/shared/src');
        for (const match of source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/gu)) {
            const specifier = match[1];
            let dependency = '';
            if (specifier.startsWith('../../shared/src/')) {
                dependency = path.resolve(repoRoot, 'frontend/shared/src', specifier.slice('../../shared/src/'.length));
            } else if (specifier.startsWith('.') && absolutePath.startsWith(`${sharedRoot}${path.sep}`)) {
                dependency = path.resolve(path.dirname(absolutePath), specifier);
            }
            if (!dependency || !dependency.startsWith(`${sharedRoot}${path.sep}`) || !dependency.endsWith('.js')) continue;
            const dependencyRel = path.relative(repoRoot, dependency).replace(/\\/gu, '/');
            sharedSources.add(dependencyRel);
            pending.push(dependencyRel);
        }
    }
    return [...sharedSources].sort();
}

async function checkFrozenBoundary() {
    const diff = await runGit(['diff', '--name-only', '--', ...frozenPaths]);
    const modified = await runGit(['ls-files', '-m', '--', ...frozenPaths]);
    const changed = [...new Set([...diff, ...modified])].filter(Boolean);
    checks.push({
        name: 'frozen-sillytavern-boundary',
        ok: changed.length === 0,
        details: {
            frozenPaths,
            changed,
        },
    });
    for (const rel of changed) {
        findings.push({
            ruleId: 'frozen-boundary-change',
            category: 'backend-freeze',
            classification: 'prohibited-active',
            file: rel,
            line: 1,
            excerpt: rel,
            reason: 'Frozen SillyTavern backend/original frontend/root dependency path has tracked changes.',
        });
    }
}

async function checkPresentationCacheSafety() {
    const rel = 'frontend/shared/src/presentation-cache.js';
    const source = await readRepoFile(rel);
    const forbidden = /visibleText|playerInput|characterCard|worldBook|hiddenPrompt|rawChat|saveSlot|storyState/iu.test(source);
    const required = [
        'galgame-presentation-cache-v1',
        'PRESENTATION_CACHE_MAX_ENTRIES = 1_000',
        'PRESENTATION_CACHE_MAX_BYTES = 20 * 1024 * 1024',
        'PRESENTATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000',
        'Cache only validated annotation DTOs and source hashes; never cache source prose.',
    ];
    const missing = required.filter((marker) => !source.includes(marker));
    const ok = !forbidden && missing.length === 0;
    checks.push({ name: 'presentation-cache-derived-data-only', ok, details: { file: rel, forbiddenTextFields: forbidden, missingMarkers: missing } });
    if (!ok) findings.push({
        ruleId: 'presentation-cache-safety',
        category: 'parallel-story-state',
        classification: 'prohibited-active',
        file: rel,
        line: 1,
        excerpt: 'Presentation cache must contain only bounded, derived annotation DTOs and hashes.',
        reason: 'Persistent presentation cache must not become a parallel chat/save/story source.',
    });
}

async function checkOriginalRuntimeBridgeSecurity() {
    const rel = 'external-modules/original-runtime-bridge/server.mjs';
    const source = await readRepoFile(rel);
    const lifecycle = await readRepoFile('external-modules/original-runtime-bridge/generation-lifecycle.mjs');
    const targetReadbackVerified = hasOriginalTargetReadback(source, lifecycle);
    const bridgeChecks = [
        {
            name: 'default-loopback-listen',
            ok: /process\.env\.HOST\s*\|\|\s*['"]127\.0\.0\.1['"]/.test(source),
            classification: /process\.env\.HOST\s*\|\|\s*['"]127\.0\.0\.1['"]/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'CLI default host should be 127.0.0.1.',
        },
        {
            name: 'non-loopback-auth-required',
            ok: hasBridgeAuthentication(source),
            classification: hasBridgeAuthentication(source) ? 'allowed-adapter' : 'needs-review',
            evidence: hasBridgeAuthentication(source)
                ? 'Bridge has explicit request authentication evidence for non-loopback exposure.'
                : 'No bearer token, mTLS, session, or equivalent request authentication was found in the bridge server.',
        },
        {
            name: 'cors-not-auth',
            ok: /applyCors\(/.test(source) && hasBridgeAuthentication(source),
            classification: /applyCors\(/.test(source) && hasBridgeAuthentication(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'CORS is present only as origin filtering; independent request authentication/proof evidence must also exist.',
        },
        {
            name: 'signed-binding-proof-required',
            ok: /galgame\.original-runtime-bridge-proof\.v1/.test(source)
                && /createHmac/.test(source)
                && /verifyProofSignature/.test(source)
                && /BRIDGE_PROOF_REQUIRED/.test(source),
            classification: /galgame\.original-runtime-bridge-proof\.v1/.test(source)
                && /createHmac/.test(source)
                && /verifyProofSignature/.test(source)
                && /BRIDGE_PROOF_REQUIRED/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge must verify a signed binding proof; client-provided allowlist JSON alone is not authorization.',
        },
        {
            name: 'proof-expiry-and-replay',
            ok: /expiresAt/.test(source)
                && /BRIDGE_PROOF_EXPIRED/.test(source)
                && /usedNonces/.test(source)
                && /BRIDGE_PROOF_REPLAYED/.test(source),
            classification: /expiresAt/.test(source)
                && /BRIDGE_PROOF_EXPIRED/.test(source)
                && /usedNonces/.test(source)
                && /BRIDGE_PROOF_REPLAYED/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge must reject expired and replayed binding proofs.',
        },
        {
            name: 'release-arc-chat-allowlist',
            ok: /BRIDGE_RELEASE_INDEX_MISMATCH/.test(source)
                && /BRIDGE_CHAT_NOT_ALLOWED/.test(source)
                && /BRIDGE_CHARACTER_NOT_ALLOWED/.test(source)
                && /targetBindingHash/.test(source),
            classification: /BRIDGE_RELEASE_INDEX_MISMATCH/.test(source)
                && /BRIDGE_CHAT_NOT_ALLOWED/.test(source)
                && /BRIDGE_CHARACTER_NOT_ALLOWED/.test(source)
                && /targetBindingHash/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge request validation must bind signed release/Arc/target/chat proof to the requested avatar and chat.',
        },
        {
            name: 'profile-isolation',
            ok: /GALGAME_BRIDGE_USER_DATA_DIR/.test(source) && /userDataDir/.test(source),
            classification: /GALGAME_BRIDGE_USER_DATA_DIR/.test(source) && /userDataDir/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge uses configurable browser profile directory; deployment must still keep production and test profiles isolated.',
        },
        {
            name: 'concurrency-lock',
            ok: /this\.queue\s*=/.test(source) && /this\.queue\.then/.test(source),
            classification: /this\.queue\s*=/.test(source) && /this\.queue\.then/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge serializes generation tasks through an instance queue.',
        },
        {
            name: 'target-chat-readback',
            ok: targetReadbackVerified,
            classification: targetReadbackVerified ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge reads target chat before and after generation and checks active chat binding.',
        },
        {
            name: 'runtime-worldbook-chat-metadata',
            ok: /runtimeWorldBookRefs/.test(source)
                && /ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH/.test(source)
                && /ORIGINAL_RUNTIME_WORLD_INFO_NOT_LOADED/.test(source)
                && /chat_metadata\?\.world_info/.test(source)
                && /characterPrimaryWorldTemporarilyDisabled/.test(source)
                && /restoreCharacterPrimaryWorld/.test(source)
                && /finally\s*\{\s*cleanupRuntimeBinding\(\);\s*\}/.test(source)
                && /WORLD_INFO_ACTIVATED/.test(source)
                && /preGenerateWorldInfoWorldRefs/.test(source)
                && /duringGenerateWorldInfoWorldRefs/.test(source)
                && /worldInfoExactSetDuringGenerate/.test(source)
                && /unexpectedLuciferArcWorldInfoDuringGenerate/.test(source),
            classification: /runtimeWorldBookRefs/.test(source)
                && /ORIGINAL_RUNTIME_WORLD_INFO_MISMATCH/.test(source)
                && /ORIGINAL_RUNTIME_WORLD_INFO_NOT_LOADED/.test(source)
                && /chat_metadata\?\.world_info/.test(source)
                && /characterPrimaryWorldTemporarilyDisabled/.test(source)
                && /restoreCharacterPrimaryWorld/.test(source)
                && /finally\s*\{\s*cleanupRuntimeBinding\(\);\s*\}/.test(source)
                && /WORLD_INFO_ACTIVATED/.test(source)
                && /preGenerateWorldInfoWorldRefs/.test(source)
                && /duringGenerateWorldInfoWorldRefs/.test(source)
                && /worldInfoExactSetDuringGenerate/.test(source)
                && /unexpectedLuciferArcWorldInfoDuringGenerate/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge must verify signed Arc worldbook refs against original chat_metadata.world_info, separate pre-Generate and during-Generate WORLD_INFO_ACTIVATED evidence, exact-check the Generate-window worldbook set, and restore temporary in-memory primary-world changes in a finally path.',
        },
        {
            name: 'stop-recovery',
            ok: /stopping/.test(source)
                && /pendingTask/.test(source)
                && /stopSignal/.test(source)
                && /\/v1\/stop/.test(source)
                && /BRIDGE_STOPPING/.test(source)
                && /BRIDGE_STOP_TIMEOUT/.test(source)
                && /forced-timeout/.test(source)
                && /pendingTaskFailed/.test(source),
            classification: /stopping/.test(source)
                && /pendingTask/.test(source)
                && /stopSignal/.test(source)
                && /\/v1\/stop/.test(source)
                && /BRIDGE_STOPPING/.test(source)
                && /BRIDGE_STOP_TIMEOUT/.test(source)
                && /forced-timeout/.test(source)
                && /pendingTaskFailed/.test(source) ? 'allowed-adapter' : 'needs-review',
            evidence: 'Bridge must expose explicit stopping/pending state, request original stop, fail in-flight tasks on forced timeout, reject new tasks during stop, and clear pending state.',
        },
    ];

    stateAudit.bridgeSecurity.push(...bridgeChecks);
    const blocking = bridgeChecks.filter((check) => check.classification === 'needs-review');
    checks.push({
        name: 'original-runtime-bridge-security-admission',
        ok: blocking.length === 0,
        details: {
            file: rel,
            checks: bridgeChecks,
            needsReview: blocking.map((check) => check.name),
        },
    });
    for (const check of blocking) {
        findings.push({
            ruleId: `bridge-security:${check.name}`,
            category: 'bridge-security',
            classification: 'needs-review',
            file: rel,
            line: 1,
            excerpt: check.evidence,
            reason: 'Approved original-runtime bridge needs explicit security/deployment evidence before it can be treated as a fully passed runtime gate.',
        });
    }
}

async function runGit(args) {
    const { stdout } = await execFileAsync('git', args, {
        cwd: repoRoot,
        timeout: 30000,
        windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function readRepoFile(rel) {
    return readFile(path.join(repoRoot, rel), 'utf8');
}

function normalizeHtmlSource(source) {
    return normalizeHtmlOutput(source.replaceAll('./main.js', './app.js'));
}

function normalizeHtmlOutput(source) {
    return source
        .replace(/(\.\/styles\.css)\?v=[^"']*/g, '$1')
        .replace(/(\.\/app\.js)\?v=[^"']*/g, '$1')
        .replace(/<meta\s+name=["']galgame-config-service["']\s+content=["'][^"']*["']\s*>\s*/gi, '')
        .replace(/<meta\s+name=["']galgame-process-supervisor["']\s+content=["'][^"']*["']\s*>\s*/gi, '')
        .replace(/<meta\s+name=["']galgame-original-runtime-bridge["']\s+content=["'][^"']*["']\s*>\s*/gi, '')
        .replace(/<meta\s+name=["']galgame-script-import-assistant["']\s+content=["'][^"']*["']\s*>\s*/gi, '')
        .replace(/\s*<\/head>/i, '\n</head>')
        .replace(/\r\n/g, '\n')
        .trim();
}

function normalizeAppJsSource(source) {
    return normalizeBuiltJs(source.replaceAll('../../shared/src/', './shared/'));
}

function normalizeBuiltJs(source) {
    return source
        .replace(/(\bfrom\s*['"]\.{1,2}\/[^'"]+\.js)\?v=[^'"]*/g, '$1')
        .replace(/(\bimport\s*\(\s*['"]\.{1,2}\/[^'"]+\.js)\?v=[^'"]*/g, '$1')
        .replace(/\r\n/g, '\n')
        .trim();
}

function extractQuotedStrings(source) {
    const values = [];
    const template = String.fromCharCode(96);
    for (let index = 0; index < source.length; index += 1) {
        const quote = source[index];
        if (quote === template) {
            index += 1;
            while (index < source.length) {
                if (source[index] === '\\') {
                    index += 2;
                    continue;
                }
                if (source[index] === template) break;
                index += 1;
            }
            continue;
        }
        if (quote !== "'" && quote !== '"') continue;
        let value = '';
        let valid = true;
        index += 1;
        while (index < source.length) {
            const character = source[index];
            if (character === '\\' && index + 1 < source.length) {
                value += character + source[index + 1];
                index += 2;
                continue;
            }
            if (character === '\n' || character === '\r') {
                valid = false;
                break;
            }
            if (character === quote) break;
            value += character;
            index += 1;
        }
        if (valid) values.push(value);
    }
    return values;
}

function stripHtmlTags(source) {
    return source
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '\n');
}

function getLineNumber(source, offset) {
    return source.slice(0, offset).split(/\r?\n/).length;
}

function isDocumentation(rel) {
    return rel.endsWith('.md') || rel.includes('/README');
}

function isTestFile(rel) {
    return /(?:^|\/)(?:tests?|fixtures?)(?:\/|$)/.test(rel)
        || /(?:^|\/)test\.mjs$/.test(rel)
        || /\.test\.mjs$/.test(rel);
}

function isProtocolValidator(rel) {
    return rel.endsWith('/protocol.js') || rel.endsWith('\\protocol.js');
}

function isAdapter(rel) {
    return rel.endsWith('/sillytavern-adapter.js') || rel.endsWith('\\sillytavern-adapter.js')
        || rel.endsWith('/process-supervisor-adapter.js') || rel.endsWith('\\process-supervisor-adapter.js')
        || rel.endsWith('/presentation-analysis-adapter.js') || rel.endsWith('\\presentation-analysis-adapter.js');
}

function isPresentationAnalysisAdapter(rel) {
    return rel.endsWith('/presentation-analysis-adapter.js') || rel.endsWith('\\presentation-analysis-adapter.js');
}

function isPresentationCacheAdapter(rel) {
    return rel.endsWith('/presentation-cache.js') || rel.endsWith('\\presentation-cache.js');
}

function isProcessSupervisorAdapter(rel) {
    return rel.endsWith('/process-supervisor-adapter.js') || rel.endsWith('\\process-supervisor-adapter.js');
}

function isAdminApp(rel) {
    return rel.startsWith('frontend/admin/') || rel.startsWith('public/game-admin/');
}

function isExternalModule(rel) {
    return rel.startsWith('external-modules/');
}

function isApprovedRuntimeBridge(rel) {
    return rel.startsWith('external-modules/original-runtime-bridge/');
}

function isScriptImportOriginalResourceWriter(rel, source = '') {
    if (!rel.startsWith('external-modules/script-import-assistant/')) {
        return false;
    }
    const requiredMarkers = [
        'SCRIPT_IMPORT_ORIGINAL_RESOURCE_BODY_GUARD',
        'importOnlyOriginalSillyTavernResourceWriter',
        'assertExistingResourceMatches',
        'ScriptImportResourceConflictError',
        'assertManifestReferencesOnly',
        'validateScenarioManifest',
        'hash-source-conflict-refuse-overwrite',
    ];
    return requiredMarkers.every((marker) => source.includes(marker));
}

function isPlayerRuntimePath(rel) {
    return rel.startsWith('frontend/player/') || rel.startsWith('public/game/');
}

function isValidationContext(line) {
    return /not allowed|forbidden|errors\.push|reject|must store references only|undefined|不得|禁止|拒绝/i.test(line);
}

function isExplicitResourceBodyRejection(lines, index, source = '') {
    const start = Math.max(0, index - 24);
    const end = Math.min(lines.length, index + 24);
    const context = lines.slice(start, end).join('\n');
    const forbiddenKeyListGuard = /FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS/.test(context)
        && /rejectEmbeddedOriginalResourceBody/.test(source)
        && /must store references only/.test(source);
    return /forbiddenBodyKeys|rejectEmbeddedOriginalResourceBody|must store references only|original resource body field|duplicate the original character card body|not original resource body/i.test(context)
        && /errors\.push|reject|forbiddenBodyKeys|FORBIDDEN_ORIGINAL_RESOURCE_BODY_KEYS|must store references only/i.test(context)
        || forbiddenKeyListGuard;
}

function isScriptImportPlannerGuardRejection(rel, lines, index) {
    if (rel !== 'external-modules/script-import-assistant/server.mjs') {
        return false;
    }
    const start = Math.max(0, index - 36);
    const end = Math.min(lines.length, index + 12);
    const context = lines.slice(start, end).join('\n');
    return /function looksForbiddenPlannerKey\(/.test(context)
        && /normalized\.includes\(token\)/.test(context);
}

function isProhibitionText(line) {
    return /must not|do not|does not|removed|rejected|禁止|不得|不允许|已废弃/i.test(line);
}

function resolveImportSpecifier(rel, specifier) {
    const clean = String(specifier || '').replace(/\?v=.*$/, '').replace(/\\/g, '/');
    if (!clean.startsWith('.')) {
        return clean;
    }
    return path.posix.normalize(path.posix.join(path.posix.dirname(rel), clean));
}

function identity(value) {
    return value.replace(/\r\n/g, '\n').trim();
}

function isStateLikeAssignment(target, line) {
    if (target.startsWith('ui.')) {
        return /\.(?:textContent|value|disabled|hidden|className|innerHTML)$/.test(target)
            || /\.(?:style|classList)\b/.test(target)
            || /ui\.[A-Za-z_$][\w$]*/.test(target);
    }
    return /(?:manifest|release|activeChatSnapshot|inputPending|generationPending|state|session|save|store|chat|message|visual|media)/i.test(target + ' ' + line);
}

function classifyPlayerStateField({ rel, line, field, isPersistence }) {
    if (isDocumentation(rel)) {
        return 'allowed-documentation';
    }
    if (isTestFile(rel)) {
        return 'deprecated-test-fixture';
    }
    if (isPresentationCacheAdapter(rel)) {
        return 'allowed-adapter';
    }
    if (isValidationContext(line)) {
        return 'allowed-adapter';
    }
    if (suspiciousStoryStatePattern.test(field) || suspiciousStoryStatePattern.test(line)) {
        return isPersistence ? 'prohibited-active' : 'needs-review';
    }
    if (allowedPlayerStateFields.has(field) || allowedUiStateNames.has(field)) {
        return 'allowed-adapter';
    }
    if (isGenericStorageWrapper(rel, line)) {
        return 'allowed-adapter';
    }
    if (/^(?:textContent|value|disabled|hidden|className|style|classList)$/.test(field)) {
        return 'allowed-adapter';
    }
    return isPersistence ? 'needs-review' : 'allowed-adapter';
}

function collectPersistenceGuardEvidence({ rel, line, source }) {
    if (!/\bbackend\.set\s*\(\s*playerSaveKey\s*\(\s*normalized\.saveId\s*\)\s*,\s*normalized\s*\)/.test(line)) {
        return null;
    }

    const requiredMarkers = [
        'PLAYER_SAVE_PROTOCOL_VERSION',
        'galgame.player-save.v1',
        'TOP_LEVEL_KEYS',
        'VISUAL_STATE_KEYS',
        'FORBIDDEN_NORMALIZED_KEYS',
        'validatePlayerSaveSlot',
        'normalizePlayerSaveSlot',
        'collectForbiddenKeys',
        'const normalized = normalizePlayerSaveSlot(slot)',
    ];
    const foundRequiredMarkers = requiredMarkers.filter((marker) => source.includes(marker));
    const foundAllowedFields = requiredPlayerSaveFields.filter((field) => hasSourceToken(source, field));
    const foundVisualFields = requiredPlayerSaveVisualFields.filter((field) => hasSourceToken(source, field));
    const foundForbiddenFields = requiredForbiddenPlayerSaveFields.filter((field) => hasSourceToken(source, field));
    const forbiddenGuardRejects = /FORBIDDEN_NORMALIZED_KEYS\.has\s*\(\s*normalizedKey\s*\)[\s\S]{0,240}errors\.push/.test(source);
    const topLevelRejectsUnknown = /!TOP_LEVEL_KEYS\.has\s*\(\s*key\s*\)[\s\S]{0,240}errors\.push/.test(source);
    const visualRejectsUnknown = /!VISUAL_STATE_KEYS\.has\s*\(\s*key\s*\)[\s\S]{0,240}errors\.push/.test(source);
    const normalizedWriteChain = /const\s+normalized\s*=\s*normalizePlayerSaveSlot\s*\(\s*slot\s*\)[\s\S]{0,240}backend\.set\s*\(\s*playerSaveKey\s*\(\s*normalized\.saveId\s*\)\s*,\s*normalized\s*\)/.test(source);

    const missing = [
        ...requiredMarkers.filter((marker) => !foundRequiredMarkers.includes(marker)).map((marker) => `marker:${marker}`),
        ...requiredPlayerSaveFields.filter((field) => !foundAllowedFields.includes(field)).map((field) => `allowedField:${field}`),
        ...requiredPlayerSaveVisualFields.filter((field) => !foundVisualFields.includes(field)).map((field) => `visualField:${field}`),
        ...requiredForbiddenPlayerSaveFields.filter((field) => !foundForbiddenFields.includes(field)).map((field) => `forbiddenField:${field}`),
        ...(!forbiddenGuardRejects ? ['guard:forbidden-key-reject'] : []),
        ...(!topLevelRejectsUnknown ? ['guard:top-level-unknown-reject'] : []),
        ...(!visualRejectsUnknown ? ['guard:visual-unknown-reject'] : []),
        ...(!normalizedWriteChain ? ['guard:normalized-write-chain'] : []),
    ];

    return {
        kind: 'player-save-v1',
        ok: missing.length === 0,
        file: rel,
        requiredAllowedFields: requiredPlayerSaveFields,
        requiredVisualFields: requiredPlayerSaveVisualFields,
        requiredForbiddenFields: requiredForbiddenPlayerSaveFields,
        foundAllowedFields,
        foundVisualFields,
        foundForbiddenFields,
        guardChecks: {
            forbiddenGuardRejects,
            topLevelRejectsUnknown,
            visualRejectsUnknown,
            normalizedWriteChain,
        },
        missing,
    };
}

function hasSourceToken(source, token) {
    return new RegExp(`['"\`]${escapeRegExp(token)}['"\`]`).test(source)
        || new RegExp(`\\b${escapeRegExp(token)}\\b`).test(source);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractPersistenceFields(line) {
    const fields = new Set();
    if (/\bplayerSaveKey\s*\([^)]*\)\s*,\s*normalized\b/.test(line)) {
        for (const field of [
            'playerSavePrefix',
            'protocolVersion',
            'saveId',
            'releaseId',
            'scenarioId',
            'scenarioVersion',
            'arcId',
            'chatId',
            'lastMessageIndex',
            'pageIndex',
            'visualState',
            'mediaJobIds',
            'savedAt',
        ]) {
            fields.add(field);
        }
    }
    for (const match of line.matchAll(/\b(STORAGE_KEYS\.[A-Za-z_$][\w$]*|manifestKey|protocolVersion|saveId|savedAt|releaseId|scenarioId|scenarioVersion|arcId|chatId|lastMessageIndex|pageIndex|visualState|mediaJobIds|mediaConfig|releaseHistory|activeRelease|defaultManifest|manifest|key|value)\b/g)) {
        fields.add(match[1].replace('STORAGE_KEYS.', ''));
    }
    if (!fields.size) {
        fields.add('unknown');
    }
    return [...fields];
}

function isGenericStorageWrapper(rel, line) {
    return (rel.endsWith('/storage.js') || rel.endsWith('\\storage.js'))
        && /\b(?:backend\.set|localStorage\.setItem|store\.put|runTransaction|createStorageBackend)\b/.test(line);
}

function classifyCallKind(line) {
    if (/\bctx\.generate\s*\(/.test(line)) {
        return 'original-runtime-generate';
    }
    if (/\.generateReply\s*\(/.test(line) || /\bgenerateReply\s*\(/.test(line)) {
        return 'original-runtime-bridge-generateReply';
    }
    if (/\brequestJson\s*\(/.test(line)) {
        return 'sillytavern-requestJson';
    }
    if (/\bfetch\s*\(/.test(line)) {
        return 'fetch';
    }
    if (/\bgenerate\s*\(/.test(line)) {
        return 'generate-named-call';
    }
    return 'unknown-call';
}

function classifyCallSite(rel, line, callKind, source = '') {
    if (isDocumentation(rel)) {
        return 'allowed-documentation';
    }
    if (isTestFile(rel)) {
        return 'deprecated-test-fixture';
    }
    if (callKind === 'original-runtime-generate') {
        return isApprovedRuntimeBridge(rel) ? 'allowed-adapter' : 'prohibited-active';
    }
    if (callKind === 'original-runtime-bridge-generateReply') {
        if (isApprovedRuntimeBridge(rel) || isAdapter(rel)) {
            return 'allowed-adapter';
        }
        if (rel.startsWith('frontend/player/') || rel.startsWith('public/game/')) {
            return 'allowed-adapter';
        }
        return 'needs-review';
    }
    if (callKind === 'sillytavern-requestJson') {
        if (isScriptImportOriginalResourceWriter(rel, source)) {
            return 'allowed-adapter';
        }
        return isAdapter(rel) ? 'allowed-adapter' : 'needs-review';
    }
    if (callKind === 'fetch') {
        if (/\/api\/(?:backends\/[^/]*\/generate|novelai\/generate)/i.test(line)) {
            return 'prohibited-active';
        }
        if (isCoreVisualDecisionCall(rel, line)) {
            return 'allowed-adapter';
        }
        if (isApprovedRuntimeBridge(rel) || isAdapter(rel) || isExternalModule(rel) || isConfigOrMediaAdapter(rel)) {
            return 'allowed-adapter';
        }
        if (isAdminApp(rel) && /\/v1\/health|config\.endpoint|media|scriptAssistantBaseUrl/i.test(line)) {
            return 'allowed-adapter';
        }
        if (rel.startsWith('frontend/player/') || rel.startsWith('public/game/')) {
            return 'needs-review';
        }
        return 'needs-review';
    }
    if (callKind === 'generate-named-call') {
        return isApprovedRuntimeBridge(rel) ? 'allowed-adapter' : 'needs-review';
    }
    return 'needs-review';
}

function isCoreVisualDecisionCall(rel, line) {
    const isPlayerSurface = rel.startsWith('frontend/player/') || rel.startsWith('public/game/');
    return isPlayerSurface && /\/v1\/core\/(?:visual-decisions|visual-context|catalogs)(?:[^a-z0-9_-]|$)/i.test(line);
}

function hasBridgeAuthentication(source) {
    return /authorization|bearer|api[-_]?key|mTLS|client certificate|authenticate|authRequired|GALGAME_BRIDGE_TOKEN|GALGAME_BRIDGE_AUTH/i.test(source);
}

function isConfigOrMediaAdapter(rel) {
    return rel.endsWith('/config-service.js')
        || rel.endsWith('/media-provider.js')
        || rel.endsWith('\\config-service.js')
        || rel.endsWith('\\media-provider.js');
}

function isAllowedAdminExternalEndpoint(endpoint) {
    return endpoint === '/v1/health'
        || endpoint === '/v1/admin/script-import/drafts'
        || /^\/v1\/admin\/script-import\/drafts\/.+\/(?:redeploy|confirm)$/.test(endpoint);
}

function isAllowedAdminVisualFacadeEndpoint(endpoint) {
    return endpoint === '/v1/admin/visual/upload'
        || endpoint === '/v1/admin/visual/publish'
        || endpoint === '/v1/local-admin/visual/upload'
        || endpoint === '/v1/local-admin/visual/publish';
}

function summarize(items, key) {
    return items.reduce((summary, item) => {
        summary[item[key]] = (summary[item[key]] || 0) + 1;
        return summary;
    }, {});
}

function buildNextActions({ prohibited, needsReview, failedChecks }) {
    const actions = [];
    if (prohibited.length) {
        actions.push('Pause business code work and remove or justify every prohibited-active finding at its root.');
    }
    if (needsReview.length) {
        actions.push('Manually review needs-review findings and reclassify them with code changes or audit-rule refinements.');
    }
    if (failedChecks.length) {
        actions.push('Fix failed architectural checks, especially source/public synchronization and frozen boundary failures.');
    }
    if (!actions.length) {
        actions.push('Static architecture gate passed; keep deferred/unbridged features no-button/no-claim and wait for reviewer re-review before batch A.');
    }
    return actions;
}

function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath)
        .replace(/\\/g, '/');
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        const key = value.slice(2);
        const next = values[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
            continue;
        }
        parsed[key] = next;
        index += 1;
    }
    return parsed;
}
