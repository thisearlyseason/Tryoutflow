import { AppError, type AppErrorCategory } from '../domain/app-error';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const correlationPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const operationPattern = /^[a-z][a-z0-9_.-]{2,63}$/u;

const uuidKeys = ['actorId', 'jobId', 'organizationId'] as const;
const correlationKeys = ['correlationId', 'requestId'] as const;
const operationKeys = ['code', 'operation'] as const;

export type LogContext = Readonly<Record<string, unknown>>;
export type RedactedLogContext = Readonly<
  Partial<
    Record<
      (typeof uuidKeys)[number] | (typeof correlationKeys)[number] | (typeof operationKeys)[number],
      string
    >
  >
>;

export type OperationalErrorRecord = Readonly<{
  category: AppErrorCategory;
  code: string;
  context: RedactedLogContext;
  level: 'error';
}>;

export interface OperationalLogger {
  error(record: OperationalErrorRecord): void;
}

function allowedString(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/** Builds a new context exclusively from non-sensitive, bounded identifiers. */
export function redactLogContext(context: LogContext): RedactedLogContext {
  const safe: Record<string, string> = {};
  for (const key of [...uuidKeys].sort()) {
    if (allowedString(context[key], uuidPattern)) safe[key] = context[key];
  }
  for (const key of [...correlationKeys].sort()) {
    if (allowedString(context[key], correlationPattern)) safe[key] = context[key];
  }
  for (const key of [...operationKeys].sort()) {
    if (allowedString(context[key], operationPattern)) safe[key] = context[key];
  }
  return safe;
}

export function logError(
  logger: OperationalLogger,
  error: unknown,
  context: LogContext = {},
): void {
  const applicationError = error instanceof AppError ? error : null;
  logger.error({
    category: applicationError?.category ?? 'unexpected',
    code:
      applicationError && allowedString(applicationError.code, operationPattern)
        ? applicationError.code
        : 'unexpected_error',
    context: redactLogContext(context),
    level: 'error',
  });
}
