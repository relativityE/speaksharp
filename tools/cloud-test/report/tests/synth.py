"""Synthetic runs for the unit tests: 15 journeys, 204 assertions, 151 requirement rows; every receipt is hash-linked."""
import hashlib
import json
import os


def wr(path, data):
    with open(path, "wb" if isinstance(data, bytes) else "w") as f:
        f.write(data)

CASES = ["AHT-%02d" % i for i in range(1, 16)]
COUNTS = [20, 33, 29, 9, 10, 10, 15, 9, 12, 10, 9, 8, 8, 8, 14]
CATS = {"AHT-01": "PG02", "AHT-02": "PG02", "AHT-03": "PG02", "AHT-15": "PG05", "AHT-07": "PG06", "AHT-08": "PG06"}
assert sum(COUNTS) == 204


def sha(b):
    return hashlib.sha256(b).hexdigest()


def spec():
    """cid -> list of [assertion id, verdict, facts]"""
    return {cid: [["r%d" % k, "PASS", {"ok": True}] for k in range(1, n + 1)] for cid, n in zip(CASES, COUNTS)}


def make_run(base, label, served="a" * 40, code_sha="c" * 64, step_sha="d" * 64, sp=None, media=None, drivers=None,
             interruption=None, drop_files=(), drop_plan=False, drop_approval=False, drop_case=None, extra_assertion=None):
    """Write a flat run export. sp: spec overrides {cid: {aid: (verdict, facts)}}. media/drivers: {cid: sha}."""
    sp = sp or {}
    media = media or {}
    drivers = drivers or {}
    interruption = interruption or {}
    os.makedirs(base)
    s = spec()
    for cid, ov in sp.items():
        for row in s[cid]:
            if row[0] in ov:
                row[1], row[2] = ov[row[0]]
    cases, plan_cases = [], []
    for cid in CASES:
        d = os.path.join(base, cid)
        os.makedirs(d)
        asserts, digests = [], {}
        for k, (aid, v, facts) in enumerate(s[cid], 1):
            ref = "aht-%s-%d.json" % (cid[-2:], k)
            blob = json.dumps({"contentSafe": True, "caseId": cid, "assertion": aid, "result": v, "facts": facts}).encode()
            wr(os.path.join(d, ref), blob)
            digests[ref] = sha(blob)
            a = {"id": aid, "result": v, "detail": "x", "evidenceRefs": [ref]}
            if v == "NOT RUN" and facts.get("interruptedBy"):
                a["interruptedBy"] = facts["interruptedBy"]
            asserts.append(a)
        counts = {x: sum(1 for a in asserts if a["result"] == x) for x in ("PASS", "FAIL", "NOT RUN")}
        res = "FAIL" if counts["FAIL"] else ("PASS" if not counts["NOT RUN"] else "NOT RUN")
        cr = {"caseId": cid, "result": res, "assertions": asserts, "evidenceDigests": digests, "contentSafe": True}
        if cid in interruption:
            cr["interruption"] = interruption[cid]
        wr(os.path.join(d, "case-result.json"), json.dumps(cr))
        summ = json.dumps({"reason": "completed", "exitCode": 0, "startedAt": "2026-01-01T00:00:00Z", "endedAt": "2026-01-01T00:01:00Z", "ownedProcessesRemaining": [],
                           "guard": {"counters": {"forwarded": 10, "attempted": 10}}, "actionBudget": {"limits": {"startPresses": 1, "takeAttempts": 1}, "used": {"startPresses": 1, "takeAttempts": 1}}}).encode()
        wr(os.path.join(d, "summary.json"), summ)
        wr(os.path.join(d, "guard.jsonl"), json.dumps({"kind": "request", "rule": "web-read", "outcome": "completed", "status": 200}) + "\n")
        cases.append({"caseId": cid, "result": res, "assertions": asserts, "executionReceipt": {"summarySha256": sha(summ)}, "requestsUsed": 10})
        plan_cases.append({"id": cid, "driverSha256": drivers.get(cid, "e" * 64), "configSha256": "f" * 64, "mediaSha256": media.get(cid, "b" * 64)})
    reqs = []
    for i in range(151):
        if i < 15:
            rid = CASES[i]
        else:
            rid = "REQ-%03d" % i
        cat = CATS.get(rid) or ("PG04" if rid in CASES else "PG0%d" % (1 + i % 7))
        reqs.append({"requirementId": rid, "title": "t " + rid, "categoryId": cat, "layer": "agent-served", "result": "NOT RUN", "reason": "unmapped"})
    camp = {"campaignId": "C-" + label, "sourceSha": served, "servedSha": served, "result": "FAIL", "fullAcceptance": "NOT RUN", "cases": cases, "validationRequirements": reqs,
            "identityReceipts": [{"result": "MATCH", "servedSha": served, "phase": "admission", "identityGetsUsed": 1, "cap": 4, "bodySha256": "9" * 64}], "finalIdentity": "MATCH", "safetyStopped": False}
    wr(os.path.join(base, "case-results.json"), json.dumps(camp))
    if not drop_plan:
        plan = {"campaignId": camp["campaignId"], "servedSha": served, "stepManifestSha256": step_sha, "cases": plan_cases, "runtime": "synthetic"}
        pb = json.dumps(plan).encode()
        wr(os.path.join(base, "campaign-plan.json"), pb)
        wr(os.path.join(base, "plan.sha"), sha(pb))
        if not drop_approval:
            wr(os.path.join(base, "security-approval.json"), json.dumps({"reviewedCodeManifestSha256": code_sha}))
    for cid, fname in drop_files:
        os.remove(os.path.join(base, cid, fname))
    return base
