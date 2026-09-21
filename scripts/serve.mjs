/** Small dependency-free HTTP server for local development only.
 * node scripts/serve.mjs [--port 8080] [--base /KifuPrintWeb/]
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { root } from './check-site.mjs';
function arg(flag, fallback) { const i = process.argv.indexOf(flag); return i === -1 ? fallback : process.argv[i + 1]; }
const port = Number(arg('--port', '8080')), base = arg('--base', '/');
if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\/(?:[\w.-]+\/)*$/.test(base) || base.includes('..')) {
  throw new Error('Use --port 1..65535 and --base / or /repository/.');
}
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (base !== '/' && pathname === base.slice(0, -1)) { res.writeHead(308, { Location: base }); return res.end(); }
    if (!pathname.startsWith(base) || pathname.includes('\\') || pathname.includes('\0')) { res.writeHead(404); return res.end('Not found'); }
    let name = pathname.slice(base.length); if (!name || name.endsWith('/')) name += 'index.html';
    // Only public static resources, not development files or uploads.
    if (!(name === 'index.html' || /^(js|css|assets|fonts)\//.test(name))) { res.writeHead(404); return res.end('Not found'); }
    const full = resolve(root, name);
    if (!full.startsWith(root + sep) || !(await stat(full)).isFile()) { res.writeHead(404); return res.end('Not found'); }
    const data = await readFile(full);
    res.writeHead(200, { 'Content-Type': types[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (_) { res.writeHead(404); res.end('Not found'); }
});
server.on('error', e => { console.error('Local server:', e.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Kifu Print Web: http://127.0.0.1:${port}${base} (Ctrl+C to stop)`));
