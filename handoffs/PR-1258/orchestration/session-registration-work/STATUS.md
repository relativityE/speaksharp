# v4.7.14 held source — IDE PM continuity checkpoint

PO requested PM takeover in a new chat on 2026-10-13 after IDE PM stopped responding. Recovered source from docs/1258-orch-coordination-20261012@702f4f4ab9cfe97123122013e92296466bcea5f9. The old chat's running turn has not been confirmed cancelled. This separate checkpoint branch preserves the prior writer's branch unchanged.

Baseline ZIP git-blob identity independently verified: 81095837c581ad55af46b8697513f05c9b35916f. repair.patch is now a CONSOLIDATED patch directly against that immutable v4.7.13 ZIP, including the previously separate HTTP-disconnect correction, held session-registration/rebinding/native-PM/bootstrap/summary-only Codex work, and the recovered internal-recipient UI. Do not apply the old separate patches before this consolidated patch.

Manual Recipient pairing pane, UUID/provider inputs, session list/picker, Connect/test actions and handlers are removed. refreshLive no longer references deleted controls. Server guidance directs recipient negotiation to CLI PM. Per-agent route, delivery, receipt/result, worker heartbeat and exact errors remain read-only diagnostics. Identity-reported does not show automatic wake proven unless the existing authenticated wake-proof field is true.

Validation executed here against the reconstructed working source:
- Full Python discovery: 818 tests PASS in 55.204s.
- Focused session registration/rebinding, actual loopback Codex WebSocket transport and HTTP-disconnect checks: 44 PASS.
- Actual dashboard JavaScript smoke PASS, including live refresh with no removed controls and identity-versus-wake state assertions.
- Bash launcher syntax, diff whitespace and regenerated working-source manifest verification PASS.
- Initial focused command named a nonexistent test module; corrected to test_agent_transport before these passes.

No replacement ZIP, installation, Mac delivery or release is claimed. v4.7.13 remains the installed version. Real idle PM event -> existing recipient wake -> authenticated receipt/result, watcher restoration after compaction, restart cursor recovery, timeout/owned-child reconciliation and Mac sleep/resume acceptance remain open. Review-completion qualification repair remains a separate bounded CI increment. No LaunchAgent/login service, Dev bundle installation, agent reset, merge/deploy/migration/provider/Production action.

PM continuity is recorded on #1593 comment 6154616551. App Dev owns Alpha/RWT; CLI Dev owns Beta/MVP. Current serial CLI landing #1592 -> #1601 remains ahead of resumed App Dev #1606 -> #1607. #1592 is qualified and awaits exact PO merge authority. Preserve the existing writers, candidates and leases; no duplicate dispatch or uncertain delivery replay.
