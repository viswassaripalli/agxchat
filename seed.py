#!/usr/bin/env python3
"""Generate agents.json from the panes herdr can already see.

Hand-editing absolute paths is a step that can only be got wrong, and every
value in it is discoverable: `herdr agent list` reports each agent's cwd, and
the git root's name is a better identity than the leaf directory.

Usage: seed.py detect [<agents.json>] [--print]
"""
import json
import subprocess
import sys
from pathlib import Path

# Words that say nothing about which session you mean.
GENERIC = {"ui", "src", "app", "web", "api", "client", "server", "frontend", "backend", "packages"}


def git_root(cwd: str) -> Path:
    path = Path(cwd)
    for candidate in [path, *path.parents]:
        if (candidate / ".git").exists():
            return candidate
    return path


def topics_for(name: str, leaf: str) -> list:
    """Name plus its parts, so "hevo-ui-toolkit" also answers to "toolkit"."""
    out = [name]
    for token in name.replace("_", "-").split("-"):
        if len(token) > 2 and token not in out:
            out.append(token)
    if leaf != name and leaf not in out and leaf in GENERIC is False:
        out.append(leaf)
    return out


def detect() -> list:
    raw = subprocess.run(["herdr", "agent", "list"], capture_output=True, text=True, check=True).stdout
    agents = (json.loads(raw).get("result") or {}).get("agents") or []

    roots: dict = {}
    for a in agents:
        cwd = a.get("cwd")
        if not cwd:
            continue
        # Two panes on one repo are one seed entry: the seed names repos, and
        # per-pane identities are derived from it at runtime.
        roots.setdefault(str(git_root(cwd)), Path(cwd).name)

    # Two worktrees of one repo share a git-root name ("…-2/ui" and
    # "…-dummy/ui" are both "ui"), which would silently drop one. Where that
    # happens the parent directory is the name a person actually uses.
    names: dict = {}
    for root in roots:
        names.setdefault(Path(root).name, []).append(root)

    out = []
    for root, leaf in roots.items():
        path = Path(root)
        name = path.name if len(names[path.name]) == 1 else f"{path.parent.name}"
        out.append({"name": name, "cwd": root, "topics": topics_for(name, leaf)})
    return out


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "detect"]
    show_only = "--print" in args
    args = [a for a in args if a != "--print"]
    target = Path(args[0]) if args else Path(__file__).with_name("agents.json")

    try:
        found = detect()
    except FileNotFoundError:
        print("herdr not found on PATH", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as err:
        print(f"herdr agent list failed: {err}", file=sys.stderr)
        return 1

    if not found:
        print("no agents found — start a session in a repo first", file=sys.stderr)
        return 1

    payload = json.dumps({"agents": found}, indent=2) + "\n"
    if show_only:
        print(payload, end="")
        return 0

    if target.exists():
        target.replace(target.with_name(target.name + ".bak"))
    target.write_text(payload)
    print(f"wrote {target} with {len(found)} agent{'' if len(found) == 1 else 's'}:")
    for a in found:
        print(f"  {a['name']:16} {a['cwd']}")
    print("edit it to rename anything, then: agx serve")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
