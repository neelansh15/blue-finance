from app.config import Policy
from app.market_sessions.session_policy import SessionAdjustment, adjustment
from app.models import (Assessment, Borrower, PositionImpact, Scenario, SimulationResult, Snapshot)
from app.optimiser.constraints import morpho_incentive, validate_bounds
from app.risk.issuer import issuer_risk
from app.risk.recoverable_value import recoverable_value
from app.simulation.borrower import health_factor, position_status


def default_scenarios() -> list[Scenario]:
    return [Scenario(name=f"price_falls_{pct}pct", price_drop=pct / 100) for pct in [5, 10, 20, 30]] + [
        Scenario(name="liquidity_loss_70pct", liquidity_multiplier=.3),
        Scenario(name="stale_oracle", oracle_stale=True),
        Scenario(name="weekend_gap_10pct", weekend=True, price_drop=.1),
        Scenario(name="issuer_redemption_restriction", issuer_restriction=True)]


def simulate(assessment: Assessment, snapshot: Snapshot, borrowers: list[Borrower], scenario: Scenario,
             policy: Policy) -> SimulationResult:
    a, p = assessment, policy
    proposed = scenario.proposed_parameters
    if proposed:
        validate_bounds(proposed, p)
    if scenario.apply_threshold_to_existing and p.immutable_threshold:
        raise ValueError("Cannot apply a proposed threshold to existing immutable Morpho positions")
    if p.immutable_threshold and any(b.liquidation_threshold != p.market_lltv for b in borrowers):
        raise ValueError("Borrower LLTV differs from configured immutable market")
    total_quantity = sum(b.collateral_quantity for b in borrowers)
    _, issuer_haircut, _ = issuer_risk(a.events, p)
    base_session = adjustment(a.session, p)
    base_oracle_price = snapshot.oracle.normalized_price or snapshot.market.underlying_price
    market_age = ((a.as_of - snapshot.market.market_observed_at).total_seconds()
                  if snapshot.market.market_observed_at else float("inf"))
    base_liquidity = 0 if market_age > p.market_max_age_seconds else 1

    def recovery(quantity: float, shocked: bool):
        price_scale = 1 - scenario.price_drop if shocked else 1
        session = base_session
        if shocked and scenario.weekend:
            session = SessionAdjustment(max(session.gap_floor, p.weekend_gap), max(3, session.horizon_days),
                                        min(.4, session.cap_multiplier), max(.06, session.extra_ltv_buffer), "Weekend stress")
        bids = [b.model_copy(update={"price": b.price * price_scale}) for b in snapshot.market.bids]
        return recoverable_value(quantity, a.recovery.reference_price * price_scale, bids,
                                 a.metrics.annualised_volatility, session,
                                 max(issuer_haircut, p.issuer_restriction_haircut) if shocked and scenario.issuer_restriction else issuer_haircut,
                                 max(.2, a.oracle.haircut) if shocked and scenario.oracle_stale else a.oracle.haircut,
                                 a.score.confidence, p,
                                 liquidity_multiplier=base_liquidity * (scenario.liquidity_multiplier if shocked else 1))

    # Walk the book once for the entire portfolio, then allocate proceeds pro rata.
    baseline = recovery(total_quantity, False)
    stressed = recovery(total_quantity, True)
    base_unit = baseline.recoverable_value_usd / total_quantity if total_quantity else 0
    stress_unit = stressed.recoverable_value_usd / total_quantity if total_quantity else 0
    stressed_oracle = base_oracle_price * (1 - scenario.price_drop) * scenario.oracle_price_multiplier
    impacts = []
    feasible = True
    for b in borrowers:
        threshold = proposed.liquidation_threshold if proposed and scenario.apply_threshold_to_existing else b.liquidation_threshold
        base_bonus, bonus = morpho_incentive(b.liquidation_threshold), morpho_incentive(threshold)
        base_recovery = min(base_unit * b.collateral_quantity, b.collateral_quantity * base_oracle_price) / (1 + base_bonus)
        debt_recovery = min(stress_unit * b.collateral_quantity, b.collateral_quantity * stressed_oracle) / (1 + bonus)
        old_status = position_status(b.collateral_quantity, base_oracle_price, b.debt_usd, b.liquidation_threshold,
                                     base_recovery, None, p.at_risk_health_factor)
        target = proposed.ltv if proposed else None
        status = position_status(b.collateral_quantity, stressed_oracle, b.debt_usd, threshold,
                                 debt_recovery, target, p.at_risk_health_factor)
        required = b.debt_usd * p.at_risk_health_factor / (stressed_oracle * threshold)
        if target is not None and b.debt_usd > 0:
            if target == 0:
                feasible = False  # collateral cannot restore permission for new borrowing
            else:
                required = max(required, b.debt_usd / (stressed_oracle * target))
        if b.debt_usd > 0 and stress_unit > 0:
            required = max(required, b.debt_usd * (1 + bonus) / stress_unit)
        elif b.debt_usd > 0:
            feasible = False
        extra = max(0, required - b.collateral_quantity)
        impacts.append(PositionImpact(borrower_id=b.borrower_id,
                                      current_ltv=b.debt_usd / (b.collateral_quantity * stressed_oracle),
                                      health_factor=health_factor(b.collateral_quantity, stressed_oracle, b.debt_usd, threshold),
                                      status=status, previous_status=old_status,
                                      recoverable_value_usd=debt_recovery,
                                      estimated_bad_debt_usd=max(0, b.debt_usd - debt_recovery),
                                      additional_collateral_tokens=extra))
    extra_total = sum(i.additional_collateral_tokens for i in impacts)
    # Extra collateral cannot create executable depth. Recheck the proposed deposits.
    expanded = recovery(total_quantity + extra_total, True)
    expanded_unit = expanded.recoverable_value_usd / (total_quantity + extra_total) if total_quantity + extra_total else 0
    for b, i in zip(borrowers, impacts):
        threshold = proposed.liquidation_threshold if proposed and scenario.apply_threshold_to_existing else b.liquidation_threshold
        capacity = expanded_unit * (b.collateral_quantity + i.additional_collateral_tokens) / (1 + morpho_incentive(threshold))
        if capacity + 1e-8 < b.debt_usd:
            feasible = False
    return SimulationResult(scenario=scenario.name, total_positions=len(impacts),
                            healthy=sum(i.status == "HEALTHY" for i in impacts),
                            at_risk=sum(i.status == "AT_RISK" for i in impacts),
                            liquidatable=sum(i.status == "LIQUIDATABLE" for i in impacts),
                            newly_at_risk=sum(i.status == "AT_RISK" and i.previous_status == "HEALTHY" for i in impacts),
                            newly_liquidatable=sum(i.status == "LIQUIDATABLE" and i.previous_status != "LIQUIDATABLE" for i in impacts),
                            debt_at_risk_usd=sum(b.debt_usd for b, i in zip(borrowers, impacts) if i.status != "HEALTHY"),
                            estimated_bad_debt_usd=sum(i.estimated_bad_debt_usd for i in impacts),
                            additional_collateral_tokens=extra_total, safety_restoration_feasible=feasible,
                            positions=impacts, assumptions=[
                                "USD-valued USDT debt; no interest accrual, depeg, integer rounding or partial liquidation simulation",
                                "HF = collateral × protocol oracle price × existing LLTV / debt; HF=1 is not liquidatable",
                                "Price shocks assume an eventual protocol oracle mark; stale/weekend/issuer stress alone does not change that mark",
                                "Router LTV changes affect advisory risk flags, not liquidation eligibility",
                                "Only explicit oracle_price_multiplier models a DawnOracle haircut changing liquidation health",
                                "All positions liquidate concurrently; one shared finite book, allocated pro rata, no depth reuse",
                                "Bad debt is a stressed economic shortfall after liquidation incentive; not realised onchain bad debt",
                                "Additional collateral is an indicative lower bound; feasibility is false if depth or zero target LTV prevents restoring safety",
                                "Missing oracle uses underlying mark only for hypothetical health; no new borrowing recommendation allowed"])
