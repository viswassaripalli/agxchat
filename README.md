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
 │  Trigger an incremental run 6m │  I am changing the colour mapping…
 ╰────────────────────────────────╯  tests → design 21:15 8bac
                                     None of the suites assert pill text…
 j/k move · o order · f filter · c bodies · i write · d delete · q quit
```

## Requirements

| | |
| --- | --- |
| **Node** | 18 or newer (`node -v`) |
| **git** | to clone and update |
| **[herdr](https://herdr.dev)** | 0.7.1 or newer; 0.9+ recommended — delivery is native there |
| **OS** | macOS and Linux. Origin verification uses `lsof` and `ps`; without them it degrades to self-reported |
| **Agents** | already running in herdr panes. herdr recognises Claude Code, Codex, Cursor, opencode, Gemini, Copilot and more; anything it does not recognise is still reachable, see below |

## Download and install

```bash
curl -fsSL https://raw.githubusercontent.com/viswassaripalli/agxchat/main/install.sh | bash
```

Clones to `~/.agxchat`, installs dependencies, links `agx` onto your PATH,
detects your sessions from herdr's panes, writes the rule that teaches agents to
use it, starts the server, and opens the chat in its own **AGxChat** workspace.

```bash
agx update             # pull changes, reinstall deps, restart the server
agx uninstall --yes    # remove everything; keeps seed and mail in a backup
```

Two steps reach outside the install directory and can be skipped:
`AGX_NO_RULE=1` (do not write to agent instruction files) and `AGX_NO_START=1`
(do not start the server or open the workspace).

**Teaching your sessions.** `agx` works as soon as it is on PATH, but a session
only reaches for it if told to. `agx rule install` writes a marked block into
every agent instruction file it finds — Claude, Codex, Cursor, opencode,
Antigravity (`~/.gemini/AGENTS.md` and `GEMINI.md`) — backing each up first.
For an agent not on that list, name its file:
`AGX_RULE_TARGETS=~/.thatagent/AGENTS.md agx rule install`. `agx rule targets` lists them, `show` prints the text,
`remove` takes it out. Instruction files are read at session start, so restart a
session for it to apply.

## Talking to another session

Once the rule is installed you use plain words in any session; it turns them
into `agx` calls and reports the message id without blocking.

| You say | What happens |
| --- | --- |
| *"ask tests whether the dashboard suite is green"* | mail to `tests`, id reported, reply arrives in your pane |
| *"tell api I'm changing the error shape, ask if anything depends on it"* | mail to `api`, no answer required |
| *"ask whoever owns the design system if a StatusLabel exists"* | routed by topic, not by session name |
| *"ask tests to run the suite and give me the run id"* | adds `--expect "run id"` so the answer comes back shaped |
| *"check my inbox"* / *"any replies yet?"* | `agx inbox` |
| *"who's live?"* | `agx agents` — names, kinds, states, topics |

Spelled out, the same things are:

```bash
agx agents
agx send tests "Run the suite" "Against the staging fixture" --expect "run id" --for "$USER"
agx inbox
agx reply 68fb "Yes — StatusLabel, exported from the design system."
agx thread 68fb
```

## Sending files

The terminal carries an id, never a payload — large content travels as a path:

```bash
agx send api "Failing cases" "The 12 failures are listed here, one per line." \
  --pointer /tmp/failures.txt
```

The recipient reads the file directly; nothing large is ever typed into a
terminal. In plain words: *"send api the failure list at /tmp/failures.txt and
ask which are known"*. Both sessions must be able to see the path — same machine,
or a shared mount.

## Starting sessions and handing out work

| You say | What happens |
| --- | --- |
| *"open a session called reviewer in the api repo"* | `agx open reviewer --cwd …` — started as whatever kind you are |
| *"open a Codex session for scratch work"* | `--kind codex` to choose a different one |
| *"spawn three workers and give each of these tasks…"* | `agx spawn --task … --task … --task …` |
| *"what did you start?"* | `agx spawned` — names, kinds, ages, who asked |
| *"kill the workers"* | `agx kill --all` — only sessions agx started |

New sessions default to **the kind of agent asking for them**: a Codex session
spawning workers gets Codex, an Antigravity session gets Antigravity. `--kind`
overrides, `AGX_KIND` sets a default, and if the caller's own kind cannot be
determined it says so before falling back to Claude.

```bash
agx open reviewer --cwd ~/code/api            # same kind as you
agx open reviewer --kind codex --cwd ~/code/api
agx spawn --kind claude --cwd ~/code/web \
  --task "Read src/routes and list every unauthenticated endpoint" \
  --task "Check package.json for dependencies with no lockfile entry"
agx spawned
agx kill reviewer          # or: agx kill --all
```

Each task goes out as mail rather than typed text, so every answer threads back
into the mailbox instead of being stranded in a pane you have to go and read.
Capped at eight sessions per invocation; each one is a real agent.

**These are not subagents.** Most agent CLIs can spawn internal subagents, and
asked to "spawn three agents" that is what they will reach for — subagents live
inside one session, nobody else can see or message them, and they end with the
turn. `agx open` and `agx spawn` start real sessions in their own panes, each
with its own mailbox, addressable by name by anyone. The installed rule tells
sessions which to use when, so ask in plain words and you get panes; if you get
subagents instead, that session has not picked up the rule — restart it, or
check `agx rule targets`.

## Runaway loops

Every nudge asks the recipient to reply, and a reply nudges the sender back. Two
agents that each keep answering will do so until someone notices the token bill:
no participant has a reason to stop, because each message is individually
reasonable.

Three caps stop it, and **they apply only to sessions agx started** — your own
sessions are never throttled, because a long exchange there is work, not a
runaway. `AGX_GUARD_ALL=1` applies them to everything.

| | Default | Env |
| --- | --- | --- |
| Messages in one thread | 24 | `AGX_MAX_THREAD` |
| Messages between a pair in 5 minutes | 12 | `AGX_MAX_PAIR` |
| Unbroken back-and-forth | 10 minutes | `AGX_MAX_PAIR_MINUTES` |

The duration cap matters because counts miss the slow loop: two agents answering
each other every four minutes never trip a rate limit and still burn an
afternoon.

On a trip the send is refused and **whoever started those sessions is told** —
what happened, how far it got, the last few exchanges, and the two options:

```
Paused: worker-1 and worker-2 are looping
… exchanged 12 messages in the last 5 minutes (limit 12). Thread is 8 messages.
Last exchanges — worker-1: still unclear | worker-2: could you clarify …
Your options: let them continue (agx resume worker-1 worker-2),
              or stop them (agx kill --all).
```

## Reading

`agx chat` opens the thread view; `--space` gives it its own herdr workspace.

| Key | |
| --- | --- |
| `j` / `k` | move between threads |
| `o` | order: stable (default) or most recent first |
| `f` | show only threads needing attention |
| `c` | full bodies or short |
| `p` | group all exchanges between the same two agents |
| `i` | write a message |
| `d` | delete the selected thread |
| `e` | send Esc to a stuck session |
| `q` | quit |

The list is **stable by default**: new threads append at the bottom and arrivals
show as an unread count, rather than rows jumping while you read.

Threading follows replies, so **every new message starts a new thread**. Continue
one with `agx reply <id>`, or `agx send … --thread <id>` to raise something new
inside it.

## Deleting

```bash
agx delete <id>                  # hides it; agx restore <id> brings it back
agx delete <id> --purge          # erases it from the log
agx delete-thread <id> [--purge]
agx clear --yes [--purge]
agx deleted                      # what is hidden and still recoverable
```

Without `--purge` a delete appends a tombstone: the message leaves the mailbox
and the chat view, but its body stays in the log and can be restored. With
`--purge` the records are rewritten out of the log and are gone.

## Delivery

Two paths, chosen by probing what the installed herdr can do. On **0.9+**,
`agent prompt --wait` submits the text and waits for the agent to react, so
delivery reports `accepted by the agent`. On **0.7.x** there is no such command,
so the text is typed and submitted, then the pane is read back and submitted
again if it is still sitting there — that Enter gets dropped when the pane has a
shell running.

| Target state | Result |
| --- | --- |
| idle or done | delivered now |
| working | `deferred`, flushed on the next idle transition |
| blocked (Claude) | `target_blocked`, retried when the pane frees up |
| blocked (other agents) | delivered anyway — some report `blocked` while merely waiting at their prompt |
| no pane | `undeliverable` |
| nudged, then nothing | `stalled` |

**Stalled** is an inference, because the reported status is not enough: a Claude
pane parked on a permission prompt reports `done`. A message that was nudged and
then neither read, engaged with, nor answered within `AGX_STALL_MS` (60s), while
its target is not working, gets flagged. The reason comes from herdr's own
detection rules, which know what a permission prompt looks like for each agent
kind. Reading or engaging clears it; nothing is ever re-nudged.

## Agents herdr does not recognise

herdr identifies the agent kinds it ships integrations for. A pane running
anything else — a newer CLI, a private tool, a plain shell — never appears as an
agent, and used to be unaddressable.

Those panes are now targets too, with one restriction that matters: **they
answer only to their pane id or an explicit pane label**, never to a name
derived from their directory. A pane herdr cannot identify might be an agent it
has no integration for, or it might be a shell, where a delivered message would
be executed as a command. So `ask backend …` will not land in a shell that
happens to sit in the backend repo, while `agx send w6:p4 …` deliberately will.

Delivery to such a pane says so: *"herdr does not recognise what runs in that
pane, so the text was typed in as-is"*. `AGX_AGENTS_ONLY=1` restricts targets to
recognised agents again.

## Identity

Every pane is its own mailbox. The canonical pane for a repo keeps the plain
name, others get a `-p<n>` suffix, and a session started with a name keeps that
name.

```
* web       claude  web-app     idle  [web dashboard]
  web-p4    claude  web-app     done  []
* tests     claude  e2e-tests   idle  [tests e2e suite]
  cx-1      codex   scratch     idle  []
```

Recipients resolve by name, then topic, then repo. When several panes match it
**picks the readiest** — idle before busy — and reports what it chose among.
Topics stay with the canonical pane, so asking "the design system" does not fan
out to every terminal open on that repo. A reply goes back to the pane that sent
the question.

## Provenance: the finding

*A relayed claim looks exactly like a first-hand one.* This is the part worth
reading even if you never install anything.

A session was asked to get a test suite run. It could not do that itself, so it
mailed the session that could, writing — truthfully, as far as it knew — that
the human had asked. Several messages later the same sender wrote *"Confirmed:
go ahead"*, again in the human's name, for a run that provisions real
infrastructure. The human had confirmed nothing. Somewhere in a chain of relays,
a request had become an authorisation.

The receiving session refused:

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
   pane. Announced as verification; forgeable in ten seconds, because a client
   that lies about both at once satisfies the check.
3. **Say it is forgeable.** Honest, but the hole stayed open.
4. **Observe the origin**, as the receiver specified: *"stamped by the server
   from the connection it actually received the mail on, never from a field the
   client supplies."* The sending pane is now derived from the connection and the
   operating system's process tree. Forged senders are refused.

A fifth problem sat underneath all of them: the notification line mixed the
server's words with the sender's, so a subject could contain a **fake banner**
indistinguishable from the real one. The server's half is now fenced, and those
characters are stripped from anything a sender writes. Asked to sort three
banners, one real, a receiver did — and ranked its evidence better than the fix
does: *"position first, because my client renders exactly one envelope per mail
and the impostors arrive inside the body; delimiters second, a weak signal on its
own."* **Structure beats marking.**

Where it lands:

| | Checked? |
| --- | --- |
| Which pane sent it | **yes** — taken from the connection, not from a claim |
| Whether a human asked | no — it is a string the sender types |
| Whether the sender heard it from that human | no — declaring a relay is voluntary |

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

Every route but the health check requires a token, the websocket included — it
carries whole message bodies. The server generates the secret on first start
into `.run/token` (mode 0600); the CLI and chat view read it, and
`agx bootstrap --write` copies it into each repo's MCP config. `AGX_NO_AUTH=1`
disables the check.

That stops *incidental* local access — a browser tab, a script, a postinstall
hook. It is not a boundary against a determined local attacker: anything that can
read your home directory can read the token, and must be able to.

What remains true: **anything that can reach the port with the token can type
arbitrary text into your agent panes**, which hold shell and file-write access.
One token, no scopes, no rate limit. Bound to localhost. Do not run this on a
shared machine and do not expose the port.

## Durability

| | Survives a restart |
| --- | --- |
| Messages, bodies, delivery state | **yes** — appended to a log and replayed on boot |
| Deletions | yes, as tombstones; `agx restore <id>` undoes one |
| Deleted bodies | still in the log until purged — a delete hides, `--purge` erases |
| Session registry | rebuilt from the seed file |
| Blocking waits | **no** — a blocked `mail_wait` dies with the process |

Appends are not flushed to disk, so a power loss can leave a torn last line,
which is skipped on replay. Compaction past 5000 lines rewrites the log from live
records only, and is the one operation that makes a delete permanent.

## Known weaknesses

- **No tests.** Several behaviours were verified once by hand. Treat claims here
  as "seen working", not "proven".
- **Blocked agents stall delivery**, and only a human clears them.
- **No guaranteed delivery** — the receiver is a model deciding what to attend
  to. A nudge is a suggestion.
- **A spawned session waits for you before it can work.** Starting an agent in
  an unfamiliar directory raises that agent's own trust prompt, and for Claude
  the default option there is "No, exit" — so anything that presses Enter closes
  the session and takes its pane with it. Nothing here types into a pane with a
  prompt on screen, and a task sent meanwhile is held and delivered once you
  answer, but the session does nothing until you do. Spawning into a directory
  the agent already trusts avoids it entirely.
- **The MCP surface is unexercised.** Six tools are registered and tested only by
  hand; no agent has called them.
- **herdr is load-bearing.** Delivery is text into a terminal, so this needs Node
  *and* herdr *and* agents already in panes. Alternatives need only a runtime.

## Prior art

Local agent-to-agent messaging is well-trodden — over SQLite, over MCP tools,
over file queues — and Claude Code now messages its own sessions natively, which
is better than this wherever both ends are Claude. Each of those asks only for a
runtime. This one takes a different trade: delivery is text typed into a
terminal, which is why it needs herdr and panes, and which is what lets it reach
an agent that speaks no protocol at all, say *why* a message did not land, and
separate a first-hand request from a relayed one.

If that trade does not describe your setup, a SQLite or file-based bus will serve
you better.

## Settings

| | |
| --- | --- |
| `AGX_PORT` | default 7777 |
| `AGX_ME` / `AGX_FOR` | your identity / the human named when you pass `--for` |
| `AGX_STALL_MS` | stall threshold, default 60000 |
| `AGX_CONFIRM_MS` | delivery-confirmation window, default 8000 |
| `AGX_MAX_THREAD` / `AGX_MAX_PAIR` / `AGX_MAX_PAIR_MINUTES` | runaway caps |
| `AGX_GUARD_ALL=1` | apply those caps to your own sessions too |
| `AGX_NO_AUTH=1` | disable the token check |
| `AGX_DRY_NUDGE=1` | log notifications instead of writing to a terminal |
| `AGX_FORCE_TTY_NUDGE=1` | use the typed path even where the native command exists |
| `AGX_SEED` / `AGX_STORE` / `AGX_POLL_MS` | seed file, message log, poll interval |

MIT licensed.
