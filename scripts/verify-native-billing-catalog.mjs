import { readFile } from 'node:fs/promises';
import { BILLING_PRODUCT_KEYS } from '../src/modules/subscriptions/domain/billing-products.ts';
import { nativeProductIdentifier } from './lib/native-catalog.ts';

// Read-only provider configuration check. Never grants access or creates a purchase.
const args = process.argv.slice(2);
const platform = args[args.indexOf('--platform') + 1];
const keyFileIndex = args.indexOf('--key-file');

try {
  if (!['apple', 'google'].includes(platform)) {
    throw new Error('Choose --platform apple or --platform google.');
  }
  const key = (
    keyFileIndex >= 0
      ? await readFile(args[keyFileIndex + 1], 'utf8')
      : (process.env[`EXPO_PUBLIC_REVENUECAT_${platform.toUpperCase()}_KEY`] ?? '')
  ).trim();
  if (!key.startsWith(platform === 'apple' ? 'appl_' : 'goog_')) {
    throw new Error('Provide the matching public native SDK key via environment or --key-file.');
  }
  const mappings = Object.fromEntries(
    BILLING_PRODUCT_KEYS.map((product) => [
      product,
      process.env[`REVENUECAT_${platform.toUpperCase()}_${product.toUpperCase()}`],
    ]),
  );
  const missing = BILLING_PRODUCT_KEYS.filter((product) => !mappings[product]);
  if (missing.length) throw new Error(`Missing server product mappings: ${missing.join(', ')}.`);
  if (new Set(Object.values(mappings)).size !== BILLING_PRODUCT_KEYS.length) {
    throw new Error('Server product mappings must be unique.');
  }
  // This documented endpoint does not require an existing customer.
  const response = await fetch(
    'https://api.revenuecat.com/v1/subscribers/11111111-1111-4111-8111-111111111111/offerings',
    {
      headers: {
        Authorization: `Bearer ${key}`,
        'X-Platform': platform === 'apple' ? 'ios' : 'android',
      },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`RevenueCat catalog request failed (HTTP ${response.status}).`);
  const data = await response.json();
  const current = data.offerings?.find(
    (offering) => offering.identifier === data.current_offering_id,
  );
  if (!current || !Array.isArray(current.packages))
    throw new Error('No current offering is configured.');
  const mismatches = BILLING_PRODUCT_KEYS.filter((product) => {
    const matches = current.packages.filter((item) => item.identifier === product);
    return (
      matches.length !== 1 || nativeProductIdentifier(platform, matches[0]) !== mappings[product]
    );
  });
  const unexpected = current.packages.filter(
    (item) => !BILLING_PRODUCT_KEYS.includes(item.identifier),
  );
  if (mismatches.length || unexpected.length) {
    throw new Error(
      `Catalog mismatch: ${mismatches.join(', ') || 'unexpected packages'}; ${unexpected.length} unexpected package(s).`,
    );
  }
  console.log(
    JSON.stringify(
      {
        platform,
        offering: current.identifier,
        matchedPackages: BILLING_PRODUCT_KEYS.length,
        result: 'Catalog matches server product mappings.',
        scope: 'Configuration only; store availability and device purchases are not verified.',
      },
      null,
      2,
    ),
  );
} catch (error) {
  // Do not print raw provider responses, credentials, or network error objects.
  const message =
    error instanceof Error && !('cause' in error) ? error.message : 'Catalog check failed.';
  console.error(message);
  process.exitCode = 1;
}
