"""The no-network egress readiness preflight (Sam 1794156633 / 1794156711 / 1794156723): before any credential-bearing or production prerequisite
step, the live job checks the env-proxy requirement exactly as the guard will see it after execute_run.sh run_stage (uppercase-only forwarding),
records closed booleans and a closed reason (never values, never a reachability claim), retains the receipt even on refusal, and an early
failure at that step settles through the EXISTING unexecuted accounting path as `none` (measured runner minutes, zero product counters)."""
import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT  # noqa: F401  (puts scripts/ on sys.path)
import egress_preflight as E
import unexecuted_attempt_evidence as U

REPO = os.path.abspath(os.path.join(ROOT, "..", ".."))
WORKFLOW = os.path.join(REPO, ".github", "workflows", "cloud-test-live.yml")
POLICY = {"upstream": {"mode": "env-proxy"}, "hosts": {"speaksharp-public.vercel.app": {}, "yxlapjuovrsvjswkwnrk.supabase.co": {}}}
PROXY = "http://user:s3cr3t@proxy.internal.example:3128"


class Verdict(unittest.TestCase):
    def test_the_closed_readiness_table(self):
        cases = {
            "no proxy at all (the GitHub runner today)": ({}, "proxy-not-configured", False),
            "lowercase only: lost at the run_stage boundary": ({"https_proxy": PROXY}, "proxy-lowercase-only", False),
            "invalid proxy": ({"HTTPS_PROXY": "not a url"}, "proxy-invalid", False),
            "ftp is not an http(s) proxy": ({"HTTPS_PROXY": "ftp://proxy.example"}, "proxy-invalid", False),
            "NO_PROXY suffix matches a policy host": ({"HTTPS_PROXY": PROXY, "NO_PROXY": ".supabase.co"}, "no-proxy-matches-policy-host", False),
            "NO_PROXY *.suffix matches": ({"HTTPS_PROXY": PROXY, "NO_PROXY": "*.vercel.app"}, "no-proxy-matches-policy-host", False),
            "lowercase no_proxy is not forwarded, so it cannot exempt": ({"HTTPS_PROXY": PROXY, "no_proxy": ".supabase.co"}, "ready", True),
            "uppercase proxy set and valid": ({"HTTPS_PROXY": PROXY, "NO_PROXY": "localhost,127.0.0.1"}, "ready", True),
        }
        for label, (env, reason, ready) in cases.items():
            with self.subTest(label):
                v = E.evaluate(POLICY, env)
                self.assertEqual((v["reason"], v["ready"]), (reason, ready))
                self.assertIn(v["reason"], E.REASONS)
                for leak in ("s3cr3t", "proxy.internal", "3128", "user"):
                    self.assertNotIn(leak, json.dumps(v))

    def test_proxy_syntax_has_parity_with_the_guards_url_parser(self):
        """Sam 1794159106: the receipt must not report ready for a proxy the guard's `new URL` rejects (an out-of-range port)."""
        samples = ["http://proxy.example:3128", "https://proxy.example", "http://proxy.example:65535", "http://proxy.example:65536",
                   "http://proxy.invalid:99999", "http://proxy.example:0", "http://user:pw@proxy.example:8080/", "http://[::1]:3128",
                   "ftp://proxy.example", "not a url", "http://", "proxy.example:3128",
                   "http://[1:2:3]:3128", "http://[::ffff:127.0.0.1]:3128", "http://[fe80::1]:8080", "http://[zz::1]:3128"]
        for s in ("http://proxy.invalid:99999", "http://proxy.example:65536", "http://[1:2:3]:3128"):
            self.assertEqual(E.evaluate(POLICY, {"HTTPS_PROXY": s})["reason"], "proxy-invalid", s)
        self.assertEqual(E.evaluate(POLICY, {"HTTPS_PROXY": "http://proxy.example:65535"})["reason"], "ready")
        import shutil
        node = shutil.which("node")
        if node is None:
            self.skipTest("node not available for the parser-parity check")
        script = ("const xs=JSON.parse(process.argv[1]);console.log(JSON.stringify(xs.map(x=>{try{const u=new URL(x);"
                  "return (u.protocol==='http:'||u.protocol==='https:')&&!!u.hostname;}catch{return false;}})))")
        r = subprocess.run([node, "-e", script, json.dumps(samples)], capture_output=True, text=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual([E.valid_proxy(s) for s in samples], json.loads(r.stdout), "egress readiness agrees with the guard's URL parser")

    def test_a_policy_that_is_not_env_proxy_needs_no_proxy(self):
        self.assertEqual(E.evaluate({"upstream": {"mode": "direct"}, "hosts": {}}, {})["reason"], "ready")
        self.assertEqual(E.evaluate({"upstream": {"mode": "socks"}, "hosts": {}}, {})["upstreamMode"], "other")

    def test_the_committed_production_policy_is_env_proxy_over_its_hosts(self):
        with open(E.POLICY, encoding="utf-8") as f:
            p = json.load(f)
        self.assertEqual(p["upstream"]["mode"], "env-proxy")
        self.assertEqual(E.evaluate(p, {})["reason"], "proxy-not-configured")

    def test_the_cli_writes_the_bound_receipt_even_on_refusal_and_never_a_value(self):
        script = os.path.join(ROOT, "scripts", "egress_preflight.py")
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "egress.json")
            env = {"PATH": os.environ.get("PATH", ""), "https_proxy": PROXY, "GITHUB_ACTIONS": "true", "GITHUB_JOB": "live"}
            r = subprocess.run([sys.executable, "-I", script, "--run-id", "42999999999", "--attempt", "1", "--source-sha", "a" * 40, "--out", out],
                               capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 78)
            self.assertIn("BLOCKED_SETUP: egress-preflight:proxy-lowercase-only", r.stderr)
            with open(out, encoding="utf-8") as f:
                raw = f.read()
            doc = json.loads(raw)
            self.assertEqual({k: doc[k] for k in ("schema", "runtime", "runId", "attempt", "job", "sourceSha", "ready", "reason", "reachabilityChecked",
                                                  "policyReviewed")},
                             {"schema": E.SCHEMA, "runtime": E.RUNTIME, "runId": "42999999999", "attempt": 1, "job": "live", "sourceSha": "a" * 40,
                              "ready": False, "reason": "proxy-lowercase-only", "reachabilityChecked": False, "policyReviewed": True})
            self.assertRegex(doc["observedAt"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
            self.assertEqual(doc["policySha256"], E.reviewed_policy_sha256())
            for leak in ("s3cr3t", "proxy.internal", "3128"):
                self.assertNotIn(leak, raw + r.stdout + r.stderr)
            env = {"PATH": os.environ.get("PATH", ""), "HTTPS_PROXY": PROXY}
            r = subprocess.run([sys.executable, "-I", script, "--run-id", "42999999999", "--attempt", "1", "--source-sha", "a" * 40, "--out", out],
                               capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(out, encoding="utf-8") as f:
                self.assertTrue(json.load(f)["ready"])
            # a policy that is not the reviewed one is never evidence of readiness, even with a valid proxy
            other = os.path.join(d, "policy.json")
            with open(other, "w", encoding="utf-8") as f:
                json.dump({"upstream": {"mode": "env-proxy"}, "hosts": {"a.test": {}}}, f)
            r = subprocess.run([sys.executable, "-I", script, "--run-id", "42999999999", "--attempt", "1", "--source-sha", "a" * 40, "--out", out,
                                "--policy", other], capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 78)
            with open(out, encoding="utf-8") as f:
                doc = json.load(f)
            self.assertEqual((doc["reason"], doc["policyReviewed"], doc["runtime"]), ("policy-not-reviewed", False, "other"))


class WorkflowPlacement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import yaml
        with open(WORKFLOW, encoding="utf-8") as f:
            cls.text = f.read()
        cls.steps = yaml.safe_load(cls.text)["jobs"]["live"]["steps"]

    def names(self):
        return [s.get("name") or "Run " + s.get("uses", "") for s in self.steps]

    def test_the_preflight_runs_right_after_checkout_before_every_credential_bearing_step_with_no_secret(self):
        names = self.names()
        i = names.index("Egress readiness preflight (no network; closed receipt)")
        # the PO-approved loopback egress service (2026-11-08) starts right after checkout, so the preflight judges the proxy it exports
        self.assertEqual(names[i - 2:i], ["Run actions/checkout@v6", "Start the restrictive loopback CONNECT egress service (PO-approved; no secret)"])
        step = self.steps[i]
        self.assertNotIn("secrets.", json.dumps(step))
        # its only env is the PO-approved loopback service URL, a step output (Sam 1794168880: never $GITHUB_ENV)
        self.assertEqual(step.get("env"), {"HTTPS_PROXY": "${{ steps.egress-proxy.outputs.url }}"})
        self.assertIn("egress_preflight.py", step["run"])
        credential = [n for _job, n in U.credential_steps(self.text)]
        self.assertTrue(credential and all(names.index(n) > i for n in credential))
        self.assertNotIn(names[i - 1], credential)
        self.assertNotIn(names[i], credential)
        keep = self.steps[i + 1]
        self.assertEqual((keep["if"], keep["uses"], keep["with"]["path"]), ("always()", "actions/upload-artifact@v4", "${{ runner.temp }}/egress-preflight.json"))
        # the PO's one-day artifact rule (Sam 1794158685.923749)
        self.assertEqual((keep["with"]["retention-days"], keep["with"]["if-no-files-found"]), (1, "error"))


class EarlyFailureAccounting(unittest.TestCase):
    """The exact current workflow: a live job that fails at the egress preflight settles through the existing rule as `none` (no new
    accounting rule; not inferred from the failed step alone: every credential-bearing step derived from this workflow is skipped)."""

    def test_a_failure_at_the_egress_preflight_is_accounting_none_with_measured_runner_minutes(self):
        import yaml
        import test_unexecuted_attempt_evidence as T
        with open(WORKFLOW, encoding="utf-8") as f:
            wf = f.read()
        steps = yaml.safe_load(wf)["jobs"]["live"]["steps"]
        names = [s.get("name") or "Run " + s.get("uses", "") for s in steps]
        failed = names.index("Egress readiness preflight (no network; closed receipt)")
        rows = [{"number": 1, "name": "Set up job", "status": "completed", "conclusion": "success"}]
        for k, (name, step) in enumerate(zip(names, steps)):
            if k < failed:
                conclusion = "success"
            elif k == failed:
                conclusion = "failure"
            else:
                conclusion = "success" if "always()" in str(step.get("if", "")) else "skipped"
            rows.append({"number": k + 2, "name": name, "status": "completed", "conclusion": conclusion})
        rows.append({"number": len(rows) + 1, "name": "Complete job", "status": "completed", "conclusion": "success"})
        jobs = copy.deepcopy(T.load("jobs-41960376782.json"))
        live = next(j for j in jobs["jobs"] if j["name"] == T.LIVE)
        live["steps"] = rows
        doc = U.build_evidence(T.load("run-41960376782.json"), jobs, T.chain(), wf)
        digest, usage, _at = U.check_evidence(doc)
        self.assertEqual(doc["accounting"], "none")
        self.assertEqual({k: usage[k] for k in U.PRODUCT_KEYS}, {k: 0 for k in U.PRODUCT_KEYS})
        self.assertGreater(usage["runnerMinutes"], 0)
        # the same shape with the prerequisite preflight having run is NOT none: the rule follows the credential-bearing steps
        ran = copy.deepcopy(jobs)
        live = next(j for j in ran["jobs"] if j["name"] == T.LIVE)
        for row in live["steps"]:
            if row["name"] == U.PREFLIGHT_STEP:
                row["conclusion"] = "success"
        with self.assertRaises(U.Refused):
            U.build_evidence(T.load("run-41960376782.json"), ran, T.chain(), wf)


if __name__ == "__main__":
    unittest.main()
