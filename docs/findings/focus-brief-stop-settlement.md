# Forward fix — surviving #1416 P2

**Status: SCAFFOLD. No implementation exists on this branch yet.**

Branched from `main@1a5730cece35cf192893163e0f6ef091a7d54744`.

## Findings this branch is bounded to

Not one of the 32. This is a forward fix for a defect that survived #1416.

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

## What is known, and what is not

#1416 merged as `main@81a53d30`.

The directive names **one surviving P2** concerning focus-brief stop
settlement. Its exact statement is not recorded on #1416 or in its merge commit.

**Required before work starts:** the PM states the defect — what the user does,
what happens, and what should happen instead. The branch name suggests the
deferred product switch settled at stop (`switchDeferred` in `Navigation.tsx`),
but I will not guess at a P2's contents and then close it against my own guess.

## Closure rule

Merged is not release-closed. No finding on this branch is release-closed until
it is merged, deployed, and proven on canonical Production.
