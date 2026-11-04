"""The evidence collector for retiring an attempt that never reserved anything. The journal fetch is replaced by a validated-chain stand-in;
the network is never touched. The end-to-end test feeds the collector's output straight into the recovery that consumes it."""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on sys.path)
import publish_latest_record as P
import state_ref_writer as W
import unreserved_attempt_evidence as E

RUN_ID = "41933223835"
SHA = "a" * 40
RUN = {"id": int(RUN_ID), "run_attempt": 1, "head_sha": SHA, "conclusion": "failure", "updated_at": "2026-11-04T23:23:13Z", "name": "ignored"}
JOBS = [("Record the attempt (latest-record comment; no live credentials)", "success"),
        ("Reserve the run on the state-ref journal (the one push before the run)", "failure"),
        ("Selected live journeys (existing stage runner; preinstalled browser)", "skipped"),
        ("Settle the run's reservation on the state-ref journal (the one push after the run)", "skipped")]


def jobs_page(extra=()):
    return {"total_count": len(JOBS), "jobs": [{"id": i, "name": n, "conclusion": c, "steps": ["ignored"]} for i, (n, c) in enumerate(list(JOBS) + list(extra))]}


def chain(*events):
    """[(sha, events, raw)] as state_ref_writer.validate_chain returns it: the root first, then one commit per appended event."""
    out, sofar = [(W.REVIEWED_ROOT, [], b"")], []
    for n, event in enumerate(events, 1):
        sofar = sofar + [event]
        out.append(("%040x" % n, list(sofar), b""))
    return out


class BuildEvidence(unittest.TestCase):
    def test_a_never_reserved_journal_yields_root_head_and_no_run_ids(self):
        ev = E.build_evidence(RUN, jobs_page(), chain(), "5" * 40)
        self.assertEqual(ev["journal"], {"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT, "runIds": []})
        self.assertEqual(ev["run"], {"runId": RUN_ID, "attempt": 1, "headSha": SHA, "conclusion": "failure", "updatedAt": "2026-11-04T23:23:13Z"})
        self.assertEqual([j["conclusion"] for j in ev["jobs"]], ["success", "failure", "skipped", "skipped"])
        self.assertTrue(all(set(j) == {"name", "conclusion"} for j in ev["jobs"]), "only names and conclusions are carried")
        self.assertNotIn("name", ev["run"])

    def test_every_event_run_id_in_the_journal_is_reported(self):
        ev = E.build_evidence(RUN, jobs_page(), chain({"runId": "111"}, {"runId": 222}, {"type": "x"}), "5" * 40)
        self.assertEqual(ev["journal"]["runIds"], ["111", "222"])
        self.assertNotEqual(ev["journal"]["headSha"], ev["journal"]["rootSha"])

    def test_pages_from_paginate_slurp_are_joined_and_a_malformed_document_refuses(self):
        pages = [jobs_page(), jobs_page(extra=[("Another job", "success")])]
        self.assertEqual(len(E.build_evidence(RUN, pages, chain(), "5" * 40)["jobs"]), len(JOBS) + len(JOBS) + 1)
        for bad in ({}, {"jobs": "no"}, [{"jobs": []}, 5]):
            with self.assertRaises(E.Refused):
                E.build_evidence(RUN, bad, chain(), "5" * 40)
        with self.assertRaises(E.Refused):
            E.build_evidence([], jobs_page(), chain(), "5" * 40)
        with self.assertRaises(E.Refused):
            E.journal_from_chain([])


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="ct-unreserved-ev-")
        self.addCleanup(shutil.rmtree, self.dir, True)

    def write(self, name, doc):
        path = os.path.join(self.dir, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f)
        return path

    def run_main(self, run, jobs, the_chain):
        out = os.path.join(self.dir, "evidence.json")
        argv = ["x", "--run", self.write("run.json", run), "--jobs", self.write("jobs.json", jobs), "--tested-sha", "5" * 40, "--out", out]
        with mock.patch.object(E, "fetch_chain", lambda: the_chain):
            code = E.main(argv)
        return code, out

    def test_the_collected_evidence_retires_the_incomplete_attempt(self):
        code, out = self.run_main(RUN, [jobs_page()], chain())
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as f:
            evidence = json.load(f)
        running = P.begin(P.parse_body(""), RUN_ID, 1, SHA, "2026-11-04T23:22:38Z")
        state = P.reconcile_unreserved(P.interrupt(running, RUN_ID, 1, "incomplete"), evidence)
        self.assertEqual((state["latestCompleted"]["runId"], state["inProgress"]), (RUN_ID, None))

    def test_the_recovery_refuses_when_the_journal_already_names_the_run(self):
        code, out = self.run_main(RUN, [jobs_page()], chain({"runId": RUN_ID}))
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as f:
            evidence = json.load(f)
        running = P.begin(P.parse_body(""), RUN_ID, 1, SHA, "2026-11-04T23:22:38Z")
        with self.assertRaisesRegex(P.Refused, "unreserved-journal-names-the-run"):
            P.reconcile_unreserved(P.interrupt(running, RUN_ID, 1, "incomplete"), evidence)

    def test_an_unreadable_input_or_a_failed_fetch_exits_78_and_writes_nothing(self):
        out = os.path.join(self.dir, "evidence.json")
        missing = ["x", "--run", os.path.join(self.dir, "none.json"), "--jobs", os.path.join(self.dir, "none.json"), "--tested-sha", "5" * 40, "--out", out]
        self.assertEqual(E.main(missing), 78)

        def refuse():
            raise W.Refused("state-ref-unavailable")
        argv = ["x", "--run", self.write("run.json", RUN), "--jobs", self.write("jobs.json", jobs_page()), "--tested-sha", "5" * 40, "--out", out]
        with mock.patch.object(E, "fetch_chain", refuse):
            self.assertEqual(E.main(argv), 78)
        self.assertFalse(os.path.exists(out))


if __name__ == "__main__":
    unittest.main()
