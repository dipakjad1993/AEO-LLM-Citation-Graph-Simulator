"""
Snippet fail-gate for CI (P0, Google May-15 Guide).
Usage: python scripts/snippet_gate.py https://example.com/pricing [--extra https://example.com/...]
Exit 0 = snippet-eligible. Exit 2 = BLOCKED (nosnippet / max-snippet:0 / data-nosnippet).
On block: prints the offending markers and (if SLACK_WEBHOOK_URL set) fires a Slack alert.
"""
import json
import os
import re
import sys
import urllib.request

UA = 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +snippet-gate-ci)'


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(1000000).decode('utf-8', 'ignore')


def check(html):
    blocks = []
    if re.search(r'<meta[^>]+name=["\']robots["\'][^>]*nosnippet', html, re.I):
        blocks.append('meta robots nosnippet')
    if re.search(r'max-snippet\s*:\s*0', html, re.I):
        blocks.append('max-snippet:0')
    if 'data-nosnippet' in html:
        blocks.append('data-nosnippet attribute')
    return blocks


def slack(text):
    hook = os.environ.get('SLACK_WEBHOOK_URL', '')
    if not hook:
        return
    try:
        req = urllib.request.Request(hook, data=json.dumps({'text': text}).encode(), headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=10)
        print('Slack alert fired.')
    except Exception as e:
        print(f'Slack failed: {e}')


def main(urls):
    failed = {}
    for u in urls:
        try:
            blocks = check(fetch(u))
        except Exception as e:
            print(f'ERROR {u}: {e}')
            return 1
        if blocks:
            failed[u] = blocks
            print(f'BLOCKED {u}: {", ".join(blocks)}')
        else:
            print(f'OK {u}: snippet-eligible')
    if failed:
        print('\nFAIL GATE: snippet blocks kill ALL AIO visibility (Google applies them to AI Overviews/Mode too).')
        print('Precedent: Meltwater May-2026 relaunch fixing exactly this drove 99k -> 172k citations (+73% in weeks).')
        slack(f"⛔ AEO snippet FAIL GATE (CI): {len(failed)} URL(s) blocked: " + '; '.join(f'{u} ({", ".join(b)})' for u, b in failed.items()))
        return 2
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    sys.exit(main([a for a in sys.argv[1:] if not a.startswith('--extra')] + [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == '--extra' and i + 1 < len(sys.argv)]))
