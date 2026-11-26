# Aave V3 protocol

[Architecture v3](../architecture-v3.md) describes the Blue-operated Aave V3 pool. This prototype pins **Aave V3 Origin 3.6.0**. The earlier Morpho demo lives in [protocol-old](../protocol-old/README.md). The two projects build independently: `protocol/` keeps its own copies of the market calendar, feed interfaces, and mock tokens.

## Prototype

- The Aave Pool has one borrowable USDT reserve shared by five collateral-only mock stock reserves. They are TSLAB, NVDAB, QQQb, SPCXb, and GOOGLb. Enable isolated stock collateral explicitly after supplying it.
- The pool checks the debt owner’s signed eligibility, the stock’s current borrow permission, the LTV for the stock’s current market status, and USDT caps. A pause or missed heartbeat blocks new borrowing against that stock. Repayment stays available. A missed heartbeat alone still lets borrowers withdraw collateral within the current LTV when the price is valid, as on Zona. A halt, corporate action, or guardian hold blocks withdrawals while the account has debt. Flash loans are disabled in the prototype.
- Aave isolation enforces one active stock per account. Blue accounts for each stock’s accrued USDT debt using Aave’s scaled debt and current reserve index. Repayment and liquidation reconcile that balance, including debt burned when liquidation records a deficit.
- Pricing follows Zona Lend. Health and liquidation read the live Atlas round when it is under 24 hours old, inside a fixed price band (1/20 to 20 times the launch price in the prototype), uses the multiplier of the last accepted price, and the stock is not in `CORP_ACTION`. A real gap therefore reaches liquidators immediately. New borrowing also needs the keeper to have accepted the round within 2 hours. A move of more than 20% stops new loans until the admin calls `acceptReference()`.
- Set `CORP_ACTION` on the calendar before a known split. Otherwise a feed that updates before the multiplier looks like a crash and can trigger liquidations. A changed multiplier stops pricing until the admin accepts a round that reflects it.
- The deployed stocks and USD feeds are synthetic. The simulated USDT price also uses a mock feed. Live feed selection, calendar configuration, keeper integration, production release and license, and security review are separate launch work. See [License](#license).

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

## Build and test

From this directory with Foundry and npm installed:

```sh
npm ci
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build
forge test --match-contract '^BluePoolTest$' -vv
```

The offline suite deploys the real Aave lending core with a mock USDT token. To run the same scenarios later on a local fork using BNB USDT, set `BSC_RPC_URL` to a BNB mainnet RPC capable of serving fork state:

```sh
BLUE_RUN_BNB_FORK_TESTS=true forge test --match-contract '^BluePoolBnbForkTest$' -vv
```

The fork suite deploys its own pool in Foundry’s local fork, funds its test accounts with the forked USDT, and sends no transactions to BNB mainnet.

## Deploy to a running local Anvil fork

```sh
anvil --fork-url "$BSC_RPC_URL" --chain-id 56
```

In another shell, set `BLUE_GUARDIAN` to a local address distinct from the deployer. `BLUE_KEEPER` and `BLUE_SIGNER` default to the deployer. First simulate, then repeat with `--broadcast` directed at the same local RPC to persist the deployment:

```sh
forge script script/DeployFork.s.sol:DeployFork \
  --rpc-url http://127.0.0.1:8545 --account <local-keystore> --sender <local-deployer>
```

The script checks chain ID, BNB USDT code, and Anvil’s RPC before deployment. Set `BLUE_SEED_USDT` in raw 18-decimal units to seed the reserve if the local deployer already has forked USDT. Otherwise, a funded local account can approve the pool and call `supply` after deployment.

For a manual borrow on the prototype, mint stock from the test deployer, then supply it and enable it as collateral. The borrower registers a signature from `BLUE_SIGNER` over `eligibilityDigest(borrower, stock, nonces(borrower), expiry)` on the controls contract. The keeper must report the stock healthy with gaps shorter than 10 minutes for the 30-minute recovery window, and keep its stock and USDT quotes fresh. Update the mock feeds and call `refresh()` on their price sources to accept new rounds. Then call the pool’s standard `borrow` with variable-rate mode `2`. Use `report(stock, false)` to simulate a halt of new risk for just that stock. The deployer can set holidays, early closes, and temporary status overrides through `MarketCalendar`. The fork suite automates this setup and the halt and repayment checks.

## License

`BluePool` and the deployment scripts build on Aave V3 Origin 3.6.0, which is licensed under the [Business Source License 1.1](LICENSE-AAVE-V3). The license’s additional use grant permits use subject to its conditions. **On March 6, 2027, or an earlier date the Aave DAO records on `v36.aavelicense.eth`, Aave V3.6 becomes available under the MIT license.** Blue’s own contracts (`StockBorrowControls`, `StockPriceSource`, `MarketCalendar`, and the mocks) are MIT.
