"""Read-only provider seams. No blockchain writer or transaction permissions."""
from datetime import datetime, timedelta, timezone
from typing import Protocol

import numpy as np

from app.market_sessions.calendar import last_regular_close, schedule_around
from app.models import (BidLevel, Borrower, IssuerDocument, MarketData, OracleMode,
                        OracleObservation, PricePoint, Snapshot, Source)

DEMO_TIMES = {
    "baseline": datetime(2026, 11, 20, 16, tzinfo=timezone.utc),
    "friday": datetime(2026, 11, 20, 20, 30, tzinfo=timezone.utc),
    "saturday": datetime(2026, 11, 21, 17, tzinfo=timezone.utc),
}
BENIGN_ISSUER_TEXT = ("SIMULATED backing report: tokens are backed one-for-one by custodied shares. "
                      "Redemption is available during US business hours, subject to issuer eligibility rules.")
RESTRICTED_ISSUER_TEXT = ("SIMULATED announcement: Redemption is temporarily suspended pending a backing review. "
                         "Secondary market token transfers remain enabled.")


class MarketProvider(Protocol):
    def market(self, at: datetime, scenario: str) -> MarketData: ...


class OracleProvider(Protocol):
    def oracle(self, at: datetime, mode: OracleMode) -> OracleObservation: ...


class IssuerProvider(Protocol):
    def documents(self, at: datetime, scenario: str) -> list[IssuerDocument]: ...


class SnapshotProvider(Protocol):
    def snapshot(self, asset: str, at: datetime, scenario: str, mode: OracleMode) -> Snapshot: ...


class MockProviders:
    """Seeded synthetic inputs. Never claims to be live or historically observed NVDA."""

    def market(self, at: datetime, scenario: str) -> MarketData:
        rng = np.random.default_rng(42)
        returns = rng.normal(.0005, .028, 89)
        prices = 140 * np.exp(np.concatenate(([0], np.cumsum(returns))))
        prices *= 140 / prices[-1]
        # Synthetic daily closes; business-session timestamps, no future samples.
        import pandas_market_calendars as mcal
        closes = mcal.get_calendar("NASDAQ").schedule(at.date() - timedelta(days=200), at.date())
        closes = closes[closes.market_close < at].market_close.iloc[-90:]
        history = [PricePoint(at=t.to_pydatetime(), price=float(p)) for t, p in zip(closes, prices)]
        multiplier = .55 if scenario == "saturday" else .85 if scenario == "friday" else 1
        return MarketData(as_of=at, underlying_price=140, token_bid=139.3, token_ask=140.7,
                          history=history, bids=[BidLevel(price=p, quantity=q * multiplier) for p, q in
                                               [(139.3, 1500), (138, 2000), (135, 3000), (128, 4000)]],
                          volume_24h_usd=4000000 * multiplier, previous_volume_24h_usd=4000000,
                          previous_depth_usd=1400000, market_observed_at=at - timedelta(seconds=10),
                          source=Source(reference=f"mock://market/{scenario}/seed-42"))

    def oracle(self, at: datetime, mode: OracleMode) -> OracleObservation:
        rows = schedule_around(at)
        trading = ((rows.market_open <= at) & (rows.market_close > at)).any()
        # Conservative fixture: a 24/5 feed only observes cash-session marks.
        observed = at - timedelta(seconds=15) if trading or mode == OracleMode.SMOOTHED_24_7 else last_regular_close(at)
        return OracleObservation(mode=mode, price=140, observed_at=observed,
                                 published_at=at - timedelta(seconds=5),
                                 basis_risk=.025 if mode == OracleMode.SMOOTHED_24_7 else 0,
                                 smoothing_lag_seconds=120 if mode == OracleMode.SMOOTHED_24_7 else 0,
                                 source=Source(reference=f"mock://oracle/{mode}"))

    def documents(self, at: datetime, scenario: str) -> list[IssuerDocument]:
        restricted = scenario == "saturday"
        return [IssuerDocument(document_id=f"mock-issuer-{scenario}", published_at=at - timedelta(minutes=10),
                               text=RESTRICTED_ISSUER_TEXT if restricted else BENIGN_ISSUER_TEXT,
                               source=Source(reference=f"mock://issuer/{scenario}"))]

    def snapshot(self, asset: str, at: datetime, scenario: str, mode: OracleMode) -> Snapshot:
        return Snapshot(asset=asset, market=self.market(at, scenario), oracle=self.oracle(at, mode),
                        documents=self.documents(at, scenario))


def synthetic_borrowers() -> list[Borrower]:
    # Covers healthy, near-threshold and already liquidatable positions.
    return [Borrower(borrower_id=f"demo-{i:03}", collateral_quantity=50 + (i % 10) * 15,
                     debt_usd=(50 + (i % 10) * 15) * 140 * (.20 + (i % 12) * .04)) for i in range(120)]
