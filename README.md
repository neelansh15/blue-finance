<div align="center">

# Blue Finance

**Lending against tokenized US stocks on BNB Chain, with borrowing rules that know when the stock market is open.**

![BNB Chain](https://img.shields.io/badge/chain-BNB%20Chain-F0B90B?logo=binance&logoColor=white)
![Aave V3.6](https://img.shields.io/badge/built%20on-Aave%20V3.6-2470FF)
![Solidity](https://img.shields.io/badge/solidity-0.8.28-363636?logo=solidity&logoColor=white)
![Foundry](https://img.shields.io/badge/tests-Foundry-orange)
![Forge tests](https://img.shields.io/badge/forge%20tests-38%20passing-brightgreen)
![Next.js](https://img.shields.io/badge/frontend-Next.js-000000?logo=nextdotjs&logoColor=white)
![Status](https://img.shields.io/badge/status-hackathon%20prototype-yellow)
![Event](https://img.shields.io/badge/BNB%20Bangkok-Nov%202026-blueviolet)

</div>

> **Status: hackathon prototype (BNB Bangkok, Nov 25-27, 2026).** The pool is deployed on BNB Smart Chain mainnet (chain ID 56). It uses unaudited contracts and uncalibrated prototype risk parameters.

### Working demo

Run the frontend and open `/app` for the live pool. You can view the five bStock markets without a wallet. Connect a BNB Smart Chain wallet with a small amount of the reserve's USDT and BNB for gas to demonstrate supplying and withdrawing USDT. The launch seeded zero USDT. For a live loan, a demo operator first has to supply liquidity, maintain fresh prices and keeper reports, and register wallet eligibility. See the [demo walkthrough](frontend/README.md#onchain-demo-app).

Open `/app/simulator` for a pre-funded walkthrough of lending, borrowing, a halt and repayment without wallet transactions.

**BNB mainnet pool:** `0xDAC47642621B0C3E4191Fe68281EddAC355f12bC`. All 59 deployment transactions succeeded on November 27, 2026. See the [deployment addresses and receipts](protocol/README.md#bnb-mainnet-deployment).


## Table of contents

- [Short description](#short-description)
- [The problem](#the-problem)
- [How Blue works](#how-blue-works)
  - [Market status](#market-status)
  - [What stays open](#what-stays-open)
  - [Pricing](#pricing)
  - [Components](#components)
- [Project status](#project-status)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Testing](#testing)
- [Prototype parameters](#prototype-parameters)
- [Design choices and limits](#design-choices-and-limits)
- [Documentation](#documentation)
- [Roadmap](#roadmap)
- [License](#license)

## Short description

Blue Finance lets users borrow USDT against tokenized US stocks (Binance bStocks) on BNB Chain. It is one Aave V3 pool with one shared USDT reserve. Lenders supply USDT once, each borrower uses one stock token as collateral, and every borrower draws from the same reserve.

On top of Aave, the pool applies rules for each stock that follow the US market clock. New borrowing tightens or stops when the underlying market is closed, halted or in the middle of a corporate action. The liquidation threshold stays the same. The separation between permission to borrow and valuation of existing positions is modeled on [Zona Lend](https://docs.zona.finance/lending/oracles).

The first listing is TSLAB, NVDAB, QQQB, SPCXB and GOOGLB.

## The problem

A tokenized stock trades on-chain 24/7, but the stock behind it does not.

| Situation | What goes wrong on a general lending market |
|---|---|
| Weekend or overnight | The stock reopens at a new price, and a position that looked safe may be short of collateral. |
| Stock split or other corporate action | The price feed and the token's `uiMultiplier` can update at different moments, so a healthy position can look underwater. |
| Trading halt | The last price is a poor basis for new debt. |
| Issuer rules | The issuer can pause a token or change who may hold and transfer it. |

## How Blue works

1. **Lend.** Supply USDT to the pool and receive bluUSDT, which earns interest. Withdrawals depend on available USDT.
2. **Post collateral.** Supply one listed bStock and enable it as collateral. Stocks are collateral only, and USDT is the only borrowable asset.
3. **Borrow.** The pool checks the borrower's signed eligibility, the stock's borrow permission, the loan-to-value limit for the current market status and the debt caps. Debt is recorded in bluDebtUSDT.
4. **Repay or liquidate.** Repay USDT plus interest. Liquidators use Aave's `liquidationCall` when the health factor allows it.

bluTokens and bluDebtTokens are Aave aTokens and variable debt tokens under Blue names.

### Market status

Each stock has one status at a time. The status sets its borrowing limit and debt cap.

| Status | When (US Eastern) | Borrow limit (LTV) | Debt cap per stock |
|---|---|---|---|
| `OPEN` | Regular session, 09:30-16:00 | 50% | 400 USDT |
| `EXTENDED` | 04:00-09:30 and 16:00-20:00 | 48% | 300 USDT |
| `CLOSED` | Overnight before a trading day, 20:00-04:00 | 45% | 200 USDT |
| `WEEKEND` | Friday 20:00 to Sunday 20:00, and holidays | 42.5% | 100 USDT |
| `HALTED` | Set by the keeper or admin | Blocked | n/a |
| `CORP_ACTION` | Set by the keeper or admin | Blocked | n/a |

The schedule comes from the on-chain `MarketCalendar`, which also handles daylight saving time, holidays and early closes. The BNB deployment seeds the NYSE calendar through 2028. A keeper or the admin can apply a stricter status for a limited time, never a looser one.

The liquidation threshold is 62.5% in every status. A position with $1,000 of collateral and $500 of debt keeps a health factor of 1.25 through a status change when price and debt are held fixed.

### What stays open

| Situation | New borrowing | Withdraw with debt | Repay | Liquidation |
|---|---|---|---|---|
| Normal trading, any session | Within limit and cap | Within limit | Open | On health factor |
| Keeper heartbeat lapses | Blocked | Within limit, on a valid price | Open | On a valid price |
| Price moves more than 20% | Blocked until the admin accepts it | Within limit, on a valid price | Open | At the live price |
| Halt or guardian hold | Blocked | Blocked | Open | On a valid price |
| Corporate action | Blocked | Blocked | Open | Waits for an accepted price |
| No usable price | Blocked | Blocked | Open | Waits for a price |

A halt or hold applies to one stock, so borrowing against the others continues. After a lapse, new borrowing needs 30 minutes of healthy reports. Issuer transfer rules can still block collateral movement, including liquidation.

### Pricing

- **Valuation** (health and liquidation) reads the live Atlas round. It must be under 24 hours old, inside a fixed price band for the stock, consistent with the last accepted share multiplier, and outside a corporate action. A real price gap reaches liquidators immediately.
- **New borrowing** also needs the keeper to have accepted the live round, and that round to be under 2 hours old. A move of more than 20% stops new loans until the admin calls `acceptReference()`.
- **USDT** is priced by Chainlink USDT/USD within $0.90 to $1.10.
- **Single source.** The demo prices stocks with Atlas alone.

Token and feed addresses are listed in the [protocol README](protocol/README.md#bnb-chain-listing).

### Components

```
   Lenders ---- USDT ---->  +-----------------------------+  <---- bStock collateral ---- Borrowers
           <--- bluUSDT --  |  BluePool (Aave V3.6)       |  ----- USDT loan ---------->
                            |  one shared USDT reserve    |  <---- repay, liquidate
                            +--------------+--------------+
                                           |
                 +-------------------------+-------------------------+
                 |                                                   |
       StockBorrowControls                                  Aave price oracle
   eligibility, borrow permission,                       StockPriceSource per asset
   LTV and cap by market status                       Atlas (stocks), Chainlink (USDT)
                 |                                                   |
                 +------------------ MarketCalendar -----------------+
                          US Eastern sessions, holidays, overrides
```

| Contract | Role |
|---|---|
| [`BluePool`](protocol/src/BluePool.sol) | Aave V3.6 Pool with one borrowable asset, one active stock per account, per-stock debt accounting and flash loans disabled. |
| [`StockBorrowControls`](protocol/src/StockBorrowControls.sol) | EIP-712 eligibility, keeper heartbeat and recovery, guardian holds, limits and caps. |
| [`StockPriceSource`](protocol/src/StockPriceSource.sol) | Validates a feed for valuation and applies the stricter test for new borrowing. |
| [`MarketCalendar`](protocol/src/MarketCalendar.sol) | On-chain market schedule and bounded status overrides. |

## Project status

| Part | State |
|---|---|
| [`protocol/`](protocol/README.md) | The current Aave V3 deployment, with offline and BNB mainnet fork tests. |
| [`frontend/`](frontend/README.md) | Landing page, onchain workspace, and pre-funded simulator. |
| [`keepers/`](keepers/README.md) and [`demo/`](demo/README.md) | Still built for the earlier Morpho prototype. No keeper reports to the Aave pool yet. |
| [`ai-risk-controller/`](ai-risk-controller/README.md) | Advisory only, on simulated data. Its Blue parameter proposals still follow the Morpho design. |
| [`protocol-old/`](protocol-old/README.md) | The earlier prototype on Morpho Blue, kept for reference. |

The eligibility service that signs borrower approvals is not built.

## Tech stack

| Layer | Technology |
|---|---|
| Lending core | [Aave V3 Origin 3.6.0](https://github.com/aave-dao/aave-v3-origin/tree/v3.6.0) |
| Contracts | Solidity 0.8.28, [Foundry](https://book.getfoundry.sh/), OpenZeppelin |
| Collateral | Binance bStocks |
| Price feeds | Atlas for stocks, Chainlink for USDT |
| Signatures | EIP-712 |
| Frontend | Next.js (App Router), TypeScript, vitest |
| Keepers | TypeScript, [viem](https://viem.sh), vitest |
| Risk advisor | Python, FastAPI |

## Repository layout

```
protocol/              Aave V3 contracts, deploy scripts and tests
frontend/              Next.js landing page and /app demo
keepers/               TypeScript keepers and liquidation bot (Morpho prototype)
demo/                  Local fork demo scripts (Morpho prototype)
ai-risk-controller/    Python advisory risk service
protocol-old/          Morpho Blue contracts, tests and deploy scripts
pitch/                 Pitch deck
docs/                  Local development, API caching and calibration notes
*.md                   Architecture and research
```

## Getting started

Contracts need Foundry, Node.js and npm.

```sh
cd protocol
npm ci
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build
forge test
```

Frontend:

```sh
cd frontend
npm ci
npm run dev      # http://localhost:3000, onchain demo at /app
```

The `/app/risk` workspace connects to the Python advisory backend. See [local development](docs/local-development.md) to run both. The default analysis is simulated, needs no keys and never executes a transaction.

To rehearse a deployment on a local Anvil fork of BNB Chain, follow [Deploy](protocol/README.md#deploy). A mainnet broadcast needs explicit owner approval.

## Testing

```sh
cd protocol
forge test                                   # offline suite, fork suites are skipped
BLUE_RUN_BNB_FORK_TESTS=true BSC_RPC_URL=<your BNB mainnet RPC> forge test
```

Last run Nov 27, 2026 with fork tests enabled: all 58 tests passed.

| Suite | Tests | What it covers |
|---|---|---|
| `BluePoolTest` | 23 | Offline scenarios: shared reserve, halts, splits, price gaps, caps, heartbeat recovery, liquidation and deficit accounting, admin handover and role replacement |
| `BluePoolBnbForkTest` | 23 | The same scenarios with real USDT on a BNB mainnet fork |
| `BscMainnetForkTest` | 5 | The real launch with live bStocks and feeds: admin handover, keeper and holiday setup, and a TSLAB supply, borrow, repay and withdraw |
| `UsMarketHolidaysTest` | 5 | The seeded NYSE holidays and early closes |
| `AproCrossCheckForkTest` | 2 | The optional APRO cross-check against live feeds |

Fork tests read live chain state, so results can vary with feed freshness. They send nothing to BNB mainnet.

Frontend: `npm test` and `npm run typecheck` in `frontend`. Keepers: `pnpm install && pnpm test` in `keepers`.

## Prototype parameters

Every value is a placeholder until calibrated. Source: [`BlueV3Deployment.sol`](protocol/script/BlueV3Deployment.sol) and [`BscMainnet.sol`](protocol/script/BscMainnet.sol).

| Parameter | Value |
|---|---|
| Base LTV / liquidation threshold / liquidation bonus | 50% / 62.5% / 5% |
| Borrowing discount: open, extended, closed, weekend | 0% / 4% / 10% / 15% |
| Debt cap per stock: open, extended, closed, weekend | 400 / 300 / 200 / 100 USDT |
| USDT supply cap and borrow cap | 1,000 USDT each |
| Reserve factor | 10% |
| USDT borrow rate | 2% base, 6% at 80% utilization, 66% at 100% |
| Keeper heartbeat / recovery window | 10 minutes / 30 minutes |
| Stock price age: new borrowing / valuation | 2 hours / 24 hours |
| USDT price age: new borrowing / valuation | 1 hour / 24 hours |
| Largest price move accepted without admin review | 20% |
| Stock price band | About 1/10 to 10 times the Nov 27, 2026 price |
| Longest eligibility approval | 1 day |
| Longest status override | 7 days |

## Design choices and limits

- **Shared reserve.** One USDT deposit serves every stock. Lenders also share any shortfall across all listed collateral. Per-stock debt caps limit concentration.
- **Modified pool.** The rules are enforced inside the pool, so they apply to direct calls too. The changes need a security review.
- **Corporate actions.** `CORP_ACTION` has to be set before a known split. A feed that updates before the multiplier otherwise looks like a crash and can trigger liquidations.
- **Single stock price source.** The demo relies on Atlas alone. Confirm with Atlas which feed instances Blue should use.
- **Issuer control.** A paused token or changed compliance rules can block supply, withdrawal and liquidation transfers.
- **Not ready for launch.** Calibration, keeper integration, the eligibility service and a security review are open.

## Documentation

- [Protocol README](protocol/README.md): design, listing, tests and deployment
- [Architecture v3](architecture-v3.md): the current Aave V3 design
- [Notes on Lista and Zona](reference-lista-zona.md)
- [Local development](docs/local-development.md)
- Earlier designs: [v0](architecture-v0.md), [v1 on Morpho Blue](architecture-v1.md), [v2 on Aave V4](architecture-v2.md), [implementation plan for v1](implementation-plan.md), [Morpho research](morpho-blue.md), [idea progression](idea-progression.md)

## Roadmap

1. Calibrate limits, discounts and caps against gap risk and executable liquidation depth
2. Connect the app and keepers to the Aave pool, and build the eligibility service
3. Confirm Atlas feeds and decide on a second price source
4. Security review and license check
5. Capped mainnet launch, with owner approval
6. One-click leveraged borrow in Simplified Mode ([design](architecture-v3.md#6-leveraged-borrowing-in-simplified-mode))

## License

`BluePool` and the deployment scripts build on Aave V3 Origin 3.6.0 under the [Business Source License 1.1](protocol/LICENSE-AAVE-V3), whose additional use grant has conditions. Aave V3.6 becomes available under MIT on March 6, 2027, or an earlier date recorded by the Aave DAO. Confirm eligibility before any production use. See the [protocol README](protocol/README.md#license).

## Naming

The project started under the name "Dawn" and was renamed to "Blue" during development. This is the only place the old name appears in the repository.

---

<div align="center">Built for BNB Bangkok, November 2026.</div>

Research demo: [Joint stress analysis](docs/joint-stress-analysis.md) estimates simultaneous stock-loss exposure for shared USDT suppliers. Run it separately at `/app/research/joint-stress`; it does not change lending policy.
