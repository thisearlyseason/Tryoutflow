import type {
  RegistrationBuiltInField,
  RegistrationBuiltInKey,
  RegistrationFormSchema,
} from './form-schema';

export const DEFAULT_BUILT_IN_FIELDS: RegistrationBuiltInField[] = [
  { key: 'givenName', label: 'Athlete first name', enabled: true, required: true, sortOrder: 0 },
  { key: 'familyName', label: 'Athlete last name', enabled: true, required: true, sortOrder: 1 },
  { key: 'guardianPhone', label: 'Guardian phone', enabled: true, required: false, sortOrder: 2 },
  { key: 'birthDate', label: 'Date of birth', enabled: true, required: true, sortOrder: 3 },
  { key: 'divisionId', label: 'Division', enabled: true, required: true, sortOrder: 4 },
  { key: 'positionId', label: 'Position', enabled: true, required: false, sortOrder: 5 },
  { key: 'guardianName', label: 'Guardian name', enabled: true, required: true, sortOrder: 6 },
  { key: 'guardianEmail', label: 'Guardian email', enabled: true, required: true, sortOrder: 7 },
];
export function isRequiredBuiltIn(key: RegistrationBuiltInKey): boolean {
  return ['givenName', 'familyName', 'guardianEmail'].includes(key);
}
export function getBuiltInFields(
  form: Pick<RegistrationFormSchema, 'builtInFields'>,
): RegistrationBuiltInField[] {
  return form.builtInFields ?? DEFAULT_BUILT_IN_FIELDS;
}
export function getBuiltInField(
  form: Pick<RegistrationFormSchema, 'builtInFields'>,
  key: RegistrationBuiltInKey,
) {
  return getBuiltInFields(form).find((field) => field.key === key);
}
export const LEGACY_IDENTITY_FIELDS: Record<string, RegistrationBuiltInKey> = {
  custom_birth_date: 'birthDate',
  custom_guardian_name: 'guardianName',
  custom_guardian_email: 'guardianEmail',
  custom_guardian_phone: 'guardianPhone',
};
export type OrderedRegistrationField =
  | { type: 'builtIn'; field: RegistrationBuiltInField }
  | { type: 'custom'; field: RegistrationFormSchema['fields'][number] };
export function getOrderedRegistrationFields(
  form: RegistrationFormSchema,
): OrderedRegistrationField[] {
  return [
    ...getBuiltInFields(form).map((field) => ({ type: 'builtIn' as const, field })),
    ...form.fields
      .filter((field) => !LEGACY_IDENTITY_FIELDS[field.key])
      .map((field) => ({
        type: 'custom' as const,
        field: {
          ...field,
          sortOrder: field.sortOrder + (form.builtInFields ? 0 : DEFAULT_BUILT_IN_FIELDS.length),
        },
      })),
  ]
    .filter((item) => item.field.enabled !== false)
    .sort((a, b) => a.field.sortOrder - b.field.sortOrder);
}
