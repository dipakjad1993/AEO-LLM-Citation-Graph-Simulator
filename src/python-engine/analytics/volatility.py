"""
Volatility Analyzer — repeat-run variance for money prompts (2026).
AIO shifts ~70% on repeat: single-run SoMV is theater. Run each money prompt
5x (execution.volatility.repeats), then report per-prompt variance, per-brand
win-rate CIs, and a volatility-adjusted SoMV.
Wilson score intervals for binomial rates; no fabricated data.
"""
import logging
import math
import re
from collections import defaultdict
from typing import Dict, Any, List

import polars as pl

logger = logging.getLogger(__name__)


def wilson(p: float, n: int, z: float = 1.96):
    if n == 0:
        return (0.0, 0.0)
    denom = 1 + z * z / n
    center = p + z * z / (2 * n)
    margin = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (round(max(0, (center - margin) / denom), 4), round(min(1, (center + margin) / denom), 4))


class VolatilityAnalyzer:
    def __init__(self, config: Dict):
        self.config = config
        em = config.get('entity_maps', {}).get('entity_maps', {})
        self.primary = (em.get('your_brand', {}) or {}).get('primary_name', '')
        comps = em.get('competitors', []) or []
        self.brands = ([self.primary] if self.primary else []) + [c.get('primary_name') for c in comps if c.get('primary_name')]
        try:
            from brand_utils import build_brand_patterns
            self._re = {b: re.compile(p, re.I) for b, p in build_brand_patterns(em).items()}
        except Exception:
            self._re = {b: re.compile(re.escape(b), re.I) for b in self.brands}

    def analyze(self, df: pl.DataFrame) -> Dict[str, Any]:
        result: Dict[str, Any] = {'prompts': {}, 'brand_win_rates': {}, 'summary': {}, 'recommendations': []}
        if 'prompt' not in df.columns:
            result['status'] = 'no_prompt_column'
            return result
        reps = 'volatility_rep' if 'volatility_rep' in df.columns else None
        groups = defaultdict(list)
        cols = ['prompt', 'model_id', 'raw_text'] + ([reps] if reps else [])
        try:
            rows = df.select(cols).to_dicts()
        except Exception:
            result['status'] = 'column_error'
            return result
        for r in rows:
            groups[(r.get('prompt') or '')[:200], r.get('model_id') or ''].append(r.get('raw_text') or '')
        unstable = 0
        for (prompt, model), texts in groups.items():
            if len(texts) < 2:
                continue
            # Brand win per repeat: which brands mentioned in each repeat
            wins = {b: sum(1 for t in texts if self._re.get(b) and self._re[b].search(t)) for b in self.brands}
            n = len(texts)
            # Prompt-level instability: fraction of repeats where the top-mentioned brand differs
            leaders = []
            for t in texts:
                counts = {b: len(self._re[b].findall(t)) if self._re.get(b) else 0 for b in self.brands}
                leaders.append(max(counts, key=counts.get) if max(counts.values()) > 0 else None)
            flips = sum(1 for i in range(1, len(leaders)) if leaders[i] != leaders[i - 1])
            instability = round(flips / max(len(leaders) - 1, 1), 3)
            if instability > 0.4:
                unstable += 1
            result['prompts'][f'{model} :: {prompt[:80]}'] = {
                'repeats': n, 'instability': instability,
                'brand_win_counts': wins,
                'brand_win_rates': {b: {'rate': round(c / n, 4), 'ci95': wilson(c / n, n)} for b, c in wins.items()},
            }
        # Aggregate win rates with CIs
        for b in self.brands:
            all_wins = sum(v['brand_win_counts'].get(b, 0) for v in result['prompts'].values())
            all_n = sum(v['repeats'] for v in result['prompts'].values())
            rate = all_wins / all_n if all_n else 0
            result['brand_win_rates'][b] = {'wins': all_wins, 'repeats': all_n, 'rate': round(rate, 4), 'ci95': wilson(rate, all_n)}
        result['summary'] = {
            'prompts_with_repeats': len(result['prompts']),
            'unstable_prompts': unstable,
            'unstable_share': round(unstable / len(result['prompts']), 3) if result['prompts'] else 0,
        }
        if result['summary']['unstable_share'] > 0.3:
            result['recommendations'].append('High answer volatility: >30% of money prompts flip leaders across repeats. Report CI-banded SoMV, never point estimates.')
        if not result['prompts']:
            result['status'] = 'no_repeats'
            result['message'] = 'No repeated prompts found. Set execution.volatility.enabled=true, repeats=5 to measure variance.'
        else:
            result['status'] = 'measured'
        return result

    def save(self, results: Dict, output_dir) -> None:
        import json
        reports = output_dir / 'reports'
        reports.mkdir(exist_ok=True)
        with open(reports / 'volatility.json', 'w') as f:
            json.dump(results, f, indent=2, default=str)
        logger.info('Saved volatility to %s', reports)
