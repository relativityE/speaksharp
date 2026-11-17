# AHT coverage migration guard

This offline tool makes a proposed AHT redesign reviewable without changing the live suite.
It accounts for every original assertion and refuses accidental omissions, duplicate rows,
unsafe demotions and unqualified live-safety reductions. It is not a product test or a runner.

## Use

From repository root:

```sh
node --test tools/aht-rationalization/validate.test.mjs
node tools/aht-rationalization/validate.mjs tools/cloud-test/config/assertion-catalog.json tools/aht-rationalization/mapping.json
```

The first command tests the guard with a historical catalog fixture. The second checks
the mapping against the repository's actual catalog, so subsequent denominator changes
cannot silently disappear. Neither command writes data, launches a browser or contacts production.

## Mapping contract

- Each original case/assertion pair appears once.
- Every journey specifies its unique integration risk, isolation requirements and observable pass evidence.
- The proposed count is not enforced: changing grouping is allowed while preserving those obligations.
- `keep-safety` retains actual owner, Start-budget, private-network and page-closure observations.
- `fast-first-retain-live-until-proven` identifies candidate lower-layer tests, not completed replacement coverage.
  Some candidate files exist only on open PR branches. A path is not proof that a test exists on main or passed.
- `demote-with-reviewed-proof` requires a specific behavioral assertion, 40-character source SHA,
  baseline result, intended mutation failure and review reference. This guard checks structure, not the truth
  or freshness of those references. A reviewer must inspect their content and confirm equivalence.
- Billing and physical-device requirements are additive; their presence does not authorize mutations,
  payment, migration, deployment, live execution or human-proof claims.
- Current suite files, dispatch, cost limits and release qualification are untouched.

A consolidated account must retain per-leg identity, fault resets, failure/HOLD semantics,
resource finalization and independent cleanup readback. Do not manufacture a six/seven/ten-run
limit by dropping unique browser conditions. In particular, cold pending Start, document
destruction, independent-context takeover, actual permission denial, initial model-request
failure and offline interruption after received bytes remain distinct conditions.

The manifest is a proposal and the fixture is provenance, not current release posture.
Implementation dependencies and review state belong in the PR discussion, not this tool.
