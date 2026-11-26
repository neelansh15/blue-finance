from fastapi.testclient import TestClient
from app.config import Policy
from app.models import Assessment, AssessRequest
from app.main import create_app
from app.services.risk_service import RiskService
from app.services.store import AuditStore


def test_advisory_uses_explicit_account_and_one_evidence_snapshot():
    store = AuditStore(':memory:')
    try:
        with TestClient(create_app(RiskService(Policy(), store))) as client:
            assert client.post('/risk/advisory/NVDA', json={}).status_code == 422
            response = client.post('/risk/advisory/NVDA', json={
                'scenario': 'friday', 'borrowers': [
                    {'borrower_id': 'demo-position', 'collateral_quantity': 10,
                     'debt_usd': 350, 'liquidation_threshold': .625}]})
            assert response.status_code == 200, response.text
            result = response.json()
            assert result['assessment']['evidence_hash'] == result['recommendation']['evidence_hash']
            assert result['recommendation']['simulation']['total_positions'] == 1
            assert result['recommendation']['simulated'] is True
            assert result['recommendation']['approval_status'] == 'PENDING_REVIEW'
            assert len(result['simulations']) == 8
            assert all(s['positions'][0]['borrower_id'] == 'demo-position' for s in result['simulations'])
            empty = client.post('/risk/advisory/NVDA', json={'scenario': 'friday', 'borrowers': []}).json()
            assert empty['recommendation']['simulation']['total_positions'] == 0
            assert all(s['total_positions'] == 0 for s in empty['simulations'])
    finally:
        store.close()


def test_historical_assessment_rows_remain_readable_without_new_regime_field():
    store = AuditStore(':memory:')
    try:
        service = RiskService(Policy(), store)
        assessment, _ = service.assess('NVDA', AssessRequest(scenario='friday'))
        old = assessment.model_dump(mode='json')
        del old['session']['protocol_regime']
        restored = Assessment.model_validate(old)
        assert restored.session.protocol_regime is None
        assert restored.evidence_hash == assessment.evidence_hash
    finally:
        store.close()
