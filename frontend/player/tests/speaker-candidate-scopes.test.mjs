import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    bindSpeakerCandidateScopes,
    buildSpeakerCandidateScopes,
    createSpeakerChatFingerprint,
    decodeCharacterCardPng,
    extractExplicitSpeakerCandidateNames,
    SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_EXTRACTION_RULE_VERSION,
    SPEAKER_CANDIDATE_SCOPES_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION,
    SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION,
    SpeakerCandidateScopeError,
    validateSpeakerCandidateAdapterConfig,
    validateSpeakerCandidateScopes,
} from '../tools/speaker-candidate-scopes.mjs';
import { replayStructuralSpeakerHistory } from '../tools/speaker-structure-replay.mjs';

const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

test('extracts only explicit character heading shapes and ignores unrelated names', () => {
    const worldbook = {
        entries: {
            one: { comment: 'Companion - Pippa' },
            two: { comment: '[Galgame_Imported_Lucifer_Anna] Anna — Physical Description' },
            three: { comment: '[Galgame_Imported_Lucifer_Andrei] Andrei — Arc Trajectory' },
            four: { comment: '[Galgame_Imported_Lucifer_Anna_Profile] ANNA_PROFILE — Notes' },
            five: { comment: 'Pippa mentions the merchant in a story' },
            six: { comment: 'Magic Items - Pippa’s Dagger' },
            seven: { comment: 'Companion - Durik', key: ['Pippa', 'weapon', 'town'] },
        },
    };
    assert.deepEqual(extractExplicitSpeakerCandidateNames(worldbook), ['Pippa', 'Anna', 'Andrei', 'Durik']);
    assert.deepEqual(extractExplicitSpeakerCandidateNames({ entries: [
        { comment: 'Companion - Nira' },
        { comment: '[World_Nira] Other Name — Profile' },
    ] }), ['Nira']);
});

test('builds one resource-bound candidate scope per exact chat even when chats share a worldbook', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Campaign World', { entries: {
        1: { comment: 'Companion - Nira' },
        2: { comment: 'Companion - Lio' },
    } });
    await writeChat(roots.chatsRoot, 'first.jsonl', 'Campaign World');
    await writeChat(roots.chatsRoot, 'second.jsonl', 'Campaign World');
    await writeChat(roots.chatsRoot, 'unbound.jsonl', '');
    const chatPaths = ['first.jsonl', 'second.jsonl', 'unbound.jsonl'];
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths });

    assert.equal(scopes.schemaVersion, SPEAKER_CANDIDATE_SCOPES_SCHEMA_VERSION);
    assert.equal(scopes.entries.length, 2);
    assert.notEqual(scopes.entries[0].chatFingerprint, scopes.entries[1].chatFingerprint);
    assert.equal(scopes.entries[0].resourceName, 'Campaign World');
    assert.equal(scopes.entries[0].resourceFingerprint, scopes.entries[1].resourceFingerprint);
    assert.equal(scopes.entries[0].extractionRuleVersion, SPEAKER_CANDIDATE_EXTRACTION_RULE_VERSION);
    assert.deepEqual(scopes.entries[0].candidateSpeakerNames, ['Nira', 'Lio']);
    const bound = await bindSpeakerCandidateScopes(scopes, { ...roots, chatPaths });
    assert.equal(bound.size, 2);
});

test('candidate scopes fail closed when attached to another chat or when the worldbook changes', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Campaign World', { entries: { 1: { comment: 'Companion - Nira' } } });
    await writeChat(roots.chatsRoot, 'one.jsonl', 'Campaign World');
    await writeChat(roots.chatsRoot, 'two.jsonl', 'Other World');
    await writeWorldbook(roots.worldbooksRoot, 'Other World', { entries: { 1: { comment: 'Companion - Nira' } } });
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['one.jsonl'] });

    await assert.rejects(
        bindSpeakerCandidateScopes(scopes, { ...roots, chatPaths: ['two.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_SCOPE_CHAT_NOT_IN_REPLAY',
    );
    await writeWorldbook(roots.worldbooksRoot, 'Campaign World', { entries: { 1: { comment: 'Companion - Changed Name' } } });
    await assert.rejects(
        bindSpeakerCandidateScopes(scopes, { ...roots, chatPaths: ['one.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_WORLD_BOOK_HASH_MISMATCH',
    );
});

test('candidate scope must match chat world_info and cannot contain arbitrary names', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Campaign World', { entries: { 1: { comment: 'Companion - Nira' } } });
    await writeWorldbook(roots.worldbooksRoot, 'Other World', { entries: { 1: { comment: 'Companion - Nira' } } });
    await writeChat(roots.chatsRoot, 'one.jsonl', 'Campaign World');
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['one.jsonl'] });
    const wrongBinding = structuredClone(scopes);
    wrongBinding.entries[0].resourceName = 'Other World';
    wrongBinding.entries[0].resourceFingerprint = hash(await import('node:fs/promises').then(async ({ readFile }) => (
        readFile(path.join(roots.worldbooksRoot, 'Other World.json'))
    )));
    await assert.rejects(
        bindSpeakerCandidateScopes(wrongBinding, { ...roots, chatPaths: ['one.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_SCOPE_RESOURCE_BINDING_MISMATCH',
    );

    const invalidName = structuredClone(scopes);
    invalidName.entries[0].candidateSpeakerNames = ['Unverified'];
    await assert.rejects(
        bindSpeakerCandidateScopes(invalidName, { ...roots, chatPaths: ['one.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_NAMES_DO_NOT_MATCH_RESOURCE',
    );
    const duplicateScope = structuredClone(scopes);
    duplicateScope.entries.push(structuredClone(duplicateScope.entries[0]));
    assert.throws(() => validateSpeakerCandidateScopes(duplicateScope), { code: 'SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID' });
});

test('a chat header bound to a missing worldbook fails closed', async (t) => {
    const roots = await makeRoots(t);
    await writeChat(roots.chatsRoot, 'missing-book.jsonl', 'Campaign World');
    await assert.rejects(
        buildSpeakerCandidateScopes({ ...roots, chatPaths: ['missing-book.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND',
    );
});

test('candidate scope extraction rejects a chat symlink before reading its header', async (t) => {
    const roots = await makeRoots(t);
    const outsideRoot = path.join(path.dirname(roots.chatsRoot), 'outside');
    await mkdir(outsideRoot, { recursive: true });
    await writeChat(outsideRoot, 'external.jsonl', 'Campaign World');
    await writeWorldbook(roots.worldbooksRoot, 'Campaign World', { entries: { 1: { comment: 'Companion - Nira' } } });
    try {
        await symlink(path.join(outsideRoot, 'external.jsonl'), path.join(roots.chatsRoot, 'linked.jsonl'), 'file');
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error?.code)) {
            t.skip(`file symlinks are unavailable on this host (${error.code})`);
            return;
        }
        throw error;
    }
    await assert.rejects(
        buildSpeakerCandidateScopes({ ...roots, chatPaths: ['linked.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_CHAT_SYMLINK',
    );
});

test('candidate scope extraction rejects a worldbook symlink before reading resource bytes', async (t) => {
    const roots = await makeRoots(t);
    const outsideRoot = path.join(path.dirname(roots.worldbooksRoot), 'external-worlds');
    await mkdir(outsideRoot, { recursive: true });
    await writeWorldbook(outsideRoot, 'Campaign World', { entries: { 1: { comment: 'Companion - Nira' } } });
    await writeChat(roots.chatsRoot, 'linked-book.jsonl', 'Campaign World');
    try {
        await symlink(path.join(outsideRoot, 'Campaign World.json'), path.join(roots.worldbooksRoot, 'Campaign World.json'), 'file');
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(error?.code)) {
            t.skip(`file symlinks are unavailable on this host (${error.code})`);
            return;
        }
        throw error;
    }
    await assert.rejects(
        buildSpeakerCandidateScopes({ ...roots, chatPaths: ['linked-book.jsonl'] }),
        (error) => error instanceof SpeakerCandidateScopeError && error.code === 'SPEAKER_CANDIDATE_WORLD_BOOK_NOT_FOUND',
    );
});

test('chat fingerprints match replay identity and empty worldbooks create no scopes', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Empty World', { entries: { 1: { comment: 'Magic Items - Nira’s Dagger' } } });
    await writeChat(roots.chatsRoot, 'nested/one.jsonl', 'Empty World');
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['nested/one.jsonl'] });
    assert.deepEqual(scopes.entries, []);
    assert.equal(createSpeakerChatFingerprint(roots.chatsRoot, 'nested/one.jsonl'), hash('nested/one.jsonl'));
});

test('resource-derived names affect only structural attribution and remain chat-local', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'First World', { entries: { 1: { comment: 'Companion - Nira' } } });
    await writeChat(roots.chatsRoot, 'first.jsonl', 'First World');
    await writeChat(roots.chatsRoot, 'second.jsonl', '');
    const chatPaths = ['first.jsonl', 'second.jsonl'];
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['first.jsonl'] });
    const visibleText = 'Nira: “准备好了。”';
    const readHistoryChatImpl = async (absolutePath) => ({
        canonicalPath: absolutePath,
        sourceDigest: hash('same-chat-source'),
        assistantMessages: [{ sourceMessageIndex: 2, sourceMessageHash: hash(visibleText), visibleText }],
    });
    const baseline = await replayStructuralSpeakerHistory({
        chatPaths, ...roots, readHistoryChatImpl,
    });
    const replay = await replayStructuralSpeakerHistory({
        chatPaths, ...roots, speakerCandidateScopes: scopes, readHistoryChatImpl,
    });
    assert.equal(baseline.predictions[0].kind, 'narration');
    assert.equal(replay.predictions[0].kind, 'speaker');
    assert.deepEqual(replay.predictions[0].speakers, ['Nira']);
    assert.equal(replay.predictions[0].candidateScopeStatus, 'resource-derived-candidates');
    assert.equal(replay.predictions[1].candidateScopeStatus, 'unavailable');
    assert.notEqual(replay.predictions[1].kind, 'speaker');
    assert.deepEqual(replay.predictions.map(({ pageIndex, start, end }) => ({ pageIndex, start, end })),
        baseline.predictions.map(({ pageIndex, start, end }) => ({ pageIndex, start, end })));
    assert.equal(replay.scopeUnavailableChats, 2, 'candidate resources do not masquerade as published speaker rosters');
});

test('typed JSON adapters support different object and array resource schemas without name hardcoding', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Object World', { entries: {
        companion: { displayName: 'Nira', kind: 'Companion' },
        town: { displayName: 'Greyhaven', kind: 'location' },
        item: { name: 'Dawn Blade', type: 'item' },
        npc: { name: 'Archivist', type: 'NPC' },
    } });
    await writeWorldbook(roots.worldbooksRoot, 'Array World', { people: [
        { label: 'Kato', category: 'character' },
        { label: 'Old Harbor', category: 'place' },
        { label: 'Mira', category: 'companion' },
    ] });
    await writeChat(roots.chatsRoot, 'object.jsonl', 'Object World');
    await writeChat(roots.chatsRoot, 'array.jsonl', 'Array World');
    const candidateAdapters = {
        schemaVersion: SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
        resources: [
            { resourceName: 'Object World', adapters: [
                { adapterId: 'json.typed-entry-fields.v1', entriesPointer: '/entries', namePointers: ['/displayName', '/name'], typePointers: ['/kind', '/type'], acceptedTypes: ['character', 'npc', 'companion'] },
            ] },
            { resourceName: 'Array World', adapters: [
                { adapterId: 'json.typed-entry-fields.v1', entriesPointer: '/people', namePointers: ['/label'], typePointers: ['/category'], acceptedTypes: ['character', 'npc', 'companion'] },
            ] },
        ],
    };
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['object.jsonl', 'array.jsonl'], candidateAdapters });
    assert.equal(scopes.schemaVersion, SPEAKER_CANDIDATE_SCOPES_V2_SCHEMA_VERSION);
    assert.deepEqual(scopes.entries.map(({ candidateSpeakerNames }) => candidateSpeakerNames), [
        ['Nira', 'Archivist'],
        ['Kato', 'Mira'],
    ]);
    const bound = await bindSpeakerCandidateScopes(scopes, {
        ...roots, chatPaths: ['object.jsonl', 'array.jsonl'], candidateAdapters,
    });
    assert.equal(bound.size, 2);
    assert.equal(bound.get(scopes.entries[0].chatFingerprint).adapters[0].configFingerprint, scopes.entries[0].adapters[0].configFingerprint);
    const visibleText = 'Nira: “我们准备出发。”';
    const replay = await replayStructuralSpeakerHistory({
        ...roots,
        chatPaths: ['object.jsonl', 'array.jsonl'],
        speakerCandidateScopes: scopes,
        speakerCandidateAdapters: candidateAdapters,
        readHistoryChatImpl: async (absolutePath) => ({
            canonicalPath: absolutePath,
            sourceDigest: hash('typed-candidate-source'),
            assistantMessages: [{ sourceMessageIndex: 0, sourceMessageHash: hash(visibleText), visibleText }],
        }),
    });
    assert.equal(replay.predictions[0].kind, 'speaker');
    assert.deepEqual(replay.predictions[0].speakers, ['Nira']);
    assert.notEqual(replay.predictions[1].kind, 'speaker');
    assert.deepEqual(replay.predictions.map(({ start, end }) => ({ start, end })), [
        { start: 0, end: visibleText.length },
        { start: 0, end: visibleText.length },
    ]);
});

test('typed adapter requires explicit entity type evidence and supports an empty configured result', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Unclear World', { entries: {
        missingType: { name: 'Unconfirmed Person' },
        wrongType: { name: 'Market Square', type: 'location' },
    } });
    await writeChat(roots.chatsRoot, 'unclear.jsonl', 'Unclear World');
    const candidateAdapters = {
        schemaVersion: SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
        resources: [{ resourceName: 'Unclear World', adapters: [{
            adapterId: 'json.typed-entry-fields.v1',
            entriesPointer: '/entries', namePointers: ['/name'], typePointers: ['/type'],
            acceptedTypes: ['character', 'npc', 'companion'],
        }] }],
    };
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['unclear.jsonl'], candidateAdapters });
    assert.deepEqual(scopes.entries[0].candidateSpeakerNames, []);
    assert.deepEqual(await bindSpeakerCandidateScopes(scopes, {
        ...roots, chatPaths: ['unclear.jsonl'], candidateAdapters,
    }).then((bound) => (
        bound.get(scopes.entries[0].chatFingerprint).candidateSpeakerNames
    )), []);
});

test('adapter config rejects broad, executable, or prototype JSON pointers', () => {
    const base = {
        schemaVersion: SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
        resources: [{ resourceName: 'Any World', adapters: [{
            adapterId: 'json.typed-entry-fields.v1', entriesPointer: '/entries/*',
            namePointers: ['/name'], typePointers: ['/type'], acceptedTypes: ['npc'],
        }] }],
    };
    assert.throws(() => validateSpeakerCandidateAdapterConfig(base), { code: 'SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID' });
    const prototype = structuredClone(base);
    prototype.resources[0].adapters[0].entriesPointer = '/entries/__proto__/x';
    assert.throws(() => validateSpeakerCandidateAdapterConfig(prototype), { code: 'SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID' });
    const unsupported = structuredClone(base);
    unsupported.resources[0].adapters[0].entriesPointer = '/entries';
    unsupported.resources[0].adapters[0].adapterId = 'javascript.eval.v1';
    assert.throws(() => validateSpeakerCandidateAdapterConfig(unsupported), { code: 'SPEAKER_CANDIDATE_ADAPTER_UNSUPPORTED' });
});

test('candidate sidecar adapter/config tampering fails validation or rebind', async (t) => {
    const roots = await makeRoots(t);
    await writeWorldbook(roots.worldbooksRoot, 'Bound World', { entries: [{ displayName: 'Rin', type: 'npc' }] });
    await writeChat(roots.chatsRoot, 'bound.jsonl', 'Bound World');
    const candidateAdapters = {
        schemaVersion: SPEAKER_CANDIDATE_ADAPTERS_SCHEMA_VERSION,
        resources: [{ resourceName: 'Bound World', adapters: [{
            adapterId: 'json.typed-entry-fields.v1', entriesPointer: '/entries', namePointers: ['/displayName'],
            typePointers: ['/type'], acceptedTypes: ['npc'],
        }] }],
    };
    const scopes = await buildSpeakerCandidateScopes({ ...roots, chatPaths: ['bound.jsonl'], candidateAdapters });
    await assert.rejects(
        bindSpeakerCandidateScopes(scopes, { ...roots, chatPaths: ['bound.jsonl'] }),
        { code: 'SPEAKER_CANDIDATE_ADAPTER_CONFIG_INVALID' },
    );
    const changedNames = structuredClone(scopes);
    changedNames.entries[0].adapters[0].candidateSpeakerNames = ['Forged'];
    assert.throws(() => validateSpeakerCandidateScopes(changedNames), { code: 'SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID' });
    const changedConfig = structuredClone(scopes);
    changedConfig.entries[0].adapters[0].config.namePointers = ['/type'];
    assert.throws(() => validateSpeakerCandidateScopes(changedConfig), { code: 'SPEAKER_CANDIDATE_SCOPES_SCHEMA_INVALID' });
    const alternateConfig = structuredClone(candidateAdapters);
    alternateConfig.resources[0].adapters[0].namePointers = ['/type'];
    const alternateScopes = await buildSpeakerCandidateScopes({
        ...roots, chatPaths: ['bound.jsonl'], candidateAdapters: alternateConfig,
    });
    await assert.rejects(
        bindSpeakerCandidateScopes(alternateScopes, { ...roots, chatPaths: ['bound.jsonl'], candidateAdapters }),
        { code: 'SPEAKER_CANDIDATE_ADAPTER_CONFIG_MISMATCH' },
    );
    await writeWorldbook(roots.worldbooksRoot, 'Bound World', { entries: [{ displayName: 'Rin', type: 'npc' }, { displayName: 'Changed', type: 'npc' }] });
    await assert.rejects(
        bindSpeakerCandidateScopes(scopes, { ...roots, chatPaths: ['bound.jsonl'], candidateAdapters }),
        { code: 'SPEAKER_CANDIDATE_WORLD_BOOK_HASH_MISMATCH' },
    );
});

test('V81 binds character cards and differently shaped declared rosters per chat', async (t) => {
    const roots = await makeRoots(t);
    await mkdir(path.join(roots.charactersRoot, 'scenario-card'), { recursive: true });
    await writeFile(path.join(roots.charactersRoot, 'scenario-card.png'), makeCardPng('Nova'), 'binary');
    await writeWorldbook(roots.worldbooksRoot, 'Scenario World', {
        people: [{ display: 'Rin', aliases: ['Rinny'], kind: 'npc' }],
    });
    await writeFile(path.join(roots.charactersRoot, 'other-card.png'), makeCardPng('Other'), 'binary');
    await writeWorldbook(roots.worldbooksRoot, 'Other World', {
        actors: [{ title: 'Kato', kind: 'npc' }],
    });
    await writeChat(roots.chatsRoot, 'scenario-card/turn.jsonl', 'Scenario World', 'Nova');
    await writeChat(roots.chatsRoot, 'other-card/turn.jsonl', 'Other World', 'Other');
    const candidateAdapters = {
        schemaVersion: SPEAKER_CANDIDATE_ADAPTERS_V2_SCHEMA_VERSION,
        resources: [{
            sourceId: 'world-roster', sourceType: 'sillytavern.worldbook-json.v1',
            binding: { kind: 'chat-header-pointer', pointer: '/chat_metadata/world_info' }, resourceRoot: 'worldbooks',
            resourceNames: ['Scenario World'],
            adapters: [{
                adapterId: 'json.declared-name-fields.v1', entriesPointer: '/people', namePointers: ['/display'],
                aliasPointers: ['/aliases'], typePointers: ['/kind'], acceptedTypes: ['npc'], sourceKind: 'typed-roster',
            }],
        }, {
            sourceId: 'other-world-roster', sourceType: 'sillytavern.worldbook-json.v1',
            binding: { kind: 'chat-header-pointer', pointer: '/chat_metadata/world_info' }, resourceRoot: 'worldbooks',
            resourceNames: ['Other World'],
            adapters: [{
                adapterId: 'json.typed-entry-fields.v1', entriesPointer: '/actors', namePointers: ['/title'],
                typePointers: ['/kind'], acceptedTypes: ['npc'],
            }],
        }, {
            sourceId: 'current-card', sourceType: 'sillytavern.character-card-png.v1',
            binding: { kind: 'chat-character-card' }, resourceRoot: 'characters',
            adapters: [{ adapterId: 'character-card.canonical-name.v1' }],
        }],
    };
    const scopes = await buildSpeakerCandidateScopes({
        ...roots, chatPaths: ['scenario-card/turn.jsonl', 'other-card/turn.jsonl'], candidateAdapters,
    });
    assert.equal(scopes.schemaVersion, SPEAKER_CANDIDATE_SCOPES_V3_SCHEMA_VERSION);
    assert.equal(scopes.entries[0].sources.length, 2);
    const bound = await bindSpeakerCandidateScopes(scopes, {
        ...roots, chatPaths: ['scenario-card/turn.jsonl', 'other-card/turn.jsonl'], candidateAdapters,
    });
    assert.deepEqual(bound.values().next().value.candidateSpeakerNames.sort(), ['Nova', 'Rin', 'Rinny']);
    assert.deepEqual(bound.get(createSpeakerChatFingerprint(roots.chatsRoot, 'other-card/turn.jsonl')).candidateSpeakerNames.sort(), ['Kato', 'Other']);
    const visibleText = 'Rin: “准备好了。”';
    const readHistoryChatImpl = async (absolutePath) => ({
        canonicalPath: absolutePath, sourceDigest: hash('v81-fixture'),
        assistantMessages: [{ sourceMessageIndex: 1, sourceMessageHash: hash(visibleText), visibleText }],
    });
    const baseline = await replayStructuralSpeakerHistory({
        ...roots, chatPaths: ['scenario-card/turn.jsonl', 'other-card/turn.jsonl'], readHistoryChatImpl,
    });
    const replay = await replayStructuralSpeakerHistory({
        ...roots,
        chatPaths: ['scenario-card/turn.jsonl', 'other-card/turn.jsonl'],
        speakerCandidateScopes: scopes,
        speakerCandidateAdapters: candidateAdapters,
        readHistoryChatImpl,
    });
    assert.equal(replay.predictions[0].kind, 'speaker');
    assert.deepEqual(replay.predictions[0].speakers, ['Rin']);
    assert.notEqual(replay.predictions.at(-1).speakers.includes('Rin'), true, 'candidate names do not cross chat scopes');
    assert.deepEqual(replay.predictions.map(({ pageIndex, start, end }) => ({ pageIndex, start, end })),
        baseline.predictions.map(({ pageIndex, start, end }) => ({ pageIndex, start, end })));
    const modified = structuredClone(scopes);
    modified.entries[0].sources[1].adapters[0].candidates[0].name = 'Forged';
    validateSpeakerCandidateScopes(modified);
    await assert.rejects(bindSpeakerCandidateScopes(modified, {
        ...roots, chatPaths: ['scenario-card/turn.jsonl', 'other-card/turn.jsonl'], candidateAdapters,
    }), { code: 'SPEAKER_CANDIDATE_SOURCE_RESULT_MISMATCH' });
    const wrongHeader = { ...roots, chatPaths: ['scenario-card/other.jsonl'] };
    await writeChat(roots.chatsRoot, 'scenario-card/other.jsonl', 'Scenario World', 'Different');
    const skippedCard = await buildSpeakerCandidateScopes({ ...wrongHeader, candidateAdapters });
    assert.equal(skippedCard.entries[0].sources.length, 1);
    assert.equal(skippedCard.entries[0].unavailableSources[0].reasonCode, 'CARD_IDENTITY_MISMATCH');
});

test('PNG metadata parser enforces chunk integrity, bounds, duplicates, and V2/V3 identity', () => {
    assert.equal(decodeCharacterCardPng(makeCardPng('Nova', { includeBoth: true })).identity, 'Nova');
    assert.equal(decodeCharacterCardPng(makeCardPng('Nova', { duplicateChara: true })).identity, 'Nova');
    assert.equal(decodeCharacterCardPng(makeCardPng('Nova', { legacyV2: true })).identity, 'Nova');
    assert.throws(() => decodeCharacterCardPng(makeCardPng('Nova', { legacyTopLevelOnly: true })), {
        code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_VERSION_UNSUPPORTED',
    });
    assert.throws(() => decodeCharacterCardPng(makeCardPng('Nova', { duplicateConflict: true })), { code: 'CARD_METADATA_DUPLICATE_CONFLICT' });
    assert.throws(() => decodeCharacterCardPng(makeCardPng('Nova', { v3Name: 'Other' })), { code: 'CARD_METADATA_IDENTITY_CONFLICT' });
    const truncated = makeCardPng('Nova').subarray(0, -2);
    assert.throws(() => decodeCharacterCardPng(truncated), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID' });
    const oversized = makeCardPng('Nova');
    oversized.writeUInt32BE(0xffffffff, 8);
    assert.throws(() => decodeCharacterCardPng(oversized), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID' });
    const badCrc = Buffer.from(makeCardPng('Nova'));
    badCrc[badCrc.length - 5] ^= 0x01;
    assert.throws(() => decodeCharacterCardPng(badCrc), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID' });
    const noEnd = makeCardPng('Nova').subarray(0, -12);
    assert.throws(() => decodeCharacterCardPng(noEnd), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID' });
    const duplicateEnd = Buffer.concat([makeCardPng('Nova'), pngChunk('IEND', Buffer.alloc(0))]);
    assert.throws(() => decodeCharacterCardPng(duplicateEnd), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_PNG_INVALID' });
    assert.throws(() => decodeCharacterCardPng(makeRawCardPng('not-base64')), { code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID' });
    assert.throws(() => decodeCharacterCardPng(makeRawCardPng(Buffer.from('{broken').toString('base64'))), {
        code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_METADATA_INVALID',
    });
    assert.throws(() => decodeCharacterCardPng(makeCardPng('Nova', { invalidSpec: true })), {
        code: 'SPEAKER_CANDIDATE_CHARACTER_CARD_VERSION_UNSUPPORTED',
    });
});

async function makeRoots(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'speaker-candidate-scopes-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const roots = {
        chatsRoot: path.join(root, 'chats'), worldbooksRoot: path.join(root, 'worlds'),
        charactersRoot: path.join(root, 'characters'),
    };
    await mkdir(roots.chatsRoot, { recursive: true });
    await mkdir(roots.worldbooksRoot, { recursive: true });
    await mkdir(roots.charactersRoot, { recursive: true });
    return roots;
}

async function writeChat(chatsRoot, chatPath, worldInfo, characterName = 'Nira') {
    const filePath = path.join(chatsRoot, chatPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ character_name: characterName, chat_metadata: worldInfo ? { world_info: worldInfo } : {} })}\n`, 'utf8');
}

async function writeWorldbook(worldbooksRoot, resourceName, worldbook) {
    await writeFile(path.join(worldbooksRoot, `${resourceName}.json`), JSON.stringify(worldbook), 'utf8');
}

function makeCardPng(name, {
    includeBoth = false, duplicateChara = false, duplicateConflict = false, v3Name = name,
    invalidSpec = false, legacyV2 = false, legacyTopLevelOnly = false,
} = {}) {
    const v2 = legacyTopLevelOnly ? { name, data: {} }
        : legacyV2 ? { name, data: { name } }
            : { spec: invalidSpec ? 'unknown' : 'chara_card_v2', spec_version: '2.0', name, data: { name } };
    const v3 = { spec: 'chara_card_v3', spec_version: '3.0', name: v3Name, data: { name: v3Name } };
    const textChunk = (keyword, payload) => pngChunk('tEXt', Buffer.concat([
        Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'), 'ascii'),
    ]));
    const metadata = [textChunk('chara', v2)];
    if (duplicateChara) metadata.push(textChunk('chara', v2));
    if (duplicateConflict) metadata.push(textChunk('chara', { ...v2, data: { name: 'Different' } }));
    if (includeBoth || v3Name !== name) metadata.push(textChunk('ccv3', v3));
    return makePngWithText(metadata.map((chunk) => chunk.subarray(8, -4)));
}

function makeRawCardPng(encoded) {
    const raw = Buffer.concat([Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(encoded, 'ascii')]);
    return makePngWithText([raw]);
}

function makePngWithText(textPayloads) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr), ...textPayloads.map((payload) => pngChunk('tEXt', payload)), pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

function pngChunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    typeBytes.copy(chunk, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
    return chunk;
}

function testCrc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}
