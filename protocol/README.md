# Aave V3 protocol

[Architecture v3](../architecture-v3.md) describes the Blue-operated Aave V3 pool. This prototype pins **Aave V3 Origin 3.6.0**. The earlier Morpho demo lives in [protocol-old](../protocol-old/README.md). The two projects build independently.

`src/` holds only the contracts that go to mainnet. They work with the real bStock tokens, Atlas feeds, and USDT on BNB Chain. Test tokens and test feeds live in `test/utils/` and are never deployed.

## Design

- Lenders receive bluTokens (bluUSDT), Blue’s name for Aave aTokens. Borrower debt is recorded in bluDebtUSDT, an Aave variable debt token.
- The Aave Pool has one borrowable USDT reserve shared by five collateral-only bStock reserves: TSLAB, NVDAB, QQQB, SPCXB, and GOOGLB. Enable isolated stock collateral explicitly after supplying it.
- The pool checks the debt owner’s signed eligibility, the stock’s current borrow permission, the LTV for the stock’s current market status, and USDT caps. A pause or missed heartbeat blocks new borrowing against that stock. Repayment stays available. A missed heartbeat alone still lets borrowers withdraw collateral within the current LTV when the price is valid, as on Zona. A halt, corporate action, or guardian hold blocks withdrawals while the account has debt. Flash loans are disabled in the prototype.
- Aave isolation enforces one active stock per account. Blue accounts for each stock’s accrued USDT debt using Aave’s scaled debt and current reserve index. Repayment and liquidation reconcile that balance, including debt burned when liquidation records a deficit.
- Pricing follows Zona Lend. Health and liquidation read the live Atlas round when it is under 24 hours old, inside a fixed price band per stock (about 1/10 to 10 times the November 2026 price), uses the multiplier of the last accepted price, and the stock is not in `CORP_ACTION`. A real gap therefore reaches liquidators immediately. New borrowing also needs the keeper to have accepted the round within 2 hours. A move of more than 20% stops new loans until the admin calls `acceptReference()`.
- **The demo prices every stock with Atlas alone.** `StockPriceSource` also supports an optional second feed that must agree with Atlas before new borrowing (never for liquidation). It is off in `script/BscMainnet.sol`. [`script/AproCrossCheck.sol`](script/AproCrossCheck.sol) holds an APRO setup for TSLAB, NVDAB, QQQB, and SPCXB, but APRO feeds only answer contracts APRO has whitelisted, so it stays out of the deployment until APRO whitelists Blue.
- Set `CORP_ACTION` on the calendar before a known split. Otherwise a feed that updates before the multiplier looks like a crash and can trigger liquidations. A changed multiplier stops pricing until the admin accepts a round that reflects it.
- USDT is priced from Chainlink’s USDT/USD feed, valued within $0.90 to $1.10. The feed updates at least every 15 minutes, so a round over an hour old stops new borrowing. Valuation accepts rounds up to 24 hours old.
- Before launch: calibrate the risk parameters in `script/BlueV3Deployment.sol`, confirm with Atlas which feed instances Blue should use, decide on a second price source, integrate the keepers, and complete a security review. See [License](#license).

## BNB Chain listing

[`script/BscMainnet.sol`](script/BscMainnet.sol) holds the addresses below, checked on-chain on November 27, 2026. Atlas bStock feeds quote per raw token, and every feed has 8 decimals.

| Asset | Token | USD feed |
|---|---|---|
| TSLAB | `0x5b1910eAaD6450E50f816082Aa078C41F10C292f` | `0xf569C3e52e797219eCFDc1659c3250B0BbDC693C` (Atlas) |
| NVDAB | `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` | `0x2bd759006b423BFF444181A13C96a6b134E557BB` (Atlas) |
| QQQB | `0x205812CdBed920aFf76C6580abD681a46D11efc7` | `0xA94918f11c9e7703426CCD494A4a999924942DDD` (Atlas) |
| SPCXB | `0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1` | `0xdf8b61796436eD39F406623aa2166a7f185185Cb` (Atlas) |
| GOOGLB | `0x3F53De71c126BdaBAe20f9cD64848d317f6C3238` | `0x9A47A6560E224a26F663675D5c76888A26cac6C3` (Atlas) |
| USDT | `0x55d398326f99059fF775485246999027B3197955` | `0xB97Ad0E74fa7d920791E90258A6E2085088b4320` (Chainlink USDT/USD) |

The Atlas feed addresses are the instances Lista lists, and reads are open to any caller. The bStock issuer can pause a token or change its compliance rules, which would block supply, withdrawal, and liquidation transfers.

## Market status

`MarketCalendar` gives each stock one status at a time. The status sets that stock’s borrowing discount and debt cap.

| Status | Meaning | New borrowing |
|---|---|---|
| `OPEN` | Regular US session, 9:30am to 4:00pm ET | Full limit |
| `EXTENDED` | Pre-market and after-hours | Discounted limit |
| `CLOSED` | Weekday overnight | Discounted limit |
| `WEEKEND` | Weekends and exchange holidays | Lowest limit |
| `HALTED` | Trading halt set by the keeper or admin | Blocked |
| `CORP_ACTION` | Split or other corporate action in progress | Blocked |

The schedule comes from the on-chain US Eastern calendar. The keeper or admin can apply a stricter status for a limited time, never a looser one.

The BNB deployment seeds NYSE holidays and early closes from November 26, 2026 through 2028 from [`script/UsMarketHolidays.sol`](script/UsMarketHolidays.sol). The admin must add later years and any unscheduled closure.

## Admin and roles

| Role | Rights | How to replace it |
|---|---|---|
| Admin | The Aave pool (addresses provider owner, ACL and pool admin), the calendar, the borrow controls and the price sources | Aave rights: grant the new address in `ACLManager`, then `setACLAdmin` and `transferOwnership` on the provider. Blue contracts: `transferAdmin` on the calendar, then `acceptAdmin` from the new admin |
| Keeper | Reports stock health, refreshes prices and sets stricter market statuses | `setKeeper` on the calendar, `setRoles` on the borrow controls and on each price source |
| Guardian | Holds a stock, lowers its caps and suspends a price source | `setRoles` on the borrow controls and on each price source |
| Signer | Signs borrower eligibility | `setRoles` on the borrow controls. Approvals from the previous signer stop counting |

The borrow controls and price sources read their admin from the calendar, so one calendar handover moves them all. The bluToken treasury is set to the admin at deployment. Changing it needs a bluToken upgrade.

## Build and test

From this directory with Foundry and npm installed:

```sh
npm ci
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build
forge test
```

| Suite | What it covers |
|---|---|
| `BluePoolTest` | Offline scenarios with test bStocks, test feeds, and test USDT, so halts, splits, and price gaps can be scripted. |
| `BluePoolBnbForkTest` | The same scenarios with real USDT in a local BNB mainnet fork. |
| `BscMainnetForkTest` | The real launch: all five bStocks, their Atlas feeds, Chainlink USDT/USD, the admin handover, the keeper and holiday setup. A TSLAB loan goes through supply, borrow, repay, and withdraw. |
| `UsMarketHolidaysTest` | The seeded NYSE holidays and early closes. |
| `AproCrossCheckForkTest` | The optional APRO module against live feeds: it agrees with Atlas once whitelisting is simulated, and refuses contracts APRO has not whitelisted. |

The fork suites are skipped unless you enable them and point `BSC_RPC_URL` at a BNB mainnet RPC:

```sh
BLUE_RUN_BNB_FORK_TESTS=true forge test -vv
```

They deploy in Foundry’s local fork against live state and send nothing to BNB mainnet.


## BNB mainnet deployment

The hackathon pool deployed on November 27, 2026 to BNB Smart Chain, chain ID 56. All 59 deployment transactions succeeded. The deployment seeded zero USDT. The main account holds the admin and eligibility signer roles. The keeper and guardian roles belong to `0x68c09dcC4d11D7974BA3E8e96D69CED9C31e733A`, moved there with [`rotateKeeper.ts`](../keepers/scripts/rotateKeeper.ts). The earlier holder, `0x08DcE649f86AF45dA8648FaD31D1C33A617C52d1`, is compromised.

| Contract | Address |
| --- | --- |
| BluePool proxy | `0xDAC47642621B0C3E4191Fe68281EddAC355f12bC` |
| PoolAddressesProvider | `0x1AfE5e07f6c6f092494DA8423708c412939B6906` |
| PoolConfigurator proxy | `0x6F858Bd70D123d1a4767Db66bcdDE07817f391CE` |
| Pool data provider | `0xa7db8d9e04c466126d58379fcfab2ae0f26a7643` |
| StockBorrowControls | `0x9F80DEe6652798855133358a382264986C2A5d4D` |
| MarketCalendar | `0x33CcEcEDA8f2f47BdE9f234FF025977aeB292B17` |
| AaveOracle | `0x727D5D5001717e7F5fAC98c5b134B27487192e4d` |

[First deployment transaction](https://bscscan.com/tx/0xc84e46923f3b27e8e038716ac4aa6006a6fa9bd0d3b28fe0bcee0ce43ffd51ca) · [Final deployment transaction](https://bscscan.com/tx/0x38cf51152ebfed7579b9ebd700c381a622f849115887a0045692113529443cac) · [All 37 deployed contracts](../frontend/src/lib/blue/deployment.ts), published on the docs site at `/docs/deployment` · [Frontend contract configuration](../frontend/src/lib/blue/mainnet.ts) · [Demo walkthrough](../frontend/README.md#onchain-demo-app)

For a future deployment signed by the owner from MetaMask, use [the launcher](script/deploy-bsc-mainnet.sh). It checks chain ID 56 and keeps mainnet recovery files separate from local fork runs.

## Deploy

```sh
anvil --fork-url "$BSC_RPC_URL" --chain-id 56
```

[`script/DeployBsc.s.sol`](script/DeployBsc.s.sol) deploys the real listing. Rehearse on a local Anvil fork first:

In another shell, set `BLUE_ADMIN`, `BLUE_KEEPER`, `BLUE_GUARDIAN`, and `BLUE_SIGNER`. The guardian must differ from both the deployer and the admin. `BLUE_ADMIN` is either the deployer or a contract such as a multisig. Simulate, then repeat with `--broadcast` against the same local RPC:

```sh
forge script script/DeployBsc.s.sol:DeployBsc \
  --rpc-url http://127.0.0.1:8545 --account <local-keystore> --sender <local-deployer>
```

With a multisig admin, the script moves the Aave rights to it in the same run and starts the calendar handover. **The multisig must then call `acceptAdmin()` on the market calendar.** Until it does, the deployer still administers the calendar, borrow controls, and price sources. Check that `admin()` on the borrow controls returns the multisig.

The script checks the chain ID and USDT code, and refuses a non-Anvil RPC unless `BLUE_ALLOW_MAINNET=true`. A mainnet broadcast needs explicit owner approval. Set `BLUE_SEED_USDT` in raw 18-decimal units to seed the reserve if the local deployer already has forked USDT. Otherwise, a funded local account can approve the pool and call `supply` after deployment.

For a deployer preflight, use the public address as `--sender` in a fork simulation. The owner signs the approved mainnet deployment locally with Foundry's `--ledger` or `--trezor` option, or `--browser --slow` for a compatible browser wallet already on BNB Chain (chain ID 56). Rehearse the chosen signing flow before the mainnet run. Browser signing presents a separate approval for each transaction. Keep the seed phrase, private key, and any keystore password local. [Foundry deployment guide](https://www.getfoundry.sh/guides/deploying-contracts) · [Foundry browser signing](https://www.getfoundry.sh/guides/browser-wallet)

The pool admin can pause the pool or individual reserves through the configurator. The deployment assigns the Blue guardian role separately, so the guardian needs an Aave emergency-admin grant to pause or unpause reserves independently. Decide who should hold that authority based on the required response time.

The deployment leaves `UMBRELLA` unset. In the pinned Aave core, only the address registered under that key can cover a reserve deficit, by burning its own aTokens. The addresses-provider owner can register a backstop after deployment. Select and fund the USDT backstop and rehearse covering a deficit before opening borrowing.

For a manual borrow, supply a bStock and enable it as collateral. On an Anvil fork, give the account bStock with `anvil_setStorageAt` or by impersonating a holder. The borrower registers a signature from `BLUE_SIGNER` over `eligibilityDigest(borrower, stock, nonces(borrower), expiry)` on the controls contract. The keeper must report the stock healthy with gaps shorter than 10 minutes for the 30-minute recovery window, and keep its stock and USDT quotes fresh. Call `refresh()` on the price sources to accept new feed rounds. Then call the pool’s standard `borrow` with variable-rate mode `2`. Use `report(stock, false)` to simulate a halt of new risk for just that stock. The calendar admin can set holidays, early closes, and temporary status overrides through `MarketCalendar`. `BscMainnetForkTest` automates this setup.

## License

`BluePool` and the deployment scripts build on Aave V3 Origin 3.6.0, which is licensed under the [Business Source License 1.1](LICENSE-AAVE-V3). The license’s additional use grant permits use subject to its conditions. **On March 6, 2027, or an earlier date the Aave DAO records on `v36.aavelicense.eth`, Aave V3.6 becomes available under the MIT license.** Blue’s own contracts (`StockBorrowControls`, `StockPriceSource`, `MarketCalendar`) and the test tokens are MIT.
