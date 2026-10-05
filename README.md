# AGxChat

Cross-session chat for coding agents, **including agents that are not the same
agent**. A Claude session and a Codex session in different repos ask each other
for things and get answers back, with a terminal view of every thread.

![Three panes. On the left a Claude session is told, in plain English, to ask api about an error shape change; it sends mail and says so. On the right a Codex session receives the question in its prompt, searches its repo, and replies naming the files that read the old shape. Underneath, the chat view shows the thread: two messages, answered in fifteen seconds.](docs/demo.gif)

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

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/viswassaripalli/agxchat/main/install.sh | bash
```

Clones to `~/.agxchat`, installs dependencies, puts `agx` on your PATH, detects
your sessions from herdr's panes, **writes the rule that teaches your agents to
use it**, starts the server, and opens the chat in its own **AGxChat** workspace.

Two steps reach outside the install directory and can be skipped: `AGX_NO_RULE=1`
(do not touch agent instruction files) and `AGX_NO_START=1` (do not start the
server or open the workspace).

Instruction files are read at session start, so **restart a session** before it
can use `agx`. If one still ignores it, `agx rule targets` lists the files that
were written and `agx rule show` prints what they say; name a file it missed
with `AGX_RULE_TARGETS=~/.thatagent/AGENTS.md agx rule install`.

## Update

```bash
agx update             # pull changes, reinstall deps, restart the server
```

Re-running the installer does the same thing; it is idempotent. Your mailbox,
token and spill files are left alone either way.

```bash
agx uninstall --yes    # remove everything; keeps seed and mail in a backup
```

## Use

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

**What to address it as.** The left column of `agx agents` is the answer. A
session also answers to a topic it registered, to the label on its herdr space,
and to its repo directory — tried in that order, after its own name — plus its
pane id. A partial name is refused rather than guessed: `api` matching both
`api-gateway` and `api-worker` comes back as `inexact` with the candidates listed,
because delivering to whichever one happened to be free is how an answer
arrives from the wrong project. The send result reports which of those matched
as `resolved_via`.

A pane with no agent in it — a plain shell — is never reachable by name, only
by its pane id. Typing into one would run the message as a command.

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

### A worked example

Start a session in its own space, ask it something, read the answer, close the
thread, stop the session. `--space` gives it a workspace of its own labelled
with the name; without it you get a pane split in the workspace you are in.

```bash
agx open reviewer --kind claude --cwd ~/code/api --space
```
```
started claude as "reviewer" in pane wR:p1 (cwd /Users/you/code/api)
it becomes addressable once herdr sees it — check with: agx agents
```

It is not addressable the instant the command returns — herdr has to see the
agent come up, which takes a few seconds. A session started somewhere that
agent does not already trust stops at its own trust prompt and waits for a
human, so check before sending:

```bash
agx agents
```
```
reviewer         claude   wR:p1   api                idle     [-]
```

Now ask. Pass `--for` because a human asked; say what shape you want back with
`--expect`:

```bash
agx send reviewer "What is this repo, and what does the current branch change?" \
  "Two short answers please: (1) what this repo holds; (2) what the branch changes \
   relative to its base, and whether it is finished. Read your own repo — do not \
   modify anything." \
  --expect "Two short paragraphs" --for "$USER"
```
```json
{ "id": "638c", "to": "reviewer", "resolved_via": "name",
  "delivery": "nudged_inline",
  "detail": "pane wR:p1 (idle) — accepted by the agent" }
```

`resolved_via` says which pass matched the name — `name` here, but `space` if
you addressed it by the label on the workspace, or `repo` by directory. Do not
wait on the answer; it is nudged into your pane when it arrives. The nudge line
is truncated, so read the thread for the full body:

```bash
agx thread 638c
```

Then close it, and stop the session when you are actually done with it:

```bash
agx settle 638c "Answered: request routing and auth; the branch adds response compression, pushed, untested."
agx kill reviewer
```

Settling matters more than it looks: a thread that just trails off is
indistinguishable from one still owed a reply, and `agx open-threads` is how
everyone finds out which is which.

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

## How it works

Why delivery types into a terminal, what `--for` does and does not prove, what
survives a restart, and where it breaks: [DESIGN.md](DESIGN.md).
