import { appErrorDetails, type AppErrorCategory, type AppErrorCode } from '../domain/app-error';
import { correlationIdValue } from '../domain/correlation-id';
import { snapshotOwnPrimitives } from '../domain/primitive-snapshot';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const operations = new Set([
  'health.read',
  'integration.load',
  'analytics.enqueue',
  'auth.recovery',
  'auth.sign_in',
  'auth.sign_up',
  'auth.verification',
  'checkin.load',
  'checkin.write',
  'membership.change',
  'membership.load',
  'messages.load',
  'messages.send',
  'onboarding.create',
  'onboarding.load',
  'platform.authorize',
  'platform.organizations.list',
  'platform.subscriptions.list',
  'platform.audit.list',
  'platform.support.list',
  'platform.support.begin',
  'profile.load',
  'registration.create',
  'registration.load',
  'report.load',
  'staffing.load',
  'tryout_setup.load',
  'tryout_setup.save',
  'tryouts.load',
]);

const uuidKeys = [
  'actorId',
  'jobId',
  'memberId',
  'organizationId',
  'registrationId',
  'tryoutId',
] as const;
const correlationKeys = ['correlationId', 'requestId'] as const;

export type OperationalLogOperation =
  | 'health.read'
  | 'integration.load'
  | 'analytics.enqueue'
  | 'auth.recovery'
  | 'auth.sign_in'
  | 'auth.sign_up'
  | 'auth.verification'
  | 'checkin.load'
  | 'checkin.write'
  | 'membership.change'
  | 'membership.load'
  | 'messages.load'
  | 'messages.send'
  | 'onboarding.create'
  | 'onboarding.load'
  | 'platform.authorize'
  | 'platform.organizations.list'
  | 'platform.subscriptions.list'
  | 'platform.audit.list'
  | 'platform.support.list'
  | 'platform.support.begin'
  | 'profile.load'
  | 'registration.create'
  | 'registration.load'
  | 'report.load'
  | 'staffing.load'
  | 'tryout_setup.load'
  | 'tryout_setup.save'
  | 'tryouts.load';
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

function uuidValue(value: unknown): string | undefined {
  return typeof value === 'string' && uuidPattern.test(value) ? value : undefined;
}

function issuedCorrelationValue(value: unknown): string | undefined {
  return correlationIdValue(value) ?? undefined;
}

function operationValue(value: unknown): string | undefined {
  return typeof value === 'string' && operations.has(value) ? value : undefined;
}

const logContextNormalizers = {
  actorId: uuidValue,
  jobId: uuidValue,
  memberId: uuidValue,
  organizationId: uuidValue,
  registrationId: uuidValue,
  tryoutId: uuidValue,
  correlationId: issuedCorrelationValue,
  requestId: issuedCorrelationValue,
  operation: operationValue,
} as const;

/** Builds a new context exclusively from closed operations and non-sensitive identifiers. */
export function redactLogContext(context: LogContext): RedactedLogContext {
  const snapshot = snapshotOwnPrimitives(context, logContextNormalizers);
  return snapshot ? Object.freeze({ ...snapshot }) : {};
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

/** Runtime-boundary variant: observability sinks must never break the protected workflow. */
export function logErrorSafely(
  logger: OperationalLogger,
  error: unknown,
  context: LogContext = {},
): void {
  try {
    logError(logger, error, context);
  } catch {
    // The closed record has already been constructed; a failed sink is deliberately non-blocking.
  }
}
