import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const htmlPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'presentation-projection-harness.html');
const args = process.argv.slice(2);
let port = 8810;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
        port = Number(args[++i]);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid loopback port');
    } else throw new Error(`Unknown argument: ${args[i]}`);
}

const contentTypes = new Map([['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'], ['.svg', 'image/svg+xml']]);
const server = http.createServer(async (request, response) => {
    const remote = request.socket.remoteAddress || '';
    if (!(remote === '127.0.0.1' || remote === '::ffff:127.0.0.1' || remote === '::1')) {
        response.writeHead(403).end();
        return;
    }
    if (request.method !== 'GET') { response.writeHead(405, { Allow: 'GET' }).end(); return; }
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Cache-Control': 'no-store' });
        response.end(await readFile(htmlPath));
        return;
    }
    const root = url.pathname.startsWith('/shared/src/') ? path.join(repoRoot, 'frontend/shared/src')
        : url.pathname.startsWith('/player/src/') ? path.join(repoRoot, 'frontend/player/src') : null;
    if (!root) { response.writeHead(404).end(); return; }
    const relative = decodeURIComponent(url.pathname.replace(/^\/(?:shared|player)\/src\//u, ''));
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) { response.writeHead(403).end(); return; }
    try {
        const body = await readFile(target);
        response.writeHead(200, { 'Content-Type': contentTypes.get(path.extname(target)) || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(body);
    } catch { response.writeHead(404).end(); }
});

server.listen(port, '127.0.0.1', () => {
    console.log(`Presentation projection QA harness: http://127.0.0.1:${port}/`);
    console.log('Loopback only; synthetic fixture only; no SillyTavern session or credentials are accepted. Press Ctrl+C to stop.');
});
