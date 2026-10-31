"""The actual full 15-journey plan (workflow 1.4.0): the pinned pdfjs-dist is provided without a network install, the plan builder produces the COMPLETE plan for
all 15 journeys from the full-coverage request, the stimulus preflight is ready for every capture case on the pinned browser, and the REAL vendored runner's own
start-up validation accepts the plan, including its request budget, limits, caps and assertion denominators. Negative controls show that a partial plan, a missing
stimulus receipt, an under-funded budget or a wrong parser are refused. Offline: no product traffic, no credentials."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import hashlib

from _fixtures import REPO, ROOT, TESTED, J, prerequisite, wjson
from test_runnable_package import chrome_path, node_ok, playwright_cwd
import install_pdfjs

PIN = J("config", "test-config.v1.json")["tools"]["pdfjs"]
CATALOG = J("config", "assertion-catalog.json")
RUNNER_PDF = os.path.join(ROOT, "runner", "node_modules", "pdfjs-dist")
RECEIVING_SOURCE = J("harness", "draft-adapters", "SOURCE.sha256.json")["sourceSha"]


def selected_pdf_source():
    """Pin-verify explicit existing CI bytes; never install, copy or fall back."""
    explicit = os.environ.get("CT_EXISTING_PDFJS_DIR")
    source = explicit if explicit is not None else RUNNER_PDF
    if explicit is not None:
        if not os.path.isabs(source):
            raise AssertionError("CT_EXISTING_PDFJS_DIR must be an absolute existing package path")
        errors = install_pdfjs.verify_dir(source, PIN)
        if errors:
            raise AssertionError("explicit existing PDF source does not match pins: " + "; ".join(errors))
    else:
        prerequisite(os.path.isdir(source), "existing pin-verified PDF source (CT_EXISTING_PDFJS_DIR)")
        errors = install_pdfjs.verify_dir(source, PIN)
        if errors:
            raise AssertionError("existing PDF source does not match pins: " + "; ".join(errors))
    return source


def run_py(script, *args, env=None):
    return subprocess.run([sys.executable, "-I", os.path.join(ROOT, script)] + list(args), capture_output=True, text=True, env=env)


class PinnedPdfParser(unittest.TestCase):
    def setUp(self):
        # Copy-specific legacy controls operate on inert fixture bytes, never on
        # the real installed library used by the existing-only CI route.
        self.temporary = tempfile.TemporaryDirectory(prefix="ct-pdf-inert-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.runner = self.root / "runner"
        self.pdf = self.runner / "node_modules/pdfjs-dist"
        (self.pdf / "legacy/build").mkdir(parents=True)
        (self.pdf / "package.json").write_text('{"version":"4.10.38","synthetic":true}')
        (self.pdf / "legacy/build/pdf.mjs").write_text("// inert test fixture\n")
        self.pin = dict(PIN)
        self.pin["packageJsonSha256"] = hashlib.sha256((self.pdf / "package.json").read_bytes()).hexdigest()
        self.pin["pdfMjsSha256"] = hashlib.sha256((self.pdf / "legacy/build/pdf.mjs").read_bytes()).hexdigest()
        cfg = J("config", "test-config.v1.json")
        cfg["tools"]["pdfjs"] = self.pin
        self.config = self.root / "synthetic-config.json"
        wjson(str(self.config), cfg)

    def call(self, *args):
        return run_py("scripts/install_pdfjs.py", "--config", str(self.config), "--runner-dir", str(self.runner), *args)

    def test_the_pins_are_the_repositorys_own_parser_bytes(self):
        self.assertEqual(PIN["version"], "4.10.38")
        lock = open(os.path.join(REPO, "pnpm-lock.yaml"), encoding="utf-8").read() if os.path.isfile(os.path.join(REPO, "pnpm-lock.yaml")) else ""
        if lock:
            self.assertIn("pdfjs-dist@4.10.38:\n    resolution: {integrity: %s}" % PIN["integrity"], lock)

    def test_it_is_provided_to_a_checkout_that_lacks_it(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.call("--checkout", d)
            self.assertEqual((r.returncode, r.stdout.strip()), (0, self.pin["pdfMjsSha256"]), r.stderr)
            self.assertEqual(self.call("--checkout", d, "--check-only").returncode, 0)

    def test_check_only_refuses_a_checkout_without_it(self):
        with tempfile.TemporaryDirectory() as d:
            r = self.call("--checkout", d, "--check-only")
            self.assertEqual(r.returncode, 78)

    def test_a_different_parser_in_the_checkout_is_refused_and_not_overwritten(self):
        with tempfile.TemporaryDirectory() as d:
            self.call("--checkout", d)
            pm = os.path.join(d, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")
            open(pm, "a").write("\n//tampered\n")
            r = self.call("--checkout", d)
            self.assertEqual(r.returncode, 78)
            self.assertIn("not overwritten", r.stderr)
            self.assertIn("tampered", open(pm).read())

    def test_a_tampered_runner_copy_is_refused(self):
        with tempfile.TemporaryDirectory() as d:
            rd = os.path.join(d, "runner"); shutil.copytree(str(self.pdf), os.path.join(rd, "node_modules", "pdfjs-dist"))
            open(os.path.join(rd, "node_modules", "pdfjs-dist", "package.json"), "a").write(" ")
            r = self.call("--checkout", os.path.join(d, "ck"), "--runner-dir", rd)
            self.assertEqual(r.returncode, 78)
            self.assertFalse(os.path.exists(os.path.join(d, "ck", "node_modules")))

    def test_the_stage_runner_installs_it(self):
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn("install_pdfjs.py", sh)
        self.assertIn("gate-and-validate", sh)
        self.assertIn("modes.full.assertionCatalog.file", sh)
        self.assertEqual(J("config", "test-config.v1.json")["modes"]["full"]["assertionCatalog"]["file"], "config/assertion-catalog.json")


class FullPlanProof(unittest.TestCase):
    """Builds the complete full-coverage plan from the R7 request (placeholder owner inputs, clearly NOT A RUN) and has the real runner validate it."""
    @classmethod
    def setUpClass(cls):
        prerequisite(node_ok(), "node")
        prerequisite(subprocess.run(["git", "-C", REPO, "cat-file", "-e", RECEIVING_SOURCE + "^{commit}"], capture_output=True).returncode == 0, "git history with the actual receiving-source SHA")
        prerequisite(os.path.isfile(os.path.join(REPO, "tests", "fixtures", "rwt", "open_mic_tts.wav")), "the reviewed speech fixtures in the checkout")
        cls.pdf_source = selected_pdf_source()
        cls.chrome = chrome_path()
        prerequisite(cls.chrome, "the pinned browser installed and hash-verified (CT_CHROME)")
        cls.cwd = playwright_cwd()
        prerequisite(cls.cwd, "playwright installed from the lockfile")
        cls.work = tempfile.mkdtemp(prefix="ct-fullplan-")
        cls.browser_identity = os.path.join(cls.work, "browser-identity.json")
        wjson(cls.browser_identity, {"schema": "speaksharp.cloud-test.existing-browser.v1", "path": os.path.realpath(cls.chrome),
                                    "observedBinarySha256": hashlib.sha256(Path(cls.chrome).read_bytes()).hexdigest()})
        req = J("config", "runs", "R7-full-coverage-proposal.json")
        req["release"]["testedSha"] = RECEIVING_SOURCE
        req["approvedLimits"] = {"cumulativeCeilingRequests": 10535, "identityCap": 126, "startsCap": 85, "takesCap": 55, "runCapRequests": req["estimate"]["requests"]["runCap"], "approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER"}
        req["window"] = {"startUtc": "2026-01-01T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z", "approvalRef": "PLACEHOLDER-NOT-A-RUN"}
        req["selectionApprovalRef"] = "PLACEHOLDER-NOT-A-RUN-selection"
        cls.req = req
        cls.reqp = os.path.join(cls.work, "req.json"); wjson(cls.reqp, req)
        cls.acct = os.path.join(cls.work, "acct.txt"); open(cls.acct, "w").write("00000000-0000-4000-8000-000000000001\n"); os.chmod(cls.acct, 0o600)
        r = run_py("scripts/run_env.py", "--request", cls.reqp, "--out", os.path.join(cls.work, "env.txt"))
        assert r.returncode == 0, r.stdout + r.stderr
        cls.p0, out = cls.build("plan0")
        assert [o.returncode for o in out] == [0, 0], [o.stderr for o in out]
        cls.receipt = os.path.join(cls.work, "receipt.json")
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "stimulus_preflight_retry.py"), "--harness", os.path.join(ROOT, "harness"), "--plan", os.path.join(cls.p0, "cfg", "campaign-plan.json"),
                            "--chrome", cls.chrome, "--browser-receipt", cls.browser_identity, "--cwd", cls.cwd, "--out", cls.receipt], capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": cls.work})
        assert r.returncode == 0, r.stdout + r.stderr
        cls.plan_dir, out = cls.build("plan", extra={"BP_STIM": cls.receipt})
        assert [o.returncode for o in out] == [0, 0], [o.stderr for o in out]
        cls.plan = json.load(open(os.path.join(cls.plan_dir, "cfg", "campaign-plan.json")))

    @classmethod
    def build(cls, name, extra=None, drop=()):
        private = os.path.join(cls.work, name)
        script = "set -euo pipefail; set -a; . %s; set +a; " % os.path.join(cls.work, "env.txt")
        import shlex
        # overrides are exported AFTER the request-derived environment is sourced, otherwise the request's own values would win
        script += "".join("export %s=%s; " % (k, shlex.quote(v)) for k, v in (extra or {}).items())
        env = {"PATH": os.environ["PATH"], "HOME": cls.work, "BP_PACKET": os.path.join(ROOT, "harness"), "BP_CHECKOUT": REPO, "BP_PRIVATE": private,
               "BP_FACTS": os.path.join(ROOT, "tests", "fixtures", "plan-facts.PLACEHOLDER.json"), "BP_ACCOUNT_ID_FILE": cls.acct, "BP_LEASE_RPCS": "1", "BP_LEASE_READ": "1",
               "BP_TASK_ID": "PLACEHOLDER-task", "BP_SOURCE_REFERENCE": "https://claude.ai/code/PLACEHOLDER", "BP_ENV_ID": "env_PLACEHOLDER", "BP_MEDIA_PARENT": os.path.join(cls.work, "media"),
               "BP_BROWSER_IDENTITY": cls.browser_identity,
               "VITE_SUPABASE_ANON_KEY": "placeholder-publishable-key", "BP_PDFJS_DIR": cls.pdf_source}
        for k in drop:
            env.pop(k, None)
        out = []
        for phase in ("phase1", "phase2"):
            r = subprocess.run(["bash", "-c", script + "python3 -I %s %s" % (os.path.join(ROOT, "harness-adapter", "build_plan.py"), phase)], capture_output=True, text=True, env=env)
            out.append(r)
            if r.returncode:
                break
        return private, out

    def accept(self, plan_file, catalog=True):
        args = ["node", os.path.join(ROOT, "tests", "node", "plan-acceptance.cjs"), os.path.join(ROOT, "harness"), plan_file] + ([os.path.join(ROOT, "config", "assertion-catalog.json")] if catalog else [])
        r = subprocess.run(args, capture_output=True, text=True, cwd=REPO, env={"PATH": os.environ["PATH"], "HOME": self.work})
        return r, json.loads(r.stdout or "{}")

    def case_cfg(self, n):
        return json.load(open(os.path.join(self.plan_dir, "cases", "AHT-%02d.json" % n)))

    # ---- the real runner's own validation
    def test_the_real_runner_accepts_the_complete_plan(self):
        r, out = self.accept(os.path.join(self.plan_dir, "cfg", "campaign-plan.json"))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(set(out.values()), {"ACCEPTED"})
        self.assertEqual(set(out), {"campaign plan structure", "request budget binding", "run identity", "stimulus preflight receipt", "every selected case preflight", "assertion catalog and failure caps"})

    # ---- what the plan contains
    def test_the_plan_selects_all_fifteen_journeys_in_order_with_their_drivers(self):
        p = self.plan
        self.assertEqual(p["selection"]["ids"], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertEqual([c["id"] for c in p["cases"]], ["AHT-%02d" % n for n in range(1, 16)])
        self.assertTrue(all(c["driverSha256"] and c["configSha256"] and c["maxMs"] > 0 for c in p["cases"]))
        self.assertEqual(p["sourceSha"], RECEIVING_SOURCE)

    def test_assertions_are_the_catalogs_204_and_no_case_is_a_minimal_sample(self):
        total = 0
        for n in range(1, 16):
            cid = "AHT-%02d" % n
            cfg = self.case_cfg(n)
            self.assertEqual(sorted(cfg["requiredAssertions"]), sorted(CATALOG["cases"][cid]["requiredAssertions"]), cid)
            self.assertNotIn("sampleMode", cfg, cid)
            total += len(cfg["requiredAssertions"])
        self.assertEqual(total, 204)

    def test_stimuli_every_capture_case_is_bound_to_a_speech_fixture_and_a_ready_receipt(self):
        rec = json.load(open(self.receipt))
        self.assertEqual(rec["productTraffic"], 0)
        capture = [c for c in self.plan["cases"] if c.get("mediaFile")]
        self.assertEqual(len(capture), 13)
        self.assertEqual(sorted(c["id"] for c in self.plan["cases"] if not c.get("mediaFile")), ["AHT-08", "AHT-15"])
        for c in capture:
            self.assertRegex(c["mediaSha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(rec["cases"][c["id"]]["ready"], c["id"])
            self.assertEqual(self.case_cfg(int(c["id"][-2:]))["fixture"]["sha256"], c["mediaSha256"])
        self.assertEqual(self.plan["stimulusPreflight"]["sha256"], __import__("hashlib").sha256(open(self.receipt, "rb").read()).hexdigest())
        self.assertEqual((rec["cases"]["AHT-12"]["ungrantedOutcome"], rec["cases"]["AHT-12"]["noDeviceOutcome"]), ("not-allowed", "not-found"))

    def test_limits_the_budget_policy_identity_and_time(self):
        p = self.plan
        b = p["requestBudget"]
        req = self.req
        self.assertEqual(b["runCap"], req["estimate"]["requests"]["runCap"])
        self.assertEqual(b["cleanupReserve"], req["estimate"]["requests"]["cleanupReserve"])
        for s in req["selection"]:
            self.assertEqual(b["estimates"][s["case"]], s["plannedRequests"])
            self.assertEqual(b["ceilings"][s["case"]], ((s["plannedRequests"] * 125 + 99) // 100 + 9) // 10 * 10)
        self.assertEqual(sum(b["estimates"].values()) + b["cleanupReserve"] + req["estimate"]["requests"]["pooledSlack"], b["runCap"])
        pol = json.load(open(os.path.join(self.plan_dir, "cfg", "policy.json")))
        self.assertEqual((pol["caps"]["total"], pol["caps"]["coaching"], pol["caps"]["account-closure"]), (b["runCap"], req["estimate"]["providerBillableRequests"]["coachingCap"], 0))
        self.assertEqual(p["identityCap"], 32)
        self.assertEqual(p["costCeilingUsd"], 0)
        self.assertGreaterEqual(p["cleanupReserveMs"], 120000)
        self.assertTrue(p["deadlineAt"])

    def test_failure_controls_take_and_start_caps_faults_and_gates(self):
        for n in range(1, 16):
            cid = "AHT-%02d" % n
            cfg = self.case_cfg(n)
            self.assertEqual(cfg["takeCap"], CATALOG["cases"][cid]["minimumTakes"], cid)
            self.assertEqual(cfg["startPressCap"], CATALOG["cases"][cid]["minimumStarts"], cid)
        self.assertEqual(self.case_cfg(13)["downloadFault"]["mode"], "download-fails")
        self.assertEqual(self.case_cfg(14)["downloadFault"]["mode"], "offline-mid-download")
        self.assertTrue(self.case_cfg(12)["permissionQualification"]["denialThenGrantSameContext"])
        pol = json.load(open(os.path.join(self.plan_dir, "cfg", "policy.json")))
        for h in pol["hosts"].values():
            ids = {r["id"] for r in h["rules"]}
            self.assertNotIn("fn-account-closure", ids)
            for r in h["rules"]:
                if r["id"] == "rest-write":
                    self.assertNotIn("DELETE", r["methods"])
                if r["id"] == "auth-user":
                    self.assertEqual(r["methods"], ["GET"])

    def test_the_pdf_parser_binding_is_the_pinned_one(self):
        cfg = self.case_cfg(1)
        self.assertEqual(cfg["pdfParser"], {"package": "pdfjs-dist", "version": "4.10.38", "sha256": PIN["pdfMjsSha256"]})

    def test_no_session_specific_value_or_credential_is_in_the_plan(self):
        blob = ""
        for r, _, fs in os.walk(os.path.join(self.plan_dir, "cfg")):
            for f in fs:
                blob += open(os.path.join(r, f), encoding="utf-8", errors="ignore").read()
        # credential NAMES legitimately appear (the policy lists forbidden ones); credential VALUES (JWTs, provider keys) never do
        for forbidden in ("sk_live", "sk_test", "eyJ"):
            self.assertNotIn(forbidden, blob)
        self.assertIn("PLACEHOLDER-NOT-A-RUN", blob)

    # ---- negative controls
    def mutated(self, fn):
        d = tempfile.mkdtemp(dir=self.work)
        shutil.copytree(os.path.join(self.plan_dir, "cfg"), os.path.join(d, "cfg"))
        pf = os.path.join(d, "cfg", "campaign-plan.json")
        p = json.load(open(pf)); fn(p); wjson(pf, p)
        return pf

    def test_a_plan_without_the_stimulus_receipt_is_refused(self):
        r, out = self.accept(os.path.join(self.p0, "cfg", "campaign-plan.json"))
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(out["stimulus preflight receipt"].startswith("REFUSED"))

    def test_an_underfunded_budget_is_refused(self):
        def f(p): p["requestBudget"]["runCap"] = sum(p["requestBudget"]["estimates"].values())
        r, out = self.accept(self.mutated(f))
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(out["campaign plan structure"].startswith("REFUSED") or out["request budget binding"].startswith("REFUSED"), out)

    def test_a_budget_that_differs_from_the_guard_cap_is_refused(self):
        def f(p): p["requestBudget"]["runCap"] += 10
        r, out = self.accept(self.mutated(f))
        self.assertTrue(out["request budget binding"].startswith("REFUSED"), out)

    def test_an_identity_cap_below_the_requirement_is_refused(self):
        def f(p): p["identityCap"] = 31
        r, out = self.accept(self.mutated(f))
        self.assertTrue(out["campaign plan structure"].startswith("REFUSED"), out)

    def test_a_plan_that_drops_a_journey_is_refused(self):
        def f(p): p["selection"]["ids"] = p["selection"]["ids"][:-1]; p["selection"]["order"] = p["selection"]["order"][:-1]
        r, out = self.accept(self.mutated(f))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("REFUSED", out["assertion catalog and failure caps"] + out["campaign plan structure"])

    def test_a_partial_plan_is_not_accepted_as_the_full_plan(self):
        private, built = self.build("plan-minimal", extra={"BP_MODE": "minimal", "BP_STIM": self.receipt})
        self.assertEqual([b.returncode for b in built], [0, 0], [b.stderr for b in built])
        r, out = self.accept(os.path.join(private, "cfg", "campaign-plan.json"))
        self.assertNotEqual(r.returncode, 0)
        self.assertTrue(out["assertion catalog and failure caps"].startswith("REFUSED"), out)
        self.assertIn("sampleMode", out["assertion catalog and failure caps"])

    def test_the_builder_refuses_a_parser_that_is_not_the_pinned_one(self):
        _, built = self.build("plan-badpdf", extra={"BP_PDFJS_SHA": "0" * 64})
        self.assertEqual(built[0].returncode, 78)
        self.assertIn("differs from the pinned sha256", built[0].stderr)

    def test_the_builder_refuses_a_full_plan_with_a_missing_estimate(self):
        env = open(os.path.join(self.work, "env.txt")).read().splitlines()
        est = next(l for l in env if l.startswith("BP_EST="))
        short = ",".join(est.split("=", 1)[1].strip("'").split(",")[:-1])
        _, built = self.build("plan-short", extra={"BP_EST": short})
        self.assertEqual(built[-1].returncode, 78)


if __name__ == "__main__":
    unittest.main()
