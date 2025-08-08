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

1.  **Start a Session**: Click "Start New Session" to begin.
2.  **Grant Microphone Access**: Allow the browser to access your microphone when prompted.
3.  **Begin Speaking**: Start talking and watch the real-time filler word detection.
4.  **Monitor Progress**: View the live counters for each filler word.
5.  **End Session**: Click "End Session" when you are finished.

## How to Test the Application

This project uses [Vitest](https://vitest.dev/) for unit and integration testing. Vitest is a blazing fast unit-test framework powered by Vite.

To run the tests, use the following command:

```bash
npm test
```

This will run all test files in the `src/__tests__` directory.

## Application Architecture

This application is built with a focus on separating concerns, primarily through the use of custom React Hooks to manage state and logic.

### Custom Hooks

-   **`useSpeechRecognition({ customWords })`**: The core of the application. This hook manages the connection to the browser's Web Speech API, processes the transcript in real-time, and counts both default and user-defined filler words.
    -   `customWords`: An array of strings that can be passed to the hook to detect additional user-defined filler words.
-   **`useAudioRecording()`**: A simple hook that manages the state of the microphone recording.
-   **`useAnalyticsData()`**: (Currently Mocked) This hook provides static data for the user's analytics dashboard, including session history and trends. This allows for UI development without a backend.

### Path to a Live Backend

The application is currently being developed with a "frontend-first" approach using mocked data. The custom hooks are designed to make the transition to a live backend seamless.

For example, the `useAnalyticsData` hook currently returns a static object. To connect it to a live backend, the implementation of this hook would be updated to use a data-fetching library (like React Query) to fetch data from the Supabase API. No changes would be needed in the UI components that consume the hook, as the data shape would remain the same.

## Development Roadmap

This project is currently in the process of being migrated to a full-stack SaaS application. The planned features include:

-   **User Authentication**: Allowing users to sign up and log in to save their data.
-   **Session History & Analytics**: A dashboard for users to view their progress and trends over time.
-   **Subscription Management**: Integration with Stripe to handle payments for premium features.

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
