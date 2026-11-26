"""Aave V3 shared-reserve advisory accounting. No Morpho LLTV formula or transaction executor."""
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
    base_ltv: Ratio = Decimal('.5')
    liquidation_threshold: Ratio = Decimal('.625')
    liquidation_bonus: Annotated[Decimal, Field(ge=1, le=2)] = Decimal('1.05')
    borrow_discount: Ratio = Decimal('0')
    stock_debt_cap: Money
    price_drop: Ratio = Decimal('0')
    executable_recovery_fraction: Ratio = Decimal('1')
    permission_healthy: bool = True

    @field_validator('scaled_debt', mode='before')
    @classmethod
    def integer_string(cls, value):
        return int(value) if isinstance(value, str) and value.isascii() and value.isdigit() and len(value)<=39 else value

    @model_validator(mode='after')
    def ordered(self):
        if self.base_ltv >= self.liquidation_threshold:
            raise ValueError('Borrow LTV must be below liquidation threshold')
        return self

class SharedReserveRequest(Model):
    as_of: AwareDatetime
    loan_decimals: int = Field(default=18, ge=0, le=36)
    variable_borrow_index_ray: Annotated[int, Field(strict=True, ge=10**27, lt=2**128)] = 10**27
    available_usdt: Money
    supplier_claims_usdt: Money
    reserve_debt_cap_usdt: Money
    liquidity_buffer_usdt: Money = Decimal('0')
    max_stock_budget_share: Ratio = Decimal('.6')
    usdt_price_usd: Annotated[Decimal, Field(gt=0, le=10)] = Decimal('1')
    stocks: list[StockExposure] = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def unique(self):
        if len({s.stock.upper() for s in self.stocks}) != len(self.stocks):
            raise ValueError('Duplicate stock exposures reuse liquidation liquidity')
        return self

def assess_shared_reserve(request: SharedReserveRequest):
    """Each stock is an aggregate book; correlated shocks are applied together, not independently allocated cash."""
    r=request
    debt_by_stock={s.stock: Decimal((s.scaled_debt*r.variable_borrow_index_ray + 10**27-1)//10**27)/Decimal(10)**r.loan_decimals for s in r.stocks}
    total=sum(debt_by_stock.values(),Decimal(0))
    cash=max(Decimal(0),r.available_usdt-r.liquidity_buffer_usdt)
    global_headroom=max(Decimal(0),r.reserve_debt_cap_usdt-total)
    stock_results=[]; total_loss=Decimal(0); total_recovery=Decimal(0)
    for s in r.stocks:
        debt=debt_by_stock[s.stock]
        stressed_value=s.collateral_usd*(1-s.price_drop)
        debt_usd=debt*r.usdt_price_usd
        recovery=min(debt_usd,stressed_value*s.executable_recovery_fraction/s.liquidation_bonus)
        loss=max(Decimal(0),debt_usd-recovery)/r.usdt_price_usd
        total_loss+=loss;total_recovery+=recovery/r.usdt_price_usd
        ceiling=min(s.stock_debt_cap,r.reserve_debt_cap_usdt*r.max_stock_budget_share)
        position_headroom=max(Decimal(0),stressed_value*s.base_ltv*(1-s.borrow_discount)/r.usdt_price_usd-debt)
        allowance=min(cash,global_headroom,max(Decimal(0),ceiling-debt),position_headroom) if s.permission_healthy else Decimal(0)
        stock_results.append(dict(stock=s.stock,accrued_debt_usdt=str(debt),effective_borrow_ltv=str(s.base_ltv*(1-s.borrow_discount)),
            liquidation_threshold=str(s.liquidation_threshold),
            health_factor=str(stressed_value*s.liquidation_threshold/debt_usd) if debt_usd else None,
            individual_borrow_headroom_usdt=str(allowance),economic_shortfall_usdt=str(loss)))
    return dict(protocol='AAVE_V3',simulated=True,executable=False,approval_required=True,
        total_accrued_debt_usdt=str(total),shared_cash_headroom_usdt=str(cash),reserve_debt_headroom_usdt=str(global_headroom),
        shared_new_borrow_budget_usdt=str(min(cash,global_headroom)),aggregate_shortfall_usdt=str(total_loss),
        supplier_loss_fraction=str(min(Decimal(1),total_loss/r.supplier_claims_usdt)) if r.supplier_claims_usdt else None,
        cash_plus_stressed_recovery_usdt=str(r.available_usdt+total_recovery),stocks=stock_results,
        assumptions=['Caller-supplied snapshots are unverified simulations; all five stock books must use the same observation cutoff',
          'Individual headrooms compete for ONE shared budget and must never be added together',
          'Scaled debt uses the supplied current Aave RAY index; future interest requires a projected index',
          'Regime discounts affect new borrowing only; liquidation health uses the undiscounted oracle mark',
          'Joint recovery shortfall is borne by shared USDT suppliers; no loss isolation is claimed',
          'Recovery is an economic stress estimate, not a reproduction of Aave close factors, liquidation ordering or deficit write-offs'])
