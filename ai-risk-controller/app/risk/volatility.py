"""Daily-close log-return volatility, running-peak drawdown and simple momentum."""
import math
import statistics


def historical_volatility(prices: list[float]) -> float | None:
    if len(prices) < 3:
        return None
    if any(p <= 0 or not math.isfinite(p) for p in prices):
        raise ValueError("Prices must be finite and positive")
    returns = [math.log(b / a) for a, b in zip(prices, prices[1:])]
    return statistics.stdev(returns) * math.sqrt(252)


def maximum_drawdown(prices: list[float]) -> float | None:
    if not prices:
        return None
    if any(p <= 0 or not math.isfinite(p) for p in prices):
        raise ValueError("Prices must be finite and positive")
    peak, drawdown = prices[0], 0.0
    for p in prices:
        peak = max(peak, p)
        drawdown = max(drawdown, 1 - p / peak)
    return drawdown


def momentum(prices: list[float], window: int = 20) -> float | None:
    if len(prices) < 2:
        return None
    if window < 1 or any(p <= 0 or not math.isfinite(p) for p in prices):
        raise ValueError("Positive prices and window required")
    return prices[-1] / prices[max(0, len(prices) - 1 - window)] - 1
