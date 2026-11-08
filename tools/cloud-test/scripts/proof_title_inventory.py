#!/usr/bin/env python3
"""Every offline-proof test resolved through a reviewed, source-owned title inventory (Sam 1794180342 / 1794180453; PO: "all tests need
a test title").

config/proof-test-titles.v1.json lists, for every suite generate_offline_proof.py runs (packet:/proof:/service: + its path), the exact
titles that suite's source declares, in declaration order, in the form the TAP reporter prints them. A runtime result is credited only
through that inventory:
  - a TAP title that is not in its suite's inventory, or is malformed, refuses the proof (it is counted, never printed);
  - an inventory title with no TAP result is NOT RUN, and refuses the proof;
  - a suite the run did not produce, or a run suite with no inventory, refuses the proof.
The report names a non-passing test only by suite, 1-based inventory ordinal, the REVIEWED inventory title, its status
(FAIL / NOT RUN / SKIP / TODO) and a closed failure category (assertion / error / none). It never echoes TAP text, assertion values,
stderr, paths or data. Offline: no network, no subprocess."""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: no network)

HERE = os.path.dirname(os.path.abspath(__file__))
INVENTORY = os.path.join(os.path.dirname(HERE), "config", "proof-test-titles.v1.json")
SCHEMA = "speaksharp.cloud-test.proof-test-titles.v1"
SUITE = re.compile(r"(packet|proof|service):[a-z0-9][a-z0-9._/-]{0,199}\.test\.cjs")
# Printable ASCII plus the three reviewed non-ASCII characters the sources use (plus-minus, en dash, arrow). Anything else is malformed.
TITLE = re.compile("[ -~±–→]{1,300}")
STATUSES = ("PASS", "FAIL", "NOT RUN", "SKIP", "TODO")


class InventoryError(Exception):
    pass


def load(path=INVENTORY):
    """{suite: [title, ...]} from the reviewed inventory; refuses any malformed suite id, title, duplicate or extra key."""
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError) as e:
        raise InventoryError("inventory unreadable") from e
    if not (isinstance(doc, dict) and set(doc) == {"schema", "suites"} and doc["schema"] == SCHEMA and isinstance(doc["suites"], dict)
            and doc["suites"]):
        raise InventoryError("inventory shape")
    for suite, titles in doc["suites"].items():
        if not (isinstance(suite, str) and SUITE.fullmatch(suite) and isinstance(titles, list) and titles
                and all(isinstance(t, str) and TITLE.fullmatch(t) for t in titles) and len(set(titles)) == len(titles)):
            raise InventoryError("inventory suite malformed")
    return doc["suites"]


def resolve(inventory, results):
    """results: {suite: [{"title", "status", "assertion"}, ...]} as harness_mutation_controls.parse_tap returns them (or None when the
    suite's TAP could not be judged). Returns (rows, problems): one row per inventory test, and closed problem strings."""
    rows, problems = [], []
    for suite in sorted(set(results) - set(inventory)):
        problems.append("%s suite: no reviewed title inventory" % suite)
    for suite in sorted(inventory):
        titles = inventory[suite]
        if suite not in results:
            problems.append("%s suite: not run" % suite)
            tests = []
        elif results[suite] is None:
            problems.append("%s suite: results could not be judged" % suite)
            tests = []
        else:
            tests = results[suite]
        by = {}
        unknown = malformed = 0
        for t in tests:
            title = t.get("title") if isinstance(t, dict) else None
            if not (isinstance(title, str) and TITLE.fullmatch(title)):
                malformed += 1
            elif title not in titles:
                unknown += 1
            else:
                by[title] = t
        if malformed:
            problems.append("%s suite: %d malformed test title(s)" % (suite, malformed))
        if unknown:
            problems.append("%s suite: %d test title(s) not in the reviewed inventory" % (suite, unknown))
        for i, title in enumerate(titles, 1):
            t = by.get(title)
            status = t["status"] if t is not None and t.get("status") in STATUSES else ("NOT RUN" if t is None else "FAIL")
            category = ("assertion" if t.get("assertion") is True else "error") if status == "FAIL" else "none"
            rows.append({"suite": suite, "ordinal": i, "title": title, "status": status, "category": category})
        bad = [r for r in rows if r["suite"] == suite and r["status"] != "PASS"]
        if bad:
            problems.append("%s suite: %d of %d inventoried tests did not pass" % (suite, len(bad), len(titles)))
    return rows, problems


def report_lines(rows):
    """One closed line per non-passing inventoried test: suite, ordinal, status, category and the reviewed title."""
    return ["TEST %s %s test %d [%s]: %s" % (r["status"], r["suite"], r["ordinal"], r["category"], r["title"])
            for r in rows if r["status"] != "PASS"]
