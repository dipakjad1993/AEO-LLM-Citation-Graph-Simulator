/**
 * ACP checkout_eligibility live probe (cron-safe).
 * Usage: node scripts/acp_probe.js https://example.com [--cron]
 * Checks /agentic-checkout + /.well-known/acp.json for checkout_eligibility markers.
 * Exit 0 = eligible, 2 = not eligible (wire --cron to scheduler + Slack).
 */
import { readFileSync, existsSync } from 'fs';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base || base.startsWith('--')) { console.error('Usage: node scripts/acp_probe.js https://example.com [--cron]'); process.exit(1); }
const cron = process.argv.includes('--cron');
const UA = 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +acp-probe)';

async function get(p) {
  try { const r = await fetch(base + p, { headers: { 'User-Agent': UA } }); return await r.text(); }
  catch { return ''; }
}
const page = await get('/agentic-checkout');
const manifest = await get('/.well-known/acp.json');
const hay = (page + manifest).toLowerCase();
const signals = ['checkout_eligibility', 'agentic-checkout', 'agenticcommerce'].filter(s => hay.includes(s));
console.log(JSON.stringify({ base, checkout_eligible: signals.length > 0, signals, spec: 'agenticcommerce.dev' }, null, 2));
if (!signals.length) {
  console.log('NOT ELIGIBLE: no ACP markers — ChatGPT Shopping cannot complete checkout on this domain.');
  if (cron && process.env.SLACK_WEBHOOK_URL) {
    try { await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `🛒 ACP probe (${base}): NOT checkout-eligible — publish /agentic-checkout per agenticcommerce.dev` }) }); } catch {}
  }
  process.exit(2);
}
