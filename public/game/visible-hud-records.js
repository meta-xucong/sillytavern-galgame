import { extractHudPresentationFromText } from './shared/adaptive-presentation.js?v=auto-b19af4e9a9f8';
import { formatVisualNovelDisplayText } from './shared/sillytavern-adapter.js?v=auto-b19af4e9a9f8';

/** Rebuild display-only records from the current visible branch; never persist game state. */
export function collectVisibleHudRecords(snapshot, messageIndex, profile) {
    const records = new Map();
    const messages = snapshot?.messages;
    if (!Array.isArray(messages) || !Number.isSafeInteger(messageIndex)
        || messageIndex < 0 || messageIndex >= messages.length) return records;
    const chatId = String(snapshot.fileName || snapshot.chatId || '');
    for (let index = messageIndex; index >= 0 && records.size < 3; index--) {
        const message = messages[index];
        if (message?.role !== 'character') continue;
        const text = formatVisualNovelDisplayText(message.displayText || message.text || '');
        const results = extractHudPresentationFromText(text, { profile, chatId, messageIndex: index });
        for (const result of results) {
            if (records.has(result.module)) continue;
            // Re-reading a different snapshot naturally invalidates edits, swipes and deletions.
            records.set(result.module, {
                ...result,
                historical: index < messageIndex,
                hasVisibleEvidence: true,
            });
        }
    }
    return records;
}
