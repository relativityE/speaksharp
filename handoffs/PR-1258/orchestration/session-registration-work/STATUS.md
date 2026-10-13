# Orch session registration checkpoint — held

App source changes, not a released replacement for v4.7.13.

Dashboard launch creates per-boot actor/nonce identity negotiation; stale local listeners and wall-clock sleep gaps trigger recovery. Authenticated recipient callbacks record runtime UUID independently from idle wake. Native CLI PM identity turns do not require repository task ownership patches. Dashboard shows identity stage; foreground supervision remains the existing owned-worker supervisor.

Verification: 155 related test executions plus actual UI smoke PASS; after adding authenticated callback/native-PM regressions, 24 registration-module/suite executions PASS (8 new focused cases plus inherited controls). HTTP-disconnect repair from prior checkpoint retained locally, not reproduced in this delta.

OPEN: changed-session identity is reported but does not automatically overwrite a frozen/pending delivery route. Safe rebind and retirement/reconciliation of old non-writing notices require further implementation. Existing persistent-worker supervisor can resume verified registered idle consumers, but legacy Claude tracked-task rearm and real Codex idle event→turn→ACK remain Mac acceptance gaps. No replacement ZIP, no LaunchAgent, no Mac change, no new wake proof. Do not advertise all blocked/unknown symptoms fixed.
