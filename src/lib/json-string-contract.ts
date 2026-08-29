/** PostgreSQL jsonb rejects NUL and malformed UTF-16. Keep browser/server validation identical. */
export function isJsonPostgresCompatibleString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

export function assertJsonPostgresCompatible(value: unknown): void {
  if (typeof value === 'string') {
    if (!isJsonPostgresCompatibleString(value)) throw new TypeError('invalid_json_string');
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonPostgresCompatible(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (!isJsonPostgresCompatibleString(key)) throw new TypeError('invalid_json_string');
      assertJsonPostgresCompatible(item);
    }
  }
}
