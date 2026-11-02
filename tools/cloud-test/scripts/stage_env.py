#!/usr/bin/env python3
"""Prints the credential NAMES a run-environment stage may receive (one per line), from config credentials.runEnvironment.stages. Names only.
Refuses stages that are not declared and any name on the forbidden list. Usage: stage_env.py CONFIG STAGE"""
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
print("\n".join(names))
