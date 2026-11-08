import type {
  RegistrationFormSchema,
  RegistrationBuiltInField,
} from '@/modules/registration/domain/form-schema';
import {
  getBuiltInFields,
  LEGACY_IDENTITY_FIELDS,
} from '@/modules/registration/domain/built-in-fields';
import { PARTICIPATION_WAIVER_STARTER } from '@/modules/registration/domain/waiver-starter';
export type EditableRegistrationForm = {
  name: string;
  fields: RegistrationFormSchema['fields'];
  builtInFields?: RegistrationBuiltInField[];
  notificationEmail?: string;
};
export type Question =
  | { type: 'builtIn'; field: RegistrationBuiltInField }
  | { type: 'custom'; field: RegistrationFormSchema['fields'][number] };
export function registrationValues(initial?: EditableRegistrationForm): Record<string, string> {
  const builtin: Question[] = getBuiltInFields(initial ?? {}).map((field) => ({
    type: 'builtIn',
    field: { ...field },
  }));
  const custom: Question[] = (
    initial?.fields ?? [
      {
        key: 'custom_waiver',
        label: 'Waiver and consent',
        kind: 'consent' as const,
        waiverText: PARTICIPATION_WAIVER_STARTER,
        required: true,
        sortOrder: 0,
      },
    ]
  )
    .filter((field) => !Object.hasOwn(LEGACY_IDENTITY_FIELDS, field.key))
    .map((field) => ({ type: 'custom', field: { ...field } }));
  const questions = initial?.builtInFields
    ? [...builtin, ...custom].sort((a, b) => a.field.sortOrder - b.field.sortOrder)
    : [...builtin, ...custom.sort((a, b) => a.field.sortOrder - b.field.sortOrder)];
  return { name: initial?.name ?? '', questions: JSON.stringify(questions) };
}
