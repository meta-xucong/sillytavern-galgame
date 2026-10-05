import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  BUILTIN_UNKNOWN_ASSETS,
  CATALOG_SCHEMA_VERSION,
  CATALOG_DRAFT_SCHEMA_VERSION,
  CATALOG_V2_SCHEMA_VERSION,
  CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
  CANDIDATE_DECISION_SCHEMA_VERSION,
  VISUAL_CORE_CONTEXT_RESPONSE_VERSION,
  VISUAL_CORE_CANDIDATE_DECISION_PLAN_VERSION,
  VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION,
  VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
  VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
  VISUAL_RUNTIME_HINTS_VERSION,
  VISUAL_RUNTIME_FIXED_INSTRUCTION,
  DICTIONARY_HASH,
  DICTIONARY_VERSION,
  PREVIOUS_DICTIONARY_HASH,
  PREVIOUS_DICTIONARY_VERSION,
  LEGACY_DICTIONARY_HASH,
  LEGACY_DICTIONARY_VERSION,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  scoreRuntimeCandidate,
  compareCandidateScores,
  createRuntimeV2MigrationPlan,
  executeRuntimeV2Migration,
  createRuntimeV3MigrationPlan,
  executeRuntimeV3Migration,
  ENTITY_TYPES,
  FileContentStore,
  FileVisualAnalysisCacheStore,
  FileVisualRestoreReplayStore,
  FileVisualBindingStore,
  FileVisualAssetStore,
  FileVisualControlStore,
  MemoryVisualCatalogMigrationJournalStore,
  MemoryContentStore,
  MemoryProofReplayStore,
  MemoryRestoreReplayStore,
  MemoryVisualBindingStore,
  MemoryVisualAssetStore,
  MemoryVisualControlStore,
  VISUAL_HTTP_ROUTE_ACCESS_MANIFEST,
  resolveVisualRouteAccess,
  migrationJournalHash,
  validateMigrationJournalRecord,
  startVisualAssetHttpServer,
  acquireVisualServiceDataRootLease,
  PNG_MIME,
  UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION,
  UPLOAD_SCHEMA_VERSION,
  SIMPLE_UPLOAD_SCHEMA_VERSION,
  VISUAL_CONTROL_SCHEMA_VERSION,
  createPngChunk,
  createUnknownCompatibilityReport,
  createVisualCandidateAssetInputFromAsset,
  createVisualCandidateDecision,
  normalizeVisibleValue,
  createVisualAssetService,
  isMainModule,
  parseRuntimeV2MigrationCliArgs,
  computeAssetMetadataHash,
  computeCatalogHash,
  encodePng,
  createCoreVisualCandidateDecisionPlan,
  createGlobalDisplayVisualProfile,
  parseVisualCandidateDecisionInputJson,
  validateUnknownCompatibilityReport,
  validateVisualCandidateDecision,
  validateVisualCandidateDecisionForInput,
  validateVisualCandidateDecisionInput,
  canonicalJson,
  base64UrlEncodeCanonical,
} from './server.mjs';
import { buildCharacterChannelsForMergedCatalog, importSideArtAssets } from './import-side-art-assets.mjs';
import { runPlayerCatalogRebuild } from './rebuild-player-catalog.mjs';
import {
  handlePresentationAnalysisProxyRequest,
  resolvePresentationAnalysisProxyRoute,
} from './presentation-analysis-proxy.mjs';

const ADMIN_TOKEN = 'test-admin-token';
const ORIGIN = 'http://127.0.0.1:41111';
const CORE_8000_ORIGIN = 'http://127.0.0.1:8000';
const CORE_8000_LOCALHOST_ORIGIN = 'http://localhost:8000';
const CORE_DEFAULT_ORIGIN = 'http://127.0.0.1:8001';
const CORE_DEFAULT_LOCALHOST_ORIGIN = 'http://localhost:8001';

async function main() {
  await testControlledLauncherStaticSecurity();
  await testVisualRouteAccessRegistry();
  await testPresentationAnalysisBrowserProxy();
  await testSlowPresentationAnalysisDoesNotBlockVisualReads();
  await testVisualDataRootLeaseStartupOrder();
  await testCatalogMigrationJournalRecovery();
  await testCatalogMigrationRecoveryRequestFence();
  await testPlayerCatalogMigrationIdempotentRevalidation();
  await testPlayerCatalogMigrationCli();
  await testCliEntrypoint();
  await testHealthAndAdminAuth();
  await testLocalAdminEntrypoint();
  await testLocalAdminExplicitCatalogMigration();
  await testVisualAiTaggingAnalysis();
  await testPersistedAnalysisErrorCodeRestart();
  await testConfiguredAnalyzerHttpBoundary();
  await testAnthropicMessagesVisionAdapter();
  await testOpenAiChatCompletionsVisionAdapter();
  await testSimpleVisualControlChapterOne();
  await testSimpleVisualUploadChapterTwo();
  await testSimpleVisualPublishChapterThree();
  await testAssetUploadAndCatalogLifecycle();
  await testCatalogChannelValidationAndRollback();
  await testCatalogChannelDecisionIsolation();
  await testLegacyVisualMatchChannelIsolation();
  await testSideArtImporterChannelMigration();
  await testCorePublishedCatalogReads();
  await testCoreVisualContextRoute();
  await testRuntimeVisualDecisionV2();
  await testAnthropicMessagesTextAdapter();
  await testOpenAiChatCompletionsTextAdapter();
  await testRuntimeDictionaryV2AndScorer();
  await testFileVisualAssetStoreRuntimeMigration();
  await testExplicitRuntimeV2MigrationGate();
  await testCoreVisualDecisionRoute();
  await testInternalAssetReadRoutes();
  await testImageSecurity();
  await testPersistenceAndTamperRejection();
  await testCandidateDecisionHelpers();
  await testCoreDeterministicMatcherHelpers();
  await testVisualMatchRouteAndBindingStore();
  await testForbiddenFutureRoutes();
  console.log('visual-asset-service CORE-2, CORE-3, CORE-4, VS-CODE-1, VS-CODE-2A, VS-CODE-2B-R, VS-CODE-2B-S-B, VS-CODE-3A-MA and VS-CODE-3B tests passed');
}

async function testVisualRouteAccessRegistry() {
  const routedSamples = [
    ['GET', '/v1/health', 'health'],
    ['GET', '/v1/presentation/health', 'presentation-analysis'],
    ['POST', '/v1/presentation/annotations', 'presentation-analysis'],
    ['POST', '/v1/presentation/scene-continuity', 'presentation-analysis'],
    ['GET', '/game-admin/', 'local-admin-static'],
    ['HEAD', '/game-admin/app.js', 'local-admin-static'],
    ['GET', '/v1/local-admin/visual/status', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/upload', 'local-admin-api'],
    ['GET', '/v1/local-admin/visual/catalog-migration/runtime', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalogs/draft', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalogs/catalog-stage/1/validate', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalogs/catalog-stage/1/publish', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalog-migration/preview', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalog-migration/activate', 'local-admin-api'],
    ['POST', '/v1/local-admin/visual/catalog-migration/rollback', 'local-admin-api'],
    ['OPTIONS', '/anything', 'cors-preflight'],
    ['POST', '/v1/visual-match', 'visual-match'],
    ['POST', '/v1/internal/visual-match', 'internal-visual-match'],
    ['POST', '/v1/internal/assets/metadata-resolve', 'internal-asset-metadata'],
    ['POST', '/v1/internal/assets/content-read', 'internal-asset-content'],
    ['POST', '/v1/visual/restore-bindings/rollback', 'restore-binding'],
    ['GET', '/v1/core/visual-context', 'core-read'],
    ['POST', '/v1/core/visual-decisions', 'core-write'],
    ['GET', '/v1/admin/catalog-migration/runtime', 'admin-read'],
    ['POST', '/v1/admin/catalog-migration/activate', 'admin-write'],
  ];
  for (const [method, pathname, route] of routedSamples) {
    assert.equal(resolveVisualRouteAccess(method, pathname)?.route, route, `${method} ${pathname} has one registered access route`);
  }
  assert.equal(resolveVisualRouteAccess('DELETE', '/v1/admin/visual/status'), null);
  assert.equal(resolveVisualRouteAccess('GET', '/v1/unregistered'), null);
  assert.equal(resolveVisualRouteAccess('POST', '/v1/presentation/annotations')?.access, 'READ',
    'the fixed annotation proxy does not mutate visual-service stores and must not block catalog reads');
  assert.equal(resolveVisualRouteAccess('POST', '/v1/presentation/scene-continuity')?.access, 'READ',
    'the fixed scene-analysis proxy does not mutate visual-service stores and must not block catalog reads');
  assert.equal(new Set(VISUAL_HTTP_ROUTE_ACCESS_MANIFEST.map((entry) => `${entry.method} ${entry.pathPattern}`)).size,
    VISUAL_HTTP_ROUTE_ACCESS_MANIFEST.length, 'route registry has no duplicate access entries');
  assert.deepEqual(new Set(VISUAL_HTTP_ROUTE_ACCESS_MANIFEST.map((entry) => entry.route)), new Set([
    'health', 'presentation-analysis', 'local-admin-static', 'local-admin-api', 'cors-preflight', 'visual-match', 'internal-visual-match',
    'internal-asset-metadata', 'internal-asset-content', 'restore-binding', 'core-read', 'core-write', 'admin-read', 'admin-write',
  ]), 'route manifest covers every HTTP dispatch family');
}

async function testVisualDataRootLeaseStartupOrder() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-lease-'));
  let initialized = false;
  let constructed = false;
  try {
    const started = await startVisualAssetHttpServer({
      dataRoot: root, host: '127.0.0.1', port: 0,
      createService(runtimeInfo) {
        constructed = true;
        assert.ok(existsSync(path.join(root, '.visual-asset-service.lease.json')), 'lease exists before stores/service are constructed');
        assert.ok(runtimeInfo.serviceInstanceId);
        return {
          service: {
            async initialize() { initialized = true; },
            handleRequest(_req, res) {
              assert.equal(initialized, true, 'no route can run before journal recovery/initialize');
              res.statusCode = 200;
              res.end('ready');
            },
          },
        };
      },
    });
    assert.equal(constructed, true);
    assert.equal(initialized, true);
    assert.equal(started.server.listening, true);
    assert.equal(started.runtimeInfo.port, started.server.address().port);
    const response = await fetch(`http://127.0.0.1:${started.runtimeInfo.port}/ready`);
    assert.equal(await response.text(), 'ready');
    await assert.rejects(() => acquireVisualServiceDataRootLease(root, { port: 0 }), (error) => error?.code === 'VISUAL_DATA_ROOT_IN_USE');
    await new Promise((resolve) => started.server.close(resolve));
    for (let attempt = 0; attempt < 20 && existsSync(path.join(root, '.visual-asset-service.lease.json')); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(existsSync(path.join(root, '.visual-asset-service.lease.json')), false, 'graceful close releases the matching lease');

    writeFileSync(path.join(root, '.visual-asset-service.lease.json'), JSON.stringify({
      schemaVersion: 'galgame.visual-service-data-root-lease.v1', serviceInstanceId: 'stale-instance',
      pid: 2147483647, startedAt: '2026-09-01T00:00:00.000Z', host: '127.0.0.1', port: 8798,
      dataRoot: process.platform === 'win32' ? root.toLowerCase() : root,
    }), 'utf8');
    const recoveredStaleLease = await acquireVisualServiceDataRootLease(root, { port: 0 });
    assert.equal(existsSync(path.join(root, '.visual-asset-service.lease.json')), true, 'dead PID lease is safely replaced with an exclusive live lease');
    await recoveredStaleLease.release();

    await assert.rejects(() => startVisualAssetHttpServer({
      dataRoot: root, port: 0,
      createService: () => ({ service: { async initialize() { throw new Error('injected recovery failure'); }, handleRequest() {} } }),
    }), /injected recovery failure/u);
    assert.equal(existsSync(path.join(root, '.visual-asset-service.lease.json')), false, 'failed recovery releases lease without listening');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testCatalogMigrationJournalRecovery() {
  const oldHash = `sha256:${'a'.repeat(64)}`;
  const newHash = `sha256:${'b'.repeat(64)}`;
  const oldPointer = { catalogId: 'catalog_journal_old', catalogRevision: 1, catalogHash: oldHash };
  const newPointer = { catalogId: 'catalog_journal_new', catalogRevision: 1, catalogHash: newHash };
  const oldControl = { schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION, enabled: true, activeCatalog: oldPointer, updatedAt: '2026-09-01T00:00:00.000Z' };
  const newControl = { schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION, enabled: true, activeCatalog: newPointer, updatedAt: '2026-09-02T00:00:00.000Z' };
  const makeRecord = (state) => {
    const record = {
      schemaVersion: 'galgame.visual-catalog-migration-journal.v1', action: 'activate', state,
      operationId: 'migration_12345678-abcd', sourceAssetStorePointer: oldPointer, sourceControlPointer: oldPointer,
      targetPointer: newPointer, oldControl, newControl, sourceCatalogHash: oldHash, targetCatalogHash: newHash,
      createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z', recordHash: '',
    };
    record.recordHash = migrationJournalHash(record);
    return record;
  };
  const prepared = makeRecord('PREPARED');
  validateMigrationJournalRecord(prepared);
  const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]))
      : value;
  const reordered = reverseKeys(prepared);
  assert.equal(migrationJournalHash(prepared), migrationJournalHash(reordered), 'journal hash follows canonical JSON key order');
  const tampered = structuredClone(prepared);
  tampered.newControl.enabled = false;
  assert.throws(() => validateMigrationJournalRecord(tampered), (error) => error?.code === 'VISUAL_CATALOG_RECOVERY_REQUIRED');
  const journalStore = new MemoryVisualCatalogMigrationJournalStore();
  await journalStore.setRecord(prepared);
  assert.deepEqual(await journalStore.getRecord(), prepared);
  await assert.rejects(() => journalStore.setRecord(tampered), (error) => error?.code === 'VISUAL_CATALOG_RECOVERY_REQUIRED');

  for (const state of ['PREPARED', 'COMMITTED']) {
    const assetStore = new MemoryVisualAssetStore();
    const contentStore = new MemoryContentStore();
    const controlStore = new MemoryVisualControlStore();
    const oldAsset = await seedJournalScene(assetStore, contentStore, `scene_journal_old_${state.toLowerCase()}`, [201, 20, 20]);
    const newAsset = await seedJournalScene(assetStore, contentStore, `scene_journal_new_${state.toLowerCase()}`, [20, 201, 20]);
    const oldCatalog = createCorePublishedCatalog([oldAsset], { catalogId: oldPointer.catalogId });
    const newCatalog = createCorePublishedCatalog([newAsset], { catalogId: newPointer.catalogId });
    oldCatalog.catalogHash = oldHash;
    newCatalog.catalogHash = newHash;
    oldCatalog.catalogHash = computeCatalogHash(oldCatalog);
    newCatalog.catalogHash = computeCatalogHash(newCatalog);
    const expectedOldPointer = { catalogId: oldCatalog.catalogId, catalogRevision: 1, catalogHash: oldCatalog.catalogHash };
    const expectedNewPointer = { catalogId: newCatalog.catalogId, catalogRevision: 1, catalogHash: newCatalog.catalogHash };
    const currentOldControl = { ...oldControl, activeCatalog: expectedOldPointer };
    const currentNewControl = { ...newControl, activeCatalog: expectedNewPointer };
    await assetStore.saveCatalog(oldCatalog);
    await assetStore.saveCatalog(newCatalog);
    await assetStore.setActiveCatalog(newCatalog);
    await controlStore.setControl(currentNewControl);
    const exactRecord = {
      ...makeRecord(state),
      sourceAssetStorePointer: expectedOldPointer,
      sourceControlPointer: expectedOldPointer,
      targetPointer: expectedNewPointer,
      oldControl: currentOldControl,
      newControl: currentNewControl,
      sourceCatalogHash: expectedOldPointer.catalogHash,
      targetCatalogHash: expectedNewPointer.catalogHash,
      recordHash: '',
    };
    exactRecord.recordHash = migrationJournalHash(exactRecord);
    const recoveryJournal = new MemoryVisualCatalogMigrationJournalStore();
    await recoveryJournal.setRecord(exactRecord);
    const service = createVisualAssetService({
      assetStore, contentStore, visualControlStore: controlStore, catalogMigrationJournalStore: recoveryJournal,
    });
    await service.initialize();
    const expectedPointer = state === 'PREPARED' ? expectedOldPointer : expectedNewPointer;
    assert.deepEqual((await controlStore.getControl()).activeCatalog, expectedPointer, `${state} journal recovery selects matching control pointer`);
    assert.deepEqual(await assetStore.getActiveCatalog(expectedPointer.catalogId), expectedPointer, `${state} journal recovery selects matching asset pointer`);
  }
}

async function testCatalogMigrationRecoveryRequestFence() {
  const cases = [
    { name: 'asset active index', kind: 'asset', failures: 4 },
    { name: 'control pointer', kind: 'control', failures: 4 },
    { name: 'migration journal', kind: 'journal', failures: 3 },
  ];
  for (const scenario of cases) {
    const fault = { assetSetFailures: 0, controlSetFailures: 0, journalReadFailures: 0, committedJournalFailures: 0 };
    class FaultAssetStore extends MemoryVisualAssetStore {
      async setActiveCatalog(catalog) {
        if (fault.assetSetFailures > 0) {
          fault.assetSetFailures -= 1;
          throw new Error(`injected ${scenario.name} recovery write failure`);
        }
        return super.setActiveCatalog(catalog);
      }
    }
    class FaultControlStore extends MemoryVisualControlStore {
      async setControl(control) {
        if (fault.controlSetFailures > 0) {
          fault.controlSetFailures -= 1;
          throw new Error('injected control pointer recovery write failure');
        }
        return super.setControl(control);
      }
    }
    class FaultJournalStore extends MemoryVisualCatalogMigrationJournalStore {
      async getRecord() {
        if (fault.journalReadFailures > 0) {
          fault.journalReadFailures -= 1;
          throw new Error('injected migration journal recovery read failure');
        }
        return super.getRecord();
      }
      async setRecord(record) {
        if (record.state === 'COMMITTED' && fault.committedJournalFailures > 0) {
          fault.committedJournalFailures -= 1;
          fault.journalReadFailures = scenario.failures;
          throw new Error('injected COMMITTED journal phase write failure');
        }
        return super.setRecord(record);
      }
    }

    const assetStore = new FaultAssetStore();
    const contentStore = new MemoryContentStore();
    const controlStore = new FaultControlStore();
    const journalStore = new FaultJournalStore();
    const fixture = await seedPlayerCatalogMigrationFixture({ assetStore, contentStore, controlStore });
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      corePlayerOrigins: [ORIGIN],
      assetStore,
      contentStore,
      visualControlStore: controlStore,
      catalogMigrationJournalStore: journalStore,
    });
    await service.initialize();
    if (scenario.kind === 'asset') fault.assetSetFailures = scenario.failures;
    if (scenario.kind === 'control') fault.controlSetFailures = scenario.failures;
    if (scenario.kind === 'journal') {
      fault.committedJournalFailures = 1;
    }

    await withServer(service, async (baseUrl) => {
      const activation = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/activate', { body: fixture.manifest });
      assert.equal(activation.status, 503, `${scenario.name}: activation surfaces recovery-required after injected commit/recovery faults: ${JSON.stringify(activation.body)}`);
      assert.equal(activation.body.error.code, 'VISUAL_CATALOG_RECOVERY_REQUIRED');

      const healthBlocked = await request(baseUrl, 'GET', '/v1/health', { token: null, origin: null });
      assert.equal(healthBlocked.status, 503, `${scenario.name}: health is fenced while recovery keeps failing`);
      assert.deepEqual(healthBlocked.body.readiness, { catalogRecovery: 'required' });
      assert.equal(JSON.stringify(healthBlocked.body).includes('injected'), false, `${scenario.name}: health does not expose recovery diagnostics`);
      assert.equal(JSON.stringify(healthBlocked.body).includes('dataRoot'), false);

      const coreBlocked = await request(baseUrl, 'GET', '/v1/core/visual-context', { token: null });
      assert.equal(coreBlocked.status, 503, `${scenario.name}: player routes remain closed while recovery fails`);
      assert.equal(coreBlocked.body.error.code, 'VISUAL_CATALOG_RECOVERY_REQUIRED');

      fault.assetSetFailures = 0;
      fault.controlSetFailures = 0;
      fault.journalReadFailures = 0;
      fault.committedJournalFailures = 0;
      const healthRecovered = await request(baseUrl, 'GET', '/v1/health', { token: null, origin: null });
      assert.equal(healthRecovered.status, 200, `${scenario.name}: a successful journal recovery reopens health`);
      const coreResponse = await fetch(`${baseUrl}/v1/core/visual-context`, { headers: { origin: ORIGIN, accept: 'application/json' } });
      const coreRecovered = { status: coreResponse.status, body: await coreResponse.json() };
      assert.equal(coreRecovered.status, 200, `${scenario.name}: a successful journal recovery reopens player routes`);
    });
  }
}

async function seedPlayerCatalogMigrationFixture({ assetStore, contentStore, controlStore }) {
  const definitions = [
    { assetId: 'asset_scene_migration_fixture', assetType: 'scene', role: 'background', width: 640, height: 360, tagCodes: ['scene.forest'], featureCodes: ['feature.dark'], color: [20, 60, 100] },
    { assetId: 'asset_character_migration_narrator', assetType: 'character', role: 'transparent-sprite', width: 320, height: 320, tagCodes: ['character.androgynous'], featureCodes: ['feature.transparent'], color: [180, 80, 40], channel: 'narrator' },
    { assetId: 'asset_character_migration_player', assetType: 'character', role: 'transparent-sprite', width: 320, height: 320, tagCodes: ['character.androgynous'], featureCodes: ['feature.transparent'], color: [40, 120, 80], channel: 'player' },
  ];
  const assets = [];
  for (const definition of definitions) {
    const png = makePng({ width: definition.width, height: definition.height, colorType: definition.assetType === 'character' ? 6 : 2, rgb: definition.color, alpha: 180 });
    const content = await contentStore.put(png, PNG_MIME);
    const asset = makeValidatedAssetRecord({
      assetId: definition.assetId,
      assetType: definition.assetType,
      role: definition.role,
      width: definition.width,
      height: definition.height,
      tagCodes: definition.tagCodes,
      featureCodes: definition.featureCodes,
      assetContentSha256: content.hash,
    });
    await assetStore.saveAsset(asset);
    assets.push({ asset, channel: definition.channel ?? null });
  }
  const sourceCatalog = createCorePublishedCatalog(assets.map(({ asset }) => asset), { catalogId: 'catalog_migration_fixture_source' });
  await assetStore.saveCatalog(sourceCatalog);
  await assetStore.setActiveCatalog(sourceCatalog);
  const sourcePointer = {
    catalogId: sourceCatalog.catalogId,
    catalogRevision: sourceCatalog.catalogRevision,
    catalogHash: sourceCatalog.catalogHash,
  };
  await controlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: sourcePointer,
    updatedAt: '2026-10-02T00:00:00.000Z',
  });
  const manifest = {
    schemaVersion: 'galgame.visual-player-catalog-manifest.v1',
    sourcePointer,
    targetCatalogId: 'catalog_migration_fixture_target',
    targetCatalogRevision: 1,
    createdAt: '2026-10-02T00:01:00.000Z',
    entries: assets.map(({ asset, channel }) => ({
      assetId: asset.assetId,
      assetVersion: asset.assetVersion,
      assetContentSha256: asset.assetContentSha256,
      assetMetadataHash: asset.assetMetadataHash,
      assetType: asset.assetType,
      channel,
      approvalReason: 'approved migration fixture',
    })),
  };
  return { manifest, sourceCatalog, sourcePointer };
}

async function testPlayerCatalogMigrationIdempotentRevalidation() {
  const assetStore = new MemoryVisualAssetStore();
  const contentStore = new MemoryContentStore();
  const controlStore = new MemoryVisualControlStore();
  const fixture = await seedPlayerCatalogMigrationFixture({ assetStore, contentStore, controlStore });
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore,
    contentStore,
    visualControlStore: controlStore,
  });
  await service.initialize();
  await withServer(service, async (baseUrl) => {
    const firstPreview = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/preview', { body: fixture.manifest });
    assert.equal(firstPreview.status, 200, JSON.stringify(firstPreview.body));
    assert.equal(firstPreview.body.idempotent, false);
    assert.equal(firstPreview.body.targetRefCount, fixture.manifest.entries.length);
    assert.equal(firstPreview.body.countsByType.scene, 1);
    assert.equal(firstPreview.body.countsByChannel.narrator, 1);
    assert.equal(firstPreview.body.countsByChannel.player, 1);

    const activated = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/activate', { body: fixture.manifest });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    const replayPreview = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/preview', { body: fixture.manifest });
    assert.equal(replayPreview.status, 200, JSON.stringify(replayPreview.body));
    assert.equal(replayPreview.body.idempotent, true);
    assert.deepEqual(replayPreview.body.oldPointer, replayPreview.body.newPointer);
    assert.equal(replayPreview.body.targetCatalogHash, activated.body.catalogHash);
    assert.equal(replayPreview.body.targetRefCount, fixture.manifest.entries.length);

    const changedChannels = structuredClone(fixture.manifest);
    const narratorEntry = changedChannels.entries.find((entry) => entry.channel === 'narrator');
    const playerEntry = changedChannels.entries.find((entry) => entry.channel === 'player');
    narratorEntry.channel = 'player';
    playerEntry.channel = 'narrator';
    const changed = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/preview', { body: changedChannels });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'VISUAL_CATALOG_MIGRATION_TARGET_CONFLICT');

    const changedAssetHash = structuredClone(fixture.manifest);
    changedAssetHash.entries[0].assetMetadataHash = `sha256:${'f'.repeat(64)}`;
    const invalidHash = await request(baseUrl, 'POST', '/v1/admin/catalog-migration/preview', { body: changedAssetHash });
    assert.equal(invalidHash.status, 409);
    assert.equal(invalidHash.body.error.code, 'VISUAL_CATALOG_MANIFEST_ASSET_HASH_MISMATCH');
  });
}

async function seedJournalScene(assetStore, contentStore, assetId, rgb) {
  const content = await contentStore.put(makePng({ width: 640, height: 360, colorType: 2, rgb }), PNG_MIME);
  const asset = makeValidatedAssetRecord({
    assetId, assetType: 'scene', role: 'background', width: 640, height: 360,
    assetContentSha256: content.hash, tagCodes: ['scene.exterior', 'scene.forest'], featureCodes: ['feature.dark'],
  });
  await assetStore.saveAsset(asset);
  return asset;
}

function assertControlledLauncherLifecycle(source) {
  const code = source.replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
  const launch = `$process = Start-Process -FilePath $nodeCommand -ArgumentList ('"' + $serverScript + '"') -WorkingDirectory $repoRoot`;
  assert.ok(code.includes(launch), 'must launch only the quoted script path');
  const cleanup = code.slice(code.lastIndexOf('} finally {'));
  for (const variable of ['$tokenVariable', '$runtimeTokenVariable']) {
    const remove = `Remove-Item -LiteralPath "Env:${variable}"`;
    assert.ok(code.split(remove).length >= 3, 'clear inherited and final wrapper token');
    assert.ok(cleanup.includes(remove), 'clear wrapper token in finally');
    assert.ok(cleanup.includes(`$childEnvironment.Remove(${variable})`), 'clear managed token reference in finally');
  }
  assert.ok(cleanup.includes("[Environment]::SetEnvironmentVariable($name, $previousChildEnvironment[$name], 'Process')"), 'restore non-secret environment in finally');
  assert.doesNotMatch(code, /(?:\.Arguments\s*=|-ArgumentList)[^\r\n]*(?:plainToken|tokenVariable|runtimeTokenVariable)/i);
}

async function testControlledLauncherStaticSecurity() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(new URL('./server.mjs', import.meta.url))), '..', '..');
  const launcherRoot = path.join(projectRoot, 'external-modules', 'process-supervisor', 'launchers');
  const controlledPs1Path = path.join(launcherRoot, 'StartGalgameVisualAnalyzerTest.ps1');
  const controlledCmdPath = path.join(launcherRoot, 'StartGalgameVisualAnalyzerTest.cmd');
  const ordinaryCmdPath = path.join(launcherRoot, 'StartGalgameVisualAssetService.cmd');
  for (const filePath of [controlledPs1Path, controlledCmdPath, ordinaryCmdPath]) {
    assert.ok(existsSync(filePath), `launcher file missing: ${filePath}`);
    assert.equal(readFileSync(filePath).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `launcher has BOM: ${filePath}`);
  }

  const controlled = readFileSync(controlledPs1Path, 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
  const controlledCmd = readFileSync(controlledCmdPath, 'utf8');
  const ordinary = readFileSync(ordinaryCmdPath, 'utf8');
  for (const value of [
    "$tokenVariable = 'GALGAME_VISUAL_ANALYZER_TOKEN'",
    "$runtimeTokenVariable = 'GALGAME_VISUAL_RUNTIME_TOKEN'",
    "Read-Host -Prompt '视觉服务密钥（隐藏输入）' -AsSecureString",
    'Remove-Item -LiteralPath "Env:$tokenVariable"',
    'Remove-Item -LiteralPath "Env:$runtimeTokenVariable"',
    "$childEnvironment['GALGAME_VISUAL_ANALYZER_BASE_URL'] = $analyzerBaseUrl",
    "$childEnvironment['GALGAME_VISUAL_ANALYZER_MODEL'] = $analyzerModel",
    "$childEnvironment['GALGAME_VISUAL_ANALYZER_REQUEST_STYLE'] = $requestStyle",
    "$childEnvironment['GALGAME_VISUAL_RUNTIME_BASE_URL'] = $analyzerBaseUrl",
    "$childEnvironment['GALGAME_VISUAL_RUNTIME_MODEL'] = $analyzerModel",
    "$childEnvironment['GALGAME_VISUAL_RUNTIME_REQUEST_STYLE'] = $runtimeRequestStyle",
    "$childEnvironment['GALGAME_VISUAL_ANALYZER_CACHE_SCOPE'] = 'controlled-analyzer-test-doubao-v1'",
    "$childEnvironment['GALGAME_VISUAL_RUNTIME_CACHE_SCOPE'] = 'controlled-runtime-live-v1'",
    '$childEnvironment[$tokenVariable] = $plainToken',
    '$childEnvironment[$runtimeTokenVariable] = $plainToken',
    '$childEnvironment.Remove($tokenVariable)',
    '$childEnvironment.Remove($runtimeTokenVariable)',
  ]) assert.ok(controlled.includes(value), `controlled launcher missing: ${value}`);
  assertControlledLauncherLifecycle(controlled);
  assert.throws(() => assertControlledLauncherLifecycle(controlled.replace('-ArgumentList', '-OtherArgument')), /quoted script path/);
  assert.throws(() => assertControlledLauncherLifecycle(controlled.replace('$childEnvironment.Remove($tokenVariable)', '# $childEnvironment.Remove($tokenVariable)')), /managed token reference/);

  assert.equal(/(?:\.Arguments\s*=|-ArgumentList)[^\r\n]*(?:plainToken|tokenVariable|runtimeTokenVariable)/i.test(controlled), false);
  const outputLines = controlled.split(/\r?\n/).filter((line) => /Write-(?:Host|Output|Error)|Write-ControlledLauncherLog/i.test(line));
  assert.equal(outputLines.some((line) => /\$(?:plainToken|tokenBstr)|GALGAME_VISUAL_(?:ANALYZER|RUNTIME)_TOKEN/i.test(line)), false);
  assert.ok(controlledCmd.includes('StartGalgameVisualAnalyzerTest.ps1'));
  assert.equal(/TOKEN\s*=/i.test(controlledCmd), false);
  assert.ok(ordinary.match(/set "GALGAME_VISUAL_ANALYZER_TOKEN="/i));
  assert.ok(ordinary.match(/set "GALGAME_VISUAL_RUNTIME_TOKEN="/i));
  const ordinaryTokenLines = ordinary.split(/\r?\n/).filter((line) => /GALGAME_VISUAL_(?:ANALYZER|RUNTIME)_TOKEN/i.test(line));
  assert.deepEqual(ordinaryTokenLines.map((line) => line.trim().toLowerCase()), [
    'set "galgame_visual_analyzer_token="',
    'set "galgame_visual_runtime_token="',
  ]);
  assert.equal(/aiself\.vip|doubao-seed|anthropic_messages/i.test(ordinary), false);
}

async function testRuntimeDictionaryV2AndScorer() {
  const makeAnalysis = (assetType, tagCodes, attributeCodes = [], confidence = 0.9) => ({
    schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
    status: 'ready',
    description: `${assetType} runtime analysis`,
    tagCodes,
    attributeCodes,
    confidence,
    analyzerVersion: 'runtime-v2-fixture',
    errorCode: null,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
  });
  const runtimeEntity = {
    entityType: 'scene',
    codes: ['scene.forest', 'scene.ruins', 'scene.city', 'scene.dungeon', 'scene.night'],
    confidence: 0.9,
    confidenceBand: 'explicit',
  };
  const input = { entityType: 'scene', visibleAttributeCodes: [], candidates: [] };
  const thresholdScores = [0.4, 0.6, 0.8].map((analysisConfidence) => scoreRuntimeCandidate(input, {
    assetId: 'asset_scene_runtime_v2',
    assetVersion: 1,
    assetType: 'scene',
    analysisStatus: 'ready',
    analysisTagCodes: ['scene.forest', 'scene.ruins', 'scene.city', 'scene.dungeon'],
    analysisAttributeCodes: [],
    analysisConfidence,
    negativeTagCodes: [],
  }, runtimeEntity, { recent: [] }).policy.score);
  assert.deepEqual(thresholdScores, [59, 60, 61]);
  const runtimeScore = (assetId, assetVersion, analysisConfidence, conflictCodes = [], legacyFields = {}) => ({
    candidate: { assetId, assetVersion, analysisConfidence, analysisOverlapCount: legacyFields.analysisOverlapCount || 0, negativeConflictCount: legacyFields.negativeConflictCount || 0 },
    policy: { score: 60, runtimeTerms: { conflictCodes } },
  });
  assert.ok(compareCandidateScores(runtimeScore('asset_runtime_conflict', 1, 0.99, ['scene.forest']), runtimeScore('asset_runtime_clean', 1, 0.1)) > 0);
  assert.ok(compareCandidateScores(runtimeScore('asset_runtime_low_confidence', 1, 0.7), runtimeScore('asset_runtime_high_confidence', 1, 0.8)) > 0);
  assert.ok(compareCandidateScores(runtimeScore('asset_runtime_v2', 2, 0.8), runtimeScore('asset_runtime_v1', 1, 0.8)) > 0);
  assert.ok(compareCandidateScores(runtimeScore('asset_runtime_z', 1, 0.8, [], { analysisOverlapCount: 99, negativeConflictCount: 0 }), runtimeScore('asset_runtime_a', 1, 0.8, [], { analysisOverlapCount: 0, negativeConflictCount: 99 })) > 0);
  assert.equal(scoreRuntimeCandidate(input, {
    assetId: 'asset_scene_runtime_conflict', assetVersion: 1, assetType: 'scene', analysisStatus: 'ready',
    analysisTagCodes: ['scene.forest'], analysisAttributeCodes: [], analysisConfidence: 0.9, negativeTagCodes: ['scene.forest'],
  }, runtimeEntity, { recent: [] }).policy.isUnknown, true);
  assert.equal(scoreRuntimeCandidate(input, {
    assetId: 'asset_scene_runtime_unavailable', assetVersion: 1, assetType: 'scene', analysisStatus: 'unavailable',
    analysisTagCodes: [], analysisAttributeCodes: [], analysisConfidence: 0, negativeTagCodes: [],
  }, runtimeEntity, { recent: [] }).policy.score, 0);
  const characterInput = { entityType: 'character', visibleAttributeCodes: ['character-explicit-name'], candidates: [] };
  const characterScore = scoreRuntimeCandidate(characterInput, {
    assetId: 'asset_character_runtime_v2', assetVersion: 1, assetType: 'character', analysisStatus: 'ready',
    analysisTagCodes: ['character.human'], analysisAttributeCodes: [], analysisConfidence: 0.9, negativeTagCodes: [],
  }, { entityType: 'character', codes: ['character.human'], confidence: 0.9, confidenceBand: 'explicit' }, { recent: [] });
  assert.equal(characterScore.policy.score, 59);
  assert.equal(characterScore.policy.runtimeTerms.capped, true);
  assert.deepEqual([...normalizeVisibleValue('female human')].sort(), ['character.feminine', 'character.human']);
  assert.deepEqual([...normalizeVisibleValue('male human')].sort(), ['character.human', 'character.masculine']);
  assert.deepEqual([...normalizeVisibleValue('human')].sort(), ['character.human']);
  assert.deepEqual([...normalizeVisibleValue('哥布林')], ['character.beastkin']);
  assert.deepEqual([...normalizeVisibleValue('骷髅')], ['character.undead']);
  assert.deepEqual([...normalizeVisibleValue('敌方战士')], ['character.armored']);
  const enemyScore = scoreRuntimeCandidate({
    entityType: 'character',
    visibleAttributeCodes: ['character-explicit-name', 'character-explicit-species'],
    visibleNormalizedCodes: ['character.beastkin'],
    candidates: [],
  }, {
    assetId: 'asset_character_enemy_goblin', assetVersion: 1, assetType: 'character', analysisStatus: 'ready',
    analysisTagCodes: ['character.beastkin'], analysisAttributeCodes: [], analysisConfidence: 0.95, negativeTagCodes: [],
  }, { entityType: 'character', codes: ['character.beastkin'], confidence: 0.95, confidenceBand: 'explicit' }, { recent: [] });
  assert.equal(enemyScore.policy.isUnknown, false);
  assert.ok(enemyScore.policy.score >= 60);
  const curatedFailedCharacter = scoreRuntimeCandidate({
    entityType: 'character',
    visibleAttributeCodes: ['character-explicit-name', 'character-explicit-species', 'character-explicit-gender-presentation'],
    visibleNormalizedCodes: ['character.undead', 'character.androgynous'],
    candidates: [],
  }, {
    assetId: 'asset_character_curated_failed', assetVersion: 1, assetType: 'character', analysisStatus: 'failed',
    tagCodes: ['character.undead', 'character.androgynous'],
    analysisTagCodes: [], analysisAttributeCodes: [], analysisConfidence: 0, negativeTagCodes: [],
  }, { entityType: 'character', codes: ['character.undead', 'character.androgynous'], confidence: 0.95, confidenceBand: 'explicit' }, { recent: [] });
  assert.equal(curatedFailedCharacter.policy.isUnknown, false);
  assert.ok(curatedFailedCharacter.policy.score >= 60);
  const feminineCharacter = makeValidatedAssetRecord({
    assetId: 'asset_character_feminine_dictionary',
    assetType: 'character',
    role: 'transparent-sprite',
    tagCodes: ['character.feminine', 'character.elf'],
    featureCodes: ['feature.transparent'],
    analysis: makeAnalysis('character', ['character.feminine', 'character.elf'], ['feature.transparent']),
    assetContentSha256: BUILTIN_UNKNOWN_ASSETS.character.assetContentSha256,
  });
  assert.deepEqual(feminineCharacter.analysis.tagCodes, ['character.feminine', 'character.elf']);

  const asset = makeValidatedAssetRecord({
    assetId: 'asset_scene_runtime_plan',
    assetType: 'scene',
    role: 'background',
    tagCodes: ['scene.forest'],
    featureCodes: ['feature.dark'],
    analysis: makeAnalysis('scene', ['scene.forest'], ['feature.dark']),
    assetContentSha256: BUILTIN_UNKNOWN_ASSETS.scene.assetContentSha256,
  });
  const catalog = createCorePublishedCatalog([asset], { catalogId: 'catalog_runtime_v2' });
  const plan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [asset],
    catalog,
    projection: coreProjection({ entities: [coreEntity('scene', { entityKey: 'entity_scene_runtime_v2001' })] }),
  }), {
    runtimeMode: true,
    runtimeHint: { schemaVersion: VISUAL_RUNTIME_HINTS_VERSION, status: 'ready', dictionaryVersion: DICTIONARY_VERSION, dictionaryHash: DICTIONARY_HASH, entities: [{ ...runtimeEntity, codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }] },
    visibleContext: { recent: [] },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.decisions[0].assetId, asset.assetId);
  assert.ok(plan.decisions[0].score >= 60);
  assert.equal(plan.decisions[0].scoreBand, 'medium');
  const unavailablePlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [asset],
    catalog,
    projection: coreProjection({ entities: [coreEntity('scene', { entityKey: 'entity_scene_runtime_unavailable1' })] }),
  }), {
    runtimeMode: true,
    runtimeHint: { schemaVersion: VISUAL_RUNTIME_HINTS_VERSION, status: 'unavailable', dictionaryVersion: DICTIONARY_VERSION, dictionaryHash: DICTIONARY_HASH, entities: [] },
  });
  assert.equal(unavailablePlan.ok, true, JSON.stringify(unavailablePlan));
  assert.equal(unavailablePlan.decisions[0].assetId, asset.assetId);
  assert.ok(unavailablePlan.decisions[0].score >= 60);

  const routeControlStore = new MemoryVisualControlStore();
  const routeAssetStore = new MemoryVisualAssetStore();
  const routeContentStore = new MemoryContentStore();
  for (const unknown of Object.values(BUILTIN_UNKNOWN_ASSETS)) {
    routeAssetStore.assets.set(routeAssetStore.key(unknown.assetId, unknown.assetVersion), structuredClone(unknown));
  }
  routeAssetStore.assets.set(routeAssetStore.key(asset.assetId, asset.assetVersion), structuredClone(asset));
  routeAssetStore.catalogs.set(routeAssetStore.catalogKey(catalog.catalogId, catalog.catalogRevision), structuredClone(catalog));
  routeAssetStore.activeCatalogs.set(catalog.catalogId, { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash });
  const routeService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    visualControlStore: routeControlStore,
    assetStore: routeAssetStore,
    contentStore: routeContentStore,
    visualRuntimeAnalyzer: async () => ({
      schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
      status: 'ready',
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }],
    }),
  });
  await routeControlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
    updatedAt: '2026-09-05T00:00:00.000Z',
  });
  const routeCurrent = { index: 3, role: 'character', speaker: 'Guide', text: 'The forest is quiet.' };
  const routeSourceHash = hashDigest(canonicalJson(routeCurrent));
  const routeProjection = coreProjection({
    sourceMessageIndex: routeCurrent.index,
    sourceMessageHash: routeSourceHash,
    entities: [coreEntity('scene', { entityKey: 'entity_scene_runtime_route001' })],
  });
  const routeBody = {
    schemaVersion: VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
    requestId: 'req_RUNTIME_ROUTE000001',
    projection: routeProjection,
    visibleContext: { current: routeCurrent, recent: [] },
    visualProfile: createGlobalDisplayVisualProfile({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash }),
    expectedProjectionHash: routeProjection.projectionHash,
    expectedSourceMessageHash: routeSourceHash,
    createdAt: '2026-09-05T00:00:00.000Z',
  };
  await withServer(routeService, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: routeBody });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.understandingStatus, 'ready');
    assert.equal(response.body.matcherVersion, 'vs-runtime-3');
    assert.equal(response.body.scorerVersion, 'vs-runtime-scorer-v3');
    assert.equal(response.body.decisions[0].assetId, asset.assetId);
    assert.ok(response.body.decisions[0].score >= 60);
  });

  const legacyAsset = {
    ...structuredClone(asset),
    dictionaryVersion: LEGACY_DICTIONARY_VERSION,
    dictionaryHash: LEGACY_DICTIONARY_HASH,
    analysis: {
      schemaVersion: 'galgame.visual-asset-analysis.v1',
      status: 'ready',
      description: 'legacy scene',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.8,
      analyzerVersion: 'legacy-fixture-v1',
      errorCode: null,
    },
  };
  legacyAsset.analysisStatus = 'ready';
  legacyAsset.assetMetadataHash = computeAssetMetadataHash(legacyAsset);
  const legacyCatalog = {
    ...structuredClone(catalog),
    dictionaryVersion: LEGACY_DICTIONARY_VERSION,
    dictionaryHash: LEGACY_DICTIONARY_HASH,
    assetRefs: [{ ...catalog.assetRefs[0], assetMetadataHash: legacyAsset.assetMetadataHash }],
  };
  legacyCatalog.catalogHash = computeCatalogHash(legacyCatalog);
  const migration = await createRuntimeV2MigrationPlan({
    catalog: legacyCatalog,
    assets: [legacyAsset],
    analyzeAsset: async () => makeAnalysis('scene', ['scene.forest'], ['feature.dark'], 0.95),
  });
  assert.equal(migration.ok, true);
  assert.equal(migration.catalog.dictionaryVersion, DICTIONARY_VERSION);
  assert.equal(migration.assets[0].analysis.schemaVersion, VISUAL_ANALYSIS_SCHEMA_VERSION);
  assert.equal(migration.assets[0].assetMetadataHash, computeAssetMetadataHash(migration.assets[0]));
  await assert.rejects(() => createRuntimeV2MigrationPlan({ catalog, assets: [asset], analyzeAsset: async () => makeAnalysis('scene', ['scene.forest']) }), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH');
  let transactionState = 'old-active';
  await assert.rejects(() => executeRuntimeV2Migration({
    catalog: legacyCatalog,
    assets: [legacyAsset],
    analyzeAsset: async () => makeAnalysis('scene', ['scene.forest']),
    transaction: {
      snapshot: async () => transactionState,
      stage: async () => { transactionState = 'partial-new-batch'; },
      activate: async () => { throw new Error('injected activation failure'); },
      rollback: async (snapshot) => { transactionState = snapshot; },
    },
  }), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ROLLED_BACK');
  assert.equal(transactionState, 'old-active');

  // Revision-2 catalogs remain readable and can be upgraded to the gender-aware
  // revision-3 dictionary without changing their source records.
  const previousAsset = {
    ...structuredClone(asset),
    dictionaryVersion: PREVIOUS_DICTIONARY_VERSION,
    dictionaryHash: PREVIOUS_DICTIONARY_HASH,
    analysis: {
      schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
      status: 'ready',
      description: 'previous scene',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.8,
      analyzerVersion: 'previous-fixture-v2',
      errorCode: null,
      dictionaryVersion: PREVIOUS_DICTIONARY_VERSION,
      dictionaryHash: PREVIOUS_DICTIONARY_HASH,
    },
  };
  previousAsset.assetMetadataHash = computeAssetMetadataHash(previousAsset);
  const previousCatalog = {
    ...structuredClone(catalog),
    dictionaryVersion: PREVIOUS_DICTIONARY_VERSION,
    dictionaryHash: PREVIOUS_DICTIONARY_HASH,
    assetRefs: [{ ...catalog.assetRefs[0], assetMetadataHash: previousAsset.assetMetadataHash }],
  };
  previousCatalog.catalogHash = computeCatalogHash(previousCatalog);
  const migrationV3 = await createRuntimeV3MigrationPlan({
    catalog: previousCatalog,
    assets: [previousAsset],
    analyzeAsset: async () => makeAnalysis('scene', ['scene.forest'], ['feature.dark'], 0.96),
  });
  assert.equal(migrationV3.sourceDictionaryVersion, PREVIOUS_DICTIONARY_VERSION);
  assert.equal(migrationV3.catalog.dictionaryVersion, DICTIONARY_VERSION);
  assert.equal(migrationV3.assets[0].analysis.dictionaryHash, DICTIONARY_HASH);
  let migrationV3State = 'old-active';
  await executeRuntimeV3Migration({
    catalog: previousCatalog,
    assets: [previousAsset],
    analyzeAsset: async () => makeAnalysis('scene', ['scene.forest'], ['feature.dark'], 0.96),
    transaction: {
      snapshot: async () => migrationV3State,
      stage: async () => { migrationV3State = 'staged'; },
      activate: async () => { migrationV3State = 'new-active'; },
      rollback: async (snapshot) => { migrationV3State = snapshot; },
    },
  });
  assert.equal(migrationV3State, 'new-active');

  const migrationPng = makePng({ colorType: 2, rgb: [71, 72, 73] });
  const migrationContentHash = `sha256:${createHash('sha256').update(migrationPng).digest('hex')}`;
  const serviceLegacyAsset = {
    ...structuredClone(legacyAsset),
    assetId: 'asset_scene_runtime_service',
    assetContentSha256: migrationContentHash,
  };
  serviceLegacyAsset.assetMetadataHash = computeAssetMetadataHash(serviceLegacyAsset);
  const legacyAssetRefForTest = (record) => ({
    assetId: record.assetId,
    assetVersion: record.assetVersion,
    assetType: record.assetType,
    assetContentSha256: record.assetContentSha256,
    assetMetadataHash: record.assetMetadataHash,
  });
  const serviceLegacyCatalog = {
    ...structuredClone(legacyCatalog),
    catalogId: 'catalog_runtime_service',
    assetRefs: [{ ...legacyAssetRefForTest(serviceLegacyAsset) }],
  };
  serviceLegacyCatalog.catalogHash = computeCatalogHash(serviceLegacyCatalog);
  const migrationAssetStore = new MemoryVisualAssetStore();
  migrationAssetStore.assets.set(migrationAssetStore.key(serviceLegacyAsset.assetId, serviceLegacyAsset.assetVersion), structuredClone(serviceLegacyAsset));
  migrationAssetStore.catalogs.set(migrationAssetStore.catalogKey(serviceLegacyCatalog.catalogId, serviceLegacyCatalog.catalogRevision), structuredClone(serviceLegacyCatalog));
  const migrationContentStore = new MemoryContentStore();
  await migrationContentStore.put(migrationPng, PNG_MIME);
  const migrationService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    assetStore: migrationAssetStore,
    contentStore: migrationContentStore,
    visualAnalyzer: async () => ({
      description: 'scene runtime analysis',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.95,
      analyzerVersion: 'runtime-v2-fixture',
    }),
  });
  let serviceMigrationState = 'old-active';
  const serviceMigration = await migrationService.migrateRuntimeV2Catalog({
    catalog: serviceLegacyCatalog,
    assets: [serviceLegacyAsset],
    transaction: {
      snapshot: async () => serviceMigrationState,
      stage: async (plan) => { serviceMigrationState = `staged:${plan.catalog.dictionaryVersion}`; },
      activate: async () => { serviceMigrationState = 'new-active'; },
      rollback: async (snapshot) => { serviceMigrationState = snapshot; },
    },
  });
  assert.equal(serviceMigration.catalog.dictionaryVersion, DICTIONARY_VERSION);
  assert.equal(serviceMigrationState, 'new-active');
}

async function testFileVisualAssetStoreRuntimeMigration() {
  const createFixture = async (prefix) => {
    const root = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    const assetStore = new FileVisualAssetStore(path.join(root, 'metadata'));
    const contentStore = new FileContentStore(path.join(root, 'content'));
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      assetStore,
      contentStore,
      visualAnalyzer: async () => ({
        description: 'migration fixture',
        tagCodes: ['scene.forest'],
        attributeCodes: ['feature.dark'],
        confidence: 0.95,
        analyzerVersion: 'migration-fixture-v2',
      }),
    });
    await service.initialize();
    const png = makePng({ colorType: 2, rgb: [91, 92, 93] });
    const uploaded = await service.uploadAsset(uploadBody(metadata({
      assetId: `scene_${prefix.replace(/[^a-z0-9]/g, '_')}`,
      tagCodes: [],
      featureCodes: [],
    }), png));
    const legacyAsset = {
      ...structuredClone(uploaded),
      status: 'published',
      dictionaryVersion: LEGACY_DICTIONARY_VERSION,
      dictionaryHash: LEGACY_DICTIONARY_HASH,
      analysisStatus: 'ready',
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v1',
        status: 'ready',
        description: 'legacy migration fixture',
        tagCodes: ['scene.forest'],
        attributeCodes: ['feature.dark'],
        confidence: 0.8,
        analyzerVersion: 'legacy-migration-fixture-v1',
        errorCode: null,
      },
    };
    legacyAsset.assetMetadataHash = computeAssetMetadataHash(legacyAsset);
    const legacyCatalog = {
      ...createCorePublishedCatalog([uploaded], { catalogId: `catalog_${prefix.replace(/[^a-z0-9]/g, '_')}` }),
      dictionaryVersion: LEGACY_DICTIONARY_VERSION,
      dictionaryHash: LEGACY_DICTIONARY_HASH,
      assetRefs: [{
        assetId: legacyAsset.assetId,
        assetVersion: legacyAsset.assetVersion,
        assetType: legacyAsset.assetType,
        assetContentSha256: legacyAsset.assetContentSha256,
        assetMetadataHash: legacyAsset.assetMetadataHash,
      }],
    };
    legacyCatalog.catalogHash = computeCatalogHash(legacyCatalog);
    const oldAsset = makeValidatedAssetRecord({ assetId: `scene_old_${prefix.replace(/[^a-z0-9]/g, '_')}`, assetType: 'scene', role: 'background', tagCodes: ['scene.forest'], featureCodes: ['feature.dark'] });
    await assetStore.saveAsset(oldAsset, { allowExactReplay: true });
    const oldCatalog = createCorePublishedCatalog([oldAsset], { catalogId: `catalog_old_${prefix.replace(/[^a-z0-9]/g, '_')}` });
    await assetStore.saveCatalog(oldCatalog);
    await assetStore.setActiveCatalog(oldCatalog);
    return { root, assetStore, contentStore, service, legacyAsset, legacyCatalog, oldCatalog };
  };

  const fixture = await createFixture('runtime-file-migration-success');
  const oldPointer = await fixture.assetStore.getActiveCatalog(fixture.oldCatalog.catalogId);
  const migrated = await fixture.service.migrateRuntimeV2Catalog({ catalog: fixture.legacyCatalog, assets: [fixture.legacyAsset] });
  assert.equal(migrated.catalog.dictionaryVersion, DICTIONARY_VERSION);
  assert.equal(fixture.assetStore.activeMigrationPointer.catalogHash, migrated.catalog.catalogHash);
  assert.deepEqual(await fixture.assetStore.getActiveCatalog(fixture.oldCatalog.catalogId), oldPointer);
  const batchEntries = readdirSync(path.join(fixture.root, 'metadata', 'migration-batches')).filter((name) => name.startsWith('batch_'));
  assert.equal(batchEntries.length, 1);
  const restarted = new FileVisualAssetStore(path.join(fixture.root, 'metadata'));
  const restartedCatalog = await restarted.getCatalog(migrated.catalog.catalogId, migrated.catalog.catalogRevision);
  assert.equal(restartedCatalog.catalogHash, migrated.catalog.catalogHash);
  assert.deepEqual(await restarted.getActiveCatalog(migrated.catalog.catalogId), {
    catalogId: migrated.catalog.catalogId,
    catalogRevision: migrated.catalog.catalogRevision,
    catalogHash: migrated.catalog.catalogHash,
  });
  assert.deepEqual(await restarted.getActiveCatalog(fixture.oldCatalog.catalogId), oldPointer);
  const repeated = await fixture.service.migrateRuntimeV2Catalog({ catalog: fixture.legacyCatalog, assets: [fixture.legacyAsset] });
  assert.equal(repeated.catalog.catalogHash, migrated.catalog.catalogHash);
  assert.equal(readdirSync(path.join(fixture.root, 'metadata', 'migration-batches')).filter((name) => name.startsWith('batch_')).length, 1);

  const ownedRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-owned-source-'));
  const ownedAssetRoot = path.join(ownedRoot, 'metadata');
  const ownedContentRoot = path.join(ownedRoot, 'content');
  const ownedControlRoot = path.join(ownedRoot, 'control');
  const ownedTypeFixtures = {
    scene: { role: 'background', tagCodes: ['scene.forest'], featureCodes: ['feature.dark'], png: { colorType: 2, rgb: [101, 102, 103] } },
    character: { role: 'transparent-sprite', tagCodes: ['character.armored'], featureCodes: ['feature.transparent'], png: { colorType: 6, rgb: [111, 112, 113], alpha: 0 } },
    equipment: { role: 'icon', tagCodes: ['equipment.weapon'], featureCodes: ['feature.blade'], png: { colorType: 2, rgb: [121, 122, 123] } },
    item: { role: 'icon', tagCodes: ['item.key'], featureCodes: ['feature.symbol'], png: { colorType: 2, rgb: [131, 132, 133] } },
    skill: { role: 'icon', tagCodes: ['skill.magic'], featureCodes: ['feature.arcane'], png: { colorType: 2, rgb: [141, 142, 143] } },
  };
  const ownedAnalysis = (assetType, analyzerVersion) => ({
    description: `owned ${assetType} migration analysis`,
    tagCodes: ownedTypeFixtures[assetType].tagCodes,
    attributeCodes: ownedTypeFixtures[assetType].featureCodes,
    confidence: 0.96,
    analyzerVersion,
  });
  const ownedSeedStore = new FileVisualAssetStore(ownedAssetRoot);
  const ownedSeedContent = new FileContentStore(ownedContentRoot);
  const ownedSeedService = createVisualAssetService({ adminToken: ADMIN_TOKEN, assetStore: ownedSeedStore, contentStore: ownedSeedContent, visualAnalyzer: async ({ assetType }) => ownedAnalysis(assetType, 'owned-source-v2') });
  await ownedSeedService.initialize();
  const ownedUploadedAssets = [];
  for (const [assetType, fixture] of Object.entries(ownedTypeFixtures)) {
    ownedUploadedAssets.push(await ownedSeedService.uploadAsset(uploadBody(metadata({
      assetId: `${assetType}_owned_source`,
      assetType,
      role: fixture.role,
      title: `Owned ${assetType}`,
      tagCodes: [],
      featureCodes: [],
    }), makePng(fixture.png))));
  }
  const ownedLegacyAssets = ownedUploadedAssets.map((ownedUploaded) => {
    const legacyAsset = {
      ...structuredClone(ownedUploaded),
      status: 'published',
      dictionaryVersion: LEGACY_DICTIONARY_VERSION,
      dictionaryHash: LEGACY_DICTIONARY_HASH,
      analysisStatus: 'ready',
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v1',
        status: 'ready',
        description: `owned legacy ${ownedUploaded.assetType}`,
        tagCodes: ownedTypeFixtures[ownedUploaded.assetType].tagCodes,
        attributeCodes: ownedTypeFixtures[ownedUploaded.assetType].featureCodes,
        confidence: 0.8,
        analyzerVersion: 'owned-source-v1',
        errorCode: null,
      },
    };
    legacyAsset.assetMetadataHash = computeAssetMetadataHash(legacyAsset);
    return legacyAsset;
  });
  const ownedLegacyCatalog = { ...createCorePublishedCatalog(ownedLegacyAssets, { catalogId: 'catalog_owned_source' }), dictionaryVersion: LEGACY_DICTIONARY_VERSION, dictionaryHash: LEGACY_DICTIONARY_HASH, assetRefs: ownedLegacyAssets.map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion, assetType: asset.assetType, assetContentSha256: asset.assetContentSha256, assetMetadataHash: asset.assetMetadataHash })) };
  ownedLegacyCatalog.catalogHash = computeCatalogHash(ownedLegacyCatalog);
  for (const ownedLegacyAsset of ownedLegacyAssets) {
    writeFileSync(path.join(ownedAssetRoot, 'assets', `${ownedLegacyAsset.assetId}-${ownedLegacyAsset.assetVersion}.json`), JSON.stringify({ schemaVersion: 'galgame.visual-asset-store-record.v1', asset: ownedLegacyAsset }), 'utf8');
  }
  writeFileSync(path.join(ownedAssetRoot, 'catalogs', `${ownedLegacyCatalog.catalogId}-${ownedLegacyCatalog.catalogRevision}.json`), JSON.stringify({ schemaVersion: 'galgame.visual-catalog-store-record.v1', catalog: ownedLegacyCatalog }), 'utf8');
  writeFileSync(path.join(ownedAssetRoot, 'active-catalogs', `${ownedLegacyCatalog.catalogId}.json`), JSON.stringify({ catalogId: ownedLegacyCatalog.catalogId, catalogRevision: ownedLegacyCatalog.catalogRevision, catalogHash: ownedLegacyCatalog.catalogHash }), 'utf8');
  let ownedStore = new FileVisualAssetStore(ownedAssetRoot);
  const legacySourceBeforeFailure = await ownedStore.getActiveMigrationSource();
  const failureService = createVisualAssetService({ adminToken: ADMIN_TOKEN, assetStore: ownedStore, contentStore: new FileContentStore(ownedContentRoot), visualControlStore: new FileVisualControlStore(ownedControlRoot), visualAnalyzer: async ({ assetType }) => ownedAnalysis(assetType, 'owned-source-v2') });
  await failureService.initialize();
  const originalWriteMigrationJson = ownedStore.writeMigrationJson.bind(ownedStore);
  ownedStore.writeMigrationJson = async (filePath, value) => {
    if (path.basename(filePath) === 'catalog.json') throw new Error('injected five-type catalog batch write failure');
    return originalWriteMigrationJson(filePath, value);
  };
  await assert.rejects(() => failureService.migrateRuntimeV2Catalog(), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ROLLED_BACK');
  assert.deepEqual(await ownedStore.getActiveMigrationSource(), legacySourceBeforeFailure);
  assert.equal(existsSync(path.join(ownedAssetRoot, 'active-migration.json')), false);
  assert.equal(readdirSync(path.join(ownedAssetRoot, 'migration-batches')).filter((name) => name.startsWith('batch_')).length, 0);

  ownedStore = new FileVisualAssetStore(ownedAssetRoot);
  const ownedService = createVisualAssetService({ adminToken: ADMIN_TOKEN, assetStore: ownedStore, contentStore: new FileContentStore(ownedContentRoot), visualControlStore: new FileVisualControlStore(ownedControlRoot), visualAnalyzer: async ({ assetType }) => ownedAnalysis(assetType, 'owned-source-v2') });
  await ownedService.initialize();
  const ownedMigration = await ownedService.migrateRuntimeV2Catalog();
  assert.equal(ownedMigration.catalog.dictionaryVersion, DICTIONARY_VERSION);
  assert.equal(ownedStore.activeMigrationPointer.catalogHash, ownedMigration.catalog.catalogHash);
  assert.equal(ownedMigration.assets.length, 5);
  assert.deepEqual(new Set(ownedMigration.assets.map((asset) => asset.assetType)), new Set(Object.keys(ownedTypeFixtures)));
  for (const migratedAsset of ownedMigration.assets) {
    assert.equal(migratedAsset.analysis.schemaVersion, VISUAL_ANALYSIS_SCHEMA_VERSION);
    assert.equal(migratedAsset.analysis.dictionaryVersion, DICTIONARY_VERSION);
    assert.equal(migratedAsset.analysis.dictionaryHash, DICTIONARY_HASH);
    assert.equal(migratedAsset.assetMetadataHash, computeAssetMetadataHash(migratedAsset));
    const migratedRef = ownedMigration.catalog.assetRefs.find((ref) => ref.assetId === migratedAsset.assetId && ref.assetVersion === migratedAsset.assetVersion);
    assert.deepEqual(migratedRef, {
      assetId: migratedAsset.assetId,
      assetVersion: migratedAsset.assetVersion,
      assetType: migratedAsset.assetType,
      assetContentSha256: migratedAsset.assetContentSha256,
      assetMetadataHash: migratedAsset.assetMetadataHash,
    });
  }

  const restartedContent = new FileContentStore(ownedContentRoot);
  const restartedOwnedStore = new FileVisualAssetStore(ownedAssetRoot);
  const restartedOwnedCatalog = await restartedOwnedStore.getCatalog(ownedMigration.catalog.catalogId, ownedMigration.catalog.catalogRevision);
  assert.equal(restartedOwnedCatalog.catalogHash, ownedMigration.catalog.catalogHash);
  assert.equal(restartedOwnedCatalog.assetRefs.length, 5);
  assert.deepEqual(new Set(restartedOwnedCatalog.assetRefs.map((ref) => ref.assetType)), new Set(Object.keys(ownedTypeFixtures)));
  assert.deepEqual(await restartedOwnedStore.getActiveCatalog(ownedMigration.catalog.catalogId), {
    catalogId: ownedMigration.catalog.catalogId,
    catalogRevision: ownedMigration.catalog.catalogRevision,
    catalogHash: ownedMigration.catalog.catalogHash,
  });
  for (const legacyAsset of ownedLegacyAssets) {
    const restartedAsset = await restartedOwnedStore.getAsset(legacyAsset.assetId, legacyAsset.assetVersion);
    assert.equal(restartedAsset.assetType, legacyAsset.assetType);
    assert.equal(restartedAsset.analysis.schemaVersion, VISUAL_ANALYSIS_SCHEMA_VERSION);
    assert.deepEqual(restartedAsset.analysis.tagCodes, ownedTypeFixtures[legacyAsset.assetType].tagCodes);
    assert.deepEqual(restartedAsset.analysis.attributeCodes, ownedTypeFixtures[legacyAsset.assetType].featureCodes);
    assert.equal(restartedAsset.analysis.dictionaryHash, DICTIONARY_HASH);
    assert.equal(restartedAsset.assetContentSha256, legacyAsset.assetContentSha256);
    const content = await restartedContent.get(legacyAsset.assetContentSha256);
    assert.equal(content.mime, PNG_MIME);
    assert.equal(`sha256:${sha256Hex(content.bytes)}`, legacyAsset.assetContentSha256);
  }

  const orphanBatchRoot = path.join(ownedAssetRoot, 'migration-batches');
  rmSync(path.join(ownedAssetRoot, 'active-migration.json'), { force: true });
  const orphanBatchName = readdirSync(orphanBatchRoot).find((name) => name.startsWith('batch_'));
  assert.ok(orphanBatchName);
  const recoveredStore = new FileVisualAssetStore(ownedAssetRoot);
  assert.equal(readdirSync(orphanBatchRoot).filter((name) => name.startsWith('batch_')).length, 0);
  assert.equal(await recoveredStore.getCatalog(ownedMigration.catalog.catalogId, ownedMigration.catalog.catalogRevision), null);

  const missingSourceRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-missing-source-'));
  const missingSourceService = createVisualAssetService({ adminToken: ADMIN_TOKEN, assetStore: new FileVisualAssetStore(missingSourceRoot), contentStore: new FileContentStore(path.join(missingSourceRoot, 'content')), visualAnalyzer: async () => ({}) });
  await missingSourceService.initialize();
  await assert.rejects(() => missingSourceService.migrateRuntimeV2Catalog(), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_SOURCE_MISSING');

  const inconsistentRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-inconsistent-source-'));
  const inconsistentStore = new FileVisualAssetStore(inconsistentRoot);
  writeFileSync(path.join(inconsistentRoot, 'active-catalogs', 'catalog_inconsistent.json'), JSON.stringify({ catalogId: 'catalog_inconsistent', catalogRevision: 1, catalogHash: `sha256:${'d'.repeat(64)}` }), 'utf8');
  assert.throws(() => new FileVisualAssetStore(inconsistentRoot), (error) => error?.code === 'VISUAL_CATALOG_METADATA_INVALID');

  const writeFailure = await createFixture('runtime-file-migration-write-failure');
  const writeMigrationJson = writeFailure.assetStore.writeMigrationJson.bind(writeFailure.assetStore);
  writeFailure.assetStore.writeMigrationJson = async (filePath, value) => {
    if (path.basename(filePath) === 'catalog.json') throw new Error('injected catalog batch write failure');
    return writeMigrationJson(filePath, value);
  };
  await assert.rejects(() => writeFailure.service.migrateRuntimeV2Catalog({ catalog: writeFailure.legacyCatalog, assets: [writeFailure.legacyAsset] }), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ROLLED_BACK');
  assert.deepEqual(await writeFailure.assetStore.getActiveCatalog(writeFailure.oldCatalog.catalogId), {
    catalogId: writeFailure.oldCatalog.catalogId,
    catalogRevision: writeFailure.oldCatalog.catalogRevision,
    catalogHash: writeFailure.oldCatalog.catalogHash,
  });
  assert.equal(readdirSync(path.join(writeFailure.root, 'metadata', 'migration-batches')).length, 0);
  assert.equal(await writeFailure.assetStore.getCatalog(writeFailure.legacyCatalog.catalogId, writeFailure.legacyCatalog.catalogRevision), null);

  const pointerFailure = await createFixture('runtime-file-migration-pointer-failure');
  const pointerBefore = await pointerFailure.assetStore.getActiveCatalog(pointerFailure.oldCatalog.catalogId);
  pointerFailure.assetStore.writeActiveMigrationPointer = async () => { throw new Error('injected active pointer failure'); };
  await assert.rejects(() => pointerFailure.service.migrateRuntimeV2Catalog({ catalog: pointerFailure.legacyCatalog, assets: [pointerFailure.legacyAsset] }), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ROLLED_BACK');
  assert.deepEqual(await pointerFailure.assetStore.getActiveCatalog(pointerFailure.oldCatalog.catalogId), pointerBefore);
  assert.equal(existsSync(path.join(pointerFailure.root, 'metadata', 'active-migration.json')), false);
  assert.equal(readdirSync(path.join(pointerFailure.root, 'metadata', 'migration-batches')).length, 0);

  const partialRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-partial-'));
  mkdirSync(path.join(partialRoot, 'migration-batches', '.tmp-batch_orphan'), { recursive: true });
  assert.throws(() => new FileVisualAssetStore(partialRoot), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_BATCH_INCOMPLETE');

  const malformedRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-malformed-'));
  const malformedStore = new FileVisualAssetStore(malformedRoot);
  const malformedBatchId = `batch_${'b'.repeat(32)}`;
  mkdirSync(path.join(malformedRoot, 'migration-batches', malformedBatchId, 'assets'), { recursive: true });
  writeFileSync(path.join(malformedRoot, 'migration-batches', malformedBatchId, 'manifest.json'), '{}', 'utf8');
  assert.throws(() => new FileVisualAssetStore(malformedRoot), (error) => error?.code === 'VISUAL_ASSET_MISSING_FIELD' || error?.code === 'VISUAL_RUNTIME_MIGRATION_BATCH_INVALID');

  const symlinkRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-symlink-'));
  const symlinkStore = new FileVisualAssetStore(symlinkRoot);
  const outsideBatchRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-outside-'));
  const symlinkBatchId = `batch_${'c'.repeat(32)}`;
  try {
    symlinkSync(outsideBatchRoot, path.join(symlinkRoot, 'migration-batches', symlinkBatchId), 'junction');
    assert.throws(() => new FileVisualAssetStore(symlinkRoot), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_SYMLINK_REJECTED');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') console.log('runtime migration symlink regression skipped:', error.code);
    else throw error;
  }

  const traversalRoot = mkdtempSync(path.join(os.tmpdir(), 'runtime-file-migration-traversal-'));
  writeFileSync(path.join(traversalRoot, 'active-migration.json'), JSON.stringify({
    schemaVersion: 'galgame.visual-runtime-v2-active-pointer.v1',
    batchId: '../escape',
    catalogId: 'catalog_escape',
    catalogRevision: 1,
    catalogHash: `sha256:${'a'.repeat(64)}`,
  }), 'utf8');
  assert.throws(() => new FileVisualAssetStore(traversalRoot), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID');
}

async function testExplicitRuntimeV2MigrationGate() {
  assert.deepEqual(parseRuntimeV2MigrationCliArgs(['--migrate-runtime-v2', '--dry-run']), { mode: 'dry-run' });
  assert.deepEqual(parseRuntimeV2MigrationCliArgs(['--migrate-runtime-v2', '--execute']), { mode: 'execute' });
  assert.equal(parseRuntimeV2MigrationCliArgs([]), null);
  assert.throws(() => parseRuntimeV2MigrationCliArgs(['--migrate-runtime-v2']), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_CLI_INVALID');
  assert.throws(() => parseRuntimeV2MigrationCliArgs(['--migrate-runtime-v2', '--execute', '--dry-run']), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_CLI_INVALID');

  const createLegacyFixture = async (prefix, analyzer) => {
    const root = mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
    const contentRoot = path.join(root, 'content');
    const metadataRoot = path.join(root, 'metadata');
    const controlRoot = path.join(root, 'control');
    const png = makePng({ colorType: 2, rgb: [201, 202, 203] });
    const contentStore = new FileContentStore(contentRoot);
    const content = await contentStore.put(png, PNG_MIME);
    const currentAsset = makeValidatedAssetRecord({ assetId: `scene_${prefix.replace(/[^a-z0-9]/g, '_')}`, assetType: 'scene', role: 'background', tagCodes: [], featureCodes: [] });
    currentAsset.assetContentSha256 = content.hash;
    const legacyAsset = {
      ...currentAsset,
      dictionaryVersion: LEGACY_DICTIONARY_VERSION,
      dictionaryHash: LEGACY_DICTIONARY_HASH,
      analysisStatus: 'ready',
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v1',
        status: 'ready',
        description: 'explicit migration fixture',
        tagCodes: ['scene.forest'],
        attributeCodes: ['feature.dark'],
        confidence: 0.8,
        analyzerVersion: 'legacy-explicit-v1',
        errorCode: null,
      },
    };
    legacyAsset.assetMetadataHash = computeAssetMetadataHash(legacyAsset);
    const catalog = {
      ...createCorePublishedCatalog([legacyAsset], { catalogId: `catalog_${prefix.replace(/[^a-z0-9]/g, '_')}` }),
      dictionaryVersion: LEGACY_DICTIONARY_VERSION,
      dictionaryHash: LEGACY_DICTIONARY_HASH,
      assetRefs: [legacyAsset].map((asset) => ({
        assetId: asset.assetId,
        assetVersion: asset.assetVersion,
        assetType: asset.assetType,
        assetContentSha256: asset.assetContentSha256,
        assetMetadataHash: asset.assetMetadataHash,
      })),
    };
    catalog.catalogHash = computeCatalogHash(catalog);
    mkdirSync(path.join(metadataRoot, 'assets'), { recursive: true });
    mkdirSync(path.join(metadataRoot, 'catalogs'), { recursive: true });
    mkdirSync(path.join(metadataRoot, 'active-catalogs'), { recursive: true });
    writeFileSync(path.join(metadataRoot, 'assets', `${legacyAsset.assetId}-${legacyAsset.assetVersion}.json`), JSON.stringify({ schemaVersion: 'galgame.visual-asset-store-record.v1', asset: legacyAsset }), 'utf8');
    writeFileSync(path.join(metadataRoot, 'catalogs', `${catalog.catalogId}-${catalog.catalogRevision}.json`), JSON.stringify({ schemaVersion: 'galgame.visual-catalog-store-record.v1', catalog }), 'utf8');
    writeFileSync(path.join(metadataRoot, 'active-catalogs', `${catalog.catalogId}.json`), JSON.stringify({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash }), 'utf8');
    const assetStore = new FileVisualAssetStore(metadataRoot);
    const controlStore = new FileVisualControlStore(controlRoot);
    await controlStore.setControl({
      schemaVersion: 'galgame.visual-control.v1',
      enabled: true,
      activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
      updatedAt: new Date().toISOString(),
    });
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      assetStore,
      contentStore,
      visualControlStore: controlStore,
      visualAnalyzer: analyzer,
    });
    await service.initialize();
    return { root, metadataRoot, controlRoot, assetStore, contentStore, controlStore, service, catalog, legacyAsset };
  };

  const readyFixture = await createLegacyFixture('runtime-explicit-migration', async () => ({
    description: 'migrated',
    tagCodes: ['scene.forest'],
    attributeCodes: ['feature.dark'],
    confidence: 0.95,
    analyzerVersion: 'explicit-v2',
  }));
  const oldPointer = { catalogId: readyFixture.catalog.catalogId, catalogRevision: 1, catalogHash: readyFixture.catalog.catalogHash };
  const beforeControl = await readyFixture.controlStore.getControl();
  const preview = await readyFixture.service.previewRuntimeV2CatalogMigration();
  assert.equal(preview.mode, 'dry-run');
  assert.deepEqual(preview.oldPointer, oldPointer);
  assert.equal(preview.analysisReady, true);
  assert.notDeepEqual(preview.newPointer, oldPointer);
  assert.deepEqual(await readyFixture.controlStore.getControl(), beforeControl);
  assert.equal(await readyFixture.assetStore.getCatalog(preview.newPointer.catalogId, preview.newPointer.catalogRevision), null);
  const executed = await readyFixture.service.migrateRuntimeV2CatalogAndActivateControl();
  assert.equal(executed.mode, 'execute');
  assert.deepEqual(executed.oldPointer, oldPointer);
  assert.deepEqual(executed.newPointer, preview.newPointer);
  const activatedControl = await readyFixture.controlStore.getControl();
  assert.deepEqual(activatedControl.activeCatalog, executed.newPointer);
  assert.equal(activatedControl.enabled, true);
  const restartedAssetStore = new FileVisualAssetStore(readyFixture.metadataRoot);
  const restartedControlStore = new FileVisualControlStore(readyFixture.controlRoot);
  assert.equal((await restartedAssetStore.getCatalog(executed.newPointer.catalogId, executed.newPointer.catalogRevision)).catalogHash, executed.newPointer.catalogHash);
  assert.deepEqual((await restartedControlStore.getControl()).activeCatalog, executed.newPointer);
  const repeated = await readyFixture.service.migrateRuntimeV2CatalogAndActivateControl();
  assert.equal(repeated.idempotent, true);
  assert.deepEqual(repeated.newPointer, executed.newPointer);
  rmSync(readyFixture.root, { recursive: true, force: true });

  const unavailableFixture = await createLegacyFixture('runtime-explicit-unavailable', async () => ({ status: 'unavailable', errorCode: 'ANALYZER_NOT_CONFIGURED' }));
  const unavailableControl = await unavailableFixture.controlStore.getControl();
  const unavailablePointer = { ...unavailableControl.activeCatalog };
  await assert.rejects(() => unavailableFixture.service.previewRuntimeV2CatalogMigration(), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ANALYSIS_UNAVAILABLE');
  await assert.rejects(() => unavailableFixture.service.migrateRuntimeV2CatalogAndActivateControl(), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ANALYSIS_UNAVAILABLE');
  assert.deepEqual((await unavailableFixture.controlStore.getControl()).activeCatalog, unavailablePointer);
  assert.deepEqual(await unavailableFixture.assetStore.getActiveMigrationSource(), { catalog: unavailableFixture.catalog, assets: [unavailableFixture.legacyAsset] });
  rmSync(unavailableFixture.root, { recursive: true, force: true });

  const controlFailureFixture = await createLegacyFixture('runtime-explicit-control-failure', async () => ({
    description: 'migrated', tagCodes: ['scene.forest'], attributeCodes: ['feature.dark'], confidence: 0.95, analyzerVersion: 'explicit-v2',
  }));
  const oldControl = await controlFailureFixture.controlStore.getControl();
  const originalSetControl = controlFailureFixture.controlStore.setControl.bind(controlFailureFixture.controlStore);
  controlFailureFixture.controlStore.setControl = async (control) => {
    if (control.activeCatalog?.catalogHash !== oldControl.activeCatalog.catalogHash) throw new Error('injected control write failure');
    return originalSetControl(control);
  };
  await assert.rejects(() => controlFailureFixture.service.migrateRuntimeV2CatalogAndActivateControl(), (error) => error?.code === 'VISUAL_RUNTIME_MIGRATION_ROLLED_BACK');
  assert.deepEqual(await controlFailureFixture.controlStore.getControl(), oldControl);
  assert.deepEqual(await controlFailureFixture.assetStore.getActiveMigrationSource(), { catalog: controlFailureFixture.catalog, assets: [controlFailureFixture.legacyAsset] });
  assert.equal(readdirSync(path.join(controlFailureFixture.metadataRoot, 'migration-batches')).filter((name) => name.startsWith('batch_')).length, 0);
  rmSync(controlFailureFixture.root, { recursive: true, force: true });
}

async function testCliEntrypoint() {
  const serverPath = fileURLToPath(new URL('./server.mjs', import.meta.url));
  const projectRoot = path.resolve(path.dirname(serverPath), '..', '..');
  const moduleUrl = pathToFileURL(serverPath).href;
  assert.equal(isMainModule(serverPath, moduleUrl), true);
  assert.equal(isMainModule(path.relative(process.cwd(), serverPath), moduleUrl), true);
  assert.equal(isMainModule(path.join(projectRoot, 'missing-server.mjs'), moduleUrl), false);
  assert.equal(isMainModule('', moduleUrl), false);

  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-cli-smoke-'));
  const originalCwd = process.cwd();
  try {
    for (const cwd of [projectRoot, path.dirname(serverPath), dataDir]) {
      process.chdir(cwd);
      assert.equal(isMainModule(path.relative(cwd, serverPath), moduleUrl), true);
      assert.equal(isMainModule('server.mjs', moduleUrl), cwd === path.dirname(serverPath), 'must not guess another checkout entry');
    }
  } finally { process.chdir(originalCwd); }

  let child = null;
  try {
    child = spawnVisualServiceCli(serverPath, projectRoot, dataDir);
    const firstPort = await waitForVisualServiceCli(child);
    const firstBaseUrl = `http://127.0.0.1:${firstPort}`;
    const firstHealth = await requestCliHealth(firstBaseUrl);
    assert.equal(firstHealth.service, 'galgame-visual-asset-service');
    assert.equal(firstHealth.visualControl.persistent, true);

    const bootstrap = await fetch(`${firstBaseUrl}/game-admin/`);
    const bootstrapHtml = await bootstrap.text();
    const cookie = bootstrap.headers.get('set-cookie') || '';
    const csrfToken = extractLocalAdminCsrf(bootstrapHtml);
    assert.equal(bootstrap.status, 200);
    assert.match(cookie, /galgame_visual_admin_session=/);
    assert.match(csrfToken, /^[A-Za-z0-9_-]{32,80}$/);

    const uploadResult = await localAdminRequest(firstBaseUrl, 'POST', '/v1/local-admin/visual/upload', {
      cookie,
      csrfToken,
      body: simpleUploadBody({
        assetType: 'scene',
        title: 'CLI restart smoke scene',
        imageBase64: makePng({ width: 2, height: 2, colorType: 2 }).toString('base64'),
      }),
    });
    assert.equal(uploadResult.status, 200, JSON.stringify(uploadResult.body));
    const publishResult = await localAdminRequest(firstBaseUrl, 'POST', '/v1/local-admin/visual/publish', {
      cookie,
      csrfToken,
      body: {},
    });
    assert.equal(publishResult.status, 409, JSON.stringify(publishResult.body));
    assert.equal(publishResult.body.error.code, 'EXPLICIT_CATALOG_REQUIRED');
    const persistedDraftRef = {
      assetId: uploadResult.body.asset.assetId,
      assetVersion: uploadResult.body.asset.assetVersion,
      contentHash: uploadResult.body.asset.assetContentSha256,
    };
    await stopVisualServiceCli(child);
    child = null;

    child = spawnVisualServiceCli(serverPath, projectRoot, dataDir);
    const secondPort = await waitForVisualServiceCli(child);
    const secondBaseUrl = `http://127.0.0.1:${secondPort}`;
    const secondHealth = await requestCliHealth(secondBaseUrl);
    assert.equal(secondHealth.visualControl.persistent, true);
    const secondBootstrap = await fetch(`${secondBaseUrl}/game-admin/`);
    const secondCookie = secondBootstrap.headers.get('set-cookie') || '';
    const secondCsrfToken = extractLocalAdminCsrf(await secondBootstrap.text());
    const status = await localAdminRequest(secondBaseUrl, 'GET', '/v1/local-admin/visual/status', {
      cookie: secondCookie,
      csrfToken: secondCsrfToken,
      origin: secondBaseUrl,
    });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.visual.activeCatalog, null);
    assert.equal(status.body.visual.enabled, false);
    const asset = await localAdminRequest(secondBaseUrl, 'GET', `/v1/local-admin/visual/status`, {
      cookie: secondCookie,
      csrfToken: secondCsrfToken,
      origin: secondBaseUrl,
    });
    assert.equal(asset.status, 200, JSON.stringify(asset.body));
    assert.equal(asset.body.visual.activeCatalog, null);
    assert.equal(persistedDraftRef.assetId, uploadResult.body.asset.assetId);
  } finally {
    if (child) await stopVisualServiceCli(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function spawnVisualServiceCli(serverPath, projectRoot, dataDir) {
  const child = spawn(process.execPath, [serverPath], {
    cwd: projectRoot,
    env: {
      ...process.env,
      GALGAME_VISUAL_ASSET_HOST: '127.0.0.1',
      GALGAME_VISUAL_ASSET_PORT: '0',
      GALGAME_VISUAL_ASSET_DATA_DIR: dataDir,
      GALGAME_VISUAL_ASSET_ADMIN_TOKEN: '',
      GALGAME_VISUAL_ASSET_ADMIN_ORIGINS: '',
      GALGAME_VISUAL_ANALYZER_BASE_URL: '',
      GALGAME_VISUAL_ANALYZER_TOKEN: '',
      GALGAME_VISUAL_ANALYZER_MODEL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.cliStdout = '';
  child.cliStderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { child.cliStdout += chunk; });
  child.stderr.on('data', (chunk) => { child.cliStderr += chunk; });
  return child;
}

async function waitForVisualServiceCli(child) {
  const port = await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(reject, new Error(`visual service CLI did not announce listening state; stderr=${child.cliStderr}`)), 5000);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off('data', check);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const check = () => {
      const match = child.cliStdout.match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) finish(resolve, Number(match[1]));
    };
    const onError = (error) => finish(reject, error);
    const onExit = (code, signal) => finish(reject, new Error(`visual service CLI exited before listening: code=${code}, signal=${signal}, stderr=${child.cliStderr}`));
    child.stdout.on('data', check);
    child.on('error', onError);
    child.on('exit', onExit);
    check();
  });
  assert.ok(Number.isInteger(port) && port > 0, `CLI smoke resolved invalid port ${port}`);
  return port;
}

async function requestCliHealth(baseUrl) {
  const healthResponse = await fetch(`${baseUrl}/v1/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200, JSON.stringify(health));
  assert.equal(health.ok, true, JSON.stringify(health));
  return health;
}

function extractLocalAdminCsrf(html) {
  return html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=([^;]+);/)?.[1]
    ? JSON.parse(html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=([^;]+);/)[1])
    : html.match(/galgame-visual-asset-csrf-token" content="([^"]+)"/)?.[1]
      || '';
}

async function stopVisualServiceCli(child) {
  const hasExited = () => child.exitCode !== null || child.signalCode !== null;
  const waitForExit = (timeoutMs) => Promise.race([
    new Promise((resolve) => {
      if (hasExited()) resolve();
      else child.once('exit', resolve);
    }),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  if (!hasExited()) child.kill('SIGTERM');
  await waitForExit(3000);
  if (!hasExited() && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await waitForExit(3000);
  }
  assert.equal(hasExited(), true, 'CLI smoke child process did not terminate during cleanup');
}

async function testVisualAiTaggingAnalysis() {
  const unavailableService = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(unavailableService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_ai_unavailable' }), makePng({ colorType: 2 }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.analysis.status, 'unavailable');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_NOT_CONFIGURED');
    assert.deepEqual(response.body.asset.analysis.tagCodes, []);
    assert.equal(JSON.stringify(response.body).includes(ADMIN_TOKEN), false);
    assert.equal(JSON.stringify(response.body).includes('GALGAME_'), false);
  });

  let calls = 0;
  const fakeAnalysis = {
    description: 'A quiet forest scene',
    tagCodes: ['scene.forest'],
    attributeCodes: ['feature.dark'],
    confidence: 0.91,
    analyzerVersion: 'fake-provider-v1',
  };
  const configuredService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async (requestBody) => {
      calls += 1;
      assert.equal(requestBody.schemaVersion, 'galgame.visual-analyzer-request.v1');
      assert.equal(requestBody.assetType, 'scene');
      assert.equal(requestBody.task.includes('closed visual tags'), true);
      assert.equal(requestBody.task.includes('all five fields'), true);
      assert.equal(requestBody.task.includes('Never omit a field'), true);
      assert.equal(requestBody.task.includes('confidence must be a JSON number strictly greater than 0 and less than or equal to 1'), true);
      assert.equal(requestBody.task.includes('percentage, string, zero, NaN or Infinity'), true);
      assert.equal(requestBody.task.includes('chat'), false);
      assert.equal(requestBody.task.includes('prompt'), false);
      return fakeAnalysis;
    },
  });
  await withServer(configuredService, async (baseUrl) => {
    const png = makePng({ colorType: 2, rgb: [101, 102, 103] });
    const first = await upload(baseUrl, metadata({ assetId: 'scene_ai_ready_1' }), png);
    const second = await upload(baseUrl, metadata({ assetId: 'scene_ai_ready_2' }), png);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(first.body.asset.analysis.status, 'ready');
    assert.deepEqual(first.body.asset.analysis.tagCodes, ['scene.forest']);
    assert.deepEqual(first.body.asset.analysis.attributeCodes, ['feature.dark']);
    assert.deepEqual(first.body.asset.analysis, second.body.asset.analysis);
    assert.equal(calls, 1);
  });

  const malformedService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async () => ({
      description: 'unsafe',
      tagCodes: ['scene.not-allowed'],
      attributeCodes: [],
      confidence: 1,
      analyzerVersion: 'fake-provider-v1',
      rawProviderResponse: 'must not persist',
    }),
  });
  await withServer(malformedService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_ai_failed' }), makePng({ colorType: 2 }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.analysis.status, 'failed');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_SCHEMA_INVALID');
    assert.equal(JSON.stringify(response.body).includes('rawProviderResponse'), false);
    assert.deepEqual(response.body.asset.analysis.tagCodes, []);
  });

  const nonFiniteConfidenceService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async () => ({ ...fakeAnalysis, confidence: Number.NaN }),
  });
  await withServer(nonFiniteConfidenceService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_ai_nonfinite_confidence' }), makePng({ colorType: 2, rgb: [3, 4, 5] }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.analysis.status, 'failed');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID');
  });

  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-ai-analysis-'));
  let restartCalls = 0;
  const persistentService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async () => {
      restartCalls += 1;
      return fakeAnalysis;
    },
    assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
    contentStore: new FileContentStore(path.join(rootDir, 'content')),
    analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
    visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
  });
  let persistedAsset;
  await withServer(persistentService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_ai_restart' }), makePng({ colorType: 2, rgb: [9, 8, 7] }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    persistedAsset = response.body.asset;
  });
  const restarted = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
    contentStore: new FileContentStore(path.join(rootDir, 'content')),
    analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
    visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
    visualAnalyzer: async () => {
      restartCalls += 1;
      return fakeAnalysis;
    },
  });
  await withServer(restarted, async (baseUrl) => {
    const read = await request(baseUrl, 'GET', `/v1/admin/assets/${persistedAsset.assetId}/1`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.equal(read.body.asset.analysis.status, 'ready');
    assert.equal(read.body.asset.assetMetadataHash, persistedAsset.assetMetadataHash);
    const sameContentNewAsset = await upload(baseUrl, metadata({ assetId: 'scene_ai_restart_new' }), makePng({ colorType: 2, rgb: [9, 8, 7] }));
    assert.equal(sameContentNewAsset.status, 200, JSON.stringify(sameContentNewAsset.body));
    assert.deepEqual(sameContentNewAsset.body.asset.analysis, persistedAsset.analysis);
  });
  assert.equal(restartCalls, 1);

  const changedScopeService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    analyzerCacheScope: 'fake-provider-v2',
    visualAnalyzer: async () => {
      restartCalls += 1;
      return fakeAnalysis;
    },
    assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
    contentStore: new FileContentStore(path.join(rootDir, 'content')),
    analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
    visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
  });
  await withServer(changedScopeService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_ai_restart_scope_change' }), makePng({ colorType: 2, rgb: [9, 8, 7] }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
  });
  assert.equal(restartCalls, 2);

  const invalidCacheRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-ai-analysis-invalid-cache-'));
  writeFileSync(path.join(invalidCacheRoot, `${'b'.repeat(64)}.json`), JSON.stringify({
    schemaVersion: 'galgame.visual-asset-analysis-cache-record.v1',
    cacheKey: `sha256:${'c'.repeat(64)}`,
    assetType: 'scene',
    contentHash: `sha256:${'d'.repeat(64)}`,
    analyzerScopeHash: `sha256:${'e'.repeat(64)}`,
    analysis: fakeAnalysis,
    rawProviderResponse: 'forbidden',
  }), 'utf8');
  assert.throws(
    () => new FileVisualAnalysisCacheStore(invalidCacheRoot),
    (error) => error?.code === 'VISUAL_ASSET_UNKNOWN_FIELD' || error?.code === 'VISUAL_ANALYSIS_CACHE_INVALID',
  );
}

async function testPersistedAnalysisErrorCodeRestart() {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-analysis-error-restart-'));
  const storeOptions = () => ({
    assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
    contentStore: new FileContentStore(path.join(rootDir, 'content')),
    analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
    visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
  });
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async () => ({
      description: 'invalid confidence fixture',
      tagCodes: ['scene.forest'],
      attributeCodes: [],
      confidence: 0,
      analyzerVersion: 'restart-fixture-v1',
    }),
    ...storeOptions(),
  });
  const png = makePng({ colorType: 2, rgb: [12, 13, 14] });
  let uploaded;
  await withServer(service, async (baseUrl) => {
    uploaded = await upload(baseUrl, metadata({ assetId: 'scene_persisted_error_new' }), png);
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    assert.equal(uploaded.body.asset.analysis.errorCode, 'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID');
  });

  const restartedStore = new FileVisualAssetStore(path.join(rootDir, 'metadata'));
  const restartedAsset = await restartedStore.getAsset(uploaded.body.asset.assetId, uploaded.body.asset.assetVersion);
  assert.equal(restartedAsset.analysis.errorCode, 'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID');

  const recordPath = path.join(rootDir, 'metadata', 'assets', `${uploaded.body.asset.assetId}-${uploaded.body.asset.assetVersion}.json`);
  const record = JSON.parse(readFileSync(recordPath, 'utf8'));
  record.asset.analysis.errorCode = 'ANALYZER_OUTPUT_CONFIDENCE_INVALID';
  record.asset.assetMetadataHash = computeAssetMetadataHash(record.asset);
  writeFileSync(recordPath, JSON.stringify(record), 'utf8');
  const legacyRestartedStore = new FileVisualAssetStore(path.join(rootDir, 'metadata'));
  const legacyAsset = await legacyRestartedStore.getAsset(uploaded.body.asset.assetId, uploaded.body.asset.assetVersion);
  assert.equal(legacyAsset.analysis.errorCode, 'ANALYZER_OUTPUT_CONFIDENCE_INVALID');
  rmSync(rootDir, { recursive: true, force: true });
}

async function testConfiguredAnalyzerHttpBoundary() {
  const analyzerToken = 'independent-fixture-token';
  const analyzerModel = 'independent-fixture-v1';
  const analyzerRequests = [];
  const analyzerResponses = [];
  const validAnalysis = {
    description: 'A quiet forest scene',
    tagCodes: ['scene.forest'],
    attributeCodes: ['feature.dark'],
    confidence: 0.91,
    analyzerVersion: 'independent-fixture-v1',
  };
  const analyzerRequestKeys = ['assetType', 'contentHash', 'imageBase64', 'model', 'schemaVersion', 'task'];

  await withRawServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // The service should handle malformed provider responses, not malformed fixture requests.
    }
    analyzerRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const response = analyzerResponses.shift() || { status: 200, body: validAnalysis };
    res.statusCode = response.status || 200;
    res.setHeader('content-type', 'application/json');
    res.end(response.raw !== undefined ? response.raw : JSON.stringify(response.body));
  }, async (analyzerBaseUrl) => {
    const configuredService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerToken,
      analyzerModel,
      analyzerCacheScope: 'http-fixture-v1',
    });
    await withServer(configuredService, async (baseUrl) => {
      const png = makePng({ colorType: 2, rgb: [41, 42, 43] });
      const first = await upload(baseUrl, metadata({ assetId: 'scene_http_ready' }), png);
      assert.equal(first.status, 200, JSON.stringify(first.body));
      assert.equal(first.body.asset.analysis.status, 'ready');
      assert.equal(first.body.asset.assetMetadataHash, computeAssetMetadataHash(first.body.asset));
      assert.equal(analyzerRequests.length, 1);
      const captured = analyzerRequests[0];
      assert.equal(captured.method, 'POST');
      assert.equal(captured.url, '/v1/analyze');
      assert.deepEqual(Object.keys(captured.body).sort(), analyzerRequestKeys.sort());
      assert.equal(captured.headers.authorization, `Bearer ${analyzerToken}`);
      assert.equal(captured.body.schemaVersion, 'galgame.visual-analyzer-request.v1');
      assert.equal(captured.body.model, analyzerModel);
      assert.equal(captured.body.assetType, 'scene');
      assert.equal(captured.body.contentHash, first.body.asset.assetContentSha256);
      assert.deepEqual(Buffer.from(captured.body.imageBase64, 'base64').subarray(0, 8), png.subarray(0, 8));
      assert.equal(captured.body.task.includes('chat'), false);
      assert.equal(captured.body.task.includes('prompt'), false);
      assert.equal(captured.body.task.includes('context'), false);
      assert.equal(captured.body.task.includes('resource'), false);
      assert.equal(captured.body.task.includes('confidence must be a JSON number strictly greater than 0 and less than or equal to 1'), true);
      assert.equal(JSON.stringify(first.body).includes(analyzerToken), false);

      const sameContent = await upload(baseUrl, metadata({ assetId: 'scene_http_ready_again' }), png);
      assert.equal(sameContent.status, 200, JSON.stringify(sameContent.body));
      assert.deepEqual(sameContent.body.asset.analysis, first.body.asset.analysis);
      assert.equal(analyzerRequests.length, 1, 'same content/type/scope must use the cache');
    });

    const rootDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-http-analysis-'));
    const storeOptions = () => ({
      assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
      contentStore: new FileContentStore(path.join(rootDir, 'content')),
      analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
      visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
    });
    const restartPng = makePng({ colorType: 2, rgb: [51, 52, 53] });
    let persistedAsset;
    const firstPersistentService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerToken,
      analyzerModel,
      analyzerCacheScope: 'http-restart-v1',
      ...storeOptions(),
    });
    await withServer(firstPersistentService, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_http_restart' }), restartPng);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      persistedAsset = response.body.asset;
    });
    const callsAfterFirstPersistentUpload = analyzerRequests.length;
    const restartedService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerToken,
      analyzerModel,
      analyzerCacheScope: 'http-restart-v1',
      ...storeOptions(),
    });
    await withServer(restartedService, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_http_restart_again' }), restartPng);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.asset.analysis, persistedAsset.analysis);
      assert.equal(analyzerRequests.length, callsAfterFirstPersistentUpload, 'file cache must survive service restart');
    });
    const changedScopeService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerToken,
      analyzerModel,
      analyzerCacheScope: 'http-restart-v2',
      ...storeOptions(),
    });
    await withServer(changedScopeService, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_http_restart_scope' }), restartPng);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.asset.analysis.status, 'ready');
    });
    assert.equal(analyzerRequests.length, callsAfterFirstPersistentUpload + 1, 'scope changes must reanalyze');
    rmSync(rootDir, { recursive: true, force: true });

    const badResponses = [
      {
        id: 'extra',
        body: { ...validAnalysis, rawProviderResponse: 'must not persist' },
        errorCode: 'ANALYZER_SCHEMA_INVALID',
      },
      {
        id: 'duplicate-required-key',
        raw: '{"description":"forest","description":"forest","tagCodes":["scene.forest"],"attributeCodes":[],"confidence":0.91,"analyzerVersion":"fixture-v1"}',
        errorCode: 'ANALYZER_SCHEMA_INVALID',
      },
      {
        id: 'duplicate-unknown-key',
        raw: '{"description":"forest","tagCodes":["scene.forest"],"attributeCodes":[],"confidence":0.91,"analyzerVersion":"fixture-v1","unexpected":1,"unexpected":2}',
        errorCode: 'ANALYZER_SCHEMA_INVALID',
      },
      {
        id: 'bom',
        raw: `\ufeff${JSON.stringify(validAnalysis)}`,
        errorCode: 'ANALYZER_INVALID_JSON',
      },
      {
        id: 'response-too-large',
        raw: JSON.stringify({ ...validAnalysis, description: 'x'.repeat(70_000) }),
        errorCode: 'ANALYZER_RESPONSE_TOO_LARGE',
      },
      {
        id: 'unknown-code',
        body: { ...validAnalysis, tagCodes: ['scene.not-allowed'] },
        errorCode: 'ANALYZER_UNKNOWN_CODE',
      },
      {
        id: 'long-description',
        body: { ...validAnalysis, description: 'x'.repeat(241) },
        errorCode: 'ANALYZER_SCHEMA_INVALID',
      },
      {
        id: 'url',
        body: { ...validAnalysis, description: 'https://example.invalid/image.png' },
        errorCode: 'ANALYZER_FORBIDDEN_FIELD',
      },
      {
        id: 'script',
        body: { ...validAnalysis, description: '<script>alert(1)</script>' },
        errorCode: 'ANALYZER_FORBIDDEN_FIELD',
      },
      {
        id: 'nan',
        raw: '{"description":"forest","tagCodes":["scene.forest"],"attributeCodes":[],"confidence":NaN,"analyzerVersion":"fixture-v1"}',
        errorCode: 'ANALYZER_INVALID_JSON',
      },
      {
        id: 'infinity',
        raw: '{"description":"forest","tagCodes":["scene.forest"],"attributeCodes":[],"confidence":Infinity,"analyzerVersion":"fixture-v1"}',
        errorCode: 'ANALYZER_INVALID_JSON',
      },
      {
        id: 'invalid-json',
        raw: 'not-json',
        errorCode: 'ANALYZER_INVALID_JSON',
      },
      {
        id: 'http-auth-401',
        status: 401,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_AUTH_ERROR',
      },
      {
        id: 'http-auth-403',
        status: 403,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_AUTH_ERROR',
      },
      {
        id: 'http-request-400',
        status: 400,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_REQUEST_INVALID',
      },
      {
        id: 'http-request-404',
        status: 404,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_REQUEST_INVALID',
      },
      {
        id: 'http-request-422',
        status: 422,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_REQUEST_INVALID',
      },
      {
        id: 'http-rate-limit-429',
        status: 429,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_RATE_LIMITED',
      },
      {
        id: 'http-upstream-500',
        status: 500,
        body: { error: 'redacted' },
        errorCode: 'ANALYZER_UPSTREAM_ERROR',
      },
      {
        id: 'http-upstream-503',
        status: 503,
        body: { error: 'unavailable' },
        errorCode: 'ANALYZER_UPSTREAM_ERROR',
      },
    ];
    const failureService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerToken,
      analyzerModel,
      analyzerCacheScope: 'http-failure-v1',
    });
    await withServer(failureService, async (baseUrl) => {
      for (const [index, testCase] of badResponses.entries()) {
        analyzerResponses.push(testCase);
        const assetId = `scene_http_bad_${testCase.id}`;
        const png = makePng({ colorType: 2, rgb: [70 + index, 80 + index, 90 + index] });
        const beforeRequestCount = analyzerRequests.length;
        const response = await upload(baseUrl, metadata({ assetId }), png);
        assert.equal(response.status, 200, `${testCase.id}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.asset.status, 'draft');
        assert.equal(response.body.asset.analysis.status, 'failed');
        assert.equal(response.body.asset.analysis.errorCode, testCase.errorCode, `${testCase.id}: ${JSON.stringify(response.body.asset.analysis)}`);
        assert.equal(analyzerRequests.length, beforeRequestCount + 1, `${testCase.id} must make one analyzer request`);
        assert.equal(JSON.stringify(response.body).includes('rawProviderResponse'), false);
        const read = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1`);
        assert.equal(read.status, 200, `${testCase.id} draft readback`);
        const content = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1/content`, { raw: true });
        assert.equal(content.status, 200, `${testCase.id} content readback`);
        assert.equal(content.headers.get('content-type'), PNG_MIME);
        assert.equal(`sha256:${sha256Hex(content.bytes)}`, response.body.asset.assetContentSha256);
      }
    });
  });

  await testAnalyzerTimeoutAndNetworkFailure(validAnalysis);

  const cacheFailureStore = {
    async initialize() {},
    async get() { return null; },
    async set() { throw new Error('fixture cache write failure'); },
  };
  const cacheFailureService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAnalyzer: async () => validAnalysis,
    analysisCacheStore: cacheFailureStore,
  });
  await withServer(cacheFailureService, async (baseUrl) => {
    const assetId = 'scene_cache_write_failure';
    const png = makePng({ colorType: 2, rgb: [111, 112, 113] });
    const response = await upload(baseUrl, metadata({ assetId }), png);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.status, 'draft');
    assert.equal(response.body.asset.analysis.status, 'failed');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_CACHE_WRITE_FAILED');
    const read = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1`);
    assert.equal(read.status, 200, JSON.stringify(read.body));
    const content = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1/content`, { raw: true });
    assert.equal(content.status, 200);
    assert.equal(`sha256:${sha256Hex(content.bytes)}`, response.body.asset.assetContentSha256);
  });
}

async function testAnalyzerTimeoutAndNetworkFailure(validAnalysis) {
  await withRawServer(async (req, res) => {
    for await (const _chunk of req) {
      // Drain the request before deliberately exceeding the service timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(validAnalysis));
  }, async (analyzerBaseUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl,
      analyzerModel: 'timeout-fixture-v1',
      analyzerTimeoutMs: 500,
    });
    await withServer(service, async (baseUrl) => {
      const assetId = 'scene_http_timeout';
      const response = await upload(baseUrl, metadata({ assetId }), makePng({ colorType: 2, rgb: [121, 122, 123] }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.asset.analysis.status, 'failed');
      assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_TIMEOUT');
      const content = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1/content`, { raw: true });
      assert.equal(content.status, 200);
    });
  });

  const unusedServer = http.createServer();
  await new Promise((resolve) => unusedServer.listen(0, '127.0.0.1', resolve));
  const unusedPort = unusedServer.address().port;
  await new Promise((resolve) => unusedServer.close(resolve));
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    analyzerBaseUrl: `http://127.0.0.1:${unusedPort}`,
    analyzerModel: 'network-fixture-v1',
    analyzerTimeoutMs: 500,
  });
  await withServer(service, async (baseUrl) => {
    const assetId = 'scene_http_network_failure';
    const response = await upload(baseUrl, metadata({ assetId }), makePng({ colorType: 2, rgb: [131, 132, 133] }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.analysis.status, 'failed');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_NETWORK_ERROR');
    const content = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1/content`, { raw: true });
    assert.equal(content.status, 200);
  });
}

async function testAnthropicMessagesVisionAdapter() {
  const analyzerToken = 'anthropic-fixture-token';
  const analyzerModel = 'doubao-fixture-v1';
  const analyzerRequests = [];
  const analyzerResponses = [];
  const analysisByType = {
    scene: { description: 'A quiet forest scene', tagCodes: ['scene.forest'], attributeCodes: ['feature.dark'] },
    character: { description: 'A transparent human character', tagCodes: ['character.human'], attributeCodes: ['feature.transparent'] },
    equipment: { description: 'A metal weapon icon', tagCodes: ['equipment.weapon'], attributeCodes: ['feature.metal'] },
    item: { description: 'A small key item', tagCodes: ['item.key'], attributeCodes: ['feature.small-object'] },
    skill: { description: 'An arcane magic skill', tagCodes: ['skill.magic'], attributeCodes: ['feature.arcane'] },
  };
  const roleByType = {
    scene: 'background',
    character: 'transparent-sprite',
    equipment: 'icon',
    item: 'icon',
    skill: 'icon',
  };
  const analysisFor = (assetType) => ({
    ...analysisByType[assetType],
    confidence: 0.93,
    analyzerVersion: 'anthropic-fixture-v1',
  });
  const envelope = (text, overrides = {}) => ({
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    ...overrides,
  });

  const invalidBaseUrls = [
    'https://example.invalid/v1?leak=1',
    'https://example.invalid/v1#fragment',
    'https://user:pass@example.invalid/v1',
    'https://example.invalid/not-v1',
    'https://example.invalid/v1/messages/extra',
  ];
  for (const invalidBaseUrl of invalidBaseUrls) {
    assert.throws(
      () => createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        adminOrigins: [ORIGIN],
        analyzerBaseUrl: invalidBaseUrl,
        analyzerToken,
        analyzerModel,
        analyzerRequestStyle: 'anthropic_messages_vision',
      }),
      (error) => error?.code === 'VISUAL_ANALYZER_CONFIG_INVALID',
      `invalid Anthropic base URL must fail closed: ${invalidBaseUrl}`,
    );
  }

  for (const [index, baseSuffix] of ['', '/v1', '/v1/'].entries()) {
    const endpointPaths = [];
    await withRawServer(async (req, res) => {
      endpointPaths.push(req.url);
      for await (const _chunk of req) {
        // Drain the request before returning the closed fixture response.
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(envelope(JSON.stringify(analysisFor('scene')))));
    }, async (rawBaseUrl) => {
      const service = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        adminOrigins: [ORIGIN],
        analyzerBaseUrl: `${rawBaseUrl}${baseSuffix}`,
        analyzerToken,
        analyzerModel,
        analyzerRequestStyle: 'anthropic_messages_vision',
        analyzerCacheScope: `anthropic-endpoint-${index}`,
      });
      await withServer(service, async (baseUrl) => {
        const response = await upload(
          baseUrl,
          metadata({ assetId: `scene_anthropic_endpoint_${index}`, tagCodes: [], featureCodes: [] }),
          makePng({ colorType: 2, rgb: [131 + index, 132 + index, 133 + index] }),
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.asset.analysis.status, 'ready');
      });
    });
    assert.deepEqual(endpointPaths, ['/v1/messages'], `Anthropic base ${baseSuffix || '<host>'} must resolve exactly once`);
  }

  await withRawServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      // The service owns request construction; malformed responses are tested below.
    }
    analyzerRequests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const response = analyzerResponses.shift() || { status: 200, body: envelope(JSON.stringify(analysisFor('scene'))) };
    res.statusCode = response.status || 200;
    res.setHeader('content-type', 'application/json');
    res.end(response.raw !== undefined ? response.raw : JSON.stringify(response.body));
  }, async (analyzerBaseUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${analyzerBaseUrl}/v1/`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'anthropic_messages_vision',
      analyzerCacheScope: 'anthropic-fixture-v1',
    });
    await withServer(service, async (baseUrl) => {
      const pngByType = {
        scene: makePng({ colorType: 2, rgb: [141, 142, 143] }),
        character: makePng({ colorType: 6, alpha: 0 }),
        equipment: makePng({ colorType: 2, rgb: [151, 152, 153] }),
        item: makePng({ colorType: 2, rgb: [161, 162, 163] }),
        skill: makePng({ colorType: 2, rgb: [171, 172, 173] }),
      };
      const uploads = {};
      for (const assetType of Object.keys(analysisByType)) {
        analyzerResponses.push({ body: envelope(JSON.stringify(analysisFor(assetType)), { model: analyzerModel }) });
        const response = await upload(
          baseUrl,
          metadata({
            assetId: `${assetType}_anthropic_ready`,
            assetType,
            role: roleByType[assetType],
            title: `Anthropic ${assetType}`,
            tagCodes: [],
            featureCodes: [],
          }),
          pngByType[assetType],
        );
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.asset.analysis.status, 'ready');
        assert.deepEqual(response.body.asset.analysis.tagCodes, analysisFor(assetType).tagCodes);
        assert.equal(response.body.asset.assetMetadataHash, computeAssetMetadataHash(response.body.asset));
        uploads[assetType] = response.body.asset;
      }
      assert.equal(analyzerRequests.length, 5);
      for (const [index, assetType] of Object.keys(analysisByType).entries()) {
        const captured = analyzerRequests[index];
        assert.equal(captured.method, 'POST');
        assert.equal(captured.url, '/v1/messages');
        assert.equal(captured.headers['x-api-key'], analyzerToken);
        assert.equal(captured.headers.authorization, undefined);
        assert.equal(captured.headers['anthropic-version'], '2023-06-01');
        assert.deepEqual(Object.keys(captured.body).sort(), ['max_tokens', 'messages', 'model', 'temperature']);
        assert.equal(captured.body.model, analyzerModel);
        assert.equal(captured.body.max_tokens, 512);
        assert.equal(captured.body.temperature, 0);
        assert.equal(captured.body.messages.length, 1);
        assert.equal(captured.body.messages[0].role, 'user');
        assert.deepEqual(Object.keys(captured.body.messages[0]).sort(), ['content', 'role']);
        assert.equal(captured.body.messages[0].content.length, 2);
        const [imageBlock, textBlock] = captured.body.messages[0].content;
        assert.deepEqual(Object.keys(imageBlock).sort(), ['source', 'type']);
        assert.deepEqual(Object.keys(imageBlock.source).sort(), ['data', 'media_type', 'type']);
        assert.equal(imageBlock.type, 'image');
        assert.equal(imageBlock.source.type, 'base64');
        assert.equal(imageBlock.source.media_type, PNG_MIME);
        assert.deepEqual(Buffer.from(imageBlock.source.data, 'base64').subarray(0, 8), pngByType[assetType].subarray(0, 8));
        assert.equal(textBlock.type, 'text');
        assert.equal(textBlock.text.includes('Allowed tagCodes'), true);
        assert.equal(textBlock.text.includes('chat'), false);
        assert.equal(textBlock.text.includes('prompt'), false);
        assert.equal(textBlock.text.includes('context'), false);
        assert.equal(textBlock.text.includes('resource'), false);
        assert.equal(JSON.stringify(uploads[assetType]).includes(analyzerToken), false);
      }

      const cached = await upload(
        baseUrl,
        metadata({ assetId: 'scene_anthropic_cached', assetType: 'scene', role: 'background', tagCodes: [], featureCodes: [] }),
        pngByType.scene,
      );
      assert.equal(cached.status, 200, JSON.stringify(cached.body));
      assert.deepEqual(cached.body.asset.analysis, uploads.scene.analysis);
      assert.equal(analyzerRequests.length, 5, 'same content/type/scope must use the anthropic cache');
    });

    const rootDir = mkdtempSync(path.join(os.tmpdir(), 'galgame-anthropic-analysis-'));
    const storeOptions = () => ({
      assetStore: new FileVisualAssetStore(path.join(rootDir, 'metadata')),
      contentStore: new FileContentStore(path.join(rootDir, 'content')),
      analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(rootDir, 'analysis-cache')),
      visualControlStore: new FileVisualControlStore(path.join(rootDir, 'control')),
    });
    const restartPng = makePng({ colorType: 2, rgb: [181, 182, 183] });
    analyzerResponses.push({ body: envelope(JSON.stringify(analysisFor('scene'))) });
    const firstPersistentService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${analyzerBaseUrl}/v1`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'anthropic_messages_vision',
      analyzerCacheScope: 'anthropic-restart-v1',
      ...storeOptions(),
    });
    await withServer(firstPersistentService, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_anthropic_restart', tagCodes: [], featureCodes: [] }), restartPng);
      assert.equal(response.status, 200, JSON.stringify(response.body));
    });
    const callsAfterFirstPersistentUpload = analyzerRequests.length;
    const restartedService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${analyzerBaseUrl}/v1`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'anthropic_messages_vision',
      analyzerCacheScope: 'anthropic-restart-v1',
      ...storeOptions(),
    });
    await withServer(restartedService, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_anthropic_restart_again', tagCodes: [], featureCodes: [] }), restartPng);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(analyzerRequests.length, callsAfterFirstPersistentUpload, 'anthropic cache must survive service restart');
    });
    rmSync(rootDir, { recursive: true, force: true });

    const validText = JSON.stringify(analysisFor('scene'));
    const malformedResponses = [
      { id: 'bad-json', text: '{"description":', errorCode: 'ANALYZER_INVALID_JSON' },
      { id: 'bad-fence', text: `\`\`\`json\n${validText}\n\`\`\` trailing`, errorCode: 'ANALYZER_INVALID_JSON' },
      { id: 'prose', text: `Here is the JSON: ${validText}`, errorCode: 'ANALYZER_INVALID_JSON' },
      { id: 'unknown-code', text: JSON.stringify({ ...analysisFor('scene'), tagCodes: ['scene.not-allowed'] }), errorCode: 'ANALYZER_OUTPUT_CODE_INVALID' },
      { id: 'unknown-field', text: JSON.stringify({ ...analysisFor('scene'), unexpected: true }), errorCode: 'ANALYZER_OUTPUT_UNKNOWN_FIELD' },
      { id: 'missing-field', text: JSON.stringify({ ...analysisFor('scene'), description: undefined }), errorCode: 'ANALYZER_OUTPUT_MISSING_FIELD' },
      { id: 'invalid-value', text: JSON.stringify({ ...analysisFor('scene'), confidence: 0 }), errorCode: 'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID' },
      { id: 'out-of-range', text: JSON.stringify({ ...analysisFor('scene'), confidence: 1.01 }), errorCode: 'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID' },
      { id: 'confidence-string', text: JSON.stringify({ ...analysisFor('scene'), confidence: '0.9' }), errorCode: 'ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID' },
      { id: 'invalid-description', text: JSON.stringify({ ...analysisFor('scene'), description: 7 }), errorCode: 'ANALYZER_OUTPUT_DESCRIPTION_INVALID' },
      { id: 'invalid-codes', text: JSON.stringify({ ...analysisFor('scene'), tagCodes: 'scene.forest' }), errorCode: 'ANALYZER_OUTPUT_CODES_INVALID' },
      { id: 'duplicate-codes', text: JSON.stringify({ ...analysisFor('scene'), attributeCodes: ['scene.forest'] }), errorCode: 'ANALYZER_OUTPUT_DUPLICATE_CODES' },
      { id: 'invalid-version', text: JSON.stringify({ ...analysisFor('scene'), analyzerVersion: '' }), errorCode: 'ANALYZER_OUTPUT_VERSION_INVALID' },
      { id: 'duplicate-key', text: '{"description":"forest","description":"forest","tagCodes":["scene.forest"],"attributeCodes":[],"confidence":0.93,"analyzerVersion":"fixture-v1"}', errorCode: 'ANALYZER_OUTPUT_DUPLICATE_FIELD' },
      { id: 'bom', text: `\ufeff${validText}`, errorCode: 'ANALYZER_INVALID_JSON' },
      { id: 'extra-block', body: { type: 'message', role: 'assistant', content: [{ type: 'text', text: validText }, { type: 'text', text: validText }] }, errorCode: 'ANALYZER_CONTENT_INVALID' },
      { id: 'invalid-content-block', body: { type: 'message', role: 'assistant', content: [{ type: 'image', source: { type: 'url', url: 'https://example.invalid' } }] }, errorCode: 'ANALYZER_CONTENT_INVALID' },
      { id: 'outer-unknown', body: { ...envelope(validText), unexpected: true }, errorCode: 'ANALYZER_ENVELOPE_INVALID' },
      { id: 'openai-envelope', body: { id: 'chatcmpl-fixture', choices: [{ message: { content: validText } }] }, errorCode: 'ANALYZER_ENVELOPE_INVALID' },
      { id: 'duplicate-envelope-key', raw: '{"type":"message","role":"assistant","content":[{"type":"text","text":' + JSON.stringify(validText) + '}],"content":[{"type":"text","text":' + JSON.stringify(validText) + '}]}', errorCode: 'ANALYZER_OUTPUT_DUPLICATE_FIELD' },
      { id: 'response-too-large', text: 'x'.repeat(70_000), errorCode: 'ANALYZER_RESPONSE_TOO_LARGE' },
    ];
    const failureService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${analyzerBaseUrl}/v1`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'anthropic_messages_vision',
      analyzerCacheScope: 'anthropic-failure-v1',
    });
    await withServer(failureService, async (baseUrl) => {
      for (const [index, testCase] of malformedResponses.entries()) {
        analyzerResponses.push(testCase.raw !== undefined
          ? { raw: testCase.raw }
          : { body: testCase.body || envelope(testCase.text) });
        const assetId = `scene_anthropic_bad_${testCase.id}`;
        const response = await upload(baseUrl, metadata({ assetId, tagCodes: [], featureCodes: [] }), makePng({ colorType: 2, rgb: [191 + index, 192 + index, 193 + index] }));
        assert.equal(response.status, 200, `${testCase.id}: ${JSON.stringify(response.body)}`);
        assert.equal(response.body.asset.analysis.status, 'failed', `${testCase.id}: ${JSON.stringify(response.body.asset.analysis)}`);
        assert.equal(response.body.asset.analysis.errorCode, testCase.errorCode);
        assert.equal(JSON.stringify(response.body).includes(analyzerToken), false);
        const content = await request(baseUrl, 'GET', `/v1/admin/assets/${assetId}/1/content`, { raw: true });
        assert.equal(content.status, 200, `${testCase.id} content must remain readable`);
      }
    });
  });

  await withRawServer(async (req, res) => {
    for await (const _chunk of req) {
      // Drain the request before deliberately exceeding the adapter timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(envelope(JSON.stringify(analysisFor('scene')))));
  }, async (analyzerBaseUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${analyzerBaseUrl}/v1`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'anthropic_messages_vision',
      analyzerTimeoutMs: 500,
    });
    await withServer(service, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({ assetId: 'scene_anthropic_timeout', tagCodes: [], featureCodes: [] }), makePng({ colorType: 2, rgb: [221, 222, 223] }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.asset.analysis.status, 'failed');
      assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_TIMEOUT');
    });
  });

  const missingTokenService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    analyzerBaseUrl: 'https://aiself.vip/v1',
    analyzerModel,
    analyzerRequestStyle: 'anthropic_messages_vision',
  });
  await withServer(missingTokenService, async (baseUrl) => {
    const response = await upload(baseUrl, metadata({ assetId: 'scene_anthropic_missing_token', tagCodes: [], featureCodes: [] }), makePng({ colorType: 2, rgb: [231, 232, 233] }));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.asset.analysis.status, 'unavailable');
    assert.equal(response.body.asset.analysis.errorCode, 'ANALYZER_NOT_CONFIGURED');
  });
}

function metadata(overrides = {}) {
  return {
    assetId: 'scene_ruined_hut',
    assetVersion: 1,
    assetType: 'scene',
    role: 'background',
    title: 'Ruined Hut',
    tagCodes: ['scene.interior', 'scene.ruins'],
    featureCodes: ['feature.wooden', 'feature.abandoned'],
    licenseCode: 'user-owned',
    sourceLabel: 'admin upload',
    ...overrides,
  };
}

async function withServer(service, fn) {
  const server = http.createServer(service.handleRequest);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withRawServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function request(baseUrl, method, pathname, { token = ADMIN_TOKEN, origin = ORIGIN, body, raw = false } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (origin !== null) headers.origin = origin;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
  }
  return { status: response.status, body: await response.json() };
}

async function localAdminRequest(baseUrl, method, pathname, { cookie = '', csrfToken = '', origin = baseUrl, body, authorization, raw = false } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (origin !== null) headers.origin = origin;
  if (csrfToken) headers['x-galgame-csrf-token'] = csrfToken;
  if (authorization) headers.authorization = authorization;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    return { status: response.status, headers: response.headers, text: await response.text(), bytes: Buffer.from(await response.arrayBuffer()) };
  }
  return { status: response.status, body: await response.json() };
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function uploadBody(meta = metadata(), png = makePng({ width: 2, height: 2, colorType: 2 })) {
  return {
    schemaVersion: UPLOAD_SCHEMA_VERSION,
    metadata: meta,
    imageBase64: png.toString('base64'),
  };
}

async function upload(baseUrl, meta, png) {
  return request(baseUrl, 'POST', '/v1/admin/assets/upload', { body: uploadBody(meta, png) });
}

async function publishCatalog(baseUrl, catalogId, catalogRevision, assetRefs, characterChannels = undefined) {
  const explicitCharacterChannels = characterChannels || [];
  if (!characterChannels) {
    for (const ref of assetRefs) {
      const asset = await request(baseUrl, 'GET', `/v1/admin/assets/${ref.assetId}/${ref.assetVersion}`);
      assert.equal(asset.status, 200, JSON.stringify(asset.body));
      if (asset.body.asset.assetType === 'character') {
        explicitCharacterChannels.push({ assetId: ref.assetId, assetVersion: ref.assetVersion, channel: 'character' });
      }
    }
  }
  const draft = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
    body: {
      schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
      catalogId,
      catalogRevision,
      assetRefs,
      characterChannels: explicitCharacterChannels,
    },
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  const validated = await request(baseUrl, 'POST', `/v1/admin/catalogs/${catalogId}/${catalogRevision}/validate`, { body: {} });
  assert.equal(validated.status, 200, JSON.stringify(validated.body));
  const published = await request(baseUrl, 'POST', `/v1/admin/catalogs/${catalogId}/${catalogRevision}/publish`, { body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  assert.equal(published.body.catalog.status, 'published');
  return published.body.catalog;
}

async function testHealthAndAdminAuth() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const health = await request(baseUrl, 'GET', '/v1/health', { token: null, origin: null });
    assert.equal(health.status, 200);
    assert.deepEqual(Object.keys(health.body).sort(), ['adminAuth', 'catalogStore', 'localAdmin', 'ok', 'schema', 'service', 'visualControl']);
    assert.equal(JSON.stringify(health.body).includes('token'), false);
    assert.equal(JSON.stringify(health.body).includes('path'), false);
    assert.equal(JSON.stringify(health.body).includes('assetCount'), false);

    const noToken = await request(baseUrl, 'POST', '/v1/admin/assets/upload', { token: null, body: uploadBody() });
    assert.equal(noToken.status, 401);
    const wrongToken = await request(baseUrl, 'POST', '/v1/admin/assets/upload', { token: 'wrong', body: uploadBody() });
    assert.equal(wrongToken.status, 401);
    const wrongOrigin = await request(baseUrl, 'POST', '/v1/admin/assets/upload', { origin: 'http://evil.example', body: uploadBody() });
    assert.equal(wrongOrigin.status, 403);
    const preflight = await fetch(`${baseUrl}/v1/admin/assets/upload`, {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization,content-type,accept');
  });

  const unconfigured = createVisualAssetService({ adminToken: '', adminOrigins: [ORIGIN] });
  await withServer(unconfigured, async (baseUrl) => {
    const result = await request(baseUrl, 'POST', '/v1/admin/assets/upload', { body: uploadBody() });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'VISUAL_ASSET_ADMIN_AUTH_UNCONFIGURED');
  });
}

async function testLocalAdminEntrypoint() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-local-admin-'));
  const firstStores = {
    assetStore: new FileVisualAssetStore(path.join(root, 'metadata')),
    contentStore: new FileContentStore(path.join(root, 'content')),
    visualControlStore: new FileVisualControlStore(path.join(root, 'control')),
  };
  const service = createVisualAssetService({
    adminToken: '',
    adminOrigins: [],
    ...firstStores,
  });
  let uploadedRef;
  await withServer(service, async (baseUrl) => {
    const directAdmin = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      token: null,
      origin: null,
      body: simpleUploadBody({ assetType: 'scene', title: 'Direct reject', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
    });
    assert.equal(directAdmin.status, 503);
    assert.equal(directAdmin.body.error.code, 'VISUAL_ASSET_ADMIN_AUTH_UNCONFIGURED');

    const htmlResponse = await fetch(`${baseUrl}/game-admin/`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    const cookie = htmlResponse.headers.get('set-cookie') || '';
    assert.match(cookie, /galgame_visual_admin_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal(html.includes(ADMIN_TOKEN), false);
    assert.equal(html.includes('Bearer'), false);
    assert.match(html, /GALGAME_VISUAL_ASSET_LOCAL_ADMIN=true/);
    assert.match(html, new RegExp(`galgame-visual-asset-service\" content=\"${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\"`));
    const csrfToken = html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=\"?([^\";<]+)\"?/)?.[1]
      || html.match(/galgame-visual-asset-csrf-token" content="([^"]+)"/)?.[1]
      || '';
    assert.match(csrfToken, /^[A-Za-z0-9_-]{32,80}$/);

    const noCookie = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/upload', {
      csrfToken,
      body: simpleUploadBody({ assetType: 'scene', title: 'No Cookie', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
    });
    assert.equal(noCookie.status, 401);
    assert.equal(noCookie.body.error.code, 'VISUAL_LOCAL_ADMIN_SESSION_REQUIRED');

    const wrongCsrf = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/upload', {
      cookie,
      csrfToken: 'wrong-local-admin-csrf-token-000000',
      body: simpleUploadBody({ assetType: 'scene', title: 'Wrong CSRF', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
    });
    assert.equal(wrongCsrf.status, 403);
    assert.equal(wrongCsrf.body.error.code, 'VISUAL_LOCAL_ADMIN_CSRF_REJECTED');

    const withAuthHeader = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/upload', {
      cookie,
      csrfToken,
      authorization: `Bearer ${ADMIN_TOKEN}`,
      body: simpleUploadBody({ assetType: 'scene', title: 'Header reject', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
    });
    assert.equal(withAuthHeader.status, 400);
    assert.equal(withAuthHeader.body.error.code, 'VISUAL_LOCAL_ADMIN_FORBIDDEN_TRANSPORT');

    const uploadResult = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/upload', {
      cookie,
      csrfToken,
      body: simpleUploadBody({ assetType: 'scene', title: 'Local Scene', imageBase64: makePng({ width: 2, height: 2, colorType: 2 }).toString('base64') }),
    });
    assert.equal(uploadResult.status, 200, JSON.stringify(uploadResult.body));
    assert.equal(uploadResult.body.ok, true);
    assert.equal(uploadResult.body.asset.assetType, 'scene');
    assert.equal(JSON.stringify(uploadResult.body).includes(ADMIN_TOKEN), false);

    const publishResult = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/publish', {
      cookie,
      csrfToken,
      body: {},
    });
    assert.equal(publishResult.status, 409, JSON.stringify(publishResult.body));
    assert.equal(publishResult.body.error.code, 'EXPLICIT_CATALOG_REQUIRED');
    uploadedRef = {
      assetId: uploadResult.body.asset.assetId,
      assetVersion: uploadResult.body.asset.assetVersion,
      contentHash: uploadResult.body.asset.assetContentSha256,
    };

    const status = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/status', { cookie, origin: baseUrl });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.visual.enabled, false);
    assert.equal(status.body.visual.activeCatalog, null);
  });

  const restarted = createVisualAssetService({
    adminToken: '',
    adminOrigins: [],
    assetStore: new FileVisualAssetStore(path.join(root, 'metadata')),
    contentStore: new FileContentStore(path.join(root, 'content')),
    visualControlStore: new FileVisualControlStore(path.join(root, 'control')),
  });
  await withServer(restarted, async (baseUrl) => {
    const htmlResponse = await fetch(`${baseUrl}/game-admin/`);
    const html = await htmlResponse.text();
    const cookie = htmlResponse.headers.get('set-cookie') || '';
    const csrfToken = html.match(/GALGAME_VISUAL_ASSET_CSRF_TOKEN=\"?([^\";<]+)\"?/)?.[1]
      || html.match(/galgame-visual-asset-csrf-token" content="([^"]+)"/)?.[1]
      || '';
    assert.ok(cookie);
    assert.ok(csrfToken);
    const status = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/status', { cookie, origin: baseUrl });
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.deepEqual(status.body.visual.activeCatalog, null);
    assert.equal(status.body.visual.enabled, false);
    assert.ok(uploadedRef.assetId);
  });
}

async function testPresentationAnalysisBrowserProxy() {
  const origin = CORE_DEFAULT_ORIGIN;
  const allowedOrigins = new Set([origin]);
  assert.equal(resolvePresentationAnalysisProxyRoute('GET', '/v1/presentation/health')?.upstreamPath, '/v1/health');
  assert.equal(resolvePresentationAnalysisProxyRoute('POST', '/v1/presentation/scene-continuity')?.versionHeader,
    'x-galgame-scene-continuity-version');
  assert.equal(resolvePresentationAnalysisProxyRoute('POST', '/v1/presentation/../admin')?.upstreamPath, undefined,
    'only the exact registered presentation paths are routable');

  const makeResponse = () => ({
    headers: {}, statusCode: 0, body: '', writableEnded: false, destroyed: false,
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body = '') { this.body = Buffer.from(body).toString('utf8'); this.writableEnded = true; },
  });
  const healthRes = makeResponse();
  let forwardedHealthUrl = '';
  await handlePresentationAnalysisProxyRequest({ method: 'GET', url: '/v1/presentation/health', headers: { origin } }, healthRes, {
    allowedOrigins,
    upstreamBaseUrl: 'http://127.0.0.1:41112',
    fetchImpl: async (url, options) => {
      forwardedHealthUrl = String(url);
      assert.equal(options.method, 'GET');
      assert.deepEqual(options.headers, { origin });
      return new Response(JSON.stringify({
        serviceReady: true,
        analyzerConfigured: true,
        analyzerScope: 'model:prompt.v1',
        sceneAnalyzerScope: 'model:scene.v2',
        apiKey: 'must not cross the response boundary',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(forwardedHealthUrl, 'http://127.0.0.1:41112/v1/health');
  assert.equal(healthRes.statusCode, 200);
  assert.equal(healthRes.headers['access-control-allow-origin'], undefined,
    'CORS headers are applied by the outer 8798 dispatcher');
  assert.deepEqual(JSON.parse(healthRes.body), {
    schemaVersion: 'galgame.presentation-analysis-proxy-health.v1',
    serviceReady: true,
    analyzerConfigured: true,
    analyzerScope: 'model:prompt.v1',
    sceneAnalyzerScope: 'model:scene.v2',
  }, 'health response is closed and excludes provider credentials');

  const sceneRequestBody = JSON.stringify({ schemaVersion: 'galgame.scene-continuity-analysis-request.v1', pageText: 'current visible page' });
  const sceneRes = makeResponse();
  let forwardedScene = null;
  await handlePresentationAnalysisProxyRequest({
    method: 'POST', url: '/v1/presentation/scene-continuity',
    headers: { origin, 'content-type': 'application/json', 'x-galgame-scene-continuity-version': '1', cookie: 'must-not-forward' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(sceneRequestBody); },
    once() {}, off() {},
  }, sceneRes, {
    allowedOrigins,
    upstreamBaseUrl: 'http://127.0.0.1:41112',
    fetchImpl: async (url, options) => {
      forwardedScene = { url: String(url), options };
      return new Response(JSON.stringify({ schemaVersion: 'galgame.scene-continuity-analysis.v1', requestId: 'test' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(forwardedScene.url, 'http://127.0.0.1:41112/v1/presentation/scene-continuity');
  assert.deepEqual(forwardedScene.options.headers, {
    origin,
    'content-type': 'application/json',
    'x-galgame-scene-continuity-version': '1',
  });
  assert.equal(forwardedScene.options.body, sceneRequestBody);
  assert.equal(sceneRes.statusCode, 200);

  const simpleSceneRes = makeResponse();
  let simpleForwardedScene = null;
  await handlePresentationAnalysisProxyRequest({
    method: 'POST', url: '/v1/presentation/scene-continuity',
    headers: { origin, 'content-type': 'text/plain' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(sceneRequestBody); },
    once() {}, off() {},
  }, simpleSceneRes, {
    allowedOrigins,
    upstreamBaseUrl: 'http://127.0.0.1:41112',
    fetchImpl: async (url, options) => {
      simpleForwardedScene = { url: String(url), options };
      return new Response(JSON.stringify({ schemaVersion: 'galgame.scene-continuity-analysis.v1', requestId: 'test' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(simpleSceneRes.statusCode, 200);
  assert.deepEqual(simpleForwardedScene.options.headers, {
    origin,
    'content-type': 'application/json',
    'x-galgame-scene-continuity-version': '1',
  }, 'simple browser transport is normalized to the fixed versioned analyzer contract');
  assert.equal(simpleForwardedScene.options.body, sceneRequestBody);

  const preflightRes = makeResponse();
  await handlePresentationAnalysisProxyRequest({
    method: 'OPTIONS', url: '/v1/presentation/scene-continuity',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,x-galgame-scene-continuity-version',
      'access-control-request-private-network': 'true',
    },
  }, preflightRes, { allowedOrigins });
  assert.equal(preflightRes.statusCode, 204);
  assert.equal(preflightRes.headers['access-control-allow-origin'], origin);
  assert.equal(preflightRes.headers['access-control-allow-private-network'], 'true');

  const simplePreflightRes = makeResponse();
  await handlePresentationAnalysisProxyRequest({
    method: 'OPTIONS', url: '/v1/presentation/scene-continuity',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-private-network': 'true',
    },
  }, simplePreflightRes, { allowedOrigins });
  assert.equal(simplePreflightRes.statusCode, 204, 'PNA preflight without non-safelisted headers is accepted');
  assert.equal(simplePreflightRes.headers['access-control-allow-origin'], origin);
  assert.equal(simplePreflightRes.headers['access-control-allow-private-network'], 'true');

  const healthPreflightRes = makeResponse();
  await handlePresentationAnalysisProxyRequest({
    method: 'OPTIONS', url: '/v1/presentation/health',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-private-network': 'true',
    },
  }, healthPreflightRes, { allowedOrigins });
  assert.equal(healthPreflightRes.statusCode, 204);
  assert.equal(healthPreflightRes.headers['access-control-allow-origin'], origin);
  assert.equal(healthPreflightRes.headers['access-control-allow-methods'], 'GET, OPTIONS');
  assert.equal(healthPreflightRes.headers['access-control-allow-private-network'], 'true');

  const deniedRes = makeResponse();
  await handlePresentationAnalysisProxyRequest({ method: 'GET', url: '/v1/presentation/health', headers: { origin: 'http://attacker.example' } }, deniedRes, {
    allowedOrigins,
    fetchImpl: async () => { throw new Error('disallowed origin reached upstream'); },
  });
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(JSON.parse(deniedRes.body).code, 'PRESENTATION_ORIGIN_REJECTED');

  const queryRes = makeResponse();
  await handlePresentationAnalysisProxyRequest({ method: 'GET', url: '/v1/presentation/health?key=never-forwarded', headers: { origin } }, queryRes, {
    allowedOrigins,
    fetchImpl: async () => { throw new Error('query-bearing URL reached upstream'); },
  });
  assert.equal(queryRes.statusCode, 400);
  assert.equal(JSON.parse(queryRes.body).code, 'INVALID_REQUEST');

  const badUpstreamRes = makeResponse();
  await assert.rejects(() => handlePresentationAnalysisProxyRequest({
    method: 'GET', url: '/v1/presentation/health', headers: { origin },
  }, badUpstreamRes, {
    allowedOrigins,
    upstreamBaseUrl: 'https://attacker.example',
    fetchImpl: async () => { throw new Error('unreachable'); },
  }), /fixed loopback HTTP origin/u);

  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith('http://127.0.0.1:8801/')) return originalFetch(input, init);
    upstreamCalls.push({ url, options: init });
    if (url.endsWith('/v1/health')) return new Response(JSON.stringify({
      serviceReady: true, analyzerConfigured: true, analyzerScope: 'integration', sceneAnalyzerScope: 'integration-scene',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ schemaVersion: url.endsWith('/annotations')
      ? 'galgame.presentation-annotation.v1' : 'galgame.scene-continuity-analysis.v1' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const service = createVisualAssetService({ corePlayerOrigins: [origin] });
    await withServer(service, async (baseUrl) => {
      const healthResponse = await originalFetch(`${baseUrl}/v1/presentation/health`, { headers: { origin } });
      assert.equal(healthResponse.status, 200);
      assert.equal(healthResponse.headers.get('access-control-allow-origin'), origin);
      assert.equal((await healthResponse.json()).sceneAnalyzerScope, 'integration-scene');

      const healthPreflight = await originalFetch(`${baseUrl}/v1/presentation/health`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      });
      assert.equal(healthPreflight.status, 204);
      assert.equal(healthPreflight.headers.get('access-control-allow-origin'), origin);
      assert.equal(healthPreflight.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
      assert.equal(healthPreflight.headers.get('access-control-allow-private-network'), 'true');

      const preflight = await originalFetch(`${baseUrl}/v1/presentation/scene-continuity`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-galgame-scene-continuity-version',
          'access-control-request-private-network': 'true',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

      const input = JSON.stringify({ schemaVersion: 'galgame.scene-continuity-analysis-request.v1', requestId: 'test-request' });
      const sceneResponse = await originalFetch(`${baseUrl}/v1/presentation/scene-continuity`, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-galgame-scene-continuity-version': '1',
          cookie: 'session=must-not-forward',
        },
        body: input,
      });
      assert.equal(sceneResponse.status, 200);
      assert.equal((await sceneResponse.json()).schemaVersion, 'galgame.scene-continuity-analysis.v1');
      const forwarded = upstreamCalls.find((call) => call.url.endsWith('/v1/presentation/scene-continuity'));
      assert.ok(forwarded);
      assert.deepEqual(forwarded.options.headers, {
        origin,
        'content-type': 'application/json',
        'x-galgame-scene-continuity-version': '1',
      });
      assert.equal(forwarded.options.body, input);

      const denied = await originalFetch(`${baseUrl}/v1/presentation/health`, {
        headers: { origin: 'http://attacker.example' },
      });
      assert.equal(denied.status, 403);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testSlowPresentationAnalysisDoesNotBlockVisualReads() {
  const origin = CORE_DEFAULT_ORIGIN;
  const service = createVisualAssetService({ corePlayerOrigins: [origin] });
  await service.initialize();
  const server = http.createServer(service.handleRequest);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const originalFetch = globalThis.fetch;
  let releaseSlowAnalysis;
  let announceSlowAnalysis;
  const slowAnalysis = new Promise((resolve) => { releaseSlowAnalysis = resolve; });
  const analysisEntered = new Promise((resolve) => { announceSlowAnalysis = resolve; });
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (url.origin !== 'http://127.0.0.1:8801') return originalFetch(input, options);
    if (url.pathname === '/v1/health') {
      return new Response(JSON.stringify({
        serviceReady: true,
        analyzerConfigured: true,
        analyzerScope: 'test:presentation.v1',
        sceneAnalyzerScope: 'test:scene-continuity.v1',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.pathname === '/v1/presentation/scene-continuity') {
      announceSlowAnalysis();
      await slowAnalysis;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error('unexpected analyzer route in visual-read concurrency test');
  };

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let analysisRequest;
  try {
    analysisRequest = originalFetch(`${baseUrl}/v1/presentation/scene-continuity`, {
      method: 'POST',
      headers: { origin, 'content-type': 'text/plain' },
      body: JSON.stringify({ schemaVersion: 'galgame.scene-continuity-analysis-request.v1' }),
      signal: AbortSignal.timeout(4_000),
    });
    let enteredTimeout;
    await Promise.race([
      analysisEntered,
      new Promise((_, reject) => {
        enteredTimeout = setTimeout(() => reject(new Error('slow analysis did not reach the test upstream')), 1_000);
      }),
    ]);
    clearTimeout(enteredTimeout);

    const startedAt = Date.now();
    const [contextResponse, healthResponse] = await Promise.all([
      originalFetch(`${baseUrl}/v1/core/visual-context`, {
        headers: { origin, accept: 'application/json' },
        signal: AbortSignal.timeout(1_500),
      }),
      originalFetch(`${baseUrl}/v1/presentation/health`, {
        headers: { origin, accept: 'application/json' },
        signal: AbortSignal.timeout(1_500),
      }),
    ]);
    assert.equal(contextResponse.status, 200, 'catalog/profile reads remain available during a slow analyzer request');
    assert.equal(healthResponse.status, 200, 'analyzer health remains available during a slow scene request');
    assert.ok(Date.now() - startedAt < 1_500, 'visual reads must not wait for the analyzer response');
    assert.equal((await contextResponse.json()).ok, true);
    assert.equal((await healthResponse.json()).analyzerConfigured, true);

    releaseSlowAnalysis();
    assert.equal((await analysisRequest).status, 200, 'the slow analysis request itself completes normally');
  } finally {
    releaseSlowAnalysis();
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testLocalAdminExplicitCatalogMigration() {
  const assetStore = new MemoryVisualAssetStore();
  const contentStore = new MemoryContentStore();
  const controlStore = new MemoryVisualControlStore();
  const fixture = await seedPlayerCatalogMigrationFixture({ assetStore, contentStore, controlStore });
  const service = createVisualAssetService({
    adminToken: '',
    adminOrigins: [],
    corePlayerOrigins: [ORIGIN],
    assetStore,
    contentStore,
    visualControlStore: controlStore,
  });
  await service.initialize();

  await withServer(service, async (baseUrl) => {
    const bootstrap = await fetch(`${baseUrl}/game-admin/`);
    const html = await bootstrap.text();
    const cookie = bootstrap.headers.get('set-cookie') || '';
    const csrfToken = extractLocalAdminCsrf(html);
    assert.equal(bootstrap.status, 200);
    assert.ok(cookie);
    assert.match(csrfToken, /^[A-Za-z0-9_-]{32,80}$/);

    const noSession = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/catalog-migration/runtime');
    assert.equal(noSession.status, 401);
    assert.equal(noSession.body.error.code, 'VISUAL_LOCAL_ADMIN_SESSION_REQUIRED');

    const wrongOrigin = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/preview', {
      cookie, csrfToken, origin: 'http://evil.example', body: fixture.manifest,
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.body.error.code, 'VISUAL_LOCAL_ADMIN_ORIGIN_REJECTED');

    const missingOrigin = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/preview', {
      cookie, csrfToken, origin: null, body: fixture.manifest,
    });
    assert.equal(missingOrigin.status, 403);
    assert.equal(missingOrigin.body.error.code, 'VISUAL_LOCAL_ADMIN_ORIGIN_REQUIRED');

    const forbiddenBearer = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/preview', {
      cookie, csrfToken, authorization: `Bearer ${ADMIN_TOKEN}`, body: fixture.manifest,
    });
    assert.equal(forbiddenBearer.status, 400);
    assert.equal(forbiddenBearer.body.error.code, 'VISUAL_LOCAL_ADMIN_FORBIDDEN_TRANSPORT');

    const wrongCsrf = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/preview', {
      cookie, csrfToken: 'wrong-local-admin-csrf-token-000000', body: fixture.manifest,
    });
    assert.equal(wrongCsrf.status, 403);
    assert.equal(wrongCsrf.body.error.code, 'VISUAL_LOCAL_ADMIN_CSRF_REJECTED');

    const badHost = await new Promise((resolve, reject) => {
      const request = http.request(new URL('/v1/local-admin/visual/catalog-migration/runtime', baseUrl), {
        method: 'GET',
        headers: { cookie, host: 'evil.example' },
      }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({
          status: response.statusCode,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        }));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(badHost.status, 403);
    assert.equal(badHost.body.error.code, 'VISUAL_LOCAL_ADMIN_LOOPBACK_REQUIRED');

    const forbiddenQuery = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/catalog-migration/runtime?source=active', {
      cookie,
    });
    assert.equal(forbiddenQuery.status, 400);
    assert.equal(forbiddenQuery.body.error.code, 'VISUAL_LOCAL_ADMIN_FORBIDDEN_TRANSPORT');

    const runtimeBefore = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/catalog-migration/runtime', {
      cookie, origin: baseUrl,
    });
    assert.equal(runtimeBefore.status, 200, JSON.stringify(runtimeBefore.body));
    assert.deepEqual(runtimeBefore.body.activePointer, fixture.sourcePointer);
    assert.equal(runtimeBefore.body.activeCatalogHash, fixture.sourcePointer.catalogHash);
    assert.equal(Object.hasOwn(runtimeBefore.body, 'dataRoot'), false);
    assert.equal(Object.hasOwn(runtimeBefore.body, 'pid'), false);

    const image = makePng({ width: 640, height: 360, colorType: 2, noise: true });
    const upload = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/upload', {
      cookie,
      csrfToken,
      body: simpleUploadBody({
        assetType: 'scene',
        title: 'Local-admin migration night city',
        imageBase64: image.toString('base64'),
        tagCodes: ['scene.city', 'scene.exterior', 'scene.night'],
        featureCodes: ['feature.stone', 'feature.dark', 'feature.warm'],
      }),
    });
    assert.equal(upload.status, 200, JSON.stringify(upload.body));
    assert.equal(upload.body.asset.status, 'draft');
    const uploadedAsset = upload.body.asset;

    const sourceCatalogCollision = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalogs/draft', {
      cookie,
      csrfToken,
      body: {
        schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
        catalogId: fixture.sourcePointer.catalogId,
        catalogRevision: fixture.sourcePointer.catalogRevision + 1,
        assetRefs: [{ assetId: uploadedAsset.assetId, assetVersion: uploadedAsset.assetVersion }],
      },
    });
    assert.equal(sourceCatalogCollision.status, 409);
    assert.equal(sourceCatalogCollision.body.error.code, 'VISUAL_LOCAL_ADMIN_STAGING_CATALOG_ID_ACTIVE');
    assert.deepEqual(await controlStore.getControl(), {
      schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
      enabled: true,
      activeCatalog: fixture.sourcePointer,
      updatedAt: '2026-10-02T00:00:00.000Z',
    }, 'local staging must reject the active player catalog id before writing another revision');
    assert.deepEqual(await assetStore.getActiveCatalog(fixture.sourcePointer.catalogId), fixture.sourcePointer,
      'local staging must preserve the active player catalog index when ids collide');

    const publishSourceCatalog = await localAdminRequest(baseUrl, 'POST', `/v1/local-admin/visual/catalogs/${fixture.sourcePointer.catalogId}/${fixture.sourcePointer.catalogRevision}/publish`, {
      cookie, csrfToken, body: {},
    });
    assert.equal(publishSourceCatalog.status, 409);
    assert.equal(publishSourceCatalog.body.error.code, 'VISUAL_LOCAL_ADMIN_STAGING_CATALOG_ID_ACTIVE');
    assert.deepEqual(await controlStore.getControl().then((control) => control.activeCatalog), fixture.sourcePointer,
      'local staging publish must not republish or rewrite the active player catalog');

    const simplePublish = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/publish', {
      cookie, csrfToken, body: {},
    });
    assert.equal(simplePublish.status, 409);
    assert.equal(simplePublish.body.error.code, 'EXPLICIT_CATALOG_REQUIRED');

    const stageCatalogId = 'catalog_local_ingest_fixture';
    assert.notEqual(stageCatalogId, fixture.sourcePointer.catalogId);
    assert.notEqual(stageCatalogId, fixture.manifest.targetCatalogId);
    const draft = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalogs/draft', {
      cookie,
      csrfToken,
      body: {
        schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
        catalogId: stageCatalogId,
        catalogRevision: 1,
        assetRefs: [{ assetId: uploadedAsset.assetId, assetVersion: uploadedAsset.assetVersion }],
      },
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal(draft.body.catalog.status, 'draft');

    const validateStage = await localAdminRequest(baseUrl, 'POST', `/v1/local-admin/visual/catalogs/${stageCatalogId}/1/validate`, {
      cookie, csrfToken, body: {},
    });
    assert.equal(validateStage.status, 200, JSON.stringify(validateStage.body));
    assert.equal(validateStage.body.catalog.status, 'validated');
    const publishStage = await localAdminRequest(baseUrl, 'POST', `/v1/local-admin/visual/catalogs/${stageCatalogId}/1/publish`, {
      cookie, csrfToken, body: {},
    });
    assert.equal(publishStage.status, 200, JSON.stringify(publishStage.body));
    assert.equal(publishStage.body.catalog.status, 'published');

    const publishedAsset = await assetStore.getAsset(uploadedAsset.assetId, uploadedAsset.assetVersion);
    assert.equal(publishedAsset.status, 'published');
    assert.notEqual(publishedAsset.assetMetadataHash, uploadedAsset.assetMetadataHash);
    assert.deepEqual(await assetStore.getActiveCatalog(fixture.sourcePointer.catalogId), fixture.sourcePointer,
      'publishing a separate ingest catalog must preserve the player source catalog index');
    const runtimeAfterStage = await localAdminRequest(baseUrl, 'GET', '/v1/local-admin/visual/catalog-migration/runtime', {
      cookie, origin: baseUrl,
    });
    assert.deepEqual(runtimeAfterStage.body.activePointer, fixture.sourcePointer,
      'publishing an ingest catalog must not switch the player control pointer');

    const manifest = {
      ...fixture.manifest,
      targetCatalogId: 'catalog_local_migration_target',
      targetCatalogRevision: 1,
      createdAt: '2026-10-04T00:00:00.000Z',
      entries: [
        ...fixture.manifest.entries,
        {
          assetId: publishedAsset.assetId,
          assetVersion: publishedAsset.assetVersion,
          assetContentSha256: publishedAsset.assetContentSha256,
          assetMetadataHash: publishedAsset.assetMetadataHash,
          assetType: 'scene',
          channel: null,
          approvalReason: 'Reviewed night city stage background with explicit city, exterior, night and stone taxonomy.',
        },
      ],
    };
    const preview = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/preview', {
      cookie, csrfToken, body: manifest,
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.ok, true);
    assert.equal(preview.body.idempotent, false);
    assert.equal(preview.body.oldPointer.catalogId, fixture.sourcePointer.catalogId);
    assert.equal(preview.body.sourceRefCount, fixture.sourceCatalog.assetRefs.length);
    assert.equal(preview.body.targetRefCount, fixture.sourceCatalog.assetRefs.length + 1);
    assert.equal(preview.body.countsByType.scene, 2);
    assert.equal(preview.body.countsByChannel.narrator, 1);
    assert.equal(preview.body.countsByChannel.player, 1);
    assert.equal(preview.body.countsByChannel.system, 0);
    assert.equal(preview.body.duplicateContentCount, 0);
    assert.deepEqual(await controlStore.getControl(), {
      schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
      enabled: true,
      activeCatalog: fixture.sourcePointer,
      updatedAt: '2026-10-02T00:00:00.000Z',
    }, 'preview must not mutate the active visual control pointer');
    assert.deepEqual(await assetStore.getActiveCatalog(fixture.sourcePointer.catalogId), fixture.sourcePointer,
      'preview must not mutate the active player asset-store pointer');

    const activate = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/activate', {
      cookie, csrfToken, body: manifest,
    });
    assert.equal(activate.status, 200, JSON.stringify(activate.body));
    assert.equal(activate.body.ok, true);
    const targetPointer = activate.body.newPointer;
    assert.equal(targetPointer.catalogId, manifest.targetCatalogId);
    assert.equal((await controlStore.getControl()).activeCatalog.catalogHash, targetPointer.catalogHash);
    assert.deepEqual(await assetStore.getActiveCatalog(targetPointer.catalogId), targetPointer);
    assert.equal((await service.stores.catalogMigrationJournalStore.getRecord()).state, 'COMMITTED');

    const playerContextResponse = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: ORIGIN, accept: 'application/json' },
    });
    const playerContext = await playerContextResponse.json();
    assert.equal(playerContextResponse.status, 200, JSON.stringify(playerContext));
    assert.deepEqual(playerContext.activeCatalog, targetPointer);
    assert.equal(playerContext.characterChannels.length, 2);

    const contentResponse = await fetch(`${baseUrl}/v1/core/catalogs/${targetPointer.catalogId}/${targetPointer.catalogRevision}/assets/${publishedAsset.assetId}/${publishedAsset.assetVersion}/content`, {
      headers: { origin: ORIGIN, accept: PNG_MIME },
    });
    const contentBytes = Buffer.from(await contentResponse.arrayBuffer());
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers.get('content-type'), PNG_MIME);
    assert.equal(`sha256:${sha256Hex(contentBytes)}`, publishedAsset.assetContentSha256);

    const rollback = await localAdminRequest(baseUrl, 'POST', '/v1/local-admin/visual/catalog-migration/rollback', {
      cookie,
      csrfToken,
      body: { expectedCurrentPointer: targetPointer, targetPointer: fixture.sourcePointer },
    });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.body));
    assert.deepEqual(rollback.body.activePointer, fixture.sourcePointer);
    assert.deepEqual((await controlStore.getControl()).activeCatalog, fixture.sourcePointer);
    assert.deepEqual(await assetStore.getActiveCatalog(fixture.sourcePointer.catalogId), fixture.sourcePointer);
    assert.deepEqual(await assetStore.getActiveCatalog(targetPointer.catalogId), targetPointer,
      'rollback retains the published target catalog for diagnosis or a later retry');
    assert.equal((await assetStore.getCatalog(stageCatalogId, 1)).status, 'published',
      'rollback retains the non-player ingest catalog and asset history');
    assert.equal((await assetStore.getAsset(publishedAsset.assetId, publishedAsset.assetVersion)).status, 'published');
  });
}

async function testSimpleVisualControlChapterOne() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-'));
  const visualControlStore = new FileVisualControlStore(root, { now: () => Date.parse('2026-08-02T00:00:00.000Z') });
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore,
  });
  await withServer(service, async (baseUrl) => {
    const unauthenticated = await request(baseUrl, 'GET', '/v1/admin/visual/status', { token: null });
    assert.equal(unauthenticated.status, 401);

    const wrongOrigin = await request(baseUrl, 'POST', '/v1/admin/visual/enable', { origin: 'http://evil.example', body: {} });
    assert.equal(wrongOrigin.status, 403);

    const initial = await request(baseUrl, 'GET', '/v1/admin/visual/status');
    assert.equal(initial.status, 200, JSON.stringify(initial.body));
    assert.equal(initial.body.visual.schemaVersion, VISUAL_CONTROL_SCHEMA_VERSION);
    assert.equal(initial.body.visual.enabled, false);
    assert.equal(initial.body.visual.activeCatalog, null);
    assert.equal(initial.body.visual.ready, false);
    assert.equal(initial.body.visual.statusCode, 'visual-disabled');
    assert.equal(JSON.stringify(initial.body).includes(ADMIN_TOKEN), false);
    assert.equal(JSON.stringify(initial.body).includes(root), false);

    const disabledDecision = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: {} });
    assert.equal(disabledDecision.status, 200, JSON.stringify(disabledDecision.body));
    assert.equal(disabledDecision.body.error.code, 'VISUAL_CORE_DISABLED');

    const enabled = await request(baseUrl, 'POST', '/v1/admin/visual/enable', { body: {} });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal(enabled.body.visual.enabled, true);
    assert.equal(enabled.body.visual.activeCatalog, null);
    assert.equal(enabled.body.visual.ready, false);
    assert.equal(enabled.body.visual.statusCode, 'visual-enabled-without-catalog');

    const noCatalogDecision = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: {} });
    assert.equal(noCatalogDecision.status, 200, JSON.stringify(noCatalogDecision.body));
    assert.equal(noCatalogDecision.body.error.code, 'VISUAL_CORE_NO_ACTIVE_CATALOG');

    const disabled = await request(baseUrl, 'POST', '/v1/admin/visual/disable', { body: {} });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.body.visual.enabled, false);
    assert.equal(disabled.body.visual.activeCatalog, null);
  });

  const restartedStore = new FileVisualControlStore(root);
  const restarted = await restartedStore.getControl();
  assert.equal(restarted.enabled, false);
  assert.equal(restarted.activeCatalog, null);

  const enabledRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-restart-'));
  const enabledStore = new FileVisualControlStore(enabledRoot, { now: () => Date.parse('2026-08-02T00:00:00.000Z') });
  await enabledStore.enable();
  const enabledRestart = new FileVisualControlStore(enabledRoot);
  assert.equal((await enabledRestart.getControl()).enabled, true);

  const badJsonRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-bad-json-'));
  writeFileSync(path.join(badJsonRoot, 'visual-control.json'), '{not-json', 'utf8');
  assert.throws(() => new FileVisualControlStore(badJsonRoot), /visual control file invalid/);

  const unknownKeyRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-unknown-key-'));
  writeFileSync(path.join(unknownKeyRoot, 'visual-control.json'), JSON.stringify({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: false,
    activeCatalog: null,
    updatedAt: '2026-08-02T00:00:00.000Z',
    surprise: true,
  }), 'utf8');
  assert.throws(() => new FileVisualControlStore(unknownKeyRoot), /visual control file invalid/);

  const badTypeRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-bad-type-'));
  writeFileSync(path.join(badTypeRoot, 'visual-control.json'), JSON.stringify({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: 'yes',
    activeCatalog: null,
    updatedAt: '2026-08-02T00:00:00.000Z',
  }), 'utf8');
  assert.throws(() => new FileVisualControlStore(badTypeRoot), /visual control enabled invalid|visual control file invalid/);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-temp-'));
  writeFileSync(path.join(tempRoot, 'visual-control.json.123.tmp'), '{}', 'utf8');
  assert.throws(() => new FileVisualControlStore(tempRoot), /orphan visual control temp file found/);

  const staleCatalogRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-stale-catalog-'));
  writeFileSync(path.join(staleCatalogRoot, 'visual-control.json'), JSON.stringify({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: {
      catalogId: 'catalog_missing_control',
      catalogRevision: 1,
      catalogHash: hashDigest('missing-control-catalog'),
    },
    updatedAt: '2026-08-02T00:00:00.000Z',
  }), 'utf8');
  const staleControlService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore: new FileVisualControlStore(staleCatalogRoot),
  });
  await withServer(staleControlService, async (baseUrl) => {
    const staleStatus = await request(baseUrl, 'GET', '/v1/admin/visual/status');
    assert.equal(staleStatus.status, 503, JSON.stringify(staleStatus.body));
    assert.equal(staleStatus.body.error.code, 'VISUAL_CATALOG_RECOVERY_REQUIRED');
    const staleEnable = await request(baseUrl, 'POST', '/v1/admin/visual/enable', { body: {} });
    assert.equal(staleEnable.status, 503, JSON.stringify(staleEnable.body));
    assert.equal(staleEnable.body.error.code, 'VISUAL_CATALOG_RECOVERY_REQUIRED');
  });

  const symlinkRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-symlink-'));
  const outsideFile = path.join(mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-control-outside-')), 'visual-control.json');
  writeFileSync(outsideFile, JSON.stringify(createDefaultControlForTest(false)), 'utf8');
  try {
    symlinkSync(outsideFile, path.join(symlinkRoot, 'visual-control.json'));
    assert.throws(() => new FileVisualControlStore(symlinkRoot), /visual control symlink rejected/);
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    console.log('visual control symlink regression skipped:', error.code);
  }
}

function createDefaultControlForTest(enabled) {
  return {
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled,
    activeCatalog: null,
    updatedAt: '2026-08-02T00:00:00.000Z',
  };
}

async function testSimpleVisualUploadChapterTwo() {
  const assetRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-upload-assets-'));
  const contentRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-upload-content-'));
  const assetStore = new FileVisualAssetStore(assetRoot);
  const contentStore = new FileContentStore(contentRoot);
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore,
    contentStore,
  });
  await withServer(service, async (baseUrl) => {
    const initialStatus = await request(baseUrl, 'GET', '/v1/admin/visual/status');
    assert.equal(initialStatus.status, 200, JSON.stringify(initialStatus.body));
    assert.equal(initialStatus.body.visual.enabled, false);
    assert.equal(initialStatus.body.visual.activeCatalog, null);

    const cases = [
      { type: 'scene', png: makePng({ colorType: 2 }), expectedRole: 'background' },
      { type: 'character', png: makePng({ colorType: 6, alpha: 0 }), expectedRole: 'transparent-sprite' },
      { type: 'equipment', png: makePng({ colorType: 2 }), expectedRole: 'icon' },
      { type: 'item', png: makePng({ colorType: 2 }), expectedRole: 'icon' },
      { type: 'skill', png: makePng({ colorType: 2 }), expectedRole: 'icon' },
    ];
    const uploaded = [];
    for (const item of cases) {
      const response = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
        body: simpleUploadBody({
          assetType: item.type,
          title: `Simple ${item.type}`,
          imageBase64: item.png.toString('base64'),
          fileName: `${item.type}-upload.png`,
        }),
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.simpleUpload.schemaVersion, 'galgame.visual-simple-upload-response.v1');
      assert.match(response.body.asset.assetId, new RegExp(`^asset_${item.type}_[a-f0-9]{12}$`));
      assert.equal(response.body.asset.assetVersion, 1);
      assert.equal(response.body.asset.assetType, item.type);
      assert.equal(response.body.asset.role, item.expectedRole);
      assert.equal(response.body.asset.status, 'draft');
      assert.equal(response.body.asset.licenseCode, 'user-owned');
      assert.equal(response.body.asset.sourceLabel, `simple upload: ${item.type}-upload.png`);
      assert.equal(response.body.asset.canonicalMime, PNG_MIME);
      assert.equal(response.body.simpleUpload.assetId, response.body.asset.assetId);
      assert.equal(response.body.simpleUpload.assetVersion, response.body.asset.assetVersion);
      assert.equal(response.body.simpleUpload.assetContentSha256, response.body.asset.assetContentSha256);
      assert.equal(response.body.simpleUpload.assetMetadataHash, response.body.asset.assetMetadataHash);
      assert.equal(JSON.stringify(response.body).includes(ADMIN_TOKEN), false);
      uploaded.push(response.body.asset);
    }

    const ids = new Set(uploaded.map((asset) => asset.assetId));
    assert.equal(ids.size, 5);

    const afterUploadStatus = await request(baseUrl, 'GET', '/v1/admin/visual/status');
    assert.equal(afterUploadStatus.status, 200);
    assert.equal(afterUploadStatus.body.visual.enabled, false);
    assert.equal(afterUploadStatus.body.visual.activeCatalog, null);

    const overrideRejected = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: {
        ...simpleUploadBody({ assetType: 'scene', title: 'Override', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
        assetId: 'asset_client_override',
      },
    });
    assert.equal(overrideRejected.status, 400);
    assert.equal(overrideRejected.body.error.code, 'VISUAL_ASSET_UNKNOWN_FIELD');

    const versionOverrideRejected = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: {
        ...simpleUploadBody({ assetType: 'item', title: 'Version Override', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
        assetVersion: 99,
      },
    });
    assert.equal(versionOverrideRejected.status, 400);
    assert.equal(versionOverrideRejected.body.error.code, 'VISUAL_ASSET_UNKNOWN_FIELD');

    const badFileName = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: simpleUploadBody({
        assetType: 'scene',
        title: 'Bad File',
        imageBase64: makePng({ colorType: 2 }).toString('base64'),
        fileName: '../secret.png',
      }),
    });
    assert.equal(badFileName.status, 400);
    assert.equal(badFileName.body.error.code, 'VISUAL_SIMPLE_UPLOAD_INVALID_FILE_NAME');

    const nullTagCodes = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: simpleUploadBody({
        assetType: 'scene',
        title: 'Null Tags',
        imageBase64: makePng({ colorType: 2 }).toString('base64'),
        tagCodes: null,
      }),
    });
    assert.equal(nullTagCodes.status, 400);
    assert.equal(nullTagCodes.body.error.code, 'VISUAL_ASSET_INVALID_FIELD');

    const nullFeatureCodes = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: simpleUploadBody({
        assetType: 'item',
        title: 'Null Features',
        imageBase64: makePng({ colorType: 2 }).toString('base64'),
        featureCodes: null,
      }),
    });
    assert.equal(nullFeatureCodes.status, 400);
    assert.equal(nullFeatureCodes.body.error.code, 'VISUAL_ASSET_INVALID_FIELD');

    const wrongOrigin = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      origin: 'http://evil.example',
      body: simpleUploadBody({ assetType: 'scene', title: 'Wrong Origin', imageBase64: makePng({ colorType: 2 }).toString('base64') }),
    });
    assert.equal(wrongOrigin.status, 403);
  });

  const restartedAssets = new FileVisualAssetStore(assetRoot);
  const restartedContent = new FileContentStore(contentRoot);
  let persistedCount = 0;
  for (const type of ENTITY_TYPES) {
    const asset = [...restartedAssets.assets.values()].find((candidate) => candidate.assetType === type && candidate.assetId.startsWith(`asset_${type}_`));
    assert.ok(asset, type);
    assert.equal(asset.assetVersion, 1);
    assert.equal(asset.status, 'draft');
    const content = await restartedContent.get(asset.assetContentSha256);
    assert.ok(content, asset.assetId);
    assert.equal(content.mime, PNG_MIME);
    persistedCount += 1;
  }
  assert.equal(persistedCount, 5);
}

function simpleUploadBody({ assetType, title, imageBase64, tagCodes, featureCodes, fileName } = {}) {
  const body = {
    schemaVersion: SIMPLE_UPLOAD_SCHEMA_VERSION,
    assetType,
    title,
    imageBase64,
  };
  if (tagCodes !== undefined) body.tagCodes = tagCodes;
  if (featureCodes !== undefined) body.featureCodes = featureCodes;
  if (fileName !== undefined) body.fileName = fileName;
  return body;
}

async function testSimpleVisualPublishChapterThree() {
  await testSimplePublishFailClosedMatrix();
}

async function testSimplePublishFailClosedMatrix() {
  const emptyService = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(emptyService, async (baseUrl) => {
    const result = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, 'NO_ACTIVE_CATALOG');
  });

  for (const { schemaVersion, assetType, hasDraft, expectedCode } of [
    { schemaVersion: CATALOG_SCHEMA_VERSION, assetType: 'character', hasDraft: true, expectedCode: 'CHANNELS_UNRESOLVED' },
    { schemaVersion: CATALOG_SCHEMA_VERSION, assetType: 'scene', hasDraft: false, expectedCode: 'LEGACY_CATALOG_REQUIRES_MIGRATION' },
    { schemaVersion: CATALOG_V2_SCHEMA_VERSION, assetType: 'character', hasDraft: false, expectedCode: null },
    { schemaVersion: CATALOG_V2_SCHEMA_VERSION, assetType: 'scene', hasDraft: true, expectedCode: 'EXPLICIT_CATALOG_REQUIRED' },
  ]) {
    const fixture = await createSimplePublishFixture({ schemaVersion, assetType, hasDraft });
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN], assetStore: fixture.assetStore,
      contentStore: fixture.contentStore, visualControlStore: fixture.visualControlStore,
    });
    await service.initialize();
    await withServer(service, async (baseUrl) => {
      const beforeAssets = await fixture.assetStore.listAssets();
      const beforeCatalogs = await fixture.assetStore.listCatalogs();
      const beforeActive = await fixture.assetStore.listActiveCatalogs();
      const beforeControl = await fixture.visualControlStore.getControl();
      const result = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
      if (expectedCode) {
        assert.equal(result.status, expectedCode === 'VISUAL_CATALOG_RECOVERY_REQUIRED' ? 503 : 409, JSON.stringify(result.body));
        assert.equal(result.body.error.code, expectedCode);
      } else {
        assert.equal(result.status, 200, JSON.stringify(result.body));
        assert.equal(result.body.idempotent, true);
        assert.deepEqual(result.body.visual.activeCatalog, beforeControl.activeCatalog);
      }
      assert.deepEqual(await fixture.assetStore.listAssets(), beforeAssets, 'simple publish never promotes or rewrites assets');
      assert.deepEqual(await fixture.assetStore.listCatalogs(), beforeCatalogs, 'simple publish never creates or mutates catalogs');
      assert.deepEqual(await fixture.assetStore.listActiveCatalogs(), beforeActive, 'simple publish never moves asset pointers');
      assert.deepEqual(await fixture.visualControlStore.getControl(), beforeControl, 'simple publish never moves control pointer');
    });
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

async function createSimplePublishFixture({ schemaVersion, assetType, hasDraft }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-publish-matrix-'));
  const assetStore = new MemoryVisualAssetStore();
  const contentStore = new MemoryContentStore();
  const visualControlStore = new MemoryVisualControlStore();
  const colorType = assetType === 'character' ? 6 : 2;
  const content = await contentStore.put(makePng({ width: assetType === 'scene' ? 640 : 640, height: assetType === 'scene' ? 360 : 640, colorType }), PNG_MIME);
  const asset = makeValidatedAssetRecord({
    assetId: `asset_matrix_${assetType}`, assetType,
    role: assetType === 'scene' ? 'background' : 'transparent-sprite',
    width: 640, height: assetType === 'scene' ? 360 : 640,
    assetContentSha256: content.hash,
  });
  await assetStore.saveAsset(asset);
  const catalogSchemaVersion = schemaVersion;
  const catalog = createCorePublishedCatalog([asset], { catalogId: `catalog_matrix_${schemaVersion === CATALOG_SCHEMA_VERSION ? 'legacy' : 'v2'}_${assetType}` });
  if (catalogSchemaVersion === CATALOG_SCHEMA_VERSION) delete catalog.characterChannels;
  catalog.schemaVersion = catalogSchemaVersion;
  catalog.catalogHash = computeCatalogHash(catalog);
  await assetStore.saveCatalog(catalog);
  await assetStore.setActiveCatalog(catalog);
  const pointer = { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash };
  await visualControlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION, enabled: true, activeCatalog: pointer,
    updatedAt: '2026-09-10T00:00:00.000Z',
  });
  if (hasDraft) {
    const draftContent = await contentStore.put(makePng({ width: 640, height: 360, colorType: 2, rgb: [22, 33, 44] }), PNG_MIME);
    const draft = makeValidatedAssetRecord({ assetId: 'asset_matrix_draft_scene', assetType: 'scene', role: 'background', width: 640, height: 360, assetContentSha256: draftContent.hash });
    draft.status = 'draft';
    draft.assetMetadataHash = computeAssetMetadataHash(draft);
    await assetStore.saveAsset(draft);
  }
  return { root, assetStore, contentStore, visualControlStore };
}

async function testSimpleVisualPublishSuccessRestartAndIdempotency() {
  const assetRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-publish-assets-'));
  const contentRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-publish-content-'));
  const controlRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-simple-publish-control-'));
  const assetStore = new FileVisualAssetStore(assetRoot);
  const visualControlStore = new FileVisualControlStore(controlRoot);
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore,
    contentStore: new FileContentStore(contentRoot),
    visualControlStore,
  });
  await withServer(service, async (baseUrl) => {
    const firstUploads = await uploadFiveSimpleVisualAssets(baseUrl, 'Publish Success');
    const firstAssetKeys = firstUploads.map((asset) => `${asset.assetId}:${asset.assetVersion}`).sort();
    const published = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.schemaVersion, 'galgame.visual-simple-publish-response.v1');
    assert.equal(published.body.published, true);
    assert.equal(published.body.idempotent, false);
    assert.match(published.body.catalog.catalogId, /^catalog_simple_[a-f0-9]{12}$/);
    assert.equal(published.body.catalog.catalogRevision, 1);
    assert.equal(published.body.catalog.status, 'published');
    assert.equal(published.body.catalog.assetRefs.length, 5);
    assert.equal(published.body.catalog.characterChannels.length, 1);
    assert.equal(published.body.catalog.characterChannels[0].channel, 'character');
    assert.equal(published.body.visual.enabled, true);
    assert.deepEqual(published.body.visual.activeCatalog, {
      catalogId: published.body.catalog.catalogId,
      catalogRevision: published.body.catalog.catalogRevision,
      catalogHash: published.body.catalog.catalogHash,
    });

    const idempotent = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
    assert.equal(idempotent.status, 200, JSON.stringify(idempotent.body));
    assert.equal(idempotent.body.published, false);
    assert.equal(idempotent.body.idempotent, true);
    assert.equal(idempotent.body.catalog.catalogHash, published.body.catalog.catalogHash);
    assert.deepEqual(idempotent.body.visual.activeCatalog, published.body.visual.activeCatalog);

    const originalCatalog = await assetStore.getCatalog(published.body.catalog.catalogId, 1);
    const specialCatalog = { ...originalCatalog, characterChannels: [{ ...originalCatalog.characterChannels[0], channel: 'narrator' }] };
    specialCatalog.catalogHash = computeCatalogHash(specialCatalog);
    await assetStore.replaceCatalog(specialCatalog, originalCatalog.catalogHash);
    await assetStore.setActiveCatalog(specialCatalog);
    const currentControl = await visualControlStore.getControl();
    await visualControlStore.setControl({
      ...currentControl,
      activeCatalog: { catalogId: specialCatalog.catalogId, catalogRevision: 1, catalogHash: specialCatalog.catalogHash },
      updatedAt: '2026-08-03T00:00:00.000Z',
    });

    const extraUpload = await uploadSimpleVisualAsset(baseUrl, {
      assetType: 'scene',
      title: 'Publish Success extra scene',
      imageBase64: makePng({ colorType: 2, rgb: [25, 50, 75] }).toString('base64'),
    });
    const second = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.published, true);
    assert.equal(second.body.idempotent, false);
    assert.equal(second.body.catalog.assetRefs.length, 6);
    assert.equal(second.body.catalog.characterChannels[0].channel, 'narrator');
    const secondAssetKeys = second.body.catalog.assetRefs.map((ref) => `${ref.assetId}:${ref.assetVersion}`).sort();
    assert.deepEqual(secondAssetKeys.filter((key) => firstAssetKeys.includes(key)), firstAssetKeys);
    assert.ok(secondAssetKeys.includes(`${extraUpload.assetId}:${extraUpload.assetVersion}`));
    assert.notEqual(second.body.catalog.catalogHash, published.body.catalog.catalogHash);
    assert.deepEqual(second.body.visual.activeCatalog, {
      catalogId: second.body.catalog.catalogId,
      catalogRevision: second.body.catalog.catalogRevision,
      catalogHash: second.body.catalog.catalogHash,
    });

    const secondIdempotent = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
    assert.equal(secondIdempotent.status, 200, JSON.stringify(secondIdempotent.body));
    assert.equal(secondIdempotent.body.published, false);
    assert.equal(secondIdempotent.body.idempotent, true);
    assert.equal(secondIdempotent.body.catalog.catalogHash, second.body.catalog.catalogHash);
    assert.deepEqual(secondIdempotent.body.visual.activeCatalog, second.body.visual.activeCatalog);
  });

  const restartedService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore: new FileVisualAssetStore(assetRoot),
    contentStore: new FileContentStore(contentRoot),
    visualControlStore: new FileVisualControlStore(controlRoot),
  });
  await withServer(restartedService, async (baseUrl) => {
    const status = await request(baseUrl, 'GET', '/v1/admin/visual/status');
    assert.equal(status.status, 200, JSON.stringify(status.body));
    assert.equal(status.body.visual.enabled, true);
    assert.ok(status.body.visual.activeCatalog);
    const catalog = await request(baseUrl, 'GET', `/v1/core/catalogs/${status.body.visual.activeCatalog.catalogId}/${status.body.visual.activeCatalog.catalogRevision}`, { token: null, origin: null });
    assert.equal(catalog.status, 200, JSON.stringify(catalog.body));
    assert.equal(catalog.body.catalog.catalogHash, status.body.visual.activeCatalog.catalogHash);
  });
}

async function testSimpleVisualPublishRollbackFailures() {
  for (const failMode of ['replaceAssetAfter', 'saveCatalogAfter', 'setActiveCatalogAfter', 'controlSetAfter']) {
    const assetStore = new FailingSimplePublishAssetStore();
    const contentStore = new MemoryContentStore();
    const visualControlStore = new FailingSimplePublishControlStore();
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      assetStore,
      contentStore,
      visualControlStore,
    });
    await withServer(service, async (baseUrl) => {
      await uploadFiveSimpleVisualAssets(baseUrl, `Old ${failMode}`);
      const first = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      const oldCatalog = first.body.catalog;
      const oldVisual = first.body.visual;
      await uploadFiveSimpleVisualAssets(baseUrl, `New ${failMode}`);
      assetStore.failMode = failMode;
      visualControlStore.failMode = failMode;
      visualControlStore.failOnCatalogHash = failMode === 'controlSetAfter' ? oldCatalog.catalogHash : '';
      const failed = await request(baseUrl, 'POST', '/v1/admin/visual/publish', { body: {} });
      assert.equal(failed.status, 500, `${failMode}: ${JSON.stringify(failed.body)}`);
      assert.match(failed.body.error.code, /^VISUAL_SIMPLE_TEST_|^VISUAL_SIMPLE_PUBLISH_ROLLBACK_FAILED$/);
      const status = await request(baseUrl, 'GET', '/v1/admin/visual/status');
      assert.equal(status.status, 200, `${failMode}: ${JSON.stringify(status.body)}`);
      assert.equal(status.body.visual.enabled, oldVisual.enabled, failMode);
      assert.deepEqual(status.body.visual.activeCatalog, oldVisual.activeCatalog, failMode);
      const catalogs = await assetStore.listCatalogs();
      assert.equal(catalogs.length, 1, failMode);
      assert.equal(catalogs[0].catalogHash, oldCatalog.catalogHash, failMode);
      const active = await assetStore.getActiveCatalog(oldCatalog.catalogId);
      assert.deepEqual(active, oldVisual.activeCatalog, failMode);
      const oldPublished = (await assetStore.listAssets()).filter((asset) => asset.title.startsWith(`Old ${failMode}`));
      assert.equal(oldPublished.length, 5, failMode);
      assert.equal(oldPublished.every((asset) => asset.status === 'published'), true, failMode);
      const newDrafts = (await assetStore.listAssets()).filter((asset) => asset.title.startsWith(`New ${failMode}`));
      assert.equal(newDrafts.length, 5, failMode);
      assert.equal(newDrafts.every((asset) => asset.status === 'draft'), true, failMode);
    });
  }
}

async function uploadFiveSimpleVisualAssets(baseUrl, titlePrefix) {
  const cases = [
    { type: 'scene', png: makePng({ colorType: 2 }) },
    { type: 'character', png: makePng({ colorType: 6, alpha: 0 }) },
    { type: 'equipment', png: makePng({ colorType: 2 }) },
    { type: 'item', png: makePng({ colorType: 2 }) },
    { type: 'skill', png: makePng({ colorType: 2 }) },
  ];
  const uploaded = [];
  for (const item of cases) {
    const response = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
      body: simpleUploadBody({
        assetType: item.type,
        title: `${titlePrefix} ${item.type}`,
        imageBase64: item.png.toString('base64'),
      }),
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    uploaded.push(response.body.asset);
  }
  return uploaded;
}

async function uploadSimpleVisualAsset(baseUrl, { assetType, title, imageBase64 }) {
  const response = await request(baseUrl, 'POST', '/v1/admin/visual/upload', {
    body: simpleUploadBody({ assetType, title, imageBase64 }),
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.asset;
}

class FailingSimplePublishAssetStore extends MemoryVisualAssetStore {
  constructor() {
    super();
    this.failMode = '';
  }

  async saveCatalog(catalog, options = {}) {
    const saved = await super.saveCatalog(catalog, options);
    if (this.failMode === 'saveCatalogAfter' && catalog.catalogId.startsWith('catalog_simple_')) {
      this.failMode = '';
      throw simpleTestFailure('VISUAL_SIMPLE_TEST_CATALOG_WRITE_FAILED');
    }
    return saved;
  }

  async replaceAsset(asset, expectedMetadataHash) {
    const replaced = await super.replaceAsset(asset, expectedMetadataHash);
    if (this.failMode === 'replaceAssetAfter' && asset.status === 'published' && asset.assetId.startsWith('asset_')) {
      this.failMode = '';
      throw simpleTestFailure('VISUAL_SIMPLE_TEST_DRAFT_WRITE_FAILED');
    }
    return replaced;
  }

  async setActiveCatalog(catalog) {
    await super.setActiveCatalog(catalog);
    if (this.failMode === 'setActiveCatalogAfter' && catalog.catalogId.startsWith('catalog_simple_')) {
      this.failMode = '';
      throw simpleTestFailure('VISUAL_SIMPLE_TEST_ACTIVE_WRITE_FAILED');
    }
  }
}

class FailingSimplePublishControlStore extends MemoryVisualControlStore {
  constructor() {
    super();
    this.failMode = '';
    this.failOnCatalogHash = '';
  }

  async setControl(control) {
    const updated = await super.setControl(control);
    if (
      this.failMode === 'controlSetAfter'
      && control.activeCatalog
      && control.activeCatalog.catalogHash !== this.failOnCatalogHash
    ) {
      this.failMode = '';
      throw simpleTestFailure('VISUAL_SIMPLE_TEST_CONTROL_WRITE_FAILED');
    }
    return updated;
  }
}

function simpleTestFailure(code) {
  const error = new Error(code);
  error.code = code;
  error.status = 500;
  return error;
}

async function testAssetUploadAndCatalogLifecycle() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const uploads = [];
    uploads.push(await upload(baseUrl, metadata({ assetId: 'scene_ruined_hut', assetType: 'scene', role: 'background' }), makePng({ colorType: 2 })));
    uploads.push(await upload(baseUrl, metadata({ assetId: 'char_raven_rogue', assetType: 'character', role: 'transparent-sprite', tagCodes: ['character.human'], featureCodes: ['feature.transparent'] }), makePng({ colorType: 6, alpha: 0 })));
    uploads.push(await upload(baseUrl, metadata({ assetId: 'equipment_rusty_dagger', assetType: 'equipment', role: 'icon', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon', 'feature.blade'] }), makePng({ colorType: 2 })));
    uploads.push(await upload(baseUrl, metadata({ assetId: 'item_crow_badge', assetType: 'item', role: 'icon', tagCodes: ['item.quest'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })));
    uploads.push(await upload(baseUrl, metadata({ assetId: 'skill_shadow_step', assetType: 'skill', role: 'icon', tagCodes: ['skill.stealth'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })));
    for (const result of uploads) {
      assert.equal(result.status, 200, JSON.stringify(result.body));
      assert.equal(result.body.asset.sourceLabel, 'admin upload');
      assert.match(result.body.asset.assetContentSha256, /^sha256:[a-f0-9]{64}$/);
      assert.match(result.body.asset.assetMetadataHash, /^sha256:[a-f0-9]{64}$/);
    }

    const duplicateConflict = await upload(baseUrl, metadata({ assetId: 'scene_ruined_hut', title: 'Different Hut' }), makePng({ colorType: 2, rgb: [12, 13, 14] }));
    assert.equal(duplicateConflict.status, 409);

    const catalog = await publishCatalog(baseUrl, 'catalog_alpha', 1, uploads.map((result) => ({
      assetId: result.body.asset.assetId,
      assetVersion: result.body.asset.assetVersion,
    })));
    assert.equal(catalog.unknownAssetRefs.length, 5);
    assert.equal(catalog.assetRefs.length, 5);
    assert.deepEqual(catalog.characterChannels, [{ assetId: 'char_raven_rogue', assetVersion: 1, channel: 'character' }]);

    const publishAgain = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_alpha/1/publish', { body: {} });
    assert.equal(publishAgain.status, 200);
    assert.equal(publishAgain.body.catalog.catalogHash, catalog.catalogHash);

    const archive = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_alpha/1/archive', { body: {} });
    assert.equal(archive.status, 200);
    assert.equal(archive.body.catalog.status, 'archived');
    const validateArchived = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_alpha/1/validate', { body: {} });
    assert.equal(validateArchived.status, 409);

    const rollback = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_alpha/rollback', { body: { catalogRevision: 1 } });
    assert.equal(rollback.status, 200);
    assert.equal(rollback.body.catalog.catalogHash, archive.body.catalog.catalogHash);

    const draft2 = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: { schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION, catalogId: 'catalog_beta', catalogRevision: 1, assetRefs: [] },
    });
    assert.equal(draft2.status, 200);
    const archiveDraft = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_beta/1/archive', { body: {} });
    assert.equal(archiveDraft.status, 409);
  });
}

async function testCatalogChannelValidationAndRollback() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const sharedCharacterPixels = makePng({ colorType: 6, alpha: 0 });
    const character = await upload(baseUrl, metadata({
      assetId: 'asset_character_catalog_channel',
      assetType: 'character',
      role: 'transparent-sprite',
      tagCodes: ['character.human'],
      featureCodes: ['feature.transparent'],
    }), sharedCharacterPixels);
    assert.equal(character.status, 200, JSON.stringify(character.body));
    const ref = { assetId: character.body.asset.assetId, assetVersion: character.body.asset.assetVersion };
    const duplicatePixels = await upload(baseUrl, metadata({
      assetId: 'asset_character_duplicate_channel_pixels',
      assetType: 'character',
      role: 'transparent-sprite',
      tagCodes: ['character.human'],
      featureCodes: ['feature.transparent'],
    }), sharedCharacterPixels);
    assert.equal(duplicatePixels.status, 200, JSON.stringify(duplicatePixels.body));
    const duplicatePixelsRef = { assetId: duplicatePixels.body.asset.assetId, assetVersion: duplicatePixels.body.asset.assetVersion };
    const draftBody = (catalogId, characterChannels) => ({
      schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
      catalogId,
      catalogRevision: 1,
      assetRefs: [ref],
      characterChannels,
    });

    const complete = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: draftBody('catalog_channel_valid', [{ ...ref, channel: 'narrator' }]),
    });
    assert.equal(complete.status, 200, JSON.stringify(complete.body));
    assert.equal(complete.body.catalog.schemaVersion, CATALOG_V2_SCHEMA_VERSION);
    assert.deepEqual(complete.body.catalog.characterChannels, [{ ...ref, channel: 'narrator' }]);
    const changedChannel = { ...complete.body.catalog, characterChannels: [{ ...ref, channel: 'system' }] };
    assert.notEqual(computeCatalogHash(changedChannel), complete.body.catalog.catalogHash);

    const duplicate = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: draftBody('catalog_channel_duplicate', [{ ...ref, channel: 'character' }, { ...ref, channel: 'narrator' }]),
    });
    assert.equal(duplicate.status, 400);
    assert.equal(duplicate.body.error.code, 'VISUAL_CATALOG_CHANNEL_DUPLICATE');

    const missing = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: draftBody('catalog_channel_missing', []),
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'VISUAL_CATALOG_CHANNEL_MISSING');

    const orphan = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: draftBody('catalog_channel_orphan', [{ assetId: 'asset_character_orphan', assetVersion: 1, channel: 'character' }]),
    });
    assert.equal(orphan.status, 400);
    assert.equal(orphan.body.error.code, 'VISUAL_CATALOG_CHANNEL_ORPHAN');

    const invalid = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: draftBody('catalog_channel_invalid', [{ ...ref, channel: 'narration' }]),
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'VISUAL_CATALOG_CHANNEL_INVALID');

    const crossChannelDuplicatePixels = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: {
        schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
        catalogId: 'catalog_channel_duplicate_pixels',
        catalogRevision: 1,
        assetRefs: [ref, duplicatePixelsRef],
        characterChannels: [
          { ...ref, channel: 'character' },
          { ...duplicatePixelsRef, channel: 'narrator' },
        ],
      },
    });
    assert.equal(crossChannelDuplicatePixels.status, 400);
    assert.equal(crossChannelDuplicatePixels.body.error.code, 'VISUAL_CATALOG_CHANNEL_CONTENT_CONFLICT');

    const validated = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_valid/1/validate', { body: {} });
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    const published = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_valid/1/publish', { body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const archive = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_valid/1/archive', { body: {} });
    assert.equal(archive.status, 200, JSON.stringify(archive.body));
    assert.deepEqual(archive.body.catalog.characterChannels, [{ ...ref, channel: 'narrator' }]);
    const rollback = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_valid/rollback', { body: { catalogRevision: 1 } });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.body));
    assert.deepEqual(rollback.body.catalog.characterChannels, [{ ...ref, channel: 'narrator' }]);
    assert.equal(rollback.body.catalog.catalogHash, archive.body.catalog.catalogHash);
  });
}

async function testCatalogChannelDecisionIsolation() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const specs = [
      { assetId: 'asset_character_aaa_narrator', channel: 'narrator', rgb: [80, 120, 160] },
      { assetId: 'asset_character_aab_player', channel: 'player', rgb: [80, 120, 161] },
      { assetId: 'asset_character_zzz_npc', channel: 'character', rgb: [80, 121, 160] },
    ];
    const uploadedAssets = [];
    for (const spec of specs) {
      const response = await upload(baseUrl, metadata({
        assetId: spec.assetId,
        assetType: 'character',
        role: 'transparent-sprite',
        tagCodes: ['character.human', 'character.androgynous'],
        featureCodes: ['feature.transparent', 'feature.full-body'],
      }), makePng({ width: 640, height: 640, colorType: 6, alpha: 0, rgb: spec.rgb, noise: true }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      uploadedAssets.push(response.body.asset);
    }
    const sceneUpload = await upload(baseUrl, metadata({
      assetId: 'asset_scene_channel_legacy_forest',
      assetType: 'scene',
      role: 'background',
      tagCodes: ['scene.forest'],
      featureCodes: ['feature.dark'],
    }), makePng({ width: 640, height: 360, colorType: 2, rgb: [32, 80, 45], noise: true }));
    assert.equal(sceneUpload.status, 200, JSON.stringify(sceneUpload.body));
    uploadedAssets.push(sceneUpload.body.asset);
    const assetRefs = uploadedAssets.map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion }));
    const characterChannels = specs.map((spec) => ({ assetId: spec.assetId, assetVersion: 1, channel: spec.channel }));
    const draft = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: { schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION, catalogId: 'catalog_channel_candidates', catalogRevision: 1, assetRefs, characterChannels },
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal((await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_candidates/1/validate', { body: {} })).status, 200);
    const published = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_channel_candidates/1/publish', { body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const catalog = published.body.catalog;
    const publishedAssets = [];
    for (const asset of uploadedAssets) {
      const response = await request(baseUrl, 'GET', `/v1/admin/assets/${asset.assetId}/1`);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      publishedAssets.push(response.body.asset);
    }

    const entity = coreEntity('character', {
      entityKey: 'entity_character_channeltest01',
      displayLabel: 'Mira',
      visibleAttributes: [
        { code: 'character-explicit-name', value: 'Mira', confidenceBand: 'explicit' },
        { code: 'character-explicit-species', value: 'human', confidenceBand: 'explicit' },
        { code: 'character-explicit-gender-presentation', value: 'androgynous', confidenceBand: 'explicit' },
      ],
    });
    const sceneEntity = coreEntity('scene', { entityKey: 'entity_scene_channelforest01' });
    const projection = coreProjection({ entities: [entity, sceneEntity] });
    const runtimeHint = {
      schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
      status: 'ready',
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      entities: [
        { entityType: 'character', codes: ['character.human', 'character.androgynous'], confidence: 1, confidenceBand: 'explicit' },
        { entityType: 'scene', codes: ['scene.forest'], confidence: 1, confidenceBand: 'explicit' },
      ],
    };
    const corePlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
      assets: publishedAssets,
      catalog,
      projection,
    }), { runtimeMode: true, runtimeHint, visibleContext: { recent: [] } });
    assert.equal(corePlan.ok, true, JSON.stringify(corePlan));
    assert.equal(corePlan.decisions.find((decision) => decision.entityType === 'character')?.assetId, 'asset_character_zzz_npc', JSON.stringify(corePlan.decisions));

    const legacyCatalog = {
      ...catalog,
      schemaVersion: 'galgame.visual-asset-catalog.v1',
    };
    delete legacyCatalog.characterChannels;
    legacyCatalog.catalogHash = computeCatalogHash(legacyCatalog);
    const legacyPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
      assets: publishedAssets,
      catalog: legacyCatalog,
      projection,
    }), { runtimeMode: true, runtimeHint, visibleContext: { recent: [] } });
    assert.equal(legacyPlan.ok, true, JSON.stringify(legacyPlan));
    assert.equal(legacyPlan.decisions.find((decision) => decision.entityType === 'character')?.assetId, 'unknown_character');
    assert.equal(legacyPlan.decisions.find((decision) => decision.entityType === 'scene')?.assetId, 'asset_scene_channel_legacy_forest');
  });
}

async function testLegacyVisualMatchChannelIsolation() {
  const projectionSecret = 'test-channel-visual-projection-secret';
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualProjectionSecret: projectionSecret,
    bindingStore: new MemoryVisualBindingStore(),
    projectionStubReader: async (projectionId) => {
      assert.equal(projectionId, stub.projectionId);
      return stub;
    },
  });
  let stub;

  await withServer(service, async (baseUrl) => {
    const specs = [
      { assetId: 'asset_character_aaa_narrator', channel: 'narrator', rgb: [80, 120, 160] },
      { assetId: 'asset_character_aab_player', channel: 'player', rgb: [80, 120, 161] },
      { assetId: 'asset_character_zzz_npc', channel: 'character', rgb: [80, 121, 160] },
    ];
    const uploaded = [];
    for (const spec of specs) {
      const result = await upload(baseUrl, metadata({
        assetId: spec.assetId,
        assetType: 'character',
        role: 'transparent-sprite',
        tagCodes: ['character.human', 'character.androgynous'],
        featureCodes: ['feature.transparent', 'feature.full-body'],
      }), makePng({ width: 640, height: 640, colorType: 6, alpha: 0, rgb: spec.rgb, noise: true }));
      assert.equal(result.status, 200, JSON.stringify(result.body));
      uploaded.push(result.body.asset);
    }
    const assetRefs = uploaded.map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion }));
    const characterChannels = specs.map((spec) => ({ assetId: spec.assetId, assetVersion: 1, channel: spec.channel }));
    const draft = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: { schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION, catalogId: 'vc_characterchannel01', catalogRevision: 1, assetRefs, characterChannels },
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.equal((await request(baseUrl, 'POST', '/v1/admin/catalogs/vc_characterchannel01/1/validate', { body: {} })).status, 200);
    const published = await request(baseUrl, 'POST', '/v1/admin/catalogs/vc_characterchannel01/1/publish', { body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));

    const characterEntity = {
      entityKey: 'entity_character_legacychannel01',
      entityType: 'character',
      displayLabel: 'Mira',
      visibleAttributes: [
        { code: 'character-explicit-name', value: 'Mira', confidenceBand: 'explicit' },
        { code: 'character-explicit-species', value: 'human', confidenceBand: 'explicit' },
        { code: 'character-explicit-gender-presentation', value: 'androgynous', confidenceBand: 'explicit' },
      ],
      confidenceBand: 'explicit',
    };
    stub = visualProjectionStub({
      catalog: published.body.catalog,
      overrides: {
        projectionId: 'vvp_channelmatch001',
        entities: [characterEntity],
      },
    });
    const proof = signProjectionProof({ stub, secret: projectionSecret, overrides: { nonce: 'nonce_CHANNELMATCH0001' } });
    const matched = await visualMatchRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest({
        requestId: 'req_CHANNELMATCH0001',
        projectionId: stub.projectionId,
        entityKey: characterEntity.entityKey,
        entityType: 'character',
        idempotencyKey: 'idem_CHANNEL_MATCH_0001',
      }),
    });
    assert.equal(matched.status, 200, JSON.stringify(matched.body));
    assert.equal(matched.body.ok, true);
    assert.equal(matched.body.result.assetId, 'asset_character_zzz_npc');
  });
}

async function testPlayerCatalogMigrationCli() {
  const manifestPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'player-catalog-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const targetPointer = {
    catalogId: manifest.targetCatalogId,
    catalogRevision: manifest.targetCatalogRevision,
    catalogHash: `sha256:${'b'.repeat(64)}`,
  };
  const countsByType = Object.fromEntries(['scene', 'character', 'equipment', 'item', 'skill'].map((type) => [
    type, manifest.entries.filter((entry) => entry.assetType === type).length,
  ]));
  const countsByChannel = Object.fromEntries(['character', 'player', 'narrator', 'system'].map((channel) => [
    channel, manifest.entries.filter((entry) => entry.assetType === 'character' && entry.channel === channel).length,
  ]));
  const sourceRuntime = {
    ok: true, serviceInstanceId: 'fixture-service', pid: 123, port: 8798,
    activePointer: manifest.sourcePointer, activeCatalogHash: manifest.sourcePointer.catalogHash, journal: null,
  };
  const targetRuntime = {
    ...sourceRuntime, activePointer: targetPointer, activeCatalogHash: targetPointer.catalogHash,
    journal: { state: 'COMMITTED' },
  };
  const sourcePreview = {
    ok: true, schemaVersion: 'galgame.visual-player-catalog-migration-preview.v1', idempotent: false,
    oldPointer: manifest.sourcePointer, newPointer: targetPointer,
    sourceCatalogHash: manifest.sourcePointer.catalogHash, targetCatalogHash: targetPointer.catalogHash,
    sourceRefCount: 40, targetRefCount: manifest.entries.length, countsByType, countsByChannel,
    duplicateContentCount: 0, excludedByReason: { NOT_ALLOWLISTED: 11 },
  };
  const targetPreview = { ...sourcePreview, idempotent: true, oldPointer: targetPointer, newPointer: targetPointer };
  const jsonResponse = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const callFactory = ({ phase }) => {
    let runtimeReads = 0;
    let activations = 0;
    let rollbacks = 0;
    const calls = [];
    const fetchImpl = async (url, options) => {
      const parsed = new URL(url);
      calls.push({ pathname: parsed.pathname, method: options.method, authorization: options.headers.authorization });
      assert.equal(parsed.origin, 'http://127.0.0.1:8798');
      assert.equal(options.headers.authorization, 'Bearer fixture-token');
      if (parsed.pathname.endsWith('/runtime')) {
        runtimeReads += 1;
        if (phase === 'execute') return jsonResponse(runtimeReads === 1 ? sourceRuntime : targetRuntime);
        if (phase === 'rollback') return jsonResponse(runtimeReads === 1 ? targetRuntime : { ...sourceRuntime, journal: { state: 'COMMITTED' } });
        return jsonResponse(sourceRuntime);
      }
      if (parsed.pathname.endsWith('/preview')) {
        return jsonResponse(phase === 'rollback' ? targetPreview : sourcePreview);
      }
      if (parsed.pathname.endsWith('/activate')) {
        activations += 1;
        return jsonResponse({ ok: true, oldPointer: manifest.sourcePointer, newPointer: targetPointer, catalogHash: targetPointer.catalogHash });
      }
      if (parsed.pathname.endsWith('/rollback')) {
        rollbacks += 1;
        const body = JSON.parse(options.body);
        assert.deepEqual(body.expectedCurrentPointer, targetPointer);
        assert.deepEqual(body.targetPointer, manifest.sourcePointer);
        return jsonResponse({ ok: true, oldPointer: targetPointer, newPointer: manifest.sourcePointer });
      }
      throw new Error(`unexpected management route ${parsed.pathname}`);
    };
    return { fetchImpl, calls, get activations() { return activations; }, get rollbacks() { return rollbacks; } };
  };

  const previewApi = callFactory({ phase: 'preview' });
  const previewResult = await runPlayerCatalogRebuild({ mode: 'preview', manifestPath, adminToken: 'fixture-token', fetchImpl: previewApi.fetchImpl });
  assert.equal(previewResult.operation, 'preview');
  assert.equal(previewApi.activations, 0);
  assert.equal(previewApi.calls.some((call) => call.pathname.endsWith('/activate')), false);

  const executeApi = callFactory({ phase: 'execute' });
  const executeResult = await runPlayerCatalogRebuild({ mode: 'execute', manifestPath, adminToken: 'fixture-token', fetchImpl: executeApi.fetchImpl });
  assert.equal(executeResult.operation, 'execute');
  assert.equal(executeResult.runtime.journalState, 'COMMITTED');
  assert.equal(executeApi.activations, 1);

  const rollbackApi = callFactory({ phase: 'rollback' });
  const rollbackResult = await runPlayerCatalogRebuild({ mode: 'rollback', manifestPath, adminToken: 'fixture-token', fetchImpl: rollbackApi.fetchImpl });
  assert.equal(rollbackResult.operation, 'rollback');
  assert.deepEqual(rollbackResult.runtime.activePointer, manifest.sourcePointer);
  assert.equal(rollbackApi.rollbacks, 1);

  const unsafeApi = callFactory({ phase: 'preview' });
  await assert.rejects(() => runPlayerCatalogRebuild({
    mode: 'preview', manifestPath, adminToken: 'fixture-token', baseUrl: 'https://example.com', fetchImpl: unsafeApi.fetchImpl,
  }), /loopback/u);
  assert.equal(unsafeApi.calls.length, 0);

  const badCountsApi = callFactory({ phase: 'preview' });
  const originalFetch = badCountsApi.fetchImpl;
  badCountsApi.fetchImpl = async (url, options) => {
    if (String(url).endsWith('/preview')) {
      return jsonResponse({ ...sourcePreview, countsByChannel: { ...countsByChannel, system: 1 } });
    }
    return originalFetch(url, options);
  };
  await assert.rejects(() => runPlayerCatalogRebuild({
    mode: 'preview', manifestPath, adminToken: 'fixture-token', fetchImpl: badCountsApi.fetchImpl,
  }), /counts or required channel inventory/u);

  const badIdempotentCountsApi = callFactory({ phase: 'rollback' });
  const fetchIdempotent = badIdempotentCountsApi.fetchImpl;
  badIdempotentCountsApi.fetchImpl = async (url, options) => {
    if (String(url).endsWith('/preview')) {
      return jsonResponse({ ...targetPreview, countsByType: { ...countsByType, scene: countsByType.scene + 1 } });
    }
    return fetchIdempotent(url, options);
  };
  await assert.rejects(() => runPlayerCatalogRebuild({
    mode: 'preview', manifestPath, adminToken: 'fixture-token', fetchImpl: badIdempotentCountsApi.fetchImpl,
  }), /counts or required channel inventory/u, 'idempotent previews are checked against the manifest counts too');
}

async function testSideArtImporterChannelMigration() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-side-art-channel-test-'));
  const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'side-art-assets');
  const manifestPath = path.join(assetsDir, 'manifest.json');
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const narratorEntry = manifest.assets.find((entry) => entry.assetId === 'asset_curated_character-narrator-ink-emblem');
    const playerEntry = manifest.assets.find((entry) => entry.assetId === 'asset_curated_player-neutral-compass');
    assert.equal(narratorEntry.channel, 'narrator');
    assert.equal(playerEntry.channel, 'player');
    const ordinaryMappings = buildCharacterChannelsForMergedCatalog([
      { assetId: narratorEntry.assetId, assetVersion: 1, assetType: 'character' },
    ], { manifestAssets: [narratorEntry] });
    assert.deepEqual(ordinaryMappings, [
      { assetId: narratorEntry.assetId, assetVersion: 1, channel: 'narrator' },
    ]);
    assert.throws(() => buildCharacterChannelsForMergedCatalog([
      { assetId: 'asset_character_unclassified', assetVersion: 1, assetType: 'character' },
    ], { manifestAssets: [] }), /explicit channel is required/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog([
      { assetId: 'asset_manifest_conflict', assetVersion: 1, assetType: 'character' },
    ], {
      existingCatalog: {
        schemaVersion: CATALOG_V2_SCHEMA_VERSION,
        characterChannels: [{ assetId: 'asset_manifest_conflict', assetVersion: 1, channel: 'character' }],
      },
      manifestAssets: [{ assetId: 'asset_manifest_conflict', assetVersion: 1, assetType: 'character', channel: 'narrator' }],
    }), /manifest channel conflicts with existing v2 channel/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog([
      { assetId: 'asset_manifest_version_mismatch', assetVersion: 2, assetType: 'character' },
    ], {
      existingCatalog: {
        schemaVersion: 'galgame.visual-asset-catalog.v1',
        assetRefs: [{ assetId: 'asset_manifest_version_mismatch', assetVersion: 2, assetType: 'character' }],
      },
      manifestAssets: [{ assetId: 'asset_manifest_version_mismatch', assetVersion: 1, assetType: 'character', channel: 'player' }],
    }), /legacy character channel migration is required for asset_manifest_version_mismatch:2/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog([
      { assetId: 'asset_manifest_exact_version', assetVersion: 1, assetType: 'character' },
    ], {
      existingCatalog: {
        schemaVersion: CATALOG_V2_SCHEMA_VERSION,
        characterChannels: [{ assetId: 'asset_manifest_exact_version', assetVersion: 1, channel: 'character' }],
      },
      manifestAssets: [{ assetId: 'asset_manifest_exact_version', assetVersion: 2, assetType: 'character', channel: 'player' }],
    }), /only supports character asset version 1/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog([
      { assetId: 'asset_v1_channel_overlap', assetVersion: 1, assetType: 'character' },
    ], {
      existingCatalog: {
        schemaVersion: 'galgame.visual-asset-catalog.v1',
        assetRefs: [{ assetId: 'asset_v1_channel_overlap', assetVersion: 1, assetType: 'character' }],
      },
      manifestAssets: [{ assetId: 'asset_v1_channel_overlap', assetVersion: 1, assetType: 'character', channel: 'player' }],
      legacyCharacterChannels: [{ assetId: 'asset_v1_channel_overlap', assetVersion: 1, channel: 'character' }],
    }), /legacy migration entry overlaps side-art manifest channel/u);
    const migrationSource = {
      schemaVersion: 'galgame.visual-asset-catalog.v1',
      assetRefs: [{ assetId: 'asset_migration_validation', assetVersion: 1, assetType: 'character' }],
    };
    const migrationRef = { assetId: 'asset_migration_validation', assetVersion: 1, channel: 'character' };
    assert.throws(() => buildCharacterChannelsForMergedCatalog(migrationSource.assetRefs, {
      existingCatalog: migrationSource,
      legacyCharacterChannels: [{ ...migrationRef, assetId: 'asset_migration_orphan' }],
    }), /is not in the v1 source catalog/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog(migrationSource.assetRefs, {
      existingCatalog: migrationSource,
      legacyCharacterChannels: [migrationRef, migrationRef],
    }), /is duplicated/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog(migrationSource.assetRefs, {
      existingCatalog: migrationSource,
      legacyCharacterChannels: [{ ...migrationRef, channel: 'unknown' }],
    }), /is invalid/u);
    assert.throws(() => buildCharacterChannelsForMergedCatalog(migrationSource.assetRefs, {
      existingCatalog: migrationSource,
      legacyCharacterChannels: [{ ...migrationRef, unexpected: true }],
    }), /is invalid/u);

    const rejectedDataDir = path.join(root, 'preflight-no-write');
    const sentinelBytes = Buffer.from('preflight must leave this file byte-for-byte unchanged');
    for (const relativePath of ['control/visual-control.json', 'metadata/sentinel.bin', 'content/sentinel.bin']) {
      const fullPath = path.join(rejectedDataDir, relativePath);
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, sentinelBytes);
    }
    const missingChannelManifest = structuredClone(manifest);
    delete missingChannelManifest.assets.find((entry) => entry.assetId === narratorEntry.assetId).channel;
    const missingChannelManifestPath = path.join(root, 'missing-channel-manifest.json');
    writeFileSync(missingChannelManifestPath, JSON.stringify(missingChannelManifest));
    await assert.rejects(() => importSideArtAssets({
      dataDir: rejectedDataDir, assetsDir, manifestPath: missingChannelManifestPath,
    }), /explicit character channel is required/u);
    assert.equal(existsSync(path.join(rejectedDataDir, '.visual-asset-service.lease.json')), false, 'preflight failure releases the exclusive data-root lease');
    for (const relativePath of ['control/visual-control.json', 'metadata/sentinel.bin', 'content/sentinel.bin']) {
      assert.deepEqual(readFileSync(path.join(rejectedDataDir, relativePath)), sentinelBytes);
    }

    const tamperedAssetsDir = path.join(root, 'tampered-assets');
    mkdirSync(tamperedAssetsDir, { recursive: true });
    const firstAsset = manifest.assets[0];
    const tamperedBytes = Buffer.from(readFileSync(path.join(assetsDir, firstAsset.fileName)));
    tamperedBytes[0] ^= 0xff;
    writeFileSync(path.join(tamperedAssetsDir, firstAsset.fileName), tamperedBytes);
    await assert.rejects(() => importSideArtAssets({
      dataDir: rejectedDataDir, assetsDir: tamperedAssetsDir, manifestPath,
    }), /file hash mismatch/u);
    assert.equal(existsSync(path.join(rejectedDataDir, '.visual-asset-service.lease.json')), false, 'asset validation failure releases the exclusive data-root lease');
    for (const relativePath of ['control/visual-control.json', 'metadata/sentinel.bin', 'content/sentinel.bin']) {
      assert.deepEqual(readFileSync(path.join(rejectedDataDir, relativePath)), sentinelBytes);
    }

    let firstImportSettled = false;
    const firstImportPromise = importSideArtAssets({ dataDir: root, assetsDir, manifestPath }).finally(() => { firstImportSettled = true; });
    const firstAssetPath = path.join(root, 'metadata', 'assets', `${manifest.assets[0].assetId}-1.json`);
    for (let attempt = 0; attempt < 10_000 && !existsSync(firstAssetPath) && !firstImportSettled; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    assert.equal(existsSync(firstAssetPath), true, 'the import has passed preflight and begun writing while holding its lease');
    assert.equal(existsSync(path.join(root, '.visual-asset-service.lease.json')), true, 'the importer lease remains held during asset writes');
    await assert.rejects(() => acquireVisualServiceDataRootLease(root, { host: '127.0.0.1', port: 8798 }),
      (error) => error?.code === 'VISUAL_DATA_ROOT_IN_USE', 'the service and importer compete on the same exclusive lease');
    const firstImport = await firstImportPromise;
    assert.equal(existsSync(path.join(root, '.visual-asset-service.lease.json')), false, 'the import releases its lease after all catalog writes complete');
    assert.equal(firstImport.ok, true);
    assert.equal(firstImport.catalog.schemaVersion, CATALOG_V2_SCHEMA_VERSION);
    assert.deepEqual(firstImport.catalog.characterChannels, [
      { assetId: narratorEntry.assetId, assetVersion: 1, channel: 'narrator' },
      { assetId: playerEntry.assetId, assetVersion: 1, channel: 'player' },
    ]);

    const assetStore = new FileVisualAssetStore(path.join(root, 'metadata'));
    const controlStore = new FileVisualControlStore(path.join(root, 'control'));
    const contentStore = new FileContentStore(path.join(root, 'content'));
    const sourceV2 = await assetStore.getCatalog(firstImport.catalog.catalogId, 1);
    const narratorBefore = await assetStore.getAsset(narratorEntry.assetId, 1);
    const npcPng = makePng({ colorType: 2, rgb: [41, 73, 109] });
    const npcContent = await contentStore.put(npcPng, PNG_MIME);
    const npc = {
      ...narratorBefore,
      assetId: 'asset_character_legacy_npc',
      assetContentSha256: npcContent.hash,
      title: 'Legacy NPC retained during migration',
      updatedAt: '2026-10-02T00:00:00.000Z',
    };
    npc.assetMetadataHash = computeAssetMetadataHash(npc);
    await assetStore.saveAsset(npc);
    const sourceV1 = {
      ...sourceV2,
      schemaVersion: 'galgame.visual-asset-catalog.v1',
      catalogId: 'catalog_side_art_legacy_source',
      assetRefs: [...sourceV2.assetRefs, assetToCoreCatalogRef(npc)],
    };
    delete sourceV1.characterChannels;
    sourceV1.catalogHash = computeCatalogHash(sourceV1);
    await assetStore.saveCatalog(sourceV1);
    await assetStore.setActiveCatalog(sourceV1);
    const control = await controlStore.getControl();
    await controlStore.setControl({
      ...control,
      enabled: true,
      activeCatalog: { catalogId: sourceV1.catalogId, catalogRevision: 1, catalogHash: sourceV1.catalogHash },
      updatedAt: '2026-10-02T00:00:00.000Z',
    });
    const sourceCatalogBefore = structuredClone(await assetStore.getCatalog(sourceV1.catalogId, 1));
    const npcBefore = structuredClone(await assetStore.getAsset(npc.assetId, 1));
    const narratorAssetBefore = structuredClone(await assetStore.getAsset(narratorEntry.assetId, 1));

    assert.throws(() => buildCharacterChannelsForMergedCatalog(sourceV1.assetRefs, {
      existingCatalog: sourceV1,
      manifestAssets: manifest.assets,
    }), /legacy character channel migration is required/u);
    const migrationManifest = {
      ...manifest,
      legacyCharacterChannels: [
        { assetId: npc.assetId, assetVersion: 1, channel: 'character' },
      ],
    };
    const migrationManifestPath = path.join(root, 'migration-manifest.json');
    writeFileSync(migrationManifestPath, JSON.stringify(migrationManifest));

    const migratedImport = await importSideArtAssets({ dataDir: root, assetsDir, manifestPath: migrationManifestPath });
    assert.equal(migratedImport.ok, true);
    assert.equal(migratedImport.catalog.schemaVersion, CATALOG_V2_SCHEMA_VERSION);
    assert.deepEqual(migratedImport.catalog.characterChannels, [
      { assetId: narratorEntry.assetId, assetVersion: 1, channel: 'narrator' },
      { assetId: playerEntry.assetId, assetVersion: 1, channel: 'player' },
      { assetId: npc.assetId, assetVersion: 1, channel: 'character' },
    ]);
    assert.deepEqual(await assetStore.getCatalog(sourceV1.catalogId, 1), sourceCatalogBefore);
    assert.deepEqual(await assetStore.getAsset(npc.assetId, 1), npcBefore);
    assert.deepEqual(await assetStore.getAsset(narratorEntry.assetId, 1), narratorAssetBefore);
    assert.notEqual(migratedImport.catalog.catalogId, sourceV1.catalogId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function testCorePublishedCatalogReads() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const uploads = [
      await upload(baseUrl, metadata({ assetId: 'scene_core_read', assetType: 'scene', role: 'background', title: 'Core Scene' }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'character_core_read', assetType: 'character', role: 'transparent-sprite', title: 'Core Character', tagCodes: ['character.human'], featureCodes: ['feature.transparent'] }), makePng({ colorType: 6, alpha: 0 })),
      await upload(baseUrl, metadata({ assetId: 'equipment_core_read', assetType: 'equipment', role: 'icon', title: 'Core Equipment', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'item_core_read', assetType: 'item', role: 'icon', title: 'Core Item', tagCodes: ['item.quest'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'skill_core_read', assetType: 'skill', role: 'icon', title: 'Core Skill', tagCodes: ['skill.magic'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
    ];
    for (const uploadResult of uploads) {
      assert.equal(uploadResult.status, 200, JSON.stringify(uploadResult.body));
    }

    const draft = await request(baseUrl, 'POST', '/v1/admin/catalogs/draft', {
      body: {
        schemaVersion: CATALOG_DRAFT_SCHEMA_VERSION,
        catalogId: 'catalog_core_read',
        catalogRevision: 1,
        assetRefs: uploads.map((result) => ({
          assetId: result.body.asset.assetId,
          assetVersion: result.body.asset.assetVersion,
        })),
        characterChannels: [{ assetId: 'character_core_read', assetVersion: 1, channel: 'character' }],
      },
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const draftRead = await request(baseUrl, 'GET', '/v1/core/catalogs/catalog_core_read/1', { token: null, origin: null });
    assert.equal(draftRead.status, 409);
    assert.equal(draftRead.body.error.code, 'VISUAL_CORE_CATALOG_NOT_PUBLISHED');

    const validated = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_core_read/1/validate', { body: {} });
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    const published = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_core_read/1/publish', { body: {} });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const catalog = published.body.catalog;
    assert.equal(catalog.status, 'published');
    assert.equal(catalog.assetRefs.length, 5);
    assert.equal(catalog.unknownAssetRefs.length, 5);

    const coreCatalog = await request(baseUrl, 'GET', '/v1/core/catalogs/catalog_core_read/1', { token: null, origin: null });
    assert.equal(coreCatalog.status, 200, JSON.stringify(coreCatalog.body));
    assert.equal(coreCatalog.body.schemaVersion, 'galgame.visual-core-published-catalog-response.v1');
    assert.equal(coreCatalog.body.catalog.catalogHash, catalog.catalogHash);
    assert.deepEqual(coreCatalog.body.catalog.assetRefs.map((ref) => ref.assetType).sort(), ['character', 'equipment', 'item', 'scene', 'skill']);
    assert.deepEqual(coreCatalog.body.catalog.unknownAssetRefs.map((ref) => ref.assetId).sort(), ['unknown_character', 'unknown_equipment', 'unknown_item', 'unknown_scene', 'unknown_skill']);
    assert.equal(JSON.stringify(coreCatalog.body).includes('admin'), false);
    assert.equal(JSON.stringify(coreCatalog.body).includes('token'), false);

    for (const ref of [...catalog.assetRefs, ...catalog.unknownAssetRefs]) {
      const content = await request(baseUrl, 'GET', `/v1/core/catalogs/${catalog.catalogId}/${catalog.catalogRevision}/assets/${ref.assetId}/${ref.assetVersion}/content`, { token: null, origin: null, raw: true });
      assert.equal(content.status, 200, ref.assetId);
      assert.equal(content.headers.get('content-type'), 'image/png');
      assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(`sha256:${content.headers.get('x-galgame-asset-content-sha256')}`, ref.assetContentSha256);
      assert.equal(`sha256:${sha256(content.bytes)}`, ref.assetContentSha256);
    }

    const queryRejected = await request(baseUrl, 'GET', '/v1/core/catalogs/catalog_core_read/1?token=nope', { token: null, origin: null });
    assert.equal(queryRejected.status, 400);
    assert.equal(queryRejected.body.error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const authRejected = await request(baseUrl, 'GET', '/v1/core/catalogs/catalog_core_read/1', { token: 'browser-token', origin: null });
    assert.equal(authRejected.status, 400);
    assert.equal(authRejected.body.error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const proofRejected = await fetch(`${baseUrl}/v1/core/catalogs/catalog_core_read/1`, {
      headers: { 'x-galgame-visual-projection-proof': 'proof' },
    });
    assert.equal(proofRejected.status, 400);
    assert.equal((await proofRejected.json()).error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const archive = await request(baseUrl, 'POST', '/v1/admin/catalogs/catalog_core_read/1/archive', { body: {} });
    assert.equal(archive.status, 200);
    const archivedRead = await request(baseUrl, 'GET', '/v1/core/catalogs/catalog_core_read/1', { token: null, origin: null });
    assert.equal(archivedRead.status, 409);
    assert.equal(archivedRead.body.error.code, 'VISUAL_CORE_CATALOG_NOT_PUBLISHED');
  });
}

async function testCoreVisualContextRoute() {
  const visualControlStore = new MemoryVisualControlStore();
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore,
  });
  await withServer(service, async (baseUrl) => {
    const context = async (pathname = '/v1/core/visual-context', headers = {}, method = 'GET') => {
      const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: { origin: CORE_DEFAULT_ORIGIN, accept: 'application/json', ...headers },
      });
      return { status: response.status, headers: response.headers, body: await response.json() };
    };

    const disabled = await context();
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.deepEqual(Object.keys(disabled.body).sort(), ['activeCatalog', 'characterChannels', 'contextHash', 'enabled', 'ok', 'schemaVersion', 'source', 'sourceVersion', 'visualProfile'].sort());
    assert.equal(disabled.body.schemaVersion, VISUAL_CORE_CONTEXT_RESPONSE_VERSION);
    assert.equal(disabled.body.enabled, false);
    assert.equal(disabled.body.activeCatalog, null);
    assert.deepEqual(disabled.body.characterChannels, []);
    assert.equal(disabled.body.visualProfile, null);
    assert.equal(disabled.headers.get('cache-control'), 'no-store');
    assert.equal(disabled.headers.get('access-control-allow-origin'), CORE_DEFAULT_ORIGIN);
    assert.equal(disabled.headers.get('set-cookie'), null);

    const local8000 = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: CORE_8000_ORIGIN, accept: 'application/json' },
    });
    assert.equal(local8000.status, 200);
    assert.equal((await local8000.json()).enabled, false);
    assert.equal(local8000.headers.get('access-control-allow-origin'), CORE_8000_ORIGIN);

    const local8000HostAlias = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: CORE_8000_LOCALHOST_ORIGIN, accept: 'application/json' },
    });
    assert.equal(local8000HostAlias.status, 200);
    assert.equal(local8000HostAlias.headers.get('access-control-allow-origin'), CORE_8000_LOCALHOST_ORIGIN);

    const wildcard = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: '*', accept: 'application/json' },
    });
    assert.equal(wildcard.status, 403);
    assert.equal((await wildcard.json()).error.code, 'VISUAL_CORE_CONTEXT_ORIGIN_REJECTED');
    assert.equal(wildcard.headers.get('access-control-allow-origin'), null);

    const missingOrigin = await fetch(`${baseUrl}/v1/core/visual-context`, { headers: { accept: 'application/json' } });
    assert.equal(missingOrigin.status, 403);
    assert.equal((await missingOrigin.json()).error.code, 'VISUAL_CORE_CONTEXT_ORIGIN_REJECTED');
    assert.equal(missingOrigin.headers.get('access-control-allow-origin'), null);

    const wrongOrigin = await context('/v1/core/visual-context', { origin: 'http://evil.example' });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.body.error.code, 'VISUAL_CORE_CONTEXT_ORIGIN_REJECTED');
    assert.equal(wrongOrigin.headers.get('access-control-allow-origin'), null);

    const queryRejected = await context('/v1/core/visual-context?debug=true');
    assert.equal(queryRejected.status, 400);
    assert.equal(queryRejected.body.error.code, 'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT');
    assert.equal(queryRejected.headers.get('cache-control'), 'no-store');
    assert.equal(queryRejected.headers.get('access-control-allow-origin'), CORE_DEFAULT_ORIGIN);

    const authRejected = await context('/v1/core/visual-context', { authorization: 'Bearer should-not-be-here' });
    assert.equal(authRejected.status, 400);
    assert.equal(authRejected.body.error.code, 'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT');
    const cookieRejected = await context('/v1/core/visual-context', { cookie: 'session=should-not-be-here' });
    assert.equal(cookieRejected.status, 400);
    assert.equal(cookieRejected.body.error.code, 'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT');
    const headerRejected = await context('/v1/core/visual-context', { 'x-visual-token': 'should-not-be-here' });
    assert.equal(headerRejected.status, 400);
    assert.equal(headerRejected.body.error.code, 'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT');

    const authRejected8000 = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: CORE_8000_ORIGIN, accept: 'application/json', authorization: 'Bearer should-not-be-here' },
    });
    assert.equal(authRejected8000.status, 400);
    assert.equal((await authRejected8000.json()).error.code, 'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT');

    const postRejected = await context('/v1/core/visual-context', {}, 'POST');
    assert.equal(postRejected.status, 405);
    assert.equal(postRejected.body.error.code, 'VISUAL_CORE_CONTEXT_METHOD_NOT_ALLOWED');
    const contextOptions = await fetch(`${baseUrl}/v1/core/visual-context`, {
      method: 'OPTIONS',
      headers: {
        origin: CORE_DEFAULT_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-private-network': 'true',
      },
    });
    assert.equal(contextOptions.status, 204);
    assert.equal(contextOptions.headers.get('access-control-allow-origin'), CORE_DEFAULT_ORIGIN);
    assert.equal(contextOptions.headers.get('access-control-allow-private-network'), 'true');

    const uploadResponse = await upload(baseUrl, metadata({ assetId: 'scene_context_route' }), makePng({ colorType: 2 }));
    assert.equal(uploadResponse.status, 200, JSON.stringify(uploadResponse.body));
    const characterResponse = await upload(baseUrl, metadata({
      assetId: 'asset_character_context_route',
      assetType: 'character',
      role: 'transparent-sprite',
      tagCodes: ['character.human'],
      featureCodes: ['feature.transparent'],
    }), makePng({ colorType: 6, alpha: 128 }));
    assert.equal(characterResponse.status, 200, JSON.stringify(characterResponse.body));
    const catalog = await publishCatalog(baseUrl, 'catalog_context_route', 1, [
      { assetId: 'scene_context_route', assetVersion: 1 },
      { assetId: 'asset_character_context_route', assetVersion: 1 },
    ], [{ assetId: 'asset_character_context_route', assetVersion: 1, channel: 'character' }]);
    await visualControlStore.setControl({
      schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
      enabled: true,
      activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
      updatedAt: '2026-08-01T00:00:00.000Z',
    });
    const active = await context();
    assert.equal(active.status, 200, JSON.stringify(active.body));
    assert.equal(active.body.enabled, true);
    assert.deepEqual(active.body.activeCatalog, {
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
    });
    assert.deepEqual(active.body.visualProfile, createGlobalDisplayVisualProfile(active.body.activeCatalog));
    assert.deepEqual(active.body.characterChannels, [
      { assetId: 'asset_character_context_route', assetVersion: 1, channel: 'character' },
    ]);
    assert.equal(active.body.contextHash, hashDigest(canonicalJson({
      schemaVersion: active.body.schemaVersion,
      enabled: active.body.enabled,
      activeCatalog: active.body.activeCatalog,
      characterChannels: active.body.characterChannels,
      visualProfile: active.body.visualProfile,
      source: active.body.source,
      sourceVersion: active.body.sourceVersion,
    })));
  });

  const invalidService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    corePlayerOrigins: [CORE_DEFAULT_ORIGIN],
    visualControlStore: {
      async getControl() {
        return { schemaVersion: 'bad', enabled: false, activeCatalog: null, updatedAt: 'bad' };
      },
    },
  });
  await withServer(invalidService, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/core/visual-context`, {
      headers: { origin: CORE_DEFAULT_ORIGIN, accept: 'application/json' },
    });
    assert.equal(response.status, 503, 'invalid startup control keeps every route behind the recovery gate');
    assert.deepEqual(await response.json(), { ok: false, error: { code: 'VISUAL_CATALOG_RECOVERY_REQUIRED' } });
  });
}

async function testRuntimeVisualDecisionV2() {
  const visualControlStore = new MemoryVisualControlStore();
  const uploadService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore,
    visualAnalyzer: async () => ({
      description: 'forest runtime fixture',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.95,
      analyzerVersion: 'runtime-v2-fallback-fixture-v1',
    }),
  });
  const { assetStore, contentStore } = uploadService.stores;
  let catalog;
  let asset;
  await withServer(uploadService, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({ assetId: 'asset_scene_runtime_v2', tagCodes: ['scene.forest'], featureCodes: [] }), makePng({ width: 640, height: 360, colorType: 2, noise: true }));
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    asset = uploaded.body.asset;
    catalog = await publishCatalog(baseUrl, 'catalog_runtime_v2', 1, [{ assetId: asset.assetId, assetVersion: asset.assetVersion }]);
  });
  await visualControlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
    updatedAt: '2026-09-05T00:00:00.000Z',
  });

  const current = { index: 7, role: 'character', speaker: 'Guide', text: 'The forest is quiet.' };
  const currentHash = hashDigest(canonicalJson(current));
  const projection = coreProjection({
    sourceMessageIndex: current.index,
    sourceMessageHash: currentHash,
    entities: [{ entityKey: 'entity_unknown_runtime001', entityType: 'unknown', displayLabel: 'unknown', visibleAttributes: [], confidenceBand: 'unknown' }],
  });
  const body = {
    schemaVersion: VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
    requestId: 'req_RUNTIME_V2_000001',
    projection,
    visibleContext: { current, recent: [] },
    visualProfile: createGlobalDisplayVisualProfile({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash }),
    expectedProjectionHash: projection.projectionHash,
    expectedSourceMessageHash: currentHash,
    createdAt: '2026-09-05T00:00:00.000Z',
  };

  const noAnalyzer = createVisualAssetService({ adminToken: ADMIN_TOKEN, visualControlStore, assetStore, contentStore, runtimeBaseUrl: '' });
  await withServer(noAnalyzer, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body, {
      schemaVersion: VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
      ok: true,
      requestId: body.requestId,
      projectionId: projection.projectionId,
      projectionHash: projection.projectionHash,
      sourceMessageIndex: projection.sourceMessageIndex,
      sourceMessageHash: projection.sourceMessageHash,
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
      matcherVersion: 'vs-runtime-3',
      scorerVersion: 'vs-runtime-scorer-v3',
      usesLlm: false,
      understandingStatus: 'unavailable',
      errorCode: 'RUNTIME_NOT_CONFIGURED',
      decisions: [],
    });
    const symbolProjection = coreProjection({
      sourceMessageIndex: current.index,
      sourceMessageHash: currentHash,
      entities: [coreEntity('equipment', {
        entityKey: 'entity_equipment_runtime_symbol01',
        displayLabel: 'Longsword +1',
        visibleAttributes: [{ code: 'equipment-visible-label', value: 'Longsword +1', confidenceBand: 'explicit' }],
      })],
    });
    const symbolLabelResponse = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: {
        ...body,
        requestId: 'req_RUNTIME_V2_SYMBOL_0001',
        projection: symbolProjection,
        expectedProjectionHash: symbolProjection.projectionHash,
      },
    });
    assert.equal(symbolLabelResponse.status, 200, `symbol-bearing display labels must pass runtime validation: ${JSON.stringify(symbolLabelResponse.body)}`);
    const fallbackProjection = coreProjection({
      sourceMessageIndex: current.index,
      sourceMessageHash: currentHash,
      entities: [coreEntity('scene', { entityKey: 'entity_scene_runtime_noanalyzer1', displayLabel: 'Unknown', visibleAttributes: [] })],
    });
    const publishedAsset = [...assetStore.assets.values()].find((candidate) => candidate.assetId === asset.assetId && candidate.assetVersion === asset.assetVersion);
    const fallbackPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({ assets: [publishedAsset], catalog, projection: fallbackProjection }), {
      runtimeMode: true,
      runtimeHint: { schemaVersion: VISUAL_RUNTIME_HINTS_VERSION, status: 'unavailable', dictionaryVersion: DICTIONARY_VERSION, dictionaryHash: DICTIONARY_HASH, entities: [] },
    });
    assert.equal(fallbackPlan.ok, true, JSON.stringify(fallbackPlan));
    assert.equal(fallbackPlan.decisions[0].assetId, 'unknown_scene');
    assert.equal(fallbackPlan.decisions[0].score, 0);
    const fallback = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: {
        ...body,
        requestId: 'req_RUNTIME_V2_FALLBACK_0001',
        projection: fallbackProjection,
        expectedProjectionHash: fallbackProjection.projectionHash,
      },
    });
    assert.equal(fallback.status, 200, JSON.stringify(fallback.body));
    assert.equal(fallback.body.understandingStatus, 'unavailable');
    assert.equal(fallback.body.decisions.length, 1, JSON.stringify(fallback.body));
    assert.equal(fallback.body.decisions[0].assetId, 'unknown_scene');
    assert.equal(fallback.body.decisions[0].score, 0);
    assert.equal(fallback.body.decisions[0].scoreBand, 'unknown');
    assert.ok(fallback.body.decisions[0].reasonCodes.includes('candidate-empty'));

    const fastProjection = coreProjection({
      sourceMessageIndex: current.index,
      sourceMessageHash: currentHash,
      entities: [coreEntity('scene', {
        entityKey: 'entity_scene_runtime_fast001',
        displayLabel: 'forest',
        visibleAttributes: [{ code: 'scene-location-kind', value: 'forest (outdoor)', confidenceBand: 'explicit' }],
        confidenceBand: 'explicit',
      })],
    });
    const fastStartedAt = Date.now();
    const fast = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: {
        ...body,
        requestId: 'req_RUNTIME_V2_FAST_0001',
        projection: fastProjection,
        expectedProjectionHash: fastProjection.projectionHash,
      },
    });
    assert.equal(fast.status, 200, JSON.stringify(fast.body));
    assert.ok(Date.now() - fastStartedAt < 1_000, `trusted scene fast path took ${Date.now() - fastStartedAt}ms`);
    assert.equal(fast.body.understandingStatus, 'unavailable');
    assert.equal(fast.body.usesLlm, false);
    assert.ok(fast.body.decisions?.[0], JSON.stringify(fast.body));
    assert.equal(fast.body.decisions[0].assetId, asset.assetId);
    assert.ok(fast.body.decisions[0].score >= 60);
  });

  let analyzerCalls = 0;
  const runtimeAnalyzer = async ({ visibleContext, instruction, requestDigest }) => {
    analyzerCalls += 1;
    assert.deepEqual(Object.keys(visibleContext).sort(), ['current', 'recent']);
    assert.equal(Object.keys(visibleContext.current).sort().join(','), 'index,role,speaker,text');
    assert.equal(visibleContext.current.text, current.text);
    assert.equal(instruction, VISUAL_RUNTIME_FIXED_INSTRUCTION);
    assert.match(instruction, /ordinary narration/);
    assert.match(instruction, /carry those codes forward/);
    assert.match(requestDigest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(arguments).includes('ST_KEY_SHOULD_NOT_APPEAR'), false);
    return {
      schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
      status: 'ready',
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }],
    };
  };
  const configured = createVisualAssetService({ adminToken: ADMIN_TOKEN, visualControlStore, assetStore, contentStore, visualRuntimeAnalyzer: runtimeAnalyzer });
  await withServer(configured, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.schemaVersion, VISUAL_RUNTIME_DECISION_RESPONSE_VERSION);
    assert.equal(first.body.understandingStatus, 'ready');
    assert.equal(first.body.errorCode, null);
    assert.equal(first.body.usesLlm, true);
    assert.equal(analyzerCalls, 1);
    const second = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.understandingStatus, 'ready');
    assert.equal(analyzerCalls, 1);

    const mismatched = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: { ...body, requestId: 'req_RUNTIME_V2_BAD_0001', expectedSourceMessageHash: hashDigest('wrong-source') },
    });
    assert.equal(mismatched.status, 400, JSON.stringify(mismatched.body));
    assert.equal(mismatched.body.errorCode, 'VISUAL_SOURCE_HASH_MISMATCH');
    assert.equal(analyzerCalls, 1);
    const logCanary = 'VISUAL_LOG_CANARY_NOT_A_REAL_SECRET';
    const rejectedRequestLogs = [];
    const originalConsoleWarn = console.warn;
    console.warn = (...parts) => rejectedRequestLogs.push(parts.map(String).join(' '));

    const unknownField = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'POST',
      headers: { origin: CORE_DEFAULT_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, requestId: 'req_RUNTIME_V2_BAD_0002', [logCanary]: true }),
    });
    assert.equal(unknownField.status, 400);
    assert.deepEqual(await unknownField.json(), {
      schemaVersion: 'galgame.visual-core-visual-decisions-error.v1',
      ok: false,
      requestId: 'req_RUNTIME_V2_BAD_0002',
      errorCode: 'VISUAL_REQUEST_UNKNOWN_FIELD',
    });
    console.warn = originalConsoleWarn;
    assert.equal(rejectedRequestLogs.length, 1);
    assert.match(rejectedRequestLogs[0], /"validationCode":"VISUAL_ASSET_UNKNOWN_FIELD"/);
    assert.equal(rejectedRequestLogs.join('\n').includes(logCanary), false, 'request-controlled unknown field names never enter diagnostics');

    const oversized = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'POST',
      headers: { origin: CORE_DEFAULT_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, requestId: 'req_RUNTIME_V2_BAD_0003', padding: 'x'.repeat(17 * 1024) }),
    });
    assert.equal(oversized.status, 400);
    assert.equal((await oversized.json()).errorCode, 'VISUAL_REQUEST_SIZE_LIMIT');
  });

  let providerRequest = null;
  await withRawServer(async (req, res) => {
    providerRequest = {
      method: req.method,
      authorization: req.headers.authorization || null,
      body: JSON.parse(await collectRequestText(req)),
    };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
      status: 'ready',
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }],
    }));
  }, async (runtimeUrl) => {
    const httpRuntimeService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken: 'runtime-server-secret-only',
      runtimeModel: 'runtime-model-only',
    });
    await withServer(httpRuntimeService, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: { ...body, requestId: 'req_RUNTIME_V2_HTTP_0001' } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'ready');
      assert.equal(response.body.usesLlm, true);
    });
  });
  assert.deepEqual(Object.keys(providerRequest.body).sort(), ['instruction', 'schemaVersion', 'visibleContext']);
  assert.equal(providerRequest.method, 'POST');
  assert.equal(providerRequest.authorization, 'Bearer runtime-server-secret-only');
  assert.equal(JSON.stringify(providerRequest.body).includes('runtime-model-only'), false);
  assert.equal(JSON.stringify(providerRequest.body).includes('ST_KEY'), false);

  const validRuntimeHint = {
    schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
    status: 'ready',
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }],
  };
  let retryRequestCount = 0;
  const retryRequestBodies = [];
  await withRawServer(async (req, res) => {
    retryRequestCount += 1;
    retryRequestBodies.push(await collectRequestText(req));
    if (retryRequestCount === 1) {
      req.socket.destroy();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(validRuntimeHint));
  }, async (runtimeUrl) => {
    const retryService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken: 'retry-server-secret-only',
    });
    await withServer(retryService, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
        token: null,
        origin: CORE_DEFAULT_ORIGIN,
        body: { ...body, requestId: 'req_RUNTIME_V2_RETRY_0001' },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'ready');
      assert.equal(response.body.errorCode, null);
      assert.equal(response.body.usesLlm, true);
    });
  });
  assert.equal(retryRequestCount, 2);
  assert.equal(retryRequestBodies.length, 2);
  assert.equal(retryRequestBodies.every((raw) => !raw.includes('retry-server-secret-only')), true);
  assert.equal(retryRequestBodies.every((raw) => !raw.includes('ST_KEY')), true);

  let networkFailureCount = 0;
  await withRawServer(async (req) => {
    networkFailureCount += 1;
    await collectRequestText(req);
    req.socket.destroy();
  }, async (runtimeUrl) => {
    const failingNetworkService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken: 'network-failure-secret-only',
    });
    await withServer(failingNetworkService, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
        token: null,
        origin: CORE_DEFAULT_ORIGIN,
        body: { ...body, requestId: 'req_RUNTIME_V2_NETWORK_FAIL_0001' },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'failed');
      assert.equal(response.body.errorCode, 'RUNTIME_NETWORK_ERROR');
      assert.equal(response.body.usesLlm, true);
    });
  });
  assert.equal(networkFailureCount, 2);

  let httpFailureCount = 0;
  await withRawServer(async (req, res) => {
    httpFailureCount += 1;
    await collectRequestText(req);
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'fixture failure' }));
  }, async (runtimeUrl) => {
    const httpFailureService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken: 'http-failure-secret-only',
    });
    await withServer(httpFailureService, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
        token: null,
        origin: CORE_DEFAULT_ORIGIN,
        body: { ...body, requestId: 'req_RUNTIME_V2_HTTP_FAIL_0001' },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'failed');
      assert.equal(response.body.errorCode, 'RUNTIME_HTTP_ERROR');
    });
  });
  assert.equal(httpFailureCount, 1);

  let invalidJsonCount = 0;
  await withRawServer(async (req, res) => {
    invalidJsonCount += 1;
    await collectRequestText(req);
    res.setHeader('content-type', 'application/json');
    res.end('not-json');
  }, async (runtimeUrl) => {
    const invalidJsonService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken: 'invalid-json-secret-only',
    });
    await withServer(invalidJsonService, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
        token: null,
        origin: CORE_DEFAULT_ORIGIN,
        body: { ...body, requestId: 'req_RUNTIME_V2_INVALID_JSON_0001' },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'failed');
      assert.equal(response.body.errorCode, 'RUNTIME_INVALID_JSON');
    });
  });
  assert.equal(invalidJsonCount, 1);

  let malformedCalls = 0;
  const malformedRuntime = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    visualControlStore,
    assetStore,
    contentStore,
    visualRuntimeAnalyzer: async () => {
      malformedCalls += 1;
      return {
        schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
        status: 'ready',
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
        entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.9, confidenceBand: 'explicit' }],
        unexpected: true,
      };
    },
  });
  await withServer(malformedRuntime, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: { ...body, requestId: 'req_RUNTIME_V2_BAD_HINT_0001' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.understandingStatus, 'failed');
    assert.equal(response.body.errorCode, 'RUNTIME_SCHEMA_INVALID');
    assert.equal(response.body.usesLlm, true);
    const retry = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: { ...body, requestId: 'req_RUNTIME_V2_BAD_HINT_0002' },
    });
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(retry.body.understandingStatus, 'failed');
    assert.equal(retry.body.errorCode, 'RUNTIME_SCHEMA_INVALID');
    assert.equal(malformedCalls, 2);
  });

  let timeoutCalls = 0;
  const timeoutRuntime = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    visualControlStore,
    assetStore,
    contentStore,
    visualRuntimeAnalyzer: async () => {
      timeoutCalls += 1;
      return new Promise(() => {});
    },
  });
  await withServer(timeoutRuntime, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: { ...body, requestId: 'req_RUNTIME_V2_TIMEOUT_0001' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.understandingStatus, 'failed');
    assert.equal(response.body.errorCode, 'RUNTIME_TIMEOUT');
    assert.equal(response.body.usesLlm, true);
  });
  assert.equal(timeoutCalls, 1);
}

async function testAnthropicMessagesTextAdapter() {
  const runtimeToken = 'runtime-anthropic-secret-only';
  const runtimeModel = 'claude-runtime-test-only';
  const visualControlStore = new MemoryVisualControlStore();
  const uploadService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore,
    visualAnalyzer: async () => ({
      description: 'forest runtime fixture',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.95,
      analyzerVersion: 'runtime-anthropic-fixture-v1',
    }),
  });
  const { assetStore, contentStore } = uploadService.stores;
  let catalog;
  await withServer(uploadService, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({
      assetId: 'asset_scene_runtime_anthropic',
      assetType: 'scene',
      role: 'background',
      title: 'Anthropic runtime scene',
      tagCodes: [],
      featureCodes: [],
    }), makePng({ width: 640, height: 360, colorType: 2, noise: true }));
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    catalog = await publishCatalog(baseUrl, 'catalog_runtime_anthropic', 1, [{
      assetId: uploaded.body.asset.assetId,
      assetVersion: uploaded.body.asset.assetVersion,
    }]);
  });
  await visualControlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
    updatedAt: '2026-09-06T00:00:00.000Z',
  });

  const current = { index: 7, role: 'character', speaker: 'Guide', text: 'The forest is quiet.' };
  const currentHash = hashDigest(canonicalJson(current));
  const projection = coreProjection({
    sourceMessageIndex: current.index,
    sourceMessageHash: currentHash,
    // Keep the provider adapter tests on the normal runtime path. The
    // deterministic fast path is covered by testRuntimeVisualDecisionV2;
    // this fixture deliberately has no explicit scene-location-kind evidence.
    entities: [coreEntity('scene', { visibleAttributes: [] })],
  });
  const body = {
    schemaVersion: VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
    requestId: 'req_RUNTIME_ANTHROPIC_0001',
    projection,
    visibleContext: { current, recent: [{ index: 6, role: 'character', speaker: 'Guide', text: 'The path leads into the woods.' }] },
    visualProfile: createGlobalDisplayVisualProfile({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash }),
    expectedProjectionHash: projection.projectionHash,
    expectedSourceMessageHash: currentHash,
    createdAt: '2026-09-06T00:00:00.000Z',
  };
  const validHint = {
    schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
    status: 'ready',
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.95, confidenceBand: 'explicit' }],
  };

  const observedRequests = [];
  await withRawServer(async (req, res) => {
    observedRequests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(await collectRequestText(req)) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: JSON.stringify(validHint) }],
    }));
  }, async (runtimeUrl) => {
    for (const suffix of ['', '/v1', '/v1/messages']) {
      const service = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        visualControlStore,
        assetStore,
        contentStore,
        runtimeBaseUrl: `${runtimeUrl}${suffix}`,
        runtimeToken,
        runtimeModel,
        runtimeRequestStyle: 'anthropic_messages_text',
      });
      await withServer(service, async (baseUrl) => {
        const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: { ...body, requestId: `req_RUNTIME_ANTHROPIC_${suffix.length}001` } });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.understandingStatus, 'ready');
        assert.equal(response.body.errorCode, null);
        assert.equal(response.body.usesLlm, true);
        assert.equal(response.body.decisions.length, 1);
        assert.equal(response.body.decisions[0].assetId, 'asset_scene_runtime_anthropic');
        assert.ok(response.body.decisions[0].score >= 60, JSON.stringify(response.body.decisions[0]));
      });
    }
  });
  assert.equal(observedRequests.length, 3);
  assert.deepEqual(observedRequests.map((item) => item.url), ['/v1/messages', '/v1/messages', '/v1/messages']);
  for (const observed of observedRequests) {
    assert.equal(observed.method, 'POST');
    assert.equal(observed.headers['anthropic-version'], '2023-06-01');
    assert.equal(observed.headers['x-api-key'], runtimeToken);
    assert.equal(observed.headers.authorization, undefined);
    assert.deepEqual(Object.keys(observed.body).sort(), ['max_tokens', 'messages', 'model', 'system']);
    assert.equal(observed.body.model, runtimeModel);
    assert.equal(observed.body.max_tokens, 512);
    assert.equal(observed.body.system, VISUAL_RUNTIME_FIXED_INSTRUCTION);
    assert.deepEqual(observed.body.messages, [{
      role: 'user',
      content: [{
        type: 'text',
        text: canonicalJson({
          schemaVersion: 'galgame.visual-runtime-hints-request.v1',
          visibleContext: body.visibleContext,
        }),
      }],
    }]);
    const serialized = JSON.stringify(observed.body);
    assert.equal(serialized.includes(runtimeToken), false);
    assert.equal(serialized.includes('asset_scene_runtime_anthropic'), false);
    assert.equal(serialized.includes('ST_KEY'), false);
  }

  async function assertRuntimeFailure({ id, status = 200, responseText = 'not-json', expectedCode, expectedRequests = 1, contentType = 'application/json' }) {
    let calls = 0;
    await withRawServer(async (req, res) => {
      calls += 1;
      await collectRequestText(req);
      res.statusCode = status;
      res.setHeader('content-type', contentType);
      res.end(responseText);
    }, async (runtimeUrl) => {
      const service = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        visualControlStore,
        assetStore,
        contentStore,
        runtimeBaseUrl: runtimeUrl,
        runtimeToken,
        runtimeModel,
        runtimeRequestStyle: 'anthropic_messages_text',
      });
      await withServer(service, async (baseUrl) => {
        // Keep transport/error assertions independent from the deterministic
        // visible-scene fallback: this fixture deliberately has no trusted
        // scene-location-kind evidence, so it must remain unknown on runtime
        // analyzer failure.
        const failureProjection = coreProjection({
          sourceMessageHash: currentHash,
          entities: [coreEntity('scene', { visibleAttributes: [] })],
        });
        const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
          token: null,
          origin: CORE_DEFAULT_ORIGIN,
          body: {
            ...body,
            requestId: id,
            projection: failureProjection,
            expectedProjectionHash: failureProjection.projectionHash,
          },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.equal(response.body.understandingStatus, expectedCode === 'RUNTIME_NOT_CONFIGURED' ? 'unavailable' : 'failed');
        assert.equal(response.body.errorCode, expectedCode);
        assert.equal(response.body.decisions.length, 1);
        assert.equal(response.body.decisions[0].score, 0);
      });
    });
    assert.equal(calls, expectedRequests, `${id} request count`);
  }

  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_4011', status: 401, responseText: JSON.stringify({ error: 'unauthorized' }), expectedCode: 'RUNTIME_HTTP_ERROR' });
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_5XX1', status: 503, responseText: JSON.stringify({ error: 'overloaded' }), expectedCode: 'RUNTIME_HTTP_ERROR' });
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_JSON1', expectedCode: 'RUNTIME_INVALID_JSON' });
  const unknownHint = { ...validHint, unexpected: true };
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_UNKNOWN1', responseText: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(unknownHint) }] }), expectedCode: 'RUNTIME_SCHEMA_INVALID' });
  const duplicateHintText = `{"schemaVersion":"${VISUAL_RUNTIME_HINTS_VERSION}","schemaVersion":"${VISUAL_RUNTIME_HINTS_VERSION}","status":"ready","dictionaryVersion":${DICTIONARY_VERSION},"dictionaryHash":"${DICTIONARY_HASH}","entities":[]}`;
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_DUP1', responseText: JSON.stringify({ content: [{ type: 'text', text: duplicateHintText }] }), expectedCode: 'RUNTIME_SCHEMA_INVALID' });
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_BOM1', responseText: JSON.stringify({ content: [{ type: 'text', text: `\uFEFF${JSON.stringify(validHint)}` }] }), expectedCode: 'RUNTIME_INVALID_JSON' });
  const mismatchedHint = { ...validHint, dictionaryVersion: DICTIONARY_VERSION + 1 };
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_DICT1', responseText: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(mismatchedHint) }] }), expectedCode: 'RUNTIME_DICTIONARY_MISMATCH' });
  await assertRuntimeFailure({ id: 'req_RUNTIME_ANTHROPIC_LONG1', responseText: 'x'.repeat(32 * 1024 + 1), expectedCode: 'RUNTIME_INVALID_JSON' });

  let timeoutCalls = 0;
  await withRawServer(async (req) => {
    timeoutCalls += 1;
    await collectRequestText(req);
  }, async (runtimeUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: runtimeUrl,
      runtimeToken,
      runtimeModel,
      runtimeRequestStyle: 'anthropic_messages_text',
    });
    await withServer(service, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: { ...body, requestId: 'req_RUNTIME_ANTHROPIC_TIMEOUT1' } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'failed');
      assert.equal(response.body.errorCode, 'RUNTIME_TIMEOUT');
      assert.equal(response.body.decisions.length, 1);
    });
  });
  assert.equal(timeoutCalls, 2);

  const unconfigured = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    visualControlStore,
    assetStore,
    contentStore,
    runtimeRequestStyle: 'anthropic_messages_text',
    runtimeBaseUrl: '',
    runtimeToken,
    runtimeModel,
  });
  await withServer(unconfigured, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body: { ...body, requestId: 'req_RUNTIME_ANTHROPIC_NONE1' } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.understandingStatus, 'unavailable');
    assert.equal(response.body.errorCode, 'RUNTIME_NOT_CONFIGURED');
    assert.equal(response.body.usesLlm, false);
    assert.equal(response.body.decisions.length, 1);
    assert.equal(response.body.decisions[0].assetId, 'unknown_scene');
    assert.equal(response.body.decisions[0].score, 0);
  });
}

async function collectRequestText(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function testCoreVisualDecisionRoute() {
  const previousCoreOrigins = process.env.GALGAME_VISUAL_CORE_PLAYER_ORIGINS;
  delete process.env.GALGAME_VISUAL_CORE_PLAYER_ORIGINS;
  try {
    const visualControlStore = new MemoryVisualControlStore();
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualControlStore,
      visualAnalyzer: async ({ assetType }) => ({
        description: `test ${assetType} analysis`,
        tagCodes: assetType === 'scene' ? ['scene.forest']
          : assetType === 'character' ? ['character.human']
            : assetType === 'equipment' ? ['equipment.weapon']
              : assetType === 'item' ? ['item.key']
                : ['skill.magic'],
        attributeCodes: assetType === 'scene' ? ['feature.dark']
          : assetType === 'character' ? ['feature.transparent']
            : ['feature.icon'],
        confidence: 0.9,
        analyzerVersion: 'test-core-v1',
      }),
    });
    await withServer(service, async (baseUrl) => {
    const uploads = [
      await upload(baseUrl, metadata({ assetId: 'asset_scene_core_route', assetType: 'scene', role: 'background', title: 'Core Route Scene', tagCodes: ['scene.forest'], featureCodes: ['feature.dark'] }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'asset_character_core_route', assetType: 'character', role: 'transparent-sprite', title: 'Core Route Character', tagCodes: ['character.human'], featureCodes: ['feature.transparent'] }), makePng({ colorType: 6, alpha: 0 })),
      await upload(baseUrl, metadata({ assetId: 'asset_equipment_core_route', assetType: 'equipment', role: 'icon', title: 'Core Route Equipment', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'asset_item_core_route', assetType: 'item', role: 'icon', title: 'Core Route Item', tagCodes: ['item.key'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
      await upload(baseUrl, metadata({ assetId: 'asset_skill_core_route', assetType: 'skill', role: 'icon', title: 'Core Route Skill', tagCodes: ['skill.magic'], featureCodes: ['feature.icon'] }), makePng({ colorType: 2 })),
    ];
    for (const uploadResult of uploads) {
      assert.equal(uploadResult.status, 200, JSON.stringify(uploadResult.body));
    }
    const catalog = await publishCatalog(baseUrl, 'catalog_core_route', 1, uploads.map((result) => ({
      assetId: result.body.asset.assetId,
      assetVersion: result.body.asset.assetVersion,
    })));
    const publishedSceneRead = await request(baseUrl, 'GET', `/v1/admin/assets/${uploads[0].body.asset.assetId}/${uploads[0].body.asset.assetVersion}`);
    assert.equal(publishedSceneRead.status, 200, JSON.stringify(publishedSceneRead.body));
    const analyzedScene = publishedSceneRead.body.asset;
    const sceneRef = catalog.assetRefs.find((ref) => ref.assetId === analyzedScene.assetId && ref.assetVersion === analyzedScene.assetVersion);
    assert.equal(sceneRef.assetMetadataHash, analyzedScene.assetMetadataHash);
    assert.equal(catalog.catalogHash, computeCatalogHash(catalog));
    const changedAnalysisAsset = structuredClone(analyzedScene);
    changedAnalysisAsset.analysis = {
      ...changedAnalysisAsset.analysis,
      tagCodes: ['scene.city'],
      description: 'city',
    };
    changedAnalysisAsset.assetMetadataHash = computeAssetMetadataHash(changedAnalysisAsset);
    const changedCatalog = structuredClone(catalog);
    changedCatalog.assetRefs = changedCatalog.assetRefs.map((ref) => ref.assetId === analyzedScene.assetId && ref.assetVersion === analyzedScene.assetVersion
      ? { ...ref, assetMetadataHash: changedAnalysisAsset.assetMetadataHash }
      : ref);
    changedCatalog.catalogHash = computeCatalogHash(changedCatalog);
    assert.notEqual(changedCatalog.catalogHash, catalog.catalogHash);
    await visualControlStore.setControl({
      schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
      enabled: true,
      activeCatalog: {
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        catalogHash: catalog.catalogHash,
      },
      updatedAt: '2026-08-02T00:00:00.000Z',
    });
    const projection = coreProjection({
      entities: [
        coreEntity('scene', { entityKey: 'entity_scene_core_route' }),
        coreEntity('character', { entityKey: 'entity_character_core_route' }),
        coreEntity('equipment', { entityKey: 'entity_equipment_core_route' }),
        coreEntity('item', { entityKey: 'entity_item_core_route' }),
        coreEntity('skill', { entityKey: 'entity_skill_core_route' }),
      ],
    });
    const body = {
      schemaVersion: VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION,
      requestId: 'req_CORE_ROUTE_000001',
      projection,
      visualProfile: createGlobalDisplayVisualProfile({
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        catalogHash: catalog.catalogHash,
      }),
      expectedProjectionHash: projection.projectionHash,
      expectedSourceMessageHash: projection.sourceMessageHash,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    const optionsResponse = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'OPTIONS',
      headers: {
        origin: CORE_DEFAULT_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
        'access-control-request-private-network': 'true',
      },
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get('access-control-allow-origin'), CORE_DEFAULT_ORIGIN);
    assert.equal(optionsResponse.headers.get('access-control-allow-private-network'), 'true');

    const optionsResponse8000 = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'OPTIONS',
      headers: {
        origin: CORE_8000_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(optionsResponse8000.status, 204);
    assert.equal(optionsResponse8000.headers.get('access-control-allow-origin'), CORE_8000_ORIGIN);

    const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.ok, true, JSON.stringify(response.body));
    assert.equal(response.body.schemaVersion, 'galgame.visual-core-decision-response.v1');
    assert.equal(response.body.usesLlm, false);
    assert.equal(response.body.decisions.length, 5);
    assert.deepEqual(response.body.decisions.map((decision) => decision.entityType).sort(), ['character', 'equipment', 'item', 'scene', 'skill']);
    assert.equal(response.body.decisions.every((decision) => decision.contentPath.startsWith('/v1/core/catalogs/catalog_core_route/1/assets/')), true);

    for (const [field, value] of [
      ['visualProfileId', 'vprof_tampered1'],
      ['profileHash', hashDigest('tampered-profile')],
      ['catalogId', 'catalog_other'],
      ['catalogRevision', catalog.catalogRevision + 1],
      ['catalogHash', hashDigest('tampered-catalog')],
    ]) {
      const tampered = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
        token: null,
        origin: CORE_DEFAULT_ORIGIN,
        body: {
          ...body,
          requestId: `req_CORE_TAMPER_${field}_000001`,
          visualProfile: { ...body.visualProfile, [field]: value },
        },
      });
      assert.equal(tampered.status, 400, `${field}: ${JSON.stringify(tampered.body)}`);
      assert.equal(tampered.body.error.code, 'VISUAL_CORE_PROFILE_MISMATCH');
      assert.equal(Object.hasOwn(tampered.body, 'decisions'), false);
      assert.equal(JSON.stringify(tampered.body).includes('contentPath'), false);
    }

    const localhostDefault = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_LOCALHOST_ORIGIN, body });
    assert.equal(localhostDefault.status, 200, JSON.stringify(localhostDefault.body));
    assert.equal(localhostDefault.body.ok, true, JSON.stringify(localhostDefault.body));

    const local8000DefaultResponse = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'POST',
      headers: { origin: CORE_8000_LOCALHOST_ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const local8000Default = await local8000DefaultResponse.json();
    assert.equal(local8000DefaultResponse.status, 200, JSON.stringify(local8000Default));
    assert.equal(local8000Default.ok, true, JSON.stringify(local8000Default));
    assert.equal(local8000DefaultResponse.headers.get('access-control-allow-origin'), CORE_8000_LOCALHOST_ORIGIN);

    const wildcardDecision = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: '*', body });
    assert.equal(wildcardDecision.status, 403);
    assert.equal(wildcardDecision.body.error.code, 'VISUAL_CORE_ORIGIN_REJECTED');

    const authRejected8000 = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: 'browser-token', origin: CORE_8000_ORIGIN, body });
    assert.equal(authRejected8000.status, 400);
    assert.equal(authRejected8000.body.error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const stale = await request(baseUrl, 'POST', '/v1/core/visual-decisions', {
      token: null,
      origin: CORE_DEFAULT_ORIGIN,
      body: { ...body, expectedSourceMessageHash: hashDigest('stale-visible-message') },
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.body.ok, false);
    assert.equal(stale.body.error.code, 'VISUAL_CORE_SOURCE_STALE');

    const queryRejected = await request(baseUrl, 'POST', '/v1/core/visual-decisions?token=nope', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(queryRejected.status, 400);
    assert.equal(queryRejected.body.error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const authRejected = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: 'browser-token', origin: CORE_DEFAULT_ORIGIN, body });
    assert.equal(authRejected.status, 400);
    assert.equal(authRejected.body.error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

    const proofRejected = await fetch(`${baseUrl}/v1/core/visual-decisions`, {
      method: 'POST',
      headers: {
        origin: CORE_DEFAULT_ORIGIN,
        'content-type': 'application/json',
        'x-galgame-visual-projection-proof': 'proof',
      },
      body: JSON.stringify(body),
    });
    assert.equal(proofRejected.status, 400);
    assert.equal((await proofRejected.json()).error.code, 'VISUAL_CORE_FORBIDDEN_TRANSPORT');

      const originRejected = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: 'http://evil.example', body });
      assert.equal(originRejected.status, 403);
      assert.equal(originRejected.body.error.code, 'VISUAL_CORE_ORIGIN_REJECTED');
    });
  } finally {
    if (previousCoreOrigins === undefined) {
      delete process.env.GALGAME_VISUAL_CORE_PLAYER_ORIGINS;
    } else {
      process.env.GALGAME_VISUAL_CORE_PLAYER_ORIGINS = previousCoreOrigins;
    }
  }
}

async function testInternalAssetReadRoutes() {
  const internalToken = 'visual-asset-internal-read-token-000001';
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualAssetInternalReadToken: internalToken,
  });
  await withServer(service, async (baseUrl) => {
    const meta = metadata({ assetId: 'scene_internal_read', title: 'Internal Read Scene' });
    const uploadResponse = await upload(baseUrl, meta);
    assert.equal(uploadResponse.status, 200, JSON.stringify(uploadResponse.body));
    const catalog = await publishCatalog(baseUrl, 'catalog_internal_read', 1, [{ assetId: meta.assetId, assetVersion: 1 }]);
    const asset = uploadResponse.body.asset;
    const ref = catalog.assetRefs.find((item) => item.assetId === asset.assetId);
    assert.ok(ref);
    const catalogRefHash = `sha256:${hashJson(ref)}`;
    const requestBody = {
      schemaVersion: 'galgame.visual-asset-internal-metadata-resolve-request.v1',
      requestId: 'req_internal_asset_read_0001',
      assetType: 'scene',
      assetId: asset.assetId,
      assetVersion: asset.assetVersion,
      assetContentSha256: asset.assetContentSha256,
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
      canonicalMime: 'image/png',
    };
    const metadataResponse = await internalAssetJson(baseUrl, '/v1/internal/assets/metadata-resolve', internalToken, requestBody);
    assert.equal(metadataResponse.status, 200, JSON.stringify(metadataResponse.body));
    assert.match(metadataResponse.body.assetMetadataHash, /^sha256:[a-f0-9]{64}$/);
    assert.match(metadataResponse.body.catalogRefHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.hasOwn(metadataResponse.body, 'bindingId'), false);
    assert.equal(Object.hasOwn(metadataResponse.body, 'entityKey'), false);
    assert.equal(JSON.stringify(metadataResponse.body).includes('releaseId'), false);
    assert.equal(JSON.stringify(metadataResponse.body).includes('profileHash'), false);

    const contentBody = {
      schemaVersion: 'galgame.visual-asset-internal-content-read-request.v1',
      requestId: 'req_internal_asset_read_0002',
      ticketId: 'vat_internal_asset_read_000001',
      bindingId: 'vb_internalread0001',
      entityKey: 'entity_scene_internal01',
      assetType: requestBody.assetType,
      assetId: requestBody.assetId,
      assetVersion: requestBody.assetVersion,
      assetContentSha256: requestBody.assetContentSha256,
      assetMetadataHash: metadataResponse.body.assetMetadataHash,
      catalogRefHash: metadataResponse.body.catalogRefHash,
      catalogId: requestBody.catalogId,
      catalogRevision: requestBody.catalogRevision,
      catalogHash: requestBody.catalogHash,
      canonicalMime: 'image/png',
    };
    const content = await internalAssetBytes(baseUrl, internalToken, contentBody);
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'image/png');
    assert.equal(content.headers.get('x-galgame-asset-content-sha256'), sha256(content.bytes));
    assert.ok(content.bytes.length > 8);

    const browserRejected = await fetch(`${baseUrl}/v1/internal/assets/metadata-resolve`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${internalToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    assert.equal(browserRejected.status, 403);
    assert.equal((await browserRejected.json()).error.code, 'VISUAL_ASSET_INTERNAL_BROWSER_FORBIDDEN');
    const wrongToken = await internalAssetJson(baseUrl, '/v1/internal/assets/metadata-resolve', 'wrong-visual-asset-internal-token-0001', requestBody);
    assert.equal(wrongToken.status, 401);
    assert.equal(wrongToken.body.error.code, 'VISUAL_ASSET_INTERNAL_AUTH_REJECTED');
    const releaseFieldRejected = await internalAssetJson(baseUrl, '/v1/internal/assets/metadata-resolve', internalToken, { ...requestBody, releaseId: 'release:forged' });
    assert.equal(releaseFieldRejected.status, 400);
    assert.equal(releaseFieldRejected.body.error.code, 'VISUAL_ASSET_UNKNOWN_FIELD');
    const metadataMismatch = await internalAssetJson(baseUrl, '/v1/internal/assets/content-read', internalToken, { ...contentBody, assetMetadataHash: `sha256:${'1'.repeat(64)}` });
    assert.equal(metadataMismatch.status, 409);
    assert.equal(metadataMismatch.body.error.code, 'VISUAL_ASSET_INTERNAL_METADATA_HASH_MISMATCH');
  });
}

async function testImageSecurity() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const wrongRole = await upload(baseUrl, metadata({ assetId: 'bad_role', assetType: 'character', role: 'icon' }), makePng({ colorType: 6, alpha: 0 }));
    assert.equal(wrongRole.status, 400);

    const unknownTag = await upload(baseUrl, metadata({ assetId: 'bad_tag', tagCodes: ['scene.not-real'] }), makePng({ colorType: 2 }));
    assert.equal(unknownTag.status, 400);

    const reserved = await upload(baseUrl, metadata({ assetId: 'unknown_scene' }), makePng({ colorType: 2 }));
    assert.equal(reserved.status, 400);

    const fakeJpeg = await upload(baseUrl, metadata({ assetId: 'jpeg_rejected' }), Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]));
    assert.equal(fakeJpeg.status, 400);
    assert.equal(fakeJpeg.body.error.code, 'VISUAL_ASSET_UNSUPPORTED_IMAGE');

    const fakeWebp = await upload(baseUrl, metadata({ assetId: 'webp_rejected' }), Buffer.from('RIFFxxxxWEBPVP8 ', 'latin1'));
    assert.equal(fakeWebp.status, 400);
    assert.equal(fakeWebp.body.error.code, 'VISUAL_ASSET_UNSUPPORTED_IMAGE');

    const corruptIdat = await upload(baseUrl, metadata({ assetId: 'bad_idat' }), makePng({ colorType: 2, corruptIdat: true }));
    assert.equal(corruptIdat.status, 400);
    assert.equal(corruptIdat.body.error.code, 'VISUAL_ASSET_PNG_INVALID');

    const ancillary = await upload(baseUrl, metadata({ assetId: 'bad_ancillary' }), makePng({ colorType: 2, extraChunks: [{ type: 'vpAg', data: Buffer.from('private') }] }));
    assert.equal(ancillary.status, 400);
    assert.equal(ancillary.body.error.code, 'VISUAL_ASSET_METADATA_REJECTED');

    const animated = await upload(baseUrl, metadata({ assetId: 'bad_apng' }), makePng({ colorType: 2, extraChunks: [{ type: 'acTL', data: Buffer.alloc(8) }] }));
    assert.equal(animated.status, 400);
    assert.equal(animated.body.error.code, 'VISUAL_ASSET_ANIMATION_REJECTED');

    const opaqueCharacter = await upload(baseUrl, metadata({ assetId: 'opaque_character', assetType: 'character', role: 'transparent-sprite', tagCodes: ['character.human'], featureCodes: ['feature.transparent'] }), makePng({ colorType: 6, alpha: 255 }));
    assert.equal(opaqueCharacter.status, 400);
    assert.equal(opaqueCharacter.body.error.code, 'VISUAL_ASSET_TRANSPARENCY_REQUIRED');

    const huge = await upload(baseUrl, metadata({ assetId: 'huge_icon', assetType: 'item', role: 'icon', tagCodes: ['item.misc'], featureCodes: ['feature.icon'] }), makeTinyIdatHugeIhdrPng({ width: 4097, height: 1, colorType: 2 }));
    assert.equal(huge.status, 413);
    assert.equal(huge.body.error.code, 'VISUAL_ASSET_PIXEL_LIMIT');
  });
}

async function testPersistenceAndTamperRejection() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  const assetStore = new FileVisualAssetStore(path.join(root, 'metadata'));
  const contentStore = new FileContentStore(path.join(root, 'content'));
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN], assetStore, contentStore });
  await withServer(service, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({ assetId: 'scene_persisted_hut' }), makePng({ colorType: 2 }));
    assert.equal(uploaded.status, 200);
    const catalog = await publishCatalog(baseUrl, 'catalog_persisted', 1, [{ assetId: 'scene_persisted_hut', assetVersion: 1 }]);
    assert.equal(catalog.status, 'published');
  });

  const restartedStore = new FileVisualAssetStore(path.join(root, 'metadata'));
  const restartedContent = new FileContentStore(path.join(root, 'content'));
  const restarted = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN], assetStore: restartedStore, contentStore: restartedContent });
  await withServer(restarted, async (baseUrl) => {
    const asset = await request(baseUrl, 'GET', '/v1/admin/assets/scene_persisted_hut/1');
    assert.equal(asset.status, 200);
    const content = await request(baseUrl, 'GET', '/v1/admin/assets/scene_persisted_hut/1/content', { raw: true });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), PNG_MIME);
    const catalog = await request(baseUrl, 'GET', '/v1/admin/catalogs/catalog_persisted/1');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.catalog.status, 'published');
  });

  const unknownFile = path.join(root, 'metadata', 'assets', 'unknown_scene-1.json');
  const unknownRecord = JSON.parse(readFileSync(unknownFile, 'utf8'));
  unknownRecord.asset.title = 'Changed Unknown';
  unknownRecord.asset.assetMetadataHash = 'sha256:' + 'a'.repeat(64);
  writeFileSync(unknownFile, JSON.stringify(unknownRecord), 'utf8');
  assert.throws(() => new FileVisualAssetStore(path.join(root, 'metadata')), /unknown asset|hash/i);

  const root2 = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  let tamperHash = null;
  const service2 = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore: new FileVisualAssetStore(path.join(root2, 'metadata')),
    contentStore: new FileContentStore(path.join(root2, 'content')),
  });
  await withServer(service2, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({ assetId: 'scene_mime_tamper' }), makePng({ colorType: 2 }));
    assert.equal(uploaded.status, 200);
    tamperHash = uploaded.body.asset.assetContentSha256;
  });
  const recordDir = path.join(root2, 'content', 'records', tamperHash.slice('sha256:'.length));
  const contentMeta = JSON.parse(readFileSync(path.join(recordDir, 'record.json'), 'utf8'));
  contentMeta.mime = 'text/plain';
  writeFileSync(path.join(recordDir, 'record.json'), JSON.stringify(contentMeta), 'utf8');
  assert.throws(() => new FileContentStore(path.join(root2, 'content')), /content metadata/i);

  const root3 = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  writeBrokenContentRecord(root3, { missing: 'meta' });
  assert.throws(() => new FileContentStore(path.join(root3, 'content')), /incomplete/i);

  const root4 = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  writeBrokenContentRecord(root4, { missing: 'bytes' });
  assert.throws(() => new FileContentStore(path.join(root4, 'content')), /incomplete/i);

  const root5 = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  writeBrokenContentRecord(root5, { extra: true });
  assert.throws(() => new FileContentStore(path.join(root5, 'content')), /unexpected/i);

  const rootTmp = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  mkdirSync(path.join(rootTmp, 'content', 'records', '.tmp-orphan-record'), { recursive: true });
  assert.throws(() => new FileContentStore(path.join(rootTmp, 'content')), /orphan/i);

  const rootBadName = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  mkdirSync(path.join(rootBadName, 'content', 'records', 'not-a-sha-record'), { recursive: true });
  assert.throws(() => new FileContentStore(path.join(rootBadName, 'content')), /record name/i);

  const root6 = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-assets-'));
  const service6 = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    assetStore: new FileVisualAssetStore(path.join(root6, 'metadata')),
    contentStore: new FileContentStore(path.join(root6, 'content')),
  });
  await withServer(service6, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({ assetId: 'char_dimension_tamper', assetType: 'character', role: 'transparent-sprite', tagCodes: ['character.human'], featureCodes: ['feature.transparent'] }), makePng({ colorType: 6, alpha: 0 }));
    assert.equal(uploaded.status, 200);
  });
  const charFile = path.join(root6, 'metadata', 'assets', 'char_dimension_tamper-1.json');
  const charRecord = JSON.parse(readFileSync(charFile, 'utf8'));
  charRecord.asset.width = 5000;
  charRecord.asset.assetMetadataHash = computeAssetMetadataHash(charRecord.asset);
  writeFileSync(charFile, JSON.stringify(charRecord), 'utf8');
  assert.throws(() => new FileVisualAssetStore(path.join(root6, 'metadata')), /pixel|width/i);
}

async function testCandidateDecisionHelpers() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  const uploadedAssets = {};
  await withServer(service, async (baseUrl) => {
    const first = await upload(baseUrl, metadata({
      assetId: 'asset_equipment_decision_dagger',
      assetVersion: 1,
      assetType: 'equipment',
      role: 'icon',
      tagCodes: ['equipment.weapon', 'equipment.melee'],
      featureCodes: ['feature.icon', 'feature.blade'],
    }), makePng({ colorType: 2 }));
    assert.equal(first.status, 200, JSON.stringify(first.body));
    uploadedAssets.first = first.body.asset;

    const second = await upload(baseUrl, metadata({
      assetId: 'asset_equipment_decision_axe',
      assetVersion: 2,
      assetType: 'equipment',
      role: 'icon',
      tagCodes: ['equipment.weapon', 'equipment.melee'],
      featureCodes: ['feature.icon', 'feature.blade'],
    }), makePng({ colorType: 2, rgb: [44, 55, 66] }));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    uploadedAssets.second = second.body.asset;
  });

  const firstCandidate = createVisualCandidateAssetInputFromAsset(uploadedAssets.first);
  const secondCandidate = createVisualCandidateAssetInputFromAsset(uploadedAssets.second);
  const candidateCatalog = createCandidateCatalog([uploadedAssets.first, uploadedAssets.second]);
  const compatibleReport = createUnknownCompatibilityReport({ catalog: candidateCatalog });
  assert.equal(compatibleReport.schemaVersion, UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION);
  assert.equal(compatibleReport.status, 'compatible');
  assert.equal(validateUnknownCompatibilityReport(compatibleReport).valid, true);
  assert.ok(compatibleReport.entries.every((entry) => entry.compatible && entry.mismatchCodes.length === 0));

  const blockedReport = createUnknownCompatibilityReport({
    sharedUnknownAssets: createLegacyPlaceholderSharedUnknowns(),
    catalog: candidateCatalog,
  });
  assert.equal(blockedReport.status, 'blocked');
  assert.equal(validateUnknownCompatibilityReport(blockedReport).valid, true);
  assert.ok(blockedReport.entries.every((entry) => entry.mismatchCodes.includes('content-hash-mismatch')));

  const missingServiceReport = createUnknownCompatibilityReport({ serviceUnknownAssets: {}, catalog: candidateCatalog });
  assert.equal(missingServiceReport.status, 'blocked');
  assert.equal(validateUnknownCompatibilityReport(missingServiceReport).valid, true);
  assert.ok(missingServiceReport.entries.every((entry) => entry.mismatchCodes.includes('missing-service-unknown')));
  assert.ok(missingServiceReport.entries.every((entry) => entry.serviceAssetId === `unknown_${entry.type}`));
  assert.ok(missingServiceReport.entries.every((entry) => entry.serviceAssetContentSha256 === '0'.repeat(64)));

  const looseUnknownReport = structuredClone(compatibleReport);
  looseUnknownReport.entries[0].sharedAssetId = 'legacy_unknown_slug';
  assert.equal(validateUnknownCompatibilityReport(looseUnknownReport).valid, false);

  assert.match(firstCandidate.assetContentSha256, /^[a-f0-9]{64}$/);
  assert.match(firstCandidate.assetMetadataHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(firstCandidate.catalogRefHash, /^sha256:[a-f0-9]{64}$/);

  const input = candidateDecisionInput({
    candidates: [secondCandidate, firstCandidate],
    catalog: candidateCatalog,
  });
  assert.equal(validateVisualCandidateDecisionInput(input).valid, true);
  const parsed = parseVisualCandidateDecisionInputJson(JSON.stringify(input));
  assert.equal(parsed.requestId, input.requestId);
  assert.throws(() => parseVisualCandidateDecisionInputJson('{"schemaVersion":"x","schemaVersion":"y"}'), /duplicate/i);

  const selected = createVisualCandidateDecision(input, { unknownCompatibilityReport: compatibleReport });
  assert.equal(selected.ok, true, JSON.stringify(selected));
  assert.equal(selected.decision.schemaVersion, CANDIDATE_DECISION_SCHEMA_VERSION);
  assert.equal(selected.decision.assetId, 'asset_equipment_decision_dagger');
  assert.equal(selected.decision.assetVersion, 1);
  assert.equal(selected.decision.usesLlm, false);
  assert.equal(Object.hasOwn(selected.decision, 'bindingPolicyHint'), false);
  assert.equal(validateVisualCandidateDecision(selected.decision).valid, true);
  assert.equal(validateVisualCandidateDecisionForInput(selected.decision, input).valid, true);
  assert.equal(validateVisualCandidateDecisionForInput(selected.decision, input, { unknownCompatibilityReport: compatibleReport }).valid, true);

  const tamperDecision = (patch) => validateVisualCandidateDecisionForInput({ ...selected.decision, ...patch }, input, { unknownCompatibilityReport: compatibleReport }).valid;
  assert.equal(tamperDecision({ assetId: 'asset_other_validid' }), false);
  assert.equal(tamperDecision({ assetVersion: 2 }), false);
  assert.equal(tamperDecision({ assetContentSha256: '1'.repeat(64) }), false);
  assert.equal(tamperDecision({ assetMetadataHash: hashDigest('decision-metadata-tamper') }), false);
  const oneCandidateInput = candidateDecisionInput({ candidates: [firstCandidate], catalog: candidateCatalog });
  const crossCandidateDecision = {
    ...selected.decision,
    assetId: secondCandidate.assetId,
    assetVersion: secondCandidate.assetVersion,
    assetContentSha256: secondCandidate.assetContentSha256,
    assetMetadataHash: secondCandidate.assetMetadataHash,
  };
  assert.equal(validateVisualCandidateDecisionForInput(crossCandidateDecision, oneCandidateInput, { unknownCompatibilityReport: compatibleReport }).valid, false);

  const duplicateCandidateInput = candidateDecisionInput({ candidates: [firstCandidate, firstCandidate], catalog: candidateCatalog });
  assert.equal(validateVisualCandidateDecisionInput(duplicateCandidateInput).valid, false);
  const unknownFieldInput = { ...input, rawChat: 'leak' };
  assert.equal(validateVisualCandidateDecisionInput(unknownFieldInput).valid, false);
  const badNumberInput = { ...input, sourceMessageIndex: Number.NaN };
  assert.equal(validateVisualCandidateDecisionInput(badNumberInput).valid, false);

  const badDictionaryInput = candidateDecisionInput({ candidates: [firstCandidate], catalog: candidateCatalog, dictionaryHash: hashDigest('wrong-dictionary') });
  assert.equal(validateVisualCandidateDecisionInput(badDictionaryInput).valid, false);
  const badProfileCatalogInput = candidateDecisionInput({ candidates: [firstCandidate], catalog: candidateCatalog, profileCatalogHash: hashDigest('wrong-profile-catalog') });
  assert.equal(validateVisualCandidateDecisionInput(badProfileCatalogInput).valid, false);
  const tamperedCandidate = { ...firstCandidate, assetMetadataHash: hashDigest('wrong-metadata') };
  const tamperedRefDecision = createVisualCandidateDecision(candidateDecisionInput({ candidates: [tamperedCandidate], catalog: candidateCatalog }), { unknownCompatibilityReport: compatibleReport });
  assert.equal(tamperedRefDecision.ok, false);
  assert.equal(tamperedRefDecision.code, 'VISUAL_CANDIDATE_CATALOG_REF_MISMATCH');
  const looseIdCandidate = { ...firstCandidate, assetId: 'equipment_decision_dagger' };
  assert.equal(validateVisualCandidateDecisionInput(candidateDecisionInput({ candidates: [looseIdCandidate], catalog: candidateCatalog })).valid, false);

  const emptyBlocked = createVisualCandidateDecision(candidateDecisionInput({ candidates: [], catalog: candidateCatalog }), { unknownCompatibilityReport: blockedReport });
  assert.equal(emptyBlocked.ok, false);
  assert.equal(emptyBlocked.code, 'VISUAL_UNKNOWN_COMPATIBILITY_BLOCKED');
  assert.equal(emptyBlocked.decision, undefined);

  const lowScoreBlocked = createVisualCandidateDecision(candidateDecisionInput({
    visibleAttributeCodes: [],
    confidenceBand: 'unknown',
    candidates: [firstCandidate],
    catalog: candidateCatalog,
  }), { unknownCompatibilityReport: blockedReport });
  assert.equal(lowScoreBlocked.ok, false);
  assert.equal(lowScoreBlocked.code, 'VISUAL_UNKNOWN_COMPATIBILITY_BLOCKED');

  const lowScoreCompatible = createVisualCandidateDecision(candidateDecisionInput({
    visibleAttributeCodes: [],
    confidenceBand: 'unknown',
    candidates: [firstCandidate],
    catalog: candidateCatalog,
  }), { unknownCompatibilityReport: compatibleReport });
  assert.equal(lowScoreCompatible.ok, true);
  assert.equal(lowScoreCompatible.decision.assetId, 'unknown_equipment');
  assert.equal(lowScoreCompatible.decision.score, 0);
  assert.equal(lowScoreCompatible.decision.scoreBand, 'unknown');
  const lowScoreCompatibleInput = candidateDecisionInput({
    visibleAttributeCodes: [],
    confidenceBand: 'unknown',
    candidates: [firstCandidate],
    catalog: candidateCatalog,
  });
  assert.equal(validateVisualCandidateDecisionForInput(lowScoreCompatible.decision, lowScoreCompatibleInput, { unknownCompatibilityReport: compatibleReport }).valid, true);
  assert.equal(validateVisualCandidateDecisionForInput(lowScoreCompatible.decision, candidateDecisionInput({
    visibleAttributeCodes: [],
    confidenceBand: 'unknown',
    candidates: [firstCandidate],
    catalog: candidateCatalog,
  }), { unknownCompatibilityReport: blockedReport }).valid, false);
  assert.equal(validateVisualCandidateDecisionForInput({ ...lowScoreCompatible.decision, assetId: 'asset_unknown_tamper' }, lowScoreCompatibleInput, { unknownCompatibilityReport: compatibleReport }).valid, false);
  assert.equal(validateVisualCandidateDecisionForInput({ ...lowScoreCompatible.decision, assetVersion: 2 }, lowScoreCompatibleInput, { unknownCompatibilityReport: compatibleReport }).valid, false);
  assert.equal(validateVisualCandidateDecisionForInput({ ...lowScoreCompatible.decision, assetContentSha256: '2'.repeat(64) }, lowScoreCompatibleInput, { unknownCompatibilityReport: compatibleReport }).valid, false);
  const tamperedUnknownDecision = { ...lowScoreCompatible.decision, assetMetadataHash: hashDigest('unknown-metadata-tamper') };
  assert.equal(validateVisualCandidateDecisionForInput(tamperedUnknownDecision, lowScoreCompatibleInput, { unknownCompatibilityReport: compatibleReport }).valid, false);
  const tamperedUnknownReport = structuredClone(compatibleReport);
  const equipmentUnknownEntry = tamperedUnknownReport.entries.find((entry) => entry.type === 'equipment');
  equipmentUnknownEntry.catalogRefHash = hashDigest('unknown-catalog-ref-tamper');
  assert.equal(validateUnknownCompatibilityReport(tamperedUnknownReport).valid, false);
  assert.equal(validateVisualCandidateDecisionForInput(lowScoreCompatible.decision, lowScoreCompatibleInput, { unknownCompatibilityReport: tamperedUnknownReport }).valid, false);
  const tamperCompatibleReportEntry = (patch, updateCatalogRefHash = false) => {
    const report = structuredClone(compatibleReport);
    const entry = report.entries.find((item) => item.type === 'equipment');
    Object.assign(entry, patch);
    if (updateCatalogRefHash) {
      entry.catalogRefHash = hashDigest(canonicalJson({
        assetId: entry.serviceAssetId,
        assetVersion: entry.serviceAssetVersion,
        assetType: entry.type,
        assetContentSha256: `sha256:${entry.serviceAssetContentSha256}`,
        assetMetadataHash: entry.serviceAssetMetadataHash,
      }));
    }
    return report;
  };
  assert.equal(validateUnknownCompatibilityReport(tamperCompatibleReportEntry({ sharedAssetId: 'asset_shared_tamper01' })).valid, false);
  assert.equal(validateUnknownCompatibilityReport(tamperCompatibleReportEntry({ sharedAssetVersion: 2 })).valid, false);
  assert.equal(validateUnknownCompatibilityReport(tamperCompatibleReportEntry({ sharedAssetContentSha256: '3'.repeat(64) })).valid, false);
  assert.equal(validateUnknownCompatibilityReport(tamperCompatibleReportEntry({ serviceAssetContentSha256: '4'.repeat(64) }, true)).valid, false);
  assert.equal(validateUnknownCompatibilityReport(tamperCompatibleReportEntry({ servedBytesSha256: '5'.repeat(64) })).valid, false);
  assert.equal(validateUnknownCompatibilityReport(blockedReport).valid, true);

  const characterAsset = makeValidatedAssetRecord({
    assetId: 'asset_char_decision_sprite',
    assetType: 'character',
    role: 'transparent-sprite',
    tagCodes: ['character.human'],
    featureCodes: ['feature.transparent'],
    assetContentSha256: BUILTIN_UNKNOWN_ASSETS.character.assetContentSha256,
  });
  const characterCatalog = createCandidateCatalog([characterAsset]);
  const characterCandidate = createVisualCandidateAssetInputFromAsset(characterAsset);
  const characterReport = createUnknownCompatibilityReport({ catalog: characterCatalog });
  const ambiguousCharacter = createVisualCandidateDecision(candidateDecisionInput({
    entityType: 'character',
    entityKey: 'entity_character_pippa001',
    confidenceBand: 'ambiguous',
    visibleAttributeCodes: ['character-explicit-name'],
    candidates: [characterCandidate],
    catalog: characterCatalog,
  }), { unknownCompatibilityReport: characterReport });
  assert.equal(ambiguousCharacter.ok, true);
  assert.equal(ambiguousCharacter.decision.assetId, 'unknown_character');
  assert.equal(ambiguousCharacter.decision.score, 19);
  assert.ok(ambiguousCharacter.decision.reasonCodes.includes('ambiguous-appearance-capped'));
  assert.equal(validateVisualCandidateDecisionForInput(ambiguousCharacter.decision, candidateDecisionInput({
    entityType: 'character',
    entityKey: 'entity_character_pippa001',
    confidenceBand: 'ambiguous',
    visibleAttributeCodes: ['character-explicit-name'],
    candidates: [characterCandidate],
    catalog: characterCatalog,
  }), { unknownCompatibilityReport: characterReport }).valid, true);

  const badDecision = { ...selected.decision, reasonCodes: ['not-a-code'] };
  assert.equal(validateVisualCandidateDecision(badDecision).valid, false);
  const badScopeDecision = { ...selected.decision, catalogHash: hashDigest('other-catalog') };
  assert.equal(validateVisualCandidateDecisionForInput(badScopeDecision, input).valid, false);
  const badBandDecision = { ...selected.decision, score: 10, scoreBand: 'high' };
  assert.equal(validateVisualCandidateDecision(badBandDecision).valid, false);
  const badTtl = createVisualCandidateDecision(input, { unknownCompatibilityReport: compatibleReport, expiresAt: '2026-08-01T00:10:01.000Z', maxTtlMs: 300000 });
  assert.equal(badTtl.ok, false);
  assert.equal(badTtl.code, 'VISUAL_CANDIDATE_DECISION_OUTPUT_INVALID');
}

async function testCoreDeterministicMatcherHelpers() {
  const assets = [
    makeValidatedAssetRecord({ assetId: 'asset_scene_core_forest', assetType: 'scene', role: 'background', tagCodes: ['scene.forest'], featureCodes: ['feature.dark'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.scene.assetContentSha256 }),
    makeValidatedAssetRecord({ assetId: 'asset_character_core_knight', assetType: 'character', role: 'transparent-sprite', tagCodes: ['character.human', 'character.armored'], featureCodes: ['feature.transparent'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.character.assetContentSha256 }),
    makeValidatedAssetRecord({ assetId: 'asset_equipment_core_sword', assetVersion: 1, assetType: 'equipment', role: 'icon', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.equipment.assetContentSha256 }),
    makeValidatedAssetRecord({ assetId: 'asset_equipment_core_axe', assetVersion: 2, assetType: 'equipment', role: 'icon', tagCodes: ['equipment.weapon'], featureCodes: ['feature.icon'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.equipment.assetContentSha256 }),
    makeValidatedAssetRecord({ assetId: 'asset_item_core_key', assetType: 'item', role: 'icon', tagCodes: ['item.key'], featureCodes: ['feature.icon'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.item.assetContentSha256 }),
    makeValidatedAssetRecord({ assetId: 'asset_skill_core_spell', assetType: 'skill', role: 'icon', tagCodes: ['skill.magic'], featureCodes: ['feature.icon'], assetContentSha256: BUILTIN_UNKNOWN_ASSETS.skill.assetContentSha256 }),
  ];
  const catalog = createCorePublishedCatalog(assets);
  assert.equal(catalog.catalogId, 'catalog_core_match');
  const request = coreDecisionPlanRequest({ assets, catalog });
  const plan = createCoreVisualCandidateDecisionPlan(request);
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.schemaVersion, VISUAL_CORE_CANDIDATE_DECISION_PLAN_VERSION);
  assert.equal(plan.usesLlm, false);
  const legacyGeneralCatalogInput = coreCandidateDecisionInputForLegacyValidator({ assets, catalog, entity: coreEntity('scene', { entityKey: 'entity_scene_legacy01' }) });
  assert.equal(validateVisualCandidateDecisionInput(legacyGeneralCatalogInput).valid, false);
  assert.equal(createVisualCandidateDecision(legacyGeneralCatalogInput).ok, false);
  assert.equal(plan.decisions.length, 5);
  assert.deepEqual(plan.decisions.map((decision) => decision.entityType).sort(), ['character', 'equipment', 'item', 'scene', 'skill']);
  assert.equal(plan.decisions.find((decision) => decision.entityType === 'equipment').assetId, 'asset_equipment_core_sword');
  assert.equal(plan.decisions.find((decision) => decision.entityType === 'equipment').assetVersion, 1);
  assert.ok(plan.decisions.every((decision) => decision.score >= 20));
  assert.ok(plan.decisions.every((decision) => decision.usesLlm === false));

  const curatedCharacter = makeValidatedAssetRecord({
    assetId: 'asset_curated_character-woman-mage',
    assetType: 'character',
    role: 'transparent-sprite',
    tagCodes: ['character.feminine', 'character.mage'],
    featureCodes: ['feature.transparent', 'feature.full-body'],
  });
  const curatedCharacterCatalog = createCorePublishedCatalog([curatedCharacter]);
  const curatedCharacterProjection = coreProjection({
    entities: [coreEntity('character', {
      visibleAttributes: [
        { code: 'character-explicit-name', value: 'Pippa', confidenceBand: 'explicit' },
        { code: 'character-explicit-appearance', value: 'mage', confidenceBand: 'explicit' },
        { code: 'character-visual-binding', value: 'asset_curated_character-woman-mage', confidenceBand: 'explicit' },
      ],
    })],
  });
  const curatedCharacterPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [curatedCharacter],
    catalog: curatedCharacterCatalog,
    projection: curatedCharacterProjection,
  }), {
    runtimeMode: true,
    runtimeHint: {
      status: 'ready',
      entities: [{ entityType: 'character', codes: ['character.feminine', 'character.mage'], confidence: 1, confidenceBand: 'explicit' }],
    },
    visibleContext: { boundAssetId: 'asset_curated_character-woman-mage', recent: [] },
  });
  assert.equal(curatedCharacterPlan.ok, true, JSON.stringify(curatedCharacterPlan));
  assert.equal(curatedCharacterPlan.decisions[0].assetId, 'asset_curated_character-woman-mage');
  assert.equal(curatedCharacterPlan.decisions[0].score, 100);
  const curatedCharacterWithoutRuntimePlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [curatedCharacter],
    catalog: curatedCharacterCatalog,
    projection: curatedCharacterProjection,
  }), {
    runtimeMode: true,
    runtimeHint: {
      status: 'unavailable',
      entities: [],
    },
    visibleContext: { boundAssetId: 'asset_curated_character-woman-mage', recent: [] },
  });
  assert.equal(curatedCharacterWithoutRuntimePlan.ok, true, JSON.stringify(curatedCharacterWithoutRuntimePlan));
  assert.equal(curatedCharacterWithoutRuntimePlan.decisions[0].assetId, 'asset_curated_character-woman-mage');
  assert.equal(curatedCharacterWithoutRuntimePlan.decisions[0].score, 100);

  const overlapAssets = [
    makeValidatedAssetRecord({
      assetId: 'asset_scene_overlap_forest',
      assetType: 'scene',
      role: 'background',
      tagCodes: [],
      featureCodes: [],
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v2',
        status: 'ready',
        description: 'forest',
        tagCodes: ['scene.forest'],
        attributeCodes: [],
        confidence: 0.95,
        analyzerVersion: 'test-overlap-v1',
        errorCode: null,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
      },
    }),
    makeValidatedAssetRecord({
      assetId: 'asset_scene_overlap_city',
      assetType: 'scene',
      role: 'background',
      tagCodes: [],
      featureCodes: [],
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v2',
        status: 'ready',
        description: 'city',
        tagCodes: ['scene.city'],
        attributeCodes: [],
        confidence: 0.95,
        analyzerVersion: 'test-overlap-v1',
        errorCode: null,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
      },
    }),
  ];
  const overlapCatalog = createCorePublishedCatalog(overlapAssets);
  const overlapPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: overlapAssets,
    catalog: overlapCatalog,
    projection: coreProjection({
      entities: [coreEntity('scene', {
        entityKey: 'entity_scene_overlap01',
        displayLabel: 'Forest',
        visibleAttributes: [{ code: 'scene-location-kind', value: 'forest', confidenceBand: 'explicit' }],
      })],
    }),
  }));
  assert.equal(overlapPlan.ok, true, JSON.stringify(overlapPlan));
  assert.equal(overlapPlan.decisions[0].assetId, 'asset_scene_overlap_forest');
  assert.ok(overlapPlan.decisions[0].score >= 20);

  const noOverlapAssets = [
    makeValidatedAssetRecord({
      assetId: 'asset_scene_no_overlap',
      assetType: 'scene',
      role: 'background',
      tagCodes: [],
      featureCodes: [],
      analysis: {
        schemaVersion: 'galgame.visual-asset-analysis.v2',
        status: 'ready',
        description: 'city',
        tagCodes: ['scene.city'],
        attributeCodes: [],
        confidence: 0.95,
        analyzerVersion: 'test-overlap-v1',
        errorCode: null,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
      },
    }),
  ];
  const noOverlapCatalog = createCorePublishedCatalog(noOverlapAssets);
  const noOverlapPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: noOverlapAssets,
    catalog: noOverlapCatalog,
    projection: coreProjection({
      entities: [coreEntity('scene', {
        entityKey: 'entity_scene_no_overlap01',
        displayLabel: 'Forest',
        visibleAttributes: [{ code: 'scene-location-kind', value: 'forest', confidenceBand: 'explicit' }],
      })],
    }),
  }));
  assert.equal(noOverlapPlan.ok, true, JSON.stringify(noOverlapPlan));
  assert.equal(noOverlapPlan.decisions[0].assetId, 'unknown_scene');
  assert.equal(noOverlapPlan.decisions[0].score, 0);

  // An explicit visible location must keep backgrounds usable when the
  // optional runtime analyzer is temporarily unavailable. The analyzer
  // failure is still reported by the HTTP envelope, but a trusted
  // scene-location-kind projection must not collapse the player stage to
  // unknown_scene.
  const offlineTavernAsset = makeValidatedAssetRecord({
    assetId: 'asset_scene_offline_tavern',
    assetType: 'scene',
    role: 'background',
    tagCodes: ['scene.interior', 'scene.city', 'scene.day'],
    featureCodes: ['feature.wooden'],
    analysis: {
      schemaVersion: 'galgame.visual-asset-analysis.v2',
      status: 'ready',
      description: 'warm tavern interior',
      tagCodes: ['scene.interior', 'scene.city', 'scene.day'],
      attributeCodes: ['feature.wooden'],
      confidence: 0.98,
      analyzerVersion: 'test-offline-fallback-v1',
      errorCode: null,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
    },
  });
  const offlineTavernCatalog = createCorePublishedCatalog([offlineTavernAsset]);
  const offlineTavernProjection = coreProjection({
    entities: [coreEntity('scene', {
      entityKey: 'entity_scene_offline_tavern01',
      displayLabel: '铁砧酒馆',
      visibleAttributes: [{ code: 'scene-location-kind', value: '铁砧酒馆（室内 城市）', confidenceBand: 'explicit' }],
    })],
  });
  const offlineTavernPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [offlineTavernAsset],
    catalog: offlineTavernCatalog,
    projection: offlineTavernProjection,
  }), {
    runtimeMode: true,
    runtimeHint: {
      status: 'ambiguous',
      entities: [],
    },
    visibleContext: { current: { index: 7, role: 'character', speaker: 'Guide', text: '铁砧酒馆' }, recent: [] },
  });
  assert.equal(offlineTavernPlan.ok, true, JSON.stringify(offlineTavernPlan));
  assert.equal(offlineTavernPlan.decisions[0].assetId, 'asset_scene_offline_tavern');
  assert.ok(offlineTavernPlan.decisions[0].score >= 60, JSON.stringify(offlineTavernPlan));
  const offlineTavernWithUnrelatedRuntimeHint = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [offlineTavernAsset],
    catalog: offlineTavernCatalog,
    projection: offlineTavernProjection,
  }), {
    runtimeMode: true,
    runtimeHint: {
      status: 'ready',
      entities: [{ entityType: 'character', codes: ['character.human'], confidence: 0.9, confidenceBand: 'probable' }],
    },
    visibleContext: { current: { index: 7, role: 'character', speaker: 'Guide', text: '铁砧酒馆' }, recent: [] },
  });
  assert.equal(offlineTavernWithUnrelatedRuntimeHint.ok, true, JSON.stringify(offlineTavernWithUnrelatedRuntimeHint));
  assert.equal(offlineTavernWithUnrelatedRuntimeHint.decisions[0].assetId, 'asset_scene_offline_tavern');

  const offlineSceneAssets = [
    makeValidatedAssetRecord({
      assetId: 'asset_scene_offline_forest',
      assetType: 'scene',
      role: 'background',
      tagCodes: ['scene.forest', 'scene.exterior', 'scene.day'],
      featureCodes: [],
    }),
    makeValidatedAssetRecord({
      assetId: 'asset_scene_offline_city',
      assetType: 'scene',
      role: 'background',
      tagCodes: ['scene.city', 'scene.exterior', 'scene.day'],
      featureCodes: [],
    }),
  ];
  const offlineSceneCatalog = createCorePublishedCatalog(offlineSceneAssets);
  const offlineForestProjection = coreProjection({
    entities: [coreEntity('scene', {
      entityKey: 'entity_scene_offline_forest01',
      displayLabel: '森林',
      visibleAttributes: [{ code: 'scene-location-kind', value: '森林（森林）', confidenceBand: 'explicit' }],
    })],
  });
  const offlineForestPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: offlineSceneAssets,
    catalog: offlineSceneCatalog,
    projection: offlineForestProjection,
  }), {
    runtimeMode: true,
    runtimeHint: { status: 'unavailable', entities: [] },
    visibleContext: { current: { index: 8, role: 'character', speaker: 'Guide', text: '森林深处' }, recent: [] },
  });
  assert.equal(offlineForestPlan.ok, true, JSON.stringify(offlineForestPlan));
  assert.equal(offlineForestPlan.decisions[0].assetId, 'asset_scene_offline_forest');
  assert.ok(offlineForestPlan.decisions[0].score > 60, JSON.stringify(offlineForestPlan));

  const failedCharacterAnalysis = {
    schemaVersion: 'galgame.visual-asset-analysis.v2',
    status: 'failed',
    description: '',
    tagCodes: [],
    attributeCodes: [],
    confidence: 0,
    analyzerVersion: 'test-analysis-unavailable-v1',
    errorCode: 'ANALYZER_REQUEST_INVALID',
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
  };
  const createCuratedFailedCharacter = (assetId) => makeValidatedAssetRecord({
    assetId,
    assetType: 'character',
    role: 'transparent-sprite',
    tagCodes: ['character.undead', 'character.androgynous'],
    featureCodes: ['feature.transparent', 'feature.full-body'],
    analysisStatus: 'failed',
    analysis: structuredClone(failedCharacterAnalysis),
  });
  const failedCharacterAssets = [createCuratedFailedCharacter('asset_character_curated_failed_single')];
  const failedCharacterCatalog = createCorePublishedCatalog(failedCharacterAssets);
  const failedCharacterProjection = coreProjection({
    entities: [coreEntity('character', {
      entityKey: 'entity_character_curated_failed01',
      displayLabel: '骷髅卫兵',
      visibleAttributes: [
        { code: 'character-explicit-name', value: '骷髅卫兵', confidenceBand: 'explicit' },
        { code: 'character-explicit-species', value: '骷髅', confidenceBand: 'explicit' },
        { code: 'character-explicit-gender-presentation', value: 'androgynous', confidenceBand: 'explicit' },
      ],
    })],
  });
  const failedCharacterPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: failedCharacterAssets,
    catalog: failedCharacterCatalog,
    projection: failedCharacterProjection,
  }), {
    runtimeMode: true,
    runtimeHint: {
      status: 'ready',
      entities: [{ entityType: 'character', codes: ['character.undead', 'character.androgynous'], confidence: 0.95, confidenceBand: 'explicit' }],
    },
    visibleContext: { recent: [] },
  });
  assert.equal(failedCharacterPlan.ok, true, JSON.stringify(failedCharacterPlan));
  assert.equal(failedCharacterPlan.decisions[0].assetId, 'asset_character_curated_failed_single');
  assert.ok(failedCharacterPlan.decisions[0].score >= 60);
  const failedCharacterWithoutRuntimePlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: failedCharacterAssets,
    catalog: failedCharacterCatalog,
    projection: failedCharacterProjection,
  }), {
    runtimeMode: true,
    runtimeHint: { status: 'unavailable', entities: [] },
    visibleContext: { recent: [] },
  });
  assert.equal(failedCharacterWithoutRuntimePlan.ok, true, JSON.stringify(failedCharacterWithoutRuntimePlan));
  assert.equal(failedCharacterWithoutRuntimePlan.decisions[0].assetId, 'asset_character_curated_failed_single');
  assert.ok(failedCharacterWithoutRuntimePlan.decisions[0].score >= 60);

  const tiedCharacterAssets = [
    createCuratedFailedCharacter('asset_character_curated_failed_tie_a'),
    createCuratedFailedCharacter('asset_character_curated_failed_tie_b'),
  ];
  const tiedCharacterCatalog = createCorePublishedCatalog(tiedCharacterAssets);
  const tiedCharacterPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: tiedCharacterAssets,
    catalog: tiedCharacterCatalog,
    projection: failedCharacterProjection,
  }), {
    runtimeMode: true,
    runtimeHint: { status: 'unavailable', entities: [] },
    visibleContext: { recent: [] },
  });
  assert.equal(tiedCharacterPlan.ok, true, JSON.stringify(tiedCharacterPlan));
  assert.equal(tiedCharacterPlan.decisions[0].assetId, 'unknown_character');
  assert.ok(tiedCharacterPlan.decisions[0].reasonCodes.includes('ambiguous-appearance-capped'));

  const thumbnailScene = makeValidatedAssetRecord({
    assetId: 'asset_scene_thumbnail_must_not_match',
    assetType: 'scene',
    role: 'background',
    width: 160,
    height: 90,
    tagCodes: ['scene.forest'],
    analysis: {
      schemaVersion: 'galgame.visual-asset-analysis.v2',
      status: 'ready',
      description: 'forest scene thumbnail',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.95,
      analyzerVersion: 'test-thumbnail-v1',
      errorCode: null,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
    },
  });
  const thumbnailCatalog = createCorePublishedCatalog([thumbnailScene]);
  const thumbnailProjection = coreProjection({ entities: [coreEntity('scene', { entityKey: 'entity_scene_thumbnail001' })] });
  const thumbnailPlan = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets: [thumbnailScene],
    catalog: thumbnailCatalog,
    projection: thumbnailProjection,
  }), {
    runtimeMode: true,
    runtimeHint: { status: 'unavailable', entities: [] },
  });
  assert.equal(thumbnailPlan.ok, true, JSON.stringify(thumbnailPlan));
  assert.equal(thumbnailPlan.decisions[0].assetId, 'unknown_scene');

  const characterNoAppearance = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
    assets,
    catalog,
    projection: coreProjection({
      entities: [
        coreEntity('character', {
          entityKey: 'entity_character_noappearance01',
          visibleAttributes: [{ code: 'character-explicit-name', value: 'Asha', confidenceBand: 'explicit' }],
          confidenceBand: 'explicit',
        }),
      ],
    }),
  }));
  assert.equal(characterNoAppearance.ok, true, JSON.stringify(characterNoAppearance));
  assert.equal(characterNoAppearance.decisions[0].assetId, 'unknown_character');
  assert.equal(characterNoAppearance.decisions[0].scoreBand, 'unknown');
  assert.ok(characterNoAppearance.decisions[0].reasonCodes.includes('candidate-empty'));

  for (const type of ['equipment', 'item', 'skill']) {
    const missingLabel = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({
      assets,
      catalog,
      projection: coreProjection({
        entities: [
          coreEntity(type, {
            entityKey: `entity_${type}_nolabel001`,
            visibleAttributes: [{ code: `${type}-visible-trait`, value: 'visible but unlabeled', confidenceBand: 'explicit' }],
            confidenceBand: 'explicit',
          }),
        ],
      }),
    }));
    assert.equal(missingLabel.ok, true, JSON.stringify(missingLabel));
    assert.equal(missingLabel.decisions[0].assetId, `unknown_${type}`);
    assert.equal(missingLabel.decisions[0].score, 0);
    assert.ok(missingLabel.decisions[0].score < 20);
    assert.ok(missingLabel.decisions[0].reasonCodes.includes('missing-visible-label'));
  }

  const sourceMismatch = createCoreVisualCandidateDecisionPlan({ ...request, expectedSourceMessageHash: hashDigest('different-source') });
  assert.equal(sourceMismatch.ok, false);
  assert.equal(sourceMismatch.code, 'VISUAL_CORE_SOURCE_STALE');

  const profileMismatch = createCoreVisualCandidateDecisionPlan({
    ...request,
    visualProfile: { ...request.visualProfile, catalogHash: hashDigest('different-catalog') },
  });
  assert.equal(profileMismatch.ok, false);
  assert.equal(profileMismatch.code, 'VISUAL_CORE_CATALOG_SCOPE_MISMATCH');

  const staleCatalog = structuredClone(catalog);
  staleCatalog.assetRefs[0].assetMetadataHash = hashDigest('tampered-ref');
  staleCatalog.catalogHash = computeCatalogHash(staleCatalog);
  const staleCatalogResult = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({ assets, catalog: staleCatalog }));
  assert.equal(staleCatalogResult.ok, false);
  assert.equal(staleCatalogResult.code, 'VISUAL_CORE_CATALOG_REF_MISMATCH');

  const draftCatalog = { ...catalog, status: 'draft' };
  draftCatalog.catalogHash = computeCatalogHash(draftCatalog);
  const draftResult = createCoreVisualCandidateDecisionPlan(coreDecisionPlanRequest({ assets, catalog: draftCatalog }));
  assert.equal(draftResult.ok, false);
  assert.equal(draftResult.code, 'VISUAL_CORE_CATALOG_NOT_PUBLISHED');
}

async function testVisualMatchRouteAndBindingStore() {
  const projectionSecret = 'test-visual-projection-secret';
  const visualMatchServiceToken = 'visual-match-service-token-00000001';
  const restoreSecret = 'test-visual-restore-secret';
  const restoreToken = 'restore-service-token';
  const restoreKeyId = 'vis_restore_key_testkey001';
  const fixedNow = () => Date.parse('2026-08-01T00:00:00.000Z');
  const bindingStore = new MemoryVisualBindingStore();
  const proofReplayStore = new MemoryProofReplayStore(fixedNow);
  const restoreReplayStore = new MemoryRestoreReplayStore(fixedNow);
  const uploadedAssets = {};
  let publishedCatalog = null;
  let stub = null;
  let proof = null;
  const service = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualMatchServiceToken,
    visualProjectionSecret: projectionSecret,
    visualRestoreServiceToken: restoreToken,
    visualRestoreProofSecret: restoreSecret,
    visualRestoreProofKeyIds: [restoreKeyId],
    bindingStore,
    proofReplayStore,
    restoreReplayStore,
    now: fixedNow,
    projectionStubReader: async (projectionId) => {
      assert.equal(projectionId, stub.projectionId);
      return stub;
    },
  });

  await withServer(service, async (baseUrl) => {
    const uploadResult = await upload(baseUrl, metadata({
      assetId: 'asset_equipment_route_dagger',
      assetVersion: 1,
      assetType: 'equipment',
      role: 'icon',
      tagCodes: ['equipment.weapon', 'equipment.melee'],
      featureCodes: ['feature.icon', 'feature.blade'],
    }), makePng({ colorType: 2, rgb: [77, 66, 55] }));
    assert.equal(uploadResult.status, 200, JSON.stringify(uploadResult.body));
    uploadedAssets.dagger = uploadResult.body.asset;
    publishedCatalog = await publishCatalog(baseUrl, 'vc_matchcat01', 1, [{ assetId: uploadedAssets.dagger.assetId, assetVersion: 1 }]);
    const publishedAsset = await request(baseUrl, 'GET', '/v1/admin/assets/asset_equipment_route_dagger/1');
    assert.equal(publishedAsset.status, 200, JSON.stringify(publishedAsset.body));
    uploadedAssets.dagger = publishedAsset.body.asset;
    stub = visualProjectionStub({ catalog: publishedCatalog });
    proof = signProjectionProof({ stub, secret: projectionSecret });

    const noOrigin = await request(baseUrl, 'POST', '/v1/visual-match', {
      origin: null,
      token: null,
      body: visualMatchRequest(),
    });
    assert.equal(noOrigin.status, 403);

    const noProof = await request(baseUrl, 'POST', '/v1/visual-match', {
      token: null,
      body: visualMatchRequest(),
    });
    assert.equal(noProof.status, 401);
    assert.equal(noProof.body.error.code, 'VISUAL_MATCH_PROOF_MISSING');

    const queryProof = await fetch(`${baseUrl}/v1/visual-match?proof=${base64UrlEncodeCanonical(proof)}`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        'content-type': 'application/json',
        'x-galgame-visual-projection-proof': base64UrlEncodeCanonical(proof),
      },
      body: JSON.stringify(visualMatchRequest()),
    });
    assert.equal(queryProof.status, 400);
    assert.equal((await queryProof.json()).error.code, 'VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN');

    const cookieProof = await fetch(`${baseUrl}/v1/visual-match`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        cookie: `proof=${base64UrlEncodeCanonical(proof)}`,
        'content-type': 'application/json',
        'x-galgame-visual-projection-proof': base64UrlEncodeCanonical(proof),
      },
      body: JSON.stringify(visualMatchRequest()),
    });
    assert.equal(cookieProof.status, 400);
    assert.equal((await cookieProof.json()).error.code, 'VISUAL_MATCH_FORBIDDEN_TRANSPORT');

    const preflight = await fetch(`${baseUrl}/v1/visual-match`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-galgame-visual-projection-proof',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'content-type,x-galgame-visual-projection-proof');

    const selected = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
    assert.equal(selected.status, 200, JSON.stringify(selected.body));
    assert.equal(selected.body.ok, true);
    assert.match(selected.body.result.bindingId, /^vb_[a-z0-9_-]{12,80}$/);
    assert.match(selected.body.result.matchId, /^vm_[a-z0-9_-]{12,80}$/);
    assert.equal(selected.body.result.assetId, 'asset_equipment_route_dagger');
    assert.equal(selected.body.result.usesLlm, false);

    const browserWithBearer = await fetch(`${baseUrl}/v1/visual-match`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${visualMatchServiceToken}`,
        'content-type': 'application/json',
        'x-galgame-visual-projection-proof': base64UrlEncodeCanonical(proof),
      },
      body: JSON.stringify(visualMatchRequest()),
    });
    assert.equal(browserWithBearer.status, 400);
    assert.equal((await browserWithBearer.json()).error.code, 'VISUAL_MATCH_FORBIDDEN_TRANSPORT');

    const internalNoAuth = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: null,
    });
    assert.equal(internalNoAuth.status, 401);
    assert.equal(internalNoAuth.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_MISSING');

    const internalWrongAuth = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: 'wrong-visual-match-service-token',
    });
    assert.equal(internalWrongAuth.status, 401);
    assert.equal(internalWrongAuth.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_REJECTED');

    const internalMalformedAuth = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      headers: { authorization: 'Token not-a-bearer-token' },
    });
    assert.equal(internalMalformedAuth.status, 401);
    assert.equal(internalMalformedAuth.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_INVALID');

    const internalShortAuth = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: 'short',
    });
    assert.equal(internalShortAuth.status, 401);
    assert.equal(internalShortAuth.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_INVALID');

    const internalBrowserOrigin = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      headers: { origin: ORIGIN },
    });
    assert.equal(internalBrowserOrigin.status, 403);
    assert.equal(internalBrowserOrigin.body.error.code, 'VISUAL_MATCH_SERVICE_BROWSER_FORBIDDEN');

    const internalCookie = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      headers: { cookie: `projectionProof=${base64UrlEncodeCanonical(proof)}` },
    });
    assert.equal(internalCookie.status, 400);
    assert.equal(internalCookie.body.error.code, 'VISUAL_MATCH_FORBIDDEN_TRANSPORT');

    const internalQuery = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      route: `/v1/internal/visual-match?proof=${base64UrlEncodeCanonical(proof)}`,
    });
    assert.equal(internalQuery.status, 400);
    assert.equal(internalQuery.body.error.code, 'VISUAL_MATCH_FORBIDDEN_TRANSPORT');

    const internalRawProof = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      headers: { 'x-galgame-visual-projection-proof-json': canonicalJson(proof) },
    });
    assert.equal(internalRawProof.status, 400);
    assert.equal(internalRawProof.body.error.code, 'VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN');

    const internalRestoreProofHeader = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
      headers: { 'x-galgame-visual-restore-proof': 'gvosrp1.forbidden.header' },
    });
    assert.equal(internalRestoreProofHeader.status, 400);
    assert.equal(internalRestoreProofHeader.body.error.code, 'VISUAL_MATCH_FORBIDDEN_TRANSPORT');

    const internalBodyProof = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: { ...visualMatchRequest(), projectionProof: proof },
      token: visualMatchServiceToken,
    });
    assert.equal(internalBodyProof.status, 400);

    const internalOptions = await fetch(`${baseUrl}/v1/internal/visual-match`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-galgame-visual-projection-proof',
      },
    });
    assert.equal(internalOptions.status, 403);
    assert.equal((await internalOptions.json()).error.code, 'VISUAL_MATCH_SERVICE_BROWSER_FORBIDDEN');

    const internalSelected = await visualMatchInternalRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest(),
      token: visualMatchServiceToken,
    });
    assert.equal(internalSelected.status, 200, JSON.stringify(internalSelected.body));
    assert.deepEqual(internalSelected.body.result, selected.body.result);

    const bindingId = selected.body.result.bindingId;
    const record = bindingStore.records.get(bindingId);
    const retained = await bindingStore.retainBindingsForRestore({
      retentionId: 'vbrtn_restore_route_0001',
      bindingIds: [bindingId],
      createdAt: '2026-08-01T00:00:00.000Z',
      retentionUntil: '2099-08-02T00:00:00.000Z',
    });
    const receipt = retained.receipts[0];
    const retention = retained.retention;
    assert.equal(receipt.bindingRecordHash, hashDigest(canonicalJson(record)));
    assert.equal(receipt.assetContentSha256, `sha256:${record.assetContentSha256}`);
    assert.equal(receipt.retentionHash, retention.retentionHash);
    assert.deepEqual(receiptRecordMismatches({ receipt, retention, record }), []);
    const restoreBody = visualRestoreBindingRequest({ record, receipt, retention });
    const oldSaveProof = signRestoreProofToken({
      prefix: 'gvosrp1',
      secret: restoreSecret,
      payload: oldSaveRestoreProofPayload({
        record,
        receipt,
        retention,
        keyId: restoreKeyId,
        nonce: 'nonce_RESTOREOLD000001',
      }),
    });
    const oldSaveRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: oldSaveProof,
      requestBody: restoreBody,
    });
    assert.equal(oldSaveRestore.status, 200, JSON.stringify(oldSaveRestore.body));
    assert.deepEqual(oldSaveRestore.body.binding, bindingStore.bindings.get(bindingId));

    const oldSaveReplay = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: oldSaveProof,
      requestBody: restoreBody,
    });
    assert.equal(oldSaveReplay.status, 200, JSON.stringify(oldSaveReplay.body));
    const oldSaveReplayConflict = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: oldSaveProof,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0002' },
    });
    assert.equal(oldSaveReplayConflict.status, 409);
    assert.equal(oldSaveReplayConflict.body.error.code, 'VISUAL_RESTORE_REPLAY_CONFLICT');

    const envRestoreKeys = [
      'GALGAME_VISUAL_RESTORE_SERVICE_TOKEN',
      'GALGAME_VISUAL_RESTORE_PROOF_SECRET',
      'GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS',
      'GALGAME_VISUAL_RESTORE_PROOF_KEY_IDS',
      'GALGAME_VISUAL_RESTORE_PROOF_KEY_ID',
    ];
    const savedRestoreEnv = Object.fromEntries(envRestoreKeys.map((key) => [key, process.env[key]]));
    try {
      process.env.GALGAME_VISUAL_RESTORE_SERVICE_TOKEN = restoreToken;
      process.env.GALGAME_VISUAL_RESTORE_PROOF_SECRET = restoreSecret;
      process.env.GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS = restoreKeyId;
      delete process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_IDS;
      delete process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_ID;
      const acceptedEnvService = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        adminOrigins: [ORIGIN],
        bindingStore,
        restoreReplayStore: new MemoryRestoreReplayStore(fixedNow),
        assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
        now: fixedNow,
      });
      await withServer(acceptedEnvService, async (acceptedBaseUrl) => {
        const accepted = await visualRestoreRequestHttp(acceptedBaseUrl, {
          route: '/v1/visual/restore-bindings/old-save',
          token: restoreToken,
          proofToken: oldSaveProof,
          requestBody: restoreBody,
        });
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      });

      delete process.env.GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS;
      process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_IDS = restoreKeyId;
      process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_ID = restoreKeyId;
      const missingAcceptedEnvService = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        adminOrigins: [ORIGIN],
        bindingStore,
        restoreReplayStore: new MemoryRestoreReplayStore(fixedNow),
        assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
        now: fixedNow,
      });
      await withServer(missingAcceptedEnvService, async (missingBaseUrl) => {
        const missing = await visualRestoreRequestHttp(missingBaseUrl, {
          route: '/v1/visual/restore-bindings/old-save',
          token: restoreToken,
          proofToken: oldSaveProof,
          requestBody: restoreBody,
        });
        assert.equal(missing.status, 503);
        assert.equal(missing.body.error.code, 'VISUAL_RESTORE_PROOF_KEY_UNCONFIGURED');
      });

      process.env.GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS = 'vis_restore_key_wrong001';
      delete process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_IDS;
      delete process.env.GALGAME_VISUAL_RESTORE_PROOF_KEY_ID;
      const rejectedAcceptedEnvService = createVisualAssetService({
        adminToken: ADMIN_TOKEN,
        adminOrigins: [ORIGIN],
        bindingStore,
        restoreReplayStore: new MemoryRestoreReplayStore(fixedNow),
        assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
        now: fixedNow,
      });
      await withServer(rejectedAcceptedEnvService, async (rejectedBaseUrl) => {
        const rejected = await visualRestoreRequestHttp(rejectedBaseUrl, {
          route: '/v1/visual/restore-bindings/old-save',
          token: restoreToken,
          proofToken: oldSaveProof,
          requestBody: restoreBody,
        });
        assert.equal(rejected.status, 403);
        assert.equal(rejected.body.error.code, 'VISUAL_RESTORE_PROOF_KEY_REJECTED');
      });
    } finally {
      for (const key of envRestoreKeys) {
        if (savedRestoreEnv[key] === undefined) delete process.env[key];
        else process.env[key] = savedRestoreEnv[key];
      }
    }

    const rollbackProof = signRestoreProofToken({
      prefix: 'gvrrp1',
      secret: restoreSecret,
      payload: rollbackRestoreProofPayload({
        record,
        retention,
        keyId: restoreKeyId,
        nonce: 'nonce_RESTOREROLLBACK1',
      }),
    });
    const rollbackRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/rollback',
      token: restoreToken,
      proofToken: rollbackProof,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0003', idempotencyKey: 'idem_RESTOREKEY0000003' },
    });
    assert.equal(rollbackRestore.status, 200, JSON.stringify(rollbackRestore.body));
    assert.deepEqual(rollbackRestore.body.binding, bindingStore.bindings.get(bindingId));

    const badOldProof = signRestoreProofToken({
      prefix: 'gvosrp1',
      secret: restoreSecret,
      payload: oldSaveRestoreProofPayload({
        record,
        receipt,
        retention,
        keyId: restoreKeyId,
        nonce: 'nonce_RESTOREOLD000004',
      }),
    });
    const restoreReplaySizeBeforeFailure = restoreReplayStore.entries.size;
    const badRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: badOldProof,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0004', idempotencyKey: 'idem_RESTOREKEY0000004', expectedAssetContentSha256: hashDigest('tampered-asset-content') },
    });
    assert.equal(badRestore.status, 409);
    assert.equal(badRestore.body.error.code, 'VISUAL_RESTORE_ASSET_HASH_MISMATCH');
    assert.equal(restoreReplayStore.entries.size, restoreReplaySizeBeforeFailure);
    const goodAfterFailure = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: badOldProof,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0005', idempotencyKey: 'idem_RESTOREKEY0000005' },
    });
    assert.equal(goodAfterFailure.status, 200, JSON.stringify(goodAfterFailure.body));

    const noRestoreAuth = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: null,
      proofToken: oldSaveProof,
      requestBody: restoreBody,
    });
    assert.equal(noRestoreAuth.status, 401);
    assert.equal(noRestoreAuth.body.error.code, 'VISUAL_RESTORE_SERVICE_AUTH_MISSING');
    const wrongRestoreAuth = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: 'wrong-restore-token',
      proofToken: oldSaveProof,
      requestBody: restoreBody,
    });
    assert.equal(wrongRestoreAuth.status, 401);
    assert.equal(wrongRestoreAuth.body.error.code, 'VISUAL_RESTORE_SERVICE_AUTH_INVALID');
    const browserRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: oldSaveProof,
      requestBody: restoreBody,
      origin: ORIGIN,
    });
    assert.equal(browserRestore.status, 403);
    assert.equal(browserRestore.body.error.code, 'VISUAL_RESTORE_BROWSER_FORBIDDEN');
    const cookieRestore = await fetch(`${baseUrl}/v1/visual/restore-bindings/old-save`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${restoreToken}`,
        cookie: `restoreProof=${oldSaveProof}`,
        'content-type': 'application/json',
        'x-galgame-visual-restore-proof': oldSaveProof,
      },
      body: JSON.stringify(restoreBody),
    });
    assert.equal(cookieRestore.status, 400);
    assert.equal((await cookieRestore.json()).error.code, 'VISUAL_RESTORE_FORBIDDEN_TRANSPORT');
    const queryRestore = await visualRestoreRequestHttp(baseUrl, {
      route: `/v1/visual/restore-bindings/old-save?proof=${oldSaveProof}`,
      token: restoreToken,
      proofToken: oldSaveProof,
      requestBody: restoreBody,
    });
    assert.equal(queryRestore.status, 400);
    assert.equal(queryRestore.body.error.code, 'VISUAL_RESTORE_FORBIDDEN_TRANSPORT');
    const wrongRouteProof = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: rollbackProof,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0006', idempotencyKey: 'idem_RESTOREKEY0000006' },
    });
    assert.equal(wrongRouteProof.status, 403);
    assert.equal(wrongRouteProof.body.error.code, 'VISUAL_RESTORE_PROOF_PURPOSE_MISMATCH');
    const badSignatureRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: `${oldSaveProof.slice(0, -1)}x`,
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0008', idempotencyKey: 'idem_RESTOREKEY0000008' },
    });
    assert.equal(badSignatureRestore.status, 403);
    assert.equal(badSignatureRestore.body.error.code, 'VISUAL_RESTORE_PROOF_SIGNATURE_INVALID');
    const entityUnknownRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: signRestoreProofToken({
        prefix: 'gvosrp1',
        secret: restoreSecret,
        payload: oldSaveRestoreProofPayload({
          record,
          receipt,
          retention,
          keyId: restoreKeyId,
          nonce: 'nonce_RESTOREOLD000008',
        }),
      }),
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0009', idempotencyKey: 'idem_RESTOREKEY0000009', entityKey: 'entity_unknown_restore01' },
    });
    assert.equal(entityUnknownRestore.status, 400);
    assert.equal(entityUnknownRestore.body.error.code, 'VISUAL_RESTORE_REQUEST_SCOPE_MISMATCH');
    const unknownItemFallbackRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: signRestoreProofToken({
        prefix: 'gvosrp1',
        secret: restoreSecret,
        payload: oldSaveRestoreProofPayload({
          record,
          receipt,
          retention,
          keyId: restoreKeyId,
          nonce: 'nonce_RESTOREOLD000009',
        }),
      }),
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0010', idempotencyKey: 'idem_RESTOREKEY0000010', expectedAssetId: 'unknown_item' },
    });
    assert.equal(unknownItemFallbackRestore.status, 409);
    assert.equal(unknownItemFallbackRestore.body.error.code, 'VISUAL_RESTORE_TYPE_MISMATCH');
    const plainHashRestore = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: signRestoreProofToken({
        prefix: 'gvosrp1',
        secret: restoreSecret,
        payload: oldSaveRestoreProofPayload({
          record,
          receipt,
          retention,
          keyId: restoreKeyId,
          nonce: 'nonce_RESTOREOLD000010',
        }),
      }),
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0011', idempotencyKey: 'idem_RESTOREKEY0000011', expectedAssetContentSha256: record.assetContentSha256 },
    });
    assert.equal(plainHashRestore.status, 400);
    assert.equal(plainHashRestore.body.error.code, 'VISUAL_ASSET_INVALID_FIELD');

    const originalReceipt = bindingStore.receipts.get(receipt.receiptId);
    bindingStore.receipts.set(receipt.receiptId, { ...originalReceipt, assetType: 'item' });
    const tamperedReceipt = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: signRestoreProofToken({
        prefix: 'gvosrp1',
        secret: restoreSecret,
        payload: oldSaveRestoreProofPayload({
          record,
          receipt,
          retention,
          keyId: restoreKeyId,
          nonce: 'nonce_RESTOREOLD000007',
        }),
      }),
      requestBody: { ...restoreBody, requestId: 'req_VISUALRESTORE0007', idempotencyKey: 'idem_RESTOREKEY0000007' },
    });
    assert.equal(tamperedReceipt.status, 409);
    assert.equal(tamperedReceipt.body.error.code, 'VISUAL_RESTORE_TYPE_MISMATCH');
    bindingStore.receipts.set(receipt.receiptId, originalReceipt);

    const replayDifferentIdem = await visualMatchRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest({ idempotencyKey: 'idem_ZYXWVUTSRQPONMLK' }),
    });
    assert.equal(replayDifferentIdem.status, 200, JSON.stringify(replayDifferentIdem.body));
    assert.deepEqual(replayDifferentIdem.body.result, selected.body.result);
    const expectedProofReplayKey = hashDigest(canonicalJson({
      nonce: proof.nonce,
      projectionId: proof.projectionId,
      projectionHash: proof.projectionHash,
      releaseId: proof.releaseId,
      scenarioId: proof.scenarioId,
      scenarioVersion: proof.scenarioVersion,
      arcId: proof.arcId,
      chatId: proof.chatId,
      visualProfileId: proof.profileId,
      profileHash: proof.profileHash,
      catalogId: proof.catalogId,
      catalogRevision: proof.catalogRevision,
      catalogHash: proof.catalogHash,
      sourceMessageIndex: proof.sourceMessageIndex,
      sourceMessageHash: proof.sourceMessageHash,
      entityKey: visualMatchRequest().entityKey,
    }));
    assert.equal(proofReplayStore.entries.has(expectedProofReplayKey), true);
    assert.throws(() => proofReplayStore.prepare(
      expectedProofReplayKey,
      proof,
      visualMatchRequest().entityKey,
      hashDigest('changed-public-result'),
    ), /conflict/i);
    const otherEntityProofReplayKey = hashDigest(canonicalJson({
      nonce: proof.nonce,
      projectionId: proof.projectionId,
      projectionHash: proof.projectionHash,
      releaseId: proof.releaseId,
      scenarioId: proof.scenarioId,
      scenarioVersion: proof.scenarioVersion,
      arcId: proof.arcId,
      chatId: proof.chatId,
      visualProfileId: proof.profileId,
      profileHash: proof.profileHash,
      catalogId: proof.catalogId,
      catalogRevision: proof.catalogRevision,
      catalogHash: proof.catalogHash,
      sourceMessageIndex: proof.sourceMessageIndex,
      sourceMessageHash: proof.sourceMessageHash,
      entityKey: 'entity_character_replayprobe',
    }));
    const otherEntityReservation = proofReplayStore.prepare(
      otherEntityProofReplayKey,
      proof,
      'entity_character_replayprobe',
      hashDigest(canonicalJson(selected.body.result)),
    );
    otherEntityReservation.commit();
    assert.equal(proofReplayStore.entries.has(otherEntityProofReplayKey), true);
    assert.equal(proofReplayStore.nonceIndex.get(proof.nonce).keys.has(expectedProofReplayKey), true);
    assert.equal(proofReplayStore.nonceIndex.get(proof.nonce).keys.has(otherEntityProofReplayKey), true);
    const crossScopeProof = { ...proof, catalogHash: hashDigest('other-catalog-scope') };
    const crossScopeProofReplayKey = hashDigest(canonicalJson({
      nonce: crossScopeProof.nonce,
      projectionId: crossScopeProof.projectionId,
      projectionHash: crossScopeProof.projectionHash,
      releaseId: crossScopeProof.releaseId,
      scenarioId: crossScopeProof.scenarioId,
      scenarioVersion: crossScopeProof.scenarioVersion,
      arcId: crossScopeProof.arcId,
      chatId: crossScopeProof.chatId,
      visualProfileId: crossScopeProof.profileId,
      profileHash: crossScopeProof.profileHash,
      catalogId: crossScopeProof.catalogId,
      catalogRevision: crossScopeProof.catalogRevision,
      catalogHash: crossScopeProof.catalogHash,
      sourceMessageIndex: crossScopeProof.sourceMessageIndex,
      sourceMessageHash: crossScopeProof.sourceMessageHash,
      entityKey: 'entity_skill_replayprobe',
    }));
    assert.throws(() => proofReplayStore.prepare(
      crossScopeProofReplayKey,
      crossScopeProof,
      'entity_skill_replayprobe',
      hashDigest(canonicalJson(selected.body.result)),
    ), /different replay scope/i);

    const wrongEntity = await visualMatchRequestHttp(baseUrl, {
      proof,
      requestBody: visualMatchRequest({
        entityKey: 'entity_equipment_otheritem',
        idempotencyKey: 'idem_OTHERIDEMPOTENT1',
      }),
    });
    assert.equal(wrongEntity.status, 409);
    assert.equal(wrongEntity.body.error.code, 'VISUAL_MATCH_ENTITY_NOT_IN_PROJECTION');

    const tamperedProof = { ...proof, catalogHash: hashDigest('tampered-catalog') };
    const badProof = await visualMatchRequestHttp(baseUrl, { proof: tamperedProof, requestBody: visualMatchRequest() });
    assert.equal(badProof.status, 403);
    assert.equal(badProof.body.error.code, 'VISUAL_MATCH_PROOF_SIGNATURE_INVALID');
  });

  const unconfigured = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualProjectionSecret: projectionSecret,
    projectionStubReader: async () => stub,
    now: fixedNow,
  });
  await withServer(unconfigured, async (baseUrl) => {
    const result = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'VISUAL_MATCH_BINDING_STORE_UNCONFIGURED');
  });

  const matchEnvKeys = ['GALGAME_VISUAL_MATCH_SERVICE_TOKEN'];
  const savedMatchEnv = Object.fromEntries(matchEnvKeys.map((key) => [key, process.env[key]]));
  try {
    process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN = visualMatchServiceToken;
    const envTokenService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualProjectionSecret: projectionSecret,
      bindingStore: new MemoryVisualBindingStore(),
      proofReplayStore: new MemoryProofReplayStore(fixedNow),
      assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
      projectionStubReader: async () => stub,
      now: fixedNow,
    });
    await withServer(envTokenService, async (baseUrl) => {
      const result = await visualMatchInternalRequestHttp(baseUrl, {
        proof,
        requestBody: visualMatchRequest(),
        token: visualMatchServiceToken,
      });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    });

    delete process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN;
    const missingEnvTokenService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualProjectionSecret: projectionSecret,
      bindingStore: new MemoryVisualBindingStore(),
      proofReplayStore: new MemoryProofReplayStore(fixedNow),
      assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
      projectionStubReader: async () => stub,
      now: fixedNow,
    });
    await withServer(missingEnvTokenService, async (baseUrl) => {
      const result = await visualMatchInternalRequestHttp(baseUrl, {
        proof,
        requestBody: visualMatchRequest(),
        token: visualMatchServiceToken,
      });
      assert.equal(result.status, 503);
      assert.equal(result.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_UNCONFIGURED');
    });

    process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN = 'too-short';
    const invalidEnvTokenService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualProjectionSecret: projectionSecret,
      bindingStore: new MemoryVisualBindingStore(),
      proofReplayStore: new MemoryProofReplayStore(fixedNow),
      assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
      projectionStubReader: async () => stub,
      now: fixedNow,
    });
    await withServer(invalidEnvTokenService, async (baseUrl) => {
      const result = await visualMatchInternalRequestHttp(baseUrl, {
        proof,
        requestBody: visualMatchRequest(),
        token: visualMatchServiceToken,
      });
      assert.equal(result.status, 503);
      assert.equal(result.body.error.code, 'VISUAL_MATCH_SERVICE_AUTH_CONFIG_INVALID');
    });
  } finally {
    for (const key of matchEnvKeys) {
      if (savedMatchEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedMatchEnv[key];
    }
  }

  const replayStoreAfterFailure = new MemoryProofReplayStore(fixedNow);
  const failingBindingStore = {
    async initialize() {},
    async saveOrReuse() {
      const error = new Error('simulated disk failure');
      error.code = 'VISUAL_MATCH_BINDING_STORE_WRITE_FAILED';
      error.status = 503;
      throw error;
    },
  };
  const failingService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualProjectionSecret: projectionSecret,
    bindingStore: failingBindingStore,
    proofReplayStore: replayStoreAfterFailure,
    assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
    projectionStubReader: async () => stub,
    now: fixedNow,
  });
  await withServer(failingService, async (baseUrl) => {
    const failed = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error.code, 'VISUAL_MATCH_BINDING_STORE_WRITE_FAILED');
  });
  assert.equal(replayStoreAfterFailure.entries.size, 0);
  assert.equal(replayStoreAfterFailure.nonceIndex.size, 0);

  const fileRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-bindings-'));
  const fileStore = new FileVisualBindingStore(fileRoot);
  const fileService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualProjectionSecret: projectionSecret,
    bindingStore: fileStore,
    proofReplayStore: new MemoryProofReplayStore(fixedNow),
    assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
    projectionStubReader: async () => stub,
    now: fixedNow,
  });
  let fileResult = null;
  await withServer(fileService, async (baseUrl) => {
    fileResult = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
    assert.equal(fileResult.status, 200, JSON.stringify(fileResult.body));
  });
  const fileRetained = await fileStore.retainBindingsForRestore({
    retentionId: 'vbrtn_file_restore_0001',
    bindingIds: [fileResult.body.result.bindingId],
    createdAt: '2026-08-01T00:00:00.000Z',
    retentionUntil: '2099-08-02T00:00:00.000Z',
  });
  assert.equal(fileRetained.receipts.length, 1);
  const restartedFileStore = new FileVisualBindingStore(fileRoot);
  assert.equal(restartedFileStore.records.size, 1);
  assert.equal(restartedFileStore.retentions.size, 1);
  assert.equal(restartedFileStore.receipts.size, 1);
  assert.equal(restartedFileStore.results.get(fileResult.body.result.bindingId).bindingId, fileResult.body.result.bindingId);
  assert.equal(restartedFileStore.getRestoreBundle(fileResult.body.result.bindingId).receipt.bindingId, fileResult.body.result.bindingId);
  assert.equal(readdirSync(path.join(fileRoot, 'indexes', 'by-idempotency')).length, 1);
  const fileRestoreBundle = restartedFileStore.getRestoreBundle(fileResult.body.result.bindingId);
  const fileRestoreBody = visualRestoreBindingRequest({
    record: fileRestoreBundle.record,
    receipt: fileRestoreBundle.receipt,
    retention: fileRestoreBundle.retention,
    overrides: {
      requestId: 'req_VISUALRESTOREFILE1',
      idempotencyKey: 'idem_RESTOREFILE000001',
    },
  });
  const fileRestoreProof = signRestoreProofToken({
    prefix: 'gvosrp1',
    secret: restoreSecret,
    payload: oldSaveRestoreProofPayload({
      record: fileRestoreBundle.record,
      receipt: fileRestoreBundle.receipt,
      keyId: restoreKeyId,
      nonce: 'nonce_RESTOREFILE00001',
    }),
  });
  const fileRestoreReplayStore = new FileVisualRestoreReplayStore(fileRoot, fixedNow);
  const fileRestoreService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualRestoreServiceToken: restoreToken,
    visualRestoreProofSecret: restoreSecret,
    visualRestoreProofKeyIds: [restoreKeyId],
    bindingStore: restartedFileStore,
    restoreReplayStore: fileRestoreReplayStore,
    assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
    now: fixedNow,
  });
  await withServer(fileRestoreService, async (baseUrl) => {
    const restored = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: fileRestoreProof,
      requestBody: fileRestoreBody,
    });
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
  });
  const replayFiles = readdirSync(path.join(fileRoot, 'restore-replay')).filter((name) => name.endsWith('.json'));
  assert.equal(replayFiles.length, 1);
  const replayRecordBytes = readFileSync(path.join(fileRoot, 'restore-replay', replayFiles[0]));
  const restartedReplayStore = new FileVisualRestoreReplayStore(fileRoot, fixedNow);
  const replayedRestoreService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualRestoreServiceToken: restoreToken,
    visualRestoreProofSecret: restoreSecret,
    visualRestoreProofKeyIds: [restoreKeyId],
    bindingStore: restartedFileStore,
    restoreReplayStore: restartedReplayStore,
    assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
    now: fixedNow,
  });
  await withServer(replayedRestoreService, async (baseUrl) => {
    const replayed = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: fileRestoreProof,
      requestBody: fileRestoreBody,
    });
    assert.equal(replayed.status, 200, JSON.stringify(replayed.body));
    const conflict = await visualRestoreRequestHttp(baseUrl, {
      route: '/v1/visual/restore-bindings/old-save',
      token: restoreToken,
      proofToken: fileRestoreProof,
      requestBody: { ...fileRestoreBody, requestId: 'req_VISUALRESTOREFILE2' },
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'VISUAL_RESTORE_REPLAY_CONFLICT');
  });
  const expiredReplayStore = new FileVisualRestoreReplayStore(fileRoot, () => Date.parse('2026-08-01T00:03:00.000Z'));
  assert.equal(expiredReplayStore.entries.size, 0);
  assert.equal(readdirSync(path.join(fileRoot, 'restore-replay')).filter((name) => name.endsWith('.json')).length, 0);

  const partialBindingCases = [
    {
      label: 'root binding temp',
      setup(root) {
        mkdirSync(path.join(root, '.tmp-visual-binding-leftover'), { recursive: true });
      },
      pattern: /partial binding temp/i,
    },
    {
      label: 'root retention temp',
      setup(root) {
        mkdirSync(path.join(root, '.tmp-visual-binding-retention-leftover'), { recursive: true });
      },
      pattern: /partial binding temp/i,
    },
    {
      label: 'retention temp file',
      setup(root) {
        mkdirSync(path.join(root, 'retentions'), { recursive: true });
        writeFileSync(path.join(root, 'retentions', '.tmp-retention.json'), '{}');
      },
      pattern: /retention file name invalid/i,
    },
    {
      label: 'receipt temp file',
      setup(root) {
        mkdirSync(path.join(root, 'receipts', 'by-binding'), { recursive: true });
        writeFileSync(path.join(root, 'receipts', 'by-binding', '.tmp-receipt.json'), '{}');
      },
      pattern: /receipt file name invalid/i,
    },
    {
      label: 'idempotency index temp file',
      setup(root) {
        mkdirSync(path.join(root, 'indexes', 'by-idempotency'), { recursive: true });
        writeFileSync(path.join(root, 'indexes', 'by-idempotency', '.tmp-index.json'), '{}');
      },
      pattern: /idempotencyIndex file name invalid/i,
    },
  ];
  for (const testCase of partialBindingCases) {
    const partialRoot = mkdtempSync(path.join(os.tmpdir(), `galgame-visual-binding-partial-${testCase.label.replace(/[^a-z]/g, '-')}-`));
    testCase.setup(partialRoot);
    assert.throws(() => new FileVisualBindingStore(partialRoot), testCase.pattern, testCase.label);
  }

  const corruptReplayRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-restore-replay-corrupt-'));
  mkdirSync(path.join(corruptReplayRoot, 'restore-replay'), { recursive: true });
  writeFileSync(path.join(corruptReplayRoot, 'restore-replay', `${'a'.repeat(64)}.json`), '{bad');
  assert.throws(() => new FileVisualRestoreReplayStore(corruptReplayRoot, fixedNow), /JSON|restore replay/i);
  const tempReplayRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-restore-replay-temp-'));
  mkdirSync(path.join(tempReplayRoot, 'restore-replay'), { recursive: true });
  writeFileSync(path.join(tempReplayRoot, 'restore-replay', '.tmp-visual-restore-replay-leftover.json'), '{}');
  assert.throws(() => new FileVisualRestoreReplayStore(tempReplayRoot, fixedNow), /partial|temp/i);
  const mismatchReplayRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-restore-replay-mismatch-'));
  mkdirSync(path.join(mismatchReplayRoot, 'restore-replay'), { recursive: true });
  writeFileSync(path.join(mismatchReplayRoot, 'restore-replay', `${'b'.repeat(64)}.json`), replayRecordBytes);
  assert.throws(() => new FileVisualRestoreReplayStore(mismatchReplayRoot, fixedNow), /filename|mismatch/i);
  const replaySymlinkRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-restore-replay-symlink-'));
  mkdirSync(path.join(replaySymlinkRoot, 'restore-replay'), { recursive: true });
  const replayOutsideTarget = path.join(mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-restore-replay-outside-')), 'record.json');
  writeFileSync(replayOutsideTarget, '{}');
  try {
    symlinkSync(replayOutsideTarget, path.join(replaySymlinkRoot, 'restore-replay', `${'c'.repeat(64)}.json`), 'file');
    assert.throws(() => new FileVisualRestoreReplayStore(replaySymlinkRoot, fixedNow), /symlink/i);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EINVAL'].includes(error.code)) throw error;
    console.log(`visual restore replay symlink regression skipped: ${error.code}`);
  }

  const bindingDir = path.join(fileRoot, 'bindings', fileResult.body.result.bindingId);
  writeFileSync(path.join(bindingDir, 'extra.json'), '{}');
  assert.throws(() => new FileVisualBindingStore(fileRoot), /incomplete|unexpected/i);

  const symlinkRoot = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-bindings-symlink-'));
  mkdirSync(path.join(symlinkRoot, 'bindings'), { recursive: true });
  mkdirSync(path.join(symlinkRoot, 'indexes', 'by-idempotency'), { recursive: true });
  mkdirSync(path.join(symlinkRoot, 'indexes', 'by-active-entity'), { recursive: true });
  const outsideTarget = mkdtempSync(path.join(os.tmpdir(), 'galgame-visual-bindings-outside-'));
  try {
    symlinkSync(outsideTarget, path.join(symlinkRoot, 'bindings', 'vb_abcdefghijkl'), 'dir');
    assert.throws(() => new FileVisualBindingStore(symlinkRoot), /symlink/i);
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EINVAL'].includes(error.code)) throw error;
    console.log(`visual binding symlink regression skipped: ${error.code}`);
  }

  const missingStubReader = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualMatchPlayerOrigins: [ORIGIN],
    visualProjectionSecret: projectionSecret,
    bindingStore: new MemoryVisualBindingStore(),
    assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
    now: fixedNow,
  });
  await withServer(missingStubReader, async (baseUrl) => {
    const result = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'VISUAL_MATCH_STUB_READER_UNCONFIGURED');
  });

  await withRawServer((req, res) => {
    if (req.headers.authorization !== 'Bearer stub-token') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    if (req.url !== `/v1/visual/projection-stubs/${stub.projectionId}`) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(canonicalJson(stub));
  }, async (stubBaseUrl) => {
    const httpStubService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualMatchPlayerOrigins: [ORIGIN],
      visualProjectionSecret: projectionSecret,
      projectionStubBaseUrl: stubBaseUrl,
      projectionStubServiceToken: 'stub-token',
      bindingStore: new MemoryVisualBindingStore(),
      assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
      proofReplayStore: new MemoryProofReplayStore(fixedNow),
      now: fixedNow,
    });
    await withServer(httpStubService, async (baseUrl) => {
      const result = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    });
  });

  await withRawServer((_req, res) => {
    res.writeHead(302, { location: 'http://127.0.0.1/elsewhere' });
    res.end();
  }, async (stubBaseUrl) => {
    const redirectStubService = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      visualMatchPlayerOrigins: [ORIGIN],
      visualProjectionSecret: projectionSecret,
      projectionStubBaseUrl: stubBaseUrl,
      projectionStubServiceToken: 'stub-token',
      bindingStore: new MemoryVisualBindingStore(),
      assetStore: clonePublishedAssetStore({ asset: uploadedAssets.dagger, catalog: publishedCatalog }),
      now: fixedNow,
    });
    await withServer(redirectStubService, async (baseUrl) => {
      const result = await visualMatchRequestHttp(baseUrl, { proof, requestBody: visualMatchRequest() });
      assert.equal(result.status, 502);
      assert.equal(result.body.error.code, 'VISUAL_MATCH_STUB_REDIRECT_REJECTED');
    });
  });
}

async function testForbiddenFutureRoutes() {
  const service = createVisualAssetService({ adminToken: ADMIN_TOKEN, adminOrigins: [ORIGIN] });
  await withServer(service, async (baseUrl) => {
    const futureMatch = await request(baseUrl, 'POST', '/v1/' + 'visual-match', { body: {} });
    assert.equal(futureMatch.status, 403);
    const playerContent = await request(baseUrl, 'GET', '/v1/assets/catalog/1/asset/1/content', { token: null, origin: null });
    assert.equal(playerContent.status, 404);
  });
}

function candidateDecisionInput(overrides = {}) {
  const entityType = overrides.entityType || 'equipment';
  const candidates = overrides.candidates || [];
  const catalog = overrides.catalog || createCandidateCatalog([]);
  const { catalog: _ignoredCatalog, ...rest } = overrides;
  return {
    schemaVersion: CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
    requestId: 'req_ABCDEFGHIJKLMNOP',
    projectionId: 'vvp_abcdefghijkl',
    entityKey: `entity_${entityType}_${entityType === 'character' ? 'pippa001' : 'rustydag01'}`,
    entityType,
    confidenceBand: 'explicit',
    visibleAttributeCodes: [`${entityType}-visible-label`, `${entityType}-visible-trait`],
    sourceMessageIndex: 2,
    sourceMessageHash: hashDigest('source-message'),
    evidenceDigest: hashDigest('evidence'),
    releaseId: 'release_alpha',
    scenarioId: 'scenario_alpha',
    scenarioVersion: 'v1',
    arcId: 'main',
    chatId: 'chat_alpha',
    visualProfileId: 'vprof_alpha1234',
    profileHash: hashDigest('profile'),
    profileCatalogId: overrides.profileCatalogId || catalog.catalogId,
    profileCatalogRevision: overrides.profileCatalogRevision || catalog.catalogRevision,
    profileCatalogHash: overrides.profileCatalogHash || catalog.catalogHash,
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
    catalogSchemaVersion: catalog.schemaVersion,
    catalogAssetRefs: catalog.assetRefs,
    catalogAssetChannels: catalog.schemaVersion === CATALOG_V2_SCHEMA_VERSION ? catalog.characterChannels : [],
    dictionaryVersion: String(DICTIONARY_VERSION),
    dictionaryHash: DICTIONARY_HASH,
    candidates,
    matcherVersion: 'vs-code-2a',
    scorerVersion: 'vs-code-2a',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...rest,
  };
}

function visualMatchRequest(overrides = {}) {
  return {
    schemaVersion: 'galgame.visual-match-request.v1',
    requestId: 'req_VISUALMATCH00010',
    projectionId: 'vvp_matchroute01',
    entityKey: 'entity_equipment_rustydagger01',
    entityType: 'equipment',
    idempotencyKey: 'idem_ABCDEFGHIJKLMNOP',
    ...overrides,
  };
}

async function visualMatchRequestHttp(baseUrl, { proof, requestBody, origin = ORIGIN } = {}) {
  const response = await fetch(`${baseUrl}/v1/visual-match`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      'x-galgame-visual-projection-proof': base64UrlEncodeCanonical(proof),
    },
    body: JSON.stringify(requestBody),
  });
  return { status: response.status, body: await response.json() };
}

async function visualMatchInternalRequestHttp(baseUrl, {
  proof,
  requestBody,
  token,
  route = '/v1/internal/visual-match',
  headers = {},
} = {}) {
  const requestHeaders = {
    'content-type': 'application/json',
  };
  if (token !== null) requestHeaders.authorization = `Bearer ${token}`;
  if (proof !== null) requestHeaders['x-galgame-visual-projection-proof'] = base64UrlEncodeCanonical(proof);
  Object.assign(requestHeaders, headers);
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
  });
  return { status: response.status, body: await response.json() };
}

async function visualRestoreRequestHttp(baseUrl, { route, token, proofToken, requestBody, origin = null } = {}) {
  const headers = {
    'content-type': 'application/json',
  };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (origin !== null) headers.origin = origin;
  if (proofToken !== null) headers['x-galgame-visual-restore-proof'] = proofToken;
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
  });
  return { status: response.status, body: await response.json() };
}

function visualRestoreBindingRequest({ record, receipt, retention, overrides = {} }) {
  return {
    schemaVersion: 'galgame.visual-restore-binding-request.v1',
    requestId: 'req_VISUALRESTORE0001',
    idempotencyKey: 'idem_RESTOREKEY0000001',
    bindingId: record.bindingId,
    bindingType: record.entityType,
    entityKey: record.entityKey,
    expectedReleaseId: record.releaseId,
    expectedReleaseScopeHash: receipt.releaseScopeHash,
    expectedScenarioId: record.scenarioId,
    expectedScenarioVersion: record.scenarioVersion,
    expectedArcId: record.arcId,
    expectedVisualProfileId: record.visualProfileId,
    expectedVisualProfileHash: record.profileHash,
    expectedCatalogId: record.catalogId,
    expectedCatalogRevision: record.catalogRevision,
    expectedCatalogHash: record.catalogHash,
    expectedDictionaryVersion: record.dictionaryVersion,
    expectedDictionaryHash: record.dictionaryHash,
    expectedAssetId: record.assetId,
    expectedAssetVersion: record.assetVersion,
    expectedAssetContentSha256: `sha256:${record.assetContentSha256}`,
    expectedAssetMetadataHash: record.assetMetadataHash,
    expectedCatalogRefHash: record.catalogRefHash,
    expectedBindingRecordHash: receipt.bindingRecordHash,
    expectedReceiptHash: receipt.receiptHash,
    expectedRetentionId: retention.retentionId,
    expectedRetentionHash: retention.retentionHash,
    ...overrides,
  };
}

function receiptRecordMismatches({ receipt, retention, record }) {
  const expectedReleaseScopeHash = hashDigest(canonicalJson({
    releaseId: record.releaseId,
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    arcId: record.arcId,
    visualProfileId: record.visualProfileId,
    profileHash: record.profileHash,
    catalogId: record.catalogId,
    catalogRevision: record.catalogRevision,
    catalogHash: record.catalogHash,
    dictionaryVersion: record.dictionaryVersion,
    dictionaryHash: record.dictionaryHash,
  }));
  const checks = {
    retentionIncludesBinding: retention.bindingIds.includes(record.bindingId),
    receiptReleaseId: receipt.releaseId === record.releaseId,
    receiptReleaseScopeHash: receipt.releaseScopeHash === expectedReleaseScopeHash,
    receiptScenarioId: receipt.scenarioId === record.scenarioId,
    receiptScenarioVersion: receipt.scenarioVersion === record.scenarioVersion,
    receiptArcId: receipt.arcId === record.arcId,
    receiptProfileId: receipt.visualProfileId === record.visualProfileId,
    receiptProfileHash: receipt.visualProfileHash === record.profileHash,
    receiptCatalogId: receipt.catalogId === record.catalogId,
    receiptCatalogRevision: receipt.catalogRevision === record.catalogRevision,
    receiptCatalogHash: receipt.catalogHash === record.catalogHash,
    receiptDictionaryVersion: receipt.dictionaryVersion === record.dictionaryVersion,
    receiptDictionaryHash: receipt.dictionaryHash === record.dictionaryHash,
    retentionReleaseId: retention.releaseId === record.releaseId,
    retentionReleaseScopeHash: retention.releaseScopeHash === expectedReleaseScopeHash,
    retentionScenarioId: retention.scenarioId === record.scenarioId,
    retentionScenarioVersion: retention.scenarioVersion === record.scenarioVersion,
    retentionArcId: retention.arcId === record.arcId,
    retentionProfileId: retention.visualProfileId === record.visualProfileId,
    retentionProfileHash: retention.visualProfileHash === record.profileHash,
    retentionCatalogId: retention.catalogId === record.catalogId,
    retentionCatalogRevision: retention.catalogRevision === record.catalogRevision,
    retentionCatalogHash: retention.catalogHash === record.catalogHash,
    retentionDictionaryVersion: retention.dictionaryVersion === record.dictionaryVersion,
    retentionDictionaryHash: retention.dictionaryHash === record.dictionaryHash,
    receiptBindingId: receipt.bindingId === record.bindingId,
    receiptEntityKey: receipt.entityKey === record.entityKey,
    receiptAssetType: receipt.assetType === record.entityType,
    receiptBindingPolicy: receipt.bindingPolicy === {
      scene: 'scene-ttl',
      character: 'session-fixed',
      equipment: 'entity-first-seen-fixed',
      item: 'entity-first-seen-fixed',
      skill: 'entity-first-seen-fixed',
    }[record.entityType],
    receiptSourceMessageIndex: receipt.sourceMessageIndex === record.sourceMessageIndex,
    receiptSourceMessageHash: receipt.sourceMessageHash === record.sourceMessageHash,
    receiptEvidenceDigest: receipt.evidenceDigest === record.evidenceDigest,
    receiptProjectionId: receipt.projectionId === record.projectionId,
    receiptProjectionHash: receipt.projectionHash === record.projectionHash,
    receiptAssetId: receipt.assetId === record.assetId,
    receiptAssetVersion: receipt.assetVersion === record.assetVersion,
    receiptAssetContentHash: receipt.assetContentSha256 === `sha256:${record.assetContentSha256}`,
    receiptAssetMetadataHash: receipt.assetMetadataHash === record.assetMetadataHash,
    receiptCatalogRefHash: receipt.catalogRefHash === record.catalogRefHash,
    receiptBindingRecordHash: receipt.bindingRecordHash === hashDigest(canonicalJson(record)),
    receiptExpiresWithinRetention: Date.parse(receipt.expiresAt) <= Date.parse(retention.retentionUntil),
  };
  return Object.entries(checks).filter(([, ok]) => !ok).map(([key]) => key);
}

function visualProjectionStub({ catalog, overrides = {} } = {}) {
  const stub = {
    schemaVersion: 'galgame.visual-projection-stub.v1',
    projectionId: 'vvp_matchroute01',
    projectionHash: hashDigest('projection-match-route'),
    sourceMessageHash: hashDigest('source-message-match-route'),
    releaseId: 'release:visual-match',
    scenarioId: 'scenario:visual-match',
    scenarioVersion: 'v1',
    arcId: 'arc:main',
    chatId: 'chat:visual-match',
    profileId: 'vprof_matcher01',
    profileHash: hashDigest('profile-match-route'),
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
    sourceMessageIndex: 4,
    entities: [{
      entityKey: 'entity_equipment_rustydagger01',
      entityType: 'equipment',
      displayLabel: 'Rusty Dagger',
      visibleAttributes: [
        { code: 'equipment-visible-label', value: 'Rusty Dagger', confidenceBand: 'explicit' },
        { code: 'equipment-visible-trait', value: 'blade', confidenceBand: 'explicit' },
      ],
      confidenceBand: 'explicit',
    }],
    extractorVersion: 'vs-code-p',
    dictionaryVersion: String(DICTIONARY_VERSION),
    dictionaryHash: DICTIONARY_HASH,
    expiresAt: '2099-08-01T00:05:00.000Z',
    ...overrides,
  };
  return stub;
}

function signProjectionProof({ stub, secret, overrides = {} }) {
  const unsigned = {
    schemaVersion: 'galgame.visual-projection-proof.v1',
    audience: 'visual-asset-service',
    purpose: 'visual-match',
    projectionId: stub.projectionId,
    projectionHash: stub.projectionHash,
    sourceMessageHash: stub.sourceMessageHash,
    releaseId: stub.releaseId,
    scenarioId: stub.scenarioId,
    scenarioVersion: stub.scenarioVersion,
    arcId: stub.arcId,
    chatId: stub.chatId,
    profileId: stub.profileId,
    profileHash: stub.profileHash,
    catalogId: stub.catalogId,
    catalogRevision: stub.catalogRevision,
    catalogHash: stub.catalogHash,
    sourceMessageIndex: stub.sourceMessageIndex,
    extractorVersion: stub.extractorVersion,
    dictionaryVersion: stub.dictionaryVersion,
    dictionaryHash: stub.dictionaryHash,
    nonce: 'nonce_VISUALMATCH00010',
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: stub.expiresAt,
    signature: '',
    ...overrides,
  };
  return {
    ...unsigned,
    signature: createHmac('sha256', secret).update(canonicalJson(unsigned)).digest('base64url'),
  };
}

function signRestoreProofToken({ prefix, payload, secret }) {
  const payloadEncoded = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
  const signingInput = `${prefix}.${payloadEncoded}`;
  const signature = createHmac('sha256', secret).update(signingInput, 'ascii').digest('base64url');
  return `${signingInput}.${signature}`;
}

function oldSaveRestoreProofPayload({ record, receipt, keyId, nonce, overrides = {} }) {
  return {
    schemaVersion: 'galgame.visual-old-save-restore-proof.v1',
    purpose: 'old-save-visual-binding-restore',
    audience: 'visual-asset-service',
    issuer: 'game-config-service',
    keyId,
    nonce,
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:02:00.000Z',
    saveId: 'save:visual-restore',
    saveBindingHash: hashDigest('save-binding'),
    saveOwnerHash: hashDigest('save-owner'),
    releaseId: record.releaseId,
    releaseScopeHash: receipt.releaseScopeHash,
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    arcId: record.arcId,
    visualProfileId: record.visualProfileId,
    visualProfileHash: record.profileHash,
    catalogId: record.catalogId,
    catalogRevision: record.catalogRevision,
    catalogHash: record.catalogHash,
    dictionaryVersion: record.dictionaryVersion,
    dictionaryHash: record.dictionaryHash,
    bindingIds: [record.bindingId],
    chatIdHash: receipt.chatIdHash,
    ...overrides,
  };
}

function rollbackRestoreProofPayload({ record, keyId, nonce, overrides = {} }) {
  return {
    schemaVersion: 'galgame.visual-rollback-restore-proof.v1',
    purpose: 'rollback-visual-binding-restore',
    audience: 'visual-asset-service',
    issuer: 'game-config-service',
    keyId,
    nonce,
    issuedAt: '2026-08-01T00:00:00.000Z',
    expiresAt: '2026-08-01T00:02:00.000Z',
    rollbackRequestId: 'rollback_visualrestore01',
    targetReleaseId: record.releaseId,
    targetReleaseHash: hashDigest('target-release'),
    releaseScopeHash: hashDigest(canonicalJson({
      releaseId: record.releaseId,
      scenarioId: record.scenarioId,
      scenarioVersion: record.scenarioVersion,
      arcId: record.arcId,
      visualProfileId: record.visualProfileId,
      profileHash: record.profileHash,
      catalogId: record.catalogId,
      catalogRevision: record.catalogRevision,
      catalogHash: record.catalogHash,
      dictionaryVersion: record.dictionaryVersion,
      dictionaryHash: record.dictionaryHash,
    })),
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    arcId: record.arcId,
    visualProfileId: record.visualProfileId,
    visualProfileHash: record.profileHash,
    catalogId: record.catalogId,
    catalogRevision: record.catalogRevision,
    catalogHash: record.catalogHash,
    dictionaryVersion: record.dictionaryVersion,
    dictionaryHash: record.dictionaryHash,
    publishedAt: '2026-08-01T00:00:00.000Z',
    rolledBackAt: '2026-08-01T00:01:00.000Z',
    ...overrides,
  };
}

function clonePublishedAssetStore({ asset, catalog }) {
  const store = new MemoryVisualAssetStore();
  for (const unknown of Object.values(BUILTIN_UNKNOWN_ASSETS)) {
    store.assets.set(store.key(unknown.assetId, unknown.assetVersion), structuredClone(unknown));
  }
  store.assets.set(store.key(asset.assetId, asset.assetVersion), structuredClone(asset));
  store.catalogs.set(store.catalogKey(catalog.catalogId, catalog.catalogRevision), structuredClone(catalog));
  store.activeCatalogs.set(catalog.catalogId, {
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
  });
  return store;
}

function createCandidateCatalog(assets) {
  const catalog = {
    schemaVersion: CATALOG_V2_SCHEMA_VERSION,
    catalogId: 'vc_catalog1234',
    catalogRevision: 1,
    status: 'published',
    assetRefs: assets.map(assetToCandidateCatalogRef),
    characterChannels: assets
      .filter((asset) => asset.assetType === 'character')
      .map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion, channel: 'character' })),
    unknownAssetRefs: Object.values(BUILTIN_UNKNOWN_ASSETS).map(assetToCandidateCatalogRef),
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    publishedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
  };
  catalog.catalogHash = computeCatalogHash(catalog);
  return catalog;
}

function createCorePublishedCatalog(assets, overrides = {}) {
  const catalog = {
    schemaVersion: CATALOG_V2_SCHEMA_VERSION,
    catalogId: 'catalog_core_match',
    catalogRevision: 1,
    status: 'published',
    assetRefs: assets.map(assetToCoreCatalogRef),
    characterChannels: assets
      .filter((asset) => asset.assetType === 'character')
      .map((asset) => ({ assetId: asset.assetId, assetVersion: asset.assetVersion, channel: 'character' })),
    unknownAssetRefs: Object.values(BUILTIN_UNKNOWN_ASSETS).map(assetToCoreCatalogRef),
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    publishedAt: '2026-08-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
  catalog.catalogHash = computeCatalogHash(catalog);
  return catalog;
}

function assetToCoreCatalogRef(asset) {
  return {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetType: asset.assetType,
    assetContentSha256: asset.assetContentSha256,
    assetMetadataHash: asset.assetMetadataHash,
  };
}

function assetToCandidateCatalogRef(asset) {
  const ref = {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetType: asset.assetType,
    assetContentSha256: asset.assetContentSha256,
    assetMetadataHash: asset.assetMetadataHash,
  };
  ref.catalogRefHash = hashDigest(canonicalJson(ref));
  return ref;
}

function coreDecisionPlanRequest(overrides = {}) {
  const catalog = overrides.catalog || createCorePublishedCatalog([]);
  const projection = overrides.projection || coreProjection();
  const visualProfile = overrides.visualProfile || {
    visualProfileId: 'vprof_core1234',
    profileHash: hashDigest('core-profile'),
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
  };
  return {
    schemaVersion: VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION,
    requestId: 'req_COREMATCH0000001',
    projection,
    visualProfile,
    catalog,
    assets: overrides.assets || [],
    expectedProjectionHash: overrides.expectedProjectionHash || projection.projectionHash,
    expectedSourceMessageHash: overrides.expectedSourceMessageHash || projection.sourceMessageHash,
    createdAt: overrides.createdAt || '2026-08-01T00:00:00.000Z',
  };
}

function coreCandidateDecisionInputForLegacyValidator({ assets, catalog, entity }) {
  const projection = coreProjection({ entities: [entity] });
  return {
    schemaVersion: CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
    requestId: 'req_CORELEGACY0001',
    projectionId: projection.projectionId,
    entityKey: entity.entityKey,
    entityType: entity.entityType,
    confidenceBand: entity.confidenceBand,
    visibleAttributeCodes: entity.visibleAttributes.map((attribute) => attribute.code),
    sourceMessageIndex: projection.sourceMessageIndex,
    sourceMessageHash: projection.sourceMessageHash,
    evidenceDigest: projection.projectionHash,
    releaseId: projection.releaseId,
    scenarioId: projection.scenarioId,
    scenarioVersion: projection.scenarioVersion,
    arcId: projection.arcId,
    chatId: projection.chatId,
    visualProfileId: 'vprof_core1234',
    profileHash: hashDigest('core-profile'),
    profileCatalogId: catalog.catalogId,
    profileCatalogRevision: catalog.catalogRevision,
    profileCatalogHash: catalog.catalogHash,
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
    catalogSchemaVersion: catalog.schemaVersion,
    catalogAssetRefs: [...catalog.assetRefs, ...catalog.unknownAssetRefs].map((ref) => ({
      ...ref,
      catalogRefHash: hashDigest(canonicalJson(ref)),
    })),
    catalogAssetChannels: catalog.schemaVersion === CATALOG_V2_SCHEMA_VERSION ? catalog.characterChannels : [],
    dictionaryVersion: String(DICTIONARY_VERSION),
    dictionaryHash: DICTIONARY_HASH,
    candidates: assets
      .filter((asset) => asset.assetType === entity.entityType)
      .map(createVisualCandidateAssetInputFromAsset),
    matcherVersion: 'galgame.visual-matcher.v1',
    scorerVersion: 'galgame.visual-scorer.v1',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function coreProjection(overrides = {}) {
  const projection = {
    projectionId: 'vvp_corematch001',
    projectionHash: hashDigest('core-projection'),
    sourceMessageIndex: 7,
    sourceMessageHash: hashDigest('core-visible-source'),
    releaseId: 'release_core',
    scenarioId: 'scenario_core',
    scenarioVersion: 'v1',
    arcId: 'arc_core',
    chatId: 'chat_core',
    entities: [
      coreEntity('scene', { entityKey: 'entity_scene_forest001' }),
      coreEntity('character', { entityKey: 'entity_character_knight001' }),
      coreEntity('equipment', { entityKey: 'entity_equipment_sword001' }),
      coreEntity('item', { entityKey: 'entity_item_key00001' }),
      coreEntity('skill', { entityKey: 'entity_skill_spell001' }),
    ],
    ...overrides,
  };
  return projection;
}

function coreEntity(type, overrides = {}) {
  const defaults = {
    scene: {
      entityKey: 'entity_scene_forest001',
      displayLabel: 'Forest',
      visibleAttributes: [{ code: 'scene-location-kind', value: 'forest', confidenceBand: 'explicit' }],
    },
    character: {
      entityKey: 'entity_character_knight001',
      displayLabel: 'Knight',
      visibleAttributes: [
        { code: 'character-explicit-name', value: 'Knight', confidenceBand: 'explicit' },
        { code: 'character-explicit-appearance', value: 'armored knight', confidenceBand: 'explicit' },
      ],
    },
    equipment: {
      entityKey: 'entity_equipment_sword001',
      displayLabel: 'Sword',
      visibleAttributes: [
        { code: 'equipment-visible-label', value: 'Sword', confidenceBand: 'explicit' },
        { code: 'equipment-visible-trait', value: 'blade', confidenceBand: 'explicit' },
      ],
    },
    item: {
      entityKey: 'entity_item_key00001',
      displayLabel: 'Key',
      visibleAttributes: [
        { code: 'item-visible-label', value: 'Key', confidenceBand: 'explicit' },
        { code: 'item-visible-trait', value: 'small key', confidenceBand: 'explicit' },
      ],
    },
    skill: {
      entityKey: 'entity_skill_spell001',
      displayLabel: 'Spell',
      visibleAttributes: [
        { code: 'skill-visible-label', value: 'Spell', confidenceBand: 'explicit' },
        { code: 'skill-visible-trait', value: 'magic', confidenceBand: 'explicit' },
      ],
    },
  }[type];
  return {
    entityKey: defaults.entityKey,
    entityType: type,
    displayLabel: defaults.displayLabel,
    visibleAttributes: defaults.visibleAttributes,
    confidenceBand: 'explicit',
    ...overrides,
  };
}

function createLegacyPlaceholderSharedUnknowns() {
  const hashes = {
    scene: '1'.repeat(64),
    character: '2'.repeat(64),
    equipment: '3'.repeat(64),
    item: '4'.repeat(64),
    skill: '5'.repeat(64),
  };
  return Object.fromEntries(Object.keys(hashes).map((type) => [type, {
    assetId: `unknown_${type}`,
    assetVersion: 1,
    assetContentSha256: hashes[type],
    type,
  }]));
}

function makeValidatedAssetRecord(overrides = {}) {
  const assetType = overrides.assetType || 'equipment';
  const role = overrides.role || (assetType === 'character' ? 'transparent-sprite' : assetType === 'scene' ? 'background' : 'icon');
  const asset = {
    schemaVersion: 'galgame.visual-asset.v1',
    assetId: overrides.assetId || 'equipment_test_asset',
    assetVersion: overrides.assetVersion || 1,
    assetType,
    role,
    title: overrides.title || 'Decision Asset',
    tagCodes: overrides.tagCodes || ['equipment.weapon'],
    featureCodes: overrides.featureCodes || ['feature.icon'],
    licenseCode: 'cc0',
    sourceLabel: '',
    canonicalMime: PNG_MIME,
    width: overrides.width || (assetType === 'scene' ? 640 : assetType === 'character' ? 1024 : 1),
    height: overrides.height || (assetType === 'scene' ? 360 : assetType === 'character' ? 1536 : 1),
    hasAlpha: true,
    transparentPixel: true,
    assetContentSha256: overrides.assetContentSha256 || BUILTIN_UNKNOWN_ASSETS.equipment.assetContentSha256,
    contentUri: `/v1/admin/assets/${overrides.assetId || 'equipment_test_asset'}/${overrides.assetVersion || 1}/content`,
    thumbnailUri: `/v1/admin/assets/${overrides.assetId || 'equipment_test_asset'}/${overrides.assetVersion || 1}/content`,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    analysisStatus: overrides.analysisStatus || overrides.analysis?.status || 'ready',
    analysis: overrides.analysis || {
      schemaVersion: 'galgame.visual-asset-analysis.v2',
      status: 'ready',
      description: 'Test asset analysis',
      tagCodes: overrides.tagCodes || [assetType === 'scene' ? 'scene.forest' : assetType === 'character' ? 'character.human' : assetType === 'equipment' ? 'equipment.weapon' : assetType === 'item' ? 'item.key' : 'skill.magic'],
      attributeCodes: overrides.featureCodes || [assetType === 'scene' ? 'feature.dark' : assetType === 'character' ? 'feature.transparent' : 'feature.icon'],
      confidence: 0.8,
      analyzerVersion: 'test-unconfigured-v1',
      errorCode: null,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
    },
    status: 'published',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
  asset.assetMetadataHash = computeAssetMetadataHash(asset);
  return asset;
}

function hashDigest(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

function makePng({ width = 1, height = 1, colorType = 2, rgb = [10, 20, 30], alpha = 255, extraChunks = [], corruptIdat = false, noise = false } = {}) {
  const channels = colorType === 6 ? 4 : 3;
  const rowBytes = width * channels;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    scanlines[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * channels;
      let variation = 0;
      if (noise) {
        let mixed = Math.imul(x + 1, 0x45d9f3b) ^ Math.imul(y + 1, 0x119de1f3);
        mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
        variation = (mixed ^ (mixed >>> 16)) & 0xff;
      }
      scanlines[p] = (rgb[0] + variation) & 0xff;
      scanlines[p + 1] = (rgb[1] + (noise ? (variation * 3) % 251 : 0)) & 0xff;
      scanlines[p + 2] = (rgb[2] + (noise ? (variation * 7) % 251 : 0)) & 0xff;
      if (channels === 4) scanlines[p + 3] = alpha;
    }
  }
  const encoded = encodePng({
    width,
    height,
    bitDepth: 8,
    colorType,
    compression: 0,
    filter: 0,
    interlace: 0,
  }, scanlines);
  if (!extraChunks.length && !corruptIdat) return encoded;
  return rebuildPngWithOptions(encoded, { extraChunks, corruptIdat });
}

function makeTinyIdatHugeIhdrPng({ width, height, colorType }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(Buffer.from([0, 0, 0, 0]));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', idat),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function writeBrokenContentRecord(root, { missing, extra = false }) {
  const bytes = makePng({ colorType: 2 });
  const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const recordDir = path.join(root, 'content', 'records', hash.slice('sha256:'.length));
  mkdirSync(recordDir, { recursive: true });
  if (missing !== 'bytes') writeFileSync(path.join(recordDir, 'bytes.bin'), bytes);
  if (missing !== 'meta') {
    writeFileSync(path.join(recordDir, 'record.json'), JSON.stringify({
      schemaVersion: 'galgame.visual-asset-content-store-record.v1',
      hash,
      mime: PNG_MIME,
      size: bytes.length,
    }));
  }
  if (extra) writeFileSync(path.join(recordDir, 'extra.tmp'), 'orphan');
}

function rebuildPngWithOptions(encoded, { extraChunks, corruptIdat }) {
  const signature = encoded.subarray(0, 8);
  let offset = 8;
  const chunks = [];
  while (offset < encoded.length) {
    const length = encoded.readUInt32BE(offset);
    const type = encoded.toString('latin1', offset + 4, offset + 8);
    const data = Buffer.from(encoded.subarray(offset + 8, offset + 8 + length));
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const output = [signature];
  for (const chunk of chunks) {
    if (chunk.type === 'IDAT' && corruptIdat) {
      const bad = Buffer.from(chunk.data);
      bad[0] = bad[0] ^ 0xff;
      output.push(createPngChunk(chunk.type, bad));
    } else if (chunk.type === 'IEND') {
      for (const extra of extraChunks) output.push(createPngChunk(extra.type, extra.data));
      output.push(createPngChunk(chunk.type, chunk.data));
    } else {
      output.push(createPngChunk(chunk.type, chunk.data));
    }
  }
  return Buffer.concat(output);
}

async function internalAssetJson(baseUrl, pathname, token, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function internalAssetBytes(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/v1/internal/assets/content-read`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'image/png,application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer()) };
}

function hashJson(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function testOpenAiChatCompletionsVisionAdapter() {
  const analyzerToken = 'openai-vision-fixture-token';
  const analyzerModel = 'doubao-vision-fixture-v1';
  const observed = [];
  await withRawServer(async (req, res) => {
    const body = JSON.parse(await collectRequestText(req));
    observed.push({ method: req.method, url: req.url, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-fixture',
      object: 'chat.completion',
      created: 1,
      model: analyzerModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({
            description: 'A human character portrait',
            tagCodes: ['character.human'],
            attributeCodes: ['feature.portrait'],
            confidence: 0.95,
            analyzerVersion: 'openai-fixture-v1',
          }),
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  }, async (providerUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      adminOrigins: [ORIGIN],
      analyzerBaseUrl: `${providerUrl}/v1`,
      analyzerToken,
      analyzerModel,
      analyzerRequestStyle: 'openai_chat_completions_vision',
      analyzerCacheScope: 'openai-vision-fixture-v1',
    });
    await withServer(service, async (baseUrl) => {
      const response = await upload(baseUrl, metadata({
        assetId: 'character_openai_fixture',
        assetType: 'character',
        role: 'transparent-sprite',
        title: 'OpenAI vision fixture',
        tagCodes: [],
        featureCodes: ['feature.transparent'],
      }), makePng({ colorType: 6, rgb: [101, 102, 103], alpha: 0 }));
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.asset.analysis.status, 'ready');
      assert.equal(response.body.asset.analysis.tagCodes[0], 'character.human');
      assert.equal(response.body.asset.analysis.attributeCodes[0], 'feature.portrait');
    });
  });
  assert.equal(observed.length, 1);
  const call = observed[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, '/v1/chat/completions');
  assert.equal(call.headers.authorization, `Bearer ${analyzerToken}`);
  assert.deepEqual(Object.keys(call.body).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'temperature']);
  assert.equal(call.body.model, analyzerModel);
  assert.equal(call.body.response_format.type, 'json_object');
  assert.equal(call.body.messages.length, 2);
  assert.equal(call.body.messages[1].content[1].type, 'image_url');
  assert.equal(JSON.stringify(call.body).includes(analyzerToken), false);
}

async function testOpenAiChatCompletionsTextAdapter() {
  const runtimeToken = 'openai-runtime-fixture-token';
  const runtimeModel = 'doubao-runtime-fixture-v1';
  const visualControlStore = new MemoryVisualControlStore();
  const uploadService = createVisualAssetService({
    adminToken: ADMIN_TOKEN,
    adminOrigins: [ORIGIN],
    visualControlStore,
    visualAnalyzer: async () => ({
      description: 'forest runtime fixture',
      tagCodes: ['scene.forest'],
      attributeCodes: ['feature.dark'],
      confidence: 0.95,
      analyzerVersion: 'openai-runtime-fixture-v1',
    }),
  });
  const { assetStore, contentStore } = uploadService.stores;
  let catalog;
  await withServer(uploadService, async (baseUrl) => {
    const uploaded = await upload(baseUrl, metadata({
      assetId: 'asset_scene_runtime_openai',
      assetType: 'scene',
      role: 'background',
      title: 'OpenAI runtime scene',
      tagCodes: [],
      featureCodes: [],
    }), makePng({ width: 640, height: 360, colorType: 2, rgb: [21, 22, 23], noise: true }));
    assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
    catalog = await publishCatalog(baseUrl, 'catalog_runtime_openai', 1, [{
      assetId: uploaded.body.asset.assetId,
      assetVersion: uploaded.body.asset.assetVersion,
    }]);
  });
  await visualControlStore.setControl({
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: true,
    activeCatalog: { catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash },
    updatedAt: '2026-09-06T00:00:00.000Z',
  });
  const current = { index: 7, role: 'character', speaker: 'Guide', text: 'The forest is quiet.' };
  const currentHash = hashDigest(canonicalJson(current));
  const projection = coreProjection({ sourceMessageIndex: current.index, sourceMessageHash: currentHash, entities: [coreEntity('scene', { visibleAttributes: [] })] });
  const body = {
    schemaVersion: VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
    requestId: 'req_RUNTIME_OPENAI_0001',
    projection,
    visibleContext: { current, recent: [{ index: 6, role: 'character', speaker: 'Guide', text: 'The path leads into the woods.' }] },
    visualProfile: createGlobalDisplayVisualProfile({ catalogId: catalog.catalogId, catalogRevision: catalog.catalogRevision, catalogHash: catalog.catalogHash }),
    expectedProjectionHash: projection.projectionHash,
    expectedSourceMessageHash: currentHash,
    createdAt: '2026-09-06T00:00:00.000Z',
  };
  const validHint = {
    schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
    status: 'ready',
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    entities: [{ entityType: 'scene', codes: ['scene.forest'], confidence: 0.95, confidenceBand: 'explicit' }],
  };
  const observed = [];
  await withRawServer(async (req, res) => {
    observed.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(await collectRequestText(req)) });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      id: 'chatcmpl-runtime-fixture',
      object: 'chat.completion',
      created: 1,
      model: runtimeModel,
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(validHint) }, finish_reason: 'stop' }],
    }));
  }, async (providerUrl) => {
    const service = createVisualAssetService({
      adminToken: ADMIN_TOKEN,
      visualControlStore,
      assetStore,
      contentStore,
      runtimeBaseUrl: `${providerUrl}/v1`,
      runtimeToken,
      runtimeModel,
      runtimeRequestStyle: 'openai_chat_completions_text',
    });
    await withServer(service, async (baseUrl) => {
      const response = await request(baseUrl, 'POST', '/v1/core/visual-decisions', { token: null, origin: CORE_DEFAULT_ORIGIN, body });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body.understandingStatus, 'ready');
      assert.equal(response.body.errorCode, null);
      assert.equal(response.body.usesLlm, true);
      assert.equal(response.body.decisions.length, 1);
      assert.equal(response.body.decisions[0].assetId, 'asset_scene_runtime_openai');
      assert.ok(response.body.decisions[0].score >= 60, JSON.stringify(response.body.decisions[0]));
    });
  });
  assert.equal(observed.length, 1);
  const call = observed[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, '/v1/chat/completions');
  assert.equal(call.headers.authorization, `Bearer ${runtimeToken}`);
  assert.equal(call.headers['x-api-key'], undefined);
  assert.deepEqual(Object.keys(call.body).sort(), ['max_tokens', 'messages', 'model', 'response_format', 'temperature']);
  assert.equal(call.body.model, runtimeModel);
  assert.equal(call.body.response_format.type, 'json_object');
  assert.equal(call.body.messages[0].role, 'system');
  assert.equal(call.body.messages[0].content, VISUAL_RUNTIME_FIXED_INSTRUCTION);
  assert.equal(call.body.messages[1].role, 'user');
  assert.equal(call.body.messages[1].content.includes('The forest is quiet.'), true);
  assert.equal(JSON.stringify(call.body).includes(runtimeToken), false);
}
