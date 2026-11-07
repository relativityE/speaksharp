import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureReceipt } from '../captureReceipt.ts';

test('counts actual listener deliveries, including silence, without retaining PCM', () => {
    const receipt = createCaptureReceipt({ captureId: 'take-a', candidateId: 'model-a', sampleRateHz: 16000 });
    receipt.receive(128, 10);
    receipt.receive(256, 20);
    assert.deepEqual(receipt.read(), { captureId: 'take-a', candidateId: 'model-a', sampleRateHz: 16000,
        active: true, receivedFrames: 2, receivedSamples: 384, firstReceivedAtMs: 10, lastReceivedAtMs: 20 });
    const snapshot = receipt.read();
    snapshot.receivedSamples = 999;
    assert.equal(receipt.read().receivedSamples, 384);
});

test('retired listener cannot add deliveries or contaminate a successor capture', () => {
    const first = createCaptureReceipt({ captureId: 'take-a', candidateId: null, sampleRateHz: 16000 });
    first.receive(128, 1);
    first.stop();
    const second = createCaptureReceipt({ captureId: 'take-b', candidateId: 'model-b', sampleRateHz: 16000 });
    first.receive(128, 2);
    second.receive(256, 3);
    assert.equal(first.read().receivedSamples, 128);
    assert.equal(first.read().active, false);
    assert.equal(second.read().receivedSamples, 256);
    assert.equal(second.read().captureId, 'take-b');
});

test('no received frames stays unknown in time; invalid counts do not fabricate coverage', () => {
    const receipt = createCaptureReceipt({ captureId: 'take-a', candidateId: null, sampleRateHz: 16000 });
    for (const count of [0, -1, NaN, 1.5]) receipt.receive(count, 1);
    receipt.receive(128, NaN);
    assert.equal(receipt.read().receivedSamples, 0);
    assert.equal(receipt.read().firstReceivedAtMs, null);
});
