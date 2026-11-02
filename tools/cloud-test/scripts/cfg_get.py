#!/usr/bin/env python3
"""Prints one value from the versioned config by dotted path (empty string for null). Usage: cfg_get.py CONFIG harness.packetDir"""
import json
import sys

d = json.load(open(sys.argv[1], encoding="utf-8"))
for k in sys.argv[2].split("."):
    d = d[k]
print("" if d is None else d)
