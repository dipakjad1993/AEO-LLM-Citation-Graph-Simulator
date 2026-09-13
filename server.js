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
// Basic per-IP rate limit (60 req/min)
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
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

function jsonRes(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

function authed(req) {
  if (!AUTH_TOKEN) return true; // dev default; set AEO_AUTH_TOKEN in prod
  const h = req.headers.authorization || '';
  return h === `Bearer ${AUTH_TOKEN}`;
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  secureHeaders(res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const ip = req.socket.remoteAddress || 'unknown';
  if (rateLimited(ip)) { jsonRes(res, 429, { error: 'Rate limited' }); return; }
  if (url.pathname.startsWith('/api/') && !authed(req)) { jsonRes(res, 401, { error: 'Unauthorized: set Authorization: Bearer $AEO_AUTH_TOKEN' }); return; }

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
      const sorted = Object.entries(procs)
        .filter(([, p]) => p.status === 'completed' && p.analysisDir)
        .sort(([, a], [, b]) => b.startTime - a.startTime);
      if (!sorted.length) { jsonRes(res, 200, { hasData: false }); return; }
      const [procId, proc] = sorted[0];
      const analysisPath = proc.analysisDir;
      const result = { hasData: true, analysisDir: path.basename(analysisPath) };
      const sp = path.join(analysisPath, 'pipeline_summary.json');
      if (fs.existsSync(sp)) result.summary = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const dp = path.join(analysisPath, 'dashboard', 'aeo_dashboard.html');
      if (fs.existsSync(dp)) result.dashboardHtml = fs.readFileSync(dp, 'utf8');
      const dsPath = path.join(proc.runDir, 'data_source.json');
      if (fs.existsSync(dsPath)) {
        try { result.dataSource = JSON.parse(fs.readFileSync(dsPath, 'utf8')); } catch {}
      }
      jsonRes(res, 200, result);
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
      jsonRes(res, 200, { ok: true, service: 'aeo-simulator', time: new Date().toISOString() });
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
    log(`ERROR: ${err.message}`);
    jsonRes(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  log(`Server started on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}${HOST === '127.0.0.1' ? ' (loopback only — set HOST=0.0.0.0 in Docker/PaaS)' : ''}`);
  console.log(`\n  AEO & LLM Citation Graph Simulator`);
  console.log(`  http://localhost:${PORT}\n`);
});
