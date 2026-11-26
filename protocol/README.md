# Aave V3 protocol

[Architecture v3](../architecture-v3.md) describes the Blue-operated Aave V3 pool. This prototype pins **Aave V3 Origin 3.6.0**. The existing Morpho demo lives in [protocol-old](../protocol-old/README.md).

## Prototype

- The Aave Pool has one borrowable USDT reserve shared by five collateral-only mock stock reserves. They are TSLAB, NVDAB, QQQb, SPCXb, and GOOGLb. Enable isolated stock collateral explicitly after supplying it.
- The pool checks the debt owner’s signed eligibility, the stock’s current borrow permission, the regime LTV, and USDT caps. A pause or missed heartbeat blocks new risk against that stock. Repayment stays available. Flash loans are disabled in the prototype.
- Aave isolation enforces one active stock per account. Blue accounts for each stock’s accrued USDT debt using Aave’s scaled debt and current reserve index. Repayment and liquidation reconcile that balance, including debt burned when liquidation records a deficit.
- The deployed stocks and USD feeds are synthetic. The adapters read Atlas-style rounds, use a shorter freshness limit for borrowing than for liquidation, and check the stock multiplier. The simulated USDT price also uses a mock feed. Live feed selection, calendar configuration, keeper integration, production release and license, and security review are separate launch work. See [Aave V3 license](LICENSE-AAVE-V3).

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

For a manual borrow on the prototype, mint stock from the test deployer, then supply it and enable it as collateral. The borrower registers a signature from `BLUE_SIGNER` over `eligibilityDigest(borrower, stock, nonces(borrower), expiry)` on the controls contract. The keeper must report the stock healthy with gaps shorter than 10 minutes for the 30-minute recovery window, and keep its stock and USDT quotes fresh. Update the mock feeds and call `refresh()` on their price sources to accept new rounds. Then call the pool’s standard `borrow` with variable-rate mode `2`. Use `report(stock, false)` to simulate a halt of new risk for just that stock. The deployer can set calendar overrides through `RegimeRegistry`. The fork suite automates this setup and the halt and repayment checks.

## Shared reserve risk budgets

Blue now enforces an aggregate accrued USDT debt budget and a per-stock share of that configured budget, in addition to Aave native reserve caps and existing stock regime caps. Guardian changes can only tighten these limits. See [shared liquidity and supplier risk](../docs/aave-shared-risk.md) for units, advisory inputs and assumptions.
