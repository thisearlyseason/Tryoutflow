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

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && Object.hasOwn(definitions, value);
}

export function appErrorDetails(error: unknown): Readonly<{
  category: AppErrorCategory;
  code: AppErrorCode;
}> {
  let code: AppErrorCode = 'unexpected_error';
  try {
    if (error instanceof AppError && isAppErrorCode(error.code)) code = error.code;
  } catch {
    // Prototype-forged and accessor-backed objects collapse to the closed unexpected record.
  }
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
  }

  toJSON() {
    return appErrorDetails(this);
  }
}
