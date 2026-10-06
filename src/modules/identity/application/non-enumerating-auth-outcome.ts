import { snapshotOwnPrimitives } from '../../observability/domain/primitive-snapshot';

// Only known account-existence outcomes retain a neutral success response.
// Operational failures must never be mistaken for a sent verification email.
export function isNeutralAuthOutcome(error: unknown, operation: 'signup' | 'resend'): boolean {
  const snapshot = snapshotOwnPrimitives(error, {
    code: (value) => (typeof value === 'string' ? value : undefined),
    message: (value) => (typeof value === 'string' ? value : undefined),
  });
  if (!snapshot) return false;
  if (snapshot.code !== undefined) {
    return operation === 'signup'
      ? snapshot.code === 'email_exists' || snapshot.code === 'user_already_exists'
      : snapshot.code === 'user_not_found';
  }
  // Compatibility with older SDK responses without a machine-readable code.
  const message = typeof snapshot.message === 'string' ? snapshot.message.toLowerCase() : '';
  return operation === 'signup'
    ? message === 'already registered' || message === 'user already registered'
    : message === 'no user found' || message === 'user not found';
}
