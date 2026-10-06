export type WorkspaceSession = { user: { id: string }; accessToken: string; expiresAt: number };
let workspaceMode = false;
export function isWorkspaceSessionMode() {
  return workspaceMode;
}
let current: WorkspaceSession | null = null;
export function setWorkspaceSession(value: WorkspaceSession | null) {
  workspaceMode = true;
  current = value;
}
export function getWorkspaceSession() {
  if (current && current.expiresAt * 1000 <= Date.now()) current = null;
  return current;
}
export function parseWorkspaceSession(value: unknown): WorkspaceSession | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.userId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(data.userId) ||
    typeof data.accessToken !== 'string' ||
    !/^[A-Za-z0-9._-]{20,8192}$/.test(data.accessToken) ||
    typeof data.expiresAt !== 'number' ||
    !Number.isSafeInteger(data.expiresAt) ||
    data.expiresAt * 1000 <= Date.now() ||
    data.expiresAt * 1000 > Date.now() + 86400000
  )
    return null;
  try {
    const encoded = data.accessToken.split('.')[1];
    if (!encoded) return null;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bits = 0,
      value = 0,
      decoded = '';
    for (const character of encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) return null;
      value = (value << 6) | digit;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        decoded += String.fromCharCode((value >> bits) & 255);
      }
    }
    const claims = JSON.parse(decoded);
    if (claims.sub !== data.userId || claims.exp !== data.expiresAt) return null;
    // Signature/user authorization remains verified by the existing server request boundary.
  } catch {
    return null;
  }
  return { user: { id: data.userId }, accessToken: data.accessToken, expiresAt: data.expiresAt };
}
