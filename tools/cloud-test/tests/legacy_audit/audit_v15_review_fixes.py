"""HISTORICAL AUDIT of the retained Cloud Test campaigns: the history tests of tests/test_v15_review_fixes.py, moved unchanged from 96af08e7 with the
module helpers they use. Not part of the current suite (never collected by `discover -p test_*.py`), never current-execution credit; run
only by scripts/run_legacy_audit.py with the retained history present. The current suite runs the same rules on the synthetic history."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import copy


import json


import os


import shutil


import subprocess


import sys


import tempfile


import unittest


from _fixtures import ROOT, J, run_py, sample, wjson, needs_history


from _nightly import CATALOG, SHA, history, make_run, request, utc


BROKEN = ("AHT-07", CATALOG["cases"]["AHT-07"]["requiredAssertions"][1])


import check_gates as CG


import history_index as HI


import recurring_usage as RU


import reservations as RS


def approval(req, **caps):
    est = req["estimate"]
    ap = {"status": "APPROVED", "approvedBy": "owner", "approvalRef": "standing-1", "approvedAtUtc": "2026-10-31T00:00:00Z", "validFromUtc": "2026-10-31T00:00:00Z", "expiresUtc": "2026-12-31T00:00:00Z",
          "periodStartUtc": "2026-11-01T00:00:00Z", "cadence": {"runsPerPeriod": 30, "period": "30 days"},
          "perRunCaps": {"runCapRequests": est["requests"]["runCap"], "identityReads": est["identityReads"], "starts": est["starts"], "takes": est["takes"],
                         "coachingRequests": est["providerBillableRequests"]["coachingCap"], "windowMinutes": est["window"]["proposedMinutes"], "githubRunnerMinutes": 30, "paidActionsUsd": 0},
          "periodCaps": {"requests": 30 * est["requests"]["runCap"], "identityReads": 30 * est["identityReads"], "starts": 30 * est["starts"], "takes": 30 * est["takes"],
                         "coachingRequests": 30 * est["providerBillableRequests"]["coachingCap"], "githubRunnerMinutes": 30 * 30, "paidActionsUsd": 0}}
    ap["periodCaps"].update(caps)
    return ap


def nightly_request(run_id="R9-N9"):
    r = request(run_id)
    r["window"] = {"startUtc": "2026-11-05T03:00:00Z", "endUtc": "2026-11-05T08:00:00Z", "approvalRef": "standing-1"}
    return r


def index_of(root, cfg):
    return HI.wrap(HI.derive(cfg, root, 1))


import hashlib


import check_isolation as CI


import isolation_assemble as IA


ACCT = hashlib.sha256(b"dedicated-nightly-account-id").hexdigest()


def rid(n):
    return hashlib.sha256(("rec%d" % n).encode()).hexdigest()


def probe(records=(), queried="2026-11-02T02:55:00Z", acct=ACCT, pages=0, procs=0):
    return {"accountIdSha256": acct, "queriedUtc": queried, "source": "account-scoped read, guarded", "records": list(records), "ownedPagesOpen": pages, "ownedProcessesRunning": procs}


def good_evidence(run_id="R9-N2", before=(), created=3, **over):
    req = nightly_request(run_id)
    req["nightly"] = dict(req.get("nightly") or {}, accountIdSha256=ACCT)
    marker = "nightly-%s-7f3a" % run_id
    recs = [{"kind": "session", "idSha256": rid(100 + i), "marker": marker} for i in range(created)]
    b = probe(before, "2026-11-02T02:55:00Z")
    m = probe(list(before) + recs, "2026-11-02T03:48:00Z")
    a = probe(before, "2026-11-02T03:55:00Z")
    rr = {"startedUtc": "2026-11-02T03:00:00Z", "endedUtc": "2026-11-02T03:50:00Z"}
    ev = IA.assemble(req, rr, b, m, a, marker, "2026-11-02T03:56:00Z")
    return req, ev


WINDOW = (utc("2026-11-02T03:00:00Z"), utc("2026-11-02T03:50:00Z"))


from test_release_gate import Fixture, ledger_with, verdict


import derive_features as DF


import derive_alerts as DA


ROWS_OK = [{"case": "AHT-07", "assertions": [CATALOG["cases"]["AHT-07"]["requiredAssertions"][0]]}]


def feature(fid="FEAT-001", pr="201", **over):
    f = {"id": fid, "title": "Saved-session export", "area": "PG03", "pr": "#" + pr, "commit": None,
         "review": {"outcome": "approved", "reviewedBy": "reviewer-1", "reviewRef": "review-201", "reviewedAtUtc": "2026-10-28T10:00:00Z"},
         "expectedBehaviour": {"summary": "a user can export a saved session", "userVisible": True, "criteria": "the export link downloads a file for the saved session", "definedAtUtc": "2026-10-28T10:30:00Z", "confirmedByOwner": True},
         "coverage": {"route": "existing-rows", "requirements": ROWS_OK, "newRows": []}}
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(f.get(k), dict):
            f[k] = {**f[k], **v}
        else:
            f[k] = v
    return f


def verify_with(fx, feats, ledger=None, catalog=None, **kw):
    req = {"release": {"testedSha": fx.tested, "lastRunTestedSha": fx.base, "backend": kw.get("backend") or {"sha": fx.tested, "source": "owner-stated", "verifiedAtUtc": None, "evidenceRef": None}}}
    d = tempfile.mkdtemp()
    paths = {n: os.path.join(d, n + ".json") for n in ("req", "led", "cfg", "feat", "cat", "out")}
    wjson(paths["req"], req); wjson(paths["led"], ledger or ledger_with(["101"])); wjson(paths["cfg"], fx.cfg); wjson(paths["feat"], {"features": feats}); wjson(paths["cat"], catalog or CATALOG)
    from _fixtures import NOW
    r = run_py("scripts/verify_release.py", "--request", paths["req"], "--ledger", paths["led"], "--config", paths["cfg"], "--features", paths["feat"], "--catalog", paths["cat"], "--repo", fx.repo, "--receipts-root", fx.root, "--now", NOW, "--out", paths["out"])
    assert r.returncode == 0, r.stderr
    return json.load(open(paths["out"]))


import derive_concerns as DCN


CCFG = J("config", "concerns.json")


SENTINEL = "A shared board assigns an owner and deadline."


def write_run_logs(root, label, case_overrides=None):
    """Guard logs and step logs for every journey of a synthetic run. case_overrides: case id -> {"events": [...extra guard events], "step": [...lines], "nostop": bool}."""
    base = os.path.join(root, label)
    for cid in CATALOG["cases"]:
        ov = (case_overrides or {}).get(cid, {})
        ev = [{"kind": "start", "t": "2026-11-02T03:00:00.000Z", "seq": 1},
              {"kind": "request", "host": "app.example", "method": "GET", "dest": "document", "nav": True, "rule": "web-read", "decision": "forwarded", "status": 200, "ms": 40, "bytes": 10, "t": "2026-11-02T03:00:01.000Z", "seq": 2},
              {"kind": "request", "host": "db.example", "method": "POST", "dest": "empty", "nav": False, "rule": "rpc", "decision": "forwarded", "status": 200, "ms": 30, "bytes": 5, "t": "2026-11-02T03:00:02.000Z", "seq": 3},
              {"kind": "connect", "host": "o1.ingest.us.sentry.io", "port": 443, "decision": "denied", "reason": "host", "t": "2026-11-02T03:00:02.500Z", "seq": 4},
              {"kind": "request", "host": "app.example", "method": "GET", "dest": "worker", "nav": False, "rule": "web-read", "decision": "forwarded", "status": 200, "ms": 20, "bytes": 5, "t": "2026-11-02T03:00:03.000Z", "seq": 5}]
        ev += ov.get("events", [])
        with open(os.path.join(base, cid, "guard.jsonl"), "w") as f:
            for e in ev:
                f.write(json.dumps(e) + "\n")
        step = ov.get("step") or ["2026-11-02T03:00:00.100Z sandbox ok: 8 chrome processes", "2026-11-02T03:00:10.000Z step completed"] + ([] if ov.get("nostop") else ["2026-11-02T03:00:10.100Z stop completed exit 0 remaining 0"])
        open(os.path.join(base, cid, "step.log"), "w").write("\n".join(step) + "\n")


def concerns_for(root, cfg, label, sha=None, extra=()):
    req = request(label, sha or SHA.get(label, "f0" * 20))
    return DCN.derive(cfg, CCFG, root, label, req, extra)


def sub_of(out, cid, name):
    c = next(c for c in out["concerns"] if c["id"] == cid)
    return c, next(s for s in c["subObservations"] if s["name"] == name)


class ConcernObservations(unittest.TestCase):
    def setUp(self):
        self.root, self.cfg = history(("N1", {}), ("N2", {}))
        write_run_logs(self.root, "N1"); write_run_logs(self.root, "N2")

    @needs_history
    def test_the_real_sealed_runs_are_observed_the_same_way(self):
        cfg = J("config", "test-config.v1.json")
        root = os.path.join(ROOT, "config", "history", "receipts")
        r5 = J("config", "history", "receipts", "R5", "case-results.json")
        req = request("R5-x", r5["sourceSha"])
        out = DCN.derive(cfg, CCFG, root, "R5", req)
        v = {c["id"]: c["verdict"] for c in out["concerns"]}
        self.assertEqual((v["CON-1"], v["CON-4"]), ("OBSERVED CLEAN", "OBSERVED CLEAN"))
        _, s = sub_of(out, "CON-2", "outbound requests started after termination")
        self.assertEqual(s["verdict"], "OBSERVED CLEAN")
        _, p = sub_of(out, "CON-2", "owned processes after termination")
        self.assertEqual(p["verdict"], "OBSERVED CLEAN", "AHT-10 and AHT-11 stopped on their allowance (exit 6) with 0 processes remaining: the harness's own controlled stop")
        _, n = sub_of(out, "CON-2", "requests in flight at termination")
        self.assertIn("24 forwarded request(s)", n["detail"])
        self.assertEqual(v["CON-3"], "NOT OBSERVABLE")


if __name__ == "__main__":
    import unittest
    unittest.main()
