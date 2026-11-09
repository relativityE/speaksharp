#!/usr/bin/env python3
"""Has every process of the elevated run stage stopped? (bounded ownership recovery only after all children stop.)

execute_run.sh run-as-root returns the run-owned trees to the job user from its TERM/INT traps and on normal exit. A trap cannot run on
SIGKILL, and a TERM the stage ignores is followed by KILL, so the trees can stay root-owned while later job steps run as the job user.
`execute_run.sh recover-as-root` returns them only after this check says no stage process remains. A root-owned recursive ownership change
while a stage process can still write into the tree is exactly what must not happen, so this check fails closed: anything it cannot read
counts as remaining.

A process counts as a stage process when any of these is true:
  - its effective uid is the browser uid that chrome-wrapper.sh setpriv's every launch to (a detached, re-sessioned Chrome is found here);
  - its argv runs execute_run.sh with the stage `run` or `run-as-root` (the stage shells, including an orphan of a killed parent);
  - an argv element names a path inside a run-owned tree (the harness processes take their plan, ledgers and outputs as arguments);
  - its cwd, root, executable or any open descriptor resolves inside a run-owned tree.
This process and its own ancestors (the recovery chain) are excluded. Linux /proc only; the proc root is an argument so the decision is
tested offline on a synthetic proc tree. Output is one closed line, never a pid, path, argument or user content. No signal is ever sent."""
import argparse
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: no network)

BROWSER_UID = 65534          # harness/bundle/harness/chrome-wrapper.sh RUNAS (pinned by test)
MAX_WAIT_SECONDS = 120
STAGES = ("run", "run-as-root")


class Unreadable(Exception):
    pass


def _read(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    except OSError:
        raise Unreadable()


def _status(proc, pid):
    raw = _read(os.path.join(proc, pid, "status"))
    if raw is None:
        return None
    fields = {}
    for line in raw.decode("utf-8", "replace").splitlines():
        key, _, value = line.partition(":")
        fields[key] = value.split()
    try:
        return {"ppid": fields["PPid"][0], "euid": int(fields["Uid"][1])}
    except (KeyError, IndexError, ValueError):
        raise Unreadable()


def _links(proc, pid):
    base = os.path.join(proc, pid)
    names = ["cwd", "root", "exe"]
    try:
        names += [os.path.join("fd", n) for n in os.listdir(os.path.join(base, "fd"))]
    except (FileNotFoundError, ProcessLookupError):
        return None
    except OSError:
        raise Unreadable()
    out = []
    for name in names:
        try:
            out.append(os.readlink(os.path.join(base, name)))
        except (FileNotFoundError, ProcessLookupError):
            continue
        except OSError:
            if name in ("root", "exe"):
                continue          # a kernel thread has none; the cwd and descriptors still decide
            raise Unreadable()
    return out


def inside(path, trees):
    path = re.sub(r" \(deleted\)$", "", path)
    return any(path == t or path.startswith(t + "/") for t in trees)


def names_a_tree(arg, trees):
    return any(re.search(re.escape(t) + r"(?:/|$|[^A-Za-z0-9._-])", arg) for t in trees)


def runs_stage(argv):
    return any((a == "execute_run.sh" or a.endswith("/execute_run.sh")) and argv[i + 1] in STAGES for i, a in enumerate(argv[:-1]))


def ancestors(proc, pid):
    chain, seen = set(), 0
    while pid not in ("0", "") and pid not in chain and seen < 4096:
        chain.add(pid)
        seen += 1
        try:
            st = _status(proc, pid)
        except Unreadable:
            break
        if st is None:
            break
        pid = st["ppid"]
    return chain


def remaining(proc, trees, browser_uid, exclude):
    """The number of stage processes still present (an unreadable process counts)."""
    count = 0
    for pid in os.listdir(proc):
        if not pid.isdigit() or pid in exclude:
            continue
        try:
            st = _status(proc, pid)
            if st is None:
                continue
            raw = _read(os.path.join(proc, pid, "cmdline"))
            if raw is None:
                continue
            argv = [a.decode("utf-8", "replace") for a in raw.split(b"\0") if a]
            if st["euid"] == browser_uid or runs_stage(argv) or any(names_a_tree(a, trees) for a in argv):
                count += 1
                continue
            links = _links(proc, pid)
            if links is not None and any(inside(link, trees) for link in links):
                count += 1
        except Unreadable:
            count += 1
    return count


def main(argv):
    a = argparse.ArgumentParser()
    a.add_argument("--tree", action="append", required=True)
    a.add_argument("--wait-seconds", type=int, required=True)
    a.add_argument("--browser-uid", type=int, default=BROWSER_UID)
    a.add_argument("--proc-root", default="/proc")
    a.add_argument("--self-pid", default=str(os.getpid()))
    x = a.parse_args(argv[1:])
    trees = x.tree
    if not (0 <= x.wait_seconds <= MAX_WAIT_SECONDS) or any(not t.startswith("/") or t.endswith("/") or t != os.path.normpath(t) for t in trees):
        print("BLOCKED_SETUP: run-stage-quiescence-arguments", file=sys.stderr)
        return 78
    if not os.path.isdir(x.proc_root):
        print("BLOCKED_SETUP: run-stage-quiescence-proc-unavailable", file=sys.stderr)
        return 78
    exclude = ancestors(x.proc_root, x.self_pid)
    deadline = time.monotonic() + x.wait_seconds
    while True:
        if remaining(x.proc_root, trees, x.browser_uid, exclude) == 0:
            print("run stage quiescent")
            return 0
        if time.monotonic() >= deadline:
            print("BLOCKED_SETUP: run-stage-processes-remain", file=sys.stderr)
            return 78
        time.sleep(1)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
