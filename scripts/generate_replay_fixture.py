#!/usr/bin/env python3
"""Generate test-only integer vectors; Solidity checks them against unchanged Morpho."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'ai-risk-controller'))
from app.simulation.morpho import MorphoReplay, replay

state=dict(total_borrow_assets=900*10**18,total_borrow_shares=900*10**24,
    total_supply_assets=100000*10**18,total_supply_shares=100000*10**24,
    collateral=10*10**18,borrow_shares=900*10**24,oracle_price=120*10**36,
    elapsed_seconds=86400,borrow_rate_wad=10**9,repaid_shares=100*10**24)
content=json.dumps({'purpose':'Generated test vector, never market evidence','input':{k:str(v) for k,v in state.items()},
                    'result':replay(MorphoReplay(**state))},indent=2)+'\n'
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');args=parser.parse_args()
target=ROOT/'protocol-old/test/fixtures/morpho-replay.json'
if args.check:
    if target.read_text()!=content:raise SystemExit('Regenerate Morpho replay fixture')
else:
    target.parent.mkdir(exist_ok=True);target.write_text(content)
