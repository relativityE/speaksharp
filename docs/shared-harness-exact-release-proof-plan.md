# Shared harness / exact-release proof

The shared harness only admits the originally inspected `5a7bf6a1` source. The observed deployment `446e09fa` is not a compatible substitute merely because its SHA is known: the comparison recorded 103 refusals (55 changed paths, 46 new inputs, two unresolved imports). This draft stages the implementation and acceptance plan only; it does not change the sealed adapter or register a live result.

## Implementation plan

1. **Freeze the candidate and reproduce the refusal.** Choose one named candidate and target URL. Record the independently observed served SHA, trusted workflow SHA and current seal. Reproduce the old-pin refusal offline without test-account or provider writes.
2. **Review the affected inputs.** Use #1876 to compare the candidate's dependency graph and file bytes with the sealed inspection. Review the changed, added or removed inputs that the intended adapter relies on; refuse anything unresolved rather than bulk re-pin.
3. **Bind release identity before side effects.** Read the served SHA independently, verify it against the exact configured source and use the same identity for admission and evidence. Missing, ambiguous, moved or split identity must stop before signup, recording, dispatch or other writes.
4. **Bind the compatibility check to trusted bytes.** Integrate the #1876 verdict at the shared preflight, not as a caller-provided boolean. The trust boundary must bind the revalidator, graph deriver, manifest and their runtime dependencies to reviewed bytes; a bare import from outside the current seal is not sufficient.
5. **Keep the existing gates.** Preserve the original vetted release path, per-case limits and cleanup ownership. Do not treat a successful binding as a product assertion, enable J1.d or J8, or revive retired cases.
6. **Prove the guarded J4.a route end to end offline.** Connect only the pilot path to the existing runner admission, guarded account creation and cleanup/residue verification. Show the actual harness entry point cannot write before admission, cannot retry an ambiguous create, and cannot report acceptance without run-owned cleanup. If the route or prior residue cannot be resolved, keep the live pilot blocked; do not clean up a different run in this PR.
7. **Add passing and failing controls.** Prove the vetted baseline and an actually reviewed compatible candidate can admit. Prove changed or unreadable files, added/removed dependencies, forged verdicts, and release drift cannot admit or trigger writes.
8. **Review and verify the seal.** Inspect the exact adapter and trusted inputs independently, regenerate only the affected seal from reviewed bytes, run the harness verifier and relevant regression tests, then qualify the exact PR head through the protected merge.
9. **Prepare bounded J4.a proof.** Against the named served build, record the save/reopen evidence still missing, account and write bounds, cleanup read-back, and stop conditions. After separate approval, run only that proof and record PASS, FAIL, HOLD or NOT RUN as observed. Leave full J1–J9 qualification open.

## J4.a supervised entry point

A JavaScript callback in the parent is not the execution path. The sealed `campaign-runner.cjs` starts the separate supervised `run-guarded.cjs` process and currently forwards only the numeric case allowance from the options. The child verifies and loads its sealed driver, and the parent receives case and process-cleanup receipts. Neither boundary currently carries the nightly reservation contract or structured server cleanup.

1. At the parent, bind the proposed J4.a route to the exact run, case, attempt, plan/config hashes and served SHA already used by the runtime-start receipt. Keep the existing supervision and browser/network guards.
2. At the supervised child, expose only the reviewed, narrowly scoped J4.a capability. Charge the existing nightly budget and record the guarded signup attempt before the corresponding operation. Browser observation after a request is not a reservation. No fallback to the ordinary unbound path.
3. Return the server cleanup observation for the same run and case through the supervised boundary. The parent checks the binding and the confirmed guarded signup, rather than accepting a claim from the driver or trusting the browser/process-cleanup receipt.
4. Prove with fake transport through both ends of the actual supervised invocation: absent or mismatched binding sends nothing, no replay after an ambiguous signup, a wrong account cannot clear the run, and interrupted cleanup cannot convert a prior observation into PASS. No live run until this proof and the release binding are reviewed.

## J4.a cleanup contract

The draft source adapter closes its own pages and contexts; it does not delete the account or check server residue. The case runner's browser/process cleanup receipt is not server cleanup evidence. At the protected owner-cleanup boundary, reuse structured results from the existing auth deletion readback and counted session and recording-lease queries where the real route can call that implementation. Keep its other table checks. Do not infer server cleanup from a browser stop, a text verdict, an account-only query, or the absence of a recorded take.

The runner must bind observed account, session and lease results to the confirmed run-owned account from the guarded signup attempt. Verify that the zero counts are post-cleanup and for that exact scope. A missing or different scope, a missing query, a nonzero count for an unrecorded take, or an incomplete ownership link prevents acceptance and keeps next-run admission held. Test those cases through the actual entry point with fake transport; the current stubs alone do not establish this behavior. Report only content-free outcomes in retained evidence.

## Existing records

- #1883 is already merged. Its harness-pin comment tracks this dependency. The fix does not activate or prove J1.d.
- #1796 is already merged. Attach qualifying evidence to its acceptance ledger through the existing release record; this work does not by itself complete the ledger.
- #1817 is the roadmap reconciliation. Reference this PR there for the shared-harness finding when that reconciliation is authorized; this work does not close unrelated findings.
- #1876 supplies the compatibility check. #1874 keeps diagnostics separate from acceptance.

No live dispatch, deployment, production migration, payment activation, or J1.d/J8 enablement is authorized by this draft.