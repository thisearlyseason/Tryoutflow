import { getWorkspaceSession, isWorkspaceSessionMode } from './workspace-session';
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};
function createAuthClient() {
  return createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } },
  );
}
let legacyAuth: ReturnType<typeof createAuthClient> | undefined;
// The dashboard owns authentication. Do not initialize a second stored session on app startup.
export const supabase = new Proxy({} as ReturnType<typeof createAuthClient>, {
  get(_target, property) {
    legacyAuth ??= createAuthClient();
    const value = Reflect.get(legacyAuth, property);
    return typeof value === 'function' ? value.bind(legacyAuth) : value;
  },
});
export async function api<T>(path: string, body?: unknown, expectedUserId?: string): Promise<T> {
  const bridged = getWorkspaceSession();
  const session = bridged
    ? { user: bridged.user, access_token: bridged.accessToken }
    : isWorkspaceSessionMode()
      ? null
      : (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Please sign in again.');
  if (expectedUserId && session.user.id !== expectedUserId)
    throw new Error('Your account changed. Review this request again.');
  const origin = process.env.EXPO_PUBLIC_API_URL!;
  if (!origin.startsWith('https://') && !__DEV__)
    throw new Error('A secure service connection is required.');
  const response = await fetch(`${origin}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error ?? 'Please try again.');
    if (data.code === 'intent_expired') error.name = 'IntentExpired';
    throw error;
  }
  return data as T;
}
