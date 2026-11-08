#!/usr/bin/env python3
"""No-network egress readiness before any production prerequisite request (Sam 1794156633 / 1794156723).

The production guard policy requires `upstream.mode: env-proxy` (guard-proxy.cjs, no direct fallback): every upstream connection must go
through the environment's HTTPS proxy, and a host matched by NO_PROXY would be refused. execute_run.sh run_stage forwards only the UPPERCASE
HTTPS_PROXY / HTTP_PROXY / NO_PROXY into the stage environment, so a lowercase-only setting never reaches the guard. Run 42496837188 reached
AHT-01 and failed at page.goto with a guard upstream-error; this check fails closed BEFORE any credential-bearing step instead.

It reads the environment exactly as the guard will see it after that boundary and records presence/syntax only:
  ready      true only when the policy is env-proxy and the forwarded HTTPS_PROXY is set, parses as an http(s) proxy URL, and the forwarded
             NO_PROXY matches no policy host (or when the policy is not env-proxy);
  reason     ready | proxy-not-configured | proxy-lowercase-only | proxy-invalid | no-proxy-matches-policy-host;
  booleans   proxyConfigured, proxyValid, lowercaseOnly, noProxyMatched (syntax and presence only: NOT a reachability claim).
Never a proxy value, host, port or credential. The receipt is written in every case (bound to the run, attempt and source SHA); exit 0 when
ready, 78 otherwise. No network, no policy, TLS or transport change."""
import argparse
import json
import os
import re
import sys
from urllib.parse import urlsplit

SCHEMA = "speaksharp.cloud-test.egress-preflight.v1"
POLICY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "harness", "bundle", "config", "policy.production.TEMPLATE.json")
REASONS = ("ready", "proxy-not-configured", "proxy-lowercase-only", "proxy-invalid", "no-proxy-matches-policy-host")


def no_proxy_matches(no_proxy, host):
    """guard-proxy.cjs noProxy(): exact host, a '.suffix' entry, or a '*.suffix' entry."""
    entries = [e.strip() for e in (no_proxy or "").split(",") if e.strip()]
    return any(e == host or (e.startswith(".") and host.endswith(e)) or (e.startswith("*.") and host.endswith(e[1:])) for e in entries)


def valid_proxy(value):
    try:
        u = urlsplit(value)
        return u.scheme in ("http", "https") and bool(u.hostname)
    except ValueError:
        return False


def evaluate(policy, env):
    """The closed readiness verdict for `policy` under environment mapping `env` (the guard's view after the run_stage boundary)."""
    mode = ((policy.get("upstream") or {}) if isinstance(policy, dict) else {}).get("mode")
    hosts = sorted((policy.get("hosts") or {}).keys()) if isinstance(policy, dict) and isinstance(policy.get("hosts"), dict) else []
    forwarded = env.get("HTTPS_PROXY") or ""
    lowercase_only = not forwarded and bool(env.get("https_proxy"))
    configured = bool(forwarded)
    valid = configured and valid_proxy(forwarded)
    matched = any(no_proxy_matches(env.get("NO_PROXY") or "", h) for h in hosts)
    if mode != "env-proxy":
        reason = "ready"
    elif lowercase_only:
        reason = "proxy-lowercase-only"
    elif not configured:
        reason = "proxy-not-configured"
    elif not valid:
        reason = "proxy-invalid"
    elif matched:
        reason = "no-proxy-matches-policy-host"
    else:
        reason = "ready"
    return {"upstreamMode": mode if mode in ("env-proxy", "direct", "override") else "other", "proxyConfigured": configured,
            "proxyValid": valid, "lowercaseOnly": lowercase_only, "noProxyMatched": matched, "ready": reason == "ready", "reason": reason}


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("--run-id", required=True)
    a.add_argument("--attempt", required=True)
    a.add_argument("--source-sha", required=True)
    a.add_argument("--out", required=True)
    a.add_argument("--policy", default=POLICY)
    x = a.parse_args(argv[1:])
    binding = {"runId": x.run_id if re.fullmatch(r"[1-9][0-9]{0,19}", x.run_id or "") else None,
               "attempt": int(x.attempt) if re.fullmatch(r"[1-9][0-9]{0,2}", x.attempt or "") else None,
               "sourceSha": x.source_sha if re.fullmatch(r"[0-9a-f]{40}", x.source_sha or "") else None}
    try:
        with open(x.policy, encoding="utf-8") as f:
            policy = json.load(f)
        verdict = evaluate(policy, os.environ)
    except (OSError, ValueError):
        verdict = {"upstreamMode": "other", "proxyConfigured": False, "proxyValid": False, "lowercaseOnly": False, "noProxyMatched": False,
                   "ready": False, "reason": "proxy-not-configured"}
    doc = dict({"schema": SCHEMA, "reachabilityChecked": False}, **binding, **verdict)
    fd = os.open(x.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(doc, f, sort_keys=True)
        f.write("\n")
    if not doc["ready"]:
        print("BLOCKED_SETUP: egress-preflight:" + doc["reason"], file=sys.stderr)
        return 78
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
