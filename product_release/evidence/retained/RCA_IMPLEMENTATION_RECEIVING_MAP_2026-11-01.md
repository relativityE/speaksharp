# R5 RCA implementation receiving map

Frozen receiving checkpoint for the 12 journeys covered by
`ROOT_CAUSE_REMEDIATION_R5_2026-10-31.md`. This map records source composition only.
It does not replace a full live result and does not claim current 15/15 acceptance.

Receiving branch: `fix/all15-cases12-14-on-i4-20261101`

| Case | Received implementation | Verification still required for closure |
| --- | --- | --- |
| 01 | Fresh-fixture refusal and post-Stop evidence ordering are present from `316d53d8` and `3a4b7c0e`; the authenticated two-phase route is retained from the I4 base. | Exact provider-attempt binding, successful coaching response, owner-bound save/readback, and the complete live journey. |
| 02 | Focus evidence ordering is present; PCM frame-boundary, fanout, receipt-closure, and finalization controls are composed through `1f80b2af`, `92123018`, `28ddcc8b`, and `3dbe2dfb`. | Full fixture must finish with four covered UI points and four durable detected verdicts on the real route. |
| 03 | The same PCM/finalization boundary corrections are composed without merging the full and partial fixture verdicts. | Partial fixture must produce its independently pinned vector and negative controls on the real route. |
| 04 | Delayed-dialog handling remains from `6a298085`; Products hit-target and return diagnostics are received in `163070f8`. | Real visibility, dismissal readiness, navigation return, and complete live-case acceptance. |
| 07 | The goals-save product correction is present through merged main ancestry (`ac5272dc`); authenticated delivery/provider boundaries remain fail-closed. | Real goals save, feedback delivery, provider response, and owner/session-bound readback. Database or permission changes remain separately approval-gated. |
| 08 | The authenticated producer/reader route and account-role bindings are present in the I4 base; phase-specific sequential binding outputs are fixed in `163070f8`. | Execute both authenticated phases, prove private receipt provenance, durable return, and complete feedback journey. |
| 10 | Measured component accounting and cleanup are received through `af6104f6`, `72ede46b`, and `4dcedbe70`; the 98-row admission control is in `163070f8`. | Establish the complete observed request total and cumulative headroom, then finish the live journey without raising the cap speculatively. |
| 11 | Exact created-session takeover binding and its race controls are received in `2e5e8bef`. | Run the baseline/post-baseline controls and prove the exact session in the full live journey. |
| 12 | The product microphone-denied correction is present through merged ancestry (`8b2e7de6`); the 120-second Retry and recovery controls are received in `00e7dc8e`. | Prove blocked-microphone messaging, Retry readiness, three-action allocation, cleanup, and the complete live journey. |
| 13 | Approved per-case three-action admission, request binding, and consumer validation are composed in `6bba9a5c` and `5516c0c2`. | Broken/fixed/negative controls must pass, followed by the real recovery journey under the exact approved allocation. |
| 14 | Case-specific admission is composed; browser-correlated prefix receipt and missing/fired-without-receipt negatives are received in `d4f823ab`, `14cd1df8`, and `3c7a4bb0`. | Prove the independent browser prefix before offline mode, then complete the real recovery journey without making a model-quality claim. |
| 15 | Hosted-executor and current-state fail-closed guards are retained from the I4 base. | Bind the selected executor and pinned inputs, receive the durable full result, and complete the Products journey. |

## Receiving rule

An implementation row is not a passing journey. Closure requires its listed controls,
the full required live path, cleanup where applicable, and a result bound to one tested
release. Historical passes on different releases remain historical until the integrated
15-case campaign is complete.
