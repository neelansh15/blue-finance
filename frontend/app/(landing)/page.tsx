import Image from "next/image";
import Link from "next/link";
import RegimeExplorer from "../components/RegimeExplorer";
import SiteNav from "../components/SiteNav";
import BrandLogo from "../components/BrandLogo";
import TokenIcon from "../components/TokenIcon";
import {
  IconArrow,
  IconDoc,
  IconHalt,
  IconOracle,
  IconRegime,
  IconShield,
  IconSplit,
  IconSteps,
} from "../components/Icons";

const REPO = "https://github.com/neelansh15/dawn-finance/blob/main";

const BSTOCK_EXAMPLES = [
  { name: "NVIDIA", symbol: "NVDAB" },
  { name: "Tesla", symbol: "TSLAB" },
  { name: "Apple", symbol: "AAPLB" },
] as const;

const STEPS = [
  {
    title: "Check eligibility",
    body: "The fork demo uses a test signature. The planned eligibility service will check whether your wallet can borrow.",
  },
  {
    title: "Supply a tokenized stock",
    body: "Deposit a tokenized stock as collateral in its own Morpho Blue market on BNB Chain.",
  },
  {
    title: "Borrow USDT",
    body: "Your loan limit depends on what Dawn values your collateral at during that session. The router sets the limit below Morpho’s liquidation threshold.",
  },
  {
    title: "Monitor your position",
    body: "Compare your loan’s distance from liquidation during regular hours and over the weekend.",
  },
];

const FEATURES = [
  {
    icon: <IconRegime />,
    title: "Adjustments for market hours",
    body: "Dawn discounts collateral more when the underlying stock market is closed. In the fork demo, those discounts change at session boundaries.",
  },
  {
    icon: <IconOracle />,
    title: "Conservative collateral pricing",
    body: "If the feed is stale or unavailable, the oracle can use its last recorded price with an additional discount as that price ages. The router requires a fresh price for new loans.",
  },
  {
    icon: <IconSplit />,
    title: "Stock splits",
    body: "A 2-for-1 split can halve the displayed share price while doubling the number of shares shown. Dawn uses the token’s share multiplier and can hold the last recorded price while the feed and token update.",
  },
  {
    icon: <IconHalt />,
    title: "Trading halts and token pauses",
    body: "A halt override blocks new loans through the router. The oracle can hold the last recorded price and apply a larger discount.",
  },
  {
    icon: <IconShield />,
    title: "Eligibility checks",
    body: "The router checks a short-lived signature before allowing a loan. The service that would verify borrower eligibility is planned.",
  },
  {
    icon: <IconSteps />,
    title: "Liquidation on Morpho",
    body: "Morpho can liquidate a loan when debt exceeds the market’s limit for its collateral. Smaller, opt-in repayments before that threshold are planned through PreLiquidation.",
  },
];

const ROADMAP = [
  {
    tag: "Now",
    title: "Prototype",
    items: [
      "One mock stock / USDT market on a local BNB Chain fork",
      "Regime-based collateral pricing and borrow limits",
    ],
    now: true,
  },
  {
    tag: "Phase 2",
    title: "Production controls",
    items: ["Wrapped collateral and eligibility service", "Vault caps, production halt monitoring and opt-in PreLiquidation"],
  },
  {
    tag: "Phase 3",
    title: "Calibration and assets",
    items: ["Historical gap analysis and risk parameters", "More collateral assets, dividend logic and audits"],
  },
  {
    tag: "Exploratory",
    title: "Additional strategies",
    items: ["Leverage vaults", "Shorting once borrowable stock-token supply exists"],
  },
];

const DOCS = [
  { file: "architecture-v1.md", title: "Protocol architecture", body: "Oracle, regimes, router and liquidation design." },
  { file: "README.md", title: "Project overview", body: "Dawn’s scope and research files." },
  { file: "morpho-blue.md", title: "Morpho Blue research", body: "Markets, oracles, liquidation and vaults." },
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
                Borrow against tokenized stocks. <em>Keep your stock exposure.</em>
              </h1>
              <p className="lead">
                Dawn is building USDT loans backed by tokenized US stocks. When the stock market closes, Dawn lends
                against a smaller share of your collateral value to account for price gaps at the next open.
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
              <div className="stock-strip">
                <p id="stock-examples">Examples of bStocks</p>
                <ul aria-labelledby="stock-examples">
                  {BSTOCK_EXAMPLES.map(({ name, symbol }) => (
                    <li key={symbol}>
                      <TokenIcon symbol={symbol} />
                      <span><strong>{name}</strong><small>{symbol}</small></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section className="wrap market-demo" id="regimes" aria-labelledby="regimes-title" tabIndex={-1}>
          <div className="demo-heading">
            <div>
              <h2 id="regimes-title">How a weekend changes your loan</h2>
              <p>Pick a session or drag the timeline to see how the borrowing ceiling and liquidation health change for the same position.</p>
            </div>
            <span className="demo-caption">Illustrative · US Eastern</span>
          </div>
          <RegimeExplorer />
        </section>

        <section className="wrap editorial-section" id="how" aria-labelledby="how-title" tabIndex={-1}>
          <div className="editorial-intro">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">How a stock-backed USDT loan works</h2>
            <p>
              Lenders supply USDT and borrowers put up tokenized stock. Morpho handles the loan, while Dawn sets the collateral price and checks the borrowing limit.
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
                  <span><strong>NVDAB</strong><small>Demo collateral</small></span>
                </span>
                <IconArrow />
                <span className="collateral-asset">
                  <TokenIcon symbol="USDT" />
                  <span><strong>USDT</strong><small>Demo loan</small></span>
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
              <a className="text-link" href={`${REPO}/architecture-v1.md#12-per-risk-table`}>
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
            <h2 id="roadmap-title">One market for the prototype</h2>
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
                  <span><strong>Protocol docs</strong><small>How Dawn’s contracts, risk rules and fork demo work.</small></span>
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
          <p>Built on BNB Chain and Morpho Blue</p>
          <p>BNB Bangkok prototype · Not live</p>
        </div>
      </footer>
    </>
  );
}
