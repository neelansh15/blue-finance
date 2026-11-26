from datetime import datetime, timezone

from fastapi import APIRouter, Body, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder

from app.models import (Assessment, AssessRequest, Model, Recommendation, RiskEvent, RiskScore,
                        SimulateRequest, SimulationResult)
from app.services.risk_service import RiskService
from app.integrations.market_status import AssetMarketStatus, status_failures
from app.routing.engine import route_markets
from app.routing.models import RoutingDecision, RoutingRequest
from app.simulation.portfolio import default_scenarios, simulate
from app.blue import BlueProposal, propose_blue

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


class AdvisoryResponse(SimulationResponse):
    recommendation: Recommendation
    blue_proposal: BlueProposal


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


@router.get("/overview", summary="Five-second-cached asset health and risk factors for the dashboard")
def overview(request: Request):
    return JSONResponse(content=jsonable_encoder(service(request).overview()),
                        headers={"Cache-Control": "no-store"})


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


@router.post("/advisory/{asset}", response_model=AdvisoryResponse,
             summary="Assess an explicit demo portfolio once for an advisory frontend summary")
def advisory(asset: str, request: Request, body: SimulateRequest):
    # An empty account must never silently become the synthetic 120-borrower book.
    if body.borrowers is None:
        raise HTTPException(422, "Explicit borrowers required; use [] for an empty account")
    svc = service(request)
    svc.require_position_support(asset)
    assessment, snapshot = svc.assess(asset, body)
    recommendation = svc.recommend_assessed(assessment, snapshot, body)
    scenarios = body.scenarios if body.scenarios is not None else default_scenarios()
    results = [simulate(assessment, snapshot, body.borrowers, s, svc.policy) for s in scenarios]
    proposal = propose_blue(assessment, recommendation, svc.policy, request.app.state.blue_config)
    svc.store.put('blue_proposal', assessment.asset, assessment.as_of.isoformat(), proposal.model_dump(mode='json'))
    return AdvisoryResponse(assessment=assessment, recommendation=recommendation, simulations=results, blue_proposal=proposal)


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
    return route_markets(service(request), asset, body, request.app.state.routing_policy,
                         request.app.state.market_status)


@router.get('/market-status/{asset}', response_model=list[AssetMarketStatus],
            summary='Fetch live Nasdaq session/halts and individual Binance bStock status')
def market_status(asset: str, request: Request):
    canonical = service(request).assets.get(asset.upper(), asset.upper())
    matches = [t for t in request.app.state.routing_policy.targets if t.collateral_asset == canonical]
    if not matches:
        raise HTTPException(404, 'Asset has no server-configured status mapping')
    observations = [request.app.state.market_status.get(t) for t in matches]
    for status in observations:
        service(request).store.put('market_status', canonical, status.as_of.isoformat(), status.model_dump(mode='json'))
    failures = [failure for status in observations
                for failure in status_failures(status, request.app.state.market_status.clock())]
    if failures:
        return JSONResponse(status_code=503, content={
            'detail': 'Live market status unavailable; upstream 200/201 and valid fresh data required',
            'failures': failures, 'observations': [s.model_dump(mode='json') for s in observations]})
    return observations
