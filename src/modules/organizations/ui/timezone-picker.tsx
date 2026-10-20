'use client';

import { useEffect, useState } from 'react';

import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { Input } from '../../../components/ui/input';
import { isIanaTimeZone } from '../domain/organization';

const fallbackTimezones = [
  'America/Edmonton',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Toronto',
  'Europe/London',
];

function getTimezones(): string[] {
  try {
    const supported = Intl.supportedValuesOf?.('timeZone');
    return supported?.length ? supported : fallbackTimezones;
  } catch {
    return fallbackTimezones;
  }
}

type TimezonePickerProps = {
  describedBy?: string;
};

export function TimezonePicker({ describedBy }: TimezonePickerProps) {
  const [timezone, setTimezone] = useState('');
  // Node and browser ICU timezone lists differ. Keep the first render identical.
  const [timezones, setTimezones] = useState(fallbackTimezones);

  useEffect(() => {
    const supportedTimezones = getTimezones();
    setTimezones(supportedTimezones);
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // supportedValuesOf lists canonical zones, not every valid identifier (UTC
    // and browser aliases may be omitted). Validate detection independently.
    if (detectedTimezone && isIanaTimeZone(detectedTimezone)) {
      setTimezones([...new Set([...supportedTimezones, detectedTimezone])]);
      setTimezone(detectedTimezone);
    }
  }, []);

  return (
    <>
      <Input
        aria-describedby={describedBy}
        autoComplete="off"
        id="timezone"
        list="organization-timezone-options"
        name="timezone"
        onChange={(event) => setTimezone(event.target.value)}
        placeholder={FIELD_EXAMPLES.timezone}
        required
        value={timezone}
      />
      <datalist id="organization-timezone-options">
        {timezones.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
    </>
  );
}
