# v4.7.14 outstanding acceptance requirements

Not a release receipt. v4.7.13 remains installed; idle wake is not proven.

## Internal recipient negotiation

Remove the Advanced Recipient pairing pane, UUID/provider inputs, session picker, Connect/test actions and their JavaScript handlers. Remove refreshLive references to deleted controls. Replace the server instruction 'Pair each recipient in Advanced' with coordinator-owned negotiation status. Keep read-only per-agent connection diagnostics.

CLI PM initiates nonce-bound current-runtime UUID handshakes on dashboard launch and after stale watcher, sleep/resume or route change. A UUID acknowledgment proves identity only; it does not prove an idle wake. Keep inbox-channel UUIDs distinct from runtime-thread UUIDs. Never silently retarget an outstanding delivery.

The previous working-session UI removal passed node test_ui.js, but is not included in the saved repair.patch at commit 4049eef. Recover and persist the UI/test changes before packaging. The current execution environment cannot start the shell process, so this checkpoint does not assert a new test execution.

## App Dev feedback incorporated

1. Idle Codex wake: host dispatcher to an independently verified existing thread. Demonstrate real PM comment -> idle turn -> ACK naming comment ID. Repeat after Mac sleep and Orch restart. No replacement session or concurrent driver.
2. Watchers: separate poll-only, negotiating, identity-reported, wake-proven and stale states. Monitor heartbeats and automatically negotiate recovery; successful polling is not delivery proof. Claude tracked-task completion and Codex app-server delivery require different adapters.
3. Qualification: run only after both Code and Security completion evidence matches exact head. Persist/coalesce head-bound triggers, tolerate reordered/duplicate events, invalidate on head advance. Preserve fail-closed gates when evidence is absent; review completion must be verified, not inferred from a generic event.
4. Child cleanup: create and record owned process groups, PID and start identity. Bound invocation. Cleanup permission can still fail; record unresolved cleanup and uncertain delivery. Reconcile by delivery ID before retry; never kill an unrelated or reused process, or start a competing writer.
5. Copy-paste: remove PO relay and manual pairing from normal startup. Prove a complete event -> coordinator -> recipient -> receipt -> result path for review, CI and status updates. Native Browser PM inbound wake remains unsupported and must be disclosed.

Foreground installation only. No LaunchAgent, login service, silent background installer or Dev bundle download. No claim of complete repair or release until the Mac acceptance path is demonstrated.
