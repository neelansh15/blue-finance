import Link from "next/link";
import type { ReactNode } from "react";

const repo = "https://github.com/neelansh15/dawn-finance/blob/main";

export type DocArticle = {
  slug: string;
  title: string;
  summary: string;
  sections: Array<{ id: string; title: string; body: ReactNode }>;
  sources: Array<{ path: string; title: string }>;
};

function Table({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <div className="docs-table">
      <table>
        <thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map(([label, ...cells], row) => (
            <tr key={row}>
              <th scope="row">{label}</th>
              {cells.map((cell, index) => <td key={index}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const docHref = (slug: string) => slug ? `/docs/${slug}` : "/docs";
export const sourceHref = (path: string) => `${repo}/${path}`;

export const articles: DocArticle[] = [
  {
    slug: "",
    title: "Dawn Finance docs",
    summary: "Dawn is a lending prototype for tokenized US stocks on BNB Chain. It uses the US market calendar to adjust how much collateral can support a USDT loan on Morpho Blue.",
    sections: [
      {
        id: "why-dawn",
        title: "Why market hours matter",
        body: <p>Tokenized stocks can trade while US exchanges are closed. The next stock-market print can arrive at a different price, and a split can change the price per displayed share without changing the value of the underlying position. Dawn adjusts collateral valuation for market sessions and handles changes to the token’s display multiplier.</p>,
      },
      {
        id: "protocol-at-a-glance",
        title: "Protocol at a glance",
        body: <Table columns={["Component", "Responsibility"]} rows={[
          [<Link href="/docs/markets">Morpho Blue</Link>, "Holds isolated markets and handles supply, debt accounting, interest and liquidation."],
          [<Link href="/docs/regimes">RegimeRegistry</Link>, "Combines the US Eastern calendar with time-limited keeper overrides."],
          [<Link href="/docs/oracle">DawnOracle</Link>, "Converts feed prices to raw collateral value, then applies market-session haircuts and freeze logic."],
          [<Link href="/docs/router">DawnRouter</Link>, "Adds eligibility, borrowing limits and market caps to transactions routed through Dawn."],
          [<Link href="/docs/liquidation">LiquidatorCallback</Link>, "Lets an operator repay debt after receiving seized collateral in Morpho’s liquidation callback."],
        ]} />,
      },
      {
        id: "prototype-scope",
        title: "What you can try",
        body: <p>The <Link href="/app/dashboard">app</Link> uses simulated positions and balances. The contract demo creates one MockBStock/USDT market on a local BNB mainnet fork. Read the <Link href="/docs/development">fork and testing guide</Link> to reproduce the contract scenarios, or <Link href="/docs/roadmap">see what still needs verification</Link> before a live deployment.</p>,
      },
    ],
    sources: [
      { path: "architecture-v1.md", title: "Architecture v1" },
      { path: "implementation-plan.md", title: "Implementation plan" },
      { path: "protocol/README.md", title: "Protocol README" },
    ],
  },
  {
    slug: "markets",
    title: "Markets and accounting",
    summary: "Dawn adds a risk layer around the canonical, unmodified Morpho Blue singleton. Each Morpho market has its own collateral, liquidity and borrow balances.",
    sections: [
      {
        id: "market-identity",
        title: "Market identity",
        body: <><p>A market ID is the hash of five immutable parameters.</p><Table columns={["Parameter", "Meaning"]} rows={[
          [<code>loanToken</code>, "The asset lenders supply and borrowers receive. The fork demo uses BNB Chain USDT with 18 decimals."],
          [<code>collateralToken</code>, "The raw token pledged by borrowers. The deploy script creates a MockBStock named bAAPL."],
          [<code>oracle</code>, "DawnOracle supplies the collateral price that Morpho uses for its health checks."],
          [<code>irm</code>, "AdaptiveCurveIrm sets the utilization-sensitive borrowing rate."],
          [<code>lltv</code>, "The liquidation loan-to-value threshold. The fork demo uses 62.5%, expressed as 0.625 × 10¹⁸."],
        ]} /></>,
      },
      {
        id: "supplier-and-borrower-flows",
        title: "Supplier and borrower flows",
        body: <><p>Lenders supply USDT directly to the Morpho market and receive supply shares. Withdrawals depend on available liquidity, and the market’s interest accrual changes the value of those shares. Borrowers supply collateral and take on USDT debt recorded as borrow shares. Accrued interest increases the assets owed per borrow share.</p><p>Collateral and lender supply are distinct balances. A market’s bad debt is borne by suppliers to that market. The router adds a stricter <Link href="/docs/router#borrow-limit">target LTV</Link> for new credit through Dawn. Morpho still enforces LLTV on the position itself.</p></>,
      },
      {
        id: "health",
        title: "Position health",
        body: <><pre><code>{`Collateral value = raw collateral × adjusted oracle price
Health factor    = collateral value × LLTV ÷ accrued debt`}</code></pre><p>With debt outstanding, a health factor below 1 indicates that the position can be liquidated by Morpho, subject to on-chain rounding and execution. Lower prices, larger haircuts and accrued interest can all reduce health. The fork test checks that the demo LLTV and IRM are enabled and that the singleton accepts market creation and supply.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/interfaces/IMorpho.sol", title: "Morpho interface and market ID" },
      { path: "protocol/test/fork/MorphoBnbFork.t.sol", title: "BNB fork market tests" },
      { path: "morpho-blue.md", title: "Morpho Blue research notes" },
    ],
  },
  {
    slug: "regimes",
    title: "Market regimes",
    summary: "RegimeRegistry computes the US Eastern trading session on-chain and lets keepers add bounded overrides for individual assets or the whole registry.",
    sections: [
      {
        id: "calendar",
        title: "Session calendar",
        body: <><Table columns={["Regime", "When it applies (ET)", "Demo haircut"]} rows={[
          [<code>OPEN</code>, "Regular session, 09:30–16:00.", "0%"],
          [<code>EXTENDED</code>, "Pre-market 04:00–09:30 and post-market 16:00–20:00.", "4%"],
          [<code>CLOSED</code>, "Ordinary overnight hours, 20:00–04:00.", "10%"],
          [<code>WEEKEND</code>, "Friday evening through Sunday 20:00 and configured holidays.", "15%"],
          [<code>CORP_ACTION</code>, "Override for a split or other corporate action.", "10% base"],
          [<code>HALTED</code>, "Override for a halt or a paused asset.", "25% base"],
        ]} /><p>EasternCalendar computes daylight saving time. On configured early-close days the regular session ends at 13:00 and the extended session ends at 17:00. Friday’s post-market close and overnight periods leading into configured holidays enter <code>WEEKEND</code>. Sunday after 20:00 is <code>CLOSED</code> unless Monday is a holiday. The admin maintains the holiday and early-close tables.</p></>,
      },
      {
        id: "overrides",
        title: "Keeper overrides",
        body: <><p><code>regime(asset)</code> picks the most conservative of the calendar, the active asset override and the active global override at <code>address(0)</code>. The order is Open → Extended → Closed → Weekend → Corporate action → Halted. This order is separate from the ABI enum numbering, where <code>HALTED = 4</code> and <code>CORP_ACTION = 5</code>.</p><p>Admin and keepers can set an override within the configured duration, up to the contract’s 30-day hard cap. An existing override can only move to an equal or more conservative state and keep or extend its expiry. <code>OPEN</code> is unavailable as an override. Admin can clear one, and keepers can clear only when <code>keeperCanClear</code> is enabled.</p><p>The oracle keeps the current calendar haircut as a floor. For example, a corporate-action override with a 10% base haircut still carries at least 15% during the configured weekend regime.</p></>,
      },
      {
        id: "signals",
        title: "Off-chain signals",
        body: <p>The keeper code combines Nasdaq halt notices, Binance asset and spot status, and a multiplier-event watcher. An unavailable source counts as unknown. Clearing a latched signal requires healthy sources and a fresh price within the continuity band. The keeper also schedules oracle updates. The scripts default to dry run.</p>,
      },
    ],
    sources: [
      { path: "protocol/src/RegimeRegistry.sol", title: "RegimeRegistry" },
      { path: "protocol/src/libraries/EasternCalendar.sol", title: "EasternCalendar" },
      { path: "keepers/README.md", title: "Keeper behavior and configuration" },
    ],
  },
  {
    slug: "oracle",
    title: "Oracle and corporate actions",
    summary: "DawnOracle turns a feed quote into a Morpho-compatible price for raw collateral. It discounts that price according to the effective regime and can fall back to a recorded observation.",
    sections: [
      {
        id: "price",
        title: "From feed price to collateral value",
        body: <><p>The Atlas adapter reads <code>latestAnswer()</code> and <code>latestTimestamp()</code>. If the feed quotes per displayed share, it multiplies the quote by <code>uiMultiplier() / 10¹⁸</code>. If the feed quotes per raw token, it uses the quote directly. The contract adjusts for feed decimals and scales the result by <code>10^(36 + loanDecimals − collateralDecimals)</code> for Morpho.</p><p><code>price()</code> then applies the highest applicable haircut from the current regime, the calendar floor and any active freeze. <code>priceForRegime()</code> is a hypothetical view that retains freeze behavior and omits the current calendar floor. The price source in this implementation is the Atlas-style adapter.</p></>,
      },
      {
        id: "fallback",
        title: "Staleness, freezes and recovery",
        body: <><p>Reverting, invalid or stale feed reads use the last good pre-haircut price. After the observation exceeds <code>MAX_FREEZE</code> in age, a separate haircut applies. Before the first valid observation, a fallback read can revert with <code>NoPrice()</code>. A failing registry read is treated as a halt.</p><p>A halt, corporate action or unreadable or changed multiplier triggers freeze handling. Anyone can call <code>update()</code> to record observations. Once the regime and feed allow it, a fresh price inside the continuity band can clear a freeze. For a persistent gap, the registry admin can call <code>forceUnfreeze()</code> after the freeze period, with a normal regime and valid live price.</p><p>The optional upward jump breaker holds large increases above the configured band against the recorded price. During a jump freeze the oracle can still serve a lower live price. The breaker needs independent review.</p></>,
      },
      {
        id: "splits",
        title: "Splits and UI units",
        body: <><p>Displayed balance equals raw balance × the display multiplier. In a 2-for-1 split, a $200 UI share becomes $100 and the multiplier doubles. The raw balance stays the same and the scaled quote remains $200 per raw unit once both inputs agree.</p><p>The intermediate readings can disagree. The watcher uses <code>UIMultiplierUpdated(old, new, effectiveAt)</code> to flag <code>CORP_ACTION</code> before a scheduled change. A feed-first downward move without that flag can still be priced as a live gap. The demo mocks support scheduling a multiplier and simulating feed failure.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/DawnOracle.sol", title: "DawnOracle" },
      { path: "protocol/src/interfaces/IBStockLike.sol", title: "bStock interface" },
      { path: "protocol/src/mocks/MockBStock.sol", title: "MockBStock" },
      { path: "protocol/test/DawnOracle.t.sol", title: "Oracle tests" },
    ],
  },
  {
    slug: "router",
    title: "Borrowing and eligibility",
    summary: "DawnRouter is the entry point for Dawn’s borrowing rules. It manages positions on the borrower’s behalf through Morpho authorization.",
    sections: [
      {
        id: "actions",
        title: "Position actions",
        body: <Table columns={["Call", "Behavior"]} rows={[
          [<code>supply<wbr />Collateral<wbr />And<wbr />Borrow</code>, "Optionally pulls raw collateral approved to the router and supplies it to Morpho. Borrowing requires a signed eligibility attestation and router authorization in Morpho. A deposit with zero borrow needs no attestation."],
          [<code>withdraw<wbr />Collateral</code>, "Requires Morpho authorization. While debt exists, it checks pause, regime and oracle gates and requires the post-withdrawal position to remain within target LTV. With zero debt those router risk gates do not apply."],
          [<code>repay</code>, "Anyone can repay on behalf of a position. Pass assets or shares, using the outstanding shares for a full repay. Morpho’s callback pulls the exact loan-token amount from the approved payer. Repay remains available during a router pause."],
        ]} />,
      },
      {
        id: "borrow-limit",
        title: "Target LTV and caps",
        body: <><pre><code>{`Target LTV = LLTV × (1 − largest routine haircut) − margin
Debt limit = haircut-adjusted collateral value × target LTV`}</code></pre><p>The largest routine haircut is cached at listing from <code>OPEN</code>, <code>EXTENDED</code>, <code>CLOSED</code> and <code>WEEKEND</code>. The fork defaults give <strong>51.125%</strong> before the current oracle haircut is applied to collateral. Borrows also check the post-accrual total market debt against both the market cap and the active regime cap.</p><p>Borrowing and withdrawals with debt are blocked when the router is paused, the regime is <code>HALTED</code> or <code>CORP_ACTION</code>, or the oracle is frozen or lacks a fresh price. <code>borrowLimit()</code> is a debt ceiling preview. Available liquidity, existing debt, caps and the transaction-time checks also affect execution.</p></>,
      },
      {
        id: "eligibility-and-admin",
        title: "Eligibility and admin controls",
        body: <><p>The configured signer signs EIP-712 <code>Eligibility(account, nonce, expiry)</code>, bound to the chain and router address. Each account nonce is consumed once. The router verifies expiry and a configured maximum validity window. The fork deploy uses a demo signer and a 15-minute window.</p><p>Admin handles market listing, the signer, margins, caps and unpausing. The guardian can pause and cut caps. Admin transfer is two-step. Morpho markets remain permissionless, so callers interacting directly with Morpho do not pass through the Dawn router’s eligibility checks or caps.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/DawnRouter.sol", title: "DawnRouter" },
      { path: "protocol/test/DawnRouter.t.sol", title: "Router tests" },
      { path: "architecture-v1.md#2-trust-assumptions-keys-and-roles", title: "Architecture and trust roles" },
    ],
  },
  {
    slug: "liquidation",
    title: "Liquidation and risk",
    summary: "Morpho decides when a position is liquidatable. Dawn changes the collateral price Morpho reads and provides an optional callback helper for an operator to execute liquidation.",
    sections: [
      {
        id: "how-liquidation-works",
        title: "Liquidation flow",
        body: <><ol>
          <li>Morpho checks the accrued debt against the oracle-priced collateral and LLTV.</li>
          <li>A liquidator repays debt and receives collateral under Morpho’s rules and liquidation incentive.</li>
          <li>For the Dawn helper, Morpho transfers the collateral first and invokes <code>onMorphoLiquidate</code> before collecting the loan tokens.</li>
          <li><code>LiquidatorCallback</code> approves the repayment from pre-funded loan tokens or the proceeds of an owner-selected swap. The helper requires an authorized owner to initiate liquidation and accepts the callback from Morpho during the operation.</li>
        </ol><p>The keeper bot tracks borrowers from market events and simulates liquidations before sending in live mode. It skips frozen oracles by default. This choice applies to the bot. Other Morpho liquidators remain free to act if Morpho’s checks and token transfers succeed.</p></>,
      },
      {
        id: "risk-boundaries",
        title: "Where the buffer stops",
        body: <><p>The fork tests cover positions opened at or below target LTV across ordinary session changes with a stable underlying price. A <code>HALTED</code> override, a genuine price gap, accrued interest or an extra stale-price haircut can still make a position liquidatable.</p><p>Collateral transfer restrictions or an issuer pause can block liquidation even when a position is unhealthy. If collateral is insufficient to cover repayment, Morpho accounts for the loss within that market. The demo assumes USDT is worth one US dollar and does not model a depeg.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/LiquidatorCallback.sol", title: "LiquidatorCallback" },
      { path: "protocol/test/LiquidatorCallback.t.sol", title: "Callback tests" },
      { path: "protocol/test/scenarios/Scenarios.t.sol", title: "Fork scenario tests" },
      { path: "keepers/README.md#liquidation-bot", title: "Liquidation bot" },
    ],
  },
  {
    slug: "development",
    title: "Build, fork and test",
    summary: "The Solidity project lives in protocol/ and uses Foundry. The deploy script and fork tests share market creation and configuration code.",
    sections: [
      {
        id: "setup",
        title: "Build locally",
        body: <><p>The project pins Solidity 0.8.28 and Shanghai EVM. Install the pinned forge-std dependency before building.</p><pre><code>{`cd protocol
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build
forge test`}</code></pre><p>Fork suites use <code>BSC_RPC_URL</code> or the repository’s default BNB endpoint. Unavailable RPCs can cause fork tests to skip. Check the test output for skips when validating fork behavior.</p></>,
      },
      {
        id: "fork-deployment",
        title: "Local fork deployment",
        body: <><p><code>Deploy.s.sol</code> creates the registry, mock collateral, mock feed, oracle and router. It seeds 2026–2027 calendar dates, creates and lists the test market on the fork, optionally supplies seed liquidity and writes <code>deployments/&lt;chainId&gt;.json</code>. A local BNB fork can also report chain ID 56. The manifest identifies the fork deployment and does not establish a live Dawn market.</p><Table columns={["Fork default", "Value"]} rows={[
          ["Morpho market", "Mock bAAPL / USDT, AdaptiveCurveIrm, 62.5% LLTV"],
          ["Oracle guardrails", "5% continuity band, 30% upward jump band, 12-hour freeze bound, 10% extra stale-price haircut"],
          ["Feed staleness", "1 hour during open and extended sessions, 4 hours overnight and 6 hours on weekends. Halt and corporate action use 1 hour."],
          ["Router allowances", "2 percentage-point margin. Total cap 1M USDT. Regime caps are 1M open, 500k extended, 250k closed and weekend, zero halted or corporate action."],
          ["Keeper and signer", "3-day override duration limit, keeper clearing disabled by default, 15-minute attestation window"],
        ]} /><p>These parameters are illustrative. The demo signer is public by design. Follow the repository’s local-fork instructions for deployment options.</p></>,
      },
      {
        id: "demo-scenarios",
        title: "What the tests demonstrate",
        body: <ol>
          <li>Borrow in regular market hours through the router.</li>
          <li>Move to the weekend and observe reduced borrowing capacity. Variants exercise every routine session and the higher haircut in a halt.</li>
          <li>Apply a 2-for-1 split and compare the multiplier-aware oracle with a naive oracle. A variant covers a feed-first update with the keeper flag set.</li>
          <li>Move the price down and exercise Morpho liquidation through the callback helper.</li>
        </ol>,
      },
    ],
    sources: [
      { path: "protocol/README.md", title: "Foundry setup and deployment instructions" },
      { path: "protocol/INTERFACES.md", title: "Shared contract interfaces" },
      { path: "protocol/script/DawnDeploy.sol", title: "Fork defaults and deployment" },
      { path: "protocol/test/scenarios/Scenarios.t.sol", title: "Scenario suite" },
    ],
  },
  {
    slug: "roadmap",
    title: "Design history and open questions",
    summary: "The initial plan explored a standalone lending core. The implementation uses canonical Morpho Blue with Dawn’s own oracle, calendar and router.",
    sections: [
      {
        id: "design-decisions",
        title: "What carried forward",
        body: <p>The v0 plan proposed isolated markets, stablecoin lending, US session awareness, and special handling of splits and transfer restrictions. Architecture v1 chose the Morpho singleton for accounting and liquidation. The fork prototype uses a single feed adapter, stepped haircuts and Morpho’s liquidation incentive. The initial plan also explored a DEX TWAP, pre-close ramps and regime-specific incentives, which are outside the current contracts.</p>,
      },
      {
        id: "verification",
        title: "Open verification work",
        body: <ul>
          <li>Confirm live Atlas feed units, access permissions and timing around bStock multiplier changes.</li>
          <li>Verify issuer transfer and compliance requirements for Morpho, the router and liquidators. The mock lacks those controls.</li>
          <li>Calibrate haircuts and caps against price-gap history and executable exit liquidity. Review the upward jump breaker and the feed-first split case.</li>
          <li>Maintain the holiday calendar, keeper heartbeat and fallback processes. Validate the live halt signals and dividend timing.</li>
        </ul>,
      },
      {
        id: "later-phases",
        title: "Later phases",
        body: <p>The plan calls for a collateral wrapper to enforce the router-only path, a real eligibility service, curated Vault V2 liquidity, PreLiquidation onboarding, production operations and audits. Additional collateral markets, dividend-specific logic, leverage and shorting remain future work.</p>,
      },
    ],
    sources: [
      { path: "idea-progression.md", title: "Idea progression" },
      { path: "architecture-v0.md", title: "Initial architecture draft" },
      { path: "architecture-v1.md", title: "Architecture v1 and open questions" },
      { path: "implementation-plan.md", title: "Implementation plan" },
    ],
  },
];
