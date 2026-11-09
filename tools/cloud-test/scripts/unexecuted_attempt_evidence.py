#!/usr/bin/env python3
"""Evidence that a RESERVED attempt did not execute: the reservation was appended, the live job then failed in setup, and no credential-bearing
(so no product-capable) step ran. One closed, DETERMINISTIC document, with no collection time, that three consumers recompute and compare: the
accounting settle (manual_reservation.py `settle-unexecuted`), the record retirement (publish_latest_record.py `retire-unexecuted`) and the
workflow's digest hand-off between them. The document's sha256 is the settle's `evidence-sha256:` provenance, so the settle's journal commit is
a deterministic function of it.

Any reserved attempt qualifies (Sam 1793881491.714239), never a pinned list: the run identity comes from GitHub's run, the reserve from the
journal (its open last event), and the credential-bearing steps from that run's OWN workflow at its head (fetched by commit SHA; its sha256 is in
the document), parsed by credential_steps. The record job holds no `contents` permission, so the caller supplies that workflow text.

What is proved, all required (any miss, ambiguity or active job refuses):
  * the run is `completed` and `failure`, and every job carries this run id, attempt and head;
  * the reserve job and the record, settle and complete jobs are `success`; the nightly gate is `skipped`; the live job `failure`, completed;
  * the live job failed at exactly one step, before every credential-bearing step, and each of those is `skipped` (the product-capable
    stage-runner run step must be among them): a product-capable step cannot run without a credential;
  * the journal, freshly validated from the pinned reviewed root, ends with this run's one `reserve`: no settle or release follows it.
Usage is DERIVED, never read: requests, identity reads, Starts, takes and coaching are 0 (no credential step ran) and runner minutes are the live
job's measured seconds (started to completed) rounded up to whole minutes, the job the reserved runner minutes (live minutes) cover. The other jobs
are listed in the document and sit outside the campaign allocation. `atUtc` is the latest job completion, a fixed fact.

Nothing here opens a socket: callers pass GitHub's run JSON and jobs JSON (with steps) and the validated journal chain.
CLI: unexecuted_attempt_evidence.py collect --run RUN.json --jobs JOBS.json --workflow WORKFLOW.yml --out EVIDENCE.json   (reads the journal)
     unexecuted_attempt_evidence.py check --evidence EVIDENCE.json                                (prints the sha256 and the settle time)
     unexecuted_attempt_evidence.py pending   (prints the run whose reserve is the journal's open last event, or nothing; reads the journal)
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

SCHEMA = "speaksharp.cloud-test.unexecuted-attempt-evidence.v3"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
UTC = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
SECRET = re.compile(r"secrets\.([A-Za-z_][A-Za-z0-9_]*)")
PRODUCT_KEYS = ("requests", "identityReads", "starts", "takes", "coachingRequests")
# Accounting by what the credential-bearing steps of the live job did (Sam 1793897345.841829 / 1793897309.565819; PO 11-05):
#   none            - every credential-bearing step skipped: nothing product-capable ran, zero product usage;
#   preflight-bound - the prerequisite preflight is the ONLY credential-bearing step that ran (it failed, or succeeded before a later
#                     non-credential failure) and every later one is skipped: at most its fixed charge, PREFLIGHT_REQUESTS campaign requests
#                     (2 sign-ins + 8 own-token reads, prerequisite_preflight.cjs charge), and no Start, take, coaching call or identity read;
#   capped          - any other credential-bearing step ran: its usage is unknown, so it settles at the reserved caps (never less).
PREFLIGHT_STEP = "Prove the selected accounts' bounded first-use prerequisites"
PREFLIGHT_REQUESTS = 10
ACCOUNTING = ("none", "preflight-bound", "capped")
LIVE_JOB_PREFIX = "Selected live journeys"
JOB_PREFIXES = (("record", "Record the attempt", "success"), ("gate", "Nightly gate", "skipped"),
                ("reserve", "Reserve the run on the state-ref journal", "success"), ("live", LIVE_JOB_PREFIX, "failure"),
                ("settle", "Settle the run's reservation", "success"), ("complete", "Complete or interrupt the attempt", "success"))

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


def _rules(doc):
    """The deterministic verification of the shaped document. Returns (usage, atUtc). Sam 1793881491.714239: ANY reserved attempt that stopped in
    setup, not a pinned list. Its credential-bearing steps are those of its OWN workflow at its head (workflowSha256), parsed by credential_steps."""
    ident, run, jobs, journal = doc["identity"], doc["run"], doc["jobs"], doc["journal"]
    _need((run["runId"], run["attempt"], run["headSha"]) == (ident["runId"], ident["attempt"], ident["headSha"]), "unexecuted-run-differs")
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
    _need(len(failed) == 1 and doc["failedStep"] == failed[0]["name"], "unexecuted-failed-step")
    _need(all(s["status"] == "completed" for s in steps), "unexecuted-step-active")
    # the product-capable step must be among the credential-bearing ones, so a mis-parsed workflow cannot yield an empty or partial list
    _need(doc["credentialSteps"] and any(step.startswith("Stage runner (run)") for _job, step in doc["credentialSteps"]), "unexecuted-credential-steps")
    ran = []
    for job_name, step_name in doc["credentialSteps"]:
        _need(job_name == live["name"], "unexecuted-credential-job")
        found = [s for s in steps if s["name"] == step_name]
        _need(len(found) == 1, "unexecuted-credential-step-missing")       # missing or duplicated is uncertain, never skipped
        step = found[0]
        if step["conclusion"] == "skipped":
            continue
        # a credential-bearing step that ran must be the failure itself or have succeeded before it; nothing ran after the failure
        _need(step["number"] <= failed[0]["number"] and step["conclusion"] in ("success", "failure"), "unexecuted-credential-step-ran")
        ran.append(step_name)
    accounting = "none" if not ran else "preflight-bound" if ran == [PREFLIGHT_STEP] else "capped"
    _need(doc["accounting"] == accounting, "unexecuted-accounting")
    # the journal: freshly validated; its LAST event is this run's reserve (nothing after it settles or releases it)
    reserve = journal.get("reserve")
    _need(SHA40.match(str(journal.get("rootSha"))) and SHA40.match(str(journal.get("headSha"))) and isinstance(reserve, dict)
          and reserve.get("type") == "reserve" and reserve.get("runId") == ident["runId"] and reserve.get("attempt") == ident["attempt"]
          and isinstance(reserve.get("allocation"), dict), "unexecuted-journal")
    held = reserve["allocation"]
    _need(all(type(held.get(k)) is int and held[k] >= 0 for k in PRODUCT_KEYS), "unexecuted-journal")
    if accounting == "capped":
        usage = {k: held[k] for k in PRODUCT_KEYS}
    else:
        usage = {k: 0 for k in PRODUCT_KEYS}
        if accounting == "preflight-bound":
            usage["requests"] = min(PREFLIGHT_REQUESTS, held["requests"])
    usage["runnerMinutes"] = max(1, int(math.ceil(_seconds(live) / 60.0)))
    ended = max(_utc(j["completedAt"], "unexecuted-job-time") for j in jobs if j["conclusion"] != "skipped")
    return usage, ended.strftime("%Y-%m-%dT%H:%M:%SZ")


def _check_shape(doc):
    keys = {"schema", "identity", "run", "jobs", "failedStep", "credentialSteps", "workflowSha256", "accounting", "journal", "usage", "atUtc"}
    _need(isinstance(doc, dict) and set(doc) == keys and doc["schema"] == SCHEMA, "unexecuted-shape")
    ident = doc["identity"]
    _need(isinstance(ident, dict) and set(ident) == {"runId", "attempt", "headSha"} and isinstance(ident["runId"], str)
          and re.fullmatch(r"[1-9][0-9]{0,19}", ident["runId"]) is not None and type(ident["attempt"]) is int and ident["attempt"] >= 1
          and SHA40.match(str(ident["headSha"])), "unexecuted-identity")
    _need(isinstance(doc["workflowSha256"], str) and SHA64.match(doc["workflowSha256"]), "unexecuted-shape")
    _need(doc["accounting"] in ACCOUNTING, "unexecuted-shape")
    _need(isinstance(doc["failedStep"], str), "unexecuted-shape")
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


def check_evidence(doc):
    """(sha256, usage, atUtc) for an evidence document, or a refusal. The usage and the settle time are RECOMPUTED here and must equal what the
    document carries, so a document claiming other usage or another time is refused. The digest binds the document byte for byte."""
    _check_shape(doc)
    usage, at_utc = _rules(doc)
    _need(doc["usage"] == usage and doc["atUtc"] == at_utc, "unexecuted-usage-differs")
    return hashlib.sha256(canon(doc)).hexdigest(), usage, at_utc


def open_reserve(chain):
    """The chain's last event when it is a reserve (so nothing after it settles or releases it), else None."""
    _need(isinstance(chain, list) and chain, "unexecuted-journal")
    events = chain[-1][1]
    last = events[-1] if events else None
    return last if isinstance(last, dict) and last.get("type") == "reserve" else None


def _derive_accounting(jobs, cred):
    """The accounting mode the steps imply (re-verified by _rules); "capped" whenever it is not clearly none or preflight-bound."""
    live = _live(jobs)
    names = {step: [s for s in live.get("steps") or [] if s.get("name") == step] for _job, step in cred}
    ran = [step for step, found in names.items() if len(found) == 1 and found[0].get("conclusion") != "skipped"]
    return "none" if not ran else "preflight-bound" if ran == [PREFLIGHT_STEP] else "capped"


def build_evidence(run, jobs_doc, chain, workflow_text):
    """The evidence document for GitHub's run and jobs JSON, the validated journal chain [(sha, events, ...)] and the run's own workflow text at
    its head, or a refusal. The chain's open last event must be this run's reserve, and no other event may name this run."""
    _need(isinstance(run, dict) and isinstance(run.get("id"), int), "unexecuted-run")
    run_id = str(run["id"])
    reserve = open_reserve(chain)
    _need(reserve is not None and reserve.get("runId") == run_id and reserve.get("attempt") == run.get("run_attempt")
          and [e for e in chain[-1][1] if isinstance(e, dict) and e.get("runId") == run_id] == [reserve], "unexecuted-journal")
    jobs = _shape_jobs(jobs_doc)
    _need(len(jobs) == len(JOB_PREFIXES), "unexecuted-jobs")
    live = _live(jobs)
    failed = [s for s in live.get("steps") or [] if s.get("conclusion") == "failure"]
    _need(len(failed) == 1, "unexecuted-failed-step")
    doc = {"schema": SCHEMA, "identity": {"runId": run_id, "attempt": run.get("run_attempt"), "headSha": run.get("head_sha")},
           "run": {"runId": run_id, "attempt": run.get("run_attempt"), "headSha": run.get("head_sha"), "status": run.get("status"),
                   "conclusion": run.get("conclusion"), "startedAt": run.get("run_started_at"), "updatedAt": run.get("updated_at")},
           "jobs": jobs, "failedStep": failed[0]["name"], "credentialSteps": [list(p) for p in credential_steps(workflow_text)],
           "workflowSha256": hashlib.sha256(workflow_text.encode("utf-8")).hexdigest(),
           "accounting": _derive_accounting(jobs, credential_steps(workflow_text)),
           "journal": {"rootSha": chain[0][0], "headSha": chain[-1][0], "reserve": reserve}, "usage": {}, "atUtc": "1970-01-01T00:00:00Z"}
    doc["usage"], doc["atUtc"] = _rules(doc)
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


def pending_run(chain):
    """Sam 1793881260.206739 / 1793881491.714239: the settle is keyed on the JOURNAL, not the record. The run whose reserve is the chain's open
    last event, or None. A dispatch interrupted after a retirement but before its settle leaves exactly this state, and the next dispatch must
    still reach the settle. Whether that run really did not execute is decided only by build_evidence on GitHub's report of it."""
    reserve = open_reserve(chain)
    return None if reserve is None else reserve.get("runId")


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("collect", "check", "pending"))
    for flag in ("--run", "--jobs", "--workflow", "--out", "--evidence"):
        a.add_argument(flag)
    x = a.parse_args(argv[1:])
    try:
        if x.command == "pending":
            run_id = pending_run(fetch_chain())
            if run_id is not None:
                print(run_id)
            return 0
        if x.command == "check":
            _need(bool(x.evidence), "unexecuted-input-unreadable")
            with open(x.evidence, "rb") as f:
                digest, usage, at_utc = check_evidence(json.loads(f.read()))
            print(digest, at_utc, usage["runnerMinutes"])
            return 0
        _need(bool(x.run and x.jobs and x.workflow and x.out), "unexecuted-input-unreadable")
        with open(x.run, encoding="utf-8") as f:
            run = json.load(f)
        with open(x.jobs, encoding="utf-8") as f:
            jobs = json.load(f)
        with open(x.workflow, encoding="utf-8") as f:
            workflow_text = f.read()
        doc = build_evidence(run, jobs, fetch_chain(), workflow_text)
        with open(x.out, "wb") as f:
            f.write(canon(doc) + b"\n")
        return 0
    except (Refused, OSError, ValueError, TypeError, KeyError) as e:
        known = isinstance(e, Refused) or e.__class__.__name__ == "Refused"
        print("BLOCKED_SETUP: " + (str(e) if known else "unexecuted-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
