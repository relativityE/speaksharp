"""Runnable package (owner item 4): the reviewed harness is vendored and verified; the browser pin installs and fails closed; the plan builder produces
plans the REAL vendored runner accepts; nothing ignores a failure; the control plane runs secret-free with no product traffic."""
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

from _fixtures import NOW, REPO, REQUIRE, ROOT, TESTED, J, prerequisite, request_path, run_py, sample, wjson
import verify_harness as VH

CFG = os.path.join(ROOT, "config", "test-config.v1.json")
RECEIVING_SOURCE = J("harness", "draft-adapters", "SOURCE.sha256.json")["sourceSha"]


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

    def test_a_changed_adapter_is_refused(self):
        d = self.tree()
        with open(os.path.join(d, "tools/cloud-test/harness/draft-adapters/AHT-12.cjs"), "a") as f:
            f.write("// tampered\n")
        errs, _ = VH.check(J("config", "test-config.v1.json"), d)
        self.assertTrue(any("AHT-12.cjs" in e for e in errs), errs)

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

    def test_the_real_pinned_archive_installs_when_supplied(self):
        arch = os.environ.get("CT_BROWSER_ARCHIVE")
        if not (arch and os.path.exists(arch)):
            self.skipTest("CT_BROWSER_ARCHIVE not supplied (the install step verifies the real download on the runner)")
        d = tempfile.mkdtemp()
        r = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "install_browser.py"), "--config", CFG, "--browsers-path", d, "--archive", arch], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sha(open(r.stdout.strip(), "rb").read()), "2e61bc3fd990bd4d7b419ef6b6303c67aaed683e5b83b3b25e416f015f343209")


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
        self.assertIn("ci --ignore-scripts", text)
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
        cls.work = tempfile.mkdtemp(prefix="ct-plan-")
        req = sample()["req"]
        # The receiving adapter rejects the historic 4c85 binding. Exercise the
        # same current source as FullPlanProof, not an obsolete request identity.
        req["release"]["testedSha"] = RECEIVING_SOURCE
        req["approvedLimits"] = {"cumulativeCeilingRequests": 6700, "identityCap": 98, "runCapRequests": 180, "approvalRef": "PLACEHOLDER-NOT-A-RUN", "approvedBy": "PLACEHOLDER"}
        req["window"] = {"startUtc": "2026-01-01T00:00:00Z", "endUtc": "2099-01-01T00:00:00Z", "approvalRef": "PLACEHOLDER-NOT-A-RUN"}
        req["selectionApprovalRef"] = "PLACEHOLDER-NOT-A-RUN-selection"
        cls.reqp = os.path.join(cls.work, "req.json"); wjson(cls.reqp, req)
        cls.acct = os.path.join(cls.work, "acct.txt"); open(cls.acct, "w").write("00000000-0000-4000-8000-000000000001\n"); os.chmod(cls.acct, 0o600)
        r = run_py("scripts/run_env.py", "--request", cls.reqp, "--out", os.path.join(cls.work, "env.txt"))
        assert r.returncode == 0, r.stdout + r.stderr

    def build(self, name, extra=None, drop=()):
        private = os.path.join(self.work, name)
        script = ("set -euo pipefail; set -a; . %s; set +a; " % os.path.join(self.work, "env.txt"))
        env = {"PATH": os.environ["PATH"], "HOME": self.work, "BP_PACKET": os.path.join(ROOT, "harness"), "BP_CHECKOUT": REPO, "BP_PRIVATE": private,
               "BP_FACTS": os.path.join(ROOT, "tests", "fixtures", "plan-facts.PLACEHOLDER.json"), "BP_ACCOUNT_ID_FILE": self.acct, "BP_LEASE_RPCS": "1", "BP_LEASE_READ": "1",
               "BP_TASK_ID": "PLACEHOLDER-task", "BP_SOURCE_REFERENCE": "https://claude.ai/code/PLACEHOLDER", "BP_ENV_ID": "env_PLACEHOLDER", "BP_MEDIA_PARENT": os.path.join(self.work, "media"),
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
        self.assertEqual(plan["sourceSha"], RECEIVING_SOURCE)

    def job_inputs(self, name):
        review = "UNIT-INDEPENDENT-REVIEW-NOT-A-RUN"
        facts = J("tests", "fixtures", "plan-facts.PLACEHOLDER.json")
        facts["producerReviewReference"] = review
        fp = os.path.join(self.work, name + "-facts.json"); wjson(fp, facts)
        packet = os.path.join(ROOT, "harness")
        receiver = "draft-adapters/receivers/github-job-evidence-reader.cjs"
        descriptor = {"producerIdentity": "github-actions:relativityE/speaksharp:123:1",
                      "producerCodeSha256": sha(open(os.path.join(packet, "bundle/harness/authenticated-job-producer.cjs"), "rb").read()),
                      "receiverSourceSha256": sha(open(os.path.join(packet, receiver), "rb").read()),
                      "receiverRelativePath": receiver, "workflowSourceSha": "b" * 40, "reviewReference": review}
        dp = os.path.join(self.work, name + "-descriptor.json"); wjson(dp, descriptor)
        return {"BP_RUNTIME": "GitHub Actions SpeakSharp", "BP_PRODUCER_MODE": "same-github-job", "BP_PRODUCER_DESCRIPTOR": dp,
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
                    self.assertEqual(producer["producerIdentity"], "github-actions:relativityE/speaksharp:123:1")
                    self.assertEqual(producer["deliveryKind"], "reviewed-authenticated-workflow-artifact")
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
        _, out = self.build("p-other-job", extra=inputs)
        self.assertNotEqual(out[-1].returncode, 0)
        self.assertIn("producer belongs to another job", out[-1].stderr)

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
        cwd = playwright_cwd()
        prerequisite(cwd, "playwright installed from the lockfile (runner/node_modules)")
        private0, _ = self.build("p-0")
        receipt = os.path.join(self.work, "receipt.json")
        r = subprocess.run(["node", os.path.join(ROOT, "harness", "draft-adapters", "stimulus-preflight.cjs"), "--plan", os.path.join(private0, "cfg", "campaign-plan.json"), "--chrome", chrome, "--out", receipt],
                           capture_output=True, text=True, cwd=cwd, env={"PATH": os.environ["PATH"], "HOME": self.work})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        rec = json.load(open(receipt))
        self.assertEqual(rec["productTraffic"], 0)
        c = rec["cases"]["AHT-12"]
        self.assertTrue(c["captureGranted"] and c["speechDetected"] and c["ready"])
        self.assertEqual((c["ungrantedOutcome"], c["noDeviceOutcome"]), ("not-allowed", "not-found"))
        private, out = self.build("p-bound", extra={"BP_STIM": receipt})
        self.assertEqual([o.returncode for o in out], [0, 0], [o.stderr for o in out])
        acc = self.accept(private)
        self.assertEqual(acc.returncode, 0, acc.stdout + acc.stderr)
        self.assertEqual(set(json.loads(acc.stdout).values()), {"ACCEPTED"})
        # negative controls on the receipt
        for label, mutate in (("ungranted request not denied", lambda x: x["cases"]["AHT-12"].update(ungrantedOutcome="granted")),
                              ("capture device not acquired", lambda x: x["cases"]["AHT-12"].update(captureGranted=False))):
            bad = json.loads(json.dumps(rec)); mutate(bad)
            bp = os.path.join(self.work, "bad.json"); wjson(bp, bad)
            pv, _ = self.build("p-bad-" + label.split()[0], extra={"BP_STIM": bp})
            self.assertTrue(json.loads(self.accept(pv).stdout)["stimulus preflight receipt"].startswith("REFUSED"), label)

    # ---- fail closed on missing inputs
    def test_missing_inputs_are_blocked_setup(self):
        for name in ("BP_FACTS", "BP_ACCOUNT_ID_FILE", "BP_TASK_ID", "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CHECKOUT", "BP_SOURCE_SHA", "BP_SELECT_REF"):
            private, out = self.build("p-miss-" + name.lower(), drop=(name,)) if name in ("BP_FACTS", "BP_ACCOUNT_ID_FILE", "BP_TASK_ID", "BP_SOURCE_REFERENCE", "BP_ENV_ID", "BP_CHECKOUT") else (None, None)
            if out is None:
                continue
            self.assertTrue(out[-1].returncode == 78, (name, out[-1].returncode, out[-1].stderr[-200:]))

    def test_a_facts_file_without_required_keys_is_blocked_setup(self):
        bad = json.load(open(os.path.join(ROOT, "tests", "fixtures", "plan-facts.PLACEHOLDER.json")))
        bad.pop("ownerApprovalReference")
        p = os.path.join(self.work, "facts-bad.json"); wjson(p, bad)
        _, out = self.build("p-facts", extra={"BP_FACTS": p})
        self.assertEqual(out[0].returncode, 78)
        self.assertIn("facts file lacks", out[0].stderr)

    def test_the_builder_never_overwrites_an_existing_private_directory(self):
        private, out = self.build("p-twice")
        self.assertEqual(out[-1].returncode, 0)
        _, out2 = self.build("p-twice")
        self.assertNotEqual(out2[0].returncode, 0)


class SecretFreeCleanRoom(unittest.TestCase):
    """Item 4: the GitHub preflight is secret-free with no product traffic. Demonstrated here in a clean room: an empty environment and, where the kernel
    allows, a network namespace with no route at all. (The same steps run on GitHub in the workflow; a run there needs the owner's merge first.)"""
    def run_clean(self, wrapper):
        d = tempfile.mkdtemp(prefix="ct-cr-")
        oc = os.path.join(d, "oc.json"); wjson(oc, {"passed": True})
        out = os.path.join(d, "out")
        cmd = wrapper + [sys.executable, "-I", os.path.join(ROOT, "scripts", "pipeline.py"), "--request", request_path(), "--out-dir", out,
                         "--offline-checks", oc, "--repo", REPO, "--now", NOW, "--generated-at", NOW, "--require-secret-free"]
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
