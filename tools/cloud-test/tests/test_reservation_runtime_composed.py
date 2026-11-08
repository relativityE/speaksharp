"""Sam 1794118744: the composed test-only local-Git increment for the run stage's reservation runtime check. MOCKED TRANSPORT, NOT LIVE PROOF.

What is real: the exact shell text of execute_run.sh (route selection, PYENV, run_stage with its env -i / allowlist sanitization, the retained
plan-digest check, the check-plan and pre-start command lines, the runner branch), bash expansion of those lines, `python3 -I`, the unmodified
reservation_runtime_check / check_gates / state_ref_writer functions, a real `git fetch` and validate_chain over real Git objects.

What is substituted, only here: (1) a PRIVATE TEMPORARY COPY of tools/cloud-test/scripts whose state_ref_writer.py differs from production in
exactly two constants, APPROVED_URL (an absolute path of a temporary bare repository; _transport accepts an absolute path, not file://) and
REVIEWED_ROOT; the test proves every other byte equal and the production file unchanged. (2) The journal: FIXTURE COMMITS, built here with
state_ref_writer's own deterministic child construction from the PRESERVED ledger bytes of run 42423408284 (tests/fixtures/
completion-42423408284/journal-tail.json). Their ids are NOT the original production commits; root, parent and head are derived from these
objects. (3) The packet's runner is a sentinel that only records that it started. (4) Only the run-stage segments are composed: the receiver,
pipeline and plan-acceptance steps between them are not executed here, and check-plan runs in production only on the retained-manifest path.
(5) The run stage's allowlisted credential NAMES carry inert placeholders, so no credential exists; nothing reads them. No network.

Every refusal must be the intended code (exit 78 from the wrapped command, the stage stops under set -e) and the runner sentinel must not exist."""
import base64
import difflib
import filecmp
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

from _fixtures import ROOT
import init_run_inputs as I
import state_ref_writer as W

FIX = os.path.join(ROOT, "tests", "fixtures", "completion-42423408284")
TAIL = json.load(open(os.path.join(FIX, "journal-tail.json")))
PARENT_RAW, HEAD_RAW = base64.b64decode(TAIL[0]["ledgerB64"]), base64.b64decode(TAIL[1]["ledgerB64"])
PARENT_EVENTS, HEAD_EVENTS = W.parse_ledger(PARENT_RAW), W.parse_ledger(HEAD_RAW)
OCCURRENCE = open(os.path.join(FIX, "occurrence.json"), "rb").read()
REQ_SHA = hashlib.sha256(OCCURRENCE).hexdigest()
RUN, CAMPAIGN = "42423408284", "R10-3b040043-smoke15"
OWN = (CAMPAIGN, RUN, 1, REQ_SHA)
TESTED = "5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2"
PLACEHOLDER = "UNIT-PLACEHOLDER-NOT-A-CREDENTIAL"
GIT_ENV = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "LC_ALL": "C"}
SCRIPT = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()


def git(repo, *a, data=None, env=None):
    return subprocess.run(["git", "-C", repo, *a], input=data, capture_output=True, check=True, env={**GIT_ENV, **(env or {})}).stdout.decode().strip()


def _between(start, end_marker, start_from=0, inclusive=True):
    i = SCRIPT.index(start, start_from)
    i = SCRIPT.rindex("\n", 0, i) + 1
    j = SCRIPT.index(end_marker, i)
    j = SCRIPT.index("\n", j) if inclusive else SCRIPT.rindex("\n", 0, j)
    return SCRIPT[i:j]


def run_stage_segments():
    """The verbatim execute_run.sh text the run stage executes around the runtime check (no edit, only selection)."""
    run_case = SCRIPT.index("\n  run)\n")
    pre = SCRIPT.index('reservation_runtime_check.py" pre-start', run_case)
    seg = {
        "blocked": _between("blocked() {", "exit 78; }"),
        "route": _between('ROUTE="$(python3 -I -c', 'blocked "explicit supported runtime and case selection required"'),
        "pyenv": _between('PYENV=("PATH=$PATH"', ")"),
        "run_stage": _between("run_stage() {", "\n}\n"),
        "plan": _between('    planfile="$OUT/plan/cfg/campaign-plan.json"', "    reuse_args=()", run_case),
        "check": _between('reservation_runtime_check.py" check-plan', '--repo "$REPO"', run_case),
        "pre": _between('reservation_runtime_check.py" pre-start', '--attempt "${GITHUB_RUN_ATTEMPT:-}"', run_case),
        "runner": _between('    if [ "$ROUTE" = github-producer ]; then', "    fi ;;", pre),
    }
    seg["run_stage"] += "\n}"
    seg["runner"] = seg["runner"][:-len(" ;;")]
    return seg


class Composed(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.d = os.path.realpath(tempfile.mkdtemp(prefix="ct-composed-"))
        os.chmod(cls.d, 0o700)
        cls.prod_writer = hashlib.sha256(open(os.path.join(ROOT, "scripts", "state_ref_writer.py"), "rb").read()).hexdigest()
        # fixture journal: root (empty canonical ledger) + one deterministic child per preserved event
        cls.remote = os.path.join(cls.d, "journal.git")
        subprocess.run(["git", "init", "-q", "--bare", cls.remote], check=True, env=GIT_ENV)
        work = os.path.join(cls.d, "journal-work")
        subprocess.run(["git", "init", "-q", work], check=True, env=GIT_ENV)
        blob = git(work, "hash-object", "-w", "--stdin", data=W.ledger_bytes([]))
        tree = git(work, "mktree", data=("100644 blob %s\t%s\n" % (blob, W.LEDGER)).encode())
        dates = {"GIT_AUTHOR_DATE": "2026-11-01T00:00:00Z", "GIT_COMMITTER_DATE": "2026-11-01T00:00:00Z"}
        cls.root = git(work, "commit-tree", tree, data=b"fixture root (not the production root)\n", env={**W.IDENT, **dates})
        sha, ids = cls.root, []
        for i, e in enumerate(HEAD_EVENTS):
            sha, raw = W._child(work, sha, HEAD_EVENTS[:i], e)
            ids.append((sha, raw))
        cls.work, cls.ids = work, ids
        cls.parent, cls.head = ids[-2][0], ids[-1][0]
        # the preserved ledger BYTES are reproduced exactly (ids are fixture ids)
        assert ids[-2][1] == PARENT_RAW and ids[-1][1] == HEAD_RAW, "fixture ledger bytes differ from the preserved journal"
        cls.set_remote(cls.head)
        # private scripts copy: exactly two constants differ
        cls.ct = os.path.join(cls.d, "ct")
        shutil.copytree(os.path.join(ROOT, "scripts"), os.path.join(cls.ct, "scripts"), ignore=shutil.ignore_patterns("__pycache__"))
        p = os.path.join(cls.ct, "scripts", "state_ref_writer.py")
        src = open(p, encoding="utf-8").read()
        for old, new in (('APPROVED_URL = "https://github.com/relativityE/speaksharp.git"', 'APPROVED_URL = "%s"' % cls.remote),
                         ('REVIEWED_ROOT = "%s"' % W.REVIEWED_ROOT, 'REVIEWED_ROOT = "%s"' % cls.root)):
            assert src.count(old) == 1
            src = src.replace(old, new)
        with open(p, "w", encoding="utf-8") as f:
            f.write(src)
        # harness checkout: a one-commit repo whose HEAD is the harness source
        cls.repo = os.path.join(cls.d, "harness-checkout")
        subprocess.run(["git", "init", "-q", cls.repo], check=True, env=GIT_ENV)
        git(cls.repo, "commit", "-q", "--allow-empty", "-m", "harness", env={**W.IDENT})
        cls.harness = git(cls.repo, "rev-parse", "HEAD")
        # sentinel packet: the runner only records that it started
        cls.hp = os.path.join(cls.d, "packet")
        os.makedirs(os.path.join(cls.hp, "bundle", "harness"))
        sentinel = ("const fs=require('fs'),path=require('path');const a=process.argv;"
                    "fs.writeFileSync(path.join(path.dirname(a[a.indexOf('--plan')+1]),'RUNNER-STARTED'),'started');")
        for name in ("with-authenticated-evidence.cjs", "campaign-runner.cjs"):
            with open(os.path.join(cls.hp, "bundle", "harness", name), "w") as f:
                f.write(sentinel)
        cls.req = os.path.join(cls.d, "request.json")
        with open(cls.req, "wb") as f:
            f.write(OCCURRENCE)
        cls.n = 0

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.d, True)

    @classmethod
    def set_remote(cls, sha):
        git(cls.work, "push", "-q", "-f", cls.remote, "%s:%s" % (sha, W.STATE_REF))

    def setUp(self):
        self.set_remote(self.head)

    def chain(self):
        return [(self.root, [], b"")] + [(s, W.parse_ledger(r), r) for s, r in self.ids]

    def genuine(self):
        recon = json.dumps({"headSha": self.parent}).encode()
        return I.reservation_binding_doc(self.chain(), OWN, recon, self.harness, TESTED)

    def advance(self, event):
        """A new fixture commit on the remote: the head plus one more event."""
        sha, _ = W._child(self.work, self.head, HEAD_EVENTS, event)
        return sha

    def compose(self, binding, *, snapshot=None, receipt_sha=None, source=None, between=None, identity_reserved=None, recon=None):
        Composed.n += 1
        out = os.path.join(self.d, "out-%d" % self.n)
        os.makedirs(os.path.join(out, "plan", "cfg"))
        plan = {"campaignId": CAMPAIGN, "requestSha256": REQ_SHA, "executionIdentity": {"runId": RUN, "attempt": 1},
                "identityReserved": binding["identityReads"] if identity_reserved is None else identity_reserved,
                "reservationBinding": binding, "reservationBindingSha256": "4" * 64, "sharedIdentityBoundaries": True}
        planfile = os.path.join(out, "plan", "cfg", "campaign-plan.json")
        with open(planfile, "w") as f:
            json.dump(plan, f)
        psha = hashlib.sha256(open(planfile, "rb").read()).hexdigest()
        with open(os.path.join(out, "plan", "cfg", "build-plan-consumption.json"), "w") as f:
            json.dump({"planSha256": receipt_sha or psha}, f)
        with open(os.path.join(out, "plan", "producer-scope.json"), "w") as f:
            f.write("{}")
        with open(os.path.join(out, "reconciliation.json"), "w") as f:
            json.dump({"headSha": recon or self.parent}, f)
        res_in = os.path.join(out, "journal-snapshot.json")
        with open(res_in, "w") as f:
            json.dump(snapshot or {"headSha": self.head, "events": HEAD_EVENTS}, f)
        seg = run_stage_segments()
        hook = ""
        if between is not None:     # test-only: the journal moves after check-plan and before pre-start (not in execute_run.sh)
            hook = 'git -C "%s" push -q -f "%s" "%s:%s"\n' % (self.work, self.remote, between, W.STATE_REF)
        driver = "\n".join([
            "set -euo pipefail",
            'ROOT="%s"; REPO="%s"; CFG="%s"; HP="%s"; OUT="%s"; REQ="%s"; RES_IN="%s"' % (
                self.ct, self.repo, os.path.join(ROOT, "config", "test-config.v1.json"), self.hp, out, self.req, res_in),
            'ss_broker_service_role=""; ss_broker_telemetry_key=""',
            seg["blocked"], seg["route"], seg["pyenv"], seg["run_stage"], seg["plan"], seg["check"], hook + seg["pre"], seg["runner"], ""])
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": self.d, "CT_OUT": out, "CT_REQUEST": self.req, "CT_REQUEST_SHA256": REQ_SHA,
               "CT_SOURCE_SHA": source or self.harness, "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "relativityE/speaksharp",
               "GITHUB_RUN_ID": RUN, "GITHUB_RUN_ATTEMPT": "1", "GITHUB_JOB": "live", "GITHUB_SHA": self.harness, **GIT_ENV}
        for n in ("FREE_TEST_EMAIL", "FREE_TEST_PASSWORD", "THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"):
            env[n] = PLACEHOLDER
        p = subprocess.run(["bash", "-c", driver], capture_output=True, text=True, env=env)
        return p, os.path.exists(os.path.join(out, "plan", "cfg", "RUNNER-STARTED")), out

    def refuses(self, code, *a, **kw):
        p, started, _ = self.compose(*a, **kw)
        self.assertEqual(p.returncode, 78, p.stderr)
        self.assertIn("BLOCKED_SETUP: %s" % code, p.stderr)
        self.assertNotIn("runtime-binding-unverifiable", p.stderr)     # an intended refusal, not a generic setup failure
        self.assertFalse(started, "the runner started after a refusal")

    # -- the copy and the fixture are what they claim --------------------------------------------------------------------------------------
    def test_the_private_copy_differs_from_production_in_exactly_the_two_constants(self):
        prod, copy = os.path.join(ROOT, "scripts"), os.path.join(self.ct, "scripts")
        names = sorted(n for n in os.listdir(prod) if n != "__pycache__")
        self.assertEqual(names, sorted(n for n in os.listdir(copy) if n != "__pycache__"))
        _, mismatch, errors = filecmp.cmpfiles(prod, copy, names, shallow=False)
        self.assertEqual((mismatch, errors), (["state_ref_writer.py"], []))
        a = open(os.path.join(prod, "state_ref_writer.py"), encoding="utf-8").read().splitlines()
        b = open(os.path.join(copy, "state_ref_writer.py"), encoding="utf-8").read().splitlines()
        changed = [ln for ln in difflib.unified_diff(a, b, lineterm="", n=0) if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
        self.assertEqual(changed, ['-APPROVED_URL = "https://github.com/relativityE/speaksharp.git"', '+APPROVED_URL = "%s"' % self.remote,
                                   '-REVIEWED_ROOT = "%s"' % W.REVIEWED_ROOT, '+REVIEWED_ROOT = "%s"' % self.root])
        self.assertEqual(hashlib.sha256(open(os.path.join(prod, "state_ref_writer.py"), "rb").read()).hexdigest(), self.prod_writer)
        self.assertEqual(W.APPROVED_URL, "https://github.com/relativityE/speaksharp.git")   # production module unchanged in this process

    def test_fixture_commits_reproduce_the_preserved_ledger_bytes_and_are_labelled_as_fixture_ids(self):
        b = self.genuine()
        self.assertEqual((b["journalRootSha"], b["reconciliationHeadSha"], b["journalHeadSha"]), (self.root, self.parent, self.head))
        self.assertNotIn(self.head, {n["sha"] for n in TAIL})          # fixture ids, never claimed to be the production commits
        self.assertEqual(len({self.root, self.parent, self.head}), 3)

    # -- the composed run-stage path --------------------------------------------------------------------------------------------------------
    def test_positive_the_genuine_binding_passes_both_checks_and_the_runner_starts(self):
        p, started, out = self.compose(self.genuine())
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertTrue(started)
        rows = [ln.split("\t") for ln in open(os.path.join(out, "stage-trace.tsv")).read().splitlines()]
        self.assertEqual([(r[0], r[3]) for r in rows], [("gate-and-validate", "0"), ("gate-and-validate", "0"), ("run", "0")])

    def test_a_swapped_snapshot_file_refuses(self):
        forged = dict(HEAD_EVENTS[-1], allocation=dict(HEAD_EVENTS[-1]["allocation"], identityReads=40))
        self.refuses("runtime-snapshot-not-authenticated", self.genuine(), snapshot={"headSha": self.head, "events": HEAD_EVENTS[:-1] + [forged]})

    def test_a_forged_same_head_allocation_refuses(self):
        canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
        alloc = dict(HEAD_EVENTS[-1]["allocation"], identityReads=40)
        self.refuses("runtime-binding-allocation", dict(self.genuine(), identityReads=40, allocationSha256=hashlib.sha256(canon(alloc)).hexdigest()))

    def test_a_forged_same_head_event_refuses(self):
        self.refuses("runtime-binding-reserve-event", dict(self.genuine(), reserveEventSha256="0" * 64))

    def test_a_forged_source_refuses(self):
        self.refuses("runtime-binding-harness-source", self.genuine(), source="0" * 40)

    def test_a_closed_reserve_refuses_even_with_a_binding_repointed_at_the_new_head(self):
        settled = self.advance(dict(HEAD_EVENTS[-1], type="settle", provenance="evidence-sha256:" + "5" * 64))
        self.set_remote(settled)
        b = dict(self.genuine(), reconciliationHeadSha=self.head, journalHeadSha=settled)
        snap = {"headSha": settled, "events": HEAD_EVENTS + [dict(HEAD_EVENTS[-1], type="settle", provenance="evidence-sha256:" + "5" * 64)]}
        # against the genuine checkpoint the re-pointed binding is refused first ...
        self.refuses("runtime-binding-reconciliation", b, snapshot=snap)
        # ... and even with a checkpoint that also names the new parent, the own reserve is closed
        self.refuses("runtime-reserve-closed", b, snapshot=snap, recon=self.head)

    def test_a_reserve_changed_or_closed_after_check_plan_refuses_at_pre_start(self):
        for name, event in (("settled", dict(HEAD_EVENTS[-1], type="settle", provenance="evidence-sha256:" + "5" * 64)),
                            ("another reserve", dict(HEAD_EVENTS[-1], runId="42500000009"))):
            with self.subTest(name):
                self.set_remote(self.head)
                p, started, out = self.compose(self.genuine(), between=self.advance(event))
                self.assertEqual(p.returncode, 78, p.stderr)
                self.assertIn("BLOCKED_SETUP: runtime-journal-changed-before-start", p.stderr)
                self.assertFalse(started)
                rows = [ln.split("\t") for ln in open(os.path.join(out, "stage-trace.tsv")).read().splitlines()]
                self.assertEqual([(r[0], r[3]) for r in rows], [("gate-and-validate", "0"), ("gate-and-validate", "78")])   # check-plan passed

    def test_a_plan_whose_bytes_differ_from_the_retained_digest_never_reaches_either_check(self):
        p, started, out = self.compose(self.genuine(), receipt_sha="0" * 64)
        self.assertEqual(p.returncode, 78)
        self.assertIn("BLOCKED_SETUP: campaign plan changed after the build-time identity was retained", p.stderr)
        self.assertFalse(started)
        self.assertFalse(os.path.exists(os.path.join(out, "stage-trace.tsv")))

    def test_an_unavailable_journal_is_a_generic_fail_closed_refusal(self):
        moved = self.remote + ".moved"
        os.rename(self.remote, moved)
        self.addCleanup(os.rename, moved, self.remote)
        p, started, _ = self.compose(self.genuine())
        self.assertEqual(p.returncode, 78)
        self.assertIn("BLOCKED_SETUP: runtime-binding-unverifiable", p.stderr)
        self.assertFalse(started)


if __name__ == "__main__":
    unittest.main()
