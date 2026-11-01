#!/usr/bin/env python3
"""The GitHub nightly regression's ONE immutable execution request per scheduled occurrence (Sam 1793553158.013909). SOURCE ONLY: the cron
lives in config/nightly/schedule.proposed.yml (a proposed artifact, not a registered workflow schedule), the standing approval is
NOT APPROVED, and the state-ref writer is not activated, so every path below refuses today.

  gate     before anything else runs: the repository switch must be exactly "true", the run is attempt 1, the state-ref writer is activated
           (its reviewed root is pinned), and the owner's standing approval (config/recurring-approval.json) is APPROVED, complete and valid
           now. A switch that is off is the quiet, intended inactive state; every other refusal is a visible failure. Either way nothing
           downstream may run: no secret-bearing job, no live effect, no reservation write and no latest-record overwrite.
  derive   the request bytes from exactly three inputs: the PINNED template (its digest is reviewed code here), the standing approval
           (bound by its digest) and the scheduled occurrence (the slot the schedule fired for, not the time the job started). The window
           is [slot, slot + approved window minutes], so a queue delay or a retry can never widen or reset it, and a start later than
           MAX_START_DELAY_MINUTES after the slot is refused. The occurrence id is the approval PERIOD plus the scheduled UTC slot
           (Sam 1793553275.772209), independent of the GitHub run id: an occurrence already in the durable ledger is a replay even
           under a fresh run id, which stays only the execution identity. Output: canonical bytes (sorted keys, compact, one LF) that prepare admits through the existing request_sha256 chain.
  verify   re-derive from the same three inputs and require byte equality, so a substituted template, approval or request never passes.
Exit 78 on every refusal; no value is printed.
"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import state_ref_writer  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_PATH = os.path.join(HERE, "config", "nightly", "request-template.v1.json")
TEMPLATE_SHA256 = "10d503f3ec2363c081c7a6c21c861a46feae7ae9f627b1764cb9e2a7764df9c5"  # the reviewed digest of request-template.v1.json; a mismatch refuses
APPROVAL_PATH = os.path.join(HERE, "config", "recurring-approval.json")
RUNTIME = "GitHub Actions SpeakSharp"
MAX_START_DELAY_MINUTES = 60
SHA40 = re.compile(r"[0-9a-f]{40}")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}")
DAILY_CRON = re.compile(r"([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*")
APPROVAL_FIELDS = ("approvedBy", "approvalRef", "approvedAtUtc", "validFromUtc", "expiresUtc", "periodStartUtc")
PER_RUN_CAPS = ("runCapRequests", "identityReads", "starts", "takes", "coachingRequests", "windowMinutes", "githubRunnerMinutes")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _utc(value):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is not None, "nightly-utc")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise Refused("nightly-utc")


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n"


def writer_activated():
    """The state-ref writer is activated only when an independently reviewed change pins its root (no local-only ledger fallback)."""
    return state_ref_writer.REVIEWED_ROOT is not None


def check_approval(raw, now):
    """The owner's standing approval: APPROVED, every G11 field and per-run cap supplied, paid actions at $0, and valid at `now`."""
    try:
        ap = json.loads(raw)
    except (TypeError, ValueError):
        raise Refused("recurring-approval-unreadable")
    _need(isinstance(ap, dict) and ap.get("schema") == "speaksharp.cloud-test.recurring-approval.v1", "recurring-approval-unreadable")
    _need(ap.get("status") == "APPROVED", "recurring-approval-not-approved")
    _need(all(isinstance(ap.get(k), str) and ap[k] for k in APPROVAL_FIELDS), "recurring-approval-incomplete")
    caps = ap.get("perRunCaps")
    _need(isinstance(caps, dict) and all(type(caps.get(k)) is int and caps[k] > 0 for k in PER_RUN_CAPS), "recurring-approval-incomplete")
    _need(caps.get("paidActionsUsd") == 0, "recurring-approval-paid-actions")
    _need(_utc(ap["validFromUtc"]) <= now, "recurring-approval-not-yet-valid")
    _need(now < _utc(ap["expiresUtc"]), "recurring-approval-expired")
    return ap


def gate(switch, attempt, approval_raw, now, activated=None):
    """Returns the approval, or refuses. The switch is checked FIRST, so an inactive nightly reads nothing else."""
    _need(switch == "true", "nightly-switch-off")
    _need(attempt == "1", "nightly-attempt")
    _need(writer_activated() if activated is None else activated, "state-writer-not-activated")
    return check_approval(approval_raw, now)


def occurrence_slot(cron, now):
    """The slot the daily schedule fired for: the latest HH:MM UTC at or before `now`. A start more than MAX_START_DELAY_MINUTES after
    it is refused (the window is never re-based on a late start). Only a plain daily schedule is supported."""
    m = DAILY_CRON.fullmatch(cron) if isinstance(cron, str) else None
    _need(m is not None, "nightly-schedule-unsupported")
    slot = now.replace(hour=int(m.group(2)), minute=int(m.group(1)), second=0, microsecond=0)
    if slot > now:
        slot -= timedelta(days=1)
    _need(now - slot <= timedelta(minutes=MAX_START_DELAY_MINUTES), "nightly-occurrence-late")
    return slot


def load_template(raw, pinned=None):
    _need(isinstance(raw, bytes) and hashlib.sha256(raw).hexdigest() == (TEMPLATE_SHA256 if pinned is None else pinned), "nightly-template-not-pinned")
    tpl = json.loads(raw)
    _need(isinstance(tpl, dict) and tpl.get("priority") == "nightly-regression" and tpl.get("coverageMode") == "full"
          and tpl.get("sampleMode") == "full" and "nightly" not in tpl, "nightly-template-shape")
    return tpl


PERIOD_DAYS = re.compile(r"([1-9][0-9]{0,2}) days")


def occurrence_id(approval, slot):
    """The approval period plus the scheduled UTC slot. The slot must lie inside the approved period [periodStartUtc, + period)."""
    start = _utc(approval["periodStartUtc"])
    m = PERIOD_DAYS.fullmatch(str((approval.get("cadence") or {}).get("period")))
    _need(m is not None, "recurring-approval-period")
    _need(start <= slot < start + timedelta(days=int(m.group(1))), "nightly-occurrence-outside-period")
    return "%s/%s" % (_iso(start), _iso(slot))


def derive(template_raw, approval_raw, slot, run_id, tested_sha, prior_occurrences, pinned=None):
    """The one immutable request for this occurrence. Deterministic: the same three inputs always give the same bytes."""
    _need(isinstance(run_id, str) and RUN_ID.fullmatch(run_id) is not None, "nightly-run-id")
    _need(isinstance(tested_sha, str) and SHA40.fullmatch(tested_sha) is not None, "nightly-tested-sha")
    tpl = load_template(template_raw, pinned)
    ap = check_approval(approval_raw, slot)  # the standing approval must cover the occurrence itself
    occurrence = _iso(slot)
    key = occurrence_id(ap, slot)
    _need(isinstance(prior_occurrences, (set, frozenset, list, tuple)) and key not in prior_occurrences, "nightly-occurrence-replayed")
    caps = ap["perRunCaps"]
    req = copy.deepcopy(tpl)
    ref = ap["approvalRef"]
    req.update(runId="nightly-%s" % slot.strftime("%Y%m%dT%H%MZ"), createdUtc=occurrence, synthetic=False, executionRuntime=RUNTIME,
               selectionApprovalRef=ref)
    req["window"] = {"startUtc": occurrence, "endUtc": _iso(slot + timedelta(minutes=caps["windowMinutes"])), "approvalRef": ref}
    req["harness"] = dict(req.get("harness") or {}, ownerApprovalRef=ref)
    req["approvedLimits"] = {"runCapRequests": caps["runCapRequests"], "identityCap": caps["identityReads"], "startsCap": caps["starts"],
                             "takesCap": caps["takes"], "cumulativeCeilingRequests": (ap.get("periodCaps") or {}).get("requests"),
                             "approvalRef": ref, "approvedBy": ap["approvedBy"]}
    req["release"] = dict(req.get("release") or {}, testedSha=tested_sha)
    req["nightly"] = {"occurrence": occurrence, "occurrenceId": key, "runId": run_id, "attempt": 1, "templateSha256": hashlib.sha256(template_raw).hexdigest(),
                      "approvalSha256": hashlib.sha256(approval_raw).hexdigest(), "standingApprovalRef": ref}
    return canon(req)


def verify(request_raw, template_raw, approval_raw, slot, run_id, tested_sha, prior_occurrences, pinned=None):
    """Byte equality with a fresh derivation from the same three inputs: any substituted template, approval or request refuses."""
    _need(isinstance(request_raw, bytes) and request_raw == derive(template_raw, approval_raw, slot, run_id, tested_sha, prior_occurrences, pinned),
          "nightly-request-not-the-derivation")
    return hashlib.sha256(request_raw).hexdigest()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("gate",))
    a.add_argument("--switch", default="")
    a.add_argument("--attempt", default="")
    a.add_argument("--approval", default=APPROVAL_PATH)
    a.add_argument("--outputs", required=True)
    x = a.parse_args(argv[1:])
    code, status = "admitted", 0
    try:
        with open(x.approval, "rb") as f:
            raw = f.read()
        gate(x.switch, x.attempt, raw, datetime.now(timezone.utc))
    except Refused as e:
        # The switch being off is the intended inactive state (quiet); anything else is a visible configuration failure.
        code, status = str(e), (0 if str(e) == "nightly-switch-off" else 78)
    except OSError:
        code, status = "recurring-approval-unreadable", 78
    with open(x.outputs, "a", encoding="utf-8") as f:
        f.write("admitted=%s\ncode=%s\n" % ("true" if code == "admitted" else "false", code))
    if status:
        print("BLOCKED_SETUP: " + code, file=sys.stderr)
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
