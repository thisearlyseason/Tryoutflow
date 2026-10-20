export type AppResult<Value, Error> = { ok: true; value: Value } | { ok: false; error: Error };

export function success<Value>(value: Value): AppResult<Value, never> {
  return { ok: true, value };
}

export function failure<Error>(error: Error): AppResult<never, Error> {
  return { ok: false, error };
}
