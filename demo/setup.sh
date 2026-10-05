#!/usr/bin/env bash
# Build the demo layout from inside the demo session.
#
# Run from the first pane after `herdr --session agxdemo` has attached: the
# session's own socket is in this pane's environment, so plain `herdr` here
# means this session and not the one you work in.
#
# Two panes down the right-hand side, each running agent.sh in its own
# directory and renamed to the mailbox it answers to. The rename is what makes
# them addressable: herdr does not recognise these as agents it ships support
# for, and such panes answer to their label, never to a name derived from their
# directory.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${AGX_DEMO_DIR:-/tmp/agxdemo}"

for n in web api tests; do mkdir -p "$BASE/$n"; done

pane_id() { python3 -c "import json,sys; print(json.load(sys.stdin)['result']['pane']['pane_id'])"; }

launch() {
  local pane="$1" name="$2"
  herdr pane rename "$pane" "$name" >/dev/null
  herdr pane send-text "$pane" "clear; bash $HERE/agent.sh $name" >/dev/null
  herdr pane send-keys "$pane" enter >/dev/null
}

self="$(herdr pane current --current | pane_id)"
right="$(herdr pane split "$self" --direction right --cwd "$BASE/tests" --no-focus | pane_id)"
lower="$(herdr pane split "$right" --direction down --cwd "$BASE/api" --no-focus | pane_id)"

launch "$right" tests
launch "$lower" api

# This script cannot change the environment of the shell that ran it, and the
# pane's shell starts clean — herdr does not pass the attaching terminal's
# environment down. So the settings are typed back into this pane instead:
# the demo port (without it agx talks to the real mailbox on 7777), an identity
# (this pane is a plain shell, which the server will not accept as a sender),
# and a prompt that does not put whoever recorded it on screen.
herdr pane rename "$self" web >/dev/null
sleep 1
# This pane is a shell, and delivery types mail into whatever is there. A
# shell would try to run the banner as a command, so it is taught to say what
# actually happened instead. An agent pane needs none of this: it reads the
# line, which is the whole point.
herdr pane send-text "$self" "unsetopt nomatch 2>/dev/null; command_not_found_handler() { case \"\$1\" in *agxchat*) printf '  \033[32mmail arrived\033[0m - read it with: agx inbox web\n' ;; *) printf '%s: not found\n' \"\$1\" ;; esac; return 0; }; export AGX_PORT=7788 AGX_ME=web PS1='$ '; clear; printf '  \033[1mweb\033[0m - ask the others something\n\n'" >/dev/null
herdr pane send-keys "$self" enter >/dev/null
