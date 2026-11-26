import os
from pathlib import Path
from app.routing.models import ContractTarget, RoutingPolicy


def demo_policy() -> RoutingPolicy:
    # Placeholder identities, not claims of deployed or approved production contracts.
    return RoutingPolicy(targets=[
        ContractTarget(target_id='demo-nvda-primary', chain_id=56, market_id='0x' + 'a'*64,
                       contract_address='0x' + '1'*40, collateral_asset='BNB_STOCK_NVDA',
                       underlying_venue='NASDAQ', approved=True),
        ContractTarget(target_id='demo-spy-alternative', chain_id=56, market_id='0x' + 'b'*64,
                       contract_address='0x' + '2'*40, collateral_asset='BNB_STOCK_SPY',
                       underlying_venue='NYSE_ARCA', approved=True)])


def load_routing_policy() -> RoutingPolicy:
    path = os.getenv('RISK_ROUTING_CONFIG_PATH')
    return RoutingPolicy.model_validate_json(Path(path).read_text()) if path else demo_policy()
