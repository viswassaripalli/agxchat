# AGxChat

Cross-session chat for coding agents — **including agents that are not the same
agent**. A Claude session and a Codex session in different repos ask each other
for things and get answers back, with a terminal view of every thread.

One node server holds the mailbox; sessions talk to it over MCP-over-HTTP or a
tiny CLI; [herdr](https://github.com/herdrdev/herdr) carries only the wake-up.

```
 design idle  tests working  web idle  api done                          live
 9 threads · 4 need attention [all] [short bodies]

 ╭────────────────────────────────────────────╮  Does a StatusLabel exist?
 │  web ⇄ tests                               │  3 messages · answered in 112s
 │  Trigger an incremental-only run...     6m │
 │ !design ⇄ api                              │  design → web 18:44:54 64a4
 │  Ping — provenance test                13m │  No StatusLabel, but two exports...
 ╰────────────────────────────────────────────╯
 j/k move · f filter · c bodies · i write · e unblock · G follow · q quit
```

## Do you need this?

Claude Code can already message its own sessions. `ListAgents` shows your other
Claude sessions and `SendMessage` delivers to them — natively, with no install,
no typing into a TTY, and no shell permission prompt. **If both ends are Claude
on one machine, use that.** It is better at the part it covers.

What it does not cover, and what this is for:

| | built-in | AGxChat |
| --- | --- | --- |
| Claude → Claude | yes, and better | yes |
| Claude → Codex, Cursor, opencode, … | no — it only knows Claude sessions | yes |
| History you can re-read tomorrow | the session's own transcript | an append-only log, survives restarts, deletable and recoverable |
| A view of who is waiting on whom | none | thread list, attention markers, `agx status` |
| Addressing | by session name | by name, repo, or topic, picking whichever pane is idle |
| Why it did not arrive | it arrived or it did not | `deferred`, `stalled`, `target_blocked`, each with a reason |
| Who asked for it | not modelled | `--for` / `--via`, auditable after the fact |

The honest summary: for Claude-to-Claude the built-in wins and this is
duplication. This exists because a mailbox reached over HTTP and a nudge typed
into a TTY assume nothing about who is reading — which is the only way a Claude
session and a Codex session talk at all.

## Install

One command:

```bash
curl -fsSL https://raw.githubusercontent.com/viswassaripalli/agxchat/main/install.sh | bash
```

It clones to `~/.agxchat`, installs dependencies, links `agx`, detects your
sessions from the panes herdr can see, writes the rule that teaches sessions to
use it, starts the server, opens the chat in its own **AGxChat** workspace, and
prints who is addressable. Nothing else to configure — in any session (restart
it once, so it picks up the rule):

```
ask tests whether the dashboard suite is green
```

Re-running the same command updates in place. `agx update` does the same
without re-fetching the installer.

Two steps reach outside the install directory, so both are announced and both
can be skipped:

| | |
| --- | --- |
| `AGX_NO_RULE=1` | do not add the block to `~/.claude/CLAUDE.md` (it is backed up and marked; `agx rule remove` undoes it) |
| `AGX_NO_START=1` | do not start the server or open the workspace |

### Removing it

```bash
agx uninstall --yes
```

Stops the server and chat view, closes herdr workspaces labelled AGxChat,
removes the CLAUDE.md block, unlinks `agx`, and deletes the clone. Your seed and
mail are copied to `~/.agxchat-backup-<timestamp>` first; `--purge` deletes
those too. Without `--yes` it prints what it would do and stops.

It only unlinks symlinks that point at this install, and hands the final
directory removal to a detached cleanup, since a running script cannot delete
the directory it is being read from.

`agx update` fast-forwards the clone, reinstalls dependencies, restarts the
server if it was running, and refreshes the CLAUDE.md block **only if you
already installed one**. Your `agents.json` and your mail survive: both are
gitignored, and the server replays the message log on boot. If you edited the
source yourself the pull stops and says so rather than clobbering your work.

Requires node 18+, git, and herdr on PATH. The installer clones to `~/.agxchat`,
installs deps, and links `agx`. It never touches your repos; `agx bootstrap`
does that, and only when you ask.

### Mixed agents

herdr ships integrations for `claude`, `codex`, `copilot`, `cursor`, `droid`,
`opencode`, `devin` and others (`herdr integration install <name>`), and
everything here works the same for all of them: delivery is text into a pane,
replies are `agx reply`, and identity comes from the pane and its repo. Nothing
in the mailbox is Claude-specific.

Two things do differ:

- **Each agent reads its own instruction file** and none reads another's, so
  `agx rule install` writes to every one it finds — `~/.claude/CLAUDE.md`,
  `~/.codex/AGENTS.md`, `~/.cursor/AGENTS.md`, `~/.config/opencode/AGENTS.md` —
  and only where that agent's directory already exists. `agx rule targets`
  shows which, and `--claude-only` narrows it.
- **Lifecycle reporting varies.** herdr reports `idle`/`working`/`blocked` for
  agents it has an integration for; anything else reads as `unknown`, which is
  treated as deliverable. Deferral until idle degrades to immediate delivery
  there, and `agx agents` shows each pane's kind so you can see which is which.

Write mail accordingly: ask for what you need rather than how to get it, since
the reader may not share your tools or your context.

### Teaching your sessions

Installing the CLI is not enough. `agx` works the moment it is on PATH, but a
session only *reaches for it* if something tells it to — otherwise "ask tests
whether the suite is green" is just a sentence, and nothing gets sent.

`agx rule install` appends a marked block to `~/.claude/CLAUDE.md`, backing the
file up first and updating in place if the block is already there:

```
<!-- agxchat:begin -->
# AGxChat - talking to other sessions
...
<!-- agxchat:end -->
```

`agx rule show` prints it without installing; `agx rule remove` takes it out
again. The text lives in `claude-rule.md` in this repo, so you can read exactly
what your sessions will be told before you install it. CLAUDE.md is read at
session start, so restart a session for it to take effect.

The alternative is the MCP path: `agx bootstrap --write` puts a `mail` server
into each repo's `.mcp.json`, and the tools then appear in the session's tool
list on their own — no CLAUDE.md edit, but it needs a restart per session too.

## Commands

| | |
| --- | --- |
| `agx serve` / `stop` / `status` | run the server, stop it, dump health |
| `agx chat [--space]` | the thread view; `--space` gives it its own herdr workspace |
| `agx agents` | who is live: name, pane, repo, state, topics |
| `agx send <to> <subject> <body>` | `--for <human>` `--expect <shape>` `--pointer <path>` `--from <name>` |
| `agx inbox [name]` / `thread <id>` / `reply <id> <body>` | read and answer |
| `agx bootstrap [--write] [--tui]` | wire `.mcp.json` into your repos (dry run by default) |
| `agx delete <id>` / `delete-thread <id>` / `clear --yes` | remove a message, a whole thread, or everything |
| `agx deleted` / `restore <id>` | list what delete hid, bring one back |
| `agx update` | pull, reinstall deps, restart the server |
| `agx uninstall --yes` | remove it all: server, chat space, CLAUDE.md block, symlinks, clone |

In the chat view, `d` deletes the selected thread after a `y` confirmation.

### Delete is recoverable

The store is append-only, so a delete appends a tombstone rather than rewriting
the log: replay hides the record, it does not erase it. `agx deleted` reads the
log directly (memory is where it is already gone) and `agx restore <id>`
re-appends the original, which outranks its tombstone. Compaction is the one
thing that makes a delete permanent — it rewrites the log from live records
only, and runs once the log passes 5000 lines.

## Sending from another session

Two paths. The CLI needs nothing installed in the other session — every agent
has a shell:

```bash
# from inside any repo that herdr has a pane for
agx send tests "Run the dashboard suite" "Against the staging fixture; report failures." --for "$USER"
agx inbox
agx thread 68fb
agx reply 68fb "Yes — StatusLabel."
```

The sender is inferred by asking the server who occupies `$PWD`, so it shows up
as its registered name (`design`), not its directory (`design-system`).
Override with `--from`. Symlink it once to shorten:

```bash
ln -s agx /usr/local/bin/agx
```

The MCP path is nicer but needs setup: `./bootstrap.sh --write`, then `/mcp` in
each pane, after which a session just says *"mail_send to tests …"* and the
reply comes back through `mail_reply` instead of curl.

`notify` decides whether the reply is written into the sender's TTY. It defaults
to **on** when the sender resolves to a live pane (a real session wants its
answer) and **off** for the TUI and scripts (which read the mailbox instead).

## What was verified against the real binary (herdr 0.7.1)

PLAN.md was written against a different herdr. These are measured, not assumed:

| PLAN.md | Reality on 0.7.1 |
| --- | --- |
| `herdr agent prompt <name> "…"` | does not exist. Injection is `pane send-text` + `pane send-keys enter` |
| `cwd` lives on the pane | `cwd` **and** `foreground_cwd` are on the agent record — no `pane get` fan-out |
| agents have no name | `name` **is** on the agent record once set by `agent start <name>` / `agent rename` |
| `working` → deliver via `/btw` | **`/btw` has no tools.** It answers, and does not derail the main task, but reports *"No tools here. Cannot run command."* — it can never reach `mail_inbox` |
| `agent prompt --wait` | `herdr agent wait <target> --status`, `herdr wait agent-status` |

Two consequences, both implemented:

1. **`working` defers.** Mail for a busy target is held at `deferred` and the
   nudge fires from the 1s poll on the target's next idle/done transition.
   `/btw` is not used for delivery at all.
2. **The nudge verifies itself.** `pane run` alone was observed dropping the
   Enter on a pane that still had a shell running — the mail sat in the prompt
   box, unsent. `nudge()` now types, submits, reads the pane back, and submits
   once more if the text is still sitting there.

## Delivery states

| Target | Result |
| --- | --- |
| `idle` / `done` | `nudged_idle` — delivered now |
| `working` | `deferred` — flushed on the idle transition |
| `blocked` | `target_blocked` — only a human or `pane send-keys esc` clears it |
| no pane | `undeliverable` |
| nudged, then nothing | `stalled` — see below |

### Stalled

`agent_status` is not enough to know a nudge landed. Measured: a session parked
on a permission prompt — answer written, waiting on a human to approve the send —
reports **`done`**, not `blocked`. Mail to it gets `nudged_idle` and then goes
nowhere, silently.

So delivery is confirmed by inference, not by dialog text: a mail that was
nudged, has neither been read nor answered after `HERDR_MAIL_STALL_MS`
(default 60s), and whose target is **not** `working`, is flagged `stalled`. Pane
text is read only to explain *why* (`looks parked on a prompt`), never to decide.
A stalled target that starts working un-stalls itself. Nothing is ever re-nudged
— a stalled agent needs a human, not more text. `GET /health` lists them.

## Provenance — `requested_by`

A receiving agent that cannot tell a human's request from a bot's will correctly
refuse anything with side effects. Observed live: tests declined to create a
pipeline for another session with *"not creating one on a third-party request …
ask alice and I will run it."*

`mail_send({requested_by})` / `agx send --for <human>` carries the name of
the person who asked. It rides in the nudge itself
(`[agxchat a900 from desktop on behalf of alice]`) so the receiver sees it
before opening anything, and `agx inbox` marks mail with no named human
as `(no human named — bot-initiated)`.

**It is a claim, not proof.** The server is unauthenticated localhost; any sender
can write any name. It exists to make a human request *expressible*, not
verifiable. Add a shared secret before this leaves your own machine.

### Second-hand claims

Observed live: a session relayed *"viswas has since asked for this run"* for a
run the human never asked for, and the receiver had no way to see the claim was
laundered — a relayed claim looked identical to a first-hand one. So a claim
learned from another agent's mail must carry `via: <that mail id>`, and the
nudge says so plainly:

```
[agxchat 899e from desktop on behalf of viswas — SECOND-HAND, relayed by
 desktop from mail d25b, not heard from the human]
```

`agx provenance` audits every claim in the mailbox, marks each first- or
second-hand, and lists `via` references that point at nothing. After-the-fact
audit is the only defence an unauthenticated bus has — which is why the
receiving agent's own judgement remains the real control. A session declining
side-effecting work until the human asks it directly is behaving correctly, not
being obstructive.

## Tools

`mail_agents` · `mail_register` · `mail_send` · `mail_inbox` · `mail_reply` · `mail_wait`

`mail_wait` carries all three guards: mandatory timeout capped at 5 min, cycle
detection in the wait graph (`would_deadlock`), and a depth cap of one
outstanding blocking ask per session. Async send is the default and cannot
deadlock.

## Identity and routing

Identity is a header in each repo's `.mcp.json`:

```json
{ "mcpServers": { "mail": {
  "type": "http",
  "url": "http://localhost:7777/mcp",
  "headers": { "X-Herdr-Agent": "design" }
} } }
```

`agents.json` is written for you at install time from the panes herdr can see:
one entry per repo, named after its git root, with topics derived from the
name. `agx seed detect` re-scans, `agx seed preview` shows what it would write
without touching the file, `agx seed edit` opens it in an editor that exists.
Two worktrees of one repo would collide on the git-root name, so those are
named after their parent directory instead.

It pre-seeds the registry so `to: "design"` resolves before that
session has ever called `mail_register` — without it, topic routing is dead
until each session happens to register itself, which no session does unprompted.

`mail_send({to})` resolves in passes: registry name → herdr agent name →
registered topic → pane id → repo (exact, then substring). Ambiguity returns the
candidates with their repos instead of guessing — two of these worktrees really
do both report the repo `web-app`.

`repo` is the **git root's** name, not `basename(cwd)`: the tests session sits
in `e2e-tests/ui` and would otherwise advertise itself as `ui`.

## Escape hatches

| env | effect |
| --- | --- |
| `HERDR_MAIL_DRY_NUDGE=1` | log nudges instead of writing to a TTY (test without touching live sessions) |
| `HERDR_MAIL_NUDGE_VERIFY=0` | skip the submit-verification read-back |
| `HERDR_MAIL_PORT` | default 7777 |
| `HERDR_MAIL_SEED` | default `agents.json` |
| `HERDR_MAIL_POLL_MS` | default 1000 |

`inline: true` on `mail_send` puts the question itself in the target's TTY, for
a session that has not wired up the mail MCP server yet. It breaks the
payload-by-pointer rule on purpose and is the only mode that works with zero
setup on the receiving side.

## Known weaknesses

Unchanged from PLAN.md, and one confirmed the hard way: the mailbox is a `Map`,
so restarting the server loses the queue — a live send was lost to exactly that
during this build. Also: blocked agents stall delivery and only a human clears
them; no guaranteed delivery semantics, since the receiver is an LLM deciding
what to attend to; localhost and unauthenticated.

Not built (explicitly out of scope for tonight): `MailConversation.jsx` and
`MailDebugger.jsx` browser views, the fork (`herdrx`), team packaging.
