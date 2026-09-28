import http from 'node:http';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { link, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import {
  IMMUTABLE_UNKNOWN_VISUAL_ASSETS as SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS,
  VISUAL_ATTRIBUTE_CODES,
  VISUAL_BINDABLE_TYPES,
  VISUAL_CONFIDENCE_BANDS,
  VISUAL_REASON_CODES,
  VISUAL_SCORE_BANDS,
  normalizeVisualRuntimeMessage,
  applyVisualScorePolicy,
  validateVisualBinding,
  validateVisualMatchResult,
  validateVisualProjectionProofShape,
  validateVisualProjectionStub,
} from '../../frontend/shared/src/visual-system-schema.js';

const SERVICE_NAME = 'galgame-visual-asset-service';
const HEALTH_SCHEMA_VERSION = 'galgame.visual-asset-health.v1';
const UPLOAD_SCHEMA_VERSION = 'galgame.visual-asset-upload-request.v1';
const SIMPLE_UPLOAD_SCHEMA_VERSION = 'galgame.visual-simple-upload-request.v1';
const SIMPLE_UPLOAD_RESPONSE_SCHEMA_VERSION = 'galgame.visual-simple-upload-response.v1';
const SIMPLE_PUBLISH_RESPONSE_SCHEMA_VERSION = 'galgame.visual-simple-publish-response.v1';
const VISUAL_ANALYSIS_SCHEMA_VERSION = 'galgame.visual-asset-analysis.v2';
const LEGACY_VISUAL_ANALYSIS_SCHEMA_VERSION = 'galgame.visual-asset-analysis.v1';
const CATALOG_DRAFT_SCHEMA_VERSION = 'galgame.visual-catalog-draft-request.v1';
const ASSET_SCHEMA_VERSION = 'galgame.visual-asset.v1';
const CATALOG_SCHEMA_VERSION = 'galgame.visual-asset-catalog.v1';
const CANDIDATE_DECISION_INPUT_SCHEMA_VERSION = 'galgame.visual-candidate-decision-input.v1';
const CANDIDATE_DECISION_SCHEMA_VERSION = 'galgame.visual-candidate-decision.v1';
const VISUAL_MATCH_REQUEST_SCHEMA_VERSION = 'galgame.visual-match-request.v1';
const VISUAL_BINDING_STORE_RECORD_SCHEMA_VERSION = 'galgame.visual-binding-store-record.v1';
const VISUAL_RESTORE_BINDING_REQUEST_SCHEMA_VERSION = 'galgame.visual-restore-binding-request.v1';
const VISUAL_BINDING_RECEIPT_SCHEMA_VERSION = 'galgame.visual-binding-receipt.v1';
const VISUAL_BINDING_RETENTION_SCHEMA_VERSION = 'galgame.visual-binding-retention.v1';
const VISUAL_RESTORE_REPLAY_RECORD_SCHEMA_VERSION = 'galgame.visual-restore-replay-record.v1';
const UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION = 'galgame.visual-unknown-compatibility-report.v1';
const ASSET_STORE_SCHEMA_VERSION = 'galgame.visual-asset-store-record.v1';
const CATALOG_STORE_SCHEMA_VERSION = 'galgame.visual-catalog-store-record.v1';
const RUNTIME_MIGRATION_BATCH_SCHEMA_VERSION = 'galgame.visual-runtime-v2-migration-batch.v1';
const RUNTIME_MIGRATION_POINTER_SCHEMA_VERSION = 'galgame.visual-runtime-v2-active-pointer.v1';
const VISUAL_CONTROL_SCHEMA_VERSION = 'galgame.visual-control.v1';
const ANALYSIS_CACHE_RECORD_SCHEMA_VERSION = 'galgame.visual-asset-analysis-cache-record.v1';
const DEFAULT_ANALYZER_CACHE_SCOPE = 'independent-analyzer-v1';
const UNKNOWN_CATALOG_ID = 'galgame_builtin_unknown_assets';
const UNKNOWN_CATALOG_REVISION = 1;
const DICTIONARY_VERSION = 2;
const PNG_MIME = 'image/png';
const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_DECODED_PIXELS = 24_000_000;
const MAX_SCENE_DIMENSION = 8192;
const MAX_SPRITE_ICON_DIMENSION = 4096;
const MAX_COMPRESSION_RATIO = 80;
const DEFAULT_PORT = 8798;
const DEFAULT_TTL_MS = 300_000;
const DEFAULT_ANALYZER_TIMEOUT_MS = 8_000;
const DEFAULT_ANALYZER_REQUEST_STYLE = 'closed-json-http-v1';
const ANALYZER_OPENAI_CHAT_COMPLETIONS_REQUEST_STYLE = 'openai_chat_completions_vision';
const ANALYZER_REQUEST_STYLE_SET = new Set([
  DEFAULT_ANALYZER_REQUEST_STYLE,
  'anthropic_messages_vision',
  ANALYZER_OPENAI_CHAT_COMPLETIONS_REQUEST_STYLE,
]);
const ANALYZER_MAX_TOKENS = 512;
const ANALYZER_OPENAI_MAX_TOKENS = 4096;
const MAX_ANALYZER_DESCRIPTION_LENGTH = 240;
const MAX_ANALYZER_CODES = 16;
const MAX_ANALYZER_RESPONSE_BYTES = 64 * 1024;
const LOCAL_ADMIN_SESSION_COOKIE = 'galgame_visual_admin_session';
const LOCAL_ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const LOCAL_ADMIN_CSRF_HEADER = 'x-galgame-csrf-token';
const LOCAL_ADMIN_STATIC_PREFIX = '/game-admin';
const LOCAL_ADMIN_API_PREFIX = '/v1/local-admin/visual';

const ENTITY_TYPES = Object.freeze(['scene', 'character', 'equipment', 'item', 'skill']);
const ENTITY_TYPE_SET = new Set(ENTITY_TYPES);
const SHARED_BINDABLE_TYPE_SET = new Set(VISUAL_BINDABLE_TYPES);
const SHARED_CONFIDENCE_BAND_SET = new Set(VISUAL_CONFIDENCE_BANDS);
const SHARED_REASON_CODE_SET = new Set(VISUAL_REASON_CODES);
const SHARED_ATTRIBUTE_CODE_SET = new Set(VISUAL_ATTRIBUTE_CODES);
const SHARED_SCORE_BAND_SET = new Set(VISUAL_SCORE_BANDS);
const ROLE_BY_TYPE = Object.freeze({
  scene: 'background',
  character: 'transparent-sprite',
  equipment: 'icon',
  item: 'icon',
  skill: 'icon',
});
const ROLE_SET = new Set(Object.values(ROLE_BY_TYPE));
const LICENSE_CODES = Object.freeze(['user-owned', 'public-domain', 'cc0', 'licensed-private', 'unknown-restricted']);
const LICENSE_CODE_SET = new Set(LICENSE_CODES);
const TAG_DICTIONARY = Object.freeze({
  scene: ['scene.interior', 'scene.exterior', 'scene.ruins', 'scene.forest', 'scene.city', 'scene.dungeon', 'scene.night', 'scene.day'],
  character: ['character.humanoid', 'character.elf', 'character.dwarf', 'character.human', 'character.rogue', 'character.mage', 'character.armored'],
  equipment: ['equipment.weapon', 'equipment.armor', 'equipment.melee', 'equipment.ranged', 'equipment.magical', 'equipment.common'],
  item: ['item.consumable', 'item.quest', 'item.key', 'item.treasure', 'item.tool', 'item.misc'],
  skill: ['skill.magic', 'skill.stealth', 'skill.social', 'skill.combat', 'skill.crafting', 'skill.survival', 'skill.fire', 'skill.fireball', 'skill.shadow', 'skill.protective-ward', 'skill.ward'],
});
const FEATURE_DICTIONARY = Object.freeze({
  scene: ['feature.wooden', 'feature.stone', 'feature.dark', 'feature.warm', 'feature.abandoned', 'feature.crowded'],
  character: ['feature.transparent', 'feature.full-body', 'feature.neutral-pose', 'feature.portrait'],
  equipment: ['feature.icon', 'feature.metal', 'feature.blade', 'feature.leather', 'feature.ranged'],
  item: ['feature.icon', 'feature.small-object', 'feature.container', 'feature.symbol'],
  skill: ['feature.icon', 'feature.arcane', 'feature.physical', 'feature.passive', 'feature.active'],
});
const ALL_DICTIONARY_CODES = new Set([
  ...Object.values(TAG_DICTIONARY).flat(),
  ...Object.values(FEATURE_DICTIONARY).flat(),
]);
const ANALYSIS_STATUS_SET = new Set(['unavailable', 'failed', 'ready']);
const ANALYSIS_ERROR_CODE_SET = new Set([
  'ANALYZER_NOT_CONFIGURED',
  'ANALYZER_TIMEOUT',
  'ANALYZER_NETWORK_ERROR',
  'ANALYZER_HTTP_ERROR',
  'ANALYZER_AUTH_ERROR',
  'ANALYZER_REQUEST_INVALID',
  'ANALYZER_RATE_LIMITED',
  'ANALYZER_UPSTREAM_ERROR',
  'ANALYZER_ENVELOPE_INVALID',
  'ANALYZER_CONTENT_INVALID',
  'ANALYZER_OUTPUT_INVALID',
  'ANALYZER_OUTPUT_UNKNOWN_FIELD',
  'ANALYZER_OUTPUT_MISSING_FIELD',
  'ANALYZER_OUTPUT_VALUE_INVALID',
  'ANALYZER_OUTPUT_CODE_INVALID',
  'ANALYZER_OUTPUT_DESCRIPTION_INVALID',
  'ANALYZER_OUTPUT_CODES_INVALID',
  'ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID',
  'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID',
  'ANALYZER_OUTPUT_CONFIDENCE_INVALID',
  'ANALYZER_OUTPUT_VERSION_INVALID',
  'ANALYZER_OUTPUT_DUPLICATE_CODES',
  'ANALYZER_OUTPUT_DUPLICATE_FIELD',
  'ANALYZER_INVALID_JSON',
  'ANALYZER_SCHEMA_INVALID',
  'ANALYZER_FORBIDDEN_FIELD',
  'ANALYZER_UNKNOWN_CODE',
  'ANALYZER_CACHE_WRITE_FAILED',
  'ANALYZER_RESPONSE_TOO_LARGE',
]);

function analyzerHttpErrorCode(status) {
  if (status === 401 || status === 403) return 'ANALYZER_AUTH_ERROR';
  if (status === 400 || status === 404 || status === 422) return 'ANALYZER_REQUEST_INVALID';
  if (status === 429) return 'ANALYZER_RATE_LIMITED';
  if (status >= 500 && status <= 599) return 'ANALYZER_UPSTREAM_ERROR';
  return 'ANALYZER_HTTP_ERROR';
}
const DICTIONARY_HASH = `sha256:${sha256Hex(Buffer.from(canonicalJson({
  version: DICTIONARY_VERSION,
  tags: TAG_DICTIONARY,
  features: FEATURE_DICTIONARY,
}), 'utf8'))}`;
const LEGACY_DICTIONARY_VERSION = 1;
const LEGACY_TAG_DICTIONARY = Object.freeze({
  ...TAG_DICTIONARY,
  skill: TAG_DICTIONARY.skill.slice(0, 6),
});
const LEGACY_DICTIONARY_HASH = `sha256:${sha256Hex(Buffer.from(canonicalJson({
  version: LEGACY_DICTIONARY_VERSION,
  tags: LEGACY_TAG_DICTIONARY,
  features: FEATURE_DICTIONARY,
}), 'utf8'))}`;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'iCCP', 'sRGB', 'gAMA', 'cHRM', 'pHYs', 'tIME', 'sBIT', 'bKGD', 'hIST']);
const PNG_ANIMATION_CHUNKS = new Set(['acTL', 'fcTL', 'fdAT']);
const PNG_CRC_TABLE = makeCrcTable();
const FIXED_TIME = '1970-01-01T00:00:00.000Z';
const TRANSPARENT_PNG_BYTES = createTransparentPngBytes();
const TRANSPARENT_PNG_HASH = `sha256:${sha256Hex(TRANSPARENT_PNG_BYTES)}`;
const CANDIDATE_DECISION_INPUT_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'projectionId',
  'entityKey',
  'entityType',
  'confidenceBand',
  'visibleAttributeCodes',
  'sourceMessageIndex',
  'sourceMessageHash',
  'evidenceDigest',
  'releaseId',
  'scenarioId',
  'scenarioVersion',
  'arcId',
  'chatId',
  'visualProfileId',
  'profileHash',
  'profileCatalogId',
  'profileCatalogRevision',
  'profileCatalogHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'catalogAssetRefs',
  'dictionaryVersion',
  'dictionaryHash',
  'candidates',
  'matcherVersion',
  'scorerVersion',
  'createdAt',
]);
const CANDIDATE_ASSET_INPUT_KEYS = Object.freeze([
  'assetId',
  'assetVersion',
  'assetType',
  'role',
  'canonicalMime',
  'assetContentSha256',
  'assetMetadataHash',
  'catalogRefHash',
  'tagCodes',
  'negativeTagCodes',
  'locale',
]);
const CORE_CANDIDATE_ASSET_INPUT_KEYS = Object.freeze([
  ...CANDIDATE_ASSET_INPUT_KEYS,
  'analysisStatus',
  'analysisTagCodes',
  'analysisAttributeCodes',
  'analysisConfidence',
]);
const CANDIDATE_CATALOG_REF_INPUT_KEYS = Object.freeze([
  'assetId',
  'assetVersion',
  'assetType',
  'assetContentSha256',
  'assetMetadataHash',
  'catalogRefHash',
]);
const CANDIDATE_DECISION_KEYS = Object.freeze([
  'schemaVersion',
  'decisionId',
  'entityKey',
  'entityType',
  'projectionId',
  'sourceMessageIndex',
  'sourceMessageHash',
  'evidenceDigest',
  'visualProfileId',
  'profileHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'dictionaryVersion',
  'dictionaryHash',
  'assetId',
  'assetVersion',
  'assetContentSha256',
  'assetMetadataHash',
  'score',
  'scoreBand',
  'reasonCodes',
  'matcherVersion',
  'scorerVersion',
  'usesLlm',
  'createdAt',
  'expiresAt',
]);
const UNKNOWN_COMPATIBILITY_REPORT_KEYS = Object.freeze([
  'schemaVersion',
  'reportId',
  'status',
  'generatedAt',
  'sharedSchemaVersion',
  'visualAssetServiceVersion',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'entries',
]);
const UNKNOWN_COMPATIBILITY_ENTRY_KEYS = Object.freeze([
  'type',
  'sharedAssetId',
  'sharedAssetVersion',
  'sharedAssetContentSha256',
  'serviceAssetId',
  'serviceAssetVersion',
  'serviceAssetContentSha256',
  'serviceAssetMetadataHash',
  'catalogRefHash',
  'servedBytesSha256',
  'compatible',
  'mismatchCodes',
]);
const UNKNOWN_COMPATIBILITY_MISMATCH_CODES = Object.freeze([
  'asset-id-mismatch',
  'asset-version-mismatch',
  'content-hash-mismatch',
  'served-hash-mismatch',
  'metadata-hash-mismatch',
  'catalog-ref-mismatch',
  'missing-service-unknown',
  'type-mismatch',
]);
const UNKNOWN_COMPATIBILITY_MISMATCH_SET = new Set(UNKNOWN_COMPATIBILITY_MISMATCH_CODES);
const CANDIDATE_REQUEST_ID_PATTERN = /^req_[A-Za-z0-9._:-]{16,120}$/;
const CANDIDATE_DECISION_ID_PATTERN = /^vcd_[a-z0-9_-]{12,80}$/;
const UNKNOWN_COMPATIBILITY_REPORT_ID_PATTERN = /^vuc_[a-z0-9_-]{12,80}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const SHARED_ASSET_ID_PATTERN = /^(unknown_(scene|character|equipment|item|skill)|asset_[a-z0-9_-]{8,80})$/;
const ZERO_SHA256_HEX = '0'.repeat(64);
const ZERO_SHA256_DIGEST = `sha256:${ZERO_SHA256_HEX}`;
const ISO_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/;
const CANDIDATE_DECISION_MAX_INPUT_BYTES = 64 * 1024;
const CANDIDATE_DECISION_MAX_OUTPUT_BYTES = 32 * 1024;
const UNKNOWN_COMPATIBILITY_REPORT_MAX_BYTES = 16 * 1024;
const VISUAL_ASSET_SERVICE_VERSION = 'galgame.visual-asset-service.vs-code-2a';
const VISUAL_MATCHER_VERSION = 'vs-code-2b-r';
const VISUAL_SCORER_VERSION = 'vs-code-2a';
const VISUAL_RUNTIME_MATCHER_VERSION = 'vs-runtime-2';
const VISUAL_RUNTIME_SCORER_VERSION = 'vs-runtime-scorer-v2';
const VISUAL_MATCH_INTERNAL_PATH = '/v1/internal/visual-match';
const VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_PATH = '/v1/internal/assets/metadata-resolve';
const VISUAL_ASSET_INTERNAL_CONTENT_READ_PATH = '/v1/internal/assets/content-read';
const VISUAL_CORE_CATALOG_RESPONSE_VERSION = 'galgame.visual-core-published-catalog-response.v1';
const VISUAL_CORE_CONTEXT_RESPONSE_VERSION = 'galgame.visual-core-context.v1';
const VISUAL_CORE_CANDIDATE_DECISION_PLAN_VERSION = 'galgame.visual-core-candidate-decision-plan.v1';
const VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION = 'galgame.visual-core-candidate-decision-request.v1';
const VISUAL_CORE_DECISION_RESPONSE_VERSION = 'galgame.visual-core-decision-response.v1';
const VISUAL_RUNTIME_DECISION_REQUEST_VERSION = 'galgame.visual-core-visual-decisions-request.v2';
const VISUAL_RUNTIME_DECISION_RESPONSE_VERSION = 'galgame.visual-core-visual-decisions-response.v2';
const VISUAL_RUNTIME_DECISION_ERROR_VERSION = 'galgame.visual-core-visual-decisions-error.v1';
const VISUAL_RUNTIME_HINTS_VERSION = 'galgame.visual-runtime-hints.v1';
const VISUAL_RUNTIME_REQUEST_MAX_BYTES = 16 * 1024;
const VISUAL_RUNTIME_RESPONSE_MAX_BYTES = 32 * 1024;
const VISUAL_RUNTIME_RESPONSE_HEADERS_MAX_BYTES = 16 * 1024;
const VISUAL_RUNTIME_TIMEOUT_MS = Math.min(30_000, Math.max(500, Number(process.env.GALGAME_VISUAL_RUNTIME_TIMEOUT_MS || 3_000)));
const VISUAL_RUNTIME_RETRY_SCHEMA_INVALID = process.env.GALGAME_VISUAL_RUNTIME_RETRY_SCHEMA_INVALID === 'true';
const VISUAL_RUNTIME_MAX_RETRIES = 1;
const VISUAL_RUNTIME_CACHE_MAX_ENTRIES = 256;
const VISUAL_RUNTIME_CACHE_TTL_MS = 300_000;
const VISUAL_RUNTIME_REQUEST_STYLE = 'closed-json-http-v1';
const VISUAL_RUNTIME_ANTHROPIC_REQUEST_STYLE = 'anthropic_messages_text';
const VISUAL_RUNTIME_OPENAI_REQUEST_STYLE = 'openai_chat_completions_text';
const VISUAL_RUNTIME_REQUEST_STYLE_SET = new Set([
  VISUAL_RUNTIME_REQUEST_STYLE,
  VISUAL_RUNTIME_ANTHROPIC_REQUEST_STYLE,
  VISUAL_RUNTIME_OPENAI_REQUEST_STYLE,
]);
const VISUAL_RUNTIME_MAX_TOKENS = 512;
const VISUAL_RUNTIME_HINT_STATUS_SET = new Set(['ready', 'unavailable', 'ambiguous']);
const VISUAL_RUNTIME_UNDERSTANDING_STATUS_SET = new Set(['ready', 'unavailable', 'ambiguous', 'failed']);
const VISUAL_RUNTIME_ERROR_CODES = new Set([
  null,
  'RUNTIME_NOT_CONFIGURED',
  'RUNTIME_TIMEOUT',
  'RUNTIME_NETWORK_ERROR',
  'RUNTIME_HTTP_ERROR',
  'RUNTIME_INVALID_JSON',
  'RUNTIME_SCHEMA_INVALID',
  'RUNTIME_DICTIONARY_MISMATCH',
  'RUNTIME_CONTEXT_INVALID',
  'RUNTIME_CATALOG_INCOMPATIBLE',
  'VISUAL_CONTEXT_INVALID',
  'VISUAL_PROJECTION_HASH_MISMATCH',
  'VISUAL_SOURCE_HASH_MISMATCH',
  'VISUAL_CATALOG_INVALID',
]);
const VISUAL_RUNTIME_REQUEST_ERROR_CODES = new Set([
  'VISUAL_REQUEST_INVALID',
  'VISUAL_CONTEXT_INVALID',
  'VISUAL_PROJECTION_HASH_MISMATCH',
  'VISUAL_SOURCE_HASH_MISMATCH',
  'VISUAL_PROFILE_INVALID',
  'VISUAL_CATALOG_INVALID',
  'VISUAL_INTERNAL_ERROR',
]);
const VISUAL_RUNTIME_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'projection',
  'visibleContext',
  'visualProfile',
  'expectedProjectionHash',
  'expectedSourceMessageHash',
  'createdAt',
]);
const VISUAL_RUNTIME_HINT_KEYS = Object.freeze(['schemaVersion', 'status', 'dictionaryVersion', 'dictionaryHash', 'entities']);
const VISUAL_RUNTIME_HINT_ENTITY_KEYS = Object.freeze(['entityType', 'codes', 'confidence', 'confidenceBand']);
const VISUAL_RUNTIME_ROLES = new Set(['player', 'character', 'narrator', 'system']);
const VISUAL_RUNTIME_FIXED_INSTRUCTION = [
  `Return exactly one JSON object with exactly these keys: schemaVersion, status, dictionaryVersion, dictionaryHash and entities. schemaVersion must be ${VISUAL_RUNTIME_HINTS_VERSION}. status must be ready, unavailable or ambiguous. dictionaryVersion must be ${DICTIONARY_VERSION}. dictionaryHash must be ${DICTIONARY_HASH}.`,
  'entities must be an array with at most one entity per entityType; merge all codes for the same type into one entity.',
  'Each entity must contain exactly entityType, codes, confidence and confidenceBand. entityType must be one of scene, character, equipment, item or skill. confidenceBand must be one of unknown, weak, probable or explicit.',
  'Read the full current and recent visible messages semantically. Extract visual intent even when it is expressed as ordinary narration rather than a category label: infer locations such as forest, road, tavern or dungeon from the visible text, and infer a character only when the visible text gives an identity or appearance. Do not use a speaker name alone as a character appearance.',
  'When the current message is an ordinary continuation and recent visible messages establish the same scene or character, carry those codes forward with confidenceBand probable or explicit. Do not drop an established scene or character merely because the newest sentence does not repeat its noun. Only return codes supported by current or recent visible messages.',
  'codes must be non-empty arrays of lowercase codes from the finite dictionary. Use only visible visual intent from the supplied messages. Do not return story, choices, prompts, hidden context, resource data, asset ids, URLs or extra keys.',
  `Allowed dictionary codes: ${[...ALL_DICTIONARY_CODES].join(', ')}.`,
].join(' ');
const VISUAL_CORE_DECISION_REQUEST_MAX_BYTES = 48 * 1024;
const DEFAULT_VISUAL_CORE_PLAYER_ORIGINS = Object.freeze([
  'http://127.0.0.1:8000',
  'http://localhost:8000',
  'http://127.0.0.1:8001',
  'http://localhost:8001',
]);
const VISUAL_CORE_CONTEXT_PROFILE_FIELDS = Object.freeze([
  'visualProfileId',
  'profileHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
]);
const VISUAL_CORE_CONTEXT_ERROR_CODES = new Set([
  'VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT',
  'VISUAL_CORE_CONTEXT_ORIGIN_REJECTED',
  'VISUAL_CORE_CONTEXT_METHOD_NOT_ALLOWED',
  'VISUAL_CORE_CONTEXT_INVALID',
  'VISUAL_CORE_CONTEXT_UNAVAILABLE',
]);
const VISUAL_CORE_CONTEXT_BROWSER_HEADERS = new Set([
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'dnt',
  'forwarded',
  'host',
  'pragma',
  'priority',
  'referer',
  'te',
  'trailer',
  'user-agent',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);
const VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_REQUEST_VERSION = 'galgame.visual-asset-internal-metadata-resolve-request.v1';
const VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_RESPONSE_VERSION = 'galgame.visual-asset-internal-metadata-resolve-response.v1';
const VISUAL_ASSET_INTERNAL_CONTENT_READ_REQUEST_VERSION = 'galgame.visual-asset-internal-content-read-request.v1';
const VISUAL_ASSET_INTERNAL_ERROR_VERSION = 'galgame.visual-asset-internal-error.v1';
const VISUAL_ASSET_INTERNAL_READ_AUTH_PREFIX = 'Bearer ';
const VISUAL_ASSET_INTERNAL_READ_TOKEN_PATTERN = /^[\x20-\x7e]{32,256}$/;
const VISUAL_ASSET_INTERNAL_REQUEST_MAX_BYTES = 16 * 1024;
const VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'assetType',
  'assetId',
  'assetVersion',
  'assetContentSha256',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'canonicalMime',
]);
const VISUAL_CORE_DECISION_ROUTE_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'projection',
  'visualProfile',
  'expectedProjectionHash',
  'expectedSourceMessageHash',
  'createdAt',
]);
const VISUAL_ASSET_INTERNAL_CONTENT_READ_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'ticketId',
  'bindingId',
  'entityKey',
  'assetType',
  'assetId',
  'assetVersion',
  'assetContentSha256',
  'assetMetadataHash',
  'catalogRefHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'canonicalMime',
]);
const VISUAL_MATCH_PROOF_HEADER = 'x-galgame-visual-projection-proof';
const VISUAL_MATCH_ALLOWED_HEADERS = 'content-type,x-galgame-visual-projection-proof';
const VISUAL_MATCH_SERVICE_AUTH_PREFIX = 'Bearer ';
const VISUAL_MATCH_SERVICE_TOKEN_PATTERN = /^[\x20-\x7e]{32,256}$/;
const VISUAL_RESTORE_PROOF_HEADER = 'x-galgame-visual-restore-proof';
const VISUAL_RESTORE_SERVICE_AUTH_PREFIX = 'Bearer ';
const VISUAL_RESTORE_MAX_TTL_MS = 120_000;
const VISUAL_RESTORE_REQUEST_MAX_BYTES = 16 * 1024;
const VISUAL_RESTORE_PROOF_MAX_BYTES = 16 * 1024;
const VISUAL_RESTORE_OLD_SAVE_PROOF_SCHEMA_VERSION = 'galgame.visual-old-save-restore-proof.v1';
const VISUAL_RESTORE_ROLLBACK_PROOF_SCHEMA_VERSION = 'galgame.visual-rollback-restore-proof.v1';
const VISUAL_RESTORE_OLD_SAVE_PURPOSE = 'old-save-visual-binding-restore';
const VISUAL_RESTORE_ROLLBACK_PURPOSE = 'rollback-visual-binding-restore';
const VISUAL_RESTORE_AUDIENCE = 'visual-asset-service';
const VISUAL_RESTORE_ISSUER = 'game-config-service';
const VISUAL_MATCH_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'projectionId',
  'entityKey',
  'entityType',
  'idempotencyKey',
]);
const VISUAL_RESTORE_BINDING_REQUEST_KEYS = Object.freeze([
  'schemaVersion',
  'requestId',
  'idempotencyKey',
  'bindingId',
  'bindingType',
  'entityKey',
  'expectedReleaseId',
  'expectedReleaseScopeHash',
  'expectedScenarioId',
  'expectedScenarioVersion',
  'expectedArcId',
  'expectedVisualProfileId',
  'expectedVisualProfileHash',
  'expectedCatalogId',
  'expectedCatalogRevision',
  'expectedCatalogHash',
  'expectedDictionaryVersion',
  'expectedDictionaryHash',
  'expectedRetentionId',
  'expectedRetentionHash',
  'expectedBindingRecordHash',
  'expectedReceiptHash',
  'expectedAssetId',
  'expectedAssetVersion',
  'expectedAssetContentSha256',
  'expectedAssetMetadataHash',
  'expectedCatalogRefHash',
]);
const VISUAL_BINDING_STORE_RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'bindingId',
  'bindingStatus',
  'bindingPolicy',
  'releaseId',
  'scenarioId',
  'scenarioVersion',
  'arcId',
  'chatId',
  'projectionId',
  'projectionHash',
  'sourceMessageIndex',
  'sourceMessageHash',
  'evidenceDigest',
  'entityKey',
  'entityType',
  'decisionId',
  'matchId',
  'assetId',
  'assetVersion',
  'assetContentSha256',
  'assetMetadataHash',
  'catalogRefHash',
  'visualProfileId',
  'profileHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'dictionaryVersion',
  'dictionaryHash',
  'matcherVersion',
  'scorerVersion',
  'idempotencyKeyHash',
  'publicBindingHash',
  'publicResultHash',
  'createdAt',
  'expiresAt',
]);
const VISUAL_BINDING_RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'receiptId',
  'retentionId',
  'bindingId',
  'entityKey',
  'assetType',
  'bindingPolicy',
  'sourceMessageIndex',
  'sourceMessageHash',
  'evidenceDigest',
  'projectionId',
  'projectionHash',
  'releaseId',
  'releaseScopeHash',
  'scenarioId',
  'scenarioVersion',
  'arcId',
  'chatIdHash',
  'visualProfileId',
  'visualProfileHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'dictionaryVersion',
  'dictionaryHash',
  'assetId',
  'assetVersion',
  'assetContentSha256',
  'assetMetadataHash',
  'catalogRefHash',
  'bindingRecordHash',
  'retentionHash',
  'receiptHash',
  'createdAt',
  'expiresAt',
]);
const VISUAL_BINDING_RETENTION_KEYS = Object.freeze([
  'schemaVersion',
  'retentionId',
  'retentionPolicy',
  'gcState',
  'bindingIds',
  'releaseId',
  'releaseScopeHash',
  'scenarioId',
  'scenarioVersion',
  'arcId',
  'visualProfileId',
  'visualProfileHash',
  'catalogId',
  'catalogRevision',
  'catalogHash',
  'dictionaryVersion',
  'dictionaryHash',
  'createdAt',
  'retentionUntil',
  'retentionHash',
]);
const VISUAL_RESTORE_REPLAY_VALUE_KEYS = Object.freeze([
  'restoreReplayKey',
  'requestBodyHash',
  'proofTokenHash',
  'publicBindingHash',
  'receiptHash',
  'retentionHash',
  'routeKind',
  'expiresAtMs',
]);
const VISUAL_RESTORE_REPLAY_RECORD_KEYS = Object.freeze([
  'schemaVersion',
  'restoreReplayKey',
  'value',
  'createdAt',
]);
const VISUAL_MATCH_REQUEST_MAX_BYTES = 16 * 1024;
const VISUAL_MATCH_PROOF_MAX_BYTES = 12 * 1024;
const VISUAL_STUB_RESPONSE_DEFAULT_MAX_BYTES = 65_536;
const VISUAL_STUB_RESPONSE_MAX_BYTES = 131_072;
const VISUAL_STUB_TIMEOUT_DEFAULT_MS = 3000;
const VISUAL_STUB_TIMEOUT_MAX_MS = 5000;

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(value[key]);
    }
    return output;
  }
  return value;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Json(value) {
  return `sha256:${sha256Hex(Buffer.from(canonicalJson(value), 'utf8'))}`;
}

function nowIso(now = Date.now) {
  return new Date(now()).toISOString();
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(value, keys, label) {
  if (!isPlainObject(value)) {
    throw visualError('VISUAL_ASSET_BAD_REQUEST', `${label} must be an object`, 400);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw visualError('VISUAL_ASSET_UNKNOWN_FIELD', `${label}.${key} is not allowed`, 400);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw visualError('VISUAL_ASSET_MISSING_FIELD', `${label}.${key} is required`, 400);
    }
  }
}

function assertRuntimeVisibleContext(value) {
  requireExactKeys(value, ['current', 'recent'], 'visibleContext');
  const current = normalizeVisualRuntimeMessage(value.current, { maxTextLength: 4000 });
  if (!current) throw visualError('VISUAL_CONTEXT_INVALID', 'visibleContext.current is invalid', 400);
  if (!Array.isArray(value.recent) || value.recent.length > 3) {
    throw visualError('VISUAL_CONTEXT_INVALID', 'visibleContext.recent is invalid', 400);
  }
  const recent = value.recent.map((message, index) => {
    const normalized = normalizeVisualRuntimeMessage(message, { maxTextLength: 1200 });
    if (!normalized) throw visualError('VISUAL_CONTEXT_INVALID', `visibleContext.recent[${index}] is invalid`, 400);
    return normalized;
  });
  const currentHash = sha256Json(current);
  const recentHash = sha256Json(recent);
  return { current, recent, currentHash, recentHash };
}

function assertRuntimeHint(value, label = 'runtimeHints') {
  requireExactKeys(value, VISUAL_RUNTIME_HINT_KEYS, label);
  if (value.schemaVersion !== VISUAL_RUNTIME_HINTS_VERSION) throw visualError('RUNTIME_SCHEMA_INVALID', `${label}.schemaVersion is invalid`, 502);
  if (!VISUAL_RUNTIME_HINT_STATUS_SET.has(value.status)) throw visualError('RUNTIME_SCHEMA_INVALID', `${label}.status is invalid`, 502);
  if (!Number.isSafeInteger(value.dictionaryVersion) || value.dictionaryVersion !== DICTIONARY_VERSION) {
    throw visualError('RUNTIME_DICTIONARY_MISMATCH', `${label}.dictionaryVersion is invalid`, 502);
  }
  if (value.dictionaryHash !== DICTIONARY_HASH) throw visualError('RUNTIME_DICTIONARY_MISMATCH', `${label}.dictionaryHash is invalid`, 502);
  if (!Array.isArray(value.entities) || value.entities.length > ENTITY_TYPES.length) {
    throw visualError('RUNTIME_SCHEMA_INVALID', `${label}.entities is invalid`, 502);
  }
  const seenTypes = new Set();
  for (const [index, entity] of value.entities.entries()) {
    const entityLabel = `${label}.entities[${index}]`;
    requireExactKeys(entity, VISUAL_RUNTIME_HINT_ENTITY_KEYS, entityLabel);
    if (!ENTITY_TYPE_SET.has(entity.entityType) || seenTypes.has(entity.entityType)) {
      throw visualError('RUNTIME_SCHEMA_INVALID', `${entityLabel}.entityType is invalid`, 502);
    }
    seenTypes.add(entity.entityType);
    if (!Array.isArray(entity.codes) || entity.codes.length < 1 || entity.codes.length > 8) {
      throw visualError('RUNTIME_SCHEMA_INVALID', `${entityLabel}.codes is invalid`, 502);
    }
    const seenCodes = new Set();
    for (const code of entity.codes) {
      assertSafeString(code, `${entityLabel}.codes`, 1, 64, /^[a-z0-9._:-]+$/);
      if (!ALL_DICTIONARY_CODES.has(code) || (!code.startsWith(`${entity.entityType}.`) && !code.startsWith('feature.')) || seenCodes.has(code)) {
        throw visualError('RUNTIME_SCHEMA_INVALID', `${entityLabel}.codes contains an invalid or duplicate code`, 502);
      }
      seenCodes.add(code);
    }
    if (typeof entity.confidence !== 'number' || !Number.isFinite(entity.confidence) || entity.confidence < 0 || entity.confidence > 1) {
      throw visualError('RUNTIME_SCHEMA_INVALID', `${entityLabel}.confidence is invalid`, 502);
    }
    if (!VISUAL_CONFIDENCE_BANDS.includes(entity.confidenceBand)) {
      throw visualError('RUNTIME_SCHEMA_INVALID', `${entityLabel}.confidenceBand is invalid`, 502);
    }
  }
  if (value.status === 'ready' && value.entities.length === 0) {
    throw visualError('RUNTIME_SCHEMA_INVALID', `${label} ready response has no usable entities`, 502);
  }
  if (value.status !== 'ready' && value.entities.length !== 0) {
    throw visualError('RUNTIME_SCHEMA_INVALID', `${label} unavailable response contains entities`, 502);
  }
  return value;
}

function createRuntimePlaceholderHint(status = 'unavailable') {
  return {
    schemaVersion: VISUAL_RUNTIME_HINTS_VERSION,
    status,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    entities: [],
  };
}

function runtimeErrorCode(error) {
  return VISUAL_RUNTIME_ERROR_CODES.has(error?.code) ? error.code : 'RUNTIME_SCHEMA_INVALID';
}

function runtimeUnderstandingStatus(result) {
  if (!result) return 'ready';
  if (result.hint.status === 'ready') return 'ready';
  if (result.errorCode === 'RUNTIME_NOT_CONFIGURED') return 'unavailable';
  if (result.errorCode) return 'failed';
  if (result.hint.status === 'ambiguous') return 'ambiguous';
  return 'failed';
}

function runtimeDecisionErrorCode(code) {
  if (!code) return null;
  if (code === 'VISUAL_CORE_PROJECTION_STALE') return 'VISUAL_PROJECTION_HASH_MISMATCH';
  if (code === 'VISUAL_CORE_SOURCE_STALE') return 'VISUAL_SOURCE_HASH_MISMATCH';
  if (code === 'VISUAL_CORE_CATALOG_NOT_PUBLISHED' || code === 'VISUAL_CORE_CATALOG_SCOPE_MISMATCH') return 'VISUAL_CATALOG_INVALID';
  return VISUAL_RUNTIME_ERROR_CODES.has(code) ? code : 'VISUAL_CATALOG_INVALID';
}

function createRuntimeDecisionErrorResponse(requestId, errorCode = 'VISUAL_REQUEST_INVALID') {
  const safeRequestId = typeof requestId === 'string' && CANDIDATE_REQUEST_ID_PATTERN.test(requestId) ? requestId : null;
  return {
    schemaVersion: VISUAL_RUNTIME_DECISION_ERROR_VERSION,
    ok: false,
    requestId: safeRequestId,
    errorCode: VISUAL_RUNTIME_REQUEST_ERROR_CODES.has(errorCode) ? errorCode : 'VISUAL_REQUEST_INVALID',
    errorCode: VISUAL_RUNTIME_REQUEST_ERROR_CODES.has(errorCode) ? errorCode : 'VISUAL_REQUEST_INVALID',
  };
}

function visualError(code, message, status = 400, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function assertSafeString(value, label, min, max, pattern = /^[\x20-\x7e]+$/) {
  if (typeof value !== 'string' || value.length < min || value.length > max || !pattern.test(value)) {
    throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} is invalid`, 400);
  }
}

function assertSafeAnalyzerDescription(value, label, min, max) {
  if (typeof value === 'string' && /(?:https?|ftp):\/\/|(?:data|javascript):|<\s*\/?\s*[a-z][^>]*>/iu.test(value)) {
    throw visualError('VISUAL_ANALYSIS_FORBIDDEN_FIELD', `${label} contains a URL or markup`, 400);
  }
  assertSafeString(value, label, min, max, /^[\p{L}\p{N}\p{P}\p{Zs}\n\r]*$/u);
}

function assertPositiveInteger(value, label, max = 999_999) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw visualError('VISUAL_ASSET_INVALID_NUMBER', `${label} must be a positive integer`, 400);
  }
}

function assertSafeCodeArray(value, label, maxItems = 32) {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} must be an array`, 400);
  }
  const seen = new Set();
  for (const item of value) {
    assertSafeString(item, label, 1, 80, /^[a-z0-9._:-]+$/);
    if (!ALL_DICTIONARY_CODES.has(item)) {
      throw visualError('VISUAL_ASSET_UNKNOWN_CODE', `${label} has an unknown code`, 400);
    }
    if (seen.has(item)) {
      throw visualError('VISUAL_ASSET_DUPLICATE_CODE', `${label} has duplicate codes`, 400);
    }
    seen.add(item);
  }
}

function assertAnalysisCodeArray(value, label, assetType) {
  if (!Array.isArray(value) || value.length > MAX_ANALYZER_CODES) {
    throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label} must be an array`, 400);
  }
  const seen = new Set();
  for (const item of value) {
    assertSafeString(item, label, 1, 80, /^[a-z0-9._:-]+$/);
    if (!ALL_DICTIONARY_CODES.has(item)) {
      throw visualError('VISUAL_ANALYSIS_UNKNOWN_CODE', `${label} contains an unknown code`, 400);
    }
    if (!item.startsWith('feature.') && !item.startsWith(`${assetType}.`)) {
      throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label} contains a code for another asset type`, 400);
    }
    if (seen.has(item)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label} contains duplicate codes`, 400, { reason: 'duplicate_code' });
    seen.add(item);
  }
}

function createUnavailableVisualAnalysis(errorCode = 'ANALYZER_NOT_CONFIGURED') {
  if (!ANALYSIS_ERROR_CODE_SET.has(errorCode)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis error code is invalid', 500);
  return {
    schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
    status: 'unavailable',
    description: '',
    tagCodes: [],
    attributeCodes: [],
    confidence: 0,
    analyzerVersion: 'independent-analyzer-v1',
    errorCode,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
  };
}

function createFailedVisualAnalysis(errorCode) {
  if (!ANALYSIS_ERROR_CODE_SET.has(errorCode)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis error code is invalid', 500);
  return {
    ...createUnavailableVisualAnalysis(errorCode),
    status: 'failed',
  };
}

function validateVisualAnalysis(analysis, assetType) {
  requireExactKeys(analysis, [
    'schemaVersion',
    'status',
    'description',
    'tagCodes',
    'attributeCodes',
    'confidence',
    'analyzerVersion',
    'errorCode',
    'dictionaryVersion',
    'dictionaryHash',
  ], 'analysis');
  if (analysis.schemaVersion !== VISUAL_ANALYSIS_SCHEMA_VERSION) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis schema version is invalid', 500);
  if (!ANALYSIS_STATUS_SET.has(analysis.status)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis status is invalid', 500);
  assertSafeAnalyzerDescription(analysis.description, 'analysis.description', 0, MAX_ANALYZER_DESCRIPTION_LENGTH);
  assertAnalysisCodeArray(analysis.tagCodes, 'analysis.tagCodes', assetType);
  assertAnalysisCodeArray(analysis.attributeCodes, 'analysis.attributeCodes', assetType);
  const allCodes = new Set(analysis.tagCodes);
  for (const code of analysis.attributeCodes) {
    if (allCodes.has(code)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis codes must be unique across arrays', 500);
    allCodes.add(code);
  }
  if (typeof analysis.confidence !== 'number' || !Number.isFinite(analysis.confidence) || analysis.confidence < 0 || analysis.confidence > 1) {
    throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis confidence is invalid', 500);
  }
  assertSafeString(analysis.analyzerVersion, 'analysis.analyzerVersion', 1, 80, /^[A-Za-z0-9._:-]+$/);
  if (analysis.errorCode !== null) {
    assertSafeString(analysis.errorCode, 'analysis.errorCode', 1, 80, /^[A-Z0-9_]+$/);
    if (!ANALYSIS_ERROR_CODE_SET.has(analysis.errorCode)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'analysis error code is invalid', 500);
  }
  if (!Number.isSafeInteger(analysis.dictionaryVersion) || analysis.dictionaryVersion !== DICTIONARY_VERSION) {
    throw visualError('VISUAL_ANALYSIS_DICTIONARY_MISMATCH', 'analysis dictionary version is invalid', 500);
  }
  assertSha256Digest(analysis.dictionaryHash, 'analysis.dictionaryHash');
  if (analysis.dictionaryHash !== DICTIONARY_HASH) {
    throw visualError('VISUAL_ANALYSIS_DICTIONARY_MISMATCH', 'analysis dictionary hash is invalid', 500);
  }
  if (analysis.status === 'ready') {
    if (analysis.errorCode !== null || analysis.confidence <= 0 || (analysis.tagCodes.length === 0 && analysis.attributeCodes.length === 0)) {
      throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'ready analysis must contain closed output', 500);
    }
  } else if (analysis.confidence !== 0 || analysis.description !== '' || analysis.tagCodes.length !== 0 || analysis.attributeCodes.length !== 0) {
    throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', 'unavailable analysis must not contain provider output', 500);
  }
}

const VISIBLE_VALUE_CODE_ALIASES = Object.freeze({
  forest: 'scene.forest',
  woods: 'scene.forest',
  forested: 'scene.forest',
  森林: 'scene.forest',
  woodsland: 'scene.forest',
  ruins: 'scene.ruins',
  ruin: 'scene.ruins',
  废墟: 'scene.ruins',
  interior: 'scene.interior',
  indoor: 'scene.interior',
  室内: 'scene.interior',
  exterior: 'scene.exterior',
  outdoor: 'scene.exterior',
  室外: 'scene.exterior',
  city: 'scene.city',
  城市: 'scene.city',
  dungeon: 'scene.dungeon',
  地牢: 'scene.dungeon',
  night: 'scene.night',
  夜晚: 'scene.night',
  day: 'scene.day',
  白天: 'scene.day',
  human: 'character.human',
  人类: 'character.human',
  elf: 'character.elf',
  精灵: 'character.elf',
  dwarf: 'character.dwarf',
  矮人: 'character.dwarf',
  rogue: 'character.rogue',
  盗贼: 'character.rogue',
  mage: 'character.mage',
  法师: 'character.mage',
  armored: 'character.armored',
  armor: 'character.armored',
  knight: 'character.armored',
  骑士: 'character.armored',
  武器: 'equipment.weapon',
  weapon: 'equipment.weapon',
  sword: 'equipment.weapon',
  剑: 'equipment.weapon',
  greatsword: 'equipment.melee',
  大剑: 'equipment.melee',
  blade: 'equipment.melee',
  melee: 'equipment.melee',
  近战: 'equipment.melee',
  ranged: 'equipment.ranged',
  远程: 'equipment.ranged',
  armor_equipment: 'equipment.armor',
  equipment_armor: 'equipment.armor',
  'scale mail': 'equipment.armor',
  mail: 'equipment.armor',
  shield: 'equipment.armor',
  盾牌: 'equipment.armor',
  装备: 'equipment.armor',
  magic_equipment: 'equipment.magical',
  magical: 'equipment.magical',
  魔法: 'equipment.magical',
  quest: 'item.quest',
  任务: 'item.quest',
  key: 'item.key',
  钥匙: 'item.key',
  treasure: 'item.treasure',
  宝藏: 'item.treasure',
  tool: 'item.tool',
  工具: 'item.tool',
  pack: 'item.tool',
  backpack: 'item.tool',
  "explorer's pack": 'item.tool',
  explorer_pack: 'item.tool',
  背包: 'item.tool',
  magic: 'skill.magic',
  spell: 'skill.magic',
  法术: 'skill.magic',
  stealth: 'skill.stealth',
  潜行: 'skill.stealth',
  combat: 'skill.combat',
  战斗: 'skill.combat',
  fighting: 'skill.combat',
  'great weapon fighting': 'skill.combat',
  'action surge': 'skill.combat',
  'second wind': 'skill.combat',
  fighting_style: 'skill.combat',
  crafting: 'skill.crafting',
  制作: 'skill.crafting',
  survival: 'skill.survival',
  生存: 'skill.survival',
  transparent: 'feature.transparent',
  透明: 'feature.transparent',
  full_body: 'feature.full-body',
  全身: 'feature.full-body',
  portrait: 'feature.portrait',
  肖像: 'feature.portrait',
  dark: 'feature.dark',
  黑暗: 'feature.dark',
  wooden: 'feature.wooden',
  木制: 'feature.wooden',
  stone: 'feature.stone',
  石制: 'feature.stone',
  abandoned: 'feature.abandoned',
  废弃: 'feature.abandoned',
  icon: 'feature.icon',
  图标: 'feature.icon',
});

function normalizeVisibleValue(value) {
  const text = String(value || '').trim().toLocaleLowerCase();
  const codes = new Set();
  if (!text) return codes;
  const exact = VISIBLE_VALUE_CODE_ALIASES[text];
  if (exact) codes.add(exact);
  for (const [alias, code] of Object.entries(VISIBLE_VALUE_CODE_ALIASES)) {
    if (alias.length >= 2 && text.includes(alias)) codes.add(code);
  }
  return codes;
}

function deriveVisibleNormalizedCodes(entity) {
  const codes = new Set();
  normalizeVisibleValue(entity.displayLabel).forEach((code) => codes.add(code));
  for (const attribute of entity.visibleAttributes || []) {
    normalizeVisibleValue(attribute.value).forEach((code) => codes.add(code));
  }
  return [...codes].filter((code) => code.startsWith(`${entity.entityType}.`) || code.startsWith('feature.'));
}

function validateUploadMetadata(metadata) {
  requireExactKeys(metadata, [
    'assetId',
    'assetVersion',
    'assetType',
    'role',
    'title',
    'tagCodes',
    'featureCodes',
    'licenseCode',
    'sourceLabel',
  ], 'metadata');
  assertSafeString(metadata.assetId, 'assetId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  if (metadata.assetId.startsWith('unknown_')) {
    throw visualError('VISUAL_ASSET_RESERVED_ID', 'unknown asset ids are service-owned', 400);
  }
  assertPositiveInteger(metadata.assetVersion, 'assetVersion');
  if (!ENTITY_TYPE_SET.has(metadata.assetType)) {
    throw visualError('VISUAL_ASSET_INVALID_TYPE', 'assetType is invalid', 400);
  }
  if (metadata.role !== ROLE_BY_TYPE[metadata.assetType] || !ROLE_SET.has(metadata.role)) {
    throw visualError('VISUAL_ASSET_ROLE_MISMATCH', 'asset role is not allowed for this type', 400);
  }
  assertSafeString(metadata.title, 'title', 1, 80, /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
  assertSafeCodeArray(metadata.tagCodes, 'tagCodes');
  assertSafeCodeArray(metadata.featureCodes, 'featureCodes');
  if (!LICENSE_CODE_SET.has(metadata.licenseCode)) {
    throw visualError('VISUAL_ASSET_INVALID_LICENSE', 'licenseCode is invalid', 400);
  }
  assertSafeString(metadata.sourceLabel, 'sourceLabel', 0, 120, /^[\p{L}\p{N}\p{P}\p{Zs}]*$/u);
}

function assertSimpleUploadRequest(body) {
  requireExactKeysWithOptional(body, ['schemaVersion', 'assetType', 'title', 'imageBase64'], ['tagCodes', 'featureCodes', 'fileName'], 'simpleUpload');
  if (body.schemaVersion !== SIMPLE_UPLOAD_SCHEMA_VERSION) throw visualError('VISUAL_SIMPLE_UPLOAD_INVALID_SCHEMA', 'simple upload schema invalid', 400);
  if (!ENTITY_TYPE_SET.has(body.assetType)) throw visualError('VISUAL_SIMPLE_UPLOAD_INVALID_TYPE', 'assetType is invalid', 400);
  assertSafeString(body.title, 'title', 1, 80, /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
  if (body.tagCodes !== undefined) assertSafeCodeArray(body.tagCodes, 'tagCodes');
  if (body.featureCodes !== undefined) assertSafeCodeArray(body.featureCodes, 'featureCodes');
  if (body.fileName !== undefined) {
    if (typeof body.fileName !== 'string' || body.fileName.includes('/') || body.fileName.includes('\\') || body.fileName.includes('..')) {
      throw visualError('VISUAL_SIMPLE_UPLOAD_INVALID_FILE_NAME', 'fileName must not contain a path', 400);
    }
    assertSafeString(body.fileName, 'fileName', 1, 100, /^[\p{L}\p{N}._ -]+$/u);
  }
  // Decode validation is intentionally delegated to the existing production upload path.
  if (typeof body.imageBase64 !== 'string') throw visualError('VISUAL_SIMPLE_UPLOAD_BAD_IMAGE', 'imageBase64 is invalid', 400);
}

function defaultSimpleFeatureCodes(assetType) {
  if (assetType === 'character') return ['feature.transparent'];
  if (assetType === 'equipment' || assetType === 'item' || assetType === 'skill') return ['feature.icon'];
  return [];
}

function createSimpleUploadSourceLabel(body) {
  if (!body.fileName) return 'simple upload';
  return `simple upload: ${body.fileName}`;
}

function decodeUploadBodyBase64(imageBase64) {
  if (typeof imageBase64 !== 'string' || imageBase64.length < 8 || imageBase64.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4 + 8) {
    throw visualError('VISUAL_ASSET_BAD_IMAGE', 'imageBase64 is invalid', 400);
  }
  if (/^data:/i.test(imageBase64) || !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw visualError('VISUAL_ASSET_BAD_IMAGE', 'imageBase64 must be plain base64', 400);
  }
  const bytes = Buffer.from(imageBase64, 'base64');
  if (bytes.length <= 0 || bytes.length > MAX_UPLOAD_BYTES) {
    throw visualError('VISUAL_ASSET_SIZE_LIMIT', 'image exceeds upload size limit', 413);
  }
  return bytes;
}

function computeAssetMetadataHash(asset) {
  const clone = { ...asset };
  delete clone.assetMetadataHash;
  return sha256Json(clone);
}

function computeCatalogHash(catalog) {
  const clone = { ...catalog };
  delete clone.catalogHash;
  return sha256Json(clone);
}

function assertLegacyAnalysisCodeArray(value, label, assetType) {
  if (!Array.isArray(value) || value.length > MAX_ANALYZER_CODES) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', `${label} must be an array`, 400);
  const allowed = new Set([...(LEGACY_TAG_DICTIONARY[assetType] || []), ...(FEATURE_DICTIONARY[assetType] || [])]);
  const seen = new Set();
  for (const code of value) {
    assertSafeString(code, label, 1, 80, /^[a-z0-9._:-]+$/);
    if (!allowed.has(code) || seen.has(code)) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', `${label} contains an invalid legacy code`, 400);
    seen.add(code);
  }
}

function assertLegacyVisualAnalysis(analysis, assetType) {
  requireExactKeys(analysis, ['schemaVersion', 'status', 'description', 'tagCodes', 'attributeCodes', 'confidence', 'analyzerVersion', 'errorCode'], 'legacyAnalysis');
  if (analysis.schemaVersion !== LEGACY_VISUAL_ANALYSIS_SCHEMA_VERSION || !ANALYSIS_STATUS_SET.has(analysis.status)) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy analysis schema is not supported', 409);
  }
  assertSafeAnalyzerDescription(analysis.description, 'legacyAnalysis.description', 0, MAX_ANALYZER_DESCRIPTION_LENGTH);
  assertLegacyAnalysisCodeArray(analysis.tagCodes, 'legacyAnalysis.tagCodes', assetType);
  assertLegacyAnalysisCodeArray(analysis.attributeCodes, 'legacyAnalysis.attributeCodes', assetType);
  if (typeof analysis.confidence !== 'number' || !Number.isFinite(analysis.confidence) || analysis.confidence < 0 || analysis.confidence > 1) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy analysis confidence is invalid', 409);
  }
  assertSafeString(analysis.analyzerVersion, 'legacyAnalysis.analyzerVersion', 1, 80, /^[A-Za-z0-9._:-]+$/);
  if (analysis.errorCode !== null && !ANALYSIS_ERROR_CODE_SET.has(analysis.errorCode)) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy analysis error code is invalid', 409);
}

function assertLegacyVisualAsset(asset) {
  if (!isPlainObject(asset) || asset.dictionaryVersion !== LEGACY_DICTIONARY_VERSION || asset.dictionaryHash !== LEGACY_DICTIONARY_HASH) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH', 'asset is not an exact revision-1 record', 409);
  }
  if (asset.schemaVersion !== ASSET_SCHEMA_VERSION || !['draft', 'published'].includes(asset.status) || asset.status !== 'published') {
    throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy asset is not published', 409);
  }
  assertLegacyVisualAnalysis(asset.analysis, asset.assetType);
  if (asset.assetMetadataHash !== computeAssetMetadataHash(asset)) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy asset metadata hash is invalid', 409);
}

function assertLegacyVisualCatalog(catalog) {
  requireExactKeys(catalog, [
    'schemaVersion', 'catalogId', 'catalogRevision', 'status', 'assetRefs', 'unknownAssetRefs',
    'dictionaryVersion', 'dictionaryHash', 'createdAt', 'updatedAt', 'publishedAt', 'archivedAt', 'catalogHash',
  ], 'legacyCatalog');
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION || catalog.dictionaryVersion !== LEGACY_DICTIONARY_VERSION || catalog.dictionaryHash !== LEGACY_DICTIONARY_HASH) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH', 'catalog is not an exact revision-1 record', 409);
  }
  assertSafeString(catalog.catalogId, 'legacyCatalog.catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(catalog.catalogRevision, 'legacyCatalog.catalogRevision');
  if (catalog.status !== 'published') throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy catalog is not published', 409);
  validateAssetRefs(catalog.assetRefs, 'legacyCatalog.assetRefs', 512);
  validateAssetRefs(catalog.unknownAssetRefs, 'legacyCatalog.unknownAssetRefs', 5);
  if (catalog.unknownAssetRefs.length !== 5 || catalog.catalogHash !== computeCatalogHash(catalog)) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'legacy catalog metadata is invalid', 409);
  }
}

function legacyAssetRef(asset) {
  return {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetType: asset.assetType,
    assetContentSha256: asset.assetContentSha256,
    assetMetadataHash: asset.assetMetadataHash,
  };
}

async function createRuntimeV2MigrationPlan({ catalog, assets, analyzeAsset }) {
  if (!isPlainObject(catalog) || !Array.isArray(assets) || typeof analyzeAsset !== 'function') {
    throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'migration inputs are invalid', 400);
  }
  if (catalog.dictionaryVersion !== LEGACY_DICTIONARY_VERSION || catalog.dictionaryHash !== LEGACY_DICTIONARY_HASH) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH', 'catalog is not an exact revision-1 record', 409);
  }
  const assetMap = new Map(assets.map((asset) => [`${asset.assetId}:${asset.assetVersion}`, asset]));
  const migratedAssets = [];
  for (const ref of catalog.assetRefs || []) {
    const asset = assetMap.get(`${ref.assetId}:${ref.assetVersion}`);
    if (!asset) throw visualError('VISUAL_RUNTIME_MIGRATION_ASSET_MISSING', 'catalog asset is missing', 409);
    assertLegacyVisualAsset(asset);
    if (canonicalJson(ref) !== canonicalJson(legacyAssetRef(asset))) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_REF_MISMATCH', 'legacy catalog ref does not match asset', 409);
    }
    const analysis = await analyzeAsset(structuredClone(asset));
    validateVisualAnalysis(analysis, asset.assetType);
    const migrated = {
      ...structuredClone(asset),
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      analysisStatus: analysis.status,
      analysis: structuredClone(analysis),
    };
    migrated.assetMetadataHash = computeAssetMetadataHash(migrated);
    validateAsset(migrated);
    migratedAssets.push(migrated);
  }
  const migratedCatalog = {
    ...structuredClone(catalog),
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    assetRefs: migratedAssets.map((asset) => assetToRef(asset)),
    unknownAssetRefs: ENTITY_TYPES.map((type) => assetToRef(BUILTIN_UNKNOWN_ASSETS[type])),
  };
  migratedCatalog.catalogHash = computeCatalogHash(migratedCatalog);
  validateCatalog(migratedCatalog);
  return {
    ok: true,
    sourceDictionaryVersion: LEGACY_DICTIONARY_VERSION,
    sourceDictionaryHash: LEGACY_DICTIONARY_HASH,
    targetDictionaryVersion: DICTIONARY_VERSION,
    targetDictionaryHash: DICTIONARY_HASH,
    assets: migratedAssets,
    catalog: migratedCatalog,
  };
}

async function executeRuntimeV2Migration({ catalog, assets, analyzeAsset, transaction }) {
  const plan = await createRuntimeV2MigrationPlan({ catalog, assets, analyzeAsset });
  if (!transaction || typeof transaction.stage !== 'function' || typeof transaction.activate !== 'function' || typeof transaction.rollback !== 'function') {
    return plan;
  }
  const snapshot = typeof transaction.snapshot === 'function' ? await transaction.snapshot() : null;
  try {
    await transaction.stage(plan);
    await transaction.activate(plan);
    return plan;
  } catch (error) {
    await transaction.rollback(snapshot);
    throw visualError('VISUAL_RUNTIME_MIGRATION_ROLLED_BACK', 'runtime dictionary migration rolled back', 409);
  }
}

function createUnknownAsset(assetType) {
  if (!ENTITY_TYPE_SET.has(assetType)) {
    throw visualError('VISUAL_ASSET_INVALID_TYPE', 'unknown asset type is invalid', 500);
  }
  const role = ROLE_BY_TYPE[assetType];
  const asset = {
    schemaVersion: ASSET_SCHEMA_VERSION,
    assetId: `unknown_${assetType}`,
    assetVersion: 1,
    assetType,
    role,
    title: 'Unknown',
    tagCodes: [],
    featureCodes: [],
    licenseCode: 'cc0',
    sourceLabel: '',
    canonicalMime: PNG_MIME,
    width: 1,
    height: 1,
    hasAlpha: true,
    transparentPixel: true,
    assetContentSha256: TRANSPARENT_PNG_HASH,
    contentUri: `/v1/admin/assets/unknown_${assetType}/1/content`,
    thumbnailUri: `/v1/admin/assets/unknown_${assetType}/1/content`,
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    analysisStatus: 'unavailable',
    analysis: {
      schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
      status: 'unavailable',
      description: '',
      tagCodes: [],
      attributeCodes: [],
      confidence: 0,
      analyzerVersion: 'builtin-unknown-v1',
      errorCode: 'ANALYZER_NOT_CONFIGURED',
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
    },
    status: 'published',
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
  };
  asset.assetMetadataHash = computeAssetMetadataHash(asset);
  return asset;
}

const BUILTIN_UNKNOWN_ASSETS = Object.freeze(Object.fromEntries(ENTITY_TYPES.map((type) => [type, Object.freeze(createUnknownAsset(type))])));

function ensureUnknownAssetCoherence(asset) {
  if (!asset.assetId.startsWith('unknown_')) {
    return;
  }
  const expectedType = asset.assetId.slice('unknown_'.length);
  const expected = BUILTIN_UNKNOWN_ASSETS[expectedType];
  if (!expected || canonicalJson(asset) !== canonicalJson(expected)) {
    throw visualError('VISUAL_ASSET_UNKNOWN_TAMPERED', 'immutable unknown asset was modified', 500);
  }
}

function validateAsset(asset) {
  requireExactKeys(asset, [
    'schemaVersion',
    'assetId',
    'assetVersion',
    'assetType',
    'role',
    'title',
    'tagCodes',
    'featureCodes',
    'licenseCode',
    'sourceLabel',
    'canonicalMime',
    'width',
    'height',
    'hasAlpha',
    'transparentPixel',
    'assetContentSha256',
    'contentUri',
    'thumbnailUri',
    'dictionaryVersion',
    'dictionaryHash',
    'analysisStatus',
    'analysis',
    'status',
    'createdAt',
    'updatedAt',
    'assetMetadataHash',
  ], 'asset');
  if (asset.schemaVersion !== ASSET_SCHEMA_VERSION) throw visualError('VISUAL_ASSET_INVALID_SCHEMA', 'asset schema is invalid', 500);
  assertSafeString(asset.assetId, 'assetId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(asset.assetVersion, 'assetVersion');
  if (!ENTITY_TYPE_SET.has(asset.assetType)) throw visualError('VISUAL_ASSET_INVALID_TYPE', 'assetType is invalid', 500);
  if (asset.role !== ROLE_BY_TYPE[asset.assetType]) throw visualError('VISUAL_ASSET_ROLE_MISMATCH', 'role mismatch', 500);
  assertSafeString(asset.title, 'title', 1, 80, /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
  assertSafeCodeArray(asset.tagCodes, 'tagCodes');
  assertSafeCodeArray(asset.featureCodes, 'featureCodes');
  if (!LICENSE_CODE_SET.has(asset.licenseCode)) throw visualError('VISUAL_ASSET_INVALID_LICENSE', 'license invalid', 500);
  assertSafeString(asset.sourceLabel, 'sourceLabel', 0, 120, /^[\p{L}\p{N}\p{P}\p{Zs}]*$/u);
  if (asset.canonicalMime !== PNG_MIME) throw visualError('VISUAL_ASSET_INVALID_MIME', 'mime invalid', 500);
  const maxDimension = asset.role === 'background' ? MAX_SCENE_DIMENSION : MAX_SPRITE_ICON_DIMENSION;
  assertPositiveInteger(asset.width, 'width', maxDimension);
  assertPositiveInteger(asset.height, 'height', maxDimension);
  if (!Number.isSafeInteger(asset.width * asset.height) || asset.width * asset.height > MAX_DECODED_PIXELS) {
    throw visualError('VISUAL_ASSET_PIXEL_LIMIT', 'persisted asset pixel count exceeds limit', 500);
  }
  if (typeof asset.hasAlpha !== 'boolean' || typeof asset.transparentPixel !== 'boolean') throw visualError('VISUAL_ASSET_INVALID_ALPHA', 'alpha invalid', 500);
  if (asset.assetType === 'character' && (asset.hasAlpha !== true || asset.transparentPixel !== true)) {
    throw visualError('VISUAL_ASSET_TRANSPARENCY_REQUIRED', 'persisted character sprite requires transparent pixels', 500);
  }
  assertSafeString(asset.assetContentSha256, 'assetContentSha256', 71, 71, /^sha256:[a-f0-9]{64}$/);
  assertSafeString(asset.contentUri, 'contentUri', 1, 140, /^\/v1\/admin\/assets\/[a-z][a-z0-9_-]{2,79}\/[1-9][0-9]{0,5}\/content$/);
  assertSafeString(asset.thumbnailUri, 'thumbnailUri', 1, 140, /^\/v1\/admin\/assets\/[a-z][a-z0-9_-]{2,79}\/[1-9][0-9]{0,5}\/content$/);
  if (asset.dictionaryVersion !== DICTIONARY_VERSION || asset.dictionaryHash !== DICTIONARY_HASH) throw visualError('VISUAL_ASSET_DICTIONARY_MISMATCH', 'dictionary mismatch', 500);
  if (!ANALYSIS_STATUS_SET.has(asset.analysisStatus) || asset.analysisStatus !== asset.analysis?.status) throw visualError('VISUAL_ANALYSIS_STATUS_MISMATCH', 'analysis status mismatch', 500);
  validateVisualAnalysis(asset.analysis, asset.assetType);
  if (!['draft', 'published'].includes(asset.status)) throw visualError('VISUAL_ASSET_INVALID_STATUS', 'status invalid', 500);
  assertSafeString(asset.createdAt, 'createdAt', 20, 40, /^[0-9TZ:.-]+$/);
  assertSafeString(asset.updatedAt, 'updatedAt', 20, 40, /^[0-9TZ:.-]+$/);
  if (asset.assetMetadataHash !== computeAssetMetadataHash(asset)) throw visualError('VISUAL_ASSET_METADATA_HASH_MISMATCH', 'asset metadata hash mismatch', 500);
  ensureUnknownAssetCoherence(asset);
}

function validateDecodedImage(decoded, metadata) {
  requireExactKeys(decoded, [
    'schemaVersion',
    'decoderId',
    'version',
    'canonicalMime',
    'outputBytes',
    'width',
    'height',
    'hasAlpha',
    'transparentPixel',
    'frames',
    'metadataStripped',
    'hasUnsafeMetadata',
    'compressionRatio',
  ], 'decodedImage');
  if (decoded.schemaVersion !== 'galgame.safe-png-decoder-result.v1' || decoded.decoderId !== 'builtin-png-safe-stripper' || decoded.version !== 1) {
    throw visualError('VISUAL_ASSET_DECODER_UNTRUSTED', 'decoder result is not trusted', 500);
  }
  if (decoded.canonicalMime !== PNG_MIME || !Buffer.isBuffer(decoded.outputBytes)) {
    throw visualError('VISUAL_ASSET_INVALID_MIME', 'decoded mime is invalid', 400);
  }
  const maxDimension = metadata.role === 'background' ? MAX_SCENE_DIMENSION : MAX_SPRITE_ICON_DIMENSION;
  if (!Number.isSafeInteger(decoded.width) || !Number.isSafeInteger(decoded.height) || decoded.width <= 0 || decoded.height <= 0 || decoded.width > maxDimension || decoded.height > maxDimension) {
    throw visualError('VISUAL_ASSET_PIXEL_LIMIT', 'image dimensions exceed role limit', 413);
  }
  if (!Number.isSafeInteger(decoded.width * decoded.height) || decoded.width * decoded.height > MAX_DECODED_PIXELS) {
    throw visualError('VISUAL_ASSET_PIXEL_LIMIT', 'image pixel count exceeds limit', 413);
  }
  if (decoded.frames !== 1) throw visualError('VISUAL_ASSET_ANIMATION_REJECTED', 'animated images are not allowed', 400);
  if (decoded.metadataStripped !== true || decoded.hasUnsafeMetadata !== false) {
    throw visualError('VISUAL_ASSET_METADATA_REJECTED', 'unsafe metadata was not stripped', 400);
  }
  if (typeof decoded.compressionRatio !== 'number' || !Number.isFinite(decoded.compressionRatio) || decoded.compressionRatio > MAX_COMPRESSION_RATIO) {
    throw visualError('VISUAL_ASSET_SIZE_LIMIT', 'compression ratio exceeds limit', 413);
  }
  if (metadata.assetType === 'character' && decoded.transparentPixel !== true) {
    throw visualError('VISUAL_ASSET_TRANSPARENCY_REQUIRED', 'character sprites require transparent pixels', 400);
  }
}

function validateVisualCandidateDecisionInput(input) {
  return collectValidation(() => assertVisualCandidateDecisionInput(input));
}

function validateVisualCandidateDecision(decision) {
  return collectValidation(() => assertVisualCandidateDecision(decision));
}

function validateVisualCandidateDecisionForInput(decision, input, { maxTtlMs = DEFAULT_TTL_MS, unknownCompatibilityReport = null } = {}) {
  return collectValidation(() => {
    assertVisualCandidateDecision(decision);
    assertVisualCandidateDecisionInput(input);
    if (unknownCompatibilityReport !== null) assertUnknownCompatibilityReport(unknownCompatibilityReport);
    assertDecisionMatchesInput(decision, input, { maxTtlMs, unknownCompatibilityReport });
  });
}

function validateCoreVisualCandidateDecisionInput(input) {
  return collectValidation(() => assertCoreVisualCandidateDecisionInput(input));
}

function validateCoreVisualCandidateDecisionForInput(decision, input, { maxTtlMs = DEFAULT_TTL_MS, unknownCompatibilityReport = null } = {}) {
  return collectValidation(() => {
    assertCoreVisualCandidateDecision(decision);
    assertCoreVisualCandidateDecisionInput(input);
    if (unknownCompatibilityReport !== null) assertUnknownCompatibilityReport(unknownCompatibilityReport);
    assertDecisionMatchesInput(decision, input, { maxTtlMs, unknownCompatibilityReport });
  });
}

function validateUnknownCompatibilityReport(report) {
  return collectValidation(() => assertUnknownCompatibilityReport(report));
}

function parseVisualCandidateDecisionInputJson(text) {
  assertJsonText(text, CANDIDATE_DECISION_MAX_INPUT_BYTES, 'candidateDecisionInputJson');
  assertNoDuplicateJsonKeys(text, 'candidateDecisionInputJson');
  const parsed = JSON.parse(text);
  assertVisualCandidateDecisionInput(parsed);
  return parsed;
}

function createUnknownCompatibilityReport({
  sharedUnknownAssets = SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS,
  serviceUnknownAssets = BUILTIN_UNKNOWN_ASSETS,
  catalog = createUnknownCompatibilityCatalog(serviceUnknownAssets),
  servedBytesByType = Object.fromEntries(ENTITY_TYPES.map((type) => [type, TRANSPARENT_PNG_BYTES])),
  now = () => Date.now(),
} = {}) {
  const entries = ENTITY_TYPES.map((type) => {
    const shared = sharedUnknownAssets?.[type] || null;
    const service = serviceUnknownAssets?.[type] || null;
    const servedBytesHash = service && servedBytesByType?.[type] ? sha256Hex(servedBytesByType[type]) : ZERO_SHA256_HEX;
    const serviceContentHash = service?.assetContentSha256 ? stripSha256Prefix(service.assetContentSha256) : '';
    const catalogRef = service ? assetToRef(service) : null;
    const catalogRefHash = catalogRef ? sha256Json(catalogRef) : ZERO_SHA256_DIGEST;
    const mismatchCodes = [];
    if (!service) {
      mismatchCodes.push('missing-service-unknown');
    } else {
      if (shared?.assetId !== service.assetId) mismatchCodes.push('asset-id-mismatch');
      if (shared?.assetVersion !== service.assetVersion) mismatchCodes.push('asset-version-mismatch');
      if (shared?.type !== service.assetType) mismatchCodes.push('type-mismatch');
      if (shared?.assetContentSha256 !== serviceContentHash) mismatchCodes.push('content-hash-mismatch');
      if (servedBytesHash !== serviceContentHash) mismatchCodes.push('served-hash-mismatch');
      if (service.assetMetadataHash !== computeAssetMetadataHash(service)) mismatchCodes.push('metadata-hash-mismatch');
      if (!catalog?.unknownAssetRefs?.some((ref) => ref.assetId === service.assetId && ref.assetVersion === service.assetVersion && ref.assetMetadataHash === service.assetMetadataHash && ref.assetContentSha256 === service.assetContentSha256)) {
        mismatchCodes.push('catalog-ref-mismatch');
      }
    }
    return {
      type,
      sharedAssetId: shared?.assetId || '',
      sharedAssetVersion: shared?.assetVersion || 0,
      sharedAssetContentSha256: shared?.assetContentSha256 || '',
      serviceAssetId: service?.assetId || `unknown_${type}`,
      serviceAssetVersion: service?.assetVersion || 1,
      serviceAssetContentSha256: serviceContentHash || ZERO_SHA256_HEX,
      serviceAssetMetadataHash: service?.assetMetadataHash || ZERO_SHA256_DIGEST,
      catalogRefHash,
      servedBytesSha256: servedBytesHash,
      compatible: mismatchCodes.length === 0,
      mismatchCodes,
    };
  });
  const report = {
    schemaVersion: UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION,
    reportId: createStableId('vuc', {
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
      entries,
    }),
    status: entries.every((entry) => entry.compatible) ? 'compatible' : 'blocked',
    generatedAt: nowIso(now),
    sharedSchemaVersion: 'galgame.visual-system-schema.v1',
    visualAssetServiceVersion: VISUAL_ASSET_SERVICE_VERSION,
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
    entries,
  };
  assertUnknownCompatibilityReport(report);
  return report;
}

function createVisualCandidateAssetInputFromAsset(asset) {
  validateAsset(asset);
  return {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetType: asset.assetType,
    role: asset.role,
    canonicalMime: asset.canonicalMime,
    assetContentSha256: stripSha256Prefix(asset.assetContentSha256),
    assetMetadataHash: asset.assetMetadataHash,
    catalogRefHash: sha256Json(assetToRef(asset)),
    tagCodes: [...asset.tagCodes, ...asset.featureCodes],
    negativeTagCodes: [],
    locale: 'unknown',
  };
}

function createCoreVisualCandidateAssetInputFromAsset(asset) {
  validateAsset(asset);
  return {
    ...createVisualCandidateAssetInputFromAsset(asset),
    analysisStatus: asset.analysis.status,
    analysisTagCodes: [...asset.analysis.tagCodes],
    analysisAttributeCodes: [...asset.analysis.attributeCodes],
    analysisConfidence: asset.analysis.confidence,
  };
}

function createVisualCandidateDecision(input, {
  unknownCompatibilityReport = createUnknownCompatibilityReport(),
  expiresAt = undefined,
  maxTtlMs = DEFAULT_TTL_MS,
} = {}) {
  const inputStatus = validateVisualCandidateDecisionInput(input);
  if (!inputStatus.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_INPUT_INVALID', inputStatus.errors);
  }
  const reportStatus = validateUnknownCompatibilityReport(unknownCompatibilityReport);
  if (!reportStatus.valid) {
    return createDecisionFailure('VISUAL_UNKNOWN_COMPATIBILITY_REPORT_INVALID', reportStatus.errors);
  }
  if (
    unknownCompatibilityReport.catalogId !== input.catalogId
    || unknownCompatibilityReport.catalogRevision !== input.catalogRevision
    || unknownCompatibilityReport.catalogHash !== input.catalogHash
  ) {
    return createDecisionFailure('VISUAL_UNKNOWN_COMPATIBILITY_SCOPE_MISMATCH', ['unknown compatibility report does not match input catalog scope']);
  }

  let candidates;
  try {
    candidates = input.candidates.map((candidate) => normalizeCandidateForDecision(input, candidate, { allowAnalysis: false }));
  } catch (error) {
    return createDecisionFailure(error.code || 'VISUAL_CANDIDATE_ASSET_INVALID', [error.message]);
  }

  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (!eligible.length) {
    return createUnknownOrBlockedDecision(input, unknownCompatibilityReport, ['candidate-empty'], expiresAt, 0, maxTtlMs);
  }

  const ranked = eligible.map((candidate) => scoreCandidate(input, candidate))
    .sort(compareCandidateScores);
  const best = ranked[0];
  if (!best || best.policy.isUnknown || best.policy.score < 20) {
    return createUnknownOrBlockedDecision(input, unknownCompatibilityReport, best?.policy.reasonCodes || ['unknown-fallback'], expiresAt, best?.policy.score || 0, maxTtlMs);
  }

  const decision = createDecisionFromAsset(input, best.candidate, best.policy, expiresAt);
  const decisionStatus = validateVisualCandidateDecisionForInput(decision, input, { maxTtlMs, unknownCompatibilityReport });
  if (!decisionStatus.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_OUTPUT_INVALID', decisionStatus.errors);
  }
  return { ok: true, code: 'VISUAL_CANDIDATE_DECISION_SELECTED', decision, errors: [] };
}

function createCoreVisualCandidateDecision(input, {
  unknownCompatibilityReport = createUnknownCompatibilityReport(),
  expiresAt = undefined,
  maxTtlMs = DEFAULT_TTL_MS,
  runtimeEntity = null,
  visibleContext = null,
  runtimeUnavailable = false,
} = {}) {
  const inputStatus = validateCoreVisualCandidateDecisionInput(input);
  if (!inputStatus.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_INPUT_INVALID', inputStatus.errors);
  }
  const reportStatus = validateUnknownCompatibilityReport(unknownCompatibilityReport);
  if (!reportStatus.valid) {
    return createDecisionFailure('VISUAL_UNKNOWN_COMPATIBILITY_REPORT_INVALID', reportStatus.errors);
  }
  if (
    unknownCompatibilityReport.catalogId !== input.catalogId
    || unknownCompatibilityReport.catalogRevision !== input.catalogRevision
    || unknownCompatibilityReport.catalogHash !== input.catalogHash
  ) {
    return createDecisionFailure('VISUAL_UNKNOWN_COMPATIBILITY_SCOPE_MISMATCH', ['unknown compatibility report does not match input catalog scope']);
  }
  if (runtimeUnavailable) {
    return createCoreUnknownOrBlockedDecision(input, unknownCompatibilityReport, ['candidate-empty'], expiresAt, 0, maxTtlMs);
  }

  let candidates;
  try {
    candidates = input.candidates.map((candidate) => normalizeCandidateForDecision(input, candidate, { allowAnalysis: true }));
  } catch (error) {
    return createDecisionFailure(error.code || 'VISUAL_CANDIDATE_ASSET_INVALID', [error.message]);
  }

  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (!eligible.length) {
    return createCoreUnknownOrBlockedDecision(input, unknownCompatibilityReport, ['candidate-empty'], expiresAt, 0, maxTtlMs);
  }

  const ranked = eligible.map((candidate) => runtimeEntity
    ? scoreRuntimeCandidate(input, candidate, runtimeEntity, visibleContext)
    : scoreCandidate(input, candidate))
    .sort(compareCandidateScores);
  const safeRanked = runtimeEntity
    ? ranked.filter((item) => (item.policy.runtimeTerms?.conflictCodes?.length || 0) === 0)
    : ranked;
  const best = safeRanked[0];
  const threshold = runtimeEntity ? 60 : 20;
  if (!best || best.policy.isUnknown || best.policy.score < threshold) {
    return createCoreUnknownOrBlockedDecision(input, unknownCompatibilityReport, best?.policy.reasonCodes || ['unknown-fallback'], expiresAt, best?.policy.score || 0, maxTtlMs);
  }

  const decision = createDecisionFromAsset(input, best.candidate, best.policy, expiresAt);
  const decisionStatus = validateCoreVisualCandidateDecisionForInput(decision, input, { maxTtlMs, unknownCompatibilityReport });
  if (!decisionStatus.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_OUTPUT_INVALID', decisionStatus.errors);
  }
  return { ok: true, code: 'VISUAL_CANDIDATE_DECISION_SELECTED', decision, errors: [] };
}

function createCoreVisualCandidateDecisionPlan(request, { runtimeHint = null, runtimeMode = false, visibleContext = null } = {}) {
  try {
    assertCoreVisualCandidateDecisionRequest(request);
    const { projection, visualProfile, catalog } = request;
    if (projection.projectionHash !== request.expectedProjectionHash) {
      return createCoreDecisionFailure('VISUAL_CORE_PROJECTION_STALE', ['projection hash does not match expected readback']);
    }
    if (projection.sourceMessageHash !== request.expectedSourceMessageHash) {
      return createCoreDecisionFailure('VISUAL_CORE_SOURCE_STALE', ['source message hash does not match expected readback']);
    }
    if (catalog.status !== 'published') {
      return createCoreDecisionFailure('VISUAL_CORE_CATALOG_NOT_PUBLISHED', ['catalog must be published']);
    }
    if (
      visualProfile.catalogId !== catalog.catalogId
      || visualProfile.catalogRevision !== catalog.catalogRevision
      || visualProfile.catalogHash !== catalog.catalogHash
    ) {
      return createCoreDecisionFailure('VISUAL_CORE_CATALOG_SCOPE_MISMATCH', ['visual profile catalog binding does not match catalog']);
    }
    const assets = createCoreAssetMap(request.assets, catalog);
    const catalogAssetRefs = createCoreCandidateCatalogRefs(catalog);
    const unknownCompatibilityReport = createUnknownCompatibilityReport({ catalog });
    if (unknownCompatibilityReport.status !== 'compatible') {
      return createUnknownCompatibilityBlockedFailure(unknownCompatibilityReport, ['core unknown compatibility blocked']);
    }
    const decisions = [];
    for (const entity of projection.entities) {
      if (entity.entityType === 'unknown') continue;
      const boundAssetId = entity.entityType === 'character'
        ? entity.visibleAttributes.find((attribute) => attribute.code === 'character-visual-binding')?.value || ''
        : '';
      const hasValidBoundAssetId = /^asset_character_[a-z0-9_-]{6,80}$/.test(String(boundAssetId));
      const entityAssetRefs = catalog.assetRefs.filter((ref) => ref.assetType === entity.entityType
        && (!hasValidBoundAssetId || ref.assetId === boundAssetId));
      const runtimeHintReady = !runtimeMode || runtimeHint?.status === 'ready';
      const runtimeEntity = runtimeMode
        ? runtimeHint?.entities?.find((item) => item.entityType === entity.entityType) || {
          entityType: entity.entityType,
          codes: [],
          confidence: 0,
          confidenceBand: 'unknown',
          status: 'unavailable',
        }
        : null;
      const candidates = (runtimeMode && !runtimeHintReady)
        ? []
        : ((runtimeMode || coreEntityAllowsConcreteCandidate(entity))
        ? entityAssetRefs.map((ref) => createCoreVisualCandidateAssetInputFromAsset(assets.get(`${ref.assetId}:${ref.assetVersion}`)))
        : []);
      const input = {
        schemaVersion: CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
        requestId: request.requestId,
        projectionId: projection.projectionId,
        entityKey: entity.entityKey,
        entityType: entity.entityType,
        confidenceBand: entity.confidenceBand,
        visibleAttributeCodes: entity.visibleAttributes.map((attribute) => attribute.code),
        visibleNormalizedCodes: deriveVisibleNormalizedCodes(entity),
        sourceMessageIndex: projection.sourceMessageIndex,
        sourceMessageHash: projection.sourceMessageHash,
        evidenceDigest: projection.projectionHash,
        releaseId: projection.releaseId,
        scenarioId: projection.scenarioId,
        scenarioVersion: projection.scenarioVersion,
        arcId: projection.arcId,
        chatId: projection.chatId,
        visualProfileId: visualProfile.visualProfileId,
        profileHash: visualProfile.profileHash,
        profileCatalogId: visualProfile.catalogId,
        profileCatalogRevision: visualProfile.catalogRevision,
        profileCatalogHash: visualProfile.catalogHash,
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        catalogHash: catalog.catalogHash,
        catalogAssetRefs,
        dictionaryVersion: String(DICTIONARY_VERSION),
        dictionaryHash: DICTIONARY_HASH,
        candidates,
        matcherVersion: runtimeMode ? VISUAL_RUNTIME_MATCHER_VERSION : VISUAL_MATCHER_VERSION,
        scorerVersion: runtimeMode ? VISUAL_RUNTIME_SCORER_VERSION : VISUAL_SCORER_VERSION,
        createdAt: request.createdAt,
      };
      const decisionResult = createCoreVisualCandidateDecision(input, {
        unknownCompatibilityReport,
        runtimeEntity,
        visibleContext: hasValidBoundAssetId ? { ...visibleContext, boundAssetId } : visibleContext,
        runtimeUnavailable: runtimeMode && !runtimeHintReady,
      });
      if (!decisionResult.ok) {
        return {
          ok: false,
          code: decisionResult.code,
          errors: decisionResult.errors,
          entityKey: entity.entityKey,
          decisions: [],
          unknownCompatibilityReport: decisionResult.unknownCompatibilityReport || unknownCompatibilityReport,
        };
      }
      decisions.push(decisionResult.decision);
    }
    return {
      ok: true,
      schemaVersion: VISUAL_CORE_CANDIDATE_DECISION_PLAN_VERSION,
      matcherVersion: runtimeMode ? VISUAL_RUNTIME_MATCHER_VERSION : VISUAL_MATCHER_VERSION,
      scorerVersion: runtimeMode ? VISUAL_RUNTIME_SCORER_VERSION : VISUAL_SCORER_VERSION,
      usesLlm: false,
      projectionId: projection.projectionId,
      projectionHash: projection.projectionHash,
      sourceMessageIndex: projection.sourceMessageIndex,
      sourceMessageHash: projection.sourceMessageHash,
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
      decisions,
      unknownCompatibilityReport,
    };
  } catch (error) {
    return createCoreDecisionFailure(error.code || 'VISUAL_CORE_DECISION_INPUT_INVALID', [error.message || 'core matcher input invalid']);
  }
}

function createCoreDecisionFailure(code, errors = []) {
  return { ok: false, code, errors, decisions: [] };
}

function createCoreUnknownOrBlockedDecision(input, report, reasonCodes, expiresAt, score = 0, maxTtlMs = DEFAULT_TTL_MS) {
  if (report.status === 'blocked') {
    return createUnknownCompatibilityBlockedFailure(report, reasonCodes);
  }
  const entry = report.entries.find((item) => item.type === input.entityType);
  if (!entry?.compatible) {
    return createUnknownCompatibilityBlockedFailure(report, ['unknown compatibility entry missing']);
  }
  const sharedUnknown = SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS[input.entityType];
  const decision = createDecisionFromAsset(input, {
    assetId: sharedUnknown.assetId,
    assetVersion: sharedUnknown.assetVersion,
    assetType: input.entityType,
    role: ROLE_BY_TYPE[input.entityType],
    canonicalMime: PNG_MIME,
    assetContentSha256: sharedUnknown.assetContentSha256,
    assetMetadataHash: entry.serviceAssetMetadataHash,
    catalogRefHash: entry.catalogRefHash,
    tagCodes: [],
    negativeTagCodes: [],
    featureCodes: [],
    locale: 'unknown',
  }, {
    score,
    reasonCodes: uniqueReasonCodes(reasonCodes),
  }, expiresAt);
  const decisionStatus = validateCoreVisualCandidateDecisionForInput(decision, input, { maxTtlMs, unknownCompatibilityReport: report });
  if (!decisionStatus.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_OUTPUT_INVALID', decisionStatus.errors);
  }
  return { ok: true, code: 'VISUAL_CANDIDATE_DECISION_UNKNOWN', decision, errors: [] };
}

function coreEntityAllowsConcreteCandidate(entity) {
  if (entity.entityType !== 'character') return true;
  const visibleCodes = new Set(entity.visibleAttributes.map((attribute) => attribute.code));
  return [
    'character-explicit-appearance',
    'character-explicit-clothing',
    'character-explicit-species',
    'character-explicit-gender-presentation',
  ].some((code) => visibleCodes.has(code));
}

function createUnknownOrBlockedDecision(input, report, reasonCodes, expiresAt, score = 0, maxTtlMs = DEFAULT_TTL_MS) {
  if (report.status === 'blocked') {
    return createUnknownCompatibilityBlockedFailure(report, reasonCodes);
  }
  const entry = report.entries.find((item) => item.type === input.entityType);
  if (!entry?.compatible) {
    return createUnknownCompatibilityBlockedFailure(report, ['unknown compatibility entry missing']);
  }
  const sharedUnknown = SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS[input.entityType];
  const decision = createDecisionFromAsset(input, {
    assetId: sharedUnknown.assetId,
    assetVersion: sharedUnknown.assetVersion,
    assetType: input.entityType,
    role: ROLE_BY_TYPE[input.entityType],
    canonicalMime: PNG_MIME,
    assetContentSha256: sharedUnknown.assetContentSha256,
    assetMetadataHash: entry.serviceAssetMetadataHash,
    catalogRefHash: entry.catalogRefHash,
    tagCodes: [],
    negativeTagCodes: [],
    locale: 'unknown',
    eligible: true,
    negativeConflictCount: 0,
  }, {
    score,
    reasonCodes: uniqueReasonCodes([...reasonCodes, 'unknown-fallback']),
  }, expiresAt);
  const status = validateVisualCandidateDecisionForInput(decision, input, { maxTtlMs, unknownCompatibilityReport: report });
  if (!status.valid) {
    return createDecisionFailure('VISUAL_CANDIDATE_DECISION_OUTPUT_INVALID', status.errors);
  }
  return { ok: true, code: 'VISUAL_CANDIDATE_DECISION_UNKNOWN', decision, errors: [] };
}

function createUnknownCompatibilityBlockedFailure(report, reasons = []) {
  return {
    ok: false,
    code: 'VISUAL_UNKNOWN_COMPATIBILITY_BLOCKED',
    errors: ['unknown visual assets are not compatible', ...reasons],
    unknownCompatibilityReport: report,
  };
}

function createDecisionFailure(code, errors = []) {
  return { ok: false, code, errors, decision: null };
}

function normalizeCandidateForDecision(input, candidate, { allowAnalysis = false } = {}) {
  assertCandidateAssetInput(candidate, 'candidate', { allowAnalysis });
  const ref = findCatalogAssetRef(input.catalogAssetRefs, candidate.assetId, candidate.assetVersion);
  if (!ref) {
    throw visualError('VISUAL_CANDIDATE_CATALOG_REF_MISSING', 'candidate is not present in trusted catalog refs', 400);
  }
  const expectedRefHash = sha256Json({
    assetId: ref.assetId,
    assetVersion: ref.assetVersion,
    assetType: ref.assetType,
    assetContentSha256: ref.assetContentSha256,
    assetMetadataHash: ref.assetMetadataHash,
  });
  if (
    ref.assetType !== candidate.assetType
    || stripSha256Prefix(ref.assetContentSha256) !== candidate.assetContentSha256
    || ref.assetMetadataHash !== candidate.assetMetadataHash
    || ref.catalogRefHash !== candidate.catalogRefHash
    || expectedRefHash !== candidate.catalogRefHash
  ) {
    throw visualError('VISUAL_CANDIDATE_CATALOG_REF_MISMATCH', 'candidate does not match trusted catalog ref', 400);
  }
  return {
    ...candidate,
    eligible: candidate.assetType === input.entityType && candidate.role === ROLE_BY_TYPE[input.entityType] && candidate.canonicalMime === PNG_MIME,
    negativeConflictCount: countNegativeConflicts(input, candidate),
    analysisOverlapCount: allowAnalysis && candidate.analysisStatus === 'ready'
      ? countExactAnalysisOverlap(input, candidate)
      : 0,
  };
}

function countExactAnalysisOverlap(input, candidate) {
  const visible = new Set(input.visibleNormalizedCodes || []);
  const analysisCodes = new Set([...(candidate.analysisTagCodes || []), ...(candidate.analysisAttributeCodes || [])]);
  let count = 0;
  for (const code of analysisCodes) if (visible.has(code)) count += 1;
  return count;
}

function findCatalogAssetRef(refs, assetId, assetVersion) {
  return refs.find((ref) => ref.assetId === assetId && ref.assetVersion === assetVersion) || null;
}

function scoreCandidate(input, candidate) {
  const reasonCodes = ['type-match'];
  let score = 25;
  const visibleCodes = new Set(input.visibleAttributeCodes);
  const requiresAnalysisMatch = Object.hasOwn(candidate, 'analysisStatus');
  const analysisUnavailable = requiresAnalysisMatch && candidate.analysisStatus !== 'ready';
  const analysisHasNoOverlap = requiresAnalysisMatch && candidate.analysisStatus === 'ready' && candidate.analysisOverlapCount === 0;
  if (candidate.locale !== 'unknown') {
    score += 5;
    reasonCodes.push('locale-match');
  }
  if (candidate.tagCodes.some((code) => code.startsWith(`${candidate.assetType}.`) || code.startsWith(`feature.`))) {
    score += 15;
    reasonCodes.push('tag-overlap');
  }
  if (requiresAnalysisMatch) {
    if (analysisUnavailable) {
      score = 0;
      reasonCodes.push('dictionary-unavailable');
    } else if (!analysisHasNoOverlap) {
      score += Math.min(55, candidate.analysisOverlapCount * 35);
      reasonCodes.push('tag-overlap');
    } else {
      score = 0;
      reasonCodes.push('unknown-fallback');
    }
  }
  if (candidate.negativeConflictCount > 0) {
    score = Math.max(0, score - candidate.negativeConflictCount * 20);
    reasonCodes.push('negative-tag-conflict');
  }
  if (input.entityType === 'character') {
    const hasIdentity = visibleCodes.has('character-explicit-name');
    const hasAppearance = ['character-explicit-appearance', 'character-explicit-clothing', 'character-explicit-species', 'character-explicit-gender-presentation']
      .some((code) => visibleCodes.has(code));
    if (!requiresAnalysisMatch || (!analysisUnavailable && !analysisHasNoOverlap)) {
      if (hasIdentity) {
      score += 15;
      reasonCodes.push('explicit-visible-label');
      }
      if (hasAppearance) {
      score += 35;
      reasonCodes.push('explicit-appearance');
      }
    }
    const policy = applyVisualScorePolicy({
      type: input.entityType,
      score: Math.min(score, 100),
      confidenceBand: input.confidenceBand,
      candidateCount: input.candidates.length,
      hasExplicitVisibleLabel: hasIdentity,
      hasExplicitAppearanceEvidence: hasAppearance,
      reasonCodes: uniqueReasonCodes(reasonCodes),
    });
    if (!policy.ok) {
      throw visualError('VISUAL_CANDIDATE_SCORE_INVALID', policy.errors.join('; '), 500);
    }
    return { candidate, policy };
  }
  const explicitLabelCode = `${input.entityType}-visible-label`;
  const hasExplicitVisibleLabel = input.entityType === 'scene'
    ? input.visibleAttributeCodes.some((code) => code.startsWith('scene-'))
    : visibleCodes.has(explicitLabelCode);
  if (hasExplicitVisibleLabel && (!requiresAnalysisMatch || (!analysisUnavailable && !analysisHasNoOverlap))) {
    score += 45;
    reasonCodes.push('explicit-visible-label');
  }
  if (input.entityType === 'scene' && input.confidenceBand !== 'explicit') {
    reasonCodes.push('scene-ambiguous-low-confidence');
  }
  const policy = applyVisualScorePolicy({
    type: input.entityType,
    score: Math.min(score, 100),
    confidenceBand: input.confidenceBand,
    candidateCount: input.candidates.length,
    hasExplicitVisibleLabel,
    hasExplicitAppearanceEvidence: false,
    reasonCodes: uniqueReasonCodes(reasonCodes),
  });
  if (!policy.ok) {
    throw visualError('VISUAL_CANDIDATE_SCORE_INVALID', policy.errors.join('; '), 500);
  }
  return { candidate, policy };
}

const RUNTIME_GENERIC_PARENT_CODES = new Set([
  'scene.interior',
  'scene.exterior',
  'character.humanoid',
  'equipment.common',
  'item.misc',
  'skill.magic',
]);
const RUNTIME_CHARACTER_IDENTITY_CODES = new Set(['character-explicit-name']);
const RUNTIME_CHARACTER_APPEARANCE_CODES = new Set([
  'character-explicit-appearance',
  'character-explicit-clothing',
  'character-explicit-species',
  'character-explicit-gender-presentation',
]);

function scoreRuntimeCandidate(input, candidate, runtimeEntity, visibleContext = null) {
  const boundAssetId = input.entityType === 'character' && /^asset_character_[a-z0-9_-]{6,80}$/.test(String(visibleContext?.boundAssetId || ''))
    ? String(visibleContext.boundAssetId)
    : '';
  if (boundAssetId) {
    const matchesBinding = candidate.assetId === boundAssetId;
    return {
      candidate,
      policy: {
        score: matchesBinding ? 100 : 0,
        isUnknown: !matchesBinding,
        reasonCodes: matchesBinding ? ['type-match', 'explicit-visible-label'] : ['type-match', 'unknown-fallback'],
        runtimeTerms: {
          runtimeCodes: [...(runtimeEntity?.codes || [])],
          analysisCodes: [...new Set([...(candidate.analysisTagCodes || []), ...(candidate.analysisAttributeCodes || [])])],
          visibleCodes: [...new Set(input.visibleAttributeCodes || [])],
          negativeCodes: [],
          overlapCodes: [],
          genericOverlapCodes: [],
          specificOverlapCodes: [],
          conflictCodes: [],
          core: matchesBinding ? 100 : 0,
          typeIdentity: matchesBinding ? 25 : 0,
          attributeState: matchesBinding ? 20 : 0,
          recentContinuity: 0,
          confidence: matchesBinding ? 5 : 0,
          rawScore: matchesBinding ? 100 : 0,
          capped: false,
        },
      },
    };
  }
  // Status labels are already visible to the player and are normalized by the
  // trusted projection. Prefer those deterministic codes for a labeled entity;
  // use provider codes only when the visible label has no normalized evidence.
  const normalizedVisibleCodes = new Set(input.visibleNormalizedCodes || []);
  const runtimeCodes = normalizedVisibleCodes.size > 0
    ? normalizedVisibleCodes
    : new Set(runtimeEntity?.codes || []);
  const analysisCodes = new Set([...(candidate.analysisTagCodes || []), ...(candidate.analysisAttributeCodes || [])]);
  const visibleCodes = new Set(input.visibleAttributeCodes || []);
  const explicitLabelCode = `${input.entityType}-visible-label`;
  const hasExplicitVisibleLabel = input.entityType === 'scene'
    ? [...visibleCodes].some((code) => code.startsWith('scene-'))
    : visibleCodes.has(explicitLabelCode);
  const deterministicVisibleCodes = new Set([...normalizedVisibleCodes].filter((code) => (
    code.startsWith(`${input.entityType}.`)
      && !RUNTIME_GENERIC_PARENT_CODES.has(code)
  )));
  const hasDeterministicVisibleEvidence = hasExplicitVisibleLabel && deterministicVisibleCodes.size > 0;
  // Asset manifests carry curated visible tags in addition to provider analysis.
  // When the player sees an explicit status label, those trusted tags are valid
  // deterministic evidence even if the provider analysis omitted the exact term.
  if (hasExplicitVisibleLabel) {
    for (const code of candidate.tagCodes || []) {
      analysisCodes.add(code);
    }
  }
  const negativeCodes = new Set(candidate.negativeTagCodes || []);
  const intersection = new Set([...runtimeCodes].filter((code) => analysisCodes.has(code)));
  const genericOverlap = new Set([...intersection].filter((code) => RUNTIME_GENERIC_PARENT_CODES.has(code)));
  const specificOverlap = new Set([...intersection].filter((code) => !RUNTIME_GENERIC_PARENT_CODES.has(code)));
  const conflicts = new Set([...runtimeCodes].filter((code) => negativeCodes.has(code)));
  const runtimeSpecificCodes = new Set([...runtimeCodes].filter((code) => !RUNTIME_GENERIC_PARENT_CODES.has(code)));
  const core = Math.round(40 * Math.min(1, specificOverlap.size / Math.max(1, runtimeSpecificCodes.size)))
    + Math.min(10, 10 * genericOverlap.size);
  const typeIdentity = runtimeEntity?.entityType === candidate.assetType ? 25 : 0;
  const attributeCodes = new Set(candidate.analysisAttributeCodes || []);
  const visibleOrRuntime = new Set([...visibleCodes, ...runtimeCodes]);
  const attributeState = Math.round(20 * Math.min(1, [...visibleOrRuntime].filter((code) => attributeCodes.has(code)).length / Math.max(1, visibleOrRuntime.size)));
  const recentContinuity = Array.isArray(visibleContext?.recent) && visibleContext.recent.length > 0 && intersection.size > 0 ? 10 : 0;
  const confidence = candidate.analysisStatus === 'ready'
    ? Math.round(5 * Math.min(Number(runtimeEntity?.confidence) || 0, Number(candidate.analysisConfidence) || 0))
    : 0;
  const rawScore = core + typeIdentity + attributeState + recentContinuity + confidence - Math.min(20, 10 * conflicts.size);
  let score = Math.max(0, Math.min(100, rawScore));
  const hasIdentity = [...RUNTIME_CHARACTER_IDENTITY_CODES].some((code) => visibleCodes.has(code));
  const hasAppearance = [...RUNTIME_CHARACTER_APPEARANCE_CODES].some((code) => visibleCodes.has(code));
  const capped = !hasDeterministicVisibleEvidence && (
    runtimeEntity?.confidence < 0.60
      || ['ambiguous', 'unknown'].includes(runtimeEntity?.confidenceBand)
      || specificOverlap.size === 0
      || candidate.analysisStatus !== 'ready'
      || (input.entityType === 'character' && (!hasIdentity || !hasAppearance))
  );
  if (capped) score = Math.min(score, 59);
  if (candidate.analysisStatus !== 'ready') score = 0;
  const reasonCodes = ['type-match'];
  if (specificOverlap.size > 0 || genericOverlap.size > 0) reasonCodes.push('tag-overlap');
  if (attributeState > 0) reasonCodes.push('explicit-visible-label');
  if (conflicts.size > 0) reasonCodes.push('negative-tag-conflict');
  if (capped) reasonCodes.push('ambiguous-appearance-capped');
  if (candidate.analysisStatus !== 'ready') reasonCodes.push('dictionary-unavailable');
  if (score < 60) reasonCodes.push('unknown-fallback');
  return {
    candidate,
    policy: {
      score,
      isUnknown: conflicts.size > 0 || score < 60,
      reasonCodes: uniqueReasonCodes(reasonCodes),
      runtimeTerms: {
        runtimeCodes: [...runtimeCodes],
        analysisCodes: [...analysisCodes],
        visibleCodes: [...visibleCodes],
        negativeCodes: [...negativeCodes],
        overlapCodes: [...intersection],
        genericOverlapCodes: [...genericOverlap],
        specificOverlapCodes: [...specificOverlap],
        conflictCodes: [...conflicts],
        core,
        typeIdentity,
        attributeState,
        recentContinuity,
        confidence,
        rawScore,
        capped,
      },
    },
  };
}

function compareCandidateScores(left, right) {
  if (right.policy.score !== left.policy.score) return right.policy.score - left.policy.score;
  if (left.policy.runtimeTerms || right.policy.runtimeTerms) {
    const leftConflicts = left.policy.runtimeTerms?.conflictCodes?.length || 0;
    const rightConflicts = right.policy.runtimeTerms?.conflictCodes?.length || 0;
    if (leftConflicts !== rightConflicts) return leftConflicts - rightConflicts;
    const leftConfidence = Number(left.candidate.analysisConfidence) || 0;
    const rightConfidence = Number(right.candidate.analysisConfidence) || 0;
    if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
    if (left.candidate.assetVersion !== right.candidate.assetVersion) return left.candidate.assetVersion - right.candidate.assetVersion;
    return left.candidate.assetId.localeCompare(right.candidate.assetId);
  }
  if ((right.candidate.analysisOverlapCount || 0) !== (left.candidate.analysisOverlapCount || 0)) return (right.candidate.analysisOverlapCount || 0) - (left.candidate.analysisOverlapCount || 0);
  if (left.candidate.negativeConflictCount !== right.candidate.negativeConflictCount) return left.candidate.negativeConflictCount - right.candidate.negativeConflictCount;
  if (left.candidate.assetVersion !== right.candidate.assetVersion) return left.candidate.assetVersion - right.candidate.assetVersion;
  return left.candidate.assetId.localeCompare(right.candidate.assetId);
}

function createDecisionFromAsset(input, candidate, policy, expiresAt) {
  const score = policy.score;
  const decision = {
    schemaVersion: CANDIDATE_DECISION_SCHEMA_VERSION,
    decisionId: createStableId('vcd', {
      projectionId: input.projectionId,
      entityKey: input.entityKey,
      assetId: candidate.assetId,
      assetVersion: candidate.assetVersion,
      score,
      reasonCodes: policy.reasonCodes,
    }),
    entityKey: input.entityKey,
    entityType: input.entityType,
    projectionId: input.projectionId,
    sourceMessageIndex: input.sourceMessageIndex,
    sourceMessageHash: input.sourceMessageHash,
    evidenceDigest: input.evidenceDigest,
    visualProfileId: input.visualProfileId,
    profileHash: input.profileHash,
    catalogId: input.catalogId,
    catalogRevision: input.catalogRevision,
    catalogHash: input.catalogHash,
    dictionaryVersion: input.dictionaryVersion,
    dictionaryHash: input.dictionaryHash,
    assetId: candidate.assetId,
    assetVersion: candidate.assetVersion,
    assetContentSha256: candidate.assetContentSha256,
    assetMetadataHash: candidate.assetMetadataHash,
    score,
    scoreBand: scoreToBand(score),
    reasonCodes: uniqueReasonCodes(policy.reasonCodes),
    matcherVersion: input.matcherVersion,
    scorerVersion: input.scorerVersion,
    usesLlm: false,
    createdAt: input.createdAt,
  };
  if (expiresAt !== undefined) {
    decision.expiresAt = expiresAt;
  }
  return decision;
}

function createUnknownCompatibilityCatalog(serviceUnknownAssets = BUILTIN_UNKNOWN_ASSETS) {
  const catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogId: UNKNOWN_CATALOG_ID,
    catalogRevision: UNKNOWN_CATALOG_REVISION,
    status: 'published',
    assetRefs: [],
    unknownAssetRefs: ENTITY_TYPES
      .map((type) => serviceUnknownAssets?.[type])
      .filter(Boolean)
      .map((asset) => assetToRef(asset)),
    dictionaryVersion: DICTIONARY_VERSION,
    dictionaryHash: DICTIONARY_HASH,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    publishedAt: FIXED_TIME,
    archivedAt: null,
  };
  catalog.catalogHash = computeCatalogHash(catalog);
  return catalog;
}

function assertCoreVisualCandidateDecisionRequest(request) {
  requireExactKeys(request, [
    'schemaVersion',
    'requestId',
    'projection',
    'visualProfile',
    'catalog',
    'assets',
    'expectedProjectionHash',
    'expectedSourceMessageHash',
    'createdAt',
  ], 'coreCandidateDecisionRequest');
  if (request.schemaVersion !== VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION) throw visualError('VISUAL_CORE_INVALID_SCHEMA', 'core matcher request schema invalid', 400);
  assertSafeString(request.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertCoreProjection(request.projection);
  assertCoreVisualProfile(request.visualProfile);
  validateCatalog(request.catalog);
  if (!Array.isArray(request.assets) || request.assets.length > 512) throw visualError('VISUAL_CORE_ASSET_SNAPSHOT_INVALID', 'assets invalid', 400);
  for (const [index, asset] of request.assets.entries()) {
    validateAsset(asset);
    if (asset.assetId.startsWith('unknown_')) throw visualError('VISUAL_CORE_ASSET_SNAPSHOT_INVALID', `assets[${index}] must not include immutable unknown assets`, 400);
  }
  assertSha256Digest(request.expectedProjectionHash, 'expectedProjectionHash');
  assertSha256Digest(request.expectedSourceMessageHash, 'expectedSourceMessageHash');
  assertIsoTimestamp(request.createdAt, 'createdAt');
}

function requireCoreDecisionRouteRequest(request) {
  if (request?.schemaVersion === VISUAL_RUNTIME_DECISION_REQUEST_VERSION) {
    return requireRuntimeDecisionRouteRequest(request);
  }
  requireExactKeys(request, VISUAL_CORE_DECISION_ROUTE_REQUEST_KEYS, 'coreVisualDecisionRequest');
  if (request.schemaVersion !== VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION) throw visualError('VISUAL_CORE_INVALID_SCHEMA', 'core visual decision request schema invalid', 400);
  assertSafeString(request.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertCoreProjection(request.projection);
  try {
    assertCoreVisualProfile(request.visualProfile);
  } catch (error) {
    throw visualError('VISUAL_CORE_PROFILE_MISMATCH', 'visual profile is not a valid global display profile', 400, { causeCode: error.code || 'VISUAL_CORE_PROFILE_INVALID' });
  }
  assertSha256Digest(request.expectedProjectionHash, 'expectedProjectionHash');
  assertSha256Digest(request.expectedSourceMessageHash, 'expectedSourceMessageHash');
  assertIsoTimestamp(request.createdAt, 'createdAt');
  return request;
}

function requireRuntimeDecisionRouteRequest(request) {
  requireExactKeys(request, VISUAL_RUNTIME_REQUEST_KEYS, 'runtimeVisualDecisionRequest');
  if (request.schemaVersion !== VISUAL_RUNTIME_DECISION_REQUEST_VERSION) {
    throw visualError('VISUAL_REQUEST_INVALID', 'runtime visual decision request schema invalid', 400);
  }
  assertSafeString(request.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertCoreProjection(request.projection);
  try {
    assertCoreVisualProfile(request.visualProfile);
  } catch (error) {
    throw visualError('VISUAL_PROFILE_INVALID', 'visual profile is invalid', 400, { causeCode: error.code || 'VISUAL_CORE_PROFILE_INVALID' });
  }
  const visibleContext = assertRuntimeVisibleContext(request.visibleContext);
  assertSha256Digest(request.expectedProjectionHash, 'expectedProjectionHash');
  assertSha256Digest(request.expectedSourceMessageHash, 'expectedSourceMessageHash');
  assertIsoTimestamp(request.createdAt, 'createdAt');
  if (request.projection.sourceMessageIndex !== visibleContext.current.index) {
    throw visualError('VISUAL_CONTEXT_INVALID', 'visible context index does not match projection', 400);
  }
  if (request.projection.sourceMessageHash !== visibleContext.currentHash) {
    throw visualError('VISUAL_SOURCE_HASH_MISMATCH', 'visible context source hash does not match projection', 400);
  }
  if (request.expectedSourceMessageHash !== visibleContext.currentHash) {
    throw visualError('VISUAL_SOURCE_HASH_MISMATCH', 'visible context source hash does not match expected hash', 400);
  }
  if (request.expectedProjectionHash !== request.projection.projectionHash) {
    throw visualError('VISUAL_PROJECTION_HASH_MISMATCH', 'projection hash does not match expected hash', 400);
  }
  return { ...request, visibleContext: visibleContext };
}

function assertCoreProjection(projection) {
  requireExactKeys(projection, [
    'projectionId',
    'projectionHash',
    'sourceMessageIndex',
    'sourceMessageHash',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    'entities',
  ], 'coreProjection');
  assertSafeString(projection.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertSha256Digest(projection.projectionHash, 'projectionHash');
  assertNonNegativeInteger(projection.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(projection.sourceMessageHash, 'sourceMessageHash');
  assertGenericId(projection.releaseId, 'releaseId');
  assertGenericId(projection.scenarioId, 'scenarioId');
  assertVersionId(projection.scenarioVersion, 'scenarioVersion');
  assertGenericId(projection.arcId, 'arcId');
  assertGenericId(projection.chatId, 'chatId');
  if (!Array.isArray(projection.entities) || projection.entities.length > 32) throw visualError('VISUAL_CORE_PROJECTION_INVALID', 'projection entities invalid', 400);
  const seen = new Set();
  for (const [index, entity] of projection.entities.entries()) {
    assertCoreProjectedEntity(entity, `projection.entities[${index}]`);
    if (seen.has(entity.entityKey)) throw visualError('VISUAL_CORE_PROJECTION_DUPLICATE_ENTITY', 'projection entity duplicated', 400);
    seen.add(entity.entityKey);
  }
}

function createCoreContentPath(catalogId, catalogRevision, assetId, assetVersion) {
  return `/v1/core/catalogs/${encodeURIComponent(catalogId)}/${encodeURIComponent(String(catalogRevision))}/assets/${encodeURIComponent(assetId)}/${encodeURIComponent(String(assetVersion))}/content`;
}

function assertCoreProjectedEntity(entity, label) {
  requireExactKeys(entity, ['entityKey', 'entityType', 'displayLabel', 'visibleAttributes', 'confidenceBand'], label);
  if (![...ENTITY_TYPES, 'unknown'].includes(entity.entityType)) throw visualError('VISUAL_CORE_ENTITY_TYPE_INVALID', `${label}.entityType invalid`, 400);
  assertSafeString(entity.entityKey, `${label}.entityKey`, 15, 96, /^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$/);
  if (!entity.entityKey.startsWith(`entity_${entity.entityType}_`)) throw visualError('VISUAL_CORE_ENTITY_SCOPE_MISMATCH', `${label}.entityKey/entityType mismatch`, 400);
  assertSafeString(entity.displayLabel, `${label}.displayLabel`, 1, 80, /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
  if (!SHARED_CONFIDENCE_BAND_SET.has(entity.confidenceBand)) throw visualError('VISUAL_CORE_ENTITY_CONFIDENCE_INVALID', `${label}.confidenceBand invalid`, 400);
  if (!Array.isArray(entity.visibleAttributes) || entity.visibleAttributes.length > 32) throw visualError('VISUAL_CORE_ENTITY_ATTRIBUTES_INVALID', `${label}.visibleAttributes invalid`, 400);
  const seen = new Set();
  for (const [index, attribute] of entity.visibleAttributes.entries()) {
    requireExactKeys(attribute, ['code', 'value', 'confidenceBand'], `${label}.visibleAttributes[${index}]`);
    assertSharedCodeArray([attribute.code], SHARED_ATTRIBUTE_CODE_SET, `${label}.visibleAttributes[${index}].code`, 1, 1);
    assertSafeString(attribute.value, `${label}.visibleAttributes[${index}].value`, 1, 120, /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u);
    if (!SHARED_CONFIDENCE_BAND_SET.has(attribute.confidenceBand)) throw visualError('VISUAL_CORE_ENTITY_ATTRIBUTES_INVALID', `${label}.visibleAttributes[${index}].confidenceBand invalid`, 400);
    if (seen.has(attribute.code)) throw visualError('VISUAL_CORE_ENTITY_ATTRIBUTES_INVALID', `${label}.visibleAttributes duplicate code`, 400);
    seen.add(attribute.code);
  }
}

function assertCoreVisualProfile(profile) {
  requireExactKeys(profile, ['visualProfileId', 'profileHash', 'catalogId', 'catalogRevision', 'catalogHash'], 'coreVisualProfile');
  assertSafeString(profile.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(profile.profileHash, 'profileHash');
  assertSafeString(profile.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(profile.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(profile.catalogHash, 'catalogHash');
}

function createGlobalDisplayVisualProfile(activeCatalog) {
  requireExactKeys(activeCatalog, ['catalogId', 'catalogRevision', 'catalogHash'], 'activeCatalog');
  assertSafeString(activeCatalog.catalogId, 'activeCatalog.catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(activeCatalog.catalogRevision, 'activeCatalog.catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(activeCatalog.catalogHash, 'activeCatalog.catalogHash');
  const profileSeed = {
    profileKind: 'global-display-v1',
    source: 'visual-control',
    sourceVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    catalogId: activeCatalog.catalogId,
    catalogRevision: activeCatalog.catalogRevision,
    catalogHash: activeCatalog.catalogHash,
  };
  const visualProfileId = `vprof_${sha256Hex(Buffer.from(canonicalJson(profileSeed), 'utf8')).slice(0, 32)}`;
  const profile = {
    visualProfileId,
    profileHash: sha256Json({ ...profileSeed, visualProfileId }),
    catalogId: activeCatalog.catalogId,
    catalogRevision: activeCatalog.catalogRevision,
    catalogHash: activeCatalog.catalogHash,
  };
  assertCoreVisualProfile(profile);
  return profile;
}

function coreVisualProfileMatches(expected, actual) {
  return VISUAL_CORE_CONTEXT_PROFILE_FIELDS.every((field) => expected?.[field] === actual?.[field]);
}

function assertCoreVisualCandidateDecisionInput(input) {
  requireExactKeys(input, [...CANDIDATE_DECISION_INPUT_KEYS, 'visibleNormalizedCodes'], 'coreCandidateDecisionInput');
  if (input.schemaVersion !== CANDIDATE_DECISION_INPUT_SCHEMA_VERSION) throw visualError('VISUAL_CANDIDATE_DECISION_INVALID_SCHEMA', 'candidate input schema invalid', 400);
  assertSafeString(input.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertSafeString(input.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertEntityKey(input.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(input.entityType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', 'entityType invalid', 400);
  if (!input.entityKey.startsWith(`entity_${input.entityType}_`)) throw visualError('VISUAL_CANDIDATE_SCOPE_MISMATCH', 'entityKey/entityType mismatch', 400);
  if (!SHARED_CONFIDENCE_BAND_SET.has(input.confidenceBand)) throw visualError('VISUAL_CANDIDATE_INVALID_CONFIDENCE', 'confidenceBand invalid', 400);
  assertSharedCodeArray(input.visibleAttributeCodes, SHARED_ATTRIBUTE_CODE_SET, 'visibleAttributeCodes', 32);
  assertDictionaryCodeArray(input.visibleNormalizedCodes, 'visibleNormalizedCodes', 32);
  assertNonNegativeInteger(input.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(input.sourceMessageHash, 'sourceMessageHash');
  assertSha256Digest(input.evidenceDigest, 'evidenceDigest');
  assertGenericId(input.releaseId, 'releaseId');
  assertGenericId(input.scenarioId, 'scenarioId');
  assertVersionId(input.scenarioVersion, 'scenarioVersion');
  assertGenericId(input.arcId, 'arcId');
  assertGenericId(input.chatId, 'chatId');
  assertSafeString(input.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(input.profileHash, 'profileHash');
  assertSafeString(input.profileCatalogId, 'profileCatalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(input.profileCatalogRevision, 'profileCatalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(input.profileCatalogHash, 'profileCatalogHash');
  assertSafeString(input.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(input.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(input.catalogHash, 'catalogHash');
  if (input.profileCatalogId !== input.catalogId || input.profileCatalogRevision !== input.catalogRevision || input.profileCatalogHash !== input.catalogHash) {
    throw visualError('VISUAL_CANDIDATE_PROFILE_CATALOG_MISMATCH', 'profile catalog binding does not match candidate catalog scope', 400);
  }
  assertCandidateCatalogRefs(input.catalogAssetRefs, 'catalogAssetRefs');
  assertVersionId(input.dictionaryVersion, 'dictionaryVersion');
  if (input.dictionaryVersion !== String(DICTIONARY_VERSION)) throw visualError('VISUAL_CANDIDATE_DICTIONARY_MISMATCH', 'dictionaryVersion mismatch', 400);
  assertSha256Digest(input.dictionaryHash, 'dictionaryHash');
  if (input.dictionaryHash !== DICTIONARY_HASH) throw visualError('VISUAL_CANDIDATE_DICTIONARY_MISMATCH', 'dictionaryHash mismatch', 400);
  if (!Array.isArray(input.candidates) || input.candidates.length > 128) throw visualError('VISUAL_CANDIDATE_INVALID_ARRAY', 'candidates invalid', 400);
  const seen = new Set();
  for (const [index, candidate] of input.candidates.entries()) {
    assertCandidateAssetInput(candidate, `candidates[${index}]`, { allowAnalysis: true });
    const key = `${candidate.assetId}:${candidate.assetVersion}`;
    if (seen.has(key)) throw visualError('VISUAL_CANDIDATE_DUPLICATE', 'candidate asset duplicated', 400);
    seen.add(key);
  }
  assertVersionId(input.matcherVersion, 'matcherVersion');
  assertVersionId(input.scorerVersion, 'scorerVersion');
  assertIsoTimestamp(input.createdAt, 'createdAt');
}

function assertCoreVisualCandidateDecision(decision) {
  const required = CANDIDATE_DECISION_KEYS.filter((key) => key !== 'expiresAt');
  requireExactKeysWithOptional(decision, required, ['expiresAt'], 'candidateDecision');
  assertSerializedSize(decision, CANDIDATE_DECISION_MAX_OUTPUT_BYTES, 'candidateDecision');
  if (decision.schemaVersion !== CANDIDATE_DECISION_SCHEMA_VERSION) throw visualError('VISUAL_CANDIDATE_DECISION_INVALID_SCHEMA', 'candidate decision schema invalid', 500);
  assertSafeString(decision.decisionId, 'decisionId', 16, 84, CANDIDATE_DECISION_ID_PATTERN);
  assertEntityKey(decision.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(decision.entityType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', 'decision entityType invalid', 500);
  if (!decision.entityKey.startsWith(`entity_${decision.entityType}_`)) throw visualError('VISUAL_CANDIDATE_SCOPE_MISMATCH', 'decision entity scope mismatch', 500);
  assertSafeString(decision.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertNonNegativeInteger(decision.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(decision.sourceMessageHash, 'sourceMessageHash');
  assertSha256Digest(decision.evidenceDigest, 'evidenceDigest');
  assertSafeString(decision.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(decision.profileHash, 'profileHash');
  assertSafeString(decision.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(decision.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(decision.catalogHash, 'catalogHash');
  assertVersionId(decision.dictionaryVersion, 'dictionaryVersion');
  assertSha256Digest(decision.dictionaryHash, 'dictionaryHash');
  assertSafeString(decision.assetId, 'assetId', 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(decision.assetVersion, 'assetVersion', Number.MAX_SAFE_INTEGER);
  assertSha256Hex(decision.assetContentSha256, 'assetContentSha256');
  assertSha256Digest(decision.assetMetadataHash, 'assetMetadataHash');
  assertIntegerRange(decision.score, 'score', 0, 100);
  if (!SHARED_SCORE_BAND_SET.has(decision.scoreBand)) throw visualError('VISUAL_CANDIDATE_INVALID_SCORE_BAND', 'scoreBand invalid', 500);
  if (decision.scoreBand !== scoreToBand(decision.score)) throw visualError('VISUAL_CANDIDATE_SCORE_BAND_MISMATCH', 'scoreBand does not match score', 500);
  assertSharedCodeArray(decision.reasonCodes, SHARED_REASON_CODE_SET, 'reasonCodes', 8, 1);
  assertVersionId(decision.matcherVersion, 'matcherVersion');
  assertVersionId(decision.scorerVersion, 'scorerVersion');
  if (decision.usesLlm !== false) throw visualError('VISUAL_CANDIDATE_USES_LLM_FORBIDDEN', 'usesLlm must be false', 500);
  assertIsoTimestamp(decision.createdAt, 'createdAt');
  if (decision.expiresAt !== undefined) {
    assertIsoTimestamp(decision.expiresAt, 'expiresAt');
    if (Date.parse(decision.expiresAt) <= Date.parse(decision.createdAt)) throw visualError('VISUAL_CANDIDATE_INVALID_TIME', 'expiresAt must be after createdAt', 500);
  }
}

function createCoreAssetMap(assets, catalog) {
  const map = new Map();
  const catalogKeys = new Set(catalog.assetRefs.map((ref) => `${ref.assetId}:${ref.assetVersion}`));
  for (const asset of assets) {
    const key = `${asset.assetId}:${asset.assetVersion}`;
    if (!catalogKeys.has(key)) throw visualError('VISUAL_CORE_ASSET_SCOPE_MISMATCH', 'asset snapshot contains asset outside catalog', 409);
    if (map.has(key)) throw visualError('VISUAL_CORE_ASSET_SCOPE_MISMATCH', 'asset snapshot duplicated', 409);
    map.set(key, asset);
  }
  for (const ref of catalog.assetRefs) {
    const asset = map.get(`${ref.assetId}:${ref.assetVersion}`);
    if (!asset) throw visualError('VISUAL_CORE_ASSET_SCOPE_MISMATCH', 'catalog asset missing from snapshot', 409);
    if (asset.status !== 'published') throw visualError('VISUAL_CORE_ASSET_NOT_PUBLISHED', 'asset snapshot must be published', 409);
    if (canonicalJson(assetToRef(asset)) !== canonicalJson(ref)) throw visualError('VISUAL_CORE_CATALOG_REF_MISMATCH', 'asset snapshot does not match catalog ref', 409);
  }
  return map;
}

function createCoreCandidateCatalogRefs(catalog) {
  return [...catalog.assetRefs, ...catalog.unknownAssetRefs].map((ref) => ({
    assetId: ref.assetId,
    assetVersion: ref.assetVersion,
    assetType: ref.assetType,
    assetContentSha256: ref.assetContentSha256,
    assetMetadataHash: ref.assetMetadataHash,
    catalogRefHash: sha256Json(ref),
  }));
}

function assertVisualCandidateDecisionInput(input) {
  requireExactKeys(input, CANDIDATE_DECISION_INPUT_KEYS, 'candidateDecisionInput');
  assertSerializedSize(input, CANDIDATE_DECISION_MAX_INPUT_BYTES, 'candidateDecisionInput');
  if (input.schemaVersion !== CANDIDATE_DECISION_INPUT_SCHEMA_VERSION) throw visualError('VISUAL_CANDIDATE_DECISION_INVALID_SCHEMA', 'candidate input schema invalid', 400);
  assertSafeString(input.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertSafeString(input.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertEntityKey(input.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(input.entityType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', 'entityType invalid', 400);
  if (!input.entityKey.startsWith(`entity_${input.entityType}_`)) throw visualError('VISUAL_CANDIDATE_SCOPE_MISMATCH', 'entityKey/entityType mismatch', 400);
  if (!SHARED_CONFIDENCE_BAND_SET.has(input.confidenceBand)) throw visualError('VISUAL_CANDIDATE_INVALID_CONFIDENCE', 'confidenceBand invalid', 400);
  assertSharedCodeArray(input.visibleAttributeCodes, SHARED_ATTRIBUTE_CODE_SET, 'visibleAttributeCodes', 32);
  assertNonNegativeInteger(input.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(input.sourceMessageHash, 'sourceMessageHash');
  assertSha256Digest(input.evidenceDigest, 'evidenceDigest');
  assertGenericId(input.releaseId, 'releaseId');
  assertGenericId(input.scenarioId, 'scenarioId');
  assertVersionId(input.scenarioVersion, 'scenarioVersion');
  assertGenericId(input.arcId, 'arcId');
  assertGenericId(input.chatId, 'chatId');
  assertSafeString(input.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(input.profileHash, 'profileHash');
  assertSafeString(input.profileCatalogId, 'profileCatalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(input.profileCatalogRevision, 'profileCatalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(input.profileCatalogHash, 'profileCatalogHash');
  assertSafeString(input.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(input.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(input.catalogHash, 'catalogHash');
  if (input.profileCatalogId !== input.catalogId || input.profileCatalogRevision !== input.catalogRevision || input.profileCatalogHash !== input.catalogHash) {
    throw visualError('VISUAL_CANDIDATE_PROFILE_CATALOG_MISMATCH', 'profile catalog binding does not match candidate catalog scope', 400);
  }
  assertCandidateCatalogRefs(input.catalogAssetRefs, 'catalogAssetRefs');
  assertVersionId(input.dictionaryVersion, 'dictionaryVersion');
  if (input.dictionaryVersion !== String(DICTIONARY_VERSION)) throw visualError('VISUAL_CANDIDATE_DICTIONARY_MISMATCH', 'dictionaryVersion mismatch', 400);
  assertSha256Digest(input.dictionaryHash, 'dictionaryHash');
  if (input.dictionaryHash !== DICTIONARY_HASH) throw visualError('VISUAL_CANDIDATE_DICTIONARY_MISMATCH', 'dictionaryHash mismatch', 400);
  if (!Array.isArray(input.candidates) || input.candidates.length > 128) throw visualError('VISUAL_CANDIDATE_INVALID_ARRAY', 'candidates invalid', 400);
  const seen = new Set();
  for (const [index, candidate] of input.candidates.entries()) {
    assertCandidateAssetInput(candidate, `candidates[${index}]`);
    const key = `${candidate.assetId}:${candidate.assetVersion}`;
    if (seen.has(key)) throw visualError('VISUAL_CANDIDATE_DUPLICATE', 'candidate asset duplicated', 400);
    seen.add(key);
  }
  assertVersionId(input.matcherVersion, 'matcherVersion');
  assertVersionId(input.scorerVersion, 'scorerVersion');
  assertIsoTimestamp(input.createdAt, 'createdAt');
}

function assertCandidateCatalogRefs(refs, label) {
  if (!Array.isArray(refs) || refs.length > 512) throw visualError('VISUAL_CANDIDATE_INVALID_ARRAY', `${label} invalid`, 400);
  const seen = new Set();
  for (const [index, ref] of refs.entries()) {
    const refLabel = `${label}[${index}]`;
    requireExactKeys(ref, CANDIDATE_CATALOG_REF_INPUT_KEYS, refLabel);
    assertSafeString(ref.assetId, `${refLabel}.assetId`, 3, 86, SHARED_ASSET_ID_PATTERN);
    assertPositiveInteger(ref.assetVersion, `${refLabel}.assetVersion`, Number.MAX_SAFE_INTEGER);
    if (!SHARED_BINDABLE_TYPE_SET.has(ref.assetType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', `${refLabel}.assetType invalid`, 400);
    assertSha256Digest(ref.assetContentSha256, `${refLabel}.assetContentSha256`);
    assertSha256Digest(ref.assetMetadataHash, `${refLabel}.assetMetadataHash`);
    assertSha256Digest(ref.catalogRefHash, `${refLabel}.catalogRefHash`);
    const expectedRefHash = sha256Json({
      assetId: ref.assetId,
      assetVersion: ref.assetVersion,
      assetType: ref.assetType,
      assetContentSha256: ref.assetContentSha256,
      assetMetadataHash: ref.assetMetadataHash,
    });
    if (expectedRefHash !== ref.catalogRefHash) throw visualError('VISUAL_CANDIDATE_CATALOG_REF_MISMATCH', `${refLabel}.catalogRefHash mismatch`, 400);
    const key = `${ref.assetId}:${ref.assetVersion}`;
    if (seen.has(key)) throw visualError('VISUAL_CANDIDATE_DUPLICATE', `${refLabel} duplicated`, 400);
    seen.add(key);
  }
}

function assertCandidateAssetInput(candidate, label, { allowAnalysis = false } = {}) {
  requireExactKeys(candidate, allowAnalysis ? CORE_CANDIDATE_ASSET_INPUT_KEYS : CANDIDATE_ASSET_INPUT_KEYS, label);
  assertSafeString(candidate.assetId, `${label}.assetId`, 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(candidate.assetVersion, `${label}.assetVersion`, Number.MAX_SAFE_INTEGER);
  if (!SHARED_BINDABLE_TYPE_SET.has(candidate.assetType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', `${label}.assetType invalid`, 400);
  if (candidate.role !== ROLE_BY_TYPE[candidate.assetType]) throw visualError('VISUAL_CANDIDATE_ROLE_MISMATCH', `${label}.role mismatch`, 400);
  if (candidate.canonicalMime !== PNG_MIME) throw visualError('VISUAL_CANDIDATE_INVALID_MIME', `${label}.canonicalMime invalid`, 400);
  assertSha256Hex(candidate.assetContentSha256, `${label}.assetContentSha256`);
  assertSha256Digest(candidate.assetMetadataHash, `${label}.assetMetadataHash`);
  assertSha256Digest(candidate.catalogRefHash, `${label}.catalogRefHash`);
  assertDictionaryCodeArray(candidate.tagCodes, `${label}.tagCodes`, 64);
  assertDictionaryCodeArray(candidate.negativeTagCodes, `${label}.negativeTagCodes`, 64);
  if (allowAnalysis) {
    if (!ANALYSIS_STATUS_SET.has(candidate.analysisStatus)) throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label}.analysisStatus invalid`, 400);
    assertDictionaryCodeArray(candidate.analysisTagCodes, `${label}.analysisTagCodes`, MAX_ANALYZER_CODES);
    assertDictionaryCodeArray(candidate.analysisAttributeCodes, `${label}.analysisAttributeCodes`, MAX_ANALYZER_CODES);
    if (typeof candidate.analysisConfidence !== 'number' || !Number.isFinite(candidate.analysisConfidence) || candidate.analysisConfidence < 0 || candidate.analysisConfidence > 1) {
      throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label}.analysisConfidence invalid`, 400);
    }
    if (candidate.analysisStatus !== 'ready' && (candidate.analysisTagCodes.length > 0 || candidate.analysisAttributeCodes.length > 0)) {
      throw visualError('VISUAL_ANALYSIS_SCHEMA_INVALID', `${label}.analysis codes require ready status`, 400);
    }
  }
  if (!['zh-CN', 'en', 'mixed', 'unknown'].includes(candidate.locale)) throw visualError('VISUAL_CANDIDATE_INVALID_LOCALE', `${label}.locale invalid`, 400);
}

function assertVisualCandidateDecision(decision) {
  const required = CANDIDATE_DECISION_KEYS.filter((key) => key !== 'expiresAt');
  requireExactKeysWithOptional(decision, required, ['expiresAt'], 'candidateDecision');
  assertSerializedSize(decision, CANDIDATE_DECISION_MAX_OUTPUT_BYTES, 'candidateDecision');
  if (decision.schemaVersion !== CANDIDATE_DECISION_SCHEMA_VERSION) throw visualError('VISUAL_CANDIDATE_DECISION_INVALID_SCHEMA', 'candidate decision schema invalid', 500);
  assertSafeString(decision.decisionId, 'decisionId', 16, 84, CANDIDATE_DECISION_ID_PATTERN);
  assertEntityKey(decision.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(decision.entityType)) throw visualError('VISUAL_CANDIDATE_INVALID_TYPE', 'decision entityType invalid', 500);
  if (!decision.entityKey.startsWith(`entity_${decision.entityType}_`)) throw visualError('VISUAL_CANDIDATE_SCOPE_MISMATCH', 'decision entity scope mismatch', 500);
  assertSafeString(decision.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertNonNegativeInteger(decision.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(decision.sourceMessageHash, 'sourceMessageHash');
  assertSha256Digest(decision.evidenceDigest, 'evidenceDigest');
  assertSafeString(decision.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(decision.profileHash, 'profileHash');
  assertSafeString(decision.catalogId, 'catalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(decision.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(decision.catalogHash, 'catalogHash');
  assertVersionId(decision.dictionaryVersion, 'dictionaryVersion');
  assertSha256Digest(decision.dictionaryHash, 'dictionaryHash');
  assertSafeString(decision.assetId, 'assetId', 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(decision.assetVersion, 'assetVersion', Number.MAX_SAFE_INTEGER);
  assertSha256Hex(decision.assetContentSha256, 'assetContentSha256');
  assertSha256Digest(decision.assetMetadataHash, 'assetMetadataHash');
  assertIntegerRange(decision.score, 'score', 0, 100);
  if (!SHARED_SCORE_BAND_SET.has(decision.scoreBand)) throw visualError('VISUAL_CANDIDATE_INVALID_SCORE_BAND', 'scoreBand invalid', 500);
  if (decision.scoreBand !== scoreToBand(decision.score)) throw visualError('VISUAL_CANDIDATE_SCORE_BAND_MISMATCH', 'scoreBand does not match score', 500);
  assertSharedCodeArray(decision.reasonCodes, SHARED_REASON_CODE_SET, 'reasonCodes', 8, 1);
  assertVersionId(decision.matcherVersion, 'matcherVersion');
  assertVersionId(decision.scorerVersion, 'scorerVersion');
  if (decision.usesLlm !== false) throw visualError('VISUAL_CANDIDATE_USES_LLM_FORBIDDEN', 'usesLlm must be false', 500);
  assertIsoTimestamp(decision.createdAt, 'createdAt');
  if (decision.expiresAt !== undefined) {
    assertIsoTimestamp(decision.expiresAt, 'expiresAt');
    if (Date.parse(decision.expiresAt) <= Date.parse(decision.createdAt)) throw visualError('VISUAL_CANDIDATE_INVALID_TIME', 'expiresAt must be after createdAt', 500);
  }
}

function assertDecisionMatchesInput(decision, input, { maxTtlMs = DEFAULT_TTL_MS, unknownCompatibilityReport = null } = {}) {
  const fields = [
    'entityKey',
    'entityType',
    'projectionId',
    'sourceMessageIndex',
    'sourceMessageHash',
    'evidenceDigest',
    'visualProfileId',
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'dictionaryVersion',
    'dictionaryHash',
    'matcherVersion',
    'scorerVersion',
    'createdAt',
  ];
  for (const field of fields) {
    if (decision[field] !== input[field]) {
      throw visualError('VISUAL_CANDIDATE_SCOPE_MISMATCH', `decision.${field} does not match input`, 500);
    }
  }
  if (decision.expiresAt !== undefined && Date.parse(decision.expiresAt) - Date.parse(decision.createdAt) > maxTtlMs) {
    throw visualError('VISUAL_CANDIDATE_INVALID_TIME', 'expiresAt exceeds candidate decision TTL', 500);
  }
  assertDecisionAssetProvenance(decision, input, { unknownCompatibilityReport });
}

function assertDecisionAssetProvenance(decision, input, { unknownCompatibilityReport = null } = {}) {
  const sharedUnknown = SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS[input.entityType];
  const isTypeUnknown = sharedUnknown
    && decision.assetId === sharedUnknown.assetId
    && decision.assetVersion === sharedUnknown.assetVersion
    && decision.assetContentSha256 === sharedUnknown.assetContentSha256;

  if (isTypeUnknown || decision.scoreBand === 'unknown' || decision.reasonCodes.includes('unknown-fallback')) {
    assertDecisionUnknownProvenance(decision, input, unknownCompatibilityReport, sharedUnknown);
    return;
  }

  const candidate = input.candidates.find((item) => (
    item.assetId === decision.assetId
    && item.assetVersion === decision.assetVersion
    && item.assetType === input.entityType
    && item.assetContentSha256 === decision.assetContentSha256
    && item.assetMetadataHash === decision.assetMetadataHash
  ));
  if (!candidate) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'decision asset is not one of the trusted candidates', 500);
  }
  const ref = findCatalogAssetRef(input.catalogAssetRefs, decision.assetId, decision.assetVersion);
  assertDecisionCatalogRef(decision, input, ref, candidate.catalogRefHash);
}

function assertDecisionUnknownProvenance(decision, input, report, sharedUnknown) {
  if (!sharedUnknown) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown decision has no type-specific shared asset', 500);
  }
  if (!report || report.status !== 'compatible') {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown decision requires compatible unknown report', 500);
  }
  if (
    report.catalogId !== input.catalogId
    || report.catalogRevision !== input.catalogRevision
    || report.catalogHash !== input.catalogHash
  ) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown report scope does not match input catalog', 500);
  }
  const entry = report.entries.find((item) => item.type === input.entityType);
  if (!entry?.compatible) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown report entry is not compatible', 500);
  }
  if (
    decision.assetId !== sharedUnknown.assetId
    || decision.assetVersion !== sharedUnknown.assetVersion
    || decision.assetContentSha256 !== sharedUnknown.assetContentSha256
    || decision.assetMetadataHash !== entry.serviceAssetMetadataHash
  ) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown decision asset does not match type-specific unknown provenance', 500);
  }
  if (!entry.catalogRefHash || entry.catalogRefHash === ZERO_SHA256_DIGEST) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'unknown decision is missing catalog ref provenance', 500);
  }
}

function assertDecisionCatalogRef(decision, input, ref, expectedCatalogRefHash) {
  if (!ref) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'decision asset is missing from trusted catalog refs', 500);
  }
  const expectedRefHash = sha256Json({
    assetId: ref.assetId,
    assetVersion: ref.assetVersion,
    assetType: ref.assetType,
    assetContentSha256: ref.assetContentSha256,
    assetMetadataHash: ref.assetMetadataHash,
  });
  if (
    ref.assetType !== input.entityType
    || stripSha256Prefix(ref.assetContentSha256) !== decision.assetContentSha256
    || ref.assetMetadataHash !== decision.assetMetadataHash
    || ref.catalogRefHash !== expectedCatalogRefHash
    || ref.catalogRefHash !== expectedRefHash
  ) {
    throw visualError('VISUAL_CANDIDATE_DECISION_ASSET_MISMATCH', 'decision asset does not match trusted catalog ref provenance', 500);
  }
}

function assertUnknownCompatibilityReport(report) {
  requireExactKeys(report, UNKNOWN_COMPATIBILITY_REPORT_KEYS, 'unknownCompatibilityReport');
  assertSerializedSize(report, UNKNOWN_COMPATIBILITY_REPORT_MAX_BYTES, 'unknownCompatibilityReport');
  if (report.schemaVersion !== UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_INVALID_SCHEMA', 'unknown compatibility schema invalid', 500);
  assertSafeString(report.reportId, 'reportId', 16, 84, UNKNOWN_COMPATIBILITY_REPORT_ID_PATTERN);
  if (!['compatible', 'blocked'].includes(report.status)) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_INVALID_STATUS', 'unknown compatibility status invalid', 500);
  assertIsoTimestamp(report.generatedAt, 'generatedAt');
  assertVersionId(report.sharedSchemaVersion, 'sharedSchemaVersion');
  assertVersionId(report.visualAssetServiceVersion, 'visualAssetServiceVersion');
  assertSafeString(report.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(report.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(report.catalogHash, 'catalogHash');
  if (!Array.isArray(report.entries) || report.entries.length !== 5) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_INVALID_ENTRIES', 'unknown compatibility entries invalid', 500);
  const seen = new Set();
  for (const [index, entry] of report.entries.entries()) {
    assertUnknownCompatibilityEntry(entry, `entries[${index}]`);
    if (seen.has(entry.type)) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_DUPLICATE_TYPE', 'unknown compatibility entry duplicated', 500);
    seen.add(entry.type);
  }
  for (const type of ENTITY_TYPES) {
    if (!seen.has(type)) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_MISSING_TYPE', `unknown compatibility missing ${type}`, 500);
  }
  const expectedStatus = report.entries.every((entry) => entry.compatible) ? 'compatible' : 'blocked';
  if (report.status !== expectedStatus) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_STATUS_MISMATCH', 'unknown compatibility status mismatch', 500);
}

function assertUnknownCompatibilityEntry(entry, label) {
  requireExactKeys(entry, UNKNOWN_COMPATIBILITY_ENTRY_KEYS, label);
  if (!ENTITY_TYPE_SET.has(entry.type)) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_INVALID_TYPE', `${label}.type invalid`, 500);
  assertSafeString(entry.sharedAssetId, `${label}.sharedAssetId`, 1, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(entry.sharedAssetVersion, `${label}.sharedAssetVersion`, Number.MAX_SAFE_INTEGER);
  assertSha256Hex(entry.sharedAssetContentSha256, `${label}.sharedAssetContentSha256`);
  assertSafeString(entry.serviceAssetId, `${label}.serviceAssetId`, 1, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(entry.serviceAssetVersion, `${label}.serviceAssetVersion`, Number.MAX_SAFE_INTEGER);
  assertSha256Hex(entry.serviceAssetContentSha256, `${label}.serviceAssetContentSha256`);
  assertSha256Digest(entry.serviceAssetMetadataHash, `${label}.serviceAssetMetadataHash`);
  assertSha256Digest(entry.catalogRefHash, `${label}.catalogRefHash`);
  assertSha256Hex(entry.servedBytesSha256, `${label}.servedBytesSha256`);
  if (typeof entry.compatible !== 'boolean') throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_INVALID_ENTRY', `${label}.compatible invalid`, 500);
  assertSharedCodeArray(entry.mismatchCodes, UNKNOWN_COMPATIBILITY_MISMATCH_SET, `${label}.mismatchCodes`, 8);
  if (entry.compatible !== (entry.mismatchCodes.length === 0)) throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_ENTRY_MISMATCH', `${label}.compatible mismatch`, 500);
  if (entry.compatible) {
    const expectedUnknownAssetId = `unknown_${entry.type}`;
    if (
      entry.sharedAssetId !== expectedUnknownAssetId
      || entry.serviceAssetId !== expectedUnknownAssetId
      || entry.sharedAssetId !== entry.serviceAssetId
      || entry.sharedAssetVersion !== entry.serviceAssetVersion
      || entry.sharedAssetContentSha256 !== entry.serviceAssetContentSha256
      || entry.servedBytesSha256 !== entry.serviceAssetContentSha256
    ) {
      throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_ENTRY_MISMATCH', `${label}.compatible invariant mismatch`, 500);
    }
    const expectedCatalogRefHash = sha256Json({
      assetId: entry.serviceAssetId,
      assetVersion: entry.serviceAssetVersion,
      assetType: entry.type,
      assetContentSha256: `sha256:${entry.serviceAssetContentSha256}`,
      assetMetadataHash: entry.serviceAssetMetadataHash,
    });
    if (entry.catalogRefHash !== expectedCatalogRefHash) {
      throw visualError('VISUAL_UNKNOWN_COMPATIBILITY_ENTRY_MISMATCH', `${label}.catalogRefHash mismatch`, 500);
    }
  }
}

function requireExactKeysWithOptional(value, requiredKeys, optionalKeys, label) {
  if (!isPlainObject(value)) {
    throw visualError('VISUAL_ASSET_BAD_REQUEST', `${label} must be an object`, 400);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw visualError('VISUAL_ASSET_UNKNOWN_FIELD', `${label}.${key} is not allowed`, 400);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw visualError('VISUAL_ASSET_MISSING_FIELD', `${label}.${key} is required`, 400);
  }
}

function collectValidation(fn) {
  try {
    fn();
    return { valid: true, errors: [] };
  } catch (error) {
    return { valid: false, errors: [error.code || error.message || 'VISUAL_VALIDATION_FAILED'] };
  }
}

function assertSerializedSize(value, maxBytes, label) {
  const bytes = Buffer.byteLength(canonicalJson(value), 'utf8');
  if (bytes > maxBytes) throw visualError('VISUAL_ASSET_SIZE_LIMIT', `${label} exceeds serialized size limit`, 413);
}

function assertJsonText(text, maxBytes, label) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw visualError('VISUAL_ASSET_SIZE_LIMIT', `${label} exceeds JSON size limit`, 413);
  }
  if (text.charCodeAt(0) === 0xfeff) throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', `${label} BOM not allowed`, 400);
}

function assertNoDuplicateJsonKeys(text, label) {
  const stack = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '{') {
      stack.push({ type: 'object', keys: new Set(), expectKey: true });
      index += 1;
      continue;
    }
    if (char === '[') {
      stack.push({ type: 'array', expectKey: false });
      index += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      stack.pop();
      markValueConsumed(stack);
      index += 1;
      continue;
    }
    if (char === ',') {
      const top = stack.at(-1);
      if (top?.type === 'object') top.expectKey = true;
      index += 1;
      continue;
    }
    if (char === ':') {
      const top = stack.at(-1);
      if (top?.type === 'object') top.expectKey = false;
      index += 1;
      continue;
    }
    if (char === '"') {
      const parsed = readJsonStringToken(text, index);
      const top = stack.at(-1);
      const after = nextNonWhitespace(text, parsed.end);
      if (top?.type === 'object' && top.expectKey && text[after] === ':') {
        if (top.keys.has(parsed.value)) throw visualError('VISUAL_ASSET_DUPLICATE_FIELD', `${label} has duplicate key ${parsed.value}`, 400);
        top.keys.add(parsed.value);
      } else {
        markValueConsumed(stack);
      }
      index = parsed.end;
      continue;
    }
    while (index < text.length && !/[,\]}\s]/.test(text[index])) index += 1;
    markValueConsumed(stack);
  }
}

function readJsonStringToken(text, start) {
  let index = start + 1;
  let value = '';
  while (index < text.length) {
    const char = text[index];
    if (char === '"') return { value, end: index + 1 };
    if (char === '\\') {
      value += char + (text[index + 1] || '');
      index += 2;
      continue;
    }
    value += char;
    index += 1;
  }
  throw visualError('VISUAL_ASSET_BAD_REQUEST', 'JSON string is unterminated', 400);
}

function nextNonWhitespace(text, start) {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function markValueConsumed(stack) {
  const top = stack.at(-1);
  if (top?.type === 'object') top.expectKey = false;
}

function assertEntityKey(value, label) {
  assertSafeString(value, label, 16, 103, /^entity_(scene|character|equipment|item|skill|unknown)_[a-z0-9._:-]{8,72}$/);
}

function assertGenericId(value, label) {
  assertSafeString(value, label, 1, 120, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/);
}

function assertVersionId(value, label) {
  assertSafeString(String(value), label, 1, 80, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
  if (typeof value !== 'string') throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} must be a string`, 400);
}

function assertSha256Digest(value, label) {
  assertSafeString(value, label, 71, 71, SHA256_DIGEST_PATTERN);
}

function assertSha256Hex(value, label) {
  assertSafeString(value, label, 64, 64, SHA256_HEX_PATTERN);
}

function assertNonNegativeInteger(value, label) {
  assertIntegerRange(value, label, 0, Number.MAX_SAFE_INTEGER);
}

function assertIntegerRange(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw visualError('VISUAL_ASSET_INVALID_NUMBER', `${label} is invalid`, 400);
  }
}

function assertIsoTimestamp(value, label) {
  assertSafeString(value, label, 20, 40, ISO_TIMESTAMP_PATTERN);
  if (!Number.isFinite(Date.parse(value))) throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} is invalid`, 400);
}

function assertSharedCodeArray(value, allowedSet, label, maxItems, minItems = 0) {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) {
    throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} must be an array`, 400);
  }
  const seen = new Set();
  for (const item of value) {
    assertSafeString(item, label, 1, 80, /^[a-z0-9._:-]+$/);
    if (!allowedSet.has(item)) throw visualError('VISUAL_ASSET_UNKNOWN_CODE', `${label} contains unknown code`, 400);
    if (seen.has(item)) throw visualError('VISUAL_ASSET_DUPLICATE_CODE', `${label} contains duplicate code`, 400);
    seen.add(item);
  }
}

function assertDictionaryCodeArray(value, label, maxItems) {
  assertSharedCodeArray(value, ALL_DICTIONARY_CODES, label, maxItems);
}

function stripSha256Prefix(value) {
  if (typeof value !== 'string' || !value.startsWith('sha256:')) {
    throw visualError('VISUAL_ASSET_INVALID_FIELD', 'sha256 digest is invalid', 500);
  }
  return value.slice('sha256:'.length);
}

function countNegativeConflicts(input, candidate) {
  const visible = new Set(input.visibleAttributeCodes);
  return candidate.negativeTagCodes.filter((code) => visible.has(code)).length;
}

function uniqueReasonCodes(codes) {
  const output = [];
  for (const code of codes) {
    if (SHARED_REASON_CODE_SET.has(code) && !output.includes(code)) output.push(code);
  }
  return output.slice(0, 8);
}

function scoreToBand(score) {
  if (score < 60) return 'unknown';
  if (score < 80) return 'medium';
  return 'high';
}

function createStableId(prefix, payload) {
  return `${prefix}_${sha256Hex(Buffer.from(canonicalJson(payload), 'utf8')).slice(0, 24)}`;
}

function sha256Digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return `sha256:${sha256Hex(bytes)}`;
}

function base64UrlDecodeStrict(value, label, maxBytes) {
  assertSafeString(value, label, 1, Math.ceil(maxBytes * 4 / 3), /^[A-Za-z0-9_-]+$/);
  if (value.includes('=')) throw visualError('VISUAL_MATCH_PROOF_ENCODING_INVALID', `${label} must not use padding`, 400);
  const bytes = Buffer.from(value, 'base64url');
  if (!bytes.length || bytes.length > maxBytes) throw visualError('VISUAL_MATCH_PROOF_ENCODING_INVALID', `${label} size invalid`, 400);
  return bytes;
}

function base64UrlEncodeCanonical(value) {
  return Buffer.from(canonicalJson(value), 'utf8').toString('base64url');
}

function verifyVisualProjectionProofHeader(req, {
  projectionSecret,
  expectedProjectionId,
  now = Date.now,
} = {}) {
  if (!projectionSecret) throw visualError('VISUAL_MATCH_PROOF_SECRET_UNCONFIGURED', 'visual projection secret is not configured', 503);
  if (req.url && new URL(req.url, 'http://localhost').search) {
    throw visualError('VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN', 'proof must not be in query string', 400);
  }
  if (req.headers.cookie) throw visualError('VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN', 'proof must not be sent in cookies', 400);
  if (Object.hasOwn(req.headers, 'x-galgame-visual-projection-proof-json')) {
    throw visualError('VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN', 'raw proof JSON header is forbidden', 400);
  }
  const encoded = req.headers[VISUAL_MATCH_PROOF_HEADER];
  if (typeof encoded !== 'string' || !encoded) throw visualError('VISUAL_MATCH_PROOF_MISSING', 'visual projection proof header required', 401);
  const canonicalBytes = base64UrlDecodeStrict(encoded, 'projectionProofHeader', VISUAL_MATCH_PROOF_MAX_BYTES);
  let proof;
  try {
    const text = canonicalBytes.toString('utf8');
    assertNoDuplicateJsonKeys(text, 'projectionProof');
    proof = JSON.parse(text);
  } catch (error) {
    throw visualError(error.code || 'VISUAL_MATCH_PROOF_ENCODING_INVALID', 'proof JSON is invalid', 400);
  }
  if (Buffer.compare(canonicalBytes, Buffer.from(canonicalJson(proof), 'utf8')) !== 0) {
    throw visualError('VISUAL_MATCH_PROOF_ENCODING_INVALID', 'proof must use canonical JSON bytes', 400);
  }
  const shape = validateVisualProjectionProofShape(proof);
  if (!shape.valid) throw visualError('VISUAL_MATCH_PROOF_SCHEMA_INVALID', 'projection proof schema invalid', 400);
  if (expectedProjectionId && proof.projectionId !== expectedProjectionId) {
    throw visualError('VISUAL_MATCH_PROOF_SCOPE_MISMATCH', 'proof projectionId mismatch', 403);
  }
  if (Date.parse(proof.expiresAt) <= now()) {
    throw visualError('VISUAL_MATCH_PROOF_EXPIRED', 'projection proof expired', 403);
  }
  const unsigned = { ...proof, signature: '' };
  const expected = createHmac('sha256', projectionSecret).update(canonicalJson(unsigned)).digest('base64url');
  const provided = Buffer.from(proof.signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) {
    throw visualError('VISUAL_MATCH_PROOF_SIGNATURE_INVALID', 'projection proof signature invalid', 403);
  }
  return proof;
}

function verifyVisualRestoreProofHeader(req, {
  proofSecret,
  acceptedKeyIds,
  expectedKind,
  now = Date.now,
} = {}) {
  if (!proofSecret) throw visualError('VISUAL_RESTORE_PROOF_SECRET_UNCONFIGURED', 'visual restore proof secret is not configured', 503);
  if (!acceptedKeyIds?.size) throw visualError('VISUAL_RESTORE_PROOF_KEY_UNCONFIGURED', 'visual restore proof key ids are not configured', 503);
  if (req.url && new URL(req.url, 'http://localhost').search) {
    throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'restore proof must not be in query string', 400);
  }
  if (req.headers.cookie) throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'restore proof must not be sent in cookies', 400);
  if (Object.hasOwn(req.headers, 'x-galgame-visual-restore-proof-json')) {
    throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'raw restore proof JSON is forbidden', 400);
  }
  const encoded = req.headers[VISUAL_RESTORE_PROOF_HEADER];
  if (typeof encoded !== 'string' || !encoded || encoded.includes(',')) throw visualError('VISUAL_RESTORE_PROOF_MISSING', 'visual restore proof header required', 401);
  assertSafeString(encoded, 'restoreProofHeader', 1, VISUAL_RESTORE_PROOF_MAX_BYTES, /^[A-Za-z0-9_.-]+$/);
  const parts = encoded.split('.');
  if (parts.length !== 3) throw visualError('VISUAL_RESTORE_PROOF_ENCODING_INVALID', 'restore proof envelope invalid', 400);
  const [prefix, payloadEncoded, signature] = parts;
  const expectedPrefix = expectedKind === 'old-save' ? 'gvosrp1' : 'gvrrp1';
  if (prefix !== expectedPrefix) throw visualError('VISUAL_RESTORE_PROOF_PURPOSE_MISMATCH', 'restore proof prefix mismatch', 403);
  assertSafeString(payloadEncoded, 'restoreProofPayload', 1, VISUAL_RESTORE_PROOF_MAX_BYTES, /^[A-Za-z0-9_-]+$/);
  assertSafeString(signature, 'restoreProofSignature', 32, 128, /^[A-Za-z0-9_-]+$/);
  const payloadBytes = base64UrlDecodeStrict(payloadEncoded, 'restoreProofPayload', VISUAL_RESTORE_PROOF_MAX_BYTES);
  let payload;
  try {
    const text = payloadBytes.toString('utf8');
    assertNoDuplicateJsonKeys(text, 'restoreProofPayload');
    payload = JSON.parse(text);
  } catch (error) {
    throw visualError(error.code || 'VISUAL_RESTORE_PROOF_ENCODING_INVALID', 'restore proof payload JSON invalid', 400);
  }
  if (Buffer.compare(payloadBytes, Buffer.from(canonicalJson(payload), 'utf8')) !== 0) {
    throw visualError('VISUAL_RESTORE_PROOF_ENCODING_INVALID', 'restore proof payload must be canonical JSON', 400);
  }
  validateVisualRestoreProofPayload(payload, expectedKind);
  if (!acceptedKeyIds.has(payload.keyId)) throw visualError('VISUAL_RESTORE_PROOF_KEY_REJECTED', 'restore proof key id rejected', 403);
  const issuedAtMs = Date.parse(payload.issuedAt);
  const expiresAtMs = Date.parse(payload.expiresAt);
  const nowMs = now();
  if (issuedAtMs >= expiresAtMs || expiresAtMs - issuedAtMs > VISUAL_RESTORE_MAX_TTL_MS) throw visualError('VISUAL_RESTORE_PROOF_TTL_INVALID', 'restore proof ttl invalid', 403);
  if (issuedAtMs > nowMs || expiresAtMs <= nowMs) throw visualError('VISUAL_RESTORE_PROOF_EXPIRED', 'restore proof expired', 403);
  const expected = createHmac('sha256', proofSecret).update(`${prefix}.${payloadEncoded}`, 'ascii').digest('base64url');
  const providedBytes = Buffer.from(signature, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw visualError('VISUAL_RESTORE_PROOF_SIGNATURE_INVALID', 'restore proof signature invalid', 403);
  }
  return { prefix, token: encoded, payload };
}

function validateVisualRestoreProofPayload(payload, kind) {
  const oldSaveKeys = [
    'schemaVersion', 'purpose', 'audience', 'issuer', 'keyId', 'nonce', 'issuedAt', 'expiresAt',
    'saveId', 'saveBindingHash', 'saveOwnerHash', 'releaseId', 'releaseScopeHash', 'scenarioId',
    'scenarioVersion', 'arcId', 'visualProfileId', 'visualProfileHash', 'catalogId', 'catalogRevision',
    'catalogHash', 'dictionaryVersion', 'dictionaryHash', 'bindingIds', 'chatIdHash',
  ];
  const rollbackKeys = [
    'schemaVersion', 'purpose', 'audience', 'issuer', 'keyId', 'nonce', 'issuedAt', 'expiresAt',
    'rollbackRequestId', 'targetReleaseId', 'targetReleaseHash', 'releaseScopeHash', 'scenarioId',
    'scenarioVersion', 'arcId', 'visualProfileId', 'visualProfileHash', 'catalogId', 'catalogRevision',
    'catalogHash', 'dictionaryVersion', 'dictionaryHash', 'publishedAt', 'rolledBackAt',
  ];
  const keys = kind === 'old-save' ? oldSaveKeys : rollbackKeys;
  requireExactKeys(payload, keys, 'restoreProofPayload');
  if (kind === 'old-save') {
    if (payload.schemaVersion !== VISUAL_RESTORE_OLD_SAVE_PROOF_SCHEMA_VERSION || payload.purpose !== VISUAL_RESTORE_OLD_SAVE_PURPOSE) {
      throw visualError('VISUAL_RESTORE_PROOF_PURPOSE_MISMATCH', 'old-save restore proof purpose invalid', 403);
    }
    assertGenericId(payload.saveId, 'saveId');
    assertSha256Digest(payload.saveBindingHash, 'saveBindingHash');
    assertSha256Digest(payload.saveOwnerHash, 'saveOwnerHash');
    assertBindingIdArray(payload.bindingIds, 'bindingIds', 64);
    assertSha256Digest(payload.chatIdHash, 'chatIdHash');
  } else {
    if (payload.schemaVersion !== VISUAL_RESTORE_ROLLBACK_PROOF_SCHEMA_VERSION || payload.purpose !== VISUAL_RESTORE_ROLLBACK_PURPOSE) {
      throw visualError('VISUAL_RESTORE_PROOF_PURPOSE_MISMATCH', 'rollback restore proof purpose invalid', 403);
    }
    assertSafeString(payload.rollbackRequestId, 'rollbackRequestId', 17, 129, /^rollback_[A-Za-z0-9._:-]{8,120}$/);
    assertGenericId(payload.targetReleaseId, 'targetReleaseId');
    assertSha256Digest(payload.targetReleaseHash, 'targetReleaseHash');
    assertIsoTimestamp(payload.publishedAt, 'publishedAt');
    assertIsoTimestamp(payload.rolledBackAt, 'rolledBackAt');
  }
  if (payload.audience !== VISUAL_RESTORE_AUDIENCE || payload.issuer !== VISUAL_RESTORE_ISSUER) {
    throw visualError('VISUAL_RESTORE_PROOF_SCOPE_MISMATCH', 'restore proof issuer or audience invalid', 403);
  }
  assertSafeString(payload.keyId, 'keyId', 25, 57, /^vis_restore_key_[a-z0-9_-]{8,40}$/);
  assertSafeString(payload.nonce, 'nonce', 22, 126, /^nonce_[A-Za-z0-9._:-]{16,120}$/);
  assertIsoTimestamp(payload.issuedAt, 'issuedAt');
  assertIsoTimestamp(payload.expiresAt, 'expiresAt');
  assertGenericId(kind === 'old-save' ? payload.releaseId : payload.targetReleaseId, kind === 'old-save' ? 'releaseId' : 'targetReleaseId');
  assertSha256Digest(payload.releaseScopeHash, 'releaseScopeHash');
  assertGenericId(payload.scenarioId, 'scenarioId');
  assertVersionId(payload.scenarioVersion, 'scenarioVersion');
  assertGenericId(payload.arcId, 'arcId');
  assertSafeString(payload.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(payload.visualProfileHash, 'visualProfileHash');
  assertSafeString(payload.catalogId, 'catalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(payload.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(payload.catalogHash, 'catalogHash');
  assertVersionId(payload.dictionaryVersion, 'dictionaryVersion');
  assertSha256Digest(payload.dictionaryHash, 'dictionaryHash');
}

function requireVisualRestoreBindingRequest(body) {
  requireExactKeys(body, VISUAL_RESTORE_BINDING_REQUEST_KEYS, 'visualRestoreBindingRequest');
  if (body.schemaVersion !== VISUAL_RESTORE_BINDING_REQUEST_SCHEMA_VERSION) throw visualError('VISUAL_RESTORE_REQUEST_INVALID_SCHEMA', 'restore binding request schema invalid', 400);
  assertSafeString(body.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertSafeString(body.idempotencyKey, 'idempotencyKey', 21, 125, /^idem_[A-Za-z0-9._:-]{16,120}$/);
  assertSafeString(body.bindingId, 'bindingId', 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
  if (!SHARED_BINDABLE_TYPE_SET.has(body.bindingType)) throw visualError('VISUAL_RESTORE_REQUEST_INVALID_TYPE', 'bindingType invalid', 400);
  assertEntityKey(body.entityKey, 'entityKey');
  if (entityTypeFromKey(body.entityKey) !== body.bindingType) throw visualError('VISUAL_RESTORE_REQUEST_SCOPE_MISMATCH', 'entityKey bindingType mismatch', 400);
  assertGenericId(body.expectedReleaseId, 'expectedReleaseId');
  assertSha256Digest(body.expectedReleaseScopeHash, 'expectedReleaseScopeHash');
  assertGenericId(body.expectedScenarioId, 'expectedScenarioId');
  assertVersionId(body.expectedScenarioVersion, 'expectedScenarioVersion');
  assertGenericId(body.expectedArcId, 'expectedArcId');
  assertSafeString(body.expectedVisualProfileId, 'expectedVisualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(body.expectedVisualProfileHash, 'expectedVisualProfileHash');
  assertSafeString(body.expectedCatalogId, 'expectedCatalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(body.expectedCatalogRevision, 'expectedCatalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(body.expectedCatalogHash, 'expectedCatalogHash');
  assertVersionId(body.expectedDictionaryVersion, 'expectedDictionaryVersion');
  assertSha256Digest(body.expectedDictionaryHash, 'expectedDictionaryHash');
  assertSafeString(body.expectedRetentionId, 'expectedRetentionId', 22, 86, /^vbrtn_[a-z0-9_-]{16,80}$/);
  assertSha256Digest(body.expectedRetentionHash, 'expectedRetentionHash');
  assertSha256Digest(body.expectedBindingRecordHash, 'expectedBindingRecordHash');
  assertSha256Digest(body.expectedReceiptHash, 'expectedReceiptHash');
  assertSafeString(body.expectedAssetId, 'expectedAssetId', 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(body.expectedAssetVersion, 'expectedAssetVersion', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(body.expectedAssetContentSha256, 'expectedAssetContentSha256');
  assertSha256Digest(body.expectedAssetMetadataHash, 'expectedAssetMetadataHash');
  assertSha256Digest(body.expectedCatalogRefHash, 'expectedCatalogRefHash');
  assertBindingTypeCoherence({
    bindingId: body.bindingId,
    bindingType: body.bindingType,
    entityKey: body.entityKey,
    assetId: body.expectedAssetId,
    receiptAssetType: body.bindingType,
  });
  return body;
}

function verifyRestoreBindingBundle({ kind, proof, body, bundle }) {
  const { record, publicBinding, publicResult, receipt, retention } = bundle;
  if (!receipt) throw visualError('VISUAL_RESTORE_RECEIPT_MISSING', 'binding receipt missing', 404);
  if (!retention) throw visualError('VISUAL_RESTORE_RETENTION_MISSING', 'binding retention missing', 404);
  validateStoredPublicArtifacts(record, publicBinding, publicResult);
  assertReceiptRetentionLink(receipt, retention, record);
  const payload = proof.payload;
  if (kind === 'old-save' && !payload.bindingIds.includes(body.bindingId)) {
    throw visualError('VISUAL_RESTORE_BINDING_NOT_AUTHORIZED', 'binding is not authorized by old-save proof', 403);
  }
  const proofReleaseId = kind === 'old-save' ? payload.releaseId : payload.targetReleaseId;
  if (
    body.expectedReleaseId !== proofReleaseId
    || body.expectedReleaseScopeHash !== payload.releaseScopeHash
    || body.expectedScenarioId !== payload.scenarioId
    || body.expectedScenarioVersion !== payload.scenarioVersion
    || body.expectedArcId !== payload.arcId
    || body.expectedVisualProfileId !== payload.visualProfileId
    || body.expectedVisualProfileHash !== payload.visualProfileHash
    || body.expectedCatalogId !== payload.catalogId
    || body.expectedCatalogRevision !== payload.catalogRevision
    || body.expectedCatalogHash !== payload.catalogHash
    || body.expectedDictionaryVersion !== payload.dictionaryVersion
    || body.expectedDictionaryHash !== payload.dictionaryHash
  ) {
    throw visualError('VISUAL_RESTORE_PROOF_SCOPE_MISMATCH', 'restore request does not match proof scope', 409);
  }
  if (kind === 'old-save' && receipt.chatIdHash !== payload.chatIdHash) {
    throw visualError('VISUAL_RESTORE_PROOF_SCOPE_MISMATCH', 'restore proof chat scope mismatch', 409);
  }
  const releaseScopeHash = createReleaseScopeHash(record);
  if (
    record.bindingId !== body.bindingId
    || publicBinding.bindingId !== body.bindingId
    || receipt.bindingId !== body.bindingId
    || record.releaseId !== body.expectedReleaseId
    || record.scenarioId !== body.expectedScenarioId
    || record.scenarioVersion !== body.expectedScenarioVersion
    || record.arcId !== body.expectedArcId
    || releaseScopeHash !== body.expectedReleaseScopeHash
    || record.visualProfileId !== body.expectedVisualProfileId
    || record.profileHash !== body.expectedVisualProfileHash
    || record.catalogId !== body.expectedCatalogId
    || record.catalogRevision !== body.expectedCatalogRevision
    || record.catalogHash !== body.expectedCatalogHash
    || record.dictionaryVersion !== body.expectedDictionaryVersion
    || record.dictionaryHash !== body.expectedDictionaryHash
  ) {
    throw visualError('VISUAL_RESTORE_RETENTION_SCOPE_MISMATCH', 'retained binding scope mismatch', 409);
  }
  if (
    receipt.retentionId !== body.expectedRetentionId
    || receipt.retentionHash !== body.expectedRetentionHash
    || receipt.receiptHash !== body.expectedReceiptHash
    || retention.retentionId !== body.expectedRetentionId
    || retention.retentionHash !== body.expectedRetentionHash
  ) {
    throw visualError('VISUAL_RESTORE_RETENTION_LINK_MISMATCH', 'retention link mismatch', 409);
  }
  if (
    body.bindingType !== record.entityType
    || body.entityKey !== record.entityKey
    || body.expectedAssetId !== record.assetId
    || body.expectedAssetVersion !== record.assetVersion
  ) {
    throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'restore request type or asset mismatch', 409);
  }
  assertBindingTypeCoherence({
    bindingId: record.bindingId,
    bindingType: record.entityType,
    entityKey: record.entityKey,
    assetId: record.assetId,
    receiptAssetType: receipt.assetType,
    publicBinding,
    publicResult,
  });
  if (
    body.expectedBindingRecordHash !== sha256Json(record)
    || body.expectedAssetContentSha256 !== `sha256:${record.assetContentSha256}`
    || body.expectedAssetMetadataHash !== record.assetMetadataHash
    || body.expectedCatalogRefHash !== record.catalogRefHash
    || receipt.bindingRecordHash !== body.expectedBindingRecordHash
    || receipt.assetContentSha256 !== body.expectedAssetContentSha256
    || receipt.assetMetadataHash !== body.expectedAssetMetadataHash
    || receipt.catalogRefHash !== body.expectedCatalogRefHash
  ) {
    throw visualError('VISUAL_RESTORE_ASSET_HASH_MISMATCH', 'restore asset or binding hash mismatch', 409);
  }
  if (publicBinding.assetContentSha256 !== record.assetContentSha256 || publicResult.assetContentSha256 !== record.assetContentSha256) {
    throw visualError('VISUAL_RESTORE_ASSET_HASH_MISMATCH', 'public binding hash boundary mismatch', 409);
  }
  const restoreReplayKey = sha256Json({
    purpose: payload.purpose,
    issuer: payload.issuer,
    keyId: payload.keyId,
    nonce: payload.nonce,
    releaseScopeHash: payload.releaseScopeHash,
    bindingId: body.bindingId,
  });
  return { record, publicBinding, publicResult, receipt, retention, restoreReplayKey };
}

function requireVisualMatchRequest(body) {
  requireExactKeys(body, VISUAL_MATCH_REQUEST_KEYS, 'visualMatchRequest');
  if (body.schemaVersion !== VISUAL_MATCH_REQUEST_SCHEMA_VERSION) throw visualError('VISUAL_MATCH_REQUEST_INVALID_SCHEMA', 'visual match request schema invalid', 400);
  assertSafeString(body.requestId, 'requestId', 20, 124, CANDIDATE_REQUEST_ID_PATTERN);
  assertSafeString(body.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertEntityKey(body.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(body.entityType)) throw visualError('VISUAL_MATCH_REQUEST_INVALID_TYPE', 'entityType invalid', 400);
  if (!body.entityKey.startsWith(`entity_${body.entityType}_`)) throw visualError('VISUAL_MATCH_REQUEST_SCOPE_MISMATCH', 'entityKey/entityType mismatch', 400);
  assertSafeString(body.idempotencyKey, 'idempotencyKey', 21, 125, /^idem_[A-Za-z0-9._:-]{16,120}$/);
  return body;
}

function proofScopeContext(proof) {
  return {
    releaseId: proof.releaseId,
    scenarioId: proof.scenarioId,
    scenarioVersion: proof.scenarioVersion,
    arcId: proof.arcId,
    chatId: proof.chatId,
    projectionId: proof.projectionId,
    sourceMessageIndex: proof.sourceMessageIndex,
    sourceMessageHash: proof.sourceMessageHash,
    visualProfileId: proof.profileId,
    profileHash: proof.profileHash,
    catalogId: proof.catalogId,
    catalogRevision: proof.catalogRevision,
    catalogHash: proof.catalogHash,
    dictionaryVersion: proof.dictionaryVersion,
    dictionaryHash: proof.dictionaryHash,
  };
}

function assertStubMatchesProof(stub, proof) {
  const status = validateVisualProjectionStub(stub);
  if (!status.valid) throw visualError('VISUAL_MATCH_STUB_RESPONSE_INVALID', 'projection stub schema invalid', 502);
  const fields = [
    'projectionId',
    'projectionHash',
    'sourceMessageHash',
    'releaseId',
    'scenarioId',
    'scenarioVersion',
    'arcId',
    'chatId',
    ['profileId', 'profileId'],
    'profileHash',
    'catalogId',
    'catalogRevision',
    'catalogHash',
    'sourceMessageIndex',
    'extractorVersion',
    'dictionaryVersion',
    'dictionaryHash',
  ];
  for (const field of fields) {
    const stubField = Array.isArray(field) ? field[0] : field;
    const proofField = Array.isArray(field) ? field[1] : field;
    if (stub[stubField] !== proof[proofField]) throw visualError('VISUAL_MATCH_STUB_SCOPE_MISMATCH', 'projection stub scope mismatch', 409);
  }
  if (Date.parse(stub.expiresAt) <= Date.now()) throw visualError('VISUAL_MATCH_STUB_EXPIRED', 'projection stub expired', 409);
}

function createProofReplayKey(proof, entityKey) {
  return sha256Json({
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
    entityKey,
  });
}

function bindingPolicyForType(type) {
  if (type === 'scene') return 'scene-ttl';
  if (type === 'character') return 'session-fixed';
  if (['equipment', 'item', 'skill'].includes(type)) return 'entity-first-seen-fixed';
  throw visualError('VISUAL_MATCH_BINDING_POLICY_INVALID', 'binding type has no public policy', 500);
}

function serializeAdminAsset(asset) {
  validateAsset(asset);
  return {
    ...asset,
    analysis: {
      schemaVersion: asset.analysis.schemaVersion,
      status: asset.analysis.status,
      description: asset.analysis.description,
      confidence: asset.analysis.confidence,
      analyzerVersion: asset.analysis.analyzerVersion,
      tagCodes: asset.analysis.tagCodes,
      attributeCodes: asset.analysis.attributeCodes,
      errorCode: asset.analysis.errorCode,
      dictionaryVersion: asset.analysis.dictionaryVersion,
      dictionaryHash: asset.analysis.dictionaryHash,
    },
  };
}

function serializePlayerSafeCatalog(catalog) {
  validateCatalog(catalog);
  return {
    schemaVersion: catalog.schemaVersion,
    catalogId: catalog.catalogId,
    catalogRevision: catalog.catalogRevision,
    catalogHash: catalog.catalogHash,
    status: catalog.status,
    assetRefs: catalog.assetRefs,
    unknownAssetRefs: catalog.unknownAssetRefs,
    dictionaryVersion: catalog.dictionaryVersion,
    dictionaryHash: catalog.dictionaryHash,
    createdAt: catalog.createdAt,
    updatedAt: catalog.updatedAt,
    publishedAt: catalog.publishedAt,
    archivedAt: catalog.archivedAt,
  };
}

function validateCatalog(catalog) {
  requireExactKeys(catalog, [
    'schemaVersion',
    'catalogId',
    'catalogRevision',
    'status',
    'assetRefs',
    'unknownAssetRefs',
    'dictionaryVersion',
    'dictionaryHash',
    'createdAt',
    'updatedAt',
    'publishedAt',
    'archivedAt',
    'catalogHash',
  ], 'catalog');
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) throw visualError('VISUAL_CATALOG_INVALID_SCHEMA', 'catalog schema invalid', 500);
  assertSafeString(catalog.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(catalog.catalogRevision, 'catalogRevision');
  if (!['draft', 'validated', 'published', 'archived'].includes(catalog.status)) throw visualError('VISUAL_CATALOG_INVALID_STATUS', 'catalog status invalid', 500);
  validateAssetRefs(catalog.assetRefs, 'assetRefs', 512);
  validateAssetRefs(catalog.unknownAssetRefs, 'unknownAssetRefs', 5);
  if (catalog.unknownAssetRefs.length !== 5) throw visualError('VISUAL_CATALOG_UNKNOWN_ASSETS_MISSING', 'unknown asset refs missing', 500);
  if (catalog.dictionaryVersion !== DICTIONARY_VERSION || catalog.dictionaryHash !== DICTIONARY_HASH) throw visualError('VISUAL_CATALOG_DICTIONARY_MISMATCH', 'dictionary mismatch', 500);
  assertSafeString(catalog.createdAt, 'createdAt', 20, 40, /^[0-9TZ:.-]+$/);
  assertSafeString(catalog.updatedAt, 'updatedAt', 20, 40, /^[0-9TZ:.-]+$/);
  if (catalog.publishedAt !== null) assertSafeString(catalog.publishedAt, 'publishedAt', 20, 40, /^[0-9TZ:.-]+$/);
  if (catalog.archivedAt !== null) assertSafeString(catalog.archivedAt, 'archivedAt', 20, 40, /^[0-9TZ:.-]+$/);
  if (catalog.catalogHash !== computeCatalogHash(catalog)) throw visualError('VISUAL_CATALOG_HASH_MISMATCH', 'catalog hash mismatch', 500);
}

function validateAssetRefs(refs, label, maxItems) {
  if (!Array.isArray(refs) || refs.length > maxItems) {
    throw visualError('VISUAL_CATALOG_INVALID_REFS', `${label} invalid`, 400);
  }
  const seen = new Set();
  for (const ref of refs) {
    requireExactKeys(ref, ['assetId', 'assetVersion', 'assetType', 'assetContentSha256', 'assetMetadataHash'], label);
    assertSafeString(ref.assetId, 'assetId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    assertPositiveInteger(ref.assetVersion, 'assetVersion');
    if (!ENTITY_TYPE_SET.has(ref.assetType)) throw visualError('VISUAL_ASSET_INVALID_TYPE', 'asset ref type invalid', 400);
    assertSafeString(ref.assetContentSha256, 'assetContentSha256', 71, 71, /^sha256:[a-f0-9]{64}$/);
    assertSafeString(ref.assetMetadataHash, 'assetMetadataHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
    const key = `${ref.assetId}:${ref.assetVersion}`;
    if (seen.has(key)) throw visualError('VISUAL_CATALOG_DUPLICATE_REF', 'duplicate asset ref', 400);
    seen.add(key);
  }
}

function requireInternalAssetMetadataResolveRequest(body) {
  requireExactKeys(body, VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_KEYS, 'internalAssetMetadataResolve');
  if (body.schemaVersion !== VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_REQUEST_VERSION) throw visualError('VISUAL_ASSET_INTERNAL_INVALID_SCHEMA', 'metadata resolve schema invalid', 400);
  assertInternalAssetIdentityRequest(body);
  return body;
}

function requireInternalAssetContentReadRequest(body) {
  requireExactKeys(body, VISUAL_ASSET_INTERNAL_CONTENT_READ_KEYS, 'internalAssetContentRead');
  if (body.schemaVersion !== VISUAL_ASSET_INTERNAL_CONTENT_READ_REQUEST_VERSION) throw visualError('VISUAL_ASSET_INTERNAL_INVALID_SCHEMA', 'content read schema invalid', 400);
  assertSafeString(body.ticketId, 'ticketId', 28, 84, /^vat_[a-z0-9_-]{24,80}$/);
  assertInternalAssetCommonRequest(body);
  assertSafeString(body.assetMetadataHash, 'assetMetadataHash', 71, 71, SHA256_DIGEST_PATTERN);
  assertSafeString(body.catalogRefHash, 'catalogRefHash', 71, 71, SHA256_DIGEST_PATTERN);
  return body;
}

function assertInternalAssetCommonRequest(body) {
  assertSafeString(body.requestId, 'requestId', 20, 124, /^req_[A-Za-z0-9._:-]{16,120}$/);
  assertSafeString(body.bindingId, 'bindingId', 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
  assertSafeString(body.entityKey, 'entityKey', 15, 96, /^entity_(scene|character|equipment|item|skill)_[a-z0-9._:-]{8,72}$/);
  if (!ENTITY_TYPE_SET.has(body.assetType)) throw visualError('VISUAL_ASSET_INTERNAL_TYPE_INVALID', 'asset type invalid', 400);
  const entityType = body.entityKey.match(/^entity_([^_]+)_/)?.[1];
  if (entityType !== body.assetType) throw visualError('VISUAL_ASSET_INTERNAL_TYPE_MISMATCH', 'entity type mismatch', 409);
  assertInternalAssetIdentityRequest(body);
}

function assertInternalAssetIdentityRequest(body) {
  assertSafeString(body.requestId, 'requestId', 20, 124, /^req_[A-Za-z0-9._:-]{16,120}$/);
  if (!ENTITY_TYPE_SET.has(body.assetType)) throw visualError('VISUAL_ASSET_INTERNAL_TYPE_INVALID', 'asset type invalid', 400);
  assertSafeString(body.assetId, 'assetId', 3, 80, /^(unknown_(scene|character|equipment|item|skill)|[a-z][a-z0-9_-]{2,79})$/);
  if (body.assetId.startsWith('unknown_') && body.assetId !== `unknown_${body.assetType}`) {
    throw visualError('VISUAL_ASSET_INTERNAL_TYPE_MISMATCH', 'unknown asset type mismatch', 409);
  }
  assertPositiveInteger(body.assetVersion, 'assetVersion');
  assertSafeString(body.assetContentSha256, 'assetContentSha256', 71, 71, SHA256_DIGEST_PATTERN);
  assertSafeString(body.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
  assertPositiveInteger(body.catalogRevision, 'catalogRevision');
  assertSafeString(body.catalogHash, 'catalogHash', 71, 71, SHA256_DIGEST_PATTERN);
  if (body.canonicalMime !== PNG_MIME) throw visualError('VISUAL_ASSET_INTERNAL_MIME_MISMATCH', 'only PNG content is supported', 409);
}

function assetToRef(asset) {
  validateAsset(asset);
  return {
    assetId: asset.assetId,
    assetVersion: asset.assetVersion,
    assetType: asset.assetType,
    assetContentSha256: asset.assetContentSha256,
    assetMetadataHash: asset.assetMetadataHash,
  };
}

function createDefaultVisualControl(now = Date.now) {
  return {
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: false,
    activeCatalog: null,
    updatedAt: new Date(now()).toISOString(),
  };
}

function validateVisualControl(control) {
  requireExactKeys(control, ['schemaVersion', 'enabled', 'activeCatalog', 'updatedAt'], 'visualControl');
  if (control.schemaVersion !== VISUAL_CONTROL_SCHEMA_VERSION) throw visualError('VISUAL_CONTROL_INVALID_SCHEMA', 'visual control schema invalid', 500);
  if (typeof control.enabled !== 'boolean') throw visualError('VISUAL_CONTROL_INVALID_FIELD', 'visual control enabled invalid', 500);
  if (control.activeCatalog !== null) {
    requireExactKeys(control.activeCatalog, ['catalogId', 'catalogRevision', 'catalogHash'], 'visualControl.activeCatalog');
    assertSafeString(control.activeCatalog.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    assertPositiveInteger(control.activeCatalog.catalogRevision, 'catalogRevision');
    assertSafeString(control.activeCatalog.catalogHash, 'catalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
  }
  assertSafeString(control.updatedAt, 'updatedAt', 20, 40, /^[0-9TZ:.-]+$/);
}

function serializeVisualControl(control) {
  validateVisualControl(control);
  const activeCatalog = control.activeCatalog ? structuredClone(control.activeCatalog) : null;
  const hasActiveCatalog = activeCatalog !== null;
  return {
    schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    enabled: control.enabled,
    activeCatalog,
    hasActiveCatalog,
    ready: control.enabled && hasActiveCatalog,
    statusCode: control.enabled ? (hasActiveCatalog ? 'visual-enabled' : 'visual-enabled-without-catalog') : 'visual-disabled',
    updatedAt: control.updatedAt,
  };
}

class MemoryVisualControlStore {
  constructor({ now = Date.now } = {}) {
    this.now = now;
    this.control = createDefaultVisualControl(now);
  }

  async initialize() {
    validateVisualControl(this.control);
  }

  async getControl() {
    validateVisualControl(this.control);
    return structuredClone(this.control);
  }

  async setControl(control) {
    validateVisualControl(control);
    this.control = structuredClone(control);
    return this.getControl();
  }

  async enable() {
    const current = await this.getControl();
    return this.setControl({
      ...current,
      enabled: true,
      updatedAt: new Date(this.now()).toISOString(),
    });
  }

  async disable() {
    const current = await this.getControl();
    return this.setControl({
      ...current,
      enabled: false,
      updatedAt: new Date(this.now()).toISOString(),
    });
  }
}

class FileVisualControlStore extends MemoryVisualControlStore {
  constructor(rootDir, options = {}) {
    super(options);
    this.rootDir = path.resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    this.filePath = this.safeJoin('visual-control.json');
    this.load();
  }

  safeJoin(segment) {
    if (typeof segment !== 'string' || segment.length === 0 || path.isAbsolute(segment) || segment.includes('..') || /[\\/]/.test(segment)) {
      throw visualError('VISUAL_CONTROL_STORE_INVALID', 'visual control path segment invalid', 500);
    }
    const resolved = path.resolve(this.rootDir, segment);
    const rootWithSep = this.rootDir.endsWith(path.sep) ? this.rootDir : `${this.rootDir}${path.sep}`;
    if (resolved !== this.rootDir && !resolved.startsWith(rootWithSep)) {
      throw visualError('VISUAL_CONTROL_STORE_INVALID', 'visual control path escaped store root', 500);
    }
    return resolved;
  }

  assertNoSymlink(targetPath, { allowMissing = false } = {}) {
    try {
      const stat = lstatSync(targetPath);
      if (stat.isSymbolicLink()) throw visualError('VISUAL_CONTROL_STORE_INVALID', 'visual control symlink rejected', 500);
      const real = realpathSync(targetPath);
      const rootReal = realpathSync(this.rootDir);
      const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
      if (real !== rootReal && !real.startsWith(rootWithSep)) {
        throw visualError('VISUAL_CONTROL_STORE_INVALID', 'visual control real path escaped store root', 500);
      }
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return;
      throw error;
    }
  }

  load() {
    this.assertNoSymlink(this.rootDir);
    for (const entryName of readdirSync(this.rootDir)) {
      if (entryName === 'visual-control.json') continue;
      if (entryName.startsWith('.tmp-visual-control') || entryName.includes('.tmp')) {
        throw visualError('VISUAL_CONTROL_STORE_INVALID', 'orphan visual control temp file found', 500);
      }
    }
    if (!existsSync(this.filePath)) {
      this.control = createDefaultVisualControl(this.now);
      return;
    }
    this.assertNoSymlink(this.filePath);
    let record;
    try {
      record = parseJsonNoBom(readFileSync(this.filePath));
      validateVisualControl(record);
    } catch (error) {
      if (error?.code?.startsWith?.('VISUAL_CONTROL_') || error?.code === 'VISUAL_ASSET_JSON_BOM_REJECTED') throw error;
      throw visualError('VISUAL_CONTROL_STORE_INVALID', 'visual control file invalid', 500);
    }
    this.control = structuredClone(record);
  }

  async setControl(control) {
    validateVisualControl(control);
    this.assertNoSymlink(this.rootDir);
    this.assertNoSymlink(this.filePath, { allowMissing: true });
    await atomicWriteJson(this.filePath, control);
    return super.setControl(control);
  }
}

class MemoryVisualAssetStore {
  constructor() {
    this.assets = new Map();
    this.catalogs = new Map();
    this.activeCatalogs = new Map();
  }

  async initialize() {
    for (const asset of Object.values(BUILTIN_UNKNOWN_ASSETS)) {
      await this.saveAsset(asset, { allowExactReplay: true });
    }
  }

  key(assetId, assetVersion) {
    return `${assetId}:${assetVersion}`;
  }

  catalogKey(catalogId, catalogRevision) {
    return `${catalogId}:${catalogRevision}`;
  }

  async getAsset(assetId, assetVersion) {
    return this.assets.get(this.key(assetId, assetVersion)) || null;
  }

  async listAssets() {
    return [...this.assets.values()].map((asset) => structuredClone(asset));
  }

  async saveAsset(asset, { allowExactReplay = false } = {}) {
    validateAsset(asset);
    const key = this.key(asset.assetId, asset.assetVersion);
    const existing = this.assets.get(key);
    if (existing) {
      if (allowExactReplay && canonicalJson(existing) === canonicalJson(asset)) {
        return existing;
      }
      throw visualError('VISUAL_ASSET_CONFLICT', 'asset version already exists', 409);
    }
    this.assets.set(key, structuredClone(asset));
    return asset;
  }

  async replaceAsset(asset, previousMetadataHash) {
    validateAsset(asset);
    const key = this.key(asset.assetId, asset.assetVersion);
    const existing = this.assets.get(key);
    if (!existing) throw visualError('VISUAL_ASSET_NOT_FOUND', 'asset not found', 404);
    if (existing.assetMetadataHash !== previousMetadataHash) throw visualError('VISUAL_ASSET_STALE', 'asset metadata changed', 409);
    this.assets.set(key, structuredClone(asset));
    return asset;
  }

  async getCatalog(catalogId, catalogRevision) {
    return this.catalogs.get(this.catalogKey(catalogId, catalogRevision)) || null;
  }

  async listCatalogs() {
    return [...this.catalogs.values()].map((catalog) => structuredClone(catalog));
  }

  async saveCatalog(catalog, { allowExactReplay = false } = {}) {
    validateCatalog(catalog);
    const key = this.catalogKey(catalog.catalogId, catalog.catalogRevision);
    const existing = this.catalogs.get(key);
    if (existing) {
      if (allowExactReplay && canonicalJson(existing) === canonicalJson(catalog)) {
        return existing;
      }
      throw visualError('VISUAL_CATALOG_CONFLICT', 'catalog revision already exists', 409);
    }
    this.catalogs.set(key, structuredClone(catalog));
    return catalog;
  }

  async replaceCatalog(catalog, previousHash) {
    validateCatalog(catalog);
    const key = this.catalogKey(catalog.catalogId, catalog.catalogRevision);
    const existing = this.catalogs.get(key);
    if (!existing) throw visualError('VISUAL_CATALOG_NOT_FOUND', 'catalog not found', 404);
    if (existing.catalogHash !== previousHash) throw visualError('VISUAL_CATALOG_STALE', 'catalog hash changed', 409);
    this.catalogs.set(key, structuredClone(catalog));
    return catalog;
  }

  async setActiveCatalog(catalog) {
    validateCatalog(catalog);
    this.activeCatalogs.set(catalog.catalogId, {
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
    });
  }

  async getActiveCatalog(catalogId) {
    return this.activeCatalogs.get(catalogId) || null;
  }

  async deleteCatalog(catalogId, catalogRevision) {
    this.catalogs.delete(this.catalogKey(catalogId, catalogRevision));
  }

  async deleteActiveCatalog(catalogId) {
    this.activeCatalogs.delete(catalogId);
  }
}

class MemoryContentStore {
  constructor() {
    this.records = new Map();
  }

  async put(bytes, mime) {
    const hash = `sha256:${sha256Hex(bytes)}`;
    const existing = this.records.get(hash);
    if (existing) {
      if (existing.mime !== mime || !existing.bytes.equals(bytes)) throw visualError('VISUAL_ASSET_CONTENT_CONFLICT', 'content hash conflict', 409);
      return { hash, mime };
    }
    this.records.set(hash, { hash, mime, bytes: Buffer.from(bytes) });
    return { hash, mime };
  }

  async get(hash) {
    const record = this.records.get(hash);
    if (!record) return null;
    return { hash: record.hash, mime: record.mime, bytes: Buffer.from(record.bytes) };
  }
}

class FileVisualAssetStore extends MemoryVisualAssetStore {
  constructor(rootDir) {
    super();
    this.rootDir = path.resolve(rootDir);
    this.assetsDir = path.join(this.rootDir, 'assets');
    this.catalogsDir = path.join(this.rootDir, 'catalogs');
    this.activeDir = path.join(this.rootDir, 'active-catalogs');
    this.migrationBatchesDir = path.join(this.rootDir, 'migration-batches');
    this.activeMigrationFile = path.join(this.rootDir, 'active-migration.json');
    this.activeMigrationPointer = null;
    this.migrationBatchId = null;
    this.legacyAssets = new Map();
    this.legacyCatalogs = new Map();
    this.legacyActiveCatalogs = new Map();
    mkdirSync(this.assetsDir, { recursive: true });
    mkdirSync(this.catalogsDir, { recursive: true });
    mkdirSync(this.activeDir, { recursive: true });
    mkdirSync(this.migrationBatchesDir, { recursive: true });
    this.load();
  }

  assertMigrationPath(targetPath, { allowMissing = false } = {}) {
    const root = realpathSync(this.rootDir);
    const resolved = path.resolve(targetPath);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (resolved !== root && !resolved.startsWith(rootWithSep)) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_PATH_INVALID', 'migration path escaped store root', 500);
    }
    let current = root;
    const relative = path.relative(root, resolved);
    for (const part of relative ? relative.split(path.sep) : []) {
      current = path.join(current, part);
      try {
        const stat = lstatSync(current);
        if (stat.isSymbolicLink()) throw visualError('VISUAL_RUNTIME_MIGRATION_SYMLINK_REJECTED', 'migration symlink is not allowed', 500);
        const real = realpathSync(current);
        if (real !== root && !real.startsWith(rootWithSep)) {
          throw visualError('VISUAL_RUNTIME_MIGRATION_PATH_INVALID', 'migration path escaped store root', 500);
        }
      } catch (error) {
        if (allowMissing && error?.code === 'ENOENT') break;
        throw error;
      }
    }
    return resolved;
  }

  migrationBatchPath(batchId, { temporary = false } = {}) {
    assertSafeString(batchId, 'batchId', 38, 38, /^batch_[a-f0-9]{32}$/);
    const dirName = temporary ? `.tmp-${batchId}` : batchId;
    return this.assertMigrationPath(path.join(this.migrationBatchesDir, dirName), { allowMissing: true });
  }

  migrationAssetKey(asset) {
    return `${asset.assetId}:${asset.assetVersion}`;
  }

  migrationSnapshot() {
    return {
      activeMigrationPointer: this.activeMigrationPointer ? structuredClone(this.activeMigrationPointer) : null,
      migrationBatchId: this.migrationBatchId,
      assets: new Map([...this.assets.entries()].map(([key, value]) => [key, structuredClone(value)])),
      catalogs: new Map([...this.catalogs.entries()].map(([key, value]) => [key, structuredClone(value)])),
      activeCatalogs: new Map([...this.activeCatalogs.entries()].map(([key, value]) => [key, structuredClone(value)])),
    };
  }

  async writeMigrationJson(filePath, value) {
    this.assertMigrationPath(filePath, { allowMissing: true });
    return atomicWriteJson(filePath, value);
  }

  async writeActiveMigrationPointer(pointer) {
    this.assertMigrationPath(this.activeMigrationFile, { allowMissing: true });
    return atomicWriteJson(this.activeMigrationFile, pointer);
  }

  migrationRecordFiles(batchDir) {
    const assetsDir = this.assertMigrationPath(path.join(batchDir, 'assets'), { allowMissing: true });
    return { manifest: path.join(batchDir, 'manifest.json'), catalog: path.join(batchDir, 'catalog.json'), pointer: path.join(batchDir, 'active-pointer.json'), assetsDir };
  }

  readMigrationBatchSync(batchDir, expectedBatchId) {
    this.assertMigrationPath(batchDir);
    const files = this.migrationRecordFiles(batchDir);
    for (const requiredPath of [files.manifest, files.catalog, files.pointer, files.assetsDir]) {
      this.assertMigrationPath(requiredPath, { allowMissing: true });
      if (!existsSync(requiredPath)) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration batch is incomplete', 500);
    }
    const entries = readdirSync(batchDir).sort();
    if (entries.join('\n') !== 'active-pointer.json\nassets\ncatalog.json\nmanifest.json') {
      throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration batch has unexpected files', 500);
    }
    const manifest = parseJsonNoBom(readFileSync(files.manifest));
    requireExactKeys(manifest, [
      'schemaVersion', 'batchId', 'sourceCatalogId', 'sourceCatalogRevision', 'sourceCatalogHash',
      'targetCatalogId', 'targetCatalogRevision', 'targetCatalogHash', 'assetKeys', 'contentHashes', 'state',
    ], 'migrationManifest');
    if (manifest.schemaVersion !== RUNTIME_MIGRATION_BATCH_SCHEMA_VERSION || manifest.batchId !== expectedBatchId || manifest.state !== 'staged') {
      throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration manifest is invalid', 500);
    }
    assertSafeString(manifest.sourceCatalogId, 'sourceCatalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    assertPositiveInteger(manifest.sourceCatalogRevision, 'sourceCatalogRevision');
    assertSafeString(manifest.sourceCatalogHash, 'sourceCatalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
    assertSafeString(manifest.targetCatalogId, 'targetCatalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    assertPositiveInteger(manifest.targetCatalogRevision, 'targetCatalogRevision');
    assertSafeString(manifest.targetCatalogHash, 'targetCatalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
    if (!Array.isArray(manifest.assetKeys) || !Array.isArray(manifest.contentHashes) || manifest.assetKeys.length !== manifest.contentHashes.length) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration manifest assets are invalid', 500);
    }
    const seenKeys = new Set();
    for (const [index, key] of manifest.assetKeys.entries()) {
      assertSafeString(key, `assetKeys[${index}]`, 5, 162, /^[a-z][a-z0-9_-]{2,79}:[1-9][0-9]{0,8}$/);
      if (seenKeys.has(key)) throw visualError('VISUAL_RUNTIME_MIGRATION_DUPLICATE_RECORD', 'migration manifest has duplicate asset', 500);
      seenKeys.add(key);
      assertSafeString(manifest.contentHashes[index], `contentHashes[${index}]`, 71, 71, /^sha256:[a-f0-9]{64}$/);
    }
    const catalogRecord = parseJsonNoBom(readFileSync(files.catalog));
    requireExactKeys(catalogRecord, ['schemaVersion', 'catalog'], 'migrationCatalogRecord');
    if (catalogRecord.schemaVersion !== CATALOG_STORE_SCHEMA_VERSION) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration catalog schema invalid', 500);
    validateCatalog(catalogRecord.catalog);
    if (catalogRecord.catalog.status !== 'published' || catalogRecord.catalog.catalogHash !== manifest.targetCatalogHash || catalogRecord.catalog.catalogId !== manifest.targetCatalogId || catalogRecord.catalog.catalogRevision !== manifest.targetCatalogRevision) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration catalog identity invalid', 500);
    }
    const pointer = parseJsonNoBom(readFileSync(files.pointer));
    requireExactKeys(pointer, ['schemaVersion', 'batchId', 'catalogId', 'catalogRevision', 'catalogHash'], 'migrationPointer');
    if (pointer.schemaVersion !== RUNTIME_MIGRATION_POINTER_SCHEMA_VERSION || pointer.batchId !== expectedBatchId || pointer.catalogId !== manifest.targetCatalogId || pointer.catalogRevision !== manifest.targetCatalogRevision || pointer.catalogHash !== manifest.targetCatalogHash) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID', 'migration commit marker invalid', 500);
    }
    assertPositiveInteger(pointer.catalogRevision, 'migrationPointer.catalogRevision');
    assertSafeString(pointer.catalogId, 'migrationPointer.catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    assertSafeString(pointer.catalogHash, 'migrationPointer.catalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
    const assets = [];
    const assetsByKey = new Map();
    const manifestHashesByKey = new Map(manifest.assetKeys.map((key, index) => [key, manifest.contentHashes[index]]));
    const assetEntries = readdirSync(files.assetsDir).sort();
    for (const fileName of assetEntries) {
      if (!/^[a-z][a-z0-9_-]{2,79}-[1-9][0-9]{0,8}\.json$/.test(fileName)) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration asset filename invalid', 500);
      const assetPath = path.join(files.assetsDir, fileName);
      this.assertMigrationPath(assetPath);
      const record = parseJsonNoBom(readFileSync(assetPath));
      requireExactKeys(record, ['schemaVersion', 'asset'], 'migrationAssetRecord');
      if (record.schemaVersion !== ASSET_STORE_SCHEMA_VERSION) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration asset schema invalid', 500);
      validateAsset(record.asset);
      const key = this.migrationAssetKey(record.asset);
      if (key !== fileName.slice(0, -5).replace(/-(\d+)$/, ':$1')) {
        throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration asset key mismatch', 500);
      }
      if (!manifestHashesByKey.has(key) || record.asset.status !== 'published' || record.asset.dictionaryVersion !== DICTIONARY_VERSION || record.asset.assetContentSha256 !== manifestHashesByKey.get(key)) {
        throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration asset identity invalid', 500);
      }
      if (assetsByKey.has(key)) throw visualError('VISUAL_RUNTIME_MIGRATION_DUPLICATE_RECORD', 'migration batch has duplicate asset', 500);
      assetsByKey.set(key, record.asset);
      assets.push(record.asset);
    }
    if (assets.length !== manifest.assetKeys.length || assets.length !== catalogRecord.catalog.assetRefs.length || assetsByKey.size !== manifestHashesByKey.size) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration asset count mismatch', 500);
    }
    const orderedAssets = [];
    for (const ref of catalogRecord.catalog.assetRefs) {
      const asset = assetsByKey.get(this.migrationAssetKey(ref));
      if (!asset || canonicalJson(ref) !== canonicalJson(assetToRef(asset))) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration catalog ref mismatch', 500);
      orderedAssets.push(asset);
    }
    return { manifest, catalog: catalogRecord.catalog, pointer, assets: orderedAssets };
  }

  applyMigrationBatch(batch) {
    for (const asset of batch.assets) this.assets.set(this.key(asset.assetId, asset.assetVersion), structuredClone(asset));
    this.catalogs.set(this.catalogKey(batch.catalog.catalogId, batch.catalog.catalogRevision), structuredClone(batch.catalog));
    this.activeCatalogs.set(batch.pointer.catalogId, {
      catalogId: batch.pointer.catalogId,
      catalogRevision: batch.pointer.catalogRevision,
      catalogHash: batch.pointer.catalogHash,
    });
    this.activeMigrationPointer = structuredClone(batch.pointer);
    this.migrationBatchId = batch.pointer.batchId;
  }

  async getActiveMigrationSource() {
    if (this.activeMigrationPointer) {
      const catalog = this.catalogs.get(this.catalogKey(this.activeMigrationPointer.catalogId, this.activeMigrationPointer.catalogRevision));
      if (catalog && catalog.catalogHash === this.activeMigrationPointer.catalogHash) {
        const assets = catalog.assetRefs.map((ref) => this.assets.get(this.key(ref.assetId, ref.assetVersion))).filter(Boolean).map((asset) => structuredClone(asset));
        if (assets.length !== catalog.assetRefs.length) throw visualError('VISUAL_RUNTIME_MIGRATION_ASSET_MISSING', 'active migration catalog asset is missing', 409);
        return { catalog: structuredClone(catalog), assets };
      }
      throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'active migration pointer is stale', 409);
    }
    if (this.legacyActiveCatalogs.size > 1) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_AMBIGUOUS', 'multiple legacy active catalogs found', 409);
    }
    if (this.legacyActiveCatalogs.size === 1) {
      const pointer = [...this.legacyActiveCatalogs.values()][0];
      const catalog = this.legacyCatalogs.get(this.catalogKey(pointer.catalogId, pointer.catalogRevision));
      if (!catalog || catalog.catalogHash !== pointer.catalogHash) {
        throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'legacy active catalog pointer is stale', 409);
      }
      const assets = [];
      for (const ref of catalog.assetRefs) {
        const asset = this.legacyAssets.get(this.key(ref.assetId, ref.assetVersion));
        if (!asset) throw visualError('VISUAL_RUNTIME_MIGRATION_ASSET_MISSING', 'legacy active catalog asset is missing', 409);
        assertLegacyVisualAsset(asset);
        if (canonicalJson(ref) !== canonicalJson(legacyAssetRef(asset))) {
          throw visualError('VISUAL_RUNTIME_MIGRATION_REF_MISMATCH', 'legacy active catalog ref does not match asset', 409);
        }
        assets.push(structuredClone(asset));
      }
      return { catalog: structuredClone(catalog), assets };
    }
    if (this.activeCatalogs.size > 1) throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_AMBIGUOUS', 'multiple active catalogs found', 409);
    if (this.activeCatalogs.size === 1) {
      const pointer = [...this.activeCatalogs.values()][0];
      const catalog = this.catalogs.get(this.catalogKey(pointer.catalogId, pointer.catalogRevision));
      if (!catalog || catalog.catalogHash !== pointer.catalogHash) throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'active catalog pointer is stale', 409);
      const assets = [];
      for (const ref of catalog.assetRefs) {
        const asset = this.assets.get(this.key(ref.assetId, ref.assetVersion));
        if (!asset) throw visualError('VISUAL_RUNTIME_MIGRATION_ASSET_MISSING', 'active catalog asset is missing', 409);
        assets.push(structuredClone(asset));
      }
      return { catalog: structuredClone(catalog), assets };
    }
    throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_MISSING', 'no active catalog is available for migration', 409);
  }

  readActiveMigrationPointerSync() {
    if (!existsSync(this.activeMigrationFile)) return null;
    this.assertMigrationPath(this.activeMigrationFile);
    try {
      const pointer = parseJsonNoBom(readFileSync(this.activeMigrationFile));
      requireExactKeys(pointer, ['schemaVersion', 'batchId', 'catalogId', 'catalogRevision', 'catalogHash'], 'activeMigrationPointer');
      if (pointer.schemaVersion !== RUNTIME_MIGRATION_POINTER_SCHEMA_VERSION) throw visualError('VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID', 'active migration pointer schema invalid', 500);
      assertSafeString(pointer.batchId, 'activeMigrationPointer.batchId', 38, 38, /^batch_[a-f0-9]{32}$/);
      assertSafeString(pointer.catalogId, 'activeMigrationPointer.catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
      assertPositiveInteger(pointer.catalogRevision, 'activeMigrationPointer.catalogRevision');
      assertSafeString(pointer.catalogHash, 'activeMigrationPointer.catalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
      return pointer;
    } catch (error) {
      if (error?.code?.startsWith?.('VISUAL_RUNTIME_MIGRATION_')) throw error;
      throw visualError('VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID', 'active migration pointer invalid', 500);
    }
  }

  loadMigrationState() {
    this.assertMigrationPath(this.migrationBatchesDir);
    const committedPointer = this.readActiveMigrationPointerSync();
    let committedBatch = null;
    for (const entryName of readdirSync(this.migrationBatchesDir).sort()) {
      const entryPath = path.join(this.migrationBatchesDir, entryName);
      this.assertMigrationPath(entryPath);
      if (entryName.startsWith('.tmp-')) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INCOMPLETE', 'orphan migration temp batch found', 500);
      if (!/^batch_[a-f0-9]{32}$/.test(entryName)) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'migration batch name invalid', 500);
      const batch = this.readMigrationBatchSync(entryPath, entryName);
      if (committedPointer?.batchId === entryName) {
        committedBatch = batch;
      } else {
        rmSync(entryPath, { recursive: true, force: true });
      }
    }
    if (!committedPointer) return;
    if (!committedBatch) throw visualError('VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID', 'active migration batch missing', 500);
    if (canonicalJson(committedBatch.pointer) !== canonicalJson(committedPointer)) throw visualError('VISUAL_RUNTIME_MIGRATION_COMMIT_INVALID', 'active migration pointer mismatch', 500);
    this.applyMigrationBatch(committedBatch);
  }

  createRuntimeV2MigrationTransaction() {
    let batchId = null;
    let alreadyActive = false;
    return {
      snapshot: async () => this.migrationSnapshot(),
      stage: async (plan) => {
        if (this.activeMigrationPointer?.catalogId === plan.catalog.catalogId && this.activeMigrationPointer.catalogRevision === plan.catalog.catalogRevision && this.activeMigrationPointer.catalogHash === plan.catalog.catalogHash) {
          alreadyActive = true;
          return;
        }
        batchId = `batch_${randomBytes(16).toString('hex')}`;
        const tempDir = this.migrationBatchPath(batchId, { temporary: true });
        const files = this.migrationRecordFiles(tempDir);
        const manifest = {
          schemaVersion: RUNTIME_MIGRATION_BATCH_SCHEMA_VERSION,
          batchId,
          sourceCatalogId: plan.catalog.catalogId,
          sourceCatalogRevision: plan.catalog.catalogRevision,
          sourceCatalogHash: plan.catalog.catalogHash,
          targetCatalogId: plan.catalog.catalogId,
          targetCatalogRevision: plan.catalog.catalogRevision,
          targetCatalogHash: plan.catalog.catalogHash,
          assetKeys: plan.assets.map((asset) => this.migrationAssetKey(asset)),
          contentHashes: plan.assets.map((asset) => asset.assetContentSha256),
          state: 'staged',
        };
        const pointer = {
          schemaVersion: RUNTIME_MIGRATION_POINTER_SCHEMA_VERSION,
          batchId,
          catalogId: plan.catalog.catalogId,
          catalogRevision: plan.catalog.catalogRevision,
          catalogHash: plan.catalog.catalogHash,
        };
        try {
          await mkdir(tempDir, { recursive: false });
          await mkdir(files.assetsDir, { recursive: false });
          for (const asset of plan.assets) {
            validateAsset(asset);
            await this.writeMigrationJson(path.join(files.assetsDir, `${asset.assetId}-${asset.assetVersion}.json`), { schemaVersion: ASSET_STORE_SCHEMA_VERSION, asset });
          }
          await this.writeMigrationJson(files.catalog, { schemaVersion: CATALOG_STORE_SCHEMA_VERSION, catalog: plan.catalog });
          await this.writeMigrationJson(files.pointer, pointer);
          await this.writeMigrationJson(files.manifest, manifest);
          const staged = this.readMigrationBatchSync(tempDir, batchId);
          if (staged.catalog.catalogHash !== plan.catalog.catalogHash) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'staged migration catalog changed', 500);
        } catch (error) {
          await rm(tempDir, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
      },
      activate: async (plan) => {
        if (alreadyActive) return;
        const tempDir = this.migrationBatchPath(batchId, { temporary: true });
        const finalDir = this.migrationBatchPath(batchId);
        const staged = this.readMigrationBatchSync(tempDir, batchId);
        if (staged.catalog.catalogHash !== plan.catalog.catalogHash) throw visualError('VISUAL_RUNTIME_MIGRATION_BATCH_INVALID', 'staged migration plan mismatch', 409);
        await rename(tempDir, finalDir);
        try {
          await this.writeActiveMigrationPointer(staged.pointer);
          const committed = this.readMigrationBatchSync(finalDir, batchId);
          this.applyMigrationBatch(committed);
        } catch (error) {
          throw error;
        }
      },
      rollback: async (snapshot) => {
        if (batchId) {
          await rm(this.migrationBatchPath(batchId, { temporary: true }), { recursive: true, force: true }).catch(() => {});
          await rm(this.migrationBatchPath(batchId), { recursive: true, force: true }).catch(() => {});
        }
        if (snapshot?.activeMigrationPointer) {
          await atomicWriteJson(this.activeMigrationFile, snapshot.activeMigrationPointer);
        } else {
          await rm(this.activeMigrationFile, { force: true }).catch(() => {});
        }
        if (snapshot) {
          this.assets = new Map([...snapshot.assets.entries()].map(([key, value]) => [key, structuredClone(value)]));
          this.catalogs = new Map([...snapshot.catalogs.entries()].map(([key, value]) => [key, structuredClone(value)]));
          this.activeCatalogs = new Map([...snapshot.activeCatalogs.entries()].map(([key, value]) => [key, structuredClone(value)]));
          this.activeMigrationPointer = snapshot.activeMigrationPointer ? structuredClone(snapshot.activeMigrationPointer) : null;
          this.migrationBatchId = snapshot.migrationBatchId || null;
        }
      },
    };
  }

  load() {
    for (const fileName of readdirSync(this.assetsDir)) {
      if (!fileName.endsWith('.json')) continue;
      const record = parseJsonNoBom(readFileSync(path.join(this.assetsDir, fileName)));
      requireExactKeys(record, ['schemaVersion', 'asset'], 'assetRecord');
      if (record.schemaVersion !== ASSET_STORE_SCHEMA_VERSION) throw visualError('VISUAL_ASSET_METADATA_INVALID', 'asset record schema invalid', 500);
      if (record.asset.dictionaryVersion === LEGACY_DICTIONARY_VERSION) {
        assertLegacyVisualAsset(record.asset);
        const legacyKey = this.key(record.asset.assetId, record.asset.assetVersion);
        if (this.legacyAssets.has(legacyKey)) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'duplicate legacy asset record', 500);
        this.legacyAssets.set(legacyKey, record.asset);
        continue;
      }
      validateAsset(record.asset);
      const key = this.key(record.asset.assetId, record.asset.assetVersion);
      if (this.assets.has(key)) throw visualError('VISUAL_ASSET_METADATA_INVALID', 'duplicate asset record', 500);
      this.assets.set(key, record.asset);
    }
    for (const fileName of readdirSync(this.catalogsDir)) {
      if (!fileName.endsWith('.json')) continue;
      const record = parseJsonNoBom(readFileSync(path.join(this.catalogsDir, fileName)));
      requireExactKeys(record, ['schemaVersion', 'catalog'], 'catalogRecord');
      if (record.schemaVersion !== CATALOG_STORE_SCHEMA_VERSION) throw visualError('VISUAL_CATALOG_METADATA_INVALID', 'catalog record schema invalid', 500);
      if (record.catalog.dictionaryVersion === LEGACY_DICTIONARY_VERSION) {
        assertLegacyVisualCatalog(record.catalog);
        const legacyKey = this.catalogKey(record.catalog.catalogId, record.catalog.catalogRevision);
        if (this.legacyCatalogs.has(legacyKey)) throw visualError('VISUAL_RUNTIME_MIGRATION_INVALID', 'duplicate legacy catalog record', 500);
        this.legacyCatalogs.set(legacyKey, record.catalog);
        continue;
      }
      validateCatalog(record.catalog);
      const key = this.catalogKey(record.catalog.catalogId, record.catalog.catalogRevision);
      if (this.catalogs.has(key)) throw visualError('VISUAL_CATALOG_METADATA_INVALID', 'duplicate catalog record', 500);
      this.catalogs.set(key, record.catalog);
    }
    for (const fileName of readdirSync(this.activeDir)) {
      if (!fileName.endsWith('.json')) continue;
      const record = parseJsonNoBom(readFileSync(path.join(this.activeDir, fileName)));
      requireExactKeys(record, ['catalogId', 'catalogRevision', 'catalogHash'], 'activeCatalogRecord');
      assertSafeString(record.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
      assertPositiveInteger(record.catalogRevision, 'catalogRevision');
      assertSafeString(record.catalogHash, 'catalogHash', 71, 71, /^sha256:[a-f0-9]{64}$/);
      const key = this.catalogKey(record.catalogId, record.catalogRevision);
      const catalog = this.catalogs.get(key);
      const legacyCatalog = this.legacyCatalogs.get(key);
      if (catalog) {
        if (catalog.catalogHash !== record.catalogHash) throw visualError('VISUAL_CATALOG_METADATA_INVALID', 'active catalog pointer invalid', 500);
        this.activeCatalogs.set(record.catalogId, record);
      } else if (legacyCatalog) {
        if (legacyCatalog.catalogHash !== record.catalogHash) throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'legacy active catalog pointer invalid', 500);
        this.legacyActiveCatalogs.set(record.catalogId, record);
      } else {
        throw visualError('VISUAL_CATALOG_METADATA_INVALID', 'active catalog pointer invalid', 500);
      }
    }
    this.loadMigrationState();
  }

  async saveAsset(asset, options = {}) {
    const saved = await super.saveAsset(asset, options);
    await atomicWriteJson(path.join(this.assetsDir, `${asset.assetId}-${asset.assetVersion}.json`), {
      schemaVersion: ASSET_STORE_SCHEMA_VERSION,
      asset: saved,
    });
    return saved;
  }

  async replaceAsset(asset, previousMetadataHash) {
    const saved = await super.replaceAsset(asset, previousMetadataHash);
    await atomicWriteJson(path.join(this.assetsDir, `${asset.assetId}-${asset.assetVersion}.json`), {
      schemaVersion: ASSET_STORE_SCHEMA_VERSION,
      asset: saved,
    });
    return saved;
  }

  async saveCatalog(catalog, options = {}) {
    const saved = await super.saveCatalog(catalog, options);
    await atomicWriteJson(path.join(this.catalogsDir, `${catalog.catalogId}-${catalog.catalogRevision}.json`), {
      schemaVersion: CATALOG_STORE_SCHEMA_VERSION,
      catalog: saved,
    });
    return saved;
  }

  async replaceCatalog(catalog, previousHash) {
    const saved = await super.replaceCatalog(catalog, previousHash);
    await atomicWriteJson(path.join(this.catalogsDir, `${catalog.catalogId}-${catalog.catalogRevision}.json`), {
      schemaVersion: CATALOG_STORE_SCHEMA_VERSION,
      catalog: saved,
    });
    return saved;
  }

  async setActiveCatalog(catalog) {
    await super.setActiveCatalog(catalog);
    await atomicWriteJson(path.join(this.activeDir, `${catalog.catalogId}.json`), {
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
    });
  }

  async deleteCatalog(catalogId, catalogRevision) {
    await rm(path.join(this.catalogsDir, `${catalogId}-${catalogRevision}.json`), { force: true });
    await super.deleteCatalog(catalogId, catalogRevision);
  }

  async deleteActiveCatalog(catalogId) {
    await rm(path.join(this.activeDir, `${catalogId}.json`), { force: true });
    await super.deleteActiveCatalog(catalogId);
  }
}

class FileContentStore extends MemoryContentStore {
  constructor(rootDir) {
    super();
    this.rootDir = rootDir;
    this.recordsDir = path.join(rootDir, 'records');
    mkdirSync(this.recordsDir, { recursive: true });
    this.load();
  }

  fileNameForHash(hash) {
    assertSafeString(hash, 'hash', 71, 71, /^sha256:[a-f0-9]{64}$/);
    return hash.slice('sha256:'.length);
  }

  load() {
    for (const entryName of readdirSync(this.recordsDir)) {
      if (entryName.startsWith('.tmp-')) {
        throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'orphan content temp record found', 500);
      }
      if (!/^[a-f0-9]{64}$/.test(entryName)) {
        throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content record name invalid', 500);
      }
      const record = this.readRecordSync(`sha256:${entryName}`);
      this.records.set(record.hash, record);
    }
  }

  async put(bytes, mime) {
    const hash = `sha256:${sha256Hex(bytes)}`;
    const fileName = this.fileNameForHash(hash);
    const recordDir = path.join(this.recordsDir, fileName);
    if (existsSync(recordDir)) {
      const existing = await this.get(hash);
      if (!existing || existing.mime !== mime || !existing.bytes.equals(bytes)) {
        throw visualError('VISUAL_ASSET_CONTENT_CONFLICT', 'content hash conflict', 409);
      }
      return { hash, mime };
    }
    const tmpDir = path.join(this.recordsDir, `.tmp-${fileName}-${process.pid}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: false });
    try {
      await writeFile(path.join(tmpDir, 'bytes.bin'), bytes, { flag: 'wx' });
      await writeFile(path.join(tmpDir, 'record.json'), Buffer.from(`${canonicalJson({
        schemaVersion: 'galgame.visual-asset-content-store-record.v1',
        hash,
        mime,
        size: bytes.length,
      })}\n`, 'utf8'), { flag: 'wx' });
      await rename(tmpDir, recordDir);
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (existsSync(recordDir)) {
        const existing = await this.get(hash);
        if (existing && existing.mime === mime && existing.bytes.equals(bytes)) return { hash, mime };
      }
      throw error;
    }
    this.records.set(hash, { hash, mime, bytes: Buffer.from(bytes) });
    return { hash, mime };
  }

  readRecordSync(hash) {
    const fileName = this.fileNameForHash(hash);
    const recordDir = path.join(this.recordsDir, fileName);
    const bytesPath = path.join(recordDir, 'bytes.bin');
    const metaPath = path.join(recordDir, 'record.json');
    if (!existsSync(bytesPath) || !existsSync(metaPath)) {
      throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content record is incomplete', 500);
    }
    const entries = readdirSync(recordDir).sort();
    if (entries.join('\n') !== 'bytes.bin\nrecord.json') {
      throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content record has unexpected files', 500);
    }
    const bytes = readFileSync(bytesPath);
    const meta = parseJsonNoBom(readFileSync(metaPath));
    validateContentRecord(meta, hash, bytes);
    return { hash, mime: meta.mime, bytes: Buffer.from(bytes) };
  }

  async get(hash) {
    const fileName = this.fileNameForHash(hash);
    const recordDir = path.join(this.recordsDir, fileName);
    if (!existsSync(recordDir)) return null;
    const bytes = await readFile(path.join(recordDir, 'bytes.bin')).catch(() => null);
    const metaBytes = await readFile(path.join(recordDir, 'record.json')).catch(() => null);
    if (!bytes || !metaBytes) {
      throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content record is incomplete', 409);
    }
    const entries = readdirSync(recordDir).sort();
    if (entries.join('\n') !== 'bytes.bin\nrecord.json') {
      throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content record has unexpected files', 409);
    }
    const meta = parseJsonNoBom(metaBytes);
    validateContentRecord(meta, hash, bytes, 409);
    return { hash, mime: meta.mime, bytes };
  }
}

class MemoryVisualAnalysisCacheStore {
  constructor() {
    this.records = new Map();
  }

  async initialize() {
    for (const record of this.records.values()) {
      validateVisualAnalysisCacheRecord(record);
    }
  }

  async get(cacheKey) {
    assertSafeString(cacheKey, 'cacheKey', 71, 71, SHA256_DIGEST_PATTERN);
    const record = this.records.get(cacheKey);
    return record ? structuredClone(record) : null;
  }

  async set(record) {
    validateVisualAnalysisCacheRecord(record);
    this.records.set(record.cacheKey, structuredClone(record));
    return structuredClone(record);
  }
}

class FileVisualAnalysisCacheStore extends MemoryVisualAnalysisCacheStore {
  constructor(rootDir) {
    super();
    this.rootDir = path.resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    this.load();
  }

  assertNoSymlink(targetPath, { allowMissing = false } = {}) {
    try {
      const stat = lstatSync(targetPath);
      if (stat.isSymbolicLink()) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache symlink rejected', 500);
      const real = realpathSync(targetPath);
      const rootReal = realpathSync(this.rootDir);
      const rootWithSep = rootReal.endsWith(path.sep) ? rootReal : `${rootReal}${path.sep}`;
      if (real !== rootReal && !real.startsWith(rootWithSep)) {
        throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache path escaped store root', 500);
      }
    } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return;
      throw error;
    }
  }

  filePathForKey(cacheKey) {
    assertSafeString(cacheKey, 'cacheKey', 71, 71, SHA256_DIGEST_PATTERN);
    const fileName = `${cacheKey.slice('sha256:'.length)}.json`;
    const resolved = path.resolve(this.rootDir, fileName);
    const rootWithSep = this.rootDir.endsWith(path.sep) ? this.rootDir : `${this.rootDir}${path.sep}`;
    if (!resolved.startsWith(rootWithSep)) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache path escaped store root', 500);
    return resolved;
  }

  load() {
    this.assertNoSymlink(this.rootDir);
    for (const entryName of readdirSync(this.rootDir)) {
      if (entryName.startsWith('.tmp-')) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'orphan analysis cache temp file found', 500);
      if (!/^[a-f0-9]{64}\.json$/.test(entryName)) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache filename invalid', 500);
      const filePath = path.join(this.rootDir, entryName);
      this.assertNoSymlink(filePath);
      let record;
      try {
        record = parseJsonNoBom(readFileSync(filePath));
        validateVisualAnalysisCacheRecord(record);
      } catch (error) {
        if (error?.code?.startsWith?.('VISUAL_ANALYSIS_') || error?.code === 'VISUAL_ASSET_JSON_BOM_REJECTED') throw error;
        throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache record invalid', 500);
      }
      const expectedFileName = `${record.cacheKey.slice('sha256:'.length)}.json`;
      if (entryName !== expectedFileName) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache filename does not match key', 500);
      if (this.records.has(record.cacheKey)) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'duplicate analysis cache record', 500);
      this.records.set(record.cacheKey, structuredClone(record));
    }
  }

  async set(record) {
    validateVisualAnalysisCacheRecord(record);
    this.assertNoSymlink(this.rootDir);
    const filePath = this.filePathForKey(record.cacheKey);
    this.assertNoSymlink(filePath, { allowMissing: true });
    await atomicWriteJson(filePath, record);
    this.records.set(record.cacheKey, structuredClone(record));
    return structuredClone(record);
  }
}

function validateVisualAnalysisCacheRecord(record) {
  requireExactKeys(record, ['schemaVersion', 'cacheKey', 'assetType', 'contentHash', 'analyzerScopeHash', 'analysis'], 'analysisCacheRecord');
  if (record.schemaVersion !== ANALYSIS_CACHE_RECORD_SCHEMA_VERSION) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache schema invalid', 500);
  assertSafeString(record.cacheKey, 'analysisCacheRecord.cacheKey', 71, 71, SHA256_DIGEST_PATTERN);
  if (!ENTITY_TYPE_SET.has(record.assetType)) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache asset type invalid', 500);
  assertSafeString(record.contentHash, 'analysisCacheRecord.contentHash', 71, 71, SHA256_DIGEST_PATTERN);
  assertSafeString(record.analyzerScopeHash, 'analysisCacheRecord.analyzerScopeHash', 71, 71, SHA256_DIGEST_PATTERN);
  if (record.cacheKey !== sha256Json({
    assetType: record.assetType,
    contentHash: record.contentHash,
    analyzerScopeHash: record.analyzerScopeHash,
  })) throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analysis cache key mismatch', 500);
  validateVisualAnalysis(record.analysis, record.assetType);
}

function buildRetentionPackage(store, { retentionId, bindingIds, retentionUntil, createdAt = nowIso(Date.now) }) {
  assertSafeString(retentionId, 'retentionId', 22, 86, /^vbrtn_[a-z0-9_-]{16,80}$/);
  assertBindingIdArray(bindingIds, 'bindingIds', 500);
  assertIsoTimestamp(retentionUntil, 'retentionUntil');
  assertIsoTimestamp(createdAt, 'createdAt');
  const records = bindingIds.map((bindingId) => {
    const record = store.records.get(bindingId);
    if (!record) throw visualError('VISUAL_RESTORE_BINDING_NOT_FOUND', 'binding not found for retention', 404);
    return record;
  });
  const first = records[0];
  const releaseScopeHash = createReleaseScopeHash(first);
  for (const record of records) {
    if (
      createReleaseScopeHash(record) !== releaseScopeHash
      || record.releaseId !== first.releaseId
      || record.scenarioId !== first.scenarioId
      || record.scenarioVersion !== first.scenarioVersion
      || record.arcId !== first.arcId
      || record.visualProfileId !== first.visualProfileId
      || record.profileHash !== first.profileHash
      || record.catalogId !== first.catalogId
      || record.catalogRevision !== first.catalogRevision
      || record.catalogHash !== first.catalogHash
      || record.dictionaryVersion !== first.dictionaryVersion
      || record.dictionaryHash !== first.dictionaryHash
    ) {
      throw visualError('VISUAL_RESTORE_RETENTION_SCOPE_MISMATCH', 'retained bindings have mixed scope', 409);
    }
  }
  const retentionBase = {
    schemaVersion: VISUAL_BINDING_RETENTION_SCHEMA_VERSION,
    retentionId,
    retentionPolicy: 'release-bound-365d',
    gcState: 'active',
    bindingIds: [...bindingIds],
    releaseId: first.releaseId,
    releaseScopeHash,
    scenarioId: first.scenarioId,
    scenarioVersion: first.scenarioVersion,
    arcId: first.arcId,
    visualProfileId: first.visualProfileId,
    visualProfileHash: first.profileHash,
    catalogId: first.catalogId,
    catalogRevision: first.catalogRevision,
    catalogHash: first.catalogHash,
    dictionaryVersion: first.dictionaryVersion,
    dictionaryHash: first.dictionaryHash,
    createdAt,
    retentionUntil,
    retentionHash: ZERO_SHA256_DIGEST,
  };
  const retention = { ...retentionBase, retentionHash: computeRetentionHash(retentionBase) };
  validateBindingRetention(retention);
  const receipts = records.map((record) => createBindingReceipt({ record, retention, createdAt }));
  const existingRetention = store.retentions.get(retention.retentionId);
  if (existingRetention && canonicalJson(existingRetention) !== canonicalJson(retention)) {
    throw visualError('VISUAL_RESTORE_RETENTION_LINK_MISMATCH', 'retention id conflicts', 409);
  }
  for (const receipt of receipts) {
    const existingBindingReceiptId = store.receiptByBindingId.get(receipt.bindingId);
    if (existingBindingReceiptId) {
      const existingReceipt = store.receipts.get(existingBindingReceiptId);
      if (!existingReceipt || canonicalJson(existingReceipt) !== canonicalJson(receipt)) {
        throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'binding receipt conflicts', 409);
      }
    }
    const existingReceipt = store.receipts.get(receipt.receiptId);
    if (existingReceipt && canonicalJson(existingReceipt) !== canonicalJson(receipt)) {
      throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt id conflicts', 409);
    }
  }
  return { retention, receipts };
}

class MemoryVisualBindingStore {
  constructor() {
    this.records = new Map();
    this.bindings = new Map();
    this.results = new Map();
    this.receipts = new Map();
    this.retentions = new Map();
    this.receiptByBindingId = new Map();
    this.idempotencyIndex = new Map();
    this.activeEntityIndex = new Map();
  }

  async initialize() {}

  async saveOrReuse({ record, publicBinding, publicResult, idempotencyKeyHash, activeEntityHash }) {
    validateBindingStoreRecord(record);
    validateStoredPublicArtifacts(record, publicBinding, publicResult);
    const existingIdempotency = this.idempotencyIndex.get(idempotencyKeyHash);
    if (existingIdempotency) return this.requireExactReplay(existingIdempotency, record, publicBinding, publicResult);
    const existingActive = this.activeEntityIndex.get(activeEntityHash);
    if (existingActive) return this.requireActiveReuse(existingActive, record);
    if (this.records.has(record.bindingId)) throw visualError('VISUAL_MATCH_BINDING_CONFLICT', 'binding id already exists', 409);
    this.records.set(record.bindingId, structuredClone(record));
    this.bindings.set(record.bindingId, structuredClone(publicBinding));
    this.results.set(record.bindingId, structuredClone(publicResult));
    this.idempotencyIndex.set(idempotencyKeyHash, record.bindingId);
    this.activeEntityIndex.set(activeEntityHash, record.bindingId);
    return { record, publicBinding, publicResult, reused: false };
  }

  requireExactReplay(bindingId, record, publicBinding, publicResult) {
    const existingRecord = this.records.get(bindingId);
    const existingBinding = this.bindings.get(bindingId);
    const existingResult = this.results.get(bindingId);
    if (!existingRecord || !existingBinding || !existingResult) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding index is dangling', 500);
    }
    if (
      existingRecord.publicBindingHash !== record.publicBindingHash
      || existingRecord.publicResultHash !== record.publicResultHash
      || canonicalJson(existingBinding) !== canonicalJson(publicBinding)
      || canonicalJson(existingResult) !== canonicalJson(publicResult)
    ) {
      throw visualError('VISUAL_MATCH_BINDING_CONFLICT', 'binding replay conflicts with existing decision', 409);
    }
    return {
      record: existingRecord,
      publicBinding: existingBinding,
      publicResult: existingResult,
      reused: true,
    };
  }

  requireActiveReuse(bindingId, record) {
    const existingRecord = this.records.get(bindingId);
    const existingBinding = this.bindings.get(bindingId);
    const existingResult = this.results.get(bindingId);
    if (!existingRecord || !existingBinding || !existingResult) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding index is dangling', 500);
    }
    if (existingRecord.publicResultHash !== record.publicResultHash) {
      throw visualError('VISUAL_MATCH_BINDING_CONFLICT', 'active entity binding conflicts with existing decision', 409);
    }
    return {
      record: existingRecord,
      publicBinding: existingBinding,
      publicResult: existingResult,
      reused: true,
    };
  }

  async retainBindingsForRestore({ retentionId, bindingIds, retentionUntil, createdAt = nowIso(Date.now) }) {
    const { retention, receipts } = buildRetentionPackage(this, { retentionId, bindingIds, retentionUntil, createdAt });
    this.retentions.set(retention.retentionId, structuredClone(retention));
    for (const receipt of receipts) {
      this.receipts.set(receipt.receiptId, structuredClone(receipt));
      this.receiptByBindingId.set(receipt.bindingId, receipt.receiptId);
    }
    return { retention, receipts };
  }

  getRestoreBundle(bindingId) {
    const record = this.records.get(bindingId);
    const publicBinding = this.bindings.get(bindingId);
    const publicResult = this.results.get(bindingId);
    if (!record || !publicBinding || !publicResult) return null;
    const receiptId = this.receiptByBindingId.get(bindingId);
    const receipt = receiptId ? this.receipts.get(receiptId) : null;
    const retention = receipt ? this.retentions.get(receipt.retentionId) : null;
    return { record, publicBinding, publicResult, receipt, retention };
  }
}

class MemoryProofReplayStore {
  constructor(now = Date.now) {
    this.now = now;
    this.entries = new Map();
    this.nonceIndex = new Map();
  }

  replayNonceScopeHash(value) {
    return sha256Json({
      nonce: value.nonce,
      projectionId: value.projectionId,
      projectionHash: value.projectionHash,
      releaseId: value.releaseId,
      scenarioId: value.scenarioId,
      scenarioVersion: value.scenarioVersion,
      arcId: value.arcId,
      chatId: value.chatId,
      profileId: value.profileId,
      profileHash: value.profileHash,
      catalogId: value.catalogId,
      catalogRevision: value.catalogRevision,
      catalogHash: value.catalogHash,
      sourceMessageIndex: value.sourceMessageIndex,
      sourceMessageHash: value.sourceMessageHash,
    });
  }

  prepare(proofReplayKey, proof, entityKey, publicResultHash) {
    const expiresAtMs = Date.parse(proof.expiresAt);
    this.cleanup();
    const value = {
      proofReplayKey,
      nonce: proof.nonce,
      projectionId: proof.projectionId,
      projectionHash: proof.projectionHash,
      releaseId: proof.releaseId,
      scenarioId: proof.scenarioId,
      scenarioVersion: proof.scenarioVersion,
      arcId: proof.arcId,
      chatId: proof.chatId,
      profileId: proof.profileId,
      profileHash: proof.profileHash,
      catalogId: proof.catalogId,
      catalogRevision: proof.catalogRevision,
      catalogHash: proof.catalogHash,
      sourceMessageIndex: proof.sourceMessageIndex,
      sourceMessageHash: proof.sourceMessageHash,
      entityKey,
      publicResultHash,
      expiresAtMs,
    };
    const nonceScopeHash = this.replayNonceScopeHash(value);
    const existing = this.entries.get(proofReplayKey);
    if (existing) {
      const comparable = { ...existing };
      delete comparable.expiresAtMs;
      const current = { ...value };
      delete current.expiresAtMs;
      if (canonicalJson(comparable) !== canonicalJson(current)) {
        throw visualError('VISUAL_MATCH_PROOF_REPLAY_CONFLICT', 'projection proof replay conflicts with existing decision', 409);
      }
      return { reused: true, commit() {}, release() {} };
    }
    const existingNonceScope = this.nonceIndex.get(proof.nonce);
    if (existingNonceScope && existingNonceScope.scopeHash !== nonceScopeHash) {
      throw visualError('VISUAL_MATCH_PROOF_REPLAY_CONFLICT', 'projection proof nonce conflicts with a different replay scope', 409);
    }
    if (existingNonceScope?.keys.has(proofReplayKey)) {
      throw visualError('VISUAL_MATCH_PROOF_REPLAY_CONFLICT', 'projection proof replay index conflicts with missing record', 409);
    }
    let committed = false;
    return {
      reused: false,
      commit: () => {
        if (committed) return;
        this.entries.set(proofReplayKey, value);
        const nonceScope = this.nonceIndex.get(proof.nonce) || { scopeHash: nonceScopeHash, keys: new Set() };
        nonceScope.keys.add(proofReplayKey);
        this.nonceIndex.set(proof.nonce, nonceScope);
        committed = true;
      },
      release: () => {
        committed = false;
      },
    };
  }

  cleanup() {
    const nowMs = this.now();
    for (const [key, value] of this.entries.entries()) {
      if (value.expiresAtMs <= nowMs) {
        this.entries.delete(key);
        const nonceScope = this.nonceIndex.get(value.nonce);
        if (nonceScope) {
          nonceScope.keys.delete(key);
          if (nonceScope.keys.size === 0) this.nonceIndex.delete(value.nonce);
        }
      }
    }
  }
}

class MemoryRestoreReplayStore {
  constructor(now = Date.now) {
    this.now = now;
    this.entries = new Map();
  }

  prepare(restoreReplayKey, value) {
    validateRestoreReplayValue(value);
    if (value.restoreReplayKey !== restoreReplayKey) {
      throw visualError('VISUAL_RESTORE_REPLAY_CONFLICT', 'restore replay key mismatch', 409);
    }
    this.cleanup();
    const existing = this.entries.get(restoreReplayKey);
    if (existing) {
      if (!restoreReplayValuesMatch(existing, value)) {
        throw visualError('VISUAL_RESTORE_REPLAY_CONFLICT', 'restore proof replay conflicts with retained binding', 409);
      }
      return { reused: true, commit() {}, release() {} };
    }
    let committed = false;
    return {
      reused: false,
      commit: () => {
        if (committed) return;
        this.entries.set(restoreReplayKey, structuredClone(value));
        committed = true;
      },
      release: () => {
        committed = false;
      },
    };
  }

  cleanup() {
    const nowMs = this.now();
    for (const [key, value] of this.entries.entries()) {
      if (value.expiresAtMs <= nowMs) this.entries.delete(key);
    }
  }
}

function validateRestoreReplayValue(value) {
  requireExactKeys(value, VISUAL_RESTORE_REPLAY_VALUE_KEYS, 'restoreReplayValue');
  assertSerializedSize(value, 8 * 1024, 'restoreReplayValue');
  assertSha256Digest(value.restoreReplayKey, 'restoreReplayKey');
  assertSha256Digest(value.requestBodyHash, 'requestBodyHash');
  assertSha256Digest(value.proofTokenHash, 'proofTokenHash');
  assertSha256Digest(value.publicBindingHash, 'publicBindingHash');
  assertSha256Digest(value.receiptHash, 'receiptHash');
  assertSha256Digest(value.retentionHash, 'retentionHash');
  if (!isVisualRestoreBindingPath(value.routeKind)) {
    throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay route is invalid', 500);
  }
  assertNonNegativeInteger(value.expiresAtMs, 'expiresAtMs');
  return value;
}

function validateRestoreReplayRecord(record) {
  requireExactKeys(record, VISUAL_RESTORE_REPLAY_RECORD_KEYS, 'restoreReplayRecord');
  assertSerializedSize(record, 12 * 1024, 'restoreReplayRecord');
  if (record.schemaVersion !== VISUAL_RESTORE_REPLAY_RECORD_SCHEMA_VERSION) {
    throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay schema invalid', 500);
  }
  assertSha256Digest(record.restoreReplayKey, 'restoreReplayKey');
  validateRestoreReplayValue(record.value);
  if (record.value.restoreReplayKey !== record.restoreReplayKey) {
    throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay value key mismatch', 500);
  }
  assertIsoTimestamp(record.createdAt, 'createdAt');
  return record;
}

function restoreReplayValuesMatch(existing, value) {
  const comparable = { ...existing };
  delete comparable.expiresAtMs;
  const current = { ...value };
  delete current.expiresAtMs;
  return canonicalJson(comparable) === canonicalJson(current);
}

class FileVisualRestoreReplayStore extends MemoryRestoreReplayStore {
  constructor(rootDir, now = Date.now) {
    super(now);
    if (typeof rootDir !== 'string' || !rootDir.trim()) {
      throw visualError('VISUAL_RESTORE_REPLAY_STORE_UNCONFIGURED', 'restore replay store root is required', 503);
    }
    this.rootDir = path.resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    this.rootRealPath = realpathSync(this.rootDir);
    this.replayDir = this.safeJoin('restore-replay');
    mkdirSync(this.replayDir, { recursive: true });
    this.load();
  }

  safeJoin(...segments) {
    for (const segment of segments) {
      if (typeof segment !== 'string' || !segment || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..' || path.isAbsolute(segment) || /^[A-Za-z]:/.test(segment)) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay path segment invalid', 500);
      }
    }
    const resolved = path.resolve(this.rootDir, ...segments);
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay path escapes root', 500);
    }
    return resolved;
  }

  assertNoSymlinkPath(targetPath, { allowMissingLeaf = false } = {}) {
    const resolved = path.resolve(targetPath);
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay path escapes root', 500);
    }
    const relative = path.relative(this.rootDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay path escapes root', 500);
    }
    let current = this.rootDir;
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      if (!existsSync(current)) {
        if (allowMissingLeaf && index === parts.length - 1) return;
        continue;
      }
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay symlink rejected', 500);
      const real = realpathSync(current);
      if (real !== this.rootRealPath && !real.startsWith(`${this.rootRealPath}${path.sep}`)) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID_PATH', 'restore replay realpath escapes root', 500);
      }
    }
  }

  recordFileName(restoreReplayKey) {
    assertSha256Digest(restoreReplayKey, 'restoreReplayKey');
    return `${restoreReplayKey.slice('sha256:'.length)}.json`;
  }

  recordPath(restoreReplayKey) {
    return this.safeJoin('restore-replay', this.recordFileName(restoreReplayKey));
  }

  load() {
    this.entries.clear();
    this.assertNoSymlinkPath(this.replayDir);
    const nowMs = this.now();
    for (const entry of readdirSync(this.replayDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.tmp-visual-restore-replay-')) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'partial restore replay temp record found', 500);
      }
      if (!/^[a-f0-9]{64}\.json$/.test(entry.name)) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay record name invalid', 500);
      }
      const recordPath = this.safeJoin('restore-replay', entry.name);
      this.assertNoSymlinkPath(recordPath);
      if (!entry.isFile()) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay record is not a file', 500);
      }
      const record = validateRestoreReplayRecord(parseJsonStrictFile(readFileSync(recordPath), 'restoreReplayRecord'));
      if (this.recordFileName(record.restoreReplayKey) !== entry.name) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'restore replay filename mismatch', 500);
      }
      if (record.value.expiresAtMs <= nowMs) {
        rmSync(recordPath, { force: true });
        continue;
      }
      if (this.entries.has(record.restoreReplayKey)) {
        throw visualError('VISUAL_RESTORE_REPLAY_STORE_INVALID', 'duplicate restore replay record', 500);
      }
      this.entries.set(record.restoreReplayKey, structuredClone(record.value));
    }
  }

  prepare(restoreReplayKey, value) {
    validateRestoreReplayValue(value);
    if (value.restoreReplayKey !== restoreReplayKey) {
      throw visualError('VISUAL_RESTORE_REPLAY_CONFLICT', 'restore replay key mismatch', 409);
    }
    this.cleanup();
    const existing = this.entries.get(restoreReplayKey);
    if (existing) {
      if (!restoreReplayValuesMatch(existing, value)) {
        throw visualError('VISUAL_RESTORE_REPLAY_CONFLICT', 'restore proof replay conflicts with retained binding', 409);
      }
      return { reused: true, commit() {}, release() {} };
    }
    const targetPath = this.recordPath(restoreReplayKey);
    this.assertNoSymlinkPath(targetPath, { allowMissingLeaf: true });
    let tmpPath = null;
    let committed = false;
    return {
      reused: false,
      commit: async () => {
        if (committed) return;
        const record = validateRestoreReplayRecord({
          schemaVersion: VISUAL_RESTORE_REPLAY_RECORD_SCHEMA_VERSION,
          restoreReplayKey,
          value: structuredClone(value),
          createdAt: nowIso(this.now),
        });
        tmpPath = this.safeJoin('restore-replay', `.tmp-visual-restore-replay-${randomBytes(12).toString('hex')}.json`);
        await writeFile(tmpPath, `${canonicalJson(record)}\n`, { flag: 'wx' });
        try {
          await link(tmpPath, targetPath);
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          const existingRecord = validateRestoreReplayRecord(parseJsonStrictFile(readFileSync(targetPath), 'restoreReplayRecord'));
          if (!restoreReplayValuesMatch(existingRecord.value, value)) {
            throw visualError('VISUAL_RESTORE_REPLAY_CONFLICT', 'restore proof replay conflicts with retained binding', 409);
          }
        } finally {
          await rm(tmpPath, { force: true });
          tmpPath = null;
        }
        this.entries.set(restoreReplayKey, structuredClone(value));
        committed = true;
      },
      release: async () => {
        if (tmpPath) await rm(tmpPath, { force: true });
      },
    };
  }

  cleanup() {
    const nowMs = this.now();
    for (const [key, value] of [...this.entries.entries()]) {
      if (value.expiresAtMs <= nowMs) {
        const recordPath = this.recordPath(key);
        this.assertNoSymlinkPath(recordPath, { allowMissingLeaf: true });
        rmSync(recordPath, { force: true });
        this.entries.delete(key);
      }
    }
  }
}

class FileVisualBindingStore extends MemoryVisualBindingStore {
  constructor(rootDir) {
    super();
    if (typeof rootDir !== 'string' || !rootDir.trim()) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_UNCONFIGURED', 'binding store root is required', 503);
    }
    this.rootDir = path.resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
    this.rootRealPath = realpathSync(this.rootDir);
    this.bindingsDir = this.safeJoin('bindings');
    this.receiptsByBindingDir = this.safeJoin('receipts', 'by-binding');
    this.retentionsDir = this.safeJoin('retentions');
    this.byIdempotencyDir = this.safeJoin('indexes', 'by-idempotency');
    this.byActiveEntityDir = this.safeJoin('indexes', 'by-active-entity');
    mkdirSync(this.bindingsDir, { recursive: true });
    mkdirSync(this.receiptsByBindingDir, { recursive: true });
    mkdirSync(this.retentionsDir, { recursive: true });
    mkdirSync(this.byIdempotencyDir, { recursive: true });
    mkdirSync(this.byActiveEntityDir, { recursive: true });
    this.load();
  }

  safeJoin(...segments) {
    for (const segment of segments) {
      if (typeof segment !== 'string' || !segment || segment.includes('/') || segment.includes('\\') || segment === '.' || segment === '..' || path.isAbsolute(segment) || /^[A-Za-z]:/.test(segment)) {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store path segment invalid', 500);
      }
    }
    const resolved = path.resolve(this.rootDir, ...segments);
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store path escapes root', 500);
    }
    return resolved;
  }

  assertNoSymlinkPath(targetPath, { allowMissingLeaf = false } = {}) {
    const resolved = path.resolve(targetPath);
    if (resolved !== this.rootDir && !resolved.startsWith(`${this.rootDir}${path.sep}`)) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store path escapes root', 500);
    }
    const relative = path.relative(this.rootDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store path escapes root', 500);
    }
    let current = this.rootDir;
    const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
    for (let index = 0; index < parts.length; index += 1) {
      current = path.join(current, parts[index]);
      if (!existsSync(current)) {
        if (allowMissingLeaf && index === parts.length - 1) return;
        continue;
      }
      const stats = lstatSync(current);
      if (stats.isSymbolicLink()) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store symlink rejected', 500);
      const real = realpathSync(current);
      if (real !== this.rootRealPath && !real.startsWith(`${this.rootRealPath}${path.sep}`)) {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID_PATH', 'binding store realpath escapes root', 500);
      }
    }
  }

  load() {
    this.assertNoSymlinkPath(this.bindingsDir);
    this.assertNoSymlinkPath(this.receiptsByBindingDir);
    this.assertNoSymlinkPath(this.retentionsDir);
    this.assertNoSymlinkPath(this.byIdempotencyDir);
    this.assertNoSymlinkPath(this.byActiveEntityDir);
    for (const entryName of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (entryName.name.startsWith('.tmp-visual-binding-')) {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'partial binding temp record found', 500);
      }
    }
    for (const bindingId of readdirSync(this.bindingsDir)) {
      if (!/^vb_[a-z0-9_-]{12,80}$/.test(bindingId)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding directory name invalid', 500);
      const bindingDir = this.safeJoin('bindings', bindingId);
      this.assertNoSymlinkPath(bindingDir);
      const entries = readdirSync(bindingDir).sort();
      if (entries.join('\n') !== 'public-binding.json\npublic-result.json\nrecord.json') {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding record is incomplete', 500);
      }
      const record = parseJsonStrictFile(readFileSync(path.join(bindingDir, 'record.json')), 'bindingRecord');
      const publicBinding = parseJsonStrictFile(readFileSync(path.join(bindingDir, 'public-binding.json')), 'publicBinding');
      const publicResult = parseJsonStrictFile(readFileSync(path.join(bindingDir, 'public-result.json')), 'publicResult');
      validateBindingStoreRecord(record);
      validateStoredPublicArtifacts(record, publicBinding, publicResult);
      if (record.bindingId !== bindingId || this.records.has(bindingId)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'duplicate binding record', 500);
      this.records.set(bindingId, record);
      this.bindings.set(bindingId, publicBinding);
      this.results.set(bindingId, publicResult);
    }
    this.loadRetentions();
    this.loadReceipts();
    this.loadFlatIndex(this.byIdempotencyDir, this.idempotencyIndex, 'idempotencyIndex');
    this.loadActiveEntityIndex();
    for (const [bindingId, record] of this.records.entries()) {
      if (this.idempotencyIndex.get(record.idempotencyKeyHash.slice('sha256:'.length)) !== bindingId) {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'idempotency index missing or mismatched', 500);
      }
      const activeKey = createActiveEntityHash(record).slice('sha256:'.length);
      if (this.activeEntityIndex.get(activeKey) !== bindingId) {
        throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'active entity index missing or mismatched', 500);
      }
    }
    this.validateRestoreLinks();
  }

  loadRetentions() {
    this.assertNoSymlinkPath(this.retentionsDir);
    for (const fileName of readdirSync(this.retentionsDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(fileName)) throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'retention file name invalid', 500);
      const retentionPath = path.join(this.retentionsDir, fileName);
      this.assertNoSymlinkPath(retentionPath);
      const retention = parseJsonStrictFile(readFileSync(retentionPath), 'bindingRetention');
      validateBindingRetention(retention);
      const hash = fileName.slice(0, -5);
      if (sha256Hex(Buffer.from(retention.retentionId, 'utf8')) !== hash) throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'retention path hash mismatch', 500);
      if (this.retentions.has(retention.retentionId)) throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'duplicate retention record', 500);
      this.retentions.set(retention.retentionId, retention);
    }
  }

  loadReceipts() {
    this.assertNoSymlinkPath(this.receiptsByBindingDir);
    for (const fileName of readdirSync(this.receiptsByBindingDir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(fileName)) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt file name invalid', 500);
      const receiptPath = path.join(this.receiptsByBindingDir, fileName);
      this.assertNoSymlinkPath(receiptPath);
      const receipt = parseJsonStrictFile(readFileSync(receiptPath), 'bindingReceipt');
      validateBindingReceipt(receipt);
      const hash = fileName.slice(0, -5);
      if (sha256Hex(Buffer.from(receipt.bindingId, 'utf8')) !== hash) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt path hash mismatch', 500);
      if (!this.records.has(receipt.bindingId)) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt binding is missing', 500);
      if (!this.retentions.has(receipt.retentionId)) throw visualError('VISUAL_RESTORE_RETENTION_MISSING', 'receipt retention is missing', 500);
      if (this.receipts.has(receipt.receiptId) || this.receiptByBindingId.has(receipt.bindingId)) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'duplicate receipt record', 500);
      this.receipts.set(receipt.receiptId, receipt);
      this.receiptByBindingId.set(receipt.bindingId, receipt.receiptId);
    }
  }

  validateRestoreLinks() {
    for (const receipt of this.receipts.values()) {
      const retention = this.retentions.get(receipt.retentionId);
      const record = this.records.get(receipt.bindingId);
      if (!retention || !record) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt link dangling', 500);
      assertReceiptRetentionLink(receipt, retention, record);
    }
  }

  loadFlatIndex(dir, map, label) {
    this.assertNoSymlinkPath(dir);
    for (const fileName of readdirSync(dir)) {
      if (!/^[a-f0-9]{64}\.json$/.test(fileName)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', `${label} file name invalid`, 500);
      this.assertNoSymlinkPath(path.join(dir, fileName));
      const hash = fileName.slice(0, -5);
      const record = parseJsonStrictFile(readFileSync(path.join(dir, fileName)), label);
      requireExactKeys(record, ['bindingId', 'indexHash'], label);
      assertSafeString(record.bindingId, `${label}.bindingId`, 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
      assertSha256Hex(record.indexHash, `${label}.indexHash`);
      if (record.indexHash !== hash) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', `${label} hash mismatch`, 500);
      if (!this.records.has(record.bindingId)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', `${label} dangling`, 500);
      if (map.has(hash)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', `${label} duplicate`, 500);
      map.set(hash, record.bindingId);
    }
  }

  loadActiveEntityIndex() {
    for (const releaseHash of readdirSync(this.byActiveEntityDir)) {
      assertSha256Hex(releaseHash, 'releaseScopeHash');
      this.assertNoSymlinkPath(this.safeJoin('indexes', 'by-active-entity', releaseHash));
      for (const chatHash of readdirSync(this.safeJoin('indexes', 'by-active-entity', releaseHash))) {
        assertSha256Hex(chatHash, 'chatIdHash');
        const chatDir = this.safeJoin('indexes', 'by-active-entity', releaseHash, chatHash);
        this.assertNoSymlinkPath(chatDir);
        for (const fileName of readdirSync(chatDir)) {
          if (!/^[a-f0-9]{64}\.json$/.test(fileName)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'active entity index file name invalid', 500);
          this.assertNoSymlinkPath(path.join(chatDir, fileName));
          const entityHash = fileName.slice(0, -5);
          const record = parseJsonStrictFile(readFileSync(path.join(chatDir, fileName)), 'activeEntityIndex');
          requireExactKeys(record, ['bindingId', 'releaseScopeHash', 'chatIdHash', 'entityKeyHash', 'activeEntityHash'], 'activeEntityIndex');
          assertSafeString(record.bindingId, 'activeEntityIndex.bindingId', 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
          for (const field of ['releaseScopeHash', 'chatIdHash', 'entityKeyHash', 'activeEntityHash']) assertSha256Hex(record[field], `activeEntityIndex.${field}`);
          if (record.releaseScopeHash !== releaseHash || record.chatIdHash !== chatHash || record.entityKeyHash !== entityHash) {
            throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'active entity derived hash mismatch', 500);
          }
          if (!this.records.has(record.bindingId)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'active entity index dangling', 500);
          if (this.activeEntityIndex.has(record.activeEntityHash)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'active entity index duplicate', 500);
          this.activeEntityIndex.set(record.activeEntityHash, record.bindingId);
        }
      }
    }
  }

  async saveOrReuse({ record, publicBinding, publicResult, idempotencyKeyHash, activeEntityHash }) {
    validateBindingStoreRecord(record);
    validateStoredPublicArtifacts(record, publicBinding, publicResult);
    const existingIdempotency = this.idempotencyIndex.get(idempotencyKeyHash);
    if (existingIdempotency) return this.requireExactReplay(existingIdempotency, record, publicBinding, publicResult);
    const existingActive = this.activeEntityIndex.get(activeEntityHash);
    if (existingActive) return this.requireActiveReuse(existingActive, record);
    if (this.records.has(record.bindingId)) throw visualError('VISUAL_MATCH_BINDING_CONFLICT', 'binding id already exists', 409);
    const tmpName = `.tmp-visual-binding-${randomBytes(16).toString('hex')}`;
    const tmpDir = this.safeJoin(tmpName);
    const bindingDir = this.safeJoin('bindings', record.bindingId);
    const idempotencyPath = this.safeJoin('indexes', 'by-idempotency', `${idempotencyKeyHash}.json`);
    const releaseScopeHash = createReleaseScopeHash(record).slice('sha256:'.length);
    const chatIdHash = sha256Hex(Buffer.from(record.chatId, 'utf8'));
    const entityKeyHash = sha256Hex(Buffer.from(record.entityKey, 'utf8'));
    const activeIndexPath = this.safeJoin('indexes', 'by-active-entity', releaseScopeHash, chatIdHash, `${entityKeyHash}.json`);
    this.assertNoSymlinkPath(this.bindingsDir);
    this.assertNoSymlinkPath(this.byIdempotencyDir);
    this.assertNoSymlinkPath(this.byActiveEntityDir);
    this.assertNoSymlinkPath(bindingDir, { allowMissingLeaf: true });
    this.assertNoSymlinkPath(idempotencyPath, { allowMissingLeaf: true });
    this.assertNoSymlinkPath(path.dirname(activeIndexPath), { allowMissingLeaf: true });
    const writtenPaths = [];
    try {
      await mkdir(tmpDir, { recursive: false });
      await writeFile(path.join(tmpDir, 'record.json'), Buffer.from(`${canonicalJson(record)}\n`, 'utf8'), { flag: 'wx' });
      await writeFile(path.join(tmpDir, 'public-binding.json'), Buffer.from(`${canonicalJson(publicBinding)}\n`, 'utf8'), { flag: 'wx' });
      await writeFile(path.join(tmpDir, 'public-result.json'), Buffer.from(`${canonicalJson(publicResult)}\n`, 'utf8'), { flag: 'wx' });
      await rename(tmpDir, bindingDir);
      writtenPaths.push(bindingDir);
      await atomicWriteJson(idempotencyPath, {
        bindingId: record.bindingId,
        indexHash: idempotencyKeyHash,
      });
      writtenPaths.push(idempotencyPath);
      await atomicWriteJson(activeIndexPath, {
        bindingId: record.bindingId,
        releaseScopeHash,
        chatIdHash,
        entityKeyHash,
        activeEntityHash,
      });
      writtenPaths.push(activeIndexPath);
      this.records.set(record.bindingId, structuredClone(record));
      this.bindings.set(record.bindingId, structuredClone(publicBinding));
      this.results.set(record.bindingId, structuredClone(publicResult));
      this.idempotencyIndex.set(idempotencyKeyHash, record.bindingId);
      this.activeEntityIndex.set(activeEntityHash, record.bindingId);
      return { record, publicBinding, publicResult, reused: false };
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      for (const writtenPath of writtenPaths.reverse()) {
        await rm(writtenPath, { recursive: true, force: true }).catch(() => {});
      }
      throw error;
    }
  }

  async retainBindingsForRestore(input) {
    const { retention, receipts } = buildRetentionPackage(this, input);
    const tmpName = `.tmp-visual-binding-retention-${randomBytes(16).toString('hex')}`;
    const tmpDir = this.safeJoin(tmpName);
    const retentionPath = this.safeJoin('retentions', `${sha256Hex(Buffer.from(retention.retentionId, 'utf8'))}.json`);
    const receiptPaths = receipts.map((receipt) => this.safeJoin('receipts', 'by-binding', `${sha256Hex(Buffer.from(receipt.bindingId, 'utf8'))}.json`));
    this.assertNoSymlinkPath(this.retentionsDir);
    this.assertNoSymlinkPath(this.receiptsByBindingDir);
    this.assertNoSymlinkPath(retentionPath, { allowMissingLeaf: true });
    for (const receiptPath of receiptPaths) this.assertNoSymlinkPath(receiptPath, { allowMissingLeaf: true });
    const writtenPaths = [];
    try {
      await mkdir(tmpDir, { recursive: false });
      await writeFile(path.join(tmpDir, 'retention.json'), Buffer.from(`${canonicalJson(retention)}\n`, 'utf8'), { flag: 'wx' });
      for (const receipt of receipts) {
        await writeFile(path.join(tmpDir, `${receipt.bindingId}.receipt.json`), Buffer.from(`${canonicalJson(receipt)}\n`, 'utf8'), { flag: 'wx' });
      }
      await atomicWriteJson(retentionPath, retention);
      writtenPaths.push(retentionPath);
      for (let index = 0; index < receipts.length; index += 1) {
        await atomicWriteJson(receiptPaths[index], receipts[index]);
        writtenPaths.push(receiptPaths[index]);
      }
      this.retentions.set(retention.retentionId, structuredClone(retention));
      for (const receipt of receipts) {
        this.receipts.set(receipt.receiptId, structuredClone(receipt));
        this.receiptByBindingId.set(receipt.bindingId, receipt.receiptId);
      }
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return { retention, receipts };
    } catch (error) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      for (const writtenPath of writtenPaths.reverse()) {
        await rm(writtenPath, { recursive: true, force: true }).catch(() => {});
      }
      this.retentions.delete(retention.retentionId);
      for (const receipt of receipts) {
        this.receipts.delete(receipt.receiptId);
        this.receiptByBindingId.delete(receipt.bindingId);
      }
      throw error;
    }
  }
}

function validateContentRecord(meta, hash, bytes, status = 500) {
  requireExactKeys(meta, ['schemaVersion', 'hash', 'mime', 'size'], 'contentRecord');
  if (meta.schemaVersion !== 'galgame.visual-asset-content-store-record.v1' || meta.hash !== hash || meta.mime !== PNG_MIME || meta.size !== bytes.length) {
    throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content metadata invalid', status);
  }
  const actualHash = `sha256:${sha256Hex(bytes)}`;
  if (actualHash !== hash) throw visualError('VISUAL_ASSET_CONTENT_HASH_MISMATCH', 'content hash mismatch', status);
}

function parseJsonStrictFile(bytes, label) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', `${label} BOM is not allowed`, 500);
  }
  const text = Buffer.from(bytes).toString('utf8');
  assertNoDuplicateJsonKeys(text, label);
  return JSON.parse(text);
}

function createReleaseScopeHash(record) {
  return sha256Json({
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
  });
}

function createActiveEntityHash(record) {
  return sha256Json({
    releaseScopeHash: createReleaseScopeHash(record),
    chatId: record.chatId,
    entityKey: record.entityKey,
  });
}

function zeroSelfHash(value, field) {
  return { ...value, [field]: ZERO_SHA256_DIGEST };
}

function computeReceiptHash(receipt) {
  return sha256Json(zeroSelfHash(receipt, 'receiptHash'));
}

function computeRetentionHash(retention) {
  return sha256Json(zeroSelfHash(retention, 'retentionHash'));
}

function entityTypeFromKey(entityKey) {
  const match = /^entity_(scene|character|equipment|item|skill|unknown)_/.exec(entityKey);
  return match?.[1] || '';
}

function assetTypeFromAssetId(assetId) {
  const unknown = /^unknown_(scene|character|equipment|item|skill)$/.exec(assetId);
  if (unknown) return unknown[1];
  if (/^asset_[a-z0-9_-]{8,80}$/.test(assetId)) return null;
  return '';
}

function assertBindingTypeCoherence({ bindingId, bindingType, entityKey, assetId, receiptAssetType, publicBinding = null, publicResult = null }) {
  if (!SHARED_BINDABLE_TYPE_SET.has(bindingType)) throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'binding type invalid', 409);
  const entityType = entityTypeFromKey(entityKey);
  if (entityType !== bindingType) throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'entityKey type does not match binding type', 409);
  if (receiptAssetType !== undefined && receiptAssetType !== bindingType) throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'receipt asset type does not match binding type', 409);
  const assetType = assetTypeFromAssetId(assetId);
  if (assetType === '') throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'asset id is invalid for binding type', 409);
  if (assetType && assetType !== bindingType) throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'unknown asset type does not match binding type', 409);
  if (publicBinding) {
    if (publicBinding.bindingId !== bindingId || publicBinding.bindingType !== bindingType || publicBinding.entityKey !== entityKey || publicBinding.assetId !== assetId) {
      throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'public binding type fields do not match retained record', 409);
    }
  }
  if (publicResult) {
    if (publicResult.bindingId !== bindingId || publicResult.type !== bindingType || publicResult.entityKey !== entityKey || publicResult.assetId !== assetId) {
      throw visualError('VISUAL_RESTORE_TYPE_MISMATCH', 'public result type fields do not match retained record', 409);
    }
  }
}

function validateBindingReceipt(receipt) {
  requireExactKeys(receipt, VISUAL_BINDING_RECEIPT_KEYS, 'bindingReceipt');
  assertSerializedSize(receipt, 24 * 1024, 'bindingReceipt');
  if (receipt.schemaVersion !== VISUAL_BINDING_RECEIPT_SCHEMA_VERSION) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt schema invalid', 500);
  assertSafeString(receipt.receiptId, 'receiptId', 23, 87, /^vbrcpt_[a-z0-9_-]{16,80}$/);
  assertSafeString(receipt.retentionId, 'retentionId', 22, 86, /^vbrtn_[a-z0-9_-]{16,80}$/);
  assertSafeString(receipt.bindingId, 'bindingId', 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
  assertEntityKey(receipt.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(receipt.assetType)) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt asset type invalid', 500);
  if (receipt.bindingPolicy !== bindingPolicyForType(receipt.assetType)) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt binding policy invalid', 500);
  assertNonNegativeInteger(receipt.sourceMessageIndex, 'sourceMessageIndex');
  for (const field of ['sourceMessageHash', 'evidenceDigest', 'projectionHash', 'releaseScopeHash', 'visualProfileHash', 'catalogHash', 'dictionaryHash', 'assetContentSha256', 'assetMetadataHash', 'catalogRefHash', 'bindingRecordHash', 'retentionHash', 'receiptHash']) {
    assertSha256Digest(receipt[field], field);
  }
  assertSafeString(receipt.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertGenericId(receipt.releaseId, 'releaseId');
  assertGenericId(receipt.scenarioId, 'scenarioId');
  assertVersionId(receipt.scenarioVersion, 'scenarioVersion');
  assertGenericId(receipt.arcId, 'arcId');
  assertSha256Digest(receipt.chatIdHash, 'chatIdHash');
  assertSafeString(receipt.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSafeString(receipt.catalogId, 'catalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(receipt.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertVersionId(receipt.dictionaryVersion, 'dictionaryVersion');
  assertSafeString(receipt.assetId, 'assetId', 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(receipt.assetVersion, 'assetVersion', Number.MAX_SAFE_INTEGER);
  assertIsoTimestamp(receipt.createdAt, 'createdAt');
  assertIsoTimestamp(receipt.expiresAt, 'expiresAt');
  assertBindingTypeCoherence({
    bindingId: receipt.bindingId,
    bindingType: receipt.assetType,
    entityKey: receipt.entityKey,
    assetId: receipt.assetId,
    receiptAssetType: receipt.assetType,
  });
  if (receipt.receiptHash !== computeReceiptHash(receipt)) throw visualError('VISUAL_RESTORE_RECEIPT_HASH_MISMATCH', 'receipt hash mismatch', 500);
}

function validateBindingRetention(retention) {
  requireExactKeys(retention, VISUAL_BINDING_RETENTION_KEYS, 'bindingRetention');
  assertSerializedSize(retention, 24 * 1024, 'bindingRetention');
  if (retention.schemaVersion !== VISUAL_BINDING_RETENTION_SCHEMA_VERSION) throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'retention schema invalid', 500);
  assertSafeString(retention.retentionId, 'retentionId', 22, 86, /^vbrtn_[a-z0-9_-]{16,80}$/);
  if (retention.retentionPolicy !== 'release-bound-365d') throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'retention policy invalid', 500);
  if (!['active', 'eligible', 'gc-in-progress', 'gc-complete'].includes(retention.gcState)) throw visualError('VISUAL_RESTORE_RETENTION_INVALID', 'retention gc state invalid', 500);
  assertBindingIdArray(retention.bindingIds, 'bindingIds', 500);
  assertGenericId(retention.releaseId, 'releaseId');
  assertSha256Digest(retention.releaseScopeHash, 'releaseScopeHash');
  assertGenericId(retention.scenarioId, 'scenarioId');
  assertVersionId(retention.scenarioVersion, 'scenarioVersion');
  assertGenericId(retention.arcId, 'arcId');
  assertSafeString(retention.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(retention.visualProfileHash, 'visualProfileHash');
  assertSafeString(retention.catalogId, 'catalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(retention.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(retention.catalogHash, 'catalogHash');
  assertVersionId(retention.dictionaryVersion, 'dictionaryVersion');
  assertSha256Digest(retention.dictionaryHash, 'dictionaryHash');
  assertIsoTimestamp(retention.createdAt, 'createdAt');
  assertIsoTimestamp(retention.retentionUntil, 'retentionUntil');
  assertSha256Digest(retention.retentionHash, 'retentionHash');
  if (retention.retentionHash !== computeRetentionHash(retention)) throw visualError('VISUAL_RESTORE_RETENTION_HASH_MISMATCH', 'retention hash mismatch', 500);
}

function assertBindingIdArray(value, label, maxItems) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) {
    throw visualError('VISUAL_ASSET_INVALID_FIELD', `${label} must be a non-empty binding id array`, 400);
  }
  const seen = new Set();
  for (const item of value) {
    assertSafeString(item, label, 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
    if (seen.has(item)) throw visualError('VISUAL_ASSET_DUPLICATE_FIELD', `${label} has duplicates`, 400);
    seen.add(item);
  }
}

function validateBindingStoreRecord(record) {
  requireExactKeys(record, VISUAL_BINDING_STORE_RECORD_KEYS, 'bindingStoreRecord');
  assertSerializedSize(record, 64 * 1024, 'bindingStoreRecord');
  if (record.schemaVersion !== VISUAL_BINDING_STORE_RECORD_SCHEMA_VERSION) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding record schema invalid', 500);
  assertSafeString(record.bindingId, 'bindingId', 15, 83, /^vb_[a-z0-9_-]{12,80}$/);
  if (record.bindingStatus !== 'active') throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding status invalid', 500);
  if (record.bindingPolicy !== 'current-release') throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'internal binding policy invalid', 500);
  assertGenericId(record.releaseId, 'releaseId');
  assertGenericId(record.scenarioId, 'scenarioId');
  assertVersionId(record.scenarioVersion, 'scenarioVersion');
  assertGenericId(record.arcId, 'arcId');
  assertGenericId(record.chatId, 'chatId');
  assertSafeString(record.projectionId, 'projectionId', 16, 84, /^vvp_[a-z0-9_-]{12,80}$/);
  assertSha256Digest(record.projectionHash, 'projectionHash');
  assertNonNegativeInteger(record.sourceMessageIndex, 'sourceMessageIndex');
  assertSha256Digest(record.sourceMessageHash, 'sourceMessageHash');
  assertSha256Digest(record.evidenceDigest, 'evidenceDigest');
  assertEntityKey(record.entityKey, 'entityKey');
  if (!SHARED_BINDABLE_TYPE_SET.has(record.entityType)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'entityType invalid', 500);
  if (!record.entityKey.startsWith(`entity_${record.entityType}_`)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'entity scope mismatch', 500);
  assertSafeString(record.decisionId, 'decisionId', 16, 84, CANDIDATE_DECISION_ID_PATTERN);
  assertSafeString(record.matchId, 'matchId', 15, 83, /^vm_[a-z0-9_-]{12,80}$/);
  assertSafeString(record.assetId, 'assetId', 3, 86, SHARED_ASSET_ID_PATTERN);
  assertPositiveInteger(record.assetVersion, 'assetVersion', Number.MAX_SAFE_INTEGER);
  assertSha256Hex(record.assetContentSha256, 'assetContentSha256');
  assertSha256Digest(record.assetMetadataHash, 'assetMetadataHash');
  assertSha256Digest(record.catalogRefHash, 'catalogRefHash');
  assertSafeString(record.visualProfileId, 'visualProfileId', 14, 86, /^vprof_[a-z0-9_-]{8,80}$/);
  assertSha256Digest(record.profileHash, 'profileHash');
  assertSafeString(record.catalogId, 'catalogId', 11, 83, /^vc_[a-z0-9_-]{8,80}$/);
  assertPositiveInteger(record.catalogRevision, 'catalogRevision', Number.MAX_SAFE_INTEGER);
  assertSha256Digest(record.catalogHash, 'catalogHash');
  assertVersionId(record.dictionaryVersion, 'dictionaryVersion');
  assertSha256Digest(record.dictionaryHash, 'dictionaryHash');
  assertVersionId(record.matcherVersion, 'matcherVersion');
  assertVersionId(record.scorerVersion, 'scorerVersion');
  assertSha256Digest(record.idempotencyKeyHash, 'idempotencyKeyHash');
  assertSha256Digest(record.publicBindingHash, 'publicBindingHash');
  assertSha256Digest(record.publicResultHash, 'publicResultHash');
  assertIsoTimestamp(record.createdAt, 'createdAt');
  assertIsoTimestamp(record.expiresAt, 'expiresAt');
  if (Date.parse(record.expiresAt) <= Date.parse(record.createdAt)) throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'binding expiry invalid', 500);
}

function validateStoredPublicArtifacts(record, publicBinding, publicResult) {
  const context = {
    releaseId: record.releaseId,
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    arcId: record.arcId,
    chatId: record.chatId,
    projectionId: record.projectionId,
    sourceMessageIndex: record.sourceMessageIndex,
    sourceMessageHash: record.sourceMessageHash,
    evidenceDigest: record.evidenceDigest,
    visualProfileId: record.visualProfileId,
    profileHash: record.profileHash,
    catalogId: record.catalogId,
    catalogRevision: record.catalogRevision,
    catalogHash: record.catalogHash,
    dictionaryVersion: record.dictionaryVersion,
    dictionaryHash: record.dictionaryHash,
  };
  const bindingStatus = validateVisualBinding(publicBinding, context);
  if (!bindingStatus.valid) throw visualError('VISUAL_MATCH_PUBLIC_BINDING_INVALID', 'public binding invalid', 500);
  const resultStatus = validateVisualMatchResult(publicResult, context);
  if (!resultStatus.valid) throw visualError('VISUAL_MATCH_PUBLIC_RESULT_INVALID', 'public result invalid', 500);
  if (
    publicBinding.bindingId !== record.bindingId
    || publicResult.bindingId !== record.bindingId
    || publicResult.matchId !== record.matchId
    || publicBinding.bindingType !== record.entityType
    || publicResult.type !== record.entityType
    || publicBinding.entityKey !== record.entityKey
    || publicResult.entityKey !== record.entityKey
    || publicBinding.assetId !== record.assetId
    || publicResult.assetId !== record.assetId
    || publicBinding.bindingPolicy === 'current-release'
    || record.publicBindingHash !== sha256Json(publicBinding)
    || record.publicResultHash !== sha256Json(publicResult)
  ) {
    throw visualError('VISUAL_MATCH_BINDING_STORE_INVALID', 'public artifact hash or scope mismatch', 500);
  }
  assertBindingTypeCoherence({
    bindingId: record.bindingId,
    bindingType: record.entityType,
    entityKey: record.entityKey,
    assetId: record.assetId,
    receiptAssetType: record.entityType,
    publicBinding,
    publicResult,
  });
}

function isVisualRestoreBindingPath(pathname) {
  return pathname === '/v1/visual/restore-bindings/old-save' || pathname === '/v1/visual/restore-bindings/rollback';
}

function createBindingReceipt({ record, retention, createdAt }) {
  validateBindingStoreRecord(record);
  validateBindingRetention(retention);
  if (!retention.bindingIds.includes(record.bindingId)) throw visualError('VISUAL_RESTORE_RETENTION_LINK_MISMATCH', 'retention does not contain binding id', 409);
  if (
    retention.releaseId !== record.releaseId
    || retention.releaseScopeHash !== createReleaseScopeHash(record)
    || retention.scenarioId !== record.scenarioId
    || retention.scenarioVersion !== record.scenarioVersion
    || retention.arcId !== record.arcId
    || retention.visualProfileId !== record.visualProfileId
    || retention.visualProfileHash !== record.profileHash
    || retention.catalogId !== record.catalogId
    || retention.catalogRevision !== record.catalogRevision
    || retention.catalogHash !== record.catalogHash
    || retention.dictionaryVersion !== record.dictionaryVersion
    || retention.dictionaryHash !== record.dictionaryHash
  ) {
    throw visualError('VISUAL_RESTORE_RETENTION_SCOPE_MISMATCH', 'retention scope does not match binding', 409);
  }
  const receiptBase = {
    schemaVersion: VISUAL_BINDING_RECEIPT_SCHEMA_VERSION,
    receiptId: createStableId('vbrcpt', { bindingId: record.bindingId, retentionId: retention.retentionId }),
    retentionId: retention.retentionId,
    bindingId: record.bindingId,
    entityKey: record.entityKey,
    assetType: record.entityType,
    bindingPolicy: bindingPolicyForType(record.entityType),
    sourceMessageIndex: record.sourceMessageIndex,
    sourceMessageHash: record.sourceMessageHash,
    evidenceDigest: record.evidenceDigest,
    projectionId: record.projectionId,
    projectionHash: record.projectionHash,
    releaseId: record.releaseId,
    releaseScopeHash: createReleaseScopeHash(record),
    scenarioId: record.scenarioId,
    scenarioVersion: record.scenarioVersion,
    arcId: record.arcId,
    chatIdHash: sha256Digest(record.chatId),
    visualProfileId: record.visualProfileId,
    visualProfileHash: record.profileHash,
    catalogId: record.catalogId,
    catalogRevision: record.catalogRevision,
    catalogHash: record.catalogHash,
    dictionaryVersion: record.dictionaryVersion,
    dictionaryHash: record.dictionaryHash,
    assetId: record.assetId,
    assetVersion: record.assetVersion,
    assetContentSha256: `sha256:${record.assetContentSha256}`,
    assetMetadataHash: record.assetMetadataHash,
    catalogRefHash: record.catalogRefHash,
    bindingRecordHash: sha256Json(record),
    retentionHash: retention.retentionHash,
    receiptHash: ZERO_SHA256_DIGEST,
    createdAt,
    expiresAt: record.expiresAt,
  };
  const receipt = { ...receiptBase, receiptHash: computeReceiptHash(receiptBase) };
  validateBindingReceipt(receipt);
  return receipt;
}

function assertReceiptRetentionLink(receipt, retention, record, { now = Date.now } = {}) {
  validateBindingReceipt(receipt);
  validateBindingRetention(retention);
  validateBindingStoreRecord(record);
  if (receipt.bindingId !== record.bindingId) throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt binding mismatch', 409);
  if (receipt.retentionId !== retention.retentionId || receipt.retentionHash !== retention.retentionHash) {
    throw visualError('VISUAL_RESTORE_RETENTION_LINK_MISMATCH', 'receipt retention link mismatch', 409);
  }
  if (retention.gcState !== 'active') throw visualError('VISUAL_RESTORE_RETENTION_EXPIRED', 'retention is not active', 409);
  if (Date.parse(retention.retentionUntil) <= now()) throw visualError('VISUAL_RESTORE_RETENTION_EXPIRED', 'retention expired', 409);
  if (!retention.bindingIds.includes(record.bindingId)) throw visualError('VISUAL_RESTORE_RETENTION_LINK_MISMATCH', 'retention missing binding id', 409);
  const releaseScopeHash = createReleaseScopeHash(record);
  if (
    receipt.releaseId !== record.releaseId
    || receipt.releaseScopeHash !== releaseScopeHash
    || receipt.scenarioId !== record.scenarioId
    || receipt.scenarioVersion !== record.scenarioVersion
    || receipt.arcId !== record.arcId
    || receipt.visualProfileId !== record.visualProfileId
    || receipt.visualProfileHash !== record.profileHash
    || receipt.catalogId !== record.catalogId
    || receipt.catalogRevision !== record.catalogRevision
    || receipt.catalogHash !== record.catalogHash
    || receipt.dictionaryVersion !== record.dictionaryVersion
    || receipt.dictionaryHash !== record.dictionaryHash
    || retention.releaseId !== record.releaseId
    || retention.releaseScopeHash !== releaseScopeHash
    || retention.scenarioId !== record.scenarioId
    || retention.scenarioVersion !== record.scenarioVersion
    || retention.arcId !== record.arcId
    || retention.visualProfileId !== record.visualProfileId
    || retention.visualProfileHash !== record.profileHash
    || retention.catalogId !== record.catalogId
    || retention.catalogRevision !== record.catalogRevision
    || retention.catalogHash !== record.catalogHash
    || retention.dictionaryVersion !== record.dictionaryVersion
    || retention.dictionaryHash !== record.dictionaryHash
  ) {
    throw visualError('VISUAL_RESTORE_RETENTION_SCOPE_MISMATCH', 'receipt/retention scope mismatch', 409);
  }
  if (
    receipt.entityKey !== record.entityKey
    || receipt.assetType !== record.entityType
    || receipt.bindingPolicy !== bindingPolicyForType(record.entityType)
    || receipt.sourceMessageIndex !== record.sourceMessageIndex
    || receipt.sourceMessageHash !== record.sourceMessageHash
    || receipt.evidenceDigest !== record.evidenceDigest
    || receipt.projectionId !== record.projectionId
    || receipt.projectionHash !== record.projectionHash
    || receipt.assetId !== record.assetId
    || receipt.assetVersion !== record.assetVersion
    || receipt.assetContentSha256 !== `sha256:${record.assetContentSha256}`
    || receipt.assetMetadataHash !== record.assetMetadataHash
    || receipt.catalogRefHash !== record.catalogRefHash
    || receipt.bindingRecordHash !== sha256Json(record)
    || Date.parse(receipt.expiresAt) > Date.parse(retention.retentionUntil)
  ) {
    throw visualError('VISUAL_RESTORE_RECEIPT_INVALID', 'receipt does not match retained binding', 409);
  }
}

async function atomicWriteBytes(filePath, bytes) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, bytes, { flag: 'wx' });
    const handle = await open(tmp, 'r+');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, filePath);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filePath, value) {
  await atomicWriteBytes(filePath, Buffer.from(`${canonicalJson(value)}\n`, 'utf8'));
}

function parseJsonNoBom(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', 'JSON BOM is not allowed', 500);
  }
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

export function createBuiltInSafePngDecoder() {
  return {
    schemaVersion: 'galgame.safe-png-decoder.v1',
    decoderId: 'builtin-png-safe-stripper',
    version: 1,
    decodeAndReencode({ bytes, metadata }) {
      return decodeAndSanitizePng(bytes, metadata);
    },
  };
}

function decodeAndSanitizePng(bytes, metadata) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw visualError('VISUAL_ASSET_UNSUPPORTED_IMAGE', 'only PNG images are supported', 400);
  }
  const chunks = readPngChunks(bytes);
  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  const iend = chunks.find((chunk) => chunk.type === 'IEND');
  if (!ihdr || !iend || chunks[0]?.type !== 'IHDR' || chunks[chunks.length - 1]?.type !== 'IEND') {
    throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG chunk order is invalid', 400);
  }
  const info = parsePngIhdr(ihdr.data);
  if (info.bitDepth !== 8 || ![2, 6].includes(info.colorType) || info.compression !== 0 || info.filter !== 0 || info.interlace !== 0) {
    throw visualError('VISUAL_ASSET_PNG_UNSUPPORTED', 'PNG format is not supported', 400);
  }
  const layout = validatePngDecodeBudget(info, bytes.length, metadata.role);
  const idatBuffers = [];
  for (const chunk of chunks) {
    if (PNG_ANIMATION_CHUNKS.has(chunk.type)) throw visualError('VISUAL_ASSET_ANIMATION_REJECTED', 'animated PNG is not allowed', 400);
    if (chunk.type === 'IDAT') {
      idatBuffers.push(chunk.data);
      continue;
    }
    if (['IHDR', 'IEND'].includes(chunk.type)) continue;
    if (chunk.type === 'PLTE' && info.colorType === 3) throw visualError('VISUAL_ASSET_PNG_UNSUPPORTED', 'palette PNG is not supported', 400);
    if (PNG_METADATA_CHUNKS.has(chunk.type)) continue;
    if (isAncillaryChunk(chunk.type)) {
      throw visualError('VISUAL_ASSET_METADATA_REJECTED', 'unknown PNG ancillary chunk rejected', 400);
    }
    throw visualError('VISUAL_ASSET_PNG_UNSUPPORTED', 'unknown PNG critical chunk rejected', 400);
  }
  if (idatBuffers.length === 0) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG has no image data', 400);
  let inflated;
  try {
    inflated = inflateSync(Buffer.concat(idatBuffers), { maxOutputLength: layout.expectedInflatedLength });
  } catch {
    throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG image data is invalid', 400);
  }
  if (inflated.length !== layout.expectedInflatedLength) {
    throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG image data length is invalid', 400);
  }
  const pixels = unfilterPngScanlines(inflated, info, layout);
  const transparentPixel = info.colorType === 6 && hasTransparentPixel(pixels, layout.channels);
  const canonicalScanlines = Buffer.alloc(layout.expectedInflatedLength);
  for (let y = 0; y < info.height; y += 1) {
    const sourceStart = y * layout.rowBytes;
    const targetStart = y * (layout.rowBytes + 1);
    canonicalScanlines[targetStart] = 0;
    pixels.copy(canonicalScanlines, targetStart + 1, sourceStart, sourceStart + layout.rowBytes);
  }
  const outputBytes = encodePng({
    width: info.width,
    height: info.height,
    bitDepth: info.bitDepth,
    colorType: info.colorType,
    compression: 0,
    filter: 0,
    interlace: 0,
  }, canonicalScanlines);
  return {
    schemaVersion: 'galgame.safe-png-decoder-result.v1',
    decoderId: 'builtin-png-safe-stripper',
    version: 1,
    canonicalMime: PNG_MIME,
    outputBytes,
    width: info.width,
    height: info.height,
    hasAlpha: info.colorType === 6,
    transparentPixel,
    frames: 1,
    metadataStripped: true,
    hasUnsafeMetadata: false,
    compressionRatio: layout.expectedInflatedLength / Math.max(bytes.length, 1),
  };
}

function validatePngDecodeBudget(info, inputLength, role) {
  const channels = info.colorType === 6 ? 4 : 3;
  const maxDimension = role === 'background' ? MAX_SCENE_DIMENSION : MAX_SPRITE_ICON_DIMENSION;
  if (info.width > maxDimension || info.height > maxDimension) {
    throw visualError('VISUAL_ASSET_PIXEL_LIMIT', 'PNG dimensions exceed role limit', 413);
  }
  const pixels = info.width * info.height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_DECODED_PIXELS) {
    throw visualError('VISUAL_ASSET_PIXEL_LIMIT', 'PNG pixel count exceeds limit', 413);
  }
  const rowBytes = info.width * channels;
  const expectedInflatedLength = (rowBytes + 1) * info.height;
  if (!Number.isSafeInteger(rowBytes) || !Number.isSafeInteger(expectedInflatedLength) || expectedInflatedLength <= 0) {
    throw visualError('VISUAL_ASSET_SIZE_LIMIT', 'PNG decoded size is invalid', 413);
  }
  const ratio = expectedInflatedLength / Math.max(inputLength, 1);
  if (ratio > MAX_COMPRESSION_RATIO) {
    throw visualError('VISUAL_ASSET_SIZE_LIMIT', 'PNG compression ratio exceeds limit', 413);
  }
  return { channels, rowBytes, expectedInflatedLength };
}

function readPngChunks(bytes) {
  let offset = 8;
  const chunks = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG chunk is truncated', 400);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcOffset = dataEnd;
    if (dataEnd + 4 > bytes.length) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG chunk data is truncated', 400);
    const expectedCrc = bytes.readUInt32BE(crcOffset);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, 'latin1'), bytes.subarray(dataStart, dataEnd)]));
    if (actualCrc !== expectedCrc) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG chunk CRC is invalid', 400);
    chunks.push({ type, data: bytes.subarray(dataStart, dataEnd) });
    offset = crcOffset + 4;
    if (type === 'IEND') break;
  }
  if (offset !== bytes.length) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG has trailing bytes', 400);
  return chunks;
}

function parsePngIhdr(data) {
  if (data.length !== 13) throw visualError('VISUAL_ASSET_PNG_INVALID', 'IHDR length is invalid', 400);
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  if (width <= 0 || height <= 0) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG dimensions are invalid', 400);
  return {
    width,
    height,
    bitDepth: data[8],
    colorType: data[9],
    compression: data[10],
    filter: data[11],
    interlace: data[12],
  };
}

function unfilterPngScanlines(inflated, info, layout) {
  const output = Buffer.alloc(layout.rowBytes * info.height);
  const bpp = layout.channels;
  for (let y = 0; y < info.height; y += 1) {
    const rowStart = y * (layout.rowBytes + 1);
    const filter = inflated[rowStart];
    if (filter > 4) throw visualError('VISUAL_ASSET_PNG_INVALID', 'PNG scanline filter is invalid', 400);
    const source = inflated.subarray(rowStart + 1, rowStart + 1 + layout.rowBytes);
    const targetStart = y * layout.rowBytes;
    const previousStart = y > 0 ? targetStart - layout.rowBytes : -1;
    for (let x = 0; x < layout.rowBytes; x += 1) {
      const left = x >= bpp ? output[targetStart + x - bpp] : 0;
      const up = previousStart >= 0 ? output[previousStart + x] : 0;
      const upLeft = previousStart >= 0 && x >= bpp ? output[previousStart + x - bpp] : 0;
      let value = source[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) value = (value + paeth(left, up, upLeft)) & 0xff;
      output[targetStart + x] = value;
    }
  }
  return output;
}

function hasTransparentPixel(pixels, channels) {
  if (channels !== 4) return false;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 255) return true;
  }
  return false;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function encodePng(ihdrInfo, scanlines) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ihdrInfo.width, 0);
  ihdr.writeUInt32BE(ihdrInfo.height, 4);
  ihdr[8] = ihdrInfo.bitDepth;
  ihdr[9] = ihdrInfo.colorType;
  ihdr[10] = ihdrInfo.compression;
  ihdr[11] = ihdrInfo.filter;
  ihdr[12] = ihdrInfo.interlace;
  const idat = deflateSync(scanlines);
  return Buffer.concat([
    PNG_SIGNATURE,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', idat),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createPngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'latin1');
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function isAncillaryChunk(type) {
  const code = type.charCodeAt(0);
  return (code & 0x20) !== 0;
}

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = PNG_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createTransparentPngBytes() {
  const scanline = Buffer.from([0, 0, 0, 0, 0]);
  return encodePng({
    width: 1,
    height: 1,
    bitDepth: 8,
    colorType: 6,
    compression: 0,
    filter: 0,
    interlace: 0,
  }, scanline);
}

export function createVisualAssetService({
  adminToken = process.env.GALGAME_VISUAL_ASSET_ADMIN_TOKEN || '',
  adminOrigins = parseCsvEnv(process.env.GALGAME_VISUAL_ASSET_ADMIN_ORIGINS || ''),
  corePlayerOrigins = parseCsvEnv(process.env.GALGAME_VISUAL_CORE_PLAYER_ORIGINS || DEFAULT_VISUAL_CORE_PLAYER_ORIGINS.join(',')),
  visualMatchPlayerOrigins = parseCsvEnv(process.env.GALGAME_VISUAL_MATCH_PLAYER_ORIGINS || ''),
  visualMatchServiceToken = process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN || '',
  visualAssetInternalReadToken = process.env.GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN || '',
  visualProjectionSecret = process.env.GALGAME_VISUAL_PROJECTION_SECRET || '',
  visualRestoreServiceToken = process.env.GALGAME_VISUAL_RESTORE_SERVICE_TOKEN || '',
  visualRestoreProofSecret = process.env.GALGAME_VISUAL_RESTORE_PROOF_SECRET || '',
  visualRestoreProofKeyIds = parseCsvEnv(process.env.GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS || ''),
  projectionStubReader = null,
  projectionStubBaseUrl = process.env.GALGAME_VISUAL_PROJECTION_STUB_BASE_URL || '',
  projectionStubServiceToken = process.env.GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN || '',
  projectionStubTimeoutMs = Number(process.env.GALGAME_VISUAL_PROJECTION_STUB_TIMEOUT_MS || VISUAL_STUB_TIMEOUT_DEFAULT_MS),
  projectionStubMaxBytes = Number(process.env.GALGAME_VISUAL_PROJECTION_STUB_MAX_BYTES || VISUAL_STUB_RESPONSE_DEFAULT_MAX_BYTES),
  bindingStore = null,
  proofReplayStore = null,
  restoreReplayStore = null,
  assetStore = new MemoryVisualAssetStore(),
  contentStore = new MemoryContentStore(),
  visualControlStore = null,
  adminAppDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'game-admin'),
  localAdminEnabled = true,
  imageDecoder = createBuiltInSafePngDecoder(),
  allowTestImageDecoder = false,
  visualAnalyzer = null,
  analyzerBaseUrl = process.env.GALGAME_VISUAL_ANALYZER_BASE_URL || '',
  analyzerToken = process.env.GALGAME_VISUAL_ANALYZER_TOKEN || '',
  analyzerModel = process.env.GALGAME_VISUAL_ANALYZER_MODEL || '',
  analyzerRequestStyle = process.env.GALGAME_VISUAL_ANALYZER_REQUEST_STYLE || DEFAULT_ANALYZER_REQUEST_STYLE,
  analyzerTimeoutMs = Number(process.env.GALGAME_VISUAL_ANALYZER_TIMEOUT_MS || DEFAULT_ANALYZER_TIMEOUT_MS),
  analyzerCacheScope = process.env.GALGAME_VISUAL_ANALYZER_CACHE_SCOPE || DEFAULT_ANALYZER_CACHE_SCOPE,
  analysisCacheStore = new MemoryVisualAnalysisCacheStore(),
  visualRuntimeAnalyzer = null,
  runtimeBaseUrl = process.env.GALGAME_VISUAL_RUNTIME_BASE_URL || '',
  runtimeToken = process.env.GALGAME_VISUAL_RUNTIME_TOKEN || '',
  runtimeModel = process.env.GALGAME_VISUAL_RUNTIME_MODEL || '',
  runtimeRequestStyle = process.env.GALGAME_VISUAL_RUNTIME_REQUEST_STYLE || VISUAL_RUNTIME_REQUEST_STYLE,
  runtimeCacheScope = process.env.GALGAME_VISUAL_RUNTIME_CACHE_SCOPE || 'independent-runtime-v1',
  now = Date.now,
  maxRequestBytes = MAX_REQUEST_BYTES,
} = {}) {
  let initialized = false;
  const normalizedAdminToken = String(adminToken || '');
  const effectiveProofReplayStore = proofReplayStore || new MemoryProofReplayStore(now);
  const effectiveRestoreReplayStore = restoreReplayStore || new MemoryRestoreReplayStore(now);
  const effectiveVisualControlStore = visualControlStore || new MemoryVisualControlStore({ now });
  const localAdminSessions = new Map();
  const normalizedAdminAppDir = path.resolve(String(adminAppDir || ''));
  const adminOriginSet = new Set(adminOrigins.filter(Boolean));
  const corePlayerOriginSet = new Set(corePlayerOrigins.filter(Boolean));
  const visualMatchOriginSet = new Set(visualMatchPlayerOrigins.filter(Boolean));
  const visualMatchServiceTokenStatus = parseVisualMatchServiceToken(visualMatchServiceToken);
  const normalizedVisualMatchServiceToken = visualMatchServiceTokenStatus.token;
  const visualAssetInternalReadTokenStatus = parseVisualAssetInternalReadToken(visualAssetInternalReadToken);
  const normalizedVisualAssetInternalReadToken = visualAssetInternalReadTokenStatus.token;
  const normalizedProjectionSecret = String(visualProjectionSecret || '');
  const normalizedRestoreServiceToken = String(visualRestoreServiceToken || '');
  const normalizedRestoreProofSecret = String(visualRestoreProofSecret || '');
  const restoreProofKeyIdSet = new Set(visualRestoreProofKeyIds.filter(Boolean));
  const normalizedStubToken = String(projectionStubServiceToken || '');
  const normalizedStubTimeoutMs = Math.min(
    VISUAL_STUB_TIMEOUT_MAX_MS,
    Math.max(1, Number.isFinite(projectionStubTimeoutMs) ? projectionStubTimeoutMs : VISUAL_STUB_TIMEOUT_DEFAULT_MS),
  );
  const normalizedStubMaxBytes = Math.min(
    VISUAL_STUB_RESPONSE_MAX_BYTES,
    Math.max(1, Number.isFinite(projectionStubMaxBytes) ? projectionStubMaxBytes : VISUAL_STUB_RESPONSE_DEFAULT_MAX_BYTES),
  );
  const normalizedStubBaseUrl = String(projectionStubBaseUrl || '').trim();
  const normalizedAnalyzerBaseUrl = String(analyzerBaseUrl || '').trim().replace(/\/$/, '');
  const normalizedAnalyzerToken = String(analyzerToken || '');
  const normalizedAnalyzerModel = String(analyzerModel || '');
  const normalizedAnalyzerRequestStyle = String(analyzerRequestStyle || DEFAULT_ANALYZER_REQUEST_STYLE).trim();
  if (!ANALYZER_REQUEST_STYLE_SET.has(normalizedAnalyzerRequestStyle)) {
    throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'analyzer request style is invalid', 500);
  }
  const normalizedAnalyzerCacheScope = String(analyzerCacheScope || DEFAULT_ANALYZER_CACHE_SCOPE).trim();
  const normalizedAnalyzerTimeoutMs = Math.min(30_000, Math.max(500, Number.isFinite(analyzerTimeoutMs) ? analyzerTimeoutMs : DEFAULT_ANALYZER_TIMEOUT_MS));
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(normalizedAnalyzerCacheScope)) {
    throw visualError('VISUAL_ANALYSIS_CACHE_INVALID', 'analyzer cache scope is invalid', 500);
  }
  if (normalizedAnalyzerRequestStyle === 'anthropic_messages_vision' && normalizedAnalyzerBaseUrl) {
    createAnthropicMessagesEndpoint(normalizedAnalyzerBaseUrl);
  }
  const normalizedRuntimeBaseUrl = String(runtimeBaseUrl || '').trim().replace(/\/$/, '');
  const normalizedRuntimeToken = String(runtimeToken || '');
  const normalizedRuntimeModel = String(runtimeModel || '');
  const normalizedRuntimeRequestStyle = String(runtimeRequestStyle || VISUAL_RUNTIME_REQUEST_STYLE).trim();
  const normalizedRuntimeCacheScope = String(runtimeCacheScope || 'independent-runtime-v1').trim();
  if (!VISUAL_RUNTIME_REQUEST_STYLE_SET.has(normalizedRuntimeRequestStyle)) {
    throw visualError('VISUAL_RUNTIME_CONFIG_INVALID', 'runtime request style is invalid', 500);
  }
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(normalizedRuntimeCacheScope)) {
    throw visualError('VISUAL_RUNTIME_CONFIG_INVALID', 'runtime cache scope is invalid', 500);
  }
  if (normalizedRuntimeBaseUrl) {
    let runtimeUrl;
    try {
      runtimeUrl = new URL(normalizedRuntimeBaseUrl);
    } catch {
      throw visualError('VISUAL_RUNTIME_CONFIG_INVALID', 'runtime base URL is invalid', 500);
    }
    if (!['http:', 'https:'].includes(runtimeUrl.protocol) || runtimeUrl.username || runtimeUrl.password || runtimeUrl.search || runtimeUrl.hash) {
      throw visualError('VISUAL_RUNTIME_CONFIG_INVALID', 'runtime base URL is not an allowed endpoint', 500);
    }
    if (normalizedRuntimeRequestStyle === VISUAL_RUNTIME_ANTHROPIC_REQUEST_STYLE) {
      createAnthropicMessagesEndpoint(normalizedRuntimeBaseUrl);
    }
  }
  const runtimeScopeHash = sha256Json({
    scope: normalizedRuntimeCacheScope,
    baseUrl: normalizedRuntimeBaseUrl,
    model: normalizedRuntimeModel,
    requestStyle: normalizedRuntimeRequestStyle,
    tokenHash: normalizedRuntimeToken ? sha256Hex(Buffer.from(normalizedRuntimeToken, 'utf8')) : null,
    injected: typeof visualRuntimeAnalyzer === 'function',
  });
  const analyzerScopeHash = sha256Json({
    scope: normalizedAnalyzerCacheScope,
    baseUrl: normalizedAnalyzerBaseUrl,
    model: normalizedAnalyzerModel,
    requestStyle: normalizedAnalyzerRequestStyle,
    tokenHash: normalizedAnalyzerToken ? sha256Hex(Buffer.from(normalizedAnalyzerToken, 'utf8')) : null,
    injected: typeof visualAnalyzer === 'function',
  });
  const analysisInFlight = new Map();
  const runtimeHintCache = new Map();
  const runtimeHintInFlight = new Map();

  function analyzerCacheKey(assetType, contentHash) {
    return sha256Json({
      assetType,
      contentHash,
      analyzerScopeHash,
    });
  }

  function runtimeCacheKey(visibleContext, catalogHash) {
    return sha256Json({
      currentHash: visibleContext.currentHash,
      recentHash: visibleContext.recentHash,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      catalogHash,
      runtimeScope: runtimeScopeHash,
    });
  }

  function runtimeFailure(errorCode) {
    const status = errorCode === 'RUNTIME_NOT_CONFIGURED' ? 'unavailable' : 'ambiguous';
    return { hint: createRuntimePlaceholderHint(status), errorCode, attempted: errorCode !== 'RUNTIME_NOT_CONFIGURED' };
  }

  async function readRuntimeResponseBytes(response) {
    let headerBytes = 0;
    for (const [name, value] of response.headers) {
      headerBytes += Buffer.byteLength(name, 'utf8') + Buffer.byteLength(value, 'utf8') + 4;
    }
    if (headerBytes > VISUAL_RUNTIME_RESPONSE_HEADERS_MAX_BYTES) {
      throw visualError('RUNTIME_HTTP_ERROR', 'runtime response headers exceed limit', 502);
    }
    if (!response.body?.getReader) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > VISUAL_RUNTIME_RESPONSE_MAX_BYTES) throw visualError('RUNTIME_INVALID_JSON', 'runtime response exceeds limit', 502);
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > VISUAL_RUNTIME_RESPONSE_MAX_BYTES) {
          await reader.cancel();
          throw visualError('RUNTIME_INVALID_JSON', 'runtime response exceeds limit', 502);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks);
  }

  async function callRuntimeAnalyzer(visibleContext) {
    if (typeof visualRuntimeAnalyzer === 'function') {
      const requestDigest = sha256Json({
        currentHash: visibleContext.currentHash,
        recentHash: visibleContext.recentHash,
        dictionaryVersion: DICTIONARY_VERSION,
        dictionaryHash: DICTIONARY_HASH,
      });
      let timeoutHandle;
      const result = await Promise.race([
        Promise.resolve().then(() => visualRuntimeAnalyzer({
          visibleContext: { current: visibleContext.current, recent: visibleContext.recent },
          instruction: VISUAL_RUNTIME_FIXED_INSTRUCTION,
          requestDigest,
        })),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(visualError('RUNTIME_TIMEOUT', 'runtime analyzer timed out', 504)), VISUAL_RUNTIME_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timeoutHandle));
      assertRuntimeHint(result, 'runtimeAnalyzerResponse');
      return result;
    }
    if (!normalizedRuntimeBaseUrl) return createRuntimePlaceholderHint('unavailable');
    const isAnthropicMessages = normalizedRuntimeRequestStyle === VISUAL_RUNTIME_ANTHROPIC_REQUEST_STYLE;
    const isOpenAiChatCompletions = normalizedRuntimeRequestStyle === VISUAL_RUNTIME_OPENAI_REQUEST_STYLE;
    if ((isAnthropicMessages || isOpenAiChatCompletions) && (!normalizedRuntimeToken || !normalizedRuntimeModel)) {
      throw visualError('RUNTIME_NOT_CONFIGURED', 'runtime analyzer is not configured', 503);
    }
    const visiblePayload = {
      schemaVersion: 'galgame.visual-runtime-hints-request.v1',
      visibleContext: { current: visibleContext.current, recent: visibleContext.recent },
    };
    const payload = isAnthropicMessages
      ? {
        model: normalizedRuntimeModel,
        max_tokens: VISUAL_RUNTIME_MAX_TOKENS,
        system: VISUAL_RUNTIME_FIXED_INSTRUCTION,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: canonicalJson(visiblePayload) }],
        }],
      }
      : isOpenAiChatCompletions
        ? {
          model: normalizedRuntimeModel,
          temperature: 0,
          max_tokens: VISUAL_RUNTIME_MAX_TOKENS,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: VISUAL_RUNTIME_FIXED_INSTRUCTION },
            { role: 'user', content: canonicalJson(visiblePayload) },
          ],
        }
        : {
          ...visiblePayload,
          instruction: VISUAL_RUNTIME_FIXED_INSTRUCTION,
        };
    assertSerializedSize(payload, VISUAL_RUNTIME_REQUEST_MAX_BYTES, 'runtimeAnalyzerRequest');
    const body = canonicalJson(payload);
    let lastError = null;
    for (let attempt = 0; attempt <= VISUAL_RUNTIME_MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VISUAL_RUNTIME_TIMEOUT_MS);
      try {
        const headers = {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(isAnthropicMessages ? {
            'anthropic-version': '2023-06-01',
            'x-api-key': normalizedRuntimeToken,
          } : {}),
        };
        if (!isAnthropicMessages && normalizedRuntimeToken) headers.authorization = `Bearer ${normalizedRuntimeToken}`;
        const endpoint = isAnthropicMessages
          ? createAnthropicMessagesEndpoint(normalizedRuntimeBaseUrl)
          : isOpenAiChatCompletions
            ? createOpenAiChatCompletionsEndpoint(normalizedRuntimeBaseUrl)
            : normalizedRuntimeBaseUrl;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body,
          redirect: 'error',
          signal: controller.signal,
        });
        if (!response.ok) throw visualError('RUNTIME_HTTP_ERROR', 'runtime analyzer returned a non-success status', 502);
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) throw visualError('RUNTIME_INVALID_JSON', 'runtime analyzer content type is invalid', 502);
        const responseBytes = await readRuntimeResponseBytes(response);
        const responseText = responseBytes.toString('utf8');
        assertJsonText(responseText, VISUAL_RUNTIME_RESPONSE_MAX_BYTES, 'runtimeAnalyzerResponse');
        assertNoDuplicateJsonKeys(responseText, 'runtimeAnalyzerResponse');
        let parsed;
        try {
          parsed = JSON.parse(responseText);
        } catch {
          throw visualError('RUNTIME_INVALID_JSON', 'runtime analyzer JSON is invalid', 502);
        }
        const hint = isAnthropicMessages
          ? parseAnthropicMessagesResponse(parsed)
          : isOpenAiChatCompletions
            ? parseOpenAiChatCompletionsResponse(parsed, 'runtimeResponse')
            : parsed;
        assertRuntimeHint(hint);
        return hint;
      } catch (error) {
        if (error?.name === 'AbortError') lastError = visualError('RUNTIME_TIMEOUT', 'runtime analyzer timed out', 504);
        else if (error?.code === 'RUNTIME_NOT_CONFIGURED') lastError = error;
        else if (error?.code === 'RUNTIME_HTTP_ERROR' || error?.code === 'RUNTIME_INVALID_JSON' || error?.code === 'RUNTIME_SCHEMA_INVALID' || error?.code === 'RUNTIME_DICTIONARY_MISMATCH') lastError = error;
        else if (['ANALYZER_INVALID_JSON', 'VISUAL_ASSET_JSON_BOM_REJECTED'].includes(error?.code)) lastError = visualError('RUNTIME_INVALID_JSON', 'runtime analyzer JSON is invalid', 502);
        else if (['VISUAL_ASSET_DUPLICATE_FIELD', 'VISUAL_ASSET_UNKNOWN_FIELD', 'VISUAL_ASSET_MISSING_FIELD', 'VISUAL_ASSET_BAD_REQUEST', 'VISUAL_ANALYSIS_SCHEMA_INVALID'].includes(error?.code)) lastError = visualError('RUNTIME_SCHEMA_INVALID', 'runtime analyzer response schema is invalid', 502);
        else if (error?.code === 'VISUAL_ANALYSIS_DICTIONARY_MISMATCH') lastError = visualError('RUNTIME_DICTIONARY_MISMATCH', 'runtime analyzer dictionary is invalid', 502);
        else lastError = visualError('RUNTIME_NETWORK_ERROR', 'runtime analyzer network request failed', 502);
        const retryable = lastError?.code === 'RUNTIME_TIMEOUT'
          || lastError?.code === 'RUNTIME_NETWORK_ERROR'
          || (VISUAL_RUNTIME_RETRY_SCHEMA_INVALID && [
            'RUNTIME_INVALID_JSON',
            'RUNTIME_SCHEMA_INVALID',
            'RUNTIME_DICTIONARY_MISMATCH',
          ].includes(lastError?.code));
        if (!retryable || attempt >= VISUAL_RUNTIME_MAX_RETRIES) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    if (lastError?.code === 'RUNTIME_TIMEOUT') throw lastError;
    if (lastError?.code === 'RUNTIME_NOT_CONFIGURED' || lastError?.code === 'RUNTIME_HTTP_ERROR' || lastError?.code === 'RUNTIME_INVALID_JSON' || lastError?.code === 'RUNTIME_SCHEMA_INVALID' || lastError?.code === 'RUNTIME_DICTIONARY_MISMATCH') throw lastError;
    throw visualError('RUNTIME_NETWORK_ERROR', 'runtime analyzer network request failed', 502);
  }

  async function resolveRuntimeHints(visibleContext, catalogHash) {
    const key = runtimeCacheKey(visibleContext, catalogHash);
    const cached = runtimeHintCache.get(key);
    if (cached && cached.expiresAt > now()) {
      return { hint: structuredClone(cached.hint), errorCode: null, cached: true, attempted: true };
    }
    if (cached) runtimeHintCache.delete(key);
    const existing = runtimeHintInFlight.get(key);
    if (existing) return { ...(await existing), cached: false, deduped: true };
    const pending = (async () => {
      if (!normalizedRuntimeBaseUrl && typeof visualRuntimeAnalyzer !== 'function') return runtimeFailure('RUNTIME_NOT_CONFIGURED');
      try {
        const hint = await callRuntimeAnalyzer(visibleContext);
        const cachedHint = structuredClone(hint);
        runtimeHintCache.set(key, { hint: cachedHint, expiresAt: now() + VISUAL_RUNTIME_CACHE_TTL_MS });
        while (runtimeHintCache.size > VISUAL_RUNTIME_CACHE_MAX_ENTRIES) runtimeHintCache.delete(runtimeHintCache.keys().next().value);
        return { hint: structuredClone(cachedHint), errorCode: null, attempted: true };
      } catch (error) {
        return runtimeFailure(runtimeErrorCode(error));
      }
    })();
    runtimeHintInFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      runtimeHintInFlight.delete(key);
    }
  }

  function normalizeAnalyzerOutput(output, assetType) {
    requireExactKeys(output, ['description', 'tagCodes', 'attributeCodes', 'confidence', 'analyzerVersion'], 'analyzerResponse');
    try {
      assertSafeAnalyzerDescription(output.description, 'analyzerResponse.description', 1, MAX_ANALYZER_DESCRIPTION_LENGTH);
    } catch (error) {
      if (error?.code === 'VISUAL_ANALYSIS_FORBIDDEN_FIELD') throw error;
      throw visualError('ANALYZER_OUTPUT_DESCRIPTION_INVALID', 'analyzer description is invalid', 400);
    }
    for (const [field, value] of [['tagCodes', output.tagCodes], ['attributeCodes', output.attributeCodes]]) {
      try {
        assertAnalysisCodeArray(value, `analyzerResponse.${field}`, assetType);
      } catch (error) {
        if (error?.code === 'VISUAL_ANALYSIS_UNKNOWN_CODE') throw visualError('ANALYZER_OUTPUT_CODE_INVALID', 'analyzer output contains an unknown dictionary code', 400);
        if (error?.details?.reason === 'duplicate_code') throw visualError('ANALYZER_OUTPUT_DUPLICATE_CODES', 'analyzer output contains duplicate codes', 400);
        throw visualError('ANALYZER_OUTPUT_CODES_INVALID', 'analyzer output codes are invalid', 400);
      }
    }
    const allCodes = new Set(output.tagCodes);
    for (const code of output.attributeCodes) {
      if (allCodes.has(code)) throw visualError('ANALYZER_OUTPUT_DUPLICATE_CODES', 'analyzer output contains duplicate codes', 400);
      allCodes.add(code);
    }
    if (typeof output.confidence !== 'number' || !Number.isFinite(output.confidence)) {
      throw visualError('ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID', 'analyzer confidence must be a finite JSON number', 400);
    }
    if (output.confidence <= 0 || output.confidence > 1) {
      throw visualError('ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID', 'analyzer confidence is outside the allowed range', 400);
    }
    try {
      assertSafeString(output.analyzerVersion, 'analyzerResponse.analyzerVersion', 1, 80, /^[A-Za-z0-9._:-]+$/);
    } catch {
      throw visualError('ANALYZER_OUTPUT_VERSION_INVALID', 'analyzer version is invalid', 400);
    }
    return {
      schemaVersion: VISUAL_ANALYSIS_SCHEMA_VERSION,
      status: 'ready',
      description: output.description,
      tagCodes: [...output.tagCodes],
      attributeCodes: [...output.attributeCodes],
      confidence: output.confidence,
      analyzerVersion: output.analyzerVersion,
      errorCode: null,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
    };
  }

  function createAnalyzerTask(assetType) {
    return [
      'Return only closed visual tags as a JSON object with description, tagCodes, attributeCodes, confidence and analyzerVersion for this PNG.',
      'Use only the finite dictionary codes listed here; do not return prose or extra fields.',
      'Return exactly one complete JSON object with all five fields: {"description":"short description","tagCodes":[],"attributeCodes":[],"confidence":0.90,"analyzerVersion":"version"}. Never omit a field.',
      'confidence must be a JSON number strictly greater than 0 and less than or equal to 1; never return a percentage, string, zero, NaN or Infinity.',
      `Allowed tagCodes: ${TAG_DICTIONARY[assetType].join(', ')}.`,
      `Allowed attributeCodes: ${FEATURE_DICTIONARY[assetType].join(', ')}.`,
    ].join(' ');
  }

  function createAnthropicMessagesEndpoint(baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'analyzer base URL is invalid', 500);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'analyzer base URL is not an allowed origin URL', 500);
    }
    const basePath = parsed.pathname.replace(/\/+$/, '') || '';
    if (basePath !== '' && basePath !== '/v1' && basePath !== '/v1/messages') {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'analyzer base URL path is not allowed', 500);
    }
    const normalizedPath = basePath.endsWith('/v1/messages')
      ? basePath
      : `${basePath.replace(/\/v1$/, '')}/v1/messages`.replace(/^\/\/+/u, '/');
    parsed.pathname = normalizedPath || '/v1/messages';
    return parsed.toString();
  }

  function createOpenAiChatCompletionsEndpoint(baseUrl) {
    let parsed;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'OpenAI-compatible base URL is invalid', 500);
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'OpenAI-compatible base URL is not an allowed URL', 500);
    }
    const basePath = parsed.pathname.replace(/\/+$/, '');
    if (basePath !== '/v1' && basePath !== '/v1/chat/completions') {
      throw visualError('VISUAL_ANALYZER_CONFIG_INVALID', 'OpenAI-compatible base URL path is not allowed', 500);
    }
    parsed.pathname = basePath.endsWith('/chat/completions') ? basePath : `${basePath}/chat/completions`;
    return parsed.toString();
  }

  function parseOpenAiChatCompletionsResponse(payload, label) {
    if (!isPlainObject(payload)) {
      throw visualError('ANALYZER_ENVELOPE_INVALID', `${label} envelope is invalid`, 502);
    }
    const invalidCode = label === 'runtimeResponse' ? 'RUNTIME_SCHEMA_INVALID' : 'ANALYZER_ENVELOPE_INVALID';
    const invalidContentCode = label === 'runtimeResponse' ? 'RUNTIME_SCHEMA_INVALID' : 'ANALYZER_CONTENT_INVALID';
    const failEnvelope = () => { throw visualError(invalidCode, `${label} envelope is invalid`, 502); };
    const failContent = () => { throw visualError(invalidContentCode, `${label} content is invalid`, 502); };
    try {
      requireExactKeysWithOptional(payload, ['choices'], ['id', 'object', 'created', 'model', 'system_fingerprint', 'usage', 'service_tier'], label);
    } catch {
      return failEnvelope();
    }
    if (!Array.isArray(payload.choices) || payload.choices.length !== 1 || !isPlainObject(payload.choices[0])) return failEnvelope();
    const choice = payload.choices[0];
    try {
      requireExactKeysWithOptional(choice, ['message'], ['index', 'finish_reason', 'logprobs'], `${label}.choices[0]`);
      requireExactKeysWithOptional(choice.message, ['content'], ['role', 'refusal', 'annotations', 'audio', 'function_call', 'tool_calls'], `${label}.choices[0].message`);
    } catch {
      return failEnvelope();
    }
    if (choice.message.role !== undefined && choice.message.role !== 'assistant') return failEnvelope();
    if (typeof choice.message.content !== 'string') return failContent();
    const text = choice.message.content;
    const fenced = /^```json\\r?\\n([\\s\\S]*?)\\r?\\n```$/u.exec(text);
    const jsonText = fenced ? fenced[1] : text;
    if (text.trimStart().startsWith('```') && !fenced) {
      throw visualError(label === 'runtimeResponse' ? 'RUNTIME_INVALID_JSON' : 'ANALYZER_INVALID_JSON', `${label} JSON fence is invalid`, 502);
    }
    try {
      assertNoDuplicateJsonKeys(jsonText, `${label}.choices[0].message.content`);
      return JSON.parse(jsonText);
    } catch (error) {
      if (error?.code === 'VISUAL_ASSET_DUPLICATE_FIELD') throw error;
      throw visualError(label === 'runtimeResponse' ? 'RUNTIME_INVALID_JSON' : 'ANALYZER_INVALID_JSON', `${label} JSON content is invalid`, 502);
    }
  }

  function parseAnthropicMessagesResponse(payload) {
    if (!isPlainObject(payload)) {
      throw visualError('ANALYZER_ENVELOPE_INVALID', 'anthropic response envelope is invalid', 502);
    }
    try {
      requireExactKeysWithOptional(
        payload,
        ['content'],
        ['id', 'type', 'role', 'model', 'stop_reason', 'stop_sequence', 'usage', 'container', 'context_management', 'service_tier'],
        'anthropicResponse',
      );
    } catch {
      throw visualError('ANALYZER_ENVELOPE_INVALID', 'anthropic response envelope is invalid', 502);
    }
    if (payload.type !== undefined && payload.type !== 'message') {
      throw visualError('ANALYZER_ENVELOPE_INVALID', 'anthropic response type is invalid', 502);
    }
    if (payload.role !== undefined && payload.role !== 'assistant') {
      throw visualError('ANALYZER_ENVELOPE_INVALID', 'anthropic response role is invalid', 502);
    }
    if (!Array.isArray(payload.content) || payload.content.length !== 1) {
      throw visualError('ANALYZER_CONTENT_INVALID', 'anthropic response must contain one text block', 502);
    }
    const block = payload.content[0];
    try {
      requireExactKeys(block, ['type', 'text'], 'anthropicResponse.content[0]');
    } catch {
      throw visualError('ANALYZER_CONTENT_INVALID', 'anthropic response content block is invalid', 502);
    }
    if (block.type !== 'text' || typeof block.text !== 'string') {
      throw visualError('ANALYZER_CONTENT_INVALID', 'anthropic response content is not text', 502);
    }
    const text = block.text;
    const fenced = /^```json\r?\n([\s\S]*?)\r?\n```$/u.exec(text);
    const jsonText = fenced ? fenced[1] : text;
    if (text.trimStart().startsWith('```') && !fenced) {
      throw visualError('ANALYZER_INVALID_JSON', 'anthropic response fence is invalid', 502);
    }
    if (jsonText.charCodeAt(0) === 0xfeff) {
      throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', 'anthropic response JSON BOM is not allowed', 502);
    }
    try {
      assertNoDuplicateJsonKeys(jsonText, 'anthropicResponse.content[0].text');
      return JSON.parse(jsonText);
    } catch (error) {
      if (error?.code === 'VISUAL_ASSET_DUPLICATE_FIELD') throw error;
      if (error?.code === 'ANALYZER_INVALID_JSON') throw error;
      throw visualError('ANALYZER_INVALID_JSON', 'anthropic response text JSON is invalid', 502);
    }
  }

  async function callConfiguredAnalyzer({ bytes, assetType, contentHash }) {
    if (typeof visualAnalyzer === 'function') {
      const output = await visualAnalyzer({
        schemaVersion: 'galgame.visual-analyzer-request.v1',
        assetType,
        contentHash,
        imageBase64: bytes.toString('base64'),
        task: createAnalyzerTask(assetType),
      });
      return output?.status === 'unavailable' || output?.status === 'failed'
        ? output
        : normalizeAnalyzerOutput(output, assetType);
    }
    if (!normalizedAnalyzerBaseUrl || !normalizedAnalyzerModel) {
      return createUnavailableVisualAnalysis('ANALYZER_NOT_CONFIGURED');
    }
    if (normalizedAnalyzerRequestStyle === 'anthropic_messages_vision' && !normalizedAnalyzerToken) {
      return createUnavailableVisualAnalysis('ANALYZER_NOT_CONFIGURED');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), normalizedAnalyzerTimeoutMs);
    const isAnthropicMessages = normalizedAnalyzerRequestStyle === 'anthropic_messages_vision';
    const isOpenAiChatCompletions = normalizedAnalyzerRequestStyle === ANALYZER_OPENAI_CHAT_COMPLETIONS_REQUEST_STYLE;
    try {
      const endpoint = isAnthropicMessages
        ? createAnthropicMessagesEndpoint(normalizedAnalyzerBaseUrl)
        : isOpenAiChatCompletions
          ? createOpenAiChatCompletionsEndpoint(normalizedAnalyzerBaseUrl)
          : `${normalizedAnalyzerBaseUrl}/v1/analyze`;
      const body = isAnthropicMessages
        ? {
          model: normalizedAnalyzerModel,
          max_tokens: ANALYZER_MAX_TOKENS,
          temperature: 0,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: PNG_MIME,
                  data: bytes.toString('base64'),
                },
              },
              { type: 'text', text: createAnalyzerTask(assetType) },
            ],
          }],
        }
        : isOpenAiChatCompletions
          ? {
            model: normalizedAnalyzerModel,
            temperature: 0,
            max_tokens: ANALYZER_OPENAI_MAX_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content: '你是受控视觉标签分析器。只返回一个 JSON 对象，且只能包含五个字段：description（可见内容的简短描述字符串）、tagCodes（只使用给定字典中的标签代码数组）、attributeCodes（只使用给定字典中的属性代码数组）、confidence（0到1之间的 JSON 数字）、analyzerVersion（版本字符串）。禁止返回 summary、objects、故事、用途、推断、markdown 或任何额外字段。',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: createAnalyzerTask(assetType) },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${PNG_MIME};base64,${bytes.toString('base64')}` },
                  },
                ],
              },
            ],
          }
          : {
            schemaVersion: 'galgame.visual-analyzer-request.v1',
            model: normalizedAnalyzerModel,
            assetType,
            contentHash,
            imageBase64: bytes.toString('base64'),
            task: createAnalyzerTask(assetType),
          };
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(isAnthropicMessages
            ? {
              'anthropic-version': '2023-06-01',
              ...(normalizedAnalyzerToken ? { 'x-api-key': normalizedAnalyzerToken } : {}),
            }
            : {
              ...(normalizedAnalyzerToken ? { authorization: `Bearer ${normalizedAnalyzerToken}` } : {}),
            }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) return createFailedVisualAnalysis(analyzerHttpErrorCode(response.status));
      const responseBytes = await readLimitedAnalyzerResponse(response, MAX_ANALYZER_RESPONSE_BYTES);
      const payload = parseAnalyzerResponseJson(responseBytes);
      const analyzerOutput = isAnthropicMessages
        ? parseAnthropicMessagesResponse(payload)
        : isOpenAiChatCompletions
          ? parseOpenAiChatCompletionsResponse(payload, 'analyzerResponse')
          : payload;
      return normalizeAnalyzerOutput(analyzerOutput, assetType);
    } catch (error) {
      if (error?.name === 'AbortError') return createFailedVisualAnalysis('ANALYZER_TIMEOUT');
      if (error?.code === 'ANALYZER_RESPONSE_TOO_LARGE') return createFailedVisualAnalysis('ANALYZER_RESPONSE_TOO_LARGE');
      if (error?.code === 'ANALYZER_ENVELOPE_INVALID') return createFailedVisualAnalysis('ANALYZER_ENVELOPE_INVALID');
      if (error?.code === 'ANALYZER_CONTENT_INVALID') return createFailedVisualAnalysis('ANALYZER_CONTENT_INVALID');
      if (error?.code === 'ANALYZER_INVALID_JSON' || error?.code === 'VISUAL_ASSET_JSON_BOM_REJECTED') return createFailedVisualAnalysis('ANALYZER_INVALID_JSON');
      if (error?.code && [
        'ANALYZER_OUTPUT_INVALID',
        'ANALYZER_OUTPUT_UNKNOWN_FIELD',
        'ANALYZER_OUTPUT_MISSING_FIELD',
        'ANALYZER_OUTPUT_VALUE_INVALID',
        'ANALYZER_OUTPUT_CODE_INVALID',
        'ANALYZER_OUTPUT_DESCRIPTION_INVALID',
        'ANALYZER_OUTPUT_CODES_INVALID',
        'ANALYZER_OUTPUT_CONFIDENCE_TYPE_INVALID',
        'ANALYZER_OUTPUT_CONFIDENCE_RANGE_INVALID',
        'ANALYZER_OUTPUT_VERSION_INVALID',
        'ANALYZER_OUTPUT_DUPLICATE_CODES',
      ].includes(error.code)) {
        if (isAnthropicMessages || isOpenAiChatCompletions) return createFailedVisualAnalysis(error.code);
        return createFailedVisualAnalysis(error.code === 'ANALYZER_OUTPUT_CODE_INVALID' ? 'ANALYZER_UNKNOWN_CODE' : 'ANALYZER_SCHEMA_INVALID');
      }
      if (isAnthropicMessages || isOpenAiChatCompletions) {
        if (error?.code === 'VISUAL_ASSET_DUPLICATE_FIELD') return createFailedVisualAnalysis('ANALYZER_OUTPUT_DUPLICATE_FIELD');
      }
      if (error?.code === 'VISUAL_ASSET_DUPLICATE_FIELD') return createFailedVisualAnalysis('ANALYZER_SCHEMA_INVALID');
      if (isAnthropicMessages || isOpenAiChatCompletions) {
        if (error?.code === 'VISUAL_ANALYSIS_SCHEMA_INVALID') return createFailedVisualAnalysis('ANALYZER_OUTPUT_INVALID');
        if (error?.code === 'VISUAL_ASSET_UNKNOWN_FIELD') return createFailedVisualAnalysis('ANALYZER_OUTPUT_UNKNOWN_FIELD');
        if (error?.code === 'VISUAL_ASSET_MISSING_FIELD') return createFailedVisualAnalysis('ANALYZER_OUTPUT_MISSING_FIELD');
        if (error?.code === 'VISUAL_ANALYSIS_UNKNOWN_CODE') return createFailedVisualAnalysis('ANALYZER_OUTPUT_CODE_INVALID');
      }
      if (error?.code === 'VISUAL_ANALYSIS_UNKNOWN_CODE') return createFailedVisualAnalysis('ANALYZER_UNKNOWN_CODE');
      if (error?.code === 'VISUAL_ANALYSIS_FORBIDDEN_FIELD') return createFailedVisualAnalysis('ANALYZER_FORBIDDEN_FIELD');
      if (
        error?.code?.startsWith?.('VISUAL_ANALYSIS_')
        || ['VISUAL_ASSET_BAD_REQUEST', 'VISUAL_ASSET_INVALID_FIELD', 'VISUAL_ASSET_INVALID_NUMBER', 'VISUAL_ASSET_DUPLICATE_CODE', 'VISUAL_ASSET_MISSING_FIELD', 'VISUAL_ASSET_UNKNOWN_FIELD'].includes(error?.code)
      ) {
        if ((isAnthropicMessages || isOpenAiChatCompletions) && ['VISUAL_ASSET_INVALID_FIELD', 'VISUAL_ASSET_INVALID_NUMBER', 'VISUAL_ASSET_DUPLICATE_CODE', 'VISUAL_ASSET_BAD_REQUEST'].includes(error?.code)) {
          return createFailedVisualAnalysis('ANALYZER_OUTPUT_VALUE_INVALID');
        }
        return createFailedVisualAnalysis(isAnthropicMessages || isOpenAiChatCompletions ? 'ANALYZER_OUTPUT_INVALID' : 'ANALYZER_SCHEMA_INVALID');
      }
      return createFailedVisualAnalysis('ANALYZER_NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
    }
  }

  async function readLimitedAnalyzerResponse(response, maxBytes) {
    const reader = response.body?.getReader?.();
    if (!reader || typeof reader.read !== 'function') {
      throw visualError('ANALYZER_INVALID_JSON', 'analyzer response body is unavailable', 502);
    }
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw visualError('ANALYZER_RESPONSE_TOO_LARGE', 'analyzer response exceeds the byte limit', 502);
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks);
  }

  function parseAnalyzerResponseJson(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', 'analyzer response BOM is not allowed', 502);
    }
    const text = bytes.toString('utf8');
    try {
      assertNoDuplicateJsonKeys(text, 'analyzerResponse');
      return JSON.parse(text);
    } catch (error) {
      if (error?.code === 'VISUAL_ASSET_DUPLICATE_FIELD') throw error;
      throw visualError('ANALYZER_INVALID_JSON', 'analyzer response JSON is invalid', 502);
    }
  }

  async function analyzeVisualAsset({ bytes, assetType, contentHash }) {
    const key = analyzerCacheKey(assetType, contentHash);
    const cached = await analysisCacheStore.get(key);
    if (cached) return structuredClone(cached.analysis);
    const existing = analysisInFlight.get(key);
    if (existing) return structuredClone(await existing);
    const pending = (async () => {
      let analysis;
      try {
        const result = await callConfiguredAnalyzer({ bytes, assetType, contentHash });
        analysis = ['ready', 'unavailable', 'failed'].includes(result?.status)
          ? result
          : createFailedVisualAnalysis('ANALYZER_SCHEMA_INVALID');
        validateVisualAnalysis(analysis, assetType);
      } catch (error) {
        const code = error?.code?.startsWith?.('ANALYZER_OUTPUT_') && ANALYSIS_ERROR_CODE_SET.has(error.code)
          ? error.code
          : error?.code === 'VISUAL_ANALYSIS_UNKNOWN_CODE'
          ? 'ANALYZER_UNKNOWN_CODE'
          : error?.code === 'VISUAL_ANALYSIS_FORBIDDEN_FIELD'
            ? 'ANALYZER_FORBIDDEN_FIELD'
            : error?.code === 'VISUAL_ANALYSIS_SCHEMA_INVALID'
              ? 'ANALYZER_OUTPUT_VALUE_INVALID'
              : 'ANALYZER_SCHEMA_INVALID';
        analysis = createFailedVisualAnalysis(code);
      }
      try {
        await analysisCacheStore.set({
          schemaVersion: ANALYSIS_CACHE_RECORD_SCHEMA_VERSION,
          cacheKey: key,
          assetType,
          contentHash,
          analyzerScopeHash,
          analysis: structuredClone(analysis),
        });
      } catch {
        return createFailedVisualAnalysis('ANALYZER_CACHE_WRITE_FAILED');
      }
      return analysis;
    })();
    analysisInFlight.set(key, pending);
    let analysis;
    try {
      analysis = await pending;
      return structuredClone(analysis);
    } finally {
      analysisInFlight.delete(key);
    }
  }

  function migrationPointerFromCatalog(catalog) {
    return {
      catalogId: catalog.catalogId,
      catalogRevision: catalog.catalogRevision,
      catalogHash: catalog.catalogHash,
    };
  }

  async function analyzeRuntimeMigrationAsset(asset) {
    const content = await contentStore.get(asset.assetContentSha256);
    if (!content) throw visualError('VISUAL_RUNTIME_MIGRATION_CONTENT_MISSING', 'legacy asset content is missing', 409);
    if (content.mime !== asset.canonicalMime || `sha256:${sha256Hex(content.bytes)}` !== asset.assetContentSha256) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_CONTENT_MISMATCH', 'legacy asset content does not match', 409);
    }
    const analysis = await analyzeVisualAsset({ bytes: content.bytes, assetType: asset.assetType, contentHash: asset.assetContentSha256 });
    if (analysis?.status !== 'ready') {
      throw visualError('VISUAL_RUNTIME_MIGRATION_ANALYSIS_UNAVAILABLE', 'runtime migration requires ready visual analysis', 409);
    }
    return analysis;
  }

  async function loadRuntimeMigrationContext() {
    if (!(assetStore instanceof FileVisualAssetStore) || typeof assetStore.getActiveMigrationSource !== 'function') {
      throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'service-owned migration requires FileVisualAssetStore', 409);
    }
    const source = await assetStore.getActiveMigrationSource();
    const oldPointer = migrationPointerFromCatalog(source.catalog);
    const control = await effectiveVisualControlStore.getControl();
    validateVisualControl(control);
    if (!control.activeCatalog || canonicalJson(control.activeCatalog) !== canonicalJson(oldPointer)) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_CONTROL_MISMATCH', 'visual control does not point to the migration source', 409, { oldPointer });
    }
    return { source, control, oldPointer };
  }

  function rethrowMigrationError(error, oldPointer) {
    if (error && typeof error === 'object') {
      error.details = { ...(error.details || {}), oldPointer };
    }
    throw error;
  }

  async function createOwnedRuntimeMigrationPlan(context) {
    return createRuntimeV2MigrationPlan({
      catalog: context.source.catalog,
      assets: context.source.assets,
      analyzeAsset: analyzeRuntimeMigrationAsset,
    });
  }

  async function previewRuntimeV2CatalogMigration() {
    const context = await loadRuntimeMigrationContext();
    if (context.source.catalog.dictionaryVersion === DICTIONARY_VERSION) {
      if (context.source.catalog.dictionaryHash !== DICTIONARY_HASH) {
        throw visualError('VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH', 'current catalog dictionary hash is invalid', 409);
      }
      return {
        ok: true,
        mode: 'dry-run',
        idempotent: true,
        oldPointer: context.oldPointer,
        newPointer: context.oldPointer,
        assetCount: context.source.assets.length,
        analysisReady: true,
      };
    }
    let plan;
    try {
      plan = await createOwnedRuntimeMigrationPlan(context);
    } catch (error) {
      rethrowMigrationError(error, context.oldPointer);
    }
    return {
      ok: true,
      mode: 'dry-run',
      idempotent: false,
      oldPointer: context.oldPointer,
      newPointer: migrationPointerFromCatalog(plan.catalog),
      assetCount: plan.assets.length,
      analysisReady: true,
    };
  }

  async function migrateRuntimeV2CatalogAndActivateControl() {
    const context = await loadRuntimeMigrationContext();
    if (context.source.catalog.dictionaryVersion === DICTIONARY_VERSION) {
      if (context.source.catalog.dictionaryHash !== DICTIONARY_HASH) {
        throw visualError('VISUAL_RUNTIME_MIGRATION_DICTIONARY_MISMATCH', 'current catalog dictionary hash is invalid', 409);
      }
      return {
        ok: true,
        mode: 'execute',
        idempotent: true,
        oldPointer: context.oldPointer,
        newPointer: context.oldPointer,
        assetCount: context.source.assets.length,
        analysisReady: true,
      };
    }
    let plan;
    try {
      plan = await createOwnedRuntimeMigrationPlan(context);
    } catch (error) {
      rethrowMigrationError(error, context.oldPointer);
    }
    const baseTransaction = assetStore.createRuntimeV2MigrationTransaction();
    let controlUpdated = false;
    const transaction = {
      snapshot: async () => ({
        assetStore: typeof baseTransaction.snapshot === 'function' ? await baseTransaction.snapshot() : null,
        control: structuredClone(context.control),
      }),
      stage: (migrationPlan) => baseTransaction.stage(migrationPlan),
      activate: async (migrationPlan) => {
        await baseTransaction.activate(migrationPlan);
        const nextControl = {
          ...context.control,
          activeCatalog: migrationPointerFromCatalog(migrationPlan.catalog),
          updatedAt: nowIso(now),
        };
        await effectiveVisualControlStore.setControl(nextControl);
        controlUpdated = true;
      },
      rollback: async (snapshot) => {
        await baseTransaction.rollback(snapshot?.assetStore);
        if (controlUpdated) await effectiveVisualControlStore.setControl(snapshot.control);
      },
    };
    try {
      await executeRuntimeV2Migration({
        catalog: context.source.catalog,
        assets: context.source.assets,
        analyzeAsset: analyzeRuntimeMigrationAsset,
        transaction,
      });
    } catch (error) {
      rethrowMigrationError(error, context.oldPointer);
    }
    return {
      ok: true,
      mode: 'execute',
      idempotent: false,
      oldPointer: context.oldPointer,
      newPointer: migrationPointerFromCatalog(plan.catalog),
      assetCount: plan.assets.length,
      analysisReady: true,
    };
  }

  async function migrateRuntimeV2Catalog({ catalog, assets, transaction } = {}) {
    let sourceCatalog = catalog;
    let sourceAssets = assets;
    if (sourceCatalog === undefined && sourceAssets === undefined) {
      if (!(assetStore instanceof FileVisualAssetStore) || typeof assetStore.getActiveMigrationSource !== 'function') {
        throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'service-owned migration requires FileVisualAssetStore', 409);
      }
      const source = await assetStore.getActiveMigrationSource();
      sourceCatalog = source.catalog;
      sourceAssets = source.assets;
    } else if (sourceCatalog === undefined || sourceAssets === undefined) {
      throw visualError('VISUAL_RUNTIME_MIGRATION_SOURCE_INVALID', 'migration catalog and assets must be loaded together', 400);
    }
    const effectiveTransaction = transaction || (
      assetStore instanceof FileVisualAssetStore
        ? assetStore.createRuntimeV2MigrationTransaction()
        : null
    );
    return executeRuntimeV2Migration({
      catalog: sourceCatalog,
      assets: sourceAssets,
      analyzeAsset: async (asset) => {
        return analyzeRuntimeMigrationAsset(asset);
      },
      transaction: effectiveTransaction,
    });
  }

  function verifyDecoder() {
    if (imageDecoder?.schemaVersion !== 'galgame.safe-png-decoder.v1' || imageDecoder?.decoderId !== 'builtin-png-safe-stripper' || imageDecoder?.version !== 1) {
      if (!allowTestImageDecoder) throw visualError('VISUAL_ASSET_DECODER_UNTRUSTED', 'production service requires built-in decoder', 500);
    }
    if (typeof imageDecoder?.decodeAndReencode !== 'function') throw visualError('VISUAL_ASSET_DECODER_UNTRUSTED', 'decoder is invalid', 500);
  }

  async function initialize() {
    if (initialized) return;
    verifyDecoder();
    await assetStore.initialize?.();
    await bindingStore?.initialize?.();
    await effectiveVisualControlStore.initialize?.();
    await analysisCacheStore.initialize?.();
    for (const asset of Object.values(BUILTIN_UNKNOWN_ASSETS)) {
      const content = await contentStore.put(TRANSPARENT_PNG_BYTES, PNG_MIME);
      if (content.hash !== asset.assetContentSha256) throw visualError('VISUAL_ASSET_UNKNOWN_TAMPERED', 'unknown content hash mismatch', 500);
      await assetStore.saveAsset(asset, { allowExactReplay: true });
    }
    initialized = true;
  }

  async function handleRequest(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      applyCors(req, res);
      await initialize();
      if (url.pathname === '/v1/core/visual-context' && req.method === 'OPTIONS') {
        throw visualError('VISUAL_CORE_CONTEXT_METHOD_NOT_ALLOWED', 'visual context only supports GET', 405);
      }
      if (req.method === 'OPTIONS' && url.pathname === '/v1/visual-match') {
        return sendVisualMatchOptions(req, res);
      }
      if (req.method === 'OPTIONS' && url.pathname === '/v1/core/visual-decisions') {
        return sendCoreDecisionOptions(req, res);
      }
      if (req.method === 'OPTIONS' && url.pathname === VISUAL_MATCH_INTERNAL_PATH) {
        return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_MATCH_SERVICE_BROWSER_FORBIDDEN' } });
      }
      if (req.method === 'OPTIONS' && isVisualAssetInternalPath(url.pathname)) {
        return sendInternalAssetJsonError(res, 403, 'VISUAL_ASSET_INTERNAL_BROWSER_FORBIDDEN');
      }
      if (req.method === 'OPTIONS' && isVisualRestoreBindingPath(url.pathname)) {
        return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_RESTORE_BROWSER_FORBIDDEN' } });
      }
      if (req.method === 'OPTIONS') return sendOptions(req, res);
      if (req.method === 'GET' && url.pathname === '/v1/health') {
        return sendJson(res, 200, {
          ok: true,
          service: SERVICE_NAME,
          schema: HEALTH_SCHEMA_VERSION,
          adminAuth: { configured: normalizedAdminToken.length > 0 },
          localAdmin: { enabled: Boolean(localAdminEnabled) },
          catalogStore: { persistent: assetStore instanceof FileVisualAssetStore },
          visualControl: { persistent: effectiveVisualControlStore instanceof FileVisualControlStore },
        });
      }
      if (localAdminEnabled && (url.pathname === LOCAL_ADMIN_STATIC_PREFIX || url.pathname.startsWith(`${LOCAL_ADMIN_STATIC_PREFIX}/`))) {
        return await handleLocalAdminStaticRoute(req, res, url);
      }
      if (localAdminEnabled && url.pathname.startsWith(`${LOCAL_ADMIN_API_PREFIX}/`)) {
        return await handleLocalAdminApiRoute(req, res, url);
      }
      if (req.method === 'POST' && url.pathname === '/v1/visual-match') {
        return await handleVisualMatchRoute(req, res);
      }
      if (req.method === 'POST' && url.pathname === VISUAL_MATCH_INTERNAL_PATH) {
        return await handleInternalVisualMatchRoute(req, res);
      }
      if (req.method === 'POST' && url.pathname === VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_PATH) {
        return await handleInternalAssetMetadataResolveRoute(req, res);
      }
      if (req.method === 'POST' && url.pathname === VISUAL_ASSET_INTERNAL_CONTENT_READ_PATH) {
        return await handleInternalAssetContentReadRoute(req, res);
      }
      if (req.method === 'POST' && isVisualRestoreBindingPath(url.pathname)) {
        return await handleVisualRestoreBindingRoute(req, res, url.pathname);
      }
      if (url.pathname.startsWith('/v1/core/')) {
        return await handleCorePublishedRoute(req, res, url);
      }
      if (url.pathname.startsWith('/v1/admin/')) {
        authorizeAdmin(req);
        return await handleAdminRoute(req, res, url);
      }
      return sendJson(res, 404, { ok: false, error: { code: 'VISUAL_ASSET_NOT_FOUND' } });
    } catch (error) {
      if (url?.pathname === '/v1/core/visual-context') {
        return sendCoreVisualContextError(res, error);
      }
      return sendJson(res, error.status || 500, {
        ok: false,
        error: { code: error.code || 'VISUAL_ASSET_INTERNAL_ERROR' },
      });
    }
  }

  function isLoopbackLocalAdminRequest(req) {
    const remoteAddress = req.socket?.remoteAddress || '';
    const host = String(req.headers.host || '').split(':')[0].replace(/^\[|\]$/g, '').toLowerCase();
    const loopbackRemote = remoteAddress === '127.0.0.1'
      || remoteAddress === '::1'
      || remoteAddress === '::ffff:127.0.0.1';
    const loopbackHost = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    return loopbackRemote && loopbackHost;
  }

  function requireLoopbackLocalAdmin(req) {
    if (!localAdminEnabled) throw visualError('VISUAL_LOCAL_ADMIN_DISABLED', 'local admin entry is disabled', 404);
    if (!isLoopbackLocalAdminRequest(req)) {
      throw visualError('VISUAL_LOCAL_ADMIN_LOOPBACK_REQUIRED', 'local admin entry is loopback only', 403);
    }
  }

  function requestOrigin(req) {
    const host = String(req.headers.host || '').trim();
    return host ? `http://${host}` : '';
  }

  function cleanupLocalAdminSessions() {
    const nowMs = now();
    for (const [sessionId, session] of localAdminSessions.entries()) {
      if (!session || session.expiresAt <= nowMs) localAdminSessions.delete(sessionId);
    }
  }

  function createLocalAdminSession() {
    cleanupLocalAdminSessions();
    const session = {
      sessionId: randomBytes(32).toString('base64url'),
      csrfToken: randomBytes(32).toString('base64url'),
      createdAt: now(),
      expiresAt: now() + LOCAL_ADMIN_SESSION_TTL_MS,
    };
    localAdminSessions.set(session.sessionId, session);
    return session;
  }

  function parseCookieHeader(header) {
    const cookies = new Map();
    String(header || '').split(';').forEach((part) => {
      const index = part.indexOf('=');
      if (index <= 0) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies.set(key, value);
    });
    return cookies;
  }

  function getLocalAdminSession(req) {
    cleanupLocalAdminSessions();
    const sessionId = parseCookieHeader(req.headers.cookie).get(LOCAL_ADMIN_SESSION_COOKIE) || '';
    const session = localAdminSessions.get(sessionId);
    if (!session || session.expiresAt <= now()) {
      if (sessionId) localAdminSessions.delete(sessionId);
      throw visualError('VISUAL_LOCAL_ADMIN_SESSION_REQUIRED', 'local admin session required', 401);
    }
    return session;
  }

  function safeCompareAscii(left, right) {
    const a = Buffer.from(String(left || ''), 'utf8');
    const b = Buffer.from(String(right || ''), 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  function authorizeLocalAdminApi(req, { requireCsrf = false } = {}) {
    requireLoopbackLocalAdmin(req);
    if (req.headers.authorization
      || req.headers['x-galgame-visual-projection-proof']
      || req.headers['x-galgame-visual-restore-proof']
      || req.headers['x-galgame-visual-asset-proof']) {
      throw visualError('VISUAL_LOCAL_ADMIN_FORBIDDEN_TRANSPORT', 'local admin browser route forbids bearer/proof transports', 400);
    }
    const origin = req.headers.origin;
    const expectedOrigin = requestOrigin(req);
    if (origin && origin !== expectedOrigin) {
      throw visualError('VISUAL_LOCAL_ADMIN_ORIGIN_REJECTED', 'local admin origin mismatch', 403);
    }
    const session = getLocalAdminSession(req);
    if (requireCsrf) {
      const csrf = req.headers[LOCAL_ADMIN_CSRF_HEADER] || '';
      if (!safeCompareAscii(csrf, session.csrfToken)) {
        throw visualError('VISUAL_LOCAL_ADMIN_CSRF_REJECTED', 'local admin csrf token rejected', 403);
      }
    }
    return session;
  }

  function setLocalAdminSessionCookie(res, session) {
    res.setHeader('Set-Cookie', `${LOCAL_ADMIN_SESSION_COOKIE}=${session.sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(LOCAL_ADMIN_SESSION_TTL_MS / 1000)}`);
  }

  function escapeHtmlAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function safeLocalAdminStaticPath(url) {
    let relativePath = url.pathname.slice(LOCAL_ADMIN_STATIC_PREFIX.length);
    if (!relativePath || relativePath === '/') relativePath = '/index.html';
    if (relativePath.includes('\\')) throw visualError('VISUAL_LOCAL_ADMIN_STATIC_FORBIDDEN', 'invalid static path', 400);
    const resolved = path.resolve(normalizedAdminAppDir, `.${relativePath}`);
    const rootWithSep = `${normalizedAdminAppDir}${path.sep}`;
    if (resolved !== normalizedAdminAppDir && !resolved.startsWith(rootWithSep)) {
      throw visualError('VISUAL_LOCAL_ADMIN_STATIC_FORBIDDEN', 'static path escapes admin app root', 400);
    }
    return resolved;
  }

  function contentTypeForStatic(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    if (filePath.endsWith('.png')) return PNG_MIME;
    return 'application/octet-stream';
  }

  async function handleLocalAdminStaticRoute(req, res, url) {
    requireLoopbackLocalAdmin(req);
    if (url.search && !/^\?v=auto-[a-f0-9]{12}$/.test(url.search)) {
      throw visualError('VISUAL_LOCAL_ADMIN_STATIC_FORBIDDEN', 'only build cache-busting query is allowed on local admin static entry', 400);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { ok: false, error: { code: 'VISUAL_LOCAL_ADMIN_METHOD_NOT_ALLOWED' } });
    }
    if (url.pathname === LOCAL_ADMIN_STATIC_PREFIX) {
      res.statusCode = 308;
      res.setHeader('Location', `${LOCAL_ADMIN_STATIC_PREFIX}/`);
      return res.end();
    }
    const filePath = safeLocalAdminStaticPath(url);
    if (!existsSync(filePath) || lstatSync(filePath).isDirectory()) {
      return sendJson(res, 404, { ok: false, error: { code: 'VISUAL_LOCAL_ADMIN_STATIC_NOT_FOUND' } });
    }
    if (path.basename(filePath) === 'index.html') {
      const session = createLocalAdminSession();
      setLocalAdminSessionCookie(res, session);
      const origin = requestOrigin(req);
      const body = readFileSync(filePath, 'utf8')
        .replace(/<meta name="galgame-visual-asset-service" content="[^"]*">/, `<meta name="galgame-visual-asset-service" content="${escapeHtmlAttr(origin)}">`)
        .replace(/<meta name="galgame-visual-asset-csrf-token" content="[^"]*">/, `<meta name="galgame-visual-asset-csrf-token" content="${escapeHtmlAttr(session.csrfToken)}">`)
        .replace('</head>', `<script>window.GALGAME_VISUAL_ASSET_SERVICE_URL=location.origin;window.GALGAME_VISUAL_ASSET_CSRF_TOKEN=${JSON.stringify(session.csrfToken)};window.GALGAME_VISUAL_ASSET_LOCAL_ADMIN=true;</script>\n</head>`);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'HEAD') res.end(body);
      else res.end();
      return;
    }
    const body = readFileSync(filePath);
    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForStatic(filePath));
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'HEAD') res.end(body);
    else res.end();
  }

  async function handleLocalAdminApiRoute(req, res, url) {
    if (url.search) throw visualError('VISUAL_LOCAL_ADMIN_FORBIDDEN_TRANSPORT', 'local admin route forbids query transport', 400);
    if (req.method === 'GET' && url.pathname === `${LOCAL_ADMIN_API_PREFIX}/status`) {
      authorizeLocalAdminApi(req);
      return sendJson(res, 200, { ok: true, visual: serializeVisualControl(await getVerifiedVisualControl()) });
    }
    if (req.method === 'POST' && url.pathname === `${LOCAL_ADMIN_API_PREFIX}/upload`) {
      authorizeLocalAdminApi(req, { requireCsrf: true });
      const body = await readJsonBody(req, maxRequestBytes);
      const asset = await uploadSimpleVisualAsset(body);
      return sendJson(res, 200, { ok: true, simpleUpload: serializeSimpleUploadResult(asset), asset: serializeAdminAsset(asset) });
    }
    if (req.method === 'POST' && url.pathname === `${LOCAL_ADMIN_API_PREFIX}/publish`) {
      authorizeLocalAdminApi(req, { requireCsrf: true });
      await readOptionalEmptyJsonBody(req);
      return sendJson(res, 200, await publishSimpleVisualCatalog());
    }
    if (req.method === 'OPTIONS') {
      return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_LOCAL_ADMIN_BROWSER_PREFLIGHT_FORBIDDEN' } });
    }
    return sendJson(res, 404, { ok: false, error: { code: 'VISUAL_LOCAL_ADMIN_NOT_FOUND' } });
  }

  function applyCors(req, res) {
    const origin = req.headers.origin;
    const pathname = req.url ? new URL(req.url, 'http://localhost').pathname : '';
    if (pathname === VISUAL_MATCH_INTERNAL_PATH) return;
    if (pathname === '/v1/core/visual-context' && origin && corePlayerOriginSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      return;
    }
    if (pathname === '/v1/core/visual-decisions' && origin && corePlayerOriginSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      return;
    }
    if (/^\/v1\/core\/catalogs\/[a-z][a-z0-9_-]{2,79}\/[1-9][0-9]{0,5}\/assets\/[a-z][a-z0-9_-]{2,79}\/[1-9][0-9]{0,5}\/content$/.test(pathname)
        && origin && corePlayerOriginSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      return;
    }
    if (pathname === '/v1/visual-match' && origin && visualMatchOriginSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      return;
    }
    if (origin && adminOriginSet.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
  }

  function sendOptions(req, res) {
    const origin = req.headers.origin;
    if (!origin || !adminOriginSet.has(origin)) {
      return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_ASSET_ORIGIN_REJECTED' } });
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,accept');
    res.setHeader('Access-Control-Max-Age', '600');
    res.statusCode = 204;
    return res.end();
  }

  function sendVisualMatchOptions(req, res) {
    const origin = req.headers.origin;
    const method = String(req.headers['access-control-request-method'] || '').toUpperCase();
    const requestedHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((item) => item.trim()).filter(Boolean).sort();
    if (!origin || !visualMatchOriginSet.has(origin) || method !== 'POST' || requestedHeaders.join(',') !== VISUAL_MATCH_ALLOWED_HEADERS.split(',').sort().join(',')) {
      return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_MATCH_ORIGIN_REJECTED' } });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', VISUAL_MATCH_ALLOWED_HEADERS);
    res.setHeader('Access-Control-Max-Age', '300');
    res.statusCode = 204;
    return res.end();
  }

  function sendCoreDecisionOptions(req, res) {
    const origin = req.headers.origin;
    const method = String(req.headers['access-control-request-method'] || '').toUpperCase();
    const requestedHeaders = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map((item) => item.trim()).filter(Boolean).sort();
    if (!origin || !corePlayerOriginSet.has(origin) || method !== 'POST' || requestedHeaders.join(',') !== 'content-type') {
      return sendJson(res, 403, { ok: false, error: { code: 'VISUAL_CORE_ORIGIN_REJECTED' } });
    }
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Max-Age', '300');
    res.statusCode = 204;
    return res.end();
  }

  function authorizeAdmin(req) {
    if (!normalizedAdminToken) {
      throw visualError('VISUAL_ASSET_ADMIN_AUTH_UNCONFIGURED', 'admin auth is not configured', 503);
    }
    const origin = req.headers.origin;
    if (origin && !adminOriginSet.has(origin)) {
      throw visualError('VISUAL_ASSET_ORIGIN_REJECTED', 'admin origin is not allowed', 403);
    }
    const header = req.headers.authorization || '';
    const prefix = 'Bearer ';
    if (!header.startsWith(prefix)) {
      throw visualError('VISUAL_ASSET_ADMIN_UNAUTHORIZED', 'admin bearer token required', 401);
    }
    const provided = Buffer.from(header.slice(prefix.length), 'utf8');
    const expected = Buffer.from(normalizedAdminToken, 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw visualError('VISUAL_ASSET_ADMIN_UNAUTHORIZED', 'admin bearer token invalid', 401);
    }
  }

  function authorizeRestoreService(req) {
    if (!normalizedRestoreServiceToken) throw visualError('VISUAL_RESTORE_SERVICE_AUTH_MISSING', 'restore service auth is not configured', 503);
    if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['sec-fetch-dest']) {
      throw visualError('VISUAL_RESTORE_BROWSER_FORBIDDEN', 'restore route is service-to-service only', 403);
    }
    if (req.url && new URL(req.url, 'http://localhost').search) {
      throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'restore token or proof must not be in query string', 400);
    }
    if (req.headers.cookie) throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'restore route must not use cookies', 400);
    if (Object.hasOwn(req.headers, 'x-galgame-visual-restore-proof-json')) {
      throw visualError('VISUAL_RESTORE_FORBIDDEN_TRANSPORT', 'raw restore proof JSON is forbidden', 400);
    }
    const header = req.headers.authorization || '';
    if (!header.startsWith(VISUAL_RESTORE_SERVICE_AUTH_PREFIX)) {
      throw visualError('VISUAL_RESTORE_SERVICE_AUTH_MISSING', 'restore service bearer token required', 401);
    }
    const provided = Buffer.from(header.slice(VISUAL_RESTORE_SERVICE_AUTH_PREFIX.length), 'utf8');
    const expected = Buffer.from(normalizedRestoreServiceToken, 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw visualError('VISUAL_RESTORE_SERVICE_AUTH_INVALID', 'restore service bearer token invalid', 401);
    }
  }

  function authorizeVisualMatchService(req) {
    if (!normalizedVisualMatchServiceToken) {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_UNCONFIGURED', 'visual match service auth is not configured', 503);
    }
    if (visualMatchServiceTokenStatus.invalid) {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_CONFIG_INVALID', 'visual match service auth configuration is invalid', 503);
    }
    if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['sec-fetch-dest']) {
      throw visualError('VISUAL_MATCH_SERVICE_BROWSER_FORBIDDEN', 'internal visual match route is service-to-service only', 403);
    }
    if (req.url && new URL(req.url, 'http://localhost').search) {
      throw visualError('VISUAL_MATCH_FORBIDDEN_TRANSPORT', 'visual match token or proof must not be in query string', 400);
    }
    if (req.headers.cookie) throw visualError('VISUAL_MATCH_FORBIDDEN_TRANSPORT', 'internal visual match route must not use cookies', 400);
    if (Object.hasOwn(req.headers, 'x-galgame-visual-projection-proof-json')) {
      throw visualError('VISUAL_MATCH_PROOF_LOCATION_FORBIDDEN', 'raw proof JSON header is forbidden', 400);
    }
    if (Object.hasOwn(req.headers, VISUAL_RESTORE_PROOF_HEADER) || Object.hasOwn(req.headers, 'x-galgame-visual-asset-proof')) {
      throw visualError('VISUAL_MATCH_FORBIDDEN_TRANSPORT', 'only visual projection proof transport is allowed for visual match', 400);
    }
    const header = req.headers.authorization;
    if (header === undefined || header === '') {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_MISSING', 'visual match service bearer token required', 401);
    }
    if (typeof header !== 'string' || !header.startsWith(VISUAL_MATCH_SERVICE_AUTH_PREFIX)) {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_INVALID', 'visual match service bearer token malformed', 401);
    }
    const providedToken = header.slice(VISUAL_MATCH_SERVICE_AUTH_PREFIX.length);
    if (!VISUAL_MATCH_SERVICE_TOKEN_PATTERN.test(providedToken)) {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_INVALID', 'visual match service bearer token malformed', 401);
    }
    const provided = Buffer.from(providedToken, 'utf8');
    const expected = Buffer.from(normalizedVisualMatchServiceToken, 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw visualError('VISUAL_MATCH_SERVICE_AUTH_REJECTED', 'visual match service bearer token rejected', 401);
    }
  }

  function authorizeVisualAssetInternalRead(req) {
    if (!normalizedVisualAssetInternalReadToken) {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_MISSING', 'visual asset internal read auth is not configured', 503);
    }
    if (visualAssetInternalReadTokenStatus.invalid) {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_CONFIG_INVALID', 'visual asset internal read auth configuration is invalid', 503);
    }
    if (req.headers.origin || req.headers['sec-fetch-site'] || req.headers['sec-fetch-dest']) {
      throw visualError('VISUAL_ASSET_INTERNAL_BROWSER_FORBIDDEN', 'asset internal route is service-to-service only', 403);
    }
    if (req.url && new URL(req.url, 'http://localhost').search) {
      throw visualError('VISUAL_ASSET_INTERNAL_FORBIDDEN_TRANSPORT', 'asset internal token must not be in query string', 400);
    }
    if (req.headers.cookie || req.headers['x-galgame-visual-projection-proof'] || req.headers['x-galgame-visual-restore-proof'] || req.headers['x-galgame-visual-asset-proof']) {
      throw visualError('VISUAL_ASSET_INTERNAL_FORBIDDEN_TRANSPORT', 'asset internal route forbids browser/proof transports', 400);
    }
    const header = req.headers.authorization;
    if (header === undefined || header === '') {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_MISSING', 'asset internal bearer token required', 401);
    }
    if (typeof header !== 'string' || !header.startsWith(VISUAL_ASSET_INTERNAL_READ_AUTH_PREFIX)) {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_INVALID', 'asset internal bearer token malformed', 401);
    }
    const providedToken = header.slice(VISUAL_ASSET_INTERNAL_READ_AUTH_PREFIX.length);
    if (!VISUAL_ASSET_INTERNAL_READ_TOKEN_PATTERN.test(providedToken)) {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_INVALID', 'asset internal bearer token malformed', 401);
    }
    const provided = Buffer.from(providedToken, 'utf8');
    const expected = Buffer.from(normalizedVisualAssetInternalReadToken, 'utf8');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw visualError('VISUAL_ASSET_INTERNAL_AUTH_REJECTED', 'asset internal bearer token rejected', 401);
    }
  }

  async function handleAdminRoute(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/v1/admin/visual/status') {
      return sendJson(res, 200, { ok: true, visual: serializeVisualControl(await getVerifiedVisualControl()) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/visual/enable') {
      const current = await getVerifiedVisualControl();
      const updated = await effectiveVisualControlStore.setControl({
        ...current,
        enabled: true,
        updatedAt: new Date(now()).toISOString(),
      });
      return sendJson(res, 200, { ok: true, visual: serializeVisualControl(updated) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/visual/disable') {
      const current = await getVerifiedVisualControl();
      const updated = await effectiveVisualControlStore.setControl({
        ...current,
        enabled: false,
        updatedAt: new Date(now()).toISOString(),
      });
      return sendJson(res, 200, { ok: true, visual: serializeVisualControl(updated) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/visual/upload') {
      const body = await readJsonBody(req, maxRequestBytes);
      const asset = await uploadSimpleVisualAsset(body);
      return sendJson(res, 200, { ok: true, simpleUpload: serializeSimpleUploadResult(asset), asset: serializeAdminAsset(asset) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/visual/publish') {
      await readOptionalEmptyJsonBody(req);
      return sendJson(res, 200, await publishSimpleVisualCatalog());
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/assets/upload') {
      const body = await readJsonBody(req, maxRequestBytes);
      return sendJson(res, 200, { ok: true, asset: serializeAdminAsset(await uploadAsset(body)) });
    }
    const assetContentMatch = url.pathname.match(/^\/v1\/admin\/assets\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})\/content$/);
    if (req.method === 'GET' && assetContentMatch) {
      const asset = await requireAsset(assetContentMatch[1], Number(assetContentMatch[2]));
      return sendAssetBytes(res, asset);
    }
    const assetMatch = url.pathname.match(/^\/v1\/admin\/assets\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})$/);
    if (req.method === 'GET' && assetMatch) {
      const asset = await requireAsset(assetMatch[1], Number(assetMatch[2]));
      return sendJson(res, 200, { ok: true, asset: serializeAdminAsset(asset) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/admin/catalogs/draft') {
      const body = await readJsonBody(req, maxRequestBytes);
      return sendJson(res, 200, { ok: true, catalog: serializePlayerSafeCatalog(await createCatalogDraft(body)) });
    }
    const catalogMatch = url.pathname.match(/^\/v1\/admin\/catalogs\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})$/);
    if (req.method === 'GET' && catalogMatch) {
      const catalog = await requireCatalog(catalogMatch[1], Number(catalogMatch[2]));
      return sendJson(res, 200, { ok: true, catalog: serializePlayerSafeCatalog(catalog) });
    }
    const lifecycleMatch = url.pathname.match(/^\/v1\/admin\/catalogs\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})\/(validate|publish|archive)$/);
    if (req.method === 'POST' && lifecycleMatch) {
      return sendJson(res, 200, { ok: true, catalog: serializePlayerSafeCatalog(await updateCatalogLifecycle(lifecycleMatch[1], Number(lifecycleMatch[2]), lifecycleMatch[3])) });
    }
    const rollbackMatch = url.pathname.match(/^\/v1\/admin\/catalogs\/([a-z][a-z0-9_-]{2,79})\/rollback$/);
    if (req.method === 'POST' && rollbackMatch) {
      const body = await readJsonBody(req, maxRequestBytes);
      return sendJson(res, 200, { ok: true, catalog: serializePlayerSafeCatalog(await rollbackCatalog(rollbackMatch[1], body)) });
    }
    return sendJson(res, 404, { ok: false, error: { code: 'VISUAL_ASSET_NOT_FOUND' } });
  }

  async function handleCorePublishedRoute(req, res, url) {
    if (url.pathname === '/v1/core/visual-context') {
      return await handleCoreVisualContextRoute(req, res, url);
    }
    if (url.pathname === '/v1/core/visual-decisions') {
      return await handleCoreVisualDecisionsRoute(req, res, url);
    }
    if (req.method !== 'GET') {
      return sendJson(res, 405, { ok: false, error: { code: 'VISUAL_CORE_METHOD_NOT_ALLOWED' } });
    }
    authorizeCorePublishedRead(req, url);
    const contentMatch = url.pathname.match(/^\/v1\/core\/catalogs\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})\/assets\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})\/content$/);
    if (contentMatch) {
      const catalog = await requirePublishedCatalog(contentMatch[1], Number(contentMatch[2]));
      const asset = await requireCatalogPublishedAsset(catalog, contentMatch[3], Number(contentMatch[4]));
      return sendCoreAssetBytes(res, asset);
    }
    const catalogMatch = url.pathname.match(/^\/v1\/core\/catalogs\/([a-z][a-z0-9_-]{2,79})\/([1-9][0-9]{0,5})$/);
    if (catalogMatch) {
      const catalog = await requirePublishedCatalog(catalogMatch[1], Number(catalogMatch[2]));
      return sendJson(res, 200, {
        ok: true,
        schemaVersion: VISUAL_CORE_CATALOG_RESPONSE_VERSION,
        catalog: serializePlayerSafeCatalog(catalog),
      });
    }
    return sendJson(res, 404, { ok: false, error: { code: 'VISUAL_CORE_NOT_FOUND' } });
  }

  async function handleCoreVisualDecisionsRoute(req, res, url) {
    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: { code: 'VISUAL_CORE_METHOD_NOT_ALLOWED' } });
    }
    authorizeCoreDecisionRead(req, url);
    const visualControl = await getVerifiedVisualControl();
    if (!visualControl.enabled) {
      return sendJson(res, 200, {
        ok: false,
        schemaVersion: VISUAL_CORE_DECISION_RESPONSE_VERSION,
        requestId: null,
        error: { code: 'VISUAL_CORE_DISABLED' },
        decisions: [],
      });
    }
    if (!visualControl.activeCatalog) {
      return sendJson(res, 200, {
        ok: false,
        schemaVersion: VISUAL_CORE_DECISION_RESPONSE_VERSION,
        requestId: null,
        error: { code: 'VISUAL_CORE_NO_ACTIVE_CATALOG' },
        decisions: [],
      });
    }
    const catalog = await requirePublishedCatalog(
      visualControl.activeCatalog.catalogId,
      visualControl.activeCatalog.catalogRevision,
    );
    const expectedVisualProfile = createGlobalDisplayVisualProfile(visualControl.activeCatalog);
    const requestText = await readStrictJsonText(req, VISUAL_CORE_DECISION_REQUEST_MAX_BYTES, 'coreVisualDecisionRequest');
    let parsedBody;
    try {
      parsedBody = JSON.parse(requestText.charCodeAt(0) === 0xfeff ? requestText.slice(1) : requestText);
    } catch {
      throw visualError('VISUAL_ASSET_BAD_REQUEST', 'request JSON invalid', 400);
    }
    const runtimeRequest = parsedBody?.schemaVersion === VISUAL_RUNTIME_DECISION_REQUEST_VERSION;
    if (requestText.charCodeAt(0) === 0xfeff && runtimeRequest) {
      return sendJson(res, 400, createRuntimeDecisionErrorResponse(parsedBody.requestId));
    }
    try {
      assertNoDuplicateJsonKeys(requestText, 'coreVisualDecisionRequest');
    } catch (error) {
      if (runtimeRequest) return sendJson(res, 400, createRuntimeDecisionErrorResponse(parsedBody.requestId));
      throw error;
    }
    if (runtimeRequest) {
      try {
        assertSerializedSize(parsedBody, VISUAL_RUNTIME_REQUEST_MAX_BYTES, 'runtimeVisualDecisionRequest');
      } catch {
        return sendJson(res, 400, createRuntimeDecisionErrorResponse(parsedBody.requestId));
      }
    }
    let body;
    try {
      body = requireCoreDecisionRouteRequest(parsedBody);
    } catch (error) {
      if (!runtimeRequest) throw error;
      const code = runtimeDecisionErrorCode(error.code);
      const integrityCodes = new Set(['VISUAL_CONTEXT_INVALID', 'VISUAL_SOURCE_HASH_MISMATCH', 'VISUAL_PROJECTION_HASH_MISMATCH', 'VISUAL_PROFILE_INVALID', 'VISUAL_CATALOG_INVALID']);
      const isIntegrityFailure = integrityCodes.has(error.code)
        || ['VISUAL_CORE_PROJECTION_STALE', 'VISUAL_CORE_SOURCE_STALE', 'VISUAL_CORE_CATALOG_NOT_PUBLISHED', 'VISUAL_CORE_CATALOG_SCOPE_MISMATCH'].includes(error.code);
      if (isIntegrityFailure) {
        return sendJson(res, 400, {
          schemaVersion: VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
          ok: false,
          requestId: typeof parsedBody.requestId === 'string' && CANDIDATE_REQUEST_ID_PATTERN.test(parsedBody.requestId) ? parsedBody.requestId : null,
          projectionId: parsedBody.projection?.projectionId || null,
          projectionHash: parsedBody.projection?.projectionHash || null,
          sourceMessageIndex: parsedBody.projection?.sourceMessageIndex ?? null,
          sourceMessageHash: parsedBody.projection?.sourceMessageHash || null,
          catalogId: catalog.catalogId,
          catalogRevision: catalog.catalogRevision,
          catalogHash: catalog.catalogHash,
          matcherVersion: VISUAL_MATCHER_VERSION,
          scorerVersion: VISUAL_SCORER_VERSION,
          usesLlm: false,
          understandingStatus: 'ambiguous',
          errorCode: code,
          decisions: [],
        });
      }
      return sendJson(res, 400, createRuntimeDecisionErrorResponse(parsedBody.requestId));
    }
    if (!coreVisualProfileMatches(expectedVisualProfile, body.visualProfile)) {
      if (runtimeRequest) {
        return sendJson(res, 400, {
          schemaVersion: VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
          ok: false,
          requestId: body.requestId,
          projectionId: body.projection.projectionId,
          projectionHash: body.projection.projectionHash,
          sourceMessageIndex: body.projection.sourceMessageIndex,
          sourceMessageHash: body.projection.sourceMessageHash,
          catalogId: catalog.catalogId,
          catalogRevision: catalog.catalogRevision,
          catalogHash: catalog.catalogHash,
          matcherVersion: VISUAL_MATCHER_VERSION,
          scorerVersion: VISUAL_SCORER_VERSION,
          usesLlm: false,
          understandingStatus: 'ambiguous',
          errorCode: 'VISUAL_CATALOG_INVALID',
          decisions: [],
        });
      }
      throw visualError('VISUAL_CORE_PROFILE_MISMATCH', 'visual profile does not match the active global display profile', 400);
    }
    const assets = [];
    for (const ref of catalog.assetRefs) {
      assets.push(await requireCatalogPublishedAsset(catalog, ref.assetId, ref.assetVersion));
    }
    const runtimeResult = runtimeRequest
      ? await resolveRuntimeHints(body.visibleContext, catalog.catalogHash)
      : null;
    const plan = createCoreVisualCandidateDecisionPlan({
      schemaVersion: VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION,
      requestId: body.requestId,
      projection: body.projection,
      visualProfile: body.visualProfile,
      catalog,
      assets,
      expectedProjectionHash: body.expectedProjectionHash,
      expectedSourceMessageHash: body.expectedSourceMessageHash,
      createdAt: body.createdAt,
    }, {
      runtimeMode: Boolean(runtimeRequest),
      runtimeHint: runtimeResult?.hint?.status === 'ready' ? runtimeResult.hint : runtimeResult?.hint || null,
      visibleContext: body.visibleContext,
    });
    if (runtimeRequest) {
      return sendJson(res, 200, {
        schemaVersion: VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
        ok: plan.ok,
        requestId: body.requestId,
        projectionId: body.projection.projectionId,
        projectionHash: body.projection.projectionHash,
        sourceMessageIndex: body.projection.sourceMessageIndex,
        sourceMessageHash: body.projection.sourceMessageHash,
        catalogId: catalog.catalogId,
        catalogRevision: catalog.catalogRevision,
        catalogHash: catalog.catalogHash,
        matcherVersion: plan.matcherVersion || VISUAL_MATCHER_VERSION,
        scorerVersion: plan.scorerVersion || VISUAL_SCORER_VERSION,
        usesLlm: Boolean(runtimeResult?.attempted),
        understandingStatus: runtimeUnderstandingStatus(runtimeResult),
        errorCode: runtimeResult?.errorCode || runtimeDecisionErrorCode(plan.ok ? null : plan.code),
        decisions: plan.ok ? plan.decisions.map((decision) => ({
          ...decision,
          contentPath: createCoreContentPath(plan.catalogId, plan.catalogRevision, decision.assetId, decision.assetVersion),
        })) : [],
      });
    }
    if (!plan.ok) {
      return sendJson(res, 200, {
        ok: false,
        schemaVersion: VISUAL_CORE_DECISION_RESPONSE_VERSION,
        requestId: body.requestId,
        error: { code: plan.code },
        decisions: [],
      });
    }
    return sendJson(res, 200, {
      ok: true,
      schemaVersion: VISUAL_CORE_DECISION_RESPONSE_VERSION,
      requestId: body.requestId,
      projectionId: plan.projectionId,
      projectionHash: plan.projectionHash,
      sourceMessageIndex: plan.sourceMessageIndex,
      sourceMessageHash: plan.sourceMessageHash,
      catalogId: plan.catalogId,
      catalogRevision: plan.catalogRevision,
      catalogHash: plan.catalogHash,
      matcherVersion: plan.matcherVersion,
      scorerVersion: plan.scorerVersion,
      usesLlm: false,
      decisions: plan.decisions.map((decision) => ({
        ...decision,
        contentPath: createCoreContentPath(plan.catalogId, plan.catalogRevision, decision.assetId, decision.assetVersion),
      })),
    });
  }

  async function handleCoreVisualContextRoute(req, res, url) {
    if (req.method !== 'GET') {
      throw visualError('VISUAL_CORE_CONTEXT_METHOD_NOT_ALLOWED', 'visual context only supports GET', 405);
    }
    authorizeCoreVisualContextRead(req, url);
    const control = await getVerifiedVisualControl();
    const enabled = Boolean(control.enabled && control.activeCatalog);
    const activeCatalog = enabled ? structuredClone(control.activeCatalog) : null;
    let visualProfile = null;
    if (activeCatalog) {
      const catalog = await requirePublishedCatalog(activeCatalog.catalogId, activeCatalog.catalogRevision);
      if (catalog.catalogHash !== activeCatalog.catalogHash) {
        throw visualError('VISUAL_CORE_CONTEXT_INVALID', 'active catalog hash does not match the published catalog', 500);
      }
      visualProfile = createGlobalDisplayVisualProfile(activeCatalog);
    }
    const response = {
      ok: true,
      schemaVersion: VISUAL_CORE_CONTEXT_RESPONSE_VERSION,
      enabled,
      activeCatalog,
      visualProfile,
      source: 'visual-control',
      sourceVersion: VISUAL_CONTROL_SCHEMA_VERSION,
    };
    response.contextHash = sha256Json({
      schemaVersion: response.schemaVersion,
      enabled: response.enabled,
      activeCatalog: response.activeCatalog,
      visualProfile: response.visualProfile,
      source: response.source,
      sourceVersion: response.sourceVersion,
    });
    return sendCoreVisualContextJson(res, 200, response);
  }

  async function getVerifiedVisualControl() {
    const control = await effectiveVisualControlStore.getControl();
    validateVisualControl(control);
    if (!control.activeCatalog) return control;
    const catalog = await assetStore.getCatalog?.(control.activeCatalog.catalogId, control.activeCatalog.catalogRevision);
    if (!catalog || catalog.status !== 'published' || catalog.catalogHash !== control.activeCatalog.catalogHash) {
      throw visualError('VISUAL_CONTROL_ACTIVE_CATALOG_INVALID', 'visual control active catalog is not a published exact catalog', 500);
    }
    const active = await assetStore.getActiveCatalog?.(control.activeCatalog.catalogId);
    if (!active || active.catalogRevision !== control.activeCatalog.catalogRevision || active.catalogHash !== control.activeCatalog.catalogHash) {
      throw visualError('VISUAL_CONTROL_ACTIVE_CATALOG_INVALID', 'visual control active catalog pointer is stale', 500);
    }
    return control;
  }

  async function handleVisualMatchRoute(req, res) {
    const origin = req.headers.origin;
    if (!origin || !visualMatchOriginSet.has(origin)) throw visualError('VISUAL_MATCH_ORIGIN_REJECTED', 'visual match origin is not allowed', 403);
    if (req.headers.authorization || req.headers.cookie) throw visualError('VISUAL_MATCH_FORBIDDEN_TRANSPORT', 'visual match must not use bearer auth or cookies', 400);
    const response = await executeVisualMatchRequest(req);
    return sendJson(res, 200, response);
  }

  async function handleInternalVisualMatchRoute(req, res) {
    authorizeVisualMatchService(req);
    const response = await executeVisualMatchRequest(req);
    return sendJson(res, 200, response);
  }

  async function handleInternalAssetMetadataResolveRoute(req, res) {
    try {
      authorizeVisualAssetInternalRead(req);
      const body = requireInternalAssetMetadataResolveRequest(await readStrictJsonBody(req, VISUAL_ASSET_INTERNAL_REQUEST_MAX_BYTES, 'visualAssetMetadataResolveRequest'));
      const verified = await resolveInternalAssetIdentity(body, { requireMetadataHash: false });
      return sendJson(res, 200, {
        ok: true,
        schemaVersion: VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_RESPONSE_VERSION,
        requestId: body.requestId,
        assetType: verified.asset.assetType,
        assetId: verified.asset.assetId,
        assetVersion: verified.asset.assetVersion,
        assetContentSha256: verified.asset.assetContentSha256,
        assetMetadataHash: verified.asset.assetMetadataHash,
        catalogRefHash: verified.catalogRefHash,
        catalogId: verified.catalog.catalogId,
        catalogRevision: verified.catalog.catalogRevision,
        catalogHash: verified.catalog.catalogHash,
        canonicalMime: verified.asset.canonicalMime,
      });
    } catch (error) {
      return sendInternalAssetJsonError(res, error.status || 500, error.code || 'VISUAL_ASSET_INTERNAL_ERROR');
    }
  }

  async function handleInternalAssetContentReadRoute(req, res) {
    try {
      authorizeVisualAssetInternalRead(req);
      const body = requireInternalAssetContentReadRequest(await readStrictJsonBody(req, VISUAL_ASSET_INTERNAL_REQUEST_MAX_BYTES, 'visualAssetContentReadRequest'));
      const verified = await resolveInternalAssetIdentity(body, { requireMetadataHash: true });
      const content = await contentStore.get(verified.asset.assetContentSha256);
      if (!content) throw visualError('VISUAL_ASSET_CONTENT_NOT_FOUND', 'content not found', 404);
      if (content.mime !== verified.asset.canonicalMime) throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content mime mismatch', 409);
      const servedHash = sha256Hex(content.bytes);
      if (`sha256:${servedHash}` !== verified.asset.assetContentSha256) throw visualError('VISUAL_ASSET_CONTENT_HASH_MISMATCH', 'content hash mismatch', 409);
      res.setHeader('Content-Type', verified.asset.canonicalMime);
      res.setHeader('Content-Length', String(content.bytes.length));
      res.setHeader('X-Galgame-Asset-Content-Sha256', servedHash);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = 200;
      return res.end(content.bytes);
    } catch (error) {
      return sendInternalAssetJsonError(res, error.status || 500, error.code || 'VISUAL_ASSET_INTERNAL_ERROR');
    }
  }

  async function executeVisualMatchRequest(req) {
    if (!bindingStore) throw visualError('VISUAL_MATCH_BINDING_STORE_UNCONFIGURED', 'binding store is not configured', 503);
    const body = requireVisualMatchRequest(await readStrictJsonBody(req, VISUAL_MATCH_REQUEST_MAX_BYTES, 'visualMatchRequest'));
    const proof = verifyVisualProjectionProofHeader(req, {
      projectionSecret: normalizedProjectionSecret,
      expectedProjectionId: body.projectionId,
      now,
    });
    const stub = await readProjectionStub(body.projectionId);
    assertStubMatchesProof(stub, proof);
    if (proof.entityKey && proof.entityKey !== body.entityKey) throw visualError('VISUAL_MATCH_PROOF_SCOPE_MISMATCH', 'proof entity mismatch', 403);
    const entity = stub.entities.find((item) => item.entityKey === body.entityKey && item.entityType === body.entityType);
    if (!entity) throw visualError('VISUAL_MATCH_ENTITY_NOT_IN_PROJECTION', 'entity is not present in projection stub', 409);
    const catalog = await requireCatalog(proof.catalogId, proof.catalogRevision);
    if (catalog.status !== 'published') throw visualError('VISUAL_MATCH_CATALOG_NOT_PUBLISHED', 'catalog is not published', 409);
    if (catalog.catalogHash !== proof.catalogHash) throw visualError('VISUAL_MATCH_CATALOG_SCOPE_MISMATCH', 'catalog hash mismatch', 409);
    const activeCatalog = await assetStore.getActiveCatalog?.(catalog.catalogId);
    if (!activeCatalog || activeCatalog.catalogRevision !== catalog.catalogRevision || activeCatalog.catalogHash !== catalog.catalogHash) {
      throw visualError('VISUAL_MATCH_CATALOG_SCOPE_MISMATCH', 'catalog is not the active published catalog', 409);
    }
    const input = await createCandidateDecisionInputForMatch({ request: body, proof, stub, entity, catalog });
    const unknownCompatibilityReport = createUnknownCompatibilityReport({ catalog });
    const decisionResult = createVisualCandidateDecision(input, {
      unknownCompatibilityReport,
      expiresAt: proof.expiresAt,
      maxTtlMs: Math.max(1, Date.parse(proof.expiresAt) - Date.parse(proof.issuedAt)),
    });
    if (!decisionResult.ok) {
      throw visualError(decisionResult.code || 'VISUAL_MATCH_DECISION_FAILED', 'visual candidate decision failed', 409);
    }
    const artifacts = createBindingArtifacts({ request: body, proof, input, decision: decisionResult.decision, unknownCompatibilityReport });
    const replayReservation = effectiveProofReplayStore.prepare(artifacts.proofReplayKey, proof, body.entityKey, artifacts.record.publicResultHash);
    try {
      const saved = await bindingStore.saveOrReuse(artifacts);
      replayReservation.commit();
      return { ok: true, result: saved.publicResult };
    } catch (error) {
      replayReservation.release();
      throw error;
    }
  }

  async function handleVisualRestoreBindingRoute(req, res, pathname) {
    const kind = pathname.endsWith('/old-save') ? 'old-save' : 'rollback';
    authorizeRestoreService(req);
    if (!bindingStore) throw visualError('VISUAL_RESTORE_BINDING_STORE_UNCONFIGURED', 'binding store is not configured', 503);
    const body = requireVisualRestoreBindingRequest(await readStrictJsonBody(req, VISUAL_RESTORE_REQUEST_MAX_BYTES, 'visualRestoreBindingRequest'));
    const proof = verifyVisualRestoreProofHeader(req, {
      proofSecret: normalizedRestoreProofSecret,
      acceptedKeyIds: restoreProofKeyIdSet,
      expectedKind: kind,
      now,
    });
    const restored = await restoreBindingFromProof({ kind, proof, body, route: pathname });
    return sendJson(res, 200, { ok: true, binding: restored.publicBinding });
  }

  async function restoreBindingFromProof({ kind, proof, body, route }) {
    const bundle = bindingStore.getRestoreBundle?.(body.bindingId);
    if (!bundle) throw visualError('VISUAL_RESTORE_BINDING_NOT_FOUND', 'retained binding not found', 404);
    const verified = verifyRestoreBindingBundle({ kind, proof, body, bundle });
    const replayValue = {
      restoreReplayKey: verified.restoreReplayKey,
      requestBodyHash: sha256Json(body),
      proofTokenHash: sha256Digest(proof.token),
      publicBindingHash: sha256Json(verified.publicBinding),
      receiptHash: verified.receipt.receiptHash,
      retentionHash: verified.retention.retentionHash,
      routeKind: route,
      expiresAtMs: Date.parse(proof.payload.expiresAt),
    };
    const reservation = await effectiveRestoreReplayStore.prepare(verified.restoreReplayKey, replayValue);
    try {
      await reservation.commit();
      return verified;
    } catch (error) {
      await reservation.release();
      throw error;
    }
  }

  async function readProjectionStub(projectionId) {
    if (projectionStubReader) {
      const stub = await projectionStubReader(projectionId);
      return stub;
    }
    if (!normalizedStubBaseUrl || !normalizedStubToken) throw visualError('VISUAL_MATCH_STUB_READER_UNCONFIGURED', 'projection stub reader is not configured', 503);
    let base;
    try {
      base = new URL(normalizedStubBaseUrl);
    } catch {
      throw visualError('VISUAL_MATCH_STUB_URL_INVALID', 'projection stub base URL invalid', 503);
    }
    const url = new URL(`/v1/visual/projection-stubs/${encodeURIComponent(projectionId)}`, base.origin);
    if (url.origin !== base.origin) throw visualError('VISUAL_MATCH_STUB_URL_INVALID', 'projection stub URL origin mismatch', 503);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), normalizedStubTimeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${normalizedStubToken}`, accept: 'application/json' },
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw visualError('VISUAL_MATCH_STUB_TIMEOUT', 'projection stub request timed out', 504);
      throw visualError('VISUAL_MATCH_STUB_FETCH_FAILED', 'projection stub fetch failed', 502);
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) throw visualError('VISUAL_MATCH_STUB_REDIRECT_REJECTED', 'projection stub redirect rejected', 502);
    if (!response.ok) throw visualError('VISUAL_MATCH_STUB_FETCH_FAILED', 'projection stub reader rejected', 502);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > normalizedStubMaxBytes) throw visualError('VISUAL_MATCH_STUB_RESPONSE_OVERSIZE', 'projection stub response too large', 502);
    let stub;
    try {
      const text = bytes.toString('utf8');
      assertNoDuplicateJsonKeys(text, 'projectionStub');
      stub = JSON.parse(text);
    } catch {
      throw visualError('VISUAL_MATCH_STUB_RESPONSE_INVALID', 'projection stub JSON invalid', 502);
    }
    return stub;
  }

  async function createCandidateDecisionInputForMatch({ request, proof, stub, entity, catalog }) {
    const catalogAssetRefs = [...catalog.assetRefs, ...catalog.unknownAssetRefs].map((ref) => ({
      assetId: ref.assetId,
      assetVersion: ref.assetVersion,
      assetType: ref.assetType,
      assetContentSha256: ref.assetContentSha256,
      assetMetadataHash: ref.assetMetadataHash,
      catalogRefHash: sha256Json(ref),
    }));
    const candidates = [];
    for (const ref of catalog.assetRefs) {
      if (ref.assetType !== request.entityType) continue;
      const asset = await requireAsset(ref.assetId, ref.assetVersion);
      if (asset.status !== 'published') throw visualError('VISUAL_MATCH_CANDIDATE_INVALID', 'candidate asset is not published', 409);
      candidates.push(createVisualCandidateAssetInputFromAsset(asset));
    }
    return {
      schemaVersion: CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
      requestId: request.requestId,
      projectionId: proof.projectionId,
      entityKey: request.entityKey,
      entityType: request.entityType,
      confidenceBand: entity.confidenceBand,
      visibleAttributeCodes: entity.visibleAttributes.map((attribute) => attribute.code),
      sourceMessageIndex: proof.sourceMessageIndex,
      sourceMessageHash: proof.sourceMessageHash,
      evidenceDigest: proof.projectionHash,
      releaseId: proof.releaseId,
      scenarioId: proof.scenarioId,
      scenarioVersion: proof.scenarioVersion,
      arcId: proof.arcId,
      chatId: proof.chatId,
      visualProfileId: proof.profileId,
      profileHash: proof.profileHash,
      profileCatalogId: proof.catalogId,
      profileCatalogRevision: proof.catalogRevision,
      profileCatalogHash: proof.catalogHash,
      catalogId: proof.catalogId,
      catalogRevision: proof.catalogRevision,
      catalogHash: proof.catalogHash,
      catalogAssetRefs,
      dictionaryVersion: String(DICTIONARY_VERSION),
      dictionaryHash: DICTIONARY_HASH,
      candidates,
      matcherVersion: VISUAL_MATCHER_VERSION,
      scorerVersion: VISUAL_SCORER_VERSION,
      createdAt: nowIso(now),
    };
  }

  async function uploadAsset(body) {
    requireExactKeys(body, ['schemaVersion', 'metadata', 'imageBase64'], 'upload');
    if (body.schemaVersion !== UPLOAD_SCHEMA_VERSION) throw visualError('VISUAL_ASSET_INVALID_SCHEMA', 'upload schema invalid', 400);
    validateUploadMetadata(body.metadata);
    const inputBytes = decodeUploadBodyBase64(body.imageBase64);
    const decoded = imageDecoder.decodeAndReencode({ bytes: inputBytes, metadata: body.metadata });
    validateDecodedImage(decoded, body.metadata);
    const content = await contentStore.put(decoded.outputBytes, decoded.canonicalMime);
    const analysis = await analyzeVisualAsset({
      bytes: decoded.outputBytes,
      assetType: body.metadata.assetType,
      contentHash: content.hash,
    });
    const createdAt = nowIso(now);
    const asset = {
      schemaVersion: ASSET_SCHEMA_VERSION,
      assetId: body.metadata.assetId,
      assetVersion: body.metadata.assetVersion,
      assetType: body.metadata.assetType,
      role: body.metadata.role,
      title: body.metadata.title,
      tagCodes: body.metadata.tagCodes,
      featureCodes: body.metadata.featureCodes,
      licenseCode: body.metadata.licenseCode,
      sourceLabel: body.metadata.sourceLabel,
      canonicalMime: decoded.canonicalMime,
      width: decoded.width,
      height: decoded.height,
      hasAlpha: decoded.hasAlpha,
      transparentPixel: decoded.transparentPixel,
      assetContentSha256: content.hash,
      contentUri: `/v1/admin/assets/${body.metadata.assetId}/${body.metadata.assetVersion}/content`,
      thumbnailUri: `/v1/admin/assets/${body.metadata.assetId}/${body.metadata.assetVersion}/content`,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      analysisStatus: analysis.status,
      analysis,
      status: 'draft',
      createdAt,
      updatedAt: createdAt,
    };
    asset.assetMetadataHash = computeAssetMetadataHash(asset);
    validateAsset(asset);
    return assetStore.saveAsset(asset, { allowExactReplay: true });
  }

  async function uploadSimpleVisualAsset(body) {
    assertSimpleUploadRequest(body);
    const assetId = await generateSimpleAssetId(body.assetType);
    const metadata = {
      assetId,
      assetVersion: 1,
      assetType: body.assetType,
      role: ROLE_BY_TYPE[body.assetType],
      title: body.title,
      tagCodes: body.tagCodes ?? [],
      featureCodes: body.featureCodes ?? defaultSimpleFeatureCodes(body.assetType),
      licenseCode: 'user-owned',
      sourceLabel: createSimpleUploadSourceLabel(body),
    };
    return uploadAsset({
      schemaVersion: UPLOAD_SCHEMA_VERSION,
      metadata,
      imageBase64: body.imageBase64,
    });
  }

  async function readOptionalEmptyJsonBody(req) {
    const hasBody = req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0;
    if (!hasBody) return {};
    const body = await readJsonBody(req, maxRequestBytes);
    requireExactKeys(body, [], 'simplePublish');
    return body;
  }

  async function generateSimpleAssetId(assetType) {
    if (!ENTITY_TYPE_SET.has(assetType)) throw visualError('VISUAL_SIMPLE_UPLOAD_INVALID_TYPE', 'assetType is invalid', 400);
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const assetId = `asset_${assetType}_${randomBytes(6).toString('hex')}`;
      if (!await assetStore.getAsset(assetId, 1)) return assetId;
    }
    throw visualError('VISUAL_SIMPLE_UPLOAD_ID_EXHAUSTED', 'could not allocate asset id', 500);
  }

  function serializeSimpleUploadResult(asset) {
    validateAsset(asset);
    return {
      schemaVersion: SIMPLE_UPLOAD_RESPONSE_SCHEMA_VERSION,
      assetId: asset.assetId,
      assetVersion: asset.assetVersion,
      assetType: asset.assetType,
      role: asset.role,
      status: asset.status,
      title: asset.title,
      canonicalMime: asset.canonicalMime,
      width: asset.width,
      height: asset.height,
      hasAlpha: asset.hasAlpha,
      transparentPixel: asset.transparentPixel,
      assetContentSha256: asset.assetContentSha256,
      assetMetadataHash: asset.assetMetadataHash,
    };
  }

  async function publishSimpleVisualCatalog() {
    const currentControl = await getVerifiedVisualControl();
    const assets = await assetStore.listAssets?.();
    if (!Array.isArray(assets)) throw visualError('VISUAL_SIMPLE_PUBLISH_STORE_UNSUPPORTED', 'asset store cannot list assets', 500);
    const publishableAssets = [];
    const seenAssetKeys = new Set();
    for (const asset of assets) {
      if (asset?.assetId?.startsWith('unknown_') || asset?.status === 'archived') continue;
      validateAsset(asset);
      if (!['draft', 'published'].includes(asset.status)) {
        throw visualError('VISUAL_SIMPLE_PUBLISH_ASSET_STATUS_INVALID', 'asset status is not publishable', 409);
      }
      const key = assetStore.key(asset.assetId, asset.assetVersion);
      if (seenAssetKeys.has(key)) {
        throw visualError('VISUAL_SIMPLE_PUBLISH_DUPLICATE_ASSET', 'duplicate publishable asset identity', 409);
      }
      seenAssetKeys.add(key);
      publishableAssets.push(asset);
    }
    publishableAssets.sort((left, right) => left.assetId.localeCompare(right.assetId) || left.assetVersion - right.assetVersion);
    const draftAssets = publishableAssets.filter((asset) => asset.status === 'draft');
    const existingPublishedAssets = publishableAssets.filter((asset) => asset.status === 'published');
    if (draftAssets.length === 0) {
      if (currentControl.activeCatalog) {
        return {
          ok: true,
          schemaVersion: SIMPLE_PUBLISH_RESPONSE_SCHEMA_VERSION,
          published: false,
          idempotent: true,
          catalog: serializePlayerSafeCatalog(await requirePublishedCatalog(currentControl.activeCatalog.catalogId, currentControl.activeCatalog.catalogRevision)),
          visual: serializeVisualControl(currentControl),
        };
      }
      throw visualError('VISUAL_SIMPLE_PUBLISH_NO_DRAFT_ASSETS', 'no draft visual assets to publish', 409);
    }

    const updatedAt = nowIso(now);
    const previousAssets = new Map();
    const promotedAssets = [];
    for (const asset of draftAssets) {
      validateAsset(asset);
      await validateAssetContentAvailable(asset);
      const promoted = { ...asset, status: 'published', updatedAt };
      promoted.assetMetadataHash = computeAssetMetadataHash(promoted);
      validateAsset(promoted);
      previousAssets.set(assetStore.key(asset.assetId, asset.assetVersion), structuredClone(asset));
      promotedAssets.push(promoted);
    }
    for (const asset of existingPublishedAssets) {
      validateAsset(asset);
      await validateAssetContentAvailable(asset);
    }

    const catalogId = await generateSimpleCatalogId();
    const catalogAssets = [...existingPublishedAssets, ...promotedAssets]
      .sort((left, right) => left.assetId.localeCompare(right.assetId) || left.assetVersion - right.assetVersion);
    const catalog = createSimplePublishedCatalog({ catalogId, catalogRevision: 1, assets: catalogAssets, createdAt: updatedAt });
    const savedPromoted = [];
    try {
      for (const promoted of promotedAssets) {
        const previous = previousAssets.get(assetStore.key(promoted.assetId, promoted.assetVersion));
        savedPromoted.push({ promoted, previous });
        await assetStore.replaceAsset(promoted, previous.assetMetadataHash);
      }
      await assetStore.saveCatalog(catalog, { allowExactReplay: false });
      await assetStore.setActiveCatalog(catalog);
      const visual = await effectiveVisualControlStore.setControl({
        schemaVersion: VISUAL_CONTROL_SCHEMA_VERSION,
        enabled: true,
        activeCatalog: {
          catalogId: catalog.catalogId,
          catalogRevision: catalog.catalogRevision,
          catalogHash: catalog.catalogHash,
        },
        updatedAt,
      });
      return {
        ok: true,
        schemaVersion: SIMPLE_PUBLISH_RESPONSE_SCHEMA_VERSION,
        published: true,
        idempotent: false,
        catalog: serializePlayerSafeCatalog(catalog),
        visual: serializeVisualControl(visual),
      };
    } catch (error) {
      await rollbackSimplePublish({
        catalog,
        savedPromoted,
        currentControl,
      });
      throw error;
    }
  }

  async function rollbackSimplePublish({ catalog, savedPromoted, currentControl }) {
    const rollbackErrors = [];
    try {
      await assetStore.deleteActiveCatalog?.(catalog.catalogId);
    } catch (error) {
      rollbackErrors.push(error);
    }
    try {
      await assetStore.deleteCatalog?.(catalog.catalogId, catalog.catalogRevision);
    } catch (error) {
      rollbackErrors.push(error);
    }
    for (const { promoted, previous } of savedPromoted.reverse()) {
      try {
        await assetStore.replaceAsset(previous, promoted.assetMetadataHash);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    try {
      await effectiveVisualControlStore.setControl(currentControl);
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length > 0) {
      throw visualError('VISUAL_SIMPLE_PUBLISH_ROLLBACK_FAILED', 'simple publish rollback failed', 500);
    }
  }

  async function validateAssetContentAvailable(asset) {
    const content = await contentStore.get(asset.assetContentSha256);
    if (!content) throw visualError('VISUAL_SIMPLE_PUBLISH_CONTENT_MISSING', 'draft asset content missing', 409);
    if (content.mime !== asset.canonicalMime) throw visualError('VISUAL_SIMPLE_PUBLISH_CONTENT_MISMATCH', 'draft asset content mime mismatch', 409);
    if (`sha256:${sha256Hex(content.bytes)}` !== asset.assetContentSha256) throw visualError('VISUAL_SIMPLE_PUBLISH_CONTENT_MISMATCH', 'draft asset content hash mismatch', 409);
  }

  async function generateSimpleCatalogId() {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const catalogId = `catalog_simple_${randomBytes(6).toString('hex')}`;
      if (!await assetStore.getCatalog(catalogId, 1)) return catalogId;
    }
    throw visualError('VISUAL_SIMPLE_PUBLISH_ID_EXHAUSTED', 'could not allocate catalog id', 500);
  }

  function createSimplePublishedCatalog({ catalogId, catalogRevision, assets, createdAt }) {
    const catalog = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId,
      catalogRevision,
      status: 'published',
      assetRefs: assets.map((asset) => assetToRef(asset)),
      unknownAssetRefs: ENTITY_TYPES.map((type) => assetToRef(BUILTIN_UNKNOWN_ASSETS[type])),
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      createdAt,
      updatedAt: createdAt,
      publishedAt: createdAt,
      archivedAt: null,
    };
    catalog.catalogHash = computeCatalogHash(catalog);
    validateCatalog(catalog);
    return catalog;
  }

  async function requireAsset(assetId, assetVersion) {
    const asset = await assetStore.getAsset(assetId, assetVersion);
    if (!asset) throw visualError('VISUAL_ASSET_NOT_FOUND', 'asset not found', 404);
    validateAsset(asset);
    return asset;
  }

  async function requireCatalog(catalogId, catalogRevision) {
    const catalog = await assetStore.getCatalog(catalogId, catalogRevision);
    if (!catalog) throw visualError('VISUAL_CATALOG_NOT_FOUND', 'catalog not found', 404);
    validateCatalog(catalog);
    return catalog;
  }

  async function sendAssetBytes(res, asset) {
    const content = await contentStore.get(asset.assetContentSha256);
    if (!content) throw visualError('VISUAL_ASSET_CONTENT_NOT_FOUND', 'content not found', 404);
    if (content.mime !== asset.canonicalMime) throw visualError('VISUAL_ASSET_CONTENT_METADATA_INVALID', 'content mime mismatch', 409);
    if (`sha256:${sha256Hex(content.bytes)}` !== asset.assetContentSha256) throw visualError('VISUAL_ASSET_CONTENT_HASH_MISMATCH', 'content hash mismatch', 409);
    res.setHeader('Content-Type', asset.canonicalMime);
    res.setHeader('Content-Length', String(content.bytes.length));
    res.statusCode = 200;
    return res.end(content.bytes);
  }

  function authorizeCorePublishedRead(req, url) {
    if (url.search) {
      throw visualError('VISUAL_CORE_FORBIDDEN_TRANSPORT', 'core published read does not accept query parameters', 400);
    }
    if (req.headers.authorization || req.headers.cookie || req.headers['x-galgame-visual-projection-proof'] || req.headers['x-galgame-visual-restore-proof'] || req.headers['x-galgame-visual-asset-proof']) {
      throw visualError('VISUAL_CORE_FORBIDDEN_TRANSPORT', 'core published read must not use tokens, cookies or visual proofs', 400);
    }
  }

  function authorizeCoreDecisionRead(req, url) {
    authorizeCorePublishedRead(req, url);
    const origin = req.headers.origin;
    if (origin && !corePlayerOriginSet.has(origin)) {
      throw visualError('VISUAL_CORE_ORIGIN_REJECTED', 'core visual decision origin is not allowed', 403);
    }
  }

  function authorizeCoreVisualContextRead(req, url) {
    if (url.search) {
      throw visualError('VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT', 'visual context does not accept query parameters', 400);
    }
    const origin = req.headers.origin;
    if (!origin || !corePlayerOriginSet.has(origin)) {
      throw visualError('VISUAL_CORE_CONTEXT_ORIGIN_REJECTED', 'visual context origin is not allowed', 403);
    }
    for (const [name, value] of Object.entries(req.headers)) {
      if (name === 'origin' || VISUAL_CORE_CONTEXT_BROWSER_HEADERS.has(name)) continue;
      if (name === 'accept' && String(value).trim() === 'application/json') continue;
      if (name === 'content-length' && String(value) === '0') continue;
      if (name.startsWith('sec-fetch-') || name.startsWith('sec-ch-')) continue;
      throw visualError('VISUAL_CORE_CONTEXT_FORBIDDEN_TRANSPORT', 'visual context received an unmanaged header', 400);
    }
  }

  async function requirePublishedCatalog(catalogId, catalogRevision) {
    const catalog = await requireCatalog(catalogId, catalogRevision);
    if (catalog.status !== 'published') {
      throw visualError('VISUAL_CORE_CATALOG_NOT_PUBLISHED', 'core read requires a published catalog', 409);
    }
    await validateCatalogRefs(catalog);
    return catalog;
  }

  async function requireCatalogPublishedAsset(catalog, assetId, assetVersion) {
    const ref = [...catalog.assetRefs, ...catalog.unknownAssetRefs].find((item) => (
      item.assetId === assetId && item.assetVersion === assetVersion
    ));
    if (!ref) throw visualError('VISUAL_CORE_CATALOG_REF_MISSING', 'asset is not in the published catalog', 404);
    const asset = await requireAsset(assetId, assetVersion);
    if (asset.status !== 'published') throw visualError('VISUAL_CORE_ASSET_NOT_PUBLISHED', 'asset is not published', 409);
    if (canonicalJson(ref) !== canonicalJson(assetToRef(asset))) {
      throw visualError('VISUAL_CORE_CATALOG_REF_MISMATCH', 'published catalog ref does not match asset', 409);
    }
    return asset;
  }

  async function sendCoreAssetBytes(res, asset) {
    const content = await contentStore.get(asset.assetContentSha256);
    if (!content) throw visualError('VISUAL_CORE_CONTENT_NOT_FOUND', 'content not found', 404);
    if (content.mime !== asset.canonicalMime) throw visualError('VISUAL_CORE_CONTENT_METADATA_INVALID', 'content mime mismatch', 409);
    const servedHash = sha256Hex(content.bytes);
    if (`sha256:${servedHash}` !== asset.assetContentSha256) throw visualError('VISUAL_CORE_CONTENT_HASH_MISMATCH', 'content hash mismatch', 409);
    res.setHeader('Content-Type', asset.canonicalMime);
    res.setHeader('Content-Length', String(content.bytes.length));
    res.setHeader('X-Galgame-Asset-Content-Sha256', servedHash);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Published player assets are immutable public bytes; allow image loaders
    // from the player page even when the browser omits Origin on image fetches.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.statusCode = 200;
    return res.end(content.bytes);
  }

  async function resolveInternalAssetIdentity(body, { requireMetadataHash }) {
    const catalog = await requireCatalog(body.catalogId, body.catalogRevision);
    if (catalog.status !== 'published') throw visualError('VISUAL_ASSET_INTERNAL_CATALOG_NOT_PUBLISHED', 'catalog is not published', 409);
    if (catalog.catalogHash !== body.catalogHash) throw visualError('VISUAL_ASSET_INTERNAL_CATALOG_IDENTITY_MISMATCH', 'catalog hash mismatch', 409);
    const asset = await requireAsset(body.assetId, body.assetVersion);
    if (asset.status !== 'published') throw visualError('VISUAL_ASSET_INTERNAL_ASSET_NOT_PUBLISHED', 'asset is not published', 409);
    if (asset.assetType !== body.assetType) throw visualError('VISUAL_ASSET_INTERNAL_TYPE_MISMATCH', 'asset type mismatch', 409);
    if (asset.canonicalMime !== PNG_MIME || body.canonicalMime !== PNG_MIME) throw visualError('VISUAL_ASSET_INTERNAL_MIME_MISMATCH', 'asset mime mismatch', 409);
    if (asset.assetContentSha256 !== body.assetContentSha256) throw visualError('VISUAL_ASSET_INTERNAL_CONTENT_HASH_MISMATCH', 'asset content hash mismatch', 409);
    if (requireMetadataHash && asset.assetMetadataHash !== body.assetMetadataHash) throw visualError('VISUAL_ASSET_INTERNAL_METADATA_HASH_MISMATCH', 'asset metadata hash mismatch', 409);
    const ref = [...catalog.assetRefs, ...catalog.unknownAssetRefs].find((item) => (
      item.assetId === body.assetId && item.assetVersion === body.assetVersion
    ));
    if (!ref) throw visualError('VISUAL_ASSET_INTERNAL_CATALOG_REF_MISSING', 'catalog ref missing', 404);
    const expectedRef = assetToRef(asset);
    if (canonicalJson(ref) !== canonicalJson(expectedRef)) throw visualError('VISUAL_ASSET_INTERNAL_CATALOG_REF_MISMATCH', 'catalog ref does not match asset', 409);
    const catalogRefHash = sha256Json(ref);
    if (requireMetadataHash && catalogRefHash !== body.catalogRefHash) throw visualError('VISUAL_ASSET_INTERNAL_CATALOG_REF_MISMATCH', 'catalog ref hash mismatch', 409);
    return { asset, catalog, ref, catalogRefHash };
  }

  async function createCatalogDraft(body) {
    requireExactKeys(body, ['schemaVersion', 'catalogId', 'catalogRevision', 'assetRefs'], 'catalogDraft');
    if (body.schemaVersion !== CATALOG_DRAFT_SCHEMA_VERSION) throw visualError('VISUAL_CATALOG_INVALID_SCHEMA', 'catalog schema invalid', 400);
    assertSafeString(body.catalogId, 'catalogId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
    if (body.catalogId === UNKNOWN_CATALOG_ID) throw visualError('VISUAL_CATALOG_RESERVED_ID', 'catalog id is reserved', 400);
    assertPositiveInteger(body.catalogRevision, 'catalogRevision');
    if (!Array.isArray(body.assetRefs) || body.assetRefs.length > 512) throw visualError('VISUAL_CATALOG_INVALID_REFS', 'assetRefs invalid', 400);
    const refs = [];
    const seen = new Set();
    for (const inputRef of body.assetRefs) {
      requireExactKeys(inputRef, ['assetId', 'assetVersion'], 'assetRef');
      assertSafeString(inputRef.assetId, 'assetId', 3, 80, /^[a-z][a-z0-9_-]{2,79}$/);
      assertPositiveInteger(inputRef.assetVersion, 'assetVersion');
      const asset = await requireAsset(inputRef.assetId, inputRef.assetVersion);
      if (asset.status !== 'draft' && !asset.assetId.startsWith('unknown_')) throw visualError('VISUAL_ASSET_STATUS_INVALID', 'asset must be draft or service-owned', 409);
      const ref = assetToRef(asset);
      const key = `${ref.assetId}:${ref.assetVersion}`;
      if (seen.has(key)) throw visualError('VISUAL_CATALOG_DUPLICATE_REF', 'duplicate ref', 400);
      seen.add(key);
      refs.push(ref);
    }
    const unknownRefs = ENTITY_TYPES.map((type) => assetToRef(BUILTIN_UNKNOWN_ASSETS[type]));
    const createdAt = nowIso(now);
    const catalog = {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      catalogId: body.catalogId,
      catalogRevision: body.catalogRevision,
      status: 'draft',
      assetRefs: refs,
      unknownAssetRefs: unknownRefs,
      dictionaryVersion: DICTIONARY_VERSION,
      dictionaryHash: DICTIONARY_HASH,
      createdAt,
      updatedAt: createdAt,
      publishedAt: null,
      archivedAt: null,
    };
    catalog.catalogHash = computeCatalogHash(catalog);
    validateCatalog(catalog);
    return assetStore.saveCatalog(catalog, { allowExactReplay: true });
  }

  async function validateCatalogRefs(catalog) {
    validateCatalog(catalog);
    for (const ref of [...catalog.assetRefs, ...catalog.unknownAssetRefs]) {
      const asset = await requireAsset(ref.assetId, ref.assetVersion);
      const expected = assetToRef(asset);
      if (canonicalJson(ref) !== canonicalJson(expected)) {
        throw visualError('VISUAL_CATALOG_REF_MISMATCH', 'catalog ref does not match asset metadata/content', 409);
      }
    }
  }

  async function updateCatalogLifecycle(catalogId, catalogRevision, action) {
    const catalog = await requireCatalog(catalogId, catalogRevision);
    await validateCatalogRefs(catalog);
    const previousHash = catalog.catalogHash;
    const updated = structuredClone(catalog);
    updated.updatedAt = nowIso(now);
    if (action === 'validate') {
      if (catalog.status !== 'draft') throw visualError('VISUAL_CATALOG_STATE_INVALID', 'only draft catalogs can be validated', 409);
      updated.status = 'validated';
    } else if (action === 'publish') {
      if (catalog.status === 'published') return catalog;
      if (catalog.status !== 'validated') throw visualError('VISUAL_CATALOG_STATE_INVALID', 'only validated catalogs can be published', 409);
      updated.status = 'published';
      updated.publishedAt = updated.updatedAt;
      for (const ref of updated.assetRefs) {
        const asset = await requireAsset(ref.assetId, ref.assetVersion);
        if (asset.status === 'draft') {
          const promoted = { ...asset, status: 'published', updatedAt: updated.updatedAt };
          promoted.assetMetadataHash = computeAssetMetadataHash(promoted);
          await assetStore.replaceAsset(promoted, asset.assetMetadataHash);
          const stored = await requireAsset(ref.assetId, ref.assetVersion);
          if (stored.assetMetadataHash !== promoted.assetMetadataHash) throw visualError('VISUAL_ASSET_CONFLICT', 'asset publish conflict', 409);
          Object.assign(ref, assetToRef(stored));
        }
      }
    } else if (action === 'archive') {
      if (catalog.status === 'archived') return catalog;
      if (catalog.status !== 'published') throw visualError('VISUAL_CATALOG_STATE_INVALID', 'only published catalogs can be archived', 409);
      updated.status = 'archived';
      updated.archivedAt = updated.updatedAt;
    } else {
      throw visualError('VISUAL_CATALOG_STATE_INVALID', 'unknown lifecycle action', 400);
    }
    updated.catalogHash = computeCatalogHash(updated);
    validateCatalog(updated);
    const saved = await assetStore.replaceCatalog(updated, previousHash);
    if (action === 'publish') await assetStore.setActiveCatalog(saved);
    return saved;
  }

  async function rollbackCatalog(catalogId, body) {
    requireExactKeys(body, ['catalogRevision'], 'rollback');
    assertPositiveInteger(body.catalogRevision, 'catalogRevision');
    const catalog = await requireCatalog(catalogId, body.catalogRevision);
    if (!['published', 'archived'].includes(catalog.status)) throw visualError('VISUAL_CATALOG_STATE_INVALID', 'rollback target must be published or archived', 409);
    await validateCatalogRefs(catalog);
    await assetStore.setActiveCatalog(catalog);
    return catalog;
  }

  return {
    handleRequest,
    initialize,
    uploadAsset,
    createCatalogDraft,
    updateCatalogLifecycle,
    rollbackCatalog,
    migrateRuntimeV2Catalog,
    previewRuntimeV2CatalogMigration,
    migrateRuntimeV2CatalogAndActivateControl,
    stores: { assetStore, contentStore },
  };
}

async function readJsonBody(req, limit) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw visualError('VISUAL_ASSET_REQUEST_TOO_LARGE', 'request too large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) throw visualError('VISUAL_ASSET_BAD_REQUEST', 'request body required', 400);
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) throw visualError('VISUAL_ASSET_JSON_BOM_REJECTED', 'JSON BOM not allowed', 400);
  return JSON.parse(text);
}

async function readStrictJsonBody(req, limit, label) {
  const text = await readStrictJsonText(req, limit, label);
  assertNoDuplicateJsonKeys(text, label);
  try {
    return JSON.parse(text);
  } catch {
    throw visualError('VISUAL_ASSET_BAD_REQUEST', 'request JSON invalid', 400);
  }
}

async function readStrictJsonText(req, limit, label) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw visualError('VISUAL_ASSET_REQUEST_TOO_LARGE', 'request too large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) throw visualError('VISUAL_ASSET_BAD_REQUEST', 'request body required', 400);
  const text = Buffer.concat(chunks).toString('utf8');
  assertJsonText(text, limit, label);
  return text;
}

function createBindingArtifacts({ request, proof, input, decision, unknownCompatibilityReport }) {
  const catalogRefHash = catalogRefHashForDecision(decision, input, unknownCompatibilityReport);
  const bindingId = createStableId('vb', {
    releaseId: proof.releaseId,
    scenarioId: proof.scenarioId,
    scenarioVersion: proof.scenarioVersion,
    arcId: proof.arcId,
    chatId: proof.chatId,
    entityKey: request.entityKey,
    decisionId: decision.decisionId,
    assetId: decision.assetId,
    assetVersion: decision.assetVersion,
  });
  const matchId = createStableId('vm', {
    bindingId,
    projectionId: proof.projectionId,
    entityKey: request.entityKey,
    decisionId: decision.decisionId,
  });
  const publicBinding = {
    schemaVersion: 'galgame.visual-binding.v1',
    bindingId,
    bindingType: decision.entityType,
    entityKey: decision.entityKey,
    releaseId: proof.releaseId,
    scenarioId: proof.scenarioId,
    scenarioVersion: proof.scenarioVersion,
    arcId: proof.arcId,
    chatId: proof.chatId,
    sourceMessageIndex: decision.sourceMessageIndex,
    sourceMessageHash: decision.sourceMessageHash,
    evidenceDigest: decision.evidenceDigest,
    projectionId: decision.projectionId,
    visualProfileId: decision.visualProfileId,
    profileHash: decision.profileHash,
    catalogId: decision.catalogId,
    catalogRevision: decision.catalogRevision,
    catalogHash: decision.catalogHash,
    assetId: decision.assetId,
    assetVersion: decision.assetVersion,
    assetContentSha256: decision.assetContentSha256,
    matcherVersion: decision.matcherVersion,
    scorerVersion: decision.scorerVersion,
    dictionaryVersion: decision.dictionaryVersion,
    dictionaryHash: decision.dictionaryHash,
    score: decision.score,
    scoreBand: decision.scoreBand,
    reasonCodes: decision.reasonCodes,
    bindingPolicy: bindingPolicyForType(decision.entityType),
    idempotencyKey: request.idempotencyKey,
    createdAt: decision.createdAt,
    updatedAt: decision.createdAt,
    expiresAt: decision.expiresAt || proof.expiresAt,
  };
  const publicResult = {
    schemaVersion: 'galgame.visual-match-result.v1',
    matchId,
    bindingId,
    entityKey: decision.entityKey,
    type: decision.entityType,
    catalogId: decision.catalogId,
    catalogRevision: decision.catalogRevision,
    catalogHash: decision.catalogHash,
    visualProfileId: decision.visualProfileId,
    profileHash: decision.profileHash,
    evidenceDigest: decision.evidenceDigest,
    projectionId: decision.projectionId,
    sourceMessageIndex: decision.sourceMessageIndex,
    sourceMessageHash: decision.sourceMessageHash,
    assetId: decision.assetId,
    assetVersion: decision.assetVersion,
    assetContentSha256: decision.assetContentSha256,
    matcherVersion: decision.matcherVersion,
    scorerVersion: decision.scorerVersion,
    dictionaryVersion: decision.dictionaryVersion,
    dictionaryHash: decision.dictionaryHash,
    score: decision.score,
    scoreBand: decision.scoreBand,
    reasonCodes: decision.reasonCodes,
    usesLlm: false,
    createdAt: decision.createdAt,
    expiresAt: decision.expiresAt || proof.expiresAt,
  };
  const publicBindingHash = sha256Json(publicBinding);
  const publicResultHash = sha256Json(publicResult);
  const record = {
    schemaVersion: VISUAL_BINDING_STORE_RECORD_SCHEMA_VERSION,
    bindingId,
    bindingStatus: 'active',
    bindingPolicy: 'current-release',
    releaseId: proof.releaseId,
    scenarioId: proof.scenarioId,
    scenarioVersion: proof.scenarioVersion,
    arcId: proof.arcId,
    chatId: proof.chatId,
    projectionId: proof.projectionId,
    projectionHash: proof.projectionHash,
    sourceMessageIndex: decision.sourceMessageIndex,
    sourceMessageHash: decision.sourceMessageHash,
    evidenceDigest: decision.evidenceDigest,
    entityKey: decision.entityKey,
    entityType: decision.entityType,
    decisionId: decision.decisionId,
    matchId,
    assetId: decision.assetId,
    assetVersion: decision.assetVersion,
    assetContentSha256: decision.assetContentSha256,
    assetMetadataHash: decision.assetMetadataHash,
    catalogRefHash,
    visualProfileId: decision.visualProfileId,
    profileHash: decision.profileHash,
    catalogId: decision.catalogId,
    catalogRevision: decision.catalogRevision,
    catalogHash: decision.catalogHash,
    dictionaryVersion: decision.dictionaryVersion,
    dictionaryHash: decision.dictionaryHash,
    matcherVersion: decision.matcherVersion,
    scorerVersion: decision.scorerVersion,
    idempotencyKeyHash: sha256Digest(request.idempotencyKey),
    publicBindingHash,
    publicResultHash,
    createdAt: decision.createdAt,
    expiresAt: decision.expiresAt || proof.expiresAt,
  };
  validateBindingStoreRecord(record);
  validateStoredPublicArtifacts(record, publicBinding, publicResult);
  return {
    record,
    publicBinding,
    publicResult,
    idempotencyKeyHash: record.idempotencyKeyHash.slice('sha256:'.length),
    activeEntityHash: createActiveEntityHash(record).slice('sha256:'.length),
    proofReplayKey: createProofReplayKey(proof, decision.entityKey),
  };
}

function catalogRefHashForDecision(decision, input, report) {
  const sharedUnknown = SHARED_IMMUTABLE_UNKNOWN_VISUAL_ASSETS[input.entityType];
  if (
    decision.assetId === sharedUnknown.assetId
    && decision.assetVersion === sharedUnknown.assetVersion
    && decision.assetContentSha256 === sharedUnknown.assetContentSha256
  ) {
    const entry = report.entries.find((item) => item.type === input.entityType);
    if (!entry?.compatible) throw visualError('VISUAL_MATCH_UNKNOWN_COMPATIBILITY_INVALID', 'unknown report entry invalid', 409);
    return entry.catalogRefHash;
  }
  const ref = findCatalogAssetRef(input.catalogAssetRefs, decision.assetId, decision.assetVersion);
  if (!ref) throw visualError('VISUAL_MATCH_DECISION_PROVENANCE_INVALID', 'decision catalog ref missing', 409);
  return ref.catalogRefHash;
}

function normalizeCoreVisualContextError(error) {
  if (VISUAL_CORE_CONTEXT_ERROR_CODES.has(error?.code)) return error;
  const code = String(error?.code || '');
  if (code.startsWith('VISUAL_CONTROL_')
    || code.startsWith('VISUAL_CATALOG_')
    || code.startsWith('VISUAL_CORE_')
    || code.startsWith('VISUAL_ASSET_')) {
    return visualError('VISUAL_CORE_CONTEXT_INVALID', 'visual context state is invalid', 500);
  }
  return visualError('VISUAL_CORE_CONTEXT_UNAVAILABLE', 'visual context is unavailable', 503);
}

function sendCoreVisualContextJson(res, status, value) {
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, status, value);
}

function sendCoreVisualContextError(res, error) {
  const normalized = normalizeCoreVisualContextError(error);
  res.setHeader('Cache-Control', 'no-store');
  return sendJson(res, normalized.status || 503, {
    ok: false,
    schemaVersion: VISUAL_CORE_CONTEXT_RESPONSE_VERSION,
    error: { code: normalized.code },
  });
}

function sendJson(res, status, value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', String(bytes.length));
  res.end(bytes);
}

function sendInternalAssetJsonError(res, status, code) {
  return sendJson(res, status, {
    ok: false,
    schemaVersion: VISUAL_ASSET_INTERNAL_ERROR_VERSION,
    error: { code },
  });
}

function parseCsvEnv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function parseVisualMatchServiceToken(value) {
  const token = String(value || '');
  if (!token) return { token: '', invalid: false };
  return {
    token,
    invalid: !VISUAL_MATCH_SERVICE_TOKEN_PATTERN.test(token),
  };
}

function parseVisualAssetInternalReadToken(value) {
  const token = String(value || '');
  if (!token) return { token: '', invalid: false };
  return {
    token,
    invalid: !VISUAL_ASSET_INTERNAL_READ_TOKEN_PATTERN.test(token),
  };
}

function isVisualAssetInternalPath(pathname) {
  return pathname === VISUAL_ASSET_INTERNAL_METADATA_RESOLVE_PATH || pathname === VISUAL_ASSET_INTERNAL_CONTENT_READ_PATH;
}

function createServiceFromEnv() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = process.env.GALGAME_VISUAL_ASSET_DATA_DIR || path.join(moduleDir, 'data');
  const bindingStoreDir = process.env.GALGAME_VISUAL_BINDING_STORE_DIR || '';
  const service = createVisualAssetService({
    adminToken: process.env.GALGAME_VISUAL_ASSET_ADMIN_TOKEN || '',
    adminOrigins: parseCsvEnv(process.env.GALGAME_VISUAL_ASSET_ADMIN_ORIGINS || ''),
    visualMatchPlayerOrigins: parseCsvEnv(process.env.GALGAME_VISUAL_MATCH_PLAYER_ORIGINS || ''),
    visualMatchServiceToken: process.env.GALGAME_VISUAL_MATCH_SERVICE_TOKEN || '',
    visualAssetInternalReadToken: process.env.GALGAME_VISUAL_ASSET_INTERNAL_READ_TOKEN || '',
    visualProjectionSecret: process.env.GALGAME_VISUAL_PROJECTION_SECRET || '',
    projectionStubBaseUrl: process.env.GALGAME_VISUAL_PROJECTION_STUB_BASE_URL || '',
    projectionStubServiceToken: process.env.GALGAME_VISUAL_PROJECTION_STUB_SERVICE_TOKEN || '',
    visualRestoreServiceToken: process.env.GALGAME_VISUAL_RESTORE_SERVICE_TOKEN || '',
    visualRestoreProofSecret: process.env.GALGAME_VISUAL_RESTORE_PROOF_SECRET || '',
    visualRestoreProofKeyIds: parseCsvEnv(process.env.GALGAME_VISUAL_RESTORE_ACCEPTED_KEY_IDS || ''),
    bindingStore: bindingStoreDir ? new FileVisualBindingStore(bindingStoreDir) : null,
    restoreReplayStore: bindingStoreDir ? new FileVisualRestoreReplayStore(bindingStoreDir) : null,
    assetStore: new FileVisualAssetStore(path.join(dataDir, 'metadata')),
    contentStore: new FileContentStore(path.join(dataDir, 'content')),
    analysisCacheStore: new FileVisualAnalysisCacheStore(path.join(dataDir, 'analysis-cache')),
    visualControlStore: new FileVisualControlStore(path.join(dataDir, 'control')),
    analyzerBaseUrl: process.env.GALGAME_VISUAL_ANALYZER_BASE_URL || '',
    analyzerToken: process.env.GALGAME_VISUAL_ANALYZER_TOKEN || '',
    analyzerModel: process.env.GALGAME_VISUAL_ANALYZER_MODEL || '',
    analyzerTimeoutMs: Number(process.env.GALGAME_VISUAL_ANALYZER_TIMEOUT_MS || DEFAULT_ANALYZER_TIMEOUT_MS),
    analyzerCacheScope: process.env.GALGAME_VISUAL_ANALYZER_CACHE_SCOPE || DEFAULT_ANALYZER_CACHE_SCOPE,
    analyzerRequestStyle: process.env.GALGAME_VISUAL_ANALYZER_REQUEST_STYLE || DEFAULT_ANALYZER_REQUEST_STYLE,
    runtimeBaseUrl: process.env.GALGAME_VISUAL_RUNTIME_BASE_URL || '',
    runtimeToken: process.env.GALGAME_VISUAL_RUNTIME_TOKEN || '',
    runtimeModel: process.env.GALGAME_VISUAL_RUNTIME_MODEL || '',
    runtimeRequestStyle: process.env.GALGAME_VISUAL_RUNTIME_REQUEST_STYLE || VISUAL_RUNTIME_REQUEST_STYLE,
    runtimeCacheScope: process.env.GALGAME_VISUAL_RUNTIME_CACHE_SCOPE || 'independent-runtime-v1',
    runtimeTimeoutMs: Number(process.env.GALGAME_VISUAL_RUNTIME_TIMEOUT_MS || VISUAL_RUNTIME_TIMEOUT_MS),
  });
  return { service, dataDir };
}

function createServerFromEnv() {
  return http.createServer(createServiceFromEnv().service.handleRequest);
}

function parseRuntimeV2MigrationCliArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  if (!args.includes('--migrate-runtime-v2')) return null;
  const modes = args.filter((arg) => arg === '--dry-run' || arg === '--execute');
  const unknown = args.filter((arg) => !['--migrate-runtime-v2', '--dry-run', '--execute'].includes(arg));
  if (unknown.length > 0 || modes.length !== 1) {
    throw visualError('VISUAL_RUNTIME_MIGRATION_CLI_INVALID', 'migration mode must be exactly dry-run or execute', 400);
  }
  return { mode: modes[0] === '--dry-run' ? 'dry-run' : 'execute' };
}

async function runRuntimeV2MigrationCli(mode) {
  const { service } = createServiceFromEnv();
  await service.initialize();
  return mode === 'dry-run'
    ? service.previewRuntimeV2CatalogMigration()
    : service.migrateRuntimeV2CatalogAndActivateControl();
}

export function isMainModule(argv1 = process.argv[1], moduleUrl = import.meta.url) {
  if (!argv1) return false;
  try {
    const modulePath = path.resolve(fileURLToPath(moduleUrl));
    const entryPath = path.resolve(String(argv1));
    if (process.platform === 'win32') return modulePath.toLowerCase() === entryPath.toLowerCase();
    return modulePath === entryPath;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  let migrationCli;
  try {
    migrationCli = parseRuntimeV2MigrationCliArgs();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, operation: 'runtime-v2-migration', mode: null, oldPointer: error.details?.oldPointer || null, newPointer: null, errorCode: error.code || 'VISUAL_RUNTIME_MIGRATION_CLI_INVALID' }));
    process.exitCode = 2;
  }
  if (migrationCli) {
    runRuntimeV2MigrationCli(migrationCli.mode)
      .then((result) => console.log(JSON.stringify({ operation: 'runtime-v2-migration', ...result })))
      .catch((error) => {
        console.error(JSON.stringify({ ok: false, operation: 'runtime-v2-migration', mode: migrationCli.mode, oldPointer: error.details?.oldPointer || null, newPointer: null, errorCode: error.code || 'VISUAL_RUNTIME_MIGRATION_FAILED' }));
        process.exitCode = 1;
      });
  } else if (process.exitCode !== 2) {
    const host = process.env.GALGAME_VISUAL_ASSET_HOST || '127.0.0.1';
    const port = Number(process.env.GALGAME_VISUAL_ASSET_PORT || DEFAULT_PORT);
    const server = createServerFromEnv();
    server.listen(port, host, () => {
      const address = server.address();
      const listeningPort = typeof address === 'object' && address ? address.port : port;
      console.log(`${SERVICE_NAME} listening on http://${host}:${listeningPort}`);
    });
  }
}

export {
  ASSET_SCHEMA_VERSION,
  CATALOG_SCHEMA_VERSION,
  CANDIDATE_DECISION_INPUT_SCHEMA_VERSION,
  CANDIDATE_DECISION_SCHEMA_VERSION,
  UPLOAD_SCHEMA_VERSION,
  SIMPLE_UPLOAD_SCHEMA_VERSION,
  CATALOG_DRAFT_SCHEMA_VERSION,
  VISUAL_CORE_CONTEXT_RESPONSE_VERSION,
  VISUAL_CORE_CANDIDATE_DECISION_PLAN_VERSION,
  VISUAL_CORE_CANDIDATE_DECISION_REQUEST_VERSION,
  VISUAL_RUNTIME_DECISION_REQUEST_VERSION,
  VISUAL_RUNTIME_DECISION_RESPONSE_VERSION,
  VISUAL_RUNTIME_DECISION_ERROR_VERSION,
  VISUAL_RUNTIME_HINTS_VERSION,
  VISUAL_RUNTIME_FIXED_INSTRUCTION,
  BUILTIN_UNKNOWN_ASSETS,
  DICTIONARY_HASH,
  DICTIONARY_VERSION,
  LEGACY_DICTIONARY_HASH,
  LEGACY_DICTIONARY_VERSION,
  VISUAL_ANALYSIS_SCHEMA_VERSION,
  LEGACY_VISUAL_ANALYSIS_SCHEMA_VERSION,
  ENTITY_TYPES,
  FileContentStore,
  FileVisualAnalysisCacheStore,
  FileVisualRestoreReplayStore,
  FileVisualBindingStore,
  FileVisualAssetStore,
  FileVisualControlStore,
  MAX_COMPRESSION_RATIO,
  MAX_DECODED_PIXELS,
  MemoryContentStore,
  MemoryVisualAnalysisCacheStore,
  MemoryProofReplayStore,
  MemoryRestoreReplayStore,
  MemoryVisualBindingStore,
  MemoryVisualAssetStore,
  MemoryVisualControlStore,
  PNG_MIME,
  VISUAL_CONTROL_SCHEMA_VERSION,
  UNKNOWN_COMPATIBILITY_REPORT_SCHEMA_VERSION,
  computeAssetMetadataHash,
  computeCatalogHash,
  base64UrlEncodeCanonical,
  createUnknownCompatibilityReport,
  createGlobalDisplayVisualProfile,
  createCoreVisualCandidateDecisionPlan,
  scoreRuntimeCandidate,
  compareCandidateScores,
  createRuntimeV2MigrationPlan,
  executeRuntimeV2Migration,
  parseRuntimeV2MigrationCliArgs,
  createPngChunk,
  createVisualCandidateAssetInputFromAsset,
  createVisualCandidateDecision,
  encodePng,
  parseVisualCandidateDecisionInputJson,
  validateUnknownCompatibilityReport,
  validateVisualCandidateDecision,
  validateVisualCandidateDecisionForInput,
  validateVisualCandidateDecisionInput,
};
