#!/usr/bin/env python3
"""Install / remove the AGxChat block in an agent's instruction file.

A separate file rather than a heredoc inside `agx`: the block contains regex,
newlines and quotes, and shell-embedded Python mangled every one of them.

Every agent reads a different file, and none of them reads another's. Claude
Code reads ~/.claude/CLAUDE.md; Codex reads ~/.codex/AGENTS.md; several others
read a plain AGENTS.md. A rule installed in one of them teaches exactly one
agent, which is why `targets` exists.

Usage:
  rule.py install|remove <file> [<rule-source>]
  rule.py install-all|remove-all [<rule-source>]   every detected agent
  rule.py targets                                  what would be written
"""
import re
import shutil
import sys
import time
from pathlib import Path

BEGIN = "<!-- agxchat:begin -->"
END = "<!-- agxchat:end -->"
PATTERN = re.compile(re.escape(BEGIN) + ".*?" + re.escape(END), re.S)


def install(target: Path, source: Path) -> str:
    body = source.read_text().rstrip()
    block = BEGIN + "\n" + body + "\n" + END
    text = target.read_text() if target.exists() else ""

    if PATTERN.search(text):
        target.write_text(PATTERN.sub(lambda _: block, text, count=1))
        return "updated the existing AGxChat block in " + str(target)

    if target.exists() and text.strip():
        # Keep a copy: this file is the user's own standing instructions.
        shutil.copy2(target, f"{target}.bak-{time.strftime('%Y%m%d-%H%M%S')}")
    joiner = "" if text.endswith("\n\n") or not text.strip() else ("\n" if text.endswith("\n") else "\n\n")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text + joiner + block + "\n")
    return "added the AGxChat block to " + str(target)


def remove(target: Path) -> str:
    if not target.exists():
        return "no such file: " + str(target)
    text = target.read_text()
    if not PATTERN.search(text):
        return "no AGxChat block in " + str(target)
    cleaned = PATTERN.sub("", text)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).rstrip() + "\n"
    target.write_text(cleaned)
    return "removed the AGxChat block from " + str(target)


# Where each agent looks for standing instructions. Written only when the
# agent's own directory already exists: creating ~/.codex on a machine with no
# Codex would be litter, not configuration.
TARGETS = [
    ("claude", Path.home() / ".claude", Path.home() / ".claude" / "CLAUDE.md"),
    ("codex", Path.home() / ".codex", Path.home() / ".codex" / "AGENTS.md"),
    ("cursor", Path.home() / ".cursor", Path.home() / ".cursor" / "AGENTS.md"),
    ("opencode", Path.home() / ".config" / "opencode", Path.home() / ".config" / "opencode" / "AGENTS.md"),
]


def detected() -> list:
    """Agents whose config directory exists on this machine."""
    return [(name, target) for name, home, target in TARGETS if home.is_dir()]


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    action = sys.argv[1]

    if action == "targets":
        found = detected()
        if not found:
            print("no agent config directories found")
            return 0
        for name, target in found:
            state = "installed" if target.exists() and BEGIN in target.read_text() else "not installed"
            print(f"{name:10} {target}  ({state})")
        return 0

    if action in ("install-all", "remove-all"):
        found = detected()
        if not found:
            print("no agent config directories found (looked for ~/.claude, ~/.codex, ~/.cursor, ~/.config/opencode)",
                  file=sys.stderr)
            return 1
        source = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name("claude-rule.md")
        for _, target in found:
            print(install(target, source) if action == "install-all" else remove(target))
        return 0

    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    target = Path(sys.argv[2])
    if action == "install":
        source = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).with_name("claude-rule.md")
        print(install(target, source))
    elif action == "remove":
        print(remove(target))
    else:
        print("usage: rule.py install|remove <file> | install-all|remove-all | targets", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
