# v4.7.7-candidate validation

537 Python tests pass (27.831 seconds). Focused coordination tests: 35 pass, including inherited communication coverage. The Node smoke executes the actual dashboard script and passes. Launcher Bash syntax passes.

A denied-process-group-cleanup reproduction on the original v4.7.6 package fails because the cleanup hold is not persisted after parent exit; identical reproduction passes on this candidate. Baseline/current runs also execute the 35 imported original regression tests, giving 35 pass + one failure versus 36 pass.

The first broad run exposed a stale version assertion; labels and that assertion were corrected before the successful final run. A separate integration regression exposed the health helper's handling of the board's dictionary-shaped agent inventory; both real mapping and list-shaped fixture cases now pass.

These are isolated/local test results. Actual installed Mac wake, account availability, event delivery and listener rearm acceptance are not proven. CLI PM owns installation and the receipt checklist in INSTALL.md; no PO command relay is required. Browser-chat inbound support remains unverified.
