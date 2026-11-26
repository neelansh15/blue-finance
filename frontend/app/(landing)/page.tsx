import Image from "next/image";
import Link from "next/link";
import RegimeExplorer from "../components/RegimeExplorer";
import SiteNav from "../components/SiteNav";
import TokenIcon from "../components/TokenIcon";
import {
  IconArrow,
  IconDoc,
  IconHalt,
  BlueprintLogo as IconLogo,
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
    body: "The eligibility service checks your address and issues a short-lived attestation for the Dawn router.",
  },
  {
    title: "Supply a tokenized stock",
    body: "Post a bStock as collateral in an isolated Morpho Blue market on BNB Chain.",
  },
  {
    title: "Borrow stablecoins",
    body: "The router checks how much you can borrow using the oracle price, market regime and a target loan-to-value ratio below the liquidation threshold.",
  },
  {
    title: "Monitor your position",
    body: "Track your borrow limit and weekend health so you can see how the position would hold up when the market closes.",
  },
];

const FEATURES = [
  {
    icon: <IconRegime />,
    title: "Adjustments for market hours",
    body: "A regime registry tracks market hours, halts and corporate actions. The oracle starts adjusting collateral value before the close to reduce the impact of a sudden change.",
  },
  {
    icon: <IconOracle />,
    title: "Conservative collateral pricing",
    body: "Dawn’s oracle design uses the Atlas price feed and applies a regime-specific haircut. It can fall back to the last good price for a limited time if the feed fails.",
  },
  {
    icon: <IconSplit />,
    title: "Stock splits and dividends",
    body: "The oracle accounts for changes to the bStock display multiplier. That protects against false price jumps when splits or dividends change the displayed balance.",
  },
  {
    icon: <IconHalt />,
    title: "Trading halts and token pauses",
    body: "Keepers monitor halt and pause signals. Dawn’s design cuts market caps, restricts new borrows through the router and can freeze the oracle price with a haircut.",
  },
  {
    icon: <IconShield />,
    title: "Eligibility checks",
    body: "The router requires a short-lived attestation based on location, sanctions screening and the bStock’s address-level compliance rules.",
  },
  {
    icon: <IconSteps />,
    title: "Partial liquidations",
    body: "Opt-in PreLiquidation allows smaller partial closes before the market’s liquidation threshold. Morpho Blue liquidations remain permissionless.",
  },
];

const ROADMAP = [
  {
    tag: "Now",
    title: "Prototype",
    items: [
      "One NVDAB / USDT market on a testnet or fork",
      "Regime-based collateral pricing and borrow limits",
    ],
    now: true,
  },
  {
    tag: "Phase 2",
    title: "Production controls",
    items: ["Wrapped collateral and eligibility service", "Vault caps, halt monitoring and opt-in PreLiquidation"],
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
                The stock market closes. <em>Collateral keeps trading.</em>
              </h1>
              <p className="lead">
                Borrow stablecoins against tokenized US stocks. Dawn adjusts borrowing power to account for the
                risk of price gaps when the underlying market reopens.
              </p>
              <div className="ctas">
                <a className="btn" href="#regimes">Explore the simulator <IconArrow /></a>
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
              <h2 id="regimes-title">One position, through the trading week</h2>
              <p>Choose a session or scrub the timeline to see what changes for the same loan.</p>
            </div>
            <span className="demo-caption">Illustrative · US Eastern</span>
          </div>
          <RegimeExplorer />
        </section>

        <section className="wrap editorial-section" id="how" aria-labelledby="how-title" tabIndex={-1}>
          <div className="editorial-intro">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">From stock collateral to a stablecoin loan</h2>
            <p>
              Morpho Blue handles lending in isolated markets. Dawn adds a router and oracle to manage the risks
              specific to tokenized stocks.
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
              <h2 id="risk-title">Built for the way stocks trade</h2>
              <p>
                Each collateral and loan pair has its own market. Dawn’s risk layer also accounts for events
                that affect the token or the underlying stock.
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
          <a className="brand" href="#top" aria-label="Dawn Finance, back to top">
            <IconLogo />
            <span>Dawn Finance</span>
          </a>
          <p>Built on BNB Chain and Morpho Blue</p>
          <p>BNB Bangkok prototype · Not live</p>
        </div>
      </footer>
    </>
  );
}
