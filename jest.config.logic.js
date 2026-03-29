module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['<rootDir>/jest-setup.logic.js'],
  roots: ['<rootDir>/src'],
  transformIgnorePatterns: [
    'node_modules/(?!(expo|@expo|react-native|@react-native|@google/generative-ai)/)',
  ],
};
