"""The R10 one-case attempt : the pinned grant names an explicit `selectedCases`
(["AHT-01"]); the the reviewer-owned request must be the SEMANTIC subset of the committed all-15 template for exactly those cases, with every cap
re-derived from the template's own rows and the reviewed budget model (450 + 4 identity, 2 Starts, 2 takes, 3 coaching, runner 60). A
changed selection, order, estimate, cap, release or harness pin refuses; a smoke subset is admitted ONLY for the R10 campaign."""
import copy
import hashlib
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

from _fixtures import EXPIRED_GRANT_REL, ROOT, with_expired_grant
import accounting_rollup as R
import case_start_caps as C
import init_run_inputs as I

# The committed (production) pin and path, read before any test activates the expired fixture grant.
COMMITTED_GRANT_PATH, COMMITTED_GRANT_SHA256 = I.ONE_OFF_GRANT_PATH, I.ONE_OFF_GRANT_SHA256

REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return json.load(f)


BASE = load("config/runs/R10-3b040043-all15.json")
REQUEST = load("config/runs/R10-3b040043-aht01.json")
GRANT = load(EXPIRED_GRANT_REL)
CFG = load("config/test-config.v1.json")
SCOPE = R.parse_scope(load("config/aggregate/period-scope.json"))
BM = CFG["modes"]["full"]["budgetModel"]
SMOKE_CATALOG = load("config/smoke-assertion-catalog.json")


def derived(cases=("AHT-01",)):
    return I.subset_estimate(BASE, list(cases), BM, SMOKE_CATALOG)


@with_expired_grant
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
        # takes come from the smoke catalog, never from Starts: AHT-11 is 3 Starts / 1 take
        self.assertEqual((SMOKE_CATALOG["cases"]["AHT-11"]["minimumTakes"], SMOKE_CATALOG["cases"]["AHT-01"]["minimumTakes"]), (1, 2))
        self.assertEqual((d["identityReads"], d["starts"], d["takes"]), (6, 2 + 3, 2 + 1))
        self.assertEqual(d["coachingCap"], 4)     # ceil(3 x 1.25)
        with self.assertRaisesRegex(I.Refused, "one-off-subset-takes"):
            I.subset_estimate(BASE, ["AHT-01"], BM, {"cases": {}})

    def test_selected_cases_are_explicit_unique_canonical_and_never_defaulted(self):
        for bad in (None, [], "AHT-01", ["AHT-01", "AHT-01"], ["AHT-02", "AHT-01"], ["AHT-16"], ["aht-01"], [1]):
            with self.assertRaisesRegex(I.Refused, "one-off-selected-cases", msg=repr(bad)):
                I._canonical_cases(bad)
        self.assertEqual(I._canonical_cases(["AHT-01", "AHT-15"]), ["AHT-01", "AHT-15"])


@with_expired_grant
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


@with_expired_grant
class GrantBinding(unittest.TestCase):
    def test_the_committed_grant_admits_exactly_its_selection_inside_its_window(self):
        occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        self.assertEqual([s["case"] for s in occ["selection"]], ["AHT-01"])
        self.assertEqual((occ["window"]["endUtc"], occ["window"]["liveMinutes"], occ["selectionApprovalRef"]),
                         ("2026-11-08T17:50:00Z", 60, GRANT["approvalRef"]))
        cases = I.check_request(occ, datetime(2026, 11, 8, 16, 10, tzinfo=timezone.utc), I._request_keys())
        self.assertEqual(cases, ["AHT-01"])
        self.assertEqual(I.check_ceilings(CFG, occ, cases, 85), 31)

    def test_the_one_case_job_is_bounded_by_its_reserved_runner_minutes(self):
        """#1788 review: an 85-minute dispatch job exceeded the one-case occurrence's 60-minute runner reservation. The job bound is that
        reservation exactly (the workflow derives it from the occurrence), and the one case's setup, live and collect fit inside it."""
        occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        reserved = occ["estimate"]["githubRunnerMinutesMax"]
        self.assertEqual(reserved, 60)
        I.check_job_bound(occ, reserved)
        live = I.check_ceilings(CFG, occ, ["AHT-01"], reserved)
        self.assertLessEqual(I.SETUP_RESERVE_MINUTES + live + I.COLLECT_RESERVE_MINUTES, reserved)
        for wrong in (85, 61, 59, None, "60"):
            with self.subTest(wrong=wrong), self.assertRaisesRegex(I.Refused, "job-timeout-not-the-reserved-runner-minutes"):
                I.check_job_bound(occ, wrong)
        for bad in (None, 0, 361, "60", True):
            broken = copy.deepcopy(occ)
            broken["estimate"]["githubRunnerMinutesMax"] = bad
            with self.subTest(bad=bad), self.assertRaisesRegex(I.Refused, "job-timeout-not-the-reserved-runner-minutes"):
                I.check_job_bound(broken, 60)
        self.assertEqual(C.request_caps(occ, execution=True), ("smoke", {"AHT-01": 2}))
        with self.assertRaisesRegex(I.Refused, "one-off-grant-selection-differs"):
            I.one_off_grant(REPO, None, "2026-11-08T16:10:00Z", selection=["AHT-01", "AHT-02"])
        with self.assertRaisesRegex(I.Refused, "one-off-grant-selection-differs"):
            I.one_off_grant(REPO, None, "2026-11-08T16:10:00Z", selection=I.ALL_CASES)

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
                    I.one_off_grant(REPO, None, "2026-11-08T16:10:00Z", selection=["AHT-01"])

    def test_the_base_template_is_pinned(self):
        with mock.patch.object(I, "ONE_OFF_BASE_TEMPLATE_SHA256", "0" * 64), self.assertRaisesRegex(I.Refused, "one-off-grant-base-template"):
            I.one_off_grant(REPO, None, "2026-11-08T16:10:00Z", selection=["AHT-01"])


@with_expired_grant
class SmokeSubsetOnlyForTheR10Campaign(unittest.TestCase):
    def occurrence(self):
        return I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")

    def test_check_request_and_start_caps_refuse_a_smoke_subset_of_any_other_campaign(self):
        other = dict(self.occurrence(), runId="UNIT-SMOKE-SUBSET")
        with self.assertRaisesRegex(I.Refused, "smoke-mode-needs-all-fifteen"):
            I.check_request(other, datetime(2026, 11, 8, 16, 10, tzinfo=timezone.utc), I._request_keys())
        with self.assertRaises(C.InputValidationError):
            C.request_caps(other, execution=True)

    def test_the_r10_subset_must_still_be_in_catalog_order(self):
        occ = self.occurrence()
        occ["selection"] = [dict(BASE["selection"][1], order=1), dict(occ["selection"][0], order=2)]
        with self.assertRaisesRegex(I.Refused, "smoke-mode-needs-all-fifteen"):
            I.check_request(occ, datetime(2026, 11, 8, 16, 10, tzinfo=timezone.utc), I._request_keys())


@with_expired_grant
class RealRequestValidator(unittest.TestCase):
    """the REAL validate_run_request.validate, as pipeline.py runs it, on the committed AHT-01 occurrence, the committed
    config, gap ledger and workflow. The R10 one-off subset is admitted exactly as the pinned grant selects it; ordinary smoke and full
    validation still require all fifteen."""
    SUBSET_ERROR = "a full or smoke run selects all 15 journeys, AHT-01..AHT-15, exactly once; a subset is a partial run"
    # the validator's own Start-allocation step (case_start_caps) refuses a non-R10 subset even earlier, with this message
    CAPS_ERROR = "full coverage selects all 15 journeys exactly once in order"

    def refused(self, req):
        errs = self.errors(req)
        self.assertTrue({self.SUBSET_ERROR, self.CAPS_ERROR, "invalid per-case Start allocation or input structure"} & set(errs), errs)

    def setUp(self):
        import validate_run_request as V
        from _fixtures import fake_rv, reconciliation
        self.V, self.rv, self.rc = V, fake_rv(), reconciliation()
        self.ledger, self.wf = load("config/gap-ledger.json"), load("workflow.json")
        self.occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")

    def errors(self, req):
        return self.V.validate(req, CFG, self.ledger, self.wf, self.rv, self.rc)[0]

    def test_the_committed_aht01_occurrence_passes_the_selected_case_rule(self):
        self.assertEqual(self.V.r10_selected_subset(self.occ), ["AHT-01"])
        self.assertNotIn(self.SUBSET_ERROR, self.errors(self.occ))

    def test_any_other_smoke_subset_or_a_widened_r10_selection_still_refuses(self):
        other = dict(self.occ, runId="UNIT-SMOKE-SUBSET")
        self.assertIsNone(self.V.r10_selected_subset(other))
        self.refused(other)
        # Start-cap-consistent variants, so the R10 subset rule itself (not an earlier cap check) is what refuses
        def with_selection(rows):
            req = copy.deepcopy(self.occ)
            req["selection"] = [dict(r, order=i + 1) for i, r in enumerate(rows)]
            caps = {r["case"]: r["startPressCap"] for r in rows}
            req["approvedLimits"]["startPressCaps"] = dict(caps)
            req["proposedLimits"]["startPressCaps"] = dict(caps)
            req["estimate"]["starts"] = sum(caps.values())
            return req
        widened, swapped = with_selection(BASE["selection"][:2]), with_selection([BASE["selection"][1]])
        self.assertNotIn(self.CAPS_ERROR, self.errors(widened))
        self.assertIn(self.SUBSET_ERROR, self.errors(widened))     # the R10 subset rule itself: not the grant's selection
        self.assertIn(self.SUBSET_ERROR, self.errors(swapped))
        self.assertNotIn(self.SUBSET_ERROR, self.errors(with_selection([BASE["selection"][0]])))
        full = dict(copy.deepcopy(self.occ), coverageMode="full", sampleMode="full")
        self.refused(full)

    def test_the_committed_tree_has_no_active_one_off_grant_and_admits_none(self):
        self.assertIsNone(COMMITTED_GRANT_SHA256)
        self.assertFalse(os.path.lexists(os.path.join(REPO, COMMITTED_GRANT_PATH)))
        with mock.patch.multiple(I, ONE_OFF_GRANT_PATH=COMMITTED_GRANT_PATH, ONE_OFF_GRANT_SHA256=COMMITTED_GRANT_SHA256):
            with self.assertRaisesRegex(I.Refused, "one-off-grant-unreadable"):
                I.one_off_grant(REPO)
            self.assertIsNone(self.V.r10_selected_subset(self.occ))
            self.assertIn(self.SUBSET_ERROR, self.errors(self.occ))
        # the expired grant's own bytes do not satisfy the committed (absent) pin either
        with mock.patch.multiple(I, ONE_OFF_GRANT_SHA256=COMMITTED_GRANT_SHA256):
            with self.assertRaisesRegex(I.Refused, "one-off-grant-not-the-reviewed-bytes"):
                I.one_off_grant(REPO)

    def test_an_unpinned_grant_admits_no_subset(self):
        with mock.patch.object(I, "ONE_OFF_GRANT_SHA256", "0" * 64):
            self.assertIsNone(self.V.r10_selected_subset(self.occ))
            self.assertIn(self.SUBSET_ERROR, self.errors(self.occ))


@with_expired_grant
class NotTargetedContract(unittest.TestCase):
    """Run 42494152179 : the admitted one-case request carried notTargeted as bare gap ids; the
    run reserved, passed admission, browser guard and identity, then the live report crashed (workflow_report: string indices). The
    run-request contract is a list of {gap, why}; the shape is now refused BEFORE the reserve (record-begin occurrence-check) and by the
    validator, and the corrected request passes the real pipeline and report."""
    ADMITTED = os.path.join(ROOT, "tests", "fixtures", "settled", "admitted-42494152179.json")

    def admitted(self):
        with open(self.ADMITTED, "rb") as f:
            raw = f.read()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), "98dac077a5cd032f39a3854dbf2fe810f4b69d5f12bffd54458ace35aaf0b3f0",
                         "the exact bytes run 42494152179 reserved (its reserve provenance)")
        return json.loads(raw)

    def test_the_exact_admitted_request_is_refused_before_the_reserve_and_by_the_validator(self):
        bad = self.admitted()
        with self.assertRaisesRegex(I.Refused, "^request-not-targeted$"):
            I.check_request(bad, datetime(2026, 11, 8, 15, 19, tzinfo=timezone.utc), I._request_keys())
        import validate_run_request as V
        from _fixtures import fake_rv, reconciliation
        errs = V.validate(bad, CFG, load("config/gap-ledger.json"), load("workflow.json"), fake_rv(), reconciliation())[0]
        self.assertIn("notTargeted must be a list of {gap, why}: each a tracked gap id and its reason (at least 10 characters)", errs)

    def test_every_malformed_entry_is_refused_and_an_empty_list_stays_valid(self):
        occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        now = datetime(2026, 11, 8, 16, 10, tzinfo=timezone.utc)
        self.assertTrue(all(set(n) == {"gap", "why"} for n in occ["notTargeted"]))
        for bad in (["GAP-02"], [{"gap": "GAP-02"}], [{"gap": "GAP-02", "why": "short"}], [{"gap": "GAP-02", "why": "a long enough reason", "x": 1}],
                    [{"gap": "gap-2", "why": "a long enough reason"}], [{"gap": 2, "why": "a long enough reason"}], "GAP-02", {"GAP-02": "why"}):
            with self.subTest(bad=bad), self.assertRaisesRegex(I.Refused, "^request-not-targeted$"):
                I.check_request(dict(occ, notTargeted=bad), now, I._request_keys())
        self.assertEqual(I.check_request(dict(occ, notTargeted=[]), now, I._request_keys()), ["AHT-01"])

    def test_without_an_active_grant_the_real_pipeline_refuses_the_one_case_request_and_still_refuses_the_admitted_shape(self):
        """The pipeline validates in a child process, where only the committed grant state exists: no active grant (it expired
        2026-11-12T00:00Z). The corrected request is refused ONLY as an unadmitted subset (its notTargeted shape is valid); the
        exact admitted request is still refused for its notTargeted shape."""
        import tempfile
        from _fixtures import NOW, TESTED, prerequisite, run_py
        from _synthetic_history import shared as synthetic_history
        prerequisite(os.system("git -C %s cat-file -e %s 2>/dev/null" % (REPO, TESTED)) == 0, "git history of the repository")
        good = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        results = {}
        for name, req in (("corrected", good), ("admitted", self.admitted())):
            d = tempfile.mkdtemp(prefix="ct-nt-")
            src, oc, out = os.path.join(d, "request.json"), os.path.join(d, "oc.json"), os.path.join(d, "out")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(req, f)
            with open(oc, "w", encoding="utf-8") as f:
                json.dump({"passed": True}, f)
            h = synthetic_history()
            r = run_py("scripts/pipeline.py", "--request", h.request(src), "--out-dir", out, "--offline-checks", oc, "--repo", REPO,
                       "--now", NOW, "--generated-at", NOW, *h.args(), "--require-secret-free")
            results[name] = (r, out)
        r, _ = results["corrected"]
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ERROR: " + RealRequestValidator.SUBSET_ERROR, r.stdout)
        self.assertNotIn("notTargeted must be a list of {gap, why}", r.stdout)
        r, _ = results["admitted"]
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ERROR: notTargeted must be a list of {gap, why}", r.stdout)


    def isolated_package_with_the_fixture_grant(self):
        """A temporary repository root whose tools/cloud-test is a byte copy of this package with exactly two differences: the preserved
        expired grant installed at the committed grant path, and ONE_OFF_GRANT_SHA256 pinned to its bytes (the change a reviewed grant
        makes). Every other repository entry is a read-only link to the real checkout. The committed tree itself is never modified."""
        import shutil
        import tempfile
        pkg = tempfile.mkdtemp(prefix="ct-grant-pkg-")
        self.addCleanup(shutil.rmtree, pkg, True)
        dst = os.path.join(pkg, "tools", "cloud-test")
        shutil.copytree(ROOT, dst, symlinks=True, ignore=shutil.ignore_patterns("__pycache__"))
        for name in os.listdir(REPO):
            if name not in ("tools", ".git"):
                os.symlink(os.path.join(REPO, name), os.path.join(pkg, name))
        for name in os.listdir(os.path.join(REPO, "tools")):
            if name != "cloud-test":
                os.symlink(os.path.join(REPO, "tools", name), os.path.join(pkg, "tools", name))
        with open(os.path.join(ROOT, EXPIRED_GRANT_REL), "rb") as f:
            raw = f.read()
        with open(os.path.join(pkg, COMMITTED_GRANT_PATH), "xb") as f:
            f.write(raw)
        init = os.path.join(dst, "scripts", "init_run_inputs.py")
        with open(init, encoding="utf-8") as f:
            src = f.read()
        self.assertEqual(src.count("ONE_OFF_GRANT_SHA256 = None\n"), 1)
        with open(init, "w", encoding="utf-8") as f:
            f.write(src.replace("ONE_OFF_GRANT_SHA256 = None\n", 'ONE_OFF_GRANT_SHA256 = "%s"\n' % hashlib.sha256(raw).hexdigest()))

        def digests(base):
            out = {}
            for d, dirs, files in os.walk(base):
                dirs[:] = [x for x in dirs if x != "__pycache__"]
                for name in files:
                    path = os.path.join(d, name)
                    with open(path, "rb") as f:
                        out[os.path.relpath(path, base)] = hashlib.sha256(f.read()).hexdigest()
            return out
        real, copy = digests(ROOT), digests(dst)
        grant_rel = os.path.relpath(os.path.join(REPO, COMMITTED_GRANT_PATH), ROOT)
        self.assertEqual(set(copy) - set(real), {grant_rel})
        self.assertEqual(set(real) - set(copy), set())
        self.assertEqual({k for k in real if real[k] != copy[k]}, {os.path.join("scripts", "init_run_inputs.py")})
        self.assertFalse(os.path.lexists(os.path.join(REPO, COMMITTED_GRANT_PATH)))
        return dst

    def test_with_the_fixture_grant_in_an_isolated_package_the_real_pipeline_admits_and_reports_the_one_case_request(self):
        """The positive real-pipeline contract, preserved without committing an active grant: the unchanged pipeline, validator and
        report of an isolated package that differs only by the installed fixture grant and its pin accept the corrected one-case
        request and render its Not-selected rows; the exact admitted request is still refused for its notTargeted shape."""
        import tempfile
        from _fixtures import NOW, TESTED, prerequisite
        from _synthetic_history import shared as synthetic_history
        prerequisite(os.system("git -C %s cat-file -e %s 2>/dev/null" % (REPO, TESTED)) == 0, "git history of the repository")
        pkg = self.isolated_package_with_the_fixture_grant()
        good = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        results = {}
        for name, req in (("corrected", good), ("admitted", self.admitted())):
            d = tempfile.mkdtemp(prefix="ct-nt-")
            src, oc, out = os.path.join(d, "request.json"), os.path.join(d, "oc.json"), os.path.join(d, "out")
            with open(src, "w", encoding="utf-8") as f:
                json.dump(req, f)
            with open(oc, "w", encoding="utf-8") as f:
                json.dump({"passed": True}, f)
            h = synthetic_history()
            env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", "/tmp")}
            r = subprocess.run([sys.executable, "-I", os.path.join(pkg, "scripts", "pipeline.py"), "--request", h.request(src),
                                "--out-dir", out, "--offline-checks", oc, "--repo", REPO, "--now", NOW, "--generated-at", NOW, *h.args(),
                                "--require-secret-free"], capture_output=True, text=True, env=env)
            results[name] = (r, out)
        r, out = results["corrected"]
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("run request VALID", r.stdout)
        with open(os.path.join(out, "report", "validation.json"), encoding="utf-8") as f:
            self.assertTrue(json.load(f)["valid"])
        with open(os.path.join(out, "report", "REPORT.html"), encoding="utf-8") as f:
            html = f.read()
        self.assertIn("Not selected: this one-case attempt runs only AHT-01 (GAP-01). GAP-02 is tracked separately", html)
        r, _ = results["admitted"]
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ERROR: notTargeted must be a list of {gap, why}", r.stdout)

@with_expired_grant
class ProjectionCatalog(unittest.TestCase):
    """the CLI `project` hardcoded the FULL assertion catalog (AHT-01 = 20 rows) even for smoke (15), so run
    42496837188's selected AHT-01 record was refused `row-verdicts`. The projection now builds row verdicts from the pinned catalog of the
    admitted request's depth, digest-checked; the publisher's count checks are unchanged."""
    SMOKE_IDS = None

    def setUp(self):
        import subprocess
        import sys
        import tempfile
        self.subprocess, self.sys = subprocess, sys
        self.d = tempfile.mkdtemp(prefix="ct-proj-")
        self.addCleanup(__import__("shutil").rmtree, self.d)
        occ = I.materialize_authoritative_smoke_occurrence(REPO, REQUEST, "2026-11-08T16:10:00Z")
        self.request_raw = json.dumps(occ, sort_keys=True).encode()
        self.request_sha = hashlib.sha256(self.request_raw).hexdigest()
        ids = SMOKE_CATALOG["cases"]["AHT-01"]["requiredAssertions"]
        self.assertEqual(len(ids), 15)
        self.assertEqual(len(load("config/assertion-catalog.json")["cases"]["AHT-01"]["requiredAssertions"]), 20)
        verdicts = ["PASS", "PASS", "FAIL"] + ["NOT RUN"] * 12          # the reviewer's exact 2 PASS / 1 FAIL / 12 NOT RUN shape
        self.case_results = json.dumps({"cases": [{"caseId": "AHT-01", "assertions": [{"id": a, "result": r} for a, r in zip(ids, verdicts)]}]}).encode()
        cr_sha = hashlib.sha256(self.case_results).hexdigest()
        T, H, P = "a" * 40, "b" * 64, "c" * 64
        self.run_record = {"schema": "speaksharp.cloud-test.run-record.v1", "runId": I.R10_ONE_OFF_RUN_ID, "result": "FAIL",
                           "release": {"testedSha": T, "servedShaAtAdmission": T}, "harness": {"codeManifestSha256": H},
                           "artifactDigests": {"case-results.json": cr_sha},
                           "startedUtc": "2026-11-08T15:59:00Z", "endedUtc": "2026-11-08T16:00:00Z",
                           "cases": [{"case": c, "result": "FAIL" if c == "AHT-01" else "NOT RUN",
                                      "assertions": {"PASS": 2, "FAIL": 1, "NOT RUN": 12} if c == "AHT-01" else {"PASS": 0, "FAIL": 0, "NOT RUN": 0}}
                                     for c in I.ALL_CASES]}
        smoke_pin = CFG["modes"]["smoke"]["assertionCatalog"]["sha256"]
        self.q = {"qualified": True, "campaignId": I.R10_ONE_OFF_RUN_ID, "caseResultsSha256": cr_sha, "testedSha": T, "servedSha": T,
                  "codeManifestSha256": H, "requestSha256": self.request_sha, "planSha256": P, "outcome": "failed", "coverageMode": "smoke",
                  "assertionDepth": "smoke", "coverage": "incomplete", "cases": ["AHT-01"], "catalogSha256": smoke_pin}
        self.prov = {"requestSha256": self.request_sha, "planSha256": P, "cases": ["AHT-01"], "caseResultsSha256": cr_sha,
                     "campaignId": I.R10_ONE_OFF_RUN_ID, "runId": "42496837188", "attempt": 1}
        self.T = T

    def project(self, catalog):
        return I.project(self.run_record, "42496837188", 1, "d" * 40, self.T, self.q, self.request_sha, self.prov, self.case_results, catalog)

    def test_the_full_catalog_refuses_row_verdicts_and_the_admitted_smoke_catalog_publishes(self):
        with self.assertRaisesRegex(I.Refused, "run-record-not-publishable:row-verdicts"):     # the defect, reproduced
            self.project(load("config/assertion-catalog.json"))
        catalog = I.projection_catalog(self.request_raw, self.request_sha, os.path.join(ROOT, "config", "test-config.v1.json"), self.q)
        rec = self.project(catalog)
        self.assertEqual((rec["coverage"], rec["outcome"], rec["rowVerdicts"]), ("incomplete", "failed", {"AHT-01": "PPF" + "N" * 12}))
        self.assertEqual(sum(c["result"] == "NOT SELECTED" for c in rec["cases"]), 14)

    def test_the_catalog_is_the_admitted_depths_pin_and_must_match_the_qualification(self):
        cfg_path = os.path.join(ROOT, "config", "test-config.v1.json")
        with self.assertRaisesRegex(I.Refused, "request-not-the-admitted-bytes"):
            I.projection_catalog(self.request_raw, "0" * 64, cfg_path, self.q)
        with self.assertRaisesRegex(I.Refused, "projection-catalog-not-the-qualified-catalog"):
            I.projection_catalog(self.request_raw, self.request_sha, cfg_path, dict(self.q, catalogSha256="e" * 64))
        full_request = json.dumps(dict(json.loads(self.request_raw), coverageMode="full")).encode()
        full = I.projection_catalog(full_request, hashlib.sha256(full_request).hexdigest(), cfg_path)
        self.assertEqual(len(full["cases"]["AHT-01"]["requiredAssertions"]), 20)
        with mock.patch.object(I, "_read", lambda path: b'{"cases": {}}'):
            with self.assertRaisesRegex(I.Refused, "assertion-catalog-not-pinned"):
                I.projection_catalog(self.request_raw, self.request_sha, cfg_path, self.q)

    def test_the_real_cli_projects_the_smoke_record(self):
        paths = {}
        for name, doc in (("run-record.json", self.run_record), ("qualification.json", self.q), ("provenance.json", self.prov)):
            paths[name] = os.path.join(self.d, name)
            with open(paths[name], "w", encoding="utf-8") as f:
                json.dump(doc, f)
        for name, raw in (("case-results.json", self.case_results), ("request.json", self.request_raw)):
            paths[name] = os.path.join(self.d, name)
            with open(paths[name], "wb") as f:
                f.write(raw)
        out = os.path.join(self.d, "latest-record.json")
        r = self.subprocess.run([self.sys.executable, "-I", os.path.join(ROOT, "scripts", "init_run_inputs.py"), "project",
                                 "--run-record", paths["run-record.json"], "--run-id", "42496837188", "--attempt", "1",
                                 "--source-sha", "d" * 40, "--tested-sha", self.T, "--qualification", paths["qualification.json"],
                                 "--provenance", paths["provenance.json"], "--case-results", paths["case-results.json"],
                                 "--request", paths["request.json"], "--request-sha256", self.request_sha, "--repo", REPO, "--out", out],
                                capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with open(out, encoding="utf-8") as f:
            rec = json.load(f)
        self.assertEqual((rec["coverage"], rec["outcome"], rec["rowVerdicts"]["AHT-01"]), ("incomplete", "failed", "PPF" + "N" * 12))


class PublishedDiagnosticCodes(ProjectionCatalog):
    """the closed diagnostic reaches the PUBLISHED record as per-case codes (stage, exact net error, guard upstream reason,
    absent egress proxy), from the same digest-verified projection as the case-timings table; never on a NOT SELECTED row; at most 8."""
    # SYNTHETIC EXTENSION of run 42496837188 : its real retained diagnostic had stage idle, step owner-bound and api
    # page.goto/kind network-error, but NOT the exact net error or the guard's proxyConfigured=false/upstream reason, which that run's
    # code did not record. Those fields are synthetic here and prove only the projection, not the historical cause.
    SYNTHETIC_EXTENSION_OF_42496837188 = {"stopCode": "completed", "exitCode": 0, "firstNonPassingAssertion": {"id": "owner-bound", "result": "FAIL"},
                       "driverInterruption": {"stage": "idle", "step": "owner-bound", "trail": [],
                                              "error": {"name": "Error", "code": None, "kind": "network-error", "api": "page.goto",
                                                        "timeoutMs": None, "testIds": [], "netError": "ERR_HTTP_RESPONSE_CODE_FAILURE"}},
                       "guard": {"upstreamMode": "env-proxy", "proxyConfigured": False, "proxyValid": False, "noProxyMatched": False,
                                 "upstreamReasons": {"proxy-not-configured": 1}}}

    def test_a_synthetic_extension_of_the_run_42496837188_shape_yields_closed_codes(self):
        self.assertEqual(I.diagnostic_codes(self.SYNTHETIC_EXTENSION_OF_42496837188),
                         ["stage-idle", "net-err-http-response-code-failure", "upstream-proxy-not-configured", "egress-proxy-absent"])
        self.assertEqual(I.diagnostic_codes(None), [])
        self.assertEqual(I.diagnostic_codes(I.UNKNOWN_DIAGNOSTIC), [])
        self.assertEqual(I.diagnostic_codes({"stopCode": "deadline"}), ["stop-deadline"])
        injected = {"stopCode": "completed", "driverInterruption": {"stage": "password-huntertwo", "error": {"netError": "ERR_SECRET token"}},
                    "guard": {"upstreamMode": "env-proxy", "proxyConfigured": "no", "upstreamReasons": {"secret.host": 1, "dns": 2}}}
        self.assertEqual(I.diagnostic_codes(injected), ["upstream-dns"])
        many = {"stopCode": "deadline", "driverInterruption": {"stage": "idle", "error": {"netError": "ERR_FAILED"}},
                "guard": {"upstreamMode": "env-proxy", "proxyConfigured": False, "upstreamReasons": {r: 1 for r in I.GUARD_UPSTREAM_REASONS}}}
        self.assertEqual(len(I.diagnostic_codes(many)), I.MAX_CASE_CODES)

    def test_project_publishes_the_codes_on_selected_rows_only_and_the_publisher_accepts_them(self):
        catalog = I.projection_catalog(self.request_raw, self.request_sha, os.path.join(ROOT, "config", "test-config.v1.json"), self.q)
        codes = I.diagnostic_codes(self.SYNTHETIC_EXTENSION_OF_42496837188)
        rec = I.project(self.run_record, "42496837188", 1, "d" * 40, self.T, self.q, self.request_sha, self.prov, self.case_results, catalog,
                        case_codes={"AHT-01": codes, "AHT-02": ["egress-proxy-absent"], "AHT-03": ["Bad Code!"]})
        by = {c["caseId"]: c for c in rec["cases"]}
        self.assertEqual(by["AHT-01"]["codes"], codes)
        self.assertEqual((by["AHT-02"]["result"], by["AHT-02"]["codes"]), ("NOT SELECTED", []))
        self.assertEqual(I.LR.sanitize_record(rec, require_source=True)["cases"][0]["codes"], codes)
        over = I.project(self.run_record, "42496837188", 1, "d" * 40, self.T, self.q, self.request_sha, self.prov, self.case_results, catalog,
                         case_codes={"AHT-01": ["code-%d" % i for i in range(12)]})
        self.assertEqual(len(over["cases"][0]["codes"]), I.MAX_CASE_CODES)

    def test_the_workflow_projects_with_the_case_directories(self):
        with open(os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml"), encoding="utf-8") as f:
            wf = f.read()
        block = wf[wf.index("init_run_inputs.py project"):wf.index('--out "$RUNNER_TEMP/latest-record.json"')]
        self.assertIn('--cases-dir "$CT_OUT/plan/run/cases"', block)


# The real driver path for a guard-refused navigation: browser-actions trackedGoto -> the source-adapters catch diagnostic ->
# retainInterruptionEvidence -> createCaseRecorder.finish, written into a real case directory. Shape and deny value are argv; a forged
# error (trustedBlocker-like properties on an ordinary Error) is the "forged" shape. Nothing else is synthesized.
GUARD_REFUSAL_DRIVER = r"""
const [ui, adapters, results, dir, shape, deny] = [require(process.argv[1]), require(process.argv[2]), require(process.argv[3]),
  process.argv[4], process.argv[5], process.argv[6]];
const listeners = new Set(), frame = {}, headers = { 'x-ss-harness-deny': deny };
const response = { status: () => 502, headerValue: async (n) => headers[n] ?? null, headers: () => headers,
  request: () => ({ isNavigationRequest: () => true }), frame: () => frame };
const page = { mainFrame: () => frame, on: (e, f) => { if (e === 'response') listeners.add(f); }, off: (e, f) => listeners.delete(f),
  goto: async () => { for (const f of listeners) f(response); if (shape === 'thrown') throw new Error('page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at https://app.example/auth/signin'); return response; } };
(async () => {
  let error;
  if (shape === 'forged') error = Object.assign(new Error('x'), { code: 'NOT_RUN', trustedBlocker: 'guard-refused-navigation:upstream-error', stopReason: 'guard-refused-navigation:upstream-error' });
  else { try { await ui.trackedGoto(page, 'https://app.example/auth/signin', 'route-signin', {}); } catch (e) { error = e; } }
  const config = { caseId: 'AHT-01', sourceSha: 'a'.repeat(40), servedSha: 'a'.repeat(40), targetUrl: 'https://speaksharp-public.vercel.app',
    requiredAssertions: ['owner-bound', 'fresh-first-session', 'owned-pages-closed'] };
  const recorder = results.createCaseRecorder(config, dir);
  const diag = { stage: ui.failureStage(error, page), stopReason: ui.stopReason(error), step: 'fresh-first-session', error: ui.safeErrorSummary(error), trail: ui.navigationTrail(page) };
  const ref = await adapters.retainInterruptionEvidence({ caseId: 'AHT-01', diag, assertions: [], writeEvidence: recorder.writeEvidence });
  recorder.finish({ caseId: 'AHT-01', contentSafe: true, assertions: [
    { id: 'owner-bound', result: 'FAIL', detail: 'The named assertion failed.', evidenceRefs: [] },
    { id: 'fresh-first-session', result: 'NOT RUN', detail: 'The named assertion was not established.', evidenceRefs: [ref] },
    { id: 'owned-pages-closed', result: 'PASS', detail: 'The named source assertion was observed.', evidenceRefs: [ref] }] });
})().catch((e) => { console.error(String(e && e.message)); process.exit(1); });
"""


class GuardRefusalExportAndPublication(ProjectionCatalog):
    """The closed guard-refused reason must reach the EXPORTED driverInterruption and the PUBLISHED codes, not only
    the raw interruption file. Driven end to end from the real JS recorder output for both refusal shapes, through the same digest-bound
    isolated_case_rows -> diagnostic_codes -> project -> publisher-sanitize path the workflow runs, and run_timing_export. Controls: an
    unreviewed cap and a forged error property never produce a reason; an out-of-vocabulary reason rebound with valid digests is dropped;
    a tampered file without rebinding stays `unknown`; the earlier FAIL remains the first non-passing assertion."""
    RUN_ID = "42496837188"
    BIND = {"runId": RUN_ID, "runAttempt": "1", "headSha": "2" * 40, "workflowStartUtc": "2026-11-08T13:02:28Z"}

    def drive(self, shape, deny="upstream-error"):
        cases = os.path.join(self.d, shape + "-" + deny.replace(":", "_"))
        case_dir = os.path.join(cases, "AHT-01")
        os.makedirs(case_dir)
        case_dir = os.path.realpath(case_dir)
        h = os.path.join(ROOT, "harness")
        r = self.subprocess.run(["node", "-e", GUARD_REFUSAL_DRIVER, os.path.join(h, "draft-adapters", "browser-actions.cjs"),
                                 os.path.join(h, "draft-adapters", "source-adapters.cjs"), os.path.join(h, "bundle", "harness", "case-results.cjs"),
                                 case_dir, shape, deny], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        return cases, case_dir

    def export(self, cases, case_dir):
        with open(os.path.join(case_dir, "case-result.json"), "rb") as f:
            raw = f.read()
        doc = json.loads(raw)
        # the guard's own summary for a driver that caught the refusal and returned normally (stop code `completed`, exit 0)
        summary = (json.dumps({"startedAt": "2026-11-08T13:11:56.988Z", "endedAt": "2026-11-08T13:11:58.127Z", "reason": "completed"}) + "\n").encode()
        with open(os.path.join(case_dir, "summary.json"), "wb") as f:
            f.write(summary)
        receipt = {"caseId": "AHT-01", "runId": self.RUN_ID, "exitCode": 0, "summarySha256": hashlib.sha256(summary).hexdigest(),
                   "caseResultSha256": hashlib.sha256(raw).hexdigest()}
        results = os.path.join(cases, "case-results.json")
        with open(results, "w", encoding="utf-8") as f:
            json.dump({"cases": [{"caseId": "AHT-01", "result": doc["result"], "executionReceipt": receipt, "assertions": doc["assertions"]}]}, f)
        rows, _ = I.isolated_case_rows(cases, results, list(I.ALL_CASES), self.RUN_ID)       # exactly the CLI `project` path
        started = os.path.join(cases, "started.txt")
        with open(started, "w", encoding="utf-8") as f:
            f.write("2026-11-08T13:10:40Z\n")
        timing = I.run_timing_export(cases, results, ["AHT-01"], started, None, self.BIND)
        return rows["AHT-01"], next(c for c in timing["cases"] if c["caseId"] == "AHT-01"), json.dumps(timing)

    def publish(self, codes):
        catalog = I.projection_catalog(self.request_raw, self.request_sha, os.path.join(ROOT, "config", "test-config.v1.json"), self.q)
        rec = I.project(self.run_record, self.RUN_ID, 1, "d" * 40, self.T, self.q, self.request_sha, self.prov, self.case_results, catalog,
                        case_codes={"AHT-01": codes})
        return I.LR.sanitize_record(rec, require_source=True)["cases"][0]["codes"]

    def test_both_refusal_shapes_reach_the_exported_interruption_and_the_published_codes(self):
        for shape in ("resolved", "thrown"):
            with self.subTest(shape):
                row, timed, text = self.export(*self.drive(shape))
                for d in (row["diagnostic"], timed["diagnostic"]):
                    self.assertEqual(d["driverInterruption"]["stage"], "signin-navigate")
                    self.assertEqual(d["driverInterruption"]["stopReason"], "guard-refused-navigation:upstream-error")
                    self.assertEqual(d["driverInterruption"]["error"]["code"], "NOT_RUN")
                    self.assertEqual(d["firstNonPassingAssertion"], {"id": "owner-bound", "result": "FAIL"}, "the earlier FAIL stays first")
                self.assertEqual(row["result"], "FAIL")
                codes = I.diagnostic_codes(row["diagnostic"])
                self.assertEqual(codes, ["stage-signin-navigate", "guard-refused-upstream-error"])
                self.assertEqual(self.publish(codes), codes)
                self.assertNotIn("app.example", text)

    def test_reviewed_caps_publish_and_an_unreviewed_cap_is_other(self):
        for deny, code in (("cap:auth", "guard-refused-cap-auth"), ("cap:signed-in", "guard-refused-cap-signed-in"),
                           ("cap:private-secret", "guard-refused-other")):
            with self.subTest(deny):
                row, _, text = self.export(*self.drive("thrown", deny))
                codes = I.diagnostic_codes(row["diagnostic"])
                self.assertIn(code, codes)
                self.assertEqual(self.publish(codes), codes)
                self.assertNotIn("private-secret", text + json.dumps(codes))

    def test_a_forged_error_property_carries_no_reason_and_no_code(self):
        row, _, _ = self.export(*self.drive("forged"))
        di = row["diagnostic"]["driverInterruption"]
        self.assertNotIn("stopReason", di)
        self.assertFalse([c for c in I.diagnostic_codes(row["diagnostic"]) if c.startswith("guard-refused")])

    def test_an_out_of_vocabulary_reason_rebound_with_valid_digests_is_dropped_and_an_unbound_edit_is_unknown(self):
        cases, case_dir = self.drive("resolved")
        name = os.path.join(case_dir, "aht-01-interruption.json")
        with open(name, encoding="utf-8") as f:
            doc = json.load(f)
        for forged in ("guard-refused-navigation:cap:private-secret", "guard-refused-navigation:upstream-error ", "token=abc", 7):
            with self.subTest(forged):
                raw = json.dumps(dict(doc, stopReason=forged)).encode()
                with open(name, "wb") as f:
                    f.write(raw)
                with open(os.path.join(case_dir, "case-result.json"), encoding="utf-8") as f:
                    result = json.load(f)
                result["evidenceDigests"]["aht-01-interruption.json"] = hashlib.sha256(raw).hexdigest()   # rebound: binding is valid
                with open(os.path.join(case_dir, "case-result.json"), "w", encoding="utf-8") as f:
                    json.dump(result, f)
                row, _, text = self.export(cases, case_dir)
                self.assertEqual(row["diagnostic"]["driverInterruption"]["stage"], "signin-navigate")
                self.assertNotIn("stopReason", row["diagnostic"]["driverInterruption"])
                self.assertFalse([c for c in I.diagnostic_codes(row["diagnostic"]) if c.startswith("guard-refused")])
                self.assertNotIn("private-secret", text)
                self.assertNotIn("token=abc", text)
        with open(name, "wb") as f:                     # edited after the digest was recorded: not bound, so `unknown`, no reason
            f.write(json.dumps(dict(doc, stopReason="guard-refused-navigation:policy")).encode())
        row, _, _ = self.export(cases, case_dir)
        self.assertEqual(row["diagnostic"]["driverInterruption"], {"stage": "unknown", "step": None, "error": None, "trail": []})

    def test_the_python_vocabulary_is_the_drivers_own(self):
        with open(os.path.join(ROOT, "harness", "draft-adapters", "browser-actions.cjs"), encoding="utf-8") as f:
            src = f.read()
        import re
        words = set(re.findall(r"'([a-z-]+)'", re.search(r"GUARD_DENY_WORDS=new Set\(\[([^\]]*)\]", src).group(1)))
        caps = set(re.findall(r"'([a-z-]+)'", re.search(r"GUARD_CAPS=new Set\(\[([^\]]*)\]", src).group(1)))
        self.assertEqual((words, caps), (set(I.GUARD_DENY_WORDS), set(I.GUARD_CAPS)))
        self.assertIn("'guard-refused-navigation:'+guardDenyCode(deny)", src)


if __name__ == "__main__":
    unittest.main()
