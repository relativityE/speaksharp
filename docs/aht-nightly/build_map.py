#!/usr/bin/env python3
"""Regenerate the AHT nightly coverage map from the assertion catalog.

Usage: python3 docs/aht-nightly/build_map.py <repo-root> <output-json> [<rationalization-json> <1862-mapping-json>]
The optional pair also writes the design in the speaksharp.aht-rationalization.v1 schema
from #1862, so that PR's validator (tools/aht-rationalization/validate.mjs) can check it.
Rows #1862 marks fast-first-retain-live-until-proven keep that disposition and its candidate
tests; this design adds journeys, grouping and the extra rows as additionalRequirements.
Exits non-zero if an override names no catalog row, a (case, row) pair repeats,
a new row reuses a catalog row's name, or the row count differs from the catalog."""
import json, sys
from collections import Counter

def fail(msg):
    sys.exit(f"build_map: {msg}")

if len(sys.argv) not in (3, 5):
    fail("usage: build_map.py <repo-root> <output-json> [<rationalization-json> <1862-mapping-json>]")
repo = sys.argv[1]
with open(f"{repo}/tools/cloud-test/config/assertion-catalog.json") as fh:
    cat = json.load(fh)
CROSS = {"owner-bound","start-press-budget","no-cloud-stt","owned-pages-closed"}

case_leg = {
 "AHT-01": "J1.a-J1.c", "AHT-15": "J1.d", "AHT-02": "J3.a", "AHT-03": "J3.b",
 "AHT-04": "J5.a", "AHT-09": "J5.b", "AHT-10": "J5.c", "AHT-05": "J4.a", "AHT-06": "J4.b",
 "AHT-11": "J6", "AHT-12": "J7.a", "AHT-13": "J7.b", "AHT-14": "J7.c", "AHT-08": "J8.a", "AHT-07": "J8.b",
}
# per-row overrides: (case,row) -> (leg, status, note)
ov = {}
def o(case,row,leg,status,note): ov[(case,row)] = (leg,status,note)
# AHT-01 leg detail
for r in ["fresh-first-session","saved-once","grounded-coaching","review-reopen","pdf-owner-take","open-mic-review-presentation","open-mic-coaching-length","open-mic-coaching-distinct"]:
    o("AHT-01",r,"J1.a","kept","")
for r in ["same-target-repeat","analytics-repeat-opens-product","rapid-repeat-gate","rapid-repeat-release","next-start","next-start-release"]:
    o("AHT-01",r,"J1.b","kept","")
o("AHT-01","same-target-numeric","J1.b","strengthen","Also compare the saved filler count with the fixture's known reference (rwtFillerReference.ts), so the row has an oracle independent of the code under test. Today the snapshot preflight makes the whole case NOT RUN when Progress code changes in an upgrade (G11 in design §4).")
o("AHT-01","probe-save-isolation","J1.c","strengthen","Paired with the new short-stop-no-save row. AHT-03's copy failed on 14 Nov; that take's duration was not measured, so a short Stop (G5) is a likely cause, not a proven one.")
# AHT-03 rows that repeat J1 and J3.a stay live until a replacement is proven
for r in ["rapid-repeat-gate","rapid-repeat-release","next-start","next-start-release","probe-save-isolation","same-target-numeric"]:
    o("AHT-03",r,"J3.b","kept","Stays live on the partial fixture until reviewed proof shows J1, J3.a or a faster test fails on the same break. probe-save-isolation is the row that failed here on 14 Nov, so the copy is not shown to be redundant.")
for r in ["same-target-repeat","analytics-repeat-opens-product"]:
    o("AHT-03",r,"J3.b","kept","Kept on the partial fixture: the only repeat that starts from a take with missed points, so it is the only check that missed points reset to pending.")
o("AHT-02","same-target-numeric","J3.a","strengthen","Same fixture-reference oracle as J1.b; the snapshot gate moves out of the case preflight (G11 in design §4).")
o("AHT-04","pending-leave-no-session","J5.a","kept","")
o("AHT-10","leave-released","J5.c","strengthen","Keep the R5 observer and add the R4C-comparable observer with the same leave action, tab-close variant reported separately, as the gap ledger requires for GAP-05 (14 Nov HOLD).")
o("AHT-10","recording-before-leave","J5.c","kept","")
o("AHT-12","press-bound-denial","J7.a","kept","")
o("AHT-12","denial-truthful-no-mic","J7.a","strengthen","Must show the blocked-microphone guidance (GAP-03).")
o("AHT-12","allowed-recovery-saved","J7.a","strengthen","Permission granted after the denial within the same deny-launched browser, then Start records and saves; the fresh-browser stand-in no longer counts (14 Nov partial). Until a qualified way to grant it exists, the leg is HOLD, as the harness requires.")
o("AHT-14","download-fault-exercised","J7.c","strengthen","Proof that model bytes were received before the connection dropped (byte count > 0 and < total), else the leg is HOLD, not PASS (14 Nov HOLD).")
o("AHT-13","download-fault-exercised","J7.b","strengthen","Proof that the model request failed before any byte arrived; distinct from J7.c (GAP-06).")
o("AHT-04","cold-pending-observed","J5.a","kept","Needs #1858 deployed (14 Nov FAIL: cancelled load reported as a model failure). Also the GAP-06 stimulus row (model requests > 0).")
o("AHT-04","pending-leave-no-mic","J5.a","kept","")
for r in ["history-preserved","switches-mic-off","signed-out","return-owner-preserved","no-recording-or-session-write","return-entry-mic-off","deep-link-exact-return","deep-link-rendered-own-detail","deep-link-mic-off","return-signed-out"]:
    o("AHT-15",r,"J1.d","moved","Runs on J1's run-owned account (real history from J1.a-c), not the shared Free account that expired on 14 Nov (G4).")

rows=[]
used=set()
for case,v in cat["cases"].items():
    for r in v["requiredAssertions"]:
        if (case,r) in ov:
            used.add((case,r))
            leg,st,note = ov[(case,r)]
        elif r in CROSS:
            leg,st,note = case_leg[case], "kept", "Cross-cutting invariant, asserted in every leg."
        else:
            leg,st,note = case_leg[case], "kept", ""
        rows.append({"case":case,"assertion":r,"newHome":leg,"status":st,"note":note})

NEG_CONTROL = ("Each new or strengthened row counts only once it is validated on its own: a negative control "
               "makes it fail on the deliberately broken behaviour, and it passes when that is restored. "
               "A schema or 204-row validator pass does not prove it.")
new_rows = [
 ("J1.a","trial-length-thirty-days","On the deployed build, read with the account's own token, the trial started within the signup window and ends exactly 30 days later (product owner, 14 Nov). The DB test checks this only on the original trigger body.","row new"),
 ("J1.c","short-stop-no-save","A Stop under 5 s saves nothing: no completed sessions row, no history entry (G5).","needs short-Stop fix PR"),
 ("J1.d","signout-no-unauthorized-read","Around sign-out, no read succeeds without a valid session and no saved data reaches the signed-out page. A 403 denial is a correct answer, not a failure (GAP-04; first seen on the maintained account, so comparability on a fresh account is unproven).","row new"),
 ("J1.d","signout-no-stale-request","After sign-out completes, the page issues no further authenticated request with the old session (GAP-04). Reported separately from signout-no-unauthorized-read.","row new"),
 ("J1.e","trial-expired-wall-on-open-session","With the browser still signed in, a reload or navigation after the trial ends lands on the payment page (G3).","needs payment-wall PR"),
 ("J1.e","trial-expired-payment-wall","A fresh sign-in after expiry lands on the payment page; Practice, History, Progress, PDF export and deep links are not reachable (G3).","needs payment-wall PR"),
 ("J1.e","trial-expired-server-refuses","On the deployed build, direct calls with the expired account's own token (Start, save, coaching, history read) are refused. Checks the deployed bodies; the logic itself is in DB and contract tests (G1, G2).","needs payment-wall PR"),
 ("J1.f","account-delete-from-wall","The expired, unpaid user can still delete the account from the wall; account and saved data are gone afterwards.","needs deletion flow confirmed shippable"),
 ("J2","paid-wall-before-payment","A run-owned expired account sees the wall with a way to pay.","needs payment-wall PR"),
 ("J2","checkout-opens-for-expired-user","The wall's pay action opens hosted Checkout for the $10 monthly price, bound to this account, with no trial; not completed. The session address is never logged, traced, captured in a screenshot or kept.","new"),
 ("J2","abandoned-checkout-stays-walled","Returning from Checkout without paying leaves the account walled and unpaid.","new"),
 ("J2","deployed-webhook-ready","The deployed webhook rejects an unsigned event and is configured (existing stripe-webhook-readiness).","exists"),
 ("J7.d","account-delete-during-trial","An in-trial user deletes the account from the Account page; sign-in fails afterwards and run cleanup finds nothing left.","needs deletion flow confirmed shippable"),
 ("J8.c","no-session-choice-with-takes","With takes listed, choosing No session stores feedback with no session link.","new"),
 ("J9","pre-upgrade-history-opens","Sessions the long-lived account recorded through the product on a named earlier release, and kept, still open with their metrics and coaching after the latest release.","sandbox, disabled until runnable"),
 ("J9","pre-upgrade-progress-opens","Progress over that kept history renders the same comparisons it did before the release.","new"),
 ("J9","entitlement-survives-upgrade","The paid entitlement holds and the billing portal opens after the release. Opening the portal creates a Stripe portal session; its address works for anyone holding it, so it is never logged, traced, captured in a screenshot or kept.","sandbox, disabled until runnable"),
]
unused = set(ov) - used
if unused:
    fail(f"overrides name no catalog row: {sorted(unused)}")
pairs = Counter((r["case"], r["assertion"]) for r in rows)
dups = [k for k, n in pairs.items() if n > 1]
if dups:
    fail(f"duplicate catalog rows: {dups}")
if len(rows) != cat["totalAssertions"]:
    fail(f"{len(rows)} rows mapped, catalog says {cat['totalAssertions']}")
catalog_names = {r["assertion"] for r in rows}
clash = [b for _, b, _, _ in new_rows if b in catalog_names]
if clash:
    fail(f"new rows reuse catalog names: {clash}")
if len({b for _, b, _, _ in new_rows}) != len(new_rows):
    fail("duplicate new row names")
out={"schema":"speaksharp.aht-nightly.coverage-map.v1","date":"2026-11-14","catalogTotal":cat["totalAssertions"],
     "rows":rows,"newRows":[{"leg":a,"assertion":b,"what":c,"status":d} for a,b,c,d in new_rows],
     "rowAcceptance":NEG_CONTROL}

# Optional export in #1862's schema. Every row stays live: nothing is demoted without
# reviewed replacement proof, so no row uses demote-with-reviewed-proof.
JOURNEYS = [
 ("J1", ["AHT-01","AHT-15"], "New user's first 30 days",
  "Real signup, model, owner-bound save, coaching, sign-out return and the deployed payment wall together on the deployed build.",
  "Fresh run-owned account; expiry is the last practice leg and deletion follows it; the trial is ended early only on that test-created account carrying the canary tag, failing closed without it, with exact-account checks and cleanup.",
  "Bound saved takes and coaching, exact deep-link return with mic off, no save for a short Stop, wall on the open session and after sign-in, deployed refusal, deletion readback."),
 ("J2", [], "Hitting the wall and going to pay",
  "Wall to hosted Checkout crosses the deployed app, the deployed checkout function and Stripe's live configuration.",
  "Fresh run-owned expired account; payment never completed; disabled until a reviewed cleanup expires the session through Stripe and reconciles every outstanding checkout operation to a settled state, keeping the audit records the billing code needs. The Checkout address is never logged, traced, captured in a screenshot or kept.",
  "Checkout opens for the right price and account; abandoning it leaves the account walled; deployed webhook rejects an unsigned event."),
 ("J3", ["AHT-02","AHT-03"], "Focus practice",
  "Durable Focus evidence from real speech, with back and reload mid-Focus.",
  "Fresh run-owned account; full fixture then partial fixture; feedback writes fenced (#1859).",
  "Coverage, rails and per-point results saved and reopened; partial repeat resets missed points to pending."),
 ("J4", ["AHT-05","AHT-06"], "Save under a bad connection",
  "Retry and recovery UI over a real lost request and a real lost response.",
  "Fresh run-owned account; each fault reset before the next leg; next take isolated.",
  "Exactly one saved take per fault and an isolated next take."),
 ("J5", ["AHT-04","AHT-09","AHT-10"], "Leaving mid-flow",
  "Page teardown and lease release during a cold Start, a navigation and a tab close happen only in a real browser.",
  "Fresh run-owned account; the cold-Start leg runs first in its own context with a cold model cache; lease released and verified, interceptors and drafts reset between legs; tab-close reported separately.",
  "No session or mic after the cold-Start leave; lease released with both GAP-05 observers."),
 ("J6", ["AHT-11"], "Two places at once",
  "Competing tabs and an independent context against the server lease.",
  "Fresh run-owned account; two real browser contexts.",
  "Second tab and second browser refused; takeover fences the old owner."),
 ("J7", ["AHT-12","AHT-13","AHT-14"], "First-time setup goes wrong",
  "Actual permission denial then grant, a model request failing before any byte, and a disconnect after bytes arrive.",
  "One signup. The denial leg runs in its own browser launch with the file-level deny flag and signs in again; the two model-fault legs each use a fresh context with a cold model cache. Each leg asserts its own take by session id.",
  "Blocked-mic guidance and same-context recovery; each fault proven at its point (before any byte, after bytes received); deletion during the trial."),
 ("J8", ["AHT-08","AHT-07"], "Telling us something",
  "Feedback with no session needs an account with no takes; retries over real transport faults.",
  "Fresh run-owned account; the no-session leg first; feedback writes fenced (#1859, #1860).",
  "Feedback stored once per send with the right session link or none."),
 ("J9", [], "Existing paying customer after an upgrade",
  "Only a long-lived account shows that old data and a paid entitlement survive a migration.",
  "Long-lived paid account on the billing sandbox, signed up and paid through the product with a Stripe test-mode card; records no takes, but opening the billing portal creates a portal session whose address is never logged, traced, captured in a screenshot or kept. History recorded through the product on a named release and kept, never seeded. No test account is charged for real (product owner, 14 Nov 16:36Z), so J9 runs on the sandbox, upgraded with each release, and is disabled until that sandbox is runnable. Its results are sandbox results, never proof of production billing; a real paid account's entitlement after a production upgrade is reported NOT RUN until a safe, approved way exists.",
  "Kept sessions and Progress open as before; entitlement and billing portal hold."),
]
export = None
if len(sys.argv) == 5:
    with open(sys.argv[4]) as fh:
        sam = json.load(fh)
    if sam.get("schema") != "speaksharp.aht-rationalization.v1":
        fail("fourth path is not a #1862 mapping")
    sam_rows = {(r["caseId"], r["assertion"]): r for r in sam["rows"]}
    owner = {c: j for j, cs, *_ in JOURNEYS for c in cs}
    missing = set(cat["cases"]) - set(owner)
    if missing:
        fail(f"cases with no journey: {sorted(missing)}")
    for r in rows:
        if owner[r["case"]] != r["newHome"].split(".")[0].split("-")[0].split("/")[0]:
            fail(f"{r['case']}/{r['assertion']} home {r['newHome']} is outside {owner[r['case']]}")
    export = {
     "schema": "speaksharp.aht-rationalization.v1",
     "status": "proposal-not-executable",
     "sourceCatalog": "tools/cloud-test/config/assertion-catalog.json",
     "sourceBaseline": "897117ba5c2be219fe5d0e9007ccc96861349903",
     "journeys": [{"id": j, "cases": cs, "title": t, "uniqueRisk": u, "isolation": i, "passEvidence": p}
                  for j, cs, t, u, i, p in JOURNEYS],
     "rows": [],
     "additionalRequirements": [
      {"id": "billing-expiry-restoration", "journey": "J1", "status": "blocked",
       "prerequisites": ["Server-enforced payment wall with retained deletion",
                         "Trial ended early only on the test-created account carrying the canary tag, failing closed without it, with exact-account checks and cleanup",
                         "Requirements updated to the no-service-after-trial rule",
                         "Paid lifecycle in #1795's sandbox suite, no production charge"],
       "acceptance": "Expired unpaid account is walled on the open session and after sign-in, the deployed endpoints refuse it, and it can delete the account. Paid restoration is to be proven by a real sandbox run of #1795's suite (not yet runnable), not live in J1.",
       "differsFrom1862": "#1862 accepts approved paid restoration live in J01 with a safe paid-restoration fixture; this design proves restoration by a real sandbox run of #1795's suite, once it is runnable, as the product owner chose on 14 Nov, and adds J2 for production checkout."},
      {"id": "checkout-from-wall", "journey": "J2", "status": "blocked",
       "prerequisites": ["Payment wall", "Reviewed checkout cleanup that expires the session through Stripe and reconciles every outstanding checkout operation to a settled state, keeping the audit records the billing code needs", "Trial ended early only on the test-created account carrying the canary tag, failing closed without it"],
       "acceptance": "Hosted Checkout opens for the right price and account and an abandoned checkout leaves the account walled."},
      {"id": "device-human-proof", "journey": None, "status": "human-required",
       "acceptance": "Physical microphone and mobile Stop visibility; transcript accuracy and coaching usefulness."},
     ],
    }
    for r in rows:
        key = (r["case"], r["assertion"])
        theirs = sam_rows.get(key)
        if theirs is None:
            fail(f"#1862 mapping lacks {key}")
        if r["assertion"] in CROSS:
            disp, cand = "keep-safety", []
        elif theirs["disposition"] == "fast-first-retain-live-until-proven":
            disp, cand = theirs["disposition"], theirs["candidateFastTests"]
        else:
            disp, cand = "keep-live", []
        export["rows"].append({"caseId": r["case"], "assertion": r["assertion"], "journey": owner[r["case"]],
            "disposition": disp, "candidateFastTests": cand, "replacementProof": None,
            "reason": " ".join(x for x in [r["note"] or f"Live in {r['newHome']}.",
                      "Candidate tests from #1862; stays live until proven." if cand else ""] if x)})
    if len(sam_rows) != len(rows):
        fail(f"#1862 mapping has {len(sam_rows)} rows, catalog map has {len(rows)}")
    for j in sorted({a.split(".")[0] for a, _, _, _ in new_rows} |
                    {r["newHome"].split(".")[0] for r in rows if r["status"] == "strengthen"}):
        extra = [f"{b}: {c}" for a, b, c, _ in new_rows if a.split(".")[0] == j]
        extra += [f"{r['case']}/{r['assertion']} strengthened: {r['note']}" for r in rows
                  if r["status"] == "strengthen" and r["newHome"].split(".")[0] == j]
        export["additionalRequirements"].append({"id": f"design-rows-{j}", "journey": j, "status": "proposed",
            "acceptance": " | ".join(extra),
            "implementationAcceptance": NEG_CONTROL})

with open(sys.argv[2], "w") as fh:
    json.dump(out, fh, indent=1)
if export is not None:
    with open(sys.argv[3], "w") as fh:
        json.dump(export, fh, indent=1)
print(len(rows), Counter(r["status"] for r in rows))
