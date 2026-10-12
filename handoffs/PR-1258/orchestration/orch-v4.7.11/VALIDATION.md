# Validation — v4.7.11 coordination.5

The real /api/live HTTP handler now supplies version/build metadata. The new HTTP-handler readiness test fails against v4.7.10 with the observed timeout and passes on v4.7.11. It does not use a made-up response schema. Migration also tests retaining the completed v4.7.10 action journal rather than rolling back to v4.7.7-candidate.

Final suite: 594 Python tests PASS; actual dashboard smoke PASS; Python/Bash syntax and package integrity PASS. Existing delivery, outbox, uncertainty, ownership and startup regressions remain required. No installed-Mac wake proof is claimed: acceptance still needs real version/API readiness, recipient event/ACK/result and PM continuation. No LaunchAgent or login task is installed.
