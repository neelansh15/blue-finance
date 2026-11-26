# Aave V3 shared liquidity and risk

PR14 now targets the Aave V3.6 prototype in `protocol/`. Its previous Morpho wrappers, managed accounts, executor, generated defaults and integer-replay additions have been removed. `protocol-old/` remains exactly as supplied by main. Its original demo and advisory endpoints are legacy compatibility paths, not an Aave integration.

Lenders supply one USDT reserve. All five collateral reserves compete for the same cash; their losses can affect all USDT suppliers. Per-stock limits constrain concentration but do not isolate lender losses or allocate dedicated cash to each stock.

## Enforcement

Aave retains its native reserve-wide supply/borrow caps, available liquidity checks, indexed variable debt, health and liquidation logic. BluePool additionally checks `StockBorrowControls.checkSharedDebt` after each borrow, including delegated borrowing through the same pool path. A revert rolls back the debt increase atomically.

`setSharedLimits` configures an aggregate accrued USDT debt ceiling and a maximum stock share of that configured ceiling. It is an absolute concentration budget: a first borrower is not rejected simply because they represent 100% of currently outstanding debt. Effective capacity is bounded by all of native Aave constraints, available shared cash, the aggregate budget, stock concentration budget, stock regime cap, and the borrower's LTV. Guardian updates can only lower either shared limit. Existing debt is not forcibly repaid when a cap falls.

The demo uses a 1,000 USDT aggregate ceiling and 60% maximum per-stock budget share; stock-specific routine caps remain 400/300/200/100 USDT. Values are placeholders. Joint recovery evidence is required before raising them. Policy changes do not haircut the liquidation oracle: weekend borrowing discounts leave health unchanged when debt and underlying prices are unchanged.

## Advisory model and UI

`POST /risk/aave/shared-reserve` accepts one timestamped reserve snapshot with available USDT, supplier claims, loan decimals, the current RAY variable debt index, an aggregate debt ceiling, cash buffer and stock budget share. Every stock supplies aggregate collateral USD, scaled debt, LTV, liquidation threshold/bonus, regime discount, accrued debt cap and an executable recovery fraction under a supplied price shock. Large scaled debt values can be decimal strings to preserve precision across JavaScript and Python.

It returns indexed debt by stock, one shared cash/debt headroom budget, individually constrained borrowing headrooms, simultaneous stressed recovery shortfalls and aggregate supplier exposure. Individual headrooms cannot be added together: each competes for the same reserve budget. Different shocks can be supplied per stock to examine correlated events; the UI applies one common decline to all five demo stocks. USDT depeg valuation is explicit. Permission failure affects only that stock's new borrowing.

The active `/app/risk` page now shows this shared-reserve model through a bounded same-origin proxy. It is a synthetic portfolio, not a connected wallet or live reserve read. Inputs remain unverified, all outputs are simulated/non-executable and no advice writes to chain. The model reports economic recovery shortfalls; it does not claim contract-exact Aave close factors, liquidation ordering, liquidity replenishment or deficit write-off behavior. Aave's existing core tests cover its actual accounting paths separately.

## Validation and outstanding work

New tests cover total debt across different stocks, stock concentration, one-way guardian limits, jointly shared supplier losses, index growth, liquidity buffers, depeg valuation, local stock halts and unchanged liquidation health under borrowing discounts. Run main's real Aave offline core suite, the Python tests and frontend tests/build. No Morpho bootstrap is needed for this PR.

Production work remains: trusted synchronized reserve and per-stock snapshots, verified token liquidity/recovery evidence, parameter calibration, independent review of pool modifications, live keeper/advisory wiring and licensing/deployment approval. This change does not broadcast any deployment or claim that shared liquidity removes shared credit risk.
