# Verified executable entry points — Browser PM to Sam, @relativityE

Verified19 October2026 against protected main `c9d46b2d4ffef7530cb0cccaa533b5818d200320`, #1662 `c8dc89f06a2ac7d58706c4cb02a80e0dd0ebbab3`, #1667 `71934293c1079aafc8ebf1f6d4373f66d5482c06`, #1668 `9ce170db5113d45980908ee4bea334b48eb019a6`. No command below was dispatched. They are supported executor commands, not PM authority to run them. Reuses accepted package6269038601; no replacement forms.

## First actual batch: case15 alone, before20 October15:30UTC

The repository has a concrete runner: `.github/workflows/rc-gates.yml` diagnostic Gate3 invokes Playwright with one selected spec and optional grep. No tracked `scripts/rwt-campaign.mjs` exists; do not invent that command. The actual case15 title is:

`an existing user signs in and moves between Open Mic and Focus Points without opening the microphone`

Supported workflow invocation **only after Sam's release/fixture/window approval**, in an already authorized executor terminal:

```sh
# SELECTED_REF must resolve to Sam's selected full40-hex source SHA.
# Actual deployed/served SHA must equal it; no expected_sha workflow input exists.
gh workflow run rc-gates.yml --repo relativityE/speaksharp \
  --ref "$SELECTED_REF" \
  -f gate=gate-3-dast \
  -f base_url=https://speaksharp-public.vercel.app \
  -f diagnostic_dast_spec=tests/live/rwt-products-navigation.live.spec.ts \
  -f rwt_human_reflex_ms=500
```

The workflow sets EXPECTED_RELEASE_SHA from github.sha, runs target preflight and generic live-env preflight, and selects `playwright.deployed-live.config.ts`, project `deployed-live-chromium`. Diagnostic runs are expressly NOT full Gate3 passes. Do not dispatch gate=all or paid_launch=true for this bounded journey. Case15 filters out the disposable-write authorization gate and never creates/claims/deletes the maintained account; do not pass disposable-write or canary-claim ACKs just to make it look qualified.

**Verified fixture-routing restriction:** this workflow forwards vars.FREE_TEST_EMAIL + secrets.FREE_TEST_PASSWORD; it does not forward RWT_RETURNING_EMAIL/PASSWORD and exposes no credential-selector input. The spec supports `RWT_RETURNING_* || FREE_TEST_*`. Therefore the supplied workflow command can only use the configured FREE_TEST pair. Old completed-history counts for CANARY_TRIAL do not select it. If that pair remains expired, the command will reproduce the fixture HOLD. Sam must either confirm the already configured pair is the approved eligible account, or select the already-authorized local executor path below. No repository-secret/variable mutation, credential read or trial extension was performed or authorized here.

Existing local Playwright entry point for an operator whose approved environment already contains the selected RWT_RETURNING pair and live read capabilities:

```sh
# Run from a clean checkout of the exact Sam-selected source, using existing approved environment.
# Do not type/export credentials into logs. SELECTED_SHA and APPROVED_BASE_URL are non-secret bindings.
EXPECTED_RELEASE_SHA="$SELECTED_SHA" BASE_URL="$APPROVED_BASE_URL" \
  EVIDENCE_SCOPE=diagnostic VITE_USE_LIVE_DB=true \
  pnpm exec playwright test tests/live/rwt-products-navigation.live.spec.ts \
  --config=playwright.deployed-live.config.ts --project=deployed-live-chromium --reporter=line
```

Actual preconditions require approved origin exactly `https://speaksharp-public.vercel.app`, full40-hex expected SHA, SUPABASE_URL/service-role read capability, real sign-in pair and deployed identity. Generic workflow preflight additionally requires existing anon/Free/Pro/Stripe-test environment groups, even though case15 does not test billing. No alternate account or provider action is inferred. Local direct execution does not create a GitHub run ID: retain its real operator execution timestamp/log/receipt SHA and mark GitHub run binding unavailable; never forge GITHUB_RUN_ID. If Sam requires workflow-bound receipt identity, the local path is not an equivalent substitute and fixture routing is the explicit receiving dependency.

**Still missing to execute:** Sam-selected final release SHA/ref actually served after deployment HOLD; authenticated eligible fixture (can_start=true plus prior completed history and actual intended credential routing); exclusive use window; named authorized executor with existing required environment; explicit first-batch scope and retained-result destination. None is filled with an invented ID. Source/CI acceptance cannot replace served identity.

## Timing and latest start

Source case15 test body is capped300s. Historical job117829954812 ran181s including setup; that is one observed duration, not a reliable upper bound. Gate3 job budget45min includes environment setup plus body/finalization; queue delay is unbounded and a5min body limit does not bound the complete run. **A guaranteed latest dispatch time is unknown.** A conservative operational target is a runner already started by14:40UTC on20 October, reserving the45min job budget plus5min before15:30. This is conditional on no queue delay and current source timeouts; if the runner has not started, do not promise expiry compliance. Sam should take an earlier available approved slot; no entitlement extension assumed. Body cap alone suggests15:25 latest body start but leaves no setup/finalization margin and is unsuitable as a dispatch commitment.

## Smallest subsequent multi-case run

Once the qualified #1662 observer/finalizer delta is in the served candidate, the existing adverse spec is the smallest one-file batch advancing three unresolved automated cases12/13/14 (three tests, no new harness). Sam must explicitly authorize its existing disposable-account creation/claim/cleanup and model/provider scope; this document grants none:

```sh
gh workflow run rc-gates.yml --repo relativityE/speaksharp \
  --ref "$SELECTED_REF" -f gate=gate-3-dast \
  -f base_url=https://speaksharp-public.vercel.app \
  -f diagnostic_dast_spec=tests/live/rwt-adverse-mic-model.live.spec.ts \
  -f rwt_writes_ack=RWT-DISPOSABLE-ACCOUNT-WRITES \
  -f rwt_canary_claim_ack=RWT-CANARY-CLAIM-RUN-OWNED \
  -f rwt_human_reflex_ms=500
```

Each adverse test allows30min; all three serial tests can exceed the45min job budget. **Prefer the following three separately accounted single-test dispatches**, one at a time after Sam's between-case terminal/cleanup check, rather than promise all three fit in one job:

- Case13 `-f diagnostic_dast_grep='model download fails: Retry'`.
- Case14 `-f diagnostic_dast_grep='offline mid-download: Retry'`.
- Case12 `-f diagnostic_dast_grep='mic denied: stated truthfully'`.

Those grep prefixes match the actual test titles. This gives three specifically bounded attempts; historical cases13/14 recovery/save/noCloud/cleanup positives remain credited. Case12 same-account/fresh allowing-browser recovery does not establish original-page native Allow→Retry or settle the original historical account's cleanup. H5/H6 real native/phone observations remain separate from case15's no-write automation.

Next high-yield one-file boundary is abandon/two-tabs cases9/10/11, likewise three30min tests requiring separate grep jobs. Do not run case10 expecting closure until the approved fence/authority oracle is integrated; source c8dc still uses the known zero-active-row oracle. Case9 title prefix `navigate away mid-recording`; case10 `close the tab mid-recording`; case11 `one account, two places`. Source readiness for case4 is #1668, case2 is #1667, case1 is #1666, and case3's accepted observer is unwired. Each must be selected in the actually served candidate before their own dispatch. No ordering shortcut removes full useful Open Mic/Focus or human observations.

Command field names, titles,300s/1800s limits and credential routing were inspected in actual source. Example shell syntax is checked offline only; no gh workflow command or preflight touching live systems was executed. Retain run/job/attempt, exact source/served identity, selected account reference, request terminals and canonical receipt/worksheet/readback files for the actual operator run. The case15 no-write side-effect proof is not replaced by phone Stop/save.
