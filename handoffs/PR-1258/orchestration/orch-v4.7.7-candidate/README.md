# Orch v4.7.7-candidate — coordination.1

Coordination setup and recovery belong to the agents. CLI PM fetches and stages this candidate directly from GitHub, preserves installed state, switches at a verified idle boundary and reports acceptance. PO should not copy commands, task prompts, review packets or session identifiers between agents. See INSTALL.md.

The single setup entry is Start_Orch.command / orch-setup.py. It reuses a live installation, checks existing GitHub/Codex authentication and invokes the retained migration/singleton launcher. Connect + test combines pairing with an idempotent outstanding wake probe. Pairing persists across restarts.

The local watcher observes packets, CI, reviews, heads and deploy events. Four roles receive durable observation notices; Dev results flow into PM's queue. A recent-comment fast lane reads the tail of long issues without losing the historical cursor or bypassing the shared GitHub request budget.

Registered idle Dev workers resume into their existing verified thread only when both prior processes are absent and no action is unresolved. A durable PM cleanup hold survives parent exit; recovery requires proof its recorded group is absent and no delivery/action remains unresolved. Potentially sent or approval-blocked actions are never silently replayed.

The dashboard shows exact queue blockers and coordination health owned by CLI PM. It distinguishes listeners and actual wake receipts from pairing/publication. App Dev's existing runtime owns background-listener rearming. This browser chat needs supported inbound integration of its own; the local PM executor does not wake it.

This is a tested source candidate, not an installed-host wake certificate. Retain GitHub fallback until inactive Dev delivery, PM event handling, restart and duplicate-prevention checks pass on the actual host. No production, merge, activation or permission-policy authority is added.
