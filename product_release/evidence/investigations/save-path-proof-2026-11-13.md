# test: prove current session save and recovery path

## Deliverable
Tests exercising the real client write and current database completion path, including metrics, write failure, partial completion and recovery.

## Expected outcome
A session-save regression or lost metrics fails a reproducible test before merge.

## Implementation and acceptance
First inventory current proofs and exact latest migration. Design tests at actual client and database boundaries; a fake-client test alone is not persistence proof. Demonstrate negative controls, failed and fixed results, and ordinary successful save. Respect ownership, avoid production writes. Existing AHT live proof is separate.

Status: draft scope only, no implementation or qualification claimed. Maintain one-writer boundaries; final code, tests, exact-head review and CI required before any merge. This document does not authorize a production action.
