# Model downselection evidence — F-17

**Status: executable pre-test contract; Production result intentionally pending.**

This increment does not select a model and contains no claimed real-world result. It makes the later
decision mechanically reviewable instead of asking a reviewer to trust a prose summary.

The checked-in template is
`product_release/evidence/human-test/model-downselection.template.json`. Populate a copy only from the
Product Owner's canonical-Production CDP run, then validate it with:

```bash
pnpm human-test:validate-downselection <evidence.json>
```

The validator holds unless all of these are present:

- both Open Mic and Focus Points for each of `v2:base.en`, `v4:distil:q4`, and
  `moonshine:streaming-medium`;
- a unique non-dry-run PASS receipt from the canonical Production origin, at one exact release, with
  expected, requested, and observed candidate identity equal;
- decoded PostHog `session_started` and non-empty `session_saved` events linked by the same release,
  observed candidate, journey id, attempt id, and attempt ordinal, plus one decoded transport positive
  control;
- the locked `gemini-3.6-flash` contract: no more than 10 uncached requests per user per UTC day,
  exactly one “what worked” and one “what to improve,” each at most six whitespace-delimited words,
  and a readable cached replay that makes no provider request;
- an explicit Product Owner decision assigning the three distinct roles `primary`, `fallback`, and
  `sitsOut`.

Missing rows, duplicate takes/receipts/events/quota ordinals, local or dry-run receipts, mismatched
identity, undecodable telemetry, changed Gemini policy, regenerated cache reads, and incomplete or
non-PO selection all produce `HOLD`.

The JSON Schema documents the wire shape. The JavaScript validator owns cross-record rules that JSON
Schema cannot express, including exact three-way role coverage, requested/observed equality, decoded
event correlation, uniqueness, and fresh-to-cached digest equality.
