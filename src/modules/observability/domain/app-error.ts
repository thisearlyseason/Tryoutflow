export type AppErrorCategory =
  'validation' | 'permission' | 'conflict' | 'network' | 'integration' | 'unexpected';

export type AppErrorInput = Readonly<{
  category: AppErrorCategory;
  code: string;
  message: string;
  cause?: unknown;
}>;

/** A typed application failure whose serialized form is safe for user-facing boundaries. */
export class AppError extends Error {
  readonly category: AppErrorCategory;
  readonly code: string;

  constructor(input: AppErrorInput) {
    super(input.message, { cause: input.cause });
    this.name = 'AppError';
    this.category = input.category;
    this.code = input.code;
  }

  toJSON() {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
    };
  }
}
