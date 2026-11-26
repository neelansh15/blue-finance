"""Integer Morpho replay for an explicit state/rate/oracle mark. No chain reads or transaction writer."""
from typing import Annotated

from pydantic import Field, model_validator

from app.models import Model

WAD, SCALE, VIRTUAL_SHARES = 10**18, 10**36, 10**6
Uint = Annotated[int, Field(strict=True, ge=0, lt=2**256)]
Uint128 = Annotated[int, Field(strict=True, ge=0, lt=2**128)]


def muldiv(x: int, y: int, denominator: int, up=False) -> int:
    product = x*y
    if denominator <= 0 or min(x,y) < 0 or product + (denominator-1 if up else 0) >= 2**256:
        raise ValueError('EVM integer overflow or invalid divisor')
    return (product + (denominator-1 if up else 0))//denominator


def assets(shares, total_assets, total_shares, up=False):
    return muldiv(shares, total_assets+1, total_shares+VIRTUAL_SHARES, up)


def shares(assets_, total_assets, total_shares, up=False):
    return muldiv(assets_, total_shares+VIRTUAL_SHARES, total_assets+1, up)


class MorphoReplay(Model):
    total_borrow_assets: Uint128
    total_borrow_shares: Uint128
    total_supply_assets: Uint128
    total_supply_shares: Uint128
    collateral: Uint128
    borrow_shares: Uint128
    oracle_price: Annotated[int, Field(strict=True, gt=0, lt=2**256)]
    lltv_wad: Annotated[int, Field(strict=True, gt=0, lt=10**18)] = 625000000000000000
    fee_wad: Annotated[int, Field(strict=True, ge=0, le=250000000000000000)] = 0
    borrow_rate_wad: Uint = 0
    elapsed_seconds: Annotated[int, Field(strict=True, ge=0, le=31536000)] = 0
    seized_assets: Uint128 = 0
    repaid_shares: Uint128 = 0

    @model_validator(mode='after')
    def coherent(self):
        if self.borrow_shares > self.total_borrow_shares or self.total_borrow_assets > self.total_supply_assets:
            raise ValueError('Position or market totals are inconsistent')
        if self.seized_assets and self.repaid_shares:
            raise ValueError('Choose seized assets OR repaid shares')
        return self


def replay(state: MorphoReplay) -> dict:
    tba, tbs = state.total_borrow_assets, state.total_borrow_shares
    tsa, tss = state.total_supply_assets, state.total_supply_shares
    first = state.borrow_rate_wad*state.elapsed_seconds
    if first >= 2**256:
        raise ValueError('EVM integer overflow')
    second = muldiv(first, first, 2*WAD)
    third = muldiv(second, first, 3*WAD)
    if first+second+third >= 2**256:
        raise ValueError("EVM integer overflow")
    interest = muldiv(tba, first+second+third, WAD)
    tba, tsa = tba+interest, tsa+interest
    fee_amount = muldiv(interest, state.fee_wad, WAD)
    fee_shares = shares(fee_amount, tsa-fee_amount, tss) if fee_amount else 0
    tss += fee_shares
    if max(tba,tsa,tss) >= 2**128:
        raise ValueError('Accrued totals exceed uint128')
    debt = assets(state.borrow_shares, tba, tbs, up=True)
    maximum = muldiv(muldiv(state.collateral, state.oracle_price, SCALE), state.lltv_wad, WAD)
    healthy = debt <= maximum
    factor = min(1150000000000000000, muldiv(WAD, WAD,
        WAD-muldiv(300000000000000000, WAD-state.lltv_wad, WAD)))
    seized, repaid, repaid_assets, bad_assets, bad_shares = state.seized_assets, state.repaid_shares, 0, 0, 0
    remaining_collateral, remaining_shares = state.collateral, state.borrow_shares
    if seized or repaid:
        if healthy:
            raise ValueError('Healthy positions cannot be liquidated')
        if seized:
            quote = muldiv(seized, state.oracle_price, SCALE, up=True)
            repaid = shares(muldiv(quote, WAD, factor, up=True), tba, tbs, up=True)
        else:
            seized = muldiv(muldiv(assets(repaid, tba, tbs), factor, WAD), SCALE, state.oracle_price)
        if seized > remaining_collateral or repaid > remaining_shares:
            raise ValueError('Liquidation exceeds position; use a partial liquidation')
        repaid_assets = assets(repaid, tba, tbs, up=True)
        remaining_collateral -= seized
        remaining_shares -= repaid
        tbs -= repaid
        tba = max(0,tba-repaid_assets)
        if remaining_collateral == 0:
            bad_shares = remaining_shares
            bad_assets = min(tba, assets(bad_shares,tba,tbs,up=True))
            tba -= bad_assets
            tsa -= bad_assets
            tbs -= bad_shares
            remaining_shares = 0
    return {'accounting_mode':'MORPHO_INTEGER_REPLAY', 'healthy_before_liquidation':healthy,
        **{k:str(v) for k,v in dict(debt_assets=debt,maximum_borrow_assets=maximum,interest_assets=interest,
            fee_shares=fee_shares,seized_assets=seized,repaid_shares=repaid,repaid_assets=repaid_assets,
            bad_debt_assets=bad_assets,bad_debt_shares=bad_shares,remaining_collateral=remaining_collateral,
            remaining_borrow_shares=remaining_shares,total_borrow_assets=tba,total_borrow_shares=tbs,
            total_supply_assets=tsa,total_supply_shares=tss).items()},
        'assumptions':['Explicit raw units, Morpho 1e36 oracle scale and virtual-share rounding',
            'Supplied constant rate is replayed for the interval; AdaptiveCurveIrm evolution must be supplied separately',
            'Single explicit partial liquidation; no execution-liquidity or token-transfer availability claim',
            'Caller-supplied state is unverified; never execution approval']}
