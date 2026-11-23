# Improvements

## Deliverables

One shared list of quality findings for J1–J9. Each entry records the expected action that completed, what was deficient in the result, and the expected improvement.

## Expected outcome

Track quality improvements without changing the 24/24 functional target. A row earns functional PASS only when the requested action completed as expected. A completed action can separately be marked **Needs improvement**. Keep original receipts and their verdicts unchanged.

## Confirmed quality improvements

### Q01 · J1.a — Private STT hesitation recognition

- **Owner:** Private STT.
- **Completed action:** Real sign-up, active 30-day trial, first Open Mic take saved exactly once in the [retained diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45142628330/job/137584107038). This is functional evidence for those actions, not a change to the diagnostic's overall verdict.
- **Current finding:** Private STT misrecognized scripted hesitations. The earlier [live run](https://github.com/relativityE/speaksharp/actions/runs/45014809858) logged three scripted “uh” utterances recognized as “ah”; [#1940](https://github.com/relativityE/speaksharp/pull/1940) records the probe and findings.
- **Expected improvement goal:** Recognize “uh” and “ah” as spoken and keep displayed and saved filler counts consistent with the exact take, without dropping other legitimate speech.
- **Independent agreement:** The acceptance correction treats recognition quality separately from the completed sign-up, trial, and save actions.

### Q02 · J3.b — Coaching makes an inaccurate omission claim

- **Owner:** Focus Points / coaching.
- **Completed action:** Two coaching phrases rendered after Stop without a click, the request named the exact saved Focus take, and both visible phrases matched the saved response in the [live diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45144884602/job/137591599260). This describes coaching delivery, not a PASS for the whole journey.
- **Current finding:** The delivered coaching made an unsupported retrospective omission claim (`past_claim`): a point not detected is not proof it was missed; the separate coaching check failed in that same receipt.
- **Expected improvement goal:** Ground omission claims in the exact saved take and verified Focus outcome; don't assert an omission the evidence does not support.
- **Independent agreement:** Confirmed by independent receipt inspection and the [contribution review](https://github.com/relativityE/speaksharp/pull/1965#issuecomment-7109133771). The omission check and overall diagnostic retain their original FAIL.

## Pending evidence or classification

### Q03 · J3.b — Timeliness of markers that actually appear during recording

- **Owner:** Focus Points / Private STT.
- **Completed action:** The [live diagnostic](https://github.com/relativityE/speaksharp/actions/runs/45144884602/job/137591599260) observed the first two markers change while recording. Point 3 did not: its after-Stop appearance is a separate **functional gap**, excluded from this list.
- **Current finding:** [#1964](https://github.com/relativityE/speaksharp/pull/1964) tracks the offline slow-device replay that observed about 6.4 seconds versus the existing five-second target. That is not a live timing result and does not establish that live point 3 completed during recording.
- **Expected improvement goal:** Make markers that do appear during recording consistently timely against the existing five-second target, without delaying Stop or finalization.
- **Independent agreement:** Pending. Classify latency as quality only where evidence shows the marker actually appeared during recording; an after-Stop-only marker remains a functional failure.

### Q04 · Gemini AI suggestions — HTTP 503 / provider too busy

- **Journey / owner:** Coaching-enabled journeys, exact affected leg pending; AI suggestions / Gemini integration owner, with journey owners to identify the matching receipt.
- **Current finding:** User-reported Gemini “too busy” / HTTP 503 during AI suggestions. The exact response code, run, attempt, affected leg and recovery outcome are not verified here. Do not infer HTTP 503 from a generic provider exception.
- **Expected improvement goal:** Handle temporary overload without losing the saved take or duplicating suggestions; if recovery is possible, deliver useful coaching for that exact take, otherwise show clear unavailability and a safe retry.
- **Evidence requested from owners:** Link the exact stage and receipt with a sanitized provider status, whether a useful suggestion ultimately rendered, and its saved-take binding. A recovered 503 with delivered coaching is quality degradation; if required coaching never arrives, also record the functional action failure or hold as the evidence warrants. Neither label implies PASS.
- **Independent agreement:** Pending matching evidence. This entry tracks the quality concern without assigning it to a specific run prematurely.

## 24-leg quality cross-reference

This index is not the acceptance tally. “None identified here” means no qualifying quality example has been inventoried in this document yet, not a clean result. “Not reached / unverified” means completion of the requested action has not been established for this quality review. Record a quality ID when an example is found; do not invent an item for each row.

| Leg | Quality finding or evidence status |
| --- | --- |
| J1.a | Q01 |
| J1.b | None identified here; Q04 is not attributed to this leg |
| J1.c | None identified here |
| J1.d | None identified here; disposable evidence is not live acceptance |
| J1.e | None identified here; disposable evidence is not live acceptance |
| J1.f | Deletion completion not reached / unverified |
| J2 | None identified here; test-mode evidence is not live acceptance |
| J3.a | None identified here; Q04 is not attributed to this leg |
| J3.b | Q02; Q03 conditional; after-Stop-only marker is a functional gap |
| J4.a | None identified here |
| J4.b | None identified here |
| J5.a | None identified here |
| J5.b | None identified here |
| J5.c | None identified here |
| J6 | None identified here |
| J7.a | None identified here |
| J7.b | None identified here |
| J7.c | None identified here |
| J7.d | Deletion completion not reached / unverified |
| J8.a | None identified here |
| J8.b | None identified here |
| J8.c | None identified here |
| J9.a | No quality finding identified; kept history, Progress, and billing portal not yet verified in Stripe test mode |
| J9.b | No quality finding identified; Stripe test-mode charge and restored access not yet run |

## Contribution template

Add new entries to this list only when another reviewer agrees the expected action completed and the concern is about quality. Otherwise record the candidate under Pending or route an incomplete action to its functional owner. Reuse this list rather than opening a second list.

- **Journey / owner:**
- **Current finding:**
- **Expected improvement goal:**
- **Linked evidence that the expected action completed:**
- **Linked quality evidence:**
- **Independent agreement:** Confirmed or pending, with a reference where available.
