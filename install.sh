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

VERSION="$(git -C "$DIR" rev-parse --short HEAD)"
RULE_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/CLAUDE.md"
RULE_STATE="not installed"
grep -qF "<!-- agxchat:begin -->" "$RULE_FILE" 2>/dev/null && RULE_STATE="installed"

cat <<EOF

AGxChat installed at $DIR ($VERSION)

  1. check the seed:  agx seed            (agx seed detect re-scans, edit opens it)
  2. teach sessions:  agx rule install     (currently: $RULE_STATE)
  3. start it:        agx serve
  4. see who is live: agx agents
  5. open the chat:   agx chat        (or: agx chat --space)
  6. send something:  agx send <name> "<subject>" "<body>" --for "\$USER"

Step 2 is not optional if you want to say "ask <name> ..." in plain words:
the CLI works either way, but a session only reaches for it when its CLAUDE.md
says to. \`agx rule show\` prints the block first; \`agx rule remove\` undoes it.

Update later with:   agx update
EOF
