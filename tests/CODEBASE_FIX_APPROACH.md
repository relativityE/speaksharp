# Boundary-focused debugging

Owner:Engineering/Quality. Testing authority:[QUALITY](../product_release/QUALITY.md); scope and permissions:[AGENTS](../AGENTS.md). This is practical diagnostic guidance, not a release verdict.

Observe the exact failure, reproduce the responsible boundary, return a narrow owning-file correction, then confirm with the original counterexample and meaningful positive/negative controls. Record exact source/configuration, actual named assertions, failure and success artifacts, unavailable observations and limits. A passing isolated test does not mathematically prove permanent correctness, complete state-transition coverage or deployed behavior.

Mocked local E2E must use the registered test build/configuration and current service/handler payload shape. Read actual request/response fields rather than copying an old endpoint example. A signal/selector is evidence only for the documented boundary; use governed visible/route readiness and document/attempt identity when required. Trace output is incomplete unless its source/window/loss/settlement is observed; emitted is not independently received.

Use permitted isolated controls and the affected existing suite. No local diagnostic may mutate shared state, acquire models, access providers, provision accounts or run destructive cleanup without its separate authority. Keep private transcript/coaching/credential material out of public logs. Historical dumping-ground paths/40-test counts and unqualified internal-state dumps are not required current procedures. Source acceptance, full CI, deployment, actual received proof and human judgment remain distinct.
