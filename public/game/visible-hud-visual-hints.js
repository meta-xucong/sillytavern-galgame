import { formatVisualNovelDisplayText } from './shared/sillytavern-adapter.js?v=auto-b19af4e9a9f8';
import { collectVisibleHudRecords } from './visible-hud-records.js?v=auto-b19af4e9a9f8';

const HUD_VISUAL_CHANNELS = Object.freeze([
    { module: 'equipment', entityType: 'equipment', attributeCode: 'equipment-visible-label', collection: 'items' },
    { module: 'inventory', entityType: 'item', attributeCode: 'item-visible-label', collection: 'items' },
    { module: 'abilities', entityType: 'skill', attributeCode: 'skill-visible-label', collection: 'abilities' },
]);

/**
 * Build visual hints from the same branch-derived HUD records used by the
 * player's cards. Labels stay in their authored HUD channel; this helper does
 * not infer item state, category, traits, or equipped status.
 */
export async function createVisibleHudVisualHints(snapshot, messageIndex, profile) {
    const messages = snapshot?.messages;
    const chatId = String(snapshot?.fileName || snapshot?.chatId || '');
    if (!chatId || !Array.isArray(messages) || !Number.isSafeInteger(messageIndex)
        || messageIndex < 0 || messageIndex >= messages.length) return [];

    const records = collectVisibleHudRecords(snapshot, messageIndex, profile);
    const channelBuckets = [];
    const sourceTextHashes = new Map();
    for (const channel of HUD_VISUAL_CHANNELS) {
        const record = records.get(channel.module);
        const source = record?.evidenceSource;
        const sourceMessageIndex = source?.messageIndex;
        if (record?.schemaVersion !== 'galgame.presentation-extraction-result.v1'
            || record.module !== channel.module
            || record.displayOnly !== true
            || record.hasVisibleEvidence !== true
            || record.explicitEmpty === true
            || !Number.isFinite(record.confidence) || record.confidence <= 0 || record.confidence > 1
            || source?.kind !== 'visible-chat-message' || source.chatId !== chatId
            || !Number.isSafeInteger(sourceMessageIndex) || sourceMessageIndex < 0
            || sourceMessageIndex > messageIndex
            || messages[sourceMessageIndex]?.role !== 'character'
            || record.historical !== (sourceMessageIndex < messageIndex)
            || !record.values || !Array.isArray(record.values[channel.collection])) continue;

        const labels = [];
        const seenLabels = new Set();
        for (const entry of record.values[channel.collection]) {
            if (!entry || typeof entry.label !== 'string') continue;
            const label = entry.label.normalize('NFC').trim();
            if (!label || [...label].length > 120) continue;
            addLabel(label);
            if (channel.entityType === 'skill' && typeof entry.originalName === 'string') {
                const originalName = entry.originalName.normalize('NFC').trim();
                if ([...originalName].length <= 120) addLabel(originalName);
            }
        }
        if (!labels.length) continue;

        let sourceTextHash = sourceTextHashes.get(sourceMessageIndex);
        if (!sourceTextHash) {
            const sourceMessage = messages[sourceMessageIndex];
            const sourceText = formatVisualNovelDisplayText(sourceMessage.displayText || sourceMessage.text || '');
            sourceTextHash = await sha256Hex(sourceText);
            sourceTextHashes.set(sourceMessageIndex, sourceTextHash);
        }
        const channelHints = await Promise.all(labels.map(async (label) => {
            // Keep each exact source label as its own match candidate. The
            // visual renderer chooses a verified candidate; combining labels
            // would create text that never appeared in the HUD record.
            const seedDigest = await sha256Hex(JSON.stringify([
                chatId, sourceMessageIndex, sourceTextHash, channel.module, label,
            ]));
            return {
                entityKeySeed: `visible-hud:${channel.module}:${seedDigest.slice(0, 40)}`,
                entityType: channel.entityType,
                displayLabel: Array.from(label).slice(0, 80).join(''),
                visibleAttributes: [{
                    code: channel.attributeCode,
                    value: label,
                    confidenceBand: 'explicit',
                }],
                confidenceBand: 'explicit',
                evidenceSource: { chatId, messageIndex: sourceMessageIndex },
                historical: record.historical,
            };
        }));
        channelBuckets.push(channelHints);

        function addLabel(value) {
            if (!value || seenLabels.has(value) || labels.length >= 12) return;
            seenLabels.add(value);
            labels.push(value);
        }
    }
    // Interleave categories so a verbose equipment list cannot crowd every
    // inventory/skill candidate out before the main projection applies its
    // protocol-level entity cap.
    const hints = [];
    for (let offset = 0; channelBuckets.some((bucket) => offset < bucket.length); offset++) {
        for (const bucket of channelBuckets) {
            if (bucket[offset]) hints.push(bucket[offset]);
        }
    }
    return hints;
}

async function sha256Hex(value) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
