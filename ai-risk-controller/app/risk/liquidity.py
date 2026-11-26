from dataclasses import dataclass

from app.models import BidLevel, MarketData


def bid_ask_spread(bid: float, ask: float) -> float:
    if not 0 < bid <= ask:
        raise ValueError("Invalid bid/ask")
    return (ask - bid) / ((ask + bid) / 2)


def market_depth(bids: list[BidLevel]) -> float:
    return sum(b.price * b.quantity for b in bids)


def price_divergence(token_price: float, underlying_price: float) -> float:
    if token_price <= 0 or underlying_price <= 0:
        raise ValueError("Positive prices required")
    return abs(token_price / underlying_price - 1)


def deterioration(market: MarketData) -> float:
    def decline(now: float, previous: float) -> float:
        return max(0, 1 - now / previous) if previous > 0 else 1
    return max(decline(market.volume_24h_usd, market.previous_volume_24h_usd),
               decline(market_depth(market.bids), market.previous_depth_usd))


@dataclass(frozen=True)
class Execution:
    filled_quantity: float
    proceeds: float
    fraction: float
    slippage: float


def execute_bids(quantity: float, reference_price: float, bids: list[BidLevel], multiplier: float = 1) -> Execution:
    """Walk a finite book. Unfilled inventory has zero immediate recovery value."""
    if quantity < 0 or reference_price <= 0 or not 0 <= multiplier <= 1:
        raise ValueError("Invalid execution input")
    remaining, proceeds = quantity, 0.0
    for level in bids:
        fill = min(remaining, level.quantity * multiplier)
        # Never infer a recovery premium from a bid above the conservative reference.
        proceeds += fill * min(level.price, reference_price)
        remaining -= fill
        if remaining <= 0:
            break
    filled = quantity - remaining
    return Execution(filled, proceeds, filled / quantity if quantity else 1,
                     max(0, 1 - proceeds / (filled * reference_price)) if filled else 1)
