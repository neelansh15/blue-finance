# Sixth component PR: market risk and alternative contract selection

Branch: `codex/market-risk-routing`. Initial base: `codex/recommendation-engine` (PR #6). This is the sixth component PR in the stack; its GitHub PR number is assigned separately.

## Problem and resulting behavior

A paused or excessively risky market should not receive new exposure merely because its normal borrowing parameters exist. This PR assesses configured market contracts and returns one of three advisory actions:

- `KEEP_CURRENT`: the primary passes controls and quantitative constraints.
- `PROPOSE_ALTERNATIVE`: the primary fails, and a different approved contract independently passes.
- `HOLD_NEW_EXPOSURE`: no configured destination is eligible.

Government restrictions apply at asset, venue or global scope. A different contract sharing a restricted asset or venue remains ineligible. Protocol-governance pauses reject the affected destination. Token pauses, issuer restrictions and excessive underlying volatility propagate across the same asset. Missing or stale evidence rejects the affected destination.

## Implementation

- `app/routing/models.py`: typed destination configuration, control inputs, policy and decision contracts.
- `app/routing/policy.py`: environment-loaded server allowlist and explicitly simulated defaults.
- `app/routing/engine.py`: independent assessments, pause-scope propagation, deterministic eligibility/ranking and evidence persistence.
- `app/services/risk_service.py`: instance-specific asset allowlist so routing can assess configured alternatives without expanding ordinary endpoints.
- `app/api/risk.py`: `POST /risk/route/{asset}`; OpenAPI includes the request and response models.
- `scripts/market_routing_demo.py`: five reproducible cases through the actual API.
- Policy/request JSON examples and routing tests.

Default quantitative rejection thresholds are score ≥60, annual volatility ≥65%, recovery ratio <70%, or rejection by existing borrowing constraints. Each target supplies its own immutable LLTV, validated against governance bounds. The primary must match the configured chain and USDT debt assumptions. Candidate contract identities are server-configured, not accepted from client inputs.

## Review and validation

From `ai-risk-controller/`, using the installed test environment:

```sh
python -m pytest -q
python -m scripts.market_routing_demo
```

**68 cumulative tests pass**, including the original 43 tests and 25 routing tests. The five-case API demo completes successfully. Tests cover government/governance/token pauses, cross-market restrictions, high score/volatility, recovery and oracle failures, missing/unknown/stale/future controls, allowlist injection, incompatible destinations, per-market LLTV, audit persistence and the endpoint. Existing tests continue to run.

## Boundaries and integration work

This is an advisory backend change. All request control evidence is unverified and all decisions remain simulated, unsigned and pending review. Example addresses are placeholders. SPY uses generic seeded synthetic data for the demo, not live or historically observed SPY prices. No contract deployment, migration transaction, pause bypass or automatic reallocation is implemented. Existing borrowers remain in their current markets.

Production requires authenticated control sources, durable halt/clearance tracking, real per-asset providers, verified market metadata, approval/signing integration, and separate migration and borrower-impact analysis. The controller cannot eliminate government restrictions by changing contracts.

This PR depends on the five preceding components. Merge after PR #6; when its dependency is merged, retarget this PR to `main` and verify the diff. Main was pulled before implementation; the latest main is checked again before pushing.
