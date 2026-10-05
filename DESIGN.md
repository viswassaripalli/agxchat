# AGxChat design notes

How the mailbox behaves and why. The [README](README.md) is the how-to; this is
the part you read when something surprises you.

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

## Running it as a herdr plugin

`herdr plugin install viswassaripalli/agxchat` is an alternative to the
installer. herdr clones the repo, runs `npm ci`, starts the server after every
session restore, and registers three actions — `agxchat.mail.chat`,
`.serve`, `.status` — plus the chat view as a pane entrypoint. It does not open
the chat workspace on its own the way `agx serve` does; bind
`agxchat.mail.chat` to a key instead.

herdr replaces a plugin's managed checkout on reinstall, and every durable path
the server writes is `.run/`-relative — token, `mail.jsonl`, `spill/`,
`spawned.json`. `plugin/herdr-launch.sh` points `.run` at
`HERDR_PLUGIN_STATE_DIR`, so the mailbox survives a reinstall; a real
`~/.agxchat/.run` left by the installer is detected and left alone.

The chat view runs `mail-tui.tsx` directly rather than `agx chat`, which manages
its own workspace. That matters beyond tidiness: the approval gate only trusts a
request traced to a pane whose foreground process is that TUI.
