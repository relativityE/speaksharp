#!/usr/bin/env python3
"""Print the credential NAMES a run-environment stage may receive.

The config is the upper bound.  The run stage additionally narrows the two
account-role pairs to the roles used by the admitted request, so an AHT-15-only
run never requires throwaway credentials and an AHT-01..14-only run never
requires maintained-account credentials.  Values are never read here.

Usage: stage_env.py CONFIG STAGE [REQUEST]
"""
import json
import sys

cfg = json.load(open(sys.argv[1], encoding="utf-8"))["credentials"]
stage = sys.argv[2]
stages = cfg["runEnvironment"]["stages"]
if stage not in stages:
    sys.exit("undeclared stage: " + stage)
names = stages[stage]
bad = [n for n in names if n in cfg["forbidden"] or n not in cfg["runEnvironment"]["names"]]
if bad:
    sys.exit("stage %s lists a forbidden or undeclared name: %s" % (stage, bad))

if stage == "run":
    if len(sys.argv) != 4:
        sys.exit("run stage requires the admitted request")
    try:
        request = json.load(open(sys.argv[3], encoding="utf-8"))
        cases = [row["case"] for row in request["selection"]]
    except (OSError, ValueError, KeyError, TypeError):
        sys.exit("run stage request cannot be read")
    allowed_cases = {"AHT-%02d" % n for n in range(1, 16)}
    if not cases or len(cases) != len(set(cases)) or any(case not in allowed_cases for case in cases):
        sys.exit("run stage request has an invalid case selection")
    role_names = {
        "existing-disposable": {"THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD"},
        "maintained-read-only": {"FREE_TEST_EMAIL", "FREE_TEST_PASSWORD"},
    }
    selected = set()
    if any(case != "AHT-15" for case in cases):
        selected |= role_names["existing-disposable"]
    if "AHT-15" in cases:
        selected |= role_names["maintained-read-only"]
    all_role_names = set().union(*role_names.values())
    names = [name for name in names if name not in all_role_names or name in selected]
print("\n".join(names))
