# #1267 Private-only launch playbook — source rehearsal record

> **HISTORICAL EVIDENCE — point-in-time measurement, NOT current release truth.**
> This report records what was measured on its own date. It is **not** rewritten to look current, and it
> must not be: a measurement edited to match today's posture stops being evidence of anything.
> Current release posture: [`RELEASE_STATUS.md`](../RELEASE_STATUS.md). Current work sequencing:
> [`ACTIVE_COORDINATION.md`](../ACTIVE_COORDINATION.md).
> STT model selection is **not complete** — no Private model has been chosen; any model ranking below
> predates the #1304 certified harness and its frozen corpus.

**Date:** 2026-08-11
**Scope:** source-only tabletop and non-destructive rollback drill
**Branch:** `agent/1267-launch-playbook`
**Production mutation:** none
**Authority:** evidence for the playbook implementation only; not current release status and not GO

## Participants and roles

| Exercise role | Participant | Result |
|---|---|---|
| Engineering / playbook author | Codex implementation agent | Completed source walkthrough |
| Independent PR reviewer | Assigned reviewer | RETURN at `c16229db`; bounded corrections incorporated, exact-head re-review required |
| Product Owner / release authority | relativityE | No GO/HOLD or mutation requested in this exercise |

The real release-window worksheet must still name primary and backup owners for every role in
`RELEASE_PROCESS.md` §7.2. This exercise does not invent people, contact details, or authorization.
It also does not satisfy the conditional #1254/product-authority prerequisites for applying §7 to a
release candidate.

## Tabletop

Seven scenarios were walked against the §7.5 decision trees:

| Scenario | Expected classification | Safe response | Result |
|---|---|---|---|
| live SHA differs from intended `main` | S2 / identity unverified | HOLD; reconcile host, deployed SHA, and exact-head evidence | Pass |
| Private model setup unavailable | S2 | stop new takes; honest retry/unavailable state; no Browser/Cloud fallback | Pass |
| finalize completes but save is not durable | S1 if work is lost | preserve recovery draft; inspect status only; HOLD | Pass |
| History exposes another account's row | S1 | restrict incident record; stop cohort; ownership-safe read-only proof | Pass |
| retention deletes beyond deployed contract | S1 | stop retention writes; compare production history/definitions; HOLD | Pass |
| 320px recording control is clipped | S2 | pause affected device cohort; no alternate product path | Pass |
| checkout or retired engine becomes reachable | S1 | HOLD; identify exact config/source regression; no compensating enablement | Pass |

## Non-destructive rollback drill

The drill exercises preparation only and deliberately stops before any Vercel, Supabase, database,
configuration, billing, or data mutation.

1. Read `origin/main` (`a1c297ba3191568b80af5d0f6d1f97b79157d2ee`) and resolve its immutable
   first parent (`135d21f4004bdcc326d0c8daa468add26290178b`) solely as an exercise candidate;
   do not call it production-known-good without deployed evidence.
2. Prove both commits exist and enumerate the frontend, Edge/shared, migration, workflow, and config
   diff surfaces.
3. Confirm the actual automation boundary: `deploy-supabase-edge-release.yml` is path-filtered to
   Edge source/config, and a qualifying change calls the reusable workflow that deploys its complete
   reviewed function list. The exercise diff contained frontend files only, so it would not trigger
   the Edge caller. Migration application remains a separate manual operation.
4. Draft the exact frontend rollback or forward-fix action, expected release SHA, automatic side
   effects, abort condition, and post-action readback.
5. Stop. No rollback/deploy command is executed because no Product Owner authorization exists.

**Pass criteria:** immutable candidate resolved; affected surfaces enumerated; no retired engine proposed;
no migration reversal proposed; no production command executed; required authorization and readback named.

**Observed exercise diff:** 19 frontend source/test files; 0 Edge/shared files; 0 migrations; 0
workflow/config files. Both commits resolved successfully; no deployment or rollback command ran.

**Exercise result:** PASS at the source-procedure boundary. The release-window owner must repeat this
against the actual intended and known-good deployed SHAs and attach read-only evidence before GO.

## Remaining acceptance boundaries

- Independent documentation/operations review of the PR is required.
- The actual release window must complete the primary/backup contact worksheet and the full GO/HOLD
  checklist with live exact-SHA and deployed-journey evidence.
- Any merge, deployment, migration application, configuration mutation, tester invitation, or
  production drill remains separately Product Owner-authorized.
