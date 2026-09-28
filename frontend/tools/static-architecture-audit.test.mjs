import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const toolPath = fileURLToPath(new URL('./static-architecture-audit.mjs', import.meta.url));
const repoRoot = path.resolve(path.dirname(toolPath), '../..');
const adminVisualFacadePaths = [
    '/v1/admin/visual/upload',
    '/v1/admin/visual/publish',
    '/v1/local-admin/visual/upload',
    '/v1/local-admin/visual/publish',
];

const source = await readFile(toolPath, 'utf8');
const helperMatch = source.match(/function isAllowedAdminVisualFacadeEndpoint\(endpoint\) \{([\s\S]*?)\n\}/);
assert.ok(helperMatch, 'exact admin visual facade helper must exist');
for (const endpoint of adminVisualFacadePaths) {
    const escaped = endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(helperMatch[1], new RegExp(`endpoint\\s*===\\s*['"]${escaped}['"]`));
}
assert.doesNotMatch(helperMatch[1], /startsWith|includes|\*|new\s+Set/);
assert.doesNotMatch(helperMatch[1], /\/v1\/(?:admin|local-admin)\/visual\/(?:status|enable|disable)/);

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'galgame-static-architecture-audit-'));
const evidencePath = path.join(tempRoot, 'wide-audit.json');
try {
    await execFileAsync(process.execPath, [
        toolPath,
        '--scope',
        'frontend/player,frontend/shared,frontend/admin,external-modules/visual-asset-service,public/game,public/game-admin',
        '--evidence',
        evidencePath,
    ], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
    const report = JSON.parse(await readFile(evidencePath, 'utf8'));
    assert.equal(report.ok, true);
    assert.equal(report.summary.prohibitedActiveCount, 0);
    assert.equal(report.summary.needsReviewCount, 0);
    assert.deepEqual(report.summary.failedChecks, []);

    const visualFindings = report.findings.filter((finding) => adminVisualFacadePaths.includes(finding.excerpt));
    const sourcePublicFindings = visualFindings.filter((finding) =>
        (finding.file.startsWith('frontend/admin/') || finding.file.startsWith('public/game-admin/'))
        && finding.classification !== 'deprecated-test-fixture');
    assert.ok(sourcePublicFindings.length >= adminVisualFacadePaths.length, 'all source/public facade paths must be scanned');
    assert.deepEqual(
        new Set(sourcePublicFindings.map((finding) => finding.excerpt)),
        new Set(adminVisualFacadePaths),
    );
    assert.ok(sourcePublicFindings.every((finding) => finding.classification === 'allowed-adapter'));
} finally {
    await rm(tempRoot, { recursive: true, force: true });
}

console.log('static architecture admin visual facade allowlist tests passed');
