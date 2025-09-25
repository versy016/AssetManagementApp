const { getDefaultConfig } = require('@expo/metro-config');
const metroResolver = require('metro-resolver');

const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push('cjs');

// Enable package exports only for Web builds
const isWeb = process.env.EXPO_OS === 'web' || process.env.WEB === 'true';
config.resolver.unstable_enablePackageExports = !!isWeb;

// Redirect legacy private HMR path to the public one for web bundling
const hmrClientCandidates = [
  'metro-runtime/src/modules/HMRClient.js',
  'metro-runtime/modules/HMRClient.js',
];
let hmrClientResolved = null;
for (const m of hmrClientCandidates) {
  try { hmrClientResolved = require.resolve(m); break; } catch {}
}

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'metro-runtime/private/modules/HMRClient' && hmrClientResolved) {
    return { type: 'sourceFile', filePath: hmrClientResolved };
  }
  if (typeof originalResolveRequest === 'function') {
    return originalResolveRequest(context, moduleName, platform);
  }
  return metroResolver.resolve(context, moduleName, platform);
};

module.exports = config;
