<div align="center">

# Dawn Finance

**Lending against tokenized US stocks on BNB Chain, with a risk layer that knows when the stock market is open.**

![BNB Chain](https://img.shields.io/badge/chain-BNB%20Chain-F0B90B?logo=binance&logoColor=white)
![Morpho Blue](https://img.shields.io/badge/built%20on-Morpho%20Blue%20(unmodified)-2470FF)
![Solidity](https://img.shields.io/badge/solidity-0.8.28-363636?logo=solidity&logoColor=white)
![Foundry](https://img.shields.io/badge/tests-Foundry-orange)
![Forge tests](https://img.shields.io/badge/forge%20tests-102%20passing-brightgreen)
![Next.js](https://img.shields.io/badge/frontend-Next.js-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/keepers-TypeScript-3178C6?logo=typescript&logoColor=white)
![Status](https://img.shields.io/badge/status-hackathon%20demo-yellow)
![Audit](https://img.shields.io/badge/audit-none-red)
![Event](https://img.shields.io/badge/BNB%20Bangkok-Nov%202026-blueviolet)

</div>

> **Status: hackathon demo (BNB Bangkok, Nov 25-27, 2026).** Contracts are tested on a BNB mainnet fork only. They are not audited and not deployed to mainnet. All risk parameters (haircuts, margin, continuity band) are labelled placeholders, not calibrated values.

## Table of contents

- [Short description](#short-description)
- [The problem](#the-problem)
- [How Dawn works](#how-dawn-works)
  - [Regimes](#regimes)
  - [Components](#components)
  - [The four demo scenarios](#the-four-demo-scenarios)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Design choices and limits](#design-choices-and-limits)
- [Documentation](#documentation)
- [Roadmap](#roadmap)

## Short description

Dawn Finance lets users borrow stablecoins against tokenized US stocks (Binance bStocks) on BNB Chain. It runs on the canonical, unmodified Morpho Blue singleton and adds one thing Morpho does not have: awareness of the US market clock. Borrowing limits, oracle prices and liquidations all react to whether the underlying stock is trading, closed for the weekend, halted, or in the middle of a corporate action.

## The problem

A tokenized stock trades on-chain 24/7, but the stock behind it does not. That mismatch breaks standard lending in four ways:

| Situation | What goes wrong on a plain lending market |
|---|---|
| Weekend or overnight | The on-chain price drifts or goes stale, then gaps at Monday's open. Positions that looked safe are suddenly underwater. |
| Stock split or dividend | The token's `uiMultiplier` changes. A naive oracle sees the price halve and liquidates healthy borrowers. |
| Trading halt | The price is not trustworthy, yet liquidations keep firing. |
| Eligibility | Tokenized stocks carry compliance rules that a generic market ignores. |

## How Dawn works

Every asset is always in exactly one **regime**. The regime sets a price haircut and a borrowing limit, so risk tightens before a gap can happen, not after.

### Regimes

| Regime | When | Placeholder haircut |
|---|---|---|
| `OPEN` | Regular session, 09:30-16:00 ET | 0% |
| `EXTENDED` | Pre-market 04:00-09:30 and post-market 16:00-20:00 ET | 4% |
| `CLOSED` | Weekday overnight, 20:00-04:00 ET | 10% |
| `WEEKEND` | Friday 20:00 to Sunday 20:00 ET, and holidays | 15% |
| `CORP_ACTION` | Split or other multiplier change in flight | 10% |
| `HALTED` | Trading halt or paused asset | 25% |

Keepers can only move an asset to a more conservative regime, for a bounded time, and never to `OPEN`. Clearing a halt needs every signal source healthy plus a price-continuity check. A failed fetch counts as "unknown", never as "clear".

### Components

```
        Binance bapi / Spot / Nasdaq halts          US Eastern calendar
                       |                                    |
                       v                                    v
                 Regime keeper  ------------>  RegimeRegistry (on-chain)
                       |                                    |
        multiplier watcher                                  v
                       |                  +-------- DawnOracle (Morpho IOracle)
   Atlas price feed ---+--------------->  |   uiMultiplier, regime haircut,
                                          |   staleness, freeze + continuity
                                          v
   User --> DawnRouter --> Morpho Blue (unmodified) <-- Liquidation bot
            (targetLTV, EIP-712 eligibility, caps)       (Morpho callback)
```

| Component | Role |
|---|---|
| **RegimeRegistry** | On-chain US Eastern calendar (DST, holidays, early closes) plus bounded keeper overrides. |
| **DawnOracle** | Implements Morpho's `IOracle`. Reads the Atlas feed, applies `uiMultiplier` and the regime haircut, enforces per-regime staleness, freezes on a multiplier change or an upward price jump, and unfreezes only after a continuity check. |
| **DawnRouter** | Borrow front door through Morpho `setAuthorization`. Enforces `targetLTV(regime) = LLTV x (1 - hMax) - margin`, an EIP-712 eligibility attestation, per-asset and per-regime caps, and blocks borrow and withdraw in `HALTED` and `CORP_ACTION`. |
| **Keepers** | Regime keeper, halt monitor, multiplier watcher, demo control, and a liquidation bot that uses the Morpho callback so no flash loan is needed. |
| **Frontend** | Next.js demo: balances in UI units, regime badge, health "now" and "at weekend", corporate-action banner, borrow form with a `targetLTV` preview. |

### The four demo scenarios

Each is a Foundry fork test and a demo script.

1. **Borrow in `OPEN`.** Open a position at the normal limit.
2. **Flip to `WEEKEND`.** The limit tightens, and a fresh position is not liquidatable by the regime change alone.
3. **2-for-1 split.** A naive oracle would liquidate. `DawnOracle` stays continuous and freezes.
4. **Price gap.** The price drops and the liquidation bot closes the position through Morpho.

## Tech stack

| Layer | Technology |
|---|---|
| Lending core | [Morpho Blue](https://github.com/morpho-org/morpho-blue) singleton on BNB Chain (`0x01b0Bd30...a83a`), AdaptiveCurveIrm, 62.5% LLTV market |
| Contracts | Solidity 0.8.28, [Foundry](https://book.getfoundry.sh/) (forge, anvil), forge-std |
| Collateral | Binance bStocks (ERC-8056 style `uiMultiplier`) |
| Price feed | Atlas oracle (Chainlink-style interface), behind a single adapter |
| Halt and status data | Binance bapi `asset/market/status`, Binance Spot `exchangeInfo`, Nasdaq trade-halt RSS |
| Keepers | TypeScript, [viem](https://viem.sh), Node.js, vitest |
| Frontend | Next.js (App Router), TypeScript, vitest |
| Signatures | EIP-712 |

## Repository layout

```
protocol/   Solidity contracts, Foundry tests, deploy script  (see protocol/README.md)
keepers/    TypeScript keepers and liquidation bot            (see keepers/README.md)
frontend/   Next.js landing page and /app demo                (see frontend/README.md)
*.md        research, architecture and plan
```

## Getting started

```sh
# contracts
cd protocol
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build

# keepers (dry-run by default)
cd ../keepers && pnpm install && pnpm test

# frontend (mocked data by default)
cd ../frontend && npm install && npm run dev      # http://localhost:3000, demo at /app
```

Deploying to a local BNB fork: see [protocol/README.md](protocol/README.md).

## Testing

```sh
cd protocol
forge test                                  # 102 tests, fork tests use the public BSC RPC
forge test --no-match-path 'test/fork/*'    # offline only
```

Last run Nov 26, 2026: 102 passed, 0 failed, 0 skipped. Suites: RegimeRegistry, DawnOracle, DawnRouter, LiquidatorCallback, Morpho BNB fork, and the scenarios.

## Design choices and limits

- **Unmodified Morpho Blue.** Dawn adds an oracle, a registry and a router around the canonical singleton instead of forking it. The cost: the router is bypassable, because anyone can borrow on Morpho directly. A wrapper token is the planned fix.
- **Haircut gap.** The `HALTED` haircut (25%) exceeds the `targetLTV` hMax (15%), so a position at the limit can become liquidatable in a halt. This is documented by a test.
- **Jump breaker.** The oracle's upward-jump freeze is new and needs a security review.
- **Unverified.** Atlas feed units and read access, and live behaviour of `ASSET_PAUSED` on a real corporate action.
- **Placeholders.** Haircuts, margin (2%), and continuity band (5%) are illustrative until a gap-risk model is calibrated.

## Documentation

- [architecture-v1.md](architecture-v1.md): architecture on unmodified Morpho Blue
- [implementation-plan.md](implementation-plan.md): workstreams, build order, risks
- [morpho-blue.md](morpho-blue.md): Morpho Blue research
- [reference-lista-zona.md](reference-lista-zona.md): notes on Lista and Zona
- [idea-progression.md](idea-progression.md) and [architecture-v0.md](architecture-v0.md): earlier drafts
- [protocol/INTERFACES.md](protocol/INTERFACES.md): shared contract names

## Roadmap

- Wrapper token to close the router bypass
- Real eligibility service
- Calibrated haircuts from a gap-quantile pipeline
- Dividend ex-date handling
- Production keepers, SEC suspension feed, sentinel bot for cap cuts
- Vault V2 and PreLiquidation onboarding
- Audit

---

<div align="center">Built for BNB Bangkok, November 2026.</div>
