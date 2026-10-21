import { maxWorkers } from '../../config/jest.workers.cjs';

/** marked ships ESM only; pptxgenjs's dynamic imports of node built-ins need Babel's require form under Jest. */
const esModules = ['marked', 'pptxgenjs'].join('|');

export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
      },
    ],
  },
  transformIgnorePatterns: [`/node_modules/(?!(${esModules})/).*/`],
  moduleNameMapper: {
    '^~/(.*)$': '<rootDir>/src/$1',
  },
  setupFiles: ['<rootDir>/../../config/jest.setup.logging.cjs'],
  maxWorkers,
  restoreMocks: true,
  testTimeout: 60000,
};
