"""Run the weekend demonstration through the actual REST routes, without API keys."""
import argparse
import json
from contextlib import ExitStack
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from app.config import Policy
from app.integrations.providers import DEMO_TIMES
from app.main import create_app
from app.services.risk_service import RiskService
from app.services.store import AuditStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Optional running server, e.g. http://127.0.0.1:8000")
    parser.add_argument("--output", type=Path, help="Write full JSON evidence and recommendations")
    args = parser.parse_args()
    with ExitStack() as stack:
        if args.url:
            client = stack.enter_context(httpx.Client(base_url=args.url, timeout=60))
        else:
            store = AuditStore(":memory:")
            stack.callback(store.close)
            client = stack.enter_context(TestClient(create_app(RiskService(Policy(), store))))
        outputs = []
        print("SIMULATED NVDA weekend risk demonstration — no live observations or transactions")
        print(f"{'Scenario':<12} {'Risk':>7} {'Target LTV':>12} {'Borrow cap USD':>16} {'At risk':>9} {'Liquidatable':>14}")
        for scenario in ["baseline", "friday", "saturday"]:
            body = {"scenario": scenario, "as_of": DEMO_TIMES[scenario].isoformat()}
            assessment_response = client.post("/risk/assess/NVDA", json=body)
            assessment_response.raise_for_status()
            response = client.post("/risk/recommend/NVDA", json=body)
            response.raise_for_status()
            r = response.json()
            params, simulation = r["recommended_parameters"], r["simulation"]
            print(f"{scenario:<12} {r['risk_score']:>7.2f} {params['ltv']:>11.1%} {params['borrow_cap']:>16,.0f} "
                  f"{simulation['at_risk']:>9} {simulation['liquidatable']:>14}")
            outputs.append({"scenario": scenario, "assessment": assessment_response.json(), "recommendation": r})
        shocks = client.post("/risk/simulate/NVDA", json={"scenario": "friday"})
        shocks.raise_for_status()
        results = {"disclaimer": "All inputs are simulated; historical recommendations are expired, unsigned and pending review.",
                   "weekend": outputs, "friday_shocks": shocks.json()}
        print("Friday target limits tighten before closure; Saturday restriction blocks new exposure.")
        print("Existing market LLTV stays 62.5%; economic risk flags and liquidation eligibility are distinct.")
        if args.output:
            args.output.write_text(json.dumps(results, indent=2) + "\n")
            print(f"Full results: {args.output.resolve()}")


if __name__ == "__main__":
    main()
