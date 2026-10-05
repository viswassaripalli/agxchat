# Record the README demo:  vhs demo/demo.tape
#
# Runs against the scripted mailbox from demo/run.sh, so the frames are the
# same every time and nothing in them is anyone's real repository.
#
#   bash demo/run.sh start && bash demo/run.sh seed
#   vhs demo/demo.tape

Output docs/demo.gif
Output docs/demo.txt

Set Shell bash
Set FontSize 16
Set Width 1180
Set Height 640
Set Padding 24
Set TypingSpeed 45ms
Set Theme "Builtin Dark"

Hide
# HERDR_BIN matters here as much as it does for the server: without it the
# CLI asks the real herdr which pane it is in, and the answer lands in the
# recording as a pane id from whatever machine recorded it. HERDR_PANE_ID
# is exported into every real herdr pane, so it has to be overridden too
# or it is simply inherited from the terminal doing the recording.
Type "export AGX_PORT=7788 AGX_ME=design HERDR_BIN=$PWD/demo/fake-herdr HERDR_PANE_ID=w4:p1 PATH=$PWD:$PATH PS1='$ '" Enter
Type "clear" Enter
Show

Sleep 700ms

# Who is live. Four sessions, three different agents, each its own mailbox.
Type "agx agents" Sleep 400ms Enter
Sleep 2600ms

# Ask one of them something, and say what shape the answer should take.
Type `agx send tests "Which suites cover the status pills?" \` Enter
Type `  "Changing the colour mapping — what asserts on it?" \` Enter
Type `  --expect "suite names"` Sleep 400ms Enter
Sleep 3000ms

# The answer threads back into the mailbox rather than into a terminal.
Type "agx inbox design" Sleep 400ms Enter
Sleep 3400ms

# A name that is only part of another is refused, never guessed.
Type `agx send test "typo" "typo"` Sleep 400ms Enter
Sleep 2800ms

# Nothing trails off: open threads say who owes the next message.
Type "agx open-threads" Sleep 400ms Enter
Sleep 3000ms
