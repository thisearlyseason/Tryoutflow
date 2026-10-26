// Preserve the existing public build-variable names; never inline arbitrary env.
const names = new Set([
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_REVENUECAT_APPLE_KEY',
  'EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY',
]);
module.exports = ({ types: t }) => ({
  visitor: {
    MemberExpression(path) {
      const n = path.node;
      if (
        !n.computed &&
        t.isIdentifier(n.property) &&
        names.has(n.property.name) &&
        t.isMemberExpression(n.object) &&
        !n.object.computed &&
        t.isIdentifier(n.object.object, { name: 'process' }) &&
        t.isIdentifier(n.object.property, { name: 'env' })
      ) {
        const value = process.env[n.property.name];
        path.replaceWith(
          value === undefined
            ? t.unaryExpression('void', t.numericLiteral(0))
            : t.stringLiteral(value),
        );
      }
    },
  },
});
module.exports.publicNames = [...names];
