import { z } from 'zod';

import { isIanaTimeZone } from '../../organizations/domain/organization';

const storedBasicsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  sport: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(100),
  registration_starts_at: z.iso.datetime({ offset: true }).nullable(),
  registration_ends_at: z.iso.datetime({ offset: true }).nullable(),
});

export type TryoutBasicsValues = Readonly<{
  name: string;
  sport: string;
  timezone: string;
  registrationStartsAt: string;
  registrationEndsAt: string;
}>;

export function toDateTimeLocalValue(value: string | null, timezone: string): string {
  if (!value || !isIanaTimeZone(timezone)) return '';
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function parseTryoutBasics(input: unknown): TryoutBasicsValues | null {
  const parsed = storedBasicsSchema.safeParse(input);
  if (!parsed.success || !isIanaTimeZone(parsed.data.timezone)) return null;
  return {
    name: parsed.data.name,
    sport: parsed.data.sport,
    timezone: parsed.data.timezone,
    registrationStartsAt: toDateTimeLocalValue(
      parsed.data.registration_starts_at,
      parsed.data.timezone,
    ),
    registrationEndsAt: toDateTimeLocalValue(
      parsed.data.registration_ends_at,
      parsed.data.timezone,
    ),
  };
}
