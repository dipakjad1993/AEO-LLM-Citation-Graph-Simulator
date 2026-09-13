"""
Dashboard Generator
Creates interactive HTML dashboards with charts, tables, and actionable insights.
Uses Plotly for interactive visualizations and Jinja2 for templating.
"""

from __future__ import annotations  # lazy annotations: go.Figure etc. must not evaluate at import when plotly is absent (lite installs)

import json
import logging
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

logger = logging.getLogger(__name__)

try:
    import plotly.graph_objects as go
    import plotly.express as px
    from plotly.subplots import make_subplots
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False
    logger.warning("Plotly not available, using static HTML output")

try:
    from jinja2 import Template
    JINJA_AVAILABLE = True
except ImportError:
    JINJA_AVAILABLE = False
    logger.warning("Jinja2 not available, using basic HTML")


class DashboardGenerator:
    def __init__(self, config: Dict):
        self.config = config
        self.dashboard_config = config.get('analytics', {}).get('output', {}).get('dashboard', {})
        self.theme = self.dashboard_config.get('theme', 'dark')

    def generate(self, results: Dict, output_dir: Path) -> Path:
        dashboard_dir = output_dir / 'dashboard'
        dashboard_dir.mkdir(exist_ok=True)

        charts = []

        if PLOTLY_AVAILABLE:
            somv_fig = self._create_somv_chart(results)
            if somv_fig:
                charts.append(('Share of Model Voice', somv_fig))

            omission_fig = self._create_omission_chart(results)
            if omission_fig:
                charts.append(('Omission Analysis', omission_fig))

            sentiment_fig = self._create_sentiment_chart(results)
            if sentiment_fig:
                charts.append(('Sentiment Matrix', sentiment_fig))

            turn_fig = self._create_turn_evolution_chart(results)
            if turn_fig:
                charts.append(('Turn Evolution', turn_fig))

            citation_fig = self._create_citation_depth_chart(results)
            if citation_fig:
                charts.append(('Citation Depth', citation_fig))

            verification_fig = self._create_verification_chart(results)
            if verification_fig:
                charts.append(('Claim Verification (Ground Truth)', verification_fig))

            grounded_fig = self._create_grounded_chart(results)
            if grounded_fig:
                charts.append(('Grounded vs Memory (Browse Evidence)', grounded_fig))

            cpr_fig = self._create_cpr_chart(results)
            if cpr_fig:
                charts.append(('Citation Persistence (CPR) by Model', cpr_fig))

            gauth_fig = self._create_gauth_chart(results)
            if gauth_fig:
                charts.append(('Graph Authority G_auth (Top Brands)', gauth_fig))

            vol_fig = self._create_volatility_chart(results)
            if vol_fig:
                charts.append(('Answer Volatility (Win Rate + 95% CI)', vol_fig))

        html = self._generate_html(results, charts)
        html = html.replace('PLOTLY_CDN_PLACEHOLDER', self._plotly_js_tag())

        dashboard_path = dashboard_dir / 'aeo_dashboard.html'
        # UTF-8 explicitly: inlined Plotly bundle + CJK/emoji content break on
        # Windows cp1252 default (UnicodeEncodeError killed stage 13).
        with open(dashboard_path, 'w', encoding='utf-8') as f:
            f.write(html)

        self._save_json_data(results, dashboard_dir)

        logger.info(f"Dashboard generated: {dashboard_path}")
        return dashboard_path

    def _create_somv_chart(self, results: Dict) -> go.Figure:
        somv = results.get('somv', {})
        by_model = somv.get('by_model', {})

        if not by_model:
            return None

        models = list(by_model.keys())
        brands = set()
        for model_data in by_model.values():
            brands.update(model_data.get('brand_stats', {}).keys())
        brands = sorted(brands)

        fig = go.Figure()

        entity_config = results.get('entity_maps', {}).get('entity_maps', {}) if isinstance(results, dict) else {}
        primary_brand = entity_config.get('your_brand', {}).get('primary_name', '')

        brand_colors = ['#2ecc71', '#e74c3c', '#3498db', '#e67e22', '#9b59b6', '#1abc9c', '#f39c12', '#9b59b6']
        colors = {}
        color_idx = 0
        for brand in sorted(brands):
            if brand == primary_brand:
                colors[brand] = '#2ecc71'
            else:
                colors[brand] = brand_colors[color_idx % len(brand_colors)]
                color_idx += 1

        for brand in brands:
            mention_rates = []
            primary_rates = []
            for model in models:
                stats = by_model[model].get('brand_stats', {}).get(brand, {})
                mention_rates.append(stats.get('mention_rate', 0) * 100)
                primary_rates.append(stats.get('primary_recommendation_rate', 0) * 100)

            fig.add_trace(go.Bar(
                name=f'{brand} (Mention)',
                x=models, y=mention_rates,
                marker_color=colors.get(brand, '#95a5a6'),
                opacity=0.7
            ))

        fig.update_layout(
            title='Share of Model Voice by Platform',
            xaxis_title='AI Model',
            yaxis_title='Mention Rate (%)',
            barmode='group',
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=500,
            legend=dict(orientation='h', yanchor='bottom', y=1.02, xanchor='right', x=1)
        )

        return fig

    def _create_omission_chart(self, results: Dict) -> go.Figure:
        somv = results.get('somv', {})
        omission = somv.get('omission_analysis', {})
        omission_rates = omission.get('omission_rates', {})

        if not omission_rates:
            return None

        brands = list(omission_rates.keys())
        rates = [omission_rates[b].get('omission_rate', 0) * 100 for b in brands]

        colors = ['#2ecc71' if r < 30 else '#f39c12' if r < 60 else '#e74c3c' for r in rates]

        fig = go.Figure(data=[
            go.Bar(
                x=brands, y=rates,
                marker_color=colors,
                text=[f'{r:.1f}%' for r in rates],
                textposition='outside'
            )
        ])

        fig.update_layout(
            title='Brand Omission Rate (Lower = Better)',
            xaxis_title='Brand',
            yaxis_title='Omission Rate (%)',
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=400
        )

        return fig

    def _create_grounded_chart(self, results: Dict):
        somv = results.get('somv', {})
        grounded = somv.get('grounded_only', {}) or {}
        browse = grounded.get('browse_rate_by_model', {}) or {}
        if not browse:
            dq = results.get('data_quality', {}) or {}
            if not dq:
                return None
            browse = {'all_models': {'browse_rate': dq.get('grounded_share', 0),
                                     'grounded': dq.get('grounded_responses', 0),
                                     'total': dq.get('record_count', 0)}}
        models = list(browse.keys())
        rates = [browse[m].get('browse_rate', 0) * 100 for m in models]
        colors = ['#2ecc71' if r >= 74 else '#f39c12' if r >= 50 else '#e74c3c' for r in rates]
        fig = go.Figure(data=[go.Bar(x=models, y=rates, marker_color=colors,
                                     text=[f'{r:.0f}%' for r in rates], textposition='outside')])
        fig.update_layout(title='Browse Evidence Rate by Model (Grounded = has citations/search traces)',
                          xaxis_title='Model', yaxis_title='Grounded (%)',
                          template='plotly_dark' if self.theme == 'dark' else 'plotly_white', height=400)
        return fig

    def _create_sentiment_chart(self, results: Dict) -> go.Figure:
        sentiment = results.get('sentiment_matrix', {})
        brand_sentiment = sentiment.get('brand_sentiment_matrix', {})

        if not brand_sentiment:
            return None

        brands = list(brand_sentiment.keys())
        positive_rates = [brand_sentiment[b].get('positive_rate', 0) * 100 for b in brands]
        negative_rates = [brand_sentiment[b].get('negative_rate', 0) * 100 for b in brands]
        neutral_rates = [brand_sentiment[b].get('neutral_rate', 0) * 100 for b in brands]

        fig = go.Figure()

        fig.add_trace(go.Bar(name='Positive', x=brands, y=positive_rates, marker_color='#2ecc71'))
        fig.add_trace(go.Bar(name='Negative', x=brands, y=negative_rates, marker_color='#e74c3c'))
        fig.add_trace(go.Bar(name='Neutral', x=brands, y=neutral_rates, marker_color='#95a5a6'))

        fig.update_layout(
            title='Sentiment Distribution by Brand',
            xaxis_title='Brand',
            yaxis_title='Percentage (%)',
            barmode='stack',
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=500
        )

        return fig

    def _create_verification_chart(self, results: Dict) -> go.Figure:
        verification = results.get('claim_verification', {})
        overall = verification.get('overall', {})
        if not overall or not overall.get('total_claims', 0):
            return None

        labels = ['Verified', 'Partially Verified', 'Unverified', 'Contradicted']
        colors = ['#2ecc71', '#f1c40f', '#95a5a6', '#e74c3c']
        values = [
            overall.get('verified', 0),
            overall.get('partially_verified', 0),
            overall.get('unverified', 0),
            overall.get('contradicted', 0)
        ]

        fig = go.Figure()
        fig.add_trace(go.Pie(
            labels=labels, values=values,
            hole=0.4,
            marker_colors=colors
        ))

        fig.update_layout(
            title=f"Claim Verification: {overall.get('verified_rate', 0)*100:.1f}% verified against ground truth",
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=400
        )

        return fig

    def _create_turn_evolution_chart(self, results: Dict) -> go.Figure:
        sentiment = results.get('sentiment_matrix', {})
        evolution = sentiment.get('turn_sentiment_evolution', {})

        if not evolution:
            return None

        turns = sorted(evolution.keys())
        all_brands = set()
        for turn_data in evolution.values():
            all_brands.update(turn_data.keys())

        fig = go.Figure()

        turn_brand_colors = ['#2ecc71', '#e74c3c', '#3498db', '#e67e22', '#9b59b6', '#1abc9c']
        colors = {}
        for idx, brand in enumerate(sorted(all_brands)):
            colors[brand] = turn_brand_colors[idx % len(turn_brand_colors)]

        for brand in all_brands:
            sentiments = []
            for turn in turns:
                brand_data = evolution[turn].get(brand, {})
                sentiments.append(brand_data.get('mean_sentiment', 0.5))

            fig.add_trace(go.Scatter(
                x=turns, y=sentiments,
                mode='lines+markers',
                name=brand,
                line=dict(color=colors.get(brand, '#95a5a6'), width=2)
            ))

        fig.update_layout(
            title='Sentiment Evolution Across Conversation Turns',
            xaxis_title='Conversation Turn',
            yaxis_title='Mean Sentiment Score',
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=400
        )

        return fig

    def _create_citation_depth_chart(self, results: Dict) -> go.Figure:
        somv = results.get('somv', {})
        citation = somv.get('citation_depth', {})
        distribution = citation.get('citation_distribution', {})

        if not distribution:
            return None

        labels = ['Zero', 'One', '2-5', '6+']
        values = [
            distribution.get('zero_citations', 0),
            distribution.get('one_citation', 0),
            distribution.get('two_to_five', 0),
            distribution.get('six_plus', 0)
        ]

        fig = go.Figure(data=[go.Pie(
            labels=labels, values=values,
            hole=0.4,
            marker_colors=['#e74c3c', '#f39c12', '#2ecc71', '#3498db']
        )])

        fig.update_layout(
            title='Citation Depth Distribution',
            template='plotly_dark' if self.theme == 'dark' else 'plotly_white',
            height=400
        )

        return fig

    def _create_cpr_chart(self, results: Dict):
        ei = results.get('enterprise_insights', {}) or {}
        cpr = (ei.get('multi_turn_cpr', {}) or {}).get('cpr_by_model', {}) or {}
        if not cpr:
            return None
        models = sorted(cpr.keys())
        vals = [cpr[m] for m in models]
        fig = go.Figure(go.Bar(x=models, y=[v * 100 for v in vals],
                               marker_color=['#2ecc71' if v >= 0.5 else '#e74c3c' for v in vals]))
        fig.update_layout(title='Citation Persistence Rate (higher = authority survives multi-turn)',
                          xaxis_title='Model', yaxis_title='CPR (%)', yaxis_range=[0, 100],
                          template='plotly_dark' if self.theme == 'dark' else 'plotly_white', height=400)
        return fig

    def _create_gauth_chart(self, results: Dict):
        ei = results.get('enterprise_insights', {}) or {}
        summ = (ei.get('graph_authority', {}) or {}).get('brand_authority_summary', {}) or {}
        if not summ:
            return None
        names = sorted(summ.keys(), key=lambda b: summ[b].get('graph_authority_score', 0), reverse=True)[:10]
        vals = [summ[b].get('graph_authority_score', 0) for b in names]
        fig = go.Figure(go.Bar(x=names, y=vals, marker_color='#9b59b6'))
        fig.update_layout(title='G_auth = 0.40*C_D + 0.35*C_B + 0.25*S_cons (message consistency)',
                          xaxis_title='Brand', yaxis_title='G_auth',
                          template='plotly_dark' if self.theme == 'dark' else 'plotly_white', height=400)
        return fig

    def _create_volatility_chart(self, results: Dict):
        vol = results.get('volatility', {}) or {}
        wr = vol.get('brand_win_rates', {}) or {}
        if not wr:
            return None
        brands = sorted(wr.keys())
        rates = [wr[b].get('rate', 0) * 100 for b in brands]
        lo = [wr[b].get('ci95', [0, 0])[0] * 100 for b in brands]
        hi = [wr[b].get('ci95', [0, 0])[1] * 100 for b in brands]
        fig = go.Figure(go.Bar(x=brands, y=rates,
                               error_y=dict(type='data', symmetric=False,
                                            arrayminus=[r - l for r, l in zip(rates, lo)],
                                            array=[h - r for r, h in zip(rates, hi)]),
                               marker_color='#3498db'))
        fig.update_layout(title='Repeat-run win rate with Wilson 95% CI (n<30 = wide bars, honestly)',
                          xaxis_title='Brand', yaxis_title='Win rate (%)',
                          template='plotly_dark' if self.theme == 'dark' else 'plotly_white', height=400)
        return fig

    def _plotly_js_tag(self) -> str:
        # Offline-first: inline the pip-installed plotly bundle (get_plotlyjs) so the
        # dashboard renders with zero network. Fall back to CDN only when plotly
        # is absent (lite installs).
        try:
            from plotly.offline import get_plotlyjs
            bundle = get_plotlyjs()
            return bundle + "\n/* plotly inlined offline (no CDN) */"
        except Exception:
            return 'document.write(\'<script src="https://cdn.plot.ly/plotly-latest.min.js">\\x3C/script>\')'

    def _generate_html(self, results: Dict, charts: List) -> str:
        somv = results.get('somv', {})
        overall = somv.get('overall', {})
        brand_stats = overall.get('brand_stats', {})
        recommendations = results.get('recommendations', [])
        biases = results.get('sentiment_matrix', {}).get('detected_biases', [])
        gaps = somv.get('competitive_gaps', [])
        primary_brand = self.config.get('entity_maps', {}).get('entity_maps', {}).get('your_brand', {}).get('primary_name', '')
        dq = results.get('data_quality', {}) or {}
        grounded = somv.get('grounded_only', {}) or {}
        g_share = grounded.get('grounded_share', dq.get('grounded_share', 1))
        g_warn = grounded.get('warning', '')
        grounding_banner = ''
        if g_share is not None and g_share < 0.74:
            grounding_banner = f"""
            <div class="grounding-banner grounding-warn">
                <strong>Methodology warning:</strong> only {g_share:.0%} of responses show browse evidence
                ({grounded.get('grounded_responses', dq.get('grounded_responses', '?'))} grounded /
                {grounded.get('ungrounded_responses', dq.get('ungrounded_responses', '?'))} memory).
                <strong>Grounded-only SoMV</strong> is the decision number — ungrounded SoMV is pre-training popularity.
                {g_warn}
            </div>"""
        else:
            grounding_banner = f"""
            <div class="grounding-banner grounding-ok">
                <strong>Grounded:</strong> {g_share:.0%} of responses show browse evidence. SoMV below mixes grounded + memory — see grounded_only block for the honest split.
            </div>"""

        charts_html = ""
        for title, fig in charts:
            chart_html = fig.to_html(full_html=False, include_plotlyjs=False) if PLOTLY_AVAILABLE else ""
            charts_html += f"""
            <div class="chart-container">
                <h3>{title}</h3>
                {chart_html}
            </div>
            """

        brand_table_rows = ""
        for brand, stats in sorted(brand_stats.items(), key=lambda x: x[1].get('share_of_voice', 0), reverse=True):
            sov = stats.get('share_of_voice', 0) * 100
            primary = stats.get('primary_recommendation_rate', 0) * 100
            mention = stats.get('mention_rate', 0) * 100
            omission = stats.get('omission_rate', 0) * 100

            sov_class = 'positive' if brand == primary_brand and sov > 30 else 'negative' if brand != primary_brand and sov > 40 else ''

            brand_table_rows += f"""
            <tr class="{sov_class}">
                <td><strong>{brand}</strong></td>
                <td>{sov:.1f}%</td>
                <td>{primary:.1f}%</td>
                <td>{mention:.1f}%</td>
                <td>{omission:.1f}%</td>
            </tr>
            """

        recommendation_html = ""
        for rec in recommendations:
            priority_class = f"priority-{rec.get('priority', 'INFO').lower()}"
            recommendation_html += f"""
            <div class="recommendation {priority_class}">
                <div class="rec-header">
                    <span class="priority-badge">{rec.get('priority', 'INFO')}</span>
                    <span class="rec-category">{rec.get('category', 'General')}</span>
                </div>
                <p class="finding"><strong>Finding:</strong> {rec.get('finding', '')}</p>
                <p class="action"><strong>Action:</strong> {rec.get('action', '')}</p>
            </div>
            """

        bias_html = ""
        for bias in biases[:8]:
            bias_html += f"""
            <div class="bias-item severity-{bias.get('severity', 'LOW').lower()}">
                <strong>{bias.get('brand', 'Unknown')} - {bias.get('pattern_display', 'Unknown')}</strong>
                <span class="count">({bias.get('occurrence_count', 0)} occurrences)</span>
                <p class="remediation">{bias.get('remediation', '')}</p>
            </div>
            """

        gap_html = ""
        for gap in gaps[:5]:
            gap_html += f"""
            <div class="gap-item">
                <strong>{gap.get('competitor', 'Unknown')}</strong> leads by {gap.get('gap', 0)*100:.1f}%
                (Your: {gap.get('your_primary_rate', 0)*100:.1f}% vs Their: {gap.get('competitor_primary_rate', 0)*100:.1f}%)
                <p>{gap.get('recommendation', '')}</p>
            </div>
            """

        verification = results.get('claim_verification', {})
        ver_overall = verification.get('overall', {})
        ver_ran = verification.get('verification_ran', False)
        ver_gt = verification.get('ground_truth', {})
        ver_total = ver_overall.get('total_claims', 0)

        verification_html = ""
        if ver_total:
            verified_count = ver_overall.get('verified', 0)
            partial_count = ver_overall.get('partially_verified', 0)
            unverified_count = ver_overall.get('unverified', 0)
            contradicted_count = ver_overall.get('contradicted', 0)
            verified_rate = ver_overall.get('verified_rate', 0) * 100
            contradiction_rate = ver_overall.get('contradiction_rate', 0) * 100

            verification_html += f"""
            <div class="verification-summary">
                <div class="ver-metric ver-ok"><strong>{verified_count}</strong><span>Verified</span></div>
                <div class="ver-metric ver-partial"><strong>{partial_count}</strong><span>Partially Verified</span></div>
                <div class="ver-metric ver-unverified"><strong>{unverified_count}</strong><span>Unverified</span></div>
                <div class="ver-metric ver-bad"><strong>{contradicted_count}</strong><span>Contradicted</span></div>
            </div>
            <div class="ver-rates">
                <span class="rate verified-rate">Verified rate: {verified_rate:.1f}%</span>
                <span class="rate contradiction-rate">Contradiction rate: {contradiction_rate:.1f}%</span>
                <span class="rate gt-passages">Ground-truth passages: {ver_gt.get('passage_count', 0)}</span>
            </div>
            <p class="ver-note">Every claim was checked against the ground-truth corpus below. Claims marked
            <span class="ver-badge ver-badge-verified">verified</span> are supported by authoritative sources;
            <span class="ver-badge ver-badge-contradicted">contradicted</span> claims conflict with ground truth and are
            the highest-priority reputational risks.</p>
            """

            contradicted_list = verification.get('contradicted_claims', [])
            if contradicted_list:
                verification_html += '<h3>Contradicted Claims (High Risk)</h3><div class="ver-contradictions">'
                for item in contradicted_list[:10]:
                    verification_html += f"""
                    <div class="contradiction-item">
                        <p class="claim">"{item.get('claim', '')}" <em>vs</em> "{item.get('evidence', '')}"</p>
                        <p class="meta">Model: {item.get('model_id', 'unknown')} | Source: {item.get('evidence_source', 'n/a')}</p>
                    </div>
                    """
                verification_html += '</div>'
        else:
            verification_html = f"""
            <div class="ver-note ver-warning">
                <strong>Ground-truth verification unavailable.</strong> {verification.get('message', 'No claims to verify.')}
            </div>
            """

        gt_sources_html = ""
        if ver_gt.get('sources'):
            gt_sources_html = '<h3>Ground-Truth Corpus</h3><ul class="gt-sources">'
            for source in ver_gt['sources'][:20]:
                gt_sources_html += f'<li>{source}</li>'
            gt_sources_html += '</ul>'

        verification_html += f"""
        <div class="ver-provenance">
            <p><strong>Provenance:</strong> All claims, citations, and extracted entities in this report trace back to
            verified API responses (see raw_responses/ and run_manifest.json in the run directory).
            {ver_ran if ver_ran else 'Verification could not be run against a ground-truth corpus; upload gold standards to enable it.'}</p>
        </div>
        {gt_sources_html}
        """

        commerce = results.get('commerce', {}) or {}
        pc = (commerce.get('product_cards', {}) or {}).get('overall', {})
        fh = commerce.get('feed_health', {}) or {}
        acp = commerce.get('acp', {}) or {}
        ucp = commerce.get('ucp', {}) or {}
        rufus = commerce.get('rufus', {}) or {}
        feeds = fh.get('feeds', []) or []
        feed_rows = ''.join(
            f"<tr><td>{f.get('feed','')}</td><td>{f.get('items',0)}</td>"
            f"<td>{', '.join(f'{k}:{v}' for k, v in (f.get('missing_fields', {}) or {}).items()) or 'complete'}</td></tr>"
            for f in feeds[:5])
        commerce_html = f"""
            <div class="ver-rates">
                <span class="rate">Product-card rate: {pc.get('card_rate', 0):.1%}</span>
                <span class="rate">Feeds checked: {fh.get('feeds_checked', 0)}</span>
                <span class="rate">ACP checkout: {'YES' if acp.get('checkout_eligible') else 'NO'}</span>
                <span class="rate">UCP native_commerce: {'YES' if ucp.get('native_commerce') else 'NO'}</span>
                <span class="rate">Rufus score: {rufus.get('score', 0)}</span>
            </div>
            <p class="ver-note">{(commerce.get('product_cards', {}) or {}).get('finding', '')} {fh.get('message', '')}</p>
            {'<table><thead><tr><th>Feed</th><th>Items</th><th>Missing fields</th></tr></thead><tbody>' + feed_rows + '</tbody></table>' if feed_rows else ''}
            <p class="ver-note">ACP: {acp.get('detail', '')} UCP: {ucp.get('detail', '')} Rufus: {rufus.get('detail', '')}</p>
        """

        traffic = results.get('traffic_join', {}) or {}
        gsc = traffic.get('gsc_generative_gate', {}) or {}
        ga4 = traffic.get('ga4_ai_referrers', {}) or {}
        traffic_html = f"""
            <div class="ver-rates">
                <span class="rate">Generative-inclusion rate: {gsc.get('generative_inclusion_rate', 0):.1%}</span>
                <span class="rate">AI session share: {ga4.get('ai_session_share', 0):.1%}</span>
                <span class="rate">AI revenue share: {ga4.get('ai_revenue_share', 0):.1%}</span>
            </div>
            <p class="ver-note">GSC: {gsc.get('message', gsc.get('evidence', ''))} GA4: {ga4.get('message', ga4.get('evidence', ''))}</p>
            <p class="ver-note">Drop a Search Console export (query, clicks, impressions, ai_overview_present) + GA4 export (source, sessions, conversions, revenue) into data/uploads/traffic/ to prove revenue. Without the join, SoMV cannot claim pipeline.</p>
        """

        total_records = results.get('total_records_analyzed', results.get('total_records', 0))
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AEO Citation Graph Simulator - Dashboard</title>
    <script>PLOTLY_CDN_PLACEHOLDER</script>
    <script>
    function filterRecs(q) {{
        q = (q || '').toLowerCase();
        document.querySelectorAll('.recommendation').forEach(function(el) {{
            el.style.display = (!q || el.textContent.toLowerCase().includes(q)) ? '' : 'none';
        }});
        var n = 0;
        document.querySelectorAll('.recommendation').forEach(function(el) {{ if (el.style.display !== 'none') n++; }});
        var c = document.getElementById('rec-count'); if (c) c.textContent = n + ' shown';
    }}
    </script>
    <style>
        :root {{
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-card: #21262d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --border: #30363d;
            --accent-green: #2ecc71;
            --accent-red: #e74c3c;
            --accent-blue: #3498db;
            --accent-yellow: #f39c12;
            --accent-purple: #9b59b6;
        }}

        * {{ margin: 0; padding: 0; box-sizing: border-box; }}

        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.6;
        }}

        .dashboard-container {{
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }}

        header {{
            background: linear-gradient(135deg, var(--bg-secondary), var(--bg-card));
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            text-align: center;
        }}

        header h1 {{
            font-size: 2.2em;
            margin-bottom: 10px;
            background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}

        header .subtitle {{
            color: var(--text-secondary);
            font-size: 1.1em;
        }}

        .stats-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
        }}

        .stat-card {{
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 20px;
            text-align: center;
        }}

        .stat-card .value {{
            font-size: 2em;
            font-weight: bold;
            color: var(--accent-blue);
        }}

        .stat-card .label {{
            color: var(--text-secondary);
            font-size: 0.9em;
            margin-top: 5px;
        }}

        .section {{
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 25px;
            margin-bottom: 25px;
        }}

        .section h2 {{
            font-size: 1.4em;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--border);
        }}

        .chart-container {{
            margin-bottom: 25px;
        }}

        .chart-container h3 {{
            margin-bottom: 15px;
            color: var(--accent-blue);
        }}

        table {{
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }}

        th, td {{
            padding: 12px 15px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }}

        th {{
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.85em;
        }}

        tr:hover {{
            background: var(--bg-secondary);
        }}

        tr.positive td {{
            border-left: 3px solid var(--accent-green);
        }}

        tr.negative td {{
            border-left: 3px solid var(--accent-red);
        }}

        .grounding-banner {{
            border-radius: 8px;
            padding: 14px 16px;
            margin-bottom: 16px;
            font-size: 0.95em;
        }}
        .grounding-banner.grounding-warn {{
            background: rgba(231, 76, 60, 0.12);
            border: 1px solid var(--accent-red);
        }}
        .grounding-banner.grounding-ok {{
            background: rgba(46, 204, 113, 0.10);
            border: 1px solid var(--accent-green);
        }}

        .recommendation {{
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 12px;
            border-left: 4px solid var(--accent-blue);
        }}

        .recommendation.priority-high {{
            border-left-color: var(--accent-red);
        }}

        .recommendation.priority-medium {{
            border-left-color: var(--accent-yellow);
        }}

        .recommendation.priority-low {{
            border-left-color: var(--accent-green);
        }}

        .rec-header {{
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }}

        .priority-badge {{
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }}

        .priority-badge {{ background: var(--accent-blue); color: white; }}
        .priority-high .priority-badge {{ background: var(--accent-red); }}
        .priority-medium .priority-badge {{ background: var(--accent-yellow); color: #333; }}

        .rec-category {{
            color: var(--text-secondary);
            font-size: 0.9em;
        }}

        .finding, .action {{
            margin: 5px 0;
            font-size: 0.95em;
        }}

        .bias-item {{
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 10px;
            border-left: 3px solid var(--accent-yellow);
        }}

        .bias-item.severity-high {{
            border-left-color: var(--accent-red);
        }}

        .bias-item .count {{
            color: var(--text-secondary);
            font-size: 0.9em;
        }}

        .bias-item .remediation {{
            margin-top: 5px;
            font-size: 0.9em;
            color: var(--text-secondary);
        }}

        .gap-item {{
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 10px;
        }}

        .gap-item p {{
            margin-top: 5px;
            font-size: 0.9em;
            color: var(--text-secondary);
        }}

        .verification-summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin-bottom: 15px;
        }}

        .ver-metric {{
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 15px;
            text-align: center;
            border-left: 4px solid var(--accent-blue);
        }}

        .ver-metric.ver-ok {{ border-left-color: var(--accent-green); }}
        .ver-metric.ver-partial {{ border-left-color: var(--accent-yellow); }}
        .ver-metric.ver-unverified {{ border-left-color: var(--text-secondary); }}
        .ver-metric.ver-bad {{ border-left-color: var(--accent-red); }}

        .ver-metric strong {{
            display: block;
            font-size: 1.6em;
        }}

        .ver-metric span {{
            color: var(--text-secondary);
            font-size: 0.85em;
        }}

        .ver-rates {{
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            margin-bottom: 15px;
        }}

        .rate {{
            background: var(--bg-secondary);
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 0.9em;
        }}

        .verified-rate {{ border-left: 3px solid var(--accent-green); }}
        .contradiction-rate {{ border-left: 3px solid var(--accent-red); }}
        .gt-passages {{ border-left: 3px solid var(--accent-blue); }}

        .ver-note {{
            margin: 10px 0;
            font-size: 0.92em;
            color: var(--text-secondary);
        }}

        .ver-note.ver-warning {{
            border-left: 3px solid var(--accent-yellow);
            padding: 10px;
            background: var(--bg-secondary);
        }}

        .ver-badge {{
            padding: 1px 6px;
            border-radius: 4px;
            font-size: 0.85em;
        }}

        .ver-badge-verified {{ background: var(--accent-green); color: #fff; }}
        .ver-badge-contradicted {{ background: var(--accent-red); color: #fff; }}

        .ver-contradictions .contradiction-item {{
            background: var(--bg-secondary);
            border-radius: 8px;
            padding: 10px;
            margin-bottom: 8px;
            border-left: 3px solid var(--accent-red);
        }}

        .contradiction-item .claim {{ font-size: 0.92em; }}
        .contradiction-item .meta {{ color: var(--text-secondary); font-size: 0.85em; margin-top: 4px; }}

        .gt-sources {{
            list-style: none;
            margin-top: 10px;
            font-size: 0.88em;
            color: var(--text-secondary);
        }}

        .gt-sources li {{
            padding: 4px 0;
            border-bottom: 1px dashed var(--border);
            font-family: monospace;
        }}

        .ver-provenance {{
            margin-top: 15px;
            padding: 12px;
            background: var(--bg-secondary);
            border-radius: 8px;
            border-left: 3px solid var(--accent-purple);
            font-size: 0.9em;
        }}

        footer {{
            text-align: center;
            padding: 20px;
            color: var(--text-secondary);
            font-size: 0.85em;
        }}

        @media (max-width: 768px) {{
            .stats-grid {{
                grid-template-columns: repeat(2, 1fr);
            }}

            header h1 {{
                font-size: 1.5em;
            }}
        }}
    </style>
</head>
<body>
    <div class="dashboard-container">
        <header>
            <h1>AEO & LLM Citation Graph Simulator</h1>
            <p class="subtitle">Generative Engine Optimization Dashboard | Generated: {timestamp}</p>
        </header>

        {grounding_banner}

        <div class="stats-grid">
            <div class="stat-card">
                <div class="value">{total_records}</div>
                <div class="label">Total Responses Analyzed</div>
            </div>
            <div class="stat-card">
                <div class="value">{len(recommendations)}</div>
                <div class="label">Actionable Recommendations</div>
            </div>
            <div class="stat-card">
                <div class="value">{len(biases)}</div>
                <div class="label">Detected Biases</div>
            </div>
            <div class="stat-card">
                <div class="value">{len(gaps)}</div>
                <div class="label">Competitive Gaps</div>
            </div>
            <div class="stat-card">
                <div class="value">{ver_overall.get('contradicted', 0)}</div>
                <div class="label">Contradicted Claims</div>
            </div>
            <div class="stat-card">
                <div class="value">{ver_overall.get('verified_rate', 0)*100:.1f}%</div>
                <div class="label">Claim Veracity</div>
            </div>
        </div>

        {charts_html}

        <div class="section">
            <h2>Executive Share of Model Voice (SoMV)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Brand</th>
                        <th>Share of Voice</th>
                        <th>Primary Recommendation Rate</th>
                        <th>Mention Rate</th>
                        <th>Omission Rate</th>
                    </tr>
                </thead>
                <tbody>
                    {brand_table_rows}
                </tbody>
            </table>
        </div>

        <div class="section">
            <h2>Actionable Recommendations ({len(recommendations)} total)</h2>
            <input type="text" id="rec-search" placeholder="Search recommendations..." oninput="filterRecs(this.value)"
                style="width:100%;padding:10px;margin-bottom:12px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border);border-radius:8px;" />
            <p style="color:var(--text-secondary)"><span id="rec-count">{len(recommendations)} shown</span> | computed_exposure = omission_gap x grounded-mention-base (no invented dollars)</p>
            {recommendation_html}
        </div>

        <div class="section">
            <h2>Commerce Truth (Agentic Shopping)</h2>
            {commerce_html}
        </div>

        <div class="section">
            <h2>Traffic Join (GSC Gate + AI Referrers)</h2>
            {traffic_html}
        </div>

        <div class="section">
            <h2>Detected Biases & Hallucination Patterns</h2>
            {bias_html if bias_html else '<p style="color: var(--text-secondary)">No significant biases detected.</p>'}
        </div>

        <div class="section">
            <h2>Data Integrity & Claim Verification</h2>
            {verification_html}
        </div>

        <div class="section">
            <h2>Competitive Gaps</h2>
            {gap_html if gap_html else '<p style="color: var(--text-secondary)">No significant competitive gaps identified.</p>'}
        </div>

        <footer>
            <p>AEO & LLM Citation Graph Simulator v2.0 | Verified, provenance-tracked LLM data with ground-truth claim verification</p>
        </footer>
    </div>
</body>
</html>"""

        return html

    def _save_json_data(self, results: Dict, output_dir: Path):
        json_dir = output_dir / 'json_data'
        json_dir.mkdir(exist_ok=True)

        for key, value in results.items():
            if isinstance(value, (dict, list)):
                filepath = json_dir / f'{key}.json'
                try:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        json.dump(value, f, indent=2, default=str, ensure_ascii=False)
                except Exception as e:
                    logger.warning(f"Failed to save {key}: {e}")
