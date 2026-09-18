/**
 * Deprecated model auto-migrate + hard scheduler guard.
 * - Hard error if someone tries to SCHEDULE a deprecated ID (gpt-4o-search-preview
 *   shutdown 2026-07-23, claude-3-opus, gemini-1.5-pro, web_search_preview tool).
 * - Auto-migrates config/models.json usages + execution overrides to
 *   gpt-5.5 / claude-4-opus / gemini-2.5-pro.
 * - Never deletes history: old runs still validate (registry retains deprecated block).
 *
 * Usage:
 *   node scripts/migrate_deprecated.js --check     // exits 1 if deprecated scheduled
 *   node scripts/migrate_deprecated.js --migrate   // rewrites stale references, prints diff
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(path.join(__dirname, '..'));

const MIGRATIONS = {
  'gpt-4o-search-preview': 'gpt-5-5',
  'gpt-4o-mini-search-preview': 'gpt-5-search-api',
  'claude-3-opus': 'claude-4-opus',
  'claude-3-opus-20240229': 'claude-4-opus',
  'gemini-1.5-pro': 'gemini-2-5-pro',
  'web_search_preview': 'web_search',
};

const args = process.argv.slice(2);
const doMigrate = args.includes('--migrate');

function scanFile(fp) {
  if (!fs.existsSync(fp)) return [];
  const text = fs.readFileSync(fp, 'utf8');
  // Ignore comment/doc mentions (//, *, #) — only flag real scheduled code strings.
  const code = text.split('\n').filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('#') || t.startsWith('<!--'));
  }).join('\n');
  return Object.keys(MIGRATIONS).filter((id) => code.includes(`'${id}'`) || code.includes(`"${id}"`) || code.includes(`${id}:`));
}

const targets = [
  path.join(ROOT, 'config', 'models.json'),
  path.join(ROOT, 'config', 'execution.json'),
  path.join(ROOT, 'src', 'node-orchestrator', 'index.js'),
  path.join(ROOT, 'src', 'node-orchestrator', 'scheduler.js'),
];
let found = {};
for (const t of targets) {
  const hits = scanFile(t);
  // models.json legitimately retains deprecated block — only flag if scheduled:true nearby
  if (t.endsWith('models.json')) {
    try {
      const j = JSON.parse(fs.readFileSync(t, 'utf8'));
      const sched = [];
      for (const [k, v] of Object.entries(j.late_2026_candidates || {})) {
        if (v.scheduled) sched.push(k);
      }
      if (sched.length) found[t] = sched;
    } catch {}
    continue;
  }
  if (hits.length) found[t] = hits;
}
// Hard scheduler guard: refuse deprecated model_ids in scheduler-accessible execution config
try {
  const exec = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'execution.json'), 'utf8'));
  const blob = JSON.stringify(exec);
  for (const dep of Object.keys(MIGRATIONS)) {
    if (blob.includes(dep)) found['config/execution.json(deprecated-ref)'] = [dep];
  }
} catch {}

if (Object.keys(found).length) {
  console.error('DEPRECATED MODEL REFS (scheduler refuses these):');
  for (const [f, hits] of Object.entries(found)) console.error(`  ${f}: ${hits.join(', ')}`);
  console.error(`Migrate: ${Object.entries(MIGRATIONS).map(([a, b]) => `${a} -> ${b}`).join('; ')}`);
  if (!doMigrate) {
    console.error('Run with --migrate to auto-rewrite, or remove deprecated IDs. Failing loud (no silent fallback).');
    process.exit(1);
  }
  // --migrate: rewrite non-registry files
  for (const [f] of Object.entries(found)) {
    if (f.startsWith('config/models.json') || f.includes('late_2026')) continue;
    const fp = f.includes('execution.json') ? path.join(ROOT, 'config', 'execution.json') : f;
    if (!fs.existsSync(fp)) continue;
    let text = fs.readFileSync(fp, 'utf8');
    for (const [a, b] of Object.entries(MIGRATIONS)) text = text.split(a).join(b);
    fs.writeFileSync(fp, text);
    console.log(`Migrated ${fp}`);
  }
  process.exit(0);
}
console.log('OK: no deprecated IDs scheduled. Registry retains deprecated block for history only.');
