# Ideas Brainstorm

**For:** BNB Bangkok build (2pm Nov 25 to 2am Nov 27, Bangkok time)
**Tracks:** AI / RWA / Trading
**Judging:** Design and Usability, Scalability, Innovation, Open Source, Integration

BNB research is in [liquidity-protocol-ideas.md](liquidity-protocol-ideas.md). Direction (Nov 13): pegged RWA Bin pool, and prop AMMs on EVM. Hook-specific work parked.

Chosen direction since Nov 25: lending for tokenized equities, see [architecture-v0.md](architecture-v0.md). The ideas below are the earlier shortlist.

## Shortlist

| #   | Idea | Track | Risk in 36h | Demo moment |
|-----|------|-------|-------------|-------------|
| 1   | PropAMM design lab / simulator | Trading | Low         | Leaderboard of fee and recenter policies on replayed trades |
| 2   | RWA prop AMM (tokenized stocks, pegged assets) | RWA   | Medium      | Live swap, spread widens when the market is closed |
| 3   | AI market-making agent for a prop AMM | AI    | Medium      | PnL vs a static AMM in a toxic-flow sim |
| 4   | QuoteGuard (spoof-proof quote wrapper) | Trading | Medium      | Naive prop AMM sniped vs guarded, side by side |
| 5   | Stock Terminal (onchain, Bloomberg-style) | Trading | Medium      | Cmd+K command line, live chart, order ticket |
| 6   | Pegged-RWA Bin pool hook | RWA   | Medium      | Oracle-NAV bins, fee widens on depeg |

## PropAMMs

**Why:** a normal AMM only learns the market price when someone trades, so arbs profit at LPs' expense (LVR). A propAMM has the price pushed into the pool continuously, so arbs can't trade at a stale price. Already large on BNB Chain (Tessera about $725M, Metric about $1.8B over 30 days), but closed-source and run by single firms.

**Permissionless version (Yield Basis on Curve):** anyone pushes a signed Pyth price (max 12s old) with their trade, and a fresh price lowers their fee. Simulated 8.5%/yr vs 3.6%/yr for WETH LPs. Source: https://x.com/yieldbasis/status/2115461852368900558

**Design axes:**

* Price source: Pyth, Chainlink Data Streams, RedStone, TWAP
* Fee policy: edge, staleness, volatility, trade size or direction
* Recenter rule: trend vs noise, cost-aware moves
* Who pushes the price: arbs, keepers, solvers
* Flow classification: retail pays little, arbs pay more

**Projects:**

1. **Simulator:** replay historical trades against pluggable fee and recenter policies, compare LP return, volume and arb leakage. Needs no deployment; the others can build on it.
2. **Open-source policy template:** oracle-edge fee rule, several variants. No open-source prop AMM template exists yet (checked Nov 13), which helps the Open Source criterion.
3. **Flow classifier:** separate ordinary from arb trades.
4. **Dashboard:** propAMM vs public pool execution (markout vs mid) per pair on BNB Chain.

**BNB notes:** 0.45s blocks since Jan 2026 shrink the staleness window. A price update costs about 1/10 of a swap's gas on EVM, and builders can delay a maker's update.

## Stock Terminal

Bloomberg-style terminal for onchain markets on BNB Chain venues (PancakeSwap, prop AMMs).

* Panes: watchlist, chart, order ticket, depth and liquidity, news
* Charts from our WebGPU library (ChartGPU 0.2.0)
* Cmd+K commands: `WETH/USDC <chart>`, `BUY 1 ETH`
* Tokenized stocks and RWAs if liquidity exists, else crypto majors
* Pairs well with #1 or #2: the pool is the engine, the terminal is the demo

Open: which tokenized-stock pairs have real BNB liquidity (LunarBase already targets them), read-only vs trading.

## Hook ideas (parked)

PancakeSwap Infinity hooks (Vault, CL, Bin pool managers):

* Toxic-flow or agent-aware dynamic fee (high feasibility, high novelty on BNB)
* Idle-liquidity yield: park out-of-range liquidity in lending, pull back on swaps
* Limit orders, TWAP, stop-loss (none found on Pancake)
* LP hedging with perps or options

Open: can Pancake hooks override pricing or only fees? Docs returned 404 on Nov 13.

## Reusable assets

* ChartGPU (WebGPU charts, indicators, drawings)
* CL LP bot plan (concentrated-liquidity logic, markout metric)
* AI Trading Agent and AI Data Pipeline scopes

## Rules of thumb

* Two or three integrations at most; more thins the demo.
* Pick the demo moment first, build backwards.
* Keep the core runnable without deployment so there is always something to show.

## Open questions

* Sponsor bounties (Luma lists Flap.sh, Four.meme, AWS, Atlas Oracle). Challenges should be in the approval email.
* Which BNB venues can route to a new prop AMM; Pyth, RedStone or Chainlink low-latency feed access.
