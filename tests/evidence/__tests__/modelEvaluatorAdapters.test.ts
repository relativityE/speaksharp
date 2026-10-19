import { describe, expect, it } from 'vitest';
import { configuredAssetDigest } from '../../../scripts/model-evaluator/adapters/candidate-browser';

describe('#1565 candidate asset binding', () => {
  it('binds each selected model and decoder precision to its committed asset pins', async () => {
    const root = process.cwd();
    expect(await configuredAssetDigest(root, 'v4:base:q4', 'onnx-community/whisper-base.en'))
      .toBe('19e79a9e383779a6763c9e766ccd4e3067d5481d6468164c4b86147ddb356644');
    expect(await configuredAssetDigest(root, 'v4:distil:q4', 'onnx-community/distil-small.en'))
      .toBe('b5e113f824bd8db270210d4c90ac779d2914c705bc692a9376b7cb89dbde042e');
    expect(await configuredAssetDigest(root, 'moonshine:streaming-medium', 'medium-streaming-en'))
      .toBe('898305d7768356a7f56002a4b2c4e55dd0534a6fd1ae11b0aadc0d11d2a27891');
  });
});
