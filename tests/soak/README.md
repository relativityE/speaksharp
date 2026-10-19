# Backend stress and browser endurance source guide

Owner:Engineering/Quality. Authority:[OPERATIONS_AND_SECURITY](../../product_release/OPERATIONS_AND_SECURITY.md), [QUALITY](../../product_release/QUALITY.md). Active workflow:[stress-endurance.yml](../../.github/workflows/stress-endurance.yml).

Backend API stress uses backend-api-stress-test.ts and its metrics collector; browser endurance uses the selected Playwright soak config/spec. Public anon transport plus the signed-in user's token exercises that user's authorization, not every RLS/rate-limit property. Privileged provisioning is a separate action.

Registered commands:pnpm test:stress:backend, pnpm test:endurance:browser, pnpm test:soak:verify:local. They are not offline-only: inspect exact target/config/account registry/duration/package pre-hooks before specifically authorized execution. Do not put a service-role key in a local environment to repair a missing fixture. Approved credential-injected verification/provisioning and any account writes require separate authority; never print values.

Customer recording is Private STT. Preserved internal Native/Web-Speech endurance is not proof of Private product behavior. Report selected engine, actual capture/Stop/save/review, resource window and release identity. Uptime cannot fill human usefulness or phone acceptance.

Old user-count/resource estimates and latency/memory percentages were test assumptions, not an accepted clean-product SLO baseline. Select bounded load/criteria through the existing workflow/1383 contract; no capacity/SLA/current success is inferred from schedules or source.
