"""Credential exposure (owner item 5) and the boundary with the model-evaluation project."""
import hashlib
import json
import os
import re
import shlex
import subprocess
import tempfile
import unittest

from _fixtures import REPO, ROOT, J, run_py

SH = os.path.join(ROOT, "scripts", "execute_run.sh")
FORBIDDEN = ("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "STRIPE_SECRET_KEY")
STAGES = ("install-tools", "build-plan", "stimulus-preflight", "build-plan-with-receipt", "gate-and-validate", "reserve", "run", "collect")
# Synthetic unit metadata for the real route validator, never a hosted run claim.
JOB = {"GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp", "GITHUB_RUN_ID": "123",
       "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "offline-unit", "GITHUB_SHA": "a" * 40}


class Credentials(unittest.TestCase):
    def setUp(self):
        self.cfg = J("config", "test-config.v1.json")["credentials"]

    def test_the_service_role_key_is_forbidden_everywhere_and_in_no_stage(self):
        for n in FORBIDDEN:
            self.assertIn(n, self.cfg["forbidden"])
        for stage, names in self.cfg["runEnvironment"]["stages"].items():
            for n in names:
                self.assertNotIn(n, self.cfg["forbidden"], stage)
                self.assertIn(n, self.cfg["runEnvironment"]["names"], stage)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", json.dumps(self.cfg["runEnvironment"]))

    def test_the_harness_itself_forbids_the_service_role_key(self):
        text = open(os.path.join(ROOT, "harness", "bundle", "harness", "admission-core.cjs"), encoding="utf-8").read()
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", text)
        self.assertRegex(text, r"forbidden=\[.*SUPABASE_SERVICE_ROLE_KEY")

    def test_the_github_control_plane_holds_no_credentials(self):
        self.assertEqual((self.cfg["workflowSecrets"], self.cfg["workflowVariables"]), ([], []))

    def test_least_privilege_per_stage(self):
        st = self.cfg["runEnvironment"]["stages"]
        self.assertEqual(st["build-plan"], ["VITE_SUPABASE_ANON_KEY"])
        for s in ("install-tools", "stimulus-preflight", "gate-and-validate", "collect"):
            self.assertEqual(st[s], [], s)
        self.assertEqual(set(st["run"]), {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD", "VITE_SUPABASE_URL",
                                          "VITE_SUPABASE_ANON_KEY"})
        for s, names in st.items():
            if s != "run":
                self.assertNotIn("THROWAWAY_TEST_PASSWORD", names, s)

    def test_every_credential_has_a_stated_reason(self):
        for n in self.cfg["runEnvironment"]["names"]:
            self.assertTrue(self.cfg["runEnvironment"]["why"].get(n), n)

    def test_stage_env_refuses_undeclared_stages_and_forbidden_names(self):
        r = run_py("scripts/stage_env.py", os.path.join(ROOT, "config/test-config.v1.json"), "nope")
        self.assertNotEqual(r.returncode, 0)
        bad = J("config", "test-config.v1.json")
        bad["credentials"]["runEnvironment"]["stages"]["build-plan"] = ["SUPABASE_SERVICE_ROLE_KEY"]
        p = os.path.join(tempfile.mkdtemp(), "c.json")
        with open(p, "w") as f:
            json.dump(bad, f)
        self.assertNotEqual(run_py("scripts/stage_env.py", p, "build-plan").returncode, 0)

    def test_every_noneligible_route_and_stage_refuses_forbidden_keys(self):
        with tempfile.TemporaryDirectory(prefix="ct-credential-contract-") as d:
            request = os.path.join(d, "synthetic-request.json")
            for route, runtime, case in (("claude", "Claude SpeakSharp R4", "AHT-08"),
                                         ("github-direct", "GitHub Actions SpeakSharp", "AHT-15"),
                                         ("github-producer", "GitHub Actions SpeakSharp", "AHT-08")):
                with open(request, "w") as f:
                    json.dump({"executionRuntime": runtime, "selection": [{"case": case}]}, f)
                for n in FORBIDDEN:
                    for stage in STAGES:
                        # The one fixed producer parent is covered separately;
                        # preparation and arbitrary run children never qualify.
                        if n == "SUPABASE_SERVICE_ROLE_KEY" and route == "github-producer" and stage == "run":
                            continue
                        env = {"PATH": os.environ["PATH"], "HOME": d, "CT_CONFIG": os.path.join(ROOT, "config/test-config.v1.json"),
                               "CT_OUT": os.path.join(d, "out"), "CT_REQUEST": request, n: "value-not-printed", **JOB}
                        r = subprocess.run(["bash", SH, stage], capture_output=True, text=True, env=env)
                        self.assertEqual(r.returncode, 78, (n, route, stage, r.stderr))
                        self.assertIn("BLOCKED_SETUP", r.stderr)
                        expected = "service role belongs only to the selected same-job producer run parent" if n == "SUPABASE_SERVICE_ROLE_KEY" else n + " is present; forbidden"
                        self.assertIn(expected, r.stderr, (route, stage))
                        self.assertNotIn("value-not-printed", r.stdout + r.stderr)

    def run_stage_env(self, stage, env, route="claude", fixed_parent=False, selected_cases=None):
        """Run the real run_stage() function and report which variable NAMES reach the stage (never values)."""
        script = open(SH, encoding="utf-8").read()
        fn = re.search(r"run_stage\(\) \{.*?\n\}\n", script, re.S).group(0)
        with tempfile.TemporaryDirectory(prefix="ct-stage-env-") as d:
            packet, out = os.path.join(d, "packet"), os.path.join(d, "out")
            request = os.path.join(d, "request.json")
            cases = ["AHT-%02d" % n for n in range(1, 16)] if selected_cases is None else selected_cases
            with open(request, "w", encoding="utf-8") as f:
                json.dump({"selection": [{"case": case} for case in cases]}, f)
            command = "bash -c 'env | cut -d= -f1 | sort'"
            path = os.environ["PATH"]
            if fixed_parent:
                node = os.path.join(d, "node")
                with open(node, "w") as f:
                    f.write("#!/bin/sh\nenv | cut -d= -f1 | sort\n")
                os.chmod(node, 0o700)
                path = d + os.pathsep + path
                scope = os.path.join(out, "plan", "producer-scope.json")
                if fixed_parent == "wrong-scope":
                    scope += ".other"
                args = ["node", os.path.join(packet, "bundle/harness/with-authenticated-evidence.cjs"),
                        "--scope", scope, "--scope-sha256", "a" * 64,
                        "--plan", os.path.join(out, "plan/cfg/campaign-plan.json"), "--plan-sha256", "b" * 64]
                if fixed_parent in ("reused-admission", "wrong-admission", "missing-admission-digest"):
                    receipt = os.path.join(out, "plan/run/admission/admission-receipt.json")
                    args += ["--admission-receipt", receipt + (".other" if fixed_parent == "wrong-admission" else "")]
                    if fixed_parent != "missing-admission-digest":
                        args += ["--admission-receipt-sha256", "c" * 64]
                command = shlex.join(args)
            harness = ("set -euo pipefail\nROOT=%r\nCFG=%r\nREQ=%r\nROUTE=%r\nHP=%r\nOUT=%r\n"
                       "ss_broker_service_role=\"${SUPABASE_SERVICE_ROLE_KEY:-}\"\n"
                       "ss_broker_telemetry_key=\"${POSTHOG_PERSONAL_API_KEY:-}\"\n"
                       "export -n ss_broker_service_role ss_broker_telemetry_key\n"
                       "unset SUPABASE_SERVICE_ROLE_KEY POSTHOG_PERSONAL_API_KEY\n"
                       "PYENV=(\"PATH=$PATH\" \"HOME=/tmp\")\nblocked() { echo \"BLOCKED_SETUP: $*\" >&2; exit 78; }\n%s\nrun_stage %s %s\n") % (
                           ROOT, os.path.join(ROOT, "config", "test-config.v1.json"), request, route, packet, out, fn, stage, command)
            return subprocess.run(["bash", "-c", harness], capture_output=True, text=True, env={**JOB, **env, "PATH": path})

    def test_a_stage_receives_only_its_allowlisted_credentials(self):
        env = {"FREE_TEST_EMAIL": "fe", "FREE_TEST_PASSWORD": "fp", "THROWAWAY_TEST_EMAIL": "e", "THROWAWAY_TEST_PASSWORD": "p", "VITE_SUPABASE_URL": "https://project.supabase.co",
               "VITE_SUPABASE_ANON_KEY": "k", "SUPABASE_SERVICE_ROLE_KEY": "s", "STRIPE_SECRET_KEY": "x", "AWS_SECRET_ACCESS_KEY": "a", "GH_TOKEN": "g"}
        for stage, expected in (("build-plan", {"VITE_SUPABASE_ANON_KEY"}), ("install-tools", set()), ("stimulus-preflight", set()), ("gate-and-validate", set()),
                                ("run", {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"})):
            r = self.run_stage_env(stage, env)
            self.assertEqual(r.returncode, 0, r.stderr)
            names = set(r.stdout.split())
            leaked = names & {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "STRIPE_SECRET_KEY", "AWS_SECRET_ACCESS_KEY", "GH_TOKEN"}
            self.assertEqual(leaked, expected, stage)

    def test_a_stage_that_needs_a_credential_fails_when_it_is_missing(self):
        r = self.run_stage_env("run", {"THROWAWAY_TEST_EMAIL": "e"})
        self.assertEqual(r.returncode, 78)

    def test_run_stage_requires_only_the_selected_account_roles(self):
        env = {"FREE_TEST_EMAIL": "fe", "FREE_TEST_PASSWORD": "fp", "THROWAWAY_TEST_EMAIL": "e",
               "THROWAWAY_TEST_PASSWORD": "p", "VITE_SUPABASE_URL": "https://project.supabase.co",
               "VITE_SUPABASE_ANON_KEY": "k"}
        roles = {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD"}
        for cases, expected in ((["AHT-01"], {"THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD"}),
                                (["AHT-15"], {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"}),
                                (["AHT-01", "AHT-15"], roles)):
            with self.subTest(cases=cases):
                r = self.run_stage_env("run", env, selected_cases=cases)
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(set(r.stdout.split()) & roles, expected)

    def test_run_stage_refuses_without_a_valid_selected_case_list(self):
        env = {"VITE_SUPABASE_URL": "https://project.supabase.co", "VITE_SUPABASE_ANON_KEY": "k"}
        for cases in ([], ["AHT-16"], ["AHT-01", "AHT-01"]):
            with self.subTest(cases=cases):
                self.assertNotEqual(self.run_stage_env("run", env, selected_cases=cases).returncode, 0)

    def test_even_producer_route_arbitrary_children_receive_no_broker_keys(self):
        env = {"FREE_TEST_EMAIL": "fe", "FREE_TEST_PASSWORD": "fp", "THROWAWAY_TEST_EMAIL": "e", "THROWAWAY_TEST_PASSWORD": "p", "VITE_SUPABASE_URL": "https://project.supabase.co", "VITE_SUPABASE_ANON_KEY": "k",
               "SUPABASE_SERVICE_ROLE_KEY": "not-exported-service", "POSTHOG_PERSONAL_API_KEY": "not-exported-telemetry",
               "ss_broker_service_role": "not-exported-service", "ss_broker_telemetry_key": "not-exported-telemetry"}
        for route in ("claude", "github-direct", "github-producer"):
            for stage in self.cfg["runEnvironment"]["stages"]:
                r = self.run_stage_env(stage, env, route=route)
                self.assertEqual(r.returncode, 0, (route, stage, r.stderr))
                self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", r.stdout)
                self.assertNotIn("POSTHOG_PERSONAL_API_KEY", r.stdout)
                self.assertNotIn("ss_broker_service_role", r.stdout)
                self.assertNotIn("ss_broker_telemetry_key", r.stdout)
                self.assertNotIn("not-exported-", r.stdout + r.stderr)

    def test_only_fixed_producer_run_command_receives_broker_keys(self):
        env = {"FREE_TEST_EMAIL": "fe", "FREE_TEST_PASSWORD": "fp", "THROWAWAY_TEST_EMAIL": "e", "THROWAWAY_TEST_PASSWORD": "p", "VITE_SUPABASE_URL": "https://project.supabase.co", "VITE_SUPABASE_ANON_KEY": "k",
               "SUPABASE_SERVICE_ROLE_KEY": "not-printed-service", "POSTHOG_PERSONAL_API_KEY": "not-printed-telemetry",
               "AWS_SECRET_ACCESS_KEY": "not-printed-aws", "GH_TOKEN": "not-printed-github"}
        r = self.run_stage_env("run", env, route="github-producer", fixed_parent=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        names = set(r.stdout.split())
        self.assertTrue({"SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"} <= names)
        self.assertFalse({"ss_broker_service_role", "ss_broker_telemetry_key", "AWS_SECRET_ACCESS_KEY", "GH_TOKEN"} & names)
        self.assertNotIn("not-printed-", r.stdout + r.stderr)
        denied = self.run_stage_env("run", env, route="github-producer", fixed_parent="wrong-scope")
        self.assertEqual(denied.returncode, 0, denied.stderr)
        self.assertFalse({"SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"} & set(denied.stdout.split()))
        self.assertNotIn("not-printed-", denied.stdout + denied.stderr)

        reused = self.run_stage_env("run", env, route="github-producer", fixed_parent="reused-admission")
        self.assertEqual(reused.returncode, 0, reused.stderr)
        self.assertTrue({"SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"} <= set(reused.stdout.split()))
        for malformed in ("wrong-admission", "missing-admission-digest"):
            with self.subTest(malformed=malformed):
                result = self.run_stage_env("run", env, route="github-producer", fixed_parent=malformed)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertFalse({"SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"} & set(result.stdout.split()))
                self.assertNotIn("not-printed-", result.stdout + result.stderr)

    def test_the_service_role_key_appears_only_where_it_is_forbidden_or_explained(self):
        allowed = ("config/test-config.v1.json", "scripts/execute_run.sh", "scripts/pipeline.py", "tests/", "README.md", "WORKFLOW.md", "CHANGELOG.md", "CREDENTIALS.md", "harness/", "report/", "templates/", "NEXT-RUN-PROPOSAL.md", "samples/", "config/history/")
        offenders = []
        for r, _, fs in os.walk(ROOT):
            for fn in fs:
                rel = os.path.relpath(os.path.join(r, fn), ROOT)
                if rel.startswith(allowed) or fn.endswith((".pyc", ".html", ".sha256")):
                    continue
                try:
                    if "SERVICE_ROLE" in open(os.path.join(r, fn), encoding="utf-8").read():
                        offenders.append(rel)
                except UnicodeDecodeError:
                    pass
        self.assertEqual(offenders, [])
        wf = os.path.join(REPO, ".github", "workflows", "cloud-test.yml")
        if os.path.exists(wf):
            self.assertNotIn("SERVICE_ROLE", open(wf).read())


class Boundary(unittest.TestCase):
    """The model-evaluation project stays entirely separate: nothing here references its workflows, gates or authorizations."""
    TOKENS = ("model-downselection", "private-model-smoke", "gemini-model-currency", "comparison_cell", "comparison-authorization", "downselection", "rwt_writes_ack")
    RETAINED = {
        "case-costs": "case-costs.json",
        "comparison-prior": "comparison-prior.json",
        "gap-ledger": "gap-ledger.json",
        "prior-run-verification": "prior-run-verification.json",
    }

    @classmethod
    def boundary_offenders(cls, root):
        # Retained comparison evidence can truthfully name the historical
        # producer that created it.  Exempt only files listed by the digest-
        # pinned aggregate manifest; executable code, the manifest itself and
        # any unlisted file under config/aggregate remain inside this boundary.
        manifest_path = os.path.join(root, "config", "aggregate", "manifest.json")
        manifest_raw = open(manifest_path, "rb").read()
        aggregate = json.loads(manifest_raw)
        with open(os.path.join(root, "config", "test-config.v1.json"), encoding="utf-8") as f:
            receiver = (json.load(f).get("aggregateReceiver") or {})
        retained = set()
        entries = aggregate.get("components") or {}
        root_rows = [{"name": name, "sha256": entries.get(name, {}).get("sha256")} for name in sorted(entries)]
        component_root = hashlib.sha256(json.dumps(root_rows, sort_keys=True, separators=(",", ":")).encode("ascii")).hexdigest()
        valid_manifest = (
            receiver.get("activated") is True
            and hashlib.sha256(manifest_raw).hexdigest() == receiver.get("manifestSha256")
            and aggregate.get("schema") == "speaksharp.cloud-test.aggregate-receiver.v2-occurrence"
            and set(entries) == set(cls.RETAINED)
            and component_root == aggregate.get("bundleRootSha256") == receiver.get("bundleRootSha256")
        )
        if valid_manifest:
            for name, filename in cls.RETAINED.items():
                entry = entries[name]
                path = os.path.join(root, "config", "aggregate", filename)
                if (set(entry) == {"file", "sha256"} and entry.get("file") == filename
                        and os.path.isfile(path) and not os.path.islink(path)
                        and hashlib.sha256(open(path, "rb").read()).hexdigest() == entry.get("sha256")):
                    retained.add(os.path.relpath(path, root))
        offenders = []
        for r, _, fs in os.walk(root):
            if os.sep + "harness" in r or os.sep + "report" + os.sep + "tests" in r or os.sep + "tests" in r or os.sep + "history" in r or os.sep + "samples" in r:
                continue
            for fn in fs:
                if not fn.endswith((".py", ".sh", ".json", ".cjs")):
                    continue
                rel = os.path.relpath(os.path.join(r, fn), root)
                if rel in retained:
                    continue
                text = open(os.path.join(r, fn), encoding="utf-8").read()
                if fn == "test-config.v1.json":
                    cfg = json.loads(text); cfg.pop("boundary", None); text = json.dumps(cfg)
                for t in cls.TOKENS:
                    if t in text:
                        offenders.append((rel, t))
        return offenders

    def test_package_code_and_config_do_not_reference_the_model_evaluation_project(self):
        self.assertEqual(self.boundary_offenders(ROOT), [])

    def test_only_manifest_listed_retained_evidence_gets_the_narrow_exception(self):
        with tempfile.TemporaryDirectory() as root:
            aggregate = os.path.join(root, "config", "aggregate")
            os.makedirs(aggregate)
            retained_bytes = b'{"historicalProducer":"model-downselection"}'
            payloads = {name: (retained_bytes if name == "comparison-prior" else b'{}') for name in self.RETAINED}
            entries = {name: {"file": filename, "sha256": hashlib.sha256(payloads[name]).hexdigest()}
                       for name, filename in self.RETAINED.items()}
            rows = [{"name": name, "sha256": entries[name]["sha256"]} for name in sorted(entries)]
            root_sha = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("ascii")).hexdigest()
            manifest = {"schema": "speaksharp.cloud-test.aggregate-receiver.v2-occurrence", "components": entries,
                        "bundleRootSha256": root_sha}
            manifest_bytes = json.dumps(manifest).encode()
            with open(os.path.join(aggregate, "manifest.json"), "w", encoding="utf-8") as f:
                f.write(manifest_bytes.decode())
            with open(os.path.join(root, "config", "test-config.v1.json"), "w", encoding="utf-8") as f:
                json.dump({"aggregateReceiver": {"activated": True, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                                                  "bundleRootSha256": root_sha}}, f)
            for name, filename in self.RETAINED.items():
                with open(os.path.join(aggregate, filename), "wb") as f:
                    f.write(payloads[name])
            with open(os.path.join(aggregate, "unlisted.json"), "w", encoding="utf-8") as f:
                f.write('{"runtime":"model-downselection"}')
            self.assertEqual(self.boundary_offenders(root), [(os.path.join("config", "aggregate", "unlisted.json"), "model-downselection"),
                                                             (os.path.join("config", "aggregate", "unlisted.json"), "downselection")])
            with open(os.path.join(aggregate, "comparison-prior.json"), "w", encoding="utf-8") as f:
                f.write('{"historicalProducer":"model-downselection","changed":true}')
            self.assertIn((os.path.join("config", "aggregate", "comparison-prior.json"), "model-downselection"), self.boundary_offenders(root))

    def test_traversal_or_executable_manifest_entries_never_gain_the_retained_exception(self):
        with tempfile.TemporaryDirectory() as root:
            aggregate = os.path.join(root, "config", "aggregate")
            scripts = os.path.join(root, "config", "scripts")
            os.makedirs(aggregate); os.makedirs(scripts)
            runtime = b'# model-downselection executable\n'
            runtime_path = os.path.join(scripts, "runtime.py")
            with open(runtime_path, "wb") as f:
                f.write(runtime)
            entries = {name: {"file": filename, "sha256": hashlib.sha256(b'{}').hexdigest()}
                       for name, filename in self.RETAINED.items()}
            entries["comparison-prior"] = {"file": "../scripts/runtime.py", "sha256": hashlib.sha256(runtime).hexdigest()}
            for name, filename in self.RETAINED.items():
                if name != "comparison-prior":
                    with open(os.path.join(aggregate, filename), "wb") as f:
                        f.write(b'{}')
            rows = [{"name": name, "sha256": entries[name]["sha256"]} for name in sorted(entries)]
            root_sha = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode("ascii")).hexdigest()
            manifest = {"schema": "speaksharp.cloud-test.aggregate-receiver.v2-occurrence", "components": entries,
                        "bundleRootSha256": root_sha}
            manifest_bytes = json.dumps(manifest).encode()
            with open(os.path.join(aggregate, "manifest.json"), "wb") as f:
                f.write(manifest_bytes)
            with open(os.path.join(root, "config", "test-config.v1.json"), "w", encoding="utf-8") as f:
                json.dump({"aggregateReceiver": {"activated": True, "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
                                                  "bundleRootSha256": root_sha}}, f)
            self.assertIn((os.path.join("config", "scripts", "runtime.py"), "model-downselection"), self.boundary_offenders(root))

    def test_the_config_states_the_boundary(self):
        b = J("config", "test-config.v1.json").get("boundary") or {}
        self.assertIn("model evaluation", b.get("statement", "").lower())
        self.assertIn("private-model-smoke.yml", b.get("separateWorkflows", []))

    def test_the_package_never_dispatches_other_workflows(self):
        for r, _, fs in os.walk(os.path.join(ROOT, "scripts")):
            for fn in fs:
                if not fn.endswith((".py", ".sh")):
                    continue
                text = open(os.path.join(r, fn), encoding="utf-8").read()
                self.assertNotIn("gh workflow", text, fn)
                self.assertNotIn("workflow_dispatch", text, fn)


NETWORK_IMPORT = re.compile(r"^\s*(import|from)\s+(socket|urllib|http|requests|ssl|ftplib|smtplib|aiohttp|httpx|websocket)\b", re.M)
NETWORK_ALLOWED = {"install_browser.py", "_netguard.py"}
# Sam 1793583857.461789 (narrow A): the ONE admitted Case 10 transport is exempt by its exact path under the package root, never by basename;
# it runs only as its own `-I` subprocess, while every control-plane process keeps the guard.
ADMITTED_TRANSPORT = os.path.join("scripts", "case10_reader.py")
GUARD_EXEMPT = ("_netguard.py", "_common.py", "install_browser.py", "cfg_get.py", "stage_env.py", "stimulus_preflight_retry.py", "case_start_caps.py")


def network_offenders(root):
    offenders = []
    for sub in ("scripts", "report", "harness-adapter"):
        for r, _, fs in os.walk(os.path.join(root, sub)):
            for fn in fs:
                rel = os.path.relpath(os.path.join(r, fn), root)
                if fn.endswith(".py") and fn not in NETWORK_ALLOWED and rel != ADMITTED_TRANSPORT and "tests" not in r:
                    if NETWORK_IMPORT.search(open(os.path.join(r, fn), encoding="utf-8").read()):
                        offenders.append(rel)
    return offenders


def unguarded(root):
    found = []
    for fn in os.listdir(os.path.join(root, "scripts")):
        if fn.endswith(".py") and fn not in GUARD_EXEMPT and os.path.join("scripts", fn) != ADMITTED_TRANSPORT:
            text = open(os.path.join(root, "scripts", fn), encoding="utf-8").read()
            if not ("from _common import" in text or "import _netguard" in text or "import _common" in text or "from verify_receipts import" in text):
                found.append(fn)
    return found


class NoNetworkImports(unittest.TestCase):
    def test_only_the_run_environment_browser_installer_may_use_the_network(self):
        self.assertEqual(network_offenders(ROOT), [])

    def test_every_control_plane_script_loads_the_guard(self):
        self.assertEqual(unguarded(ROOT), [])

    def test_the_admitted_transport_is_exempt_by_exact_path_only_and_every_other_module_still_fails_both_checks(self):
        d = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, d)
        net = "import urllib.request\n"
        for rel in (ADMITTED_TRANSPORT, os.path.join("report", "case10_reader.py"), os.path.join("harness-adapter", "case10_reader.py"),
                    os.path.join("scripts", "other_reader.py"), os.path.join("scripts", "nested", "case10_reader.py")):
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            with open(os.path.join(d, rel), "w", encoding="utf-8") as f:
                f.write(net)
        # a duplicate basename anywhere else is still an offender; only the exact path is admitted
        self.assertEqual(sorted(network_offenders(d)), sorted([os.path.join("report", "case10_reader.py"),
                         os.path.join("harness-adapter", "case10_reader.py"), os.path.join("scripts", "other_reader.py"),
                         os.path.join("scripts", "nested", "case10_reader.py")]))
        self.assertEqual(unguarded(d), ["other_reader.py"])

if __name__ == "__main__":
    unittest.main()
