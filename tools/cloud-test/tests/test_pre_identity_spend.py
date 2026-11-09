"""Consultant P1-4: a run whose admission stopped before its identity read settles its MEASURED usage, not the reservation. The shape is
R10 run 42615792133's real admission receipt (A0-A5 PASS, A6.guard-selftest BLOCKED, A7.identity NOT_RUN, productionTrafficSent 0,
identityDispatch NOT_RUN); requests are the prerequisite preflight's closed charge. Any missing, malformed or ambiguous evidence returns
None, which keeps today's settle at the reserved caps."""
import copy
import json
import os
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on the path)
import collect_run_record as C
import manual_reservation as M

STAGES = list(C.ADMISSION_STAGES)


def admission(blocked_at="A6.guard-selftest", **over):
    i = STAGES.index(blocked_at)
    steps = [{"id": s, "result": "PASS" if n < i else "BLOCKED" if n == i else "NOT_RUN"} for n, s in enumerate(STAGES)]
    doc = {"schemaVersion": 3, "result": "BLOCKED_SETUP", "stage": blocked_at, "steps": steps, "productionTrafficSent": 0,
           "identityDispatch": "NOT_RUN"}
    doc.update(over)
    return doc


PREFLIGHT = {"schema": "speaksharp.cloud-test.prerequisite-preflight.v1", "runId": "R10-3b040043-smoke15", "mutationCount": 0,
             "charges": {"auth": 2, "signedIn": 8, "total": 10}}


class PreIdentitySpend(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = self.tmp.name
        self.cases = os.path.join(self.d, "cases")

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, doc):
        path = os.path.join(self.d, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        return path

    def spend(self, adm, pre=PREFLIGHT):
        return C.pre_identity_spend(self.write("adm.json", adm) if adm is not None else os.path.join(self.d, "absent.json"),
                                    self.write("pre.json", pre) if pre is not None else None, self.cases)

    def test_a_stop_before_the_identity_read_is_measured_and_settles_as_a_setup_failure(self):
        for stage in STAGES[:-1]:
            with self.subTest(stage):
                s = self.spend(admission(stage))
                self.assertEqual({k: s[k] for k in ("requests", "identityReads", "starts", "takes")},
                                 {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0})
                self.assertIn(stage, s["source"])
        # Through the settle: requests 10 + identity 0, coaching 0, runner minutes at the cap: inside the one-off grant's setup-failure rule.
        record = json.dumps({"schema": M.RUN_RECORD_SCHEMA, "runId": "R10-3b040043-smoke15", "spend": self.spend(admission()),
                             "executionProvenance": {"campaignId": "R10-3b040043-smoke15", "runId": "42615792133", "attempt": 1,
                                                     "requestSha256": "a" * 64}}).encode()
        reserved = {"type": "reserve", "campaignId": "R10-3b040043-smoke15", "runId": "42615792133", "attempt": 1,
                    "provenance": "request-sha256:" + "a" * 64}
        orig = M._identity
        M._identity = lambda r: {k: r[k] for k in ("campaignId", "runId", "attempt")}
        try:
            usage, _ = M.usage_from_record(record, reserved)
        finally:
            M._identity = orig
        self.assertEqual(usage, {"requests": 10, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": 0, "runnerMinutes": None})
        import init_run_inputs as I
        self.assertLessEqual(usage["requests"], I.SETUP_FAILURE_MAX_REQUESTS)

    def test_any_doubt_keeps_the_reserved_caps(self):
        a7 = admission("A6.guard-selftest")
        a7["steps"][7]["result"] = "BLOCKED"
        two_blocked = admission("A5.browser")
        two_blocked["steps"][6]["result"] = "BLOCKED"
        later_ran = admission("A5.browser")
        later_ran["steps"][6]["result"] = "PASS"
        earlier_not_pass = admission("A6.guard-selftest")
        earlier_not_pass["steps"][2]["result"] = "NOT_RUN"
        reordered = admission()
        reordered["steps"] = list(reversed(reordered["steps"]))
        bad = {
            "identity stage blocked": admission("A7.identity"),
            "identity attempted": admission(identityDispatch="ATTEMPTED_OR_AMBIGUOUS"),
            "traffic pending": admission(productionTrafficSent="UNKNOWN_PENDING_IDENTITY_RECEIPT"),
            "traffic sent": admission(productionTrafficSent=1),
            "traffic as bool": admission(productionTrafficSent=False),
            "admission passed": admission(result="ADMISSION PASS"),
            "A7 also blocked": a7, "two blocked": two_blocked, "a later step ran": later_ran,
            "an earlier step did not pass": earlier_not_pass, "steps reordered": reordered,
            "no steps": admission(steps=None),
        }
        for label, adm in bad.items():
            with self.subTest(label):
                self.assertIsNone(self.spend(adm))
        with self.subTest("no admission receipt"):
            self.assertIsNone(self.spend(None))
        for label, pre in {"no preflight receipt": None, "a mutation": dict(PREFLIGHT, mutationCount=1),
                           "other charges": dict(PREFLIGHT, charges={"auth": 2, "signedIn": 9, "total": 11}),
                           "other schema": dict(PREFLIGHT, schema="x")}.items():
            with self.subTest(label):
                self.assertIsNone(self.spend(admission(), pre))
        with self.subTest("a case directory exists"):
            os.mkdir(self.cases)
            self.assertIsNone(self.spend(admission()))
            os.rmdir(self.cases)
        with self.subTest("a symlinked receipt"):
            real = self.write("real.json", admission())
            link = os.path.join(self.d, "link.json")
            os.symlink(real, link)
            self.assertIsNone(C.pre_identity_spend(link, self.write("pre.json", PREFLIGHT), self.cases))
        with self.subTest("unparseable receipt"):
            path = os.path.join(self.d, "junk.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{not json")
            self.assertIsNone(C.pre_identity_spend(path, self.write("pre.json", PREFLIGHT), self.cases))


if __name__ == "__main__":
    unittest.main()
