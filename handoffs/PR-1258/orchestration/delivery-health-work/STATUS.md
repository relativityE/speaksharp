# Orch delivery-health source checkpoint — 14 October 2026

Build: v4.7.14 / coordination.9-delivery-health. PM-owned implementation responding to App Dev and CLI Dev feedback. This is a source checkpoint, not an installed Mac release or proof that PO relay is eliminated.

## Implemented
- Durable latest GitHub event-to-native-PM delivery identity, coalesced activity binding, PR/head/observed-comment context and boot provenance. No timestamp-based recipient association.
- Live dashboard separates queued events, invocation, returned response and missing receipt/result; displays pending PM count and the preceding failed delivery/error. Last wake is relabelled Last event queued (not wake).
- Native PM runtime configuration and actual executor readiness are separate. Errored/paused/cleanup-held PM is visibly blocked, rather than labelled as recipient negotiation.
- Coordinator host, port, PID, boot, build and install root resolve conflicting machine reports.
- Read-only setup check exits 2 for absent/unhealthy boards and same-version older builds; it never reports an upgrade simply because version=4.7.14.
- Launcher and health guide no longer reference removed Recipient pairing / Connect + test controls. Native CLI PM owns negotiation; Devs do not install Orch.
- Health reads do not reset workers, consume/replay queued work, publish messages or fabricate ACKs.

## Reconstruct
Input repository checkpoint: c3693626078b9e3ae1f7ed326bf924076765680b.
1. Obtain immutable handoffs/PR-1258/orchestration/rwt-pr-handoff-v4.7.13.zip from that ref (Git blob81095837c581ad55af46b8697513f05c9b35916f; ZIP SHA25600163bc0919900acc37c857c35aa590dcc8197be752e7f61644ee4fb9f85bd45).
2. Extract in a disposable source directory, not over an installed app/private state.
3. Apply session-registration-work/repair.patch once to reconstruct coordination.8-work.
4. Apply this directory's repair.patch once for coordination.9-delivery-health.
5. Verify PACKAGE-MANIFEST.json with package_integrity.verify. Run python3 -m unittest discover -q and node test_ui.js.

Delta patch SHA256: d481276b815072bdfee2eedb11cc824562be1368be186236d4d3297c0c95b788.
Changed reconstructed source:12 paths,+416/-43. Includes new14-case delivery/setup tests and extended actual-dashboard JavaScript smoke.

## Validation
- Full Python discovery:833 tests PASS in40.279s in this Linux workspace.
- Changed delivery/setup plus coordination suite:49 tests PASS.
- Actual dashboard script smoke PASS (DOM stand-in, not browser layout or signed-in native wake).
- Python compile and git diff --check PASS.
- Package manifest verification PASS.
- Independently reconstructed a clean immutable ZIP + both patches: manifest PASS,14 new tests PASS and actual dashboard smoke PASS.
- The first new-feature run failed because the delivery-health API was absent; that is a missing-feature baseline, not claimed as nine independent runtime defect reproductions.

## Still outstanding
The Mac worker's actual subprocess error, supported native-recipient recovery, callback compatibility, sleep/compaction re-arm and real GitHub packet→idle PM→matching task/head ACK→result remain unproved. Native PM currently has a response/checkpoint protocol, not a separate authenticated task-bound ACK, so end_to_end_proven intentionally remains false. Browser PM auto-wake remains unsupported.

This increment does not install or repair the running Mac coordinator. The earlier exported coordination.8-work ZIP is unchanged and does not contain these changes. No new installation ZIP is advertised. Existing private queue/state/process ownership must be reconciled before a separately validated foreground upgrade. Do not overwrite live state, kill an unknown worker, start a second PM executor or repeat uncertain actions.

Runtime incident and exact queue reconciliation: #1593 comments6180667108,6180733762,6180758439. This code makes the failure observable and actionable; it is not a closure receipt.
