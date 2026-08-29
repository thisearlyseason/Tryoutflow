import { createHash } from 'node:crypto';

import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { AthleteIdentitySchema } from '../../athletes/domain/athlete';
import { findDuplicateCandidates, type DuplicateAthlete } from '../domain/duplicate-detection';
import {
  canonicalImportText,
  isValidRegistrationEmail,
  isValidRegistrationPhone,
  registrationCodePointLength,
} from '../domain/registration-validation';
import { mappedValue, parseAthleteCsv, type CsvColumnMapping } from './parse-athlete-csv';

export type ImportPreviewError =
  | 'given_name_invalid'
  | 'family_name_invalid'
  | 'birth_date_invalid'
  | 'guardian_name_invalid'
  | 'guardian_email_invalid'
  | 'guardian_phone_invalid'
  | 'guardian_fields_incomplete';

export type ImportPreviewRow = {
  row: number;
  status: 'valid' | 'duplicate_candidate' | 'invalid';
  errors: ImportPreviewError[];
  athlete: {
    givenName: string;
    familyName: string;
    birthDate: string;
    guardianName?: string;
    guardianEmail?: string;
    guardianPhone?: string;
  };
  duplicateCandidateIds: string[];
};

export type AthleteImportPreview = {
  id: string;
  organizationId: string;
  contentHash: string;
  mapping: CsvColumnMapping;
  rows: ImportPreviewRow[];
  expiresAt: string;
};

export type PreviewAthleteImportGateway = {
  findExistingAthletes(organizationId: string): Promise<DuplicateAthlete[]>;
  savePreview(preview: Omit<AthleteImportPreview, 'id'>): Promise<AthleteImportPreview>;
};

/**
 * Candidate identifiers are an ASCII-only wire contract (UUIDs and
 * `preview-row:<integer>`). Keep this comparison in sync with the database's
 * `C` collation so previews and commit-time revalidation produce byte-for-byte
 * identical JSON arrays.
 */
function canonicalCandidateIds(candidateIds: string[]): string[] {
  return [...new Set(candidateIds)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function identityErrors(input: ImportPreviewRow['athlete']): ImportPreviewError[] {
  const errors: ImportPreviewError[] = [];
  const identity = AthleteIdentitySchema.safeParse(input);
  if (!identity.success) {
    for (const issue of identity.error.issues) {
      const field = issue.path[0];
      if (field === 'givenName') errors.push('given_name_invalid');
      else if (field === 'familyName') errors.push('family_name_invalid');
      else if (field === 'birthDate') errors.push('birth_date_invalid');
    }
  }
  if (input.guardianName !== undefined) {
    const name = canonicalImportText(input.guardianName);
    if (registrationCodePointLength(name) < 1 || registrationCodePointLength(name) > 160)
      errors.push('guardian_name_invalid');
  }
  if (input.guardianEmail !== undefined && !isValidRegistrationEmail(input.guardianEmail))
    errors.push('guardian_email_invalid');
  if (input.guardianPhone !== undefined && !isValidRegistrationPhone(input.guardianPhone))
    errors.push('guardian_phone_invalid');
  if (
    (input.guardianName === undefined) !== (input.guardianEmail === undefined) ||
    (input.guardianPhone !== undefined && input.guardianEmail === undefined)
  )
    errors.push('guardian_fields_incomplete');
  return [...new Set(errors)];
}

function normalizedAthlete(input: ImportPreviewRow['athlete']): ImportPreviewRow['athlete'] {
  return {
    givenName: canonicalImportText(input.givenName),
    familyName: canonicalImportText(input.familyName),
    birthDate: canonicalImportText(input.birthDate),
    ...(input.guardianName === undefined
      ? {}
      : { guardianName: canonicalImportText(input.guardianName) }),
    ...(input.guardianEmail === undefined
      ? {}
      : {
          guardianEmail: canonicalImportText(input.guardianEmail).toLocaleLowerCase('en-CA'),
        }),
    ...(input.guardianPhone === undefined
      ? {}
      : { guardianPhone: canonicalImportText(input.guardianPhone) }),
  };
}

export async function previewAthleteImport(
  input: {
    organizationId: string;
    content: string;
    mapping: CsvColumnMapping;
    actor: AuthorizationContext;
  },
  gateway: PreviewAthleteImportGateway,
): Promise<AthleteImportPreview> {
  if (
    !requireCapability(input.actor, 'athlete:write', {
      organizationId: input.organizationId as AuthorizationContext['organizationId'],
    }).ok
  ) {
    throw { code: 'forbidden' as const };
  }
  const parsed = parseAthleteCsv(input.content, input.mapping);
  const existing = await gateway.findExistingAthletes(input.organizationId);
  const eligiblePriorRows: DuplicateAthlete[] = [];
  const rows = parsed.rows.map((row): ImportPreviewRow => {
    const athlete = normalizedAthlete({
      givenName: mappedValue(row, input.mapping.givenName) ?? '',
      familyName: mappedValue(row, input.mapping.familyName) ?? '',
      birthDate: mappedValue(row, input.mapping.birthDate) ?? '',
      ...(input.mapping.guardianName
        ? { guardianName: mappedValue(row, input.mapping.guardianName) ?? '' }
        : {}),
      ...(input.mapping.guardianEmail
        ? { guardianEmail: mappedValue(row, input.mapping.guardianEmail) ?? '' }
        : {}),
      ...(input.mapping.guardianPhone
        ? { guardianPhone: mappedValue(row, input.mapping.guardianPhone) ?? '' }
        : {}),
    });
    const errors = identityErrors(athlete);
    const canDetect = errors.length === 0;
    const duplicates = canDetect
      ? findDuplicateCandidates([...existing, ...eligiblePriorRows], {
          givenName: athlete.givenName,
          familyName: athlete.familyName,
          birthDate: athlete.birthDate,
          guardianEmail: athlete.guardianEmail,
        })
      : [];
    if (errors.length === 0) {
      eligiblePriorRows.push({
        athleteId: `preview-row:${row.row}`,
        givenName: athlete.givenName,
        familyName: athlete.familyName,
        birthDate: athlete.birthDate,
        ...(athlete.guardianEmail === undefined ? {} : { guardianEmail: athlete.guardianEmail }),
      });
    }
    return {
      row: row.row,
      status:
        errors.length > 0 ? 'invalid' : duplicates.length > 0 ? 'duplicate_candidate' : 'valid',
      errors,
      athlete,
      duplicateCandidateIds: canonicalCandidateIds(
        duplicates.map((candidate) => candidate.athleteId),
      ),
    };
  });
  const contentHash = createHash('sha256').update(input.content, 'utf8').digest('hex');
  return gateway.savePreview({
    organizationId: input.organizationId,
    contentHash,
    mapping: input.mapping,
    rows,
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
}
