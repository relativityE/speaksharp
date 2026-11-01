"""The one latest-run record (Sam 1793471205.454429): selection never takes a foreign comment, the previous completed record survives until a
terminal replacement of the same attempt, an interrupted attempt blocks the next run, and only the closed record shape is ever rendered."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT
import publish_latest_record as P

SHA = "a" * 40
BOT = {"login": "github-actions[bot]", "type": "Bot"}
URL = "https://api.github.com/repos/relativityE/speaksharp/issues/1763"


def comment(cid, user, body, url=URL):
    return {"id": cid, "user": user, "body": body, "issue_url": url}


def record(run_id="101", outcome="passed", **over):
    rec = {"runId": run_id, "attempt": 1, "sourceSha": SHA, "testedSha": "b" * 40, "servedSha": "b" * 40, "campaignId": "R6-unit", "coverage": "batch", "requestSha256": "1" * 64, "catalogSha256": "2" * 64, "startedUtc": "2026-10-31T18:00:00Z",
           "endedUtc": "2026-10-31T18:40:00Z", "outcome": outcome,
           "cases": [{"caseId": "AHT-05", "result": "PASS", "rows": {"pass": 6, "fail": 0, "notRun": 0}, "codes": []}] if outcome == "passed" else
           [{"caseId": "AHT-05", "result": "FAIL", "rows": {"pass": 4, "fail": 1, "notRun": 1}, "codes": ["observed-product-contradiction"]}],
           "codes": []}
    rec.update(over)
    return rec


def started(state, run_id="101"):
    return P.begin(state, run_id, 1, SHA, "2026-10-31T18:00:00Z")


class Selection(unittest.TestCase):
    def test_first_publication_has_no_comment_and_an_empty_state(self):
        sel = P.select([comment(1, {"login": "someone", "type": "User"}, "unrelated")], URL)
        self.assertEqual(sel, {"commentId": None, "body": ""})
        self.assertEqual(P.parse_body(sel["body"]), {"schema": P.SCHEMA, "latestCompleted": None, "inProgress": None})

    def test_the_bots_marked_comment_on_the_bound_issue_is_selected_and_its_id_verified(self):
        body = P.render(P.parse_body(""))
        self.assertEqual(P.select([comment(7, BOT, body)], URL, comment_id=7)["commentId"], 7)
        with self.assertRaisesRegex(P.Refused, "comment-id"):
            P.select([comment(7, BOT, body)], URL, comment_id=8)

    def test_a_comment_from_another_issue_or_pr_is_refused(self):
        body = P.render(P.parse_body(""))
        for url in ("https://api.github.com/repos/relativityE/speaksharp/issues/1318", "https://api.github.com/repos/other/speaksharp/issues/1763"):
            with self.subTest(url=url), self.assertRaisesRegex(P.Refused, "comment-from-another-issue"):
                P.select([comment(7, BOT, body, url)], URL)
        with self.assertRaisesRegex(P.Refused, "issue-url"):
            P.select([], "not a url")

    def test_a_marker_in_a_human_or_other_bot_comment_is_refused_never_overwritten(self):
        body = P.render(P.parse_body(""))
        for user in ({"login": "relativityE", "type": "User"}, {"login": "other[bot]", "type": "Bot"}, {"login": "github-actions[bot]", "type": "User"}):
            with self.subTest(user=user), self.assertRaisesRegex(P.Refused, "marker-in-foreign-comment"):
                P.select([comment(7, BOT, body), comment(8, user, "quoting " + body)], URL)

    def test_two_bot_records_are_ambiguous(self):
        body = P.render(P.parse_body(""))
        with self.assertRaisesRegex(P.Refused, "ambiguous-latest-record"):
            P.select([comment(7, BOT, body), comment(9, BOT, body)], URL)

    def test_an_unreadable_or_edited_record_refuses(self):
        good = P.render(started(P.parse_body("")))
        for bad in (P.MARKER + "\nno json", good.replace("```json", "```json\n{}\n```\n```json"),
                    good.replace(P.SCHEMA, "other.schema"), good.replace('"inProgress"', '"extra": 1, "inProgress"')):
            with self.subTest(bad=bad[:40]), self.assertRaises(P.Refused):
                P.parse_body(bad)


class Lifecycle(unittest.TestCase):
    def test_begin_keeps_the_previous_completed_record_and_complete_replaces_it_only_with_this_attempt(self):
        first = P.complete(started(P.parse_body(""), "100"), record("100"))
        s = started(P.parse_body(P.render(first)), "101")
        self.assertEqual(s["latestCompleted"]["runId"], "100", "the previous completed record survives the new attempt")
        self.assertEqual(s["inProgress"]["status"], "running")
        with self.assertRaisesRegex(P.Refused, "record-not-the-running-attempt"):
            P.complete(s, record("102"))
        done = P.complete(s, record("101", "failed"))
        self.assertEqual((done["latestCompleted"]["runId"], done["latestCompleted"]["outcome"], done["inProgress"]), ("101", "failed", None))

    def test_an_interrupted_attempt_keeps_the_previous_record_and_blocks_the_next_run(self):
        first = P.complete(started(P.parse_body(""), "100"), record("100"))
        cut = P.interrupt(started(first, "101"), "101", 1, "cancelled")
        state = P.parse_body(P.render(cut))
        self.assertEqual(state["latestCompleted"]["runId"], "100")
        self.assertEqual(state["inProgress"]["status"], "cancelled")
        with self.assertRaisesRegex(P.Refused, "previous-attempt-unreconciled"):
            started(state, "102")
        with self.assertRaisesRegex(P.Refused, "record-not-the-running-attempt"):
            P.complete(state, record("101"))

    def test_a_rerun_attempt_and_a_recorded_run_are_refused(self):
        with self.assertRaisesRegex(P.Refused, "rerun-attempt-refused"):
            P.begin(P.parse_body(""), "101", 2, SHA, "2026-10-31T18:00:00Z")
        done = P.complete(started(P.parse_body("")), record("101"))
        with self.assertRaisesRegex(P.Refused, "run-already-recorded"):
            started(done, "101")

    def test_cancelled_is_not_a_terminal_record(self):
        with self.assertRaisesRegex(P.Refused, "terminal-outcome"):
            P.complete(started(P.parse_body("")), record(outcome="cancelled"))


class ClosedShape(unittest.TestCase):
    def test_any_field_outside_the_closed_record_is_refused(self):
        for mutate in (lambda r: r.update(email="someone@example.invalid"), lambda r: r.update(accountId="u-1"),
                       lambda r: r["cases"][0].update(transcript="words"), lambda r: r["cases"][0].update(codes=["Free text with spaces"]),
                       lambda r: r.update(codes=["x" * 65]), lambda r: r["cases"][0].update(caseId="AHT-16"),
                       lambda r: r["cases"][0]["rows"].update(extra=1), lambda r: r.update(sourceSha="A" * 40)):
            rec = record()
            mutate(rec)
            with self.subTest(rec=json.dumps(rec)[:60]), self.assertRaises(P.Refused):
                P.sanitize_record(rec)

    def test_statuses_must_agree_with_their_rows_and_the_outcome(self):
        rec = record()
        rec["cases"][0]["rows"]["notRun"] = 1
        with self.assertRaisesRegex(P.Refused, "case-result-rows"):
            P.sanitize_record(rec)
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(record(outcome="passed", cases=[]))
        # An all-PASS record is `failed` only when it says it was not qualified; it is never silently downgraded or upgraded.
        unqualified = dict(record(), outcome="failed", coverage="unqualified", campaignId=None, requestSha256=None, catalogSha256=None)
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(unqualified)
        self.assertEqual(P.sanitize_record(dict(unqualified, codes=["not-qualified"]))["outcome"], "failed")
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), coverage="unqualified", campaignId=None, requestSha256=None, catalogSha256=None))
        selected_only = record()
        selected_only["cases"] = selected_only["cases"] + [{"caseId": "AHT-06", "result": "NOT SELECTED", "rows": {"pass": 0, "fail": 0, "notRun": 0}, "codes": []}]
        self.assertEqual(P.sanitize_record(selected_only)["outcome"], "passed")
        for bad in ({"pass": 0, "fail": 0, "notRun": 1}, ):
            rows = record(); rows["cases"] = rows["cases"] + [{"caseId": "AHT-06", "result": "NOT SELECTED", "rows": bad, "codes": []}]
            with self.assertRaisesRegex(P.Refused, "not-selected-rows"):
                P.sanitize_record(rows)
        with self.assertRaisesRegex(P.Refused, "full-coverage-needs-fifteen-executed"):
            P.sanitize_record(dict(record(), coverage="full"))
        # Incomplete coverage is never passed, even when every row that ran is PASS; batch and full may be failed.
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), coverage="incomplete"))
        self.assertEqual(P.sanitize_record(dict(record(), coverage="incomplete", outcome="failed"))["coverage"], "incomplete")
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), outcome="failed"))  # a qualified batch whose executed rows all PASS is passed, not failed
        with self.assertRaisesRegex(P.Refused, "requestSha256"):
            P.sanitize_record(dict(record(), requestSha256="x"))
        with self.assertRaisesRegex(P.Refused, "not-selected-rows"):
            P.sanitize_record(dict(selected_only, coverage="unqualified", campaignId=None, requestSha256=None, catalogSha256=None, outcome="failed",
                                   codes=["not-qualified"]))
        with self.assertRaisesRegex(P.Refused, "tested-sha"):
            P.sanitize_record({k: v for k, v in record().items() if k != "testedSha"})
        self.assertEqual({k: P.sanitize_record(record())[k] for k in ("sourceSha", "testedSha", "servedSha")},
                         {"sourceSha": SHA, "testedSha": "b" * 40, "servedSha": "b" * 40})

    def test_the_rendered_body_holds_only_the_closed_state(self):
        body = P.render(P.complete(started(P.parse_body("")), record()))
        self.assertTrue(body.startswith(P.MARKER + "\n"))
        state = json.loads(P.JSON_BLOCK.findall(body)[0])
        self.assertEqual(set(state), {"schema", "latestCompleted", "inProgress"})
        self.assertEqual(P.parse_body(body), state)


class Cli(unittest.TestCase):
    def test_the_cli_writes_the_body_and_refuses_with_exit_78(self):
        d = tempfile.mkdtemp(prefix="ct-latest-record-")
        self.addCleanup(shutil.rmtree, d, True)
        script = os.path.join(ROOT, "scripts", "publish_latest_record.py")
        prev, out = os.path.join(d, "prev.md"), os.path.join(d, "out.md")
        open(prev, "w").close()
        ok = subprocess.run(["python3", "-I", script, "begin", "--previous", prev, "--run-id", "101", "--attempt", "1", "--source-sha", SHA,
                             "--started-utc", "2026-10-31T18:00:00Z", "--out", out], capture_output=True, text=True, timeout=60)
        self.assertEqual(ok.returncode, 0, ok.stderr)
        with open(out, encoding="utf-8") as f:
            self.assertEqual(P.parse_body(f.read())["inProgress"]["runId"], "101")
        again = subprocess.run(["python3", "-I", script, "begin", "--previous", out, "--run-id", "102", "--attempt", "1", "--source-sha", SHA,
                                "--started-utc", "2026-10-31T18:05:00Z", "--out", os.path.join(d, "x.md")], capture_output=True, text=True, timeout=60)
        self.assertEqual(again.returncode, 78)
        self.assertIn("previous-attempt-unreconciled", again.stderr)


if __name__ == "__main__":
    unittest.main()
