import { z } from 'zod';

const clientEnvironmentSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const serverEnvironmentSchema = clientEnvironmentSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PUBLIC_REGISTRATION_RATE_LIMIT_SECRET: z.string().min(32),
});

export type ClientEnvironment = z.infer<typeof clientEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

const communicationEnvironmentSchema = z.object({
  JOB_PROCESSOR_CRON_SECRET: z.string().min(32).max(512),
  RESEND_API_KEY: z.string().min(20).max(300),
  RESEND_FROM_EMAIL: z.email().max(320),
});
export type CommunicationEnvironment = z.infer<typeof communicationEnvironmentSchema>;

const resendWebhookEnvironmentSchema = z.object({
  RESEND_API_KEY: z.string().min(20).max(300),
  RESEND_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9+/=_-]{16,500}$/u),
});
export type ResendWebhookEnvironment = z.infer<typeof resendWebhookEnvironmentSchema>;

const stripeWebhookEnvironmentSchema = z.object({
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_+/=-]{16,500}$/u),
});
export type StripeWebhookEnvironment = z.infer<typeof stripeWebhookEnvironmentSchema>;

const billingEnvironmentSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_(?:test|live)_[A-Za-z0-9]{20,300}$/u),
});
export type BillingEnvironment = z.infer<typeof billingEnvironmentSchema>;

function normalizeHostname(hostname: string): string {
  const withoutBrackets =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

  return withoutBrackets.toLowerCase().replace(/\.+$/u, '');
}

function parseIpv4(hostname: string): readonly number[] | null {
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^(?:0|[1-9]\d{0,2})$/u.test(octet))) {
    return null;
  }

  const values = octets.map(Number);
  return values.every((octet) => octet <= 255) ? values : null;
}

function parseIpv6(hostname: string): readonly number[] | null {
  if (!/^[\da-f:]+$/iu.test(hostname)) return null;

  const compression = hostname.indexOf('::');
  if (compression !== hostname.lastIndexOf('::')) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const words = part.split(':');
    if (words.some((word) => !/^[\da-f]{1,4}$/iu.test(word))) return null;
    return words.map((word) => Number.parseInt(word, 16));
  };

  if (compression === -1) {
    const words = parsePart(hostname);
    return words?.length === 8 ? words : null;
  }

  const left = parsePart(hostname.slice(0, compression));
  const right = parsePart(hostname.slice(compression + 2));
  if (!left || !right || left.length + right.length >= 8) return null;

  return [...left, ...Array.from({ length: 8 - left.length - right.length }, () => 0), ...right];
}

function isNonPublicIpv4(octets: readonly number[]): boolean {
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && second >= 18 && second <= 19) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function isNonPublicIpv6(words: readonly number[]): boolean {
  const first = words[0] ?? -1;
  const fifth = words[5] ?? -1;
  const sixth = words[6] ?? 0;
  const seventh = words[7] ?? 0;
  const hasOnlyTrailingWord = words.slice(0, 7).every((word) => word === 0);
  if (words.every((word) => word === 0) || (hasOnlyTrailingWord && seventh === 1)) {
    return true;
  }

  // Unique-local (fc00::/7), link-local (fe80::/10), and multicast/reserved (ff00::/8).
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) {
    return true;
  }

  // 2001:db8::/32 is documentation-only and cannot be a deployable SaaS origin.
  if (first === 0x2001 && (words[1] ?? -1) === 0x0db8) return true;

  const embeddedIpv4 = (words.slice(0, 6).every((word) => word === 0) ||
    (words.slice(0, 5).every((word) => word === 0) && fifth === 0xffff)) && [
    sixth >> 8,
    sixth & 0xff,
    seventh >> 8,
    seventh & 0xff,
  ];

  return Boolean(embeddedIpv4 && isNonPublicIpv4(embeddedIpv4));
}

function rawHostname(raw: string): string {
  const authority = raw.slice(raw.indexOf('//') + 2).split(/[/?#]/u, 1)[0] ?? '';
  const withoutCredentials = authority.slice(authority.lastIndexOf('@') + 1);
  if (withoutCredentials.startsWith('[')) {
    return withoutCredentials.slice(1, withoutCredentials.indexOf(']'));
  }

  const portIndex = withoutCredentials.lastIndexOf(':');
  return portIndex > -1 && /^\d+$/u.test(withoutCredentials.slice(portIndex + 1))
    ? withoutCredentials.slice(0, portIndex)
    : withoutCredentials;
}

function hasAmbiguousIpv4Spelling(raw: string, hostname: string): boolean {
  return parseIpv4(hostname) !== null && rawHostname(raw) !== hostname;
}

function isPublicProductionHostname(raw: string, url: URL): boolean {
  const hostname = normalizeHostname(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  if (hasAmbiguousIpv4Spelling(raw, hostname)) return false;

  const ipv4 = parseIpv4(hostname);
  if (ipv4) return !isNonPublicIpv4(ipv4);

  const ipv6 = parseIpv6(hostname);
  return !ipv6 || !isNonPublicIpv6(ipv6);
}

/** Validates the single canonical origin used in externally shared links. */
export function getPublicAppOrigin(
  environment: Record<string, string | undefined> = process.env,
): string {
  const raw = environment.NEXT_PUBLIC_APP_URL;
  if (!raw) throw new Error('NEXT_PUBLIC_APP_URL is required for the public app origin');
  if (!z.string().url().safeParse(raw).success) {
    throw new Error('NEXT_PUBLIC_APP_URL must be a valid absolute URL');
  }
  const url = new URL(raw);
  const hostname = normalizeHostname(url.hostname);
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1';
  const production = environment.NODE_ENV === 'production';
  if (url.username || url.password) {
    throw new Error('NEXT_PUBLIC_APP_URL must not include credentials');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('NEXT_PUBLIC_APP_URL must be an origin without a path, query, or fragment');
  }
  if (production && (url.protocol !== 'https:' || !isPublicProductionHostname(raw, url))) {
    throw new Error('Production public app origin must use a publicly routable HTTPS origin');
  }
  if (url.protocol !== 'https:' && !localHost) {
    throw new Error('Public app origin must be secure unless it is explicit localhost');
  }
  return url.origin;
}

export function getClientEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ClientEnvironment {
  return clientEnvironmentSchema.parse(environment);
}

export function getServerEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ServerEnvironment {
  if (typeof window !== 'undefined') {
    throw new Error('Server environment cannot be read in the browser');
  }

  return serverEnvironmentSchema.parse(environment);
}

export function getCommunicationEnvironment(
  environment: Record<string, string | undefined> = process.env,
): CommunicationEnvironment {
  if (typeof window !== 'undefined')
    throw new Error('Server environment cannot be read in the browser');
  return communicationEnvironmentSchema.parse(environment);
}

export function getResendWebhookEnvironment(
  environment: Record<string, string | undefined> = process.env,
): ResendWebhookEnvironment {
  if (typeof window !== 'undefined')
    throw new Error('Server environment cannot be read in the browser');
  return resendWebhookEnvironmentSchema.parse(environment);
}

export function getStripeWebhookEnvironment(
  environment: Record<string, string | undefined> = process.env,
): StripeWebhookEnvironment {
  if (typeof window !== 'undefined')
    throw new Error('Server environment cannot be read in the browser');
  return stripeWebhookEnvironmentSchema.parse(environment);
}

export function getBillingEnvironment(
  environment: Record<string, string | undefined> = process.env,
): BillingEnvironment {
  if (typeof window !== 'undefined')
    throw new Error('Server environment cannot be read in the browser');
  return billingEnvironmentSchema.parse(environment);
}
