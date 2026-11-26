"""Simulated contract-selection demo through the API; never submits transactions."""
from fastapi.testclient import TestClient
from app.config import Policy
from app.integrations.providers import DEMO_TIMES, MockProviders
from app.main import create_app
from app.models import OracleMode
from app.routing.models import Controls, MarketInput, RoutingRequest
from app.routing.policy import demo_policy
from app.services.risk_service import RiskService
from app.services.store import AuditStore


def demo_request() -> RoutingRequest:
    at = DEMO_TIMES['baseline']
    return RoutingRequest(status_mode='SIMULATED', as_of=at, primary_target_id='demo-nvda-primary', markets=[
        MarketInput(target_id=t.target_id, controls=Controls(observed_at=at, source_reference='mock://control-evidence',
                    government_pause='NONE', governance_paused=False, token_transfers_paused=False))
        for t in demo_policy().targets])


def main():
    store = AuditStore(':memory:')
    try:
        with TestClient(create_app(RiskService(Policy(), store))) as client:
            print('SIMULATED, UNSIGNED, PENDING REVIEW: no migrations or transactions')
            for scenario in ['healthy', 'governance_pause', 'government_asset_halt', 'global_halt', 'high_volatility']:
                req = demo_request()
                if scenario == 'governance_pause': req.markets[0].controls.governance_paused = True
                if scenario == 'government_asset_halt': req.markets[0].controls.government_pause = 'ASSET'
                if scenario == 'global_halt': req.markets[0].controls.government_pause = 'GLOBAL'
                if scenario == 'high_volatility':
                    snap = MockProviders().snapshot('BNB_STOCK_NVDA', req.as_of, 'baseline', OracleMode.FEED_24_5)
                    for i, point in enumerate(snap.market.history): point.price = 140 if i % 2 else 180
                    req.markets[0].assessment.snapshot = snap
                response = client.post('/risk/route/NVDA', json=req.model_dump(mode='json'))
                response.raise_for_status()
                data = response.json()
                target = data['proposed_target']
                print(f"{scenario}: {data['action']} -> {target['target_id'] if target else 'none'}")
    finally:
        store.close()


if __name__ == '__main__':
    main()
