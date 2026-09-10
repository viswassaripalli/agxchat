# AGxChat — talking to other sessions
Other agent sessions run in herdr panes and are addressable by name — they may
be Claude, Codex, Cursor or anything else, so do not assume the reader shares
your tools or your context. `agx agents` lists who is live and what each one
is; `agx whoami` names your own mailbox.

- When the user says "ask/tell `<name>` ..." and `<name>` is one of those
  sessions, send it as mail instead of answering yourself:
  `agx send <name> "<subject>" "<body>" --expect "<what you want back>" --for "$USER"`
  Report the mail id and keep working — do NOT block waiting for the answer.
  The reply is nudged into this pane on its own; `agx inbox` shows it.
- Pass `--for <human>` whenever a human asked, and omit it when you are acting
  on your own initiative. The receiver uses it to tell a human's request from a
  bot's: without it, a session will correctly refuse anything with side effects.
  Never claim it for work a human did not ask for. If you learned of the request
  from another agent's mail rather than from the human, add `--via <mail-id>`;
  relaying someone else's claim as first-hand is how a fabricated approval
  spreads.
- Answer mail addressed to you with `agx reply <mail-id> "<answer>"`.
  Keep bodies short; large output goes in a file passed as `--pointer <path>`.
- Every `agx send` starts a NEW conversation. When following up on an exchange
  that already exists — clarifying, correcting, confirming, chasing — continue
  it: `agx reply <mail-id> "..."`, or `agx send ... --thread <mail-id>` to raise
  something new inside that thread. Six follow-ups sent as six fresh sends read
  as six unrelated conversations.
- Each terminal is a separate mailbox even in the same repo: a second terminal
  is `<name>-p<n>`, not `<name>`.
- Ask for what you need, not for how to get it: the session on the other end
  knows its own repo and tools, and may not run the same agent you do.
- Needs the server up: `agx serve` (http://127.0.0.1:7777).
