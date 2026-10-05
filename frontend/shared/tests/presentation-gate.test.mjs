import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    PRESENTATION_ANNOTATION_VERSION,
    PRESENTATION_IDENTITY_PROJECTION_VERSION,
    PRESENTATION_ROSTER_PROJECTION_VERSION,
} from '../src/presentation-annotation.js';
import {
    computePresentationGateEvaluationDigest,
    PRESENTATION_GATE_IMPLEMENTATION_PATHS,
    validatePresentationGateReport,
    verifyPresentationGateReports,
} from '../src/presentation-gate.js';

const ratio = (estimate, ciLower = estimate, ciUpper = estimate) => ({ estimate, ciLower, ciUpper });
const sha256 = async (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const implementationFiles = Object.fromEntries(Object.values(PRESENTATION_GATE_IMPLEMENTATION_PATHS).map((path) => [path, `source:${path}:v1`]));
const implementationHashes = Object.fromEntries(Object.entries(PRESENTATION_GATE_IMPLEMENTATION_PATHS).map(([name, path]) => [name, `sha256:${createHash('sha256').update(implementationFiles[path], 'utf8').digest('hex')}`]));
const artifactPaths = {
    corpus: 'docs/evidence/presentation-gates/artifacts/zh-CN/corpus.jsonl',
    predictions: 'docs/evidence/presentation-gates/artifacts/zh-CN/predictions.jsonl',
    runManifest: 'docs/evidence/presentation-gates/artifacts/zh-CN/run-manifest.json',
};
const artifactFiles = { corpus: '{"caseId":"holdout-a"}\n', predictions: '{"caseId":"holdout-a","prediction":"model-output"}\n' };
const report = {
    schemaVersion: 'galgame.presentation-gate.v1', language: 'zh-CN',
    corpusHash: `sha256:${createHash('sha256').update(artifactFiles.corpus).digest('hex')}`,
    predictionHash: `sha256:${createHash('sha256').update(artifactFiles.predictions).digest('hex')}`,
    analyzerScope: 'test-model:test-prompt-v1', modelHash: `sha256:${'3'.repeat(64)}`,
    promptHash: implementationHashes.analyzerPrompt, resolverHash: implementationHashes.identityProjection,
    annotationSchemaVersion: PRESENTATION_ANNOTATION_VERSION,
    identityProjectionVersion: PRESENTATION_IDENTITY_PROJECTION_VERSION,
    rosterProjectionVersion: PRESENTATION_ROSTER_PROJECTION_VERSION,
    sampleCounts: { speakerSegments: 500, narrationOrUnattributedSegments: 200, heldOutScripts: 5, independentChats: 20 },
    metrics: {
        speakerPrecision: ratio(0.99, 0.98, 1), speakerRecall: ratio(0.93, 0.91, 0.95),
        narrationFalseSpeakerRate: ratio(0.005, 0, 0.01), dialogueFalseNarrationRate: ratio(0.01, 0, 0.02),
        spanCoverage: ratio(1), identityMergeErrorRate: ratio(0.002, 0, 0.005), identitySplitErrorRate: ratio(0.02, 0.01, 0.03),
        rosterEventAccuracy: ratio(0.99, 0.98, 1), unsupportedRosterUpdateCount: ratio(0), duplicateAssetBindingCount: ratio(0),
    },
    bootstrap: { method: 'script-stratified', iterations: 2000, seed: 20261002, confidenceLevel: 0.95 },
    evidence: {
        implementationHashes,
        artifacts: {
            corpus: { path: artifactPaths.corpus, sha256: `sha256:${createHash('sha256').update(artifactFiles.corpus).digest('hex')}` },
            predictions: { path: artifactPaths.predictions, sha256: `sha256:${createHash('sha256').update(artifactFiles.predictions).digest('hex')}` },
            runManifest: { path: artifactPaths.runManifest, sha256: `sha256:${'0'.repeat(64)}` },
        },
    },
    evaluationDigest: '',
    passed: true,
};
report.evaluationDigest = `sha256:${await computePresentationGateEvaluationDigest(report, sha256)}`;
const runManifest = {
    schemaVersion: 'galgame.presentation-gate-run-manifest.v1', runMode: 'model-backed', language: report.language,
    corpusHash: report.corpusHash, predictionHash: report.predictionHash, analyzerScope: report.analyzerScope,
    modelHash: report.modelHash, promptHash: report.promptHash, resolverHash: report.resolverHash,
    annotationSchemaVersion: report.annotationSchemaVersion, identityProjectionVersion: report.identityProjectionVersion,
    rosterProjectionVersion: report.rosterProjectionVersion, implementationHashes,
    evaluationDigest: report.evaluationDigest,
};
artifactFiles.runManifest = `${JSON.stringify(runManifest)}\n`;
report.evidence.artifacts.runManifest.sha256 = `sha256:${createHash('sha256').update(artifactFiles.runManifest).digest('hex')}`;
assert.deepEqual(validatePresentationGateReport(report, 'zh-CN'), { valid: true, errors: [] });

const weak = structuredClone(report);
weak.metrics.speakerPrecision.ciLower = 0.96;
assert.equal(validatePresentationGateReport(weak, 'zh-CN').valid, false, 'confidence lower bound below threshold is rejected');

const reportText = JSON.stringify(report);
const fileHash = createHash('sha256').update(reportText, 'utf8').digest('hex');
const readText = async (filePath) => {
    if (filePath === 'docs/evidence/presentation-gates/zh-CN.json') return reportText;
    for (const [role, path] of Object.entries(artifactPaths)) if (path === filePath) return artifactFiles[role];
    if (Object.hasOwn(implementationFiles, filePath)) return implementationFiles[filePath];
    throw new Error(`unexpected path: ${filePath}`);
};
const verified = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: fileHash } },
    readText, sha256,
});
assert.equal(verified.valid, true);
const tampered = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: '0'.repeat(64) } },
    readText, sha256,
});
assert.equal(tampered.valid, false, 'hash mismatch prevents a language from being allowlisted');

const changedCorpusFiles = { ...artifactFiles, corpus: `${artifactFiles.corpus}{"caseId":"tampered"}\n` };
const byteTamperResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: fileHash } },
    readText: async (path) => path === artifactPaths.corpus ? changedCorpusFiles.corpus : readText(path), sha256,
});
assert.equal(byteTamperResult.valid, false, 'changing corpus bytes fails the artifact digest');
assert.ok(byteTamperResult.errors.includes('gate.zh-CN.artifact.corpus.sha256'));
const changedPredictionFiles = { ...artifactFiles, predictions: `${artifactFiles.predictions}{"caseId":"injected"}\n` };
const predictionTamperResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: fileHash } },
    readText: async (path) => path === artifactPaths.predictions ? changedPredictionFiles.predictions : readText(path), sha256,
});
assert.equal(predictionTamperResult.valid, false, 'changing prediction bytes fails the artifact digest');
assert.ok(predictionTamperResult.errors.includes('gate.zh-CN.artifact.predictions.sha256'));
const retargeted = structuredClone(report);
retargeted.evidence.artifacts.predictions.path = 'docs/evidence/presentation-gates/artifacts/zh-CN/other-predictions.jsonl';
assert.ok(validatePresentationGateReport(retargeted, 'zh-CN').errors.includes('report.evidence.artifacts.predictions.path'), 'artifact paths cannot be retargeted');
const retargetedText = JSON.stringify(retargeted);
const retargetResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: createHash('sha256').update(retargetedText).digest('hex') } },
    readText: async (path) => path === 'docs/evidence/presentation-gates/zh-CN.json' ? retargetedText : readText(path), sha256,
});
assert.equal(retargetResult.valid, false, 'even a re-pinned report cannot redirect artifact lookup');
const changedManifestFiles = { ...artifactFiles, runManifest: `${JSON.stringify({ ...runManifest, resolverHash: `sha256:${'8'.repeat(64)}` })}\n` };
const mismatchedManifest = structuredClone(report);
mismatchedManifest.evidence.artifacts.runManifest.sha256 = `sha256:${createHash('sha256').update(changedManifestFiles.runManifest).digest('hex')}`;
const mismatchedManifestText = JSON.stringify(mismatchedManifest);
const manifestMismatchResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: createHash('sha256').update(mismatchedManifestText).digest('hex') } },
    readText: async (path) => path === 'docs/evidence/presentation-gates/zh-CN.json' ? mismatchedManifestText : path === artifactPaths.runManifest ? changedManifestFiles.runManifest : readText(path), sha256,
});
assert.equal(manifestMismatchResult.valid, false, 'run manifest metadata must match the report');
assert.ok(manifestMismatchResult.errors.includes('gate.zh-CN.runManifest.resolverHash.mismatch'));
const changedMetric = structuredClone(report);
changedMetric.metrics.speakerRecall.estimate = 0.94;
changedMetric.evaluationDigest = `sha256:${await computePresentationGateEvaluationDigest(changedMetric, sha256)}`;
const changedMetricText = JSON.stringify(changedMetric);
assert.notEqual(changedMetric.evaluationDigest, report.evaluationDigest, 'recomputed digest changes with metrics');
const changedMetricResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: createHash('sha256').update(changedMetricText).digest('hex') } },
    readText: async (path) => path === 'docs/evidence/presentation-gates/zh-CN.json' ? changedMetricText : readText(path), sha256,
});
assert.equal(changedMetricResult.valid, false, 'changing metrics and recomputing the public digest still mismatches the run manifest attestation');
assert.ok(changedMetricResult.errors.includes('gate.zh-CN.runManifest.evaluationDigest.mismatch'));
const staleFiles = { ...implementationFiles, [PRESENTATION_GATE_IMPLEMENTATION_PATHS.identityProjection]: 'stale identity resolver' };
const staleResult = await verifyPresentationGateReports({
    reports: { 'zh-CN': { path: 'docs/evidence/presentation-gates/zh-CN.json', sha256: fileHash } },
    readText: async (path) => path === 'docs/evidence/presentation-gates/zh-CN.json' ? reportText : Object.hasOwn(staleFiles, path) ? staleFiles[path] : readText(path), sha256,
});
assert.equal(staleResult.valid, false, 'changed resolver implementation invalidates the gate evidence');
assert.ok(staleResult.errors.includes('gate.zh-CN.implementation.identityProjection.sha256'));
const mismatchedResolver = structuredClone(report);
mismatchedResolver.resolverHash = `sha256:${'9'.repeat(64)}`;
assert.ok(validatePresentationGateReport(mismatchedResolver, 'zh-CN').errors.includes('report.resolverHash.binding'));
const staleDigest = structuredClone(report);
staleDigest.metrics.speakerPrecision.estimate = 0.985;
assert.equal(await computePresentationGateEvaluationDigest(staleDigest, sha256).then((value) => value === report.evaluationDigest), false, 'metrics tampering changes the evaluator commitment');
console.log('presentation-gate: PASS');
