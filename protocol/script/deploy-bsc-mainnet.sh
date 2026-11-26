#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="${PATH}:$HOME/.foundry/bin"

export BLUE_ADMIN=0xf475D99Be3241c69454eA8AF7B12F38078F697bc
export BLUE_KEEPER="$BLUE_ADMIN"
export BLUE_SIGNER="$BLUE_ADMIN"
export BLUE_GUARDIAN=0x08DcE649f86AF45dA8648FaD31D1C33A617C52d1
export BLUE_SEED_USDT=0
rpc_url="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"

# Anvil forks also use chain ID 56, so keep their recovery state apart from mainnet.
export FOUNDRY_BROADCAST=broadcast/bsc-mainnet
export FOUNDRY_CACHE_PATH=cache/bsc-mainnet

if [[ "$(cast chain-id --rpc-url "$rpc_url")" != 56 ]]; then
  printf '%s\n' 'The RPC must return BNB Smart Chain mainnet chain ID 56.' >&2
  exit 1
fi

printf 'Connect MetaMask account %s on BNB Smart Chain (chain ID 56).\n' "$BLUE_ADMIN"
printf '%s\n' 'When Foundry starts the signing page, open http://127.0.0.1:9545 in the browser with MetaMask.'

export BLUE_ALLOW_MAINNET=true
exec forge script script/DeployBsc.s.sol:DeployBsc \
  --rpc-url "$rpc_url" \
  --sender "$BLUE_ADMIN" \
  --legacy --browser --browser-disable-open --slow --broadcast
