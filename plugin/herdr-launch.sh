#!/usr/bin/env bash
# Every command herdr runs for the AGxChat plugin comes through here.
#
# herdr installs a plugin as a managed git checkout and REPLACES that checkout
# on reinstall, so nothing durable may live inside it. The server writes every
# durable path relative to `.run/` — token, mail.jsonl, spill/, spawned.json —
# so `.run` is pointed at herdr's own state directory instead of being a real
# directory in the checkout. Reinstalling then keeps the mailbox.
set -euo pipefail

ROOT="${HERDR_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
STATE="${HERDR_PLUGIN_STATE_DIR:-$ROOT/.run}"
mkdir -p "$STATE"

# Only relink when .run is absent or already ours. A real .run directory means
# this is somebody's existing ~/.agxchat install, and its mailbox is not ours
# to move.
if [ "$STATE" != "$ROOT/.run" ] && { [ ! -e "$ROOT/.run" ] || [ -L "$ROOT/.run" ]; }; then
  ln -sfn "$STATE" "$ROOT/.run"
fi

cd "$ROOT"

case "${1:-}" in
  serve)
    # The chat view is opened by the `chat` action / pane entrypoint, not by
    # the server start, so installing the plugin does not silently claim a
    # workspace on every herdr launch.
    AGX_NO_CHAT=1 exec ./agx serve
    ;;
  chat)
    # Run the TUI directly rather than via `agx chat`, which manages its own
    # workspace. This process must be the pane's foreground process: the
    # server's approval gate only trusts a request traced to a pane running
    # mail-tui.tsx.
    exec node_modules/.bin/tsx mail-tui.tsx
    ;;
  open-chat)
    exec "${HERDR_BIN_PATH:-herdr}" plugin pane open \
      --plugin "${HERDR_PLUGIN_ID:-agxchat.mail}" --entrypoint chat
    ;;
  *)
    exec ./agx "$@"
    ;;
esac
