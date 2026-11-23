# Improvements

## Deliverables

One shared list of quality findings for J1–J9. Each entry records the expected action that completed, what was deficient in the result, and the expected improvement.

## Expected outcome

Track quality improvements without changing the 24/24 functional target. A row earns functional PASS only when the requested action completed as expected. A completed action can separately be marked **Needs improvement**. Keep original receipts and their verdicts unchanged.

## Confirmed quality improvements

### J1.a — Private STT hesitation recognition

- **Owner:** Private STT.
- **Completed action:** Real sign-up, active 30-day trial, first Open Mic take saved exactly once in the [retained diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45142628330/job/137584107038). This is functional evidence for those actions, not a change to the diagnostic's overall verdict.
- **Current finding:** Private STT misrecognized scripted hesitations. The earlier [live run](https://github.com/relativityE/speaksharp/actions/runs/45014809858) logged three scripted “uh” utterances recognized as “ah”; [#1940](https://github.com/relativityE/speaksharp/pull/1940) records the probe and findings.
- **Expected improvement goal:** Recognize “uh” and “ah” as spoken and keep displayed and saved filler counts consistent with the exact take, without dropping other legitimate speech.
- **Independent agreement:** The acceptance correction treats recognition quality separately from the completed sign-up, trial, and save actions.

## Pending independent classification

### J3.b — Coaching makes an inaccurate omission claim

- **Owner:** Focus Points / coaching.
- **Completed action:** The first take’s coaching rendered after Stop and its request was bound to the saved Focus session in the [live diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45144884602/job/137591599260). This describes coaching delivery, not a PASS for the whole journey.
- **Current finding:** The delivered coaching made an inaccurate retrospective omission claim; the separate coaching check failed in that same receipt.
- **Expected improvement goal:** Ground omission claims in the exact saved take and verified Focus outcome; don't assert an omission the evidence does not support.
- **Independent agreement:** Pending. Confirm the item is about the quality of delivered coaching, without relabeling any failed functional check.

### J3.b — Timeliness of markers that actually appear during recording

- **Owner:** Focus Points / Private STT.
- **Completed action:** The [live diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45144884602/job/137591599260) observed the first two markers change while recording. Point 3 did not: its after-Stop appearance is a separate **functional gap**, excluded from this list.
- **Current finding:** [#1964](https://github.com/relativityE/speaksharp/pull/1964) tracks the offline slow-device replay that observed about 6.4 seconds versus the existing five-second target. That is not a live timing result and does not establish that live point 3 completed during recording.
- **Expected improvement goal:** Make markers that do appear during recording consistently timely against the existing five-second target, without delaying Stop or finalization.
- **Independent agreement:** Pending. Classify latency as quality only where evidence shows the marker actually appeared during recording; an after-Stop-only marker remains a functional failure.

## Contribution template

Add new entries to this list only when another reviewer agrees the expected action completed and the concern is about quality. Otherwise record the candidate under Pending or route an incomplete action to its functional owner. Reuse this list rather than opening a second list.

- **Journey / owner:**
- **Current finding:**
- **Expected improvement goal:**
- **Linked evidence that the expected action completed:**
- **Linked quality evidence:**
- **Independent agreement:** Confirmed or pending, with a reference where available.
