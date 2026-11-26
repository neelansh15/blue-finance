import PositionPreview from "./components/PositionPreview";
import RegimeExplorer from "./components/RegimeExplorer";
import Reveal from "./components/Reveal";
import {
  IconArrow,
  IconDoc,
  IconHalt,
  IconLogo,
  IconOracle,
  IconRegime,
  IconShield,
  IconSplit,
  IconSteps,
} from "./components/Icons";

const REPO = "https://github.com/neelansh15/dawn-finance/blob/main";

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
    title: "Market-hour adjustments",
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
    body: "Dawn accounts for the bStock display multiplier so a split can change the displayed balance without creating an artificial drop in collateral value.",
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
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <nav className="wrap nav-inner" aria-label="Primary">
          <a className="brand" href="#top" aria-label="Dawn Finance, back to top">
            <IconLogo />
            <span>Dawn Finance</span>
          </a>
          <ul className="nav-links">
            <li><a href="#regimes">Simulator</a></li>
            <li><a href="#how">How it works</a></li>
            <li className="hide-sm"><a href="#risk">Risk layer</a></li>
            <li className="hide-sm"><a href="#roadmap">Roadmap</a></li>
            <li className="hide-sm"><a href="#docs">Docs</a></li>
          </ul>
          <span className="nav-status">
            <span className="status-dot" aria-hidden="true" />
            Prototype
          </span>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="wrap hero-copy">
            <p className="eyebrow">Tokenized US equities on BNB Chain</p>
            <h1 id="hero-title">
              Stock-backed lending <span>that follows market hours.</span>
            </h1>
            <p className="lead">
              Borrow stablecoins using tokenized US stocks as collateral. Dawn adjusts borrowing power as US
              markets open and close.
            </p>
            <div className="ctas">
              <a className="btn btn-primary" href="#regimes">
                Try the simulator
                <IconArrow />
              </a>
              <a className="btn btn-quiet" href={`${REPO}/architecture-v1.md`}>
                Read the architecture
                <IconArrow />
              </a>
            </div>
          </div>
        </section>

        <section className="market-demo" id="regimes" aria-labelledby="regimes-title">
          <div className="wrap">
            <div className="panel">
              <div className="demo-head">
                <div>
                  <p className="kicker">Market-hours simulator</p>
                  <h2 id="regimes-title">See borrowing power change</h2>
                </div>
                <span className="illustrative-tag">Illustrative</span>
              </div>
              <div className="demo-body">
                <RegimeExplorer />
                <p className="panel-foot">
                  Move the slider or select a point on the chart. Times are US Eastern. The haircuts are examples
                  and will be calibrated against historical price gaps.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section gap-section" id="problem" aria-labelledby="problem-title">
          <Reveal className="wrap gap-layout">
            <div className="section-head">
              <p className="kicker">The market gap</p>
              <h2 id="problem-title">The token can trade while the stock market is closed</h2>
              <p className="intro">
                Onchain trading continues after hours. When the underlying market reopens, the stock can jump past
                its last traded price. Dawn values collateral more conservatively outside regular hours.
              </p>
            </div>
            <dl className="market-facts">
              <div>
                <dt>Tokenized stocks</dt>
                <dd className="fact-figure num">24/7</dd>
                <dd>Onchain trading</dd>
              </div>
              <div>
                <dt>Underlying stocks</dt>
                <dd className="fact-figure num">6.5<span>h</span></dd>
                <dd>Regular US session per weekday</dd>
              </div>
            </dl>
          </Reveal>
        </section>

        <section className="section section-raised" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">How it works</p>
              <h2 id="how-title">From stock collateral to a stablecoin loan</h2>
              <p className="intro">
                Morpho Blue handles lending in isolated markets. Dawn adds a router and oracle to manage the risks
                specific to tokenized stocks.
              </p>
            </Reveal>
            <div className="loan-layout">
              <ol className="flow">
                {STEPS.map((step, index) => (
                  <li className="flow-step" key={step.title}>
                    <span className="flow-n num" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <PositionPreview />
            </div>
          </div>
        </section>

        <section className="section" id="risk" aria-labelledby="risk-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">The risk layer</p>
              <h2 id="risk-title">How Dawn handles equity risk</h2>
              <p className="intro">
                One isolated market per collateral and loan pair limits how bad debt can spread. Dawn’s risk layer
                also accounts for market events that affect the token or the underlying stock.
              </p>
            </Reveal>
            <div className="features">
              {FEATURES.map((feature) => (
                <article className="feature" key={feature.title}>
                  <span className="feature-icon">{feature.icon}</span>
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.body}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="section section-raised" id="roadmap" aria-labelledby="roadmap-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">Roadmap</p>
              <h2 id="roadmap-title">One market for the prototype</h2>
              <p className="intro">The BNB Bangkok prototype focuses on NVDAB collateral and USDT borrowing. Later phases are proposed.</p>
            </Reveal>
            <ol className="roadmap">
              {ROADMAP.map((stage) => (
                <li className={`stage${stage.now ? " stage-now" : ""}`} key={stage.tag}>
                  <p className="stage-tag">{stage.tag}</p>
                  <h3>{stage.title}</h3>
                  <ul>
                    {stage.items.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section" id="docs" aria-labelledby="docs-title">
          <Reveal className="wrap docs-layout">
            <div className="section-head">
              <p className="kicker">Documentation</p>
              <h2 id="docs-title">Read the design</h2>
              <p className="intro">Explore the architecture, research and decisions behind the prototype.</p>
            </div>
            <ul className="docs">
              {DOCS.map((doc) => (
                <li key={doc.file}>
                  <a href={`${REPO}/${doc.file}`}>
                    <span className="doc-icon"><IconDoc /></span>
                    <span className="doc-text">
                      <strong>{doc.title}</strong>
                      <span>{doc.body}</span>
                    </span>
                    <span className="doc-arrow"><IconArrow /></span>
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <a className="brand brand-footer" href="#top" aria-label="Dawn Finance, back to top">
            <IconLogo />
            <span>Dawn Finance</span>
          </a>
          <div>
            <p className="disclaimer">BNB Bangkok prototype, Nov 2026. Not live.</p>
            <p className="small">Built on BNB Chain and Morpho Blue. Parameters are subject to change. Simulator values are illustrative and do not constitute financial advice.</p>
          </div>
        </div>
      </footer>
    </>
  );
}
