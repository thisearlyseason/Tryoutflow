import { Input } from '@/components/ui/input';
import type { RegistrationFormSchema } from '../domain/form-schema';
import { RegistrationWaiver } from './registration-waiver';

export function RegistrationCustomField({
  field,
  inputName = field.key,
  error,
}: {
  field: RegistrationFormSchema['fields'][number];
  inputName?: string;
  error?: string;
}) {
  const helpId = inputName.startsWith('response.')
    ? `staff-registration-response-${field.key}-help`
    : `public-registration-${field.key}-help`;
  if (field.enabled === false) return null;
  if (field.kind === 'consent' && field.waiverText)
    return <RegistrationWaiver field={field} inputName={inputName} error={error} />;
  const errorId = error ? `registration-field-error-${field.key}` : undefined;
  const describedBy =
    [field.kind === 'date' ? helpId : undefined, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <label className="grid gap-1">
      {field.kind === 'consent' || field.kind === 'checkbox' ? (
        <span>
          <input
            name={inputName}
            aria-label={field.label}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            type="checkbox"
            required={field.kind === 'consent'}
            className="min-h-[var(--target-mobile)] min-w-[var(--target-mobile)]"
          />{' '}
          {field.label}
        </span>
      ) : (
        <>
          <span>
            {field.label}
            {field.required ? '' : ' (optional)'}
          </span>
          {field.kind === 'select' ? (
            <select
              name={inputName}
              aria-label={field.label}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              defaultValue=""
              required={field.required}
              className="min-h-[var(--target-mobile)] rounded-[var(--radius-control)] border p-2"
            >
              <option disabled={field.required} value="">
                Select {field.label.toLowerCase()}
              </option>
              {field.options?.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          ) : field.kind === 'textarea' ? (
            <textarea
              name={inputName}
              aria-label={field.label}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              required={field.required}
              className="min-h-28 w-full rounded border p-3"
              maxLength={5000}
            />
          ) : (
            <Input
              name={inputName}
              aria-label={field.label}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              type={
                field.kind === 'date'
                  ? 'date'
                  : field.kind === 'email'
                    ? 'email'
                    : field.kind === 'phone'
                      ? 'tel'
                      : 'text'
              }
              required={field.required}
            />
          )}
        </>
      )}
      {field.kind === 'date' ? (
        <small className="text-[var(--color-text-muted)]" id={helpId}>
          {field.helpText ? `${field.helpText} ` : null}Example: September 15, 2012.
        </small>
      ) : field.helpText ? (
        <small className="text-[var(--color-text-muted)]">{field.helpText}</small>
      ) : null}
      {error ? (
        <small id={errorId} className="text-[var(--color-destructive)]">
          {error}
        </small>
      ) : null}
    </label>
  );
}
