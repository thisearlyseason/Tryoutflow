module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [require.resolve('./public-environment.cjs')],
};
