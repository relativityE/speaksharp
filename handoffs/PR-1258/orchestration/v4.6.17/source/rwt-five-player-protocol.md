# Five-player protocol — v4.6.16

PO owns product decisions and governed authorizations. Browser PM and CLI PM own assigned PM operations and dispositions; they consult the shared #1258 checkpoint before mutation to avoid duplicate execution. App Dev and CLI Dev own separate bounded branches/worktrees. Code/Security review and CI provide evidence, not authority.

The explicit release train is #1555 → #1558 → #1554 → #1559, skipping verified merged items. Current release PR is a display/coordination context. CLI Dev may work a separate assigned task without changing that selection; dispatch always validates the task's branch/worktree.

One active writer per Dev and per branch is enforced across inserts and updates. Board patches are atomic. Unknown external activity does not surrender ownership. A verified checkpoint can release old work and assign the next task together. Fresh state must cite a checkpoint, not template defaults.

Local CLI PM → CLI Dev → CLI PM handoffs have delivery IDs, parents, attempts and terminal states. App Dev and Browser PM are observed through #1258 receipts; they are not locally launched. Restart preserves queued messages, quarantines ambiguous in-flight delivery, and marks activity unknown until reconciled. No automatic retry of a possible side effect.

#1491 is the journey-based deferral ledger. Before PO RWT, fix and prove any supported user-visible failure. Unrelated improvements are parked with residual risk and promotion triggers. The first governed RWT is v2-identified; v4 and fallback follow separately under the proper authority. A choice of model does not authorize a run.
