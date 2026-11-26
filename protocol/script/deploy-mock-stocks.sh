#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="${PATH}:$HOME/.foundry/bin"

admin=0xf475D99Be3241c69454eA8AF7B12F38078F697bc
rpc_url="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"

# Keep mainnet records with the other mainnet deployments.
export FOUNDRY_BROADCAST=broadcast/bsc-mainnet
export FOUNDRY_CACHE_PATH=cache/bsc-mainnet

if [[ "$(cast chain-id --rpc-url "$rpc_url")" != 56 ]]; then
  printf '%s\n' 'The RPC must return BNB Smart Chain mainnet chain ID 56.' >&2
  exit 1
fi

printf 'Connect MetaMask account %s on BNB Smart Chain (chain ID 56).\n' "$admin"
printf '%s\n' 'When Foundry starts the signing page, open http://127.0.0.1:9545 in the browser with MetaMask.'

exec forge script script/DeployMockStocks.s.sol:DeployMockStocks \
  --rpc-url "$rpc_url" \
  --sender "$admin" \
  --legacy --browser --browser-disable-open --slow --broadcast "$@"
