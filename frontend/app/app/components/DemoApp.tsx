"use client";

import { useEffect, useState } from "react";
import { IconLogo } from "../../components/Icons";
import BorrowForm from "./BorrowForm";
import CorpActionBanner from "./CorpActionBanner";
import DemoPanel from "./DemoPanel";
import PositionCard from "./PositionCard";
import { useDawn } from "./useDawn";

export default function DemoApp() {
  const { client, snapshot, error } = useDawn();
  const [dev, setDev] = useState(false);

  // Hidden: ?dev=1 or Shift+D toggles the demo control panel.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("dev") === "1") setDev(true);
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.shiftKey && e.key === "D") setDev((d) => !d);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="nav">
        <nav className="wrap nav-inner" aria-label="Primary">
          <a className="brand" href="/" aria-label="Dawn Finance, home">
            <IconLogo />
            <span>Dawn</span>
          </a>
          <span className="nav-status">
            <span className="status-dot" aria-hidden="true" />
            {client.mode === "mock" ? "Demo, mock data" : "Demo, live reads"}
          </span>
        </nav>
      </header>
      <main className="wrap dapp">
        <h1 className="dapp-title">Dawn demo</h1>
        <p className="dapp-sub">
          One market: bStock collateral, USDT loan. Mocked data, no transactions. Haircuts, margin and the continuity band
          are placeholders.
        </p>
        {error && (
          <p className="dapp-banner dapp-banner-risk" role="alert">
            Could not load data: {error}
          </p>
        )}
        {!snapshot && !error && <p className="dapp-sub">Loading...</p>}
        {snapshot && (
          <>
            <CorpActionBanner s={snapshot} />
            <div className={`dapp-grid${dev && client.demo ? " dapp-grid-dev" : ""}`}>
              <PositionCard s={snapshot} />
              <BorrowForm s={snapshot} client={client} />
              {dev && client.demo && <DemoPanel s={snapshot} demo={client.demo} />}
            </div>
          </>
        )}
        <p className="illustrative dapp-foot">
          Developer controls: add ?dev=1 to the URL or press Shift+D. Not live, not audited.
        </p>
      </main>
    </>
  );
}
