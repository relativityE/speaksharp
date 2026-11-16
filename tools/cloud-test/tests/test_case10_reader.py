"""Case 10 current-state reader (J2), offline only. Every transport here is SYNTHETIC; production pins no project and no
schedule, so every reader refuses before any request."""
import base64
import json
import unittest

import _fixtures  # noqa: F401  (puts the scripts directory on the import path)
import case10_observation as O
import case10_reader as C
from case10_request_bound import INPUTS
import test_case10_observation as T  # a module reference: importing ReserveBeforeRead by name would rerun its tests here
from test_case10_observation import ACCOUNT, NOW, REQUEST_SHA, request
from test_accounting_rollup import Journal

ORIGIN = "https://abcdefghij0123456789.supabase.co"
APPROVED = {"origin": ORIGIN}
SCHEDULE = {"sessionAdds": [0, 0, 1, 1, 2, 2],
            "plan": {"leaseHeldIntervalsMs": [60000], "scanObligationCounts": [10, 10], "loadQueueSizes": [2], "saveEvaluationInvocations": 2,
                     "distinctRetryDebtsUpperBound": 1, "historyQueryLifecycles": 2, "recommendationSettlementInvocations": 1,
                     "leaseAcquisitions": 2, "leaseConfirmations": 2, "openAttemptAdvances": 1, "cancelledAttempts": 1, "localRetrySkips": 4,
                     "bootstrap": 5, "auth": 3, "navigation": 4, "modelAcquisition": 2, "preflights": 2, "successorSave": 3, "evidenceTail": 2}}
BUDGET = {"requests": 4, "identityReads": 1}
SESSION = "11111111-2222-4333-8444-555555555555"


def jwt(**claims):
    """A synthetic, unsigned access-token shape: only its claims are read, locally."""
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return enc({"alg": "none"}) + "." + enc(claims) + ".sig"


EMAIL, PASSWORD, ANON = "case10-owner@example.test", "synthetic-password", "synthetic-anon-key"
TOKEN = jwt(sub=ACCOUNT, session_id=SESSION, aud="authenticated")


def refused(test, code, fn, *a, **k):
    with test.assertRaises((C.Refused, O.Refused)) as e:
        fn(*a, **k)
    test.assertEqual(str(e.exception), code)


class Synthetic:
    """An instrumented transport: every request is recorded the moment it is sent; replies are fixed per (method, path)."""
    def __init__(self, uid=ACCOUNT, count=3, token=TOKEN, over=None):
        self.sent = []
        self.replies = {("POST", "/auth/v1/token"): (200, {}, json.dumps({"access_token": token}).encode()),
                        ("GET", "/auth/v1/user"): (200, {}, json.dumps({"id": uid}).encode()),
                        ("HEAD", "/rest/v1/sessions"): (206, {"Content-Range": "0-0/%d" % count}, b""),
                        ("POST", "/auth/v1/logout"): (204, {}, b"")}
        self.replies.update(over or {})

    def __call__(self, method, url, headers, body):
        path = url[len(ORIGIN):].split("?")[0]
        self.sent.append((method, url, dict(headers), body))
        reply = self.replies[(method, path)]
        if isinstance(reply, Exception):
            raise reply
        return reply

    def paths(self):
        return [(m, u[len(ORIGIN):].split("?")[0]) for m, u, _, _ in self.sent]


class Credentials:
    def __init__(self):
        self.calls = 0

    def __call__(self):
        self.calls += 1
        return EMAIL, PASSWORD


def make(transport, budget=BUDGET, approved=APPROVED, schedule=SCHEDULE, account=ACCOUNT, credentials=None):
    return C.make_reader(transport, account, credentials or Credentials(), ANON, budget, approved=approved, schedule=schedule)


KEYS = sorted(INPUTS)
FULL = [("POST", "/auth/v1/token"), ("GET", "/auth/v1/user"), ("HEAD", "/rest/v1/sessions"), ("POST", "/auth/v1/logout")]


class Reader(unittest.TestCase):
    def test_production_pins_nothing_so_every_reader_refuses_before_any_request(self):
        self.assertEqual((C.APPROVED, C.SCHEDULE, C.activated(), O.TRUSTED_READERS), (None, None, False, frozenset()))
        self.assertIs(O.READERS[C.READER_ID], O.subprocess_reader)  # registered, but trusted only once both pins exist
        t, cred = Synthetic(), Credentials()
        refused(self, "case10-reader-not-activated", C.make_reader, t, ACCOUNT, cred, ANON, BUDGET)
        self.assertEqual((t.sent, cred.calls), ([], 0))

    def test_one_read_is_login_uid_check_count_and_logout_in_that_order_and_nothing_else(self):
        t = Synthetic(count=7)
        projection = make(t)(KEYS)
        self.assertEqual(t.paths(), FULL)
        self.assertEqual(t.sent[0][1], ORIGIN + "/auth/v1/token?grant_type=password")
        self.assertEqual(t.sent[2][1], ORIGIN + "/rest/v1/sessions?select=id&user_id=eq." + ACCOUNT)
        self.assertEqual(t.sent[2][2]["Prefer"], "count=exact")
        self.assertEqual(t.sent[3][1], ORIGIN + "/auth/v1/logout?scope=local")  # never a global logout
        self.assertTrue(all(h["Authorization"] == "Bearer " + TOKEN for _, _, h, _ in t.sent[1:]))
        self.assertEqual(projection["snapshotSizes"], [7, 7, 8, 8, 9, 9])
        self.assertEqual({k: v for k, v in projection.items() if k != "snapshotSizes"}, SCHEDULE["plan"])
        self.assertEqual(sorted(projection), KEYS)

    def test_the_record_retains_no_token_credential_email_or_account_id(self):
        t = Synthetic()
        record = O.observe(make(t), dict(request(readBudget=BUDGET)), REQUEST_SHA, "101", 1, ACCOUNT, NOW)
        text = json.dumps(record)
        for secret in (TOKEN, EMAIL, PASSWORD, ANON, ACCOUNT):
            self.assertNotIn(secret, text)
        self.assertEqual(O.admit(record, request(readBudget=BUDGET), REQUEST_SHA, "101", 1, ACCOUNT, NOW,
                                 trusted=frozenset({"synthetic:case10-current-state@1"}))["allowance"], 240)

    def test_another_authenticated_uid_refuses_without_counting_and_still_logs_out(self):
        t = Synthetic(uid="00000000-0000-4000-8000-000000000002")
        refused(self, "case10-reader-uid-mismatch", make(t), KEYS)
        self.assertEqual(t.paths(), [FULL[0], FULL[1], FULL[3]])

    def test_a_token_without_this_accounts_session_binding_is_never_used_not_even_to_log_out(self):
        for token in (jwt(sub=ACCOUNT), jwt(sub=ACCOUNT, session_id="not-a-session"), jwt(sub="00000000-0000-4000-8000-000000000002",
                      session_id=SESSION), "opaque-token", "a.!!!.c"):
            t = Synthetic(token=token)
            refused(self, "case10-reader-session-unbound", make(t), KEYS)
            self.assertEqual(t.paths(), [FULL[0]])

    def test_a_failed_login_sends_nothing_more_and_never_retries(self):
        t = Synthetic(over={("POST", "/auth/v1/token"): (400, {}, b"{}")})
        refused(self, "case10-reader-login", make(t), KEYS)
        self.assertEqual(t.paths(), [FULL[0]])
        t = Synthetic(over={("POST", "/auth/v1/token"): (200, {}, b"{}")})
        refused(self, "case10-reader-login", make(t), KEYS)
        self.assertEqual(t.paths(), [FULL[0]])

    def test_an_expired_token_is_never_refreshed_and_a_missing_total_never_reads_as_zero(self):
        t = Synthetic(over={("HEAD", "/rest/v1/sessions"): (401, {}, b"")})
        refused(self, "case10-reader-count", make(t), KEYS)
        self.assertEqual(t.paths(), FULL)
        for headers in ({}, {"Content-Range": "0-0/*"}, {"Content-Range": "0-0/-1"}, {"Content-Range": "0-0/3 junk"}):
            t = Synthetic(over={("HEAD", "/rest/v1/sessions"): (206, headers, b"")})
            refused(self, "case10-reader-count", make(t), KEYS)
            self.assertEqual(t.paths(), FULL)

    def test_a_transport_failure_refuses_and_cleanup_never_changes_the_result(self):
        t = Synthetic(over={("GET", "/auth/v1/user"): OSError("reset")})
        refused(self, "case10-reader-transport", make(t), KEYS)
        self.assertEqual(t.paths(), [FULL[0], FULL[1], FULL[3]])
        t = Synthetic(over={("POST", "/auth/v1/logout"): OSError("reset")})
        self.assertEqual(make(t)(KEYS)["snapshotSizes"][0], 3)
        t = Synthetic(over={("GET", "/auth/v1/user"): (200, {}, b"x" * (C.MAX_BODY + 1))})
        refused(self, "case10-reader-response", make(t), KEYS)

    def test_the_closed_allowlist_and_both_caps_refuse_before_sending(self):
        t = Synthetic()
        b = C._Budget(t, ORIGIN, 4, 1, ACCOUNT)
        mine = ("user_id", "eq." + ACCOUNT)
        for method, path, query in (("GET", "/rest/v1/sessions", [("select", "id"), mine]),
                                    ("HEAD", "/rest/v1/progress_recommendations", [("select", "id"), mine]),
                                    ("HEAD", "/rest/v1/sessions", [("select", "*"), mine]),
                                    ("HEAD", "/rest/v1/sessions", [("select", "id"), ("user_id", "eq.00000000-0000-4000-8000-000000000002")]),
                                    ("HEAD", "/rest/v1/sessions", [("select", "id"), mine, ("limit", "100")]),
                                    ("POST", "/auth/v1/token", [("grant_type", "refresh_token")]),
                                    ("POST", "/auth/v1/logout", []), ("POST", "/auth/v1/logout", [("scope", "global")]),
                                    ("POST", "/auth/v1/logout", [("scope", "others")]),
                                    ("POST", "/rest/v1/rpc/acquire_recording_lease", [])):
            refused(self, "case10-reader-endpoint-not-allowed", b.send, method, path, query, {})
        self.assertEqual(t.sent, [])
        b.send("POST", "/auth/v1/token", [("grant_type", "password")], {})
        refused(self, "case10-reader-identity-cap", b.send, "POST", "/auth/v1/token", [("grant_type", "password")], {})
        for _ in range(3):
            b.send("GET", "/auth/v1/user", [], {})
        refused(self, "case10-reader-request-cap", b.send, "GET", "/auth/v1/user", [], {})
        self.assertEqual(len(t.sent), 4)

    def test_only_the_exact_pinned_budget_origin_schedule_and_keys_construct_a_reader(self):
        t = Synthetic()
        for budget in ({"requests": 12, "identityReads": 1}, {"requests": 4, "identityReads": 2}, {"requests": 4}):
            refused(self, "case10-reader-budget", make, t, budget=budget)
        for origin in ("http://abcdefghij0123456789.supabase.co", "https://abcdefghij0123456789.supabase.co.evil.test",
                       "https://abcdefghij0123456789.supabase.co/", "https://example.test"):
            refused(self, "case10-reader-origin", make, t, approved={"origin": origin})
        bad = dict(SCHEDULE, sessionAdds=[0, 1, 0, 1, 2, 2])
        refused(self, "case10-reader-schedule", make, t, schedule=bad)
        refused(self, "case10-reader-schedule", make, t, schedule=dict(SCHEDULE, plan=dict(SCHEDULE["plan"], auth=-1)))
        refused(self, "case10-reader-account", make, t, account="not-a-uuid")
        refused(self, "case10-reader-keys", make(t), KEYS[:-1])
        self.assertEqual(t.sent, [])


class AdmittedTransport(unittest.TestCase):
    """the registered reader's production path. The observe process keeps the blanket _netguard; the one admitted
    network path is case10_reader's own subprocess, whose environment is built from scratch and which prints only the projection."""
    CHILD = {"CT_CASE10_PASSWORD": PASSWORD, "CT_CASE10_ANON_KEY": ANON, "PATH": "/usr/bin:/bin", "HOME": "/home/x",
             "CLOUD_TEST_LIVE_ACCOUNTS": "{private bundle}", "THROWAWAY_TEST_PASSWORD": "other-secret", "GITHUB_TOKEN": "ghs_token"}

    def test_the_observe_process_is_still_netguarded_and_the_reader_module_never_imports_the_guard(self):
        import socket
        import _netguard
        self.assertIs(socket.create_connection, _netguard._deny)  # case10_observation imported the guard: this process has no network
        with open(O.READER_SCRIPT, encoding="utf-8") as f:
            self.assertNotIn("_netguard", "".join(line for line in f if line.startswith(("import", "from"))))

    def test_the_subprocess_gets_exactly_the_named_environment_and_returns_only_the_projection(self):
        calls = []

        def run(argv, env, capture_output, timeout):
            calls.append((argv, env))
            import subprocess
            return subprocess.CompletedProcess(argv, 0, json.dumps({"snapshotSizes": [1] * 6}).encode(), b"")
        read = O.subprocess_reader(ACCOUNT, BUDGET, EMAIL, environ=self.CHILD, run=run)
        self.assertEqual(read(["snapshotSizes"]), {"snapshotSizes": [1] * 6})
        argv, env = calls[0]
        self.assertEqual(argv[1:4], ["-I", O.READER_SCRIPT, "read"])
        self.assertEqual(set(env), {"PATH"} | set(C.CHILD_ENV))
        self.assertEqual((env["CT_CASE10_ACCOUNT_ID"], env["CT_CASE10_EMAIL"], env["CT_CASE10_PASSWORD"], env["CT_CASE10_ANON_KEY"]),
                         (ACCOUNT, EMAIL, PASSWORD, ANON))
        self.assertFalse(any(v in " ".join(argv) for v in (PASSWORD, ANON, EMAIL, ACCOUNT)))  # no credential or identity in argv

    def test_a_refusing_or_failing_subprocess_raises_so_the_reservation_stays_counted(self):
        import subprocess
        for rc in (78, 1):
            read = O.subprocess_reader(ACCOUNT, BUDGET, EMAIL, environ=self.CHILD,
                                       run=lambda argv, **k: subprocess.CompletedProcess(argv, rc, b"", b"BLOCKED_SETUP: x"))
            with self.assertRaises(O.Refused):
                read(KEYS)

    def test_the_real_subprocess_refuses_unpinned_before_any_request_and_prints_no_credential(self):
        import subprocess
        import sys
        env = {"PATH": "/usr/bin:/bin", "CT_CASE10_ACCOUNT_ID": ACCOUNT, "CT_CASE10_EMAIL": EMAIL, "CT_CASE10_PASSWORD": PASSWORD,
               "CT_CASE10_ANON_KEY": ANON}
        p = subprocess.run([sys.executable, "-I", O.READER_SCRIPT, "read", "--budget", json.dumps(BUDGET), "--keys", ",".join(KEYS)],
                           env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual((p.returncode, p.stdout, p.stderr.strip()), (78, "", "BLOCKED_SETUP: case10-reader-not-activated"))

    def test_once_pinned_the_cli_reads_through_the_closed_allowlist_and_prints_only_numbers(self):
        out = []
        t = Synthetic(count=5)
        env = {"CT_CASE10_ACCOUNT_ID": ACCOUNT, "CT_CASE10_EMAIL": EMAIL, "CT_CASE10_PASSWORD": PASSWORD, "CT_CASE10_ANON_KEY": ANON}
        from unittest import mock
        with mock.patch.object(C, "APPROVED", APPROVED), mock.patch.object(C, "SCHEDULE", SCHEDULE), \
                mock.patch("builtins.print", lambda *a, **k: out.append(a[0])):
            rc = C.main(["case10_reader.py", "read", "--budget", json.dumps(BUDGET), "--keys", ",".join(KEYS)], environ=env, transport=t)
        self.assertEqual((rc, t.paths()), (0, FULL))
        self.assertEqual(json.loads(out[0])["snapshotSizes"], [5, 5, 6, 6, 7, 7])
        for secret in (TOKEN, EMAIL, PASSWORD, ANON, ACCOUNT):
            self.assertNotIn(secret, out[0])
        with mock.patch.object(C, "APPROVED", APPROVED), mock.patch.object(C, "SCHEDULE", SCHEDULE), \
                mock.patch("builtins.print", lambda *a, **k: out.append(a[0])):
            t2 = Synthetic()
            rc = C.main(["case10_reader.py", "read", "--budget", json.dumps(BUDGET), "--keys", ",".join(KEYS)],
                        environ=dict(env, CT_CASE10_PASSWORD=""), transport=t2)
        self.assertEqual((rc, t2.sent, out[-1]), (78, [], "BLOCKED_SETUP: case10-reader-credentials"))


class LoginOnlyAfterTheReserve(Journal):
    """Composed control on the synthetic bare journal: the real reader, through reserve_then_read, logs in only after the persisted reserve; a
    refused reserve sends nothing and never asks for credentials; a failed read keeps the reservation counted."""
    HEADROOM = T.ReserveBeforeRead.HEADROOM
    journal = T.ReserveBeforeRead.journal
    propose = T.ReserveBeforeRead.propose
    counted = T.ReserveBeforeRead.counted

    def setUp(self):
        super().setUp()
        self.req = request(readBudget=BUDGET)

    def test_the_login_follows_the_persisted_reserve(self):
        t, cred = Synthetic(), Credentials()
        seen = []
        base = self.journal()

        def watched(event, head):
            seen.append((len(t.sent), cred.calls))
            return base.propose(event, head)
        record, event, receipt = O.reserve_then_read(make(t, credentials=cred), self.journal(propose=watched), self.req, REQUEST_SHA, "101", 1,
                                                     ACCOUNT, NOW)
        self.assertEqual((seen, t.paths(), cred.calls), ([(0, 0)], FULL, 1))
        self.assertEqual((event["allocation"]["requests"], event["allocation"]["identityReads"]), (4, 1))
        self.assertEqual(self.chain()[-1][1][-1], event)

    def test_a_refused_reserve_never_logs_in_and_a_failed_read_stays_counted(self):
        t, cred = Synthetic(), Credentials()
        refused(self, "case10-observation-no-headroom", O.reserve_then_read, make(t, credentials=cred),
                self.journal(headroom={"requests": 3, "identityReads": 1}), self.req, REQUEST_SHA, "101", 1, ACCOUNT, NOW)
        self.assertEqual((t.sent, cred.calls), ([], 0))
        t = Synthetic(uid="00000000-0000-4000-8000-000000000002")
        refused(self, "case10-observation-read-failed", O.reserve_then_read, make(t), self.journal(), self.req, REQUEST_SHA, "101", 1, ACCOUNT,
                NOW)
        self.assertEqual(self.counted()["outstandingReservations"], 1)


if __name__ == "__main__":
    unittest.main()
