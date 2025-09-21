import TranscriptionService from '../TranscriptionService';
import NativeBrowser from '../modes/NativeBrowser';
import CloudAssemblyAI from '../modes/CloudAssemblyAI';
import LocalWhisper from '../modes/LocalWhisper';
import { UserProfile } from '../../../types/user';
import { vi } from 'vitest';

// Mock the transcription modes
vi.mock('../modes/NativeBrowser');
vi.mock('../modes/CloudAssemblyAI');
vi.mock('../modes/LocalWhisper');

// Mock createMicStream to avoid dealing with browser APIs
vi.mock('../utils/audioUtils', () => ({
  createMicStream: vi.fn().mockResolvedValue({}),
}));

const mockNavigate = vi.fn();
const mockGetAssemblyAIToken = vi.fn().mockResolvedValue('fake-token');

describe('TranscriptionService', () => {
  let service: TranscriptionService;

  afterEach(() => {
    vi.clearAllMocks();
  });

  const createService = (profile: UserProfile | null) => {
    return new TranscriptionService({
      profile,
      onTranscriptUpdate: vi.fn(),
      onModelLoadProgress: vi.fn(),
      onReady: vi.fn(),
      session: null,
      navigate: mockNavigate,
      getAssemblyAIToken: mockGetAssemblyAIToken,
    });
  };

  it('should select NativeBrowser mode for a free user', async () => {
    const freeProfile: UserProfile = { id: '1', subscription_status: 'free' };
    service = createService(freeProfile);
    await service.init();
    await service.startTranscription();

    expect(NativeBrowser).toHaveBeenCalledTimes(1);
    expect(CloudAssemblyAI).not.toHaveBeenCalled();
    expect(LocalWhisper).not.toHaveBeenCalled();
  });

  it('should select CloudAssemblyAI mode for a pro user by default', async () => {
    const proProfile: UserProfile = { id: '2', subscription_status: 'pro' };
    service = createService(proProfile);
    await service.init();
    await service.startTranscription();

    expect(CloudAssemblyAI).toHaveBeenCalledTimes(1);
    expect(NativeBrowser).not.toHaveBeenCalled();
    expect(LocalWhisper).not.toHaveBeenCalled();
  });

  it('should select LocalWhisper mode for a pro user with on-device preference', async () => {
    const proProfile: UserProfile = {
      id: '3',
      subscription_status: 'pro',
      preferred_mode: 'on-device',
    };
    service = createService(proProfile);
    await service.init();
    await service.startTranscription();

    expect(LocalWhisper).toHaveBeenCalledTimes(1);
    expect(CloudAssemblyAI).not.toHaveBeenCalled();
    expect(NativeBrowser).not.toHaveBeenCalled();
  });
});
