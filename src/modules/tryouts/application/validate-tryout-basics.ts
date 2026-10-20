import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { isIanaTimeZone } from '../../organizations/domain/organization';
import { parseTryoutDateTime } from '../domain/tryout-date-time';

export type TryoutBasicsField =
  'name' | 'sport' | 'timezone' | 'registrationStartsAt' | 'registrationEndsAt';

export type TryoutBasicsInput = Readonly<Record<TryoutBasicsField, string>>;

export type TryoutBasicsValidation =
  | { ok: true; value: TryoutBasicsInput }
  | { ok: false; fieldErrors: Partial<Record<TryoutBasicsField, string>> };

const limits: Record<TryoutBasicsField, number> = {
  name: 160,
  sport: 80,
  timezone: 100,
  registrationStartsAt: 32,
  registrationEndsAt: 32,
};

function text(input: unknown, field: TryoutBasicsField): string {
  if (!input || typeof input !== 'object') return '';
  const value = (input as Partial<Record<TryoutBasicsField, unknown>>)[field];
  return typeof value === 'string' ? value.trim() : '';
}

export function boundedTryoutBasicsValues(input: unknown): TryoutBasicsInput {
  return {
    name: text(input, 'name').slice(0, limits.name),
    sport: text(input, 'sport').slice(0, limits.sport),
    timezone: text(input, 'timezone').slice(0, limits.timezone),
    registrationStartsAt: text(input, 'registrationStartsAt').slice(0, limits.registrationStartsAt),
    registrationEndsAt: text(input, 'registrationEndsAt').slice(0, limits.registrationEndsAt),
  };
}

export function validateTryoutBasics(input: unknown): TryoutBasicsValidation {
  const value = {
    name: text(input, 'name'),
    sport: text(input, 'sport'),
    timezone: text(input, 'timezone'),
    registrationStartsAt: text(input, 'registrationStartsAt'),
    registrationEndsAt: text(input, 'registrationEndsAt'),
  } satisfies TryoutBasicsInput;
  const fieldErrors: Partial<Record<TryoutBasicsField, string>> = {};

  if (!value.name) fieldErrors.name = 'Enter a tryout name.';
  else if (value.name.length > limits.name)
    fieldErrors.name = 'Tryout name must be 160 characters or fewer.';

  if (!value.sport) fieldErrors.sport = 'Enter a sport.';
  else if (value.sport.length > limits.sport)
    fieldErrors.sport = 'Sport must be 80 characters or fewer.';

  const validTimezone = Boolean(value.timezone) && isIanaTimeZone(value.timezone);
  if (!value.timezone) fieldErrors.timezone = 'Enter an IANA timezone.';
  else if (value.timezone.length > limits.timezone)
    fieldErrors.timezone = 'Timezone must be 100 characters or fewer.';
  else if (!validTimezone)
    fieldErrors.timezone = `Enter a valid IANA timezone such as ${FIELD_EXAMPLES.timezone}.`;

  const parsingTimezone = validTimezone ? value.timezone : 'UTC';
  const startsAt = value.registrationStartsAt
    ? parseTryoutDateTime(value.registrationStartsAt, parsingTimezone)
    : null;
  const endsAt = value.registrationEndsAt
    ? parseTryoutDateTime(value.registrationEndsAt, parsingTimezone)
    : null;

  if (!value.registrationStartsAt)
    fieldErrors.registrationStartsAt = 'Enter when registration opens.';
  else if (value.registrationStartsAt.length > limits.registrationStartsAt || !startsAt)
    fieldErrors.registrationStartsAt = 'Enter a valid local date and time.';

  if (!value.registrationEndsAt) fieldErrors.registrationEndsAt = 'Enter when registration closes.';
  else if (value.registrationEndsAt.length > limits.registrationEndsAt || !endsAt)
    fieldErrors.registrationEndsAt = 'Enter a valid local date and time.';
  else if (startsAt && endsAt.getTime() <= startsAt.getTime())
    fieldErrors.registrationEndsAt = 'Registration must close after it opens.';

  return Object.keys(fieldErrors).length > 0 ? { ok: false, fieldErrors } : { ok: true, value };
}
