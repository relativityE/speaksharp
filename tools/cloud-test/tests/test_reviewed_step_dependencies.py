"""Sam 1794144841: draft-adapters/oracles/index.cjs required oracles/smoke-saved-focus.cjs, but the reviewed-step manifest did not list it,
so its bytes were never verified at the step boundary. Every relative require() reachable from a reviewed step (transitively, inside the
packet) must be a listed dependency of that step with its exact sha256; a missing or drifted entry fails here."""
import hashlib
import json
import os
import re
import unittest

from _fixtures import ROOT

PACKET = os.path.join(ROOT, "harness")
MANIFEST = os.path.join(PACKET, "bundle", "config", "reviewed-steps.EXAMPLE.json")
REQUIRE = re.compile(r"""require\(\s*(?:path\.join\(__dirname,\s*)?['"](\.{1,2}/[^'"]+)['"]""")


def relative_requires(rel):
    """Packet-relative files reached by literal relative require() calls from `rel`, transitively."""
    seen, todo = set(), [rel]
    while todo:
        cur = todo.pop()
        with open(os.path.join(PACKET, cur), encoding="utf-8") as f:
            src = f.read()
        for spec in REQUIRE.findall(src):
            target = os.path.normpath(os.path.join(os.path.dirname(cur), spec))
            if not target.endswith((".cjs", ".js", ".json")):
                target += ".cjs" if os.path.isfile(os.path.join(PACKET, target + ".cjs")) else ".js"
            if target.startswith("..") or not os.path.isfile(os.path.join(PACKET, target)) or target in seen:
                continue
            seen.add(target)
            if target.endswith((".cjs", ".js")):
                todo.append(target)
    return seen


class ReviewedStepDependencies(unittest.TestCase):
    def test_every_reachable_relative_require_is_a_listed_dependency_with_its_exact_hash(self):
        steps = json.load(open(MANIFEST))["steps"]
        steps = steps["steps"] if isinstance(steps, dict) else steps
        for step in steps:
            listed = {d["path"]: d["sha256"] for d in step["dependencies"]}
            with self.subTest(step=step["path"]):
                missing = sorted(t for t in relative_requires(step["path"]) if t != step["path"] and t not in listed)
                self.assertEqual(missing, [], "unlisted reviewed dependencies")
                drifted = sorted(p for p, h in listed.items()
                                 if hashlib.sha256(open(os.path.join(PACKET, p), "rb").read()).hexdigest() != h)
                self.assertEqual(drifted, [], "drifted reviewed dependencies")

    def test_the_rule_catches_the_original_gap(self):
        self.assertIn("draft-adapters/oracles/smoke-saved-focus.cjs", relative_requires("draft-adapters/oracles/index.cjs"))


if __name__ == "__main__":
    unittest.main()
