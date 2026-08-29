import { canonicalImportText } from './registration-validation';

export type DuplicateReason = 'name_birthdate' | 'name_birthdate_guardian_email';

export type DuplicateCandidate = {
  athleteId: string;
  reason: DuplicateReason;
};

export type DuplicateAthlete = {
  athleteId: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  guardianEmail?: string;
};

export type DuplicateInput = Omit<DuplicateAthlete, 'athleteId'>;

function normaliseText(value: string) {
  return canonicalImportText(value).toLocaleLowerCase('en-CA');
}

export function findDuplicateCandidates(
  existing: DuplicateAthlete[],
  incoming: DuplicateInput,
): DuplicateCandidate[] {
  const givenName = normaliseText(incoming.givenName);
  const familyName = normaliseText(incoming.familyName);
  return existing
    .filter(
      (candidate) =>
        normaliseText(candidate.givenName) === givenName &&
        normaliseText(candidate.familyName) === familyName &&
        candidate.birthDate === incoming.birthDate,
    )
    .map((candidate) => ({
      athleteId: candidate.athleteId,
      reason:
        candidate.guardianEmail &&
        incoming.guardianEmail &&
        normaliseText(candidate.guardianEmail) === normaliseText(incoming.guardianEmail)
          ? ('name_birthdate_guardian_email' as const)
          : ('name_birthdate' as const),
    }));
}
