"""
Verify tamper-evident provenance: SHA-256 run manifest + hash-chained audit JSONL.
Usage: python scripts/verify_manifest.py data/output/<run_or_analysis_dir>
Exit 0 = verified. Exit 2 = tamper/mismatch. Exit 1 = missing manifest (legacy run).
"""
import hashlib
import json
import sys
from pathlib import Path


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    root = Path(sys.argv[1])
    manifest = root / 'manifest.json'
    if not manifest.exists():
        manifest = root / 'run_manifest.json'
    if not manifest.exists():
        print(f'NO MANIFEST in {root} (legacy run — re-run to generate SHA-256 manifest).')
        return 1
    m = json.loads(manifest.read_text(encoding='utf-8'))
    bad = []
    for entry in m.get('files', []):
        fp = root / entry.get('path', '')
        if not fp.exists():
            bad.append(f"MISSING {entry.get('path')}")
            continue
        if entry.get('sha256') and sha256_file(fp) != entry['sha256']:
            bad.append(f"TAMPERED {entry.get('path')}")
    audit = root / 'audit.jsonl'
    chained = True
    if audit.exists():
        prev = 'GENESIS'
        for line in audit.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except Exception:
                chained = False
                break
            if e.get('prev_hash', 'GENESIS') != prev and prev != 'GENESIS':
                chained = False
                break
            prev = e.get('hash', '')
    if bad:
        print('TAMPER DETECTED:\n - ' + '\n - '.join(bad))
        return 2
    print(f'Manifest OK ({len(m.get("files", []))} files), audit chain {"OK" if chained else "UNVERIFIED"}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
