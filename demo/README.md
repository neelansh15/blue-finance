# Dawn demo: local BSC fork

Everything runs on a local anvil fork of BSC mainnet (chain id 56, port 8545). All tunables live in
`demo/config.env` and are PLACEHOLDERS (haircuts, caps, prices, durations). Keys are the public anvil keys.

## One command

    demo/check.sh            # restarts anvil, deploys, runs the 4 scenarios, prints PASS/FAIL
    demo/check.sh --no-start # reuse the running fork

Logs: `demo/logs/` (anvil.log, deploy.log, bot.log, check.out).

## Setup

    source demo/config.env
    demo/start.sh            # idempotent: kills old anvil, forks, deploys, writes:
                             #   protocol/deployments/56.json
                             #   frontend/.env.local  (NEXT_PUBLIC_DAWN_MODE=real + addresses)
                             #   keepers/.env.anvil   (keeper + bot config; bash-source it)
    cd frontend && npm run dev          # http://localhost:3000/app  (real client, demo user key)

Notes
- `FORK_URL` must be an archive-capable BSC RPC. `bsc-dataseed.binance.org` prunes state after a few
  minutes and the fork dies with "missing trie node". Default is blastapi; override with `BSC_RPC_URL`.
- `start.sh` warps chain time to a Tuesday 10:00 New York (`WARP_TO`) so the calendar regime is OPEN
  whenever you run it (today's date can be a weekend or holiday). Because of that, do NOT run the
  regime keeper against the warped fork: it uses wall-clock time and will (correctly) override to WEEKEND.
  Drive regimes with demo control instead, or set `WARP_TO=` to keep real time.
- In this sandbox set `NO_PROXY=127.0.0.1,localhost` (already in config.env).

## Shell helpers

    source demo/config.env; set -a; source keepers/.env.anvil; set +a
    TSX=keepers/node_modules/.bin/tsx
    snap()  { $TSX demo/step.ts snap; }                    # regime, oracle frozen, price, collateral, debt, hf
    demo()  { (cd keepers && DEMO_PRIVATE_KEY=$DEPLOYER_KEY $TSX src/demoControl.ts "$@"); }
    TOKEN=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].token)')
    FEED=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].feed)')
    ORACLE=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].oracle)')
    (cd keepers && nohup $TSX src/liquidationBot.ts > ../demo/logs/bot.log 2>&1 &)   # liquidation bot (needed for scenario 4)

## The 4 scenarios (10 bAAPL at $200, borrow 1000 USDT)

### 1. Borrow in OPEN
    $TSX demo/step.ts open 10 1000   # accepted
    $TSX demo/step.ts open 0 100     # rejected: AboveTargetLtv (router limit ~1022)
    snap                             # regime OPEN, hf 1.25
Say: "Morpho alone would allow 62.5% LTV. The router adds a regime-aware target LTV (51.1% in OPEN) and a signed eligibility attestation."

### 2. Flip to WEEKEND
    demo regime set $TOKEN WEEKEND --duration 600
    demo oracle update $ORACLE
    snap                             # oracle price 170 (15% haircut), hf 1.0625, position intact
    $TSX demo/step.ts open 0 50      # rejected: limit tightened to ~869
Say: "The market closes, the limit tightens, the existing position is not liquidated by the regime change alone."

### 3. 2-for-1 split
    demo multiplier $TOKEN 2         # multiplier changes first, the feed has not caught up
    demo oracle update $ORACLE
    snap                             # frozen=true, price held near last good (180), hf > 1
    demo price $FEED 100             # feed catches up (per-share price halves)
    demo oracle update $ORACLE
    snap                             # unfrozen, price 200, hf 1.25
Say: "A naive oracle sees the price jump or drop and liquidates. DawnOracle freezes, then unfreezes once the feed is continuous."

### 4. Price gap, bot liquidates
(restart `demo/start.sh` and reopen the position first, or `evm_revert` to a snapshot)

    demo price $FEED 130             # -35% gap
    demo oracle update $ORACLE
    # the bot logs liquidation_sent within one poll; then
    snap                             # debt 0, collateral mostly seized
Say: "Health drops below 1; the bot repays the debt through Morpho via the callback contract."

## Known limits
- Keepers' external halt sources (Nasdaq RSS, Binance bapi/spot) need real network access; in the sandbox they return unknown.
- The frontend debt figure excludes interest accrued since Morpho's last market update.
- Seized collateral stays in the callback contract (no swapper configured).
