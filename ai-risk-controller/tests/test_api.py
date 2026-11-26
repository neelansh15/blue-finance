from fastapi.testclient import TestClient
import pytest

from app.config import Policy
from app.main import create_app
from app.services.risk_service import RiskService
from app.services.store import AuditStore


@pytest.fixture
def client():
    store = AuditStore(":memory:")
    with TestClient(create_app(RiskService(Policy(), store))) as c:
        yield c
    store.close()


def test_all_endpoints_and_openapi(client):
    assert client.get("/health").json()["default_data_mode"] == "SIMULATED"
    assert client.get("/risk/score/NVDA").status_code == 404
    assert client.get("/risk/score/TSLA").status_code == 404
    response = client.post("/risk/assess/NVDA", json={"scenario": "friday"})
    assert response.status_code == 200, response.text
    assert response.json()["session"]["prolonged_closure_approaching"]
    assert client.get("/risk/score/NVDA").json()["score"]["overall"] >= 0
    assert client.get("/risk/events/NVDA").json()["events"]
    r = client.post("/risk/recommend/NVDA", json={"scenario": "saturday"})
    assert r.status_code == 200, r.text
    assert r.json()["signing_status"] == "UNSIGNED"
    assert r.json()["approval_required"]
    history = client.get("/risk/recommendations/NVDA").json()
    assert len(history["recommendations"]) == 1
    assert history["current"] is None  # historical replay is expired
    simulation = client.post("/risk/simulate/NVDA", json={"scenario": "friday"})
    assert simulation.status_code == 200, simulation.text
    assert len(simulation.json()["simulations"]) == 8
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert '/risk/advisory/{asset}' in schema['paths']


def test_validation_and_empty_inputs(client):
    for body in [{"liquidation_quantity": -1}, {"as_of": "2026-11-20T13:00:00"}, {"unknown": True}]:
        assert client.post("/risk/assess/NVDA", json=body).status_code == 422
    assert client.post("/risk/assess/TSLA", json={}).status_code == 404
    result = client.post("/risk/simulate/NVDA", json={"borrowers": [], "scenarios": []})
    assert result.status_code == 200
    assert result.json()["simulations"] == []
    assert client.get("/risk/recommendations/NVDA?limit=0").status_code == 422


def test_body_optional_and_new_current_recommendation(client):
    response = client.post("/risk/recommend/NVDA")
    assert response.status_code == 200, response.text
    assert client.get("/risk/recommendations/NVDA").json()["current"] is not None
