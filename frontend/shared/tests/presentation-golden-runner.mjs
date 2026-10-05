#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = Object.freeze({
    annotationSchemaVersion: 'galgame.presentation-annotation.v1',
    identityProjectionVersion: 'galgame.identity-projection.v1',
    rosterProjectionVersion: 'galgame.roster-projection.v1',
});
const HASH = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const fail = (message) => { throw new Error(message); };

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i];
        if (!key.startsWith('--')) fail(`Unexpected argument: ${key}`);
        if (key === '--generate' || key === '--score' || key === '--fake') args[key.slice(2)] = true;
        else {
            if (!argv[i + 1] || argv[i + 1].startsWith('--')) fail(`Missing value for ${key}`);
            args[key.slice(2)] = argv[++i];
        }
    }
    if (Number(Boolean(args.generate)) + Number(Boolean(args.score)) !== 1) fail('Choose exactly one of --generate or --score.');
    return args;
}

async function readCorpus(directory) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl')).sort();
    if (!names.length) fail(`No JSONL corpus files found in ${directory}`);
    const rows = [];
    const sourceParts = [];
    for (const name of names) {
        const raw = await readFile(path.join(directory, name), 'utf8');
        sourceParts.push(`${name}\n${raw}`);
        for (const [lineNo, line] of raw.split(/\r?\n/u).entries()) {
            if (!line.trim()) continue;
            let row;
            try { row = JSON.parse(line); } catch { fail(`Invalid JSON at ${name}:${lineNo + 1}`); }
            validateCase(row, `${name}:${lineNo + 1}`);
            rows.push(row);
        }
    }
    const caseIds = new Set();
    const scriptPartition = new Map();
    for (const row of rows) {
        if (caseIds.has(row.caseId)) fail(`Duplicate caseId: ${row.caseId}`);
        caseIds.add(row.caseId);
        const prior = scriptPartition.get(row.scriptId);
        if (prior && prior !== row.partition) fail(`scriptId appears in multiple partitions: ${row.scriptId}`);
        scriptPartition.set(row.scriptId, row.partition);
    }
    const smokeScripts = rows.filter((row) => row.partition === 'smoke');
    if (new Set(smokeScripts.map((row) => row.scriptId)).size < 3
        || new Set(smokeScripts.map((row) => row.genre)).size < 3
        || smokeScripts.some((row) => row.sourceMessages.length < 20)) {
        fail('Synthetic smoke corpus requires at least three distinct scripts/genres and 20 messages per script.');
    }
    validateCorpusReferences(rows);
    return { rows, corpusHash: HASH(sourceParts.join('')) };
}

function validateCorpusReferences(rows) {
    for (const row of rows) {
        const known = new Set(row.sourceMessages.flatMap((message) => message.goldEntities.map((entity) => entity.entityKey)));
        for (const message of row.sourceMessages) {
            for (const segment of message.goldSegments) {
                if (segment.goldSpeakerEntityKey !== null && !known.has(segment.goldSpeakerEntityKey)) fail(`${row.caseId}: speaker entity does not exist in script`);
            }
            for (const entity of message.goldEntities) for (const mention of entity.mentions) {
                if (!Array.from(message.text).slice(mention.start, mention.end).join('').trim()) fail(`${row.caseId}: entity mention points to empty text`);
            }
            for (const claim of message.goldRosterClaims) {
                if (claim.targetEntityKey !== null && !known.has(claim.targetEntityKey)) fail(`${row.caseId}: roster target entity does not exist in script`);
                if (claim.memberEntityKeys.some((key) => !known.has(key))) fail(`${row.caseId}: roster member entity does not exist in script`);
                if (claim.claimType === 'party.snapshot' && !['complete', 'partial'].includes(claim.completeness)) fail(`${row.caseId}: roster snapshot needs completeness`);
                if (claim.claimType !== 'party.snapshot' && claim.completeness !== null) fail(`${row.caseId}: join/leave completeness must be null`);
            }
        }
    }
}

function validateCase(row, label) {
    const keys = ['caseId', 'scriptId', 'chatId', 'language', 'genre', 'partition', 'sourceMessages'];
    exactKeys(row, keys, label);
    for (const key of ['caseId', 'scriptId', 'chatId', 'language', 'genre']) if (!nonempty(row[key])) fail(`${label}: invalid ${key}`);
    if (!['smoke', 'calibration', 'holdout'].includes(row.partition) || !Array.isArray(row.sourceMessages)) fail(`${label}: invalid partition/sourceMessages`);
    let previous = -1;
    const entityKeys = new Set();
    for (const [mi, message] of row.sourceMessages.entries()) {
        exactKeys(message, ['messageIndex', 'text', 'goldSegments', 'goldEntities', 'goldRosterClaims'], `${label}.sourceMessages[${mi}]`);
        if (!Number.isSafeInteger(message.messageIndex) || message.messageIndex <= previous || typeof message.text !== 'string' || !message.text.length) fail(`${label}: invalid message index/text`);
        previous = message.messageIndex;
        const length = cpLength(message.text);
        if (!Array.isArray(message.goldSegments) || !message.goldSegments.length) fail(`${label}: goldSegments must be nonempty`);
        let cursor = 0;
        for (const segment of message.goldSegments) {
            exactKeys(segment, ['start', 'end', 'kind', 'goldSpeakerEntityKey'], `${label}.goldSegment`);
            if (!Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) || segment.start !== cursor || segment.end <= segment.start || segment.end > length) fail(`${label}: segments must exactly partition visible text`);
            if (!['dialogue', 'narration', 'unattributed'].includes(segment.kind)) fail(`${label}: unsupported gold segment kind`);
            if (segment.goldSpeakerEntityKey !== null && !nonempty(segment.goldSpeakerEntityKey)) fail(`${label}: invalid speaker key`);
            cursor = segment.end;
        }
        if (cursor !== length) fail(`${label}: gold segments do not cover the message`);
        if (!Array.isArray(message.goldEntities) || !Array.isArray(message.goldRosterClaims)) fail(`${label}: entity/claim arrays required`);
        for (const entity of message.goldEntities) {
            exactKeys(entity, ['entityKey', 'mentions'], `${label}.goldEntity`);
            if (!nonempty(entity.entityKey) || !Array.isArray(entity.mentions)) fail(`${label}: invalid gold entity`);
            entityKeys.add(entity.entityKey);
            for (const mention of entity.mentions) validateSpan(mention, length, `${label}.goldEntity.mention`);
        }
        for (const claim of message.goldRosterClaims) {
            exactKeys(claim, ['claimType', 'targetEntityKey', 'memberEntityKeys', 'completeness', 'evidenceSpans'], `${label}.goldRosterClaim`);
            if (!['party.join', 'party.leave', 'party.snapshot'].includes(claim.claimType) || !Array.isArray(claim.memberEntityKeys) || !Array.isArray(claim.evidenceSpans)) fail(`${label}: invalid roster claim`);
            if (claim.targetEntityKey !== null && !nonempty(claim.targetEntityKey)) fail(`${label}: invalid claim target`);
            for (const span of claim.evidenceSpans) validateSpan(span, length, `${label}.goldClaim.evidenceSpan`);
        }
    }
}

function exactKeys(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected object`);
    const a = Object.keys(value).sort(); const b = [...expected].sort();
    if (a.length !== b.length || a.some((key, i) => key !== b[i])) fail(`${label}: unexpected or missing fields`);
}
function validateSpan(span, length, label) {
    if (!span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > length) fail(`${label}: invalid span`);
}
function cpLength(text) { return Array.from(text).length; }
function nonempty(value) { return typeof value === 'string' && value.length > 0; }

function fakePredict(row) {
    const knownNames = new Map();
    for (const message of row.sourceMessages) {
        const explicit = explicitSpeaker(message.text);
        if (explicit) knownNames.set(explicit.name, explicit.entityKey);
    }
    const sourceMessages = row.sourceMessages.map((message) => {
        const explicit = explicitSpeaker(message.text);
        const speakerKey = explicit && knownNames.get(explicit.name);
        const isQuote = /^\s*[“「『"]/u.test(message.text);
        const isLabel = /^(?:chapter|contents|turn order|作战|順番|行动顺序|目次|第.+章)/iu.test(message.text);
        const kind = speakerKey ? 'dialogue' : isQuote ? 'unattributed' : 'narration';
        const identityRef = speakerKey ? `fake:${row.chatId}:${speakerKey}` : null;
        const length = cpLength(message.text);
        return {
            messageIndex: message.messageIndex,
            sourceMessageHash: HASH(message.text),
            segments: [{ start: 0, end: length, kind: isLabel ? 'narration' : kind, resolvedSpeakerRef: isLabel ? null : identityRef }],
            entityMentions: explicit ? [{ start: explicit.start, end: explicit.end, identityRef }] : [],
            rosterClaims: [],
        };
    });
    return {
        caseId: row.caseId,
        scriptId: row.scriptId,
        chatId: row.chatId,
        analyzerScope: 'fake-analyzer:deterministic-prefix-baseline.v1',
        ...VERSION,
        sourceMessages,
    };
}

function explicitSpeaker(text) {
    const match = /^([^:：]{1,32})[:：]\s*/u.exec(text);
    if (!match) return null;
    const name = match[1].trim();
    if (!name || name.length > 24) return null;
    return { name, start: 0, end: cpLength(name), entityKey: name.toLocaleLowerCase('und').replace(/\s+/gu, '-') };
}

async function generate(args) {
    if (!args.fake) fail('This runner currently supports isolated generation only with --fake; real service generation is supplied by a configured analyzer integration.');
    if (!args.corpus || !args['predictions-out']) fail('--generate requires --corpus and --predictions-out.');
    const { rows, corpusHash } = await readCorpus(args.corpus);
    const predictions = rows.map(fakePredict);
    const jsonl = `${predictions.map((row) => JSON.stringify(row)).join('\n')}\n`;
    const out = path.resolve(args['predictions-out']);
    await writeFile(out, jsonl, 'utf8');
    const manifest = {
        schemaVersion: 'galgame.presentation-prediction-manifest.v1',
        generationMode: 'fake',
        analyzerScope: 'fake-analyzer:deterministic-prefix-baseline.v1',
        ...VERSION,
        corpusHash,
        predictionHash: HASH(jsonl),
        caseCount: rows.length,
    };
    await writeFile(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ status: 'generated', cases: rows.length, corpusHash, predictionHash: manifest.predictionHash, mode: 'fake-deterministic' }, null, 2));
}

async function score(args) {
    if (!args.corpus || !args.predictions) fail('--score requires --corpus and --predictions.');
    const { rows, corpusHash } = await readCorpus(args.corpus);
    const bootstrapIterations = Number(args.bootstrap ?? 2000);
    const bootstrapSeed = Number(args.seed ?? 20261002);
    if (!Number.isSafeInteger(bootstrapIterations) || bootstrapIterations < 1 || bootstrapIterations > 100000
        || !Number.isSafeInteger(bootstrapSeed) || bootstrapSeed < 0) fail('--bootstrap must be 1..100000 and --seed must be a nonnegative safe integer.');
    const file = path.resolve(args.predictions);
    const raw = await readFile(file, 'utf8');
    const manifest = JSON.parse(await readFile(`${file}.manifest.json`, 'utf8'));
    if (manifest.schemaVersion !== 'galgame.presentation-prediction-manifest.v1' || manifest.corpusHash !== corpusHash || manifest.predictionHash !== HASH(raw)) fail('Prediction manifest does not match corpus or prediction artifact.');
    for (const [key, expected] of Object.entries(VERSION)) if (manifest[key] !== expected) fail(`Prediction manifest version mismatch: ${key}`);
    const predictions = raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
    if (manifest.caseCount !== predictions.length) fail('Prediction manifest caseCount does not match artifact row count.');
    const predictionByCase = new Map();
    for (const prediction of predictions) {
        exactKeys(prediction, ['caseId', 'scriptId', 'chatId', 'analyzerScope', ...Object.keys(VERSION), 'sourceMessages'], 'prediction');
        if (predictionByCase.has(prediction.caseId)) fail(`Duplicate predicted caseId: ${prediction.caseId}`);
        predictionByCase.set(prediction.caseId, prediction);
    }
    const known = new Set(rows.map((row) => row.caseId));
    for (const id of predictionByCase.keys()) if (!known.has(id)) fail(`Unexpected prediction caseId: ${id}`);
    for (const p of predictionByCase.values()) {
        const gold = rows.find((row) => row.caseId === p.caseId);
        if (p.scriptId !== gold.scriptId || p.chatId !== gold.chatId || p.analyzerScope !== manifest.analyzerScope) fail(`Prediction identity/scope mismatch: ${p.caseId}`);
        for (const [key, expected] of Object.entries(VERSION)) if (p[key] !== expected) fail(`Prediction version mismatch: ${key}`);
        validatePredictionMessages(p, gold);
    }
    const metrics = scoreRows(rows, predictionByCase, bootstrapIterations, bootstrapSeed);
    const report = {
        schemaVersion: 'galgame.presentation-golden-score.v1',
        corpusHash,
        predictionHash: manifest.predictionHash,
        analyzerScope: manifest.analyzerScope,
        ...VERSION,
        coverage: { cases: predictionByCase.size, expectedCases: rows.length, messages: [...predictionByCase.values()].reduce((n, p) => n + p.sourceMessages.length, 0), expectedMessages: rows.reduce((n, row) => n + row.sourceMessages.length, 0) },
        metrics,
        productionGateEligible: false,
        note: 'Synthetic smoke corpus and fake analyzer output are for contract/regression checks only; this report cannot authorize assisted production mode.',
    };
    console.log(JSON.stringify(report, null, 2));
    if (args['report-out']) await writeFile(path.resolve(args['report-out']), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function validatePredictionMessages(prediction, gold) {
    if (!Array.isArray(prediction.sourceMessages)) fail(`sourceMessages missing: ${gold.caseId}`);
    const expected = new Map(gold.sourceMessages.map((m) => [m.messageIndex, m]));
    const got = new Set();
    for (const message of prediction.sourceMessages) {
        exactKeys(message, ['messageIndex', 'sourceMessageHash', 'segments', 'entityMentions', 'rosterClaims'], `${gold.caseId}.predictionMessage`);
        if (got.has(message.messageIndex) || !expected.has(message.messageIndex)) fail(`Duplicate/extra prediction message: ${gold.caseId}/${message.messageIndex}`);
        got.add(message.messageIndex);
        const source = expected.get(message.messageIndex);
        if (message.sourceMessageHash !== HASH(source.text)) fail(`Source hash mismatch: ${gold.caseId}/${message.messageIndex}`);
        const length = cpLength(source.text);
        if (!Array.isArray(message.segments) || !Array.isArray(message.entityMentions) || !Array.isArray(message.rosterClaims)) fail(`Prediction arrays missing: ${gold.caseId}`);
        let cursor = 0;
        for (const segment of message.segments) {
            exactKeys(segment, ['start', 'end', 'kind', 'resolvedSpeakerRef'], 'predictedSegment');
            if (!Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) || segment.start !== cursor || segment.end <= segment.start || segment.end > length || !['dialogue', 'narration', 'unattributed'].includes(segment.kind)) fail(`Invalid prediction segment: ${gold.caseId}`);
            if (segment.resolvedSpeakerRef !== null && !nonempty(segment.resolvedSpeakerRef)) fail(`Invalid speaker reference: ${gold.caseId}`);
            cursor = segment.end;
        }
        if (message.segments.length && cursor !== length) fail(`Prediction segments do not cover source: ${gold.caseId}`);
        for (const mention of message.entityMentions) {
            exactKeys(mention, ['start', 'end', 'identityRef'], 'predictedMention');
            validateSpan(mention, length, 'predictedMention');
            if (!nonempty(mention.identityRef)) fail(`Missing identityRef: ${gold.caseId}`);
        }
        for (const claim of message.rosterClaims) {
            exactKeys(claim, ['claimType', 'targetIdentityRef', 'memberIdentityRefs', 'completeness', 'evidenceSpans'], 'predictedRosterClaim');
            if (!Array.isArray(claim.memberIdentityRefs) || !Array.isArray(claim.evidenceSpans)) fail(`Invalid predicted roster claim: ${gold.caseId}`);
            for (const span of claim.evidenceSpans) validateSpan(span, length, 'predictedEvidenceSpan');
        }
    }
}

function scoreRows(rows, predictions, bootstrapIterations, bootstrapSeed) {
    const confusion = { dialogue: { dialogue: 0, narration: 0, unattributed: 0, missing: 0 }, narration: { dialogue: 0, narration: 0, unattributed: 0, missing: 0 }, unattributed: { dialogue: 0, narration: 0, unattributed: 0, missing: 0 } };
    let dialogueGold = 0; let dialogueTrue = 0; let dialoguePred = 0;
    let narrationGold = 0; let narrationFalseSpeaker = 0; let dialogueFalseNarration = 0;
    let covered = 0; let goldChars = 0; let rosterGold = 0; let rosterCorrect = 0; let unsupportedRoster = 0;
    let entityGold = 0; let entityMatched = 0; let identitySplitErrors = 0; let identityMergeErrors = 0;
    const goldIdentityToPredicted = new Map(); const predictedIdentityToGold = new Map();
    const perScript = new Map();
    for (const row of rows) {
        const pCase = predictions.get(row.caseId);
        const script = perScript.get(row.scriptId) || { dialogueGold: 0, dialogueTrue: 0, dialoguePred: 0, narrationGold: 0, narrationFalseSpeaker: 0, dialogueFalseNarration: 0, covered: 0, chars: 0 };
        for (const goldMessage of row.sourceMessages) {
            const predMessage = pCase?.sourceMessages.find((item) => item.messageIndex === goldMessage.messageIndex);
            const predSegments = predMessage?.segments || [];
            for (const gs of goldMessage.goldSegments) {
                const pred = predSegments.find((ps) => ps.start === gs.start && ps.end === gs.end);
                const pk = pred?.kind || 'missing';
                confusion[gs.kind][pk]++;
                if (pred?.resolvedSpeakerRef) { dialoguePred++; script.dialoguePred++; }
                const chars = gs.end - gs.start; goldChars += chars; script.chars += chars;
                if (pred) { covered += chars; script.covered += chars; }
                if (gs.kind === 'dialogue') {
                    dialogueGold++; script.dialogueGold++;
                    if (gs.goldSpeakerEntityKey !== null && pred?.resolvedSpeakerRef) { dialogueTrue++; script.dialogueTrue++; }
                    if (pk === 'narration') { dialogueFalseNarration++; script.dialogueFalseNarration++; }
                } else if (gs.kind === 'narration') {
                    narrationGold++; script.narrationGold++;
                    if (pk === 'dialogue' || pred?.resolvedSpeakerRef) { narrationFalseSpeaker++; script.narrationFalseSpeaker++; }
                }
            }
            const gEntities = goldMessage.goldEntities.flatMap((e) => e.mentions.map((m) => ({ entityKey: e.entityKey, ...m })));
            entityGold += gEntities.length;
            for (const gm of gEntities) {
                const matched = predMessage?.entityMentions.find((pm) => pm.start === gm.start && pm.end === gm.end);
                if (!matched) { identitySplitErrors++; continue; }
                entityMatched++;
                const predictedKey = `${row.chatId}:${matched.identityRef}`;
                const goldKey = `${row.chatId}:${gm.entityKey}`;
                const predictedRefs = goldIdentityToPredicted.get(goldKey) || new Set(); predictedRefs.add(predictedKey); goldIdentityToPredicted.set(goldKey, predictedRefs);
                const goldKeys = predictedIdentityToGold.get(predictedKey) || new Set(); goldKeys.add(goldKey); predictedIdentityToGold.set(predictedKey, goldKeys);
            }
            const gClaims = goldMessage.goldRosterClaims;
            rosterGold += gClaims.length;
            rosterCorrect += gClaims.filter((claim) => predMessage?.rosterClaims.some((pc) => rosterClaimMatches(pc, claim, goldMessage, predMessage))).length;
            unsupportedRoster += predMessage?.rosterClaims.filter((pc) => !gClaims.some((claim) => claim.claimType === pc.claimType && claim.evidenceSpans.some((span) => pc.evidenceSpans.some((predSpan) => predSpan.start === span.start && predSpan.end === span.end)))).length || 0;
        }
        perScript.set(row.scriptId, script);
    }
    identitySplitErrors += [...goldIdentityToPredicted.values()].filter((refs) => refs.size > 1).reduce((sum, refs) => sum + refs.size - 1, 0);
    identityMergeErrors = [...predictedIdentityToGold.values()].filter((keys) => keys.size > 1).reduce((sum, keys) => sum + keys.size - 1, 0);
    const precision = ratio(dialogueTrue, dialoguePred); const recall = ratio(dialogueTrue, dialogueGold);
    const ci = bootstrapByScript([...perScript.values()], bootstrapIterations, bootstrapSeed);
    return {
        confusionMatrix: confusion,
        speakerPrecision: { estimate: precision, ciLower: ci.precision[0], ciUpper: ci.precision[1] },
        speakerRecall: { estimate: recall, ciLower: ci.recall[0], ciUpper: ci.recall[1] },
        narrationFalseSpeakerRate: ratio(narrationFalseSpeaker, narrationGold),
        dialogueFalseNarrationRate: ratio(dialogueFalseNarration, dialogueGold),
        spanCoverage: ratio(covered, goldChars),
        identityMentionMatchRate: ratio(entityMatched, entityGold),
        identityMergeErrors,
        identitySplitErrors,
        rosterEventAccuracy: ratio(rosterCorrect, rosterGold),
        unsupportedRosterUpdateCount: unsupportedRoster,
        bootstrap: { method: 'script-stratified', iterations: ci.iterations, seed: bootstrapSeed, confidenceLevel: 0.95, scriptCount: perScript.size },
    };
}

function rosterClaimMatches(predicted, gold, goldMessage, predictionMessage) {
    if (predicted.claimType !== gold.claimType) return false;
    if (!predicted.evidenceSpans.some((span) => gold.evidenceSpans.some((goldSpan) => span.start === goldSpan.start && span.end === goldSpan.end))) return false;
    const predictedMentionFor = (entityKey) => {
        const entity = goldMessage.goldEntities.find((item) => item.entityKey === entityKey);
        if (!entity) return null;
        for (const mention of entity.mentions) {
            const match = predictionMessage.entityMentions.find((item) => item.start === mention.start && item.end === mention.end);
            if (match) return match.identityRef;
        }
        return null;
    };
    if (gold.claimType === 'party.join' || gold.claimType === 'party.leave') {
        return predicted.targetIdentityRef === predictedMentionFor(gold.targetEntityKey);
    }
    const expectedMembers = gold.memberEntityKeys.map(predictedMentionFor).filter(Boolean).sort();
    const actualMembers = [...predicted.memberIdentityRefs].sort();
    return predicted.completeness === gold.completeness
        && expectedMembers.length === gold.memberEntityKeys.length
        && actualMembers.length === expectedMembers.length
        && actualMembers.every((value, index) => value === expectedMembers[index]);
}

function ratio(a, b) { return b ? a / b : 0; }
function bootstrapByScript(items, iterations, seed) {
    let state = seed >>> 0;
    const random = () => { state = (1664525 * state + 1013904223) >>> 0; return state / 0x100000000; };
    const p = []; const r = [];
    for (let i = 0; i < iterations; i++) {
        const sample = Array.from({ length: items.length }, () => items[Math.floor(random() * items.length)]);
        const sums = sample.reduce((acc, x) => { acc.true += x.dialogueTrue; acc.pred += x.dialoguePred; acc.gold += x.dialogueGold; return acc; }, { true: 0, pred: 0, gold: 0 });
        p.push(ratio(sums.true, sums.pred)); r.push(ratio(sums.true, sums.gold));
    }
    const interval = (values) => [quantile(values, 0.025), quantile(values, 0.975)];
    return { precision: interval(p), recall: interval(r), iterations };
}
function quantile(values, q) { const ordered = [...values].sort((a, b) => a - b); return ordered[Math.floor((ordered.length - 1) * q)] ?? 0; }

try {
    const args = parseArgs(process.argv.slice(2));
    if (args.generate) await generate(args);
    else await score(args);
} catch (error) {
    console.error(`presentation-golden-runner: ${error.message}`);
    process.exitCode = 1;
}
