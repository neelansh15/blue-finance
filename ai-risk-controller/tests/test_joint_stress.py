from decimal import Decimal
import pytest
from app.joint_stress import JointStressRequest, analyse_joint_stress

def request(**changes):
    data=dict(as_of='2026-11-27T00:00:00Z',available_usdt=100,supplier_claims_usdt=1000,
        stocks=[dict(stock=stock,collateral_usd=1000,scaled_debt=200*10**18) for stock in ['TSLAB','NVDAB']])
    return JointStressRequest.model_validate(data|changes)

def test_baseline_reports_research_without_borrowing_policy():
    result=analyse_joint_stress(request())
    assert result['total_accrued_debt_usdt']=='400'
    assert result['aggregate_shortfall_usdt']=='0'
    assert result['cash_plus_stressed_recovery_usdt']=='500'
    assert result['analysis']=='JOINT_STRESS_RESEARCH' and result['executable'] is False
    assert 'shared_new_borrow_budget_usdt' not in result

def test_joint_losses_accumulate_across_shared_suppliers():
    r=request()
    for stock in r.stocks:stock.price_drop=Decimal('.9')
    result=analyse_joint_stress(r)
    assert Decimal(result['aggregate_shortfall_usdt'])>200
    assert Decimal(result['supplier_loss_fraction'])>Decimal('.2')
    assert Decimal(result['aggregate_shortfall_usdt'])==sum(Decimal(s['economic_shortfall_usdt']) for s in result['stocks'])

def test_single_stock_shock_leaves_other_book_unchanged():
    r=request();before=analyse_joint_stress(r)
    r.stocks[0].price_drop=Decimal('.9');after=analyse_joint_stress(r)
    assert after['stocks'][1]==before['stocks'][1]
    assert Decimal(after['aggregate_shortfall_usdt'])>0

def test_index_growth_and_depeg_are_explicit():
    result=analyse_joint_stress(request(variable_borrow_index_ray=2*10**27,usdt_price_usd=Decimal('1.1')))
    assert result['total_accrued_debt_usdt']=='800'
    assert Decimal(result['stocks'][0]['health_factor'])<Decimal('1.5625')

def test_duplicates_and_policy_inputs_are_rejected():
    data=request().model_dump();data['stocks'][1]['stock']='TSLAB'
    with pytest.raises(ValueError):JointStressRequest.model_validate(data)
    with pytest.raises(ValueError):request(reserve_debt_cap_usdt=1000)

def test_http_endpoint_accepts_exact_integer_strings():
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
            response=client.post('/research/joint-stress',json=payload)
            assert response.status_code==200,response.text
            assert response.json()['total_accrued_debt_usdt']=='400'
            payload['stocks'][0]['scaled_debt']='1e30'
            assert client.post('/research/joint-stress',json=payload).status_code==422
    finally:store.close()

def test_index_rounds_up_and_zero_claims_are_not_divided():
    r=request(loan_decimals=0,variable_borrow_index_ray=10**27+1,supplier_claims_usdt=0)
    for stock in r.stocks:stock.scaled_debt=1
    result=analyse_joint_stress(r)
    assert result['total_accrued_debt_usdt']=='4'
    assert result['supplier_loss_fraction'] is None
