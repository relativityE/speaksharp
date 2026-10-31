#!/usr/bin/env python3
"""Closed unittest receipt producer for software-quality execution evidence."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _tests(suite: unittest.TestSuite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _tests(item)
        else:
            yield item


class ReceiptResult(unittest.TestResult):
    def __init__(self) -> None:
        super().__init__()
        self.outcomes: list[dict[str, str]] = []

    def _record(self, test: unittest.TestCase, status: str) -> None:
        self.outcomes.append({"id": test.id(), "status": status})

    def addSuccess(self, test):
        super().addSuccess(test)
        self._record(test, "passed")

    def addFailure(self, test, err):
        super().addFailure(test, err)
        self._record(test, "failed")

    def addError(self, test, err):
        super().addError(test, err)
        self._record(test, "error")

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self._record(test, "skipped")

    def addExpectedFailure(self, test, err):
        super().addExpectedFailure(test, err)
        self._record(test, "expected-failure")

    def addUnexpectedSuccess(self, test):
        super().addUnexpectedSuccess(test)
        self._record(test, "unexpected-success")


def main() -> int:
    binding = json.loads(os.environ.get("PYTHON_TEST_EVIDENCE_BINDING", "null"))
    if not isinstance(binding, dict) or binding.get("schemaVersion") != 1:
        raise RuntimeError("Missing Python evidence binding")
    root = Path(binding["root"]).resolve(strict=True)
    if Path.cwd().resolve(strict=True) != root:
        raise RuntimeError("Wrong Python evidence working directory")
    relative = binding["testFile"]
    target = (root / relative).resolve(strict=True)
    if target != root / relative or not target.is_file():
        raise RuntimeError("Aliased Python test source")

    # Package tests import `scripts` and `report` from tools/cloud-test.
    package_root = root / "tools" / "cloud-test"
    sys.path[:] = [str(package_root), str(root)] + [p for p in sys.path if p]
    module_name = "_evidence_" + hashlib.sha256(relative.encode()).hexdigest()
    spec = importlib.util.spec_from_file_location(module_name, target)
    if spec is None or spec.loader is None:
        raise RuntimeError("Python test module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    suite = unittest.defaultTestLoader.loadTestsFromModule(module)
    collected = [test.id() for test in _tests(suite)]
    if not collected or len(collected) != len(set(collected)):
        raise RuntimeError("Python unittest collection is empty or duplicated")

    result = ReceiptResult()
    suite.run(result)
    import yaml  # Imported inside the bound runtime; version is independently checked.
    yaml_file = Path(yaml.__file__).resolve(strict=True)
    receipt = {
        "schemaVersion": 1,
        "binding": binding,
        "runtime": {
            "execPath": str(Path(sys.executable).resolve(strict=True)),
            "version": ".".join(map(str, sys.version_info[:3])),
            "executableSha256": _sha256(Path(sys.executable).resolve(strict=True)),
            "yamlVersion": yaml.__version__,
            "yamlFile": str(yaml_file),
            "yamlSha256": _sha256(yaml_file),
            "reporterSha256": _sha256(Path(__file__).resolve(strict=True)),
        },
        "collected": collected,
        "outcomes": result.outcomes,
    }
    receipt_path = Path(binding["receiptFile"])
    if receipt_path.parent.resolve(strict=True) != Path(binding["receiptDirectory"]).resolve(strict=True):
        raise RuntimeError("Python receipt escaped its owned directory")
    receipt_path.write_text(json.dumps(receipt, sort_keys=True), encoding="utf-8")
    return 0 if result.wasSuccessful() and len(result.outcomes) == len(collected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
