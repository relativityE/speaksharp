#!/usr/bin/env python3
"""Evidence that the one retirable failed attempt never reached a reservation, for `publish_latest_record.py retire-unreserved`.

It reads three things and writes one closed JSON file; it never writes to GitHub, the state ref or the record:
  * the failed run as GitHub reports it (`gh api repos/R/actions/runs/ID`),
  * that run's jobs (`gh api repos/R/actions/runs/ID/jobs`, one page or the `--paginate --slurp` list of pages),
  * the state-ref journal, fetched anonymously from the approved remote at collection time into a fresh transport repository and validated from
    the pinned reviewed root to its head (state_ref_writer.validate_chain), so a rewritten or replaced journal fails here. The retirement
    requires that freshly read head to be the root itself (genesis).
The retirement itself decides whether the evidence is enough; this file only collects and shapes it. It carries no release identity.

Usage: unreserved_attempt_evidence.py --run RUN.json --jobs JOBS.json --out EVIDENCE.json
Exit 78 (BLOCKED_SETUP) on every refusal.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (this module opens no socket itself; the one journal fetch is state_ref_writer's `git` subprocess, as in the writer)
import state_ref_writer as W  # noqa: E402


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def journal_from_chain(chain):
    """{rootSha, headSha, runIds}: the validated chain's root and head, and every run id any journal event names."""
    _need(chain, "unreserved-journal-empty")
    run_ids = sorted({str(e.get("runId")) for e in chain[-1][1] if isinstance(e, dict) and e.get("runId") is not None})
    return {"rootSha": chain[0][0], "headSha": chain[-1][0], "runIds": run_ids}


def build_evidence(run, jobs_doc, chain, now=None):
    """The closed evidence document. `jobs_doc` is one jobs response or a list of pages of them. Every job carries the run, attempt and source
    GitHub says it belongs to, so the retirement can refuse a job that is not of the failed attempt. `now` is injectable for tests."""
    _need(isinstance(run, dict), "unreserved-run")
    pages = jobs_doc if isinstance(jobs_doc, list) else [jobs_doc]
    jobs = []
    for page in pages:
        _need(isinstance(page, dict) and isinstance(page.get("jobs"), list), "unreserved-jobs")
        jobs.extend({"name": j.get("name"), "status": j.get("status"), "conclusion": j.get("conclusion"), "runId": str(j.get("run_id")),
                     "attempt": j.get("run_attempt"), "headSha": j.get("head_sha")} for j in page["jobs"])
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"run": {"runId": str(run.get("id")), "attempt": run.get("run_attempt"), "headSha": run.get("head_sha"), "status": run.get("status"),
                    "conclusion": run.get("conclusion"), "updatedAt": run.get("updated_at")},
            "jobs": jobs, "journal": journal_from_chain(chain), "collectedAt": stamp}


def fetch_chain():
    """The validated state-ref chain from the approved remote, through a fresh `git init` repository with only Git's defaults."""
    repo = tempfile.mkdtemp(prefix="unreserved-journal-")
    ok = subprocess.run(["git", "init", "-q", repo], capture_output=True,
                        env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                             "GIT_TEMPLATE_DIR": ""}).returncode == 0
    _need(ok, "unreserved-journal-repo")
    _need(W.REVIEWED_ROOT is not None, "state-root-not-pinned")
    W.check_repo(repo)
    head = W.fetch_head(repo, W.APPROVED_URL, W.APPROVED_URL)
    return W.validate_chain(repo, head, W.REVIEWED_ROOT)


def main(argv):
    a = argparse.ArgumentParser()
    for flag in ("--run", "--jobs", "--out"):
        a.add_argument(flag, required=True)
    x = a.parse_args(argv[1:])
    try:
        with open(x.run, encoding="utf-8") as f:
            run = json.load(f)
        with open(x.jobs, encoding="utf-8") as f:
            jobs = json.load(f)
        evidence = build_evidence(run, jobs, fetch_chain())
        with open(x.out, "w", encoding="utf-8") as f:
            json.dump(evidence, f, sort_keys=True, separators=(",", ":"))
            f.write("\n")
        return 0
    except (Refused, W.Refused, OSError, ValueError, TypeError) as e:
        known = isinstance(e, (Refused, W.Refused))
        print("BLOCKED_SETUP: " + (str(e) if known else "unreserved-evidence-input-unreadable"), file=sys.stderr)
        return 78


if __name__ == "__main__":
    sys.exit(main(sys.argv))
