# Reading and operating the current canary

Owner:Engineering/Quality. Current authority:[RELEASE_PROCESS](../../product_release/RELEASE_PROCESS.md) and [OPERATIONS_AND_SECURITY](../../product_release/OPERATIONS_AND_SECURITY.md). This agent-discovery guide grants no dispatch or account authority.

The source workflow is [.github/workflows/canary.yml](../../.github/workflows/canary.yml). It targets canonical Production, not staging. Push/daily runs use the read-only active-trial product lane; a separate weekly schedule adds Stripe test-mode/test-clock billing qualification. Manual dispatch does not select billing. Genuine live paid-customer proof stays separately authorized.

CANARY_TRIAL_EMAIL is a repository Variable; CANARY_TRIAL_PASSWORD is a Secret. CANARY_LANE_PASSWORD is a workflow-scoped environment input, not a new GitHub Secret to provision. The read-only trial provisioner is not injected with a service-role credential. Never copy credentials into a shell or message.

Read-only exact-run inspection uses gh run view and the known run ID. Listing canary.yml is a separate read subject to host permissions. Record actual headSha/lane/timestamps/result and served identity. Workflow success alone is not full RWT, paid continuity or human/device acceptance. A denied command remains unexecuted; do not route around its approval check.

Source config:playwright.canary.config.ts; tests/canary. Re-read exact source before any separately authorized dispatch. This correction executes none.
