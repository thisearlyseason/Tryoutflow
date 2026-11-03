// Canonicals deliberately use the established public domain, never a preview host.
export const PUBLIC_ORIGIN = 'https://www.tryout.agency';
export const DISCOVERY_PATHS = [
  '/',
  '/features',
  '/pricing',
  '/demo',
  '/how-to',
  '/for/teams',
  '/for/clubs',
  '/for/associations',
  '/platforms',
  '/support',
  '/privacy',
  '/terms',
] as const;
export function publicIndexingEnabled(environment = process.env): boolean {
  return environment.VERCEL_ENV
    ? environment.VERCEL_ENV === 'production'
    : environment.NODE_ENV === 'production' && environment.NEXT_PUBLIC_APP_URL === PUBLIC_ORIGIN;
}
