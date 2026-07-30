import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import {
    getManifestArcBindings,
    materializeManifestForArc,
    validateSillyTavernBindings,
} from '../shared/src/protocol.js';
import {
    SillyTavernAdapter,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || 'http://127.0.0.1:8001');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/lucifer-arc-seed-watch.json');
const expectedSeedIds = {
    'lucifer-arc1': 'galgame-imported-lucifer-seed',
    'lucifer-arc2': args['arc2-seed'] || 'galgame-imported-lucifer-arc2-seed',
    'lucifer-arc3': args['arc3-seed'] || 'galgame-imported-lucifer-arc3-seed',
    'lucifer-arc4': args['arc4-seed'] || 'galgame-imported-lucifer-arc4-seed',
};

await mkdir(path.dirname(evidencePath), { recursive: true });

const result = await inspectArcSeeds();
await writeFile(evidencePath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({
    ok: result.ok,
    evidence: toRepoPath(evidencePath),
    allExpectedSeedsPresent: result.allExpectedSeedsPresent,
    publishableArcIds: result.arcs.filter((arc) => arc.publishableNow).map((arc) => arc.arcId),
    blockedArcIds: result.arcs.filter((arc) => !arc.publishableNow).map((arc) => arc.arcId),
}, null, 2));
process.exitCode = result.ok ? 0 : 1;

async function inspectArcSeeds() {
    const fetchImpl = createCookieFetch();
    const adapter = new SillyTavernAdapter({ baseUrl, fetchImpl });
    const chatBridge = new SillyTavernOriginalChatBridge({ baseUrl, fetchImpl });
    const primary = DEMO_SCENARIO.sillyTavernBindings.characters[0];
    const diagnostics = await adapter.diagnoseOriginalResourceAvailability(DEMO_SCENARIO).catch((error) => ({
        ok: false,
        errorCode: 'ORIGINAL_RESOURCE_DIAGNOSTIC_FAILED',
        error: error.message,
        checks: [],
    }));
    const chats = await chatBridge.listCharacterChats(primary).catch(() => []);
    const chatIds = chats.flatMap((chat) => [
        chat.fileId,
        chat.fileName,
        chat.file_name,
        chat.chatId,
        chat.id,
    ]).map(normalizeChatId).filter(Boolean);
    const uniqueChatIds = [...new Set(chatIds)].sort();

    const arcs = await Promise.all(getManifestArcBindings(DEMO_SCENARIO).map(async (arc) => {
        const manifestForArc = materializeManifestForArc(DEMO_SCENARIO, arc.arcId);
        const validation = validateSillyTavernBindings(DEMO_SCENARIO, { arcId: arc.arcId });
        const manifestSeedId = normalizeChatId(manifestForArc.sillyTavernBindings?.chatSeedId || '');
        const expectedSeedId = normalizeChatId(expectedSeedIds[arc.arcId] || manifestSeedId);
        const expectedWorldInfo = manifestForArc.sillyTavernBindings?.worldBooks?.[0]?.name || '';
        const manifestSeedExists = Boolean(manifestSeedId && uniqueChatIds.includes(manifestSeedId));
        const expectedSeedExists = Boolean(expectedSeedId && uniqueChatIds.includes(expectedSeedId));
        const seedWorldInfo = manifestSeedExists
            ? await readSeedWorldInfo(chatBridge, primary, manifestSeedId)
            : '';
        const runtimeWorldInfoMatches = Boolean(expectedWorldInfo && seedWorldInfo === expectedWorldInfo);
        return {
            arcId: arc.arcId,
            title: arc.title || arc.arcId,
            status: arc.status || 'draft',
            manifestSeedId,
            expectedSeedId,
            expectedWorldInfo,
            seedWorldInfo,
            runtimeWorldInfoMatches,
            manifestSeedExists,
            expectedSeedExists,
            bindingReady: validation.ready,
            publishableNow: arc.status === 'published' && validation.ready && manifestSeedExists && runtimeWorldInfoMatches,
            canBindWhenApproved: arc.status !== 'published' && expectedSeedExists,
            missingReasons: [
                ...validation.errors,
                ...validation.warnings,
                manifestSeedId && !manifestSeedExists ? `manifest chatSeedId not found: ${manifestSeedId}` : '',
                !manifestSeedId && !expectedSeedExists ? `expected independent seed not found: ${expectedSeedId}` : '',
                manifestSeedExists && !runtimeWorldInfoMatches ? `seed chat_metadata.world_info is not ${expectedWorldInfo}` : '',
            ].filter(Boolean),
        };
    }));

    return {
        ok: Boolean(diagnostics.ok),
        generatedAt: new Date().toISOString(),
        baseUrl,
        readonly: true,
        character: primary,
        chatCount: uniqueChatIds.length,
        chatIds: uniqueChatIds,
        allExpectedSeedsPresent: Object.values(expectedSeedIds).every((seedId) => uniqueChatIds.includes(normalizeChatId(seedId))),
        arcs,
        diagnostics,
        notes: [
            'This script is read-only.',
            'It does not create, copy, rename, import, or bind chat seeds.',
            'A draft Arc becoming canBindWhenApproved=true still requires administrator approval, manifest update, rebuild, publish, proof, target-chat readback, and non-target unchanged evidence.',
        ],
    };
}

async function readSeedWorldInfo(chatBridge, character, fileName) {
    try {
        const rawChat = await chatBridge.getCharacterChat({
            avatar: character.avatar,
            fileName,
        });
        return String(rawChat?.[0]?.chat_metadata?.world_info || '').trim();
    } catch {
        return '';
    }
}

function createCookieFetch() {
    let cookie = '';
    return async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (cookie && !headers.has('cookie')) {
            headers.set('cookie', cookie);
        }
        const response = await fetch(url, {
            ...options,
            headers,
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) {
            cookie = setCookie.split(',').map((item) => item.split(';')[0]).join('; ');
        }
        return response;
    };
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (value.startsWith('--')) {
            parsed[value.slice(2)] = values[index + 1];
            index += 1;
        }
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeChatId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
