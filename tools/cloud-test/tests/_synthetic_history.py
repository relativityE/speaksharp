"""A complete SYNTHETIC retained history for the current test suite: R4/R4B (ledgers only) and R4C/R5 (all 15 journeys), sealed through the
real sealer, with the history index built by history_index.py itself, owner counters and a config copy that pins exactly this history.

Every number comes from tests/fixtures/synthetic-history/inputs.v1.json. Nothing here is a real campaign, account, usage figure or approval, and no
retained private campaign history is read. It still depends on public, tracked inputs: the repository's Git history (servedSha values are public
commits), config/history/catalogs and the tracked request and comparison fixtures. When the migration is complete, the historical-audit suite
(tests/legacy_audit) is the only place the real retained campaigns are read."""
import copy
import datetime
import json
import os
import tempfile

from _fixtures import ROOT, J, wjson
from _synthetic_receipts import seal_in_place

from _common import sha256_file
import history_index as HI
import reservations as R
from run_offline_checks import PROOF_CORRECTIONS

INPUTS = os.path.join(ROOT, "tests", "fixtures", "synthetic-history", "inputs.v1.json")
CATS = ("public", "navigations", "preflight", "auth", "signed-in", "model", "coaching")


def inputs():
    with open(INPUTS, encoding="utf-8") as f:
        return json.load(f)


def case_spec(run, cid):
    """The declared per-case figures of a full run: the run's defaults with that case's overrides."""
    return dict(run["case"], **run.get("cases", {}).get(cid, {}))


def rows_executed(spec, required):
    n = spec["rowsExecuted"]
    return required if n == "all" else (required + 1) // 2 if n == "half" else int(n)


def case_requests(spec):
    """Requests a case adds to the campaign ledger: navigations are counted inside public, so they are not added again."""
    return sum(spec[k] for k in CATS if k != "navigations")


def _utc(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _full_run(root, run, start, catalog):
    label, sha = run["label"], run["servedSha"]
    base = os.path.join(root, label)
    os.makedirs(base)
    t = start
    used = dict.fromkeys(CATS, 0)
    used["total"] = 0
    identity = 0
    fails = {tuple(f) for f in run.get("fail", [])}
    cases, plan_cases = [], []
    for cid in sorted(catalog["cases"], key=lambda c: int(c.split("-")[1])):
        spec, required = case_spec(run, cid), catalog["cases"][cid]["requiredAssertions"]
        d = os.path.join(base, cid)
        os.makedirs(d)
        executed = rows_executed(spec, len(required))
        rows, digests = [], {}
        for i, a in enumerate(required, 1):
            result = "NOT RUN" if i > executed else ("FAIL" if (cid, i) in fails else "PASS")
            ref = "fact-%d.json" % i
            wjson(os.path.join(d, ref), {"synthetic": True, "contentSafe": True, "caseId": cid, "assertion": a, "result": result})
            digests[ref] = sha256_file(os.path.join(d, ref))
            rows.append({"id": a, "result": result, "detail": "synthetic", "evidenceRefs": [ref]})
        for k in CATS:
            used[k] += spec[k]
        used["total"] += case_requests(spec)
        ended = t + datetime.timedelta(seconds=spec["wallSeconds"])
        exhausted = spec.get("reason") == "allowance-exhausted"
        summary = {"synthetic": True, "startedAt": _utc(t), "endedAt": _utc(ended), "reason": spec.get("reason", "complete"),
                   "guard": {"counters": {"connectRefused": spec["connectRefused"], "denied": {}},
                             "caseAllowance": {"allowance": case_requests(spec), "exhausted": exhausted}}}
        wjson(os.path.join(d, "summary.json"), summary)
        with open(os.path.join(d, "guard.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "stop", "summary": {"ledgerUsed": dict(used)}}) + "\n")
        with open(os.path.join(d, "action-reservations.jsonl"), "w", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "case-action-budget", "caseId": cid, "limits": {"startPresses": spec["starts"], "takeAttempts": spec["takes"]}}) + "\n")
            for kind, n in (("start", spec["starts"]), ("take", spec["takes"])):
                for i in range(n):
                    f.write(json.dumps({"kind": kind, "ordinal": i + 1, "caseId": cid}) + "\n")
        with open(os.path.join(d, "step.log"), "w", encoding="utf-8") as f:
            f.write("SYNTHETIC %s %s\n" % (label, cid))
        before = {"result": "MATCH", "servedSha": sha, "expectedSha": sha, "identityGetsUsed": identity + 1}
        identity += 2
        after = {"result": "MATCH", "servedSha": sha, "expectedSha": sha, "identityGetsUsed": identity}
        result = "FAIL" if any(r["result"] == "FAIL" for r in rows) else ("PASS" if executed == len(required) else "NOT RUN")
        wjson(os.path.join(d, "case-result.json"), {"caseId": cid, "result": result, "assertions": rows, "evidenceDigests": digests, "contentSafe": True})
        cases.append({"caseId": cid, "result": result, "assertions": rows, "identityBefore": before, "identityAfter": after,
                      "executionReceipt": {"summarySha256": sha256_file(os.path.join(d, "summary.json"))},
                      "requestsUsed": case_requests(spec), "plannedRequests": case_requests(spec), "requestAllowance": case_requests(spec)})
        plan_cases.append({"id": cid, "driverSha256": run["driverSha256"], "configSha256": "f" * 64, "mediaSha256": "b" * 64})
        t = ended
    # The 151 requirement rows of the product requirements map: AHT-NN rows take their journey's verdict, the rest stay unmapped.
    reqs = [{"requirementId": rid, "title": "synthetic " + rid, "categoryId": "PG0%d" % (1 + i % 7), "layer": "agent-served",
             "result": "NOT RUN", "reason": "unmapped"}
            for i, rid in enumerate(["AHT-%02d" % n for n in range(1, 16)] + ["REQ-%03d" % n for n in range(15, 151)])]
    wjson(os.path.join(base, "case-results.json"), {"synthetic": True, "campaignId": label, "sourceSha": sha, "servedSha": sha,
                                                    "result": "FAIL" if any(c["result"] == "FAIL" for c in cases) else "PARTIAL",
                                                    "fullAcceptance": "NOT RUN", "safetyStopped": False, "finalIdentity": "MATCH",
                                                    "identityReceipts": [{"result": "MATCH", "servedSha": sha, "phase": "admission", "identityGetsUsed": 0}],
                                                    "validationRequirements": reqs, "cases": cases})
    wjson(os.path.join(base, "campaign-ledger.json"), {"synthetic": True, "used": used, "created": _utc(start), "updated": _utc(t)})
    # One MATCH receipt per identity read (admission, each case before/after, final), timed within the run: the frontend deployment evidence
    # verify_release.py reads from a sealed identity ledger.
    receipts = [{"result": "MATCH", "servedSha": sha, "phase": "read-%d" % n, "startedAt": _utc(start + (t - start) * n / (identity + 1))}
                for n in range(identity + 2)]
    wjson(os.path.join(base, "identity-ledger.json"), {"synthetic": True, "identityGets": identity + 2, "receipts": receipts})
    wjson(os.path.join(base, "campaign-plan.json"), {"synthetic": True, "campaignId": label, "servedSha": sha, "scope": "OFFLINE FIXTURE ONLY",
                                                     "stepManifestSha256": "d" * 64, "runtime": "synthetic",
                                                     "requestBudget": bool(run.get("requestBudget")), "cases": plan_cases})
    with open(os.path.join(base, "plan.sha"), "w", encoding="utf-8") as f:
        f.write(sha256_file(os.path.join(base, "campaign-plan.json")))
    return seal_in_place(base, label), t


def _ledgers_only(root, run, start):
    base = os.path.join(root, run["label"])
    os.makedirs(base)
    wjson(os.path.join(base, "case-results.json"), {"synthetic": True, "campaignId": run["label"], "sourceSha": run["servedSha"],
                                                    "servedSha": run["servedSha"], "result": "NOT RUN", "cases": [], "finalIdentity": "NOT RUN"})
    wjson(os.path.join(base, "campaign-ledger.json"), {"synthetic": True, "used": {"total": run["requests"]}, "updated": _utc(start)})
    wjson(os.path.join(base, "identity-ledger.json"), {"synthetic": True, "identityGets": run["identityGets"], "receipts": []})
    return seal_in_place(base, run["label"])


def catalog_version(cfg):
    """The catalog snapshot version the current catalog belongs to, as recorded in config/history/catalogs."""
    current = J("config", "assertion-catalog.json")
    snaps = sorted(int(n[1:-5]) for n in os.listdir(os.path.join(ROOT, "config", "history", "catalogs")) if n.startswith("v") and n.endswith(".json"))
    return next((v for v in reversed(snaps) if J("config", "history", "catalogs", "v%d.json" % v) == current), snaps[-1])


class SyntheticHistory:
    """root/receipts/<label>, root/index.json, root/owner-counters.json and root/test-config.json pin one synthetic history.
    Pass these paths to the scripts (--config, --receipts-root, --history-index, --counters, --reservations); no retained private campaign history
    is used (the public config/history/catalogs snapshots still are)."""

    def __init__(self):
        spec = inputs()
        self.root = tempfile.mkdtemp(prefix="ct-synthetic-history-")
        self.receipts = os.path.join(self.root, "receipts")
        os.makedirs(self.receipts)
        catalog = J("config", "assertion-catalog.json")
        self.cfg = copy.deepcopy(J("config", "test-config.v1.json"))
        t = datetime.datetime.strptime(spec["startUtc"], "%Y-%m-%dT%H:%M:%SZ")
        runs = []
        for run in spec["runs"]:
            if run.get("ledgersOnly"):
                pin = _ledgers_only(self.receipts, run, t)
            else:
                pin, t = _full_run(self.receipts, run, t, catalog)
            runs.append({"label": run["label"], "campaignId": run["label"], "servedSha": run["servedSha"],
                         "ledgersOnly": bool(run.get("ledgersOnly")), "receiptsDir": "receipts/" + run["label"], "receiptsManifestSha256": pin})
        self.cfg["history"]["runs"] = runs
        self.cfg["history"]["order"] = [r["label"] for r in runs]
        self.index = os.path.join(self.root, "index.json")
        index = HI.wrap(HI.derive(self.cfg, self.receipts, catalog_version(self.cfg)))
        wjson(self.index, index)
        self.cfg["history"]["index"] = dict(self.cfg["history"]["index"], file=self.index, headHash=index["headHash"])
        c = spec["counters"]
        self.counters_doc = {"synthetic": True, "scope": "NO LIVE AUTHORITY", "statedThroughRun": c["statedThroughRun"],
                             "frozen": {"throughRun": c["statedThroughRun"], "asOfUtc": c["frozenAsOfUtc"]}, "requests": c["requests"],
                             "identityReadsCumulative": c["identityReadsCumulative"], "startsCumulative": c["startsCumulative"],
                             "takesCumulative": c["takesCumulative"], "ceilings": c["ceilings"]}
        self.counters = os.path.join(self.root, "owner-counters.json")
        wjson(self.counters, self.counters_doc)
        # An empty reservation ledger (no run holds caps), written by reservations.py's own constructor.
        self.reservations = os.path.join(self.root, "reservations.json")
        wjson(self.reservations, R.empty())
        self.cfg["nightly"] = dict(self.cfg["nightly"], reservationsFile=self.reservations)
        # The analyst facts/overlay pinned for the real R5-vs-R4C pair belong to the historical audit; the synthetic comparison is generated
        # from the synthetic receipts alone (compare_latest uses analyst inputs only when the config pins them for the pair).
        self.cfg["history"]["analysis"] = {}
        self.config = os.path.join(self.root, "test-config.json")
        wjson(self.config, self.cfg)
        # A SYNTHETIC offline-proof document of the shape offline_proof.py writes, so report and gate logic can be exercised. It is not a
        # proof of anything; the real proof is generated in the GitHub job (generate_offline_proof.py) and judged there.
        self.proof = os.path.join(self.root, "offline-proof.synthetic.json")
        wjson(self.proof, {"synthetic": True, "result": "PASS", "codeManifestSha256": self.cfg["harness"]["expectedCodeManifestSha256"],
                           "testsPassed": 24, "testsFailed": 0,
                           "planControls": {"positive": 3, "positiveAccepted": 3, "negative": 11, "negativeRefused": 11},
                           "corrections": [{"id": c, "correction": "synthetic " + c, "result": "PASS", "tests": ["T%d" % i], "mutationControls": ["M%02d" % i]}
                                           for i, c in enumerate(PROOF_CORRECTIONS, 1)]})
        # SYNTHETIC binding-verification results for the compared runs, in verify_run_binding.py's output shape. The verifier itself is
        # tested on its own inputs; these only stand in for its results so the gate and report logic can be exercised.
        self.bindings = {}
        for run in runs:
            if run["ledgersOnly"]:
                continue
            path = os.path.join(self.root, "binding-%s.json" % run["label"])
            wjson(path, {"synthetic": True, "schema": "speaksharp.cloud-test.run-binding.v1", "label": run["label"],
                         "caseResultsSha256": sha256_file(os.path.join(self.receipts, run["label"], "case-results.json")),
                         "planSha256": sha256_file(os.path.join(self.receipts, run["label"], "campaign-plan.json")),
                         "codeManifestSha256": self.cfg["harness"]["expectedCodeManifestSha256"], "passed": 1, "failed": 0,
                         "checks": [{"id": "synthetic", "description": "SYNTHETIC stand-in result", "result": "PASS", "detail": ""}]})
            self.bindings[run["label"]] = path
        self.inputs = spec

    def request(self, path):
        """A copy of a tracked request fixture whose harness proof and prior-run bindings point at this history's synthetic documents
        (absolute paths, so the scripts' os.path.join(ROOT, ...) keeps them); returns the new file's path."""
        with open(path, encoding="utf-8") as f:
            req = json.load(f)
        req["harness"]["offlineProofFile"] = self.proof
        for prior in req.get("priorRuns") or []:
            if prior.get("label") in self.bindings:
                prior["bindingFile"] = self.bindings[prior["label"]]
        out = os.path.join(tempfile.mkdtemp(prefix="ct-synthetic-request-"), os.path.basename(path))
        wjson(out, req)
        return out

    def args(self):
        """The pipeline/script arguments that select exactly this synthetic history."""
        return ["--config", self.config, "--receipts-root", self.receipts, "--history-index", self.index, "--counters", self.counters,
                "--reservations", self.reservations]


_SHARED = None


def shared():
    """One synthetic history per test process (read-only use); tests that mutate must build their own SyntheticHistory()."""
    global _SHARED
    if _SHARED is None:
        _SHARED = SyntheticHistory()
    return _SHARED
