import { z } from 'zod';

import { connectionChallengeSchema, connectionResultSchema } from '../domain/contracts';
import {
  normalizeTeamManagementProviderError,
  type TeamManagementProvider,
  type TeamManagementProviderError,
} from '../domain/provider';
import { can, type AuthorizationContext } from '../../organizations/application/capabilities';
import { parseOrganizationId } from '../../../lib/ids';

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$/u);
const inputSchema = z.strictObject({
  organizationId: z.uuid(),
  correlationId: token,
  idempotencyKey: token,
});

export type DemoConnectionGateway = Readonly<{
  saveConnection(input: {
    organizationId: string;
    actorId: string;
    providerKey: string;
    connectionId: string;
    displayName: string;
    mockData: true;
  }): Promise<'connected' | 'replayed' | 'forbidden' | 'invalid_input' | 'conflict'>;
}>;

export type ConnectDemoProviderResult =
  | { outcome: 'connected' | 'replayed'; connectionId: string }
  | {
      outcome:
        | 'invalid_input'
        | 'forbidden'
        | 'provider_disabled'
        | 'conflict'
        | 'connection_error'
        | 'unavailable';
      error?: TeamManagementProviderError;
    };

export async function connectDemoProvider(
  input: z.input<typeof inputSchema>,
  actor: AuthorizationContext,
  dependencies: {
    providers: { get(providerKey: string): TeamManagementProvider };
    gateway: DemoConnectionGateway;
  },
): Promise<ConnectDemoProviderResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  if (
    !can(actor, 'integration:manage', {
      organizationId: parseOrganizationId(parsed.data.organizationId),
    })
  ) {
    return { outcome: 'forbidden' };
  }
  let provider: TeamManagementProvider;
  try {
    provider = dependencies.providers.get('the-squad');
  } catch {
    return { outcome: 'provider_disabled' };
  }
  try {
    const challenge = connectionChallengeSchema.parse(
      await provider.beginConnection({
        organizationId: parsed.data.organizationId,
        actorId: actor.userId,
        correlationId: parsed.data.correlationId,
        idempotencyKey: parsed.data.idempotencyKey,
        callbackUrl: 'https://demo-mock.tryoutflow.invalid/callback',
      }),
    );
    if (challenge.mode !== 'mock' || !challenge.mockData) {
      return {
        outcome: 'connection_error',
        error: { code: 'provider_configuration', retryable: false },
      };
    }
    const connection = connectionResultSchema.parse(
      await provider.completeConnection({
        organizationId: parsed.data.organizationId,
        actorId: actor.userId,
        correlationId: parsed.data.correlationId,
        idempotencyKey: parsed.data.idempotencyKey,
        challengeId: challenge.challengeId,
        callbackParameters: { mockApproval: 'approved' },
      }),
    );
    if (!connection.mockData || !/demo|mock/iu.test(connection.displayName)) {
      return {
        outcome: 'connection_error',
        error: { code: 'provider_configuration', retryable: false },
      };
    }
    const saved = await dependencies.gateway.saveConnection({
      organizationId: parsed.data.organizationId,
      actorId: actor.userId,
      providerKey: connection.providerKey,
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      mockData: true,
    });
    if (saved === 'connected' || saved === 'replayed') {
      return { outcome: saved, connectionId: connection.connectionId };
    }
    if (saved === 'forbidden') return { outcome: 'forbidden' };
    if (saved === 'conflict') return { outcome: 'conflict' };
    return { outcome: 'invalid_input' };
  } catch (error) {
    return { outcome: 'connection_error', error: normalizeTeamManagementProviderError(error) };
  }
}
