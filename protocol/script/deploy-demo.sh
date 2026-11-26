#!/usr/bin/env bash
# Deploys the demo pool on BNB mainnet. You sign twice in MetaMask-compatible wallets:
# one BNB transfer to a throwaway deployer, then acceptAdmin(). Rerun with --resume if a broadcast stops midway.
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export PATH="${PATH}:$HOME/.foundry/bin"

admin=0xf475D99Be3241c69454eA8AF7B12F38078F697bc
rpc_url="${BSC_RPC_URL:-https://bsc-rpc.publicnode.com}"
key_file=deployments/demo-deployer.key
out=deployments/bsc-demo.json
app_copy=../frontend/src/lib/blue/demo-deployment.json
fund=0.006

export FOUNDRY_BROADCAST=broadcast/bsc-mainnet
export FOUNDRY_CACHE_PATH=cache/bsc-mainnet

if [[ "$(cast chain-id --rpc-url "$rpc_url")" != 56 ]]; then
  printf '%s\n' 'The RPC must return BNB Smart Chain mainnet chain ID 56.' >&2
  exit 1
fi

if [[ "$(cat "$app_copy")" != null ]]; then
  printf '%s\n' "A demo pool is already recorded in $app_copy. Set that file to null to deploy another." >&2
  exit 1
fi

mkdir -p deployments
if [[ ! -s "$key_file" ]]; then
  (umask 077; cast wallet new --json | python3 -I -c 'import json,sys
d=json.load(sys.stdin)
d=d.get("data",d) if isinstance(d,dict) else d
print((d[0] if isinstance(d,list) else d)["private_key"])' >"$key_file")
fi
DEMO_DEPLOYER_KEY="$(<"$key_file")"
export DEMO_DEPLOYER_KEY
deployer="$(cast wallet address "$DEMO_DEPLOYER_KEY")"

if [[ " $* " != *" --resume "* ]]; then
  printf '\nSignature 1 of 2: send %s BNB on BNB Smart Chain from your wallet to the throwaway deployer\n\n  %s\n\n' "$fund" "$deployer"
  printf '%s\n' 'Waiting for the funds. Ctrl+C stops; rerunning keeps the same address.'
  until [[ "$(cast balance "$deployer" --rpc-url "$rpc_url")" -ge 4500000000000000 ]]; do sleep 5; done
fi

forge script script/DeployDemo.s.sol:DeployDemo --rpc-url "$rpc_url" --legacy --slow --broadcast "$@"

field() { python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$out" "$1"; }
calendar="$(field calendar)"
if [[ "$(cast code "$(field pool)" --rpc-url "$rpc_url")" == 0x ]]; then
  printf '%s\n' 'No pool code at the recorded address. Do not continue; check the broadcast record.' >&2
  exit 1
fi

printf '\nSignature 2 of 2: connect %s at http://127.0.0.1:9545 and accept the admin role.\n' "$admin"
cast send "$calendar" 'acceptAdmin()' --from "$admin" --rpc-url "$rpc_url" --legacy --browser --browser-disable-open --async
for _ in $(seq 60); do
  [[ "$(cast call "$calendar" 'admin()(address)' --rpc-url "$rpc_url")" == "$admin" ]] && break
  sleep 3
done
if [[ "$(cast call "$calendar" 'admin()(address)' --rpc-url "$rpc_url")" != "$admin" ]]; then
  printf '%s\n' 'The calendar admin is not the expected wallet.' >&2
  exit 1
fi

# Copy only a complete record into the app.
python3 -I - "$out" "$app_copy" <<'PY'
import json, sys
record = json.load(open(sys.argv[1]))
if isinstance(record["stocks"], str):
    record["stocks"] = json.loads(record["stocks"])
assert set(record["stocks"]) == {"TSLAB", "NVDAB", "QQQB", "SPCXB", "GOOGLB"}
assert all(len(pair) == 2 for pair in record["stocks"].values())
json.dump(record, open(sys.argv[2], "w"), indent=2)
PY
printf '\nDemo pool %s is live. The app now reads it from %s.\n' "$(field pool)" "$app_copy"

# Return what is left in the throwaway wallet.
price="$(cast gas-price --rpc-url "$rpc_url")"
left="$(python3 -I -c 'import sys; print(max(int(sys.argv[1]) - 21000 * int(sys.argv[2]), 0))' "$(cast balance "$deployer" --rpc-url "$rpc_url")" "$price")"
if [[ "$left" != 0 ]]; then
  cast send "$admin" --value "$left" --gas-limit 21000 --gas-price "$price" --legacy \
    --private-key "$DEMO_DEPLOYER_KEY" --rpc-url "$rpc_url" >/dev/null || printf '%s\n' "Could not return the leftover BNB; the key is in $key_file."
fi
