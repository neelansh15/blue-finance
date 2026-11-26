# Enforced, evidence-based risk parameters

**Scope:** Morpho is now archived in `protocol-old/`; `protocol/` is reserved for the separate planned Aave V3 deployment. The binding market enforcement and integer replay in this PR are a tested Morpho reference, not an Aave pool implementation. The evidence/configuration work can inform that future implementation.

This implementation turns the README parameter inventory into a consistent configuration, a managed-market enforcement path, reproducible evidence tools and a reviewed parameter-update workflow. All shipped economic values remain **uncalibrated**. No historical dataset, production approval, deployment or audit is supplied by this change.

## Configuration and deployed truth

`config/blue-risk.v1.json` is the versioned source for declared demo/deployment defaults. Its status is deliberately `UNCALIBRATED`. Generate its Solidity, Python and TypeScript consumers with:

```sh
python3 scripts/generate_parameters.py
python3 scripts/generate_parameters.py --check
```

`BlueDeploy` consumes the generated Solidity library. `BlueConfig`, `Policy`, keeper defaults, the landing illustration and demo client consume generated defaults. Operator configuration can still override defaults, but those settings carry their own existing fingerprints. These are declarations, not proof of a deployment's settings.

The frontend's routine `hMax` excludes HALTED and CORP_ACTION. Their actual declared haircuts are 25% and 10%. At unchanged prices, $10,000 gross collateral gives a $5,112.50 OPEN debt ceiling and $4,345.625 WEEKEND ceiling. Target LTV remains 51.125% across routine regimes; oracle haircuts change effective borrowing capacity. Interest, real price moves, halt haircuts and expired-freeze effects are outside the routine-transition guarantee.

`readDeployedParameters` checks chain, exact Morpho MarketParams, router/oracle identities and six regime values at one block. It never falls back to demo values on error. The optional risk-panel reader uses `NEXT_PUBLIC_BLUE_MARKET_IDENTITY` (JSON with chainId, router, morpho, registry, loanToken, collateralToken, oracle, irm, and decimal-string lltv) and `NEXT_PUBLIC_BLUE_RPC_URL`. These contain public metadata only. A mismatch is displayed; the demo account is not silently converted into a live account.

Regenerate shared ABIs after contract changes:

```sh
cd protocol-old
forge build
cd ..
python3 scripts/export_contract_abis.py
```

## Managed markets and migration

Legacy `listMarket` markets remain bypassable: a user can call Morpho directly. Existing debt is not moved or made safe by deploying new contracts.

New `listManagedMarket` markets require all three controls:

1. `BlueManagedCollateral` wraps underlying bStock raw units 1:1. Only the router can mint, and only router-originated transfers can enter the Morpho singleton. Thus liquidators cannot take receipts and supply them into an uncontrolled position, even in another market on that singleton. Receipts remain transferable outside Morpho and publicly redeemable into underlying collateral. Fee-on-transfer raw balances are rejected on deposit. Live issuer transfer/compliance restrictions still apply to underlying redemption.
2. `BluePosition` holds each user's Morpho position. It authorizes only the router and exposes no arbitrary execution or delegation method. Users and their delegates cannot borrow or withdraw directly from that position. Router events map owners to position addresses. Morpho Borrow events expose the position address, so the existing liquidation bot can discover it normally; seed lists must use position addresses.
3. `BlueBorrowPermission` grants short-lived permission only after continuous healthy proofs. New permission starts closed. Missing or unknown sources, stale/frozen oracle evidence and proof gaps reset recovery. Expiring a regime override does not grant permission. Governance holds require governance release, followed by fresh recovery.

Managed supply caps bound outstanding raw receipts. Lowering below outstanding supply blocks further wrapping; it never confiscates collateral or prevents redemption. Router borrow caps still apply to market-wide Morpho borrowing. The guardian may only raise margin and lower supply/borrow caps. Changing those borrowing policies does not alter Morpho LLTV or force repayment.

`DeployManaged.s.sol` is the local-fork managed path. `DeployMainnet.s.sol` now selects managed markets; **its placeholder parameters are still not production approved**. `Deploy.s.sol` retains the legacy demo path. For managed keepers, the registry asset `token` is the wrapper, `statusToken` is the real underlying bStock, and `permission`/`oracle` must be supplied. Binance status and multiplier-event monitoring use the underlying identity. Configure the keeper poll interval comfortably below the permission's maximum proof gap. Healthy proofs require every source to be healthy even during the longer unknown-to-HALTED grace period.

Morpho market identity, oracle haircuts/staleness and other oracle constructor controls remain immutable. Recalibrating them requires a new oracle and compatible new market, separately funded and adopted. Migration of existing positions requires its own borrower-approved transaction and analysis.

## Historical windows and calibration

The historical builder accepts JSON with `asset`, `source_reference`, `simulated`, `corporate_action_adjusted`, ordered `points: [{at, price}]`, and optional `events: [{start, end, kind, reference}]`. Event kinds are EARNINGS, HALT and CORPORATE_ACTION. Observations must already be adjusted and expressed per normalized displayed token. Adjustment declarations and source references are not authenticated by these tools.

```sh
cd ai-risk-controller
python -m scripts.build_gap_windows --input /path/adjusted.json \
  --as-of 2026-11-26T00:00:00Z --output /tmp/windows.csv
python -m scripts.calibrate_blue --input /tmp/windows.csv \
  --manifest /tmp/windows.manifest.json --output /tmp/calibration.json
```

The builder uses NASDAQ regular-session DST, holidays and early closes, and measures elapsed closure lengths. Extended windows follow the protocol's declared 04:00–20:00 schedule, ending at 17:00 after a 13:00 early close; that assumption is not proof of executable trading. It selects observations at or before each boundary within a bounded tolerance, reports missing boundaries and does not interpolate absent prices. It also emits intraday windows and supplied event windows. The companion report records the exact input hash and event references.

Calibration accepts the existing CSV or an additional `event` column. It retains chronological holdout gates, upward rounding and conservative parameter floors, and adds:

- Expanding walk-forward diagnostics without future training data.
- Training-tail expected shortfall and descriptive 95% Wilson intervals for breach fractions. Zero observed breaches does not imply zero underlying risk; binomial independence remains an assumption.
- Event and duration diagnostics so earnings and long closures remain visible.
- Explicit `special_stress_floors_bps` for HALTED/CORP_ACTION when sufficient history is unavailable, requiring `stress_review_reference`. These cannot undercut existing floors and are labelled `DECLARED_STRESS_ASSUMPTION_NOT_CALIBRATED`; no fictitious empirical confidence is assigned.

Candidates still have `calibrated: false`, `executable: false`, and require independent source/model/governance review. Routine data does not calibrate continuity bands, jump breakers, feed heartbeat, freezes, compliance TTL or operational recovery. Those controls retain their declared settings and need their own operational evidence. The pipeline does not automatically relax existing conservative floors.

## Liquidation economics and borrower impact

The optimiser and six regime-cap proposals now use debt budgets from **one finite token bid book**, constrained by token volume, participation, acceptable execution slippage, stressed liquidity, time horizon, price loss, issuer/oracle uncertainty, fees, gas, liquidation incentive and safety margin. The horizon incorporates actual time until the next regular opening and declared minimums. The same liquidity cannot be counted once per borrower. Missing/stale execution evidence or volatility yields zero capacity. HALTED/CORP_ACTION budgets are zero.

These are explicit economic assumptions, not fitted parameters. The prior fixed proposal multipliers `1/.7/.7/.4/0/0` have been removed. Recommended supply and borrow limits remain separate, with normalized token quantities converted into raw receipt units only against a verified multiplier when preparing a managed update.

The advisory response and UI show current declared versus proposed targets/caps and per-position LTV ceilings/headroom at the same protocol oracle mark. Those ceilings are before market cap headroom and available loan liquidity. A lower target can flag a position as over target without making it liquidatable or repaying it. Deployed verification and advisory source status are displayed separately.

The existing portfolio simulator remains an analytical stress model. `POST /risk/replay` adds a distinct integer adapter for supplied raw Morpho state: virtual shares, conservative rounding, three-term interest accrual, fee shares, partial liquidation and collateral-exhaustion bad debt. It returns integer quantities as strings. Supply actual rate trajectories for changing IRMs; a supplied constant rate is not an AdaptiveCurveIrm forecast. The API does not authenticate caller-supplied state. Its interest/partial-liquidation vector is checked against unchanged canonical Morpho, not only against another Python implementation.

## Reviewed execution

`BlueRiskExecutor` is a narrow router admin. A reviewable deployment script proposes the two-step admin transfer; governance must call `acceptRouterAdmin()` separately. No script has been broadcast as part of this work.

- Governance schedules a concrete update; execution waits for its delay and must precede expiry. Guardian/governance can apply one-way tightening immediately.
- Updates bind chain, executor/router domain, exact market, evidence digest, expected configuration hash/version, expected multiplier, nonce, margin, raw supply cap, total borrow cap and six regime caps.
- Every margin, borrow-cap or supply-cap change increments a per-market version. Intervening emergency actions invalidate pending proposals even if later numeric values return to an earlier state. A multiplier change also invalidates execution.
- Nonces prevent replay. Execution verifies resulting settings atomically. Delayed operational calls permit signer/guardian rotation, unpause and admin transfer; they cannot bypass the parameter-update path. The guardian can cancel queued operations. Delayed router guardian rotation also revokes the old guardian in the executor.
- A paused or unreadable underlying multiplier can prevent an executor update. The router guardian retains direct pause/lower-cap paths that do not require that read.

The keeper planner is read-only. It verifies deployed identity/authority, actual decimals and immutable oracle settings at one block. It then verifies an independent reviewer EIP-712 signature over SHA-256 of the **exact UTF-8 advisory document**, current configuration hash, multiplier, expiry and assertions that evidence is live and independently calibrated. The domain binds chain and executor. The reviewer is an explicitly configured EOA; governance approval remains a separate on-chain action. A signed assertion is not automatic proof of data quality.

```sh
cd keepers
pnpm exec tsx scripts/prepareRiskUpdate.ts \
  --deployment /path/verified-deployment.json --rpc "$RPC_URL" \
  --advisory /path/advisory.json --review /path/signed-review.json \
  --nonce 1 --output /tmp/risk-update.json
```

The deployment file includes chainId, asset, router, morpho, registry, executor, governance, guardian, reviewer, loanDecimals, collateralDecimals and exact `market` fields (LLTV as a decimal string). The review contains documentHash/configHash hex digests, expiresAt/multiplier decimal strings, live/calibrated booleans and signature. `approvalTypes` in `riskExecution.ts` defines the signing contract. Use an independent authorized reviewer/signing system; no demonstration key is accepted by default.

Default simulated advice is rejected. A short-lived recommendation is not extended to outlast the governance delay. A relaxation requires a separately reviewed proposal whose validity actually spans that delay; the default 15-minute advice is unsuitable. `verifyApplied` checks the transaction's executor/update event and resulting settings at its receipt block. It never treats transaction success alone as proof of the intended configuration.

## Comparative evaluation and validation

`python -m scripts.benchmark_policies --input /path/evaluation.json --as-of <cutoff> --output /tmp/comparison.json` accepts explicit `episodes` and `policies`. Episodes include asset, start/end, prices, aggregate collateral quantity, initial/final regimes, sorted executable exit bids and execution availability. Policies include name, LLTV, margin, six fractional haircuts, borrow cap and fee. Policies must be fixed before evaluating unseen data. Overlapping same-asset episodes are rejected to prevent shared-liquidity reuse.

Results compare opening borrowing capacity, stressed economic shortfall, worst episode, liquidation episodes, haircut-dependent liquidations and unavailable execution on the **same episodes**. This framework does not contain verified competitor parameter sets or establish that Blue outperforms anyone. Historical data, independent source verification, sensitivity analysis and an audit are outstanding external work.

```sh
bash scripts/bootstrap_protocol.sh
cd protocol-old
forge test --no-match-path 'test/fork/*' --no-match-contract 'BlueRouterTest|ScenariosForkTest'
# Full existing fork suite additionally needs a working BSC RPC:
forge test
cd ../ai-risk-controller
python -m pytest -q
cd ../keepers
pnpm test && pnpm typecheck
cd ../frontend
npm test && npm run typecheck && npm run build
```

The bootstrap pins official Morpho commit `f8631a27a2ee76ccd63abb945014d31d9efb0aca` and compiles it unchanged with solc 0.8.19, separately from Blue's 0.8.28. New offline tests fail if its artifact is absent; they do not skip on RPC failure. Tests cover direct/delegated bypass, receipt resupply, public liquidation/redemption, permission loss/recovery, holds, guardian bounds, delay/replay/expiry/stale configuration, operational recovery and 512 randomized backing round trips. CI checks generated configuration and ABI consistency, model tests, contracts and clients.
