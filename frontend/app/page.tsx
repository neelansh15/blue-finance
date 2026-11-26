export default function Home() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      <header className="nav">
        <nav className="wrap" aria-label="Primary">
          <a className="brand" href="#top" aria-label="Dawn Finance, back to top">
            <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
              <circle cx="16" cy="19" r="8" fill="#F2C14E"/>
              <path d="M0 32 L9 18 L14 24 L21 13 L32 28 L32 32 Z" fill="#3E5568"/>
              <path d="M0 32 L6 26 L12 30 L20 22 L32 32 Z" fill="#1E2A38"/>
            </svg>
            <span>Dawn Finance</span>
          </a>
          <ul>
            <li className="hide-sm"><a href="#problem">Problem</a></li>
            <li><a href="#how-it-works">How it works</a></li>
            <li className="hide-sm"><a href="#roadmap">Roadmap</a></li>
            <li><a href="#docs">Docs</a></li>
          </ul>
        </nav>
      </header>

      <main id="main">
        <section className="hero" id="top" aria-labelledby="hero-title" style={{ borderTop: 0 }}>
          <div className="wrap hero-inner">
            <span className="draft-chip">Draft prototype · not live</span>
            <h1 id="hero-title">Dawn Finance</h1>
            <p className="lead">Borrow stablecoins against tokenized US stocks, with a risk layer that knows when the market is open.</p>
            <p className="sub">Isolated lending markets on unmodified Morpho Blue, on BNB Chain. Tokens trade 24/7; the stock market does not. Dawn prices that gap in.</p>
            <div className="ctas">
              <a className="btn btn-primary" href="#how-it-works">How Dawn works</a>
              <a className="btn btn-ghost" href="architecture-v1.md">Read the architecture</a>
              <a className="btn btn-ghost" href="README.md">README</a>
            </div>
          </div>

          <div className="scene">
            <svg viewBox="0 0 1440 360" preserveAspectRatio="xMidYMax slice" role="img" aria-labelledby="scene-title">
              <title id="scene-title">Illustration: a soft sunrise glowing from behind layered gray-blue mountain ridges.</title>
              <defs>
                <radialGradient id="sun" cx="50%" cy="100%" r="60%">
                  <stop offset="0%" stopColor="#FFFBEA" stopOpacity="1"/>
                  <stop offset="25%" stopColor="#FFF1B8" stopOpacity="0.95"/>
                  <stop offset="60%" stopColor="#F2C14E" stopOpacity="0.22"/>
                  <stop offset="100%" stopColor="#FFF1B8" stopOpacity="0"/>
                </radialGradient>
                <linearGradient id="far" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8FA3B5"/>
                  <stop offset="100%" stopColor="#7D93A7"/>
                </linearGradient>
                <linearGradient id="mid" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5D7488"/>
                  <stop offset="100%" stopColor="#3E5568"/>
                </linearGradient>
              </defs>
              <ellipse className="glow" cx="720" cy="250" rx="620" ry="230" fill="url(#sun)"/>
              <g className="ridge-far">
                <path fill="url(#far)" d="M-20 250 L90 200 L180 222 L300 150 L410 198 L520 168 L620 210 L720 176 L830 206 L940 142 L1060 196 L1170 160 L1290 204 L1380 178 L1460 200 L1460 360 L-20 360 Z"/>
              </g>
              <g className="ridge-mid">
                <path fill="url(#mid)" d="M-20 290 L120 236 L230 268 L360 214 L480 262 L600 240 L700 276 L820 226 L960 270 L1080 232 L1210 274 L1330 244 L1460 268 L1460 360 L-20 360 Z"/>
              </g>
              <path fill="#1E2A38" d="M-20 330 L140 290 L300 318 L460 284 L640 322 L800 296 L980 326 L1150 292 L1300 318 L1460 300 L1460 360 L-20 360 Z"/>
            </svg>
          </div>
        </section>

        <section id="problem" aria-labelledby="problem-title">
          <div className="wrap">
            <p className="eyebrow">The problem</p>
            <h2 id="problem-title">Tokens trade 24/7. The stock market does not.</h2>
            <p className="intro">A tokenized stock can change hands on a Saturday, but the US equity it tracks only trades in set sessions. When the market reopens, the price can jump past where it closed. Lending protocols built for always-on crypto assets treat every hour the same and ignore that gap risk.</p>
            <ul className="gaps">
              <li><strong>Overnight</strong><span>The market closes each evening. News lands before the next open.</span></li>
              <li><strong>Weekends</strong><span>Two days with no primary-market price discovery, then one reopen.</span></li>
              <li><strong>Holidays and halts</strong><span>Exchange holidays, trading halts and suspensions stretch the gap further.</span></li>
            </ul>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-title">
          <div className="wrap">
            <p className="eyebrow">How Dawn works</p>
            <h2 id="how-title">A risk layer on top of Morpho Blue</h2>
            <p className="intro">Dawn does not fork the lending core. It creates isolated markets on the canonical, unmodified Morpho Blue deployment and puts its logic in the oracle, a router and offchain keepers.</p>

            <div className="grid grid-3">
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
                </div>
                <h3>Isolated markets on Morpho Blue</h3>
                <p>One market per stock and loan asset. Bad debt in one market never touches another. Accounting, borrow, repay and liquidation stay in Morpho Blue, unmodified.</p>
              </article>
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                </div>
                <h3>Market-hours-aware pricing</h3>
                <p>A regime registry tracks open, extended, closed, weekend or holiday, halted and corporate-action states. The oracle applies a haircut per regime, so borrowing power shrinks when the market is shut, and ramps down before the close instead of stepping.</p>
              </article>
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>
                </div>
                <h3>Conservative oracle</h3>
                <p>Collateral is valued at the more conservative of the primary price feed and a DEX TWAP. If a source is stale or missing, an extra haircut applies. In the normal path the oracle never reverts, so liquidations keep working.</p>
              </article>
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/></svg>
                </div>
                <h3>Stock-specific events</h3>
                <p>Splits via display multipliers, issuer pauses and whitelists, trading halts and reinvested dividends. Around these events new borrows pause and the price freezes to the last good value for a bounded time, so a split does not look like a crash.</p>
              </article>
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5"/><path d="M12 6v2M12 16v2"/></svg>
                </div>
                <h3>Stablecoin-only borrowing</h3>
                <p>In v1 you post a tokenized stock and borrow stablecoins. That keeps risk one-sided: only the collateral price matters, with one oracle and one rate curve per market.</p>
              </article>
              <article className="card">
                <div className="icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>
                </div>
                <h3>Liquidation</h3>
                <p>Morpho Blue liquidation stays permissionless. Dawn plans opt-in pre-liquidation for smaller, gentler partial liquidations, and runs its own backstop bot with no special privileges.</p>
              </article>
            </div>

            <div className="card chart-card">
              <figure aria-labelledby="chart-caption">
                <span className="chart-label">Illustrative only, not real data</span>
                <h3 id="chart-title">Borrowing power across a week</h3>
                <div className="chart-scroll" tabIndex={0} role="region" aria-label="Illustrative chart of borrowing power across a week, scrollable on small screens">
                  <svg viewBox="0 0 780 260" role="img" aria-labelledby="chart-svg-title chart-svg-desc">
                    <title id="chart-svg-title">Illustrative borrowing power by market regime, Monday to Sunday</title>
                    <desc id="chart-svg-desc">A stepped line with no real values. Borrowing power is highest during each weekday's regular US session, ramps down shortly before the close, is lower in extended hours, lower again overnight, and lowest from Friday evening through the weekend until Monday's pre-market.</desc>
                    {/* weekend shading */}
                    <rect className="c-weekend" x="543.3" y="30" width="216.7" height="180"/>
                    {/* regular session bands (approx. 9:30-16:00 US Eastern) */}
                    <rect className="c-open" x="99.6" y="30" width="27.1" height="180"/>
                    <rect className="c-open" x="199.6" y="30" width="27.1" height="180"/>
                    <rect className="c-open" x="299.6" y="30" width="27.1" height="180"/>
                    <rect className="c-open" x="399.6" y="30" width="27.1" height="180"/>
                    <rect className="c-open" x="499.6" y="30" width="27.1" height="180"/>
                    {/* regime gridlines */}
                    <line className="c-grid" x1="60" y1="50" x2="760" y2="50"/>
                    <line className="c-grid" x1="60" y1="95" x2="760" y2="95"/>
                    <line className="c-grid" x1="60" y1="135" x2="760" y2="135"/>
                    <line className="c-grid" x1="60" y1="190" x2="760" y2="190"/>
                    <line className="c-axis" x1="60" y1="210" x2="760" y2="210"/>
                    <line className="c-axis" x1="60" y1="30" x2="60" y2="210"/>
                    {/* y labels */}
                    <text className="c-text" x="52" y="54" textAnchor="end">Open</text>
                    <text className="c-text" x="52" y="99" textAnchor="end">Ext.</text>
                    <text className="c-text" x="52" y="139" textAnchor="end">Closed</text>
                    <text className="c-text" x="52" y="194" textAnchor="end">Wknd</text>
                    <text className="c-text-strong" x="60" y="20">Higher borrowing power ↑</text>
                    {/* line */}
                    <path className="c-line" d="M60.0 190 L76.7 190 L76.7 95 L99.6 95 L103.0 50 L122.5 50 L126.7 95 L143.3 95 L143.3 135 L160.0 135 L176.7 135 L176.7 95 L199.6 95 L203.0 50 L222.5 50 L226.7 95 L243.3 95 L243.3 135 L260.0 135 L276.7 135 L276.7 95 L299.6 95 L303.0 50 L322.5 50 L326.7 95 L343.3 95 L343.3 135 L360.0 135 L376.7 135 L376.7 95 L399.6 95 L403.0 50 L422.5 50 L426.7 95 L443.3 95 L443.3 135 L460.0 135 L476.7 135 L476.7 95 L499.6 95 L503.0 50 L522.5 50 L526.7 95 L543.3 95 L543.3 190 L760.0 190"/>
                    {/* x labels */}
                    <text className="c-text" x="110" y="230" textAnchor="middle">Mon</text>
                    <text className="c-text" x="210" y="230" textAnchor="middle">Tue</text>
                    <text className="c-text" x="310" y="230" textAnchor="middle">Wed</text>
                    <text className="c-text" x="410" y="230" textAnchor="middle">Thu</text>
                    <text className="c-text" x="510" y="230" textAnchor="middle">Fri</text>
                    <text className="c-text" x="610" y="230" textAnchor="middle">Sat</text>
                    <text className="c-text" x="710" y="230" textAnchor="middle">Sun</text>
                    <text className="c-text" x="651" y="250" textAnchor="middle">Weekend: lowest borrowing power</text>
                  </svg>
                </div>
                <figcaption id="chart-caption">
                  Shape only: no real haircut values, no axis numbers. Shaded columns mark the regular US session (US Eastern time). The drop just before each close is the ramp that de-risks positions ahead of the overnight or weekend gap. Holidays and halts would follow the weekend or halted level. Actual haircuts would come from a historical gap model that has not been finalized.
                  <ul className="chips" aria-label="Status legend used in the interface">
                    <li><span className="chip chip-ok">Healthy</span></li>
                    <li><span className="chip chip-warn">Market closed: reduced borrowing power</span></li>
                    <li><span className="chip chip-risk">Liquidation risk</span></li>
                  </ul>
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section id="roadmap" aria-labelledby="roadmap-title">
          <div className="wrap">
            <p className="eyebrow">Roadmap</p>
            <h2 id="roadmap-title">Start narrow, add leverage later</h2>
            <p className="intro">Draft plan. Nothing here is live or scheduled.</p>
            <ol className="roadmap">
              <li className="now">
                <span className="stage">v1</span>
                <span className="when">Prototype, BNB Bangkok</span>
                <h3>Stablecoin borrowing</h3>
                <p>Post a tokenized US stock, borrow stablecoins, with market-hours-aware limits and a conservative oracle. The hackathon demo runs on a testnet or mainnet fork.</p>
              </li>
              <li>
                <span className="stage">v1.5</span>
                <span className="when">Later</span>
                <h3>Leverage vault</h3>
                <p>Leveraged long positions on tokenized stocks, built on the same isolated markets and risk layer.</p>
              </li>
              <li>
                <span className="stage">v2</span>
                <span className="when">Later</span>
                <h3>Shorting</h3>
                <p>Borrowing the equity tokens themselves, which needs borrowable equity-token supply.</p>
              </li>
            </ol>
          </div>
        </section>

        <section id="docs" aria-labelledby="docs-title">
          <div className="wrap">
            <p className="eyebrow">Docs</p>
            <h2 id="docs-title">Read the design</h2>
            <ul className="docs">
              <li><a href="architecture-v1.md"><strong>Architecture v1</strong><span>The design on top of unmodified Morpho Blue: oracle, regimes, splits, halts, dividends.</span></a></li>
              <li><a href="README.md"><strong>README</strong><span>Overview of the project and its research files.</span></a></li>
              <li><a href="idea-progression.md"><strong>Idea progression</strong><span>How the direction evolved and why each decision was made.</span></a></li>
            </ul>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <p className="disclaimer">Draft. Prototype built for BNB Bangkok, Nov 2026. Not financial advice. Not live.</p>
          <p className="small">Dawn Finance is a working name. Built on BNB Chain and Morpho Blue. Designs and parameters are unverified and subject to change.</p>
        </div>
      </footer>
    </>
  );
}
