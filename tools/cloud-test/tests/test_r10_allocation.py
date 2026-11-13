"""allocation-at-all-ceilings and insufficient-cap regressions for the sized R10 occurrence. The occurrence is materialized
from the COMMITTED template (no grant authority needed: explicit synthetic references), its reservation is computed by the real
manual_reservation.manual_request, and admitted by the real reserve against a synthetic journal whose headroom is set to exactly that
allocation in every G5 dimension at once. One short in any single dimension refuses; an approved run cap below the sized estimate refuses."""
import copy
import hashlib
import json
import os

from _fixtures import EXPIRED_GRANT_REL, ROOT, expired_grant_active
import init_run_inputs as I
import manual_reservation as M
from test_accounting_rollup import Journal, scope

# the active one-off: the AHT-01 selected smoke occurrence of the R10 campaign
with open(os.path.join(ROOT, "config", "runs", "R10-3b040043-aht01.json"), encoding="utf-8") as _f:
    TEMPLATE = json.load(_f)
RUN = "42400000001"
AT = "2026-11-02T04:00:00Z"
SIZED = {"requests": 450 + 4, "identityReads": 4, "starts": 2, "takes": 2}


def occurrence(template=TEMPLATE):
    occ = I.materialize_smoke_occurrence(template, "2026-11-07T17:00:00Z", "slack:1000000006.000006", "slack:1000000006.000006", "product-owner",
                                         template["release"]["testedSha"], template["release"]["backend"]["sha"], ["AHT-01"])
    raw = json.dumps(occ, sort_keys=True, separators=(",", ":")).encode()
    return raw, hashlib.sha256(raw).hexdigest()



_EXPIRED_GRANT = expired_grant_active()


def setUpModule():
    _EXPIRED_GRANT.start()


def tearDownModule():
    _EXPIRED_GRANT.stop()


class R10Allocation(Journal):
    def rollup_with_headroom(self, headroom):
        base = scope()["ceilings"]
        ceilings = dict(base, requests=headroom["requests"] + base["protectedReserveRequests"], identityReads=headroom["identityReads"],
                        starts=headroom["starts"], takes=headroom["takes"])
        rollup = self.receive(scope(ceilings=ceilings))
        self.assertEqual({k: rollup["currentHeadroom"][k] for k in M.G5_KEYS}, headroom, "the synthetic journal has exactly this headroom")
        return rollup

    def test_the_sized_reservation_is_the_campaign_cap_plus_identity_and_the_one_run_caps(self):
        raw, sha = occurrence()
        _req, alloc = M.manual_request(raw, sha)
        self.assertEqual({k: alloc[k] for k in M.G5_KEYS}, SIZED)
        with open(os.path.join(ROOT, EXPIRED_GRANT_REL), encoding="utf-8") as f:
            self.assertEqual(json.load(f)["limits"]["requestsIncludingIdentity"], SIZED["requests"])

    def test_allocation_at_all_ceilings_admits(self):
        raw, sha = occurrence()
        event = M.reserve(raw, sha, RUN, self.rollup_with_headroom(dict(SIZED)), W_head(self), AT)
        self.assertEqual({k: event["allocation"][k] for k in M.G5_KEYS}, SIZED)

    def test_one_short_in_any_single_dimension_refuses(self):
        raw, sha = occurrence()
        for key in M.G5_KEYS:
            with self.subTest(short=key):
                room = dict(SIZED, **{key: SIZED[key] - 1})
                with self.assertRaises(M.Refused) as e:
                    M.reserve(raw, sha, RUN, self.rollup_with_headroom(room), W_head(self), AT)
                self.assertEqual(str(e.exception), "manual-reservation-exceeds-headroom")

    def test_an_approved_run_cap_below_the_sized_estimate_refuses(self):
        t = copy.deepcopy(TEMPLATE)
        t["approvedLimits"]["runCapRequests"] = t["estimate"]["requests"]["runCap"] - 1
        raw, sha = occurrence(t)
        with self.assertRaises(M.Refused) as e:
            M.manual_request(raw, sha)
        self.assertEqual(str(e.exception), "manual-reservation-approved-request-cap")


def W_head(test):
    """The journal head the reserve would be appended on (the real writer's own read)."""
    return M.state_ref_writer.fetch_head(test.repo, test.remote, test.remote)
