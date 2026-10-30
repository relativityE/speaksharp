#!/usr/bin/env python3
"""Assembles isolation.json (schema isolation.v2) from the raw account probes taken by the run environment, so the evidence is computed, not typed.
Three probes of the dedicated account's WHOLE scope are needed (the probe itself is a guarded, account-scoped read: see NIGHTLY-REGRESSION.md section 5):
  before  the clean-start probe, before the first journey
  mid     after the last journey and before cleanup (what the run created)
  after   after cleanup (what survived)
Each probe is {"accountIdSha256", "queriedUtc", "source", "records": [{"kind", "idSha256", "marker"|null}], "ownedPagesOpen"?, "ownedProcessesRunning"?} where idSha256 is the
hash of the record id (no raw ids or content are retained). The assembler computes: totals and counts per kind, records left by earlier runs (before: any record),
records with another run's marker, created (mid minus before), deleted (mid minus after), survivors (after), and a state digest of each snapshot for continuity.
Usage: isolation_assemble.py --request R.json --run-record RR.json --before B.json --mid M.json --after A.json --marker M [--generated ISO] --out isolation.json
Exit 78 when a probe is missing or malformed."""
import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import load, dump, now_utc, is_hex64  # noqa: E402


def digest(records):
    return hashlib.sha256("\n".join(sorted("%s:%s" % (r["kind"], r["idSha256"]) for r in records)).encode()).hexdigest() if records else "empty"


def kinds(records):
    out = {}
    for r in records:
        out[r["kind"]] = out.get(r["kind"], 0) + 1
    return out


def ids(records):
    return {(r["kind"], r["idSha256"]) for r in records}


def assemble(req, run_record, before, mid, after, marker, generated=None, account_kind="dedicated-nightly"):
    for name, p in (("before", before), ("mid", mid), ("after", after)):
        if not (isinstance(p, dict) and is_hex64(p.get("accountIdSha256")) and p.get("queriedUtc") and p.get("source") and isinstance(p.get("records"), list)):
            raise ValueError("the %s probe is missing or malformed" % name)
        if any(not (r.get("kind") and is_hex64(r.get("idSha256"))) for r in p["records"]):
            raise ValueError("the %s probe has a record without a kind or a hashed id" % name)
    sha = before["accountIdSha256"]
    if not (mid["accountIdSha256"] == sha == after["accountIdSha256"]):
        raise ValueError("the probes were not all taken for the same account")
    b, m, a = before["records"], mid["records"], after["records"]
    created = [r for r in m if (r["kind"], r["idSha256"]) not in ids(b)]
    deleted = [r for r in m if (r["kind"], r["idSha256"]) not in ids(a)]
    return {
        "schema": "speaksharp.cloud-test.isolation.v2", "runId": req["runId"], "marker": marker, "generatedUtc": generated or now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "account": {"idSha256": sha, "kind": account_kind, "dedicated": account_kind == "dedicated-nightly"},
        "run": {"startedUtc": run_record["startedUtc"], "endedUtc": run_record["endedUtc"]},
        "before": {"queriedUtc": before["queriedUtc"], "source": before["source"], "accountIdSha256": sha, "scope": "account-all-records", "totalRecords": len(b),
                   "recordsFromEarlierRuns": len(b), "recordsWithOtherMarkers": sum(1 for r in b if r.get("marker") and r["marker"] != marker), "byKind": kinds(b), "stateDigest": digest(b)},
        "after": {"queriedUtc": after["queriedUtc"], "source": after["source"], "accountIdSha256": sha, "scope": "account-all-records", "totalRecords": len(a),
                  "markedRecordsRemaining": sum(1 for r in a if r.get("marker") == marker), "ownedPagesOpen": after.get("ownedPagesOpen", None), "ownedProcessesRunning": after.get("ownedProcessesRunning", None),
                  "byKind": kinds(a), "stateDigest": digest(a)},
        "created": kinds(created), "deleted": kinds(deleted),
    }


def main():
    a = argparse.ArgumentParser()
    for k in ("request", "run-record", "before", "mid", "after", "marker", "out"):
        a.add_argument("--" + k, required=True)
    a.add_argument("--generated")
    x = a.parse_args()
    try:
        out = assemble(load(x.request), load(x.run_record), load(x.before), load(x.mid), load(x.after), x.marker, x.generated)
    except (ValueError, KeyError, OSError) as e:
        print("BLOCKED_SETUP: %s" % e, file=sys.stderr)
        sys.exit(78)
    dump(out, x.out)
    print("isolation evidence assembled for %s: before %d, created %s, deleted %s, after %d" % (out["runId"], out["before"]["totalRecords"], out["created"], out["deleted"], out["after"]["totalRecords"]))


if __name__ == "__main__":
    main()
