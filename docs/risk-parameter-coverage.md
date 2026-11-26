# README requirement coverage

The risk-controller stack is advisory. Existing contracts and keepers enforce the protocol; the controller produces evidence and reviewable configuration proposals. No historical calibration dataset has been supplied. New managed contracts and the separate governance executor are unaudited; see [implementation and boundaries](enforced-risk-parameters.md). The [offline gap-calibration workflow](gap-calibration.md) now supplies evidence gates and chronological holdout diagnostics, while the defaults and statistical assumptions remain uncalibrated; fixed proposal cap multipliers have been replaced with shared-book recovery budgets.

| README area | Implemented behavior | Remaining evidence or integration |
|---|---|---|
| Morpho asset pair, LLTV, IRM, oracle and fee | Existing market is immutable; LLTV stays 62.5% by default and Morpho incentive is derived from it | Verify actual deployment identity; a new market is required for changed market parameters; protocol fee remains Morpho governance's responsibility |
| Routine haircuts | Backend uses routine-only hMax; all six declared oracle haircuts appear in the proposal; frontend uses the same generated declared configuration | Empirical, adjusted per-regime adverse-gap evidence and independent validation; changed oracle haircuts require a new oracle/market |
| HALTED and CORP_ACTION haircuts | Backend declares 25% / 10% and zero special-regime caps; existing contracts retain freeze floors; controller does not claim corporate-action continuity support | Historical halt/corporate-action evidence and observed multiplier/feed ordering |
| Router margin | Whole-basis-point proposal consistent with configured haircuts and existing LLTV; no margin relaxation below declared settings | Validate deployment settings and review an intraday buffer calibrated from real observations |
| Total borrow cap | Proposed within both model budget and declared deployment cap | Live market-wide borrow/depth/volume observations; admin approval and contract submission |
| Per-regime caps | Six ordered caps, bounded by declared caps and total; HALTED/CORP_ACTION zero | Empirical liquidity/exit-capacity calibration; stress/participation assumptions remain uncalibrated |
| Supply cap | Managed wrapper bounds outstanding raw receipts; router/guardian/executor setters are available; legacy advice remains unmapped | Verified deployment, multiplier conversion, liquidity calibration and governance review |
| Eligibility TTL | Declared 900s retained; contract max 1h is validated | Real eligibility service, EIP-712 attestation and replay/expiry checks remain separate |
| Staleness | Separate declared mock/Atlas profiles and optional six-regime advisory freshness; five-minute default is explicit | Verified feed heartbeat/transport evidence and deployment settings; no live Atlas price adapter is supplied |
| Continuity and jump bands | Declared values and bounds included unchanged | Split-adjusted discontinuity observations and independent security review |
| Max freeze and expired-freeze haircut | Declared values and bounds included unchanged | Operational-response and stale-price loss evidence; no automated force-unfreeze |
| Max override and keeper-can-clear | Validated declared limits retained | Operator policy and authenticated keeper authorization; no automatic override or clearance |
| Holidays / early closes | Existing calendar-aware policy and declared source for operator verification | Keep on-chain entries and keeper calendars current; neither is inferred from a status endpoint |
| Override duration and refresh margin | Validated declared 1h / 10min values retained | Operations evidence and an independently reviewed keeper deployment |
| Unknown-source timeout | Validated declared 10min value retained; failed status never confirms trading | Real source availability observations; keeper enforcement remains existing code |
| Poll intervals | Declared 30s and Nasdaq >=60s values retained | Rate/availability evaluation; no change to production scheduling |
| Four protocol demos | Existing Foundry demonstrations remain; backend stress examples are separate simulations | The advisory model is not contract-exact accounting or an on-chain execution path |
| Production roadmap | No claim that advisory proposals close router bypass, deploy eligibility, dividends or vault onboarding | Wrapper enforcement, production feeds/keepers, backtesting, authorization, deployment and audit |

The default proposal is `UNCALIBRATED`, `UNSIGNED`, `PENDING_REVIEW`, and `executable: false`. Its hash is an audit integrity check, not an authorization signature. Verify chain, market, exact MarketParams, decimals, expiry, deployed configuration and admin authority before considering any independent execution workflow. Simulated observations must never become production authorization.

Frontend parameter parity, borrower-impact comparison and optional deployed reads are now implemented. See [enforced risk parameters](enforced-risk-parameters.md) for the new managed path, signed-review planner, migration boundaries and outstanding production evidence.
