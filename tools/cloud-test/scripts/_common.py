"""Shared helpers for the cloud-test package. Python 3 standard library only; no network."""
import datetime
import os as _os
import sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import _netguard  # noqa: F401  (offline control plane: every network call fails and is counted)
import hashlib
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def dump(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, sort_keys=False)
        f.write("\n")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def parse_utc(value):
    if value in (None, ""):
        return None
    try:
        return datetime.datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(datetime.timezone.utc)
    except ValueError:
        return None


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def is_hex64(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def is_sha40(value):
    return isinstance(value, str) and len(value) == 40 and all(c in "0123456789abcdef" for c in value)


def words(text):
    return len(str(text).split())


def fail(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def ep_requirements(ep):
    """The executable expected-PASS requirements of a gap: a list of {case, assertions}. Every listed case is required."""
    return list(ep.get("requirements") or [])


def ep_cases(ep):
    return [r["case"] for r in ep_requirements(ep)]


def ep_text(ep):
    return "; ".join("%s: %s" % (r["case"], ", ".join(r["assertions"])) for r in ep_requirements(ep))


def request_mode(req):
    """The coverage mode named by the request. There is no default: a request without one is invalid."""
    return req.get("coverageMode")


def mode_limits(cfg, req):
    """The effective limits for the request's mode: the global limits with the mode's own limits laid over them. Partial and full never share a limit."""
    base = {k: v for k, v in cfg["limits"].items()}
    m = (cfg.get("modes") or {}).get(request_mode(req) or "partial") or {}
    base.update({k: v for k, v in (m.get("limits") or {}).items() if k != "note"})
    return base
