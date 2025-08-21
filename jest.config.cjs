module.exports = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  transform: {
    '^.+\\.(js|jsx|mjs)$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css|less)$': '<rootDir>/__mocks__/styleMock.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    'assemblyai': '<rootDir>/__mocks__/assemblyai.js',
    '^import.meta$': '<rootDir>/__mocks__/importMetaEnvMock.js'
  },
  testPathIgnorePatterns: ['/node_modules/', '/playwright-tests/'],
};
