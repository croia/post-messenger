module.exports = {
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!<rootDir>/node_modules/', '!src/types/**/*', '!src/generated/**/*'],
  globals: {
    'ts-jest': {
      compiler: 'ttypescript',
      tsconfig: '<rootDir>/tsconfig-test.json',
    },
  },
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  preset: 'ts-jest',
  setupFiles: [],
  testEnvironment: 'jsdom',
  transform: {
    '.(js|jsx)': 'babel-jest',
    '.(ts|tsx)': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!auto-bind)',
  ],
};
