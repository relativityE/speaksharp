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
- **Authentication & DB**: Supabase
- **Speech Processing**: Browser's Web Speech API

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (v10.4.1 or higher)

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/relativityE/speaksharp.git
    cd speaksharp
    ```

2.  Install dependencies:
    ```bash
    pnpm install
    ```

3.  Start the development server:
    ```bash
    pnpm run dev
    ```

4.  Open your browser and navigate to the URL shown in your terminal. It is usually `http://localhost:5173`, but it might be different if that port is occupied.

## Usage

SpeakSharp uses a "progressive reveal" model. All pages are accessible to everyone, but more features are unlocked when you sign up for a free account.

### Anonymous Users (Free Trial)
-   **Start a Session**: Anyone can start a recording session from the main page.
-   **2-Minute Limit**: Trial sessions are limited to 2 minutes. A checkbox is available for developers to override this limit.
-   **View Analytics Page**: You can view the Analytics page, but it will show a demo and a prompt to sign up to save and view your history.

### Authenticated Users (Free Tier)
-   **Sign Up / Login**: Create a free account to unlock more features.
-   **Save Session History**: Your sessions are automatically saved to your account.
-   **Track Progress**: The Analytics page will show your full session history and progress charts.
-   **Unlimited Session Length**: The 2-minute limit is removed.
-   **Custom Filler Words**: Add and track your own list of custom filler words.

## How to Test the Application

This project uses [Vitest](https://vitest.dev/) for unit and integration testing. Vitest is a blazing fast unit-test framework powered by Vite.

To run the tests, use the following command:

```bash
pnpm test
```

This will run all test files in the `src/__tests__` directory.

## Project Status & Roadmap

This project is currently being developed into a full-stack SaaS application with a **"Speed Over Perfection"** philosophy. The immediate goal is to launch a monetizable MVP within 3 weeks to gather user feedback and iterate quickly.

The high-level roadmap is to:
1.  **Launch a functional MVP** with authentication, free/paid tiers, and payment processing.
2.  **Gather user feedback** and iterate on the core features.
3.  **Expand the feature set** based on user demand, including advanced analytics and cloud-powered transcription.

For a detailed, day-by-day implementation plan for the MVP, please see the [Smart MVP Implementation Guide](./smart-mvp-plan.md).

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for details.
