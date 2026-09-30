#!/usr/bin/env node
// JsonlViewer: a local replay viewer for Claude Code session transcripts (.jsonl).
//
// Serves the viewer from ./public and lists the transcripts under ~/.claude/projects, so a session opens
// from a list instead of a file dialog. Listens on 127.0.0.1 only and reads nothing outside the projects
// folder. Its one write is the bookmarks file beside it. No dependencies beyond Node itself.
//
//   node server.js [--port 4717] [--dir <projects folder>] [--bookmarks <file>] [--no-open]

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { exec } = require('child_process');

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ROOT = path.resolve(arg('--dir') || process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects'));
const PUBLIC = path.join(__dirname, 'public');
const START_PORT = Number(arg('--port') || process.env.JSONL_VIEWER_PORT || 4717);
const OPEN = !args.includes('--no-open');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

// ---------- session index ----------
// The summary of each transcript (first prompt, working folder, prompt count) is read once and kept until
// the file's size or time changes; a live session's file grows, so it is re-read on the next listing.
const summaries = new Map();

async function summarise(file, stat) {
  const key = file + '|' + stat.size + '|' + stat.mtimeMs;
  const cached = summaries.get(file);
  if (cached && cached.key === key) return cached.value;
  // A transcript only ever grows, so a larger file is read from where the last reading stopped.
  const grown = cached && stat.size > cached.size;
  const value = grown ? { ...cached.value } : { firstPrompt: '', cwd: '', branch: '', prompts: 0, started: null };
  const input = fs.createReadStream(file, { encoding: 'utf8', start: grown ? cached.size : 0 });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line || line[0] !== '{') continue;
      // Counting prompts needs every line, but only user lines need parsing.
      if (!line.includes('"type":"user"') && value.cwd) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!value.cwd && o.cwd) value.cwd = o.cwd;
      if (!value.branch && o.gitBranch) value.branch = o.gitBranch;
      if (!value.started && o.timestamp) value.started = o.timestamp;
      if (o.type !== 'user' || o.isMeta) continue;
      const text = promptText(o.message && o.message.content);
      if (!text) continue;
      value.prompts++;
      if (!value.firstPrompt) value.firstPrompt = text.slice(0, 300);
    }
  } finally { lines.close(); input.destroy(); }
  summaries.set(file, { key, size: stat.size, value });
  return value;
}

// Text the user typed or pasted; system-injected blocks (reminders, command output) start with a tag.
function promptText(c) {
  const texts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text) : [];
  for (const raw of texts) {
    const t = String(raw || '').replace(/<\/?pasted_content[^>]*>/g, '').trim();
    if (!t || t.startsWith('<') || t.startsWith('Caveat:') || t.startsWith('This session is being continued') || t.startsWith('[Request interrupted')) continue;
    return t;
  }
  return '';
}

async function listSessions() {
  const out = [];
  let projects = [];
  try { projects = await fs.promises.readdir(ROOT, { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(ROOT, p.name);
    let files = [];
    try { files = await fs.promises.readdir(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(dir, f);
      let stat; try { stat = await fs.promises.stat(full); } catch { continue; }
      if (!stat.isFile() || stat.size === 0) continue;
      const s = await summarise(full, stat);
      if (!s.prompts) continue; // sidechain and empty stubs
      out.push({ project: p.name, file: f, size: stat.size, modified: stat.mtime.toISOString(), ...s });
    }
  }
  out.sort((a, b) => (a.modified < b.modified ? 1 : -1));
  return out;
}

// A project folder and a file name, both single path segments, resolved inside ROOT.
function sessionPath(project, file) {
  const plain = (s) => typeof s === 'string' && s && !/[\\/]/.test(s) && s !== '.' && s !== '..';
  if (!plain(project) || !plain(file) || !file.endsWith('.jsonl')) return null;
  const full = path.resolve(ROOT, project, file);
  return full.startsWith(ROOT + path.sep) ? full : null;
}

// ---------- bookmarks ----------
// Starred turns and bookmarked steps, kept in one small JSON file beside the server so they outlive the
// browser's storage and do not depend on the port. It is the only file the server writes.
// Shape: { "<transcript file name>": { "stars": [...], "marks": [...] } }. An entry emptied by the page
// stays, empty, so a browser that still holds old bookmarks does not bring them back.
const BOOKMARKS = path.resolve(arg('--bookmarks') || path.join(__dirname, 'bookmarks.json'));
let bookmarks = {};
let writing = Promise.resolve();

// Read on every request: the file is small, and a second viewer on another port may have written it.
function loadBookmarks() {
  try { bookmarks = JSON.parse(fs.readFileSync(BOOKMARKS, 'utf8')); } catch { bookmarks = {}; }
  if (!bookmarks || typeof bookmarks !== 'object' || Array.isArray(bookmarks)) bookmarks = {};
  return bookmarks;
}
// The transcript's file name: one path segment ending in .jsonl.
const bookmarkKey = (k) => typeof k === 'string' && k.length <= 200 && /^[^\\/]+\.jsonl$/.test(k) && k !== '.jsonl' ? k : null;
const idList = (a) => Array.isArray(a) && a.length <= 5000 && a.every((v) => typeof v === 'string' && v.length <= 200) ? [...new Set(a)] : null;

function saveBookmarks() {
  const text = JSON.stringify(bookmarks, null, 1);
  // Writes run one at a time, each to a temporary file renamed over the old, so a crash leaves a whole file.
  writing = writing.then(async () => {
    const tmp = BOOKMARKS + '.tmp';
    await fs.promises.writeFile(tmp, text, 'utf8');
    await fs.promises.rename(tmp, BOOKMARKS);
  }).catch((e) => console.error('Could not save bookmarks: ' + e.message));
  return writing;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

// A write must come from this page: the Host is the loopback address (no DNS rebinding), any Origin is
// this server, and the body is JSON, which another site cannot send here without a preflight this
// server never answers.
function fromThisPage(req) {
  const host = String(req.headers.host || '');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== 'http://' + host) return false;
  return /^application\/json\b/.test(String(req.headers['content-type'] || ''));
}

// ---------- http ----------
function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/bookmarks') {
    const key = bookmarkKey(url.searchParams.get('key'));
    if (!key) return send(res, 400, 'Not a transcript file name');
    const all = loadBookmarks();
    if (req.method === 'GET') {
      const entry = Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
      return send(res, 200, JSON.stringify(entry), TYPES['.json']);
    }
    if (req.method !== 'PUT') return send(res, 405, 'Method not allowed');
    if (!fromThisPage(req)) return send(res, 403, 'Forbidden');
    let body; try { body = JSON.parse(await readBody(req, 512 * 1024)); } catch { return send(res, 400, 'Bad request'); }
    const stars = idList(body && body.stars), marks = idList(body && body.marks);
    if (!stars || !marks) return send(res, 400, 'Bad request');
    all[key] = { stars, marks };
    await saveBookmarks();
    return send(res, 204, '');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');

  if (url.pathname === '/api/sessions') {
    const sessions = await listSessions();
    return send(res, 200, JSON.stringify({ root: ROOT, sessions }), TYPES['.json']);
  }
  if (url.pathname === '/api/session') {
    const full = sessionPath(url.searchParams.get('project'), url.searchParams.get('file'));
    if (!full) return send(res, 400, 'Not a session in the projects folder');
    let stat; try { stat = await fs.promises.stat(full); } catch { return send(res, 404, 'No such session'); }
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const full = path.resolve(PUBLIC, rel);
  if (!full.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream');
  });
}

function listen(port, triesLeft) {
  const server = http.createServer((req, res) => handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Server error'); }));
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) return listen(port + 1, triesLeft - 1);
    console.error(e.message); process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`JsonlViewer: ${url}`);
    console.log(`Sessions from ${ROOT}`);
    console.log('Ctrl+C stops it.');
    if (OPEN) {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
}

listen(START_PORT, 20);
