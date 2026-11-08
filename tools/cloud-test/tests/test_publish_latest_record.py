"""The one latest-run record (Sam 1793471205.454429): selection never takes a foreign comment, the previous completed record survives until a
terminal replacement of the same attempt, an interrupted attempt blocks the next run, and only the closed record shape is ever rendered."""
import json
import hashlib
import os
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

from _fixtures import ROOT
import publish_latest_record as P
import state_ref_writer as W

SHA = "a" * 40
BOT = {"login": "github-actions[bot]", "type": "Bot"}
URL = "https://api.github.com/repos/relativityE/speaksharp/issues/1763"


def comment(cid, user, body, url=URL, updated="2026-10-31T18:41:00Z"):
    return {"id": cid, "user": user, "body": body, "issue_url": url, "updated_at": updated}


def record(run_id="101", outcome="passed", **over):
    rec = {"runId": run_id, "attempt": 1, "sourceSha": SHA, "testedSha": "b" * 40, "servedSha": "b" * 40, "campaignId": "R6-unit", "coverage": "batch", "coverageMode": "partial", "assertionDepth": "full", "requestSha256": "1" * 64, "catalogSha256": "2" * 64, "startedUtc": "2026-10-31T18:00:00Z",
           "endedUtc": "2026-10-31T18:40:00Z", "outcome": outcome,
           "cases": [{"caseId": "AHT-05", "result": "PASS", "rows": {"pass": 6, "fail": 0, "notRun": 0}, "codes": []}] if outcome == "passed" else
           [{"caseId": "AHT-05", "result": "FAIL", "rows": {"pass": 4, "fail": 1, "notRun": 1}, "codes": ["observed-product-contradiction"]}],
           "codes": []}
    rec.update(over)
    if "coverage" in over and "coverageMode" not in over:
        mode = {"batch": "partial", "smoke": "smoke", "full": "full", "incomplete": "partial"}.get(rec["coverage"])
        if mode is None:
            rec.pop("coverageMode", None); rec.pop("assertionDepth", None)
        else:
            rec.update(coverageMode=mode, assertionDepth="smoke" if mode == "smoke" else "full")
    return rec


def started(state, run_id="101"):
    return P.begin(state, run_id, 1, SHA, "2026-10-31T18:00:00Z")


def receipt_bytes(**over):
    value = {"ref": "refs/heads/cloud-test-state", "previousSha": "1" * 40, "newSha": "2" * 40,
             "ledgerBlobSha256": "3" * 64, "proposalSha256": "4" * 64}
    value.update(over)
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def occurrence_bytes(**over):
    value = {"runId": "R6-unit", "window": {"endUtc": "2026-10-31T19:00:00Z"}}
    value.update(over)
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def completion_evidence(running, deadline="2026-10-31T19:00:00Z", rec=None, occurrence=None):
    rec = record() if rec is None else rec
    settle, occurrence = receipt_bytes(), occurrence_bytes() if occurrence is None else occurrence
    pending = P.pending_completion(running, rec, deadline, hashlib.sha256(settle).hexdigest(),
                                   hashlib.sha256(occurrence).hexdigest())
    public_body = P.render(pending)
    candidate_body = P.render(P.complete(running, rec))
    published = {"updated_at": "2026-10-31T18:41:00Z", "body": public_body}
    attestation = P.completion_attestation(candidate_body, public_body, published,
                                           hashlib.sha256(settle).hexdigest(), hashlib.sha256(occurrence).hexdigest())
    return pending, public_body, settle, occurrence, attestation


class Selection(unittest.TestCase):
    def test_first_publication_has_no_comment_and_an_empty_state(self):
        sel = P.select([comment(1, {"login": "someone", "type": "User"}, "unrelated")], URL)
        self.assertEqual(sel, {"commentId": None, "body": "", "updatedAt": None})
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
        unqualified = dict(record(), outcome="failed", coverage="unqualified", coverageMode=None, assertionDepth=None,
                           campaignId=None, requestSha256=None, catalogSha256=None)
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(unqualified)
        self.assertEqual(P.sanitize_record(dict(unqualified, codes=["not-qualified"]))["outcome"], "failed")
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), coverage="unqualified", coverageMode=None, assertionDepth=None,
                                   campaignId=None, requestSha256=None, catalogSha256=None))
        selected_only = record()
        selected_only["cases"] = selected_only["cases"] + [{"caseId": "AHT-06", "result": "NOT SELECTED", "rows": {"pass": 0, "fail": 0, "notRun": 0}, "codes": []}]
        self.assertEqual(P.sanitize_record(selected_only)["outcome"], "passed")
        for bad in ({"pass": 0, "fail": 0, "notRun": 1}, ):
            rows = record(); rows["cases"] = rows["cases"] + [{"caseId": "AHT-06", "result": "NOT SELECTED", "rows": bad, "codes": []}]
            with self.assertRaisesRegex(P.Refused, "not-selected-rows"):
                P.sanitize_record(rows)
        with self.assertRaisesRegex(P.Refused, "full-coverage-needs-fifteen-executed"):
            P.sanitize_record(dict(record(), coverage="full", coverageMode="full", assertionDepth="full"))
        # Incomplete coverage is never passed, even when every row that ran is PASS; batch and full may be failed.
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), coverage="incomplete"))
        self.assertEqual(P.sanitize_record(dict(record(), coverage="incomplete", outcome="failed"))["coverage"], "incomplete")
        with self.assertRaisesRegex(P.Refused, "outcome-cases"):
            P.sanitize_record(dict(record(), outcome="failed"))  # a qualified batch whose executed rows all PASS is passed, not failed
        with self.assertRaisesRegex(P.Refused, "requestSha256"):
            P.sanitize_record(dict(record(), requestSha256="x"))
        with self.assertRaisesRegex(P.Refused, "not-selected-rows"):
            P.sanitize_record(dict(selected_only, coverage="unqualified", coverageMode=None, assertionDepth=None,
                                   campaignId=None, requestSha256=None, catalogSha256=None, outcome="failed",
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

    def test_smoke_publishes_terminal_results_but_never_becomes_acceptance_history(self):
        smoke = P.sanitize_record(dict(record(), coverage="smoke", coverageMode="smoke", assertionDepth="smoke", rowVerdicts={"AHT-05": "PPPPPP"},
                                       comparability={"codeManifestSha256": "3" * 64, "packetManifestSha256": "4" * 64,
                                                      "mediaManifestSha256": "5" * 64, "backendSha": "6" * 40},
                                       evidence={"planSha256": "7" * 64, "caseResultsSha256": "8" * 64}))
        done = P.complete(started(P.parse_body("")), smoke)
        self.assertEqual((done["latestCompleted"]["coverage"], done["latestCompleted"]["outcome"]), ("smoke", "passed"))
        self.assertEqual((done["history"]["occurrences"][0]["coverage"], done["history"]["occurrences"][0]["rowEvidence"]),
                         ("smoke", False))
        self.assertEqual(done["history"]["rows"], {}, "smoke diagnostics must not seed full/nightly acceptance history")
        self.assertEqual(P.qualified_comparable(done["history"], smoke["comparability"]), [])
        self.assertEqual(P.parse_body(P.render(done)), done)

        failed = dict(smoke, runId="102", startedUtc="2026-10-31T19:00:00Z", endedUtc="2026-10-31T19:40:00Z",
                      outcome="failed", cases=[dict(smoke["cases"][0], result="FAIL", rows={"pass": 1, "fail": 1, "notRun": 0})],
                      rowVerdicts={"AHT-05": "PF"})
        failed_state = P.complete(started(done, "102"), failed)
        self.assertEqual((failed_state["latestCompleted"]["coverage"], failed_state["latestCompleted"]["outcome"]), ("smoke", "failed"))
        self.assertEqual(failed_state["history"]["rows"], {}, "failed smoke diagnostics also stay outside acceptance history")

        # Missing-row smoke remains diagnostic even though execution coverage is `incomplete`; the preserved source denominator prevents
        # it from entering acceptance history or creating a later catalog conflict.
        incomplete = dict(smoke, runId="104", coverage="incomplete", startedUtc="2026-10-31T19:41:00Z", endedUtc="2026-10-31T19:59:00Z",
                          outcome="failed", cases=[dict(smoke["cases"][0], result="NOT RUN", rows={"pass": 5, "fail": 0, "notRun": 1})],
                          rowVerdicts={"AHT-05": "PPPPPN"})
        incomplete_state = P.complete(P.begin(failed_state, "104", 1, SHA, incomplete["startedUtc"]), incomplete)
        self.assertEqual((incomplete_state["history"]["occurrences"][-1]["coverage"],
                          incomplete_state["history"]["occurrences"][-1]["coverageMode"],
                          incomplete_state["history"]["occurrences"][-1]["rowEvidence"]), ("incomplete", "smoke", False))
        self.assertEqual(incomplete_state["history"]["rows"], {})

        # A later acceptance run has its own catalog lineage. Smoke occurrences neither seed its rows nor create a false catalog mismatch.
        batch = P.sanitize_record(record("103", startedUtc="2026-10-31T20:00:00Z", endedUtc="2026-10-31T20:40:00Z",
                                         catalogSha256="9" * 64, rowVerdicts={"AHT-05": "PPPPPP"},
                                         evidence={"planSha256": "a" * 64, "caseResultsSha256": "b" * 64}))
        accepted = P.complete(P.begin(incomplete_state, "103", 1, SHA, batch["startedUtc"]), batch)
        self.assertEqual(accepted["history"]["rows"]["AHT-05"]["last"]["runId"], "103")


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


class CompletionAttestation(unittest.TestCase):
    def test_terminal_candidate_is_bound_to_the_public_incomplete_state_and_server_time(self):
        running = started(P.parse_body(""))
        _, public_body, settle, occurrence, att = completion_evidence(running)
        self.assertEqual((att["schema"], att["runId"], att["publishedAt"]),
                         (P.ATTESTATION_SCHEMA, "101", "2026-10-31T18:41:00Z"))
        done = P.reconcile_pending(P.parse_body(public_body), "2026-10-31T18:41:00Z", att, settle, occurrence,
                                   "2026-10-31T18:42:00Z", public_body)
        self.assertEqual((done["latestCompleted"]["runId"], done["inProgress"]), ("101", None))

    def test_no_attestation_for_missing_or_malformed_response_or_non_incomplete_publication(self):
        running = started(P.parse_body(""))
        candidate_body = P.render(P.complete(running, record()))
        public_body = P.render(P.pending_completion(running, record(), "2026-10-31T19:00:00Z", "3" * 64, "4" * 64))
        bad = [({}, public_body),
               ({"updated_at": "2026-10-31T18:41:00Z", "body": candidate_body}, public_body),
               ({"updated_at": "2026-10-31T18:41:00Z", "body": public_body}, candidate_body)]
        for response, public in bad:
            with self.subTest(response=response), self.assertRaises(P.Refused):
                P.completion_attestation(candidate_body, public, response, "3" * 64, "4" * 64)

        prior = P.complete(started(P.parse_body(""), "100"), record("100"))
        different_running = P.begin(prior, "101", 1, SHA, "2026-10-31T19:00:00Z")
        different = P.render(P.complete(different_running, record("101", startedUtc="2026-10-31T19:00:00Z",
                                                                  endedUtc="2026-10-31T19:40:00Z")))
        with self.assertRaisesRegex(P.Refused, "attestation-candidate-not-derived"):
            P.completion_attestation(different, public_body,
                                     {"updated_at": "2026-10-31T18:41:00Z", "body": public_body}, "3" * 64, "4" * 64)

    def test_pending_completion_is_durable_reconciles_once_and_late_or_edited_state_refuses(self):
        running = started(P.parse_body(""))
        pending, public_body, settle, occurrence, att = completion_evidence(running)
        stored = P.parse_body(public_body)
        self.assertEqual(stored["pendingCompletion"]["record"]["runId"], "101")
        done = P.reconcile_pending(stored, "2026-10-31T18:41:00Z", att, settle, occurrence,
                                   "2026-10-31T18:42:00Z", public_body)
        self.assertEqual((done["latestCompleted"]["runId"], done["inProgress"]), ("101", None))
        following = P.begin(done, "102", 1, SHA, "2026-10-31T20:00:00Z")
        self.assertEqual(following["inProgress"]["runId"], "102")
        with self.assertRaisesRegex(P.Refused, "pending-completion-late"):
            P.reconcile_pending(stored, "2026-10-31T19:00:01Z", att, settle, occurrence,
                                "2026-10-31T18:42:00Z", public_body)
        edited = json.loads(json.dumps(stored))
        edited["pendingCompletion"]["record"]["runId"] = "102"
        with self.assertRaises(P.Refused):
            P.parse_body(P.render(edited))

    def test_reconciliation_refuses_missing_failed_late_or_tampered_completion_evidence(self):
        running = started(P.parse_body(""))
        stored, public_body, settle, occurrence, att = completion_evidence(running)
        cases = [
            (dict(att, schema="other"), settle, occurrence, "2026-10-31T18:42:00Z", public_body),
            (att, settle + b" ", occurrence, "2026-10-31T18:42:00Z", public_body),
            (att, settle, occurrence + b" ", "2026-10-31T18:42:00Z", public_body),
            (att, settle, occurrence, "2026-10-31T19:00:01Z", public_body),
            (att, settle, occurrence, "2026-10-31T18:42:00Z", public_body + "edited"),
        ]
        for bad_att, bad_settle, bad_occurrence, created, body in cases:
            with self.subTest(created=created, body=body[-8:]), self.assertRaises(P.Refused):
                P.reconcile_pending(stored, "2026-10-31T18:41:00Z", bad_att, bad_settle, bad_occurrence, created, body)


REAL_FAILED_ATTEMPT_BODY = '<!-- speaksharp-cloud-test-latest-record v1 -->\n**Cloud test: latest run record** (bot-maintained; replaced only by the next terminal run)\n\nLatest completed: none yet.\nIn progress: run 41933223835 attempt 1, status incomplete.\n\n```json\n{"inProgress":{"attempt":1,"runId":"41933223835","sourceSha":"af1781ba6e07524c82dea3a66a1b7cb772c14e51","startedUtc":"2026-11-04T23:22:38Z","status":"incomplete"},"latestCompleted":null,"schema":"speaksharp.cloud-test.latest-record.v1"}\n```\n\n'  # the bot comment on tracking PR #1763 after run 41933223835 (the reserve job refused the workflow token)
RUN = "41933223835"
SRC = "af1781ba6e07524c82dea3a66a1b7cb772c14e51"
JOBS = (("Record the attempt (latest-record comment; no live credentials)", "success"),
        ("Nightly gate (switch, attempt, activated writer, standing approval; no credentials)", "skipped"),
        ("Reserve the run on the state-ref journal (the one push before the run)", "failure"),
        ("Complete or interrupt the attempt in the latest record (no live credentials)", "success"),
        ("Selected live journeys (existing stage runner; preinstalled browser)", "skipped"),
        ("Settle the run's reservation on the state-ref journal (the one push after the run)", "skipped"))
PRED = hashlib.sha256(REAL_FAILED_ATTEMPT_BODY.encode("utf-8")).hexdigest()


def stuck_state(prior=None, run_id=RUN, source=SRC):
    running = P.begin(prior or P.parse_body(""), run_id, 1, source, "2026-11-04T23:22:38Z")
    return P.interrupt(running, run_id, 1, "incomplete")


def job(name, conclusion, **over):
    return dict({"name": name, "status": "completed" if conclusion is not None else "in_progress", "conclusion": conclusion,
                 "runId": RUN, "attempt": 1, "headSha": SRC}, **over)


def evidence(**over):
    ev = {"run": {"runId": RUN, "attempt": 1, "headSha": SRC, "status": "completed", "conclusion": "failure", "updatedAt": "2026-11-04T23:23:13Z"},
          "jobs": [job(n, c) for n, c in JOBS],
          "journal": {"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT, "runIds": []},
          "collectedAt": "2026-11-05T01:11:20Z"}
    ev.update(over)
    return ev


def jobs_with(prefix, **over):
    return [dict(j, **over) if j["name"].startswith(prefix) else j for j in evidence()["jobs"]]


def run_with(**o):
    return dict(evidence()["run"], **o)


def retire(state, ev=None, pred=PRED):
    return P.retire_unreserved(state, evidence() if ev is None else ev, pred)


class RetireUnreserved(unittest.TestCase):
    """Run 41933223835 never reserved anything and left an incomplete record that blocks every later run. The only exit retires exactly that
    attempt as history on closed evidence. It never creates a completed run and never touches any other record."""

    def test_the_real_record_is_retired_not_completed_and_the_next_run_can_begin(self):
        real = P.parse_body(REAL_FAILED_ATTEMPT_BODY)
        self.assertEqual((real["inProgress"]["runId"], real["inProgress"]["status"]), (RUN, "incomplete"))
        with self.assertRaisesRegex(P.Refused, "previous-attempt-unreconciled"):
            P.begin(real, "41999999999", 1, SRC, "2026-11-05T00:00:00Z")   # the defect this removes
        after = retire(real)
        stored = P.parse_body(P.render(after))                            # renders and re-parses cleanly
        self.assertEqual(stored, after)
        self.assertIsNone(stored["inProgress"])
        self.assertIsNone(stored["latestCompleted"], "no completion is manufactured")
        self.assertNotIn("history", stored, "no history occurrence is manufactured either")
        entry, = stored["retiredAttempts"]
        self.assertEqual((entry["runId"], entry["attempt"], entry["sourceSha"], entry["retiredReason"]), (RUN, 1, SRC, "never-reserved"))
        self.assertEqual(entry["predecessorSha256"], PRED, "the retirement is bound to the exact record body it consumed")
        ev = entry["evidence"]
        self.assertEqual((ev["runStatus"], ev["reserveJob"], ev["liveJob"], ev["settleJob"], ev["journalEventsNamingRun"]),
                         ("completed", "failure", "skipped", "skipped", 0))
        self.assertEqual(ev["journalHeadSha"], W.REVIEWED_ROOT, "the journal was read at genesis")
        body = P.render(after)
        self.assertIn("Latest completed: none yet.", body)
        self.assertIn("Retired without a reservation (not a completed run)", body)
        nxt = P.begin(stored, "41999999999", 1, SRC, "2026-11-05T00:00:00Z")
        self.assertEqual((nxt["inProgress"]["runId"], len(nxt["retiredAttempts"])), ("41999999999", 1))

    def test_only_inProgress_and_retiredAttempts_change_and_the_prior_history_is_identical(self):
        first = P.complete(started(P.parse_body(""), "100"), record("100"))
        before = P.parse_body(P.render(first))
        after = retire(stuck_state(before))
        same = lambda st: {k: v for k, v in st.items() if k not in ("inProgress", "retiredAttempts")}
        self.assertEqual(same(after), same(before), "latestCompleted and history come back exactly as read")
        self.assertEqual(P.canon(after["history"]), P.canon(before["history"]), "byte-identical history")
        self.assertEqual(after["history"]["rows"]["AHT-05"]["lastKnownGood"]["runId"], "100")
        self.assertEqual([o["runId"] for o in after["history"]["occurrences"]], ["100"], "the retired attempt is not a history occurrence")

    def test_the_retirement_itself_refuses_to_return_a_changed_history(self):
        # the invariant is enforced in code, not assumed: a retirement that altered the prior record or history would refuse
        first = P.complete(started(P.parse_body(""), "100"), record("100"))
        stuck = stuck_state(P.parse_body(P.render(first)))
        real = P._with_retired
        tampers = {"history": lambda st: dict(st["history"], sequence=st["history"]["sequence"] + 1),
                   "latestCompleted": lambda st: dict(st["latestCompleted"], outcome="failed"),
                   "pendingCompletion": lambda st: {"x": 1}}
        for key, change in tampers.items():
            with mock.patch.object(P, "_with_retired", lambda state, entry, key=key, change=change: dict(real(state, entry), **{key: change(state)})):
                with self.assertRaisesRegex(P.Refused, "unreserved-history-changed", msg=key):
                    retire(stuck)

    def test_retired_history_survives_a_later_completion_and_reconcile(self):
        after = retire(stuck_state())
        running = P.begin(after, "102", 1, SHA, "2026-11-05T01:00:00Z")
        done = P.complete(running, record("102", startedUtc="2026-11-05T01:00:00Z", endedUtc="2026-11-05T01:40:00Z"))
        self.assertEqual([r["runId"] for r in done["retiredAttempts"]], [RUN])
        self.assertEqual(P.parse_body(P.render(done)), done)
        interrupted = P.interrupt(P.begin(after, "103", 1, SHA, "2026-11-05T02:00:00Z"), "103", 1, "cancelled")
        self.assertEqual([r["runId"] for r in interrupted["retiredAttempts"]], [RUN])

    def test_any_incomplete_run_is_a_candidate_but_retires_only_on_its_own_evidence_and_begin_refuses_until_then(self):
        # Sam 1793881260.206739: a later run interrupted before its reserve must be retirable too. Being a candidate proves nothing.
        others = {"another run id": stuck_state(run_id="41933223836"), "another source sha": stuck_state(source="c" * 40)}
        for name, state in others.items():
            self.assertEqual(P.unreserved_candidate(state), state["inProgress"]["runId"], name)
            with self.assertRaisesRegex(P.Refused, "unreserved-run-differs"):
                retire(state)                                  # the evidence is of 41933223835, not of this attempt
            with self.assertRaisesRegex(P.Refused, "previous-attempt-unreconciled"):
                P.begin(state, "41999999999", 1, SRC, "2026-11-05T00:00:00Z")
        running = P.begin(P.parse_body(""), RUN, 1, SRC, "2026-11-04T23:22:38Z")
        settle, occurrence = receipt_bytes(), occurrence_bytes()
        pending = P.pending_completion(running, record(RUN, sourceSha=SRC), "2026-11-05T19:00:00Z", hashlib.sha256(settle).hexdigest(),
                                       hashlib.sha256(occurrence).hexdigest())
        for name, state in {"running": running, "cancelled": P.interrupt(running, RUN, 1, "cancelled"), "pending completion": pending,
                            "nothing in progress": P.parse_body("")}.items():
            self.assertIsNone(P.unreserved_candidate(state), name)
            with self.assertRaisesRegex(P.Refused, "unreserved-not-a-candidate"):
                retire(state)
        # the evidence names a different run than the record's attempt
        for ev in (evidence(run=run_with(runId="41933223836")), evidence(run=run_with(attempt=2)), evidence(run=run_with(headSha="c" * 40))):
            with self.assertRaisesRegex(P.Refused, "unreserved-run-differs"):
                retire(stuck_state(), ev)

    def test_an_interrupted_later_run_that_never_reserved_is_retired_at_any_journal_head(self):
        # Sam 1793881260.206739: the dispatch after 41960376782 can fail before the old settle (journal still at its open reserve) or after it
        # but before its own reserve (journal at the settle). Either way its record is incomplete and it never reserved: it is retired and
        # the next run begins. History, latestCompleted and earlier retired entries come back unchanged.
        y, ysrc = "41999999998", "b" * 40
        prior = retire(stuck_state())                                             # 41933223835 already retired earlier
        state = stuck_state(prior=prior, run_id=y, source=ysrc)
        self.assertEqual(P.unreserved_candidate(state), y)
        y_jobs = [dict(j, runId=y, headSha=ysrc) for j in evidence()["jobs"]]
        for head in ("0909b53ff6dc767105633ddc14db520c762dff64", "6430357513fcc5f4bba12f8deab3c06bb5b01996"):
            ev = evidence(run=run_with(runId=y, headSha=ysrc), jobs=y_jobs,
                          journal={"rootSha": W.REVIEWED_ROOT, "headSha": head, "runIds": ["41960376782"]})
            out = P.retire_unreserved(state, ev, PRED)
            self.assertEqual([r["runId"] for r in out["retiredAttempts"]], [RUN, y])
            self.assertEqual(out["retiredAttempts"][0], prior["retiredAttempts"][0])
            self.assertEqual((out["latestCompleted"], out.get("history")), (state["latestCompleted"], state.get("history")))
            self.assertEqual(P.parse_body(P.render(out)), out)
            self.assertEqual(P.begin(out, "41999999999", 1, SRC, "2026-11-05T13:00:00Z")["inProgress"]["status"], "running")
            # its reserve job may have failed (interrupted at the settle) or never run (interrupted earlier); either is never-reserved
            skipped = [dict(j, conclusion="skipped") if j["name"].startswith("Reserve the run") else j for j in y_jobs]
            self.assertEqual(P.retire_unreserved(state, dict(ev, jobs=skipped), PRED)["inProgress"], None)
            # but a journal naming this run means it reserved: refused, and begin still refuses
            with self.assertRaisesRegex(P.Refused, "unreserved-journal-names-the-run"):
                P.retire_unreserved(state, dict(ev, journal=dict(ev["journal"], runIds=["41960376782", y])), PRED)

    def test_a_job_that_is_not_of_this_run_attempt_and_source_refuses(self):
        # review return: each job must belong to the failed attempt. A job copied from another run, attempt or source is not evidence about this one,
        # even when its name and conclusion are exactly the expected ones.
        for field, value in (("runId", "41933223836"), ("attempt", 2), ("headSha", "c" * 40), ("runId", None), ("attempt", None)):
            for prefix in ("Reserve the run", "Selected live", "Settle the run", "Record the attempt", "Nightly gate"):
                with self.assertRaisesRegex(P.Refused, "unreserved-job-not-of-the-run"):
                    retire(stuck_state(), evidence(jobs=jobs_with(prefix, **{field: value})))

    def test_the_failed_run_must_be_completed_and_every_matched_job_too(self):
        for status in ("in_progress", "queued", "waiting", None, "requested"):
            with self.assertRaisesRegex(P.Refused, "unreserved-run-not-completed"):
                retire(stuck_state(), evidence(run=run_with(status=status)))
        for prefix, code in (("Reserve the run", "unreserved-job-reserveJob"), ("Selected live", "unreserved-job-liveJob"),
                             ("Settle the run", "unreserved-job-settleJob")):
            for status in ("in_progress", "queued", None):
                with self.assertRaisesRegex(P.Refused, code):
                    retire(stuck_state(), evidence(jobs=jobs_with(prefix, status=status)))

    def test_the_freshly_validated_journal_must_name_no_event_of_the_run(self):
        # at any head (Sam 1793881260.206739); other runs' events, such as an earlier settle, are not this run's reservation
        moved = "e" * 40
        for journal in ({"rootSha": W.REVIEWED_ROOT, "headSha": moved, "runIds": []}, {"rootSha": W.REVIEWED_ROOT, "headSha": moved, "runIds": ["999"]},
                        {"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT, "runIds": []}):
            self.assertIsNone(retire(stuck_state(), evidence(journal=journal))["inProgress"])
        for journal, code in (({"rootSha": moved, "headSha": moved, "runIds": []}, "unreserved-journal-unverified"),
                              ({"rootSha": W.REVIEWED_ROOT, "headSha": moved, "runIds": [RUN]}, "unreserved-journal-names-the-run"),
                              ({"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT, "runIds": [RUN]}, "unreserved-journal-names-the-run"),
                              ({"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT, "runIds": "none"}, "unreserved-journal-names-the-run"),
                              ({"rootSha": W.REVIEWED_ROOT, "headSha": "short", "runIds": []}, "unreserved-journal-unverified"),
                              ({"rootSha": W.REVIEWED_ROOT, "headSha": W.REVIEWED_ROOT}, "unreserved-evidence")):
            with self.assertRaisesRegex(P.Refused, code):
                retire(stuck_state(), evidence(journal=journal))
        # and evidence collected before the run finished is not a fresh read of anything that matters
        for stamp in ("2026-11-04T23:23:12Z", "2026-11-04T10:00:00Z", "not-a-time", None):
            with self.assertRaisesRegex(P.Refused, "unreserved-time"):
                retire(stuck_state(), evidence(collectedAt=stamp))

    def test_an_actual_reservation_refuses(self):
        # negative control: the run reserved (its reserve job did not fail, or it got as far as a live or settle job)
        for ev, code in ((evidence(jobs=jobs_with("Reserve the run", conclusion="success")), "unreserved-job-reserveJob"),
                         (evidence(jobs=jobs_with("Selected live", conclusion="success")), "unreserved-job-liveJob"),
                         (evidence(jobs=jobs_with("Selected live", conclusion="failure")), "unreserved-job-liveJob"),
                         (evidence(jobs=jobs_with("Settle the run", conclusion="success")), "unreserved-job-settleJob"),
                         (evidence(jobs=jobs_with("Settle the run", conclusion="failure")), "unreserved-job-settleJob")):
            with self.assertRaisesRegex(P.Refused, code):
                retire(stuck_state(), ev)

    def test_uncertain_evidence_refuses(self):
        # negative control: anything missing, ambiguous, still running or unverifiable is not evidence of absence
        without = lambda prefix: [j for j in evidence()["jobs"] if not j["name"].startswith(prefix)]
        duplicate = evidence()["jobs"] + [job("Selected live journeys (copy)", "skipped")]
        cases = [
            (evidence(jobs=without("Reserve the run")), "unreserved-job-reserveJob"),
            (evidence(jobs=without("Selected live")), "unreserved-job-liveJob"),
            (evidence(jobs=without("Settle the run")), "unreserved-job-settleJob"),
            (evidence(jobs=duplicate), "unreserved-job-liveJob"),
            (evidence(jobs=jobs_with("Reserve the run", conclusion=None)), "unreserved-job-reserveJob"),
            (evidence(jobs=jobs_with("Reserve the run", conclusion="cancelled")), "unreserved-job-reserveJob"),
            (evidence(jobs=jobs_with("Selected live", conclusion=None)), "unreserved-job-liveJob"),
            (evidence(jobs=jobs_with("Selected live", conclusion="cancelled")), "unreserved-job-liveJob"),
            (evidence(jobs=[]), "unreserved-job-reserveJob"),
            (evidence(run=run_with(conclusion=None)), "unreserved-run-not-failed"),
            (evidence(run=run_with(conclusion="cancelled")), "unreserved-run-not-failed"),
            (evidence(run=run_with(conclusion="success")), "unreserved-run-not-failed"),
            (evidence(run=run_with(updatedAt="not-a-time")), "unreserved-time"),
            (evidence(run=run_with(updatedAt="2026-11-04T23:00:00Z")), "unreserved-time"),
            (dict(evidence(), extra=1), "unreserved-evidence"),
            ({k: v for k, v in evidence().items() if k != "journal"}, "unreserved-evidence"),
            ({k: v for k, v in evidence().items() if k != "collectedAt"}, "unreserved-evidence"),
            ({}, "unreserved-evidence"),
            (evidence(jobs=[dict(job("Reserve the run", "failure"), extra=1)]), "unreserved-evidence"),
            (evidence(jobs=[{"name": "Reserve the run", "conclusion": "failure"}]), "unreserved-evidence"),
            (evidence(run={k: v for k, v in run_with().items() if k != "status"}), "unreserved-evidence"),
        ]
        for ev, code in cases:
            with self.assertRaisesRegex(P.Refused, code):
                retire(stuck_state(), ev)

    def test_the_retirement_requires_a_bound_predecessor_digest(self):
        for bad in (None, "", "short", "G" * 64, 5):
            with self.assertRaisesRegex(P.Refused, "unreserved-predecessor"):
                retire(stuck_state(), pred=bad)

    def test_a_retired_attempt_is_not_retired_twice_and_the_bound_holds(self):
        after = retire(stuck_state())
        with self.assertRaisesRegex(P.Refused, "unreserved-not-a-candidate"):
            retire(after)
        full = retire(stuck_state())["retiredAttempts"]
        full = [dict(full[0], runId=str(41900000000 + i)) for i in range(P.RETIRED_MAX)]
        with self.assertRaisesRegex(P.Refused, "retired-attempts-bound"):
            retire(dict(stuck_state(), retiredAttempts=full))

    def test_a_full_retired_history_still_renders_and_parses_inside_the_body_limit(self):
        """Run 42472935773: the 9th retirement is admitted; RETIRED_MAX retired entries stay under MAX_BODY_CHARS and round-trip."""
        self.assertGreaterEqual(P.RETIRED_MAX, 9)
        one = retire(stuck_state())["retiredAttempts"][0]
        full = [dict(one, runId=str(41900000000 + i)) for i in range(P.RETIRED_MAX)]
        state = dict(stuck_state(), retiredAttempts=full)
        body = P.render(state)
        self.assertLessEqual(len(body), P.MAX_BODY_CHARS)
        self.assertEqual(P.parse_body(body)["retiredAttempts"], full)
        nine = [dict(one, runId=str(41900000000 + i)) for i in range(8)]
        self.assertEqual(len(retire(dict(stuck_state(), retiredAttempts=nine))["retiredAttempts"]), 9)

    def test_a_stored_retired_entry_must_be_exactly_the_closed_shape(self):
        good = retire(stuck_state())
        entry = good["retiredAttempts"][0]
        ev = entry["evidence"]
        mutations = [dict(entry, extra="x"), dict(entry, retiredReason="completed"), {k: v for k, v in entry.items() if k != "startedUtc"},
                     {k: v for k, v in entry.items() if k != "predecessorSha256"}, dict(entry, predecessorSha256="short"),
                     dict(entry, evidence=dict(ev, journalEventsNamingRun=1)), dict(entry, evidence=dict(ev, reserveJob="success")),
                     dict(entry, evidence=dict(ev, runStatus="in_progress")), dict(entry, evidence=dict(ev, journalHeadSha="short")),
                     dict(entry, evidence=dict(ev, reserveJob="cancelled")),
                     dict(entry, evidence=dict(ev, collectedUtc="2026-11-04T00:00:00Z")),
                     dict(entry, evidence=dict(ev, note="free text")), dict(entry, runId="not-a-run")]
        for bad in mutations:
            body = P.render(good).replace(json.dumps(entry, sort_keys=True, separators=(",", ":")), json.dumps(bad, sort_keys=True, separators=(",", ":")))
            self.assertNotEqual(body, P.render(good), "the mutation is applied")
            with self.assertRaises(P.Refused):
                P.parse_body(body)
        for bad_list in ([], "x"):
            with self.assertRaises(P.Refused):
                P.parse_body(P.render(good).replace('"retiredAttempts":[' + json.dumps(entry, sort_keys=True, separators=(",", ":")) + "]",
                                                    '"retiredAttempts":' + json.dumps(bad_list)))

    def test_the_record_must_be_unchanged_between_selection_and_publication(self):
        # review return: re-read the stored comment immediately before publishing and bind it to the record that was selected
        selected = {"commentId": 6644906621, "body": REAL_FAILED_ATTEMPT_BODY, "updatedAt": "2026-11-04T23:23:08Z"}
        current = {"id": 6644906621, "body": REAL_FAILED_ATTEMPT_BODY, "updated_at": "2026-11-04T23:23:08Z", "user": {"login": "ignored"}}
        P.verify_predecessor(selected, current)                                              # unchanged: accepted
        for name, bad in {"body edited": dict(current, body=REAL_FAILED_ATTEMPT_BODY + " "),
                          "body replaced": dict(current, body=P.render(P.parse_body(""))),
                          "updated since": dict(current, updated_at="2026-11-05T01:12:00Z"),
                          "another comment": dict(current, id=6644906622),
                          "no id": {k: v for k, v in current.items() if k != "id"},
                          "no body": {k: v for k, v in current.items() if k != "body"},
                          "not a comment": []}.items():
            with self.assertRaisesRegex(P.Refused, "record-predecessor-moved", msg=name):
                P.verify_predecessor(selected, bad)
        for bad_selected in ({}, {"commentId": None, "body": "x", "updatedAt": "t"}, []):
            with self.assertRaisesRegex(P.Refused, "record-predecessor-moved"):
                P.verify_predecessor(bad_selected, current)

    def test_the_cli_reports_a_candidate_retires_binds_the_predecessor_and_refuses_with_exit_78(self):
        d = tempfile.mkdtemp(prefix="ct-unreserved-")
        self.addCleanup(shutil.rmtree, d, True)
        script = os.path.join(ROOT, "scripts", "publish_latest_record.py")
        prev, ev, out, sel, cur = (os.path.join(d, n) for n in ("prev.md", "ev.json", "out.md", "sel.json", "cur.json"))
        with open(prev, "w", encoding="utf-8") as f:
            f.write(REAL_FAILED_ATTEMPT_BODY)
        with open(ev, "w", encoding="utf-8") as f:
            json.dump(evidence(), f)
        run = lambda *a: subprocess.run(["python3", "-I", script, *a], capture_output=True, text=True, timeout=60)
        found = run("unreserved-candidate", "--previous", prev)
        self.assertEqual((found.returncode, found.stdout.strip()), (0, RUN))
        done = run("retire-unreserved", "--previous", prev, "--evidence", ev, "--out", out)
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(out, encoding="utf-8") as f:
            state = P.parse_body(f.read())
        self.assertIsNone(state["inProgress"])
        self.assertEqual(state["retiredAttempts"][0]["predecessorSha256"], PRED, "the CLI binds the digest of the exact body it read")
        self.assertEqual(run("unreserved-candidate", "--previous", out).returncode, 1)
        with open(sel, "w", encoding="utf-8") as f:
            json.dump({"commentId": 7, "body": "same", "updatedAt": "t1"}, f)
        for body, code in (("same", 0), ("different", 78)):
            with open(cur, "w", encoding="utf-8") as f:
                json.dump({"id": 7, "body": body, "updated_at": "t1"}, f)
            r = run("verify-predecessor", "--selected", sel, "--current", cur)
            self.assertEqual(r.returncode, code, r.stderr)
        self.assertIn("record-predecessor-moved", r.stderr)
        with open(ev, "w", encoding="utf-8") as f:
            json.dump(evidence(jobs=[]), f)
        refused = run("retire-unreserved", "--previous", prev, "--evidence", ev, "--out", out + ".2")
        self.assertEqual(refused.returncode, 78)
        self.assertIn("unreserved-job-", refused.stderr)
        self.assertFalse(os.path.exists(out + ".2"), "a refusal writes no body")


class RetireUnexecuted(unittest.TestCase):
    """Run 41960376782 RESERVED, then its live job failed in setup with every credential-bearing step skipped. Its `incomplete` record blocks
    `begin`. Exactly that pinned attempt is retired as `reserved-not-executed` on the closed unexecuted-attempt evidence, never as a completion."""
    RUN = "41960376782"
    HEAD = "8f9f9451bb6bf37ba2bca524acd92d933e2b826c"

    def evidence(self):
        import test_unexecuted_attempt_evidence as T
        return T.build()

    def real_stuck(self):
        """The record as it stands on #1763: the earlier never-reserved retirement kept, then this attempt begun and left `incomplete`."""
        retired = retire(P.parse_body(REAL_FAILED_ATTEMPT_BODY))
        return P.parse_body(P.render(P.interrupt(P.begin(retired, self.RUN, 1, self.HEAD, "2026-11-05T03:14:52Z"), self.RUN, 1, "incomplete")))

    def pred(self, state):
        return hashlib.sha256(P.render(state).encode("utf-8")).hexdigest()

    def test_the_real_record_is_retired_as_reserved_not_executed_and_the_next_run_can_begin(self):
        stuck = self.real_stuck()
        self.assertEqual((P.unexecuted_candidate(stuck, self.evidence()), stuck["inProgress"]["status"]), (self.RUN, "incomplete"))
        with self.assertRaisesRegex(P.Refused, "previous-attempt-unreconciled"):
            P.begin(stuck, "41999999999", 1, self.HEAD, "2026-11-05T05:00:00Z")      # the defect this removes
        after = P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))
        stored = P.parse_body(P.render(after))
        self.assertEqual(stored, after)
        self.assertIsNone(stored["inProgress"])
        self.assertIsNone(stored["latestCompleted"], "no completion is manufactured")
        self.assertNotIn("history", stored)
        first, second = stored["retiredAttempts"]
        self.assertEqual((first["runId"], first["retiredReason"]), (RUN, "never-reserved"), "the earlier entry is kept")
        self.assertEqual(first, stuck["retiredAttempts"][0], "and is byte-identical")
        self.assertEqual((second["runId"], second["attempt"], second["sourceSha"], second["retiredReason"], second["startedUtc"]),
                         (self.RUN, 1, self.HEAD, "reserved-not-executed", "2026-11-05T03:14:52Z"))
        self.assertEqual(second["predecessorSha256"], self.pred(stuck))
        self.assertEqual(second["evidence"], {"runStatus": "completed", "runConclusion": "failure", "runUpdatedUtc": "2026-11-05T03:21:45Z",
                                              "evidenceSha256": "b3579e3be26d2251b59bea30e9a70b342d979777601db3da477ff14d78017550",
                                              "journalHeadSha": "0909b53ff6dc767105633ddc14db520c762dff64", "runnerMinutes": 6,
                                              "settleAtUtc": "2026-11-05T03:21:44Z"})
        self.assertIn("Reserved, not executed: no credential-bearing step ran (not a completed run)", P.render(after))
        nxt = P.begin(stored, "41999999999", 1, self.HEAD, "2026-11-05T05:00:00Z")
        self.assertEqual((nxt["inProgress"]["runId"], len(nxt["retiredAttempts"])), ("41999999999", 2))

    def test_prior_history_and_retired_entries_come_back_byte_identical(self):
        first = P.complete(started(P.parse_body(""), "100"), record("100"))
        before = P.parse_body(P.render(first))
        stuck = P.parse_body(P.render(P.interrupt(P.begin(before, self.RUN, 1, self.HEAD, "2026-11-05T03:14:52Z"), self.RUN, 1, "incomplete")))
        after = P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))
        same = lambda st: {k: v for k, v in st.items() if k not in ("inProgress", "retiredAttempts")}
        self.assertEqual(same(after), same(before))
        self.assertEqual(P.canon(after["history"]), P.canon(before["history"]))
        self.assertEqual([o["runId"] for o in after["history"]["occurrences"]], ["100"], "the retired attempt is not a history occurrence")
        real = P._with_retired
        tampers = {"history": lambda st: dict(st["history"], sequence=st["history"]["sequence"] + 1),
                   "latestCompleted": lambda st: dict(st["latestCompleted"], outcome="failed")}
        for key, change in tampers.items():
            with mock.patch.object(P, "_with_retired", lambda state, entry, key=key, change=change: dict(real(state, entry), **{key: change(state)})):
                with self.assertRaisesRegex(P.Refused, "unexecuted-history-changed", msg=key):
                    P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))
        # an altered earlier retired entry also refuses
        stuck_entries = P.parse_body(P.render(retire(P.parse_body(REAL_FAILED_ATTEMPT_BODY))))
        running = P.interrupt(P.begin(stuck_entries, self.RUN, 1, self.HEAD, "2026-11-05T03:14:52Z"), self.RUN, 1, "incomplete")
        with mock.patch.object(P, "_with_retired", lambda state, entry: dict(real(state, entry), retiredAttempts=[dict(entry)])):
            with self.assertRaisesRegex(P.Refused, "unexecuted-history-changed"):
                P.retire_unexecuted(running, self.evidence(), self.pred(running))

    def test_retired_history_survives_a_later_completion(self):
        stuck = self.real_stuck()
        retired = P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))
        done = P.complete(started(retired, "102"), record("102"))
        self.assertEqual([r["runId"] for r in done["retiredAttempts"]], [RUN, self.RUN])

    def test_only_the_incomplete_attempt_the_evidence_is_about_is_a_candidate(self):
        retired = retire(P.parse_body(REAL_FAILED_ATTEMPT_BODY))
        for label, state in (("another run", stuck_state(run_id="41999999999", source=self.HEAD)),
                             ("another head", P.interrupt(P.begin(retired, self.RUN, 1, "c" * 40, "2026-11-05T03:14:52Z"), self.RUN, 1, "incomplete")),
                             ("attempt 2", dict(self.real_stuck(), inProgress=dict(self.real_stuck()["inProgress"], attempt=2))),
                             ("still running", P.begin(retired, self.RUN, 1, self.HEAD, "2026-11-05T03:14:52Z")),
                             ("nothing in progress", retired),
                             ("a pending completion", dict(self.real_stuck(), pendingCompletion={"x": 1}))):
            self.assertIsNone(P.unexecuted_candidate(state, self.evidence()), label)
            with self.assertRaisesRegex(P.Refused, "unexecuted-not-a-candidate", msg=label):
                P.retire_unexecuted(state, self.evidence(), PRED)
        self.assertIsNone(P.unexecuted_candidate(self.real_stuck(), None), "no evidence, no candidate")

    def test_the_evidence_is_reverified_here_never_trusted(self):
        import test_unexecuted_attempt_evidence as T
        stuck = self.real_stuck()
        pred = self.pred(stuck)
        bad = self.evidence()
        bad["usage"]["runnerMinutes"] = 40
        with self.assertRaisesRegex(P.Refused, "unexecuted-usage-differs"):
            P.retire_unexecuted(stuck, bad, pred)
        ran = self.evidence()      # a hand-edited document: a credential step that ran
        live = next(j for j in ran["jobs"] if j["name"] == T.LIVE)
        next(s for s in live["steps"] if s["name"].startswith("Stage runner (run)"))["conclusion"] = "success"
        with self.assertRaisesRegex(P.Refused, "unexecuted-credential-step-ran"):
            P.retire_unexecuted(stuck, ran, pred)
        wrong = self.evidence()
        wrong["identity"]["runId"] = "41933223835"
        with self.assertRaisesRegex(P.Refused, "unexecuted-not-a-candidate"):
            P.retire_unexecuted(stuck, wrong, pred)          # it is not about the record's attempt
        wrong = self.evidence()
        wrong["run"]["runId"] = "41933223835"
        with self.assertRaisesRegex(P.Refused, "unexecuted-run-differs"):
            P.retire_unexecuted(stuck, wrong, pred)
        with self.assertRaisesRegex(P.Refused, "unexecuted-predecessor"):
            P.retire_unexecuted(stuck, self.evidence(), "short")
        # evidence of the pinned run, but the record's in-progress attempt began after the run ended
        late = P.parse_body(P.render(P.interrupt(P.begin(retire(P.parse_body(REAL_FAILED_ATTEMPT_BODY)), self.RUN, 1, self.HEAD, "2026-11-05T04:00:00Z"),
                                                 self.RUN, 1, "incomplete")))
        with self.assertRaisesRegex(P.Refused, "unexecuted-time"):
            P.retire_unexecuted(late, self.evidence(), self.pred(late))

    def test_a_replay_is_refused_because_the_attempt_is_no_longer_in_progress(self):
        stuck = self.real_stuck()
        once = P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))
        with self.assertRaisesRegex(P.Refused, "unexecuted-not-a-candidate"):
            P.retire_unexecuted(once, self.evidence(), self.pred(once))

    def test_the_closed_entry_shape_refuses_anything_else(self):
        stuck = self.real_stuck()
        entry = P.retire_unexecuted(stuck, self.evidence(), self.pred(stuck))["retiredAttempts"][1]
        P.sanitize_retired(entry)
        for label, change in (("extra evidence key", lambda e: e["evidence"].update(extra=1)),
                              ("a missing key", lambda e: e["evidence"].pop("runnerMinutes")),
                              ("another reason", lambda e: e.update(retiredReason="whatever")),
                              ("zero minutes", lambda e: e["evidence"].update(runnerMinutes=0)),
                              ("a short digest", lambda e: e["evidence"].update(evidenceSha256="abc")),
                              ("not failed", lambda e: e["evidence"].update(runConclusion="success")),
                              ("an extra top key", lambda e: e.update(extra=1))):
            e = json.loads(json.dumps(entry))
            change(e)
            with self.assertRaisesRegex(P.Refused, "retired-(attempt|evidence)|unsanitized-field", msg=label):
                P.sanitize_retired(e)

    def test_the_cli_candidate_and_retirement_refuse_and_write(self):
        import test_unexecuted_attempt_evidence as T
        d = tempfile.mkdtemp(prefix="ct-unexecuted-")
        self.addCleanup(shutil.rmtree, d, True)
        script = os.path.join(ROOT, "scripts", "publish_latest_record.py")
        run = lambda *a: subprocess.run(["python3", "-I", script, *a], capture_output=True, text=True, timeout=60)
        prev, ev, out = os.path.join(d, "prev.md"), os.path.join(d, "ev.json"), os.path.join(d, "out.md")
        stuck = self.real_stuck()
        with open(prev, "w", encoding="utf-8") as f:
            f.write(P.render(stuck))
        with open(ev, "wb") as f:
            f.write(P.canon(self.evidence()) + b"\n")
        self.assertEqual(run("unexecuted-candidate", "--previous", prev).returncode, 1, "no evidence, no candidate")
        c = run("unexecuted-candidate", "--previous", prev, "--evidence", ev)
        self.assertEqual((c.returncode, c.stdout.strip()), (0, self.RUN))
        r = run("retire-unexecuted", "--previous", prev, "--evidence", ev, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        with open(out, encoding="utf-8") as f:
            after = P.parse_body(f.read())
        self.assertIsNone(after["inProgress"])
        self.assertEqual(run("unexecuted-candidate", "--previous", out, "--evidence", ev).returncode, 1)
        again = run("retire-unexecuted", "--previous", out, "--evidence", ev, "--out", os.path.join(d, "x.md"))
        self.assertEqual((again.returncode, again.stderr.strip()), (78, "BLOCKED_SETUP: unexecuted-not-a-candidate"))


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


def never_started(**over):
    """Run 42284568156's real record shape: refused in admission (A6) before its campaign began."""
    unknown = [{"caseId": "AHT-%02d" % i, "result": "UNKNOWN", "rows": {"pass": 0, "fail": 0, "notRun": 0}, "codes": ["incomplete-run"]}
               for i in range(1, 16)]
    fields = dict(outcome="failed", campaignId=None, requestSha256=None, catalogSha256=None, servedSha=None, coverage="unqualified",
                  codes=["not-qualified", "incomplete-run"], cases=unknown)
    fields.update(over)
    return record("101", **fields)


class NeverStartedReconciliation(unittest.TestCase):
    """Run 42316037470 refused completion-occurrence-identity: 42284568156's pending record has campaignId null because it stopped in
    admission before its campaign. Run 42423408284 (admission PASS, campaign refused before its first case, every case NOT RUN, code
    not-qualified only) refused the same way at the byte path. The projection emits campaignId null for EVERY unqualified record, so the
    rule is the projection's exact unqualified shape, not one run's case statuses; a record naming a campaign must name the occurrence's."""

    def reconcile(self, rec, occurrence=None):
        running = started(P.parse_body(""))
        stored, public_body, settle, occ, att = completion_evidence(running, rec=rec, occurrence=occurrence)
        return P.reconcile_pending(P.parse_body(public_body), "2026-10-31T18:41:00Z", att, settle, occ, "2026-10-31T18:42:00Z", public_body)

    def test_the_never_started_record_reconciles_and_the_next_attempt_begins(self):
        done = self.reconcile(never_started(), occurrence_bytes(runId="R10-3b040043-smoke15"))
        self.assertEqual((done["latestCompleted"]["runId"], done["latestCompleted"]["campaignId"], done["inProgress"]), ("101", None, None))
        self.assertEqual(P.begin(done, "102", 1, SHA, "2026-10-31T20:00:00Z")["inProgress"]["runId"], "102")

    def test_every_unqualified_shape_reconciles_as_failed_history_never_as_row_evidence(self):
        rows = never_started()
        rows["cases"][0] = dict(rows["cases"][0], result="PASS", rows={"pass": 2, "fail": 0, "notRun": 0}, codes=[])
        not_run = [{"caseId": "AHT-%02d" % i, "result": "NOT RUN", "rows": {"pass": 0, "fail": 0, "notRun": 0}, "codes": []} for i in range(1, 16)]
        shapes = {
            "campaign refused before its first case (42423408284)": never_started(codes=["not-qualified"], cases=not_run),
            "unqualified with executed rows": rows,
            "unqualified with a FAIL row": never_started(cases=[{"caseId": "AHT-05", "result": "FAIL", "rows": {"pass": 4, "fail": 1, "notRun": 1},
                                                                  "codes": ["observed-product-contradiction"]}]),
        }
        for name, rec in shapes.items():
            with self.subTest(name):
                done = self.reconcile(rec, occurrence_bytes(runId="R10-3b040043-smoke15"))
                self.assertEqual((done["latestCompleted"]["outcome"], done["latestCompleted"]["coverage"], done["inProgress"]),
                                 ("failed", "unqualified", None))
                self.assertFalse(any(o["rowEvidence"] for o in done["history"]["occurrences"]))

    def test_a_null_campaign_outside_the_exact_unqualified_shape_still_refuses(self):
        bad = {
            "request identity": never_started(requestSha256="1" * 64),
            "catalog identity": never_started(catalogSha256="2" * 64),
            "qualified coverage": never_started(coverage="batch"),
            "no not-qualified code": never_started(codes=["incomplete-run"]),
            "not-qualified not first": never_started(codes=["incomplete-run", "not-qualified"]),
            "passed": never_started(outcome="passed", cases=[{"caseId": "AHT-05", "result": "PASS", "rows": {"pass": 6, "fail": 0, "notRun": 0},
                                                              "codes": []}], codes=["not-qualified"]),
        }
        for name, rec in bad.items():
            with self.subTest(name), self.assertRaises(P.Refused):
                self.reconcile(rec)

    def test_a_named_campaign_must_still_match_the_occurrence(self):
        with self.assertRaisesRegex(P.Refused, "completion-occurrence-identity"):
            self.reconcile(record(), occurrence_bytes(runId="R10-other"))
        with self.assertRaises(P.Refused):    # a named campaign on a never-started shape refuses (record validation or identity)
            self.reconcile(never_started(campaignId="R6-other"), occurrence_bytes(runId="R10-3b040043-smoke15"))


def artifact_row(run_id="101", expired=False, aid=7, name=P.COMPLETION_ARTIFACT):
    return {"id": aid, "name": name, "expired": expired, "created_at": "2026-10-31T18:42:00Z", "workflow_run": {"id": int(run_id)}}


class CompletionUnverified(unittest.TestCase):
    """Sam 1794162379: the attestation is kept one day; a pending completion whose run has no unexpired attestation artifact retires as
    `completion-unverified` history. The candidate is not folded, no attestation is recreated and no result is upgraded."""

    def pending_state(self, prior=None):
        base = prior if prior is not None else P.complete(started(P.parse_body(""), "100"), record("100"))
        running = P.begin(base, "101", 1, SHA, "2026-10-31T19:00:00Z")
        rec = record("101", outcome="failed", startedUtc="2026-10-31T19:00:00Z", endedUtc="2026-10-31T19:40:00Z")
        pending = P.pending_completion(running, rec, "2026-10-31T20:40:00Z", "3" * 64, "4" * 64)
        return P.parse_body(P.render(pending)), rec

    def test_no_unexpired_attestation_retires_the_candidate_unfolded_and_keeps_everything_else(self):
        state, rec = self.pending_state()
        for label, pages in {"expired": [{"total_count": 1, "artifacts": [artifact_row(expired=True)]}],
                             "expired across two pages": [{"total_count": 2, "artifacts": [artifact_row(expired=True)]},
                                                          {"total_count": 2, "artifacts": [artifact_row(name="cloud-test-settle-input", aid=9)]}],
                             "never uploaded": [{"total_count": 1, "artifacts": [artifact_row(name="cloud-test-settle-input")]}],
                             "empty listing": [{"total_count": 0, "artifacts": []}],
                             "a single (unslurped) page": {"total_count": 0, "artifacts": []}}.items():
            with self.subTest(label):
                out = P.retire_unattested(state, pages, "2026-11-02T09:00:00Z", "9" * 64)
                body = P.render(out)
                again = P.parse_body(body)
                self.assertEqual(again, out)
                self.assertIsNone(out["inProgress"])
                self.assertNotIn("pendingCompletion", out)
                self.assertEqual((out["latestCompleted"], out.get("history")), (state["latestCompleted"], state.get("history")))
                self.assertEqual(out["latestCompleted"]["runId"], "100")          # the candidate run is never folded or upgraded
                entry = out["retiredAttempts"][-1]
                self.assertEqual((entry["runId"], entry["retiredReason"], entry["predecessorSha256"]), ("101", "completion-unverified", "9" * 64))
                ev = entry["evidence"]
                self.assertEqual((ev["unexpiredArtifacts"], ev["settleReceiptSha256"], ev["occurrenceSha256"], ev["completionDeadlineUtc"]),
                                 (0, "3" * 64, "4" * 64, "2026-10-31T20:40:00Z"))
                self.assertEqual(ev["candidateSha256"], hashlib.sha256(P.canon(rec)).hexdigest())
                self.assertIn("Completion unverified (not a completed run; its pending candidate was not folded", body)
                self.assertNotIn("Pending completion", body)
                # the next run can begin from this state
                self.assertEqual(P.begin(again, "102", 1, SHA, "2026-11-02T09:00:01Z")["inProgress"]["runId"], "102")

    def test_a_present_artifact_ambiguity_or_a_foreign_listing_refuses(self):
        state, _ = self.pending_state()
        status, row, named = P.completion_artifacts([{"total_count": 2, "artifacts": [artifact_row(), artifact_row(expired=True, aid=8)]}], "101")
        self.assertEqual((status, row, named), ("present", {"id": 7, "created_at": "2026-10-31T18:42:00Z"}, 2))
        cases = {"an unexpired attestation exists (reconcile instead)": ([{"total_count": 1, "artifacts": [artifact_row()]}], "unattested-artifact-present"),
                 "two unexpired attestations": ([{"total_count": 2, "artifacts": [artifact_row(), artifact_row(aid=8)]}], "completion-artifact-ambiguous"),
                 "another run's listing": ([{"total_count": 1, "artifacts": [artifact_row(run_id="99", expired=True)]}], "completion-artifact-listing"),
                 "no expiry flag": ([{"total_count": 1, "artifacts": [dict(artifact_row(), expired=None)]}], "completion-artifact-listing"),
                 "not a listing (an error body)": ([{"message": "Server Error", "status": "502"}], "completion-artifact-listing"),
                 "no pages": ([], "completion-artifact-listing"),
                 # Sam 1794163062: incomplete evidence is never absence
                 "a pagination gap: fewer rows than GitHub's total": ([{"total_count": 3, "artifacts": [artifact_row(name="other", aid=1)]}],
                                                                       "completion-artifact-listing-incomplete"),
                 "a missing second page": ([{"total_count": 101, "artifacts": [artifact_row(name="other", aid=n) for n in range(100)]}],
                                           "completion-artifact-listing-incomplete"),
                 "pages that disagree on the total": ([{"total_count": 1, "artifacts": []}, {"total_count": 2, "artifacts": [artifact_row(expired=True)]}],
                                                      "completion-artifact-listing-incomplete"),
                 "no total_count": ([{"artifacts": []}], "completion-artifact-listing-incomplete"),
                 "a non-integer total": ([{"total_count": "0", "artifacts": []}], "completion-artifact-listing-incomplete"),
                 "a duplicated row (a repeated page)": ([{"total_count": 2, "artifacts": [artifact_row(expired=True)]},
                                                         {"total_count": 2, "artifacts": [artifact_row(expired=True)]}],
                                                        "completion-artifact-listing-incomplete")}
        for label, (pages, code) in cases.items():
            with self.subTest(label), self.assertRaisesRegex(P.Refused, code):
                P.retire_unattested(state, pages, "2026-11-02T09:00:00Z", "9" * 64)

    def test_only_a_pending_incomplete_attempt_can_retire_and_the_inputs_are_closed(self):
        state, _ = self.pending_state()
        none = [{"total_count": 0, "artifacts": []}]
        running = P.begin(P.parse_body(""), "101", 1, SHA, "2026-10-31T19:00:00Z")
        for label, (st, listed, pred, code) in {
                "no pending completion": (running, "2026-11-02T09:00:00Z", "9" * 64, "unattested-not-a-candidate"),
                "listed before the attempt started": (state, "2026-10-31T18:59:59Z", "9" * 64, "unattested-listed-at"),
                "listed time not UTC": (state, "2026-11-02 09:00", "9" * 64, "unattested-listed-at"),
                "no predecessor": (state, "2026-11-02T09:00:00Z", "x", "unattested-predecessor")}.items():
            with self.subTest(label), self.assertRaisesRegex(P.Refused, code):
                P.retire_unattested(st, none, listed, pred)
        out = P.retire_unattested(state, none, "2026-11-02T09:00:00Z", "9" * 64)
        stored = P.parse_body(P.render(out))
        bad = json.loads(json.dumps(stored))
        bad["retiredAttempts"][-1]["evidence"]["unexpiredArtifacts"] = 1
        with self.assertRaisesRegex(P.Refused, "retired-evidence"):
            P.parse_body(P.render.__globals__["MARKER"] + "\n\n```json\n" + json.dumps(bad, sort_keys=True, separators=(",", ":")) + "\n```\n")

    def test_the_cli_branches_present_absent_and_refused(self):
        state, _ = self.pending_state()
        d = tempfile.mkdtemp(prefix="ct-unattested-"); self.addCleanup(shutil.rmtree, d, True)
        script = os.path.join(ROOT, "scripts", "publish_latest_record.py")
        prev = os.path.join(d, "prev.md"); open(prev, "w").write(P.render(state))
        def run(cmd, pages, *extra):
            pf = os.path.join(d, "pages.json"); open(pf, "w").write(json.dumps(pages))
            return subprocess.run(["python3", "-I", script, cmd, "--previous", prev, "--artifact-pages", pf, "--out", os.path.join(d, "out")] + list(extra),
                                  capture_output=True, text=True, timeout=60)
        p = run("completion-artifact", [{"total_count": 1, "artifacts": [artifact_row()]}])
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.load(open(os.path.join(d, "out"))), {"created_at": "2026-10-31T18:42:00Z", "id": 7})
        self.assertEqual(run("completion-artifact", [{"total_count": 1, "artifacts": [artifact_row(expired=True)]}]).returncode, 1)
        p = run("completion-artifact", [{"total_count": 3, "artifacts": [artifact_row(expired=True)]}])
        self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: completion-artifact-listing-incomplete"))
        p = run("retire-unattested", [{"total_count": 3, "artifacts": []}], "--listed-utc", "2026-11-02T09:00:00Z")
        self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: completion-artifact-listing-incomplete"))
        p = run("completion-artifact", [{"total_count": 2, "artifacts": [artifact_row(), artifact_row(aid=8)]}])
        self.assertEqual((p.returncode, p.stderr.strip()), (78, "BLOCKED_SETUP: completion-artifact-ambiguous"))
        p = run("retire-unattested", [{"total_count": 0, "artifacts": []}], "--listed-utc", "2026-11-02T09:00:00Z")
        self.assertEqual(p.returncode, 0, p.stderr)
        out = P.parse_body(open(os.path.join(d, "out")).read())
        self.assertEqual(out["retiredAttempts"][-1]["predecessorSha256"], hashlib.sha256(P.render(state).encode()).hexdigest())
