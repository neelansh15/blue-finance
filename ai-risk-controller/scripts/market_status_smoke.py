"""Read-only live status probe. No API keys, price simulation or transactions."""
import json
from app.integrations.market_status import LiveMarketStatusProvider
from app.routing.policy import load_routing_policy
from app.services.store import AuditStore


def main():
    store = AuditStore(':memory:')
    provider = LiveMarketStatusProvider(store)
    try:
        for target in load_routing_policy().targets:
            print(json.dumps({'target_id': target.target_id, **provider.get(target).model_dump(mode='json')}, indent=2))
    finally:
        provider.close()
        store.close()


if __name__ == '__main__':
    main()
