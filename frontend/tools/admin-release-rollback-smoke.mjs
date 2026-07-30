import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import { createPlayerSaveSlot } from '../shared/src/player-save.js';
import {
    bindAdaptivePresentationProfileHashes,
    getActiveSillyTavernBindings,
    getManifestArcBindings,
    materializeManifestForArc,
} from '../shared/src/protocol.js';
import { SillyTavernAdapter } from '../shared/src/sillytavern-adapter.js';
import {
    LocalReleaseStore,
    MemoryStorageBackend,
} from '../shared/src/storage.js';
import {
    createConfigService,
    MemoryConfigStore,
} from '../../external-modules/game-config-service/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/admin-release-rollback.json');
const sillyTavernBaseUrl = args['base-url'] || process.env.SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001';
const manifest = bindAdaptivePresentationProfileHashes(await loadManifest(args.fixture));
const missingWorldBookName = 'Galgame_Missing_WorldBook';
const store = new MemoryConfigStore();
const server = createConfigService({ store });

await mkdir(path.dirname(evidencePath), { recursive: true });

try {
    await listen(server);
    const baseUrl = serverBaseUrl(server);
    const adapter = new SillyTavernAdapter({
        baseUrl: sillyTavernBaseUrl,
        fetchImpl: createCookieFetch(globalThis.fetch),
    });

    const publishableArcIds = getManifestArcBindings(manifest)
        .filter((arc) => (arc.status || 'published') === 'published')
        .map((arc) => arc.arcId);
    assert.equal(publishableArcIds.length > 0, true, 'manifest must have at least one publishable Arc');
    const defaultArcId = manifest.defaultArcId || publishableArcIds[0];
    const lastPublishedArcId = publishableArcIds.at(-1);

    const arcDiagnostics = {};
    for (const arcId of publishableArcIds) {
        const diagnostic = await adapter.diagnoseOriginalResourceAvailability(materializeManifestForArc(manifest, arcId));
        assert.equal(diagnostic.ok, true, `${arcId}: ${JSON.stringify(missingOriginalResourceReferences(diagnostic))}`);
        arcDiagnostics[arcId] = diagnostic;
    }

    const missingResourceManifest = createMissingResourceManifest(manifest);
    const missingResourceDiagnostic = await adapter.diagnoseOriginalResourceAvailability(materializeManifestForArc(missingResourceManifest, defaultArcId));
    assert.equal(missingResourceDiagnostic.ok, false);
    const missingResourceRefs = missingOriginalResourceReferences(missingResourceDiagnostic);
    assert.equal(missingResourceRefs.includes(missingWorldBookName), true);

    await postJson(baseUrl, '/v1/admin/scenarios/import', { manifest });
    const releasesByArc = {};
    for (const arcId of publishableArcIds) {
        const release = (await postJson(baseUrl, '/v1/admin/releases', {
            scenarioId: manifest.id,
            scenarioVersion: manifest.version,
            activeArcId: arcId,
        })).release;
        assert.equal(release.activeArcId, arcId);
        assert.equal((await getJson(baseUrl, '/v1/releases/active')).activeArcId, arcId);
        releasesByArc[arcId] = release;
    }
    const defaultArcRelease = releasesByArc[defaultArcId];
    assert.equal(defaultArcRelease.activeArcId, defaultArcId);

    const missingSeedArcId = publishableArcIds[1] || defaultArcId;
    const missingSeedManifest = createIsolatedFixtureManifest(createMissingSeedManifest(manifest, missingSeedArcId), 'missing-seed');
    const missingSeedImport = await rawJson(baseUrl, '/v1/admin/scenarios/import', {
        method: 'POST',
        body: {
            manifest: missingSeedManifest,
        },
    });
    let missingSeedArc = missingSeedImport;
    if (missingSeedImport.ok) {
        missingSeedArc = await rawJson(baseUrl, '/v1/admin/releases', {
            method: 'POST',
            body: {
                scenarioId: missingSeedManifest.id,
                scenarioVersion: missingSeedManifest.version,
                activeArcId: missingSeedArcId,
            },
        });
    }
    assert.equal(missingSeedArc.status, 400);
    assert.equal(
        ['ACTIVE_ARC_NOT_READY', 'MANIFEST_VALIDATION_FAILED'].includes(missingSeedArc.body.error)
            || missingSeedArc.body.validation?.valid === false,
        true,
        JSON.stringify(missingSeedArc.body),
    );
    assert.equal(JSON.stringify(missingSeedArc.body.validation?.errors || missingSeedArc.body.errors || []).includes('chatSeedId'), true);
    assert.equal((await getJson(baseUrl, '/v1/releases/active')).releaseId, releasesByArc[lastPublishedArcId].releaseId);

    const missingArc = await rawJson(baseUrl, '/v1/admin/releases', {
        method: 'POST',
        body: {
            scenarioId: manifest.id,
            scenarioVersion: manifest.version,
            activeArcId: 'missing-arc',
        },
    });
    assert.equal(missingArc.status, 400);
    assert.equal(missingArc.body.error, 'ACTIVE_ARC_NOT_FOUND');
    assert.equal((await getJson(baseUrl, '/v1/releases/active')).releaseId, releasesByArc[lastPublishedArcId].releaseId);

    const secondDefaultRelease = (await postJson(baseUrl, '/v1/admin/releases', {
        scenarioId: manifest.id,
        scenarioVersion: manifest.version,
        activeArcId: defaultArcId,
    })).release;
    assert.equal(secondDefaultRelease.activeArcId, defaultArcId);
    assert.notEqual(secondDefaultRelease.releaseId, defaultArcRelease.releaseId);
    assert.equal((await getJson(baseUrl, '/v1/releases/active')).releaseId, secondDefaultRelease.releaseId);

    const rollback = await postJson(baseUrl, `/v1/admin/releases/${encodeURIComponent(defaultArcRelease.releaseId)}/rollback`, {});
    assert.equal(rollback.ok, true);
    assert.equal(rollback.release.releaseId, defaultArcRelease.releaseId);
    assert.equal(rollback.release.activeArcId, defaultArcId);
    assert.equal((await getJson(baseUrl, '/v1/releases/active')).releaseId, defaultArcRelease.releaseId);

    const releases = await getJson(baseUrl, '/v1/admin/releases');
    assert.equal(releases.releases.length >= 2, true);

    const oldSaveEvidence = await verifyOldSaveBinding(manifest);
    const evidence = {
        ok: true,
        generatedAt: new Date().toISOString(),
        fixture: args.fixture || 'DEMO_SCENARIO',
        sillyTavernBaseUrl,
        checks: {
            allPublishedArcOriginalResourcesExist: Object.values(arcDiagnostics).every((diagnostic) => diagnostic.ok),
            publishedArcs: Object.fromEntries(publishableArcIds.map((arcId) => [arcId, releasesByArc[arcId].activeArcId === arcId])),
            missingSeedRejected: missingSeedArc.status === 400
                && (
                    ['ACTIVE_ARC_NOT_READY', 'MANIFEST_VALIDATION_FAILED'].includes(missingSeedArc.body.error)
                    || missingSeedArc.body.validation?.valid === false
                ),
            missingArcRejected: missingArc.status === 400 && missingArc.body.error === 'ACTIVE_ARC_NOT_FOUND',
            missingResourceRejectedByAdminLiveDiagnostic: missingResourceDiagnostic.ok === false,
            rollbackRestoresDefaultRelease: rollback.release.releaseId === defaultArcRelease.releaseId,
            oldSaveBinding: oldSaveEvidence.ok,
        },
        arcSeedMapping: manifest.arcs.map((arc) => ({
            arcId: arc.arcId,
            status: arc.status,
            chatSeedId: arc.sillyTavernBindings?.target?.chatSeedId || arc.sillyTavernBindings?.chatSeedId || '',
        })),
        originalResourceDiagnostics: {
            byArcReferenceOnly: Object.fromEntries(Object.entries(arcDiagnostics).map(([arcId, diagnostic]) => [
                arcId,
                pickDiagnosticEvidence(diagnostic),
            ])),
            missingResourceReferenceOnly: pickDiagnosticEvidence(missingResourceDiagnostic),
        },
        releases: {
            byArc: Object.fromEntries(Object.entries(releasesByArc).map(([arcId, release]) => [
                arcId,
                pickReleaseEvidence(release),
            ])),
            secondDefault: pickReleaseEvidence(secondDefaultRelease),
            rollback: pickReleaseEvidence(rollback.release),
            historyCount: releases.releases.length,
        },
        missingSeedArc: {
            arcId: missingSeedArcId,
            status: missingSeedArc.status,
            error: missingSeedArc.body.error,
            validationErrors: missingSeedArc.body.validation?.errors || missingSeedArc.body.errors || [],
        },
        missingArc: {
            status: missingArc.status,
            error: missingArc.body.error,
        },
        missingResource: {
            missing: missingResourceRefs,
        },
        oldSave: oldSaveEvidence,
        boundaries: {
            originalSillyTavernBackendMutated: false,
            originalChatMutated: false,
            runtimeApplied: 'deferred/unbridged',
            arcIsFrontendStoryNode: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        evidence: toRepoPath(evidencePath),
        checks: evidence.checks,
    }, null, 2));
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        error: error.message,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
} finally {
    await closeServer(server);
}

async function verifyOldSaveBinding(manifest) {
    const defaultArcId = manifest.defaultArcId || getManifestArcBindings(manifest)[0]?.arcId;
    const alternateArcId = getManifestArcBindings(manifest).find((arc) => arc.arcId !== defaultArcId)?.arcId || 'old-save-test-alternate-arc';
    const testManifestBase = getManifestArcBindings(manifest).some((arc) => arc.arcId === alternateArcId)
        ? manifest
        : withExtraArc(manifest, alternateArcId);
    const testManifest = bindAdaptivePresentationProfileHashes(testManifestBase);
    const localStore = new LocalReleaseStore(testManifest, new MemoryStorageBackend());
    const defaultPublish = await localStore.publishManifest(testManifest, { activeArcId: defaultArcId });
    assert.equal(defaultPublish.ok, true);
    const defaultArcManifest = materializeManifestForArc(testManifest, defaultArcId);
    const slot = createPlayerSaveSlot({
        release: defaultPublish.release,
        manifest: defaultArcManifest,
        snapshot: {
            ok: true,
            fileName: 'galgame-old-save-chat',
            messages: [
                { role: 'character', text: '开场', displayText: '开场' },
                { role: 'player', text: '继续', displayText: '继续' },
            ],
        },
    });

    const alternatePublish = await localStore.publishManifest(testManifest, { activeArcId: alternateArcId });
    assert.equal(alternatePublish.ok, true);
    assert.equal((await localStore.getActiveBundle()).release.releaseId, alternatePublish.release.releaseId);
    assert.equal((await localStore.getActiveBundle()).release.activeArcId, alternateArcId);

    const savedManifest = await localStore.getManifestByVersion(slot.scenarioId, slot.scenarioVersion);
    const savedArcManifest = materializeManifestForArc(savedManifest, slot.arcId);
    const bindings = getActiveSillyTavernBindings(savedArcManifest, slot.arcId);
    assert.equal(slot.arcId, defaultArcId);
    assert.equal(bindings.worldBooks[0].name, manifest.sillyTavernBindings.worldBooks[0].name);

    return {
        ok: true,
        saveId: slot.saveId,
        releaseId: slot.releaseId,
        scenarioId: slot.scenarioId,
        scenarioVersion: slot.scenarioVersion,
        arcId: slot.arcId,
        chatId: slot.chatId,
        activeReleaseAfterNewPublish: alternatePublish.release.releaseId,
        activeArcAfterNewPublish: alternatePublish.release.activeArcId,
        restoredWorldBookRef: bindings.worldBooks[0].name,
    };
}

async function loadManifest(fixturePath) {
    if (!fixturePath) {
        return DEMO_SCENARIO;
    }
    const absolute = path.resolve(repoRoot, fixturePath);
    return JSON.parse(await readFile(absolute, 'utf8'));
}

async function getJson(baseUrl, route) {
    const response = await rawJson(baseUrl, route);
    assert.equal(response.ok, true, response.body.error || JSON.stringify(response.body));
    return response.body;
}

async function postJson(baseUrl, route, body) {
    const response = await rawJson(baseUrl, route, { method: 'POST', body });
    assert.equal(response.ok, true, response.body.error || JSON.stringify(response.body));
    return response.body;
}

async function rawJson(baseUrl, route, { method = 'GET', body } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
        method,
        headers: body === undefined ? {} : {
            'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
        ok: response.ok,
        status: response.status,
        body: await response.json(),
    };
}

function missingOriginalResourceReferences(diagnostic) {
    return diagnostic.checks
        .flatMap((check) => check.details?.missing || [])
        .filter(Boolean);
}

function pickDiagnosticEvidence(diagnostic) {
    return {
        ok: diagnostic.ok,
        referenceOnly: diagnostic.referenceOnly,
        missing: missingOriginalResourceReferences(diagnostic),
        checks: diagnostic.checks.map((check) => ({
            name: check.name,
            ok: check.ok,
            missing: check.details?.missing || [],
        })),
    };
}

function createMissingResourceManifest(manifest) {
    const defaultArcId = manifest.defaultArcId || getManifestArcBindings(manifest)[0]?.arcId;
    return {
        ...manifest,
        arcs: manifest.arcs.map((arc) => arc.arcId === defaultArcId
            ? {
                ...arc,
                sillyTavernBindings: {
                    ...arc.sillyTavernBindings,
                    worldBookRefs: [missingWorldBookName],
                },
            }
            : arc),
    };
}

function createMissingSeedManifest(manifest, arcId) {
    return {
        ...manifest,
        arcs: manifest.arcs.map((arc) => arc.arcId === arcId
            ? {
                ...arc,
                status: 'draft',
                sillyTavernBindings: {
                    ...arc.sillyTavernBindings,
                    target: {
                        ...arc.sillyTavernBindings.target,
                        chatSeedId: '',
                    },
                },
            }
            : arc),
    };
}

function createIsolatedFixtureManifest(manifest, suffix) {
    const id = `${manifest.id}-${suffix}`;
    const version = `${manifest.version}-${suffix}`;
    return {
        ...manifest,
        id,
        version,
        defaultArcId: manifest.defaultArcId,
        arcs: manifest.arcs.map((arc) => ({
            ...arc,
            arcBindingId: arc.arcBindingId
                .replace(`${manifest.id}:${manifest.version}:`, `${id}:${version}:`),
            scenarioId: id,
            scenarioVersion: version,
        })),
    };
}

function withExtraArc(manifest, arcId) {
    const sourceArc = manifest.arcs[0];
    const sourceBindings = sourceArc.sillyTavernBindings || {};
    const sourceTarget = sourceBindings.target || {};
    return {
        ...manifest,
        arcs: [
            ...manifest.arcs,
            {
                ...sourceArc,
                arcBindingId: `${manifest.id}:${manifest.version}:${arcId}:v1`,
                arcId,
                title: '测试备用入口',
                order: sourceArc.order + 1,
                sillyTavernBindings: {
                    ...sourceBindings,
                    target: {
                        ...sourceTarget,
                        chatSeedId: `${sourceTarget.chatSeedId || sourceBindings.chatSeedId}-alternate`,
                    },
                },
            },
        ],
    };
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });
}

function closeServer(server) {
    return new Promise((resolve) => {
        if (!server.listening) {
            resolve();
            return;
        }
        server.close(() => resolve());
        setTimeout(resolve, 5000).unref();
    });
}

function serverBaseUrl(server) {
    const { port } = server.address();
    return `http://127.0.0.1:${port}`;
}

function pickReleaseEvidence(release) {
    return {
        releaseId: release.releaseId,
        scenarioId: release.scenarioId,
        scenarioVersion: release.scenarioVersion,
        activeArcId: release.activeArcId,
        arcId: release.arcId,
        manifestUrl: release.manifestUrl,
    };
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const item = values[index];
        if (item === '--fixture') {
            parsed.fixture = values[index + 1] || '';
            index += 1;
        } else if (item === '--evidence') {
            parsed.evidence = values[index + 1] || '';
            index += 1;
        } else if (item === '--base-url') {
            parsed['base-url'] = values[index + 1] || '';
            index += 1;
        }
    }
    return parsed;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    return async function cookieFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        rememberSetCookies(cookies, response.headers);
        return response;
    };
}

function rememberSetCookies(cookies, headers) {
    const values = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean);
    for (const value of values) {
        for (const item of String(value).split(/,(?=\s*[^;,=\s]+=)/g)) {
            const firstPart = item.split(';')[0];
            const separator = firstPart.indexOf('=');
            if (separator > 0) {
                cookies.set(firstPart.slice(0, separator).trim(), firstPart.slice(separator + 1).trim());
            }
        }
    }
}
