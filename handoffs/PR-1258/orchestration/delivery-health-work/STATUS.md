# Orch v4.7.15 released package

Build coordination.10-idle-delivery. Complete immutable bundle under ../releases/v4.7.15, with pinned ZIP checksum and a gh-based verified extractor. The cumulative repair.patch applies to coordination.8 checkpoint c3693626078b9e3ae1f7ed326bf924076765680b after reconstructing its committed base.

Verification: 843 Python tests passed; actual dashboard JavaScript smoke passed; 83-file complete package passes integrity; clean ZIP extraction reran all 10 new idle-delivery tests and dashboard smoke. New tests use a real local fixture subprocess, not a signed-in Mac Codex account.

Installed acceptance remains OPEN: actual Mac error/ownership, idle upgrade, intended CLI PM packet→turn→matching ACK→review result, restart/sleep/rearm, current callback compatibility. No queued timestamp or returned response is claimed as task-bound ACK. CLI PM/host owner owns that acceptance without PO relay. App Dev still does not install Orch.
