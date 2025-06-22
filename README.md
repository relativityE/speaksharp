# ClearSpeak AI

A mobile-first application that detects, counts, and reports filler words or custom phrases in real time to help users improve verbal clarity and public speaking effectiveness.

## Features

- **Real-time Filler Word Detection**: Automatically detects common filler words like "um", "uh", "like", and "you know"
- **Privacy First**: All processing happens on your device using WebAssembly - your speech never leaves your device
- **Session Management**: Start and stop recording sessions with easy-to-use controls
- **Live Feedback**: Get instant visual feedback on your speech patterns
- **Custom Word Lists**: Support for tracking custom words and phrases (coming soon)

## Technology Stack

- **Frontend**: React with Vite
- **UI Components**: shadcn/ui with Tailwind CSS
- **Icons**: Lucide React
- **Speech Processing**: WebAssembly (planned)
- **Audio Capture**: Web Audio API (planned)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/relativityE/clearspeak-ai.git
cd clearspeak-ai
```

2. Install dependencies:
```bash
pnpm install
```

3. Start the development server:
```bash
pnpm run dev
```

4. Open your browser and navigate to `http://localhost:5173`

## Usage

1. **Start a Session**: Click "Start New Session" to begin tracking
2. **Begin Recording**: Click "Start Recording" to start audio capture
3. **Monitor Filler Words**: Watch the real-time counters for different filler words
4. **End Session**: Click "End Session" to stop tracking and view results

## Development Roadmap

### Phase 1: Basic UI ✅
- [x] Session control interface
- [x] Filler word counters
- [x] Recording status indicators
- [x] Responsive design

### Phase 2: Core Features (In Progress)
- [ ] Audio capture implementation
- [ ] WebAssembly speech-to-text integration
- [ ] Real-time filler word detection
- [ ] Session history and reports

### Phase 3: Advanced Features (Planned)
- [ ] Custom word list management
- [ ] Performance analytics
- [ ] Export functionality
- [ ] Mobile app version

## Contributing

This project is in active development. Contributions are welcome!

## License

MIT License - see LICENSE file for details

## About

ClearSpeak AI helps speakers improve their communication skills by providing real-time feedback on filler word usage. Perfect for:

- Toastmasters members
- Public speakers
- Interview preparation
- Podcast hosts
- Anyone looking to improve their speaking clarity

Built with privacy in mind - all processing happens locally on your device.

