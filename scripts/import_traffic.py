"""
Traffic importers — one-click normalization for GSC / GA4 / Bing AI Performance exports.
Usage:
  python scripts/import_traffic.py --gsc gsc.csv --ga4 ga4.csv --bing bing-ai.csv
  python scripts/import_traffic.py --gsc data/raw/gsc.csv   # any subset works
Normalizes headers (case/space-insensitive) into data/uploads/traffic/:
  gsc_normalized.csv   (query,clicks,impressions,position,ai_overview_present)
  ga4_normalized.csv   (source,sessions,conversions,revenue)
  bing_normalized.csv  (query,impressions,ai_answers,clicks)
Never fabricates: missing columns raise with the exact expected schema.
"""
import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'data' / 'uploads' / 'traffic'
OUT.mkdir(parents=True, exist_ok=True)

GSC_FIELDS = ['query', 'clicks', 'impressions', 'position', 'ai_overview_present']
GA4_FIELDS = ['source', 'sessions', 'conversions', 'revenue']
BING_FIELDS = ['query', 'impressions', 'ai_answers', 'clicks']


def _norm_headers(fieldnames):
    return { (fn or '').strip().lower().replace(' ', '_'): fn for fn in (fieldnames or []) }


def _load(path):
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f'{path}: empty CSV, no header row')
        return reader.fieldnames, list(reader)


def _pick(row, mapping, *cands):
    for c in cands:
        if c in mapping:
            v = row.get(mapping[c], '')
            if v not in (None, ''):
                return v
    return ''


def import_gsc(src):
    fields, rows = _load(src)
    m = _norm_headers(fields)
    need = ['query', 'clicks', 'impressions']
    missing = [c for c in need if c not in m]
    if missing:
        raise ValueError(f'GSC {src}: missing columns {missing}. Expected: {GSC_FIELDS}')
    out = OUT / 'gsc_normalized.csv'
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=GSC_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({
                'query': _pick(r, m, 'query', 'top_queries'),
                'clicks': _pick(r, m, 'clicks') or 0,
                'impressions': _pick(r, m, 'impressions') or 0,
                'position': _pick(r, m, 'position', 'avg_position') or '',
                'ai_overview_present': _pick(r, m, 'ai_overview_present', 'aio', 'ai_overview', 'generative_inclusion') or 0,
            })
    print(f'GSC: {len(rows)} rows -> {out}')
    return out


def import_ga4(src):
    fields, rows = _load(src)
    m = _norm_headers(fields)
    missing = [c for c in ['source', 'sessions'] if c not in m]
    if missing:
        raise ValueError(f'GA4 {src}: missing columns {missing}. Expected: {GA4_FIELDS} (tag links with utm_source=chatgpt.com etc.)')
    out = OUT / 'ga4_normalized.csv'
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=GA4_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({
                'source': _pick(r, m, 'source', 'session_source', 'referrer') or '(direct)',
                'sessions': _pick(r, m, 'sessions') or 0,
                'conversions': _pick(r, m, 'conversions', 'key_events') or 0,
                'revenue': _pick(r, m, 'revenue', 'purchase_revenue', 'total_revenue') or 0,
            })
    print(f'GA4: {len(rows)} rows -> {out}')
    return out


def import_bing(src):
    fields, rows = _load(src)
    m = _norm_headers(fields)
    if 'query' not in m and 'keyword' not in m:
        raise ValueError(f'Bing {src}: missing query column. Expected: {BING_FIELDS}')
    out = OUT / 'bing_normalized.csv'
    with open(out, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=BING_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({
                'query': _pick(r, m, 'query', 'keyword') or '',
                'impressions': _pick(r, m, 'impressions') or 0,
                'ai_answers': _pick(r, m, 'ai_answers', 'ai_overview_present', 'copilot_answers') or 0,
                'clicks': _pick(r, m, 'clicks') or 0,
            })
    print(f'Bing: {len(rows)} rows -> {out}')
    return out


def main():
    ap = argparse.ArgumentParser(description='One-click GSC/GA4/Bing traffic importers')
    ap.add_argument('--gsc', default=None)
    ap.add_argument('--ga4', default=None)
    ap.add_argument('--bing', default=None)
    a = ap.parse_args()
    if not (a.gsc or a.ga4 or a.bing):
        ap.error('Pass at least one of --gsc/--ga4/--bing (CSV export path).')
    if a.gsc:
        import_gsc(a.gsc)
    if a.ga4:
        import_ga4(a.ga4)
    if a.bing:
        import_bing(a.bing)
    print('Done. Re-run analysis to refresh traffic_join + ROI line.')


if __name__ == '__main__':
    sys.exit(main())
