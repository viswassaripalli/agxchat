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

## How delivery works, and what was measured

Delivery has two paths, chosen by asking the installed herdr what it can do
rather than by trusting a version number:

**Native (herdr 0.9+).** `herdr agent prompt <pane> <text>` submits the text
itself. herdr owns the terminal, so it knows when the text was accepted, and
none of the code below runs. This is the path on a current herdr.

**Typed (herdr 0.7.x).** No such command exists there, so the text goes in as
`pane send-text` followed by `pane send-keys enter`. That Enter was observed
being dropped on a pane that still had a shell running — the mail sat in the
prompt box, unsent — so this path types, submits, reads the pane back, and
submits once more if the text is still sitting there. Forced with
`AGX_FORCE_TTY_NUDGE=1`.

The check is a feature probe of `agent --help`, and it matches two different
help formats: 0.7.x prints full signatures, 0.9 prints a Commands block of bare
names. Matching only one of them reported "not supported" on the version that
had the command, and kept typing keystrokes for no reason.

### Findings behind the design

Measured by running the binaries, not read from docs. Version-specific where
marked; PLAN.md had been written against 0.9 while 0.7.1 was what was
installed, which is where most of these disagreements came from:

| Assumption | What was actually true |
| --- | --- |
| `agent prompt` is always there | **0.9 yes, 0.7.1 no** — hence the feature probe and two paths |
| `cwd` lives on the pane | `cwd` **and** `foreground_cwd` are on the agent record — no `pane get` fan-out (0.7.1, still true on 0.9) |
| agents have no name | `name` **is** on the agent record once set by `agent start` / `agent rename` |
| deliver to a busy agent via `/btw` | **`/btw` has no tools.** It answers, and does not derail the main task, but reports *"No tools here. Cannot run command."* — so it can never reach `mail_inbox`. This is Claude Code behaviour and does not move with herdr versions |
| a pane reports `blocked` when it needs a human | a Claude pane on a permission prompt reports **`done`**; a Codex pane waiting at its own prompt reports **`blocked`** while perfectly reachable. Lifecycle is only trusted for agents herdr models |

The `/btw` finding is the load-bearing one: it is why mail for a busy target is
held at `deferred` and flushed by the 1s poll on the next idle transition,
rather than delivered as a side question.

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
nudged, has neither been read, engaged with, nor answered after `AGX_STALL_MS`
(default 60s), and whose target is **not** `working`, is flagged `stalled`.

The *reason* comes from `herdr agent explain --json`, which reports
`visible_blocker` and the id of the detection rule that matched
(`bash_permission_prompt`, `mcp_elicitation_prompt`, `live_prompt_box`, …).
herdr maintains that manifest per agent kind and refreshes it remotely, so it
already knows what a Claude permission prompt and a Codex approval dialog look
like, and keeps knowing when those UIs change. An earlier version guessed with
a local regex and reported an idle pane as parked on a prompt because the word
"allow" appeared in scrollback; that regex survives only as a fallback for
herdr versions without `explain`.
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

## Prior art

Local agent-to-agent messaging is well-trodden: several projects do it over
SQLite, over MCP tools, or over a Maildir-style file queue, and Claude Code now
messages its own sessions natively. Each of those asks only for a runtime.

This one takes a different trade: delivery is text typed into a terminal, which
is why it needs [herdr](https://github.com/herdrdev/herdr) and why agents must
already be running in panes. That buys three things the queue-shaped designs do
not have:

- **It reaches an agent that speaks no protocol at all.** No MCP, no polling,
  no client library — if it reads a terminal, it receives mail.
- **It can say why a message did not land** — `deferred`, `stalled` with the
  pane state behind it, `target_blocked` — because it can see the terminal. A
  queue only knows whether a row was read.
- **It separates a first-hand human request from a relayed one** (`--for` vs
  `--via`), which came out of a real incident rather than a design session. See
  Provenance below.

The prerequisite is the honest cost: Node, herdr, and panes. If that does not
describe your setup, a SQLite or file-based bus will serve you better.

## Security

**Anything that can reach `127.0.0.1:7777` can type arbitrary text into any of
your live agent panes.** Those panes hold sessions with file-write and shell
access, so the bus is a prompt-injection path into them, and by extension a
local code-execution path. That is the headline risk, not a footnote.

There is no authentication. A `POST /mail` from any process on the machine —
any script, any dependency's postinstall, any browser page that can reach
localhost — is delivered as a nudge into a real agent's terminal. `requested_by`
is a self-asserted string and `via` only marks a relay as second-hand; neither
is proof of anything, and an attacker fills them in as easily as an agent does.

What is actually in place: the listener binds `127.0.0.1` only, mail bodies are
capped, and payloads travel as file paths rather than inline content. What is
not: any authentication, any authorisation, any rate limit, any audit of who
opened the socket. Do not run this on a shared or multi-user machine, do not
expose the port, and add a shared-secret header before it leaves your own
laptop.

## What is durable, and what is not

Precisely, because an earlier version of this file said both "the mailbox is a
`Map`" and "the log replays on boot":

| | Where it lives | Survives a restart |
| --- | --- | --- |
| Messages, their bodies, delivery state | `Map` in memory, **and** appended to `.run/mail.jsonl` on every create and mutation | yes — replayed on boot, last write per id wins |
| Deletions | appended as a tombstone; replay drops the id | yes |
| Session registry (names, topics, panes) | memory, rebuilt from `agents.json` at boot | rebuilt, not restored |
| Wait graph (who is blocked on whom) | memory only | no — a blocking `mail_wait` dies with the process |
| Read/engaged markers | in the message record, so persisted | yes |

So: mail is durable, the coordination state around it is not. The weakness note
claiming otherwise was written before the JSONL store existed and was left
stale for a dozen commits — the contradiction was real and this table replaces
it.

Two caveats that keep it honest: writes are appends with no `fsync`, so a
machine that loses power mid-write can leave a torn last line (it is skipped on
replay), and compaction past 5000 lines rewrites the log from live records
only, which is the one operation that makes a delete unrecoverable.

## Known weaknesses

- **Blocked agents stall delivery** and only a human clears them.
- **No guaranteed delivery.** The receiver is an LLM deciding what to attend
  to; a nudge is a suggestion, not a call.
- **No tests.** Cycle detection, tombstone replay, deferred flushing and
  submit verification were each verified once by hand against live sessions and
  are documented here as observations. There is no suite that re-checks them,
  so treat every behavioural claim as "seen working", not "proven".
- **herdr is load-bearing.** Delivery is text into a terminal, so this needs
  Node *and* herdr *and* agents already running in panes. Competing buses need
  only a runtime. That prerequisite is self-inflicted by the delivery
  mechanism.
- **Version-coupled.** See below.
- **Localhost, unauthenticated** — see Security above.

Not built (explicitly out of scope): the browser views, the herdr fork, team
packaging.

## Which herdr this was measured against

The CLI surface moves between versions, so everything above says which one it
applies to. For reference:

| | 0.7.1 | 0.9.x |
| --- | --- | --- |
| Submitting a prompt | absent — `pane send-text` + `send-keys enter` + read-back | `agent prompt <target> <text> [--wait] [--until STATUS]` |
| Starting an agent | `agent start <name> [--cwd PATH] -- <argv>` | `agent start <name> --kind KIND --pane ID` |
| Waiting on output | `wait output` | `pane wait-output` |
| `agent --help` format | full signatures | Commands block of bare names |

Nothing here compares versions at runtime: the adapter probes for the command
it wants and falls back. A newer herdr with a different help format would need
the probe widened again, which is a known brittleness of asking `--help`
instead of trying the command.
