#!/usr/bin/env python3
"""The control-plane pipeline: verifies the sealed receipts, reconciles cumulative usage, verifies the release from git, validates the run request,
evaluates the gates, derives the gap ledger, compares the runs AUTOMATICALLY from the sealed receipts, reports spend, derives the executive summary and
builds the report. Secret-free and offline by construction: an in-process network guard denies and counts every socket attempt, the environment is
inspected for credential names, and no product host is ever contacted. Used by the GitHub preflight/report workflow and, with --stage final and a
stimulus receipt, by the run environment before it spends anything.

Usage: pipeline.py --request R.json --out-dir NEW_DIR [--stage preflight|final] [--latest-label LABEL] [--offline-checks OC.json]
          [--stimulus-receipt S.json] [--run-record RR.json] [--costs costs.json] [--timings DIR] [--repo DIR] [--now ISO] [--generated-at ISO]
          [--require-secret-free] [--enforce-go]
Exit codes: 6 --fail-on-alerts and an alert at or above the configured severity exists (outputs are written first); 0 completed; 1 invalid request or report; 2 sealed receipts fail verification (nothing is compared); 4 --enforce-go and the decision is NO-GO
(stop early; nothing is spent); 5 --require-secret-free and a credential-like variable is present."""
import argparse
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _common import ROOT, load, dump, now_utc  # noqa: E402
import _netguard  # noqa: E402

CRED = re.compile(r"(PASSWORD|SECRET|TOKEN|_KEY$|SERVICE_ROLE|STRIPE|CREDENTIAL)", re.I)
BENIGN = re.compile(r"^(GITHUB_|ACTIONS_|RUNNER_|CI$|HOMEBREW|PIPX|PYTHONHASHSEED|LC_|SSH_AUTH)")


def run(script, *args, check=False):
    r = subprocess.run([sys.executable, "-I", os.path.join(HERE, script)] + list(args), capture_output=True, text=True, env={**os.environ, "CT_NETGUARD_LOG": os.environ["CT_NETGUARD_LOG"]})
    sys.stdout.write(r.stdout)
    if r.stderr.strip():
        sys.stderr.write(r.stderr)
    return r


def credential_names(cfg):
    declared = set(cfg["credentials"]["runEnvironment"]["names"]) | set(cfg["credentials"]["forbidden"])
    return sorted(n for n in os.environ if n in declared or (CRED.search(n) and not BENIGN.match(n)))


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--request", required=True)
    a.add_argument("--out-dir", required=True)
    a.add_argument("--stage", choices=["preflight", "final"], default="preflight")
    for k in ("latest-label", "offline-checks", "offline-proof", "stimulus-receipt", "run-record", "costs", "timings", "now", "generated-at", "isolation", "previous-isolation", "history-index", "counters", "approval", "reservations", "accepted-input-dir", "receiver-receipt"):
        a.add_argument("--" + k)
    a.add_argument("--repo", default=os.path.abspath(os.path.join(ROOT, "..", "..")))
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--ledger", default=os.path.join(ROOT, "config", "gap-ledger.json"))
    a.add_argument("--workflow", default=os.path.join(ROOT, "workflow.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--require-secret-free", action="store_true")
    a.add_argument("--enforce-go", action="store_true")
    a.add_argument("--fail-on-alerts", action="store_true", help="exit 6 when an alert at or above config nightly.alertsFailOn exists (the job then fails and GitHub notifies); outputs are written first")
    x = a.parse_args()
    # sealed run record and an optional owner-supplied costs file are picked up automatically
    if x.latest_label and not x.run_record:
        cand = os.path.join(x.receipts_root, x.latest_label, "run-record.json")
        x.run_record = cand if os.path.exists(cand) else None
    if not x.costs:
        cand = os.path.join(os.path.dirname(os.path.abspath(x.request)), os.path.basename(x.request).replace(".json", ".costs.json"))
        x.costs = cand if os.path.exists(cand) else None
    if os.path.exists(x.out_dir):
        sys.exit("--out-dir must not exist")
    os.makedirs(x.out_dir)
    O = lambda n: os.path.join(x.out_dir, n)
    log = tempfile.NamedTemporaryFile(delete=False, suffix=".netlog")
    log.close()
    os.environ["CT_NETGUARD_LOG"] = log.name
    cfg, req, wf = load(x.config), load(x.request), load(x.workflow)
    history_index = x.history_index or os.path.join(ROOT, cfg["history"]["index"]["file"])
    counters = x.counters or os.path.join(ROOT, "config", "history", "owner-counters.json")
    approval = x.approval or os.path.join(ROOT, cfg["nightly"]["approvalFile"])
    reservations = x.reservations or os.path.join(ROOT, cfg["nightly"]["reservationsFile"])
    now_args = ["--now", x.now] if x.now else []
    creds = credential_names(cfg)
    if creds and x.require_secret_free:
        print("STOP: credential-like variables are present in a secret-free stage: %s" % ", ".join(creds))
        sys.exit(5)
    if x.accepted_input_dir:
        # Content-free retained-input route. aggregate_receiver.py has already
        # checked the reviewed manifest and preserved each accepted producer's
        # bytes. This branch still invokes the ordinary budget, request-validation
        # and gate consumers; it does not trust a supplied `valid` or `passed` flag.
        A = lambda n: os.path.join(x.accepted_input_dir, n + ".json")
        required = ("reconciliation", "release-verification", "gap-ledger", "prior-run-verification",
                    "comparison-prior", "case-costs")
        if any(not os.path.isfile(A(n)) for n in required):
            sys.exit("accepted input set is incomplete")
        receiver = x.receiver_receipt or A("receiver-receipt")
        if not os.path.isfile(receiver):
            sys.exit("accepted receiver receipt is missing")
        if load(x.request).get("coverageMode") == "full":
            rb = run("full_coverage_budget.py", "--config", x.config, "--costs", A("case-costs"),
                     "--catalog", os.path.join(ROOT, load(x.config)["modes"]["full"]["assertionCatalog"]["file"]),
                     "--reconciliation", A("reconciliation"), "--out", O("full-coverage-budget.json"),
                     "--markdown", O("full-coverage-budget.md"))
            if rb.returncode:
                sys.exit("accepted case-costs failed the ordinary budget consumer")
        rv = run("validate_run_request.py", "--request", x.request, "--config", x.config,
                 "--ledger", A("gap-ledger"), "--workflow", x.workflow,
                 "--release-verification", A("release-verification"), "--reconciliation", A("reconciliation"),
                 "--case-costs", A("case-costs"), "--out", O("request-validation.json"))
        if rv.returncode:
            sys.exit("accepted inputs failed ordinary request validation")
        g = ["--request", x.request, "--config", x.config, "--ledger", A("gap-ledger"), "--workflow", x.workflow,
             "--release-verification", A("release-verification"), "--reconciliation", A("reconciliation"),
             "--validation", O("request-validation.json"), "--prior-verification", A("prior-run-verification"),
             "--prior-comparison", A("comparison-prior"), "--receiver-receipt", receiver,
             "--stage", x.stage, "--base", ROOT, "--out", O("gate-status.json")]
        if x.offline_checks:
            g += ["--offline-checks", x.offline_checks]
        if x.offline_proof:
            g += ["--offline-proof", x.offline_proof]
        if x.stimulus_receipt:
            g += ["--stimulus-receipt", x.stimulus_receipt]
        rg = run("check_gates.py", *g)
        if rg.returncode:
            sys.exit("accepted inputs failed ordinary gate evaluation")
        gate = load(O("gate-status.json"))
        if x.enforce_go and gate["decision"] != "GO":
            print("STOP EARLY: blocking gates not READY (%s). Nothing was spent." % ",".join(gate["blockingOpen"]))
            sys.exit(4)
        return
    # 1. sealed receipts
    r = run("verify_receipts.py", "--config", x.config, "--root", x.receipts_root, "--out", O("receipts-verification.json"))
    if r.returncode:
        print("STOP: sealed receipts failed verification; nothing was compared")
        sys.exit(2)
    # 1b. retained history: the append-only index and the additive-only assertion catalog (a just-sealed run that is not yet appended is reported, not an error)
    for script, extra, name in (("history_index.py", ["verify", "--allow-unrecorded", "--config", x.config, "--receipts-root", x.receipts_root, "--index", history_index], "history-verification.json"),
                                ("verify_catalog_history.py", ["--config", x.config, "--index", history_index], "catalog-history-verification.json")):
        rh = run(script, *extra, "--out", O(name))
        if rh.returncode:
            print("STOP: %s failed; the retained history or the catalog was rewritten or is inconsistent" % script)
            sys.exit(2)
    # 2. cumulative reconciliation for THIS request's cap
    est = req["estimate"]
    run("reconcile_cumulative.py", "--config", x.config, "--receipts-root", x.receipts_root, "--counters", counters, "--run-cap", str(est["requests"]["runCap"]), "--identity-reads", str(est["identityReads"]),
        "--proposed-ceiling", str((req.get("proposedLimits") or {}).get("cumulativeCeilingRequests") or 0) or "0", "--out", O("reconciliation.json"))
    # 3. release verification from git
    run("verify_release.py", "--request", x.request, "--ledger", x.ledger, "--config", x.config, "--receipts-root", x.receipts_root, "--repo", x.repo, *now_args, "--out", O("release-verification.json"))
    # 4. request validation
    r4 = run("validate_run_request.py", "--request", x.request, "--config", x.config, "--ledger", x.ledger, "--workflow", x.workflow, "--release-verification", O("release-verification.json"),
             "--reconciliation", O("reconciliation.json"), "--receipts-root", x.receipts_root, "--out", O("request-validation.json"))
    # 5. gates
    g = ["--request", x.request, "--config", x.config, "--ledger", x.ledger, "--workflow", x.workflow, "--release-verification", O("release-verification.json"), "--reconciliation", O("reconciliation.json"),
         "--validation", O("request-validation.json"), "--stage", x.stage, "--base", ROOT, "--receipts-root", x.receipts_root, "--history-index", history_index, "--approval", approval, "--reservations", reservations, "--out", O("gate-status.json")] + now_args
    if x.offline_checks:
        g += ["--offline-checks", x.offline_checks]
    if x.offline_proof:
        g += ["--offline-proof", x.offline_proof]
    if x.stimulus_receipt:
        g += ["--stimulus-receipt", x.stimulus_receipt]
    run("check_gates.py", *g)
    # 6. automatic comparison of the compared runs from the sealed receipts
    base_labels = cfg["history"]["comparisonBaselines"]
    gen = x.generated_at or now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")
    rc_ = run("compare_latest.py", "--current", base_labels[1], "--previous", base_labels[0], "--out", O("comparison-prior"), "--generated-at", gen, "--config", x.config, "--receipts-root", x.receipts_root)
    if rc_.returncode:
        sys.exit(2)
    latest_cmp = None
    baselines = None
    if x.latest_label:
        # the baseline is NOT always the previous run: every required row is compared with the most recent earlier run that has a verdict for it
        rb = run("select_baselines.py", "--ledger", x.ledger, "--config", x.config, "--receipts-root", x.receipts_root, "--latest-label", x.latest_label, "--out", O("baselines.json"))
        if rb.returncode:
            print("STOP: baselines could not be selected from the sealed history")
            sys.exit(2)
        baselines = O("baselines.json")
        bsel = load(baselines)
        pairs = bsel["pairs"] or [base_labels[1]]
        prev_label = bsel["priorRuns"][-1] if bsel["priorRuns"] else base_labels[1]
        for lab in pairs:
            rl = run("compare_latest.py", "--current", x.latest_label, "--previous", lab, "--out", O("comparisons/%s" % lab), "--generated-at", gen, "--config", x.config, "--receipts-root", x.receipts_root)
            if rl.returncode:
                sys.exit(2)
        latest_cmp = O("comparisons/%s/comparison.json" % prev_label)
    # 6b. completeness of the latest run against the pinned assertion catalog (a partial or carried-forward result is never a full live run)
    cat = os.path.join(ROOT, cfg["modes"]["full"]["assertionCatalog"]["file"])
    cv = ["--request", x.request, "--catalog", cat, "--out", O("coverage.json")]
    if x.latest_label:
        cv += ["--case-results", os.path.join(x.receipts_root, x.latest_label, "case-results.json")]
    run("check_coverage.py", *cv)
    # 6c. full-coverage budget proposal (full mode only): per-case costs from the sealed guard logs, then the exact calculation
    bud = None
    if req.get("coverageMode") == "full":
        basis = cfg["modes"]["full"]["budgetModel"]["basisRuns"]
        run("derive_case_costs.py", "--receipts-root", x.receipts_root, *sum((["--run", b] for b in basis), []), "--out", O("case-costs.json"), "--markdown", O("case-costs.md"))
        run("full_coverage_budget.py", "--config", x.config, "--costs", O("case-costs.json"), "--catalog", cat, "--reconciliation", O("reconciliation.json"), "--out", O("full-coverage-budget.json"), "--markdown", O("full-coverage-budget.md"))
        bud = O("full-coverage-budget.json")
    # 6d. nightly: the standing recurring-cost proposal (derived; the owner's approval is config/recurring-approval.json)
    if req.get("priority") == "nightly-regression" and bud:
        run("recurring_budget.py", "--config", x.config, "--budget", bud, "--history-index", history_index, "--out", O("recurring-proposal.json"))
    # 7. derived gap ledger (nothing typed)
    ld = ["--ledger", x.ledger, "--config", x.config, "--receipts-root", x.receipts_root, "--release-verification", O("release-verification.json"), "--out", O("ledger-derived.json")]
    if x.latest_label:
        ld += ["--latest-label", x.latest_label, "--latest-comparison", latest_cmp, "--baselines", baselines, "--comparisons-dir", O("comparisons")]
    run("derive_ledger.py", *ld)
    # 8. spend (four separate accounts)
    sp = ["--request", x.request, "--config", x.config, "--reconciliation", O("reconciliation.json"), "--receipts-root", x.receipts_root, "--out", O("spend.json")]
    for k in ("run_record", "costs", "timings"):
        if getattr(x, k):
            sp += ["--" + k.replace("_", "-"), getattr(x, k)]
    if x.latest_label:
        sp += ["--latest-label", x.latest_label]
    rs = run("spend_report.py", *sp)
    # 8b. reviewed features (feature -> expected behaviour -> test coverage) and the #1488/#1757 concern observations, both derived from the sealed latest run
    feats = O("features-derived.json")
    run("derive_features.py", "--features", os.path.join(ROOT, cfg["features"]["ledgerFile"]), "--catalog", cat, "--release-verification", O("release-verification.json"), "--config", x.config,
        "--receipts-root", x.receipts_root, *(["--latest-label", x.latest_label] if x.latest_label else []), "--out", feats)
    concerns = None
    if x.latest_label:
        run("derive_concerns.py", "--config", x.config, "--receipts-root", x.receipts_root, "--latest-label", x.latest_label, "--request", x.request, "--coverage", O("coverage.json"), "--out", O("concerns.json"))
        concerns = O("concerns.json")
    # 9. isolation proof, then alerts, THEN the headline summary: the verdict must see isolation, alerts, staleness and cap overruns (it was produced before them in 1.4.0)
    alerts = None
    iso_result = None
    if x.isolation or x.previous_isolation or req.get("priority") == "nightly-regression":
        ci = ["--request", x.request, "--config", x.config, "--out", O("isolation-result.json")] + now_args
        if x.isolation:
            ci += ["--isolation", x.isolation]
        if x.previous_isolation:
            ci += ["--previous-isolation", x.previous_isolation]
        if x.latest_label:
            led_ = load(os.path.join(x.receipts_root, x.latest_label, "campaign-ledger.json"))
            ci += ["--run-start", led_["created"], "--run-end", led_["updated"]]
        run("check_isolation.py", *ci)
        iso_result = O("isolation-result.json")
    if x.latest_label:
        al = ["--config", x.config, "--receipts-root", x.receipts_root, "--latest-label", x.latest_label, "--coverage", O("coverage.json"), "--spend", O("spend.json"), "--request", x.request,
              "--features", feats, "--reservations", reservations,
              "--out", O("alerts.json"), "--markdown", O("alerts.md"), "--max-hours-between-runs", str(cfg["nightly"]["maxHoursBetweenRuns"])] + now_args
        if iso_result:
            al += ["--isolation", iso_result]
        if concerns:
            al += ["--concerns", concerns]
        run("derive_alerts.py", *al)
        alerts = O("alerts.json")
    sm = ["--comparison", O("comparison-prior/comparison.json"), "--ledger-derived", O("ledger-derived.json"), "--release-verification", O("release-verification.json"), "--gates", O("gate-status.json"),
          "--spend", O("spend.json"), "--workflow", x.workflow, "--request", x.request, "--coverage", O("coverage.json"), "--out", O("summary.json")]
    if latest_cmp:
        sm += ["--latest-comparison", latest_cmp]
    if alerts:
        sm += ["--alerts", alerts]
    if iso_result:
        sm += ["--isolation", iso_result]
    run("derive_summary.py", *sm)
    # 10. report
    rp = [os.path.join(ROOT, "report", "workflow_report.py"), "--request", x.request, "--ledger-derived", O("ledger-derived.json"), "--release-verification", O("release-verification.json"), "--reconciliation", O("reconciliation.json"),
          "--gates", O("gate-status.json"), "--spend", O("spend.json"), "--offline-proof", x.offline_proof or os.path.join(ROOT, req["harness"]["offlineProofFile"]), "--workflow", x.workflow, "--comparison", O("comparison-prior/comparison.json"),
          "--summary", O("summary.json"), "--labels", base_labels[0], base_labels[1], "--generated-at", gen, "--out", O("report"),
          "--bindings"] + [os.path.join(ROOT, p["bindingFile"]) for p in req["priorRuns"]]
    rp += ["--coverage", O("coverage.json")]
    if bud:
        rp += ["--budget", bud]
    if alerts:
        rp += ["--alerts", alerts]
    if iso_result:
        rp += ["--isolation", iso_result]
    rp += ["--features", feats]
    if concerns:
        rp += ["--concerns", concerns]
    if latest_cmp:
        rp += ["--latest-comparison", latest_cmp]
    if x.run_record:
        rp += ["--run-record", x.run_record]
    rr = subprocess.run([sys.executable, "-I"] + rp, capture_output=True, text=True, env={**os.environ})
    sys.stdout.write(rr.stdout)
    sys.stderr.write(rr.stderr)
    # the generated outputs are scanned too: reports and control-plane outputs must not retain sentinels, transcripts or secrets (concern CON-4); sanitized finding list only
    scan_rc = 0
    if x.latest_label and os.path.isdir(O("report")):
        sc = subprocess.run([sys.executable, "-I", os.path.join(ROOT, "scripts", "derive_concerns.py"), "--config", x.config, "--scan-dir", O("report"), "--out", O("report-retention-scan.json")], capture_output=True, text=True)
        sys.stdout.write(sc.stdout)
        sys.stderr.write(sc.stderr)
        scan_rc = sc.returncode
    # attestation: secret-free and no network
    attempts = sum(1 for _ in open(log.name)) if os.path.exists(log.name) else 0
    gate = load(O("gate-status.json"))
    dump({"schema": "speaksharp.cloud-test.preflight-attestation.v1", "runId": req["runId"], "stage": x.stage, "generatedUtc": gen,
          "credentialLikeVariablesPresent": creds, "secretFree": not creds, "networkAttempts": attempts + _netguard.ATTEMPTS, "productHostsContacted": 0,
          "scope": "offline control plane: sealed receipts, git history of the checkout, configuration and reports only; no product host, account, credential or browser",
          "decision": gate["decision"], "blockingOpen": gate["blockingOpen"]}, O("preflight-attestation.json"))
    v = load(O("request-validation.json"))
    lines = ["## Cloud test control plane: %s" % req["runId"], "",
             "- stage: **%s**; workflow %s; decision: **%s**; secret-free: **%s**; network attempts: **%d**" % (x.stage, wf["version"], gate["decision"], "yes" if not creds else "NO", attempts),
             "- purpose: %s" % req["purpose"], "- priority: %s; targeted gaps: %s" % (req["priority"], ", ".join(req["targetedGaps"])),
             "- estimate: %s planned requests, run cap %s; request validation: %s" % (est["requests"]["planned"], est["requests"]["runCap"], "valid" if v["valid"] else "INVALID"), "",
             "| Gate | Status | Detail |", "|---|---|---|"]
    lines += ["| %s | %s | %s |" % (gg["id"], gg["status"], gg["detail"].replace("|", "/")) for gg in gate["gates"]]
    needs = [(gg["id"], n) for gg in gate["gates"] for n in gg["needs"]]
    if needs:
        lines += ["", "### What is needed before a run"] + ["- %s: %s" % n for n in needs]
    if alerts:
        lines += ["", open(O("alerts.md"), encoding="utf-8").read()]
    text = "\n".join(lines) + "\n"
    with open(O("preflight-summary.md"), "w", encoding="utf-8") as f:
        f.write(text)
    s = os.environ.get("GITHUB_STEP_SUMMARY")
    if s:
        with open(s, "a", encoding="utf-8") as f:
            f.write(text)
    if not v["valid"] or rr.returncode:
        sys.exit(1)
    if scan_rc:
        print("RETENTION: the generated report retains a sentinel, secret pattern or transcript-like field (see report-retention-scan.json); failing the job")
        sys.exit(7)
    if alerts and x.fail_on_alerts:
        floor = {"critical": 4, "high": 3, "medium": 2}[cfg["nightly"]["alertsFailOn"]]
        sev = {"critical": 4, "high": 3, "medium": 2, "info": 1}
        if any(sev[al_["severity"]] >= floor for al_ in load(alerts)["alerts"]):
            print("ALERTS at or above %s exist: failing the job so the owner is notified" % cfg["nightly"]["alertsFailOn"])
            sys.exit(6)
    if x.enforce_go and gate["decision"] != "GO":
        print("STOP EARLY: blocking gates not READY (%s). Nothing was spent." % ",".join(gate["blockingOpen"]))
        sys.exit(4)
    if rs.returncode == 3:
        sys.exit(3)


if __name__ == "__main__":
    main()
