# #1593 first-case bootstrap and successor guard contract

Local review packet, 18 October 2026. Base: `52623c6bc6f065fdf43633ed99d48b7b643e63e6`.
Owner: Browser PM; operational helper/integration owner: App Dev; decision owner: Sam/PO.

This packet proposes the missing first-case branch of App's read-only pre-dispatch
guard. It neither edits nor validates App's actual helper. `contract.mjs` is a pure
decision-table reference with synthetic fixtures. It performs no I/O, dispatch,
account operation, provider call, cleanup, receipt creation or authority issuance.

Sources:
- [Selected campaign packet](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6243324870),
  [Sam's revision-2 acceptance](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6243794406),
  [App's case maxima/read-only confirmation](https://github.com/relativityE/speaksharp/issues/1593#issuecomment-6243875268).
- [Fallback assignment and ownership](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792309625258829).
- [App's existing guard/dry-run report](https://speaksharp.slack.com/archives/C0C9RE8KNHG/p1792309334673849).

## Resolve the first-case deadlock without inventing a receipt

Case 1 has no predecessor **in this newly authorized campaign**. Requiring a prior
case cleanup receipt on the future accepted/served release S makes a genuinely new
campaign impossible to start. The former save/retry receipts on `5f5f465a` remain
dated evidence of their own runs; do not rewrite their release, replay those tasks,
or manufacture a `RUN_OWNED_CLEANUP` marker for a nonexistent case 0.

Use two explicit modes:

| Mode | Required evidence | Never substitutes for |
|---|---|---|
| Case 1: campaign-start preflight | Explicit first dispatch within an authorized new campaign; exact S/config; fresh common checks; complete attempt ledger empty; all known earlier cleanup reconciled with actual provenance | A run-owned cleanup receipt or permission to replay an uncertain attempt |
| Cases 2–15: actual predecessor | The immediately preceding case's actual terminal reviewed run/attempt/artifact on S and its run-owned zero-residue cleanup; exact complete case prefix | A bootstrap assertion, an unrelated successful run, or an earlier release's receipt |

The bootstrap record is named `campaign_start_preflight`, not `run_owned_cleanup`.
It records `previousReceipt: null`, the selected campaign identity, S/config,
authority source, observation time/freshness, and references to the actual
attempt/cleanup reconciliation. It does not claim cleanup occurred on S before
case 1. If earlier activity or cleanup is unknown, hold and diagnose; an empty
local array by itself is not proof that no remote attempt exists.

Old cleanup evidence can satisfy reconciliation of its own historical run when
the operator has verified its scope and no unresolved residue/attempt remains.
It cannot become the new campaign's predecessor or establish current release
identity. No new unbounded production scan or historical task replay is proposed.

## Common checks apply before every case, including zero-request cases

1. Bind actual selected main, served frontend and workflow revision to S, plus
   the approved effective configuration/deployment identities. A digest here is
   shorthand for the approved configuration record, never a substitute for
   reading it. Observe main/release/RC/production activity; unknown or overlap holds.
2. Verify still-valid, task-bound campaign authority, scope and selected budget.
   Merge, migration, deployment, provider/account writes, permanent run-owned
   cleanup, canary claim and human acceptance remain distinct decisions. This
   local packet supplies none of those permissions.
3. Verify a complete actual ledger for this campaign, with no in-flight or
   unresolved attempt/cleanup. Before case n there are exactly n−1 finalized cases,
   ordered 1…n−1; each has unique run/attempt provenance, S/config, artifact identity,
   mandatory readbacks and actual request counts. Unknown cost/count holds.
4. Each predecessor cleanup must be verified, scoped only to that run's disposable
   identifiers, and return numeric zero residue. An attempted cleanup, green job,
   string `"0"`, partial owner scope or another run's cleanup is insufficient.
   Bind provenance using the actual workflow run/attempt/artifact and receipt
   release. Do not pretend the raw content-free cleanup marker itself contains
   all those fields.
5. Before starting the case, check **U + M ≤ B**, where U is the actual cumulative
   browser request count and M is that case's maximum. B is at most the selected
   30; 90 is only the packet's theoretical provider-attempt ceiling. This reference
   calculates M×3, not observed provider usage or a server admission lock.
6. A dominant stop (identity, privacy, authority, cleanup, outage/unknown cost or
   other selected stop rule) prevents continuation. Ordinary product FAIL/HOLD
   can continue only after explicit review/continuation disposition with all
   mandatory evidence and cleanup complete. No blanket green requirement replaces
   that distinction, and non-gating signup `RECEIVED` is not promoted to a gate.

Keep the selected serial execution, workers=1, retries=0 and reflex interval 500ms.
Preserve full useful Open Mic and **both full and partial Focus**. Six separate
human/device worksheet rows remain acceptance work, not additional implicit
authorization or proof supplied by these tests.

## Case maxima and effect scope

| Case | Selected case | Maximum browser requests |
|---|---|---:|
| 1 | Open Mic | 4 |
| 2 | Full Focus | 7 |
| 3 | Partial Focus | 4 |
| 4 | Pending | 0 |
| 5–6 | Save cases | 2 each |
| 7–8 | Feedback cases | 2, 0 |
| 9–11 | Abandon cases | 2 each |
| 12–14 | Adverse cases | 1 each |
| 15 | Returning maintained account | 0 |

Total: 15 cases / 9 groups / maximum 30 browser requests. Cases 1–14 use
the selected disposable scope and require both literal acknowledgements:
`RWT-DISPOSABLE-ACCOUNT-WRITES` and `RWT-CANARY-CLAIM-RUN-OWNED`, plus explicit
run-owned creation/claim/permanent-cleanup authority. Case 15 uses the separate
maintained-account read-only command with **both acknowledgements absent** (empty
normalized strings); it still needs case 14's actual receipt and all common checks.
At U=B=30, M=0 may proceed only if those other checks pass.

## Executable matrix

Run locally with Node's built-in runner:

```sh
node --test local-packets/1593-bootstrap/contract.test.mjs
```

| Boundary | Positive/negative assertions in `contract.test.mjs` |
|---|---|
| Fresh case 1 | Explicit bootstrap and null predecessor eligible; no input mutation or receipt creation |
| Historical cleanup | Old release remains old provenance; unresolved cleanup holds |
| Successor chain | Every case 2–15 accepts its actual finalized predecessor; missing/substituted run, attempt, digest, campaign or release holds |
| Ordered prefix | Skipped/out-of-order case, duplicate run/attempt, case-1 replay and reused bootstrap hold |
| Authority/freshness | Missing/unverified/expired authority, over-budget scope, missing write/claim/cleanup scope, stale/future observations hold |
| Release/config/activity | Main/served/workflow/config drift; busy main/RC or unknown production activity hold |
| Receipt/readback/cleanup | Nonterminal, unreviewed, missing mandatory readback, dominant stop, unknown/excess requests, wrong cleanup owner/run/attempt/scope or nonzero/untyped residue hold |
| Budget admission | Used 4 + next maximum 7 holds at B=10 and fits at B=11; complete prefix totals 30 |
| Ordinary result | Reviewed FAIL can continue only with explicit disposition and complete mandatory evidence/cleanup |
| Maintained account | Case 15 at exhausted budget eligible read-only; write/claim acknowledgements, absent read-only scope or RC overlap hold |
| Malformed input | Null, missing and out-of-range evidence never eligible |

## Adapter obligations and acceptance handoff

All `verified` fields and stop classifications are **normalized facts supplied by
an independently verified evidence adapter/operator**, not signatures verified by
this module. Test fixtures intentionally assert them. The operational integration
must authenticate authority and run/artifact sources, establish ledger completeness,
classify selected stop rules, bind actual configuration/Edge identities and perform
the real scoped readbacks. This reference cannot establish any of that.

App Dev's helper acceptance should demonstrate: (a) its actual fresh case-1 path
accepts explicit new-campaign evidence without an invented predecessor; (b) actual
case-2…15 paths reject substituted or missing predecessor evidence; (c) historical
5f5f cleanup stays historical; (d) unknown/interrupted attempts and missing cleanup
hold; (e) release/config/activity/authority/budget/read-only checks still hold.
These are integration acceptance criteria, not a request for new live runs.

Sam reviews this local contract; App owns any selected helper change. Recheck the
real guard immediately before each separately authorized dispatch. This pure
preflight creates no reservation or concurrency lock and cannot remove the gap
between observation and execution. No queued source branch or production state
was changed by preparing this packet.
