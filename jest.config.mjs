export default {
  testEnvironment: './packages/jest-happy-dom-extended/dist/index.cjs',
  testMatch: ['<rootDir>/packages/jest-happy-dom-extended/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      '@swc/jest',
      { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
    ],
  },
  clearMocks: true,
  restoreMocks: true,
};
