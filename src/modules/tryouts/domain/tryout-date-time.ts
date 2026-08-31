import { z } from 'zod';

const browserLocalDateTime =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/u;

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

export function parseTryoutDateTime(value: string | undefined, timeZone: string): Date | null {
  if (!value) return null;
  if (z.iso.datetime({ offset: true }).safeParse(value).success) return new Date(value);
  const match = browserLocalDateTime.exec(value);
  if (!match?.groups) return null;
  const desired = {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
    second: Number(match.groups.second ?? '0'),
  };
  const localAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  const utcDate = new Date(localAsUtc);
  if (
    utcDate.getUTCFullYear() !== desired.year ||
    utcDate.getUTCMonth() + 1 !== desired.month ||
    utcDate.getUTCDate() !== desired.day ||
    utcDate.getUTCHours() !== desired.hour ||
    utcDate.getUTCMinutes() !== desired.minute ||
    utcDate.getUTCSeconds() !== desired.second
  )
    return null;
  let candidate = localAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(candidate, timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = localAsUtc - (representedAsUtc - candidate);
  }
  const roundTrip = zonedParts(candidate, timeZone);
  return Object.entries(desired).every(
    ([part, expected]) => roundTrip[part as keyof typeof roundTrip] === expected,
  )
    ? new Date(candidate)
    : null;
}
