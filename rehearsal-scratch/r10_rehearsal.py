"""R10 full-chain rehearsal (scratch branch elon/r10-rehearsal only; never merged).

Mirrors the live job of cloud-test-live.yml from step 11 (prerequisite facts) through step 17 (run stage) and the collect/timing steps, on
the same GitHub-hosted image, with the exact committed R10 request, the exact dispatch facts plus the proposed `backend` object, the live
record-begin prior state, and SYNTHETIC accounts/credentials. Production hosts resolve to a local TLS stub (set up by the workflow) and all
other outbound HTTP(S) is rejected, so no request reaches production. Output: a content-free rehearsal summary.
"""
import hashlib, json, os, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

WS = os.environ["GITHUB_WORKSPACE"]; RT = os.environ["RUNNER_TEMP"]; CTL = Path(WS) / "tools/cloud-test"
sys.path[:0] = [str(CTL / "tests"), str(CTL / "scripts")]
import init_run_inputs as init, state_ref_writer  # noqa: E402
from test_init_run_inputs import bundle_with, ACCOUNT_ID  # noqa: E402

SUMMARY = {"schema": "r10-rehearsal-summary.v1", "steps": []}
def sha(f): return hashlib.sha256(Path(f).read_bytes()).hexdigest()
def record(name, rc, out="", err="", **extra):
    SUMMARY["steps"].append(dict({"step": name, "rc": rc, "stdoutTail": (out or "")[-1500:], "stderrHead": (err or "")[:3000],
                                  "stderrTail": (err or "")[-1500:]}, **extra))
    Path(RT, "rehearsal-summary.json").write_text(json.dumps(SUMMARY, indent=1))
    print("== %s rc=%s" % (name, rc), flush=True)
    if err: print(err[-3000:], flush=True)
def sh(name, cmd, env, timeout=1800, cwd=WS):
    t0 = time.time()
    try:
        r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        record(name, r.returncode, r.stdout, r.stderr, seconds=round(time.time() - t0, 1)); return r.returncode
    except subprocess.TimeoutExpired as e:
        record(name, "timeout", str(e.stdout or ""), str(e.stderr or ""), seconds=round(time.time() - t0, 1)); return 124

src = init._git(WS, "rev-parse", "HEAD")
now = datetime.now(timezone.utc).replace(microsecond=0); start = now.strftime("%Y-%m-%dT%H:%M:%SZ")
template = json.loads((CTL / "config/runs/R10-3b040043-all15.json").read_text())
occurrence = init.materialize_authoritative_smoke_occurrence(WS, template, start)
raw = json.dumps(occurrence, sort_keys=True, separators=(",", ":")).encode(); rsha = hashlib.sha256(raw).hexdigest()
run_id = os.environ.get("GITHUB_RUN_ID", "41600000001")
# The journal as journal-reserve leaves it: the accepted root with this run's reserve (a scratch remote; no state-ref write).
root = init.continuity_pins()["accepted_root"]
remote, writer = RT + "/reh-state.git", RT + "/reh-writer"
for c in (["git", "init", "-q", "--bare", remote], ["git", "init", "-q", writer], ["git", "-C", writer, "fetch", "-q", WS, root],
          ["git", "-C", writer, "push", "-q", remote, "%s:%s" % (root, state_ref_writer.STATE_REF)]):
    subprocess.run(c, check=True)
os.makedirs(RT + "/reh-reserve")
init.manual_reservation.execute("reserve", {"request": raw, "admittedSha256": rsha, "runId": run_id,
    "bootstrap": (CTL / "config/aggregate/accounting-bootstrap.json").read_bytes(), "scope": (CTL / "config/aggregate/period-scope.json").read_bytes(),
    "facts": b"{}", "atUtc": start}, writer, remote, root, RT + "/reh-reserve/j.json", RT + "/reh-reserve/r.json", init.continuity_pins(), remote, source_repo=WS)
chain = state_ref_writer.validate_chain(writer, state_ref_writer.fetch_head(writer, remote, remote), root)

bundle = json.loads(bundle_with(ACCOUNT_ID)); bundle["projectRef"] = "yxlapjuovrsvjswkwnrk"  # the live project id (host stubbed locally)
origin = "https://%s.supabase.co" % bundle["projectRef"]
facts = {"accounts": {"existing-disposable": {"historyRef": "first-observation:existing-disposable@R10-3b040043-smoke15", "idSha256": "FIRST-DISCOVERY"},
    "maintained-read-only": {"historyRef": "first-observation:maintained-read-only@R10-3b040043-smoke15", "idSha256": "FIRST-DISCOVERY"}},
    "approvedBy": "Akin", "ownerApprovalReference": "slack:1793971360.559069", "producerReviewReference": "slack:1793822205.697629",
    "receipts": {"analytics": "pending:preflight", "disp": "slack:1793833165.587389", "fence": "slack:1793822399.432639", "pre": "pending:preflight",
                 "review": "slack:1793822205.697629", "rls": "pending:preflight"}, "reviewer": "Sam",
    "backend": {"manifestRef": "rehearsal:backend-facts-pending-owner", "generation": 7, "completion": "OFF", "migration129": "absent"}}
OUT = RT + "/out"; os.makedirs(OUT, mode=0o700)
# Step 11's outputs, synthetic: the receipt shape the run-stage charge requires and the facts augmented with its digest references.
pre = OUT + "/prerequisite-preflight"; os.makedirs(pre, mode=0o700)
receipt = {"schema": "speaksharp.cloud-test.prerequisite-preflight.v1", "runId": "R10-3b040043-smoke15", "sourceSha": src, "observedAt": start,
           "mutationCount": 0, "charges": {"auth": 2, "signedIn": 8, "total": 10}, "observations": {}}
Path(pre, "receipt.json").write_text(json.dumps(receipt)); dg = hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()
facts["receipts"].update(pre="r10-preflight:" + dg, rls="r10-rls:" + dg, analytics="r10-analytics:" + dg)
Path(pre, "facts.json").write_text(json.dumps(facts))
prior = RT + "/prior-state.json"; Path(prior).write_text((Path(WS) / "rehearsal-scratch/rehearsal-prior-state.json").read_text())
occ = Path(RT) / "manual-occurrence.json"; occ.write_bytes(raw)
x = SimpleNamespace(repo=WS, config="tools/cloud-test/config/test-config.v1.json", request="tools/cloud-test/config/runs/R10-3b040043-all15.json",
    manual_occurrence_file=str(occ), manual_occurrence_sha256=rsha, workflow_start_utc=start, nightly_request_file=None, nightly_request_sha256=None,
    facts=json.dumps(facts), run_id=run_id, attempt=1, source_sha=src, job_timeout_minutes=65, case10_observation=None, checkpoint=prior)
try:
    with mock.patch.object(init, "state_chain", return_value=chain), mock.patch.dict(os.environ, {"CLOUD_TEST_LIVE_ACCOUNTS": json.dumps(bundle),
            "SUPABASE_URL": origin, "GITHUB_ACTIONS": "false"}):
        p = init.prepare(x, datetime.now(timezone.utc))
    record("12-prepare", 0, "route=%s cases=%d liveMinutes=%s" % (p["route"], len(p["cases"]), p["liveMinutes"]))
except Exception as e:  # noqa: BLE001
    record("12-prepare", 78, err="%s: %s" % (type(e).__name__, e)); SUMMARY["verdict"] = "STOPPED-AT 12-prepare"; Path(RT, "rehearsal-summary.json").write_text(json.dumps(SUMMARY, indent=1)); sys.exit(1)
inputs = RT + "/run-inputs"; os.makedirs(inputs, mode=0o700)
def wp(name, data):
    path = os.path.join(inputs, name); fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f: f.write(data if isinstance(data, bytes) else data.encode())
    return path
init._write_private(os.path.join(inputs, "facts.json"), p["facts"]); ff = os.path.join(inputs, "facts.json")
rf = wp("request.json", p["requestRaw"]); af = wp("account-id", p["accountId"]); bf = wp("live-accounts.json", p["bundleBytes"])
recsrc = wp("reconciliation.json", p["reconciliationBytes"])
sf = None
if p["scope"]:
    sf = os.path.join(inputs, "evidence-scope.json"); init._write_private(sf, p["scope"])
# Step 13: the clean detached tested-release checkout with the bound runtime packages (exactly the workflow's commands).
tested = RT + "/tested-release"
for name, cmd in (("13-worktree", ["git", "-C", WS, "worktree", "add", "--detach", tested, p["testedSha"]]),
                  ("13-bind-control", ["python3", "-I", str(CTL / "scripts/install_pdfjs.py"), "--config", str(CTL / "config/test-config.v1.json"),
                                       "--checkout", WS, "--runner-dir", str(CTL / "runner"), "--bind-playwright"]),
                  ("13-bind-tested", ["python3", "-I", str(CTL / "scripts/install_pdfjs.py"), "--config", str(CTL / "config/test-config.v1.json"),
                                      "--checkout", tested, "--runner-dir", str(CTL / "runner"), "--bind-playwright"])):
    if sh(name, cmd, dict(os.environ)): SUMMARY["verdict"] = "STOPPED-AT " + name; Path(RT, "rehearsal-summary.json").write_text(json.dumps(SUMMARY, indent=1)); sys.exit(1)
r = subprocess.run(["git", "-C", tested, "status", "--porcelain"], capture_output=True, text=True)
record("13-tested-status-porcelain", 0 if not r.stdout.strip() else 1, r.stdout[:1500])
# Step 14: reconciliation placement.
Path(OUT, "reconciliation.json").write_bytes(Path(recsrc).read_bytes()); os.chmod(OUT + "/reconciliation.json", 0o600)
assert sha(OUT + "/reconciliation.json") == hashlib.sha256(p["reconciliationBytes"]).hexdigest()
base = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "LANG", "LC_ALL", "pythonLocation", "LD_LIBRARY_PATH", "PKG_CONFIG_PATH",
        "Python_ROOT_DIR", "Python2_ROOT_DIR", "Python3_ROOT_DIR", "RUNNER_TEMP", "GITHUB_WORKSPACE", "GITHUB_REPOSITORY", "GITHUB_RUN_ID",
        "GITHUB_RUN_ATTEMPT", "GITHUB_SHA", "GITHUB_ACTIONS", "GITHUB_JOB", "CT_CHROME", "CT_BROWSER_RECEIPT", "CT_OFFLINE_PROOF", "CT_OFFLINE_CHECKS")}
env = dict(base, GITHUB_EVENT_NAME="workflow_dispatch", GITHUB_JOB="live", TRACKING_ISSUE="1763", CT_SETUP_MODE="existing-only",
    CT_CONFIG="tools/cloud-test/config/test-config.v1.json", CT_SOURCE_SHA=src, CT_EXECUTION_RUN_ID=run_id + ".1",
    CT_EXISTING_DEPENDENCY_ROOT=str(CTL / "runner"), CT_RETAINED_GATE_MANIFEST=str(CTL / "config/aggregate/manifest.json"),
    CT_ACCOUNTING_BOOTSTRAP=str(CTL / "config/aggregate/accounting-bootstrap.json"), CT_PERIOD_SCOPE=str(CTL / "config/aggregate/period-scope.json"),
    CT_HISTORY_INDEX=str(CTL / "config/history/index.json"), CT_RESERVATIONS=str(CTL / "config/history/reservations.json"),
    CT_APPROVAL=str(CTL / "config/recurring-approval.json"), CT_RECEIPTS_ROOT=str(CTL / "config/history/receipts"), CT_OUT=OUT,
    CT_STATE_REPO=RT + "/cloud-test-state", CT_STATE_JOURNAL_RESERVE=RT + "/cloud-test-state-reserve.json",
    CT_STATE_JOURNAL_SETTLE=RT + "/cloud-test-state-settle.json", CT_STATE_WORKSPACE_RECEIPT=RT + "/manual-state-workspace.json",
    CT_PREREQUISITE_FACTS=pre + "/facts.json", CT_PREREQUISITE_RECEIPT=pre + "/receipt.json", CT_ACCOUNT_ID_FILE=af, CT_FACTS_FILE=ff,
    CT_LIVE_ACCOUNTS_FILE=bf, CT_REQUEST=rf, FREE_TEST_EMAIL="free@example.invalid", THROWAWAY_TEST_EMAIL="throwaway@example.invalid",
    CT_CHECKOUT=tested, CT_EXISTING_PDFJS_DIR=tested + "/node_modules/pdfjs-dist", VITE_SUPABASE_URL=origin, CT_PRIOR_STATE=prior,
    VITE_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InJlaGVhcnNhbC1zeW50aGV0aWMifQ.rehearsal-not-a-signature", CT_REQUEST_SHA256=sha(rf), CT_LIVE_ACCOUNTS_SHA256=sha(bf))
if sf: env.update(CT_EVIDENCE_SCOPE_FILE=sf, CT_EVIDENCE_SCOPE_SHA256=sha(sf))
# Step 15: the five stages exactly as the workflow loops them.
for stage in ("install-tools", "build-plan", "stimulus-preflight", "build-plan-with-receipt", "gate-and-validate"):
    if sh("15-" + stage, ["bash", "tools/cloud-test/scripts/execute_run.sh", stage], env, timeout=900): break
else:
    # Step 16.
    if not sh("16-window-check", ["python3", "-I", "tools/cloud-test/scripts/init_run_inputs.py", "window-check", "--request", rf, "--live-minutes",
                                  str(p["liveMinutes"]), "--request-sha256", sha(rf)], env):
        # Step 17: the run stage with synthetic credentials (production hosts are stubbed/blocked by the workflow).
        run_env = dict(env, THROWAWAY_TEST_PASSWORD="rehearsal-synthetic-password-1", FREE_TEST_PASSWORD="rehearsal-synthetic-password-2",
                       SUPABASE_URL=origin, SUPABASE_SERVICE_ROLE_KEY="rehearsal-synthetic-service-role", POSTHOG_PERSONAL_API_KEY="phx_rehearsalsynthetic",
                       POSTHOG_PROJECT_ID="1", POSTHOG_API_HOST="https://us.posthog.com")
        sh("17-run", ["bash", "tools/cloud-test/scripts/execute_run.sh", "run"], run_env, timeout=int(p["liveMinutes"]) * 60)
        adm = Path(OUT, "plan/run/admission/admission-receipt.json")
        if adm.exists():
            a = json.loads(adm.read_text())
            record("17-admission-receipt", 0, json.dumps({"result": a.get("result"), "stage": a.get("stage"),
                   "steps": [{k: s.get(k) for k in ("id", "result", "reason")} for s in a.get("steps", [])],
                   "credentialCheck": a.get("credentialCheck"), "identity": (a.get("identityReceipt") or {}).get("result")}))
        cr = Path(OUT, "plan/run/case-results.json")
        if cr.exists():
            d = json.loads(cr.read_text())
            record("17-case-results", 0, json.dumps([{k: c.get(k) for k in ("caseId", "result", "reason")} for c in (d.get("cases") or [])])[:4000])
# Collect (always, like the workflow when init succeeded and the run stage was not skipped).
if Path(OUT, "started.txt").exists():
    sh("18-collect", ["bash", "tools/cloud-test/scripts/execute_run.sh", "collect"], env)
failed = [st["step"] for st in SUMMARY["steps"] if st["rc"] not in (0, "0") and st["step"] not in ("13-tested-status-porcelain",)]
SUMMARY["verdict"] = "CHAIN-COMPLETE" if not failed else "STOPPED-AT " + failed[0]
Path(RT, "rehearsal-summary.json").write_text(json.dumps(SUMMARY, indent=1))
print(json.dumps(SUMMARY, indent=1)[-6000:])
print("REHEARSAL VERDICT:", SUMMARY["verdict"])
sys.exit(0 if not failed else 1)
