const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package.json "exports" field resolution so that
// pdfjs-dist subpath imports (e.g. pdfjs-dist/legacy/build/pdf) resolve correctly.
config.resolver.unstable_enablePackageExports = true;

// pdfjs-dist optionally requires 'canvas' for server-side rendering.
// Stub it out — text extraction does not need it in React Native.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  canvas: require.resolve('./src/mocks/emptyModule.js'),
};

module.exports = config;
