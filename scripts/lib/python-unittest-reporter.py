#!/usr/bin/env python3
"""Closed unittest receipt producer for software-quality execution evidence."""

from __future__ import annotations

import hashlib
import importlib.util
import builtins
import io
import json
import os
from pathlib import Path
import sys
import unittest


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _directory_manifest(root: Path):
    rows = []
    for item in sorted(root.rglob("*")):
        if item.is_symlink():
            raise RuntimeError("Aliased Python environment directory entry")
        if item.is_file():
            rows.append({"name": item.relative_to(root).as_posix(), "sha256": _sha256(item)})
        elif not item.is_dir():
            raise RuntimeError("Unsupported Python environment directory entry")
        if len(rows) > 4096:
            raise RuntimeError("Python environment directory is unbounded")
    if not rows:
        raise RuntimeError("Empty Python environment directory")
    return rows


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
    environment = binding.get("environment")
    if not isinstance(environment, dict) or environment.get("literal") != {"CT_REQUIRE_INTEGRATION": "1"}:
        raise RuntimeError("Missing Python package environment binding")
    for name, expected in environment.get("files", {}).items():
        observed = Path(os.environ.get(name, "")).resolve(strict=True)
        if str(observed) != expected["path"] or _sha256(observed) != expected["sha256"]:
            raise RuntimeError("Changed Python environment file: " + name)
    for name, expected in environment.get("directories", {}).items():
        observed = Path(os.environ.get(name, "")).resolve(strict=True)
        if str(observed) != expected["path"] or _directory_manifest(observed) != expected["files"]:
            raise RuntimeError("Changed Python environment directory: " + name)
    relative = binding["testFile"]
    target = (root / relative).resolve(strict=True)
    if target != root / relative or not target.is_file():
        raise RuntimeError("Aliased Python test source")

    # A passing neighboring suite is not evidence that it consumed a changed
    # fixture. Observe reads of the exact bound inputs inside this interpreter
    # while the selected module imports and executes. Child processes do not
    # inherit this hook, so delegated consumption needs a direct assertion in
    # the selected test module as well.
    expected_sources = {}
    for item in binding.get("sourceFiles", []):
        source = (root / item["file"]).resolve(strict=True)
        if source != root / item["file"] or not source.is_file() or _sha256(source) != item["sha256"]:
            raise RuntimeError("Changed or aliased Python input source")
        expected_sources[str(source)] = item
    observed_source_reads: set[str] = set()

    class ObservedReader:
        """Delegate a successful open and credit only nonempty returned bytes."""

        def __init__(self, stream, source: str) -> None:
            self._stream = stream
            self._source = source

        def _observe(self, value):
            if value not in (b"", "", None):
                observed_source_reads.add(self._source)
            return value

        def read(self, *args, **kwargs):
            return self._observe(self._stream.read(*args, **kwargs))

        def readline(self, *args, **kwargs):
            return self._observe(self._stream.readline(*args, **kwargs))

        def readlines(self, *args, **kwargs):
            return self._observe(self._stream.readlines(*args, **kwargs))

        def readinto(self, *args, **kwargs):
            count = self._stream.readinto(*args, **kwargs)
            if isinstance(count, int) and count > 0:
                observed_source_reads.add(self._source)
            return count

        def __iter__(self):
            return self

        def __next__(self):
            return self._observe(next(self._stream))

        def __enter__(self):
            self._stream.__enter__()
            return self

        def __exit__(self, *args):
            return self._stream.__exit__(*args)

        def __getattr__(self, name):
            return getattr(self._stream, name)

    original_builtin_open = builtins.open
    original_io_open = io.open

    def observed_open(original, file, *args, **kwargs):
        stream = original(file, *args, **kwargs)
        if not isinstance(file, (str, bytes, os.PathLike)):
            return stream
        try:
            supplied = Path(file)
            lexical = str((supplied if supplied.is_absolute() else Path.cwd() / supplied).absolute())
            candidate = str(supplied.resolve(strict=True))
        except (OSError, RuntimeError, TypeError, ValueError):
            return stream
        if lexical not in expected_sources or candidate not in expected_sources or not stream.readable():
            return stream
        return ObservedReader(stream, candidate)

    builtins.open = lambda file, *args, **kwargs: observed_open(original_builtin_open, file, *args, **kwargs)
    io.open = lambda file, *args, **kwargs: observed_open(original_io_open, file, *args, **kwargs)

    # Package tests import `scripts` and `report` from tools/cloud-test.
    package_root = root / "tools" / "cloud-test"
    # Isolated mode removes the script directory.  Real package tests use sibling
    # helpers (for example `_fixtures`), so bind the selected test directory too.
    sys.path[:] = [str(target.parent), str(package_root), str(root)] + [p for p in sys.path if p]
    module_name = "_evidence_" + hashlib.sha256(relative.encode()).hexdigest()
    try:
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
    finally:
        builtins.open = original_builtin_open
        io.open = original_io_open
    import yaml  # Imported inside the bound runtime; version is independently checked.
    yaml_file = Path(yaml.__file__).resolve(strict=True)
    tools = {}
    for name, expected in binding["runtime"]["tools"].items():
        executable = Path(expected["path"]).resolve(strict=True)
        if str(executable) != expected["path"] or _sha256(executable) != expected["sha256"]:
            raise RuntimeError("Changed Python child tool identity: " + name)
        tools[name] = {"path": str(executable), "sha256": _sha256(executable)}
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
            "tools": tools,
        },
        "collected": collected,
        "outcomes": result.outcomes,
        "sourceReads": [
            {"file": expected_sources[source]["file"], "sha256": _sha256(Path(source))}
            for source in sorted(observed_source_reads)
        ],
    }
    receipt_path = Path(binding["receiptFile"])
    if receipt_path.parent.resolve(strict=True) != Path(binding["receiptDirectory"]).resolve(strict=True):
        raise RuntimeError("Python receipt escaped its owned directory")
    receipt_path.write_text(json.dumps(receipt, sort_keys=True), encoding="utf-8")
    return 0 if result.wasSuccessful() and len(result.outcomes) == len(collected) else 1


if __name__ == "__main__":
    raise SystemExit(main())
