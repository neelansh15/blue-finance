#!/usr/bin/env bash
# One-command check: starts the fork + deploy, runs the 4 demo scenarios live, prints PASS/FAIL.
#   demo/check.sh            full run (restarts anvil, redeploys)
#   demo/check.sh --no-start reuse the running anvil/deployment
# Each scenario starts from an anvil snapshot taken after scenario 1, so they are independent.
set -uo pipefail
DEMO="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$DEMO")"
source "$DEMO/config.env"
mkdir -p "$DEMO/logs"; pkill -9 -f "[l]iquidationBot.ts" 2>/dev/null; : > "$DEMO/logs/bot.log"
TSX="$ROOT/keepers/node_modules/.bin/tsx"
FAILS=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILS=$((FAILS+1)); }
chk()  { if [ "$1" = "1" ]; then pass "$2"; else fail "$2"; fi; }
jf()   { node -e 'const o=JSON.parse(process.argv[1]);let v=o[process.argv[2]];console.log(v===null||v===undefined?"null":v)' "$1" "$2"; }
lt()   { node -e 'console.log(Number(process.argv[1])<Number(process.argv[2])?1:0)' "$1" "$2"; }
ge()   { node -e 'console.log(Number(process.argv[1])>=Number(process.argv[2])?1:0)' "$1" "$2"; }
snap() { (cd "$ROOT" && "$TSX" demo/step.ts snap 2>/dev/null | tail -1); }

if [ "${1:-}" != "--no-start" ]; then
  echo "== starting anvil fork + deploy (log: demo/logs/)"; bash "$DEMO/start.sh" > "$DEMO/logs/start.out" 2>&1 || { echo "FAIL  start.sh (see demo/logs/start.out)"; exit 1; }
fi
set -a; source "$ROOT/keepers/.env.anvil"; set +a
TOKEN=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].token)')
FEED=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].feed)')
ORACLE=$(node -e 'console.log(JSON.parse(process.env.ASSETS)[0].oracle)')
demo() { (cd "$ROOT/keepers" && DEMO_PRIVATE_KEY="$DEPLOYER_KEY" "$TSX" src/demoControl.ts "$@" 2>/dev/null | tail -1); }
rpc()  { cast rpc "$@" --rpc-url "$RPC_URL" 2>/dev/null; }

BOT_PID=""
stop_bot()  { pkill -9 -f "[l]iquidationBot.ts" 2>/dev/null; BOT_PID=""; }  # tsx forks a child, so kill by pattern
start_bot() { stop_bot; (cd "$ROOT/keepers" && nohup "$TSX" src/liquidationBot.ts >> "$DEMO/logs/bot.log" 2>&1 & echo $! > "$DEMO/bot.pid"); BOT_PID=$(cat "$DEMO/bot.pid"); }
trap stop_bot EXIT
revert() { rpc evm_revert "$SNAP" >/dev/null; SNAP=$(rpc evm_snapshot | tr -d '"'); }

echo "== scenario 1: borrow in OPEN"
S=$(snap); [ "$(jf "$S" regime)" = "OPEN" ] && pass "regime is OPEN" || fail "regime is $(jf "$S" regime), expected OPEN"
R=$(cd "$ROOT" && "$TSX" demo/step.ts open "$CHECK_COLLATERAL" "$CHECK_BORROW" 2>/dev/null | tail -1)
[ "$(jf "$R" ok)" = "true" ] && pass "borrow $CHECK_BORROW against $CHECK_COLLATERAL bAAPL within limit accepted" || fail "borrow rejected: $R"
R=$(cd "$ROOT" && "$TSX" demo/step.ts open 0 100 2>/dev/null | tail -1)
case "$R" in *AboveTargetLtv*) pass "borrow +100 (debt 1100 > router limit) rejected: AboveTargetLtv";; *) fail "over-limit borrow not rejected as AboveTargetLtv: $R";; esac
S=$(snap); chk "$(ge "$(jf "$S" hf)" 1.2)" "health factor $(jf "$S" hf) >= 1.2"
SNAP=$(rpc evm_snapshot | tr -d '"')

echo "== scenario 2: flip to WEEKEND"
start_bot
demo regime set "$TOKEN" WEEKEND --duration "$WEEKEND_DURATION_S" >/dev/null
demo oracle update "$ORACLE" >/dev/null
sleep $((POLL_INTERVAL_MS/1000*2+3))
S=$(snap)
[ "$(jf "$S" regime)" = "WEEKEND" ] && pass "regime is WEEKEND" || fail "regime $(jf "$S" regime)"
chk "$(lt "$(jf "$S" oraclePricePerRaw)" 200)" "oracle price tightened to $(jf "$S" oraclePricePerRaw) (haircut)"
chk "$(ge "$(jf "$S" collateral)" "$CHECK_COLLATERAL")" "position untouched (collateral $(jf "$S" collateral), debt $(jf "$S" debt), hf $(jf "$S" hf))"
R=$(cd "$ROOT" && "$TSX" demo/step.ts open 0 50 2>/dev/null | tail -1)
case "$R" in *AboveTargetLtv*) pass "extra borrow now rejected (tighter limit)";; *) fail "extra borrow not rejected under WEEKEND: $R";; esac
stop_bot; revert

echo "== scenario 3: 2-for-1 split"
start_bot
demo multiplier "$TOKEN" "$SPLIT_MULTIPLIER_WAD_HUMAN" >/dev/null   # feed has not caught up yet: naive price would double
demo oracle update "$ORACLE" >/dev/null
sleep $((POLL_INTERVAL_MS/1000*2+3))
S=$(snap)
[ "$(jf "$S" frozen)" = "true" ] && pass "oracle frozen on multiplier change" || fail "oracle not frozen: $S"
chk "$(ge "$(jf "$S" oraclePricePerRaw)" 175)" "frozen price held near last good ($(jf "$S" oraclePricePerRaw) = 200 less CORP_ACTION haircut), not the naive 2x / 0.5x"
chk "$(ge "$(jf "$S" collateral)" "$CHECK_COLLATERAL")" "no liquidation (collateral $(jf "$S" collateral), debt $(jf "$S" debt), hf $(jf "$S" hf))"
demo price "$FEED" "$(node -e "console.log(200/$SPLIT_MULTIPLIER_WAD_HUMAN)")" >/dev/null   # feed catches up (per-share price halves)
demo oracle update "$ORACLE" >/dev/null
sleep $((POLL_INTERVAL_MS/1000*2+3))
S=$(snap); echo "      after feed catch-up: frozen=$(jf "$S" frozen) price=$(jf "$S" oraclePricePerRaw) hf=$(jf "$S" hf)"
chk "$(ge "$(jf "$S" collateral)" "$CHECK_COLLATERAL")" "still no liquidation after feed catch-up"
stop_bot; revert

echo "== scenario 4: price gap, bot liquidates"
start_bot
demo price "$FEED" "$GAP_PRICE" >/dev/null
demo oracle update "$ORACLE" >/dev/null
OK=0
for i in $(seq 1 20); do
  sleep 4; S=$(snap)
  if [ "$(ge "$(jf "$S" collateral)" "$CHECK_COLLATERAL")" = "0" ]; then OK=1; break; fi
done
chk "$OK" "bot liquidated: collateral $CHECK_COLLATERAL -> $(jf "$S" collateral), debt $CHECK_BORROW -> $(jf "$S" debt)"
stop_bot
echo
[ "$FAILS" = 0 ] && echo "ALL PASS" || echo "$FAILS FAILED (bot log: demo/logs/bot.log)"
exit "$FAILS"
