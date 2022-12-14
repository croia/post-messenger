module.exports = {
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{ts,tsx}',
    '!<rootDir>/node_modules/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  setupFiles: [],
  testEnvironment: 'jsdom',
  transform: {
    '.(js|jsx)': 'babel-jest',
    '.(ts|tsx)': [
      'ts-jest',
      {
        compiler: 'typescript',
        tsconfig: '<rootDir>/tsconfig-test.json',
      },
    ],
  },
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!auto-bind)',
  ],
};
