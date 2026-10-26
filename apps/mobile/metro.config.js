const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { createHash } = require('node:crypto');
const { publicNames } = require('./public-environment.cjs');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  // Never reuse a transformed bundle from another public API/RevenueCat setup.
  cacheVersion: createHash('sha256')
    .update(JSON.stringify(publicNames.map((name) => [name, process.env[name] ?? null])))
    .digest('hex'),
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
