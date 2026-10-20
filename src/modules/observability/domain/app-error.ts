import { snapshotOwnPrimitives } from './primitive-snapshot';

export type AppErrorCategory =
  'validation' | 'permission' | 'conflict' | 'network' | 'integration' | 'unexpected';

const definitions = {
  validation_failed: {
    category: 'validation',
    message: 'The request is invalid.',
  },
  permission_denied: {
    category: 'permission',
    message: 'Permission is required.',
  },
  platform_forbidden: {
    category: 'permission',
    message: 'Platform authorization required.',
  },
  conflict_detected: {
    category: 'conflict',
    message: 'The request conflicts with current state.',
  },
  network_unavailable: {
    category: 'network',
    message: 'The network is unavailable.',
  },
  integration_unavailable: {
    category: 'integration',
    message: 'The integration is unavailable.',
  },
  platform_unavailable: {
    category: 'unexpected',
    message: 'Platform administration is unavailable.',
  },
  unexpected_error: {
    category: 'unexpected',
    message: 'An unexpected error occurred.',
  },
} as const satisfies Record<string, Readonly<{ category: AppErrorCategory; message: string }>>;

export type AppErrorCode = keyof typeof definitions;

const issuedAppErrors = new WeakSet<object>();

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && Object.hasOwn(definitions, value);
}

export function appErrorDetails(error: unknown): Readonly<{
  category: AppErrorCategory;
  code: AppErrorCode;
}> {
  const snapshot =
    (typeof error === 'object' && error !== null && issuedAppErrors.has(error)
      ? snapshotOwnPrimitives(error, {
          code: (value) => (isAppErrorCode(value) ? value : undefined),
        })
      : null) ?? null;
  const requestedCode = snapshot?.code;
  const code = isAppErrorCode(requestedCode) ? requestedCode : 'unexpected_error';
  return { category: definitions[code].category, code };
}

/** A closed application failure whose code, category, message, and JSON are never caller text. */
export class AppError extends Error {
  readonly category: AppErrorCategory;
  readonly code: AppErrorCode;

  constructor(requestedCode: AppErrorCode) {
    const code = isAppErrorCode(requestedCode) ? requestedCode : 'unexpected_error';
    const definition = definitions[code];
    super(definition.message);
    this.name = 'AppError';
    this.category = definition.category;
    this.code = code;
    issuedAppErrors.add(this);
  }

  toJSON() {
    return appErrorDetails(this);
  }
}
