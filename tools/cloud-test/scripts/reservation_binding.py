"""The reservation binding a manual run executes under (Sam 1794113504 / 1794114759): produced ONCE by init_run_inputs.prepare from the
validated state-ref chain and the exact manual own reserve, written privately (0600, O_EXCL), with its digest exported through the init step's
environment file. Consumers (run_env.py, harness-adapter/build_plan.py) check the digest, the shape, and the fields they CAN bind to independent inputs: the
admitted request digest, the campaign, the execution run id and attempt, the reconciliation checkpoint's head, the tested release and the
harness source. They CANNOT prove the allocation or reserve-event digests: a private replacement keeping the real parent passes here (Sam
RETURN 1794116817). That authority is reservation_runtime_check, which recomputes them from the authenticated journal in the run stage.
Offline; never touches the network or the journal."""
import hashlib
import json
import os
import re
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: verification never needs the network)

SCHEMA = "speaksharp.cloud-test.reservation-binding.v1"
KEYS = {"schema", "campaignId", "runId", "attempt", "requestSha256", "journalRootSha", "reconciliationHeadSha", "journalHeadSha",
        "reserveEventSha256", "allocationSha256", "identityReads", "harnessSourceSha", "testedSha"}
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
RUN = re.compile(r"^[1-9][0-9]{0,19}$")


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def verify(path, expected_sha256, *, request_sha256, campaign_id, run_id, attempt, reconciliation_head, configured_max=None, tested_sha=None,
           harness_source_sha=None):
    """The verified binding document, or a refusal. `run_id`/`attempt` are the EXECUTION identity; `reconciliation_head` is the headSha of the
    byte-checked reconciliation checkpoint; `configured_max` (the plan's identityCap) must not exceed the reserved identity reads."""
    _need(isinstance(path, str) and os.path.isabs(path) and os.path.realpath(path) == path, "reservation-binding-path")
    st = os.lstat(path)
    _need(stat.S_ISREG(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_mode & 0o077 == 0 and st.st_size <= 4096, "reservation-binding-file")
    with open(path, "rb") as f:
        raw = f.read()
    _need(isinstance(expected_sha256, str) and SHA64.match(expected_sha256) and hashlib.sha256(raw).hexdigest() == expected_sha256,
          "reservation-binding-digest")
    try:
        doc = json.loads(raw)
    except ValueError:
        raise Refused("reservation-binding-shape")
    _need(isinstance(doc, dict) and set(doc) == KEYS and doc["schema"] == SCHEMA, "reservation-binding-shape")
    _need(all(isinstance(doc[k], str) and SHA40.match(doc[k]) for k in ("journalRootSha", "reconciliationHeadSha", "journalHeadSha",
                                                                        "harnessSourceSha", "testedSha"))
          and all(isinstance(doc[k], str) and SHA64.match(doc[k]) for k in ("requestSha256", "reserveEventSha256", "allocationSha256"))
          and doc["journalHeadSha"] != doc["reconciliationHeadSha"], "reservation-binding-shape")
    _need(type(doc["identityReads"]) is int and doc["identityReads"] >= 0, "reservation-binding-allocation")
    _need(doc["requestSha256"] == request_sha256, "reservation-binding-request")
    _need(doc["campaignId"] == campaign_id, "reservation-binding-campaign")
    _need(isinstance(doc["runId"], str) and RUN.match(doc["runId"]) and doc["runId"] == str(run_id) and doc["attempt"] == attempt
          and type(doc["attempt"]) is int, "reservation-binding-execution")
    _need(doc["reconciliationHeadSha"] == reconciliation_head, "reservation-binding-journal")
    # Sam RETURN 1794116817: these are bound to independent inputs when the caller has them; the allocation itself is proven only by
    # reservation_runtime_check against the authenticated journal (a copied parent/head with an altered allocation passes this function).
    if tested_sha is not None:
        _need(doc["testedSha"] == tested_sha, "reservation-binding-tested-release")
    if harness_source_sha is not None:
        _need(doc["harnessSourceSha"] == harness_source_sha, "reservation-binding-harness-source")
    if configured_max is not None:
        _need(type(configured_max) is int and configured_max <= doc["identityReads"], "reservation-binding-insufficient")
    return doc
