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

  it('should stop listening', () => {
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

  it('should reset the session', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    // Simulate receiving some results
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

  it('should update transcript and filler counts on result', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const mockEvent = {
      resultIndex: 0,
      results: [
        { 0: { transcript: 'hello um so this is a test' }, isFinal: true }
      ]
    }

    act(() => {
      mockSpeechRecognition.onresult(mockEvent)
    })

    expect(result.current.transcript).toBe('hello um so this is a test')
    expect(result.current.fillerCounts.um).toBe(1)
    expect(result.current.fillerCounts.so).toBe(1)
    expect(result.current.fillerCounts.like).toBe(0)
  })

  it('should handle multiple filler words of the same type', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const mockEvent = {
      resultIndex: 0,
      results: [
        { 0: { transcript: 'um um um, this is like, like, another test' }, isFinal: true }
      ]
    }

    act(() => {
      mockSpeechRecognition.onresult(mockEvent)
    })

    expect(result.current.fillerCounts.um).toBe(3)
    expect(result.current.fillerCounts.like).toBe(2)
  })

  it('should handle errors from speech recognition', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const errorEvent = { error: 'network' }
    act(() => {
      mockSpeechRecognition.onerror(errorEvent)
    })

    expect(result.current.error).toBe('Speech recognition error: network')
    expect(result.current.isListening).toBe(false)
  })

  it('should set isListening to false on end event', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    expect(result.current.isListening).toBe(true)

    act(() => {
      mockSpeechRecognition.onend()
    })

    expect(result.current.isListening).toBe(false)
  })

  it('should accumulate filler counts across multiple final results', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const firstEvent = {
      resultIndex: 0,
      results: [
        { 0: { transcript: 'um so ' }, isFinal: true }
      ]
    }

    // First result
    act(() => {
      mockSpeechRecognition.onresult(firstEvent)
    })

    expect(result.current.fillerCounts.um).toBe(1)
    expect(result.current.fillerCounts.so).toBe(1)

    const secondEvent = {
      resultIndex: 1,
      results: [
        firstEvent.results[0],
        { 0: { transcript: 'like you know ' }, isFinal: true }
      ]
    }

    // Second result
    act(() => {
      mockSpeechRecognition.onresult(secondEvent)
    })

    expect(result.current.fillerCounts.like).toBe(1)
    expect(result.current.fillerCounts.youKnow).toBe(1)
    // Check if previous counts are preserved
    expect(result.current.fillerCounts.um).toBe(1)
    expect(result.current.fillerCounts.so).toBe(1)

    const thirdEvent = {
      resultIndex: 2,
      results: [
        secondEvent.results[0],
        secondEvent.results[1],
        { 0: { transcript: 'um so so ' }, isFinal: true }
      ]
    }

    // Third result with more filler words
    act(() => {
        mockSpeechRecognition.onresult(thirdEvent)
    })

    expect(result.current.fillerCounts.um).toBe(2)
    expect(result.current.fillerCounts.so).toBe(3)
    expect(result.current.fillerCounts.like).toBe(1)
    expect(result.current.fillerCounts.youKnow).toBe(1)
  })

  it('should accumulate transcript across multiple final results', () => {
    const { result } = renderHook(() => useSpeechRecognition())

    act(() => {
      result.current.startListening()
    })

    const firstEvent = {
      resultIndex: 0,
      results: [
        { 0: { transcript: 'Hello ' }, isFinal: true }
      ]
    }

    // First result
    act(() => {
      mockSpeechRecognition.onresult(firstEvent)
    })

    expect(result.current.transcript).toBe('Hello ')

    const secondEvent = {
      resultIndex: 1,
      results: [
        firstEvent.results[0],
        { 0: { transcript: 'world' }, isFinal: true }
      ]
    }

    // Second result
    act(() => {
      mockSpeechRecognition.onresult(secondEvent)
    })

    expect(result.current.transcript).toBe('Hello world')
  })
})
