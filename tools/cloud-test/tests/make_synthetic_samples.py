#!/usr/bin/env python3
"""Regenerates the SYNTHETIC samples (not product data): samples/nightly-control (N1 to N4 alerts and coverage) and samples/safety-control (the verdict with 204 of 204 passing
rows under failed isolation, stale evidence, an open alert and an exceeded cap). Run from tools/cloud-test:  python3 -I tests/make_synthetic_samples.py"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
from _fixtures import ROOT  # noqa: E402
from _nightly import CATALOG, SHA, history, request  # noqa: E402
import check_coverage as CC  # noqa: E402
import derive_alerts as DA  # noqa: E402
import test_pipeline_and_report as T  # noqa: E402
from test_nightly_regression import BROKEN  # noqa: E402


def w(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1)
        f.write("\n")


def nightly_control():
    root, cfg = history(("N1", {}), ("N2", {"fails": [BROKEN], "ended": "2026-11-02T03:41:00Z"}), ("N3", {"fails": [BROKEN], "ended": "2026-11-03T03:42:00Z"}), ("N4", {"ended": "2026-11-04T03:40:00Z"}))
    for label in ("N1", "N2", "N3", "N4"):
        req = request(label, SHA[label])
        cov = CC.assess(req, CATALOG, json.load(open(os.path.join(root, label, "case-results.json"))))
        out = DA.derive(cfg, root, label, cov, isolation={"status": "proven", "proven": True, "problems": []})
        d = os.path.join(ROOT, "samples", "nightly-control", label)
        w(os.path.join(d, "coverage.json"), cov)
        w(os.path.join(d, "alerts.json"), out)
        with open(os.path.join(d, "alerts.md"), "w", encoding="utf-8") as f:
            f.write(DA.markdown(out))


def safety_control():
    T.SummaryRules.setUpClass()
    inst = T.SummaryRules("test_ready_only_when_everything_holds")
    latest = inst.latest(inst.all_pass())
    cases = [
        ("safe", "all 204 rows pass; isolation proven; no alert; evidence fresh", {}),
        ("isolation-failed", "all 204 rows pass, but isolation failed", {"isolation": {"status": "failed", "proven": False, "problems": ["the clean-start query found 3 record(s) left by earlier runs"]}}),
        ("isolation-not-proven", "all 204 rows pass, but no isolation evidence exists", {"isolation": {"status": "not-proven", "proven": False, "problems": ["no isolation.json"]}}),
        ("evidence-stale", "all 204 rows pass, but the latest evidence is 70 hours old (limit 36)", {"alerts": {"alerts": [], "evidenceStale": True, "evidenceAgeHours": 70.0}}),
        ("high-alert-open", "all 204 rows pass, but a high alert is open", {"alerts": {"alerts": [{"kind": "ISOLATION-RESIDUE", "severity": "high"}], "evidenceStale": False, "evidenceAgeHours": 3.0}}),
    ]
    rows = []
    for name, what, kw in cases:
        s = inst.derive(True, ["CLOSED"] * 6, latest=latest, **kw)
        rows.append({"case": name, "what": what, "status": s["status"], "recommendation": s["recommendation"], "readiness": s["readiness"]})
    out = {"schema": "speaksharp.cloud-test.safety-control.v1", "synthetic": True, "note": "The headline verdict of the same passing run under different safety states. SYNTHETIC; produced by tests/make_synthetic_samples.py.", "cases": rows}
    w(os.path.join(ROOT, "samples", "safety-control", "verdicts.json"), out)
    with open(os.path.join(ROOT, "samples", "safety-control", "README.md"), "w", encoding="utf-8") as f:
        f.write("# Safety control (synthetic)\n\nThe headline verdict of the same run (every journey PASS, every gate closed) under different safety states. Only the first is READY.\n\n| Case | State | Status | Recommendation |\n|---|---|---|---|\n")
        for r in rows:
            f.write("| %s | %s | %s | %s |\n" % (r["case"], r["what"], r["status"], r["recommendation"]))
        f.write("\nThe readiness text of each case is in `verdicts.json`.\n")


if __name__ == "__main__":
    nightly_control()
    safety_control()
    print("synthetic samples written")
