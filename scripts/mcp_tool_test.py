"""
MCP tool-contract e2e test — actually CALLS the tool, not just JSON-parses the manifest.
Usage: python scripts/mcp_tool_test.py https://example.com [--tool search_catalog]
Probes /.well-known/mcp.json, validates tools[] non-empty, then POSTs a minimal
tools/call (JSON-RPC) to the manifest's endpoint and reports real success/failure.
Exit 0 = tool call succeeded. Exit 2 = manifest invalid/unreachable. Exit 3 = call failed.
"""
import json
import sys
import urllib.request

UA = 'Mozilla/5.0 (compatible; AEO-Simulator/2.0; +mcp-e2e)'


def get(url, timeout=12):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(300000).decode('utf-8', 'ignore')


def post(url, payload, timeout=15):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={'User-Agent': UA, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(300000).decode('utf-8', 'ignore')


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    base = sys.argv[1].rstrip('/')
    tool = sys.argv[3] if len(sys.argv) > 3 and sys.argv[2] == '--tool' else 'search_catalog'
    try:
        manifest_raw = get(base + '/.well-known/mcp.json')
    except Exception as e:
        print(f'MANIFEST UNREACHABLE: {e}')
        return 2
    try:
        manifest = json.loads(manifest_raw)
    except Exception:
        print('MANIFEST INVALID JSON')
        return 2
    tools = manifest.get('tools') or manifest.get('capabilities') or manifest.get('functions') or []
    if not isinstance(tools, list) or not tools:
        print('MANIFEST INVALID: no non-empty tools[]/capabilities[]/functions[]')
        return 2
    names = [t.get('name') if isinstance(t, dict) else t for t in tools]
    print(f'Manifest OK: {len(tools)} tool(s): {names[:10]}')
    endpoint = manifest.get('endpoint') or manifest.get('url') or (base + '/mcp')
    payload = {'jsonrpc': '2.0', 'id': 1, 'method': 'tools/call', 'params': {'name': tool, 'arguments': {'query': 'pricing'}}}
    try:
        status, body = post(endpoint, payload)
        ok = status < 400 and 'error' not in body[:500].lower()
        print(f'Tool call {tool} @ {endpoint}: HTTP {status} {"OK" if ok else "FAILED"}')
        print(body[:1000])
        return 0 if ok else 3
    except Exception as e:
        print(f'TOOL CALL FAILED: {e}')
        return 3


if __name__ == '__main__':
    sys.exit(main())
