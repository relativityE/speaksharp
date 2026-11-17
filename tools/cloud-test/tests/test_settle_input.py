"""The closed settle input : the public hand-off between the read-only live job and journal-settle carries only ids,
digests and counts, and settles exactly what the full run record would."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
import manual_reservation as M
import settle_input as S
from _fixtures import ROOT

REQUEST_SHA = "a" * 64
CAMPAIGN = "nightly-20261101T0000Z-20261102T0300Z"


def run_record(**over):
    rec = {"schema": M.RUN_RECORD_SCHEMA, "runId": CAMPAIGN,
           "cases": [{"case": "AHT-10", "verdict": "PASS", "rows": {"R10.1": "P"}}], "accountSubjectSha256": "c" * 64,
           "transcript": "content that must never leave the live job",
           "executionProvenance": {"campaignId": CAMPAIGN, "runId": "101", "attempt": 1, "requestSha256": REQUEST_SHA, "sourceSha": "4" * 40},
           "spend": {"requests": 120, "identityReads": 2, "starts": 3, "takes": None, "coachingRequests": 1, "githubRunnerMinutes": 300}}
    rec.update(over)
    return json.dumps(rec).encode()


def reserved():
    allocation = {k: 0 for k in M.CATS}
    allocation.update(requests=500, identityReads=4, starts=10, takes=10)
    return {"type": "reserve", "campaignId": CAMPAIGN, "runId": "101", "attempt": 1, "allocation": allocation,
            "provenance": "request-sha256:" + REQUEST_SHA, "atUtc": "2026-11-02T03:00:00Z"}


class SettleInput(unittest.TestCase):
    def test_only_ids_digests_and_counts_cross_and_the_settled_usage_is_unchanged(self):
        full = run_record()
        raw = S.project(full, b'{"projection":{}}')
        doc = json.loads(raw)
        self.assertEqual(set(doc), S.KEYS)
        self.assertEqual(doc["recordSha256"], hashlib.sha256(full).hexdigest())
        self.assertEqual(doc["case10ObservationSha256"], hashlib.sha256(b'{"projection":{}}').hexdigest())
        for leaked in (b"transcript", b"content that must", b"cases", b"R10.1", b"c" * 64, b"sourceSha", b"coachingRequests"):
            self.assertNotIn(leaked, raw)
        self.assertEqual(M.usage_from_record(raw, reserved())[0], M.usage_from_record(full, reserved())[0])
        self.assertEqual(S.validate(raw), doc)
        self.assertIsNone(json.loads(S.project(full))["case10ObservationSha256"])

    def test_a_foreign_or_malformed_record_never_projects(self):
        for over in ({"schema": "other"}, {"runId": "x" * 200}, {"spend": {"requests": -1}}, {"spend": {"requests": True}},
                     {"executionProvenance": {"campaignId": "other", "runId": "101", "attempt": 1, "requestSha256": REQUEST_SHA}},
                     {"executionProvenance": {"campaignId": CAMPAIGN, "runId": "x", "attempt": 1, "requestSha256": REQUEST_SHA}},
                     {"executionProvenance": {"campaignId": CAMPAIGN, "runId": "101", "attempt": 0, "requestSha256": REQUEST_SHA}},
                     {"executionProvenance": None}):
            self.assertRaises(S.Refused, S.project, run_record(**over))
        self.assertRaises(S.Refused, S.project, b"not json")

    def test_validation_is_closed_canonical_and_bounded(self):
        raw = S.project(run_record())
        doc = json.loads(raw)
        for bad in (dict(doc, extra=1), dict(doc, spend=dict(doc["spend"], transcript=0)),
                    dict(doc, executionProvenance=dict(doc["executionProvenance"], sourceSha="4" * 40)),
                    dict(doc, recordSha256="x"), dict(doc, case10ObservationSha256="y")):
            self.assertRaises(S.Refused, S.validate, S.canon(bad))
        self.assertRaises(S.Refused, S.validate, raw + b"\n")
        self.assertRaises(S.Refused, S.validate, json.dumps(doc, indent=1).encode())
        self.assertRaises(S.Refused, S.validate, b" " * (S.MAX_BYTES + 1))


class Cli(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d)
        self.record = os.path.join(self.d, "run-record.json")
        with open(self.record, "wb") as f:
            f.write(run_record())

    def cli(self, *args):
        p = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "settle_input.py"), *args], capture_output=True, text=True)
        return p.returncode, p.stderr.strip()

    def test_project_then_validate_with_or_without_an_observation(self):
        out = os.path.join(self.d, "settle-input.json")
        self.assertEqual(self.cli("project", "--record", self.record, "--case10-observation", os.path.join(self.d, "absent.json"),
                                  "--out", out), (0, ""))
        self.assertEqual(self.cli("validate", "--input", out), (0, ""))
        self.assertEqual(self.cli("project", "--record", self.record, "--out", out), (78, "BLOCKED_SETUP: settle-input-output-exists"))
        self.assertEqual(self.cli("validate", "--input", self.record), (78, "BLOCKED_SETUP: settle-input-shape"))


if __name__ == "__main__":
    unittest.main()
