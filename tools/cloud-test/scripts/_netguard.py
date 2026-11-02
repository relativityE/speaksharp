"""Network guard for the offline control plane. Importing this module makes every outbound socket operation fail and counts the attempt.
The control plane (offline checks, preflight, reporting) never needs the network and never talks to the product; this guard turns an accidental or
malicious attempt into a loud failure and a counted, reported event. Set CT_NETGUARD_LOG to a file path to collect attempts across subprocesses."""
import os
import socket

ATTEMPTS = 0
_LOG = os.environ.get("CT_NETGUARD_LOG")


def _deny(*_a, **_k):
    global ATTEMPTS
    ATTEMPTS += 1
    if _LOG:
        with open(_LOG, "a", encoding="utf-8") as f:
            f.write("attempt\n")
    raise OSError("network access is denied in the offline control plane")


socket.socket.connect = _deny
socket.socket.connect_ex = _deny
socket.create_connection = _deny
socket.getaddrinfo = _deny
