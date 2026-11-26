# Evidence-gated Dawn gap calibration

No trusted historical dataset has been supplied. This PR implements the offline workflow and tests its gates using generated fixtures; it does not publish calibrated market parameters. Its output always has `calibrated: false`, `executable: false`, and `approval_required: true`.

## Input contract

Supply one UTF-8 CSV per asset with exactly these columns:

```csv
asset,regime,window_start,window_end,start_price,end_price
```

Each row represents a supplier-classified stress window. `asset` must match the manifest. `regime` is one of OPEN, EXTENDED, CLOSED, WEEKEND, HALTED, CORP_ACTION or INTRADAY_BUFFER. All prices must be corporate-action adjusted and per normalized displayed token, within the parser's finite bounds of 1e-12 to 1e12. Convert raw Atlas prices using verified multiplier observations before constructing a dataset; this workflow does not infer historical split factors. Timestamps must include timezones, start before end, and contain no information beyond the declared evidence cutoff.

The supplier must document window classification, price adjustments, sampling and independence assumptions in the manifest's `methodology`. The code rejects duplicate windows, mixed assets and overlapping windows within a bucket. Non-overlap does not prove independence; autocorrelation, common events across buckets, sampling bias and data-source authenticity still require independent investigation.

Start from `ai-risk-controller/calibration-manifest.example.json`. It intentionally defaults to `simulated: true` and `corporate_action_adjusted: false`, so copying it cannot produce a candidate. Set those declarations only when they accurately describe supplied evidence. The tool does not authenticate those claims; output records `source_verification: UNVERIFIED_CALLER_DECLARATION`.

## Estimation and holdout

1. Compute adverse loss `max(0, 1 - end_price / start_price)` for each observation.
2. Sort each bucket chronologically. Reserve the last 20% as a holdout; never fit the quantile to those rows.
3. Use the nearest-rank empirical quantile from training observations, rounding the candidate haircut upward to whole basis points.
4. Require at least 500 training and 100 holdout observations per bucket by default. Also require at least five expected training-tail observations: `training_count × (1 - quantile) >= 5`. A 99.9% quantile therefore requires at least 5,000 training observations, even if a lower sample floor was requested. Latest holdout evidence must be within the configured recency window (365 days by default).
5. Keep candidates at least as conservative as the declared existing haircuts/margin. Raise routine haircuts to preserve OPEN <= EXTENDED <= CLOSED <= WEEKEND and raise HALTED if needed to cover CORP_ACTION.
6. Convert the INTRADAY_BUFFER loss quantile into LTV-point margin using `ceil(LLTV × loss × 10000)` bps. This is a conservative illustrative mapping, not a fitted joint gap/intraday model. Preserve the existing margin floor.
7. Validate the candidate against DawnOracle bounds, DawnRouter's 5,000-bps maximum margin and a strictly positive target LTV. Reject instead of lowering an observed loss to fit the contract.
8. Evaluate holdout breaches against the final rounded/floored candidates. Withhold all candidates if any bucket's observed breach fraction exceeds `1 - quantile`.

These are transparent minimum evidence and descriptive validation gates, not a confidence bound or proof that a quantile generalizes. Passing them does not establish safety through a regime transition, corporate action, liquidation liquidity shock, volatility clustering or a new market structure. Full backtesting, source verification, sensitivity analysis and governance/security review remain necessary.

## Run

From `ai-risk-controller`, with its development dependencies installed:

```sh
# No evidence supplied: writes an auditable NO_DATA report and exits 2.
python -m scripts.calibrate_dawn --output /tmp/dawn-calibration.json

# With actual supplied evidence (filenames here are placeholders):
python -m scripts.calibrate_dawn \
  --input /path/to/adjusted-windows.csv \
  --manifest /path/to/provenance.json \
  --output /tmp/dawn-calibration.json
```

`--as-of` accepts a timezone-aware historical cutoff for reproducible analysis, never a future cutoff. `--quantile`, `--min-training` and `--min-holdout` expose the documented gates; the expected-tail minimum cannot be bypassed by reducing the sample floor. `RISK_CONFIG_PATH` and `DAWN_CONFIG_PATH` select declared baseline policies using the same validated models as the advisory backend. Input is bounded to 10 MB / 100,000 observations.

Exit 0 means `CANDIDATE_REQUIRES_REVIEW`, never approval. Exit 2 means absent/invalid/insufficient evidence, failed holdout validation or contract bounds; no haircut/margin candidate is available. Runtime input/configuration errors overwrite any prior output with an `INVALID_INPUT` rejection report, so stale candidates cannot masquerade as the failed run. Reports include input SHA-256, provenance, cutoff, configuration hash, gate settings, per-bucket counts/holdout diagnostics, blockers and a canonical report hash; rejected malformed inputs may have only the error/hash fields. Identical valid evidence and settings reproduce the report.

The candidate scope is oracle haircuts and router margin only, with a matching `router_hmax`/`router_margin` risk-policy patch. Changing immutable oracle parameters requires a new oracle and compatible Morpho market. The tool does not generate or execute calldata and does not connect candidates automatically to the server. Borrowing caps need executable-liquidity evidence; staleness needs heartbeat observations; continuity/jump/freeze and keeper parameters need their own operational evidence. None of those controls are calibrated from this price CSV.
