"""Read-only provider seams. No blockchain writer or transaction permissions."""
from dataclasses import dataclass
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


@dataclass(frozen=True)
class DemoProfile:
    # Arbitrary, reproducible scenario inputs; never observed market statistics.
    price: float
    daily_volatility: float
    seed: int
    spread: float
    depth_multiplier: float
    volume: float
    concentration: float


DEMO_PROFILES = {
    "BNB_STOCK_NVDA": DemoProfile(140, .028, 42, .01, 1, 4_000_000, .4),
    "BNB_STOCK_QQQ": DemoProfile(510, .014, 43, .004, 1.8, 8_000_000, .25),
    "BNB_STOCK_SPCX": DemoProfile(130, .048, 44, .035, .25, 750_000, .7),
}


class MarketProvider(Protocol):
    def market(self, at: datetime, scenario: str) -> MarketData: ...


class OracleProvider(Protocol):
    def oracle(self, at: datetime, mode: OracleMode) -> OracleObservation: ...


class IssuerProvider(Protocol):
    def documents(self, at: datetime, scenario: str) -> list[IssuerDocument]: ...


class SnapshotProvider(Protocol):
    def snapshot(self, asset: str, at: datetime, scenario: str, mode: OracleMode) -> Snapshot: ...


class MockProviders:
    """Seeded synthetic inputs. Never claims to be live or historically observed asset data."""

    def market(self, at: datetime, scenario: str, asset: str = "BNB_STOCK_NVDA") -> MarketData:
        profile = DEMO_PROFILES.get(asset, DEMO_PROFILES["BNB_STOCK_NVDA"])
        rng = np.random.default_rng(profile.seed)
        returns = rng.normal(.0005, profile.daily_volatility, 89)
        prices = profile.price * np.exp(np.concatenate(([0], np.cumsum(returns))))
        prices *= profile.price / prices[-1]
        # Synthetic daily closes; business-session timestamps, no future samples.
        import pandas_market_calendars as mcal
        closes = mcal.get_calendar("NASDAQ").schedule(at.date() - timedelta(days=200), at.date())
        closes = closes[closes.market_close < at].market_close.iloc[-90:]
        history = [PricePoint(at=t.to_pydatetime(), price=float(p)) for t, p in zip(closes, prices)]
        multiplier = .55 if scenario == "saturday" else .85 if scenario == "friday" else 1
        scale = profile.price / 140
        bid = profile.price * (1 - profile.spread / 2)
        return MarketData(as_of=at, underlying_price=profile.price, token_bid=bid,
                          token_ask=profile.price * (1 + profile.spread / 2),
                          history=history, bids=[BidLevel(price=p, quantity=q * multiplier * profile.depth_multiplier) for p, q in
                                               [(bid, 1500), (bid * 138 / 139.3, 2000), (bid * 135 / 139.3, 3000), (bid * 128 / 139.3, 4000)]],
                          volume_24h_usd=profile.volume * multiplier, previous_volume_24h_usd=profile.volume,
                          previous_depth_usd=1400000 * scale * profile.depth_multiplier, concentration=profile.concentration, market_observed_at=at - timedelta(seconds=10),
                          source=Source(reference=f"mock://market/{asset}/{scenario}/seed-{profile.seed}"))

    def oracle(self, at: datetime, mode: OracleMode, asset: str = "BNB_STOCK_NVDA") -> OracleObservation:
        profile = DEMO_PROFILES.get(asset, DEMO_PROFILES["BNB_STOCK_NVDA"])
        rows = schedule_around(at)
        trading = ((rows.market_open <= at) & (rows.market_close > at)).any()
        # Conservative fixture: a 24/5 feed only observes cash-session marks.
        observed = at - timedelta(seconds=15) if trading or mode == OracleMode.SMOOTHED_24_7 else last_regular_close(at)
        return OracleObservation(mode=mode, price=profile.price, observed_at=observed,
                                 published_at=at - timedelta(seconds=5),
                                 basis_risk=.025 if mode == OracleMode.SMOOTHED_24_7 else 0,
                                 smoothing_lag_seconds=120 if mode == OracleMode.SMOOTHED_24_7 else 0,
                                 source=Source(reference=f"mock://oracle/{asset}/{mode}"))

    def documents(self, at: datetime, scenario: str) -> list[IssuerDocument]:
        restricted = scenario == "saturday"
        return [IssuerDocument(document_id=f"mock-issuer-{scenario}", published_at=at - timedelta(minutes=10),
                               text=RESTRICTED_ISSUER_TEXT if restricted else BENIGN_ISSUER_TEXT,
                               source=Source(reference=f"mock://issuer/{scenario}"))]

    def snapshot(self, asset: str, at: datetime, scenario: str, mode: OracleMode) -> Snapshot:
        documents = self.documents(at, scenario)
        for document in documents:
            document.document_id = f"{asset}-{document.document_id}"
            document.source.reference = f"mock://issuer/{asset}/{scenario}"
            document.source.description = "Synthetic issuer scenario; not an actual backing or redemption report."
        snapshot = Snapshot(asset=asset, market=self.market(at, scenario, asset), oracle=self.oracle(at, mode, asset),
                            documents=documents)
        if asset == "BNB_STOCK_SPCX":
            for source in [snapshot.market.source, snapshot.oracle.source] + [d.source for d in documents]:
                source.description = "SpaceX demo fixture only. Exchange calendar, token backing and oracle are hypothetical."
        return snapshot


def synthetic_borrowers() -> list[Borrower]:
    # Covers healthy, near-threshold and already liquidatable positions.
    return [Borrower(borrower_id=f"demo-{i:03}", collateral_quantity=50 + (i % 10) * 15,
                     debt_usd=(50 + (i % 10) * 15) * 140 * (.20 + (i % 12) * .04)) for i in range(120)]
