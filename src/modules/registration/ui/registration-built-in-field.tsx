import { Input } from '@/components/ui/input';
import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import type { RegistrationBuiltInField } from '../domain/form-schema';

export function RegistrationBuiltInFieldInput({
  field,
  divisions,
  positions,
  error,
  defaultValue,
}: {
  field: RegistrationBuiltInField;
  error?: string;
  defaultValue?: string;
  divisions: { id: string; name: string }[];
  positions: { id: string; name: string }[];
}) {
  if (!field.enabled) return null;
  if (field.key === 'divisionId' && divisions.length <= 1) return null;
  if (field.key === 'positionId' && positions.length === 0) {
    return field.required ? (
      <p role="alert">The organizer needs to add positions before registration can be completed.</p>
    ) : null;
  }
  const choices =
    field.key === 'divisionId' ? divisions : field.key === 'positionId' ? positions : null;
  const examples: Record<string, string> = {
    givenName: FIELD_EXAMPLES.athleteGivenName,
    familyName: FIELD_EXAMPLES.athleteFamilyName,
    guardianName: FIELD_EXAMPLES.guardianName,
    guardianEmail: FIELD_EXAMPLES.guardianEmail,
    guardianPhone: FIELD_EXAMPLES.guardianPhone,
  };
  const autocomplete: Record<string, string> = {
    givenName: 'given-name',
    familyName: 'family-name',
    guardianName: 'name',
    guardianEmail: 'email',
    guardianPhone: 'tel',
  };
  const errorId = error ? `registration-field-error-${field.key}` : undefined;
  return (
    <label className="grid gap-1">
      <span>
        {field.label}
        {field.required ? '' : ' (optional)'}
      </span>
      {choices ? (
        <select
          name={field.key}
          aria-label={field.label}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          defaultValue=""
          required={field.required}
          className="min-h-[var(--target-mobile)] w-full rounded-[var(--radius-control)] border p-2"
        >
          <option value="" disabled={field.required}>
            {field.required
              ? field.key === 'divisionId' && field.label === 'Division'
                ? 'Select a division'
                : `Select ${field.label.toLowerCase()}`
              : field.key === 'divisionId'
                ? 'Assign automatically'
                : 'Unassigned'}
          </option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
      ) : (
        <Input
          defaultValue={defaultValue}
          name={field.key}
          aria-label={field.label}
          aria-invalid={error ? true : undefined}
          required={field.required}
          type={
            field.key === 'birthDate'
              ? 'date'
              : field.key === 'guardianEmail'
                ? 'email'
                : field.key === 'guardianPhone'
                  ? 'tel'
                  : 'text'
          }
          autoComplete={autocomplete[field.key]}
          placeholder={examples[field.key]}
          aria-describedby={
            [field.key === 'birthDate' ? 'public-registration-birth-date-help' : undefined, errorId]
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
      )}
      {field.key === 'birthDate' ? (
        <small className="text-[var(--color-text-muted)]" id="public-registration-birth-date-help">
          Example: September 15, 2012.
        </small>
      ) : null}
      {error ? (
        <small id={errorId} className="text-[var(--color-destructive)]">
          {error}
        </small>
      ) : null}
    </label>
  );
}
