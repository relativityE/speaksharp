import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

// Mock SpeechRecognition API
const mockSpeechRecognition = {
  start: vi.fn(),
  stop: vi.fn(),
  onresult: null,
  onerror: null,
  onend: null,
  continuous: false,
  interimResults: false,
  lang: ''
}

const originalSpeechRecognition = global.window.SpeechRecognition
const originalWebkitSpeechRecognition = global.window.webkitSpeechRecognition

describe('useSpeechRecognition Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.window.SpeechRecognition = vi.fn(() => mockSpeechRecognition)
    global.window.webkitSpeechRecognition = vi.fn(() => mockSpeechRecognition)
    // Reset the mock state before each test
    Object.assign(mockSpeechRecognition, {
      start: vi.fn(),
      stop: vi.fn(),
      onresult: null,
      onerror: null,
      onend: null,
      continuous: false,
      interimResults: false,
      lang: ''
    })
  })

  afterEach(() => {
    global.window.SpeechRecognition = originalSpeechRecognition
    global.window.webkitSpeechRecognition = originalWebkitSpeechRecognition
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    expect(result.current.isListening).toBe(false)
    expect(result.current.transcript).toBe('')
    expect(result.current.error).toBe(null)
    expect(result.current.isSupported).toBe(true)
    expect(result.current.fillerCounts).toEqual({
      um: 0,
      uh: 0,
      ah: 0,
      like: 0,
      youKnow: 0,
      so: 0,
      actually: 0,
      oh: 0,
      iMean: 0
    })
  })

  it('should start listening', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    expect(result.current.isListening).toBe(true)
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(1)
  })

  it('should stop listening intentionally', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    // stopListening should not immediately set isListening to false
    act(() => {
      result.current.stopListening()
    })
    expect(result.current.isListening).toBe(true)
    expect(mockSpeechRecognition.stop).toHaveBeenCalledTimes(1)

    // isListening should become false only after the 'onend' event
    act(() => {
      mockSpeechRecognition.onend()
    })
    expect(result.current.isListening).toBe(false)
  })

  it('should automatically restart if it stops unexpectedly', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(1)
    expect(result.current.isListening).toBe(true)
    // Simulate an unexpected end
    act(() => {
      mockSpeechRecognition.onend()
    })
    // It should remain in the listening state and have called start again
    expect(result.current.isListening).toBe(true)
    expect(mockSpeechRecognition.start).toHaveBeenCalledTimes(2)
  })

  it('should reset the session', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
      mockSpeechRecognition.onresult({
        resultIndex: 0,
        results: [
          { 0: { transcript: 'um like you know' }, isFinal: true }
        ]
      })
    })

    expect(result.current.transcript).toBe('um like you know')
    expect(result.current.fillerCounts.um).toBe(1)

    act(() => {
      result.current.resetSession()
    })

    expect(result.current.transcript).toBe('')
    expect(result.current.fillerCounts.um).toBe(0)
  })

  it('should detect variations of "um"', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'um, am I ahm, em, ready?' }, isFinal: true }]
    }
    act(() => {
      mockSpeechRecognition.onresult(mockEvent)
    })
    expect(result.current.fillerCounts.um).toBe(4)
  })

  it('should separately count "uh" and "ah"', () => {
    const { result } = renderHook(() => useSpeechRecognition())
    act(() => {
      result.current.startListening()
    })
    const mockEvent = {
      resultIndex: 0,
      results: [{ 0: { transcript: 'uh, this is a test, ah, it is.' }, isFinal: true }]
    }
    act(() => {
      mockSpeechRecognition.onresult(mockEvent)
    })
    expect(result.current.fillerCounts.uh).toBe(2)
    expect(result.current.fillerCounts.ah).toBe(1)
  })

  describe('with custom filler words', () => {
    it('should detect and count a custom filler word', () => {
      const { result } = renderHook(() => useSpeechRecognition({ customWords: ['special'] }))

      act(() => {
        result.current.startListening()
      })

      const mockEvent = {
        resultIndex: 0,
        results: [
          { 0: { transcript: 'this is a special test with a special word' }, isFinal: true }
        ]
      }

      act(() => {
        mockSpeechRecognition.onresult(mockEvent)
      })

      expect(result.current.fillerCounts.special).toBe(2)
    })
  })
})
