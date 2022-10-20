// const { defaults: tsjPreset } = require('ts-jest/presets');

// console.log(tsjPreset);

module.exports = {
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{ts,tsx}',
    '!<rootDir>/node_modules/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  preset: 'ts-jest',
  setupFiles: [],
  testEnvironment: 'jsdom',
  transform: {
    '.(js|jsx)': 'babel-jest',
    '.(ts|tsx)': [
      'ts-jest',
      {
        compiler: 'ttypescript',
        tsconfig: '<rootDir>/tsconfig-test.json',
      },
    ],
  },
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!auto-bind)',
  ],
};
