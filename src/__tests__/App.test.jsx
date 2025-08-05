import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import App from '../App'

// Mock the custom hooks
vi.mock('../hooks/useAudioRecording', () => ({
  useAudioRecording: () => ({
    isRecording: false,
    audioBlob: null,
    error: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    clearRecording: vi.fn()
  })
}))

vi.mock('../hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
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
}))

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    
    expect(await screen.findByText('Start Recording', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('End Session', {}, { timeout: 10000 })).toBeInTheDocument()
  })

  it('displays filler word counters', async () => {
    render(<App />)
    
    // Start a session first
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    // Check for filler word detection section
    expect(await screen.findByText('Filler Word Detection', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('Um', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('Uh', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('Like', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('You Know', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('So', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('Actually', {}, { timeout: 10000 })).toBeInTheDocument()
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
    expect(await screen.findByText(/\d+:\d+/, {}, { timeout: 10000 })).toBeInTheDocument()
  })

  it('shows ready to record status initially', async () => {
    render(<App />)
    
    const startButton = screen.getByText('Start New Session')
    fireEvent.click(startButton)
    
    expect(await screen.findByText('Ready to Record', {}, { timeout: 10000 })).toBeInTheDocument()
    expect(await screen.findByText('Total filler words detected: 0', {}, { timeout: 10000 })).toBeInTheDocument()
  })
})

