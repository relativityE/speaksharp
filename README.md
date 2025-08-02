# SayLess

A mobile-first web application that detects and counts filler words or custom phrases in real time to help users improve verbal clarity and communication effectiveness.

## Features

- **Real-time Filler Word Detection**: Automatically detects common filler words like "um", "uh", "like", and "you know"
- **Mobile-First Design**: Optimized for mobile devices with responsive web interface
- **Speech-to-Text Integration**: Uses modern STT APIs for accurate transcription
- **Custom Phrase Detection**: Track custom words and phrases beyond standard filler words
- **Session Management**: Start and stop recording sessions with intuitive controls
- **Live Analytics**: Real-time word count and frequency tracking
- **Post-Session Summary**: Detailed metrics and insights after each session
- **Privacy Options**: Choose between anonymous local sessions or optional account-based history

## Technology Stack

- **Frontend**: Next.js with React
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Speech Processing**: AssemblyAI / Deepgram API integration
- **Real-time Updates**: WebSocket or Socket.IO
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth (optional)
- **Deployment**: Vercel

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/relativityE/sayless-ai.git
cd sayless-ai
```

2. Install dependencies:
```bash
pnpm install
```

3. Set up environment variables:
```bash
cp .env.example .env.local
# Add your API keys for STT service and Supabase
```

4. Start the development server:
```bash
pnpm run dev
```

5. Open your browser and navigate to `http://localhost:3000`

## Usage

1. **Start a Session**: Click "Start New Session" to begin tracking
2. **Grant Microphone Access**: Allow browser access to your microphone
3. **Begin Speaking**: Start speaking and watch real-time filler word detection
4. **Monitor Progress**: View live counters and frequency metrics
5. **End Session**: Complete your session to see detailed summary and insights

## Core Components

- **AudioCapture**: Handles microphone input and audio streaming
- **TranscriptionStream**: Manages real-time speech-to-text processing
- **FillerWordDetector**: Identifies and counts filler words in transcribed text
- **CustomPhraseManager**: Allows users to define and track custom phrases
- **LiveAnalyticsPanel**: Displays real-time statistics and metrics
- **SessionSummary**: Provides post-session analysis and insights

## Development Roadmap

### MVP Features ✅
- [x] Real-time speech input via browser microphone
- [x] Speech-to-text transcription integration
- [x] Filler word and custom phrase detection
- [x] Live word count and frequency tracking
- [x] Post-session summary with metrics
- [x] Mobile-first responsive UI
- [x] Optional anonymous sessions

### Future Enhancements
- [ ] Native mobile app (iOS, Android)
- [ ] Session history with playback and filters
- [ ] Goal tracking and gamification features
- [ ] Export functionality (PDF, CSV)
- [ ] AI-based feedback and coaching
- [ ] Clarity scoring algorithm
- [ ] Subscription model with premium features

## API Integration

SayLess integrates with modern speech-to-text services:

- **AssemblyAI**: High-accuracy real-time transcription
- **Deepgram**: Low-latency speech recognition
- **OpenAI Whisper**: Alternative STT option

## Privacy & Security

- **Local Processing**: Option for anonymous, local-only sessions
- **Secure Storage**: Optional account data stored securely with Supabase
- **No Audio Retention**: Audio is processed in real-time and not stored
- **User Control**: Full control over data retention and sharing

## Contributing

We welcome contributions! Please see our contributing guidelines for more information.

## License

MIT License - see LICENSE file for details

## About

SayLess helps speakers improve their communication skills by providing real-time feedback on filler word usage. Perfect for:

- Professionals preparing for presentations
- Students practicing public speaking
- Job candidates preparing for interviews
- Content creators improving their delivery
- Anyone looking to enhance their verbal communication

Built with modern web technologies and a focus on user privacy and mobile accessibility.


