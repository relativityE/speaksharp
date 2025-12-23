// src/test/mocks/server.ts - For unit tests
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Set up the server with our handlers
export const server = setupServer(...handlers);

// Server management utilities
export const startMockServer = () => {
  server.listen({ onUnhandledRequest: 'warn', });
};

export const stopMockServer = () => {
  server.close();
};

export const resetMockServer = () => {
  server.resetHandlers();
};
