# SpeakSharp Product Requirements

**Reconciled:** 2026-08-11.

## Product

SpeakSharp helps a person practice an important speaking moment privately, understand what happened, choose one useful improvement, and repeat.

It is one product with two practice modes:

1. **Open Mic** — speak without setting an agenda; receive delivery evidence and one next action.
2. **Focus Points** — declare the ideas that must land; see which were detected and what to retry.

“Detected / not detected” is evidence from a conservative matcher, not semantic certainty and never proof that a person failed to say something.

## Transcription

- Every customer practice uses **Private on-device transcription**.
- Free and Pro differ only in approved usage/coaching entitlements, never transcription privacy.
- No customer engine selector.
- No Browser or Cloud fallback.
- A Private failure fails closed with an honest retry/recovery path.
- The first use may require an approximately 80 MB local model setup with visible progress.
- A single Private take may run up to the current product cap; local finalization remains visibly in progress until terminal success or recoverable failure.

## Practice Loop

1. Choose Open Mic or Focus Points.
2. Optionally use a prompt/read-aloud helper.
3. Wait for the truthful “Ready — speak now” cue.
4. Record, stop, and finalize locally.
5. Save the exact session.
6. Review transcript and grounded evidence.
7. Receive one primary “Practice this next” action.
8. Repeat with the relevant intention preserved.
9. Reopen the exact session after hard reload.
10. See comparable progress across History/Progress/PDF.

## Privacy and retention

- Private speech audio is not uploaded to a Browser or Cloud transcription provider.
- Only the minimum data needed for an explicitly used server-backed feature may leave the device.
- Transcript text is retained for the newest two saved sessions; older transcript text and transcript-derived AI suggestions expire under the retention policy.
- Telemetry and support artifacts must not contain audio, transcript text, email, or raw user id.

## Commercial state

The controlled beta is free. No card or checkout is required. A paid offer is not activated until #1266 closes and the Product Owner separately authorizes activation.

## Release standard

The temporary integrity marker is not launch approval. A Flawless Launch means the deployed Private Practice Loop works without help on supported devices, public promises match runtime truth, recovery is honest, observability is sanitized, and operators have rehearsed GO/HOLD and rollback.
