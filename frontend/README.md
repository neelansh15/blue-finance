# Blue Finance frontend

Next.js (App Router, TypeScript) frontend for the Blue Finance demo, with a server-side connection to the Python advisory risk API.

```
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run start   # serve the production build
```

## Onchain demo app

Earn, Borrow, Dashboard, Risk and Simplified Mode under `/app` read and write the [deployed BluePool](../protocol/README.md#bnb-mainnet-deployment) on BNB Smart Chain. Reads work without a wallet. Writes use the connected wallet, simulate each call before signing, wait for the receipt and link to BscScan. The [deployment reference](src/lib/blue/deployment.ts) is published at `/docs/deployment`.

| Page | Live behaviour |
|---|---|
| `/app/earn` | The shared USDT reserve: balances, liquidity, supply cap, onchain rates, Supply and Withdraw |
| `/app/borrow` | Five collateral markets, positions, borrowing gates, eligibility, collateral supply and withdrawal, borrow and repay |
| `/app/dashboard` | The connected wallet’s positions |
| `/app/risk` | Contract risk metrics, followed by clearly labelled synthetic advisory scenarios |
| `/app/simplified` | Five-step borrow, supply or leveraged borrow with a confirmed summary. All three use the pool the rest of the app uses |

Shared logic lives in [`app/app/live`](app/app/live) and [`src/lib/blue/live-position.ts`](src/lib/blue/live-position.ts).

### Eligibility proxy

Set the server-only `BLUE_ELIGIBILITY_URL` and `BLUE_ELIGIBILITY_API_TOKEN` to enable **Request eligibility** on Borrow and Simplified. Both point to the [keeper and eligibility service](../keepers/README.md#bnb-mainnet-keeper-and-eligibility-service). Without them the request reports that the service is not configured.

### Leveraged borrowing

Leverage in Simplified Mode sends real transactions on whichever pool the app uses. The live pool swaps on PancakeSwap v3. The demo pool’s test tokens swap on [`DemoSwapRouter`](../protocol/src/mocks/DemoSwapRouter.sol), which fills at the oracle price plus 0.25% from tokens minted to it.

The demo admin deploys and stocks that contract once, in one signature. The ticket says leverage is not open until it exists.

    (cd ../protocol && forge build)
    (cd ../keepers && pnpm demo-swap)   # then open http://127.0.0.1:9547

An increase borrows USDT, buys more of the same stock and supplies it. A reduction withdraws, sells and repays. [`live-leverage.ts`](src/lib/blue/live-leverage.ts) plans the calls and [`swap.ts`](src/lib/blue/swap.ts) holds the router, quoter and fee tiers.

| Rule | Value |
|---|---|
| Product cap | 2×, less when the market status lowers the borrow LTV |
| Swaps | Exact output, spending at most the quote plus 0.5%, valid for 180 seconds. Unspent tokens stay in the wallet |
| Price guard | No plan when the swap price is more than 2% worse than the oracle price |
| One click | One atomic EIP-5792 batch, simulated with `eth_simulateV1` before the wallet is asked |
| Batch size | At most 10 calls, MetaMask’s default limit: about two borrow rounds, so a lower maximum than step by step |
| Step by step | Up to five rounds, one transaction per call. A stopped run offers to repay or resupply what the last step left in the wallet |

A borrow needs everything an ordinary borrow does: USDT liquidity, healthy keeper reports, fresh prices and eligibility. Flash loans are disabled in the pool.

To simulate an open and a close against current BNB Chain state, without signing or sending anything:

    BLUE_RUN_LIVE_SMOKE=true NEXT_PUBLIC_BLUE_DEPLOYMENT=real npm test -- src/lib/blue/live-leverage.smoke.test.ts

### Operator workspace

[`/app`](http://localhost:3000/app) keeps the manual keeper and signer actions for the operator wallet:

1. Supply some USDT to the reserve. Hold and supply the selected bStock in the borrower wallet. Enable it as collateral if needed.
2. Open **Demo operator**. Refresh the selected stock and USDT prices as their feeds update. After confirming the stock is healthy, submit a healthy report every 5–8 minutes for at least 30 minutes. A gap of 10 minutes resets recovery. A halt, a guardian hold or an unusable price blocks new borrowing.
3. Choose **Register my eligibility** and approve the typed message and registration transaction. Eligibility lasts two hours when registered this way.

The deployment seeded zero liquidity. There is no liquidation bot. The contracts use prototype limits and have not been audited.

The public BNB RPC defaults to PublicNode. To use another browser-accessible BNB mainnet RPC, set `NEXT_PUBLIC_BSC_RPC_URL` before starting or building the app. This setting is exposed to browsers. Keep credentials out of it.

## Mock test tokens

These tokens are on BNB Smart Chain mainnet for testing. They are not Binance bStocks or Tether's USDT, have no value. The live pool does not accept them. The demo pool below lists them. The admin wallet owns them and can mint more.

| Token | Address |
|---|---|
| mUSDT | [`0x7698257D4200A2d3E6A47Ce3BBffEb3aEe0445f9`](https://bscscan.com/token/0x7698257D4200A2d3E6A47Ce3BBffEb3aEe0445f9) |
| mTSLAB | [`0xA75f781454764A3E50B9381f7e4A68e617D2a1c8`](https://bscscan.com/token/0xA75f781454764A3E50B9381f7e4A68e617D2a1c8) |
| mNVDAB | [`0xCfA61BEb931eF2E20e7a017C47f1c494a2556e89`](https://bscscan.com/token/0xCfA61BEb931eF2E20e7a017C47f1c494a2556e89) |
| mQQQB | [`0xA93364Cf343495846fC2a89D54f90452FEfD5b91`](https://bscscan.com/token/0xA93364Cf343495846fC2a89D54f90452FEfD5b91) |
| mSPCXB | [`0x1871c0511AC66Ee8D153932A620cCCb9AB6E69F8`](https://bscscan.com/token/0x1871c0511AC66Ee8D153932A620cCCb9AB6E69F8) |
| mGOOGLB | [`0x6Dd6fd3f283233aF264aa3958F7Fef2b0d8ef09B`](https://bscscan.com/token/0x6Dd6fd3f283233aF264aa3958F7Fef2b0d8ef09B) |

## Demo pool

`protocol/script/deploy-demo.sh` deploys a second pool that lists the mock tokens above and prices them from the same feeds as the live pool. The current one is at [`0xBee284aAFe856280D3212fe3260b81fE2702BE03`](https://bscscan.com/address/0xBee284aAFe856280D3212fe3260b81fE2702BE03). The script records the addresses in `src/lib/blue/demo-deployment.json`. Once that file holds a record, `/app` uses the demo pool and says so on the page. Set `NEXT_PUBLIC_BLUE_DEPLOYMENT=real` before starting or building to use the live pool, for example to withdraw funds supplied there. The keeper and eligibility service (`keepers/src/v3`) watches the demo pool too, and `BLUE_DEPLOYMENT=real` switches it back.

## Simulator

Open [`/app/simulator`](http://localhost:3000/app/simulator) for a pre-funded walkthrough with no wallet or gas. Its balances never appear on the live pages. For the scenario controls, use `/app/simulator?dev=1` or Shift+D.

## Connected risk analysis

See [local setup and optional API registration](../docs/local-development.md). Start the Python backend, copy `.env.example` to the ignored `.env.local`, and set the server-only `RISK_API_URL` (default example: `http://127.0.0.1:8000`). Visit `/app/risk` or open the assessment panel on `/app/borrow` or `/app/simulator`. No API keys are needed for synthetic assessments or the public Nasdaq/Binance status check.

The proxy accepts a single explicit NVDA demo position or an empty account. It converts the UI's scaled tokens/cents to displayed tokens/USD, validates requests, and forwards no browser credentials. Position analysis for other assets and halted/frozen corporate-action positions is labelled unsupported; stock health for QQQb and SPCXb is available in the Risk page overview. Backend prices and expired historical evidence are shown explicitly. Advice and unsigned router proposals require review and never change simulated balances or execute transactions.

Use Node 24 (`.nvmrc`). `npm test`, `npm run typecheck`, and `npm run build` verify the frontend. With both services running, `npm run test:integration` checks real HTTP integration; add `-- --live-status` to require successful live public sources too. Real secrets belong only in private env files or deployment secret stores; never commit them or put them in `NEXT_PUBLIC_` variables.

ConnectKit connects browser wallets on BNB Smart Chain. Set `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` before building to enable WalletConnect QR codes and mobile wallet linking. The simulator keeps its balances in the browser. Run `BLUE_RUN_LIVE_SMOKE=true npm test -- src/lib/blue/live-state.test.ts` to check the deployed read path over the public RPC.

The Risk page also reads `/api/risk/overview`, proxied to `GET /risk/overview`. The backend discovers configured asset aliases and shares baseline assessments for 5 seconds per service process. It returns evidence timestamps, simulated/live flags, health (`100 − risk score`), risk category, confidence, data limitations, and explained factor scores. One asset failure leaves other rows available. NVIDIA, QQQ, SpaceX, Tesla and Alphabet have distinct default synthetic assessment profiles. SpaceX uses hypothetical exchange-calendar, token-backing and oracle assumptions, explicitly labelled in its row. Other listed stocks display “No coverage” until a matching backend asset/provider is configured. The browser refreshes every 5 seconds while visible, refreshes on return, prevents overlapping requests, and labels failed refreshes and evidence older than 20 seconds. Manual refresh uses the same backend cache. Refresh cadence does not imply live market inputs; defaults remain simulated.
