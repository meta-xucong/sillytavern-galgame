import assert from 'node:assert/strict';
import {
    CORE_VISUAL_DISPLAY_ENTITY_HINT_EXTRACTOR_VERSION,
    createCoreVisualDisplayEntityHints,
    createCoreVisualDisplayEntityKey,
    detectIncompleteRpgResponse,
    createVisualProjectionEntityHints,
    createVisualNovelDisplaySegments,
    normalizeOriginalVisibleChatMessages,
    ORIGINAL_VISIBLE_CHAT_EXTRACTOR_VERSION,
    VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION,
    VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION,
} from '../src/sillytavern-adapter.js';

assert.equal(ORIGINAL_VISIBLE_CHAT_EXTRACTOR_VERSION, 'galgame.original-visible-chat-extractor.v1');
assert.equal(VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION, 'galgame.visual-projection-entity-hints.v2');
assert.equal(VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION, 'galgame.visual-projection-shared.v2');
assert.equal(CORE_VISUAL_DISPLAY_ENTITY_HINT_EXTRACTOR_VERSION, 'galgame.core-visual-display-entity-hints.v2');

const chat = [
    { chat_metadata: { world_info: 'TestWorld' }, user_name: 'Player', character_name: 'Guide' },
    { name: 'System', is_system: true, mes: 'hidden system message' },
    { name: 'Guide', is_user: false, mes: '   ' },
    {
        name: 'Player',
        is_user: true,
        mes: 'raw player text',
        extra: {
            display_text: 'display player text',
        },
    },
    {
        name: 'Guide',
        is_user: false,
        mes: 'raw guide text should not win',
        extra: {
            display_text: 'display guide text',
        },
    },
];

const visible = normalizeOriginalVisibleChatMessages(chat);
assert.equal(visible.length, 2);
assert.deepEqual(visible.map((message) => message.index), [0, 1]);
assert.deepEqual(visible.map((message) => message.rawIndex), [3, 4]);
assert.equal(visible[0].role, 'player');
assert.equal(visible[0].text, 'display player text');
assert.equal(visible[1].role, 'character');
assert.equal(visible[1].speaker, 'Guide');
assert.equal(visible[1].text, 'display guide text');

const characterHints = createVisualProjectionEntityHints(visible[1]);
assert.equal(characterHints.some((entity) => entity.entityType === 'character'), true);
assert.equal(characterHints.some((entity) => entity.entityType === 'unknown'), true);
assert.equal(JSON.stringify(characterHints).includes('raw guide text should not win'), false);

const playerHints = createVisualProjectionEntityHints(visible[0]);
assert.equal(playerHints.some((entity) => entity.entityType === 'character'), false);
assert.equal(playerHints.some((entity) => entity.entityType === 'unknown'), true);

const fiveTypeHints = createVisualProjectionEntityHints({
    index: 7,
    role: 'character',
    speaker: 'Guide',
    text: [
        '场景: 雨中的旧车站',
        '装备: 生锈短剑',
        '道具: 蓝色钥匙',
        '技能: 火花术',
        '她拿着一把没有标签的匕首。',
    ].join('\n'),
});
assert.deepEqual(fiveTypeHints.map((entity) => entity.entityType), [
    'character',
    'scene',
    'equipment',
    'item',
    'skill',
    'unknown',
]);
assert.equal(fiveTypeHints.find((entity) => entity.entityType === 'scene').displayLabel, '雨中的旧车站');
assert.equal(fiveTypeHints.find((entity) => entity.entityType === 'equipment').visibleAttributes[0].code, 'equipment-visible-label');
assert.equal(fiveTypeHints.some((entity) => entity.displayLabel === '没有标签的匕首'), false);

const sceneAliasHints = createVisualProjectionEntityHints({
    index: 16,
    role: 'character',
    speaker: 'Guide',
    text: [
        '**背景设定**：雨中的旧车站',
        '当前地点：站台',
        '环境：大雨',
        '战场：废弃月台',
        '场景描述：远处亮着一盏灯',
    ].join('\n'),
});
assert.equal(sceneAliasHints.filter((entity) => entity.entityType === 'scene').length, 5);

for (const metadataLine of [
    '艾莉丝的回合：她举起剑。',
    '伤害：1d6 穿刺',
    '死亡豁免记录：失败',
    '你的回合：请选择行动',
]) {
    const [segment] = createVisualNovelDisplaySegments(metadataLine, { fallbackSpeaker: 'WorldDirector' });
    assert.equal(segment.type, 'narration', metadataLine);
    assert.equal(segment.speaker, '旁白', metadataLine);
}
const narratorLabelSegments = createVisualNovelDisplaySegments('角色: 旁白\n雨声落在石阶上。', {
    fallbackSpeaker: 'Dungeon Master',
    role: 'character',
});
assert.equal(narratorLabelSegments[0].type, 'narration');
assert.equal(narratorLabelSegments[0].speaker, '旁白');
const narratorLabelHints = createCoreVisualDisplayEntityHints({
    index: 11,
    role: 'character',
    speaker: 'Dungeon Master',
    text: '角色: 旁白\n雨声落在石阶上。',
});
assert.equal(narratorLabelHints.some((entity) => entity.entityType === 'character'), false);

const coreCharacterLabelHints = createCoreVisualDisplayEntityHints({
    index: 12,
    role: 'player',
    speaker: 'Player',
    text: '角色: 银发骑士',
});
assert.deepEqual(createVisualProjectionEntityHints({
    index: 12,
    role: 'player',
    speaker: 'Player',
    text: '角色: 银发骑士',
}).map((entity) => entity.entityType), ['unknown']);
assert.deepEqual(coreCharacterLabelHints.map((entity) => entity.entityType), ['character', 'unknown']);
assert.equal(coreCharacterLabelHints[0].visibleAttributes[0].code, 'character-explicit-appearance');
assert.match(await createCoreVisualDisplayEntityKey('character', coreCharacterLabelHints[0].entityKeySeed), /^entity_character_[a-f0-9]{24}$/);

const coreMergedCharacterHints = createCoreVisualDisplayEntityHints({
    index: 13,
    role: 'character',
    speaker: '银发骑士',
    text: '角色: 银色斗篷与透明披风',
});
assert.deepEqual(coreMergedCharacterHints.map((entity) => entity.entityType), ['character', 'unknown']);
assert.equal(coreMergedCharacterHints.filter((entity) => entity.entityType === 'character').length, 1);
assert.equal(coreMergedCharacterHints[0].entityKeySeed, '银发骑士');
assert.deepEqual(coreMergedCharacterHints[0].visibleAttributes.map((attribute) => attribute.code), [
    'character-explicit-name',
    'character-explicit-appearance',
]);

const coreMissingAppearanceCharacterHints = createCoreVisualDisplayEntityHints({
    index: 14,
    role: 'character',
    speaker: '银发骑士',
    text: '她握紧剑柄，望向庭院。',
});
assert.deepEqual(coreMissingAppearanceCharacterHints.map((entity) => entity.entityType), ['character', 'unknown']);
assert.deepEqual(coreMissingAppearanceCharacterHints[0].visibleAttributes.map((attribute) => attribute.code), ['character-explicit-name']);

const coreAmbiguousCharacterHints = createCoreVisualDisplayEntityHints({
    index: 15,
    role: 'character',
    speaker: '银发骑士',
    text: [
        '角色: 银色斗篷',
        '立绘: 黑色铠甲',
    ].join('\n'),
});
assert.deepEqual(coreAmbiguousCharacterHints.map((entity) => entity.entityType), ['character', 'unknown']);
assert.deepEqual(coreAmbiguousCharacterHints[0].visibleAttributes.map((attribute) => attribute.code), ['character-explicit-name']);

const coreTraitCharacterHints = createCoreVisualDisplayEntityHints({
    index: 16,
    role: 'character',
    speaker: '艾琳',
    text: [
        '性别: 女性',
        '种族: 精灵',
        '外观: 银发与尖耳',
        '服装: 深蓝法袍',
    ].join('\n'),
});
assert.deepEqual(coreTraitCharacterHints[0].visibleAttributes.map((attribute) => attribute.code), [
    'character-explicit-name',
    'character-explicit-gender-presentation',
    'character-explicit-species',
    'character-explicit-appearance',
    'character-explicit-clothing',
]);

const naturalLanguageOnlyHints = createVisualProjectionEntityHints({
    index: 8,
    role: 'player',
    speaker: 'Player',
    text: '我走进像旧车站一样的地方，拿着短剑并想起火花术。',
});
assert.deepEqual(naturalLanguageOnlyHints.map((entity) => entity.entityType), ['unknown']);

const duplicateHints = createVisualProjectionEntityHints({
    index: 9,
    role: 'player',
    speaker: 'Player',
    text: [
        '场景: 雨中的旧车站',
        '场景: 雨中的旧车站',
        '装备: 生锈短剑',
        '道具: 蓝色钥匙',
        '技能: 火花术',
    ].join('\n'),
});
assert.deepEqual(duplicateHints.map((entity) => entity.entityType), ['scene', 'equipment', 'item', 'skill', 'unknown']);
assert.deepEqual(duplicateHints.filter((entity) => entity.entityType === 'scene').map((entity) => entity.displayLabel), ['雨中的旧车站']);

const overflowHints = createVisualProjectionEntityHints({
    index: 10,
    role: 'player',
    speaker: 'Player',
    text: Array.from({ length: 40 }, (_, index) => `道具: 编号物品${String(index + 1).padStart(2, '0')}`).join('\n'),
});
assert.equal(overflowHints.length, 32);
assert.equal(overflowHints.every((entity) => entity.entityType === 'item'), true);
assert.equal(overflowHints[0].displayLabel, '编号物品01');
assert.equal(overflowHints[31].displayLabel, '编号物品32');

const maliciousTextHints = createVisualProjectionEntityHints({
    index: 11,
    role: 'player',
    speaker: 'Player',
    text: [
        '道具: <script>alert(1)</script> [link](javascript:alert(1)) {{prompt}}',
        'Prompt: hidden resource body',
        '她点击了 [技能: 火花术](javascript:alert(1))。',
    ].join('\n'),
});
assert.deepEqual(maliciousTextHints.map((entity) => entity.entityType), ['item', 'unknown']);
assert.equal(maliciousTextHints[0].visibleAttributes[0].value.includes('<script>'), true);
assert.equal(maliciousTextHints.some((entity) => entity.entityType === 'skill'), false);

const segmented = createVisualNovelDisplaySegments('森林里传来脚步声。“喂，你这蠢货！”它举起短刀。\n\nDungeon Master：准备受死吧！', { fallbackSpeaker: 'Dungeon Master', role: 'character' });
assert.deepEqual(segmented.map((segment) => segment.speaker), ['旁白', '旁白', '旁白', 'Dungeon Master']);
assert.equal(segmented[1].type, 'narration');
assert.equal(segmented[1].text, '“喂，你这蠢货！”');
assert.equal(segmented[3].type, 'dialogue');
assert.equal(segmented[3].text, '准备受死吧！');

const knownSpeakerSegment = createVisualNovelDisplaySegments('Pippa立刻反对：“不要打开那扇门。”', {
    fallbackSpeaker: 'Dungeon Master',
    role: 'character',
    characterNames: ['Pippa'],
});
assert.deepEqual(knownSpeakerSegment[0], {
    index: 0,
    type: 'dialogue',
    speaker: 'Pippa',
    text: '“不要打开那扇门。”',
});

const unknownSpeakerSegment = createVisualNovelDisplaySegments('守卫立刻反对：“不要打开那扇门。”', {
    fallbackSpeaker: 'Dungeon Master',
    role: 'character',
    characterNames: ['Pippa'],
});
assert.equal(unknownSpeakerSegment[0].type, 'narration');

const nonDialogueVisualRows = createVisualNovelDisplaySegments([
    '场景: 庭院',
    '背景: 雨夜',
    '角色: 银发骑士',
    '伤害: 12',
    '体质豁免: d20 + 1 = 6',
    '艾莉丝的回合',
].join('\n\n'), { fallbackSpeaker: '艾莉丝', role: 'character' });
assert.equal(nonDialogueVisualRows.every((segment) => segment.type === 'narration'), true);
assert.deepEqual(nonDialogueVisualRows.map((segment) => segment.speaker), ['旁白', '旁白', '旁白', '旁白', '旁白', '旁白']);

const hiddenReasoningHints = createCoreVisualDisplayEntityHints({
    index: 16,
    role: 'character',
    speaker: 'Dungeon Master',
    text: [
        '```',
        '[thinking]',
        'Scene: hidden planning room',
        '```',
        '',
        '场景: 庭院',
        '体质豁免: d20 + 1 = 6',
    ].join('\n'),
});
assert.equal(hiddenReasoningHints.some((entity) => entity.entityType === 'character'), false);
assert.deepEqual(hiddenReasoningHints.filter((entity) => entity.entityType === 'scene').map((entity) => entity.displayLabel), ['庭院']);

const likelyTruncatedRpgReply = `${'你沿着骨阶继续前进，仪式厅的门缝透出红色烛光。'.repeat(80)}天花板悬着成排的无舌骨`;
assert.equal(detectIncompleteRpgResponse(likelyTruncatedRpgReply), true);
assert.equal(detectIncompleteRpgResponse(`${likelyTruncatedRpgReply}\n\n可选行动：\n1. 继续\n2. 返回\n3. 观察`), false);
assert.equal(detectIncompleteRpgResponse('继续描述这一小段。'.repeat(30)), false);
assert.equal(detectIncompleteRpgResponse(`${'完整叙事已经结束。'.repeat(60)}\n\n❤ HP: 12/12\n⛨ AC: 15\n📃 Status: Healthy and optimistic`), false);

console.log('sillytavern visible chat helper tests passed');
