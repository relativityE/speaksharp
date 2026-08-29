> Archived historical STT reviewer report.
> Current STT release positioning lives in `../../RELEASE_STATUS.md`.

# Native Browser STT Second-Opinion Report

**Date:** 2026-05-26  
**Question:** Should Native Browser STT be positioned as browser-dependent convenience STT rather than corpus-grade benchmark STT?

## Executive Summary

Native Browser STT should be positioned as:

```text
Browser transcription uses your browser's built-in speech recognition. Chrome is recommended. Availability and accuracy vary by browser.
```

The evidence supports one product claim: Chrome human-mic Native Browser STT can complete the user journey: record, show transcript, save, open history/detail, and show analytics. The evidence does not support using Native Browser STT as a corpus-grade Harvard/WER benchmark engine, because the browser Web Speech recognizer is not an app-controlled STT engine and does not reliably consume the same fixture/fake-audio route used for Private and Cloud validation.

## Observations

1. Private and Cloud STT are benchmarkable because SpeakSharp controls the audio frames sent to the engine/provider.
2. Native Browser STT uses the browser's `SpeechRecognition` implementation. SpeakSharp can configure and observe it, but cannot pass arbitrary PCM/audio buffers into it.
3. Chrome human mic evidence showed Native can function as a convenience path.
4. Chrome fake-device evidence showed Native can fire Web Speech events while producing the wrong or insufficient transcript for the selected Harvard fixture.
5. Edge is currently configured like Chrome, but Chrome proof is not Edge proof.

## Log And Artifact Evidence

The release inventory records the May 25 Native regression result:

```text
continuous=false heard audio/speech but emitted zero results and multiple VAD truncation drops;
continuous=true emitted interim/final results and completed save/history/analytics.
```

Source: `product_release/RC_TEST_INVENTORY.md`.

The same inventory records the current fake-device probe:

```text
Chrome Native Web Speech with --use-file-for-fake-audio-capture=tests/fixtures/stt-isomorphic/audio/h1_1.wav
Web Speech events fired, but transcript was `this one still has a bit next`,
not the expected `stale smell old beer lingers`.
Native fake-device WER is diagnostic only until a probe proves the selected fixture audio reaches Web Speech.
```

This means the fake-device Native route is not currently valid WER evidence.

## Relevant Code Evidence

Native benchmark tests still use Chrome fake audio:

```ts
test.use({
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`,
    ]
  }
});
```

Source: `tests/live/benchmark-native.live.spec.ts`.

The Native browser strategy now configures Chrome and Edge for dictation-style recognition:

```ts
const DICTATION_WEB_SPEECH_CONFIG: WebSpeechConfigLayer = {
  continuous: true,
};

const CHROME_WEB_SPEECH_CONFIG = composeWebSpeechConfig(DICTATION_WEB_SPEECH_CONFIG);
const EDGE_WEB_SPEECH_CONFIG = composeWebSpeechConfig(DICTATION_WEB_SPEECH_CONFIG);
```

Source: `frontend/src/services/transcription/modes/nativeBrowserStrategies.ts`.

The release inventory explicitly warns that Edge is not proven by Chrome:

```text
Edge support is not counted as proven by Chrome evidence.
Until an Edge proof is captured, tester/UI copy must prefer `Chrome recommended`
or equivalent browser-dependent wording rather than implying Edge parity.
```

Source: `product_release/RC_TEST_INVENTORY.md`.

## Problem Statement For Review

Native Browser STT is not an STT engine in the same category as Private or Cloud. It is an integration with a browser-controlled Web Speech implementation. The browser decides recognition model, VAD behavior, buffering, finalization timing, network/service behavior, and support level. SpeakSharp receives events and transcripts after the browser service decides to emit them.

The result is that a Harvard fixture can be valid for Private/Cloud while not being valid for Native if routed through fake device, `afplay`, speakers, or synthetic voices. A poor Native WER result over that route may indicate a route/browser limitation rather than a SpeakSharp transcription bug.

## Recommended Product Position

Use Native Browser STT as:

```text
Browser-dependent convenience transcription.
```

Do not use it as:

```text
Corpus-grade benchmark transcription.
```

## Recommended Release Gates

| Gate | Native Requirement | Counted Claim |
|---|---|---|
| Chrome human mic journey | Start, transcript, stop/save, history/detail, analytics | Native works as a Chrome convenience path |
| Native fake-audio probe | Diagnostic only unless fixture route is independently proven | Finds route or browser regressions, not WER truth |
| Native Harvard/WER | Not RC-counted by default | Do not compare as benchmark-grade evidence |
| Edge proof | Required before claiming Edge support | Edge is supported only after Edge-specific evidence |

## Edge Wording

Until Edge proof passes, tester and product copy should say:

```text
Browser transcription uses your browser's built-in speech recognition. Chrome is recommended. Availability and accuracy vary by browser.
```

If an Edge proof later passes start, transcript, save, history/detail, and analytics, the copy can be changed to include Edge explicitly.

## Current Open Follow-Ups

1. Run the human tester protocol against the current production build.
2. Confirm Basic account state after the live Gate 3 `pro-badge` failure.
3. Run Edge proof or keep `Chrome recommended` wording.
4. Keep Private and Cloud as the corpus/WER benchmark engines.
5. Treat Native Harvard/fake-audio results as diagnostic until a standalone Web Speech fixture route is proven reliable.
