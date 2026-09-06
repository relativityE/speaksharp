# Model down-selection evidence — F-17

**Status: SCAFFOLD. No implementation exists on this branch yet.**

Branched from `main@1a5730cece35cf192893163e0f6ef091a7d54744`.

## Findings this branch is bounded to

- **F-17** — the three-model comparison RESULT. Requires the Production test itself, not code.

## Why this file exists

A branch with no commits cannot carry a pull request, so this scaffold makes the
branch reviewable and records its scope before any code is written. It is not a
plan, a design, or a claim of progress.

## Blocking gap — read before starting work

The F/W/Q finding identifiers exist only in PM/PO correspondence. They appear
nowhere in this repository: not in the #1399 intake document, not in ledger
issue #1052, not in any issue, and not in the body of any merged pull request.

For the findings above, **no requirement text, severity, or acceptance
criterion is on record**. That means the definition of done cannot currently be
stated, so completion here can be neither asserted nor disputed.

**Required before implementation starts:** the PM supplies, per finding ID, the
exact requirement or failure being closed, its severity, and the evidence that
would prove it closed.

## HOLD — scaffold only

Per the directive this branch is a scaffold and **execution is held** until the
PO completes the Production three-model CDP comparison.

F-17 is the only finding of the 32 that cannot be closed by writing software:
it is a measurement, and the measurement needs every other lane deployed plus
all three models runtime-swappable on canonical Production
(`feat/model-comparison-selector`, F-11/Q-09).

Nothing should be committed here until those receipts exist. Committing an
anticipated result would be fabricating evidence.

## Closure rule

Merged is not release-closed. No finding on this branch is release-closed until
it is merged, deployed, and proven on canonical Production.
