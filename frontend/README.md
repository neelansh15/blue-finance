# Blue Finance frontend

Next.js (App Router, TypeScript) frontend for the Blue Finance demo, with a server-side connection to the Python advisory risk API.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Onchain demo app

Open [`/app`](http://localhost:3000/app). The page reads market session, prices, borrow gates, USDT liquidity and wallet positions from the [deployed BluePool](../protocol/README.md#bnb-mainnet-deployment). Reads work without a wallet. Writes use the connected BNB Smart Chain wallet, run a preflight call, and show confirmations and BscScan links.

For a short live demo:

1. Connect a BNB Smart Chain wallet with BNB for gas and some of the [reserve's USDT](https://bscscan.com/token/0x55d398326f99059fF775485246999027B3197955).
2. On **Supply USDT**, enter a small amount, approve the token allowance if prompted, and confirm the supply. Check that available liquidity and your bluUSDT balance increase.
3. Choose **Withdraw USDT** to redeem the supplied amount if sufficient liquidity is available.
4. Select a bStock row to view its session and borrow gate. **Supply stock** and **Withdraw stock** use that token. The position panel shows which stock is active as collateral and offers to enable the selected stock if needed.

For a full live borrow and repay walkthrough, use the wallet that holds the keeper and eligibility signer roles. The initial deployment uses the same wallet for both:

1. Supply some USDT to the reserve. Hold and supply the selected bStock in the borrower wallet. Enable it as collateral if needed.
2. Open **Demo operator**. Refresh the selected stock and USDT prices as their feeds update. After confirming the stock is healthy, submit a healthy report every 5–8 minutes for at least 30 minutes. A gap of 10 minutes resets recovery. A halt, a guardian hold or an unusable price blocks new borrowing.
3. Choose **Register my eligibility** and approve the typed message and registration transaction. Eligibility lasts two hours when registered from the demo. Once the price and keeper checks are ready, borrow a small amount of USDT, then repay it. The wallet needs enough USDT to cover the accrued interest for a full repayment. Withdraw the stock after repayment.

The deployment seeded zero liquidity. The live demo uses manual keeper and signer actions for the operator wallet. It has no continuous keeper, public eligibility service, or liquidation bot. The contracts use prototype limits and have not been audited.

The public BNB RPC defaults to PublicNode. To use another browser-accessible BNB mainnet RPC, set `NEXT_PUBLIC_BSC_RPC_URL` before starting or building the app. This setting is exposed to browsers. Keep credentials out of it.

## Simulator

Open [`/app/simulator`](http://localhost:3000/app/simulator) for a pre-funded walkthrough with no wallet or gas. Simplified, Dashboard, Earn, Borrow and Risk are simulator workspaces. For the original scenario controls, use `/app/simulator?dev=1` or Shift+D.

## Connected risk analysis

See [local setup and optional API registration](../docs/local-development.md). Start the Python backend, copy `.env.example` to the ignored `.env.local`, and set the server-only `RISK_API_URL` (default example: `http://127.0.0.1:8000`). Visit `/app/risk` or open the assessment panel on `/app/borrow` or `/app/simulator`. No API keys are needed for synthetic assessments or the public Nasdaq/Binance status check.

The proxy accepts a single explicit NVDA demo position or an empty account. It converts the UI's scaled tokens/cents to displayed tokens/USD, validates requests, and forwards no browser credentials. Position analysis for other assets and halted/frozen corporate-action positions is labelled unsupported; stock health for QQQb and SPCXb is available in the Risk page overview. Backend prices and expired historical evidence are shown explicitly. Advice and unsigned router proposals require review and never change simulated balances or execute transactions.

Use Node 24 (`.nvmrc`). `npm test`, `npm run typecheck`, and `npm run build` verify the frontend. With both services running, `npm run test:integration` checks real HTTP integration; add `-- --live-status` to require successful live public sources too. Real secrets belong only in private env files or deployment secret stores; never commit them or put them in `NEXT_PUBLIC_` variables.

ConnectKit connects browser wallets on BNB Smart Chain. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building to enable WalletConnect QR codes and mobile wallet linking. The simulator keeps its balances in the browser. Run `BLUE_RUN_LIVE_SMOKE=true npm test -- src/lib/blue/live-state.test.ts` to check the deployed read path over the public RPC.

The Risk page also reads `/api/risk/overview`, proxied to `GET /risk/overview`. The backend discovers configured asset aliases and shares baseline assessments for 5 seconds per service process. It returns evidence timestamps, simulated/live flags, health (`100 − risk score`), risk category, confidence, data limitations, and explained factor scores. One asset failure leaves other rows available. NVIDIA, QQQ, SpaceX, Tesla and Alphabet have distinct default synthetic assessment profiles. SpaceX uses hypothetical exchange-calendar, token-backing and oracle assumptions, explicitly labelled in its row. Other listed stocks display “No coverage” until a matching backend asset/provider is configured. The browser refreshes every 5 seconds while visible, refreshes on return, prevents overlapping requests, and labels failed refreshes and evidence older than 20 seconds. Manual refresh uses the same backend cache. Refresh cadence does not imply live market inputs; defaults remain simulated.
