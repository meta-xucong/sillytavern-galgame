import assert from 'node:assert/strict';
import { DEMO_SCENARIO } from '../src/demo-scenario.js';
import {
    buildMediaJobRequest,
    bindAdaptivePresentationProfileHashes,
    createActiveRelease,
    createAdaptivePresentationProfileHash,
    createMediaIdempotencyKey,
    findArcBinding,
    getSpecialVisualChannelAssetKeys,
    getAdaptivePresentationProfileForArc,
    getAssetUrl,
    getDefaultArcId,
    getManifestArcBindings,
    listPlayableStoryEntries,
    listStoredStorySummaries,
    materializeManifestForArc,
    resolveVisualCharacterBinding,
    summarizeSillyTavernBindings,
    validateAdaptivePresentationProfiles,
    validateVisualCharacterBindings,
    validateArcBindings,
    validateReleaseArcSelection,
    validateScenarioManifest,
    validateSillyTavernBindings,
} from '../src/protocol.js';

const validation = validateScenarioManifest(DEMO_SCENARIO);
assert.equal(validation.valid, true, validation.errors.join('\n'));

const visualBindingManifest = {
    ...DEMO_SCENARIO,
    visualBindings: {
        schemaVersion: 'galgame.visual-character-bindings.v1',
        characters: [
            {
                characterKey: 'Pippa',
                aliases: ['pippa', '皮帕'],
                assetId: 'asset_character_1b4268f70a37',
                assetVersion: 1,
                channel: 'any',
            },
            {
                characterKey: '旁白',
                aliases: ['narrator', '旁边'],
                assetId: 'asset_character_3946efea1eb5',
                assetVersion: 1,
                channel: 'narrator',
            },
        ],
        defaults: {
            characterAssetId: 'asset_character_8e5132df0905',
            narratorAssetId: 'asset_character_3946efea1eb5',
            playerAssetId: 'asset_curated_player-neutral-compass',
            systemAssetId: 'asset_character_aabbccddee12',
        },
    },
};
const visualBindingStatus = validateVisualCharacterBindings(visualBindingManifest);
assert.equal(visualBindingStatus.valid, true, visualBindingStatus.errors.join('\\n'));
assert.deepEqual(getSpecialVisualChannelAssetKeys(visualBindingManifest), [
    'asset_character_3946efea1eb5:1',
    'asset_character_aabbccddee12:1',
    'asset_curated_player-neutral-compass:1',
], 'special channel asset keys include player, narrator, and system resources');
const curatedVisualBindingManifest = {
    ...visualBindingManifest,
    visualBindings: {
        ...visualBindingManifest.visualBindings,
        characters: visualBindingManifest.visualBindings.characters.map((binding, index) => index === 0
            ? {
                ...binding,
                assetId: 'asset_curated_character-woman-mage',
                assetVersion: 2,
            }
            : binding),
    },
};
const curatedVisualBindingStatus = validateVisualCharacterBindings(curatedVisualBindingManifest);
assert.equal(curatedVisualBindingStatus.valid, true, curatedVisualBindingStatus.errors.join('\\n'));
const curatedPlayerBindingStatus = validateVisualCharacterBindings({
    ...curatedVisualBindingManifest,
    visualBindings: {
        ...curatedVisualBindingManifest.visualBindings,
        defaults: {
            ...curatedVisualBindingManifest.visualBindings.defaults,
            playerAssetId: 'asset_curated_player-neutral-compass',
        },
    },
});
assert.equal(curatedPlayerBindingStatus.valid, true, curatedPlayerBindingStatus.errors.join('\\n'));
const systemCharacterDefaultConflict = validateVisualCharacterBindings({
    ...visualBindingManifest,
    visualBindings: {
        ...visualBindingManifest.visualBindings,
        defaults: {
            ...visualBindingManifest.visualBindings.defaults,
            systemAssetId: visualBindingManifest.visualBindings.defaults.characterAssetId,
        },
    },
});
assert.equal(systemCharacterDefaultConflict.valid, false);
assert.match(systemCharacterDefaultConflict.errors.join('\\n'), /reuses an asset reserved for the character channel/);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '你', role: 'player' }).assetId,
    'asset_curated_player-neutral-compass',
    'player uses its dedicated channel asset',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '皮帕', role: 'player' }).assetId,
    'asset_curated_player-neutral-compass',
    'an any/character binding cannot cross into the player channel',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '皮帕', role: 'narrator' }).assetId,
    'asset_character_3946efea1eb5',
    'an any/character binding cannot cross into the narrator channel',
);
assert.equal(
    resolveVisualCharacterBinding({
        ...visualBindingManifest,
        visualBindings: {
            ...visualBindingManifest.visualBindings,
            defaults: { ...visualBindingManifest.visualBindings.defaults, playerAssetId: undefined },
        },
    }, { name: '你', role: 'player' }),
    null,
    'player never falls back to a generic character default',
);
const playerAssetPoolConflict = {
    ...visualBindingManifest,
    id: 'player-asset-pool-conflict',
    visualBindings: {
        ...visualBindingManifest.visualBindings,
        characterPool: [{
            characterKey: 'Neutral NPC', aliases: [],
            assetId: 'asset_curated_player-neutral-compass', assetVersion: 1, channel: 'character',
        }],
    },
};
const playerAssetPoolConflictStatus = validateVisualCharacterBindings(playerAssetPoolConflict);
assert.equal(playerAssetPoolConflictStatus.valid, false);
assert.match(playerAssetPoolConflictStatus.errors.join('\\n'), /player-only|dedicated player\/narrator\/system/);
assert.equal(
    resolveVisualCharacterBinding(playerAssetPoolConflict, { name: 'Neutral NPC', role: 'character' }),
    null,
    'an invalid player asset is not returned by an exact pool match',
);
assert.equal(
    resolveVisualCharacterBinding({
        ...playerAssetPoolConflict,
        id: 'player-asset-pool-unknown-conflict',
        visualBindings: {
            ...playerAssetPoolConflict.visualBindings,
            characterPool: [{ characterKey: 'Neutral NPC', aliases: [], assetId: 'asset_curated_player-neutral-compass', channel: 'character' }],
        },
    }, { name: 'Unknown NPC', role: 'character' }),
    null,
    'invalid pool fallback cannot allocate a dedicated player asset',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '皮帕', role: 'character' }).assetId,
    'asset_character_1b4268f70a37',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '皮帕的回合', role: 'character' }).assetId,
    'asset_character_1b4268f70a37',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '旁边', role: 'narrator' }).assetId,
    'asset_character_3946efea1eb5',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '未登记角色', role: 'narrator' }).assetId,
    'asset_character_3946efea1eb5',
);
assert.equal(
    resolveVisualCharacterBinding(visualBindingManifest, { name: '未登记角色', role: 'character' }),
    null,
);
const pooledVisualBindingManifest = {
    ...visualBindingManifest,
    id: 'visual-binding-pool-test',
    visualBindings: {
        ...visualBindingManifest.visualBindings,
        characterPool: [
            {
                characterKey: 'Pippa',
                aliases: ['mage'],
                assetId: 'asset_character_7ab26f70c123',
                assetVersion: 1,
                channel: 'character',
            },
            {
                characterKey: 'Dwarf Warrior',
                aliases: ['dwarf', '矮人'],
                assetId: 'asset_character_ef87a34e79ed',
                assetVersion: 1,
                channel: 'character',
            },
        ],
    },
};
const pooledVisualBindingStatus = validateVisualCharacterBindings(pooledVisualBindingManifest);
assert.equal(pooledVisualBindingStatus.valid, true, pooledVisualBindingStatus.errors.join('\\n'));
const arcPlayerAssetPoolConflict = {
    ...pooledVisualBindingManifest,
    arcs: DEMO_SCENARIO.arcs.map((arc, index) => index === 0
        ? {
            ...arc,
            visualBindings: {
                defaults: { playerAssetId: 'asset_character_7ab26f70c123' },
            },
        }
        : arc),
};
const arcPlayerAssetPoolConflictStatus = validateScenarioManifest(arcPlayerAssetPoolConflict);
assert.equal(arcPlayerAssetPoolConflictStatus.valid, false);
assert.match(arcPlayerAssetPoolConflictStatus.errors.join('\\n'), /dedicated player\/narrator\/system asset/);
const crossListDuplicateStatus = validateVisualCharacterBindings({
    ...pooledVisualBindingManifest,
    visualBindings: {
        ...pooledVisualBindingManifest.visualBindings,
        characterPool: [{
            characterKey: 'Other Character',
            aliases: [],
            assetId: 'asset_character_1b4268f70a37',
            assetVersion: 1,
            channel: 'character',
        }],
    },
});
assert.equal(crossListDuplicateStatus.valid, false);
assert.match(crossListDuplicateStatus.errors.join('\\n'), /different character/);
const duplicateVisualBindingStatus = validateVisualCharacterBindings({
    ...pooledVisualBindingManifest,
    visualBindings: {
        ...pooledVisualBindingManifest.visualBindings,
        characters: [
            ...pooledVisualBindingManifest.visualBindings.characters,
            {
                characterKey: 'Duplicate Portrait',
                aliases: [],
                assetId: 'asset_character_1b4268f70a37',
                assetVersion: 1,
                channel: 'character',
            },
        ],
    },
});
assert.equal(duplicateVisualBindingStatus.valid, false);
assert.match(duplicateVisualBindingStatus.errors.join('\\n'), /each asset may be bound to only one character/);
assert.equal(
    resolveVisualCharacterBinding(pooledVisualBindingManifest, { name: '矮人', role: 'character' }).assetId,
    'asset_character_ef87a34e79ed',
);
const pooledUnknownOne = resolveVisualCharacterBinding(pooledVisualBindingManifest, { name: '陌生角色甲', role: 'character' });
const pooledUnknownTwo = resolveVisualCharacterBinding(pooledVisualBindingManifest, { name: '陌生角色乙', role: 'character' });
const pooledUnknownThree = resolveVisualCharacterBinding(pooledVisualBindingManifest, { name: '陌生角色丙', role: 'character' });
assert.equal(pooledUnknownOne.assetId, 'asset_character_7ab26f70c123');
assert.equal(pooledUnknownTwo, null);
assert.equal(pooledUnknownThree, null);
assert.notEqual(pooledUnknownOne.assetId, 'asset_character_1b4268f70a37');
const pooledConflictManifest = {
    ...pooledVisualBindingManifest,
    id: 'visual-binding-pool-conflict-test',
    visualBindings: {
        ...pooledVisualBindingManifest.visualBindings,
        characterPool: [{
            characterKey: 'Dwarf Warrior',
            aliases: ['dwarf', '矮人'],
            assetId: 'asset_character_ef87a34e79ed',
            assetVersion: 1,
            channel: 'character',
        }],
    },
};
assert.equal(resolveVisualCharacterBinding(pooledConflictManifest, { name: '陌生角色', role: 'character' }).assetId, 'asset_character_ef87a34e79ed');
assert.equal(resolveVisualCharacterBinding(pooledConflictManifest, { name: '矮人', role: 'character' }).assetId, 'asset_character_ef87a34e79ed');
const poolAliasManifest = {
    ...pooledVisualBindingManifest,
    id: 'visual-binding-pool-alias-test',
    visualBindings: {
        ...pooledVisualBindingManifest.visualBindings,
        characters: [],
        characterPool: [{
            characterKey: 'Archivist',
            aliases: ['卷宗官', 'archive keeper'],
            assetId: 'asset_character_ef87a34e79ed',
            assetVersion: 1,
            channel: 'character',
        }],
    },
};
assert.equal(resolveVisualCharacterBinding(poolAliasManifest, { name: '卷宗官', role: 'character' }).assetId, 'asset_character_ef87a34e79ed');
assert.equal(resolveVisualCharacterBinding(poolAliasManifest, { name: 'archive keeper', role: 'character' }).assetId, 'asset_character_ef87a34e79ed');
const sessionScopedA = resolveVisualCharacterBinding(pooledConflictManifest, {
    name: '另一场游戏角色',
    role: 'character',
    sessionKey: 'chat-a',
});
const sessionScopedB = resolveVisualCharacterBinding(pooledConflictManifest, {
    name: '另一场游戏角色',
    role: 'character',
    sessionKey: 'chat-b',
});
assert.equal(sessionScopedA.assetId, 'asset_character_ef87a34e79ed');
assert.equal(sessionScopedB.assetId, 'asset_character_ef87a34e79ed');
assert.equal(
    resolveVisualCharacterBinding(pooledVisualBindingManifest, {
        name: '陌生角色甲',
        role: 'character',
        allowCharacterPoolFallback: false,
    }),
    null,
);
assert.equal(
    resolveVisualCharacterBinding(pooledVisualBindingManifest, {
        name: '旁白',
        role: 'narrator',
        allowCharacterPoolFallback: false,
    }).assetId,
    'asset_character_3946efea1eb5',
);
assert.equal(
    resolveVisualCharacterBinding(pooledVisualBindingManifest, { name: '陌生角色甲', role: 'character' }).assetId,
    pooledUnknownOne.assetId,
);
assert.equal(DEMO_SCENARIO.story.mode, 'sillytavern-live');
assert.equal(Object.values(DEMO_SCENARIO.story.nodes).every((node) => (node.lines || []).length === 0), true);
assert.equal(Object.values(DEMO_SCENARIO.story.nodes).every((node) => (node.choices || []).length === 0), true);
assert.equal(validateAdaptivePresentationProfiles(DEMO_SCENARIO).ready, true);

const adaptiveAuthorityProfileValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    adaptivePresentationProfiles: {
        bad: {
            ...DEMO_SCENARIO.adaptivePresentationProfiles[DEMO_SCENARIO.arcs[0].presentationProfileId],
            profileId: 'bad',
            hp: 12,
            inventory: ['local sword'],
        },
    },
    arcs: [
        {
            ...DEMO_SCENARIO.arcs[0],
            presentationProfileId: 'bad',
        },
    ],
});
assert.equal(adaptiveAuthorityProfileValidation.valid, false);
assert.equal(adaptiveAuthorityProfileValidation.errors.some((error) => error.includes('profile.hp')), true);
assert.equal(adaptiveAuthorityProfileValidation.errors.some((error) => error.includes('profile.inventory')), true);

const missingAdaptiveProfileValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    arcs: [
        {
            ...DEMO_SCENARIO.arcs[0],
            presentationProfileId: 'missing-profile',
        },
    ],
});
assert.equal(missingAdaptiveProfileValidation.valid, false);
assert.equal(missingAdaptiveProfileValidation.errors.some((error) => error.includes('missing adaptivePresentationProfiles entry')), true);

const authoredFlowValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    story: {
        ...DEMO_SCENARIO.story,
        nodes: {
            live: {
                ...DEMO_SCENARIO.story.nodes.live,
                lines: [{ id: 'fixed_line', kind: 'narration', text: '前端固定台词' }],
                choices: [{ id: 'fixed_choice', label: '固定选择', intent: 'fixed' }],
                nextNodeId: 'next',
            },
        },
    },
});
assert.equal(authoredFlowValidation.valid, false);
assert.equal(authoredFlowValidation.errors.some((error) => error.includes('story text must come from original SillyTavern play')), true);
assert.equal(authoredFlowValidation.errors.some((error) => error.includes('choices must be empty')), true);
assert.equal(authoredFlowValidation.errors.some((error) => error.includes('nextNodeId is not allowed')), true);

const parallelStateValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    story: {
        ...DEMO_SCENARIO.story,
        initialVariables: { route: 'local' },
        initialRelationships: { Assistant: 5 },
        initialInventory: ['local_item'],
    },
});
assert.equal(parallelStateValidation.valid, false);
assert.equal(parallelStateValidation.errors.some((error) => error.includes('story.initialVariables is not allowed')), true);
assert.equal(parallelStateValidation.errors.some((error) => error.includes('story.initialRelationships is not allowed')), true);
assert.equal(parallelStateValidation.errors.some((error) => error.includes('story.initialInventory is not allowed')), true);

const oldInteractionValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    interaction: {
        mode: 'free',
        allowFreeInputAt: ['live'],
    },
    runtimeRequirements: {
        provider: 'custom',
    },
    story: {
        ...DEMO_SCENARIO.story,
        nodes: {
            live: {
                ...DEMO_SCENARIO.story.nodes.live,
                allowFreeInput: true,
                freeInputPrompt: '说些什么',
            },
        },
    },
});
assert.equal(oldInteractionValidation.valid, false);
assert.equal(oldInteractionValidation.errors.some((error) => error.includes('interaction is not allowed')), true);
assert.equal(oldInteractionValidation.errors.some((error) => error.includes('runtimeRequirements is not allowed')), true);
assert.equal(oldInteractionValidation.errors.some((error) => error.includes('allowFreeInput is not allowed')), true);
assert.equal(oldInteractionValidation.errors.some((error) => error.includes('freeInputPrompt is not allowed')), true);

const bindingStatus = validateSillyTavernBindings(DEMO_SCENARIO);
assert.equal(bindingStatus.ready, true, bindingStatus.errors.join('\n'));
const bindingSummary = summarizeSillyTavernBindings(DEMO_SCENARIO);
assert.equal(bindingSummary.characters[0].id, DEMO_SCENARIO.sillyTavernBindings.characters[0].id);
assert.equal(bindingSummary.worldBooks[0].name, DEMO_SCENARIO.sillyTavernBindings.worldBooks[0].name);
assert.equal(
    bindingSummary.settings.find((setting) => setting.key === 'presetId').bound,
    Boolean(DEMO_SCENARIO.sillyTavernBindings.presetId),
);

const missingBindingStatus = validateSillyTavernBindings({ ...DEMO_SCENARIO, arcs: undefined, sillyTavernBindings: undefined });
assert.equal(missingBindingStatus.ready, false);
assert.equal(missingBindingStatus.warnings.some((warning) => warning.includes('sillyTavernBindings')), true);

const missingChatSeedValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    arcs: undefined,
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        chatSeedId: '',
    },
});
assert.equal(missingChatSeedValidation.valid, false);
assert.equal(missingChatSeedValidation.errors.some((error) => error.includes('chatSeedId')), true);

const embeddedBodyStatus = validateSillyTavernBindings({
    ...DEMO_SCENARIO,
    arcs: undefined,
    sillyTavernBindings: {
        ...DEMO_SCENARIO.sillyTavernBindings,
        characters: [
            {
                id: 'duplicated.original.character',
                role: 'main',
                description: 'This would duplicate the original character card body.',
            },
        ],
        worldBooks: [
            {
                name: 'summer-after-school.world',
                mode: 'scene',
                entries: [],
            },
        ],
    },
});
assert.equal(embeddedBodyStatus.ready, false);
assert.equal(embeddedBodyStatus.errors.some((error) => error.includes('references only')), true);

const defaultArcId = getDefaultArcId(DEMO_SCENARIO);
const defaultArc = findArcBinding(DEMO_SCENARIO, defaultArcId);
assert.equal(defaultArcId, DEMO_SCENARIO.defaultArcId);
assert.ok(getManifestArcBindings(DEMO_SCENARIO).length >= 1);
assert.equal(findArcBinding(DEMO_SCENARIO, defaultArcId).title, defaultArc.title);
const defaultArcManifest = materializeManifestForArc(DEMO_SCENARIO, defaultArcId);
assert.equal(defaultArcManifest.arcId, defaultArcId);
assert.equal(defaultArcManifest.sillyTavernBindings.worldBooks[0].name, DEMO_SCENARIO.sillyTavernBindings.worldBooks[0].name);
assert.equal(validateSillyTavernBindings(DEMO_SCENARIO, { arcId: defaultArcId }).ready, true);
assert.equal(validateArcBindings(DEMO_SCENARIO).ready, true);
for (const arc of getManifestArcBindings(DEMO_SCENARIO)) {
    assert.equal(validateReleaseArcSelection(DEMO_SCENARIO, arc.arcId).valid, true);
}
const profileBoundScenario = bindAdaptivePresentationProfileHashes(DEMO_SCENARIO, { arcId: defaultArcId });
const profileBoundArc = findArcBinding(profileBoundScenario, defaultArcId);
const profileForArc = getAdaptivePresentationProfileForArc(profileBoundScenario, defaultArcId);
assert.equal(profileBoundArc.presentationProfileHash, createAdaptivePresentationProfileHash(profileForArc));
assert.equal(validateReleaseArcSelection(profileBoundScenario, defaultArcId, { requirePresentationProfileHash: true }).valid, true);

const missingProfileHashValidation = validateReleaseArcSelection(DEMO_SCENARIO, defaultArcId, { requirePresentationProfileHash: true });
assert.equal(missingProfileHashValidation.valid, false);
assert.equal(missingProfileHashValidation.errors.some((error) => error.includes('presentationProfileHash')), true);

const staleProfileHashScenario = {
    ...profileBoundScenario,
    adaptivePresentationProfiles: {
        ...profileBoundScenario.adaptivePresentationProfiles,
        [profileBoundArc.presentationProfileId]: {
            ...profileBoundScenario.adaptivePresentationProfiles[profileBoundArc.presentationProfileId],
            template: 'romance-social',
        },
    },
};
const staleProfileHashValidation = validateReleaseArcSelection(staleProfileHashScenario, defaultArcId, { requirePresentationProfileHash: true });
assert.equal(staleProfileHashValidation.valid, false);
assert.equal(staleProfileHashValidation.errors.some((error) => error.includes('presentationProfileHash')), true);

const missingArcSeedReleaseValidation = validateReleaseArcSelection({
    ...DEMO_SCENARIO,
    arcs: DEMO_SCENARIO.arcs.map((arc) => arc.arcId === defaultArcId
        ? {
            ...arc,
            sillyTavernBindings: {
                ...arc.sillyTavernBindings,
                target: {
                    ...arc.sillyTavernBindings.target,
                    chatSeedId: '',
                },
            },
        }
        : arc),
}, defaultArcId);
assert.equal(missingArcSeedReleaseValidation.valid, false);
assert.equal(missingArcSeedReleaseValidation.errors.some((error) => error.includes('chatSeedId')), true);

const duplicateArcValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    arcs: [
        DEMO_SCENARIO.arcs[0],
        {
            ...DEMO_SCENARIO.arcs[0],
            arcId: DEMO_SCENARIO.arcs[0].arcId,
        },
    ],
});
assert.equal(duplicateArcValidation.valid, false);
assert.equal(duplicateArcValidation.errors.some((error) => error.includes('Duplicate arcId')), true);

const formalArcBodyValidation = validateScenarioManifest({
    ...DEMO_SCENARIO,
    arcs: [
        {
            ...DEMO_SCENARIO.arcs[0],
            sillyTavernBindings: {
                ...DEMO_SCENARIO.arcs[0].sillyTavernBindings,
                target: {
                    ...DEMO_SCENARIO.arcs[0].sillyTavernBindings.target,
                    characterRef: {
                        ...DEMO_SCENARIO.arcs[0].sillyTavernBindings.target.characterRef,
                        personality: 'not allowed',
                    },
                },
            },
        },
    ],
});
assert.equal(formalArcBodyValidation.valid, false);
assert.equal(formalArcBodyValidation.errors.some((error) => error.includes('references only')), true);

const release = createActiveRelease(DEMO_SCENARIO);
assert.equal(release.scenarioId, DEMO_SCENARIO.id);
assert.equal(release.scenarioVersion, DEMO_SCENARIO.version);
assert.equal(release.activeArcId, defaultArcId);
assert.equal(release.presentationProfileId, defaultArc.presentationProfileId);
assert.equal(release.presentationProfileHash, createAdaptivePresentationProfileHash(getAdaptivePresentationProfileForArc(DEMO_SCENARIO, defaultArcId)));
assert.equal(getAssetUrl(DEMO_SCENARIO, 'default_stage'), 'assets/classroom-morning.svg');

const alternateArcId = 'protocol-alt-arc';
const multiArcScenario = bindAdaptivePresentationProfileHashes({
    ...DEMO_SCENARIO,
    arcs: [
        DEMO_SCENARIO.arcs[0],
        {
            ...DEMO_SCENARIO.arcs[0],
            arcBindingId: `${DEMO_SCENARIO.id}:${DEMO_SCENARIO.version}:${alternateArcId}`,
            arcId: alternateArcId,
            title: '第二幕',
            order: DEMO_SCENARIO.arcs[0].order + 1,
            sillyTavernBindings: {
                ...DEMO_SCENARIO.arcs[0].sillyTavernBindings,
                target: {
                    ...DEMO_SCENARIO.arcs[0].sillyTavernBindings.target,
                    chatSeedId: `${DEMO_SCENARIO.arcs[0].sillyTavernBindings.target.chatSeedId}-alt`,
                },
            },
        },
    ],
});
const playableStoryEntries = listPlayableStoryEntries([multiArcScenario]);
assert.equal(playableStoryEntries.length, 1);
assert.equal(playableStoryEntries[0].entryId, `${multiArcScenario.id}@${multiArcScenario.version}`);
assert.equal(playableStoryEntries[0].arcId, defaultArcId);
assert.equal(playableStoryEntries[0].playableArcCount, 2);
const alternateRelease = createActiveRelease(multiArcScenario, { activeArcId: alternateArcId });
const activePlayableStoryEntries = listPlayableStoryEntries([multiArcScenario], { activeRelease: alternateRelease });
assert.equal(activePlayableStoryEntries.length, 1);
assert.equal(activePlayableStoryEntries[0].arcId, alternateArcId);
assert.equal(activePlayableStoryEntries[0].isDefault, true);
const storedStorySummary = listStoredStorySummaries([multiArcScenario])[0];
assert.equal(storedStorySummary.arcCount, 2);
assert.equal(storedStorySummary.playableArcCount, 2);

const state = {
    sessionId: 'native_session',
    chapterId: 'native',
    sceneId: 'native',
    nodeId: 'native',
};
const mediaRequest = buildMediaJobRequest({
    release,
    state,
    manifest: DEMO_SCENARIO,
    event: {
        id: 'cg_native_moment',
        kind: 'image',
        summary: '原版游玩中标记的关键画面',
        location: 'native',
        fallbackAsset: 'default_stage',
    },
});
assert.equal(mediaRequest.kind, 'image');
assert.equal(mediaRequest.event.event_id, 'cg_native_moment');
assert.equal(mediaRequest.policy.fallback_asset, 'default_stage');
assert.equal(createMediaIdempotencyKey(release.releaseId, state.sessionId, 'cg_native_moment').includes('cg_native_moment'), true);

console.log('shared protocol tests passed');
