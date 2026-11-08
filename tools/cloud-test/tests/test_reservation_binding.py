"""Sam 1794113504 / 1794114759: authoritative reservation -> generated plan binding, through the REAL functions.

Producer: init_run_inputs.reservation_binding_doc on the PRESERVED REAL state-ref journal (run 42423408284's actual reserve at the head over
its actual parent, committed in tests/fixtures/completion-42423408284/journal-tail.json) with the exact manual own tuple. Transport: the private
0600 file + digest that prepare exports, consumed by the REAL run_env.py CLI (on the preserved real materialized occurrence of that run) and
by reservation_binding.verify, which build_plan calls with its own independent inputs. Only temporary test state; no network, no journal write.
The reconciliation file here is reduced to the field the binding checks (its headSha); its digest binding is run_env's existing check."""
import base64
import copy
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from _fixtures import ROOT
import init_run_inputs as I
import reservation_binding as RB
import state_ref_writer as W

FIX = os.path.join(ROOT, "tests", "fixtures", "completion-42423408284")
TAIL = json.load(open(os.path.join(FIX, "journal-tail.json")))
NODES = [(n["sha"], W.parse_ledger(base64.b64decode(n["ledgerB64"])), base64.b64decode(n["ledgerB64"])) for n in TAIL]
OCCURRENCE = open(os.path.join(FIX, "occurrence.json"), "rb").read()
REQ_SHA = hashlib.sha256(OCCURRENCE).hexdigest()
RUN, CAMPAIGN = "42423408284", "R10-3b040043-smoke15"
OWN = (CAMPAIGN, RUN, 1, REQ_SHA)
HARNESS, TESTED = "3e1b5c1b35aed0acd13cdf305fc44b28af1c804b", "5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2"
CHAIN = NODES[:2]                     # parent (42421801424's settle) -> head (42423408284's reserve): the state prepare read for that run
RECON = json.dumps({"headSha": NODES[0][0]}).encode()


def binding(chain=CHAIN, own=OWN, recon=RECON):
    return I.reservation_binding_doc(chain, own, recon, HARNESS, TESTED)


class Producer(unittest.TestCase):
    def test_the_real_reserve_yields_the_binding_with_three_distinct_heads(self):
        b = binding()
        reserve = NODES[1][1][-1]
        self.assertEqual((reserve["type"], reserve["runId"], reserve["provenance"]), ("reserve", RUN, "request-sha256:" + REQ_SHA))
        self.assertEqual(b["identityReads"], 32)
        self.assertEqual((b["journalHeadSha"], b["reconciliationHeadSha"]), (NODES[1][0], NODES[0][0]))
        self.assertEqual((b["harnessSourceSha"], b["testedSha"]), (HARNESS, TESTED))
        self.assertEqual(len({b["journalHeadSha"], b["harnessSourceSha"], b["testedSha"]}), 3)
        canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
        self.assertEqual(b["reserveEventSha256"], hashlib.sha256(canon(reserve)).hexdigest())
        self.assertEqual(set(b), RB.KEYS)

    def test_missing_duplicate_closed_replayed_stale_or_substituted_reserves_refuse(self):
        settled = NODES[:3]                                                  # head is the settle: closed, not open
        dup_head = copy.deepcopy(CHAIN)
        dup_head = [dup_head[0], (dup_head[1][0], dup_head[1][1] + [dup_head[1][1][-1]], dup_head[1][2])]
        cases = {
            "another request digest (substituted)": dict(own=(CAMPAIGN, RUN, 1, "0" * 64)),
            "another run (substituted)": dict(own=(CAMPAIGN, "42500000001", 1, REQ_SHA)),
            "another attempt": dict(own=(CAMPAIGN, RUN, 2, REQ_SHA)),
            "a previous run's reserve (replayed)": dict(own=(CAMPAIGN, "42421801424", 1, REQ_SHA)),
            "closed: the reserve is settled": dict(chain=settled),
            "no reserve at head (missing)": dict(chain=NODES[:1] + NODES[:1]),
            "duplicate own reserve": dict(chain=dup_head),
            "stale reconciliation head": dict(recon=json.dumps({"headSha": "0" * 40}).encode()),
            "unreadable reconciliation": dict(recon=b"not json"),
        }
        for name, kw in cases.items():
            with self.subTest(name), self.assertRaises(I.Refused):
                binding(**kw)

    def test_an_altered_allocation_changes_the_bound_digests(self):
        altered = copy.deepcopy(CHAIN)
        event = altered[1][1][-1]
        event["allocation"]["identityReads"] = 18
        b = binding(chain=altered)
        self.assertEqual(b["identityReads"], 18)
        self.assertNotEqual(b["reserveEventSha256"], binding()["reserveEventSha256"])
        self.assertNotEqual(b["allocationSha256"], binding()["allocationSha256"])
        # the real journal check is state_ref_writer.validate_chain (ledger bytes vs events), which prepare runs before this function


class Transport(unittest.TestCase):
    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="ct-reservation-binding-"))
        self.addCleanup(shutil.rmtree, self.d, True)
        os.chmod(self.d, 0o700)

    def write(self, doc, name="reservation-binding.json", mode=0o600):
        path = os.path.join(self.d, name)
        I._write_private(path, doc)
        os.chmod(path, mode)
        return path, hashlib.sha256(open(path, "rb").read()).hexdigest()

    def verify(self, path, sha, **over):
        kw = dict(request_sha256=REQ_SHA, campaign_id=CAMPAIGN, run_id=RUN, attempt=1, reconciliation_head=NODES[0][0], configured_max=32)
        kw.update(over)
        return RB.verify(path, sha, **kw)

    def test_the_verified_binding_passes_and_every_substitution_refuses(self):
        path, sha = self.write(binding())
        self.assertEqual(self.verify(path, sha)["identityReads"], 32)
        forged, fsha = self.write(dict(binding(), identityReads=40), name="forged.json")   # a matching-looking file with its own digest
        cases = [
            (dict(), path, "f" * 64, "reservation-binding-digest"),                          # substituted digest
            (dict(run_id="42500000001"), path, sha, "reservation-binding-execution"),
            (dict(attempt=2), path, sha, "reservation-binding-execution"),
            (dict(request_sha256="0" * 64), path, sha, "reservation-binding-request"),
            (dict(campaign_id="OTHER"), path, sha, "reservation-binding-campaign"),
            (dict(reconciliation_head="0" * 40), path, sha, "reservation-binding-journal"),
            (dict(configured_max=33), path, sha, "reservation-binding-insufficient"),
        ]
        for over, p, s, code in cases:
            with self.subTest(code=code, over=over), self.assertRaises(RB.Refused) as e:
                self.verify(p, s, **over)
            self.assertEqual(str(e.exception), code)
        self.assertEqual(self.verify(forged, fsha)["identityReads"], 40)     # bytes alone prove nothing about origin ...
        with self.assertRaises(RB.Refused):                                  # ... so the forged allocation must also match the journal head:
            self.verify(forged, fsha, reconciliation_head="0" * 40)         # a stale/other checkpoint refuses
        loose, lsha = self.write(binding(), name="loose.json", mode=0o644)
        with self.assertRaises(RB.Refused):
            self.verify(loose, lsha)                                         # not private
        os.symlink(path, os.path.join(self.d, "link.json"))
        with self.assertRaises(RB.Refused):
            self.verify(os.path.join(self.d, "link.json"), sha)

    def run_env(self, *extra):
        req = os.path.join(self.d, "req.json")
        with open(req, "wb") as f:
            f.write(OCCURRENCE)
        os.chmod(req, 0o600)
        rc = os.path.join(self.d, "rc.json")
        with open(rc, "wb") as f:
            f.write(RECON)
        out = os.path.join(self.d, "env.txt")
        if os.path.exists(out):
            os.remove(out)
        r = subprocess.run(["python3", "-I", os.path.join(ROOT, "scripts", "run_env.py"), "--request", req, "--request-sha256", REQ_SHA,
                            "--reconciliation", rc, "--execution-deadline", "2026-11-08T00:00:00Z", "--out", out, *extra],
                           capture_output=True, text=True, timeout=60,
                           env=dict(os.environ, VITE_SUPABASE_URL="https://abcdefghijklmnopqrst.supabase.co"))   # the public origin run_env requires
        return r, (open(out).read() if os.path.exists(out) else "")

    def test_the_real_run_env_carries_only_the_verified_file_and_digest(self):
        path, sha = self.write(binding())
        r, env = self.run_env("--reservation-binding", path, "--reservation-binding-sha256", sha, "--execution-run-id", RUN + ".1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("BP_RESERVATION_BINDING_FILE=" + path, env.replace("'", ""))
        self.assertIn("BP_RESERVATION_BINDING_SHA256=" + sha, env)
        self.assertNotIn("BP_IDENT_RESERVED", env)                           # the number travels only inside the digest-bound file
        for extra, code in ((("--execution-run-id", "42500000001.1"), "reservation-binding-execution"),
                            (("--execution-run-id", RUN + ".2"), "reservation-binding-execution"),):
            r, _ = self.run_env("--reservation-binding", path, "--reservation-binding-sha256", sha, *extra)
            self.assertEqual(r.returncode, 1)
            self.assertIn("BLOCKED_SETUP: " + code, r.stderr + r.stdout)
        r, _ = self.run_env("--reservation-binding", path, "--reservation-binding-sha256", "f" * 64, "--execution-run-id", RUN + ".1")
        self.assertIn("reservation-binding-digest", r.stderr + r.stdout)

    def test_unshared_compatibility_no_binding_no_reserved_fields(self):
        r, env = self.run_env()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotIn("BP_RESERVATION_BINDING", env)


class Wiring(unittest.TestCase):
    def test_prepare_derives_from_the_manual_own_tuple_and_build_plan_reverifies_independently(self):
        src = open(os.path.join(ROOT, "scripts", "init_run_inputs.py"), encoding="utf-8").read()
        self.assertIn('reservation_binding_doc(chains[-1], (req["runId"], x.run_id, x.attempt, request_sha256), reconciliation,', src)
        self.assertIn("env.update(CT_RESERVATION_BINDING_FILE=binding_file, CT_RESERVATION_BINDING_SHA256=_sha(binding_file))", src)
        bp = open(os.path.join(ROOT, "harness-adapter", "build_plan.py"), encoding="utf-8").read()
        self.assertIn("request_sha256=binding['requestSha256'], campaign_id=CAMPAIGN, run_id=execution_run_id, attempt=1,", bp)
        self.assertIn("reconciliation_head=binding['reconciliation'].get('headSha'), configured_max=IDENT_CAP,", bp)
        self.assertIn("tested_sha=binding['request']['release']['testedSha'])", bp)
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn("CT_RESERVATION_BINDING_FILE CT_RESERVATION_BINDING_SHA256", sh)


if __name__ == "__main__":
    unittest.main()


import reservation_runtime_check as RC   # noqa: E402

SNAPSHOT = {"headSha": NODES[1][0], "events": NODES[1][1]}      # the authenticated events the receiver accepted: the real head
# The fixture tail starts at the parent, so in these tests the "reviewed root" is that first preserved node (production: REVIEWED_ROOT).
FIXTURE_ROOT = NODES[0][0]
VIEW = RC.authenticated_view(CHAIN, FIXTURE_ROOT)


def view_with(head=NODES[1][0], events=NODES[1][1], parent=NODES[0][0], parent_events=None):
    return dict(VIEW, head=head, events=events, parentHead=parent, parentEvents=events[:-1] if parent_events is None else parent_events)


def plan_for(b, **over):
    p = {"campaignId": CAMPAIGN, "requestSha256": REQ_SHA, "executionIdentity": {"runId": RUN, "attempt": 1}, "identityReserved": b["identityReads"],
         "reservationBinding": b, "reservationBindingSha256": "4" * 64, "sharedIdentityBoundaries": True}
    p.update(over)
    return p


class RuntimeAuthority(unittest.TestCase):
    """Sam RETURN 1794116817 / 1794117662: allocation, root and reconciliation parent are recomputed from ONE authenticated chain read."""
    REQUEST = json.loads(OCCURRENCE)

    def check(self, plan, view=VIEW, source=HARNESS, head=HARNESS, recon=NODES[0][0]):
        return RC.check_plan(plan, view, self.REQUEST, REQ_SHA, RUN, 1, source, head, recon)

    def refused(self, code, fn, *a, **kw):
        with self.assertRaises(RC.Refused) as e:
            fn(*a, **kw)
        self.assertEqual(str(e.exception), code)

    def test_the_genuine_binding_matches_the_authenticated_reserve(self):
        self.assertEqual(self.check(plan_for(binding()))["identityReads"], 32)

    def test_the_view_is_validated_from_the_reviewed_root_actually_used(self):
        self.assertEqual((VIEW["root"], VIEW["parentHead"], VIEW["head"]), (NODES[0][0], NODES[0][0], NODES[1][0]))
        self.refused("runtime-journal-root", RC.authenticated_view, CHAIN, "0" * 40)          # a chain from another root
        self.refused("runtime-journal-root", RC.authenticated_view, CHAIN[1:], NODES[1][0])    # no parent: not a manual transition

    def test_sams_reproduction_same_real_parent_and_head_with_a_forged_allocation_passes_preparation_but_never_runtime(self):
        canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
        forged_alloc = dict(NODES[1][1][-1]["allocation"], identityReads=40)
        forged = dict(binding(), identityReads=40, allocationSha256=hashlib.sha256(canon(forged_alloc)).hexdigest())
        d = os.path.realpath(tempfile.mkdtemp(prefix="ct-forged-")); self.addCleanup(shutil.rmtree, d, True)
        path = os.path.join(d, "b.json"); I._write_private(path, forged)
        sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
        # preparation-time verification cannot prove allocation authority (stated limit) ...
        self.assertEqual(RB.verify(path, sha, request_sha256=REQ_SHA, campaign_id=CAMPAIGN, run_id=RUN, attempt=1,
                                   reconciliation_head=NODES[0][0], configured_max=32, tested_sha=TESTED, harness_source_sha=HARNESS)["identityReads"], 40)
        # ... the runtime check recomputes it from the authenticated events and refuses
        self.refused("runtime-binding-allocation", self.check, plan_for(forged))

    def test_forged_root_reconciliation_event_source_release_execution_or_plan_values_refuse(self):
        b = binding()
        cases = [
            ("runtime-binding-journal-root", plan_for(dict(b, journalRootSha="0" * 40)), {}),
            ("runtime-binding-reconciliation", plan_for(dict(b, reconciliationHeadSha="0" * 40)), {"recon": "0" * 40}),  # binding = checkpoint, not parent
            ("runtime-binding-reconciliation", plan_for(b), {"recon": "0" * 40}),                     # accepted checkpoint differs
            ("runtime-binding-reconciliation", plan_for(b), {"view": view_with(parent="0" * 40)}),  # authenticated parent differs
            ("runtime-binding-reconciliation", plan_for(b), {"view": view_with(parent_events=[])}), # head is not parent + one event
            ("runtime-binding-reserve-event", plan_for(dict(b, reserveEventSha256="0" * 64)), {}),
            ("runtime-binding-harness-source", plan_for(dict(b, harnessSourceSha="0" * 40)), {}),
            ("runtime-binding-harness-source", plan_for(b), {"head": "0" * 40}),           # checkout HEAD differs
            ("runtime-binding-tested-release", plan_for(dict(b, testedSha="0" * 40)), {}),
            ("runtime-binding-execution", plan_for(b, executionIdentity={"runId": "42500000001", "attempt": 1}), {}),
            ("runtime-binding-identity-reads", plan_for(b, identityReserved=31), {}),
            ("runtime-binding-journal-head", plan_for(dict(b, journalHeadSha="0" * 40)), {}),
            ("runtime-binding-request", plan_for(b, requestSha256="0" * 64), {}),
        ]
        for code, plan, kw in cases:
            with self.subTest(code=code, kw=sorted(kw)):
                self.refused(code, self.check, plan, **kw)

    def test_settle_release_or_a_later_event_between_prepare_and_the_receiver_refuses(self):
        reserve = NODES[1][1][-1]
        moved = dict(binding(), journalHeadSha="1" * 40, reconciliationHeadSha=NODES[1][0])
        for kind in ("settle", "release"):
            v = view_with(head="1" * 40, events=NODES[1][1] + [dict(reserve, type=kind)], parent=NODES[1][0])
            self.refused("runtime-reserve-closed", self.check, plan_for(moved), view=v, recon=NODES[1][0])
        later = view_with(head="1" * 40, events=NODES[1][1] + [dict(reserve, runId="42500000009")], parent=NODES[1][0])
        self.refused("runtime-reserve-not-last", self.check, plan_for(moved), view=later, recon=NODES[1][0])

    def test_pre_start_rejects_a_changed_head_root_parent_or_closed_reserve_since_the_receiver(self):
        b = binding()
        self.assertEqual(RC.pre_start(plan_for(b), VIEW, REQ_SHA, RUN, 1), NODES[1][0])
        self.refused("runtime-journal-changed-before-start", RC.pre_start, plan_for(b), view_with(head="1" * 40), REQ_SHA, RUN, 1)
        self.refused("runtime-binding-journal-root", RC.pre_start, plan_for(b), dict(VIEW, root="0" * 40), REQ_SHA, RUN, 1)
        self.refused("runtime-binding-reconciliation", RC.pre_start, plan_for(b), view_with(parent="0" * 40), REQ_SHA, RUN, 1)
        settled = NODES[1][1] + [dict(NODES[1][1][-1], type="settle")]
        self.refused("runtime-binding-reconciliation", RC.pre_start, plan_for(dict(b, journalHeadSha="1" * 40)),
                     view_with(head="1" * 40, events=settled, parent=NODES[1][0]), REQ_SHA, RUN, 1)   # the parent moved: refuses first
        self.refused("runtime-reserve-closed", RC.pre_start, plan_for(dict(b, journalHeadSha="1" * 40, reconciliationHeadSha=NODES[1][0])),
                     view_with(head="1" * 40, events=settled, parent=NODES[1][0]), REQ_SHA, RUN, 1)

    def test_unshared_and_nightly_plans_are_unchanged_and_shared_needs_a_binding(self):
        self.assertIsNone(self.check({"campaignId": CAMPAIGN}))
        self.assertIsNone(RC.pre_start({"campaignId": CAMPAIGN}, VIEW, REQ_SHA, RUN, 1))
        self.refused("runtime-binding-missing", self.check, {"sharedIdentityBoundaries": True})

    def test_pre_start_compares_the_full_reserve_not_only_head_and_open_state(self):
        b = binding()
        self.refused("runtime-binding-allocation", RC.pre_start, plan_for(dict(b, allocationSha256="0" * 64)), VIEW, REQ_SHA, RUN, 1)
        self.refused("runtime-binding-reserve-event", RC.pre_start, plan_for(dict(b, reserveEventSha256="0" * 64)), VIEW, REQ_SHA, RUN, 1)
        self.refused("runtime-binding-identity-reads", RC.pre_start, plan_for(b, identityReserved=31), VIEW, REQ_SHA, RUN, 1)

    def test_a_swapped_snapshot_file_is_refused_against_the_authenticated_read(self):
        self.assertIs(RC.authenticated_snapshot(SNAPSHOT, VIEW), VIEW)
        swapped = {"headSha": NODES[1][0], "events": NODES[1][1][:-1] + [dict(NODES[1][1][-1], allocation=dict(NODES[1][1][-1]["allocation"], identityReads=40))]}
        self.refused("runtime-snapshot-not-authenticated", RC.authenticated_snapshot, swapped, VIEW)
        self.refused("runtime-snapshot-not-authenticated", RC.authenticated_snapshot, dict(SNAPSHOT, headSha="1" * 40), VIEW)


def _execute_run_command(sub):
    """The exact reservation_runtime_check.py invocation execute_run.sh's run stage makes, as an argv template."""
    sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
    i = sh.index('reservation_runtime_check.py" ' + sub)
    j = sh.index("\n", sh.index("--attempt", i))
    line = sh[i:j].replace("\\\n", " ")
    import shlex
    return shlex.split(line.split('" ', 1)[1].replace('"', ""))


class AcceptanceCommand(unittest.TestCase):
    """MOCKED TRANSPORT (Sam 1794117648): the REAL main() with the exact flags execute_run.sh passes; the one authenticated chain read is an
    in-process unittest.mock patch of check_gates.authenticated_state_chain plus check_gates' existing module-level JOURNAL_ROOT (neither is
    CLI- or environment-selectable; no production seam). This proves the comparisons, NOT the fetch. Every refusal is exit 78."""

    def setUp(self):
        self.d = os.path.realpath(tempfile.mkdtemp(prefix="ct-acceptance-")); self.addCleanup(shutil.rmtree, self.d, True)
        repo = os.path.join(self.d, "repo"); os.mkdir(repo)
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_AUTHOR_NAME="u", GIT_AUTHOR_EMAIL="u@x",
                   GIT_COMMITTER_NAME="u", GIT_COMMITTER_EMAIL="u@x")
        subprocess.run(["git", "init", "-q", repo], check=True, env=env)
        subprocess.run(["git", "-C", repo, "commit", "-q", "--allow-empty", "-m", "harness"], check=True, env=env)
        self.repo = repo
        self.head = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        self.req = os.path.join(self.d, "req.json")
        with open(self.req, "wb") as f:
            f.write(OCCURRENCE)

    def files(self, plan, snap=SNAPSHOT):
        out = {}
        for name, doc in (("plan.json", plan), ("snap.json", snap), ("reconciliation.json", {"headSha": NODES[0][0]})):
            out[name] = os.path.join(self.d, name)
            with open(out[name], "w") as f:
                json.dump(doc, f)
        return out

    def argv(self, sub, f, source=None, psha=None):
        planned = hashlib.sha256(open(f["plan.json"], "rb").read()).hexdigest()
        values = {"$planfile": f["plan.json"], "$psha": psha or planned, "$RES_IN": f["snap.json"], "$OUT/reconciliation.json": f["reconciliation.json"],
                  "$REQ": self.req, "$CT_REQUEST_SHA256": REQ_SHA,
                  "${CT_SOURCE_SHA:-}": source or self.head, "${GITHUB_RUN_ID:-}": RUN, "${GITHUB_RUN_ATTEMPT:-}": "1", "$REPO": self.repo}
        return ["reservation_runtime_check.py"] + [values.get(a, a) for a in _execute_run_command(sub)]

    def run_main(self, sub, plan, snap=SNAPSHOT, chain=CHAIN, source=None, psha=None):
        import check_gates
        from unittest import mock
        f = self.files(plan, snap)
        with mock.patch.object(check_gates, "authenticated_state_chain", lambda: chain), mock.patch.object(check_gates, "JOURNAL_ROOT", FIXTURE_ROOT):
            return RC.main(self.argv(sub, f, source, psha))

    def test_the_exact_commands_accept_the_genuine_binding_and_refuse_every_forgery(self):
        good = plan_for(dict(binding(), harnessSourceSha=self.head))
        self.assertEqual(self.run_main("check-plan", good), 0)
        self.assertEqual(self.run_main("pre-start", good), 0)
        canon = lambda o: json.dumps(o, sort_keys=True, separators=(",", ":")).encode()
        forged_alloc = dict(NODES[1][1][-1]["allocation"], identityReads=40)
        swapped = {"headSha": NODES[1][0], "events": NODES[1][1][:-1] + [dict(NODES[1][1][-1], allocation=forged_alloc)]}
        cases = {
            "same head, forged allocation": (dict(binding(), harnessSourceSha=self.head, identityReads=40,
                                                  allocationSha256=hashlib.sha256(canon(forged_alloc)).hexdigest()), SNAPSHOT, None),
            "same head, forged event": (dict(binding(), harnessSourceSha=self.head, reserveEventSha256="0" * 64), SNAPSHOT, None),
            "forged harness source": (dict(binding(), harnessSourceSha="0" * 40), SNAPSHOT, None),
            "a swapped snapshot file": (dict(binding(), harnessSourceSha=self.head), swapped, None),
            # self-consistent forgery: binding AND snapshot file both claim 40 with matching digests; only the authenticated read refuses it
            "forged binding with a matching swapped snapshot": (dict(binding(), harnessSourceSha=self.head, identityReads=40,
                                                                     allocationSha256=hashlib.sha256(canon(forged_alloc)).hexdigest(),
                                                                     reserveEventSha256=hashlib.sha256(canon(swapped["events"][-1])).hexdigest()), swapped, None),
            "source differs from the harness checkout": (dict(binding(), harnessSourceSha=self.head), SNAPSHOT, "0" * 40),
        }
        for name, (b, snap, source) in cases.items():
            with self.subTest(name):
                plan = plan_for(b, identityReserved=b["identityReads"])
                self.assertEqual(self.run_main("check-plan", plan, snap=snap, source=source), 78)
        moved = CHAIN + [("1" * 40, NODES[1][1] + [dict(NODES[1][1][-1], type="settle")], b"")]
        self.assertEqual(self.run_main("pre-start", good, chain=moved), 78)
        for sub in ("check-plan", "pre-start"):     # another version of the plan file than the digest campaign-runner is given
            with self.subTest(plan_digest=sub):
                self.assertEqual(self.run_main(sub, good, psha="0" * 64), 78)
        self.assertEqual(self.run_main("check-plan", plan_for(dict(binding(), harnessSourceSha=self.head, journalRootSha="0" * 40))), 78)

    def test_the_unmodified_production_command_fails_closed_when_authentication_is_unavailable(self):
        """No patch at all: the real script in a subprocess with no `git` on PATH, so the approved read cannot run (no network either)."""
        import sys
        good = plan_for(dict(binding(), harnessSourceSha=self.head))
        f = self.files(good)
        empty = os.path.join(self.d, "empty-bin"); os.mkdir(empty)
        script = os.path.join(ROOT, "scripts", "reservation_runtime_check.py")
        for sub in ("check-plan", "pre-start"):
            with self.subTest(sub):
                p = subprocess.run([sys.executable, "-I", script] + self.argv(sub, f)[1:], capture_output=True, text=True,
                                   env={"PATH": empty, "HOME": self.d})
                self.assertEqual(p.returncode, 78, p.stderr)
                self.assertIn("BLOCKED_SETUP: runtime-binding-unverifiable", p.stderr)

    def test_the_job_values_survive_the_sanitized_stage_environment(self):
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        allow = sh[sh.index("for n in GITHUB_ACTIONS GITHUB_REPOSITORY"):sh.index("; do", sh.index("for n in GITHUB_ACTIONS GITHUB_REPOSITORY"))]
        for name in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
            self.assertIn(name, allow)
        self.assertIn(" CT_SOURCE_SHA ", sh[sh.index("for n in CT_OUT CT_REQUEST"):sh.index("; do", sh.index("for n in CT_OUT CT_REQUEST"))] + " ")
        self.assertIn('[ -n "${!n:-}" ] || blocked "actual GitHub job field $n missing"', sh)    # a missing job field is a refusal
        self.assertEqual(_execute_run_command("check-plan")[-2:], ["--repo", "$REPO"])          # the HARNESS checkout, not CT_CHECKOUT
        self.assertIn('REPO="$(cd "$ROOT/../.." && pwd)"', sh)


class RunStageWiring(unittest.TestCase):
    def test_the_run_stage_checks_after_the_receiver_and_again_immediately_before_the_campaign(self):
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        recv = sh.index('cmp -s "$accepted/reconciliation.json" "$OUT/reconciliation.json"', sh.index("  run)"))
        check = sh.index("reservation_runtime_check.py\" check-plan", recv)
        pre = sh.index("reservation_runtime_check.py\" pre-start", check)
        runner = sh.index('campaign-runner.cjs" --plan "$planfile"', pre)
        producer = sh.index('with-authenticated-evidence.cjs" --scope', pre)
        self.assertTrue(recv < check < pre < min(runner, producer))
        # Sam 1794117662: one plan version: both checks and campaign-runner take the retained build-time digest $psha
        for sub in ("check-plan", "pre-start"):
            argv = _execute_run_command(sub)
            self.assertEqual(argv[argv.index("--plan-sha256") + 1], "$psha")
            self.assertEqual(argv[argv.index("--plan") + 1], "$planfile")
        self.assertIn('--plan "$planfile" --plan-sha256 "$psha"', sh[runner:runner + 200])
        self.assertEqual(_execute_run_command("check-plan")[_execute_run_command("check-plan").index("--reconciliation") + 1], "$OUT/reconciliation.json")
