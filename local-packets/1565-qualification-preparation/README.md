# Browser PM qualification/readiness preparation handoff

**Preparation delivered; model and whole-release acceptance not established.** No model inference, asset/data download, provider call, live campaign, account operation, merge or migration performed.

Start with [the single decision packet](DECISION_PACKET.md): proposed relative and absolute quality/performance limits, device cells, statistical/multiplicity/adequacy rules, explicit zero-reference handling, full execution order and only genuinely missing authority. Numeric proposals are UNAPPROVED and are not an added v2 MVP gate.

- [Freeze and required-slice readiness](FREEZE_AND_SLICES.md), [all600 digest-linked reference rows](reference-annotation-ledger.json), [240 reserved admission slots—not recordings](supplemental-admission-reservations.json).
- [Blind rubric/calibration preparation](BLIND_CALIBRATION.md), [24 development control specifications](calibration-control-register.json), [48 blank assessor rows](blind-rating-worksheet.csv).
- [Actual existing-detector/normalizer controls](filler-diagnostic-controls.json), [executable source](diagnose_filler_counts.ts), [script spans/acoustic limitation](diagnostic-reference-annotation.json).
- [Zero-reference and other statistical negative-control specification](statistical-control-contract.json). This is NOT a second comparator or a claim those integration controls have executed.
- [Existing15-case, #1318 privacy/readiness, nine #1261 caller rows and six human/device procedures](RWT_READINESS_RECONCILIATION.md). Accepted fixes stay accepted; later diagnostics are not relabelled NOT RUN.
- [Preparation validation](preparation-validation.json), [reproducible metadata/worksheet generator](generate_preparation.py).

Executed locally on actual source HEAD31ab9a5f507b2ee91cd648065f4ef491884a49af, with unchanged input manifest verified against Git HEAD:
- generator:600 unique rows/73speakers/10,756 whitespace reference words,107 text-only marker candidates,0 literal um/uh;24 control specs/48 blank assessor rows;240 reserved IDs, no recordings manufactured.
- actual existing detector/normalizer controls:10 PASS. First probe used historical norm_v1 by mistake; after inspecting the real benchmarkScore→wordErrorRate call, the probe explicitly checks official Track A and retains the distinction. Product source was unchanged.
- Full model, acoustic annotation, blind human ratings, baseline adequacy, device measurements and integrated-runner qualification were NOT executed.
- Slack diagnostic message posted and was read back: https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792388264060589 ; CLI's05:46 acknowledgment was read in the existing mandate thread1792367917.368209. This closes source-diagnosis delivery, not acoustic-cause attribution.
- Active-work evidence checkpoint: https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792388771881339 .

Remaining work has exact homes: CLI integrated single evaluator and latest Research export; actual audio/annotations/custodian/device/rater evidence; Sam/PO one frozen policy decision; App release/product execution; physical observers. Source preparation does not silently authorize any protected operation. All old failed Slack attempts remain unexecuted; successful new posts do not retrospectively deliver them.

