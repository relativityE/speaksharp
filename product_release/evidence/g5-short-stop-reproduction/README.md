# G5: short Stop requests completed persistence

Reproduction-only checkpoint. **Not a fix and not merge-ready.**

## Exact observed source and result

On `adc70cd23765f13c7a2c7ce04e6e80a30abb7009`, the actual
`SpeechRuntimeController.stopRecording()` receives an engine start time three
seconds earlier and meaningful transcript text. The storage-boundary spy observes:

```json
[{"status":"completed","duration":3}]
```

The assertion requires zero completed calls and fails: expected 0, received 1.
Engine and storage boundaries are mocked; the controller is real. This establishes
an incorrect completed-persistence request, not a production database write. It
does not establish the duration of AHT-03 run 43585559387's offending probe.

## Reproduce

Use the repository-pinned pnpm and installed lockfile dependencies, from repo root:

```sh
pnpm exec node scripts/host-interlock.mjs hold local -- pnpm exec vitest run --config product_release/evidence/g5-short-stop-reproduction/vitest.config.mjs
```

Expected on the source above: one failed test with `G5_COMPLETION` as above.
The standalone configuration intentionally does not run coverage: this is a
focused diagnostic, not a claim that full quality or release gates pass. No
production account, network service, model download or live AHT is required.
Fixture text is synthetic and inherited from the existing controller test harness.

## Why the normal hook test misses it

`useSessionLifecycle.ts:429–447` calls ordinary controller Stop for a take below
the five-second minimum, then reports discarded. Controller Stop measures duration
but only its empty/non-speech guard prevents completed persistence. The hook's
existing three-second test mocks the controller and asserts the displayed message.
The existing `fillerAfterFinalize` controller fixture passes 7/7; this diagnostic
uses that same boundary arrangement with a three-second start time.

## Implementation remains separate

No controller, hook, existing test, workflow or release file is changed here.
Exact-file ownership clearance is still required before implementing the fix or
adding the canonical regression. This evidence directory does not transfer that
ownership. Preserve the active release binding.

Next acceptance: real-controller rejection for nonempty 3s and 4.999s takes,
5s positive control, delayed-finalization independence, terminal cleanup and lease
release, and preservation of intentional external-stop behavior. Move the useful
assertions into the canonical suite with the fix after ownership is settled.
