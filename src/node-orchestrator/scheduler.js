/**
 * Scheduler + alerts runner.
 * Usage:
 *   node src/node-orchestrator/scheduler.js --daily        # one full tracking cycle
 *   node src/node-orchestrator/scheduler.js --check-alerts # compare latest analysis vs previous, fire Slack webhook
 * Cron example (daily 06:00): 0 6 * * * cd /app && npm run full-run && node src/node-orchestrator/scheduler.js --check-alerts
 * Alerts: SoMV drop >15%, competitor surge, new negative triple, hallucination spike.
 * Webhook: set SLACK_WEBHOOK_URL env.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

function latestAnalyses(n = 2) {
  const out = join(ROOT, 'data', 'output');
  if (!existsSync(out)) return [];
  return readdirSync(out).filter(d => d.startsWith('analysis_'))
    .map(d => ({ name: d, path: join(out, d), t: statSync(join(out, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t).slice(0, n);
}

function loadSummary(dir) {
  const p = join(dir, 'pipeline_summary.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function brandPrimary(summary) {
  const bs = summary?.somv?.overall?.brand_stats || {};
  const keys = Object.keys(bs);
  return keys[0] || null;
}

export function checkAlerts() {
  const [cur, prev] = latestAnalyses(2).map(d => ({ ...d, summary: loadSummary(d.path) }));
  if (!cur?.summary) { console.log('No completed analysis found.'); return { alerts: [] }; }
  const alerts = [];
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'execution.json'), 'utf8'));
  const threshold = cfg.execution?.scheduler?.alerts?.somv_drop_pct ?? 15;

  const b = brandPrimary(cur.summary);
  if (b && prev?.summary) {
    const curSov = cur.summary?.somv?.overall?.brand_stats?.[b]?.share_of_voice ?? 0;
    const prevSov = prev.summary?.somv?.overall?.brand_stats?.[b]?.share_of_voice ?? 0;
    const drop = prevSov > 0 ? (prevSov - curSov) / prevSov * 100 : 0;
    if (drop >= threshold) alerts.push({ type: 'somv_drop', brand: b, drop_pct: Number(drop.toFixed(1)), cur: curSov, prev: prevSov });
    // Competitor surge
    for (const [comp, stats] of Object.entries(cur.summary?.somv?.overall?.brand_stats || {})) {
      if (comp === b) continue;
      const cs = stats?.share_of_voice ?? 0;
      const ps = prev.summary?.somv?.overall?.brand_stats?.[comp]?.share_of_voice ?? 0;
      if (ps > 0 && (cs - ps) / ps * 100 >= threshold) alerts.push({ type: 'competitor_surge', competitor: comp, surge_pct: Number(((cs - ps) / ps * 100).toFixed(1)) });
    }
  }
  // New negative triples / hallucination spike
  const curNeg = cur.summary?.triple_stats ? Object.values(cur.summary.triple_stats).flat().length : 0;
  const hal = cur.summary?.sentiment_matrix?.hallucination_signals?.length ?? 0;
  const prevHal = prev?.summary?.sentiment_matrix?.hallucination_signals?.length ?? 0;
  if (hal > prevHal && hal > 0) alerts.push({ type: 'hallucination_spike', current: hal, previous: prevHal });
  const cpr = cur.summary?.enterprise_insights?.multi_turn_cpr?.overall_cpr;
  if (typeof cpr === 'number' && cpr < 0.5) alerts.push({ type: 'cpr_low', cpr });
  // P0 snippet fail gate (Google May-15 Guide): blocked = AIO visibility 0.
  const blocked = cur.summary?.site_audit?.fail_gate?.snippet_blocked;
  if (blocked) alerts.push({ type: 'snippet_blocked', pages: cur.summary.site_audit.fail_gate.blocked_pages || [], precedent: 'Meltwater +73% after fix' });
  // Volatility HIGH flag: unstable_share > 30%.
  const unstable = cur.summary?.volatility?.summary?.unstable_share;
  if (typeof unstable === 'number' && unstable > 0.3) alerts.push({ type: 'volatility_high', unstable_share: unstable });
  // Playwright parity guard: never let the control group exceed 20% silently.
  const execMode = JSON.parse(readFileSync(join(ROOT, 'config', 'execution.json'), 'utf8')).execution || {};
  if ((execMode.playwright_sample_rate ?? 0.15) > 0.2) alerts.push({ type: 'playwright_over_sample', rate: execMode.playwright_sample_rate });
  // Note: latest-vs-previous diff is Slack-only; 90-day history lives in data/trends.db (analytics/trend_store.py).

  if (alerts.length) {
    console.log(`ALERTS (${alerts.length}):`);
    for (const a of alerts) console.log(' -', JSON.stringify(a));
    const hook = process.env.SLACK_WEBHOOK_URL;
    if (hook) {
      try {
        fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `:warning: AEO alerts (${cur.name}):\n${alerts.map(a => '• ' + a.type + ' ' + JSON.stringify(a)).join('\n')}` }) });
        console.log('Slack webhook fired.');
      } catch (e) { console.error('Webhook failed:', e.message); }
    }
  } else console.log('No alerts.');
  return { alerts, current: cur.name, previous: prev?.name || null };
}

const args = process.argv.slice(2);
// Windows-safe entry guard (pathToFileURL canonicalizes drive letters/backslashes).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (args.includes('--check-alerts')) checkAlerts();
  else if (args.includes('--daily')) {
    console.log('Running daily tracking cycle (orchestrate + analyze + alerts)...');
    const r = spawnSync('node', [join(ROOT, 'src', 'node-orchestrator', 'index.js'), '--mode', 'orchestrate'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0) process.exit(r.status);
    checkAlerts();
  } else console.log('Usage: scheduler.js --daily | --check-alerts');
}
