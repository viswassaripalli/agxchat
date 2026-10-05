#!/usr/bin/env bash
# The store is append-only: every change to a mail writes the whole record
# again, and replay keeps the last one. Past COMPACT_AT lines it is rewritten
# as one line per mail. That has never run on anybody's machine — the default
# threshold is 5000 lines and a busy mailbox took months to get there — so it
# runs here, on a threshold low enough to reach in a few seconds.
#
# Nothing here touches the real mailbox: its own port, store, token and a herdr
# that answers from a file.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
PORT=7799
trap 'kill "${PID:-0}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

printf '❯ \n' > "$TMP/screen.txt"

cd "$ROOT"
HERDR_BIN="$HERE/stub-herdr" AGX_TEST_SCREEN="$TMP/screen.txt" \
  AGX_PORT="$PORT" AGX_STORE="$TMP/mail.jsonl" AGX_TOKEN_FILE="$TMP/token" \
  AGX_SEED="$TMP/seed.json" AGX_NO_AUTH=1 AGX_NO_CHAT=1 AGX_COMPACT_AT=40 \
  node_modules/.bin/tsx mail-server.ts >"$TMP/server.log" 2>&1 &
PID=$!

for _ in $(seq 40); do
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null || { cat "$TMP/server.log"; exit 1; }

echo "compaction"

# notify:false keeps this off the TTY path entirely — the point here is the
# store, not delivery.
BOX=""
for i in $(seq 30); do
  out="$(curl -sf -X POST "http://127.0.0.1:$PORT/mail" -H 'Content-Type: application/json' \
    -d "{\"from\":\"t1:p1\",\"to\":\"t1:p1\",\"subject\":\"m$i\",\"body\":\"body $i\",\"notify\":false}")" \
    || { echo "FAIL  send $i rejected"; exit 1; }
  # The mailbox is whatever the pane id resolved to — here the workspace label,
  # because that is the pass that matches a pane with no registered name.
  [ -n "$BOX" ] || BOX="$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["to"])')"
done

lines="$(wc -l < "$TMP/mail.jsonl" | tr -d ' ')"
mail_count="$(curl -sf "http://127.0.0.1:$PORT/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["mail"])')"

# Compaction has to leave the mailbox alone while shrinking the file. One line
# per mail is the floor; anything above COMPACT_AT means it never fired.
fail=0
[ "$mail_count" -eq 30 ] || { echo "FAIL  30 mail sent, server reports $mail_count"; fail=1; }
[ "$lines" -le 40 ] || { echo "FAIL  store still $lines lines, threshold was 40"; fail=1; }

# And the content has to survive the rewrite, not just the count.
body="$(curl -sf "http://127.0.0.1:$PORT/mail?to=$BOX" | python3 -c '
import json,sys
m=[x for x in json.load(sys.stdin)["mail"] if x["subject"]=="m1"]
print(m[0]["body"] if m else "MISSING")')"
[ "$body" = "body 1" ] || { echo "FAIL  first mail reads \"$body\" after compaction"; fail=1; }

if [ "$fail" -eq 0 ]; then
  echo "  ok  30 mail survive, store compacted to $lines lines"
  echo "  ok  the oldest mail still reads correctly"
  echo
  echo "all passed"
else
  echo; echo "compaction failed"; exit 1
fi
