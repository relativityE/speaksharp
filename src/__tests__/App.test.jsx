import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import App from '../App'
import * as useAudioRecording from '../hooks/useAudioRecording'
import * as useSpeechRecognition from '../hooks/useSpeechRecognition'

vi.mock('../hooks/useAudioRecording')
vi.mock('../hooks/useSpeechRecognition')

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAudioRecording.useAudioRecording.mockReturnValue({
      isRecording: false,
      audioBlob: null,
      error: null,
      startRecording: vi.fn(),
      stopRecording: vi.fn(),
      clearRecording: vi.fn()
    })

    useSpeechRecognition.useSpeechRecognition.mockReturnValue({
      isListening: false,
      transcript: '',
      fillerCounts: {
        um: 0,
        uh: 0,
        like: 0,
        'you know': 0,
        so: 0,
        actually: 0
      },
      error: null,
      isSupported: true,
      startListening: vi.fn(),
      stopListening: vi.fn(),
      resetSession: vi.fn()
    })
  })

  it('renders the main heading', () => {
    render(<App />)
    expect(screen.getByText('SayLess')).toBeInTheDocument()
  })

  it('renders the tagline', () => {
    render(<App />)
    expect(screen.getByText('Real-time filler word detection for better speaking')).toBeInTheDocument()
  })

  it('renders the Start New Session button initially', () => {
    render(<App />)
    expect(screen.getByText('Start New Session')).toBeInTheDocument()
  })

  it('shows session controls when session is started', async () => {
    render(<App />)
    
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    expect(await screen.findByText('Start Recording')).toBeInTheDocument()
    expect(await screen.findByText('End Session')).toBeInTheDocument()
  })

  it('displays filler word counters', async () => {
    render(<App />)
    
    // Start a session first
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    // Check for filler word detection section
    expect(await screen.findByText('Filler Word Detection')).toBeInTheDocument()
    expect(await screen.findByText('Um')).toBeInTheDocument()
    expect(await screen.findByText('Uh')).toBeInTheDocument()
    expect(await screen.findByText('Like')).toBeInTheDocument()
    expect(await screen.findByText('You Know')).toBeInTheDocument()
    expect(await screen.findByText('So')).toBeInTheDocument()
    expect(await screen.findByText('Actually')).toBeInTheDocument()
  })

  it('displays privacy and feedback sections', () => {
    render(<App />)
    
    expect(screen.getByText('Privacy First')).toBeInTheDocument()
    expect(screen.getByText('Real-time Feedback')).toBeInTheDocument()
    expect(screen.getByText('All processing happens on your device using browser APIs. Your speech never leaves your device.')).toBeInTheDocument()
  })

  it('displays footer with correct branding', () => {
    render(<App />)
    
    expect(screen.getByText('SayLess - Powered by browser-based speech recognition')).toBeInTheDocument()
  })

  it('shows session timer when session is active', async () => {
    render(<App />)
    
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    // Look for timer display (should show 0:00 or similar)
    expect(await screen.findByText(/\d+:\d+/)).toBeInTheDocument()
  })

  it('shows ready to record status initially', async () => {
    render(<App />)
    
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    expect(await screen.findByText('Ready to Record')).toBeInTheDocument()
    const fillerWordText = await screen.findByText(/Total filler words detected:/)
    expect(fillerWordText).toBeInTheDocument()
    expect(fillerWordText.textContent).toMatch(/Total filler words detected: \d+/)
  })

  it('calls startRecording and startListening when Start Recording is clicked', async () => {
    const startRecording = vi.fn().mockResolvedValue(undefined)
    const startListening = vi.fn()
    useAudioRecording.useAudioRecording.mockReturnValue({
      isRecording: false,
      startRecording,
      clearRecording: vi.fn(),
    })
    useSpeechRecognition.useSpeechRecognition.mockReturnValue({
      isSupported: true,
      startListening,
      resetSession: vi.fn(),
      fillerCounts: {},
    })

    render(<App />)

    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)

    const startRecordingButton = await screen.findByText('Start Recording')
    await act(async () => {
      fireEvent.click(startRecordingButton)
    })

    expect(startRecording).toHaveBeenCalled()
    expect(startListening).toHaveBeenCalled()
  })

  it('calls stopRecording and stopListening when Stop Recording is clicked', async () => {
    const stopRecording = vi.fn()
    const stopListening = vi.fn()
    useAudioRecording.useAudioRecording.mockReturnValue({
      isRecording: true,
      stopRecording,
      clearRecording: vi.fn(),
    })
    useSpeechRecognition.useSpeechRecognition.mockReturnValue({
      isSupported: true,
      isListening: true,
      stopListening,
      resetSession: vi.fn(),
      fillerCounts: {},
    })

    render(<App />)

    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)

    const stopRecordingButton = await screen.findByText('Stop Recording')
    fireEvent.click(stopRecordingButton)

    expect(stopRecording).toHaveBeenCalled()
    expect(stopListening).toHaveBeenCalled()
  })

  it('ends the session when End Session is clicked', async () => {
    render(<App />)

    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)

    // Ensure the session view is active
    expect(await screen.findByText('End Session')).toBeInTheDocument()

    const endSessionButton = screen.getByText('End Session')
    fireEvent.click(endSessionButton)

    // After ending session, the "Start New Session" button should be back
    expect(await screen.findByText('Start New Session')).toBeInTheDocument()
  })

  it('displays an error message if audio recording fails', () => {
    const errorMessage = 'Microphone not available'
    useAudioRecording.useAudioRecording.mockReturnValue({ error: errorMessage })

    render(<App />)

    expect(screen.getByText(errorMessage)).toBeInTheDocument()
  })

  it('displays an error message if speech recognition fails', () => {
    const errorMessage = 'Speech recognition failed'
    useSpeechRecognition.useSpeechRecognition.mockReturnValue({ error: errorMessage })

    render(<App />)

    expect(screen.getByText(errorMessage)).toBeInTheDocument()
  })
})
