"""Compare declared policies on identical supplied episodes. Outputs are hypotheses, not competitor claims."""
from datetime import datetime, timezone

from pydantic import AwareDatetime, Field, model_validator

from app.blue import REGIMES, ROUTINE
from app.integrations.signing import evidence_hash
from app.models import BidLevel, Model, NonNegative, Positive, Ratio
from app.optimiser.constraints import morpho_incentive
from app.risk.liquidity import execute_bids


class Episode(Model):
    asset: str
    start: AwareDatetime
    end: AwareDatetime
    start_price: Positive
    end_price: Positive
    collateral_quantity: Positive
    initial_regime: str
    final_regime: str
    executable_bids: list[BidLevel]
    execution_available: bool

    @model_validator(mode='after')
    def coherent(self):
        if self.start>=self.end or self.initial_regime not in ROUTINE or self.final_regime not in REGIMES:
            raise ValueError('Invalid episode window or regimes')
        if any(a.price<b.price for a,b in zip(self.executable_bids,self.executable_bids[1:])):
            raise ValueError('Episode bids must be sorted')
        return self


class BenchmarkPolicy(Model):
    name: str = Field(min_length=1)
    lltv: Ratio = .625
    margin: Ratio = .02
    haircuts: dict[str, Ratio]
    borrow_cap_usd: NonNegative
    regime_borrow_caps_usd: dict[str, NonNegative] | None = None
    execution_fee: Ratio = .003

    @model_validator(mode='after')
    def coherent(self):
        if set(self.haircuts)!=set(REGIMES) or not 0<self.lltv<1 or self.target<=0:
            raise ValueError('Invalid benchmark policy')
        if self.regime_borrow_caps_usd is not None and set(self.regime_borrow_caps_usd)!=set(REGIMES):
            raise ValueError('Benchmark regime caps require all six regimes')
        return self

    @property
    def target(self):
        return self.lltv*(1-max(self.haircuts[r] for r in ROUTINE))-self.margin


def compare_policies(episodes: list[Episode], policies: list[BenchmarkPolicy], as_of: datetime):
    if as_of.tzinfo is None or as_of>datetime.now(timezone.utc) or any(e.end>as_of for e in episodes):
        raise ValueError('Benchmark cutoff must exclude future evidence')
    if not episodes or len({p.name for p in policies})!=len(policies) or not policies:
        raise ValueError('Episodes and uniquely named policies required')
    # Every episode is an aggregate liquidation book. Overlap could count the same liquidity twice.
    for asset in {e.asset for e in episodes}:
        ordered=sorted((e for e in episodes if e.asset==asset),key=lambda e:e.start)
        if any(a.end>b.start for a,b in zip(ordered,ordered[1:])):
            raise ValueError('Overlapping episodes for one asset reuse liquidity')
    results=[]
    for p in policies:
        borrowed=shortfall=worst=0.0
        liquidations=policy_induced=unavailable=credit_denied=0
        for e in episodes:
            regime_cap=(p.regime_borrow_caps_usd or {}).get(e.initial_regime,p.borrow_cap_usd)
            debt=min(p.borrow_cap_usd,regime_cap,e.collateral_quantity*e.start_price*(1-p.haircuts[e.initial_regime])*p.target)
            maximum=e.collateral_quantity*e.end_price*(1-p.haircuts[e.final_regime])*p.lltv
            liquidatable=debt>maximum
            execution=execute_bids(e.collateral_quantity,e.end_price,e.executable_bids,1 if e.execution_available else 0)
            proceeds=execution.proceeds*(1-p.execution_fee)/(1+morpho_incentive(p.lltv))
            loss=max(0,debt-proceeds)
            borrowed+=debt;shortfall+=loss;worst=max(worst,loss)
            liquidations+=int(liquidatable)
            policy_induced+=int(liquidatable and debt<=e.collateral_quantity*e.end_price*p.lltv)
            unavailable+=int(not e.execution_available)
            credit_denied+=int(debt==0)
        results.append(dict(policy=p.name,aggregate_opening_debt_usd=borrowed,
            stressed_economic_shortfall_usd=shortfall,worst_episode_shortfall_usd=worst,
            liquidation_episodes=liquidations,policy_induced_liquidation_episodes=policy_induced,
            execution_unavailable_episodes=unavailable,opening_credit_denied_episodes=credit_denied))
    evidence={'episodes':[e.model_dump(mode='json') for e in episodes],
              'policies':[p.model_dump(mode='json') for p in policies],'as_of':as_of.isoformat()}
    return dict(results=results,evidence_hash=evidence_hash(evidence),calibrated=False,executable=False,
        assumptions=['Each episode is the aggregate collateral book; one finite exit book is shared by all borrowers',
            'Opening capacity follows current Blue haircut/target semantics; no interest or intra-episode rebalancing',
            'Economic shortfall is stressed recovery, not necessarily realized on-chain bad debt',
            'Caller-supplied histories and adjustment claims require source verification',
            'Policy-induced means haircut-dependent at the final mark; it is not proof of an erroneous liquidation',
            'Use unseen chronological evaluation data; policies are supplied, never optimized on this evaluation set'])
