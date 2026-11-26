"""Strict live acceptance check through the real API path; failure exits nonzero."""
import argparse
import json
from fastapi.testclient import TestClient
from app.config import Policy
from app.main import create_app
from app.routing.policy import load_routing_policy
from app.services.risk_service import RiskService
from app.services.store import AuditStore


def verify(client: TestClient, assets: list[str]) -> int:
    failed = False
    for asset in assets:
        response = client.get(f'/risk/market-status/{asset}')
        payload = response.json()
        print(json.dumps({'asset': asset, 'http_status': response.status_code, 'result': payload}, indent=2))
        failed |= response.status_code not in {200, 201}
    return 1 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--asset', action='append', help='Configured asset to verify; repeat for multiple assets. Default: all enabled approved targets.')
    args = parser.parse_args(argv)
    assets = args.asset or sorted({t.collateral_asset for t in load_routing_policy().targets if t.approved and t.enabled})
    if not assets:
        raise SystemExit('No configured assets to verify')
    store = AuditStore(':memory:')
    try:
        with TestClient(create_app(RiskService(Policy(), store))) as client:
            result = verify(client, assets)
    finally:
        store.close()
    return result


if __name__ == '__main__':
    raise SystemExit(main())
