#!/usr/bin/env bash
# AGxChat installer / updater.
#
#   curl -fsSL https://raw.githubusercontent.com/viswassaripalli/agxchat/main/install.sh | bash
#
# Idempotent: run it again to update. Clones to ~/.agxchat, installs deps, and
# puts `agx` on your PATH. Never touches your repos — `agx bootstrap` does that,
# and only when you ask.
set -euo pipefail

REPO="${AGX_REPO:-https://github.com/viswassaripalli/agxchat.git}"
DIR="${AGX_HOME:-$HOME/.agxchat}"
BRANCH="${AGX_BRANCH:-main}"

say() { printf '\033[36m›\033[0m %s\n' "$1"; }
die() { printf '\033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

command -v git >/dev/null || die "git is required"
command -v node >/dev/null || die "node is required (18+)"
command -v npm  >/dev/null || die "npm is required"
command -v herdr >/dev/null || printf '\033[33m!\033[0m herdr not found on PATH — AGxChat needs it to reach panes\n'

if [ -d "$DIR/.git" ]; then
  say "updating $DIR"
  git -C "$DIR" fetch --quiet origin "$BRANCH"
  git -C "$DIR" checkout --quiet "$BRANCH"
  git -C "$DIR" pull --quiet --ff-only origin "$BRANCH"
else
  say "cloning into $DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi

say "installing dependencies"
(cd "$DIR" && npm install --silent --no-audit --no-fund)

# PATH: prefer a dir already on PATH and writable, else fall back to ~/.local/bin
TARGET=""
for candidate in /usr/local/bin "$HOME/.local/bin" "$HOME/bin"; do
  if [ -d "$candidate" ] && [ -w "$candidate" ]; then TARGET="$candidate"; break; fi
done
if [ -z "$TARGET" ]; then
  TARGET="$HOME/.local/bin"
  mkdir -p "$TARGET"
fi
ln -sfn "$DIR/agx" "$TARGET/agx"
say "linked $TARGET/agx"
case ":$PATH:" in
  *":$TARGET:"*) ;;
  *) printf '\033[33m!\033[0m add it to PATH:  echo '"'"'export PATH="%s:$PATH"'"'"' >> ~/.zshrc\n' "$TARGET" ;;
esac

# Fill the seed in from the panes herdr can already see, rather than leaving
# placeholder paths for someone to hand-edit.
if [ ! -f "$DIR/agents.json" ]; then
  if command -v herdr >/dev/null 2>&1 && python3 "$DIR/seed.py" detect "$DIR/agents.json" >/dev/null 2>&1; then
    say "detected your sessions into $DIR/agents.json"
  else
    cp "$DIR/agents.example.json" "$DIR/agents.json"
    say "wrote $DIR/agents.json — run 'agx seed detect' or edit it by hand"
  fi
fi

# Teach the sessions. This edits the user's CLAUDE.md, which is why it is
# announced, backed up, and removable with one command — but leaving it out
# means installing something no session will ever reach for. AGX_NO_RULE=1
# skips it.
if [ "${AGX_NO_RULE:-0}" != "1" ]; then
  python3 "$DIR/rule.py" install-all "$DIR/claude-rule.md" \
    | sed 's/^/  /' || say "could not write the rule — run: agx rule install"
fi

# Start it and open the chat space. An install you cannot see is an install you
# have to be told how to finish; AGX_NO_START=1 skips this for scripted setups.
if [ "${AGX_NO_START:-0}" != "1" ] && command -v herdr >/dev/null 2>&1; then
  EXISTING=$(herdr workspace list 2>/dev/null | python3 -c "
import json,sys
try: ws = json.load(sys.stdin)['result']['workspaces']
except Exception: ws = []
print(next((w['workspace_id'] for w in ws if (w.get('label') or '').lower() == 'agxchat'), ''))
" 2>/dev/null || true)
  if [ -n "$EXISTING" ]; then
    say "AGxChat workspace already open ($EXISTING)"
  else
    "$DIR/agx" serve >/dev/null 2>&1 || say "could not start the server — run: agx serve"
    if "$DIR/agx" chat --space >/dev/null 2>&1; then
      say "opened the AGxChat workspace"
    else
      say "could not open the chat workspace — run: agx chat --space"
    fi
  fi
fi

VERSION="$(git -C "$DIR" rev-parse --short HEAD)"
SEED_COUNT=$(python3 -c "
import json
try: print(len(json.load(open('$DIR/agents.json'))['agents']))
except Exception: print('?')
" 2>/dev/null || echo '?')
cat <<EOF

AGxChat is ready ($VERSION, at $DIR)

  · server running on http://127.0.0.1:7777
  · chat open in the AGxChat workspace
  · $SEED_COUNT sessions addressable:
$("$DIR/agx" agents 2>/dev/null | sed 's/^/      /' || echo '      (start the server and run: agx agents)')
  · your sessions told how to use it — restart one, then just say:

      ask <name> whether the build is green

  agx seed             who is addressable        agx update      pull changes
  agx whoami           your own mailbox          agx rule show   what sessions were told
  agx inbox            what came back            agx uninstall --yes   remove it all
EOF
