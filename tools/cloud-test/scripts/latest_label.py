#!/usr/bin/env python3
"""Prints the label of the most recent comparable sealed run in the config history (the nightly control plane reports on it). Exit 1 when there is none.
Usage: latest_label.py [--config C.json]"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import ROOT, load  # noqa: E402

a = argparse.ArgumentParser()
a.add_argument("--config", default=os.path.join(ROOT, "config", "test-config.v1.json"))
x = a.parse_args()
runs = [r["label"] for r in load(x.config)["history"]["runs"] if not r.get("ledgersOnly")]
if not runs:
    sys.exit("no comparable sealed run")
print(runs[-1])
