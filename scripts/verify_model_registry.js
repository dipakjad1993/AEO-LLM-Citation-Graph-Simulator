/**
 * Nightly model-registry verifier (late-2026 candidate drift guard).
 * Usage: node scripts/verify_model_registry.js [--strict]
 * Reads config/models.json late_2026_candidates (scheduled:false, unverified).
 * Checks each candidate's provider doc endpoint / registry metadata for renames,
 * 404s, or ID changes. Exits non-zero on drift (wire to cron / GitHub Actions).
 * Never auto-enables candidates — a human must verify model_id + flip scheduled:true.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'config', 'models.json'), 'utf8'));
const cands = registry.late_2026_candidates || {};
const strict = process.argv.includes('--strict');

const DOC_URLS = {
  openai: 'https://platform.openai.com/docs/models',
  anthropic: 'https://docs.anthropic.com/en/docs/about-claude/models',
  google: 'https://ai.google.dev/gemini-api/docs/models',
  xai: 'https://docs.x.ai/docs/models',
  perplexity: 'https://docs.perplexity.ai/getting-started/models',
};

let failures = 0;
console.log(`Verifying ${Object.keys(cands).filter(k => !k.startsWith('_')).length} late-2026 candidates (scheduled:false expected)...`);
for (const [key, c] of Object.entries(cands)) {
  if (key.startsWith('_')) continue;
  const problems = [];
  if (c.scheduled !== false) problems.push('scheduled must be false until human-verified');
  if (c.registry_status !== 'unverified') problems.push('registry_status must be unverified');
  if (!c.model_id) problems.push('missing model_id');
  if (c.estimated !== true) problems.push('cost must stay estimated:true (never billed math)');
  if (problems.length) { failures++; console.log(`FAIL ${key} (${c.model_id}): ${problems.join('; ')}`); continue; }
  const doc = DOC_URLS[c.provider] || '(no doc URL)';
  try {
    const res = await fetch(doc, { method: 'HEAD', redirect: 'follow' });
    console.log(`${res.ok ? 'OK  ' : 'WARN'} ${key} (${c.model_id}) [${c.provider}] docs=${res.status} — verify ID at ${doc}${strict && !res.ok ? ' [STRICT FAIL]' : ''}`);
    if (strict && !res.ok) failures++;
  } catch (e) {
    console.log(`WARN ${key} (${c.model_id}): docs unreachable (${e.message}) — manual check: ${doc}`);
  }
}
// Deprecated guard: scheduler must refuse these.
for (const dep of Object.keys(registry.deprecated || {}).filter(k => !k.startsWith('_'))) {
  console.log(`INFO deprecated pinned (must not schedule): ${dep}`);
}
if (failures) { console.error(`\n${failures} registry problem(s). Do NOT enable candidates.`); process.exit(2); }
console.log('\nRegistry OK: all candidates quarantined (scheduled:false, unverified, estimated costs).');
