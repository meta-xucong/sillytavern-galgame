import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST_PATH = path.join(moduleDir, 'player-catalog-manifest.json');
const DEFAULT_BASE_URL = 'http://127.0.0.1:8798';
const CHANNELS = Object.freeze(['character', 'player', 'narrator', 'system']);
const TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);

function pointersEqual(left, right) {
    return Boolean(left && right
        && left.catalogId === right.catalogId
        && left.catalogRevision === right.catalogRevision
        && left.catalogHash === right.catalogHash);
}

function countMapsEqual(actual, expected) {
    return Boolean(actual && typeof actual === 'object' && !Array.isArray(actual)
        && Object.keys(actual).length === Object.keys(expected).length
        && Object.entries(expected).every(([key, value]) => actual[key] === value));
}

function parseMode(argv) {
    const modes = argv.filter((value) => ['--preview', '--execute', '--rollback'].includes(value));
    const extras = argv.filter((value) => !['--preview', '--execute', '--rollback'].includes(value));
    if (modes.length !== 1 || extras.length) {
        throw new Error('usage: node rebuild-player-catalog.mjs --preview|--execute|--rollback');
    }
    return modes[0].slice(2);
}

function assertLoopbackBaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash) {
        throw new Error('management endpoint must be plain HTTP on loopback');
    }
    return url.origin;
}

async function fetchJson(fetchImpl, url, token, method = 'GET', body = undefined) {
    let response;
    try {
        response = await fetchImpl(url, {
            method,
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/json',
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
        });
    } catch {
        throw new Error('visual service management endpoint is unavailable');
    }
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw new Error(`visual service returned non-JSON (HTTP ${response.status})`);
    }
    if (!response.ok || payload?.ok !== true) {
        const code = String(payload?.error?.code || `HTTP_${response.status}`).replace(/[^A-Z0-9_-]/gu, '').slice(0, 80);
        throw new Error(`visual service rejected migration request: ${code}`);
    }
    return payload;
}

function assertPreviewMatchesManifest(preview, manifest) {
    const refs = manifest.entries;
    const expectedByType = Object.fromEntries(TYPES.map((type) => [type, refs.filter((entry) => entry.assetType === type).length]));
    const expectedByChannel = Object.fromEntries(CHANNELS.map((channel) => [channel, refs.filter((entry) => entry.assetType === 'character' && entry.channel === channel).length]));
    const targetIdentityMatches = preview.newPointer?.catalogId === manifest.targetCatalogId
        && preview.newPointer?.catalogRevision === manifest.targetCatalogRevision;
    const oldPointerMatches = preview.idempotent
        ? pointersEqual(preview.oldPointer, preview.newPointer)
        : pointersEqual(preview.oldPointer, manifest.sourcePointer);
    if (preview.schemaVersion !== 'galgame.visual-player-catalog-migration-preview.v1'
        || preview.targetRefCount !== refs.length
        || preview.duplicateContentCount !== 0
        || !countMapsEqual(preview.countsByType, expectedByType)
        || !countMapsEqual(preview.countsByChannel, expectedByChannel)
        || expectedByChannel.narrator < 1 || expectedByChannel.player < 1 || expectedByChannel.system !== 0
        || expectedByType.scene < 1
        || !targetIdentityMatches
        || !/^sha256:[a-f0-9]{64}$/u.test(String(preview.targetCatalogHash || ''))
        || preview.newPointer?.catalogHash !== preview.targetCatalogHash
        || !oldPointerMatches
        || preview.sourceCatalogHash !== manifest.sourcePointer.catalogHash
        || !Number.isSafeInteger(preview.sourceRefCount) || preview.sourceRefCount < 1) {
        throw new Error('preview counts or required channel inventory do not match the approved manifest');
    }
    if (preview.excludedByReason && Object.keys(preview.excludedByReason).some((key) => key !== 'NOT_ALLOWLISTED')) {
        throw new Error('preview contains an unexpected exclusion reason');
    }
}

/**
 * Uses only the versioned, loopback/admin management API. No file-store adapter
 * is imported here, so preview/execute/rollback cannot write catalog JSON.
 */
export async function runPlayerCatalogRebuild({
    mode,
    manifestPath = DEFAULT_MANIFEST_PATH,
    baseUrl = process.env.GALGAME_VISUAL_ASSET_MANAGEMENT_URL || DEFAULT_BASE_URL,
    adminToken = process.env.GALGAME_VISUAL_ASSET_ADMIN_TOKEN || '',
    fetchImpl = globalThis.fetch,
} = {}) {
    if (!['preview', 'execute', 'rollback'].includes(mode)) throw new Error('migration mode is invalid');
    if (!adminToken || typeof adminToken !== 'string') throw new Error('visual service admin token is not configured');
    const origin = assertLoopbackBaseUrl(baseUrl);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.schemaVersion !== 'galgame.visual-player-catalog-manifest.v1'
        || !manifest.sourcePointer || !Array.isArray(manifest.entries)) {
        throw new Error('approved player catalog manifest is invalid');
    }

    const runtime = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/runtime`, adminToken);
    if (runtime.journal?.state === 'PREPARED') throw new Error('an incomplete catalog transaction requires service recovery first');
    if (mode === 'preview' && !pointersEqual(runtime.activePointer, manifest.sourcePointer)
        && runtime.activePointer?.catalogId !== manifest.targetCatalogId) {
        throw new Error('runtime pointer is not the manifest source; preview refused');
    }
    const preview = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/preview`, adminToken, 'POST', manifest);
    assertPreviewMatchesManifest(preview, manifest);
    if (preview.idempotent
        && (!pointersEqual(runtime.activePointer, preview.newPointer)
            || runtime.activeCatalogHash !== preview.targetCatalogHash
            || runtime.journal?.state !== 'COMMITTED')) {
        throw new Error('idempotent preview is not the exact committed active target');
    }
    if (mode === 'preview') return { operation: 'preview', runtime: summarizeRuntime(runtime), preview };

    if (mode === 'execute') {
        if (!pointersEqual(runtime.activePointer, manifest.sourcePointer)) {
            if (preview.idempotent && pointersEqual(runtime.activePointer, preview.newPointer)) {
                return { operation: 'execute', idempotent: true, runtime: summarizeRuntime(runtime), preview };
            }
            throw new Error('execute requires the exact approved source pointer');
        }
        if (preview.idempotent) throw new Error('source pointer is already the target; execute refused');
        const activation = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/activate`, adminToken, 'POST', manifest);
        const readBack = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/runtime`, adminToken);
        if (!pointersEqual(readBack.activePointer, preview.newPointer)
            || readBack.activeCatalogHash !== preview.targetCatalogHash
            || readBack.journal?.state !== 'COMMITTED') {
            throw new Error('activation readback did not confirm the committed target pointer');
        }
        return { operation: 'execute', activation, runtime: summarizeRuntime(readBack), preview };
    }

    if (runtime.activePointer?.catalogId !== manifest.targetCatalogId
        || runtime.activePointer?.catalogRevision !== manifest.targetCatalogRevision
        || runtime.activePointer?.catalogHash !== preview.newPointer.catalogHash
        || runtime.activePointer.catalogHash !== preview.targetCatalogHash) {
        throw new Error('rollback requires the exact active manifest target pointer');
    }
    const rollback = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/rollback`, adminToken, 'POST', {
        expectedCurrentPointer: runtime.activePointer,
        targetPointer: manifest.sourcePointer,
    });
    const readBack = await fetchJson(fetchImpl, `${origin}/v1/admin/catalog-migration/runtime`, adminToken);
    if (!pointersEqual(readBack.activePointer, manifest.sourcePointer)
        || readBack.journal?.state !== 'COMMITTED') {
        throw new Error('rollback readback did not confirm the committed source pointer');
    }
    return { operation: 'rollback', rollback, runtime: summarizeRuntime(readBack), preview };
}

function summarizeRuntime(runtime) {
    return {
        serviceInstanceId: runtime.serviceInstanceId,
        pid: runtime.pid,
        port: runtime.port,
        activePointer: runtime.activePointer,
        journalState: runtime.journal?.state || null,
    };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
    try {
        const mode = parseMode(process.argv.slice(2));
        const result = await runPlayerCatalogRebuild({ mode });
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(JSON.stringify({ ok: false, error: error.message }));
        process.exitCode = 1;
    }
}
