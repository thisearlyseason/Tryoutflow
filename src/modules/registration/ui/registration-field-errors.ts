import type { RegistrationFormSchema } from '../domain/form-schema';
import { getBuiltInFields } from '../domain/built-in-fields';
import {
  canonicalRegistrationText,
  registrationCodePointLength,
  isValidRegistrationEmail,
  isValidRegistrationPhone,
  isValidRegistrationCalendarDate,
  isValidBirthDate,
} from '../domain/registration-validation';

export function registrationFieldError(
  errors: Record<string, string>,
  key: string,
): string | undefined {
  return Object.hasOwn(errors, key) ? errors[key] : undefined;
}
export function registrationFieldErrors(
  form: HTMLFormElement,
  schema?: RegistrationFormSchema,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const builtin = new Map(
    getBuiltInFields(schema ?? {}).map((field) => [field.key as string, field]),
  );
  const custom = new Map(schema?.fields.map((field) => [field.key, field]) ?? []);
  for (const element of Array.from(form.elements)) {
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
    ))
      continue;
    if (!element.name || !element.willValidate) continue;
    const text = canonicalRegistrationText(element.value);
    const blank = element.required && element.type !== 'checkbox' && text === '';
    if (!element.validity.valid || blank) {
      errors[element.name] =
        element.type === 'checkbox'
          ? 'Please accept the waiver to continue.'
          : element.validity.valueMissing || blank
            ? element instanceof HTMLSelectElement
              ? 'Please choose an option.'
              : 'This field is required.'
            : element.validity.typeMismatch && element.type === 'email'
              ? 'Enter a valid email address.'
              : 'Please enter a valid value.';
      continue;
    }
    if (text === '' || element.type === 'checkbox') continue;
    const core = builtin.get(element.name);
    const field = custom.get(element.name);
    const kind = core
      ? core.key === 'guardianPhone'
        ? 'phone'
        : core.key === 'guardianEmail'
          ? 'email'
          : core.key === 'birthDate'
            ? 'birthDate'
            : ['givenName', 'familyName', 'guardianName'].includes(core.key)
              ? 'name'
              : undefined
      : field?.kind;
    if (kind === 'phone' && !isValidRegistrationPhone(text))
      errors[element.name] = 'Enter a phone number with 7 to 15 digits.';
    else if (kind === 'email' && !isValidRegistrationEmail(text))
      errors[element.name] = 'Enter a valid email address.';
    else if (kind === 'birthDate' && !isValidBirthDate(text))
      errors[element.name] = 'Enter a date of birth that is today or earlier.';
    else if (kind === 'date' && !isValidRegistrationCalendarDate(element.value))
      errors[element.name] = 'Enter a valid calendar date.';
    else if (kind === 'select' && !field?.options?.includes(element.value))
      errors[element.name] = 'Choose an option from this list.';
    else if (kind === 'name' || kind === 'text' || kind === 'textarea') {
      const maximum =
        kind === 'name'
          ? core?.key === 'guardianName'
            ? 160
            : 120
          : kind === 'textarea'
            ? 5000
            : 500;
      if (registrationCodePointLength(text) > maximum)
        errors[element.name] = `Use ${maximum} characters or fewer.`;
    }
  }
  return errors;
}
