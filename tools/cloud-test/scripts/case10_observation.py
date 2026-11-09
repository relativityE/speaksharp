"""Case 10 nightly current-state observation (design A). INACTIVE: no reader is trusted today.

A nightly occurrence's Case 10 projection must come from a fresh read of the bound account's current state, never a historical projection
relabelled with a new runId. The admitted request's AHT-10 row pins the observation contract (reader, record schema, allowed projection keys,
freshness). observe asks a READER for the projection and binds it to the admitted request digest, campaign/run/attempt, source, account
and observation time; admit is the check prepare applies (the builder applies its own variant). Only synthetic readers exist here: no
credentials, no network and no live read. reserve_then_read reserves the read's pinned budget on the SAME
state-ref journal through the reviewed writer's propose BEFORE invoking any reader; a failed or partial read leaves that reservation open,
so the accepted rollup keeps counting it.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: every network call fails and is counted)
from case10_request_bound import ALLOWANCE, INPUTS, BoundRefused, compute  # noqa: E402
import state_ref_writer as W  # noqa: E402

CONTRACT_SCHEMA = "speaksharp.cloud-test.case10-observation-contract.v1"
RECORD_SCHEMA = "speaksharp.cloud-test.case10-observation.v1"
CONTRACT_KEYS = {"schema", "reader", "recordSchema", "projectionKeys", "maxAgeSeconds", "readBudget"}
# The observation's own reservation key: distinct from the run's reservation (campaignId = the request runId) on the same journal.
RESERVATION_SUFFIX = ".case10-observation"
MAX_READ_BUDGET = {"requests": 50, "identityReads": 2}
RECORD_KEYS = {"schema", "requestSha256", "campaignId", "runId", "attempt", "sourceSha", "accountSubjectSha256", "reader", "observedAtUtc",
               "projection"}
READER_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "case10_reader.py")
READ_TIMEOUT_SECONDS = 120


def subprocess_reader(account_id, budget, email=None, environ=None, run=None):
    """The registered reader : the read runs in case10_reader's own subprocess, the one admitted network path, while
    this process keeps the blanket _netguard. Its environment is built from scratch: PATH plus exactly case10_reader.CHILD_ENV (the account
    id and email from the private bundle, the password and anon key from this step's Secrets); nothing else is inherited. Only the numeric
    projection comes back; a refusal or any failure raises, so the reservation stays counted. `environ`/`run` are TEST-ONLY."""
    import subprocess
    env = os.environ if environ is None else environ
    child = {"PATH": env.get("PATH", "/usr/bin:/bin"), "CT_CASE10_ACCOUNT_ID": account_id, "CT_CASE10_EMAIL": email or "",
             "CT_CASE10_PASSWORD": env.get("CT_CASE10_PASSWORD", ""), "CT_CASE10_ANON_KEY": env.get("CT_CASE10_ANON_KEY", "")}

    def read(keys):
        argv = [sys.executable, "-I", READER_SCRIPT, "read", "--budget", json.dumps(budget, sort_keys=True), "--keys", ",".join(keys)]
        p = (run or subprocess.run)(argv, env=child, capture_output=True, timeout=READ_TIMEOUT_SECONDS)
        _need(p.returncode == 0, "case10-observation-read-failed")
        return json.loads(p.stdout)
    return read


def _registered():
    import case10_reader
    return {case10_reader.READER_ID: subprocess_reader}, case10_reader.activated()


# The reviewed readers: identity -> factory(account id, read budget, email) -> callable(projection keys) -> projection. The real reader is
# registered; it is TRUSTED only once its project origin and schedule are pinned (case10_reader.activated, false today), so admit
# refuses every record and observe refuses before any reserve until then.
READERS, _READER_PINNED = _registered()
TRUSTED_READERS = frozenset(READERS) if _READER_PINNED else frozenset()
MAX_AGE_SECONDS = 3600
READER_ID = re.compile(r"[a-z0-9][a-z0-9.:@/-]{2,99}")
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _utc(value, code):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is not None, code)
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def contract_of(req):
    """The observation contract the admitted request pins on its AHT-10 row: exactly the full projection input set, bounded freshness."""
    rows = [r for r in (req.get("selection") or []) if isinstance(r, dict) and r.get("case") == "AHT-10"]
    _need(len(rows) == 1, "case10-observation-not-selected")
    c = rows[0].get("observationContract")
    _need(isinstance(c, dict) and set(c) == CONTRACT_KEYS and c["schema"] == CONTRACT_SCHEMA and c["recordSchema"] == RECORD_SCHEMA
          and isinstance(c["reader"], str) and READER_ID.fullmatch(c["reader"]) is not None
          and c["projectionKeys"] == sorted(INPUTS) and type(c["maxAgeSeconds"]) is int and 0 < c["maxAgeSeconds"] <= MAX_AGE_SECONDS
          and isinstance(c["readBudget"], dict) and set(c["readBudget"]) == set(MAX_READ_BUDGET)
          and all(type(v) is int and 0 < v <= MAX_READ_BUDGET[k] for k, v in c["readBudget"].items()), "case10-observation-contract")
    return c


def observe(reader, req, request_sha256, run_id, attempt, account_id, now):
    """One read through `reader` (a callable given the allowed projection keys), bound to this admitted request and attempt."""
    c = contract_of(req)
    _need(isinstance(request_sha256, str) and SHA64.fullmatch(request_sha256) is not None, "case10-observation-request")
    return {"schema": RECORD_SCHEMA, "requestSha256": request_sha256, "campaignId": req["runId"], "runId": run_id, "attempt": attempt,
            "sourceSha": req["release"]["testedSha"], "accountSubjectSha256": hashlib.sha256(account_id.encode("utf-8")).hexdigest(),
            "reader": c["reader"], "observedAtUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "projection": reader(list(c["projectionKeys"]))}


def admit(record, req, request_sha256, run_id, attempt, account_id, now, trusted=None):
    """Admits a record only from a trusted reader, for exactly this request, campaign, run, attempt, source and account, observed inside
    this run's window and within the contract's freshness, with exactly the allowed projection, whose bound fits the Case 10 row and the
    fixed 240 allowance. `trusted` is TEST-ONLY; production uses TRUSTED_READERS (empty today)."""
    c = contract_of(req)
    _need(c["reader"] in (TRUSTED_READERS if trusted is None else trusted), "case10-observation-reader-not-trusted")
    _need(isinstance(record, dict) and set(record) == RECORD_KEYS and record["schema"] == RECORD_SCHEMA, "case10-observation-shape")
    _need(record["reader"] == c["reader"], "case10-observation-foreign")
    _need(record["requestSha256"] == request_sha256, "case10-observation-not-this-request")
    _need(record["campaignId"] == req["runId"] and record["runId"] == run_id and type(record["attempt"]) is int
          and record["attempt"] == attempt == 1, "case10-observation-replayed")
    _need(isinstance(record["sourceSha"], str) and SHA40.fullmatch(record["sourceSha"]) is not None
          and record["sourceSha"] == req["release"]["testedSha"]
          and record["accountSubjectSha256"] == hashlib.sha256(account_id.encode("utf-8")).hexdigest(), "case10-observation-foreign")
    observed = _utc(record["observedAtUtc"], "case10-observation-time")
    _need(_utc(req["window"]["startUtc"], "case10-observation-time") <= observed <= now
          and now - observed <= timedelta(seconds=c["maxAgeSeconds"]), "case10-observation-stale")
    _need(isinstance(record["projection"], dict) and sorted(record["projection"]) == c["projectionKeys"], "case10-observation-projection")
    try:
        report = compute(record["projection"])
    except BoundRefused:
        raise Refused("case10-observation-projection")
    row = next(r for r in req["selection"] if r["case"] == "AHT-10")
    planned = row.get("plannedRequests")
    _need(type(planned) is int and report["fitsAllowance"] and report["transmittedBound"] <= planned <= ALLOWANCE,
          "case10-observation-over-allowance")
    return {"recordSha256": hashlib.sha256(canon(record)).hexdigest(), "transmittedBound": report["transmittedBound"], "allowance": ALLOWANCE}


def reservation_event(req, request_sha256, run_id, attempt, now):
    """The observation's reserve: the contract's pinned read budget, keyed apart from the run's own reservation, provenance = the request."""
    c = contract_of(req)
    allocation = {k: 0 for k in W.CATS}
    allocation.update(c["readBudget"])
    event = {"type": "reserve", "campaignId": req["runId"] + RESERVATION_SUFFIX, "runId": run_id, "attempt": attempt, "allocation": allocation,
             "provenance": "request-sha256:" + request_sha256, "atUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ")}
    try:
        return W.validate_event(event)
    except W.Refused:
        raise Refused("case10-observation-reservation-shape")


class StateJournal:
    """The reviewed state-ref journal (state_ref_writer), read into a fresh private repository. headroom(head) is the accepted continuity
    checkpoint recomputed at exactly `head`; propose(event, head) appends only with `head` as the writer's expected-head lease. `url`, `root`
    and `pins` are TEST-ONLY overrides; production uses the approved URL, the reviewed root and the continuity pins (None today)."""
    def __init__(self, checkout, req, url=None, root=None, pins=None):
        self.checkout, self.req = checkout, req
        self.url, self.root, self.pins = url or W.APPROVED_URL, root or W.REVIEWED_ROOT, pins
        _need(self.root is not None, "case10-observation-not-activated")
        import tempfile
        self.git = tempfile.mkdtemp(prefix="case10-journal-")
        _need(subprocess_ok(["git", "init", "-q", self.git]), "case10-observation-journal")

    def head(self):
        return W.fetch_head(self.git, self.url, self.url)

    def chain_at(self, head):
        return W.validate_chain(self.git, head, self.root)

    def headroom(self, head):
        import init_run_inputs as I  # lazy: init_run_inputs reaches this module through case_start_caps
        try:
            rc = I.verified_checkpoint(self.checkout, self.req, self.pins, lambda root: self.chain_at(head))
        except I.Refused as e:
            raise Refused("case10-observation-" + str(e))
        return json.loads(rc)["currentHeadroom"]

    def propose(self, event, head):
        return W.propose(self.git, self.url, head, event, self.root, self.url)


def subprocess_ok(argv):
    import subprocess
    return subprocess.run(argv, capture_output=True, env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1",
                                                          "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TEMPLATE_DIR": ""}).returncode == 0


def reserve_observation(journal, req, request_sha256, run_id, attempt, now):
    """The observation's reserve on the journal (RETURN ), run by the write-capable journal-reserve
    job (the live job stays read-only): the headroom is the accepted checkpoint at the exact head the reserve is appended
    on (the writer's expected-head lease refuses any other), the receipt must be for exactly this event on that head, and the reserve must be
    PERSISTED at the receipt's commit on a fresh chain read. Returns (event, receipt, the persisted events)."""
    event = reservation_event(req, request_sha256, run_id, attempt, now)
    try:
        head = journal.head()
        headroom = journal.headroom(head)
    except Refused:
        raise
    except Exception:
        raise Refused("case10-observation-journal")
    _need(isinstance(headroom, dict) and all(type(headroom.get(k)) is int and headroom[k] >= v for k, v in contract_of(req)["readBudget"].items()),
          "case10-observation-no-headroom")
    try:
        receipt = journal.propose(event, head)
    except W.Refused:  # the writer refused (a moved head included): nothing was appended and the read never happens
        raise Refused("case10-observation-reserve-failed")
    except Exception:  # the response was lost: the push may have landed, so reconcile from the persisted chain, never re-append
        return reconcile_lost_reserve(journal, event, head)
    _need(isinstance(receipt, dict) and set(receipt) == W.RECEIPT_KEYS and receipt["proposalSha256"] == W.sha256(W.canon(event))
          and receipt["previousSha"] == head, "case10-observation-reserve-not-accepted")
    try:
        persisted = {sha: events for sha, events, _ in journal.chain_at(journal.head())}
    except Exception:
        raise Refused("case10-observation-reserve-not-persisted")
    _need(persisted.get(receipt["newSha"], [None])[-1:] == [event], "case10-observation-reserve-not-persisted")
    return event, receipt, persisted[receipt["newSha"]]


def reconcile_lost_reserve(journal, event, head):
    """Recovery for a lost push response : one fresh verified chain read decides. The reserve counts as landed only when
    the commit directly after `head` (the lease it was proposed on) ends with exactly this event; then the run continues with no receipt.
    Otherwise it refuses without retrying or re-appending; if the push did land later in some other form, the rollup still counts it."""
    try:
        chain = journal.chain_at(journal.head())
    except Exception:
        raise Refused("case10-observation-reserve-unconfirmed")
    shas = [sha for sha, _, _ in chain]
    _need(head in shas and shas.index(head) + 1 < len(shas), "case10-observation-reserve-unconfirmed")
    sha, events, _ = chain[shas.index(head) + 1]
    _need(events[-1:] == [event], "case10-observation-reserve-unconfirmed")
    return event, None, chain[-1][1]


def held_observation(events, req, request_sha256, run_id, attempt):
    """The OPEN observation reserve for exactly this request, campaign, run and attempt, at exactly the contract's read budget, on a verified
    chain's events; a settled or released one, another request's, or a different allocation refuses."""
    c = contract_of(req)
    allocation = {k: 0 for k in W.CATS}
    allocation.update(c["readBudget"])
    state = {}
    for e in events:
        state[(e["campaignId"], e["runId"], e["attempt"])] = e if e["type"] == "reserve" else None
    e = state.get((req["runId"] + RESERVATION_SUFFIX, run_id, attempt))
    _need(e is not None and e["provenance"] == "request-sha256:" + request_sha256 and e["allocation"] == allocation,
          "case10-observation-reserve-not-held")
    return e


def read_reserved(reader, events, req, request_sha256, run_id, attempt, account_id, now):
    """The read-only live job's half: invoke the reader only when the verified chain already holds this observation's open reserve."""
    reserved = held_observation(events, req, request_sha256, run_id, attempt)
    try:
        record = observe(reader, req, request_sha256, run_id, attempt, account_id, now)
    except Refused:
        raise
    except Exception:
        raise Refused("case10-observation-read-failed")
    return record, reserved


def reserve_then_read(reader, journal, req, request_sha256, run_id, attempt, account_id, now):
    """Reserve BEFORE read, composed: the reader runs only after the persisted reserve. A reader failure after the reserve raises with the
    reservation still open, so the rollup keeps counting it."""
    event, receipt, events = reserve_observation(journal, req, request_sha256, run_id, attempt, now)
    record, _ = read_reserved(reader, events, req, request_sha256, run_id, attempt, account_id, now)
    return record, event, receipt


def settlement_event(reserved, record, now):
    """Closes the observation's reservation after a completed read: the reader measures no per-dimension usage, so every dimension settles
    at its reserved budget (never under-counted, as manual_reservation settles unmeasured dimensions), with the record's digest as evidence.
    A failed or partial read is never settled here; its reservation stays open and counted."""
    return settlement_for(reserved, hashlib.sha256(canon(record)).hexdigest(), now)


def settlement_for(reserved, record_sha256, now):
    """The same settle from the record's digest alone: journal-settle receives only the digest (settle_input.py), never the record."""
    _need(isinstance(record_sha256, str) and SHA64.fullmatch(record_sha256) is not None, "case10-observation-settlement-shape")
    event = dict(reserved, type="settle", provenance="evidence-sha256:" + record_sha256, atUtc=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    try:
        return W.validate_event(event)
    except W.Refused:
        raise Refused("case10-observation-settlement-shape")


def _read_account(path):
    _need(isinstance(path, str) and os.path.isfile(path) and not os.path.islink(path), "case10-observation-account")
    with open(path, encoding="utf-8") as f:
        account = f.read().strip()
    _need(re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", account) is not None, "case10-observation-account")
    return account


def _bundle_account(field="accountId"):
    """The Case 10 role's account id (or email) from the private CLOUD_TEST_LIVE_ACCOUNTS bundle, through prepare's own validators."""
    import init_run_inputs as I
    try:
        bundle = I.parse_live_accounts_bundle(os.environ.get("CLOUD_TEST_LIVE_ACCOUNTS"))
        return I.role_account(bundle, I.ROLE["AHT-10"], os.environ.get("SUPABASE_URL"))[field]
    except I.Refused:
        raise Refused("case10-observation-account")


def activated():
    """A real observation needs a reviewed trusted reader AND the activated state-ref writer (its reserve journal); neither exists today."""
    return bool(TRUSTED_READERS) and W.REVIEWED_ROOT is not None


def settled_digest(settle_raw, req, request_sha256, run_id):
    """The observation record's digest from the closed settle input (settle_input.validate) for exactly this request, campaign, run and
    attempt; None when the live job read no record (the reservation then stays open and counted)."""
    import settle_input as S
    try:
        doc = S.validate(settle_raw)
    except S.Refused:
        raise Refused("case10-observation-settle-input")
    p = doc["executionProvenance"]
    _need(doc["runId"] == req["runId"] and p["runId"] == run_id and p["attempt"] == 1 and p["requestSha256"] == request_sha256,
          "case10-observation-settle-input")
    return doc["case10ObservationSha256"]


def main(argv):
    """Three steps, one per job, so the live job never writes :
    `reserve` (journal-reserve, contents: write) appends the observation's reserve; `observe` (live, contents: read) reads only when the
    verified chain already holds that open reserve and writes the record; `settle` (journal-settle, contents: write) closes the reserve with
    the record's digest from the closed settle input, and with no record leaves it open and counted. Each reads exactly the gate-admitted request bytes and does nothing
    when its AHT-10 row pins no observation contract; otherwise each refuses `case10-observation-not-activated` until a trusted reader and the
    activated writer exist. Exit 78 on every refusal; no value is printed."""
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("reserve", "observe", "settle"))
    for flag in ("--request", "--request-sha256", "--run-id", "--attempt"):
        a.add_argument(flag, required=True)
    a.add_argument("--out")  # observe: the record path
    a.add_argument("--settle-input")  # settle: the closed settle input the live job produced (absent: the reservation stays open and counted)
    a.add_argument("--repo", default=os.getcwd())  # the checkout holding the accepted continuity inputs
    a.add_argument("--account-id-file")  # the Case 10 role's account id, private; needed only once activated
    x = a.parse_args(argv[1:])
    try:
        _need(os.path.isfile(x.request) and not os.path.islink(x.request), "case10-observation-request")
        with open(x.request, "rb") as f:
            raw = f.read()
        _need(hashlib.sha256(raw).hexdigest() == x.request_sha256, "case10-observation-request")
        req = json.loads(raw)
        rows = [r for r in req.get("selection") or [] if isinstance(r, dict) and r.get("case") == "AHT-10"]
        if not rows or "observationContract" not in rows[0]:
            return 0
        c = contract_of(req)
        _need(x.attempt == "1", "case10-observation-replayed")
        if x.command == "observe":
            _need(isinstance(x.out, str) and not os.path.lexists(x.out), "case10-observation-output-exists")
        if x.command == "settle" and not (x.settle_input and os.path.isfile(x.settle_input) and not os.path.islink(x.settle_input)):
            return 0  # no collected settle input: the reservation stays open and counted
        _need(activated(), "case10-observation-not-activated")
        journal = StateJournal(x.repo, req)
        now = datetime.now(timezone.utc).replace(microsecond=0)
        if x.command == "reserve":
            reserve_observation(journal, req, x.request_sha256, x.run_id, 1, now)
            return 0
        events = journal.chain_at(journal.head())[-1][1]
        if x.command == "settle":
            with open(x.settle_input, "rb") as f:
                digest = settled_digest(f.read(), req, x.request_sha256, x.run_id)
            if digest is None:
                return 0  # no observation record: the reservation stays open and counted
            reserved = held_observation(events, req, x.request_sha256, x.run_id, 1)
            journal.propose(settlement_for(reserved, digest, now), journal.head())
            return 0
        account = _read_account(x.account_id_file) if x.account_id_file else _bundle_account()
        email = None if x.account_id_file else _bundle_account("email")
        reader = READERS[c["reader"]](account, c["readBudget"], email)
        record, _ = read_reserved(reader, events, req, x.request_sha256, x.run_id, 1, account, now)
        fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(record, sort_keys=True))
        return 0
    except (Refused, W.Refused, OSError, ValueError) as e:
        print("BLOCKED_SETUP: " + (str(e) if isinstance(e, Refused) else "case10-observation-request"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
