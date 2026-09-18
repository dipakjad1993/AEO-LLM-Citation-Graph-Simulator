"""
Agent Readiness — scored RIGHT (2026).
llms.txt is experimental + low-confidence, NOT a Google ranking factor
(Gary Illyes / John Mueller). Score it for Claude/OpenAI agents, plus:
  MCP / WebMCP Tool Contract (navigator.modelContext)
  UCP for Shopify (/api/ucp/mcp search_catalog)
  ACP for ChatGPT Shopping
  isitagentready-style checklist
"""
import json
import logging
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

AGENT_UA = 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +agent-check)'


@lru_cache(maxsize=64)
def _fetch(url: str, timeout: int = 10) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': AGENT_UA})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read(200000).decode('utf-8', 'ignore')
    except Exception:
        return None


def _fetch_many(urls, timeout=10, workers=5):
    out = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_fetch, u, timeout): u for u in urls}
        for f, u in futs.items():
            try:
                out[u] = f.result()
            except Exception:
                out[u] = None
    return out


def _valid_mcp_manifest(body: Optional[str]) -> bool:
    if not body:
        return False
    try:
        data = json.loads(body)
    except Exception:
        return False
    if isinstance(data, dict):
        tools = data.get('tools') or data.get('capabilities') or data.get('functions')
        return isinstance(tools, list) and len(tools) > 0
    return False


class AgentReadiness:
    def __init__(self, config: Dict):
        self.config = config
        em = config.get('entity_maps', {}).get('entity_maps', {})
        self.website = ((em.get('your_brand', {}) or {}).get('website') or '').rstrip('/')

    def analyze(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {'website': self.website, 'checks': {}, 'score': 0, 'verdict': '', 'caveats': []}
        if not self.website:
            result['status'] = 'no_website'
            return result
        checks = {}

        # 1. llms.txt (experimental — agents only)
        llms = _fetch(self.website + '/llms.txt')
        llms_full = _fetch(self.website + '/llms-full.txt')
        llms_score = 0
        llms_notes = []
        if llms:
            llms_score += 50
            llms_notes.append('llms.txt present.')
            if re.search(r'^##?\s+', llms, re.M): llms_score += 20; llms_notes.append('Markdown sections found.')
            if len(llms) > 2000: llms_score += 15; llms_notes.append('Substantive length (>2k chars).')
            if 'http' in llms: llms_score += 15; llms_notes.append('Contains canonical links.')
        else:
            llms_notes.append('No llms.txt — fine for Google (not a ranking factor), missed convenience for Claude/OpenAI agents.')
        checks['llms_txt'] = {'score': llms_score, 'present': bool(llms), 'llms_full': bool(llms_full), 'notes': llms_notes,
                              'weight_note': 'Experimental. Score for agents only — do NOT sell as SEO.'}

        # 2. MCP / WebMCP Tool Contract (+ UCP search_catalog, JSON-validated)
        mcp_paths = ['/.well-known/mcp.json', '/mcp.json', '/api/mcp', '/api/ucp/mcp']
        fetched = _fetch_many([self.website + p for p in mcp_paths])
        mcp_hits = []
        mcp_validated = []
        for path in mcp_paths:
            body = fetched.get(self.website + path)
            if body and ('search_catalog' in body or 'mcp' in body.lower()[:500]):
                mcp_hits.append(path)
            if _valid_mcp_manifest(body):
                mcp_validated.append(path)
        mcp_score = 100 if mcp_hits else 0
        checks['mcp_webmcp'] = {'score': mcp_score, 'endpoints_found': mcp_hits, 'json_validated': mcp_validated,
            'validation_note': 'Substring probe is a smoke signal only; json_validated lists endpoints returning a parseable tool manifest.',
            'e2e': 'Run python scripts/mcp_tool_test.py <site> [--tool search_catalog] to actually CALL the tool (JSON-RPC tools/call), not just parse JSON.',
            'notes': [f'MCP/UCP endpoint(s): {mcp_hits}'] if mcp_hits else ['No MCP/WebMCP Tool Contract or UCP search_catalog found.']}

        # 3. ACP (ChatGPT Shopping / agentic checkout)
        acp_score = 0
        acp_notes = []
        home = _fetch(self.website) or ''
        if 'agentic-checkout' in home or 'ACP' in home[:5000]:
            acp_score = 100; acp_notes.append('ACP/agentic-checkout signals found.')
        else:
            acp_notes.append('No ACP (Agentic Commerce Protocol) signals — required for ChatGPT Shopping checkout.')
        checks['acp'] = {'score': acp_score, 'notes': acp_notes}

        # 4. Machine-readable basics agents reuse
        basics = 0
        basics_notes = []
        if _fetch(self.website + '/robots.txt'): basics += 34; basics_notes.append('robots.txt present.')
        if _fetch(self.website + '/sitemap.xml'): basics += 33; basics_notes.append('sitemap.xml present.')
        if 'application/ld+json' in home: basics += 33; basics_notes.append('JSON-LD present.')
        checks['machine_basics'] = {'score': basics, 'notes': basics_notes}

        weights = {'llms_txt': 0.15, 'mcp_webmcp': 0.35, 'acp': 0.25, 'machine_basics': 0.25}
        total = round(sum(checks[k]['score'] * w for k, w in weights.items()), 1)
        result['checks'] = checks
        result['score'] = total
        result['verdict'] = ('Agent-ready' if total >= 75 else 'Partially agent-ready' if total >= 45 else 'Not agent-ready')
        result['caveats'] = [
            'llms.txt does NOT improve Google AI Overviews / AI Mode ranking (per Google, May 2026).',
            'MCP/WebMCP + UCP + ACP are the agentic-action layer — prioritize those over llms.txt.',
        ]
        result['status'] = 'scored'
        return result

    def save(self, results: Dict, output_dir) -> None:
        import json
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'agent_readiness.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info('Saved agent readiness to %s', reports)
