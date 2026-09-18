"""
Refresh-cadence ticket emitter (per-family freshness enforcement).
Usage: python scripts/refresh_tickets.py --out tickets.csv
Reads site_audit freshness (dateModified age) + geo_temporal.refresh_cadence and emits
Jira/Linear-ready CSV: "Refresh /pricing - 34 days old, ChatGPT window expired."
Windows: ChatGPT/Perplexity ~30d, Claude ~quarter(90d), AIO ~year(365d).
"""
import argparse
import csv
import json
from pathlib import Path

WINDOWS = {'ChatGPT/Perplexity': 30, 'Claude': 90, 'AIO': 365}


def latest_summary():
    outs = sorted(Path('data/output').glob('analysis_*/pipeline_summary.json'))
    if not outs:
        raise SystemExit('No analysis found — run the pipeline first.')
    return json.loads(outs[-1].read_text(encoding='utf-8'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='refresh_tickets.csv')
    a = ap.parse_args()
    s = latest_summary()
    site = s.get('site_audit', {}) or {}
    pages = site.get('pages', []) or []
    rows = []
    for p in pages:
        age = ((p.get('checks', {}) or {}).get('freshness', {}) or {}).get('age_days')
        url = p.get('url', '')
        if age is None:
            rows.append({'page': url, 'age_days': '', 'ticket': f'Refresh {url} — no dateModified found; add it (freshness rerank signal).', 'priority': 'HIGH'})
            continue
        expired = [fam for fam, w in WINDOWS.items() if age > w]
        if expired:
            rows.append({'page': url, 'age_days': age,
                         'ticket': f'Refresh {url} — {age} days old, {" + ".join(expired)} window expired.',
                         'priority': 'HIGH' if age > 30 else 'MEDIUM'})
    with open(a.out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=['page', 'age_days', 'ticket', 'priority'])
        w.writeheader()
        w.writerows(rows)
    print(f'{len(rows)} ticket(s) -> {a.out}')


if __name__ == '__main__':
    main()
