#!/usr/bin/env bash
# A pane that behaves like an agent waiting for work.
#
# It draws a prompt, blocks on stdin, and answers mail. That is the whole
# surface delivery actually touches: text arrives in the prompt, Enter is
# pressed, something reads it. herdr does not classify this as an agent it
# knows — which is a supported case, those panes stay reachable by their label
# — so the recording exercises the real send-text/Enter/read-back path rather
# than herdr's native `agent prompt`.
#
#   agent.sh <mailbox-name>
set -uo pipefail

NAME="${1:?usage: agent.sh <name>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export AGX_PORT=7788

# What this session says when asked. Keyed by nothing clever: the demo asks one
# question per pane, and a scripted pane that invents answers is worse than one
# that admits it has a script.
reply_for() {
  case "$NAME" in
    tests) echo "None of them assert pill text. Two assert the colour class: status-badge.spec and pipeline-row.spec." ;;
    api)   echo "Yes — the settings page reads err.message directly. I can move it behind a helper this afternoon." ;;
    *)     echo "Acknowledged." ;;
  esac
}

printf '\033[2J\033[H'
printf '  \033[1m%s\033[0m — waiting for work\n\n' "$NAME"

while true; do
  printf '\033[36m❯\033[0m '
  IFS= read -r line || break
  [ -z "$line" ] && continue

  # The server's banner carries the id and nothing else; the body may have been
  # spilled to a file. Reading the id back out is all a recipient has to do.
  id="$(printf '%s' "$line" | sed -n 's/.*agxchat \([0-9a-f]\{4\}\).*/\1/p')"
  if [ -z "$id" ]; then
    printf '  (not mail — ignored)\n'
    continue
  fi

  printf '  \033[33mworking\033[0m — mail %s\n' "$id"
  sleep 1.2
  if "$ROOT/agx" --from "$NAME" reply "$id" "$(reply_for)" >/dev/null 2>&1; then
    printf '  \033[32mreplied\033[0m to %s\n\n' "$id"
  else
    printf '  reply failed\n\n'
  fi
done
