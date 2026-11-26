import PositionPreview from "./components/PositionPreview";
import RegimeExplorer from "./components/RegimeExplorer";
import Reveal from "./components/Reveal";
import {
  IconArrow,
  IconDoc,
  IconHalt,
  IconIsolated,
  IconLogo,
  IconOracle,
  IconRegime,
  IconShield,
  IconSplit,
  IconSteps,
} from "./components/Icons";

const REPO = "https://github.com/neelansh15/dawn-finance/blob/main";

const FEATURES = [
  {
    icon: <IconRegime />,
    title: "Regime-aware borrowing power",
    body: "A regime registry tracks Open, Extended, Closed, Weekend, Halted and Corporate-action states. The oracle applies a haircut per regime and ramps it in before the close instead of stepping.",
  },
  {
    icon: <IconOracle />,
    title: "Conservative oracle",
    body: "Collateral is valued at the lower of the primary feed and a DEX TWAP. A missing or stale source adds a haircut. In the normal path the oracle never reverts, so liquidations keep working.",
  },
  {
    icon: <IconSplit />,
    title: "Corporate actions",
    body: "bStock splits and reinvested dividends arrive through a display multiplier. Dawn prices per raw token, blocks new borrows around the event and freezes to the last good price until a continuity check passes.",
  },
  {
    icon: <IconHalt />,
    title: "Halts and pauses",
    body: "Keepers watch the Nasdaq halt feed and the token pause manager. On a halt, caps are cut, new borrows stop and the price freezes with a haircut for a bounded time.",
  },
  {
    icon: <IconShield />,
    title: "Compliance handling",
    body: "Borrows through the router need a short-lived eligibility attestation: geo checks, sanctions screening and a simulation of the token's own compliance check for the address.",
  },
  {
    icon: <IconSteps />,
    title: "Gentler liquidations",
    body: "Opt-in PreLiquidation enables smaller partial closes before the LLTV. Morpho Blue liquidation stays permissionless, and Dawn's backstop bot has no special privileges.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Check eligibility",
    body: "The eligibility service checks location, sanctions and the token's compliance rules for your address, then signs a short-lived attestation.",
  },
  {
    n: "02",
    title: "Post a tokenized stock",
    body: "Supply a bStock as collateral through the Dawn router into an isolated market on Morpho Blue. Balances are shown in UI units.",
  },
  {
    n: "03",
    title: "Borrow stablecoins",
    body: "The router sizes your limit from the oracle price, the current regime and a target LTV stricter than the market LLTV.",
  },
  {
    n: "04",
    title: "Stay ahead of the gap",
    body: "Keepers update the regime, watch splits, dividends and halts, and route any liquidation through gentler partial closes first.",
  },
];

const ROADMAP = [
  {
    tag: "Now",
    title: "Hackathon demo",
    when: "BNB Bangkok, Nov 2026",
    items: [
      "One NVDAB / USDT market at 62.5% LLTV, testnet or mainnet fork",
      "DawnOracle v0 with regime haircuts and bounded freeze",
      "Router v0 with regime-based target LTV",
    ],
    now: true,
  },
  {
    tag: "Phase 2",
    title: "Production plumbing",
    when: "Planned",
    items: ["Wrapped collateral for router-only borrowing", "Eligibility service and Vault V2 with caps", "PreLiquidation onboarding and halt monitor"],
  },
  {
    tag: "Phase 3",
    title: "Parameters and breadth",
    when: "Planned",
    items: ["Gap-quantile pipeline for haircuts and LLTVs", "More bStocks and NAV-accumulating tokens", "Dividend ex-date logic and audits"],
  },
  {
    tag: "Later",
    title: "Leverage and shorting",
    when: "Exploratory",
    items: ["Leverage vault on the same markets and risk layer", "Shorting once borrowable equity-token supply exists"],
  },
];

const DOCS = [
  { file: "architecture-v1.md", title: "Architecture v1", body: "The design on unmodified Morpho Blue: oracle, regimes, splits, halts, dividends, liquidation." },
  { file: "README.md", title: "README", body: "Project overview and the research files." },
  { file: "morpho-blue.md", title: "Morpho Blue research", body: "Market model, oracle, liquidation and vaults." },
  { file: "idea-progression.md", title: "Idea progression", body: "How the direction evolved and why." },
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
            <span>Dawn</span>
          </a>
          <ul className="nav-links">
            <li>
              <a href="#how">How it works</a>
            </li>
            <li>
              <a href="#risk">Risk layer</a>
            </li>
            <li className="hide-sm">
              <a href="#roadmap">Roadmap</a>
            </li>
            <li className="hide-sm">
              <a href="#docs">Docs</a>
            </li>
          </ul>
          <span className="nav-status">
            <span className="status-dot" aria-hidden="true" />
            Draft, not live
          </span>
        </nav>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-sky" aria-hidden="true">
            <div className="sun" />
            <svg className="ridges" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax slice" focusable="false">
              <path className="ridge-far" d="M0 210 L120 168 L230 190 L360 120 L480 172 L600 140 L720 186 L840 150 L960 182 L1080 118 L1210 170 L1330 140 L1440 166 L1440 320 L0 320 Z" />
              <path className="ridge-mid" d="M0 250 L140 200 L260 232 L400 186 L540 236 L680 208 L800 244 L940 196 L1080 240 L1220 204 L1340 236 L1440 214 L1440 320 L0 320 Z" />
              <path className="ridge-near" d="M0 292 L170 256 L330 284 L500 252 L680 290 L860 262 L1040 294 L1220 258 L1440 284 L1440 320 L0 320 Z" />
            </svg>
          </div>

          <div className="wrap hero-grid">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="eyebrow-dot" aria-hidden="true" />
                Lending for tokenized US stocks on BNB Chain
              </p>
              <h1 id="hero-title">
                Borrow against stocks that never sleep, <span className="h1-soft">priced for markets that do.</span>
              </h1>
              <p className="lead">
                Dawn lets you post bStocks and borrow stablecoins on unmodified Morpho Blue. Its risk layer knows when the
                US market is open and adjusts borrowing power before the gap, not after it.
              </p>
              <div className="ctas">
                <a className="btn btn-primary" href={`${REPO}/architecture-v1.md`}>
                  Read the architecture
                  <IconArrow />
                </a>
                <a className="btn btn-quiet" href="#how">
                  How it works
                </a>
              </div>
              <ul className="built-on" aria-label="Built on">
                <li>Morpho Blue, unmodified</li>
                <li>BNB Chain</li>
                <li>bStocks (BEP-677 multiplier)</li>
              </ul>
            </div>

            <div className="hero-card">
              <PositionPreview />
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="section" id="problem" aria-labelledby="problem-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">The gap</p>
              <h2 id="problem-title">Tokens trade 24/7. The stock market does not.</h2>
              <p className="intro">
                A bStock can change hands on a Saturday, but the share it tracks only trades in set US sessions. When the
                market reopens, price can jump past where it closed. Lending built for always-on crypto treats every hour
                the same.
              </p>
            </Reveal>
            <div className="facts">
              <Reveal as="article" className="fact">
                <p className="fact-figure num">
                  6.5<span>h</span>
                </p>
                <p className="fact-label">Regular US session per weekday (9:30 to 16:00 ET). The rest is extended, overnight or weekend.</p>
              </Reveal>
              <Reveal as="article" className="fact" delay={80}>
                <p className="fact-figure num">
                  56<span>%</span>
                </p>
                <p className="fact-label">
                  Of bStock volume trades outside regular hours.
                  <span className="source">Binance Research, Oct 20 2026</span>
                </p>
              </Reveal>
              <Reveal as="article" className="fact" delay={160}>
                <p className="fact-figure num">
                  8<span>:1</span>
                </p>
                <p className="fact-label">
                  SNDKB split, delivered through a multiplier change. A naive oracle reads it as a crash.
                  <span className="source">Binance, Nov 11 2026</span>
                </p>
              </Reveal>
            </div>
          </div>
        </section>

        {/* Regime explorer */}
        <section className="section section-raised" id="regimes" aria-labelledby="regimes-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">Borrowing power over a week</p>
              <h2 id="regimes-title">Borrowing power follows the market clock</h2>
              <p className="intro">
                Drag across the week to see how the regime changes the haircut. The shape follows the design; the numbers are
                placeholders until the gap model is finished.
              </p>
            </Reveal>
            <Reveal className="panel">
              <span className="illustrative-tag illustrative-corner">Illustrative</span>
              <RegimeExplorer />
              <p className="panel-foot">
                US Eastern time. Holidays follow the weekend level and halts freeze the price with their own haircut. Real
                haircuts would come from a historical gap model that has not been finalized.
              </p>
            </Reveal>
          </div>
        </section>

        {/* How it works */}
        <section className="section" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">How it works</p>
              <h2 id="how-title">Four steps, one isolated market</h2>
              <p className="intro">
                Dawn does not fork the lending core. Accounting, borrow, repay and liquidation stay in Morpho Blue. Dawn&apos;s
                logic lives in the oracle, a router and offchain keepers.
              </p>
            </Reveal>
            <ol className="flow">
              {STEPS.map((s, i) => (
                <Reveal as="li" key={s.n} className="flow-step" delay={i * 70}>
                  <span className="flow-n num" aria-hidden="true">
                    {s.n}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Risk layer */}
        <section className="section section-raised" id="risk" aria-labelledby="risk-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">The risk layer</p>
              <h2 id="risk-title">Built for what makes stocks different</h2>
              <p className="intro">
                Isolated markets keep bad debt in one market from touching another. On top of that, Dawn handles the events
                crypto lending was never designed for.
              </p>
            </Reveal>
            <div className="features">
              {FEATURES.map((f, i) => (
                <Reveal as="article" key={f.title} className="feature" delay={(i % 3) * 70}>
                  <span className="feature-icon">{f.icon}</span>
                  <h3>{f.title}</h3>
                  <p>{f.body}</p>
                </Reveal>
              ))}
            </div>
            <Reveal className="callout">
              <span className="feature-icon">
                <IconIsolated />
              </span>
              <p>
                <strong>Stablecoin-only borrowing in v1.</strong> You post a tokenized stock and borrow stablecoins, so only
                the collateral price matters: one oracle and one rate curve per market.
              </p>
            </Reveal>
          </div>
        </section>

        {/* Roadmap */}
        <section className="section" id="roadmap" aria-labelledby="roadmap-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">Roadmap</p>
              <h2 id="roadmap-title">Start narrow, widen carefully</h2>
              <p className="intro">Draft plan. Nothing here is live or scheduled.</p>
            </Reveal>
            <ol className="roadmap">
              {ROADMAP.map((r, i) => (
                <Reveal as="li" key={r.tag} className={`stage${r.now ? " stage-now" : ""}`} delay={i * 70}>
                  <div className="stage-head">
                    <span className="stage-tag">{r.tag}</span>
                    <span className="stage-when">{r.when}</span>
                  </div>
                  <h3>{r.title}</h3>
                  <ul>
                    {r.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        {/* Docs */}
        <section className="section section-raised" id="docs" aria-labelledby="docs-title">
          <div className="wrap">
            <Reveal className="section-head">
              <p className="kicker">Docs</p>
              <h2 id="docs-title">Read the design</h2>
              <p className="intro">Every claim on this page traces back to these files.</p>
            </Reveal>
            <ul className="docs">
              {DOCS.map((d) => (
                <li key={d.file}>
                  <a href={`${REPO}/${d.file}`}>
                    <span className="doc-icon">
                      <IconDoc />
                    </span>
                    <span className="doc-text">
                      <strong>{d.title}</strong>
                      <span>{d.body}</span>
                    </span>
                    <span className="doc-arrow">
                      <IconArrow />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="brand brand-footer">
            <IconLogo />
            <span>Dawn Finance</span>
          </div>
          <div>
            <p className="disclaimer">Draft. Prototype built for BNB Bangkok, Nov 2026. Not financial advice. Not live.</p>
            <p className="small">
              Dawn Finance is a working name. Built on BNB Chain and Morpho Blue. Designs and parameters are unverified and
              subject to change. All figures in mock interfaces are illustrative.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
