"""FastAPI entrypoint. All default observations and borrowers are simulated."""
import asyncio
import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.integrations.market_status import LiveMarketStatusProvider
from app.agents.issuer_agent import IssuerAgent, OpenAICompatibleProvider
from app.api.risk import router
from app.config import load_policy
from app.models import Model, SimulateRequest
from app.services.risk_service import RiskService, UnsupportedAsset
from app.services.store import AuditStore
from app.routing.policy import load_routing_policy

logger = logging.getLogger(__name__)


class HealthResponse(Model):
    status: str
    default_data_mode: str
    model_version: str
    configuration_version: str
    signing_enabled: bool
    monitor_enabled: bool
    last_monitor_success: str | None


async def monitor(app: FastAPI, stop: asyncio.Event, interval: float):
    while not stop.is_set():
        try:
            await asyncio.to_thread(app.state.service.recommend, "NVDA", SimulateRequest())
            app.state.last_monitor_success = datetime.now(timezone.utc).isoformat()
            app.state.monitor_error = False
        except Exception:
            app.state.monitor_error = True
            logger.error("Risk monitoring cycle failed; no recommendation should be applied")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


def create_app(injected_service: RiskService | None = None, status_provider: LiveMarketStatusProvider | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        owned = injected_service is None
        if injected_service:
            app.state.service = injected_service
        else:
            agent = IssuerAgent()
            mode = os.getenv("ISSUER_PROVIDER", "mock")
            if mode == "openai_compatible":
                agent = IssuerAgent(OpenAICompatibleProvider(os.environ["LLM_BASE_URL"], os.environ["LLM_API_KEY"], os.environ["LLM_MODEL"]))
            elif mode != "mock":
                raise ValueError("Unknown ISSUER_PROVIDER")
            app.state.service = RiskService(load_policy(), AuditStore(os.getenv("RISK_DB_PATH", "risk.sqlite3")), agent=agent)
        app.state.routing_policy = load_routing_policy()
        app.state.market_status = status_provider or LiveMarketStatusProvider(app.state.service.store)
        interval = float(os.getenv("RISK_POLL_SECONDS", "0"))
        if interval != 0 and (not 10 <= interval <= 86400):
            raise ValueError("RISK_POLL_SECONDS must be 0 (disabled) or between 10 and 86400")
        app.state.monitor_enabled = interval > 0
        app.state.last_monitor_success = None
        app.state.monitor_error = False
        stop = asyncio.Event()
        task = asyncio.create_task(monitor(app, stop, interval)) if interval else None
        yield
        stop.set()
        if task:
            await task
        if status_provider is None:
            app.state.market_status.close()
        if owned:
            app.state.service.store.close()

    app = FastAPI(title="Dawn AI Risk Controller", version="0.1.0", lifespan=lifespan,
                  description="Advisory NVDA collateral risk. Default market, oracle, issuer and borrower inputs are SIMULATED. No transaction execution or private keys.")
    app.include_router(router)

    @app.exception_handler(UnsupportedAsset)
    async def unsupported(request: Request, exc: UnsupportedAsset):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ValueError)
    async def invalid_policy_request(request: Request, exc: ValueError):
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(sqlite3.Error)
    async def storage_failure(request: Request, exc: sqlite3.Error):
        logger.error("Risk audit storage unavailable")
        return JSONResponse(status_code=503, content={"detail": "Audit storage unavailable; recommendation not delivered"})

    @app.get("/health", tags=["Health"], response_model=HealthResponse)
    def health(request: Request):
        svc = request.app.state.service
        svc.store.history("assessment", "BNB_STOCK_NVDA", 1)
        return {"status": "degraded" if request.app.state.monitor_error else "ok",
                "default_data_mode": "SIMULATED", "model_version": svc.policy.model_version,
                "configuration_version": svc.policy.fingerprint,
                "signing_enabled": svc.signer is not None, "monitor_enabled": request.app.state.monitor_enabled,
                "last_monitor_success": request.app.state.last_monitor_success}

    return app


app = create_app()
