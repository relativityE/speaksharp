# Validation — v4.7.9 coordination.3

Full Python suite: 590 tests (the original delivery/lease/runtime suite plus installation/recovery regressions).
Actual dashboard JavaScript smoke: passed. Python syntax and Bash launcher syntax: passed.
Capped-continuation publication regression: RED against v4.7.6 (valid #1593 publication rejected), GREEN here.
Private state is excluded from the source archive. Installation preservation is covered by a real temporary-directory test.

These tests use isolated SQLite and fake GitHub/runtime boundaries. They do not prove an installed Mac LaunchAgent,
current recipient thread readiness, subscription login, Internet availability or real automatic wake.
The local agent must supply that host receipt and restart proof before Orch is accepted.

Startup readiness regression: RED against v4.7.6 (PM stays in error and cannot claim new events), GREEN here. Login recovery, pause/cleanup preservation, Dev uncertainty and ownership preservation are covered.

First-launch announcement/dedupe, four real-ACK-required version handshakes, task-scoped publication failures and real board agent-map shape are covered. v4.7.8 installer assumed a list where the actual API returns an agent dictionary; fixed here before installation.
