#!/usr/bin/env bash
# Build the demo session before anything records it.
#
# A named session only exists once a terminal attaches, so one is attached here
# under `script`, which supplies the pty herdr needs, and left running in the
# background. The layout is then built over the CLI, so the recording attaches
# to a session that is already two agents and a chat view deep — no setup
# commands in frame.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BASE="${AGX_DEMO_DIR:-/tmp/agxdemo}"
SESSION="${AGX_DEMO_SESSION:-agxdemo}"
SOCK="$HOME/.config/herdr/sessions/$SESSION/herdr.sock"
H="$HERE/herdr-demo"

mkdir -p "$BASE/web" "$BASE/api" "$HERE/.state"

# Give the sessions something real to look at. With empty directories the
# answer is honest and useless — "there is no code here" — and the demo shows
# the plumbing working around a question nobody could answer. These are two
# files each: enough for a search to find the flat 422 shape and name the file.
cp -R "$HERE/fixtures/web/." "$BASE/web/" 2>/dev/null || true
cp -R "$HERE/fixtures/api/." "$BASE/api/" 2>/dev/null || true
for d in "$BASE/web" "$BASE/api"; do
  [ -d "$d/.git" ] || (cd "$d" && git init -q && git add -A && \
    git -c user.name=demo -c user.email=demo@example.com commit -qm "initial" >/dev/null 2>&1) || true
done

if [ ! -S "$SOCK" ]; then
  # Detached, with a pty and a TERM: herdr will not start without either.
  # env -u, not just the wrapper's unset: this launches herdr directly, and a
  # herdr that can see HERDR_SOCKET_PATH refuses to start as "nested".
  nohup env -u HERDR_SOCKET_PATH -u HERDR_ENV -u HERDR_PANE_ID -u HERDR_TAB_ID \
    -u HERDR_WORKSPACE_ID -u HERDR_BIN_PATH \
    script -q /dev/null bash -lc "TERM=xterm-256color herdr --session $SESSION" \
    >"$HERE/.state/session.log" 2>&1 &
  echo $! > "$HERE/.state/session.pid"
  for _ in $(seq 40); do [ -S "$SOCK" ] && break; sleep 0.5; done
fi
[ -S "$SOCK" ] || { echo "session did not start"; tail -5 "$HERE/.state/session.log"; exit 1; }

pane_id() { python3 -c "import json,sys; print(json.load(sys.stdin)['result']['pane']['pane_id'])"; }
ws_root() { python3 -c "import json,sys; print(json.load(sys.stdin)['result']['root_pane']['pane_id'])"; }

# The two sessions get panes of their own rather than reusing the attaching
# one, which inherits this script's directory — the server's own, which
# listTargets deliberately drops, and which would put a home path on screen.
# --env is the only way they learn which mailbox to use: a pane's shell starts
# clean, so without it both would talk to the real mailbox on 7777.
self="$("$H" pane current --current | pane_id)"
left="$("$H" pane split "$self" --direction right --cwd "$BASE/web" --env AGX_PORT=7788 --env CLAUDE_CODE_CHILD_SESSION= --env "PATH=$HERE/bin:$PATH" --no-focus | pane_id)"
right="$("$H" pane split "$left" --direction right --cwd "$BASE/api" --env AGX_PORT=7788 --env CLAUDE_CODE_CHILD_SESSION= --env "PATH=$HERE/bin:$PATH" --no-focus | pane_id)"
"$H" pane close "$self" >/dev/null 2>&1 || true

# `agx serve` puts the chat view in a space of its own. Here it is a pane under
# the two sessions instead: a recording cannot switch spaces, and the whole
# point of this view is watching a thread appear while the agents talk.
chat="$("$H" pane split "$left" --direction down --cwd "$ROOT" --env AGX_PORT=7788 --env CLAUDE_CODE_CHILD_SESSION= --env "PATH=$HERE/bin:$PATH" --no-focus | pane_id)"
"$H" pane send-text "$chat" "clear; node_modules/.bin/tsx mail-tui.tsx" >/dev/null
"$H" pane send-keys "$chat" enter >/dev/null

"$H" agent start web --kind claude --pane "$left" >/dev/null 2>&1 || true
# --no-daemon because codex's shared background server refuses a second
# client: "Cannot use the shared background server: Experimental feature
# request failed", and it says so only in the pane, after herdr has already
# reported the agent as started.
"$H" agent start api --kind codex --pane "$right" -- --no-daemon >/dev/null 2>&1 || true

# Both agents stop at a trust prompt in a directory they have not seen, and the
# two phrase it differently: claude defaults to "No, exit" so the choice has to
# be moved first, codex already has "Yes, continue" selected. Answered in a loop
# rather than after a fixed sleep, because how long each takes to draw it
# depends on the machine.
answer_trust() {
  local pane="$1" i text
  for i in $(seq 15); do
    text="$("$H" pane read "$pane" --lines 30 2>/dev/null || true)"
    case "$text" in
      *"No, exit"*)        "$H" pane send-keys "$pane" down >/dev/null 2>&1; sleep 0.3
                           "$H" pane send-keys "$pane" enter >/dev/null 2>&1 ;;
      *"1. Yes, continue"*) "$H" pane send-keys "$pane" enter >/dev/null 2>&1 ;;
      # codex also reviews session hooks on first run in a directory, and sits
      # on that screen rather than reading its prompt — mail lands and nothing
      # looks at it.
      *"trust all"*)       "$H" pane send-keys "$pane" t >/dev/null 2>&1 ;;
      *"esc close"*)       "$H" pane send-keys "$pane" escape >/dev/null 2>&1 ;;
      *) : ;;
    esac
    sleep 2
    state="$("$H" agent list 2>/dev/null | python3 -c "
import json,sys
a={x['pane_id']: x.get('agent_status') for x in json.load(sys.stdin)['result']['agents']}
print(a.get('$pane','gone'))
" 2>/dev/null || echo gone)"
    [ "$state" = "idle" ] && return 0
  done
  return 1
}

answer_trust "$left"  || echo "web did not come up"
answer_trust "$right" || echo "api did not come up"

# Codex reviews its session hooks AFTER the trust prompt, on a second screen
# that it sits on indefinitely — the agent reports idle, mail is delivered, and
# nothing reads it because the prompt is behind a dialog. It takes two keys:
# `t` to trust the hooks, then escape to close the panel it leaves open.
dismiss_dialogs() {
  local pane="$1" i text
  for i in $(seq 10); do
    text="$("$H" pane read "$pane" --lines 30 2>/dev/null || true)"
    case "$text" in
      *"trust all"*) "$H" pane send-keys "$pane" t >/dev/null 2>&1 ;;
      *"esc close"*) "$H" pane send-keys "$pane" escape >/dev/null 2>&1 ;;
      *) return 0 ;;
    esac
    sleep 2
  done
}
dismiss_dialogs "$right"
dismiss_dialogs "$left"

# herdr reports what is actually running, so this catches a kind that did not
# take rather than recording a demo whose "Codex" pane is a second Claude.
"$H" agent list 2>/dev/null | python3 -c "
import json,sys
want={'$left':'claude','$right':'codex'}
got={a['pane_id']: a.get('agent') for a in json.load(sys.stdin)['result']['agents']}
bad=[f\"{p}: wanted {k}, got {got.get(p)}\" for p,k in want.items() if got.get(p)!=k]
print('\n'.join(bad) if bad else 'both agents up: claude + codex')
"
# herdr reports an agent as started the moment the command is launched, so a
# CLI that exits with an error still counts. The pane is the only witness.
for pane in "$left" "$right"; do
  case "$("$H" pane read "$pane" --lines 20 2>/dev/null || true)" in
    *"Error:"*|*"error:"*) echo "WARNING: $pane shows an error — do not record this take" ;;
  esac
done

"$H" pane focus "$left" >/dev/null 2>&1 || true
echo "chat=$chat web=$left api=$right"
