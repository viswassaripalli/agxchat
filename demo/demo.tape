# Record the README demo:
#
#   bash demo/run.sh start
#   vhs demo/demo.tape
#   bash demo/run.sh stop
#
# This records a real herdr session with real panes. The mail that appears in
# the right-hand panes was typed there by the server, over the same
# send-text/Enter path delivery uses for a live agent.

Output docs/demo.gif

Set Shell bash
Set FontSize 13
Set Width 1480
Set Height 560
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Builtin Dark"
# Start the loop past the empty prompt: frame one is what a still preview and a
# paused player show, and an empty terminal says nothing.
Set LoopOffset 15%

Hide
# herdr exports these into every pane and refuses to nest inside an existing
# session, so a recording made from inside herdr never starts its own.
Type "unset HERDR_SOCKET_PATH HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID" Enter
Type "cd /tmp/agxdemo/web && export AGX_PORT=7788 PATH=$PWD:$PATH PS1='$ '" Enter
Type "clear" Enter
Show

# Building the layout is hidden: a herdr pane starts the login shell, whose
# prompt carries the username of whoever is recording, until setup replaces it.
# The recording picks up once the three panes are up.
Hide
Type "herdr --session agxdemo" Enter
Sleep 4s
Type "/tmp/agxdemo/setup" Enter
Sleep 7s
Show

# Who is live. The right-hand panes answer to their labels.
Type "agx agents" Sleep 300ms Enter
Sleep 3s

# Ask one of them something. Watch the top-right pane: the question is typed
# into its prompt and submitted - that is delivery, there is no other channel.
# One line, not a continuation: delivery holds mail while a human is mid-way
# through typing, and a half-typed second line is exactly that.
Type `agx send tests "Which suites cover the status pills?" "Changing the colour mapping." --expect "suite names"` Sleep 300ms Enter
Sleep 9s

# The answer came back as mail, not as text stranded in a pane.
Type "agx inbox web" Sleep 300ms Enter
Sleep 4s

# Nothing trails off: open threads name who owes the next message.
Type "agx open-threads" Sleep 300ms Enter
Sleep 4s
