# Run Blue Finance locally and configure optional APIs

The connected demo needs **no API keys**. The frontend calls the Python advisory service through its own `/api/risk` routes. NVDA prices, issuer documents and borrower analysis are simulated; Nasdaq/Binance market status is fetched separately from public endpoints. No lending transaction is executed by this integration.

## Start the backend

Use Python 3.12 or newer, from the repository root:

```sh
cd ai-risk-controller
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.lock
cp .env.example .env
chmod 600 .env
set -a
source .env
set +a
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

SQLite is created locally; no database registration is needed. Open [backend documentation](http://127.0.0.1:8000/docs). The backend does not load `.env` automatically, so export/source it as above and restart after changes.

## Start the frontend

In another terminal, from the repository root, use Node 24 (`nvm use` in `frontend` if you use nvm):

```sh
cd frontend
cp .env.example .env.local
npm ci
npm run dev
```

Open [Risk](http://localhost:3000/app/risk). Click **Analyse demo position**. Friday/Saturday selections are historical replays and are labelled expired; “Now” generates fresh synthetic evidence. The position comes from your demo account, with displayed token quantities and USD debt. Borrowing or repaying in the demo changes the next assessment's inputs. QQQb/SPCXb and halted/frozen split scenarios are explicitly unsupported by this backend.

`RISK_API_URL=http://127.0.0.1:8000` belongs in `frontend/.env.local` and is read only by the Next.js server. The browser uses the same origin, so the Python CORS setting can stay empty. For deployment, use the reachable backend origin rather than localhost, set it in the frontend host's server environment, and run the Python service separately. Browser cookies and authorization headers are not forwarded by the proxy. Missing/unavailable services show an error; results are never fabricated in the browser.

Risk advice, current on-chain limits and the UI's illustrative borrowing limits are separate. The panel shows the backend reference price, expiry, stress scenarios and unsigned Blue router proposals. It never applies a proposal or changes liquidation thresholds. The service still needs deployment authentication/rate limits before public production use.

## Optional: OpenAI issuer-document extraction

Only enable this if you want to send supplied issuer documents to an LLM. It does not supply live prices or automatically fetch issuer documents.

1. Sign in to the [OpenAI API dashboard using the official quickstart](https://developers.openai.com/api/docs/quickstart), then select **Create an API Key**. Select/create your project and create its key. Complete any account billing/access setup shown in the dashboard before using it.
2. Save the key with a password manager. Edit **only your private** `ai-risk-controller/.env` file:

   ```dotenv
   ISSUER_PROVIDER=openai_compatible
   LLM_BASE_URL=https://api.openai.com/v1
   LLM_MODEL=gpt-4.1-mini
   LLM_API_KEY=replace_in_your_private_env_file
   ```

3. Reload that file into the backend terminal and restart Uvicorn. On a hosted backend, use that host's secret/environment settings instead. This application reads `LLM_API_KEY`, rather than the SDK's usual `OPENAI_API_KEY` name.

The existing adapter uses Chat Completions with JSON output and temperature 0; choose a model supporting those options. [GPT-4.1 mini supports Chat Completions and structured outputs](https://developers.openai.com/api/docs/models/gpt-4.1-mini). Calls can incur charges. LLM extraction remains review-only and failures hold new exposure. Live LLM calls are not part of the keyless test suite.

## Optional: WalletConnect QR/mobile linking

An injected browser wallet and the risk demo do not need this setting.

1. Sign in at the [Reown dashboard](https://dashboard.reown.com), create a project for Blue Finance, and copy its project ID.
2. In the project's allowlist, add your actual frontend production origin. Localhost is permitted by Reown. [Official project ID and allowlist guidance](https://docs.reown.com/cloud/relay).
3. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` in your private `frontend/.env.local`, then restart/rebuild Next.js. In deployment, set it in the frontend host before building.

This is a public browser project identifier, unlike the LLM secret, but keep your actual value out of GitHub as requested. Wallet connection does not turn simulated lending into live transactions.

## What is still needed for live financial data

No Nasdaq/Binance API key is required for the current status adapters. Public endpoints can fail or change; the service then reports unavailable status. Real historical adjusted prices, executable token order books, live Atlas observations and issuer documents require server-side provider adapters and verified asset mappings. Registering a market-data API alone does not activate these missing integrations. A BSC RPC URL is needed for keepers/fork demos; the existing tests use public endpoints. A reliable archive-capable RPC is useful for sustained fork demos, but no paid provider is required for this advisory connection.

## Keep credentials private

Never paste secrets into chat, source code, screenshots, PR descriptions or GitHub issues. Real `.env`, `.env.local` and `.env.*` files are ignored throughout the repository; only placeholder example files are tracked. Keep LLM/RPC secrets in the backend environment or deployment secret store and never use a `NEXT_PUBLIC_` variable for them. Do not force-add ignored files. If a real secret has ever been committed, revoke/rotate it; deleting the file is insufficient.

## Verify the connection

With both services running:

```sh
cd frontend
npm test
npm run typecheck
npm run build
npm run test:integration
# Optional real public-source acceptance check:
npm run test:integration -- --live-status
```

The integration smoke calls the real frontend proxy and backend for current/Friday/Saturday evidence, eight stress scenarios, an explicit empty account and unsupported markets. `FRONTEND_URL` can select another local or deployed frontend origin. Backend tests: `cd ai-risk-controller && .venv/bin/python -m pytest -q`. Keeper tests/typecheck: `cd keepers && pnpm test && pnpm typecheck`. Contract setup and tests are documented in [Morpho protocol README](../protocol-old/README.md).
