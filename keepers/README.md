# Blue keepers

## BNB Mainnet keeper and eligibility service

`pnpm bnb-automation` serves eligibility and runs the keeper for the deployed Aave V3 pool. The worker checks Nasdaq halts, Binance bStock status, the onchain calendar and token multipliers. It refreshes USDT and stock prices when needed and reports healthy stocks every four minutes. Failed or unknown checks stop healthy reports and reset the affected stock's recovery. A confirmed halt or corporate action can place a short calendar override. A price discontinuity or changed multiplier requires admin review before accepting a new reference.

### Set up the roles once

1. Create dedicated keeper and eligibility signer accounts. Fund the keeper with BNB for recurring transactions. The signer only signs messages off-chain. Use the existing guardian address and keep the admin on MetaMask.
2. As the admin, call `StockBorrowControls.setRoles(keeper, guardian, signer)`, `MarketCalendar.setKeeper(keeper, true)`, and `StockPriceSource.setRoles(keeper, guardian)` on the USDT and each enabled stock price adapter. The [deployment registry](src/v3/bsc-mainnet.json) lists the addresses. Review and approve the role transactions in MetaMask. Role assignments are verified at startup.
3. Start one always-on Render **Web Service**, with the repository root as its Root Directory so it can read the deployment registry. Use `corepack pnpm --dir keepers install --frozen-lockfile --prod=false` for Build Command and `corepack pnpm --dir keepers bnb-automation` for Start Command. Set the health check path to `/healthz`. Use a plan with continuous uptime and keep the service at one instance so the keeper nonce stays sequential.
4. Set the variables from [`.env.bnb.example`](.env.bnb.example) in the worker's environment settings. Add only intended demo wallets to `BLUE_ELIGIBLE_ACCOUNTS`. Optionally set `BLUE_KEEPER_MARKETS` to a comma-separated subset to limit gas spending. Put keys and the random API token directly into Render's secret environment settings.
5. In the frontend's server environment, set `BLUE_ELIGIBILITY_URL` to the worker's HTTPS origin and `BLUE_ELIGIBILITY_API_TOKEN` to the same random token. The eligibility proxy from commit `8e5b1c3` must be integrated with the restored frontend before enabling the borrower flow. Once integrated, borrowers select **Request eligibility** for their stock. The service signs for the current nonce, and the wallet approves the onchain registration. Eligibility expires after one hour or the contract's lower maximum.

The first report cycle starts four minutes after the service starts. A stock becomes borrowable after 30 minutes of healthy reports, provided the shared USDT reserve has liquidity. Allowlisted wallets still need BNB, eligible bStock collateral and enough USDT to cover repayment and interest. The keeper needs recurring BNB. Watch service logs and fund that account as needed. The service does not liquidate loans.

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
