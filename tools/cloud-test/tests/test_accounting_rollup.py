"""Accepted-rollup receiving mode , offline: a SYNTHETIC bootstrap accepted through test-only pins, and the real
state-ref writer on a temporary bare repository. Anchor, period, predecessor and replay negatives; unresolved usage is never zeroed."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (sys.path setup)
import accounting_rollup as R
import state_ref_writer as W

CAPS = {"requests": 800, "identityReads": 20, "starts": 6, "takes": 4, "coachingRequests": 5, "runnerMinutes": 340}
SHA_REF = "sha256:" + "a" * 64
BOUND_SOURCE = "sha256:" + "c" * 64
BOUND_CONTROL = "sha256:" + "d" * 64
BOUND_REVIEW = "sha256:" + "e" * 64


def usage(**over):
    value = {"requests": 40, "identityReads": 2, "starts": 1, "takes": 0, "coachingRequests": 0, "runnerMinutes": 12}
    value.update(over)
    return value


def bounded_pair(ref="gha-run:41071743003", bound=None, observed=None, result_over=None, item_over=None):
    """One charged item and the exact content-free result artifact that independently bounds it."""
    value = usage() if bound is None else copy.deepcopy(bound)
    result = {"schema": R.BOUND_SCHEMA, "itemRef": ref, "method": "enforced-maximum", "sourceRef": BOUND_SOURCE,
              "controlRef": BOUND_CONTROL, "reviewRef": BOUND_REVIEW,
              "observedMinimum": copy.deepcopy(value if observed is None else observed), "upperBound": copy.deepcopy(value)}
    result.update(result_over or {})
    item = {"kind": "diagnostic", "ref": ref, "disposition": "BOUNDED", "usage": value,
            "boundResultRef": R._bound_result_ref(result)}
    item.update(item_over or {})
    return item, result


def bootstrap(**over):
    """Historical usage only: no period, no ceiling. Coaching and runner minutes are unknown (null), never 0."""
    doc = {"schema": R.SCHEMA, "asOfUtc": "2026-11-01T17:00:00Z", "sourceRecords": [SHA_REF],
           "usage": {"requests": 7956, "identityReads": 122, "starts": 64, "takes": 38, "coachingRequests": None, "runnerMinutes": None},
           "authority": {"approvalRef": "slack:1793553421.029269", "expired": True},
           "unresolved": [{"kind": "diagnostic", "ref": "sha256:" + "b" * 64, "disposition": "MEASURED",
                           "usage": {"requests": 40, "identityReads": 2, "starts": 1, "takes": 0, "coachingRequests": 0, "runnerMinutes": 12}}]}
    doc.update(over)
    return json.dumps(doc, sort_keys=True).encode()


def bounded_bootstrap(items=None, results=None, source_records=None, **over):
    if items is None and results is None:
        item, result = bounded_pair()
        items, results = [item], [result]
    items, results = items or [], results or []
    records = [SHA_REF]
    for result in results:
        records.extend((result.get("sourceRef"), result.get("controlRef"), result.get("reviewRef"), R._bound_result_ref(result)))
    records = list(dict.fromkeys(ref for ref in records if isinstance(ref, str))) if source_records is None else source_records
    return bootstrap(sourceRecords=records, unresolved=items, boundResults=results, **over)


def scope(**over):
    """An explicitly approved period scope (synthetic): its own period, ceilings and carryover rule."""
    s = {"schema": R.SCOPE_SCHEMA, "approvalRef": "slack:1793555433.084449", "periodStartUtc": "2026-11-02T00:00:00Z",
         "periodEndUtc": "2026-12-02T00:00:00Z", "carryover": "none",
         "ceilings": {"requests": 12000, "protectedReserveRequests": 300, "identityReads": 200, "starts": 120, "takes": 80}}
    s.update(over)
    return s


def refused(test, code, fn, *a, **k):
    with test.assertRaises(R.Refused) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Journal(unittest.TestCase):
    """A genesis-rooted state ref on a temporary bare repository, with the synthetic bootstrap accepted through test-only pins."""
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.d)
        self.remote = os.path.join(self.d, "remote.git")
        subprocess.run(["git", "init", "-q", "--bare", self.remote], check=True)
        self.repo = os.path.join(self.d, "writer")
        subprocess.run(["git", "init", "-q", self.repo], check=True)
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@invalid", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@invalid"}

        def git(*a, data=None):
            return subprocess.run(["git", "-C", self.repo, *a], input=data, capture_output=True, check=True, env=env).stdout.decode().strip()
        self.git = git
        blob = git("hash-object", "-w", "--stdin", data=W.ledger_bytes([]))
        tree = git("mktree", data=("100644 blob %s\tledger.json\n" % blob).encode())
        self.root = git("commit-tree", tree, data=b"genesis\n")
        git("push", "-q", self.remote, "%s:%s" % (self.root, W.STATE_REF))
        self.raw = bootstrap()
        self.pins = {"accepted_sha256": hashlib.sha256(self.raw).hexdigest(), "accepted_root": self.root}

    def chain(self):
        return W.validate_chain(self.repo, W.fetch_head(self.repo, self.remote, self.remote), self.root)

    def append(self, kind, run, allocation, at="2026-11-02T04:00:00Z", provenance="approval:slack-1793553421.029269", campaign="R10-manual"):
        head = W.fetch_head(self.repo, self.remote, self.remote)
        e = {"type": kind, "campaignId": campaign, "runId": run, "attempt": 1, "allocation": dict(allocation),
             "provenance": provenance, "atUtc": at}
        return W.propose(self.repo, self.remote, head, e, self.root, self.remote)

    def receive(self, sc=None, chain=None, raw=None):
        return R.receive(raw or self.raw, sc or scope(), chain if chain is not None else self.chain(), **self.pins)


class Rollup(Journal):
    def test_evidence_backed_upper_bound_is_distinct_and_fully_charged(self):
        item, result = bounded_pair()
        raw = bounded_bootstrap([item], [result])
        out = R.receive(raw, scope(carryover="historical"), self.chain(), accepted_sha256=hashlib.sha256(raw).hexdigest(),
                        accepted_root=self.root)
        self.assertEqual((out["historical"]["requests"], out["requests"]["conservativeUsed"]), (7996, 7996))
        self.assertEqual(out["historicalResolution"], [{"kind": "diagnostic", "ref": "gha-run:41071743003",
                                                        "disposition": "BOUNDED", "usage": usage(),
                                                        "boundEvidence": {"resultRef": R._bound_result_ref(result),
                                                                          "method": "enforced-maximum", "sourceRef": BOUND_SOURCE,
                                                                          "controlRef": BOUND_CONTROL, "reviewRef": BOUND_REVIEW}}])

    def test_measured_and_bounded_items_keep_provenance_and_both_count(self):
        measured = {"kind": "diagnostic", "ref": "sha256:" + "b" * 64, "disposition": "MEASURED", "usage": usage(requests=5)}
        item, result = bounded_pair(bound=usage(requests=7))
        raw = bounded_bootstrap([measured, item], [result])
        out = R.receive(raw, scope(carryover="historical"), self.chain(), accepted_sha256=hashlib.sha256(raw).hexdigest(),
                        accepted_root=self.root)
        self.assertEqual(out["historical"]["requests"], 7968)
        self.assertEqual([item["disposition"] for item in out["historicalResolution"]], ["MEASURED", "BOUNDED"])

    def test_a_bound_requires_the_actual_reviewed_result_artifact_and_exact_bindings(self):
        item, result = bounded_pair()
        refused(self, "rollup-bound-evidence-missing", R.parse_bootstrap, bounded_bootstrap([item], []))

        for change, code in (
            ({"method": "nominal-ceiling"}, "rollup-bound-result"),
            ({"sourceRef": "gha-run:41071743003"}, "rollup-source-records"),
            ({"controlRef": BOUND_SOURCE}, "rollup-bound-result"),
            ({"reviewRef": BOUND_CONTROL}, "rollup-bound-result"),
        ):
            bad_item, bad_result = bounded_pair(result_over=change)
            with self.subTest(result=change):
                refused(self, code, R.parse_bootstrap, bounded_bootstrap([bad_item], [bad_result]))

        unrelated_item, unrelated_result = bounded_pair(result_over={"itemRef": "gha-run:41115876890"})
        refused(self, "rollup-bound-evidence-unrelated", R.parse_bootstrap,
                bounded_bootstrap([unrelated_item], [unrelated_result]))

        result_ref = R._bound_result_ref(result)
        unanchored = [SHA_REF, BOUND_SOURCE, BOUND_CONTROL, BOUND_REVIEW]
        self.assertNotIn(result_ref, unanchored)
        refused(self, "rollup-bound-result-unanchored", R.parse_bootstrap,
                bounded_bootstrap([item], [result], source_records=unanchored))

        extra_item, extra_result = bounded_pair(ref="gha-run:41115876890")
        refused(self, "rollup-bound-evidence-unrelated", R.parse_bootstrap,
                bounded_bootstrap([item], [result, extra_result]))

    def test_a_bound_cannot_understate_or_substitute_the_usage_it_charges(self):
        item, result = bounded_pair(bound=usage(requests=40))
        item["usage"] = usage(requests=39)
        refused(self, "rollup-bound-understated", R.parse_bootstrap, bounded_bootstrap([item], [result]))

        joint_item, joint_result = bounded_pair(bound=usage(requests=39), observed=usage(requests=40))
        refused(self, "rollup-bound-understated", R.parse_bootstrap,
                bounded_bootstrap([joint_item], [joint_result]))

        for dimension, observed_value in (("coachingRequests", 10), ("runnerMinutes", 12)):
            upper = usage(**{dimension: 0})
            observed = usage(**{dimension: observed_value})
            joint_item, joint_result = bounded_pair(bound=upper, observed=observed)
            with self.subTest(dimension=dimension):
                refused(self, "rollup-bound-understated", R.parse_bootstrap,
                        bounded_bootstrap([joint_item], [joint_result]))

        unknown_item, unknown_result = bounded_pair(
            bound=usage(coachingRequests=None, runnerMinutes=None),
            observed=usage(coachingRequests=None, runnerMinutes=None),
        )
        self.assertEqual(
            R.parse_bootstrap(bounded_bootstrap([unknown_item], [unknown_result]))["unresolved"][0]["usage"],
            usage(coachingRequests=None, runnerMinutes=None),
            "unknown dimensions remain null rather than being coerced to zero",
        )

        # Changing accepted bytes remains a bootstrap substitution even when the changed document is internally well formed.
        accepted = bounded_bootstrap()
        substituted_item, substituted_result = bounded_pair(bound=usage(requests=41))
        substituted = bounded_bootstrap([substituted_item], [substituted_result])
        refused(self, "rollup-bootstrap-not-accepted", R.receive, substituted, scope(), self.chain(),
                accepted_sha256=hashlib.sha256(accepted).hexdigest(), accepted_root=self.root)

    def test_bound_results_are_unique_and_unknown_usage_is_never_zeroed(self):
        item, result = bounded_pair()
        refused(self, "rollup-bound-evidence-duplicate", R.parse_bootstrap,
                bounded_bootstrap([item], [result, copy.deepcopy(result)]))
        refused(self, "rollup-bound-evidence-duplicate", R.parse_bootstrap,
                bounded_bootstrap([item, copy.deepcopy(item)], [result]))
        unresolved = bootstrap(unresolved=[{"kind": "diagnostic", "ref": "gha-run:41071743003", "disposition": "UNRESOLVED", "usage": None}])
        fresh = R.receive(unresolved, scope(carryover="none"), self.chain(),
                          accepted_sha256=hashlib.sha256(unresolved).hexdigest(), accepted_root=self.root)
        self.assertEqual(fresh["requests"]["conservativeUsed"], 0)
        self.assertTrue(fresh["historicalIncomplete"])
        self.assertEqual(fresh["historicalResolution"], [{"kind": "diagnostic", "ref": "gha-run:41071743003",
                                                           "disposition": "UNRESOLVED", "usage": None}])
        refused(self, "rollup-unresolved-usage", R.receive, unresolved, scope(carryover="historical"), self.chain(),
                accepted_sha256=hashlib.sha256(unresolved).hexdigest(), accepted_root=self.root)
        zeroed_item, zeroed_result = bounded_pair(bound=usage(requests=0, identityReads=0, starts=0, takes=0))
        refused(self, "rollup-bound-zero", R.parse_bootstrap,
                bounded_bootstrap([zeroed_item], [zeroed_result]))

    def test_historical_usage_stays_distinct_and_is_counted_only_under_an_approved_carryover(self):
        none = self.receive()
        self.assertEqual((none["requests"]["conservativeUsed"], none["period"]["requests"], none["historical"]["requests"]), (0, 0, 7996))
        self.assertFalse(none["historicalIncomplete"])
        hist = self.receive(scope(carryover="historical"))
        self.assertEqual((hist["requests"]["conservativeUsed"], hist["identityReads"]["conservativeUsed"], hist["starts"]["ownerCounted"],
                          hist["takes"]["ownerCounted"]), (7996, 124, 65, 38), "an empty journal under carryover is the bootstrap, never zero")
        # Unknown coaching/runner dimensions stay unknown, never 0.
        self.assertEqual((hist["historical"]["coachingRequests"], hist["unknown"]), (None, {"coachingRequests": True, "runnerMinutes": True}))
        self.assertEqual(none["unknown"], {"coachingRequests": False, "runnerMinutes": False})

    def test_fresh_period_refuses_a_bootstrap_cutoff_that_overlaps_or_follows_its_start(self):
        accepted = bootstrap(asOfUtc="2026-11-02T00:00:00Z")
        result = R.receive(accepted, scope(carryover="none"), self.chain(),
                           accepted_sha256=hashlib.sha256(accepted).hexdigest(), accepted_root=self.root)
        self.assertEqual(result["period"]["requests"], 0, "a cutoff exactly at period start is wholly pre-period")
        for cutoff in ("2026-11-02T00:00:01Z", "2026-12-03T00:00:00Z"):
            with self.subTest(cutoff=cutoff):
                raw = bootstrap(asOfUtc=cutoff)
                refused(self, "rollup-bootstrap-overlaps-fresh-period", R.receive, raw, scope(carryover="none"), self.chain(),
                        accepted_sha256=hashlib.sha256(raw).hexdigest(), accepted_root=self.root)
        historical = bootstrap(asOfUtc="2026-12-03T00:00:00Z", unresolved=[])
        R.receive(historical, scope(carryover="historical"), self.chain(),
                  accepted_sha256=hashlib.sha256(historical).hexdigest(), accepted_root=self.root)

    def test_settles_and_outstanding_reservations_count_inside_the_approved_period(self):
        self.append("reserve", "101", CAPS)
        out = self.receive()
        self.assertEqual((out["requests"]["conservativeUsed"], out["outstandingReservations"]), (800, 1), "an open reservation counts as used")
        self.append("settle", "101", dict(CAPS, requests=640, identityReads=9, starts=4, takes=3))
        out = self.receive()
        self.assertEqual((out["requests"]["conservativeUsed"], out["identityReads"]["conservativeUsed"], out["starts"]["ownerCounted"],
                          out["takes"]["ownerCounted"], out["outstandingReservations"]), (640, 9, 4, 3, 0))
        self.append("reserve", "102", CAPS)
        self.append("release", "102", CAPS)
        self.assertEqual(self.receive()["requests"]["conservativeUsed"], 640, "a released reservation is no longer counted")

    def test_open_reservations_are_reported_per_admitted_request_until_settled_or_released(self):
        # #1772 review 4446137335: the Start check needs to know which open reservation a request already holds, so it is not charged twice.
        own, other = "a" * 64, "b" * 64
        self.append("reserve", "101", CAPS, provenance="request-sha256:" + own)
        self.append("reserve", "102", dict(CAPS, starts=2, takes=1), provenance="request-sha256:" + other)
        self.append("reserve", "103", CAPS)  # an approval-provenance reserve names no request and is never attributed to one
        out = self.receive()
        self.assertEqual(out["openReservationsByRequest"], {
            own: {"R10-manual": {"count": 1, "requests": 800, "identityReads": 20, "starts": 6, "takes": 4}},
            other: {"R10-manual": {"count": 1, "requests": 800, "identityReads": 20, "starts": 2, "takes": 1}}})  # review 4447628949: all four
        self.assertEqual(out["starts"]["ownerCounted"], 14, "every open reservation is still counted as used")
        self.append("settle", "101", dict(CAPS, starts=4, takes=3), provenance="evidence-sha256:" + "c" * 64)
        self.append("release", "102", dict(CAPS, starts=2, takes=1))
        self.assertEqual(self.receive()["openReservationsByRequest"], {}, "a settled or released reservation is no longer held")

    def test_a_case10_observation_reserve_under_the_same_request_is_not_a_second_own_reservation(self):
        # #1772 review 4446862226 (broken before: both reserves were counted under the request digest alone, so the Start check refused
        # own-reservation-ambiguous). The real observation reserve uses its own campaign and a zero-Start read budget.
        import case_start_caps as CS
        import case10_observation as O
        own = "a" * 64
        self.append("reserve", "101", CAPS, provenance="request-sha256:" + own)
        observation = O.W.validate_event({"type": "reserve", "campaignId": "R10-manual" + O.RESERVATION_SUFFIX, "runId": "101", "attempt": 1,
                                          "allocation": dict({k: 0 for k in O.W.CATS}, requests=50, identityReads=2),
                                          "provenance": "request-sha256:" + own, "atUtc": "2026-11-02T04:00:00Z"})
        self.append("reserve", "101", observation["allocation"], provenance=observation["provenance"], campaign=observation["campaignId"])
        out = self.receive()
        self.assertEqual(out["openReservationsByRequest"][own], {
            "R10-manual": {"count": 1, "requests": 800, "identityReads": 20, "starts": 6, "takes": 4},
            "R10-manual.case10-observation": {"count": 1, "requests": 50, "identityReads": 2, "starts": 0, "takes": 0}})
        # the campaign's own reservation, unambiguous, in all four G5 dimensions (review 4447628949)
        self.assertEqual(CS.own_reservation(out, own, "R10-manual"), {"requests": 800, "identityReads": 20, "starts": 6, "takes": 4})
        self.assertEqual(CS.OWN_DIMENSIONS, R.G5_KEYS)
        self.assertEqual(out["requests"]["conservativeUsed"], 800 + 50, "the observation's request charge is still counted")
        self.assertEqual(CS.own_reservation(out, "b" * 64, "R10-manual"), dict.fromkeys(R.G5_KEYS, 0))  # an unrelated request holds nothing
        # a duplicate open reserve of the SAME request and campaign stays ambiguous
        self.append("reserve", "102", CAPS, provenance="request-sha256:" + own)
        with self.assertRaisesRegex(ValueError, "own-reservation-ambiguous"):
            CS.own_reservation(self.receive(), own, "R10-manual")

    def test_scope_and_carryover_must_be_explicitly_approved(self):
        for sc, code in ((None, "rollup-period-scope-unapproved"), ({}, "rollup-period-scope-unapproved"),
                         (scope(approvalRef=""), "rollup-period-scope-unapproved"), (scope(periodEndUtc="2026-11-01T00:00:00Z"), "rollup-period-scope-unapproved"),
                         (scope(carryover=None), "rollup-carryover-unapproved"), (scope(carryover="lifetime"), "rollup-carryover-unapproved"),
                         (scope(ceilings={"requests": 1}), "rollup-ceilings")):
            with self.subTest(code=code, sc=str(sc)[:40]):
                refused(self, code, R.receive, self.raw, sc, self.chain(), **self.pins)

    def test_anchor_negatives(self):
        # The selected R10 source has production pins.  Removing either pin in
        # isolation still refuses before any accounting is consumed.
        from unittest import mock
        with mock.patch.object(R, "ACCEPTED_BOOTSTRAP_SHA256", None), mock.patch.object(R, "ACCEPTED_ROOT", None):
            refused(self, "rollup-not-accepted", R.receive, self.raw, scope(), self.chain())
        self.assertEqual((R.ACCEPTED_BOOTSTRAP_SHA256, R.ACCEPTED_ROOT),
                         ("0a3e60271dc703f12cf02684450a9f74bc7f60d5c3f610a86bb9eaddc268f174",
                          "92d6ebf902351750c368d7d513116c6b1f19f80c"))
        refused(self, "rollup-bootstrap-not-accepted", R.receive, bootstrap(asOfUtc="2026-11-01T18:00:00Z"), scope(), self.chain(), **self.pins)
        refused(self, "rollup-predecessor-gap", R.receive, self.raw, scope(), self.chain(), accepted_sha256=self.pins["accepted_sha256"],
                accepted_root="f" * 40)

    def test_period_and_replay_negatives(self):
        self.append("reserve", "101", CAPS, at="2026-11-01T23:00:00Z")  # before the approved period starts
        refused(self, "rollup-event-outside-period", self.receive)
        chain = self.chain()
        self.append("settle", "101", dict(CAPS, requests=10), at="2026-11-01T23:30:00Z")
        doubled = copy.deepcopy(self.chain())
        doubled[-1][1].append(dict(doubled[-1][1][-1]))
        refused(self, "rollup-event-outside-period", self.receive, None, doubled)
        sha, events, raw = copy.deepcopy(chain[-1])  # chain entries are (sha, events, ledger bytes) tuples
        events[0]["atUtc"] = "2026-11-03T00:00:00Z"
        settle = dict(events[0], type="settle")
        inside = chain[:-1] + [(sha, events + [settle, dict(settle)], raw)]
        refused(self, "rollup-settle-replayed", self.receive, None, inside)

    def test_unresolved_usage_is_never_zeroed_or_charged_to_the_expired_ceiling(self):
        unknown = bootstrap(unresolved=[{"kind": "evaluator-start", "ref": "sha256:" + "c" * 64, "disposition": "UNRESOLVED", "usage": None}])
        fresh = R.receive(unknown, scope(carryover="none"), self.chain(), accepted_sha256=hashlib.sha256(unknown).hexdigest(),
                          accepted_root=self.root)
        self.assertEqual(fresh["requests"]["conservativeUsed"], 0)
        self.assertTrue(fresh["historicalIncomplete"])
        refused(self, "rollup-unresolved-usage", R.receive, unknown, scope(carryover="historical"), self.chain(), accepted_sha256=hashlib.sha256(unknown).hexdigest(),
                accepted_root=self.root)
        zero = {"requests": 0, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}
        for bad in ([{"kind": "evaluator-start", "ref": SHA_REF, "disposition": "UNRESOLVED", "usage": zero}],
                    [{"kind": "evaluator-start", "ref": SHA_REF, "disposition": "MEASURED", "usage": None}],
                    [{"kind": "other", "ref": SHA_REF, "disposition": "MEASURED", "usage": zero}],
                    [{"kind": "diagnostic", "ref": SHA_REF, "disposition": "MEASURED", "usage": dict(zero, requests=None)}]):
            raw = bootstrap(unresolved=bad)
            refused(self, "rollup-unresolved", R.parse_bootstrap, raw)

    def test_a_github_run_id_is_only_a_locator_for_an_unresolved_item(self):
        # the six later R9 runs are located by run id, never accepted; their usage stays null.
        runs = ("41071743003", "41115876890", "41134025368", "41231659142", "41322870182", "41325698722")
        located = [{"kind": "diagnostic", "ref": "gha-run:" + r, "disposition": "UNRESOLVED", "usage": None} for r in runs]
        self.assertEqual([i["ref"] for i in R.parse_bootstrap(bootstrap(unresolved=located))["unresolved"]], ["gha-run:" + r for r in runs])
        raw = bootstrap(unresolved=located)
        fresh = R.receive(raw, scope(carryover="none"), self.chain(), accepted_sha256=hashlib.sha256(raw).hexdigest(),
                          accepted_root=self.root)
        self.assertEqual([i["ref"] for i in fresh["historicalResolution"]], ["gha-run:" + r for r in runs])
        self.assertTrue(fresh["historicalIncomplete"])
        refused(self, "rollup-unresolved-usage", R.receive, raw, scope(carryover="historical"), self.chain(), accepted_sha256=hashlib.sha256(raw).hexdigest(),
                accepted_root=self.root)
        measured = {"requests": 1, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}
        for bad in ({"kind": "diagnostic", "ref": "gha-run:41071743003", "disposition": "MEASURED", "usage": measured},
                    {"kind": "diagnostic", "ref": "gha-run:041071743003", "disposition": "UNRESOLVED", "usage": None},
                    {"kind": "diagnostic", "ref": "gha-run:", "disposition": "UNRESOLVED", "usage": None},
                    {"kind": "diagnostic", "ref": "run:41071743003", "disposition": "UNRESOLVED", "usage": None}):
            with self.subTest(ref=bad["ref"], disposition=bad["disposition"]):
                refused(self, "rollup-unresolved", R.parse_bootstrap, bootstrap(unresolved=[bad]))

    def test_the_bootstrap_is_historical_closed_and_content_free(self):
        for over, code in (({"email": "x@y.invalid"}, "rollup-bootstrap-shape"), ({"period": {}}, "rollup-bootstrap-shape"),
                           ({"ceilings": {}}, "rollup-bootstrap-shape"), ({"schema": "x"}, "rollup-bootstrap-shape"),
                           ({"sourceRecords": ["free text"]}, "rollup-source-records"), ({"sourceRecords": []}, "rollup-source-records"),
                           ({"usage": {"requests": -1, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}}, "rollup-usage"),
                           ({"usage": {"requests": None, "identityReads": 0, "starts": 0, "takes": 0, "coachingRequests": None, "runnerMinutes": None}}, "rollup-usage"),
                           ({"authority": {"approvalRef": "", "expired": True}}, "rollup-authority")):
            with self.subTest(code=code):
                refused(self, code, R.parse_bootstrap, bootstrap(**over))


if __name__ == "__main__":
    unittest.main()
