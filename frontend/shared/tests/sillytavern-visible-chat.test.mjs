import assert from 'node:assert/strict';
import {
    createVisualProjectionEntityHints,
    normalizeOriginalVisibleChatMessages,
    ORIGINAL_VISIBLE_CHAT_EXTRACTOR_VERSION,
    VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION,
    VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION,
} from '../src/sillytavern-adapter.js';

assert.equal(ORIGINAL_VISIBLE_CHAT_EXTRACTOR_VERSION, 'galgame.original-visible-chat-extractor.v1');
assert.equal(VISUAL_PROJECTION_ENTITY_HINT_EXTRACTOR_VERSION, 'galgame.visual-projection-entity-hints.v1');
assert.equal(VISUAL_PROJECTION_SHARED_EXTRACTOR_VERSION, 'galgame.visual-projection-shared.v1');

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

console.log('sillytavern visible chat helper tests passed');
