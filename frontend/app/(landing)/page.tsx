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
    body: "To borrow, your wallet needs a valid approval for the bStock you want to use as collateral.",
  },
  {
    title: "Supply a bStock",
    body: "Deposit TSLAB, NVDAB, QQQB, SPCXB or GOOGLB as collateral in Blue’s Aave V3 pool on BNB Chain. Each account uses one collateral stock.",
  },
  {
    title: "Borrow USDT",
    body: "Your borrowing limit depends on your collateral value, the stock’s market status, the remaining debt cap for that stock and the USDT available in the pool.",
  },
  {
    title: "Monitor your position",
    body: "Track your health factor as prices and debt change. A position can be liquidated when its health factor falls below 1 and the pool can value and transfer the collateral.",
  },
];

const FEATURES = [
  {
    icon: <IconMarketStatus />,
    title: "Lower borrowing limits outside regular hours",
    body: "Blue lowers each stock’s loan-to-value limit after the regular session. That limit also applies if you withdraw collateral while you still owe USDT. With prices and debt held fixed, a session change leaves your health factor the same.",
  },
  {
    icon: <IconOracle />,
    title: "Stricter price checks for new loans",
    body: "Atlas supplies bStock prices and Chainlink prices USDT. A valid price gap can affect an existing loan’s health as soon as it appears in the feed. A large gap pauses new borrowing against the stock until an admin accepts a fresh price.",
  },
  {
    icon: <IconSplit />,
    title: "Stock splits",
    body: "A 2-for-1 split can halve the displayed share price while doubling the number of shares shown. The keeper marks the stock CORP_ACTION ahead of a known split. This blocks new borrowing for that stock, and a changed multiplier stops pricing until the admin accepts a round that reflects it.",
  },
  {
    icon: <IconHalt />,
    title: "Trading halts, per stock",
    body: "When Tesla is halted, Blue blocks new Tesla-backed loans and withdrawals of Tesla collateral that still backs a loan. Borrowers can repay in USDT. Other eligible stocks can still draw from the shared reserve when USDT is available.",
  },
  {
    icon: <IconShield />,
    title: "Eligibility and keeper checks",
    body: "Blue requires a valid approval for the borrowing wallet and stock. If monitoring lapses, new loans pause. Borrowers with debt can still withdraw within the current loan-to-value limit if the pool has valid prices and no active halt, corporate action or guardian hold applies.",
  },
  {
    icon: <IconSteps />,
    title: "Liquidation with Aave",
    body: "Aave uses collateral value and accrued debt to calculate your health factor. Below 1, a liquidator can repay debt and take collateral when price and transfer checks pass. Any shortfall affects the shared USDT reserve.",
  },
];

const ROADMAP = [
  {
    tag: "Pool design",
    title: "Shared USDT liquidity",
    items: [
      "One Aave V3 pool with five bStock collateral reserves",
      "Atlas stock pricing and borrowing limits for each stock and session",
    ],
    now: true,
  },
  {
    tag: "Launch preparation",
    title: "Eligibility and monitoring",
    items: ["Connect the app and keepers to the pool", "Set up wallet eligibility, halt monitoring and the holiday calendar"],
  },
  {
    tag: "Mainnet",
    title: "Capped BNB Chain launch",
    items: ["Calibrate launch limits against price gaps and liquidation depth", "Complete security review and confirm production license eligibility"],
  },
  {
    tag: "Exploratory",
    title: "Additional strategies",
    items: ["Leveraged borrowing", "Shorting once borrowable stock-token supply exists"],
  },
];

const DOCS = [
  { file: "architecture-v3.md", title: "Protocol architecture", body: "Aave V3 pool, stock borrow controls, pricing and liquidation." },
  { file: "protocol/README.md", title: "Contracts and deployment", body: "Aave V3 contracts, BNB Chain asset configuration and deployment instructions." },
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
                Blue brings USDT loans backed by Binance bStocks into one Aave V3 pool on BNB Chain. Borrowing limits are set per stock and tighten outside regular US market hours.
              </p>
              <div className="ctas">
                <Link className="btn" href="/app/simplified">Explore the app <IconArrow /></Link>
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
              <h2 id="market-status-title">How market hours change your borrowing limit</h2>
              <p>Pick a session or drag the timeline to see how much your collateral can support. With price and debt held fixed, the health factor stays the same.</p>
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
            <h2 id="roadmap-title">The path to BNB Chain mainnet</h2>
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
                  <span><strong>Protocol docs</strong><small>How Blue’s Aave V3 pool, borrowing rules and liquidation work.</small></span>
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
        </div>
      </footer>
    </>
  );
}
