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
        self.assertIn("reconciliation_head=binding['reconciliation'].get('headSha'), configured_max=IDENT_CAP)", bp)
        sh = open(os.path.join(ROOT, "scripts", "execute_run.sh"), encoding="utf-8").read()
        self.assertIn("CT_RESERVATION_BINDING_FILE CT_RESERVATION_BINDING_SHA256", sh)


if __name__ == "__main__":
    unittest.main()
