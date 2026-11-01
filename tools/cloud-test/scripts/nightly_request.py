#!/usr/bin/env python3
"""The GitHub nightly regression's ONE immutable execution request per scheduled occurrence (Sam 1793553158.013909, RETURN 1793553793.785919).
SOURCE ONLY and refusing today: the cron lives in config/nightly/schedule.proposed.yml (a proposed artifact, not a registered schedule), the
standing approval is NOT APPROVED, the state-ref writer is not activated, and neither a reviewed nightly template nor an accepted budget
proposal is anchored yet (TEMPLATE_SHA256 / BUDGET_SHA256 are None until independently reviewed inputs are received).

  gate     before anything else: the repository switch must be exactly "true" (decided BEFORE any file is read, so an inactive nightly is quiet
           even with a missing approval), attempt 1, the state-ref writer activated, the standing approval complete, typed, chronological,
           within the package's structural limits and valid, and the run's ORIGINAL trigger time bound to exactly one scheduled slot.
  derive   the request bytes from the anchored template, the standing approval (bound by digest), the accepted budget proposal (the derived
           need, bound by digest) and the occurrence. Every derived allocation must fit the approval and the structural limits; the whole window
           [slot, slot + approved minutes] must lie inside the approval's validity and its period; the caller's own ceiling and window-fit checks
           (init_run_inputs) prove the full setup + live + collect run still fits from `now`. The occurrence id is the approval period plus the
           slot; a run id is only the execution identity.
  verify   re-derive and require byte equality, so a substituted template, approval, budget or request never passes.
Replay state: `occurrences_from_chain` reads reserved occurrence ids from the VERIFIED state-ref chain (pinned root through head). It is
UNQUALIFIED until the writer is activated: admission is only atomic at the writer's compare-and-swap reserve, never at this read.
Exit 78 on every refusal except a switched-off nightly (exit 0); no value is printed.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline)
import init_run_inputs as I  # noqa: E402
import state_ref_writer  # noqa: E402

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_PATH = os.path.join(os.path.dirname(os.path.dirname(HERE)), ".github", "workflows", "cloud-test-live.yml")
CONFIG_PATH = os.path.join(HERE, "config", "test-config.v1.json")
APPROVAL_PATH = os.path.join(HERE, "config", "recurring-approval.json")
# Production anchors: None until the independently reviewed template and the accepted budget proposal are received (never a fixture's bytes).
TEMPLATE_PATH, TEMPLATE_SHA256 = None, None
BUDGET_PATH, BUDGET_SHA256 = None, None
RUNTIME = "GitHub Actions SpeakSharp"
# GitHub may start a scheduled run late; a trigger later than this after a slot cannot be bound to exactly one occurrence.
SCHEDULER_MAX_DELAY_MINUTES = 30
# Sam 1793554593.723039: a SEPARATE nightly full-run window ceiling (the reviewed full-mode 330 plus the maximum trigger delay). The package
# config, manual runs and their approvals are unchanged; the window stays anchored to its slot and the remaining fit is checked before effects.
NIGHTLY_MAX_WINDOW_MINUTES = 360
SHA40 = re.compile(r"[0-9a-f]{40}")
RUN_ID = re.compile(r"[1-9][0-9]{0,19}")
DAILY_CRON = re.compile(r"([0-5]?[0-9]) ([01]?[0-9]|2[0-3]) \* \* \*")
PERIOD_DAYS = re.compile(r"([1-9][0-9]{0,2}) days")
APPROVAL_FIELDS = ("approvedBy", "approvalRef", "approvedAtUtc", "validFromUtc", "expiresUtc", "periodStartUtc")
PER_RUN_CAPS = ("runCapRequests", "identityReads", "starts", "takes", "coachingRequests", "windowMinutes", "githubRunnerMinutes")
PERIOD_CAPS = {"requests": "runCapRequests", "identityReads": "identityReads", "starts": "starts", "takes": "takes",
               "coachingRequests": "coachingRequests", "githubRunnerMinutes": "githubRunnerMinutes"}


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _pos_int(v):
    return type(v) is int and v > 0


def _utc(value):
    _need(isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", value) is not None, "nightly-utc")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        raise Refused("nightly-utc")


def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _compact(dt):
    return dt.strftime("%Y%m%dT%H%MZ")


def canon(doc):
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n"


JOB_TIMEOUT = re.compile(r"^  ([A-Za-z0-9_-]+):\n(?:(?!^  \S).*\n)*?^    timeout-minutes: ([0-9]+)$", re.M)


def workflow_job_timeouts(text):
    """Every job-level `timeout-minutes` of the live workflow, read from the actual workflow file (never a frozen number)."""
    found = {name: int(minutes) for name, minutes in JOB_TIMEOUT.findall(text)}
    _need(found and {"nightly-gate", "record-begin", "live", "record-complete"} <= set(found), "nightly-workflow-timeouts")
    return found


def nightly_runner_minutes(text):
    """A nightly run's maximum runner allowance: the gate, both record jobs and the live job (353 today, against 350 for a dispatch)."""
    return sum(workflow_job_timeouts(text).values())


def writer_activated():
    """The state-ref writer is activated only when an independently reviewed change pins its root (no local-only ledger fallback)."""
    return state_ref_writer.REVIEWED_ROOT is not None


def period_bounds(ap):
    m = PERIOD_DAYS.fullmatch(str((ap.get("cadence") or {}).get("period")))
    _need(m is not None, "recurring-approval-period")
    start = _utc(ap["periodStartUtc"])
    return start, start + timedelta(days=int(m.group(1)))


def check_approval(raw, now, cfg):
    """The owner's standing approval as complete authority: APPROVED; every field supplied; typed per-run caps, period caps and runsPerPeriod;
    chronology approvedAt <= validFrom <= periodStart and period end <= expiry; per-run caps within the package's structural limits and within
    the period caps; paid actions at $0; valid at `now`."""
    try:
        ap = json.loads(raw)
    except (TypeError, ValueError):
        raise Refused("recurring-approval-unreadable")
    _need(isinstance(ap, dict) and ap.get("schema") == "speaksharp.cloud-test.recurring-approval.v1", "recurring-approval-unreadable")
    _need(ap.get("status") == "APPROVED", "recurring-approval-not-approved")
    _need(all(isinstance(ap.get(k), str) and ap[k] for k in APPROVAL_FIELDS), "recurring-approval-incomplete")
    caps, period = ap.get("perRunCaps"), ap.get("periodCaps")
    _need(isinstance(caps, dict) and all(_pos_int(caps.get(k)) for k in PER_RUN_CAPS), "recurring-approval-incomplete")
    _need(isinstance(period, dict) and all(_pos_int(period.get(k)) for k in PERIOD_CAPS), "recurring-approval-incomplete")
    _need(_pos_int((ap.get("cadence") or {}).get("runsPerPeriod")), "recurring-approval-incomplete")
    _need(caps.get("paidActionsUsd") == 0, "recurring-approval-paid-actions")
    approved, valid_from, expires = _utc(ap["approvedAtUtc"]), _utc(ap["validFromUtc"]), _utc(ap["expiresUtc"])
    p_start, p_end = period_bounds(ap)
    _need(approved <= valid_from <= p_start and p_end <= expires, "recurring-approval-chronology")
    full = cfg["modes"]["full"]["limits"]
    _need(caps["runCapRequests"] <= full["maxRunCapRequests"] and caps["identityReads"] <= full["maxIdentityReadsPerRun"]
          and caps["windowMinutes"] <= NIGHTLY_MAX_WINDOW_MINUTES, "recurring-approval-exceeds-package-limits")
    _need(all(caps[per] <= period[k] for k, per in PERIOD_CAPS.items()), "recurring-approval-run-exceeds-period")
    _need(valid_from <= now, "recurring-approval-not-yet-valid")
    _need(now < expires, "recurring-approval-expired")
    return ap


def occurrence_slot(cron, trigger):
    """The ONE slot the run was triggered for, from its ORIGINAL trigger time (the workflow run's creation), never from when a job started.
    A trigger later than SCHEDULER_MAX_DELAY_MINUTES after a slot cannot be bound unambiguously and is refused."""
    m = DAILY_CRON.fullmatch(cron) if isinstance(cron, str) else None
    _need(m is not None, "nightly-schedule-unsupported")
    slot = trigger.replace(hour=int(m.group(2)), minute=int(m.group(1)), second=0, microsecond=0)
    if slot > trigger:
        slot -= timedelta(days=1)
    _need(trigger - slot <= timedelta(minutes=SCHEDULER_MAX_DELAY_MINUTES), "nightly-trigger-ambiguous")
    return slot


def occurrence_id(ap, slot):
    """The approval PERIOD plus the scheduled slot; the slot must lie inside the period. Also the request's runId (= the campaign id)."""
    p_start, p_end = period_bounds(ap)
    _need(p_start <= slot < p_end, "nightly-occurrence-outside-period")
    return "nightly-%s-%s" % (_compact(p_start), _compact(slot))


def gate(switch, attempt, approval_path, cron, trigger, now, cfg, activated=None):
    """Returns the approval and the bound slot, or refuses. The switch is decided FIRST, before any file is read. `activated` is TEST-ONLY."""
    _need(switch == "true", "nightly-switch-off")
    _need(attempt == "1", "nightly-attempt")
    _need(writer_activated() if activated is None else activated, "state-writer-not-activated")
    try:
        with open(approval_path, "rb") as f:
            raw = f.read()
    except OSError:
        raise Refused("recurring-approval-unreadable")
    ap = check_approval(raw, now, cfg)
    slot = occurrence_slot(cron, trigger)
    occurrence_id(ap, slot)
    return ap, slot


def occurrences_from_chain(repo, url, root, approved_url=state_ref_writer.APPROVED_URL):
    """Occurrence ids already RESERVED on the verified state-ref chain (pinned root through head). UNQUALIFIED until the writer is activated."""
    chain = state_ref_writer.validate_chain(repo, state_ref_writer.fetch_head(repo, url, approved_url), root)
    return frozenset(e["campaignId"] for e in chain[-1][1] if e["type"] == "reserve")


def fresh_repo():
    """An empty private repository for the ledger read: the checkout's own Git config (remotes, credentials) is never used by the writer."""
    path = tempfile.mkdtemp(prefix="nightly-ledger-")
    _need(subprocess.run(["git", "init", "-q", path], capture_output=True, env={"PATH": os.environ.get("PATH", ""), "GIT_CONFIG_NOSYSTEM": "1",
                         "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TEMPLATE_DIR": ""}).returncode == 0, "nightly-ledger-repo")
    return path


def admit(switch, attempt, cron, trigger, now, run_id, tested_sha, cfg, workflow_text):
    """The whole nightly admission, BEFORE any record mutation or credential-bearing job: gate, anchored inputs, replay from the verified
    chain, the derivation and the fit from now. Returns (occurrence id, request sha256, request bytes) or refuses."""
    ap, slot = gate(switch, attempt, APPROVAL_PATH, cron, trigger, now, cfg)
    _need(TEMPLATE_PATH is not None, "nightly-template-not-received")
    _need(BUDGET_PATH is not None, "nightly-budget-not-accepted")
    with open(TEMPLATE_PATH, "rb") as f:
        template_raw = f.read()
    with open(BUDGET_PATH, "rb") as f:
        budget_raw = f.read()
    with open(APPROVAL_PATH, "rb") as f:
        approval_raw = f.read()
    prior = occurrences_from_chain(fresh_repo(), state_ref_writer.APPROVED_URL, state_ref_writer.REVIEWED_ROOT)
    raw = derive(template_raw, approval_raw, budget_raw, slot, run_id, tested_sha, prior, cfg, workflow_text)
    check_fit(raw, now, cfg, workflow_text)
    return json.loads(raw)["nightly"]["occurrenceId"], hashlib.sha256(raw).hexdigest(), raw


def load_anchored(raw, pinned, missing, mismatch):
    _need(pinned is not None, missing)
    _need(isinstance(raw, bytes) and hashlib.sha256(raw).hexdigest() == pinned, mismatch)
    return json.loads(raw)


def check_template(tpl):
    _need(isinstance(tpl, dict) and tpl.get("priority") == "nightly-regression" and tpl.get("coverageMode") == "full"
          and tpl.get("sampleMode") == "full" and "nightly" not in tpl and "fixtureScope" not in tpl and "synthetic" not in tpl
          and sorted(s.get("case") for s in tpl.get("selection") or [] if isinstance(s, dict)) == I.ALL_CASES, "nightly-template-shape")
    return tpl


def derived_need(budget):
    """The run's derived need from the accepted full-coverage budget proposal (full_coverage_budget.py output), as allocation fields."""
    try:
        need = {"runCapRequests": budget["requests"]["runCap"], "identityReads": budget["identity"]["readsThisRun"],
                "starts": budget["actions"]["startsMinimum"], "takes": budget["actions"]["takesMinimum"],
                "coachingRequests": budget["coaching"]["cap"], "windowMinutes": budget["window"]["proposedWindowMinutes"]}
    except (KeyError, TypeError):
        raise Refused("nightly-budget-shape")
    _need(all(type(v) is int and v >= 0 for v in need.values()), "nightly-budget-shape")
    return need


def derive(template_raw, approval_raw, budget_raw, slot, run_id, tested_sha, prior_occurrences, cfg, workflow_text,
           template_pin=None, budget_pin=None):
    """The one immutable request for this occurrence. Deterministic: the same inputs always give the same bytes. `template_pin` and `budget_pin`
    are TEST-ONLY overrides; production uses the module anchors (None today, so production derivation refuses)."""
    _need(isinstance(run_id, str) and RUN_ID.fullmatch(run_id) is not None, "nightly-run-id")
    _need(isinstance(tested_sha, str) and SHA40.fullmatch(tested_sha) is not None, "nightly-tested-sha")
    tpl = check_template(load_anchored(template_raw, TEMPLATE_SHA256 if template_pin is None else template_pin,
                                       "nightly-template-not-received", "nightly-template-not-anchored"))
    budget = load_anchored(budget_raw, BUDGET_SHA256 if budget_pin is None else budget_pin, "nightly-budget-not-accepted", "nightly-budget-not-anchored")
    ap = check_approval(approval_raw, slot, cfg)  # the standing approval must cover the occurrence itself
    key = occurrence_id(ap, slot)
    _need(isinstance(prior_occurrences, (set, frozenset)) and key not in prior_occurrences, "nightly-occurrence-replayed")
    caps, need = ap["perRunCaps"], dict(derived_need(budget), githubRunnerMinutes=nightly_runner_minutes(workflow_text))
    _need(all(need[k] <= caps[k] for k in need), "nightly-need-exceeds-approval")
    window_end = slot + timedelta(minutes=caps["windowMinutes"])
    _need(_utc(ap["validFromUtc"]) <= slot and window_end <= _utc(ap["expiresUtc"]), "nightly-window-outside-approval")
    p_start, p_end = period_bounds(ap)
    _need(p_start <= slot and window_end <= p_end, "nightly-window-outside-period")
    ref, occurrence = ap["approvalRef"], _iso(slot)
    req = copy.deepcopy(tpl)
    req.update(runId=key, createdUtc=occurrence, synthetic=False, executionRuntime=RUNTIME, selectionApprovalRef=ref)
    req["window"] = {"startUtc": occurrence, "endUtc": _iso(window_end), "approvalRef": ref}
    req["harness"] = dict(req.get("harness") or {}, ownerApprovalRef=ref)
    req["approvedLimits"] = {"runCapRequests": caps["runCapRequests"], "identityCap": caps["identityReads"],
                             "cumulativeCeilingRequests": ap["periodCaps"]["requests"], "approvalRef": ref, "approvedBy": ap["approvedBy"]}
    req["estimate"] = {"requests": {"runCap": need["runCapRequests"]}, "identityReads": need["identityReads"], "starts": need["starts"],
                       "takes": need["takes"], "paidActionsAuthorizedUsd": 0}
    req["release"] = dict(req.get("release") or {}, testedSha=tested_sha)
    req["nightly"] = {"occurrence": occurrence, "occurrenceId": key, "runId": run_id, "attempt": 1,
                      "templateSha256": hashlib.sha256(template_raw).hexdigest(), "approvalSha256": hashlib.sha256(approval_raw).hexdigest(),
                      "budgetSha256": hashlib.sha256(budget_raw).hexdigest(), "standingApprovalRef": ref}
    # The caller's own ceiling checks against the live job's actual timeout.
    I.check_ceilings(cfg, req, I.ALL_CASES, workflow_job_timeouts(workflow_text)["live"])
    return canon(req)


def check_fit(request_raw, now, cfg, workflow_text):
    """Admission-time fit, separate from the time-independent bytes: the whole setup + live + collect must still fit the window from `now`,
    by the caller's own computation."""
    req = json.loads(request_raw)
    live = I.check_ceilings(cfg, req, I.ALL_CASES, workflow_job_timeouts(workflow_text)["live"])
    try:
        I.check_window_fit(req, now, live)
    except I.Refused:
        raise Refused("nightly-run-would-outlast-window")
    return live


def verify(request_raw, *args, **kwargs):
    """Byte equality with a fresh derivation from the same inputs: any substituted template, approval, budget or request refuses."""
    _need(isinstance(request_raw, bytes) and request_raw == derive(*args, **kwargs), "nightly-request-not-the-derivation")
    return hashlib.sha256(request_raw).hexdigest()


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("command", choices=("gate",))
    for flag in ("--switch", "--attempt", "--trigger-utc", "--cron", "--run-id", "--tested-sha"):
        a.add_argument(flag, default="")
    a.add_argument("--outputs", required=True)
    x = a.parse_args(argv[1:])
    code, status, digest, raw = "admitted", 0, "", b""
    try:
        if x.switch != "true":
            raise Refused("nightly-switch-off")  # decided before reading anything else
        with open(CONFIG_PATH, encoding="utf-8") as f:
            cfg = json.load(f)
        with open(WORKFLOW_PATH, encoding="utf-8") as f:
            workflow_text = f.read()
        _, digest, raw = admit(x.switch, x.attempt, x.cron, _utc(x.trigger_utc), datetime.now(timezone.utc), x.run_id, x.tested_sha, cfg, workflow_text)
    except Refused as e:
        code, status = str(e), (0 if str(e) == "nightly-switch-off" else 78)
    except (OSError, ValueError, KeyError, TypeError):
        code, status = "nightly-inputs-unreadable", 78
    # The admitted bytes travel beside their digest, from this one step (a step output cannot be rewritten later); prepare admits exactly
    # these bytes only when they hash to request_sha256. Base64 keeps them on one output line.
    ok = code == "admitted"
    with open(x.outputs, "a", encoding="utf-8") as f:
        f.write("admitted=%s\ncode=%s\nrequest_sha256=%s\nrequest_b64=%s\n" % ("true" if ok else "false", code, digest if ok else "",
                                                                                base64.b64encode(raw).decode("ascii") if ok else ""))
    if status:
        print("BLOCKED_SETUP: " + code, file=sys.stderr)
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv))
