module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/dist/',
    '/node_modules/',
    '/fixtures/',
    '.eslintrc.js',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/fixtures/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
