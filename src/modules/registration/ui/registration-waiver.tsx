import type { RegistrationFormSchema } from '../domain/form-schema';

type WaiverField = RegistrationFormSchema['fields'][number];

export function RegistrationWaiver({
  field,
  inputName,
  preview = false,
  error,
}: {
  field: WaiverField;
  inputName?: string;
  preview?: boolean;
  error?: string;
}) {
  return (
    <fieldset
      data-invalid={Boolean(error)}
      className="min-w-0 rounded-xl border border-[var(--color-border)] p-4"
    >
      <legend className="px-1 font-bold">
        {field.label}
        {' (required)'}
      </legend>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {field.waiverText}
      </div>
      {field.helpText ? (
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">{field.helpText}</p>
      ) : null}
      <label className="mt-4 flex min-h-11 items-start gap-3">
        <input
          type="checkbox"
          name={preview ? undefined : (inputName ?? field.key)}
          aria-label={field.label}
          required={!preview}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `registration-field-error-${field.key}` : undefined}
          disabled={preview}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>I have read and agree to the {field.label.toLowerCase()}.</span>
      </label>
      {error ? (
        <p
          id={`registration-field-error-${field.key}`}
          className="mt-2 text-sm text-[var(--color-destructive)]"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
