export const NATIVE_CONTEXT_COOKIE = 'tryoutflow-native';
export function nativeContext(cookieHeader: string | null) {
  const value = cookieHeader
    ?.split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${NATIVE_CONTEXT_COOKIE}=`))
    ?.split('=')[1];
  return value === 'apple' || value === 'google' ? value : null;
}
