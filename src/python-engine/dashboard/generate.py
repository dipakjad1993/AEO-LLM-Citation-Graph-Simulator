"""
Dashboard Generator
Creates interactive HTML dashboards with charts, tables, and actionable insights.
Uses Plotly for interactive visualizations and Jinja2 for templating.
"""

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

        html = self._generate_html(results, charts)

        dashboard_path = dashboard_dir / 'aeo_dashboard.html'
        with open(dashboard_path, 'w') as f:
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

        colors = {
            'Brand_A': '#2ecc71',
            'Brand_B': '#e74c3c',
            'Brand_C': '#3498db',
            'Competitor_B': '#e67e22',
            'Competitor_C': '#9b59b6'
        }

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

        colors = {'Brand_A': '#2ecc71', 'Brand_B': '#e74c3c', 'Brand_C': '#3498db'}

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

    def _generate_html(self, results: Dict, charts: List) -> str:
        somv = results.get('somv', {})
        overall = somv.get('overall', {})
        brand_stats = overall.get('brand_stats', {})
        recommendations = results.get('recommendations', [])
        biases = results.get('sentiment_matrix', {}).get('detected_biases', [])
        gaps = somv.get('competitive_gaps', [])

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

            sov_class = 'positive' if brand == 'Brand_A' and sov > 30 else 'negative' if brand != 'Brand_A' and sov > 40 else ''

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
        for rec in recommendations[:10]:
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

        total_records = results.get('total_records_analyzed', results.get('total_records', 0))
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AEO Citation Graph Simulator - Dashboard</title>
    <script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
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
            <h2>Actionable Recommendations</h2>
            {recommendation_html}
        </div>

        <div class="section">
            <h2>Detected Biases & Hallucination Patterns</h2>
            {bias_html if bias_html else '<p style="color: var(--text-secondary)">No significant biases detected.</p>'}
        </div>

        <div class="section">
            <h2>Competitive Gaps</h2>
            {gap_html if gap_html else '<p style="color: var(--text-secondary)">No significant competitive gaps identified.</p>'}
        </div>

        <footer>
            <p>AEO & LLM Citation Graph Simulator v1.0 | Replaces $15,000-$25,000/month manual AEO agency retainers</p>
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
                    with open(filepath, 'w') as f:
                        json.dump(value, f, indent=2, default=str)
                except Exception as e:
                    logger.warning(f"Failed to save {key}: {e}")
