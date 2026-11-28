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

## 24-row functional and quality cross-reference

Target: **24/24 verified functional passes**. Current working board: **14/24**, including the existing scoped J3.a provider exception and historical disposable/test-mode receipts. This table does not replace or rewrite original test receipts. A row that did not complete, or has no qualifying evidence of completion, remains open even if it also has an output-quality finding. “None identified” is not proof that the output was flawless.

| Row | Functional disposition and evidence | Quality finding |
| --- | --- | --- |
| J1.a | PASS: signup, 30-day trial and first take saved once [receipt](https://github.com/relativityE/speaksharp/actions/runs/45142628330/job/137584107038) | Q01, confirmed |
| J1.b | HOLD: saved coaching for the right interrupted take was not witnessed in the required window [receipt](https://github.com/relativityE/speaksharp/actions/runs/45142628330/job/137584107038), [proof fix #1961](https://github.com/relativityE/speaksharp/pull/1961) | None identified; Q04 is not attributed to this row |
| J1.c | PASS: short Stop saved nothing [receipt](https://github.com/relativityE/speaksharp/actions/runs/45142628330/job/137584107038) | None identified |
| J1.d | Historical disposable-stack PASS, not a new production pass | None identified |
| J1.e | Historical disposable-stack PASS, not a new production pass | None identified |
| J1.f | NOT RUN for completion proof: deleting from the trial wall is still unverified [proof PR #1953](https://github.com/relativityE/speaksharp/pull/1953) | None identified |
| J2 | PASS on disposable stack in Stripe test mode [receipt](https://github.com/relativityE/speaksharp/actions/runs/45070822108) | None identified |
| J3.a | Scoped PASS carried on the board under the prior provider exception; not proof that coaching delivery passed [diagnostic](https://github.com/relativityE/speaksharp/actions/runs/44939946343) | Q04 not attributed without an exact 503 |
| J3.b | FAIL: only two of three expected markers appeared while recording; point 3 appeared only after Stop [receipt](https://github.com/relativityE/speaksharp/actions/runs/45144884602/job/137591599260) | Q02 confirmed for delivered coaching; Q03 pending live timing evidence. Neither excuses the missed live mark. |
| J4.a | Historical PASS on the journey board | None identified |
| J4.b | Historical PASS on the journey board | None identified |
| J5.a | Historical live PASS on the journey board | None identified |
| J5.b | Historical live PASS on the journey board | None identified |
| J5.c | Historical live PASS on the journey board | None identified |
| J6 | Historical live PASS on the journey board | None identified |
| J7.a | Historical live PASS on the journey board | None identified |
| J7.b | Historical live PASS on the journey board | None identified |
| J7.c | NOT RUN: [runner setup timed out](https://github.com/relativityE/speaksharp/actions/runs/45190395937/job/137746917020) before the requested mid-download interruption | None identified |
| J7.d | NOT RUN for completion proof: deleting from Account is still unverified [proof PR #1953](https://github.com/relativityE/speaksharp/pull/1953) | None identified |
| J8.a | NOT RUN on the required route: feedback before any take; [PR CI](https://github.com/relativityE/speaksharp/actions/runs/45190550292) is not a journey result | None identified |
| J8.b | NOT RUN on the required route: feedback on an older take and its coaching; [PR CI](https://github.com/relativityE/speaksharp/actions/runs/45190550292) is not a journey result | None identified |
| J8.c | NOT RUN on the required route: choose No session with takes listed; [PR CI](https://github.com/relativityE/speaksharp/actions/runs/45190550292) is not a journey result | None identified |
| J9.a | NOT RUN: kept history, Progress and billing portal not yet verified on the planned Stripe test-mode route [#1958](https://github.com/relativityE/speaksharp/pull/1958) | None identified |
| J9.b | NOT RUN: one Stripe test-mode charge and restored access not yet verified [#1937](https://github.com/relativityE/speaksharp/pull/1937) | None identified |

## Contribution template

Add new entries to this list only when another reviewer agrees the expected action completed and the concern is about quality. Otherwise record the candidate under Pending or route an incomplete action to its functional owner. Reuse this list rather than opening a second list.

- **Journey / owner:**
- **Current finding:**
- **Expected improvement goal:**
- **Linked evidence that the expected action completed:**
- **Linked quality evidence:**
- **Independent agreement:** Confirmed or pending, with a reference where available.
