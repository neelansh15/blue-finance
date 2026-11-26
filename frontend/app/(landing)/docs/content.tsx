import Link from "next/link";
import type { ReactNode } from "react";

const repo = "https://github.com/neelansh15/blue-finance/blob/main";

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
    title: "Blue Finance docs",
    summary: "Blue is a lending protocol for tokenized US stocks on BNB Chain. One Aave V3 pool shares USDT liquidity across five bStocks. New borrowing follows the limits for each stock and US market session.",
    sections: [
      {
        id: "why-blue",
        title: "Why market hours matter",
        body: <p>Tokenized stocks can trade while US exchanges are closed. The next stock-market print can arrive at a different price, and a split can change the price per displayed share without changing the value of the underlying position. Blue lowers new borrowing power outside regular hours, keeps liquidation rules fixed, and blocks new loans around halts and corporate actions.</p>,
      },
      {
        id: "protocol-at-a-glance",
        title: "Protocol at a glance",
        body: <Table columns={["Component", "Responsibility"]} rows={[
          [<Link href="/docs/markets">BluePool</Link>, "One Aave V3.6 pool with a shared USDT reserve and five collateral-only bStock reserves."],
          [<Link href="/docs/borrowing-rules">StockBorrowControls</Link>, "Signed eligibility, keeper heartbeat, guardian hold and per-stock debt caps that gate new borrowing."],
          [<Link href="/docs/oracle">StockPriceSource</Link>, "Prices each stock from Atlas with separate standards for liquidation and new borrowing. USDT is priced by Chainlink."],
          [<Link href="/docs/market-status">MarketCalendar</Link>, "Gives each stock a market status from the US Eastern calendar, with bounded keeper and admin overrides."],
          [<Link href="/docs/liquidation">Liquidation</Link>, "Aave’s liquidation mechanism uses a threshold independent of the market calendar."],
        ]} />,
      },
      {
        id: "prototype-scope",
        title: "BNB Chain launch",
        body: <p>The roadmap calls for a capped BNB Chain mainnet launch. The <Link href="/docs/markets">pool guide</Link> covers supported collateral and the shared USDT reserve. See <Link href="/docs/roadmap#verification">launch preparations</Link> for eligibility, monitoring and risk calibration.</p>,
      },
    ],
    sources: [
      { path: "architecture-v3.md", title: "Architecture v3" },
      { path: "protocol/README.md", title: "Protocol README" },
      { path: "implementation-plan.md", title: "Implementation plan" },
    ],
  },
  {
    slug: "markets",
    title: "Pool model and accounting",
    summary: "Blue’s Aave V3 pool uses a single USDT reserve. Lenders supply USDT once, and each borrowing account uses one bStock as collateral.",
    sections: [
      {
        id: "reserves",
        title: "Reserves and tokens",
        body: <><p>BluePool is built on Aave V3 Origin 3.6.0. It has six reserves.</p><Table columns={["Reserve", "Role"]} rows={[
          [<code>USDT</code>, "The only borrowable asset. Lenders supply it and borrowers draw it from the same shared liquidity."],
          [<code>TSLAB, NVDAB, QQQB, SPCXB, GOOGLB</code>, "Real bStock tokens on BNB Chain. Collateral only. Each account uses one collateral stock."],
        ]} /><p>Lenders receive <strong>bluUSDT</strong>, Blue’s name for the Aave aToken. Borrower debt is recorded as <strong>bluDebtUSDT</strong>, an Aave variable debt token. USDT withdrawals depend on available liquidity. Flash loans are disabled.</p></>,
      },
      {
        id: "supplier-and-borrower-flows",
        title: "Supplier and borrower flows",
        body: <><p>Lenders supply USDT once, and borrowers do not need a lender or allocator to move cash between stock markets. Borrowers supply one stock, enable it as collateral and borrow USDT at a variable rate. Accrued interest increases the debt.</p><p>Because liquidity is shared, USDT suppliers are exposed to losses across all listed stocks. Per-stock debt caps limit new concentration. Aave isolation enforces one active stock per account, and Blue tracks each stock’s accrued USDT debt from Aave’s scaled debt and the current reserve index.</p></>,
      },
      {
        id: "parameters",
        title: "Risk parameters",
        body: <><Table columns={["Parameter", "Value"]} rows={[
          ["Base LTV", "50% for every stock"],
          ["Liquidation threshold", "62.5% for every stock"],
          ["Liquidation bonus", "5%"],
        ]} /><p>These values come from the deployment script. Mainnet parameters are subject to calibration against historical price gaps and executable liquidation depth.</p></>,
      },
      {
        id: "health",
        title: "Position health",
        body: <><pre><code>{`Collateral value = collateral × stock price
Health factor    = collateral value × 62.5% ÷ debt`}</code></pre><p>Below 1, liquidation can proceed when the pool has usable prices and collateral transfers are permitted. With prices and debt fixed, a calendar change leaves the health factor unchanged.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/BluePool.sol", title: "BluePool" },
      { path: "protocol/script/BlueV3Deployment.sol", title: "Pool and reserve configuration" },
      { path: "architecture-v3.md#1-how-borrowing-works", title: "How borrowing works" },
    ],
  },
  {
    slug: "market-status",
    title: "Market status",
    summary: "MarketCalendar computes each stock’s status from the US Eastern calendar. The status sets that stock’s borrowing discount and debt cap.",
    sections: [
      {
        id: "calendar",
        title: "Borrowing limits by market status",
        body: <><p>The table shows the values configured in the deployment script. The debt cap applies to accrued USDT debt across all borrowers using the same stock.</p><Table columns={["Status", "When it applies (ET)", "Effective LTV", "Debt cap per stock"]} rows={[
          [<code>OPEN</code>, "Regular session, 9:30 a.m. to 4 p.m.", "50%", "400 USDT"],
          [<code>EXTENDED</code>, "Pre-market and after-hours.", "48%", "300 USDT"],
          [<code>CLOSED</code>, "Overnight before a trading day.", "45%", "200 USDT"],
          [<code>WEEKEND</code>, "Friday 8 p.m. to Sunday 8 p.m. and exchange holidays.", "42.5%", "100 USDT"],
          [<code>HALTED</code>, "Trading halt set by a keeper or admin.", "Borrowing blocked", "Not applicable"],
          [<code>CORP_ACTION</code>, "Split or other corporate action in progress.", "Borrowing blocked", "Not applicable"],
        ]} /><p>With $1,000 in collateral, the weekend LTV sets a $425 collateral-based limit. The stock’s 100 USDT cap limits total debt against that stock. A new loan depends on the remaining room under that cap and the available USDT in the pool.</p><p>The current LTV also applies to withdrawals while debt is outstanding. Liquidation uses a separate threshold, so a session change alone leaves health unchanged when prices and debt are fixed.</p></>,
      },
      {
        id: "overrides",
        title: "Keeper and admin overrides",
        body: <p>The schedule comes from the on-chain US Eastern calendar. The keeper or admin can apply a stricter status for a limited time, never a looser one. The deployer can set holidays, early closes and temporary overrides through <code>MarketCalendar</code>. Before launch the holiday calendar must be seeded.</p>,
      },
      {
        id: "halts",
        title: "Halts and corporate actions",
        body: <p>A stock-specific <code>HALTED</code> or <code>CORP_ACTION</code> override blocks new borrowing against that stock and withdrawals of collateral backing outstanding debt. Repayment remains available. Other eligible stocks can draw from the shared reserve while USDT is available. Set <code>CORP_ACTION</code> before a known split. A feed that updates before the multiplier can otherwise trigger liquidation.</p>,
      },
    ],
    sources: [
      { path: "protocol/src/MarketCalendar.sol", title: "MarketCalendar" },
      { path: "protocol/src/libraries/EasternCalendar.sol", title: "EasternCalendar" },
      { path: "protocol/script/BlueV3Deployment.sol", title: "Configured limits and caps" },
    ],
  },
  {
    slug: "oracle",
    title: "Pricing and corporate actions",
    summary: "StockPriceSource reads Atlas feeds and applies one standard for valuation and liquidation and a stricter one for new borrowing. USDT is priced by Chainlink.",
    sections: [
      {
        id: "price",
        title: "Valuation and liquidation price",
        body: <><p>Health and liquidation read the live Atlas round when all of these hold.</p><ul>
          <li>The round is under 24 hours old.</li>
          <li>The price is inside a fixed price band for the stock.</li>
          <li>The multiplier matches the one from the last accepted price.</li>
          <li>The stock is not in <code>CORP_ACTION</code>.</li>
        </ul><p>A large move within the permitted price band can affect valuation as soon as it appears in the feed. Atlas bStock feeds quote per raw token and have 8 decimals.</p></>,
      },
      {
        id: "borrow-price",
        title: "Price for new borrowing",
        body: <p>New borrowing requires the latest stock feed price and timestamp to match the accepted values. The round can be at most 2 hours old. The configured reporter or admin can call <code>refresh()</code> to accept a new round that passes the checks. A move greater than 20% from the accepted price requires the admin to accept a fresh reference with <code>acceptReference()</code>.</p>,
      },
      {
        id: "usdt-and-second-source",
        title: "USDT and a second source",
        body: <><p>Chainlink’s USDT/USD feed prices USDT. A round over an hour old stops new borrowing. Valuation accepts valid rounds up to 24 hours old.</p><p>The BNB Chain configuration uses Atlas for all five bStocks. An optional second feed can cross-check Atlas for new loans. Liquidations use the primary feed. The APRO module for TSLAB, NVDAB, QQQB and SPCXB requires APRO to allowlist Blue’s contracts.</p></>,
      },
      {
        id: "splits",
        title: "Splits and UI units",
        body: <p>Displayed balance equals raw balance × the display multiplier. In a 2-for-1 split, a $200 UI share becomes $100 and the multiplier doubles, while the raw balance and the per-raw-token value stay the same. A changed multiplier stops pricing until the admin accepts a round that reflects it. The keeper sets <code>CORP_ACTION</code> ahead of an announced split so a feed-first update is not read as a crash.</p>,
      },
    ],
    sources: [
      { path: "protocol/src/StockPriceSource.sol", title: "StockPriceSource" },
      { path: "protocol/src/interfaces/IPriceFeed.sol", title: "Price feed interface" },
      { path: "protocol/script/AproCrossCheck.sol", title: "Optional APRO module" },
      { path: "protocol/script/BscMainnet.sol", title: "BNB Chain feed addresses" },
    ],
  },
  {
    slug: "borrowing-rules",
    title: "Borrowing rules and eligibility",
    summary: "New loans require wallet eligibility, current keeper permission and usable prices. The pool enforces borrowing limits and caps. These stock-specific controls leave USDT repayment available.",
    sections: [
      {
        id: "borrow-checks",
        title: "Checks on a new borrow",
        body: <><p>The pool checks the debt owner’s signed eligibility, the stock’s current borrow permission, the LTV for the stock’s current market status, and USDT caps. Borrowing is blocked for a stock when:</p><ul>
          <li>its status is <code>HALTED</code> or <code>CORP_ACTION</code>;</li>
          <li>the keeper heartbeat has lapsed or the 30-minute recovery window is still in progress;</li>
          <li>a guardian hold is set;</li>
          <li>the price is too old or needs admin review for new borrowing.</li>
        </ul><p>A stock-specific restriction leaves other eligible stocks able to borrow while USDT is available. The pool continues to accept repayment during these restrictions.</p></>,
      },
      {
        id: "caps",
        title: "Per-stock debt caps",
        body: <p>Each stock has a debt cap that tightens as its status becomes more conservative. A cap reduction prevents new draws above the cap while existing debt remains outstanding. USDT also has reserve-wide supply and borrow caps.</p>,
      },
      {
        id: "withdrawals",
        title: "Withdrawals with debt",
        body: <p>A missed heartbeat or a price that is too old for new borrowing still permits withdrawals of debt-backed collateral within the current LTV when valuation remains usable. A halt, corporate action or guardian hold blocks those withdrawals. Transfers of the collateral’s bluToken follow the same rule for the sender.</p>,
      },
      {
        id: "eligibility-and-admin",
        title: "Eligibility and admin controls",
        body: <p>A configured signer issues an approval for a borrowing wallet and stock. The borrower registers it on the controls contract against <code>eligibilityDigest(borrower, stock, nonces(borrower), expiry)</code>. The keeper reports each stock’s health and renews borrow permission. The guardian can place a hold or lower caps. The admin can release a hold or raise caps.</p>,
      },
    ],
    sources: [
      { path: "protocol/src/StockBorrowControls.sol", title: "StockBorrowControls" },
      { path: "protocol/src/BluePool.sol", title: "BluePool" },
      { path: "architecture-v3.md#2-stock-specific-borrowing-controls", title: "Stock-specific borrowing controls" },
    ],
  },
  {
    slug: "liquidation",
    title: "Liquidation and risk",
    summary: "Blue uses Aave’s liquidation mechanism. Liquidation requires a health factor below 1, usable prices and a permitted collateral transfer.",
    sections: [
      {
        id: "how-liquidation-works",
        title: "Liquidation flow",
        body: <ol>
          <li>Aave computes the health factor: collateral value × 62.5% ÷ debt.</li>
          <li>Below 1, a liquidator can call <code>liquidationCall</code>, repay eligible debt in USDT and receive collateral with the configured 5% bonus.</li>
          <li>The pool values collateral using the latest Atlas round that meets the <Link href="/docs/oracle#price">valuation rules</Link>.</li>
          <li>If collateral cannot cover the debt, Aave’s deficit accounting records the bad debt.</li>
        </ol>,
      },
      {
        id: "risk-boundaries",
        title: "Where the buffer stops",
        body: <><p>The borrowing discount applies to borrowing and withdrawals with debt. A drop in collateral value or an increase in debt can push the health factor below 1.</p><p>The bStock issuer can pause a token or change its compliance rules, which can block supply, withdrawal and liquidation transfers. A shortfall is shared across the USDT reserve, so USDT suppliers carry exposure to every listed stock. Liquidation stops for a stock while its valuation is unusable, including during <code>CORP_ACTION</code>.</p></>,
      },
    ],
    sources: [
      { path: "protocol/src/BluePool.sol", title: "BluePool" },
      { path: "protocol/test/BluePool.t.sol", title: "Pool scenario tests" },
      { path: "architecture-v3.md#3-pricing-and-liquidations", title: "Pricing and liquidations" },
    ],
  },
  {
    slug: "development",
    title: "Build, fork and test",
    summary: "The Solidity project lives in protocol/ and uses Foundry with Aave V3 Origin 3.6.0. DeployBsc.s.sol deploys the BNB Chain listing, and you rehearse it on a local Anvil fork first.",
    sections: [
      {
        id: "setup",
        title: "Build locally",
        body: <><pre><code>{`cd protocol
npm ci
forge install foundry-rs/forge-std@v1.9.7 --no-git
forge build
forge test`}</code></pre><p>Test tokens and test feeds live in <code>test/utils/</code> and are never deployed. The fork suites are skipped unless you set <code>BLUE_RUN_BNB_FORK_TESTS=true</code> and point <code>BSC_RPC_URL</code> at a BNB mainnet RPC. They run in Foundry’s local fork and send nothing to BNB mainnet.</p></>,
      },
      {
        id: "tests",
        title: "Test suites",
        body: <Table columns={["Suite", "What it covers"]} rows={[
          [<code>BluePoolTest</code>, "Offline scenarios with test bStocks, test feeds and test USDT, so halts, splits and price gaps can be scripted."],
          [<code>BluePoolBnbForkTest</code>, "The same scenarios with real USDT in a local BNB mainnet fork."],
          [<code>BscMainnetForkTest</code>, "The real listing: all five bStocks, their Atlas feeds and Chainlink USDT/USD. A TSLAB loan goes through supply, borrow, repay and withdraw."],
          [<code>AproCrossCheckForkTest</code>, "The optional APRO module against live feeds, with checks for both allowlisted and unauthorized callers."],
        ]} />,
      },
      {
        id: "fork-deployment",
        title: "Local fork deployment",
        body: <><p><code>DeployBsc.s.sol</code> configures the pool with the BNB Chain assets and feeds. Start an Anvil fork, set <code>BLUE_KEEPER</code>, <code>BLUE_GUARDIAN</code> and <code>BLUE_SIGNER</code>, then dry-run the script against the local RPC. Use a guardian address different from the deployer.</p><pre><code>{`anvil --fork-url "$BSC_RPC_URL" --chain-id 56

forge script script/DeployBsc.s.sol:DeployBsc \
  --rpc-url http://127.0.0.1:8545 \
  --account <local-keystore> --sender <local-deployer>`}</code></pre><p>To deploy on the local fork, repeat the <code>forge script</code> command with <code>--broadcast</code> against the same local RPC. Set <code>BLUE_SEED_USDT</code> in raw 18-decimal units to seed the reserve from a funded deployer account.</p><p>The script checks the chain ID and USDT code. A mainnet broadcast requires <code>BLUE_ALLOW_MAINNET=true</code> and explicit owner approval.</p></>,
      },
      {
        id: "listing",
        title: "BNB Chain listing",
        body: <p><code>BscMainnet.sol</code> holds the token and feed addresses for TSLAB, NVDAB, QQQB, SPCXB, GOOGLB, USDT and the Chainlink USDT/USD feed, checked on-chain on November 27, 2026. The Atlas feed addresses are the instances Lista lists, and reads are open to any caller.</p>,
      },
    ],
    sources: [
      { path: "protocol/README.md", title: "Build, test and deploy instructions" },
      { path: "protocol/script/DeployBsc.s.sol", title: "DeployBsc script" },
      { path: "protocol/script/BscMainnet.sol", title: "BNB Chain listing" },
      { path: "protocol/test/BscMainnetFork.t.sol", title: "BscMainnetForkTest" },
      { path: "protocol/test/AproCrossCheckFork.t.sol", title: "AproCrossCheckForkTest" },
    ],
  },
  {
    slug: "roadmap",
    title: "Design history and open questions",
    summary: "The first prototype used Morpho Blue with a custom oracle and router. The current design is one Aave V3 pool with stock-specific borrowing controls.",
    sections: [
      {
        id: "design-decisions",
        title: "What carried forward",
        body: <p>The earlier plans proposed stablecoin lending against stocks, US session awareness and special handling of splits and transfer restrictions. Architecture v1 used isolated Morpho Blue markets, and v3 replaces them with one Aave V3 pool and a shared USDT reserve. The calendar carried over as <code>MarketCalendar</code>. The Morpho prototype is archived in <code>protocol-old/</code> for reference.</p>,
      },
      {
        id: "license",
        title: "License",
        body: <p>BluePool and the deployment scripts build on Aave V3 Origin 3.6.0 under BUSL-1.1. It becomes available under the MIT license on March 6, 2027, or an earlier date the Aave DAO records. Blue’s own contracts (StockBorrowControls, StockPriceSource, MarketCalendar) are MIT.</p>,
      },
      {
        id: "verification",
        title: "Mainnet launch preparations",
        body: <ul>
          <li>Calibrate the risk parameters in <code>BlueV3Deployment.sol</code> against price-gap history and executable liquidation depth.</li>
          <li>Confirm with Atlas which feed instances Blue should use, and decide on a second price source.</li>
          <li>Connect the app and keepers to the Aave pool. Set up the signer service, halt monitoring and holiday calendar.</li>
          <li>Confirm issuer transfer permissions for bStocks and how shared-reserve deficits are handled.</li>
          <li>Complete a security review and confirm license eligibility for production use.</li>
        </ul>,
      },
    ],
    sources: [
      { path: "idea-progression.md", title: "Idea progression" },
      { path: "architecture-v1.md", title: "Architecture v1 (Morpho, archived)" },
      { path: "architecture-v3.md", title: "Architecture v3" },
      { path: "protocol-old/README.md", title: "Archived Morpho prototype" },
    ],
  },
];
