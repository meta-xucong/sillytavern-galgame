import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
    ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
    createDefaultAdaptivePresentationProfile,
    validateAdaptiveExtractionResult,
    validateAdaptivePresentationProfile,
} from '../src/adaptive-presentation-schema.js';
import {
    extractAdaptivePresentation,
    extractAdaptivePresentationFromText,
} from '../src/adaptive-presentation.js';

const fixtureRoot = new URL('./fixtures/adaptive-presentation/', import.meta.url);

const rpgProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'test-rpg',
    template: 'rpg-adventure',
});
const romanceProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'test-romance',
    template: 'romance-social',
});
const mysteryProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'test-mystery',
    template: 'mystery-investigation',
});
const managementProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'test-management',
    template: 'management-sim',
});

assert.equal(validateAdaptivePresentationProfile(rpgProfile).valid, true);
assert.equal(validateAdaptivePresentationProfile({
    schemaVersion: ADAPTIVE_PRESENTATION_PROTOCOL_VERSION,
    profileId: 'events-and-suspects',
    template: 'mystery-investigation',
    preferredModules: ['events', 'suspects'],
    disabledModules: [],
    extractionPolicy: { confidenceThreshold: 0.75 },
    adminPatterns: [],
    visualPriority: { primaryPanel: 'suspects', secondaryPanels: ['events'] },
}).valid, true);

const forbiddenProfile = JSON.parse(await readFixture('forbidden-parallel-state.json'));
const forbiddenProfileValidation = validateAdaptivePresentationProfile(forbiddenProfile);
assert.equal(forbiddenProfileValidation.valid, false);
assert.equal(forbiddenProfileValidation.errors.some((error) => error.includes('profile.hp')), true);
assert.equal(forbiddenProfileValidation.errors.some((error) => error.includes('profile.inventory')), true);
assert.equal(forbiddenProfileValidation.errors.some((error) => error.includes('profile.route')), true);

const plain = extractAdaptivePresentationFromText(await readFixture('plain-visual-novel.txt'));
assert.deepEqual(plain.moduleIds, []);

const dungeon = extractAdaptivePresentation(await readFixture('dungeon-master-rpg.txt'), {
    profile: rpgProfile,
    chatId: 'rpg-chat',
    messageIndex: 2,
});
assertModules(dungeon, ['actions', 'rpg-status', 'inventory', 'abilities']);
const dungeonStatus = findModule(dungeon, 'rpg-status');
assert.equal(dungeonStatus.evidenceSource.kind, 'visible-chat-message');
assert.equal(dungeonStatus.evidenceSource.chatId, 'rpg-chat');
assert.equal(dungeonStatus.values.fields.hp.current, 12);
assert.equal(dungeonStatus.values.fields.hp.max, 12);
assert.equal(dungeonStatus.values.fields.ac.value, 15);
assert.equal(findModule(dungeon, 'inventory').values.items.some((item) => item.label === 'rope'), true);
assert.equal(findModule(dungeon, 'actions').values.actions.length, 3);

const polishedStatus = extractAdaptivePresentation(await readFixture('dnd-status-panel-polish.txt'), {
    profile: rpgProfile,
    chatId: 'dnd-polish-chat',
    messageIndex: 8,
});
assertModules(polishedStatus, ['rpg-status', 'inventory', 'abilities']);
const polishedInventory = findModule(polishedStatus, 'inventory');
assert.equal(polishedInventory.values.items.some((item) => item.label === 'Explorer\'s pack' && item.category === 'containers'), true);
const rustyDagger = polishedInventory.values.items.find((item) => item.label === '生锈短刀');
assert.ok(rustyDagger, 'rusty dagger should be a single merged item');
assert.equal(rustyDagger.category, 'weapons');
assert.equal(rustyDagger.traits.includes('轻型'), true);
assert.equal(rustyDagger.traits.includes('投掷20/60'), true);
assert.equal(rustyDagger.traits.includes('品质低劣'), true);
assert.equal(polishedInventory.values.items.some((item) => item.label === '轻型'), false);
assert.equal(polishedInventory.values.groups.some((group) => group.id === 'weapons'), true);
assert.equal(polishedInventory.values.groups.some((group) => group.id === 'containers'), true);
const polishedStatusPanel = findModule(polishedStatus, 'rpg-status');
assert.equal(polishedStatusPanel.values.groups.some((group) => group.id === 'party' && group.items.length === 2), true);
assert.equal(polishedStatusPanel.values.groups.some((group) => group.id === 'threats'), true);
assert.equal(polishedStatusPanel.values.groups.some((group) => group.id === 'clues'), true);
const polishedAbilities = findModule(polishedStatus, 'abilities');
assert.equal(polishedAbilities.values.abilities.some((item) => item.name === '潜行' && item.value === '+4'), true);
assert.equal(polishedAbilities.values.abilities.some((item) => item.name === '察觉' && item.value === '+3'), true);
assert.equal(polishedAbilities.values.abilities.some((item) => item.name === '游说' && item.value === '+2'), true);
assert.equal(polishedAbilities.values.groups.some((group) => group.title === '探索'), true);
assert.equal(polishedAbilities.values.groups.some((group) => group.title === '社交'), true);

const visibleEquipment = extractAdaptivePresentation(await readFixture('dnd-visible-equipment-attacks.txt'), {
    profile: rpgProfile,
    chatId: 'visible-equipment-chat',
    messageIndex: 4,
});
assertModules(visibleEquipment, ['rpg-status', 'inventory']);
const visibleEquipmentInventory = findModule(visibleEquipment, 'inventory');
const visibleEquipmentItems = visibleEquipmentInventory.values.items;
const visibleWeapons = visibleEquipmentItems.filter((item) => item.category === 'weapons');
assert.ok(visibleWeapons.length >= 3, 'visible equipment fixture should expose at least three independent weapons');
const visibleWeaponsWithTraits = visibleWeapons.filter((item) => item.traits.length > 0);
assert.ok(visibleWeaponsWithTraits.length >= 2, 'at least two visible weapons should keep visible traits');
const visibleGreatsword = visibleWeapons.find((item) => item.label === 'Greatsword');
assert.ok(visibleGreatsword, 'Equipment and Attacks should merge Greatsword into one weapon');
assert.equal(visibleGreatsword.traits.includes('2d6 slashing damage'), true);
assert.equal(visibleGreatsword.raw.includes('Greatsword\nGreatsword: 2d6 slashing damage'), true);
const visibleLongbow = visibleWeapons.find((item) => item.label === 'Longbow');
assert.ok(visibleLongbow, 'Longbow attack line should be parsed as a weapon');
assert.equal(visibleLongbow.traits.includes('1d8 piercing damage'), true);
assert.equal(visibleLongbow.traits.includes('range 150/600'), true);
const visibleRustyShortsword = visibleWeapons.find((item) => item.label === 'Rusty shortsword');
assert.ok(visibleRustyShortsword, 'Weapons/shield section should parse Rusty shortsword');
assert.equal(visibleRustyShortsword.traits.includes('1d4 piercing damage'), true);
assert.equal(visibleRustyShortsword.traits.includes('light'), true);
assert.equal(visibleRustyShortsword.traits.includes('thrown 20/60'), true);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'Explorer\'s pack' && item.category === 'containers'), true);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'Backpack' && item.category === 'containers'), true);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'light' && item.category === 'weapons'), false);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'thrown 30/90' && item.category === 'weapons'), false);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'light' && item.category === 'uncategorized'), true);
assert.equal(visibleEquipmentItems.some((item) => item.label === 'thrown 30/90' && item.category === 'uncategorized'), true);
const visibleDagger = visibleWeapons.find((item) => item.label === 'Dagger');
assert.ok(visibleDagger, 'Dagger without visible stats should still be retained as a visible weapon');
assert.deepEqual(visibleDagger.traits, []);
const scaleMail = visibleEquipmentItems.find((item) => item.label === 'Scale mail armor');
assert.ok(scaleMail, 'Scale mail armor should be retained as visible equipment text');
assert.equal(scaleMail.category, 'miscellaneous');
const visibleEquipmentStatus = findModule(visibleEquipment, 'rpg-status');
assert.equal(visibleEquipmentStatus.values.fields.ac.value, 15);
assert.equal(visibleEquipmentStatus.values.fields.ac.raw.includes('15'), true);
assert.equal(visibleEquipmentStatus.values.fields.ac.raw.includes('14'), false);
assert.equal(visibleEquipmentItems.some((item) => item.raw.includes('Unknown broken gear shard')), true);

const naturalWeaponMention = extractAdaptivePresentationFromText('Andrei notices a sword-shaped shadow in the rain. Someone whispers about 1d8 piercing wounds, but no equipment list is shown.', {
    profile: rpgProfile,
});
assert.equal(naturalWeaponMention.moduleIds.includes('inventory'), false);

const romance = extractAdaptivePresentation(await readFixture('romance-affection.txt'), {
    profile: romanceProfile,
});
assertModules(romance, ['actions', 'relationships', 'affection', 'gifts', 'events', 'calendar']);
assert.equal(findModule(romance, 'affection').values.affection[0].name, 'Anna');
assert.equal(findModule(romance, 'affection').values.affection[0].value, 62);
assert.equal(findModule(romance, 'relationships').values.relationships[0].value, '信任正在上升');
assert.equal(findModule(romance, 'events').values.events[0].label, '夏祭约定');

const mystery = extractAdaptivePresentation(await readFixture('mystery-clues.txt'), {
    profile: mysteryProfile,
});
assertModules(mystery, ['locations', 'clues', 'suspects', 'objectives']);
assert.equal(findModule(mystery, 'clues').values.clues.length, 2);
assert.equal(findModule(mystery, 'suspects').values.suspects[0].name, '园田');

const management = extractAdaptivePresentation(await readFixture('management-resources.txt'), {
    profile: managementProfile,
});
assertModules(management, ['resources', 'calendar', 'objectives']);
assert.equal(findModule(management, 'resources').values.resources.some((resource) => resource.name === '粮食'), true);
assert.equal(findModule(management, 'resources').values.resources.some((resource) => resource.name === '人口'), true);

const ambiguous = extractAdaptivePresentation(await readFixture('ambiguous-natural-language.txt'), {
    profile: romanceProfile,
});
assert.deepEqual(ambiguous.moduleIds, []);

const disabledInventory = extractAdaptivePresentation(await readFixture('dungeon-master-rpg.txt'), {
    profile: createDefaultAdaptivePresentationProfile({
        profileId: 'no-inventory',
        template: 'rpg-adventure',
        disabledModules: ['inventory'],
    }),
});
assert.equal(disabledInventory.moduleIds.includes('inventory'), false);
assert.equal(disabledInventory.moduleIds.includes('rpg-status'), true);

const adminPatternProfile = createDefaultAdaptivePresentationProfile({
    profileId: 'admin-pattern-profile',
    template: 'mystery-investigation',
    adminPatterns: [{
        id: 'secret-clue',
        module: 'clues',
        source: 'visible-chat-text',
        patternKind: 'regex',
        pattern: '^秘密线索：(.+)$',
        fields: ['label'],
        confidence: 0.93,
    }],
});
assert.equal(validateAdaptivePresentationProfile(adminPatternProfile).valid, true);
const adminPatternResult = extractAdaptivePresentationFromText('秘密线索：门锁没有被撬开', {
    profile: adminPatternProfile,
});
const adminClue = findModule(adminPatternResult, 'clues');
assert.equal(adminClue.evidenceSource.kind, 'visible-chat-message');
assert.equal(adminClue.configurationSource.kind, 'admin-profile');
assert.equal(adminClue.values.matches[0].fields.label, '门锁没有被撬开');

const invalidAdminSourceResult = validateAdaptiveExtractionResult({
    schemaVersion: 'galgame.presentation-extraction-result.v1',
    module: 'rpg-status',
    confidence: 0.9,
    evidenceSource: { kind: 'admin-profile' },
    values: { fields: { hp: { current: 12, max: 12 } } },
    displayOnly: true,
});
assert.equal(invalidAdminSourceResult.valid, false);
assert.equal(invalidAdminSourceResult.errors.some((error) => error.includes('visible-chat-message')), true);

console.log('adaptive presentation tests passed');

async function readFixture(fileName) {
    return readFile(new URL(fileName, fixtureRoot), 'utf8');
}

function assertModules(result, expected) {
    for (const moduleId of expected) {
        assert.equal(result.moduleIds.includes(moduleId), true, `${moduleId} missing from ${result.moduleIds.join(', ')}`);
    }
}

function findModule(result, moduleId) {
    const found = result.results.find((item) => item.module === moduleId);
    assert.ok(found, `${moduleId} was not extracted`);
    assert.equal(validateAdaptiveExtractionResult(found).valid, true, `${moduleId} result failed schema validation`);
    return found;
}
