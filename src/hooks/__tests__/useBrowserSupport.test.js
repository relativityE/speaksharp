import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrowserSupport } from '../useBrowserSupport';

describe('useBrowserSupport', () => {

  afterEach(() => {
    // Restore all mocks after each test to ensure a clean slate
    vi.restoreAllMocks();
  });

  it('should return isSupported = true when all features are available', () => {
    // Mock all necessary browser APIs
    vi.spyOn(window, 'SpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(window, 'webkitSpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(navigator, 'mediaDevices', 'get').mockImplementation(() => ({ getUserMedia: vi.fn() }));
    vi.spyOn(window, 'Storage', 'get').mockImplementation(() => vi.fn());

    const { result } = renderHook(() => useBrowserSupport());

    expect(result.current.isSupported).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should return isSupported = false and an error if SpeechRecognition is missing', () => {
    // Mock other APIs but leave SpeechRecognition as undefined
    vi.spyOn(window, 'SpeechRecognition', 'get').mockImplementation(() => undefined);
    vi.spyOn(window, 'webkitSpeechRecognition', 'get').mockImplementation(() => undefined);
    vi.spyOn(navigator, 'mediaDevices', 'get').mockImplementation(() => ({ getUserMedia: vi.fn() }));
    vi.spyOn(window, 'Storage', 'get').mockImplementation(() => vi.fn());

    const { result } = renderHook(() => useBrowserSupport());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toBe('Speech recognition not supported in this browser.');
  });

  it('should return isSupported = false and an error if mediaDevices are missing', () => {
    vi.spyOn(window, 'SpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(window, 'webkitSpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(navigator, 'mediaDevices', 'get').mockImplementation(() => undefined);
    vi.spyOn(window, 'Storage', 'get').mockImplementation(() => vi.fn());

    const { result } = renderHook(() => useBrowserSupport());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toBe('Microphone access not supported in this browser.');
  });

  it('should return isSupported = false and an error if Storage is missing', () => {
    vi.spyOn(window, 'SpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(window, 'webkitSpeechRecognition', 'get').mockImplementation(() => vi.fn());
    vi.spyOn(navigator, 'mediaDevices', 'get').mockImplementation(() => ({ getUserMedia: vi.fn() }));
    vi.spyOn(window, 'Storage', 'get').mockImplementation(() => undefined);

    const { result } = renderHook(() => useBrowserSupport());

    expect(result.current.isSupported).toBe(false);
    expect(result.current.error).toBe('Local storage not supported in this browser.');
  });
});
