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
    summary: "Blue is a lending prototype for tokenized US stocks on BNB Chain. It runs one Aave V3 pool with a shared USDT reserve and uses the US market calendar to limit new borrowing against each stock.",
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
          [<Link href="/docs/markets">BluePool</Link>, "One Aave V3.6 pool on BNB Chain. A shared USDT reserve plus five collateral-only bStock reserves: TSLAB, NVDAB, QQQB, SPCXB and GOOGLB."],
          [<Link href="/docs/borrowing-rules">StockBorrowControls</Link>, "Signed eligibility, keeper heartbeat, guardian hold and per-stock debt caps that gate new borrowing."],
          [<Link href="/docs/oracle">StockPriceSource</Link>, "Prices each stock from Atlas with separate standards for liquidation and new borrowing. USDT is priced by Chainlink."],
          [<Link href="/docs/market-status">MarketCalendar</Link>, "Gives each stock a market status from the US Eastern calendar, with bounded keeper and admin overrides."],
          [<Link href="/docs/liquidation">Liquidation</Link>, "Aave’s standard liquidationCall at a fixed 62.5% threshold."],
        ]} />,
      },
      {
        id: "prototype-scope",
        title: "What you can try",
        body: <p>The <Link href="/app/dashboard">app</Link> uses simulated positions and balances. No real transactions are sent. The contracts deploy to a local Anvil fork of BNB Chain with the real bStocks, Atlas feeds and USDT. Read the <Link href="/docs/development">fork and testing guide</Link> to reproduce the contract scenarios, or <Link href="/docs/roadmap">see what still needs verification</Link> before a live deployment. The earlier Morpho Blue prototype is archived in <code>protocol-old/</code>.</p>,
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
    summary: "Blue runs one Aave V3 pool with a single USDT reserve. Lenders and borrowers share the same liquidity, and each account borrows against one collateral stock.",
    sections: [
      {
        id: "reserves",
        title: "Reserves and tokens",
        body: <><p>BluePool is built on Aave V3 Origin 3.6.0. It has six reserves.</p><Table columns={["Reserve", "Role"]} rows={[
          [<code>USDT</code>, "The only borrowable asset. Lenders supply it and borrowers draw it from the same shared liquidity."],
          [<code>TSLAB, NVDAB, QQQB, SPCXB, GOOGLB</code>, "Real bStock tokens on BNB Chain. Collateral only. Each account uses one collateral stock."],
        ]} /><p>Lenders receive <strong>bluUSDT</strong>, Blue’s name for the Aave aToken. Borrower debt is recorded as <strong>bluDebtUSDT</strong>, an Aave variable debt token. Withdrawals depend on how much USDT is available. Flash loans are disabled in the prototype.</p></>,
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
        ]} /><p>These are prototype values and need calibration against gap history and executable liquidation depth before launch.</p></>,
      },
      {
        id: "health",
        title: "Position health",
        body: <><pre><code>{`Collateral value = collateral × stock price
Health factor    = collateral value × 62.5% ÷ debt`}</code></pre><p>A health factor below 1 makes the position liquidatable. The threshold does not depend on market status, so a calendar change alone leaves the health factor unchanged when prices and debt are fixed.</p></>,
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
        title: "Status and borrowing discount",
        body: <><Table columns={["Status", "When it applies (ET)", "Borrowing discount"]} rows={[
          [<code>OPEN</code>, "Regular session, 9:30am to 4:00pm.", "0%"],
          [<code>EXTENDED</code>, "Pre-market and after-hours.", "4%"],
          [<code>CLOSED</code>, "Weekday overnight.", "10%"],
          [<code>WEEKEND</code>, "Weekends and exchange holidays.", "15%"],
          [<code>HALTED</code>, "Trading halt set by the keeper or admin.", "New borrowing blocked"],
          [<code>CORP_ACTION</code>, "Split or other corporate action in progress.", "New borrowing blocked"],
        ]} /><p>The discount lowers borrowing power only. For example, $1,000 of collateral at the 50% base LTV supports $500 in regular hours and $425 with the 15% weekend discount. The health factor and liquidation use the 62.5% threshold and do not change with the calendar. These figures are illustrative.</p></>,
      },
      {
        id: "overrides",
        title: "Keeper and admin overrides",
        body: <p>The schedule comes from the on-chain US Eastern calendar. The keeper or admin can apply a stricter status for a limited time, never a looser one. The deployer can set holidays, early closes and temporary overrides through <code>MarketCalendar</code>. Before launch the holiday calendar must be seeded.</p>,
      },
      {
        id: "halts",
        title: "Halts and corporate actions",
        body: <p><code>HALTED</code> and <code>CORP_ACTION</code> block new borrowing for that stock only. Other stocks continue drawing USDT from the shared reserve, and repayment always works. Set <code>CORP_ACTION</code> before a known split. Otherwise a feed that updates before the multiplier looks like a crash and can trigger liquidations.</p>,
      },
    ],
    sources: [
      { path: "protocol/src/MarketCalendar.sol", title: "MarketCalendar" },
      { path: "protocol/src/libraries/EasternCalendar.sol", title: "EasternCalendar" },
      { path: "keepers/README.md", title: "Keeper behavior and configuration" },
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
        </ul><p>A large move is accepted for valuation, so a genuine crash reaches liquidators immediately without waiting for review. Atlas bStock feeds quote per raw token and have 8 decimals.</p></>,
      },
      {
        id: "borrow-price",
        title: "Price for new borrowing",
        body: <p>New borrowing also needs the keeper to have accepted a round under 2 hours old. A move of more than 20% stops new loans until the admin calls <code>acceptReference()</code>. Anyone can call <code>refresh()</code> on the price source to accept new feed rounds that pass the checks.</p>,
      },
      {
        id: "usdt-and-second-source",
        title: "USDT and a second source",
        body: <><p>USDT is priced from Chainlink’s USDT/USD feed. A round over an hour old stops new borrowing, and valuation accepts rounds up to 24 hours old.</p><p><strong>The demo prices every stock with Atlas alone.</strong> StockPriceSource supports an optional second feed that must agree with Atlas before new borrowing, never for liquidation. <code>AproCrossCheck.sol</code> holds an APRO setup for TSLAB, NVDAB, QQQB and SPCXB. It is not used in the demo, because APRO feeds only answer contracts APRO has whitelisted.</p></>,
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
    summary: "StockBorrowControls gates every new loan with eligibility, a keeper heartbeat, a guardian hold and per-stock debt caps. Repayment is never blocked.",
    sections: [
      {
        id: "borrow-checks",
        title: "Checks on a new borrow",
        body: <><p>The pool checks the debt owner’s signed eligibility, the stock’s current borrow permission, the LTV for the stock’s current market status, and USDT caps. Borrowing is blocked for a stock when:</p><ul>
          <li>its status is <code>HALTED</code> or <code>CORP_ACTION</code>;</li>
          <li>the keeper heartbeat has lapsed and the 30-minute recovery window has not completed;</li>
          <li>a guardian hold is set;</li>
          <li>the price is too old or needs admin review for new borrowing.</li>
        </ul><p>Other stocks keep borrowing, and repayment always works.</p></>,
      },
      {
        id: "caps",
        title: "Per-stock debt caps",
        body: <p>Each stock has a debt cap that tightens as its status becomes more conservative. A cap reduction prevents new draws above the cap while existing debt remains outstanding. USDT also has reserve-wide supply and borrow caps.</p>,
      },
      {
        id: "withdrawals",
        title: "Withdrawals with debt",
        body: <p>A missed heartbeat alone still lets borrowers withdraw collateral within the current limit when the price is valid, as on Zona Lend. A halt, corporate action or guardian hold blocks withdrawals while the account has debt.</p>,
      },
      {
        id: "eligibility-and-admin",
        title: "Eligibility and admin controls",
        body: <p>A configured signer signs an eligibility for each borrower and stock. The borrower registers it on the controls contract against <code>eligibilityDigest(borrower, stock, nonces(borrower), expiry)</code>. The keeper reports each stock’s health and renews borrow permission. The guardian can hold borrowing or lower caps, and the admin can release a hold or raise caps.</p>,
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
    summary: "Blue uses Aave’s standard liquidationCall. A position is liquidatable when its health factor falls below 1 at the fixed 62.5% threshold.",
    sections: [
      {
        id: "how-liquidation-works",
        title: "Liquidation flow",
        body: <ol>
          <li>Aave computes the health factor: collateral value × 62.5% ÷ debt.</li>
          <li>Below 1, any liquidator can call <code>liquidationCall</code>, repay part of the debt in USDT and receive collateral with a 5% bonus.</li>
          <li>The price comes from the live Atlas round under the valuation rules above, so a genuine crash reaches liquidators immediately.</li>
          <li>If collateral cannot cover the debt, Aave’s deficit accounting records the bad debt.</li>
        </ol>,
      },
      {
        id: "risk-boundaries",
        title: "Where the buffer stops",
        body: <><p>The borrowing discount and base LTV leave room below the 62.5% threshold for ordinary session changes. A genuine price gap, accrued interest or a halt can still make a position liquidatable.</p><p>The bStock issuer can pause a token or change its compliance rules, which would block supply, withdrawal and liquidation transfers. A shortfall is shared across the USDT reserve, so USDT suppliers carry exposure to every listed stock. Liquidation stops for a stock while its valuation is unusable, for example during <code>CORP_ACTION</code>.</p></>,
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
          [<code>AproCrossCheckForkTest</code>, "The optional APRO module against live feeds. It agrees with Atlas once whitelisting is simulated, and refuses contracts APRO has not whitelisted."],
        ]} />,
      },
      {
        id: "fork-deployment",
        title: "Local fork deployment",
        body: <><p><code>DeployBsc.s.sol</code> deploys the real listing. Start an Anvil fork, set <code>BLUE_KEEPER</code>, <code>BLUE_GUARDIAN</code> and <code>BLUE_SIGNER</code> (the guardian must differ from the deployer), then run the script against the local RPC.</p><pre><code>{`anvil --fork-url "$BSC_RPC_URL" --chain-id 56

forge script script/DeployBsc.s.sol:DeployBsc \
  --rpc-url http://127.0.0.1:8545 \
  --account <local-keystore> --sender <local-deployer>`}</code></pre><p>The script checks the chain ID and USDT code, and refuses a non-Anvil RPC unless <code>BLUE_ALLOW_MAINNET=true</code>. A mainnet broadcast needs explicit owner approval. Set <code>BLUE_SEED_USDT</code> to seed the reserve.</p></>,
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
        title: "Before launch",
        body: <ul>
          <li>Calibrate the risk parameters in <code>BlueV3Deployment.sol</code> against price-gap history and executable liquidation depth.</li>
          <li>Confirm with Atlas which feed instances Blue should use, and decide on a second price source.</li>
          <li>Seed the holiday calendar and integrate the keepers and halt signals.</li>
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
