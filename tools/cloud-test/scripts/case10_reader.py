"""Case 10 current-state reader (Sam 1793575145.256299, J2). INACTIVE: no approved project origin and no pinned schedule exist today.

The only account state the Case 10 bound depends on is the owner's starting session count: every owner-session scan reads that count plus the
sessions the case's own schedule saves before the scan. Lease, queue, obligation and plan counts are client- and schedule-determined (a fresh
browser context starts with an empty local reconcile queue), so they come from the pinned schedule, never from the account.

One read, in this exact order, through a closed endpoint allowlist on the one approved project origin:
  1. POST /auth/v1/token?grant_type=password   login as the bound disposable account (the identity read; it CREATES an auth session)
  2. GET  /auth/v1/user                        the authenticated UID must equal the bound account id
  3. HEAD /rest/v1/sessions?select=id&user_id=eq.<uid>  with Prefer: count=exact; only the Content-Range total is read, never a row
  4. POST /auth/v1/logout?scope=local          revokes ONLY that session (Sam 1793580999.418089: an unscoped logout is global and would end the
                                               account's other sessions); attempted whenever step 1 issued a session-bound token, failure included
At most 4 requests (a ceiling; a failed path stops early) and 1 identity read. No retry, no token refresh, no pagination. A token without a
session binding (no session_id claim, or a subject other than the bound account) refuses at once and is never used, not even to log out. The caller reserves the read budget on the state-ref journal
BEFORE invoking the reader (case10_observation.reserve_then_read), so the login happens only after a persisted reserve. Nothing is retained
but the numeric projection: no rows, ids, tokens, emails or response bodies.
"""
import argparse
import base64
import json
import os
import re
import sys
from urllib.parse import urlencode

# The approved project, pinned at activation: {"origin": "https://<ref>.supabase.co"}. None today: every reader refuses.
APPROVED = None
# The reviewed AHT-10 schedule, pinned at activation: "sessionAdds" (sessions the case saves before each of the 6 scans, non-decreasing) and
# "plan" (every other bound input). None today: every reader refuses.
SCHEDULE = None
READER_ID = "speaksharp:case10-owner-state@1"
REQUESTS = 4
IDENTITY_READS = 1
SCANS = 6
MAX_BODY = 65536
ORIGIN = re.compile(r"https://[a-z0-9]{20}\.supabase\.co")
UUID4 = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
CONTENT_RANGE = re.compile(r"(?:\*|\d+-\d+)/(\d+)")
PLAN_KEYS = {"leaseHeldIntervalsMs", "scanObligationCounts", "loadQueueSizes", "saveEvaluationInvocations", "distinctRetryDebtsUpperBound",
             "historyQueryLifecycles", "recommendationSettlementInvocations", "leaseAcquisitions", "leaseConfirmations",
             "openAttemptAdvances", "cancelledAttempts", "localRetrySkips", "bootstrap", "auth", "navigation", "modelAcquisition",
             "preflights", "successorSave", "evidenceTail"}
SESSION_ID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
# The closed allowlist: (method, path) -> the exact query that request carries (the owner filter's value is checked against the account).
ENDPOINTS = {("POST", "/auth/v1/token"): (("grant_type", "password"),), ("GET", "/auth/v1/user"): (),
             ("HEAD", "/rest/v1/sessions"): (("select", "id"), ("user_id", None)), ("POST", "/auth/v1/logout"): (("scope", "local"),)}


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _count(v):
    return type(v) is int and v >= 0


def check_schedule(schedule):
    _need(isinstance(schedule, dict) and set(schedule) == {"sessionAdds", "plan"}, "case10-reader-schedule")
    adds, plan = schedule["sessionAdds"], schedule["plan"]
    _need(isinstance(adds, list) and len(adds) == SCANS and all(_count(a) for a in adds) and adds == sorted(adds)
          and isinstance(plan, dict) and set(plan) == PLAN_KEYS
          and all((isinstance(v, list) and all(_count(x) for x in v)) if k in ("leaseHeldIntervalsMs", "scanObligationCounts", "loadQueueSizes")
                  else _count(v) for k, v in plan.items()), "case10-reader-schedule")
    return schedule


def derive(session_count, schedule):
    """The numeric projection: each scan sees the starting count plus the schedule's additions; everything else is the pinned plan."""
    _need(_count(session_count), "case10-reader-count")
    p = {k: (list(v) if isinstance(v, list) else v) for k, v in schedule["plan"].items()}
    p["snapshotSizes"] = [session_count + a for a in schedule["sessionAdds"]]
    return p


class _Budget:
    """Every request passes here BEFORE it is sent: closed allowlist, fixed origin, total and identity caps."""
    def __init__(self, transport, origin, requests, identity_reads, account_id=None):
        self.transport, self.origin, self.left, self.identity_left, self.account_id = transport, origin, requests, identity_reads, account_id

    def send(self, method, path, query, headers, body=None):
        allowed = ENDPOINTS.get((method, path))
        query = tuple(query)
        _need(allowed is not None and len(query) == len(allowed)
              and all(q[0] == a[0] and (q[1] == a[1] if a[1] is not None else q[1] == "eq." + str(self.account_id))
                      for q, a in zip(query, allowed)), "case10-reader-endpoint-not-allowed")
        _need(self.left > 0, "case10-reader-request-cap")
        identity = path == "/auth/v1/token"
        _need(not identity or self.identity_left > 0, "case10-reader-identity-cap")
        self.left -= 1
        if identity:
            self.identity_left -= 1
        url = self.origin + path + ("?" + urlencode(query) if query else "")
        try:
            status, response_headers, data = self.transport(method, url, headers, body)
        except Exception:
            raise Refused("case10-reader-transport")
        _need(type(status) is int and isinstance(response_headers, dict) and isinstance(data, bytes) and len(data) <= MAX_BODY,
              "case10-reader-response")
        return status, {str(k).lower(): v for k, v in response_headers.items()}, data


def _json(data):
    try:
        return json.loads(data)
    except ValueError:
        raise Refused("case10-reader-response")


def session_bound(token, account_id):
    """The access token's own session binding (its JWT claims, read locally, never verified or sent anywhere): a session_id and the bound
    account as subject. Absent or foreign: refuse, so a cleanup can never act on anything but this read's own session."""
    parts = token.split(".") if isinstance(token, str) else []
    _need(len(parts) == 3, "case10-reader-session-unbound")
    try:
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + "=" * (-len(parts[1]) % 4)))
    except (ValueError, TypeError):
        raise Refused("case10-reader-session-unbound")
    _need(isinstance(claims, dict) and claims.get("sub") == account_id and isinstance(claims.get("session_id"), str)
          and SESSION_ID.fullmatch(claims["session_id"]) is not None, "case10-reader-session-unbound")


def make_reader(transport, account_id, credentials, anon_key, budget, approved=None, schedule=None):
    """A reader for case10_observation: callable(projection keys) -> projection. `approved`/`schedule` are TEST-ONLY overrides; production
    uses the pins above (None today, so this refuses before any request). `credentials` is a callable returning (email, password), called
    only after the caller's reserve; neither value is retained or reported."""
    ap = APPROVED if approved is None else approved
    sc = SCHEDULE if schedule is None else schedule
    _need(ap is not None and sc is not None, "case10-reader-not-activated")
    _need(isinstance(ap, dict) and set(ap) == {"origin"} and isinstance(ap["origin"], str) and ORIGIN.fullmatch(ap["origin"]) is not None,
          "case10-reader-origin")
    check_schedule(sc)
    _need(isinstance(account_id, str) and UUID4.fullmatch(account_id) is not None, "case10-reader-account")
    _need(isinstance(anon_key, str) and anon_key != "", "case10-reader-anon-key")
    _need(isinstance(budget, dict) and budget.get("requests") == REQUESTS and budget.get("identityReads") == IDENTITY_READS,
          "case10-reader-budget")

    def read(keys):
        _need(sorted(keys) == sorted(PLAN_KEYS | {"snapshotSizes"}), "case10-reader-keys")
        b = _Budget(transport, ap["origin"], REQUESTS, IDENTITY_READS, account_id)
        base = {"apikey": anon_key, "Accept": "application/json"}
        email, password = credentials()
        status, _, data = b.send("POST", "/auth/v1/token", [("grant_type", "password")], dict(base, **{"Content-Type": "application/json"}),
                                 json.dumps({"email": email, "password": password}).encode("utf-8"))
        del email, password
        _need(status == 200, "case10-reader-login")
        token = _json(data).get("access_token")
        _need(isinstance(token, str) and token != "", "case10-reader-login")
        session_bound(token, account_id)
        auth = dict(base, Authorization="Bearer " + token)
        try:
            status, _, data = b.send("GET", "/auth/v1/user", [], auth)
            _need(status == 200, "case10-reader-uid")
            user = _json(data)
            _need(isinstance(user, dict) and user.get("id") == account_id, "case10-reader-uid-mismatch")
            status, h, _ = b.send("HEAD", "/rest/v1/sessions", [("select", "id"), ("user_id", "eq." + account_id)],
                                  dict(auth, Prefer="count=exact"))
            _need(status in (200, 206), "case10-reader-count")
            m = CONTENT_RANGE.fullmatch(str(h.get("content-range", "")))
            _need(m is not None, "case10-reader-count")
            projection = derive(int(m.group(1)), sc)
        finally:
            try:
                b.send("POST", "/auth/v1/logout", [("scope", "local")], auth)  # this session only; its outcome never changes the result
            except Refused:
                pass
        return {k: projection[k] for k in keys}

    return read


def activated():
    """The reader is trusted only once the approved project origin and the reviewed schedule are both pinned (neither is today)."""
    return APPROVED is not None and SCHEDULE is not None


def urllib_transport(method, url, headers, body):
    """The admitted live transport: no redirects, no proxies, no cookies, 15 s timeout, bounded body. It runs only in this module's own `read`
    subprocess (never in the _netguard-blocked observe process), behind the closed allowlist and caps above."""
    import urllib.error
    import urllib.request

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_a, **_k):
            return None

    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with opener.open(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), b""


# The subprocess interface (Sam 1793582780.014609): the observe process keeps the blanket _netguard; the ONE admitted network path is this
# module run as `python3 -I case10_reader.py read`, which never imports _netguard and enforces the closed allowlist and caps itself. Its whole
# environment is these names, set by case10_observation from the private bundle and the step's Secrets; nothing is printed but the numeric
# projection.
CHILD_ENV = ("CT_CASE10_ACCOUNT_ID", "CT_CASE10_EMAIL", "CT_CASE10_PASSWORD", "CT_CASE10_ANON_KEY")


def main(argv, environ=None, transport=None):
    env = os.environ if environ is None else environ
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("read",))
    a.add_argument("--budget", required=True)  # the contract's readBudget, as JSON
    a.add_argument("--keys", required=True)  # the contract's projection keys, comma-separated
    x = a.parse_args(argv[1:])
    try:
        try:
            budget = json.loads(x.budget)
        except ValueError:
            raise Refused("case10-reader-budget")
        def credentials():
            email, password = env.get("CT_CASE10_EMAIL"), env.get("CT_CASE10_PASSWORD")
            _need(isinstance(email, str) and email != "" and isinstance(password, str) and password != "", "case10-reader-credentials")
            return email, password
        read = make_reader(transport or urllib_transport, env.get("CT_CASE10_ACCOUNT_ID"), credentials, env.get("CT_CASE10_ANON_KEY"), budget)
        print(json.dumps(read(x.keys.split(",")), sort_keys=True))
        return 0
    except Refused as e:
        print("BLOCKED_SETUP: " + str(e), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
