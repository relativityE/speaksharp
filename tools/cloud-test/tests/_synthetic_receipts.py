"""Synthetic fixture sealing through the real sealer; never a live-run approval."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest import mock

SOURCE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SOURCE / "scripts"))
import seal_receipts  # noqa: E402


def seal_synthetic(source, destination, label):
    """Seal already generated data into a NEW fixture directory and return its real pin.

    Missing plan/approval fixtures are explicit non-authority records. They are enough
    for a seal-integrity test, never enough to pass runtime admission or select a run.
    """
    source, destination = Path(source), Path(destination)
    with tempfile.TemporaryDirectory(prefix="ct-synthetic-seal-") as directory:
        staged = Path(directory) / "raw"
        shutil.copytree(source, staged)
        defaults = {
            "campaign-plan.json": {"synthetic": True, "campaignId": label,
                                   "scope": "OFFLINE FIXTURE ONLY", "cases": []},
            "security-approval.json": {"synthetic": True, "approvedBy": None,
                                       "approvalRef": None, "scope": "NO LIVE AUTHORITY"},
        }
        for name, value in defaults.items():
            path = staged / name
            if not path.exists():
                path.write_text(json.dumps(value) + "\n", encoding="utf-8")
        argv = ["seal_receipts.py", "--label", label, "--out", str(destination),
                "--case-results", str(staged / "case-results.json"),
                "--campaign-plan", str(staged / "campaign-plan.json"),
                "--security-approval", str(staged / "security-approval.json"),
                "--campaign-ledger", str(staged / "campaign-ledger.json"),
                "--identity-ledger", str(staged / "identity-ledger.json"),
                "--cases-dir", str(staged), "--provenance", "SYNTHETIC offline fixture; NO LIVE AUTHORITY"]
        with mock.patch.object(sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()):
            seal_receipts.main()
    return hashlib.sha256((destination / "RECEIPTS.sha256").read_bytes()).hexdigest()


def seal_in_place(source, label):
    """Replace a fixture's generated raw tree by the actual sealer's output."""
    source = Path(source)
    with tempfile.TemporaryDirectory(prefix="ct-synthetic-output-") as directory:
        sealed = Path(directory) / "sealed"
        pin = seal_synthetic(source, sealed, label)
        # Only the newly generated, caller-owned fixture path is replaced.
        for root, _dirs, files in os.walk(source):
            for name in files:
                os.chmod(os.path.join(root, name), 0o600)
        shutil.rmtree(source)
        shutil.copytree(sealed, source)
        # Negative controls deliberately mutate their own synthetic data; validation
        # still compares those bytes with the original pin and must reject changes.
        for root, _dirs, files in os.walk(source):
            for name in files:
                os.chmod(os.path.join(root, name), 0o600)
    return pin
