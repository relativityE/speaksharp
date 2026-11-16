# Focus New Set / Edit: reproduction and acceptance

The reported failures are in Focus set management. No root cause or fix is claimed here. Keep this investigation separate from the cold-start Point 1 fix in #1861 and the Short Stop policy in #1880.

1. In the existing Focus browser journey or a local equivalent, reproduce New Set and Edit independently. Record the initial set, intended action, visible outcome, and whether the selected set and its points persist after reload. Use disposable test data only.
2. For any reproduced failure, add a regression that fails on the affected behavior before the fix. Assert the actual set identity and points, not just a visible button, navigation, a toast, or a mocked return value.
3. Fix the smallest responsible code path. Verify that creating a new set does not overwrite the prior one, and that editing changes only the selected set. Exercise save/reopen and discard/no-save when relevant to the reproduction.
4. This is a draft work brief, not proof. Keep the findings in the PR description and remove this temporary brief when the implementation and regression are present. Do not dispatch a live run from this draft.
