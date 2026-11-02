// Set & Steal: standalone server.
// Serves the static site in /public and the two JSON APIs (/api/rooms, /api/chat).
// Runs the SQL files in /migrations once each on startup.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env if present (no extra dependency needed).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { pool } = await import('./lib/db.js');
const routes = {
  '/api/rooms': (await import('./api/rooms.js')).default,
  '/api/chat': (await import('./api/chat.js')).default,
};

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.md': 'text/markdown; charset=utf-8' };
// Pages, the service worker and the manifest must revalidate so installed apps pick up new versions.
const NO_CACHE = new Set(['.html', '.webmanifest']);

async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
  const files = fs.readdirSync(path.join(ROOT, 'migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
      console.log('Applied migration', f);
    } catch (e) {
      await client.query('ROLLBACK'); throw e;
    } finally { client.release(); }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 2_000_000) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function makeRes(res) {
  let code = 200;
  const out = {
    status(c) { code = c; return out; },
    setHeader(k, v) { res.setHeader(k, v); return out; },
    json(obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); },
    send(s) { res.writeHead(code); res.end(s); },
  };
  return out;
}

function serveStatic(urlPath, res) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { // unknown paths fall back to the app
      const index = path.join(PUBLIC, 'index.html');
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
      return fs.createReadStream(index).pipe(res);
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': NO_CACHE.has(ext) || path.basename(file) === 'sw.js' ? 'no-cache' : 'public, max-age=3600' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const handler = routes[url.pathname];
  if (!handler) return serveStatic(url.pathname, res);
  if (!['GET', 'POST', 'OPTIONS'].includes(req.method)) { res.writeHead(405, { 'Content-Type': 'application/json' }); return res.end('{"error":"Method not allowed"}'); }
  try {
    const raw = req.method === 'POST' ? await readBody(req) : '';
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"Invalid JSON"}'); } }
    await handler({ method: req.method, query: Object.fromEntries(url.searchParams), body, headers: req.headers }, makeRes(res));
  } catch (e) {
    console.error(url.pathname, e);
    if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"Server error"}'); }
  }
});

const PORT = Number(process.env.PORT || 3000);
try {
  await migrate();
} catch (e) {
  console.error('Could not prepare the database:', e.message);
  console.error('Same-device games still work, but online rooms and chat need the database.');
}
server.listen(PORT, () => console.log('Set & Steal running on http://localhost:' + PORT));
