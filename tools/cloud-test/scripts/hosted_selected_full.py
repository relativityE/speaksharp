#!/usr/bin/env python3
"""One-attempt hosted invocation of the existing full journey stages.

This does not fetch secrets, provision accounts, dispatch Actions or select a
private transport. A separately reviewed caller must supply a pre-mounted
private store, its exact manifest digest and a durable-return selection. The
store must outlive the job; checking a directory cannot prove that property.
No public artifacts are uploaded. Every attempt leaves a pending reconciliation
marker, including failures; a subsequent attempt needs a new selected snapshot.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time


SCRIPTS = Path(__file__).resolve().parent
REPO = SCRIPTS.parents[2]
INPUTS = frozenset(("CT_CONFIG", "CT_REQUEST", "CT_HISTORY_INDEX", "CT_COUNTERS",
                    "CT_GAP_LEDGER", "CT_RECEIPTS_ROOT", "CT_RESERVATIONS",
                    "CT_FACTS_FILE", "CT_ACCOUNT_ID_FILE", "CT_OFFLINE_CHECKS"))
OPTIONAL = frozenset(("CT_APPROVAL", "CT_EVIDENCE_SCOPE_FILE"))
JOB = ("GITHUB_ACTIONS", "GITHUB_REPOSITORY", "GITHUB_RUN_ID",
       "GITHUB_RUN_ATTEMPT", "GITHUB_JOB", "GITHUB_SHA")
PRIVILEGED = frozenset(("SUPABASE_SERVICE_ROLE_KEY", "POSTHOG_PERSONAL_API_KEY"))
DRIVER_CREDENTIALS = frozenset(("THROWAWAY_TEST_EMAIL", "THROWAWAY_TEST_PASSWORD", "VITE_SUPABASE_ANON_KEY"))
PRODUCER_CASES = frozenset(("AHT-01", "AHT-02", "AHT-03", "AHT-07", "AHT-08"))
SHA = re.compile(r"[a-f0-9]{64}\Z")
SHA1 = re.compile(r"[a-f0-9]{40}\Z")


class Refused(Exception):
    """Only fixed, code-owned reasons may be printed publicly."""


class CleanupUnproven(Refused):
    """Collection must not overlap a possibly live owned process group."""


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_root(value):
    root = Path(value)
    require(root.is_absolute() and root.resolve() == root, "PRIVATE_ROOT_REQUIRED")
    s = root.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.getuid()
            and stat.S_IMODE(s.st_mode) == 0o700, "PRIVATE_ROOT_REQUIRED")
    return root


def inside(root, relative):
    require(isinstance(relative, str) and relative and not Path(relative).is_absolute()
            and all(p not in ("..", ".") for p in relative.split("/")), "INPUT_PATH_INVALID")
    p = root / relative
    require(p.resolve().is_relative_to(root) and p.resolve() == p,
            "INPUT_PATH_INVALID")
    return p


def file_bytes(path):
    s = path.lstat()
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.getuid()
            and not stat.S_IMODE(s.st_mode) & 0o077, "PRIVATE_FILE_REQUIRED")
    return path.read_bytes()


def inventory_digest(path):
    if path.is_file():
        return digest(file_bytes(path))
    require(path.is_dir() and not path.is_symlink(), "INPUT_PATH_INVALID")
    entries = []
    for p in sorted(path.rglob("*")):
        require(not p.is_symlink(), "INPUT_PATH_INVALID")
        if p.is_file():
            entries.append([p.relative_to(path).as_posix(), digest(file_bytes(p))])
    require(bool(entries), "INPUT_DIRECTORY_EMPTY")
    return digest(json.dumps(entries, separators=(",", ":")).encode())


def load_pinned(path, expected):
    require(isinstance(expected, str) and SHA.fullmatch(expected), "INPUT_PIN_REQUIRED")
    raw = file_bytes(path)
    require(digest(raw) == expected, "INPUT_DIGEST_DIFFERS")
    return json.loads(raw)


def stamp(value):
    require(isinstance(value, str) and value.endswith("Z"), "WINDOW_INVALID")
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


def prepare(root, manifest_sha, env, now):
    root = private_root(root)
    m = load_pinned(root / "hosted-inputs.json", manifest_sha)
    require(m.get("schema") == "speaksharp.hosted-selected-full.v1", "MANIFEST_INVALID")
    require(env.get("GITHUB_ACTIONS") == "true"
            and env.get("GITHUB_REPOSITORY") == "relativityE/speaksharp"
            and re.fullmatch(r"[0-9]+", env.get("GITHUB_RUN_ID", ""))
            and re.fullmatch(r"[0-9]+", env.get("GITHUB_RUN_ATTEMPT", ""))
            and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", env.get("GITHUB_JOB", ""))
            and SHA1.fullmatch(env.get("GITHUB_SHA", "")), "ACTUAL_GITHUB_JOB_REQUIRED")
    require(m.get("workflowSha") == env["GITHUB_SHA"], "WORKFLOW_SOURCE_DIFFERS")
    binding = m.get("privateDelivery") or {}
    require(binding.get("kind") == "pre-mounted-private-store"
            and binding.get("materializationSelectionRef")
            and binding.get("durableReturnSelectionRef"), "PRIVATE_DELIVERY_NOT_SELECTED")
    specs = m.get("inputs") or {}
    require(INPUTS <= specs.keys() and specs.keys() <= INPUTS | OPTIONAL, "INPUT_SET_DIFFERS")
    paths = {}
    for key, spec in specs.items():
        p = inside(root, spec["path"])
        require(p.is_dir() if key == "CT_RECEIPTS_ROOT" else p.is_file(), "INPUT_TYPE_DIFFERS")
        require(SHA.fullmatch(spec.get("sha256", ""))
                and inventory_digest(p) == spec["sha256"], "INPUT_DIGEST_DIFFERS")
        paths[key] = str(p)
    request = json.loads(file_bytes(Path(paths["CT_REQUEST"])))
    config = json.loads(file_bytes(Path(paths["CT_CONFIG"])))
    require(file_bytes(Path(paths["CT_CONFIG"])) == (SCRIPTS.parent / "config/test-config.v1.json").read_bytes(),
            "REVIEWED_CONFIG_DIFFERS")
    facts = json.loads(file_bytes(Path(paths["CT_FACTS_FILE"])))
    require(request.get("executionRuntime") == "GitHub Actions SpeakSharp"
            and request.get("sampleMode") == "full"
            and request.get("coverageMode") in ("full", "partial"), "FULL_JOURNEY_REQUEST_REQUIRED")
    run_id = request.get("runId", "")
    require(re.fullmatch(r"[A-Za-z0-9_-]{1,100}", run_id)
            and m.get("campaignId") == run_id, "CAMPAIGN_DIFFERS")
    selected = [x.get("case") for x in request.get("selection", [])]
    require(selected and len(selected) == len(set(selected))
            and all(x in {f"AHT-{i:02d}" for i in range(1, 16)} for x in selected), "SELECTION_INVALID")
    release = request.get("release", {}).get("testedSha", "")
    require(SHA1.fullmatch(release) and m.get("servedSha") == release, "RELEASE_DIFFERS")
    tested = m.get("testedCheckout") or {}
    tested_path = Path(tested.get("path", ""))
    require(tested_path.is_absolute() and tested_path.resolve() == tested_path,
            "TESTED_CHECKOUT_REQUIRED")
    def git(*args):
        return subprocess.run(["git", *args], cwd=tested_path, capture_output=True,
                              text=True, check=True).stdout.strip()
    require(git("rev-parse", "--show-toplevel") == str(tested_path)
            and git("rev-parse", "HEAD") == release == tested.get("head")
            and git("rev-parse", "HEAD^{tree}") == tested.get("tree")
            and not git("status", "--porcelain", "--untracked-files=all"),
            "TESTED_CHECKOUT_DIFFERS_OR_DIRTY")
    window = request.get("window") or {}
    require(stamp(window.get("startUtc")) <= now < stamp(window.get("endUtc")), "WINDOW_CLOSED")
    require(request.get("selectionApprovalRef") == m.get("selectionApprovalRef")
            and bool(m.get("selectionApprovalRef")) and facts.get("ownerApprovalReference")
            and facts.get("approvedBy") and facts.get("reviewer"), "SELECTION_BINDING_REQUIRED")
    state = load_pinned(root / "continuity.json", m.get("continuitySha256"))
    require(state.get("schema") == "speaksharp.hosted-continuity.v1"
            and state.get("reconciled") is True and state.get("reconciliationRef")
            and state.get("nextCampaignId") == run_id
            and state.get("accountSha256") == specs["CT_ACCOUNT_ID_FILE"]["sha256"]
            and state.get("countersSha256") == specs["CT_COUNTERS"]["sha256"]
            and state.get("reservationsSha256") == specs["CT_RESERVATIONS"]["sha256"]
            and state.get("historyIndexSha256") == specs["CT_HISTORY_INDEX"]["sha256"],
            "CUMULATIVE_CONTINUITY_REQUIRED")
    if PRODUCER_CASES.intersection(selected):
        require("CT_EVIDENCE_SCOPE_FILE" in paths, "PRODUCER_SCOPE_REQUIRED")
        socket = root / ("attempt-" + run_id) / "plan/evidence.sock"
        require(len(os.fsencode(socket)) <= 100, "PRODUCER_SOCKET_PATH_TOO_LONG")
    if request.get("priority") == "nightly-regression":
        require("CT_APPROVAL" in paths, "RECURRING_APPROVAL_REQUIRED")
    require(not (root / "pending-reconciliation.json").exists(), "PREVIOUS_ATTEMPT_UNRECONCILED")
    paths["CT_CHECKOUT"] = str(tested_path)
    return m, paths, request, config


def write_new(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(value, f, sort_keys=True)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    directory = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def child_environment(stage, config, env, paths, out, request):
    result = {key: env[key] for key in ("PATH", "HOME", "LANG", *JOB) if key in env}
    names = config["credentials"]["runEnvironment"]
    credential_stage = "build-plan" if stage == "build-plan-with-receipt" else stage
    for key in names["stages"][credential_stage]:
        require(key in names["names"] and key not in config["credentials"]["forbidden"]
                and key in DRIVER_CREDENTIALS, "CREDENTIAL_STAGE_INVALID")
        require(bool(env.get(key)), "STAGE_CREDENTIAL_UNAVAILABLE")
        result[key] = env[key]
    for key in ("CT_CHROME", "CT_EXISTING_DEPENDENCY_ROOT", "CT_EXISTING_PDFJS_DIR"):
        require(bool(env.get(key)), "EXISTING_TOOLS_REQUIRED")
        result[key] = env[key]
    result.update(paths, CT_OUT=str(out),
                  CT_SOURCE_SHA=request["release"]["testedSha"],
                  CT_EXECUTION_RUN_ID=request["runId"], CT_SETUP_MODE="existing-only")
    if "CT_EVIDENCE_SCOPE_FILE" in paths:
        result["CT_EVIDENCE_SCOPE_SHA256"] = digest(file_bytes(Path(paths["CT_EVIDENCE_SCOPE_FILE"])))
    if stage == "run" and PRODUCER_CASES.intersection(x["case"] for x in request["selection"]):
        for key in (*PRIVILEGED, "SUPABASE_URL", "POSTHOG_PROJECT_ID", "POSTHOG_API_HOST"):
            if env.get(key):
                result[key] = env[key]
        require(bool(result.get("SUPABASE_SERVICE_ROLE_KEY")), "PRODUCER_CREDENTIAL_UNAVAILABLE")
    return result


def group_alive(pgid):
    # Darwin can refuse signal0 inspection after the leader exits. Read process
    # metadata instead: never equate an EPERM, failed/empty listing or malformed
    # row with an empty group. No process arguments or private values are read.
    try:
        result = subprocess.run(["/bin/ps", "-e", "-o", "pid=,pgid=,stat="],
                                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
                                capture_output=True, text=True, timeout=2)
        if result.returncode != 0 or len(result.stdout) > 2097152:
            raise ValueError()
        rows = []
        for line in result.stdout.splitlines():
            values = line.split()
            if len(values) != 3 or not values[0].isdigit() or not values[1].isdigit() \
                    or not re.fullmatch(r"[A-Za-z+<>NsLslEWIURDTZCX?]+", values[2]):
                raise ValueError()
            rows.append((int(values[0]), int(values[1])))
        if not any(pid == os.getpid() for pid, _ in rows):
            raise ValueError()
        return any(group == pgid for _, group in rows)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        raise CleanupUnproven("OWNED_GROUP_INSPECTION_DENIED") from None


def wait_group_gone(pgid, seconds):
    deadline = time.monotonic() + seconds
    while group_alive(pgid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.01)
    return True


def stop_owned_group(child, grace=5):
    # A Bash leader exiting does not mean its Node/browser descendants exited.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    if not wait_group_gone(child.pid, grace):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        child.wait(timeout=2)
    except subprocess.TimeoutExpired:
        raise CleanupUnproven("OWNED_LEADER_REAP_UNPROVEN") from None
    if not wait_group_gone(child.pid, 2):
        raise CleanupUnproven("OWNED_GROUP_STILL_PRESENT_AFTER_KILL")


def invoke_stage(stage, env, out, timeout):
    # Fixed executable and argument vector. No command or transport from input JSON.
    with open(out / (stage + ".log"), "xb") as log:
        os.chmod(log.name, 0o600)
        child = subprocess.Popen(["bash", str(SCRIPTS / "execute_run.sh"), stage],
                                 cwd=REPO, env=env, stdout=log, stderr=log, start_new_session=True)
        previous = {}

        def interrupted(_signum, _frame):
            stop_owned_group(child)
            raise Refused("HOSTED_STAGE_INTERRUPTED")

        try:
            for signum in (signal.SIGTERM, signal.SIGINT):
                previous[signum] = signal.signal(signum, interrupted)
            code = child.wait(timeout=timeout)
            if not wait_group_gone(child.pid, 0.1):
                stop_owned_group(child)
                return 78  # forced descendant cleanup cannot turn a stage green
            return code
        except subprocess.TimeoutExpired:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            if not wait_group_gone(child.pid, 2):
                raise CleanupUnproven("OWNED_GROUP_STILL_PRESENT_AFTER_KILL")
            return 124
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)


def execute(root, manifest_sha, env=None, now=None, run_stage=None):
    env = dict(os.environ if env is None else env)
    now = now or (lambda: dt.datetime.now(dt.timezone.utc).timestamp())
    require(not any(env.get(key) for key in ("SUPABASE_SECRET_KEY", "STRIPE_SECRET_KEY")),
            "FORBIDDEN_CREDENTIAL_PRESENT")
    root = private_root(root)
    # One persistent store lock across run IDs, not just a workflow concurrency label.
    fd = os.open(root / "hosted.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "r+") as lock:
        st = os.fstat(lock.fileno())
        require(stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid()
                and stat.S_IMODE(st.st_mode) == 0o600, "PRIVATE_LOCK_REQUIRED")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused("PRIVATE_STORE_IN_USE") from None
        manifest, paths, request, config = prepare(root, manifest_sha, env, now())
        actual = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO,
                                capture_output=True, text=True, check=True).stdout.strip()
        require(actual == env["GITHUB_SHA"], "CHECKOUT_SOURCE_DIFFERS")
        out = root / ("attempt-" + request["runId"])
        require(not out.exists(), "ATTEMPT_ALREADY_EXISTS")
        out.mkdir(mode=0o700)
        write_new(root / "pending-reconciliation.json", {
            "schema": "speaksharp.hosted-pending.v1", "campaignId": request["runId"],
            "inputManifestSha256": manifest_sha, "githubRunId": env["GITHUB_RUN_ID"],
            "githubRunAttempt": env["GITHUB_RUN_ATTEMPT"], "githubJob": env["GITHUB_JOB"],
            "priorContinuitySha256": manifest["continuitySha256"],
            "disposition": "CONSUMED_REQUIRES_RECONCILIATION_EVEN_IF_REFUSED"})
        stages = ["install-tools", "build-plan", "stimulus-preflight", "build-plan-with-receipt", "gate-and-validate"]
        if request.get("priority") == "nightly-regression":
            stages.append("reserve")
        stages.append("run")
        results = []
        execute_child = run_stage or invoke_stage
        cleanup_safe = True
        try:
            for stage in stages:
                remaining = stamp(request["window"]["endUtc"]) - now()
                require(remaining > 0, "WINDOW_CLOSED")
                child_env = child_environment(stage, config, env, paths, out, request)
                result = {"stage": stage, "exit": None}
                results.append(result)
                code = execute_child(stage, child_env, out, remaining)
                result["exit"] = code
                if code != 0:
                    break
        except CleanupUnproven:
            cleanup_safe = False
            raise
        finally:
            # Collect on an attempted run even when it fails; never replace its exit
            # with collect's success, and never label an absent usage log as zero.
            if any(x["stage"] == "run" for x in results) and cleanup_safe:
                try:
                    code = execute_child("collect", child_environment("collect", config, env, paths, out, request), out, 60)
                    results.append({"stage": "collect", "exit": code})
                except Exception:
                    results.append({"stage": "collect", "exit": 78})
            write_new(out / "entrypoint-receipt.json", {
                "kind": "hosted-invocation-not-journey-verdict", "stages": results,
                "inputManifestSha256": manifest_sha, "requiresReconciliation": True,
                "collectionSuppressedForUnprovenGroupCleanup": not cleanup_safe,
                "usage": "READ_ACTUAL_GUARD_LEDGERS_OR_UNKNOWN_NEVER_DEFAULT_ZERO",
                "cleanup": "READ_ACTUAL_PROCESS_RECEIPTS_NOT_INFERRED_FROM_EXIT"})
        return 0 if results and results[-1]["stage"] == "collect" and all(x["exit"] == 0 for x in results) else 78


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-store", required=True)
    parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args()
    try:
        code = execute(args.private_store, args.manifest_sha256)
        print("INVOCATION_COMPLETE_RECONCILIATION_REQUIRED" if code == 0 else "NOT_RUN_OR_INCOMPLETE")
        return code
    except Refused as error:
        print("NOT_RUN: " + str(error))
        return 78
    except Exception:
        print("NOT_RUN: HOSTED_INPUT_OR_EXECUTION_REFUSED")
        return 78


if __name__ == "__main__":
    sys.exit(main())
