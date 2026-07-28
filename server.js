import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = __filename.replace(/server\.js$/, '').replace(/\\/g, '/');
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUT_DIR = path.join(DATA_DIR, 'output');
const LOG_DIR = path.join(ROOT, 'logs');

[UPLOAD_DIR, OUTPUT_DIR, LOG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));

const MIME = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};

const procs = {};
const sessionRunDirs = new Set(); // track run dirs created in this session

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
  try { fs.appendFileSync(path.join(LOG_DIR, 'server.log'), `[${ts}] ${msg}\n`); } catch {}
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { chunks.push(c); size += c.length; if (size > 500 * 1024 * 1024) { req.destroy(); reject(new Error('File too large (500MB limit)')); } });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonRes(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function findPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    try { execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 }); return cmd; } catch {}
  }
  return 'python';
}

const PYTHON = findPython();
log(`Python executable: ${PYTHON}`);
function q(p) { return `"${p}"`; }

function saveFile(section, filename, data) {
  const dir = path.join(UPLOAD_DIR, section);
  fs.mkdirSync(dir, { recursive: true });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fp = path.join(dir, safe);
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
  const parts = [];
  const sep = Buffer.from(`--${boundary}`);
  let pos = 0;
  while (true) {
    const start = buffer.indexOf(sep, pos);
    if (start === -1) break;
    const end = buffer.indexOf(sep, start + sep.length);
    if (end === -1) break;
    const chunk = buffer.slice(start + sep.length, end);
    const hdrEnd = chunk.indexOf('\r\n\r\n');
    if (hdrEnd === -1) { pos = end; continue; }
    const hdr = chunk.slice(0, hdrEnd).toString();
    const body = chunk.slice(hdrEnd + 4, chunk.length - 2);
    const nm = hdr.match(/name="([^"]+)"/);
    const fn = hdr.match(/filename="([^"]+)"/);
    parts.push({ name: nm?.[1], filename: fn?.[1], data: body });
    pos = end;
  }
  return parts;
}

function assembleDataForAnalysis(runDir) {
  const extractedDir = path.join(runDir, 'extracted_data');
  fs.mkdirSync(extractedDir, { recursive: true });
  let dataReady = false;

  // 1. Check uploaded results
  const resultsUploadDir = path.join(UPLOAD_DIR, 'results');
  if (fs.existsSync(resultsUploadDir)) {
    const rFiles = fs.readdirSync(resultsUploadDir).filter(f => f.endsWith('.json'));
    if (rFiles.length) {
      const src = path.join(resultsUploadDir, rFiles[rFiles.length - 1]);
      fs.copyFileSync(src, path.join(extractedDir, 'all_results.json'));
      dataReady = true;
      log(`Using uploaded results: ${rFiles[rFiles.length - 1]}`);
    }
  }

  // 2. Check demo data
  if (!dataReady) {
    const demoPath = path.join(OUTPUT_DIR, 'run_demo_001', 'extracted_data', 'all_results.json');
    if (fs.existsSync(demoPath)) {
      fs.copyFileSync(demoPath, path.join(extractedDir, 'all_results.json'));
      dataReady = true;
      log('Using demo/sample data');
    }
  }

  // 3. Copy uploaded prompts/entities/corpus/system_config as supplementary config
  for (const section of ['prompts', 'entities', 'corpus', 'system_config']) {
    const secDir = path.join(UPLOAD_DIR, section);
    if (fs.existsSync(secDir)) {
      const destDir = path.join(runDir, 'uploaded_' + section);
      fs.mkdirSync(destDir, { recursive: true });
      for (const f of fs.readdirSync(secDir)) {
        fs.copyFileSync(path.join(secDir, f), path.join(destDir, f));
      }
      log(`Copied ${section} uploads to run dir`);
    }
  }

  // Write data source metadata
  const hasUploads = fs.readdirSync(UPLOAD_DIR).some(sec => {
    const secDir = path.join(UPLOAD_DIR, sec);
    return fs.existsSync(secDir) && fs.readdirSync(secDir).length > 0;
  });
  const metadata = {
    dataSource: hasUploads ? 'uploaded_prompts' : 'synthetic_sample',
    generatedAt: new Date().toISOString(),
    hasUploads
  };
  fs.writeFileSync(path.join(runDir, 'data_source.json'), JSON.stringify(metadata, null, 2));

  return dataReady;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    // Dashboard
    if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
      const dp = path.join(ROOT, 'src', 'dashboard', 'index.html');
      if (fs.existsSync(dp)) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(fs.readFileSync(dp, 'utf8')); }
      else { res.writeHead(404); res.end('Dashboard not found'); }
      return;
    }

    // Upload file
    if (url.pathname.startsWith('/api/upload/') && req.method === 'POST') {
      const section = url.pathname.split('/api/upload/')[1];
      const allowed = ['prompts','entities','corpus','gold_standards','system_config','results'];
      if (!allowed.includes(section)) { jsonRes(res, 400, { error: 'Bad section' }); return; }
      const body = await readBody(req);
      const ct = req.headers['content-type'] || '';
      let files = [];
      if (ct.includes('multipart/form-data')) {
        const boundary = ct.split('boundary=')[1];
        if (!boundary) { jsonRes(res, 400, { error: 'No boundary' }); return; }
        for (const p of parseMultipart(body, boundary)) {
          if (p.filename) files.push(saveFile(section, p.filename, p.data));
        }
      } else {
        const fn = url.searchParams.get('filename') || `data_${Date.now()}.json`;
        files.push(saveFile(section, fn, body));
      }
      log(`Uploaded ${files.length} file(s) to ${section}`);
      jsonRes(res, 200, { success: true, files });
      return;
    }

    // List uploads
    if (url.pathname === '/api/uploads' && req.method === 'GET') {
      jsonRes(res, 200, { files: listUploads() });
      return;
    }

    // Delete upload
    if (url.pathname.startsWith('/api/upload/') && req.method === 'DELETE') {
      const parts = url.pathname.split('/');
      const fp = path.join(UPLOAD_DIR, parts[3], parts[4]);
      if (fs.existsSync(fp)) { fs.unlinkSync(fp); jsonRes(res, 200, { success: true }); }
      else jsonRes(res, 404, { error: 'Not found' });
      return;
    }

    // Generate sample data
    if (url.pathname === '/api/sample' && req.method === 'POST') {
      log('Generating sample data...');
      const script = path.join(ROOT, 'src', 'python-engine', 'generate_sample_data.py');
      const child = spawn(PYTHON, [q(script)], { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: '1' }, shell: true });
      let out = '', err = '';
      child.stdout.on('data', d => out += d.toString());
      child.stderr.on('data', d => err += d.toString());
      child.on('error', e => { log('Sample gen error: ' + e.message); jsonRes(res, 500, { error: e.message }); });
      child.on('close', code => {
        log(`Sample gen exit: ${code}`);
        if (code === 0) jsonRes(res, 200, { success: true, output: out });
        else jsonRes(res, 500, { error: err || out || 'Failed' });
      });
      return;
    }

    // Start analysis
    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      // Allow re-analysis: just cancel previous if still running
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
        jsonRes(res, 400, { error: 'No data to analyze. Upload results JSON or generate sample data first.' });
        return;
      }

      const pyScript = path.join(ROOT, 'src', 'python-engine', 'main.py');
      log(`Starting analysis: ${PYTHON} ${pyScript} --run-dir ${runDir}`);

      const child = spawn(PYTHON, [q(pyScript), '--run-dir', q(runDir)], {
        cwd: ROOT,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: true
      });

      const procId = `proc_${Date.now()}`;
      procs[procId] = {
        child, runDir, runId: path.basename(runDir),
        status: 'running', output: '', errOutput: '',
        startTime: Date.now(), progress: { stage: 'Starting', stageNum: 0, totalStages: 8 }
      };

      child.stdout.on('data', d => {
        const text = d.toString();
        procs[procId].output += text;
        // Parse progress JSON lines from Python
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
        procs[procId].progress = { stage: code === 0 ? 'Complete' : 'Failed', stageNum: 8, totalStages: 8 };
        // Find the analysis dir that was created during this run
        if (code === 0) {
          const analysisDir = findAnalysisForRun(procs[procId].startTime);
          procs[procId].analysisDir = analysisDir;
          log(`Matched analysis dir: ${analysisDir}`);
        }
      });

      jsonRes(res, 200, { success: true, procId, runId: path.basename(runDir) });
      return;
    }

    // Analysis status
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (id && procs[id]) {
        const p = procs[id];
        jsonRes(res, 200, {
          status: p.status, exitCode: p.exitCode, runId: p.runId,
          output: p.output.slice(-8000), error: p.errOutput.slice(-4000),
          elapsed: p.elapsed || ((Date.now() - p.startTime) / 1000).toFixed(1),
          progress: p.progress || { stage: 'Unknown', stageNum: 0, totalStages: 8 }
        });
      } else jsonRes(res, 404, { error: 'Not found' });
      return;
    }

    // Results - only from current session (in-memory procs), never old disk data
    if (url.pathname === '/api/results' && req.method === 'GET') {
      const sorted = Object.entries(procs)
        .filter(([, p]) => p.status === 'completed' && p.analysisDir)
        .sort(([, a], [, b]) => b.startTime - a.startTime);
      if (!sorted.length) { jsonRes(res, 200, { hasData: false }); return; }
      const analysisPath = sorted[0][1].analysisDir;
      const result = { hasData: true, analysisDir: path.basename(analysisPath) };
      const sp = path.join(analysisPath, 'pipeline_summary.json');
      if (fs.existsSync(sp)) result.summary = JSON.parse(fs.readFileSync(sp, 'utf8'));
      const dp = path.join(analysisPath, 'dashboard', 'aeo_dashboard.html');
      if (fs.existsSync(dp)) result.dashboardHtml = fs.readFileSync(dp, 'utf8');
      // Check data source metadata
      const metaPath = path.join(analysisPath, '..', 'data_source.json');
      const runDirPath = path.dirname(analysisPath);
      const dsPath = path.join(runDirPath, 'data_source.json');
      if (fs.existsSync(dsPath)) {
        try { result.dataSource = JSON.parse(fs.readFileSync(dsPath, 'utf8')); } catch {}
      }
      jsonRes(res, 200, result);
      return;
    }

    // Runs list - only current session runs
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

    // Static files
    if (req.method === 'GET') {
      const fp = path.join(ROOT, decodeURIComponent(url.pathname));
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(fs.readFileSync(fp));
        return;
      }
    }

    res.writeHead(404); res.end('Not found');
  } catch (err) {
    log(`ERROR: ${err.message}`);
    jsonRes(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Server started on http://localhost:${PORT}`);
  console.log(`\n  AEO & LLM Citation Graph Simulator`);
  console.log(`  http://localhost:${PORT}\n`);
});
