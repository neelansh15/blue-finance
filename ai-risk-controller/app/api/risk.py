from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Query, Request

from app.models import (Assessment, AssessRequest, Model, Recommendation, RiskEvent, RiskScore,
                        SimulateRequest, SimulationResult)
from app.services.risk_service import RiskService
from app.routing.engine import route_markets
from app.routing.models import RoutingDecision, RoutingRequest

router = APIRouter(prefix="/risk", tags=["Risk controller"])


class ScoreResponse(Model):
    asset: str
    as_of: datetime
    simulated: bool
    evidence_hash: str
    score: RiskScore


class EventsResponse(Model):
    asset: str
    as_of: datetime
    simulated: bool
    events: list[RiskEvent]


class SimulationResponse(Model):
    assessment: Assessment
    simulations: list[SimulationResult]


class HistoryResponse(Model):
    asset: str
    current: Recommendation | None
    recommendations: list[Recommendation]
    note: str = "Current means unexpired advisory evidence, not approved for execution. Historical demo replays expire at evidence time + TTL."


def service(request: Request) -> RiskService:
    return request.app.state.service


def latest(request: Request, asset: str) -> Assessment:
    result = service(request).latest(asset)
    if result is None:
        raise HTTPException(404, "No assessment found; POST /risk/assess/{asset} first")
    return result


@router.post("/assess/{asset}", response_model=Assessment,
             summary="Assess collateral, sessions, oracle health and recoverable value")
def assess(asset: str, request: Request, body: AssessRequest = Body(default_factory=AssessRequest)):
    return service(request).assess(asset, body)[0]


@router.get("/score/{asset}", response_model=ScoreResponse)
def score(asset: str, request: Request):
    a = latest(request, asset)
    return ScoreResponse(asset=a.asset, as_of=a.as_of, simulated=a.simulated, evidence_hash=a.evidence_hash, score=a.score)


@router.post("/recommend/{asset}", response_model=Recommendation,
             summary="Generate an approval-gated advisory recommendation; never executes a transaction")
def recommend(asset: str, request: Request, body: SimulateRequest = Body(default_factory=SimulateRequest)):
    return service(request).recommend(asset, body)


@router.post("/simulate/{asset}", response_model=SimulationResponse)
def simulations(asset: str, request: Request, body: SimulateRequest = Body(default_factory=SimulateRequest)):
    assessment, results = service(request).simulate(asset, body)
    return SimulationResponse(assessment=assessment, simulations=results)


@router.get("/events/{asset}", response_model=EventsResponse)
def events(asset: str, request: Request):
    a = latest(request, asset)
    return EventsResponse(asset=a.asset, as_of=a.as_of, simulated=a.simulated, events=a.events)


@router.get("/recommendations/{asset}", response_model=HistoryResponse)
def recommendations(asset: str, request: Request, limit: int = Query(100, ge=1, le=1000)):
    svc = service(request)
    rows = svc.recommendations(asset, limit)
    now = datetime.now(timezone.utc)
    current = next((r for r in rows if r.timestamp <= now < r.expires_at), None)
    return HistoryResponse(asset=svc.asset_id(asset), current=current, recommendations=rows)


@router.post("/route/{asset}", response_model=RoutingDecision,
             summary="Assess configured markets and propose an eligible alternative contract for approval")
def route(asset: str, request: Request, body: RoutingRequest):
    return route_markets(service(request), asset, body, request.app.state.routing_policy)
