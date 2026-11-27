# Blue keepers

## BNB Mainnet keeper and eligibility service

`pnpm bnb-automation` serves eligibility and runs the keeper for the deployed Aave V3 pool. The worker checks Nasdaq halts, Binance bStock status, the onchain calendar and token multipliers. It refreshes USDT and stock prices when needed and reports healthy stocks every four minutes. Failed or unknown checks stop healthy reports and reset the affected stock's recovery. A confirmed halt or corporate action can place a short calendar override. A price discontinuity or changed multiplier requires admin review before accepting a new reference.

### Set up the roles once

1. Create dedicated keeper and eligibility signer accounts. Fund the keeper with BNB for recurring transactions. The signer only signs messages off-chain. Use the existing guardian address and keep the admin on MetaMask.
2. As the admin, call `StockBorrowControls.setRoles(keeper, guardian, signer)`, `MarketCalendar.setKeeper(keeper, true)`, and `StockPriceSource.setRoles(keeper, guardian)` on the USDT and each enabled stock price adapter. The [deployment registry](src/v3/bsc-mainnet.json) lists the addresses. Review and approve the role transactions in MetaMask. Role assignments are verified at startup.
3. Start one always-on Render **Web Service**, with the repository root as its Root Directory so it can read the deployment registry. Use `corepack pnpm --dir keepers install --frozen-lockfile --prod=false` for Build Command and `corepack pnpm --dir keepers bnb-automation` for Start Command. Set the health check path to `/healthz`. Use a plan with continuous uptime and keep the service at one instance so the keeper nonce stays sequential.
4. Set the variables from [`.env.bnb.example`](.env.bnb.example) in the worker's environment settings. Add only intended demo wallets to `BLUE_ELIGIBLE_ACCOUNTS`. Optionally set `BLUE_KEEPER_MARKETS` to a comma-separated subset to limit gas spending. Put keys and the random API token directly into Render's secret environment settings.
5. In the frontend's server environment, set `BLUE_ELIGIBILITY_URL` to the worker's HTTPS origin and `BLUE_ELIGIBILITY_API_TOKEN` to the same random token. Borrowers then select **Request eligibility** for their stock on Borrow or Simplified Mode. The service signs for the current nonce, and the wallet approves the onchain registration. Eligibility expires after one hour or the contract's lower maximum.

The first report cycle starts four minutes after the service starts. A stock becomes borrowable after 30 minutes of healthy reports, provided the shared USDT reserve has liquidity. Allowlisted wallets still need BNB, eligible bStock collateral and enough USDT to cover repayment and interest. The keeper needs recurring BNB. Watch service logs and fund that account as needed. The service does not liquidate loans.

The service watches the [demo pool](src/v3/bsc-demo.json), which lists test tokens. Set `BLUE_DEPLOYMENT=real` to watch the [live pool](src/v3/bsc-mainnet.json). Both pools use the same keeper wallet, so run one service at a time.

## Aave pool keeper

[`src/blueKeeper.ts`](src/blueKeeper.ts) serves the current BNB deployment. It is a dry run unless `DRY_RUN=false`.

This keeper and the eligibility service above use the same keeper wallet, so run only one of them for a pool at a time.

    pnpm blue-keeper --once       # one pass, nothing sent
    RISK_API_URL=https://blue-risk-controller.onrender.com pnpm blue-keeper

| Each tick | Transaction |
|---|---|
| A stock or USDT source stopped passing and has a new valid round | `refresh()` |
| Nasdaq and Binance status are ok and both prices are usable | `report(stock, true)`, every 5 minutes |
| Either source shows a halt or corporate action | `setOverride(stock, HALTED)`, renewed near expiry; `report(stock, false)` if refused |
| A status source is unknown | None. Borrowing closes when the last heartbeat is 10 minutes old |

It never calls `suspend()` or sets `CORP_ACTION`, since both stop liquidations. A corporate action is logged as `corp_action_needs_review`. A price move over the continuity limit shows as `DiscontinuousPrice` and needs the admin. Risk API scores are logged as `risk_advisory` and cause no transaction unless risk actions are on.

| Var | Default | Meaning |
|---|---|---|
| RPC_URL | `https://bsc-rpc.publicnode.com` | BNB Chain JSON-RPC |
| KEEPER_ADDRESS | `0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A` | Keeper wallet, also the guardian |
| DRY_RUN | true | only `false` or `0` sends transactions |
| KEEPER_PRIVATE_KEY | - | key for KEEPER_ADDRESS, required when live |
| POLL_INTERVAL_MS | 30000 | loop period |
| REPORT_INTERVAL_S | 300 | heartbeat period, must stay under 600 with two polls |
| OVERRIDE_DURATION_S / OVERRIDE_REFRESH_MARGIN_S | 3600 / 600 | halt length and renewal margin |
| RISK_API_URL | - | risk API to poll; `run-keeper.sh` sets the hosted one |
| RISK_ACTIONS | off | `true` lets scores tighten borrowing |
| RISK_POLL_S | 300 | seconds between polls |
| RISK_CONFIRMATIONS | 3 | consecutive readings that must all reach a level |
| RISK_MAX_AGE_S | 900 | older evidence is ignored; must exceed RISK_POLL_S |
| RISK_ALLOW_SIMULATED | off | counts simulated scores; refused unless `BLUE_DEPLOYMENT=demo` |

A dry run simulates `refresh` and halts as the currently appointed keeper. A `report` that depends on an unsent refresh is logged without simulation.

### Risk actions

| Category on every recent reading | Keeper action |
|---|---|
| LOW, MODERATE | None |
| ELEVATED | `setOverride(stock, CLOSED)` when the current status is looser |
| HIGH | `setOverride(stock, WEEKEND)` when the current status is looser |
| CRITICAL | `report(stock, false)` once, then no heartbeat |

The mildest level among the last readings applies, so with the defaults the keeper acts after about 10 minutes of agreeing readings and stops after one lower reading. An override already onchain runs until it expires (`OVERRIDE_DURATION_S`), since the keeper cannot clear it, and is renewed while the risk persists. After a pause, borrowing needs the 30-minute recovery again.

Simulated, stale or unavailable results never cause a transaction on the live pool, and an API outage never does. The hosted API currently marks all its results simulated, so on the live pool risk actions change nothing yet. The keeper never raises limits or caps from a score.

### Run it live

    ./run-keeper.sh            # sends real transactions
    ./run-keeper.sh --dry-run  # needs no key
    ./run-keeper.sh --forget   # delete the stored key
    ./run-keeper.sh --risk     # live, with risk actions on
    ./run-keeper.sh --demo --risk --dry-run   # demo pool, simulated scores count

The first live run asks for the keeper private key and stores it in the macOS Keychain. Programs running as your user can read it from there. The script keeps the Mac from idle sleeping; closing the lid still stops the heartbeat.

On the demo pool, transactions go to its test tokens while Nasdaq and Binance status is read for the real bStocks, so a real halt also halts the demo stock.

### Move the keeper and guardian roles

[`scripts/rotateKeeper.ts`](scripts/rotateKeeper.ts) sets `0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A` as keeper and guardian in one atomic batch of nine calls.

    pnpm rotate-keeper --check    # simulate only
    pnpm rotate-keeper            # serves http://127.0.0.1:9546; sign with the admin wallet
    pnpm rotate-keeper --verify   # confirm every role onchain

The wallet must support `wallet_sendCalls` (EIP-5792) on BNB Chain. The new keeper then needs BNB for gas.

**`0x08DcE649f86AF45dA8648FaD31D1C33A617C52d1` is compromised (November 27, 2026). Do not fund it or give it a role.**

While one wallet is both keeper and guardian, its key must sit with the running bot, so a leaked key exposes both roles.

## Earlier Morpho prototype

The commands and environment variables below apply to the previous Morpho prototype.

    pnpm install && pnpm test          # unit tests
    pnpm smoke                         # live Binance bapi / Spot / Nasdaq RSS, prints parsed signals (--all for every bStock)
    pnpm regime-keeper                 # DRY_RUN by default
    pnpm liquidation-bot               # DRY_RUN by default
    pnpm demo regime set <asset> WEEKEND --duration 600

## Layout
- `src/abi.ts` - the only place with ABI fragments (synced with protocol-old/src/*.sol) plus the Regime enum and conservativeness order.
- `src/session.ts` - pure `sessionRegime(ts)` (America/New_York via Intl), holiday and early-close tables 2026-2027.
- `src/halt/` - sources (`nasdaq`, `binanceBapi`, `binanceSpot`, `multiplierWatcher`), `continuity`, and `combiner`.
- `src/liquidationBot.ts` - Morpho Blue liquidation bot (see below).
- `src/regimeKeeper.ts` - pure `planActions` + `tickAsset` + loop.  `src/demoControl.ts` - demo CLI.

## Regime keeper env
| Var | Default | Meaning |
|---|---|---|
| RPC_URL | required | JSON-RPC |
| CHAIN_ID | 56 | 56 uses viem bsc, anything else a generic chain (anvil fork etc.) |
| REGIME_REGISTRY | required | RegimeRegistry address |
| ASSETS | required | JSON array `[{"symbol":"TSLAB","ticker":"TSLA","token":"0x..","feed":"0x..","oracle":"0x..","spotSymbol":"TSLABUSDT"}]`; `oracle` (BlueOracle) enables the `update()` heartbeat; `feed` (Atlas or mock) is needed for the continuity check, `spotSymbol` defaults to `<symbol>USDT` |
| KEEPER_PRIVATE_KEY | - | holds KEEPER role; required only when DRY_RUN=false |
| DRY_RUN | true | only the exact value `false` (or `0`) sends txs |
| POLL_INTERVAL_MS | 30000 | loop period (Nasdaq RSS is still fetched at most once per 60 s) |
| OVERRIDE_DURATION_S / OVERRIDE_REFRESH_MARGIN_S | 3600 / 600 | override length, refresh when closer than this to expiry |
| UNKNOWN_TIMEOUT_MS | 600000 | a source unknown this long moves the asset to HALTED |
| CONTINUITY_BAND_BPS / CONTINUITY_MAX_AGE_MS | 500 / 900000 | clear gate: price band and max print age |
| CALENDAR_GRACE_MS | 90000 | local calendar only pushed if stable over this window (avoids flapping vs the chain clock at boundaries) |
| FEED_QUOTES_PER_UI | true | feed quotes per UI share, so raw price = feed x uiMultiplier |
| MULTIPLIER_HOLD_MS | 3600000 | multiplier watcher reports corp_action until effectiveAt + this |
| ORACLE_UPDATE_INTERVAL_MS | 60000 | min time between BlueOracle `update()` calls per asset (permissionless; dry run only logs) |
| REBASE | - | comma list of symbols whose current price becomes the continuity reference at start |

## Behaviour
- Combiner: any non-ok signal latches HALTED or CORP_ACTION (HALTED wins; no downgrade). Clearing needs every source ok (none unknown) AND the continuity check (fresh print newer than the latch, within band of the pre-event reference). Unknown never clears; unknown for UNKNOWN_TIMEOUT_MS latches HALTED.
- Keeper: desired = max(on-chain calendar, local calendar, signal). Sets an override only when it is more conservative than the on-chain calendar; de-escalation is `clearOverride` then `setOverride`; clears when nothing needs it. On first sight of an active HALTED/CORP_ACTION override the latch is seeded, so a restart cannot clear blindly.

- Registry rules honoured: overrides are never OPEN; a global override (asset address(0)) is read and counts as a floor, so no asset override is set when it already covers the need; a new override while one is active is at least as conservative and its duration is stretched so it does not expire earlier (capped at MAX_OVERRIDE). Relaxing needs `clearOverride`, which the keeper only calls when `keeperCanClear` is true; otherwise it logs `override_wait` (let it expire or ask the admin to clear). The keeper never writes the global override (demo CLI can: `regime set global HALTED`).
- Oracle heartbeat: after the regime step each tick, `BlueOracle.update()` is called (throttled by ORACLE_UPDATE_INTERVAL_MS); dry run logs it as `dry_run_tx` kind oracleUpdate.
- Calendar: `sessionRegime` mirrors `RegimeRegistry.calendarRegimeAt` (overnight before a holiday or after a Friday/early-close Friday is WEEKEND, Sunday 20:00 before a Monday holiday is WEEKEND, early close 13:00 OPEN end, 17:00 EXTENDED end). Holiday tables are local; the on-chain tables are set by the admin, mismatches are logged as `calendar_mismatch`.
- Demo CLI: `multiplier <mockBStock> <v> [--at ts]` calls `setUIMultiplierNow` / `setUIMultiplier`; `price` calls `setAnswer`; `oracle update <oracle>`.
- `UIMultiplierUpdated` uses the 3-arg form `(old, new, effectiveAt)` (matches MockBStock and the real token).
- The continuity metric assumes the Atlas feed quotes per UI share (FEED_QUOTES_PER_UI, same flag as the oracle's feedPerUIShare).
- Binance bapi `reasonMsg` is mapped by a fixed list (stock_split, cash_dividend, stock_dividend, merger, acquisition, spinoff, reverse_split); any other ASSET_PAUSED/MARKET_PAUSED is HALTED. ASSET_PAUSED has not been observed live.
- The multiplier watcher does not use the BSC `pendingMultiplier` views (return shapes not verified on the real token).

## Liquidation bot
Env: RPC_URL, CHAIN_ID(56), MORPHO (default 0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a), MARKET_PARAMS (JSON loanToken, collateralToken, oracle, irm, lltv), LIQUIDATOR (deployed `protocol-old/src/LiquidatorCallback.sol`, owned by the bot key), SWAPPER + SWAP_DATA (optional; absent = repay from loan token pre-funded in the callback contract), SEED_BORROWERS, FROM_BLOCK / LOOKBACK_BLOCKS / LOG_CHUNK, DRY_RUN (default true), LIQUIDATOR_PRIVATE_KEY or KEEPER_PRIVATE_KEY, MIN_PROFIT, DUST_BORROW, MAX_REPAY (raw loan units), LIQUIDATE_WHEN_FROZEN (default false), POLL_INTERVAL_MS.
- Borrowers come from Borrow events for the market id plus the seed list. Health uses Morpho's rounding and the oracle `price()`; positions with no debt are dropped until a new Borrow event.
- Skips everything while the oracle `isFrozen()` (or the call fails) unless LIQUIDATE_WHEN_FROZEN=true. Live mode runs an eth_call simulation before every send.
- Full repay by shares when the collateral covers it, all collateral by seized assets for bad debt, partial by seized assets when capped by MAX_REPAY or the pre-funded balance. Profit is gross (seized value at oracle price minus repay) before swap slippage and gas, so set MIN_PROFIT accordingly.
- Interest accrued since the last market update is not simulated off-chain; a borderline position may be seen as healthy one tick late.
