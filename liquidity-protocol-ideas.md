# Liquidity Protocol Ideas: Hooks and Prop AMMs (BNB Bangkok)

Research compiled Nov 13, 2026.

## Candidate directions

1. **Pegged-RWA Bin pool** (Pancake Infinity Bin pool with a hook). Tight bins around an oracle NAV, fees that widen on depeg.
2. **Prop AMM angle on EVM.** Prop AMMs are no longer small on BNB Chain, but there are gaps (see below).
3. **Combined RWA story:** a pegged or oracle-anchored RWA pool with quote-staleness protection.

## Research 1: Hook ecosystem (newest source Nov 9, 2026)

* **PancakeSwap Infinity hooks are live on BNB mainnet** (launched Apr 2025). Vault, CL and Bin pool managers, hooks as the extension point. Docs: https://developer.pancakeswap.finance/contracts/infinity/overview · Hooks repo: https://github.com/pancakeswap/infinity-hooks
* **Existing Pancake hooks:** Dynamic Fee, VIP Discount and Token Holding Fee Discount (built with Brevis), plus a launch-gate hook (CLAlphaHook). No public hook registry. No limit-order, TWAP, RWA or LP-rebalancer hook found on Pancake (from searches, not a registry).
* **Uniswap v4:** Permissioned Pools (Jul 2026, Superstate / Securitize, ERC-3643 allowlist on swap and LP mint) https://blog.uniswap.org/introducing-permissioned-pools-on-uniswap-v4 · Aggregator Hooks (Oct 2026) · community hooks for limit orders, TWAP and KYC.
* **Hook ideas considered:**

| Idea | Feasibility (36h) | Novelty on BNB |
|------|-------------------|----------------|
| Toxic-flow / agent-aware dynamic fee | High | High |
| RWA KYC-gated pool | High | Medium-high |
| JIT LP range rebalancer | Medium | Medium |
| Batch auction / intent | Medium-low | High |
| Pegged-RWA curve (Bin pool) | Medium | Medium-high |
| Oracle-anchored AMM | Low-medium | High |
| Prediction-market curve | Low | High |

## Research 2: Prop AMMs on EVM (newest page Nov 5, 2026)

**Live today**

* **Tessera** (Wintermute): about $725M over 30 days on BNB, also Base.
* **Metric:** about $1.8B over 30 days on BNB, also Base and Monad.
* **Kipseli:** EIP-712 signed quotes valid for 10 seconds. About $550M on BNB since Jul 31 (search summary, not verified). Docs: https://docs.kipseli.capital/
* **LunarBase:** $56M to $86M over 30 days depending on source; already targets tokenized stocks. https://lunarbase.gg/
* Also Elfomo, Hanji, FluxPool (small or no numbers).
* Base ETH/USDC prop AMM volume went from $9.5M to $29.6M a day (Sept 2026 arXiv paper).
* Sources disagree on volumes and not reconciled (LunarBase's own site, KuCoin and DeFiLlama differ).

**Why EVM is still smaller than Solana**

* Update cost: a price update is about 1/10 of a swap's gas on EVM vs about 1/1000 on Solana (ChainCatcher, Oct 2025).
* Builder ordering: builders can delay a maker's update and auction the arbitrage (https://ethresear.ch/t/proprietary-amms-and-ethereum/25543, Jul 26, 2026).
* Spoofing: 0x found Base makers quoting well then repricing next block, 5-10 bps extra cost to traders (https://0x.org/post/propamm-shenanigans, Mar 2026). May be outdated: Base moved to 200ms blocks on Nov 5, 2026.
* BNB Chain has run 0.45s blocks since Jan 2026 (Fermi fork), which shrinks the staleness window.

**Gaps (inference)**

* No open, verifiable guarantee that a quote is executable at the price shown.
* No open-source prop AMM template found.
* Tokenized RWAs and stables have low staleness risk.

## Project ideas for BNB Bangkok

Analysis, not from sources.

1. **QuoteGuard: spoof-proof prop AMM wrapper.** Block-stamped quotes that revert if stale. Stack: Solidity, EIP-712, Foundry. Demo: split screen of a naive prop AMM being sniped next to the guarded one.
2. **RWA prop AMM for tokenized stocks on BSC.** Spreads that widen when the market is closed. Stack: Solidity pool, Pyth or CEX feed, update bot. Closest to the pegged-RWA Bin pool. Demo: live swap with spread vs market-hours chart.
3. **AI market-making agent.** An agent sets spread and skew for a pegged-asset prop AMM. Fits the AI track. Demo: PnL vs a static AMM in a toxic-flow simulation.
4. **Pegged-RWA Bin pool hook.** Oracle-NAV centered bins, fee widens on depeg and on oracle age.

## Open questions

* Can Pancake hooks override pricing, or only fees? This decides hook vs custom pool. The Pancake hooks docs returned 404, so callbacks are unverified.
* Which BNB venues can route to a new prop AMM?
* Pyth, RedStone, Chainlink low-latency feed options.
* Any BNB-specific hook bounties (ask Pancake directly).

## Checked / Not checked

* **Checked (Nov 13, 2026):** Pancake overview, addresses and blog, hook-rehearsal repo, Uniswap v4 overview and Permissioned Pools, ethresear.ch post, Helius, 0x report, arXiv paper, BNB Chain blog, Kipseli docs, LunarBase, ChainCatcher, The Block (Denim).
* **Not checked:** Pancake hooks doc pages (404), DeFiLlama (403), Dune, Pyth / RedStone / Chainlink low-latency, Hashflow / Bebop / 1inch / Curve / Maverick / DODO as prop AMMs, Ethereum mainnet and Arbitrum prop AMMs. Some figures rest on search summaries only.
