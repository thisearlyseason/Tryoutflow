import { failure, success, type AppResult } from '../../../lib/result';

import {
  can,
  type AuthorizationContext,
  type AuthorizationResource,
  type Capability,
} from './capabilities';

export type AuthorizationError = { code: 'forbidden' };

export function requireCapability(
  context: AuthorizationContext,
  capability: Capability,
  resource: AuthorizationResource,
): AppResult<void, AuthorizationError> {
  return can(context, capability, resource) ? success(undefined) : failure({ code: 'forbidden' });
}
