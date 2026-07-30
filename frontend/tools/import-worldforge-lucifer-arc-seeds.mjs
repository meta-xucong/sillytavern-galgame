import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SillyTavernOriginalChatBridge } from '../shared/src/sillytavern-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(args['base-url'] || process.env.GALGAME_SILLYTAVERN_BASE_URL || 'http://127.0.0.1:8001');
const draftsDir = path.resolve(repoRoot, args['drafts-dir'] || '.codex-longrun/research/World-Forge/Samples/Drafts');
const evidencePath = path.resolve(repoRoot, args.evidence || '.codex-longrun/evidence/lucifer-arc-seed-import.json');
const sourceUrl = 'https://github.com/AndreiNicu/World-Forge';
const targetCharacter = {
    id: 'The Underworld & The Heavens',
    avatar: 'galgame_imported_lucifer_worlddirector.png',
};
const fetchWithCookies = createCookieFetch(globalThis.fetch);
const chatBridge = new SillyTavernOriginalChatBridge({
    baseUrl,
    fetchImpl: fetchWithCookies,
    now: () => new Date(),
});

const arcSeeds = [
    {
        arcId: 'lucifer-arc2',
        arcNumber: 2,
        title: '第二幕：地狱议会',
        chatSeedId: 'galgame-imported-lucifer-arc2-seed',
        sourceFile: 'Tier3_Arc2_Entries.md',
        sourceAnchors: [
            'Arc 2: The Revelation & The Romance',
            'First Real Intimacy',
            'The rain has stopped',
        ],
        message: [
            '*雨停后的洛杉矶像刚从一场漫长审讯里被放出来。顶层公寓的窗外，云层被清晨的光慢慢撕开，街面仍是湿的，但那种压在玻璃上的昏黄水汽终于散了。*',
            '',
            '*Anna 在沙发上醒来时，第一反应不是疼痛，也不是反胃。她躺了几秒，等那阵熟悉的戒断寒意从骨头里翻上来，可它没有来。三周。她已经三周没有碰那些东西了。这个数字小得可怜，又大得让她不敢相信。*',
            '',
            '*公寓也不一样了。椅背上多了一条她常用的毯子，厨房台面上放着一只没人立刻收走的杯子。Black 站在门边，手里拿着一份刚送来的文件；Bubbles 仍像一座沉默的墙，却把离她最近的那盏灯调暗了些。Andrei 站在窗前，没有回头，但 Anna 知道他已经醒着很久。*',
            '',
            '*安全这种东西对她来说向来可疑。可在这个早晨，它没有立刻索要代价。她看着 Andrei 的背影，第一次意识到自己不是只想活下去。她还想靠近。这个念头像一道细小的裂缝，安静，却足够改变整间屋子的温度。*',
            '',
            '可选行动：',
            '1. 让 Anna 先开口，承认自己今天醒来时没有发抖。',
            '2. 让 Andrei 转身，问她昨晚是不是真的睡着了。',
            '3. 让 Black 递上文件，打破这份短暂的安宁。',
        ].join('\n'),
    },
    {
        arcId: 'lucifer-arc3',
        arcNumber: 3,
        title: '第三幕：天界裂痕',
        chatSeedId: 'galgame-imported-lucifer-arc3-seed',
        sourceFile: 'Tier3_Arc3_Entries.md',
        sourceAnchors: [
            'Arc 3: The Sanctuary & The Gathering Storm',
            'Anna Moves In',
            "Timmy's room",
        ],
        message: [
            '*Anna 搬进顶层公寓时，只带了两个箱子。一个装衣服，一个装那些她舍不得丢的小东西：一本折角的旧书、Timmy 的恐龙玩具、几张边缘发白的照片。东西少得不像搬家，更像一个人终于承认自己可以留下。*',
            '',
            '*Timmy 的房间还闻得到新木头和洗过的床单。床上铺着恐龙图案的被套，窗边的书架空了一半，等着放进一个男孩真正会读的书。Bubbles 站在门口，手里捏着一只小得不合他尺寸的玩具恐龙，表情严肃得像在审判一件神器。Black 看了一眼安装说明书，语气平稳地指出床架少拧了两颗螺丝。*',
            '',
            '*Andrei 没有说“欢迎回家”。他说不出这种话。可他站在门口，看着 Anna 把牙刷放进浴室杯架，看着她把 Timmy 的玩具摆到床头。那种沉默不再像审判，更像承认。*',
            '',
            '*远处的城市仍旧明亮，天界的寒意像看不见的裂痕悬在高空。战争还没有到来，但所有人都听见了它的脚步。Anna 把最后一本书放上架子，转身看向 Andrei。这个房间是给 Timmy 的，也是给他们所有人的一个赌注。*',
            '',
            '可选行动：',
            '1. 让 Anna 询问 Andrei 是否真的相信 Timmy 会住进这里。',
            '2. 让 Black 说明外面的局势已经开始恶化。',
            '3. 让 Bubbles 把恐龙玩具放到床头，表达他的笨拙保护。',
        ].join('\n'),
    },
    {
        arcId: 'lucifer-arc4',
        arcNumber: 4,
        title: '第四幕：晨星审判',
        chatSeedId: 'galgame-imported-lucifer-arc4-seed',
        sourceFile: 'Tier3_Arc4_Entries.md',
        sourceAnchors: [
            'Arc 4: The Succession & The Miracle',
            'Confronting Ingrid',
            'Pasadena',
        ],
        message: [
            '*Pasadena 的早晨干净得近乎残忍。修剪整齐的草坪、擦得发亮的窗户、车道上那辆一尘不染的 Volvo，一切都像在努力证明这个家从来没有伤害过任何人。Anna 站在人行道边，看着那扇她曾经无数次害怕打开的门。*',
            '',
            '*Timmy 就在里面。这个事实比天界和地狱的战争都更具体，也更沉。Anna 的手指微微收紧，随后又松开。她没有回头看 Andrei，却能感觉到他在她身侧的静止：危险、耐心、完全听她决定。Black 和 Bubbles 留在车边，没有靠近。今天不是一次处刑。今天是一次回家。*',
            '',
            '*门铃响起之前，屋里传来很轻的脚步声。薰衣草和消毒水的味道似乎已经穿过门缝渗出来，那是 Anna 童年里最熟悉的秩序，也是 Ingrid 最擅长使用的武器。Anna 抬起手，停在门铃前。她终于明白，自己不是来请求允许的。*',
            '',
            '*她按下门铃。屋内的脚步声停了。*',
            '',
            '可选行动：',
            '1. 让 Anna 先对 Andrei 说明：无论发生什么，都不要替她复仇。',
            '2. 让 Andrei 保持沉默，只在门打开时站到她身侧。',
            '3. 让 Ingrid 开门，用温和而锋利的语气迎接他们。',
        ].join('\n'),
    },
];

await mkdir(path.dirname(evidencePath), { recursive: true });

try {
    const sourceEvidence = await verifySourceMaterials();
    const beforeChats = await chatBridge.listCharacterChats(targetCharacter);
    const arc1Seed = await readExistingArc1Seed();
    const importedSeeds = [];

    for (const seed of arcSeeds) {
        const expectedMessageHash = hashText(seed.message);
        assert.notEqual(expectedMessageHash, arc1Seed.messageHash, `${seed.arcId} opening must not copy Arc1 seed text`);
        assert.equal(containsForbiddenAuthoringText(seed.message), false, `${seed.arcId} opening contains source metadata/instructions`);

        const existing = await readExistingSeed(seed, beforeChats);
        let action = 'created';
        if (existing.exists) {
            const verification = verifyExistingSeedMatches(seed, existing, expectedMessageHash);
            if (verification.needsMetadataRepair) {
                const chat = buildSeedChat(seed, expectedMessageHash);
                await chatBridge.saveCharacterChat({
                    avatar: targetCharacter.avatar,
                    characterName: targetCharacter.id,
                    fileName: seed.chatSeedId,
                    chat,
                });
                action = 'repaired-existing-metadata';
            } else {
                action = 'skipped-existing-identical';
            }
        } else {
            const chat = buildSeedChat(seed, expectedMessageHash);
            await chatBridge.saveCharacterChat({
                avatar: targetCharacter.avatar,
                characterName: targetCharacter.id,
                fileName: seed.chatSeedId,
                chat,
            });
        }
        const readback = await chatBridge.loadSpecificBoundChat({
            sillyTavernBindings: {
                characters: [{ id: targetCharacter.id, role: 'narrator', avatar: targetCharacter.avatar }],
                chatSeedId: seed.chatSeedId,
            },
            story: { mode: 'sillytavern-live' },
        }, seed.chatSeedId);
        assert.equal(readback.ok, true, `${seed.arcId} seed readback failed`);
        assert.equal(readback.fileName, seed.chatSeedId, `${seed.arcId} seed file id mismatch`);
        assert.equal(readback.messages.length, 1, `${seed.arcId} seed should contain exactly one visible opening line`);
        assert.equal(readback.messages[0].role, 'character', `${seed.arcId} seed opening must be an original character line`);
        assert.equal(readback.messages[0].text, seed.message, `${seed.arcId} seed readback text mismatch`);
        assert.equal(readback.rawChat[0]?.chat_metadata?.world_info, getSeedWorldBookName(seed), `${seed.arcId} seed must bind original chat lorebook`);

        importedSeeds.push({
            arcId: seed.arcId,
            title: seed.title,
            chatSeedId: seed.chatSeedId,
            worldInfoRef: getSeedWorldBookName(seed),
            targetCharacter,
            sourceFile: toRepoPath(path.join(draftsDir, seed.sourceFile)),
            sourceAnchors: seed.sourceAnchors,
            action,
            messageHash: expectedMessageHash,
            messagePreview: seed.message.slice(0, 180),
            readback: {
                ok: readback.ok,
                fileName: readback.fileName,
                messageCount: readback.messages.length,
                firstRole: readback.messages[0]?.role,
                chatMetadataWorldInfo: readback.rawChat[0]?.chat_metadata?.world_info || '',
            },
        });
    }

    const afterChats = await chatBridge.listCharacterChats(targetCharacter);
    const afterIds = afterChats.map((chat) => chat.fileId);
    for (const seed of arcSeeds) {
        assert.equal(afterIds.includes(seed.chatSeedId), true, `${seed.arcId} seed not listed after import`);
    }

    const evidence = {
        ok: true,
        generatedAt: new Date().toISOString(),
        baseUrl,
        source: sourceUrl,
        draftsDir: toRepoPath(draftsDir),
        mode: 'sillytavern-original-chat-seed-import',
        importedViaExistingSillyTavernChatApi: true,
        targetCharacter,
        beforeChatCount: beforeChats.length,
        afterChatCount: afterChats.length,
        importedSeeds,
        sourceEvidence,
        safeguards: {
            arc1SeedCopiedOrRenamed: false,
            manifestMutatedByImporter: false,
            playerCodeMutatedByImporter: false,
            lorebookMetadataInsertedIntoPlayerChat: false,
            whatTheLlmShouldDoInsertedIntoPlayerChat: false,
            futureBeatListInsertedIntoPlayerChat: false,
            localScriptedFallbackCreated: false,
        },
    };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), 'utf8');
    console.log(JSON.stringify({
        ok: true,
        evidence: toRepoPath(evidencePath),
        importedSeeds: importedSeeds.map((seed) => ({
            arcId: seed.arcId,
            chatSeedId: seed.chatSeedId,
            readback: seed.readback.ok,
        })),
    }, null, 2));
} catch (error) {
    await writeFile(evidencePath, JSON.stringify({
        ok: false,
        generatedAt: new Date().toISOString(),
        baseUrl,
        error: error.message,
        stack: error.stack,
    }, null, 2), 'utf8').catch(() => {});
    throw error;
}

async function verifySourceMaterials() {
    const evidence = [];
    for (const seed of arcSeeds) {
        const sourcePath = path.join(draftsDir, seed.sourceFile);
        const text = await readFile(sourcePath, 'utf8');
        const missingAnchors = seed.sourceAnchors.filter((anchor) => !text.includes(anchor));
        assert.deepEqual(missingAnchors, [], `${seed.sourceFile} missing anchors: ${missingAnchors.join(', ')}`);
        evidence.push({
            arcId: seed.arcId,
            sourceFile: toRepoPath(sourcePath),
            anchorsFound: seed.sourceAnchors,
            sourceHash: hashText(text),
        });
    }
    return evidence;
}

async function readExistingArc1Seed() {
    const readback = await chatBridge.loadSpecificBoundChat({
        sillyTavernBindings: {
            characters: [{ id: targetCharacter.id, role: 'narrator', avatar: targetCharacter.avatar }],
            chatSeedId: 'galgame-imported-lucifer-seed',
        },
        story: { mode: 'sillytavern-live' },
    }, 'galgame-imported-lucifer-seed').catch(() => null);
    return {
        exists: Boolean(readback?.ok),
        messageHash: hashText(readback?.messages?.[0]?.text || ''),
    };
}

async function readExistingSeed(seed, chats) {
    const existsInList = chats.some((chat) => normalizeChatFileId(chat.fileId || chat.fileName) === seed.chatSeedId);
    if (!existsInList) {
        return { exists: false };
    }
    const rawChat = await chatBridge.getCharacterChat({
        avatar: targetCharacter.avatar,
        fileName: seed.chatSeedId,
    });
    const header = rawChat[0]?.chat_metadata ? rawChat[0] : {};
    const visibleMessages = Array.isArray(rawChat)
        ? rawChat.slice(1).filter((message) => message && !message.is_system && typeof message.mes === 'string' && message.mes.trim())
        : [];
    return {
        exists: true,
        rawChat,
        metadata: header.chat_metadata || {},
        visibleMessages,
        messageHash: hashText(visibleMessages[0]?.mes || ''),
    };
}

function verifyExistingSeedMatches(seed, existing, expectedMessageHash) {
    const metadata = existing.metadata || {};
    const errors = [];
    const repairableMetadata = [];
    if (metadata.imported_source !== sourceUrl) {
        errors.push(`metadata.imported_source mismatch: ${metadata.imported_source || '<empty>'}`);
    }
    if (metadata.arc_id !== seed.arcId) {
        errors.push(`metadata.arc_id mismatch: ${metadata.arc_id || '<empty>'}`);
    }
    if (metadata.seed_kind !== 'independent-original-sillytavern-opening-chat') {
        errors.push(`metadata.seed_kind mismatch: ${metadata.seed_kind || '<empty>'}`);
    }
    if (metadata.opening_message_hash && metadata.opening_message_hash !== expectedMessageHash) {
        errors.push('metadata.opening_message_hash mismatch');
    }
    if (!metadata.opening_message_hash) {
        repairableMetadata.push('opening_message_hash');
    }
    const expectedWorldInfo = getSeedWorldBookName(seed);
    if (metadata.world_info !== expectedWorldInfo) {
        if (!metadata.world_info) {
            repairableMetadata.push('world_info');
        } else {
            errors.push(`metadata.world_info mismatch: ${metadata.world_info}`);
        }
    }
    if (existing.visibleMessages.length !== 1) {
        errors.push(`visible message count is ${existing.visibleMessages.length}, expected 1`);
    }
    if (existing.messageHash !== expectedMessageHash) {
        errors.push('opening message hash mismatch');
    }
    if (errors.length) {
        throw new Error([
            `SEED_CONFLICT_${seed.arcId}`,
            `Existing original SillyTavern chat seed "${seed.chatSeedId}" differs from the importer source mapping.`,
            'Refusing to overwrite. Resolve manually in the administrator workflow.',
            ...errors,
        ].join(' | '));
    }
    return {
        needsMetadataRepair: repairableMetadata.length > 0,
        repairableMetadata,
    };
}

function buildSeedChat(seed, messageHash) {
    return [
        {
            chat_metadata: {
                imported_source: sourceUrl,
                source_sample: 'Samples/Drafts',
                fixture: 'worldforge-lucifer',
                arc_id: seed.arcId,
                arc_number: seed.arcNumber,
                arc_title: seed.title,
                seed_kind: 'independent-original-sillytavern-opening-chat',
                source_files: [seed.sourceFile],
                opening_message_hash: messageHash,
                world_info: getSeedWorldBookName(seed),
                runtime_application_source: 'sillytavern-chat-metadata-world_info',
                imported_at: new Date().toISOString(),
            },
            user_name: 'Andrei',
            character_name: targetCharacter.id,
        },
        {
            name: targetCharacter.id,
            is_user: false,
            is_system: false,
            send_date: new Date(`2026-07-25T0${seed.arcNumber}:00:00.000Z`).toISOString(),
            mes: seed.message,
            extra: {},
        },
    ];
}

function getSeedWorldBookName(seed) {
    return `Galgame_Imported_Lucifer_Arc${seed.arcNumber}_Bundle`;
}

function containsForbiddenAuthoringText(value) {
    return /SillyTavern Lorebook metadata|What the LLM should do|ENTRY:|DRAMATIC_BEAT|ARC_STATE|Trigger Keys|future beat/i.test(String(value || ''));
}

function normalizeChatFileId(value) {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        .replace(/\.jsonl$/i, '')
        .trim();
}

function hashText(value) {
    return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
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
    cookieFetch.remember = remember;
    cookieFetch.cookieHeader = cookieHeader;
    return cookieFetch;
}

function splitSetCookieHeader(value) {
    return String(value || '').split(/,(?=\s*[^;,=\s]+=)/g).map((item) => item.trim()).filter(Boolean);
}

function parseArgs(values) {
    const parsed = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        parsed[value.slice(2)] = values[index + 1];
        index += 1;
    }
    return parsed;
}

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function toRepoPath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}
