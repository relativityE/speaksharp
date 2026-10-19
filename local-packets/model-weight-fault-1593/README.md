# Case 14: deterministic model-weight transport fault

Source baseline `ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4`. This isolated test/helper packet lets App replace the timing-based offline toggle with proof that a specific weight request actually failed. It does not change App's live spec or product source.

```text
node scripts/host-interlock.mjs hold local -- pnpm exec playwright test --config=tests/offline/playwright-model-fault.config.cjs --output=/private/tmp/cli-model-fault-results
```

Three Chromium tests PASS, retries zero:

1. The exact current self-hosted encoder-weight path is derived from `selfHostedAssetPins.json`. The browser fetch is intercepted and held without a response. Its page promise is explicitly still unsettled before injection. Only then does the helper abort that Request with `internetdisconnected`; the same Request emits `net::ERR_INTERNET_DISCONNECTED`, and the page observes fetch failure. After disposing the interceptor, a distinct retry of the same URL succeeds in the same page/context.
2. A model metadata request does not satisfy the exact weight match. The bounded hold wait returns false, injection refuses `model_fault_not_exercised`, and exercised remains false.
3. A separately aborted lease-confirmation request produces a real network failure but never matches the held weight or qualifies as an exercised model fault.

The fixture serves four synthetic bytes from localhost, not real ONNX weights. These checks establish interception, request identity, fault delivery and transport retry only. They do not run the model, test actual application Retry/save, prove partial weight bytes were transferred, or explain the historical case14 timing. No Production account, model download, provider or live RWT dispatch was used.

## App integration boundary

`tests/live/helpers/rwtHeldModelWeight.ts` returns `waitUntilHeld`, `inject`, `evidence`, and `dispose`. Install it before the download action, with the served candidate's exact weight origin/path. Require a successful bounded hold observation before injection. A warm cache, different asset path, missing request, missing failure event or timeout is unexercised/unqualified; do not catch it and continue as if the fault ran. Failure correlation uses the exact Request object, not a broad `/models/` count or an unrelated offline RPC failure. Dispose the scoped interceptor before application Retry, then separately assert the application's model/error/Retry state and real recovery. App owns those integration changes and full campaign qualification.
