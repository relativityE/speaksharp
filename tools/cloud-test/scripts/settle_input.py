"""The closed settle input the read-only live job hands to journal-settle (Sam 1793580806.654369), in place of the collector's full run record.

The repository is public, so the hand-off artifact carries only what settling needs, all of it content-free: the run record's campaign and
execution identity (campaign, GitHub run, attempt, admitted request digest), its measured G5 spend counts, the full record's digest as
evidence, and the Case 10 observation record's digest (or null). No case result, account, row, transcript, credential or path. Both sides
apply the same closed validation: `project` in the live job, `validate` in journal-settle before any use. The settle event is computed by
manual_reservation.usage_from_record, which reads exactly these fields, so the settled usage is the same as from the full record.
Usage: settle_input.py project --record RUN_RECORD --out OUT [--case10-observation RECORD] | validate --input IN    exit 78 on refusal.
"""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: every network call fails and is counted)
from manual_reservation import G5_KEYS, RUN_RECORD_SCHEMA  # noqa: E402

KEYS = {"schema", "runId", "executionProvenance", "spend", "recordSha256", "case10ObservationSha256"}
PROVENANCE_KEYS = {"campaignId", "runId", "attempt", "requestSha256"}
MAX_BYTES = 4096
CAMPAIGN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}")
RUN = re.compile(r"[1-9][0-9]{0,19}")
SHA64 = re.compile(r"[0-9a-f]{64}")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def check(doc):
    """The closed shape: exactly these keys, every value a bounded id, digest, attempt or count."""
    _need(isinstance(doc, dict) and set(doc) == KEYS and doc["schema"] == RUN_RECORD_SCHEMA, "settle-input-shape")
    p, spend = doc["executionProvenance"], doc["spend"]
    _need(isinstance(doc["runId"], str) and CAMPAIGN.fullmatch(doc["runId"]) is not None
          and isinstance(p, dict) and set(p) == PROVENANCE_KEYS and p["campaignId"] == doc["runId"]
          and isinstance(p["runId"], str) and RUN.fullmatch(p["runId"]) is not None and type(p["attempt"]) is int and p["attempt"] >= 1
          and isinstance(p["requestSha256"], str) and SHA64.fullmatch(p["requestSha256"]) is not None, "settle-input-identity")
    _need(isinstance(spend, dict) and set(spend) == set(G5_KEYS)
          and all(v is None or (type(v) is int and v >= 0) for v in spend.values()), "settle-input-spend")
    _need(isinstance(doc["recordSha256"], str) and SHA64.fullmatch(doc["recordSha256"]) is not None
          and (doc["case10ObservationSha256"] is None
               or (isinstance(doc["case10ObservationSha256"], str) and SHA64.fullmatch(doc["case10ObservationSha256"]) is not None)),
          "settle-input-evidence")
    return doc


def project(record_raw, observation_raw=None):
    """The closed settle input from the collector's run-record BYTES (and the Case 10 observation record's bytes, when one was read)."""
    _need(isinstance(record_raw, bytes), "settle-input-record")
    try:
        rec = json.loads(record_raw)
    except ValueError:
        raise Refused("settle-input-record")
    _need(isinstance(rec, dict) and isinstance(rec.get("executionProvenance"), dict) and isinstance(rec.get("spend"), dict), "settle-input-record")
    prov = rec["executionProvenance"]
    doc = {"schema": rec.get("schema"), "runId": rec.get("runId"),
           "executionProvenance": {k: prov.get(k) for k in PROVENANCE_KEYS}, "spend": {k: rec["spend"].get(k) for k in G5_KEYS},
           "recordSha256": hashlib.sha256(record_raw).hexdigest(),
           "case10ObservationSha256": None if observation_raw is None else hashlib.sha256(observation_raw).hexdigest()}
    raw = canon(check(doc))
    _need(len(raw) <= MAX_BYTES, "settle-input-size")
    return raw


def validate(raw):
    _need(isinstance(raw, bytes) and len(raw) <= MAX_BYTES, "settle-input-size")
    try:
        doc = json.loads(raw)
    except ValueError:
        raise Refused("settle-input-shape")
    check(doc)
    _need(canon(doc) == raw, "settle-input-not-canonical")
    return doc


def _read(path):
    _need(isinstance(path, str) and os.path.isfile(path) and not os.path.islink(path), "settle-input-unreadable")
    with open(path, "rb") as f:
        return f.read()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("project", "validate"))
    a.add_argument("--record")
    a.add_argument("--case10-observation")
    a.add_argument("--out")
    a.add_argument("--input")
    x = a.parse_args(argv[1:])
    try:
        if x.command == "validate":
            validate(_read(x.input))
            return 0
        _need(isinstance(x.out, str) and not os.path.lexists(x.out), "settle-input-output-exists")
        observation = _read(x.case10_observation) if x.case10_observation and os.path.lexists(x.case10_observation) else None
        raw = project(_read(x.record), observation)
        fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        return 0
    except (Refused, OSError) as e:
        print("BLOCKED_SETUP: " + (str(e) if isinstance(e, Refused) else "settle-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
