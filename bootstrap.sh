#!/usr/bin/env bash
# AGxChat bootstrap.
#
#   ./bootstrap.sh              dry run — prints every change it would make
#   ./bootstrap.sh --write      writes .mcp.json entries and starts the server
#   ./bootstrap.sh --write --tui   also opens the TUI in a new herdr pane
#
# Writing touches .mcp.json inside your real repos, which may be git-tracked.
# Every file it modifies is backed up to .mcp.json.bak-<timestamp> first.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${AGX_PORT:-${HERDR_MAIL_PORT:-7777}}"
SEED="$HERE/agents.json"
WRITE=0
TUI=0
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    --tui) TUI=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done
[ "$WRITE" -eq 1 ] || echo "── DRY RUN (pass --write to apply) ──"

command -v herdr >/dev/null || { echo "herdr not on PATH" >&2; exit 1; }
echo "herdr: $(herdr --version)"

# 1. .mcp.json per repo. HTTP transport, identity in a header, merged into any
#    existing config rather than replacing it.
WRITE=$WRITE PORT=$PORT node - "$SEED" <<'NODE'
const { readFileSync, writeFileSync, copyFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const seed = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const write = process.env.WRITE === '1';
const url = `http://localhost:${process.env.PORT}/mcp`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

for (const a of seed.agents ?? []) {
  if (!a.cwd || !existsSync(a.cwd)) { console.log(`  skip  ${a.name}: cwd missing (${a.cwd})`); continue; }
  const path = join(a.cwd, '.mcp.json');
  const existing = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const servers = existing.mcpServers ?? (existing.mcpServers = {});
  const desired = { type: 'http', url, headers: { 'X-Herdr-Agent': a.name } };
  if (JSON.stringify(servers.mail) === JSON.stringify(desired)) { console.log(`  ok    ${a.name}: ${path} already correct`); continue; }
  servers.mail = desired;
  if (!write) { console.log(`  WOULD ${a.name}: add mail server to ${path} (X-Herdr-Agent: ${a.name})`); continue; }
  if (existsSync(path)) copyFileSync(path, `${path}.bak-${stamp}`);
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n');
  console.log(`  wrote ${a.name}: ${path}`);
}
NODE

# 2. Server. One process, or every session gets its own empty mailbox.
if curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "server: already up on $PORT"
elif [ "$WRITE" -eq 1 ]; then
  mkdir -p "$HERE/.run"
  (cd "$HERE" && nohup npx tsx mail-server.ts > "$HERE/.run/server.log" 2>&1 & echo $! > "$HERE/.run/server.pid")
  for _ in $(seq 20); do
    curl -sf --max-time 1 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 \
    && echo "server: started (pid $(cat "$HERE/.run/server.pid"), log $HERE/.run/server.log)" \
    || { echo "server: FAILED to start — see $HERE/.run/server.log" >&2; tail -20 "$HERE/.run/server.log" >&2; exit 1; }
else
  echo "server: would start (npx tsx mail-server.ts)"
fi

# 3. TUI in its own workspace — the chat view is ambient, it should not eat a
#    split in whichever repo you happen to be working in.
if [ "$TUI" -eq 1 ]; then
  if [ "$WRITE" -eq 1 ]; then
    PANE=$(herdr workspace create --cwd "$HERE" --label "agxchat" --no-focus \
      | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d).result??{};console.log(r.workspace?.active_pane_id??r.pane?.pane_id??r.pane_id??"")})')
    if [ -z "$PANE" ]; then
      # Fall back to a split if workspace create did not hand back a pane id.
      PANE=$(herdr pane split --direction down --ratio 0.35 --cwd "$HERE" --no-focus \
        | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d).result??{};console.log(r.pane?.pane_id??r.pane_id??"")})')
      [ -n "$PANE" ] && herdr pane move "$PANE" --new-workspace --label "agxchat" --tab-label "chat" --no-focus >/dev/null
      PANE=$(herdr pane list | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const ps=(JSON.parse(d).result?.panes)??[];const hit=ps.find(p=>String(p.cwd||"").endsWith("agxchat"));console.log(hit?.pane_id??"")})')
    fi
    if [ -n "$PANE" ]; then
      herdr pane rename "$PANE" "chat" >/dev/null 2>&1 || true
      herdr pane run "$PANE" "npx tsx mail-tui.tsx"
      echo "tui: workspace 'agxchat', pane $PANE"
    else
      echo "tui: could not resolve a pane id — start it by hand: npx tsx mail-tui.tsx" >&2
    fi
  else
    echo "tui: would create a 'agxchat' workspace and run npx tsx mail-tui.tsx there"
  fi
fi

cat <<EOF

next:
  1. Each seeded session must reload MCP config to see the mail tools —
     in that pane: /mcp  (or restart claude there).
  2. Verify:   curl -s localhost:$PORT/agents | head
  3. From any session: "call mail_agents", then
     "mail_send to design asking whether a StatusPill component exists"
EOF
