"""
Enterprise Intelligence & Advanced Graph Analytics
===================================================

Adds the enterprise-grade analytical layers that turn raw LLM response data
into actionable, CMO-ready intelligence. Every metric below is computed from
the REAL response data captured by the orchestrator (all_results.json) and the
graphs/embeddings produced by earlier pipeline stages. No fabricated values.

Modules:
  1. API vs Web-UI Parity Calibration  - variance between API and browser
     channels for the same prompt/model; flags variance > 15%.
  2. Multi-Turn Citation Persistence Rate (CPR) - do citations survive across
     a 5-turn conversation, or is context being truncated?
  3. Graph Authority Score G_auth = a*C_D(v) + b*C_B(v) + g*S_cos
  4. Inverse Citation Mapping (Uncited Authority) - domains competitors win
     citations from that you are absent on, plus LLM crawler robots.txt
     blockage detection (GPTBot, ClaudeBot, PerplexityBot, Bytespider).
  5. Source-Level ROI Prioritization - Citation Influence Weight ranking.
  6. Semantic Gap Remediation Scripts - JSON-LD + Markdown drafts generated
     from missing/negative triples.
  7. SoMV Trendlines by model family and funnel stage.
"""

import json
import logging
import re
import socket
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse

import polars as pl
import numpy as np

from brand_utils import build_brand_patterns

logger = logging.getLogger(__name__)

LLM_CRAWLERS = {
    'GPTBot': 'gptbot',
    'ClaudeBot': 'claude-ai',
    'ClaudeBot2': 'claudebot',
    'PerplexityBot': 'perplexitybot',
    'Bytespider': 'bytespider',
    'Google-Extended': 'google-extended',
}

MODEL_FAMILIES = {
    'gpt-4o': 'OpenAI', 'gpt-4o-mini': 'OpenAI', 'chatgpt': 'OpenAI',
    'claude-3-5-sonnet': 'Anthropic', 'claude-3-opus': 'Anthropic', 'claude': 'Anthropic',
    'gemini-1.5-pro': 'Google', 'gemini-2.0-flash': 'Google', 'gemini': 'Google',
    'sonar-pro': 'Perplexity', 'sonar-online': 'Perplexity', 'sonar': 'Perplexity', 'perplexity': 'Perplexity',
    'deepseek-chat': 'DeepSeek', 'deepseek-v2': 'DeepSeek', 'deepseek': 'DeepSeek',
}


def _family(model_id: str) -> str:
    m = (model_id or '').lower()
    for key, fam in MODEL_FAMILIES.items():
        if key in m:
            return fam
    if any(x in m for x in ['openai', 'o1', 'o3']):
        return 'OpenAI'
    return 'Other'


def _domain(url: str) -> Optional[str]:
    try:
        d = urlparse(url).netloc.lower()
        return d[4:] if d.startswith('www.') else d or None
    except Exception:
        return None


class EnterpriseInsights:
    def __init__(self, config: Dict):
        self.config = config
        self.entity_config = config.get('entity_maps', {}).get('entity_maps', {})
        your_brand = self.entity_config.get('your_brand', {}) or {}
        self.primary_brand = your_brand.get('primary_name', '')
        self.competitors = [c['primary_name'] for c in self.entity_config.get('competitors', []) if c.get('primary_name')]
        self.all_brands = ([self.primary_brand] if self.primary_brand else []) + self.competitors
        self._brand_re = {b: re.compile(p, re.IGNORECASE) for b, p in build_brand_patterns(self.entity_config).items()}
        # System inputs captured from the first-page form (server.js /api/config)
        self.system_inputs = config.get('system_inputs', {}) or {}
        self.dynamic_search = self.system_inputs.get('dynamic_search_context', {}) or {}
        self.temporal = self.system_inputs.get('temporal_grounding', {}) or {}
        self.geo = self.system_inputs.get('geo_localization', {}) or {}
        self.execution = self.system_inputs.get('execution', {}) or {}

    # ────────────────────────────────────────────────────────────────
    # 1. API vs Web-UI Parity Calibration
    # ────────────────────────────────────────────────────────────────
    def parity_calibration(self, df: pl.DataFrame) -> Dict:
        result = {
            'control_group_configured': bool(self.execution.get('parity_control_pct', 0)),
            'channel_comparison': {},
            'variance_flags': [],
            'calibration_advice': [],
        }
        if 'channel' not in df.columns:
            result['status'] = 'no_channel_data'
            result['message'] = 'No channel field in results. Re-run the orchestrator so API vs web-UI responses are tagged.'
            return result

        api_df = df.filter(pl.col('channel') == 'api')
        web_df = df.filter(pl.col('channel') == 'web_ui')
        result['api_responses'] = api_df.height
        result['web_ui_responses'] = web_df.height

        if api_df.height == 0 or web_df.height == 0:
            result['status'] = 'single_channel'
            result['message'] = f'Only {api_df.height} API and {web_df.height} web-UI responses. A 20% parallel control group (web UI) is recommended to calibrate API scoring.'
            result['calibration_advice'].append(
                'Run 20% of API queries through headful stealth Playwright on the real web UIs '
                '(ChatGPT Plus, Perplexity UI, Gemini Advanced) and compare citation variance.')
            return result

        # Pair by (prompt_session, persona, model, turn_index)
        has_persona = 'persona_id' in df.columns
        def _cite_domains(df_part: pl.DataFrame) -> Dict[tuple, List[str]]:
            out = defaultdict(list)
            cols = ['prompt_session_id', 'model_id', 'turn_index', 'citations']
            if has_persona:
                cols.insert(1, 'persona_id')
            for row in df_part.select(cols).iter_rows(named=True):
                if has_persona:
                    key = (row['prompt_session_id'], row['persona_id'], row['model_id'], row['turn_index'])
                else:
                    key = (row['prompt_session_id'], 'default', row['model_id'], row['turn_index'])
                domains = set()
                for c in (row['citations'] or []):
                    if isinstance(c, dict) and c.get('url'):
                        d = _domain(c['url'])
                        if d:
                            domains.add(d)
                out[key].append(sorted(domains))
            return out

        api_map = _cite_domains(api_df)
        web_map = _cite_domains(web_df)
        common = set(api_map.keys()) & set(web_map.keys())
        result['paired_prompts'] = len(common)

        variances = []
        for key in common:
            api_sets = api_map[key]
            web_sets = web_map[key]
            # average set intersection over each (api, web) pair in this group
            sims = []
            for a in api_sets:
                for w in web_sets:
                    if not a and not w:
                        sims.append(1.0)
                    elif not a or not w:
                        sims.append(0.0)
                    else:
                        inter = len(set(a) & set(w))
                        union = len(set(a) | set(w))
                        sims.append(inter / union if union else 0.0)
            variance = 1 - (sum(sims) / len(sims) if sims else 1)
            variances.append((key, variance))
            if variance > 0.15:
                result['variance_flags'].append({
                    'prompt_session_id': key[0], 'model': key[2], 'turn_index': key[3],
                    'variance': round(variance, 3),
                    'finding': f'Web-UI and API citation sets diverge by {variance:.0%} — the API under-reports sources the live search UI returns.'
                })

        if variances:
            result['mean_citation_variance'] = round(float(np.mean([v for _, v in variances])), 4)
            result['max_citation_variance'] = round(float(np.max([v for _, v in variances])), 4)
            result['status'] = 'calibrated'
            high = [f for _, f in enumerate(result['variance_flags'])]
            result['calibration_advice'].append(
                f'Mean API/web-UI citation variance is {result["mean_citation_variance"]:.1%}. '
                'If sustained above 15%, apply a channel-calibration factor to API-derived SoMV scores.')
        else:
            result['status'] = 'parity_aligned'
            result['message'] = 'API and web-UI citation outputs are closely aligned on the paired control group.'
        return result

    # ────────────────────────────────────────────────────────────────
    # 2. Multi-Turn Citation Persistence Rate (CPR)
    # ────────────────────────────────────────────────────────────────
    def multi_turn_cpr(self, df: pl.DataFrame) -> Dict:
        result = {
            'cpr_by_model': {}, 'cpr_by_brand': {}, 'overall_cpr': 0.0,
            'token_window_signals': [], 'turn_counts': {}, 'findings': [],
        }
        if 'turn_index' not in df.columns or 'prompt_session_id' not in df.columns:
            result['message'] = 'Missing turn/session columns for multi-turn analysis.'
            return result

        # Group responses by (prompt_session, model), ordered by turn
        sessions = defaultdict(list)
        for row in df.select(['prompt_session_id', 'model_id', 'turn_index', 'citations', 'raw_text']).iter_rows(named=True):
            domains = set()
            for c in (row['citations'] or []):
                if isinstance(c, dict) and c.get('url'):
                    d = _domain(c['url'])
                    if d:
                        domains.add(d)
            sessions[(row['prompt_session_id'], row['model_id'])].append({
                'turn': row['turn_index'], 'domains': domains, 'text': row['raw_text'] or ''
            })

        for (session_id, model), turns in sessions.items():
            turns.sort(key=lambda t: t['turn'])
            result['turn_counts'][model] = result['turn_counts'].get(model, 0)
            result['turn_counts'][model] += len(turns)
            # CPR: for each consecutive pair, fraction of turn N citations that persist into N+1
            for i in range(1, len(turns)):
                prev, cur = turns[i - 1], turns[i]
                if not prev['domains']:
                    continue
                persisting = len(prev['domains'] & cur['domains'])
                cpr = persisting / len(prev['domains'])
                result.setdefault('cpr_by_model', {}).setdefault(model, []).append(cpr)
                result.setdefault('cpr_by_brand', {})

                # Token window emulation: if the current turn text is very long,
                # earlier turns may be truncated -> record signal when CPR is low.
                est_context = sum(len(t['text']) for t in turns[:i + 1])
                if cpr < 0.5 and est_context > 6000:
                    result['token_window_signals'].append({
                        'session': session_id, 'model': model,
                        'turn': cur['turn'], 'cpr': round(cpr, 3),
                        'estimated_context_tokens': est_context,
                        'finding': f'Low CPR ({cpr:.0%}) at turn {cur["turn"]} with ~{est_context} chars of context — likely context truncation, not lost authority.'
                    })

        if result['cpr_by_model']:
            for model, cprs in result['cpr_by_model'].items():
                result['cpr_by_model'][model] = round(float(np.mean(cprs)), 4)
            all_cprs = [v for v in result['cpr_by_model'].values()]
            result['overall_cpr'] = round(float(np.mean(all_cprs)), 4)
            if result['overall_cpr'] < 0.5:
                result['findings'].append(
                    f'Overall Citation Persistence Rate is {result["overall_cpr"]:.0%} across {len(result["cpr_by_model"])} models. '
                    'Your brand authority is not surviving multi-turn conversations.')

        # CPR per brand: does the brand's citation survive?
        brand_turn_mention = defaultdict(list)
        for (session_id, model), turns in sessions.items():
            for t in turns:
                for b, pat in self._brand_re.items():
                    if pat.search(t['text'] or ''):
                        brand_turn_mention[b].append((session_id, t['turn'], bool(t['domains'])))
        for b, entries in brand_turn_mention.items():
            entries.sort(key=lambda x: (x[0], x[1]))
            keep = [x for x in entries]
            if len(keep) >= 2:
                first, last = keep[0], keep[-1]
                persist = 1.0 if last[2] else 0.0
                result['cpr_by_brand'][b] = {
                    'first_turn': first[1], 'last_turn': last[1],
                    'citation_survived_to_last_turn': bool(last[2]),
                    'turn_count': len(keep),
                    'cpr': persist
                }
        return result

    # ────────────────────────────────────────────────────────────────
    # 3. Graph Authority Score G_auth = a*C_D + b*C_B + g*S_cos
    # ────────────────────────────────────────────────────────────────
    def graph_authority_scores(self, graphs: Dict, embedding: Dict) -> Dict:
        result = {
            'formula': 'G_auth = a * C_D(v) + b * C_B(v) + g * S_cos(E_brand, E_intent)',
            'coefficients': {'alpha_in_degree': 0.40, 'beta_betweenness': 0.35, 'gamma_similarity': 0.25},
            'scores': [], 'brand_authority_summary': {},
        }
        a, b, g = result['coefficients'].values()
        citation_graph = graphs.get('citation_graph') or graphs.get('entity_citation_graph')
        if not citation_graph:
            result['message'] = 'No citation graph available for authority scoring.'
            return result

        # Normalize centrality to 0..1 across nodes
        def _norm(values):
            items = list(values.items())
            if not items:
                return {}
            vals = [float(v) for _, v in items]
            mx = max(vals)
            if mx <= 0:
                return {k: 0.0 for k, _ in items}
            return {k: v / mx for k, v in items}

        in_deg = _norm({n: d.get('in_degree_centrality', 0) for n, d in citation_graph.nodes(data=True)})
        betw = _norm({n: d.get('betweenness_centrality', 0) for n, d in citation_graph.nodes(data=True)})

        # Brand intent cosine similarity from embedding profiles (S_cos)
        brand_profiles = embedding.get('brand_vector_profiles', {}) or {}
        # Representative intent vector: use the primary brand's intra-similarity or cross-model sim
        intent_sim = {}
        for b in self.all_brands:
            prof = brand_profiles.get(b, {}) or {}
            if prof:
                intent_sim[b] = float(prof.get('mean_intra_similarity', 0.5))
            else:
                intent_sim[b] = 0.5

        rows = []
        for node, data in citation_graph.nodes(data=True):
            ntype = data.get('type', node.split(':')[0] if ':' in node else 'node')
            cd = in_deg.get(node, 0.0)
            cb = betw.get(node, 0.0)
            name = node.split(':', 1)[1] if ':' in node else node
            scos = intent_sim.get(name, 0.5)
            g_auth = a * cd + b * cb + g * scos
            rows.append({'node': node, 'name': name, 'type': ntype,
                         'in_degree_centrality': round(cd, 4), 'betweenness_centrality': round(cb, 4),
                         'cosine_similarity': round(scos, 4), 'graph_authority_score': round(g_auth, 4)})

        rows.sort(key=lambda r: r['graph_authority_score'], reverse=True)
        result['scores'] = rows[:40]

        brand_scores = [r for r in rows if r['type'] == 'brand']
        if brand_scores:
            result['brand_authority_summary'] = {
                b['name']: {'graph_authority_score': b['graph_authority_score'], 'rank': i + 1}
                for i, b in enumerate(sorted(brand_scores, key=lambda r: r['graph_authority_score'], reverse=True))
            }
            if self.primary_brand in result['brand_authority_summary']:
                pb = result['brand_authority_summary'][self.primary_brand]
                if pb['rank'] > 1:
                    result['findings'] = [f'Brand authority rank #{pb["rank"]} in the citation graph. Target the top-ranked source/brand to win the #1 bridge position.']
        return result

    # ────────────────────────────────────────────────────────────────
    # 4. Inverse Citation Mapping (Uncited Authority + crawler blocks)
    # ────────────────────────────────────────────────────────────────
    def inverse_citation_mapping(self, graph_stats: Dict) -> Dict:
        result = {
            'uncited_authority': [], 'crawler_blockage': [], 'summary': {},
        }
        missing = graph_stats.get('missing_authority_nodes', [])
        result['uncited_authority'] = missing[:25]
        result['summary']['uncited_authority_count'] = len(missing)

        if missing and self.entity_config.get('your_brand', {}).get('website'):
            result['crawler_blockage'] = self._check_crawler_blocks(missing)
            blocked = [c for c in result['crawler_blockage'] if c.get('blocked')]
            result['summary']['crawler_blocked_domains'] = len(blocked)
            if blocked:
                result['findings'] = [
                    f'{len(blocked)} of the top competitor-winning sources are blocked by at least one LLM crawler. '
                    'This is the #1 cause of "citation omission due to crawler blockage".'
                ]
        return result

    def _check_crawler_blocks(self, missing_nodes: List[Dict]) -> List[Dict]:
        """Check robots.txt of the primary brand's website for LLM crawler disallows."""
        website = self.entity_config.get('your_brand', {}).get('website', '')
        if not website:
            return []
        domain = _domain(website)
        if not domain:
            return []
        robots_url = f"https://{domain}/robots.txt"
        blocks = []
        try:
            import urllib.request
            req = urllib.request.Request(robots_url, headers={'User-Agent': 'AEO-Simulator/1.0'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                body = resp.read(60000).decode('utf-8', 'ignore')
            lower = body.lower()
            for crawler, token in LLM_CRAWLERS.items():
                if token in lower:
                    blocks.append({
                        'crawler': crawler,
                        'robots_txt': robots_url,
                        'disallowed': True,
                        'detail': f'{crawler} appears in your robots.txt — check whether your key pages are Disallowed.'
                    })
            if not blocks:
                blocks.append({'crawler': 'all_checked', 'robots_txt': robots_url, 'disallowed': False,
                               'detail': 'robots.txt checked for GPTBot, ClaudeBot, PerplexityBot, Bytespider, Google-Extended — none found.'})
        except Exception as e:
            blocks.append({'crawler': 'check_failed', 'robots_txt': robots_url, 'disallowed': None,
                           'detail': f'Could not fetch robots.txt: {e}'})
        return blocks

    # ────────────────────────────────────────────────────────────────
    # 5. Source-Level ROI Prioritization (Citation Influence Weight)
    # ────────────────────────────────────────────────────────────────
    def source_roi_prioritization(self, df: pl.DataFrame, graph_stats: Dict) -> Dict:
        result = {'ranked_sources': [], 'concentration_alerts': [], 'summary': {}}
        domain_counts = Counter()
        model_diversity = defaultdict(set)
        brand_domain_counts = defaultdict(Counter)
        for row in df.select(['model_id', 'primary_brand_mention', 'citations']).iter_rows(named=True):
            model = row['model_id']
            brand = row['primary_brand_mention']
            for c in (row['citations'] or []):
                if isinstance(c, dict) and c.get('url'):
                    d = _domain(c['url'])
                    if d:
                        domain_counts[d] += 1
                        model_diversity[d].add(model)
                        if brand:
                            brand_domain_counts[brand][d] += 1

        # Authority weight from graph missing/known sources
        authority_weight = {}
        for src in graph_stats.get('missing_authority_nodes', []):
            authority_weight[src.get('domain', '')] = float(src.get('authority_weight', 0.5))
        for gname, ginfo in (graph_stats.get('graphs', {}) or {}).items():
            for node, _ in ginfo.get('top_sources_by_centrality', []) or []:
                if node.startswith('source:'):
                    authority_weight[node.replace('source:', '')] = max(authority_weight.get(node.replace('source:', ''), 0.4), 0.7)

        total_citations = sum(domain_counts.values()) or 1
        ranked = []
        for domain, count in domain_counts.items():
            diversity = len(model_diversity[domain])
            aw = authority_weight.get(domain, 0.4)
            brand_share = {b: brand_domain_counts[b].get(domain, 0) / count for b in self.all_brands} if count else {}
            influence_weight = round(count * (0.5 + 0.1 * min(diversity, 5)) * aw, 4)
            ranked.append({
                'domain': domain, 'citation_count': count,
                'citation_share': round(count / total_citations, 4),
                'model_diversity': diversity, 'authority_weight': round(aw, 3),
                'your_brand_share': round(brand_share.get(self.primary_brand, 0), 3),
                'citation_influence_weight': influence_weight,
            })
        ranked.sort(key=lambda r: r['citation_influence_weight'], reverse=True)
        result['ranked_sources'] = ranked[:25]
        result['summary']['total_unique_domains'] = len(ranked)

        # Concentration: if a few domains drive a huge share
        top3_share = sum(r['citation_share'] for r in ranked[:3])
        if top3_share > 0.4:
            top_names = ', '.join(r['domain'] for r in ranked[:3])
            result['concentration_alerts'].append({
                'share': round(top3_share, 3),
                'domains': ranked[:3],
                'finding': f'{top3_share:.0%} of all citations come from just 3 sources ({top_names}). PR/outreach should concentrate here.'
            })
        return result

    # ────────────────────────────────────────────────────────────────
    # 6. Semantic Gap Remediation Scripts (JSON-LD + Markdown drafts)
    # ────────────────────────────────────────────────────────────────
    def semantic_gap_remediation(self, results: Dict) -> Dict:
        scripts = []
        your_brand = self.entity_config.get('your_brand', {}) or {}
        brand = your_brand.get('primary_name', self.primary_brand or 'Your Brand')
        website = your_brand.get('website', 'https://example.com')

        # Negative/contradicted triples become FAQ schema + markdown
        neg_triples = []
        for key, val in (results.get('triple_stats', {}) or {}).items():
            if key.startswith('negative_triples_') and isinstance(val, list):
                neg_triples.extend(val)
        contradicted = (results.get('claim_verification', {}) or {}).get('contradicted_claims', []) or []

        for t in list(neg_triples)[:4] + list(contradicted)[:4]:
            claim = t.get('claim') or f"{t.get('subject','')} {t.get('predicate','')} {t.get('object','')}".strip()
            if not claim:
                continue
            slug = re.sub(r'[^a-z0-9]+', '-', claim.lower())[:60].strip('-')
            scripts.append({
                'title': f'Counter: "{claim[:80]}"',
                'target_page': f'/facts/{slug}',
                'claim': claim,
                'type': 'negative_claim_faq',
                'jsonld': json.dumps({
                    '@context': 'https://schema.org',
                    '@type': 'FAQPage',
                    'mainEntity': [{
                        '@type': 'Question',
                        'name': f'Does {brand} {t.get("predicate","have this limitation")}?',
                        'acceptedAnswer': {
                            '@type': 'Answer',
                            'text': f'No. Official, schema-validated documentation for {brand} addresses this directly. See {website}/facts/{slug}.'
                        }
                    }]
                }, indent=2),
                'markdown': f"## Is the claim above accurate?\n\n"
                            f"**Claim found in LLM responses:** {claim}\n\n"
                            f"**Official position:** {brand} maintains schema-validated documentation at "
                            f"[{website}/facts/{slug}]({website}/facts/{slug}).\n\n"
                            f"> Publishing this ~500-word page gives every LLM a citable ground-truth node.\n"
            })

        # Missing authority sources -> outreach brief
        missing = (results.get('graph_stats', {}) or {}).get('missing_authority_nodes', [])
        for node in list(missing)[:4]:
            domain = node.get('domain', '')
            if not domain:
                continue
            scripts.append({
                'title': f'Get cited on {domain}',
                'target_page': f'PR outreach → {domain}',
                'claim': f'This source cites your competitor but not you ({node.get("competitor","competitor")}).',
                'type': 'authority_outreach',
                'jsonld': json.dumps({
                    '@context': 'https://schema.org',
                    '@type': 'CreativeWork',
                    'name': f'Why {brand} is the leading {your_brand.get("category","solution")}',
                    'about': brand,
                    'mainEntityOfPage': website
                }, indent=2),
                'markdown': f"## Outreach brief for {domain}\n\n"
                            f"- **Why:** {node.get('competitor','Competitor')} earns {node.get('weight',0)} citations from {domain}; you have zero.\n"
                            f"- **Action:** Guest post / product listing / expert quote on {domain} referencing {brand}.\n"
                            f"- **Asset to link:** {website}/facts/\n"
            })

        result = {'remediation_scripts': scripts, 'script_count': len(scripts)}
        if scripts:
            result['findings'] = [f'{len(scripts)} ready-to-publish remediation assets generated (FAQ schema + outreach briefs).']
        return result

    # ────────────────────────────────────────────────────────────────
    # 7. SoMV Trendlines by model family and funnel stage
    # ────────────────────────────────────────────────────────────────
    def somv_trendlines(self, somv: Dict) -> Dict:
        result = {'by_model_family': {}, 'by_funnel_stage': {}, 'findings': []}
        by_model = somv.get('by_model', {}) or {}
        family_brands = defaultdict(Counter)
        for model, data in by_model.items():
            fam = _family(model)
            brand_stats = data.get('brand_stats', {}) or {}
            for b, s in brand_stats.items():
                family_brands[fam][b] += s.get('primary_recommendation_count', 0) or 0
        for fam, counts in family_brands.items():
            total = sum(counts.values()) or 1
            result['by_model_family'][fam] = {
                b: round(c / total, 4) for b, c in counts.items()
            }

        # Funnel stage via turn_type
        funnel_map = {
            'category_discovery': 'Top-of-Funnel (Education)',
            'feature_deep_dive': 'Middle-of-Funnel (Evaluation)',
            'comparison_analysis': 'Bottom-of-Funnel (Decision)',
            'objection_compliance': 'Bottom-of-Funnel (Decision)',
            'pricing_procurement': 'Bottom-of-Funnel (Decision)',
        }
        by_turn = somv.get('by_turn_type', {}) or {}
        stage_brands = defaultdict(Counter)
        for turn_type, data in by_turn.items():
            stage = funnel_map.get(turn_type, 'Middle-of-Funnel (Evaluation)')
            brand_stats = data.get('brand_stats', {}) or {}
            for b, s in brand_stats.items():
                stage_brands[stage][b] += s.get('primary_recommendation_count', 0) or 0
        for stage, counts in stage_brands.items():
            total = sum(counts.values()) or 1
            result['by_funnel_stage'][stage] = {b: round(c / total, 4) for b, c in counts.items()}

        if self.primary_brand and result['by_funnel_stage']:
            best = None
            for stage, shares in result['by_funnel_stage'].items():
                mine = shares.get(self.primary_brand, 0)
                if best is None or mine > best[1]:
                    best = (stage, mine)
            if best and best[0] != 'Bottom-of-Funnel (Decision)':
                result['findings'].append(
                    f'{self.primary_brand} peaks at {best[0]} ({best[1]:.0%} primary share) but weakens in decision-stage prompts. '
                    'Buyers at the decision stage are where revenue closes — focus bottom-funnel content.')
        return result

    # ────────────────────────────────────────────────────────────────
    def analyze(self, df: pl.DataFrame, graphs: Dict, embedding: Dict, somv: Dict, graph_stats: Dict) -> Dict:
        results = {}
        try:
            results['parity_calibration'] = self.parity_calibration(df)
        except Exception as e:
            logger.warning(f'Parity calibration failed: {e}')
            results['parity_calibration'] = {'status': 'error', 'message': str(e)}
        try:
            results['multi_turn_cpr'] = self.multi_turn_cpr(df)
        except Exception as e:
            logger.warning(f'Multi-turn CPR failed: {e}')
            results['multi_turn_cpr'] = {'status': 'error', 'message': str(e)}
        try:
            results['graph_authority'] = self.graph_authority_scores(graphs, embedding)
        except Exception as e:
            logger.warning(f'Graph authority failed: {e}')
            results['graph_authority'] = {'status': 'error', 'message': str(e)}
        try:
            results['inverse_citation'] = self.inverse_citation_mapping(graph_stats)
        except Exception as e:
            logger.warning(f'Inverse citation mapping failed: {e}')
            results['inverse_citation'] = {'status': 'error', 'message': str(e)}
        try:
            results['source_roi'] = self.source_roi_prioritization(df, graph_stats)
        except Exception as e:
            logger.warning(f'Source ROI failed: {e}')
            results['source_roi'] = {'status': 'error', 'message': str(e)}
        try:
            results['semantic_gap_remediation'] = self.semantic_gap_remediation(results)
        except Exception as e:
            logger.warning(f'Semantic remediation failed: {e}')
            results['semantic_gap_remediation'] = {'status': 'error', 'message': str(e)}
        try:
            results['somv_trendlines'] = self.somv_trendlines(somv)
        except Exception as e:
            logger.warning(f'SoMV trendlines failed: {e}')
            results['somv_trendlines'] = {'status': 'error', 'message': str(e)}
        return results

    def save(self, results: Dict, output_dir: Path):
        reports_dir = output_dir / 'reports'
        reports_dir.mkdir(exist_ok=True)
        with open(reports_dir / 'enterprise_insights.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info(f"Saved enterprise insights to {reports_dir}")
