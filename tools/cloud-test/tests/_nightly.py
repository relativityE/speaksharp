"""Synthetic sealed history for the nightly-regression tests: full 15-journey runs of all 204 catalog rows, with identity receipts, ledgers and tiny evidence files.
Nothing here is real data; it exercises the history, alert, coverage and approval logic the nightly workflow depends on."""
import copy
import datetime
import json
import os
import tempfile

from _fixtures import ROOT, J, wjson
from _synthetic_receipts import seal_in_place

CATALOG = J("config", "assertion-catalog.json")
SHA = {"N1": "a1" * 20, "N2": "b2" * 20, "N3": "c3" * 20, "N4": "d4" * 20, "N5": "e5" * 20}


def make_run(root, label, fails=(), notrun=(), sha=None, ended="2026-11-01T03:40:00Z", identity_bad=None, requests=3600, identity_reads=32, starts=39, takes=31, coaching=12, logs=True):
    """fails / notrun: iterables of (case, assertion). Returns the config history entry for the run."""
    sha = sha or SHA.get(label, "f0" * 20)
    base = os.path.join(root, label)
    os.makedirs(base)
    ident = {"result": "MATCH", "servedSha": sha, "expectedSha": sha}
    cases = []
    for cid, spec in CATALOG["cases"].items():
        os.makedirs(os.path.join(base, cid), exist_ok=True)
        rows = []
        for i, a in enumerate(spec["requiredAssertions"], 1):
            v = "FAIL" if (cid, a) in fails else ("NOT RUN" if (cid, a) in notrun else "PASS")
            ref = "aht-%s-%d.json" % (cid[-2:], i)
            wjson(os.path.join(base, cid, ref), {"fact": a, "result": v, "run": label})
            rows.append({"id": a, "result": v, "evidenceRefs": [ref]})
        res = "FAIL" if any(r["result"] == "FAIL" for r in rows) else ("PASS" if all(r["result"] == "PASS" for r in rows) else "NOT RUN")
        cases.append({"caseId": cid, "result": res, "assertions": rows, "identityBefore": dict(ident), "identityAfter": dict(ident)})
    if identity_bad:
        case, phase, served = identity_bad
        next(c for c in cases if c["caseId"] == case)[phase] = {"result": "MATCH", "servedSha": served, "expectedSha": sha}
    wjson(os.path.join(base, "case-results.json"), {"campaignId": label, "sourceSha": sha, "servedSha": sha, "result": "FAIL" if fails else "PASS", "safetyStopped": False, "finalIdentity": "MATCH", "cases": cases})
    wjson(os.path.join(base, "campaign-ledger.json"), {"used": {"total": requests, "coaching": coaching}, "created": ended, "updated": ended})
    if logs:
        # the harness's own reservation log: one line per Start press and per take (spread over the first journeys)
        for cid, n_s, n_t in (("AHT-01", starts, takes),):
            with open(os.path.join(base, cid, "action-reservations.jsonl"), "w") as f:
                for i in range(n_s):
                    f.write(json.dumps({"kind": "start", "ordinal": i + 1, "caseId": cid}) + "\n")
                for i in range(n_t):
                    f.write(json.dumps({"kind": "take", "ordinal": i + 1, "caseId": cid}) + "\n")
    wjson(os.path.join(base, "identity-ledger.json"), {"identityGets": identity_reads, "receipts": []})
    pin = seal_in_place(base, label)
    return {"label": label, "campaignId": label, "servedSha": sha, "ledgersOnly": False, "receiptsManifestSha256": pin}


def history(*specs):
    """specs: (label, kwargs). Returns (receipts root, config copy with the runs appended after the sealed history ... but only the synthetic runs)."""
    d = tempfile.mkdtemp(prefix="ct-nightly-")
    cfg = copy.deepcopy(J("config", "test-config.v1.json"))
    cfg["history"]["runs"] = []
    cfg["history"].pop("index", None)
    cfg["history"]["order"] = []
    for label, kw in specs:
        cfg["history"]["runs"].append(make_run(d, label, **kw))
    cfg["history"]["order"] = [r["label"] for r in cfg["history"]["runs"]]
    return d, cfg


def request(run_id="R9-nightly", sha=None):
    r = J("config", "runs", "R8-nightly-regression-proposal.json")
    r["runId"] = run_id
    if sha:
        r["release"]["testedSha"] = sha
    return r


def utc(s):
    return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
