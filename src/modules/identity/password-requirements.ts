export function unmetPasswordRequirements(candidate: string, repeated: string) {
  return [
    ...(candidate.length < 8 || candidate.length > 128 ? ['8–128 characters'] : []),
    ...(!/[a-z]/u.test(candidate) ? ['a lowercase letter'] : []),
    ...(!/[A-Z]/u.test(candidate) ? ['an uppercase letter'] : []),
    ...(!/\d/u.test(candidate) ? ['a number'] : []),
    ...(!/[^A-Za-z0-9\s]/u.test(candidate) ? ['a symbol'] : []),
    ...(candidate !== repeated || !repeated ? ['an exact password confirmation'] : []),
  ];
}
