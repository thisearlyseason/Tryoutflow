export type DuplicateReason = 'name_birthdate_guardian_email';

export type DuplicateCandidate = {
  athleteId: string;
  reason: DuplicateReason;
};

export type DuplicateAthlete = {
  athleteId: string;
  givenName: string;
  familyName: string;
  birthDate: string;
  guardianEmail: string;
};

export type DuplicateInput = Omit<DuplicateAthlete, 'athleteId'>;

function normaliseText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-CA');
}

export function findDuplicateCandidates(
  existing: DuplicateAthlete[],
  incoming: DuplicateInput,
): DuplicateCandidate[] {
  const givenName = normaliseText(incoming.givenName);
  const familyName = normaliseText(incoming.familyName);
  const guardianEmail = normaliseText(incoming.guardianEmail);

  return existing
    .filter(
      (candidate) =>
        normaliseText(candidate.givenName) === givenName &&
        normaliseText(candidate.familyName) === familyName &&
        candidate.birthDate === incoming.birthDate &&
        normaliseText(candidate.guardianEmail) === guardianEmail,
    )
    .map((candidate) => ({
      athleteId: candidate.athleteId,
      reason: 'name_birthdate_guardian_email' as const,
    }));
}
