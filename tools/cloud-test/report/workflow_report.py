#!/usr/bin/env python3
"""workflow_report.py - the cloud-test run report (workflow v1.2): three-way comparison (R-2 | R-1 | Latest), gap-closure ledger, release verification,
purpose and cost (four separate accounts), cumulative reconciliation, gates, plan and identities, offline proof, deviations. Offline; standard library
only; writes a NEW directory. Every table value is DERIVED from sealed receipts, git and the latest run; the executive summary is derived too.

Usage: workflow_report.py --request R.json --ledger-derived LD.json --release-verification RV.json --reconciliation RC.json --gates G.json --spend S.json
          --offline-proof P.json --workflow W.json --comparison C_prior.json [--latest-comparison C_latest.json] --summary SUMMARY.json [--run-record RR.json]
          [--bindings B1.json B2.json] --labels R4C R5 --out NEW_DIR [--generated-at ISO]
Outputs: REPORT.html, report.json, validation.json, MANIFEST.json (sha256 of every output and of the input copies under inputs/).
Exit 1 when the report fails validation (word limit, order, vocabulary, a gap CLOSED without proof, a dollar figure without a source, secrets pattern)."""
import argparse
import hashlib
import json
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
import _netguard  # noqa: E402,F401
import rr_render as R  # noqa: E402
from _common import comparison_errors  # noqa: E402

esc = R.esc
SECRET_PATTERNS = [re.compile(p) for p in (r"eyJ[A-Za-z0-9_-]{20,}", r"sk_(live|test)_[A-Za-z0-9]{10,}", r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", r"https?://[^\s\"']*[?&](token|key|code)=", r"-----BEGIN [A-Z ]*PRIVATE KEY-----")]


def load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def wc(t):
    return len(str(t).split())


def wc(t):
    return len(str(t).split())


def short_sha(h):
    return (h or "")[:8]


def ev_text(evs, n=3):
    return "; ".join("%s %s" % (e.get("file", ""), short_sha(e.get("sha256"))) for e in (evs or [])[:n]) or "none"


def summary_parts(s, n_gaps):
    j = lambda x: ("; ".join(x) if isinstance(x, list) else str(x)).rstrip(".")
    return [("Status", s["status"] + "."), ("Customer impact", s["customerImpact"]), ("Deployed since last run", s["deployedSinceLastRun"]),
            ("Good", j(s["good"])), ("Bad", j(s["bad"])), ("Unknown", j(s["unknown"])), ("Readiness", s["readiness"]),
            ("Proven gaps closed", "%d of %d tracked gaps (%s)." % (len(s["provenGapsClosed"]), n_gaps, ", ".join(s["provenGapsClosed"]) or "none")),
            ("Spend", s["spend"] + "."), ("Remaining blockers", j(s["blockers"])), ("Recommendation", s["recommendation"] + ".")]


EXTRA_CSS = """
table.gaps{min-width:1000px}table th{white-space:normal}
table.gaps td:nth-child(1){min-width:130px}table.gaps td:nth-child(2){min-width:140px}table.gaps td:nth-child(3){min-width:110px}table.gaps td:nth-child(4){min-width:140px}table.gaps td:nth-child(5){min-width:190px}table.gaps td:nth-child(6){min-width:92px}table.gaps td:nth-child(7){min-width:130px}
table.commits td:nth-child(1),table.commits td:nth-child(2){white-space:nowrap}
table.areas td:first-child,table.journeys td:first-child,table.plain td:first-child{min-width:150px}
table.areas td:nth-child(2),table.areas td:nth-child(3),table.areas td:nth-child(4){min-width:110px}
table.journeys td:nth-child(2),table.journeys td:nth-child(3),table.journeys td:nth-child(4){min-width:70px}
table.areas td:nth-child(6),table.journeys td:nth-child(6){min-width:150px}
table.areas td:nth-child(5){min-width:260px}
.nw span{white-space:nowrap}
@media (max-width:720px){table.gaps{min-width:0}}
"""


def table(head, rows, cls=""):
    th = "".join("<th>%s</th>" % esc(h) for h in head)
    body = []
    for r in rows:
        body.append("<tr>" + "".join('<td data-label="%s">%s</td>' % (esc(head[i]), c) for i, c in enumerate(r)) + "</tr>")
    return '<div class="scroll"><table class="cards %s"><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>' % (cls, th, "".join(body))


def verdict_cell(v, extra=""):
    return R.vspan(v) + (" <span class='muted small'>%s</span>" % esc(extra) if extra else "")


def journey_summary(counts):
    if not counts:
        return "-"
    return "<span class='nw'><span>%d PASS</span> <span>%d FAIL</span> <span>%d NOT RUN</span></span>" % (counts.get("PASS", 0), counts.get("FAIL", 0), counts.get("NOT RUN", 0))


def build(a):
    wf, req, ld, rv, rc, gates, spend, proof = (load(getattr(a, k)) for k in ("workflow", "request", "ledger_derived", "release_verification", "reconciliation", "gates", "spend", "offline_proof"))
    cmp_prior = load(a.comparison)
    cmp_latest = load(a.latest_comparison) if a.latest_comparison else None
    prior_errors = comparison_errors(cmp_prior, a.labels)
    if prior_errors:
        raise ValueError("comparison evidence is incomplete: " + "; ".join(prior_errors))
    if cmp_latest:
        latest_errors = comparison_errors(cmp_latest, [cmp_latest.get("previous", {}).get("label"), cmp_latest.get("current", {}).get("label")])
        if latest_errors:
            raise ValueError("latest comparison evidence is incomplete: " + "; ".join(latest_errors))
    cov = load(a.coverage) if a.coverage else None
    bud = load(a.budget) if a.budget else None
    alerts = load(a.alerts) if a.alerts else None
    iso = load(a.isolation) if a.isolation else None
    feats = load(a.features) if a.features else None
    concerns = load(a.concerns) if a.concerns else None
    rr = load(a.run_record) if a.run_record else None
    sm = load(a.summary)
    L2, L1 = a.labels
    S = sm["fields"]
    parts = summary_parts(S, len(ld["gaps"]))
    summary_words = sum(wc(k) + wc(v) for k, v in parts)
    areas, jv = [], {j["id"]: j for j in cmp_prior["journeys"]}
    lj = {j["id"]: j for j in cmp_latest["journeys"]} if cmp_latest else {}
    for ar in cmp_prior["areas"]:
        js = [jv[i] for i in ar.get("journeys", []) if i in jv]
        prev, cur = {"PASS": 0, "FAIL": 0, "NOT RUN": 0}, {"PASS": 0, "FAIL": 0, "NOT RUN": 0}
        for j in js:
            prev[j["prev"]] += 1
            cur[j["cur"]] += 1
        latest = latest_cls = la = None
        if cmp_latest:
            la = next((x for x in cmp_latest["areas"] if x["id"] == ar["id"]), None)
            if la:
                latest = {"PASS": 0, "FAIL": 0, "NOT RUN": 0}
                for i in ar.get("journeys", []):
                    if i in lj:
                        latest[lj[i]["cur"]] += 1
                latest_cls = la["class"]
        open_gaps = [g["id"] for g in ld["gaps"] if g["area"] == ar["id"] and g["status"] != "CLOSED"]
        areas.append({"id": ar["id"], "name": ar["name"], "journeys": ar.get("journeys", []), "prev": prev, "cur": cur, "latest": latest, "priorPairClass": ar["class"], "latestClass": latest_cls,
                      "why": (la or {}).get("why") or ar.get("why"), "openGaps": open_gaps})
    journeys = []
    for j in cmp_prior["journeys"]:
        lat = lj.get(j["id"])
        journeys.append({"id": j["id"], "title": j.get("title"), "r2": j["prev"], "r1": j["cur"], "latest": lat["cur"] if lat else None, "priorPairClass": j["class"],
                         "latestClass": lat["class"] if lat else None, "why": (lat or j).get("why"), "area": j.get("primary_area")})
    gate_names = {g["id"]: g["name"] for g in wf["gates"]}
    report = {"schema": "speaksharp.cloud-test.report.v2", "workflowVersion": wf["version"], "configVersion": req.get("configVersion"), "runId": req["runId"], "proposal": bool(req.get("proposal")),
              "generatedUtc": a.generated_at, "labels": {"r2": L2, "r1": L1, "latest": req["runId"]}, "status": S["status"],
              "executiveSummary": {"parts": parts, "words": summary_words, "fields": S, "derived": bool(sm.get("derived"))},
              "purposeAndCost": {"purpose": req["purpose"], "priority": req["priority"], "targetedGaps": req["targetedGaps"], "notTargeted": req.get("notTargeted", []), "spend": spend, "reconciliation": rc},
              "areas": areas, "journeys": journeys, "gapLedger": ld["gaps"], "releaseVerification": rv, "gates": gates, "gateNames": gate_names, "selection": req["selection"], "release": req["release"], "harness": req["harness"],
              "offlineProof": {"result": proof["result"], "corrections": [{"id": c["id"], "correction": c["correction"], "result": c["result"], "tests": len(c["tests"]), "mutationControls": len(c["mutationControls"])} for c in proof["corrections"]],
                               "testsPassed": proof.get("testsPassed"), "testsFailed": proof.get("testsFailed"), "planControls": proof.get("planControls"), "codeManifestSha256": proof.get("codeManifestSha256")},
              "deviations": req.get("deviations", []), "denominators": cmp_prior["denominators"], "comparisonValidity": cmp_prior["validity"], "priorPairHeadline": cmp_prior["headline"],
              "latestPending": cmp_latest is None, "coverage": cov, "fullCoverageBudget": bud, "alerts": alerts, "isolation": iso, "features": feats, "concerns": concerns, "coverageMode": req.get("coverageMode"), "runRecord": (rr and {"gateDecisionAtLaunch": rr.get("gateDecisionAtLaunch"), "result": rr.get("result"), "cases": rr.get("cases")}) or None,
              "ownerInputs": req.get("ownerInputs"), "approvals": {"limits": req.get("approvedLimits"), "window": req.get("window"), "harnessApproval": req["harness"].get("ownerApprovalRef"), "selection": req.get("selectionApprovalRef")}}
    return report, wf


def validate(rep, wf):
    sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "scripts")))
    from derive_ledger import ledger_status
    errs = []
    ex = rep["executiveSummary"]
    if ex["words"] > wf["report"]["executiveSummaryMaxWords"]:
        errs.append("executive summary is %d words, limit %d" % (ex["words"], wf["report"]["executiveSummaryMaxWords"]))
    if ex["fields"]["status"] not in ("READY", "LIMITED", "BLOCKED"):
        errs.append("status %r is not READY/LIMITED/BLOCKED" % ex["fields"]["status"])
    if ex["parts"][0][0] != "Status":
        errs.append("the summary must lead with the status")
    if ex["fields"]["recommendation"] not in wf["recommendationVocabulary"]:
        errs.append("recommendation %r not in %s" % (ex["fields"]["recommendation"], wf["recommendationVocabulary"]))
    for f in wf["report"]["summaryFields"]:
        if f not in ex["fields"]:
            errs.append("summary field %s missing" % f)
    if not ex.get("derived"):
        errs.append("the executive summary must be derived from evidence, not authored")
    if len(rep["areas"]) != 7:
        errs.append("expected 7 product areas, found %d" % len(rep["areas"]))
    if len(rep["journeys"]) != 15:
        errs.append("expected 15 journeys, found %d" % len(rep["journeys"]))
    closed = []
    for g in rep["gapLedger"]:
        st, _ = ledger_status(g)
        if st != g["status"]:
            errs.append("%s status %s does not follow from its evidence (%s)" % (g["id"], g["status"], st))
        if g["status"] == "CLOSED":
            closed.append(g["id"])
        if g.get("kind") not in wf["classes"]["gapKinds"]:
            errs.append("%s has unknown kind %s" % (g["id"], g.get("kind")))
        if g["id"] in rep["purposeAndCost"]["targetedGaps"] and not (g.get("expectedPass") or {}).get("definedAtUtc"):
            errs.append("%s targeted without a defined expected PASS" % g["id"])
    if sorted(ex["fields"]["provenGapsClosed"]) != sorted(closed):
        errs.append("summary provenGapsClosed %s differs from the ledger-derived %s" % (ex["fields"]["provenGapsClosed"], closed))
    if rep["latestPending"] and closed:
        errs.append("a gap is CLOSED although no latest run exists")
    b = ex["fields"].get("readinessBasis") or {}
    if ex["fields"]["status"] == "READY" and (b.get("journeysFail") or b.get("journeysNotShownPass") or b.get("gapsNotClosed") or b.get("gatesOpen") or b.get("inconclusiveSelected") or b.get("journeysPass") != 15 or rep["latestPending"]):
        errs.append("status READY contradicts the readiness basis (failures, incomplete coverage, open gaps or open gates remain)")
    if ex["fields"]["status"] == "READY" and not ((rep.get("coverage") or {}).get("fullLiveRun")):
        errs.append("status READY needs a full live run: the coverage check does not show one (partial and carried-forward results never count)")
    cv = rep.get("coverage")
    if cv and cv.get("fullLiveRun") and (cv.get("missing") or cv.get("approvedOmissionsApplied") or cv.get("rowsExecuted") != cv.get("rowsRequired") or cv.get("coverageMode") != "full"):
        errs.append("coverage claims a full live run while required rows are not executed (approved omissions are incomplete coverage) or the mode is not full")
    if ex["fields"]["status"] == "READY":
        sf = b.get("safety") or {}
        if sf.get("blocksReady") is not False:
            errs.append("status READY contradicts the safety checks (the summary does not show isolation proven, no blocking alert, fresh evidence and usage within every cap)")
        iso_ = rep.get("isolation")
        if iso_ is None or iso_.get("status") != "proven":
            errs.append("status READY needs isolation proven; the report's isolation result is %s" % ((iso_ or {}).get("status") or "absent"))
        al_ = rep.get("alerts") or {}
        if any(x["severity"] in ("critical", "high") for x in al_.get("alerts", [])):
            errs.append("status READY with a critical or high alert open")
        if al_.get("evidenceStale") is not False:
            errs.append("status READY needs evidence known to be fresh (age %s, stale %s)" % (al_.get("evidenceAgeHours"), al_.get("evidenceStale")))
        if (rep["purposeAndCost"]["spend"] or {}).get("withinCap") is False:
            errs.append("status READY although actual usage exceeded a cap")
    if rep["workflowVersion"] != wf["version"]:
        errs.append("workflow version mismatch")
    if not isinstance(rep["deviations"], list):
        errs.append("deviations must be a list")
    if not all(k in rep["denominators"] for k in ("requirements", "journeys", "assertions")):
        errs.append("the three denominators must be reported separately")
    for name, c in rep["purposeAndCost"]["spend"]["costs"].items():
        if c["status"] == "unknown" and c.get("usd") is not None:
            errs.append("%s cost is unknown but carries a number" % name)
        if c["status"] == "reported" and not (c.get("source") and c.get("asOfUtc")):
            errs.append("%s cost is reported without a source and time" % name)
    blob = json.dumps(rep)
    for pat in SECRET_PATTERNS:
        if pat.search(blob):
            errs.append("report content matches a secret/identifier pattern: %s" % pat.pattern[:30])
    return errs


def fmt_unknown(c, usd_label="USD"):
    if c["status"] == "unknown":
        return "<b>unknown</b> <span class='small muted'>%s</span>" % esc(c["note"])
    return "<b>%s %s</b> <span class='small muted'>source: %s, as of %s</span>" % (esc(c["usd"]), usd_label, esc(c["source"]), esc(c["asOfUtc"]))


def render_coverage(rep):
    cv = rep.get("coverage")
    if not cv:
        return ""
    kind = cv["kind"]
    chip = "improved" if cv.get("fullLiveRun") else ("inconclusive" if kind in ("NO RUN", "PARTIAL") else "regressed")
    o = ["<section id='coverage'><h2>Run kind and assertion coverage</h2><p><span class='pill %s'>%s</span> &nbsp;%s</p>" % (chip, esc(kind), esc(cv.get("statement") or "; ".join(cv.get("reasons") or [])))]
    o.append("<p class='small'>A full live run executes all %d journeys and every one of the %d required assertion rows (or names each omission with an approval). A partial run and carried-forward verdicts are shown but never counted as the full live run.</p>" % (cv["casesRequired"], cv["rowsRequired"]))
    if cv.get("reasons"):
        o.append("<ul>" + "".join("<li>%s</li>" % esc(r) for r in cv["reasons"]) + "</ul>")
    if cv.get("cases"):
        rows = [[esc(c["case"]), "%d of %d" % (c["executed"], c["required"]), esc(", ".join(c["notExecuted"][:6]) + (" +%d more" % (len(c["notExecuted"]) - 6) if len(c["notExecuted"]) > 6 else "") or "none")] for c in cv["cases"]]
        o.append(table(["Journey", "Rows executed", "Not executed"], rows, "plain"))
    if cv.get("approvedOmissionsApplied"):
        o.append("<p class='small'><b>Approved omissions:</b> " + "; ".join("%s/%s (%s; %s)" % (esc(x["case"]), esc(x["assertion"]), esc(x["reason"]), esc(x["approvalRef"])) for x in cv["approvedOmissionsApplied"]) + "</p>")
    o.append("</section>")
    return "".join(o)


def render_alerts(rep):
    al = rep.get("alerts")
    if not al:
        return ""
    chip = {"ALERT": "regressed", "WATCH": "inconclusive", "OK": "improved"}[al["status"]]
    o = ["<section id='alerts'><h2>Alerts</h2><p><span class='pill %s'>%s</span> &nbsp;critical %d, high %d, medium %d, info %d; run %s compared with %s</p>" % (chip, esc(al["status"]), al["counts"]["critical"], al["counts"]["high"], al["counts"]["medium"], al["counts"]["info"], esc(al["runLabel"]), esc(str(al["comparedWith"])))]
    if al["alerts"]:
        rows = []
        for a in al["alerts"]:
            lk = a.get("lastKnownGood")
            rows.append([esc(a["severity"]), esc(a["kind"]), esc(a["title"]), esc(", ".join((a.get("rows") or [])[:4])) or "-",
                         esc("%s (served %s)" % (lk["run"], str(lk["servedSha"])[:8])) if lk else "-", esc(a.get("action") or "")])
        o.append(table(["Severity", "Kind", "What", "Rows", "Last known good", "Action"], rows, "plain"))
    o.append("<p class='small muted'>%s</p></section>" % esc(al["delivery"]))
    return "".join(o)


def render_safety(rep):
    sf = ((rep["executiveSummary"]["fields"].get("readinessBasis") or {}).get("safety"))
    iso = rep.get("isolation")
    if not sf and not iso:
        return ""
    o = ["<section id='safety'><h2>Safety checks in the verdict</h2>"]
    if sf:
        o.append("<p>%s</p>" % esc(sf["text"]))
    if iso:
        chip = {"proven": "improved", "failed": "regressed", "not-proven": "inconclusive"}[iso["status"]]
        o.append("<p><span class='pill %s'>isolation %s</span></p>" % (chip, esc(iso["status"])))
        if iso["problems"]:
            o.append("<ul>" + "".join("<li>%s</li>" % esc(p) for p in iso["problems"][:8]) + "</ul>")
    o.append("<p class='small muted'>READY needs isolation proven, no critical or blocking alert, evidence known to be fresh and usage within every cap, in addition to a full live run.</p></section>")
    return "".join(o)


def render_concerns(rep):
    c = rep.get("concerns")
    if not c:
        return ""
    chip = {"OBSERVED CLEAN": "improved", "OBSERVED PROBLEM": "regressed", "NOT OBSERVABLE": "inconclusive", "NOTE": "inconclusive"}
    o = ["<section id='concerns'><h2>Concerns of %s: observed alongside the journeys of %s</h2><p class='small'>%s</p>" % (esc(" and ".join(c["sourceRefs"])), esc(c["runLabel"]), esc(c["rule"]))]
    rows = []
    for k in c["concerns"]:
        for i, s in enumerate(k["subObservations"]):
            ev = "; ".join("%s %s%s" % (e["file"], (e.get("sha256") or "no file")[:8], (" seq " + ",".join(str(x) for x in e["eventSeq"])) if e.get("eventSeq") else "") for e in s["evidence"][:3]) or "none"
            rows.append(["<b>%s</b> %s%s" % (esc(k["id"]), esc(k["title"]) if i == 0 else "", "<br><span class='pill %s'>%s</span>" % (chip[k["verdict"]], esc(k["verdict"])) if i == 0 else ""),
                         esc(s["name"]), "<span class='pill %s'>%s</span>" % (chip[s["verdict"]], esc(s["verdict"])), esc(", ".join(s["journeys"][:6]) + (" +%d" % (len(s["journeys"]) - 6) if len(s["journeys"]) > 6 else "")),
                         esc(" to ".join(s["observedUtc"]) or " to ".join(k["runUtc"])), "<span class='small'>%s<br>%s</span>" % (esc(s["detail"]), esc(ev))])
    o.append(table(["Concern", "Observation", "Result", "Journey", "UTC", "Detail and sanitized evidence"], rows, "plain"))
    o.append("<h3>Reproduction steps</h3>")
    for k in c["concerns"]:
        o.append("<p class='small'><b>%s</b>: %s</p>" % (esc(k["id"]), esc(" ".join("(%d) %s" % (i + 1, s) for i, s in enumerate(k["reproduction"])))))
    o.append("<p class='small muted'>Missing visibility is not proof of safety and is not a product failure. Evidence is sanitized: file, hash, event numbers and counts; matched text is never reproduced. Free / $0 plan: no new traffic, stimulus or campaign.</p></section>")
    return "".join(o)


def render_features(rep):
    f = rep.get("features")
    if not f:
        return ""
    o = ["<section id='features'><h2>Reviewed features (feature, expected behaviour, test coverage)</h2>"]
    if not f["features"]:
        o.append("<p class='small'>No reviewed feature is registered (config/feature-ledger.json). A customer-facing change enters regression through a verified fix for a gap OR a reviewed feature with expected behaviour and test coverage; an unlinked change is rejected by the release check.</p></section>")
        return "".join(o)
    rows = [[esc(x["id"]) + "<br><span class='small'>" + esc(x.get("title") or "") + "</span>", esc(x.get("pr") or "-"), esc(x["inclusion"]), esc(x.get("expectedBehaviour") or "-"), esc(", ".join(x["coverageRows"][:4])), "<b>%s</b><br><span class='small'>%s</span>" % (esc(x["status"]), esc(x["statusReason"]))] for x in f["features"]]
    o.append(table(["Feature", "PR", "Deployed", "Expected behaviour", "Covered by", "Status"], rows, "plain"))
    o.append("</section>")
    return "".join(o)


def render_budget(rep):
    b = rep.get("fullCoverageBudget")
    if not b:
        return ""
    r, c, a, w, d = b["requests"], b["cumulative"], b["actions"], b["window"], b["dollars"]
    o = ["<section id='budget'><h2>Full-coverage budget (proposal, not approved)</h2><p class='small'>%s</p><p class='small'>%s</p>" % (esc(b["approvalNote"]), esc(b["model"]["limitation"]))]
    rows = [[esc(p["case"]), "%d + %d" % (p["fixedObserved"], p["variableObserved"]), "%d/%d" % (p["rowsExecutedBestObserved"], p["rowsRequired"]), "%.2f%s" % (p["uplift"], "*" if p["upliftCapped"] else ""),
             "<b>%d</b>" % p["estimate"], str(p["ceiling"]), str(p["failureAllowance"]), "%d / %d" % (p["startsMin"], p["takesMin"]), "%.0f / %d" % (p["expectedWallSeconds"] / 60, p["maxWallSeconds"] // 60)] for p in b["perCase"]]
    o.append(table(["Journey", "Observed fixed + variable", "Rows exec/required", "Uplift", "Estimate", "Ceiling", "Failure allowance", "Starts / takes", "Expected / limit min"], rows, "plain"))
    o.append("<p class='small'>* uplift limited by the cap. Ceiling = estimate x %d%% rounded up to 10 (the reviewed plan builder rule).</p>" % r["allowancePct"])
    o.append("<dl class='kv'><dt>Run cap</dt><dd>%s (per-case ceilings sum to %d; failure allowance %d)</dd><dt>Cumulative ceiling</dt><dd>%s; current %d; increase %d; earlier proposal %d</dd>" % (esc(r["arithmetic"]), r["sumOfCaseCeilings"], r["perCaseFailureAllowanceTotal"], esc(c["arithmetic"]), c["currentCeiling"], c["increase"], c["earlierProposal"]))
    o.append("<dt>Identity reads</dt><dd>%d this run; %d cumulative against a cap of %d (%s)</dd><dt>Starts</dt><dd>%d used + %d minimum = %d against %d (%s)</dd><dt>Takes</dt><dd>%d used + %d minimum = %d against %d</dd>" % (
        b["identity"]["readsThisRun"], b["identity"]["required"], b["identity"]["currentCap"], esc(b["identity"]["ownerDecision"]), a["startsUsed"], a["startsMinimum"], a["startsRequired"], a["startsCap"], esc(a["ownerDecision"]), a["takesUsed"], a["takesMinimum"], a["takesRequired"], a["takesCap"]))
    o.append("<dt>Coaching cap</dt><dd>%d (%s)</dd><dt>Run window</dt><dd>expected about %d min, worst case %d min, proposed %d min. %s</dd></dl>" % (b["coaching"]["cap"], esc(b["coaching"]["basis"]), w["expectedMinutes"], w["worstCaseMinutes"], w["proposedWindowMinutes"], esc(w["rule"])))
    o.append("<h3>Dollars (four separate accounts)</h3><ul><li>Paid actions: $%s authorized.</li><li>Provider: %s</li><li>GitHub: %s</li><li>Cloud agent: %s</li></ul>" % (d["paidActionsAuthorizedUsd"], esc(d["providerCoaching"]["statement"]), esc(d["githubActions"]["statement"]), esc(d["cloudAgent"]["statement"])))
    o.append(table(["Uplift cap", "Sum of estimates", "Run cap", "Required ceiling"], [[str(x["upliftCap"]), str(x["plannedSumOfEstimates"]), str(x["runCap"]), str(x["requiredCeiling"])] for x in b["sensitivity"]], "plain"))
    o.append("</section>")
    return "".join(o)


def render(rep, wf):
    ex = rep["executiveSummary"]
    f = ex["fields"]
    sp = rep["purposeAndCost"]["spend"]
    rc = rep["purposeAndCost"]["reconciliation"]
    chip = {"READY": "improved", "LIMITED": "inconclusive", "BLOCKED": "regressed"}[rep["status"]]
    L2, L1 = rep["labels"]["r2"], rep["labels"]["r1"]
    lat = "Latest (%s)" % rep["labels"]["latest"]
    h = []
    A = h.append
    A("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Cloud test report</title><style>%s%s</style></head><body><div class='wrap'>" % (R.CSS, EXTRA_CSS))
    A("<h1>SpeakSharp cloud test report</h1>")
    A("<p class='sub'>Run <code>%s</code>%s · workflow version <code>%s</code> · config <code>%s</code> · generated %s · every value below is derived from sealed receipts, git and the run record</p>" % (esc(rep["runId"]), " · <b>PROPOSAL: not approved, no run has happened</b>" if rep["proposal"] else "", esc(rep["workflowVersion"]), esc(rep["configVersion"]), esc(rep["generatedUtc"])))
    A("<nav class='toc'>" + "".join("<a href='#%s'>%s</a>" % (i, esc(t)) for i, t in (("summary", "Summary"), ("purpose", "Purpose and cost"), ("areas", "Product areas"), ("journeys", "Journeys"), ("gaps", "Gap closure"), ("release", "Release verification"), ("gates", "Gates and blockers"), ("plan", "Plan and identities"), ("proof", "Offline proof"), ("dev", "Deviations"), ("appendix", "Appendix"), ("evidence", "Evidence"))) + "</nav>")
    A("<section class='lead' id='summary'><p class='kicker'>Executive summary (%d of %d words)</p><p class='headline'><span class='pill %s'>%s</span> &nbsp;Recommendation: %s</p>" % (ex["words"], wf["report"]["executiveSummaryMaxWords"], chip, esc(rep["status"]), esc(f["recommendation"])))
    for k, v in ex["parts"][1:]:
        A("<p><b>%s.</b> %s</p>" % (esc(k), esc(v if v.endswith((".", "!", "?")) else v + ".")))
    A("</section>")
    h.append(render_coverage(rep))
    h.append(render_alerts(rep))
    h.append(render_safety(rep))
    h.append(render_concerns(rep))
    h.append(render_features(rep))
    h.append(render_budget(rep))
    # purpose and cost
    rq, cap = sp["requests"], sp["requests"]["cap"]
    A("<section id='purpose'><h2>Purpose, cost cap and spend</h2><dl class='kv'><dt>Purpose</dt><dd>%s</dd><dt>Priority</dt><dd>%s</dd><dt>Targeted gaps</dt><dd>%s</dd></dl>" % (esc(rep["purposeAndCost"]["purpose"]), esc(rep["purposeAndCost"]["priority"]), esc(", ".join(rep["purposeAndCost"]["targetedGaps"]))))
    nt = rep["purposeAndCost"]["notTargeted"]
    if nt:
        A("<p class='small muted'>Not targeted, on purpose (no broad reruns): " + "; ".join("<b>%s</b> %s" % (esc(n["gap"]), esc(n["why"])) for n in nt) + "</p>")
    A("<h3>Four separate accounts (none is merged into another, none defaults to zero)</h3>")
    act = rq.get("actual")
    rows = [["<b>1. Guarded request counts</b>", "estimate %s planned, run cap %s (%s)" % (rq["estimate"]["planned"], cap["runCapRequests"], esc(sp["capBasis"])),
             ("%s requests (%s); %s identity reads; Starts %s; takes %s" % (act["total"], esc(json.dumps(act["byCategory"])), sp["identityReads"]["actual"], sp["starts"]["actual"] if sp["starts"]["actual"] is not None else "not recorded", sp["takes"]["actual"] if sp["takes"]["actual"] is not None else "not recorded")) if act else "NOT RUN: no actual count exists"],
            ["<b>2. Provider cost</b>", "coaching requests capped at %s by the guard (so a coaching call is denied, not billed)" % sp["costs"]["provider"]["billableRequests"]["coaching"]["cap"],
             "billable requests used: %s; dollars: %s" % (sp["costs"]["provider"]["billableRequests"]["coaching"]["actual"] if sp["costs"]["provider"]["billableRequests"]["coaching"]["actual"] is not None else "none measured yet", fmt_unknown(sp["costs"]["provider"]))],
            ["<b>3. GitHub Actions usage</b>", "at most %s runner minutes (sum of job timeouts)" % sp["costs"]["githubActions"]["estimateMaxRunnerMinutes"],
             "observed runner minutes: %s; billed dollars: %s" % (sp["costs"]["githubActions"]["observedRunnerMinutes"] if sp["costs"]["githubActions"]["observedRunnerMinutes"] is not None else "not observed", fmt_unknown(sp["costs"]["githubActions"]))],
            ["<b>4. Cloud-agent cost</b>", "not estimated by this package", fmt_unknown(sp["costs"]["cloudAgent"])],
            ["<b>Paid actions (payments, checkout)</b>", "authorized at $%s" % sp["paidActions"]["authorizedUsd"], esc("executed: %s" % (sp["paidActions"]["executed"] or "NOT RUN, none yet"))]]
    A(table(["Account", "Estimate / cap", "Actual"], rows, "plain"))
    if rq.get("categoryNote"):
        A("<p class='small muted'>%s.</p>" % esc(rq["categoryNote"]))
    A("<p class='small'><b>Status:</b> %s. <b>Balance before the run:</b> %s requests above the protected reserve; identity reads %s; Starts %s; takes %s." % (esc(sp["status"]), sp["remainingBeforeRun"]["requests"], sp["remainingBeforeRun"]["identityReads"], sp["remainingBeforeRun"]["starts"], sp["remainingBeforeRun"]["takes"]))
    if sp.get("remainingAfterRun"):
        ra = sp["remainingAfterRun"]
        A(" <b>After the run:</b> %s requests above the reserve; identity reads %s; Starts %s; takes %s." % (ra["requests"], ra["identityReads"], ra["starts"] if ra["starts"] is not None else "not recorded", ra["takes"] if ra["takes"] is not None else "not recorded"))
    A("</p>")
    A("<h3>Cumulative usage reconciled before any ceiling is approved</h3>")
    rows = [[esc(r["label"]), str(r["requests"]), str(r["identityReads"]), "<span class='small'>%s</span>" % esc(r["ledger"])] for r in rc["runs"]]
    rr_ = rc["requests"]
    rows.append(["<b>Measured total (sealed ledgers)</b>", "<b>%s</b>" % rr_["measuredFromSealedLedgers"], "<b>%s</b>" % rc["identityReads"]["measuredFromSealedLedgers"], ""])
    rows.append(["<b>Owner-counted</b>", "%s" % rr_["ownerCounted"], "%s" % rc["identityReads"]["ownerCounted"], "<span class='small'>%s</span>" % esc(rr_["ownerCountedBasis"])])
    rows.append(["<b>Unreconciled</b>", "<b>%s</b>" % rr_["unreconciled"], "%s" % rc["identityReads"]["unreconciled"], "<span class='small'>%s above the sealed ledgers in the owner baseline plus %s estimated outside-run</span>" % (rr_["unreconciledParts"]["baselineAboveSealedLedgers"], rr_["unreconciledParts"]["outsideRunEstimate"])])
    rows.append(["<b>Used for limits (conservative)</b>", "<b>%s</b>" % rr_["conservativeUsed"], "%s" % rc["identityReads"]["conservativeUsed"], "<span class='small'>%s</span>" % esc(rr_["conservativeBasis"])])
    A(table(["Run (frozen before the run)", "Requests", "Identity reads", "Source"], rows, "plain"))
    A("<p class='small'><b>Counters are frozen through %s</b> (as of %s); a later run's actual usage is added once, never counted inside the frozen figure.%s</p>" % (esc(rc["freeze"]["throughRun"]), esc(rc["freeze"]["asOfUtc"]),
      (" <b>This run, added once:</b> %s requests and %s identity reads on top of %s and %s, giving %s and %s after the run." % (sp["countedOnce"]["thisRunActual"]["requests"], sp["countedOnce"]["thisRunActual"]["identityReads"], sp["countedOnce"]["frozenBefore"]["requests"], sp["countedOnce"]["frozenBefore"]["identityReads"], sp["countedOnce"]["afterRun"]["requests"], sp["countedOnce"]["afterRun"]["identityReads"])) if sp.get("countedOnce") else ""))
    A("<p class='small'>Ceilings now: %s requests with a %s protected reserve, %s identity reads, %s Starts, %s takes. Headroom now: %s requests, %s identity reads. Starts and takes are owner-stated; the sealed ledgers do not carry them.</p></section>" % (rc["ceilings"]["requests"], rc["ceilings"]["protectedReserveRequests"], rc["ceilings"]["identityReads"], rc["ceilings"]["starts"], rc["ceilings"]["takes"], rc["currentHeadroom"]["requests"], rc["currentHeadroom"]["identityReads"]))
    # areas
    A("<section id='areas'><h2>Seven product areas: %s | %s | Latest</h2><p class='small muted'>Cells count the area's primary journeys by verdict. Classes follow the comparability rules; a changed observer or lost coverage is never an improvement.</p>" % (esc(L2), esc(L1)))
    rows = []
    for a in rep["areas"]:
        cls = a["latestClass"] or a["priorPairClass"]
        lat_cell = journey_summary(a["latest"]) if a["latest"] else "<span class='muted'>PENDING (not run)</span>"
        rows.append(["<b>%s</b> %s" % (esc(a["id"]), esc(a["name"])), journey_summary(a["prev"]), journey_summary(a["cur"]), lat_cell,
                     "%s <span class='small'>%s%s</span>" % (R.pill(cls), esc(R.plain(a["why"] or "", 330)), "" if a["latestClass"] else " (%s vs %s)" % (esc(L1), esc(L2))),
                     esc(", ".join(a["openGaps"]) + " open" if a["openGaps"] else "no tracked gap open")])
    A(table(["Product area", L2, L1, lat, "What improved or worsened", "Remaining gap"], rows, "areas"))
    A("</section>")
    A("<section id='journeys'><h2>Fifteen journeys: %s | %s | Latest</h2>" % (esc(L2), esc(L1)))
    rows = []
    for j in rep["journeys"]:
        cls = j["latestClass"] or j["priorPairClass"]
        rows.append(["<b>%s</b> %s" % (esc(j["id"]), esc(j["title"] or "")), verdict_cell(j["r2"]), verdict_cell(j["r1"]), verdict_cell(j["latest"]) if j["latest"] else "<span class='muted'>PENDING</span>",
                     "%s <span class='small'>%s</span>" % (R.pill(cls), esc(R.plain(j["why"] or "", 260))), "<span class='small'>sealed receipts: %s, %s</span>" % (esc(L2), esc(L1))])
    A(table(["Journey", L2, L1, lat, "Change classification", "Evidence"], rows, "journeys"))
    A("</section>")
    # gaps (all derived)
    A("<section id='gaps'><h2>Gap-closure ledger</h2><p class='small muted'>Every cell is derived: prior verdicts and evidence from the sealed receipts (file and sha256), deployed inclusion from git and the identity ledgers, latest from the latest run, status from the rules. A gap stays OPEN until deployed inclusion and its expected-PASS test both have proof; FAIL to NOT RUN, or a changed observer, never counts as a fix.</p>")
    rows = []
    for g in rep["gapLedger"]:
        pf, fx, ep, lt = g["priorFail"], g["fix"], g["expectedPass"], g["latest"]
        runs = " · ".join("%s %s" % (esc(r), esc(v["rollup"])) for r, v in g["history"].items())
        prior = ("<b>%s</b> first FAIL: %s<br><span class='small'>%s</span>" % (esc(pf["run"]), esc(", ".join(pf["what"])), esc(ev_text(pf["evidence"], 2)))) if pf else "no FAIL in the compared runs"
        fixc = "%s%s%s<br><span class='small muted'>%s</span>" % (esc(("#" + fx["pr"].lstrip("#")) if fx.get("pr") else "none"), (" (" + esc(short_sha(fx.get("commit"))) + ")") if fx.get("commit") else "", " <b>CANDIDATE only</b>" if fx.get("candidate") else "", esc(R.plain(fx.get("note", ""), 200)))
        inc = "<b>%s</b><br><span class='small'>%s</span>" % (esc(fx.get("inclusion")), esc(R.plain(fx.get("basis") or "", 230)))
        pc = lt.get("perCase")
        lat_ = ("%s<br><span class='small'>%s</span>" % (esc(lt["result"]), esc(ev_text(lt.get("evidence"), 2)))) if lt.get("evidence") else esc(lt["result"])
        if pc:
            lat_ += "<br><span class='small'>" + esc("; ".join("%s %s" % (c, v["result"]) for c, v in pc.items())) + "</span>"
        if lt.get("comparedAgainst"):
            by = {}
            for k_, lab_ in lt["comparedAgainst"].items():
                by.setdefault(lab_, []).append(k_.split("/")[1])
            lat_ += "<br><span class='small muted'>compared with: " + esc("; ".join("%s (%d row%s)" % (l_, len(v_), "" if len(v_) == 1 else "s") for l_, v_ in by.items())) + (" - " + esc(lt["comparableReason"]) if lt.get("comparableReason") else "") + "</span>"
        rows.append(["<b>%s</b> %s<br><span class='small muted'>%s · %s%s</span>" % (esc(g["id"]), esc(g["title"]), esc(g["area"]), esc(g["kind"]), " · targeted this run" if g["id"] in rep["purposeAndCost"]["targetedGaps"] else ""),
                     "%s<br><span class='small muted'>%s</span>" % (prior, runs), fixc, inc,
                     "<span class='small'>%s<br><b>Every case required:</b> %s. Defined %s; owner-confirmed: %s.</span>" % (esc(ep["criteria"]), esc("; ".join("%s: %s" % (r["case"], ", ".join(r["assertions"])) for r in ep["requirements"])), esc(ep["definedAtUtc"]), "yes" if ep.get("confirmedByOwner") else "no"),
                     lat_, "<b>%s</b><br><span class='small muted'>%s</span>" % (esc(g["status"]), esc(g["statusReason"]))])
    A(table(wf["report"]["gapLedgerColumns"], rows, "gaps"))
    A("</section>")
    # release verification
    rv = rep["releaseVerification"]
    A("<section id='release'><h2>Release and deployment verification</h2><p class='small muted'>Product changes are not rejected for being product changes. A customer-facing commit passes when it is a verified deployed fix tied to a gap with expected-PASS criteria; it is rejected when unlinked, when its deployment is unverified, or when the gap has no expected PASS. Classification is mechanical, from the paths each commit changes.</p>")
    fe, be = rv["frontend"], rv["backend"]
    A("<dl class='kv'><dt>Tested SHA</dt><dd><code>%s</code> (last run tested <code>%s</code>)</dd><dt>Frontend deployment</dt><dd>%s</dd><dt>Backend deployment</dt><dd>%s</dd></dl>" % (
        esc(rv["testedSha"]), esc(rv["lastRunTestedSha"][:8]),
        esc(("verified from sealed receipts: " + fe["evidence"] + (", %.1f hours old, %s" % (fe["ageHours"], "fresh" if fe["fresh"] else "STALE"))) if fe.get("servedSha") else "not verified"),
        esc("cloud-verified %s (%s)" % (be["verifiedAtUtc"], be["evidenceRef"]) if be["verified"] else "%s; not verified by the package" % (be.get("source") or "undeclared"))))
    sl = rv.get("sinceLastRun")
    A("<h3>Changes since the last run: %s</h3>" % ("cannot be verified (git history missing)" if sl is None else ("none" if not sl else "%d commit(s)" % len(sl))))
    if sl:
        rows = [[esc(v["sha"]), esc("#%s" % v["pr"] if v["pr"] else ""), "yes" if v["customerFacing"] else "no", esc(", ".join(v["gaps"]) or "none"), "<b>%s</b>" % esc(v["decision"]), esc(v["reason"])] for v in rv["commitVerdicts"]]
        A(table(["Commit", "PR", "Customer-facing", "Gap", "Decision", "Reason"], rows, "plain commits"))
    sb = rv.get("sinceBaseline") or []
    linked = {f["commit"]: gid for gid, f in rv["fixes"].items() if f.get("commit")}
    A("<h3>Changes in the tested release since %s (%d commits, %d customer-facing)</h3>" % (esc(rv.get("baselineLabel", "baseline")), len(sb), sum(1 for c in sb if c["customerFacing"])))
    rows = [[esc(c["short"]), esc("#%s" % c["pr"] if c["pr"] else ""), esc(c["subject"]), "yes" if c["customerFacing"] else "no", "yes" if c["touchesBackend"] else "no", esc(linked.get(c["sha"], "none"))] for c in sb if c["customerFacing"]]
    A(table(["Commit", "PR", "Subject", "Customer-facing", "Backend paths", "Linked gap"], rows or [["", "", "none customer-facing", "", "", ""]], "plain commits"))
    A("<p class='small muted'>Customer-facing changes with no linked gap (for example #1740 and #1745) were never given expected-PASS criteria. They are not part of this run's claims.</p>")
    A("</section>")
    # gates
    gt = rep["gates"]
    A("<section id='gates'><h2>Gates and blockers</h2><p>Decision at this stage (%s): <b>%s</b>. Blocking open: %s. Deferred to the run environment: %s.</p>" % (esc(gt.get("stage")), esc(gt["decision"]), esc(", ".join(gt["blockingOpen"]) or "none"), esc(", ".join(gt.get("deferred", [])) or "none")))
    rows = [["<b>%s</b> %s" % (esc(g["id"]), esc(rep["gateNames"].get(g["id"], ""))), esc(g["status"]), esc(g["detail"]), "<br>".join(esc(n) for n in g["needs"][:6])] for g in gt["gates"]]
    A(table(["Gate", "Status", "Detail", "Needed"], rows, "plain"))
    A("<p class='small muted'>Runtime gates (live identity read before and after each case; admission A0 to A7) are evaluated by the harness during a run.</p></section>")
    # plan
    har = rep["harness"]
    A("<section id='plan'><h2>Plan and identities</h2><dl class='kv'><dt>Tested release</dt><dd><code>%s</code></dd><dt>Harness code manifest</dt><dd><code>%s</code></dd><dt>Harness packet manifest</dt><dd><code>%s</code></dd></dl>" % (esc(rep["release"]["testedSha"]), esc(har["codeManifestSha256"]), esc(har["packetManifestSha256"])))
    rows = [[str(s["order"]), "<b>%s</b>" % esc(s["case"]), esc(", ".join(s["gaps"])), esc(s["role"]), esc(s.get("gate") or "none"), str(s["plannedRequests"]), esc(s["reason"])] for s in rep["selection"]]
    A(table(["Order", "Case", "Gaps", "Role", "Gate (zero spend if unmet)", "Planned requests", "Why selected"], rows, "plain"))
    ap = rep["approvals"]
    A("<p class='small'>Approvals: limits %s; window %s; harness hash %s; case selection %s.</p></section>" % (esc((ap["limits"] or {}).get("approvalRef") or "NOT GIVEN"), esc((ap["window"] or {}).get("approvalRef") or "NOT SET"), esc(ap["harnessApproval"] or "NOT GIVEN"), esc(ap["selection"] or "NOT GIVEN")))
    pr = rep["offlineProof"]
    A("<section id='proof'><h2>Executed offline proof</h2><p>%s: %s tests passed, %s failed; plan controls: %s of %s negative plans refused, %s of %s positive accepted. Harness hash <code>%s</code>.</p>" % (esc(pr["result"]), pr["testsPassed"], pr["testsFailed"], pr["planControls"]["negativeRefused"], pr["planControls"]["negative"], pr["planControls"]["positiveAccepted"], pr["planControls"]["positive"], esc(pr["codeManifestSha256"])))
    rows = [["<b>%s</b>" % esc(c["id"]), esc(c["correction"]), str(c["tests"]), str(c["mutationControls"]), esc(c["result"])] for c in pr["corrections"]]
    A(table(["Correction", "What it proves", "Executed tests", "Mutation controls", "Result"], rows, "plain"))
    A("</section>")
    A("<section id='dev'><h2>Deviations from workflow %s</h2>%s</section>" % (esc(rep["workflowVersion"]), "<p>None declared.</p>" if not rep["deviations"] else "<ul class='tight'>" + "".join("<li>%s</li>" % esc(json.dumps(d)) for d in rep["deviations"]) + "</ul>"))
    d = rep["denominators"]
    rows = [[esc(k), esc(str(v["total"])), esc(json.dumps(v["previous"])), esc(json.dumps(v["current"]))] for k, v in d.items()]
    A("<section id='appendix'><h2>Appendix: %s against %s</h2><p class='small'>%s</p>" % (esc(L1), esc(L2), esc(rep["priorPairHeadline"])))
    A(table(["Denominator (kept separate)", "Total", L2, L1], rows, "plain"))
    A("<p class='small'><b>%s</b> %s</p></section>" % (esc(rep["comparisonValidity"]["verdict"]), esc(R.plain(rep["comparisonValidity"]["statement"], 600))))
    A("<section id='evidence'><h2>Evidence index</h2><p class='small'>Every input file is copied under <code>inputs/</code> and hash-listed in <code>MANIFEST.json</code>. The prior runs' original receipts are sealed in <code>config/history/receipts/</code> and pinned by hash in the config; the comparison is generated from them.</p></section>")
    A("</div></body></html>")
    return "\n".join(h)


def main():
    p = argparse.ArgumentParser()
    for k in ("request", "ledger-derived", "release-verification", "reconciliation", "gates", "spend", "offline-proof", "workflow", "comparison", "summary", "out"):
        p.add_argument("--" + k, required=True)
    for k in ("latest-comparison", "run-record"):
        p.add_argument("--" + k)
    for k in ("coverage", "budget", "alerts", "isolation", "features", "concerns"):
        p.add_argument("--" + k)
    p.add_argument("--bindings", nargs="*", default=[])
    p.add_argument("--labels", nargs=2, required=True)
    p.add_argument("--generated-at", default="1970-01-01T00:00:00Z")
    a = p.parse_args()
    if os.path.exists(a.out):
        sys.exit("output directory must not exist")
    rep, wf = build(a)
    errs = validate(rep, wf)
    os.makedirs(os.path.join(a.out, "inputs"))
    for k in ("request", "ledger_derived", "release_verification", "reconciliation", "gates", "spend", "offline_proof", "workflow", "comparison", "latest_comparison", "summary", "run_record", "coverage", "budget", "alerts", "isolation", "features", "concerns"):
        v = getattr(a, k)
        if v:
            shutil.copyfile(v, os.path.join(a.out, "inputs", os.path.basename(v)))
    for b in a.bindings:
        shutil.copyfile(b, os.path.join(a.out, "inputs", os.path.basename(b)))
    with open(os.path.join(a.out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    with open(os.path.join(a.out, "REPORT.html"), "w", encoding="utf-8") as f:
        f.write(render(rep, wf))
    with open(os.path.join(a.out, "validation.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": "speaksharp.cloud-test.report-validation.v2", "valid": not errs, "errors": errs, "summaryWords": rep["executiveSummary"]["words"]}, f, indent=1)
    man = {}
    for root, _, files in os.walk(a.out):
        for fn in sorted(files):
            full = os.path.join(root, fn)
            man[os.path.relpath(full, a.out)] = sha(full)
    with open(os.path.join(a.out, "MANIFEST.json"), "w", encoding="utf-8") as f:
        json.dump({"schema": "speaksharp.cloud-test.report-manifest.v1", "files": dict(sorted(man.items()))}, f, indent=1)
    print("report", "VALID" if not errs else "INVALID", "| summary words", rep["executiveSummary"]["words"], "| status", rep["status"])
    for e in errs:
        print("ERROR:", e)
    sys.exit(0 if not errs else 1)


if __name__ == "__main__":
    main()
