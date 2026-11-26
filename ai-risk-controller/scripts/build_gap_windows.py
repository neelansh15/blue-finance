"""Build reproducible gap CSV + provenance + missing-window report from supplied adjusted JSON."""
import argparse
import csv
from datetime import datetime
import hashlib
import json
from pathlib import Path

from app.historical_windows import AdjustedHistory, build_windows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    raw = args.input.read_bytes()
    if len(raw) > 20_000_000:
        raise ValueError('History input exceeds 20 MB')
    history = AdjustedHistory.model_validate_json(raw)
    rows, manifest, missing = build_windows(history, datetime.fromisoformat(args.as_of))
    with args.output.open('w', newline='') as file:
        writer = csv.DictWriter(file, fieldnames=['asset','regime','window_start','window_end','start_price','end_price','event'])
        writer.writeheader()
        writer.writerows(r.model_dump(mode='json') for r in rows)
    args.output.with_suffix('.manifest.json').write_text(manifest.model_dump_json(indent=2)+'\n')
    args.output.with_suffix('.windows.json').write_text(json.dumps({
        'input_sha256':hashlib.sha256(raw).hexdigest(), 'as_of':args.as_of, 'windows':len(rows),
        'missing_boundaries':missing, 'event_references':[e.model_dump(mode='json') for e in history.events],
        'source_verification':'UNVERIFIED_CALLER_DECLARATION','calibrated':False},indent=2)+'\n')


if __name__ == '__main__':
    main()
