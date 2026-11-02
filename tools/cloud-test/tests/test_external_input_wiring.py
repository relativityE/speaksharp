"""Receiving boundaries: named retained inputs reach the existing validators.

These are offline CLI-wiring controls, not live admission or validator-result proof.
They stop the pipeline before reporting and never mint a usable run approval.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


SOURCE = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, SOURCE / "scripts" / (name + ".py"))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class ObservedGate(Exception):
    pass


class ExternalInputWiring(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="ct-input-wiring-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.paths = {}
        for name, data in {
            "config": {"history": {"index": {"file": "MUST-NOT-USE-DEFAULT-INDEX"}},
                       "nightly": {"approvalFile": "MUST-NOT-USE-DEFAULT-APPROVAL",
                                   "reservationsFile": "MUST-NOT-USE-DEFAULT-RESERVATIONS"},
                       "credentials": {"runEnvironment": {"names": []}, "forbidden": []}},
            "request": {"estimate": {"requests": {"runCap": 2}, "identityReads": 1}},
            "ledger": {}, "workflow": {}, "release-verification": {},
            "reconciliation": {}, "history-index": {"entries": []},
            "counters": {"synthetic": True}, "reservations": {"reservations": []},
            "approval": {"synthetic": True, "approvedBy": None},
        }.items():
            path = self.root / ("external " + name + ".json")
            path.write_text(json.dumps(data), encoding="utf-8")
            self.paths[name] = str(path)
        self.paths["receipts-root"] = str(self.root / "external receipts")
        Path(self.paths["receipts-root"]).mkdir()

    def args(self, names):
        return [part for name in names for part in ("--" + name, self.paths[name])]

    def test_pipeline_forwards_each_explicit_input_to_its_existing_consumer(self):
        pipeline = module("pipeline")
        calls = []

        def record(script, *args, **_kwargs):
            calls.append((script, args))
            if script == "check_gates.py":
                raise ObservedGate()
            return type("Completed", (), {"returncode": 0})()

        argv = ["pipeline.py", *self.args(("config", "request", "ledger", "workflow",
                                         "history-index", "counters", "approval",
                                         "reservations", "receipts-root")),
                "--out-dir", str(self.root / "new output")]
        with mock.patch.object(sys, "argv", argv), mock.patch.object(pipeline, "run", side_effect=record):
            with self.assertRaises(ObservedGate):
                pipeline.main()
        consumers = dict(calls)
        for consumer, options in {
            "verify_receipts.py": {"--root": "receipts-root", "--config": "config"},
            "history_index.py": {"--index": "history-index", "--receipts-root": "receipts-root"},
            "verify_catalog_history.py": {"--index": "history-index"},
            "reconcile_cumulative.py": {"--counters": "counters", "--receipts-root": "receipts-root"},
            "check_gates.py": {"--approval": "approval", "--history-index": "history-index",
                               "--reservations": "reservations", "--receipts-root": "receipts-root",
                               "--ledger": "ledger", "--config": "config"},
        }.items():
            for flag, name in options.items():
                with self.subTest(consumer=consumer, flag=flag):
                    args = consumers[consumer]
                    self.assertIn(flag, args)
                    self.assertEqual(args[args.index(flag) + 1], self.paths[name])

    def gate_args(self):
        return ["check_gates.py", *self.args(("request", "config", "ledger", "workflow",
                                              "release-verification", "reconciliation",
                                              "history-index", "reservations", "receipts-root", "approval")),
                "--base", str(self.root), "--out", str(self.root / "gate.json")]

    def test_gate_cli_forwards_external_receipts_index_reservations_and_approval(self):
        gates = module("check_gates")
        result = {"decision": "NO-GO", "blockingOpen": ["SYNTHETIC-NOT-AUTHORITY"]}
        with mock.patch.object(sys, "argv", self.gate_args()), \
                mock.patch.object(gates, "evaluate", return_value=result) as evaluate, \
                contextlib.redirect_stdout(io.StringIO()):
            gates.main()
        args = evaluate.call_args.args
        self.assertEqual(args[12], self.paths["receipts-root"])
        self.assertEqual(args[13], {"entries": []})
        self.assertEqual(args[14], {"reservations": []})
        self.assertEqual(args[15], self.paths["approval"])

    def test_missing_named_index_or_reservations_cannot_fall_back_to_none(self):
        gates = module("check_gates")
        for name in ("history-index", "reservations"):
            with self.subTest(name=name):
                original = self.paths[name]
                self.paths[name] = str(self.root / ("missing-" + name))
                try:
                    with mock.patch.object(sys, "argv", self.gate_args()), \
                            mock.patch.object(gates, "evaluate") as evaluate:
                        with self.assertRaises(FileNotFoundError):
                            gates.main()
                        evaluate.assert_not_called()
                finally:
                    self.paths[name] = original

    def test_recurring_cli_refuses_each_omitted_external_input(self):
        gates = module("check_gates")
        Path(self.paths["request"]).write_text(json.dumps({"priority": "nightly-regression"}))
        for name in ("history-index", "reservations", "approval"):
            with self.subTest(name=name):
                argv = self.gate_args()
                offset = argv.index("--" + name)
                del argv[offset:offset + 2]
                with mock.patch.object(sys, "argv", argv), mock.patch.object(gates, "evaluate") as evaluate, \
                        contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as error:
                        gates.main()
                    self.assertEqual(error.exception.code, 2)
                    evaluate.assert_not_called()

    def test_actual_recurring_gate_refuses_missing_external_approval(self):
        gates = module("check_gates")
        result = gates.recurring_gate({"priority": "nightly-regression"},
                                      {"nightly": {"approvalFile": "local-decoy.json"}},
                                      str(self.root), {}, None,
                                      approval_path=str(self.root / "missing-approval.json"))
        self.assertEqual(result["status"], "NOT-READY")
        self.assertIn("missing", result["detail"])


if __name__ == "__main__":
    unittest.main()
