#!/usr/bin/env python3
"""Evidence that a RESERVED attempt did not execute: the reservation was appended, the live job then failed in setup, and no credential-bearing
(so no product-capable) step ran. One closed, DETERMINISTIC document, with no collection time, that three consumers recompute and compare: the
accounting settle (manual_reservation.py `settle-unexecuted`), the record retirement (publish_latest_record.py `retire-unexecuted`) and the
workflow's digest hand-off between them. The document's sha256 is the settle's `evidence-sha256:` provenance, so the settle's journal commit is
a deterministic function of it.

The identity is PINNED (UNEXECUTED_ATTEMPTS): run, attempt, head, campaign, the journal head the reservation must still sit at, the reserve event
as appended, and the credential-bearing steps of the workflow AT THAT HEAD. The record job holds no `contents` permission, so those steps are
pinned here, and a test re-derives them from a committed copy of that workflow (credential_steps) so the pin cannot drift from the source. A
new identity is a new reviewed entry, never a parameter.

What is proved, all required (any miss, ambiguity or active job refuses):
  * the run is exactly the pinned one, `completed` and `failure`, and every job carries this run id, attempt and head;
  * the reserve job and the record, settle and complete jobs are `success`; the nightly gate is `skipped`; the live job `failure`, completed;
  * the live job failed at the pinned step, and every credential-bearing step is `skipped`: a product-capable step cannot run without a credential;
  * the journal, freshly validated from the pinned reviewed root, is at the pinned head: genesis plus exactly this run's one `reserve`, equal to the
    pinned event, and no settle or release.
Usage is DERIVED, never read: requests, identity reads, Starts, takes and coaching are 0 (no credential step ran) and runner minutes are the live
job's measured seconds (started to completed) rounded up to whole minutes, the job the reserved runner minutes (live minutes) cover. The other jobs
are listed in the document and sit outside the campaign allocation. `atUtc` is the latest job completion, a fixed fact.

Nothing here opens a socket: callers pass GitHub's run JSON and jobs JSON (with steps) and the validated journal chain.
CLI: unexecuted_attempt_evidence.py collect --run RUN.json --jobs JOBS.json --out EVIDENCE.json   (reads the journal from the approved remote)
     unexecuted_attempt_evidence.py check --evidence EVIDENCE.json                                (prints the sha256 and the settle time)
Exit 78 (BLOCKED_SETUP) on every refusal.
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (this module opens no socket itself; the one journal fetch is state_ref_writer's `git` subprocess)

SCHEMA = "speaksharp.cloud-test.unexecuted-attempt-evidence.v1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
SECRET = re.compile(r"secrets\.([A-Za-z_][A-Za-z0-9_]*)")
PRODUCT_KEYS = ("requests", "identityReads", "starts", "takes", "coachingRequests")
LIVE_JOB_PREFIX = "Selected live journeys"
JOB_PREFIXES = (("record", "Record the attempt", "success"), ("gate", "Nightly gate", "skipped"),
                ("reserve", "Reserve the run on the state-ref journal", "success"), ("live", LIVE_JOB_PREFIX, "failure"),
                ("settle", "Settle the run's reservation", "success"), ("complete", "Complete or interrupt the attempt", "success"))

# The one attempt this recovery covers. `reserved` is the reserve event exactly as it sits on the journal.
UNEXECUTED_ATTEMPTS = {
    "41960376782": {
        "attempt": 1,
        "headSha": "8f9f9451bb6bf37ba2bca524acd92d933e2b826c",
        "failedStep": "Generate the exact-head browser-bound proof and offline checks",
        "journalHeadSha": "0909b53ff6dc767105633ddc14db520c762dff64",
        "reserved": {"type": "reserve", "campaignId": "R10-3b040043-smoke15", "runId": "41960376782", "attempt": 1,
                     "allocation": {"requests": 2032, "identityReads": 32, "starts": 16, "takes": 16, "coachingRequests": 20, "runnerMinutes": 40},
                     "provenance": "request-sha256:c7e6698a9c9aeb09504a83bff2078a1d41478943067f1084f39a901cdd2cc4ee", "atUtc": "2026-11-05T03:15:17Z"},
        "credentialSteps": [["Selected live journeys (existing stage runner; preinstalled browser)", "Prove the selected accounts' bounded first-use prerequisites"],
                            ["Selected live journeys (existing stage runner; preinstalled browser)", "Select the committed request and bind this run's inputs"],
                            ["Selected live journeys (existing stage runner; preinstalled browser)", "Stage runner (install-tools, plans, stimulus preflight, gates)"],
                            ["Selected live journeys (existing stage runner; preinstalled browser)", "Stage runner (run), bounded to the selected cases' live minutes"]],
    },
}


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _utc(v, code):
    _need(isinstance(v, str) and UTC.match(v), code)
    return datetime.strptime(v, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def _scalar(raw):
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "'\"":
        raw = raw[1:-1]
    return raw


def credential_steps(workflow_text):
    """[(job name, step name)] for every credential-bearing step, read from the workflow TEXT (no YAML dependency: the hosted record job has
    none). A job whose header (everything before `steps:`) mentions a secret makes every one of its steps credential-bearing. An unnamed
    step that mentions a secret refuses: it could not be matched to GitHub's record of it."""
    _need(isinstance(workflow_text, str) and workflow_text.strip() != "", "unexecuted-workflow")
    lines = workflow_text.split("\n")
    _need("jobs:" in lines, "unexecuted-workflow")
    start = lines.index("jobs:") + 1
    jobs, current = [], None
    for line in lines[start:]:
        m = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
        if m:
            current = {"key": m.group(1), "header": [], "steps": [], "in_steps": False}
            jobs.append(current)
            continue
        if current is None:
            continue
        if line == "    steps:":
            current["in_steps"] = True
            continue
        if not current["in_steps"]:
            current["header"].append(line)
        elif re.match(r"^      - ", line):
            current["steps"].append([line])
        elif current["steps"] and (line.strip() == "" or re.match(r"^ {8,}", line) or line.lstrip().startswith("#")):
            current["steps"][-1].append(line)
        elif line.strip() and not re.match(r"^ {6,}", line):
            current["in_steps"] = False
            current["header"].append(line)
    found = []
    for job in jobs:
        header = "\n".join(job["header"])
        names = [_scalar(m.group(1)) for m in re.finditer(r"^    name:\s*(.+)$", header, re.M)]
        job_name = names[0] if names else job["key"]
        header_secret = any(m.group(1) != "GITHUB_TOKEN" for m in SECRET.finditer(header))
        for block in job["steps"]:
            text = "\n".join(block)
            m = re.search(r"^(?:      - |        )name:\s*(.+)$", text, re.M)
            step_name = _scalar(m.group(1)) if m else None
            if header_secret or any(s.group(1) != "GITHUB_TOKEN" for s in SECRET.finditer(text)):
                _need(step_name is not None, "unexecuted-unnamed-credential-step")
                found.append((job_name, step_name))
    return found



def _shape_jobs(jobs_doc):
    pages = jobs_doc if isinstance(jobs_doc, list) else [jobs_doc]
    out = []
    for page in pages:
        _need(isinstance(page, dict) and isinstance(page.get("jobs"), list), "unexecuted-jobs")
        for j in page["jobs"]:
            _need(isinstance(j, dict), "unexecuted-jobs")
            job = {"name": j.get("name"), "status": j.get("status"), "conclusion": j.get("conclusion"), "startedAt": j.get("started_at"),
                   "completedAt": j.get("completed_at"), "runId": str(j.get("run_id")), "attempt": j.get("run_attempt"), "headSha": j.get("head_sha")}
            if isinstance(job["name"], str) and job["name"].startswith(LIVE_JOB_PREFIX):
                job["steps"] = [{"number": s.get("number"), "name": s.get("name"), "status": s.get("status"), "conclusion": s.get("conclusion")}
                                for s in (j.get("steps") or [])]
            out.append(job)
    return out


def _live(jobs):
    found = [j for j in jobs if isinstance(j.get("name"), str) and j["name"].startswith(LIVE_JOB_PREFIX)]
    _need(len(found) == 1, "unexecuted-live-job")
    return found[0]


def _seconds(job):
    start, end = _utc(job["startedAt"], "unexecuted-job-time"), _utc(job["completedAt"], "unexecuted-job-time")
    _need(end >= start, "unexecuted-job-time")
    return int((end - start).total_seconds())


def _rules(doc, pin):
    """The deterministic verification of the shaped document against the pinned identity. Returns (usage, atUtc)."""
    run, jobs, journal = doc["run"], doc["jobs"], doc["journal"]
    _need((run["runId"], run["attempt"], run["headSha"]) == (doc["identity"]["runId"], pin["attempt"], pin["headSha"]), "unexecuted-run-differs")
    _need(run["status"] == "completed" and run["conclusion"] == "failure", "unexecuted-run-not-failed")
    _utc(run["startedAt"], "unexecuted-run-time")
    _need(_utc(run["updatedAt"], "unexecuted-run-time") >= _utc(run["startedAt"], "unexecuted-run-time"), "unexecuted-run-time")
    # every job is of THIS run, attempt and head; exactly one per expected prefix with the expected, completed conclusion
    _need(all((j["runId"], j["attempt"], j["headSha"]) == (run["runId"], run["attempt"], run["headSha"]) for j in jobs), "unexecuted-job-not-of-the-run")
    _need(len(jobs) == len(JOB_PREFIXES), "unexecuted-jobs")
    for key, prefix, wanted in JOB_PREFIXES:
        found = [j for j in jobs if isinstance(j["name"], str) and j["name"].startswith(prefix)]
        _need(len(found) == 1 and found[0]["status"] == "completed" and found[0]["conclusion"] == wanted, "unexecuted-job-" + key)
    live = _live(jobs)
    steps = live["steps"]
    _need(0 < len(steps) <= 128 and all(isinstance(s, dict) and set(s) == {"number", "name", "status", "conclusion"} for s in steps), "unexecuted-steps")
    failed = [s for s in steps if s["conclusion"] == "failure"]
    _need(len(failed) == 1 and failed[0]["name"] == pin["failedStep"] and doc["failedStep"] == failed[0]["name"], "unexecuted-failed-step")
    _need(all(s["status"] == "completed" for s in steps), "unexecuted-step-active")
    _need(doc["credentialSteps"] == pin["credentialSteps"], "unexecuted-credential-steps")
    for job_name, step_name in doc["credentialSteps"]:
        _need(job_name == live["name"], "unexecuted-credential-job")
        found = [s for s in steps if s["name"] == step_name]
        _need(len(found) == 1 and found[0]["conclusion"] == "skipped", "unexecuted-credential-step-ran")
        _need(found[0]["number"] > failed[0]["number"], "unexecuted-credential-step-before-failure")
    # the journal: freshly validated, at the pinned head, with this run's one reserve and nothing else
    _need(SHA40.match(str(journal.get("rootSha"))) and journal.get("headSha") == pin["journalHeadSha"] and journal.get("reserve") == pin["reserved"],
          "unexecuted-journal")
    usage = {k: 0 for k in PRODUCT_KEYS}
    usage["runnerMinutes"] = max(1, int(math.ceil(_seconds(live) / 60.0)))
    ended = max(_utc(j["completedAt"], "unexecuted-job-time") for j in jobs if j["conclusion"] != "skipped")
    return usage, ended.strftime("%Y-%m-%dT%H:%M:%SZ")


def _check_shape(doc):
    keys = {"schema", "identity", "run", "jobs", "failedStep", "credentialSteps", "journal", "usage", "atUtc"}
    _need(isinstance(doc, dict) and set(doc) == keys and doc["schema"] == SCHEMA, "unexecuted-shape")
    ident = doc["identity"]
    _need(isinstance(ident, dict) and set(ident) == {"runId", "attempt", "headSha"} and ident["runId"] in UNEXECUTED_ATTEMPTS, "unexecuted-not-a-pinned-attempt")
    pin = UNEXECUTED_ATTEMPTS[ident["runId"]]
    _need((ident["attempt"], ident["headSha"]) == (pin["attempt"], pin["headSha"]), "unexecuted-not-a-pinned-attempt")
    run = doc["run"]
    _need(isinstance(run, dict) and set(run) == {"runId", "attempt", "headSha", "status", "conclusion", "startedAt", "updatedAt"}, "unexecuted-shape")
    jobs = doc["jobs"]
    _need(isinstance(jobs, list) and 0 < len(jobs) <= 16 and all(isinstance(j, dict) for j in jobs), "unexecuted-jobs")
    for j in jobs:
        base = {"name", "status", "conclusion", "startedAt", "completedAt", "runId", "attempt", "headSha"}
        _need(set(j) in (base, base | {"steps"}) and isinstance(j["name"], str), "unexecuted-jobs")
    _need(isinstance(doc["credentialSteps"], list) and all(isinstance(p, list) and len(p) == 2 and all(isinstance(x, str) for x in p)
                                                         for p in doc["credentialSteps"]), "unexecuted-shape")
    journal = doc["journal"]
    _need(isinstance(journal, dict) and set(journal) == {"rootSha", "headSha", "reserve"} and isinstance(journal["reserve"], dict), "unexecuted-shape")
    u = doc["usage"]
    _need(isinstance(u, dict) and set(u) == set(PRODUCT_KEYS) | {"runnerMinutes"} and all(type(v) is int and v >= 0 for v in u.values()), "unexecuted-shape")
    _need(isinstance(doc["atUtc"], str) and UTC.match(doc["atUtc"]), "unexecuted-shape")
    return pin


def check_evidence(doc):
    """(sha256, usage, atUtc) for an evidence document, or a refusal. The usage and the settle time are RECOMPUTED here and must equal what the
    document carries, so a document claiming other usage or another time is refused. The digest binds the document byte for byte."""
    pin = _check_shape(doc)
    usage, at_utc = _rules(doc, pin)
    _need(doc["usage"] == usage and doc["atUtc"] == at_utc, "unexecuted-usage-differs")
    return hashlib.sha256(canon(doc)).hexdigest(), usage, at_utc


def build_evidence(run, jobs_doc, chain, run_id):
    """The evidence document for GitHub's run and jobs JSON and the validated journal chain [(sha, events, ...)], or a refusal."""
    _need(isinstance(run, dict) and run_id in UNEXECUTED_ATTEMPTS and str(run.get("id")) == run_id, "unexecuted-not-a-pinned-attempt")
    pin = UNEXECUTED_ATTEMPTS[run_id]
    _need(isinstance(chain, list) and len(chain) == 2, "unexecuted-journal")
    reserves = [e for e in chain[-1][1] if isinstance(e, dict)]
    _need(len(reserves) == 1 and reserves[0].get("type") == "reserve", "unexecuted-journal")
    doc = {"schema": SCHEMA, "identity": {"runId": run_id, "attempt": pin["attempt"], "headSha": pin["headSha"]},
           "run": {"runId": str(run.get("id")), "attempt": run.get("run_attempt"), "headSha": run.get("head_sha"), "status": run.get("status"),
                   "conclusion": run.get("conclusion"), "startedAt": run.get("run_started_at"), "updatedAt": run.get("updated_at")},
           "jobs": _shape_jobs(jobs_doc), "failedStep": pin["failedStep"], "credentialSteps": [list(p) for p in pin["credentialSteps"]],
           "journal": {"rootSha": chain[0][0], "headSha": chain[-1][0], "reserve": reserves[0]}, "usage": {}, "atUtc": "1970-01-01T00:00:00Z"}
    _need(isinstance(doc["jobs"], list) and len(doc["jobs"]) == len(JOB_PREFIXES), "unexecuted-jobs")
    doc["usage"], doc["atUtc"] = _rules(doc, pin)
    check_evidence(doc)
    return doc


def fetch_chain():
    """The validated state-ref chain from the approved remote, through a fresh `git init` repository with only Git's defaults."""
    import subprocess
    import tempfile
    import state_ref_writer as W
    repo = tempfile.mkdtemp(prefix="unexecuted-journal-")
    ok = subprocess.run(["git", "init", "-q", repo], capture_output=True,
                        env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                             "GIT_TEMPLATE_DIR": ""}).returncode == 0
    _need(ok, "unexecuted-journal-repo")
    _need(W.REVIEWED_ROOT is not None, "state-root-not-pinned")
    W.check_repo(repo)
    head = W.fetch_head(repo, W.APPROVED_URL, W.APPROVED_URL)
    return W.validate_chain(repo, head, W.REVIEWED_ROOT)


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("collect", "check"))
    for flag in ("--run", "--jobs", "--out", "--evidence", "--run-id"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "check":
            _need(bool(x.evidence), "unexecuted-input-unreadable")
            with open(x.evidence, "rb") as f:
                digest, usage, at_utc = check_evidence(json.loads(f.read()))
            print(digest, at_utc, usage["runnerMinutes"])
            return 0
        _need(bool(x.run and x.jobs and x.out), "unexecuted-input-unreadable")
        with open(x.run, encoding="utf-8") as f:
            run = json.load(f)
        with open(x.jobs, encoding="utf-8") as f:
            jobs = json.load(f)
        doc = build_evidence(run, jobs, fetch_chain(), str(run.get("id")))
        with open(x.out, "wb") as f:
            f.write(canon(doc) + b"\n")
        return 0
    except (Refused, OSError, ValueError, TypeError, KeyError) as e:
        known = isinstance(e, Refused) or e.__class__.__name__ == "Refused"
        print("BLOCKED_SETUP: " + (str(e) if known else "unexecuted-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
