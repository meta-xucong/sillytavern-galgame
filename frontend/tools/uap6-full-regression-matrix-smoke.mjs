import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const sillyTavernBaseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/uap6-full-regression-matrix.json');
const evidenceDir = path.dirname(evidencePath);
const matrixRunId = String(args['run-id'] || Date.now().toString(36)).toLowerCase();
const maxAttempts = Math.max(1, Math.min(2, Number(args['max-attempts'] || 2)));

const cases = [
    ['visual-novel', 'visual-novel-events.txt', 'vn'],
    ['rpg-adventure', 'dungeon-master-rpg.txt', 'rpg'],
    ['romance-social', 'romance-affection.txt', 'rom'],
    ['mystery-investigation', 'mystery-clues.txt', 'mys'],
    ['management-sim', 'management-resources.txt', 'mgmt'],
    ['sandbox-roleplay', 'sandbox-roleplay.txt', 'sand'],
];

const evidence = {
    ok: false,
    generatedAt: new Date().toISOString(),
    mode: 'uap6-full-regression-matrix-smoke',
    matrixRunId,
    sillyTavernBaseUrl,
    boundaries: {
        testOnlyHarness: true,
        controlledProvider: true,
        realExternalLlmNetwork: 'not-claimed',
        playerRecommendationRuntime: false,
        frozenSillyTavernFilesModified: false,
        bottomGenerateDirectCall: false,
        localScriptedFallback: false,
    },
    cases: [],
    failures: [],
};

await mkdir(evidenceDir, { recursive: true });

for (const [template, fixtureName, shortName] of cases) {
    const fixturePath = path.join('frontend', 'shared', 'tests', 'fixtures', 'adaptive-presentation', fixtureName);
    const caseEvidencePath = path.join(evidenceDir, `uap6-${matrixRunId}-full-chain-${shortName}.json`);
    const caseRunId = `uap6${shortName}${matrixRunId}`.replace(/[^a-z0-9-]/g, '').slice(0, 42);
    const includeRecovery = template === 'rpg-adventure';
    const result = await runCaseWithRetry({
        template,
        fixturePath,
        caseEvidencePath,
        caseRunId,
        includeRecovery,
    });
    evidence.cases.push(result);
}

evidence.failures = evidence.cases.flatMap((item) => item.failures.map((failure) => `${item.template}: ${failure}`));
evidence.ok = evidence.failures.length === 0;

await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.ok ? 0 : 1;

async function runCaseWithRetry({
    template,
    fixturePath,
    caseEvidencePath,
    caseRunId,
    includeRecovery,
}) {
    const attempts = [];
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const evidenceForAttempt = attempt === 1
            ? caseEvidencePath
            : caseEvidencePath.replace(/\.json$/i, `-retry${attempt}.json`);
        const runIdForAttempt = attempt === 1
            ? caseRunId
            : `${caseRunId}r${attempt}`.slice(0, 42);
        const result = await runCase({
            template,
            fixturePath,
            caseEvidencePath: evidenceForAttempt,
            caseRunId: runIdForAttempt,
            includeRecovery,
            attempt,
        });
        attempts.push({
            attempt,
            ok: result.ok,
            evidence: result.evidence,
            failures: result.failures,
        });
        last = result;
        if (result.ok || !isRetryableOriginalRuntimeBindingFailure(result)) {
            break;
        }
    }
    return {
        ...last,
        attempts,
        retryPolicy: {
            maxAttempts,
            retryableOnlyForOriginalRuntimeBindingSafetyFailure: true,
        },
    };
}

async function runCase({
    template,
    fixturePath,
    caseEvidencePath,
    caseRunId,
    includeRecovery,
    attempt,
}) {
    const command = [
        'frontend/tools/script-import-assistant-full-chain-smoke.mjs',
        '--base-url',
        sillyTavernBaseUrl,
        '--evidence',
        caseEvidencePath,
        '--run-id',
        caseRunId,
        '--template',
        template,
        '--script-fixture',
        fixturePath,
        ...(includeRecovery ? ['--failure-recovery-smoke', 'true'] : []),
    ];
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    try {
        const result = await execFileAsync(process.execPath, command, {
            cwd: repoRoot,
            timeout: 12 * 60 * 1000,
            maxBuffer: 32 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = error.stdout?.toString?.() || '';
        stderr = error.stderr?.toString?.() || '';
        exitCode = typeof error.code === 'number' ? error.code : 1;
    }

    const caseEvidence = await readCaseEvidence(caseEvidencePath);
    const failures = [];
    if (exitCode !== 0) failures.push(`child exited ${exitCode}`);
    if (!caseEvidence?.ok) failures.push('full-chain evidence ok=false');
    const checks = caseEvidence?.checks || {};
    if (checks.providerDraft?.usesLlm !== true) failures.push('controlled provider was not accepted as usesLlm=true');
    if (checks.confirmOriginalResources?.readbackOk !== true) failures.push('original ST resource readback did not pass');
    if (checks.confirmDoesNotPublish?.ok !== true) failures.push('confirm changed active release or did not reject draft publish');
    if (checks.bindingPropagation?.ok !== true) failures.push('binding propagation failed');
    if (checks.explicitPublish?.presentationProfileExact !== true) failures.push('explicit publish profile binding not exact');
    if (checks.explicitPublish?.activeManifestPresentationTemplate !== template) failures.push(`active manifest template mismatch: ${checks.explicitPublish?.activeManifestPresentationTemplate}`);
    if (checks.explicitPublish?.materializedPresentationTemplate !== template) failures.push(`materialized template mismatch: ${checks.explicitPublish?.materializedPresentationTemplate}`);
    if (!checks.explicitPublish?.chatSeedId) failures.push('active chatSeedId missing');
    if (!Array.isArray(checks.explicitPublish?.worldBookRefs) || checks.explicitPublish.worldBookRefs.length < 1) failures.push('active worldBookRefs missing');
    if (checks.playerLive?.ok !== true) failures.push('player live smoke failed');
    if (checks.playerLive?.runtimeTurns !== 2) failures.push(`runtime turns mismatch: ${checks.playerLive?.runtimeTurns}`);
    if (checks.playerLive?.bridgeDiagnosticsSummary?.ok !== true) failures.push('bridge diagnostics summary not ok');
    if ((checks.playerLive?.bridgeDiagnosticsSummary?.count || 0) < 3) failures.push('bridge diagnostics summary missing runtime/write entries');
    if (checks.nonTargetChatReadback?.ok !== true) failures.push('non-target chat readback changed or generated residue remained');
    if (includeRecovery) {
        if (checks.playerRecovery?.recoveryAccepted !== true) failures.push('bridge failure did not show retry/recovery state');
        if (checks.playerRecovery?.localScriptedFallbackDetected !== false) failures.push('bridge failure appeared to inject local scripted fallback');
    }
    if (JSON.stringify(caseEvidence).includes('api/backends/openai/generate') && !caseEvidence.checks?.testOnlyProxyDenylist?.ok) {
        failures.push('bottom generate endpoint appeared outside denylist evidence');
    }

    const failureEvidence = JSON.stringify({
        topFailures: caseEvidence?.failures || [],
        playerFailures: caseEvidence?.checks?.playerLive?.failures || [],
        runtimeFailures: caseEvidence?.checks?.playerLive?.runtimeFailures || [],
        writeFailures: caseEvidence?.checks?.playerLive?.writeChatFailures || [],
        recoveryFailures: caseEvidence?.checks?.playerRecovery?.failures || [],
    }).slice(0, 8000);

    return {
        template,
        fixture: fixturePath.replace(/\\/g, '/'),
        caseRunId,
        evidence: path.relative(repoRoot, caseEvidencePath).replace(/\\/g, '/'),
        attempt,
        exitCode,
        ok: failures.length === 0,
        includeRecovery,
        checks: {
            providerUsesLlm: checks.providerDraft?.usesLlm === true,
            importReadbackOk: checks.confirmOriginalResources?.readbackOk === true,
            confirmDraftOnly: checks.confirmDoesNotPublish?.ok === true,
            bindingPropagationOk: checks.bindingPropagation?.ok === true,
            presentationProfileExact: checks.explicitPublish?.presentationProfileExact === true,
            activeTemplate: checks.explicitPublish?.activeManifestPresentationTemplate || '',
            materializedTemplate: checks.explicitPublish?.materializedPresentationTemplate || '',
            chatSeedId: checks.explicitPublish?.chatSeedId || '',
            worldBookRefs: checks.explicitPublish?.worldBookRefs || [],
            playerLiveOk: checks.playerLive?.ok === true,
            runtimeTurns: checks.playerLive?.runtimeTurns || 0,
            bridgeDiagnosticsCount: checks.playerLive?.bridgeDiagnosticsSummary?.count || 0,
            bridgeDiagnosticsOk: checks.playerLive?.bridgeDiagnosticsSummary?.ok === true,
            nonTargetChatReadbackOk: checks.nonTargetChatReadback?.ok === true,
            nonTargetChangedCount: checks.nonTargetChatReadback?.nonTargetChangedCount ?? null,
            generatedResidueCount: checks.nonTargetChatReadback?.generatedResidueCount ?? null,
            recoveryAccepted: checks.playerRecovery?.recoveryAccepted ?? null,
        },
        stdoutPreview: stdout.slice(0, 1200),
        stderrPreview: stderr.slice(0, 1200),
        failureEvidence,
        failures,
    };
}

function isRetryableOriginalRuntimeBindingFailure(result) {
    const text = JSON.stringify({
        failures: result.failures,
        stdoutPreview: result.stdoutPreview,
        stderrPreview: result.stderrPreview,
        failureEvidence: result.failureEvidence,
    });
    return /ORIGINAL_TARGET_CHAT_BINDING_UNSTABLE|ORIGINAL_RUNTIME_ACTIVE_CHAT_MISMATCH|target chat binding/i.test(text);
}

async function readCaseEvidence(fileName) {
    try {
        return JSON.parse(await readFile(fileName, 'utf8'));
    } catch {
        return null;
    }
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
