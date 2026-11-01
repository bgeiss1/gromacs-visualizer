// Serves this folder at http://localhost:8002/ . Run: node serve.mjs (or npm run serve)
// POST /api/text saves the page text from the dashboard (admin.html) to data/text.json, after
// copying the old file to data/text-backups/. POST /api/publish commits data/text.json and pushes it
// to GitHub with this Mac's own git login, and the Pages workflow then updates the site.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 8002;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.gro': 'text/plain', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function saveText(req, res) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 2e6) { res.writeHead(413).end(); return; } }
  let text;
  try { text = JSON.parse(body); } catch { res.writeHead(400).end('Not JSON'); return; }
  if (!text || typeof text !== 'object' || Array.isArray(text) || !Object.values(text).every(v => typeof v === 'string')) {
    res.writeHead(400).end('Expected an object of strings'); return;
  }
  const file = join(root, 'data/text.json');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await mkdir(join(root, 'data/text-backups'), { recursive: true });
  const backup = `data/text-backups/text-${stamp}.json`;
  await copyFile(file, join(root, backup)).catch(() => {});
  await writeFile(file, JSON.stringify(text, null, 1) + '\n');
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, backup }));
}

const git = (...args) => new Promise(ok => execFile('git', args, { cwd: root }, (err, stdout, stderr) => ok({ code: err ? err.code ?? 1 : 0, out: (stdout + stderr).trim() })));

async function publish(req, res) {
  const send = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
  if ((await git('rev-parse', '--is-inside-work-tree')).code) return send(400, { error: 'This folder is not a git clone of the GitHub repo yet.' });
  await git('add', 'data/text.json');
  const staged = await git('diff', '--cached', '--quiet', '--', 'data/text.json');
  if (staged.code) {
    const c = await git('commit', '-m', 'Update page text from the dashboard', '--', 'data/text.json');
    if (c.code) return send(500, { error: c.out });
  }
  const p = await git('push');
  if (p.code) return send(500, { error: p.out });
  send(200, { ok: true, committed: !!staged.code, out: p.out });
}

createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/publish') { await publish(req, res).catch(e => res.writeHead(500).end(String(e))); return; }
  if (req.method === 'POST' && req.url === '/api/text') { await saveText(req, res).catch(e => res.writeHead(500).end(String(e))); return; }
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': (TYPES[extname(file)] || 'application/octet-stream') + '; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`GROMACS Visualizer: http://localhost:${port}/`));
