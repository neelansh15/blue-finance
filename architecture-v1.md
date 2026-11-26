# Architecture v1

Dawn Finance: lending against tokenized US stocks (bStocks first) on BNB Chain, built on the canonical, unmodified Morpho Blue deployment.

Document date: 2026-11-26. All web sources were fetched on 2026-11-26 unless noted otherwise. Verification pass on 2026-11-26 (see "Verification log" at the end). The newest dated sources are the DEX liquidity snapshot (pancake.xyz / tokenstock / deviation.wtf, read 2026-11-26), the Chaconne TSLAB/TSLA spread note (2026-11-25) and a tokenized-stock session study (deepidea.io, 2026-11-21). The newest issuer source is the Binance SNDKB split announcement (2026-11-11). Note: 2026-11-26 is the US Thanksgiving holiday, so the DEX snapshot was taken with US markets closed.

Labels used below:
- **[F]** verified fact, with a source.
- **[D]** design proposal from Dawn (not a fact).
- **[U]** unverified or inferred.

---

## 0. Ground truth this design depends on

### Morpho Blue on BNB Chain

- **[F] Deployment.** Morpho Blue is deployed on BNB Chain at `0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a`. AdaptiveCurveIrm is at `0x7112D95cB5f6b13bF5F5B94a373bB3b2B381F979` and the ChainlinkOracleV2 factory at `0xDf2035fC15919588526dBb5560863C812F135236`. Source: https://docs.morpho.org/developers/contracts/addresses. That docs table has no chain labels. The BNB attribution is cross-checked against third-party explorers (evmquery, Oct 12 2026; gliese.io, https://gliese.io/protocols/morpho, fetched 2026-11-26), which label the same three addresses as BNB.
- **[F] Owner.** The owner is the Morpho DAO Safe `0xeE02eEa8173455A701A2E76d917CcC32d109518F` ("BNB Smart Chain" row, https://docs.morpho.org/learn/governance/organization/, fetched 2026-11-26). Gliese labels it "Multisig, no delay" (fetched 2026-11-26). **[U]** The 5-of-9 threshold was not shown on any page fetched on 2026-11-26; read `getThreshold()` / `getOwners()` on the Safe.
- **[F] What the owner controls.** The owner (DAO) controls `enableLltv`, `enableIrm`, `setOwner`, the fee switch (capped at 25% of borrower interest) and the fee recipient. It can enable but never disable LLTVs/IRMs. Dawn can create markets permissionlessly only from the enabled LLTV/IRM set. Sources: https://docs.morpho.org/learn/governance/organization/ and https://github.com/morpho-org/morpho-blue/blob/main/src/Morpho.sol (fetched 2026-11-26).
- **[F] Market parameters are immutable.** Each market is fixed by (loanToken, collateralToken, oracle, IRM, LLTV) and none of these can change.
  - Governance-approved LLTV list: 0 / 38.5 / 62.5 / 77 / 86 / 91.5 / 94.5 / 96.5 / 98 %; the only approved IRM is AdaptiveCurveIRM (https://docs.morpho.org/learn/concepts/blue/, fetched 2026-11-26). **[U]** That docs list is not chain-specific; confirm `isLltvEnabled(625000000000000000)` on the BNB singleton before deploying.
  - LIF = min(1.15, 1/(0.3·LLTV + 0.7)).
  - There is no close factor. A position can be liquidated in full in one call.
  - Bad debt is socialized to that market's suppliers.
  - Source: https://docs.morpho.org/learn/concepts/liquidation/
- **[F] The oracle is on the critical path.** `borrow`, `withdrawCollateral` and `liquidate` all call the oracle. A reverting oracle therefore blocks liquidations too. `supply`, `supplyCollateral` and `repay` do not call the oracle.
- **[F] No hooks.** Morpho has no hooks. `borrow` is permissionless for anyone who supplies collateral. `setAuthorization` lets an address act on someone else's position.

### PreLiquidation

- **[F] Mechanism.** It is an opt-in periphery contract. The borrower authorizes it, and its parameters are `preLltv < LLTV`, `preLCF1 ≤ preLCF2`, and `1 ≤ preLIF1 ≤ preLIF2 ≤ 1/LLTV`. It can use a different oracle from the market oracle. It has a callback, so liquidators do not need flash loans. Source: https://github.com/morpho-org/pre-liquidation (archived; now at morpho-blue `src/periphery/pre-liquidation`).
- **[F] Factory deployments.** The archived README says the PreLiquidationFactory is deployed "on Ethereum and Base". **That is out of date for BNB:** BscScan labels `0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42` "Morpho: PreLiquidation Factory" on BNB Chain, with verified source, created 2025-07-17 (https://bscscan.com/address/0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42, fetched 2026-11-26). Cross-check: morpho-org/sdks commit 2ef0e9a "add preliquidationfactory addresses for all network" (fetched 2026-11-26).

### Morpho Vault V2

- **[F] Roles.** Owner, Curator (timelocked risk configuration: adapters, caps, gates, fees), Allocator (allocate, `liquidityAdapter`, `maxRate`), and Sentinel (deallocate, decrease caps, revoke pending actions).
- **[F] Caps.** Curators set absolute and relative caps on ids such as collateralToken, market, or oracle.
- **[F] Emergency actions.** Cap decreases take effect immediately.
- **[F] Gates.** Gates cover receipt-token transfers, deposits and withdrawals. They are timelocked.
- **[F] Exit path.** `forceDeallocate` gives in-kind exit, with a penalty of up to 2%.
- Source: https://docs.morpho.org/learn/concepts/vault-v2/
- **[F] BNB periphery addresses** (Morpho addresses page row matched to the BNB prefixes on Gliese, both fetched 2026-11-26; https://docs.morpho.org/developers/contracts/addresses, https://gliese.io/protocols/morpho):
  - VaultV2Factory `0x29955201601630f686beAF47b0B03be7b86d160F`
  - MorphoMarketV1AdapterV2Factory `0x18c1b03ac8007224FE86442a91fEE3135ba767CD`
  - MorphoVaultV1AdapterFactory `0x5DEA489f90C9DEb49c4aD209f93043Ad13DBCe27`
  - MorphoRegistry `0x705A9Df14b294E6d4E673520369f289bd48C4cCB`
  - Blue Public Allocator (Vault V2) `0x0254e254f50fD4c4A8F38fAAB735487FD5Fe1BD5`
  - V1 PublicAllocator `0x842bEccF8eBC11006c4bE96DEfE09b60326D0495`, labelled "Morpho: Public Allocator" on BscScan (fetched 2026-11-26).
  - **[U]** The docs table carries no chain labels. The VaultV2Factory and MorphoRegistry rows are matched by Gliese's truncated BNB prefixes (`0x2995…160f`, `0x705a…4ccb`); the other rows are taken from the same docs row. Confirm each on BscScan before use.

### bStocks

- **[F] Issuer and wrapper.** bStocks are issued by BTech Holdings (ADGM prospectus, Binance group affiliate). They are "Certificates", not shares. Source: Binance SNDKB announcement, 2026-11-11 (mirrors: binancehub.co.kr/en/notice/289695, api.eqn.news/public/archive/bn-2304).
- **[F] Contract structure (NVDAB example).** NVDAB `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` is a BeaconProxy. Its implementation, `SecuritiesToken`, inherits `ERC8056BaseUpgradeable`, `ComplianceClientUpgradeable`, `PauseManagerClientUpgradeable` and `AccessControlEnumerableUpgradeable`. It has an `IERC8056Scheduled` interface. Source: BscScan verified source file list, https://bscscan.com/address/0x02fca66c1d1afb4e2a7884261eb00f63598a7436#code
  - **[F] Beacon and implementation.** The NVDAB proxy points at beacon `0x156d6dce9a4f6139a3406f1f021f1a4880de93a3`, and the SecuritiesToken implementation is `0xCFEd6c4679297ea4889F8183bC057B4A86C64e46` (verified source). BscScan shows no upgrade events for the NVDAB proxy (https://bscscan.com/address/0xCFEd6c4679297ea4889F8183bC057B4A86C64e46#code, fetched 2026-11-26).
  - **[F] Per-transfer logic (`_update`)**, read from the verified implementation source/bytecode on 2026-11-26:
    1. `pauseManager.isPaused(token)`. If true, the transfer reverts with `TokenPaused`.
    2. If `msg.sender` is neither `from` nor `to`, then `compliance.check(token, msg.sender)` runs (the spender/initiator).
    3. `compliance.check(token, from)` if `from ≠ 0`, and `compliance.check(token, to)` if `to ≠ 0`. `check` is a view that reverts on failure.
    - This matches the third-party reading by stoxwyse (2026-09-27).
    - The token itself has **no** `isBlacklisted` view. Blacklist/allowlist state lives in the separate compliance contract. **[U]** That contract's rule set (blacklist vs allowlist) was not read.
  - **[F] Admin surface.** Roles are `DEFAULT_ADMIN_ROLE` and `ISSUER_ROLE`. Admin setters: `setCompliance`, `setPauseManager`, `setMintEnabled`, `setBurnEnabled`, `setName`, `setSymbol`, `setIdentifier`. Also emits `TransferWithUIAmount` and `UIMultiplierChangeOverwritten` (same source, 2026-11-26).
  - **Resolved discrepancy (pause):** fortunepad's "no pause switch; no share multiplier" is wrong. The implementation has both a pause manager and the ERC-8056 multiplier (BscScan verified source, 2026-11-26).
  - **[F] Decimals = 18.** `decimals()` returns `0x12` in the implementation bytecode (BscScan, 2026-11-26). This agrees with fortunepad, tokenstock (TSLAB) and dexpaprika (NVDAB). **Contradicts** the "eight-decimal balances" reading of the prospectus, which is dropped. All Dawn math uses 18-decimal raw units.
- **[F] Multiplier semantics (ERC-8056 / BEP-8056, also called BEP-677).**
  - `balanceOf()` returns raw units and never changes on corporate actions.
  - `uiMultiplier()` (1e18 fixed point) is display-only: UI amount = raw × m / 1e18.
  - `setUIMultiplier(new, effectiveAt)` emits `UIMultiplierUpdated(oldMultiplier, newMultiplier, effectiveAtTimestamp)` immediately: **three arguments, not four** (corrected 2026-11-26 from the verified ABI and https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-677.md). Views keep returning the old multiplier until `block.timestamp ≥ effectiveAt`.
  - [F] Implementation bounds (verified source, 2026-11-26): the multiplier must lie in [1e9, 1e27]; `effectiveAt` must be in the future and no more than 365 days ahead; the initial multiplier is 1e18. A new `setUIMultiplier` before `effectiveAt` overwrites the pending change (`UIMultiplierChangeOverwritten`).
  - [F] BSC-only extension `IERC8056Scheduled` (`pendingMultiplier`, `hasPendingMultiplier`; interface id `0xeb0093dd`) lets a keeper read the scheduled change directly. On BSC, `TransferWithUIAmount` is REQUIRED, whereas EIP-8056 makes it optional (BEP-677, Draft, created 2026-04-14; https://eips.ethereum.org/EIPS/eip-8056; both fetched 2026-11-26).
  - "CEX Spot already quotes UI price". To convert a raw-denominated feed: UI price = rawPrice × 1e18 / m.
  - Sources: https://docs.bnbchain.org/developer-kit/scaled-ui-amount/ and https://github.com/bnb-chain/bep-677-contracts (audit: Pashov, 2026-04-30).
  - Naming discrepancy: Binance Academy calls it "BEP-677 (Scaled UI Amount)", while BscScan and rwa.xyz call it "BEP-8056". The repo shows these are the same thing: BEP-677 implements EIP-8056.
- **[F] Corporate actions run through the multiplier.**
  - Splits: SNDKB 8-for-1, "On-chain holders … receive the additional bStocks through a multiplier adjustment". Price resumed at about 1/8.
  - Dividends: reinvested net of 30% US withholding via the multiplier (TSLA, Salesforce, AMC and SharonAI prospectuses, Jun to Sep 2026).
  - Cross-check: rwa.xyz (https://docs.rwa.xyz/methodology/corporate-actions) lists bStocks as balance-rebasing with `shares` transfer units. Example: QQQB multiplier 1.000725 in Oct 2026.
- **[F] SNDKB split timeline (UTC).**
  - Nov 18 15:00: Binance Margin force-closed SNDKB loans and liquidated SNDKB collateral.
  - Nov 19 23:30: Buy/Sell suspended.
  - Nov 20 00:30: spot, deposits, withdrawals and 1:1 conversion suspended.
  - Nov 20 01:00: snapshot.
  - Nov 20 09:00: spot and deposits resumed.
  - Nov 20 10:00: withdrawals resumed.
  - After Nov 20 14:35: margin collateral re-enabled.
  - **[U]** Discrepancy: earlier notes (from the Atlas notice) recorded the suspension as starting Nov 19 23:30. The Binance table shows 23:30 for Buy/Sell and 00:30 for spot. Both are consistent with the table above.
- **[F] Geo-blocking is the integrator's job.** Integrators must enforce geographic restrictions. "Binance provides a public REST API with a country eligibility endpoint". The issuer "reserves the right to blacklist wallet addresses". Source: Binance Academy "What are bStocks".
  - Pancake's geo-block list for bStocks has 57 countries/territories (https://docs.pancake.xyz/trade/pancake-exchange/tokenized-stocks-geo-block).
  - **[U] Discrepancy:** the Sep 30 issuer restricted list (US, Canada, Cuba, Crimea, Iran, Netherlands, North Korea, Syria, parts of Ukraine) is much shorter than Pancake's list. Pancake's list appears to reflect its own policy.
  - [F] Re-confirmed in the Binance bStocks FAQ (https://www.binance.com/en/support/faq/detail/f0c03cd6509a4085b4cce1636f16be38, updated 2026-07-28, fetched 2026-11-26): public REST API with a country eligibility endpoint; not available to US persons; the issuer may blacklist at contract level.
  - **[U]** The exact URL and schema of the eligibility endpoint are still not found (2026-11-26). Searched the Binance FAQ, Binance Academy and developer docs (developers.binance.com, dev.binance.vision). The only related item found is the generic HTTP 451 "restricted location" error. Ask Binance/BTech for the endpoint spec.

### Atlas Oracle

- **[F] Feed interfaces.** SingleFeed is Chainlink AggregatorV2V3-compatible. MultiFeed has `fetch(bytes4)` returning (price uint80, aggregatedTs, onchainTs).
- **[F] Read access.** Feeds run in **whitelist** or **open-read** mode. Source: https://docs.atlasoracle.io/developers/api-reference/multi-feed-contract
- **[F] Update policy and data filters.** Heartbeat or deviation updates. Only markets updated in the last hour are used, with liquidity/volume filters and Q25/Q75 outlier removal. The docs example uses a 1h MAX_AGE.
- **[F] Off-hours pricing.** Per the Circle partner page, outside US hours Atlas prices from onchain tokenized-stock markets (bStocks, Ondo).
- **[F] Feeds free for bStocks builders on BNB.** Announced Sep 17, 2026.
- **[F] Pull mode.** Signed reports carry 18-decimal prices; reference `maxDelay` is 180 s; signer `0x59eD4701224fD9e2a85Ef2946c2ab828C1dDC600`. MultiFeed `decimals()` is shared across all feeds in the contract. Push mode supports SingleFeed or MultiFeed, and whitelist mode allows non-7702 EOAs (https://docs.atlasoracle.io/developers/atlas-oracle/integrate-the-push-mode, fetched 2026-11-26).
- **[F] Configurable protections (marketing page, not bStock-specific).** atlasoracle.io advertises heartbeat 1 s to 1 day, deviation triggers, a Consensus Score (HEALTHY ≥ 0.85; CRITICAL < 0.40 holds the last trusted value; a SPLIT_MARKET state) and on-chain circuit breakers. Its "RWA PERP" example (TWAP 5 min, heartbeat 60 s, deviation 0.25%) is illustrative only (fetched 2026-11-26). **[U]** The actual heartbeat and deviation of the bStock feeds.
- **[F] Lista's configuration (updated 2026-11-26).** Lista's bStock page now lists **7** bStocks, not 3. Resilient Oracle `0xf3afD82A4071f272F403dC176916141f44E6c750`; Atlas is main and fallback, APRO is pivot, with a 0.98/1.02 BoundValidator. Source: https://docs.bsc.lista.org/for-developer/multi-oracle/multi-oracle-bstock (fetched 2026-11-26).

  | Asset | Token | Atlas oracle (Lista) |
  |---|---|---|
  | TSLAB | `0x5b1910eAaD6450E50f816082Aa078C41F10C292f` | `0xf569C3e52e797219eCFDc1659c3250B0BbDC693C` |
  | MUB | `0xcdf2f3e0fa43C47A6662a91C9E4a7C5f69762699` | `0xf0c2791042E73a601550493c6C7b9DEafbdedCD3` |
  | NVDAB | `0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436` | `0x2bd759006b423BFF444181A13C96a6b134E557BB` |
  | SNDKB | `0x3eE4dF61bd4F867E349BEaE8bFE07bc31b4850fb` | `0x1C5211723f67A77DAaDb62DDc6D68Ee23e724c0f` |
  | CRCLB | `0x80f3D493EBCe97e343c53D29a137942416B4ffC0` | `0x15c493e3C31080784cd2067369c1fAea9EA35302` |
  | SPCXB | `0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1` | `0xdf8b61796436eD39F406623aa2166a7f185185Cb` |
  | MSFTB | `0x80106CB3ead06659A5ad19dF39d9b4733863b9b0` | `0x56E1c317EF6F029a8327686F4b9736877f621122` |

- **[F] Venus's configuration.** In the Core Pool, TSLAB, NVDAB, SPCXB and SKHYB use Atlas as main and APRO as pivot, with 0.95–1.05 bounds (https://docs-v4.venus.io/risk/resilient-price-oracle, snapshot VIP-663, 2026-09-28; APRO pivot added by VIP-654, executed 2026-08-16, https://community.venus.io/t/5901; fetched 2026-11-26). The Atlas vs APRO median deviation is 7–18 bps.
  - The listing proposal (https://community.venus.io/t/5832, 2026-06-16) set:

    | Market | CF | LT | Supply cap |
    |---|---|---|---|
    | TSLAB | 60% | 70% | 236 |
    | NVDAB | 60% | 70% | 450 |
    | SPCXB | 50% | 65% | 500 |

    All three have borrow cap 0, liquidation incentive 10%, and a DeviationBoundedOracle at 16.67%.
  - Venus Atlas aggregators: TSLAB `0x63950c265e7cdb4016ba60c288c46291c0148ce2`, NVDAB `0x8a44cf4e55add99eb8bac5d5db749c63106d54aa`, SPCXB `0x0072e55bff6fec200708ce82612569a1c0eb4b24`, SKHYB `0x8a87b38d4c8ef07546a1dd87a9d58f0b36b11a2b`.
  - **[U] Discrepancy:** Venus's Atlas addresses differ from Lista's for the same tickers (e.g. TSLAB Venus `0x6395…8ce2` vs Lista `0xf569…693C`). These may be separate consumer instances or whitelists. Dawn must get its own feed address and read-access status from Atlas, not copy either one.
- **[U]** No market-status flag was found in the Atlas docs (re-checked 2026-11-26: SingleFeed/MultiFeed API reference, Push/Pull integration pages, the data-quality page and atlasoracle.io).
- **[U]** Whether Atlas bStock feeds quote **per UI share** (the post-split price) or **per raw token** (re-checked 2026-11-26). Indirect evidence points to per UI share:
  - The SNDKB notice says the post-split price "will not line up" with the pre-split price.
  - An Atlas post (LinkedIn, 2026-10-12) says "dividends and splits also come through an on-chain multiplier, so the feed has to follow both".
  - Venus's risk reviewer reports that Atlas tracks the Binance bStock price, and Binance quotes the UI price.
  - Not confirmed from contract output: compare `latestAnswer()` with the Binance UI price × 1e(decimals) before launch.

### Halt data

- **[F] Nasdaq Trader Trade Halt RSS.** `https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts` covers Nasdaq-listed and other exchange-listed securities. It updates once per minute on trading days, and the terms forbid polling more often than once per minute. Source: https://www.nasdaqtrader.com/Trader.aspx?id=TradeHaltRSS
- **[U]** Reason codes (T1/T2/LUDP/H10, etc.) come from a secondary page.

---

## 1. Component list

| # | Component | Where | Responsibility |
|---|---|---|---|
| C1 | **Morpho Blue (canonical)** | on-chain, not Dawn's | Accounting, borrow/repay, liquidation. Unmodified. |
| C2 | **DawnOracle** (one per market, immutable address) | on-chain [D] | Implements `IOracle.price()`. Logic described below this table. |
| C3 | **Wrapped collateral `dX`** (optional, phase 2) | on-chain [D] | 1:1 raw wrapper of a bStock. Only the router can mint (deposit into Morpho), and `transfer` from Morpho to anyone is allowed so liquidations still work. This is what makes "router-only borrowers" enforceable. |
| C4 | **DawnRouter** | on-chain [D] | Entry point for supplyCollateral+borrow, repay, withdraw and PreLiquidation setup. Checks the eligibility attestation (signed by C9), the per-account regime limit (a target LTV stricter than LLTV), and asset/regime caps. Uses `setAuthorization`. |
| C5 | **Dawn Vault V2** (USDT/USD1 loan asset) | on-chain | Curated supply side. Caps per collateral id and per market. Gates for depositor KYC if needed. |
| C6 | **PreLiquidation instance(s)** | on-chain | Partial, gentler liquidation between preLltv and LLTV, with a small preLIF. |
| C7 | **RegimeRegistry** | on-chain [D] | Calendar plus keeper-set state: OPEN / EXTENDED / CLOSED / WEEKEND / HALTED / CORP_ACTION. It is read by C2 and C4. |
| C8 | **Keepers** | offchain [D] | Push regime updates and the multiplier watch (`UIMultiplierUpdated` events). Run the halt monitor. Act as sentinel bot (cap cuts). Liquidation bot (backstop). |
| C9 | **Eligibility service** | offchain [D] | IP geo check, the Binance country-eligibility endpoint, sanctions screening, and a pre-flight `compliance.check` simulation (the token has no `isBlacklisted` view; see §6). Signs short-lived attestations for C4. |
| C10 | **UI** | offchain | Shows balances in UI units (`balanceOfUI`). Shows regime, haircut, health in both price regimes, and corporate-action banners. |
| C11 | **Risk/LLTV pipeline** | offchain [D] | Computes the gap distribution and haircut tables from historical data. Produces governance proposals for caps and new markets. |

**DawnOracle (C2) logic:**
1. Read the Atlas feed.
2. Read the DEX TWAP.
3. Take the conservative of the two (the min, for collateral).
4. Convert to price-per-raw-token: × `uiMultiplier()` if the source is per-UI-share.
5. Apply the regime haircut.
6. Apply a staleness policy: during freeze, return the last good price, with a bounded duration.
7. Never revert in the normal path.

---

## 2. Trust assumptions, keys and roles

| Actor / key | Powers | Trust assumption | Notes |
|---|---|---|---|
| Morpho DAO Safe | enableLltv/enableIrm, fees (max 25%, cannot touch existing market params) | Will not set a fee on Dawn markets adversely | [F] owner, multisig with no delay (docs governance page + Gliese, 2026-11-26); [U] 5-of-9 threshold |
| bStock issuer / Op & Tech Co | pause, blacklist, freeze, upgrade the beacon implementation, set the multiplier | Acts lawfully, keeps the multiplier correct, does not blacklist the Morpho singleton | **The largest single trust point.** The beacon upgrade can change token behavior for every holder at once. |
| Atlas reporters / feed admin | Price and read-access whitelist | Feed stays live. Dawn's oracle is whitelisted, or the feed is open-read. | Whitelist removal makes `fetch` revert. C2 must handle this with try/catch (see §5.2). |
| Dawn Vault Owner | Appoints curator and sentinels | Multisig [D] | |
| Dawn Curator | Caps, adapters, gates (timelocked) | Multisig plus timelock [D] | |
| Dawn Allocator | Moves liquidity between markets | Hot-ish key, bounded by caps | |
| Dawn Sentinel | Cut caps, deallocate, revoke | Hot bot key plus human multisig [D] | It can only reduce risk, which is why it is safe to automate. |
| RegimeRegistry keeper | Set HALTED/CORP_ACTION, freeze or unfreeze | Bot key with bounded powers [D] | It can only make prices more conservative or freeze, for a max duration. Unfreeze requires a price-continuity check. |
| DawnOracle | None after deploy | Immutable code, parameters fixed at deploy | Market oracle is immutable [F]. Changing logic means deploying a new market and migrating. |
| Eligibility signer | Signs attestations | Offchain key [D] | Compromise lets ineligible users borrow (compliance risk). It does not affect solvency. |

---

## 3. Data flows

### 3.1 Borrow (happy path)

1. The UI collects the wallet address. C9 checks geo/IP, the Binance eligibility endpoint, sanctions, and simulates the token's `compliance.check` for the address, then returns a signed attestation (address, expiry).
2. The user approves the bStock (raw amount computed via `fromUIAmount`) to the router (C4).
3. C4 verifies the attestation, reads RegimeRegistry and computes `maxBorrow = collateral × DawnOracle.price() × targetLTV(regime)`. targetLTV is below the LLTV, and the haircut is already inside the price.
4. Phase 1: C4 calls `Morpho.supplyCollateral(onBehalf=user)`, then `Morpho.borrow(onBehalf=user, receiver=user)`. This uses user→router `setAuthorization`.
   Phase 2 with C3: C4 wraps the token to `dX` and supplies `dX`.
5. Morpho calls `DawnOracle.price()` and checks LTV ≤ LLTV.
6. The token transfer into Morpho runs the bStock compliance checks. [F] (verified `_update`, 2026-11-26):
   - Morpho's `transferFrom(user→Morpho)` has `msg.sender = Morpho = to`, so the separate spender check is skipped. `from` (user, or router in phase 1 if it holds the tokens) and `to` (Morpho) are both checked.
   - Morpho must therefore pass `compliance.check` as `to` here, and as `from` on withdraw/liquidation.
   - A router that pulls tokens via `transferFrom(user→router)` is itself checked as `to`.
7. Optionally, the router deploys or authorizes the PreLiquidation contract for the user.

### 3.2 Liquidation

1. The keeper (C8) watches health using `DawnOracle.price()`.
2. If preLltv < LTV ≤ LLTV, the PreLiquidation contract is used: `preLiquidate` with a partial close at a small incentive. The bot gets the callback, sells collateral, and repays.
3. If LTV > LLTV, `Morpho.liquidate` is called. Morpho calls the oracle, then transfers collateral from Morpho to the liquidator, which passes bStock pause and compliance. **If the token is paused, or the liquidator or Morpho is blacklisted, the transfer reverts and the liquidation fails.**
4. Exit venues for the liquidator:
   - (a) On-chain DEX: PancakeSwap v3 pools plus PancakeSwap X RFQ. **Corrected 2026-11-26:** the earlier "no standing depth" (from Venus's June 2026 risk report) is out of date. Snapshot read 2026-11-26, with US markets closed (Thanksgiving):
     - NVDAB/USDT Pancake v3, 0.25% fee, pool `0x8FB4243b553aC29BA088aCf00B9B7dA24bD6690C`: TVL ≈ $3.37M, 24h volume ≈ $3.38M (pancake.xyz). Tokenstock shows ≈ 428.7k USDT on the USDT side.
     - TSLAB/USDT Pancake pool: liquidity ≈ $1.35M (≈ 723k USDT side), 24h volume ≈ $1.28M (tokenstock). ±2% depth ≈ $1.36M (livecoinwatch).
     - deviation.wtf/stocks: 33 of 34 BSC bStock pools were quoting while the market was closed.
     - Binance Research (2026-10-20): 56% of bStock volume trades outside regular hours, 7% on weekends.
     - **[U]** Depth at the moment of a weekend or corporate-action shock, and RFQ quote size, were not measured. Pool figures are aggregator readings, not on-chain reserves read by Dawn.
   - (b) Binance spot via deposit. Not atomic, and suspended during corporate actions.
   - (c) Issuer redemption via Alpaca. US hours only, suspendable, and Delivery-in is not guaranteed.
5. During CLOSED/WEEKEND, venue (c) is unavailable and (b) may be thin. The keeper should still liquidate, take inventory risk, and unwind at the open.

---

## 4. Question 1: Stock splits

**[F] Mechanism.** bStocks use a display **multiplier**, not a supply rebase or a token migration. Raw `balanceOf` never changes. The issuer can schedule `effectiveAt`. Binance suspended deposits and withdrawals for about 9.5h around the SNDKB split.

**Effect on a Morpho market [F + reasoning]:**
- **Accounting is unaffected.** Morpho stores raw collateral and never sees the multiplier. Morpho's no-rebasing assumption is satisfied because raw balances don't change.
- **Valuation is the only failure point.** The oracle must return price per *raw* token = UI price × m.
  - Suppose a feed quotes per UI share (as Binance spot does [F], and probably Atlas [U]). An 8-for-1 split then drops the reported price per raw token about 87.5% unless the oracle multiplies by m. Every position would become liquidatable instantly, and liquidators would seize collateral worth 8× what the oracle says.
  - The reverse error is also possible. If m updates on-chain *before* the feed switches to post-split quotes, a naive "× m" oracle shows an 8× **overvaluation**. That opens a borrow-drain window.
- **Oracle discontinuity.** The two inputs (feed price and m) move at different times: the `effectiveAt` block vs. the first post-split feed print. A product of the two is only correct when both are on the same side of the event.

**Design [D]:**
1. **Detect.** Keeper C8 subscribes to `UIMultiplierUpdated` (which fires at schedule time, before `effectiveAt`) and to issuer/Binance announcements. Binance gave 9 days' notice for SNDKB.
2. **Pre-window (T−24h, Jupiter-style, or from the announcement).** Set the regime to CORP_ACTION. The router blocks new borrows on that asset, and the sentinel cuts the vault cap for that market to the current allocation. Users are warned in the UI.
3. **Freeze window.** From `effectiveAt − δ` until the feed has printed post-split prices that pass a continuity check, C2 returns the **last good per-raw-token price** (pre-split price × pre-split m).
   - The freeze has a hard max duration. For SNDKB the suspension was about 9.5h; set the max from that order plus margin. **[U]** exact value.
   - The continuity check: |feed_post × m_new − lastGood| / lastGood < band, where the band comes from the gap distribution.
   - During the freeze, liquidations still work at the frozen price, because there is no revert.
4. **Unfreeze automatically when the check passes.** If the check fails at max duration, keep the frozen price with an additional haircut and escalate to humans. Do not revert.
5. **Migration and unwind.** With multiplier semantics, no migration is needed. A migration is only needed if the issuer ever does a token swap (new contract). In that case:
   - Pause new borrows (router).
   - Set caps to 0.
   - Deploy a new market with the new collateral and its oracle.
   - Offer a router "migrate" flash flow: repay old → withdraw → swap or convert → supply new → borrow.
   - Leave the old market liquidatable on its oracle.
6. **Fallback if Atlas quotes per raw token [U].** Drop the × m step. The continuity check stays, because it covers both cases. **This must be verified on-chain before mainnet.**

---

## 5. Question 2: Market hours and regime limits without hooks

**[F] Atlas off-hours pricing.** Outside US hours, Atlas derives prices from onchain tokenized-stock markets (bStocks, Ondo) and keeps updating 24/7. Its filters drop markets stale by more than 1h. Atlas has no published market-status flag [U].

Comparable regime-aware designs:
- Chainlink 24/5 streams publish `marketStatus` (0 Unknown, 1 Pre, 2 Regular, 3 Post, 4 Overnight, 5 Closed).
- Chainlink 24/7 streams use perp-derived weekend prices.
- The Defiant (Nov 19) reported an NVDA weekend price hold of about 50h on another oracle.

### 5.1 DawnOracle formula [D]

```
p_atlas = Atlas per-UI price (staleness ≤ maxAge(regime), else treated as missing)
p_twap  = PancakeSwap bStock/USDT TWAP over window W, valid only if pool liquidity ≥ L_min
p_ui    = min(p_atlas, p_twap)        (if one source is missing: the other source × extra haircut)
p_raw   = p_ui × uiMultiplier() / 1e18   (see §4; verify Atlas units)
price() = p_raw × (1 − h[regime]) × decimals scaling to 1e36
```

- `h[regime]` is fixed at deploy (immutable oracle), indexed by RegimeRegistry state. `h[OPEN]` = 0. `h[WEEKEND]` and `h[HALTED]` are the largest. Values come from §11, not invented here.
- **Haircut-in-price is the only hookless way to make the *liquidation* threshold regime-dependent.**
  - Raising h off-hours makes positions liquidatable earlier, so it acts as an effective LLTV of LLTV × (1−h).
  - **Trade-off:** at the regime switch (e.g., Friday close), positions near the LLTV become liquidatable with no price move at all. To mitigate:
    - Ramp h linearly over a window instead of stepping it.
    - The router enforces targetLTV ≤ LLTV × (1 − h_max) for *new* borrows. Positions opened under that limit never become liquidatable from the regime switch alone.
    - The UI shows "weekend health".

### 5.2 Other levers, honestly assessed

| Lever | Works? | Caveat |
|---|---|---|
| Haircut in oracle price | Yes, affects both borrow and liquidation | Switch-induced liquidations, mitigated by the ramp and the router targetLTV |
| Router as only borrower | Only with the wrapper C3. A raw-bStock Morpho market is permissionless, so anyone can call `borrow`. | The wrapper adds a contract layer. Liquidator receipt of `dX` must be unrestricted, and `dX → bStock` unwrap must be open to anyone. |
| Router target LTV per regime | Yes, for router users | Bypassable without C3 |
| Vault V2 caps / sentinel cut | Yes. Limits *new supply to markets*, so it bounds total exposure. | Does not stop an individual borrow while liquidity exists in the market. Combine with the allocator keeping idle assets in the vault, not in the market, off-hours. |
| Vault V2 gates | Only gate *depositors* and receipt tokens, not borrowers | |
| PreLiquidation | Yes, softer partial liquidations before LLTV | Opt-in per borrower (the router can set it at onboarding) |
| **Oracle revert** | Blocks borrow **and** `withdrawCollateral` **and** `liquidate` [F] | Freezes the whole market. Bad debt accumulates if the price moves while reverted. **Not used** as a regime lever. Only a last resort, never the default path. Atlas whitelist removal or a feed failure could cause it involuntarily, so C2 must wrap reads in try/catch and fall back. |

---

## 6. Question 3: Pause, whitelist and blacklist controls

**[F] Token controls.** bStocks have pause, compliance (blacklist/whitelist) and freeze controls. Per the prospectus, the Op & Tech Co operates them on CSD instruction, and they remain usable after Delivery-out. Sanctioned addresses are blocked. The issuer may freeze addresses of non-compliant apps. Integrators must IP geo-block.

**How Morpho behaves [F mechanics + reasoning]:**
- Morpho moves tokens with `safeTransfer` / `safeTransferFrom`. A reverting transfer reverts the whole call. There is no partial state.
- **Token paused:** every `supplyCollateral`, `withdrawCollateral` and `liquidate` on that collateral reverts. Repay and borrow of the *loan* token still work. The market price still moves, so positions can go underwater while unliquidatable. This creates bad-debt risk for the duration of the pause.
- **Borrower blacklisted:**
  - Their collateral sits at the Morpho address, so other users are unaffected.
  - Liquidation sends collateral Morpho → liquidator via `transfer`. [F] (verified `_update`, 2026-11-26): only `from` (Morpho) and `to` (liquidator) are checked, because `msg.sender = Morpho = from`, so the spender check is skipped. The borrower's address is never passed to compliance during liquidation, so liquidating a blacklisted borrower still works.
  - A blacklisted borrower cannot withdraw to themselves. They could withdraw to another receiver, which raises evasion concerns. The router should refuse to process actions for blacklisted addresses.
- **Liquidator blacklisted / not eligible:** their liquidation reverts. Other liquidators can still act.
- **Morpho singleton blacklisted or frozen:** **all** bStock collateral of that token in **every** Morpho market (Dawn's and anyone else's) becomes immovable. Liquidations revert and withdrawals revert. This is the issuer kill-switch tail risk.
  - The wrapper C3 does not remove it: the wrapper contract becomes the single point instead.
  - It only isolates Dawn from *other* Morpho users' compliance problems. Dawn would hold its own wrapper address relationship with the issuer.
- **Issuer upgrades the beacon implementation:** arbitrary behavior change. Unmitigable on-chain. Monitor `Upgraded` events.

**Design [D]:**
1. **Eligibility gating.** C9 attestation is required by the router. Checks:
   - IP geo-block (union of the issuer's restricted list and any stricter venue lists, decided by counsel).
   - The Binance country-eligibility endpoint [U on URL/schema, still not found 2026-11-26].
   - Sanctions screening.
   - Pre-flight compliance simulation instead of an `isBlacklisted` mirror. [F] The token has no `isBlacklisted` view (verified ABI, 2026-11-26). C9 reads the compliance contract address from the token (getter name to confirm against the ABI) and `eth_call`s `compliance.check(token, user)`, which reverts if the user would fail, for the user, the router and Morpho. This uses the token's own rule set whatever form it takes. **[U]** The compliance contract's own ABI and rule type.
2. **Blacklisted borrowers:** the router denies them. Their existing positions stay liquidatable. Liquidator bots are run from a known-eligible address.
3. **Pre-clear liquidator addresses.** Ask the issuer to confirm that the Morpho contract and Dawn liquidator addresses are compliance-clear. Morpho must pass `compliance.check` as both `to` (supply) and `from` (withdraw/liquidate), per the verified `_update`, 2026-11-26.
   - Precedent: Venus (Core Pool, since June 2026) and Lista Moolah already hold bStocks as collateral in their own contracts, which suggests protocol contracts pass. This is an inference, not a confirmation.
   - Before launch, `eth_call` `compliance.check(token, 0x01b0Bd30…a83a)` for each listed bStock. Open question: whether that pass comes from a blacklist model or an explicit allowlist entry.
4. **Exposure caps** per bStock and in aggregate (Vault V2 collateral-id caps) sized so that a total freeze of one issuer's tokens leaves losses within a set fraction of vault TVL. That fraction is a governance choice, not a number given here.
5. **Monitoring.** Pause-manager state (`isPaused(token)`), compliance-contract changes (`setCompliance` / `setPauseManager` on the token), beacon `Upgraded` events (beacon `0x156d…93a3`), and `UIMultiplierUpdated` / `UIMultiplierChangeOverwritten` on every listed token. On a pause, the sentinel immediately cuts caps to 0 and the allocator pulls idle liquidity.

---

## 7. Question 4: Halt notices

**Detection sources:**
- **[F] Nasdaq Trader Trade Halt RSS.** Covers all US-listed securities, polled at most once per minute.
- **[U]** NYSE trade-halts page.
- **[U]** SEC trading-suspension orders (sec.gov litigation/suspensions).
- Issuer and Binance announcements, which reach bStock-specific suspensions.
- Atlas behavior: staleness or a feed pause, as in the SNDKB case [F].
- A DEX-vs-Atlas divergence alarm.

**Response [D]:**

| Step | Actor | Vault V2 / Dawn role |
|---|---|---|
| Halt detected | Keeper | Sets RegimeRegistry = HALTED for the symbol |
| Stop new risk | Router (automatic via regime) and **Sentinel** (cut caps for that collateral id to the current allocation or 0) | Sentinel: decrease caps, no timelock [F] |
| Pull spare liquidity | **Allocator** deallocates idle supply from the halted market | Allocator |
| Price | C2 freezes to the last good price × (1 − h[HALTED]), for at most `T_halt_max` | Oracle logic (immutable parameters) |
| Freeze exceeded | C2 keeps returning the frozen and haircut price, **does not revert**, and governance is alerted. Under a long SEC suspension (H10) the market is wound down via caps = 0 while liquidations continue at the frozen price. | Curator (timelocked removal), Owner |
| Resume | Keeper clears HALTED after the first post-halt prints pass the continuity band. Haircut ramps down. | Keeper |

**Risk:** a halt-resume gap through the frozen price gives liquidators a bad price on one side. If the stock resumes much lower, collateral was overvalued during the freeze, so h[HALTED] must cover the halt-gap quantile (§11).

---

## 8. Question 5: Dividends

**Per-issuer mechanism:**
- **[F] bStocks:** cash dividends are reinvested net of 30% US withholding by raising the multiplier. No cash is paid on-chain. Timing delays and imprecision are possible (prospectus).
- **[F] Others (rwa.xyz):**
  - Ondo GM and Coinbase use NAV accumulation, meaning price per token rises. There is a discrepancy: rwa.xyz also lists Coinbase under ERC-8056 shares, marked with an asterisk.
  - xStocks, Robinhood Chain and Reality use rebasing or multipliers.
  - Distributing funds pay out cash.

**Does the ex-date drop create liquidation risk?**
- Value per raw bStock = UI price × m.
- On the ex-date, the UI price drops by about the dividend amount. m rises by about (1 + net dividend/price), but **only when the issuer applies it**. Binance notes the timing can lag.
- So if C2 multiplies by m, value per raw token is roughly constant, minus the 30% withholding leakage. Between the ex-date drop and the m credit, the oracle shows a **temporary drop of about the dividend yield** (small for most stocks [U per name]). This can tip only positions already within that margin of the LLTV.
- If C2 does *not* multiply by m (pure price return), every dividend is a permanent collateral-value leak against the true claim.

**What the oracle must do [D]:**
- Report **total return per raw token** (UI price × m).
- For the ex-date-to-credit gap, the keeper pre-computes the expected m and the router stops new borrows near the LLTV for that asset on the ex-date. Optionally, C2 caps the one-day drawdown attributable to known ex-dates. This is complex, so it is deferred.
- Withholding means the dollar value is **not** exactly constant: holders lose 30% of the gross dividend versus an untaxed share.

---

## 9. Question 6: ScaledUI (optional / later)

**[F]**
- Raw = `balanceOf`, UI = raw × m / 1e18.
- Transfers and approvals take raw amounts. Use `fromUIAmount` for user input.
- Scheduled changes take effect at `effectiveAt`. Do not apply them early.
- TRON tip-8056: UI amounts MUST NOT be used for pricing, collateral or liquidation.

**Morpho implications:**
- Morpho stores raw amounts, which is correct.
- All of Dawn's on-chain math (router limits, oracle) uses raw amounts plus price per raw token.
- Event logs show raw amounts.

**Frontend requirements [D]:**
- Show collateral as `toUIAmount(raw)` and the price as UI price, with total value = raw × price per raw token. Both must reconcile.
- Show an "m = x" badge and pending multiplier changes (`newUIMultiplier`, `effectiveAt`).
- Refresh caches at `effectiveAt`.
- Show the liquidation price in UI units: price_raw_liq × 1e18 / m.
- Detect ERC-8056 via ERC-165 or an allowlist.

---

## 10. Liquidation design

### Static LIF arithmetic [F formula, computed here]

| LLTV | LIF | Max price drop from LLTV before seized collateral < debt × LIF (1 − LLTV·LIF) | Drop to bad debt (1 − LLTV) |
|---|---|---|---|
| 62.5% | ≈1.127 | ≈29.6% | 37.5% |
| 77% | ≈1.074 | ≈17.3% | 23% |
| 86% | ≈1.044 | ≈10.2% | 14% |

The brief's "62.5% gives about 26% headroom" is not reproduced by this calculation. It is plausible if about 3-4% slippage and gas are deducted from 29.6%. Treat 26% as a derived figure, not a source fact.

Precedent: Steakhouse uses 62.5% for most Coinbase stock-token markets and 77% for GOOGL (earlier research notes).

### Exit venues and limits

- PancakeSwap v3 / PancakeSwap X RFQ: **corrected 2026-11-26.** Standing depth exists and pools quote off-hours. On 2026-11-26, with US markets closed:
  - NVDAB/USDT TVL ≈ $3.37M.
  - TSLAB/USDT ≈ $1.35M, with ±2% depth ≈ $1.36M.
  - Sources: pancake.xyz, tokenstock, livecoinwatch, deviation.wtf (see §3.2).

  That is large relative to Venus caps (236–500 tokens), but finite. Size per-liquidation lots against the ±2% depth, and remember the spread can run wide (TSLAB 2.56% below TSLA on 2026-11-25, Chaconne). **[U]** RFQ quote sizes and depth during a shock.
- Binance spot: deposit latency. Suspended around corporate actions.
- Issuer redemption: US hours only, suspendable, operated via Alpaca, and Delivery-in is not guaranteed [F prospectus].
- Off-hours liquidations therefore mean **inventory risk for the liquidator**. The LIF must also pay for holding the stock until the next open. This argues for 62.5% LLTV at launch.

### PreLiquidation [D]

- The router offers it at onboarding.
- preLltv = LLTV − buffer, small preLIF1 → preLIF2 ≤ 1/LLTV [F constraint], and preLCF partial. This produces smaller, more frequent liquidations that the thin venues can absorb.
- [F] Use the BNB PreLiquidationFactory `0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42` (BscScan "Morpho: PreLiquidation Factory", verified, 2026-11-26). Dawn does not need to deploy its own copy. The router calls `createPreLiquidation(marketId, params)` there and has users authorize the resulting instance.

### Does Dawn run its own bot?

Yes [D], as a backstop liquidator.
- Third-party liquidators are unlikely to hold eligible addresses and bStock exit routes on day one.
- Venus uses an operator-gated BStockLiquidator (competitor research).
- Dawn's bot uses PreLiquidation first and Morpho `liquidate` second.
- It holds a USDT float, and it is allowed to warehouse collateral off-hours within a set inventory limit.
- Morpho liquidation stays permissionless. Dawn's bot is not privileged.

---

## 11. LLTV selection method (no numbers invented)

For each asset a and regime r ∈ {overnight, weekend/holiday, halt-resume, corporate action}:

1. **Gap data.** From historical underlying prices, compute the adverse gap G = max(0, 1 − P_reopen / P_ref), where P_ref is the last price the oracle would have served (close, or last off-hours print if Atlas is used 24/7). Include all weekends, holidays, earnings, and halts from the Nasdaq halt history. Supplement with the bStock off-hours DEX series where available.
2. **Quantile.** Take the quantile G_q(a, r) at a governance-chosen q, for example the same q used for the vault's loss budget.
3. **Haircut.** Set h[r] so that the residual gap after the haircut is covered: G'_q = max(0, G_q − h[r]).
4. **Liquidation-completeness condition.** Choose the highest Morpho LLTV L from the enabled list such that 1 − L·LIF(L) ≥ G'_q + s(a, size) + c, where:
   - s is exit slippage at the expected liquidation size on the available off-hours venue (measured from PancakeSwap / RFQ quotes);
   - c is gas plus the inventory-carry cost.
5. **Stress check.** Additionally require 1 − L ≥ G_{q_tail}, using a stricter tail quantile, so that bad debt only occurs beyond the tail quantile.
6. **Router target LTV.** Set targetLTV(r) = L × (1 − h_max) − margin, so regime switches never liquidate fresh positions.
7. **Recompute** monthly. Lowering LLTV means a new market, because LLTV is immutable.

---

## 12. Per-risk table

| Risk | Detection | On-chain mitigation | Offchain mitigation | Unmitigated |
|---|---|---|---|---|
| Weekend/overnight gap | Regime calendar, Atlas vs. DEX divergence | Haircut h[r] in C2, router targetLTV, caps | Bot inventory, keeper ramps | Gap beyond G_q plus LIF headroom → bad debt |
| Split mis-valuation | `UIMultiplierUpdated`, announcements | × m in C2, freeze plus continuity check, borrow block | Pre-window cap cuts, user notices | Wrong assumption on Atlas units [U] |
| Dividend ex-date dip | Corporate-action calendar | Total-return oracle | Borrow block near LLTV on ex-date | Credit delay larger than the margin; withholding leakage |
| Token pause | Pause-manager `isPaused(token)` poll / pause-manager events | None (Morpho reverts) | Sentinel caps → 0, allocator pulls liquidity | Positions unliquidatable during pause → bad debt |
| Morpho or wrapper blacklisted | Periodic `compliance.check` simulation for Morpho/wrapper; `setCompliance` on the token | None | Issuer relationship, exposure caps | Full freeze of the asset's collateral |
| Beacon upgrade by issuer | `Upgraded` event | None | Monitoring, caps | Arbitrary behavior change |
| Oracle revert / Atlas whitelist removal | Call failure, staleness | try/catch fallback to TWAP or last good price | Alerting, whitelisting agreement | Both sources down beyond freeze max |
| Oracle manipulation via thin DEX | TWAP vs. Atlas divergence | min() of sources, liquidity floor, TWAP window | Monitor pool depth | Simultaneous manipulation of the on-chain markets Atlas reads off-hours (Atlas uses them [F]) |
| Halt / SEC suspension | Nasdaq RSS, SEC | Freeze plus h[HALTED] | Sentinel, governance | Resume far below the frozen price |
| Illiquid exit | Venue depth monitor (≈$1.4–3.4M Pancake TVL per major bStock on 2026-11-26) | PreLiquidation via the BNB factory (smaller lots), conservative LLTV | Own bot, Binance route | Redemption suspended plus DEX depth evaporating in a shock |
| Ineligible user | C9 | Router attestation (C3 enforces it) | Geo/IP, Binance endpoint, sanctions | Raw-token market without C3 is bypassable; VPN use |
| Morpho DAO actions | Safe transactions | Immutable markets | Watch | Fee switch on markets [U policy] |
| Key compromise (sentinel/keeper) | Ops monitoring | Roles can only reduce risk; timelocks on the curator | Multisig, rotation | Griefing: freeze or cap cuts, temporary DoS |

---

## 13. Hackathon scope cut (36h, demo Nov 27) vs. later

**In the 36h demo (BSC testnet or a mainnet fork):**
- One market: NVDAB (or a mock ERC-8056 token deployed from the bep-677 reference) as collateral and USDT as loan, at 62.5% LLTV, on the canonical Morpho at the address above (fork) or a local Morpho deploy (testnet).
- DawnOracle v0: Atlas (or a mock implementing the Atlas interface), × uiMultiplier, regime haircut from a simple RegimeRegistry set by a keeper script, and freeze with max duration. No DEX TWAP if no testnet pool exists.
- Router v0: borrow with targetLTV(regime) and a stubbed eligibility signature.
- Demo script:
  - (1) Borrow during OPEN.
  - (2) Flip to WEEKEND and show the borrow limit tightening and health dropping without liquidating fresh positions.
  - (3) Simulate a 2-for-1 multiplier update. Show the naive oracle triggering mass liquidation versus Dawn's oracle staying continuous.
  - (4) Simulate a gap. Show the liquidation by the Dawn bot.
- UI: UI-unit balances, regime badge, health "now / at weekend".

**Phase 2:**
- Wrapper C3.
- Real eligibility service (Binance endpoint, sanctions).
- Vault V2 with curator/sentinel/allocator multisigs and caps.
- PreLiquidation onboarding.
- Halt RSS monitor.
- Production keeper.

**Phase 3:**
- Gap-quantile pipeline and parameter governance.
- More bStocks and Ondo GM (NAV-accumulation oracle path).
- Dividend ex-date logic.
- Issuer/Atlas agreements (whitelisting Dawn contracts).
- Audits.

---

## 14. Open questions

1. Do Atlas bStock feeds quote per UI share or per raw token? What happened on-chain at SNDKB's `effectiveAt` versus the feed restart? This is decisive for §4.
2. Is the Dawn oracle allowed to read Atlas feeds (whitelist vs. open-read) for each bStock?
3. **Partly answered 2026-11-26.**
   - Answered: the check runs on `from` and `to`, and on `msg.sender` only when the caller is neither of them. There is a separate pause manager. There is no token-level `isBlacklisted`. `decimals()` = 18.
   - Still open: the compliance contract's rule type (blacklist vs allowlist), and whether it supports a freeze distinct from the blacklist.
4. Will the issuer commit to not blacklisting the Morpho singleton, or treat protocol contracts specially? (Venus/Lista precedent suggests protocol contracts pass today; unconfirmed.)
5. **Answered 2026-11-26.**
   - PreLiquidationFactory `0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42`.
   - VaultV2Factory `0x29955201601630f686beAF47b0B03be7b86d160F` (see §0).
   - Remaining: confirm the Vault V2 rows on BscScan.
6. What are the URL, schema and terms of the Binance country-eligibility endpoint? Is the restricted list the issuer's 9 regions or a broader venue list? (Still open; not found 2026-11-26.)
7. What is the Morpho DAO's fee policy on BNB markets? (Fee switch is capped at 25% [F]; policy still open.)
8. **Partly answered 2026-11-26.**
   - Answered: Pancake pool TVL/depth snapshot in §3.2.
   - Still open: RFQ quote sizes and depth under stress.
9. What lag between the dividend ex-date and the multiplier credit has been observed for bStocks?
10. Will the issuer ever migrate contracts (beacon upgrade vs. new token) for spin-offs or mergers?

---

## Checked / Not checked

**Checked (fetched 2026-11-26):**
- Morpho addresses page (BNB address cross-checked with two explorers).
- Morpho liquidation and Vault V2 concept pages.
- Morpho pre-liquidation repo README.
- BNB Chain Scaled UI Amount doc.
- bnb-chain/bep-677-contracts README.
- NVDAB BscScan source file list.
- Binance SNDKB split announcement (2026-11-11, via mirrors).
- Binance Academy bStocks guide (third-party integration, eligibility API).
- Pancake geo-block page.
- Lista bStock oracle configuration.
- Atlas Multi-Feed API docs.
- rwa.xyz corporate-actions methodology.
- Nasdaq Trader halt RSS page.

**Also checked in the 2026-11-26 verification pass:**
- Morpho governance page, Morpho Blue concepts page (LLTV list).
- Gliese Morpho page.
- BscScan: PreLiquidationFactory, Public Allocator, and the SecuritiesToken implementation (source, ABI, bytecode for `decimals` and `_update`).
- BEP-677 and EIP-8056 texts.
- Atlas Push/Pull integration pages and atlasoracle.io.
- Lista lending page.
- Venus resilient-oracle docs and listing/VIP-654 forum posts.
- Binance bStocks FAQ.
- pancake.xyz / tokenstock / livecoinwatch / deviation.wtf pool data.
- Binance Research off-hours volume note, Chaconne spread note, deepidea weekend study.

**Earlier in this research session (not re-fetched this turn):**
- bStocks prospectuses (Jun to Sep 2026).
- Atlas SNDKB notice.
- Circle partner page.
- Aster bStocks doc.
- Competitor research notes.

**Not checked / unverified:**
- Atlas price units (UI vs. raw), any market-status flag, and the bStock heartbeat/deviation.
- Whether Dawn's oracle can read Atlas (whitelist status).
- The compliance contract's rule type (blacklist vs allowlist), and whether Morpho actually passes `compliance.check` today.
- Morpho DAO Safe threshold (5-of-9).
- BNB on-chain `isLltvEnabled` set.
- Chain labels for the Vault V2 rows other than VaultV2Factory and MorphoRegistry.
- Binance eligibility endpoint URL and schema.
- NYSE halt page and SEC suspension feed.
- RFQ quote sizes and depth under stress.
- Dividend credit lag.
- Gas costs on BNB.
- The "26% headroom" figure (not reproduced; 29.6% computed before slippage).

---

## Verification log (Nov 26, 2026)

All sources fetched 2026-11-26.

| # | Item | Result | Source |
|---|---|---|---|
| 1 | Morpho BNB owner = DAO Safe `0xeE02…518F`, no delay | Verified (threshold still unverified) | https://docs.morpho.org/learn/governance/organization/ ; https://gliese.io/protocols/morpho |
| 2 | LLTV list / IRM | Verified (generic list, now includes 0%); BNB on-chain set unverified | https://docs.morpho.org/learn/concepts/blue/ |
| 3 | PreLiquidationFactory on BNB | **Contradicted** README "Ethereum and Base": exists at `0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42` | https://bscscan.com/address/0xEB8871F0FA8aB787AbCD28d1095f7B486d241D42 |
| 4 | Vault V2 factory / adapters / registry / allocators on BNB | Verified (doc row + Gliese prefixes; some rows need BscScan confirmation) | https://docs.morpho.org/developers/contracts/addresses ; https://gliese.io/protocols/morpho |
| 5 | bStock transfer logic (pause → spender-if-third-party → from → to) | Verified (was [U]) | https://bscscan.com/address/0xCFEd6c4679297ea4889F8183bC057B4A86C64e46#code |
| 6 | bStock `decimals()` | Verified = 18; **contradicts** the "eight-decimal" prospectus reading | same as #5 |
| 7 | `UIMultiplierUpdated` signature | **Contradicted**: 3 args, not 4 (`setAt` removed) | same as #5 ; https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-677.md |
| 8 | Multiplier bounds [1e9, 1e27], ≤ 365 days ahead | Verified (new) | same as #5 |
| 9 | fortunepad "no pause switch" | **Contradicted** by the verified source | same as #5 |
| 10 | Token-level `isBlacklisted` view | Does not exist; §6 design changed to `compliance.check` simulation | same as #5 |
| 11 | Morpho needs issuer allowlisting | Still unverified: Morpho must pass compliance both ways; Venus/Lista precedent is only inference | same as #5 ; https://community.venus.io/t/5832 |
| 12 | Dividends via multiplier, 30% withholding | Verified | https://www.binance.com/en/academy (bStocks guide, updated 2026-06-18) ; https://docs.rwa.xyz/methodology/corporate-actions |
| 13 | Atlas Pull mode 18-dec, maxDelay 180 s, whitelist/open-read | Verified | https://docs.atlasoracle.io/developers/atlas-oracle/integrate-the-push-mode |
| 14 | Atlas units (UI vs raw) | Still unverified (indirect evidence for per UI share) | docs.atlasoracle.io ; atlasoracle.io |
| 15 | Atlas market-status flag | Still unverified (none found) | docs.atlasoracle.io |
| 16 | Atlas bStock heartbeat/deviation | Still unverified (only a marketing example) | https://atlasoracle.io |
| 17 | Lista bStock set | **Contradicted** "TSLAB, MUB, NVDAB": now 7 assets; bounds 0.98/1.02 | https://docs.bsc.lista.org/for-developer/multi-oracle/multi-oracle-bstock |
| 18 | Lista Moolah is a Morpho Blue fork | Verified (extended fork: whitelists, upgradeable, 8-dec `peek`) | https://docs.bsc.lista.org/for-developer/lista-lending ; blog.web3wagmi.com (2026-11-13) |
| 19 | Venus bStock caps / CF / LT / oracle | Verified (table in §0) | https://community.venus.io/t/5832 ; https://docs-v4.venus.io/risk/resilient-price-oracle |
| 20 | Atlas feed addresses Venus vs Lista | Discrepancy: different addresses per protocol; reported, not resolved | same as #17 and #19 |
| 21 | Binance eligibility endpoint URL/schema | Still unverified (FAQ confirms it exists; Binance FAQ, Academy, developer docs searched) | https://www.binance.com/en/support/faq/detail/f0c03cd6509a4085b4cce1636f16be38 |
| 22 | Off-hours DEX depth | **Contradicted** "no standing depth": NVDAB ≈ $3.37M TVL, TSLAB ≈ $1.35M, 33/34 pools quote off-hours | pancake.xyz ; tokenstock ; livecoinwatch ; deviation.wtf/stocks |
| 23 | ScaledUI primary source | Verified: BEP-677 (Draft, 2026-04-14) implements EIP-8056 and adds `IERC8056Scheduled` | https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP-677.md ; https://eips.ethereum.org/EIPS/eip-8056 |
