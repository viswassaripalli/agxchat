#!/usr/bin/env python3
"""Install / remove the AGxChat block in a CLAUDE.md.

A separate file rather than a heredoc inside `agx`: the block contains regex,
newlines and quotes, and shell-embedded Python mangled every one of them.

Usage: rule.py install|remove <claude-md> [<rule-source>]
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


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    action, target = sys.argv[1], Path(sys.argv[2])
    if action == "install":
        source = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).with_name("claude-rule.md")
        print(install(target, source))
    elif action == "remove":
        print(remove(target))
    else:
        print("usage: rule.py install|remove <claude-md> [<rule-source>]", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
