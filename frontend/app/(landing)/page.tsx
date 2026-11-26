import Image from "next/image";
import Link from "next/link";
import MarketStatusExplorer from "../components/MarketStatusExplorer";
import SiteNav from "../components/SiteNav";
import BrandLogo from "../components/BrandLogo";
import TokenIcon from "../components/TokenIcon";
import BStockPrices from "../components/BStockPrices";
import {
  IconArrow,
  IconDoc,
  IconHalt,
  IconOracle,
  IconMarketStatus,
  IconShield,
  IconSplit,
  IconSteps,
} from "../components/Icons";

const REPO = "https://github.com/neelansh15/blue-finance/blob/main";

const STEPS = [
  {
    title: "Check eligibility",
    body: "The fork demo uses a test signature. The planned eligibility service will check whether your wallet can borrow.",
  },
  {
    title: "Supply a bStock",
    body: "Deposit TSLAB, NVDAB, QQQB, SPCXB or GOOGLB as collateral in Blue’s Aave V3 pool on BNB Chain. Each account uses one collateral stock.",
  },
  {
    title: "Borrow USDT",
    body: "Your loan limit starts at a 50% base LTV and shrinks with a borrowing discount when the stock’s market is closed. All borrowers draw from the same USDT reserve, and your debt is recorded as bluDebtUSDT.",
  },
  {
    title: "Monitor your position",
    body: "Liquidation uses a 62.5% threshold that does not change with the calendar. Compare your loan’s distance from liquidation during regular hours and over the weekend.",
  },
];

const FEATURES = [
  {
    icon: <IconMarketStatus />,
    title: "Borrowing discounts for market hours",
    body: "Each stock has a market status from the US Eastern calendar: OPEN, EXTENDED, CLOSED or WEEKEND. The borrowing discount is 0%, 4%, 10% and 15%. It lowers how much you can newly borrow only. The health factor and liquidation threshold stay the same.",
  },
  {
    icon: <IconOracle />,
    title: "Separate prices for borrowing and liquidation",
    body: "Liquidation reads the live Atlas price when it is under 24 hours old, inside a fixed price band and not in a corporate action, so a real crash reaches liquidators immediately. New borrowing also needs a keeper-accepted price under 2 hours old, and a move over 20% needs admin review. USDT is priced by Chainlink.",
  },
  {
    icon: <IconSplit />,
    title: "Stock splits",
    body: "A 2-for-1 split can halve the displayed share price while doubling the number of shares shown. The keeper marks the stock CORP_ACTION ahead of a known split. This blocks new borrowing for that stock, and a changed multiplier stops pricing until the admin accepts a round that reflects it.",
  },
  {
    icon: <IconHalt />,
    title: "Trading halts, per stock",
    body: "HALTED and CORP_ACTION block new borrowing against that stock only. Other stocks keep lending from the shared USDT reserve, and repayment always works. Per-stock debt caps tighten as the market status gets more conservative.",
  },
  {
    icon: <IconShield />,
    title: "Eligibility and keeper checks",
    body: "StockBorrowControls checks a signed eligibility for each account and stock, and a keeper heartbeat with a 30-minute recovery window. A guardian can hold borrowing. If monitoring lapses, borrowers can still withdraw collateral within their limit, as on Zona Lend.",
  },
  {
    icon: <IconSteps />,
    title: "Liquidation with Aave",
    body: "Anyone can call Aave’s standard liquidationCall when collateral value × 62.5% ÷ debt falls below 1. The liquidation bonus is 5%. If collateral cannot cover the debt, Aave’s deficit accounting records the bad debt.",
  },
];

const ROADMAP = [
  {
    tag: "Now",
    title: "Prototype",
    items: [
      "One Aave V3 pool with a shared USDT reserve and five bStock collateral reserves, deployed on a local BNB Chain fork",
      "Market-status borrowing discounts, per-stock debt caps and Atlas pricing",
    ],
    now: true,
  },
  {
    tag: "Phase 2",
    title: "Production controls",
    items: ["Eligibility service and production halt monitoring", "A second price source (APRO) once APRO whitelists Blue"],
  },
  {
    tag: "Phase 3",
    title: "Calibration and review",
    items: ["Historical gap analysis and risk parameters", "Holiday calendar, keeper integration and a security review"],
  },
  {
    tag: "Exploratory",
    title: "Additional strategies",
    items: ["Leveraged borrowing", "Shorting once borrowable stock-token supply exists"],
  },
];

const DOCS = [
  { file: "architecture-v3.md", title: "Protocol architecture", body: "Aave V3 pool, stock borrow controls, pricing and liquidation." },
  { file: "protocol/README.md", title: "Contracts and deployment", body: "Aave V3 contracts, BNB Chain listing, tests and fork deployment." },
  { file: "README.md", title: "Project overview", body: "Blue’s scope and research files." },
  { file: "idea-progression.md", title: "Design decisions", body: "How the project direction evolved." },
];

export default function Home() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <SiteNav />

      <main id="main" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap hero-sheet">
            <div className="hero-copy">
              <p className="eyebrow">Tokenized stock lending on BNB Chain</p>
              <h1 id="hero-title">
                <span>Borrow against tokenized stocks.</span> <em>Keep your stock exposure.</em>
              </h1>
              <p className="lead">
                Blue is building USDT loans backed by real tokenized US stocks on BNB Chain, from one Aave V3 pool with shared USDT liquidity. When a stock’s market closes, Blue lowers how much you can newly borrow against it to account for price gaps at the next open.
              </p>
              <div className="ctas">
                <Link className="btn" href="/app/simplified">Try in Simplified Mode <IconArrow /></Link>
                <Link className="text-link" href="/docs/markets">Read the architecture <IconArrow /></Link>
              </div>
            </div>

            <div className="market-window">
              <figure className="market-clock" id="problem">
                <figcaption>
                  <strong>Trading hours</strong>
                  <span>Weekday · US Eastern</span>
                </figcaption>
                <p className="sr-only">
                  The regular US stock session runs from 9:30 a.m. to 4 p.m. Eastern on weekdays. Tokenized stocks
                  can trade around the clock, including weekends.
                </p>
                <div className="clock-rows" aria-hidden="true">
                  <span>US stocks <small>Regular session</small></span>
                  <div className="clock-rail clock-rail-stock"><i /></div>
                  <span>Tokenized stocks <small>24/7</small></span>
                  <div className="clock-rail clock-rail-token"><i /></div>
                  <div className="clock-axis">
                    <span>00:00</span><span>09:30</span><span>16:00</span><span>24:00</span>
                  </div>
                </div>
              </figure>
              <BStockPrices />
            </div>
          </div>
        </section>

        <section className="wrap market-demo" id="market-status" aria-labelledby="market-status-title" tabIndex={-1}>
          <div className="demo-heading">
            <div>
              <h2 id="market-status-title">How a weekend changes your loan</h2>
              <p>Pick a session or drag the timeline to see how the borrowing ceiling and liquidation health change for the same position.</p>
            </div>
            <span className="demo-caption">Illustrative · US Eastern</span>
          </div>
          <MarketStatusExplorer />
        </section>

        <section className="wrap editorial-section" id="how" aria-labelledby="how-title" tabIndex={-1}>
          <div className="editorial-intro">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">How a stock-backed USDT loan works</h2>
            <p>
              Lenders supply USDT to one Aave V3 pool and receive bluUSDT. Borrowers put up one bStock and draw from the same USDT liquidity. The pool checks each stock’s market status, price and debt cap before new borrowing.
            </p>
            <figure className="collateral-figure">
              <Image
                src="/assets/collateral-blueprint.webp"
                alt=""
                width={1000}
                height={563}
                unoptimized
              />
              <figcaption>
                <span className="collateral-asset">
                  <TokenIcon symbol="NVDAB" />
                  <span><strong>NVDAB</strong><small>Collateral</small></span>
                </span>
                <IconArrow />
                <span className="collateral-asset">
                  <TokenIcon symbol="USDT" />
                  <span><strong>USDT</strong><small>Loan</small></span>
                </span>
              </figcaption>
            </figure>
          </div>
          <ol className="flow">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="flow-n num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="risk-section" id="risk" aria-labelledby="risk-title" tabIndex={-1}>
          <div className="wrap editorial-section">
            <div className="editorial-intro">
              <p className="eyebrow">Risk design</p>
              <h2 id="risk-title">What can change your loan limit</h2>
              <p>
                US stock exchanges close while tokenized shares can keep trading. A price gap at reopening, a stock split or a trading halt can change how much a position can borrow.
              </p>
              <a className="text-link" href={`${REPO}/architecture-v3.md#2-stock-specific-borrowing-controls`}>
                Read the risk analysis <IconArrow />
              </a>
            </div>
            <div className="risk-list">
              {FEATURES.map((feature, index) => (
                <details key={feature.title} open={index === 0}>
                  <summary>
                    <span className="risk-icon">{feature.icon}</span>
                    <span>{feature.title}</span>
                    <span className="disclosure-icon" aria-hidden="true" />
                  </summary>
                  <p>{feature.body}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <div className="wrap project-layout">
          <section id="roadmap" aria-labelledby="roadmap-title" tabIndex={-1}>
            <p className="eyebrow">Roadmap</p>
            <h2 id="roadmap-title">One pool for the prototype</h2>
            <ol className="roadmap">
              {ROADMAP.map((stage) => (
                <li className={stage.now ? "stage-now" : undefined} key={stage.tag}>
                  <p className="stage-tag">{stage.tag}</p>
                  <div>
                    <h3>{stage.title}</h3>
                    <ul>{stage.items.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="docs" aria-labelledby="docs-title" tabIndex={-1}>
            <p className="eyebrow">Documentation</p>
            <h2 id="docs-title">Read the design</h2>
            <ul className="docs">
              <li>
                <Link href="/docs">
                  <IconDoc />
                  <span><strong>Protocol docs</strong><small>How Blue’s Aave V3 pool, borrowing rules and fork deployment work.</small></span>
                  <IconArrow />
                </Link>
              </li>
              {DOCS.map((doc) => (
                <li key={doc.file}>
                  <a href={`${REPO}/${doc.file}`}>
                    <IconDoc />
                    <span><strong>{doc.title}</strong><small>{doc.body}</small></span>
                    <IconArrow />
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a className="brand" href="#top" aria-label="Blue Finance, back to top">
            <BrandLogo />
          </a>
          <p>Built on BNB Chain and Aave V3</p>
          <p>BNB Bangkok prototype · Not live</p>
        </div>
      </footer>
    </>
  );
}
