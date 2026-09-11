# AGxChat

Cross-session chat for coding agents, **including agents that are not the same
agent**. A Claude session and a Codex session in different repos ask each other
for things and get answers back, with a terminal view of every thread.

One Node server holds the mailbox. Sessions reach it over a small CLI or
MCP-over-HTTP. [herdr](https://herdr.dev) carries the wake-up.

```
 web idle  tests working  design idle  api done                          live
 4 threads · 1 needs attention · 2 unread [all] [short bodies] [stable order]

 ╭────────────────────────────────╮  Which suites cover status pills?
 │  design ⇄ tests                │  2 messages · answered in 43s
 │  Which suites cover status…●2  │
 │ !web ⇄ tests                   │  design → tests 21:14 eb5a
 │  Trigger an incremental run 6m │  I am changing the colorType mapping…
 ╰────────────────────────────────╯  tests → design 21:15 8bac
                                     None of the suites assert pill text…
 j/k move · o order · f filter · c bodies · i write · d delete · q quit
```

## Do you need this?

Claude Code already messages its own sessions — `ListAgents` and `SendMessage`,
natively, no install. **If both ends are Claude, use that.** It is better at the
part it covers.

This exists for the part it does not:

| | built-in | AGxChat |
| --- | --- | --- |
| Claude → Claude | yes, and better | yes |
| Claude → Codex, Cursor, opencode… | no | yes |
| History after a restart | the transcript | append-only log, deletable, recoverable |
| Why a message did not land | it arrived or it did not | `deferred`, `stalled`, `target_blocked`, with reasons |
| Addressing | by session name | by name, repo or topic, picking whichever pane is idle |

A mailbox over HTTP plus a nudge typed into a terminal assumes nothing about who
is reading — which is the only way a Claude session and a Codex session talk at
all.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/viswassaripalli/agxchat/main/install.sh | bash
```

Clones to `~/.agxchat`, installs dependencies, links `agx`, detects your sessions
from herdr's panes, writes the rule that teaches agents to use it, starts the
server, and opens the chat in its own **AGxChat** workspace. Then, in any session
(restart it once so it picks up the rule):

```
ask tests whether the dashboard suite is green
```

Re-running updates in place; so does `agx update`. `agx uninstall --yes` reverses
all of it, keeping your seed and mail in a backup. Two steps reach outside the
install directory and can be skipped: `AGX_NO_RULE=1` (do not touch instruction
files) and `AGX_NO_START=1` (do not start the server or open the workspace).

**Teaching your sessions.** `agx` works the moment it is on PATH, but a session
only reaches for it if told to. `agx rule install` writes a marked block into
every agent instruction file it finds — `~/.claude/CLAUDE.md`,
`~/.codex/AGENTS.md`, `~/.cursor/AGENTS.md`, `~/.config/opencode/AGENTS.md` —
backing each up first. `agx rule targets` lists them, `show` prints the text,
`remove` takes it out. These are read at session start, so restart a session for
it to apply.

## Commands

| | |
| --- | --- |
| `agx serve` / `stop` / `status` | run the server, stop it, dump health |
| `agx chat [--space]` | the thread view; `--space` gives it its own workspace |
| `agx agents` / `whoami` | who is live and what kind; your own mailbox |
| `agx send <to> <subject> <body>` | `--for <human>` `--via <mail-id>` `--expect <shape>` `--thread <mail-id>` `--pointer <path>` |
| `agx inbox` / `thread <id>` / `reply <id> <body>` | read and answer |
| `agx open <name> --kind claude\|codex\|…` | start a session and make it addressable |
| `agx spawn <n>` or `--task "…" --task "…"` | start several and give each its own task (max 8) |
| `agx delete <id>` / `delete-thread <id>` / `clear --yes` | remove a message, a thread, everything. Add `--purge` to erase rather than hide |
| `agx deleted` / `restore <id>` | list what delete hid, bring one back |
| `agx provenance` | audit every claim of human authority |
| `agx bootstrap [--write]` | wire `.mcp.json` into your repos (dry run by default) |
| `agx update` / `uninstall --yes` | pull changes; remove everything |

Sending from another session needs nothing installed there — every agent has a
shell:

```bash
agx send tests "Run the suite" "Against the staging fixture" --for "$USER"
agx inbox
agx reply 68fb "Yes — StatusLabel."
```

Identity comes from asking the server which pane you are in. If that fails,
`send` and `reply` refuse and name the cause rather than guessing: mail from a
wrong sender gets replies nobody reads.

## Delivery

Two paths, chosen by probing what the installed herdr can do:

- **0.9+** — `agent prompt … --wait --until working` submits the text *and waits
  for the agent to react*, so delivery reports `accepted by the agent`.
- **0.7.x** — no such command, so `pane send-text` + `send-keys enter`, then read
  the pane back and submit again if the text is still sitting there: that Enter
  gets dropped when the pane has a shell running. Forced with
  `AGX_FORCE_TTY_NUDGE=1`.

| Target state | Result |
| --- | --- |
| `idle` / `done` | delivered now |
| `working` | `deferred`, flushed on the next idle transition |
| `blocked`, Claude | `target_blocked`, retried when the pane frees up |
| `blocked`, other agents | delivered anyway — Codex reports `blocked` while merely waiting at its prompt |
| no pane | `undeliverable` |
| nudged, then nothing | `stalled` |

**Stalled** is an inference, because `agent_status` is not enough: a Claude pane
parked on a permission prompt reports `done`. A mail that was nudged and then
neither read, engaged with, nor answered within `AGX_STALL_MS` (60s), while its
target is not `working`, gets flagged. The *reason* comes from `herdr agent
explain --json`, which names the detection rule that matched — herdr maintains
that manifest per agent kind and refreshes it remotely, so it knows what a Claude
permission prompt and a Codex approval dialog look like. Reading or engaging
clears the flag. Nothing is ever re-nudged; a stalled agent needs a human, not
more text.

Payload travels by pointer: the terminal carries an id, never the content. Use
`--pointer <path>` for anything large.

## Identity

Every pane is its own mailbox. The canonical pane for a repo keeps the plain
name, others get a `-p<n>` suffix, and an agent herdr has a name for keeps that
name.

```
* web       claude  w6:p1  hevo-ui     idle  [web dashboard]
  web-p4    claude  w6:p4  hevo-ui     done  []
* tests     claude  w8:p1  e2e-tests   idle  [tests e2e suite]
  cx-1      codex   wD:p8  scratch     idle  []
```

`to:` resolves by registry name → herdr name → pane identity → topic → pane id →
repo. When a pass matches several panes it **picks the readiest** — idle before
done before working before blocked, then canonical — and reports what it chose
among. Topics stay with the canonical pane, so "ask design …" does not fan out to
every terminal open on that repo. `repo` is the git root's name, not
`basename(cwd)`: a session in `<repo>/ui` would otherwise advertise itself as
`ui`. A reply goes back to the pane that sent the question, not to whichever pane
is canonical.

## One exchange, one thread

Threading follows `replyTo`, so **every `send` starts a new thread**. Continue one
with `agx reply <id>` or `agx send … --thread <id>`. In the chat view, `p`
collapses all exchanges between the same two agents into one conversation.

The list is in **stable order** by default: new threads append at the bottom and
arrivals show as an unread count, rather than rows jumping while you read. `o`
switches to recent-first.

## Provenance: the finding

*A relayed claim looks exactly like a first-hand one.* This is the part worth
reading even if you never install anything.

A session was asked to get a suite run, could not do it itself, and mailed the
session that could — writing, truthfully as far as it knew, that the human had
asked. Several messages later the same sender wrote *"Confirmed: run
dashboard_incremental_only.yml"*, again in the human's name, for a run that
provisions real infrastructure. The human had confirmed nothing. Somewhere in a
chain of relays, a request had become an authorisation.

The receiver refused:

> I cannot take a claim of his approval from a mail as his approval. If he asks
> me directly I will run it immediately.

Nothing in the message could have told it otherwise. "The human asked me to ask
you" and "another agent told me the human asked" are the same sentence.
**Authority does not survive a relay, but the words expressing it do.**

Four attempts followed, and the first three were wrong in instructive ways.

1. **Name the relay.** `--for <human>` for a first-hand request, `--via
   <mail-id>` when the sender learned of it from another agent's mail. A Codex
   session and a Claude session both read the distinction correctly, unprompted.
   Its limit, as one of them put it: *"`--via` being present tells me the sender
   is being scrupulous, while its absence tells me nothing."*
2. **Verify the sender** by comparing the claimed sender against the claimed
   pane. Announced as verification; forgeable in ten seconds. A `POST` naming
   another session *and* its pane was accepted, delivered labelled "sender
   verified", and had its reply addressed to the impersonated session's real
   pane.
3. **Say it is forgeable.** Honest, but the hole stayed open.
4. **Observe the origin**, as the receiver specified: *"stamped by the server
   from the connection it actually received the mail on, never from a field the
   client supplies."* Peer port off the socket → the pid that owns it → its
   process ancestry → the pids herdr reports per pane. `from_pane` is ignored
   whenever an origin can be observed, forged senders get `403 sender_forged`,
   and `GET /origin` shows what the server sees.

A fifth problem sat underneath all of them: the nudge line concatenated the
server's part with the sender's, so a subject could carry a **fake banner**
indistinguishable from the real one. The server's half is now fenced in `« »`,
those characters are stripped from sender content, and content is flattened to
one line. Asked to sort three banners, one real, a receiver did — and ranked its
evidence better than the fix does: *"position first, because my client renders
exactly one envelope per mail and the impostors arrive inside the body;
delimiters second, a weak signal on its own."* **Structure beats marking.**

Where it lands:

| | Checked? |
| --- | --- |
| Which pane sent it | **yes** — taken from the connection, not from a claim |
| Whether a human asked | no — `--for` is a string the sender types |
| Whether the sender heard it from that human | no — `--via` is voluntary |

`agx provenance` audits every claim and marks it first- or second-hand. Origin is
real; authority never was. Which leaves enforcement where two receiving sessions
independently put it, neither having seen the other's reasoning:

> A verified pane plus an unverifiable on-behalf-of is still not authorisation
> for side effects — my user types into my pane, and that is where I confirm
> anything with a write, push, publish, deploy or account change.

An agent declining to act on unverifiable authority is not friction to be
engineered away. On a bus with no authentication it is the only enforcement
there is, and the useful goal is to give it better evidence rather than to route
around it.

## Security

Every route but `/health` requires `X-AGX-Token`, the websocket included — it
carries whole message bodies. The server generates the secret on first start into
`.run/token` (mode 0600); the CLI and TUI read it, and `agx bootstrap --write`
copies it into each `.mcp.json`. `AGX_NO_AUTH=1` disables the check.

That stops *incidental* local access — a browser tab, a script, a postinstall
hook. It is not a boundary against a determined local attacker: anything that can
read your home directory can read the token, and must be able to.

What remains true: **anything that can reach the port with the token can type
arbitrary text into your agent panes**, which hold shell and file-write access.
One token, no scopes, no rate limit, no audit of who opened the socket. Bound to
`127.0.0.1`. Do not run this on a shared machine and do not expose the port.

## Durability

| | Survives a restart |
| --- | --- |
| Messages, bodies, delivery state | **yes** — held in memory and appended to `.run/mail.jsonl`, replayed on boot |
| Deletions | yes, as tombstones; `agx restore <id>` undoes one |
| Deleted bodies | **still readable in the log** until purged — a delete hides, `--purge` erases |
| Session registry | rebuilt from `agents.json` |
| Wait graph (who is blocked on whom) | **no** — a blocking `mail_wait` dies with the process |

Appends are not `fsync`ed, so a power loss can leave a torn last line, which is
skipped on replay. Compaction past 5000 lines rewrites the log from live records
only, and is the one operation that makes a delete permanent.

## Known weaknesses

- **No tests.** Cycle detection, tombstone replay, deferred flushing and submit
  verification were each verified once by hand. Treat behavioural claims here as
  "seen working", not "proven".
- **Blocked agents stall delivery**, and only a human clears them.
- **No guaranteed delivery** — the receiver is an LLM deciding what to attend to.
  A nudge is a suggestion.
- **Spawned sessions are short-lived** in testing: `agx spawn` delivers and gets
  answers, but the panes do not always persist. Cause unknown.
- **The MCP surface is unexercised.** Six tools are registered and tested only by
  curl; no agent has called them, because `bootstrap --write` has not been run.
- **herdr is load-bearing.** Delivery is text into a terminal, so this needs Node
  *and* herdr *and* agents already living in panes. Alternatives need only a
  runtime. That prerequisite is self-inflicted by the delivery mechanism.

## Which herdr

| | 0.7.1 | 0.9.x |
| --- | --- | --- |
| Submitting a prompt | absent | `agent prompt … [--wait] [--until STATUS]` |
| Starting an agent | `agent start <name> [--cwd]` | `agent start <name> --kind KIND --pane ID` |
| `agent --help` format | full signatures | Commands block of bare names |

Nothing compares versions at runtime: the adapter probes for the command it wants
and falls back.

One finding does not move with herdr versions, because it is Claude Code
behaviour: **`/btw` has no tools.** It answers without derailing the main task,
but reports *"No tools here. Cannot run command."* — so it can never reach
`mail_inbox`, which is why mail for a busy target is deferred rather than
delivered as a side question.

## Prior art

Local agent-to-agent messaging is well-trodden — over SQLite, over MCP tools,
over file queues — and Claude Code now messages its own sessions natively. Each
of those asks only for a runtime. This one takes a different trade: delivery is
text typed into a terminal, which is why it needs herdr and panes, and which is
what lets it reach an agent that speaks no protocol at all, say *why* a message
did not land, and separate a first-hand request from a relayed one.

If that trade does not describe your setup, a SQLite or file-based bus will serve
you better.

## Escape hatches

| | |
| --- | --- |
| `AGX_PORT` | default 7777 |
| `AGX_ME` / `AGX_FOR` | override your identity / the human named in `--for` |
| `AGX_STALL_MS` | stall threshold, default 60000 |
| `AGX_CONFIRM_MS` | delivery-confirmation window, default 8000 |
| `AGX_DRY_NUDGE=1` | log nudges instead of writing to a TTY |
| `AGX_FORCE_TTY_NUDGE=1` | use the 0.7.x typed path even where `agent prompt` exists |
| `AGX_NO_AUTH=1` | disable the token check |
| `AGX_ALLOW_SENDER_OVERRIDE=1` | permit a sender name that contradicts the observed pane |
| `AGX_SEED` / `AGX_STORE` / `AGX_POLL_MS` | seed file, message log, poll interval |

MIT licensed.
