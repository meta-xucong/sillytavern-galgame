import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    buildOriginalResourcePackage,
    createOriginalSillyTavernImporter,
    diagnoseOriginalResourceReadback,
} from '../../external-modules/script-import-assistant/original-st-importer.mjs';
import {
    SillyTavernHttpClient,
    SillyTavernOriginalChatBridge,
} from '../shared/src/sillytavern-adapter.js';
import {
    LocalReleaseStore,
    MemoryStorageBackend,
} from '../shared/src/storage.js';
import {
    bindAdaptivePresentationProfileHashes,
} from '../shared/src/protocol.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/script-import-assistant-real-st-aa3.json');
const runId = String(args['run-id'] || Date.now().toString(36)).toLowerCase();

const evidence = {
    ok: false,
    generatedAt: new Date().toISOString(),
    baseUrl,
    runId,
    mode: 'real-sillytavern-script-import-assistant-aa3-smoke',
    checks: {},
    failures: [],
};

try {
    evidence.checks.legacyConflictDiagnostic = await runLegacyConflictDiagnostic();
    evidence.checks.firstCreateAndRetrySkip = await runFirstCreateAndRetrySkip();
    evidence.checks.bodyTamperConflict = await runBodyTamperConflict();
    evidence.checks.differentSourceConflict = await runDifferentSourceConflict();
    evidence.ok = Object.values(evidence.checks).every((check) => check.ok);
    evidence.failures = Object.entries(evidence.checks)
        .filter(([, check]) => !check.ok)
        .map(([name, check]) => `${name}: ${check.error || JSON.stringify(check.failures || [])}`);
} catch (error) {
    evidence.ok = false;
    evidence.failures.push(error?.stack || error?.message || String(error));
}

await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
console.log(JSON.stringify({
    ok: evidence.ok,
    evidence: toRepoPath(evidencePath),
    failures: evidence.failures,
}, null, 2));
if (!evidence.ok) {
    process.exitCode = 1;
}

async function runLegacyConflictDiagnostic() {
    const record = makeRecord({
        title: 'AA3 Smoke Test Story',
        prefix: 'AA3Smoke',
        chatSlug: 'aa3smoke',
        characters: ['Smoke Anna', 'Smoke Andrei'],
        fileName: 'aa3-smoke.md',
        text: ['# AA3 Smoke Test Story', '角色: Smoke Anna, Smoke Andrei', 'A short original-ST import smoke opening for AA3 readback.'].join('\n'),
    });
    const resourcePackage = buildOriginalResourcePackage(record, {
        now: () => new Date('2026-07-26T00:00:00.000Z'),
    });
    const { client, chatBridge } = createReadbackClients();
    const check = {
        ok: true,
        resourcePrefix: 'Galgame_AIImport_AA3Smoke',
        previousFailurePreservedAsDiagnostic: true,
        note: 'Earlier real-ST run failed on this legacy resource because metadata.resourceHash used the pre-canonicalization hash. This check compares canonical request body with current original ST readback instead of overwriting it.',
    };
    try {
        check.diagnostic = await diagnoseOriginalResourceReadback({
            resourcePackage,
            client,
            chatBridge,
        });
        check.ok = ['character', 'worldBook', 'chatSeed'].every((key) => check.diagnostic[key]?.canonicalMatches);
    } catch (error) {
        check.ok = false;
        check.error = error?.code || error?.message || String(error);
        check.details = error?.details || {};
    }
    return check;
}

async function runFirstCreateAndRetrySkip() {
    const record = makeRecord({
        title: `AA3 Real Create ${runId}`,
        prefix: `AA3RealCreate_${runId}`,
        chatSlug: `aa3-real-create-${runId}`,
        characters: ['Smoke Yui', 'Smoke Ren'],
        fileName: `aa3-real-create-${runId}.md`,
        text: [`# AA3 Real Create ${runId}`, '角色: Smoke Yui, Smoke Ren', 'A fresh original-ST import smoke for first-create and retry-skip verification.'].join('\n'),
    });
    const first = await confirmWithLoggedFetch(record);
    const retry = await confirmWithLoggedFetch(record);
    const manifest = first.result.manifest;
    const releaseCheck = await verifyPublishGate(manifest);
    return {
        ok: first.ok
            && retry.ok
            && first.result.importResult.actions.every((action) => action.action === 'created')
            && retry.result.importResult.actions.every((action) => action.action === 'skipped-existing-identical')
            && releaseCheck.ok,
        firstActions: first.result.importResult.actions,
        retryActions: retry.result.importResult.actions,
        firstWriteCounts: countWriteCalls(first.calls),
        retryWriteCounts: countWriteCalls(retry.calls),
        manifestArcStatus: manifest.arcs[0]?.status || '',
        manifestHasPublishedAt: Object.hasOwn(manifest.arcs[0] || {}, 'publishedAt'),
        publishGate: releaseCheck,
        references: first.result.importResult.references,
        readback: first.result.importResult.readback,
    };
}

async function runBodyTamperConflict() {
    const results = [];
    for (const tamper of [
        {
            kind: 'character-body',
            expectedConflictKind: 'character',
            prefix: `AA3RealTamperChar_${runId}`,
            chatSlug: `aa3-real-tamper-character-${runId}`,
            characters: ['Smoke Mio', 'Smoke Kei'],
            title: `AA3 Real Character Tamper ${runId}`,
        },
        {
            kind: 'character-runtime-semantics',
            expectedConflictKind: 'character',
            prefix: `AA3RealTamperCharRuntime_${runId}`,
            chatSlug: `aa3-real-tamper-character-runtime-${runId}`,
            characters: ['Smoke Mio', 'Smoke Kei'],
            title: `AA3 Real Character Runtime Tamper ${runId}`,
        },
        {
            kind: 'character-embedded-book',
            expectedConflictKind: 'character',
            prefix: `AA3RealTamperCharBook_${runId}`,
            chatSlug: `aa3-real-tamper-character-book-${runId}`,
            characters: ['Smoke Mio', 'Smoke Kei'],
            title: `AA3 Real Character Embedded Book Tamper ${runId}`,
        },
        {
            kind: 'character-regex-runtime',
            expectedConflictKind: 'character',
            prefix: `AA3RealTamperCharRegex_${runId}`,
            chatSlug: `aa3-real-tamper-character-regex-${runId}`,
            characters: ['Smoke Mio', 'Smoke Kei'],
            title: `AA3 Real Character Regex Tamper ${runId}`,
        },
        {
            kind: 'character-unknown-runtime-extension',
            expectedConflictKind: 'character',
            prefix: `AA3RealTamperCharUnknown_${runId}`,
            chatSlug: `aa3-real-tamper-character-unknown-${runId}`,
            characters: ['Smoke Mio', 'Smoke Kei'],
            title: `AA3 Real Character Unknown Extension Tamper ${runId}`,
            expectUnsupported: true,
        },
        {
            kind: 'worldbook-body',
            expectedConflictKind: 'worldbook',
            prefix: `AA3RealTamperWorld_${runId}`,
            chatSlug: `aa3-real-tamper-world-${runId}`,
            characters: ['Smoke Sora', 'Smoke Aki'],
            title: `AA3 Real World Tamper ${runId}`,
        },
        {
            kind: 'worldbook-runtime-semantics',
            expectedConflictKind: 'worldbook',
            prefix: `AA3RealTamperWorldRuntime_${runId}`,
            chatSlug: `aa3-real-tamper-world-runtime-${runId}`,
            characters: ['Smoke Sora', 'Smoke Aki'],
            title: `AA3 Real World Runtime Tamper ${runId}`,
        },
        {
            kind: 'worldbook-extension-runtime-semantics',
            expectedConflictKind: 'worldbook',
            prefix: `AA3RealTamperWorldExtension_${runId}`,
            chatSlug: `aa3-real-tamper-world-extension-${runId}`,
            characters: ['Smoke Sora', 'Smoke Aki'],
            title: `AA3 Real World Extension Tamper ${runId}`,
        },
        {
            kind: 'worldbook-unknown-runtime-field',
            expectedConflictKind: 'worldbook',
            prefix: `AA3RealTamperWorldUnknown_${runId}`,
            chatSlug: `aa3-real-tamper-world-unknown-${runId}`,
            characters: ['Smoke Sora', 'Smoke Aki'],
            title: `AA3 Real World Unknown Field Tamper ${runId}`,
            expectUnsupported: true,
        },
        {
            kind: 'chat-seed-body',
            expectedConflictKind: 'chat-seed',
            prefix: `AA3RealTamperChat_${runId}`,
            chatSlug: `aa3-real-tamper-chat-${runId}`,
            characters: ['Smoke Hana', 'Smoke Rei'],
            title: `AA3 Real Chat Tamper ${runId}`,
        },
    ]) {
        const record = makeRecord({
            title: tamper.title,
            prefix: tamper.prefix,
            chatSlug: tamper.chatSlug,
            characters: tamper.characters,
            fileName: `${tamper.chatSlug}.md`,
            text: [
                `# ${tamper.title}`,
                `角色: ${tamper.characters.join(', ')}`,
                `This smoke will tamper with the original ${tamper.kind} after import.`,
            ].join('\n'),
        });
        const first = await confirmWithLoggedFetch(record);
        await tamperOriginalResource(tamper.kind, first.result.importResult.references);
        const conflict = await confirmExpectConflict(record);
        results.push({
            tamperKind: tamper.kind,
            ok: first.ok
                && conflict.ok
                && conflict.error === 'SCRIPT_IMPORT_RESOURCE_CONFLICT'
                && conflict.details?.kind === tamper.expectedConflictKind
                && conflict.details?.actualBodyHash
                && conflict.details.actualBodyHash !== conflict.details.expectedResourceHash
                && (!tamper.expectUnsupported || conflict.details?.unsupportedFindings?.length > 0)
                && Object.keys(conflict.writeCounts).length === 0,
            firstActions: first.result.importResult.actions,
            conflictError: conflict.error,
            conflictDetails: conflict.details,
            writeCountsDuringRejectedConfirm: conflict.writeCounts,
        });
    }
    return {
        ok: results.every((result) => result.ok),
        results,
    };
}

async function runDifferentSourceConflict() {
    const firstRecord = makeRecord({
        title: `AA3 Real Source Conflict ${runId}`,
        prefix: `AA3RealSource_${runId}`,
        chatSlug: `aa3-real-source-${runId}`,
        characters: ['Smoke Nao', 'Smoke Riku'],
        fileName: `aa3-real-source-${runId}.md`,
        text: [`# AA3 Real Source Conflict ${runId}`, '角色: Smoke Nao, Smoke Riku', 'Original source package.'].join('\n'),
    });
    const secondRecord = makeRecord({
        title: `AA3 Real Source Conflict ${runId}`,
        prefix: `AA3RealSource_${runId}`,
        chatSlug: `aa3-real-source-${runId}`,
        characters: ['Smoke Nao', 'Smoke Riku'],
        fileName: `aa3-real-source-${runId}.md`,
        text: [`# AA3 Real Source Conflict ${runId}`, '角色: Smoke Nao, Smoke Riku', 'Different source package with the same target names.'].join('\n'),
    });
    const first = await confirmWithLoggedFetch(firstRecord);
    const conflict = await confirmExpectConflict(secondRecord);
    return {
        ok: first.ok
            && conflict.ok
            && conflict.error === 'SCRIPT_IMPORT_RESOURCE_CONFLICT'
            && conflict.details?.actualSourceDigest !== conflict.details?.expectedSourceDigest
            && Object.keys(conflict.writeCounts).length === 0,
        firstActions: first.result.importResult.actions,
        conflictError: conflict.error,
        conflictDetails: conflict.details,
        writeCountsDuringRejectedConfirm: conflict.writeCounts,
    };
}

async function confirmWithLoggedFetch(record) {
    const calls = [];
    const importer = createOriginalSillyTavernImporter({
        baseUrl,
        fetchImpl: createLoggedFetch(calls),
        now: () => new Date('2026-07-26T00:00:00.000Z'),
    });
    const result = await importer.confirmDraft(record);
    return {
        ok: Boolean(result?.ok),
        result,
        calls,
    };
}

async function confirmExpectConflict(record) {
    const calls = [];
    const importer = createOriginalSillyTavernImporter({
        baseUrl,
        fetchImpl: createLoggedFetch(calls),
        now: () => new Date('2026-07-26T00:00:00.000Z'),
    });
    try {
        await importer.confirmDraft(record);
        return {
            ok: false,
            error: 'EXPECTED_CONFLICT_NOT_THROWN',
            writeCounts: countWriteCalls(calls),
        };
    } catch (error) {
        return {
            ok: error?.code === 'SCRIPT_IMPORT_RESOURCE_CONFLICT',
            error: error?.code || error?.message || String(error),
            details: error?.details || {},
            writeCounts: countWriteCalls(calls),
        };
    }
}

async function tamperOriginalResource(kind, references) {
    if (kind === 'character-body') {
        await tamperCharacter(references.characterRef, kind);
        return;
    }
    if (
        kind === 'character-runtime-semantics'
        || kind === 'character-embedded-book'
        || kind === 'character-regex-runtime'
        || kind === 'character-unknown-runtime-extension'
    ) {
        await tamperCharacter(references.characterRef, kind);
        return;
    }
    if (kind === 'worldbook-body') {
        await tamperWorldBook(references.worldBookRef.name, kind);
        return;
    }
    if (
        kind === 'worldbook-runtime-semantics'
        || kind === 'worldbook-extension-runtime-semantics'
        || kind === 'worldbook-unknown-runtime-field'
    ) {
        await tamperWorldBook(references.worldBookRef.name, kind);
        return;
    }
    if (kind === 'chat-seed-body') {
        await tamperChatSeed({
            characterRef: references.characterRef,
            chatSeedId: references.chatSeedId,
        });
        return;
    }
    throw new Error(`UNKNOWN_TAMPER_KIND_${kind}`);
}

async function tamperCharacter(characterRef, kind = 'character-body') {
    const fetchWithCookies = createCookieFetch(globalThis.fetch);
    const client = new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies });
    const detail = await client.requestJson('/api/characters/get', {
        method: 'POST',
        body: { avatar_url: characterRef.avatar },
    });
    const source = detail?.data || detail || {};
    const nextDescription = kind === 'character-body'
        ? `${source.description || ''}\nAA3 real readback character tamper ${runId}`
        : source.description || '';
    const nextExtensions = {
        ...parseMaybeJson(source.extensions),
    };
    if (kind === 'character-runtime-semantics') {
        nextExtensions.depth_prompt = {
            ...(nextExtensions.depth_prompt || {}),
            prompt: `AA3 changed depth prompt ${runId}`,
            depth: 9,
            role: 'assistant',
        };
        nextExtensions.talkativeness = 0.1;
    }
    if (kind === 'character-regex-runtime') {
        nextExtensions.regex_scripts = [{
            id: `regex-${runId}`,
            scriptName: 'AA3 runtime regex tamper',
            findRegex: '/Anna/g',
            replaceString: 'Changed Anna',
            trimStrings: [],
            placement: [1, 2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: 0,
            maxDepth: 4,
        }];
    }
    if (kind === 'character-unknown-runtime-extension') {
        nextExtensions.prompt_transform_script = {
            mode: `unsupported-${runId}`,
        };
    }
    const nextData = {
        ...source,
        description: nextDescription,
        extensions: nextExtensions,
    };
    if (kind === 'character-embedded-book') {
        const embedded = structuredClone(nextData.character_book || { name: `${characterRef.name} embedded`, entries: [] });
        if (!Array.isArray(embedded.entries) || !embedded.entries.length) {
            embedded.entries = [{
                id: 0,
                keys: ['AA3'],
                secondary_keys: [],
                comment: 'AA3 embedded book tamper',
                content: 'Inserted embedded lorebook content outside importer.',
                constant: true,
                selective: false,
                insertion_order: 100,
                enabled: true,
                position: 'before_char',
                use_regex: true,
                extensions: {},
            }];
        } else {
            embedded.entries[0].content = `${embedded.entries[0].content || ''}\nAA3 embedded book tamper ${runId}`;
        }
        nextData.character_book = embedded;
    }
    const nextCard = detail?.data
        ? {
            ...detail,
            data: nextData,
        }
        : {
            ...detail,
            ...nextData,
        };
    const form = new FormData();
    form.set('avatar_url', characterRef.avatar);
    form.set('name', nextData.name || characterRef.name);
    form.set('ch_name', nextData.name || characterRef.name);
    form.set('description', nextDescription);
    form.set('personality', nextData.personality || '');
    form.set('scenario', nextData.scenario || '');
    form.set('first_mes', nextData.first_mes || '');
    form.set('mes_example', nextData.mes_example || '');
    form.set('creator_notes', nextData.creator_notes || detail?.creatorcomment || '');
    form.set('system_prompt', nextData.system_prompt || '');
    form.set('post_history_instructions', nextData.post_history_instructions || '');
    form.set('creator', nextData.creator || '');
    form.set('tags', Array.isArray(nextData.tags) ? nextData.tags.join(',') : String(nextData.tags || ''));
    form.set('talkativeness', String(nextExtensions.talkativeness ?? nextData.talkativeness ?? detail?.talkativeness ?? '0.7'));
    form.set('fav', String(nextData.fav ?? detail?.fav ?? false));
    form.set('world', nextData.world || nextExtensions.world || '');
    form.set('alternate_greetings', JSON.stringify(nextData.alternate_greetings || []));
    form.set('depth_prompt_prompt', String(nextExtensions.depth_prompt?.prompt ?? nextData.depth_prompt_prompt ?? ''));
    form.set('depth_prompt_depth', String(nextExtensions.depth_prompt?.depth ?? nextData.depth_prompt_depth ?? '4'));
    form.set('depth_prompt_role', String(nextExtensions.depth_prompt?.role ?? nextData.depth_prompt_role ?? 'system'));
    form.set('extensions', JSON.stringify(nextExtensions));
    form.set('json_data', JSON.stringify(nextCard));
    const token = await client.getCsrfToken();
    const response = await fetchWithCookies(`${baseUrl}/api/characters/edit`, {
        method: 'POST',
        headers: {
            'X-CSRF-Token': token,
        },
        body: form,
        cache: 'no-cache',
    });
    if (!response.ok) {
        throw new Error(`TAMPER_CHARACTER_EDIT_FAILED_${response.status}`);
    }
}

async function tamperWorldBook(worldBookName, kind = 'worldbook-body') {
    const { client } = createReadbackClients();
    const world = await client.requestJson('/api/worldinfo/get', {
        method: 'POST',
        body: { name: worldBookName },
    });
    const next = structuredClone(world);
    const firstKey = Object.keys(next.entries || {})[0];
    if (firstKey === undefined) {
        throw new Error('TAMPER_WORLD_BOOK_ENTRY_MISSING');
    }
    const entry = next.entries[firstKey];
    if (kind === 'worldbook-body') {
        entry.content = `${entry.content}\nAA3 real readback tamper ${runId}`;
    }
    if (kind === 'worldbook-runtime-semantics') {
        entry.probability = 10;
        entry.useProbability = true;
        entry.matchCharacterDepthPrompt = true;
        entry.scanDepth = 12;
        entry.caseSensitive = true;
        entry.matchWholeWords = false;
        entry.useGroupScoring = true;
        entry.sticky = 3;
        entry.cooldown = 2;
        entry.delay = 1;
        entry.role = 1;
        entry.triggers = ['continue'];
    }
    if (kind === 'worldbook-extension-runtime-semantics') {
        entry.extensions = {
            ...(entry.extensions || {}),
            scan_depth: 8,
            case_sensitive: true,
            match_whole_words: true,
            use_group_scoring: true,
            match_character_depth_prompt: true,
            sticky: 2,
            cooldown: 1,
            delay: 1,
            role: 1,
        };
    }
    if (kind === 'worldbook-unknown-runtime-field') {
        entry.extensions = {
            ...(entry.extensions || {}),
            custom_scan_prompt: `unsupported runtime field ${runId}`,
        };
    }
    await client.requestJson('/api/worldinfo/edit', {
        method: 'POST',
        body: {
            name: worldBookName,
            data: next,
        },
    });
}

async function tamperChatSeed({
    characterRef,
    chatSeedId,
}) {
    const { chatBridge } = createReadbackClients();
    const rawChat = await chatBridge.getCharacterChat({
        avatar: characterRef.avatar,
        fileName: chatSeedId,
    });
    const next = structuredClone(rawChat);
    const messageIndex = next.findIndex((message, index) => (
        index > 0 && message && typeof message.mes === 'string'
    ));
    if (messageIndex < 0) {
        throw new Error('TAMPER_CHAT_SEED_MESSAGE_MISSING');
    }
    next[messageIndex].mes = `${next[messageIndex].mes}\nAA3 real readback chat seed tamper ${runId}`;
    await chatBridge.saveCharacterChat({
        avatar: characterRef.avatar,
        characterName: characterRef.name,
        fileName: chatSeedId,
        chat: next,
    });
}

async function verifyPublishGate(manifest) {
    const store = new LocalReleaseStore(markManifestPublished(manifest), new MemoryStorageBackend());
    const before = await store.getActiveRelease();
    const rejected = await store.publishManifest(manifest, { activeArcId: manifest.defaultArcId });
    const afterRejected = await store.getActiveRelease();
    const explicit = await store.publishManifest(markManifestPublished(manifest), { activeArcId: manifest.defaultArcId });
    const afterExplicit = await store.getActiveRelease();
    return {
        ok: rejected.ok === false
            && afterRejected.releaseId === before.releaseId
            && explicit.ok === true
            && afterExplicit.releaseId === explicit.release.releaseId
            && afterExplicit.contentHash === explicit.release.contentHash
            && afterExplicit.activeArcId === manifest.defaultArcId,
        draftPublishRejected: rejected.ok === false,
        activeReleaseUnchangedAfterConfirmDraft: afterRejected.releaseId === before.releaseId,
        explicitPublishAccepted: explicit.ok === true,
        explicitPublishBecameActive: afterExplicit.releaseId === explicit.release.releaseId,
    };
}

function markManifestPublished(manifest) {
    const publishedAt = '2026-07-26T00:00:00.000Z';
    const profileBoundManifest = bindAdaptivePresentationProfileHashes(manifest, { arcId: manifest.defaultArcId });
    return {
        ...profileBoundManifest,
        updatedAt: publishedAt,
        arcs: profileBoundManifest.arcs.map((arc) => ({
            ...arc,
            status: 'published',
            publishedAt,
        })),
    };
}

function makeRecord({
    title,
    prefix,
    chatSlug,
    characters,
    fileName,
    text,
}) {
    const files = [{
        name: fileName,
        type: 'text/markdown',
        text,
    }];
    const sourceDigest = hashSourceFiles(files);
    return {
        draft: {
            protocolVersion: 'galgame.script-import-draft.v1',
            draftId: `draft_${sourceDigest.slice(0, 16)}`,
            revision: 1,
            status: 'ready-for-confirmation',
            summary: {
                title,
                recommendedTemplate: 'visual-novel',
                mainCharacters: characters,
                worldBookCount: 1,
                openingReady: true,
                usesLlm: false,
                importOnly: true,
                playerCallable: false,
            },
            importPlan: {
                characterName: `Galgame_AIImport_${prefix}_Director`,
                characterAvatar: `galgame_aiimport_${prefix.toLowerCase()}_director.png`,
                worldBookName: `Galgame_AIImport_${prefix}_World`,
                chatSeedId: `galgame-aiimport-${chatSlug}-seed`,
                writePolicy: 'deferred-aa3',
            },
            sourceDigest,
            sourceStats: {
                fileCount: files.length,
                totalCharacters: text.length,
            },
            safeWarnings: [],
        },
        files,
        options: {},
        sourceDigest,
    };
}

function createReadbackClients() {
    const fetchWithCookies = createCookieFetch(globalThis.fetch);
    return {
        client: new SillyTavernHttpClient({ baseUrl, fetchImpl: fetchWithCookies }),
        chatBridge: new SillyTavernOriginalChatBridge({ baseUrl, fetchImpl: fetchWithCookies }),
    };
}

function createLoggedFetch(calls) {
    return async (url, options = {}) => {
        calls.push({
            endpoint: new URL(String(url)).pathname,
            method: options.method || 'GET',
        });
        return globalThis.fetch(url, options);
    };
}

function countWriteCalls(calls) {
    const writeEndpoints = new Set([
        '/api/worldinfo/edit',
        '/api/characters/create',
        '/api/characters/edit',
        '/api/chats/save',
    ]);
    return calls
        .filter((call) => writeEndpoints.has(call.endpoint))
        .reduce((summary, call) => ({
            ...summary,
            [call.endpoint]: (summary[call.endpoint] || 0) + 1,
        }), {});
}

function hashSourceFiles(files) {
    const hash = createHash('sha256');
    for (const file of files) {
        hash.update(file.name);
        hash.update('\0');
        hash.update(file.type);
        hash.update('\0');
        hash.update(file.text);
        hash.update('\0');
    }
    return hash.digest('hex');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    const cookieFetch = async function cookieFetch(url, options = {}) {
        const headers = new Headers(options.headers || {});
        if (cookies.size && !headers.has('Cookie')) {
            headers.set('Cookie', cookieHeader());
        }
        const response = await fetchImpl(url, {
            ...options,
            headers,
        });
        remember(response.headers);
        return response;
    };
    function remember(headers) {
        const setCookieValues = typeof headers.getSetCookie === 'function'
            ? headers.getSetCookie()
            : [headers.get('set-cookie')].filter(Boolean);
        for (const value of setCookieValues) {
            for (const cookieText of splitSetCookieHeader(value)) {
                const firstPart = cookieText.split(';')[0];
                const separator = firstPart.indexOf('=');
                if (separator <= 0) {
                    continue;
                }
                cookies.set(firstPart.slice(0, separator), firstPart.slice(separator + 1));
            }
        }
    }
    function cookieHeader() {
        return [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
    }
    return cookieFetch;
}

function splitSetCookieHeader(value) {
    return String(value || '').split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function parseMaybeJson(value) {
    if (!value) {
        return {};
    }
    if (typeof value === 'object') {
        return value;
    }
    try {
        return JSON.parse(String(value));
    } catch {
        return {};
    }
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        const key = value.slice(2);
        const next = values[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
            continue;
        }
        parsed[key] = next;
        index += 1;
    }
    return parsed;
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
