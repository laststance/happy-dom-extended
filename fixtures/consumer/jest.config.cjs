module.exports = {
  testEnvironment: 'jest-happy-dom-extended',
  setupFiles: ['<rootDir>/setup.cjs'],
  setupFilesAfterEnv: ['<rootDir>/setup-after-env.cjs'],
  testMatch: ['<rootDir>/*.test.cjs'],
}
