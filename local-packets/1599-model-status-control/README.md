# #1599 status-control correction

Parent/source: `764890c3f475825e8b2b194331522be6840f5e5c`.
Review: https://github.com/relativityE/speaksharp/pull/1599#issuecomment-6251940867

Only `Checks!A18` changes in the workbook. All27 expected checks must explicitly
be OK; `Key!C62` keeps its existing link. Every other OOXML package entry remains
byte-identical, including all assumptions, source data, styles, validation and
native features. No pricing, billing or release policy changes.

Source SHA256: `3c08c02b1820a4678eb894a358bf874fed69737e8f1ff7f5a7f323c1ab83f582`.
Corrected SHA256: `0be91eb36743ff3260b651fe03fff039b01c4cff140618ce5b9ad3ba89e17575`.

`edit.mjs` authors the formula with the bundled Artifact Tool. Its full export
normalizes unrelated style metadata; `preserve-package.py` transfers just the
authored formula into the original package. No openpyxl authoring of the delivered
workbook is used. The requested openpyxl round-trip is a disposable test control.

`verify-native.test.mjs` loads the immutable source from git and tests the checked-in
corrected workbook in LibreOffice, using fresh disposable output directories.
`native-receipts.json` records the actual hashes and20 native recalculations.
16 controls PASS: original false PASS versus corrected FAIL with text B33;
default restores PASS/1517 formulas/zero errors; blank/error/unrecognized/FAIL
check statuses cannot PASS; month/cap/trial negatives remain FAIL; $20/$40/Exclude
outputs and the save/recalculate round-trip remain unchanged. Numerical comparison
uses relative tolerance1e-8; nonnumeric results and statuses compare exactly.

Historical example (dependencies supplied by the spreadsheet runtime):
Portability correction: the archived host paths below are expressed using
`SPREADSHEET_RUNTIME` and a repository-relative path. Original executed bytes are
retained in commit `035eca75fe7c2df1417da770bf4b6fea4e7f3134`; the native receipts
are unchanged. The verifier is now retained as inert `verify-native-source.txt`,
not an executable test. This example is historical, not a command to run in CI.


```
node scripts/host-interlock.mjs hold local -- "$SPREADSHEET_RUNTIME/node/bin/node" --test local-packets/1599-model-status-control/verify-native.test.mjs
```

Before/after views were inspected. Artifact Tool's render-time recalculation of
this imported workbook can disagree with LibreOffice's verified status; final
visual QA therefore used native LibreOffice PDF captures of the two status views.
Those show PASS in both locations for the unchanged default inputs. Images remain
ephemeral outside git. Microsoft Excel was not independently tested.

This isolated evidence branch does not update the Consultant-owned #1599 branch
or create a competing PR. Apply the bounded workbook/review-note correction to
that existing PR only after ownership coordination. Current-main qualification
and any eventual landing remain separate.
