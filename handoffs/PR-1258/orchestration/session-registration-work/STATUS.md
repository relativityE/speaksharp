# Orch v4.7.14 source — held

Dashboard launch starts per-boot actor/nonce identity negotiation. Stale listener/compaction rearm loss and sleep gaps trigger negotiation. Authenticated ACKs report runtime session identity independently of idle wake. CLI PM uses native board executor, not separate pairing; identity-only replies do not require task-ownership patches.

Route recovery distinguishes local-inbox channel UUID from runtime thread UUID. Clear direct Codex routes can rebind to acknowledged current runtime identity; pending tasks/live registered writers and final pairing races keep an explicit hold. Inbox pairing UUID is never replaced with CODEX_THREAD_ID.

202 related Python test executions PASS, including registration/authenticated callbacks/native PM, rebinding guards, startup, route recovery, delivery/worker/runtime/HTTP controls; actual dashboard UI smoke PASS previously. Native Mac idle event→turn→ACK remains unproved. Legacy Claude tracked watcher rearm lacks an externally verified wake hook. No replacement ZIP, Mac change, LaunchAgent or claim that all reported symptoms are fixed. Old 4.7.13 remains unchanged.

Pending: actual runtime transport diagnosis and idle wake on Mac; safe retirement/reconciliation of already-uncertain old deliveries; runtime-specific legacy watcher restoration. Source checkpoint only, not download-ready.
