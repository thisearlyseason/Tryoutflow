import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { Cookie } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { z } from 'zod';

export const demoEmail = 'demo.owner@badlands.example.test';
const bindingSchema = z.strictObject({
  runId: z.string().regex(/^[a-zA-Z0-9_-]{12,100}$/u),
  project: z.string().regex(/^tryoutflow-lint-verify-[0-9a-f]{12}$/u),
  proofSHA256: z.string().regex(/^[0-9a-f]{64}$/u),
  appOrigin: z.literal('http://127.0.0.1:3112'),
  apiOrigin: z.literal('http://127.0.0.1:54321'),
  email: z.literal(demoEmail),
});
export type VisualSessionBinding = z.infer<typeof bindingSchema>;
const cookieSchema = z.strictObject({
  name: z.string().regex(/^sb-127-auth-token(?:\.\d+)?$/u),
  value: z.string().min(1).max(16_384),
  domain: z.literal('127.0.0.1'),
  path: z.literal('/'),
  expires: z.number().finite(),
  httpOnly: z.boolean(),
  secure: z.literal(false),
  sameSite: z.enum(['Strict', 'Lax', 'None']),
});
const cacheSchema = z.strictObject({
  schemaVersion: z.literal(1),
  binding: bindingSchema,
  userId: z.uuid(),
  expiresAt: z.number().int().positive(),
  cookies: z.array(cookieSchema).min(1).max(16),
});
export type VerifiedVisualSession = {
  userId: string;
  email: string;
  emailConfirmed: boolean;
  expiresAt: number;
};
type VerifySession = (cookies: Cookie[]) => Promise<VerifiedVisualSession>;

function privateDirectory(path: string) {
  const dir = dirname(path);
  const stat = lstatSync(dir);
  if (
    !isAbsolute(path) ||
    realpathSync(dir) !== dir ||
    !stat.isDirectory() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o777) !== 0o700
  )
    throw new Error('Visual session cache requires an owned private directory.');
}
function privateRead(path: string): string | undefined {
  privateDirectory(path);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error('Visual session cache cannot be opened safely.');
  }
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.nlink !== 1 ||
      stat.size > 128 * 1024
    )
      throw new Error('Visual session cache permissions or size are invalid.');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
function validIdentity(session: VerifiedVisualSession, now: number, userId?: string) {
  if (
    !z.uuid().safeParse(session.userId).success ||
    (userId !== undefined && session.userId !== userId) ||
    session.email !== demoEmail ||
    !session.emailConfirmed ||
    !Number.isSafeInteger(session.expiresAt) ||
    session.expiresAt <= now
  )
    throw new Error('Visual demo session is not verified and current.');
}
export function visualSessionCacheConfiguration(environment = process.env) {
  const path = environment.TRYOUTFLOW_VISUAL_SESSION_CACHE_PATH;
  if (!path) {
    if (environment.TRYOUTFLOW_VISUAL_SESSION_RUN_ID)
      throw new Error('Visual session cache configuration is incomplete.');
    return undefined;
  }
  const proofBytes = readFileSync(resolve('supabase/.temp/isolated-release-proof.json'));
  const proof = JSON.parse(proofBytes.toString()) as {
    projectId?: string;
    freshCreatedForThisRun?: boolean;
  };
  const binding = bindingSchema.parse({
    runId: environment.TRYOUTFLOW_VISUAL_SESSION_RUN_ID,
    project: environment.TRYOUTFLOW_ISOLATED_RELEASE_PROJECT,
    proofSHA256: environment.TRYOUTFLOW_VISUAL_SESSION_PROOF_SHA256,
    appOrigin: environment.TRYOUTFLOW_VISUAL_SESSION_APP_ORIGIN,
    apiOrigin: environment.TRYOUTFLOW_VISUAL_SESSION_API_ORIGIN,
    email: demoEmail,
  });
  if (
    proof.freshCreatedForThisRun !== true ||
    proof.projectId !== binding.project ||
    createHash('sha256').update(proofBytes).digest('hex') !== binding.proofSHA256
  )
    throw new Error('Visual session cache isolated proof does not match.');
  const publishableKey = environment.TRYOUTFLOW_VISUAL_SESSION_PUBLISHABLE_KEY;
  if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]+$/u.test(publishableKey))
    throw new Error('Visual session verification requires the local publishable key.');
  privateDirectory(path);
  return { path, binding, publishableKey };
}
export async function readVisualSession(
  path: string,
  binding: VisualSessionBinding,
  verify: VerifySession,
  now = Date.now(),
): Promise<Cookie[] | undefined> {
  const raw = privateRead(path);
  if (raw === undefined) return undefined;
  // Never include parsed session data in validation errors.
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Visual session cache is invalid.');
  }
  const parsed = cacheSchema.safeParse(json);
  if (!parsed.success) throw new Error('Visual session cache is invalid.');
  const cache = parsed.data;
  if (JSON.stringify(cache.binding) !== JSON.stringify(bindingSchema.parse(binding)))
    throw new Error('Visual session cache binding does not match this run.');
  if (cache.expiresAt <= now || cache.expiresAt > now + 30 * 60_000)
    throw new Error('Visual session cache has expired or has an invalid lifetime.');
  const session = await verify(cache.cookies);
  validIdentity(session, now, cache.userId);
  return cache.cookies;
}
export function reserveVisualSessionBootstrap(path: string) {
  privateDirectory(path);
  const fd = openSync(
    path + '.bootstrap',
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  closeSync(fd);
}
export async function writeVisualSession(
  path: string,
  binding: VisualSessionBinding,
  cookies: Cookie[],
  verify: VerifySession,
  now = Date.now(),
) {
  privateDirectory(path);
  if (privateRead(path) !== undefined) throw new Error('Visual session cache already exists.');
  const selected = cookies.filter((cookie) => /^sb-127-auth-token(?:\.\d+)?$/u.test(cookie.name));
  const session = await verify(selected);
  validIdentity(session, now);
  const value = cacheSchema.safeParse({
    schemaVersion: 1,
    binding,
    userId: session.userId,
    expiresAt: Math.min(session.expiresAt, now + 30 * 60_000),
    cookies: selected,
  });
  if (!value.success) throw new Error('Visual demo session cookies are invalid.');
  const temporary = path + '.' + randomUUID();
  const fd = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(value.data));
    closeSync(fd);
    renameSync(temporary, path);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {
      /* Already closed before atomic rename. */
    }
    unlinkSync(temporary);
    throw error;
  }
}

/** No SDK token refresh or redirect may escape the verifier's user-only transport. */
export function visualUserOnlyFetch(
  apiOrigin: string,
  transport: typeof fetch = fetch,
  onDenied?: () => void,
): typeof fetch {
  if (apiOrigin !== 'http://127.0.0.1:54321')
    throw new Error('Visual verifier API origin is invalid.');
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request ? request.url : String(input));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (
      url.origin !== apiOrigin ||
      url.pathname !== '/auth/v1/user' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      method !== 'GET'
    ) {
      onDenied?.();
      // A terminal SDK response prevents its network-error retry loop; no transport dispatch.
      return new Response(
        JSON.stringify({
          message: 'Visual verifier transport denied.',
          code: 'visual_verifier_transport_denied',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return transport(input, { ...init, redirect: 'error', credentials: 'omit' });
  };
}
export async function verifyVisualSession(
  cookies: Cookie[],
  configuration: { binding: VisualSessionBinding; publishableKey: string },
  transport: typeof fetch = fetch,
): Promise<VerifiedVisualSession> {
  let denied = false;
  const client = createServerClient(configuration.binding.apiOrigin, configuration.publishableKey, {
    global: {
      fetch: visualUserOnlyFetch(configuration.binding.apiOrigin, transport, () => {
        denied = true;
      }),
    },
    auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => cookies,
      setAll: () => {
        // Reject after SDK callbacks complete; never throw through its auth lock.
        denied = true;
      },
    },
  });
  try {
    const { data, error } = await client.auth.getUser();
    if (denied || error || !data.user) throw new Error('Unverified user.');
    const session = await client.auth.getSession();
    if (denied || session.error || !session.data.session?.expires_at)
      throw new Error('Session expiry unavailable.');
    return {
      userId: data.user.id,
      email: data.user.email ?? '',
      emailConfirmed: Boolean(data.user.email_confirmed_at),
      expiresAt: session.data.session.expires_at * 1000,
    };
  } catch {
    throw new Error('Visual demo session verification failed.');
  }
}
