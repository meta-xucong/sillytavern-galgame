import {
    ARC_BINDING_PROTOCOL_VERSION,
    createActiveRelease,
    PROTOCOL_VERSION,
} from './protocol.js?v=auto-9a4399a4b40e';
import { createDefaultAdaptivePresentationProfile } from './adaptive-presentation-schema.js?v=auto-9a4399a4b40e';

const DUNGEON_MASTER_SCENARIO_ID = 'galgame-imported-dungeon-master-entry';
const DUNGEON_MASTER_SCENARIO_VERSION = '0.1.0';
const DUNGEON_MASTER_CHARACTER_REF = {
    name: 'Dungeon Master',
    avatar: 'galgame_imported_dungeon_master.png',
};
const DUNGEON_MASTER_WORLD_BOOK = 'Galgame_Imported_Dungeon_Master_DnD_Base';
const DUNGEON_MASTER_CHAT_SEED_ID = 'galgame-imported-dungeon-master-fighter-seed';
const DUNGEON_MASTER_ARC_ID = 'dungeon-master-fighter-campaign';
const DUNGEON_MASTER_PRESENTATION_PROFILE_ID = 'dungeon-master-rpg';

function createDungeonMasterArcBinding() {
    return {
        schemaVersion: ARC_BINDING_PROTOCOL_VERSION,
        arcBindingId: `${DUNGEON_MASTER_SCENARIO_ID}:${DUNGEON_MASTER_SCENARIO_VERSION}:${DUNGEON_MASTER_ARC_ID}:v1`,
        scenarioId: DUNGEON_MASTER_SCENARIO_ID,
        scenarioVersion: DUNGEON_MASTER_SCENARIO_VERSION,
        arcId: DUNGEON_MASTER_ARC_ID,
        arcVersion: '1.0.0',
        title: 'Fighter Campaign',
        order: 1,
        status: 'published',
        sillyTavernBindings: {
            target: {
                mode: 'single-character',
                characterRef: DUNGEON_MASTER_CHARACTER_REF,
                chatSeedId: DUNGEON_MASTER_CHAT_SEED_ID,
            },
            worldBookRefs: [DUNGEON_MASTER_WORLD_BOOK],
        },
        presentationProfileId: DUNGEON_MASTER_PRESENTATION_PROFILE_ID,
        mediaPolicyId: 'default',
        contentRating: 'mature',
        createdAt: '2026-07-26T00:00:00+08:00',
    };
}

export const DEFAULT_SILLYTAVERN_SCENARIO = {
    schemaVersion: PROTOCOL_VERSION,
    id: DUNGEON_MASTER_SCENARIO_ID,
    version: DUNGEON_MASTER_SCENARIO_VERSION,
    title: 'Dungeon Master：RPG 基准入口',
    author: 'MrNobody99 / AI Character Cards',
    locale: 'zh-CN',
    contentRating: 'mature',
    saveCompatibility: 'sillytavern-live-1',
    minimumPlayerVersion: '1.0.0',
    resourceBindings: {
        assets: {
            title_scene: 'assets/title-scene.svg',
            default_stage: 'assets/classroom-morning.svg',
            default_sprite: 'assets/default-character.svg',
        },
        characters: {
            main: {
                displayName: 'Dungeon Master',
                sprite: 'default_sprite',
            },
        },
    },
    sillyTavernBindings: {
        characters: [
            {
                id: DUNGEON_MASTER_CHARACTER_REF.name,
                role: 'narrator',
                avatar: DUNGEON_MASTER_CHARACTER_REF.avatar,
            },
        ],
        worldBooks: [
            {
                name: DUNGEON_MASTER_WORLD_BOOK,
                mode: 'character',
                weight: 100,
            },
        ],
        presetId: '',
        instructPresetId: '',
        systemPromptId: '',
        contextPresetId: '',
        chatSeedId: DUNGEON_MASTER_CHAT_SEED_ID,
    },
    defaultArcId: DUNGEON_MASTER_ARC_ID,
    arcs: [
        createDungeonMasterArcBinding(),
    ],
    presentation: {
        titleBackgroundAsset: 'title_scene',
        defaultBackgroundAsset: 'default_stage',
        titleTone: 'quiet',
    },
    adaptivePresentationProfiles: {
        [DUNGEON_MASTER_PRESENTATION_PROFILE_ID]: createDefaultAdaptivePresentationProfile({
            profileId: DUNGEON_MASTER_PRESENTATION_PROFILE_ID,
            template: 'rpg-adventure',
            preferredModules: ['rpg-status', 'inventory', 'abilities', 'dice', 'actions'],
            disabledModules: ['relationships', 'affection', 'gifts', 'events', 'calendar', 'clues', 'suspects', 'locations', 'factions', 'resources', 'objectives', 'notes'],
            visualPriority: {
                primaryPanel: 'rpg-status',
                secondaryPanels: ['inventory', 'abilities', 'dice'],
                collapseBelowWidth: 640,
            },
        }),
    },
    story: {
        mode: 'sillytavern-live',
        startChapterId: 'sillytavern',
        startNodeId: 'live',
        nodes: {
            live: {
                chapterId: 'sillytavern',
                sceneId: 'live',
                backgroundId: 'default_stage',
                characters: [
                    {
                        characterId: 'main',
                        position: 'center',
                        visible: true,
                    },
                ],
                lines: [],
            },
        },
    },
    media: {
        enabled: true,
        timeoutMs: 120000,
        defaultStyleId: 'scenario_default',
        defaultNegative: 'low quality, distorted face',
        events: [],
    },
};

export const DEMO_SCENARIO = DEFAULT_SILLYTAVERN_SCENARIO;
export const DEMO_ACTIVE_RELEASE = createActiveRelease(DEFAULT_SILLYTAVERN_SCENARIO);
