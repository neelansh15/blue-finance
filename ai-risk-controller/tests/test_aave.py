from decimal import Decimal
import pytest
from app.aave import SharedReserveRequest, assess_shared_reserve

def request(**changes):
    data=dict(as_of='2026-11-27T00:00:00Z',available_usdt=100,supplier_claims_usdt=1000,reserve_debt_cap_usdt=1000,
        stocks=[dict(stock=stock,collateral_usd=1000,scaled_debt=200*10**18,stock_debt_cap=600) for stock in ['TSLAB','NVDAB']])
    return SharedReserveRequest.model_validate(data|changes)

def test_shared_cash_cannot_be_allocated_once_per_stock():
    result=assess_shared_reserve(request())
    assert result['total_accrued_debt_usdt']=='400'
    assert result['shared_new_borrow_budget_usdt']=='100'
    assert all(s['individual_borrow_headroom_usdt']=='100' for s in result['stocks'])
    assert result['protocol']=='AAVE_V3' and result['executable'] is False

def test_joint_losses_reach_shared_suppliers():
    r=request()
    for stock in r.stocks: stock.price_drop=Decimal('.9')
    result=assess_shared_reserve(r)
    assert Decimal(result['aggregate_shortfall_usdt'])>200
    assert Decimal(result['supplier_loss_fraction'])>Decimal('.2')

def test_discount_does_not_change_liquidation_health_and_halt_is_local():
    r=request();before=assess_shared_reserve(r)
    r.stocks[0].borrow_discount=Decimal('.15');r.stocks[0].permission_healthy=False
    after=assess_shared_reserve(r)
    assert after['stocks'][0]['health_factor']==before['stocks'][0]['health_factor']
    assert after['stocks'][0]['individual_borrow_headroom_usdt']=='0'
    assert Decimal(after['stocks'][1]['individual_borrow_headroom_usdt'])>0

def test_index_cap_buffer_and_depeg_are_explicit():
    result=assess_shared_reserve(request(variable_borrow_index_ray=2*10**27,liquidity_buffer_usdt=90,usdt_price_usd=Decimal('1.1')))
    assert result['total_accrued_debt_usdt']=='800'
    assert result['shared_new_borrow_budget_usdt']=='10'
    assert Decimal(result['stocks'][0]['health_factor'])<Decimal('1.5625')

def test_duplicate_stock_is_rejected():
    r=request().model_dump();r['stocks'][1]['stock']='TSLAB'
    with pytest.raises(ValueError):SharedReserveRequest.model_validate(r)

def test_http_aave_endpoint_accepts_exact_integer_strings():
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.config import Policy
    from app.services.risk_service import RiskService
    from app.services.store import AuditStore
    store=AuditStore(':memory:')
    try:
        with TestClient(create_app(RiskService(Policy(),store))) as client:
            payload=request().model_dump(mode='json')
            for stock in payload['stocks']:stock['scaled_debt']=str(stock['scaled_debt'])
            response=client.post('/risk/aave/shared-reserve',json=payload)
            assert response.status_code==200,response.text
            assert response.json()['total_accrued_debt_usdt']=='400'
            payload['stocks'][0]['scaled_debt']='1e30'
            assert client.post('/risk/aave/shared-reserve',json=payload).status_code==422
    finally:store.close()


def test_aave_variable_debt_rounds_up_not_to_nearest():
    r=request(loan_decimals=0,variable_borrow_index_ray=10**27+1)
    for stock in r.stocks:stock.scaled_debt=1
    assert assess_shared_reserve(r)['total_accrued_debt_usdt']=='4'
