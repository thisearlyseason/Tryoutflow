import { appErrorDetails, type AppErrorCategory, type AppErrorCode } from '../domain/app-error';
import { correlationIdValue } from '../domain/correlation-id';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const operations = new Set([
  'health.read',
  'platform.authorize',
  'platform.organizations.list',
  'platform.subscriptions.list',
  'platform.audit.list',
  'platform.support.list',
  'platform.support.begin',
]);

const uuidKeys = ['actorId', 'jobId', 'organizationId'] as const;
const correlationKeys = ['correlationId', 'requestId'] as const;

export type OperationalLogOperation =
  | 'health.read'
  | 'platform.authorize'
  | 'platform.organizations.list'
  | 'platform.subscriptions.list'
  | 'platform.audit.list'
  | 'platform.support.list'
  | 'platform.support.begin';
export type LogContext = Readonly<Record<string, unknown>>;
export type RedactedLogContext = Readonly<
  Partial<
    Record<(typeof uuidKeys)[number] | (typeof correlationKeys)[number] | 'operation', string>
  >
>;

export type OperationalErrorRecord = Readonly<{
  category: AppErrorCategory;
  code: AppErrorCode;
  context: RedactedLogContext;
  level: 'error';
}>;

export interface OperationalLogger {
  error(record: OperationalErrorRecord): void;
}

/** Builds a new context exclusively from closed operations and non-sensitive identifiers. */
export function redactLogContext(context: LogContext): RedactedLogContext {
  const safe: Record<string, string> = {};
  for (const key of uuidKeys) {
    const value = context[key];
    if (typeof value === 'string' && uuidPattern.test(value)) safe[key] = value;
  }
  for (const key of correlationKeys) {
    const value = correlationIdValue(context[key]);
    if (value) safe[key] = value;
  }
  if (typeof context.operation === 'string' && operations.has(context.operation)) {
    safe.operation = context.operation;
  }
  return safe;
}

export function logError(
  logger: OperationalLogger,
  error: unknown,
  context: LogContext = {},
): void {
  const applicationError = appErrorDetails(error);
  logger.error({
    category: applicationError.category,
    code: applicationError.code,
    context: redactLogContext(context),
    level: 'error',
  });
}
