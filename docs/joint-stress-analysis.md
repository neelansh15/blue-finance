# Joint stress analysis

Research/demo only: estimate how simultaneous stock losses could affect all USDT suppliers in a shared Aave V3 reserve. This change adds no contract controls, borrowing recommendations, parameter updates, wallet actions or deployment scripts.

## Run the demo

Start the existing Python service and frontend with `RISK_API_URL` configured as described in [local development](local-development.md). Open `/app/research/joint-stress` and vary the common stock price decline. Existing lending and risk pages keep their main-branch behavior.

The demo has five synthetic stock books: TSLAB, NVDAB, QQQb, SPCXb and GOOGLb. Each has $1,000 collateral and $200 USDT debt. The shared reserve has $500 cash and $1,500 supplier claims. Recovery assumes 80% executable collateral and a 5% liquidation bonus. All values are illustrative and uncalibrated.

The frontend proxy `/api/research/joint-stress` accepts only a bounded price-decline scenario and constructs this fixture server-side. It cannot submit a transaction. The Python endpoint `/research/joint-stress` also accepts explicit research snapshots, including distinct shocks for different stocks.

## Model

Inputs contain a common observation cutoff, available USDT, supplier claims, USDT/USD price, loan decimals, current variable borrow index in RAY units, and aggregate stock books. Each stock supplies collateral USD, scaled debt, liquidation threshold/bonus, price drop and executable recovery fraction. Scaled debt accepts exact decimal strings, rounds upward using Aave's variable-debt convention, and is converted to loan units. A projected index can explore accrued interest; the tool does not predict the rate path.

For each stock, stressed collateral equals starting collateral times one minus the price drop. Estimated debt recovery is the lesser of debt value and executable stressed collateral after the assumed liquidation bonus. Shortfall is the remaining debt value, converted into USDT. Per-stock shortfalls are summed across the same scenario and divided by supplier claims to express indicative shared exposure. Cash is counted once in the separate cash-plus-recovery measure.

Each book must include that stock's entire exposure at the same cutoff. The endpoint does not authenticate input completeness, price provenance or supplier-claim reconciliation. Different stocks can share market liquidity and counterparties; recovery fractions must reflect such dependencies. The tool does not fit correlations or infer loss probabilities.

Outputs remain simulated and non-executable. The supplier exposure percentage is an economic stress proxy, not a realized or automatically allocated supplier loss. Liquidation timing, close factors, fees, reserve buffers, collateral transfer restrictions and deficit resolution can change actual outcomes. Aggregate health is a stock-book proxy, not an individual Aave account health check. No calibrated safety or competitor-performance claim is made.

## Checks

`python -m pytest -q tests/test_joint_stress.py` covers zero-loss baselines, joint versus single-stock losses, index growth, USDT valuation, duplicate rejection, unsupported policy fields, the research HTTP contract and integer rounding. Frontend proxy tests verify the synthetic fixture, bounded requests and absence of borrow-cap inputs. CI validates the research model, frontend tests, TypeScript and production build without installing or compiling contract dependencies.
