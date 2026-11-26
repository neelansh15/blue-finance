"""Research-only joint collateral stress and shared USDT supplier exposure."""
from decimal import Decimal
from typing import Annotated
from pydantic import AwareDatetime, Field, model_validator, field_validator
from app.models import Model

Money = Annotated[Decimal, Field(ge=0, le=Decimal('1e18'))]
Ratio = Annotated[Decimal, Field(ge=0, le=1)]

class StockExposure(Model):
    stock: str = Field(min_length=1, max_length=64)
    collateral_usd: Money
    scaled_debt: Annotated[int, Field(strict=True, ge=0, lt=2**128)]
    liquidation_threshold: Ratio = Decimal('.625')
    liquidation_bonus: Annotated[Decimal, Field(ge=1, le=2)] = Decimal('1.05')
    price_drop: Ratio = Decimal('0')
    executable_recovery_fraction: Ratio = Decimal('1')

    @field_validator('scaled_debt', mode='before')
    @classmethod
    def integer_string(cls, value):
        return int(value) if isinstance(value, str) and value.isascii() and value.isdigit() and len(value)<=39 else value


class JointStressRequest(Model):
    as_of: AwareDatetime
    loan_decimals: int = Field(default=18, ge=0, le=36)
    variable_borrow_index_ray: Annotated[int, Field(strict=True, ge=10**27, lt=2**128)] = 10**27
    available_usdt: Money
    supplier_claims_usdt: Money
    usdt_price_usd: Annotated[Decimal, Field(gt=0, le=10)] = Decimal('1')
    stocks: list[StockExposure] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique(self):
        if len({s.stock.upper() for s in self.stocks}) != len(self.stocks):
            raise ValueError('Duplicate stock exposures reuse liquidation liquidity')
        return self

def analyse_joint_stress(request: JointStressRequest):
    """Each stock is an aggregate book; correlated shocks are applied together, not independently allocated cash."""
    r=request
    debt_by_stock={s.stock: Decimal((s.scaled_debt*r.variable_borrow_index_ray + 10**27-1)//10**27)/Decimal(10)**r.loan_decimals for s in r.stocks}
    total=sum(debt_by_stock.values(),Decimal(0))
    stock_results=[]; total_loss=Decimal(0); total_recovery=Decimal(0)
    for s in r.stocks:
        debt=debt_by_stock[s.stock]
        stressed_value=s.collateral_usd*(1-s.price_drop)
        debt_usd=debt*r.usdt_price_usd
        recovery=min(debt_usd,stressed_value*s.executable_recovery_fraction/s.liquidation_bonus)
        loss=max(Decimal(0),debt_usd-recovery)/r.usdt_price_usd
        total_loss+=loss;total_recovery+=recovery/r.usdt_price_usd
        stock_results.append(dict(stock=s.stock,accrued_debt_usdt=str(debt),
            liquidation_threshold=str(s.liquidation_threshold),
            health_factor=str(stressed_value*s.liquidation_threshold/debt_usd) if debt_usd else None,
            economic_shortfall_usdt=str(loss)))
    return dict(analysis='JOINT_STRESS_RESEARCH',as_of=r.as_of.isoformat(),simulated=True,executable=False,
        total_accrued_debt_usdt=str(total),aggregate_shortfall_usdt=str(total_loss),
        supplier_loss_fraction=str(min(Decimal(1),total_loss/r.supplier_claims_usdt)) if r.supplier_claims_usdt else None,
        cash_plus_stressed_recovery_usdt=str(r.available_usdt+total_recovery),stocks=stock_results,
        assumptions=['Caller-supplied snapshots are unverified simulations; stock books must use the same observation cutoff',
          'Scaled debt uses the supplied current Aave RAY index; future interest requires a projected index',
          'Joint economic shortfall is a stress proxy for shared supplier exposure, not an allocated or realized supplier loss',
          'Recovery is an economic stress estimate, not a reproduction of Aave close factors, liquidation ordering or deficit write-offs'])
