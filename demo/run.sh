#!/usr/bin/env bash
# The demo mailbox: a real server, driving a real herdr, in a session of its own.
#
#   bash demo/run.sh start    # mail server on :7788, pointed at the demo session
#   bash demo/boot.sh         # the session, two agents, the chat view
#   vhs demo/demo.tape
#   bash demo/run.sh stop     # server and demo session, nothing else
#
# Nothing here reaches your mailbox or your panes. The port, store, token and
# seed all point inside demo/, and HERDR_BIN points at a herdr pinned to the
# `agxdemo` session, which has its own socket — so every pane the demo creates
# and every nudge it types stays there.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
STATE="$HERE/.state"
SESSION="${AGX_DEMO_SESSION:-agxdemo}"

export HERDR_BIN="$HERE/herdr-demo"
export AGX_DEMO_SESSION="$SESSION"
export AGX_PORT=7788
export AGX_STORE="$STATE/mail.jsonl"
export AGX_TOKEN_FILE="$STATE/token"
export AGX_SEED="$HERE/seed.json"
export AGX_NO_CHAT=1
# No shared secret: the CLI looks for a token under the install directory,
# which belongs to the real mailbox, and a demo that makes you copy a token
# around is a demo nobody runs.
export AGX_NO_AUTH=1

up() { curl -sf --max-time 2 "http://127.0.0.1:7788/health" >/dev/null 2>&1; }

case "${1:-start}" in
  start)
    mkdir -p "$STATE"
    chmod +x "$HERE/herdr-demo" "$HERE/boot.sh"
    up && { echo "demo mailbox already up on :7788"; exit 0; }
    rm -f "$AGX_STORE" "$AGX_TOKEN_FILE"
    cd "$ROOT"
    nohup node_modules/.bin/tsx mail-server.ts </dev/null >"$STATE/server.log" 2>&1 &
    echo $! > "$STATE/server.pid"
    for _ in $(seq 20); do up && break; sleep 0.5; done
    up || { tail -20 "$STATE/server.log"; exit 1; }
    echo "demo mailbox up on :7788 — session '$SESSION'"
    ;;

  stop)
    # By recorded pid, never by process name: pkill -f mail-server.ts would
    # take the real server with it.
    if [ -f "$STATE/server.pid" ] && kill "$(cat "$STATE/server.pid")" 2>/dev/null; then
      rm -f "$STATE/server.pid"; echo "server stopped"
    else
      echo "server was not running"
    fi
    # Delete, not just stop: herdr restores a stopped session's layout on the
    # next attach, so a second recording opens with the first one's panes.
    herdr session stop "$SESSION" >/dev/null 2>&1 || true
    herdr session delete "$SESSION" >/dev/null 2>&1 && echo "session '$SESSION' removed" || true
    ;;
esac
