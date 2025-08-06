# SayLess

A mobile-first web application that detects and counts filler words in real time to help users improve verbal clarity and communication effectiveness. All processing is done locally in your browser, ensuring your privacy.

## Features

- **Real-time Filler Word Detection**: Automatically detects common filler words like "um", "uh", "like", and "you know".
- **Mobile-First Design**: Optimized for mobile devices with a responsive web interface.
- **Browser-Based Speech-to-Text**: Uses the browser's built-in `SpeechRecognition` API for transcription.
- **Session Management**: Start and stop recording sessions with intuitive controls.
- **Live Analytics**: Real-time word count and frequency tracking.
- **Privacy First**: All audio processing happens on your device. Your speech never leaves your computer.

## Technology Stack

- **Frontend**: React (with Vite)
- **Styling**: Tailwind CSS
- **UI Components**: shadcn/ui
- **Icons**: Lucide React
- **Speech Processing**: Browser's Web Speech API

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (or pnpm, yarn)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/relativityE/sayless-ai.git
    cd sayless-ai
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open your browser and navigate to `http://localhost:5173` (or the address shown in your terminal).

## Usage

1.  **Start a Session**: Click "Start New Session" to begin.
2.  **Grant Microphone Access**: Allow the browser to access your microphone when prompted.
3.  **Begin Speaking**: Start talking and watch the real-time filler word detection.
4.  **Monitor Progress**: View the live counters for each filler word.
5.  **End Session**: Click "End Session" when you are finished.

## How to Test the Application

This project uses [Vitest](https://vitest.dev/) for unit and integration testing.

To run the tests, use the following command:

```bash
npm test
```

This will run all test files in the `src/__tests__` directory.

## Future Work

This project has the potential for many new features. Here are a few ideas for future development:

-   **Custom Phrase Detection**: Allow users to add their own words and phrases to detect.
-   **Post-Session Summary**: Create a summary page that appears after a session is ended, showing detailed metrics and the full transcript.
-   **User Accounts and History**: Add a backend service (like Supabase) to allow users to create accounts and save their session history.
-   **Clarity Score**: Develop an algorithm to provide an overall "clarity score" based on filler word usage, speaking pace, and other metrics.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
