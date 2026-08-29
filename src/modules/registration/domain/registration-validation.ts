/**
 * Canonical registration whitespace, shared with migration 025:
 * TAB–CR, SPACE, NEL, NBSP, OGHAM SPACE MARK, U+2000–U+200A,
 * LINE/PARAGRAPH SEPARATOR, NARROW NBSP, MEDIUM MATHEMATICAL SPACE,
 * IDEOGRAPHIC SPACE, and BOM/ZWNBSP.
 */
const REGISTRATION_WHITESPACE =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/gu;
const CONTAINS_REGISTRATION_WHITESPACE =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u;

export function canonicalRegistrationText(value: string): string {
  return value.replace(REGISTRATION_WHITESPACE, ' ').replace(/^ +| +$/gu, '');
}

export function registrationCodePointLength(value: string): number {
  return Array.from(value).length;
}

const EMAIL_PATTERN = /^[^@]+@[^@]+\.[^@]+$/u;
const PHONE_PATTERN = /^\+?[0-9 ()-]+$/u;

export function isValidRegistrationEmail(value: string): boolean {
  const normalized = canonicalRegistrationText(value);
  return (
    registrationCodePointLength(normalized) >= 3 &&
    registrationCodePointLength(normalized) <= 254 &&
    !CONTAINS_REGISTRATION_WHITESPACE.test(normalized) &&
    EMAIL_PATTERN.test(normalized)
  );
}

export function isValidRegistrationPhone(value: string): boolean {
  const normalized = canonicalRegistrationText(value);
  const digits = normalized.replace(/[^0-9]/gu, '');
  return (
    registrationCodePointLength(normalized) >= 7 &&
    registrationCodePointLength(normalized) <= 32 &&
    PHONE_PATTERN.test(normalized) &&
    digits.length >= 7 &&
    digits.length <= 15
  );
}

export function isValidRegistrationCalendarDate(value: string): boolean {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isValidBirthDate(value: string, now = new Date()): boolean {
  if (!isValidRegistrationCalendarDate(value)) return false;
  const currentDate = `${String(now.getUTCFullYear()).padStart(4, '0')}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return value <= currentDate;
}
