#!/usr/bin/env python3
"""Release verification from git and sealed receipts. Replaces hand-typed commit classification.

For the tested SHA it computes, with git: every commit since the last run and since the comparison baseline, each classified MECHANICALLY by the
paths it changes (config release.productPathPatterns minus release.testPathPatterns). A customer-facing change is ALLOWED when it is a verified
deployed fix: the commit is linked to a gap in the ledger (fix.commit, or fix.pr found as "(#N)" in a commit subject), is an ancestor of the
tested SHA, its deployment is verified (frontend served SHA from a sealed run's identity ledger equals the tested SHA; backend evidence when the
commit touches backend paths), and the gap has expected-PASS criteria. It is REJECTED when it is unlinked (unreviewed change), when its deployment
is unverified, or when it has no expected PASS. Product changes themselves are never a reason to reject.

A customer-facing change is ALSO allowed through the REVIEWED FEATURE route (config/feature-ledger.json), so routine feature releases are tested without inventing a bug:
feature -> expected behaviour -> test coverage. The commit must be linked to a feature (pr or commit) that has (1) an approved review by a named reviewer with a
reference, (2) a stated expected behaviour with criteria and a definition time, (3) test coverage: required rows that exist in the assertion catalog, or new rows
promised for a catalog version that exists, and (4) a verified deployment of the tested SHA (same evidence as a fix). A customer-facing change linked to neither a gap
nor a reviewed feature is still rejected (unreviewed change).

Usage: verify_release.py --request R.json --ledger L.json --config C.json [--features F.json] [--catalog CAT.json] [--repo DIR] [--receipts-root DIR] [--now ISO] --out release-verification.json
Offline: runs git against the local checkout only. Exit 0 always (the decision is in the file)."""
import argparse
import fnmatch
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load, dump, parse_utc, now_utc, is_sha40  # noqa: E402

BACKEND_PREFIXES = ("backend/supabase/functions/", "backend/supabase/migrations/", "backend/supabase/config.toml", "backend/supabase/import_map.json")


def glob_re(pat):
    out, i = "", 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out += "(?:.*/)?"; i += 3
        elif pat.startswith("**", i):
            out += ".*"; i += 2
        elif pat[i] == "*":
            out += "[^/]*"; i += 1
        elif pat[i] == "?":
            out += "[^/]"; i += 1
        else:
            out += re.escape(pat[i]); i += 1
    return re.compile("^" + out + "$")


def classify(paths, product, tests):
    P = [glob_re(p) for p in product]
    T = [glob_re(p) for p in tests]
    prod = [p for p in paths if any(r.match(p) for r in P) and not any(r.match(p) for r in T)]
    return prod, any(p.startswith(BACKEND_PREFIXES) for p in prod), any(p.startswith("frontend/") or p in ("vercel.json", "middleware.js") for p in prod)


def git(repo, *args):
    r = subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)
    return r.returncode, r.stdout.strip()


def backend_deployment(repo, backend, tested):
    """Verify the declared backend deployment without relabelling its SHA.

    Exact verification remains the normal route.  A source-equivalent route is
    accepted only for Edge Function paths, and only when git independently
    proves that the deployed and tested function trees equal the pinned tree.
    Migrations and backend configuration are deliberately outside this route.
    """
    base = {"sha": backend.get("sha"), "source": backend.get("source"),
            "verifiedAtUtc": backend.get("verifiedAtUtc"), "evidenceRef": backend.get("evidenceRef"),
            "sourceEquivalentToSha": backend.get("sourceEquivalentToSha"),
            "functionsTreeSha": backend.get("functionsTreeSha"), "verified": False}
    common = (is_sha40(backend.get("sha")) and parse_utc(backend.get("verifiedAtUtc")) is not None
              and bool(backend.get("evidenceRef")))
    if backend.get("source") == "cloud-verified":
        base["verified"] = bool(common and backend.get("sha") == tested)
        base["mode"] = "exact"
        return base
    base["mode"] = "source-equivalent"
    if not (common and backend.get("source") == "cloud-verified-source-equivalent"
            and backend.get("sourceEquivalentToSha") == tested
            and is_sha40(backend.get("functionsTreeSha"))):
        return base
    deployed_rc, deployed_tree = git(repo, "rev-parse", backend["sha"] + ":backend/supabase/functions")
    tested_rc, tested_tree = git(repo, "rev-parse", tested + ":backend/supabase/functions")
    base["deployedFunctionsTreeSha"] = deployed_tree if deployed_rc == 0 else None
    base["testedFunctionsTreeSha"] = tested_tree if tested_rc == 0 else None
    base["verified"] = (deployed_rc == 0 and tested_rc == 0 and deployed_tree == tested_tree
                        and tested_tree == backend.get("functionsTreeSha"))
    return base


def backend_proves_paths(backend_result, product_paths):
    if not backend_result.get("verified"):
        return False
    if backend_result.get("mode") == "exact":
        return True
    backend_paths = [p for p in product_paths if p.startswith("backend/")]
    return bool(backend_paths) and all(p.startswith("backend/supabase/functions/") for p in backend_paths)


def commits_in(repo, base, tip, cfg):
    rc, out = git(repo, "rev-list", "--reverse", "%s..%s" % (base, tip))
    if rc:
        return None
    res = []
    for sha in [s for s in out.splitlines() if s]:
        _, subj = git(repo, "log", "-1", "--format=%s", sha)
        _, files = git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", sha)
        paths = sorted(set(files.splitlines()))
        prod, backend, frontend = classify(paths, cfg["release"]["productPathPatterns"], cfg["release"]["testPathPatterns"])
        m = re.search(r"\(#(\d+)\)\s*$", subj)
        res.append({"sha": sha, "short": sha[:7], "subject": subj[:120], "pr": m.group(1) if m else None, "paths": len(paths), "productPaths": prod[:8],
                    "customerFacing": bool(prod), "touchesBackend": backend, "touchesFrontend": frontend})
    return res


def sealed_identity(root, cfg, tested):
    """Latest sealed run whose final identity read MATCHed the tested SHA: the frontend deployment evidence, with its time."""
    best = None
    for r in cfg["history"]["runs"]:
        p = os.path.join(root, r["label"], "identity-ledger.json")
        if not os.path.isfile(p):
            continue
        led = load(p)
        recs = [x for x in led.get("receipts", []) if x.get("result") == "MATCH" and x.get("servedSha") == tested]
        if recs:
            t = max(recs, key=lambda x: x.get("startedAt", ""))
            if best is None or t["startedAt"] > best["verifiedAtUtc"]:
                best = {"run": r["label"], "servedSha": tested, "verifiedAtUtc": t["startedAt"], "reads": len(recs), "source": "sealed-receipts",
                        "evidence": "%s identity ledger: %d MATCH reads of the tested SHA, last %s (config/history/receipts/%s/identity-ledger.json)" % (r["label"], len(recs), t["startedAt"], r["label"])}
    return best


def current_identity(path, cfg, tested, now):
    """Verify the one admission identity read produced by identity-check.cjs.

    This is current occurrence evidence, never retained history.  The private
    ledger is created inside the new run directory, bound to the tested SHA and
    target URL, and must contain exactly the admission A7 read at this point.
    """
    try:
        st = os.lstat(path)
        if not os.path.isfile(path) or os.path.islink(path) or st.st_nlink != 1 or (st.st_mode & 0o077):
            return None, "current identity ledger is not a private regular single-link file"
        led = load(path)
    except (OSError, ValueError):
        return None, "current identity ledger is missing or unreadable"
    target = str((cfg.get("target") or {}).get("url") or "").rstrip("/") + "/"
    receipts = led.get("receipts")
    if not (led.get("version") == 1 and led.get("url") == target and led.get("expectedSha") == tested
            and isinstance(led.get("cap"), int) and led["cap"] >= 1 and led.get("identityGets") == 1
            and isinstance(receipts, list) and len(receipts) == 1):
        return None, "current identity ledger is not the one-read target/release binding"
    receipt = receipts[0]
    if not (receipt.get("reservation") == 1 and receipt.get("phase") == "admission"
            and receipt.get("result") == "MATCH" and receipt.get("reason") is None
            and receipt.get("servedSha") == tested and receipt.get("expectedSha") == tested
            and receipt.get("http") == 200 and receipt.get("redirects") == 0 and receipt.get("markerCount") == 1
            and receipt.get("evidenceScope") == "inert-text-marker-only"):
        return None, "current identity receipt did not prove the exact served release"
    verified = parse_utc(receipt.get("endedAt"))
    if verified is None:
        return None, "current identity receipt has no valid completion time"
    age = (now - verified).total_seconds() / 3600
    return {"run": "current-occurrence", "servedSha": tested, "verifiedAtUtc": receipt["endedAt"], "reads": 1,
            "source": "current-runtime-identity", "evidence": "current occurrence admission identity: one exact MATCH read",
            "ageHours": round(age, 1), "fresh": 0 <= age <= cfg["release"]["identityMaxAgeHours"]}, None


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--request", required=True)
    a.add_argument("--ledger", required=True)
    a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
    a.add_argument("--repo", default=os.path.abspath(os.path.join(ROOT, "..", "..")))
    a.add_argument("--receipts-root", default=os.path.join(ROOT, "config", "history", "receipts"))
    a.add_argument("--features", default=os.path.join(ROOT, "config", "feature-ledger.json"))
    a.add_argument("--catalog", default=os.path.join(ROOT, "config", "assertion-catalog.json"))
    a.add_argument("--current-identity-ledger")
    a.add_argument("--now")
    a.add_argument("--out", required=True)
    x = a.parse_args()
    req, led, cfg = load(x.request), load(x.ledger), load(x.config)
    feats = load(x.features) if os.path.exists(x.features) else {"features": []}
    catalog = load(x.catalog) if os.path.exists(x.catalog) else {"cases": {}}
    now = parse_utc(x.now) if x.now else now_utc()
    rel = req["release"]
    tested, last = rel["testedSha"], rel["lastRunTestedSha"]
    out = {"schema": "speaksharp.cloud-test.release-verification.v1", "evaluatedUtc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "testedSha": tested, "lastRunTestedSha": last, "needs": [], "notes": []}
    N = out["needs"].append
    rc, _ = git(x.repo, "cat-file", "-e", tested + "^{commit}")
    rc2, _ = git(x.repo, "cat-file", "-e", last + "^{commit}")
    out["git"] = {"available": rc == 0 and rc2 == 0}
    if not is_sha40(tested) or not is_sha40(last):
        N("testedSha and lastRunTestedSha must be full 40-character SHAs")
    if rc or rc2:
        N("git history for the tested or last-run SHA is not available (fetch full history); the commit range cannot be verified")
        out["sinceLastRun"], out["sinceBaseline"] = None, None
    else:
        out["sinceLastRun"] = commits_in(x.repo, last, tested, cfg)
        base = None
        for lab in cfg["history"]["comparisonBaselines"]:
            r = next(r for r in cfg["history"]["runs"] if r["label"] == lab)
            base = r["servedSha"]
            break
        out["baselineLabel"] = cfg["history"]["comparisonBaselines"][0]
        out["sinceBaseline"] = commits_in(x.repo, base, tested, cfg) if git(x.repo, "cat-file", "-e", base + "^{commit}")[0] == 0 else None
    # frontend and backend deployment evidence
    current_error = None
    if x.current_identity_ledger:
        fe, current_error = current_identity(x.current_identity_ledger, cfg, tested, now)
    else:
        fe = sealed_identity(x.receipts_root, cfg, tested)
    maxage = cfg["release"]["identityMaxAgeHours"]
    if fe:
        age = (now - parse_utc(fe["verifiedAtUtc"])).total_seconds() / 3600
        fe["ageHours"] = round(age, 1)
        fe["fresh"] = 0 <= age <= maxage
    out["frontend"] = fe or {"source": "none", "servedSha": None, "fresh": False}
    if not fe:
        N("frontend: " + (current_error or "no sealed run's identity reads show the tested SHA served; take one identity read in the run environment"))
    elif not fe["fresh"]:
        N("frontend: the last verified identity read is %.0f hours old (limit %d); refresh it" % (fe["ageHours"], maxage))
    be = rel.get("backend") or {}
    be_result = backend_deployment(x.repo, be, tested)
    be_ok = be_result["verified"]
    out["backend"] = be_result
    # fixes: link ledger gaps to commits
    subjects = {}
    if out["git"]["available"]:
        _, lg = git(x.repo, "log", "--format=%H %s", tested)
        for line in lg.splitlines():
            sha, _, subj = line.partition(" ")
            m = re.search(r"\(#(\d+)\)\s*$", subj)
            if m:
                subjects.setdefault(m.group(1), sha)
    fixes = {}
    fe_ok = bool(fe and fe["fresh"])
    for g in led["gaps"]:
        fx = g.get("fix") or {}
        pr = (fx.get("pr") or "").lstrip("#") or None
        commit = fx.get("commit") or (subjects.get(pr) if pr else None)
        rec = {"pr": pr, "commit": commit, "candidate": bool(fx.get("candidate")), "resolved": bool(commit), "ancestorOfTested": None, "touchesBackend": None, "inclusion": "no-fix-identified", "basis": ""}
        if pr or fx.get("commit"):
            if not commit:
                rec.update(inclusion="unresolved", basis="no commit with subject (#%s) is in the history of the tested SHA" % pr)
            elif not out["git"]["available"]:
                rec.update(inclusion="unverifiable", basis="git history not available")
            else:
                anc = git(x.repo, "merge-base", "--is-ancestor", commit, tested)[0] == 0
                rec["ancestorOfTested"] = anc
                # Recompute the complete path set here.  The human-facing
                # sinceBaseline summary truncates productPaths for readability
                # and must never become deployment-authority input.
                _, files = git(x.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", commit)
                prod, backend, _f = classify(files.splitlines(), cfg["release"]["productPathPatterns"], cfg["release"]["testPathPatterns"])
                rec["touchesBackend"] = backend
                if not anc:
                    rec.update(inclusion="not-in-release", basis="%s is not an ancestor of the tested SHA" % commit[:7])
                elif not fe_ok:
                    rec.update(inclusion="unverified-deployment", basis="ancestor of the tested SHA, but the frontend deployment of the tested SHA is not verified (fresh)")
                elif backend and not backend_proves_paths(be_result, prod):
                    rec.update(inclusion="unverified-deployment", basis="ancestor of the tested SHA and the frontend is verified, but the change touches backend paths and the backend deployment is %s" % (be.get("source") or "undeclared"))
                else:
                    rec.update(inclusion="cloud-verified", basis="%s is an ancestor of the tested SHA; the frontend served SHA equals the tested SHA (%s)%s" % (commit[:7], fe["evidence"].split(":")[0], "; backend verified" if backend else "; frontend-only change"))
        fixes[g["id"]] = rec
    out["fixes"] = fixes
    # reviewed features: same deployment evidence as a fix, plus review, expected behaviour and test coverage
    ftrs = {}
    for f in feats.get("features", []):
        fpr = (f.get("pr") or "").lstrip("#") or None
        commit = f.get("commit") or (subjects.get(fpr) if fpr else None)
        rec = {"pr": fpr, "commit": commit, "title": f.get("title"), "inclusion": "no-commit", "basis": "", "reviewOk": False, "coverageOk": False, "problems": []}
        rv_ = f.get("review") or {}
        rec["reviewOk"] = rv_.get("outcome") == "approved" and bool(rv_.get("reviewedBy")) and bool(rv_.get("reviewRef")) and parse_utc(rv_.get("reviewedAtUtc")) is not None
        if not rec["reviewOk"]:
            rec["problems"].append("no approved review by a named reviewer with a reference and a time")
        eb = f.get("expectedBehaviour") or {}
        if not (eb.get("summary") and eb.get("criteria") and parse_utc(eb.get("definedAtUtc"))):
            rec["problems"].append("expected behaviour (summary, criteria, definition time) is not stated")
        cov = f.get("coverage") or {}
        reqs = cov.get("requirements") or []
        new_rows = cov.get("newRows") or []
        known = {(c, a) for c, v in (catalog.get("cases") or {}).items() for a in v.get("requiredAssertions", [])}
        missing_rows = [(r.get("case"), a) for r in reqs for a in r.get("assertions", []) if (r.get("case"), a) not in known]
        if not reqs and not new_rows:
            rec["problems"].append("no test coverage is declared (required rows, or new rows for a catalog version)")
        if missing_rows:
            rec["problems"].append("coverage rows are not in the assertion catalog: %s" % ", ".join("%s/%s" % m for m in missing_rows[:3]))
        pending = [r for r in new_rows if not ((r.get("case"), r.get("assertion")) in known)]
        if pending:
            rec["problems"].append("%d new coverage row(s) promised for a later catalog version are not in the catalog yet" % len(pending))
        rec["coverageOk"] = bool(reqs or new_rows) and not missing_rows and not pending
        if fpr or f.get("commit"):
            if not commit:
                rec.update(inclusion="unresolved", basis="no commit with subject (#%s) is in the history of the tested SHA" % fpr)
            elif not out["git"]["available"]:
                rec.update(inclusion="unverifiable", basis="git history not available")
            else:
                anc = git(x.repo, "merge-base", "--is-ancestor", commit, tested)[0] == 0
                _, files = git(x.repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-m", "--first-parent", commit)
                prod, backend, _f2 = classify(files.splitlines(), cfg["release"]["productPathPatterns"], cfg["release"]["testPathPatterns"])
                rec["touchesBackend"] = backend
                if not anc:
                    rec.update(inclusion="not-in-release", basis="%s is not an ancestor of the tested SHA" % commit[:7])
                elif not fe_ok:
                    rec.update(inclusion="unverified-deployment", basis="ancestor of the tested SHA, but the frontend deployment of the tested SHA is not verified (fresh)")
                elif backend and not backend_proves_paths(be_result, prod):
                    rec.update(inclusion="unverified-deployment", basis="ancestor of the tested SHA, but the change touches backend paths and the backend deployment is %s" % (be.get("source") or "undeclared"))
                else:
                    rec.update(inclusion="cloud-verified", basis="%s is an ancestor of the tested SHA; the frontend served SHA equals the tested SHA" % commit[:7])
        rec["ready"] = rec["inclusion"] == "cloud-verified" and not rec["problems"]
        ftrs[f["id"]] = rec
    out["features"] = ftrs
    # the gate: every customer-facing commit since the last run must be a verified deployed fix with expected PASS
    by_commit = {}
    for gid, f in fixes.items():
        if f["commit"]:
            by_commit.setdefault(f["commit"], []).append(gid)
    by_commit_feat = {}
    for fid, f in ftrs.items():
        if f["commit"]:
            by_commit_feat.setdefault(f["commit"], []).append(fid)
    gaps = {g["id"]: g for g in led["gaps"]}
    verdicts = []
    for c in out["sinceLastRun"] or []:
        v = {"sha": c["short"], "pr": c["pr"], "subject": c["subject"], "customerFacing": c["customerFacing"], "decision": "allowed", "reason": "not customer-facing (tests, docs, workflows or evidence only)", "gaps": []}
        if c["customerFacing"]:
            linked = by_commit.get(c["sha"], [])
            linked_feat = by_commit_feat.get(c["sha"], [])
            v["gaps"] = linked
            v["features"] = linked_feat
            if not linked and not linked_feat:
                v.update(decision="rejected", reason="customer-facing change not linked to any gap with expected-PASS criteria or to a reviewed feature with expected behaviour and test coverage (unreviewed change)")
            elif not linked:
                badf = []
                for fid in linked_feat:
                    r_ = ftrs[fid]
                    if r_["inclusion"] != "cloud-verified":
                        badf.append("%s: deployment %s" % (fid, r_["inclusion"]))
                    badf += ["%s: %s" % (fid, p_) for p_ in r_["problems"]]
                if badf:
                    v.update(decision="rejected", reason="; ".join(badf))
                else:
                    v.update(decision="allowed", reason="reviewed feature with expected behaviour and test coverage (%s)" % ", ".join(linked_feat))
            else:
                bad = []
                for gid in linked:
                    if fixes[gid]["inclusion"] != "cloud-verified":
                        bad.append("%s: deployment %s" % (gid, fixes[gid]["inclusion"]))
                    ep = gaps[gid].get("expectedPass") or {}
                    if not (ep.get("criteria") and ep.get("definedAtUtc")):
                        bad.append("%s: no expected-PASS criteria" % gid)
                if bad:
                    v.update(decision="rejected", reason="; ".join(bad))
                else:
                    v.update(decision="allowed", reason="verified deployed fix with expected-PASS criteria (%s)" % ", ".join(linked))
        verdicts.append(v)
        if v["decision"] == "rejected":
            N("%s (#%s): %s" % (c["short"], c["pr"], v["reason"]))
    out["commitVerdicts"] = verdicts
    out["g2"] = {"status": "READY" if not out["needs"] else "NOT-READY"}
    dump(out, x.out)
    print("release verification:", out["g2"]["status"], "| since last run:", None if out["sinceLastRun"] is None else len(out["sinceLastRun"]), "commits | needs:", len(out["needs"]))


if __name__ == "__main__":
    main()
