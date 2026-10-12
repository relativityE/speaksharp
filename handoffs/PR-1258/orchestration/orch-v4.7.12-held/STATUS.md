# Orch repair held

PO paused interim release on2026-10-12 to prioritize wake/notification repairs. No installable package is published. Patch applies to4.7.11 source; PACKAGE-MANIFEST must be regenerated before any release.

Prior complete suite:740 test executions PASS, dashboard smoke PASS. Latest additional regression proves never-started paired listener silently escaped watchdog; baseline RED, fixed GREEN. Related24 actor-channel tests pass. Native PM now receives one deduplicated recovery alert for a never-started session; this is detection, not recipient wake proof.

Remaining: legacy watcher rearm, existing-session supported persistent transport/handoff, actual Mac wake→authenticated receipt/result→PM continuation. Browser ChatGPT has no supported inbound wake hook. Read-only installed-host capability packet requested directly on1593 comment6132390286; no new writer, watcher termination or Dev bundle install authorized.
