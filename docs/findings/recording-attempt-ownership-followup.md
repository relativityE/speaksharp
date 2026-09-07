# Forward fix — surviving #1419 P1 lifecycle races

**Status: IMPLEMENTED LOCALLY. Awaiting exact-head CI and independent review.**

Implemented from `main@a97b740b39f678e8b5e8f769725e272d59428c64`.

## Findings this branch is bounded to

Not one of the 32. This is a forward fix for defects that survived #1419.

## Acceptance criteria

- If attempt A is suspended in `service.startTranscription()`, a hard reset
  advances the lifecycle, and B starts, A's eventual result cannot change B's
  runtime/store state, producer identity, service, or intent.
- A transition may enter `RECORDING` only when it names the current pending
  recording intent. Missing or foreign ownership changes no recording state and
  cannot start the shared-store session; the current owner still starts once.
- Every service error callback is bound to the service generation that received
  it. An error from a replaced service changes neither B during preparation nor
  B while recording, and cannot complete or destroy B's session.

## Implementation boundary

- `transition()` rejects a cancelled or obsolete lifecycle token before shared
  mutation and rejects `RECORDING` without current intent ownership.
- The real post-`startTranscription()` continuation rechecks lifecycle,
  recording id, and intent ownership before binding any recording state.
- A monotonic service generation is captured by each controller-owned error
  callback and invalidated when its service reference is detached.
- Production-shaped controller casualties exercise the real suspension,
  transition, reset, callback, and shared-store boundaries.

## Closure rule

Merged is not release-closed. No finding on this branch is release-closed until
it is merged, deployed, and proven on canonical Production.
