'use client';
import { useId } from 'react';
export function ManagedBillingCountryField({
  value,
  onChange,
  disabled = false,
  label = 'Billing country',
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  return (
    <div className="my-4 rounded-xl border p-4">
      <label htmlFor={id} className="block font-bold">
        {label}
      </label>
      <select
        id={id}
        name="billingCountryDeclaration"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required
        aria-describedby={id + '-help'}
        className="mt-2 w-full rounded-lg border p-3"
      >
        <option value="">Select billing country</option>
        <option value="CA">Canada</option>
        <option value="US">United States</option>
      </select>
      <p id={id + '-help'} className="mt-2 text-sm">
        Select the country of the billing address you will use at checkout. This is your
        declaration; it does not verify your residence or replace the payment provider’s checks.
      </p>
    </div>
  );
}
