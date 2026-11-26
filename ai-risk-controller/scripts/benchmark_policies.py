"""Compare explicit policies on a shared, supplied historical evaluation set."""
import argparse
from datetime import datetime
import json
from pathlib import Path

from app.backtesting import BenchmarkPolicy, Episode, compare_policies


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--as-of',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    raw=args.input.read_bytes()
    if len(raw)>20_000_000:
        raise ValueError('Benchmark input exceeds 20 MB')
    data=json.loads(raw)
    if len(data['episodes'])>100000 or len(data['policies'])>100:
        raise ValueError('Benchmark input exceeds episode/policy bounds')
    report=compare_policies([Episode.model_validate(e) for e in data['episodes']],
        [BenchmarkPolicy.model_validate(p) for p in data['policies']],datetime.fromisoformat(args.as_of))
    args.output.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')


if __name__=='__main__':
    main()
