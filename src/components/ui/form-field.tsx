import type { ReactNode } from 'react';

export type FormFieldProps = {
  children(input: { describedBy?: string; invalid: boolean }): ReactNode;
  description?: string;
  error?: string;
  htmlFor: string;
  label: string;
  required?: boolean;
};

export function FormField({
  children,
  description,
  error,
  htmlFor,
  label,
  required = false,
}: FormFieldProps) {
  const descriptionId = description ? `${htmlFor}-description` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field-group">
      <label className="field-label" data-required={required || undefined} htmlFor={htmlFor}>
        {label}
      </label>
      {description ? (
        <p className="field-description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      {children({ describedBy, invalid: Boolean(error) })}
      {error ? (
        <p className="field-error" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
