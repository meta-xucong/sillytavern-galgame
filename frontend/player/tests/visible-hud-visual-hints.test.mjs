import assert from 'node:assert/strict';
import { createDefaultAdaptivePresentationProfile } from '../../shared/src/adaptive-presentation-schema.js';
import { createVisibleHudVisualHints } from '../src/visible-hud-visual-hints.js';

const profile = createDefaultAdaptivePresentationProfile();
const text = [
    '装备：银盾',
    '装备：铁剑',
    '道具：药水',
    '道具：钥匙',
    '技能：守护',
    '技能：盾击',
].join('\n');
const snapshot = {
    fileName: 'hud-branch.json',
    messages: [{ role: 'character', speaker: '莉拉', text }],
};

const currentHints = await createVisibleHudVisualHints(snapshot, 0, profile);
const repeatedCurrentHints = await createVisibleHudVisualHints(snapshot, 0, profile);
assert.deepEqual(repeatedCurrentHints.map((hint) => hint.entityKeySeed), currentHints.map((hint) => hint.entityKeySeed),
    'the same branch evidence produces stable opaque entity key seeds');
assert.deepEqual(new Set(currentHints.map((hint) => hint.entityType)), new Set(['equipment', 'item', 'skill']));
for (const [type, labels, code] of [
    ['equipment', ['银盾', '铁剑'], 'equipment-visible-label'],
    ['item', ['药水', '钥匙'], 'item-visible-label'],
    ['skill', ['守护', '盾击'], 'skill-visible-label'],
]) {
    const entities = currentHints.filter((hint) => hint.entityType === type);
    assert.deepEqual(entities.map((hint) => hint.visibleAttributes[0].value), labels);
    assert.equal(entities.every((hint) => hint.visibleAttributes.length === 1
        && hint.visibleAttributes[0].code === code
        && hint.visibleAttributes[0].confidenceBand === 'explicit'), true);
    assert.equal(entities.every((hint) => !('traits' in hint) && !('tags' in hint)), true);
    assert.equal(entities.every((hint) => hint.evidenceSource.chatId === snapshot.fileName
        && hint.evidenceSource.messageIndex === 0), true);
}
assert.equal(currentHints.some((hint) => hint.visibleAttributes[0].value === '银盾 | 铁剑'), false,
    'separate actual labels must not be replaced with a synthetic joined label');
assert.equal(currentHints.some((hint) => hint.entityKeySeed.includes('银盾') || hint.entityKeySeed.includes('hud-branch')), false,
    'entity key seeds must not reveal source labels or chat identifiers');

// The latest visible HUD record is the same branch-derived record the panels
// display. Older values stop winning once a newer explicit value appears.
const historicalSnapshot = {
    fileName: 'historical-hud.json',
    messages: [
        { role: 'character', text: '装备：旧盾\n道具：旧药水\n技能：旧招式' },
        { role: 'character', text: '装备：新盾\n道具：新药水\n技能：新招式' },
        { role: 'character', text: '装备：未来盾\n道具：未来药水\n技能：未来招式' },
    ],
};
const historicalHints = await createVisibleHudVisualHints(historicalSnapshot, 1, profile);
assert.equal(historicalHints.some((hint) => hint.visibleAttributes[0].value === '旧盾'), false);
assert.equal(historicalHints.some((hint) => hint.visibleAttributes[0].value === '新盾'), true);
assert.equal(historicalHints.some((hint) => hint.visibleAttributes[0].value === '未来盾'), false,
    'a future message cannot leak into the current page request');
const onlyHistoricalSnapshot = {
    fileName: 'historical-only.json',
    messages: [
        { role: 'character', text: '装备：最近盾\n道具：最近药水\n技能：最近招式' },
        { role: 'character', text: '普通对话，没有侧栏记录。' },
    ],
};
const latestHistoricalHints = await createVisibleHudVisualHints(onlyHistoricalSnapshot, 1, profile);
assert.equal(latestHistoricalHints.every((hint) => hint.evidenceSource.messageIndex === 0), true);
assert.equal(latestHistoricalHints.every((hint) => hint.historical === true), true);
assert.deepEqual(latestHistoricalHints.map((hint) => hint.visibleAttributes[0].value), ['最近盾', '最近药水', '最近招式']);
const otherPageSnapshot = {
    fileName: 'other-page.json',
    messages: [{ role: 'character', text: '装备：另一页盾\n道具：另一页道具\n技能：另一页技能' }],
};
const [lateFirstPageHints, currentOtherPageHints] = await Promise.all([
    createVisibleHudVisualHints(onlyHistoricalSnapshot, 1, profile),
    createVisibleHudVisualHints(otherPageSnapshot, 0, profile),
]);
assert.deepEqual(lateFirstPageHints.map((hint) => hint.visibleAttributes[0].value), ['最近盾', '最近药水', '最近招式']);
assert.deepEqual(currentOtherPageHints.map((hint) => hint.visibleAttributes[0].value), ['另一页盾', '另一页道具', '另一页技能']);
assert.equal(lateFirstPageHints.some((hint) => hint.evidenceSource.chatId === otherPageSnapshot.fileName), false,
    'concurrent page analysis cannot consume another page/chat HUD record');

// Inventory labels never cross over into the equipment channel.
const backpackSnapshot = {
    fileName: 'backpack-only.json',
    messages: [{ role: 'character', text: '道具：背包里的长剑' }],
};
const backpackHints = await createVisibleHudVisualHints(backpackSnapshot, 0, profile);
assert.deepEqual(backpackHints.map((hint) => [hint.entityType, hint.visibleAttributes[0].value]), [['item', '背包里的长剑']]);

for (const negativeSnapshot of [
    { fileName: 'empty.json', messages: [{ role: 'character', text: '装备：无\n道具：无\n技能：无' }] },
    { fileName: 'missing.json', messages: [{ role: 'character', text: '普通叙事，不包含侧栏记录。' }] },
    { fileName: 'wrong-role.json', messages: [{ role: 'system', text: '装备：不可见来源' }] },
]) {
    const hints = await createVisibleHudVisualHints(negativeSnapshot, 0, profile);
    assert.deepEqual(hints, [], 'empty, missing, or non-character evidence cannot force a match');
}
const oversizedLabelHints = await createVisibleHudVisualHints({
    fileName: 'oversized-label.json',
    messages: [{ role: 'character', text: `装备：${'长'.repeat(121)}` }],
}, 0, profile);
assert.equal(oversizedLabelHints.some((hint) => hint.entityType === 'equipment'), false,
    'oversized evidence is omitted instead of becoming a truncated synthetic label');
const unicodeBoundaryLabel = `${'甲'.repeat(79)}😀`;
const unicodeBoundaryHints = await createVisibleHudVisualHints({
    fileName: 'unicode-boundary.json',
    messages: [{ role: 'character', text: `装备：${unicodeBoundaryLabel}` }],
}, 0, profile);
const unicodeBoundaryEntity = unicodeBoundaryHints.find((hint) => hint.entityType === 'equipment');
assert.equal(unicodeBoundaryEntity?.displayLabel, unicodeBoundaryLabel);
assert.equal([...String(unicodeBoundaryEntity?.displayLabel || '')].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint >= 0xD800 && codePoint <= 0xDFFF;
}), false, 'displayLabel truncation cannot leave a lone surrogate');

const manySameClassSnapshot = {
    fileName: 'bounded-hud-labels.json',
    messages: [{
        role: 'character',
        text: [
            ...Array.from({ length: 110 }, (_, index) => `装备：护符${index}`),
            ...Array.from({ length: 110 }, (_, index) => `道具：药水${index}`),
            ...Array.from({ length: 110 }, (_, index) => `技能：招式${index}`),
        ].join('\n'),
    }],
};
const boundedHints = await createVisibleHudVisualHints(manySameClassSnapshot, 0, profile);
for (const type of ['equipment', 'item', 'skill']) {
    assert.ok(boundedHints.filter((hint) => hint.entityType === type).length <= 12,
        `${type} candidates are bounded to 12 unique names`);
}
assert.equal(boundedHints.some((hint) => hint.entityType === 'item'), true,
    'an oversized equipment list cannot crowd the other HUD channels out');
assert.equal(boundedHints.some((hint) => hint.entityType === 'skill'), true,
    'an oversized equipment list cannot crowd the other HUD channels out');
const skillAliasHints = await createVisibleHudVisualHints({
    fileName: 'skill-alias-cap.json',
    messages: [{
        role: 'character',
        text: ['Action Surge', 'Second Wind', 'Great Weapon Fighting', 'Light Armor', 'Persuasion', 'Deception', 'Intimidation']
            .map((name) => `技能：${name}`).join('\n'),
    }],
}, 0, profile);
const skillLabelHints = skillAliasHints.filter((hint) => hint.entityType === 'skill');
assert.equal(skillLabelHints.length, 12, 'a skill originalName alias consumes one of the 12 per-module names');
assert.equal(skillLabelHints.some((hint) => hint.visibleAttributes[0].value === 'Intimidation'), false);

const sourceTextVariantA = {
    fileName: 'same-source-scope.json',
    messages: [{ role: 'character', text: '装备：银盾\n守卫站在门边。' }],
};
const sourceTextVariantB = {
    fileName: 'same-source-scope.json',
    messages: [{ role: 'character', text: '装备：银盾\n守卫离开了房间。' }],
};
const [sourceVariantAHints, sourceVariantBHints] = await Promise.all([
    createVisibleHudVisualHints(sourceTextVariantA, 0, profile),
    createVisibleHudVisualHints(sourceTextVariantB, 0, profile),
]);
const sourceVariantASeed = sourceVariantAHints.find((hint) => hint.entityType === 'equipment')?.entityKeySeed;
const sourceVariantBSeed = sourceVariantBHints.find((hint) => hint.entityType === 'equipment')?.entityKeySeed;
assert.notEqual(sourceVariantASeed, sourceVariantBSeed,
    'same chat/index/label produces a new opaque seed when its visible source message changes');

console.log('visible HUD visual hint tests passed');
