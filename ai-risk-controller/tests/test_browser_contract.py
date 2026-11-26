import pytest
from fastapi.testclient import TestClient
from app.config import Policy
from app.main import create_app
from app.services.risk_service import RiskService
from app.services.store import AuditStore


@pytest.fixture
def service():
    store = AuditStore(':memory:')
    yield RiskService(Policy(), store)
    store.close()


def test_existing_frontend_symbol_is_an_explicit_backend_alias(service, monkeypatch):
    monkeypatch.delenv('RISK_ALLOWED_ORIGINS', raising=False)
    with TestClient(create_app(service)) as client:
        response = client.post('/risk/advisory/NVDAB', json={'scenario':'friday','borrowers':[]})
        assert response.status_code == 200, response.text
        assert response.json()['assessment']['asset'] == 'BNB_STOCK_NVDA'
        assert response.json()['blue_proposal']['asset'] == 'BNB_STOCK_NVDA'


def test_optional_cors_allows_only_declared_origins_without_credentials(service, monkeypatch):
    monkeypatch.setenv('RISK_ALLOWED_ORIGINS', 'http://localhost:3000, https://frontend.example/')
    with TestClient(create_app(service)) as client:
        headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}
        response = client.options('/risk/advisory/NVDAB', headers=headers)
        assert response.status_code == 200
        assert response.headers['access-control-allow-origin'] == 'http://localhost:3000'
        assert 'access-control-allow-credentials' not in response.headers
        rejected = client.options('/risk/advisory/NVDAB', headers=headers | {'Origin':'https://other.example'})
        assert rejected.status_code == 400
        assert 'access-control-allow-origin' not in rejected.headers


def test_cors_is_disabled_by_default(service, monkeypatch):
    monkeypatch.delenv('RISK_ALLOWED_ORIGINS', raising=False)
    with TestClient(create_app(service)) as client:
        response = client.options('/risk/advisory/NVDAB', headers={'Origin':'http://localhost:3000','Access-Control-Request-Method':'POST'})
        assert response.status_code == 405
        assert 'access-control-allow-origin' not in response.headers


@pytest.mark.parametrize('origin', ['*','ftp://frontend.example','https://user:password@frontend.example','https://frontend.example/path'])
def test_invalid_cors_configuration_is_rejected(service, monkeypatch, origin):
    monkeypatch.setenv('RISK_ALLOWED_ORIGINS', origin)
    with pytest.raises(ValueError, match='explicit HTTP'):
        create_app(service)
