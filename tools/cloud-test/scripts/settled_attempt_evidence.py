#!/usr/bin/env python3
"""Evidence that a RESERVED attempt was SETTLED but left no publishable record (run 42483030590).

The run reserved, its live job completed with failure, its settle job appended the settle, but collection refused the record
(`run-record-not-publishable:row-verdicts`), so the latest record stays `incomplete` with no completion candidate and every later `begin`
refuses `previous-attempt-unreconciled`. Neither existing retirement fits: the run reserved (not `never-reserved`) and is settled (not an
open reserve). This proves a SETTLED attempt only; it does not assert that any case or driver executed. `collect` is the authority: it
reads GitHub's run and jobs and freshly validates the journal from the pinned root, binding
  identity the record's in-progress run, attempt and head;
  run completed, conclusion `failure`;
  jobs every job of that run/attempt/head completed; the record-begin, reserve, live, settle and record-complete jobs exactly once each,
            all `success` but the live job (`failure`);
  journal EXACTLY one reserve and one settle for this run, the settle commit the direct child of the reserve commit, the settle's
            `evidence-sha256:` provenance and its allocation copied unchanged.
`check` is structural validation of such a document only, not an independent authentication of supplied JSON. It retires history only:
no re-settlement, no amount change, no case result, no fictional completion. Anything else refuses (exit 78)."""
import argparse
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (git is the only transport, via state_ref_writer)
import unexecuted_attempt_evidence as U  # noqa: E402  (shared job shaping and the approved journal read)

SCHEMA = "speaksharp.cloud-test.settled-attempt-evidence.v1"
JOBS = (("beginJob", "Record the attempt", ("success",)),
        ("reserveJob", "Reserve the run on the state-ref journal", ("success",)),
        ("liveJob", "Selected live journeys", ("failure",)),
        ("settleJob", "Settle the run's reservation", ("success",)),
        ("recordJob", "Complete or interrupt the attempt", ("success",)))
CATS = ("requests", "identityReads", "starts", "takes", "coachingRequests", "runnerMinutes")
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")
UTC = re.compile(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":")).encode()


def _allocation(a):
    _need(isinstance(a, dict) and set(a) == set(CATS) and all(type(a[k]) is int and a[k] >= 0 for k in CATS), "settled-allocation")
    return {k: a[k] for k in CATS}


def build_evidence(run, jobs_doc, chain, root_sha, collected_utc, jobs_spec=JOBS, conclusions=("failure",), schema=SCHEMA):
    _need(isinstance(run, dict), "settled-run")
    ident = {"runId": str(run.get("id")), "attempt": run.get("run_attempt"), "headSha": run.get("head_sha")}
    _need(re.fullmatch(r"[1-9][0-9]{0,19}", ident["runId"]) is not None and ident["attempt"] == 1
          and isinstance(ident["headSha"], str) and SHA40.fullmatch(ident["headSha"]) is not None, "settled-run")
    _need(run.get("status") == "completed" and run.get("conclusion") in conclusions, "settled-run-not-failed")
    updated = run.get("updated_at")
    _need(isinstance(updated, str) and UTC.fullmatch(updated) is not None, "settled-run-time")
    try:
        jobs = U._shape_jobs(jobs_doc)
    except U.Refused as e:
        raise Refused("settled-" + str(e))
    _need(jobs and all((j["runId"], j["attempt"], j["headSha"]) == (ident["runId"], 1, ident["headSha"]) for j in jobs), "settled-job-not-of-the-run")
    _need(all(j["status"] == "completed" for j in jobs), "settled-job-not-completed")
    seen = {}
    for key, prefix, wanted in jobs_spec:
        found = [j for j in jobs if isinstance(j["name"], str) and j["name"].startswith(prefix)]
        _need(len(found) == 1 and found[0]["conclusion"] in wanted, "settled-" + key)
        seen[key] = found[0]["conclusion"]
    _need(isinstance(chain, list) and len(chain) >= 3 and chain[0][0] == root_sha and chain[0][1] == [], "settled-journal-root")
    events = chain[-1][1]
    mine = [(i, e) for i, e in enumerate(events) if isinstance(e, dict) and e.get("runId") == ident["runId"] and e.get("attempt") == 1]
    _need([e["type"] for _, e in mine] == ["reserve", "settle"], "settled-journal-not-one-reserve-and-settle")
    (ri, reserve), (si, settle) = mine
    _need(settle["campaignId"] == reserve["campaignId"] and si == ri + 1, "settled-journal-pair")
    # chain[k] holds events[:k] (one event per commit from the empty root), so commit k added event k-1
    reserve_sha, settle_sha = chain[ri + 1][0], chain[si + 1][0]
    _need(chain[ri + 1][1][-1] == reserve and chain[si + 1][1][-1] == settle, "settled-journal-commit")
    prov = settle.get("provenance")
    _need(isinstance(prov, str) and re.fullmatch(r"evidence-sha256:[0-9a-f]{64}", prov) is not None, "settled-settle-provenance")
    _need(isinstance(reserve.get("provenance"), str) and reserve["provenance"].startswith("request-sha256:"), "settled-reserve-provenance")
    _need(isinstance(settle.get("atUtc"), str) and UTC.fullmatch(settle["atUtc"]) is not None, "settled-settle-time")
    _need(isinstance(collected_utc, str) and UTC.fullmatch(collected_utc) is not None and updated <= collected_utc, "settled-collected-time")
    return {"schema": schema, "identity": ident,
            "run": {"status": "completed", "conclusion": run["conclusion"], "updatedAt": updated},
            "jobs": seen,
            "journal": {"rootSha": root_sha, "headSha": chain[-1][0], "reserveSha": reserve_sha, "settleSha": settle_sha,
                        "campaignId": settle["campaignId"], "settleAtUtc": settle["atUtc"], "settleEvidenceSha256": prov.split(":", 1)[1],
                        "reservedAllocation": _allocation(reserve.get("allocation")), "settledAllocation": _allocation(settle.get("allocation"))},
            "collectedUtc": collected_utc}


# a pending completion whose attestation expired may be retired only on terminal and settlement evidence, never on an empty
# artifact listing alone. Same authority as above (GitHub's run and jobs, the freshly validated journal from the pinned root), for a run
# that PUBLISHED a pending candidate: completed `success` or `failure`; record-begin, reserve and settle `success`; the live job `success` or
# `failure`; record-complete `success` or `failure` (its PATCH already stored the candidate); EXACTLY one reserve and the directly following
# settle. It proves terminal state and settlement only, never a result.
PENDING_SCHEMA = "speaksharp.cloud-test.pending-attempt-evidence.v1"
PENDING_JOBS = (("beginJob", "Record the attempt", ("success",)),
                ("reserveJob", "Reserve the run on the state-ref journal", ("success",)),
                ("liveJob", "Selected live journeys", ("success", "failure")),
                ("settleJob", "Settle the run's reservation", ("success",)),
                ("recordJob", "Complete or interrupt the attempt", ("success", "failure")))


def build_pending_evidence(run, jobs_doc, chain, root_sha, collected_utc):
    _need(isinstance(run, dict) and run.get("status") == "completed" and run.get("conclusion") in ("success", "failure"), "pending-run-not-terminal")
    try:
        return build_evidence(run, jobs_doc, chain, root_sha, collected_utc, PENDING_JOBS, ("success", "failure"), PENDING_SCHEMA)
    except Refused as e:
        raise Refused(str(e).replace("settled-", "pending-", 1))


def check_pending_evidence(doc):
    """(digest, settledAllocation) of a structurally exact pending-attempt document."""
    _need(isinstance(doc, dict) and doc.get("schema") == PENDING_SCHEMA and isinstance(doc.get("run"), dict) and isinstance(doc.get("jobs"), dict),
          "pending-evidence-shape")
    r, j = doc["run"], doc["jobs"]
    _need(r.get("conclusion") in ("success", "failure") and set(j) == {k for k, _p, _w in PENDING_JOBS}
          and all(j[k] in wanted for k, _p, wanted in PENDING_JOBS), "pending-evidence-shape")
    shadow = dict(doc, schema=SCHEMA, run=dict(r, conclusion="failure"),
                  jobs={"beginJob": "success", "reserveJob": "success", "liveJob": "failure", "settleJob": "success", "recordJob": "success"})
    try:
        _digest, settled = check_evidence(shadow)
    except Refused as e:
        raise Refused(str(e).replace("settled-", "pending-", 1))
    return hashlib.sha256(canon(doc)).hexdigest(), settled


def check_evidence(doc):
    """(digest, settledAllocation) of a structurally exact document; recomputes nothing it cannot, refuses anything outside the shape."""
    _need(isinstance(doc, dict) and set(doc) == {"schema", "identity", "run", "jobs", "journal", "collectedUtc"} and doc["schema"] == SCHEMA,
          "settled-evidence-shape")
    i, r, j, jr = doc["identity"], doc["run"], doc["jobs"], doc["journal"]
    _need(isinstance(i, dict) and set(i) == {"runId", "attempt", "headSha"} and re.fullmatch(r"[1-9][0-9]{0,19}", str(i["runId"])) is not None
          and i["attempt"] == 1 and isinstance(i["headSha"], str) and SHA40.fullmatch(i["headSha"]) is not None, "settled-evidence-shape")
    _need(r == {"status": "completed", "conclusion": "failure", "updatedAt": r.get("updatedAt")} and UTC.fullmatch(str(r.get("updatedAt"))) is not None,
          "settled-evidence-shape")
    _need(j == {"beginJob": "success", "reserveJob": "success", "liveJob": "failure", "settleJob": "success", "recordJob": "success"}, "settled-evidence-shape")
    _need(isinstance(jr, dict) and set(jr) == {"rootSha", "headSha", "reserveSha", "settleSha", "campaignId", "settleAtUtc", "settleEvidenceSha256",
                                               "reservedAllocation", "settledAllocation"}
          and all(isinstance(jr[k], str) and SHA40.fullmatch(jr[k]) for k in ("rootSha", "headSha", "reserveSha", "settleSha"))
          and len({jr["reserveSha"], jr["settleSha"]}) == 2 and isinstance(jr["settleEvidenceSha256"], str) and SHA64.fullmatch(jr["settleEvidenceSha256"])
          and UTC.fullmatch(str(jr["settleAtUtc"])) is not None and isinstance(jr["campaignId"], str), "settled-evidence-shape")
    _allocation(jr["reservedAllocation"])
    settled = _allocation(jr["settledAllocation"])
    _need(all(settled[k] <= jr["reservedAllocation"][k] for k in CATS), "settled-settle-exceeds-reservation")
    _need(r["updatedAt"] <= doc["collectedUtc"] and UTC.fullmatch(str(doc["collectedUtc"])) is not None, "settled-evidence-shape")
    return hashlib.sha256(canon(doc)).hexdigest(), settled


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("collect", "check", "collect-pending", "check-pending"))
    for flag in ("--run", "--jobs", "--out", "--evidence", "--collected-utc"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        if x.command in ("check", "check-pending"):
            with open(x.evidence, "rb") as f:
                digest, _ = (check_evidence if x.command == "check" else check_pending_evidence)(json.loads(f.read()))
            print(digest)
            return 0
        _need(bool(x.run and x.jobs and x.out and x.collected_utc), "settled-input-unreadable")
        with open(x.run, encoding="utf-8") as f:
            run = json.load(f)
        with open(x.jobs, encoding="utf-8") as f:
            jobs = json.load(f)
        import state_ref_writer as W
        if x.command == "collect-pending":
            doc = build_pending_evidence(run, jobs, U.fetch_chain(), W.REVIEWED_ROOT, x.collected_utc)
            check_pending_evidence(doc)
        else:
            doc = build_evidence(run, jobs, U.fetch_chain(), W.REVIEWED_ROOT, x.collected_utc)
            check_evidence(doc)
        fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(canon(doc) + b"\n")
        return 0
    except (Refused, OSError, ValueError, TypeError, KeyError) as e:
        known = isinstance(e, Refused) or e.__class__.__name__ == "Refused"
        print("BLOCKED_SETUP: " + (str(e) if known else "settled-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
