#!/usr/bin/env python3
"""Derives the gap-closure ledger's evidence from sealed receipts, git (via release-verification.json) and the latest run. Nothing in the result is
typed by hand: prior verdicts, evidence references (file and sha256), signal counts, deployed inclusion, latest result and status are computed.

Usage: derive_ledger.py --ledger L.json --config C.json --release-verification RV.json [--latest-label LABEL] [--latest-comparison C.json]
                        [--baselines baselines.json --comparisons-dir DIR] [--receipts-root DIR] --out ledger-derived.json
Comparability is judged ROW BY ROW against the right baseline: with --baselines (select_baselines.py) every required row is compared with the most recent
earlier run that has a verdict for THAT row (DIR/<label>/comparison.json), so a defect that FAILED in R4C and was NOT RUN in R5 is compared with R4C. A row that no
earlier run ever tested is a first observation (recorded as such). Without --baselines the single run named in --latest-comparison is the baseline, and a row it
has no verdict for is NOT comparable (never closed from NOT RUN)
Status rules (single source of truth, tested): CLOSED only with a comparable latest PASS with evidence and, for a product fix, cloud-verified deployed
inclusion; NOT RUN or INCONCLUSIVE never closes; FAIL is FAILED-RETEST; a verified deployed fix not yet tested is DEPLOYED-AWAITING-TEST; otherwise OPEN
(HARNESS-ONLY for a harness correction with no product change)."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, sha256_file, now_utc, ep_requirements, ep_cases  # noqa: E402


def ledger_status(g):
    """Single source of truth for gap status. CLOSED needs ALL of: a PASS in EVERY required case, evidence for EVERY required case, comparability
    PROVEN (explicitly True) for every required case, and, for a product fix, cloud-verified deployed inclusion. Anything less is never CLOSED."""
    lat = g.get("latest") or {}
    inc = (g.get("fix") or {}).get("inclusion")
    kind = g.get("kind")
    if lat.get("result") == "PASS":
        if lat.get("missingEvidenceCases") or not lat.get("evidence"):
            return "INCONCLUSIVE", "evidence missing for %s (missing evidence stays inconclusive)" % (", ".join(lat.get("missingEvidenceCases") or []) or "the required cases")
        if lat.get("comparable") is not True:
            return "INCONCLUSIVE", "comparability not proven for every required case (%s)" % (lat.get("comparableReason") or "no valid comparison supplied")
        if kind == "product-fix" and inc != "cloud-verified":
            return "OPEN", "latest PASS exists but deployed inclusion is %s" % inc
        return "CLOSED", "every required case PASS with evidence and proven comparability" + ("; deployed inclusion verified" if kind == "product-fix" else "")
    if lat.get("result") == "FAIL":
        return "FAILED-RETEST", "latest result FAIL in %s" % (", ".join(lat.get("failedCases") or []) or "a required case")
    if lat.get("result") in ("NOT RUN", "INCONCLUSIVE"):
        return "INCONCLUSIVE", "latest result is %s%s (NOT RUN never closes a gap)" % (lat["result"], (": " + ", ".join(lat["notRunCases"])) if lat.get("notRunCases") else "")
    if kind == "product-fix" and (g.get("fix") or {}).get("candidate"):
        return "OPEN", "only a candidate fix exists (%s); it is not established as a fix for this gap" % (g["fix"].get("pr") or g["fix"].get("commit"))
    if kind == "product-fix" and inc == "cloud-verified":
        return "DEPLOYED-AWAITING-TEST", "deployment verified; the expected-PASS test has not run"
    if kind == "harness-correction":
        return "HARNESS-ONLY", "harness correction; no product fix to include; awaiting the corrected observer's first reading"
    if kind == "evidence-restoration":
        return "OPEN", "awaiting the restored stimulus and an expected-PASS result in every required case"
    return "OPEN", "awaiting %s" % ("a fix" if inc == "no-fix-identified" else "deployed-inclusion proof and an expected-PASS result")


def load_run(root, label):
    base = os.path.join(root, label)
    cr = load(os.path.join(base, "case-results.json"))
    cases = {c["caseId"]: c for c in cr["cases"]}
    return base, cases


def observe(root, label, base, cases, ob):
    if "signal" in ob:
        s = ob["signal"]
        by, evid = {}, []
        for cid in sorted(cases):
            gp = os.path.join(base, cid, "guard.jsonl")
            if not os.path.isfile(gp):
                continue
            for line in open(gp, encoding="utf-8"):
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("kind") != "request" or e.get("rule") != s["rule"] or e.get("status") is None:
                    continue
                hit = (e["status"] >= s["statusMin"]) if "statusMin" in s else (e["status"] == s.get("status"))
                if hit and s.get("pathHash") in (None, e.get("path")):
                    by[cid] = by.get(cid, 0) + 1
                    evid.append({"file": "%s/%s/guard.jsonl" % (label, cid), "seq": e.get("seq"), "status": e["status"], "sha256": sha256_file(gp)})
        return {"signal": s.get("label", s["rule"]), "count": sum(by.values()), "byCase": by, "verdict": "FAIL" if by else "PASS", "evidence": evid[:8]}
    c = cases.get(ob["case"])
    a = next((x for x in (c or {}).get("assertions", []) if x["id"] == ob["assertion"]), None)
    if a is None:
        return {"case": ob["case"], "assertion": ob["assertion"], "verdict": "NOT RUN", "evidence": [], "note": "case or assertion not in this run"}
    ev = []
    for ref in a.get("evidenceRefs") or []:
        p = os.path.join(base, ob["case"], ref)
        ev.append({"file": "%s/%s/%s" % (label, ob["case"], ref), "sha256": sha256_file(p) if os.path.isfile(p) else None})
    return {"case": ob["case"], "assertion": ob["assertion"], "verdict": a["result"], "evidence": ev}


def rollup(obs):
    v = [o["verdict"] for o in obs]
    if "FAIL" in v:
        return "FAIL"
    return "PASS" if v and all(x == "PASS" for x in v) else "NOT RUN"


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--ledger", required=True)
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--release-verification", required=True)
    a.add_argument("--latest-label")
    a.add_argument("--latest-comparison")
    a.add_argument("--baselines")
    a.add_argument("--comparisons-dir")
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--out", required=True)
    x = a.parse_args()
    led, cfg, rv = load(x.ledger), load(x.config), load(x.release_verification)
    cmp_latest = load(x.latest_comparison) if x.latest_comparison else None
    bl = load(x.baselines) if x.baselines else None
    cmp_cache = {}

    def comparison_for(label):
        if label not in cmp_cache:
            if bl and x.comparisons_dir and os.path.isfile(os.path.join(x.comparisons_dir, label, "comparison.json")):
                cmp_cache[label] = load(os.path.join(x.comparisons_dir, label, "comparison.json"))
            elif cmp_latest and (cmp_latest.get("previous") or {}).get("label") == label:
                cmp_cache[label] = cmp_latest
            else:
                cmp_cache[label] = None
        return cmp_cache[label]
    labels = list(cfg["history"]["comparisonBaselines"])
    runs = {l: load_run(x.receipts_root, l) for l in labels}
    if x.latest_label:
        # the whole retained history up to and including the latest run is shown, so an older FAIL stays visible when a middle run did not test it
        comparable = [r["label"] for r in cfg["history"]["runs"] if not r.get("ledgersOnly")]
        upto = comparable[:comparable.index(x.latest_label) + 1] if x.latest_label in comparable else []
        for l in upto:
            runs.setdefault(l, load_run(x.receipts_root, l))
        runs[x.latest_label] = load_run(x.receipts_root, x.latest_label)
        runs = {l: runs[l] for l in sorted(runs, key=lambda l: comparable.index(l) if l in comparable else -1)}
    out_gaps = []
    for g in led["gaps"]:
        hist = {}
        for lab, (base, cases) in runs.items():
            obs = [observe(x.receipts_root, lab, base, cases, ob) for ob in g["observations"]]
            hist[lab] = {"observations": obs, "rollup": rollup(obs)}
        first = next(((l, h) for l, h in hist.items() if h["rollup"] == "FAIL"), None)
        fixrec = dict(g["fix"])
        fixrec.update({k: v for k, v in (rv["fixes"].get(g["id"]) or {}).items() if k in ("commit", "inclusion", "basis", "ancestorOfTested", "touchesBackend", "resolved")})
        d = {k: g[k] for k in ("id", "title", "area", "kind", "expectedPass")}
        d.update({"note": g.get("note"), "history": hist, "fix": fixrec,
                  "priorFail": ({"run": first[0], "evidence": [e for o in first[1]["observations"] if o["verdict"] == "FAIL" for e in o["evidence"]][:6], "what": [o.get("assertion") or o.get("signal") for o in first[1]["observations"] if o["verdict"] == "FAIL"]} if first else None)})
        ep = g["expectedPass"]
        latest = {"label": x.latest_label, "result": "PENDING", "evidence": None}
        req_cases = ep_cases(ep)
        d["priorFailCasesNotRequired"] = sorted({ob["case"] for h in hist.values() for ob in h["observations"] if "case" in ob and ob["verdict"] == "FAIL" and ob["case"] not in req_cases})
        if x.latest_label:
            base, cases = runs[x.latest_label]
            per_case, ev_all = {}, []
            for rq in ep_requirements(ep):
                cid = rq["case"]
                obs = [observe(x.receipts_root, x.latest_label, base, cases, {"case": cid, "assertion": aid}) for aid in rq["assertions"]]
                for ob in g["observations"]:
                    if "signal" in ob:
                        obs.append(observe(x.receipts_root, x.latest_label, base, {cid: cases[cid]} if cid in cases else {}, ob))
                ev = [e for o in obs for e in o["evidence"]]
                v = "FAIL" if any(o["verdict"] == "FAIL" for o in obs) else ("PASS" if obs and all(o["verdict"] == "PASS" for o in obs) else "NOT RUN")
                per_case[cid] = {"result": v, "assertions": {o.get("assertion") or o.get("signal"): o["verdict"] for o in obs}, "evidenceFiles": len(ev)}
                ev_all += ev
            res = "FAIL" if any(c["result"] == "FAIL" for c in per_case.values()) else ("PASS" if per_case and all(c["result"] == "PASS" for c in per_case.values()) else "NOT RUN")
            latest = {"label": x.latest_label, "result": res, "evidence": ev_all or None, "perCase": per_case,
                      "failedCases": [c for c, v in per_case.items() if v["result"] == "FAIL"], "notRunCases": [c for c, v in per_case.items() if v["result"] == "NOT RUN"],
                      "missingEvidenceCases": [c for c, v in per_case.items() if v["evidenceFiles"] == 0]}
            reasons, against = [], {}
            if not cmp_latest and not bl:
                reasons.append("no latest comparison supplied")
            else:
                seen_journey = set()
                for rq in ep_requirements(ep):
                    cid = rq["case"]
                    for aid in rq["assertions"]:
                        key = "%s/%s" % (cid, aid)
                        blabel = (((bl["gaps"].get(g["id"]) or {}).get("rows") or {}).get(key) or {}).get("baseline") if bl else (cmp_latest.get("previous") or {}).get("label")
                        against[key] = blabel
                        if blabel is None:
                            # no earlier run ever had a verdict for this row: it is a FIRST observation. The expected-PASS criteria were defined before the run, and there is no
                            # earlier observer to be unchanged from, so nothing is claimed as an improvement and nothing blocks the first established PASS
                            against[key] = "first-observation"
                            continue
                        cx = comparison_for(blabel)
                        if cx is None:
                            reasons.append("%s: the comparison with %s (the most recent run with a verdict) was not supplied" % (key, blabel))
                            continue
                        row = next((r for r in cx.get("rows", []) if r.get("key") == key), None)
                        if row is None:
                            reasons.append("%s: not in the comparison with %s" % (key, blabel))
                            continue
                        if row.get("prev") not in ("PASS", "FAIL"):
                            reasons.append("%s: %s has no verdict for it (%s), so it cannot be a baseline" % (key, blabel, row.get("prev")))
                            continue
                        if row.get("class") == "inconclusive":
                            reasons.append("%s vs %s: %s" % (key, blabel, row.get("reason_text") or "not comparable"))
                        if (cid, blabel) not in seen_journey:
                            seen_journey.add((cid, blabel))
                            j = next((j for j in cx["journeys"] if j["id"] == cid), None)
                            if j is None:
                                reasons.append("%s is not in the comparison with %s" % (cid, blabel))
                            elif j.get("validity") != "valid":
                                reasons.append("%s vs %s: %s" % (cid, blabel, "; ".join(r["text"] for r in j.get("reasons", [])[:2]) or "not comparable"))
            latest["comparedAgainst"] = against
            latest["comparable"] = not reasons
            if reasons:
                latest["comparableReason"] = "; ".join(reasons)[:300]
        d["latest"] = latest
        d["status"], d["statusReason"] = ledger_status(d)
        out_gaps.append(d)
    dump({"schema": "speaksharp.cloud-test.gap-ledger-derived.v1", "derivedUtc": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "baselines": labels, "latestLabel": x.latest_label, "gaps": out_gaps}, x.out)
    print("derived %d gaps; statuses: %s" % (len(out_gaps), ", ".join("%s=%s" % (g["id"], g["status"]) for g in out_gaps)))


if __name__ == "__main__":
    main()
