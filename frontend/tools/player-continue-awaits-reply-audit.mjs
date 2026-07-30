import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = await readFile(path.join(repoRoot, 'frontend', 'player', 'src', 'main.js'), 'utf8');
const configSource = await readFile(path.join(repoRoot, 'frontend', 'shared', 'src', 'config-service.js'), 'utf8');
const loadPlayerSaveMatch = source.match(/async function loadPlayerSave[\s\S]*?\n}\n\nasync function persistAutoSave/);
const failures = [];
if (!loadPlayerSaveMatch) {
    failures.push('loadPlayerSave function was not found');
} else {
    const body = loadPlayerSaveMatch[0];
    if (!/snapshotAwaitsReply\(snapshot\)[\s\S]*requestOriginalReply\(snapshot\)/.test(body)) {
        failures.push('continuing from a save that awaits AI reply does not request original reply');
    }
    if (!/closeDrawers\(\);[\s\S]*snapshotAwaitsReply\(snapshot\)/.test(body)) {
        failures.push('save restore should close drawers before retrying a pending reply');
    }
    if (!/release = createCanonicalPlayerSaveRelease\(slot, savedManifest\)/.test(body)) {
        failures.push('save restore should replace stale local release IDs with a canonical playable release');
    }
}

const retryButtonMatch = source.match(/ui\.refreshStoryButton\.addEventListener\('click', \(\) => \{[\s\S]*?\n    \}\);/);
if (!retryButtonMatch) {
    failures.push('retry button handler was not found');
} else if (!/retryOrSyncOriginalReply\(\)/.test(retryButtonMatch[0])) {
    failures.push('retry button should sync the active chat before requesting another reply');
}

const requestReplyMatch = source.match(/async function requestOriginalReply[\s\S]*?\n}\n\nasync function retryOrSyncOriginalReply/);
if (!requestReplyMatch) {
    failures.push('requestOriginalReply function was not found');
} else {
    const body = requestReplyMatch[0];
    if (!/loadLatestSnapshotForActiveChat\(currentGenerationSnapshot\)[\s\S]*ensureRuntimeBridgeReady\(\)/.test(body)) {
        failures.push('runtime bridge requests should sync the target chat before asking the bridge to generate');
    }
    if (!/renderThinkingForReply\(\)[\s\S]*getRuntimeBridgeProof/.test(body)) {
        failures.push('runtime bridge requests should show the thinking state before asking for a reply');
    }
    if (!/generationPending[\s\S]*return;/.test(body)) {
        failures.push('runtime bridge requests should be de-duplicated while generation is pending');
    }
    if (!/renderWaitingForReply\(\)/.test(body)) {
        failures.push('runtime bridge failures should stop in a stable manual retry state');
    }
}

for (const helperName of ['retryOrSyncOriginalReply', 'syncActiveChatSnapshot', 'loadLatestSnapshotForActiveChat']) {
    if (!new RegExp(`async function ${helperName}\\b`).test(source)) {
        failures.push(`${helperName} helper was not found`);
    }
}

const proofIssueMatch = configSource.match(/async issueRuntimeBridgeProof\(\{ release, manifest, snapshot \}, signal\)[\s\S]*?\n    }\n\n    async listReleases/);
if (!proofIssueMatch) {
    failures.push('ConfigReleaseStore.issueRuntimeBridgeProof function was not found');
} else {
    const body = proofIssueMatch[0];
    if (!/RUNTIME_BRIDGE_PROOF_RETRY_DELAYS_MS/.test(configSource) || !/isRuntimeBridgeProofRetryable\(error\)/.test(body)) {
        failures.push('runtime bridge proof issuance should use bounded retry for readback/transport races');
    }
    if (!/JSON\.stringify\(diagnostic\)/.test(body)) {
        failures.push('runtime bridge proof failures should keep a readable non-player diagnostic in the browser log');
    }
}

if (!/avatar: String\(bound\.avatar \|\| snapshot\?\.character\?\.avatar \|\| ''\)/.test(configSource)) {
    failures.push('runtime proof target should prefer the published character binding over stale snapshot metadata');
}

if (!/error\.status = response\.status/.test(configSource)) {
    failures.push('config service response errors should preserve HTTP status for proof retry decisions');
}

if (/scheduleAwaitingReplyRetry|ORIGINAL_REPLY_RETRY_DELAYS_MS|这一段正在重新连接/.test(source)) {
    failures.push('awaiting replies must not spin in an automatic reconnect loop');
}

const result = {
    ok: failures.length === 0,
    failures,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) {
    process.exitCode = 1;
}
