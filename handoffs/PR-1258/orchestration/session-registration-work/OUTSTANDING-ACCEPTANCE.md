# v4.7.14 outstanding acceptance requirements

Not a release receipt. v4.7.13 remains installed; Mac idle wake is not proven.

## Completed in the IDE PM continuity checkpoint

The manual Recipient pairing pane, UUID/provider inputs, session picker, Connect/test actions and their JavaScript handlers are removed. refreshLive references to deleted controls are removed. Server guidance now names CLI PM as recipient negotiation owner. Existing per-agent route, worker, delivery/receipt/result diagnostics remain. Dashboard smoke asserts identity acknowledgment alone never claims automatic wake.

repair.patch is consolidated directly against immutable v4.7.13 ZIP blob81095837c581ad55af46b8697513f05c9b35916f, including the prior HTTP-disconnect and session-registration work. Do not apply the former separate patches first. Full discovery818 tests and actual dashboard script smoke passed in the continuity environment; STATUS records exact validation and limitations.

## Remaining requirements retained from both devs

1. Idle Codex wake: host dispatcher to an independently verified existing thread. Demonstrate real PM comment -> idle turn -> ACK naming comment/delivery ID and runtime UUID -> result. Repeat after Mac sleep and Orch restart. No replacement session or concurrent driver; an inbox channel UUID is distinct from the runtime UUID.
2. Watchers: separate poll-only, negotiating, identity-reported, wake-proven and stale states. Monitor heartbeats and automatically restore the supported existing watcher/consumer after loss/compaction. Successful polling or a handshake request is not delivery proof. Claude tracked-task completion and Codex app-server delivery require different adapters. Preserve cursor and seen-ID dedupe.
3. Qualification: implement a separate bounded CI increment that runs only after verified Code and Security completion evidence matches the exact head. Persist/coalesce head-bound triggers, tolerate reordered/duplicate events and invalidate on head advance. No racing qualification before reviews; absent evidence remains fail-closed.
4. Child cleanup: create and record owned process groups, PID/start identity. Bound invocation. Denied or unverified cleanup remains a hold and uncertain delivery. Reconcile by original delivery ID before retry; never kill a reused/unrelated process or start a competing writer. Mac recovery2160/group98081 ownership is unverified; no cleanup bypass.
5. Copy-paste: prove complete event -> coordinator -> recipient -> receipt -> result for reviews, CI and status without PO relay or manual pairing. Native Browser PM inbound wake remains unsupported and must be disclosed. CLI PM uses its sole native queue/executor and must not require an external pairing/second writer.

Foreground installation only. No LaunchAgent, login service, silent background installer or Dev bundle download. No release or claim of complete repair until actual Mac acceptance is demonstrated. Existing dev reviews preempt tool work; App Dev RWT/Alpha and CLI Dev MVP/Beta ownership and serial landing gates remain protected.
