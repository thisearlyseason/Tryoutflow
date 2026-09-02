'use client';

import { useEffect, useState } from 'react';

import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { Input } from '../../../components/ui/input';

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

const timezones = getTimezones();

type TimezonePickerProps = {
  describedBy?: string;
};

export function TimezonePicker({ describedBy }: TimezonePickerProps) {
  const [timezone, setTimezone] = useState('');

  useEffect(() => {
    const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezones.includes(detectedTimezone)) setTimezone(detectedTimezone);
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
