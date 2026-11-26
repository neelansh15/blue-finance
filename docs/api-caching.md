# External API caching

External data reads use a 60-second in-memory cache. Repeated identical requests share the result and concurrent callers share one in-flight request. Failures are cached too: an unavailable source stays unavailable until the next refresh, rather than falling back to an older successful response.

| Integration | Cache scope and identity |
| --- | --- |
| Python Nasdaq market-info and halt RSS | One backend provider/process; URL and query parameters. The RSS response is shared across tickers. |
| Python Binance bStock status and optional Spot exchangeInfo | Same backend cache; chain/token and Spot symbol remain distinct. |
| Optional LLM issuer extraction | One configured provider/process; hash of endpoint, model, asset and complete issuer documents, including text, source and timestamps. Changed evidence triggers a new request. |
| Keeper Binance bStock status/list and Spot metadata | One keeper process, shared by callers using the same HTTP client; URL, headers and timeout. |
| Keeper Nasdaq halt RSS | Existing source-level one-minute cache, including failures and concurrent requests. |
| Atlas feed price, decimals and token multiplier | Frontend server cache per supported symbol, shared across visitors through `/api/atlas/prices/[symbol]`. Browser polling remains once per minute; no second browser response cache extends server data lifetime. |
| Keeper multiplier monitoring RPC | One reader/process; head, token multiplier, and explicit token/block log range. |
| Wallet read queries | React Query considers results fresh for one minute in the browser and does not automatically retry failed queries. |

Expiry is measured from request start; a slow pending request is shared until it completes. At 60 seconds the next request refreshes lazily. Original observation/publication timestamps are preserved, and existing stale-data, evidence and halt-latch checks still apply. Caches are bounded (256 entries for general request caches) and are not persisted to disk.

These are per-process caches, not a global provider quota: replicas, restarts, different inputs and separate keeper/backend deployments can each make requests. No API keys are required for caching. Keys remain runtime environment variables and are never written to cache files or GitHub.

Risk assessments, account-specific calculations and audit writes still run for each request; their external evidence reads are cached. WalletConnect session/signature messages, transaction submission, nonce/gas estimation, receipt tracking, and keeper transaction-time safety/continuity checks are not cached because they require current state. The Atlas server disables automatic retries on each RPC endpoint; configured RPC fallback endpoints can still be tried if one is unavailable.
