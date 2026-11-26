# Dawn Finance frontend

Next.js (App Router, TypeScript) landing page for the Dawn Finance draft. Static content, no backend.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Demo app (`/app`)

Mocked-data demo UI. Developer controls: `/app?dev=1` or Shift+D. The demo uses the in-memory client in `src/lib/dawn/client.ts` and position math in `src/lib/dawn/math.ts`.

```
npm test        # vitest
```

Haircuts, margin and the continuity band are illustrative placeholders.

ConnectKit connects browser wallets on BNB Smart Chain. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building to enable WalletConnect QR codes and mobile wallet linking. Connecting a wallet leaves the simulated balances and actions independent of that wallet.

## Advisory risk backend

Use Node.js 22.20+ (the locked Vitest/Vite toolchain requires a modern Node runtime).

Start the Python backend in another terminal using `ai-risk-controller/README.md`, then configure the frontend:

```sh
# frontend/.env.local (server-only; never NEXT_PUBLIC_)
RISK_API_URL=http://127.0.0.1:8000
```

Run `npm run dev` and visit `/app/risk`, or expand “Analyse this demo position” on `/app` or `/app/borrow`. For a deployed preview, set `RISK_API_URL` to the separately hosted backend's reachable HTTP(S) origin. Leaving it unset produces a clear service-unavailable message while demo lending continues to work. The backend URL and browser wallet credentials are not sent to clients/upstream respectively.

The same-origin `/api/risk/{operation}/{asset}` proxy allows only advisory POST and market-status GET, normalizes NVDAB to NVDA, bounds and validates request bodies, uses timeouts/no-store caching, and forwards no browser authentication. Requests use the current selected **demo position**, not the connected wallet or backend's synthetic 120-borrower portfolio. An empty account is sent as `borrowers: []`.

The lending account adapter converts collateral units by 10,000 and USDT cents by 100. The `/app` adapter normalizes its WAD balance and UI multiplier; frozen/halted/corporate-action positions are explicitly unsupported until a continuity-aware adapter exists. QQQb and SPCXb remain visible in the market selector but are not assessed by the NVDA-only backend.

Risk results use **backend synthetic scenario prices**, displayed alongside the UI price; they are not a live valuation or a replacement for existing borrow limits. The UI shows target LTV versus immutable LLTV, total caps, exposure restrictions, stress health/shortfalls, issuer evidence, confidence and expiry. Friday/Saturday replays are historical and expired. Pending, failed, unsupported, stale and expired data is displayed explicitly; analysis never changes demo balances or sends transactions. Live Nasdaq/Binance status is fetched separately and does not promote synthetic prices or recommendations into live evidence. Routing remains advisory in the backend; this integration does not select destinations or migrate positions.

Validation:

```sh
npm test
npm run build
```
