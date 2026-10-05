import {
    PRESENTATION_ANNOTATION_VERSION,
    PRESENTATION_IDENTITY_PROJECTION_VERSION,
    PRESENTATION_ROSTER_PROJECTION_VERSION,
} from './presentation-annotation.js';

const HASH_PATTERN = /^(?:sha256:)?[a-f0-9]{64}$/u;
const METRIC_NAMES = Object.freeze([
    'speakerPrecision', 'speakerRecall', 'narrationFalseSpeakerRate', 'dialogueFalseNarrationRate',
    'spanCoverage', 'identityMergeErrorRate', 'identitySplitErrorRate', 'rosterEventAccuracy',
    'unsupportedRosterUpdateCount', 'duplicateAssetBindingCount',
]);
const COUNT_METRICS = new Set(['unsupportedRosterUpdateCount', 'duplicateAssetBindingCount']);
const IMPLEMENTATION_PATHS = Object.freeze({
    annotationSchema: 'frontend/shared/src/presentation-annotation.js',
    identityProjection: 'frontend/shared/src/presentation-projection.js',
    gateVerifier: 'frontend/shared/src/presentation-gate.js',
    analyzerPrompt: 'external-modules/presentation-analysis-service/server.mjs',
    goldenEvaluator: 'frontend/shared/tests/presentation-golden-runner.mjs',
});
const ARTIFACT_ROLES = Object.freeze(['corpus', 'predictions', 'runManifest']);

export function validatePresentationGateReport(report, language) {
    const errors = [];
    exactKeys(report, [
        'schemaVersion', 'language', 'corpusHash', 'predictionHash', 'analyzerScope', 'modelHash', 'promptHash',
        'resolverHash', 'annotationSchemaVersion', 'identityProjectionVersion', 'rosterProjectionVersion',
        'sampleCounts', 'metrics', 'bootstrap', 'evidence', 'evaluationDigest', 'passed',
    ], 'report', errors);
    if (!isRecord(report)) return { valid: false, errors };
    if (!isLanguageTag(language) || report.language !== language) errors.push('report.language');
    if (report.schemaVersion !== 'galgame.presentation-gate.v1') errors.push('report.schemaVersion');
    for (const key of ['corpusHash', 'predictionHash', 'modelHash', 'promptHash', 'resolverHash']) {
        if (typeof report[key] !== 'string' || !HASH_PATTERN.test(report[key])) errors.push(`report.${key}`);
    }
    exactKeys(report.evidence, ['implementationHashes', 'artifacts'], 'report.evidence', errors);
    exactKeys(report.evidence?.implementationHashes, Object.keys(IMPLEMENTATION_PATHS), 'report.evidence.implementationHashes', errors);
    if (isRecord(report.evidence?.implementationHashes)) {
        for (const [name, hash] of Object.entries(report.evidence.implementationHashes)) {
            if (!HASH_PATTERN.test(String(hash))) errors.push(`report.evidence.implementationHashes.${name}`);
        }
        if (normalizeHash(report.resolverHash) !== normalizeHash(report.evidence.implementationHashes.identityProjection)) {
            errors.push('report.resolverHash.binding');
        }
        if (normalizeHash(report.promptHash) !== normalizeHash(report.evidence.implementationHashes.analyzerPrompt)) {
            errors.push('report.promptHash.binding');
        }
    }
    exactKeys(report.evidence?.artifacts, ARTIFACT_ROLES, 'report.evidence.artifacts', errors);
    for (const role of ARTIFACT_ROLES) {
        const artifact = report.evidence?.artifacts?.[role];
        exactKeys(artifact, ['path', 'sha256'], `report.evidence.artifacts.${role}`, errors);
        const expectedPath = getExpectedArtifactPath(language, role);
        if (!isRecord(artifact) || artifact.path !== expectedPath) errors.push(`report.evidence.artifacts.${role}.path`);
        if (typeof artifact?.sha256 !== 'string' || !HASH_PATTERN.test(artifact.sha256)) errors.push(`report.evidence.artifacts.${role}.sha256`);
    }
    if (typeof report.evaluationDigest !== 'string' || !HASH_PATTERN.test(report.evaluationDigest)) errors.push('report.evaluationDigest');
    if (typeof report.analyzerScope !== 'string' || !report.analyzerScope.trim() || report.analyzerScope.length > 256) errors.push('report.analyzerScope');
    if (report.annotationSchemaVersion !== PRESENTATION_ANNOTATION_VERSION) errors.push('report.annotationSchemaVersion');
    if (report.identityProjectionVersion !== PRESENTATION_IDENTITY_PROJECTION_VERSION) errors.push('report.identityProjectionVersion');
    if (report.rosterProjectionVersion !== PRESENTATION_ROSTER_PROJECTION_VERSION) errors.push('report.rosterProjectionVersion');
    if (report.passed !== true) errors.push('report.passed');

    const sampleKeys = ['speakerSegments', 'narrationOrUnattributedSegments', 'heldOutScripts', 'independentChats'];
    exactKeys(report.sampleCounts, sampleKeys, 'report.sampleCounts', errors);
    if (!isRecord(report.sampleCounts)
        || !Number.isSafeInteger(report.sampleCounts.speakerSegments) || report.sampleCounts.speakerSegments < 500
        || !Number.isSafeInteger(report.sampleCounts.narrationOrUnattributedSegments) || report.sampleCounts.narrationOrUnattributedSegments < 200
        || !Number.isSafeInteger(report.sampleCounts.heldOutScripts) || report.sampleCounts.heldOutScripts < 5
        || !Number.isSafeInteger(report.sampleCounts.independentChats) || report.sampleCounts.independentChats < 20) {
        errors.push('report.sampleCounts.threshold');
    }

    exactKeys(report.metrics, METRIC_NAMES, 'report.metrics', errors);
    if (isRecord(report.metrics)) {
        for (const name of METRIC_NAMES) {
            const metric = report.metrics[name];
            exactKeys(metric, ['estimate', 'ciLower', 'ciUpper'], `report.metrics.${name}`, errors);
            if (!isRecord(metric) || ![metric.estimate, metric.ciLower, metric.ciUpper].every(Number.isFinite)
                || metric.ciLower < 0 || metric.ciUpper < metric.ciLower
                || metric.estimate < metric.ciLower || metric.estimate > metric.ciUpper) {
                errors.push(`report.metrics.${name}.range`);
                continue;
            }
            if (COUNT_METRICS.has(name)) {
                if (![metric.estimate, metric.ciLower, metric.ciUpper].every(Number.isSafeInteger)
                    || metric.ciLower !== metric.estimate || metric.ciUpper !== metric.estimate) errors.push(`report.metrics.${name}.count`);
            } else if (metric.estimate < 0 || metric.estimate > 1 || metric.ciUpper > 1) {
                errors.push(`report.metrics.${name}.range`);
            }
        }
        const minLower = (name, minimum) => { if ((report.metrics[name]?.ciLower ?? -1) < minimum) errors.push(`report.metrics.${name}.ciLower`); };
        const maxUpper = (name, maximum) => { if ((report.metrics[name]?.ciUpper ?? Number.POSITIVE_INFINITY) > maximum) errors.push(`report.metrics.${name}.ciUpper`); };
        minLower('speakerPrecision', 0.97);
        minLower('speakerRecall', 0.90);
        maxUpper('narrationFalseSpeakerRate', 0.01);
        maxUpper('dialogueFalseNarrationRate', 0.02);
        minLower('spanCoverage', 1);
        maxUpper('identityMergeErrorRate', 0.005);
        maxUpper('identitySplitErrorRate', 0.03);
        minLower('rosterEventAccuracy', 0.98);
        if (report.metrics.unsupportedRosterUpdateCount?.estimate !== 0) errors.push('report.metrics.unsupportedRosterUpdateCount.zero');
        if (report.metrics.duplicateAssetBindingCount?.estimate !== 0) errors.push('report.metrics.duplicateAssetBindingCount.zero');
    }

    exactKeys(report.bootstrap, ['method', 'iterations', 'seed', 'confidenceLevel'], 'report.bootstrap', errors);
    if (!isRecord(report.bootstrap) || report.bootstrap.method !== 'script-stratified'
        || !Number.isSafeInteger(report.bootstrap.iterations) || report.bootstrap.iterations < 1000
        || !Number.isSafeInteger(report.bootstrap.seed) || report.bootstrap.confidenceLevel !== 0.95) {
        errors.push('report.bootstrap');
    }
    return { valid: errors.length === 0, errors };
}

export async function verifyPresentationGateReports({ reports, readText, sha256 } = {}) {
    const errors = [];
    if (!isRecord(reports) || typeof readText !== 'function' || typeof sha256 !== 'function') {
        return { valid: false, errors: ['gate.verifier-arguments'], languages: [] };
    }
    const languages = Object.keys(reports);
    for (const language of languages) {
        const entry = reports[language];
        exactKeys(entry, ['path', 'sha256'], `gate.${language}`, errors);
        if (!isLanguageTag(language) || !isRecord(entry)) {
            errors.push(`gate.${language}.language`);
            continue;
        }
        const expectedPath = `docs/evidence/presentation-gates/${language}.json`;
        const expectedHash = String(entry.sha256 || '').replace(/^sha256:/u, '');
        if (entry.path !== expectedPath || !/^[a-f0-9]{64}$/u.test(expectedHash)) {
            errors.push(`gate.${language}.path-or-hash`);
            continue;
        }
        let raw;
        try { raw = await readText(expectedPath); } catch { errors.push(`gate.${language}.missing`); continue; }
        if (await sha256(raw) !== expectedHash) {
            errors.push(`gate.${language}.sha256`);
            continue;
        }
        let report;
        try { report = JSON.parse(raw); } catch { errors.push(`gate.${language}.json`); continue; }
        const validation = validatePresentationGateReport(report, language);
        if (!validation.valid) errors.push(...validation.errors.map((error) => `gate.${language}.${error}`));
        for (const [name, sourcePath] of Object.entries(IMPLEMENTATION_PATHS)) {
            let source;
            try { source = await readText(sourcePath); } catch { errors.push(`gate.${language}.implementation.${name}.missing`); continue; }
            const actualHash = normalizeHash(await sha256(source));
            if (actualHash !== normalizeHash(report.evidence?.implementationHashes?.[name])) {
                errors.push(`gate.${language}.implementation.${name}.sha256`);
            }
        }
        const actualEvaluationDigest = normalizeHash(await computePresentationGateEvaluationDigest(report, sha256));
        if (actualEvaluationDigest !== normalizeHash(report.evaluationDigest)) errors.push(`gate.${language}.evaluationDigest`);
        const artifactTexts = {};
        for (const role of ARTIFACT_ROLES) {
            const artifact = report.evidence?.artifacts?.[role];
            const expectedPath = getExpectedArtifactPath(language, role);
            if (!isRecord(artifact) || artifact.path !== expectedPath) continue;
            try { artifactTexts[role] = await readText(expectedPath); } catch { errors.push(`gate.${language}.artifact.${role}.missing`); continue; }
            if (normalizeHash(await sha256(artifactTexts[role])) !== normalizeHash(artifact.sha256)) {
                errors.push(`gate.${language}.artifact.${role}.sha256`);
            }
        }
        if (artifactTexts.corpus !== undefined && normalizeHash(await sha256(artifactTexts.corpus)) !== normalizeHash(report.corpusHash)) {
            errors.push(`gate.${language}.corpusHash.binding`);
        }
        if (artifactTexts.predictions !== undefined && normalizeHash(await sha256(artifactTexts.predictions)) !== normalizeHash(report.predictionHash)) {
            errors.push(`gate.${language}.predictionHash.binding`);
        }
        if (artifactTexts.runManifest !== undefined) {
            try {
                const manifest = JSON.parse(artifactTexts.runManifest);
                const manifestErrors = validatePresentationGateRunManifest(manifest, report);
                errors.push(...manifestErrors.map((error) => `gate.${language}.runManifest.${error}`));
            } catch { errors.push(`gate.${language}.runManifest.json`); }
        }
    }
    return { valid: errors.length === 0, errors, languages };
}

/**
 * Deterministic commitment over all gate claims. The report hash pinned by the
 * build manifest pins this digest; source hashes then bind it to the current
 * evaluator, prompt, schema, and projection implementations.
 */
export async function computePresentationGateEvaluationDigest(report, sha256) {
    if (!isRecord(report) || typeof sha256 !== 'function') throw new TypeError('report and sha256 are required');
    const { evaluationDigest: _ignored, evidence, ...claims } = report;
    claims.evidence = { implementationHashes: evidence?.implementationHashes };
    return sha256(stableJson(claims));
}

export const PRESENTATION_GATE_IMPLEMENTATION_PATHS = IMPLEMENTATION_PATHS;

export function validatePresentationGateRunManifest(manifest, report) {
    const errors = [];
    exactKeys(manifest, [
        'schemaVersion', 'runMode', 'language', 'corpusHash', 'predictionHash', 'analyzerScope', 'modelHash',
        'promptHash', 'resolverHash', 'annotationSchemaVersion', 'identityProjectionVersion',
        'rosterProjectionVersion', 'implementationHashes', 'evaluationDigest',
    ], 'runManifest', errors);
    if (!isRecord(manifest)) return errors;
    if (manifest.schemaVersion !== 'galgame.presentation-gate-run-manifest.v1') errors.push('schemaVersion');
    if (manifest.runMode !== 'model-backed') errors.push('runMode');
    for (const key of [
        'language', 'corpusHash', 'predictionHash', 'analyzerScope', 'modelHash', 'promptHash', 'resolverHash',
        'annotationSchemaVersion', 'identityProjectionVersion', 'rosterProjectionVersion',
    ]) {
        if (manifest[key] !== report[key]) errors.push(`${key}.mismatch`);
    }
    if (manifest.evaluationDigest !== report.evaluationDigest) errors.push('evaluationDigest.mismatch');
    exactKeys(manifest.implementationHashes, Object.keys(IMPLEMENTATION_PATHS), 'runManifest.implementationHashes', errors);
    if (stableJson(manifest.implementationHashes) !== stableJson(report.evidence?.implementationHashes)) errors.push('implementationHashes.mismatch');
    return errors;
}

function exactKeys(value, keys, path, errors) {
    if (!isRecord(value)) { errors.push(`${path}.object`); return; }
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) errors.push(`${path}.keys`);
}

function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isLanguageTag(value) {
    return typeof value === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value);
}

function normalizeHash(value) {
    return String(value ?? '').replace(/^sha256:/u, '');
}

function getExpectedArtifactPath(language, role) {
    const names = { corpus: 'corpus.jsonl', predictions: 'predictions.jsonl', runManifest: 'run-manifest.json' };
    return `docs/evidence/presentation-gates/artifacts/${language}/${names[role]}`;
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (isRecord(value)) {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}
