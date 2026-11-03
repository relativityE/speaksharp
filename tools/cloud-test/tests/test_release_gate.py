"""Regression tests for the release gate (owner item 3): a verified deployed fix with expected-PASS criteria is PERMITTED; unverified deployment and
unreviewed customer-facing changes are REJECTED; product changes themselves are never the reason."""
import copy
import json
import os
import tempfile
import unittest

from _fixtures import NOW, REPO, ROOT, git_repo, needs_history, prerequisite, request_path, sample, wjson
import verify_release as VR
import workflow_report as WR
from _common import load


def ledger_with(prs):
    """A ledger whose gaps link to the given PR numbers (all with complete expected-PASS criteria)."""
    base = sample()["ledger"]
    gaps = []
    for i, pr in enumerate(prs, 1):
        g = copy.deepcopy(base["gaps"][2])
        g.update({"id": "GAP-%02d" % i, "fix": {"pr": "#%s" % pr, "candidate": False, "note": "t"}})
        gaps.append(g)
    return {"gaps": gaps}


class Fixture:
    """Synthetic history: base = last run's tested SHA; commits since it; sealed identity receipts for the tested SHA."""
    def __init__(self, commits, identity_hours_old=3, identity_for_tested=True):
        self.repo, self.g, commit = git_repo()
        self.base = commit("docs: base", ["docs/a.md"])
        self.shas = {}
        for subject, files in commits:
            self.shas[subject] = commit(subject, files)
        self.tested = self.g("rev-parse", "HEAD")
        self.root = tempfile.mkdtemp(prefix="ct-receipts-")
        os.makedirs(os.path.join(self.root, "R5"))
        import datetime
        t = (datetime.datetime(2026, 10, 28, 22, 0, tzinfo=datetime.timezone.utc) - datetime.timedelta(hours=identity_hours_old)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        recs = [{"result": "MATCH", "servedSha": self.tested if identity_for_tested else self.base, "startedAt": t}]
        wjson(os.path.join(self.root, "R5", "identity-ledger.json"), {"identityGets": 1, "receipts": recs})
        cfg = copy.deepcopy(sample()["cfg"])
        cfg["history"]["runs"] = [{"label": "R5", "servedSha": self.base, "ledgersOnly": False}]
        cfg["history"]["comparisonBaselines"] = ["R5", "R5"]
        self.cfg = cfg

    def verify(self, ledger, backend=None, tested=None, last=None, current_identity=None, features=None):
        req = {"release": {"testedSha": tested or self.tested, "lastRunTestedSha": last or self.base,
                           "backend": backend or {"sha": tested or self.tested, "source": "owner-stated", "verifiedAtUtc": None, "evidenceRef": None}}}
        d = tempfile.mkdtemp()
        rp, lp, cp, op = (os.path.join(d, n) for n in ("req.json", "led.json", "cfg.json", "out.json"))
        wjson(rp, req); wjson(lp, ledger); wjson(cp, self.cfg)
        from _fixtures import run_py
        args = ["--request", rp, "--ledger", lp, "--config", cp, "--repo", self.repo, "--receipts-root", self.root, "--now", NOW, "--out", op]
        if current_identity is not None:
            identity = os.path.join(d, "current-identity.json")
            wjson(identity, current_identity); os.chmod(identity, 0o600)
            args += ["--current-identity-ledger", identity]
        if features is not None:
            feature_path = os.path.join(d, "features.json")
            wjson(feature_path, {"schema": "speaksharp.cloud-test.feature-ledger.v1", "features": features})
            args += ["--features", feature_path]
        r = run_py("scripts/verify_release.py", *args)
        assert r.returncode == 0, r.stderr
        return load(op)


def verdict(out, subject_sha):
    return next(v for v in out["commitVerdicts"] if subject_sha.startswith(v["sha"]))


class ReleaseGate(unittest.TestCase):
    @staticmethod
    def current_identity(f, **receipt_overrides):
        receipt = {"reservation": 1, "phase": "admission", "startedAt": "2026-10-28T21:59:00Z",
                   "endedAt": "2026-10-28T21:59:01Z", "result": "MATCH", "reason": None, "http": 200,
                   "redirects": 0, "markerCount": 1, "servedSha": f.tested, "expectedSha": f.tested,
                   "evidenceScope": "inert-text-marker-only"}
        receipt.update(receipt_overrides)
        target = f.cfg["target"]["url"].rstrip("/") + "/"
        return {"version": 1, "url": target, "expectedSha": f.tested, "cap": 32, "identityGets": 1, "receipts": [receipt]}

    def test_current_occurrence_identity_admits_a_new_release_without_historical_identity(self):
        f = Fixture([("fix(a): retain guidance (#101)", ["frontend/src/a.ts"])], identity_for_tested=False)
        out = f.verify(ledger_with(["101"]), current_identity=self.current_identity(f))
        self.assertEqual((out["frontend"]["source"], out["frontend"]["servedSha"], out["frontend"]["reads"]),
                         ("current-runtime-identity", f.tested, 1))
        self.assertEqual(out["needs"], [])
        self.assertEqual(out["commitVerdicts"][0]["decision"], "allowed")

    def test_current_identity_refuses_wrong_release_phase_staleness_or_replay(self):
        f = Fixture([("fix(a): retain guidance (#101)", ["frontend/src/a.ts"])], identity_for_tested=False)
        cases = {
            "wrong served": self.current_identity(f, servedSha="0" * 40),
            "wrong expected": self.current_identity(f, expectedSha="0" * 40),
            "wrong phase": self.current_identity(f, phase="before-AHT-01"),
            "stale": self.current_identity(f, startedAt="2026-10-26T00:00:00Z", endedAt="2026-10-26T00:00:01Z"),
            "future": self.current_identity(f, startedAt="2026-10-29T00:00:00Z", endedAt="2026-10-29T00:00:01Z"),
        }
        replay = self.current_identity(f); replay["identityGets"] = 2; replay["receipts"].append(dict(replay["receipts"][0], reservation=2))
        cases["replay"] = replay
        for label, identity in cases.items():
            with self.subTest(label):
                out = f.verify(ledger_with(["101"]), current_identity=identity)
                self.assertTrue(any("frontend" in need for need in out["needs"]), out)
                self.assertEqual(out["commitVerdicts"][0]["decision"], "rejected")

    def test_current_r5_objective_witness_feature_allows_only_its_reviewed_product_commit(self):
        f = Fixture([("feat(r5): bind objective publication witness (#1772)", ["frontend/src/services/SpeechRuntimeController.ts"]),
                     ("fix(other): unrelated product change (#9999)", ["frontend/src/other.ts"])
                    ], identity_for_tested=False)
        feature = {"id": "FEAT-R5-OBJECTIVE-PUBLICATION", "title": "Content-free Focus objective publication witness", "area": "PG01", "pr": "#1772", "commit": None,
                   "review": {"outcome": "approved", "reviewedBy": "independent-reviewer", "reviewRef": "review-ref", "reviewedAtUtc": "2026-10-28T20:00:00Z"},
                   "expectedBehaviour": {"summary": "bind owned terminal Focus status", "criteria": "only ordered content-free status evidence is exposed when enabled", "definedAtUtc": "2026-10-28T19:00:00Z"},
                   "coverage": {"requirements": [{"case": "AHT-02", "assertions": ["owner-bound", "focus-final", "focus-coverage-count"]}, {"case": "AHT-03", "assertions": ["owner-bound", "focus-final", "focus-coverage-count"]}], "newRows": []}}
        out = f.verify(ledger_with([]), current_identity=self.current_identity(f), features=[feature])
        decisions = {v["pr"]: v["decision"] for v in out["commitVerdicts"]}
        self.assertEqual(decisions["1772"], "allowed")
        self.assertEqual(decisions["9999"], "rejected")
        self.assertNotEqual(f.base, f.tested)
        self.assertIn("unreviewed", next(v["reason"] for v in out["commitVerdicts"] if v["pr"] == "9999"))

    def test_verified_deployed_fix_is_permitted(self):
        f = Fixture([("fix(a): retain guidance (#101)", ["frontend/src/a.ts", "frontend/src/__tests__/a.test.ts"])])
        out = f.verify(ledger_with(["101"]))
        v = out["commitVerdicts"][0]
        self.assertTrue(v["customerFacing"])
        self.assertEqual(v["decision"], "allowed", v)
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "cloud-verified")
        self.assertEqual(out["needs"], [])
        self.assertEqual(out["g2"]["status"], "READY")

    def test_product_changes_are_not_rejected_for_being_product_changes(self):
        f = Fixture([("fix(a): one (#101)", ["frontend/src/a.ts"]), ("fix(b): two (#102)", ["frontend/src/b.ts"])])
        out = f.verify(ledger_with(["101", "102"]))
        self.assertTrue(all(v["customerFacing"] and v["decision"] == "allowed" for v in out["commitVerdicts"]))
        self.assertEqual(out["g2"]["status"], "READY")

    def test_unlinked_customer_facing_change_is_rejected_as_unreviewed(self):
        f = Fixture([("feat(c): something (#103)", ["frontend/src/c.ts"])])
        out = f.verify(ledger_with(["101"]))
        v = out["commitVerdicts"][0]
        self.assertEqual(v["decision"], "rejected")
        self.assertIn("unreviewed", v["reason"])
        self.assertEqual(out["g2"]["status"], "NOT-READY")

    def test_linked_fix_with_unverified_frontend_deployment_is_rejected(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])], identity_for_tested=False)
        out = f.verify(ledger_with(["101"]))
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")
        self.assertEqual(out["commitVerdicts"][0]["decision"], "rejected")
        self.assertTrue(any("frontend" in n for n in out["needs"]))

    def test_stale_identity_is_rejected(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])], identity_hours_old=60)
        out = f.verify(ledger_with(["101"]))
        self.assertTrue(any("hours old" in n for n in out["needs"]), out["needs"])
        self.assertEqual(out["g2"]["status"], "NOT-READY")

    def test_backend_fix_needs_backend_verification(self):
        f = Fixture([("fix(be): edge fn (#104)", ["backend/supabase/functions/x/index.ts"])])
        out = f.verify(ledger_with(["104"]))
        self.assertEqual(out["fixes"]["GAP-01"]["touchesBackend"], True)
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")
        self.assertEqual(out["commitVerdicts"][0]["decision"], "rejected")
        ok = out = f.verify(ledger_with(["104"]), backend={"sha": f.tested, "source": "cloud-verified", "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "run-url"})
        self.assertEqual(ok["fixes"]["GAP-01"]["inclusion"], "cloud-verified")
        self.assertEqual(ok["commitVerdicts"][0]["decision"], "allowed")

    def test_backend_verification_for_another_sha_does_not_count(self):
        f = Fixture([("fix(be): edge fn (#104)", ["backend/supabase/migrations/1_x.sql"])])
        out = f.verify(ledger_with(["104"]), backend={"sha": "0" * 40, "source": "cloud-verified", "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "r"})
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")

    def test_source_equivalent_edge_deployment_is_proven_from_git_trees(self):
        f = Fixture([("fix(be): edge fn (#104)", ["backend/supabase/functions/x/index.ts"]),
                     ("docs: later evidence", ["docs/evidence.md"])])
        deployed = f.shas["fix(be): edge fn (#104)"]
        self.assertNotEqual(deployed, f.tested)
        tree = f.g("rev-parse", f.tested + ":backend/supabase/functions")
        backend = {"sha": deployed, "source": "cloud-verified-source-equivalent",
                   "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "run-url",
                   "sourceEquivalentToSha": f.tested, "functionsTreeSha": tree}
        out = f.verify(ledger_with(["104"]), backend=backend)
        self.assertTrue(out["backend"]["verified"])
        self.assertEqual(out["backend"]["mode"], "source-equivalent")
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "cloud-verified")
        rendered = WR.backend_deployment_text(out["backend"])
        self.assertIn("source-equivalent deployment", rendered)
        self.assertNotIn("cloud-verified exact deployment", rendered)
        for value in (deployed, f.tested, tree, backend["verifiedAtUtc"], backend["evidenceRef"]):
            self.assertIn(value, rendered)

    def test_source_equivalent_backend_refuses_wrong_target_tree_or_missing_evidence(self):
        f = Fixture([("fix(be): edge fn (#104)", ["backend/supabase/functions/x/index.ts"])])
        tree = f.g("rev-parse", f.tested + ":backend/supabase/functions")
        valid = {"sha": f.tested, "source": "cloud-verified-source-equivalent",
                 "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "run-url",
                 "sourceEquivalentToSha": f.tested, "functionsTreeSha": tree}
        invalid = {
            "wrong target": dict(valid, sourceEquivalentToSha=f.base),
            "wrong tree": dict(valid, functionsTreeSha="0" * 40),
            "missing evidence": dict(valid, evidenceRef=None),
            "missing time": dict(valid, verifiedAtUtc=None),
        }
        for label, backend in invalid.items():
            with self.subTest(label):
                out = f.verify(ledger_with(["104"]), backend=backend)
                self.assertFalse(out["backend"]["verified"])
                self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")

    def test_source_equivalent_functions_proof_never_covers_migrations(self):
        f = Fixture([("fix(be): function baseline (#103)", ["backend/supabase/functions/x/index.ts"]),
                     ("fix(be): migration (#104)", ["backend/supabase/migrations/1_x.sql"])])
        tree = f.g("rev-parse", f.tested + ":backend/supabase/functions")
        backend = {"sha": f.tested, "source": "cloud-verified-source-equivalent",
                   "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "run-url",
                   "sourceEquivalentToSha": f.tested, "functionsTreeSha": tree}
        out = f.verify(ledger_with(["104"]), backend=backend)
        self.assertTrue(out["backend"]["verified"])
        self.assertEqual(out["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")

    def test_source_equivalent_backend_refuses_actual_function_tree_drift(self):
        f = Fixture([("fix(be): first (#103)", ["backend/supabase/functions/x/index.ts"])])
        deployed = f.tested
        commit = f.g
        with open(os.path.join(f.repo, "backend/supabase/functions/x/index.ts"), "a", encoding="utf-8") as h:
            h.write("drift\n")
        commit("add", ".")
        commit("commit", "-q", "-m", "fix(be): changed after deploy (#104)")
        f.tested = commit("rev-parse", "HEAD")
        deployed_tree = commit("rev-parse", deployed + ":backend/supabase/functions")
        backend = {"sha": deployed, "source": "cloud-verified-source-equivalent",
                   "verifiedAtUtc": "2026-10-28T21:00:00Z", "evidenceRef": "run-url",
                   "sourceEquivalentToSha": f.tested, "functionsTreeSha": deployed_tree}
        out = f.verify(ledger_with(["104"]), backend=backend)
        self.assertFalse(out["backend"]["verified"])

    def test_gap_without_expected_pass_rejects_its_fix(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])])
        l = ledger_with(["101"]); l["gaps"][0]["expectedPass"]["criteria"] = ""
        out = f.verify(l)
        self.assertEqual(out["commitVerdicts"][0]["decision"], "rejected")
        self.assertIn("expected-PASS", out["commitVerdicts"][0]["reason"])

    def test_non_product_commits_are_allowed(self):
        f = Fixture([("test: more (#201)", ["frontend/src/__tests__/a.test.ts", "tests/x.spec.ts"]), ("docs: y (#202)", ["frontend/README.md", "product_release/a.md"]), ("ci: z (#203)", [".github/workflows/x.yml", "scripts/s.sh"])])
        out = f.verify(ledger_with([]))
        self.assertTrue(all(not v["customerFacing"] and v["decision"] == "allowed" for v in out["commitVerdicts"]), out["commitVerdicts"])
        self.assertEqual(out["g2"]["status"], "READY")

    def test_every_commit_is_found_by_git_not_declared(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"]), ("fix(b): y (#102)", ["frontend/src/b.ts"])])
        out = f.verify(ledger_with(["101"]))
        self.assertEqual(len(out["sinceLastRun"]), 2)
        self.assertEqual([v["decision"] for v in out["commitVerdicts"]], ["allowed", "rejected"])

    def test_fix_commit_not_in_the_tested_release_is_not_included(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])])
        f.g("checkout", "-q", "-b", "side", f.base)
        import _fixtures
        side = f.g("commit", "--allow-empty", "-q", "-m", "fix(s): side (#105)") or f.g("rev-parse", "HEAD")
        f.g("checkout", "-q", "main")
        out = f.verify(ledger_with(["101"]), tested=f.tested)
        self.assertEqual(out["fixes"]["GAP-01"]["ancestorOfTested"], True)
        # a gap whose commit is on the side branch resolves by subject only within the tested history, so it is unresolved
        l = ledger_with(["105"])
        out2 = f.verify(l)
        self.assertEqual(out2["fixes"]["GAP-01"]["inclusion"], "unresolved")

    def test_missing_history_is_reported_not_guessed(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])])
        out = f.verify(ledger_with(["101"]), tested="1" * 40)
        self.assertFalse(out["git"]["available"])
        self.assertIsNone(out["sinceLastRun"])
        self.assertEqual(out["g2"]["status"], "NOT-READY")

    def test_candidate_fix_is_flagged_and_never_a_verified_fix(self):
        f = Fixture([("fix(a): x (#101)", ["frontend/src/a.ts"])])
        l = ledger_with(["101"]); l["gaps"][0]["fix"]["candidate"] = True
        out = f.verify(l)
        self.assertTrue(out["fixes"]["GAP-01"]["candidate"])

    # ---- path classification
    def test_path_classification(self):
        cfg = sample()["cfg"]["release"]
        cases = {"frontend/src/a.ts": True, "frontend/src/__tests__/a.test.tsx": False, "frontend/src/a.test.ts": False, "frontend/README.md": False,
                 "frontend/public/x.png": True, "backend/supabase/migrations/1.sql": True, "backend/supabase/functions/x/index.ts": True, "backend/supabase/functions/x/index.test.ts": False,
                 "backend/supabase/functions/x/contract.json": True, "vercel.json": True, "middleware.js": True, ".github/workflows/x.yml": False, "tests/live/a.spec.ts": False,
                 "product_release/RELEASE_STATUS.md": False, "scripts/x.mjs": False}
        for path, expected in cases.items():
            prod, _b, _f = VR.classify([path], cfg["productPathPatterns"], cfg["testPathPatterns"])
            self.assertEqual(bool(prod), expected, path)


class RealRepository(unittest.TestCase):
    """The real tested release: #1744 (blocked-microphone guidance) is a verified deployed fix; the 502 fix touches the backend and stays unverified."""
    def test_1744_is_in_the_tested_release_and_verified(self):
        # On the synthetic history (R5 served the tested release 4c85b006 and its identity reads are fresh at NOW); the retained-history
        # version of this check is kept in tests/legacy_audit/audit_release_gate.py.
        prerequisite(os.system("git -C %s cat-file -e 4c85b006ac05e180521fd6e7d807f736987cafe8 2>/dev/null" % REPO) == 0, "git history of the repository")
        from _fixtures import run_py
        from _synthetic_history import shared as synthetic_history
        h = synthetic_history()
        d = tempfile.mkdtemp(); out = os.path.join(d, "rv.json")
        r = run_py("scripts/verify_release.py", "--request", request_path(), "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--repo", REPO, "--now", NOW,
                   "--config", h.config, "--receipts-root", h.receipts, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        rv = load(out)
        self.assertEqual(rv["fixes"]["GAP-03"]["inclusion"], "cloud-verified")
        self.assertEqual(rv["fixes"]["GAP-03"]["commit"][:7], "8b2e7de")
        self.assertEqual(rv["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")
        self.assertEqual(rv["fixes"]["GAP-01"]["touchesBackend"], True)
        self.assertEqual(rv["sinceLastRun"], [])


if __name__ == "__main__":
    unittest.main()
