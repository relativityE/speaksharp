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


def comparison_errors(value, labels):
    """Return structural/provenance errors for a retained run comparison.

    The retained-input route consumes the same comparison shape as the summary
    and report builders.  A header containing only two labels is not evidence:
    the generator identity, validity analysis, denominators and all fifteen
    journey rows must be present and internally consistent.
    """
    errors = []
    if not isinstance(value, dict) or value.get("schema") != "speaksharp.run-comparison.v1":
        return ["comparison schema is not speaksharp.run-comparison.v1"]
    generator = value.get("generator") or {}
    if generator.get("name") != "build_run_report.py" or not isinstance(generator.get("version"), str):
        errors.append("comparison generator provenance is missing")
    sides = [((value.get("previous") or {}).get("label")), ((value.get("current") or {}).get("label"))]
    if sides != list(labels):
        errors.append("comparison labels differ from the configured baselines")
    for side in ("previous", "current"):
        row = value.get(side) or {}
        if not is_sha40(row.get("servedSha")) or not is_sha40(row.get("sourceSha")):
            errors.append("comparison %s release identity is missing" % side)
        # The existing producer deliberately records unavailable historical
        # identities as null.  Preserve that honest contract: every identity
        # field must exist, and every value that was observed must be a digest.
        for key in ("codeManifestSha256", "stepManifestSha256", "admissionConfigSha256", "planSha256", "policySha256"):
            if key not in row or (row[key] is not None and not is_hex64(row[key])):
                errors.append("comparison %s %s is malformed" % (side, key))
    validity = value.get("validity") or {}
    if not isinstance(validity.get("verdict"), str) or not isinstance(validity.get("statement"), str) or \
            not isinstance(validity.get("factors"), list) or not validity.get("factors") or not isinstance(validity.get("problems"), list):
        errors.append("comparison validity analysis is incomplete")
    permitted = {"improved", "regressed", "unchanged", "inconclusive", "no-signal"}
    journeys = value.get("journeys")
    ids = [j.get("id") for j in journeys] if isinstance(journeys, list) and all(isinstance(j, dict) for j in journeys) else []
    expected_ids = ["AHT-%02d" % n for n in range(1, 16)]
    if ids != expected_ids:
        errors.append("comparison does not contain the ordered fifteen journeys")
    elif any(j.get("prev") not in ("PASS", "FAIL", "NOT RUN") or
             j.get("cur") not in ("PASS", "FAIL", "NOT RUN") or j.get("class") not in permitted
             for j in journeys):
        errors.append("comparison journey verdicts are invalid")
    areas = value.get("areas")
    if not isinstance(areas, list) or len(areas) != 7 or len({a.get("id") for a in areas if isinstance(a, dict)}) != 7:
        errors.append("comparison does not contain seven product areas")
    rows = value.get("rows")
    if not isinstance(rows, list) or not rows or any(not isinstance(r, dict) or not r.get("id") or not r.get("case") for r in rows):
        errors.append("comparison assertion rows are missing")
    requirements = value.get("requirement_rows")
    if not isinstance(requirements, list) or not requirements:
        errors.append("comparison requirement rows are missing")
    denominators = value.get("denominators") or {}
    for name in ("requirements", "journeys", "assertions"):
        block = denominators.get(name) or {}
        total = block.get("total")
        if type(total) is not int or total < 1:
            errors.append("comparison %s denominator is missing" % name)
            continue
        for side in ("previous", "current"):
            counts = block.get(side) or {}
            if any(type(counts.get(k)) is not int or counts.get(k) < 0 for k in ("PASS", "FAIL", "NOT RUN")) or \
                    sum(counts.get(k, 0) for k in ("PASS", "FAIL", "NOT RUN")) != total:
                errors.append("comparison %s %s denominator is inconsistent" % (name, side))
    identity = value.get("identity_binding") or {}
    if not isinstance(identity.get("previous"), dict) or not isinstance(identity.get("current"), dict):
        errors.append("comparison identity provenance is missing")
    if not isinstance(value.get("headline"), str) or not value.get("headline").strip():
        errors.append("comparison headline is missing")
    return errors
