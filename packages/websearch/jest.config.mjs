import { maxWorkers } from '../../config/jest.workers.cjs';

const esModules = [
  'cheerio',
  'domelementtype',
  'domhandler',
  'dom-serializer',
  'domutils',
  'entities',
  'htmlparser2',
  'parse5',
  'parse5-htmlparser2-tree-adapter',
  'parse5-parser-stream',
].join('|');

export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/__tests__/fixtures/'],
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
  testTimeout: 15000,
};
