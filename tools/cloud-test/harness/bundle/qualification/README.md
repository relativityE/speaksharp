# R0 qualification adapter — implemented source, not a qualification result

This directory ports the Consultant rev2 fixture suite to the repaired APIs. The original files remain unchanged under `original-rev2/`. All 78 literal original check IDs and their dynamically generated reconciliation checks are retained; new checks strengthen operation faults, negative status handling, private media and lifecycle cleanup. Do not reuse the historical 103/103 result as a rev3 result.

**No fixture server, certificate generation, SPKI exception, wrapper, browser, ownership transfer or product request was executed while preparing this adapter.** Only syntax checks and the eleven pure `offline-contracts.test.cjs` tests ran in the preparation executor. The required selected runtime remains the user's Claude SpeakSharp R4, not this executor and not an equivalently named Codex environment.

## Required inputs before an actual R0 invocation

- Authoritative external selection evidence for the intended R0, with its actual installed Node, Playwright, the Chromium revision expected by that installed Playwright, and Lighthouse versions recorded. Qualify and campaign-bind that same observed compatibility tuple; obsolete historical pins are not an admission requirement, and no silent alternate browser is selected.
- Explicit action-time owner approval for the separately described, ephemeral browser SPKI exception; no installed trust root, global bypass or environment security change. The current CODE manifest and fixed fixture hosts must be bound in that approval record. This file grants no approval.
- A current reviewed browser.json produced by the bound discovery workflow.
- An **already-existing**, approved, root-owned and safely traversable private media parent. The source does not authorize creating or changing that parent.
- A reviewed copy of `reviewed-steps.TEMPLATE.json`, retaining the actual source hashes and supplying the real reviewer and review time. The template's null review fields intentionally fail closed. Bind that copy's SHA256 independently. Review includes native Node APIs and dependencies: this is trusted code, not a Node/OS network sandbox.
- A fresh run-owned output directory that does not already exist. Budget the qualifier's 19-minute deadline plus cleanup inside the admission controller's 20-minute A6 envelope.

## Command contract

Prefer the single admission command; its A6 invokes this adapter. A separately authorized direct qualification uses the same source and inputs:

```sh
node "$BUNDLE/qualification/selftest.cjs" \
  --browser "$BROWSER_JSON" \
  --out "$FRESH_QUALIFICATION_OUT" \
  --security-approval "$BOUND_SECURITY_APPROVAL" \
  --private-media-parent "$EXISTING_APPROVED_PRIVATE_PARENT" \
  --lighthouse-cli "$LIGHTHOUSE_CLI" \
  --step-manifest "$REVIEWED_QUALIFICATION_MANIFEST" \
  --step-manifest-sha256 "$BOUND_QUALIFICATION_MANIFEST_SHA256"
```

The qualifier invokes the production supervisor and Lighthouse entrypoints using `--qualification-local-only true`; those entrypoints independently require a strict test-only fixed-host loopback policy and current approval. Only the circular requirement for an *already completed* qualification receipt is bypassed. Production admission and trusted-step review are not weakened.

## Additional proof over rev2

- Save faults bind exact JSON bytes and account/take/completion operation identity. The fixture fsyncs an idempotent durable row before responding. A separately counted guarded GET reads that file through an independently hash-reviewed pure oracle. The browser loses the response only after this readback, using the Consultant's fatal non-retryable network error mechanism.
- Model-download controls use an exact fixture GET with an 8192-byte known-length body sent in 512-byte chunks. They assert a zero-receipt pre-download failure, a 1024-byte delivered prefix followed by actual browser-context offline application and a stream error without implicit retry, explicit network restoration before Retry, one deliberate successful retry per fault, and an unfired 503 negative control. Independent fixture logs reconcile every receipt; these transport controls do not certify actual STT/model quality.
- A 503 completion response remains 503, is not suppressed, performs no readback, and creates no durable row.
- The fake microphone test inspects actual 65534-owned 0700 directory / 0600 file, receives the signal in sandboxed Chromium, verifies unchanged source bytes, and verifies cleanup on success, post-media launch failure, deadline and SIGTERM. The SIGKILL supervisor test preserves the original process-exit/reservation proof; it does **not** claim that a process can execute cleanup after SIGKILL. Any interrupted run requires review of retained private nodes rather than broad guessed deletion.
- Guard cancellation precedes browser shutdown. Fatal errors, qualifier signals, deadline and parent loss close tracked guards, browsers, children and fixture listeners. A PASS receipt is written only after shutdown/reaping checks and a final reviewed-code integrity check.

## Output contract

`qualification-receipt.json` carries the actual observed runtime tuple, current CODE manifest digest, invocation `startedAt`/`endedAt`, and all ten required control groups. Each group references an existing relative evidence file and its SHA256. Detailed `selftest-results.json`, guard logs and independent fixture access logs remain separate evidence. Any failed/absent check prevents PASS. Runtime output may contain private temporary TLS keys: exclude those keys from exported review artifacts.

Pure no-network verification of this adapter's oracle and static contracts:

```sh
node --test "$BUNDLE/qualification/offline-contracts.test.cjs"
```

A pure/static pass is not R0 admission, browser qualification, account access, product acceptance or permission to send traffic.
