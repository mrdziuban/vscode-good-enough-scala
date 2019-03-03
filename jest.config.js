module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '(client|server)/test/.*\\.test\\.(j|t)s$',
  clearMocks: true,
  verbose: true
};
