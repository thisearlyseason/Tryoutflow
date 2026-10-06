'use client';
import { useSearchParams } from 'next/navigation';
export function StartErrorMessage() {
  const params = useSearchParams();
  const error = params?.get('error');
  const message =
    error === 'slug_conflict'
      ? 'That workspace address is already in use. Please choose a different one.'
      : error === 'invalid_input'
        ? 'Check the organization name, workspace address, and timezone, then try again.'
        : error
          ? 'We could not create your organization. Please try again.'
          : null;
  return message ? (
    <p className="auth-alert" role="alert">
      {message}
    </p>
  ) : null;
}
