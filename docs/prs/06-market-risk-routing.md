# Sixth component PR: live market status and alternative contract selection

Branch: `codex/market-risk-routing`. Initial base: `codex/recommendation-engine` (PR #6). This is the sixth component PR in the stack; its GitHub PR number is assigned separately.

## Problem and resulting behavior

A paused or excessively risky market should not receive new exposure merely because its normal borrowing parameters exist. The backend now fetches Nasdaq session/underlying-halt status and Binance per-bStock status before live routing. This PR assesses configured market contracts and returns one of three advisory actions:

- `KEEP_CURRENT`: the primary passes controls and quantitative constraints.
- `PROPOSE_ALTERNATIVE`: the primary fails, and a different approved contract independently passes.
- `HOLD_NEW_EXPOSURE`: no configured destination is eligible.

Government restrictions apply at asset, venue or global scope. A different contract sharing a restricted asset or venue remains ineligible. Protocol-governance pauses reject the affected destination. Token pauses, issuer restrictions and excessive underlying volatility propagate across the same asset. Missing or stale evidence rejects the affected destination.

## Implementation

- `app/integrations/market_status.py`: read-only Nasdaq market-info JSON, per-ticker Nasdaq halt RSS, Binance per-token RWA status and optional Spot status; timestamped raw evidence, 60-second shared cache, persistent halt/resumption state and conservative unknown behavior.
- `app/routing/models.py`: typed destination configuration, control inputs, policy and decision contracts.
- `app/routing/policy.py`: environment-loaded server allowlist and explicitly simulated defaults.
- `app/routing/engine.py`: independent assessments, pause-scope propagation, deterministic eligibility/ranking and evidence persistence.
- `app/services/risk_service.py`: instance-specific asset allowlist so routing can assess configured alternatives without expanding ordinary endpoints.
- `app/api/risk.py`: `GET /risk/market-status/{asset}` and `POST /risk/route/{asset}` (live statuses by default; explicit simulated replay); OpenAPI includes the request and response models.
- `scripts/market_routing_demo.py`: five reproducible simulated cases through the actual API. `scripts/market_status_smoke.py`: real read-only status probe.
- Policy/request JSON examples and routing tests.

Default quantitative rejection thresholds are score ≥60, annual volatility ≥65%, recovery ratio <70%, or rejection by existing borrowing constraints. Each target supplies its own immutable LLTV, validated against governance bounds. The primary must match the configured chain and USDT debt assumptions. Candidate contract identities are server-configured, not accepted from client inputs.

## Review and validation

From `ai-risk-controller/`, using the installed test environment:

```sh
python -m pytest -q
python -m scripts.market_routing_demo
python -m scripts.market_status_smoke --asset NVDA  # required real-HTTP acceptance before publishing
```

**112 cumulative tests pass**, including the original 43 tests, 25 routing tests and 44 live-status tests. The five-case offline API demo completes successfully. Tests cover government/governance/token pauses, cross-market restrictions, high score/volatility, recovery and oracle failures, missing/unknown/stale/future controls, allowlist injection, incompatible destinations, per-market LLTV, audit persistence and the endpoint. Existing tests continue to run.

## Boundaries and integration work

This is an advisory backend change. Fetched status evidence is live and server-controlled. Other request control evidence is unverified, and decisions remain simulated, unsigned and pending review because prices/issuer/borrower data are still simulated. Example addresses are placeholders. SPY uses generic seeded synthetic data for the demo, not live or historically observed SPY prices. No contract deployment, migration transaction, pause bypass or automatic reallocation is implemented. Existing borrowers remain in their current markets.

Production requires authenticated regulatory/onchain control sources, real per-asset price/oracle/issuer providers, verified market metadata, approval/signing integration, and separate migration and borrower-impact analysis. The controller cannot eliminate government restrictions by changing contracts.

This PR depends on the five preceding components. Merge after PR #6; when its dependency is merged, retarget this PR to `main` and verify the diff. Main was pulled before implementation; the latest main is checked again before pushing.


## Live status follow-up

- Nasdaq market-info supplies open/closed/pre-market/after-hours status; Nasdaq Trader supplies individual-stock halt/pause/resumption evidence. Nasdaq RSS is polled at most once per minute. Underlying halts are latched in SQLite and cannot clear from feed disappearance or future resumption times.
- Binance Wallet RWA status is fetched separately for each configured chain/collateral-token address. Paused/limited/maintenance/corporate-action states block exposure; unknown codes and HTTP/schema failures become unknown. Optional Binance Spot status is supplementary and cannot substitute for the token's own status.
- Live routing cannot be cleared by caller flags. Restrictions propagate across matching underlying ticker or token identities. Market closure and token trading remain distinct. Missing mappings, stale/future evidence and unavailable feeds reject selection. The new status endpoint persists raw observations; routing evidence binds fetched status into its hash.
- Public Nasdaq JSON and Binance `/ai` endpoints have no availability guarantee. Python HTTP clients received Akamai HTTP 403 for Nasdaq market-info. The adapter now uses system curl over HTTP/1.1 for that fixed public URL, without keys, browser impersonation or disabled TLS. The application acceptance check returned HTTP 200, with upstream HTTP 200 for Nasdaq market-info CLOSED, Nasdaq halt-feed NO_ACTIVE_HALT and Binance NVDAB TRADING. Docker installs curl and CA certificates. Real-time licensed Nasdaq data is outside this public-endpoint adapter.
- Required source failures now produce HTTP 503 from the status endpoint. The strict smoke command fails with a nonzero exit unless the application and required sources return HTTP 200/201 with valid fresh data. Unit/mocked success or UNKNOWN is not enough to publish. The verification scope is explicitly NVDAB; the unmapped SPY demo is not live-verified.
- The default NVDAB token mapping is configured; the SPY demo has no verified bStock mapping and is ineligible for live selection. Historical demos explicitly set `status_mode=SIMULATED` and never fetch current evidence.


## PR comparisons

PR #6 remains the recommendation-engine component, based on `codex/borrower-impact-simulator`. PR #7 reviews this routing branch against `codex/recommendation-engine` and isolates the sixth component. PR #8 uses the same routing branch and head commit but compares against `main`, so it contains all earlier controller components too. The two routing PRs are alternative comparisons of one implementation, not separate features.
