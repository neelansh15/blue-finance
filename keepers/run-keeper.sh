#!/usr/bin/env bash
# Runs the Blue keeper live on BNB mainnet. The private key is asked for once and kept in the macOS Keychain.
#   ./run-keeper.sh            run live (sends real transactions)
#   ./run-keeper.sh --dry-run  log what it would send; needs no key
#   ./run-keeper.sh --forget   delete the stored key
# Put these before the option above:
#   --demo   watch the demo pool. Both pools share the keeper wallet, so run one at a time.
#   --risk   let risk API scores tighten borrowing. Simulated scores count only with --demo.
set -euo pipefail
set +x

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

service=blue-keeper
account=keeper-private-key
export RISK_API_URL="${RISK_API_URL-https://blue-risk-controller.onrender.com}"

while [[ "${1-}" == --demo || "${1-}" == --risk ]]; do
  if [[ "$1" == --demo ]]; then
    export BLUE_DEPLOYMENT=demo
  else
    export RISK_ACTIONS=true
  fi
  shift
done
if [[ "${RISK_ACTIONS-}" == true && "${BLUE_DEPLOYMENT-}" == demo ]]; then
  export RISK_ALLOW_SIMULATED="${RISK_ALLOW_SIMULATED-true}"
fi

case "${1-}" in
  --dry-run)
    unset KEEPER_PRIVATE_KEY
    DRY_RUN=true exec pnpm -s blue-keeper
    ;;
  --forget)
    security delete-generic-password -s "$service" -a "$account" >/dev/null
    printf '%s\n' 'Stored keeper key deleted.'
    exit 0
    ;;
  '') ;;
  *)
    printf 'Unknown option: %s\n' "$1" >&2
    exit 2
    ;;
esac

if [[ "$(uname)" != Darwin ]]; then
  printf '%s\n' 'This script needs the macOS Keychain. Elsewhere, set KEEPER_PRIVATE_KEY and DRY_RUN=false yourself.' >&2
  exit 1
fi

if ! security find-generic-password -s "$service" -a "$account" >/dev/null 2>&1; then
  printf '%s\n' 'First run: paste the keeper private key (0x + 64 hex) at both prompts. It is not shown.'
  # -w with no value makes security prompt, so the key never appears in the process list or shell history.
  security add-generic-password -s "$service" -a "$account" -w
fi

KEEPER_PRIVATE_KEY="$(security find-generic-password -s "$service" -a "$account" -w)"
if [[ ! "$KEEPER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  printf '%s\n' 'The stored key is not 0x followed by 64 hex characters. Run ./run-keeper.sh --forget and try again.' >&2
  exit 1
fi
export KEEPER_PRIVATE_KEY

printf '%s\n' 'Starting the LIVE keeper. It sends real transactions on BNB Chain. Ctrl+C stops it.'
# caffeinate keeps the Mac from idle sleeping, which would lapse the 10-minute heartbeat.
DRY_RUN=false exec caffeinate -i pnpm -s blue-keeper
