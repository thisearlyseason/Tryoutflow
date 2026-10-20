const defaultMaximumAttempts = 5;
const defaultInitialDelayMilliseconds = 100;
const defaultMaximumDelayMilliseconds = 1_000;

export function createReaperRetryPolicy(options = {}) {
  const maximumAttempts = options.maximumAttempts ?? defaultMaximumAttempts;
  const initialDelayMilliseconds =
    options.initialDelayMilliseconds ?? defaultInitialDelayMilliseconds;
  const maximumDelayMilliseconds =
    options.maximumDelayMilliseconds ?? defaultMaximumDelayMilliseconds;
  let attempts = 0;

  return {
    next() {
      if (attempts >= maximumAttempts) {
        return { attempt: attempts, delayMilliseconds: 0, exhausted: true };
      }
      attempts += 1;
      return {
        attempt: attempts,
        delayMilliseconds:
          attempts === 1
            ? 0
            : Math.min(initialDelayMilliseconds * 2 ** (attempts - 2), maximumDelayMilliseconds),
        exhausted: false,
      };
    },
  };
}
