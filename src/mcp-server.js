/**
 * Minimal MCP (Model Context Protocol) server — READ-ONLY audit surface.
 *
 * Exposes the latest AEO analysis over stdio JSON-RPC so Claude / agents can
 * query grounded SoMV, verification, and commerce numbers without touching files.
 * Tools: latest_summary | brand_sov | verification | commerce | traffic
 *
 * Run: node src/mcp-server.js
 * Claude Desktop config: { "command": "node", "args": ["<abs>/src/mcp-server.js"] }
 *
 * No auth here by design for local stdio; never expose over TCP without AEO_AUTH_TOKEN.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(__filename), '..');

function latestAnalysis() {
  const out = path.join(ROOT, 'data', 'output');
  if (!fs.existsSync(out)) return null;
  const dirs = fs.readdirSync(out).filter((d) => d.startsWith('analysis_')).sort().reverse();
  for (const d of dirs) {
    const p = path.join(out, d, 'pipeline_summary.json');
    if (fs.existsSync(p)) return { dir: d, summary: JSON.parse(fs.readFileSync(p, 'utf8')) };
  }
  return null;
}

const TOOLS = {
  latest_summary: {
    description: 'Top-level AEO run metadata + grounded share + verification counts',
    run: (s) => ({
      grounded_share: s?.somv?.grounded_only?.grounded_share,
      verification: s?.claim_verification?.overall,
      recommendations: (s?.recommendations || []).length,
    }),
  },
  brand_sov: {
    description: 'Share-of-voice brand table. Args: { brand } (optional, default all)',
    run: (s, a) => {
      const stats = s?.somv?.overall?.brand_stats || {};
      return a?.brand ? { [a.brand]: stats[a.brand] || null } : stats;
    },
  },
  verification: {
    description: 'Ground-truth claim verification report (verified/contradicted claims)',
    run: (s) => s?.claim_verification || null,
  },
  commerce: {
    description: 'Commerce truth: product-card rate, feed health, ACP/UCP/Rufus checks',
    run: (s) => s?.commerce || null,
  },
  traffic: {
    description: 'GSC generative-inclusion gate + GA4 AI-referrer revenue join',
    run: (s) => s?.traffic_join || null,
  },
};

function respond(id, result, error) {
  const msg = { jsonrpc: '2.0', id };
  if (error) msg.error = { code: -32000, message: String(error?.message || error) };
  else msg.result = result;
  process.stdout.write(JSON.stringify(msg) + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    try {
      const { id, method, params } = req;
      if (method === 'initialize') {
        respond(id, { protocolVersion: '2024-11-05', serverInfo: { name: 'aeo-audit', version: '2.0.0' } });
      } else if (method === 'tools/list') {
        respond(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description })) });
      } else if (method === 'tools/call') {
        const tool = TOOLS[params?.name];
        if (!tool) { respond(id, null, `unknown tool ${params?.name}`); continue; }
        const found = latestAnalysis();
        if (!found) { respond(id, null, 'no completed analysis found'); continue; }
        respond(id, { content: [{ type: 'text', text: JSON.stringify(tool.run(found.summary, params?.arguments || {}), null, 2) }] });
      } else {
        respond(id, null, `unsupported method ${method}`);
      }
    } catch (e) { respond(req?.id ?? null, null, e); }
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.error('aeo-audit MCP server (stdio) ready — tools: ' + Object.keys(TOOLS).join(', '));
}
