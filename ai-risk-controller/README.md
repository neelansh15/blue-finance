# Dawn AI Risk Controller

Standalone Python 3.12+ FastAPI service for advisory NVDA tokenised-equity collateral risk. It assesses sessions, oracle freshness, executable recovery and borrower impacts, then produces versioned, approval-gated recommendations. All default market, oracle, issuer and borrower inputs are **SIMULATED**, require no keys and are not historical NVDA observations.

## Run

```sh
cd ai-risk-controller
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.lock
uvicorn app.main:app --reload
```

Swagger: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs). For runtime-only installation use `requirements.lock`. Exact resolved dependencies are locked; `requirements.txt` and `requirements-dev.txt` declare direct dependencies. No PostgreSQL server is needed: SQLite persists audit evidence and recommendations in `risk.sqlite3`.

```sh
python -m pytest -q
python -m scripts.demo --output /tmp/dawn-risk-demo.json
# Or use the running API:
python -m scripts.demo --url http://127.0.0.1:8000 --output /tmp/dawn-risk-demo.json
```

The demo uses Friday **20 November 2026**, 11:00 and 15:30 New York time, then Saturday 21 November, 12:00. This is deliberately before Thanksgiving week, whose Friday is an early close. It demonstrates tightening limits before Friday closure, stale underlying observations despite fresh publication on Saturday, and an issuer redemption restriction. Historical demo recommendations expire 15 minutes after their evidence timestamp; the history API does not present them as current. UUIDs differ across runs; financial outputs and evidence hashes are reproducible with a fixed policy and inputs.

## API

| Method | Path | Behavior |
|---|---|---|
| POST | `/risk/assess/{asset}` | Full assessment, evidence hash, recovery and session/oracle details |
| GET | `/risk/score/{asset}` | Latest stored score and factor contributions; 404 before assessment |
| POST | `/risk/recommend/{asset}` | Reassess, optimise, simulate target policy and persist recommendation |
| POST | `/risk/simulate/{asset}` | Reassess and run eight default shocks or supplied scenarios/borrowers |
| GET | `/risk/events/{asset}` | Issuer and deterministic session/oracle events from latest assessment |
| GET | `/risk/recommendations/{asset}?limit=100` | History and latest unexpired advisory recommendation |
| GET | `/health` | Storage, configuration version, signing and monitoring status |

Assets `NVDA` and `BNB_STOCK_NVDA` resolve to one canonical asset. Unsupported assets return 404; invalid inputs return 422; storage failure returns 503. Latest means latest **evidence time**, so replaying older scenarios does not supersede newer evidence.

```sh
curl -s -X POST http://127.0.0.1:8000/risk/assess/NVDA \
  -H 'Content-Type: application/json' -d '{"scenario":"friday"}'
curl -s -X POST http://127.0.0.1:8000/risk/recommend/NVDA \
  -H 'Content-Type: application/json' -d '{"scenario":"saturday"}'
curl -s -X POST http://127.0.0.1:8000/risk/assess/NVDA \
  -H 'Content-Type: application/json' -d '{"scenario":"saturday","oracle_mode":"24_7_smoothed"}'
curl -s -X POST http://127.0.0.1:8000/risk/simulate/NVDA \
  -H 'Content-Type: application/json' -d '{"scenario":"friday","borrowers":[{"borrower_id":"alice","collateral_quantity":100,"debt_usd":7000,"liquidation_threshold":0.625}],"scenarios":[{"name":"gap","price_drop":0.2},{"name":"explicit_oracle_haircut","oracle_price_multiplier":0.9}]}'
```

POST bodies may be omitted. Baseline defaults to the current UTC time with freshly generated **synthetic** inputs; named Friday/Saturday scenarios default to fixed replay timestamps. `as_of` must include a timezone. `snapshot` accepts a full validated `Snapshot` (see OpenAPI) for teammate adapters and custom shocks; all HTTP-supplied snapshots are explicitly relabelled as unverified simulation inputs. Trusted live sources must be integrated server-side. `liquidation_quantity` (default 1,000 tokens) sets the size used for the assessment recovery estimate; portfolio simulations use the entire supplied portfolio and share one book.

Enable continuous simulated monitoring by setting `RISK_POLL_SECONDS=120` before starting Uvicorn. Each cycle assesses NVDA, generates a recommendation and persists it; failures are logged and health becomes degraded. Default is request-driven. Use one worker with monitoring enabled to avoid duplicate cycles. Expose this hackathon API on a trusted network; authentication, rate limiting and retention limits are deployment work, not implemented here.

## Modules and handoff

- `integrations/providers.py`: market, oracle, issuer and snapshot provider protocols; deterministic mock implementation and synthetic positions. Replace with read-only teammate integrations.
- `market_sessions/`: NASDAQ calendar, New York session detection, override halts/degraded data, oracle health and regime policy. Calendar library handles holidays, early closes and DST. Unexpected halts must come from a provider flag. `EARLY_CLOSE` denotes the shortened regular trading window; after its close, `EXTENDED` applies. Extended hours are an illustrative 04:00–20:00 ET window on exchange session dates, not evidence of executable equity or token liquidity.
- `risk/`: independent log-return volatility, drawdown, momentum, book execution, issuer/oracle risks, scoring and recovery calculations.
- `optimiser/`: extensible optimiser protocol, constraint-based implementation and governance bounds.
- `simulation/`: protocol health semantics and correlated portfolio stress. Swap the adapter once exact contract accounting is available.
- `agents/issuer_agent.py`: LLM provider abstraction, optional OpenAI-compatible HTTPS JSON provider, evidence validation and a fixture-only mock extractor. The mock is not an LLM or a general document classifier. Documents cannot invoke tools. Invalid JSON, unknown fields (including parameter suggestions), fabricated quotes, failures, missing documentation and inconclusive live extraction produce uncertainty and block new exposure. Event classification can still be wrong; all issuer findings require review.
- `services/`: orchestration and SQLite audit store. Stores the raw validated snapshot, configuration, extracted events and assessment alongside recommendations; replace this small store interface with PostgreSQL for multi-instance deployment.
- `api/`: validated REST contracts. No chain writer, frontend, oracle infrastructure or liquidation bot.

`ISSUER_PROVIDER=openai_compatible` enables a real LLM call using `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` from the environment. It sends the supplied document text to that configured provider; configure an approved endpoint. It does not fetch issuer URLs. The default issuer provider remains mock, and all market/oracle inputs remain simulated until server-side providers are replaced. The agent returns events only; deterministic rules retain control of every lending parameter.

## Financial assumptions

These rules are **illustrative MVP heuristics, not a validated production financial model**. Policy defaults are in `app/config.py`; `policy.example.json` is a complete editable copy. Set `RISK_CONFIG_PATH` to a JSON file and restart. Every effective configuration has a content-derived fingerprint, so changing a value changes the recommendation version even if the human-readable version is unchanged.

1. One token represents one raw, normalized underlying share; prices and debt are USD, USDT=$1. No UI multiplier, split continuity, dividend adjustment, transfer eligibility, reserve, tax, interest accrual or depeg model is implemented. Teammates must supply properly adjusted prices and quantities. Supply caps are **tokens**, borrow caps are **USD**, and both are total exposure targets, not forced withdrawals or repayments.
2. Annual volatility is sample standard deviation of daily-close log returns × √252; at least 20 daily closes are required. Timestamps must be ordered, nonfuture and plausibly daily. Maximum drawdown uses running peaks; momentum compares the last price with up to 20 preceding observations. History older than 120 hours, missing/old executable quotes, missing oracle data, reference divergence over 10%, or issuer uncertainty blocks new exposure. A quoted but empty book has zero recovery. Long irregular shutdowns require a policy review.
3. Underlying exchange session, oracle freshness and token-market execution are separate. A closed exchange never automatically removes token bids. Calendar-derived closure risk changes stress horizon and buffers. A fresh oracle publication cannot refresh an old observation. The 24/5 fixture conservatively observes cash-session marks only; a real feed may observe overnight trades. The 24/7 smoothed fixture carries explicit lag and a minimum 2% basis haircut, even when fresh.
4. Reference price is `min(underlying, token midpoint, available oracle)`. Adverse price loss is `max(session gap floor, 2.33 × annual volatility × sqrt(horizon_days / 252))`, with volatility loss capped at 80%. Normal/overnight/weekend/unknown gap floors are 1%/3%/8%/20%; horizon expands through closure. These floors and normal approximation need calibration using actual adverse gaps, earnings and halt data.
5. Recovery walks the finite bid book at the conservative reference, then applies the stress. Unfilled quantity is worth zero for immediate recovery. The liquidity haircut is its unsold fraction; execution haircut includes the filled bid-price discount and 0.3% fee. Spread, price impact and divergence are not subtracted twice. Baseline issuer haircut is 2%, restriction 25%, uncertain 15%. Oracle haircut covers reference uncertainty (20% for stale, plus declared basis risk); it is separate from the price-gap loss. Correlation across these assumptions remains a modelling limitation.
6. Overall score uses 25% volatility, 25% liquidity, 20% issuer, 15% oracle and 15% concentration. Volatility reaches 100 at 80% annualized volatility. Liquidity uses the worst of spread/5%, unfilled fraction, deterioration and slippage/20%, capped at 100. Issuer severity maps to 20/45/85/100; oracle uses actual observation age, publication age, lag and basis; concentration is the collateral exposure fraction. Contributions are returned explicitly. Continuous category cutoffs are ≤20/40/60/80/100; e.g. 20.1 is MODERATE. Confidence is a conservative diagnostic, not a calibrated probability.
7. LTV is the minimum of governance maximum, LLTV minus buffers, stressed recovery net of incentive/margin, and a volatility limit. Target LTV uses the **protocol oracle price** as denominator. Recovery and volatility constraints are scaled by the conservative-reference/protocol-price ratio so an oracle premium cannot increase economic borrowing capacity. Oracle/reference divergence also raises the oracle risk factor. Caps use conservative-reference USD value, constrained by 25% of executable depth and 5% of daily volume, with session/issuer reductions. Missing, stale or restricted inputs can reduce target LTV and both caps to zero. This stops recommended **new exposure**; existing positions still need management.
8. Default Morpho market LLTV is fixed at 62.5%. Health factor is `collateral × protocol oracle price × LLTV / debt`; liquidation requires HF < 1, while HF=1 is at risk. No-debt health is JSON `null` (infinite). Risk flags additionally consider economic recovery, an HF buffer of 1.15 and proposed router LTV. Proposals alone cannot change existing liquidation eligibility. Only a price shock with an eventual oracle mark or an explicit `oracle_price_multiplier` changes the simulated protocol price. A non-Morpho integration can configure mutable thresholds and explicitly opt into applying one to existing positions.
9. Simulations liquidate all positions concurrently against one shared stressed book, allocating proceeds pro rata. Debt recovery is capped by both executable proceeds and protocol collateral value, divided by Morpho's liquidation incentive factor `min(1.15, 1 / (1 - 0.3 × (1 - LLTV)))`. Estimated bad debt is a **stressed economic shortfall**, not realised contract accounting. This is conservative and does not model liquidation order, close factors, pre-liquidation, replenishment or integer/share math. Newly at risk means HEALTHY→AT_RISK; newly liquidatable means any previously nonliquidatable position→LIQUIDATABLE.
10. Additional collateral is an indicative lower bound for the HF/recovery/router target. The simulator rechecks finite depth after hypothetical deposits and reports `safety_restoration_feasible=false` when liquidity or a zero borrowing target prevents restoring safety. Extra inventory cannot create an exit market; repayment may be necessary.

## Recommendations, signing and contracts

Default recommendations are **UNSIGNED** and **PENDING_REVIEW**. They include the canonical asset, chain ID 56, an explicit undeployed demo market ID, risk factors via assessment evidence, parameters, impacts, timestamp/expiry, evidence SHA-256, source references, policy fingerprint, model version and confidence. Approval is always required. No approval/execution endpoint exists.

`RecommendationSigner` is an injection seam for an externally authorised signing system. No private-key management is implemented. A signed envelope never changes approval status. `signing_payload()` binds the chain and market domain to the validated JSON response, excluding `signature`, `signing_status` and `payload_hash`. `canonical_bytes()` uses UTF-8, sorted keys, compact separators and finite numbers; `payload_hash` is SHA-256 of these exact bytes. Consumers can reproduce it from the response's `chain_id` and `market_id`. This Python JSON format is an **offchain audit format, not EIP-712**; design a typed, integer-scaled EVM envelope jointly with the smart-contract teammate before onchain consumption. Never treat a hash alone as a signature.

The contract/periphery must independently reject unapproved signers/assets/markets/chains, invalid or missing signatures, replayed/expired recommendations, simulated data, unapproved proposals, excessive changes and governance bound violations; enforce LTV<LLTV. No recommendation can mutate unmodified Morpho's LLTV or enforce a router cap on callers bypassing that router. DawnOracle haircuts affect health through the oracle price and need separate governance validation and explicit borrower impact analysis. See [architecture-v1.md](../architecture-v1.md) and [Morpho market documentation](https://docs.morpho.org/learn/concepts/blue/).

## Docker

```sh
docker build -t dawn-risk-controller .
docker run --rm -p 127.0.0.1:8000:8000 \
  -v dawn-risk-data:/service/data \
  -e RISK_POLL_SECONDS=120 dawn-risk-controller
```

The image uses Python 3.12, a nonroot user, runtime dependency lock, persistent data directory and HTTP healthcheck. Live feeds, calibrated/backtested policies, contract-exact accounting, production signing/approval workflows, authentication and monitoring infrastructure remain integration work.

Validation before the routing extension: 43 tests passed, including all REST routes, calendar boundaries, finite-depth recovery, parameter constraints, borrower shock/transition counts, oracle-premium safety, evidence/signing serialization, issuer fail-closed behavior, monitoring success/failure, and audit persistence. The demo completes through the REST routes; `pip check` reports no dependency conflicts. Third-party calendar/TestClient dependencies emit deprecation warnings. A Docker build could not be run because the local Docker daemon is unavailable.

Calendar reference: [pandas-market-calendars schedule and early-close API](https://pandas-market-calendars.readthedocs.io/en/latest/pandas_market_calendars.html).

## Market risk and alternative contracts (sixth PR)

`POST /risk/route/{asset}` assesses configured destinations and proposes a different contract if the current market fails its controls or quantitative checks. `KEEP_CURRENT` retains an eligible primary; `PROPOSE_ALTERNATIVE` identifies an independently eligible destination; `HOLD_NEW_EXPOSURE` means no acceptable destination exists. All responses are simulated, unsigned and pending review. Existing collateral and debt stay in their original contracts.

Run `python -m scripts.market_routing_demo` for healthy, governance pause, government asset halt, global halt and high-volatility examples. A sample API request is in `routing-request.example.json`. It uses a historical simulated timestamp; expiry is tied to that timestamp.

```sh
curl -s -X POST http://127.0.0.1:8000/risk/route/NVDA \
  -H 'Content-Type: application/json' --data-binary @routing-request.example.json
```

Set `RISK_ROUTING_CONFIG_PATH` to a server-controlled JSON file following `routing-policy.example.json` and restart the service. In Docker, bind-mount the configuration file and set the variable to its container path. Configuration binds an approved/enabled target ID to chain, market ID, contract address, collateral, underlying venue, loan asset and immutable LLTV. The default addresses and market IDs are **placeholders, not deployed contracts**. Only configured destinations can be evaluated; requests cannot supply addresses or approve targets. Market LLTV must also fit the existing governance bounds. The primary must use the configured chain and USD-valued USDT debt; cross-chain moves and incompatible loan assets are rejected. Alternatives must use a distinct contract address.

Controls include observation time and source reference, government pause scope (`NONE`, `ASSET`, `VENUE`, `GLOBAL`, `UNKNOWN`), protocol-governance pause, and token-transfer pause. Missing, unknown, stale or future-dated control evidence rejects that destination. Positive asset/venue/global restrictions propagate across matching destinations even when their own reports say open. Token-transfer pauses and issuer restrictions propagate by asset; excessive/missing underlying volatility also propagates across contracts sharing that asset. Live adapters must persist active restrictions and verify their clearance; the MVP does not authenticate control reports or maintain a durable regulatory halt registry.

Each market receives its own deterministic assessment and optimiser run. Default routing limits reject score ≥60, annual volatility ≥65%, recovery ratio <70%, or any underlying deterministic rejection of new borrowing. Eligible alternatives are ordered by score, volatility, then target ID. A healthy primary remains selected to avoid unnecessary switching. Evidence hashes bind input controls, risk assessments, full risk/routing policies, and destination metadata; complete decisions and evidence are retained in SQLite under `routing` records.

SPY exists only as a configured, independently assessed alternative in this routing demo. Its mock provider reuses generic seeded synthetic inputs; these are not real SPY observations or evidence that SPY is safe during an NVDA halt. Ordinary risk endpoints retain their original NVDA allowlist. Other assets are evaluated only inside the server-configured routing registry, using the current US-equity calendar/one-share assumptions.

Before production, integrate authenticated regulator/keeper and onchain pause observations, actual per-asset market/oracle/issuer data, verified deployment/market metadata, and an external approval/signing workflow. Switching contracts does not remove an asset-wide halt or shared volatility exposure. A different-asset destination changes exposure and requires separate approval and migration analysis. The API does not execute transactions, clear pauses, mutate immutable markets, or move existing positions. Historical replay outputs must not be treated as current executable instructions.

Routing validation: **68 cumulative tests pass**. The API demo retains a healthy primary, proposes an alternative for governance/asset pauses or high volatility, and holds new exposure under a global halt.
