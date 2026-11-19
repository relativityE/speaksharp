"""Integrity of the tested-release reopen-route excerpt the smoke Focus readback is bound to (tests/fixtures/
tested-release-reopen-route-5a7bf6a1.json; read by the Node smoke readback and r15 proof suites): closed shape, exact release and blob
identities, verbatim 1-based lines, and the canonical /progress/<take> route the readback derives from line 500."""
import json
import os
import re
import unittest

from _fixtures import ROOT

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "tested-release-reopen-route-5a7bf6a1.json")
SHA40 = re.compile(r"[0-9a-f]{40}")


class TestedReleaseRouteFixture(unittest.TestCase):
    def setUp(self):
        with open(FIXTURE, encoding="utf-8") as f:
            self.doc = json.load(f)

    def test_the_excerpt_is_closed_and_bound_to_the_tested_release(self):
        self.assertEqual(set(self.doc), {"sourceSha", "note", "files"})
        self.assertEqual(self.doc["sourceSha"], "5a7bf6a1cbd0fb2f4a1c2b363d891c8fcc462bd2")
        self.assertEqual(set(self.doc["files"]), {"frontend/src/components/AnalyticsDashboard.tsx", "frontend/src/App.tsx"})
        for name, entry in self.doc["files"].items():
            with self.subTest(name):
                self.assertEqual(set(entry), {"blobSha", "lines"})
                self.assertRegex(entry["blobSha"], SHA40)
                self.assertTrue(entry["lines"])
                for number, text in entry["lines"].items():
                    self.assertRegex(number, r"[1-9][0-9]{0,4}")
                    self.assertIsInstance(text, str)
                    self.assertNotIn("\n", text)

    def test_the_readback_route_prefix_is_derivable_exactly_as_the_node_consumer_derives_it(self):
        line = self.doc["files"]["frontend/src/components/AnalyticsDashboard.tsx"]["lines"]["500"]
        m = re.search(r"to=\{`([^`$]*)\$\{session\.id\}`\}", line)
        self.assertIsNotNone(m, "the smoke readback derives its reopen route prefix from this line")
        self.assertEqual(m.group(1), "/progress/")


if __name__ == "__main__":
    unittest.main()
