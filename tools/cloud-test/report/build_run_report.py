#!/usr/bin/env python3
"""build_run_report.py - offline prior-vs-current report for SpeakSharp cloud-test runs.

No network, no credentials, no live request. Reads two run directories (the current run and the previous run, with the
previous run's ORIGINAL receipts) and writes a NEW output directory containing:

  REPORT.html        self-contained, offline, phone-width friendly, light/dark
  comparison.json    machine-readable comparison (same classes as the report)
  journeys.csv assertions.csv changes.csv requirements.csv
  receipts/          copies of both runs' original case receipts and binding files, hash-linked
  MANIFEST.json      sha256 of every other file in the output directory

Usage
  build_run_report.py --current RUN_DIR --previous RUN_DIR --out NEW_DIR
        [--current-label R5] [--previous-label R4C]
        [--facts comparability-facts.json] [--overlay overlay.json]
        [--traceability-dir DIR_WITH_matrix_AND_crosswalk]
        [--current-code-manifest CODE.sha256] [--previous-code-manifest CODE.sha256]
        [--previous-supplement RUN_DIR]... [--current-supplement RUN_DIR]...
        [--previous-extra FILE]... [--current-extra FILE]...
        [--expect 151,15,204] [--generated-at 2026-10-28T12:00:00Z]

Run directory layouts accepted: a flat export (case-results.json, AHT-NN/, campaign-plan.json, ...) or a run root with
run/case-results.json, run/cases/AHT-NN/, cfg/campaign-plan.json, ledgers/.
The output directory must not exist. Nothing in the inputs is modified.
"""
import argparse
import collections
import csv
import datetime
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
import rr_core as C  # noqa: E402
import rr_render as R  # noqa: E402

VERSION = "1.0"
SAFE_NAME = re.compile(r"^[A-Za-z0-9._\-]+$")

GATE_SHORT = {
    "media-binding-differs": "media / capture binding differs",
    "stimulus-not-established": "stimulus not established",
    "driver-changed": "driver changed",
    "allowance-interrupted": "stopped by the request allowance",
    "omitted-by-design": "omitted by design",
    "coverage-lost": "coverage lost",
    "observer-changed": "observer changed",
    "observer-unproven": "observer not shown to be the same (harness packet differs)",
    "prior-receipt-missing": "prior receipt missing",
    "current-receipt-missing": "current receipt missing",
    "journey-not-in-both-runs": "journey not in both runs",
    "no-prior-verdict": "no prior verdict",
    "row-not-in-both-runs": "row not in both runs",
}


def die(msg):
    sys.stderr.write("REFUSED: " + msg + "\n")
    sys.exit(2)


# ---------------------------------------------------------------------------------------------------------------------
# traceability (areas and related journeys)
# ---------------------------------------------------------------------------------------------------------------------
def load_traceability(d):
    if not d:
        return None
    out = {"category_names": {}, "related_journeys": {}, "files": []}
    m = os.path.join(d, "requirements-traceability.matrix.json")
    cw = os.path.join(d, "requirements-traceability.live-consumer-crosswalk.json")
    if os.path.isfile(m):
        mj = C.read_json(m)
        for k, v in (mj.get("categories") or {}).items():
            out["category_names"][k] = v.get("name")
        out["files"].append({"file": os.path.basename(m), "sha256": C.sha256_file(m)})
    if os.path.isfile(cw):
        cj = C.read_json(cw)
        rel = collections.defaultdict(set)
        for r in cj.get("rows") or []:
            for t in r.get("live_consumer_test_ids") or []:
                if re.match(r"^AHT-\d+$", t):
                    rel[r.get("category")].add(t)
        out["related_journeys"] = {k: sorted(v) for k, v in rel.items()}
        out["files"].append({"file": os.path.basename(cw), "sha256": C.sha256_file(cw)})
    return out


# ---------------------------------------------------------------------------------------------------------------------
# text builders
# ---------------------------------------------------------------------------------------------------------------------
def _plural(n, one, many=None):
    return "%d %s" % (n, one if n == 1 else (many or one + "s"))


def journey_why(j, changes, run_p, run_c):
    mine = [r for r in changes if r["case"] == j["id"]]
    lost = [r for r in mine if r["kind"] == "lost"]
    gained = [r for r in mine if r["kind"] == "gained"]
    parts = []

    def codes(rows):
        c = collections.Counter(r["reason_code"] for r in rows)
        return ", ".join("%s x%d" % (k, v) if v > 1 else k for k, v in c.items())
    if lost:
        parts.append("%s lost coverage (%s)" % (_plural(len(lost), "row"), codes(lost)))
    if gained:
        parts.append("%s gained a verdict (%s)" % (_plural(len(gained), "row"), codes(gained)))
    seen = []
    for g in j["reasons"]:
        if g["code"] in ("coverage-lost", "no-prior-verdict", "row-not-in-both-runs"):
            continue
        s = GATE_SHORT.get(g["code"], g["code"])
        if s not in seen:
            seen.append(s)
    if j["class"] == "inconclusive":
        if seen:
            parts.append("not comparable: " + "; ".join(seen))
        if j["retained_rows"] and j["retained_same"] and mine:
            parts.append("the %d rows with a verdict in both runs are unchanged" % j["retained_rows"])
    elif j["class"] == "unchanged":
        parts.append("same verdict on every row that has a verdict in either run")
        if j["disputed_rows"]:
            parts.append("the FAIL is on a disputed oracle in both runs (not scored, not a regression)")
        if j["unresolved"]:
            parts.append("no behavioural verdict in either run: unresolved")
        pc, cc = run_p["cases"].get(j["id"]), run_c["cases"].get(j["id"])
        sp = [s for s in (((pc or {}).get("guard") or {}).get("coaching_statuses") or []) if s and s >= 500]
        sc = [s for s in (((cc or {}).get("guard") or {}).get("coaching_statuses") or []) if s and s >= 500]
        if sp and sc:
            parts.append("coaching request answered HTTP %s in both runs (cause undiagnosed)" % "/".join(sorted({str(x) for x in sp + sc})))
    elif j["class"] == "improved":
        parts.append("a previously failing or unestablished row now passes on like-for-like evidence")
    elif j["class"] == "regressed":
        parts.append("a previously passing row now fails on like-for-like evidence")
    txt = "; ".join(parts)
    return (txt[:1].upper() + txt[1:]) + "."


def area_why(a, journeys_by_id):
    vr = [r for r in a["rows"] if r["has_verdict"]]
    if not vr:
        s = "No requirement row of this area has a verdict in either run (0 of %d): no comparison is possible" % a["n_rows"]
        if a["related_journeys"]:
            s += "; related journeys (%s) exercise it but are not scored" % ", ".join(a["related_journeys"])
        return s + "."
    bits = []
    inc = [r for r in vr if r["class"] == "inconclusive"]
    if a["class"] == "unchanged":
        s = "Every row with a verdict has the same verdict in both runs (%s)" % ", ".join("%s %s" % (r["id"], r["cur"]) for r in vr)
        if a["disputed"]:
            s += "; the FAIL rows sit on a disputed oracle in both runs: not scored, not a regression"
        no = [r["id"] for r in a["rows"] if not r["has_verdict"] and r["journey"]]
        if no:
            s += "; %s has no verdict in either run" % ", ".join(no)
        return s + "."
    if a["class"] == "inconclusive":
        for r in inc:
            j = journeys_by_id.get(r["id"])
            if j:
                codes = [GATE_SHORT.get(g["code"], g["code"]) for g in j["reasons"] if g["code"] not in ("coverage-lost",)]
                first = codes[0] if codes else "not comparable"
                bits.append("%s (%s%s)" % (r["id"], "%s→%s, " % (r["prev"], r["cur"]), first))
        return "%d of %d verdict rows are not comparable: %s." % (len(inc), len(vr), "; ".join(bits))
    return "%d verdict rows: %s." % (len(vr), ", ".join("%s %s→%s" % (r["id"], r["prev"], r["cur"]) for r in vr))


def make_headline(P, Cn, K, fates, changes, factors):
    J = K["journeys"]
    nj = sum(J.values())
    lost_pass = sum(1 for r in changes if r["kind"] == "lost" and r["prev"] == "PASS")
    gained = [r for r in changes if r["kind"] == "gained"]
    gained_imp = [r for r in gained if r["class"] == "improved"]
    names = {"release": "served release", "harness": "harness packet", "sample": "sample mode", "media": "capture-device binding", "observer": "observer",
             "drivers": "driver files", "allowance": "per-case allowance"}
    differing = [names[f["id"]] for f in factors if f["status"] == "differs" and f["id"] in names]
    if len(differing) > 1:
        diff_s = ", ".join(differing[:-1]) + " and " + differing[-1]
    else:
        diff_s = differing[0] if differing else "nothing recorded"
    head = "%s (served %s) against %s (served %s): " % (Cn["label"], C.short(Cn["servedSha"]), P["label"], C.short(P["servedSha"]))
    if J["improved"] or J["regressed"]:
        head += "%d of %d journeys improved and %d regressed on like-for-like evidence, %d are unchanged and %d are inconclusive" % (J["improved"], nj, J["regressed"], J["unchanged"], J["inconclusive"])
    else:
        head += "no journey can be shown to have improved or regressed (%d unchanged, %d inconclusive of %d)" % (J["unchanged"], J["inconclusive"], nj)
    head += " because the runs differ in %s" % diff_s if differing else ""
    if fates:
        fc = collections.Counter(f["fate"] for f in fates)
        head += "; the %d prior FAIL assertions are %s demonstrated fixes (%s)" % (
            len(fates), "not all" if any(f["fate"] == "now PASS (valid)" for f in fates) else "not",
            ", ".join("%d %s" % (v, k) for k, v in fc.items()))
    head += ", and %d PASS assertions were lost while %d rows gained a verdict%s" % (
        lost_pass, len(gained), (" (%d of them a valid improvement)" % len(gained_imp)) if gained_imp else ", none of which counts as an improvement")
    return head + "."


def make_validity(P, Cn, prev, cur, factors, journeys):
    problems = []
    if not prev["binding_ok"]:
        problems.append("the %s binding manifest is missing or failed its checks" % P["label"])
    if not cur["binding_ok"]:
        problems.append("the %s binding manifest is missing or failed its checks" % Cn["label"])
    others = [f for f in factors if f["status"] == "differs" and f["id"] not in ("release", "window")]
    unknown = [f for f in factors if f["status"] == "unknown"]
    nv = sum(1 for j in journeys if j["validity"] == "valid")
    nn = len(journeys) - nv
    if problems:
        verdict = "Not valid."
    elif others:
        verdict = "Not a controlled comparison."
    elif unknown:
        verdict = "Controlled for the recorded factors only."
    else:
        verdict = "Valid like-for-like comparison."
    st = "%d of %d journeys can be compared like for like and %d cannot. " % (nv, len(journeys), nn)
    if problems:
        st += "Problems: " + "; ".join(problems) + ". "
    if others:
        st += "Besides the release under test, the runs differ in %s; so a changed verdict cannot be attributed to the release alone. " % ", ".join(f["label"] for f in others)
    if unknown:
        st += "Not recorded for both runs: %s. " % ", ".join(f["label"] for f in unknown)
    st += "Each journey below states whether it is valid or why it is not comparable."
    return {"verdict": verdict, "statement": st, "factors": factors, "journeys_comparable": nv, "journeys_not_comparable": nn, "problems": problems}


# ---------------------------------------------------------------------------------------------------------------------
# receipt copy
# ---------------------------------------------------------------------------------------------------------------------
def _write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "wb" if isinstance(data, bytes) else "w"
    with open(path, mode) as f:
        f.write(data)


def copy_run_receipts(run, out, role):
    """Copy a run's original case receipts and binding files into out/receipts/<role>-<label>/. Returns the index."""
    base = os.path.join(out, "receipts", "%s-%s" % (role, run["label"]))
    idx = []
    camp_files = []

    def reg(path, kind, src_sha=None, run_label=None, extra=None):
        rel = os.path.relpath(path, out).replace(os.sep, "/")
        e = {"path": rel, "sha256": C.sha256_file(path), "bytes": os.path.getsize(path), "kind": kind, "run": run_label or run["label"], "role": role}
        if src_sha:
            e["source_sha256"] = src_sha
        if extra:
            e.update(extra)
        idx.append(e)
        return e

    for name, src in sorted(run["files"].items()):
        dst = os.path.join(base, "campaign", name)
        _write(dst, open(src, "rb").read())
        camp_files.append(reg(dst, "campaign-file", C.sha256_file(src)))
    for k, src in enumerate(run.get("extra_binding", [])):
        dst = os.path.join(base, "campaign", "binding", os.path.basename(src))
        _write(dst, open(src, "rb").read())
        camp_files.append(reg(dst, "binding-extra", C.sha256_file(src)))
    for cid, c in sorted(run["cases"].items()):
        cd = c["dir"]
        if not cd:
            continue
        cbase = os.path.join(base, "cases", cid)
        src_hashes = {}
        # original case-result and evidence files
        names = set(os.listdir(cd))
        dirs = [run["base"]]
        wanted = []
        for n in sorted(names):
            if n in ("sandbox.json", "summary.json", "guard.jsonl", "tls") or os.path.isdir(os.path.join(cd, n)):
                src_hashes[n] = C.sha256_file(os.path.join(cd, n)) if os.path.isfile(os.path.join(cd, n)) else None
                continue
            wanted.append((n, os.path.join(cd, n), False))
        for ref in sorted(c["receipt"].get("digest_ok", {})):
            if ref not in names:
                p, supp = C.find_file(dirs + [os.path.abspath(d) for d in run.get("supplement_dirs", [])], cid, ref)
                if p:
                    wanted.append((ref, p, True))
        for n, src, supp in wanted:
            if not SAFE_NAME.match(n):
                continue
            dst = os.path.join(cbase, n)
            _write(dst, open(src, "rb").read())
            src_hashes[n] = C.sha256_file(src)
            reg(dst, "case-receipt", src_hashes[n], extra={"case": cid, "supplemented": supp})
        sp = os.path.join(cd, "summary.json")
        if os.path.isfile(sp):
            s = C.read_json(sp)
            (s.get("guard") or {}).pop("port", None)
            (s.get("guard") or {}).pop("spki", None)
            dst = os.path.join(cbase, "summary.sanitized.json")
            _write(dst, json.dumps(s, indent=2) + "\n")
            reg(dst, "case-summary-sanitized", C.sha256_file(sp), extra={"case": cid})
        if c.get("guard"):
            g = dict(c["guard"])
            dst = os.path.join(cbase, "guard-derived-counts.json")
            _write(dst, json.dumps({"schema": "speaksharp.run-report.guard-derived-counts.v1", "case": cid, "contentSafe": True,
                                    "note": "Counts only, derived from the case guard.jsonl (not copied). No paths, hosts, bodies or headers.", **g}, indent=2) + "\n")
            reg(dst, "guard-derived-counts", g.get("source_sha256"), extra={"case": cid})
        dst = os.path.join(cbase, "SOURCE-HASHES.json")
        _write(dst, json.dumps({"case": cid, "note": "sha256 of every source file in the run directory; sandbox.json, tls/ and guard.jsonl are not copied; summary.json is copied sanitized (local proxy port and key pin dropped)", "files": src_hashes}, indent=2, sort_keys=True) + "\n")
        reg(dst, "source-hashes", extra={"case": cid})
    return idx, camp_files


# ---------------------------------------------------------------------------------------------------------------------
# derived blocks
# ---------------------------------------------------------------------------------------------------------------------
def cleanup_block(prev, cur):
    rows = []
    for cid in sorted(set(prev["cases"]) | set(cur["cases"])):
        def one(run):
            c = run["cases"].get(cid)
            if not c or not c["summary"]:
                return None
            s = c["summary"]
            return {"exitCode": s.get("exitCode"), "reason": s.get("reason"), "owned_left": len(s.get("ownedProcessesRemaining") or []) if s.get("ownedProcessesRemaining") is not None else "unknown",
                    "endedAt": s.get("endedAt")}
        rows.append({"case": cid, "previous": one(prev), "current": one(cur)})

    def summ(run):
        cs = [c["summary"] for c in run["cases"].values() if c["summary"]]
        nz = [(c["id"], c["summary"].get("exitCode"), c["summary"].get("reason")) for c in run["cases"].values() if c["summary"] and c["summary"].get("exitCode") != 0]
        left = sum(len(s.get("ownedProcessesRemaining") or []) for s in cs)
        return "%s: %d journeys ended, %d with exit code 0%s, %d owned processes remaining in total, last journey ended %s, final identity read %s." % (
            run["label"], len(cs), len(cs) - len(nz), ("; non-zero: " + ", ".join("%s exit %s (%s)" % x for x in nz)) if nz else "", left, run["last_case_ended_at"] or "unknown", run["identity_reads"]["final"] or "unknown")
    return {"statement": summ(prev) + " " + summ(cur), "rows": rows,
            "last_cleanup": {prev["label"]: prev["last_case_ended_at"], cur["label"]: cur["last_case_ended_at"]}}


def budget_block(prev, cur):
    rows = [{"case": cid, "previous": (prev["cases"].get(cid) or {}).get("budget"), "current": (cur["cases"].get(cid) or {}).get("budget")}
            for cid in sorted(set(prev["cases"]) | set(cur["cases"]))]

    def tot(run, key):
        vals = [c["budget"][key] for c in run["cases"].values() if c["budget"].get(key) is not None]
        return sum(vals) if vals else None

    def led(run):
        l = run.get("campaign_ledger") or {}
        return (l.get("used") or {}).get("total")
    totals = []
    for label, key in (("Requests used (sum of journeys)", "requests_used"), ("Requests planned (sum of per-case plan)", "planned"), ("Per-case request allowance (sum)", "allowance"),
                       ("Start presses used", "start_presses"), ("Take attempts used", "take_attempts")):
        a, b = tot(prev, key), tot(cur, key)
        totals.append({"label": label, "previous": a if a is not None else "n/a (not in this run's data)", "current": b if b is not None else "n/a (not in this run's data)"})
    totals.append({"label": "Campaign request ledger total", "previous": led(prev) if led(prev) is not None else "n/a", "current": led(cur) if led(cur) is not None else "n/a"})
    totals.append({"label": "Identity reads used / cap (this run)", "previous": "%s / %s" % (prev["identity_reads"]["gets_used"], prev["identity_reads"]["cap"]), "current": "%s / %s" % (cur["identity_reads"]["gets_used"], cur["identity_reads"]["cap"])})
    totals.append({"label": "Cost ceiling (USD)", "previous": prev["identity"]["costCeilingUsd"], "current": cur["identity"]["costCeilingUsd"]})
    exh = lambda run: ", ".join(c["id"] for c in run["cases"].values() if c["budget"]["allowance_exhausted"]) or "none"
    totals.append({"label": "Journeys that exhausted their allowance", "previous": exh(prev), "current": exh(cur)})
    return {"statement": "Requests are counted by the guard (forwarded requests). A planned figure and a per-case allowance exist only where the run's plan records them; 'n/a' means the run has no such number, not zero.", "rows": rows, "totals": totals}


def signals_block(prev, cur):
    def coaching(run):
        st = collections.Counter()
        for c in run["cases"].values():
            for s in (c.get("guard") or {}).get("coaching_statuses") or []:
                st[str(s) if s else "cancelled/aborted"] += 1
        j5 = [c["id"] for c in run["cases"].values() if any((s or 0) >= 500 for s in (c.get("guard") or {}).get("coaching_statuses") or [])]
        return "%s%s" % (", ".join("%d x %s" % (v, k) for k, v in sorted(st.items())) or "none", ("; HTTP 5xx in %s" % ", ".join(j5)) if j5 else "")
    def model(run):
        return str(sum((c.get("guard") or {}).get("model_requests", 0) for c in run["cases"].values()))
    def media(run):
        return "%d of %d journeys" % (sum(1 for c in run["cases"].values() if (c.get("guard") or {}).get("media_records")), len(run["cases"]))
    def denied(run):
        t = collections.Counter()
        for c in run["cases"].values():
            for k, v in ((c["summary"].get("denied") or {}).items()):
                t[k] += v
        return ", ".join("%s %d" % (k, v) for k, v in sorted(t.items())) or "none"
    return [{"label": "Coaching requests (status of each, from the guard log)", "previous": coaching(prev), "current": coaching(cur)},
            {"label": "Private-model download requests (all journeys)", "previous": model(prev), "current": model(cur)},
            {"label": "Journeys whose guard log records a media (capture) file", "previous": media(prev), "current": media(cur)},
            {"label": "Requests denied by the guard (by reason)", "previous": denied(prev), "current": denied(cur)}]


def identity_block(run, facts, role, index_by_path):
    f = []
    i = run["identity"]
    ir = run["identity_reads"]
    f.append(("Campaign id", i["campaignId"]))
    f.append(("Source SHA", i["sourceSha"]))
    f.append(("Served SHA", "%s (verified by Cloud: %d counted identity reads, %s; final read %s; marker body sha256 %s)" % (
        i["servedSha"], ir["count"], "all MATCH" if ir["all_match"] else "NOT all MATCH", ir["final"], ", ".join(C.short(x, 12) for x in ir["body_sha256"]))))
    f.append(("Runner code manifest sha256 (reviewed code)", "%s" % (i["codeManifestSha256"] or "not recorded")))
    f.append(("Harness step manifest sha256", i["stepManifestSha256"] or "not recorded"))
    f.append(("Admission config sha256", i["admissionConfigSha256"] or "not recorded"))
    f.append(("Plan sha256 (packet manifest)", i["planSha256"] or "not recorded"))
    f.append(("Policy sha256", i["policySha256"] or "not recorded"))
    f.append(("Runtime label", i["runtime"] or "not recorded"))
    adm = run.get("admission") or {}
    for s in adm.get("steps") or []:
        d = s.get("detail") or {}
        if s.get("id") == "A3.tools":
            f.append(("Tooling", "node %s, pnpm %s, playwright %s, %s" % (d.get("node"), d.get("pnpm"), d.get("playwright"), d.get("chromiumRevision"))))
        if s.get("id") == "A2.source":
            f.append(("Source tree at admission", "head %s, tree %s, clean=%s, lock sha256 %s" % (C.short(d.get("head"), 12), C.short(d.get("tree"), 12), d.get("clean"), C.short(d.get("lockSha256"), 12))))
        if s.get("id") == "A4.credentials":
            f.append(("Account kind (names only; no values)", "%s" % d.get("selectedAccountKind")))
    f.append(("Approved window", "%s to %s" % tuple(i["approvedWindow"])))
    f.append(("Admission", "%s (%s to %s)" % (i["admissionResult"], i["admissionStartedAt"], i["admissionEndedAt"])))
    bk = ((facts or {}).get("backend") or {}).get(role) or {}
    f.append(("Backend identity", "%s [%s]%s" % (bk.get("identity") or "not recorded in the run data", bk.get("verification") or "not recorded", (" - " + bk["note"]) if bk.get("note") else "")))
    media = collections.Counter(c["plan"]["mediaSha256"] or "none bound" for c in run["cases"].values())
    f.append(("Media files bound (sha256 : journeys)", "; ".join("%s : %d" % (C.short(k, 12) if k != "none bound" else k, v) for k, v in media.items())))
    pc = []
    for cid, c in sorted(run["cases"].items()):
        cr = "receipts/%s-%s/cases/%s/case-result.json" % (role, run["label"], cid)
        pc.append({"case": cid, "driver": c["plan"]["driverSha256"] or "", "config": c["plan"]["configSha256"] or "", "media": c["plan"]["mediaSha256"],
                   "guard_media": "%s%s" % ((c.get("guard") or {}).get("media_records", "n/a"), (" (sha matches plan)" if c["plan"]["mediaSha256"] and c.get("guard") and c["guard"]["media_sha256"] == [c["plan"]["mediaSha256"]] else "")),
                   "case_result_path": cr, "case_result_sha": c.get("case_result_sha256") or ""})
    return {"facts": f, "checks": run["binding"]["checks"], "per_case": pc}


def requirement_rows(areas, prev, cur):
    amap = {}
    for a in areas:
        for r in a["rows"]:
            amap[r["id"]] = r
    out = []
    creq = {r["id"]: r for r in cur["requirements"]}
    preq = {r["id"]: r for r in prev["requirements"]}
    for rid in [r["id"] for r in cur["requirements"]]:
        a = amap[rid]
        c = creq[rid]
        out.append({"id": rid, "title": c["title"], "category": c["category"], "prev": a["prev"], "cur": a["cur"], "class": a["class"],
                    "basis": c["basis"] if rid in cur["cases"] else "no assertion is mapped to this row in either run; NOT RUN in both"})
    return out


# ---------------------------------------------------------------------------------------------------------------------
# CSV
# ---------------------------------------------------------------------------------------------------------------------
def write_csv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Offline prior-vs-current report for SpeakSharp cloud-test runs", formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--current", required=True)
    ap.add_argument("--previous", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--current-label", default="current")
    ap.add_argument("--previous-label", default="previous")
    ap.add_argument("--facts")
    ap.add_argument("--overlay")
    ap.add_argument("--traceability-dir")
    ap.add_argument("--current-code-manifest")
    ap.add_argument("--previous-code-manifest")
    ap.add_argument("--current-supplement", action="append", default=[])
    ap.add_argument("--previous-supplement", action="append", default=[])
    ap.add_argument("--current-extra", action="append", default=[])
    ap.add_argument("--previous-extra", action="append", default=[])
    ap.add_argument("--expect", default="151,15,204", help="requirement rows, journeys, assertions")
    ap.add_argument("--generated-at")
    ap.add_argument("--title")
    args = ap.parse_args(argv)
    if os.path.exists(args.out):
        die("output directory already exists: %s" % args.out)
    try:
        er, ej, ea = [int(x) for x in args.expect.split(",")]
    except Exception:
        die("--expect must be three integers: requirements,journeys,assertions")
    expect = {"requirements": er, "journeys": ej, "assertions": ea}
    facts = C.read_json(args.facts) if args.facts else {}
    overlay = C.read_json(args.overlay) if args.overlay else {}
    trace = load_traceability(args.traceability_dir)
    try:
        prev = C.load_run(args.previous, args.previous_label, supplements=args.previous_supplement, code_manifest=args.previous_code_manifest, extra_binding=args.previous_extra, expect=expect)
        cur = C.load_run(args.current, args.current_label, supplements=args.current_supplement, code_manifest=args.current_code_manifest, extra_binding=args.current_extra, expect=expect)
    except C.ReportError as e:
        die(str(e))
    prev["supplement_dirs"], cur["supplement_dirs"] = list(args.previous_supplement), list(args.current_supplement)
    if set(prev["cases"]) != set(cur["cases"]):
        die("the two runs do not have the same journeys: %s vs %s" % (sorted(prev["cases"]), sorted(cur["cases"])))
    if {r["id"] for r in prev["requirements"]} != {r["id"] for r in cur["requirements"]}:
        die("the two runs do not have the same requirement rows")
    generated = args.generated_at or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    cmp_ = C.compare_runs(prev, cur, facts, overlay, None, trace)
    journeys, rows, changes, areas = cmp_["journeys"], cmp_["rows"], cmp_["changes"], cmp_["areas"]
    jb = {j["id"]: j for j in journeys}
    for j in journeys:
        j["why"] = journey_why(j, changes, prev, cur)
    for a in areas:
        a["why"] = area_why(a, jb)
    K = {"journeys": {c: sum(1 for j in journeys if j["class"] == c) for c in C.CLASSES}, "areas": {c: sum(1 for a in areas if a["class"] == c) for c in C.CLASSES}}
    factors = C.build_factors(prev, cur, cmp_, facts)
    fates = C.prior_fail_fates(cmp_)
    P = dict(prev["identity"], label=prev["label"])
    Cn = dict(cur["identity"], label=cur["label"])
    headline = make_headline(P, Cn, K, fates, changes, factors)
    validity = make_validity(P, Cn, prev, cur, factors, journeys)

    # breakdown
    bp = C.outcome_breakdown(prev, rows, "previous")
    bc = C.outcome_breakdown(cur, rows, "current")
    order = list(C.CANONICAL_BUCKETS) + sorted(k for k in set(bc) | set(bp) if k not in C.CANONICAL_BUCKETS)
    breakdown = {"order": order, "previous": {k: len(bp.get(k, [])) for k in order}, "current": {k: len(bc.get(k, [])) for k in order},
                 "members": {"previous": bp, "current": bc}}

    # requirement rows / coverage note
    req_rows = requirement_rows(areas, prev, cur)
    nver = sum(1 for r in req_rows if r["prev"] in C.PF or r["cur"] in C.PF)
    coverage_note = ("Requirement-level coverage is thin. Only %d of %d requirement rows have a verdict in either run (the AHT journey rows, whose verdict is their journey's verdict); "
                     "the other %d rows are NOT RUN in both runs and say nothing about those requirements. Area classes are therefore mostly inconclusive or unchanged, and an "
                     "area with no verdict row is shown as inconclusive (no signal), not as a pass." % (nver, len(req_rows), len(req_rows) - nver))
    area_note = ("How journeys map to areas: each requirement row carries its product area (categoryId in each run's case-results.json) and an AHT-NN row takes the verdict of its journey, so a "
                 "journey's primary area is the area of its own requirement row and only primary journeys are scored. 'Related' journeys come from the live-consumer crosswalk "
                 "(%s) and are shown but never scored: a related journey does not close the original requirement."
                 % (", ".join(x["file"] for x in (trace or {}).get("files", [])) or "not supplied for this build"))
    lost = [r for r in changes if r["kind"] == "lost"]
    gained = [r for r in changes if r["kind"] == "gained"]
    chg_note = ("Lost = a PASS or FAIL became NOT RUN (%d PASS, %d FAIL); gained = a NOT RUN became PASS/FAIL or a FAIL became PASS (%d); changed = other transitions (%d). "
                "Reason codes: product, harness, setup-blocked, evidence-reader-unavailable, omitted-by-design, allowance-interrupted, observer-changed (plus case-incomplete and unexplained). "
                "The last column of each row lists the conditions that make the row not comparable." % (
                    sum(1 for r in lost if r["prev"] == "PASS"), sum(1 for r in lost if r["prev"] == "FAIL"), len(gained), len(changes) - len(lost) - len(gained)))

    # denominators
    def tally(run, key):
        t = run["tallies"][key]
        return {"PASS": t.get("PASS", 0), "FAIL": t.get("FAIL", 0), "NOT RUN": t.get("NOT RUN", 0)}
    den = {"requirements": {"total": len(req_rows), "previous": tally(prev, "requirements"), "current": tally(cur, "requirements")},
           "journeys": {"total": len(journeys), "previous": tally(prev, "journeys"), "current": tally(cur, "journeys")},
           "assertions": {"total": len(rows), "previous": tally(prev, "assertions"), "current": tally(cur, "assertions")}}

    # output tree
    os.makedirs(args.out)
    idx_p, camp_p = copy_run_receipts(prev, args.out, "previous")
    idx_c, camp_c = copy_run_receipts(cur, args.out, "current")
    area_map = {"schema": "speaksharp.run-report.area-mapping.v1", "category_names": (trace or {}).get("category_names", {}), "related_journeys": (trace or {}).get("related_journeys", {}),
                "source_files": (trace or {}).get("files", []), "note": area_note}
    _write(os.path.join(args.out, "receipts", "area-mapping.json"), json.dumps(area_map, indent=2, sort_keys=True) + "\n")
    other_idx = [{"path": "receipts/area-mapping.json", "sha256": C.sha256_file(os.path.join(args.out, "receipts", "area-mapping.json")), "kind": "area-mapping", "role": "derived"}]
    index = idx_p + idx_c + other_idx
    idx_by_path = {e["path"]: e for e in index}

    problems = ["%s: %s" % (prev["label"], x) for x in C.receipts_index_problems(prev)] + ["%s: %s" % (cur["label"], x) for x in C.receipts_index_problems(cur)] + \
               ["%s: %s" % (r["label"], p) for r in (prev, cur) for p in r["problems"]]
    supplemented = sorted("%s %s/%s" % (r["label"], cid, f) for r in (prev, cur) for cid, c in r["cases"].items() for f in c["receipt"].get("supplemented", []))

    data = {
        "schema": "speaksharp.run-comparison.v1", "generator": {"name": "build_run_report.py", "version": VERSION}, "generated_utc": generated,
        "previous": P, "current": Cn,
        "headline": headline, "validity": validity, "classes": K, "denominators": den,
        "areas": areas, "journeys": journeys, "changes": changes, "rows": rows, "requirement_rows": req_rows, "prior_fail_fates": fates,
        "breakdown": breakdown, "signals": signals_block(prev, cur), "cleanup": cleanup_block(prev, cur), "budget": budget_block(prev, cur),
        "identity_binding": {"note": "Every run is bound to its release, runner code, harness packet, media and backend identity. Hashes come from the original plan, approval and admission receipts copied into this bundle; backend identity is shown with its verification status.",
                             "previous": identity_block(prev, facts, "previous", idx_by_path), "current": identity_block(cur, facts, "current", idx_by_path)},
        "rules_text": C.RULE_TEXT, "rules_active": "; ".join("%s=%s" % (k, v) for k, v in cmp_["rules"].items()),
        "policy_constants": {"stimulus-not-established keys (false means the stimulus never happened)": ", ".join(C.STIMULUS_FALSE_KEYS), "control / bookkeeping assertion ids": ", ".join(C.CONTROL_IDS),
                             "coaching guard rule ids": ", ".join(C.COACHING_RULE_IDS), "evidence keys ignored in schema comparison": ", ".join(C.SCHEMA_IGNORED_KEYS),
                             "expected denominators (requirements, journeys, assertions)": "%d, %d, %d" % (er, ej, ea)},
        "coverage_note": coverage_note, "area_mapping_note": area_note, "changes_note": chg_note,
        "requirement_note": "Requirement rows are listed in the run's ledger order. %s" % coverage_note,
        "receipts": {"note": "These are the original receipts of both runs: the campaign case-results.json, the plan, approval and admission receipts, the ledgers, and each journey's case-result.json and evidence files, byte for byte; summary.json is sanitized (local proxy port and key pin dropped) with the original hash recorded.",
                     "campaign_files": camp_p + camp_c, "problems": problems, "supplemented": supplemented,
                     "supplemented_note": "%d evidence file(s) referenced by the original case-result.json were absent from the primary prior-run directory and were taken from the supplement run root; each was verified against the digest recorded in the original case-result.json: %s" % (len(supplemented), ", ".join(supplemented))},
        "analysis_inputs": {"facts_sha256": C.sha256_file(args.facts) if args.facts else None, "overlay_sha256": C.sha256_file(args.overlay) if args.overlay else None,
                            "overlay_row_classifications": len(overlay.get("rowClassifications") or []), "overlay_observer_changes": len(overlay.get("observerChanges") or []),
                            "facts_observer_attestations": len(facts.get("observerAttestations") or []), "traceability": (trace or {}).get("files", [])},
        "limits": [coverage_note,
                   "Backend and deployment state are owner-stated unless a verification label says otherwise; the frontend release is verified by counted identity reads only.",
                   "FAIL classification (product, harness, disputed oracle) comes from the analyst overlay, not from the machine receipts; without it a FAIL is shown as unclassified.",
                   "Evidence schema and driver hashes can show that an observer changed; they cannot prove two observers identical, so a changed verdict under a differing harness packet is inconclusive unless attested."],
    }
    # machine-readable outputs
    jfields = ["id", "title", "primary_area", "prev", "cur", "class", "validity"]
    write_csv(os.path.join(args.out, "journeys.csv"),
              ["journey", "title", "primary_area", "related_areas", "prev_result", "cur_result", "prev_pass", "prev_fail", "prev_not_run", "cur_pass", "cur_fail", "cur_not_run", "class", "validity", "unresolved", "changed_rows", "lost_rows", "gained_rows", "conditions", "why"],
              [[j["id"], j["title"], j["primary_area"], ";".join(j["related_areas"]), j["prev"], j["cur"], j["prev_counts"]["PASS"], j["prev_counts"]["FAIL"], j["prev_counts"]["NOT RUN"],
                j["cur_counts"]["PASS"], j["cur_counts"]["FAIL"], j["cur_counts"]["NOT RUN"], j["class"], j["validity"], j["unresolved"], j["n_changed"], j["n_lost"], j["n_gained"],
                ";".join(sorted({g["code"] for g in j["reasons"]})), j["why"]] for j in journeys])
    write_csv(os.path.join(args.out, "assertions.csv"),
              ["journey", "assertion", "prev_verdict", "cur_verdict", "change", "class", "control_row", "prev_cause", "cur_cause", "reason_code", "reason_text", "conditions", "prev_evidence", "cur_evidence", "disputed_oracle"],
              [[r["case"], r["id"], r["prev"], r["cur"], r["kind"], r["class"], r["control"], (r["prev_cause"] or {}).get("code", ""), (r["cur_cause"] or {}).get("code", ""), r["reason_code"] or "", r["reason_text"] or "",
                ";".join(g["code"] for g in r["reasons"]), ";".join(r["prev_refs"]), ";".join(r["cur_refs"]), r["disputed"]] for r in rows])
    write_csv(os.path.join(args.out, "changes.csv"),
              ["journey", "assertion", "prev_verdict", "cur_verdict", "change", "class", "reason_code", "reason_text", "conditions", "prev_evidence", "cur_evidence"],
              [[r["case"], r["id"], r["prev"], r["cur"], r["kind"], r["class"], r["reason_code"], r["reason_text"], "; ".join("%s: %s" % (g["code"], g["text"]) for g in r["reasons"]), ";".join(r["prev_refs"]), ";".join(r["cur_refs"])] for r in changes])
    write_csv(os.path.join(args.out, "requirements.csv"), ["requirement", "title", "area", "prev_verdict", "cur_verdict", "class", "basis"],
              [[r["id"], r["title"], r["category"], r["prev"], r["cur"], r["class"], r["basis"]] for r in req_rows])
    # comparison.json (rows kept compact)
    cj = dict(data)
    cj["rows"] = [{k: v for k, v in r.items() if k not in ("observer",)} | {"observer_signals": r["observer"]["changed_signals"]} for r in rows]
    cj["changes"] = [{k: v for k, v in r.items() if k not in ("observer",)} | {"observer_signals": r["observer"]["changed_signals"]} for r in changes]
    cj["reasons_note"] = "reasons are [code, text] pairs; class values: improved, regressed, unchanged, inconclusive (not comparable), plus no-signal for NOT RUN in both runs"
    _write(os.path.join(args.out, "comparison.json"), json.dumps(cj, indent=1, sort_keys=False, default=list) + "\n")

    outputs = []
    for n in ("comparison.json", "journeys.csv", "assertions.csv", "changes.csv", "requirements.csv"):
        p = os.path.join(args.out, n)
        outputs.append({"path": n, "sha256": C.sha256_file(p), "kind": "output"})
    links = R.Links(index + outputs)
    data["receipts"]["outputs"] = outputs
    title = args.title or "SpeakSharp %s vs %s" % (cur["label"], prev["label"])
    page = R.render_html(data, links, title, generated)
    _write(os.path.join(args.out, "REPORT.html"), page)

    # manifest (sha256 of every other file)
    files = []
    for dp, _, fs in os.walk(args.out):
        for f in sorted(fs):
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, args.out).replace(os.sep, "/")
            if rel == "MANIFEST.json":
                continue
            files.append({"path": rel, "sha256": C.sha256_file(p), "bytes": os.path.getsize(p)})
    files.sort(key=lambda x: x["path"])
    man = {"schema": "speaksharp.run-report.manifest.v1", "generated_utc": generated, "generator": {"name": "build_run_report.py", "version": VERSION},
           "previous": {"label": prev["label"], "campaignId": prev["campaignId"], "servedSha": prev["servedSha"], "case_results_sha256": prev["campaign_results_sha256"]},
           "current": {"label": cur["label"], "campaignId": cur["campaignId"], "servedSha": cur["servedSha"], "case_results_sha256": cur["campaign_results_sha256"]},
           "self_hash_note": "MANIFEST.json lists every other file in this directory with its sha256; it cannot contain its own hash.", "files": files}
    _write(os.path.join(args.out, "MANIFEST.json"), json.dumps(man, indent=1) + "\n")
    print(json.dumps({"out": args.out, "headline": headline, "classes": K, "changes": len(changes), "files": len(files) + 1, "receipt_problems": problems}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
