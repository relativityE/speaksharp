#!/usr/bin/env python3
"""Regenerate the AHT nightly coverage map from the assertion catalog.

Usage: python3 docs/aht-nightly/build_map.py <repo-root> <output-json>
Exits non-zero if an override names no catalog row, a (case, row) pair repeats,
a new row reuses a catalog row's name, or the row count differs from the catalog."""
import json, sys
from collections import Counter

def fail(msg):
    sys.exit(f"build_map: {msg}")

if len(sys.argv) != 3:
    fail("usage: build_map.py <repo-root> <output-json>")
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
o("AHT-01","same-target-numeric","J1.b","strengthen","Also compare the saved filler count with the fixture's known reference (rwtFillerReference.ts), so the row has an oracle independent of the code under test. Today the snapshot preflight makes the whole case NOT RUN when Progress code changes in an upgrade (design §6 item 10, G11).")
o("AHT-01","probe-save-isolation","J1.c","strengthen","Paired with the new short-stop-no-save row; failed on 14 Nov (AHT-03) until the short-Stop fix lands (G5).")
# AHT-03 duplicates consolidated
for r in ["rapid-repeat-gate","rapid-repeat-release","next-start","next-start-release","probe-save-isolation","same-target-numeric"]:
    o("AHT-03",r,"J1.b/J1.c and J3.a","consolidated","Same check on the same code already runs in J1 (Open Mic) and J3.a (Focus, full fixture); the partial fixture adds nothing to it. Needs the owner's disposition under finite-aht-denominator.json before the row leaves AHT-03's denominator.")
for r in ["same-target-repeat","analytics-repeat-opens-product"]:
    o("AHT-03",r,"J3.b","kept","Kept on the partial fixture: the only repeat that starts from a take with missed points, so it is the only check that missed points reset to pending.")
o("AHT-02","same-target-numeric","J3.a","strengthen","Same fixture-reference oracle as J1.b; the snapshot gate moves out of the case preflight (design §6 item 10).")
o("AHT-04","pending-leave-no-session","J5.a","kept","")
o("AHT-10","leave-released","J5.c","strengthen","Keep the R5 observer and add the R4C-comparable observer with the same leave action, tab-close variant reported separately, as the gap ledger requires for GAP-05 (14 Nov HOLD).")
o("AHT-10","recording-before-leave","J5.c","kept","")
o("AHT-12","press-bound-denial","J7.a","kept","")
o("AHT-12","denial-truthful-no-mic","J7.a","strengthen","Must show the blocked-microphone guidance (GAP-03).")
o("AHT-12","allowed-recovery-saved","J7.a","strengthen","Permission granted in the same browser context after denial, then Start records and saves; the fresh-browser stand-in no longer counts (14 Nov partial).")
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

new_rows = [
 ("J1.c","short-stop-no-save","A Stop under 5 s saves nothing: no completed sessions row, no history entry (G5).","needs short-Stop fix PR"),
 ("J1.d","signout-no-forbidden-read","No authenticated read returns 403 around sign-out (GAP-04; first seen on the maintained account, so comparability on a fresh account is unproven).","row new"),
 ("J1.e","trial-expired-wall-on-open-session","With the browser still signed in, a reload or navigation after the trial ends lands on the payment page (G3).","needs payment-wall PR"),
 ("J1.e","trial-expired-payment-wall","A fresh sign-in after expiry lands on the payment page; Practice, History, Progress and deep links are not reachable (G3).","needs payment-wall PR"),
 ("J1.e","trial-expired-server-refuses","On the deployed build, direct calls with the expired account's own token (Start, save, coaching, history read) are refused. Checks the deployed bodies; the logic itself is in DB and contract tests (G1, G2).","needs payment-wall PR"),
 ("J1.f","account-delete-from-wall","The expired, unpaid user can still delete the account from the wall; account and saved data are gone afterwards.","needs deletion flow confirmed shippable"),
 ("J2","paid-wall-before-payment","A run-owned expired account sees the wall with a way to pay.","needs payment-wall PR"),
 ("J2","checkout-opens-for-expired-user","The wall's pay action opens hosted Checkout for the $10 monthly price, bound to this account, with no trial; not completed.","new"),
 ("J2","abandoned-checkout-stays-walled","Returning from Checkout without paying leaves the account walled and unpaid.","new"),
 ("J2","deployed-webhook-ready","The deployed webhook rejects an unsigned event and is configured (existing stripe-webhook-readiness).","exists"),
 ("J7.d","account-delete-during-trial","An in-trial user deletes the account from the Account page; sign-in fails afterwards and run cleanup finds nothing left.","needs deletion flow confirmed shippable"),
 ("J8.c","no-session-choice-with-takes","With takes listed, choosing No session stores feedback with no session link.","new"),
 ("J9","pre-upgrade-history-opens","Pinned seed sessions saved on a named earlier release still open with their metrics and coaching after the latest release.","needs long-lived account decision"),
 ("J9","pre-upgrade-progress-opens","Progress over the pinned seed history renders the same comparisons it did before the release.","new"),
 ("J9","entitlement-survives-upgrade","The paid entitlement holds and the billing portal opens after the release.","new"),
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
     "rows":rows,"newRows":[{"leg":a,"assertion":b,"what":c,"status":d} for a,b,c,d in new_rows]}
with open(sys.argv[2], "w") as fh:
    json.dump(out, fh, indent=1)
print(len(rows), Counter(r["status"] for r in rows))
