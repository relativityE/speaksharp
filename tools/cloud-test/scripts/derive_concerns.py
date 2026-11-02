#!/usr/bin/env python3
"""Observations of the remaining #1488 / #1757 concerns, derived from the evidence the approved harness ALREADY records for the latest run: guard logs, step logs, case
results and receipts. No new traffic, stimulus or campaign; offline; reads files only. Each concern has sub-observations, each reported as
  OBSERVED CLEAN | OBSERVED PROBLEM | NOT OBSERVABLE
with the journey(s), UTC time(s), SANITIZED evidence (file, sha256, event sequence numbers, counts; never matched text) and reproduction steps (config/concerns.json).
A concern's verdict is PROBLEM if any sub-observation is a problem, else NOT OBSERVABLE if any could not be observed, else CLEAN. Missing visibility is NOT proof of safety
and is NOT a product failure: it is reported as such and does not by itself block a verdict. Informational notes are shown and never counted.
Usage: derive_concerns.py --config C.json --receipts-root DIR --latest-label LABEL --request R.json [--coverage coverage.json] [--scan-dir DIR ...] --out concerns.json
       derive_concerns.py --scan-dir DIR --out scan.json      (retention scan of generated outputs only)"""
import argparse
import datetime
import fnmatch
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, sha256_file  # noqa: E402

CLEAN, PROBLEM, NOTOBS, NOTE = "OBSERVED CLEAN", "OBSERVED PROBLEM", "NOT OBSERVABLE", "NOTE"


def jl(path):
    out = []
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8", errors="ignore"):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    return out


def rel(path, root):
    return os.path.relpath(path, root).replace(os.sep, "/")


def sub(name, verdict, cases, times, evidence, detail, primary=True):
    return {"name": name, "verdict": verdict, "journeys": sorted(set(cases)), "observedUtc": [t for t in times if t][:2], "evidence": evidence[:8], "detail": detail, "counts": verdict != NOTE and primary}


def evid(base, root, case, fname, seqs=None, **kw):
    p = os.path.join(base, case, fname)
    e = {"file": rel(p, root), "sha256": sha256_file(p) if os.path.isfile(p) else None}
    if seqs:
        e["eventSeq"] = list(seqs)[:6]
    e.update(kw)
    return e


def case_dirs(base):
    return sorted(d for d in os.listdir(base) if d.startswith("AHT-") and os.path.isdir(os.path.join(base, d)))


# ---------------------------------------------------------------- retention scan
def load_sentinels(ccfg):
    s = ccfg["sentinels"]
    out = set(x for x in s.get("extra", []) if len(x) >= s["minLength"])
    p = os.path.join(ROOT, s["fixtureManifest"])
    if os.path.isfile(p):
        for fx in load(p).get("fixtures", {}).values():
            for f in s["fixtureFields"]:
                v = fx.get(f)
                for t in ([v] if isinstance(v, str) else (v or [])):
                    if isinstance(t, str) and len(t) >= s["minLength"]:
                        out.add(t)
    return sorted(out)


def scan_text(text, sentinels, patterns, fields, minlen):
    """Returns {pattern id: count}. The matched text is never returned."""
    found = {}
    low = text.lower()
    for i, s in enumerate(sentinels):
        n = low.count(s.lower())
        if n:
            found["sentinel#%d" % (i + 1)] = n
    for pid, rx in patterns.items():
        n = len(rx.findall(text))
        if n:
            found[pid] = n
    for name in fields:
        n = len(re.findall(r'"%s"\s*:\s*"[^"\\]{%d,}' % (re.escape(name), minlen), text))
        if n:
            found["text-field:" + name] = n
    return found


def retention_scan(ccfg, dirs, skip_dirs=("receipts",)):
    sentinels = load_sentinels(ccfg)
    patterns = {k: re.compile(v) for k, v in ccfg["secretPatterns"].items()}
    findings, files, size = [], 0, 0
    for root_dir in dirs:
        for r, ds, fs in os.walk(root_dir):
            ds[:] = [d for d in ds if d not in skip_dirs]
            for fn in sorted(fs):
                p = os.path.join(r, fn)
                try:
                    n = os.path.getsize(p)
                    if n > ccfg["maxScanBytes"]:
                        continue
                    text = open(p, encoding="utf-8", errors="ignore").read()
                except OSError:
                    continue
                files += 1
                size += n
                for pid, cnt in scan_text(text, sentinels, patterns, ccfg["textFieldNames"], ccfg["textFieldMinLength"]).items():
                    findings.append({"file": rel(p, root_dir), "sha256": sha256_file(p), "pattern": pid, "count": cnt})
    return {"filesScanned": files, "bytesScanned": size, "sentinelsKnown": len(sentinels), "patterns": sorted(patterns), "findings": findings}


# ---------------------------------------------------------------- the five concerns
def con1(req, results, base, root, window):
    from check_coverage import deployed_version_binding
    b = deployed_version_binding(req, results)
    ev = [{"file": rel(os.path.join(base, "case-results.json"), root), "sha256": sha256_file(os.path.join(base, "case-results.json")), "receiptsChecked": b["receiptsChecked"]}]
    if b["receiptsChecked"] == 0:
        return [sub("identity reads match the tested SHA", NOTOBS, ["all"], window, ev, "no identity receipt exists: the deployed version was never read")]
    if not b["ok"]:
        return [sub("identity reads match the tested SHA", PROBLEM, ["all"], window, ev, "%d problem(s); first: %s" % (b["problemCount"], b["problems"][0]))]
    return [sub("identity reads match the tested SHA", CLEAN, ["all"], window, ev, "%d identity receipts (before and after every journey) and the final read all MATCH tested SHA %s" % (b["receiptsChecked"], str(b["testedSha"])[:8]))]


def parse_step(path):
    done = stop = None
    remaining = exit_code = reason = None
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8", errors="ignore"):
            t, _, msg = line.strip().partition(" ")
            if msg.startswith("step completed") and done is None:
                done = t
            m = re.match(r"stop (\S+) exit (\d+) remaining (\d+)", msg)
            if m:
                stop, reason, exit_code, remaining = t, m.group(1), int(m.group(2)), int(m.group(3))
    return done, stop, exit_code, remaining, reason


def con2(base, root, cases):
    left, no_stop, started_after, inflight, in_cases, workers = [], [], [], 0, [], 0
    inflight_coaching = 0
    times = []
    ev_left, ev_after = [], []
    for c in cases:
        done, stop, ex, rem, why = parse_step(os.path.join(base, c, "step.log"))
        if stop is None:
            no_stop.append(c)
        elif rem != 0 or (ex != 0 and why != "allowance-exhausted"):          # exit 6 with reason allowance-exhausted is the harness's own controlled stop; what matters is 0 remaining
            left.append(c)
            ev_left.append(evid(base, root, c, "step.log", exit=ex, remaining=rem))
        if done is None:
            continue
        sc = parse_utc(done)
        times.append(done)
        for e in jl(os.path.join(base, c, "guard.jsonl")):
            if e.get("dest") in ("worker", "audioworklet") and e.get("kind") == "request":
                workers += 1
            if e.get("kind") != "request" or e.get("decision") != "forwarded":
                continue
            t = parse_utc(e.get("t"))
            if not t or t <= sc:
                continue
            start = t - datetime.timedelta(milliseconds=e.get("ms") or 0)
            if start > sc:
                started_after.append((c, e))
                ev_after.append(evid(base, root, c, "guard.jsonl", [e.get("seq")], host=e.get("host"), rule=e.get("rule"), startedAfterStepEndMs=int((start - sc).total_seconds() * 1000)))
            else:
                inflight += 1
                in_cases.append(c)
                if e.get("rule") == "fn-coaching":
                    inflight_coaching += 1
    out = []
    if not cases:
        return [sub("owned processes after termination", NOTOBS, [], [], [], "no journey directories")]
    if left:
        out.append(sub("owned processes after termination", PROBLEM, left, times, ev_left, "%d journey(s) ended with a non-zero exit or owned processes remaining" % len(left)))
    elif len(no_stop) == len(cases):
        out.append(sub("owned processes after termination", NOTOBS, no_stop, times, [], "no step log records the stop line"))
    else:
        out.append(sub("owned processes after termination", CLEAN, cases, times, [evid(base, root, cases[0], "step.log")], "every journey that recorded its stop line ended with 0 owned processes remaining and a normal exit or the harness's own allowance stop (%d of %d journeys recorded it)" % (len(cases) - len(no_stop), len(cases))))
    if started_after:
        out.append(sub("outbound requests started after termination", PROBLEM, [c for c, _ in started_after], times, ev_after, "%d forwarded request(s) started after their journey's step completed" % len(started_after)))
    else:
        out.append(sub("outbound requests started after termination", CLEAN, cases, times, [evid(base, root, cases[0], "guard.jsonl")], "no forwarded request started after a journey's step completed (start = log time minus duration)"))
    out.append(sub("requests in flight at termination", NOTE, in_cases, times, [], "%d forwarded request(s) were already in flight when their journey's step completed and finished within milliseconds%s; they were started before termination, not after" % (inflight, " (%d of them a coaching call)" % inflight_coaching if inflight_coaching else ""), primary=False))
    out.append(sub("service-worker and web-worker cleanup", NOTOBS, cases, times, [], "the guard sees %d worker or audioworklet script load(s) but not worker lifetimes; only browser-process exit (above) is visible, so worker-level cleanup cannot be observed from this harness" % workers))
    return out


def con3(base, root, cases, ccfg):
    forms, streams, tele, tele_by = [], 0, 0, {}
    times = []
    ev = []
    pats = ccfg["telemetryHostPatterns"]
    for c in cases:
        for e in jl(os.path.join(base, c, "guard.jsonl")):
            if e.get("kind") == "request" and e.get("nav") is True and (e.get("method") or "GET") not in ("GET", "HEAD"):
                forms.append((c, e)); times.append(e.get("t")); ev.append(evid(base, root, c, "guard.jsonl", [e.get("seq")], method=e.get("method"), host=e.get("host"), rule=e.get("rule")))
            if e.get("kind") == "request" and e.get("method") == "GET" and e.get("dest") == "empty" and (e.get("ms") or 0) >= 30000 and e.get("status") == 200:
                streams += 1
            if e.get("kind") == "connect" and any(fnmatch.fnmatch(str(e.get("host")), p) for p in pats):
                tele += 1
                tele_by.setdefault(e["host"], set()).add(c)
    out = []
    if forms:
        out.append(sub("native form submissions", PROBLEM, [c for c, _ in forms], times, ev, "%d navigation(s) with a non-GET method reached the network (a native form submission); the payload itself is not recorded" % len(forms)))
    else:
        out.append(sub("native form submissions", CLEAN, cases, [], [evid(base, root, cases[0], "guard.jsonl")] if cases else [], "no navigation with a method other than GET or HEAD was made in any journey"))
    out.append(sub("EventSource streams", NOTOBS, cases, [], [], "the guard log records neither Accept headers nor response content types, so EventSource streams cannot be told from other fetches (%d long-lived GET stream-like request(s) are only an indicator)" % streams))
    out.append(sub("telemetry traffic", NOTOBS, sorted({c for v in tele_by.values() for c in v}), [], [], "%d connection attempt(s) to telemetry hosts (%s) were refused by the guard policy before any TLS exchange, so telemetry payloads cannot be observed" % (tele, ", ".join("%s x%d journeys" % (h, len(v)) for h, v in sorted(tele_by.items())) or "none")))
    out.append(sub("unexpected payloads in forwarded requests", NOTOBS, cases, [], [], "request bodies and headers are not recorded (only fault-injection operations carry a body hash), so payload content cannot be inspected"))
    return out


def con4(ccfg, base, root, extra_dirs):
    scan = retention_scan(ccfg, [base] + list(extra_dirs))
    ev = [{"file": f["file"], "sha256": f["sha256"], "pattern": f["pattern"], "count": f["count"]} for f in scan["findings"]]
    cases = sorted({f["file"].split("/")[0] for f in scan["findings"] if f["file"].startswith("AHT-")})
    if scan["filesScanned"] == 0:
        return [sub("retained logs and receipts", NOTOBS, [], [], [], "no file was available to scan")], scan
    if scan["findings"]:
        return [sub("retained logs and receipts", PROBLEM, cases, [], ev, "%d finding(s) in %d file(s): sentinel text, secret pattern or transcript-like field retained (matched text is never reproduced)" % (len(scan["findings"]), len({f["file"] for f in scan["findings"]})))], scan
    return [sub("retained logs and receipts", CLEAN, ["all"], [], [], "%d file(s), %d bytes scanned for %d sentinel text(s), %d secret pattern(s) and transcript-like fields: no retention found. Limit: spoken-corpus text beyond the sentinel list is not known to the scan" % (scan["filesScanned"], scan["bytesScanned"], scan["sentinelsKnown"], len(scan["patterns"])))], scan


def con5(cfg, ccfg, root, latest, cases_now, base):
    order = [r["label"] for r in cfg["history"]["runs"] if not r.get("ledgersOnly")]
    prior = order[:order.index(latest)] if latest in order else []
    out = []
    # journeys
    if not prior:
        out.append(sub("normal journeys against the last known good run", NOTOBS, [], [], [], "there is no earlier run to compare the journeys with"))
        prev_label = None
    else:
        reg, rows = [], 0
        hist = {lab: {(c["caseId"], a["id"]): a["result"] for c in load(os.path.join(root, lab, "case-results.json"))["cases"] for a in c["assertions"]} for lab in prior}
        now = {(c["caseId"], a["id"]): a["result"] for c in load(os.path.join(base, "case-results.json"))["cases"] for a in c["assertions"]}
        for k, v in now.items():
            if v != "FAIL":
                continue
            last = next((hist[l][k] for l in reversed(prior) if hist[l].get(k) in ("PASS", "FAIL")), None)
            if last == "PASS":
                reg.append(k)
        prev_label = prior[-1]
        if reg:
            out.append(sub("normal journeys against the last known good run", PROBLEM, sorted({c for c, _ in reg}), [], [{"file": rel(os.path.join(base, "case-results.json"), root), "sha256": sha256_file(os.path.join(base, "case-results.json")), "rows": ["%s/%s" % k for k in reg[:6]]}],
                           "%d row(s) FAIL now and PASSed before. Whether a protection of #1488/#1757 caused it is NOT established by this observation" % len(reg)))
        else:
            out.append(sub("normal journeys against the last known good run", CLEAN, ["all"], [], [{"file": rel(os.path.join(base, "case-results.json"), root), "sha256": sha256_file(os.path.join(base, "case-results.json"))}], "no row that PASSed in an earlier run FAILs now (rows with no earlier verdict are not compared)"))
    # telemetry attempts now vs previous
    def tele_count(b):
        n = 0
        for c in case_dirs(b):
            for e in jl(os.path.join(b, c, "guard.jsonl")):
                if e.get("kind") == "connect" and any(fnmatch.fnmatch(str(e.get("host")), p) for p in ccfg["telemetryHostPatterns"]):
                    n += 1
        return n
    now_n = tele_count(base)
    prev_n = tele_count(os.path.join(root, prev_label)) if prev_label and os.path.isdir(os.path.join(root, prev_label, "AHT-01")) else None
    out.append(sub("legitimate telemetry", NOTOBS, ["all"], [], [], "the harness refuses telemetry hosts by policy, so delivery to the provider cannot be observed. Attempts seen: %d in %s%s; a change in attempts would show the product's own behaviour changed, not that delivery was disrupted" % (now_n, latest, (", %d in %s" % (prev_n, prev_label)) if prev_n is not None else "")))
    return out


def verdict_of(subs):
    c = [s for s in subs if s["counts"]]
    if any(s["verdict"] == PROBLEM for s in c):
        return PROBLEM
    if any(s["verdict"] == NOTOBS for s in c):
        return NOTOBS
    return CLEAN


def derive(cfg, ccfg, root, latest, req, extra_dirs=()):
    base = os.path.join(root, latest)
    results = load(os.path.join(base, "case-results.json"))
    led = load(os.path.join(base, "campaign-ledger.json"))
    window = [led.get("created"), led.get("updated")]
    cases = case_dirs(base)
    by_id = {c["id"]: c for c in ccfg["concerns"]}
    subs = {"CON-1": con1(req, results, base, root, window), "CON-2": con2(base, root, cases), "CON-3": con3(base, root, cases, ccfg)}
    s4, scan = con4(ccfg, base, root, extra_dirs)
    subs["CON-4"] = s4
    subs["CON-5"] = con5(cfg, ccfg, root, latest, cases, base)
    out = []
    for cid, ss in subs.items():
        c = by_id[cid]
        out.append({"id": cid, "title": c["title"], "sourceRefs": ccfg["sourceRefs"], "brief": c["brief"], "verdict": verdict_of(ss), "subObservations": ss, "runUtc": window, "reproduction": c["reproduction"]})
    counts = {}
    for c in out:
        counts[c["verdict"]] = counts.get(c["verdict"], 0) + 1
    return {"schema": "speaksharp.cloud-test.concerns.v1", "derived": True, "sourceRefs": ccfg["sourceRefs"], "runLabel": latest, "servedSha": results.get("servedSha"), "plan": "free / $0: no new traffic, stimulus or campaign",
            "rule": ccfg["note"], "concerns": out, "counts": counts, "retentionScan": {k: scan[k] for k in ("filesScanned", "bytesScanned", "sentinelsKnown", "patterns")}}


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    for k in ("latest-label", "request", "coverage"):
        a.add_argument("--" + k)
    a.add_argument("--scan-dir", action="append", default=[])
    a.add_argument("--out", required=True)
    x = a.parse_args()
    cfg = load(x.config)
    ccfg = load(os.path.join(ROOT, cfg["concerns"]["file"]))
    if not x.latest_label:
        scan = retention_scan(ccfg, x.scan_dir)
        dump({"schema": "speaksharp.cloud-test.retention-scan.v1", "scanned": x.scan_dir and [os.path.basename(d) for d in x.scan_dir], **scan}, x.out)
        print("retention scan: %d file(s), %d finding(s)" % (scan["filesScanned"], len(scan["findings"])))
        sys.exit(7 if scan["findings"] else 0)
    out = derive(cfg, ccfg, x.receipts_root, x.latest_label, load(x.request), x.scan_dir)
    dump(out, x.out)
    print("concerns for %s: %s" % (x.latest_label, ", ".join("%s %s" % (c["id"], c["verdict"]) for c in out["concerns"])))


if __name__ == "__main__":
    main()
