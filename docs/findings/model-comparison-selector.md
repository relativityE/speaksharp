# Production model comparison — F-11, Q-09

**Status: SCAFFOLD. No implementation exists on this branch yet.**

Branched from `main@1a5730cece35cf192893163e0f6ef091a7d54744`.

## Findings this branch is bounded to

- **F-11** — hidden CDP-only runtime model swap on canonical Production; all three candidates loadable; no customer-facing selector and no URL parameter
- **Q-09** — requested model identity equals observed identity, asserted before every take; a mismatch refuses the take

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

## Scope note — smaller than it looks

`candidateRegistry.ts`, `candidateSelection.ts`, `runtimeCandidateSwitch.ts` and
`private-stt.config.json` are already on `main`. Do not rebuild them. What is
missing is CDP-only exposure on normal canonical Production and the
requested-versus-observed identity assertion.

Gates named by the PM: M1 all three candidates loadable by runtime swap on the
deployed app; M2 requested == observed == expected asserted before each take,
with a mismatch refusing the take; M3 reachable only via CDP; M4 casualty — a
forced mismatch refuses the take; M5 Codex triaged.

**Release coupling:** this must merge in the same release candidate as #1421.
If it misses that deploy, F-17, Q-09 and the model half of F-13 need an entire
second deploy cycle.

## Closure rule

Merged is not release-closed. No finding on this branch is release-closed until
it is merged, deployed, and proven on canonical Production.
