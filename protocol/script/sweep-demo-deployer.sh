#!/usr/bin/env bash
# Returns the throwaway demo deployer's leftover BNB to the admin wallet.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="${PATH}:$HOME/.foundry/bin"

admin=0xf475D99Be3241c69454eA8AF7B12F38078F697bc
rpc_url="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
key="$(<deployments/demo-deployer.key)"
deployer="$(cast wallet address "$key")"
price="$(cast gas-price --rpc-url "$rpc_url")"
left="$(python3 -I -c 'import sys; print(max(int(sys.argv[1]) - 21000 * int(sys.argv[2]), 0))' "$(cast balance "$deployer" --rpc-url "$rpc_url")" "$price")"
if [[ "$left" == 0 ]]; then
  printf '%s\n' 'Nothing left to return.'
  exit 0
fi
printf 'Sending %s wei from %s to %s\n' "$left" "$deployer" "$admin"
cast send "$admin" --value "$left" --gas-limit 21000 --gas-price "$price" --legacy --async \
  --private-key "$key" --rpc-url "$rpc_url"
