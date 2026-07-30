import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createDefaultAdaptivePresentationProfile } from '../../shared/src/adaptive-presentation-schema.js';
import { extractAdaptivePresentation } from '../../shared/src/adaptive-presentation.js';

globalThis.__GALGAME_PLAYER_TEST_DISABLE_BOOTSTRAP__ = true;
globalThis.window = {
    location: { origin: 'http://127.0.0.1:8001' },
    setTimeout,
    clearTimeout,
};
const noop = () => {};
const stubElement = {
    addEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    classList: { add: noop, remove: noop, toggle: noop },
    style: { setProperty: noop },
    replaceChildren: noop,
    append: noop,
    focus: noop,
    setAttribute: noop,
};
globalThis.document = {
    querySelector: () => stubElement,
    querySelectorAll: () => [],
    addEventListener: noop,
    body: { classList: { add: noop, remove: noop } },
};

const playerModule = await import('../src/main.js');
const fixtureRoot = new URL('../../shared/tests/fixtures/adaptive-presentation/', import.meta.url);

const matrixCases = [
    {
        template: 'visual-novel',
        fixture: 'visual-novel-events.txt',
        missingFixture: 'visual-novel-missing-fields.txt',
        preferredModules: ['actions', 'events', 'relationships', 'locations', 'objectives'],
        expectedPrimary: 'events',
        expectedOrder: ['events', 'relationships', 'locations', 'objectives'],
    },
    {
        template: 'rpg-adventure',
        fixture: 'dungeon-master-rpg.txt',
        missingFixture: 'rpg-adventure-missing-fields.txt',
        expectedPrimary: 'rpg-status',
        expectedOrder: ['rpg-status', 'inventory', 'abilities'],
    },
    {
        template: 'romance-social',
        fixture: 'romance-affection.txt',
        missingFixture: 'romance-social-missing-fields.txt',
        expectedPrimary: 'affection',
        expectedOrder: ['affection', 'relationships', 'gifts', 'calendar', 'events'],
    },
    {
        template: 'mystery-investigation',
        fixture: 'mystery-clues.txt',
        missingFixture: 'mystery-investigation-missing-fields.txt',
        expectedPrimary: 'clues',
        expectedOrder: ['clues', 'suspects', 'locations', 'objectives'],
    },
    {
        template: 'management-sim',
        fixture: 'management-resources.txt',
        missingFixture: 'management-sim-missing-fields.txt',
        expectedPrimary: 'resources',
        expectedOrder: ['resources', 'objectives', 'calendar'],
    },
    {
        template: 'sandbox-roleplay',
        fixture: 'sandbox-roleplay.txt',
        missingFixture: 'sandbox-roleplay-missing-fields.txt',
        expectedPrimary: 'locations',
        expectedOrder: ['locations', 'relationships', 'factions', 'objectives', 'events'],
    },
];

for (const item of matrixCases) {
    const profile = createDefaultAdaptivePresentationProfile({
        profileId: `profile-${item.template}`,
        template: item.template,
        preferredModules: item.preferredModules,
    });
    const text = await readFixture(item.fixture);
    const extraction = extractAdaptivePresentation(text, {
        profile,
        chatId: `${item.template}-chat`,
        messageIndex: 1,
    });
    const results = extraction.results
        .filter((result) => result.module !== 'actions')
        .filter((result) => result.displayOnly === true)
        .sort((left, right) => playerModule.compareAdaptivePanelResults(left, right, profile));
    const modules = results.map((result) => result.module);
    assert.equal(playerModule.getAdaptiveTemplateId(profile), item.template);
    assert.equal(playerModule.getAdaptivePrimaryModule(results, profile), item.expectedPrimary, `${item.template} primary module`);
    for (const expectedModule of item.expectedOrder) {
        assert.equal(modules.includes(expectedModule), true, `${item.template} missing ${expectedModule}`);
    }
    assert.deepEqual(modules.slice(0, item.expectedOrder.length), item.expectedOrder, `${item.template} homepage order`);
    assert.equal(results.every((result) => result.evidenceSource.kind === 'visible-chat-message'), true);
    assert.equal(results.every((result) => result.displayOnly === true), true);
    const renderSummary = playerModule.summarizeAdaptiveTemplateRender(extraction.results, profile);
    assert.equal(renderSummary.template, item.template);
    assert.equal(renderSummary.beltClass.includes(`template-${item.template}`), true);
    assert.equal(renderSummary.empty, false);
    assert.equal(renderSummary.primaryModule, item.expectedPrimary);
    assert.deepEqual(renderSummary.moduleOrder.slice(0, item.expectedOrder.length), item.expectedOrder);

    const missing = extractAdaptivePresentation(await readFixture(item.missingFixture), {
        profile,
        chatId: `${item.template}-missing-chat`,
        messageIndex: 2,
    });
    const missingSummary = playerModule.summarizeAdaptiveTemplateRender(missing.results, profile);
    assert.deepEqual(missing.moduleIds, [], `${item.template} missing fixture must not create display facts`);
    assert.equal(missingSummary.template, item.template);
    assert.equal(missingSummary.empty, true, `${item.template} missing fixture must render empty state`);
    assert.equal(missingSummary.primaryModule, '');
}

for (const item of matrixCases) {
    const ambiguousProfile = createDefaultAdaptivePresentationProfile({
        profileId: `profile-ambiguous-${item.template}`,
        template: item.template,
        preferredModules: item.preferredModules,
    });
    const ambiguous = extractAdaptivePresentation(await readFixture('template-missing-fields.txt'), {
        profile: ambiguousProfile,
    });
    const ambiguousSummary = playerModule.summarizeAdaptiveTemplateRender(ambiguous.results, ambiguousProfile);
    assert.deepEqual(ambiguous.moduleIds, [], `${item.template} ambiguous text must not create display facts`);
    assert.equal(ambiguousSummary.empty, true, `${item.template} ambiguous text must render empty state`);
}

const visualPriorityProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'profile-visual-priority',
    template: 'rpg-adventure',
    visualPriority: {
        primaryPanel: 'inventory',
        secondaryPanels: ['abilities', 'rpg-status'],
        collapseBelowWidth: 640,
    },
});
const visualPriorityResults = extractAdaptivePresentation(await readFixture('dungeon-master-rpg.txt'), {
    profile: visualPriorityProfile,
}).results
    .filter((result) => result.module !== 'actions')
    .sort((left, right) => playerModule.compareAdaptivePanelResults(left, right, visualPriorityProfile));
assert.equal(playerModule.getAdaptivePrimaryModule(visualPriorityResults, visualPriorityProfile), 'inventory');
assert.deepEqual(visualPriorityResults.map((result) => result.module).slice(0, 3), ['inventory', 'abilities', 'rpg-status']);

const unknownModuleProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'profile-unknown-module-preserved',
    template: 'visual-novel',
    preferredModules: ['actions', 'notes'],
});
const unknownModuleSummary = playerModule.summarizeAdaptiveTemplateRender([
    { module: 'notes', displayOnly: true },
    { module: 'custom-visible-module', displayOnly: true },
], unknownModuleProfile);
assert.deepEqual(unknownModuleSummary.moduleOrder, ['notes', 'custom-visible-module']);
assert.deepEqual(unknownModuleSummary.unknownModules, ['custom-visible-module']);

console.log('player presentation template matrix tests passed');

async function readFixture(fileName) {
    return readFile(new URL(fileName, fixtureRoot), 'utf8');
}
