# test: prove trial and paid entitlement boundaries

## Deliverable
Map and test current signup, full-feature one-month trial, expiry, paid subscription and explicit grant entitlement paths.

## Expected outcome
A valid trial retains full-feature access for its intended month, while expired or unauthorized access does not persist, and legitimate paid/grant access remains correct.

## Implementation and acceptance
Read exact effective function bodies, RLS, grants and Focus callers, inspect existing #1795 and #1817, reproduce surviving subscription-ID mutant with the loaded overload and raw results. Test trial and paid/grant states distinctly. Do not presume a subscription identifier is required during trial or impose constraints until model is verified. No production changes or live payments.

Status: draft scope only, no implementation or qualification claimed. Maintain one-writer boundaries; final code, tests, exact-head review and CI required before any merge. This document does not authorize a production action.
