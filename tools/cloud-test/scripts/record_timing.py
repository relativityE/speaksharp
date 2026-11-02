#!/usr/bin/env python3
"""Records observed GitHub Actions job timing for the usage account. Usage: record_timing.py start|end --job NAME --dir DIR
start writes DIR/timing-NAME.json {startedUtc}; end adds endedUtc. Minutes are rounded up per job by spend_report.py. Offline."""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import now_utc  # noqa: E402

a = argparse.ArgumentParser()
a.add_argument("what", choices=["start", "end"])
a.add_argument("--job", required=True)
a.add_argument("--dir", required=True)
x = a.parse_args()
os.makedirs(x.dir, exist_ok=True)
p = os.path.join(x.dir, "timing-%s.json" % x.job)
d = json.load(open(p)) if os.path.exists(p) else {"job": x.job}
d["startedUtc" if x.what == "start" else "endedUtc"] = now_utc().strftime("%Y-%m-%dT%H:%M:%SZ")
json.dump(d, open(p, "w"), indent=1)
