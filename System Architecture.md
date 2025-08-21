# System Architecture: DevFolio

## 1. Executive Summary

**DevFolio** is a modern, serverless-optional web application designed as a portfolio template. Its architecture prioritizes a fast developer experience, a clean and maintainable codebase, and a visually appealing user interface.

The system is built on a **React (Vite)** frontend, which creates a highly interactive and performant single-page application. While the template is primarily a frontend project, it retains a connection to a **Supabase** backend, making it easy for developers to extend it with backend features like authentication or a database for a blog.

## 2. System Architecture & Technology Stack

The architecture is a classic Jamstack approach, with a strong focus on the client-side application.

### High-Level Overview
```text
+---------------------------------+      +---------------------------------+
|      React SPA (`src`)          |----->|      Development & Build        |
|    (in User's Browser)          |      |        (Vite, Vitest)           |
|                                 |      +---------------------------------+
|  +---------------------------+  |
|  |  UI Components (`/pages`) |  |
|  |  - MainPage.jsx (Portfolio)|  |
|  |  - AuthPage.jsx (Login)   |  |
|  |---------------------------|  |
|  |  Layout (`/components`)   |  |
|  |  - Sidebar.jsx            |  |
|  +---------------------------+  |
+---------------------------------+
             |
             | (Optional) API Calls for Auth/Data
             |
             v
+-------------------------------------------------------------------+
|                    Backend Services (Managed)                     |
|                                                                   |
| +------------+  +----------+                                      |
| |  Supabase  |  |  Stripe  |                                      |
| | - DB/Auth  |  |          |                                      |
| |- Functions |  |          |                                      |
| +------------+  +----------+                                      |
+-------------------------------------------------------------------+
```

### Technology Stack Breakdown
- **React**: The core library for building the user interface.
- **Vite**: The build tool and development server, providing a fast and modern development experience.
- **Tailwind CSS**: A utility-first CSS framework for rapid and consistent styling.
- **shadcn/ui**: A collection of reusable UI components built on top of Tailwind CSS.
- **Supabase (Optional)**: Provides backend services. The template is pre-configured to connect to Supabase for:
    - **Authentication**: User sign-up and sign-in.
    - **Database**: Storing user data or content (e.g., for a blog).
    - **Edge Functions**: Serverless functions for custom backend logic (e.g., payment processing).
- **Stripe (Optional)**: The Supabase backend includes functions for integrating with Stripe for payments.

## 3. Test Environment

The project uses **Vitest** for unit and integration testing.

-   **Framework**: Vitest is used for its speed and seamless integration with the Vite ecosystem.
-   **Environment**: Tests run in a `happy-dom` environment, which is a lightweight and fast simulation of a browser DOM.
-   **Setup**: The `src/test/setup.js` file configures the test environment by mocking global browser APIs (like `MediaRecorder`) to ensure tests can run in the simulated environment.

### 🚨 Known Issue: Test Suite Instability 🚨
The Vitest test suite is **currently broken** due to a severe memory leak, causing it to crash with a "heap out of memory" error. This is the highest priority technical issue to be resolved. The root cause is suspected to be in the test setup and mocking.
