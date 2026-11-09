"""Create-only preparation of the approved private-media parent before admission (A6).

R10 run 42318728005 stopped in A6 at S12 (fake microphone) with ENOENT: media-private.cjs (createPrivateMedia, cross-UID branch) requires
the plan's `privateMediaParent` to ALREADY exist as a root-owned, canonical, non-symlink directory that is not group/other writable and
is traversable by UID/GID 65534, and it never creates it. Nothing provisioned it on the hosted runner. This prepares exactly that
directory, as specified:

  * the parent is the retained plan's own `privateMediaParent`, and it must equal the expected value (CT_MEDIA_PARENT or the default the
    plan builder used), so a different directory is never prepared;
  * every ancestor is verified first (root-owned, non-symlink directory, traversable; group/other writable only when sticky);
  * create-only: a single mkdir(0711); no check-then-install, no chmod, no chown, no recursion;
  * an existing node (or a creation race) is admitted only after the same lstat/realpath/owner/mode validation, and is never modified;
  * a newly created node is re-opened with O_NOFOLLOW|O_DIRECTORY and its identity, owner and mode verified before admission.

Exit 0 prints a content-free result; any refusal is BLOCKED_SETUP (exit 78). An existing node is never modified. A refusal after a
successful create (e.g. the post-create open or verification fails) may leave the new empty 0711 directory in place; it is not removed.
"""
import argparse
import os
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _netguard  # noqa: F401,E402  (offline: preparing a local directory never needs the network)

DEFAULT_PARENT = "/var/tmp/ss-media-cloud-test"
MODE = 0o711


class Refused(ValueError):
    pass


def _need(ok, code):
    if not ok:
        raise Refused(code)


def _secure_dir(st, owner_uid):
    """The media-private.cjs contract: a directory owned by `owner_uid`, not group/other writable, traversable by others (65534)."""
    return (stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode) and st.st_uid == owner_uid
            and (st.st_mode & 0o022) == 0 and (st.st_mode & 0o001) != 0)


def _check_ancestors(parent, owner_uid, trusted_root="/"):
    """Every ancestor below `trusted_root` (always "/" in production) must be a root- (or owner-) owned, non-symlink, canonical,
    traversable directory, writable by group/other only when sticky (as /var/tmp is)."""
    current = "/"
    for part in parent.strip("/").split("/")[:-1]:
        current = os.path.join(current, part)
        if trusted_root != "/" and not current.startswith(trusted_root.rstrip("/") + "/"):
            continue
        st = os.lstat(current)
        _need(stat.S_ISDIR(st.st_mode) and not stat.S_ISLNK(st.st_mode), "media-parent-ancestor-not-directory")
        _need(st.st_uid in (0, owner_uid), "media-parent-ancestor-owner")
        _need((st.st_mode & 0o001) != 0, "media-parent-ancestor-not-traversable")
        _need((st.st_mode & 0o022) == 0 or (st.st_mode & stat.S_ISVTX) != 0, "media-parent-ancestor-writable")
        _need(os.path.realpath(current) == current, "media-parent-ancestor-not-canonical")


def _validate_existing(parent, owner_uid):
    st = os.lstat(parent)
    _need(not stat.S_ISLNK(st.st_mode), "media-parent-symlink")
    _need(stat.S_ISDIR(st.st_mode), "media-parent-not-directory")
    _need(st.st_uid == owner_uid, "media-parent-owner")
    _need((st.st_mode & 0o022) == 0, "media-parent-writable")
    _need((st.st_mode & 0o001) != 0, "media-parent-not-traversable")
    _need(os.path.realpath(parent) == parent, "media-parent-not-canonical")
    return st


def prepare(parent, expected, owner_uid=0, trusted_root="/"):
    """Returns 'created' or 'existing'. Production: owner_uid 0, trusted_root "/". Offline tests bind the test user's UID and their
    temporary directory as trusted_root (its own ancestors are outside the test's control)."""
    _need(isinstance(parent, str) and parent == expected, "media-parent-not-the-plan")
    _need(os.path.isabs(parent) and os.path.normpath(parent) == parent and parent != "/" and ".." not in parent.split("/"),
          "media-parent-not-canonical")
    _check_ancestors(parent, owner_uid, trusted_root)
    old = os.umask(0o022)
    try:
        os.mkdir(parent, MODE)
        created = True
    except FileExistsError:
        created = False
    finally:
        os.umask(old)
    if not created:
        _validate_existing(parent, owner_uid)
        return "existing"
    before = os.lstat(parent)
    fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
    finally:
        os.close(fd)
    _need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), "media-parent-identity-changed")
    _need(_secure_dir(opened, owner_uid) and stat.S_IMODE(opened.st_mode) == MODE, "media-parent-created-insecure")
    _validate_existing(parent, owner_uid)
    return "created"


def main(argv):
    ap = argparse.ArgumentParser(prog="prepare_media_parent.py")
    ap.add_argument("--parent", required=True, help="the retained plan's privateMediaParent")
    ap.add_argument("--expected", required=True, help="CT_MEDIA_PARENT or the plan builder's default")
    a = ap.parse_args(argv[1:])
    try:
        _need(os.geteuid() == 0, "media-parent-requires-root")
        result = prepare(a.parent, a.expected, 0)
    except (Refused, OSError) as e:
        code = str(e) if isinstance(e, Refused) else "media-parent-" + (type(e).__name__)
        print("BLOCKED_SETUP: " + code, file=sys.stderr)
        return 78
    print("media parent " + result)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
