export type SnapshotPrimitive = string | number | boolean | null;

type PrimitiveNormalizer = (value: unknown) => SnapshotPrimitive | undefined;

type SnapshotOptions = Readonly<{
  rejectUnknownKeys?: boolean;
}>;

/**
 * Copies own allow-listed fields from an untrusted record into an immutable null-prototype record.
 * Each field value is read exactly once; any proxy/accessor failure invalidates the whole snapshot.
 */
export function snapshotOwnPrimitives(
  input: unknown,
  normalizers: Readonly<Record<string, PrimitiveNormalizer>>,
  options: SnapshotOptions = {},
): Readonly<Record<string, SnapshotPrimitive>> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;

  try {
    const allowedKeys = Object.keys(normalizers);
    if (options.rejectUnknownKeys) {
      const allowed = new Set(allowedKeys);
      const ownKeys = Reflect.ownKeys(input);
      if (ownKeys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    }

    const snapshot = Object.create(null) as Record<string, SnapshotPrimitive>;
    for (const key of allowedKeys) {
      if (!Object.hasOwn(input, key)) continue;
      const value = Reflect.get(input, key);
      const normalized = normalizers[key]?.(value);
      if (normalized !== undefined) snapshot[key] = normalized;
    }
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}
