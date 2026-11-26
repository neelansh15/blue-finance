# Blue Finance frontend

Next.js (App Router, TypeScript) frontend for the Blue Finance demo, with a server-side connection to the Python advisory risk API.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Demo app (`/app`)

Mocked-data demo UI. Developer controls: `/app?dev=1` or Shift+D. The demo uses the in-memory client in `src/lib/blue/client.ts` and position math in `src/lib/blue/math.ts`.

```
npm test        # vitest
```

Haircuts, margin and the continuity band are illustrative placeholders.

## Connected risk analysis

See [local setup and optional API registration](../docs/local-development.md). Start the Python backend, copy `.env.example` to the ignored `.env.local`, and set the server-only `RISK_API_URL` (default example: `http://127.0.0.1:8000`). Visit `/app/risk` or open the assessment panel on `/app/borrow` or `/app`. No API keys are needed for synthetic assessments or the public Nasdaq/Binance status check.

The proxy accepts a single explicit NVDA demo position or an empty account. It converts the UI's scaled tokens/cents to displayed tokens/USD, validates requests, and forwards no browser credentials. Position analysis for other assets and halted/frozen corporate-action positions is labelled unsupported; stock health for QQQb and SPCXb is available in the Risk page overview. Backend prices and expired historical evidence are shown explicitly. Advice and unsigned router proposals require review and never change simulated balances or execute transactions.

Use Node 24 (`.nvmrc`). `npm test`, `npm run typecheck`, and `npm run build` verify the frontend. With both services running, `npm run test:integration` checks real HTTP integration; add `-- --live-status` to require successful live public sources too. Real secrets belong only in private env files or deployment secret stores; never commit them or put them in `NEXT_PUBLIC_` variables.

ConnectKit connects browser wallets on BNB Smart Chain. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building to enable WalletConnect QR codes and mobile wallet linking. Connecting a wallet leaves the simulated balances and actions independent of that wallet.

The Risk page also reads `/api/risk/overview`, proxied to `GET /risk/overview`. The backend discovers configured asset aliases and shares baseline assessments for 5 seconds per service process. It returns evidence timestamps, simulated/live flags, health (`100 − risk score`), risk category, confidence, data limitations, and explained factor scores. One asset failure leaves other rows available. NVIDIA, QQQ and SpaceX have distinct default synthetic assessment profiles. SpaceX uses hypothetical exchange-calendar, token-backing and oracle assumptions, explicitly labelled in its row. Other listed stocks display “No coverage” until a matching backend asset/provider is configured. The browser refreshes every 5 seconds while visible, refreshes on return, prevents overlapping requests, and labels failed refreshes and evidence older than 20 seconds. Manual refresh uses the same backend cache. Refresh cadence does not imply live market inputs; defaults remain simulated.
