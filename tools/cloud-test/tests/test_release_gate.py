"""Regression tests for the release gate (owner item 3): a verified deployed fix with expected-PASS criteria is PERMITTED; unverified deployment and
unreviewed customer-facing changes are REJECTED; product changes themselves are never the reason."""
import copy
import json
import os
import tempfile
import unittest

from _fixtures import NOW, REPO, ROOT, git_repo, needs_history, prerequisite, request_path, sample, wjson
import verify_release as VR
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

    def verify(self, ledger, backend=None, tested=None, last=None):
        req = {"release": {"testedSha": tested or self.tested, "lastRunTestedSha": last or self.base,
                           "backend": backend or {"sha": tested or self.tested, "source": "owner-stated", "verifiedAtUtc": None, "evidenceRef": None}}}
        d = tempfile.mkdtemp()
        rp, lp, cp, op = (os.path.join(d, n) for n in ("req.json", "led.json", "cfg.json", "out.json"))
        wjson(rp, req); wjson(lp, ledger); wjson(cp, self.cfg)
        from _fixtures import run_py
        r = run_py("scripts/verify_release.py", "--request", rp, "--ledger", lp, "--config", cp, "--repo", self.repo, "--receipts-root", self.root, "--now", NOW, "--out", op)
        assert r.returncode == 0, r.stderr
        return load(op)


def verdict(out, subject_sha):
    return next(v for v in out["commitVerdicts"] if subject_sha.startswith(v["sha"]))


class ReleaseGate(unittest.TestCase):
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
    @needs_history  # verify_release.py reads the config's history runs and their sealed receipts
    def test_1744_is_in_the_tested_release_and_verified(self):
        prerequisite(os.system("git -C %s cat-file -e 4c85b006ac05e180521fd6e7d807f736987cafe8 2>/dev/null" % REPO) == 0, "git history of the repository")
        from _fixtures import run_py
        d = tempfile.mkdtemp(); out = os.path.join(d, "rv.json")
        r = run_py("scripts/verify_release.py", "--request", request_path(), "--ledger", os.path.join(ROOT, "config/gap-ledger.json"), "--repo", REPO, "--now", NOW, "--out", out)
        self.assertEqual(r.returncode, 0, r.stderr)
        rv = load(out)
        self.assertEqual(rv["fixes"]["GAP-03"]["inclusion"], "cloud-verified")
        self.assertEqual(rv["fixes"]["GAP-03"]["commit"][:7], "8b2e7de")
        self.assertEqual(rv["fixes"]["GAP-01"]["inclusion"], "unverified-deployment")
        self.assertEqual(rv["fixes"]["GAP-01"]["touchesBackend"], True)
        self.assertEqual(rv["sinceLastRun"], [])


if __name__ == "__main__":
    unittest.main()
