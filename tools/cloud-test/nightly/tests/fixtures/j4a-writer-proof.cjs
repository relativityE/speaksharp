'use strict';
// Offline fixtures only. No production observer exists. This factory is never
// imported by the runner, child, or CLI.
const { verifyJ4aStoppedWriters } = require('../../j4a-writer-evidence.cjs');
function offlineWriterProof({binding, runId, owner}) {
    const droppedSave = 'c'.repeat(64);
    const identity = { binding, runId, owner };
    return verifyJ4aStoppedWriters({ ...identity, droppedSave, fault: 'request-lost' }, {
        ...identity, exited: true, ownedPagesClosed: true, descendantCount: 0,
        interrupted: false, guardTransportDrained: true, writersClosedAt: 1,
    }, {
        ...identity, armedBeforeLaunch: true, closedAfterLastWriter: true, integrityVerified: true,
        attempts: [{ attempt: droppedSave, kind: 'save', decision: 'planned-request-lost', upstreamStarted: false }],
    });
}
module.exports = { offlineWriterProof };
