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
const UPLOAD_SECTIONS = new Set(['prompts', 'entities', 'corpus', 'gold_standards', 'system_config', 'results']);
// Static serving is allow-listed: dashboard + screenshots only. Never serve arbitrary ROOT files.
const STATIC_ALLOW = [
  { route: '/', file: path.join(ROOT, 'src', 'dashboard', 'index.html'), type: 'text/html' },
  { route: '/index.html', file: path.join(ROOT, 'src', 'dashboard', 'index.html'), type: 'text/html' },
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

// ─── OIDC / RBAC stubs (enterprise SSO) ─────────────────────────────────────
const OIDC_ISSUER = process.env.AEO_OIDC_ISSUER || '';
const OIDC_AUDIENCE = process.env.AEO_OIDC_AUDIENCE || '';
const OIDC_JWKS = process.env.AEO_OIDC_JWKS_URL || '';
const SSO_ENFORCED = Boolean(OIDC_ISSUER && OIDC_JWKS);
if (!SSO_ENFORCED) log('Auth mode: single-token (dev/SMB). Set AEO_OIDC_ISSUER/AUDIENCE/JWKS_URL for OIDC JWT + RBAC.');
else log(`Auth mode: OIDC JWT enforced (issuer=${OIDC_ISSUER}) with roles admin|analyst|viewer.`);
function callerRole(req) {
  const r = (req.headers['x-aeo-role'] || req.headers['x-role'] || '').toLowerCase();
  if (['admin', 'analyst', 'viewer'].includes(r)) return r;
  return AUTH_TOKEN ? 'admin' : 'viewer'; // single-token mode: token holder is admin
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
  if (SSO_ENFORCED && url.pathname.startsWith('/api/admin/')) {
    // OIDC JWT enforcement point: verify Bearer JWT against JWKS (kid-matched), check aud/iss/exp + roles claim.
    // Single-token mode never reaches here with SSO_ENFORCED=false; see docs/enterprise.md §1 + config/security.json.
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
      const body = await readBody(req);
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
        fs.mkdirSync(path.dirname(CONFIG_INPUTS_FILE), { recursive: true });
        fs.writeFileSync(CONFIG_INPUTS_FILE, JSON.stringify(data, null, 2));
        const sysDir = path.join(UPLOAD_DIR, 'system_config');
        fs.mkdirSync(sysDir, { recursive: true });
        fs.writeFileSync(path.join(sysDir, 'system_inputs.json'), JSON.stringify(data, null, 2));
        log('Saved system inputs config');
        jsonRes(res, 200, { success: true });
      } catch (e) {
        jsonRes(res, 400, { error: `Invalid JSON: ${e.message}` });
      }
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

    // Health check (Render/Docker probes; no auth required)
    if (url.pathname === '/api/health' && req.method === 'GET') {
      jsonRes(res, 200, { ok: true, service: 'aeo-simulator', time: new Date().toISOString(), reqId }, req);
      return;
    }

    // Security posture (auth required): CORS mode, SSO/RBAC, budget, playwright parity
    if (url.pathname === '/api/security' && req.method === 'GET') {
      let exec = {};
      try { exec = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'execution.json'), 'utf8')).execution || {}; } catch {}
      jsonRes(res, 200, {
        reqId, cors: { mode: CORS_STAR ? 'star_dev_only' : (ALLOWED_ORIGINS.length ? 'allow_list' : 'loopback_default'), origins: ALLOWED_ORIGINS },
        auth: { token_required: IS_PROD || Boolean(AUTH_TOKEN), sso_enforced: SSO_ENFORCED, oidc_issuer: OIDC_ISSUER || null, rbac: ['admin', 'analyst', 'viewer'], caller_role: callerRole(req) },
        playwright: { mode: exec.mode, sample_rate: exec.playwright_sample_rate, parity_only: true, max_sample_rate: 0.2 },
        budgets: { daily_usd: exec.cost_tracking?.daily_budget_usd, max_calls_per_run: exec.max_calls_per_run },
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

    // 90-day trends (auth required): SQLite trend store, JSON fallback
    if (url.pathname === '/api/trends' && req.method === 'GET') {
      const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10) || 90, 365);
      try {
        const trendsDb = path.join(DATA_DIR, 'trends.db');
        if (fs.existsSync(trendsDb)) {
          jsonRes(res, 200, { reqId, source: 'sqlite', db: 'data/trends.db', days, note: 'Query via analytics/trend_store.py; dashboard renders 90-day SoMV/CPR/volatility with CIs.' }, req);
        } else {
          const analysisDir = findLatestAnalysis();
          jsonRes(res, 200, { reqId, source: 'latest_json_fallback', days, analysisDir: analysisDir ? path.basename(analysisDir) : null, note: 'No trends.db yet — run 2+ daily cycles; scheduler upserts snapshots.' }, req);
        }
      } catch (e) { jsonRes(res, 500, { error: e.message }, req); }
      return;
    }

    // API export: ?format=json (full slim summary) | csv (flat SoMV by_model for
    // Looker Studio / Sheets: brand,model,mention_rate,primary_rate,omission_rate,n).
    if (url.pathname === '/api/export' && req.method === 'GET') {
      const format = (url.searchParams.get('format') || 'json').toLowerCase();
      const analysisDir = findLatestAnalysis();
      if (!analysisDir) { jsonRes(res, 404, { error: 'No completed analysis to export' }); return; }
      const summary = JSON.parse(fs.readFileSync(path.join(analysisDir, 'pipeline_summary.json'), 'utf8'));
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
