# v4.7.14 held source checkpoint

818 Python test executions PASS (51.5s); actual dashboard script smoke PASS; working-source manifest verification PASS. Old published v4.7.13 control client reproduced invalid Codex frame length against a full-history response >8 MiB, with no turn submitted. New summary-only idle delivery passes; active steering uses newest1 turn with items omitted. This is a proven failure class, not proof it caused recovery2160 on Mac.

Includes native CLI PM recognition, minimal no-GitHub/no-task-ledger bootstrap, dashboard-triggered nonce/session identity exchange, stale listener/sleep negotiation, guarded direct-route rebind and inbox alias/runtime UUID separation, explicit connection vs task status, v4.7.14 launcher/readiness labels and verified v4.7.13 state migration. Previous HTTP-disconnect repair is retained separately.

Official protocol references: https://learn.chatgpt.com/docs/app-server (thread/read includeTurns=false; bounded thread/turns/list; turn/start). Claude's native push channels require runtime channel enablement and custom-channel preview consent: https://code.claude.com/docs/en/channels-reference . A polling script or active-message test is not idle wake proof; no channel setup is silently enabled.

Held, no replacement ZIP. Real idle wake/ACK and actual legacy Claude watcher restoration remain open. Bounded Mac diagnosis requested on1593 comment6153736023; no Dev bundle install, no PO relay/commands, no LaunchAgent, no agent reset, no Production action. Dev reviews preempt tool work;1611 successor correction reviewed and1598 current-head reviews released during this checkpoint.
