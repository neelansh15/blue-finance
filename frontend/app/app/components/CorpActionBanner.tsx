import { derivePosition, wadToNumber, type DawnSnapshot } from "../../../src/lib/dawn/client";

export default function CorpActionBanner({ s }: { s: DawnSnapshot }) {
  const p = derivePosition(s);
  if (s.regime === "HALTED") {
    return (
      <div className="dapp-banner dapp-banner-risk" role="status">
        <strong>Trading halt.</strong> New borrows are paused and the price is held with a haircut for a bounded time.
        Repay and withdraw are unaffected.
      </div>
    );
  }
  if (s.regime !== "CORP_ACTION" && !s.pendingMultiplier) return null;
  const pm = s.pendingMultiplier;
  const ratio = pm ? wadToNumber(pm.newMultiplier) / wadToNumber(s.uiMultiplier) : null;
  return (
    <div className="dapp-banner" role="status" data-testid="corp-banner">
      <strong>
        Corporate action in progress{ratio ? `: ${ratio}-for-1 split` : ""}.
      </strong>{" "}
      Borrowing is paused on {s.symbol}.{" "}
      {pm ? (
        <>
          The display multiplier moves from {wadToNumber(s.uiMultiplier).toFixed(2)} to{" "}
          {wadToNumber(pm.newMultiplier).toFixed(2)} at the effective time (mock time, not a real date). Your raw balance
          does not change.
        </>
      ) : p.oracle.frozen ? (
        <>The oracle is frozen at the last good price until the feed prints a post-split price that passes the continuity check.</>
      ) : (
        <>The feed and multiplier agree again. A keeper clears the state after the continuity check.</>
      )}
    </div>
  );
}
