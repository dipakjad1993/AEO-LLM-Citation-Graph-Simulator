import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname) + path.sep;
const PORT = Number(process.env.PORT || 3000);
// Bind address: loopback by default (dev-safe). PaaS/Docker must set HOST=0.0.0.0
// (Render/Fly/Run inject PORT and probe 0.0.0.0 — loopback => "No open ports detected").
const HOST = process.env.HOST || '127.0.0.1';

// ─── Security config ──────────────────────────────────────────────
const AUTH_TOKEN = process.env.AEO_AUTH_TOKEN || '';
const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25MB (was 500MB — DoS vector)
const UPLOAD_SECTIONS = new Set(['prompts', 'entities', 'corpus', 'gold_standards', 'system_config', 'results', 'traffic', 'crawl', 'commerce']);
// Static serving is allow-listed: dashboard + screenshots only. Never serve arbitrary ROOT files.
const STATIC_ALLOW = [
  { route: '/', file: path.join(ROOT, 'src', 'dashboard', 'index.html'), type: 'text/html' },
  { route: '/index.html', file: path.join(ROOT, 'src', 'dashboard', 'index.html'), type: 'text/html' },
  // Pages-compat: index.html uses ./sections.js, which resolves to /sections.js
  // at "/" (both locally and when src/dashboard is the Pages output dir).
  { route: '/sections.js', file: path.join(ROOT, 'src', 'dashboard', 'sections.js'), type: 'application/javascript' },
];
const STATIC_DIRS = [
  { prefix: '/screenshots/', dir: path.join(ROOT, 'screenshots') },
  { prefix: '/src/dashboard/', dir: path.join(ROOT, 'src', 'dashboard') },
];
// Basic per-IP rate limit (60 req/min) with bounded memory: prune stale entries
// every check and evict oldest IPs past MAX_IPS so the Map cannot grow unbounded (DoS).
const hits = new Map();
const MAX_IPS = 5000;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > MAX_IPS) {
    // Evict ~10% oldest: Map iterates in insertion order.
    let n = Math.ceil(MAX_IPS / 10);
    for (const k of hits.keys()) { hits.delete(k); if (--n <= 0) break; }
  }
  // Opportunistic sweep: drop IPs whose window fully expired.
  if (hits.size % 50 === 0) {
    for (const [k, v] of hits) {
      if (!v.length || now - v[v.length - 1] > 60000) hits.delete(k);
    }
  }
  return arr.length > 60;
}

const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const LOG_DIR = path.join(ROOT, 'logs');
const CONFIG_INPUTS_FILE = path.join(DATA_DIR, 'system_inputs.json');

[UPLOAD_DIR, OUTPUT_DIR, LOG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const procs = {};
const sessionRunDirs = new Set();

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
  try { fs.appendFileSync(path.join(LOG_DIR, 'server.log'), `[${ts}] ${msg}\n`); } catch {}
}

function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > limit) { try { req.destroy(); } catch {} reject(new Error(`Body too large (${Math.round(limit / 1048576)}MB limit)`)); } });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const ALLOWED_ORIGINS = (process.env.AEO_CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const CORS_STAR = (process.env.AEO_CORS_ORIGIN || '').trim() === '*';
if (CORS_STAR) log('WARNING: AEO_CORS_ORIGIN=* — dev-only. Set explicit origins in prod (fails enterprise review).');
function corsHeaders(req) {
  const origin = req?.headers?.origin || '';
  if (CORS_STAR) return { 'Access-Control-Allow-Origin': '*' };
  if (ALLOWED_ORIGINS.length && origin && ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) {
    return { 'Access-Control-Allow-Origin': origin };
  }
  if (!ALLOWED_ORIGINS.length) return {}; // loopback-safe default: no ACAO header
  return {};
}
function jsonRes(res, code, data, req) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', ...corsHeaders(req), 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

// ─── Correlation IDs + OpenTelemetry (OTLP-compatible JSONL, no vendor SDK) ──
import { randomUUID as _uuid } from 'crypto';
const OTEL_ENABLED = process.env.OTEL_ENABLED === '1';
function otelEmit(span) {
  if (!OTEL_ENABLED) return;
  try { fs.appendFileSync(path.join(LOG_DIR, 'otel.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...span }) + '\n'); } catch {}
}
function auditEvent(type, details = {}) {
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'audit.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type, ...details }) + '\n');
  } catch {}
}

// ─── Persistent job store (survives restart; SQLite when available) ──────────
const JOBS_DIR = path.join(DATA_DIR, 'jobs');
const JOBS_FILE = path.join(JOBS_DIR, 'jobs.json');
try { fs.mkdirSync(JOBS_DIR, { recursive: true }); } catch {}
function persistJobs() {
  try {
    const slim = {};
    for (const [k, p] of Object.entries(procs)) {
      slim[k] = { runDir: p.runDir, runId: p.runId, status: p.status, exitCode: p.exitCode, startTime: p.startTime, elapsed: p.elapsed, progress: p.progress, analysisDir: p.analysisDir, outputTail: (p.output || '').slice(-2000), errTail: (p.errOutput || '').slice(-2000) };
    }
    const tmp = JOBS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), procs: slim, runs: [...sessionRunDirs] }, null, 2));
    fs.renameSync(tmp, JOBS_FILE);
    tryPersistSqlite(slim);
  } catch (e) { console.error('job persist failed:', e.message); }
}
function restoreJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    for (const r of data.runs || []) sessionRunDirs.add(r);
    for (const [k, p] of Object.entries(data.procs || {})) {
      if (p.status === 'running') p.status = 'interrupted_restart';
      procs[k] = { ...p, child: null, output: p.outputTail || '', errOutput: p.errTail || '' };
    }
    if (Object.keys(data.procs || {}).length) log(`Restored ${Object.keys(data.procs).length} job(s) from ${JOBS_FILE}`);
  } catch (e) { console.error('job restore failed:', e.message); }
}
let _sqliteDb = null;
function tryPersistSqlite(slim) {
  try {
    if (_sqliteDb === undefined) return;
    import('node:sqlite').then(({ DatabaseSync }) => {
      try {
        _sqliteDb = _sqliteDb || new DatabaseSync(path.join(DATA_DIR, 'aeo_jobs.db'));
        _sqliteDb.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT, run_id TEXT, updated_at TEXT, payload TEXT)');
        const stmt = _sqliteDb.prepare('INSERT OR REPLACE INTO jobs (id, status, run_id, updated_at, payload) VALUES (?, ?, ?, ?, ?)');
        for (const [k, p] of Object.entries(slim)) stmt.run(k, p.status, p.runId, new Date().toISOString(), JSON.stringify(p));
      } catch {}
    }).catch(() => { _sqliteDb = undefined; });
  } catch {}
}

// ─── OIDC / RBAC (enterprise SSO) ─────────────────────────────────────
import { initJobStore, writeJob, writeAudit as _writeAuditDb } from './src/node-orchestrator/job_store.js';
initJobStore(DATA_DIR);
const OIDC_ISSUER = process.env.AEO_OIDC_ISSUER || '';
const OIDC_AUDIENCE = process.env.AEO_OIDC_AUDIENCE || '';
const OIDC_JWKS = process.env.AEO_OIDC_JWKS_URL || '';
const SSO_ENFORCED = Boolean(OIDC_ISSUER && OIDC_JWKS);
const _jwksCache = { keys: [], fetchedAt: 0 };
async function verifyOidcJwt(token) {
  // Real JWKS verify (kid-matched, iss/aud/exp). Uses global fetch + WebCrypto; no new deps.
  if (!SSO_ENFORCED) return null;
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed JWT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (OIDC_ISSUER && payload.iss !== OIDC_ISSUER) throw new Error('bad iss');
  if (OIDC_AUDIENCE && !(payload.aud === OIDC_AUDIENCE || (Array.isArray(payload.aud) && payload.aud.includes(OIDC_AUDIENCE)))) throw new Error('bad aud');
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('expired JWT');
  if (Date.now() - _jwksCache.fetchedAt > 3600_000 || !_jwksCache.keys.length) {
    const r = await fetch(OIDC_JWKS, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`JWKS fetch ${r.status}`);
    const j = await r.json();
    _jwksCache.keys = j.keys || [];
    _jwksCache.fetchedAt = Date.now();
  }
  const jwk = _jwksCache.keys.find((k) => !header.kid || k.kid === header.kid);
  if (!jwk) throw new Error('kid not in JWKS');
  const { createPublicKey, createVerify } = await import('crypto');
  const pub = createPublicKey({ key: jwk, format: 'jwk' });
  const v = createVerify('RSA-SHA256');
  v.update(`${parts[0]}.${parts[1]}`);
  if (!v.verify(pub, Buffer.from(parts[2], 'base64url'))) throw new Error('bad JWT signature');
  return payload;
}
let _oidcPayload = null;
if (!SSO_ENFORCED) log('Auth mode: single-token (dev/SMB). Set AEO_OIDC_ISSUER/AUDIENCE/JWKS_URL for OIDC JWT + RBAC.');
else log(`Auth mode: OIDC JWT enforced (issuer=${OIDC_ISSUER}) with roles admin|analyst|viewer.`);
function callerRole(req) {
  if (_oidcPayload) {
    const roles = _oidcPayload.roles || _oidcPayload.groups || [];
    const list = Array.isArray(roles) ? roles : [roles];
    if (list.includes('admin')) return 'admin';
    if (list.includes('analyst')) return 'analyst';
    return 'viewer';
  }
  if (SSO_ENFORCED) return 'viewer'; // never trust headers when OIDC is enforced
  const r = (req.headers['x-aeo-role'] || req.headers['x-role'] || '').toLowerCase();
  if (['admin', 'analyst', 'viewer'].includes(r)) return r;
  return 'admin'; // single-token mode: authed() already gated (token holder or open dev) — treat as admin so Save+Analyze works
}
function requireRole(req, res, ...allowed) {
  const role = callerRole(req);
  if (!allowed.includes(role)) { jsonRes(res, 403, { error: `Forbidden: role '${role}' not in [${allowed.join(',')}]` }, req); return false; }
  return true;
}

function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && !AUTH_TOKEN) {
  console.error('FATAL: NODE_ENV=production requires AEO_AUTH_TOKEN. Refusing to start unauthenticated.');
  process.exit(1);
}
function authed(req) {
  if (!AUTH_TOKEN) return !IS_PROD; // dev default; prod refuses to boot without a token (see above)
  const h = req.headers.authorization || '';
  // Constant-time compare to avoid timing oracle on the token.
  const want = `Bearer ${AUTH_TOKEN}`;
  if (h.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= h.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try { execFileSync(cmd, ['--version'], { stdio: 'ignore', timeout: 5000 }); return cmd; } catch {}
  }
  return 'python';
}

const PYTHON = findPython();
log(`Python executable: ${PYTHON}`);
if (!AUTH_TOKEN) log('WARNING: AEO_AUTH_TOKEN not set — API is unauthenticated (dev only).');

function safeSection(s) {
  return UPLOAD_SECTIONS.has(s) ? s : null;
}
function safeFilename(name) {
  const base = path.basename(String(name || `data_${Date.now()}.json`));
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return clean || `data_${Date.now()}.json`;
}

function saveFile(section, filename, data) {
  const dir = path.join(UPLOAD_DIR, section);
  fs.mkdirSync(dir, { recursive: true });
  const safe = safeFilename(filename);
  const fp = path.join(dir, safe);
  if (!fp.startsWith(dir + path.sep)) throw new Error('Path traversal blocked');
  fs.writeFileSync(fp, data);
  return { name: safe, size: data.length, path: fp };
}

function listUploads() {
  const result = {};
  if (!fs.existsSync(UPLOAD_DIR)) return result;
  for (const sec of fs.readdirSync(UPLOAD_DIR)) {
    const d = path.join(UPLOAD_DIR, sec);
    if (!fs.statSync(d).isDirectory()) continue;
    result[sec] = fs.readdirSync(d).map(f => ({ name: f, size: fs.statSync(path.join(d, f)).size }));
  }
  return result;
}

function findLatestAnalysis() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => d.startsWith('analysis_')).sort().reverse();
  for (const d of dirs) {
    const dp = path.join(OUTPUT_DIR, d);
    if (fs.existsSync(path.join(dp, 'pipeline_summary.json'))) return dp;
  }
  return null;
}

function findAnalysisForRun(startTimeMs) {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const cutoff = new Date(startTimeMs - 5000);
  const dirs = fs.readdirSync(OUTPUT_DIR)
    .filter(d => d.startsWith('analysis_'))
    .map(d => ({ name: d, path: path.join(OUTPUT_DIR, d) }))
    .filter(d => {
      try {
        const summaryPath = path.join(d.path, 'pipeline_summary.json');
        if (!fs.existsSync(summaryPath)) return false;
        const stat = fs.statSync(summaryPath);
        return stat.mtimeMs >= cutoff.getTime();
      } catch { return false; }
    })
    .sort((a, b) => fs.statSync(path.join(a.path, 'pipeline_summary.json')).mtimeMs - fs.statSync(path.join(b.path, 'pipeline_summary.json')).mtimeMs);
  return dirs.length ? dirs[dirs.length - 1].path : findLatestAnalysis();
}

function parseMultipart(buffer, boundary) {
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary)) throw new Error('Invalid multipart boundary');
  const parts = [];
  const sep = Buffer.from(`--${boundary}`);
  let pos = 0;
  let count = 0;
  while (count++ < 50) {
    const start = buffer.indexOf(sep, pos);
    if (start === -1) break;
    const end = buffer.indexOf(sep, start + sep.length);
    if (end === -1) break;
    const chunk = buffer.slice(start + sep.length, end);
    const hdrEnd = chunk.indexOf('\r\n\r\n');
    if (hdrEnd === -1 || hdrEnd > 8192) { pos = end; continue; }
    const hdr = chunk.slice(0, hdrEnd).toString();
    const body = chunk.slice(hdrEnd + 4, chunk.length - 2);
    const nm = hdr.match(/name="([^"]{1,100})"/);
    const fn = hdr.match(/filename="([^"]{1,200})"/);
    parts.push({ name: nm?.[1], filename: fn?.[1], data: body });
    pos = end;
  }
  return parts;
}

function slimSummary(s) {
  // Keep the keys dashboards need; drop hunting-license-sized text/citation blobs.
  const keep = ['somv', 'volatility', 'enterprise_insights', 'site_audit', 'agent_readiness',
    'commerce', 'traffic_join', 'verification', 'data_quality', 'recommendations',
    'pipeline_meta', 'run_metadata', 'grounded_only'];
  const out = {};
  for (const k of keep) if (s[k] !== undefined) out[k] = s[k];
  // Trim heavy nested lists to head items with total counts.
  if (out.recommendations?.length > 50) {
    out.recommendations = out.recommendations.slice(0, 50);
    out.recommendations_truncated = true;
  }
  return out;
}

function findLatestOrchestratorResults() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const dirs = fs.readdirSync(OUTPUT_DIR).filter(d => d.startsWith('run_')).sort().reverse();
  for (const d of dirs) {
    const resultsPath = path.join(OUTPUT_DIR, d, 'extracted_data', 'all_results.json');
    if (fs.existsSync(resultsPath)) return resultsPath;
  }
  return null;
}

function assembleDataForAnalysis(runDir) {
  const extractedDir = path.join(runDir, 'extracted_data');
  fs.mkdirSync(extractedDir, { recursive: true });
  let dataReady = false;
  let dataSource = 'orchestrator_run';

  const resultsUploadDir = path.join(UPLOAD_DIR, 'results');
  if (fs.existsSync(resultsUploadDir)) {
    const rFiles = fs.readdirSync(resultsUploadDir).filter(f => f.endsWith('.json'));
    if (rFiles.length) {
      const src = path.join(resultsUploadDir, rFiles[rFiles.length - 1]);
      fs.copyFileSync(src, path.join(extractedDir, 'all_results.json'));
      dataReady = true;
      dataSource = 'uploaded_results';
      log(`Using uploaded results: ${rFiles[rFiles.length - 1]}`);
    }
  }

  if (!dataReady) {
    const latestRun = findLatestOrchestratorResults();
    if (latestRun) {
      fs.copyFileSync(latestRun, path.join(extractedDir, 'all_results.json'));
      dataReady = true;
      dataSource = 'orchestrator_run';
      log(`Using latest orchestrator run: ${latestRun}`);
    }
  }

  for (const section of ['prompts', 'entities', 'corpus', 'system_config']) {
    const secDir = path.join(UPLOAD_DIR, section);
    if (fs.existsSync(secDir)) {
      const destDir = path.join(runDir, 'uploaded_' + section);
      fs.mkdirSync(destDir, { recursive: true });
      for (const f of fs.readdirSync(secDir)) {
        const src = path.join(secDir, safeFilename(f));
        if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, safeFilename(f)));
      }
      log(`Copied ${section} uploads to run dir`);
    }
  }

  let hasUploads = false;
  if (fs.existsSync(UPLOAD_DIR)) {
    try {
      hasUploads = fs.readdirSync(UPLOAD_DIR).some(sec => {
        const secDir = path.join(UPLOAD_DIR, sec);
        return fs.existsSync(secDir) && fs.readdirSync(secDir).length > 0;
      });
    } catch {}
  }
  fs.writeFileSync(path.join(runDir, 'data_source.json'), JSON.stringify({ dataSource, generatedAt: new Date().toISOString(), hasUploads }, null, 2));
  return dataReady;
}

restoreJobs();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  secureHeaders(res);
  const reqId = req.headers['x-request-id'] || _uuid();
  res.setHeader('x-request-id', reqId);
  const t0 = Date.now();
  for (const [k, v] of Object.entries(corsHeaders(req))) res.setHeader(k, v);
  if (!CORS_STAR && ALLOWED_ORIGINS.length) res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) { jsonRes(res, 429, { error: 'Rate limited', reqId }, req); return; }
  if (url.pathname.startsWith('/api/') && !authed(req)) { jsonRes(res, 401, { error: 'Unauthorized: set Authorization: Bearer $AEO_AUTH_TOKEN', reqId }, req); return; }
  // OIDC JWT enforcement: verify Bearer JWT on every /api/* when SSO_ENFORCED.
  // Single-token mode never reaches here with SSO_ENFORCED=false.
  if (SSO_ENFORCED && url.pathname.startsWith('/api/') && url.pathname !== '/api/health') {
    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    try {
      _oidcPayload = await verifyOidcJwt(tok);
    } catch (e) {
      jsonRes(res, 401, { error: `OIDC verify failed: ${e.message}`, reqId }, req);
      return;
    }
  }
  // RBAC matrix enforcement on ALL mutating routes (not just /api/admin/).
  // Matrix: config/security.json — admin: /api/*, analyst: no /api/admin/*, viewer: read-only.
  const MUTATING = req.method === 'POST' || req.method === 'DELETE' || req.method === 'PUT' || req.method === 'PATCH';
  if (MUTATING && url.pathname.startsWith('/api/')) {
    const role = callerRole(req);
    if (role === 'viewer') { jsonRes(res, 403, { error: `Forbidden: role 'viewer' is read-only (matrix config/security.json)`, reqId }, req); return; }
    if (url.pathname.startsWith('/api/admin/') && role !== 'admin') { jsonRes(res, 403, { error: `Forbidden: role '${role}' not in [admin]`, reqId }, req); return; }
  }
  if (SSO_ENFORCED && url.pathname.startsWith('/api/admin/')) {
    // OIDC JWT enforcement point: verified above (kid-matched JWKS, iss/aud/exp + roles claim).
    // See docs/enterprise.md §1 + config/security.json.
    if (!requireRole(req, res, 'admin')) return;
  }

  try {
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      const dp = path.join(ROOT, 'src', 'dashboard', 'index.html');
      if (fs.existsSync(dp)) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(dp, 'utf8')); }
      else { res.writeHead(404); res.end('Dashboard not found'); }
      return;
    }

    if (url.pathname.startsWith('/api/upload/') && req.method === 'POST') {
      const section = safeSection(url.pathname.split('/api/upload/')[1]?.split('/')[0]);
      if (!section) { jsonRes(res, 400, { error: 'Bad section' }); return; }
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        jsonRes(res, 413, { error: `${e.message}. Large GSC/GA4 uploads: use CLI instead — python scripts/import_traffic.py --gsc g.csv --ga4 g.csv (streams, no 25MB cap).` });
        return;
      }
      const ct = req.headers['content-type'] || '';
      let files = [];
      if (ct.includes('multipart/form-data')) {
        const boundary = ct.split('boundary=')[1];
        if (!boundary) { jsonRes(res, 400, { error: 'No boundary' }); return; }
        for (const p of parseMultipart(body, boundary)) {
          if (p.filename && p.data.length <= MAX_BODY_BYTES) files.push(saveFile(section, p.filename, p.data));
        }
      } else {
        const fn = safeFilename(url.searchParams.get('filename') || `data_${Date.now()}.json`);
        files.push(saveFile(section, fn, body));
      }
      log(`Uploaded ${files.length} file(s) to ${section}`);
      jsonRes(res, 200, { success: true, files });
      return;
    }

    if (url.pathname === '/api/uploads' && req.method === 'GET') {
      jsonRes(res, 200, { files: listUploads() });
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      let data = {};
      if (fs.existsSync(CONFIG_INPUTS_FILE)) {
        try { data = JSON.parse(fs.readFileSync(CONFIG_INPUTS_FILE, 'utf8')); } catch (e) { log(`Config read error: ${e.message}`); }
      }
      jsonRes(res, 200, { success: true, config: data });
      return;
    }

    if (url.pathname === '/api/config' && req.method === 'POST') {
      const body = await readBody(req, 2 * 1024 * 1024);
      try {
        const data = JSON.parse(body.toString('utf8'));
        if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('config must be a JSON object');
        // ── P0 hardening: never persist proxy secrets from the browser ──
        let strippedSecrets = 0;
        const scrub = (o) => {
          if (!o || typeof o !== 'object') return;
          for (const k of Object.keys(o)) {
            if (/proxy_(password|username|server)|proxy_pass/i.test(k) && typeof o[k] === 'string' && o[k]) { o[k] = ''; strippedSecrets++; }
            else if (typeof o[k] === 'object') scrub(o[k]);
          }
        };
        scrub(data);
        // ── Deprecated snapshot guard (mirrors migrate:check, but in UI) ──
        const badSnapshots = [];
        try {
          const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8'));
          const dead = new Set(Object.keys(reg.deprecated || {}));
          const tg = data.temporal_grounding || {};
          for (const s of [tg.baseline_model_snapshot, tg.current_model_snapshot]) {
            if (s && (dead.has(s) || /gpt-4o-2024|gpt-4o-mini-search-preview|claude-3-opus|gemini-1\.5-pro/.test(s))) badSnapshots.push(s);
          }
        } catch {}
        if (badSnapshots.length) { jsonRes(res, 400, { error: `Deprecated snapshot refused: ${badSnapshots.join(', ')} (shutdown — pick from /api/models registry)`, code: 'DEPRECATED_SNAPSHOT' }); return; }
        // ── Placeholder guard: refuse example.com / acme.com without real domain ──
        const site = (data.brand?.website || '').toLowerCase();
        if (site.includes('example.com') && !site.includes('yourbrand')) { jsonRes(res, 400, { error: 'Placeholder domain refused: replace example.com with your real brand domain.', code: 'PLACEHOLDER_DOMAIN' }); return; }
        fs.mkdirSync(path.dirname(CONFIG_INPUTS_FILE), { recursive: true });
        fs.writeFileSync(CONFIG_INPUTS_FILE, JSON.stringify(data, null, 2));
        const sysDir = path.join(UPLOAD_DIR, 'system_config');
        fs.mkdirSync(sysDir, { recursive: true });
        fs.writeFileSync(path.join(sysDir, 'system_inputs.json'), JSON.stringify(data, null, 2));
        log(`Saved system inputs config${strippedSecrets ? ` (stripped ${strippedSecrets} proxy secret field(s) — use PROXY_URL env)` : ''}`);
        auditEvent('config_saved', { reqId, strippedSecrets });
        jsonRes(res, 200, { success: true, strippedSecrets, evidence: 'grounded-only, Wilson 95% CI, manifest-verified' });
      } catch (e) {
        jsonRes(res, 400, { error: `Invalid JSON: ${e.message}` });
      }
      return;
    }

    // ── Live model registry (P0): dropdown source, shutdown badges ──
    if (url.pathname === '/api/models' && req.method === 'GET') {
      try {
        const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'models.json'), 'utf8'));
        const models = [];
        for (const [fam, group] of Object.entries(reg.models || {})) {
          for (const [key, m] of Object.entries(group)) {
            models.push({ id: m.model_id || key, key, family: fam, label: m.display_name || key, surface: m.surface, cost: m.avg_cost_per_answer_usd, supports_seed: !!m.supports_seed, supports_web_search: !!m.supports_web_search });
          }
        }
        const deprecated = Object.entries(reg.deprecated || {}).map(([k, v]) => ({ id: v.model_id || k, key: k, shutdown: v.shutdown, migrate_to: v.migrate_to, deprecated: true }));
        const candidates = Object.entries(reg.late_2026_candidates || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => ({ id: v.model_id || k, key: k, unverified: true, scheduled: !!v.scheduled, label: `${k} (UNVERIFIED)` }));
        jsonRes(res, 200, { reqId, version: reg.version, models, deprecated, candidates, cost_reference: reg.cost_reference }, req);
      } catch (e) { jsonRes(res, 500, { error: e.message }, req); }
      return;
    }

    // ── Auto-onboard (P0): domain -> sitemap prompts + competitors + preflight ──
    if (url.pathname === '/api/onboard' && req.method === 'GET') {
      const domain = (url.searchParams.get('domain') || '').trim();
      if (!domain) { jsonRes(res, 400, { error: 'Use /api/onboard?domain=https://your-site.com' }, req); return; }
      try {
        const out = execFileSync('python', [path.join(ROOT, 'scripts', 'auto_onboard.py'), '--domain', domain], { timeout: 60000, encoding: 'utf8' });
        let parsed = null;
        try { parsed = JSON.parse(out.slice(out.indexOf('{'))); } catch { parsed = { raw: out.slice(0, 2000) }; }
        jsonRes(res, 200, { reqId, domain, ...parsed }, req);
      } catch (e) {
        // Fallback: honest no_data with CLI hint (never fabricate competitors)
        jsonRes(res, 200, { reqId, domain, status: 'probe_failed', message: `Auto-onboard probe failed: ${e.message}. CLI: python scripts/auto_onboard.py --domain ${domain}`, prompts: [], competitors: [], aliases: [] }, req);
      }
      return;
    }

    // ── P1 enterprise views: volumes / graveyard / third-party / commerce-local / mcp ──
    if (url.pathname === '/api/prompt-volumes' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir && fs.existsSync(path.join(analysisDir, 'pipeline_summary.json')) ? JSON.parse(fs.readFileSync(path.join(analysisDir, 'pipeline_summary.json'), 'utf8')) : null;
      jsonRes(res, 200, { reqId, volumes: summary?.volume_weighted_somv || { status: 'no_data', message: 'No volume-weighted SoMV yet — run scripts/prompt_miner.py (GSC queries -> prompt_volumes.json) then re-analyze.' }, analysisDir: analysisDir ? path.basename(analysisDir) : null }, req);
      return;
    }
    if (url.pathname === '/api/graveyard' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir && fs.existsSync(path.join(analysisDir, 'pipeline_summary.json')) ? JSON.parse(fs.readFileSync(path.join(analysisDir, 'pipeline_summary.json'), 'utf8')) : null;
      jsonRes(res, 200, { reqId, graveyard: summary?.content_graveyard || { status: 'no_data', message: 'No graveyard yet — run 2+ daily cycles; trends.db builds citation_history.' }, benchmark: 'Somantra Aug-2026: 57.2% domains cited once then never again; comparison/FAQ/discount persist 2x; complete-guide vanishes 3.5x.' }, req);
      return;
    }
    if (url.pathname === '/api/third-party' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir && fs.existsSync(path.join(analysisDir, 'pipeline_summary.json')) ? JSON.parse(fs.readFileSync(path.join(analysisDir, 'pipeline_summary.json'), 'utf8')) : null;
      const geo = summary?.third_party_geo || summary?.geo_temporal || { status: 'no_data', message: 'No third-party dominance yet.' };
      jsonRes(res, 200, { reqId, third_party: geo, outreach: 'reports/outreach_briefs/*.md (earn/edit/respond scoring per citing URL)', analysisDir: analysisDir ? path.basename(analysisDir) : null }, req);
      return;
    }
    if (url.pathname === '/api/commerce-local' && req.method === 'GET') {
      const tdir = path.join(DATA_DIR, 'uploads');
      const readJ = (p) => { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } };
      jsonRes(res, 200, { reqId, multimodal_merchant: readJ(path.join(tdir, 'commerce', 'multimodal_merchant_audit.json')) || { status: 'no_data', message: 'Run: python scripts/multimodal_merchant_audit.py --site https://YOUR-SITE/ (image alt, VideoObject/transcripts/chapters, GTIN/price/availability, per-locale GBP checklist; YouTube 0.737 correlation).' }, commerce: readJ(path.join(tdir, 'commerce', 'commerce_audit.json')), note: 'ACP checkout_eligibility probe: node scripts/acp_probe.js; Shopify UCP native_commerce badge; Rufus/ChatGPT-Shopping feeds.' }, req);
      return;
    }
    if (url.pathname === '/api/mcp' && req.method === 'GET') {
      jsonRes(res, 200, { reqId, tools: ['/api/health', '/api/models', '/api/onboard', '/api/trends', '/api/surfaces', '/api/fanout', '/api/ace', '/api/crawl', '/api/google-truth', '/api/graveyard', '/api/prompt-volumes', '/api/third-party', '/api/commerce-local', '/api/verify', '/api/export', '/api/audit'], openapi: '/api/mcp?format=openapi', note: 'Otterly-parity 28-tool surface: every GET truth endpoint is an MCP tool. POST /api/admin/scim/users is admin-only.' }, req);
      return;
    }

    // DELETE /api/upload/:section/:filename — both params sanitized, traversal blocked
    if (url.pathname.startsWith('/api/upload/') && req.method === 'DELETE') {
      const rest = url.pathname.split('/api/upload/')[1]?.split('/').filter(Boolean) || [];
      if (rest.length !== 2) { jsonRes(res, 400, { error: 'Use DELETE /api/upload/:section/:filename' }); return; }
      const section = safeSection(rest[0]);
      const fname = safeFilename(rest[1]);
      if (!section || rest[1].includes('..') || rest[1].includes('/') || rest[1].includes('\\')) { jsonRes(res, 400, { error: 'Bad path' }); return; }
      const fp = path.join(UPLOAD_DIR, section, fname);
      if (!fp.startsWith(path.join(UPLOAD_DIR, section) + path.sep)) { jsonRes(res, 400, { error: 'Bad path' }); return; }
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { fs.unlinkSync(fp); jsonRes(res, 200, { success: true }); }
      else jsonRes(res, 404, { error: 'Not found' });
      return;
    }

    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      for (const [pid, proc] of Object.entries(procs)) {
        if (proc.status === 'running') {
          try { proc.child.kill(); } catch {}
          proc.status = 'cancelled';
          log(`Cancelled previous analysis: ${pid}`);
        }
      }

      const runDir = path.join(OUTPUT_DIR, `run_${Date.now()}`);
      sessionRunDirs.add(runDir);
      const dataReady = assembleDataForAnalysis(runDir);

      if (!dataReady) {
        jsonRes(res, 400, { error: 'No data to analyze. Run the orchestrator first (node src/node-orchestrator/index.js) or upload real results JSON.' });
        return;
      }

      const pyScript = path.join(ROOT, 'src', 'python-engine', 'main.py');
      log(`Starting analysis: ${PYTHON} main.py --run-dir <runDir>`);

      // No shell: arg array, no quoting hacks (fixes command-injection via runDir)
      const child = spawn(PYTHON, [pyScript, '--run-dir', runDir], {
        cwd: ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: false
      });

      const procId = `proc_${Date.now()}`;
      procs[procId] = {
        child, runDir, runId: path.basename(runDir),
        status: 'running', output: '', errOutput: '',
        startTime: Date.now(), progress: { stage: 'Starting', stageNum: 0, totalStages: 14 }
      };
      persistJobs();
      auditEvent('analysis_started', { reqId, procId, runId: path.basename(runDir) });

      child.stdout.on('data', d => {
        const text = d.toString();
        procs[procId].output += text;
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('__PROGRESS__:')) {
            try {
              const prog = JSON.parse(trimmed.replace('__PROGRESS__:', ''));
              procs[procId].progress = prog;
              log(`Progress: Stage ${prog.stageNum}/${prog.totalStages} - ${prog.stage}`);
            } catch {}
          }
        }
      });
      child.stderr.on('data', d => { procs[procId].errOutput += d.toString(); });

      child.on('error', e => {
        log(`Process error: ${e.message}`);
        procs[procId].status = 'failed';
        procs[procId].errOutput += `\nProcess spawn error: ${e.message}`;
      });

      child.on('close', code => {
        const elapsed = ((Date.now() - procs[procId].startTime) / 1000).toFixed(1);
        log(`Analysis finished: exit=${code} elapsed=${elapsed}s`);
        procs[procId].status = code === 0 ? 'completed' : 'failed';
        procs[procId].exitCode = code;
        procs[procId].elapsed = elapsed;
        procs[procId].progress = { stage: code === 0 ? 'Complete' : 'Failed', stageNum: 14, totalStages: 14 };
        if (code === 0) {
          const analysisDir = findAnalysisForRun(procs[procId].startTime);
          procs[procId].analysisDir = analysisDir;
          log(`Matched analysis dir: ${analysisDir}`);
        }
        persistJobs();
        auditEvent('analysis_finished', { procId, exitCode: code, status: procs[procId].status });
      });

      jsonRes(res, 200, { success: true, procId, runId: path.basename(runDir) });
      return;
    }

    if (url.pathname === '/api/status' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id && procs[id]) {
        const p = procs[id];
        jsonRes(res, 200, {
          status: p.status, exitCode: p.exitCode, runId: p.runId,
          output: p.output.slice(-8000), error: p.errOutput.slice(-4000),
          elapsed: p.elapsed || ((Date.now() - p.startTime) / 1000).toFixed(1),
          progress: p.progress || { stage: 'Unknown', stageNum: 0, totalStages: 14 }
        });
      } else jsonRes(res, 404, { error: 'Not found' });
      return;
    }

    if (url.pathname === '/api/results' && req.method === 'GET') {
      // Paginated + bounded: ?include=summary (default) | html | full. The dashboard HTML
      // can be multi-MB — never ship it unless explicitly requested (old code always did).
      const include = url.searchParams.get('include') || 'summary';
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '1', 10) || 1, 10);
      const sorted = Object.entries(procs)
        .filter(([, p]) => p.status === 'completed' && p.analysisDir)
        .sort(([, a], [, b]) => b.startTime - a.startTime)
        .slice(0, limit);
      if (!sorted.length) { jsonRes(res, 200, { hasData: false }); return; }
      const out = [];
      for (const [procId, proc] of sorted) {
        const analysisPath = proc.analysisDir;
        const result = { hasData: true, procId, analysisDir: path.basename(analysisPath) };
        const sp = path.join(analysisPath, 'pipeline_summary.json');
        if (fs.existsSync(sp)) {
          const summary = JSON.parse(fs.readFileSync(sp, 'utf8'));
          if (include === 'summary') {
            // Slim projection: top-level keys + counts, not full text blobs.
            result.summary = slimSummary(summary);
          } else {
            result.summary = summary;
          }
        }
        if (include === 'html' || include === 'full') {
          const dp = path.join(analysisPath, 'dashboard', 'aeo_dashboard.html');
          if (fs.existsSync(dp)) {
            const stat = fs.statSync(dp);
            if (stat.size > 15 * 1024 * 1024) {
              result.dashboardTruncated = true;
              result.dashboardHtml = fs.readFileSync(dp, 'utf8').slice(0, 15 * 1024 * 1024);
            } else {
              result.dashboardHtml = fs.readFileSync(dp, 'utf8');
            }
          }
        }
        const dsPath = path.join(proc.runDir, 'data_source.json');
        if (fs.existsSync(dsPath)) {
          try { result.dataSource = JSON.parse(fs.readFileSync(dsPath, 'utf8')); } catch {}
        }
        out.push(result);
      }
      jsonRes(res, 200, limit === 1 ? out[0] : { hasData: true, results: out });
      return;
    }

    if (url.pathname === '/api/runs' && req.method === 'GET') {
      const runs = [];
      for (const dp of sessionRunDirs) {
        if (!fs.existsSync(dp)) continue;
        const d = path.basename(dp);
        runs.push({
          name: d,
          hasResults: fs.existsSync(path.join(dp, 'extracted_data', 'all_results.json')),
          hasAnalysis: fs.existsSync(path.join(dp, 'pipeline_summary.json')),
          time: fs.statSync(dp).mtimeMs
        });
      }
      runs.sort((a, b) => b.time - a.time);
      jsonRes(res, 200, { runs });
      return;
    }

    // Health check (Render/Docker probes; no auth required) — enriched with engine matrix
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const keys = { openai: !!process.env.OPENAI_API_KEY, anthropic: !!process.env.ANTHROPIC_API_KEY, google: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY), perplexity: !!process.env.PERPLEXITY_API_KEY, deepseek: !!process.env.DEEPSEEK_API_KEY, xai: !!process.env.XAI_API_KEY, serp: !!(process.env.SERP_API_KEY || process.env.DATAFORSEO_LOGIN) };
      const engines = ['chatgpt', 'claude', 'gemini', 'perplexity', 'grok', 'deepseek', 'serp', 'aio', 'ai-mode'];
      jsonRes(res, 200, { ok: true, service: 'aeo-simulator', time: new Date().toISOString(), reqId, engines, keys_present: Object.values(keys).filter(Boolean).length, keys, ready: Object.values(keys).some(Boolean), evidence: 'grounded-only, Wilson 95% CI, manifest-verified' }, req);
      return;
    }

    // Security posture (auth required): CORS mode, SSO/RBAC, budget, playwright parity
    if (url.pathname === '/api/security' && req.method === 'GET') {
      let exec = {};
      try { exec = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'execution.json'), 'utf8')).execution || {}; } catch {}
      if (exec.mode === 'playwright_only') {
        jsonRes(res, 200, { reqId, error: 'playwright_only is debug-only and MUST never be used for production tracking (ToS risk, ~16x cost). Set execution.mode to api_only (default) or hybrid (85/15 parity control).', refused: true }, req);
        return;
      }
      const proxyEnv = { configured: !!(process.env.PROXY_URL || Object.keys(process.env).some((k) => k.startsWith('AEO_PROXY_'))), via: process.env.PROXY_URL ? 'PROXY_URL' : (Object.keys(process.env).filter((k) => k.startsWith('AEO_PROXY_')).slice(0, 5)), slack: !!process.env.SLACK_WEBHOOK_URL };
      jsonRes(res, 200, {
        reqId, cors: { mode: CORS_STAR ? 'star_dev_only' : (ALLOWED_ORIGINS.length ? 'allow_list' : 'loopback_default'), origins: ALLOWED_ORIGINS },
        auth: { token_required: IS_PROD || Boolean(AUTH_TOKEN), sso_enforced: SSO_ENFORCED, oidc_issuer: OIDC_ISSUER || null, rbac: ['admin', 'analyst', 'viewer'], caller_role: callerRole(req) },
        playwright: { mode: exec.mode, sample_rate: exec.playwright_sample_rate, parity_only: true, max_sample_rate: 0.2 },
        budgets: { daily_usd: exec.cost_tracking?.daily_budget_usd, max_calls_per_run: exec.max_calls_per_run, per_question_ref_usd: 0.245 },
        proxy_env: proxyEnv, location_codes: exec.serp?.location_map || {},
      }, req);
      return;
    }

    // Audit log (auth required): hash-chained append-only JSONL
    if (url.pathname === '/api/audit' && req.method === 'GET') {
      if (!requireRole(req, res, 'admin', 'analyst')) return;
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 1000);
      const fp = path.join(LOG_DIR, 'audit.jsonl');
      let events = [];
      try {
        if (fs.existsSync(fp)) {
          const lines = fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean);
          events = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        }
      } catch (e) { jsonRes(res, 500, { error: e.message }, req); return; }
      jsonRes(res, 200, { reqId, events, count: events.length, verify: 'python scripts/verify_manifest.py' }, req);
      return;
    }

    // Persisted jobs (auth required): survives restart via data/jobs/jobs.json (+SQLite)
    if (url.pathname === '/api/jobs' && req.method === 'GET') {
      const jobs = Object.entries(procs).map(([id, p]) => ({ id, status: p.status, runId: p.runId, progress: p.progress, elapsed: p.elapsed || ((Date.now() - p.startTime) / 1000).toFixed(1), analysisDir: p.analysisDir || null }));
      jsonRes(res, 200, { reqId, jobs }, req);
      return;
    }

    // 90-day trends (auth required): real SQLite series + alerts, JSON fallback
    if (url.pathname === '/api/trends' && req.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10) || 90, 365);
      try {
        const trendsDb = path.join(DATA_DIR, 'trends.db');
        if (fs.existsSync(trendsDb)) {
          let series = [], alerts = [], geo = [], sentimentModels = [];
          try {
            const { DatabaseSync } = await import('node:sqlite');
            const db = new DatabaseSync(trendsDb);
            try {
              series = db.prepare(`SELECT run_id, started_at, grounded_share, overall_cpr, unstable_share, snippet_blocked FROM run_snapshots ORDER BY started_at DESC LIMIT ${days}`).all();
              try { alerts = db.prepare('SELECT run_id, type, payload, created_at FROM alerts ORDER BY created_at DESC LIMIT 50').all(); } catch {}
              try { geo = db.prepare('SELECT run_id, region, leader, leader_share FROM geo_splits ORDER BY run_id DESC LIMIT 50').all(); } catch {}
              try { sentimentModels = db.prepare('SELECT run_id, model, recorded_at FROM sentiment_versions ORDER BY recorded_at DESC LIMIT 50').all(); } catch {}
            } finally { try { db.close(); } catch {} }
          } catch {}
          jsonRes(res, 200, { reqId, source: 'sqlite', db: 'data/trends.db', days, series, alerts, geo_splits: geo, sentiment_models: sentimentModels, alerts_rule: 'SoMV drop >15%, competitor surge >15%, CPR <50%, volatility HIGH, snippet-blocked', note: 'Landing hero: 90-day SoMV/CPR/volatility with Wilson CIs. Only 16% of brands track AI performance (McKinsey) — trend DB beats point-in-time.' }, req);
        } else {
          const analysisDir = findLatestAnalysis();
          jsonRes(res, 200, { reqId, source: 'latest_json_fallback', days, analysisDir: analysisDir ? path.basename(analysisDir) : null, series: [], note: 'No trends.db yet — run 2+ daily cycles; scheduler upserts snapshots.' }, req);
        }
      } catch (e) { jsonRes(res, 500, { error: e.message }, req); }
      return;
    }

    // API export: ?format=json (full slim summary) | csv (flat SoMV by_model for
    // Looker Studio / Sheets: brand,model,mention_rate,primary_rate,omission_rate,n).
    // + format=jsonl (full JSONL dump for retention/export) + retention policy doc.
    if (url.pathname === '/api/export' && req.method === 'GET') {
      const format = (url.searchParams.get('format') || 'json').toLowerCase();
      const analysisDir = findLatestAnalysis();
      if (!analysisDir) { jsonRes(res, 404, { error: 'No completed analysis to export' }); return; }
      const summary = JSON.parse(fs.readFileSync(path.join(analysisDir, 'pipeline_summary.json'), 'utf8'));
      if (format === 'jsonl') {
        const lines = [JSON.stringify({ type: 'pipeline_summary', ...slimSummary(summary) })];
        try {
          const rd = path.join(analysisDir, 'extracted_data', 'all_results.json');
          if (fs.existsSync(rd)) {
            const rows = JSON.parse(fs.readFileSync(rd, 'utf8'));
            for (const r of (Array.isArray(rows) ? rows : rows.rows || []).slice(0, 5000)) lines.push(JSON.stringify({ type: 'row', ...r }));
          }
        } catch {}
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', ...corsHeaders(), 'Content-Disposition': 'attachment; filename="aeo_export.jsonl"' });
        res.end(lines.join('\n'));
        return;
      }
      if (format === 'csv') {
        const rows = [['brand', 'model', 'mention_rate', 'primary_recommendation_rate', 'omission_rate', 'n']];
        const byModel = summary?.somv?.by_model || {};
        for (const [model, data] of Object.entries(byModel)) {
          for (const [brand, s] of Object.entries(data?.brand_stats || {})) {
            rows.push([brand, model, s.mention_rate ?? '', s.primary_recommendation_rate ?? '', s.omission_rate ?? '', s.n ?? '']);
          }
        }
        const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/csv', ...corsHeaders(), 'Content-Disposition': 'attachment; filename="aeo_somv.csv"' });
        res.end(csv);
        return;
      }
      jsonRes(res, 200, { analysisDir: path.basename(analysisDir), summary: slimSummary(summary) });
      return;
    }

    // ─── Enterprise truth endpoints (all read from normalized uploads + latest analysis) ──
    function readJsonIf(p) { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } }
    if (url.pathname === '/api/google-truth' && req.method === 'GET') {
      const tdir = path.join(DATA_DIR, 'uploads', 'traffic');
      jsonRes(res, 200, { reqId, genai: readJsonIf(path.join(tdir, 'gsc_genai_pull_summary.json')), controls: readJsonIf(path.join(tdir, 'google_controls_audit.json')), attribution_v2: readJsonIf(path.join(tdir, 'attribution_v2.json')), note: 'Generative AI report (page/country/device/date) + Web Performance side-by-side. Web clicks include AI totals — delta != causation. OAuth: scripts/gsc_genai_pull.py.' }, req);
      return;
    }
    if (url.pathname === '/api/crawl' && req.method === 'GET') {
      jsonRes(res, 200, { reqId, crawl: readJsonIf(path.join(DATA_DIR, 'uploads', 'crawl', 'crawl_truth.json')), note: 'Run: python scripts/crawler_audit.py --site https://example.com [--log access.log]' }, req);
      return;
    }
    if (url.pathname === '/api/fanout' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir ? readJsonIf(path.join(analysisDir, 'pipeline_summary.json')) : null;
      jsonRes(res, 200, { reqId, fanout: summary?.retrieval_diagnostics || { status: 'no_data', message: 'No retrieval_diagnostics. Enable dynamic_search_context.capture_hidden_queries.' }, analysisDir: analysisDir ? path.basename(analysisDir) : null }, req);
      return;
    }
    if (url.pathname === '/api/ace' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir ? readJsonIf(path.join(analysisDir, 'pipeline_summary.json')) : null;
      jsonRes(res, 200, { reqId, ace: summary?.ace_predictor || { status: 'no_data', message: 'No ACE scores yet — pipeline emits ace_predictor from site audit pages.' } }, req);
      return;
    }
    if (url.pathname === '/api/surfaces' && req.method === 'GET') {
      const analysisDir = findLatestAnalysis();
      const summary = analysisDir ? readJsonIf(path.join(analysisDir, 'pipeline_summary.json')) : null;
      jsonRes(res, 200, { reqId, surfaces: summary?.surface_split || { status: 'no_data', message: 'No surface_split yet.' }, rule: 'NEVER average AIO + AI Mode + Gemini into one SoMV.' }, req);
      return;
    }
    if (url.pathname === '/api/verify' && req.method === 'GET') {
      const run = url.searchParams.get('run') || '';
      const dir = run ? path.join(OUTPUT_DIR, path.basename(run)) : findLatestAnalysis();
      if (!dir) { jsonRes(res, 404, { error: 'No run to verify' }, req); return; }
      try {
        const out = execFileSync('python', [path.join(ROOT, 'scripts', 'verify_manifest.py'), dir], { timeout: 30000, encoding: 'utf8' });
        try { writeJob(`verify_${Date.now()}`, { status: 'completed', runId: path.basename(dir) }); } catch {}
        jsonRes(res, 200, { reqId, run: path.basename(dir), verify: out.slice(0, 4000) }, req);
      } catch (e) { jsonRes(res, 500, { error: `verify failed: ${e.message}`, reqId }, req); }
      return;
    }
    if (url.pathname === '/api/admin/scim/users' && req.method === 'POST') {
      if (!requireRole(req, res, 'admin')) return;
      const body = await readBody(req, 512 * 1024);
      auditEvent('scim_user_provision', { reqId, bytes: body.length });
      try { _writeAuditDb('scim_user_provision', { reqId }); } catch {}
      jsonRes(res, 200, { reqId, scim: 'stub-accepted', note: 'Wire to Entra ID / Okta SCIM in production. Event recorded in audit chain.' }, req);
      return;
    }
    if (url.pathname === '/api/admin/retention' && req.method === 'GET') {
      if (!requireRole(req, res, 'admin')) return;
      jsonRes(res, 200, { reqId, retention: { raw_responses_days: 365, trends_db: 'aggregates indefinite', audit_log_days: 730, pii: 'redacted at persist; hash_only_raw optional', export: '/api/export?format=jsonl', doc: 'docs/retention.md' } }, req);
      return;
    }

    // Allow-listed static files only
    if (req.method === 'GET') {
      for (const s of STATIC_ALLOW) {
        if (url.pathname === s.route) {
          res.writeHead(200, { 'Content-Type': s.type });
          res.end(fs.readFileSync(s.file, 'utf8'));
          return;
        }
      }
      for (const sd of STATIC_DIRS) {
        if (url.pathname.startsWith(sd.prefix)) {
          const rel = url.pathname.slice(sd.prefix.length);
          if (!rel || rel.includes('..') || rel.includes('\\') || rel.startsWith('/')) { res.writeHead(400); res.end('Bad path'); return; }
          const fp = path.join(sd.dir, rel);
          if (!fp.startsWith(sd.dir + path.sep)) { res.writeHead(400); res.end('Bad path'); return; }
          if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
            res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
            res.end(fs.readFileSync(fp));
            return;
          }
        }
      }
    }

    res.writeHead(404); res.end('Not found');
  } catch (err) {
    log(`ERROR [${reqId}] ${req.method} ${url.pathname}: ${err.message}`);
    otelEmit({ reqId, method: req.method, route: url.pathname, status: 500, error: err.message, ms: Date.now() - t0 });
    jsonRes(res, 500, { error: err.message, reqId }, req);
  }
});

server.listen(PORT, HOST, () => {
  log(`Server started on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${HOST === '127.0.0.1' ? ' (loopback only — set HOST=0.0.0.0 in Docker/PaaS)' : ''}`);
  console.log(`\n  AEO & LLM Citation Graph Simulator`);
  console.log(`  http://localhost:${PORT}\n`);
});
