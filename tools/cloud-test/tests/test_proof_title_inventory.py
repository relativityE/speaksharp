"""Every offline-proof test resolves through the reviewed, source-owned title inventory: unknown or malformed titles and missing tests refuse the proof, and only reviewed inventory titles are ever reported."""
import glob
import json
import os
import re
import sys
import tempfile
import unittest

from _fixtures import ROOT

sys.path.insert(0, os.path.join(ROOT, "scripts"))
import generate_offline_proof as G  # noqa: E402
import proof_title_inventory as PT  # noqa: E402

CASE14 = "packet:draft-adapters/tests/case14-fault-boundary.offline.test.cjs"


def tap(results):
    """A node-22-shaped TAP stream for [(title, status, assertion)]; returns (returncode, text)."""
    lines, n = ["TAP version 13"], 0
    for title, status, assertion in results:
        n += 1
        lines.append(("not ok" if status == "FAIL" else "ok") + " %d - %s" % (n, title) + (" # SKIP" if status == "SKIP" else ""))
        if status == "FAIL":
            lines += ["  ---", "  error: 'x'", "  code: 'ERR_ASSERTION'" if assertion else "  code: 'ERR_TEST_FAILURE'", "  ..."]
    fail = sum(s == "FAIL" for _, s, _ in results)
    lines += ["1..%d" % n, "# tests %d" % n, "# suites 0", "# pass %d" % sum(s == "PASS" for _, s, _ in results), "# fail %d" % fail,
              "# cancelled 0", "# skipped %d" % sum(s == "SKIP" for _, s, _ in results), "# todo 0", "# duration_ms 1"]
    return (1 if fail else 0), "\n".join(lines) + "\n"


def run_suites(inventory):
    """Every inventoried suite run with every title passing."""
    return {s: tap([(t, "PASS", False) for t in titles]) for s, titles in inventory.items()}


class Inventory(unittest.TestCase):
    def setUp(self):
        self.inv = PT.load()

    def test_the_inventory_covers_exactly_the_suites_the_proof_runs(self):
        h = os.path.join(ROOT, "harness")
        packet = sorted(glob.glob(os.path.join(h, "draft-adapters", "tests", "*.test.cjs")) + glob.glob(os.path.join(h, "bundle", "selftest", "*.test.cjs"))
                        + glob.glob(os.path.join(h, "bundle", "qualification", "*.test.cjs")))
        proof = sorted(glob.glob(os.path.join(ROOT, "tests", "node", "proof", "*.test.cjs")))
        expected = {"packet:" + os.path.relpath(p, h) for p in packet} | {"proof:" + os.path.relpath(p, ROOT) for p in proof} \
            | {"service:" + rel for rel in G.SERVICE_TEST_COUNTS}
        self.assertEqual(set(self.inv), expected)
        for rel, count in G.SERVICE_TEST_COUNTS.items():
            self.assertEqual(len(self.inv["service:" + rel]), count)

    def test_every_literal_title_in_the_source_is_inventoried_for_its_own_suite(self):
        literal = re.compile(r"^\s*test\('((?:[^'\\]|\\.)*)'\s*,", re.M)
        checked = 0
        for suite, titles in self.inv.items():
            kind, rel = suite.split(":", 1)
            with open(os.path.join(ROOT, "harness" if kind == "packet" else "", rel), encoding="utf-8") as f:
                src = f.read()
            for m in literal.finditer(src):
                title = re.sub(r"\\(.)", r"\1", m.group(1)).replace("\\", "\\\\").replace("#", "\\#")
                self.assertIn(title, titles, suite)
                checked += 1
        self.assertGreaterEqual(checked, 800)          # 813 literal titles at introduction

    def test_the_case14_title_from_run_42534540918_is_reviewed(self):
        self.assertEqual(self.inv[CASE14][0],
                         "Case14 full path: exactly Download → Retry → Start journaled, restoration before Retry, recovery saved and reopened")

    def test_a_malformed_inventory_refuses(self):
        good = {"schema": PT.SCHEMA, "suites": {CASE14: ["a title"]}}
        bad = [dict(good, extra=1), dict(good, schema="v0"), {"schema": PT.SCHEMA, "suites": {}},
               {"schema": PT.SCHEMA, "suites": {CASE14: ["dup", "dup"]}}, {"schema": PT.SCHEMA, "suites": {CASE14: []}},
               {"schema": PT.SCHEMA, "suites": {"other:x.test.cjs": ["t"]}}, {"schema": PT.SCHEMA, "suites": {CASE14: ["tab\there"]}},
               {"schema": PT.SCHEMA, "suites": {CASE14: [7]}}, {"schema": PT.SCHEMA, "suites": {"packet:../x.test.cjs": ["t"]}}]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "inv.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump(good, f)
            self.assertEqual(PT.load(path), {CASE14: ["a title"]})
            for doc in bad:
                with self.subTest(doc), open(path, "w", encoding="utf-8") as f:
                    json.dump(doc, f)
                with self.assertRaises(PT.InventoryError):
                    PT.load(path)


class Resolution(unittest.TestCase):
    INV = {"packet:a.test.cjs": ["first", "second", "third"], "service:tests/b.test.cjs": ["only"]}

    def resolve(self, results):
        return PT.resolve(self.INV, results)

    def test_all_pass_resolves_clean(self):
        rows, problems = self.resolve({"packet:a.test.cjs": [{"title": t, "status": "PASS", "assertion": False} for t in self.INV["packet:a.test.cjs"]],
                                       "service:tests/b.test.cjs": [{"title": "only", "status": "PASS", "assertion": False}]})
        self.assertEqual(problems, [])
        self.assertEqual([r["status"] for r in rows], ["PASS"] * 4)
        self.assertEqual(PT.report_lines(rows), [])

    def test_a_failed_test_is_reported_by_suite_ordinal_category_and_reviewed_title_only(self):
        rows, problems = self.resolve({"packet:a.test.cjs": [{"title": "first", "status": "PASS", "assertion": False},
                                                             {"title": "second", "status": "FAIL", "assertion": True},
                                                             {"title": "third", "status": "FAIL", "assertion": False}],
                                       "service:tests/b.test.cjs": [{"title": "only", "status": "SKIP", "assertion": False}]})
        self.assertEqual(PT.report_lines(rows), ["TEST FAIL packet:a.test.cjs test 2 [assertion]: second",
                                                 "TEST FAIL packet:a.test.cjs test 3 [error]: third",
                                                 "TEST SKIP service:tests/b.test.cjs test 1 [none]: only"])
        self.assertEqual(problems, ["packet:a.test.cjs suite: 2 of 3 inventoried tests did not pass",
                                    "service:tests/b.test.cjs suite: 1 of 1 inventoried tests did not pass"])

    def test_unknown_and_malformed_titles_refuse_and_are_never_echoed(self):
        secret = "token=abc /opt/ci-work/x value 42"
        rows, problems = self.resolve({"packet:a.test.cjs": [{"title": t, "status": "PASS", "assertion": False} for t in ("first", "second", "third")]
                                       + [{"title": secret, "status": "PASS", "assertion": False}, {"title": "bad\x00title", "status": "FAIL"},
                                          {"title": None, "status": "PASS"}],
                                       "service:tests/b.test.cjs": [{"title": "only", "status": "PASS", "assertion": False}]})
        self.assertIn("packet:a.test.cjs suite: 1 test title(s) not in the reviewed inventory", problems)
        self.assertIn("packet:a.test.cjs suite: 2 malformed test title(s)", problems)
        text = json.dumps([rows, problems, PT.report_lines(rows)])
        self.assertNotIn("token=abc", text)
        self.assertNotIn("bad\\u0000title", text)

    def test_missing_tests_suites_and_unjudgeable_runs_are_not_run(self):
        rows, problems = self.resolve({"packet:a.test.cjs": [{"title": "first", "status": "PASS", "assertion": False}],
                                       "packet:extra.test.cjs": []})
        self.assertIn("packet:extra.test.cjs suite: no reviewed title inventory", problems)
        self.assertIn("service:tests/b.test.cjs suite: not run", problems)
        self.assertEqual(PT.report_lines(rows), ["TEST NOT RUN packet:a.test.cjs test 2 [none]: second",
                                                 "TEST NOT RUN packet:a.test.cjs test 3 [none]: third",
                                                 "TEST NOT RUN service:tests/b.test.cjs test 1 [none]: only"])
        rows, problems = self.resolve({"packet:a.test.cjs": None, "service:tests/b.test.cjs": [{"title": "only", "status": "PASS", "assertion": False}]})
        self.assertIn("packet:a.test.cjs suite: results could not be judged", problems)
        self.assertEqual(sum(r["status"] == "NOT RUN" for r in rows), 3)


class ProofIntegration(unittest.TestCase):
    """The offline-proof acceptance uses the inventory on the real TAP path (parse_tap), so a load error, an unknown title or the
    case14 35/36 failure refuses the proof and is reported by reviewed title."""

    def setUp(self):
        self.inv = PT.load()

    def problems(self, suites):
        return G.run_problems(suites, (0, "{}"), {}, [], [], 0, {"result": "PASS"}, [], title_inventory=self.inv)

    def test_the_run_42534540918_shape_names_the_failing_case14_title(self):
        suites = run_suites(self.inv)
        titles = self.inv[CASE14]
        suites[CASE14] = tap([(titles[0], "FAIL", True)] + [(t, "PASS", False) for t in titles[1:]])
        rows, problems = G.title_report(suites, self.inv)
        self.assertEqual(PT.report_lines(rows), ["TEST FAIL %s test 1 [assertion]: %s" % (CASE14, titles[0])])
        self.assertIn("%s suite: 1 of %d inventoried tests did not pass" % (CASE14, len(titles)), self.problems(suites))

    def test_a_clean_inventoried_run_adds_no_title_problem(self):
        suites = run_suites(self.inv)
        rows, problems = G.title_report(suites, self.inv)
        self.assertEqual((problems, PT.report_lines(rows)), ([], []))
        self.assertEqual(len(rows), sum(len(t) for t in self.inv.values()))

    def test_a_load_error_titled_with_a_path_refuses_and_every_inventoried_test_is_not_run(self):
        suites = run_suites(self.inv)
        suites[CASE14] = tap([("/opt/ci-work/x/case14-fault-boundary.offline.test.cjs", "FAIL", False)])
        rows, problems = G.title_report(suites, self.inv)
        self.assertIn("%s suite: 1 test title(s) not in the reviewed inventory" % CASE14, problems)
        self.assertEqual(sum(r["status"] == "NOT RUN" and r["suite"] == CASE14 for r in rows), len(self.inv[CASE14]))
        self.assertNotIn("/opt/ci-work", json.dumps(PT.report_lines(rows)))

    def test_main_loads_the_inventory_and_passes_it_to_acceptance(self):
        with open(os.path.join(ROOT, "scripts", "generate_offline_proof.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("titles = PT.load()", src)
        self.assertIn("title_inventory=titles)", src)
        self.assertIn("for line in PT.report_lines(rows):", src)


if __name__ == "__main__":
    unittest.main()
