import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_SCENARIO } from '../shared/src/demo-scenario.js';
import {
    getActiveSillyTavernBindings,
    materializeManifestForArc,
} from '../shared/src/protocol.js';
import { SillyTavernOriginalChatBridge } from '../shared/src/sillytavern-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/lucifer-arc-world-info-binding-audit.json');
const repair = args.repair === 'true' || args.repair === true;
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl,
    fetchImpl: fetchWithCookies,
    now: () => new Date(),
});

await mkdir(path.dirname(evidencePath), { recursive: true });

try {
    const results = [];
    for (const arc of DEMO_SCENARIO.arcs) {
        const manifest = materializeManifestForArc(DEMO_SCENARIO, arc.arcId);
        const bindings = getActiveSillyTavernBindings(manifest, arc.arcId);
        const character = bindings.characters[0];
        const chatSeedId = bindings.chatSeedId;
        const expectedWorldInfo = bindings.worldBooks[0]?.name || '';
        assert.ok(character?.avatar, `${arc.arcId} missing character avatar`);
        assert.ok(chatSeedId, `${arc.arcId} missing chatSeedId`);
        assert.ok(expectedWorldInfo, `${arc.arcId} missing worldBookRefs`);

        const rawChat = await chatBridge.getCharacterChat({
            avatar: character.avatar,
            fileName: chatSeedId,
        });
        const header = rawChat[0]?.chat_metadata ? rawChat[0] : null;
        const metadata = header?.chat_metadata || {};
        const visibleMessages = getVisibleMessages(rawChat);
        const sourceOk = metadata.fixture === 'worldforge-lucifer'
            && (
                metadata.arc_id === arc.arcId
                || metadata.active_arc === arc.arcId
                || (arc.arcId === 'lucifer-arc1' && String(metadata.active_arc || '') === '1')
                || (arc.arcId === 'lucifer-arc1' && metadata.active_arc === 'lucifer-arc1')
            );
        const currentWorldInfo = String(metadata.world_info || '').trim();
        const result = {
            arcId: arc.arcId,
            title: arc.title,
            chatSeedId,
            expectedWorldInfo,
            currentWorldInfo,
            sourceOk,
            visibleMessageCount: visibleMessages.length,
            firstVisibleMessageHash: hashText(visibleMessages[0]?.mes || ''),
            action: 'none',
            ok: false,
        };

        if (!sourceOk) {
            throw new Error(`${arc.arcId} seed source metadata is not the expected World-Forge Lucifer fixture`);
        }
        if (visibleMessages.length !== 1) {
            throw new Error(`${arc.arcId} seed has ${visibleMessages.length} visible messages; refusing to repair a possibly continued original chat`);
        }
        if (currentWorldInfo && currentWorldInfo !== expectedWorldInfo) {
            throw new Error(`${arc.arcId} seed world_info "${currentWorldInfo}" conflicts with expected "${expectedWorldInfo}"`);
        }
        if (!currentWorldInfo) {
            if (!repair) {
                result.action = 'needs-repair';
            } else {
                const repairedChat = [
                    {
                        ...rawChat[0],
                        chat_metadata: {
                            ...metadata,
                            world_info: expectedWorldInfo,
                            runtime_application_source: 'sillytavern-chat-metadata-world_info',
                            world_info_repaired_at: new Date().toISOString(),
                        },
                    },
                    ...rawChat.slice(1),
                ];
                await chatBridge.saveCharacterChat({
                    avatar: character.avatar,
                    characterName: character.id,
                    fileName: chatSeedId,
                    chat: repairedChat,
                });
                result.currentWorldInfo = expectedWorldInfo;
                result.action = 'repaired-missing-world_info';
            }
        } else {
            result.action = 'verified-existing-world_info';
        }
        result.ok = result.currentWorldInfo === expectedWorldInfo;
        results.push(result);
    }

    const evidence = {
        ok: results.every((result) => result.ok),
        generatedAt: new Date().toISOString(),
        baseUrl,
        repair,
        mode: 'sillytavern-original-chat-metadata-world-info-audit',
        nativeSillyTavernMechanism: 'chat_metadata.world_info -> world-info.js getChatLore() -> Generate()',
        results,
        safeguards: {
            onlyNamedLuciferSeedsTouched: true,
            refusedContinuedSeedChats: true,
            copiedPromptOrWorldbookBody: false,
            playerOrManifestStoryTextWritten: false,
            frozenBackendModified: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: evidence.ok,
        evidence: toRepoPath(evidencePath),
        repaired: results.filter((result) => result.action === 'repaired-missing-world_info').map((result) => result.arcId),
        verified: results.filter((result) => result.ok).map((result) => result.arcId),
    }, null, 2));
    if (!evidence.ok) {
        process.exitCode = 1;
    }
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        baseUrl,
        repair,
        error: error.message,
        stack: error.stack,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
}

function getVisibleMessages(rawChat) {
    return (Array.isArray(rawChat) ? rawChat : [])
        .slice(1)
        .filter((message) => message && !message.is_system && typeof message.mes === 'string' && message.mes.trim());
}

function hashText(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function normalizeBaseUrl(value) {
    return String(value || '').replace(/\/+$/, '');
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

function toRepoPath(value) {
    return path.relative(repoRoot, value).replace(/\\/g, '/');
}

function createCookieFetch(fetchImpl) {
    const cookies = new Map();
    return async (url, init = {}) => {
        const headers = new Headers(init.headers || {});
        if (cookies.size) {
            headers.set('cookie', [...cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; '));
        }
        const response = await fetchImpl(url, {
            ...init,
            headers,
        });
        collectSetCookies(response, cookies);
        return response;
    };
}

function collectSetCookies(response, cookies) {
    const setCookie = response.headers?.getSetCookie?.() || [];
    const fallback = response.headers?.get?.('set-cookie');
    const values = setCookie.length ? setCookie : (fallback ? [fallback] : []);
    for (const header of values) {
        const [pair] = String(header || '').split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) {
            cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
        }
    }
}
