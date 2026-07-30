import { readFile } from 'node:fs/promises';
import { createSignedBridgeProof } from './server.mjs';

const args = parseArgs(process.argv.slice(2));
const secret = process.env.GALGAME_BRIDGE_PROOF_SECRET || '';
const ttlMs = Number(args.ttlMs || args.ttl || 5 * 60 * 1000);
const binding = await readBinding(args.binding || args.file || '-');

const proof = createSignedBridgeProof({
    secret,
    binding,
    ttlMs: Number.isFinite(ttlMs) ? ttlMs : 5 * 60 * 1000,
});

console.log(JSON.stringify(proof, null, 2));

async function readBinding(source) {
    if (!source || source === '-') {
        return JSON.parse(await readStdin());
    }
    return JSON.parse(await readFile(source, 'utf8'));
}

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
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
