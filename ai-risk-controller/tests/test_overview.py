from fastapi.testclient import TestClient

from app.config import Policy
from app.main import create_app
from app.services.risk_service import RiskService
from app.services.store import AuditStore


def test_overview_cache_refresh_and_health_semantics(monkeypatch):
    with_store = AuditStore(':memory:')
    service = RiskService(Policy(), with_store)
    clock = [100.0]
    monkeypatch.setattr('app.services.risk_service.time.monotonic', lambda: clock[0])
    try:
        with TestClient(create_app(service)) as client:
            first = client.get('/risk/overview')
            assert first.status_code == 200
            assert first.headers['cache-control'] == 'no-store'
            data = first.json()
            assert data['refresh_after_seconds'] == 5
            assert len(data['assets']) == 5
            assert {row['asset'] for row in data['assets']} == {'BNB_STOCK_NVDA', 'BNB_STOCK_QQQ', 'BNB_STOCK_SPCX', 'BNB_STOCK_TSLA', 'BNB_STOCK_GOOGL'}
            assert all(row['status'] == 'available' and row['simulated'] for row in data['assets'])
            assert 'hypothetical' in data['assets'][2]['description']
            row = data['assets'][0]
            assert row['status'] == 'available'
            assert row['simulated'] is True
            assert 'NVDAB' in row['aliases']
            assert row['health_score'] == round(100 - row['risk_score'], 1)
            assert {f['name'] for f in row['factors']} == {'volatility', 'liquidity', 'issuer', 'oracle', 'concentration'}
            assert all(f['description'] for f in row['factors'])
            assert client.get('/risk/overview').json() == data
            assert len(with_store.history('assessment', row['asset'])) == 1
            clock[0] += 4.9
            assert client.get('/risk/overview').json() == data
            clock[0] += .1
            assert client.get('/risk/overview').json()['generated_at'] != data['generated_at']
            assert len(with_store.history('assessment', row['asset'])) == 2
    finally:
        with_store.close()


def test_overview_isolates_asset_failures_and_discovers_configured_assets(monkeypatch):
    store = AuditStore(':memory:')
    service = RiskService(Policy(), store, assets={'NVDA': 'BNB_STOCK_NVDA', 'QQQB': 'BNB_STOCK_QQQ'})
    original = service.assess

    def assess(asset, request):
        if asset == 'QQQB':
            raise RuntimeError('private provider diagnostic')
        return original(asset, request)

    monkeypatch.setattr(service, 'assess', assess)
    try:
        with TestClient(create_app(service)) as client:
            result = client.get('/risk/overview')
            rows = result.json()['assets']
            assert [row['status'] for row in rows] == ['available', 'unavailable']
            assert 'health_score' not in rows[1]
            assert rows[1]['aliases'] == ['QQQB']
            assert 'private provider diagnostic' not in result.text
    finally:
        store.close()


def test_asset_profiles_and_aliases_are_distinct_and_audit_is_separate():
    store = AuditStore(':memory:')
    try:
        with TestClient(create_app(RiskService(Policy(), store))) as client:
            results = {}
            for alias, canonical, price in [('NVDAB', 'BNB_STOCK_NVDA', 140), ('QQQb', 'BNB_STOCK_QQQ', 510), ('SpaceX', 'BNB_STOCK_SPCX', 130), ('TSLAb', 'BNB_STOCK_TSLA', 380), ('Googlb', 'BNB_STOCK_GOOGL', 275)]:
                response = client.post(f'/risk/assess/{alias}', json={'scenario': 'friday'})
                assert response.status_code == 200, response.text
                row = response.json()
                assert row['asset'] == canonical
                assert row['simulated'] is True
                assert row['recovery']['reference_price'] <= price
                assert all(source['simulated'] for source in row['sources'])
                assert all(canonical in source['reference'] for source in row['sources'])
                assert client.get(f'/risk/score/{alias}').json()['asset'] == canonical
                assert client.get(f'/risk/events/{alias}').json()['asset'] == canonical
                results[alias] = row
            assert len({row['evidence_hash'] for row in results.values()}) == 5
            assert len({row['metrics']['annualised_volatility'] for row in results.values()}) == 5
            assert len({row['metrics']['depth_usd'] for row in results.values()}) == 5
            assert results['QQQb']['score']['overall'] < results['NVDAB']['score']['overall'] < results['SpaceX']['score']['overall']
            for alias in ['QQQB', 'SPCXB', 'TSLAB', 'GOOGLB']:
                for operation, body in [('advisory', {'borrowers': []}), ('recommend', {}), ('simulate', {})]:
                    assert client.post(f'/risk/{operation}/{alias}', json=body).status_code == 404
            assert client.post('/risk/assess/UNKNOWN', json={}).status_code == 404
    finally:
        store.close()
