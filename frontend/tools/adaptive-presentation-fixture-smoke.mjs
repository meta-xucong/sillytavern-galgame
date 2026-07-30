import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { extractAdaptivePresentation } from '../shared/src/adaptive-presentation.js';
import { createDefaultAdaptivePresentationProfile } from '../shared/src/adaptive-presentation-schema.js';

const args = parseArgs(process.argv.slice(2));
const fixturePath = args.fixture || '';
const expectedModules = parseExpected(args.expect || '');
const template = args.template || inferTemplate(expectedModules);

if (!fixturePath) {
    console.error('Missing --fixture path.');
    process.exit(2);
}

const text = await readFile(path.resolve(fixturePath), 'utf8');
const profile = createDefaultAdaptivePresentationProfile({
    profileId: `fixture-${template}`,
    template,
});
const result = extractAdaptivePresentation(text, {
    profile,
    chatId: path.basename(fixturePath),
    messageIndex: 0,
});
const moduleIds = result.moduleIds.slice().sort();
const failures = [];

if (expectedModules.length === 1 && expectedModules[0] === 'none') {
    if (moduleIds.length) {
        failures.push(`Expected no modules, got: ${moduleIds.join(', ')}`);
    }
} else {
    for (const moduleId of expectedModules) {
        if (!moduleIds.includes(moduleId)) {
            failures.push(`Missing expected module: ${moduleId}`);
        }
    }
}

const output = {
    ok: failures.length === 0,
    fixture: path.resolve(fixturePath),
    template,
    expectedModules,
    moduleIds,
    resultCount: result.results.length,
    failures,
};

console.log(JSON.stringify(output, null, 2));
process.exitCode = output.ok ? 0 : 1;

function parseArgs(argv) {
    const parsed = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith('--')) {
            continue;
        }
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
        } else {
            parsed[key] = next;
            index += 1;
        }
    }
    return parsed;
}

function parseExpected(value) {
    const items = String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    return items.length ? items : ['none'];
}

function inferTemplate(expected) {
    const expectedSet = new Set(expected);
    if (expectedSet.has('rpg-status') || expectedSet.has('inventory') || expectedSet.has('dice')) {
        return 'rpg-adventure';
    }
    if (expectedSet.has('affection') || expectedSet.has('relationships') || expectedSet.has('gifts')) {
        return 'romance-social';
    }
    if (expectedSet.has('clues') || expectedSet.has('suspects')) {
        return 'mystery-investigation';
    }
    if (expectedSet.has('resources') || expectedSet.has('factions')) {
        return 'management-sim';
    }
    return 'visual-novel';
}
