# v4.7.8 release packet

Build: coordination.2. This package replaces the capped-control/installation/checkpoint paths in
v4.7.7-candidate. The full source is in the archive and independently hash-listed by PACKAGE-MANIFEST.json.

Offline regressions cover capped-thread routing and dedupe, new PR discovery, connection-error retention,
rejected ownership recovery, cleanup/paused safeguards, secret-free recovery context, notification coalescing,
persistent startup configuration and preservation of private state. Existing delivery/worker/lease/recovery
regressions remain mandatory. No live GitHub or provider requests occur in the offline tests.

Host acceptance is pending until the local operator installs and returns actual actor receipt/result and
PM continuation after a restart. No claim of automatic wake for an unsupported browser chat is made.
