module.exports = {
  extends: ['expo', 'prettier'],
  plugins: ['prettier'],
  rules: {
    'prettier/prettier': 'warn',
  },
  ignorePatterns: ['/dist/*', '/node_modules/*'],
};
