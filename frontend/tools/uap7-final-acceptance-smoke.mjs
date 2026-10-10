import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const runId = String(args['run-id'] || `uap7${Date.now().toString(36)}`).toLowerCase();
const sillyTavernPort = Number(args['sillytavern-port'] || 8001);
const sillyTavernBaseUrl = `http://127.0.0.1:${sillyTavernPort}`;
const evidencePath = path.resolve(repoRoot, args.evidence || `.codex-longrun/evidence/uap7-final-acceptance-${runId}.json`);
const childEvidencePath = path.resolve(repoRoot, `.codex-longrun/evidence/uap7-final-admin-ui-to-game-${runId}.json`);
const outLogPath = path.resolve(repoRoot, `.codex-longrun/evidence/uap7-sillytavern-${runId}.out.log`);
const errLogPath = path.resolve(repoRoot, `.codex-longrun/evidence/uap7-sillytavern-${runId}.err.log`);

await mkdir(path.dirname(evidencePath), { recursive: true });

const evidence = {
    ok: false,
    generatedAt: new Date().toISOString(),
    mode: 'uap7-final-acceptance-smoke',
    runId,
    sillyTavernBaseUrl,
    childEvidence: toRepoPath(childEvidencePath),
    checks: {},
    failures: [],
    boundaries: {
        startsTemporarySillyTavernProcess: true,
        modifiesStartupScripts: false,
        nodeTlsRejectUnauthorizedDisabled: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
        realExternalLlmNetwork: 'not-claimed-no-explicit-service-credentials',
        deterministicFallbackExpected: true,
    },
};

let serverProcess = null;

try {
    const existing = await probeSillyTavern(sillyTavernBaseUrl);
    if (existing.ok) {
        evidence.checks.sillyTavernStartup = {
            ok: true,
            mode: 'existing-process',
            status: existing.status,
        };
    } else {
        serverProcess = await startTemporarySillyTavern({
            port: sillyTavernPort,
            outLogPath,
            errLogPath,
        });
        const ready = await waitForSillyTavern(sillyTavernBaseUrl, 90_000);
        evidence.checks.sillyTavernStartup = {
            ok: ready.ok,
            mode: 'temporary-child-process',
            pid: serverProcess.pid,
            status: ready.status,
            outLog: toRepoPath(outLogPath),
            errLog: toRepoPath(errLogPath),
        };
        if (!ready.ok) {
            throw new Error(`SILLYTAVERN_STARTUP_TIMEOUT:${ready.error || ''}`);
        }
    }

    const result = await runFullAcceptanceSmoke();
    evidence.checks.fullAcceptance = result.summary;
    evidence.checks.childEvidence = await readChildEvidence(childEvidencePath);
    if (!result.ok) {
        evidence.failures.push(...result.failures);
    }
    if (evidence.checks.childEvidence?.ok !== true) {
        evidence.failures.push('child full-chain evidence is not ok');
    }
    if (evidence.checks.childEvidence?.worldbookExact !== true) {
        evidence.failures.push('child worldbook diagnostics are not exact');
    }
    if (evidence.checks.childEvidence?.runtimeGenerateCount < 2) {
        evidence.failures.push('child evidence has fewer than two runtime Generate diagnostics');
    }
    if (evidence.checks.childEvidence?.writeGenerateCount < 1) {
        evidence.failures.push('child evidence has no write/readback Generate diagnostic');
    }
    evidence.ok = evidence.failures.length === 0;
} catch (error) {
    evidence.ok = false;
    evidence.failures.push(error?.stack || error?.message || String(error));
} finally {
    if (serverProcess) {
        await stopTemporarySillyTavern(serverProcess);
    }
    await writeFile(evidencePath, JSON.stringify(sanitizeEvidence(evidence), null, 2), 'utf8');
}

console.log(JSON.stringify({
    ok: evidence.ok,
    evidence: toRepoPath(evidencePath),
    childEvidence: toRepoPath(childEvidencePath),
    failures: evidence.failures,
    startup: evidence.checks.sillyTavernStartup || null,
    fullAcceptance: evidence.checks.fullAcceptance || null,
}, null, 2));

if (!evidence.ok) {
    process.exitCode = 1;
}

async function startTemporarySillyTavern({ port, outLogPath, errLogPath }) {
    const out = createWriteStream(outLogPath, { flags: 'a' });
    const err = createWriteStream(errLogPath, { flags: 'a' });
    const child = execSpawn('node', ['server.js'], {
        cwd: repoRoot,
        env: {
            ...process.env,
            NODE_TLS_REJECT_UNAUTHORIZED: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0'
                ? ''
                : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
        },
    });
    child.stdout?.pipe(out);
    child.stderr?.pipe(err);
    return child;
}

function execSpawn(command, commandArgs, options) {
    return spawn(command, commandArgs, {
        ...options,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

async function waitForSillyTavern(baseUrl, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';
    while (Date.now() < deadline) {
        const probe = await probeSillyTavern(baseUrl);
        if (probe.ok) {
            return probe;
        }
        lastError = probe.error || '';
        await delay(750);
    }
    return { ok: false, error: lastError || 'timeout' };
}

async function probeSillyTavern(baseUrl) {
    try {
        const response = await fetch(`${baseUrl}/csrf-token`, { method: 'GET' });
        return {
            ok: response.ok,
            status: response.status,
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: error?.message || String(error),
        };
    }
}

async function runFullAcceptanceSmoke() {
    let stdout = '';
    let stderr = '';
    try {
        const result = await execFileAsync(process.execPath, [
            'frontend/tools/script-import-assistant-full-chain-smoke.mjs',
            '--base-url',
            sillyTavernBaseUrl,
            '--evidence',
            toRepoPath(childEvidencePath),
            '--run-id',
            runId,
            '--template',
            'rpg-adventure',
            '--script-fixture',
            'frontend/shared/tests/fixtures/adaptive-presentation/dungeon-master-rpg.txt',
            '--uap7-real-admin-ui-flow',
            'true',
            '--provider-mode',
            'deterministic',
            '--failure-recovery-smoke',
            'true',
        ], {
            cwd: repoRoot,
            timeout: 12 * 60 * 1000,
            maxBuffer: 32 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
    } catch (error) {
        stdout = error.stdout?.toString?.() || '';
        stderr = error.stderr?.toString?.() || '';
        const parsed = safeJsonParse(stdout);
        return {
            ok: false,
            failures: [error.message],
            summary: {
                ok: false,
                stderr: stderr.trim(),
                stdoutPreview: stdout.slice(0, 2000),
                parsed,
            },
        };
    }
    const parsed = JSON.parse(stdout);
    return {
        ok: parsed.ok === true,
        failures: parsed.failures || [],
        summary: {
            ok: parsed.ok === true,
            stderr: stderr.trim(),
            evidence: parsed.evidence || '',
            childEvidence: parsed.childEvidence || '',
            explicitPublish: parsed.explicitPublish || null,
            playerLive: parsed.playerLive || null,
        },
    };
}

async function readChildEvidence(filePath) {
    try {
        const value = JSON.parse(await readFile(filePath, 'utf8'));
        const bridgeSummary = value.checks?.playerLive?.bridgeDiagnosticsSummary || {};
        const bridgeEntries = Array.isArray(bridgeSummary.entries) ? bridgeSummary.entries : [];
        const runtimeGenerateCount = bridgeEntries.filter((entry) => entry?.stage === 'player-approved-original-runtime-reply').length;
        const writeGenerateCount = bridgeEntries.filter((entry) => entry?.stage === 'player-chat-write-and-readback').length;
        const entriesWorldbookExact = bridgeEntries.length >= 3
            && runtimeGenerateCount >= 2
            && writeGenerateCount >= 1
            && bridgeEntries.every(isExactBridgeDiagnosticEntry);
        const providedAllWorldInfoExact = typeof bridgeSummary.allWorldInfoExact === 'boolean'
            ? bridgeSummary.allWorldInfoExact
            : null;
        const worldbookExact = entriesWorldbookExact
            && (providedAllWorldInfoExact === null || providedAllWorldInfoExact === entriesWorldbookExact)
            && (typeof bridgeSummary.ok !== 'boolean' || bridgeSummary.ok === entriesWorldbookExact);
        return {
            ok: value.ok === true,
            provider: value.boundaries?.provider || '',
            realExternalLlmNetwork: value.boundaries?.realExternalLlmNetwork || '',
            realAdminUiOk: value.checks?.realAdminUi?.ok === true,
            explicitPublishOk: value.checks?.explicitPublish?.ok === true,
            playerLiveOk: value.checks?.playerLive?.ok === true,
            playerRecoveryOk: value.checks?.playerRecovery?.ok === true,
            nonTargetOk: value.checks?.nonTargetChatReadback?.ok === true,
            profileExact: value.checks?.explicitPublish?.presentationProfileExact === true,
            worldbookExact,
            bridgeDiagnosticsCount: bridgeEntries.length,
            runtimeGenerateCount,
            writeGenerateCount,
            providedAllWorldInfoExact,
            bridgeDiagnosticsOk: bridgeSummary.ok === true,
            bridgeDiagnosticFailures: bridgeEntries
                .map((entry, index) => ({ index, stage: entry?.stage || '', exact: isExactBridgeDiagnosticEntry(entry) }))
                .filter((entry) => entry.exact !== true),
            failures: value.failures || [],
        };
    } catch (error) {
        return {
            ok: false,
            error: error?.message || String(error),
        };
    }
}

function isExactBridgeDiagnosticEntry(entry) {
    return Boolean(
        entry
        && entry.ok === true
        && entry.targetChatReadbackAdvanced === true
        && entry.worldInfoExactSetDuringGenerate === true
        && entry.expectedWorldInfoActivated === true
        && Array.isArray(entry.unexpectedLuciferArcWorldInfoDuringGenerate)
        && entry.unexpectedLuciferArcWorldInfoDuringGenerate.length === 0
        && entry.bridgeAuthorization?.decision === 'allowed'
    );
}

async function stopTemporarySillyTavern(child) {
    if (!child || child.killed) {
        return;
    }
    child.kill('SIGTERM');
    await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(5000),
    ]);
    if (!child.killed) {
        child.kill('SIGKILL');
    }
}

function sanitizeEvidence(value) {
    if (Array.isArray(value)) {
        return value.map(sanitizeEvidence);
    }
    if (!value || typeof value !== 'object') {
        return typeof value === 'string'
            ? value.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted-token-like-value]')
            : value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeEvidence(item)]));
}

function safeJsonParse(value) {
    try {
        return JSON.parse(String(value || ''));
    } catch {
        return null;
    }
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, path.resolve(repoRoot, filePath)).replace(/\\/g, '/');
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
        } else {
            parsed[key] = next;
            index += 1;
        }
    }
    return parsed;
}
