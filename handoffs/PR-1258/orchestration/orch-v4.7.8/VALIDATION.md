# Validation — v4.7.8 coordination.2

Full Python suite: 564 tests (the original delivery/lease/runtime suite plus installation/recovery regressions).
Actual dashboard JavaScript smoke: passed. Python syntax and Bash launcher syntax: passed.
Capped-continuation publication regression: RED against v4.7.6 (valid #1593 publication rejected), GREEN here.
Private state is excluded from the source archive. Installation preservation is covered by a real temporary-directory test.

These tests use isolated SQLite and fake GitHub/runtime boundaries. They do not prove an installed Mac LaunchAgent,
current recipient thread readiness, subscription login, Internet availability or real automatic wake.
The local agent must supply that host receipt and restart proof before Orch is accepted.
