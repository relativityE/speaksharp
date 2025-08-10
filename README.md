# SpeakSharp

A mobile-first web application that detects and counts filler words in real time to help users improve verbal clarity and communication effectiveness. All processing is done locally in your browser, ensuring your privacy.

## Features

- **Real-time Filler Word Detection**: Automatically detects common filler words like "um", "uh", "like", and "you know".
- **Live Transcript**: Displays a real-time transcript of your speech.
- **Custom Filler Words**: Add your own custom words to be tracked.
- **Mobile-First Design**: Optimized for mobile devices with a responsive web interface.
- **Browser-Based Speech-to-Text**: Uses the browser's built-in `SpeechRecognition` API for transcription.
- **Session Management**: Start and stop recording sessions with intuitive controls.
- **Live Analytics**: Real-time word count and frequency tracking.
- **Privacy First**: All audio processing happens on your device. Your speech never leaves your computer.

## Technology Stack

- **Frontend**: React (with [Vite](https://vitejs.dev/)) - A next-generation frontend tooling that provides a faster and leaner development experience for modern web projects.
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

4.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Usage

1.  **Start a Session**: Click "Start New Session" on the home page to begin a new recording session. The session will automatically end after 2 minutes. You can use the "Override timer" checkbox for longer sessions during development.
2.  **Grant Microphone Access**: Allow the browser to access your microphone when prompted.
3.  **Control Recording**: Use the "Start Recording" and "Stop Recording" buttons to control the session.
4.  **View Live Transcript**: Watch your speech being transcribed in real time in the "Live Transcript" box.
5.  **Add Custom Filler Words**: You can add your own custom filler words to be tracked during the session.
6.  **Monitor Progress**: View the live counters for each filler word on the session page.
7.  **View Analytics**: Click the "View Detailed Analytics" link on the session page or the "View Analytics" link on the home page to see your session history and trends.
8.  **Download History**: On the Analytics page, you can download your entire session history as a JSON file.
9.  **End Session**: Click "End Session" when you are finished to save your session data and return to the home page.

## How to Test the Application

This project uses [Vitest](https://vitest.dev/) for unit and integration testing. Vitest is a blazing fast unit-test framework powered by Vite.

To run the tests, use the following command:

```bash
npm test
```

This will run all test files in the `src/__tests__` directory.

## Project Status & Roadmap

This project is currently a fully client-side application where all processing happens in your browser. Development is in progress to transform this tool into a full-stack SaaS application.

The high-level roadmap is outlined below. For a detailed breakdown, please see the [Product Requirements Document](./PRD.md).

-   **User Authentication**
    -   **Why**: To allow users to save their sessions and track progress over time.
-   **Session History & Analytics**
    -   **Why**: To provide users with actionable insights into their speech patterns and improvement.
-   **Subscription Management**
    -   **Why**: To create a sustainable business model by offering premium, paid features.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
