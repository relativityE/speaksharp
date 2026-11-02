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
        done = P.complete(s, record("101", "failed", startedUtc="2026-10-31T19:00:00Z", endedUtc="2026-10-31T19:40:00Z"))  # a later occurrence
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
        self.assertEqual(set(state), {"schema", "latestCompleted", "inProgress", "history"})  # history: the bounded G7 carry-forward
        self.assertEqual(P.parse_body(body), state)


class CarryForward(unittest.TestCase):
    """G7 durable carry-forward (Sam 1793573813.598689): per-case last executed verdict and last-known-good across every completed night,
    bound to occurrences, ordered, replay- and predecessor-safe, size-bounded and closed; NOT RUN never erases prior evidence."""
    def night(self, state, run_id, ended, cases):
        st = P.begin(state, run_id, 1, SHA, "2026-11-0%sT03:00:00Z" % ended[9])
        rec = record(run_id, outcome="passed" if all(c["result"] == "PASS" for c in cases) else "failed", endedUtc=ended,
                     startedUtc="2026-11-0%sT03:00:00Z" % ended[9], cases=cases, coverage="batch" if all(c["result"] == "PASS" for c in cases) else "incomplete")
        return P.complete(st, rec)

    def case(self, cid, result):
        rows = {"PASS": {"pass": 6, "fail": 0, "notRun": 0}, "FAIL": {"pass": 4, "fail": 1, "notRun": 1},
                "NOT RUN": {"pass": 0, "fail": 0, "notRun": 6}}[result]
        return {"caseId": cid, "result": result, "rows": rows, "codes": []}

    def test_last_verdict_and_last_known_good_carry_forward_and_not_run_never_erases(self):
        s1 = self.night(P.parse_body(""), "201", "2026-11-01T08:00:00Z", [self.case("AHT-05", "PASS"), self.case("AHT-06", "PASS")])
        s2 = self.night(s1, "202", "2026-11-02T08:00:00Z", [self.case("AHT-05", "FAIL"), self.case("AHT-06", "NOT RUN")])
        h = s2["history"]
        self.assertEqual((h["sequence"], [o["runId"] for o in h["occurrences"]]), (2, ["201", "202"]))
        self.assertEqual(h["rows"]["AHT-05"], {"last": {"result": "FAIL", "runId": "202", "endedUtc": "2026-11-02T08:00:00Z"},
                                               "lastKnownGood": {"result": "PASS", "runId": "201", "endedUtc": "2026-11-01T08:00:00Z"}})
        self.assertEqual(h["rows"]["AHT-06"]["last"]["runId"], "201")  # NOT RUN on night 2 kept night 1's evidence
        self.assertEqual(h["predecessorSha256"], __import__("hashlib").sha256(P.canon(s1["history"])).hexdigest())
        self.assertEqual(P.parse_body(P.render(s2)), s2)  # the published bytes read back to exactly this state

    def test_replay_out_of_order_moved_predecessor_and_overflow_refuse_and_interruption_keeps_history(self):
        s1 = self.night(P.parse_body(""), "201", "2026-11-01T08:00:00Z", [self.case("AHT-05", "PASS")])
        rec = P.sanitize_record(record("201", endedUtc="2026-11-03T08:00:00Z", startedUtc="2026-11-03T03:00:00Z"))
        with self.assertRaises(P.Refused) as e:
            P.fold_history(s1["history"], rec, __import__("hashlib").sha256(P.canon(s1["history"])).hexdigest())
        self.assertEqual(str(e.exception), "history-replay")
        early = P.sanitize_record(record("199", startedUtc="2026-10-31T03:00:00Z", endedUtc="2026-10-31T08:00:00Z"))
        with self.assertRaises(P.Refused) as e:
            P.fold_history(s1["history"], early, __import__("hashlib").sha256(P.canon(s1["history"])).hexdigest())
        self.assertEqual(str(e.exception), "history-out-of-order")
        later = P.sanitize_record(record("202", endedUtc="2026-11-02T08:00:00Z", startedUtc="2026-11-02T03:00:00Z"))
        with self.assertRaises(P.Refused) as e:
            P.fold_history(s1["history"], later, "0" * 64)
        self.assertEqual(str(e.exception), "history-predecessor-moved")
        interrupted = P.interrupt(P.begin(s1, "202", 1, SHA, "2026-11-02T03:00:00Z"), "202", 1, "cancelled")
        self.assertEqual(interrupted["history"], s1["history"])
        full = dict(s1["history"], occurrences=[dict(s1["history"]["occurrences"][0], runId=str(300 + i), endedUtc="2026-12-%02dT08:00:00Z" % (i % 28 + 1))
                                                for i in range(P.MAX_OCCURRENCES)])
        with self.assertRaises(P.Refused):
            P.sanitize_history(full)  # not in order: refused
        with self.assertRaises(P.Refused) as e:
            P.sanitize_history(dict(s1["history"], occurrences=s1["history"]["occurrences"] * (P.MAX_OCCURRENCES + 1)))
        self.assertIn(str(e.exception), ("history-occurrences", "history-order"))

    def test_row_verdicts_carry_forward_per_row_and_a_catalog_change_refuses(self):
        def night(state, run_id, ended, verdicts):
            cases = [{"caseId": "AHT-05", "result": "PASS" if set(verdicts) == {"P"} else "FAIL",
                      "rows": {"pass": verdicts.count("P"), "fail": verdicts.count("F"), "notRun": verdicts.count("N")}, "codes": []}]
            if "F" not in verdicts and "N" in verdicts:
                cases[0]["result"] = "NOT RUN" if verdicts.count("P") == 0 else "FAIL"
            st = P.begin(state, run_id, 1, SHA, ended.replace("08:", "03:"))
            return P.complete(st, record(run_id, outcome="passed" if cases[0]["result"] == "PASS" else "failed", endedUtc=ended,
                                         startedUtc=ended.replace("08:", "03:"), cases=cases, rowVerdicts={"AHT-05": verdicts},
                                         coverage="batch" if cases[0]["result"] == "PASS" else "incomplete"))
        s1 = night(P.parse_body(""), "301", "2026-11-01T08:00:00Z", "PPP")
        s2 = night(s1, "302", "2026-11-02T08:00:00Z", "FNP")
        row = s2["history"]["rows"]["AHT-05"]
        self.assertEqual((row["rowLast"], row["rowLastAt"], row["rowGood"]), ("FPP", [1, 0, 1], [0, 0, 1]))  # N kept night 1's verdict
        with self.assertRaises(P.Refused) as e:
            night(s2, "303", "2026-11-03T08:00:00Z", "PPPP")
        self.assertEqual(str(e.exception), "history-catalog-changed")
        with self.assertRaises(P.Refused) as e:
            P.sanitize_record(record("304", rowVerdicts={"AHT-05": "PPF"}))  # inconsistent with the case's row counts
        self.assertEqual(str(e.exception), "row-verdicts")

    def test_the_fold_compares_each_row_only_under_the_same_identities(self):
        same = {"codeManifestSha256": "3" * 64, "packetManifestSha256": "4" * 64, "mediaManifestSha256": "5" * 64, "backendSha": "6" * 40}

        def night(state, run_id, ended, verdicts, comp):
            ok = set(verdicts) == {"P"}
            cases = [{"caseId": "AHT-05", "result": "PASS" if ok else "FAIL",
                      "rows": {"pass": verdicts.count("P"), "fail": verdicts.count("F"), "notRun": verdicts.count("N")}, "codes": []}]
            st = P.begin(state, run_id, 1, SHA, ended.replace("08:", "03:"))
            return P.complete(st, record(run_id, outcome="passed" if ok else "failed", endedUtc=ended, startedUtc=ended.replace("08:", "03:"),
                                         cases=cases, rowVerdicts={"AHT-05": verdicts}, comparability=comp,
                                         coverage="batch" if ok else "incomplete"))
        s1 = night(P.parse_body(""), "401", "2026-11-01T08:00:00Z", "PPF", same)
        s2 = night(s1, "402", "2026-11-02T08:00:00Z", "FPP", same)
        self.assertEqual(s2["history"]["lastComparison"], {"runId": "402", "regressions": {"AHT-05": 1}, "fixes": {"AHT-05": 1}, "notComparable": {}})
        # the comparison changes the real published outcome: codes and the rendered summary name the regression and the fix
        self.assertEqual([c for c in s2["latestCompleted"]["codes"] if c.startswith("row-")], ["row-regression", "row-fix"])
        self.assertIn("Row comparison for run 402: 1 regression(s), 1 fix(es), 0 not comparable", P.render(s2))
        self.assertEqual([c for c in s1["latestCompleted"]["codes"] if c.startswith("row-")], [])  # nothing earlier to compare with
        s3 = night(s2, "403", "2026-11-03T08:00:00Z", "PFP", dict(same, backendSha="7" * 40))
        self.assertEqual(s3["history"]["lastComparison"]["notComparable"], {"AHT-05": 3})  # a different backend: no regression/fix claimed
        self.assertEqual(P.parse_body(P.render(s3)), s3)

    def test_worst_case_history_fits_the_size_bound_and_a_larger_one_fails_closed(self):
        import json as _json
        catalog = _json.load(open(os.path.join(ROOT, "config", "assertion-catalog.json")))
        widths = {cid: len(c["requiredAssertions"]) for cid, c in catalog["cases"].items()}
        self.assertEqual(sum(widths.values()), 204)
        state = P.parse_body("")
        for i in range(P.MAX_OCCURRENCES):
            day = "2026-%02d-%02dT08:00:00Z" % (11 + i // 28, i % 28 + 1)
            st = P.begin(state, str(1000 + i), 1, SHA, day.replace("08:", "03:"))
            cases = [{"caseId": cid, "result": "PASS", "rows": {"pass": w, "fail": 0, "notRun": 0}, "codes": []} for cid, w in widths.items()]
            rec = record(str(1000 + i), endedUtc=day, startedUtc=day.replace("08:", "03:"), cases=cases, coverage="full",
                         campaignId="nightly-20261101T0000Z-%08d" % i, rowVerdicts={cid: "P" * w for cid, w in widths.items()},
                         comparability={"codeManifestSha256": "3" * 64, "packetManifestSha256": "4" * 64, "mediaManifestSha256": "5" * 64,
                                        "backendSha": "6" * 40})
            state = P.complete(st, rec)
        self.assertLessEqual(len(P.canon(state["history"])), P.MAX_HISTORY_BYTES)
        self.assertLessEqual(len(P.render(state)), P.MAX_BODY_CHARS)  # the whole comment stays under GitHub's body limit
        st = P.begin(state, "9999", 1, SHA, "2027-02-01T03:00:00Z")
        with self.assertRaises(P.Refused) as e:
            P.complete(st, record("9999", endedUtc="2027-02-01T08:00:00Z", startedUtc="2027-02-01T03:00:00Z"))
        self.assertEqual(str(e.exception), "history-overflow")  # never silently drops history


class Readback(unittest.TestCase):
    def test_the_stored_comment_must_be_exactly_the_rendered_record(self):
        import io
        from contextlib import redirect_stderr
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d)
        body = P.render(P.complete(started(P.parse_body("")), record()))
        exp = os.path.join(d, "body.md")
        with open(exp, "w") as f:
            f.write(body)

        def verify(stored):
            path = os.path.join(d, "readback-%d.json" % len(os.listdir(d)))
            with open(path, "w") as f:
                json.dump([comment(7, BOT, stored)], f)
            with redirect_stderr(io.StringIO()):
                return P.main(["publish_latest_record.py", "verify", "--previous", exp, "--comments", path, "--issue-url", URL, "--comment-id", "7"])
        self.assertEqual(verify(body), 0)
        self.assertEqual(verify(body.rstrip("\n")), 0)  # a trailing newline difference only
        self.assertEqual(verify(body.replace('"runId":"101"', '"runId":"102"')), 78)  # any other change refuses


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
