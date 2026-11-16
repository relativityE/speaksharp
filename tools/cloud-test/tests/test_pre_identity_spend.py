"""Consultant P1-4, bound on review of 7e07474b: a run whose admission stopped before its identity read settles its MEASURED usage only on
evidence bound to THIS execution. The positive shape is R10 run 42615792133's real receipts (A0-A5 PASS, A6.guard-selftest BLOCKED, A7
NOT_RUN, productionTrafficSent 0, identityDispatch NOT_RUN, binding to the campaign / tested release / window). Every foreign, stale,
missing or contradictory variant returns None, which keeps the settle at the reserved caps."""
import copy
import json
import os
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on the path)
import collect_run_record as C
import manual_reservation as M
import settle_input as SI

STAGES = list(C.ADMISSION_STAGES)
CAMPAIGN, TESTED, SOURCE = "R10-3b040043-smoke15", "5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2", "c" * 40
REQ = {"runId": CAMPAIGN, "release": {"testedSha": TESTED}}
STAGE_START, COLLECTED = "2026-11-09T12:25:55Z", "2026-11-09T12:27:13Z"


def admission(blocked_at="A6.guard-selftest", **over):
    i = STAGES.index(blocked_at)
    steps = [{"id": s, "result": "PASS" if n < i else "BLOCKED" if n == i else "NOT_RUN"} for n, s in enumerate(STAGES)]
    doc = {"schemaVersion": 3, "result": "BLOCKED_SETUP", "stage": blocked_at, "steps": steps, "productionTrafficSent": 0,
           "identityDispatch": "NOT_RUN", "startedAt": "2026-11-09T12:25:55.376Z", "endedAt": "2026-11-09T12:27:12.940Z",
           "binding": {"campaignId": CAMPAIGN, "sourceSha": TESTED, "approvedStartAt": "2026-11-09T12:17:36Z",
                       "approvedDeadlineAt": "2026-11-09T12:55:28Z"}}
    doc.update(over)
    return doc


PREFLIGHT = {"schema": "speaksharp.cloud-test.prerequisite-preflight.v1", "runId": CAMPAIGN, "sourceSha": SOURCE,
             "observedAt": "2026-11-09T12:24:10.000Z", "mutationCount": 0, "charges": {"auth": 2, "signedIn": 8, "total": 10}}


class PreIdentitySpend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self.tmp.name)
        self.run_root = os.path.join(self.root, "plan", "run")
        os.makedirs(os.path.join(self.run_root, "admission"))
        self.cases = os.path.join(self.run_root, "cases")
        self.adm_path = os.path.join(self.run_root, "admission", "admission-receipt.json")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, path, doc):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        return path

    def spend(self, adm=None, pre=PREFLIGHT, req=REQ, source=SOURCE, cases=None, adm_path=None, start=STAGE_START, end=COLLECTED):
        path = adm_path or self.adm_path
        if adm is not False:
            self.write(path, admission() if adm is None else adm)
        pre_path = self.write(os.path.join(self.root, "pre.json"), pre) if pre is not None else None
        return C.pre_identity_spend(path, pre_path, self.cases if cases is None else cases, req, source, start, end)

    def test_a_bound_stop_before_the_identity_read_is_measured_and_settles_as_a_setup_failure(self):
        for stage in STAGES:            # A7 included: blocked before its dispatch (identityDispatch NOT_RUN), e.g. the route probe
            with self.subTest(stage):
                s = self.spend(admission(stage))
                self.assertEqual({k: s[k] for k in ("requests", "identityReads", "starts", "takes", "coachingRequests")},
                                 {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0})
                self.assertIn(stage, s["source"])
        record = json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": CAMPAIGN, "spend": self.spend(),
                             "executionProvenance": {"campaignId": CAMPAIGN, "runId": "42615792133", "attempt": 1,
                                                     "requestSha256": "a" * 64}}).encode()
        projected = SI.validate(SI.project(record))
        self.assertEqual(projected["spend"], {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0})
        reserved = {"type": "reserve", "campaignId": CAMPAIGN, "runId": "42615792133", "attempt": 1, "provenance": "request-sha256:" + "a" * 64}
        orig = M._identity
        M._identity = lambda r: {k: r[k] for k in ("campaignId", "runId", "attempt")}
        try:
            usage, _ = M.usage_from_record(record, reserved)
        finally:
            M._identity = orig
        self.assertEqual(usage, {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": None})
        import init_run_inputs as I
        self.assertLessEqual(usage["requests"], I.SETUP_FAILURE_MAX_REQUESTS)

    def test_foreign_stale_missing_or_contradictory_admission_evidence_keeps_the_caps(self):
        def steps_with(index, result, base="A6.guard-selftest"):
            doc = admission(base)
            doc["steps"][index]["result"] = result
            return doc
        reordered = admission()
        reordered["steps"] = list(reversed(reordered["steps"]))
        bad = {
            "foreign campaign": admission(binding=dict(admission()["binding"], campaignId="R9-other")),
            "wrong tested release": admission(binding=dict(admission()["binding"], sourceSha="d" * 40)),
            "no binding (A0 never passed)": admission("A0.config", binding=None),
            "old window": admission(binding=dict(admission()["binding"], approvedStartAt="2026-11-08T10:00:00Z",
                                                 approvedDeadlineAt="2026-11-08T11:00:00Z")),
            "started before this run stage": admission(startedAt="2026-11-09T12:20:00.000Z"),
            "ended after the approved deadline": admission(binding=dict(admission()["binding"], approvedDeadlineAt="2026-11-09T12:27:00Z")),
            "ended after collection": admission(endedAt="2026-11-09T12:40:00.000Z"),
            "unparseable times": admission(startedAt="yesterday"),
            "invalid schema": admission(schemaVersion=2),
            "inconsistent stage": admission(stage="A5.browser"),
            "A7 blocked after its dispatch": admission("A7.identity", identityDispatch="ATTEMPTED_OR_AMBIGUOUS",
                                                       productionTrafficSent="UNKNOWN_PENDING_IDENTITY_RECEIPT"),
            "identity attempted": admission(identityDispatch="ATTEMPTED_OR_AMBIGUOUS"),
            "traffic sent": admission(productionTrafficSent=1), "traffic as bool": admission(productionTrafficSent=False),
            "admission passed": admission(result="ADMISSION PASS"),
            "two blocked": steps_with(7, "BLOCKED"), "a later step ran": steps_with(7, "PASS"),
            "an earlier step did not pass": steps_with(2, "NOT_RUN"), "steps reordered": reordered, "no steps": admission(steps=None),
        }
        for label, adm in bad.items():
            with self.subTest(label):
                self.assertIsNone(self.spend(adm))
        with self.subTest("no admission receipt"):
            self.assertIsNone(self.spend(False))

    def test_foreign_or_stale_preflight_evidence_keeps_the_caps(self):
        bad = {"missing": None, "foreign campaign": dict(PREFLIGHT, runId="R9-other"), "another source": dict(PREFLIGHT, sourceSha="e" * 40),
               "observed before the window": dict(PREFLIGHT, observedAt="2026-11-09T11:00:00.000Z"),
               "observed after the run stage started": dict(PREFLIGHT, observedAt="2026-11-09T12:26:30.000Z"),
               "a mutation": dict(PREFLIGHT, mutationCount=1), "other charges": dict(PREFLIGHT, charges={"auth": 2, "signedIn": 9, "total": 11}),
               "other schema": dict(PREFLIGHT, schema="x")}
        for label, pre in bad.items():
            with self.subTest(label):
                self.assertIsNone(self.spend(pre=pre))
        for label, source in {"no workflow source given": None, "malformed workflow source": "abc"}.items():
            with self.subTest(label):
                self.assertIsNone(self.spend(source=source))

    def test_the_paths_and_the_absence_of_cases_must_be_positive(self):
        with self.subTest("cases directory omitted"):
            self.assertIsNone(self.spend(cases=""))
            self.assertIsNone(C.pre_identity_spend(self.adm_path, None, None, REQ, SOURCE, STAGE_START, COLLECTED))
        with self.subTest("relative cases directory"):
            self.assertIsNone(self.spend(cases="plan/run/cases"))
        with self.subTest("a case directory exists"):
            os.mkdir(self.cases)
            self.assertIsNone(self.spend())
            os.rmdir(self.cases)
        with self.subTest("run root missing"):
            self.assertIsNone(self.spend(cases=os.path.join(self.root, "elsewhere", "cases")))
        with self.subTest("admission receipt not at <run root>/admission"):
            other = os.path.join(self.root, "admission-receipt.json")
            self.assertIsNone(self.spend(adm_path=other))
        with self.subTest("a symlinked receipt"):
            real = self.write(os.path.join(self.root, "real.json"), admission())
            os.path.lexists(self.adm_path) and os.remove(self.adm_path)
            os.symlink(real, self.adm_path)
            self.assertIsNone(self.spend(adm=False))
            os.remove(self.adm_path)
        with self.subTest("the admission directory is a symlink to a real directory elsewhere"):
            outside = os.path.join(self.root, "outside-admission")
            os.mkdir(outside)
            self.write(os.path.join(outside, "admission-receipt.json"), admission())
            real_dir = os.path.join(self.run_root, "admission")
            os.rename(real_dir, real_dir + ".real")
            os.symlink(outside, real_dir)
            self.assertIsNone(C.pre_identity_spend(self.adm_path, self.write(os.path.join(self.root, "pre.json"), PREFLIGHT), self.cases,
                                                   REQ, SOURCE, STAGE_START, COLLECTED))
            os.remove(real_dir)
            os.rename(real_dir + ".real", real_dir)
        with self.subTest("the run root is reached through a symlinked ancestor"):
            link_parent = os.path.join(self.root, "plan-link")
            os.symlink(os.path.join(self.root, "plan"), link_parent)
            via = os.path.join(link_parent, "run")
            self.write(self.adm_path, admission())
            self.assertIsNone(C.pre_identity_spend(os.path.join(via, "admission", "admission-receipt.json"),
                                                   self.write(os.path.join(self.root, "pre.json"), PREFLIGHT), os.path.join(via, "cases"),
                                                   REQ, SOURCE, STAGE_START, COLLECTED))
        with self.subTest("the preflight receipt is reached through a symlinked parent"):
            pre_dir = os.path.join(self.root, "pre-real")
            os.mkdir(pre_dir)
            self.write(os.path.join(pre_dir, "receipt.json"), PREFLIGHT)
            os.symlink(pre_dir, os.path.join(self.root, "pre-link"))
            self.write(self.adm_path, admission())
            self.assertIsNone(C.pre_identity_spend(self.adm_path, os.path.join(self.root, "pre-link", "receipt.json"), self.cases,
                                                   REQ, SOURCE, STAGE_START, COLLECTED))
        with self.subTest("unparseable receipt"):
            with open(self.adm_path, "w", encoding="utf-8") as f:
                f.write("{not json")
            self.assertIsNone(self.spend(adm=False))
        with self.subTest("no request binding"):
            self.assertIsNone(self.spend(req={"runId": CAMPAIGN}))
        with self.subTest("unparseable run-stage times"):
            self.assertIsNone(self.spend(start="x"))


if __name__ == "__main__":
    unittest.main()


class ProjectionAgreesWithTheDirectSettle(unittest.TestCase):
    """Review of 50647108: the projection drops byCategory, so a contradictory claimed coaching 0 must refuse BEFORE projection; the direct
    and the projected settle can never disagree."""
    def record(self, **spend):
        base = {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "byCategory": {"preflight": 10}}
        base.update(spend)
        return json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": CAMPAIGN, "spend": base,
                           "executionProvenance": {"campaignId": CAMPAIGN, "runId": "42615792133", "attempt": 1, "requestSha256": "a" * 64}}).encode()

    def direct(self, raw):
        reserved = {"type": "reserve", "campaignId": CAMPAIGN, "runId": "42615792133", "attempt": 1, "provenance": "request-sha256:" + "a" * 64}
        orig = M._identity
        M._identity = lambda r: {k: r[k] for k in ("campaignId", "runId", "attempt")}
        try:
            return M.usage_from_record(raw, reserved)[0]
        finally:
            M._identity = orig

    def test_a_contradictory_claimed_zero_refuses_both_directly_and_at_projection(self):
        for label, spend in {"coaching category count": {"byCategory": {"preflight": 10, "coaching": 3}}, "a take": {"takes": 1},
                             "a Start": {"starts": 1}, "an identity read": {"identityReads": 1}, "unmeasured takes": {"takes": None}}.items():
            with self.subTest(label):
                raw = self.record(**spend)
                with self.assertRaises(M.Refused):
                    self.direct(raw)
                with self.assertRaises(SI.Refused):
                    SI.project(raw)

    def test_a_consistent_zero_settles_the_same_directly_and_projected(self):
        raw = self.record()
        self.assertEqual(self.direct(raw), self.direct(SI.project(raw)))
        self.assertEqual(self.direct(raw)["coachingRequests"], 0)
