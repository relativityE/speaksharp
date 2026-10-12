# Orch v4.7.7-candidate — coordination.1

This candidate addresses manual setup and missed/stalled coordination: one setup entry with automatic package-integrity/authentication checks; combined Connect + test; explicit queue blockers and role health; long-issue recent-packet priority; durable PM cleanup hold/recovery; automatic resume of eligible registered Dev workers without a new thread or task replay.

537 Python tests, actual-script Node UI smoke and Bash syntax pass. See VALIDATION.md and COORDINATION-CHANGE.md. Source package contains no private operational state or credentials. Publish on a dedicated handoff branch, not main.

CLI PM owns direct GitHub retrieval, staging, safe installation and host acceptance. PO does not download, paste commands, choose session UUIDs or ferry Dev messages. Keep fallback until actual inactive-recipient automatic-wake receipts/results and restart/event tests pass. Existing App Dev runtime owns its listener rearming. A browser conversation requires separate supported inbound delivery.

No Production, merge, feature activation, credential-copy or permission-policy authority is added. Old installed state and sent-action journals must remain intact.
