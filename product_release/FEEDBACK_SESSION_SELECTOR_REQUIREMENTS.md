# Share feedback: optional session selection

Pre-RWT product requirement for the existing Share feedback dialog.

- Keep Share feedback available on every signed-in page for issues, ideas, and comments.
- Show an optional session picker with sessions saved during the current login, newest first.
- Label the newest choice `Current session (N)` and earlier choices `Session N-1` through `Session 1`; include product and local save time for recognition.
- Default to the newest saved session. If none exists, default to `No session`.
- Users may choose `No session` for general feedback; the Send action must remain available.
- Do not show internal session identifiers in the dialog.
- Verify the empty, one-session, multiple-session, logout/login, and explicit `No session` cases before RWT rehearsals.

The detailed design handoff is held outside this public repository. Implementation and qualification evidence must be added before the PR is marked ready. No merge or deployment is authorized by this draft.
