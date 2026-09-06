# Forward fix — surviving #1419 P1 lifecycle races

**Status: SCAFFOLD. No implementation exists on this branch yet.**

Branched from `main@1a5730cece35cf192893163e0f6ef091a7d54744`.

## Findings this branch is bounded to

Not one of the 32. This is a forward fix for defects that survived #1419.

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

#1419 merged as `main@55912522` and established the token-owned-attempt
invariant: one Start activation owns one token-scoped attempt, and a stale,
failed, superseded or navigated-away attempt can never start, reset, settle,
unlock or relabel a newer one.

The directive names **three surviving P1 lifecycle races**. Their specifics are
not recorded on #1419, in its merge commit, or anywhere I can read.

**Required before work starts:** the PM identifies each of the three races —
the sequence that reproduces it and the observable user-visible symptom. Every
defect found in this area so far has been a CALL SITE declining to name its
token, never the `recordingIntent` module itself, which already refuses foreign
tokens; module-level tests are structurally incapable of catching that class,
so the reproduction sequence matters more than usual here.

## Closure rule

Merged is not release-closed. No finding on this branch is release-closed until
it is merged, deployed, and proven on canonical Production.
