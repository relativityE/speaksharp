"""Runnable package (owner item 4): the reviewed harness is vendored and verified; the browser pin installs and fails closed; the plan builder produces
plans the REAL vendored runner accepts; nothing ignores a failure; the control plane runs secret-free with no product traffic."""
import datetime
import hashlib
import importlib.util
import io
import json
import os
import re
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile
import unittest
import zipfile

from _fixtures import NOW, REPO, REQUIRE, ROOT, TESTED, J, prerequisite, request_path, run_py, sample, wjson
from test_case_start_caps import SyntheticBuilder
import verify_harness as VH

CFG = os.path.join(ROOT, "config", "test-config.v1.json")
RECEIVING_SOURCE = J("harness", "draft-adapters", "SOURCE.sha256.json")["sourceSha"]
PROJECT_REF = "yxlapjuovrsvjswkwnrk"

_builder_spec = importlib.util.spec_from_file_location("cloud_test_build_plan", os.path.join(ROOT, "harness-adapter", "build_plan.py"))
_builder = importlib.util.module_from_spec(_builder_spec)
_builder_spec.loader.exec_module(_builder)


def write_account_bindings(path, campaign_id):
    wjson(path, {"schema": "speaksharp.cloud-test.live-account-bindings.v1",
                 "projectRef": PROJECT_REF,
                 "projectOrigin": "https://%s.supabase.co" % PROJECT_REF,
                 "sourceBundleSha256": "a" * 64,
                 "campaignId": campaign_id,
                 "roles": {
                     "existing-disposable": {"accountId": "00000000-0000-4000-8000-000000000001",
                                               "credentialVars": {"email": "THROWAWAY_TEST_EMAIL", "password": "THROWAWAY_TEST_PASSWORD"}},
                     "maintained-read-only": {"accountId": "00000000-0000-4000-8000-000000000002",
                                               "credentialVars": {"email": "FREE_TEST_EMAIL", "password": "FREE_TEST_PASSWORD"}}}})
    os.chmod(path, 0o600)


def sha(b):
    return hashlib.sha256(b).hexdigest()


class VendoredHarness(unittest.TestCase):
    def tree(self):
        d = tempfile.mkdtemp(prefix="ct-h-")
        shutil.copytree(os.path.join(ROOT, "harness"), os.path.join(d, "tools", "cloud-test", "harness"))
        for r, _, fs in os.walk(d):
            for f in fs:
                os.chmod(os.path.join(r, f), 0o644)
        return d

    def test_the_vendored_harness_matches_the_approved_hashes(self):
        errs, n = VH.check(J("config", "test-config.v1.json"), os.path.abspath(os.path.join(ROOT, "..", "..")))
        self.assertEqual(errs, [])
        self.assertGreater(n, 250)

    def test_original_reviewed_r15_pins_are_preserved_and_not_claimed_as_receiving_bytes(self):
        h = J("tests", "fixtures", "original-r15-pins.json")
        self.assertEqual(h["expectedCodeManifestSha256"], "7dae348f5edd30aba633b0e68627cb4de3a164558602586f3883bfabda3e48d8")
        self.assertEqual(h["expectedPacketManifestSha256"], "d636cc261a59832abfc5d81dce9c155867355542973b064086eccea45c9a8d6d")
        current = J("config", "test-config.v1.json")["harness"]
        self.assertNotEqual(current["expectedCodeManifestSha256"], h["expectedCodeManifestSha256"])
        self.assertNotEqual(current["expectedPacketManifestSha256"], h["expectedPacketManifestSha256"])

    def test_retained_d100_sources_are_consumed_as_unapplied_rpc_only_inputs(self):
        source = Path(ROOT) / "harness" / "draft-adapters" / "source" / "d100"
        evaluations = (source / "20260731120000_session_progress_evaluations.sql").read_text()
        recommendations = (source / "20260731130000_progress_recommendations.sql").read_text()
        for sql in (evaluations, recommendations):
            self.assertIn("NOT APPLIED TO PRODUCTION", sql)
            self.assertIn("GRANT SELECT", sql)
        self.assertIn("record_progress_evaluation", evaluations)
        self.assertIn("record_progress_recommendation", recommendations)
        self.assertIn("advance_recommendation_attempt", recommendations)

    def test_a_changed_adapter_is_refused(self):
        d = self.tree()
        with open(os.path.join(d, "tools/cloud-test/harness/draft-adapters/AHT-12.cjs"), "a") as f:
            f.write("// tampered\n")
        errs, _ = VH.check(J("config", "test-config.v1.json"), d)
        self.assertTrue(any("AHT-12.cjs" in e for e in errs), errs)

    def test_a_manifest_listed_adapter_that_is_missing_is_refused(self):
        d = self.tree()
        os.unlink(os.path.join(d, "tools/cloud-test/harness/draft-adapters/AHT-04.cjs"))
        errs, _ = VH.check(J("config", "test-config.v1.json"), d)
        self.assertTrue(any("AHT-04.cjs" in e and "missing" in e for e in errs), errs)

    def test_a_changed_runner_file_listed_in_the_code_manifest_is_refused(self):
        d = self.tree()
        with open(os.path.join(d, "tools/cloud-test/harness/bundle/harness/campaign-runner.cjs"), "a") as f:
            f.write("\n")
        errs, _ = VH.check(J("config", "test-config.v1.json"), d)
        self.assertTrue(any("campaign-runner.cjs" in e for e in errs), errs)

    def test_an_extra_unreviewed_file_is_refused(self):
        d = self.tree()
        open(os.path.join(d, "tools/cloud-test/harness/draft-adapters/extra.cjs"), "w").write("1")
        errs, _ = VH.check(J("config", "test-config.v1.json"), d)
        self.assertTrue(any("not in the reviewed packet manifest" in e for e in errs), errs)

    def test_a_missing_packet_is_blocked_setup(self):
        r = run_py("scripts/verify_harness.py", "--config", CFG, "--root", tempfile.mkdtemp())
        self.assertEqual(r.returncode, 78)

    def test_the_cli_exit_code_on_success(self):
        self.assertEqual(run_py("scripts/verify_harness.py", "--config", CFG).returncode, 0)


class FeedbackDeliveryPolicy(unittest.TestCase):
    def policy(self):
        value = J("harness", "bundle", "config", "policy.production.TEMPLATE.json")
        value["caps"] = {**value["caps"], "telemetry": None}
        return value

    def test_selected_07_or_08_gets_only_the_exact_reviewed_delivery_hosts_and_measured_cap(self):
        for selected in ([7], [8], [7, 8]):
            with self.subTest(selected=selected):
                policy = _builder.select_feedback_delivery(self.policy(), selected, True)
                self.assertEqual(policy["caps"]["telemetry"], 20)
                self.assertEqual(policy["hosts"]["us-assets.i.posthog.com"]["rules"], [{
                    "id": "posthog-sdk-array", "methods": ["GET"], "path": "^/static/array\\.js$", "cap": "telemetry",
                    "effect": "read the exact PostHog array SDK asset observed on the reviewed production route",
                    "review": True, "reviewedSourceSha": None,
                }])
                self.assertEqual(policy["hosts"]["us.i.posthog.com"]["rules"], [{
                    "id": "posthog-event-ingest", "methods": ["POST"], "path": "^/(e|i/v0/e)/$", "cap": "telemetry",
                    "effect": "send bounded non-PII product telemetry to either exact reviewed PostHog ingestion route",
                    "review": True, "reviewedSourceSha": None,
                }])

    def test_unselected_or_unbound_delivery_never_widens_the_policy(self):
        policy = _builder.select_feedback_delivery(self.policy(), [4, 13, 14], True)
        self.assertEqual(policy["caps"]["telemetry"], 0)
        for host in _builder.POSTHOG_DELIVERY_HOSTS:
            self.assertNotIn(host, policy["hosts"])
        with self.assertRaisesRegex(ValueError, "producer-unavailable"):
            _builder.select_feedback_delivery(self.policy(), [7], False)

    def test_only_the_explicit_placeholder_proof_can_generate_07_08_without_a_live_producer(self):
        request = {"approvedLimits": {"approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER"},
                   "selectionApprovalRef": "PLACEHOLDER-NOT-A-RUN-selection"}
        facts = {"ownerApprovalReference": "PLACEHOLDER-NOT-A-RUN-owner-approval", "approvedBy": "PLACEHOLDER-NOT-A-RUN",
                 "actionApproval": {"approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER",
                                    "selectionApprovalRef": "PLACEHOLDER-NOT-A-RUN-selection"}}
        env = {"BP_SYNTHETIC_OFFLINE_PROOF": "1", "BP_RUNTIME": "Claude SpeakSharp R4", "BP_PRODUCER_MODE": "unavailable"}
        self.assertTrue(_builder.synthetic_offline_proof(request, facts, env))
        policy = _builder.select_feedback_delivery(self.policy(), [7, 8], False, True)
        self.assertEqual(policy["caps"]["telemetry"], 20)
        for changed in (
            dict(env, BP_SYNTHETIC_OFFLINE_PROOF="0"),
            dict(env, BP_RUNTIME="GitHub Actions SpeakSharp"),
            dict(env, BP_PRODUCER_MODE="same-github-job"),
        ):
            with self.assertRaisesRegex(ValueError, "synthetic-offline-proof"):
                _builder.synthetic_offline_proof(request, facts, changed)
        bad_request = json.loads(json.dumps(request)); bad_request["approvedLimits"]["approvalRef"] = "REAL-APPROVAL"
        with self.assertRaisesRegex(ValueError, "synthetic-offline-proof"):
            _builder.synthetic_offline_proof(bad_request, facts, env)
        bad_facts = json.loads(json.dumps(facts)); bad_facts["actionApproval"]["selectionApprovalRef"] = "CHANGED"
        with self.assertRaisesRegex(ValueError, "synthetic-offline-proof"):
            _builder.synthetic_offline_proof(request, bad_facts, env)
        # A real builder invocation cannot turn the ordinary synthetic fixture
        # into the sealed proof merely by setting the environment marker.
        with tempfile.TemporaryDirectory(prefix="not-the-offline-proof-") as root:
            ordinary = SyntheticBuilder(root, cases=(7, 8))
            ordinary.env["BP_SYNTHETIC_OFFLINE_PROOF"] = "1"
            result = ordinary.run()
            self.assertEqual(result.returncode, 78)
            self.assertEqual(ordinary.outputs(), {})

    def test_generated_policy_uses_real_guard_matcher_and_cumulative_caps(self):
        def same_job(builder):
            facts = J("tests", "fixtures", "plan-facts.PLACEHOLDER.json")
            facts["producerReviewReference"] = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
            builder.request["executionRuntime"] = "GitHub Actions SpeakSharp"
            builder.repin(facts=facts)
            packet = Path(ROOT) / "harness"
            receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
            descriptor = {
                "producerIdentity": "github-actions:relativityE/speaksharp:123:1:live", "jobId": "live",
                "producerCodeSha256": sha((packet / "bundle/harness/authenticated-job-producer.cjs").read_bytes()),
                "receiverSourceSha256": sha((packet / receiver).read_bytes()), "receiverRelativePath": receiver,
                "workflowSourceSha": "b" * 40, "reviewReference": facts["producerReviewReference"],
            }
            descriptor_path = builder.root / "producer-descriptor.json"
            descriptor_path.write_text(json.dumps(descriptor)); descriptor_path.chmod(0o600)
            builder.env.update(BP_PRODUCER_MODE="same-github-job", BP_PRODUCER_DESCRIPTOR=str(descriptor_path),
                BP_PRODUCER_DESCRIPTOR_SHA256=sha(descriptor_path.read_bytes()),
                GITHUB_ACTIONS="true", GITHUB_REPOSITORY="relativityE/speaksharp", GITHUB_RUN_ID="123",
                GITHUB_RUN_ATTEMPT="1", GITHUB_JOB="live", GITHUB_SHA="b" * 40)

        with tempfile.TemporaryDirectory(prefix="feedback-guard-generated-") as root:
            selected_root = Path(root) / "selected"; selected_root.mkdir()
            selected = SyntheticBuilder(selected_root, cases=(7,))
            same_job(selected)
            results = [selected.run("phase1"), selected.run("phase2")]
            self.assertEqual([r.returncode for r in results], [0, 0], [r.stderr for r in results])
            policy = selected.root / "private/cfg/policy.json"
            control = r'''
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {matchPolicyRule,Ledger}=require(process.argv[1]);
const policy=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),dir=process.argv[3];
const allowed=[['us-assets.i.posthog.com','GET','/static/array.js'],['us.i.posthog.com','POST','/e/'],['us.i.posthog.com','POST','/i/v0/e/']];
for(const input of allowed){const rule=matchPolicyRule(policy,...input);assert(rule);assert.equal(rule.cap,'telemetry');}
for(const input of [['other.invalid','GET','/static/array.js'],['us-assets.i.posthog.com','POST','/static/array.js'],['us-assets.i.posthog.com','GET','/static/other.js'],['us.i.posthog.com','GET','/e/'],['us.i.posthog.com','POST','/e/extra']])assert.equal(matchPolicyRule(policy,...input),null);
const telemetry=new Ledger(path.join(dir,'telemetry-ledger.json'),policy.caps);
for(let i=0;i<20;i++)assert.equal(telemetry.tryReserve(['total','telemetry']),null);
assert.equal(telemetry.tryReserve(['total','telemetry']),'telemetry');telemetry.release();
const total=new Ledger(path.join(dir,'total-ledger.json'),policy.caps);
for(let i=0;i<policy.caps.total;i++)assert.equal(total.tryReserve(['total']),null);
assert.equal(total.tryReserve(['total']),'total');total.release();
'''
            result = subprocess.run(["node", "-e", control,
                str(Path(ROOT) / "harness/bundle/harness/guard-proxy.cjs"), str(policy), os.path.realpath(root)],
                capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)

            unselected_root = Path(root) / "unselected"; unselected_root.mkdir()
            unselected = SyntheticBuilder(unselected_root, cases=(13,))
            unselected_results = [unselected.run("phase1"), unselected.run("phase2")]
            self.assertEqual([r.returncode for r in unselected_results], [0, 0], [r.stderr for r in unselected_results])
            unselected_policy = json.loads((unselected.root / "private/cfg/policy.json").read_text())
            self.assertEqual(unselected_policy["caps"]["telemetry"], 0)
            for host in _builder.POSTHOG_DELIVERY_HOSTS:
                self.assertNotIn(host, unselected_policy["hosts"])

            missing_root = Path(root) / "missing-producer"; missing_root.mkdir()
            missing = SyntheticBuilder(missing_root, cases=(7,))
            missing_results = [missing.run("phase1"), missing.run("phase2")]
            self.assertEqual(missing_results[-1].returncode, 78)
            self.assertFalse((missing.root / "private/cfg/policy.json").exists())


class BrowserPin(unittest.TestCase):
    """install_browser.py on a small fake archive with its own pins: proves the verification logic offline."""
    def setup_pin(self, binary=b"#!/bin/sh\necho fake\n", name="chrome-linux64/chrome", mutate=None):
        d = tempfile.mkdtemp(prefix="ct-b-")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr(name, binary)
        data = buf.getvalue()
        archive = os.path.join(d, "a.zip"); open(archive, "wb").write(data)
        cfg = J("config", "test-config.v1.json")
        cfg["tools"]["browser"].update({"archiveBytes": len(data), "archiveSha256": sha(data), "chromeBinarySha256": sha(binary), "playwrightRevision": "chromium-test"})
        if mutate:
            mutate(cfg["tools"]["browser"])
        cp = os.path.join(d, "c.json"); wjson(cp, cfg)
        return d, archive, cp

    def install(self, d, archive, cp):
        return subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "install_browser.py"), "--config", cp, "--browsers-path", os.path.join(d, "br"), "--archive", archive], capture_output=True, text=True)

    def test_a_matching_archive_installs_and_prints_the_verified_path(self):
        d, a, c = self.setup_pin()
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(os.access(r.stdout.strip(), os.X_OK))

    def test_a_second_install_is_idempotent(self):
        d, a, c = self.setup_pin()
        self.assertEqual(self.install(d, a, c).returncode, 0)
        self.assertEqual(self.install(d, a, c).returncode, 0)

    def test_wrong_archive_size_fails_closed(self):
        d, a, c = self.setup_pin(mutate=lambda b: b.update(archiveBytes=b["archiveBytes"] + 1))
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 78); self.assertIn("bytes", r.stderr)

    def test_wrong_archive_hash_fails_closed(self):
        d, a, c = self.setup_pin(mutate=lambda b: b.update(archiveSha256="0" * 64))
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 78); self.assertIn("archive sha256", r.stderr)

    def test_wrong_binary_hash_fails_closed(self):
        d, a, c = self.setup_pin(mutate=lambda b: b.update(chromeBinarySha256="0" * 64))
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 78); self.assertIn("binary sha256", r.stderr)

    def test_a_missing_binary_fails_closed(self):
        d, a, c = self.setup_pin(name="chrome-linux64/other")
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 78)

    def test_an_unsafe_archive_path_fails_closed(self):
        d, a, c = self.setup_pin(name="chrome-linux64/../../evil")
        r = self.install(d, a, c)
        self.assertEqual(r.returncode, 78); self.assertIn("unsafe", r.stderr)
        self.assertFalse(os.path.exists(os.path.join(d, "evil")))

    def test_a_corrupt_archive_fails_closed(self):
        d, a, c = self.setup_pin()
        data = bytearray(open(a, "rb").read()); data[bytes(data).find(b"echo fake") + 2] ^= 0xFF
        open(a, "wb").write(bytes(data))
        cfg = json.load(open(c)); cfg["tools"]["browser"]["archiveSha256"] = sha(bytes(data)); wjson(c, cfg)
        self.assertEqual(self.install(d, a, c).returncode, 78)

    def test_the_download_url_must_be_the_chrome_for_testing_bucket(self):
        d, a, c = self.setup_pin(mutate=lambda b: b.update(archiveUrl="https://example.invalid/chrome.zip"))
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "install_browser.py"), "--config", c, "--browsers-path", os.path.join(d, "br2")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 78); self.assertIn("public bucket", r.stderr)

    def test_the_pins_in_the_config_are_the_verified_ones(self):
        b = J("config", "test-config.v1.json")["tools"]["browser"]
        self.assertEqual(b["version"], "143.0.7499.4")
        self.assertEqual(b["chromeBinarySha256"], "2e61bc3fd990bd4d7b419ef6b6303c67aaed683e5b83b3b25e416f015f343209")
        self.assertEqual(b["archiveSha256"], "ab56b2a7955c2961f74348e2349f1e907489283da23dba37c730b624e4d670bb")
        self.assertEqual(b["archiveBytes"], 172695801)
        self.assertTrue(b["archiveUrl"].startswith("https://storage.googleapis.com/chrome-for-testing-public/143.0.7499.4/"))

    # The real-archive install belongs to the legacy acquire route, not current qualification (PO 2026-10-31):
    # tests/legacy_acquire_route_checks.py, which discovery does not load.


class NothingIsIgnored(unittest.TestCase):
    """The earlier package ignored an install failure with `|| true`. No script may."""
    def scripts(self):
        for sub in ("scripts",):
            for fn in os.listdir(os.path.join(ROOT, sub)):
                if fn.endswith((".sh", ".py")):
                    yield fn, open(os.path.join(ROOT, sub, fn), encoding="utf-8").read()

    def test_no_failure_is_swallowed_in_the_shell_scripts(self):
        for fn, text in self.scripts():
            if fn.endswith(".sh"):
                for bad in ("|| true", "|| :", "2>/dev/null", "set +e", "|| exit 0"):
                    self.assertNotIn(bad, text, "%s: %s" % (fn, bad))
                self.assertIn("set -euo pipefail", text, fn)

    def test_the_install_stage_runs_the_pinned_installer_and_the_lockfile_install(self):
        text = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn("install_browser.py", text)
        self.assertIn("--received-installed-receipt", text)
        self.assertIn("--baselines", text)
        self.assertIn("--check-only", text)
        self.assertIn("acquire is unsupported", text)
        self.assertNotIn("ci --ignore-scripts", text)
        self.assertNotRegex(text, r"npm[^\n]*\|\|")

    def test_the_runner_dependencies_are_locked_to_playwright_1_57_0(self):
        lock = json.load(open(os.path.join(ROOT, "runner", "package-lock.json")))
        self.assertEqual(lock["packages"]["node_modules/playwright"]["version"], "1.57.0")
        self.assertTrue(lock["packages"]["node_modules/playwright"]["integrity"].startswith("sha512-"))
        self.assertEqual(json.load(open(os.path.join(ROOT, "runner", "package.json")))["dependencies"], {"pdfjs-dist": "4.10.38", "playwright": "1.57.0"})
        pdf = lock["packages"]["node_modules/pdfjs-dist"]
        self.assertEqual((pdf["version"], pdf["integrity"]), ("4.10.38", J("config", "test-config.v1.json")["tools"]["pdfjs"]["integrity"]))

    def test_unknown_stage_and_missing_inputs_are_blocked_setup(self):
        d = tempfile.mkdtemp()
        env = {"PATH": os.environ["PATH"], "CT_OUT": d, "CT_REQUEST": "x"}
        self.assertEqual(subprocess.run(["bash", os.path.join(ROOT, "scripts/execute_run.sh"), "nope"], capture_output=True, text=True, env=env).returncode, 78)
        r = subprocess.run(["bash", os.path.join(ROOT, "scripts/execute_run.sh"), "build-plan"], capture_output=True, text=True, env=env)
        self.assertEqual(r.returncode, 78)
        self.assertIn("BLOCKED_SETUP", r.stderr)


def node_ok():
    return shutil.which("node") is not None


def chrome_path():
    # This run's discovered preinstalled browser (PO 2026-10-31): exactly the path and sha256 its discovery receipt recorded.
    rec_path, chrome = os.environ.get("CT_BROWSER_RECEIPT"), os.environ.get("CT_CHROME")
    if rec_path and chrome and os.path.isfile(rec_path) and os.path.isfile(chrome):
        rec = json.load(open(rec_path, encoding="utf-8"))
        if rec.get("path") == os.path.realpath(chrome) and rec.get("observedBinarySha256") == sha(open(chrome, "rb").read()):
            return chrome
        return None
    cand = [os.environ.get("CT_CHROME"), os.path.join(os.environ.get("PLAYWRIGHT_BROWSERS_PATH", ""), "chromium-1200", "chrome-linux64", "chrome"), os.path.expanduser("~/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome")]
    for c in cand:
        if c and os.path.isfile(c) and sha(open(c, "rb").read()) == J("config", "test-config.v1.json")["tools"]["browser"]["chromeBinarySha256"]:
            return c
    return None


def playwright_cwd():
    selected = os.environ.get("CT_EXISTING_DEPENDENCY_ROOT")
    if selected is not None:
        if not os.path.isabs(selected):
            raise AssertionError("CT_EXISTING_DEPENDENCY_ROOT must be absolute")
        manifest = os.path.join(selected, "node_modules", "playwright", "package.json")
        if not os.path.isfile(manifest):
            raise AssertionError("explicit existing Playwright manifest is missing")
        if json.load(open(manifest))["version"] != J("config", "test-config.v1.json")["tools"]["browser"]["playwright"]:
            raise AssertionError("explicit existing Playwright version differs from the pin")
        return os.path.realpath(selected)
    for c in (os.path.join(ROOT, "runner"), REPO):
        if os.path.isdir(os.path.join(c, "node_modules", "playwright")):
            return c
    return None


class PlanBuilderProof(unittest.TestCase):
    """The vendored plan builder (with placeholder facts, clearly NOT A RUN) produces plans the real vendored runner accepts."""
    @classmethod
    def setUpClass(cls):
        prerequisite(node_ok(), "node")
        prerequisite(subprocess.run(["git", "-C", REPO, "cat-file", "-e", RECEIVING_SOURCE + "^{commit}"], capture_output=True).returncode == 0, "git history with the receiving-source SHA")
        prerequisite(os.path.isfile(os.path.join(REPO, "tests", "fixtures", "rwt", "open_mic_tts.wav")), "the reviewed speech fixtures in the checkout")
        cls.work = os.path.realpath(tempfile.mkdtemp(prefix="ct-plan-"))
        cls.browser = os.path.join(cls.work, "synthetic-browser")
        Path(cls.browser).write_bytes(b"synthetic browser identity; never executed\n")
        cls.browser_identity = os.path.join(cls.work, "browser-identity.json")
        wjson(cls.browser_identity, {"schema": "speaksharp.cloud-test.existing-browser.v1", "path": os.path.realpath(cls.browser),
                                    "observedBinarySha256": hashlib.sha256(Path(cls.browser).read_bytes()).hexdigest()})
        req = sample()["req"]
        # The receiving adapter rejects the historic 4c85 binding. Exercise the
        # same current source as FullPlanProof, not an obsolete request identity.
        req["release"]["testedSha"] = RECEIVING_SOURCE
        req["approvedLimits"] = {"cumulativeCeilingRequests": 6700, "identityCap": 98, "runCapRequests": 180, "approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER"}
        start_caps = {"AHT-12": 3}
        for row in req["selection"]:
            row["startPressCap"] = start_caps[row["case"]]
        req["estimate"]["starts"] = sum(start_caps.values())
        req["proposedLimits"]["startPressCaps"] = dict(start_caps)
        req["approvedLimits"]["startPressCaps"] = dict(start_caps)
        req["window"] = {"startUtc": "2026-01-01T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z", "approvalRef": "PLACEHOLDER-NOT-A-RUN"}
        req["selectionApprovalRef"] = "PLACEHOLDER-NOT-A-RUN-selection"
        cls.reqp = os.path.join(cls.work, "req.json"); wjson(cls.reqp, req); os.chmod(cls.reqp, 0o600)
        cls.bindings = os.path.join(cls.work, "account-bindings.json")
        write_account_bindings(cls.bindings, req["runId"])
        cls.reconciliation = os.path.join(cls.work, "reconciliation.json")
        wjson(cls.reconciliation, {"synthetic": "NOT-A-RUN", "starts": {"ownerCounted": 5},
                                   "ceilings": {"starts": 100, "requests": 20000, "identityReads": 200,
                                                "takes": 100, "protectedReserveRequests": 50},
                                   "requests": {"conservativeUsed": 0},
                                   "identityReads": {"conservativeUsed": 0},
                                   "takes": {"ownerCounted": 0}})
        os.chmod(cls.reconciliation, 0o600)
        cls.facts = os.path.join(cls.work, "facts.json")
        facts = J("tests", "fixtures", "plan-facts.PLACEHOLDER.json")
        facts["actionApproval"] = {"schema": "speaksharp.case-start-approval.v1",
                                   "requestSha256": hashlib.sha256(Path(cls.reqp).read_bytes()).hexdigest(),
                                   "reconciliationSha256": hashlib.sha256(Path(cls.reconciliation).read_bytes()).hexdigest(),
                                   "approvalRef": req["approvedLimits"]["approvalRef"],
                                   "approvedBy": req["approvedLimits"]["approvedBy"],
                                   "selectionApprovalRef": req["selectionApprovalRef"]}
        wjson(cls.facts, facts)
        os.chmod(cls.facts, 0o600)
        r = run_py("scripts/run_env.py", "--request", cls.reqp, "--request-sha256", hashlib.sha256(Path(cls.reqp).read_bytes()).hexdigest(),
                   "--reconciliation", cls.reconciliation, "--out", os.path.join(cls.work, "env.txt"))
        assert r.returncode == 0, r.stdout + r.stderr

    def build(self, name, extra=None, drop=()):
        private = os.path.join(self.work, name)
        script = ("set -euo pipefail; set -a; . %s; set +a; " % os.path.join(self.work, "env.txt"))
        # Test-specific runtime/negative controls must override the sourced request,
        # as FullPlanProof already does; otherwise they silently exercise Claude.
        script += "".join("export %s=%s; " % (key, shlex.quote(value)) for key, value in (extra or {}).items() if key not in drop)
        env = {"PATH": os.environ["PATH"], "HOME": self.work, "BP_PACKET": os.path.join(ROOT, "harness"), "BP_CHECKOUT": REPO, "BP_PRIVATE": private,
               "BP_FACTS": self.facts, "BP_ACCOUNT_BINDINGS_FILE": self.bindings,
               "BP_LIVE_ACCOUNTS_SHA256": "a" * 64,
               "BP_REQUEST_FILE": self.reqp, "BP_REQUEST_SHA256": hashlib.sha256(Path(self.reqp).read_bytes()).hexdigest(), "BP_LEASE_RPCS": "1", "BP_LEASE_READ": "1",
               "BP_TASK_ID": "PLACEHOLDER-task", "BP_SOURCE_REFERENCE": "https://claude.ai/code/PLACEHOLDER", "BP_ENV_ID": "env_PLACEHOLDER", "BP_MEDIA_PARENT": os.path.join(self.work, "media"),
               "BP_BROWSER_IDENTITY": self.browser_identity,
               "VITE_SUPABASE_ANON_KEY": "placeholder-publishable-key"}
        env.update(extra or {})
        for k in drop:
            env.pop(k, None)
        out = []
        for phase in ("phase1", "phase2"):
            r = subprocess.run(["bash", "-c", script + "python3 -I %s %s" % (os.path.join(ROOT, "harness-adapter", "build_plan.py"), phase)], capture_output=True, text=True, env=env)
            out.append(r)
            if r.returncode:
                break
        return private, out

    def accept(self, private):
        return subprocess.run(["node", os.path.join(ROOT, "tests", "node", "plan-acceptance.cjs"), os.path.join(ROOT, "harness"), os.path.join(private, "cfg", "campaign-plan.json")],
                              capture_output=True, text=True, cwd=REPO, env={"PATH": os.environ["PATH"], "HOME": self.work})

    def test_the_builder_produces_a_plan_for_exactly_the_selected_case_with_the_requested_caps(self):
        private, out = self.build("p-caps")
        self.assertEqual([o.returncode for o in out], [0, 0], [o.stderr for o in out])
        plan = json.load(open(os.path.join(private, "cfg", "campaign-plan.json")))
        self.assertEqual(plan["selection"]["ids"], ["AHT-12"])
        self.assertEqual((plan["requestBudget"]["runCap"], plan["requestBudget"]["cleanupReserve"], plan["identityCap"]), (180, 50, 4))
        pol = json.load(open(os.path.join(private, "cfg", "policy.json")))
        self.assertEqual((pol["caps"]["total"], pol["caps"]["coaching"], pol["caps"]["account-closure"]), (180, 0, 0))
        self.assertEqual(pol["caps"]["telemetry"], 0)
        self.assertNotIn("us-assets.i.posthog.com", pol["hosts"])
        self.assertNotIn("us.i.posthog.com", pol["hosts"])
        self.assertEqual(plan["sourceSha"], RECEIVING_SOURCE)
        consumption = json.load(open(os.path.join(private, "cfg/build-plan-consumption.json")))
        self.assertEqual(consumption["schema"], "speaksharp.cloud-test.build-plan-consumption.v1")
        self.assertEqual(consumption["planSha256"], sha(open(os.path.join(private, "cfg/campaign-plan.json"), "rb").read()))
        self.assertEqual(consumption["requestSha256"], sha(open(self.reqp, "rb").read()))

    def job_inputs(self, name):
        review = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
        request = json.load(open(self.reqp))
        request["executionRuntime"] = "GitHub Actions SpeakSharp"
        request_path = os.path.join(self.work, name + "-request.json")
        wjson(request_path, request)
        os.chmod(request_path, 0o600)
        request_sha = sha(open(request_path, "rb").read())
        facts = json.load(open(self.facts))
        facts["producerReviewReference"] = review
        facts["actionApproval"]["requestSha256"] = request_sha
        fp = os.path.join(self.work, name + "-facts.json"); wjson(fp, facts)
        packet = os.path.join(ROOT, "harness")
        receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
        descriptor = {"producerIdentity": "github-actions:relativityE/speaksharp:123:1:live", "jobId": "live",
                      "producerCodeSha256": sha(open(os.path.join(packet, "bundle/harness/authenticated-job-producer.cjs"), "rb").read()),
                      "receiverSourceSha256": sha(open(os.path.join(packet, receiver), "rb").read()),
                      "receiverRelativePath": receiver, "workflowSourceSha": "b" * 40, "reviewReference": review}
        dp = os.path.join(self.work, name + "-descriptor.json"); wjson(dp, descriptor)
        return {"BP_RUNTIME": "GitHub Actions SpeakSharp", "BP_REQUEST_FILE": request_path,
                "BP_REQUEST_SHA256": request_sha, "BP_PRODUCER_MODE": "same-github-job", "BP_PRODUCER_DESCRIPTOR": dp,
                "BP_PRODUCER_DESCRIPTOR_SHA256": sha(open(dp, "rb").read()), "BP_FACTS": fp,
                "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": "b" * 40}

    def test_same_job_plan_uses_actual_reviewed_receiver_and_github_attestation(self):
        private, out = self.build("p-same-job", extra=self.job_inputs("same-job"))
        self.assertEqual([o.returncode for o in out], [0, 0], [o.stderr for o in out])
        plan = json.load(open(os.path.join(private, "cfg/campaign-plan.json")))
        self.assertEqual(plan["runtime"], "GitHub Actions SpeakSharp")
        for c in plan["cases"]:
            if c["id"] in ("AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"):
                self.assertTrue(c["producerReceiverFile"].endswith("github-job-evidence-reader.cjs"))
                cfg = json.load(open(c["configFile"]))
                for producer in cfg["privateEvidenceProducers"].values():
                    self.assertEqual(producer["producerIdentity"], "github-actions:relativityE/speaksharp:123:1:live")
                    self.assertEqual(producer["deliveryKind"], "reviewed-authenticated-workflow-artifact")
        case07 = json.load(open(next(c["configFile"] for c in plan["cases"] if c["id"] == "AHT-07")))
        self.assertEqual(set(case07["privateEvidenceProducers"]), {"coaching-authority", "feedback-association", "feedback-received"})
        att = json.load(open(os.path.join(private, "cfg/runtime-attestation.json")))
        self.assertEqual(att["kind"], "github-actions-job-environment-receipt")
        self.assertEqual(att["immutableEnvironmentId"], "relativityE/speaksharp/123/1/live")
        self.assertNotIn("claude.ai", json.dumps(att))
        accepted = self.accept(private)
        # This source/selection test has not run the real browser stimulus qualification.
        # Every other real preflight must accept; the missing stimulus must still refuse.
        result = json.loads(accepted.stdout)
        self.assertEqual(accepted.returncode, 1)
        for check in ("campaign plan structure", "request budget binding", "run identity", "every selected case preflight"):
            self.assertEqual(result[check], "ACCEPTED")
        self.assertTrue(result["stimulus preflight receipt"].startswith("REFUSED:"))

    def test_same_job_descriptor_from_another_run_is_refused(self):
        inputs = self.job_inputs("other-job"); inputs["GITHUB_RUN_ID"] = "999"
        private, out = self.build("p-other-job", extra=inputs)
        self.assertEqual((out[-1].returncode, out[-1].stderr.strip()), (78, "BLOCKED_SETUP: INVALID_BINDING_INPUT"))
        self.assertFalse(os.path.exists(private))

    def test_same_run_descriptor_from_another_job_is_refused(self):
        inputs = self.job_inputs("other-job-same-run"); inputs["GITHUB_JOB"] = "other"
        private, out = self.build("p-other-job-same-run", extra=inputs)
        self.assertEqual((out[-1].returncode, out[-1].stderr.strip()), (78, "BLOCKED_SETUP: INVALID_BINDING_INPUT"))
        self.assertFalse(os.path.exists(private))

    def test_no_session_specific_value_is_embedded_in_the_generated_files(self):
        private, out = self.build("p-embed")
        blob = ""
        for r, _, fs in os.walk(os.path.join(private, "cfg")):
            for f in fs:
                blob += open(os.path.join(r, f), encoding="utf-8", errors="ignore").read()
        for old in ("session_017MikJ9zWJfBGtWJueo4U55", "env_018RojKUCDVEHrttr74df8uM", "owner-chat-message", "Akin"):
            self.assertNotIn(old, blob, old)
        self.assertIn("PLACEHOLDER-NOT-A-RUN", blob)

    def test_the_real_runner_accepts_the_identity_and_refuses_a_capture_case_without_a_stimulus_receipt(self):
        private, _ = self.build("p-norec")
        r = self.accept(private)
        out = json.loads(r.stdout)
        self.assertEqual(out["run identity"], "ACCEPTED")
        self.assertTrue(out["stimulus preflight receipt"].startswith("REFUSED"), out)
        self.assertNotEqual(r.returncode, 0)

    def test_stimulus_preflight_on_the_pinned_browser_then_bound_plan_accepted_with_zero_product_traffic(self):
        chrome = chrome_path()
        prerequisite(chrome, "the pinned browser installed and hash-verified (CT_CHROME)")
        browser_identity = os.environ.get("CT_BROWSER_RECEIPT")
        prerequisite(browser_identity and os.path.isfile(browser_identity), "this run's verified browser identity receipt")
        cwd = playwright_cwd()
        prerequisite(cwd, "playwright installed from the lockfile (runner/node_modules)")
        browser_binding = {"BP_BROWSER_IDENTITY": browser_identity}
        private0, initial = self.build("p-0", extra=browser_binding)
        self.assertEqual([o.returncode for o in initial], [0, 0], [o.stderr for o in initial])
        receipt = os.path.join(self.work, "receipt.json")
        r = subprocess.run(["node", os.path.join(ROOT, "harness", "draft-adapters", "stimulus-preflight.cjs"), "--plan", os.path.join(private0, "cfg", "campaign-plan.json"), "--chrome", chrome, "--out", receipt],
                           capture_output=True, text=True, cwd=cwd, env={"PATH": os.environ["PATH"], "HOME": self.work})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rec = json.load(open(receipt))
        self.assertEqual(rec["productTraffic"], 0)
        c = rec["cases"]["AHT-12"]
        self.assertTrue(c["captureGranted"] and c["speechDetected"] and c["ready"])
        self.assertEqual((c["ungrantedOutcome"], c["noDeviceOutcome"]), ("not-allowed", "not-found"))
        private, out = self.build("p-bound", extra={"BP_STIM": receipt, **browser_binding})
        self.assertEqual([o.returncode for o in out], [0, 0], [o.stderr for o in out])
        acc = self.accept(private)
        self.assertEqual(acc.returncode, 0, acc.stdout + acc.stderr)
        self.assertEqual(set(json.loads(acc.stdout).values()), {"ACCEPTED"})
        # negative controls on the receipt
        for label, mutate in (("ungranted request not denied", lambda x: x["cases"]["AHT-12"].update(ungrantedOutcome="granted")),
                              ("capture device not acquired", lambda x: x["cases"]["AHT-12"].update(captureGranted=False))):
            bad = json.loads(json.dumps(rec)); mutate(bad)
            bp = os.path.join(self.work, "bad.json"); wjson(bp, bad)
            pv, _ = self.build("p-bad-" + label.split()[0], extra={"BP_STIM": bp, **browser_binding})
            self.assertTrue(json.loads(self.accept(pv).stdout)["stimulus preflight receipt"].startswith("REFUSED"), label)

    def test_a_stimulus_receipt_from_another_browser_is_refused(self):
        private0, initial = self.build("p-browser-mismatch-0")
        self.assertEqual([o.returncode for o in initial], [0, 0], [o.stderr for o in initial])
        plan = json.loads(Path(private0, "cfg", "campaign-plan.json").read_text())
        case = next(c for c in plan["cases"] if c["id"] == "AHT-12")
        receipt = {
            "schema": "speaksharp.stimulus-preflight.v1",
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "productTraffic": 0,
            "codeManifestSha256": sha(Path(ROOT, "harness", "bundle", "CODE.sha256").read_bytes()),
            "chrome": {"executablePath": "/different/browser", "sha256": "f" * 64},
            "cases": {"AHT-12": {"mediaSha256": case["mediaSha256"], "captureGranted": True,
                                     "ungrantedOutcome": "not-allowed", "noDeviceOutcome": "not-found",
                                     "speechDetected": True, "alignment": {"status": "not-applicable"}, "ready": True}},
        }
        rp = os.path.join(self.work, "browser-mismatch-receipt.json"); wjson(rp, receipt)
        private, out = self.build("p-browser-mismatch", extra={"BP_STIM": rp})
        self.assertEqual([o.returncode for o in out], [0, 0], [o.stderr for o in out])
        result = json.loads(self.accept(private).stdout)
        self.assertTrue(result["stimulus preflight receipt"].startswith("REFUSED:"), result)
        self.assertIn("browser differs", result["stimulus preflight receipt"])

    # ---- fail closed on missing inputs
    def test_missing_inputs_are_blocked_setup(self):
        for name in ("BP_FACTS", "BP_ACCOUNT_BINDINGS_FILE", "BP_LIVE_ACCOUNTS_SHA256", "BP_TASK_ID", "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CHECKOUT", "BP_BROWSER_IDENTITY", "BP_SOURCE_SHA", "BP_SELECT_REF"):
            private, out = self.build("p-miss-" + name.lower(), drop=(name,)) if name in ("BP_FACTS", "BP_ACCOUNT_BINDINGS_FILE", "BP_LIVE_ACCOUNTS_SHA256", "BP_TASK_ID", "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CHECKOUT", "BP_BROWSER_IDENTITY") else (None, None)
            if out is None:
                continue
            self.assertTrue(out[-1].returncode == 78, (name, out[-1].returncode, out[-1].stderr[-200:]))

    def test_a_facts_file_without_required_keys_is_blocked_setup(self):
        bad = json.load(open(self.facts))
        bad.pop("ownerApprovalReference")
        p = os.path.join(self.work, "facts-bad.json"); wjson(p, bad)
        _, out = self.build("p-facts", extra={"BP_FACTS": p})
        self.assertEqual(out[0].returncode, 78)
        self.assertEqual(out[0].stderr.strip(), "BLOCKED_SETUP: INVALID_BINDING_INPUT")

    def test_the_builder_never_overwrites_an_existing_private_directory(self):
        private, out = self.build("p-twice")
        self.assertEqual(out[-1].returncode, 0)
        _, out2 = self.build("p-twice")
        self.assertNotEqual(out2[0].returncode, 0)


class SecretFreeCleanRoom(unittest.TestCase):
    """Item 4: the GitHub preflight is secret-free with no product traffic. Demonstrated here in a clean room: an empty environment and, where the kernel
    allows, a network namespace with no route at all. (The same steps run on GitHub in the workflow; a run there needs the owner's merge first.)"""
    def run_clean(self, wrapper):
        # The real pipeline over the SYNTHETIC sealed history (tests/_synthetic_history.py), so the clean-room proof needs no retained campaigns.
        from _synthetic_history import shared as synthetic_history
        h = synthetic_history()
        d = tempfile.mkdtemp(prefix="ct-cr-")
        oc = os.path.join(d, "oc.json"); wjson(oc, {"passed": True})
        out = os.path.join(d, "out")
        cmd = wrapper + [sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", h.request(request_path()), "--out-dir", out,
                         "--offline-checks", oc, "--repo", REPO, "--now", NOW, "--generated-at", NOW, "--require-secret-free", *h.args()]
        r = subprocess.run(cmd, capture_output=True, text=True, env={"PATH": os.environ["PATH"], "HOME": d})
        return r, out

    def test_empty_environment(self):
        prerequisite(subprocess.run(["git", "-C", REPO, "cat-file", "-e", TESTED], capture_output=True).returncode == 0, "git history")
        r, out = self.run_clean([])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        a = json.load(open(os.path.join(out, "preflight-attestation.json")))
        self.assertEqual((a["secretFree"], a["networkAttempts"], a["productHostsContacted"]), (True, 0, 0))

    def test_no_network_namespace(self):
        prerequisite(subprocess.run(["git", "-C", REPO, "cat-file", "-e", TESTED], capture_output=True).returncode == 0, "git history")
        prerequisite(shutil.which("unshare") and subprocess.run(["unshare", "-rn", "true"], capture_output=True).returncode == 0, "unshare -rn (network namespace)")
        probe = subprocess.run(["unshare", "-rn", sys.executable, "-c", "import socket\ntry:\n  socket.create_connection(('1.1.1.1',53),2)\n  print('reachable')\nexcept OSError:\n  print('unreachable')"], capture_output=True, text=True)
        self.assertEqual(probe.stdout.strip(), "unreachable")
        r, out = self.run_clean(["unshare", "-rn"])
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertTrue(json.load(open(os.path.join(out, "report", "validation.json")))["valid"])


if __name__ == "__main__":
    unittest.main()
