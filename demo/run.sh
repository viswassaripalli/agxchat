#!/usr/bin/env bash
# Bring up a demo mailbox that talks to a scripted herdr instead of a terminal.
#
#   bash demo/run.sh start    # server on :7788, four fake sessions, fresh store
#   bash demo/run.sh seed     # a couple of threads so the chat view has content
#   bash demo/run.sh stop
#
# Nothing here touches your real mailbox, your panes, or port 7777: the store,
# the token, the seed, the port and the herdr binary all point somewhere else,
# and stop kills this server by recorded pid rather than by process name, which
# would take the real one with it.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
STATE="$HERE/.state"

export HERDR_BIN="$HERE/fake-herdr"
export AGX_PORT=7788
export AGX_STORE="$STATE/mail.jsonl"
export AGX_TOKEN_FILE="$STATE/token"
export AGX_SEED="$HERE/seed.json"
export AGX_NO_CHAT=1
# No shared secret for the demo: the CLI looks for the token under the install
# directory, which belongs to the real mailbox, and a demo that makes you copy
# a token around is a demo nobody runs.
export AGX_NO_AUTH=1

up() { curl -sf --max-time 2 "http://127.0.0.1:7788/health" >/dev/null 2>&1; }
dagx() { AGX_PORT=7788 "$ROOT/agx" "$@"; }
first_id() { dagx inbox "$1" 2>/dev/null | sed -n 's/^\[\([0-9a-f]*\)\].*/\1/p' | head -1; }

case "${1:-start}" in
  start)
    mkdir -p "$STATE"
    up && { echo "demo mailbox already up on :7788"; exit 0; }
    rm -f "$AGX_STORE" "$AGX_TOKEN_FILE"
    chmod +x "$HERDR_BIN"
    cd "$ROOT"
    nohup node_modules/.bin/tsx mail-server.ts </dev/null >"$STATE/server.log" 2>&1 &
    echo $! > "$STATE/server.pid"
    for _ in $(seq 20); do up && break; sleep 0.5; done
    up || { tail -20 "$STATE/server.log"; exit 1; }
    echo "demo mailbox up on :7788"
    ;;

  seed)
    dagx --from design send tests "Which suites cover the status pills?" \
      "I am changing the colour mapping and want to know what asserts on it before I touch anything." \
      --expect "suite names" >/dev/null
    tid="$(first_id tests)"
    [ -n "$tid" ] && dagx --from tests reply "$tid" \
      "None of them assert pill text. Two assert the colour class: status-badge.spec and pipeline-row.spec." >/dev/null
    dagx --from web send api "Error shape is changing" \
      "The 422 body becomes {errors:[{field,message}]}. Does anything of yours read the old flat shape?" >/dev/null
    echo "seeded"
    ;;

  stop)
    if [ -f "$STATE/server.pid" ] && kill "$(cat "$STATE/server.pid")" 2>/dev/null; then
      rm -f "$STATE/server.pid"; echo "stopped"
    else
      echo "was not running"
    fi
    ;;
esac
