"""The R10 one-case attempt (Sam 1794145971 / 1794148674 / 1794149071 / 1794149353): the pinned grant names an explicit `selectedCases`
(["AHT-01"]); the Sam-owned request must be the SEMANTIC subset of the committed all-15 template for exactly those cases, with every cap
re-derived from the template's own rows and the reviewed budget model (450 + 4 identity, 2 Starts, 2 takes, 3 coaching, runner 60). A
changed selection, order, estimate, cap, release or harness pin refuses; a smoke subset is admitted ONLY for the R10 campaign."""
import copy
import hashlib
import json
import os
import unittest
from datetime import datetime, timezone
from unittest import mock

from _fixtures import ROOT
import accounting_rollup as R
import case_start_caps as C
import init_run_inputs as I

REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


BASE = load("config/runs/R10-3b040043-all15.json")
REQUEST = load("config/runs/R10-3b040043-aht01.json")
GRANT = load("config/runs/R10-3b040043-aht01-grant.json")
CFG = load("config/test-config.v1.json")
SCOPE = R.parse_scope(load("config/aggregate/period-scope.json"))
BM = CFG["modes"]["full"]["budgetModel"]


def derived(cases=("AHT-01",)):
    return I.subset_estimate(BASE, list(cases), BM)


class Derivation(unittest.TestCase):
    def test_the_derived_caps_are_the_agreed_figures_and_the_committed_bytes_are_pinned(self):
        d = derived()
        self.assertEqual(d, {"requests": {"planned": 350, "cleanupReserve": 10, "pooledSlack": 90, "runCap": 450}, "identityReads": 4,
                             "starts": 2, "takes": 2, "coachingCap": 3, "githubRunnerMinutesMax": 60})
        self.assertEqual(I.one_off_limits(d), {"endToEndMinutes": 100, "liveMinutes": 60, "requestsIncludingIdentity": 454, "identityReads": 4,
                                               "starts": 2, "takes": 2, "coachingCalls": 3, "retries": 0})
        self.assertEqual(GRANT["limits"], I.one_off_limits(d))
        self.assertEqual(GRANT["selectedCases"], ["AHT-01"])
        with open(os.path.join(REPO, I.ONE_OFF_GRANT_PATH), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), I.ONE_OFF_GRANT_SHA256)
        with open(os.path.join(REPO, I.ONE_OFF_TEMPLATE_PATH), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), GRANT["requestTemplateSha256"])
        with open(os.path.join(REPO, I.ONE_OFF_BASE_TEMPLATE_PATH), "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), I.ONE_OFF_BASE_TEMPLATE_SHA256)
        self.assertTrue(I.check_subset_template(BASE, REQUEST, ["AHT-01"], d, SCOPE["ceilings"]))

    def test_the_rule_reproduces_the_budget_model_for_other_subsets(self):
        d = derived(("AHT-01", "AHT-11"))
        rows = {r["case"]: r for r in BASE["selection"]}
        ceil = lambda v: ((v * 125 + 99) // 100 + 9) // 10 * 10  # noqa: E731
        self.assertEqual(d["requests"]["runCap"], ceil(rows["AHT-01"]["plannedRequests"]) + ceil(rows["AHT-11"]["plannedRequests"]) + 20)
        self.assertEqual((d["identityReads"], d["starts"], d["takes"]), (6, 2 + 3, 5))
        self.assertEqual(d["coachingCap"], 7)     # ceil(5 x 1.25)

    def test_selected_cases_are_explicit_unique_canonical_and_never_defaulted(self):
        for bad in (None, [], "AHT-01", ["AHT-01", "AHT-01"], ["AHT-02", "AHT-01"], ["AHT-16"], ["aht-01"], [1]):
            with self.assertRaisesRegex(I.Refused, "one-off-selected-cases", msg=repr(bad)):
                I._canonical_cases(bad)
        self.assertEqual(I._canonical_cases(["AHT-01", "AHT-15"]), ["AHT-01", "AHT-15"])


class SubsetTemplate(unittest.TestCase):
    def refuses(self, change, code):
        t = copy.deepcopy(REQUEST)
        change(t)
        with self.assertRaisesRegex(I.Refused, code):
            I.check_subset_template(BASE, t, ["AHT-01"], derived(), SCOPE["ceilings"])

    def test_every_semantic_field_is_bound(self):
        cases = {
            "another case added": (lambda t: t["selection"].append(dict(BASE["selection"][1], order=2)), "one-off-subset-selection"),
            "the case swapped": (lambda t: t["selection"].__setitem__(0, dict(BASE["selection"][1], order=1)), "one-off-subset-selection"),
            "a changed planned figure": (lambda t: t["selection"][0].update(plannedRequests=349), "one-off-subset-selection"),
            "a changed Start cap": (lambda t: t["selection"][0].update(startPressCap=3), "one-off-subset-selection"),
            "a reordered row": (lambda t: t["selection"][0].update(order=2), "one-off-subset-selection"),
            "a larger run cap": (lambda t: t["estimate"]["requests"].update(runCap=451), "one-off-subset-estimate"),
            "more identity reads": (lambda t: t["estimate"].update(identityReads=5), "one-off-subset-estimate"),
            "more takes": (lambda t: t["estimate"].update(takes=3), "one-off-subset-estimate"),
            "a resized runner": (lambda t: t["estimate"].update(githubRunnerMinutesMax=31), "one-off-subset-estimate"),
            "more coaching": (lambda t: t["estimate"]["providerBillableRequests"].update(coachingCap=4), "one-off-subset-estimate"),
            "a paid action": (lambda t: t["estimate"].update(paidActionsAuthorizedUsd=1), "one-off-subset-estimate"),
            "an approved cap above the derived": (lambda t: t["approvedLimits"].update(runCapRequests=460), "one-off-subset-approved-limits"),
            "an unfiltered Start-cap map": (lambda t: t["approvedLimits"].update(startPressCaps=dict(BASE["approvedLimits"]["startPressCaps"])),
                                            "one-off-subset-approved-limits"),
            "an identity cap above the scope": (lambda t: t["approvedLimits"].update(identityCap=134), "one-off-subset-approved-limits"),
            "a proposed cap that differs": (lambda t: t["proposedLimits"].update(runCapRequests=597), "one-off-subset-proposed-limits"),
            "another release": (lambda t: t["release"].update(testedSha="f" * 40), "one-off-subset-not-the-template"),
            "another campaign id": (lambda t: t.update(runId="R10-3b040043-smoke01"), "one-off-subset-not-the-template"),
            "full mode": (lambda t: t.update(coverageMode="full"), "one-off-subset-not-the-template"),
            "another harness pin": (lambda t: t["harness"].update(codeManifestSha256="0" * 64), "one-off-subset-harness"),
        }
        for label, (change, code) in cases.items():
            with self.subTest(label):
                self.refuses(change, code)

    def test_free_text_and_approval_references_may_differ(self):
        t = copy.deepcopy(REQUEST)
        t["purpose"] = "another purpose"
        t["selection"][0]["reason"] = "another reason"
        t["harness"]["ownerApprovalRef"] = "slack:1.000001"
        self.assertTrue(I.check_subset_template(BASE, t, ["AHT-01"], derived(), SCOPE["ceilings"]))


class GrantBinding(unittest.TestCase):
    def test_the_committed_grant_admits_exactly_its_selection_inside_its_window(self):
        occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T15:10:00Z")
        self.assertEqual([s["case"] for s in occ["selection"]], ["AHT-01"])
        self.assertEqual((occ["window"]["endUtc"], occ["window"]["liveMinutes"], occ["selectionApprovalRef"]),
                         ("2026-11-08T16:50:00Z", 60, GRANT["approvalRef"]))
        cases = I.check_request(occ, datetime(2026, 11, 8, 15, 10, tzinfo=timezone.utc), I._request_keys())
        self.assertEqual(cases, ["AHT-01"])
        self.assertEqual(I.check_ceilings(CFG, occ, cases, 85), 31)
        self.assertEqual(C.request_caps(occ, execution=True), ("smoke", {"AHT-01": 2}))
        with self.assertRaisesRegex(I.Refused, "one-off-grant-selection-differs"):
            I.one_off_grant(REPO, None, "2026-11-08T15:10:00Z", selection=["AHT-01", "AHT-02"])
        with self.assertRaisesRegex(I.Refused, "one-off-grant-selection-differs"):
            I.one_off_grant(REPO, None, "2026-11-08T15:10:00Z", selection=I.ALL_CASES)

    def test_a_grant_without_or_with_another_selection_refuses(self):
        original = I._read
        for label, change, code in (("no selectedCases", lambda g: g.pop("selectedCases"), "one-off-grant-shape"),
                                    ("empty", lambda g: g.update(selectedCases=[]), "one-off-selected-cases"),
                                    ("all fifteen", lambda g: g.update(selectedCases=I.ALL_CASES), "one-off-grant-selection-differs"),
                                    ("limits not derived", lambda g: g["limits"].update(requestsIncludingIdentity=3361), "one-off-grant-limits")):
            g = copy.deepcopy(GRANT)
            change(g)
            variant = json.dumps(g, indent=2).encode() + b"\n"
            reader = lambda path, v=variant: v if str(path).endswith(I.ONE_OFF_GRANT_PATH) else original(path)  # noqa: E731
            with self.subTest(label), mock.patch.multiple(I, _read=reader, ONE_OFF_GRANT_SHA256=hashlib.sha256(variant).hexdigest()):
                with self.assertRaisesRegex(I.Refused, code):
                    I.one_off_grant(REPO, None, "2026-11-08T15:10:00Z", selection=["AHT-01"])

    def test_the_base_template_is_pinned(self):
        with mock.patch.object(I, "ONE_OFF_BASE_TEMPLATE_SHA256", "0" * 64), self.assertRaisesRegex(I.Refused, "one-off-grant-base-template"):
            I.one_off_grant(REPO, None, "2026-11-08T15:10:00Z", selection=["AHT-01"])


class SmokeSubsetOnlyForTheR10Campaign(unittest.TestCase):
    def occurrence(self):
        return I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T15:10:00Z")

    def test_check_request_and_start_caps_refuse_a_smoke_subset_of_any_other_campaign(self):
        other = dict(self.occurrence(), runId="UNIT-SMOKE-SUBSET")
        with self.assertRaisesRegex(I.Refused, "smoke-mode-needs-all-fifteen"):
            I.check_request(other, datetime(2026, 11, 8, 15, 10, tzinfo=timezone.utc), I._request_keys())
        with self.assertRaises(C.InputValidationError):
            C.request_caps(other, execution=True)

    def test_the_r10_subset_must_still_be_in_catalog_order(self):
        occ = self.occurrence()
        occ["selection"] = [dict(BASE["selection"][1], order=1), dict(occ["selection"][0], order=2)]
        with self.assertRaisesRegex(I.Refused, "smoke-mode-needs-all-fifteen"):
            I.check_request(occ, datetime(2026, 11, 8, 15, 10, tzinfo=timezone.utc), I._request_keys())


if __name__ == "__main__":
    unittest.main()
