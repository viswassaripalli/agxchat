# Record the README demo:
#
#   bash demo/run.sh start && bash demo/boot.sh
#   vhs demo/demo.tape
#   bash demo/run.sh stop
#
# This records real sessions. Claude is in the left pane, Codex in the right,
# the chat view underneath. Nobody types an agx command: the instruction is
# plain English, and the session decides to send mail because the installed
# rule told it how.
#
# It is not deterministic. Two models are thinking; every take differs.

Output docs/demo.gif

Set Shell bash
Set FontSize 13
Set Width 1340
Set Height 700
Set Padding 16
Set TypingSpeed 55ms
Set Framerate 8
Set Theme "Builtin Dark"
Set LoopOffset 45%

Hide
Type "unset HERDR_SOCKET_PATH HERDR_ENV HERDR_PANE_ID HERDR_TAB_ID HERDR_WORKSPACE_ID" Enter
Type "clear" Enter
Type "herdr --session agxdemo" Enter
Sleep 5s
Show

Sleep 1500ms

# Plain English, to the session on the left. No agx anywhere.
Type "ask api whether anything of theirs reads the flat 422 error body - we are changing it to {errors:[{field,message}]}"
Sleep 800ms
Enter

# Claude sends the mail, herdr types it into the Codex pane, Codex answers, and
# the thread shows up underneath while it happens.
Sleep 115s
