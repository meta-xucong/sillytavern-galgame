import { extractSuggestedActionsFromOriginalText } from './sillytavern-adapter.js?v=auto-2a72e2a79a23';
import {
    ADAPTIVE_EXTRACTION_RESULT_PROTOCOL_VERSION,
    createDefaultAdaptivePresentationProfile,
    isPresentationModule,
    normalizeAdaptivePresentationProfile,
    validateAdaptiveExtractionResult,
    validateAdaptivePresentationProfile,
} from './adaptive-presentation-schema.js?v=auto-2a72e2a79a23';

export const ADAPTIVE_PRESENTATION_AGGREGATE_VERSION = 'galgame.adaptive-presentation-result-set.v1';
const MAX_ADAPTIVE_VISIBLE_TEXT_LENGTH = 16000;

const BUILTIN_CONFIGURATION_SOURCE = Object.freeze({ kind: 'builtin-pattern' });

const KNOWN_SECTION_HEADINGS = new Set([
    'hp',
    'mp',
    'ac',
    'level',
    'xp',
    'gold',
    'status',
    '状态',
    'inventory',
    'items',
    'equipment',
    'weapon',
    'weapons',
    'weapons/shield',
    'attacks',
    'attack',
    '背包',
    '物品',
    '道具',
    '装备',
    '武器',
    '攻击',
    'abilities',
    'skills',
    'spells',
    '技能',
    '能力',
    '法术',
    'quests',
    'quest',
    '任务',
    'objectives',
    'objective',
    '目标',
    'clues',
    'clue',
    '线索',
    '证据',
    'locations',
    'location',
    '地点',
    '位置',
    'actions',
    '可选行动',
    '行动建议',
    '下一步',
]);

const INVENTORY_GROUPS = Object.freeze({
    weapons: { id: 'weapons', title: '武器', tone: 'danger' },
    keyItems: { id: 'keyItems', title: '关键物品', tone: 'gold' },
    supplies: { id: 'supplies', title: '补给', tone: 'safe' },
    materials: { id: 'materials', title: '材料', tone: 'item' },
    containers: { id: 'containers', title: '容器', tone: 'neutral' },
    miscellaneous: { id: 'miscellaneous', title: '杂物', tone: 'neutral' },
    uncategorized: { id: 'uncategorized', title: '未分类记录', tone: 'neutral' },
});

const INVENTORY_SECTION_LABELS = Object.freeze([
    'Inventory',
    'Items',
    'Equipment',
    'Weapons',
    'Weapons/shield',
    'Weapon',
    'Attacks',
    'Attack',
    '背包',
    '物品',
    '道具',
    '装备',
    '武器',
    '攻击',
]);

const ABILITY_TRANSLATIONS = new Map([
    ['acrobatics', ['体操', '探索']],
    ['animal handling', ['驯兽', '探索']],
    ['arcana', ['奥秘', '魔法']],
    ['athletics', ['运动', '探索']],
    ['deception', ['欺瞒', '社交']],
    ['history', ['历史', '知识']],
    ['insight', ['洞悉', '社交']],
    ['intimidation', ['威吓', '社交']],
    ['investigation', ['调查', '知识']],
    ['medicine', ['医药', '知识']],
    ['nature', ['自然', '知识']],
    ['perception', ['察觉', '探索']],
    ['performance', ['表演', '社交']],
    ['persuasion', ['游说', '社交']],
    ['religion', ['宗教', '知识']],
    ['sleight of hand', ['巧手', '探索']],
    ['stealth', ['潜行', '探索']],
    ['survival', ['求生', '探索']],
]);

export function extractAdaptivePresentation(input, {
    profile = createDefaultAdaptivePresentationProfile(),
    chatId = '',
    messageIndex = 0,
} = {}) {
    const normalizedProfile = normalizeAdaptivePresentationProfile(profile);
    const profileValidation = validateAdaptivePresentationProfile(normalizedProfile);
    const messages = normalizeVisibleMessages(input, normalizedProfile.extractionPolicy.maxRecentMessages, {
        chatId,
        messageIndex,
    });
    const threshold = normalizedProfile.extractionPolicy.confidenceThreshold;
    const candidates = [];

    for (const message of messages) {
        const text = sanitizeVisibleText(message.text, MAX_ADAPTIVE_VISIBLE_TEXT_LENGTH);
        if (!text) {
            continue;
        }
        if (normalizedProfile.extractionPolicy.allowBuiltinPatterns) {
            candidates.push(...runBuiltinExtractors(text, message, normalizedProfile));
        }
        if (normalizedProfile.extractionPolicy.allowAdminPatterns) {
            candidates.push(...runAdminPatternExtractors(text, message, normalizedProfile));
        }
    }

    const results = mergeResults(candidates)
        .filter((result) => result.confidence >= threshold)
        .filter((result) => validateAdaptiveExtractionResult(result).valid);

    return {
        schemaVersion: ADAPTIVE_PRESENTATION_AGGREGATE_VERSION,
        ok: profileValidation.valid,
        profileId: normalizedProfile.profileId,
        template: normalizedProfile.template,
        lowConfidenceBehavior: normalizedProfile.extractionPolicy.lowConfidenceBehavior,
        results,
        moduleIds: [...new Set(results.map((result) => result.module))],
        errors: profileValidation.errors,
        warnings: profileValidation.warnings,
    };
}

export function extractAdaptivePresentationFromText(text, options = {}) {
    return extractAdaptivePresentation([{ text, messageIndex: options.messageIndex ?? 0, chatId: options.chatId || '' }], options);
}

function runBuiltinExtractors(text, message, profile) {
    const results = [];
    const push = (result) => {
        if (result && isModuleEnabled(profile, result.module)) {
            results.push(result);
        }
    };

    push(extractActions(text, message));
    push(extractRpgStatus(text, message));
    push(extractInventory(text, message));
    push(extractAbilities(text, message));
    push(extractListModule(text, message, 'gifts', ['Gifts?', '礼物', '赠礼'], 'gifts'));
    push(extractListModule(text, message, 'events', ['Events?', 'Memories?', '事件', '回忆'], 'events'));
    push(extractListModule(text, message, 'quests', ['Quest', 'Quests', '任务'], 'quests'));
    push(extractListModule(text, message, 'objectives', ['Objective', 'Objectives', 'Goal', 'Goals', '当前目标', '目标'], 'objectives'));
    push(extractListModule(text, message, 'clues', ['Clue', 'Clues', 'Evidence', '线索', '证据'], 'clues'));
    push(extractNamedListModule(text, message, 'suspects', ['Suspect', 'Suspects', '嫌疑人', '相关人物'], 'suspects'));
    push(extractListModule(text, message, 'locations', ['Location', 'Locations', 'Place', 'Places', '地点', '位置'], 'locations'));
    push(extractListModule(text, message, 'factions', ['Faction', 'Factions', '阵营', '势力'], 'factions'));
    push(extractRelationship(text, message));
    push(extractAffection(text, message));
    push(extractResources(text, message));
    push(extractCalendar(text, message));
    push(extractDice(text, message));

    return results;
}

function runAdminPatternExtractors(text, message, profile) {
    const results = [];
    for (const pattern of profile.adminPatterns) {
        if (!isModuleEnabled(profile, pattern.module)) {
            continue;
        }
        const regex = createPatternRegex(pattern);
        if (!regex) {
            continue;
        }
        const matches = [];
        for (const match of text.matchAll(regex)) {
            const fields = {};
            pattern.fields.forEach((field, index) => {
                fields[field] = sanitizeVisibleText(match[index + 1] || '');
            });
            if (Object.values(fields).some(Boolean)) {
                matches.push({ fields, raw: sanitizeVisibleText(match[0] || '') });
            }
        }
        if (matches.length) {
            results.push(createResult(pattern.module, pattern.confidence || 0.86, message, {
                matches,
            }, {
                kind: 'admin-profile',
                profileId: profile.profileId,
                patternId: pattern.id,
            }));
        }
    }
    return results;
}

function extractActions(text, message) {
    const extracted = extractSuggestedActionsFromOriginalText(text, { maxActions: 4 });
    if (!Array.isArray(extracted.suggestedActions) || extracted.suggestedActions.length < 2) {
        return null;
    }
    return createResult('actions', 0.95, message, {
        actions: extracted.suggestedActions.map((action) => ({
            label: sanitizeVisibleText(action.label || action.value || ''),
            value: sanitizeVisibleText(action.value || action.label || ''),
        })).filter((action) => action.value),
    });
}

function extractRpgStatus(text, message) {
    const lines = splitLines(text);
    const fields = {};
    for (const line of lines) {
        assignNumberPair(fields, 'hp', line, /^(?:❤\s*)?(?:HP|生命|体力|生命值)\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i);
        assignNumberPair(fields, 'mp', line, /^(?:MP|魔力|法力)\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i);
        assignNumber(fields, 'ac', line, /^(?:⛨\s*)?(?:AC|护甲|防御)\s*[:：]\s*(\d+)/i);
        assignNumber(fields, 'level', line, /^(?:🏅\s*)?(?:Level|等级)\s*[:：]\s*(\d+)/i);
        assignNumberPair(fields, 'xp', line, /^(?:📈\s*)?(?:XP|经验)\s*[:：]\s*(\d+)(?:\s*\/\s*(\d+))?/i);
        assignNumber(fields, 'gold', line, /^(?:💰\s*)?(?:Gold|金币|金钱)\s*[:：]\s*([\d,]+)/i);
        assignText(fields, 'status', line, /^(?:📃\s*)?(?:Status|状态)\s*[:：]\s*(.+)$/i);
    }
    const turnOrder = extractTurnOrder(lines);
    if (turnOrder) {
        fields.turnOrder = turnOrder;
    }
    if (!fields.status) {
        const statusEntries = collectModuleEntries(text, ['Status', '状态']);
        if (statusEntries.length) {
            fields.status = {
                label: statusEntries.join('；'),
                raw: statusEntries.join('；'),
            };
        }
    }
    const count = Object.keys(fields).length;
    if (!count) {
        return null;
    }
    return createResult('rpg-status', count >= 2 ? 0.96 : 0.78, message, {
        fields,
        groups: createStatusGroups(fields),
    });
}

function extractTurnOrder(lines) {
    let order = null;
    let current = null;
    for (const line of lines) {
        const orderMatch = line.match(/(?:行动顺序|先攻顺序|回合顺序|initiative(?:\s+order)?|turn\s+order)\s*[:：]\s*([^。；;]+?)(?=(?:\s+(?:当前)?轮到)|[。；;]|$)/iu);
        if (orderMatch) {
            const names = orderMatch[1]
                .split(/\s*(?:>|→|＞|、|,|，|->)\s*/u)
                .map((value) => sanitizeVisibleText(value).replace(/^[\s*_`~]+|[\s*_`~]+$/gu, '').trim())
                .filter(Boolean);
            if (names.length >= 2) {
                order = {
                    label: names.join(' → '),
                    value: names.join(' → '),
                    names,
                    raw: line,
                };
            }
            continue;
        }
        const currentMatch = line.match(/(?:当前)?\s*(?:轮到|行动者|current\s+turn)\s*[:：]?\s*(.+?)(?:的)?(?:行动|回合|turn)(?=\s*(?:[。；;]|$))/iu);
        if (currentMatch) {
            const value = sanitizeVisibleText(currentMatch[1]).trim();
            if (value) {
                current = value;
            }
        }
    }
    if (!order && !current) {
        return null;
    }
    return {
        label: order?.label || current,
        value: order?.value || current,
        names: order?.names || (current ? [current] : []),
        current,
        raw: order?.raw || `当前轮到${current}行动`,
    };
}

function extractInventory(text, message) {
    const rawEntries = collectInventoryEntries(text, INVENTORY_SECTION_LABELS);
    if (!rawEntries.length) {
        return null;
    }
    const items = normalizeInventoryEntries(rawEntries);
    return createResult('inventory', items.length >= 2 ? 0.92 : 0.82, message, {
        items,
        groups: groupInventoryItems(items),
    });
}

function extractAbilities(text, message) {
    const rawEntries = collectModuleEntries(text, ['Abilities', 'Skills', 'Spells', '技能', '能力', '法术']);
    if (!rawEntries.length) {
        return null;
    }
    const abilities = rawEntries.map(parseAbilityItem).filter((item) => item.label);
    return createResult('abilities', abilities.length >= 2 ? 0.92 : 0.82, message, {
        abilities,
        groups: groupAbilityItems(abilities),
    });
}

function extractListModule(text, message, module, labels, valueKey) {
    const entries = [];
    for (const value of collectModuleEntries(text, labels)) {
        entries.push({ label: value, raw: value });
    }
    if (!entries.length) {
        return null;
    }
    return createResult(module, entries.length >= 2 ? 0.9 : 0.8, message, {
        [valueKey]: entries,
    });
}

function extractNamedListModule(text, message, module, labels, valueKey) {
    const entries = [];
    for (const line of splitLines(text)) {
        const value = matchKeyValue(line, labels);
        if (!value) {
            continue;
        }
        entries.push(...splitList(value).map(parseNamedValue));
    }
    if (!entries.length) {
        return null;
    }
    return createResult(module, entries.length >= 2 ? 0.9 : 0.82, message, {
        [valueKey]: entries,
    });
}

function normalizeInventoryEntries(rawEntries) {
    const items = [];
    let current = null;
    for (const rawEntry of rawEntries) {
        if (rawEntry?.kind === 'boundary') {
            current = null;
            continue;
        }
        const entry = normalizeInventoryRawEntry(rawEntry);
        if (!entry) {
            continue;
        }
        if (current && shouldAttachInventoryTrait(entry, current)) {
            addInventoryTrait(current, entry);
            continue;
        }
        current = parseInventoryItem(entry);
        items.push(current);
    }
    return mergeInventoryItems(items).map(finalizeInventoryItem);
}

function normalizeInventoryRawEntry(value) {
    const rawValue = typeof value === 'object' && value ? value.value : value;
    return sanitizeVisibleText(rawValue)
        .replace(/^[\-*•]\s*/u, '')
        .replace(/^[\dA-Za-z]\.\s+/u, '')
        .replace(/^[*_`~]+|[*_`~]+$/gu, '')
        .trim();
}

function parseInventoryItem(raw) {
    const text = sanitizeVisibleText(raw);
    if (looksInventoryTrait(text)) {
        return {
            label: text,
            raw: text,
            category: 'uncategorized',
            kind: 'uncategorized',
            traits: [],
            tags: [],
            pendingTraits: false,
        };
    }
    const keyed = text.match(/^(.+?)\s*[:：]\s*(.+)$/u);
    if (keyed) {
        const label = sanitizeVisibleText(keyed[1]);
        const traits = splitInventoryTraits(keyed[2]);
        const category = classifyInventoryItem(label, traits, text);
        return {
            label,
            raw: text,
            category,
            kind: category,
            traits,
            tags: traits,
            pendingTraits: false,
        };
    }
    const paren = text.match(/^(.+?)[（(](.+)$/u);
    const label = sanitizeVisibleText(paren ? paren[1] : text);
    const traits = paren ? splitInventoryTraits(paren[2]) : [];
    const category = classifyInventoryItem(label, traits, text);
    return {
        label,
        raw: text,
        category,
        kind: category,
        traits,
        tags: traits,
        pendingTraits: Boolean(paren && !/[）)]/u.test(text)),
    };
}

function finalizeInventoryItem(item) {
    const traits = uniqueArray((item.traits || []).map((trait) => sanitizeVisibleText(trait)).filter(Boolean));
    return {
        label: item.label,
        raw: item.raw,
        category: item.category,
        kind: item.kind,
        traits,
        tags: uniqueArray([...(item.tags || []), ...traits].filter(Boolean)),
    };
}

function shouldAttachInventoryTrait(entry, current) {
    if (!current) {
        return false;
    }
    if (current.pendingTraits) {
        return true;
    }
    return looksInventoryTrait(entry) && current.category === 'weapons';
}

function addInventoryTrait(item, rawTrait) {
    const raw = sanitizeVisibleText(rawTrait);
    const cleanTrait = raw.replace(/[）)]$/u, '').trim();
    if (!cleanTrait) {
        return;
    }
    item.raw = `${item.raw} ${cleanTrait}`;
    item.traits = uniqueArray([...(item.traits || []), ...splitInventoryTraits(cleanTrait)]);
    item.tags = uniqueArray([...(item.tags || []), ...item.traits]);
    if (/[）)]$/u.test(raw)) {
        item.pendingTraits = false;
    }
}

function splitInventoryTraits(value) {
    return sanitizeVisibleText(value)
        .replace(/[（(]/gu, ';')
        .replace(/[）)]$/u, '')
        .replace(/[）)]/gu, '')
        .split(/[，,、;；|]/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function looksInventoryTrait(value) {
    return /^(?:轻型|重型|双手|双持|灵巧|投掷\s*\d+\/\d+|射程\s*\d+\/\d+|品质|低劣|普通|精良|light|heavy|two-handed|finesse|thrown|range|poor|common|fine)\b/iu.test(value);
}

function classifyInventoryItem(label, traits, raw) {
    const text = `${label} ${traits.join(' ')} ${raw}`.toLowerCase();
    if (/(?:explorer'?s pack|backpack|pack|pouch|satchel|袋|包|背包|行囊)/iu.test(text)) {
        return 'containers';
    }
    if (/(?:\b\d+d\d+\b|piercing|slashing|bludgeoning|shortsword|dagger|bow|sword|scimitar|blade|knife|穿刺|挥砍|钝击|短刀|弯刀|剑|弓|匕首|武器)/iu.test(text)) {
        return 'weapons';
    }
    if (/(?:徽记|钥匙|信件|铃|护符|地图|契约|证物|标记|crest|key|letter|map|token|bell|amulet|contract|evidence)/iu.test(text)) {
        return 'keyItems';
    }
    if (/(?:火把|口粮|水袋|绳索|药水|工具|torch|ration|rations|rope|potion|kit|waterskin|tinderbox)/iu.test(text)) {
        return 'supplies';
    }
    if (/(?:羽毛|碎片|骨|布料|草药|feather|shard|bone|cloth|herb|ore|gem)/iu.test(text)) {
        return 'materials';
    }
    return label ? 'miscellaneous' : 'uncategorized';
}

function groupInventoryItems(items) {
    return Object.values(INVENTORY_GROUPS)
        .map((group) => ({
            ...group,
            items: items.filter((item) => item.category === group.id),
        }))
        .filter((group) => group.items.length);
}

function collectInventoryEntries(text, labels) {
    const lines = splitLines(text);
    const entries = [];
    let collecting = false;
    for (const line of lines) {
        const value = matchKeyValue(line, labels);
        if (value) {
            entries.push({ kind: 'boundary' });
            entries.push(...splitList(value).map((item) => ({ kind: 'entry', value: item })));
            collecting = false;
            continue;
        }
        if (isStandaloneSectionHeading(line, labels)) {
            entries.push({ kind: 'boundary' });
            collecting = true;
            continue;
        }
        if (collecting && isKnownSectionHeading(line)) {
            collecting = false;
            continue;
        }
        if (collecting) {
            entries.push({ kind: 'entry', value: line });
        }
    }
    return entries.filter((item) => item.kind === 'boundary' || sanitizeVisibleText(item.value));
}

function mergeInventoryItems(items) {
    const merged = [];
    const byKey = new Map();
    for (const item of items) {
        const key = `${item.category}:${normalizeInventoryMergeKey(item.label)}`;
        const existing = byKey.get(key);
        if (!existing || !item.label) {
            merged.push(item);
            if (item.label) {
                byKey.set(key, item);
            }
            continue;
        }
        existing.raw = uniqueArray([existing.raw, item.raw].filter(Boolean)).join('\n');
        existing.traits = uniqueArray([...(existing.traits || []), ...(item.traits || [])]);
        existing.tags = uniqueArray([...(existing.tags || []), ...(item.tags || []), ...(item.traits || [])]);
        existing.pendingTraits = Boolean(existing.pendingTraits || item.pendingTraits);
    }
    return merged;
}

function normalizeInventoryMergeKey(value) {
    return sanitizeVisibleText(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function createStatusGroups(fields) {
    const entries = splitStatusEntries(fields.status?.label || '');
    const groups = [];
    const push = (id, title, tone, items) => {
        const normalizedItems = items.map((item) => typeof item === 'string'
            ? { label: item, raw: item }
            : item).filter((item) => item?.label);
        if (normalizedItems.length) {
            groups.push({ id, title, tone, items: normalizedItems });
        }
    };

    push('body', '身体状态', 'danger', [
        fields.hp ? { label: `HP ${fields.hp.current}${fields.hp.max ? `/${fields.hp.max}` : ''}`, raw: fields.hp.raw, emphasis: true } : null,
        ...entries.filter(isBodyStatus),
    ].filter(Boolean));
    push('party', '队伍', 'ally', entries.filter(isPartyStatus));
    push('threats', '威胁', 'danger', entries.filter(isThreatStatus));
    push('clues', '已知线索', 'magic', entries.filter(isClueStatus));
    push('events', '环境变化', 'neutral', entries.filter(isEventStatus));
    push('resources', '资源', 'gold', [
        fields.gold ? { label: `金币 ${fields.gold.value}`, raw: fields.gold.raw } : null,
        fields.xp ? { label: `经验 ${fields.xp.current}${fields.xp.max ? `/${fields.xp.max}` : ''}`, raw: fields.xp.raw } : null,
    ].filter(Boolean));
    push('turn-order', '行动顺序', 'initiative', [
        fields.turnOrder ? { label: fields.turnOrder.label, raw: fields.turnOrder.raw, emphasis: true } : null,
        fields.turnOrder?.current ? { label: `当前：${fields.turnOrder.current}`, raw: fields.turnOrder.raw } : null,
    ].filter(Boolean));

    const classified = new Set(groups.flatMap((group) => group.items.map((item) => item.raw || item.label)));
    push('other', '其他记录', 'neutral', entries.filter((entry) => !classified.has(entry)));
    return groups;
}

function splitStatusEntries(value) {
    return sanitizeVisibleText(value)
        .split(/[;；。]/u)
        .map((item) => item.trim())
        .filter(Boolean);
}

function isBodyStatus(value) {
    return /(?:重伤|受伤|流血|中毒|诅咒|疲惫|濒死|可行动|healthy|wounded|poisoned|cursed|injured)/iu.test(value);
}

function isPartyStatus(value) {
    return /(?:加入队伍|同行|队友|同伴|party|joined|ally|companion)/iu.test(value);
}

function isThreatStatus(value) {
    return /(?:悬赏|追捕|通缉|敌对|黑喙|威胁|bounty|wanted|hunted|hostile)/iu.test(value);
}

function isClueStatus(value) {
    return /(?:鉴定|线索|证据|银铃|弯刀|效果|未知|identified|clue|evidence|unknown|magic)/iu.test(value);
}

function isEventStatus(value) {
    return /(?:远处|接近|天气|夜行|商队|环境|approach|nearby|distant|weather|caravan)/iu.test(value);
}

function parseAbilityItem(value) {
    const raw = sanitizeVisibleText(value).replace(/^[\-*•]\s*/u, '');
    const match = raw.match(/^(.+?)(?:\s*[:：]\s*|\s+)([+-]\d+|熟练|精通|proficient|expertise|available|unavailable|未知)(?:\s*[（(](.+?)[）)])?$/iu);
    const name = sanitizeVisibleText(match ? match[1] : raw);
    const translated = translateAbilityName(name);
    const valueLabel = sanitizeVisibleText(match?.[2] || '');
    const note = sanitizeVisibleText(match?.[3] || '');
    return {
        label: translated.label,
        name: translated.label,
        value: valueLabel,
        raw,
        category: translated.category,
        kind: 'ability',
        originalName: translated.originalName,
        tags: [valueLabel, note].filter(Boolean),
        tone: translated.category === '魔法' ? 'magic' : 'skill',
    };
}

function translateAbilityName(name) {
    const normalized = sanitizeVisibleText(name).toLowerCase();
    const exact = ABILITY_TRANSLATIONS.get(normalized);
    if (exact) {
        return { label: exact[0], category: exact[1], originalName: name };
    }
    for (const [key, [label, category]] of ABILITY_TRANSLATIONS.entries()) {
        if (normalized.includes(key)) {
            return { label, category, originalName: name };
        }
    }
    if (/(?:spell|arcana|magic|法术|奥秘|魔法|共鸣)/iu.test(name)) {
        return { label: name, category: '魔法', originalName: name };
    }
    if (/(?:weapon|armor|fighting|surge|wind|短刃|轻甲|熟练|战斗|武器|护甲)/iu.test(name)) {
        return { label: translateKnownAbilityPhrase(name), category: '战斗', originalName: name };
    }
    if (/(?:persuasion|deception|intimidation|performance|游说|欺瞒|威吓|表演)/iu.test(name)) {
        return { label: translateKnownAbilityPhrase(name), category: '社交', originalName: name };
    }
    return { label: name, category: /[\u4e00-\u9fff]/u.test(name) ? '特殊' : '特殊', originalName: name };
}

function translateKnownAbilityPhrase(name) {
    return sanitizeVisibleText(name)
        .replace(/\bGreat Weapon Fighting\b/iu, '巨武器战斗')
        .replace(/\bSecond Wind\b/iu, '回气')
        .replace(/\bAction Surge\b/iu, '动作如潮')
        .replace(/\bLight Armor\b/iu, '轻甲')
        .replace(/\bShort Blades?\b/iu, '短刃');
}

function groupAbilityItems(abilities) {
    const order = ['探索', '社交', '战斗', '魔法', '知识', '特殊'];
    return order
        .map((category) => ({
            id: sanitizeClassId(category),
            title: category,
            tone: category === '战斗' ? 'danger' : category === '魔法' ? 'magic' : 'skill',
            items: abilities.filter((item) => item.category === category),
        }))
        .filter((group) => group.items.length);
}

function sanitizeClassId(value) {
    return sanitizeVisibleText(value)
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'group';
}

function uniqueArray(items) {
    return [...new Set(items)];
}

function extractRelationship(text, message) {
    const entries = [];
    for (const line of splitLines(text)) {
        const value = matchKeyValue(line, ['Relationship', 'Relationships', 'Trust', 'Mood', '关系', '信任', '心情']);
        if (!value) {
            continue;
        }
        entries.push(parseNamedValue(value));
    }
    return entries.length ? createResult('relationships', 0.88, message, { relationships: entries }) : null;
}

function extractAffection(text, message) {
    const entries = [];
    for (const line of splitLines(text)) {
        const value = matchKeyValue(line, ['Affection', 'Favor', 'Intimacy', '好感度', '亲密度']);
        if (!value) {
            continue;
        }
        const numeric = value.match(/^(?:(.+?)\s+)?(\d+)(?:\s*\/\s*(\d+))?(?:\s*[（(](.+?)[）)])?$/u);
        entries.push(numeric
            ? {
                name: sanitizeVisibleText(numeric[1] || 'default'),
                value: Number(numeric[2]),
                max: numeric[3] ? Number(numeric[3]) : 100,
                label: sanitizeVisibleText(numeric[4] || ''),
                raw: sanitizeVisibleText(value),
            }
            : parseNamedValue(value));
    }
    return entries.length ? createResult('affection', 0.9, message, { affection: entries }) : null;
}

function extractResources(text, message) {
    const entries = [];
    for (const line of splitLines(text)) {
        const explicit = matchKeyValue(line, ['Resources', 'Resource', '资源']);
        if (explicit) {
            entries.push(...splitList(explicit).map(parseNamedValue));
            continue;
        }
        const direct = line.match(/^(?:Money|Food|Population|Energy|Reputation|金钱|粮食|人口|能源|声望)\s*[:：]\s*(.+)$/iu);
        if (direct) {
            entries.push({ name: sanitizeVisibleText(line.split(/[:：]/)[0]), value: sanitizeVisibleText(direct[1]), raw: sanitizeVisibleText(line) });
        }
    }
    return entries.length ? createResult('resources', entries.length >= 2 ? 0.9 : 0.78, message, { resources: entries }) : null;
}

function extractCalendar(text, message) {
    const entries = [];
    for (const line of splitLines(text)) {
        const value = matchKeyValue(line, ['Date', 'Day', 'Schedule', 'Calendar', '日期', '日程', '时间']);
        if (value) {
            entries.push({ label: sanitizeVisibleText(value), raw: sanitizeVisibleText(line) });
        }
    }
    return entries.length ? createResult('calendar', 0.82, message, { calendar: entries }) : null;
}

function extractDice(text, message) {
    const events = splitLines(text)
        .filter((line) => /\b(?:d20|dice|roll|rolled|check)\b|掷骰|骰子|判定/u.test(line))
        .map((line) => ({ label: sanitizeVisibleText(line), raw: sanitizeVisibleText(line) }));
    return events.length ? createResult('dice', 0.78, message, { events }) : null;
}

function createResult(module, confidence, message, values, configurationSource = BUILTIN_CONFIGURATION_SOURCE) {
    return {
        schemaVersion: ADAPTIVE_EXTRACTION_RESULT_PROTOCOL_VERSION,
        module,
        confidence,
        evidenceSource: {
            kind: 'visible-chat-message',
            chatId: message.chatId || '',
            messageIndex: Number.isFinite(Number(message.messageIndex)) ? Number(message.messageIndex) : 0,
        },
        configurationSource,
        values,
        displayOnly: true,
    };
}

function mergeResults(results) {
    const merged = new Map();
    for (const result of results.filter(Boolean)) {
        const existing = merged.get(result.module);
        if (!existing || result.confidence > existing.confidence) {
            merged.set(result.module, result);
        }
    }
    return [...merged.values()].sort((left, right) => right.confidence - left.confidence || left.module.localeCompare(right.module));
}

function normalizeVisibleMessages(input, maxRecentMessages, fallback) {
    const array = Array.isArray(input) ? input : [{ text: input }];
    return array
        .slice(Math.max(0, array.length - maxRecentMessages))
        .map((item, index) => ({
            text: sanitizeVisibleText(item?.displayText || item?.text || item?.mes || item || '', MAX_ADAPTIVE_VISIBLE_TEXT_LENGTH),
            chatId: sanitizeVisibleText(item?.chatId || fallback.chatId || '', 160),
            messageIndex: Number.isFinite(Number(item?.messageIndex)) ? Number(item.messageIndex) : fallback.messageIndex + index,
        }));
}

function isModuleEnabled(profile, moduleId) {
    return isPresentationModule(moduleId) && !profile.disabledModules.includes(moduleId);
}

function createPatternRegex(pattern) {
    try {
        return new RegExp(pattern.pattern, 'gmu');
    } catch {
        return null;
    }
}

function matchKeyValue(line, labels) {
    const escaped = labels.map(escapeRegex).join('|');
    const regex = new RegExp(`^(?:[-*•]\\s*)?(?:${escaped})\\s*[:：]\\s*(.+)$`, 'iu');
    const normalizedLine = String(line || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    const match = normalizedLine.match(regex);
    return match ? sanitizeVisibleText(match[1]) : '';
}

function collectModuleEntries(text, labels) {
    const lines = splitLines(text);
    const entries = [];
    let collecting = false;
    for (const line of lines) {
        const value = matchKeyValue(line, labels);
        if (value) {
            entries.push(...splitList(value));
            collecting = false;
            continue;
        }
        if (isStandaloneSectionHeading(line, labels)) {
            collecting = true;
            continue;
        }
        if (collecting && isKnownSectionHeading(line)) {
            collecting = false;
            continue;
        }
        if (collecting) {
            entries.push(line);
        }
    }
    return entries.map((item) => sanitizeVisibleText(item)).filter(Boolean);
}

function isStandaloneSectionHeading(line, labels) {
    const normalized = normalizeHeadingText(line);
    return labels.some((label) => normalized.toLowerCase() === String(label).replace(/[?？]/g, '').toLowerCase());
}

function isKnownSectionHeading(line) {
    const normalized = normalizeHeadingText(line).toLowerCase();
    return KNOWN_SECTION_HEADINGS.has(normalized);
}

function normalizeHeadingText(line) {
    return sanitizeVisibleText(line)
        .replace(/^#+\s*/u, '')
        .replace(/^[-*•]\s*/u, '')
        .replace(/^[:：]\s*/u, '')
        .replace(/[：:]\s*$/u, '')
        .replace(/^[\s*_`~]+|[\s*_`~]+$/gu, '')
        .trim();
}

function assignNumberPair(target, key, line, regex) {
    const match = line.match(regex);
    if (!match || target[key]) {
        return;
    }
    target[key] = {
        current: Number(String(match[1]).replace(/,/g, '')),
        max: match[2] ? Number(String(match[2]).replace(/,/g, '')) : null,
        raw: sanitizeVisibleText(line),
    };
}

function assignNumber(target, key, line, regex) {
    const match = line.match(regex);
    if (!match || target[key]) {
        return;
    }
    target[key] = {
        value: Number(String(match[1]).replace(/,/g, '')),
        raw: sanitizeVisibleText(line),
    };
}

function assignText(target, key, line, regex) {
    const match = line.match(regex);
    if (!match || target[key]) {
        return;
    }
    target[key] = {
        label: sanitizeVisibleText(match[1]),
        raw: sanitizeVisibleText(line),
    };
}

function parseNamedValue(value) {
    const text = sanitizeVisibleText(value);
    const pair = text.match(/^(.+?)\s*(?:[-–—=]|：|:)\s*(.+)$/u);
    if (pair) {
        return {
            name: sanitizeVisibleText(pair[1]),
            value: sanitizeVisibleText(pair[2]),
            raw: text,
        };
    }
    const spaced = text.match(/^(.+?)\s+(.+)$/u);
    return spaced
        ? { name: sanitizeVisibleText(spaced[1]), value: sanitizeVisibleText(spaced[2]), raw: text }
        : { name: text, value: '', raw: text };
}

function splitLines(text) {
    return sanitizeVisibleText(text)
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim().replace(/^```[\w-]*$/u, '').replace(/^[*_`~]+|[*_`~]+$/gu, '').trim())
        .filter(Boolean);
}

function splitList(value) {
    const source = sanitizeVisibleText(value);
    const items = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === '(' || character === '（' || character === '[' || character === '【') {
            depth += 1;
            continue;
        }
        if (character === ')' || character === '）' || character === ']' || character === '】') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0 && /[，,、;；|]/u.test(character)) {
            const item = source.slice(start, index).trim();
            if (item) {
                items.push(item);
            }
            start = index + 1;
        }
    }
    const tail = source.slice(start).trim();
    if (tail) {
        items.push(tail);
    }
    return items;
}

function sanitizeVisibleText(value, maxLength = MAX_ADAPTIVE_VISIBLE_TEXT_LENGTH) {
    const text = String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
