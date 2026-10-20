/** Calendar age at an explicit cutoff, independent of the viewer's timezone. */
export function ageAtCutoff(birth: string | null, cutoff: string): number | null {
  if (
    !birth ||
    !/^\d{4}-\d{2}-\d{2}$/.test(birth) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(cutoff) ||
    birth > cutoff
  )
    return null;
  return (
    Number(cutoff.slice(0, 4)) -
    Number(birth.slice(0, 4)) -
    (cutoff.slice(5) < birth.slice(5) ? 1 : 0)
  );
}
export function ageEligibility(
  birth: string | null,
  cutoff: string,
  min: number | null,
  max: number | null,
) {
  const age = ageAtCutoff(birth, cutoff);
  if (age === null) return { age, status: 'Birth date required for review' };
  if (min === null && max === null) return { age, status: 'No age rule configured' };
  return {
    age,
    status:
      (min !== null && age < min) || (max !== null && age > max)
        ? 'Outside configured age range'
        : 'Within configured age range',
  };
}
